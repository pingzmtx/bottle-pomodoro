#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""shim 注入实测：把 Shim.kt 里那段 JS 真的塞进真页面里跑一遍。

为什么必须有这一步（P1-2）：
静态 grep 只能证明"字符串里出现过 switchView"，证明不了那段代码被执行过 ——
P0 就是这样漏掉的（`if (window.__bottleHost) return;` 恒真，200 行全是死代码，
而 verify.sh 的 32 条 grep 全绿）。这里在真实页面里注入真实 JS，用可观测事实判定。

两个模式（互补，各自 5 条断言）：

  --mode bridge（默认）真机形态：先装桥桩，**保留** Chromium 自带的 Notification。
      这一组专门证明 P1-3：即使 WebView 自带 Notification，shim 也照样接管
      （旧的 `if (!('Notification' in window))` 写法在这个场景下会主动弃权）。

  --mode nobridge      降级形态：不装桥，并且删掉 Notification / wakeLock
      （模拟 WEB_FACTS 记录的 Android WebView 事实：这两者在 WebView 里都没有）。
      这一组专门证明 P0 的降级要求：无桥也**不许整体 return** ——
      Notification 仍接管、wakeLock 仍返回 resolved promise、__bottleBack 仍存在且能退、
      且只许 warn 不许 error。

退出码：0 = 5 条全 PASS；1 = 有用例 FAIL；2 = 环境/参数问题（verify.sh 按 WARN 处理）。

用法：
    python3 app/tools/extract_shim.py
    python3 app/tools/inject_test.py                 # 真机形态
    python3 app/tools/inject_test.py --mode nobridge # 降级形态
"""
import argparse
import functools
import http.server
import pathlib
import re
import socketserver
import sys
import threading

HERE = pathlib.Path(__file__).resolve()
PROJECT_DIR = HERE.parents[2]                                # app/tools/x.py → bottle-android/
STATE_KT = PROJECT_DIR / "app/src/main/java/im/bottle/focus/State.kt"
SHIM_DEFAULT = PROJECT_DIR / "app/build/shim.js"
WEB_DEFAULT = PROJECT_DIR / "app/src/main/assets/web"

# 桥桩：只实现 shim 真正用到的两个方法（postMessage / addEventListener）。
# 回包同步派发完全合法 —— 真机上是异步的，shim 用 pending[id] 对账，两种时序都必须成立。
STUB_TMPL = """
(function () {
  'use strict';
  var listeners = [];
  var log = [];
  window.__qaLog = log;

  function reply(id, payload, ok) {
    var text = JSON.stringify({ v: 1, id: id, ok: (ok !== false), payload: payload || {} });
    var ev = { type: 'message', data: text };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](ev); } catch (e) { /* 被测代码的回调异常不该炸桥桩 */ }
    }
  }

  function handle(raw) {
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    log.push({ cmd: m.cmd, payload: m.payload || {} });
    var p = m.payload || {};
    switch (m.cmd) {
      case 'hello': reply(m.id, { appVersion: '0.1.0-qa', webVersion: 'qa', sdk: 34 }); break;
      case 'notify.permission': reply(m.id, { state: 'granted' }); break;
      case 'notify.request': reply(m.id, { state: 'granted' }); break;
      case 'notify.show': reply(m.id, { shown: true, suppressed: false, tag: 'web-notify' }); break;
      case 'notify.cancel': reply(m.id, { cancelled: true }); break;
      case 'screen.wake': reply(m.id, { on: !!p.on }); break;
      case 'timer.report': reply(m.id, { armed: true, fireAt: p.endAt || 0 }); break;
      case 'device.info': reply(m.id, { package: 'im.bottle.focus' }); break;
      default: reply(m.id, {}, false); break;
    }
  }

  window.__BOTTLE_BRIDGE__ = {
    postMessage: function (raw) { handle(raw); },
    addEventListener: function (type, fn) { if (type === 'message') { listeners.push(fn); } },
    removeEventListener: function (type, fn) {
      if (type !== 'message') { return; }
      var i = listeners.indexOf(fn);
      if (i >= 0) { listeners.splice(i, 1); }
    }
  };
})();
"""

# 降级形态的前置：把 Chromium 自带的 Notification / wakeLock 删掉，
# 复刻 Android WebView 的真实环境（WEB_FACTS：两者均未定义）。
PRELUDE_NO_NATIVE = """
try { delete window.Notification; } catch (e) {}
try { delete Navigator.prototype.wakeLock; } catch (e) {}
try { delete window.__qaLog; } catch (e) {}
window.__qaLog = [];
"""

# 页面 CSP 没开 unsafe-eval，wait_for_function 会被拦（QA 已踩过），所以手工轮询。
PROBE_TMPL = """
() => {
  var log = window.__qaLog || [];
  var notifType = typeof window.Notification;
  var notifNative = (notifType === 'function') &&
    (String(window.Notification).indexOf('[native code]') >= 0);
  var before = log.length;
  var inst = null, ctorThrew = '';
  try {
    inst = new window.Notification('qa-probe', { body: 'probe', tag: 'qa' });
  } catch (e) { ctorThrew = String(e); }
  var routed = log.slice(before).some(function (m) { return m.cmd === 'notify.show'; });
  var closeOk = false, closeThrew = '';
  try { if (inst && typeof inst.close === 'function') { inst.close(); closeOk = true; } }
  catch (e) { closeThrew = String(e); }
  var back = 'n/a';
  try { back = (typeof window.__bottleBack === 'function') ? window.__bottleBack() : 'missing'; }
  catch (e) { back = 'threw:' + String(e); }
  return {
    shim: (window.__bottleShimV1 === true),
    bridge: typeof window.__BOTTLE_BRIDGE__,
    notifType: notifType,
    notifNative: notifNative,
    notifRouted: routed,
    notifCtorThrew: ctorThrew,
    closeOk: closeOk,
    closeThrew: closeThrew,
    backType: typeof window.__bottleBack,
    backVerdict: back,
    wake: typeof (navigator.wakeLock || null),
    perm: (function () { try { return String(window.Notification.permission); } catch (e) { return 'threw'; } })(),
    reports: (window.__qaLog || []).filter(function (m) { return m.cmd === 'timer.report'; }).length,
    hello: (window.__bottleHello && typeof window.__bottleHello === 'object') ? 'set' : 'unset'
  };
}
"""

# wakeLock 必须"永远 resolve"：无桥时返回一个假的成功句柄，而不是 reject/undefined。
WAKE_PROBE = """
async () => {
  try {
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      return { ok: false, err: 'no request()' };
    }
    var s = await navigator.wakeLock.request('screen');
    var rel = null;
    try { rel = (s && typeof s.release === 'function') ? await s.release() : null; } catch (e) { rel = 'threw:' + e; }
    return { ok: !!s && s.released === false || !!s, hasRelease: !!(s && typeof s.release === 'function'), rel: String(rel) };
  } catch (e) { return { ok: false, err: String(e) }; }
}
"""


def read_bridge_name() -> str:
    """桥名只从 State.kt 读，测试里不写字面量。"""
    m = re.search(r'const\s+val\s+BRIDGE_NAME\s*=\s*"([^"]+)"', STATE_KT.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("FATAL: 找不到 State.BRIDGE_NAME")
    return m.group(1)


def start_server(web_dir: pathlib.Path):
    """起一个静音的本地 http 服务，端口由系统分配（避免和别的工具抢 8125）。"""

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, fmt, *a):  # 静音：输出只留断言
            pass

    handler = functools.partial(Quiet, directory=str(web_dir))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("bridge", "nobridge"), default="bridge")
    ap.add_argument("--shim", default=str(SHIM_DEFAULT))
    ap.add_argument("--web", default=str(WEB_DEFAULT))
    ap.add_argument("--timeout", type=float, default=20.0)
    args = ap.parse_args()

    shim_path = pathlib.Path(args.shim)
    web_dir = pathlib.Path(args.web)
    if not shim_path.is_file():
        print("ENV: 找不到 %s（先跑 tools/extract_shim.py）" % shim_path, file=sys.stderr)
        return 2
    if not (web_dir / "index.html").is_file():
        print("ENV: 找不到 %s/index.html" % web_dir, file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:                                    # noqa: BLE001
        print("ENV: playwright 不可用：%s" % e, file=sys.stderr)
        return 2

    bridge_name = read_bridge_name()
    shim_js = shim_path.read_text(encoding="utf-8")
    stub_js = STUB_TMPL.replace("__BOTTLE_BRIDGE__", bridge_name)
    probe_js = PROBE_TMPL.replace("__BOTTLE_BRIDGE__", bridge_name)

    httpd, port = start_server(web_dir)
    url = "http://127.0.0.1:%d/index.html" % port
    print("mode    : %s" % args.mode)
    print("serving : %s" % web_dir)
    print("shim    : %s (%d bytes)" % (shim_path, len(shim_js.encode("utf-8"))))
    print("bridge  : %s%s" % (bridge_name, "（本模式不装）" if args.mode == "nobridge" else ""))
    print("url     : %s" % url)

    console = []
    page_errors = []
    wake = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = browser.new_page()
            page.on("console", lambda m: console.append((m.type, m.text)))
            page.on("pageerror", lambda e: page_errors.append(str(e)))

            # 注入顺序必须与真机一致：先删原生能力（仅降级模式）→ 再装桥 → 最后注入 shim
            # （documentStart，早于任何页面脚本）。
            if args.mode == "nobridge":
                page.add_init_script(PRELUDE_NO_NATIVE)
            else:
                page.add_init_script(stub_js)
            page.add_init_script(shim_js)
            page.goto(url, wait_until="domcontentloaded")

            facts = {}
            waited = 0.0
            while waited < args.timeout:
                try:
                    facts = page.evaluate(probe_js)
                except Exception as e:                        # noqa: BLE001
                    facts = {"evalError": str(e)}
                if facts.get("shim") and facts.get("backType") == "function":
                    break
                page.wait_for_timeout(200)
                waited += 0.2
            try:
                wake = page.evaluate(WAKE_PROBE)
            except Exception as e:                            # noqa: BLE001
                wake = {"ok": False, "err": str(e)}
            browser.close()
    except Exception as e:                                    # noqa: BLE001
        # 浏览器/驱动本身起不来 = 环境问题，verify.sh 按 WARN 处理（退出码 2），
        # 与"断言 FAIL"（退出码 1）严格区分开 —— 环境缺失不该让验收变红。
        httpd.shutdown()
        print("ENV: 浏览器/驱动不可用：%s" % e, file=sys.stderr)
        return 2
    finally:
        httpd.shutdown()

    bottle_errors = [(t, x) for (t, x) in console if t == "error" and x.lstrip().startswith("[bottle]")]
    results = []

    if args.mode == "bridge":
        results.append((
            "__bottleShimV1 === true（shim 自证已安装）",
            facts.get("shim") is True,
            "shim=%r" % facts.get("shim"),
        ))
        results.append((
            "typeof " + bridge_name + " === 'object'（桥在）",
            facts.get("bridge") == "object",
            "bridge=%r" % facts.get("bridge"),
        ))
        # 比"typeof === 'function'"更严：原生 Notification 也是 function，
        # 只断 typeof 会让"shim 没接管"看起来像通过（这正是 P0 的漏检形态）。
        results.append((
            "Notification 是 function 且被 shim 接管（new 触发 notify.show）",
            facts.get("notifType") == "function"
            and facts.get("notifNative") is False
            and facts.get("notifRouted") is True,
            "type=%r native=%r routed=%r ctorThrew=%r"
            % (facts.get("notifType"), facts.get("notifNative"),
               facts.get("notifRouted"), facts.get("notifCtorThrew")),
        ))
        results.append((
            "typeof __bottleBack === 'function'（返回键有阶梯）",
            facts.get("backType") == "function",
            "type=%r verdict=%r" % (facts.get("backType"), facts.get("backVerdict")),
        ))
    else:
        results.append((
            "__bottleShimV1 === true（无桥也不许整体 return）",
            facts.get("shim") is True,
            "shim=%r" % facts.get("shim"),
        ))
        # 本模式已删掉原生 Notification，所以"是 function"就只能是我们装的；
        # 再加 `notifNative is False` 与"ctor 不抛"，把"接管"钉成可观测事实。
        results.append((
            "无桥时 Notification 仍被接管、ctor 不抛（不是 native）",
            facts.get("notifType") == "function"
            and facts.get("notifNative") is False
            and facts.get("notifCtorThrew") == "",
            "type=%r native=%r ctorThrew=%r"
            % (facts.get("notifType"), facts.get("notifNative"), facts.get("notifCtorThrew")),
        ))
        results.append((
            "无桥时 wakeLock.request() 返回 resolved 假句柄",
            wake.get("ok") is True,
            "wake=%r" % (wake,),
        ))
        results.append((
            "无桥时 __bottleBack 仍定义且返回 'exit'（返回键能退）",
            facts.get("backType") == "function" and facts.get("backVerdict") == "exit",
            "type=%r verdict=%r" % (facts.get("backType"), facts.get("backVerdict")),
        ))

    results.append((
        "无 [bottle] 开头的 console.error（降级只许 warn）",
        len(bottle_errors) == 0,
        "count=%d %r" % (len(bottle_errors), bottle_errors[:3]),
    ))

    print("\n--- 5 条断言 ---")
    passed = 0
    for desc, ok, detail in results:
        print("%s  %s   [%s]" % ("PASS" if ok else "FAIL", desc, detail))
        if ok:
            passed += 1

    print("\n--- 观测事实（不参与断言）---")
    if facts.get("evalError"):
        print("!! 探针本身报错（这条必须为 0）: %r" % facts.get("evalError"))
    print("Notification.permission : %r" % facts.get("perm"))
    print("n.close() 不抛           : closeOk=%r closeThrew=%r"
          % (facts.get("closeOk"), facts.get("closeThrew")))
    print("__bottleBack()           : %r" % facts.get("backVerdict"))
    print("navigator.wakeLock       : %r / probe=%r" % (facts.get("wake"), wake))
    print("timer.report 条数        : %r" % facts.get("reports"))
    print("__bottleHello            : %r" % facts.get("hello"))
    skips = [x for (t, x) in console if "no bridge, skip" in x]
    print("无桥 no-op 的 warning 数  : %d %r" % (len(skips), skips[:6]))
    print("console 消息数           : %d" % len(console))
    for t, x in console[:10]:
        print("  [%s] %s" % (t, x[:160]))
    print("pageerror 数             : %d" % len(page_errors))
    for e in page_errors[:5]:
        print("  %s" % e[:160])

    print("\n结果：%d/5 PASS（mode=%s）" % (passed, args.mode))
    if passed != len(results):
        print("IS_PASS: NO")
        return 1
    print("IS_PASS: YES")
    return 0


if __name__ == "__main__":
    sys.exit(main())
