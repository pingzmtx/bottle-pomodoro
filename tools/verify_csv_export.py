#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端到端验证 CSV 导出：真点按钮 → 真下载 → 读文件核对表头与取值。

只验纯函数是不够的 —— 三处调用点改成了 recordsCsvTable()，
必须确认「点下去真的能出文件、且内容是对的」。
"""
import json, os, random, shutil, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _app_path
APP = (_app_path.serve_multi("file://" + os.path.abspath(sys.argv[1])) if len(sys.argv) > 1
       else _app_path.resolve())   # 2026-10-22：默认 public/index.html
DL = "/tmp/csv_dl"
shutil.rmtree(DL, ignore_errors=True)
os.makedirs(DL, exist_ok=True)
PORT = random.randint(9400, 9800)
PROFILE = tempfile.mkdtemp(prefix="csvv_")

proc = subprocess.Popen(
    ["chromium", "--headless=new", "--disable-gpu", "--no-sandbox",
     f"--user-data-dir={PROFILE}", "--window-size=420,1400", "--hide-scrollbars",
     f"--remote-debugging-port={PORT}", APP],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

fails = []
try:
    for _ in range(80):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
            break
        except Exception:
            time.sleep(0.25)
    import websocket
    tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json").read())
    page = [t for t in tabs if t.get("type") == "page"][0]
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], suppress_origin=True, timeout=60)
    mid = [0]

    def send(m, p=None):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": m, "params": p or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == mid[0]:
                return r

    def js(x):
        r = send("Runtime.evaluate", {"expression": x, "returnByValue": True, "awaitPromise": True})
        res = r.get("result", {})
        if "exceptionDetails" in res:
            return "EXC:" + str(res["exceptionDetails"].get("exception", {}).get("description", ""))[:300]
        return res.get("result", {}).get("value")

    def ck(desc, cond):
        print(("  ✓ " if cond else "  ✗ ") + desc)
        if not cond:
            fails.append(desc)

    send("Page.enable")
    send("Runtime.enable")
    send("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": DL})
    time.sleep(1.5)

    # 造两条记录：一条完整关联，一条老式无关联
    setup = r"""
    (function(){
      appData.records = [
        { id: 900001, type:'full', taskName:'数学卷子', planTitle:'数学卷子', subTitle:'第3题',
          tag:'学习', quad:'q1', todoId:555, pomos:1, effectiveSeconds:1500,
          startTime:new Date(2026,9,13,9,0).getTime(), endTime:new Date(2026,9,13,9,25).getTime(),
          interruptions:[], totalInterruptSeconds:0, note:'',
          planSubs:[{t:'看例题',d:true},{t:'做第3题',d:false}] },
        { id: 900002, type:'log', taskName:'看视频', pomos:0, effectiveSeconds:1800,
          startTime:new Date(2026,9,13,14,0).getTime(), endTime:new Date(2026,9,13,14,30).getTime(),
          interruptions:[], totalInterruptSeconds:0 }
      ];
      saveData();
      return 1;
    })()
    """
    js(setup)
    ck("造数成功（页面无异常）", not str(js("appData.records.length")).startswith("EXC"))

    btn = js("!!document.getElementById('enhCsvBtn')")
    ck("导出按钮存在（03 注入的 enhCsvBtn）", btn is True)

    js("document.getElementById('enhCsvBtn').click(); 1")
    time.sleep(2.5)

    csvs = [f for f in os.listdir(DL) if f.endswith(".csv")]
    ck("点按钮后确实产出了 .csv 文件：" + (csvs[0] if csvs else "（无）"), bool(csvs))
    if csvs:
        raw = open(os.path.join(DL, csvs[0]), encoding="utf-8-sig").read()
        lines = raw.splitlines()   # 注意：text 模式默认会把 \r\n 折成 \n，必须用 splitlines
        head = lines[0].split(",")
        ck("表头 23 列（实得 %d）" % len(head), len(head) == 23)
        ck("前 17 列顺序未变（第1列=日期，第17列=实际番茄）",
           head[0] == "日期" and head[16] == "实际番茄")
        ck("追加的 6 列在末尾",
           head[17:] == ["计划", "子任务", "标签", "四象限", "子计划进度", "计划ID"])
        ck("行数 = 1 表头 + 2 记录（实得 %d）" % len([l for l in lines if l.strip()]),
           len([l for l in lines if l.strip()]) == 3)
        row1 = lines[1].split(",")
        ck("关联行的「计划」列 = 数学卷子", row1[17] == "数学卷子")
        ck("关联行的「四象限」= 中文名", row1[20] == "重要又紧急")
        ck("关联行的「子计划进度」= ✓/○ 文本", row1[21] == "✓看例题 ○做第3题")
        ck("关联行的「计划ID」= 555", row1[22] == "555")
        row2 = lines[2].split(",")
        ck("老式行的末尾 6 列全空（不串位）", row2[17:] == ["", "", "", "", "", ""])
        ck("老式行的「类型」仍是中文", row2[5] == "仅记录")

    ck("全程无 JS 异常", not str(js("1")).startswith("EXC"))
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    shutil.rmtree(PROFILE, ignore_errors=True)

print()
if fails:
    print("CSV 端到端导出: FAILED → " + "；".join(fails))
else:
    print("CSV 端到端导出: 全部通过（真点按钮 → 真下载 → 真读文件）")
sys.exit(1 if fails else 0)
