/* C77 多段排期：一条计划可以有几段时间

   起没有「主段 / 另排」之分：
     · 排期是 t.blocks（全部段，平等）；提醒是 t.remindAt，两者互不影响。
   本用例锁住：
     A 数据：加段 / 删段 / 校验（重叠、太短、跨日）
     B 渲染：几段就画几个块；折叠态列出全部段（不用展开）
     C 生命周期：一次性计划过期 → 先快照再清段；重复计划 → 整组平移到今天
     D 反证：删掉一段后，网格里那个块确实消失 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function todoById(id) {
    return (appData.todos || []).filter(function (x) { return String(x.id) === String(id); })[0];
  }
  function blocksOf(id) {
    var t = todoById(id);
    return (t && t.blocks) || [];
  }
  function gridBlocks(id) {
    return document.querySelectorAll('.tb-paper-blk[data-tb-id="' + id + '"]');
  }

  var today = getTodayStr();
  var yest = addDaysStr(today, -1);
  var bTodos = appData.todos.slice();
  var bFold = appData.settings.tbGridFolded;

  try {
    switchView('plan');
    appData.settings.tbGridFolded = false;

    /* ---------- A 数据 ---------- */
    appData.todos = [{ id: 'c77_a', title: 'C77多段', done: false, pomodoros: 1, subs: [], repeat: '', tag: '' }];
    var r1 = todoAddBlock('c77_a', today, 7 * 60, 8 * 60);
    ok('A1 第一段加得进去', r1.ok === true, JSON.stringify(r1));
    ok('A2 落盘到 blocks', blocksOf('c77_a').length === 1);
    ok('A3 段的时间正确',
      blocksOf('c77_a')[0].start === today + ' 07:00' && blocksOf('c77_a')[0].end === today + ' 08:00',
      JSON.stringify(blocksOf('c77_a')));

    var r2 = todoAddBlock('c77_a', today, 15 * 60, 16 * 60);
    ok('A4 不重叠的第二段加得进去', r2.ok === true && blocksOf('c77_a').length === 2);
    ok('A5 两段按时间排序', blocksOf('c77_a')[0].start < blocksOf('c77_a')[1].start);

    var r3 = todoAddBlock('c77_a', today, 7 * 60 + 30, 9 * 60);
    ok('A6 与已有段重叠 → 拒绝', r3.ok === false && r3.reason === 'overlap', JSON.stringify(r3));
    ok('A7 被拒绝时数据不变', blocksOf('c77_a').length === 2);

    var r4 = todoAddBlock('c77_a', today, 20 * 60, 20 * 60 + 5);
    ok('A8 不足 10 分钟 → 拒绝', r4.ok === false && r4.reason === 'short', JSON.stringify(r4));

    var r5 = todoAddBlock('c77_a', today, 23 * 60, 24 * 60);
    ok('A9 跨天（到 24:00）→ 拒绝', r5.ok === false, JSON.stringify(r5));

    var delKey = blocksOf('c77_a')[0].start;
    ok('A10 删段成功', todoRemoveBlock('c77_a', delKey) === true);
    ok('A11 删完只剩一段', blocksOf('c77_a').length === 1);
    ok('A12 再删同一段 → false（不静默成功）', todoRemoveBlock('c77_a', delKey) === false);

    /* ---------- B 渲染 ---------- */
    appData.todos = [{
      id: 'c77_b', title: 'C77渲染', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
      blocks: [
        { start: today + ' 07:00', end: today + ' 08:00' },
        { start: today + ' 15:00', end: today + ' 16:00' }
      ]
    }];
    expandedTodos = {};
    editingTodos = {};
    renderTodos();
    renderTimeBlockGrid();

    ok('B1 网格里画了两个块', gridBlocks('c77_b').length === 2, String(gridBlocks('c77_b').length));
    ok('B2 数据层也是两块', tbBlocksOf(todoById('c77_b'), appData.settings, today).length === 2);

    var row = document.querySelector('.todo-item[data-id="c77_b"]');
    var line = row ? row.querySelector('.todo-extra-line') : null;
    ok('B3 折叠态直接列出排期（不用展开）', !!line);
    ok('B4 折叠态那一行含时间段',
      !!line && /\d{1,2}:\d{2}[–-]\d{1,2}:\d{2}/.test(String(line.textContent)),
      line ? String(line.textContent) : '');
    ok('B5 折叠态不写「N 段」', !!line && String(line.textContent).indexOf('段') < 0);

    toggleTodoExpand('c77_b');
    var row2 = document.querySelector('.todo-item[data-id="c77_b"]');
    var schedTxt = row2.querySelector('.tf-note-sched') ? String(row2.querySelector('.tf-note-sched').textContent) : '';
    /* ★ 需求 10-19 改口径：多段时标题行不再兼职印首段（以前印成「⏰ 8:20~9:00」，
       看着像提醒时间，另一段孤零零待在排期区 → 「它只给我显示一个排期」）。
       现在按段数分工：1 段 → 标题行印；多段 → 标题行不印，排期区列**全部**段。 */
    ok('B6 展开态排期块列出全部段', row2.querySelectorAll('.tf-view-seg').length === 2,
      String(row2.querySelectorAll('.tf-view-seg').length));
    ok('B6b 首段 7:00 也在排期块里（不再只印在标题行）', schedTxt.indexOf('7:00') >= 0, schedTxt);
    ok('B6c 多段时标题行不重复印首段', String(row2.querySelector('.todo-title-row').textContent).replace(/\s/g, '').indexOf('7:00') < 0,
      String(row2.querySelector('.todo-title-row').textContent));
    ok('B7 段之间没有「主 / 另排」标签', schedTxt.indexOf('主') < 0 && schedTxt.indexOf('另排') < 0, schedTxt);

    /* 单段：和「多段」走**同一个出口**。
       以前单段印标题行、多段印排期区，同一份信息两种写法 —— 需求把 🕒 认成了实际完成时间。 */
    appData.todos = [{
      id: 'c77_s', title: 'C77单段', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
      blocks: [{ start: today + ' 09:00', end: today + ' 10:00' }]
    }];
    expandedTodos = {};
    renderTodos();
    var rowS = document.querySelector('.todo-item[data-id="c77_s"]');
    var titleS = rowS ? String(rowS.querySelector('.todo-title-row').textContent).replace(/\s/g, '') : '';
    /* 折叠态用的是精简行（.todo-extra-line），展开态才是 .tf-note-sched —— 两者是同一个出口的两种密度 */
    var schedS = rowS && rowS.querySelector('.todo-extra-line') ? String(rowS.querySelector('.todo-extra-line').textContent).replace(/\s/g, '') : '';
    ok('B8 单段也走「排期」行（折叠态就是这一行，不再印在标题行）', /9:00[–~-]10:00/.test(schedS), schedS);
    ok('B8b 单段时标题行不印时段（不再有 🕒 这个"像实际时间"的图标）',
      titleS.indexOf('9:00') < 0 && titleS.indexOf('🕒') < 0 && titleS.indexOf('⏰') < 0, titleS);

    /* ---------- C 生命周期 ---------- */
    appData.todos = [{
      id: 'c77_c', title: 'C77过期', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
      remindAt: yest + ' 07:00', deadline: yest + ' 22:00',
      blocks: [{ start: yest + ' 07:00', end: yest + ' 08:00' }]
    }];
    appData.todoSchedLog = {};
    clearStaleOneOffSchedule(today);
    ok('C1 过期的一次性计划：段被清空', blocksOf('c77_c').length === 0);
    ok('C2 清之前写了快照', !!(appData.todoSchedLog[yest] || []).filter(function (x) {
      return String(x.id) === 'c77_c';
    })[0]);
    ok('C3 过期的提醒也一起清', !todoById('c77_c').remindAt);
    /* ★ 2026-10-21：清排期**不连坐截止日**。原来这里会把 deadline 写成 null，
       于是「这活本来 20 号要交」永远查不到 —— 逾期信息是用户自己的历史。
       谁把 deadline 抹回 null，这条先红。 */
    ok('C3b 过期的截止日保留（不再被静默抹成 null）',
      String(todoById('c77_c').deadline || '') === yest + ' 22:00',
      String(todoById('c77_c').deadline));

    var tRep = {
      id: 'c77_d', title: 'C77重复', done: true, doneAt: Date.now(), pomodoros: 1, subs: [],
      tag: '', repeat: { mode: 'daily', last: yest, next: today },
      blocks: [
        { start: yest + ' 07:00', end: yest + ' 08:00' },
        { start: yest + ' 15:00', end: yest + ' 16:00' }
      ]
    };
    appData.todos = [tRep];
    resetTodoOccurrence(tRep, today, tRep.repeat);
    ok('C4 重复计划复位后仍是两段', (tRep.blocks || []).length === 2, JSON.stringify(tRep.blocks));
    ok('C5 两段都平移到今天',
      tRep.blocks[0].start.slice(0, 10) === today && tRep.blocks[1].start.slice(0, 10) === today,
      JSON.stringify(tRep.blocks));
    ok('C6 钟点不变',
      tRep.blocks[0].start.slice(11) === '07:00' && tRep.blocks[1].start.slice(11) === '15:00');
    ok('C7 复位后父任务回到未完成', tRep.done === false);

    /* ---------- D 反证 ---------- */
    appData.todos = [{
      id: 'c77_e', title: 'C77反证', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
      blocks: [
        { start: today + ' 07:00', end: today + ' 08:00' },
        { start: today + ' 15:00', end: today + ' 16:00' }
      ]
    }];
    expandedTodos = {};
    renderTodos();
    renderTimeBlockGrid();
    ok('D1 反证：删一段前有两个块', gridBlocks('c77_e').length === 2, String(gridBlocks('c77_e').length));
    todoRemoveBlock('c77_e', today + ' 15:00');
    renderTodos();
    renderTimeBlockGrid();
    ok('D2 反证：删掉一段后只剩一个块', gridBlocks('c77_e').length === 1, String(gridBlocks('c77_e').length));
    ok('D3 反证：留下的是没删的那段', blocksOf('c77_e')[0].start === today + ' 07:00');
  } finally {
    appData.todos = bTodos;
    appData.settings.tbGridFolded = bFold;
    expandedTodos = {};
    try { renderTodos(); } catch (e) { }
    try { renderTimeBlockGrid(); } catch (e2) { }
    try { saveData(); } catch (e3) { }
  }
  return JSON.stringify(R);
})();
