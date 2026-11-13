/* C129 —— 在日程表切换日期：列表跟着切，提示条出现，「回到今天」能点

   用户：「为什么我点击别的那天，它不会显示正在看别天的那个计划？
   然后非得我添加完一个计划，它才会显示。然后我点那个回到今天那个按钮，还点不动」。

   根因：tbPickDate / tbGoToday / tbShiftWeek 只调 renderTimeBlockGrid（网格），
   没调 renderTodos（列表）。列表只在别处被动重渲时才更新，所以「切换日期后
   列表和提示条都停在原处，直到新建一条计划才刷新」。
   另外模块作用域里裸调 renderTodos 是 ReferenceError（它挂在 window 上），
   必须写 window.renderTodos()。

     A 切到别的日期 → 「正在看 X（周Y）的计划」提示条出现
     B 提示条里有「回到今天」按钮
     C 列表内容跟着换（周日那条出现在周日视图，今天那条不在 day 组）
     D 点「回到今天」→ 锚点回今天、提示条消失
     E 换周按钮同样会刷新列表
*/
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }
  var today = getTodayStr();
  var sun = addDaysStr(today, 3);

  var bak = appData.todos.slice();
  appData.todos = [
    { id: 'c129a', uid: 'u1', title: '测试项A', done: false, planDate: '', subs: [] },
    { id: 'c129b', uid: 'u2', title: '测试项B', done: false, planDate: sun, subs: [] }
  ];
  renderTodos();

  function cap() { return document.getElementById('todoDateCaption'); }
  function listTxt() { return document.getElementById('todoList').innerText; }

  /* ---- A/B/C 切到别的日期 ---- */
  tbPickDate(sun);
  ok('A1 锚点切到那一天', tbAnchorDateStr() === sun, tbAnchorDateStr());
  ok('A2 「正在看 X 的计划」提示条出现', !!cap() && cap().style.display !== 'none',
     cap() ? cap().style.display : 'null');
  ok('A3 提示条写对了日期', !!cap() && cap().innerText.indexOf(sun.slice(5).replace('-', '/')) >= 0,
     cap() ? cap().innerText.replace(/\s+/g, ' ') : '');
  ok('B1 提示条里有「回到今天」按钮', !!document.querySelector('.tdc-back'));
  ok('C1 列表切到那天（能看到那天的那条）', listTxt().indexOf('测试项B') >= 0, listTxt().slice(0, 60));
  ok('C2 那天那条不在「未排期」组里（它是这天的事）', (function () {
    var g = _todoViewGroups();
    return g[2].every(function (t) { return t.title !== '测试项B'; });
  })());

  /* ---- D 回到今天 ---- */
  var btn = document.querySelector('.tdc-back');
  if (btn) btn.click();
  ok('D1 点「回到今天」锚点回今天', tbAnchorDateStr() === today, tbAnchorDateStr());
  ok('D2 提示条消失', !cap() || cap().style.display === 'none', cap() ? cap().style.display : 'null');
  ok('D3 列表切回今天（今天那条出现、周日那条归到别的时候）', (function () {
    var g = _todoViewGroups();
    var undatedOrDay = g[0].concat(g[2]).some(function (t) { return t.title === '测试项A'; });
    var other = g[3].some(function (t) { return t.title === '测试项B'; });
    return undatedOrDay && other;
  })(), listTxt().slice(0, 60));

  /* ---- E 换周按钮也刷新 ---- */
  ok('E1 tbShiftWeek 挂在 window 上', typeof window.tbShiftWeek === 'function');
  window.tbShiftWeek(1);
  ok('E2 换到下一周后提示条仍显示（列表跟着重画）',
     !!cap() && cap().style.display !== 'none', cap() ? cap().style.display : 'null');

  appData.todos = bak;
  try { tbGoToday(); saveData(); } catch (e) { /* 测试环境 */ }
  return JSON.stringify(R);
})();
