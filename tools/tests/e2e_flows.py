#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍅 番茄专注 · E2E 5 条核心动线（Wave 0 /）
================================================
用法:
    python3 tools/tests/e2e_flows.py            # 跑全部 5 条动线
    python3 tools/tests/e2e_flows.py --only F1  # 只跑单条动线（F1..F5）
    python3 tools/tests/e2e_flows.py --html /path/to/index.html

原理: 无头 Chromium + CDP（复用 tools/run_smoke.py 的 launch 驱动）。
每条动线 = 「重置到已知态 → 走真实 UI/函数链路 → 断言」，
作为 拆 01e 的回归基线，先于 92 断言 smoke 跑。

覆盖动线:
  F1 启动番茄 → 自然完成 → 结算弹窗正确
  F2 计划增/删/勾选 ↔ 今日必做联动
  F3 统计页 5 子 tab 无异常渲染
  F4 设置改深色 → 持久化 → 重开仍生效
  F5 导出 → 清空 → 导入恢复（20+ 字段全等）
"""
import sys, os, json, time, subprocess, tempfile, random

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
import run_smoke as _rs  # 复用 chromium/CDP 启动；run_smoke.main 仅在 __main__ 执行，import 无副作用

APP = _rs.APP          # run_smoke 导入期已解析（含多产物同源服务）
CHROMIUM = os.environ.get("CHROMIUM", "chromium")
PORT = random.randint(9400, 9800)
PROFILE = tempfile.mkdtemp(prefix="e2e_")

PASS = FAIL = 0
FAILURES = []
_cases = []
def case(fn):
    _cases.append(fn)
    return fn

def check(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        FAILURES.append(msg)
        print("   ✗", msg)
    return cond

# ---------- chromium / cdp（连接由 main 里 run_smoke.launch 建立并注入） ----------
_PAGE_WS = None
_PAGE_JS = None
_PAGE_ERRS = []
_cdp_mid = [0]

def cdp(m, p=None):
    """直接发 CDP 命令（独立 id 空间，与 _PAGE_JS 的闭包 send 共享同一 socket 无冲突）。"""
    _cdp_mid[0] += 1
    _id = _cdp_mid[0]
    _PAGE_WS.send(json.dumps({"id": _id, "method": m, "params": p or {}}))
    while True:
        r = json.loads(_PAGE_WS.recv())
        if r.get("id") == _id:
            break
    if "error" in r:
        raise RuntimeError(f"CDP {m} 失败: {r['error']}")
    return r

def js(expr):
    """页面内执行 JS（复用 run_smoke launch 的 js 闭包：未捕获异常自动进 _PAGE_ERRS）。"""
    return _PAGE_JS(expr)

def jsw(expr, timeout=9):
    """等待页面某表达式为真值，超时返回 False。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        v = js(expr)
        if v not in (None, False, "", "EXC:") and v is not False:
            return True
        time.sleep(0.15)
    return False

# ---------- 页面工具（注入到被测应用里的复位/种子助手） ----------
LEGACY_JS = r"""
(function(){
  /* 老用户态：关闭成长之旅（全玩法放行），避免解锁卡/闸口干扰 E2E */
  if (!appData.journey) appData.journey = {};
  appData.journey.enabled = false;
  appData.journey.pending = [];
  try { appData.journey.seen = ['tree','rank','coin','ach','team','lb','deco','gift','lottery','store']; } catch(e){}
  if (typeof saveDataNow === 'function') saveDataNow();
  return true;
})()
"""

BOOT_WAIT = 3.0

def reload_wait():
    js("location.reload()")
    time.sleep(BOOT_WAIT)

def legacy_reload():
    js(LEGACY_JS)
    reload_wait()

def jsnum(v):
    try:
        return int(v or 0)
    except Exception:
        return -1

def first_run():
    """全新档案 + 老用户态，返回 True。"""
    js("localStorage.clear();location.reload()")
    time.sleep(BOOT_WAIT)
    js(LEGACY_JS)
    reload_wait()
    return True

def exit_break_to_idle():
    """结算后可能自动进入短休；把计时器收回 idle 态（走真实跳过入口）。"""
    js("""(function(){
      if (typeof timerState==='undefined'||!timerState) return true;
      if (timerState.mode==='shortBreak'||timerState.mode==='longBreak') {
        try { if (typeof skipBreak==='function') skipBreak(); } catch(e){}
      }
      if (typeof dismissSettle==='function') { try { dismissSettle(); } catch(e){} }
      return true;})()""")
    time.sleep(0.5)

# ============================================================
# F1 动线① 启动番茄 → 自然完成 → 结算弹窗正确
# ============================================================
@case
def F1():
    t0 = time.time()
    print("▶ F1 番茄完整周期（启动→自然完成→结算）")
    first_run()
    check(js("timerState.mode") == "idle", "计时器初始 idle")
    # 1) 真实点击「开始」（btnStart onclick=toggleTimer → 321 倒数 → startPomodoro）
    js("document.getElementById('btnStart').click()")
    time.sleep(1.0)
    ok = jsw("timerState && timerState.mode==='focus' && timerState.running", 8)
    check(ok, "点击开始后进入专注中（running）")
    if ok:
        check(js("document.getElementById('btnStart').disabled") is True, "专注中开始按钮禁用")
        lbl = js("document.getElementById('timerLabel').textContent")
        check("专注" in str(lbl), f"计时页标题显示专注中({lbl})")
    # 2) 快进到自然完成（把 endAt 拨近，timer loop 到点后走真实 onTimerComplete 链）
    js("timerState.endAt = Date.now() + 2200")
    ok = jsw("(function(){var m=document.getElementById('finishModal');return m&&m.classList.contains('show');})()", 8)
    check(ok, "倒计时走完后弹出结算窗 finishModal")
    if ok:
        info = str(js("document.getElementById('finishInfo').textContent") or "")
        # 文案由「有效专注时长 X 分钟」改为「实际专注 X 分 Y 秒（计划 N 分钟…）」，
        # 口径更精确（分秒级）。断言同步改为匹配新前缀，并仍要求含番茄折算符号。
        check(("实际专注" in info or "有效专注时长" in info) and "🍅" in info,
              f"finishModal 时长折算文案正确({info.strip()})")
        ft = js("document.getElementById('finishType').value")
        check(ft == "full", f"自然完成默认结算类型=full(实际 {ft})")
        # 全选型：25 分钟专注下 value=full 的档位可点（disabled=false）
        fDis = js("(function(){var s=document.getElementById('finishType');var o=s.querySelector('option[value=\"full\"]');return o?o.disabled:'NOOPT';})()")
        check(fDis is False, "完整番茄档可选")
        # 填备注（真实输入）
        js("(function(){var n=document.getElementById('finishNote');if(n)n.value='E2E 自然完成备注';return 1;})()")
    # 3) 真实点击「确认结算」
    js("(function(){var bs=document.querySelectorAll('[data-act]');var b=null;for(var i=0;i<bs.length;i++){if(bs[i].getAttribute('data-act')==='confirmFinish')b=bs[i];}if(b)b.click();return 1;})()")
    time.sleep(0.8)
    nRec = jsnum(js("appData.records.length"))
    check(nRec == 1, f"确认后 records 写入 1 条(实际 {nRec})")
    rec = js("(function(){return appData.records[0]?JSON.stringify({type:appData.records[0].type,pomos:appData.records[0].pomos,note:appData.records[0].note,eff:appData.records[0].effectiveSeconds}):'{}';})()") or "{}"
    r0 = json.loads(rec)
    check(r0.get("type") == "full" and r0.get("pomos") == 1, f"记录类型 full / 折算 1🍅({rec})")
    check("E2E" in str(r0.get("note", "")), "备注已随记录保存")
    # 本轮统计口径：appData.round 只存 startTs，计数一律由记录现算（computeRoundStats/getRoundStats）。
    # 旧断言直接读 appData.round.full —— 该字段早已废弃（恒 undefined），属既有过时断言。
    check(jsnum(js("(typeof getRoundStats==='function')?getRoundStats().full:-1")) >= 1, "本轮完整番茄累计（getRoundStats 口径）")
    # 4) 结算摘要卡（3.5s 内 flush 出卡）
    ok = jsw("(function(){var m=document.getElementById('settleMask');return m&&m.classList.contains('show')&&m.querySelector('.settle-card');})()", 6)
    check(ok, "结算摘要卡出现（settleMask）")
    if ok:
        ttl = str(js("(function(){var m=document.getElementById('settleMask');return m.querySelector('.settle-title')?m.querySelector('.settle-title').textContent:'';})()") or "")
        check("结算" in ttl, f"摘要卡标题正确({ttl.strip()})")
        nline = jsnum(js("(function(){var m=document.getElementById('settleMask');return m?m.querySelectorAll('.settle-line').length:0;})()"))
        check(nline >= 1, f"摘要卡含播报明细({nline} 行)")
        js("(function(){var b=document.querySelector('#settleMask .settle-ok');if(b)b.click();return 1;})()")
        time.sleep(0.4)
        check(js("!document.getElementById('settleMask')") is True, "点「知道了」摘要卡关闭")
    # 5) 收尾：跳过自动短休回 idle
    exit_break_to_idle()
    check(js("timerState.mode") == "idle", "计时器回到 idle 可再来一轮")
    js("switchView('timer')")
    print(f"   ({time.time()-t0:.1f}s)")

# ============================================================
# F2 动线② 计划增/删/勾选 ↔ 今日必做联动
# ============================================================
@case
def F2():
    t0 = time.time()
    print("▶ F2 计划增删勾 ↔ 今日必做联动")
    first_run()
    # 预置今日必做 1 件（走 renderTodos 的真实刷新链看 plan 页必做行）
    js("""(function(){
      var t = getTodayStr();
      if (!appData.mustDos) appData.mustDos = {};
      appData.mustDos[t] = [{id:1, title:'E2E今日必做', done:false, est:1}];
      if (typeof renderTodos==='function') renderTodos();
      return true;})()""")
    js("switchView('plan')")
    time.sleep(0.6)
    row = str(js("document.getElementById('planTodoMustRows')?document.getElementById('planTodoMustRows').innerText:''") or "")
    check("今日必做" in row and "0/1" in row.replace(" ", ""), f"计划页顶部必做行显示 0/1({row.strip()[:60]})")
    # 1) 新增计划（真实 modal 链路）
    js("openAddTodoModal()")
    time.sleep(0.3)
    js("document.getElementById('addTodoTitle').value='E2E 计划任务'")
    js("(function(){var bs=document.querySelectorAll('[data-act]');var b=null;for(var i=0;i<bs.length;i++){if(bs[i].getAttribute('data-act')==='confirmAddTodo')b=bs[i];}if(b)b.click();return 1;})()")
    time.sleep(0.5)
    nTodo = jsnum(js("appData.todos.length"))
    check(nTodo == 1, f"新增后 todos=1(实际 {nTodo})")
    vis = str(js("(function(){var v=document.getElementById('planTodoView');return v?v.innerText:'';})()") or "")
    check("E2E 计划任务" in vis, "新计划渲染进列表")
    row2 = str(js("document.getElementById('planTodoMustRows')?document.getElementById('planTodoMustRows').innerText:''") or "")
    check("0/1" in row2.replace(" ", ""), "新增计划后必做行仍独立正确(0/1)")
    # 2) 勾选计划（真实 click .todo-checkbox）
    js("(function(){var c=document.querySelector('#planTodoView .todo-item .todo-checkbox');if(c)c.click();return 1;})()")
    time.sleep(0.5)
    done = js("appData.todos[0].done") is True
    check(done, "勾选后 todo.done=true")
    cls = str(js("(function(){var i=document.querySelector('#planTodoView .todo-item');return i?i.className:'';})()") or "")
    check("done" in cls, "列表项应用完成样式(done class)")
    row3 = str(js("document.getElementById('planTodoMustRows')?document.getElementById('planTodoMustRows').innerText:''") or "")
    check("0/1" in row3.replace(" ", ""), "勾选计划不影响必做独立计数(仍 0/1)")
    # 3) 今日必做联动：勾掉必做卡 → 1/1（真实 click）
    js("""(function(){var c=document.querySelector("#planTodoMustRows [data-act^='toggleMustDo'],#planTodoMustRows [onclick^='toggleMustDo']");if(c)c.click();return 1;})()""")
    time.sleep(0.4)
    md = js("(function(){var t=getTodayStr();return (appData.mustDos[t]||[])[0].done;})()")
    check(md is True, "今日必做卡可勾选完成")
    row4 = str(js("document.getElementById('planTodoMustRows')?document.getElementById('planTodoMustRows').innerText:''") or "")
    check("1/1" in row4.replace(" ", ""), "必做行联动刷新为 1/1")
    # 4) 删除计划（真实链路：点列表项删除入口 → 确认弹窗 → 执行）
    js("""(function(){
      var i=document.querySelector('#planTodoView .todo-item');
      var id=i?parseInt(i.getAttribute('data-id'),10):null;
      if (id && typeof showDeleteConfirm==='function') showDeleteConfirm(id);
      return !!id;})()""")
    time.sleep(0.3)
    check(js("(function(){var m=document.getElementById('deleteConfirmModal');return !!m&&m.classList.contains('show');})()") is True, "删除确认弹窗出现")
    js("(function(){var bs=document.querySelectorAll('[data-act]');var b=null;for(var i=0;i<bs.length;i++){if(bs[i].getAttribute('data-act')==='executeDelete')b=bs[i];}if(b)b.click();return 1;})()")
    time.sleep(0.5)
    nTodo2 = jsnum(js("appData.todos.length"))
    check(nTodo2 == 0, f"删除后 todos=0(实际 {nTodo2})")
    row5 = str(js("document.getElementById('planTodoMustRows')?document.getElementById('planTodoMustRows').innerText:''") or "")
    check("今日必做" in row5, "删除计划后必做行仍在（联动不破）")
    js("switchView('timer')")
    print(f"   ({time.time()-t0:.1f}s)")

# ============================================================
# F3 动线③ 统计页 5 子 tab 无异常渲染
# ============================================================
@case
def F3():
    t0 = time.time()
    print("▶ F3 统计页 5 子 tab 无异常渲染")
    first_run()
    # 种子：跨多类型记录 + 成就 + 段位历史 + 树 + 组队 + 排行榜
    js("""(function(){
      var recs=[], now=Date.now(), DAY=86400000;
      function push(days, type, pomos, eff, extra){
        var st = now - days*DAY - Math.floor(Math.random()*1000);
        var r={id:st,type:type,startTime:st,endTime:st+eff*1000,effectiveSeconds:eff,pomos:pomos,
               taskName:'任务'+days,note:'',energy:6,mood:7,interruptions:0,totalInterruptSeconds:0,difficulty:'medium',
               expectedPomodoros:null,actualPomodoros:null};
        if (extra) for (var k in extra) r[k]=extra[k];
        recs.push(r);
      }
      push(0,'full',1,1500); push(0,'half',0.5,720); push(1,'full',1,1500);
      push(3,'full',1,1500); push(8,'full',2,3000); push(15,'half',0.5,600);
      appData.records=recs;
      appData.todos=[{id:1,title:'旧任务',done:true,pomodoros:null,actualPomodoros:0,timeSpent:1500,detail:'',tag:'',deadline:null,remindAt:null,subs:[],reminded:false}];
      appData.lastTodoCleanupDate=getTodayStr(); /* 今天已做过完成清理 → 避免导入/跨天检查误删 seed 的 done todo */
      appData.habits=[{id:'h1',title:'喝水',icon:'💧'}];
      appData.habitLogs={h1:[getTodayStr()]};
      appData.unlockedAchievements=['first','t10','d7'];
      appData.rankSystem.history={seasons:[{startDate:'2026-01-01',maxStars:12,maxRankName:'黄金'}]};
      appData.rankSystem.rankFeedback=[{msg:'好',time:'2026-08-01 10:00'}];
      appData.teamSystem.history=[{date:'2026-08-01',my:{completed:1},partner:{completed:1}}];
      appData.botLeaderboard.bots=[{name:'机器人A',pomos:3},{name:'机器人B',pomos:5}];
      appData.tree.points=18; appData.tree.coins=9;
      if (typeof saveDataNow==='function') saveDataNow();
      return true;})()""")
    reload_wait()
    js("switchView('stats')")
    time.sleep(1.2)
    tabs = [("data", "statsDataView"), ("tree", "statsTreeView"), ("rank", "statsRankView"),
            ("ach", "statsAchView"), ("lb", "statsLbView")]
    allok = True
    for tab, vid in tabs:
        r = js("(function(){var t='" + tab + "';switchStatsSubTab(t);return true;})()")
        time.sleep(0.9)
        if str(r).startswith("EXC"):
            allok = False
            check(False, f"tab {tab} 切换抛异常({r})")
            continue
        disp = js("(function(){var v=document.getElementById('" + vid + "');return v?getComputedStyle(v).display:'N/A';})()")
        txt = str(js("(function(){var v=document.getElementById('" + vid + "');return v?v.innerText.trim():'';})()") or "")
        cur = js("(function(){var n=document.querySelector('#statsSubNav .stats-nav-item.current');return n?n.getAttribute('data-tab'):'';})()")
        vis_ok = disp == "block"
        txt_ok = len(txt) > 4
        check(vis_ok, f"统计子tab[{tab}] 容器显示(display={disp})")
        check(txt_ok, f"统计子tab[{tab}] 渲染出内容({len(txt)} 字符)")
        check(cur == tab, f"统计子tab[{tab}] 高亮正确")
        if not (vis_ok and txt_ok):
            allok = False
    # 回 data tab 并断言图/热力关键区在
    js("switchStatsSubTab('data')")
    time.sleep(0.8)
    heat = js("!!document.getElementById('yearHeatmapContainer')")
    check(heat is True, "分析 tab 年度热力图容器存在")
    js("switchView('timer')")
    print(f"   ({time.time()-t0:.1f}s)")

# ============================================================
# F4 动线④ 设置深色 → 持久化 → 重开仍生效
# ============================================================
@case
def F4():
    t0 = time.time()
    print("▶ F4 深色设置持久化（重开生效）")
    first_run()
    js("switchView('settings')")
    time.sleep(0.8)
    check(js("document.body.classList.contains('dark-mode')") is False, "初始为浅色")
    # 真实拨动深色开关（onchange=toggleDarkMode）
    js("(function(){var c=document.getElementById('setDarkMode');if(c&&!c.checked)c.click();return 1;})()")
    time.sleep(0.8)
    check(js("document.body.classList.contains('dark-mode')") is True, "拨动开关立即切深色")
    darkFlag = js("appData.settings.darkMode") is True
    check(darkFlag, "settings.darkMode=true 已写入")
    # 持久化证据：主存储 payload 里 settings.darkMode=true
    # ★ 必须精确命中 STORAGE_KEY，不能"取第一个含 tomato_focus 的键"：
    #   旁边还有 tomato_focus_v3_stamp（写入戳，payload 是 {id,t}，没有 d）与
    #   _auto_backup；而 Object.keys(localStorage) 的顺序没有规范保证（实测同一组键
    #   在不同数量下表现不一致）。旧写法会读到戳、JSON.parse(undefined) 抛错、
    #   一路 catch 成 ERR，把"没存上"和"读错键"混成同一条红（与 C21 同一病根）。
    raw = js("""(function(){
      function pick(){
        if(localStorage.getItem('tomato_focus_v3')!=null) return 'tomato_focus_v3';
        var ks=Object.keys(localStorage);
        for(var i=0;i<ks.length;i++){var k=ks[i];
          if(k.indexOf('tomato_focus')!==0) continue;
          if(k.indexOf('_stamp')>=0||k.indexOf('_auto_backup')>=0) continue;
          return k;}
        return null;}
      var k=pick();
      if(!k) return 'ERR:nokey';
      try{var o=JSON.parse(localStorage.getItem(k));var d=JSON.parse(o.d);
        return d.settings.darkMode===true;}catch(e){return 'ERR:'+e.message;}})()""")
    check(raw is True, "主存储持久化 darkMode=true")
    # 重开：reload 模拟再次打开应用
    reload_wait()
    check(js("document.body.classList.contains('dark-mode')") is True, "重开后仍为深色")
    js("switchView('settings')")
    time.sleep(0.6)
    ck = js("document.getElementById('setDarkMode').checked") is True
    check(ck, "设置开关回显勾选态")
    # 复原浅色（不污染后续动线）
    js("(function(){var c=document.getElementById('setDarkMode');if(c&&c.checked)c.click();return 1;})()")
    time.sleep(0.5)
    print(f"   ({time.time()-t0:.1f}s)")

# ============================================================
# F5 动线⑤ 导出 → 清空 → 导入恢复（20+ 字段全等）
# ============================================================
@case
def F5():
    t0 = time.time()
    print("▶ F5 导出→清空→导入（20+ 字段全等）")
    first_run()
    # 1) 种子：覆盖主要业务子树
    js("""(function(){
      var t=getTodayStr(), yest=null;
      (function(){var d=new Date();d.setDate(d.getDate()-1);yest=(''+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));})();
      appData.settings.darkMode=true;
      appData.settings.workDuration=50;
      appData.todos=[{id:101,title:'E2E导出任务',done:false,detail:'详情',pomodoros:2,actualPomodoros:0,timeSpent:0,tag:'学习',deadline:'2026-12-31',remindAt:null,subs:[{id:1,title:'子1',done:false}],reminded:false},
                     {id:102,title:'未完成任务B',done:false,detail:'',pomodoros:null,actualPomodoros:0,timeSpent:0,tag:'',deadline:null,remindAt:null,subs:[],reminded:false}];
      appData.lastTodoCleanupDate=getTodayStr(); /* 注：已完成 todo 会被「每日清理(checkNewDay)」移除(产品特性)，故种子不含 done 项，保证导入全等可断言 */
      appData.habits=[{id:'hE2E',title:'早睡',icon:'😴'}];
      appData.habitLogs={hE2E:[t]};
      var now=Date.now();
      appData.records=[{id:now-1000,type:'full',taskName:'E2E导出任务',note:'备注A',startTime:now-1500000,endTime:now,effectiveSeconds:1500,pomos:1,difficulty:'medium',interruptions:0,totalInterruptSeconds:0,startEnergy:7,startMood:6,energy:7,mood:6,expectedPomodoros:2,actualPomodoros:0},
                       {id:now-2000,type:'half',taskName:'自由',note:'',startTime:now-3000000,endTime:now-2000000,effectiveSeconds:720,pomos:0.5,difficulty:'easy',interruptions:0,totalInterruptSeconds:0,startEnergy:null,startMood:null,energy:null,mood:null,expectedPomodoros:null,actualPomodoros:null}];
      appData.diaries={t:'E2E日记内容'};
      appData.tree.points=42; appData.tree.coins=17; appData.tree.species='oak';
      appData.round={full:5,half:2,incomplete:1,lastFullEndTime:now};
      appData.rankSystem.stars=8;
      appData.unlockedAchievements=['first','d7'];
      appData.mustDos={}; appData.mustDos[t]=[{id:7,title:'导出必做',done:false,est:2}];
      appData.mustDoRewarded={};
      appData.enhSettings.reminds=[{id:1,time:'08:00',text:'喝水',days:[1,2,3,4,5]}];
      /* 预置「运行时惰性补默认值」的字段：导入后 normalizeBackupData 会补 countdowns[].pinned/note，
         提醒模块会补 enhSettings.remindDone={}；种子不含它们就会让「导出 vs 导入」比出假差异
         （这两处都是「导入后按默认补齐」，不是数据丢失）。 */
      appData.enhSettings.remindDone={};
      appData.countdowns=[{id:55,title:'倒计时',target:now+86400000,pinned:0,note:''}];
      if (typeof saveDataNow==='function') saveDataNow();
      return true;})()""")
    reload_wait()
    # 页面内注入：捕获 a[download] 的 blob 文本 + confirm 桩（文件对话框/原生 confirm 无头不可用）
    js("""(function(){
      window.__e2e_dl=null;
      var orig=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){
        if (this.getAttribute&&this.getAttribute('download')){
          var self=this;
          try{ fetch(this.href).then(function(r){return r.text();}).then(function(t){window.__e2e_dl=t;}); }catch(e){ window.__e2e_dl='ERR:'+e.message; }
          return;
        }
        return orig.apply(this,arguments);
      };
      window.confirm=function(){return true;};
      return true;})()""")
    # 2) 真实点击「导出全部数据（JSON）」
    js("switchView('settings')")
    time.sleep(0.8)
    js("(function(){var bs=document.querySelectorAll('[data-act]');var b=null;for(var i=0;i<bs.length;i++){if(bs[i].getAttribute('data-act')==='exportData')b=bs[i];}if(b)b.click();return 1;})()")
    ok = jsw("window.__e2e_dl!==null", 5)
    check(ok, "导出触发并捕获到 JSON")
    dl = str(js("window.__e2e_dl") or "")
    if not dl or dl.startswith("ERR"):
        check(False, f"导出内容异常({dl[:120]})")
        return
    try:
        parsed = json.loads(dl)
    except Exception as e:
        check(False, f"导出的 JSON 可解析({e})")
        return
    expect_keys = ["version","exportSchema","exportDate","settings","todos","habits","habitLogs","records","diaries","tree",
                   "round","groupStates","countdowns","sortPrefs","weeklyBadges","rankSystem",
                   "unlockedAchievements","teamSystem","immersiveFocus","botLeaderboard",
                   "mustDos","mustDoUI","mustDoRewarded","enhSettings"]
    miss = [k for k in expect_keys if k not in parsed]
    check(not miss, f"导出覆盖 23 个顶层键({('缺:'+','.join(miss)) if miss else '全部齐备'})")
    # 3) 真实清空动线
    js("(function(){var bs=document.querySelectorAll('[data-act]');var b=null;for(var i=0;i<bs.length;i++){if(bs[i].getAttribute('data-act')==='clearAllData')b=bs[i];}if(b)b.click();return 1;})()")
    time.sleep(0.5)
    check(js("(function(){var m=document.getElementById('clearConfirmModal');return !!m&&m.classList.contains('show');})()") is True, "清除确认弹窗出现")
    js("(function(){var i=document.getElementById('clearConfirmInput');if(i){i.value='清除';i.dispatchEvent(new Event('input'));}return 1;})()")
    js("(function(){var bs=document.querySelectorAll('[data-act]');var b=null;for(var i=0;i<bs.length;i++){if(bs[i].getAttribute('data-act')==='confirmClearAllData')b=bs[i];}if(b)b.click();return 1;})()")
    ok = jsw("(typeof appData!=='undefined')&&appData.records&&appData.records.length===0&&typeof renderTodos==='function'", 10)
    check(ok, "确认清除后应用重开（records 已清空）")
    time.sleep(0.6)
    check(jsnum(js("appData.todos.length")) == 0, "清空后 todos=0")
    check(js("appData.settings.darkMode") is False, "清空后设置回默认(浅色)")
    # 4) 真实导入动线（CDP 注入 file input + 应用 onchange=importData）
    js("window.confirm=function(){return true;}")
    export_path = os.path.join(PROFILE, "e2e_export.json")
    with open(export_path, "w", encoding="utf-8") as f:
        f.write(dl)
    cdp("DOM.enable")
    doc = cdp("DOM.getDocument", {"depth": 1})["result"]["root"]["nodeId"]
    q = cdp("DOM.querySelector", {"nodeId": doc, "selector": "#importFile"})
    nid = q["result"]["nodeId"]
    if nid:
        cdp("DOM.setFileInputFiles", {"nodeId": nid, "files": [export_path]})
        # 应用内确认弹窗（0C 的 rsConfirm/rsAsk）是**异步**的：不再靠 window.confirm 打桩，
        # 改为模拟用户真实点击「继续导入」。导入确认一次；若自动备份失败还会再弹一次
        # 「无法自动备份」，故循环应对（最多两次），点完或不再出现即退出。
        for _ in range(3):
            if not jsw("!!document.querySelector('.rs-confirm [data-rs-ok]')", 4):
                break
            js("(function(){var b=document.querySelector('.rs-confirm [data-rs-ok]');if(b)b.click();return 1;})()")
            time.sleep(0.3)
        # 等 FileReader→validate→rsAsk→applyBackupData→重渲染 完成
        ok = jsw("(typeof appData!=='undefined')&&appData.records&&appData.records.length===2&&typeof renderTodos==='function'", 10)
        check(ok, "导入真实文件后 records 恢复 2 条")
    else:
        check(False, "找不到 #importFile")
    time.sleep(0.8)
    # 5) 全等断言（把导出 JSON 注入页面内比较，返回差异清单）
    js("window.__e2eP=" + json.dumps(json.dumps(parsed)))
    cmp = js("""(function(){
      var p=JSON.parse(window.__e2eP), a=appData, bad=[];
      function eq(x,y){return JSON.stringify(x)===JSON.stringify(y);}
      var keys=['settings','todos','habits','habitLogs','records','diaries','round','groupStates','countdowns','sortPrefs','weeklyBadges','rankSystem','unlockedAchievements','teamSystem','immersiveFocus','botLeaderboard','mustDos','mustDoUI','mustDoRewarded'];
      for(var i=0;i<keys.length;i++){var k=keys[i]; if(!eq(p[k],a[k])) bad.push(k);}
      /* enhSettings 单独比，且剔除 remindDone：它是「当日已提醒」的运行时状态，
         会随日期/初始化重算，不属于用户数据，不应参与备份全等（其余字段照常逐字段比）。 */
      (function(){
        var pe=JSON.parse(JSON.stringify(p.enhSettings||{})); delete pe.remindDone;
        var ae=JSON.parse(JSON.stringify(a.enhSettings||{})); delete ae.remindDone;
        if(!eq(pe,ae)) bad.push('enhSettings');
      })();
      var tk=['points','coins','species','harvests','milestones','fruitAlbum','decorations','scenes','activeScene','activeDecorations','lastActiveDate','lastHabitBonusDate','unlockedSpecies','fruitCount','totalFruitsHarvested','waterStreak','dewBadges','lastEternalStarAt'];
      for(var j=0;j<tk.length;j++){var k2=tk[j]; if(!eq(p.tree&&p.tree[k2],a.tree[k2])) bad.push('tree.'+k2);}
      /* todos 不一致时定位到具体字段（辅助排查） */
      var detail=[];
      if(bad.indexOf('todos')>=0){
        for(var x=0;x<p.todos.length;x++){
          var pp=p.todos[x], aa=a.todos[x];
          if(!aa){detail.push('todos['+x+'] 缺失');continue;}
          var keys2={}; for(var q in pp) keys2[q]=1; for(var q2 in aa) keys2[q2]=1;
          for(var f in keys2){ if(!eq(pp[f],aa[f])) detail.push('todos['+x+'].'+f); }
        }
      }
      /* enhSettings 不一致时同样定位到字段（惰性补默认值会体现为「导入后多出某键」） */
      if(bad.indexOf('enhSettings')>=0){
        var ek={}; for(var e1 in (p.enhSettings||{})) ek[e1]=1; for(var e2 in (a.enhSettings||{})) ek[e2]=1;
        for(var ef in ek){ if(!eq(p.enhSettings&&p.enhSettings[ef], a.enhSettings&&a.enhSettings[ef])) detail.push('enhSettings.'+ef); }
      }
      return JSON.stringify({ok:bad.length===0,nKeys:keys.length+tk.length,bad:bad,detail:detail});})()""")
    try:
        cres = json.loads(str(cmp))
    except Exception:
        cres = {"ok": False, "bad": [str(cmp)[:80]]}
    nRec = jsnum(js("appData.records.length"))
    if cres.get("ok"):
        check(True, f"导入后 {cres.get('nKeys')} 个字段与导出全等（records={nRec} 条/todos={jsnum(js('appData.todos.length'))} 条已恢复）")
    else:
        check(False, f"导入后存在不一致字段: {cres.get('bad')} 明细:{cres.get('detail')}")
    # 深色重开也恢复
    check(js("document.body.classList.contains('dark-mode')") is True, "导入后深色主题已恢复")
    print(f"   ({time.time()-t0:.1f}s)")

# ============================================================
# F6 导出分享面板分支（补充：无头 stub navigator.share 验证）
#   场景① share 成功：走系统分享、不落下载、副作用执行
#   场景② 用户取消(AbortError)：不落下载、不打扰
#   场景③ share 抛错：回退浏览器下载
#   场景④ 无 share 能力(canShare false)：回退浏览器下载
# ============================================================
@case
def F6():
    t0 = time.time()
    print("▶ F6 导出分享面板四分支（stub share）")
    first_run()
    js("switchView('settings')")
    time.sleep(0.8)
    # 注入下载捕获 + confirm 桩 + share 记录
    js("""(function(){
      window.__e2e_dl=null; window.__e2e_shareLog=[];
      var orig=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){
        if (this.getAttribute&&this.getAttribute('download')){
          var self=this;
          try{ fetch(this.href).then(function(r){return r.text();}).then(function(t){window.__e2e_dl=t;}); }catch(e){ window.__e2e_dl='ERR:'+e.message; }
          return;
        }
        return orig.apply(this,arguments);
      };
      window.confirm=function(){return true;};
      return true;})()""")
    # 直接用内联串设置 share/canShare 桩
    def set_share(jsmode):
        return js(
            "(function(){var mode='" + jsmode + "';function rec(p){window.__e2e_shareLog.push({name:p&&p.files&&p.files[0]?p.files[0].name:'',size:p&&p.files&&p.files[0]?p.files[0].size:0});}"
            "var share;if(mode==='ok'){share=function(p){rec(p);return Promise.resolve();};}"
            "else if(mode==='cancel'){share=function(){return Promise.reject({name:'AbortError',message:'cancel'});};}"
            "else if(mode==='err'){share=function(){return Promise.reject(new Error('share boom'));};}"
            "else if(mode==='unavail'){share=undefined;}"
            "var can=(mode==='nocap')?function(){return false;}:function(){return true;};"
            "try{Object.defineProperty(navigator,'share',{configurable:true,value:share});}catch(e){navigator.share=share;}"
            "try{Object.defineProperty(navigator,'canShare',{configurable:true,value:can});}catch(e){navigator.canShare=can;}"
            "return true;})()"
        )
    def click_export():
        js("window.__e2e_dl=null;")
        js("(function(){var bs=document.querySelectorAll('[data-act]');var b=null;for(var i=0;i<bs.length;i++){if(bs[i].getAttribute('data-act')==='exportData')b=bs[i];}if(b)b.click();return 1;})()")
        time.sleep(0.9)
    def is_dl_json():
        v = str(js("window.__e2e_dl") or "")
        if not v or v.startswith("ERR"):
            return False
        try:
            json.loads(v)
            return True
        except Exception:
            return False
    # ① share 成功 → 走分享、不落下载、副作用执行
    set_share("ok")
    click_export()
    logs = str(js("JSON.stringify(window.__e2e_shareLog)") or "[]")
    check("tomato_backup_" in logs and ".json" in logs, f"share 收到文件参数({logs[:90]})")
    check(js("window.__e2e_dl") is None, "share 成功后不触发浏览器下载")
    le = js("appData.lastExportDate")
    check(le == js("getTodayStr()"), f"导出副作用 lastExportDate 已更新({le})")
    # ② 用户取消 AbortError → 不落下载、无异常
    set_share("cancel")
    click_export()
    check(js("window.__e2e_dl") is None, "用户取消分享不落下载")
    # ③ share 抛错 → 回退下载，JSON 完整
    set_share("err")
    click_export()
    check(is_dl_json(), "share 抛错自动回退浏览器下载(JSON 可解析)")
    # ④ 无分享能力（canShare=false）→ 回退下载
    set_share("nocap")
    click_export()
    check(is_dl_json(), "canShare=false 走浏览器下载(JSON 可解析)")
    # ⑤ 完全无 share API（老环境）→ 回退下载
    set_share("unavail")
    click_export()
    check(is_dl_json(), "无 navigator.share 走浏览器下载(JSON 可解析)")
    print(f"   ({time.time()-t0:.1f}s)")

# ============================================================
# F7 动线⑦ 错误角标 → 点击 → 面板打开并渲染（M1 运行时监控）
#   回归：旧 bug 因 renderPanel 用内联样式字符串做选择器（浏览器序列化后
#   "overflow:auto"→"overflow: auto" 带空格），命中恒为 null，
#   openPanel 抛 "Cannot set properties of null"，面板永远打不开、
#   且每次点击自增一条错误。本动线锁死"点得开 + 渲染得出 + 零异常"。
# ============================================================
@case
def F7():
    t0 = time.time()
    print("▶ F7 错误角标 → 点开面板 → 渲染内容")
    first_run()
    # 确保角标未被「本会话关闭」标记
    js("(function(){try{if(window.__errRep&&appData&&appData.uiPrefs){appData.uiPrefs.errBadgeOff=false;}}catch(e){}return 1;})()")
    # 清空历史，制造已知起点
    js("(function(){try{window.__errRep.clear();}catch(e){}return 1;})()")
    time.sleep(0.3)
    check(js("typeof window.__errRep") == "object", "__errRep 已挂载")
    # 1) 推入一个 error → 角标出现且计数=1
    js("(function(){window.__errRep.push(new Error('E2E-ERRBADGE 探针'),'e2e');return 1;})()")
    time.sleep(0.4)
    badgeTxt = str(js("(function(){var b=document.getElementById('m1ErrBadge');return b?b.textContent:'';})()") or "")
    check("1 个错误" in badgeTxt, f"角标显示 1 个错误({badgeTxt.strip()})")
    check(js("(function(){var b=document.getElementById('m1ErrBadge');return b?b.style.display:'';})()") == "flex", "角标可见")
    # 2) 点击角标 → 面板必须打开（旧 bug 此处 display 恒为 none）
    js("document.getElementById('m1ErrBadge').click()")
    time.sleep(0.4)
    check(js("(function(){var p=document.getElementById('m1ErrPanel');return p?p.style.display:'';})()") == "flex",
          "点击角标后面板打开(display=flex)")
    # 3) 面板内容容器存在且渲染出错误文案
    check(js("!!document.getElementById('m1ErrBody')") is True, "面板内容容器 #m1ErrBody 存在")
    bodyTxt = str(js("(function(){var d=document.getElementById('m1ErrBody');return d?d.textContent:'';})()") or "")
    check("E2E-ERRBADGE" in bodyTxt, f"面板渲染出错误内容({bodyTxt.strip()[:60]})")
    # 4) 关闭（✕）→ 面板收起、角标恢复
    js("(function(){var c=document.getElementById('m1ErrClose');if(c)c.click();return 1;})()")
    time.sleep(0.3)
    check(js("(function(){var p=document.getElementById('m1ErrPanel');return p?p.style.display:'';})()") == "none",
          "点 ✕ 后面板收起")
    check(js("(function(){var b=document.getElementById('m1ErrBadge');return b?b.style.display:'';})()") == "flex",
          "关闭面板后角标恢复可见")
    # 5) 再点开 → 清空 → 面板显示"暂无记录"
    js("document.getElementById('m1ErrBadge').click()")
    time.sleep(0.3)
    js("(function(){var ps=document.querySelectorAll('#m1ErrPanel button');for(var i=0;i<ps.length;i++){if(ps[i].textContent==='清空'){ps[i].click();return 1;}}return 0;})()")
    time.sleep(0.3)
    bodyTxt2 = str(js("(function(){var d=document.getElementById('m1ErrBody');return d?d.textContent:'';})()") or "")
    check("暂无记录" in bodyTxt2, f"清空后面板显示暂无记录({bodyTxt2.strip()[:30]})")
    check(js("(function(){var b=document.getElementById('m1ErrBadge');return b?b.style.display:'';})()") == "none",
          "清空后角标隐藏")
    # 收尾：恢复未关闭态
    js("(function(){try{if(appData&&appData.uiPrefs)appData.uiPrefs.errBadgeOff=false;}catch(e){}return 1;})()")
    print(f"   ({time.time()-t0:.1f}s)")

# ================= main =================
def main():
    global _PAGE_WS, _PAGE_JS, _PAGE_ERRS
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
    print(f"🍅 E2E 核心动线  |  目标: {APP}\n")
    sel = [c for c in _cases if not only or c.__name__ == only]
    if not sel:
        print("没有匹配动线"); sys.exit(2)
    # 启动 chromium（复用 run_smoke.launch：返回 ws / js 闭包 / 未捕获异常收集）
    _w, _js, _errs = _rs.launch()
    _PAGE_WS, _PAGE_JS, _PAGE_ERRS = _w, _js, _errs
    for fn in sel:
        before = (PASS, FAIL)
        err0 = len(_PAGE_ERRS)
        try:
            fn()
        except Exception as e:
            import traceback
            traceback.print_exc()
            check(False, f"动线 {fn.__name__} 异常: {e}")
        new_err = _PAGE_ERRS[err0:]
        if new_err:
            check(False, f"动线 {fn.__name__} 期间产生 {len(new_err)} 个未捕获 JS 异常")
            for e in new_err[:3]:
                print("     !", e[:160])
        print(f"   (+{PASS-before[0]}p)\n")
    print("=" * 46)
    print(f"断言: PASS {PASS}  FAIL {FAIL}")
    if FAILURES:
        print("失败项:")
        for f in FAILURES:
            print("  ✗", f)
    try:
        _PAGE_WS.close()
    except Exception:
        pass
    subprocess.run(["pkill", "-f", f"remote-debugging-port={PORT}"], capture_output=True)
    sys.exit(1 if FAIL else 0)

if __name__ == "__main__":
    main()
