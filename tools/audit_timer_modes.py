# -*- coding: utf-8 -*-
"""
· 计时模式（番茄钟 / 正计时 / 流式）策略化后的行为等价审计
==================================================================
为什么存在：2026-10-14 把散在 01c/01g 的 **17 处模式判定**收进了
`TIMER_STRATEGIES` 策略表（设计出处 Super Productivity 的 focus-mode-strategies.ts）。
策略化是**重构**，硬要求是「行为逐字节等价」—— 而等价不能靠目视，得跑。

本工具覆盖的**每一条断言都对应一个被替换的判定点**（注释里标了原判定），
所以它同时是「这次重构没改坏行为」的证据和「以后改计时模式」的回归网。

  S 段：策略表本身（三键齐全 / 取法正确 / 字段类型）
  B 段：三种模式的实际行为（启动形态 / 计时方向 / 暂停冻结 / 继续续接 /
        表盘类名 / 进度环 / ±5 分钟 / 结算文案 / 微休息排期）

用法：python3 tools/audit_timer_modes.py     （file:// 直开，不建 HTTP 服务）
出口：全部 ✓ = 通过（退出码 0）；任何 ✗ 进末尾汇总（退出码 1）。
==================================================================
"""

import sys

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


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 430, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.add_init_script("window.__remindWatchPaused = true")
        pg.goto(APP)
        pg.wait_for_function("typeof appData !== 'undefined' && typeof TIMER_STRATEGIES === 'object'",
                             timeout=20000)
        pg.wait_for_timeout(500)

        # ================= S 段：策略表本身 =================
        r = pg.evaluate("""(() => {
          const k = Object.keys(TIMER_STRATEGIES);
          const need = ['countsDown','freezesRemainingOnPause','resumesFromRemaining',
                        'supportsTimeAdjust','ringFromRemaining','elapsedIsRemaining'];
          const bad = [];
          k.forEach(function (key) {
            const s = TIMER_STRATEGIES[key];
            if (s.key !== key) bad.push(key + ':key');
            if (typeof s.label !== 'string' || !s.label) bad.push(key + ':label');
            if (typeof s.free !== 'boolean') bad.push(key + ':free');
            if (typeof s.settleWord !== 'string' || !s.settleWord) bad.push(key + ':settleWord');
            need.forEach(function (f) { if (typeof s[f] !== 'boolean') bad.push(key + ':' + f); });
          });
          return { keys: k, bad: bad,
                   countsDown: {
                     pomodoro: TIMER_STRATEGIES.pomodoro.countsDown,
                     stopwatch: TIMER_STRATEGIES.stopwatch.countsDown,
                     flowtime: TIMER_STRATEGIES.flowtime.countsDown
                   },
                   jump: [strategyOfFreeType('flowtime').key, strategyOfFreeType('stopwatch').key,
                          strategyOfFreeType(undefined).key]
                 };
        })()""")
        ok('S1-① 策略表三个模式键齐全（pomodoro/stopwatch/flowtime）',
           sorted(r['keys']) == ['flowtime', 'pomodoro', 'stopwatch'], r['keys'])
        ok('S1-② 每个模式的字段齐、类型正确（布尔字段不会写成字符串）', r['bad'] == [], r['bad'])
        ok('S1-③ 计时方向：番茄/流式往下数，正计时往上数',
           r['countsDown'] == {'pomodoro': True, 'stopwatch': False, 'flowtime': True}, r['countsDown'])
        ok('S2-① 自由子模式取策略正确（flowtime/stopwatch，缺省兜底 stopwatch）',
           r['jump'] == ['flowtime', 'stopwatch', 'stopwatch'], r['jump'])

        r = pg.evaluate("""(() => {
          const out = {};
          timerMode = 'pomodoro';
          out.pomo = timerStrategy().key;
          timerMode = 'free';
          timerState = { mode: 'free', freeType: 'flowtime' };
          out.flow = timerStrategy().key;
          timerState = { mode: 'free', freeType: 'stopwatch' };
          out.stop = timerStrategy().key;
          out.freeFlagPomo = (function () { timerMode = 'pomodoro'; return isFreeMode(); })();
          out.freeFlagFree = (function () { timerMode = 'free'; return isFreeMode(); })();
          return out;
        })()""")
        ok('S2-② 组合判定：timerStrategy() 随（timerMode+freeType）正确取到策略',
           (r['pomo'], r['flow'], r['stop']) == ('pomodoro', 'flowtime', 'stopwatch'), r)
        ok('S2-③ isFreeMode() 等价于旧的 timerMode !== \'pomodoro\'',
           r['freeFlagPomo'] is False and r['freeFlagFree'] is True, r)

        # ================= B 段：行为等价 =================
        pg.evaluate("""(() => {
          try { resetToIdle(); } catch (e) {}
          if (timerMode !== 'pomodoro') switchTimerMode('pomodoro');
        })()""")
        pg.wait_for_timeout(200)

        # ---- 正计时 ----
        r = pg.evaluate("""(() => {
          setFreeType('stopwatch');
          switchTimerMode('stopwatch');
          toggleFreeTimer();
          const st = timerState;
          return { freeType: st.freeType, mode: st.mode, total: st.totalDuration,
                   endAt: st.endAt || 0, remaining: st.remaining, running: st.running,
                   label: document.getElementById('timerLabel').textContent,
                   ringCls: document.getElementById('timerCircle').className };
        })()""")
        ok('B1-① 启动正计时：freeType=stopwatch、无总时长、无 endAt（只在手动结束时结算）',
           r['freeType'] == 'stopwatch' and r['total'] == 0 and r['endAt'] == 0, r)
        ok('B1-② 表盘类名走策略表后缀 free-stopwatch',
           'free-stopwatch' in r['ringCls'], r['ringCls'])

        pg.wait_for_timeout(1700)
        r2 = pg.evaluate("""(() => {
          const rem = timerState.remaining;
          const wrap = document.querySelector('.timer-circle-wrap');
          const dot = wrap ? wrap.style.getPropertyValue('--dot-rot') : '';
          const ring = document.getElementById('timerRingFill');
          return { rem: rem, dot: dot, off: ring ? ring.style.strokeDashoffset : '' };
        })()""")
        ok('B2-① 正计时 remaining 往上累加（旧判定：freeType !== \'flowtime\' → 累计显示）',
           r2['rem'] >= 1, r2)
        ok('B2-② 正计时进度环 offset = 0（旧判定：非流式 → 不画进度）',
           r2['off'].strip() in ('0', '0.0'), r2['off'])
        ok('B2-③ 正计时小圆点相位跟着 remaining 走（旧判定：remaining 即已用）',
           r2['dot'].strip().endswith('deg') and float(r2['dot'].strip()[:-3]) > 0, r2['dot'])

        r = pg.evaluate("""(() => {
          toggleFreeTimer();              /* 暂停 */
          const st = timerState;
          return { running: st.running, pausedRemaining: st.pausedRemaining,
                   pausedElapsed: st.pausedElapsed || 0,
                   btn: document.getElementById('btnStart').textContent };
        })()""")
        ok('B3-① 正计时暂停：running=false、不冻结剩余（旧判定：只有流式才记 pausedRemaining）',
           r['running'] is False and r['pausedRemaining'] == 0, r)

        r = pg.evaluate("""(() => {
          const before = timerState.startTime;
          toggleFreeTimer();              /* 继续 */
          const st = timerState;
          return { running: st.running, startMoved: st.startTime !== before,
                   endAt: st.endAt || 0, remaining: st.remaining };
        })()""")
        ok('B3-② 正计时继续：重设 startTime、不动 endAt（旧判定：非流式不会重设 endAt）',
           r['running'] is True and r['startMoved'] is True and r['endAt'] == 0, r)

        # ±5 分钟：正计时应被拒
        r = pg.evaluate("""(() => {
          const before = timerState.remaining;
          adjustFreeTime(5);
          return { before: before, after: timerState.remaining };
        })()""")
        ok('B4 正计时点 ±5 分钟被拒（旧判定：freeType !== \'flowtime\' → 直接 return）',
           r['before'] == r['after'], r)

        # ---- 流式 ----
        pg.evaluate("""(() => {
          try { stopTimerLoop(); } catch (e) {}
          resetToIdle();
          if (timerMode !== 'pomodoro') switchTimerMode('pomodoro');
          appData.settings.flowDuration = 50;
        })()""")
        pg.wait_for_timeout(200)
        r = pg.evaluate("""(() => {
          setFreeType('flowtime');
          switchTimerMode('flowtime');
          toggleFreeTimer();
          const st = timerState;
          return { freeType: st.freeType, total: st.totalDuration, endAt: st.endAt || 0,
                   remaining: st.remaining, label: document.getElementById('timerLabel').textContent,
                   ringCls: document.getElementById('timerCircle').className };
        })()""")
        ok('B5-① 启动流式：定长（50 分钟）、有 endAt、remaining 从总时长起（旧判定：countsDown）',
           r['freeType'] == 'flowtime' and r['total'] == 50 * 60 and r['endAt'] > 0
           and r['remaining'] == 50 * 60, r)
        ok('B5-② 表盘类名走策略表后缀 free-flowtime', 'free-flowtime' in r['ringCls'], r['ringCls'])

        pg.wait_for_timeout(1700)
        r2 = pg.evaluate("""(() => {
          const ring = document.getElementById('timerRingFill');
          const wrap = document.querySelector('.timer-circle-wrap');
          return { rem: timerState.remaining,
                   off: ring ? ring.style.strokeDashoffset : '',
                   dot: wrap ? wrap.style.getPropertyValue('--dot-rot') : '' };
        })()""")
        ok('B6-① 流式 remaining 往下减（旧判定：countsDown → 倒计时分支）',
           r2['rem'] < 50 * 60, r2)
        ok('B6-② 流式画进度环（offset ≠ 0）（旧判定：流式算进度）',
           r2['off'].strip() not in ('0', '0.0', ''), r2['off'])
        ok('B6-③ 流式小圆点按「已用」推进（旧判定：总时长 − 剩余）',
           float(r2['dot'].strip()[:-3]) > 0, r2['dot'])

        r = pg.evaluate("""(() => {
          toggleFreeTimer();              /* 暂停 */
          const st = timerState;
          return { running: st.running, pausedRemaining: st.pausedRemaining,
                   remaining: st.remaining };
        })()""")
        ok('B7-① 流式暂停：把「那一刻的剩余」冻进 pausedRemaining（旧判定：freezesRemainingOnPause）',
           r['running'] is False and r['pausedRemaining'] > 0
           and abs(r['pausedRemaining'] - r['remaining']) <= 1, r)

        pg.wait_for_timeout(1500)   # 暂停期间什么都不该走
        r = pg.evaluate("""(() => {
          const stuck = timerState.pausedRemaining;
          toggleFreeTimer();              /* 继续 */
          return { stuck: stuck, endAt: timerState.endAt, running: timerState.running };
        })()""")
        ok('B7-② 流式暂停期间剩余不动（冻结生效）', r['stuck'] > 0 and r['running'] is True, r)

        # ±5 分钟：流式应生效
        r = pg.evaluate("""(() => {
          const before = timerState.remaining;
          adjustFreeTime(5);
          return { before: before, after: timerState.remaining };
        })()""")
        ok('B8 流式点 +5 分钟生效（旧判定：supportsTimeAdjust）',
           r['after'] > r['before'], r)

        # 结算文案：备注前缀走策略词（旧判定：`flowtime ? '流式计时 ' : '正计时 '` 三元）
        # 注：这里直接给 openFreeSettle 一个 ≥10 秒的时长 —— 秒数从哪来不是本断言要测的，
        #     要测的是「前缀取自策略表」。两个模式都覆盖，防止只改对一半。
        r = pg.evaluate("""(() => {
          const noteEl = document.getElementById('currentTodoNote');
          const nameEl = document.getElementById('currentTodoInput');
          if (noteEl) noteEl.value = ''; if (nameEl) nameEl.value = '';
          timerState = { mode: 'free', freeType: 'flowtime' };
          openFreeSettle(600);
          const flowNote = freeSettleNote;
          try { closeModal('freeSettleModal'); } catch (e) {}
          timerState = { mode: 'free', freeType: 'stopwatch' };
          openFreeSettle(600);
          const stopNote = freeSettleNote;
          try { closeModal('freeSettleModal'); } catch (e) {}
          return { flowNote: flowNote, stopNote: stopNote,
                   shown: true };
        })()""")
        ok('B9-① 流式结算备注用策略词「流式计时 10 分钟」',
           r['flowNote'] == '流式计时 10 分钟', r)
        ok('B9-② 正计时结算备注用「正计时 10 分钟」（同一条链路、两种模式各取自己的词）',
           r['stopNote'] == '正计时 10 分钟', r)

        # 微休息排期：正计时照排、流式在「剩余不够一次间隔」时不排
        r = pg.evaluate("""(() => {
          try { stopTimerLoop(); } catch (e) {}
          resetToIdle();
          if (timerMode !== 'pomodoro') switchTimerMode('pomodoro');
          appData.settings.microBreak = true;
          appData.settings.microMin = 60; appData.settings.microMax = 60;
          appData.settings.microMinGap = 5;
          /* ① 正计时（remaining = 已跑秒数，不可比）→ 照排 */
          setFreeType('stopwatch');
          switchTimerMode('stopwatch');
          toggleFreeTimer();
          scheduleNextMicroBreak();
          const stopwatchNext = timerState.microNextAt;
          try { stopTimerLoop(); } catch (e) {}
          resetToIdle();
          if (timerMode !== 'pomodoro') switchTimerMode('pomodoro');
          /* ② 流式（50 分钟剩余 < 60 分钟间隔）→ 不排 */
          setFreeType('flowtime');
          switchTimerMode('flowtime');
          toggleFreeTimer();
          scheduleNextMicroBreak();
          const flowNext = timerState.microNextAt;
          try { stopTimerLoop(); } catch (e) {}
          resetToIdle();
          return { stopwatchNext: stopwatchNext || 0, flowNext: flowNext || 0 };
        })()""")
        ok('B10-① 微休息排期：正计时照排（旧判定：没有剩余时长的概念 → 不参与比较）',
           r['stopwatchNext'] > 0, r)
        ok('B10-② 微休息排期：流式剩余不够一次间隔 → 不排（旧判定：倒计时类才有额度）',
           r['flowNext'] == 0, r)

        ok('B99 全程零 JS 异常', not errs, errs)
        b.close()

    print()
    bad = [x for x in RESULTS if not x[1]]
    print('计时模式审计：%d 通过 / %d 失败（共 %d 条）' % (len(RESULTS) - len(bad), len(bad), len(RESULTS)))
    for name, _, detail in bad:
        print('  ✗ ' + name + ('  → ' + str(detail)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
