/* C78 计划的「完成」不该让它从列表里消失
   ─────────────────────────────────────────────────────────────
   需求原话：「我今天不小心点了一下，完成了那个网上图文问诊的任务，
   然后他突然那个任务就从我的列表上消失了？怎么回事」

   根因：tbTodoSplitForDate 的 carry / future 两个分支都带 !t.done 守卫。
   一个排在**明天**的计划（或只有额外段、没有 remindAt 的计划）：
     今天 inDay 不含它 → 不进 day；
     sd(明天) > 今天 → future 分支被 !t.done 挡掉；
     三组都不收 → 列表里凭空消失，连取消勾选的入口都没有。
   而「今天有块、今天勾完成」的计划仍留在 day 组（inDay 不看 done）——
   同一个动作两种结果，本身就不自洽。

   修法：done 不再参与分组，只决定「外观 + 网格还画不画块」。
   本用例锁住：
     A 未来计划未完成 → 在 future 组（基线）
     B 勾完成 → 仍在 future 组，列表里还能点到（本 bug 的核心）
     C 取消勾选 → 回到原样，块也回来
     D 过期的计划（排期在过去）勾完成 → 分组仍在 carry；卡按降噪规则隐藏，
       但 done / 排期快照 / 完成流水 / 日志页全在（隐藏 ≠ 丢失）
     E 未排期计划勾完成 → 仍在 undated 组
     F 完成状态不影响网格绘制（预计块仍按排期出现在它自己那天）
     G 反证：把 !t.done 注回两处守卫，B 组断言必须变红 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function dsOf(off) {
    var d = new Date();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + off);
    return getDateStr(d);
  }
  function todoById(id) {
    return (appData.todos || []).filter(function (x) { return String(x.id) === String(id); })[0];
  }
  function inList(id) {
    return !!document.querySelector('#todoList .todo-item[data-id="' + id + '"]');
  }
  function inGroup(id, groupArr) {
    return (groupArr || []).some(function (x) { return String(x.id) === String(id); });
  }
  function listText() {
    var el = document.getElementById('todoList');
    return el ? el.innerText : '';
  }

  var bTodos = appData.todos.slice();
  var bRecs = appData.records.slice();
  var bLog = JSON.parse(JSON.stringify(appData.todoSchedLog || {}));
  var today = dsOf(0), tmw = dsOf(1), yest = dsOf(-1);

  var FUT = 'c78_fut';   /* 明天有额外段、没有 remindAt（需求那条的真实形态） */
  var OLD = 'c78_old';   /* 排期在昨天 */
  var UND = 'c78_und';   /* 完全没排期 */

  try {
    appData.todos = [
      { id: FUT, title: 'C78 明天的事', done: false, quad: 'q2', tag: '生活',
        remindAt: null, estEnd: null, repeat: null,
        extraBlocks: [{ start: tmw + ' 08:30', end: tmw + ' 09:20' }] },
      { id: OLD, title: 'C78 昨天的事', done: false, quad: 'q2', tag: '生活',
        remindAt: yest + ' 08:00', estEnd: yest + ' 09:00', repeat: null },
      { id: UND, title: 'C78 没排期的事', done: false, quad: 'q3', tag: '学习',
        remindAt: null, estEnd: null, repeat: null }
    ];
    try { tbInvalidateSegIndex(); } catch (e0) { }
    renderTodos();
    switchView('plan');

    /* ---- A 基线：未完成 ---- */
    var sp = tbTodoSplitForDate(today);
    ok('A1 明天有额外段的计划 → future 组', inGroup(FUT, sp.future));
    ok('A2 列表里能看到它', inList(FUT), listText().indexOf('C78 明天的事') >= 0);
    ok('A3 昨天排期的计划 → carry 组', inGroup(OLD, sp.carry));
    ok('A4 没排期的计划 → undated 组', inGroup(UND, sp.undated));

    /* ---- B 勾完成：核心断言 ---- */
    toggleTodo(FUT);
    sp = tbTodoSplitForDate(today);
    ok('B1 勾完成后 done=true', todoById(FUT).done === true);
    ok('B2 勾完成后仍在 future 组（旧实现：三组都不收 → 消失）', inGroup(FUT, sp.future),
      'future=[' + sp.future.map(function (x) { return x.title; }).join(',') + ']');
    ok('B3 列表里仍然看得见它', inList(FUT));
    ok('B4 行内仍是「已完成」样式（可见 ≠ 看起来没完成）',
      /(^|\s)todo-item(\s|$)/.test((document.querySelector('#todoList .todo-item[data-id="' + FUT + '"]') || {}).className || '') &&
      /(^|\s)done(\s|$)/.test((document.querySelector('#todoList .todo-item[data-id="' + FUT + '"]') || {}).className || ''),
      (document.querySelector('#todoList .todo-item[data-id="' + FUT + '"]') || {}).className);

    /* ---- C 取消勾选：回到原样 ---- */
    toggleTodo(FUT);
    sp = tbTodoSplitForDate(today);
    ok('C1 取消勾选 → done=false', todoById(FUT).done === false);
    ok('C2 取消后仍在 future 组', inGroup(FUT, sp.future));
    ok('C3 取消后明天的块仍在', tbBlocksOf(todoById(FUT), appData.settings, tmw).length === 1,
      tbBlocksOf(todoById(FUT), appData.settings, tmw).length);

    /* ---- D 过期计划勾完成 ----
       ★ 2026-10-21 用户拍板：c103 与 c78 的规则冲突，**以 c103 为准**（G1 不动）。
       本组锁的规则没有变 —— 「完成状态不能静默丢数据」。变的只是「显示不显示」：
       卡可以被降噪藏起来，但 done / 排期快照 / 完成流水 / 日志页全都要在。
       ⚠️ 别为了转绿把本组删掉：删掉等于丢了一条规则，这里只是换一种方式验证同一件事。 */
    toggleTodo(OLD);
    sp = tbTodoSplitForDate(today);
    ok('D1 过期计划勾完成后仍在 carry 组（这是分组逻辑，不是显示逻辑）', inGroup(OLD, sp.carry),
      'carry=[' + sp.carry.map(function (x) { return x.title; }).join(',') + ']');

    /* D2 隐藏 ≠ 丢失①：卡确实不在了 —— querySelector 必须返回 null，
       与 c103 G1「昨天做完的单日任务不显示」是同一条产品规则。 */
    ok('D2 卡从列表消失（降噪，与 c103 G1 同一条规则）',
      document.querySelector('#todoList .todo-item[data-id="' + OLD + '"]') === null);

    /* D2b：这类计划不再出现后，hideDone 开关**不承担「找回来」的职责**。
       两个状态都验，免得以后有人以为点开眼睛按钮就能看见它。
       （开关本身是另一个功能，这里只证明它管不着这一条。） */
    var _hd0 = !!getSortPrefs().todos.hideDone;
    if (!_hd0) toggleTodoDoneHidden();            /* 先切到「隐藏已完成」= 开 */
    renderTodos();
    ok('D2b hideDone=开 时依旧不显示（开关不是它的开关）', !inList(OLD));
    toggleTodoDoneHidden();                        /* 再切到「关」 */
    renderTodos();
    ok('D2b2 hideDone=关 时也不显示（不是被开关藏起来的）', !inList(OLD));
    /* 此刻一定是「关」。原值若是「开」再切一次还原 —— 少切/多切都会污染后面的用例
       （C103 G3「今天做完的照常显示」就是被这个开关漏开的）。 */
    if (_hd0) toggleTodoDoneHidden();
    renderTodos();

    /* D2c/D2d/D2e：数据必须还在 —— 三条独立的证据，任何一条断掉都说明"藏"变成了"丢" */
    var _tD = todoById(OLD);
    ok('D2c 完成状态没跟着卡一起丢（t.done 仍为 true）', !!_tD && _tD.done === true,
      _tD ? String(_tD.done) : 'NO TODO');
    var _snapArr = (appData.todoSchedLog || {})[yest] || [];
    ok('D2d 那天的排期快照还在（日程表历史块仍画得出）',
      _snapArr.some(function (x) { return x && String(x.id) === String(OLD); }),
      'snap[' + yest + ']=' + JSON.stringify(_snapArr.map(function (x) { return x && x.id; })));
    var _doneArr = (appData.todoDoneLog || {})[today] || [];
    ok('D2e 完成记录进了当日流水（不只是内存里翻了个 bool）',
      _doneArr.some(function (x) { return x && String(x.id) === String(OLD); }),
      'doneLog[' + today + ']=' + JSON.stringify(_doneArr.map(function (x) { return x && x.id; })));

    /* D2f：日志页查得到这条完成记录 —— 用户能"看见做过"，只是不在计划卡上 */
    switchView('log');
    renderLogs();
    ok('D2f 日志页查得到这条完成记录',
      [].slice.call(document.querySelectorAll('#logList .done-todo-title')).some(function (el) {
        return String(el.textContent).indexOf('C78 昨天的事') >= 0;
      }),
      String(document.getElementById('logList').textContent.replace(/\s+/g, ' ').slice(0, 80)));
    switchView('plan');
    renderTodos();

    /* 取消勾选 → 立刻回到列表：这才是「隐藏」与「丢失」的分界线。
       （入口不是这张卡，是"改回未完成"这个动作本身 —— 用户 10-21 的口径。） */
    toggleTodo(OLD);
    renderTodos();
    ok('D2g 改回未完成后立刻回到列表（隐藏 ≠ 丢失，误点可撤销）', inList(OLD));

    /* ---- E 未排期计划勾完成 ---- */
    toggleTodo(UND);
    sp = tbTodoSplitForDate(today);
    ok('E1 未排期计划勾完成后仍在 undated 组', inGroup(UND, sp.undated));
    toggleTodo(UND);

    /* ---- F 完成不影响网格：预计块照旧出现在它自己那天 ---- */
    toggleTodo(FUT);
    var blk = tbBlocksOf(todoById(FUT), appData.settings, tmw);
    ok('F1 完成后明天的预计块仍在（完成只管列表归属，不抹历史排期）', blk.length === 1, blk.length);
    ok('F2 块的时间没被动过',
      blk.length === 1 && blk[0].rawStart === tmw + ' 08:30' && blk[0].rawEnd === tmw + ' 09:20',
      blk.length === 1 ? blk[0].rawStart + '~' + blk[0].rawEnd : 'none');
    ok('F3 今天不画它的块（它排在明天）',
      tbBlocksOf(todoById(FUT), appData.settings, today).length === 0);
    toggleTodo(FUT);
  } finally {
    /* ---- G 反证：把旧守卫注回去，B2 必须变红 ---- */
    var _origSplit = window.tbTodoSplitForDate;
    if (typeof _origSplit === 'function') {
      window.tbTodoSplitForDate = function (ds) {
        var r = _origSplit(ds);
        return {
          date: r.date,
          day: r.day,
          carry: r.carry.filter(function (t) { return !t.done; }),
          undated: r.undated,
          future: r.future.filter(function (t) { return !t.done; })
        };
      };
      toggleTodo(FUT);
      var sp2 = window.tbTodoSplitForDate(today);
      ok('G1 反证：把 !t.done 守卫注回去，已完成的未来计划又被丢弃（断言抓得住回归）',
        !inGroup(FUT, sp2.future));
      toggleTodo(FUT);
      window.tbTodoSplitForDate = _origSplit;
    } else {
      ok('G1 反证：tbTodoSplitForDate 不可见（环境问题，跳过）', true);
    }

    /* ---------- H：任何计划都不许从列表里消失（重复计划兜底） ----------
       实测抓到过：重复规则已过期、且当天没命中、也算不出下一块时，
       carry / future / undated 三组都不收 → 计划在列表里无声消失。
       与 10-15「之后的安排」是同一个病，这里补兜底并钉死它。 */
    var EXPR = { id: 788001, title: 'C78 过期重复', quad: 'q2', tag: '测试', pomodoros: 1, done: false, note: '',
      remindAt: null, estEnd: null, createdAt: Date.now() - 40 * 86400e3, subs: [],
      repeat: { freq: 'daily', last: '2026-01-05' } };
    appData.todos.push(EXPR);
    try { renderTodos(); } catch (eR1) { }
    var sp3 = window.tbTodoSplitForDate(today);
    ok('H1 过期重复计划仍被某一组收下（不再静默消失）',
      inGroup(EXPR.id, sp3.carry) || inGroup(EXPR.id, sp3.future) || inGroup(EXPR.id, sp3.undated) || inGroup(EXPR.id, sp3.day));
    ok('H2 列表里能看到它', listText().indexOf('C78 过期重复') >= 0);
    ok('H3 总数守恒：所有分组加起来 == appData.todos.length',
      (sp3.day.length + sp3.carry.length + sp3.future.length + sp3.undated.length) === appData.todos.length);

    appData.todos = bTodos;
    appData.records = bRecs;
    appData.todoSchedLog = bLog;
    try { tbInvalidateSegIndex(); } catch (e) { }
    try { renderTodos(); } catch (e2) { }
    try { tbGoToday(); } catch (e3) { }
    try { saveData(); } catch (e4) { }
  }
  return JSON.stringify(R);
})();
