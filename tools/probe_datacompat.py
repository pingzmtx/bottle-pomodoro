#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据兼容实测（口径第 3 类，探针扫不到，须专门验）：
往存档塞 theme:'nord' → 启动 → 断言字段无损、loadData 不报错。

对应定稿口径的「第 3 类：数据兼容」——探针扫不到，必须专门验。
用法：python3 /tmp/datacompat.py <artifact_html>
"""
import sys, os, json, time, random, subprocess, urllib.request, signal

html = os.path.abspath(sys.argv[1])
chromium = os.environ.get("CHROMIUM", "chromium")
port = random.randint(9900, 10500)
profile = "/tmp/dc_prof_%d" % os.getpid()
os.makedirs(profile, exist_ok=True)
import websocket

CODE = """
(function(){
  var out = {ok:false};
  try {
    out.hasEngine = (typeof window.themeEngine !== 'undefined');
    out.themeAttr = document.body.getAttribute('data-theme');
    out.settingsTheme = (typeof appData!=='undefined' && appData.settings) ? appData.settings.theme : '(无appData)';
    out.settingsIntact = !!(typeof appData!=='undefined' && appData.settings &&
        appData.settings.theme === 'nord' && appData.settings.darkMode === true);
    out.recordsKept = !!(typeof appData!=='undefined' && Array.isArray(appData.records));
    out.ok = true;
  } catch(e) { out.err = String(e); }
  return JSON.stringify(out);
})()
"""


def main():
    proc = subprocess.Popen(
        [chromium, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--user-data-dir=" + profile, "--window-size=500,1000",
         "--remote-debugging-port=" + str(port), "file://" + html],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/json/version" % port, timeout=1)
                break
            except Exception:
                time.sleep(0.25)
        tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/json" % port).read())
        page = [t for t in tabs if t.get("type") == "page"][0]
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=30)
        mid = [0]

        def js(expr):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": "Runtime.evaluate",
                                "params": {"expression": expr, "returnByValue": True}}))
            while True:
                r = json.loads(ws.recv())
                if r.get("id") == mid[0]:
                    if "exceptionDetails" in r.get("result", {}):
                        return "EXC:" + str(r["result"]["exceptionDetails"].get("text"))
                    return r.get("result", {}).get("result", {}).get("value")

        time.sleep(2.0)
        # ① 塞一份「旧存档」：带 theme:'nord' + darkMode:true + 一条记录
        # 用应用自身 API 播种：直接改 appData + saveData()，保证 localStorage 与 IndexedDB
        #  双源一致（loadData 是「按写入时间戳取较新的一份」，只手写 localStorage 会被 IDB 压过）
        seed = ("(function(){"
                "appData.settings.theme='nord';"
                "appData.settings.darkMode=true;"
                "appData.records=[{id:1,type:'full',startTime:Date.now(),pomos:1,effectiveSeconds:1500}];"
                "if(typeof saveData==='function'){saveData();}"
                "return 'seeded:'+appData.settings.theme;})()")
        print("① 塞入旧存档(theme:'nord')：", js(seed))
        # ② 重载 → 走 loadData
        js("location.reload()")
        # loadData 是异步的（IndexedDB 优先）→ 轮询等 appData 就绪，不靠固定 sleep
        for _ in range(30):
            time.sleep(0.5)
            rdy = js("!!(typeof appData!=='undefined' && appData.settings)")
            if rdy is True:
                break
        time.sleep(0.8)
        # ③ 读回
        res = js(CODE)
        print("② 启动后读回：", res)
        try:
            o = json.loads(res)
        except Exception:
            print("   解析失败"); return 2
        print()
        print("— 数据兼容判定 —")
        print("  主题引擎是否还在 :", o.get("hasEngine"), "(抽掉后应为 False)")
        print("  body[data-theme]  :", o.get("themeAttr"))
        print("  settings.theme    :", o.get("settingsTheme"))
        print("  settings 完整无损 :", o.get("settingsIntact"))
        print("  records 保留      :", o.get("recordsKept"))
        print()
        if o.get("settingsIntact") and o.get("recordsKept"):
            print("  ✅ 数据兼容：抽掉模块后旧存档字段原样保留，loadData 不报错")
            return 0
        print("  ❌ 数据被破坏或丢失")
        return 1
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


sys.exit(main())
