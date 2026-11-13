/* C106 重复计划的排期只能落在规则命中的日子上
   ─────────────────────────────────────────────────────────────
   需求原话：「我明明是我新增一个排期，就是每周日排期，为什么它会出现在我不是周日的
   日程表上……那个日程表显示的那天并不是周日呀，然后计划表上也没有显示什么每周日」

   三处都是同一个病：**「规则」和「排期段」各说各的，谁也不管谁。**
   ① `todoOccursOn` 让排期首日**无条件生效** —— 周三建的计划、规则是每周日，
      周三照样画出一块（首日被当成"一次真实发生"，可它只是模板锚点）。
   ② 折叠卡只印时段、不印规则 —— 列表默认折叠，用户只看到「排期 20:00」，
      看不出这是"每周日那次"还是"就今天一次"。
   ③ 段的日期既是"这一天有安排"，也是重复时的**平移基准**。规则定成每周日、
      段却挂在周三，写下去等于排了个哪儿都不出现的时间（周三规则不认、
      周日基准不对）。所以写入口要把段挪到最近的命中日。

   锁住：
     A 首日不在规则里 → 不画（本次 bug 的正身）
     B 规则命中的日子照常画，且按天平移（周日、下周日都在）
     C 一次性计划不受影响（首日照常画）
     D 折叠卡上能看见「每周日」这三个字
     E 给重复计划加段：挂错日子会自动挪到最近的命中日（钟点不动）
   ★ 日期一律由 TC 的假时钟/字符串给定，不写"今天" —— 用今天会让断言随跑的日子变。 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  var savedTodos = appData.todos.slice();

  /* 周三 2026-10-21 建的计划，规则「每周日」（weekdays 用 7）+ 段挂在周三 20:00 */
  function mkWeekly() {
    return {
      id: 'c106_weekly', title: '网站维护', done: false, quad: 'q4', tag: '',
      pomodoros: 1, remindAt: null, estEnd: null, subs: [], actualPomodoros: 0,
      timeSpent: 0, blocks: [{ start: '2026-10-21 20:00', end: '2026-10-21 20:40' }],
      repeat: { mode: 'weekly', weekdays: [7], last: '2026-10-21', next: '2026-10-25', subsMode: 'clearDone' }
    };
  }
  function segsOn(t, ds) {
    return tbBlocksOf(t, appData.settings, ds).map(function (b) { return b.startMin + '-' + b.endMin; });
  }

  try {
    /* ===== A/B 纯函数层：首日不再无条件生效 ===== */
    var t = mkWeekly();
    ok('A1 周三（规则外）画不出块 —— 本次 bug 的正身', segsOn(t, '2026-10-21').length === 0,
      '实际 ' + JSON.stringify(segsOn(t, '2026-10-21')));
    ok('A2 周二（规则外）也画不出块', segsOn(t, '2026-10-20').length === 0);
    ok('A3 「生效」判定同样不许首日例外', todoOccursOn(t, '2026-10-21', '2026-10-21') === false);
    ok('B1 这周日 10-25 画得出来，钟点还是 20:00–20:40',
      segsOn(t, '2026-10-25').length === 1 && segsOn(t, '2026-10-25')[0] === '1200-1240',
      JSON.stringify(segsOn(t, '2026-10-25')));
    ok('B2 下周日 11-01 同样画得出来（按天平移，不是只那一天）', segsOn(t, '2026-11-01').length === 1);
    ok('B3 周六 10-24 仍然没有（规则外的日子一律不画）', segsOn(t, '2026-10-24').length === 0);

    /* 「每天」不能因为这条修正塌掉：这是最容易误伤的档 */
    var d = mkWeekly();
    d.repeat = { mode: 'daily', last: '2026-10-21', next: '2026-10-22', subsMode: 'reset' };
    ok('B4 「每天」照旧天天都画', segsOn(d, '2026-10-21').length === 1 && segsOn(d, '2026-10-23').length === 1);

    /* ===== C 一次性计划不受影响 ===== */
    var once = mkWeekly();
    once.repeat = null;
    ok('C1 一次性计划：排期那天天照常画', segsOn(once, '2026-10-21').length === 1);
    ok('C2 一次性计划：别的日子不画', segsOn(once, '2026-10-22').length === 0);

    /* ===== D 折叠卡上要能认出「这是重复的、哪天重复」 =====
       ★ 2026-10-25 口径：折叠态只留一个 🔄 徽标，周期文案与「今天不做」全部收进
         title / aria-label（原来那行 .todo-extra-line--rep 已删）。
         所以这里验徽标 + 那份说明，而不是再找那不存在的文字行。
       ★ 「今天恰好命中 / 规则外」两态都验，且故意构造"不是今天"的星期几，
         不依赖跑用例那天是周几（以前写死"周三"，周日跑就翻红）。 */
    var card = mkWeekly();
    appData.todos = [card];
    TC.enterPlan();
    renderTodos();
    function repTag(el) {
      if (!el) return '';
      var s = el.innerHTML, i = s.indexOf('todo-rep-badge');
      return i < 0 ? '' : s.slice(i, s.indexOf('>', i) + 1);
    }
    var row = document.querySelector('.todo-item');
    var _tag = repTag(row);
    var _vis = row ? row.textContent : '';
    ok('D1 折叠卡上有重复徽标，说明里写清「每周日」', _tag.indexOf('每周日') >= 0, _tag || _vis.slice(0, 80));
    ok('D2 折叠态不再另起一行写周期文案',
      !!row && !row.querySelector('.todo-extra-line--rep') && _vis.indexOf('每周日') < 0, _vis.slice(0, 80));
    /* 规则外的日子要说明白"今天不做"，否则用户只看到一段时段配一条不存在的规则 */
    var _td = getTodayStr();
    var _iso = (new Date(_td + 'T00:00:00').getDay() || 7);
    var _other = _iso === 7 ? 1 : _iso + 1;
    var card2 = mkWeekly();
    card2.repeat.weekdays = [_other];
    appData.todos = [card2];
    renderTodos();
    var _tag2 = repTag(document.querySelector('.todo-item'));
    ok('D3 规则外的日子：徽标变淡 + 写明「今天不做」',
      _tag2.indexOf('今天不做') >= 0 && _tag2.indexOf('todo-rep-badge--off') >= 0, _tag2);

    /* ===== E 加段时挂错日子 → 自动挪到最近的命中日 ===== */
    var e = mkWeekly();
    e.blocks = [];
    appData.todos = [e];
    var res = todoAddBlock('c106_weekly', '2026-10-21', 9 * 60, 9 * 60 + 40);
    ok('E1 加段成功', !!res && res.ok === true, JSON.stringify(res));
    ok('E2 回报了挪到哪天', !!res && res.movedTo === '2026-10-25', JSON.stringify(res && res.movedTo));
    ok('E3 段落在周日 10-25，钟点不动',
      !!(e.blocks && e.blocks[0] && e.blocks[0].start === '2026-10-25 09:00' && e.blocks[0].end === '2026-10-25 09:40'),
      JSON.stringify(e.blocks));
    ok('E4 挪过去之后周日画得出来', segsOn(e, '2026-10-25').length === 1);
    ok('E5 原来点的周三没被写进去', segsOn(e, '2026-10-21').length === 0);
    /* 点在命中日上 → 原样写，不该乱挪 */
    var e2 = mkWeekly();
    e2.blocks = [];
    appData.todos = [e2];
    var res2 = todoAddBlock('c106_weekly', '2026-10-25', 9 * 60, 9 * 60 + 40);
    ok('E6 点在周日上就原样落，不复挪', !!res2 && res2.ok && !res2.movedTo &&
      e2.blocks[0].start === '2026-10-25 09:00', JSON.stringify(res2));

    /* ===== F 改规则也要带着排期走 =====
       「周三建了一条、本来不重复，后来在设置里改成每周日」—— 段还挂在周三，
       规则却只认周日：期间不画、周日也画不对（基准是周三）。改规则时要把段对齐。 */
    var f = mkWeekly();
    f.repeat = null;
    f.blocks = [{ start: '2026-10-21 20:00', end: '2026-10-21 20:40' }];
    appData.todos = [f];
    applyTodoRepeat(f, { mode: 'weekly', weekdays: [7], subsMode: 'clearDone' });
    ok('F1 改成每周日后段被挪到周日',
      !!(f.blocks && f.blocks[0] && f.blocks[0].start === '2026-10-25 20:00'),
      JSON.stringify(f.blocks));
    ok('F2 挪完钟点不变', !!(f.blocks && f.blocks[0] && f.blocks[0].end === '2026-10-25 20:40'));
    ok('F3 挪完周日画得出来', segsOn(f, '2026-10-25').length === 1);
    ok('F4 挪完周三不画了', segsOn(f, '2026-10-21').length === 0);
    /* 改成「每天」：周三也算命中日，段不该被挪走 */
    var g = mkWeekly();
    g.repeat = null;
    g.blocks = [{ start: '2026-10-21 20:00', end: '2026-10-21 20:40' }];
    appData.todos = [g];
    applyTodoRepeat(g, { mode: 'daily', subsMode: 'reset' });
    ok('F5 改成每天后段原地不动', !!(g.blocks && g.blocks[0] && g.blocks[0].start === '2026-10-21 20:00'),
      JSON.stringify(g.blocks));
  } finally {
    appData.todos = savedTodos;
    try { renderTodos(); } catch (err) { /* 还原失败不该盖掉断言结果 */ }
  }

  return JSON.stringify(R);
})();
