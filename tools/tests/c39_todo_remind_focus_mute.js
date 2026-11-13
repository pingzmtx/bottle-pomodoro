/* C39 专注中不打扰：定点提醒 / 任务提醒都只轻提示，专注结束后补弹
   计时中（含重开 App 恢复的那次）不应该弹任务提醒窗。

   根因：专注静音只在**定点提醒**（remindCheckTime）里写了一份，任务提醒
   （checkTodoReminders，在 01g）没有 → 计时中原样弹确认窗。
   修法：把「专注中不打扰」收进公共件 remindEnqueue：
     · 正在专注（mode==='focus' && running）→ 不入弹窗，只轻提示一次（_remindFocusMute），
       提醒**留在队列里**；
     · remindRenderHead 再加一道兜底，专注中绝不 showModal；
     · remindFocusFlush()（挂 5s 心跳）在专注结束/空闲时把积压的提醒补弹出来；
     · 任务提醒专注中也不推系统通知、不震动。
   断言覆盖：定点静音 / 轻提示只一次 / 任务静音 / 不推通知 / 专注结束补弹 / 空闲照常弹。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }

  var RE = 'point:9101', RT = 'todo:9102';
  var tBak = null, modeBak = null, runBak = null;
  var todoBak = null;

  function setFocus(on) {
    timerState.mode = on ? 'focus' : 'idle';
    timerState.running = !!on;
  }
  function modalOpen() {
    var el = document.getElementById('remindModal');
    if (!el) return false;
    var cls = String(el.className || '');
    return cls.indexOf('show') >= 0 || el.style.display === 'flex';
  }
  function inQueue(k) {
    if (typeof _remindQueue === 'undefined' || !_remindQueue) return false;
    for (var i = 0; i < _remindQueue.length; i++) if (_remindQueue[i].key === k) return true;
    return false;
  }
  function clearQueue() {
    if (typeof _remindQueue !== 'undefined' && _remindQueue) _remindQueue.length = 0;
    if (typeof _remindFocusMute !== 'undefined' && _remindFocusMute) _remindFocusMute = {};
    try { if (typeof closeModal === 'function') closeModal('remindModal'); } catch (e) {}
  }

  try {
    /* 停掉心跳，避免后台扫描干扰断言（用例自己驱动流程） */
    window.__remindWatchPaused = true;
    clearQueue();

    /* ---------- ① 定点提醒：专注中不弹窗、只轻提示一次 ---------- */
    setFocus(true);
    if (typeof remindEnqueue === 'function') {
      remindEnqueue({ key: RE, title: '⏰ 定点提醒到啦', body: '背书', label: '背书' });
    }
    ok('① 专注中定点提醒不弹确认窗', modalOpen() === false);
    ok('①b 专注中提醒仍留在队列里（不丢）', inQueue(RE) === true);
    ok('①c 专注中轻提示只记一次（_remindFocusMute）', _remindFocusMute[RE] === 1);

    /* 再入队一次（同一条重复到点）→ 不该再轻提示、也不该弹 */
    var firstHint = _remindFocusMute[RE];
    if (typeof remindEnqueue === 'function') {
      remindEnqueue({ key: RE, title: '⏰ 定点提醒到啦', body: '背书', label: '背书' });
    }
    ok('①d 重复到点仍是同一次轻提示（不刷屏）', _remindFocusMute[RE] === firstHint);
    ok('①e 重复到点仍不弹窗', modalOpen() === false);
    ok('①f 队列里只有一条（去重生效）', (function () {
      var n = 0;
      for (var i = 0; i < _remindQueue.length; i++) if (_remindQueue[i].key === RE) n++;
      return n === 1;
    })());

    /* ---------- ② 任务提醒：专注中同样静音，且不推系统通知 / 不震动 ---------- */
    var notified = 0, vibrated = 0;
    var notifyBak = window.notify, vibBak = navigator.vibrate;
    try { window.notify = function () { notified++; }; } catch (e) {}
    try { navigator.vibrate = function () { vibrated++; return true; }; } catch (e) {}

    todoBak = appData.todos;
    appData.todos = [{
      id: 9102, title: 'C39 专注中的任务', done: false,
      /* 提醒时刻用「今天 00:00」：新版只认**当天**的排期/提醒（昨天的 8:00 不该在今天再响一次），
         原来写死 2000-01-01 是靠"日期不校验"才通过的，等于把缺陷写进了断言。 */
      remindAt: getTodayStr() + ' 00:00', remindLast: 0, reminded: false,
      subs: [], subsDone: [], pomodoros: 0, tags: []
    }];
    if (typeof checkTodoReminders === 'function') checkTodoReminders(Date.now());
    ok('② 专注中任务提醒不弹确认窗（核心回归）', modalOpen() === false);
    ok('②b 专注中任务提醒留在队列里', inQueue(RT) === true);
    ok('②c 专注中不推系统通知', notified === 0);
    ok('②d 专注中不震动', vibrated === 0);

    /* ---------- ③ 专注结束 → 补弹 ---------- */
    setFocus(false);
    if (typeof remindFocusFlush === 'function') remindFocusFlush();
    ok('③ 专注结束补弹：确认窗出现了', modalOpen() === true);
    ok('③b 补弹后轻提示标记被清掉（下轮专注可再提示）',
      !_remindFocusMute[RE] && !_remindFocusMute[RT]);

    /* ---------- ④ 空闲时照常：不静音、不延后 ---------- */
    clearQueue();
    setFocus(false);
    if (typeof remindEnqueue === 'function') {
      remindEnqueue({ key: RE, title: '⏰ 定点提醒到啦', body: '背书', label: '背书' });
    }
    ok('④ 空闲时定点提醒照常弹窗（没被静音误伤）', modalOpen() === true);

    /* ---------- ⑤ 任务提醒空闲时照常弹 ---------- */
    clearQueue();
    notified = 0;
    appData.todos[0].remindLast = 0;
    appData.todos[0].reminded = false;
    if (typeof checkTodoReminders === 'function') checkTodoReminders(Date.now());
    ok('⑤ 空闲时任务提醒照常弹窗', modalOpen() === true);
    ok('⑤b 空闲时系统通知照常推', notified === 1);

    try { window.notify = notifyBak; } catch (e) {}
    try { navigator.vibrate = vibBak; } catch (e) {}
  } catch (e) {
    R.push(['JS 异常：' + (e && e.message), false]);
  } finally {
    try {
      window.__remindWatchPaused = false;
      clearQueue();
      setFocus(false);
      if (todoBak !== undefined) appData.todos = todoBak;
      if (typeof saveData === 'function') saveData();
      if (typeof renderTodos === 'function') renderTodos();
      try { if (typeof closeModal === 'function') closeModal('remindModal'); } catch (e) {}
      if (typeof remindRearm === 'function') remindRearm();
      if (typeof startRemindWatcher === 'function') startRemindWatcher();
    } catch (e2) { /* 收尾失败不掩盖断言结果 */ }
  }
  return JSON.stringify(R);
})();
