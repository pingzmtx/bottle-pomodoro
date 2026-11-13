/* C43 的页面侧断言体：统计页「打断分析」按 日 / 月 / 年 / 累计 分区间，不再是全历史总账。

   打断分析：原来印的是全历史累计，和旁边的「近7天/近8周」不是一个口径。

   根因（实证）：buildTaskIntStats 里的打断段遍历 appData.records **没有任何时间窗**，
        renderInterruptAnalysis 直接把「累计打断 N 次 / 浪费 M 分钟 / 打断率 X%」印出来，
        而它旁边全是「近 7 天 / 近 8 周 / 近 30 天」的图 → 语义对不上。

   断言：区间换算（日/月/年/累计四档 + 偏移）/ 区间外不计 / 仅记录不计 /
        原因 top 排序 / 空区间走提示文案 / 卡片头控件与文案随档位变 / 不许翻到未来。
   全程用真状态跑，**恢复放在 finally**。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var bak = null;
  var scopeBak = null, offBak = null;
  function at(y, mo, d) { return new Date(y, mo, d, 10, 0, 0, 0).getTime(); }
  /* 本地零点（区间换算断言必须用本地时间，否则非 UTC 时区必然错开 8 小时） */
  function mid(y, mo, d) { return new Date(y, mo, d, 0, 0, 0, 0).getTime(); }
  function mk(id, ms, type, ints) {
    var sec = 0;
    (ints || []).forEach(function (x) { sec += x.duration || 0; });
    return {
      id: 'c43_' + id, type: type, taskName: 'C43_' + id, note: '',
      startTime: ms, endTime: ms + 25 * 60000,
      effectiveSeconds: 1500, pomos: type === 'full' ? 1 : 0,
      interruptions: ints || [], totalInterruptSeconds: sec
    };
  }
  function boxText() {
    var b = document.getElementById('interruptBox');
    return b ? b.textContent.replace(/\s+/g, ' ').trim() : '';
  }
  function setScope(s, off) {
    _intScope = s;
    _intOffset = off || 0;
    renderInterruptAnalysis();
  }
  try {
    if (typeof appData === 'undefined' || !appData.records) {
      return JSON.stringify([['① appData.records 可用', false]]);
    }
    bak = appData.records.slice();
    scopeBak = _intScope;
    offBak = _intOffset;

    var now = new Date();
    var Y = now.getFullYear(), M = now.getMonth(), DD = now.getDate();
    var tToday = at(Y, M, DD);
    var t2ago = at(Y, M, Math.max(1, DD - 2)); /* 永远落在本月内（月初跑也不会翻到上月失败） */
    var lm = new Date(Y, M - 1, 15); lm.setHours(10, 0, 0, 0);
    var tLastMonth = lm.getTime();
    var ly = new Date(Y - 1, 5, 15); ly.setHours(10, 0, 0, 0);
    var tLastYear = ly.getTime();

    /* —— ① 区间换算 —— */
    var rd = interruptRangeOf('day', 0);
    ok('①a 日档 = 今天 00:00 → 明天 00:00 且标签「今天」',
      rd.from === mid(Y, M, DD) && rd.to === mid(Y, M, DD + 1) && rd.label === '今天');
    var rp = interruptRangeOf('day', -1);
    ok('①b 日档可前翻一期（标签带年月日）', rp.from < rd.from && /\d+年\d+月\d+日/.test(rp.label));
    var rm = interruptRangeOf('month', 0);
    ok('①c 月档 = 本月 1 号 → 下月 1 号', rm.from === mid(Y, M, 1) && rm.to === mid(Y, M + 1, 1));
    ok('①d 月档标签是「YYYY年MM月」', rm.label === Y + '年' + String(M + 1).padStart(2, '0') + '月');
    var ry = interruptRangeOf('year', 0);
    ok('①e 年档 = 1月1日 → 次年1月1日', ry.from === mid(Y, 0, 1) && ry.to === mid(Y + 1, 0, 1) && ry.label === Y + '年');
    var ra = interruptRangeOf('all', 0);
    ok('①f 累计档两端不限、标签「累计（全部）」', ra.from === null && ra.to === null && ra.label === '累计（全部）');

    /* —— ② 数据：今天 2 条（含「仅记录」）/ 2 天前 1 条 / 上月 1 条 / 去年 1 条 —— */
    appData.records.length = 0;
    appData.records.push(mk('A', tToday, 'full', [
      { reason: '看手机', duration: 30 }, { reason: '看手机', duration: 40 }
    ]));                                                   /* 今天：2 次 / 70s */
    appData.records.push(mk('B', t2ago, 'incomplete', [{ reason: '别人找我', duration: 60 }]));
    appData.records.push(mk('BL', tToday, 'log', [{ reason: '看手机', duration: 999 }]));
    appData.records.push(mk('C', tLastMonth, 'half', [{ reason: '看手机', duration: 20 }]));
    appData.records.push(mk('D', tLastYear, 'full', [{ reason: '别人找我', duration: 10 }]));

    var mAll = buildInterruptStats(rm.from, rm.to);
    ok('②a 月档只收本月 2 条（上月/去年那两条不计，仅记录也不入 rangeRecs）', mAll.rangeRecs === 2);
    ok('②b 月档打断 = 3 次（不含「仅记录」里那条）', mAll.intCount === 3);
    ok('②c 月档浪费 = 130 秒', mAll.intSecTotal === 130);
    ok('②d 月档番茄分母 = 2（full + incomplete）', mAll.rangePomos === 2);
    var tAllStats = buildInterruptStats(ra.from, ra.to);
    ok('②e 累计档 = 5 次（「仅记录」里的那次不算）', tAllStats.intCount === 5);
    ok('②f 累计档口径=全历史 4 条非记录（仅记录那条不计）', tAllStats.rangeRecs === 4);
    ok('②g 原因 top 按次数降序、最高是「看手机」', mAll.intReasonTop.length >= 2 && mAll.intReasonTop[0].n === 2);
    var rY = interruptRangeOf('year', 0);
    /* 年内非记录：A(2 次) + B(1 次) + C(1 次) —— C 是「上个月」，只有 1 月时它才落到去年 */
    var expYear = M > 0 ? 4 : 3;
    ok('②h 年档排除去年那条（上个月仍在今年，要计）', buildInterruptStats(rY.from, rY.to).intCount === expYear);
    var emptyRow = interruptRangeOf('year', -3);
    ok('②i 空区间 rangeRecs = 0', buildInterruptStats(emptyRow.from, emptyRow.to).rangeRecs === 0);

    /* —— ③ 卡片文案随档位变 —— */
    setScope('month', 0);
    var tm = boxText();
    ok('③a 月档印「打断 3 次」', tm.indexOf('打断 3 次') >= 0);
    ok('③b 月档印「浪费 2 分钟」', tm.indexOf('浪费 2 分钟') >= 0);
    ok('③c 卡片头带本月标签', tm.indexOf(rm.label) >= 0);
    ok('③d 卡片头有 日/月/年/累计 四个档位按钮',
      [].slice.call(document.querySelectorAll('#interruptBox button')).filter(function (b) {
        return ['日', '月', '年', '累计'].indexOf(b.textContent.trim()) >= 0;
      }).length === 4);
    setScope('day', 0);
    ok('③e 日档只算今天 2 次', boxText().indexOf('打断 2 次') >= 0);
    setScope('all', 0);
    var ta = boxText();
    ok('③f 累计档印 5 次且标签为「累计（全部）」', ta.indexOf('打断 5 次') >= 0 && ta.indexOf('累计（全部）') >= 0);
    ok('③g 累计档不再显示 ◀ ▶（没有可比区间）',
      [].slice.call(document.querySelectorAll('#interruptBox button')).every(function (b) {
        return ['◀', '▶'].indexOf(b.textContent.trim()) < 0;
      }));
    setScope('year', -3);
    ok('③h 空档位走「还没有专注记录」提示，不再说「完成番茄后才统计」',
      boxText().indexOf('还没有专注记录') >= 0);

    /* —— ④ 不许翻到未来 —— */
    setScope('month', 0);
    intShift(1);
    ok('④a ▶ 在当期无效（不许翻到未来的空区间）', _intOffset === 0);
    intShift(-1); intShift(-1);
    ok('④b 可连续前翻两期', _intOffset === -2);
    intScopeSet('year');
    ok('④c 换档位自动回到当期（避免「日 -2」跳成「年 -2」）', _intOffset === 0 && _intScope === 'year');

    /* —— ⑤ 旧的「全量」口径没被这次改动动到（统计页底部评价仍按整体历史说话）—— */
    var bt = buildTaskIntStats();
    ok('⑤a 全量口径函数仍在、且它仍把「仅记录」算进去（6 次 = 新口径 5 + 仅记录那条）',
      bt && bt.intCount === 6 && Array.isArray(bt.intReasonTop));
    invalidateStatsCache();
    var sc = getStatsCache();
    ok('⑤b 统计缓存仍带 intCount/intReasonTop（底部评价的数据源没断）',
      sc && sc.intCount === 6 && Array.isArray(sc.intReasonTop));
  } catch (e) {
    R.push(['!! 断言抛异常：' + (e && e.message), false]);
  } finally {
    try {
      if (bak) {
        appData.records.length = 0;
        bak.forEach(function (r) { appData.records.push(r); });
      }
      if (typeof invalidateStatsCache === 'function') invalidateStatsCache();
      if (scopeBak !== null) { _intScope = scopeBak; _intOffset = offBak; }
      if (typeof renderInterruptAnalysis === 'function') renderInterruptAnalysis();
    } catch (e2) { /* 清理失败不掩盖断言结果 */ }
  }
  return JSON.stringify(R);
})();
