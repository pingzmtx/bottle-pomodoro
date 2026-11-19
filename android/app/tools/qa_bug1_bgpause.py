#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bug 1 触发前提的真页实测：**bgPause 补 gap** 会改 endAt、不改 startTime。

为什么需要它：
Bug 1（小窗越走越快）的根因是「会话键没变、但时间基准变了」。会话键 = mode#startTime。
所以只有"网页改了 endAt 却没改 startTime"这条路，才会真的走到原生那条
`键同 → 比 endAt → retuneChronometer` 的闸门。这条事实在网页侧：
    assets/web/assets/app.js:  if (bgPause && _bgPausedAt && mode==='focus') endAt += gap*1000
本脚本在真页里把这条路径**跑一遍**，断言：
  1. 回前台后 endAt 变大（大约等于隐藏时长）
  2. startTime 完全没变（→ 原生会话键不变 → 必须靠 endAt 兜住，Bug 1 的入口成立）
  3. shim 把这次变化上报了（真实上报链路：可见性变化 → lastSig 清空 → 立刻 report）

用法：python3 app/tools/qa_bug1_bgpause.py
前置：python3 app/tools/extract_shim.py
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
      case 'hello': reply(m.id, { appVersion: '0.2.1-qa', webVersion: 'qa', sdk: 34 }); break;
      case 'notify.permission': reply(m.id, { state: 'granted' }); break;
      case 'notify.request': reply(m.id, { state: 'granted' }); break;
      case 'notify.show': reply(m.id, { shown: true, suppressed: false, tag: 'web-notify' }); break;
      case 'timer.report': reply(m.id, { armed: true, fireAt: p.endAt || 0 }); break;
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
  // 可见性开关：让"切后台→回前台"能在无头浏览器里被真实地走一遍
  window.__qaVisibility = 'visible';
  try {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true, get: function () { return window.__qaVisibility; }
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true, get: function () { return window.__qaVisibility === 'hidden'; }
    });
  } catch (e) { window.__qaVisError = String(e); }
})();
"""

REPORTS = "() => (window.__qaLog || []).filter(m => m.cmd === 'timer.report').map(m => m.payload)"
STATE = """() => { const t = window.timerState || {};
  return { mode: t.mode, running: !!t.running, endAt: +t.endAt || 0, startTime: +t.startTime || 0 }; }"""

SET_BGPAUSE = """() => {
  window.appData.settings.bgPause = true;
  const cb = document.getElementById('setBgPause');
  if (cb) { cb.checked = true; }
  return window.appData.settings.bgPause;
}"""

GO_HIDDEN = """() => {
  window.__qaVisibility = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  return document.visibilityState;
}"""

GO_VISIBLE = """() => {
  window.__qaVisibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  return document.visibilityState;
}"""


def read_bridge_name():
    m = re.search(r'BRIDGE_NAME\s*=\s*"([^"]+)"', STATE_KT.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("FATAL: 找不到 State.BRIDGE_NAME")
    return m.group(1)


def start_server(web_dir):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, fmt, *a):
            pass

    httpd = socketserver.ThreadingTCPServer(
        ("127.0.0.1", 0), functools.partial(Quiet, directory=str(web_dir))
    )
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def main():
    if not SHIM_DEFAULT.is_file():
        print("ENV: 找不到 %s（先跑 extract_shim.py）" % SHIM_DEFAULT, file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # noqa: BLE001
        print("ENV: playwright 不可用：%s" % e, file=sys.stderr)
        return 2

    stub_js = STUB.replace("__BOTTLE_BRIDGE__", read_bridge_name())
    shim_js = SHIM_DEFAULT.read_text(encoding="utf-8")
    httpd, port = start_server(WEB_DEFAULT)
    url = "http://127.0.0.1:%d/index.html" % port

    before = after = {}
    reports = []
    reports_before_hide = 0
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context()
            page = ctx.new_page()
            page.add_init_script(stub_js)
            page.add_init_script(shim_js)
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)

            page.evaluate(SET_BGPAUSE)
            page.evaluate("window.startPomodoro()")
            page.wait_for_timeout(2000)
            before = page.evaluate(STATE)
            reports_before_hide = len(page.evaluate(REPORTS))

            print("  visibilityState 覆写:", page.evaluate("() => document.visibilityState"))
            page.evaluate(GO_HIDDEN)
            page.wait_for_timeout(3000)   # 后台 3 秒
            page.evaluate(GO_VISIBLE)
            page.wait_for_timeout(1500)

            after = page.evaluate(STATE)
            reports = page.evaluate(REPORTS)
            ctx.close()
            browser.close()
    except Exception as e:  # noqa: BLE001
        print("ENV: 浏览器/驱动不可用：%s" % e, file=sys.stderr)
        return 2
    finally:
        httpd.shutdown()

    print("\n--- 上报序列（只打 endAt/startTime/running）---")
    for r in reports:
        print("  running=%-5s paused=%-5s endAt=%s startTime=%s"
              % (r.get("running"), r.get("paused"), r.get("endAt"), r.get("startTime")))
    print("\n  before: %r" % (before,))
    print("  after : %r" % (after,))
    print("  切后台前的上报条数=%d，之后=%d" % (reports_before_hide, len(reports)))

    gap = (after.get("endAt", 0) - before.get("endAt", 0))
    results = [
        ("回前台后 endAt 被补了 gap（≈隐藏时长，允许 1s 误差）",
         2000 <= gap <= 5500, "delta=%dms" % gap),
        ("startTime 完全没变（会话键不变 → Bug 1 的入口成立）",
         after.get("startTime") == before.get("startTime") and before.get("startTime", 0) > 0,
         "before=%s after=%s" % (before.get("startTime"), after.get("startTime"))),
        ("这次基准变化被 shim 上报了（new endAt 到达原生）",
         any(r.get("endAt") == after.get("endAt") for r in reports),
         "n_reports=%d" % len(reports)),
    ]

    print("\n--- %d 条断言 ---" % len(results))
    failed = 0
    for name, ok, detail in results:
        print("%s  %s   [%s]" % ("PASS" if ok else "FAIL", name, detail))
        if not ok:
            failed += 1
    print("\n===== bug1-bgpause: %d 通过 · %d 失败 =====" % (len(results) - failed, failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
