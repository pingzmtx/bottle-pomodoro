/* C86 周期性任务跨天：昨天画出来的预计块不许消失
   ─────────────────────────────────────────────────────────────
   需求原话：「那周期性任务会自动删除吗？这比是个bug呀」——
   顺着问下去实测出来：重复计划**不会被删**，但跨天复位时会把 remindAt 平移到今天、
   顺手删掉过期的额外段，两条都让**昨天**再也算不出钟点。一次性计划那条路
   （clearStaleOneOffSchedule）是先冻结快照再清，重复计划（resetTodoOccurrence）
   却漏了这一步 → 「排了钟点、当天没做完的重复任务，第二天日程表上昨天那块凭空消失」。
   本用例锁住：
     A 未完成的重复计划：跨天后昨天块仍在
     B 已完成的重复计划：昨天块仍在，且今天复位成未完成、排期滚到今天
     C 「只有额外段」的重复计划：昨天块仍在（第二层：活对象判定只看"规则命中"，
       不看"真画得出块"，会导致快照被挡掉）
     D 一次性计划同口径（对照组，防这次修复顺手改坏老路径）
     E 只冻 < today 的日子：今天的块不许被冻成死数据
     F 幂等：重复调用 checkNewDay 不再新增快照、不再改块
     G 反证：把快照抹掉 → 昨天的块真的会消失（断言有牙齿）
     H 复位清的是"这一轮"的进度，历史那一轮留在快照里（actPomos 不丢） */
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
  function draw(ds) {
    tbPickDate(ds);
    return document.getElementById('tbGridWrap');
  }
  function snapIds(ds) {
    return ((appData.todoSchedLog || {})[ds] || []).map(function (x) { return String(x.id); });
  }

  var bTodos = appData.todos.slice();
  var bLog = JSON.parse(JSON.stringify(appData.todoSchedLog || {}));
  var bClean = appData.lastTodoCleanupDate;
  var yest = dsOf(-1), today = dsOf(0);
  var R1 = 'c86_rep', R2 = 'c86_repdone', R3 = 'c86_isExtra', O1 = 'c86_one';

  try {
    appData.todos = [
      { id: R1, title: 'C86每日重复·未完成', done: false, repeat: { mode: 'daily' },
        remindAt: yest + ' 09:00', estEnd: yest + ' 10:00', estEndManual: true,
        pomodoros: 2, quad: 'q1', tag: '学习', subs: [] },
      { id: R2, title: 'C86每日重复·已完成', done: true, doneAt: Date.now() - 3600e3,
        repeat: { mode: 'daily' }, remindAt: yest + ' 11:00', estEnd: yest + ' 12:00',
        estEndManual: true, pomodoros: 1, actualPomodoros: 1, quad: 'q1', tag: '学习', subs: [] },
      { id: R3, title: 'C86只有额外段的重复', done: false, repeat: { mode: 'daily' },
        extraBlocks: [{ start: yest + ' 15:00', end: yest + ' 16:00' }] },
      { id: O1, title: 'C86一次性·未完成', done: false,
        remindAt: yest + ' 14:00', estEnd: yest + ' 15:00', estEndManual: true,
        pomodoros: 2, quad: 'q1', tag: '学习', subs: [] }
    ];
    appData.todoSchedLog = {};
    appData.lastTodoCleanupDate = yest;

    /* ---------- 基线：跨天之前，四条都在昨天的格子上 ---------- */
    var w0 = draw(yest);
    ok('A0 跨天前：重复计划在昨天有块', planBlocks(w0, R1) === 1, planBlocks(w0, R1));
    ok('C0 跨天前：只有额外段的那条也有块', planBlocks(w0, R3) === 1, planBlocks(w0, R3));

    /* ---------- 跨天 ---------- */
    checkNewDay();

    var w = draw(yest);
    ok('A1 ★未完成的重复计划：昨天那块还在', planBlocks(w, R1) === 1, planBlocks(w, R1));
    ok('B1 ★已完成的重复计划：昨天那块还在', planBlocks(w, R2) === 1, planBlocks(w, R2));
    ok('C1 ★只有额外段的重复计划：昨天那块还在', planBlocks(w, R3) === 1, planBlocks(w, R3));
    ok('D1 一次性计划对照组：昨天那块也还在', planBlocks(w, O1) === 1, planBlocks(w, O1));

    /* ---------- B：复位语义没被这次改动带歪 ---------- */
    var r2 = appData.todos.filter(function (t) { return String(t.id) === R2; })[0];
    ok('B2 已完成的那条今天复位成未完成', !!r2 && r2.done === false);
    ok('B3 这一轮的 actualPomodoros 清零', !!r2 && !r2.actualPomodoros, r2 && r2.actualPomodoros);
    ok('B4 排期滚到今天（同钟点）', !!r2 && String(r2.remindAt).slice(0, 10) === today &&
      String(r2.remindAt).slice(11) === '11:00', r2 && r2.remindAt);
    ok('B5 重复计划没有被删掉（列表里还在）',
      appData.todos.filter(function (t) { return String(t.id) === R2; }).length === 1);
    var wToday = draw(today);
    ok('B6 今天照样画得出块', planBlocks(wToday, R2) === 1, planBlocks(wToday, R2));

    /* ---------- E：只冻 < today 的日子 ---------- */
    ok('E1 今天的排期没被冻成快照（只冻过去的日子）', snapIds(today).indexOf(R2) < 0,
      JSON.stringify(snapIds(today)));
    ok('E2 昨天确实冻了', snapIds(yest).indexOf(R1) >= 0 && snapIds(yest).indexOf(R2) >= 0,
      JSON.stringify(snapIds(yest)));

    /* ---------- H：历史那一轮的进度留在快照里 ---------- */
    var s2 = (appData.todoSchedLog[yest] || []).filter(function (x) { return String(x.id) === R2; })[0];
    ok('H1 快照保留了那天做完的事实', !!s2 && !!s2.doneAt, s2 && s2.doneAt);
    ok('H2 快照保留了那天的实际番茄数', !!s2 && s2.actPomos === 1, s2 && s2.actPomos);
    var s1 = (appData.todoSchedLog[yest] || []).filter(function (x) { return String(x.id) === R1; })[0];
    ok('H3 未完成的那条快照里 actPomos 是 0（不凭空记功）', !!s1 && !s1.actPomos, s1 && s1.actPomos);

    /* ---------- F：幂等 ---------- */
    var nSnap = (appData.todoSchedLog[yest] || []).length;
    checkNewDay();
    checkNewDay();
    ok('F1 连跑两次不再新增快照', (appData.todoSchedLog[yest] || []).length === nSnap,
      (appData.todoSchedLog[yest] || []).length + ' vs ' + nSnap);
    var wAgain = draw(yest);
    ok('F2 连跑两次块数不变', planBlocks(wAgain, R1) === 1 && planBlocks(wAgain, R3) === 1,
      planBlocks(wAgain, R1) + '/' + planBlocks(wAgain, R3));

    /* ---------- G 反证：块确实来自快照 ---------- */
    var keep = (appData.todoSchedLog[yest] || []).filter(function (x) {
      return [R1, R2, R3].indexOf(String(x.id)) < 0;
    });
    appData.todoSchedLog[yest] = keep;
    var wNo = draw(yest);
    ok('G1 抹掉快照后，重复计划昨天那块真的消失（断言有牙齿）',
      planBlocks(wNo, R1) === 0 && planBlocks(wNo, R3) === 0,
      planBlocks(wNo, R1) + '/' + planBlocks(wNo, R3));
  } catch (e) {
    ok('EX 用例自身异常', false, e && (e.message + ' @' + (e.stack || '').split('\n')[1]));
  } finally {
    appData.todos = bTodos;
    appData.todoSchedLog = bLog;
    appData.lastTodoCleanupDate = bClean;
    try { renderTodos(); tbPickDate(dsOf(0)); } catch (e) { /* 还原失败不影响断言结果 */ }
  }
  return JSON.stringify(R);
})();
