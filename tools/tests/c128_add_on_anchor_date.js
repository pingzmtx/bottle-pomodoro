/* C128 —— 日程表某天点「＋」新建：那天看得见、既不加提醒也不排期

   用户三轮反馈：
   ①「我想在周日完成一个任务，就摁日程表那个周日，点那个加号，就可以排在那一天」
   ②「它怎么自动给我排期了呀……你不要默认画块啊，我自己想画块自己会画」
   ③「我明明没设置提醒时间，它自动给我弄了个提醒时间，一个闹钟旁边」

   最终口径：新建只写一个「计划日期」（planDate）——
     · 那天列表里能看到这条（day 组），今天则在「📆 别的时候安排的」
     · 不产生提醒（没有闹钟），不产生排期段（网格不画块）
     · 提醒是用户自己按需勾的，不替他决定

     A 不预填提醒 / remindAt 为空 / planDate 落在那天 / 没有 blocks
     B 网格那天没有块（不替用户画块）
     C 切到那天：在 day 组
     D 回到今天：在「别的时候安排的」，不在「未排期」
     E 总开关眼睛收起整组，并留一句回执；关掉眼睛回来
     F 什么都没填的计划仍然进「未排期」
     G 用户自己填了提醒 → 照常保留（不因为这次改动丢掉用户的输入）
*/
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }
  var today = getTodayStr();
  var target = addDaysStr(today, 2);

  var todosBak = appData.todos.slice();
  var hideBak = getSortPrefs().todos.hideDone;
  getSortPrefs().todos.hideDone = false;

  function addOn(ds, title, remind, blocks) {
    var orig = window.tbAnchorDateStr;
    window.tbAnchorDateStr = function () { return ds; };
    openAddTodoModal();
    var prefill = (document.getElementById('addTodoRemind') || {}).value;
    document.getElementById('addTodoTitle').value = title;
    if (remind) document.getElementById('addTodoRemind').value = remind;
    var bak = _addBlockDraft;
    _addBlockDraft = blocks || [];
    confirmAddTodo();
    _addBlockDraft = bak;
    window.tbAnchorDateStr = orig;
    return { t: appData.todos[appData.todos.length - 1], prefill: prefill };
  }

  /* ---- A ---- */
  appData.todos = [];
  var a = addOn(target, '测试项A');
  ok('A1 不预填提醒时间', !a.prefill, a.prefill);
  ok('A2 remindAt 为空（卡片上没有闹钟）', !a.t.remindAt, a.t.remindAt);
  ok('A3 planDate 落在这一天', a.t.planDate === target, a.t.planDate);
  ok('A4 没有生成排期段', !a.t.blocks || a.t.blocks.length === 0, JSON.stringify(a.t.blocks));

  /* ---- B ---- */
  ok('B1 网格那天没有块', tbBlocksOf(a.t, appData.settings, target).length === 0,
     tbBlocksOf(a.t, appData.settings, target).length);

  /* ---- C ---- */
  var sTarget = tbTodoSplitForDate(target);
  ok('C1 切到那天能在 day 组看到它', sTarget.day.indexOf(a.t) >= 0,
     'day=' + sTarget.day.length + ' undated=' + sTarget.undated.length + ' future=' + sTarget.future.length);

  /* ---- D ---- */
  var g = _todoViewGroups();
  ok('D1 今天不落进「未排期」', g[2].indexOf(a.t) < 0, g[2].length);
  ok('D2 今天在「别的时候安排的」组', g[3].indexOf(a.t) >= 0, g[3].length);

  /* ---- E ---- */
  renderTodos();
  ok('E1 今天题头是「别的时候安排的」', !!document.querySelector('.todo-otherday-head'),
     (document.querySelector('.todo-otherday-head') || {}).innerText || '');
  ok('E2 题头里没有小组眼睛（只有总开关）', !document.querySelector('.todo-grp-eye'));

  getSortPrefs().todos.hideDone = true;
  renderTodos();
  ok('E3 总开关打开 → 整组收起', document.getElementById('todoList').innerText.indexOf('测试项A') < 0,
     document.getElementById('todoList').innerText.slice(0, 40));
  ok('E4 收起后留一句回执', /已收起/.test(document.getElementById('todoList').innerText),
     document.getElementById('todoList').innerText.slice(0, 60));

  getSortPrefs().todos.hideDone = false;
  renderTodos();
  ok('E5 关掉总开关 → 回来', document.getElementById('todoList').innerText.indexOf('测试项A') >= 0);

  /* ---- F ---- */
  appData.todos = [];
  var origAnchor = window.tbAnchorDateStr;
  window.tbAnchorDateStr = function () { return today; };
  openAddTodoModal();
  document.getElementById('addTodoTitle').value = '测试项B';
  confirmAddTodo();
  window.tbAnchorDateStr = origAnchor;
  var b = appData.todos[0];
  var g2 = _todoViewGroups();
  ok('F1 今天新建的空计划仍然进「未排期」', g2[2].indexOf(b) >= 0, g2[2].length);
  ok('F2 今天新建不写 planDate', !b.planDate, b.planDate);
  ok('F3 它没有 blocks', !b.blocks || b.blocks.length === 0, JSON.stringify(b.blocks));

  /* ---- G 用户自己填的提醒要保留 ---- */
  appData.todos = [];
  var c = addOn(target, '测试项C', target + 'T09:00');
  ok('G1 用户自己填的提醒被保留', (c.t.remindAt || '').slice(0, 10) === target, c.t.remindAt);
  ok('G2 同时 planDate 也在', c.t.planDate === target, c.t.planDate);

  /* 还原 */
  appData.todos = todosBak;
  getSortPrefs().todos.hideDone = hideBak;
  try { saveData(); renderTodos(); } catch (e) { /* 测试环境 */ }
  return JSON.stringify(R);
})();
