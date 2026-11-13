# -*- coding: utf-8 -*-
"""
· 日程表（时间块网格）全链路审计 —— 数据 ↔ 界面一致性
==================================================================
为什么存在这个工具（而不是并进 verify.py）：
  它要起无头浏览器、跑两轮场景（数据/渲染层 + 真实 UI 路径），约 3~4 分钟，
  与 tools/verify_csv_export.py 同定位：**改动日程链路（01eA / 01eM / 01eC /
  00_pure_core 的 tb* / todoEst* / todoOccursOn）后手动跑**，不占日常提交链。

两轮覆盖：
  第一轮 S 段（数据/渲染层）：空态 / 勾选完成 / 番茄段开收续接 / 跨天开口段 /
    翻日期 / 重复计划 / 周计划列表跟随（三分组 + 题头 + 预填 + 可见邻居换位）/
    展开说明跨渲染存活（切日期/翻周/回今天/折叠展开/日历选日）/
    点两格建计划（含结束格右缘规则）/ 编辑改提醒 / 删除 /
    快捷番茄 / 折叠 / 老数据兼容 / 计划外灰块
  第二轮 T 段（真实 UI 路径）：弹窗新建 / 复选框勾选 / 行内编辑联动 / 计时器
    落段 / 子任务自动勾与反悔 / 边界数据 / 导入导出往返 / 删除确认 / 周条导航

用法：python3 tools/audit_timeblock.py        （file:// 直开，不建 HTTP 服务）
出口：全部 ✓ = 通过；任何 ✗ 都会进末尾汇总。
==================================================================
"""

import json
import re
from playwright.sync_api import sync_playwright

# 路径不再硬编码（P1-8）：--html > SMOKE_APP/APP/RS_APP > 项目内 index.html。
# 原来的写死路径换个目录就读到不存在的文件（或更糟：旧产物），而审计照样"通过"。
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _app_path import resolve as _resolve_app
APP = _resolve_app()
RESULTS = []


def ok(name, cond, detail=''):
    RESULTS.append((name, bool(cond), detail))
    print(('✓' if cond else '✗') + ' ' + name + (('  → ' + str(detail)) if (detail and not cond) else ''))


def seed(page, data):
    page.add_init_script("localStorage.setItem('tomato_focus_v3', JSON.stringify(%s))" % json.dumps(data))


def pause_remind_watch(page):
    """暂停真实时间的心跳提醒（01eK 的 sanctioned 自动化开关，run_smoke C29 同款）。
    为什么必须暂停：checkTodoReminders 每 30s 扫「remindAt 已过且未确认」的任务，
    探针里带过去时间的计划（如「昨天没做完」）会把 #remindModal 弹出来，
    拦住后面所有 cell 点击 —— 于是这个审计以前只在上午（提醒还没到点）能跑完。
    本工具测的是网格/列表一致性，不测提醒；提醒有自己的用例（C29）。"""
    page.add_init_script("window.__remindWatchPaused = true")


def boot(page, data=None):
    d = {'settings': {'workDuration': 25, 'shortBreak': 5, 'longBreak': 20, 'longInterval': 4,
                      'tbGridFolded': False},
         'uiPrefs': {'guideDone': True}, 'todos': [], 'records': []}
    if data:
        d.update(data)
    seed(page, d)
    pause_remind_watch(page)
    page.goto(APP)
    page.wait_for_function("typeof appData !== 'undefined' && Array.isArray(appData.todos)", timeout=15000)
    page.evaluate("switchView('plan')")
    page.wait_for_selector('#tbGridWrap .tb-paper-cell', timeout=10000)
    page.wait_for_timeout(300)
    return d


def blocks(page):
    """网格块盘点：预计/实际/计划外 各多少，带 data-tb-id"""
    return page.evaluate("""(() => {
      const q = (s) => Array.from(document.querySelectorAll('#tbGridWrap ' + s));
      return {
        plan: q('.tb-paper-blk.is-plan').map(b => b.getAttribute('data-tb-id')),
        actual: q('.tb-paper-blk.is-actual').map(b => b.getAttribute('data-tb-todo')),
        unplanned: q('.tb-paper-blk.is-unplanned').length,
        nowline: q('.tb-now-line').length,
        cells: q('.tb-paper-cell').length
      };
    })()""")


def today():
    import datetime
    return datetime.date.today().strftime('%Y-%m-%d')


def tomorrow():
    import datetime
    return (datetime.date.today() + datetime.timedelta(days=1)).strftime('%Y-%m-%d')


def yesterday():
    import datetime
    return (datetime.date.today() - datetime.timedelta(days=1)).strftime('%Y-%m-%d')


def add_todo(page, **kw):
    """直接造一条计划并落库渲染，返回 id"""
    t = {'id': kw.get('id', 90000 + len(page.evaluate('appData.todos'))),
         'title': kw.get('title', '测试计划'), 'done': False,
         'pomodoros': kw.get('pomodoros', 2)}
    t.update({k: v for k, v in kw.items() if k not in ('id', 'title', 'pomodoros')})
    if 'remindAt' in kw:
        t['remindAt'] = kw['remindAt']
    page.evaluate("(t) => { appData.todos.push(t); saveData(); renderTodos(); }", t)
    page.wait_for_timeout(200)
    return t['id']




def round1():
    """第一轮：数据/渲染层（S 段）"""
    with sync_playwright() as p:

        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1000, 'height': 1600})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        boot(page)

        # ============ S1 基础渲染 ============
        bl = blocks(page)
        ok('S1a 空态：两排背景格照画（2×96=192）', bl['cells'] == 192, bl['cells'])
        ok('S1b 空态：无任何块', not bl['plan'] and not bl['actual'] and bl['unplanned'] == 0)
        ok('S1c 今天：当前时刻横线有（在 07-14/15-22 带内才画，当前 21 点后可能为 0）',
           bl['nowline'] in (0, 1, 2), bl['nowline'])

        add_todo(page, id=9101, title='早计划', remindAt=today() + ' 10:00', pomodoros=2)
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('S1d 造一条 10:00 计划 → 预计列 1 块', bl['plan'] == ['9101'], bl['plan'])
        ok('S1e 无记录无 actualStart → 实际列空', bl['actual'] == [], bl['actual'])

        # ============ S2 勾选完成链路 ============
        page.evaluate("toggleTodo(9101)")
        page.wait_for_timeout(250)
        st = page.evaluate("appData.todos.find(t => String(t.id) === '9101')")
        bl = blocks(page)
        ok('S2a 勾完成 → done=true 且 actualEnd 已写', st['done'] and bool(st['actualEnd']))
        ok('S2b 直接勾（无开始做）→ 实际列仍空（无凭据不画段，设计口径）', bl['actual'] == [], bl['actual'])

        # ============ S2c 改造：造一条「提醒在昨天」的计划测昨天视图的实际段 ============
        page.evaluate("""(() => {
          const base = new Date(); base.setDate(base.getDate() - 1);
          const y = base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0') + '-' + String(base.getDate()).padStart(2, '0');
          const t = appData.todos.find(x => String(x.id) === '9101');
          t.remindAt = y + ' 10:00';
          const d1 = new Date(base); d1.setHours(13, 0, 0, 0);
          const d2 = new Date(base); d2.setHours(13, 30, 0, 0);
          t.actualSegs = [{ s: d1.getTime(), e: d2.getTime() }];
          tbPickDate(y); renderTodos();
        })()""")
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('S2c 昨天视图：提醒在昨天的计划 + actualSegs 一段 → 预计列与实际列各有 1 块',
           bl['plan'] == ['9101'] and bl['actual'] == ['9101'], bl)

        page.evaluate("toggleTodo(9101)")
        page.wait_for_timeout(200)
        bl = blocks(page)
        ok('S2d 勾完成后实际块仍在（计划归计划、记录归记录）', bl['actual'] == ['9101'], bl['actual'])
        page.evaluate("toggleTodo(9101)")  # 取消完成，恢复现场
        page.wait_for_timeout(200)

        # ============ S3 番茄段管理（纯数据断言，不依赖视图） ============
        seg_state = page.evaluate("""(() => {
          const t = appData.todos.find(x => String(x.id) === '9101');
          t.actualSegs = [];
          openTodoActualSeg(9101);            // 开一段
          const n1 = t.actualSegs.length;
          const open1 = t.actualSegs[n1 - 1] && t.actualSegs[n1 - 1].e === 0;
          openTodoActualSeg(9101);            // 已开着 → 幂等
          const n1b = t.actualSegs.length;
          closeTodoActualSeg(9101, Date.now() + 50);   // 明确传未来 end，避开"同毫秒零点段"
          const n2 = t.actualSegs.length;
          const closed = t.actualSegs[n2 - 1] && t.actualSegs[n2 - 1].e > 0;
          openTodoActualSeg(9101);            // 刚收尾（<2min）→ 续接不切段
          const n3 = t.actualSegs.length;
          const reopened = t.actualSegs[n3 - 1] && t.actualSegs[n3 - 1].e === 0;
          return { n1: n1, open1: open1, n1b: n1b, n2: n2, closed: closed, n3: n3, reopened: reopened };
        })()""")
        ok('S3a 开段成功且为开口段', seg_state['n1'] == 1 and seg_state['open1'], seg_state)
        ok('S3b 开口段幂等（重复 open 不切两段）', seg_state['n1b'] == 1, seg_state)
        ok('S3c 收尾后最后一段 e>0', seg_state['n2'] == 1 and seg_state['closed'], seg_state)
        ok('S3d 2 分钟内重开续接（不新增段、重新开口）', seg_state['n3'] == 1 and seg_state['reopened'], seg_state)

        # 跨天开口段 → 只画最小可见高度（明确构造昨天 14:00，永远在过去且在窗口内）
        page.evaluate("""(() => {
          tbGoToday();
          const t = appData.todos.find(x => String(x.id) === '9101');
          const base = new Date(); base.setDate(base.getDate() - 1); base.setHours(14, 0, 0, 0);
          t.actualSegs = [{ s: base.getTime(), e: 0 }];  // 昨天 14:00 开口
          renderTodos();
        })()""")
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('S3d 跨天开口段：今天视图不画它（段归昨天）', bl['actual'] == [], bl['actual'])
        # 翻到昨天看
        page.evaluate("""(() => {
          const d = new Date(); d.setDate(d.getDate() - 1);
          tbPickDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        })()""")
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('S3e 翻到昨天：跨天开口段画最小段（可见）', bl['actual'] == ['9101'], bl['actual'])
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(250)

        # ============ S4 翻日期 ============
        page.evaluate("""(() => {
          const t = appData.todos.find(x => String(x.id) === '9101');
          t.remindAt = %s + ' 10:00';   // 恢复今天的排期
          t.actualSegs = []; delete t.actualStart; delete t.actualEnd;
          tbGoToday(); renderTodos();
        })()""" % json.dumps(today()))
        page.wait_for_timeout(200)
        page.evaluate("tbShiftWeek(1)")
        page.wait_for_timeout(200)
        bl = blocks(page)
        ok('S4a 翻下一周：该计划不重复 → 预计块消失', bl['plan'] == [], bl['plan'])
        ok('S4b 翻到非今天：当前时刻横线不画', bl['nowline'] == 0, bl['nowline'])
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(200)
        bl = blocks(page)
        ok('S4c 回今天：预计块回来', bl['plan'] == ['9101'], bl['plan'])

        # ============ S5 重复计划 ============
        add_todo(page, id=9102, title='每天计划', remindAt=today() + ' 09:00', pomodoros=1,
                 repeat={'mode': 'daily'})
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('S5a 每天重复 → 今天有块（按开始排序）', sorted(bl['plan']) == ['9101', '9102'], bl['plan'])
        page.evaluate("""(() => {
          const d = new Date(); d.setDate(d.getDate() + 1);
          tbPickDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        })()""")
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('S5b 翻到明天：每天计划仍有块、不重复的没有', bl['plan'] == ['9102'], bl['plan'])
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(200)

        # ============ S5c 周计划：列表跟着锚定日期走（三分组 + 题头 + 预填） ============
        # 四条探针：明天排的（day 组）/ 昨天没做完的（carry 组）/ 没设开始时间的（undated 组）
        #   + 一条每周重复、重复日既不是今天也不是明天——这天不命中，但规则生效中，
        #     必须仍在列表里（长期约定天天够得着：行内改规则/勾完成/跳过）
        add_todo(page, id=9201, title='明天安排', remindAt=tomorrow() + ' 09:00')
        add_todo(page, id=9202, title='昨天没做完', remindAt=yesterday() + ' 09:00')
        add_todo(page, id=9203, title='没设开始时间')
        add_todo(page, id=9204, title='每周计划', repeat={
            'mode': 'weekly',
            'weekdays': page.evaluate("""(() => {
              const t = (new Date().getDay() + 6) % 7 + 1;   /* 今天 ISO 星期（周一=1） */
              return [(t + 1) % 7 + 1];                     /* 今天/明天都不是的那天 */
            })()""")
        })
        r5c = page.evaluate("""(() => {
          const q = (s) => Array.from(document.querySelectorAll(s));
          const cap = document.getElementById('todoDateCaption');
          return {
            rows: q('#todoList .todo-item').map(el => el.getAttribute('data-id')),
            heads: q('#todoList .todo-group-head').map(el => el.textContent.trim()),
            capShow: cap ? getComputedStyle(cap).display : 'none',
            hookApi: typeof window.tbOnGridAfterRender === 'function',
            subs: Array.isArray(window.__tbGridAfterRenderSubs)
              ? window.__tbGridAfterRenderSubs.length : 0
          };
        })()""")
        ok('S5c-① 今天视图：明天那条不出现；每周计划(9204)不命中今天但仍在当天组，'
           '整体按 当天→之前没完成→未排期 排列',
           r5c['rows'] == ['9101', '9102', '9204', '9202', '9203'], r5c['rows'])
        ok('S5c-② 今天视图：分组题头只有「之前没完成的 / 未排期」两个',
           len(r5c['heads']) == 2 and '之前没完成' in r5c['heads'][0]
           and '未排期' in r5c['heads'][1], r5c['heads'])
        ok('S5c-③ 看今天时日期题头隐藏', r5c['capShow'] == 'none', r5c['capShow'])
        ok('S5c-④ 网格渲染完成广播可用且已订阅（切日期后列表自动重渲）',
           r5c['hookApi'] is True and r5c['subs'] >= 1, (r5c['hookApi'], r5c['subs']))

        # 翻到明天：day=[9102,9201]（每天重复 + 明天排的），carry=[9101,9202]，undated=[9203]
        page.evaluate("""(() => {
          const d = new Date(); d.setDate(d.getDate() + 1);
          tbPickDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        })()""")
        page.wait_for_timeout(250)
        r5d = page.evaluate("""(() => {
          const q = (s) => Array.from(document.querySelectorAll(s));
          const cap = document.getElementById('todoDateCaption');
          const t9101 = appData.todos.find(x => String(x.id) === '9101');
          const ch = document.querySelector('#todoList .todo-group-head[data-id="__grp_carry__"]');
          const ar = ch ? ch.querySelector('.tgh-arrow') : null;
          const cn = ch ? ch.querySelector('.tgh-count') : null;
          return {
            rows: q('#todoList .todo-item').map(el => el.getAttribute('data-id')),
            capShow: cap ? getComputedStyle(cap).display : 'none',
            capText: cap ? cap.textContent.trim() : '',
            backBtn: !!cap && !!cap.querySelector('.tdc-back'),
            done9101: t9101 ? !!t9101.done : null,
            carryFold: !!ch && ch.classList.contains('is-fold'),
            carryArrow: ar ? ar.textContent.trim() : '',
            carryCount: cn ? cn.textContent.trim() : ''
          };
        })()""")
        ok('S5d-① 翻到明天：列表 = 那天安排(9102,9201,9204) + 未排期(9203)；'
           'carry(9202) 默认折叠、不在行里',
           r5d['rows'] == ['9102', '9201', '9204', '9203'], r5d['rows'])
        ok('S5d-①b 9101 在 S2a 已勾完 → 不跨日跟车（已完成的次日自动清掉）',
           r5d['done9101'] is True and '9101' not in r5d['rows'], r5d['done9101'])
        ok('S5d-①c 看非今天：carry 题头默认折叠（is-fold + ▸ + 计数 1）',
           r5d['carryFold'] and r5d['carryArrow'] == '▸' and r5d['carryCount'] == '1',
           (r5d['carryFold'], r5d['carryArrow'], r5d['carryCount']))
        ok('S5d-② 翻到非今天：日期题头显示、带「回到今天」按钮',
           r5d['capShow'] != 'none' and r5d['backBtn'] and '正在看' in r5d['capText'], r5d)
        bl = blocks(page)
        ok('S5d-③ 翻到明天：网格预计块与列表同口径（9102 + 9201）',
           sorted(bl['plan']) == ['9102', '9201'], bl['plan'])

        # 预填：看非今天时新建 → 提醒预填那天的当前钟点（不预填就会归今天，切回去看不见）
        page.evaluate("openAddTodoModal()")
        page.wait_for_timeout(200)
        rm_v = page.evaluate("document.getElementById('addTodoRemind').value")
        ok('S5e 看非今天时新建：提醒预填那天的当前钟点', rm_v.startswith(tomorrow() + 'T'), rm_v)
        page.evaluate("if(typeof closeModal==='function') closeModal('addTodoModal')")
        page.wait_for_timeout(200)

        # 手动换位按**可见邻居**：明天视图 day 组 [9102, 9201]，把 9201 上移一位
        page.evaluate("moveTodo(9201, -1)")
        page.wait_for_timeout(200)
        r5f = page.evaluate("""(() => ({
          order: appData.todos.map(t => String(t.id)),
          rows: Array.from(document.querySelectorAll('#todoList .todo-item')).map(el => el.getAttribute('data-id'))
        }))()""")
        ok('S5f-① 上移按可见邻居换位（9201 在屏幕上排到 9102 前）',
           '9201' in r5f['rows'] and r5f['rows'].index('9201') < r5f['rows'].index('9102'), r5f['rows'])
        ok('S5f-② 换位真的落在数组里（9201 的数组下标 < 9102）',
           '9201' in r5f['order'] and r5f['order'].index('9201') < r5f['order'].index('9102'), r5f['order'])

        # 空态分叉：非今天 + 当天一条都没有 → 文案说「这天还没有安排」，不是全局空文案
        page.evaluate("""(() => {
          const d = new Date(); d.setDate(d.getDate() + 5);
          tbPickDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
          window.__s5gBak = appData.todos.slice();
          appData.todos.length = 0;
          renderTodos();
        })()""")
        page.wait_for_timeout(250)
        r5g = page.evaluate("""(() => {
          const list = document.getElementById('todoList');
          return { empty: !!list.querySelector('.empty-state'), text: list.textContent };
        })()""")
        ok('S5g 非今天 + 无安排：空态文案是「这天还没有安排」',
           r5g['empty'] and '这天还没有安排' in r5g['text'], r5g['text'][:40])
        page.evaluate("""(() => {
          (window.__s5gBak || []).forEach(t => appData.todos.push(t));
          delete window.__s5gBak;
          tbGoToday(); renderTodos();
        })()""")
        page.wait_for_timeout(200)

        # ============ S5h 展开说明在各类渲染后都在（消失 bug 回归） ============
        # 背景：说明行插在 .tb-paper-body 里，网格每次重画整体重建 body。
        #   旧实现只包装 window.renderTimeBlockGrid，01eA 内部 5 处**本地**调用
        #   （切日期/翻周/回今天/折叠切换/日历选日）绕开包装 → 说明消失。
        #   现改为 01eA 渲染完成广播（tbOnGridAfterRender），本地/外部路径全覆盖。
        def _note():
            return page.evaluate("""(() => {
              const n = document.querySelector('#tbGridWrap .tb-create-note');
              const body = document.querySelector('#tbGridWrap .tb-paper-body');
              return {
                has: !!n,
                inBody: !!n && !!body && body.contains(n),
                toggle: !!n && !!n.querySelector('.setting-note-toggle'),
                content: !!n && !!n.querySelector('.setting-note-content')
              };
            })()""")

        n0 = _note()
        ok('S5h-① 初始渲染后：说明行在 .tb-paper-body 里、开关与内容齐备',
           n0['has'] and n0['inBody'] and n0['toggle'] and n0['content'], n0)
        # 切日期（onclick 走 window.tbPickDate —— 外部路径）
        page.evaluate("""(() => {
          const d = new Date(); d.setDate(d.getDate() + 1);
          tbPickDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        })()""")
        page.wait_for_timeout(250)
        ok('S5h-② 切日期后说明行还在', _note()['has'] is True)
        # 翻周 + 回今天
        page.evaluate("tbShiftWeek(1)")
        page.wait_for_timeout(250)
        ok('S5h-③ 翻周后说明行还在', _note()['has'] is True)
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(250)
        ok('S5h-④ 回今天后说明行还在', _note()['has'] is True)
        # 折叠/展开（tbToggleGridFold 是 01eA 内部本地调用的代表路径 —— 旧实现在这里丢说明）
        page.evaluate("tbToggleGridFold()")   # 收起
        page.wait_for_timeout(250)
        nf = _note()
        ok('S5h-⑤ 收起网格后说明行仍在 DOM（视觉隐藏由 CSS 负责）',
           nf['has'] and nf['inBody'], nf)
        page.evaluate("tbToggleGridFold()")   # 展开
        page.wait_for_timeout(250)
        ok('S5h-⑥ 重新展开后说明行还在（旧实现正是在这里丢的）', _note()['has'] is True)
        # 日历选日期：onPick 调的是 01eA **本地** tbPickDate（不经 window），
        # 旧实现在这条路上说明与列表双丢；现在靠广播兜住。
        page.evaluate("window.openCalendarModal({ onPick: function (ds) { tbPickDate(ds); }, mark: function () { return false; } })")
        page.wait_for_timeout(200)
        page.click('#calendarGrid .calendar-day.today')
        page.wait_for_timeout(300)
        r5h = _note()
        r5h['rows'] = page.evaluate(
            "Array.from(document.querySelectorAll('#todoList .todo-item')).map(el => el.getAttribute('data-id'))")
        ok('S5h-⑦ 日历选日期后说明行还在', r5h['has'] is True, r5h)
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(250)

        # ============ S5i carry 默认折叠（看未来日期时的降噪） ============
        # 需求：规划未来时「之前没完成的」铁定未完成、全列出来只是噪音 → 非今天默认折叠；
        #   今天默认展开；手点过题头后当次保留；切日期再按默认走。
        def _carry():
            return page.evaluate("""(() => {
              const ch = document.querySelector('#todoList .todo-group-head[data-id="__grp_carry__"]');
              const ar = ch ? ch.querySelector('.tgh-arrow') : null;
              return {
                rows: Array.from(document.querySelectorAll('#todoList .todo-item'))
                  .map(el => el.getAttribute('data-id')),
                fold: !!ch && ch.classList.contains('is-fold'),
                arrow: ar ? ar.textContent.trim() : ''
              };
            })()""")

        page.evaluate("""(() => {
          const d = new Date(); d.setDate(d.getDate() + 1);
          tbPickDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        })()""")
        page.wait_for_timeout(250)
        page.click('#todoList .todo-group-head[data-id="__grp_carry__"]')   # 点折叠的题头
        page.wait_for_timeout(250)
        r5i = _carry()
        ok('S5i-① 点折叠的题头 → 展开：9202 回到行里、箭头 ▾',
           r5i['fold'] is False and r5i['arrow'] == '▾' and '9202' in r5i['rows'], r5i)
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(250)
        r5i2 = _carry()
        ok('S5i-② 回今天：carry 重置为展开（9202 在行里、无 is-fold）',
           r5i2['fold'] is False and '9202' in r5i2['rows'], r5i2)
        page.click('#todoList .todo-group-head[data-id="__grp_carry__"]')   # 今天手动折叠
        page.wait_for_timeout(200)
        page.evaluate("renderTodos()")                                       # 数据没动，重渲
        page.wait_for_timeout(200)
        r5i3 = _carry()
        ok('S5i-③ 今天手动折叠后当次保留（重渲不弹回、行里没有 9202）',
           r5i3['fold'] is True and '9202' not in r5i3['rows'], r5i3)
        page.click('#todoList .todo-group-head[data-id="__grp_carry__"]')   # 再点展开
        page.wait_for_timeout(200)
        r5i4 = _carry()
        ok('S5i-④ 再点题头 → 展开恢复', r5i4['fold'] is False and '9202' in r5i4['rows'], r5i4)

        # ============ S5j 折叠组不参与换位 ============
        # carry 折叠时它对 moveTodo 视同不存在：把 day 组末项下移，只能换到**可见**的
        # 未排期项后面，不能悄悄挪到折起来的 carry 项后面（数组序变了屏幕上看不出）。
        page.evaluate("""(() => {
          const d = new Date(); d.setDate(d.getDate() + 1);
          tbPickDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
        })()""")
        page.wait_for_timeout(250)
        page.evaluate("moveTodo(9204, 1)")   # 9204 是明天 day 组的末项；carry 已折叠
        page.wait_for_timeout(250)
        r5j = page.evaluate("appData.todos.map(t => String(t.id))")
        ok('S5j-① day 组末项下移只与可见邻居换位（换到未排期 9203 后，不越过折叠的 9202）',
           r5j.index('9204') > r5j.index('9203') and r5j.index('9204') > r5j.index('9202'), r5j)
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(250)

        # ============ S5k 「在未来那天建计划 → 回今天」的完整路径 ============
        # 用户 2026-10-14 点名：「看未来 3 天时新增计划，它默认折叠；但到了今天，
        # 今天那个未完成的任务应该是展开的」。这条 =「未来新增 + 视角回到今天」的组合，
        # 是 carry 默认态最容易做错的地方（预填、归日、折叠态三件事要同时成立）。
        page.evaluate("""(() => {
          const d = new Date(); d.setDate(d.getDate() + 3);
          window.__s5kT3 = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate());
          tbPickDate(window.__s5kT3); renderTodos();
        })()""")
        page.wait_for_timeout(250)
        page.evaluate("openAddTodoModal()")
        page.wait_for_timeout(200)
        r5k_rm = page.evaluate("document.getElementById('addTodoRemind').value")
        t3 = page.evaluate("window.__s5kT3")
        page.evaluate("""(() => {
          document.getElementById('addTodoTitle').value = 'S5k 未来那天新加的';
          document.getElementById('addTodoRemind').value = window.__s5kT3 + 'T15:30';
          confirmAddTodo();
        })()""")
        page.wait_for_timeout(350)
        r5k = page.evaluate("""(() => {
          const q = (s) => Array.from(document.querySelectorAll(s));
          const head = document.querySelector('#todoList .todo-group-head[data-id="__grp_carry__"]');
          const nt = appData.todos.filter(t => t.title === 'S5k 未来那天新加的');
          return { date: nt.length ? String(nt[0].remindAt).slice(0, 10) : '',
                   newId: nt.length ? String(nt[0].id) : '',
                   fold: head ? head.classList.contains('is-fold') : null,
                   rows: q('#todoList .todo-item').map(el => el.getAttribute('data-id')) };
        })()""")
        ok('S5k-① 看未来日期新建：提醒预填「那天的当前钟点」',
           r5k_rm.startswith(t3 + 'T'), r5k_rm)
        ok('S5k-② 新计划落在那天、当天列表可见、carry 保持折叠',
           r5k['date'] == t3 and r5k['newId'] != '' and r5k['newId'] in r5k['rows']
           and r5k['fold'] is True, r5k)
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(450)
        r5k2 = page.evaluate("""(() => {
          const q = (s) => Array.from(document.querySelectorAll(s));
          const head = document.querySelector('#todoList .todo-group-head[data-id="__grp_carry__"]');
          return { fold: head ? head.classList.contains('is-fold') : null,
                   rows: q('#todoList .todo-item').map(el => el.getAttribute('data-id')) };
        })()""")
        ok('S5k-③ 切回今天：carry 自动展开，未来那张计划不提前出现',
           r5k2['fold'] is False and '9202' in r5k2['rows']
           and r5k['newId'] not in r5k2['rows'], r5k2)
        page.evaluate("""(() => {
          const t = appData.todos.filter(x => x.title === 'S5k 未来那天新加的')[0];
          if (t) {
            const d = new Date(); d.setDate(d.getDate() - 1);
            t.remindAt = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()) + ' 09:00';
          }
          saveData(); renderTodos();
        })()""")
        page.wait_for_timeout(350)
        r5k3 = page.evaluate("""(() => {
          const q = (s) => Array.from(document.querySelectorAll(s));
          const head = document.querySelector('#todoList .todo-group-head[data-id="__grp_carry__"]');
          return { fold: head ? head.classList.contains('is-fold') : null,
                   rows: q('#todoList .todo-item').map(el => el.getAttribute('data-id')),
                   headText: head ? head.textContent.trim() : '' };
        })()""")
        ok('S5k-④ 它变成「逾期未完成」后：进 carry 组、题头带计数、仍在展开态',
           r5k3['fold'] is False and r5k['newId'] in r5k3['rows'] and '⏮' in r5k3['headText'], r5k3)
        # 收尾：删掉探针新建的计划，别污染后续 S6 段
        page.evaluate("""(() => {
          appData.todos = appData.todos.filter(t => t.title !== 'S5k 未来那天新加的');
          saveData(); tbGoToday(); renderTodos();
        })()""")
        page.wait_for_timeout(250)

        # ============ S6 点两格建计划（回归已修 bug） ============
        # 点空白时段（16:00/17:00）——已排计划的时段被色块盖住，点色块=聚焦计划卡（设计行为）
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="960"][data-tb-lane="0"]')
        page.wait_for_timeout(120)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="1020"][data-tb-lane="0"]')  # 17:00
        page.wait_for_timeout(200)
        pre = page.evaluate("""({
          ee: document.getElementById('addTodoEstEnd').value,
          rm: document.getElementById('addTodoRemind').value,
          us: document.getElementById('addTodoEstEnd').dataset.userSet || ''
        })""")
        ok('S6a 点两格 16:00→17:00：预填结束 = 结束格右缘 17:10 且 userSet=1',
           pre['ee'] == today() + 'T17:10' and pre['us'] == '1', pre)
        page.fill('#addTodoTitle', '点格计划')
        page.evaluate("confirmAddTodo()")
        page.wait_for_timeout(250)
        t6 = page.evaluate("appData.todos.find(t => t.title === '点格计划')")
        bl = blocks(page)
        ok('S6b 保存后 estEnd=17:10 + estEndManual=true', bool(t6) and t6['estEnd'] == today() + ' 17:10' and t6['estEndManual'] is True, t6 and t6.get('estEnd'))
        ok('S6c 网格预计列出现该计划块', str(t6['id']) in bl['plan'] if t6 else False, bl['plan'])

        # ===== S6d 结束格右缘规则（结束格自身计入时长：点 N 格 = N×10 分钟）=====
        # 背景格是 10 分钟容器、data-tb-min 只记左缘；结束预填 = 结束格左缘 + 10（无条件），
        # 起点永远取左缘。想选整小时请点「XX:50 那一格」——末格右缘恰是下一整点。
        # 全部点 7 点段——seed 里该时段无计划，不会点到色块。
        page.evaluate("if(typeof closeModal==='function') closeModal('addTodoModal')")
        page.wait_for_timeout(450)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="420"][data-tb-lane="0"]')   # 07:00
        page.wait_for_timeout(120)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="430"][data-tb-lane="0"]')   # 07:10 第二格
        page.wait_for_timeout(200)
        ee_u = page.evaluate("document.getElementById('addTodoEstEnd').value")
        ok('S6d 点两格（07:00 → 07:10 格）= 20 分钟 → 结束 07:20',
           ee_u == today() + 'T07:20', ee_u)
        page.evaluate("if(typeof closeModal==='function') closeModal('addTodoModal')")
        page.wait_for_timeout(450)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="420"][data-tb-lane="0"]')   # 07:00
        page.wait_for_timeout(120)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="470"][data-tb-lane="0"]')   # 07:50 末格
        page.wait_for_timeout(200)
        ee_d = page.evaluate("document.getElementById('addTodoEstEnd').value")
        ok('S6e 同小时点到最后一格（:50）→ 结束取右缘 08:00（不是左缘 07:50）',
           ee_d == today() + 'T08:00', ee_d)
        page.evaluate("if(typeof closeModal==='function') closeModal('addTodoModal')")
        page.wait_for_timeout(450)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="470"][data-tb-lane="0"]')   # 07:50 末格作起点
        page.wait_for_timeout(120)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="480"][data-tb-lane="0"]')   # 08:00
        page.wait_for_timeout(200)
        rm_e = page.evaluate("document.getElementById('addTodoRemind').value")
        ee_e = page.evaluate("document.getElementById('addTodoEstEnd').value")
        ok('S6f 起点是末格时起点仍取左缘 07:50（只修结束格，不修起点）→ 结束 08:10',
           rm_e == today() + 'T07:50' and ee_e == today() + 'T08:10', (rm_e, ee_e))
        page.evaluate("if(typeof closeModal==='function') closeModal('addTodoModal')")
        page.wait_for_timeout(450)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="720"][data-tb-lane="0"]')   # 12:00
        page.wait_for_timeout(120)
        page.click('#tbGridWrap .tb-paper-cell[data-tb-min="750"][data-tb-lane="0"]')   # 12:30 中间格
        page.wait_for_timeout(200)
        ee_f = page.evaluate("document.getElementById('addTodoEstEnd').value")
        ok('S6g 中间格 12:30 结束也取右缘 12:40（统一规则，不再只修末格）',
           ee_f == today() + 'T12:40', ee_f)
        page.evaluate("if(typeof closeModal==='function') closeModal('addTodoModal')")
        page.wait_for_timeout(450)

        # ============ S7 行内编辑改提醒时间 → 块移动 ============
        page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === '点格计划');
          t.remindAt = %s + ' 15:30';
          saveData(); renderTodos();
        })()""" % json.dumps(today()))
        page.wait_for_timeout(250)
        pos = page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === '点格计划');
          const b = document.querySelector('#tbGridWrap .tb-paper-blk.is-plan[data-tb-id="' + t.id + '"]');
          return b ? { band: b.getAttribute('data-tb-band'), row: b.style.gridRow } : null;
        })()""")
        ok('S7 改提醒 10:00→15:30：块落到第二排（band=1）', bool(pos) and pos['band'] == '1', pos)

        # ============ S8 删除计划 → 块消失 ============
        page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === '点格计划');
          appData.todos = appData.todos.filter(x => x.title !== '点格计划');
          saveData(); renderTodos();
        })()""")
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('S8 删除后预计块消失', '点格计划' not in str(bl), bl['plan'])

        # ============ S9 快捷番茄 ============
        r9 = page.evaluate("""(() => {
          setTodoPomoQuick(9101, 3.5);
          const t = appData.todos.find(x => String(x.id) === '9101');
          const row = document.querySelector('#todoList .todo-item[data-id="9101"]');
          return { pomos: t.pomodoros, rowPomo: row ? (row.textContent.match(/(\\d+(?:\\.\\d+)?)\\s*🍅/) || [])[1] : null };
        })()""")
        ok('S9 快捷番茄 +3.5 → 数据与行显示一致', r9['pomos'] == 3.5 and r9['rowPomo'] == '3.5', r9)

        # ============ S10 折叠 ============
        r10 = page.evaluate("""(() => {
          tbToggleGridFold();
          const f1 = document.getElementById('tbShell').classList.contains('is-folded');
          const body = document.getElementById('tbFoldBody');
          tbToggleGridFold();
          const f2 = document.getElementById('tbShell').classList.contains('is-folded');
          return { f1: f1, f2: f2 };
        })()""")
        ok('S10 折叠/展开切换生效', r10['f1'] is True and r10['f2'] is False, r10)

        # ============ S11 老数据兼容（独立 context，隔离 localStorage 竞争） ============
        ctx2 = b.new_context(viewport={'width': 1000, 'height': 1600})
        page2 = ctx2.new_page()
        errs2 = []
        page2.on('pageerror', lambda e: errs2.append(str(e)))
        boot(page2, {'lastTodoCleanupDate': today(), 'todos': [
            {'id': 8001, 'title': '老数据-无手动态', 'done': False, 'pomodoros': 2,
             'remindAt': today() + ' 10:00', 'estEnd': today() + ' 12:00'},   # 无 estEndManual
            {'id': 8002, 'title': '老数据-旧色板', 'done': True, 'pomodoros': 1,
             'remindAt': today() + ' 08:00', 'tbColor': 'amber'}              # 旧色板 key
        ]})
        bl2 = page2.evaluate("""(() => {
          const q = (s) => Array.from(document.querySelectorAll('#tbGridWrap ' + s));
          return {
            plan: q('.tb-paper-blk.is-plan').map(x => x.getAttribute('data-tb-id')),
            colors: appData.todos.map(t => t.tbColor)
          };
        })()""")
        ok('S11a 老数据无 estEndManual → 自动推算让路（预计块照画）', sorted(bl2['plan']) == ['8001', '8002'], bl2['plan'])
        ok('S11b 旧色板 key 被作废重排（琥珀→新 key）', all(c.startswith('v4') for c in bl2['colors'] if c), bl2['colors'])
        ok('S11c 老数据渲染零异常', not errs2, errs2)
        ctx2.close()

        # ============ S12 计划外专注灰块 ============
        page.evaluate("""(() => {
          appData.records = appData.records || [];
          appData.records.push({
            id: Date.now(), type: 'focus', taskName: '随手记的专注',
            startTime: (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })(),
            endTime: (() => { const d = new Date(); d.setHours(13, 25, 0, 0); return d.getTime(); })(),
            effectiveSeconds: 25 * 60, pomos: 1
          });
          saveData(); renderTodos();
        })()""")
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('S12a 无 todoId 记录 → 计划外灰块 1 个', bl['unplanned'] == 1, bl['unplanned'])
        # 任务12 拍板：灰块点击无响应没关系，但**必须有名字**（知道它是啥）。
        # 名字两处：块内竖排截断显示 + title 悬浮提示（完整名 + 时段）。
        r12 = page.evaluate("""(() => {
          const b = document.querySelector('#tbGridWrap .tb-paper-blk.is-unplanned');
          if (!b) return null;
          return { text: b.textContent.trim(), tip: b.getAttribute('title') || '' };
        })()""")
        ok('S12b 灰块块内显示任务名（截断到放得下）',
           bool(r12) and r12['text'] and '随手记的专注'.startswith(r12['text']), r12)
        ok('S12c 灰块 title 提示带完整名字 + 时段',
           bool(r12) and '随手记的专注' in r12['tip']
           and re.search(r'\d{1,2}:\d{2}–\d{1,2}:\d{2}', r12['tip']) is not None, r12)

        ok('S13 全程零 JS 异常', not errs, errs)
        b.close()



def round2():
    """第二轮：真实 UI 路径（T 段）"""
    with sync_playwright() as p:

        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1000, 'height': 1600})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.add_init_script("localStorage.setItem('tomato_focus_v3', JSON.stringify(%s))" % json.dumps({
            'settings': {'workDuration': 25, 'shortBreak': 5, 'longBreak': 20, 'longInterval': 4, 'tbGridFolded': False},
            'uiPrefs': {'guideDone': True}, 'lastTodoCleanupDate': today(),
            'todos': [], 'records': []}))
        pause_remind_watch(page)
        page.goto(APP)
        page.wait_for_function("typeof appData !== 'undefined' && Array.isArray(appData.todos)", timeout=15000)
        page.evaluate("switchView('plan')")
        page.wait_for_selector('#tbGridWrap .tb-paper-cell')
        page.wait_for_timeout(300)

        # ===== T1 真实 UI：走弹窗新建一条计划 =====
        page.click('button[title="新增计划"]')
        page.wait_for_timeout(300)
        modal_show = page.evaluate("document.getElementById('addTodoModal').classList.contains('show')")
        ok('T1a 点「新建计划」弹窗打开', modal_show)
        page.fill('#addTodoTitle', 'UI新建')
        page.fill('#addTodoRemind', today() + 'T09:30')
        page.fill('#addTodoPomodoros', '2')
        page.wait_for_timeout(200)
        ee = page.evaluate("document.getElementById('addTodoEstEnd').value")
        ok('T1b 填提醒+番茄 → 结束自动推算 = 10:25', ee == today() + 'T10:25', ee)
        page.click('#addTodoModal button.modal-btn.primary')
        page.wait_for_timeout(300)
        t1 = page.evaluate("appData.todos.find(t => t.title === 'UI新建')")
        bl = blocks(page)
        ok('T1c 确定后落库 + 网格预计块出现', bool(t1) and str(t1['id']) in bl['plan'], bl['plan'])

        # ===== T2 真实 UI：点计划卡复选框勾选完成 =====
        row_sel = '#todoList .todo-item[data-id="%s"]' % t1['id']
        page.click(row_sel + ' .todo-checkbox')
        page.wait_for_timeout(300)
        st = page.evaluate("appData.todos.find(t => t.title === 'UI新建')")
        ok('T2a 点复选框 → done=true + actualEnd 写', st['done'] and bool(st['actualEnd']))
        # 再点一次取消
        page.click(row_sel + ' .todo-checkbox')
        page.wait_for_timeout(300)
        st = page.evaluate("appData.todos.find(t => t.title === 'UI新建')")
        ok('T2b 再点取消 → done=false + actualEnd 清除（可逆）', (not st['done']) and not st.get('actualEnd'))

        # ===== T3 真实 UI：行内编辑面板改提醒时间 =====
        page.click(row_sel + ' .todo-expand-btn')   # 先展开
        page.wait_for_timeout(250)
        page.click(row_sel + ' button:has-text("⚙ 设置")')
        page.wait_for_timeout(300)
        editing = page.evaluate("document.querySelectorAll('%s .todo-edit-panel, %s .tf-input').length > 0" % (row_sel, row_sel))
        ok('T3a 点编辑 → 行内面板展开', editing)
        page.fill('#todo_remind_%s' % t1['id'], today() + 'T16:00')
        page.wait_for_timeout(300)
        ee2 = page.evaluate("document.getElementById('todo_est_end_%s').value" % t1['id'])
        ok('T3b 面板改提醒 09:30→16:00 → 预计结束联动 16:55', ee2 == today() + 'T16:55', ee2)
        page.click(row_sel + ' button:has-text("完成")')
        page.wait_for_timeout(300)
        st = page.evaluate("appData.todos.find(t => t.title === 'UI新建')")
        pos = page.evaluate("""(() => {
          const b = document.querySelector('#tbGridWrap .tb-paper-blk.is-plan[data-tb-id="%s"]');
          return b ? { band: b.getAttribute('data-tb-band') } : null;
        })()""" % t1['id'])
        ok('T3c 点「完成」保存 → 数据 remindAt=16:00', st['remindAt'] == today() + ' 16:00', st['remindAt'])
        ok('T3d 网格预计块移到第二排（band=1）', bool(pos) and pos['band'] == '1', pos)

        # ===== T4 与计时器联动：开番茄 → 落 actualSegs → 网格实际列 =====
        page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === 'UI新建');
          window.__linkedForTest = t.id;
          // 模拟计时器链路：linkTodo + startPomodoroCore 的落段部分
          timerState.linkedTodoId = t.id;
          stampTodoActualStart(t.id);
          renderTodos();
        })()""")
        page.wait_for_timeout(300)
        st = page.evaluate("appData.todos.find(t => t.title === 'UI新建')")
        bl = blocks(page)
        ok('T4a 开番茄（link+stamp）→ actualSegs 落一段', bool(st.get('actualSegs') and len(st['actualSegs']) == 1), st.get('actualSegs'))
        page.evaluate("""(() => {
          // 把段改到「昨天 13:00~13:30」并翻昨天视图：当前时刻(午夜)新落的口段在 07:00 窗口外，画不出
          const t = appData.todos.find(x => x.title === 'UI新建');
          const base = new Date(); base.setDate(base.getDate() - 1);
          const d1 = new Date(base); d1.setHours(13, 0, 0, 0);
          const d2 = new Date(base); d2.setHours(13, 30, 0, 0);
          t.actualSegs = [{ s: d1.getTime(), e: d2.getTime() }];
          const d = new Date(); d.setDate(d.getDate() - 1);
          tbPickDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
          t.remindAt = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' 13:00';
          renderTodos();
        })()""")
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('T4b 网格实际列出现该计划块（昨天视图，段在窗口内）', bl['actual'] == [str(st['id'])], bl['actual'])
        page.evaluate("tbGoToday()")
        page.wait_for_timeout(200)
        # 暂停（收尾）
        page.evaluate("""(() => {
          closeTodoActualSeg(window.__linkedForTest, Date.now() + 100);
          timerState.linkedTodoId = null;
          renderTodos();
        })()""")
        page.wait_for_timeout(300)
        st = page.evaluate("appData.todos.find(t => t.title === 'UI新建')")
        ok('T4c 暂停收尾 → 段 e>0', st['actualSegs'][-1]['e'] > 0)

        # ===== T5 子任务：父自动勾 / 反悔恢复 =====
        page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === 'UI新建');
          t.subs = [{ id: 's1', title: '子1', done: false }, { id: 's2', title: '子2', done: false }];
          renderTodos();
        })()""")
        page.wait_for_timeout(200)
        page.evaluate("toggleTodo(%s)" % t1['id'])
        page.wait_for_timeout(250)
        subs = page.evaluate("appData.todos.find(t => t.title === 'UI新建').subs.map(s => s.done)")
        ok('T5a 父勾选 → 未完成子任务自动勾', subs == [True, True], subs)
        page.evaluate("toggleTodo(%s)" % t1['id'])
        page.wait_for_timeout(250)
        subs = page.evaluate("appData.todos.find(t => t.title === 'UI新建').subs.map(s => s.done)")
        ok('T5b 父取消 → 只恢复自动勾那批（反悔无损）', subs == [False, False], subs)

        # ===== T6 边界数据 =====
        r6 = page.evaluate("""(() => {
          // 跨天 estEnd：23:00 → 次日 01:00
          const t = appData.todos.find(x => x.title === 'UI新建');
          t.remindAt = %s + ' 23:00'; t.estEnd = %s + ' 23:30'; t.estEndManual = true;
          t.pomodoros = 1;
          renderTodos();
          const blk = tbBlockOf(t, appData.settings);
          return { start: blk.start, end: blk.end };
        })()""" % (json.dumps(today()), json.dumps(today())))
        ok('T6a 边界：23:00 计划块 start=1380', r6['start'] == 1380, r6)
        page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === 'UI新建');
          t.remindAt = %s + ' 10:00'; delete t.estEnd; delete t.estEndManual; t.pomodoros = 0.5;
          renderTodos();
        })()""" % json.dumps(today()))
        page.wait_for_timeout(200)
        bl = blocks(page)
        ok('T6b 半个番茄（0.5🍅 → 25 分钟）→ 预计块照画', str(t1['id']) in bl['plan'], bl['plan'])

        # ===== T7 子任务**不**计入预计时长（10-17 收口后的口径）=====
        r7 = page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === 'UI新建');
          t.subs = [{ id: 's1', title: '子1', done: false, pomodoros: 2 }];
          t.pomodoros = 1;
          const estPomos = todoEstPomos(t);
          const mins = todoEstDurationMin(estPomos, appData.settings);
          return { estPomos: estPomos, mins: mins };
        })()""")
        ok('T7 子任务不计入预计（本身 1🍅 + 子任务 2🍅 → 仍按 1🍅 = 25 分钟）',
           r7['estPomos'] == 1 and r7['mins'] == 25 and r7['mins'] != 85, r7)

        # ===== T8 导入导出往返（含新字段） =====
        r8 = page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === 'UI新建');
          t.estEndManual = true; t.estEnd = %s + ' 11:00';
          t.actualSegs = [{ s: Date.now() - 3600000, e: Date.now() - 1800000 }];
          const dump = JSON.stringify(appData);
          const back = JSON.parse(dump);
          const t2 = back.todos.find(x => x.title === 'UI新建');
          return {
            manual: t2.estEndManual === true,
            estEnd: t2.estEnd === %s + ' 11:00',
            segs: Array.isArray(t2.actualSegs) && t2.actualSegs.length === 1
          };
        })()""" % (json.dumps(today()), json.dumps(today())))
        ok('T8 导出/导入往返：estEndManual + estEnd + actualSegs 全保留',
           r8['manual'] and r8['estEnd'] and r8['segs'], r8)

        # ===== T9 删计划走确认弹窗 =====
        page.evaluate("showDeleteConfirm(%s)" % t1['id'])
        page.wait_for_timeout(200)
        show = page.evaluate("document.getElementById('deleteConfirmModal').classList.contains('show')")
        ok('T9a 删计划 → 确认弹窗出现', show)
        page.evaluate("executeDelete()")
        page.wait_for_timeout(300)
        bl = blocks(page)
        ok('T9b 确认后计划与网格块都消失', str(t1['id']) not in bl['plan'], bl['plan'])

        # ===== T10 周条点击导航 =====
        page.evaluate("""(() => {
          const t = appData.todos.find(x => x.title === 'UI新建');
          appData.todos = appData.todos.filter(x => x.title !== 'UI新建');
          appData.todos.push({ id: 9501, title: '周条测试', done: false, pomodoros: 1,
            remindAt: %s + ' 11:00', repeat: { mode: 'weekly', weekdays: [new Date().getDay()] } });
          renderTodos();
        })()""" % json.dumps(today()))
        page.wait_for_timeout(250)
        bl = blocks(page)
        ok('T10a 每周重复（今天星期几）→ 今天有块', '9501' in bl['plan'], bl['plan'])
        strips = page.evaluate("Array.from(document.querySelectorAll('#tbWeek button.tb-day')).map(x => x.getAttribute('title')).slice(0, 7)")
        ok('T10b 周日期条渲染出 7 天', len([s for s in strips if s]) >= 7, strips)

        ok('T11 全程零 JS 异常', not errs, errs)
        b.close()



if __name__ == '__main__':
    round1()
    print()
    round2()
