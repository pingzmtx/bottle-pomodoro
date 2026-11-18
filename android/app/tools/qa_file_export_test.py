#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""QA 独立回归：导出分块完整性 + click 劫持副作用（真页面 + 真 shim）。

与 inject_test.py 的分工：
  inject_test.py  验 Notification / wakeLock / back / 降级（5 条）
  本文件          验 file.export.* 分块与 anchor.click 劫持的副作用（不重叠）

方法：把 Shim.kt 里那段 JS（app/build/shim.js，extract_shim.py 产出）注入真实
assets/web/index.html，桥桩**完整实现** file.export.* 并记录每一块，从而在真实
Blob / 真实 URL.createObjectURL / 真实 HTMLAnchorElement.prototype 上观察行为。

覆盖：
  C1 3000 条记录 JSON 分块 → 拼回 JSON.parse 与原对象深相等
  C2 代理对（emoji）正好压在 262144 边界 → 不许劈开，拼回一致
  C3 单块 ≤ CHUNK_CHARS(262144) 且 < MAX_CHUNK_CHARS(400000)
  C4 落盘字节数（UTF-8）与文本自洽
  H1 CSV(text/csv) 导出被拦截 → 检查实际发给原生的 mime（预期 'text/csv'）
  H2 <a href="#x"> 普通锚点透传（hash 变化）
  H3 input.click() 透传
  H4 <a href="https://..."> 外链透传（click 事件被派发）
  H5 <a href="tel:..."> 透传
  H6 <a download href="blob:"> 空 download 值 → 是否拦截（健壮性）
  H7 a.dispatchEvent(new MouseEvent('click')) → 是否拦截（旁路）
  H8 连点两次 → 记录发起几次 begin（客户端是否去重）

退出码：0 全 PASS；1 有 FAIL；2 环境问题。
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

CHUNK_CHARS = 262144
MAX_CHUNK_CHARS = 400000

STUB = r"""
(function () {
  'use strict';
  var listeners = [];
  var qa = window.__qa = {
    begin: [], chunk: [], end: [], abort: [],
    chunks: [], done: false, aborted: false
  };
  var sid = 'qa-session-1';

  function reply(id, payload, ok) {
    var text = JSON.stringify({ v: 1, id: id, ok: (ok !== false), payload: payload || {} });
    var ev = { type: 'message', data: text };
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](ev); } catch (e) {}
    }
  }

  function handle(raw) {
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    var p = m.payload || {};
    switch (m.cmd) {
      case 'hello': reply(m.id, { appVersion: '0.1.0-qa' }); break;
      case 'notify.permission': reply(m.id, { state: 'granted' }); break;
      case 'timer.report': reply(m.id, { armed: true, fireAt: 0 }); break;
      case 'screen.wake': reply(m.id, { on: !!p.on }); break;
      case 'file.export.begin':
        qa.begin.push({ name: p.name, mime: p.mime, total: p.total });
        reply(m.id, { saved: true, cancelled: false, sessionId: sid, name: p.name });
        break;
      case 'file.export.chunk':
        qa.chunk.push({ sessionId: p.sessionId, len: p.data.length });
        qa.chunks.push(p.data);
        reply(m.id, { bytes: p.data.length });
        break;
      case 'file.export.end':
        qa.end.push({ sessionId: p.sessionId });
        qa.done = true;
        reply(m.id, { saved: true, name: 'x', bytes: 1, uri: 'content://qa' });
        break;
      case 'file.export.abort':
        qa.abort.push({ sessionId: p.sessionId });
        qa.aborted = true; qa.done = true;
        reply(m.id, { aborted: true });
        break;
      default: reply(m.id, {}, false); break;
    }
  }

  window.__BOTTLE_BRIDGE__ = {
    postMessage: function (raw) { handle(raw); },
    addEventListener: function (type, fn) { if (type === 'message') { listeners.push(fn); } },
    removeEventListener: function (type, fn) {
      if (type !== 'message') { return; }
      var i = listeners.indexOf(fn); if (i >= 0) { listeners.splice(i, 1); }
    }
  };
})();
"""

# 每个用例前重置记录器
RESET = "() => { window.__qa.begin=[]; window.__qa.chunk=[]; window.__qa.chunks=[]; window.__qa.end=[]; window.__qa.abort=[]; window.__qa.done=false; window.__qa.aborted=false; window.__clickEvents=0; }"

# 记录"原生 click 是否真的被派发"：捕获阶段计数。
# 同时对 http(s)/tel/mailto/blob: 一律 preventDefault —— 只为让无头页面不被导航带走，
# 不影响被测事实：shim 若吞掉点击（早期 return），这个监听器根本不会触发。
CLICK_TRAP = """
() => {
  window.__clickEvents = 0;
  document.addEventListener('click', function (ev) {
    window.__clickEvents++;
    var t = ev.target;
    var a = (t && t.closest) ? t.closest('a') : null;
    if (a) {
      var h = a.getAttribute('href') || '';
      if (/^(https?:|tel:|mailto:|blob:)/i.test(h)) { ev.preventDefault(); }
    }
  }, true);
}
"""


def read_bridge_name() -> str:
    m = re.search(r'const\s+val\s+BRIDGE_NAME\s*=\s*"([^"]+)"', STATE_KT.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("FATAL: 找不到 State.BRIDGE_NAME")
    return m.group(1)


def start_server(web_dir: pathlib.Path):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, fmt, *a):
            pass

    handler = functools.partial(Quiet, directory=str(web_dir))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


# ---- 用例实现：都在页面里跑，返回结构化事实 ----

CASE_ROUNDTRIP = r"""
async (n) => {
  // 造 n 条记录，字段里混 emoji（代理对）与中文
  var recs = [];
  for (var i = 0; i < n; i++) {
    recs.push({ id: i, name: '番茄🍅第' + i + '个', note: '专注📚记录✨', ts: 1700000000000 + i });
  }
  var obj = { v: 1, exportedAt: '2025-01-01T00:00:00.000Z', records: recs };
  var text = JSON.stringify(obj, null, 2);

  var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'tomato_backup.json'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // 等 shim 的异步链（读 blob → begin → chunk*N → end）
  var waited = 0;
  while (!window.__qa.done && waited < 10000) { await new Promise(r => setTimeout(r, 50)); waited += 50; }

  var joined = window.__qa.chunks.join('');
  return {
    totalChars: text.length,
    chunks: window.__qa.chunk.length,
    chunkLens: window.__qa.chunk.map(function (c) { return c.len; }),
    joinedEqualsSource: joined === text,
    jsonParseOk: (function () { try { JSON.parse(joined); return true; } catch (e) { return String(e); } })(),
    deepEqual: (function () {
      try { return JSON.stringify(JSON.parse(joined)) === JSON.stringify(obj); } catch (e) { return false; }
    })(),
    bytesUtf8Joined: new TextEncoder().encode(joined).length,
    bytesUtf8Source: new TextEncoder().encode(text).length,
    firstCharCode: joined.length ? joined.charCodeAt(0) : -1,
    done: window.__qa.done,
    aborted: window.__qa.aborted
  };
}
"""

CASE_BOUNDARY = r"""
async () => {
  // 让一个 emoji（高代理 0xD83C）正好落在 CHUNK_CHARS-1 的位置：
  // 若不回退，第一块会以孤立高代理结尾 → UTF-8 编码成 U+FFFD，JSON 就坏了。
  var CH = 262144;
  var emoji = '\uD83C\uDF45'; // 🍅
  var prefix = 'a'.repeat(CH - 1);         // 长度 262143，末位 index 262142
  var text = prefix + emoji + 'b'.repeat(500);  // emoji 高代理在 index 262143
  var json = JSON.stringify({ payload: text });

  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'b.json';
  document.body.appendChild(a);
  a.click();
  a.remove();

  var waited = 0;
  while (!window.__qa.done && waited < 10000) { await new Promise(r => setTimeout(r, 50)); waited += 50; }

  var joined = window.__qa.chunks.join('');
  var lastChunk0 = window.__qa.chunks.length ? window.__qa.chunks[0] : '';
  var lastCode = lastChunk0.length ? lastChunk0.charCodeAt(lastChunk0.length - 1) : -1;
  // 逐块检查：任何一块的末位都不能是高代理
  var brokenBoundary = [];
  for (var i = 0; i < window.__qa.chunks.length - 1; i++) {
    var c = window.__qa.chunks[i];
    var code = c.charCodeAt(c.length - 1);
    if (code >= 0xD800 && code <= 0xDBFF) { brokenBoundary.push(i); }
  }
  return {
    jsonLen: json.length,
    chunks: window.__qa.chunk.length,
    chunkLens: window.__qa.chunk.map(function (c) { return c.len; }),
    firstChunkEndCode: lastCode,
    firstChunkEndIsHighSurrogate: (lastCode >= 0xD800 && lastCode <= 0xDBFF),
    brokenBoundaries: brokenBoundary,
    joinedEqualsSource: joined === json,
    jsonParseOk: (function () { try { JSON.parse(joined); return true; } catch (e) { return String(e); } })(),
    hasReplacementChar: joined.indexOf('\uFFFD') >= 0,
    done: window.__qa.done
  };
}
"""

CASE_CSV = r"""
async () => {
  var csv = '\ufeff' + '日期,时长,任务\r\n2025-01-01,25,写代码\r\n';
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '瓶子专注_专注记录_2025-01-01.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();

  var waited = 0;
  while (!window.__qa.done && waited < 10000) { await new Promise(r => setTimeout(r, 50)); waited += 50; }

  var joined = window.__qa.chunks.join('');
  return {
    intercepted: window.__qa.begin.length > 0,
    beginCount: window.__qa.begin.length,
    mimeSentToNative: window.__qa.begin.length ? window.__qa.begin[0].mime : null,
    nameSentToNative: window.__qa.begin.length ? window.__qa.begin[0].name : null,
    contentRoundTrip: joined === csv,
    done: window.__qa.done
  };
}
"""

CASE_HASH = r"""
async () => {
  var a = document.createElement('a');
  a.href = '#qa-anchor-target';
  document.body.appendChild(a);
  var before = location.hash;
  a.click();
  a.remove();
  await new Promise(r => setTimeout(r, 100));
  return { before: before, after: location.hash, clickEvents: window.__clickEvents,
           intercepted: window.__qa.begin.length > 0 };
}
"""

CASE_INPUT = r"""
async () => {
  var inp = document.createElement('input');
  inp.type = 'button';   // 避免 file 类型在无头环境弹选择器
  var fired = 0;
  inp.addEventListener('click', function () { fired++; });
  document.body.appendChild(inp);
  inp.click();
  inp.remove();
  await new Promise(r => setTimeout(r, 100));
  return { fired: fired, clickEvents: window.__clickEvents,
           intercepted: window.__qa.begin.length > 0 };
}
"""

CASE_EXTERNAL = r"""
async () => {
  var a = document.createElement('a');
  a.href = 'https://example.com/some/path';
  document.body.appendChild(a);
  a.click();
  a.remove();
  await new Promise(r => setTimeout(r, 150));
  return { clickEvents: window.__clickEvents, intercepted: window.__qa.begin.length > 0,
           url: location.href };
}
"""

CASE_TEL = r"""
async () => {
  var a = document.createElement('a');
  a.href = 'tel:10086';
  document.body.appendChild(a);
  a.click();
  a.remove();
  await new Promise(r => setTimeout(r, 100));
  return { clickEvents: window.__clickEvents, intercepted: window.__qa.begin.length > 0 };
}
"""

CASE_EMPTY_DOWNLOAD = r"""
async () => {
  var blob = new Blob(['hello'], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.setAttribute('download', '');   // 有空 download 属性，但没有文件名
  document.body.appendChild(a);
  a.click();
  a.remove();
  await new Promise(r => setTimeout(r, 300));
  return { download: String(a.download), intercepted: window.__qa.begin.length > 0,
           clickEvents: window.__clickEvents };
}
"""

CASE_DISPATCH_BYPASS = r"""
async () => {
  var blob = new Blob(['{"x":1}'], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bypass.json';
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  a.remove();
  await new Promise(r => setTimeout(r, 300));
  return { intercepted: window.__qa.begin.length > 0, clickEvents: window.__clickEvents };
}
"""

CASE_DOUBLE_CLICK = r"""
async () => {
  function once() {
    var blob = new Blob(['{"d":1}'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  once(); once();   // 同一 tick 连点两次
  await new Promise(r => setTimeout(r, 500));
  return { beginCount: window.__qa.begin.length, name: window.__qa.begin.map(function (b) { return b.name; }) };
}
"""


def main() -> int:
    shim_path = pathlib.Path(SHIM_DEFAULT)
    web_dir = pathlib.Path(WEB_DEFAULT)
    if not shim_path.is_file():
        print("ENV: 找不到 %s" % shim_path, file=sys.stderr)
        return 2
    if not (web_dir / "index.html").is_file():
        print("ENV: 找不到 index.html", file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # noqa: BLE001
        print("ENV: playwright 不可用：%s" % e, file=sys.stderr)
        return 2

    bridge = read_bridge_name()
    shim_js = shim_path.read_text(encoding="utf-8")
    stub_js = STUB.replace("__BOTTLE_BRIDGE__", bridge)

    httpd, port = start_server(web_dir)
    url = "http://127.0.0.1:%d/index.html" % port

    results = {}
    passed = failed = boundary_n = 0

    def boundary(name, detail):
        nonlocal boundary_n
        boundary_n += 1
        print("  \033[33mBOUNDARY\033[0m %-38s %s" % (name, detail))

    def check(name, cond, detail):
        nonlocal passed, failed
        if cond:
            passed += 1
            print("  \033[32mPASS\033[0m %-42s %s" % (name, detail))
        else:
            failed += 1
            print("  \033[31mFAIL\033[0m %-42s %s" % (name, detail))

    print("serving : %s" % web_dir)
    print("shim    : %s (%d bytes)" % (shim_path, len(shim_js.encode())))
    print("bridge  : %s" % bridge)
    print("url     : %s\n" % url)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = browser.new_page()
            console = []
            page.on("console", lambda m: console.append((m.type, m.text)))
            page.add_init_script(stub_js)
            page.add_init_script(shim_js)
            page.goto(url, wait_until="domcontentloaded")
            page.evaluate(CLICK_TRAP)

            # ---------- C: 分块完整性 ----------
            print("[C] 导出分块完整性（真 Blob / 真 shim）")
            page.evaluate(RESET)
            r = page.evaluate(CASE_ROUNDTRIP, 3000)
            results["C1"] = r
            check("C1 3000 条记录拼回与原文一致", r["joinedEqualsSource"], "chunks=%d lens=%s" % (r["chunks"], r["chunkLens"]))
            check("C1b JSON.parse 成功且深相等", (r["jsonParseOk"] is True) and r["deepEqual"], "parse=%s" % (r["jsonParseOk"],))
            check("C1c 全流程 end 到达", r["done"] and not r["aborted"], "done=%s" % r["done"])

            page.evaluate(RESET)
            b = page.evaluate(CASE_BOUNDARY)
            results["C2"] = b
            check("C2 emoji 压在边界不被劈开", not b["firstChunkEndIsHighSurrogate"] and b["brokenBoundaries"] == [],
                  "firstChunkEndCode=0x%X broken=%s" % (b["firstChunkEndCode"], b["brokenBoundaries"]))
            check("C2b 拼回与原文逐字一致", b["joinedEqualsSource"] and (b["jsonParseOk"] is True), "jsonLen=%d" % b["jsonLen"])
            check("C2c 无 U+FFFD 替换字符", not b["hasReplacementChar"], "replacement=%s" % b["hasReplacementChar"])

            # 单块上限（用 C1 的实测块长）
            lens = r["chunkLens"]
            check("C3 单块 ≤ CHUNK_CHARS 且 < MAX_CHUNK_CHARS",
                  all(x <= CHUNK_CHARS for x in lens) and all(x < MAX_CHUNK_CHARS for x in lens),
                  "max=%d CHUNK=%d MAX=%d" % (max(lens) if lens else -1, CHUNK_CHARS, MAX_CHUNK_CHARS))

            check("C5 JSON 导出未被塞入 BOM",
                  r["firstCharCode"] != 0xFEFF and r["bytesUtf8Joined"] == r["bytesUtf8Source"],
                  "firstCharCode=0x%X" % r["firstCharCode"])

            check("C4 落盘字节数 = 源文本 UTF-8 字节数",
                  r["bytesUtf8Joined"] == r["bytesUtf8Source"],
                  "joined=%d source=%d totalChars=%d" % (r["bytesUtf8Joined"], r["bytesUtf8Source"], r["totalChars"]))

            # ---------- H: 劫持副作用 ----------
            print("\n[H] anchor.click 劫持的副作用")
            page.evaluate(RESET)
            c = page.evaluate(CASE_CSV)
            results["H1"] = c
            check("H1 CSV 被拦截", c["intercepted"], "begin=%d name=%s" % (c["beginCount"], c["nameSentToNative"]))
            check("H1b CSV 内容无损（含 BOM 保留）", c["contentRoundTrip"],
                  "BOM=%s" % ("kept" if c["contentRoundTrip"] else "LOST"))
            check("H1c CSV 的 mime 正确传递", c["mimeSentToNative"] == "text/csv",
                  "mime=%r" % (c["mimeSentToNative"],))

            page.evaluate(RESET)
            h = page.evaluate(CASE_HASH)
            results["H2"] = h
            check("H2 普通锚点透传（hash 变化）", h["clickEvents"] > 0 and h["after"] != h["before"],
                  "before=%r after=%r" % (h["before"], h["after"]))

            page.evaluate(RESET)
            i = page.evaluate(CASE_INPUT)
            results["H3"] = i
            check("H3 input.click() 透传", i["fired"] == 1, "fired=%d" % i["fired"])

            page.evaluate(RESET)
            e = page.evaluate(CASE_EXTERNAL)
            results["H4"] = e
            check("H4 外链透传（click 已派发）", e["clickEvents"] > 0 and not e["intercepted"],
                  "clickEvents=%d" % e["clickEvents"])

            page.evaluate(RESET)
            t = page.evaluate(CASE_TEL)
            results["H5"] = t
            check("H5 tel: 透传", t["clickEvents"] > 0 and not t["intercepted"], "clickEvents=%d" % t["clickEvents"])

            page.evaluate(RESET)
            d = page.evaluate(CASE_EMPTY_DOWNLOAD)
            results["H6"] = d
            boundary("H6 <a download=\"\"> 空文件名",
                     "intercepted=%s → 设计边界：只接有文件名的下载，现网 5 处导出都显式命名"
                     % d["intercepted"])

            page.evaluate(RESET)
            y = page.evaluate(CASE_DISPATCH_BYPASS)
            results["H7"] = y
            boundary("H7 dispatchEvent 旁路",
                     "intercepted=%s → 设计边界：只包 prototype.click，现网全部走 .click()"
                     % y["intercepted"])

            page.evaluate(RESET)
            z = page.evaluate(CASE_DOUBLE_CLICK)
            results["H8"] = z
            boundary("H8 连点两次的 begin 数",
                     "beginCount=%d → 客户端不去重，由宿主闸门拒绝（见状态机 S8）" % z["beginCount"])

            browser.close()

    finally:
        httpd.shutdown()

    print("\nconsole 尾部：")
    for t, m in console[-6:]:
        print("   [%s] %s" % (t, m[:150]))

    print("\n===== 结果：%d 通过 · %d 失败 · %d 已知设计边界 =====" % (passed, failed, boundary_n))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
