/* C79 专注记录的子步骤快照：只认「这条记录结束前」勾掉的步骤，之后的不许倒灌
   ─────────────────────────────────────────────────────────────
   需求原话：「我希望这个记录相当于是一个快照的形态，它不能实时更新我完成的
   子计划。比如今天下午几点几点，它只显示我那时完成了多少；后面再完成了别的子计划，
   那它要在别的日志显示，而不是这里同步更新」。

   原实现：savePomodoroRecord 里 snapshotPlanSubs(lt) 不看时间，取的是**落库那一刻**
   的勾选状态。结算窗拖到晚上才点确认、或 App 被杀次日恢复结算，都会把之后完成的步骤
   算进这条记录 —— 看起来就像「老记录自己更新了」。

   修法：子任务勾选时记 doneAt；快照按 cutoff（这条记录自己的结束时刻）过滤。
   本用例锁住：
     A 记录结束前勾的 → d=true；结束后才勾的 → d=false
     B 快照冻结：之后再勾/取消，历史记录一个字节都不变
     C 老数据没有 doneAt → 退回 !!done（不做假判断）
     D 两个勾选入口都写 doneAt、取消勾选都删 doneAt
     E 补记与「改挂计划」也按各自记录的时刻截断
     F 反证：把 cutoff 去掉（回到旧口径）→ A 的断言必须变红 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  var MIN = 60000;
  var bTodos = appData.todos.slice();
  var bRecs = appData.records.slice();
  var now = Date.now();
  var ID = '979001', ID2 = '979002'; /* 纯数字 id：timerLinkedTodo 只认数字 */

  function snapOf(subs, cut) { return snapshotPlanSubs({ subs: subs }, cut); }

  try {
    /* ---------- A：cutoff 边界 ---------- */
    var cut = now - 10 * MIN;
    var s1 = snapOf([
      { title: '结束前完成', done: true, doneAt: cut - MIN },
      { title: '结束后完成', done: true, doneAt: cut + MIN },
      { title: '恰好这一秒', done: true, doneAt: cut },
      { title: '还没做', done: false }
    ], cut);
    ok('c79/A1 结束前勾的 → 完成', s1[0].d === true);
    ok('c79/A2 结束后才勾的 → 未完成（不倒灌）', s1[1].d === false);
    ok('c79/A3 恰好等于结束时刻 → 算完成（含边界）', s1[2].d === true);
    ok('c79/A4 本来就没勾的仍是未完成', s1[3].d === false);

    /* ---------- C：老数据无 doneAt ---------- */
    var s2 = snapOf([{ title: '老数据', done: true }], cut);
    ok('c79/C1 老数据没有 doneAt → 退回 !!done，不做假判断', s2[0].d === true);
    var s3 = snapOf([{ title: '老数据', done: true }], 0);
    ok('c79/C2 cutoff 传 0 → 等同不传（全部按现状）', s3[0].d === true);

    /* ---------- D：两个勾选入口都记时刻 ---------- */
    appData.todos.push({ id: ID, title: 'C79计划', quad: 'q2', tag: '测试', done: false,
      subs: [{ id: 979011, title: '第一步', done: false },
             { id: 979012, title: '第二步', done: false }] });
    toggleTodoSub(ID, 0);
    var t = appData.todos.filter(function (x) { return x.id === ID; })[0];
    ok('c79/D1 计划卡勾子任务 → 写入 doneAt', t.subs[0].done === true && Number(t.subs[0].doneAt) > 0);
    toggleTodoSub(ID, 0);
    ok('c79/D2 取消勾选 → 删掉 doneAt（不留下假时刻）', !t.subs[0].done && !('doneAt' in t.subs[0]));

    /* 计时页子任务卡入口 */
    var bLinked = timerState.linkedTodoId;
    timerState.linkedTodoId = ID;
    toggleTimerSub(0);
    ok('c79/D3 计时页勾子任务 → 也写 doneAt', t.subs[0].done === true && Number(t.subs[0].doneAt) > 0);
    toggleTimerSub(0);
    ok('c79/D4 计时页取消勾选 → 也删 doneAt', !t.subs[0].done && !('doneAt' in t.subs[0]));
    timerState.linkedTodoId = bLinked;

    /* ---------- A/B 端到端：落库时刻 ≠ 记录时刻 ---------- */
    t.subs[0].done = true; t.subs[0].doneAt = now - 40 * MIN;
    t.subs[1].done = true; t.subs[1].doneAt = now + 5 * MIN;   /* 「落库之后才勾」的将来时刻 */
    var bLT = timerState.linkedTodoId, bST = timerState.startTime, bFE = timerState.finishEndedAt;
    var bEff = timerState.effectiveSeconds, bTask = timerState.taskName;
    timerState.linkedTodoId = ID; timerState.taskName = 'C79计划';
    timerState.startTime = now - 30 * MIN;
    timerState.effectiveSeconds = 1500;
    timerState.finishEndedAt = now;
    var recN = appData.records.length;
    savePomodoroRecord('full');
    var rec = appData.records[appData.records.length - 1];
    timerState.linkedTodoId = bLT; timerState.startTime = bST; timerState.finishEndedAt = bFE;
    timerState.effectiveSeconds = bEff; timerState.taskName = bTask;
    ok('c79/A5 落库产生了一条新记录', appData.records.length === recN + 1);
    ok('c79/A5b 记录结束前勾的 → 完成',
      !!rec && !!rec.planSubs && rec.planSubs[0] && rec.planSubs[0].d === true);
    ok('c79/A6 落库：记录结束后才勾的 → 未完成（旧实现会错的就是这条）',
      !!rec && !!rec.planSubs && rec.planSubs[1] && rec.planSubs[1].d === false);

    var frozen = JSON.stringify(appData.records.map(function (r) { return r.planSubs; }));
    t.subs[1].doneAt = now - 20 * MIN;    /* 假装「补勾」了 */
    t.subs[0].done = false; delete t.subs[0].doneAt;
    saveData();
    /* 必须真的进日志页再渲染：renderLogs 只往当前视图的容器里画 */
    try { switchView('log'); } catch (e) { }
    try { renderLogs(); } catch (e) { }
    ok('c79/B1 之后再勾/取消，历史记录的快照一个字节都不变',
      frozen === JSON.stringify(appData.records.map(function (r) { return r.planSubs; })));

    /* ---------- E：补记与改挂计划也按各自时刻 ---------- */
    t.subs[1].doneAt = now + 60 * MIN;    /* 补记的是「一小时前」那段，这时还没勾 */
    var s4 = snapOf(t.subs, now - 60 * MIN);
    ok('c79/E1 补记一段更早的时间 → 那时没勾的步骤不算完成', s4[1].d === false);
    var s5 = snapOf(t.subs, now + 120 * MIN);
    ok('c79/E2 补记时刻之后勾的才算完成', s5[1].d === true);

    /* ---------- F：反证 ---------- */
    var oldWay = t.subs.map(function (s) { return { t: String(s.title || ''), d: !!(s && s.done) }; });
    ok('c79/F1 反证：旧口径（不看 cutoff）会把结束后的勾当成完成 → 与 A6 冲突',
      oldWay[1].d === true && rec.planSubs[1].d === false);
    /* ---------- G：合并组取最晚那份快照（两段合并成一条时） ----------
       快照按各自结束时刻截断后，第 1 段那份看不到第 2 段里勾掉的步骤。
       合并组的跨度是两段之和，只有取最晚那份才覆盖得住 —— 取第一份的话
       步骤勾了却哪张卡上都不显示，「N 步未完成」也按第 1 段的口径少算一遍。 */
    var _D0 = Date.now() - 600 * MIN;
    var mkR = function (st, en, subs) {
      return { id: 992100 + Math.round(st / 1000), type: 'full', taskName: 'c79合并',
        todoId: 979001, planTitle: 'c79合并', startTime: st, endTime: en,
        seconds: (en - st) / 1000, planSubs: subs, tag: '测试', quad: 'q2' };
    };
    appData.records.push(mkR(_D0, _D0 + 25 * MIN,
      snapOf([{ title: '甲', done: true, doneAt: _D0 + 5 * MIN },
        { title: '乙', done: true, doneAt: _D0 + 40 * MIN }], _D0 + 25 * MIN)));
    appData.records.push(mkR(_D0 + 26 * MIN, _D0 + 51 * MIN,
      snapOf([{ title: '甲', done: true, doneAt: _D0 + 5 * MIN },
        { title: '乙', done: true, doneAt: _D0 + 40 * MIN }], _D0 + 51 * MIN)));
    saveData();
    /* 必须真的进日志页再渲染：renderLogs 只往当前视图的容器里画 */
    try { switchView('log'); } catch (e) { }
    try { renderLogs(); } catch (e) { }
    var _row = null;
    var _rows = document.querySelectorAll('.log-row-plan');
    for (var _ri = 0; _ri < _rows.length; _ri++) {
      /* 按 chip 文本找，不按计划名：planTitle 只有在 todo 仍活着时才进行头 */
      if (_rows[_ri].textContent.indexOf('乙') >= 0) { _row = _rows[_ri]; break; }
    }
    ok('c79/G1 两段记录合并成一组（同一任务、间隔 <30 分钟）', !!_row);
    if (_row) {
      var _chips = [];
      var _cs = _row.querySelectorAll('.log-sub-chip.done');
      for (var _ci = 0; _ci < _cs.length; _ci++) _chips.push(_cs[_ci].textContent.trim());
      /* 乙 是第 2 段（40 分钟处 > 第 1 段结束 25 分钟）才勾的：
         取第 1 段快照时它必然缺席 —— 这正是老写法会漏掉的那一步。 */
      ok('c79/G2 合并组用最晚快照 → 第 2 段里勾的「乙」也显示',
        _chips.join('|').indexOf('乙') >= 0);
      ok('c79/G3 老写法（取第一份）会漏掉「乙」—— 反证',
        snapOf([{ title: '甲', done: true, doneAt: _D0 + 5 * MIN },
          { title: '乙', done: true, doneAt: _D0 + 40 * MIN }], _D0 + 25 * MIN)[1].d === false);
    }
  } catch (e) {
    R.push(['c79 用例抛异常 :: ' + (e && e.message), false]);
  } finally {
    appData.todos = bTodos;
    appData.records = bRecs;
  }
  return JSON.stringify(R);
})();
