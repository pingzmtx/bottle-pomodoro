# -*- coding: utf-8 -*-
"""剩余 bug 批量探针：#13 横屏全屏专注 / #17 段位周标闪卡 / #22 今日分析。

用法: python3 tools/rest_probe.py [13|17|22|all]
产物: /tmp/restprobe/*.png
"""
import json, os, sys, time, subprocess, tempfile, random, urllib.request, base64

try:
    import websocket
except ImportError:
    print("需要 websocket-client"); raise

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, _HERE)
from _app_path import resolve as _resolve_app
APP = _resolve_app()      # 2026-10-22：默认 public/index.html；多产物自动转同源 http
OUT = "/tmp/restprobe"
os.makedirs(OUT, exist_ok=True)

# 注入一份有数据的状态，让统计/段位/今日分析真正渲染
SEED = r"""
(function(){
  try {
    var now = Date.now(), DAY = 86400000;
    var recs = [];
    for (var i = 0; i < 12; i++) {
      var perDay = 3 + (i % 4);
      for (var k = 0; k < perDay; k++) {
        recs.push({
          id: 'seed_' + i + '_' + k,
          type: (k === 2 && i === 1) ? 'incomplete' : ((k === 1 && i % 3 === 0) ? 'half' : 'full'),
          startTime: now - i * DAY + k * 3600000,
          endTime: now - i * DAY + k * 3600000 + 1500000,
          duration: 1500000, effectiveSeconds: 1500000, pomos: 1,
          taskId: 't' + (k % 3),
          interruptions: i === 2 ? [{t: now}] : []
        });
      }
    }
    var todos = [
      {id:'t0', text:'写方案', done:true, createdAt: now - 5*DAY, pomodoros: 12},
      {id:'t1', text:'改代码', done:false, createdAt: now - 3*DAY, pomodoros: 8},
      {id:'t2', text:'读书', done:false, createdAt: now - 1*DAY, pomodoros: 4}
    ];
    localStorage.setItem('tomato_focus_v3', JSON.stringify({
      records: recs, todos: todos, habits: [], habitLogs: {},
      settings: {}, tree: {}, rank: {}, achievements: {}
    }));
  } catch(e) { window.__seedErr = String(e); }
})();
"""


def launch(width, height, seed=True):
    win_w, win_h = max(width, 500), max(height, 700)
    PORT = random.randint(10200, 10600)
    PROFILE = tempfile.mkdtemp(prefix="rest_")
    proc = subprocess.Popen(
        ["chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
         f"--user-data-dir={PROFILE}", f"--window-size={win_w},{win_h}",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         f"--remote-debugging-port={PORT}", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1); break
        except Exception:
            time.sleep(0.25)
    tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
    page = [t for t in tabs if t.get("type") == "page"][0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"],
                                     suppress_origin=True, timeout=120)
    mid = [0]
    errs = []

    def send(m, p=None, keep=False):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": m, "params": p or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("method") == "Runtime.exceptionThrown":
                d = r["params"]["exceptionDetails"]
                errs.append(str(d.get("exception", {}).get("description", d.get("text", "")))[:300])
            if r.get("method") == "Runtime.consoleAPICalled" and r["params"].get("type") == "error":
                try:
                    errs.append("CONSOLE:" + " ".join(
                        str(a.get("value", a.get("description", ""))) for a in r["params"]["args"])[:300])
                except Exception:
                    pass
            if r.get("id") == mid[0]:
                return r

    def js(x):
        r = send("Runtime.evaluate", {"expression": x, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in r["result"]:
            d = r["result"]["exceptionDetails"]
            return "EXC:" + str(d.get("exception", {}).get("description", d.get("text", "")))[:400]
        return r["result"]["result"].get("value")

    send("Page.enable"); send("Runtime.enable"); send("Log.enable")
    if seed:
        send("Page.addScriptToEvaluateOnNewDocument", {"source": SEED})
    send("Emulation.setDeviceMetricsOverride",
         {"width": win_w, "height": win_h, "deviceScaleFactor": 1, "mobile": False})
    send("Page.navigate", {"url": APP})
    time.sleep(3.0)
    return proc, ws, send, js, errs


def shot(send, name):
    r = send("Page.captureScreenshot", {"format": "png"})
    b = r["result"].get("data")
    if b:
        open(os.path.join(OUT, name + ".png"), "wb").write(base64.b64decode(b))
        return True
    return False


# ============ #13 横屏全屏专注 ============
def probe13():
    print("\n" + "=" * 66)
    print("#13 横屏全屏专注不显示 —— 探针（1024×600 横屏）")
    print("=" * 66)
    proc, ws, send, js, errs = launch(1024, 600)
    iw = js("window.innerWidth + 'x' + window.innerHeight")
    print("视口回读:", iw)
    print("__seedErr:", js("window.__seedErr"))
    print("seed 记录数:", js("(function(){try{return JSON.parse(localStorage.getItem('tomato_focus_v3')).records.length}catch(e){return 'ERR:'+e}})()"))
    # 切到计时页并截图
    js("(function(){try{switchView('timer')}catch(e){}})()")
    time.sleep(0.5)
    shot(send, "13_landscape_timer")
    # 检查沉浸式全屏弹窗在横屏下的可见性
    info = js(r"""(function(){
      var ids = ['immersiveCardModal','immersiveOverlay','immersiveProgress','immersiveScreen'];
      var o = {};
      ids.forEach(function(id){
        var el = document.getElementById(id);
        o[id] = el ? {exists:true, display: getComputedStyle(el).display,
                      w: el.offsetWidth, h: el.offsetHeight,
                      rect: (function(){var r=el.getBoundingClientRect();return {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)}})()} : {exists:false};
      });
      o.viewport = window.innerWidth + 'x' + window.innerHeight;
      o.bodyH = document.body.scrollHeight;
      o.mainH = (document.querySelector('main')||{}).offsetHeight || 0;
      return o;
    })()""")
    print("-- 沉浸相关节点 --")
    print(json.dumps(info, ensure_ascii=False, indent=1))
    if errs:
        print("!! 运行期错误:")
        for e in errs[:8]:
            print("   ", e)
    ws.close(); proc.terminate()
    return info, errs


# ============ #17 段位周标闪卡 ============
def probe17():
    print("\n" + "=" * 66)
    print("#17 段位周标闪卡 —— 探针")
    print("=" * 66)
    proc, ws, send, js, errs = launch(390, 844)
    print("视口:", js("window.innerWidth+'x'+window.innerHeight"))
    js("(function(){try{switchView('timer')}catch(e){}})()")
    time.sleep(0.8)
    # 段位卡 & 周标相关节点
    info = js(r"""(function(){
      var res = {};
      var sel = ['rankCard','rankBadge','trsTask','rankBox','weekBadge','allWeeks','subRankUp'];
      sel.forEach(function(id){
        var el = document.getElementById(id);
        res[id] = el ? {exists:true, display:getComputedStyle(el).display,
                         html:(el.innerHTML||'').slice(0,120)} : {exists:false};
      });
      res.rankFuncs = {
        getBetTier: typeof getBetTier,
        renderRankCard: typeof renderRankCard
      };
      return res;
    })()""")
    print(json.dumps(info, ensure_ascii=False, indent=1))
    if errs:
        print("!! 运行期错误:")
        for e in errs[:8]:
            print("   ", e)
    ws.close(); proc.terminate()
    return info, errs


# ============ #22 今日分析 ============
def probe22():
    print("\n" + "=" * 66)
    print("#22 点「今日分析」显示错误 —— 探针")
    print("=" * 66)
    proc, ws, send, js, errs = launch(390, 844)
    print("视口:", js("window.innerWidth+'x'+window.innerHeight"))
    js("(function(){try{switchView('stats')}catch(e){}})()")
    time.sleep(1.0)
    # 找到「今日分析」入口并点击
    click = js(r"""(function(){
      var el = document.getElementById('todayAnalysisBox') || document.getElementById('todayAnalysisBody');
      if (!el) return 'no todayAnalysisBox';
      var b = el.querySelector('b[onclick], b[data-act], b');
      if (!b) return 'no toggle b';
      b.click();
      return 'clicked: ' + b.textContent.trim().slice(0,40);
    })()""")
    print("点击结果:", click)
    time.sleep(1.0)
    body = js(r"""(function(){
      var b = document.getElementById('todayAnalysisBody');
      if (!b) return 'NO todayAnalysisBody';
      return {display: b.style.display, len: (b.innerHTML||'').length,
              head: (b.textContent||'').slice(0,300),
              hasError: /undefined|NaN|\[object|错误|Error/.test(b.textContent||'')};
    })()""")
    print("-- 展开后内容 --")
    if isinstance(body, dict):
        print("display:", body.get("display"), " len:", body.get("len"))
        print("hasErrorToken:", body.get("hasError"))
        print("内容前 300 字:")
        print(body.get("head"))
    else:
        print(body)
    shot(send, "22_today_analysis")
    if errs:
        print("!! 运行期错误:")
        for e in errs[:10]:
            print("   ", e)
    ws.close(); proc.terminate()
    return body, errs


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("13", "all"):
        probe13()
    if what in ("17", "all"):
        probe17()
    if what in ("22", "all"):
        probe22()


# ============ #13b 全屏专注（immersiveMode）横屏 ============
def probe13b():
    print("\n" + "=" * 66)
    print("#13 横屏「全屏专注」(#immersionMode) —— 真实触发")
    print("=" * 66)
    for (w, h) in [(1024, 600), (390, 844)]:
        print("\n---- 视口 %dx%d ----" % (w, h))
        proc, ws, send, js, errs = launch(w, h)
        iw = js("window.innerWidth + 'x' + window.innerHeight")
        print("回读视口:", iw)
        # 启动一个专注番茄
        start = js("(function(){try{startPomodoroCore();return 'started:'+timerState.mode+'/'+timerState.running}catch(e){return 'EXC:'+e}})()")
        print("startPomodoroCore:", start)
        time.sleep(0.6)
        # 进入沉浸
        r = js("(function(){try{toggleImmersion();var im=document.getElementById('immersionMode');return {cls:im.className, display:getComputedStyle(im).display, w:im.offsetWidth, h:im.offsetHeight, cardTop: im.getBoundingClientRect().top, cardLeft: im.getBoundingClientRect().left}}catch(e){return 'EXC:'+e}})()")
        print("toggleImmersion →", json.dumps(r, ensure_ascii=False) if isinstance(r, dict) else r)
        time.sleep(0.4)
        shot(send, "13b_%dx%d_immersion" % (w, h))
        if errs:
            print("!! 错误:", errs[:4])
        ws.close(); proc.terminate()
