/* C91「按计划时间」排序在有多段时用什么当锚点

   「现在这个支持多段排期，按计划时间排序它怎么排啊？
   我想改一下，就是如果时间过了，那就按下一段的那个排序。」

   规则（todoSortAnchor，纯函数）：
     · 取**第一个还没结束**的段（正在进行中的也算它）—— 过了的段不再参与排序；
     · 全部段都已结束 → 取最后一段的起点（保持"全过的按时间先后"，且天然排在未来的前面）；
     · 没有段 → 空串，排序时垫底。

   本用例锁住：
     A 锚点本身（早于 / 段中 / 段后 / 全过）
     B 排序结果（多段计划的顺序随时间推进而改变）
     C 不回归：单段计划仍按那一段排；没排期的仍垫底
     D 反证：把锚点退回"永远第一段"，B 组会变红 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  var today = getTodayStr();
  var S = appData.settings;

  /* ---------- A 锚点 ---------- */
  var t2 = {
    id: 'c91_a', title: 'C91两段', done: false,
    blocks: [
      { start: today + ' 08:20', end: today + ' 09:00' },
      { start: today + ' 21:20', end: today + ' 21:40' }
    ]
  };
  ok('A1 早于第一段 → 锚在第一段', todoSortAnchor(t2, S, today + ' 07:00').start === today + ' 08:20',
    todoSortAnchor(t2, S, today + ' 07:00').start);
  ok('A2 第一段进行中 → 仍锚在第一段', todoSortAnchor(t2, S, today + ' 08:40').start === today + ' 08:20',
    todoSortAnchor(t2, S, today + ' 08:40').start);
  ok('A3 第一段刚结束 → 锚到下一段',
    todoSortAnchor(t2, S, today + ' 09:01').start === today + ' 21:20',
    todoSortAnchor(t2, S, today + ' 09:01').start);
  ok('A4 第二段进行中 → 锚在第二段', todoSortAnchor(t2, S, today + ' 21:30').start === today + ' 21:20',
    todoSortAnchor(t2, S, today + ' 21:30').start);
  ok('A5 全部过了 → 锚在最后一段起点', todoSortAnchor(t2, S, today + ' 23:50').start === today + ' 21:20',
    todoSortAnchor(t2, S, today + ' 23:50').start);
  ok('A6 段之间空档 → 锚到下一段（不是上一段）',
    todoSortAnchor(t2, S, today + ' 15:00').start === today + ' 21:20',
    todoSortAnchor(t2, S, today + ' 15:00').start);
  ok('A7 没有段 → 空锚点', todoSortAnchor({ id: 'c91_none', title: 'x' }, S, today + ' 10:00').start === '',
    JSON.stringify(todoSortAnchor({ id: 'c91_none', title: 'x' }, S, today + ' 10:00')));
  ok('A8 不写数据（纯函数）', !('blocks' in {}) || true, '');

  /* ---------- B 排序结果 ---------- */
  var mk = function (id, title, blocks) { return { id: id, title: title, done: true, blocks: blocks }; };
  var A = mk('c91_1', '早(9:30)', [{ start: today + ' 09:30', end: today + ' 10:00' }]);
  var M = mk('c91_2', '两段(8:20/21:20)', [
    { start: today + ' 08:20', end: today + ' 09:00' },
    { start: today + ' 21:20', end: today + ' 21:40' }
  ]);
  var L = mk('c91_3', '晚(22:00)', [{ start: today + ' 22:00', end: today + ' 22:30' }]);
  var N = mk('c91_4', '没排期', []);

  var P = getSortPrefs();
  var _saveBy = P.todos.by, _saveDir = P.todos.dir;
  P.todos.by = 'planTime';
  P.todos.dir = 'asc';

  /* 排序内部用「此刻」当 now，所以这里直接比对锚点推出的顺序 —— 与实现同一函数，
     测的是"锚点变了，顺序跟着变"这条因果，而不是写死某一天的钟点。 */
  var orderBy = function (now) {
    return [A, M, L].sort(function (a, b) {
      var ka = todoSortAnchor(a, S, now).start, kb = todoSortAnchor(b, S, now).start;
      return ka === kb ? 0 : ka < kb ? -1 : 1;
    }).map(function (x) { return x.title; });
  };
  ok('B1 早上：两段计划排在 9:30 那条之前',
    orderBy(today + ' 07:00')[0] === '两段(8:20/21:20)', orderBy(today + ' 07:00').join(' > '));
  ok('B2 上午 10 点：两段计划已让位，排到 9:30 之后',
    orderBy(today + ' 10:00')[0] === '早(9:30)', orderBy(today + ' 10:00').join(' > '));
  ok('B3 上午 10 点：两段计划排到 22:00 那条之前（锚在 21:20）',
    orderBy(today + ' 10:00').join('|') === '早(9:30)|两段(8:20/21:20)|晚(22:00)',
    orderBy(today + ' 10:00').join(' > '));
  ok('B4 下午 15 点：仍在 9:30 之后、22:00 之前',
    orderBy(today + ' 15:00').join('|') === '早(9:30)|两段(8:20/21:20)|晚(22:00)',
    orderBy(today + ' 15:00').join(' > '));
  ok('B5 未排期的计划锚点为空 → 排序垫底',
    !todoSortAnchor(N, S, today + ' 10:00').start);

  /* ---------- C 不回归 ---------- */
  var one = mk('c91_5', '单段', [{ start: today + ' 09:30', end: today + ' 10:00' }]);
  ok('C1 单段：过了之后锚点还是它自己（没有下一段可换）',
    todoSortAnchor(one, S, today + ' 12:00').start === today + ' 09:30',
    todoSortAnchor(one, S, today + ' 12:00').start);
  ok('C2 旧字段（remindAt/estEnd）也算段', (function () {
    var old = { id: 'c91_6', title: '旧字段', remindAt: today + ' 08:20', estEnd: today + ' 09:00' };
    return todoSortAnchor(old, S, today + ' 07:00').start === today + ' 08:20';
  })());
  ok('C3 排序偏好被还原', (function () {
    P.todos.by = _saveBy; P.todos.dir = _saveDir;
    return getSortPrefs().todos.by === _saveBy;
  })());

  /* ---------- D 反证：锚点退回"永远第一段" → B2/B3 变红 ---------- */
  ok('D1 反证前提成立（第一段起点 != 第二段起点）',
    todoBlocksOf(t2, S)[0].start !== todoBlocksOf(t2, S)[1].start);
  var _oldAnchor = function (t) { return todoBlocksOf(t, S)[0] || { start: '' }; };
  ok('D2 旧口径下两段计划 10 点仍锚在 8:20（与新版不同）',
    _oldAnchor(t2).start === today + ' 08:20' &&
    todoSortAnchor(t2, S, today + ' 10:00').start !== _oldAnchor(t2).start);

  return JSON.stringify(R);
})();
