/* C46 计划排序（计划时间/四象限，去「按名字」）+ 四象限分类
   ① 排序下拉：删掉「按名字」，新增 计划时间 / 四象限；方向键仍在
   ② 按计划时间：早上 7 点的排晚上 9 点前面；倒序翻转
   ③ 没填这个字段的任务**永远垫底**，不随方向翻转（否则倒序时空值顶到最前）
   ④ 按预计结束：同样早上 7 点的在前（预计结束是纯函数算出来的，不是抄提醒时间）
   ⑤ 按四象限：重要紧急(q1) → 不紧急不重要(q4) → 未分类垫底
   ⑥ 同一个字段再点一次 = 翻方向；换字段 = 回到该字段的默认方向
   ⑦ 四象限可写：新增弹窗选一个 → 落盘 quad；行内改 → 立刻写 appData
   ⑧ 行上有象限徽标；未分类不显示徽标
   ⑨ 脏值容错：未知象限当未分类（不污染排序、不留脏数据）
   ⑩ 排序与渲染一致：DOM 行顺序 == sortTodos 的结果 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var todosBak = JSON.stringify(appData.todos || []);
  var prefsBak = JSON.stringify(appData.sortPrefs || {});
  var today = getTodayStr();
  function ids(list) { return list.map(function (t) { return t.id; }); }
  function domIds() {
    return [].slice.call(document.querySelectorAll('#todoList .todo-item')).map(function (el) {
      return parseInt(el.getAttribute('data-id'), 10);
    }).filter(function (n) { return !isNaN(n); });
  }
  var a = { id: 9401, title: 'A 早上七点', done: false, remindAt: today + ' 07:00', pomodoros: 1, quad: 'q1' };
  var b = { id: 9402, title: 'B 晚上九点', done: false, remindAt: today + ' 21:00', pomodoros: 3, quad: 'q4' };
  var c = { id: 9403, title: 'C 没填时间', done: false, remindAt: '', pomodoros: 1 };
  try {
    /* ① 下拉选项 */
    var optVals = [].slice.call(document.querySelectorAll('#todoSortBy option')).map(function (o) { return o.value; });
    ok('① 排序下拉里没有「按名字」', optVals.indexOf('title') < 0 && optVals.indexOf('name') < 0);
    ok('①b 有 计划时间 / 四象限（提醒+预计结束已合并为一项）',
       optVals.indexOf('planTime') >= 0 && optVals.indexOf('quad') >= 0 &&
       optVals.indexOf('remind') < 0 && optVals.indexOf('estend') < 0);
    ok('①c 静音方向键还在', !!document.getElementById('todoSortDir'));

    /* ② 计划时间升序（= 计划开始，即提醒/开始时间） */
    appData.todos = [JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(c)), JSON.parse(JSON.stringify(a))];
    if (typeof setTodoSort === 'function') setTodoSort('planTime');
    var s = sortTodos(appData.todos);
    ok('② 默认按计划时间升序（07:00 在 21:00 前）', ids(s)[0] === 9401 && ids(s)[1] === 9402);
    ok('②b 没填提醒的垫底', ids(s)[2] === 9403);
    ok('②c 默认方向是「早的在前」', getSortPrefs().todos.dir === 'asc');

    /* ③ 倒序：填了的翻转，空值仍然垫底 */
    if (typeof toggleTodoSortDir === 'function') toggleTodoSortDir();
    s = sortTodos(appData.todos);
    ok('③ 倒序翻转（21:00 在前）', ids(s)[0] === 9402 && ids(s)[1] === 9401);
    ok('③b 倒序时空值仍垫底（没被当成最大值）', ids(s)[2] === 9403);

    /* ④ 计划时间 = 整段：开始时间相同，再按计划结束比（同样 07:00 开始，1🍅 早于 3🍅） */
    if (typeof setTodoSort === 'function') setTodoSort('planTime');
    appData.todos.push(
      { id: 9404, title: 'D 七点1🍅', done: false, remindAt: today + ' 07:00', pomodoros: 1 },
      { id: 9405, title: 'E 七点3🍅', done: false, remindAt: today + ' 07:00', pomodoros: 3 }
    );
    s = sortTodos(appData.todos);
    ok('④ 同时开始按计划结束先后：1🍅 在 3🍅 前', ids(s).indexOf(9404) < ids(s).indexOf(9405));
    appData.todos = appData.todos.filter(function (t) { return t.id !== 9404 && t.id !== 9405; });
    s = sortTodos(appData.todos);
    ok('④b 没填时间的垫底', ids(s)[2] === 9403);

    /* ⑤ 四象限 */
    if (typeof setTodoSort === 'function') setTodoSort('quad');
    s = sortTodos(appData.todos);
    ok('⑤ 重要紧急 → 不重要不紧急 → 未分类',
       ids(s)[0] === 9401 && ids(s)[1] === 9402 && ids(s)[2] === 9403);
    if (typeof toggleTodoSortDir === 'function') toggleTodoSortDir();
    s = sortTodos(appData.todos);
    ok('⑤b 倒序翻转，未分类照旧垫底', ids(s)[0] === 9402 && ids(s)[1] === 9401 && ids(s)[2] === 9403);

    /* ⑥ 方向记忆 */
    if (typeof setTodoSort === 'function') setTodoSort('planTime');
    ok('⑥ 换字段回到该字段默认方向(升序)', getSortPrefs().todos.dir === 'asc');
    if (typeof setTodoSort === 'function') setTodoSort('planTime');
    ok('⑥b 同字段再点一次 = 翻方向', getSortPrefs().todos.dir === 'desc');

    /* ⑦ 四象限可写（行内） */
    if (typeof setTodoSort === 'function') setTodoSort('manual');
    if (typeof setTodoQuad === 'function') setTodoQuad(9402, 'q2');
    var t2 = appData.todos.filter(function (x) { return x.id === 9402; })[0];
    ok('⑦ 行内选象限立刻写进 appData', !!t2 && t2.quad === 'q2');

    /* ⑧ 徽标 */
    if (typeof renderTodos === 'function') renderTodos();
    var row2 = (document.querySelector('.todo-item[data-id="9402"]') || {}).innerHTML || '';
    var row3 = (document.querySelector('.todo-item[data-id="9403"]') || {}).innerHTML || '';
    ok('⑧ 分类过的行有象限徽标', row2.indexOf('quad-badge') >= 0);
    ok('⑧b 未分类的行不显示徽标', row3.indexOf('quad-badge') < 0);

    /* ⑨ 脏值容错 */
    ok('⑨ 未知象限值 → 未分类',
       normQuad('q99') === null && quadRank('q99') === TODO_QUADS.length);
    ok('⑨b 空值/undefined 也是未分类', normQuad('') === null && normQuad(undefined) === null);

    /* ⑩ DOM 顺序与 sortTodos 一致 */
    if (typeof setTodoSort === 'function') setTodoSort('planTime');
    var want = ids(sortTodos(appData.todos));
    var got = domIds();
    ok('⑩ DOM 行顺序 == sortTodos 结果', want.length === got.length && want.join(',') === got.join(','),
       'want=' + want.join(',') + ' got=' + got.join(','));

    /* ⑪ 新增弹窗选象限 → 落盘 */
    if (typeof openAddTodoModal === 'function') openAddTodoModal();
    var box = document.getElementById('addTodoQuadBox');
    ok('⑪ 新增弹窗里有象限选择区', !!box);
    if (typeof setAddTodoQuad === 'function') setAddTodoQuad('q3');
    ok('⑪b 选中后能读回来', typeof readAddTodoQuad === 'function' && readAddTodoQuad() === 'q3');
    document.getElementById('addTodoTitle').value = '带象限的计划';
    if (typeof confirmAddTodo === 'function') confirmAddTodo();
    var nt = (appData.todos || []).filter(function (x) { return x.title === '带象限的计划'; })[0];
    ok('⑪c 新增的计划带着象限落盘', !!nt && nt.quad === 'q3');
    if (typeof closeModal === 'function') closeModal('addTodoModal');

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.todos = JSON.parse(todosBak); } catch (e) { appData.todos = []; }
    try { appData.sortPrefs = JSON.parse(prefsBak); } catch (e) {}
    if (typeof renderTodos === 'function') renderTodos();
    saveData();
  }
  return JSON.stringify(R);
})();
