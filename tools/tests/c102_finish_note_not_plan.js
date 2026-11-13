/* C102 番茄结束的备注只属于这次记录，不许改写计划备注
 *
 * 现象（用户 2026-10-20 报）：「番茄结束的备注为什么把计划的备注也改了？
 * 我要是有一个周期性的任务，每天都用番茄，记录一下每次完成的番茄，
 * 岂不是会把备注改得乱七八糟？」
 *
 * 根因：savePomodoroRecord 结算时把 finishNote 写回关联计划的 detail
 * （`lt.detail = note`）。结束框又是从会话备注预填的，于是每做一次番茄，
 * 计划说明就被这一次的「心得」覆盖一次；备注留空时更是直接把计划说明清空。
 *
 * 口径：「计时页备注框 ↔ 计划备注」是计划备注的编辑入口（保留）；
 *       「结束弹窗的备注」是这一次结算的备注，只进 record.note。
 *
 * A 一次性计划：结束备注不动 detail
 * B 重复计划连做两次：detail 全程是原文，两条记录各自留自己的备注
 * C 备注留空：不清空计划说明（旧实现会把它抹成空串）
 * D 计时页备注框写回计划备注的共通入口没被误伤
 */
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }

  var TODO_BAK = appData.todos;
  var REC_BAK = appData.records;
  var TS_BAK = timerState;
  var LIVE_BAK = appData.liveSessions;
  var noteEl = document.getElementById('finishNote');
  var noteElBak = noteEl ? noteEl.value : '';
  var selEl = document.getElementById('currentTodoSelect');
  var selBak = selEl ? selEl.innerHTML : '';
  var optHtml = '';

  function mkTodo(over) {
    var t = { id: 9701, title: '背单词', done: false, quad: 'q1', tag: '英语',
      pomodoros: 1, subs: [], detail: '每天背 50 个词，第 3 单元' };
    Object.keys(over || {}).forEach(function (k) { t[k] = over[k]; });
    return t;
  }

  /* 走真实的结算写入口（savePomodoroRecord），不是直接调某个小函数 */
  function settle(note, todoId, secs) {
    if (noteEl) noteEl.value = note;
    timerState.mode = 'focus';
    timerState.running = false;
    timerState.finishSource = 'todo';
    timerState.linkedTodoId = todoId;
    timerState.curSubId = null;
    timerState.taskName = (appData.todos.filter(function (x) { return x.id === todoId; })[0] || {}).title || '';
    timerState.note = note;
    timerState.startTime = Date.now() - secs * 1000;
    timerState.effectiveSeconds = secs;
    timerState.interruptions = [];
    timerState.totalInterruptSeconds = 0;
    timerState.__noAutoBreak = true;
    var n0 = appData.records.length;
    savePomodoroRecord('full');
    return appData.records.length === n0 + 1 ? appData.records[appData.records.length - 1] : null;
  }

  try {
    appData.todos = [];
    appData.records = [];

    /* ── A 一次性计划 ───────────────────────────────────────── */
    var tA = mkTodo({ id: 9701, title: '整理错题', detail: '把数学卷子的错题抄到本子上' });
    appData.todos.push(tA);
    var rA = settle('今天错题有点多', 9701, 1500);
    ok('A1 记录写进去了', !!rA);
    ok('A2 记录备注是这次写的', !!rA && rA.note === '今天错题有点多', rA && rA.note);
    ok('A3 计划备注没被改写', tA.detail === '把数学卷子的错题抄到本子上', tA.detail);

    /* ── B 重复计划连做两次 ─────────────────────────────────── */
    var tB = mkTodo({
      id: 9702, title: '背单词', detail: '每天背 50 个词，第 3 单元',
      repeat: { mode: 'daily', subsMode: 'reset' }
    });
    appData.todos.push(tB);
    var rB1 = settle('早上状态不错', 9702, 1500);
    ok('B1 第一次做完，计划备注还是原文', tB.detail === '每天背 50 个词，第 3 单元', tB.detail);
    var rB2 = settle('晚上有点困，只背了 30 个', 9702, 1500);
    ok('B2 第二次做完，计划备注还是原文', tB.detail === '每天背 50 个词，第 3 单元', tB.detail);
    ok('B3 两次的记录各留自己的备注',
      !!rB1 && !!rB2 && rB1.note === '早上状态不错' && rB2.note === '晚上有点困，只背了 30 个',
      (rB1 && rB1.note) + ' / ' + (rB2 && rB2.note));
    ok('B4 两条记录都挂在同一条计划上', !!rB1 && !!rB2 && rB1.todoId === 9702 && rB2.todoId === 9702,
      (rB1 && rB1.todoId) + ' / ' + (rB2 && rB2.todoId));

    /* ── C 备注留空不清空计划说明 ───────────────────────────── */
    var tC = mkTodo({ id: 9703, title: '跑步', detail: 'Keep 3 公里，心率 150 以内' });
    appData.todos.push(tC);
    settle('', 9703, 1500);
    ok('C1 备注留空 → 计划说明原样保留', tC.detail === 'Keep 3 公里，心率 150 以内', JSON.stringify(tC.detail));
    /* 先有备注再清空，同样不许把计划带空 */
    settle('最后一分钟冲刺', 9703, 1500);
    ok('C2 写过的备注也不落进计划', tC.detail === 'Keep 3 公里，心率 150 以内', tC.detail);

    /* ── D 计时页备注框：写它也不许改计划备注 ───────────────
       同一条链上的另一个入口 —— 备注框（占位「这次番茄要做什么…」）过去
       敲一个字就把计划说明覆盖一次。它现在也只属于这一次专注。 */
    if (selEl) {
      optHtml = '<option value="9704" selected>自定义皮肤</option>';
      selEl.innerHTML = optHtml;
    }
    var tD = mkTodo({ id: 9704, title: '自定义皮肤', detail: '旧说明：米色' });
    appData.todos.push(tD);
    var boxEl = document.getElementById('currentTodoNote');
    if (boxEl) boxEl.value = '今天想换成灰蓝';
    try {
      if (typeof syncTimerNoteToPlan === 'function') syncTimerNoteToPlan();
    } catch (e) { }
    ok('D1 在计时页备注框里写字，计划备注不变', tD.detail === '旧说明：米色', JSON.stringify(tD.detail));

    /* 开始专注这条路径：原来按「开始」也会把备注框内容写回计划 */
    if (boxEl) boxEl.value = '开始前的临时备注';
    if (selEl) selEl.value = '9704';
    try {
      timerState = createTimerState();
      startPomodoroCore();
    } catch (e) { R.push(['!! 开始专注抛错（不影响 D1 结论）：' + (e && e.message), true]); }
    ok('D2 按「开始」也不写回计划备注', tD.detail === '旧说明：米色', JSON.stringify(tD.detail));
    ok('D3 但这一次的备注进了会话（记录里会用）',
      String(timerState.note || '') === '开始前的临时备注', JSON.stringify(timerState.note));

    /* ── 收尾 ───────────────────────────────────────────────── */
  } catch (e) {
    R.push(['✗ 用例抛异常：' + String((e && e.stack) || e), false]);
  } finally {
    try { if (noteEl) noteEl.value = noteElBak; } catch (e1) { }
    try { if (selEl) { selEl.innerHTML = selBak; } } catch (e2) { }
    try { if (typeof stopTimer === 'function') stopTimer(true); } catch (e4) { }
    try { if (typeof stopTimerLoop === 'function') stopTimerLoop(); } catch (e5) { }
    try { appData.liveSessions = LIVE_BAK; } catch (e6) { }
    try {
      /* 本轮写进去的记录一直留着会污染别的用例（它们常按「最后一条」取），撤掉 */
      appData.records = REC_BAK;
    } catch (e3) { }
    appData.todos = TODO_BAK;
    timerState = TS_BAK;
  }
  return JSON.stringify(R);
})();
