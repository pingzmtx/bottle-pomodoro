/* C95 —— 「只做过、没排过」的任务，日程表上必须画得出实际块。
   「我今天这英语，晚上有一个完成的半个番茄的背单词，为什么日程表上不显示」。
   根因：网格的行全部来自 tbBlocksOf（预计块）；没有排期的任务一行都没有，
   于是它的实际段无处安放，整条记录在网格上凭空消失。
   本用例锁三件事：
     A 没有预计块、但有记录 → 实际块出现；
     B 只有实际块，不许凭空画出预计块（actOnly 行 planSegs 传 null）；
     C 有预计块的老路径不受影响（两条实际段仍各画一块，不重复）。
   数据全部临时造、结尾还原。 */
(function () {
  var R = [];
  function ok(name, cond, extra) {
    R.push([name, !!cond, extra === undefined ? '' : String(extra)]);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function todayMs(h, m) {
    var d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  var DS = todayStr();
  var savedTodos = null, savedRecords = null;
  try {
    savedTodos = appData.todos;
    savedRecords = appData.records;

    /* ① 造一条"只做过、没排过"的任务：blocks 为空、没有 remindAt */
    var t = {
      id: 'c95-noblock', title: 'C95无排期任务', quad: '', tag: '', pomodoros: 1,
      done: false, subs: [], blocks: [], remindAt: null, estEnd: null
    };
    var other = {
      id: 'c95-withblock', title: 'C95有排期任务', quad: '', tag: '', pomodoros: 1,
      done: false, subs: [],
      /* ★ 必须落在网格的两排之内（07–14 / 15–22）：06:00 早于首排，
         块和行都在，只是画不出来 —— 一开始拿 06:00 作对照，C1/C2 假红。 */
      blocks: [{ start: DS + ' 08:00', end: DS + ' 09:00' }]
    };
    appData.todos = [t, other];
    appData.records = [{
      id: 'r95a', todoId: 'c95-noblock', type: 'half', taskName: 'C95无排期任务',
      date: DS, startTime: todayMs(21, 52), endTime: todayMs(22, 12),
      effectiveSeconds: 1200, pomos: 0.5, segs: [{ s: Math.round(todayMs(21, 52)), e: Math.round(todayMs(22, 12)) }]
    }, {
      id: 'r95b', todoId: 'c95-withblock', type: 'full', taskName: 'C95有排期任务',
      date: DS, startTime: todayMs(8, 5), endTime: todayMs(8, 30),
      effectiveSeconds: 1500, pomos: 1, segs: [{ s: Math.round(todayMs(8, 5)), e: Math.round(todayMs(8, 30)) }]
    }];

    switchView('plan');
    if (typeof switchPlanTab === 'function') switchPlanTab('plan');
    renderTimeBlockGrid();

    function blocksOf(id, cls) {
      return [].slice.call(document.querySelectorAll('.tb-paper-blk' + (cls ? '.' + cls : '') + '[data-tb-todo="' + id + '"]'));
    }

    /* 块高（分钟）：网格是「每钟点两列」，一段跨过整点会被拆进相邻两列，
       所以**块数 ≠ 段数** —— 判"画没画对"只能比总高度，不能比块数。 */
    function spanMin(list) {
      var n = 0;
      list.forEach(function (b) {
        /* 读 style.gridRow（"21 / span 40"）：getComputedStyle 会把它归一成 px 串 */
        var p2 = String(b.style.gridRow || '').split('/');
        n += parseFloat(String(p2[1] || '').replace(/[^0-9.]/g, '')) || 0;
      });
      return n;
    }

    /* ── A 没有预计块的任务，实际块必须画出来 ── */
    var act = blocksOf('c95-noblock', 'is-actual');
    ok('A1 无排期任务的实际块在网格上出现', act.length >= 1, 'got ' + act.length);
    /* 21:52→22:12 = 20 分钟，跨整点拆两列；总高度必须正好 20 */
    ok('A2 画出来的总时长 = 记录的 20 分钟（跨整点拆块不算错）', spanMin(act) === 20, 'got ' + spanMin(act) + ' / ' + act.length + ' 块');
    ok('A3 块上有任务名（块太窄印不出字时，看 title 提示）',
      act.length > 0 && act.every(function (b) { return /C95无排期任务/.test((b.getAttribute('title') || '') + b.textContent); }),
      act.map(function (b) { return b.getAttribute('title'); }).join(' | '));
    ok('A4 块不是"计划外"灰块（它是有主的记录）', !!act[0] && !/is-unplanned/.test(act[0].className), act[0] && act[0].className);

    /* ── B 不许凭空画预计块 ── */
    var plan = blocksOf('c95-noblock', 'is-plan');
    ok('B1 无排期任务不许凭空出现预计块', plan.length === 0, 'got ' + plan.length);

    /* ── C 老路径不受影响 ── */
    var act2 = blocksOf('c95-withblock', 'is-actual');
    ok('C1 有排期任务的实际块照旧', spanMin(act2) === 25, 'got ' + spanMin(act2) + ' / ' + act2.length + ' 块');
    ok('C2 有排期任务的预计块照旧', blocksOf('c95-withblock', 'is-plan').length === 1,
      blocksOf('c95-withblock', 'is-plan').length);

    /* ── D 纯函数口径：tbTodoSegList 是"有没有做过"的唯一判据 ── */
    ok('D1 无排期任务有段（这才是 A 的前提）', tbTodoSegList(t, DS).length === 1, tbTodoSegList(t, DS).length);
    ok('D2 无排期任务没有预计块', tbBlocksOf(t, appData.settings, DS).length === 0,
      tbBlocksOf(t, appData.settings, DS).length);

    /* ── E 边界：有一堆段落在同一天，行只占一个（不许按段数复制行） ── */
    appData.records.push({
      id: 'r95c', todoId: 'c95-noblock', type: 'full', taskName: 'C95无排期任务',
      date: DS, startTime: todayMs(20, 0), endTime: todayMs(20, 25),
      effectiveSeconds: 1500, pomos: 1, segs: [{ s: Math.round(todayMs(20, 0)), e: Math.round(todayMs(20, 25)) }]
    });
    renderTimeBlockGrid();
    ok('E1 同一天两段 → 总时长 45 分钟（不是只画第一段）', spanMin(blocksOf('c95-noblock', 'is-actual')) === 45,
      spanMin(blocksOf('c95-noblock', 'is-actual')) + ' / ' + blocksOf('c95-noblock', 'is-actual').length + ' 块');
    ok('E2 仍然没有预计块', blocksOf('c95-noblock', 'is-plan').length === 0);
  } catch (e) {
    ok('EXCEPTION ' + (e && e.message), false);
  } finally {
    try {
      if (savedTodos) appData.todos = savedTodos;
      if (savedRecords) appData.records = savedRecords;
      renderTodos(); renderTimeBlockGrid();
    } catch (e2) {}
  }
  return JSON.stringify(R);
})();
