/* C47 专注记录 ↔ 计划 的关联度：记录落盘快照 + 日志行显示
   覆盖：「计划和专注记录的关联度不高，一些东西在专注记录不显示，例如子计划等一些标签」。

   链接分两段，都要打：
     A. 落盘：结束一次专注时，记录里带上 计划 id / 标签 / 四象限 / 正在做的那条子任务
        （savePomodoroRecord 里的 todoId/tag/quad/subTitle/subId 快照）；
     B. 显示：日志行把这几项渲染出来（.log-row-meta3），没有关联的独立专注不占位置。
   ★ 快照而不是引用：之后计划改标签/改象限，旧记录不会被追溯改写（历史就是历史）。

   ⚠️ 造数的坑（踩过一次）：savePomodoroRecord 的 endTime 恒为 Date.now()，
      若几条记录共用同一个 startTime，它们会落进 mergeLogRecords 的
      「去重」分支（起止都在 LOG_DUP_TOLERANCE_SEC=60s 内）而不是「合并」分支，
      于是合并组里只剩第一段、子任务被吃掉 —— 那是测试造数的问题，不是渲染的问题。
      所以这里落盘后用 restamp() 把每条记录的起止时间摊开（相隔 300s：
      大于去重容差 60s、小于合并间隔 600s），既不去重、又能合并。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var todosBak = JSON.stringify(appData.todos || []);
  var recBak = JSON.stringify(appData.records || []);
  var tsBak = JSON.stringify(timerState || {});
  var added = [];
  /* 把落盘后的记录改成「真实发生过」的起止：当天 02:00 起，每条 25 分钟，段间隔 5 分钟。
     段间隔 300s 落在 (60, 600] 区间 —— 不会被当重复丢掉，又满足合并条件。 */
  var base = (function () {
    /* 四条记录共占 1 小时 55 分（4 段，段间隔 30 分）。若「今天 02:00 起」还没走完，
       后两段会落在未来 → 日志页把它们当未发生、不渲染 → 合并行消失（凌晨跑必红）。 */
    var need = 115 * 60 * 1000;
    var d = new Date();
    d.setHours(2, 0, 0, 0);
    if (Date.now() < d.getTime() + need) d.setDate(d.getDate() - 1);
    return d.getTime();
  })();
  var uid = 0;
  function restamp(r, slot) {
    r.id = 'C47-' + (++uid);
    r.startTime = base + slot * 1800 * 1000;
    r.endTime = r.startTime + 1500 * 1000;
    r.effectiveSeconds = 1500;
  }
  function lastRec() { return appData.records[appData.records.length - 1]; }
  try {
    appData.todos = [{
      id: 9501, title: '数学卷子', done: false, tag: '理科', quad: 'q1', pomodoros: 3,
      subs: [{ id: 95011, title: '第3题 导数', done: false }, { id: 95012, title: '第4题', done: false }]
    }];
    saveData();

    /* A. 落盘：把 timerState 摆成「正在做计划下的第3题」，走真实的记录写入 */
    timerState.taskName = '数学卷子';
    timerState.linkedTodoId = 9501;
    timerState.curSubId = 95011;
    timerState.finishSource = 'todo';
    timerState.startTime = Date.now() - 1500 * 1000;
    timerState.effectiveSeconds = 1500;
    timerState.interruptions = [];
    timerState.totalInterruptSeconds = 0;
    var n0 = appData.records.length;
    var wrote = false;
    try {
      savePomodoroRecord('log');
      wrote = appData.records.length === n0 + 1;
    } catch (e) { R.push(['!! 记录写入抛错: ' + (e && e.message), false]); }
    var rec = wrote ? lastRec() : null;
    ok('A 记录写进去了', !!rec);
    if (rec) {
      added.push(rec.id);
      restamp(rec, 0);
      ok('A1 记录带上了计划 id', rec.todoId === 9501);
      ok('A2 记录带上了标签', rec.tag === '理科');
      ok('A3 记录带上了四象限', rec.quad === 'q1');
      ok('A4 记录带上了正在做的那条子任务', rec.subTitle === '第3题 导数' && rec.subId === 95011);
    }

    /* A5 没选子任务时不写子任务（不塞脏值） */
    timerState.curSubId = null;
    var n1 = appData.records.length;
    try { savePomodoroRecord('log'); } catch (e) {}
    if (appData.records.length === n1 + 1) {
      var r2 = lastRec();
      added.push(r2.id);
      restamp(r2, 1);
      ok('A5 没在子任务上时 subTitle 为空', r2.subTitle == null && r2.subTitle !== '');
    } else {
      ok('A5 没在子任务上时 subTitle 为空', false);
    }

    /* A7 同一计划的另一次专注：换成第4题（用来验合并组不丢标签） */
    timerState.curSubId = 95012;
    var n3 = appData.records.length;
    try { savePomodoroRecord('log'); } catch (e) {}
    if (appData.records.length === n3 + 1) {
      var r4 = lastRec();
      added.push(r4.id);
      restamp(r4, 2);
      ok('A7 第二次专注记的是第4题', r4.subTitle === '第4题' && r4.subId === 95012);
    } else {
      ok('A7 第二次专注记的是第4题', false);
    }

    /* A6 独立专注（没有关联计划）不写计划字段 */
    timerState.linkedTodoId = null;
    timerState.curSubId = null;
    timerState.taskName = '自由看看书';
    var n2 = appData.records.length;
    try { savePomodoroRecord('log'); } catch (e) {}
    if (appData.records.length === n2 + 1) {
      var r3 = lastRec();
      added.push(r3.id);
      restamp(r3, 3);
      /* 独立专注换个已存在过的任务名，确保它自成一组的判据是 taskName 不同 */
      r3.taskName = '自由看看书';
      ok('A6 独立专注没有计划字段', !r3.todoId && !r3.tag && !r3.quad);
    } else {
      ok('A6 独立专注没有计划字段', false);
    }

    /* 落盘 ↔ 合并算法对齐：先直接在纯函数上验一次分组，避免又出现
       「记录看着对、渲染却少一条」时分不清是造数还是渲染的锅 */
    if (typeof mergeLogRecords === 'function') {
      var gs = mergeLogRecords(appData.records.filter(function (r) { return String(r.id).indexOf('C47-') === 0; }));
      var planGroup = gs.filter(function (g) { return g.taskName === '数学卷子'; })[0];
      ok('A8 同计划三段合并成一组', !!planGroup && planGroup.segments.length === 3);
      ok('A8b 独立专注另成一组', gs.filter(function (g) { return g.taskName === '自由看看书'; }).length === 1);
    } else {
      ok('A8 同计划三段合并成一组', false);
    }

    /* B. 显示：日志行渲染出来 */
    if (typeof switchView === 'function') switchView('log');
    if (typeof renderLogs === 'function') renderLogs();
    var html = (document.getElementById('logList') || {}).innerHTML || '';
    ok('B 日志里出现「计划关联」那一行（log-row-meta3）', html.indexOf('log-row-meta3') >= 0);
    ok('B1 标签显示出来了', html.indexOf('理科') >= 0);
    /* ★ 子步骤 chip 恢复（只摊已完成的）。本用例造的两步都是 done:false，
       所以名字不该出现，但「2 步未完成」的计数应该在 —— 数据在，卡上也有痕迹。
       两层都断言，避免把「没画名字」误读成「数据丢了」。 */
    ok('B2 未完成的子步骤不摊名字、但要留计数（数据仍留在记录上）',
       html.indexOf('第3题 导数') < 0 && html.indexOf('步未完成') >= 0);
    ok('B3 四象限徽标显示出来了', html.indexOf('quad-badge') >= 0);

    /* B4 独立专注那一行没有计划关联行 */
    var freeRow = null;
    [].slice.call(document.querySelectorAll('#logList .timeline-item')).forEach(function (el) {
      if (el.textContent.indexOf('自由看看书') >= 0) freeRow = el;
    });
    ok('B4 独立专注的行没有计划关联行', !!freeRow && freeRow.innerHTML.indexOf('log-row-meta3') < 0);

    /* B5 同一个计划的三段专注合并成一行时，每一段的子任务都要留着
       （合并恰恰是最常见的情况：一个计划连着做了几段） */
    var mergedRow = null;
    [].slice.call(document.querySelectorAll('#logList .timeline-item')).forEach(function (el) {
      if (el.innerHTML.indexOf('log-row-meta3') >= 0 && el.innerHTML.indexOf('tag-merge') >= 0) mergedRow = el;
    });
    /* ★ 合并组同样只摊已完成步骤；本用例子步骤均未完成 → 不摊名字、只留计数。
       底层数据仍留着每段的子任务，两层都断言。 */
    ok('B5 合并组不摊未完成步骤名、但留计数',
       !!mergedRow && mergedRow.innerHTML.indexOf('第3题 导数') < 0 &&
       mergedRow.innerHTML.indexOf('步未完成') >= 0 &&
       appData.records.filter(function (r) { return r.planSubs && r.planSubs.length; }).length >= 2);
    ok('B5b 合并组的标签只出现一次（去重）',
       !!mergedRow && (mergedRow.innerHTML.match(/理科/g) || []).length === 1);

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.todos = JSON.parse(todosBak); } catch (e) { appData.todos = []; }
    try { appData.records = JSON.parse(recBak); } catch (e) { appData.records = []; }
    try {
      var ts = JSON.parse(tsBak);
      for (var k in timerState) { if (!(k in ts)) delete timerState[k]; }
      for (var k2 in ts) { timerState[k2] = ts[k2]; }
    } catch (e) {}
    try { if (typeof resetToIdle === 'function') resetToIdle(); } catch (e) {}
    try { if (typeof closeModal === 'function') { closeModal('settleModal'); closeModal('reviewModal'); } } catch (e) {}
    if (typeof renderLogs === 'function') renderLogs();
    saveData();
  }
  return JSON.stringify(R);
})();
