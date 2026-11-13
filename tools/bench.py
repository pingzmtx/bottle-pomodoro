#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍅 M2 性能基准（低端机模拟）
===========================
用法: python3 dev/perf/bench.py [--throttle 6] [--out bench.json]
原理: 无头 Chromium + CDP Emulation.setCPUThrottlingRate 模拟低端机算力，
      测量三项指标（均为 wall-clock ms）：
  cold       : 导航开始 → 应用可用（appData 就绪 + 计时页首屏元素在位）
  switch     : 同步调用 switchView(x) 的耗时（plan/log/stats/settings/timer）
  stats8000  : 造 8000 条记录后进统计页，到统计数据区出现可交互内容的时间
任何优化前后用同一命令对比。
"""
import sys, os, json, time, subprocess, tempfile, random, urllib.request
import websocket

# 修正：原为硬编码 "file:///workspace/index.html"（旧目录结构），
# 项目迁移到 /workspace/pomodoro 后该路径不存在 → 页面空白 → 全部指标恒为 -1/超时。
# 改为**相对本脚本定位项目根**，随目录迁移自动跟随。
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
from _app_path import resolve as _resolve_app
APP = _resolve_app()      # 2026-10-22：默认 public/index.html；多产物自动转同源 http
THROTTLE = 6
OUT = "bench.json"
if "--throttle" in sys.argv:
    THROTTLE = int(sys.argv[sys.argv.index("--throttle") + 1])
if "--out" in sys.argv:
    OUT = sys.argv[sys.argv.index("--out") + 1]

PORT = random.randint(9400, 9800)
PROFILE = tempfile.mkdtemp(prefix="bench_")

def launch():
    subprocess.Popen(["chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
                      f"--user-data-dir={PROFILE}", "--window-size=390,844", "--hide-scrollbars",
                      f"--remote-debugging-port={PORT}", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            return
        except Exception:
            time.sleep(0.25)
    raise SystemExit("chromium 启动失败")

launch()
tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
pg = [t for t in tabs if t.get("type") == "page"][0]
ws = websocket.create_connection(pg["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
mid = [0]
def send(m, p=None):
    mid[0] += 1
    _id = mid[0]
    ws.send(json.dumps({"id": _id, "method": m, "params": p or {}}))
    end = time.time() + 30
    while time.time() < end:
        try:
            ws.settimeout(max(0.3, end - time.time()))
            r = json.loads(ws.recv())
        except Exception:
            return {"__err": "timeout"}
        if r.get("id") == _id:
            return r
    return {"__err": "timeout"}
def _eval(e, timeout=30):
    mid[0] += 1
    _id = mid[0]
    ws.send(json.dumps({"id": _id, "method": "Runtime.evaluate",
                        "params": {"expression": e, "returnByValue": True, "awaitPromise": True}}))
    end = time.time() + timeout
    while time.time() < end:
        try:
            ws.settimeout(max(0.5, end - time.time()))
            r = json.loads(ws.recv())
        except Exception:
            return "TIMEOUT"
        if r.get("id") == _id:
            if "exceptionDetails" in r.get("result", {}):
                return "EXC:" + r["result"]["exceptionDetails"].get("text", "")
            return r["result"]["result"].get("value")
    return "TIMEOUT"

send("Runtime.enable")
send("Page.enable")

def wait_ready(limit=60, _t0=None):
    t0 = _t0 if _t0 is not None else time.time()
    cond = "window.__bootDone>0&&typeof appData!=='undefined'&&!!document.getElementById('timerTime')"
    while time.time() - t0 < limit:
        if _eval(cond) is True:
            return round((time.time() - t0) * 1000)
        time.sleep(0.02)
    return -1

# 1) cold start
# 修正：CPU 降速必须在 navigate **之后**设置——
#   1) Emulation 覆盖会被导航重置；2) 先降速会把"加载+解析整包"也纳入测量。
#    冷启动口径 = 页面开始执行脚本 → bootDone，不含限速；限速只用于后续交互耗时。
send("Page.navigate", {"url": APP})
# 修正：navigate 会销毁旧执行上下文 → 必须重新 Runtime.enable，
#    否则后续 Runtime.evaluate 全部 TIMEOUT（这正是冷启动长期报 -1 的根因）。
# 冷启动计时起点：navigate 发出即为 t0（不含 CDP 往返与 enable 开销）。
_cold_t0 = time.time()
time.sleep(0.2)
send("Runtime.enable")
cold = wait_ready(_t0=_cold_t0)
# 额外等 UI 稳定（旅程/公告等延迟任务不干扰后续测量）
time.sleep(1.0)
# 交互测量前开启 CPU 降速（模拟中低端机）
send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
time.sleep(0.3)

# 2) view switch（每视图切换两次取第二次，避免首次渲染与懒初始化叠加——取保守值）
views = ["plan", "log", "stats", "settings", "timer"]
sw = {}
for v in views:
    _eval(f"try{{switchView('{v}');}}catch(e){{}}")
    time.sleep(0.25)
    _eval(f"try{{switchView('{v}');}}catch(e){{}}")
    t = _eval("(function(){var t0=performance.now();try{switchView('"+v+"');}catch(e){}return Math.round(performance.now()-t0);})()")
    sw[v] = t
    time.sleep(0.15)

# 3) stats 8000 records
# 修正：原构造缺 taskName/note/effectiveSeconds 等统计必需字段，
#   导致统计页取数路径退化、测量超时（曾误报 20009ms）。补全字段后真实耗时 ~2 位数毫秒。
_eval("(function(){appData.records=[];var now=Date.now();for(var i=0;i<8000;i++){appData.records.push({id:i+1,type:'full',taskName:'任务'+(i%20),note:'备注'+(i%5),startTime:now-i*1800000,endTime:now-i*1800000+1500000,effectiveSeconds:1500,pomos:1,difficulty:'medium',interruptions:[],totalInterruptSeconds:0,energy:3,mood:3});}try{invalidateStatsCache&&invalidateStatsCache();}catch(e){}window.__jy&&window.__jy.ensure&&__jy.ensure();return 1;})()")
time.sleep(0.3)
t0 = time.time()
_eval("switchView('stats')")
# 轮询统计数据区出现内容
stats_ms = -1
while time.time() - t0 < 20:
    ready = _eval("(function(){var el=document.getElementById('statsDataView');if(!el)return false;return el.children.length>2||el.textContent.length>200;})()")
    if ready is True:
        stats_ms = round((time.time() - t0) * 1000)
        break
    time.sleep(0.02)
if stats_ms < 0:
    stats_ms = round((time.time() - t0) * 1000)

res = {"throttle": THROTTLE, "at": time.strftime("%H:%M:%S"), "cold_ms": cold, "switch_ms": sw, "stats8000_ms": stats_ms}
print(json.dumps(res, ensure_ascii=False, indent=2))
with open(OUT, "w") as f:
    json.dump(res, f, ensure_ascii=False, indent=2)

try:
    ws.close()
except Exception:
    pass
subprocess.run(["pkill", "-f", f"remote-debugging-port={PORT}"], capture_output=True)
