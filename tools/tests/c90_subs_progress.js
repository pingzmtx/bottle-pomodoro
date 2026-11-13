/* C90 子任务进度与批量勾选

   本用例锁住：
     A 进度条 2/5 → 全部勾选 5/5 → 全部取消；doneAt 同步维护
     B 脏项（null/字符串）不计入总数，界面数字与行数一致
     C 父任务已完成时不给批量按钮（避免「父完成、子全未完成」）
     D 空子任务不渲染进度条；批量操作不改父任务完成状态 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function row(id) { return document.getElementById('todoList').querySelector('.todo-item[data-id="' + id + '"]'); }
  function progTxt(id) {
    var e = row(id) && row(id).querySelector('.tf-sub-prog-txt');
    return e ? String(e.textContent) : '';
  }
  function progBtn(id) {
    return row(id) ? row(id).querySelector('.tf-sub-prog-btn') : null;
  }

  var bTodos = appData.todos.slice();

  try {
    switchView('plan');

    /* ---------- A 正常清单 ---------- */
    appData.todos = [{
      id: 'c90_a', title: 'C90清单', done: false, pomodoros: 1, repeat: '',
      subs: [
        { id: 1, title: '一', done: true, doneAt: 111 },
        { id: 2, title: '二', done: false },
        { id: 3, title: '三', done: false },
        { id: 4, title: '四', done: false },
        { id: 5, title: '五', done: false }
      ]
    }];
    expandedTodos = {};
    renderTodos();
    toggleTodoExpand('c90_a');
    ok('A1 进度写「子任务 1/5」', progTxt('c90_a').indexOf('1/5') >= 0, progTxt('c90_a'));
    ok('A2 按钮是「全部勾选」', !!progBtn('c90_a') && progBtn('c90_a').textContent === '全部勾选');

    progBtn('c90_a').click();
    ok('A3 全部勾选后变 5/5', progTxt('c90_a').indexOf('5/5') >= 0, progTxt('c90_a'));
    ok('A4 每个子任务都写上 doneAt',
      appData.todos[0].subs.every(function (s) { return s.done && typeof s.doneAt === 'number' && s.doneAt > 0; }));
    ok('A5 按钮变「全部取消」',
      !!progBtn('c90_a') && progBtn('c90_a').textContent === '全部取消');

    progBtn('c90_a').click();
    ok('A6 取消后 all 未完成', appData.todos[0].subs.every(function (s) { return !s.done; }));
    ok('A7 取消后 doneAt 被删掉（不留给统计误读）',
      appData.todos[0].subs.every(function (s) { return !('doneAt' in s); }));
    ok('A8 批量勾选不会把父任务判完成', appData.todos[0].done === false);

    /* ---------- B 脏项 ---------- */
    appData.todos = [{
      id: 'c90_b', title: 'C90脏项', done: false, pomodoros: 1, repeat: '',
      subs: [null, 'x', { id: 1, title: '有效', done: true }]
    }];
    expandedTodos = {};
    renderTodos();
    toggleTodoExpand('c90_b');
    ok('B1 脏项不计入总数（1/1，不是 1/3）', progTxt('c90_b').indexOf('1/1') >= 0, progTxt('c90_b'));
    ok('B2 空壳行不渲染成子任务', row('c90_b').querySelectorAll('.tf-sub').length === 1,
      String(row('c90_b').querySelectorAll('.tf-sub').length));

    /* 全是脏项：不留空壳容器 */
    appData.todos = [{
      id: 'c90_bad', title: 'C90全脏', done: false, pomodoros: 1, repeat: '',
      subs: [null, 'x']
    }];
    expandedTodos = {};
    renderTodos();
    toggleTodoExpand('c90_bad');
    ok('B3 全是脏项时不留空壳子任务容器', !row('c90_bad').querySelector('.tf-subs'));
    ok('B4 全是脏项时不渲染进度条', !row('c90_bad').querySelector('.tf-sub-prog'));

    /* ---------- C 父任务已完成 ---------- */
    appData.todos = [{
      id: 'c90_c', title: 'C90已完成', done: true, doneAt: Date.now(), pomodoros: 1, repeat: '',
      subs: [{ id: 1, title: '一', done: true }, { id: 2, title: '二', done: false }]
    }];
    expandedTodos = {};
    renderTodos();
    toggleTodoExpand('c90_c');
    ok('C1 父任务已完成 → 不给批量按钮', !progBtn('c90_c'));
    ok('C2 进度仍然显示（那是事实，不是开关）', progTxt('c90_c').indexOf('1/2') >= 0, progTxt('c90_c'));

    /* ---------- D 空 / 无子任务 ---------- */
    appData.todos = [{ id: 'c90_d', title: 'C90无子任务', done: false, pomodoros: 1, subs: [], repeat: '' }];
    expandedTodos = {};
    renderTodos();
    toggleTodoExpand('c90_d');
    ok('D1 没有子任务 → 不渲染进度条', !row('c90_d').querySelector('.tf-sub-prog'));

    /* ---------- E 反证：批量确实改了数据，不是只改了视图 ---------- */
    appData.todos = [{
      id: 'c90_e', title: 'C90反证', done: false, pomodoros: 1, repeat: '',
      subs: [{ id: 1, title: '一', done: false }, { id: 2, title: '二', done: false }]
    }];
    expandedTodos = {};
    renderTodos();
    toggleTodoExpand('c90_e');
    toggleAllTodoSubs('c90_e', 1);
    ok('E1 直接调用也生效（不依赖点击）',
      appData.todos[0].subs.every(function (s) { return s.done === true; }));
    toggleAllTodoSubs('c90_e', 0);
    ok('E2 反证：取消后数据里确实变回未完成',
      appData.todos[0].subs.every(function (s) { return s.done === false; }));
  } finally {
    appData.todos = bTodos;
    expandedTodos = {};
    try { renderTodos(); } catch (e) { }
    try { saveData(); } catch (e2) { }
  }
  return JSON.stringify(R);
})();
