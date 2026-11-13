# -*- coding: utf-8 -*-
"""全站功能巡检：把所有主要入口函数与视图渲染都真实调用一遍，抓未捕获异常。

目的：前面几个 bug（bioInitFlags / buildTodayInsight）都是「重构漏变量」，
这类问题只在特定路径执行时才暴露。本巡检主动穷举可点路径，把这类隐藏
ReferenceError 一次性挖出来。

用法: python3 tools/full_patrol.py
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rest_probe as R

# 逐个调用的探针：每个返回字符串，异常会被全局捕获
CALLS = [
    # ---- 视图切换 ----
    ("switchView.timer", "switchView('timer')"),
    ("switchView.plan", "switchView('plan')"),
    ("switchView.log", "switchView('log')"),
    ("switchView.stats", "switchView('stats')"),
    ("switchView.settings", "switchView('settings')"),
    # ---- 计划页子 tab ----
    ("switchPlanTab.plan", "switchPlanTab('plan')"),
    ("switchPlanTab.habit", "switchPlanTab('habit')"),
    # ---- 日志页渲染 ----
    ("renderLogs", "renderLogs()"),
    ("switchLogTab", "switchLogTab('diary')"),
    # ---- 统计页全渲染 ----
    ("renderStats", "renderStats()"),
    ("ensureBlockAnalysis", "ensureBlockAnalysis()"),
    ("renderStatsJumpNav", "renderStatsJumpNav(getStatsCache())"),
    ("toggleTodayAnalysis", "toggleTodayAnalysis()"),
    ("renderAllBlockAnalysis", "renderAllBlockAnalysis()"),
    # ---- 今日分析内部 ----
    ("calcTodayAnalysisBase", "calcTodayAnalysisBase(getStatsCache(), getStatsCache().tb)"),
    ("buildTodayInsight", "buildTodayInsight(getStatsCache(), getStatsCache().tb, calcTodayAnalysisBase(getStatsCache(), getStatsCache().tb), 5, 5)"),
    ("buildTodayAnalysisGoals", "buildTodayAnalysisGoals()"),
    ("buildTodayAdviceHTML", "buildTodayAdviceHTML(calcTodayAnalysisBase(getStatsCache(), getStatsCache().tb), getStatsCache(), 5, 5)"),
    # ---- 各板块分析器 ----
    ("ANALYZERS.today", "ANALYZERS['today'](getStatsCache())"),
    ("ANALYZERS.week", "ANALYZERS['week'](getStatsCache())"),
    ("ANALYZERS.trend", "ANALYZERS['trend'](getStatsCache())"),
    ("ANALYZERS.heat", "ANALYZERS['heat'](getStatsCache())"),
    ("ANALYZERS.mood", "ANALYZERS['mood'](getStatsCache())"),
    ("ANALYZERS.quality", "ANALYZERS['quality'](getStatsCache())"),
    ("ANALYZERS.dur", "ANALYZERS['dur'](getStatsCache())"),
    ("ANALYZERS.task", "ANALYZERS['task'](getStatsCache())"),
    ("ANALYZERS.week8", "ANALYZERS['week8'](getStatsCache())"),
    ("ANALYZERS.interrupt", "ANALYZERS['interrupt'](getStatsCache())"),
    ("ANALYZERS.rank", "ANALYZERS['rank'](getStatsCache())"),
    ("ANALYZERS.monthly", "ANALYZERS['monthly'](getStatsCache())"),
    ("ANALYZERS.yearly", "ANALYZERS['yearly'](getStatsCache())"),
    ("ANALYZERS.focus", "ANALYZERS['focus'](getStatsCache())"),
    # ---- 段位/成就/签到 ----
    ("renderRankSystem", "renderRankSystem()"),
    ("renderStarRecords", "renderStarRecords()"),
    ("renderSignIn", "renderSignIn()"),
    ("getBetTier", "getBetTier(1)"),
    ("showSubRankUp", "showSubRankUp(RANK_TIERS[2], 1)"),
    # ---- 树/商店 ----
    ("renderTreeSection", "renderTreeSection()"),
    ("renderTimerTree", "renderTimerTree()"),
    ("renderTreeShopWeather", "renderTreeShopWeather(appData.tree)"),
    ("renderTreeShopProp", "renderTreeShopProp(appData.tree)"),
    # ---- 周标/海报 ----
    ("renderWeeklyBadges", "renderWeeklyBadges()"),
    ("renderTimerBadge", "renderTimerBadge()"),
    # ---- 习惯 ----
    ("renderHabits", "renderHabits()"),
    ("renderHabitRemind", "renderHabitRemind()"),
    
    ("buildTaskIntStats", "buildTaskIntStats()"),
    # ---- 图谱/统计辅助 ----
    ("get7dAvgPomodoros", "get7dAvgPomodoros()"),
    ("checkCareNeeded", "checkCareNeeded()"),
    ("getStatsCache", "getStatsCache()"),
    # ---- 传记 ----
    ("checkBiographyEvents", "checkBiographyEvents()"),
    ("bioInitFlags", "bioInitFlags()"),
    ("bioBackfillOnce", "bioBackfillOnce()"),
    # ---- 沉浸 ----
    ("renderImmersiveProgress", "renderImmersiveProgress()"),
    ("immersiveIsActive", "immersiveIsActive()"),
    # ---- 日历 ----
    ("renderCalendar", "renderCalendar()"),
    ("openCalendarJump", "openCalendarJump()"),
    ("changeCalendarYear", "changeCalendarYear(1)"),
    ("jumpCalendarMonth", "jumpCalendarMonth(1)"),
    # ---- 其它 ----
    ("updateTodayStats", "updateTodayStats()"),
    ("updateRoundStats", "updateRoundStats()"),
    ("renderCountdowns", "renderCountdowns()"),
    ("renderTodos", "renderTodos()"),
    ("renderEncourage", "renderEncourage()"),
    ("renderDifficultyPicker", "renderDifficultyPicker()"),
    ("renderDurationSuggestion", "renderDurationSuggestion()"),
    ("getRecommendedWorkDuration", "getRecommendedWorkDuration()"),
    ("initBotLeaderboard", "initBotLeaderboard()"),
]

WRAP = r"""
(function(){
  try {
    %s;
    return 'ok';
  } catch (e) {
    return 'EXC:' + (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
  }
})()
"""

PREFIX = {"EXC": "!! ", "FAIL": "!! "}


def main():
    print("=" * 70)
    print("全站功能巡检：穷举入口抓未捕获异常")
    print("=" * 70)
    proc, ws, send, js, errs = R.launch(500, 900)
    # 等初始化稳定
    time.sleep(2.5)
    print("初始化异常:", errs if errs else "无")
    print("-" * 70)

    bad = []
    for name, expr in CALLS:
        r = js(WRAP % expr)
        if r == "ok":
            continue
        bad.append((name, r))
        print("%-28s %s" % (name, r))

    print("-" * 70)
    print("调用点: %d 个，异常: %d 个" % (len(CALLS), len(bad)))
    # 页面运行期错误（含异步抛出的）
    time.sleep(1.0)
    if errs:
        print()
        print("运行期捕获到的异常（含异步）:")
        for e in errs[:20]:
            print("  ", e[:200])
    print("=" * 70)
    ws.close(); proc.terminate()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())


# ============ 状态变更类巡检（增/删/改/结算） ============
MUT_CALLS = [
    # 习惯
    ("addHabit", "(function(){var i=document.getElementById('habitInput');if(i)i.value='巡检习惯';addHabit();return 1})()"),
    ("toggleHabit", "(function(){var h=appData.habits[0];if(h)toggleHabit(h.id);return 1})()"),
    ("deleteHabit", "(function(){var h=appData.habits[0];if(h)deleteHabit(h.id);return 1})()"),
    # 待办
    ("openAddTodoModal", "(function(){openAddTodoModal();return 1})()"),
    ("confirmAddTodo", "(function(){var i=document.getElementById('todoText')||document.getElementById('addTodoText');if(i)i.value='巡检任务';confirmAddTodo();return 1})()"),
    ("toggleTodo", "(function(){var t=appData.todos[0];if(t)toggleTodo(t.id);return 1})()"),
    ("showDeleteConfirm", "(function(){var t=appData.todos[0];if(t)showDeleteConfirm(t.id);return 1})()"),
    # 计时
    ("startPomodoroCore", "startPomodoroCore()"),
    ("pauseTimer", "toggleTimer()"),
    ("resetTimer", "(function(){try{resetTimer()}catch(e){return 'EXC:'+e.message}return 1})()"),
    # 签到
    ("doSignIn", "doSignIn()"),
    # 树
    ("waterTree", "(function(){try{waterTree()}catch(e){return 'EXC:'+e.message}return 1})()"),
    ("degradeTree", "degradeTree(true)"),
    ("checkTreeDeath", "checkTreeDeath()"),
    ("checkTreeDailyTasks", "checkTreeDailyTasks()"),
    ("degradeHabits", "degradeHabits()"),
    # 周标/结算
    ("processWeeklyBadges", "processWeeklyBadges()"),
    ("getBadgeState", "getBadgeState(WEEKLY_BADGES[0])"),
    ("badgesAtRiskBySpend", "badgesAtRiskBySpend(1)"),
    ("getWeekHeldTomatoes", "getWeekHeldTomatoes()"),
    ("getWeekFullTomatoes", "getWeekFullTomatoes()"),
    # 日历/日期
    ("onDayRolled", "(function(){try{onDayRolled()}catch(e){return 'EXC:'+e.message}return 1})()"),
    ("mustDoCarryoverFromPrev", "(function(){try{mustDoCarryoverFromPrev()}catch(e){return 'EXC:'+e.message}return 1})()"),
    # 数据
    ("exportData", "typeof exportData==='function'?String(!!exportData()).slice(0,4):'no'"),
    ("saveData", "typeof saveData==='function'?(saveData(),0):0"),
    ("validateBackup", "typeof validateBackup==='function'?JSON.stringify(validateBackup(appData)):'no'"),
    ("normalizeBackupData", "typeof normalizeBackupData==='function'?(normalizeBackupData(JSON.parse(JSON.stringify(appData))),0):0"),
    # 统计缓存
    ("invalidateStatsCache", "invalidateStatsCache()"),
    ("getStatsCache.after", "JSON.stringify(getStatsCache()).length"),
    # 难度/轻松模式
    ("enableEasyMode", "typeof enableEasyMode==='function'?(enableEasyMode(),0):0"),
    ("disableEasyMode", "typeof disableEasyMode==='function'?(disableEasyMode(),0):0"),
    # 引导
    ("checkFirstRunGuide", "checkFirstRunGuide()"),
    ("syncGuideVisibility", "typeof syncGuideVisibility==='function'?(syncGuideVisibility(),0):0"),
    # 沉浸
    ("toggleImmersion.on", "(function(){try{startPomodoroCore();toggleImmersion();return 1}catch(e){return 'EXC:'+e.message}})()"),
    ("toggleImmersion.off", "toggleImmersion()"),
    # 弹窗开关
    ("openModal.microBreak", "(function(){try{showMicroBreak&&showMicroBreak();return 1}catch(e){return 'EXC:'+e.message}})()"),
    ("maybeShowCareModal", "maybeShowCareModal()"),
    ("showFinishModal", "(function(){try{showFinishModal({}) ;return 1}catch(e){return 'EXC:'+e.message}})()"),
]


def main_mut():
    print()
    print("=" * 70)
    print("状态变更巡检：增/删/改/结算路径")
    print("=" * 70)
    proc, ws, send, js, errs = R.launch(500, 900)
    time.sleep(2.5)
    bad = []
    for name, expr in MUT_CALLS:
        r = js(WRAP % expr)
        if r == "ok":
            continue
        bad.append((name, r))
        print("%-28s %s" % (name, r))
    print("-" * 70)
    print("调用点: %d 个，异常: %d 个" % (len(MUT_CALLS), len(bad)))
    time.sleep(1.0)
    if errs:
        print()
        print("运行期异常:")
        for e in errs[:20]:
            print("  ", e[:200])
    print("=" * 70)
    ws.close(); proc.terminate()
    return 1 if bad else 0
