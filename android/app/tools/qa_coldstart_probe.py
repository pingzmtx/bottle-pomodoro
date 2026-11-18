#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""冷启动首帧上报时序实测：恢复中的计时会不会先被上报成 idle/running=false？"""
import functools
import http.server
import pathlib
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve()
PROJECT = HERE.parents[2]
SHIM = PROJECT / "app/build/shim.js"
WEB = PROJECT / "app/src/main/assets/web"

STUB = """
(function () {
  'use strict';
  var listeners = [];
  window.__qaLog = [];
  window.__qaT0 = Date.now();
  function reply(id, payload) {
    var ev = { type: 'message', data: JSON.stringify({ v: 1, id: id, ok: true, payload: payload || {} }) };
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](ev); } catch (e) {} }
  }
  function handle(raw) {
    var m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.cmd === 'timer.report') {
      window.__qaLog.push({ dt: Date.now() - window.__qaT0, p: m.payload });
    }
    var p = m.payload || {};
    switch (m.cmd) {
      case 'hello': reply(m.id, { appVersion: '0.1.1-qa' }); break;
      case 'notify.permission': reply(m.id, { state: 'granted' }); break;
      case 'timer.report': reply(m.id, { armed: false, reason: 'qa-stub' }); break;
      default: reply(m.id, {});
    }
  }
  window.__bottleHost = {
    postMessage: handle,
    addEventListener: function (t, fn) { if (t === 'message') listeners.push(fn); },
    removeEventListener: function () {}
  };
})();
"""


def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(WEB)))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def main():
    httpd, port = serve()
    url = "http://127.0.0.1:%d/index.html" % port
    shim = SHIM.read_text(encoding="utf-8")
    out = {}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            for kind in ("stopwatch", "pomodoro"):
                ctx = b.new_context()
                pg = ctx.new_page()
                pg.add_init_script(STUB)
                pg.add_init_script(shim)
                pg.goto(url, wait_until="domcontentloaded")
                pg.wait_for_timeout(2600)
                if kind == "pomodoro":
                    pg.evaluate("window.startPomodoro && window.startPomodoro()")
                else:
                    pg.click("#freeModeBtn")
                    pg.wait_for_timeout(250)
                    pg.click("#btnStart")
                pg.wait_for_timeout(2600)
                before = pg.evaluate("() => (window.__qaLog||[]).slice(-2)")
                # 冷启动：整页重新加载（同 origin，localStorage 里已有快照）
                pg.reload(wait_until="domcontentloaded")
                pg.wait_for_timeout(3500)
                after = pg.evaluate("() => (window.__qaLog||[])")
                state = pg.evaluate(
                    "() => { var t=window.timerState||{}; return {mode:t.mode,freeType:t.freeType,running:!!t.running,endAt:+t.endAt||0}; }"
                )
                out[kind] = (before, after, state)
                ctx.close()
            b.close()
    finally:
        httpd.shutdown()

    for kind, (before, after, state) in out.items():
        print("\n===== %s =====" % kind)
        print("重启前最后 2 帧:")
        for r in before:
            print("   +%5dms  running=%r mode=%r freeType=%r" % (r["dt"], r["p"].get("running"), r["p"].get("mode"), r["p"].get("freeType")))
        print("重启后全部上报帧（+ms 相对 document start）:")
        for r in after:
            print("   +%5dms  running=%r mode=%r freeType=%r notify=%r endAt=%r" % (
                r["dt"], r["p"].get("running"), r["p"].get("mode"), r["p"].get("freeType"),
                r["p"].get("notify"), r["p"].get("endAt")))
        print("恢复后网页状态:", state)
        bad = [r for r in after if r["p"].get("running") is False and r["p"].get("notify") is True]
        print("★ 首帧 disarm 帧数量 =", len(bad), "(>0 即冷启动会先 disarm 再 arm)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
