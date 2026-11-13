/* C64 交接清单收口（4 条）

   这批来自交接文档 §八 已知遗留 与 §11.4 回顾机制复查：
     A 回顾毕业合并展示 —— '斩掉'与'练到顶'以前分两组，老数据没 reason 反而被误归「已掌握」；
       现合并成一组「已到顶 / 已斩掉」。
     B 已排期可点开提前复习 —— 以前是一行纯文本，未到期的日子想提前过一遍只能干等。
       点开只切日详情视图，**不改排期**。
     C doneAt 进卡片签名 —— 卡片显示"完成于 xx:xx"，不进签名则改完成时间不重绘。
     D 日志筛选面板里的「只看番茄」就近入口 —— 原来只藏在「回顾设置」里（路径：日志 → 🧠回顾 → ⚙️）。

   ⚠️ 造数纪律：会改 records / reviewStages / settings / todos 并渲染，finally 全部恢复。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var treeBak = JSON.stringify(appData.tree || {});
  var recBak = JSON.stringify(appData.records || []);
  var setBak = JSON.stringify(appData.settings || {});
  var stBak = JSON.stringify(appData.reviewStages || {});
  var today = getTodayStr();
  var DAY = 86400000;

  try {
    var d1 = '2026-01-01',
      d2 = '2026-01-02';

    /* ===== A 回顾毕业合并展示 ===== */
    appData.records = [
      { id: 'C64-1', type: 'full', pomos: 1, effectiveSeconds: 1500, taskName: 'a', startTime: new Date(2026, 0, 1, 9, 0).getTime(), interruptions: [], totalInterruptSeconds: 0 },
      { id: 'C64-2', type: 'full', pomos: 1, effectiveSeconds: 1500, taskName: 'b', startTime: new Date(2026, 0, 2, 9, 0).getTime(), interruptions: [], totalInterruptSeconds: 0 }
    ];
    appData.reviewStages = {};
    appData.reviewStages[d1] = { level: 7, last: '2026-02-01', next: null, reason: 'mastered' };
    appData.reviewStages[d2] = { level: 7, last: '2026-02-01', next: null }; /* 老数据：没有 reason */
    renderReviewSettingsModal();
    var setBox = document.getElementById('reviewSettingsBody');
    ok('★ A1 合并成一组（不再有独立的「已掌握」「已斩掉」两组）',
      !!setBox && setBox.innerHTML.indexOf('已到顶 / 已斩掉') >= 0 && setBox.innerHTML.indexOf('已掌握') < 0);
    ok('★ A2 斩掉与练到顶同组，计数 2 天', !!setBox && setBox.innerHTML.indexOf('2 天') >= 0);
    ok('A3 分组辅助函数已删除', typeof graduatedReviewGroups === 'undefined');

    /* 自评「记牢」到顶也要落 solid-top；直接自评「斩掉」落 mastered（reason 仍写入，供未来复用） */
    appData.reviewStages = {};
    appData.reviewStages[d1] = ebRestoreState(today);
    applyReviewGrade(d1, REVIEW_GRADE_MASTERED);
    ok('A4 自评「斩掉」→ reason=mastered', appData.reviewStages[d1].reason === 'mastered' && !appData.reviewStages[d1].next);
    appData.reviewStages[d2] = ebRestoreState(today);
    for (var i = 0; i < 8; i++) applyReviewGrade(d2, 'solid');
    ok('A5 自评「记牢」到顶 → reason=solid-top',
      !appData.reviewStages[d2].next && appData.reviewStages[d2].reason === 'solid-top');
    /* 恢复排期后不该再留毕业原因 */
    var anyD = d1;
    restoreReviewDate(anyD);
    ok('A6 恢复后不再带毕业原因', !!appData.reviewStages[anyD].next && !appData.reviewStages[anyD].reason);

    /* ===== B 已排期可点开（只读，不改排期） ===== */
    var past = getDateStr(Date.now() - 10 * DAY);
    appData.records = [
      { id: 'C64-3', type: 'full', pomos: 1, effectiveSeconds: 1500, taskName: 'x', startTime: Date.now() - 10 * DAY, interruptions: [], totalInterruptSeconds: 0 }
    ];
    appData.reviewStages = {};
    appData.reviewStages[past] = { level: 1, last: past, next: '2099-01-01' };
    renderReviewModal();
    var rBox = document.getElementById('reviewModalBody');
    ok('B1 已排期行可点（绑了 openReviewDay）', !!rBox && rBox.innerHTML.indexOf("openReviewDay('" + past + "')") >= 0);
    ok('B2 行上写明不会改动排期', !!rBox && rBox.innerHTML.indexOf('不会改动排期') >= 0);
    ok('B3 行可键盘操作（role/tabindex）', !!rBox && rBox.innerHTML.indexOf('tabindex="0"') >= 0);
    var _stBefore = JSON.stringify(appData.reviewStages);
    openReviewDay(past);
    ok('★ B4 提前点开不改动排期数据', JSON.stringify(appData.reviewStages) === _stBefore);
    var detailBox = document.getElementById('reviewModalBody');
    ok('B5 点开后进入该天的详情视图', !!detailBox && detailBox.innerHTML.indexOf('回顾') >= 0);
    reviewBackToList();

    /* ===== C doneAt 进签名 ===== */
    var s1 = todoRowSig({ id: 'x', title: 't', done: true, doneAt: 111 });
    var s2 = todoRowSig({ id: 'x', title: 't', done: true, doneAt: 222 });
    ok('★ C1 doneAt 不同 → 签名不同（改完成时间会重绘）', s1 !== s2);
    ok('C2 其余相同则签名一致', todoRowSig({ id: 'x', title: 't' }) === todoRowSig({ id: 'x', title: 't' }));

    /* ===== D 只看番茄：日志走「类型筛选」，回顾走「开关」=====
       上一版是"筛选面板放一个独立按钮 + 与回顾设置共用同一个开关"，用户否掉了两点：
         ① 日志界面不该被"回顾设置"改动 ——「我真正的日志界面不需要那个呀」；
         ② 独立按钮多余 —— 它本就是类型收窄，应并进「全部类型」下拉。 */
    ok('D1 「只看番茄」已并进类型下拉（不再是独立按钮）',
       !!document.querySelector('#logTypeFilter option[value="pomo"]'));
    ok('D2 独立按钮已移除', !document.getElementById('logPomoOnlyBtn'));
    ok('D3 开关已改绑回顾页（旧名 isLogPomodoroOnly 不复存在）',
       typeof isLogPomodoroOnly === 'undefined' && typeof isReviewPomodoroOnly === 'function');

    var recBak2 = JSON.stringify(appData.records || []);
    try {
      var _now = Date.now();
      appData.records = [
        { id: 'c64r1', type: 'full', pomos: 1, startTime: _now, taskName: '番茄甲' },
        { id: 'c64r2', type: 'log', pomos: 0, startTime: _now - 1000, taskName: '仅记录乙' }
      ];
      var sel = document.getElementById('logTypeFilter');
      sel.value = 'pomo';
      applyLogFilter();
      var h1 = (document.getElementById('logList') || {}).innerHTML || '';
      ok('★ D4 选「只看🍅」→ 只留有番茄的那条',
         h1.indexOf('番茄甲') >= 0 && h1.indexOf('仅记录乙') < 0);

      /* 同一批数据下，回顾开关应当**独立地**收窄回顾结果（不动日志列表） */
      if (!appData.settings) appData.settings = {};
      appData.settings.reviewPomodoroOnly = false;
      var rOff = reviewRecsFor(getTodayStr()).length;
      appData.settings.reviewPomodoroOnly = true;
      var rOn = reviewRecsFor(getTodayStr()).length;
      ok('★ D5 回顾开关收窄回顾结果（2 → 1），且日志列表不受它影响',
         rOff === 2 && rOn === 1 && h1.indexOf('仅记录乙') < 0);

      sel.value = '';
      applyLogFilter();
      var h2 = (document.getElementById('logList') || {}).innerHTML || '';
      ok('D6 切回「全部类型」→ 两条都回来',
         h2.indexOf('番茄甲') >= 0 && h2.indexOf('仅记录乙') >= 0);
    } finally {
      appData.records = JSON.parse(recBak2);
      try { document.getElementById('logTypeFilter').value = ''; } catch (e) { /* 复位 */ }
      try { delete appData.settings.reviewPomodoroOnly; } catch (e) { /* 复位 */ }
      applyLogFilter();
    }
  } finally {
    try { appData.tree = JSON.parse(treeBak); } catch (e) { /* 原样恢复 */ }
    try { appData.records = JSON.parse(recBak); } catch (e) { /* 原样恢复 */ }
    try { appData.settings = JSON.parse(setBak); } catch (e) { /* 原样恢复 */ }
    try { appData.reviewStages = JSON.parse(stBak); } catch (e) { /* 原样恢复 */ }
    try { renderLogs(); } catch (e) { /* 恢复后重画 */ }
    try { applyLogFilter(); } catch (e) { /* 复位筛选按钮态 */ }
    saveData();
  }
  return JSON.stringify(R);
})();
