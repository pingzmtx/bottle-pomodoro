#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bug 1 触发链的真页实测：**暂停（打断）→ 继续** 后 endAt 变、startTime 不变。

为什么需要它：
Bug 1（小窗越走越快）的闸门是「会话键相同 → 再比 endAt」。会话键是**粘性键**
（`SessionKey`：`<mode>#<seq>`，只在真结束时才清），所以暂停→继续这一路
**键一定不变**，能不能修好完全取决于"网页有没有重算 endAt"。
这个事实只在真实网页里成立，静态读代码只能看到一行 `endAt=Date.now()+pausedRemaining*1000`。

真页现状（本脚本会断言）：
  · 番茄的暂停不是"暂停按钮"（btnStart 在专注中 disabled），而是「打断」：
    `interruptPomodoro()` 把 `pausedRemaining=remaining`，`running=false`，**不动 startTime**；
  · 继续 `resumeFromInterrupt()` 重算 `endAt = now + pausedRemaining*1000`，仍**不动 startTime**。

断言：
  1. 暂停帧：running=false / paused=true / endAt 保留 / startTime 不变（原生据此 disarm）
  2. 继续帧：endAt 变大、startTime 不变（→ 粘性键不变 → 必然走 retune 闸门）
  3. 继续帧真的被 shim 发出（上报链路没有把这次变化吃掉）

用法：python3 app/tools/qa_bug1_resume.py
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
})();
"""

REPORTS = "() => (window.__qaLog || []).filter(m => m.cmd === 'timer.report').map(m => m.payload)"
STATE = """() => { const t = window.timerState || {};
  return { mode: t.mode, running: !!t.running, endAt: +t.endAt || 0, startTime: +t.startTime || 0 }; }"""


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

    running_state = paused_state = resumed_state = {}
    reports = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            ctx = browser.new_context()
            page = ctx.new_page()
            page.add_init_script(stub_js)
            page.add_init_script(shim_js)
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)  # 等 appData.settings 落齐（不然 shim 不上报）

            page.evaluate("window.startPomodoro()")
            page.wait_for_timeout(1800)
            running_state = page.evaluate(STATE)

            page.evaluate("window.interruptPomodoro()")   # 暂停（打断）
            page.wait_for_timeout(2500)
            paused_state = page.evaluate(STATE)

            page.evaluate("window.resumeFromInterrupt()")  # 继续
            page.wait_for_timeout(1800)
            resumed_state = page.evaluate(STATE)

            reports = page.evaluate(REPORTS)
            ctx.close()
            browser.close()
    except Exception as e:  # noqa: BLE001
        print("ENV: 浏览器/驱动不可用：%s" % e, file=sys.stderr)
        return 2
    finally:
        httpd.shutdown()

    print("--- 网页上报序列 ---")
    for r in reports:
        print("  running=%-5s paused=%-5s endAt=%s startTime=%s"
              % (r.get("running"), r.get("paused"), r.get("endAt"), r.get("startTime")))
    for label, st in (("running", running_state), ("paused", paused_state), ("resumed", resumed_state)):
        print("  %-7s %r" % (label, st))

    paused_reports = [r for r in reports if not r.get("running")]
    resumed_reports = [r for r in reports if r.get("running") and not r.get("paused")]

    results = [
        ("暂停帧被上报成 running=false / paused=true（原生据此 disarm + 撤小窗）",
         any(r.get("paused") is True and r.get("mode") == "focus" for r in paused_reports),
         "n_paused_reports=%d" % len(paused_reports)),
        ("暂停不动 startTime（粘性键不变）",
         paused_state.get("startTime") == running_state.get("startTime") > 0,
         "running=%s paused=%s" % (running_state.get("startTime"), paused_state.get("startTime"))),
        ("继续时 endAt 变大（网页重算终点）",
         resumed_state.get("endAt", 0) > paused_state.get("endAt", 0),
         "paused=%s resumed=%s" % (paused_state.get("endAt"), resumed_state.get("endAt"))),
        ("继续不动 startTime（键不变 → 必须走 retune 闸门，Bug 1 的入口）",
         resumed_state.get("startTime") == running_state.get("startTime") > 0,
         "running=%s resumed=%s" % (running_state.get("startTime"), resumed_state.get("startTime"))),
        ("新的 endAt 到达上报链路（shim 没吃掉这次变化）",
         any(r.get("endAt") == resumed_state.get("endAt") for r in resumed_reports),
         "n_resumed_reports=%d" % len(resumed_reports)),
    ]

    print("\n--- %d 条断言 ---" % len(results))
    failed = 0
    for name, ok, detail in results:
        print("%s  %s   [%s]" % ("PASS" if ok else "FAIL", name, detail))
        if not ok:
            failed += 1
    print("\n===== bug1-resume: %d 通过 · %d 失败 =====" % (len(results) - failed, failed))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
