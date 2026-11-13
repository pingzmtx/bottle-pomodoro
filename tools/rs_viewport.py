# -*- coding: utf-8 -*-
"""多设备视口动线走查器（无头）。

目的：在 320 / 360 / 375 / 414 / 768 五个宽度下渲染核心视图，
      自动检测「横向溢出 / 元素溢出父容器 / 点击目标过小 / 文本截断」，
      并产出截图供人眼核验。

为什么存在：移动兼容此前是「一次性检查」——验证过没问题，但没有东西守着，
  改一次 CSS 谁也不知道有没有把窄屏弄坏。故补 --check：把各检测项计数冻结成
  棘轮基线，新增/上升即 FAIL（做法与 tools/coverage.py 完全同款）。

用法:
  python3 tools/rs_viewport.py                # 全档全视图（只看，不判定）
  python3 tools/rs_viewport.py --check        # 走查 + 棘轮门禁（挂 verify.py 的 viewport 段）
  python3 tools/rs_viewport.py --write        # 把当前计数写成新基线（修好后收窄）
  python3 tools/rs_viewport.py --json         # 结构化输出（供 verify.py / AI 消费）
  python3 tools/rs_viewport.py --widths 320,375
  python3 tools/rs_viewport.py --views timer,stats
  python3 tools/rs_viewport.py --dark

产物: docs/archive/视口走查/ 下 <view>_<width>.png + report.json
      --write 时另写 tools/viewport_baseline.json

退出码（照 project 约定）：
  0 = 全绿（无新增违规，或未开 --check）
  1 = 有检测项计数高于基线（新增了真实违规）
  3 = 环境不具备（本机起不了无头 chromium）——verify.py 据此记 SKIP 而非 FAIL
"""
import json, os, sys, time, subprocess, tempfile, random, urllib.request, base64

# websocket-client 只被「无头 CDP」通道需要；--via browser（真机浏览器桥）
# 不需要它。故改为惰性导入（在 launch 内）—— 否则在没装它的机器上连桥模式都
# 起不来，本末倒置。见 。

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)

WIDTHS = [320, 360, 375, 414, 768]
# 高度取「该宽度下最常见的真机 CSS 视口高度」。
# 320 档不要用 560：真机 iPhone SE1 为 320×568，Android 小屏 320×640。
#   560 会人为制造"内容被挤压"的假象（把高度问题误判成宽度问题）。
HEIGHTS = {320: 568, 360: 640, 375: 667, 414: 736, 768: 1024}

# ── 传输层──────────────────────────────────────────────
# 默认：无头 chromium + CDP（需要 websocket-client，本沙箱跑不起来）。
# --via browser：改用 tools/smoke_bridge.py 的「真机浏览器当执行器」通道，
#   桥的 eval()/set_viewport() 与 CDP 的 js()/Emulation.setDeviceMetricsOverride
#   语义对齐，**检测用例代码一个字不动**。
#   唯一差别：桥没有截屏能力 → 不产出 PNG（断言不受影响，见 run() 内注释）。
VIA_BROWSER = ("--via" in sys.argv and "browser" in sys.argv)
BRIDGE_PORT = 8793


def _bridge_port():
    if "--port" in sys.argv:
        return int(sys.argv[sys.argv.index("--port") + 1])
    return BRIDGE_PORT

# 棘轮基线：各检测项计数冻结在此，新增/上升即 FAIL（与 coverage.py 同款做法）。
BASELINE = os.path.join(_HERE, "viewport_baseline.json")
# --json 时压制逐视图的进度打印，保证 stdout 是一段干净的 JSON（供程序消费）。
AS_JSON = "--json" in sys.argv

# ── 检测项口径 ──────────────────────────────────────────
# 键名 = 基线字段名；值从 report.results 逐条汇总。
# h_overflow 取「有溢出的检查点数」而非 px 总量——棘轮管的是「还有几处不干净」，
# 一个检查点溢 1px 和溢 50px 都是「一处没修好」，不该因 px 抖动误判。
_METRICS = ["checks", "h_overflow", "offenders", "small_tap", "tiny_text", "covered"]

# 核心视图：(view key, 中文名, 是否需注入数据)
VIEWS = [
    ("timer",    "计时器",   False),
    ("plan",     "计划",     True),
    ("log",      "日志",     True),
    ("stats",    "统计",     True),
    ("settings", "设置",     False),
]


def _resolve_app():
    # 2026-10-22：统一走 _app_path（--html / RS_APP / 默认 public/index.html；
    # 多产物自动转同源 http，否则 file:// 下读不了 cssRules）。
    sys.path.insert(0, _HERE)
    from _app_path import resolve as _r
    return _r()


APP = _resolve_app()


def launch(width, height):
    """启动无头浏览器并**强制**设备视口。

    ⚠ 血泪（假绿拦截）：
      Chromium headless 的窗口有 **500px 最小宽度**限制 → `--window-size=320,568`
      会被静默忽略，`window.innerWidth` 实际恒为 500。
      若不察觉，320/360/375/414 四档全部按 500px 布局渲染，
      "横向溢出=0" 是**假绿**（测的不是目标宽度）。
      正确做法：用 CDP `Emulation.setDeviceMetricsOverride` 覆写设备指标，
      并回读 innerWidth 断言，不符即**硬失败**（宁可不测，也不出假数据）。
    """
    import websocket  # 惰性导入：只有走无头 CDP 通道才需要
    # 窗口给足，避免 clip 裁切面小于模拟视口
    win_w = max(width, 500)
    win_h = max(height, 700)
    PORT = random.randint(9400, 9800)
    PROFILE = tempfile.mkdtemp(prefix="rsv_")
    proc = subprocess.Popen(
        [os.environ.get("CHROMIUM", "chromium"), "--headless=new", "--disable-gpu", "--no-sandbox",
         f"--user-data-dir={PROFILE}", f"--window-size={win_w},{win_h}",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         f"--remote-debugging-port={PORT}", APP],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = False
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            ok = True
            break
        except Exception:
            time.sleep(0.25)
    if not ok:
        proc.kill()
        raise RuntimeError("chromium 启动超时")
    tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
    page = [t for t in tabs if t.get("type") == "page"][0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=90)
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

    def shot(path):
        r = send("Page.captureScreenshot", {"format": "png"})
        data = (r.get("result") or {}).get("data")
        if data:
            with open(path, "wb") as f:
                f.write(base64.b64decode(data))
            return True
        return False

    send("Page.enable")
    send("Runtime.enable")
    # 关键：覆写设备指标，真正把 CSS 视口压到目标宽度
    send("Emulation.setDeviceMetricsOverride", {
        "width": width, "height": height,
        "deviceScaleFactor": 1, "mobile": width < 720,
    })
    # 断言：回读必须等于目标，否则本档数据不可信 → 抛错终止
    actual = js("window.innerWidth")
    if actual != width:
        ws.close()
        proc.kill()
        raise RuntimeError(
            f"视口覆写失败：目标 {width}，实际 innerWidth={actual}。"
            f"本档数据不可信，已中止（拒绝产出假绿）。")
    return ws, js, shot, proc


# ── 场景数据注入（复用 rs_capture 的 SCEN 逻辑，精简版） ──
SCEN = r"""
window.__rsScen = function(s) {
  var now = Date.now(); var dayMs = 86400000;
  function treeSet(o){ var T = appData.tree || {}; for (var k in o) T[k] = o[k]; appData.tree = T; }
  function rankSet(o){ var R = appData.rankSystem || {}; for (var k in o) R[k] = o[k]; appData.rankSystem = R; }
  if (!appData.habits) appData.habits = [];
  if (!appData.habitLogs) appData.habitLogs = {};
  if (!appData.signIn) appData.signIn = {};
  if (!appData.weeklyBadges) appData.weeklyBadges = {};
  if (!appData.immersiveFocus) appData.immersiveFocus = {};
  if (!appData.diaries) appData.diaries = {};
  if (!appData.todos) appData.todos = [];
  appData.records = [];
  var R = [];
  var days = 30;
  for (var d = 0; d < days; d++) {
    var cnt = (d <= 7 ? 6 : (d % 3 === 0 ? 3 : 1));
    for (var k = 0; k < cnt; k++) {
      var dd = new Date(now - d * dayMs);
      var hh = (k * 5 + d) % 24;
      dd.setHours(hh, (k * 11) % 60, 0, 0);
      var sec = (d % 6 === 0 ? 3000 : 1500);
      R.push({ id: R.length + 1, type: 'full', taskName: '任务' + ((d + k) % 3), note: '',
        startTime: dd.getTime(), endTime: dd.getTime() + sec * 1000, effectiveSeconds: sec,
        pomos: 1, difficulty: 'medium', interruptions: [], totalInterruptSeconds: 0,
        energy: (k + 1) % 5 || 5, mood: (k + 2) % 5 || 5 });
    }
  }
  appData.records = R;
  treeSet({ points: 160, peakPoints: 160, totalFruitsHarvested: 12,
    unlockedSpecies: ['tomato','cherry','apple'], fruitAlbum: Array(6).fill(1),
    dewBadges: 4, waterStreak: 12 });
  appData.habits = [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }];
  var hl = {};
  for (var hi = 0; hi < appData.habits.length; hi++) {
    var a2 = []; for (var hd = 0; hd < 14; hd++) a2.push(getDateStr(new Date(now - hd * dayMs)));
    hl['h' + (hi + 1)] = a2;
  }
  appData.habitLogs = hl;
  appData.signIn = { totalDays: 18 };
  appData.weeklyBadges = { cumulative: { a: 1, b: 1, c: 1 } };
  rankSet({ stars: 47, history: { maxStarsCareer: 60 }, rankFeedback: [], dailyTask: null });
  appData.todos = [
    { id: 1, text: '写周报总结', done: false },
    { id: 2, text: '整理项目文档归档', done: false },
    { id: 3, text: '回复邮件', done: true }
  ];
  var D = {};
  for (var di = 0; di < 3; di++) D[getDateStr(new Date(now - di * dayMs))] = { feedback: { sleepQuality: (di % 8) + 1, mentalState: (di % 7) + 2 } };
  appData.diaries = D;
  appData.immersiveFocus = { unlockedAchievements: ['adv_space'] };
  return appData.records.length;
}
1
"""

# ── 溢出/遮挡检测（在页面内跑，返回结构化结果） ──
DETECT = r"""
(function(){
  var out = { view: null, vw: window.innerWidth, vh: window.innerHeight,
              docScrollW: document.documentElement.scrollWidth,
              bodyScrollW: document.body.scrollWidth,
              hOverflow: 0, offenders: [], smallTap: [], tinyText: [], offscreen: [] };

  /* ① 文档级横向溢出 */
  out.hOverflow = Math.max(0, out.docScrollW - out.vw);

  /* 触区扩展判定：元素自身视觉小，但用绝对定位的 ::before/::after 透明层把
     可点热区撑大到 ≥30px（本应用 .todo-checkbox/.todo-expand-btn 的做法）。
     有则不算「点击目标过小」。 */
  function hasTouchPad(el) {
    var names = ['::before', '::after'];
    for (var i = 0; i < names.length; i++) {
      var ps = getComputedStyle(el, names[i]);
      if (!ps || ps.content === 'none' || ps.content === 'normal') continue;
      if (ps.position !== 'absolute' && ps.position !== 'fixed') continue;
      var pw = parseFloat(ps.width), ph = parseFloat(ps.height);
      if (pw >= 30 && ph >= 30) return true;
    }
    return false;
  }

  var active = document.querySelector('.view.active') || document.body;
  var vrect = active.getBoundingClientRect();
  var all = active.querySelectorAll('*');
  var seen = {};
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < vrect.top - 40 || r.top > vrect.bottom + 40) continue;  // 不在本视图纵向范围

    /* ② 元素右缘越界（超出视口右边界 1px 以上，且自身宽度>4） */
    if (r.right > out.vw + 1.5 && r.width < out.vw * 1.05 && !seen['R' + i]) {
      var ok = false;
      /* 白名单：明确的横向滚动容器（自带 overflow-x:auto/scroll 且内容确实可滚） */
      var p = el;
      for (var dep = 0; dep < 4 && p; dep++) {
        var ps = getComputedStyle(p);
        if ((ps.overflowX === 'auto' || ps.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 2) { ok = true; break; }
        p = p.parentElement;
      }
      if (!ok) {
        seen['R' + i] = 1;
        out.offenders.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || '', cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
          right: Math.round(r.right), w: Math.round(r.width),
          txt: (el.textContent || '').trim().slice(0, 24)
        });
      }
    }

    /* ③ 可点击元素过小（< 30px 边）—— 触控可用性
       误报排除：本应用有控件「视觉小、触区大」——.todo-checkbox（视觉 22px）、
       .todo-expand-btn（视觉 24px）都用 ::before 透明层把可点热区撑到 40px
       （见 src/template/13_plan.css 注释「符合触屏最小目标」）。border-box
       量不到伪元素 → 会被误判成「点击目标过小」。故带 ≥30px 触区伪元素者跳过。 */
    var clickable = (el.tagName === 'BUTTON' || el.tagName === 'A' ||
                     el.getAttribute('onclick') || el.getAttribute('role') === 'button');
    if (clickable && (r.height < 30 || r.width < 30) && !hasTouchPad(el)) {
      out.smallTap.push({ tag: el.tagName.toLowerCase(), id: el.id || '',
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50),
        w: Math.round(r.width), h: Math.round(r.height),
        txt: (el.textContent || '').trim().slice(0, 18) });
    }

    /* ④ 文本被截断（scrollWidth 明显大于 clientWidth，且非滚动容器）
       误报排除：只有真正「裁剪」的才算截断。overflow 为 visible 时文字是
       **溢出可见**（如年度热力图 12px 列里的月份/年份标签，见
       src/scripts/01e7_ui_stats.js 注释「4 字符年份会溢出 12px 列宽」），
       不是被切掉。 */
    if (el.children.length === 0 && (el.textContent || '').trim().length > 0) {
      if (el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 8) {
        var ws = getComputedStyle(el);
        if (ws.overflow !== 'visible' &&
            ws.textOverflow !== 'ellipsis' && ws.overflowX !== 'auto' && ws.overflowX !== 'scroll') {
          out.tinyText.push({ tag: el.tagName.toLowerCase(), id: el.id || '',
            cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50),
            sw: el.scrollWidth, cw: el.clientWidth,
            txt: (el.textContent || '').trim().slice(0, 24) });
        }
      }
    }
  }
  /* 去重并限量 */
  function uniq(arr, keyf) {
    var m = {}, o = [];
    for (var i = 0; i < arr.length; i++) { var k = keyf(arr[i]); if (!m[k]) { m[k] = 1; o.push(arr[i]); } }
    return o;
  }
  out.offenders = uniq(out.offenders, function(x){ return x.tag + '|' + x.id + '|' + x.cls + '|' + x.right; }).slice(0, 40);
  out.smallTap = uniq(out.smallTap, function(x){ return x.tag + '|' + x.id + '|' + x.cls + '|' + x.w + 'x' + x.h; }).slice(0, 40);
  out.tinyText = uniq(out.tinyText, function(x){ return x.tag + '|' + x.id + '|' + x.cls; }).slice(0, 40);

  /* ⑤ 底部导航遮挡检测
     事实核查（写入前先读布局）：
       .main { padding-bottom: calc(80px + safe-area) }
       .bottom-nav { position: fixed; bottom: 0; height≈62px }
     即「内容从底栏下方滚过」是**既定且正确**的架构 —— 任何元素矩形跨过
     底栏上沿都不算遮挡（上面早已预留 80px 内边距）。
     真正的缺陷只有一个：**内容被底栏永久截断且无法滚到**。
     故判据收敛为：页面纵向不可滚（scrollHeight ≈ clientHeight）时，
     视图内某元素的 bottom 仍 > 底栏上沿 → 该内容永远看不到 → 截断缺陷。
  */
  var nav = document.querySelector('.bottom-nav') || document.querySelector('.nav-bar');
  out.navTop = null; out.covered = []; out.pageScrollable = null;
  var scap = document.scrollingElement || document.documentElement;
  out.pageScrollable = (scap.scrollHeight > scap.clientHeight + 2);
  if (nav) {
    var nr = nav.getBoundingClientRect();
    if (nr.height > 0 && nr.top > out.vh * 0.6) {
      out.navTop = Math.round(nr.top);
      /* 仅当不可滚时才判截断（可滚 = 用户能滑上来看到，非缺陷） */
      if (!out.pageScrollable) {
        for (var j = 0; j < all.length; j++) {
          var e2 = all[j];
          var s2 = getComputedStyle(e2);
          if (s2.display === 'none' || s2.visibility === 'hidden') continue;
          if (s2.position === 'fixed' || s2.position === 'absolute') continue;
          var r2 = e2.getBoundingClientRect();
          if (r2.height < 12 || r2.width < out.vw * 0.4) continue;
          /* 元素确实跨到导航栏下方，且自身不是导航栏后代 */
          if (r2.top < nr.top && r2.bottom > nr.top + 4 && !nav.contains(e2)) {
            out.covered.push({ tag: e2.tagName.toLowerCase(), id: e2.id || '',
              cls: (typeof e2.className === 'string' ? e2.className : '').slice(0, 50),
              top: Math.round(r2.top), bottom: Math.round(r2.bottom),
              txt: (e2.textContent || '').trim().slice(0, 24) });
          }
        }
        out.covered = uniq(out.covered, function(x){ return x.tag + '|' + x.id + '|' + x.cls; }).slice(0, 20);
      }
    }
  }

  /* ⑥ 活跃视图内是否有可独立滚动的容器（固定视口 + 内部滚动是本应用既定架构） */
  var sc = document.querySelector('.view.active .scroll, .view.active .content');
  out.innerScrollable = sc ? (sc.scrollHeight > sc.clientHeight + 2) : null;
  return out;
})()
"""


def run(widths, views, dark, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    report = {"app": APP, "dark": dark, "widths": widths, "results": []}

    bridge = None
    if VIA_BROWSER:
        sys.path.insert(0, _HERE)
        from smoke_bridge import BridgeServer
        port = _bridge_port()
        # BridgeServer 要的是**本地文件路径**（它自己读副本再喂给浏览器），
        # 而 rs_viewport 的 APP 是 file:// URL → 必须剥掉前缀（血泪：
        # 传 URL 进去，桥会去 open('file:///...') 直接 Errno 2，页面永远白屏）。
        _app = APP[len("file://"):] if APP.startswith("file://") else APP
        bridge = BridgeServer(_app, port=port)
        bridge.start()
        if not AS_JSON:
            print(f"\n【真机浏览器桥】请把浏览器导航到  http://127.0.0.1:{port}/")
            print("（等浏览器接入，最多 300s；接入后自动开跑）")
        if not bridge.wait_attach(300):
            bridge.stop()
            raise RuntimeError(f"浏览器没接入 —— 请先打开 http://127.0.0.1:{port}/")
        if not AS_JSON:
            print("✓ 浏览器已接入\n")

    for w in widths:
        h = HEIGHTS.get(w, 700)
        if VIA_BROWSER:
            # 桥只有一张常驻页面（不像 CDP 每档新开浏览器）→ 用 reset_storage
            # 清 localStorage+IndexedDB，等价于「开个干净的浏览器」。
            bridge.set_viewport(w, h)
            bridge.reset_storage()
            js = bridge.eval
            def shot(_path):
                # 桥没有 Page.captureScreenshot。返回 False，**不影响任何断言**
                # （截图只是给人看的存档，检测数据全部来自 js 量测）。
                return False
            def _close():
                pass
        else:
            ws, js, shot, proc = launch(w, h)
            def _close():
                ws.close(); proc.kill()
        # 视口覆写后必须回读 == 目标宽度，否则本档数据不可信（拒绝假绿）。
        # CDP 版在 launch 内已断言；桥的 postMessage 是异步的，这里轮询等它生效。
        _vw = js("window.innerWidth")
        for _ in range(20):
            if _vw == w:
                break
            time.sleep(0.3)
            _vw = js("window.innerWidth")
        if _vw != w:
            if bridge:
                bridge.stop()
            raise RuntimeError(
                f"视口覆写失败：目标 {w}，实际 innerWidth={_vw}。"
                f"本档数据不可信，已中止（拒绝产出假绿）。")
        if not AS_JSON:
            print(f"\n===== 视口 {w}×{h}（实测 innerWidth={_vw}）=====")
        try:
            for _ in range(40):
                if js("!!(window.appData && appData.settings)"):
                    break
                time.sleep(0.4)
            time.sleep(1.6)
            js(SCEN)
            js("window.__rsScen('normal'); 1")
            # 旅程放行（关掉渐进解锁的锁）
            js("""(function(){ try{ if (window.__jy) { localStorage.removeItem('tomato_journey_v1'); delete appData.journey; window.__jy.ensure(); } } catch(e){} if(window.invalidateStatsCache) invalidateStatsCache(); return 1; })()""")
            time.sleep(0.6)
            # __jy.ensure() 会异步挂出 #jyCard 介绍卡 → 等它出现再关，否则关了也白关
            js("""(function(){
                var ids=['giftOverlay','chestOverlay','rankUpModal','finishModal','gachaModal'];
                for(var i=0;i<ids.length;i++){ var el=document.getElementById(ids[i]);
                  if(el){ el.classList.remove('show'); el.classList.remove('jy-open'); if(el.style) el.style.display='none'; } }
                var jc=document.getElementById('jyCard'); if(jc) jc.classList.remove('jy-open');
                var ovs=document.querySelectorAll('.jy-open');
                for(var k=0;k<ovs.length;k++){ ovs[k].classList.remove('jy-open'); }
                return 1; })()""")
            time.sleep(0.3)
            if dark:
                js("document.body.classList.add('dark-mode'); 1")
                time.sleep(0.3)
            js("(function(){ try{ if(appData.rankSystem) appData.rankSystem.stars = 47; }catch(e){} if(window.invalidateStatsCache) invalidateStatsCache(); return 1;})()")

            # 预渲染各重活区块（部分容器常驻，display 不影响 innerHTML）
            js("""(function(){ var e=[];
                try{ if(typeof renderTreeSection==='function') renderTreeSection(); }catch(x){e.push('tree');}
                try{ if(typeof renderTreeShop==='function') renderTreeShop(); }catch(x){e.push('shop');}
                try{ if(typeof renderTeamSystem==='function') renderTeamSystem(); }catch(x){e.push('team');}
                try{ if(typeof renderTodos==='function') renderTodos(); }catch(x){e.push('todo');}
                try{ if(typeof renderHabits==='function') renderHabits(); }catch(x){e.push('habit');}
                return e.join('|')||'ok'; })()""")
            time.sleep(0.8)

            for vk, vname, _ in views:
                js(f"switchView('{vk}'); 1")
                time.sleep(0.9)
                if vk == "stats":
                    js("(function(){ try{ renderStats(); }catch(e){} return 1; })()")
                    time.sleep(1.2)
                    js("""(function(){ try{ var M=window.__jyMore;
                        if (M && M.opened === false && typeof jyToggleMore === 'function') jyToggleMore(); }catch(e){} return 1; })()""")
                    time.sleep(0.8)
                    js("""(function(){ try{ if(typeof renderYearHeatmap==='function') renderYearHeatmap(); }catch(e){} return 1; })()""")
                    time.sleep(0.8)
                if vk == "log":
                    js("(function(){ try{ renderLogs(); }catch(e){} return 1; })()")
                    time.sleep(0.6)
                if vk == "plan":
                    js("(function(){ try{ renderPlanCountdowns(); renderTodos(); renderHabits(); }catch(e){} return 1; })()")
                    time.sleep(0.6)
                # 关弹窗 / 旅程浮层 / 新手引导
                # 血泪：渐进解锁的介绍卡 #jyCard 用 .jy-open 控制显隐（非 .show），
                #   且它在 __jy.ensure() 之后才挂载 → 只清 .show 会漏掉它，整页被盖住。
                # 另：#firstGuide（新手引导浮层）也常驻在底部，需一并隐藏。
                js("""(function(){
                    var ids=['giftOverlay','chestOverlay','rankUpModal','finishModal','gachaModal',
                             'immersiveCard','noiseModal','quickPanel','coinExchangeModal','treeShopModal',
                             'posterModal','sharePosterModal','logCalendarModal','countdownModal','firstGuide'];
                    for(var i=0;i<ids.length;i++){ var el=document.getElementById(ids[i]);
                      if(el){ el.classList.remove('show'); el.classList.remove('jy-open'); if(el.style) el.style.display='none'; } }
                    /* 旅程介绍卡：只关类，不 display:none —— 它是独立浮层 */
                    var jc=document.getElementById('jyCard'); if(jc) jc.classList.remove('jy-open');
                    /* 通用兜底：任何带 jy-open / show 的浮层一并关掉 */
                    var ovs=document.querySelectorAll('.jy-open, .mask.show, .overlay.show, [class*="Overlay"].show, .first-guide');
                    for(var k=0;k<ovs.length;k++){ ovs[k].classList.remove('jy-open'); ovs[k].classList.remove('show'); ovs[k].style.display='none'; }
                    try{ if(typeof skipGuide==='function') skipGuide(); }catch(e){}
                    try{ if(typeof closeGift==='function') closeGift(); }catch(e){}
                    try{ if(typeof closeChest==='function') closeChest(); }catch(e){}
                    /* 清 toast：注入数据会触发「每日任务/周挑战完成」横幅，
                       它是 3.5s 自动消失的**瞬时**提示（toastContainer），
                       不属于页面布局；不清理会污染截图与遮挡检测。 */
                    var tc=document.getElementById('toastContainer');
                    if(tc){ tc.innerHTML=''; if(tc.style) tc.style.display='none'; }
                    try{ if(window._toastQueue) window._toastQueue.length = 0; }catch(e){}
                    return 1; })()""")
                time.sleep(0.4)

                det = js(DETECT)
                if isinstance(det, dict):
                    det["view"] = vk
                    det["viewName"] = vname
                    det["width"] = w
                    report["results"].append(det)
                    if not AS_JSON:
                        flag = "✓" if det.get("hOverflow", 0) <= 0 and not det.get("offenders") and not det.get("covered") else "⚠"
                        print(f"  {flag} {vname:<6} 溢出={det.get('hOverflow',0)}px "
                              f"越界={len(det.get('offenders',[]))} "
                              f"遮挡={len(det.get('covered',[]))} "
                              f"小点击={len(det.get('smallTap',[]))} "
                              f"文本截断={len(det.get('tinyText',[]))} "
                              f"页可滚={det.get('pageScrollable')} 内可滚={det.get('innerScrollable')}")
                        if det.get("offenders"):
                            for o in det["offenders"][:5]:
                                print(f"      ↳ 越界 {o['tag']}#{o['id'] or '-'}.{o['cls'][:28]} right={o['right']} w={o['w']} 「{o['txt']}」")
                        if det.get("covered"):
                            for o in det["covered"][:5]:
                                print(f"      ↳ 被底栏遮挡 {o['tag']}#{o['id'] or '-'}.{o['cls'][:28]} bottom={o['bottom']} 「{o['txt']}」")
                elif not AS_JSON:
                    print(f"  ✗ {vname} 检测异常: {str(det)[:120]}")

                suffix = "_dark" if dark else ""
                shot(os.path.join(out_dir, f"{vk}_{w}{suffix}.png"))
        finally:
            _close()

    if bridge:
        bridge.stop()

    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    if not AS_JSON:
        print(f"\n报告: {os.path.join(out_dir, 'report.json')}")
    return report


def tally(report):
    """把 report.results 汇总成「各检测项计数」，供棘轮门禁比对。

    口径见 _METRICS 注释；checks 记录检查点数，用于防止「缩小扫描范围
    （少跑几个宽度/视图）让计数假降」——这条是棘轮的反向保险。
    """
    m = {k: 0 for k in _METRICS}
    for r in report.get("results", []):
        m["checks"] += 1
        if int(r.get("hOverflow", 0) or 0) > 0:
            m["h_overflow"] += 1
        m["offenders"] += len(r.get("offenders") or [])
        m["small_tap"] += len(r.get("smallTap") or [])
        m["tiny_text"] += len(r.get("tinyText") or [])
        m["covered"] += len(r.get("covered") or [])
    return m


# 中文名只为输出可读；与 _METRICS 一一对应。
_LABEL = {
    "h_overflow": "横向溢出（处）", "offenders": "元素越界（处）",
    "small_tap": "点击目标过小（处）", "tiny_text": "文本截断（处）",
    "covered": "被底栏永久截断（处）",
}


def judge(m, base):
    """按棘轮口径比对，返回 (是否通过, 违规说明列表)。

    上升即 FAIL、持平/下降即 PASS —— 与 coverage.py 的棘轮方向一致：
    老债不阻塞、新债立拦。
    """
    bad = []
    for k in ("h_overflow", "offenders", "small_tap", "tiny_text", "covered"):
        cur, was = m[k], int(base.get(k, 0))
        if cur > was:
            bad.append("%s %d > 基线 %d（新增了窄屏违规）" % (_LABEL[k], cur, was))
    if m["checks"] < int(base.get("checks", 0)):
        bad.append("检查点 %d < 基线 %d（缩小了扫描范围，计数可能假降）"
                   % (m["checks"], base.get("checks", 0)))
    return (not bad), bad


def main():
    widths = WIDTHS
    if "--widths" in sys.argv:
        i = sys.argv.index("--widths")
        widths = [int(x) for x in sys.argv[i + 1].split(",")]
    views = VIEWS
    if "--views" in sys.argv:
        i = sys.argv.index("--views")
        want = sys.argv[i + 1].split(",")
        views = [v for v in VIEWS if v[0] in want]
    dark = "--dark" in sys.argv
    out_dir = os.path.join(_ROOT, "docs", "archive", "视口走查")
    for a in sys.argv[1:]:
        if a.startswith("--out="):
            out_dir = os.path.abspath(a.split("=", 1)[1])

    as_check = "--check" in sys.argv
    write = "--write" in sys.argv

    try:
        report = run(widths, views, dark, out_dir)
    except ImportError as e:
        # 起不了无头通道 = 环境不具备，不是代码回归 → 退出码 3（verify.py 记 SKIP）。
        print("○ 本机起不了无头 chromium（缺 websocket-client：%s）" % str(e)[:60])
        return 3
    except RuntimeError as e:
        msg = str(e)
        if "启动超时" in msg or "浏览器没接入" in msg:
            print("○ 本机起不了无头 chromium（%s）" % msg[:80])
            return 3
        raise

    m = tally(report)

    base = {}
    if os.path.exists(BASELINE):
        with open(BASELINE, encoding="utf-8") as f:
            base = json.load(f)

    if write:
        with open(BASELINE, "w", encoding="utf-8") as f:
            json.dump(dict(m, note="棘轮基线：各检测项计数不得高于此值，检查点数不得低于此值。修好后跑 --write 收窄。"),
                      f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("✓ 已写入基线 %s" % os.path.relpath(BASELINE, _ROOT))
        for k in ("h_overflow", "offenders", "small_tap", "tiny_text", "covered"):
            print("    %s %d" % (_LABEL[k], m[k]))
        print("    检查点 %d" % m["checks"])
        return 0

    if not (as_check or AS_JSON):
        return 0

    ok, bad = judge(m, base)

    if AS_JSON:
        print(json.dumps({
            "checks": m["checks"], "metrics": {k: m[k] for k in _METRICS},
            "baseline": base or None, "violations": bad, "pass": ok,
        }, ensure_ascii=False))
        return 0 if ok else 1

    # 人读输出
    print("\n===== 视口棘轮门禁 =====")
    for k in ("h_overflow", "offenders", "small_tap", "tiny_text", "covered"):
        print("  %-16s 当前 %-4d 基线 %d" % (_LABEL[k], m[k], int(base.get(k, 0))))
    print("  检查点 %d（基线 %d）" % (m["checks"], int(base.get("checks", 0))))
    if not base:
        print("  ⚠ 基线不存在 —— 先跑 `python3 tools/rs_viewport.py --write` 校准（当前按全 0 判定）")
    if bad:
        for x in bad:
            print("✗ " + x)
        return 1
    print("✓ 各检测项计数未上升（窄屏无新增违规）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
