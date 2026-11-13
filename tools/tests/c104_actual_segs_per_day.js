/* C104 「✅ N 段 · 共 X 分」按天算，不跨天累计
 *
 * 问题来源：重复计划昨天做了 4 段共 100 分，第二天卡片上会不会变成「6 段」？
 * 同一张卡上还有两个**累计字段**（⌚timeSpent / 用 N🍅 actualPomodoros），
 * 它们归「本轮」，日切复位清零 —— 两套账并存，很容易被后来的改动接到一起。
 *
 * A 段数与分钟只认**查看的那一天**（昨天 4 段 + 今天 2 段 → 今天 2 段、昨天 4 段）
 * B 卡片的字面输出（不是只看函数返回值）：今天写 2 段 / 50 分
 * C 昨天的记录不随复位消失（翻回昨天照样 4 段）
 * D 复位把累计字段清零、但一条记录都不动
 * E 复位幂等（repeat.next 已经推到今天之后再跑一遍，什么都不做）
 */
(function () {
  var R = [];
  function ok(name, cond, detail) {
    R.push([name, !!cond, detail === undefined ? '' : String(detail)]);
  }

  var TODAY = getTodayStr();
  var YEST = (function () {
    var x = new Date(TODAY + 'T00:00:00');
    x.setDate(x.getDate() - 1);
    var m = x.getMonth() + 1, d = x.getDate();
    return x.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
  })();
  function at(ds, hm) { return new Date(ds + 'T' + hm + ':00').getTime(); }

  var TODO_BAK = appData.todos;
  var REC_BAK = appData.records;
  var REC_LEN_BAK = (appData.records || []).length;

  /* 昨天 4 段 × 25 分 = 100 分；今天 2 段 × 25 分 = 50 分 */
  function mkRec(id, ds, sh, eh, todoId) {
    return {
      id: id, todoId: todoId, taskName: '每天背单词', type: 'work',
      startTime: at(ds, sh), endTime: at(ds, eh),
      effectiveSeconds: 1500, status: 'complete', note: '', tag: '学习'
    };
  }

  function mkTodo() {
    return {
      id: 9501, title: '每天背单词', done: false, quad: 'q1', tag: '学习',
      pomodoros: 2, subs: [], detail: '',
      remindAt: TODAY + ' 09:00', estEnd: TODAY + ' 09:40',
      repeat: { mode: 'daily', last: YEST, next: TODAY },
      actualPomodoros: 6, timeSpent: 9000
    };
  }

  try {
    switchView('plan');
    switchPlanTab('plan');

    var t0 = mkTodo();
    appData.todos = [t0];
    appData.records = (appData.records || []).filter(function (r) {
      return !r || String(r.todoId) !== '9501';
    });
    appData.records.push(mkRec('c104a', YEST, '07:30', '07:55', 9501));
    appData.records.push(mkRec('c104b', YEST, '09:10', '09:35', 9501));
    appData.records.push(mkRec('c104c', YEST, '11:00', '11:25', 9501));
    appData.records.push(mkRec('c104d', YEST, '14:00', '14:25', 9501));
    appData.records.push(mkRec('c104e', TODAY, '09:00', '09:25', 9501));
    appData.records.push(mkRec('c104f', TODAY, '09:30', '09:55', 9501));

    /* ---------- A 取数按天 ---------- */
    ok('A1 今天只数到今天这两段', tbTodoSegList(t0, TODAY).length === 2, tbTodoSegList(t0, TODAY).length);
    ok('A2 昨天数到四段', tbTodoSegList(t0, YEST).length === 4, tbTodoSegList(t0, YEST).length);
    var msT = tbTodoFocusMs(t0, TODAY, Date.now()) / 60000;
    var msY = tbTodoFocusMs(t0, YEST, Date.now()) / 60000;
    ok('A3 今天的分钟只有 50', Math.round(msT) === 50, Math.round(msT));
    ok('A4 昨天的分钟是 100', Math.round(msY) === 100, Math.round(msY));
    ok('A5 两天加起来才等于总账', Math.round(msT + msY) === Math.round(tbTodoFocusMs(t0, '', Date.now()) / 60000),
      Math.round(tbTodoFocusMs(t0, '', Date.now()) / 60000));

    /* ---------- B 卡片的字面输出 ---------- */
    function cardTxt(ds) {
      window.tbPickDate(ds);
      renderTodos();
      var el = document.querySelector('#todoList .todo-item[data-id="9501"]');
      return el ? String(el.innerText).replace(/\s+/g, ' ') : '';
    }
    var todayTxt = cardTxt(TODAY);
    ok('B1 今天这张卡写「2 段 · 共 50 分」', todayTxt.indexOf('2 段 · 共 50 分') >= 0, todayTxt.slice(0, 80));
    ok('B2 没有把昨天那 4 段并进来（不出现 6 段）', todayTxt.indexOf('6 段') < 0, todayTxt.slice(0, 80));
    var yestTxt = cardTxt(YEST);
    ok('B3 翻到昨天写「4 段 · 共 100 分」', yestTxt.indexOf('4 段 · 共 100 分') >= 0, yestTxt.slice(0, 80));

    /* ---------- D 复位清累计字段、不动记录 ---------- */
    var recN = appData.records.length;
    resetTodoOccurrence(t0, TODAY, normTodoRepeat(t0.repeat));
    ok('D1 复位把「实际 N🍅」清零', !t0.actualPomodoros, t0.actualPomodoros);
    ok('D2 复位把「⌚X 分钟」清零', !t0.timeSpent, t0.timeSpent);
    ok('D3 一条记录都没删', appData.records.length === recN, appData.records.length + '/' + recN);
    ok('D4 复位后昨天仍然数得到四段', tbTodoSegList(t0, YEST).length === 4, tbTodoSegList(t0, YEST).length);

    /* ---------- E 日切整条路径 + 幂等 ----------
       D 段直接调了 resetTodoOccurrence，没推 next（那是 resetDueRepeatingTodos 的活）。
       这里走真实入口一次，确认它把 next 推到下一命中日；再跑一次必须什么都不做。 */
    t0.actualPomodoros = 6;
    resetDueRepeatingTodos(TODAY);
    ok('E1 日切复位后 next 推到今天之后', !!t0.repeat.next && t0.repeat.next > TODAY, t0.repeat.next);
    ok('E2 日切顺手把累计番茄清零', !t0.actualPomodoros, t0.actualPomodoros);
    var nextBak = t0.repeat.next;
    t0.actualPomodoros = 6;
    resetDueRepeatingTodos(TODAY);
    ok('E3 同一天再跑一次不再复位（幂等）', t0.actualPomodoros === 6, t0.actualPomodoros);
    ok('E4 next 没被改坏', t0.repeat.next === nextBak, t0.repeat.next);
  } catch (e) {
    R.push(['✗ 用例抛异常：' + String((e && e.stack) || e), false]);
  } finally {
    appData.todos = TODO_BAK;
    appData.records = REC_BAK;
    if (Array.isArray(appData.records) && appData.records.length > REC_LEN_BAK) {
      appData.records.length = REC_LEN_BAK;
    }
    try { window.tbGoToday(); renderTodos(); } catch (e2) { }
  }
  return JSON.stringify(R);
})();
