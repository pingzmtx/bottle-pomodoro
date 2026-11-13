/* C82 两件「数错了 / 存丢了」的事

   ① 传记里程碑「第 N 个番茄」用了 records.length ——「仅记录」（type:'log'，随手记的 5 分钟）
      也占一条，于是需求只记了几顿吃饭/玩手机，"达成第 50 个番茄"，而他实际只有 24 个。
      → 口径改成 Σ getPomos（与全站「累计 🍅」同源）。
      （内测期无存量用户，已存在的假条目直接改数据文件，代码里不做迁移。）

   ② 日记/待办是 5 秒防抖保存，而切后台只调了 saveDataNow()（存的是还没读到新文字的旧值），
      然后页面被冻结、5 秒定时器再也轮不到 → 敲进去的字蒸发。
      需求 17 号写的「明天改进」18 号看不见，就是这么没的。
      → flushPendingEdits() 接到 visibilitychange / freeze / pagehide / beforeunload。

   A 里程碑按番茄数（记录条数顶不出来）
   B 真的攒够 50 个番茄仍然会触发（不是把功能关死）
   C 切后台那一刻就把输入框里的字收进 appData（同步可观测）
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }

  var recsBak = JSON.stringify(appData.records || []);
  var bioBak = JSON.stringify(appData.biographies || []);
  var trigBak = JSON.stringify(appData.bioTriggered || {});
  var initBak = appData.bioInitDone, backBak = appData.bioBackfillDone;
  /* 旅程把 checkBiographyEvents 包成了闸口（累计 7 个🍅 才放行）。
     本用例验的是传记的「按番茄数计」逻辑，不是解锁节奏 —— 先关旅程，测完还原。
     否则 C82 会变成「新用户前 7 个番茄内永不合格」，而不是它想测的东西。 */
  var journeyBak = JSON.stringify(appData.journey || null);
  var diaryDate = '2026-01-02';
  var diaryBak = JSON.stringify(appData.diaries[diaryDate] || null);
  var curBak = (typeof currentDiaryDate === 'undefined') ? null : currentDiaryDate;

  function mkRecs(n, type, pomos) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({ id: 1000 + i, type: type, taskName: 'x' + i, startTime: 1700000000000 + i * 1000,
        endTime: 1700000000000 + i * 1000 + 60000, effectiveSeconds: 60, pomos: pomos, segs: [] });
    }
    return out;
  }
  function hasBio(key) {
    return (appData.biographies || []).some(function (b) { return b.key === key; });
  }

  try {
    appData.journey = Object.assign({}, appData.journey, { enabled: false });
    /* ===== A 记录条数不等于番茄数 ===== */
    appData.bioInitDone = true;
    appData.bioBackfillDone = true;
    appData.bioTriggered = {};
    appData.biographies = [];
    appData.records = mkRecs(50, 'log', 0);   /* 50 条「仅记录」，0 个番茄 */
    ok('A1 50 条仅记录折算成 0 个番茄', bioTotalPomos() === 0);
    try { checkBiographyEvents(); } catch (e) { R.push(['!! A 触发异常: ' + e.message, false]); }
    ok('A2 ★ 只有记录条数时，不许出现「第 50 个番茄」传记', !hasBio('rec_50'));
    ok('A3 也不许记成 rec_10 / rec_100', !hasBio('rec_10') && !hasBio('rec_100'));
    ok('A4 半个番茄记 0.5（与全站累计口径一致）',
      bioTotalPomos([{ type: 'half', pomos: 0.5 }, { type: 'log', pomos: 0 }]) === 0.5);

    /* ===== B 真攒够就该触发 ===== */
    appData.bioTriggered = {};
    appData.biographies = [];
    appData.records = mkRecs(50, 'full', 1);
    try { checkBiographyEvents(); } catch (e) { R.push(['!! B 触发异常: ' + e.message, false]); }
    ok('B1 ★ 真到 50 个番茄时，rec_50 正常生成', hasBio('rec_50'));
    ok('B2 同时补记 rec_10', hasBio('rec_10'));

    /* ===== C 切后台时把输入框里的字收进数据 ===== */
    appData.diaries[diaryDate] = {
      plan: '', planSnapshot: [],
      review: { progress: '', shortcomings: '', improvements: '', other: '' },
      feedback: { sleepTime: '', wakeTime: '', sleepQuality: '', mentalState: '', sleepDay: 'prev' }
    };
    if (typeof selectDiaryDate === 'function') { try { selectDiaryDate(diaryDate); } catch (e) { /* 视图不在也可以 */ } }
    currentDiaryDate = diaryDate;
    if (typeof diaryViewMode !== 'undefined') diaryViewMode = 'single';
    try { renderDiarySingle(); } catch (e) { /* ignore */ }
    var ta = document.getElementById('single_ri_' + diaryDate);
    var hadHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    var threw = null;
    try {
      if (ta) {
        ta.value = '切后台前刚敲的改进';
        ta.dispatchEvent(new Event('input'));
        scheduleDiaryAutoSave(diaryDate);
        Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
        document.dispatchEvent(new Event('visibilitychange'));   /* 监听器同步跑 flushPendingEdits */
        ok('C1 ★ 切后台一刻就把输入框内容收进 appData（不再是 5 秒后的事）',
          appData.diaries[diaryDate].review.improvements === '切后台前刚敲的改进');
      } else {
        R.push(['!! 没找到日记改进输入框', false]);
      }
    } catch (e) { threw = e; }
    finally {
      try {
        if (hadHidden) Object.defineProperty(document, 'hidden', hadHidden);
        else delete document.hidden;
      } catch (e2) { /* ignore */ }
      /* 已经把 hidden 改回过，补一次事件让应用回到前台态 */
      try { document.dispatchEvent(new Event('visibilitychange')); } catch (e3) { /* ignore */ }
    }
    if (threw) R.push(['!! C 段落异常: ' + threw.message, false]);
    ok('C2 flushPendingEdits 已挂在切后台路径上（函数存在且可调用）',
      typeof flushPendingEdits === 'function');
  } finally {
    try { appData.records = JSON.parse(recsBak); } catch (e) { R.push(['!! records 恢复失败', false]); }
    try { appData.biographies = JSON.parse(bioBak); } catch (e) { R.push(['!! biographies 恢复失败', false]); }
    try { appData.bioTriggered = JSON.parse(trigBak); } catch (e) { R.push(['!! bioTriggered 恢复失败', false]); }
    appData.bioInitDone = initBak;
    appData.bioBackfillDone = backBak;
    try {
      if (journeyBak === 'null') delete appData.journey;
      else appData.journey = JSON.parse(journeyBak);
    } catch (e) { R.push(['!! journey 恢复失败', false]); }
    try {
      if (diaryBak === 'null') delete appData.diaries[diaryDate];
      else appData.diaries[diaryDate] = JSON.parse(diaryBak);
    } catch (e) { /* ignore */ }
    if (curBak !== null) { try { currentDiaryDate = curBak; } catch (e) { /* ignore */ } }
    try { if (typeof renderDiarySingle === 'function') renderDiarySingle(); } catch (e) { /* ignore */ }
    try { invalidateStatsCache(); } catch (e) { /* ignore */ }
    try { saveData(); } catch (e) { /* ignore */ }
  }
  return JSON.stringify(R);
})();
