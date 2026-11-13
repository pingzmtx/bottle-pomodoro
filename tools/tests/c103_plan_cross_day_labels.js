/* C103 隔天的计划在计划页要说清楚「这是哪天的」
 *
 * 问题来源：单日计划到了第二天还在列表里（carry「之前没完成的」/ future「之后的安排」），
 * 但标题行的提醒徽标只写时分 —— 「⏰ 9:00」在今天的页面上被读成「今天 9:00 要做」。
 * 重复计划在不命中的日子更糟：网格一个块都不画，折叠态只剩「⏰ 10:00」。
 *
 * A 昨天的一次性计划：进 carry 组，徽标带日期且标为「不是今天」
 * B 明天的一次性计划：进 future 组，徽标带日期
 * C 重复计划今天命中：徽标只有时分（今天就是正常的）
 * D 重复计划今天不命中：进 day 组（保证够得着），多一行「🔄 规则 · 今天不做」
 * E 只有额外段、没有 remindAt 的计划：不会被判成「未设日期」
 * F 提醒不会真的响（徽标说不是今天，checkTodoReminders 也确实不催）
 */
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }

  var TODAY = getTodayStr();
  function shift(n) {
    var x = new Date(TODAY + 'T00:00:00');
    x.setDate(x.getDate() + n);
    var m = x.getMonth() + 1, d = x.getDate();
    return x.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
  }
  var YEST = shift(-1), TMRW = shift(1);

  var TODO_BAK = appData.todos;
  var SCHED_BAK = appData.todoSchedLog;
  var VIEW_BAK = (typeof tbAnchorDateStr === 'function') ? null : null;
  var box = null;

  function mkTodo(over) {
    var t = { id: 9801, title: '样本', done: false, quad: 'q1', tag: '学习',
      pomodoros: 1, subs: [], detail: '' };
    Object.keys(over || {}).forEach(function (k) { t[k] = over[k]; });
    return t;
  }
  /* 卡片渲染只有一条路：渲染整张列表再按 data-id 取那一条 */
  function cardOf(id) {
    renderTodos();
    var list = document.getElementById('todoList');
    if (!list) return null;
    var els = list.querySelectorAll('.todo-item');
    for (var i = 0; i < els.length; i++) {
      if (String(els[i].getAttribute('data-id')) === String(id)) return els[i];
    }
    return null;
  }
  function badgeOf(el) {
    if (!el) return null;
    return el.querySelector('.todo-remind');
  }
  function repLineOf(el) {
    /* ★ 2026-10-25 起折叠态用 🔄 徽标承载规则说明，文字行 .todo-extra-line--rep 已删。
       helper 名字保留（调用点读起来还是"规则说明在哪"），返回的换成那个徽标。 */
    if (!el) return null;
    return el.querySelector('.todo-rep-badge');
  }

  try {
    switchView('plan');
    switchPlanTab('plan');

    /* ---------- A 昨天的一次性计划 ---------- */
    appData.todos = [
      mkTodo({ id: 9801, title: '昨天没做完', remindAt: YEST + ' 09:00', estEnd: YEST + ' 09:30' })
    ];
    saveDataNow();
    var split = tbTodoSplitForDate(TODAY);
    ok('A1 昨天的一次性计划进「之前没完成的」',
      split.carry.some(function (t) { return t.id === 9801; }),
      split.carry.map(function (t) { return t.title; }).join(','));
    var cA = cardOf(9801);
    ok('A2 卡片还在（不会被悄悄藏起来）', !!cA);
    var bA = badgeOf(cA);
    ok('A3 昨天的提醒不再显示（那天过去了，今天不会响）', !bA, bA && bA.textContent);
    ok('A4 昨天那段排期也不占一行', String(cA.textContent).indexOf('09:00') < 0 &&
      String(cA.textContent).indexOf('9:00') < 0, (cA.textContent || '').replace(/\s+/g, ' ').slice(0, 80));

    /* ---------- B 明天的一次性计划 ---------- */
    appData.todos = [
      mkTodo({ id: 9802, title: '明天的事', remindAt: TMRW + ' 14:00', estEnd: TMRW + ' 15:00' })
    ];
    saveDataNow();
    split = tbTodoSplitForDate(TODAY);
    ok('B1 明天的一次性计划进「之后的安排」',
      split.future.some(function (t) { return t.id === 9802; }),
      split.future.map(function (t) { return t.title; }).join(','));
    var bB = badgeOf(cardOf(9802));
    ok('B2 提醒徽标带日期', !!bB && bB.textContent.indexOf(TMRW.slice(5).replace('-', '/')) >= 0, bB && bB.textContent);
    ok('B3 也是淡的', !!bB && bB.className.indexOf('todo-remind--off') >= 0, bB && bB.className);

    /* ---------- C 今天命中的重复计划 ---------- */
    appData.todos = [
      mkTodo({ id: 9803, title: '每天重复', remindAt: TODAY + ' 09:00', estEnd: TODAY + ' 09:30',
        repeat: { mode: 'daily', last: shift(-3) } })
    ];
    saveDataNow();
    var bC = badgeOf(cardOf(9803));
    ok('C1 今天的提醒仍只写时分（不刷日期）',
      !!bC && bC.textContent.replace(/\s/g, '') === '⏰9:00', bC && bC.textContent);
    ok('C2 今天的提醒是正常色，不淡化', !!bC && bC.className.indexOf('todo-remind--off') < 0, bC && bC.className);
    /* 2026-10-22 修：原断言要求「今天命中时连规则行都不许有」，但渲染逻辑（01eC:1685）
       明确写了「重复计划折叠态也把规则摊出来」，只在**不命中**时才补「今天不做」。
       所以断言改成查禁用文案，而不是查元素是否存在 —— 行为契约是「不许说今天不做」。 */
    ok('C3 今天命中的不出现「今天不做」',
      String((cardOf(9803) || {}).textContent || '').indexOf('今天不做') < 0,
      '卡片文本=' + ((cardOf(9803) || {}).textContent || '(无卡片)').replace(/\s+/g, ' ').slice(0, 120));

    /* ---------- D 今天不命中的重复计划 ---------- */
    /* 挑一个不是今天的星期几，规则只在那天生效 */
    var wdToday = new Date(TODAY + 'T00:00:00').getDay();
    var wdToday1to7 = wdToday === 0 ? 7 : wdToday;
    var wdOther = wdToday1to7 === 3 ? 4 : 3;
    appData.todos = [
      mkTodo({ id: 9804, title: '不是今天的那条', remindAt: TMRW + ' 10:00', estEnd: TMRW + ' 10:30',
        repeat: { mode: 'weekly', weekdays: [wdOther], last: shift(-7) } })
    ];
    saveDataNow();
    split = tbTodoSplitForDate(TODAY);
    ok('D1 不命中的重复计划仍在 day 组（够得着才能改规则）',
      split.day.some(function (t) { return t.id === 9804; }),
      split.day.map(function (t) { return t.title; }).join(','));
    var cD = cardOf(9804);
    var rD = repLineOf(cD);
    /* 规则说明现在在徽标的 title / aria-label 里（老版本是文字行内容） */
    var _tipD = rD ? (rD.getAttribute('title') || rD.getAttribute('aria-label') || '') : '';
    ok('D2 徽标说明里写清是哪条规则', !!rD && _tipD.indexOf('每周') >= 0, _tipD);
    ok('D3 规则外的日子明确写「今天不做」', _tipD.indexOf('今天不做') >= 0, _tipD);
    ok('D4 徽标只有一个符号，不重复时间（时间在上面的排期徽标里）',
      !!rD && String(rD.textContent).indexOf(':') < 0, rD && rD.textContent);
    var bD = badgeOf(cD);
    ok('D5 提醒徽标带日期', !!bD && bD.textContent.indexOf(TMRW.slice(5).replace('-', '/')) >= 0, bD && bD.textContent);

    /* ---------- D6 没有排期的重复清单项：不许说「今天不做」 ----------
       「每天」但一个时段都没排，同样画不出块，可它今天随时能做。 */
    appData.todos = [
      mkTodo({ id: 9804, title: '每天做但没排时段', repeat: { mode: 'daily', last: TODAY, next: TODAY } })
    ];
    renderTodos();
    var rD6 = cardOf(9804);
    var _bD6 = repLineOf(rD6);
    var _tipD6 = _bD6 ? (_bD6.getAttribute('title') || _bD6.getAttribute('aria-label') || '') : '';
    ok('D6 没排时段的重复计划不标「今天不做」',
      !!_bD6 && _tipD6.indexOf('今天不做') < 0 && String(rD6.textContent).indexOf('今天不做') < 0, _tipD6);

    /* ---------- E 只有额外段 ---------- */
    appData.todos = [
      mkTodo({ id: 9805, title: '只排了明天一段', remindAt: null, estEnd: null,
        blocks: [{ start: TMRW + ' 16:00', end: TMRW + ' 17:00' }] })
    ];
    saveDataNow();
    split = tbTodoSplitForDate(TODAY);
    var inUndated = split.undated.some(function (t) { return t.id === 9805; });
    var inFuture = split.future.some(function (t) { return t.id === 9805; });
    ok('E1 只有额外段 → 不算「未设日期」', !inUndated, 'undated=' + inUndated);
    ok('E2 归到「之后的安排」', inFuture, 'future=' + inFuture);

    /* ---------- F 提醒真的不会响 ---------- */
    var tF = appData.todos[0];
    ok('F1 隔天的提醒算不出今天的提醒点',
      todoRemindSlots(tF, appData.settings, TODAY).length === 0,
      todoRemindSlots(tF, appData.settings, TODAY).length);
    appData.todos = [
      mkTodo({ id: 9806, title: '昨天的', remindAt: YEST + ' 09:00', estEnd: YEST + ' 09:30' })
    ];
    ok('F2 昨天的提醒今天也不再催',
      todoRemindSlots(appData.todos[0], appData.settings, TODAY).length === 0,
      todoRemindSlots(appData.todos[0], appData.settings, TODAY).length);

    /* ---------- G 昨天做完的单日任务：不再占今天的计划页 ----------
       「我昨天都排完了，那是一个没有用的」。日切会删掉它，但窗口跨了午夜 / 日切
       还没跑时它还在 —— 判据只看排期日，不看现在几点。 */
    appData.todos = [
      mkTodo({ id: 9807, title: '昨天做完的', done: true, doneAt: YEST + ' 09:30',
        remindAt: YEST + ' 09:00', estEnd: YEST + ' 09:30' }),
      mkTodo({ id: 9808, title: '昨天没做的', remindAt: YEST + ' 14:00', estEnd: YEST + ' 15:00' }),
      mkTodo({ id: 9809, title: '今天做完的', done: true, doneAt: TODAY + ' 09:30',
        remindAt: TODAY + ' 09:00', estEnd: TODAY + ' 09:30' })
    ];
    renderTodos();
    var g7 = cardOf(9807), g8 = cardOf(9808), g9 = cardOf(9809);
    ok('G1 昨天做完的单日任务不显示', !g7, g7 && g7.textContent.slice(0, 40));
    /* 别用 '14:00' 断言：12 小时制下它渲染成 2:00，断言会假绿。看有没有日期头更可靠。 */
    ok('G2 昨天没做的还留着（只是不带排期行）',
      !!g8 && String(g8.textContent).indexOf(YEST.slice(5).replace('-', '/')) < 0 &&
      String(g8.textContent).indexOf('排期') < 0,
      g8 && g8.textContent.replace(/\s+/g, ' ').slice(0, 60));
    ok('G3 今天做完的照常显示', !!g9, g9 && g9.textContent.slice(0, 40));

    /* 重复计划做完也要留着：它明天还是一条新任务 */
    appData.todos = [
      mkTodo({ id: 9810, title: '每天做的', done: true, doneAt: TODAY + ' 09:30',
        remindAt: TODAY + ' 09:00', estEnd: TODAY + ' 09:30',
        repeat: { mode: 'daily', last: TODAY, next: TMRW } })
    ];
    renderTodos();
    ok('G4 重复计划做完不隐藏（明天还要做）', !!cardOf(9810), '');
    appData.todos = [
      mkTodo({ id: 9811, title: '没排期的已完成', done: true, doneAt: TODAY + ' 09:30' })
    ];
    renderTodos();
    ok('G5 没有排期的已完成项不受这条规则影响', !!cardOf(9811), '');

    /* ---------- H 昨天排过、没做的单日计划：归「之前没完成的」，不是「未排期」 ----------
       日切会把过期的一次性计划清回未排期（remindAt 置空、blocks 清空）——
       活对象上再也看不出它昨天排过。旧分组只看活对象，于是它被标成
       「📌 未排期（没设开始时间，不随日期变）」，可它明明设过。
       快照是唯一的残留，分组必须能回看它。 */
    appData.todos = [
      mkTodo({ id: 9821, title: '昨天排过没做', remindAt: YEST + ' 14:00', estEnd: YEST + ' 15:00' }),
      mkTodo({ id: 9822, title: '从没排过' })
    ];
    /* 走真实清理路径：它会先冻快照再清字段 */
    clearStaleOneOffSchedule(TODAY);
    var h1 = appData.todos.filter(function (x) { return x.id === 9821; })[0];
    ok('H1 清理后活对象上已经没有排期了（前提成立）',
      !!h1 && !h1.remindAt && todoBlockDates(h1).length === 0,
      h1 && JSON.stringify({ rm: h1.remindAt, bl: todoBlockDates(h1) }));
    var grp = tbTodoSplitForDate(TODAY);
    var ids = function (arr) { return (arr || []).map(function (x) { return x.id; }); };
    ok('H2 归进「之前没完成的」', ids(grp.carry).indexOf(9821) >= 0, ids(grp.carry).join(','));
    ok('H3 不再被说成「没设开始时间」', ids(grp.undated).indexOf(9821) < 0, ids(grp.undated).join(','));
    ok('H4 从没排过的仍然归「未排期」', ids(grp.undated).indexOf(9822) >= 0, ids(grp.undated).join(','));
    /* 分组头也认得出来：渲染后卡片落在「之前没完成的」标题下面 */
    renderTodos();
    var hList = document.getElementById('todoList');
    var hHtml = hList ? String(hList.innerHTML) : '';
    var iHead = hHtml.indexOf('之前没完成的');
    var iCard = hHtml.indexOf('data-id="9821"');
    ok('H5 卡片排在「之前没完成的」标题之后', iHead >= 0 && iCard > iHead, iHead + '/' + iCard);

    /* ---------- 收尾 ---------- */
  } catch (e) {
    R.push(['✗ 用例抛异常：' + String((e && e.stack) || e), false]);
  } finally {
    appData.todos = TODO_BAK;
    appData.todoSchedLog = SCHED_BAK;
    try { renderTodos(); } catch (e2) { }
  }
  return JSON.stringify(R);
})();
