#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`timer.report` 的真页实测（flowtime / stopwatch 的实际取值）。

为什么需要它：
"flowtime 为什么没通知"这种问题，静态读代码只能得出"应该没问题"。
这里把**真实网页 + 真实 shim** 跑在 Chromium 里，桥桩把每条 `timer.report`
的 payload 原样记下来，然后断言原生到底收到了什么：
`mode` / `freeType` / `running` / `endAt` / `startTime` / `notify` / `bgPause`。

三个场景：
  1. pomodoro  ：mode=focus，endAt>0
  2. stopwatch ：mode=free, freeType=stopwatch, endAt=0, startTime>0（A 的输入）
  3. flowtime  ：mode=free, freeType=flowtime, endAt>0（"理应走 arm()"的那个）

外加一条回归：**冷启动第一帧不许上报 notify=false**。
（旧 shim 在 `appData.settings` 还没加载时 `!!undefined` → false，
原生第一规则立刻 disarm，把刚恢复的闹钟/常驻通知撤掉。）

退出码：0 = 全过；1 = 有用例 FAIL；2 = 环境不可用（playwright / 页面起不来）。

用法：python3 app/tools/qa_timer_report.py
前置：python3 app/tools/extract_shim.py（生成 app/build/shim.js）
"""
import functools
import http.server
import pathlib
import re
import socketserver
import sys
import threading

HERE = pathlib.Path(__file__).resolve()
PROJECT_DIR = HERE.parents[2]
STATE_KT = PROJECT_DIR / "app/src/main/java/im/bottle/focus/State.kt"
SHIM_DEFAULT = PROJECT_DIR / "app/build/shim.js"
WEB_DEFAULT = PROJECT_DIR / "app/src/main/assets/web"

# 桥桩：只保留 shim 需要的最小面，并记录每条消息。
STUB = """
(function () {
  'use strict';
  var listeners = [];
  window.__qaLog = [];
  function reply(id, payload) {
    var ev = { type: 'message', data: JSON.stringify({ v: 1, id: id, ok: true, payload: payload || {} }) };
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](ev); } catch (e) {} }
  }
  function handle(raw) {
    var m; try { m = JSON.parse(raw); } catch (e) { return; }
    window.__qaLog.push({ cmd: m.cmd, payload: m.payload || {} });
    var p = m.payload || {};
    switch (m.cmd) {
      case 'hello': reply(m.id, { appVersion: '0.1.1-qa', webVersion: 'qa', sdk: 34 }); break;
      case 'notify.permission': reply(m.id, { state: 'granted' }); break;
      case 'notify.request': reply(m.id, { state: 'granted' }); break;
      case 'notify.show': reply(m.id, { shown: true, suppressed: false, tag: 'web-notify' }); break;
      case 'notify.cancel': reply(m.id, { cancelled: true }); break;
      case 'screen.wake': reply(m.id, { on: !!p.on }); break;
      case 'timer.report': reply(m.id, { armed: true, fireAt: p.endAt || 0 }); break;
      case 'device.info': reply(m.id, { package: 'im.bottle.focus' }); break;
      default: reply(m.id, {}); break;
    }
  }
  window.__BOTTLE_BRIDGE__ = {
    postMessage: function (raw) { handle(raw); },
    addEventListener: function (t, fn) { if (t === 'message') { listeners.push(fn); } },
    removeEventListener: function (t, fn) {
      if (t !== 'message') { return; }
      var i = listeners.indexOf(fn); if (i >= 0) { listeners.splice(i, 1); }
    }
  };
})();
"""

REPORTS = "() => (window.__qaLog || []).filter(m => m.cmd === 'timer.report').map(m => m.payload)"
STATE = """() => {
  const t = window.timerState || {};
  return { mode: t.mode, freeType: t.freeType, running: !!t.running,
           endAt: +t.endAt || 0, startTime: +t.startTime || 0 };
}"""


def read_bridge_name() -> str:
    m = re.search(r'const\s+val\s+BRIDGE_NAME\s*=\s*"([^"]+)"', STATE_KT.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("FATAL: 找不到 State.BRIDGE_NAME")
    return m.group(1)


def start_server(web_dir: pathlib.Path):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, fmt, *a):
            pass

    httpd = socketserver.ThreadingTCPServer(
        ("127.0.0.1", 0), functools.partial(Quiet, directory=str(web_dir))
    )
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def main() -> int:
    shim_path = SHIM_DEFAULT
    web_dir = WEB_DEFAULT
    if not shim_path.is_file():
        print("ENV: 找不到 %s（先跑 tools/extract_shim.py）" % shim_path, file=sys.stderr)
        return 2
    if not (web_dir / "index.html").is_file():
        print("ENV: 找不到 %s/index.html" % web_dir, file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # noqa: BLE001
        print("ENV: playwright 不可用：%s" % e, file=sys.stderr)
        return 2

    bridge_name = read_bridge_name()
    shim_js = shim_path.read_text(encoding="utf-8")
    stub_js = STUB.replace("__BOTTLE_BRIDGE__", bridge_name)

    httpd, port = start_server(web_dir)
    url = "http://127.0.0.1:%d/index.html" % port

    results = []
    console_errors = []
    observed = {}

    def scenario(browser, kind):
        ctx = browser.new_context()
        page = ctx.new_page()
        page.on(
            "console",
            lambda m: console_errors.append((kind, m.text))
            if m.type == "error" and m.text.lstrip().startswith("[bottle]")
            else None,
        )
        page.add_init_script(stub_js)
        page.add_init_script(shim_js)
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)  # 等 loadData 把 settings 落齐

        if kind == "pomodoro":
            page.evaluate("window.startPomodoro && window.startPomodoro()")
        else:
            page.click("#freeModeBtn")
            page.wait_for_timeout(300)
            if kind == "flowtime":
                page.click("#ftsFlowtime")
                page.wait_for_timeout(300)
            page.click("#btnStart")
        page.wait_for_timeout(2500)

        reports = page.evaluate(REPORTS)
        state = page.evaluate(STATE)
        ctx.close()
        return reports, state

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            for kind in ("pomodoro", "stopwatch", "flowtime"):
                observed[kind] = scenario(browser, kind)
            browser.close()
    except Exception as e:  # noqa: BLE001
        print("ENV: 浏览器/驱动不可用：%s" % e, file=sys.stderr)
        return 2
    finally:
        httpd.shutdown()

    # ---- 断言 ----
    for kind, (reports, state) in observed.items():
        print("\n[%s] 网页状态: mode=%r freeType=%r running=%r endAt=%r startTime=%r"
              % (kind, state.get("mode"), state.get("freeType"),
                 state.get("running"), state.get("endAt"), state.get("startTime")))
        for r in reports:
            print("    report: %r" % (r,))

    # 1) 冷启动回归：设置未就绪时不许上报 notify=false
    initial_false = [
        (k, r) for k, (rs, _) in observed.items()
        for r in rs if r.get("notify") is False and r.get("running") is False
    ]
    results.append((
        "冷启动没有 notify=false 的伪上报（旧 shim 会误 disarm）",
        len(initial_false) == 0,
        "count=%d sample=%r" % (len(initial_false), initial_false[:2]),
    ))

    # 2) 三种模式的最后一条上报必须与网页状态一致
    for kind, expect_mode, expect_free in (
        ("pomodoro", "focus", ""),
        ("stopwatch", "free", "stopwatch"),
        ("flowtime", "free", "flowtime"),
    ):
        reports, state = observed[kind]
        last = reports[-1] if reports else {}
        ok = (
            last.get("mode") == expect_mode
            and last.get("freeType") == expect_free
            and last.get("running") is True
            and last.get("notify") is True
            and last.get("bgPause") is False
        )
        if kind == "stopwatch":
            ok = ok and last.get("endAt", -1) == 0 and last.get("startTime", 0) > 0
        else:
            ok = ok and last.get("endAt", 0) > 0
        results.append((
            "%s 上报字段正确（原生据此决定 Arm / CountUp）" % kind,
            ok,
            "last=%r" % (last,),
        ))

    # 3) bgPause 的实际取值（本轮分析的关键事实之一）
    bg_values = sorted({r.get("bgPause") for _, (rs, _) in observed.items() for r in rs})
    results.append((
        "bgPause 默认是 false（网页 defaultSettings 里没有这个字段 → !!undefined）",
        bg_values == [False],
        "values=%r" % (bg_values,),
    ))

    results.append((
        "没有 [bottle] 开头的 console.error",
        len(console_errors) == 0,
        "count=%d %r" % (len(console_errors), console_errors[:3]),
    ))

    print("\n--- %d 条断言 ---" % len(results))
    failed = 0
    for desc, ok, detail in results:
        print("%s  %s   [%s]" % ("PASS" if ok else "FAIL", desc, detail))
        failed += 0 if ok else 1

    print("\n===== timer.report: %d 通过 · %d 失败 =====" % (len(results) - failed, failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
