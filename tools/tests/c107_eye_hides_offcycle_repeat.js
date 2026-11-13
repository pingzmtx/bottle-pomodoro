/* C107 眼睛顺手收起「今天不做的周期任务」
   —— 每周日才做的事，周三列出来就是噪音；但收起必须有回执：开关要说话、底部要留一行。

   判据对齐的三条边界：
     ① 重复计划 + 今天不是命中日 + 今天没有按天覆盖的段  → 藏
     ② 命中今天 → 不藏（那是真的要做的）
     ③ 一次性计划 → 永远不藏（它没有"轮不轮得到"）
   眼睛关着的时候一条都不许藏 —— 开关的意义就在"看得见全部"。 */
(function () {
  var R = [];
  function ok(n, c, e) { R.push([n, !!c, e == null ? '' : String(e)]); }

  var savedTodos = appData.todos;
  var savedPrefs = JSON.parse(JSON.stringify(appData.sortPrefs || {}));
  var savedToast = window.showToast;

  var today = getTodayStr();
  var todayDow = (function () {
    var d = new Date(today + 'T00:00:00');
    return ((d.getDay() + 6) % 7) + 1; /* 1=周一 … 7=周日，与 todoRepeatMatches 同口径 */
  })();
  var otherDow = (todayDow % 7) + 1; /* 换一个不同的一天 */

  function mk(id, title, weekdays) {
    return {
      id: id, title: title, quad: 'q4', done: false, pomos: 1,
      repeat: { mode: 'weekly', weekdays: [weekdays], subsMode: 'reset', last: today }
    };
  }

  /* A：今天不做的那条要被收起；今天要做的、一次性的都留着 */
  try {
    var offT = mk(770001, 'C107今天不做', otherDow);
    var onT = mk(770002, 'C107今天要做', todayDow);
    var onceT = { id: 770003, title: 'C107一次性', quad: 'q2', done: false, pomos: 1, days: [today] };
    appData.todos = [offT, onT, onceT];

    appData.sortPrefs.todos.hideDone = true;
    renderTodos();
    var html = document.getElementById('todoList').innerHTML;
    ok('A1 今天不轮到的周期任务被藏起来',
      [].slice.call(document.querySelectorAll('.todo-item')).every(function (e) { return e.textContent.indexOf('C107今天不做') < 0; }),
      '任务行里还有它');
    ok('A2 今天轮到的那条还在', html.indexOf('C107今天要做') >= 0);
    ok('A3 一次性计划不受影响', html.indexOf('C107一次性') >= 0);
    ok('A4 底部留了回执行', !!document.querySelector('.todo-eye-hint'), '没有 .todo-eye-hint');
    ok('A5 回执写了条数', (function () {
      var el = document.querySelector('.todo-eye-hint');
      return !!el && el.textContent.indexOf('1 条') >= 0;
    })(), (document.querySelector('.todo-eye-hint') || {}).textContent);

    /* B：眼睛关着 —— 一条都不许藏 */
    appData.sortPrefs.todos.hideDone = false;
    renderTodos();
    var h2 = document.getElementById('todoList').innerHTML;
    ok('B1 眼睛关着时周期任务照常出现', h2.indexOf('C107今天不做') >= 0);
    ok('B2 眼睛关着时没有回执行', !document.querySelector('.todo-eye-hint'));

    /* C：按天覆盖过的段 = 这次特意挪到今天做，必须留着 */
    var ovT = mk(770004, 'C107覆盖到今天', otherDow);
    ovT.dayPlan = {};
    ovT.dayPlan[today] = [{ start: today + ' 09:00', end: today + ' 09:30' }];
    ovT.blocks = [{ start: today + ' 09:00', end: today + ' 09:30' }];
    appData.todos = [ovT];
    appData.sortPrefs.todos.hideDone = true;
    renderTodos();
    var h3 = document.getElementById('todoList').innerHTML;
    ok('C1 特意按天挪到今天的不许藏', h3.indexOf('C107覆盖到今天') >= 0);

    /* D：开关要有回话 */
    appData.todos = [mk(770005, 'C107开关用', otherDow)];
    appData.sortPrefs.todos.hideDone = false;
    var said = [];
    window.showToast = function (m) { said.push(String(m)); };
    try { toggleTodoDoneHidden(); } catch (e) { ok('D0 toggleTodoDoneHidden 能跑', false, e.message); }
    ok('D1 打开眼睛时弹提示', said.length === 1, JSON.stringify(said));
    ok('D2 提示说清了藏了什么、几条',
      said.length === 1 && said[0].indexOf('周期任务') >= 0 && said[0].indexOf('1 条') >= 0, JSON.stringify(said));
    ok('D3 打开后确实藏了', appData.sortPrefs.todos.hideDone === true);

    said.length = 0;
    try { toggleTodoDoneHidden(); } catch (e) { ok('D4 toggle 回程能跑', false, e.message); }
    ok('D5 关掉时也有提示', said.length === 1, JSON.stringify(said));
    ok('D6 关掉后确实放出来了', appData.sortPrefs.todos.hideDone === false);

    /* E：开关关掉时提示不许瞎报「藏了 N 条」 */
    ok('E1 关掉后的提示不提藏了多少', said.length === 1 && said[0].indexOf('已显示全部') >= 0, JSON.stringify(said));

    /* F：全被藏光时，不能说「还没有计划任务」 */
    appData.todos = [mk(770006, 'C107全藏', otherDow)];
    appData.sortPrefs.todos.hideDone = true;
    renderTodos();
    var hf = document.getElementById('todoList').innerText || '';
    ok('F1 空态说明是"藏起来了"而不是"没有任务"', hf.indexOf('今天没有要做的周期任务') >= 0, hf.slice(0, 60));
    ok('F2 空态给出找回办法', hf.indexOf('眼睛') >= 0, hf.slice(0, 60));
  } finally {
    appData.todos = savedTodos;
    appData.sortPrefs = savedPrefs;
    window.showToast = savedToast;
    try { renderTodos(); } catch (e) { /* 还原失败不该盖掉断言结果 */ }
  }

  return JSON.stringify(R);
})();
