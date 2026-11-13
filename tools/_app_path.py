#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""被测产物的统一解析（P1-8）。

历史问题：a11y_audit / audit_coinledger / audit_timeblock / audit_timer_modes
四个脚本各自硬编码
    APP = 'file:///workspace/瓶子专注-修复包-20261013/index.html'
换台机器、换个目录名，要么读到不存在的文件（工具崩），要么读到一份**旧产物**
（审计照样"通过"——比崩更糟，是假绿）。而 README 明确教外部 AI 拿 tools/ 直接用。

解析顺序（与 run_smoke.py 保持一致，别再造第二套口径）：
    --html <path|url>  >  SMOKE_APP / APP / RS_APP 环境变量  >  项目内 public/index.html

2026-10-22：public/ 成为唯一发布物，默认目标从 index.html 改为 public/index.html。
需要**自包含**产物的工具（要把用例 JS 内联进页面再跑）用 single_html()：
它只有在 index.html 不存在时才现场 build --single，不参与发布、不进仓库。
"""
import os
import subprocess
import sys

# tools/ 的上一级 = 仓库根
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _as_url(p):
    p = str(p)
    if p.startswith("file://") or p.startswith("http://") or p.startswith("https://"):
        return p
    return "file://" + os.path.abspath(p)


def _is_multi(html):
    d = os.path.dirname(os.path.abspath(html))
    assets = os.path.join(d, "assets")
    try:
        return os.path.isdir(assets) and any(
            f.startswith("app.") and f.endswith(".js") for f in os.listdir(assets))
    except OSError:
        return False


_SRV = None


def serve_multi(url):
    """把「多产物目录里的 index.html」换成同源 http 地址。

    为什么必须：file:// 下 Chrome 把每个文件当独立源，`link.sheet.cssRules`
    会抛 SecurityError（C01 因此假红），部分审计工具也读不了样式表规则。
    单文件产物没有 assets/ 兄弟目录，原样返回，行为完全不变。
    """
    global _SRV
    if not url.startswith("file://"):
        return url
    p = os.path.abspath(url[len("file://"):])
    if not _is_multi(p):
        return url
    import functools
    import http.server
    import socketserver
    import threading

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    # ★ 必须是 ThreadingTCPServer：浏览器打开模块页时会并发拉 app.js/core.js/engine.js/style.css
    #   再加一条 keep-alive 连接。单线程 TCPServer 下第一条连接不关就把 accept 卡住，
    #   后面的脚本请求全超时 —— 表现是「页面起来了但一半全局函数 undefined」
    #   （C124/C125 连红好几次，真因在这儿，不是代码坏了）。
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=os.path.dirname(p)))
    srv.daemon_threads = True
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _SRV = srv
    print("   传输: 本地静态服务 http://127.0.0.1:%d/ （多产物需同源）" % port)
    return "http://127.0.0.1:%d/%s" % (port, os.path.basename(p))


def resolve():
    """返回可直接喂给浏览器的 URL；找不到就返回项目内路径（让调用方报"文件不存在"，别静默读旧包）。"""
    if "--html" in sys.argv:
        i = sys.argv.index("--html")
        if i + 1 < len(sys.argv):
            cand = _as_url(sys.argv[i + 1])
            return serve_multi(cand)
    for key in ("SMOKE_APP", "APP", "RS_APP"):
        v = os.environ.get(key)
        if v:
            return serve_multi(_as_url(v))
    return serve_multi(_as_url(os.path.join(ROOT, "public", "index.html")))


def resolve_path():
    """只要本地路径（某些工具要读文件内容再做哈希/比对）——不能被 serve_multi 换成 http。"""
    if "--html" in sys.argv:
        i = sys.argv.index("--html")
        if i + 1 < len(sys.argv):
            return os.path.abspath(sys.argv[i + 1].replace("file://", "", 1))
    for key in ("SMOKE_APP", "APP", "RS_APP"):
        v = os.environ.get(key)
        if v:
            return os.path.abspath(v.replace("file://", "", 1))
    return os.path.join(ROOT, "public", "index.html")


def single_html():
    """自包含单文件产物的本地路径（只给需要内联 JS 的调试工具用）。

    多产物把脚本拆成了 assets/*.js，没法再把用例代码贴进同一个文件里跑。
    这类工具要的是"一个 HTML 装下全部"，所以按需生成 --single 产物：
    已有就直接用，没有就现场构建一次（约 2 秒）。产物在 .gitignore 里，不算发布物。
    """
    p = os.path.join(ROOT, "index.html")
    if os.path.exists(p):
        return p
    print("○ 需要自包含单文件产物，正在生成 index.html（build.py --single）……")
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build.py"), "--single"],
                       cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if r.returncode != 0 or not os.path.exists(p):
        print(r.stdout.decode("utf-8", "replace")[-600:])
        raise SystemExit("✗ 生成单文件产物失败")
    return p


def chromium():
    """浏览器可执行文件：CHROMIUM 环境变量优先，其次 chromium。"""
    return os.environ.get("CHROMIUM", "chromium")
