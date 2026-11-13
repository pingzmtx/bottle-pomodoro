/* C88 计划卡：折叠瘦身 + 备注内只读排期 + 逾期小标

   
     「每天的那个循环我不希望在计划里显示，就是那个卡显示截止到多少天，
      你在展开那个页面显示行，因为寸土寸金的」
     「排期能不能在那个备注里显示一下……我要把这个东西截屏发给老师」

   ★ 2026-10-21 产品决策变更（工单：把「最晚完成日」放回折叠态）：
     10-19 的诉求是「别挤」，419cd1c 的处置是「把 📅 从标题行整块删掉」——
     治成了看不见，用户反馈「最晚完成日怎么不在计划中显示了」。
     现行契约：截止日**不进标题行**（那里仍然寸土寸金），而是在标题行下面
     另起一行 `.todo-due-line`（与备注预览、排期行并列）；逾期在这一行上转红
     并追加「· 已逾期」，标题行的红色「逾期」小标退役（同一信息只有一个出口）。
     展开态不再重复印 📅 —— 折叠态已经看得见，展开只留 ⏰/🏷/🔄/预计/🏁。

   本用例锁住：
     A 折叠态：无重复徽标、有截止日独立行（逾期才转红、全卡「逾期」只出现一次）、备注预览 4 行
     B 展开态：排期块的出现条件（有另排段 / 主段跨天）、主·另排标签、同起点去重
     C 排期块只读：不写入 detail，编辑态文本框里没有它，但有只读摘要
     D 反证：把 detail 换成真实备注后，排期块不会被当成备注内容 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function list() { return document.getElementById('todoList'); }
  function row(id) { return list().querySelector('.todo-item[data-id="' + id + '"]'); }
  function segCount(id) { return row(id).querySelectorAll('.tf-view-seg').length; }

  var today = getTodayStr();
  var tmw = addDaysStr(today, 1);
  var bTodos = appData.todos.slice();

  try {
    switchView('plan');
    appData.todos = [
      { id: 'c88_a', title: 'C88重复带截止', done: false, pomodoros: 1, subs: [], tag: '',
        repeat: { mode: 'daily', last: today, next: today },
        deadline: addDaysStr(today, 3),
        detail: '第一行\n第二行\n第三行\n第四行\n第五行' },
      /* 标题刻意不含「逾期」二字：A8b 要数整张卡里「逾期」出现几次，
         标题自带这两个字会把计数搅浑（曾经就是这么假红一次）。 */
      { id: 'c88_b', title: 'C88超期', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
        deadline: addDaysStr(today, -2) },
      { id: 'c88_c', title: 'C88已完成', done: true, doneAt: Date.now(), pomodoros: 1, subs: [], repeat: '', tag: '',
        deadline: addDaysStr(today, -2) },
      { id: 'c88_d', title: 'C88多段', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
        remindAt: today + ' 07:00', estEnd: today + ' 08:00', estEndManual: true,
        extraBlocks: [{ start: today + ' 15:00', end: today + ' 16:00' }] },
      { id: 'c88_e', title: 'C88单段', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
        remindAt: today + ' 09:00', estEnd: today + ' 10:00', estEndManual: true },
      { id: 'c88_f', title: 'C88明天', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
        remindAt: tmw + ' 09:00', estEnd: tmw + ' 10:00', estEndManual: true },
      { id: 'c88_g', title: 'C88同起点', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
        remindAt: today + ' 11:00', estEnd: today + ' 12:00', estEndManual: true,
        extraBlocks: [{ start: today + ' 11:00', end: today + ' 13:00' }] }
    ];
    expandedTodos = {};
    editingTodos = {};
    renderTodos();

    /* ---------- A 折叠态 ---------- */
    var rA = row('c88_a');
    ok('A1 折叠态不显示重复徽标', !rA.querySelector('.todo-repeat'));
    /* 规则文案不进标题行，但折叠卡要另起一行说清「重复 🔄 每天」——
       列表默认折叠，完全不提规则时用户分不清这一次和每一次。 */
    var _a2title = rA.querySelector('.todo-title-row');
    ok('A2 标题行不显示「每天」字样',
      !!_a2title && String(_a2title.textContent).indexOf('每天') < 0,
      _a2title ? _a2title.textContent.slice(0, 40) : '没有标题行');
    var _a2rep = rA.querySelector('.todo-rep-badge');
    ok('A2b 折叠态的重复徽标说明里写清规则',
      !!_a2rep && String(_a2rep.getAttribute('title') || _a2rep.getAttribute('aria-label') || '').indexOf('每天') >= 0,
      _a2rep ? (_a2rep.getAttribute('title') || '') : '没有重复徽标');
    /* 10-21 起：截止日回来了，但在标题行**下面**新起一行，不在标题行里挤着。
       两层都断：「有这一行」+「这一行不在 .todo-title-row 内」。 */
    var dueA = rA.querySelector('.todo-due-line');
    ok('A3 折叠态能看到最晚完成日（独立一行）',
      !!dueA && String(dueA.textContent).indexOf('📅') >= 0 &&
      String(dueA.textContent).indexOf(addDaysStr(today, 3)) >= 0,
      dueA ? String(dueA.textContent) : 'NO .todo-due-line');
    ok('A3b 截止日不在标题行里（寸土寸金那条需求没被推翻）',
      !rA.querySelector('.todo-title-row .todo-due-line') &&
      String(rA.querySelector('.todo-title-row').textContent).indexOf('📅') < 0,
      String(rA.querySelector('.todo-title-row').textContent));
    ok('A3c 未逾期不标红', !!dueA && !dueA.classList.contains('overdue') &&
      String(dueA.textContent).indexOf('已逾期') < 0,
      dueA ? String(dueA.textContent) : '');

    var pre = rA.querySelector('.todo-detail-preview');
    ok('A4 折叠态能看见备注预览', !!pre);
    /* 用测试契约读样式，别在这里手搓 getComputedStyle（会绕开 TC 的口径） */
    var clamp = pre ? String(TC.css(pre, 'webkitLineClamp')) : '';
    var lh = pre ? parseFloat(TC.css(pre, 'lineHeight')) : 0;
    var lines = (pre && lh > 0) ? Math.round(pre.clientHeight / lh) : 0;
    /* 行数由断点决定：≥720 是 4 行，≤719 是 3 行（同一份 CSS，两种视口） */
    var expectLines = window.innerWidth <= 719 ? 3 : 4;
    ok('A5 备注预览按断点限行（窄屏 3 / 宽屏 4）',
      !!pre && (clamp === String(expectLines) || lines === expectLines),
      clamp + '/' + lines + ' expect ' + expectLines);
    ok('A6 备注预览确实被截断（内容比 4 行长）', !!pre && pre.scrollHeight > pre.clientHeight,
      pre ? pre.scrollHeight + '>' + pre.clientHeight : '');

    var rB = row('c88_b');
    var dueB = rB.querySelector('.todo-due-line');
    ok('A7 逾期任务的截止日行转红', !!dueB && dueB.classList.contains('overdue'),
      dueB ? dueB.className : 'NO .todo-due-line');
    ok('A8 逾期行写着「已逾期」', !!dueB && String(dueB.textContent).indexOf('已逾期') >= 0,
      dueB ? String(dueB.textContent) : '');
    /* 同一份信息只有一个出口：标题行的「逾期」小标已退役，
       整张卡里「逾期」两个字只该出现一次（就是这一行里的「已逾期」）。 */
    ok('A8b 全卡「逾期」只出现一次（不重复印两处）',
      (String(rB.textContent).match(/逾期/g) || []).length === 1,
      String((String(rB.textContent).match(/逾期/g) || []).length));
    ok('A8c 旧的小标 DOM 不再产生', !rB.querySelector('.todo-overdue'));

    var rC = row('c88_c');
    var dueC = rC.querySelector('.todo-due-line');
    ok('A9 已完成任务过了截止日照常显示日期、但不标红',
      !!dueC && !dueC.classList.contains('overdue') &&
      String(dueC.textContent).indexOf('已逾期') < 0,
      dueC ? dueC.className + ' :: ' + String(dueC.textContent) : 'NO .todo-due-line');
    ok('A9b 已完成任务同样不产生旧小标', !rC.querySelector('.todo-overdue'));

    /* 没填截止日 → 不产生空行、不占位（工单验收第 4 条） */
    ok('A9c 无截止日的任务不产生这一行',
      !row('c88_e').querySelector('.todo-due-line') && !row('c88_d').querySelector('.todo-due-line'));

    /* ★ 的核心诉求：不展开也要看得见另排时段 */
    var rD0 = row('c88_d');
    ok('A10 折叠态直接显示「另排」时段（不用展开）', !!rD0.querySelector('.todo-extra-line'));
    ok('A11 折叠态那一行里是时间区间',
      /\d{1,2}:\d{2}[–-]\d{1,2}:\d{2}/.test(String(rD0.querySelector('.todo-extra-line').textContent)),
      String(rD0.querySelector('.todo-extra-line').textContent));
    ok('A12 折叠态不写「N 段」这种数字',
      String(rD0.querySelector('.todo-extra-line').textContent).indexOf('段') < 0);
    ok('A13 单段的任务折叠态也写「排期」（同一份信息只有一个出口）',
      !!row('c88_e').querySelector('.todo-extra-line') &&
      /9:00[–-]10:00/.test(String(row('c88_e').querySelector('.todo-extra-line').textContent)),
      String(row('c88_e').querySelector('.todo-extra-line') ? row('c88_e').querySelector('.todo-extra-line').textContent : ''));
    ok('A14 没有排期的任务折叠态没有这一行', !row('c88_b').querySelector('.todo-extra-line'));

    /* ---------- B 展开态排期块 ---------- */
    toggleTodoExpand('c88_d');
    var rD = row('c88_d');
    ok('B1 有另排段 → 出现排期块', !!rD.querySelector('.tf-note-sched'));
    /* 10-19 改口径：多段时标题行不再兼职印首段，排期块列**全部**段。 */
    ok('B2 排期块列出全部段', segCount('c88_d') === 2, String(segCount('c88_d')));
    ok('B2b 首段 7:00 也在排期块里',
      String(rD.querySelector('.tf-note-sched').textContent).indexOf('7:00') >= 0,
      String(rD.querySelector('.tf-note-sched').textContent));
    ok('B3 不再有「主」标（段之间平等）', !rD.querySelector('.tf-view-seg-main'));
    ok('B4 不再有「另排」字样',
      String(rD.querySelector('.tf-note-sched').textContent).indexOf('另排') < 0);
    ok('B5 排期块头写「排期 · N 段」',
      /^排期\s*·\s*2\s*段$/.test(String(rD.querySelector('.tf-note-sched-label').textContent).trim()),
      String(rD.querySelector('.tf-note-sched-label').textContent));

    toggleTodoExpand('c88_e');
    ok('B7 单段也出现排期块，且只列一段（不再按段数换写法）',
      !!row('c88_e').querySelector('.tf-note-sched') && segCount('c88_e') === 1,
      String(segCount('c88_e')));

    toggleTodoExpand('c88_f');
    var rF = row('c88_f');
    ok('B8 主段不在当前查看日 → 出现排期块', !!rF.querySelector('.tf-note-sched'));
    ok('B9 跨天的段写完整年月日（yyyy-mm-dd 日期头，不是 MM/DD）',
      /\d{4}-\d{2}-\d{2}/.test(String(rF.querySelector('.tf-note-sched').textContent)) &&
      !!rF.querySelector('.tf-sched-day'),
      String(rF.querySelector('.tf-note-sched').textContent));

    toggleTodoExpand('c88_g');
    var rG = row('c88_g');
    var tG = appData.todos.filter(function (x) { return x.id === 'c88_g'; })[0];
    ok('B10 同起点只保留一段（数据层）',
      todoScheduleLines(tG, today, appData.settings, null, today).length === 1,
      String(todoScheduleLines(tG, today, appData.settings, null, today).length));
    ok('B11 同起点留下的是先写进去的那段',
      todoScheduleLines(tG, today, appData.settings, null, today)[0].end === 12 * 60);

    /* ---------- C 只读，不污染备注 ---------- */
    var tD = appData.todos.filter(function (x) { return x.id === 'c88_d'; })[0];
    ok('C1 排期块没有写进 detail', String(tD.detail || '') === '', JSON.stringify(tD.detail || ''));

    toggleTodoEdit('c88_d');
    var rD2 = row('c88_d');
    var ta = document.getElementById('todo_detail_c88_d');
    ok('C2 编辑态备注框里没有排期文字', !!ta && ta.value.indexOf('排期') < 0 && ta.value.indexOf('07:00') < 0,
      ta ? ta.value : 'no-textarea');
    /* 备注框下面不许再铺一行排期：标题行已有首段、下方「排期」栏还有 chips。 */
    ok('C3 编辑态备注框下不再重复排期', !rD2.querySelector('.tf-seg-hint'));
    ok('C4 排期只在下方「排期」栏以 chip 出现（两段两个）',
      rD2.querySelectorAll('.tf-chip--block').length === 2,
      String(rD2.querySelectorAll('.tf-chip--block').length));

    /* ---------- D 反证：有真实备注时，排期块与备注是两块内容 ---------- */
    var tB = appData.todos.filter(function (x) { return x.id === 'c88_b'; })[0];
    tB.detail = '老师要求：每天 7 点背书';
    tB.remindAt = today + ' 20:00';
    tB.estEnd = today + ' 21:00';
    tB.estEndManual = true;
    tB.extraBlocks = [{ start: today + ' 22:00', end: today + ' 23:00' }];
    expandedTodos = {};
    renderTodos();
    toggleTodoExpand('c88_b');
    var rB2 = row('c88_b');
    var noteTxt = String((rB2.querySelector('.tf-note-txt') || {}).textContent || '');
    var schedTxt = String((rB2.querySelector('.tf-note-sched') || {}).textContent || '');
    ok('D1 备注里是用户自己的字', noteTxt.indexOf('老师要求') >= 0, noteTxt);
    /* 时间写法随 12/24 小时制变（12 小时制下 22:00 显示成 10:00），
       所以这里断的是"有没有一段 HH:MM–HH:MM"，不是某个固定字符串。 */
    ok('D2 排期块里是时间区间', /\d{1,2}:\d{2}[–-]\d{1,2}:\d{2}/.test(schedTxt), schedTxt);
    ok('D3 备注里没有被塞进时间区间', !/\d{1,2}:\d{2}[–-]\d{1,2}:\d{2}/.test(noteTxt), noteTxt);
    ok('D4 排期块里没有混进备注原文', schedTxt.indexOf('老师要求') < 0);
  } finally {
    appData.todos = bTodos;
    expandedTodos = {};
    editingTodos = {};
    try { renderTodos(); } catch (e) { }
    try { saveData(); } catch (e2) { }
  }
  return JSON.stringify(R);
})();
