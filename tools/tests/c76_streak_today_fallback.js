/* C76 海报「连续打卡 0 天」：连续天数的起算点必须在「今天」，不是「今天已出整番茄」

   报：这两天都有番茄，海报却显示 0 天。
   导出的数据里 10-16 有 2 个整番茄、10-17 只有 1 个半个 + 1 个未完成 →
   旧 calcStreakStats 从**今天**起算，今天没有整番茄就 break →
   海报（读 getStatsCache().streak）当场 0；统计页另一份自己数的循环同样 0；
   而树里的 streakHistory 快照（snapshotStreakHistory）与 05_journey 早就是 1。
   → 同一个「连续」两个答案，错的那个被贴到海报上对外展示。

   本用例钉住三件事：
   A 今天还没出整番茄 → 游标退到昨天（昨天连上就有 1 天，不是 0）
   B/D 半个番茄不算整番茄，不能被当成「今天已打卡」把游标推进今天
   E 今天有、昨天断 → 1；C 昨天已断 → 0（不硬凑）
   F 统计页/海报同源：只认 calcStreakStats 一份实现（防回流哨兵）

   ⚠️ 造数纪律：改 records / 视图态，finally 全部恢复并重画。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }

  var recBak = JSON.stringify(appData.records || []);
  var today = getTodayStr();
  var y1 = addDaysStr(today, -1);
  var y2 = addDaysStr(today, -2);
  var sv = document.getElementById('view-stats');
  var wasActive = !!(sv && sv.classList.contains('active'));

  function mk(day, type) {
    var half = type === 'half';
    return {
      id: 'C76-' + day + '-' + (type || 'full'),
      type: type || 'full',
      pomos: half ? 0.5 : 1,
      effectiveSeconds: half ? 750 : 1500,
      taskName: 'C76 连续天数',
      startTime: new Date(day + 'T09:00:00').getTime(),
      interruptions: [],
      totalInterruptSeconds: 0
    };
  }
  function sc() { invalidateStatsCache(); return getStatsCache(); }

  try {
    /* ===== A 今天没整番茄、昨天有 → 1（旧实现 0） ===== */
    appData.records = [mk(y1)];
    ok('★ A1 今天还没完成整番茄 → 从昨天起算 = 1 天（旧版 0）', sc().streak === 1);

    /* ===== B 今天有整番茄 → 正常累加 ===== */
    appData.records = [mk(today), mk(y1)];
    ok('B1 今天有整番茄 → 连续 2 天', sc().streak === 2);

    /* ===== C 昨天已断 → 0，不硬凑 ===== */
    appData.records = [mk(y2)];
    ok('C1 昨天已断且今天无整番茄 → 0', sc().streak === 0);

    /* ===== D 半个番茄不是整番茄：今天不能被当成已打卡 ===== */
    appData.records = [mk(today, 'half'), mk(y1)];
    ok('★ D1 今天只有半个番茄 → 游标仍退到昨天 = 1 天（半个不算打卡）', sc().streak === 1);

    /* ===== E 今天有、昨天断 ===== */
    appData.records = [mk(today), mk(y2)];
    ok('E1 今天有整番茄、昨天断 → 1 天', sc().streak === 1);

    /* ===== F 同源：统计页数字必须与 calcStreakStats 一致（用最挑剔的场景：今天还没整番茄） ===== */
    appData.records = [mk(y1)];
    var s = sc().streak;
    if (sv) sv.classList.add('active');
    renderStats();
    var txt = (document.getElementById('statsStreak') || {}).textContent || '';
    ok('★ F1 统计页「连续」与海报同口径（今天没整番茄时不是 0）',
      s === 1 && txt.indexOf('连续 1 天') >= 0);
    /* 源码文本断言必须去空白：build 期会压掉空格（`full > 0` → `full>0`），
       带空格的写法只在单文件产物上成立，多产物会假红（2026-10-22 实测）。 */
    var _csrc = String(calcStreakStats).replace(/\s+/g, '');
    ok('F2 calcStreakStats 含「今天无整番茄退到昨天」的起算分支（去空白比对，兼容压缩产物）',
      _csrc.indexOf('setDate') >= 0 && _csrc.indexOf('full>0') >= 0);
    /* 注：window.renderStats 被 02_enh571 / 03_enh572 包了两层，String() 拿到的是包装器，
       照源码断言必然假红 → 这里只做行为断言（F1），不去猜实现。 */
    ok('F4 海报取值口径 = getStatsCache（不是自带缓存）',
      String(drawPoster).indexOf('getStatsCache') >= 0 && String(drawPoster).indexOf('invalidateStatsCache') >= 0);
  } finally {
    try { appData.records = JSON.parse(recBak); } catch (e) { R.push(['!! records 恢复失败: ' + e.message, false]); }
    invalidateStatsCache();
    if (sv) { if (wasActive) sv.classList.add('active'); else sv.classList.remove('active'); }
    try { renderStats(); } catch (e) { /* 恢复期重画失败不影响断言结果 */ }
    saveData();
  }
  return JSON.stringify(R);
})();
