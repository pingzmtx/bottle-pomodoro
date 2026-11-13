/* C65 交接账核实轮：连续天数口径修正（v9 P1-① 自查缺陷）+ 台账几条 ⏳ 的结论

   缘起：用户「先确认接力文档里该做的都做了」。逐条核 §11.5 台账时发现
   **唯一一条"文档标了、代码确实没做、且是真缺陷"** 的就是 v9 P1-①：

     `05_journey` 的连续天数从**今天**起算 —— 今天还没产生记录就 break，
     于是上午打开 App 会显示「连续 0 天」，哪怕昨天已经连续 30 天。
     玩家每天看到的第一个数字是错的，要等当天出了记录才跳回真值。
     （`habitCurrentStreak` 一直是对的：`set[today] 为空 → 游标退到昨天`。）

   修法：照 `habitCurrentStreak` 的边界写法，今天无记录时游标从昨天起算。
   本用例把"今天无记录 → 不显示 0"这条钉住，防止被改回去。

   ⚠️ 造数纪律：会改 records / journey 并调用统计，finally 全部恢复。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var recBak = JSON.stringify(appData.records || []);
  var jyBak = JSON.stringify(appData.journey || {});
  var today = getTodayStr();
  var y1 = addDaysStr(today, -1);
  var y2 = addDaysStr(today, -2);

  function mk(dayStr) {
    return {
      id: 'C65-' + dayStr,
      type: 'full',
      pomos: 1,
      effectiveSeconds: 1500,
      taskName: '核实用例',
      startTime: new Date(dayStr + 'T09:00:00').getTime(),
      interruptions: [],
      totalInterruptSeconds: 0
    };
  }

  try {
    if (!appData.journey) appData.journey = {};
    /* 统计窗口默认从 achieveSince 起；不设的话默认 Date.now()，什么都算不到 */
    appData.journey.achieveSince = new Date('2020-01-01T00:00:00').getTime();

    /* ===== A 连续天数：今天无记录时必须从昨天算起 ===== */
    appData.records = [mk(y1), mk(y2)];
    var w1 = __jy.win();
    ok('★ A1 今天还没记录 → 连续天数从昨天起算（不再是 0）', w1.streak === 2);

    appData.records = [mk(today), mk(y1), mk(y2)];
    ok('A2 今天有记录 → 连续 3 天', __jy.win().streak === 3);

    appData.records = [mk(y2)]; /* 昨天与今天都断了 */
    ok('A3 昨天已断 → 今天无记录就是 0（不该硬凑）', __jy.win().streak === 0);

    appData.records = [mk(today), mk(y2)]; /* 今天有、昨天断 */
    ok('A4 昨天断了但今天有 → 只算 1 天', __jy.win().streak === 1);

    /* 与 habitCurrentStreak 同口径（两处必须同义，否则同一个"连续"会有两个答案） */
    ok('★ A5 与 habitCurrentStreak 口径一致', habitCurrentStreak([today, y1, y2], today) === 3 &&
      habitCurrentStreak([y1, y2], today) === 2 && habitCurrentStreak([y2], today) === 0);

    /* ===== B 台账里几条 ⏳ 的核实结论（源码级） ===== */
    /* 归档侧：清理冗余数据功能已按需求要求整体移除——
       confirmPrune / pruneEmptyHint / clearArchive / arPrune 均已不存在。
       这里改成**防回流哨兵**：断言它们确实不再回来，避免哪天又被重新挂上。 */
    ok('B1 清理冗余数据功能已彻底移除（防回流）',
      typeof confirmPrune === 'undefined' && typeof clearArchive === 'undefined' &&
      !document.getElementById('pruneConfirmModal') && !document.getElementById('pruneEmptyHint'));
    ok('B2 重复规则仍是纯函数逐个判定（索引缓存未做 → 月视图的前置项）',
      typeof todoRepeatMatches === 'function' && String(todoRepeatMatches).indexOf('cache') < 0);
  } finally {
    try { appData.records = JSON.parse(recBak); } catch (e) { R.push(['!! records 恢复失败: ' + e.message, false]); }
    try { appData.journey = JSON.parse(jyBak); } catch (e) { /* 原样恢复 */ }
    saveData();
  }
  return JSON.stringify(R);
})();
