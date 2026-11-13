/* C35 的页面侧断言体（run_smoke 直接读这个文件执行，浏览器也能直跑同一份）。
   返回 JSON：[[断言名, 是否通过], ...]。

   计划页：添加计划后「还没有计划任务」的空状态不消失。

   根因（实测坐实）：计划列表有两条渲染路径 ——
     · todos 为空时：`renderTodos()` 直接 `list.innerHTML = 空状态`（"还没有计划任务"）
     · todos 非空时：`renderTodosRows()` 走**行级复用**（按 data-id 找旧行、改、插、删）
   空状态那个 <div class="empty-state"> **没有 data-id** → 既进不了 `_existing` 索引，
   也进不了「移除已不存在的行」的循环 → 从"空"变成"有计划"时它**永远不会被删掉**，
   于是永远躺在列表底部，出现「明明有计划，下面还写着还没有计划任务」。
   （对照实测：HEAD 版本 step2_emptyLeft=true / 子节点数 2；修复后 false / 1。）

   三条：①空列表时该显示空状态 ②加进一条后空状态必须消失、只剩 1 个行节点
        ③清空后空状态要回来（别把空状态一起弄丢）。
   全程用真状态跑，**恢复放在 finally**：断言抛异常也不留下假计划。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var LIST = function () { return document.getElementById('todoList'); };
  var bak = null;
  try {
    if (typeof appData === 'undefined' || !appData.todos) {
      return JSON.stringify([['① appData.todos 可用', false], ['② 加计划后空状态消失', false], ['③ 清空后空状态回来', false]]);
    }
    bak = JSON.parse(JSON.stringify(appData.todos));

    // ① 空列表 → 空状态在
    appData.todos.length = 0;
    renderTodos();
    ok('① 没有计划时显示空状态', !!LIST().querySelector('.empty-state'));

    // ② 加一条 → 行有了，空状态必须没了，且列表里只剩这一个节点
    appData.todos.push({ id: 'c35_probe_1', title: '冒烟用计划', done: false, pomodoros: 1, actualPomodoros: 0 });
    renderTodos();
    var rows = LIST().querySelectorAll('.todo-item').length;
    ok('②a 加计划后出现 1 个任务行', rows === 1);
    ok('②b 加计划后空状态已消失（原 bug）', !LIST().querySelector('.empty-state'));
    ok('②c 列表里没有多余子节点', LIST().children.length === 1);

    // 再加一条，确认多行时也不会把行清掉
    appData.todos.push({ id: 'c35_probe_2', title: '冒烟用计划二', done: false, pomodoros: 2, actualPomodoros: 0 });
    renderTodos();
    ok('②d 两条计划 = 两个行节点', LIST().querySelectorAll('.todo-item').length === 2 && LIST().children.length === 2);

    // ③ 清空 → 空状态要回来
    appData.todos.length = 0;
    renderTodos();
    ok('③ 清空后空状态回来', !!LIST().querySelector('.empty-state') && LIST().children.length === 1);
  } catch (e) {
    ok('用例执行无异常', false);
  } finally {
    try {
      appData.todos.length = 0;
      (bak || []).forEach(function (t) { appData.todos.push(t); });
      renderTodos();
    } catch (e) { /* 恢复失败不掩盖断言结果 */ }
  }
  return JSON.stringify(R);
})();
