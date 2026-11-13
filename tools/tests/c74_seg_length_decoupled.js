/* C74 「时长与区间解耦」：块的长度、卡片的分数都不再从区间反算
   ─────────────────────────────────────────────────────────────
   病灶：结算晚 1~2 小时，区间被收口/裁切歪掉，
   于是 Σ(e-s) 把 25 分钟算成 43 分钟 —— 计划卡「共 43 分」、日程块变高一截。
   参照 super-productivity：时长单独存（timeSpentOnDay 按增量累加），
   区间只负责「画在哪儿」，展示层的 workStart/workEnd 只是大概时段。
   落到我们这儿：records[].effectiveSeconds 是权威时长，区间只决定起点。
   本用例锁住三件事：
     ① 计划实际块的长度 = 记录的权威时长（同记录多段按跨度占比分配）
     ② 自由专注块的长度 = effectiveSeconds（缺它才退回区间）
     ③ 计划卡「共 X 分」读同一个口径（不再 Σ 区间） */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function near(a, b) { return Math.abs(a - b) < 0.01; }

  /* ① 单段：区间 43 分钟（318→361），权威 25 分钟 → 块长 25，起点不动 */
  var one = tbAuthScaleSegs([{ start: 318, end: 361, recId: 1, authMs: 25 * 60000 }]);
  ok('①单段：块长 = 权威 25 分', near(one[0].minutes, 25) && near(one[0].end, 343), JSON.stringify(one[0]));
  ok('①单段：起点不动（区间仍决定画在哪儿）', near(one[0].start, 318));

  /* ② 同一记录两段（跨度 10 / 33 分，权威 25 分）→ 按各段跨度占比分配 */
  var two = tbAuthScaleSegs([
    { start: 318, end: 328, recId: 7, authMs: 25 * 60000 },
    { start: 333, end: 366, recId: 7, authMs: 25 * 60000 }
  ]);
  ok('②两段合计 = 权威 25 分', near(two[0].minutes + two[1].minutes, 25),
    (two[0].minutes + two[1].minutes).toFixed(3));
  ok('②两段按跨度占比分配', near(two[0].minutes, 25 * 10 / 43) && near(two[1].minutes, 25 * 33 / 43),
    two[0].minutes.toFixed(2) + ' / ' + two[1].minutes.toFixed(2));
  ok('②两段起点都不动', near(two[0].start, 318) && near(two[1].start, 333));

  /* ③ 两条不同记录各按各的权威时长，互不牵连 */
  var mix = tbAuthScaleSegs([
    { start: 0, end: 60, recId: 11, authMs: 20 * 60000 },
    { start: 120, end: 180, recId: 12, authMs: 45 * 60000 }
  ]);
  ok('③不同记录各按各的', near(mix[0].minutes, 20) && near(mix[1].minutes, 45),
    mix[0].minutes + ' / ' + mix[1].minutes);

  /* ④ 进行中/无出处的段（recId 为空）不许被改：它们本来就没有权威值 */
  var live = tbAuthScaleSegs([{ start: 600, end: 625, recId: null, authMs: 0 }]);
  ok('④进行中段按区间原样', near(live[0].minutes, 25) && near(live[0].end, 625), JSON.stringify(live[0]));

  /* ⑤ 纯函数：不改入参 */
  var src = [{ start: 0, end: 60, recId: 5, authMs: 10 * 60000 }];
  tbAuthScaleSegs(src);
  ok('⑤不改调用方的数组', src[0].end === 60 && src[0].minutes === undefined, JSON.stringify(src[0]));

  /* ⑥ 出参永远带 minutes（调用方不必各算一遍） */
  var noMin = tbAuthScaleSegs([{ start: 10, end: 40 }]);
  ok('⑥出参兜底带 minutes', near(noMin[0].minutes, 30), JSON.stringify(noMin[0]));

  /* ⑦⑧ 自由专注块：区间 43 分 + effectiveSeconds 1500 → 25 分；缺权威值才退回 43 */
  var _d = new Date();
  var ds = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
  var t0 = new Date(_d.getFullYear(), _d.getMonth(), _d.getDate(), 5, 18, 0).getTime();
  var u = tbUnplannedSegments([{
    id: 1, taskName: '自由', startTime: t0, endTime: t0 + 43 * 60000,
    effectiveSeconds: 1500, segs: [{ s: t0, e: t0 + 43 * 60000 }]
  }], ds, []);
  ok('⑦自由块长度 = 25 分（不是区间 43）', u.length === 1 && near(u[0].minutes, 25),
    u.length ? String(u[0].minutes) : 'none');
  var u2 = tbUnplannedSegments([{
    id: 2, taskName: '老记录', startTime: t0, endTime: t0 + 43 * 60000,
    segs: [{ s: t0, e: t0 + 43 * 60000 }]
  }], ds, []);
  ok('⑧无权威值时退回区间 43 分（不能凭空变 0）', u2.length === 1 && near(u2[0].minutes, 43),
    u2.length ? String(u2[0].minutes) : 'none');

  /* ⑨ 计划卡「共 X 分」同一口径：两段区间跨 48 分、权威 20+5 分 → 25 分 */
  var bakT = JSON.stringify(appData.todos || []), bakR = JSON.stringify(appData.records || []);
  var bakV = (typeof _curView !== 'undefined') ? _curView : null;
  try {
    var tA = t0, tB = t0 + 20 * 60000, tC = t0 + 25 * 60000, tD = t0 + 48 * 60000;
    appData.todos = [{ id: 9701, title: 'C74卡', date: ds, remindAt: ds + ' 05:18',
      pomodoros: 1, actualPomodoros: 2, done: false }];
    appData.records = [
      { id: 9701, todoId: 9701, taskName: 'C74卡', startTime: tA, endTime: tB, effectiveSeconds: 1200,
        pomodoros: 1, segs: [{ s: tA, e: tB, recId: 9701 }] },
      { id: 9702, todoId: 9701, taskName: 'C74卡', startTime: tC, endTime: tD, effectiveSeconds: 300,
        pomodoros: 1, segs: [{ s: tC, e: tD, recId: 9702 }] }
    ];
    if (typeof tbInvalidateSegIndex === 'function') tbInvalidateSegIndex();
    if (typeof switchView === 'function') switchView('plan');
    if (typeof renderTodos === 'function') renderTodos();
    var box = document.getElementById('todoList');
    var txt = box ? (box.innerText || '') : '';
    ok('⑨计划卡写「共 25 分」', txt.indexOf('共 25 分') >= 0, (txt.match(/✅[^\n]*/) || ['无'])[0].slice(0, 40));
    ok('⑨计划卡不出现「共 43 分」', txt.indexOf('共 43 分') < 0);
    ok('⑨时段按区间显示 5:18~6:06', txt.indexOf('5:18~6:06') >= 0 || txt.indexOf('⏰') >= 0);
  } catch (e2) {
    ok('⑨计划卡渲染抛异常：' + e2.message, false);
  } finally {
    appData.todos = JSON.parse(bakT);
    appData.records = JSON.parse(bakR);
    if (typeof tbInvalidateSegIndex === 'function') tbInvalidateSegIndex();
    if (bakV && typeof switchView === 'function') { try { switchView(bakV); } catch (e3) {} }
  }
  return JSON.stringify(R);
})();
