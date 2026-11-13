# -*- coding: utf-8 -*-
"""长会话体检（定时器 / 监听器泄漏探测）

背景：单文件应用常被"挂着开一整天"。若每次视图切换都新增 setInterval 或
      addEventListener 而不回收，几小时后定时器会堆积、内存上涨、界面变卡。
     本工具用无头浏览器模拟"长时间反复操作"，快照关键计数，判断是否单调增长。

用法:
  python3 tools/session_audit.py                # 默认 50 轮
  python3 tools/session_audit.py --rounds 200
  python3 tools/session_audit.py --json out.json

判据（每个都能一眼看出好坏）:
  - 定时器数：来回切视图 N 轮后不应持续增长（允许小幅波动）
  - 监听器数：同上（用 CDP 无法直接查，用猴子补丁计数 addEventListener/removeEventListener）
  - JS 堆：N 轮后不应线性上涨（GC 后回落到稳定区间）
  - 错误数：应为 0（长会话最怕"偶发报错累积"）
"""
import argparse, json, os, random, subprocess, tempfile, time, urllib.request

try:
    import websocket
except ImportError:
    raise SystemExit("需要 websocket-client: sudo pip3 install websocket-client")

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
from _app_path import resolve as _resolve_app
APP = _resolve_app()      # 2026-10-22：默认 public/index.html；多产物自动转同源 http
VIEWS = ["timer", "plan", "log", "stats", "settings"]


def launch():
    port = random.randint(9300, 9800)
    profile = tempfile.mkdtemp(prefix="saudit_")
    proc = subprocess.Popen(
        ["chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
         f"--user-data-dir={profile}", "--window-size=390,844", "--hide-scrollbars",
         "--disable-dev-shm-usage", f"--remote-debugging-port={port}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.25)
    else:
        proc.kill()
        raise SystemExit("chromium 启动超时")
    tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json").read())
    page = [t for t in tabs if t.get("type") == "page"][0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=120)
    mid = [0]
    events = []

    def send(m, p=None, tmo=60):
        mid[0] += 1
        i = mid[0]
        ws.send(json.dumps({"id": i, "method": m, "params": p or {}}))
        end = time.time() + tmo
        while time.time() < end:
            try:
                ws.settimeout(max(0.3, end - time.time()))
                r = json.loads(ws.recv())
            except Exception:
                return {"__err": "timeout"}
            if r.get("id") == i:
                return r
            events.append(r)
        return {"__err": "timeout"}

    def js(x):
        r = send("Runtime.evaluate", {"expression": x, "returnByValue": True})
        if "__err" in r:
            return "ERR:" + r["__err"]
        res = r.get("result", {})
        if "exceptionDetails" in res:
            return "EXC:" + str(res["exceptionDetails"].get("text", ""))[:120]
        return res.get("result", {}).get("value")

    send("Page.enable")
    send("Runtime.enable")
    send("Page.navigate", {"url": APP})
    time.sleep(0.2)
    send("Runtime.enable")
    return ws, js, proc


# 猴子补丁：统计"净增监听器"（避免 getEventListeners 只在 devtools 可用）
HOOK = r"""
(function(){
  if (window.__auditHooked) return 'already';
  window.__auditHooked = true;
  window.__audit = {add:0, remove:0, ivLive:0, toLive:0};
  var _add = EventTarget.prototype.addEventListener;
  var _rm  = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function(){ window.__audit.add++; return _add.apply(this, arguments); };
  EventTarget.prototype.removeEventListener = function(){ window.__audit.remove++; return _rm.apply(this, arguments); };
  var _si = window.setInterval, _ci = window.clearInterval;
  var _st = window.setTimeout,  _ct = window.clearTimeout;
  window.setInterval = function(){ window.__audit.ivLive++; return _si.apply(window, arguments); };
  window.clearInterval = function(){ window.__audit.ivLive--; return _ci.apply(window, arguments); };
  window.setTimeout = function(){ window.__audit.toLive++; return _st.apply(window, arguments); };
  window.clearTimeout = function(){ window.__audit.toLive--; return _ct.apply(window, arguments); };
  return 'ok';
})()
"""


def snapshot(js):
    return js(r"""(function(){
      var a = window.__audit || {};
      var heap = 0;
      try { heap = performance.memory ? performance.memory.usedJSHeapSize : 0; } catch(e){}
      var errs = (window.__errRep && window.__errRep.list) ? window.__errRep.list().length : 0;
      var dom = document.getElementsByTagName('*').length;
      return JSON.stringify({add:a.add|0, remove:a.remove|0, iv:a.ivLive|0, to:a.toLive|0,
                             heap:heap, errs:errs, dom:dom});
    })()""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=50)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    ws, js, proc = launch()
    try:
        # 等应用就绪
        t0 = time.time()
        while time.time() - t0 < 60:
            if js("typeof window.__bootDone!=='undefined' && window.__bootDone>0") is True:
                break
            time.sleep(0.1)
        time.sleep(1.5)
        print("猴子补丁:", js(HOOK))
        time.sleep(0.3)

        samples = []
        first = snapshot(js)
        samples.append(("起始", json.loads(first) if isinstance(first, str) and first.startswith("{") else {}))

        for r in range(1, args.rounds + 1):
            v = VIEWS[r % len(VIEWS)]
            js(f"try{{switchView('{v}');}}catch(e){{}}")
            time.sleep(0.03)
            # 每 10 轮打一次快照
            if r % max(1, args.rounds // 10) == 0:
                s = snapshot(js)
                samples.append((f"{r}轮", json.loads(s) if isinstance(s, str) and s.startswith("{") else {}))

        # 强制 GC（若可用）后看是否回落
        js("(function(){try{ if(window.gc) window.gc(); }catch(e){}})()")
        time.sleep(1.0)
        s = snapshot(js)
        samples.append(("GC后", json.loads(s) if isinstance(s, str) and s.startswith("{") else {}))

        print("\n轮次      净监听增   interval  timeout   JS堆(KB)   DOM   错误")
        print("-" * 72)
        for name, d in samples:
            if not d:
                print(f"{name:<8}  (无数据)")
                continue
            print(f"{name:<8}  {d.get('add',0)-d.get('remove',0):>8}  {d.get('iv',0):>8}  "
                  f"{d.get('to',0):>7}  {round(d.get('heap',0)/1024):>9}  {d.get('dom',0):>5}  {d.get('errs',0):>4}")

        # 结论
        first_d = samples[0][1] if samples[0][1] else {}
        last_d = samples[-1][1] if samples[-1][1] else {}
        iv_growth = last_d.get("iv", 0) - first_d.get("iv", 0)
        heap_growth = (last_d.get("heap", 0) - first_d.get("heap", 0)) / 1024
        errs = last_d.get("errs", 0)
        print("\n===== 体检结论 =====")
        print(f"  interval 净增 : {iv_growth}（判据：≤5 合格）  {'✓' if iv_growth <= 5 else '✗ 疑似泄漏'}")
        print(f"  JS 堆净增     : {round(heap_growth)} KB  {'✓' if heap_growth < 5000 else '⚠ 关注'}")
        print(f"  累计错误      : {errs}  {'✓' if errs == 0 else '✗ 有错误'}")
        ok = iv_growth <= 5 and errs == 0
        print(f"\n  长会话体检: {'✅ 通过' if ok else '❌ 未通过'}")
        if args.json:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"rounds": args.rounds, "samples": samples}, f, ensure_ascii=False, indent=2)
            print(f"  明细已存: {args.json}")
        return 0 if ok else 1
    finally:
        try:
            ws.close()
        except Exception:
            pass
        proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
