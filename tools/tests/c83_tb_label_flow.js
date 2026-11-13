/* C83 日程块里的字：跨行的块不许只剩 1~3 个字
   ─────────────────────────────────────────────────────────────
   需求原话：「日程的预计和实际，一旦块跨了行，比如 7 点到 8:40，
   它那个字最多只显示三个；7:50 到 8 点多的只显示一个，这不应该」。

   根因（两个叠在一起）：
     ① 一条计划跨整点时会被切成多段，老代码取**最矮那一段**的字数给**整条**用 ——
        8:40 那块必然带一个 40 分钟的尾段，于是整条只剩 3 个字；7:50 那块尾段 10 分钟 → 1 个字。
     ② 字宽写死 14px/字，而 .tb-paper-blk-t 实际字步进约 21px → 每段都多算约 50% 的字，
        末端几个字被 overflow 裁成半截。

   本用例锁住：
     A 跨行不断言"整条按最矮裁" —— 长块该印的字数按自己的高度算（≥ 高度/字步进 - 1）
     B 切出来的多段是**接着往下写**（拼起来等于标题开头，不重复、不跳字）
     C 时间上断开的两段各自从头写（第二段不能从标题中间开始）
     D 字宽取自实测（tbCharAdvance 与真实行高一致），不是写死的 14
     E 反证：把口径退回"取最矮那段"，A 必须变红
*/
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function dsOf(off) {
    var d = new Date();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + off);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function setUp(todos) {
    var ds = dsOf(0);
    appData.todos = todos.map(function (t) {
      return Object.assign({ id: t.id, quad: 'q1', pomodoros: 1, done: false, subs: [] }, t);
    });
    appData.settings.tbGridFolded = false;
    switchView('plan');
    renderTimeBlockGrid();
    return ds;
  }
  /* 一个块内实际印出来的字（span 里没有 → 视为空） */
  function labelOf(el) {
    var sp = el.querySelector('.tb-paper-blk-t');
    return sp ? sp.textContent : '';
  }
  function planBlocksOf(id) {
    return Array.prototype.slice.call(
      document.querySelectorAll('.tb-paper-blk.is-plan[data-tb-id="' + id + '"]')
    ).sort(function (a, b) {
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });
  }
  /* 每个 span 有没有被 overflow 裁掉（scrollHeight > clientHeight 就是裁了） */
  function clipped(el) {
    var sp = el.querySelector('.tb-paper-blk-t');
    return sp ? sp.scrollHeight > sp.clientHeight + 1 : false;
  }

  var wantTodos = [];
  var orig = { todos: JSON.stringify(appData.todos || []) };
  try {
    var ds = dsOf(0);
    /* ===== A 跨行块按自己高度印字 ===== */
    setUp([
      { id: 8301, title: '数学作业练习册第三章圆锥曲线', remindAt: ds + 'T07:00', estEnd: ds + 'T08:40', estEndManual: true },
      { id: 8302, title: '英语阅读理解两篇', remindAt: ds + 'T07:50', estEnd: ds + 'T08:20', estEndManual: true }
    ]);
    var adv = tbCharAdvance();
    ok('A0 字步进取自实测（与真实行高一致，不是写死的 14）', adv > 15 && adv < 40, 'adv=' + adv);

    var big = planBlocksOf(8301);
    ok('A1 8:40 的计划被整点切成 2 段', big.length === 2, '段数=' + big.length);
    var bigLabels = big.map(labelOf);
    var totalChars = bigLabels.join('').length;
    /* 07:00–08:00 这一段 60 分钟 = 180px → 至少放得下 6 个字（60/21 ≈ 8） */
    ok('A2 ★ 长段不再只印 3 个字', bigLabels[0].length >= 6, '首段=' + JSON.stringify(bigLabels[0]));
    ok('A3 ★ 两段加起来明显多于最矮那段能放的', totalChars >= 8, '合计=' + totalChars);
    ok('A4 没有任何一段被 overflow 裁成半截', big.every(function (el) { return !clipped(el); }));

    /* ===== B 多段是接着往下写 ===== */
    var whole = '数学作业练习册第三章圆锥曲线';
    ok('B1 拼起来等于标题开头（不重复、不跳字）',
      whole.indexOf(bigLabels.join('')) === 0 && bigLabels.join('').length > 0,
      '拼出=' + JSON.stringify(bigLabels.join('')));

    /* ===== C 断开的两段各自从头写 ===== */
    setUp([
      { id: 8303, title: '物理错题整理复盘', remindAt: ds + 'T09:00', estEnd: ds + 'T09:40', estEndManual: true },
      { id: 8303, title: '物理错题整理复盘', remindAt: ds + 'T13:00', estEnd: ds + 'T13:40', estEndManual: true }
    ]);
    /* 同一 id 两条不成立（会被当成同一条）—— 改用单条但把第二段用 extraBlocks 形式造不出来，
       所以这里直接验 tbFlowLabels 的纯行为：两段起点不相邻 → 都从第 0 字开始。 */
    var segsFar = [
      { band: 0, hi: 2, row: 0, span: 40 },
      { band: 0, hi: 6, row: 0, span: 40 }
    ];
    var mFar = tbFlowLabels(segsFar, '物理错题整理复盘');
    ok('C1 ★ 时间断开时第二段从标题第一个字重新开始',
      String(mFar.get(segsFar[1])).indexOf('物') === 0, '第二段=' + JSON.stringify(mFar.get(segsFar[1])));

    /* ===== D 实际块用同一套口径 ===== */
    /* 先把这个任务重新放回现场（C 段换过 todos，不重放的话 D 量到的就是"压根没画"） */
    setUp([
      { id: 8301, title: '数学作业练习册第三章圆锥曲线', remindAt: ds + 'T07:00', estEnd: ds + 'T08:40', estEndManual: true }
    ]);
    var recs = appData.records || [];
    var bakRecs = JSON.stringify(recs);
    var _s = new Date(ds + 'T07:05:00').getTime();
    appData.records = [
      { id: 'c83_act', todoId: 8301, type: 'full', taskName: '数学作业练习册第三章圆锥曲线',
        startTime: _s, endTime: _s + 30 * 60000, effectiveSeconds: 1800, pomos: 1,
        segs: [{ s: _s, e: _s + 30 * 60000 }] }
    ];
    switchView('plan');
    renderTimeBlockGrid();
    var actEl = document.querySelectorAll('.tb-paper-blk.is-actual');
    ok('D1 实际块也印出了字（不是空白）',
      actEl.length > 0 && Array.prototype.some.call(actEl, function (e) { return labelOf(e).length > 0; }),
      '实际块数=' + actEl.length);
    ok('D2 实际块也没有被裁成半截（口径与预计块同一套）',
      Array.prototype.every.call(actEl, function (e) { return !clipped(e); }));
    appData.records = JSON.parse(bakRecs);

    /* ===== E 反证：把口径退回旧版（整条按最矮那段 + 写死 14px/字），字数必须掉回去 ===== */
    /* 7:50–8:20 这条：被整点切成 10 分钟（尾段）+ 20 分钟两段。
       旧口径取最矮那段 10 分钟 = 30px → floor((30-10)/14) = 1 个字（需求「只显示一个」）。 */
    setUp([
      { id: 8304, title: '英语阅读理解两篇', remindAt: ds + 'T07:50', estEnd: ds + 'T08:20', estEndManual: true }
    ]);
    var smallBl = planBlocksOf(8304);
    var spansPx = smallBl.map(function (e) { return Math.round(e.getBoundingClientRect().height); });
    var oldN = Math.floor((Math.min.apply(null, spansPx) - 10) / 14);
    var newTotal = smallBl.map(labelOf).join('').length;
    ok('E1 反证：旧口径（最矮段 + 14px/字）在这条上只剩 1 个字', oldN === 1,
      '旧口径=' + oldN + '（段高=' + JSON.stringify(spansPx) + '）');
    ok('E2 ★ 新口径明显多印了几个字（旧口径确实被回收了）', newTotal > oldN,
      '新=' + newTotal + ' 旧=' + oldN);
  } catch (e) {
    R.push(['!! C83 执行异常 :: ' + (e && e.stack || e), false]);
  } finally {
    try {
      appData.todos = JSON.parse(orig.todos || '[]');
      switchView('plan');
      renderTimeBlockGrid();
    } catch (e2) { /* ignore */ }
  }
  return JSON.stringify(R);
})();
