#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""probe_dep 的采集器：起无头 chromium，遍历五个视图，dump 累积的探针集合。

独立成文件的原因：它需要 CDP + 内层 JS，塞进 probe_dep.py 的 f-string 里
会与花括号转义打架（{{}}），可读性也差。这里用普通字符串拼接，清晰可控。

用法（由 probe_dep.py 调用）：
    python3 probe_collect.py <artifact_html_path> [wait_ms]
输出：
    TOUCHED:<json数组>   —— sessionStorage 里累积的探针名（跨 reload 存活）
    CHROMIUM_FAIL        —— 环境不具备无头浏览器
"""
import json, os, random, signal, subprocess, sys, time, urllib.request

WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
WORK = os.path.abspath(WORK)

INNER_JS = """
(function(){
  var out = [];
  try { out = window.__touched ? window.__touched() : []; } catch(e) {}
  return JSON.stringify(out);
})()
"""


def main():
    if len(sys.argv) < 2:
        print("用法: probe_collect.py <artifact_html> [wait_ms]")
        return 2
    html_path = os.path.abspath(sys.argv[1])
    wait_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 2200
    chromium = os.environ.get("CHROMIUM", "chromium")
    port = random.randint(9900, 10500)
    profile = os.path.join("/tmp", "probe_prof_%d" % os.getpid())
    os.makedirs(profile, exist_ok=True)

    try:
        import websocket
    except ImportError:
        print("缺少 websocket-client，无法采集")
        return 3

    proc = subprocess.Popen(
        [chromium, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--user-data-dir=" + profile, "--window-size=500,1000", "--hide-scrollbars",
         "--remote-debugging-port=" + str(port), "file://" + html_path],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

    def wait_port():
        for _ in range(60):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/json/version" % port, timeout=1)
                return True
            except Exception:
                time.sleep(0.25)
        return False

    try:
        if not wait_port():
            print("CHROMIUM_FAIL")
            return 3
        tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json" % port).read())
        page = [t for t in tabs if t.get("type") == "page"][0]
        ws = websocket.create_connection(page["webSocketDebuggerUrl"],
                                         suppress_origin=True, timeout=30)
        mid = [0]

        def js(expr):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": "Runtime.evaluate",
                                "params": {"expression": expr, "returnByValue": True}}))
            while True:
                r = json.loads(ws.recv())
                if r.get("id") == mid[0]:
                    return r.get("result", {}).get("result", {}).get("value")

        time.sleep(wait_ms / 1000.0)
        # 遍历五个主视图
        for v in ["#/", "#/plan", "#/log", "#/stats", "#/settings"]:
            js("location.hash='" + v + "'")
            time.sleep(0.9)
        # 展开设置页所有折叠组，逼出各模块的渲染副作用
        js("document.querySelectorAll('.settings-group.foldable')"
           ".forEach(function(g){g.classList.remove('collapsed')})")
        time.sleep(1.2)
        js("try{applySettingsToUI()}catch(e){}")
        time.sleep(0.6)
        js("try{themeEngine&&themeEngine.renderCards()}catch(e){}")
        time.sleep(0.4)
        # 点一次第 2 张色卡：逼出 setTheme 的落盘副作用（否则 done:themeSave 是盲区）
        js("try{(function(){var c=document.querySelectorAll('#themeGrid .theme-card');"
           "if(c&&c[1]){c[1].click();}})()}catch(e){}")
        time.sleep(0.7)
        js("try{if(window.__uiFold&&window.__uiFold.apply)window.__uiFold.apply()}catch(e){}")
        time.sleep(0.3)

        print("TOUCHED:" + str(js(INNER_JS)))
        return 0
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
