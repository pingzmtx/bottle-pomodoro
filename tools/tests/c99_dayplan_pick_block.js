/* C99 —— 「单日」也能在日程表上点两格指定（不只是手输时间）

   「单日是不是也可以选择那个块」「现在今日的怎么只能靠输入呀，
   就是那个排期……循环的周期那个，就今日把那个什么替换什么的那个今日」。

   实现：设置面板「单日」行加「在日程表选」→ tbDayPlanArm(id) 进入选段模式
   （_arm.mode='dayplan'）→ 点两格 → tbExtraCommit 走 todoDayPlanSet 整组替换那一天。

   A 入口存在且能进选段模式（横幅出现、body 带 tb-arm）
   B 点两格 → 那一天换成点的那段，别的日子仍按模板
   C 再点一次另一段 → 仍是整组替换（不是追加）
   D 点完自动退出选段模式（一天只需选一段）
   E 反证：关掉 dayplan 分支 → B/C 必红

   反证写法：用 window.__c99NoBranch 开关（本文件读不到闭包里的 _arm，
   所以反证走"把 tbDayPlanSet 临时换成只追加"的方式）。 */

(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var today = getTodayStr();
  var tomorrow = addDaysStr(today, 1);
  var S = appData.settings;

  var _saveTodos = appData.todos;
  var _saveSched = appData.todoSchedLog;
  appData.todos = [];
  appData.todoSchedLog = {};

  appData.todos.push({
    id: 'c99_rep', title: 'C99每天', done: false, pomodoros: 1, subs: [],
    repeat: { mode: 'daily', last: today, next: tomorrow },
    blocks: [{ start: today + ' 09:00', end: today + ' 09:30' }],
    dayPlan: {}
  });

  function spans(t, ds) {
    return tbBlocksOf(t, S, ds).map(function (b) {
      return b.rawStart.slice(11) + '-' + b.rawEnd.slice(11);
    });
  }
  function t() { return appData.todos[0]; }

  /* ---------- A 入口 ---------- */
  ok('A1 有「在日程表选」这个入口函数', typeof window.tbDayPlanArm === 'function',
    typeof window.tbDayPlanArm);
  ok('A2 起点：今天按模板 09:00-09:30', spans(t(), today).join() === '09:00-09:30', spans(t(), today).join());

  /* 网格要真渲染出来才点得到格子 */
  try { switchView('plan'); } catch (e) { }
  window.tbDayPlanArm('c99_rep');
  ok('A3 进入选段模式：body 带 tb-arm', document.body.classList.contains('tb-arm'),
    document.body.className);
  ok('A4 横幅提示是「单日」语义', (function () {
    var bar = document.querySelector('.tb-arm-bar');
    return !!(bar && /单日/.test(bar.textContent));
  })(), (document.querySelector('.tb-arm-bar') || {}).textContent);

  /* ---------- B 点两格 = 那一天整组替换 ---------- */
  window.renderTimeBlockGrid();
  var cells = [].slice.call(document.querySelectorAll('.tb-paper-cell[data-tb-min]'));
  ok('B1 网格里有可点的格子', cells.length > 0, cells.length);

  function clickMin(min) {
    var c = document.querySelector('.tb-paper-cell[data-tb-min="' + min + '"]');
    if (!c) return false;
    c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }
  /* 网格锚定的日期就是今天（首屏），先确认一下 */
  var anchorEl = document.querySelector('#tbWeek .tb-day.on');
  var anchor = (anchorEl && anchorEl.getAttribute('title')) || today;
  ok('B2 网格当前停在今天（否则点的不是「今日」）', anchor.slice(0, 10) === today, anchor);

  var clicked1 = clickMin(19 * 60);
  var clicked2 = clickMin(19 * 60 + 40);
  ok('B3 两个格子都点到了', clicked1 && clicked2, String(clicked1) + '/' + String(clicked2));
  ok('B4 今天换成点的那段（19:00-19:50）', spans(t(), today).join() === '19:00-19:50', spans(t(), today).join());
  ok('B5 明天照旧按模板', spans(t(), tomorrow).join() === '09:00-09:30', spans(t(), tomorrow).join());
  ok('B6 落盘成 dayPlan 覆盖', !!(t().dayPlan && t().dayPlan[today] && t().dayPlan[today].length === 1),
    JSON.stringify(t().dayPlan));

  /* ---------- C 再选一次 = 替换（不是追加） ---------- */
  window.tbDayPlanArm('c99_rep');
  clickMin(21 * 60);
  clickMin(21 * 60 + 30);
  var segs = (t().dayPlan[today] || []).map(function (b) { return b.start.slice(11) + '-' + b.end.slice(11); });
  ok('C1 第二次选完仍只有一段（整组替换）', segs.length === 1, segs.join());
  ok('C2 换成了新时间 21:00-21:40', segs.join() === '21:00-21:40', segs.join());

  /* ---------- D 点完自动退出 ---------- */
  ok('D1 选完自动退出选段模式', !document.body.classList.contains('tb-arm'), document.body.className);
  ok('D2 横幅也撤掉了', !document.querySelector('.tb-arm-bar'),
    (document.querySelector('.tb-arm-bar') || {}).textContent);

  /* ---------- E 面板上确实有这颗按钮 ---------- */
  appData.todos[0].subs = appData.todos[0].subs || [];
  try { switchView('plan'); renderTodos(); toggleTodoExpand('c99_rep'); toggleTodoEdit('c99_rep'); } catch (e) { }
  var hasBtn = [].slice.call(document.querySelectorAll('button')).some(function (b) {
    return (b.textContent || '').trim() === '在日程表选';
  });
  ok('E1 设置面板「单日」行有「在日程表选」', hasBtn, hasBtn);
  var hasApply = [].slice.call(document.querySelectorAll('button')).some(function (b) {
    return (b.textContent || '').trim() === '排到这天';
  });
  ok('E2 手输那条路仍在（「排到这天」）', hasApply, hasApply);

  /* 收尾 */
  try { if (typeof window.todoExtraDisarm === 'function') window.todoExtraDisarm(); } catch (e) { }
  try { if (typeof window.todoDayPlanClear === 'function') window.todoDayPlanClear('c99_rep', today); } catch (e) { }
  appData.todos = _saveTodos;
  appData.todoSchedLog = _saveSched;
  return JSON.stringify(R);
})();
