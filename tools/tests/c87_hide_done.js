/* C87 计划页：去掉「排序」标签 + 眼睛开关（隐藏今天已完成的任务）

   
     「把那个排序那两个字删了……在上下箭头旁边加一个眼睛，正眼和闭眼的，
      功能就是能够支持隐藏我已经今天已经勾画完成的任务」
   本用例锁住：
     A 排序标签确实不在待办排序栏里（习惯/倒数日的标签不受影响）
     B 眼睛在方向按钮旁边，默认睁眼
     C 点一下隐藏已完成、再点恢复；状态落盘；分组函数同步过滤
     D 全部完成且隐藏时，空态说的是「收起来了」而不是「还没有计划任务」
     E 反证：把开关关掉，同一批数据里已完成行必须回来（断言有牙齿） */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function list() { return document.getElementById('todoList'); }
  function row(id) { return list().querySelector('.todo-item[data-id="' + id + '"]'); }
  function eye() { return document.getElementById('todoDoneToggle'); }
  var A = 'c87_a', B = 'c87_b';
  var bTodos = appData.todos.slice();
  var bHide = getSortPrefs().todos.hideDone;

  try {
    switchView('plan');
    appData.todos = [
      { id: A, title: 'C87未完成', done: false, pomodoros: 1, subs: [], repeat: '', tag: '' },
      { id: B, title: 'C87已完成', done: true, doneAt: Date.now(), pomodoros: 1, subs: [], repeat: '', tag: '' }
    ];
    getSortPrefs().todos.hideDone = false;
    renderTodos();
    updateSortBarUI();

    /* ---------- A 排序标签 ---------- */
    var bar = document.getElementById('todoSortDir').parentNode;
    /* ★ 2026-10-27 起待办栏恢复了一个**短标签**：用户反馈"一个下拉加一个箭头，
       不看字不知道这栏在干什么"。所以「不许有『排序』二字」这条老契约作废，
       改成「标签存在但只有一个短词，不啰嗦、不重复」——这才是当时真正想要的效果。 */
    var lab = bar.querySelector('.sort-label');
    ok('A1 排序栏的标签只有一个短词（不重复、不啰嗦）',
      !lab || (String(lab.textContent).trim().length <= 3 &&
        bar.querySelectorAll('.sort-label').length === 1),
      lab ? (String(lab.textContent).trim() + ' | 共 ' + bar.querySelectorAll('.sort-label').length + ' 个') : '(无标签)');
    /* 习惯栏的标签同样在 */
    var hbar = document.getElementById('habitSortDir').parentNode;
    ok('A2 习惯栏的标签也在，两栏一致',
      !!hbar.querySelector('.sort-label') && hbar.querySelectorAll('.sort-label').length === 1);

    /* ---------- B 入口 ---------- */
    ok('B1 方向按钮旁边有眼睛按钮', !!eye() && eye().parentNode === bar);
    ok('B2 默认睁眼（不隐藏）', !!eye() && eye().getAttribute('aria-pressed') === 'false' &&
      !!eye().querySelector('svg'));

    /* ---------- C 隐藏 / 恢复 ---------- */
    ok('C1 默认两条都显示', !!row(A) && !!row(B));
    eye().click();
    ok('C2 点一下：已完成行消失', !!row(A) && !row(B));
    ok('C3 未完成行不受影响', !!row(A));
    ok('C4 开关已落盘', getSortPrefs().todos.hideDone === true);
    ok('C5 图标变成闭眼（aria-pressed=true）',
      eye().getAttribute('aria-pressed') === 'true' &&
      String(eye().innerHTML).indexOf('M1 1l22 22') >= 0);
    var flat = _todoViewGroups().reduce(function (a, g) { return a.concat(g); }, []);
    ok('C6 视图分组里不再包含已完成任务',
      flat.every(function (t) { return String(t.id) !== B; }),
      flat.map(function (t) { return t.id; }).join(','));
    eye().click();
    ok('C7 再点一下：已完成行回来', !!row(A) && !!row(B));
    ok('C8 图标回到睁眼', eye().getAttribute('aria-pressed') === 'false');

    /* ---------- D 全完成 + 隐藏：空态要说清楚 ---------- */
    appData.todos = [
      { id: B, title: 'C87已完成', done: true, doneAt: Date.now(), pomodoros: 1, subs: [], repeat: '', tag: '' }
    ];
    getSortPrefs().todos.hideDone = true;
    renderTodos();
    updateSortBarUI();
    ok('D1 全部完成且隐藏时，空态说明是「收起来了」',
      String(list().textContent).indexOf('收起来了') >= 0,
      String(list().textContent).slice(0, 40));
    ok('D2 空态不再误报「还没有计划任务」',
      String(list().textContent).indexOf('还没有计划任务') < 0);

    /* ---------- E 反证：关掉开关，同一批数据必须回来 ---------- */
    getSortPrefs().todos.hideDone = false;
    renderTodos();
    updateSortBarUI();
    ok('E1 反证：开关关掉后已完成行回来（隐藏确实是开关干的）', !!row(B));
  } finally {
    appData.todos = bTodos;
    getSortPrefs().todos.hideDone = bHide;
    try { renderTodos(); } catch (e) { }
    try { updateSortBarUI(); } catch (e2) { }
    try { saveData(); } catch (e3) { }
  }
  return JSON.stringify(R);
})();
