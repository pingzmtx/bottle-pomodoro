/* C110 —— 周挑战「本周单日完成 8 个番茄」不能做 1 个就完成

   用户报：「本周单日完成这个 8 个番茄，我今天就完成了一个番茄，然后它就显示我这个任务
   完成了，怎么这么诡异」。

   根因：池里 day8 的 goal 写成了 1（本意是「1 天达标」），而进度口径是
   ctx.day8 = maxDayPts（本周**最高单日**番茄数）→ 1 >= 1 当场判完成。
   goal 改成 8 之后，localStorage 里还躺着 goal:1 的旧条目，必须就地校正。

   A 老条目自愈：goal 1 → 8，done 退回 false
   B 只做 1 个番茄：progress 1/8，未完成，不发星
   C 单日做满 8 个：完成，且只加一次星（重复结算幂等）
   D 池定义自查：文案里的数字必须等于 goal —— 这次 bug 就是「名字写 8、goal 写 1」，
     两边一旦分开写就会再犯，所以让机器盯着（6 条挑战全查）
   E 走一遍正常入口（calcWeeklyChallengeProgress）：存档写 goal:1 也会被校正成 8，
     本周剩下的日子不会继续误判
*/
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }

  var rs = appData.rankSystem;
  var recBak = appData.records.slice();
  var wcBak = JSON.parse(JSON.stringify(rs.weeklyChallenge || {}));
  var starsBak = rs.stars;

  var today = getTodayStr();
  var ws = getWeekStartStr();

  /* 今天上午的单日记录：n 个完整番茄 */
  function setDayPoms(n) {
    var list = recBak.filter(function (r) { return r.id && String(r.id).indexOf('c110_') === 0; });
    appData.records = recBak.filter(function (r) { return !(r.id && String(r.id).indexOf('c110_') === 0); });
    for (var i = 0; i < n; i++) {
      var d = new Date();
      d.setHours(8 + i, 0, 0, 0);
      appData.records.push({
        id: 'c110_' + i,
        startTime: d.getTime(),
        endTime: d.getTime() + 1500000,
        effectiveSeconds: 1500,
        type: 'full',
        tag: ''
      });
    }
  }
  function putChallenge(items) {
    rs.weeklyChallenge = { weekStart: ws, items: items };
  }
  function item(over) {
    var it = {
      id: 'day8', icon: '⚡', name: '本周单日完成 8 个番茄',
      goal: 8, reward: 2, type: 'day8',
      progress: 0, done: false, claimed: false
    };
    Object.keys(over || {}).forEach(function (k) { it[k] = over[k]; });
    return it;
  }
  function day8Of(wc) {
    for (var i = 0; i < wc.items.length; i++) if (wc.items[i].id === 'day8') return wc.items[i];
    return null;
  }

  /* ---- A 老条目自愈（上一版存下来的 goal:1 + 已误判完成） ---- */
  setDayPoms(1);
  rs.stars = 0;
  putChallenge([item({ goal: 1, progress: 1, done: true, claimed: true })]);
  var wcA = getWeeklyChallenge();
  var a = day8Of(wcA);
  ok('A1 旧条目 goal 校正为 8', !!a && a.goal === 8, a && a.goal);
  ok('A2 旧条目 done 退回 false（1 个番茄不算数）', !!a && a.done === false, a && a.done);
  ok('A3 已发的星不回收（claimed 保持，避免重复发）', !!a && a.claimed === true, a && a.claimed);

  /* ---- B 只做 1 个番茄：1/8，不发星 ---- */
  var wcB = calcWeeklyChallengeProgress();
  var b = day8Of(wcB);
  ok('B1 进度 = 1/8', !!b && b.progress === 1 && b.goal === 8, b && b.progress + '/' + b.goal);
  ok('B2 未完成', !!b && b.done === false, b && b.done);
  ok('B3 没有发星（stars 仍为 0）', rs.stars === 0, rs.stars);

  /* ---- C 单日做满 8 个：完成，且只加一次 ---- */
  setDayPoms(8);
  rs.stars = 0;
  putChallenge([item({})]);
  var wcC = calcWeeklyChallengeProgress();
  var c = day8Of(wcC);
  ok('C1 单日 8 个 → 完成', !!c && c.done === true, c && c.progress);
  ok('C2 完成加 2 星', rs.stars === 2, rs.stars);
  calcWeeklyChallengeProgress();
  calcWeeklyChallengeProgress();
  ok('C3 重复结算不重复发星', rs.stars === 2, rs.stars);

  /* ---- D 池定义自查：文案里的数字 == goal ---- */
  var pool = window.WEEKLY_CHALLENGE_POOL || [];
  var bad = [];
  pool.forEach(function (c) {
    var m = String(c.name).match(/\d+/);
    if (!m) return; /* 文案里没数字的不比（betwin 这类「1 次」有数字，照比） */
    if (Number(m[0]) !== Number(c.goal)) bad.push(c.id + '：文案 ' + m[0] + ' / goal ' + c.goal);
  });
  ok('D1 池定义：6 条挑战都在', pool.length === 6, pool.length);
  ok('D2 文案里的数字与 goal 一致（名字写 8、goal 写 1 就是这次的 bug）', bad.length === 0, bad.join('；'));

  /* ---- E 正常入口也自愈：存档 goal:1 走一次 calc 就变成 8 ---- */
  setDayPoms(1);
  rs.stars = 0;
  putChallenge([item({ goal: 1, progress: 1, done: true, claimed: false })]);
  var wcE = calcWeeklyChallengeProgress();
  var e = day8Of(wcE);
  ok('E1 走正常入口后 goal 也是 8', !!e && e.goal === 8, e && e.goal);
  ok('E2 1 个番茄不会判完成', !!e && e.done === false, e && e.done);

  /* 还原 */
  appData.records = recBak;
  rs.weeklyChallenge = wcBak;
  rs.stars = starsBak;
  return JSON.stringify(R);
})();
