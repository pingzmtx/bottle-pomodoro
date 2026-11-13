#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
smoke_bridge.py —— 把 run_smoke.py 的断言接到「真机浏览器」上跑
======================================================================

为什么需要它
------------
smoke 的 99 条断言（以及 e2e）是本项目**唯一能抓「点击 / 渲染 / 状态」类回归**的网，
但它在无头 Chromium 上跑：某些沙箱（Android PRoot）里 chromium 装得上却起不来
（/dev/shm 建不了、SwANGLE/Vulkan 初始化失败），于是 verify.py 只能记 SKIP。

这里换一条路：**沙箱起 HTTP 桥，真机浏览器当执行器**。
    run_smoke.py --via browser
  → 本模块在沙箱里监听 :PORT
  → 人/agent 把（内置）浏览器导航到 http://127.0.0.1:PORT/
  → 页面里注入的客户端轮询取「要 eval 的表达式」，页面内执行，把结果回传
  → run_smoke.py 的 js(expr) 拿到值，99 条断言照常跑

传输协议（全部同源）
--------------------
  GET  /                  → 外壳页（内含 /app 的 iframe，宽度=视口宽度）
  GET  /app               → index.html 副本：CSP 放开 'unsafe-eval' + 注入客户端脚本
  GET  /__poll            → 长轮询，取一条待执行命令 {id, expr, reload}
  POST /__result          → 客户端回传 {id, ok, value|error}
  POST /__error           → 客户端上报真实未捕获异常（isTrusted，与 CDP 口径一致）
  POST /__attach          → 心跳，标记「浏览器已接入」

与 CDP 保真的三处约定（都在这里收口，别散到用例里）
--------------------------------------------------
1. **视口**：CDP 的 Emulation.setDeviceMetricsOverride 在这里 = 改 iframe 元素尺寸。
   套一层外壳页是为了这个——iframe 的 innerWidth 就等于它的元素宽度，
   于是「320px 下有没有横向溢出」这类断言仍然是真的量出来的，不是伪造的。
2. **页面重置**：用例大量使用 `localStorage.clear();location.reload()`。
   含 location.reload 的命令只等「已送达」不等结果（页面要没了），
   回传走 sendBeacon 以免被导航丢掉。
3. **CSP**：真机页面 CSP 是 `script-src 'unsafe-inline'`（无 unsafe-eval），
   eval 会被拦。桥**只对副本**加上 'unsafe-eval'，仓库里的 index.html 不动。

依赖：仅标准库。
"""
import json
import os
import re
import urllib.parse
import urllib.request
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 8790
DEFAULT_W, DEFAULT_H = 500, 1000


# 「全新 profile」等价物。为什么单开一页做：
#   应用自己会持有 IndexedDB 连接，此时 deleteDatabase 会被 blocked 而永远不完成；
#   从应用页里发删除请求，页面一 reload 请求就作废——所以必须在**应用还没起来**时删。
# 这一页只做：清 localStorage → 删所有 IndexedDB → 跳回 /app。
RESET_HTML = """<!doctype html><html><head><meta charset='utf-8'><title>reset</title></head>
<body style="font:14px sans-serif;padding:12px;color:#888">正在重置存储…</body>
<script>
(async function(){
  var log = [];
  try { localStorage.clear(); log.push('ls ok'); } catch(e){ log.push('ls fail'); }
  try {
    var names = [];
    if (indexedDB.databases) {
      var dbs = await indexedDB.databases();
      for (var i = 0; i < dbs.length; i++) if (dbs[i] && dbs[i].name) names.push(dbs[i].name);
    } else { names = ['tomato_focus_db']; }
    for (var j = 0; j < names.length; j++) {
      await new Promise(function(res){
        var q;
        try { q = indexedDB.deleteDatabase(names[j]); } catch(e){ return res(); }
        q.onsuccess = q.onerror = q.onblocked = function(){ res(); };
      });
      log.push('db:' + names[j]);
    }
  } catch(e){ log.push('idb fail'); }
  /* ★ 必须连 Service Worker 和它的缓存一起清：产物里 app.js/base/core/engine 是**固定文件名**
     （只有 CSS 带 hash），SW 是 cache-first，不清就会把上一轮的旧 app.js 喂给这一轮，
     表现是「新加的函数在用例里 undefined」——查半天代码，其实是缓存（2026-11-04 栽过）。 */
  try {
    if (window.caches) {
      var ks = await caches.keys();
      for (var m = 0; m < ks.length; m++) await caches.delete(ks[m]);
      log.push('caches:' + ks.length);
    }
  } catch(e){ log.push('caches fail'); }
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      var rs = await navigator.serviceWorker.getRegistrations();
      for (var r = 0; r < rs.length; r++) await rs[r].unregister();
      log.push('sw:' + rs.length);
    }
  } catch(e){ log.push('sw fail'); }
  // 给调用方一个**可验证的完成凭据**：nonce 由桥临时生成、经 ?n= 传进来。
  // 只靠「等页面重新接入」判完成不可靠——真机页面常处后台态，轮询被节流到 ~1s，
  // 旧文档退场与新文档接入在时序上分不开。cookie 同源共享、应用也不会动它。
  try {
    var n = (location.search.match(/[?&]n=([^&]+)/) || [])[1] || '1';
    document.cookie = '__smoke_reset=' + decodeURIComponent(n) + ';path=/';
  } catch(e){}
  document.body.textContent = 'reset done: ' + log.join(',');
  setTimeout(function(){ location.replace('/app'); }, 120);
})();
</script></html>"""


# 注入到 /app 副本里的客户端。只能在页面内（同源）跑，靠轮询拿命令。
CLIENT_JS = r"""
(function(){
  if (window.__SMOKE_BRIDGE__) return; window.__SMOKE_BRIDGE__ = 1;
  // 页面身份（sessionStorage：同一标签页 reload 后不变）。
  // 为什么必须有：/__poll 是先进先出队列，两个页面试过 -> 任务被瓜分，
  // 半页面 app 状态不对，一次全量跑出 40 条假失败。
  var CID;
  try {
    CID = sessionStorage.getItem('__smoke_cid');
    if (!CID) { CID = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('__smoke_cid', CID); }
  } catch (e) { CID = 'c' + Date.now(); }
  var STOPPED = false;
  function halt(why) {
    if (STOPPED) return;
    STOPPED = true;
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#c00;color:#fff;font:12px monospace;padding:6px';
    d.textContent = '[smoke-bridge] this page is NOT running tests: ' + why;
    (document.body || document.documentElement).appendChild(d);
  }
  function post(p, d, keep){
    try {
      var pr = fetch(p, {method:'POST', body: JSON.stringify(d), keepalive: !!keep, cache:'no-store'});
      // 桥关停后这些请求必然 reject；不吞掉就会变成 unhandledrejection，
      // 被 run_smoke 记成「页面运行时异常」——那是传输自己的噪音，不是应用的错。
      if (pr && pr.catch) pr.catch(function(){});
      return pr;
    } catch(e){ return null; }
  }
  // 只报「真实未捕获」异常（与 CDP Runtime.exceptionThrown 同口径）。
  // 用例会合成派发 ErrorEvent（isTrusted=false），不能算运行时报错。
  window.addEventListener('error', function(e){
    if (e && e.isTrusted) post('/__error', {msg: String(e.message || 'error')});
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    if (e && e.isTrusted) {
      var r = e.reason;
      post('/__error', {msg: 'unhandledrejection: ' + String((r && r.message) || r)});
    }
  }, true);
  function enc(v){
    if (v === undefined) return null;
    if (typeof v === 'function') return '[Function]';
    try { JSON.stringify(v); return v; }
    catch(e){ try { return String(v); } catch(e2){ return '[Unserializable]'; } }
  }
  function step(){
    if (STOPPED) return;
    fetch('/__poll?t=' + Date.now() + '&cid=' + encodeURIComponent(CID), {cache:'no-store'})
      .then(function(r){ return r.json(); })
      .then(function(c){
        if (c && c.stop) { halt(String(c.reason || 'taken over')); return; }
        if (c && c.id) {
          var out;
          try { out = {id: c.id, ok: true, value: enc((0, eval)(c.expr))}; }
          catch(err){ out = {id: c.id, ok: false, error: String((err && err.stack) || err)}; }
          out.vis = (document.visibilityState || 'unknown');
          if (c.reload) {
            try { navigator.sendBeacon('/__result', JSON.stringify(out)); } catch(e){}
          } else {
            post('/__result', out, true);
          }
        }
        setTimeout(step, 0);
      })
      .catch(function(){ if (!STOPPED) setTimeout(step, 150); });
  }
  function ping(){
    var pr = post('/__attach', {t: Date.now(), cid: CID});
    if (pr && pr.then) pr.then(function(r){ return r.json(); }).then(function(j){
      if (j && j.ok === false) halt(String(j.reason || 'another page attached'));
    }).catch(function(){});
  }
  ping();
  step();
  setInterval(ping, 2000);
})();
""".strip()


def _rewrite_app(html):
    """给 index.html 副本：①脚本 CSP 放开 unsafe-eval ②body 末尾注入客户端。

    CSP 改写必须按正则找 script-src 指令再插入，不能精确匹配整串：
    模块版 CSP 是 `script-src 'self' 'unsafe-inline';`，而早先单文件版是
    `script-src 'unsafe-inline';`。精确替换会**静默失配**——CSP 里没有 unsafe-eval，
    注入客户端里的 (0, eval) 全被拦，于是每条命令都报错，看起来像"应用起不来"。"""
    def _add_eval(m):
        head = m.group(0)
        if "unsafe-eval" in head:
            return head
        return m.group(1) + " 'unsafe-eval'" + m.group(2)
    html, n = re.subn(r"(script-src[^;]*?)(;|$)", _add_eval, html, count=1)
    if n == 0:
        html = html.replace("<head>", "<head><meta http-equiv=\"Content-Security-Policy\" "
                            "content=\"script-src 'unsafe-eval'\">", 1)
    idx = html.rfind("</body>")
    tag = "<script>" + CLIENT_JS + "</script>"
    if idx == -1:
        return html + tag
    return html[:idx] + tag + html[idx:]


def _wrap_html(w, h):
    # 外层页面：iframe 尺寸 = 被测视口。
    # 手机上整屏放不下（默认 500px 视口 > 手机 CSS 宽度）时，把 iframe 等比缩到可见——
    # 只缩不放，且 scale 只作用在外层：iframe 内部 innerWidth 仍是原始的 w，
    # 所以「按宽度量的断言」不受影响（曾经的现象：手机打开桥页面像被放大/被裁掉一截）。
    # ⚠️ scrolling="no" 不是随手加的：若 iframe 因内容过高出现经典滚动条，
    #    它会吃掉子文档客户端宽度的约 15px（320px 的视口里实际只剩 305px），
    #    于是「320px 无横向溢出」这类按宽度量的断言会跑出假失败。
    #    无头 Chromium 用的是覆盖式滚动条（不吃宽度），这里对齐它。
    w0, h0 = str(w), str(h)
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<style>html,body{margin:0;padding:0;background:#2b2b2b;overflow:hidden}"
        "#stage{position:absolute;left:0;top:0;transform-origin:0 0}"
        "iframe{border:0;display:block;background:#fff}"
        "#bar{position:fixed;right:6px;bottom:6px;z-index:9;background:rgba(0,0,0,.55);"
        "color:#fff;font:11px/1.6 monospace;padding:2px 6px;border-radius:4px}</style></head><body>"
        "<div id='stage'><iframe id='app' src='/app' scrolling='no' style='width:" + w0
        + "px;height:" + h0 + "px'></iframe></div><div id='bar'></div>"
        "<script>function fit(){var f=document.getElementById('app');"
        "var w=parseInt(f.style.width,10)||" + w0 + ",h=parseInt(f.style.height,10)||" + h0 + ";"
        "var av=document.documentElement.clientWidth||w;var s=Math.min(1,av/w);"
        "document.getElementById('stage').style.transform='scale('+s+')';"
        "document.body.style.height=(h*s)+'px';"
        "document.getElementById('bar').textContent=w+'x'+h"
        "+(s<1?' scaled '+Math.round(s*100)+'pct':'');}"
        "window.addEventListener('resize',fit);fit();"
        "window.addEventListener('message',function(e){var d=e.data||{};"
        "if(d.t==='vp'){var f=document.getElementById('app');f.style.width=d.w+'px';"
        "f.style.height=d.h+'px';fit();}});</script></body></html>"
    )

class _State(object):
    """命令队列 + 结果表。run_smoke 的线程与 HTTP 线程共享。"""

    def __init__(self):
        self.cv = threading.Condition()
        self.next_id = 1
        self.pending = []          # [(id, expr, reload)]
        self.delivered = set()
        self.results = {}
        self.errors = []
        self.attaches = 0
        self.last_poll = 0.0
        self.vis = "unknown"
        # 只允许一个页面接入：/__poll 是 FIFO，多个页面会瓜分任务（假失败）
        self.client_cid = None
        self.client_seen = 0.0
        self.rejects = 0

    def claim_client(self, cid):
        """锁定唯一执行者。

        不能让首个 cid 永久占位：/reset 会把 iframe 整帧导航（清存储后自动回 /app），
        文档重建 = 新 cid，旧文档已销毁不会再轮询。若仍死守旧 cid，新文档被回
        stop=True 立刻退出，于是没有任何页面在轮询，整轮 smoke 卡死在第一条用例前
        （现象：日志停在「存储重置后没等到应用就绪」，之后一行不动）。
        所以旧 cid 超过 STALE 秒没露面就视为已销毁，允许新 cid 接班。
        多页面并存仍会被拒：真正在轮询的那个每轮都会刷新 client_seen。"""
        STALE = 2.0
        with self.cv:
            if not cid:
                return "anon"
            now = time.time()
            if self.client_cid is None:
                self.client_cid = cid
                self.client_seen = now
                return "ok"
            if cid == self.client_cid:
                self.client_seen = now
                return "ok"
            if now - self.client_seen > STALE:
                self.client_cid = cid
                self.client_seen = now
                return "ok"
            self.rejects += 1
            return "other"

    def submit(self, expr):
        with self.cv:
            cid = self.next_id
            self.next_id += 1
            self.pending.append((cid, expr, "location.reload" in expr))
            self.cv.notify_all()
            return cid

    def take(self, timeout=3.0):
        with self.cv:
            if not self.pending:
                self.cv.wait(timeout)
            if not self.pending:
                return None
            item = self.pending.pop(0)
            self.delivered.add(item[0])
            self.last_poll = time.time()
            self.cv.notify_all()
            return item

    def put_result(self, cid, ok, value, error, vis=None):
        with self.cv:
            if vis:
                self.vis = vis
            self.results[cid] = {"ok": ok, "value": value, "error": error}
            self.cv.notify_all()

    def wait_result(self, cid, timeout):
        end = time.time() + timeout
        with self.cv:
            while cid not in self.results:
                left = end - time.time()
                if left <= 0:
                    return False, None
                self.cv.wait(left)
            return True, self.results.pop(cid)

    def wait_delivered(self, cid, timeout):
        end = time.time() + timeout
        with self.cv:
            while cid not in self.delivered:
                left = end - time.time()
                if left <= 0:
                    return False
                self.cv.wait(left)
            return True


class BridgeServer(object):
    def __init__(self, app_path, port=DEFAULT_PORT, w=DEFAULT_W, h=DEFAULT_H):
        self.app_path = app_path
        self.port = port
        self.w, self.h = w, h
        self.st = _State()
        self.errors = self.st.errors
        self._httpd = None
        self._thread = None

    # ---------- 生命周期 ----------
    def start(self):
        state = self.st
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            bridge = outer
            st = state

            def log_message(self, *a):
                pass  # 静音；日志留在 run_smoke 侧

            def _serve_static(self, path):
                """把被测产物的静态资源按相对路径返回（多产物 / 模块模式用）。

                两种模式：
                - 文件模式：app_path 是 index.html 的**路径**，按目录读盘；
                - URL 模式：app_path 是 http(s) URL（模块页只能走 http，file:// 会被 CORS 拦），
                  按 base 拼出同源 URL 代理回来。
                不做目录穿越（文件模式）；URL 模式只允许同源同 base 下的路径。"""
                import mimetypes
                rel = urllib.parse.unquote(path.lstrip("/"))
                ap = self.bridge.app_path
                if ap.startswith("http://") or ap.startswith("https://"):
                    base = ap.rsplit("/", 1)[0]
                    if "/../" in rel or rel.startswith("../"):
                        return self._send(403, "forbidden", "text/plain")
                    try:
                        with urllib.request.urlopen(base + "/" + rel, timeout=15) as r:
                            data = r.read()
                            ctype = r.headers.get("Content-Type") or "application/octet-stream"
                        return self._send(200, data, ctype)
                    except Exception as e:
                        return self._send(404, "proxy failed: %s" % e, "text/plain")
                root = os.path.dirname(os.path.abspath(ap))
                full = os.path.normpath(os.path.join(root, rel))
                if not (full == root or full.startswith(root + os.sep)):
                    return self._send(403, "forbidden", "text/plain")
                if not os.path.isfile(full):
                    return self._send(404, "not found: %s" % rel, "text/plain")
                ext = os.path.splitext(full)[1].lower()
                if ext not in (".js", ".css", ".json", ".webmanifest", ".png",
                               ".jpg", ".svg", ".ico", ".woff2", ".woff", ".txt", ".map"):
                    return self._send(403, "type not allowed", "text/plain")
                ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
                if ext in (".js", ".css", ".json", ".webmanifest", ".svg", ".txt"):
                    ctype += "; charset=utf-8"
                with open(full, "rb") as f:
                    data = f.read()
                return self._send(200, data, ctype)

            def _send(self, code, body, ctype):
                if isinstance(body, str):
                    body = body.encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
                self.end_headers()
                try:
                    self.wfile.write(body)
                except Exception:
                    pass

            def _body(self):
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                except Exception:
                    n = 0
                if n <= 0:
                    return {}
                raw = self.rfile.read(n)
                try:
                    return json.loads(raw.decode("utf-8", "replace"))
                except Exception:
                    return {}

            def do_GET(self):
                path = self.path.split("?", 1)[0]
                if path == "/":
                    return self._send(200, _wrap_html(self.bridge.w, self.bridge.h),
                                      "text/html; charset=utf-8")
                if path in ("/app", "/index.html"):
                    ap = self.bridge.app_path
                    try:
                        if ap.startswith("http://") or ap.startswith("https://"):
                            with urllib.request.urlopen(ap, timeout=15) as r:
                                html = r.read().decode("utf-8", "replace")
                        else:
                            with open(ap, "r", encoding="utf-8") as f:
                                html = f.read()
                    except Exception as e:
                        return self._send(500, "read app failed: %s" % e, "text/plain")
                    return self._send(200, _rewrite_app(html), "text/html; charset=utf-8")
                if path == "/reset":
                    return self._send(200, RESET_HTML, "text/html; charset=utf-8")
                # 静态回退：多产物（public/index.html + assets/*.js）的原生相对引用
                # 形如 assets/app.1.xxxx.js，桥必须原样提供，否则那些 <script> 全部 404，
                # 页面只剩 HTML 骨架、应用永不就绪（表现：等「应用就绪」一直超时）。
                # 只在该文件确实位于被测产物同目录树内时提供，不做目录穿越。
                if path not in ("/", "") and not path.startswith("/__"):
                    return self._serve_static(path)
                if path == "/__poll":
                    q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                    p_cid = (q.get("cid") or [""])[0]
                    if self.st.claim_client(p_cid) == "other":
                        return self._send(200, json.dumps(
                            {"id": 0, "stop": True,
                             "reason": "另一个页面已接入"}), "application/json")
                    item = self.st.take(3.0)
                    if item is None:
                        return self._send(200, json.dumps({"id": 0}), "application/json")
                    return self._send(200, json.dumps(
                        {"id": item[0], "expr": item[1], "reload": item[2]}),
                        "application/json")
                if path == "/__health":
                    return self._send(200, json.dumps({"ok": True}), "application/json")
                return self._send(404, "no route", "text/plain")

            def do_POST(self):
                path = self.path.split("?", 1)[0]
                data = self._body()
                if path == "/__result":
                    try:
                        cid = int(data.get("id") or 0)
                    except Exception:
                        cid = 0
                    self.st.put_result(cid, bool(data.get("ok")),
                                       data.get("value"), data.get("error"))
                    return self._send(200, "1", "text/plain")
                if path == "/__error":
                    self.st.errors.append(str(data.get("msg"))[:200])
                    return self._send(200, "1", "text/plain")
                if path == "/__attach":
                    _cid = data.get("cid") or None
                    with self.st.cv:
                        self.st.attaches += 1
                        if self.st.client_cid is None:
                            self.st.client_cid = _cid
                        elif _cid and _cid != self.st.client_cid:
                            self.st.rejects += 1
                            self.st.cv.notify_all()
                            return self._send(200, json.dumps(
                                {"ok": False, "reason": "另一个页面已接入"}),
                                "application/json")
                        self.st.cv.notify_all()
                    return self._send(200, "1", "text/plain")
                return self._send(404, "no route", "text/plain")

        self._httpd = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        self._httpd.daemon_threads = True
        self._thread = threading.Thread(target=self._httpd.serve_forever,
                                        kwargs={"poll_interval": 0.2})
        self._thread.daemon = True
        self._thread.start()

    def stop(self):
        try:
            self._httpd.shutdown()
        except Exception:
            pass

    @property
    def vis(self):
        return self.st.vis

    # ---------- run_smoke 侧接口 ----------
    def wait_attach(self, timeout=300.0):
        """等浏览器接入 /app（客户端会立刻打一次 /__attach）。"""
        end = time.time() + timeout
        while time.time() < end:
            with self.st.cv:
                if self.st.attaches > 0:
                    return True
            time.sleep(0.25)
        return False

    def reset_storage(self, timeout=30.0):
        """清空存储（localStorage + IndexedDB），等价无头版的 --user-data-dir=临时目录。

        为什么绕一圈走 /reset 页：应用自己会持有 IndexedDB 连接，此时 deleteDatabase
        会被 blocked 而永不完成；从应用页发删库请求，页面一 reload 请求就作废。
        所以命令 iframe 整帧导航到 /reset（同源），那一页清完自觉 replace 回 /app。

        完成判定用 nonce cookie 而不是「等重新接入」：真机浏览器页面常处后台态，
        轮询被节流到 ~1 秒，旧文档退场与新文档接入在时序上分不开（会误判成已完成）。
        """
        nonce = str(int(time.time() * 1000))
        self.st.submit("location.replace('/reset?n=%s')" % nonce)
        end = time.time() + timeout
        probe = "(document.cookie.match(/__smoke_reset=([^;]+)/)||[])[1]||''"
        while time.time() < end:
            cid = self.st.submit(probe)
            ok, res = self.st.wait_result(cid, min(4.0, max(0.5, end - time.time())))
            if ok and res.get("ok") and str(res.get("value") or "") == nonce:
                with self.st.cv:
                    self.st.results.clear()
                    self.st.delivered.clear()
                return True
        return False

    def eval(self, expr, timeout=25.0):
        """= run_smoke 的 js(expr)。返回语义与 CDP 版一致：异常返回 'EXC:...'。"""
        cid = self.st.submit(expr)
        if "location.reload" in expr or "location.replace" in expr:
            # 页面马上要重建，等结果没有意义（也等不到）。只确认命令已送达。
            self.st.wait_delivered(cid, 10.0)
            return None
        ok, res = self.st.wait_result(cid, timeout)
        if not ok:
            return "EXC:bridge timeout"
        if not res.get("ok"):
            return "EXC:" + str(res.get("error"))[:200]
        return res.get("value")

    def set_viewport(self, w, h):
        """CDP Emulation.setDeviceMetricsOverride 的桥等价物：改 iframe 尺寸。"""
        self.w, self.h = w, h
        return self.eval(
            "parent.postMessage({t:'vp',w:%d,h:%d},'*')" % (w, h))
