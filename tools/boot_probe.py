# -*- coding: utf-8 -*-
"""冷启动闪烁探针：验证「首帧是否已有加载页遮罩」。

用户描述：点进网页先看到主页 → 过零点几秒才显示加载页 → 眼前闪一下。

探针原理：
  1. 用 Page.addScriptToEvaluateOnNewDocument 在【解析前】注入钩子：
     - setInterval(0ms) 采样器：每 tick 记录 (t, bootSplash存在?, view-timer可见?)
     - MutationObserver 监听 head/body 子树，记录 #bootSplash 首次出现时间
  2. 打开页面，等待 3s，回读采样序列
  3. 断言：第一条采样里 bootSplash 就应该存在（首帧即有遮罩）
  4. 截图首帧区域

产物: /tmp/bootprobe/*.png
用法: python3 tools/boot_probe.py
"""
import json, os, sys, time, subprocess, tempfile, random, urllib.request

try:
    import websocket
except ImportError:
    print("需要 websocket-client"); raise

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
from _app_path import resolve as _resolve_app
APP = _resolve_app()      # 2026-10-22：默认 public/index.html；多产物自动转同源 http
OUT = "/tmp/bootprobe"
os.makedirs(OUT, exist_ok=True)

HOOK = r"""
(function () {
  window.__bootSamples = [];
  var t0 = performance.now();
  function snap(tag) {
    var s = document.getElementById('bootSplash');
    var vt = document.getElementById('view-timer');
    var vtVis = false;
    if (vt) {
      try {
        var cs = getComputedStyle(vt);
        vtVis = cs.display !== 'none' && cs.visibility !== 'hidden';
      } catch (e) {}
    }
    var sVis = false, sOpacity = '';
    if (s) {
      try {
        var cs2 = getComputedStyle(s);
        sVis = cs2.display !== 'none';
        sOpacity = cs2.opacity;
      } catch (e) {}
    }
    window.__bootSamples.push({
      t: Math.round(performance.now() - t0),
      tag: tag,
      bodyExists: !!document.body,
      hasSplash: !!s,
      splashVisible: sVis,
      splashOpacity: sOpacity,
      timerVisible: vtVis,
      readyState: document.readyState
    });
  }
  /* ★ 关键：真正的"首帧"= 浏览器第一次 paint。
     rAF 回调在 paint 前触发，因此第 1 次 rAF 里 DOM 已解析到当时进度。
     用 rAF 连续采样前若干帧 + setInterval 密集兜底，兼顾快慢设备。 */
  var rafN = 0;
  function rafLoop() {
    snap('raf' + rafN);
    rafN++;
    if (rafN < 90) requestAnimationFrame(rafLoop);
  }
  requestAnimationFrame(rafLoop);
  var iv = setInterval(function () { snap('iv'); }, 8);
  setTimeout(function () { clearInterval(iv); }, 4000);
  document.addEventListener('DOMContentLoaded', function () { snap('DCL'); });
  window.addEventListener('load', function () { snap('LOAD'); });
})();
"""


def launch(width, height):
    win_w, win_h = max(width, 500), max(height, 700)
    PORT = random.randint(9801, 10100)
    PROFILE = tempfile.mkdtemp(prefix="boot_")
    proc = subprocess.Popen(
        ["chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
         f"--user-data-dir={PROFILE}", f"--window-size={win_w},{win_h}",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         f"--remote-debugging-port={PORT}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.25)
    tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
    page = [t for t in tabs if t.get("type") == "page"][0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"],
                                     suppress_origin=True, timeout=120)
    mid = [0]

    def send(m, p=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": m, "params": p or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == mid[0]:
                return r

    def js(x):
        r = send("Runtime.evaluate", {"expression": x, "returnByValue": True})
        if "exceptionDetails" in r["result"]:
            d = r["result"]["exceptionDetails"]
            return "EXC:" + str(d.get("exception", {}).get("description", d.get("text", "")))[:300]
        return r["result"]["result"].get("value")

    send("Page.enable")
    send("Runtime.enable")
    # 解析前注入采样钩子
    send("Page.addScriptToEvaluateOnNewDocument", {"source": HOOK})
    send("Page.navigate", {"url": APP})
    return proc, ws, send, js


def run():
    proc, ws, send, js = launch(390, 844)
    time.sleep(3.2)
    samples = js("window.__bootSamples") or []
    ws.close()
    proc.terminate()

    if not isinstance(samples, list) or not samples:
        print("✗ 没采到样本:", samples)
        return 1

    raf_samples = [s for s in samples if s["tag"].startswith("raf")]
    first = raf_samples[0] if raf_samples else samples[0]
    dcl = next((s for s in samples if s["tag"] == "DCL"), None)
    load = next((s for s in samples if s["tag"] == "LOAD"), None)

    print("=" * 66)
    print("冷启动首帧采样（共 %d 条，其中 rAF 帧 %d 条）" % (len(samples), len(raf_samples)))
    print("=" * 66)
    if dcl:
        print("DOMContentLoaded  @ %s ms" % dcl["t"])
    if load:
        print("load              @ %s ms" % load["t"])
    print("-" * 66)
    print("★ 第 1 帧（首次 paint 前的 rAF）t=%sms:" % first["t"])
    print("   bodyExists=%-5s hasSplash=%-5s splashVisible=%-5s timerVisible=%-5s %s"
          % (first["bodyExists"], first["hasSplash"], first["splashVisible"],
             first["timerVisible"], first["readyState"]))
    print("-" * 66)
    print("全部 rAF 帧（前 20）：")
    for s in raf_samples[:20]:
        print("  %-6s t=%4sms  body=%-5s splash=%-5s vis=%-5s opacity=%-4s timerVis=%-5s %s"
              % (s["tag"], s["t"], s["bodyExists"], s["hasSplash"],
                 s["splashVisible"], s["splashOpacity"], s["timerVisible"],
                 s["readyState"]))
    print("-" * 66)
    first_splash = next((s for s in samples if s["hasSplash"]), None)
    first_timer = next((s for s in samples if s["timerVisible"]), None)
    if first_splash:
        print("★ splash 首次出现   @ t=%sms（tag=%s, %s）"
              % (first_splash["t"], first_splash["tag"], first_splash["readyState"]))
    else:
        print("★ splash 从未出现")
    if first_timer:
        print("★ view-timer 首可见 @ t=%sms（tag=%s）" % (first_timer["t"], first_timer["tag"]))

    print("=" * 66)
    ok = first["hasSplash"] is True and first["splashVisible"] is True
    if ok:
        print("✓ PASS：第 1 帧就已有加载页遮罩，不会先闪主页")
    else:
        print("✗ FAIL：第 1 帧无加载页遮罩 → 会先看到主页再被盖上（用户描述的闪烁）")
    print("=" * 66)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(run())
