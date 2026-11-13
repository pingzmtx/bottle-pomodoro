/* C42 的页面侧断言体：日志页「记录时长」与「专注时长」两条账分开显示。

   日志页：「记录时长」和「专注时长」两条账分开。

   口径（本轮定死，两处展示共用同一份算法）：
   · 记录时长 = 每条记录的实际时长合计（recordSeconds），**含「仅记录」**。
   · 专注时长 = 只算专注型记录的实际时长（recordSeconds，**不含「仅记录」**）。
     ★ 不是番茄账：getPomos 是结算自评（同一段 25 分钟可记完整也可记半个），
       拿它当时长等于让自评去改钟表。🍅 与「专注时长」各说各的，不再互相折算。

   断言：纯函数口径 / 汇总条四格标签 / 两条账各按各的算（含仅记录）/ 日期头两个时长都在 /
        只留「仅记录」那天——记录时长有、专注时长 0。
   全程用真状态跑，**恢复放在 finally**。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var bak = null, sigBak = null, doneBak = null;
  function mk(id, type, name, min, pomos) {
    /* 造数基准固定成「昨天 12:00」再依次 +1 小时 —— 保证三条落在**同一个自然日**。
       ★ 修正：原实现是 `Date.now() - 10h + id*h`，这条**依赖运行时刻**：
         在凌晨跑三条都落同一天（通过），在早饭点跑第三条就落到「今天 00:5x」，
         日志页日期头按自然日分组（getDateStr）→ 被拆成「今天 1 条 + 昨天 2 条」，
         于是 ③a/③b/③c 偶发失败。**这是用例自身的时间敏感缺陷，不是产品问题。** */
    var _b = new Date();
    _b.setDate(_b.getDate() - 1);
    _b.setHours(12, 0, 0, 0);
    var st = _b.getTime() + (id - 1) * 3600000;
    return {
      id: 'c42_' + id, type: type, taskName: name, note: '',
      startTime: st, endTime: st + min * 60000,
      effectiveSeconds: min * 60, pomos: pomos,
      interruptions: [], totalInterruptSeconds: 0
    };
  }
  function labs() {
    return [].slice.call(document.querySelectorAll('.log-sum-lab')).map(function (e) { return e.textContent.trim(); });
  }
  function nums() {
    return [].slice.call(document.querySelectorAll('.log-sum-num')).map(function (e) { return e.textContent.trim(); });
  }
  function repaint(list) {
    appData.records.length = 0;
    list.forEach(function (r) { appData.records.push(r); });
    if (typeof _logSig !== 'undefined') _logSig = '';
    renderLogs();
  }
  try {
    if (typeof appData === 'undefined' || !appData.records) {
      return JSON.stringify([['① appData.records 可用', false]]);
    }
    bak = appData.records.slice();
    sigBak = (typeof _logSig !== 'undefined') ? _logSig : null;
    /* ★ 修跨用例污染：日志页日期池 = 记录日期 ∪ todoDoneLog 的日期。
       C42 只放自己的 records，但**前序用例**（勾过「完成计划」的）会留下今天的
       todoDoneLog → 日志页多画一张「今天」卡排在最前 → 本用例读的是**第一个**
       .log-date-header，读到的就不是自己那天的头，③a/③b/③c/④c 全红（单跑则过）。
       所以这里把 todoDoneLog 也一并隔离；结尾 finally 还原。 */
    doneBak = JSON.parse(JSON.stringify(appData.todoDoneLog || {}));
    appData.todoDoneLog = {};
    if (typeof _logPage !== 'undefined') _logPage = 1;
    ['logSearch', 'logTypeFilter', 'logDateFilter'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });

    /* —— ① 纯函数口径 —— */
    ok('①a pomosToMinutes(4) = 100 分钟', typeof pomosToMinutes === 'function' && pomosToMinutes(4) === 100);
    ok('①b pomosToMinutes(1.5) = 38 分钟（37.5 四舍五入）', pomosToMinutes(1.5) === 38);

    /* —— ② 一天三条：完整🍅 30 分 + 仅记录 45 分 + 半个🍅 10 分 —— */
    repaint([mk(1, 'full', 'C42任务A', 30, 1), mk(2, 'log', 'C42任务B', 45, 0), mk(3, 'half', 'C42任务C', 10, 0.5)]);
    var L = labs(), N = nums();
    ok('②a 汇总条四格标签是 条记录/记录时长/专注时长/番茄🍅',
      L.length === 4 && L[0] === '条记录' && L[1] === '记录时长' && L[2] === '专注时长' && L[3] === '番茄🍅');
    ok('②b 条记录 = 3', N[0] === '3');
    /* 记录时长 = (30+45+10) = 85 分钟 = 1.4 小时 —— 含「仅记录」那 45 分钟 */
    ok('②c 记录时长 = 1.4 小时（85 分钟，含仅记录）', N[1] === '1.4 小时');
    /* 专注时长 = 30 + 10 = 40 分钟（实际计时；「仅记录」那 45 分钟不算） */
    ok('②d 专注时长 = 40 分钟（实际计时，仅记录不计）', N[2] === '40 分钟');
    ok('②e 番茄 = 1.5', N[3] === '1.5');
    ok('②f 不含仅记录的话记录时长会变成 0.7 小时（证明 45 分钟确实算进去了）', N[1] !== '0.7 小时');

    /* —— ③ 日期头两个时长都在 —— */
    var hs = document.querySelector('.log-date-header .log-date-sum');
    var ht = hs ? hs.textContent : '';
    ok('③a 日期头写着「3 条」', ht.indexOf('3 条') >= 0);
    ok('③b 日期头有「记录 1.4 小时」', ht.indexOf('记录 1.4 小时') >= 0);
    ok('③c 日期头有「专注 40 分钟」', ht.indexOf('专注 40 分钟') >= 0);

    /* —— ④ 那天只有一条「仅记录」：记录时长有、专注时长不显示 —— */
    repaint([mk(9, 'log', 'C42配眼镜', 45, 0)]);
    var L2 = labs(), N2 = nums();
    ok('④a 只留仅记录时，记录时长 = 45 分钟', N2[1] === '45 分钟');
    ok('④b 只留仅记录时，专注时长 = 0 分钟', N2[2] === '0 分钟');
    var hs2 = document.querySelector('.log-date-header .log-date-sum');
    var ht2 = hs2 ? hs2.textContent : '';
    ok('④c 日期头写「记录 45 分钟」且不写「专注」', ht2.indexOf('记录 45 分钟') >= 0 && ht2.indexOf('专注') === -1);
  } catch (e) {
    R.push(['!! 断言抛异常：' + (e && e.message), false]);
  } finally {
    try {
      if (bak) {
        appData.records.length = 0;
        bak.forEach(function (r) { appData.records.push(r); });
      }
      if (doneBak) appData.todoDoneLog = doneBak;
      if (typeof _logSig !== 'undefined') _logSig = sigBak === null ? '' : sigBak;
      if (typeof renderLogs === 'function') renderLogs();
    } catch (e2) { /* 清理失败不掩盖断言结果 */ }
  }
  return JSON.stringify(R);
})();
