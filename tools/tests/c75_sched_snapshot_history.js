/* C75 计划被删/被清排期后，日程表那天的「预计块」还得画得出来
   ─────────────────────────────────────────────────────────────
   需求原话：「完成的任务第二天不会自动删除吗？删除了，
   它好像那个预计的就不会在日程表上显示了，很多天之前完成的任务，
   只能看到实际完成的时间，看不到预计的那个日程块了」。
   根因：checkNewDay 把已完成的一次性计划从 appData.todos 里删掉（列表只装当前任务），
   而日程表的预计块是**从 todos 现算**的 → 计划一删，那一天只剩 records 画的实际块。
   修法：计划离开活动列表的前一刻冻结排期快照（todoSchedLog），渲染时以快照补位。
   本用例锁住：
     A 计划还在列表里 → 快照不抢当前值（以活对象为准）
     B 勾完成 → 快照冻结那天的排期，日期不平移
     C 次日被删 → 日程表那天的预计块仍在（且实际块不被误判成"计划外"）
     D 反证：清掉快照 → 预计块真的会消失（断言有牙齿）
     E 取消勾选完成 → 快照撤销，不留幽灵
     F 排期被清回未排期（clearStaleOneOffSchedule）→ 那天预计块仍能画
     G 无排期的计划不产生快照（没有钟点就没有块） */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function dsOf(off) {
    var d = new Date();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + off);
    return getDateStr(d);
  }
  function planBlocks(wrap, id) {
    return wrap.querySelectorAll('.tb-paper-blk.is-plan[data-tb-id="' + id + '"]').length;
  }
  function actBlocks(wrap, id) {
    return wrap.querySelectorAll('.tb-paper-blk.is-actual[data-tb-todo="' + id + '"]').length;
  }
  function draw(ds) {
    tbPickDate(ds);
    return document.getElementById('tbGridWrap');
  }

  var bTodos = appData.todos.slice();
  var bRecs = appData.records.slice();
  var bLog = JSON.parse(JSON.stringify(appData.todoSchedLog || {}));
  var ID = 'c75_a', ID2 = 'c75_b', ID3 = 'c75_c', ID4 = 'c75_d';
  var today = dsOf(0), yest = dsOf(-1), before = dsOf(-2);

  try {
    /* ---------- A / B / C：完成 → 次日删除 → 预计块还在 ---------- */
    var ta = { id: ID, title: 'C75一次性计划', remindAt: yest + ' 17:15', estEnd: yest + ' 18:00',
      estEndManual: true, pomodoros: 1, quad: 'q2', tag: '家务', subs: [], done: false, repeat: '' };
    appData.todos.push(ta);
    var t0 = new Date(yest + 'T17:16:00').getTime();
    appData.records.push({ id: 'c75_rec_a', todoId: ID, todoTitle: ta.title, taskName: ta.title,
      startTime: t0, endTime: t0 + 25 * 60000, effectiveSeconds: 1500, type: 'full',
      segs: [{ s: t0, e: t0 + 25 * 60000, recId: 'c75_rec_a' }] });

    var w = draw(yest);
    ok('A1 计划还在列表：预计块正常画', planBlocks(w, ID) > 0, planBlocks(w, ID));

    /* 基线：这一刻 yest 已有的「计划外」灰块数（来自环境里的历史数据） */
    var _unpBase = draw(yest).querySelectorAll('.tb-paper-blk.is-unplanned').length;

    /* 勾完成：会写完成流水 + 排期快照 */
    toggleTodo(ID);
    var snapA = (appData.todoSchedLog[yest] || []).filter(function (x) { return String(x.id) === ID; })[0];
    ok('B1 勾完成即冻结排期快照', !!snapA);
    ok('B2 快照日期就是那天的日期（不平移）', !!snapA && snapA.remindAt === yest + ' 17:15', snapA && snapA.remindAt);
    ok('B3 快照保住预计结束与配色维度', !!snapA && snapA.estEnd === yest + ' 18:00' && snapA.pomodoros === 1 && snapA.quad === 'q2');

    /* 复刻 checkNewDay 的那一步：已完成的一次性计划被移出活动列表（快照已在删除前写好） */
    snapshotDoneTodosLeaving(today);
    appData.todos = appData.todos.filter(function (t) { return !(String(t.id) === ID && t.done); });
    w = draw(yest);
    ok('C1 计划被删后，那天的预计块仍在', planBlocks(w, ID) > 0, planBlocks(w, ID));
    ok('C2 实际块也还在（来自记录）', actBlocks(w, ID) > 0, actBlocks(w, ID));
    /* C3 用**基线差**判定：真实数据里本来就可能有「有记录、计划已删」的老灰块
       （那正是本用例要修的场景，但没有快照的老数据补不回来）。
       绝对值断言会在有历史数据的环境里假红，所以只问「这条记录有没有多出一个灰块」。 */
    var _unpNow = w.querySelectorAll('.tb-paper-blk.is-unplanned').length;
    ok('C3 该记录不会被误判成「计划外」灰块（灰块数不超过基线）',
      _unpNow <= _unpBase, _unpNow + ' vs base ' + _unpBase);
    ok('C4 快照里的 id 仍是原计划 id（没变成别的计划）',
      JSON.stringify((appData.todoSchedLog[yest] || []).map(function (x) { return String(x.id); })).indexOf(ID) >= 0);

    /* ---------- D 反证：没有快照，预计块就该消失 ---------- */
    delete appData.todoSchedLog[yest];
    w = draw(yest);
    ok('D1 反证：快照被清掉 → 预计块消失（断言确实有牙齿）', planBlocks(w, ID) === 0, planBlocks(w, ID));
    ok('D2 反证：实际块此时只会退化成「计划外」灰块',
      w.querySelectorAll('.tb-paper-blk.is-unplanned').length > 0);

    /* ---------- E 取消勾选 → 快照撤销 ---------- */
    var tb = { id: ID2, title: 'C75反悔计划', remindAt: today + ' 09:00', estEnd: today + ' 09:30',
      estEndManual: true, pomodoros: 1, subs: [], done: false, repeat: '' };
    appData.todos.push(tb);
    toggleTodo(ID2);
    ok('E1 勾完成写出快照', (appData.todoSchedLog[today] || []).some(function (x) { return String(x.id) === ID2; }));
    toggleTodo(ID2);
    ok('E2 取消勾选即撤掉快照（不留幽灵块）',
      !(appData.todoSchedLog[today] || []).some(function (x) { return String(x.id) === ID2; }));

    /* ---------- F 排期被清回未排期，那天的块仍能画 ---------- */
    var tc = { id: ID3, title: 'C75过期排期', remindAt: before + ' 08:00', estEnd: before + ' 08:30',
      estEndManual: true, pomodoros: 1, subs: [], done: false, repeat: '' };
    appData.todos.push(tc);
    ok('F1 清排期前那天画得出预计块', planBlocks(draw(before), ID3) > 0);
    clearStaleOneOffSchedule(today);
    ok('F2 一次性过期排期被清掉（提醒不再僵尸）', !tc.remindAt, tc.remindAt);
    ok('F3 清掉排期时同样冻结了快照（回看那天不缺块）',
      (appData.todoSchedLog[before] || []).some(function (x) { return String(x.id) === ID3; }));
    ok('F4 清排期后那天仍画得出预计块', planBlocks(draw(before), ID3) > 0, planBlocks(draw(before), ID3));

    /* ---------- G 无排期计划不产生快照 ---------- */
    var td = { id: ID4, title: 'C75无排期', remindAt: null, estEnd: null, pomodoros: 1, subs: [], done: false, repeat: '' };
    appData.todos.push(td);
    toggleTodo(ID4);
    var anyD = false;
    Object.keys(appData.todoSchedLog || {}).forEach(function (k) {
      if ((appData.todoSchedLog[k] || []).some(function (x) { return String(x.id) === ID4; })) anyD = true;
    });
    ok('G1 没有钟点就没有块，也不写空快照', !anyD);
  } finally {
    appData.todos = bTodos;
    appData.records = bRecs;
    appData.todoSchedLog = bLog;
    try { if (typeof tbInvalidateSegIndex === 'function') tbInvalidateSegIndex(); } catch (e) { }
    try { renderTodos(); } catch (e2) { }
    try { tbGoToday(); } catch (e3) { }
    try { saveData(); } catch (e4) { }
  }
  return JSON.stringify(R);
})();
