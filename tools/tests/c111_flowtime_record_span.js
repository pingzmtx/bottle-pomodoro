/* C117 正计时记录：区间必须与专注时长自洽
 *
 * 用户报（2026-10-29）：「我明明专注了 31 分钟，但是它显示 9:40 到 9:49，这不才 10 分钟吗？
 * 那个日志都是错的」。根因：正计时每次暂停→继续都把 startTime 重设成「此刻」，
 * 而 effectiveSeconds 是**累计**专注时长，两个数不是同一个量。
 * 于是 21:17 开始、中途暂停过的那次专注，落库只剩 21:40~21:49（8 分钟），
 * 日志写 8 分钟、结算说 31 分钟，自相矛盾。
 *
 * A 落库：起点 = 结束 − 累计专注时长（21:17:24~21:49:11 = 32 分钟）
 * B 幂等：同一份数据再存一次，区间不会被反复回推
 * C 老数据修正：已存的「起点是续跑时刻」的记录，migrateDataContract 会把它拉正，且幂等
 * D 不误伤：正常番茄（区间 ≈ 时长）一分一秒都不动
 * E 日程块：修正后块落在 21:17~21:49，不再越过结束时刻（更不会画进未来）
 */
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }
  function hhmm(t) {
    var d = new Date(t);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  var recsBak = appData.records.slice();
  var tsBak = JSON.parse(JSON.stringify(timerState));
  var T = new Date(2026, 9, 29, 21, 49, 11).getTime(); /* 结束时刻 */
  var RESUME = new Date(2026, 9, 29, 21, 40, 54).getTime(); /* 最后一次继续 */
  var EFF = 1907; /* 累计专注 31 分 47 秒 */

  /* ---- A 落库 ---- */
  appData.records = [];
  timerState.mode = 'free';
  timerState.taskName = 'C117 正计时';
  timerState.linkedTodoId = null;
  timerState.curSubId = null;
  timerState.effectiveSeconds = EFF;
  timerState.startTime = RESUME;
  timerState.finishEndedAt = T;
  savePomodoroRecord('full');
  var rec = appData.records[0];
  ok('A1 落了 1 条记录', appData.records.length === 1, appData.records.length);
  ok('A2 区间 = 结束 − 累计专注时长', !!rec && Math.abs(rec.startTime - (T - EFF * 1000)) < 2000,
    rec && hhmm(rec.startTime) + '~' + hhmm(rec.endTime));
  ok('A3 区间与时长自洽（相差 < 1 分钟）',
    !!rec && Math.abs((rec.endTime - rec.startTime) / 1000 - EFF) < 60,
    rec && Math.round((rec.endTime - rec.startTime) / 60000) + ' 分钟');
  ok('A4 结束时刻没有被改', !!rec && Math.abs(rec.endTime - T) < 2000, rec && hhmm(rec.endTime));

  /* ---- B 幂等：把同一条再走一遍迁移，起点不动 ---- */
  var st1 = rec.startTime;
  migrateDataContract();
  ok('B1 迁移对已正确的记录不动作', appData.records[0].startTime === st1, hhmm(st1));

  /* ---- C 老数据修正 ---- */
  var legacy = {
    id: 990001, type: 'full', taskName: 'C117 老记录',
    startTime: RESUME, endTime: T, effectiveSeconds: EFF, pomos: 1
  };
  appData.records = [legacy];
  migrateDataContract();
  var fixed = appData.records[0];
  ok('C1 老记录的起点被拉正', Math.abs(fixed.startTime - (T - EFF * 1000)) < 2000, hhmm(fixed.startTime));
  ok('C2 老记录按 32 分钟显示', Math.abs((fixed.endTime - fixed.startTime) / 1000 - EFF) < 60,
    Math.round((fixed.endTime - fixed.startTime) / 60000) + ' 分钟');
  var st2 = fixed.startTime;
  migrateDataContract();
  ok('C3 修正幂等（再跑一次不动）', appData.records[0].startTime === st2, hhmm(st2));

  /* ---- D 不误伤正常番茄：25 分钟，区间比时长多 2 秒 ---- */
  var normal = {
    id: 990002, type: 'full', taskName: 'C117 正常番茄',
    startTime: T - 1502000, endTime: T, effectiveSeconds: 1500, pomos: 1
  };
  var nStart = normal.startTime;
  appData.records = [normal];
  migrateDataContract();
  ok('D1 正常番茄的起点一分不动', appData.records[0].startTime === nStart, hhmm(nStart));

  /* ---- E 日程块不越过结束时刻 ----
     老的 bug：块从起点按有效时长往后拉 → 21:40 + 31 分钟 = 22:12（画进未来） */
  appData.records = [fixed];
  var d0 = new Date(2026, 9, 29).getTime();
  var segs = tbUnplannedSegments(appData.records, '2026-10-29', []);
  var mine = segs.filter(function (s) {
    return String(s.title).indexOf('C117') >= 0;
  })[0];
  ok('E1 日程里有这一段', !!mine, segs.length);
  if (mine) {
    var endMin = mine.start + mine.minutes;
    var recEndMin = (fixed.endTime - d0) / 60000;
    ok('E2 块不越过记录结束时刻', endMin <= recEndMin + 0.7,
      '块止于 ' + Math.round(endMin) + ' 分，记录止于 ' + Math.round(recEndMin) + ' 分');
    ok('E3 块长 ≈ 32 分钟', Math.abs(mine.minutes - EFF / 60) < 1, mine.minutes.toFixed(1));
  }

  appData.records = recsBak;
  Object.keys(tsBak).forEach(function (k) { timerState[k] = tsBak[k]; });
  return JSON.stringify(R);
})();
