/* C130 —— 只勾子计划、整条计划没打勾，也要在日志「今天完成」里留痕

   用户：「我勾了一个子计划，它只显示今日完成的。假如我今天完成了一个子计划，
   它应该给我记录呀。就是我没把整个计划打勾，我就完成一个子计划，我觉得它应该也记录」。
   口径（用户当面选的）：
     · 显示：挂在主计划下，主行不挂 ✅，改显示「做了 1/3 步」
     · 计数：「完成 · N 项」只数整条打勾的，子计划不占名额

   另外修了第二个洞：在番茄结算弹窗里补勾的子计划，落库时 planSubs 按结束时刻
   截断会把 doneAt 更晚的那步判成没完成 → settleSubsEdited 时不做截断。

     A 只勾子计划 → 当天 todoDoneLog 里出现一条 partial，subs 同步
     B 计数：todosDoneOn / 完成条标题都把 partial 排除
     C 整条打勾 → 原地升级成完成，不产生第二条
     D 子计划全取消 → partial 条撤掉（今天对这条计划真没留下什么）
     E 结算补勾标记 → planSubs 快照不截断；没标记时仍按结束时刻截断
     F 日志渲染：主行半环 + 「做了 N/M 步」，条目文案不写「完成 0 项」
*/
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }
  var today = getTodayStr();
  var bak = {
    todos: appData.todos.slice(),
    log: JSON.parse(JSON.stringify(appData.todoDoneLog || {}))
  };

  var t = { id: 1301, uid: 'u1301', title: '测试计划', done: false, subs: [
    { id: 's1', title: '测试步骤一', done: false },
    { id: 's2', title: '测试步骤二', done: false },
    { id: 's3', title: '测试步骤三', done: false }
  ] };
  appData.todos = [t];
  appData.todoDoneLog = {};

  /* ---- A 只勾一个子计划 ---- */
  toggleTodoSub(1301, 0);
  var arr = appData.todoDoneLog[today] || [];
  ok('A1 出现一条流水', arr.length === 1, arr.length);
  ok('A2 标成 partial（计划本身没完成）', !!(arr[0] && arr[0].partial), JSON.stringify(arr[0] && arr[0].partial));
  ok('A3 步骤快照跟着记（第 1 步已完成）',
     !!(arr[0] && arr[0].subs && arr[0].subs[0] && arr[0].subs[0].d) &&
     !!(arr[0] && arr[0].subs && arr[0].subs[1] && !arr[0].subs[1].d),
     JSON.stringify(arr[0] && arr[0].subs));

  /* ---- B 计数不占名额 ---- */
  ok('B1 todosDoneOn 不把 partial 算成做完一项', todosDoneOn(today) === 0, todosDoneOn(today));
  var strip = doneTodosStripHtml(today);
  ok('B2 完成条里出现了这条计划名', strip.indexOf('测试计划') >= 0, strip.slice(0, 80));
  ok('B3 标题写「推进了 N 条计划」而不是「完成 0 项」',
     strip.indexOf('推进了 1 条计划') >= 0 && strip.indexOf('完成 · 0 项') < 0,
     (strip.match(/done-todo-label">([^<]*)/) || [])[1]);
  ok('B4 主行是半环 + 做了 1/3 步', strip.indexOf('done-todo-check part') >= 0 && strip.indexOf('做了 1/3 步') >= 0,
     strip.indexOf('做了 1/3 步'));
  ok('B5 主行没挂 ✅', strip.indexOf('done-todo-check">✅') < 0, strip.indexOf('done-todo-check">✅'));

  /* ---- C 整条打勾 → 原地升级 ---- */
  t.done = true;
  _logTodoDone(t);
  var arr2 = appData.todoDoneLog[today] || [];
  ok('C1 没有多出第二条', arr2.length === 1, arr2.length);
  ok('C2 partial 标记被清掉', !arr2[0].partial, String(arr2[0].partial));
  ok('C3 现在算完成一项', todosDoneOn(today) === 1, todosDoneOn(today));

  /* ---- D 回到「只勾子计划」，全取消后撤条 ---- */
  t.done = false;
  _unlogTodoDone(t);
  var arr3 = appData.todoDoneLog[today] || [];
  ok('D1 取消整条完成、子计划还勾着 → 退回 partial', arr3.length === 1 && !!arr3[0].partial, JSON.stringify(arr3[0] || null));
  toggleTodoSub(1301, 0); /* 撤掉唯一勾着的子计划 */
  var arr4 = appData.todoDoneLog[today] || [];
  ok('D2 子计划全取消 → 这条流水也撤掉', arr4.length === 0, arr4.length);

  /* ---- E 结算窗补勾：快照不截断 ---- */
  t.subs[1].done = true;
  t.subs[1].doneAt = Date.now() + 60000; /* 故意晚于记录结束时刻 */
  var cut = Date.now();
  var snapCut = snapshotPlanSubs(t, cut);
  ok('E1 不补勾时按结束时刻截断（晚于结束的步骤算没完成）', snapCut[1].d === false, JSON.stringify(snapCut));
  timerState.settleSubsEdited = true;
  var snapFree = snapshotPlanSubs(t, 0);
  ok('E2 结算窗补勾过 → 同一份快照不做截断', snapFree[1].d === true, JSON.stringify(snapFree));
  timerState.settleSubsEdited = false;

  /* ---- F 结算弹窗渲染 ---- */
  timerState.linkedTodoId = 1301;
  var wrap = document.getElementById('finishSubsWrap');
  var box = document.getElementById('finishSubsBox');
  if (wrap && box) {
    renderFinishSubs();
    ok('F1 结算弹窗列出了子计划', wrap.style.display !== 'none' && box.innerText.indexOf('测试步骤一') >= 0,
       box.innerText.replace(/\s+/g, ' ').slice(0, 60));
    ok('F2 有已勾的步骤时行带 done 类', !!box.querySelector('.finish-sub-row.done'));
    var before = (appData.todoDoneLog[today] || []).length;
    toggleFinishSub(2);
    ok('F3 结算窗点一下 = 子计划勾上', !!t.subs[2].done, String(t.subs[2].done));
    ok('F4 同时写进日志流水（partial 条）', (appData.todoDoneLog[today] || []).length === 1, before);
    ok('F5 标记 settleSubsEdited 供落库免截断', timerState.settleSubsEdited === true, String(timerState.settleSubsEdited));
  } else {
    ok('F1 结算弹窗容器存在', false, 'finishSubsWrap/finishSubsBox 缺失');
  }

  appData.todos = bak.todos;
  appData.todoDoneLog = bak.log;
  timerState.linkedTodoId = null;
  timerState.settleSubsEdited = false;
  try { renderTodos(); renderLogs(); saveData(); } catch (e) { /* 测试环境 */ }
  return JSON.stringify(R);
})();
