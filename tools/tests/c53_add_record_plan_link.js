/* C53 补记 ↔ 计划的关联：写入快照 + 显式下拉 + 视觉构件统一

   覆盖：「完成计划和这个日志，这个都不，长得都不一样，样式也不一样，
   根本就不感觉就是生加进去的，根本就没有关联」。

   根因（两处，都要打）：
     ① saveAddRecord 过去只写 expectedPomodoros / actualPomodoros，
        **连 todoId 都不写**，而且找计划只有一句 `todos.find(x => x.title === task)`
        （任务名精确匹配）—— 名字差一个字就静默失联。补记出来的记录在日志里
        必然是一张和计划毫无关系的孤卡。
     ② 日志记录卡的「计划名」有个 `记录名 === 计划名 就不画` 的去重规则，
        效果恰好相反：**关联最紧的那几条记录，反而最看不出关联**。

   本用例分三段：
     A 落盘：显式选计划 / 选子任务 / 名字兜底 / 都不选 —— 四种组合各验一次
     B 显示：记录卡用 .plan-chip（📋），「今天完成」条也用 .plan-chip.done（✅）
              —— 同一个计划在两处必须是**同一个构件**
     C 详情：事后改挂 / 摘除关联（历史记录也能补回关联）

   ⚠️ 造数纪律：本用例会真的往 appData.records 里插记录、并且给 todos 加项，
      所以 finally 里全部原样恢复（含 tree / rankSystem / todoDoneLog）。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var todosBak = JSON.stringify(appData.todos || []);
  var recBak = JSON.stringify(appData.records || []);
  var treeBak = JSON.stringify(appData.tree || {});
  var rankBak = JSON.stringify(appData.rankSystem || {});
  var dlBak = JSON.stringify(appData.todoDoneLog || {});
  var added = [];
  var TID = 9601, TID2 = 9602;
  var today = getTodayStr();

  function lastRec() { return appData.records[appData.records.length - 1]; }
  /* 把落盘后的记录改成「真实发生过」的起止：当天 02:00 起、每条 25 分钟、段间隔 5 分钟。
     和 C47 同一套口径：300s 落在 (60, 600] —— 不被当重复丢掉，又满足合并条件。 */
  var base = (function () { var d = new Date(); d.setHours(2, 0, 0, 0); return d.getTime(); })();
  var uid = 0;
  function restamp(r, slot) {
    r.id = 'C53-' + (++uid);
    r.startTime = base + slot * 1800 * 1000;
    r.endTime = r.startTime + 1500 * 1000;
    r.effectiveSeconds = 1500;
  }
  /* 走真实的弹窗保存路径：开弹窗 → 摆 DOM → saveAddRecord()
     顺序要紧：先选计划（会触发联动、回填任务名），**再**覆盖任务名 ——
     这样才能区分「关联来自下拉」还是「关联来自名字匹配」。 */
  function addVia(type, dur, task, planId, subId) {
    openAddRecordModal();
    document.getElementById('addRecordDate').value = today;
    document.getElementById('addRecordHour').value = '02';
    document.getElementById('addRecordMinute').value = '00';
    document.getElementById('addRecordDuration').value = String(dur);
    document.getElementById('addRecordType').value = type;
    document.getElementById('addRecordPlan').value = planId == null ? '' : String(planId);
    onAddRecordPlanChange();          /* 真的走一次联动，顺便验它不会把计划选丢 */
    document.getElementById('addRecordTask').value = task || '';
    if (subId != null) document.getElementById('addRecordSub').value = String(subId);
    var n0 = appData.records.length;
    try { saveAddRecord(); } catch (e) { R.push(['!! saveAddRecord 抛错: ' + (e && e.message), false]); }
    if (appData.records.length !== n0 + 1) return null;
    var r = lastRec();
    added.push(r.id);
    restamp(r, uid);
    return r;
  }

  try {
    appData.todos = [{
      id: TID, title: '数学卷子', done: false, tag: '理科', quad: 'q1', pomodoros: 3,
      subs: [{ id: 96011, title: '第3题 导数', done: false }, { id: 96012, title: '第4题', done: false }]
    }];
    appData.todoDoneLog = {};
    saveData();

    /* ===== A 落盘 ===== */
    /* A1 显式选计划（任务名故意写成别的，验「不靠名字也能关联」） */
    var r1 = addVia('log', 60, '网站开发', TID, null);
    ok('A1 补记写进去了', !!r1);
    if (r1) {
      ok('A1a 选了下拉就关联上（任务名对不上也算）', String(r1.todoId) === String(TID));
      ok('A1b 带上计划名快照', r1.planTitle === '数学卷子');
      ok('A1c 带上标签快照', r1.tag === '理科');
      ok('A1d 带上四象限快照', r1.quad === 'q1');
      ok('A1e 带上子任务快照', Array.isArray(r1.planSubs) && r1.planSubs.length === 2 && r1.planSubs[0].t === '第3题 导数');
      ok('A1f 没选子任务 → subTitle 不塞脏值', r1.subTitle == null);
    }

    /* A2 显式选计划 + 选子任务 */
    var r2 = addVia('log', 50, '数学卷子', TID, 96011);
    ok('A2 补记写进去了', !!r2);
    if (r2) {
      ok('A2a 子任务写进 subTitle', r2.subTitle === '第3题 导数');
      ok('A2b 子任务写进 subId', String(r2.subId) === '96011');
    }

    /* A3 不选下拉，但任务名正好等于计划名 → 兼容分支仍然关联 */
    var r3 = addVia('log', 40, '数学卷子', '', null);
    ok('A3 名字兜底仍能关联', !!r3 && String(r3.todoId) === String(TID));

    /* A4 不选下拉、名字也对不上 → 独立记录，**不写任何计划字段**（C47 B4 同一口径） */
    var r4 = addVia('log', 30, '自由看看书', '', null);
    ok('A4 独立补记写进去了', !!r4);
    if (r4) {
      ok('A4a 独立补记不写计划字段', !r4.todoId && !r4.tag && !r4.quad && !r4.planTitle && !r4.planSubs);
    }

    /* A5 非「仅记录」类型：关联计划的实际番茄账要同步累加（与计时路径同口径） */
    var beforeAp = (appData.todos[0].actualPomodoros || 0);
    var r5 = addVia('full', 25, '数学卷子', TID, null);
    ok('A5 补记 full 写进去了', !!r5);
    if (r5) {
      ok('A5a 关联计划的实际番茄账 +1', (appData.todos[0].actualPomodoros || 0) === beforeAp + 1);
      ok('A5b 记录里的 actualPomodoros 与计划同步', r5.actualPomodoros === appData.todos[0].actualPomodoros);
    }

    /* ===== B 显示：两处共用同一个「计划归属」构件 ===== */
    /* 造一条「今天完成、但没计时」的完成项 → 应该出现在 .done-todo-strip 里 */
    var dl = {}; dl[today] = [{ id: 96099, title: 'C53未计时完成项', subs: [{ t: '看看周计划', d: true }, { t: '亲测一轮', d: false }] }];
    appData.todoDoneLog = dl;
    if (typeof switchView === 'function') switchView('log');
    if (typeof renderLogs === 'function') renderLogs();
    var html = (document.getElementById('logList') || {}).innerHTML || '';

    ok('B1 记录卡的计划归属用 .plan-chip', html.indexOf('plan-chip') >= 0);
    ok('B2 计划归属里画出了计划名', html.indexOf('数学卷子') >= 0);
    /* ★ 子步骤 chip 恢复显示，但**只摊已完成的**（未完成压成「N 步未完成」计数）。
       10-15 曾整块移除（挂每条记录后太乱），10-18 需求「完成了一个子计划，上面不显示了」
       → 折中形态：已完成的摊名字，未完成的只留计数。本用例的步骤均未完成，故只该看到计数。
       ⚠️ 快照**数据**仍在（见 A1e），这里只断言「摊什么、不摊什么」。 */
    ok('B3 未完成的子步骤不摊名字、留计数（快照数据仍在，见 A1e）',
       html.indexOf('第3题 导数') < 0 && html.indexOf('步未完成') >= 0);
    ok('B4 「今天完成」条渲染成 .done-todo-strip（带 ✅ + 标题）',
       html.indexOf('done-todo-strip') >= 0 && html.indexOf('✅') >= 0 &&
       html.indexOf('C53未计时完成项') >= 0);
    ok('B5 完成条里的子任务竖排展示（.done-todo-sub，不再是 log-sub-chip）',
       html.indexOf('done-todo-sub') >= 0 && html.indexOf('看看周计划') >= 0);

    /* B6 独立记录那一行：既没有计划归属行，也没有老的 meta3 行 */
    var freeRow = null;
    [].slice.call(document.querySelectorAll('#logList .timeline-item')).forEach(function (el) {
      if (el.textContent.indexOf('自由看看书') >= 0) freeRow = el;
    });
    ok('B6 独立记录不画计划归属行', !!freeRow && freeRow.innerHTML.indexOf('log-row-plan') < 0);
    ok('B7 独立记录也不画 meta3 行', !!freeRow && freeRow.innerHTML.indexOf('log-row-meta3') < 0);

    /* B9 有子任务快照时不重复画「└ 某一步」标签（截图复核时逮到的重复）：
       快照已把每一步连 ✓/○ 摊开，再单标一次「正在做的那一步」就是同一个信息画两遍。 */
    ok('B9 有快照的记录不再重复画「└ 某一步」标签', html.indexOf('tag-sub') < 0);
    /* B10 没有快照的老记录仍要靠 subTitle 这条唯一线索 */
    (function () {
      var oldOne = addVia('log', 20, '老记录没有快照', '', null);
      if (!oldOne) { ok('B10 老记录（无快照）仍画出「└ 某一步」', false); return; }
      oldOne.todoId = TID;
      oldOne.planTitle = null;
      oldOne.planSubs = null;
      oldOne.subTitle = '第4题';
      renderLogs();
      var h2 = (document.getElementById('logList') || {}).innerHTML || '';
      ok('B10 老记录（无快照）仍画出「└ 某一步」',
         h2.indexOf('tag-sub') >= 0 && h2.indexOf('第4题') >= 0);
    })();

    /* ===== C 详情：事后改挂 / 摘除 ===== */
    var target = r4;   /* 拿那条「独立补记」来补挂 */
    if (target) {
      openRecordDetail(target.id);
      var psel = document.getElementById('detailPlanId');
      ok('C1 详情里有「关联计划」下拉', !!psel);
      if (psel) {
        ok('C1a 独立记录的下拉默认是「不关联」', psel.value === '');
        psel.value = String(TID);
        try { saveRecordDetail(target.id); } catch (e) { R.push(['!! saveRecordDetail 抛错: ' + (e && e.message), false]); }
        var t2 = appData.records.filter(function (x) { return String(x.id) === String(target.id); })[0];
        ok('C2 改挂后写入计划快照', !!t2 && String(t2.todoId) === String(TID) && t2.planTitle === '数学卷子');
        ok('C2a 改挂后子任务快照也在', !!t2 && Array.isArray(t2.planSubs) && t2.planSubs.length === 2);
        /* 再摘掉 */
        openRecordDetail(target.id);
        var psel2 = document.getElementById('detailPlanId');
        if (psel2) psel2.value = '';
        try { saveRecordDetail(target.id); } catch (e) {}
        var t3 = appData.records.filter(function (x) { return String(x.id) === String(target.id); })[0];
        ok('C3 摘除关联后计划字段清空',
           !!t3 && !t3.todoId && !t3.tag && !t3.quad && !t3.planTitle && !t3.planSubs);
      }
    }

    /* B8 计划被删过的记录：详情下拉要能兜住，不能静默跳成「不关联」 */
    if (target) {
      var t4 = appData.records.filter(function (x) { return String(x.id) === String(target.id); })[0];
      t4.todoId = 'C53-已删除计划';
      t4.planTitle = '被删掉的老计划';
      openRecordDetail(target.id);
      var psel3 = document.getElementById('detailPlanId');
      ok('B8 已删除计划的关联在下拉里被兜住',
         !!psel3 && psel3.value === 'C53-已删除计划' && psel3.innerHTML.indexOf('被删掉的老计划') >= 0);
    }

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.todos = JSON.parse(todosBak); } catch (e) { appData.todos = []; }
    try { appData.records = JSON.parse(recBak); } catch (e) { appData.records = []; }
    try { appData.tree = JSON.parse(treeBak); } catch (e) {}
    try { appData.rankSystem = JSON.parse(rankBak); } catch (e) {}
    try { appData.todoDoneLog = JSON.parse(dlBak); } catch (e) { appData.todoDoneLog = {}; }
    try { closeModal('addRecordModal'); } catch (e) {}
    try { closeModal('recordDetailModal'); } catch (e) {}
    if (typeof renderLogs === 'function') renderLogs();
    saveData();
  }
  return JSON.stringify(R);
})();
