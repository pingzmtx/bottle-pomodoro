/* C85 同一個「专注时长」不许两个数 —— 且这个数只认秒表
   ─────────────────────────────────────────────────────────────
   两轮需求，最终口径：
     「专注记录 今天…专注 50 分钟，和日记里的 1小时12分 怎么不一样」→ 先统一成番茄账
     「海报显示今日专注 2 小时，可我只有 2.5 个番茄，还有好多对不上」→ 改回实际计时

   ★ 为什么最终选「实际计时」而不是番茄账：getPomos 是**结算时自评**的结果。
     同样坐满 25 分钟，可以记「完整🍅」也可以记「半个🍅」；拿它 × 25 分钟当时长，
     等于让自评去改钟表 —— 连着记两段半个，50 分钟只会报成 25 分钟。
     时长认秒表，成果认🍅，两个数并排给出，差在哪一眼可见。

   锁住：
     A 日志页「专注」= 专注型记录的实际秒数（「仅记录」不算、未完成照算）
     B ★ 日记总结的主数字与日志页同值
     C 🍅 折算降级成补充小字（信息不丢）
     D 番茄账与时长一致时不出小字
     E 只有「仅记录」→ 0 分（它是记录，不是专注）
     F 差值 = 实际 − 番茄账（性质断言）
     G 番茄自评再离谱（两段各 25 分钟都记半个），时长也不跟着腰斩
     H 日志合并组的组头按类型计数：两段「半个🍅」写「半个🍅 ×2」+「合计 1🍅」，
       不许写成「半个🍅 ×1」（那会被读成"只做了半个"）
   还原：records / 视图在 finally 里复原。 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([c ? n : n + '（实际：' + (d === undefined ? '' : String(d)) + '）', !!c]); }

  var recsBak = JSON.stringify(appData.records || []);

  function todayAt(h, m) {
    var d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d.getTime();
  }
  function mkRec(id, type, pomos, sec, h, min) {
    var s = todayAt(h, min);
    return { id: id, type: type, taskName: 'C85-' + id, startTime: s, endTime: s + sec * 1000,
      effectiveSeconds: sec, pomos: pomos, segs: [] };
  }
  /* '1小时12分' / '1.2小时' / '50分' / '0分' → 分钟数（两种格式都要认） */
  function parseDur(t) {
    t = String(t || '').replace(/\s/g, '');
    var mH = t.match(/([\d.]+)小时(\d+)?/);
    if (mH) return Math.round(parseFloat(mH[1]) * 60) + (mH[2] ? Number(mH[2]) : 0);
    var mM = t.match(/(\d+)分/);
    return mM ? Number(mM[1]) : 0;
  }
  function focusCard() {
    var b = document.getElementById('diarySummaryBox');
    if (!b) return null;
    var els = b.querySelectorAll('div');
    for (var i = 0; i < els.length; i++) {
      if ((els[i].textContent || '').trim() === '⏱️ 专注时长') {
        var p = els[i].parentElement;
        var main = p && p.children[0] ? (p.children[0].textContent || '').trim() : '';
        var all = (p ? p.textContent || '' : '').trim();
        return { main: main, all: all, note: all.indexOf('🍅 折算') >= 0 };
      }
    }
    return null;
  }
  function renderToday() {
    try { renderDailyFocusSummary(getTodayStr()); } catch (e) { R.push(['!! 渲染抛异常: ' + e.message, false]); }
    return focusCard();
  }
  /* 小字里「🍅 折算 50分」那一段 → 分钟数 */
  function noteMin(all) {
    var s = String(all || ''), i = s.indexOf('🍅 折算');
    if (i < 0) return -1;
    return parseDur(s.slice(i + 4).split('\n')[0]);
  }

  try {
    /* ===== A 日志页口径：实际计时 ===== */
    appData.records = [
      mkRec(9001, 'full', 1, 1500, 9),        /* 25 分钟 → 1🍅 */
      mkRec(9002, 'full', 1, 1500, 10),       /* 25 分钟 → 1🍅 */
      mkRec(9003, 'incomplete', 0, 1320, 11)  /* 22 分钟，没折算成番茄，但真的坐了 */
    ];
    var st = logDayStats(appData.records);
    ok('A1 日志页「专注」= 实际 72 分钟（未完成的 22 分也算，它真的坐了）',
      parseDur(st.focus.num + st.focus.unit) === 72, st.focus.num + st.focus.unit);
    ok('A2 日志页「记录时长」同样 72 分钟（这一组没有「仅记录」）',
      parseDur(st.dur.num + st.dur.unit) === 72, st.dur.num + st.dur.unit);
    /* 「仅记录」是记录，不是专注：它进「记录时长」，不进「专注时长」 */
    var stLog = logDayStats([
      mkRec(9601, 'full', 1, 1500, 9),
      mkRec(9602, 'log', 0, 1800, 10)
    ]);
    ok('A3 「仅记录」的 30 分钟只进记录时长，不进口径的专注时长',
      parseDur(stLog.focus.num + stLog.focus.unit) === 25 &&
        parseDur(stLog.dur.num + stLog.dur.unit) === 55,
      (stLog.focus.num + stLog.focus.unit) + ' / ' + (stLog.dur.num + stLog.dur.unit));

    /* ===== B ★ 日记页主数字必须跟日志页同值 ===== */
    var c = renderToday();
    ok('B1 日记总结能渲染出专注时长卡', !!c);
    var cardMin = c ? parseDur(c.main) : -1;
    ok('B2 ★ 日记总结主数字 = 72 分钟（与日志页同口径，不再用番茄账折出 50）', cardMin === 72, c && c.main);

    /* ===== C 番茄账降级成补充小字 ===== */
    ok('C1 番茄账与时长不等时出「🍅 折算 …」小字', !!(c && c.note), c && c.all);
    ok('C2 折算小字 = 50 分钟（2 个整番茄）', !!(c && noteMin(c.all) === 50), c && noteMin(c.all));

    /* ===== D 两个数一致就别多那一行 ===== */
    appData.records = [
      mkRec(9101, 'full', 1, 1500, 9),
      mkRec(9102, 'full', 1, 1500, 10)
    ];
    var c2 = renderToday();
    ok('D1 番茄账 = 实际时长时不出现折算小字', !!(c2 && !c2.note), c2 && c2.all);
    ok('D2 此时主数字仍是 50 分钟', !!(c2 && parseDur(c2.main) === 50), c2 && c2.main);

    /* ===== E 仅记录不算专注 ===== */
    appData.records = [
      mkRec(9201, 'log', 0, 1800, 9),
      mkRec(9202, 'log', 0, 600, 10)
    ];
    var c3 = renderToday();
    ok('E1 只有「仅记录」→ 专注时长 0 分钟', !!(c3 && parseDur(c3.main) === 0), c3 && c3.main);
    ok('E2 且不出折算小字（0 与 0 没有差可解释）', !!(c3 && !c3.note), c3 && c3.all);
    ok('E3 建议语说明这天还没有专注记录',
      !!document.getElementById('diarySummaryBox') &&
      /还没有专注记录/.test((document.getElementById('diarySummaryBox').textContent || '')), '');

    /* ===== F 番茄账与时长是两条账，各自都算对 ===== */
    appData.records = [
      mkRec(9301, 'full', 1, 1500, 9),
      mkRec(9302, 'half', 0.5, 900, 10),   /* 15 分钟 → 折 0.5🍅 = 12.5 分 */
      mkRec(9303, 'incomplete', 0, 780, 11)
    ];
    var st4 = logDayStats(appData.records);
    var pomoSum = 0;
    appData.records.forEach(function (r) { pomoSum += getPomos(r); });
    var focusMin4 = parseDur(st4.focus.num + st4.focus.unit);
    ok('F1 没有「仅记录」时专注时长 = 记录时长 = 53 分钟',
      focusMin4 === 53 && parseDur(st4.dur.num + st4.dur.unit) === 53, st4.focus.num + st4.focus.unit);
    ok('F2 番茄账同一批数据折出 38 分钟（1.5🍅），与 53 分钟不是同一个数',
      Math.round(pomosToMinutes(pomoSum)) === 38, pomosToMinutes(pomoSum));
    var c4 = renderToday();
    ok('F3 日记页主数字 = 日志页专注（53 分钟），折算小字 38 分钟',
      !!(c4 && parseDur(c4.main) === focusMin4 && noteMin(c4.all) === 38),
      (c4 && c4.main) + ' / ' + (c4 && c4.all));

    appData.records = [
      mkRec(9401, 'half', 0.5, 1500, 9, 0),   /* 25 分钟记成半个🍅 */
      mkRec(9402, 'half', 0.5, 1500, 9, 45)   /* 再 25 分钟还是半个🍅 */
    ];
    var st5 = logDayStats(appData.records);
    ok('G1 ★ 两段各 25 分钟都自评「半个🍅」→ 时长仍是 50 分钟（不腰斩成 25）',
      parseDur(st5.focus.num + st5.focus.unit) === 50, st5.focus.num + st5.focus.unit);
    ok('G2 同一组数据的番茄账是 1 个🍅 = 25 分钟（两个数本就不等，并排给）',
      pomosToMinutes(st5.pomo) === 25, st5.pomo);

    /* ===== H 合并组组头按类型计数 ===== */
    appData.records = [
      mkRec(9501, 'half', 0.5, 1500, 9, 0),
      mkRec(9502, 'half', 0.5, 1500, 9, 30)   /* 中间只隔 5 分钟 → 合并成一组 */
    ];
    appData.records.forEach(function (r) { r.taskName = 'C85-合并'; });
    try { renderLogs(); } catch (e) { R.push(['!! renderLogs 抛异常: ' + e.message, false]); }
    var logTxt = (document.getElementById('view-log') || document.body).textContent || '';
    ok('H1 合并组组头写「半个🍅 ×2」', logTxt.indexOf('半个🍅 ×2') >= 0, '');
    ok('H2 不再写「半个🍅 ×1」（那会被读成只做了半个）', logTxt.indexOf('半个🍅 ×1') < 0, '');
    ok('H3 组内番茄合计写出来：合计 1🍅', logTxt.indexOf('合计 1🍅') >= 0, '');
  } catch (e) {
    ok('用例执行未抛异常：' + (e && e.message), false);
  } finally {
    try { appData.records = JSON.parse(recsBak); } catch (e1) { /* ignore */ }
    try { renderDailyFocusSummary(getTodayStr()); } catch (e2) { /* ignore */ }
    try { renderLogs(); } catch (e3) { /* ignore */ }
  }
  return JSON.stringify(R);
})();
