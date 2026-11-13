/* C56 日程网格：两次点击新建计划

   点起始格 → 再点结束格 → 打开「新增计划」并预填起止；点同一格两次 = 取消。
   网格上的说明是**一行折叠文字**（复用设置页 toggleNote + .setting-note-*），默认收起。

   防假绿：
     - 网格默认收起，格子 display:none —— 用例必须先展开，否则点不中也读不到几何。
     - 说明行由 01eM 包装 renderTimeBlockGrid 后**同步**补插，所以渲染后立刻断言即可，
       不依赖异步回调（这条同时锁住"补插别改成异步"）。
     - 「点两格」绝不写数据：断言 appData.todos 长度不变，
       防止把它做成"点一下就落盘一条空计划"。
     - ④ 比较两轮预填的🍅数时，必须先把上一轮的值取出来存着 ——
       弹窗是同一个 DOM，连着读两次拿到的是同一个值。
     - ⑦ 结束格右缘规则必须**四向都测**：末格（:50 格）、中间格、跨小时下一钟点第一格、
       起点末格，另加「点两格 = 20 分钟」—— 防止把规则写回条件式
       "只修 :50 末格"（那会漏掉其余结束格，每格仍少 10 分钟）。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  function $(s) { return document.querySelector(s); }
  function byId(id) { return document.getElementById(id); }
  function cellsAt(min) {
    return document.querySelectorAll('#tbGridWrap .tb-paper-cell[data-tb-min="' + min + '"]');
  }
  /* 新增弹窗里的排期草稿 */
  function draft() {
    return (typeof window.tbDraftExtraBlocks === 'function' ? window.tbDraftExtraBlocks() : []) || [];
  }
  function isOpen(id) {
    var el = byId(id);
    return !!el && getComputedStyle(el).display !== 'none';
  }
  var _fold = null, _todosLen = 0, round1Pomos = 0;
  try {
    /* ⓪ 前置：计划页 + 展开网格 */
    if (typeof switchView === 'function') switchView('plan');
    _fold = appData.settings.tbGridFolded;
    appData.settings.tbGridFolded = false;
    if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
    _todosLen = (appData.todos || []).length;

    var shell = byId('tbShell');
    ok('⓪1 网格已展开（用例前提）', !!shell && !shell.classList.contains('is-folded'));
    ok('⓪2 背景格已渲染', document.querySelectorAll('#tbGridWrap .tb-paper-cell').length > 0);
    ok('⓪3 格子带 data-tb-min（新建计划的定位依据）', cellsAt(540).length > 0);

    /* ① 说明行：一行折叠文字，不是提示框 */
    var noteBox = $('#tbGridWrap .tb-create-note');
    var noteToggle = noteBox ? noteBox.querySelector('.setting-note-toggle') : null;
    var noteBody = noteBox ? noteBox.querySelector('.setting-note-content') : null;
    ok('①1 网格上有一行折叠说明', !!noteToggle && !!noteBody);
    ok('①2 说明默认收起（页面上只有一行文字）', !!noteBody && !noteBody.classList.contains('show'));
    ok('①3 复用的是设置页那套说明组件',
      !!noteToggle && noteToggle.classList.contains('setting-note-toggle'));
    if (noteToggle) noteToggle.click();
    ok('①4 点开后展开', !!noteBody && noteBody.classList.contains('show'));
    if (noteToggle) noteToggle.click();
    ok('①5 再点收回', !!noteBody && !noteBody.classList.contains('show'));
    /* toggleNote 会把自己的文字改写成「展开 / 收起说明」——
       引导语必须独立成元素，否则用户点一次就再也看不到「点两格」这句提示。 */
    var hint = noteBox ? noteBox.querySelector('.tb-create-hint') : null;
    ok('①6 引导语收在折叠内容里（不在外面另占一行）',
      !!noteBody && String(noteBody.textContent).indexOf('想给某段时间排计划') >= 0);
    ok('①7 开关外没有第二个常驻元素（整行就是折叠开关自己）',
      !!noteBox && !noteBox.querySelector('.tb-create-hint'));

    /* ② 两次点击：起点高亮 → 终点 → 打开弹窗并预填 */
    var c1 = cellsAt(540)[0];   /* 09:00 */
    ok('②1 09:00 的格子存在', !!c1);
    if (c1) c1.click();
    var picked = document.querySelectorAll('#tbGridWrap .tb-paper-cell.is-tb-pick');
    ok('②2 点第一格后出现起点高亮', picked.length > 0);
    /* ②3 语义改过一次：原来按 data-tb-min 把同分钟「预计/实际」两列一起点亮（想连成竖条），
       用户实测观感是「点一格、旁边并排多出一个红框，像出了 bug」——
       现在只亮所点的那一列（lane 相同）。 */
    ok('②3 高亮只亮所点的那一列（不并排点亮实际列）',
       picked.length === 1 && picked[0].getAttribute('data-tb-lane') === '0');

    var c2 = cellsAt(630)[0];   /* 10:30 */
    if (c2) c2.click();
    ok('②4 点第二格后打开「新增计划」', isOpen('addTodoModal'));
    var today = typeof getTodayStr === 'function' ? getTodayStr() : '';
    var d1 = draft();
    ok('②5 排期草稿里出现 09:00 起的一段',
      d1.length === 1 && d1[0].start === today + ' 09:00', JSON.stringify(d1));
    var pz = byId('addTodoPomodoros');
    round1Pomos = pz ? Number(pz.value) : 0;
    ok('②6 预计🍅按点击时长反推填入', round1Pomos > 0);
    ok('②7 这一段的结束晚于起点', d1.length === 1 && d1[0].end > d1[0].start, JSON.stringify(d1));
    ok('②8 建完高亮已清',
      document.querySelectorAll('#tbGridWrap .tb-paper-cell.is-tb-pick').length === 0);

    /* ③ 同格两次 = 取消，且全程不写数据 */
    if (typeof closeModal === 'function') closeModal('addTodoModal');
    var c3 = cellsAt(600)[0];
    if (c3) { c3.click(); c3.click(); }
    ok('③1 同格点两次后没有残留高亮',
      document.querySelectorAll('#tbGridWrap .tb-paper-cell.is-tb-pick').length === 0);
    ok('③2 同格两次不会打开弹窗', !isOpen('addTodoModal'));
    ok('③3 点击全程不写数据（没有凭空冒出计划）',
      (appData.todos || []).length === _todosLen);

    /* ④ 跨上下两排也能连成区间（分钟数是当天连续值） */
    var up = cellsAt(540)[0], down = cellsAt(960)[0];   /* 09:00 → 16:00 */
    if (up && down) { up.click(); down.click(); }
    var d4 = draft();
    ok('④1 跨排选择仍以先点的那格为起点',
      d4.length === 1 && d4[0].start === today + ' 09:00', JSON.stringify(d4));
    var pz2 = byId('addTodoPomodoros');
    ok('④2 跨排时长更久 → 预填的🍅更多',
      !!pz2 && Number(pz2.value) > round1Pomos);
    if (typeof closeModal === 'function') closeModal('addTodoModal');

    /* ⑤ 重画即清：切日期/刷新列表后，旧起点不再成立 */
    var c5 = cellsAt(540)[0];
    if (c5) c5.click();
    var before = document.querySelectorAll('#tbGridWrap .tb-paper-cell.is-tb-pick').length;
    if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
    var after = document.querySelectorAll('#tbGridWrap .tb-paper-cell.is-tb-pick').length;
    ok('⑤1 重画前有高亮、重画后清空', before > 0 && after === 0);
    ok('⑤2 重画后说明行仍在（跟着一起补回来）', !!$('#tbGridWrap .tb-create-note'));

    /* ⑥ 点两格定的时段必须**落在计划上**：保存不被「提醒 + 🍅」反算顶掉，
       且手改结束时间会反算番茄数 —— 用户实测的三个 bug 的固化断言。 */
    var todosBak2 = JSON.stringify(appData.todos || []);
    var settingsBak2 = JSON.stringify(appData.settings || {});
    try {
      appData.settings = Object.assign({}, appData.settings,
        { workDuration: 25, shortBreak: 5, longBreak: 20, longInterval: 4 });
      var s1 = cellsAt(600)[0], s2 = cellsAt(720)[0];   /* 10:00 → 12:00 */
      if (s1 && s2) { s1.click(); s2.click(); }
      var d6 = draft(), pz6 = byId('addTodoPomodoros');
      ok('⑥1 草稿段的结束 = 结束格右缘 12:10（10:00 点到 12:00 那格 = 130 分钟）',
         d6.length === 1 && d6[0].end === today + ' 12:10', JSON.stringify(d6));
      ok('⑥2 130 分钟换算出了番茄数', !!pz6 && Number(pz6.value) > 0);
      var titleEl6 = byId('addTodoTitle');
      if (titleEl6) titleEl6.value = 'C56-时段';
      if (typeof confirmAddTodo === 'function') confirmAddTodo();
      var t6 = (appData.todos || []).filter(function (x) { return x.title === 'C56-时段'; })[0];
      ok('⑥3 保存后 blocks 里就是这一段（10:00–12:10）',
         !!t6 && (t6.blocks || []).length === 1 &&
         t6.blocks[0].start === today + ' 10:00' && t6.blocks[0].end === today + ' 12:10',
         JSON.stringify(t6 && t6.blocks));
      ok('⑥4 保存后第一段与网格同一口径',
         !!t6 && todoEstInfo(t6, appData.settings).start === today + ' 10:00');
      ok('⑥5 提醒没有被排期顶掉（仍是独立字段，这里是空）',
         !!t6 && !t6.remindAt, t6 && String(t6.remindAt));
    } finally {
      try { appData.todos = JSON.parse(todosBak2); } catch (e7) { appData.todos = []; }
      try { appData.settings = JSON.parse(settingsBak2); } catch (e8) {}
      try { if (typeof renderTodos === 'function') renderTodos(); saveData(); } catch (e9) {}
    }

    /* ⑦ 结束格**右缘**规则：背景格是 10 分钟容器，data-tb-min 只记左缘，
       点选结束格的意思是「时段涂到这一格」——**结束格自己也计入时长**。
       所以结束预填 = 结束格左缘 + 10（无条件），点 N 格就是 N×10 分钟。
       ★ 条件式（仅 :50 末格 +10）是错的：中间格同样少 10 分钟，本段全部用例
         就是钉住这条规则不许退化成条件式。
       ★ 起点永远取左缘（7:50 格就是从 7:50 开始）。
       ★ 想选整小时请点到「XX:50 那一格」——末格右缘恰是下一整点。 */
    var todosBak3 = JSON.stringify(appData.todos || []);
    try {
      /* 点两格：07:00 → 07:10 第二格 = 20 分钟（两格都算） */
      var u1 = cellsAt(420)[0], u2 = cellsAt(430)[0];
      if (u1 && u2) { u1.click(); u2.click(); }
      var d7u = draft(), pz7u = byId('addTodoPomodoros');
      ok('⑦1 点两格（07:00 → 07:10 格）这一段是 07:00–07:20（两格都算）',
         d7u.length === 1 && d7u[0].end === today + ' 07:20', JSON.stringify(d7u));
      ok('⑦2 20 分钟 = 半个番茄（0.5 粒度）',
         !!pz7u && Number(pz7u.value) === 0.5);
      if (typeof closeModal === 'function') closeModal('addTodoModal');
      /* 末格：07:00 → 07:50 格 = 6 格 = 60 分钟，右缘恰是整点 */
      var e1 = cellsAt(420)[0], e2 = cellsAt(470)[0];   /* 07:00 → 07:50 格（小时末格） */
      if (e1 && e2) { e1.click(); e2.click(); }
      var d7 = draft(), pz7 = byId('addTodoPomodoros');
      ok('⑦3 结束格是小时末格（:50）时结束取右缘 08:00（不是左缘 07:50）',
         d7.length === 1 && d7[0].end === today + ' 08:00', JSON.stringify(d7));
      ok('⑦4 60 分钟 = 2🍅',
         !!pz7 && Number(pz7.value) === 2);
      if (typeof closeModal === 'function') closeModal('addTodoModal');
      /* 中间格：与末格同一条规则，不再是例外 */
      var m1 = cellsAt(540)[0], m2 = cellsAt(630)[0];   /* 09:00 → 10:30 中间格 */
      if (m1 && m2) { m1.click(); m2.click(); }
      var d7b = draft();
      ok('⑦5 中间格结束也取右缘 10:40（不再只修末格）',
         d7b.length === 1 && d7b[0].end === today + ' 10:40', JSON.stringify(d7b));
      if (typeof closeModal === 'function') closeModal('addTodoModal');
      /* 跨小时：点下一钟点第一格，那一格同样计入 */
      var x1 = cellsAt(960)[0], x2 = cellsAt(1020)[0];  /* 16:00 → 17:00 跨小时 */
      if (x1 && x2) { x1.click(); x2.click(); }
      var d7c = draft();
      ok('⑦6 跨小时点下一小时第一格结束取右缘 17:10（16:00–17:10 = 70 分钟）',
         d7c.length === 1 && d7c[0].end === today + ' 17:10', JSON.stringify(d7c));
      if (typeof closeModal === 'function') closeModal('addTodoModal');
      /* 起点末格：起点不修正（取左缘），结束格照常取右缘 */
      var s1b = cellsAt(470)[0], s2b = cellsAt(480)[0];  /* 07:50 末格 → 08:00 */
      if (s1b && s2b) { s1b.click(); s2b.click(); }
      var d7d = draft();
      ok('⑦7 起点是末格时起点仍取左缘 07:50，结束取右缘 08:10',
         d7d.length === 1 && d7d[0].start === today + ' 07:50' && d7d[0].end === today + ' 08:10',
         JSON.stringify(d7d));
    } finally {
      try { if (typeof closeModal === 'function') closeModal('addTodoModal'); } catch (e10) {}
      try { appData.todos = JSON.parse(todosBak3); } catch (e11) { appData.todos = []; }
      try { if (typeof renderTodos === 'function') renderTodos(); saveData(); } catch (e12) {}
    }
  } catch (e) {
    R.push(['⚠️ 用例抛异常：' + (e && e.message ? e.message : e), false]);
  } finally {
    try { if (typeof closeModal === 'function') closeModal('addTodoModal'); } catch (e2) {}
    try {
      if (_fold !== null) { appData.settings.tbGridFolded = _fold; renderTimeBlockGrid(); }
    } catch (e3) {}
  }
  return JSON.stringify(R);
})();
