/* C94 重复计划「下次重复时，子任务」三档
   「我本来想的是三个，一个是整条清空重新列，还有一个是
   清除已完成的、只保留那个未完成的，还有一个就是所有的全部回到未完成状态」。
   三档必须**互相区分**（不是三句同义文案）：
     reset     —— 清单不动，勾选清零（默认，老存档没有字段也落到这档）
     clearDone —— 已完成的删掉，未完成的留下（进度继承）
     clear     —— 子任务整条清掉
   ★ 这组断言的重点是"三档结果两两不同"，任何一档退化成别的都会红。 */
(function () {
  var R = [];
  var ok = function (name, cond, extra) { R.push([name + (extra !== undefined && extra !== '' ? ' :: ' + extra : ''), !!cond]); };
  var today = typeof getTodayStr === 'function' ? getTodayStr() : '2026-10-19';
  var mk = function (mode) {
    return {
      id: 'c94_' + (mode || 'none'), title: 'C94' + mode, done: true, pomodoros: 1, subs: [
        { id: 1, title: '甲', done: true },
        { id: 2, title: '乙', done: false },
        { id: 3, title: '丙', done: false }
      ],
      repeat: { mode: 'daily', last: today, next: today, subsMode: mode }
    };
  };
  var run = function (mode) {
    var t = mk(mode);
    resetTodoOccurrence(t, today, t.repeat);
    return t.subs.map(function (s) { return s.title + (s.done ? '✓' : ''); });
  };
  try {
    /* ---------- A 三档行为互不相同 ---------- */
    var aReset = run('reset'), aDone = run('clearDone'), aClear = run('clear');
    ok('A1 reset：清单不变、勾选清零', JSON.stringify(aReset) === JSON.stringify(['甲', '乙', '丙']), aReset.join(','));
    ok('A2 clearDone：已完成的删掉，未完成的留下', JSON.stringify(aDone) === JSON.stringify(['乙', '丙']), aDone.join(','));
    ok('A3 clear：子任务整条清空', aClear.length === 0, aClear.join(','));
    ok('A4 三档结果两两不同（不是三句同义文案）',
      JSON.stringify(aReset) !== JSON.stringify(aDone) && JSON.stringify(aDone) !== JSON.stringify(aClear) && JSON.stringify(aReset) !== JSON.stringify(aClear),
      aReset.join(',') + ' / ' + aDone.join(',') + ' / ' + aClear.join(','));

    /* ---------- B 老存档 / 脏值落到 reset ---------- */
    ok('B1 没有 subsMode 字段 → reset（最不破坏内容的那档）',
      (function () { var t = mk(undefined); delete t.repeat.subsMode; resetTodoOccurrence(t, today, t.repeat); return t.subs.length === 3; })());
    ok('B2 脏值 → reset',
      (function () { var t = mk('whatever'); resetTodoOccurrence(t, today, t.repeat); return t.subs.length === 3; })());
    ok('B3 normTodoRepeat 接受 clearDone', (function () {
      var r = normTodoRepeat({ mode: 'daily', subsMode: 'clearDone' });
      return r && r.subsMode === 'clearDone';
    })());
    ok('B4 normTodoRepeat 脏值归一成 reset',
      (function () { var r = normTodoRepeat({ mode: 'daily', subsMode: 'xx' }); return r && r.subsMode === 'reset'; })());

    /* ---------- C clearDone 只动"已完成"，其余字段不许丢 ---------- */
    ok('C1 clearDone 留下的子任务不带 done 字段（本来就是未完成）',
      (function () { var t = mk('clearDone'); resetTodoOccurrence(t, today, t.repeat); return t.subs.every(function (s) { return !s.done; }); })());
    ok('C2 clearDone 不新增子任务（只删不增）',
      (function () { var t = mk('clearDone'); var n0 = t.subs.length; resetTodoOccurrence(t, today, t.repeat); return t.subs.length < n0; })());

    /* ---------- D UI：下拉三档 + 选中态 ---------- */
    var todosBak = JSON.stringify(appData.todos);
    try {
      appData.todos = [mk('clearDone')];
      appData.todos[0].id = 'c94_ui';
      /* ★ 必须 done:false：mk() 造的是"已完成待复位"的任务，而列表里已完成的分组
         在部分设置下不展开/不渲染卡片 → 下拉根本不存在。 */
      appData.todos[0].done = false;
      /* ★ 必须走真实 UI 入口：设置面板（含重复设置）只在 expanded + editing 两个
         状态同时成立时才渲染，而这两个状态分别由 toggleTodoExpand / toggleTodoEdit 维护。
         直接赋值 expandedTodos/editingTodos 会在收起态渲染出一个空面板。 */
      renderTodos();
      toggleTodoExpand('c94_ui');
      toggleTodoEdit('c94_ui');
      var card = document.querySelector('.todo-item[data-id="c94_ui"]');
      /* ★ 选择器必须写成 [id$="RepeatSubs"]：id 是 todo_<id>_RepeatSubs，
         `[id$="_Subs"]` 永远匹配不到（被这一条坑了半小时）。 */
      var sel = card ? card.querySelector('select[id$="RepeatSubs"]') : null;
      ok('D1 设置面板有「下次重复时，子任务」下拉', !!sel);
      var opts = sel ? [].slice.call(sel.options) : [];
      ok('D2 恰好三档', opts.length === 3, opts.map(function (o) { return o.value; }).join(','));
      ok('D3 三档的 value 是 reset/clearDone/clear', opts.map(function (o) { return o.value; }).join(',') === 'reset,clearDone,clear');
      ok('D4 存档是 clearDone 时那一档被选中', sel && sel.value === 'clearDone', sel ? sel.value : '-');
      ok('D5 三档文案互不相同（不是同一句话写三遍）',
        new Set(opts.map(function (o) { return o.textContent; })).size === 3, opts.map(function (o) { return o.textContent; }).join(' | '));
    } finally {
      try { appData.todos = JSON.parse(todosBak); } catch (e) { appData.todos = []; }
      try {
        if (expandedTodos && expandedTodos['c94_ui']) toggleTodoExpand('c94_ui');
        delete editingTodos['c94_ui'];
        delete expandedTodos['c94_ui'];
      } catch (e0) {}
      try { renderTodos(); } catch (e) { if (window.__silent) window.__silent(e, 'c94:restore'); }
    }
  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  }
  return JSON.stringify(R);
})();
