/* C96 —— 重复计划「某天单独排期」（dayPlan）

   「我的周期任务排期不一定固定，但现在有一个排期，它每天都是那个排期。
   我如果第二天改了这个排期，前面几天的排期也会变吗？」

   结论与实现：
   A 数据层：某天有覆盖 → 那天**整组替换**模板（不是叠加）；别的日子仍用模板
   B 日期正确性：rawStart 的日期必须是那一天（重复任务的模板段挂在首日）
   C 历史保护：改今天的覆盖，不动到昨天已冻结的快照
   D 校验：重叠/过短/删空恢复模板
   E 日切：过期覆盖被清掉，今天和未来的留着
   F 排序锚点跟着今天的覆盖走
   G 反证：停掉 tbBlocksOf 的覆盖分支 → A/C 组变红

   数据全部临时造、结尾还原。 */
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var today = getTodayStr();
  var yest = addDaysStr(today, -1);
  var tomorrow = addDaysStr(today, 1);
  var S = appData.settings;

  var _saveTodos = appData.todos;
  var _saveSched = appData.todoSchedLog;
  appData.todos = [];
  appData.todoSchedLog = {};

  var rep = { mode: 'daily', last: today, next: tomorrow };
  /* 模板固定 21:00–21:30，每天都一样。
     firstDay：模板段挂在哪一天 —— 它同时是「重复规则的起点」。
     真实数据里首日通常是创建那天，所以历史天靠**平移**（shift>0）画出来；
     首日之前的天本来就没有块（这一点很重要，下面的 C 组要靠"首日=昨天"来构造）。 */
  function mkTpl(firstDay) {
    var d0 = firstDay || today;
    return {
      id: 'c96_rep', title: 'C96每天', done: false, pomodoros: 1, subs: [],
      repeat: JSON.parse(JSON.stringify(rep)),
      blocks: [{ start: d0 + ' 21:00', end: d0 + ' 21:30' }]
    };
  }

  function spans(t, ds) {
    return tbBlocksOf(t, S, ds).map(function (b) {
      return b.rawStart.slice(11) + '-' + b.rawEnd.slice(11);
    });
  }

  /* ---------- A 某天单独排 ---------- */
  var t = mkTpl();
  ok('A1 没有覆盖时今天按模板', spans(t, today).join() === '21:00-21:30', spans(t, today).join());
  ok('A2 没有覆盖时明天也按模板', spans(t, tomorrow).join() === '21:00-21:30', spans(t, tomorrow).join());

  var r1 = appData.todos.push(t) && todoDayPlanSet('c96_rep', today, [
    { start: today + ' 19:00', end: today + ' 19:40' }
  ]);
  ok('A3 写入覆盖成功', r1 && r1.ok === true, JSON.stringify(r1));
  ok('A4 今天整组替换：只剩 19:00，模板 21:00 不再出现',
    spans(t, today).join() === '19:00-19:40', spans(t, today).join());
  ok('A5 明天不受影响，仍按模板', spans(t, tomorrow).join() === '21:00-21:30', spans(t, tomorrow).join());
  ok('A6 模板本身没被改（t.blocks 还在）',
    todoBlocksOf(t, S).length === 1 && todoBlocksOf(t, S)[0].start.slice(11) === '21:00',
    JSON.stringify(todoBlocksOf(t, S)));

  /* 追加一段到同一天 */
  var r2 = todoDayPlanAdd('c96_rep', today, 12 * 60, 12 * 60 + 30);
  ok('A7 同一天追加一段 → 两段', r2.ok && spans(t, today).join() === '12:00-12:30,19:00-19:40',
    spans(t, today).join());

  /* ---------- B 日期正确性 ---------- */
  var b = tbBlocksOf(t, S, today);
  ok('B1 rawStart 的日期是「那一天」，不是排期首日',
    b.every(function (x) { return x.rawStart.slice(0, 10) === today; }),
    JSON.stringify(b.map(function (x) { return x.rawStart; })));
  ok('B2 startMin/endMin 是当天分钟数',
    b.length === 2 && b[1].startMin === 19 * 60 && b[1].endMin === 19 * 60 + 40,
    b.map(function (x) { return x.startMin + '-' + x.endMin; }).join(' '));

  /* ---------- C 历史保护：昨天的快照 ---------- */
  var t2 = mkTpl(yest);  /* 首日放昨天：昨天是真实画过的，今天靠平移命中 */
  appData.todos.push(t2);
  /* 先把"昨天按模板画出来的块"冻结成快照（与真实日切同一条路径） */
  pushTodoSchedSnapshot(t2, yest);
  ok('C1 昨天的快照已冻结', (appData.todoSchedLog[yest] || []).length === 1,
    JSON.stringify(appData.todoSchedLog[yest]));

  /* 今天把这条计划整体改成 07:00（模板 + 今天的覆盖都变）——
     注意：模板首日也跟着变成今天，昨天就从"首日"变成"首日之前"了。 */
  t2.blocks = [{ start: today + ' 07:00', end: today + ' 07:30' }];
  todoDayPlanSet('c96_rep', today, [{ start: today + ' 06:30', end: today + ' 07:00' }]);
  var liveIds = {};
  [t2].forEach(function (x) { if (tbBlocksOf(x, S, yest).length) liveIds[String(x.id)] = 1; });
  var hist = todoSchedPseudoTodos(appData.todoSchedLog[yest] || [], liveIds);
  ok('C2 改了模板+今天覆盖后，昨天快照里的块仍是 21:00',
    hist.length === 1 && !!(hist[0]._histBlocks && hist[0]._histBlocks[0])
    && hist[0]._histBlocks[0].rawStart.slice(11) === '21:00',
    JSON.stringify(hist.map(function (h) {
      return h._histBlocks && h._histBlocks[0] ? h._histBlocks[0].rawStart : null;
    })));
  ok('C3 昨天活对象不再画块（重复规则只在首日+当天命中）',
    tbBlocksOf(t2, S, yest).length === 0, spans(t2, yest).join());

  var pseudo = hist[0];
  var _pb = pseudo ? tbBlocksOf(pseudo, S, yest) : [];
  ok('C4 伪任务优先用自己的冻结块，绝不读今天的 dayPlan',
    _pb.length === 1 && _pb[0].rawStart.slice(11) === '21:00',
    JSON.stringify(_pb.map(function (x) { return x.rawStart; })));

  /* ---------- D 校验 ----------
     ★ C 组刚把今天的覆盖替换成 06:30–07:00，这里必须先摆回一个确定的段，
       否则"重叠"根本无从谈起（第一版忘了这步，D1 假绿了）。 */
  todoDayPlanSet('c96_rep', today, [{ start: today + ' 19:00', end: today + ' 19:40' }]);
  var ov = todoDayPlanAdd('c96_rep', today, 19 * 60 + 10, 19 * 60 + 30);
  ok('D1 与已有段重叠 → 拒绝', ov.ok === false && ov.reason === 'overlap', JSON.stringify(ov));
  var short = todoDayPlanAdd('c96_rep', today, 8 * 60, 8 * 60 + 5);
  ok('D2 不足 10 分钟 → 拒绝', short.ok === false && short.reason === 'short', JSON.stringify(short));
  var bad = todoDayPlanSet('c96_rep', '2026-13-01', [{ start: '2026-13-01 08:00', end: '2026-13-01 09:00' }]);
  ok('D3 不存在的日期 → 拒绝', bad.ok === false, JSON.stringify(bad));

  /* 删到空 = 恢复模板（先追加一段 12:00，再一段段删光） */
  todoDayPlanAdd('c96_rep', today, 12 * 60, 12 * 60 + 30);
  todoDayPlanRemoveSeg('c96_rep', today, today + ' 12:00');
  todoDayPlanRemoveSeg('c96_rep', today, today + ' 19:00');
  ok('D4 段全删光 → 那天恢复模板', spans(t, today).join() === '21:00-21:30', spans(t, today).join());
  ok('D5 空 dayPlan 字段被删掉（不留 {})', !t.dayPlan, JSON.stringify(t.dayPlan));

  /* ---------- E 日切清理 ---------- */
  todoDayPlanSet('c96_rep', yest, [{ start: yest + ' 08:00', end: yest + ' 09:00' }]);
  todoDayPlanSet('c96_rep', today, [{ start: today + ' 08:00', end: today + ' 09:00' }]);
  todoDayPlanSet('c96_rep', tomorrow, [{ start: tomorrow + ' 08:00', end: tomorrow + ' 09:00' }]);
  ok('E1 三天都写上了', Object.keys(todoDayPlanNormAll(t)).length === 3,
    Object.keys(todoDayPlanNormAll(t)).join());
  pruneExpiredDayPlans(today);
  var left = Object.keys(todoDayPlanNormAll(t));
  ok('E2 过期的昨天被清掉', left.indexOf(yest) === -1, left.join());
  ok('E3 今天和未来保留', left.indexOf(today) >= 0 && left.indexOf(tomorrow) >= 0, left.join());
  var again = pruneExpiredDayPlans(today);
  ok('E4 幂等：再跑一次没有变化', again === false, String(again));

  /* ---------- F 排序锚点 ---------- */
  var fs = { id: 'c96_sort', title: 'C96排序', done: false, blocks: [{ start: today + ' 21:00', end: today + ' 21:30' }] };
  appData.todos.push(fs);
  todoDayPlanSet('c96_sort', today, [{ start: today + ' 07:00', end: today + ' 07:30' }]);
  ok('F1 今天有覆盖 → 锚点用覆盖段（07:00）',
    todoSortAnchor(fs, S, today + ' 06:00').start === today + ' 07:00',
    todoSortAnchor(fs, S, today + ' 06:00').start);
  ok('F2 别的日子仍按模板（21:00）',
    todoSortAnchor(fs, S, tomorrow + ' 06:00').start === today + ' 21:00',
    todoSortAnchor(fs, S, tomorrow + ' 06:00').start);

  /* ---------- G 反证：停掉覆盖分支 ---------- */
  /* ★ 必须用**新的 id**：todoDayPlanSet 按 id 找第一条，撞上 A 组那条就改不到 g 上
     （第一版就是这么假绿的 —— 断言在问 g，改的却是 t）。 */
  var g = mkTpl();
  g.id = 'c96_g';
  appData.todos.push(g);
  todoDayPlanSet('c96_g', today, [{ start: today + ' 19:00', end: today + ' 19:40' }]);
  ok('G1 覆盖生效（今日 19:00）', spans(g, today).join() === '19:00-19:40', spans(g, today).join());
  ok('G2 反证前提：模板仍是 21:00 → 忽略覆盖就会得到 21:00',
    todoBlocksOf(g, S).length === 1 && todoBlocksOf(g, S)[0].start.slice(11) === '21:00'
    && spans(g, today).join() !== '21:00-21:30');

  /* 还原 */
  appData.todos = _saveTodos;
  appData.todoSchedLog = _saveSched;
  return JSON.stringify(R);
})();
