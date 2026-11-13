/* C84 自由专注「回到待命」必须按正计时画，不许刷成番茄钟的 25:00
   ─────────────────────────────────────────────────────────────
   需求原话：「正计时新增了可以选择任务…现在它好像是复用代码时候
   错误了，它有的时候吧，那提示一个 25 分钟，就跟那个番茄钟一样，点击那个暂停
   才是开始正计时」

   真因：`resetToIdle()` 只会画**番茄钟待命态**，但自由专注也会走到它 ——
   ① 自由专注结算确认 `confirmFinish()`；② 休息结束 `exitBreak()`。
   旧写法把 `timerMode` 留在 stopwatch（仍是自由专注），界面却刷回
   「25:00 / 准备开始」，且**没重设开始按钮**：上一轮的「⏸ 暂停」留着 →
   用户点「暂停」反而进了 toggleFreeTimer 的开始分支，正计时从 00:00 跑起来。

   锁住（每一条都对应修复前的红）：
     A resetToIdle（正计时）→ 00:00 / 正计时 / 开始按钮，不是 25:00 / 暂停
     B 休息结束（exitBreak）走同一出口，也要是正计时待命态
     C 流式（flowtime）子模式同样不许显示 25:00
     D 点那个「开始」必须真的开始正计时（用户看到的那一刻就是错的）
     E 番茄钟不受影响：仍是 25:00 / 准备开始 / 开始按钮接 toggleTimer
     F 自由专注待命态没有「打断」按钮（它只属于番茄钟）
   还原：所有状态在 finally 里复原，不留会话/快照/类型残留。 */
(function () {
  var R = [];
  /* 契约：每条只收 [名字, 布尔]（run_smoke / local_batch 都按两元组解包）。
     实际值并进失败项的名字里，红了能直接看到数。 */
  function ok(n, c, d) { R.push([c ? n : n + '（实际：' + (d === undefined ? '' : String(d)) + '）', !!c]); }
  var ST = {
    text: function (id) { var e = document.getElementById(id); return e ? (e.innerText || e.textContent || '').trim() : ''; },
    shown: function (id) { var e = document.getElementById(id); return !!e && e.style.display !== 'none'; }
  };
  var bak = {
    mode: timerMode,
    ft: window._freeType,
    ts: JSON.parse(JSON.stringify(timerState))
  };
  function enterFree(ft) {
    /* 不管当前在哪：先回番茄钟待命，再切自由专注，保证起点干净 */
    try { resetToIdle(); } catch (e1) { /* ignore */ }
    if (isFreeMode()) { timerMode = 'pomodoro'; applyTimerModeUI(); }
    window._freeType = ft;
    timerMode = 'free';
    applyTimerModeUI();
  }
  try {
    if (typeof switchView === 'function') switchView('timer');

    /* ---------- A 直接调 resetToIdle（正计时） ---------- */
    enterFree('stopwatch');
    timerState = createTimerState({
      mode: 'free', freeType: 'stopwatch', running: true, remaining: 900,
      totalDuration: 0, startTime: Date.now() - 900000, pausedElapsed: 0
    });
    timerState.taskName = 'keep运动';
    document.getElementById('btnStart').innerHTML = '<span>⏸ 暂停</span><span class="btn-sub">pause</span>';
    resetToIdle();
    ok('A1 回到待命后表盘是 00:00（不是番茄钟的 25:00）', ST.text('timerTime') === '00:00', ST.text('timerTime'));
    ok('A2 标签是「正计时」（不是「准备开始」）', ST.text('timerLabel') === '正计时', ST.text('timerLabel'));
    ok('A3 开始按钮文案回到「开始」，没留上一轮的「暂停」',
      /开始/.test(ST.text('btnStart')) && !/暂停|继续/.test(ST.text('btnStart')), ST.text('btnStart'));
    ok('A4 会话剩余是 0 秒（正计时没有总时长）', timerState.remaining === 0, timerState.remaining);
    ok('A5 会话仍是自由专注待命，不是番茄钟待命',
      isFreeMode() && timerState.mode === 'idle', timerMode + '/' + timerState.mode);

    /* ---------- B 休息结束（exitBreak）也是同一出口 ---------- */
    enterFree('stopwatch');
    timerState = createTimerState({
      mode: 'free', freeType: 'stopwatch', running: true, remaining: 600,
      totalDuration: 0, startTime: Date.now() - 600000, pausedElapsed: 0
    });
    startBreak('short');
    ok('B0 休息确实起来了（前提成立）', timerState.mode === 'shortBreak', timerState.mode);
    exitBreak();
    ok('B1 休息结束回到正计时待命：00:00', ST.text('timerTime') === '00:00', ST.text('timerTime'));
    ok('B2 休息结束标签是「正计时」', ST.text('timerLabel') === '正计时', ST.text('timerLabel'));
    ok('B3 休息结束开始按钮是「开始」', /开始/.test(ST.text('btnStart')) && !/暂停|继续/.test(ST.text('btnStart')),
      ST.text('btnStart'));

    /* ---------- C 流式子模式 ---------- */
    enterFree('flowtime');
    timerState = createTimerState({
      mode: 'free', freeType: 'flowtime', running: true, remaining: 1200,
      totalDuration: 1500, endAt: Date.now() + 1200000, startTime: Date.now(), pausedElapsed: 0
    });
    resetToIdle();
    ok('C1 流式待命也不许显示 25:00', ST.text('timerTime') === '00:00', ST.text('timerTime'));
    ok('C2 流式待命剩余归零', timerState.remaining === 0, timerState.remaining);

    /* ---------- D 用户看到的按钮必须真的开始正计时 ---------- */
    enterFree('stopwatch');
    timerState = createTimerState({
      mode: 'free', freeType: 'stopwatch', running: true, remaining: 300,
      totalDuration: 0, startTime: Date.now() - 300000, pausedElapsed: 0
    });
    resetToIdle();
    document.getElementById('btnStart').click();
    ok('D1 点「开始」后真的进入正计时（running + mode=free）',
      timerState.mode === 'free' && timerState.running === true, timerState.mode + '/' + timerState.running);
    ok('D2 正计时从 0 起算，不是揣着番茄钟的 1500 秒',
      timerState.remaining < 5 && timerState.totalDuration === 0,
      timerState.remaining + '/' + timerState.totalDuration);
    ok('D3 按钮变成「暂停」（这次才是真的在跑）', /暂停/.test(ST.text('btnStart')), ST.text('btnStart'));

    /* ---------- E 番茄钟不被带歪 ---------- */
    try { timerMode = 'pomodoro'; } catch (e3) { /* ignore */ }
    resetToIdle();
    ok('E1 番茄钟待命仍是 25:00 档（读设置 workDuration）',
      ST.text('timerTime') === String(appData.settings.workDuration).padStart(2, '0') + ':00',
      ST.text('timerTime'));
    ok('E2 番茄钟标签是「准备开始」', ST.text('timerLabel') === '准备开始', ST.text('timerLabel'));
    ok('E3 番茄钟开始按钮是「开始」', /开始/.test(ST.text('btnStart')) && !/暂停|继续/.test(ST.text('btnStart')),
      ST.text('btnStart'));

    /* ---------- F 打断按钮归属 ---------- */
    enterFree('stopwatch');
    resetToIdle();
    ok('F1 自由专注待命态不显示「打断」', !ST.shown('btnInterrupt'), document.getElementById('btnInterrupt').style.display);

    /* ---------- G 休息**自然结束**（不是 skip）同一出口 ---------- */
    enterFree('stopwatch');
    timerState = createTimerState({
      mode: 'shortBreak', freeType: 'stopwatch', running: true, remaining: 1,
      totalDuration: 300, endAt: Date.now() - 1, startTime: Date.now() - 300000, pausedElapsed: 0
    });
    timerState.breakRemindIv = null;
    onTimerComplete();
    ok('G1 休息自然结束后表盘归零（不是停在休息剩余）', ST.text('timerTime') === '00:00', ST.text('timerTime'));
    ok('G2 休息自然结束后开始按钮回到「开始」', /开始/.test(ST.text('btnStart')) && !/暂停|继续|跳过/.test(ST.text('btnStart')),
      ST.text('btnStart'));
    ok('G3 番茄钟下休息自然结束仍是 25:00 档',
      (function () {
        try { timerMode = 'pomodoro'; } catch (eG) { return false; }
        timerState = createTimerState({
          mode: 'shortBreak', running: true, remaining: 1, totalDuration: 300,
          endAt: Date.now() - 1, startTime: Date.now() - 300000, pausedElapsed: 0
        });
        timerState.breakRemindIv = null;
        onTimerComplete();
        return ST.text('timerTime') === String(appData.settings.workDuration).padStart(2, '0') + ':00';
      })(), ST.text('timerTime'));
  } catch (e) {
    ok('用例执行未抛异常：' + (e && e.message), false);
  } finally {
    /* 还原：回番茄钟待命 + 清快照 + 类型复原（别把测试会话/模式留给后面的用例） */
    try { timerMode = 'pomodoro'; } catch (e4) { /* ignore */ }
    try { timerState = createTimerState({ mode: 'idle', running: false, remaining: 0, totalDuration: 0 }); } catch (e5) { /* ignore */ }
    try { clearTimerSnapshot(); } catch (e6) { /* ignore */ }
    try { window._freeType = bak.ft; } catch (e7) { /* ignore */ }
    try { applyTimerModeUI(); } catch (e8) { /* ignore */ }
    try { resetToIdle(); } catch (e9) { /* ignore */ }
  }
  return JSON.stringify(R);
})();
