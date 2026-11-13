/* C40 自由专注也算「正在专注」+ 番茄「暂停/打断」态不进快照 → 重开不能自己跑

   两个问题：
     ① 自由专注计时中仍然弹任务提醒窗。
     ② 重开 App 后恢复计时也会弹。

   根因一（提醒）：remindFocusRunning() 只认 mode==='focus'（番茄钟），
     自由专注是 mode==='free' → 判定为「不在专注」→ 全屏提醒窗照弹。
   根因二（重开还在跑）：focus 快照里没有 paused 字段，而「打断」只把 running
     置 false、endAt 不动；切走/退出（freeze/pagehide）会无 running 守卫地落一份
     「没有暂停语义」的快照 → 重开时 now<endAt 就 running:true 续跑，
     并把离开 App 的整段时间算进专注；now>endAt 且有效时长≥50% 还会自动结算出一颗完整番茄。
   根因三（重开界面错乱）：restoreFreeSnapshot 只还原 timerState.mode='free'，
     没还原 timerMode → applyTimerModeUI 的 free 分支从不执行，按钮接成番茄钟的 toggleTimer，
     点「暂停」点不动（计时停不下来）。

   断言覆盖：free 判定 / 门闩（冷启动时序）/ free 恢复还原 timerMode /
             打断态快照只还原成暂停、不自动结算 / 正常 running 快照不误伤。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }

  var snapBak = appData.timerSnapshot;
  var restBak = window.__timerSnapshotRestored;
  var recordsBak = (appData.records || []).length;

  function hardReset() {
    try { if (typeof resetToIdle === 'function') resetToIdle(); } catch (e) { void e; }
    timerState = createTimerState();
    appData.timerSnapshot = null;
  }

  /* ---------- ① 判定：自由专注 = 正在专注 ---------- */
  hardReset();
  timerState.mode = 'free'; timerState.running = true;
  ok('①a 自由专注中 → remindFocusRunning() 为真（原投诉的根因）', remindFocusRunning() === true);
  timerState.mode = 'idle'; timerState.running = false;
  ok('①b 空闲 → 为假（别把静音做过头）', remindFocusRunning() === false);
  timerState.mode = 'focus'; timerState.running = true;
  ok('①c 番茄钟专注中 → 仍为真（不回归）', remindFocusRunning() === true);
  timerState.mode = 'focus'; timerState.running = false;
  ok('①d 番茄钟暂停中 → 为假（暂停时该提醒要提醒）', remindFocusRunning() === false);

  /* ---------- ② 冷启动门闩：快照没恢复完之前也当专注中 ---------- */
  hardReset();
  appData.timerSnapshot = { mode: 'free', freeType: 'stopwatch', running: true, startTime: Date.now() - 60000, pausedElapsed: 0 };
  window.__timerSnapshotRestored = undefined;
  ok('②a 快照躺着一段没恢复完的专注 → 判定为专注中（5s 心跳不会抢先弹窗）', remindFocusRunning() === true);
  window.__timerSnapshotRestored = true;
  ok('②b 恢复完成后门闩放行（没在跑就该弹）', remindFocusRunning() === false);

  /* ---------- ③ free 快照恢复：timerMode 必须跟着还原 ---------- */
  hardReset();
  appData.timerSnapshot = { mode: 'free', freeType: 'stopwatch', running: true, startTime: Date.now() - 5000, pausedElapsed: 0, taskName: '自由专注' };
  timerMode = 'pomodoro'; /* 模拟刷新后回到默认 */
  restoreTimerSnapshot();
  ok('③a 恢复自由专注后 timerMode 还原为 free（否则界面错乱、按钮接成番茄钟）', timerMode === 'free');
  ok('③b 恢复后确实是 free 会话', timerState.mode === 'free');
  ok('③c 恢复后计时在跑', timerState.running === true);

  /* ---------- ④ 番茄「打断/暂停」态：只还原成暂停，绝不自动续跑、绝不自动结算 ---------- */
  hardReset();
  appData.timerSnapshot = {
    mode: 'focus', endAt: Date.now() + 600000, totalDuration: 1500,
    effectiveSeconds: 900, paused: true, pausedRemaining: 600,
    startTime: Date.now() - 900000, taskName: '被打断的番茄',
    interruptions: [], currentInterruptStart: 0, totalInterruptSeconds: 0
  };
  restoreTimerSnapshot();
  ok('④a 打断态快照恢复后不自动续跑', timerState.running === false);
  ok('④b 打断态快照恢复后不进自动结算（没多出一颗番茄）', (appData.records || []).length === recordsBak);
  ok('④c 打断态快照恢复后仍是番茄钟焦点态、剩时为暂停值', timerState.mode === 'focus' && Math.round(timerState.remaining) === 600);

  /* ---------- ⑤ 正常 running 快照不被误伤 ---------- */
  hardReset();
  appData.timerSnapshot = {
    mode: 'focus', endAt: Date.now() + 600000, totalDuration: 1500,
    effectiveSeconds: 900, startTime: Date.now() - 900000, taskName: '正常番茄'
  };
  restoreTimerSnapshot();
  ok('⑤a 正常番茄快照恢复后继续 running', timerState.running === true);
  ok('⑤b 正常番茄快照恢复后仍剩 ~600 秒', Math.abs(timerState.remaining - 600) <= 3);

  /* ---------- ⑥ 落盘：打断后抽一份快照，必须带 paused 标记 ---------- */
  hardReset();
  timerState.mode = 'focus';
  timerState.running = false;
  timerState.endAt = Date.now() + 600000;
  timerState.remaining = 600;
  timerState.pausedRemaining = 600;
  timerState.totalDuration = 1500;
  if (typeof saveTimerSnapshot === 'function') saveTimerSnapshot();
  var s6 = appData.timerSnapshot;
  ok('⑥ 打断/暂停态落盘的快照带 paused 标记（否则重开必被当成运行中续跑）', !!(s6 && s6.mode === 'focus' && s6.paused === true));

  /* ---------- 收尾：还原现场 ---------- */
  try { if (typeof stopTimerLoop === 'function') stopTimerLoop(); } catch (e) { void e; }
  hardReset();
  appData.timerSnapshot = snapBak;
  window.__timerSnapshotRestored = restBak;
  if (appData.records && appData.records.length > recordsBak) appData.records.length = recordsBak;
  try { if (typeof saveDataNow === 'function') saveDataNow(); } catch (e) { void e; }

  return JSON.stringify(R);
})();
