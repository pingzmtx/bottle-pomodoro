/* C33 的页面侧断言体（run_smoke 直接读这个文件执行，浏览器也能直跑同一份）。
   覆盖 2026-10-08 报的一批问题，都是「同一份事实存了两遍」的家族病：
     ① 每日总结的「完成任务」数 —— 以前数 appData.todos 里 done 的条数，
        可待办每天 0 点被自动清空 → 回看任何一天都是 0
     ② 「本轮」三个数字 —— 以前是自增计数器，删日志 / 改类型后不回落
     ③ 「仅记录」结算不给休息 —— 记账口径错当成了身体口径
     ④ 日志日历只能一月一月翻，翻不到去年
   全程用自造数据，**结束在 finally 里还原**（含 todos / round / records / todoDoneLog），
   断言抛异常也不把测试数据留在用户存储里。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var dayStr = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  /* ★ 日期一律相对「今天」推导（2026-10-21 修 P0-2 时间炸弹）。
     原来写死 new Date(2026, 9, 8)，配合下面的 logCalYear=2026 / logCalMonth=9，
     日历被钉在 2026 年 10 月；2026-11-01 起「今天那格」必然不在这一页，
     ④今天那格有高亮边框 恒定变红 —— 而且它红得毫无信息量（代码没坏，是日历翻页了）。 */
  var _TODAY = new Date();
  var at = function (h, m) {
    return new Date(_TODAY.getFullYear(), _TODAY.getMonth(), _TODAY.getDate(), h, m, 0, 0).getTime();
  };
  var bak = function (v) { return JSON.parse(JSON.stringify(v)); };
  var TODAY = getTodayStr();
  var YESTERDAY = dayStr(new Date(Date.now() - 864e5));
  var bk = {
    todos: bak(appData.todos), round: bak(appData.round), records: bak(appData.records),
    dl: bak(appData.todoDoneLog), lastCleanup: appData.lastTodoCleanupDate
  };
  /* 关掉落盘：这个页面只跑断言，不该把测试数据写进用户存档 */
  var _realSave = window._saveDataImmediate;
  try { window._saveDataImmediate = function () {}; } catch (e) {}

  try {
    /* ============ ① 每日总结的「完成任务」 ============ */
    appData.todos = [
      { id: 't1', title: '英语单词', done: false, subs: [], actualPomodoros: 0, timeSpent: 0 },
      { id: 't2', title: '数学订正', done: false, subs: [], actualPomodoros: 0, timeSpent: 0 }
    ];
    appData.todoDoneLog = {};
    toggleTodo('t1');
    ok('①勾选即写完成流水', todosDoneOn(TODAY) === 1);
    ok('①流水里存的是当时那条任务', (appData.todoDoneLog[TODAY] || []).every(function (x) { return !!x.title && !!x.ts; }));
    ok('①流水带 doneAt 便于跨天撤销', !!appData.todos[0].doneAt);
    /* 第二天待办被自动清空（checkNewDay 的行为）——完成流水必须不受影响 */
    appData.todos = [];
    ok('①待办清空后仍能回看昨天勾了几项', todosDoneOn(TODAY) === 1);
    /* 撤销：从流水里按 id 抹掉（跨天也要抹对那天） */
    var _t1 = { id: 't1', title: '英语单词', done: true, doneAt: new Date(TODAY + 'T10:00:00').getTime() };
    appData.todos = [_t1];
    toggleTodo('t1');
    ok('①取消勾选撤掉流水', todosDoneOn(TODAY) === 0);
    ok('①取消勾选清掉 doneAt', !_t1.doneAt);
    /* 每日总结读的必须是流水，不是「现在还剩几条 done」 */
    appData.todoDoneLog[TODAY] = [{ id: 'x1', title: 'A', ts: Date.now() }, { id: 'x2', title: 'B', ts: Date.now() }];
    appData.todos = [];
    var _box = document.getElementById('diarySummaryBox');
    if (typeof renderDailyFocusSummary === 'function') {
      try { renderDailyFocusSummary(); } catch (e) {}
    }
    /* innerText 对隐藏元素返回空串（总结卡在统计页，本页不可见），要用 textContent */
    var _txt = _box ? _box.textContent : '';
    /* textContent 里没有标签，数字紧贴在「✅ 完成任务」前面 */
    ok('①总结显示完成任务=2（待办列表已空）', /2✅\s*完成任务/.test(_txt.replace(/\s+/g, '')));

    /* ============ ② 「本轮」随记录变化 ============ */
    var R0 = at(9, 0);
    appData.round = { startTs: R0 };
    appData.records = [
      { id: 'r1', taskName: '数学', type: 'full', startTime: R0 + 25 * 6e4, endTime: R0 + 50 * 6e4, pomos: 1 },
      { id: 'r2', taskName: '数学', type: 'incomplete', startTime: R0 + 60 * 6e4, endTime: R0 + 70 * 6e4, pomos: 0 }
    ];
    updateRoundStats();
    /* ★ 2026-10-30：不再对文案里的 emoji/分隔符做正则 —— UI 早就把「完整🍅 1」
       换成了「完整 1 ·」（去掉番茄图标、竖线改中圆点），正则一改文案就假红。
       改读三个带类名的 span 的数字：文案随便改，断言只认口径。
       另外空态会 display:none，此时读 class 也为 null —— 当作 0。 */
    var _n = function (cls) {
      var el = document.querySelector('#roundStatsLine .' + cls);
      if (!el) return 0;
      var m = String(el.textContent).match(/-?\d+/);
      return m ? Number(m[0]) : 0;
    };
    var _st = function () {
      return { full: _n('full'), half: _n('half'), incomplete: _n('incomplete') };
    };
    var _line = function () {
      var t = _st();
      return '完整 ' + t.full + '·半个 ' + t.half + '·未完成 ' + t.incomplete;
    };
    ok('②完整 1 / 未完成 1：' + _line(), _st().full === 1 && _st().incomplete === 1);
    /* 删掉那条未完成 —— 这正是用户报的现象（还剩 1 条却显示 4） */
    appData.records = appData.records.filter(function (r) { return r.id !== 'r2'; });
    updateRoundStats();
    ok('②删掉日志后未完成归零：' + _line(), _st().incomplete === 0);
    /* 把完整改成半个，两个数字都要跟着动 */
    appData.records[0].type = 'half';
    updateRoundStats();
    ok('②改类型后完整=0 半个=1：' + _line(), _st().full === 0 && _st().half === 1);
    /* 起点之前的记录不算本轮 */
    appData.records.push({ id: 'r3', taskName: '旧', type: 'full', startTime: R0 - 3600 * 1000, endTime: R0 - 3000 * 1000, pomos: 1 });
    updateRoundStats();
    ok('②起点前的记录不计入本轮：' + _line(), _st().full === 0);
    /* 「仅记录」既不算专注也不算未完成 */
    appData.records = [{ id: 'r4', taskName: '配眼镜', type: 'log', startTime: R0 + 6e4, endTime: R0 + 3660 * 1000, pomos: 0 }];
    updateRoundStats();
    ok('②仅记录不进本轮任何一格：' + _line(),
      _st().full === 0 && _st().half === 0 && _st().incomplete === 0);
    ok('②本轮起点记在 round.startTs', typeof appData.round.startTs === 'number');
    /* 老版本存档（round 里只有三个计数器）加载后必须有 startTs，否则本轮会算成全部历史 */
    var _legacy = { full: 3, half: 1, incomplete: 2, lastFullEndTime: Date.now() };
    appData.round = _legacy;
    ensureRoundShape();
    ok('②老存档的 round 被补成 startTs', typeof appData.round.startTs === 'number' && !('full' in appData.round));

    /* ============ ③ 「仅记录」结算后也要进休息 ============ */
    appData.records = [];
    timerState.mode = 'focus';
    timerState.running = false;
    window._settleCollecting = false;
    appData.settings.immersiveFocus = false;
    try {
      savePomodoroRecord('log');
    } catch (e) {
      ok('③「仅记录」落库不抛异常：' + e.message, false);
    }
    ok('③「仅记录」落库后记录数为 1', appData.records.length === 1 && appData.records[0].type === 'log');

    /* ============ ④ 日志日历能切年份 ============ */
    openLogCalendar();
    var _y0 = logCalYear;
    var _title = document.getElementById('logCalTitle').textContent;
    ok('④日历标题先显示年月：' + _title, /\d{4}年\d{1,2}月/.test(_title));
    changeLogCalYear(-1);
    ok('④点「上年」年份 -1', logCalYear === _y0 - 1);
    ok('④标题跟着换：' + document.getElementById('logCalTitle').textContent, document.getElementById('logCalTitle').textContent.indexOf((_y0 - 1) + '年') === 0);
    changeLogCalYear(1);
    ok('④点「下年」年份 +1', logCalYear === _y0);
    /* 面板：12 个月一步跳到 */
    _logCalJumpOpen = false;
    toggleLogCalJump();
    var _panel = document.getElementById('logCalJump');
    ok('④点标题展开年月面板', _panel && _panel.style.display === 'block');
    ok('④面板里 12 个月都在', document.getElementById('logCalJumpMonths').querySelectorAll('button').length === 12);
    ok('④面板显示当前年份', document.getElementById('logCalJumpYear').textContent.indexOf(String(logCalYear)) === 0);
    logCalJumpMonth(3);
    ok('④点「3月」直接跳过去', logCalMonth === 2);
    ok('④跳完自动收起面板', _panel.style.display === 'none');
    /* 打点口径：只补记了「仅记录」的日子也要在日历上有标记。
       记录与日历都跟着「今天」走，所以下面找格子时直接用 _todayDs（见上）。 */
    appData.records = [{ id: 'c1', taskName: '配眼镜', type: 'log', startTime: at(11, 0), endTime: at(12, 0), pomos: 0 }];
    var _todayDs = getTodayStr();
    logCalYear = _TODAY.getFullYear();
    logCalMonth = _TODAY.getMonth();
    renderLogCalendar();
    var _cells = document.getElementById('logCalGrid').querySelectorAll('div[onclick],div[data-act]');
    var _day8 = null;
    for (var i = 0; i < _cells.length; i++) {
      if (((_cells[i].getAttribute('onclick') || '') + (_cells[i].getAttribute('data-act-args') || '')).indexOf("'" + _todayDs + "'") >= 0) _day8 = _cells[i];
    }
    /* 2026-10-17 改：日历从「一个红点」升级为「当天条数」（十年后想知道那天做了多少，
       一个点说不清）。所以这里断言格子带数字，而不是断言 ●。 */
    ok('④仅记录的日子在日历上标出条数', !!_day8 && /\d/.test(_day8.textContent));
    /* 2026-10-17 修：这条断言名叫「今天」，却在查固定日期那格 —— 而边框只给今天画
       （renderLogCalendar 的 isToday 分支）。名字和行为对不上 = 一条已经在骗人的绿灯。
       现在真的去找今天那格；日历停在「今天所在的年月」，今天必在这一页里。 */
    var _todayCell = null;
    for (var i2 = 0; i2 < _cells.length; i2++) {
      if (((_cells[i2].getAttribute('onclick') || '') + (_cells[i2].getAttribute('data-act-args') || '')).indexOf("'" + _todayDs + "'") >= 0) _todayCell = _cells[i2];
    }
    ok('④今天那格有高亮边框', !!_todayCell && (_todayCell.getAttribute('style') || '').indexOf('1px solid') >= 0);
    closeModal('logCalendarModal');

    /* ============ ⑤ 计划列表能正常渲染（回归：_todayKey 未定义） ============ */
    appData.todos = [
      { id: 'p1', title: '英语单词 Unit3', done: false, detail: '看错词本', pomodoros: 2, subs: [{ id: 's1', title: '单词表', done: true }], actualPomodoros: 1, timeSpent: 1500, tag: '英语', deadline: '2026-10-10', remindAt: null },
      { id: 'p2', title: '数学订正', done: false, detail: '', pomodoros: 3, subs: [], actualPomodoros: 0, timeSpent: 0, tag: '数学', deadline: null, remindAt: '2026-10-08 20:00' }
    ];
    var _err = null;
    try { _todoSig = ''; renderTodos(); } catch (e) { _err = e; }
    ok('⑤任务列表渲染不抛异常' + (_err ? '：' + _err.message : ''), !_err);
    ok('⑤任务都渲染出来了', document.querySelectorAll('#todoList .todo-item').length === 2);
  } finally {
    /* 还原：不管上面挂在哪一条，用户数据都要回到原样 */
    appData.todos = bk.todos;
    appData.round = bk.round;
    appData.records = bk.records;
    appData.todoDoneLog = bk.dl;
    appData.lastTodoCleanupDate = bk.lastCleanup;
    try { window._saveDataImmediate = _realSave; } catch (e) {}
    try { _todoSig = ''; renderTodos(); updateRoundStats(); } catch (e) {}
  }
  return JSON.stringify(R);
})()