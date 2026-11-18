#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""会话键的**真页面**实测：把网页真实上报的 timer.report 帧回放进线上那份 decide()。

## 为什么这个脚本存在

0.1.2 用 `mode#startTime` 现算会话键，前提是"暂停→继续时网页不改 startTime"。
那是**猜的**。真页面实测（本脚本第 1 段输出）把它否掉了：

    模式        start            paused           resumed
    pomodoro    1795033891686    同               同                （稳）
    stopwatch   1795033898743    同               1795033901459     （被重写）
    flowtime    1795033906043    同               1795033908758     （被重写）

自由专注是正计时，"已过时间"就是 `now - startTime`；继续的那一刻必须把它重写成当前时刻。
所以会话键**不能**从单帧现算 —— 现在由原生维护粘性键（SessionKey.decide）。

本脚本做两件事：
  1. 录下真页面 start → 暂停 → 继续 → 结束 → 再开一场 的**全部**上报帧；
  2. 把这些帧写成 TSV，交给 `qa_sessionkey.sh <file>` 用**线上同一份 SessionKey.kt** 回放，
     断言：同一场里键不变、整段只有一个键、结束后键被清、新一场键不同。

退出码：0 = 全过；1 = 有用例 FAIL；2 = 环境不可用（playwright / 页面起不来）。
用法：python3 app/tools/qa_sessionkey_live.py
"""
import functools
import http.server
import pathlib
import socketserver
import subprocess
import sys
import tempfile
import threading

HERE = pathlib.Path(__file__).resolve()
PROJECT = HERE.parents[2]
SHIM = PROJECT / "app/build/shim.js"
WEB = PROJECT / "app/src/main/assets/web"
RUNNER = PROJECT / "app/tools/qa_sessionkey.sh"

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
    if (m.cmd === 'timer.report') { window.__qaLog.push(m.payload); }
    switch (m.cmd) {
      case 'hello': reply(m.id, { appVersion: 'qa' }); break;
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

STATE = ("() => { var t = window.timerState || {};"
         " return {mode:t.mode, freeType:t.freeType, running:!!t.running,"
         " startTime:+t.startTime||0, endAt:+t.endAt||0}; }")

REPORTS = "() => (window.__qaLog || []).slice()"


def serve():
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    httpd = socketserver.ThreadingTCPServer(
        ("127.0.0.1", 0), functools.partial(Q, directory=str(WEB))
    )
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def enter_free_mode(pg, kind):
    """确保处在"自由专注 + 指定类型"的面板里（结束后网页可能已经回到番茄页）。"""
    on = pg.evaluate("() => document.getElementById('freeModeBtn').classList.contains('on')")
    if not on:
        pg.click("#freeModeBtn")
        pg.wait_for_timeout(300)
    if kind == "flowtime":
        pg.click("#ftsFlowtime")
        pg.wait_for_timeout(300)


def start_session(pg, kind):
    if kind == "pomodoro":
        pg.evaluate("window.startPomodoro && window.startPomodoro()")
    else:
        enter_free_mode(pg, kind)
        pg.click("#btnStart")
    pg.wait_for_timeout(1700)


def pause_session(pg):
    """自由专注的暂停就是再点一次 `#btnStart`（番茄没有暂停按钮，不走这里）。"""
    pg.click("#btnStart")
    pg.wait_for_timeout(1200)


def finish_session(pg):
    """结束这一场。番茄会弹 `#finishModal`（要选番茄类型），不关掉它后面的点击全被挡。"""
    pg.click("#btnFinish")
    pg.wait_for_timeout(1500)
    if pg.is_visible("#finishModal"):
        pg.click('#finishModal [data-act="closeFinishModal"]')
        pg.wait_for_timeout(600)


def record(browser, url, shim, kind):
    """录一场（含暂停/继续）+ 第二场，返回 (帧列表, 三次 startTime 采样)。"""
    ctx = browser.new_context()
    pg = ctx.new_page()
    pg.add_init_script(STUB)
    pg.add_init_script(shim)
    pg.goto(url, wait_until="domcontentloaded")
    pg.wait_for_timeout(2600)  # 等 loadData 把 timerState 落齐

    start_session(pg, kind)
    s_start = pg.evaluate(STATE)
    if kind == "pomodoro":
        # 番茄只是对照组：运行中 `#btnStart` 是 disabled（没有暂停/继续按钮），
        # 点「打断」会弹 `#interruptModal` 要选原因、结束会弹 `#finishModal` 要选番茄类型
        # 并自动接一段 shortBreak —— 那是"打断/结算/休息"流程，不是"暂停"流程。
        # 所以番茄这里只取一次 startTime（证明它本来就稳），
        # "暂停→继续键不变"由离线用例 ① 覆盖；回放只做两个自由专注模式。
        s_pause = s_start
        s_resume = s_start
        frames = pg.evaluate(REPORTS)
        ctx.close()
        return frames, (s_start, s_pause, s_resume)
    else:
        pause_session(pg)
        s_pause = pg.evaluate(STATE)
        pg.click("#btnStart")  # 继续
        pg.wait_for_timeout(1200)
        s_resume = pg.evaluate(STATE)
    finish_session(pg)

    # 第二场：证明"结束后再开一场"是新键
    start_session(pg, kind)
    finish_session(pg)

    frames = pg.evaluate(REPORTS)
    ctx.close()
    return frames, (s_start, s_pause, s_resume)


def main() -> int:
    if not SHIM.is_file():
        print("ENV: 找不到 %s（先跑 tools/extract_shim.py）" % SHIM, file=sys.stderr)
        return 2
    if not (WEB / "index.html").is_file():
        print("ENV: 找不到 %s/index.html" % WEB, file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # noqa: BLE001
        print("ENV: playwright 不可用：%s" % e, file=sys.stderr)
        return 2

    shim = SHIM.read_text(encoding="utf-8")
    httpd, port = serve()
    url = "http://127.0.0.1:%d/index.html" % port
    recorded = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            for kind in ("pomodoro", "stopwatch", "flowtime"):
                recorded[kind] = record(browser, url, shim, kind)
            browser.close()
    except Exception as e:  # noqa: BLE001
        # 页面操作失败也是真失败（不是环境问题）：不能悄悄降级成 WARN
        print("FAIL: 真页面操作失败：%s" % e)
        return 1
    finally:
        httpd.shutdown()

    fails = 0

    # ---- 1. 事实：自由专注在"继续"时必然重写 startTime ----
    print("===== 真页面事实：暂停→继续时 startTime 会不会变 =====")
    for kind, (frames, (a, b, c)) in recorded.items():
        drifted = a["startTime"] != c["startTime"]
        if kind == "pomodoro":
            print("  %-9s start=%d（番茄无暂停按钮，只验 startTime 一次性）"
                  % (kind, a["startTime"]))
            if a["startTime"] <= 0:
                print("  FAIL  %s 没有 startTime" % kind)
                fails += 1
            continue
        print("  %-9s start=%d pause=%d resume=%d  -> %s"
              % (kind, a["startTime"], b["startTime"], c["startTime"],
                 "被重写" if drifted else "不变"))
        if kind == "pomodoro" and drifted:
            print("  FAIL  pomodoro 本不该重写 startTime（说明网页行为变了）")
            fails += 1
        if kind != "pomodoro" and not drifted:
            print("  WARN  %s 这次没重写 startTime（真机仍可能重写，粘性键不依赖它）" % kind)
        if a["startTime"] <= 0:
            print("  FAIL  %s 没有 startTime" % kind)
            fails += 1
    print("  结论：键不能锚在 startTime 上（这就是粘性键要解决的问题）")

    # ---- 2. 回放：把真实帧喂给线上那份 SessionKey.decide ----
    print("\n===== 回放真帧（线上同一份 SessionKey.kt，期望 2 场计时）=====")
    # 只回放自由专注：它们的"继续"会重写 startTime（P1-A 的成因），番茄是稳定对照组。
    for kind in ("stopwatch", "flowtime"):
        frames = recorded[kind][0]
        if not frames:
            print("  FAIL  %s 没有录到任何 timer.report 帧" % kind)
            fails += 1
            continue
        lines = ["# %s: 真页面 开始/暂停/继续/结束/再开一场/再结束" % kind]
        for r in frames:
            lines.append("%s|%s|%s|%s|%s" % (
                r.get("mode", ""), r.get("freeType", ""),
                "true" if r.get("running") else "false",
                int(r.get("remaining") or 0), int(r.get("endAt") or 0),
            ))
        with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False,
                                         encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
            path = fh.name
        print("\n--- %s（%d 帧）---" % (kind, len(frames)))
        # 期望两个会话键（两场计时），回放器据此断言"键数恰好 2 且两键不同"
        out = subprocess.run(["bash", str(RUNNER), path, "2"], capture_output=True, text=True)
        if out.returncode == 2:
            print("  ENV: qa_sessionkey.sh 环境不可用")
            print(out.stdout)
            return 2
        for line in out.stdout.splitlines():
            if line.startswith(("frame", "PASS", "FAIL", "=====")):
                print("  " + line)
        if out.returncode != 0:
            fails += 1
            print("  FAIL  %s 回放断言失败（退出码 %d）" % (kind, out.returncode))
        pathlib.Path(path).unlink(missing_ok=True)

    print("\n===== 结果：%d 失败 =====" % fails)
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
