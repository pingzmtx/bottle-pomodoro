/* C36 计时页「子任务卡」的显示链路
   计时界面：子任务卡有时显示、有时不显示。
   根因：卡片显不显示**只看 timerState.linkedTodoId**，而这个值在两处会变成「没人重画」：
     · 刷新/切走再回来后（restoreTimerSnapshot 恢复了 link，却没人调 renderTimerSubs）
     · 切回计时页时（switchView('timer') 只 updateTimerDisplay，不重画卡片）
   外加一路本来就绑不上：在任务框里**打名字**（不走下拉选择）时，代码没有做名字→计划的反查。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var todosBak = JSON.stringify(appData.todos || []);
  var DISK = function () {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) return null;
      var d = (typeof raw.d === 'string') ? JSON.parse(raw.d) : raw;
      return (d && d.timerSnapshot) || null;
    } catch (e) { return null; }
  };
  function box() { return document.getElementById('timerSubsBox'); }
  function cardVisible() { var b = box(); return !!b && b.style.display !== 'none' && b.innerHTML.indexOf('第1题') >= 0; }
  function cardWiped() { var b = box(); if (b) { b.style.display = 'none'; b.innerHTML = ''; } return !!b; }
  function resetTimer() {
    if (typeof resetToIdle === 'function') resetToIdle();
    if (typeof clearTimerSnapshot === 'function') clearTimerSnapshot();
  }
  function pick(id) {
    if (typeof refreshTodoSelect === 'function') refreshTodoSelect();
    var sel = document.getElementById('currentTodoSelect');
    if (sel) { sel.value = String(id); }
    return sel;
  }
  function typeName(v) {
    var inp = document.getElementById('currentTodoInput');
    if (inp) { inp.value = v; }
    var sel = document.getElementById('currentTodoSelect');
    if (sel) { sel.value = ''; }
    return !!inp;
  }

  try {
    if (typeof switchView === 'function') switchView('timer');
    resetTimer();
    appData.todos = [{
      id: 9001, title: '数学卷子', done: false, detail: '看第3章',
      subs: [{ id: 90011, title: '第1题', done: false }, { id: 90012, title: '第2题', done: false }]
    }];
    saveData();

    // ① 选了计划再开始 → 卡片出现在计时页
    pick(9001);
    if (typeof startPomodoroCore === 'function') startPomodoroCore();
    ok('① 选中计划开始番茄后，子任务卡可见', cardVisible());
    ok('①b 关联的计划 id 已写入 timerState', String(timerState.linkedTodoId || '') === '9001');

    // ② 快照必须带上这个关联（否则重启后无从恢复）
    if (typeof saveTimerSnapshot === 'function') saveTimerSnapshot();
    var snap = (typeof DISK === 'function') ? DISK() : null;
    ok('② 快照里带 linkedTodoId（重启后能恢复关联）', !!snap && String(snap.linkedTodoId || '') === '9001');

    // ③ 恢复路径：清掉内存里的关联 + 清空卡片 DOM，再跑一次恢复
    //    —— 这就是「切走被回收 / 刷新」之后发生的事
    cardWiped();
    timerState.linkedTodoId = null;
    if (typeof restoreTimerSnapshot === 'function') restoreTimerSnapshot();
    ok('③ 恢复后关联回来了（旧版这里没恢复）', String(timerState.linkedTodoId || '') === '9001');
    ok('③b 恢复后卡片自动重画（旧版是空白，这就是「有时不显示」）', cardVisible());

    // ④ 切走再切回计时页 → 卡片要在（switchView 也必须负责重画）
    cardWiped();
    if (typeof switchView === 'function') switchView('plan');
    if (typeof switchView === 'function') switchView('timer');
    ok('④ 切走再切回计时页，卡片重新出现', cardVisible());

    // ⑤ 手动打名字（不走下拉）也要能自动认领计划 —— 这是「有时不显示」的另一半
    resetTimer();
    typeName('数学卷子');
    if (typeof startPomodoroCore === 'function') startPomodoroCore();
    ok('⑤ 打名字开始也能自动关联该计划', String(timerState.linkedTodoId || '') === '9001');
    ok('⑤b 打名字开始的子任务卡同样可见', cardVisible());

    // ⑥ 打一个不对应的名字 → 不该乱绑、卡片不显示
    resetTimer();
    typeName('背单词');
    if (typeof startPomodoroCore === 'function') startPomodoroCore();
    ok('⑥ 名字对不上时不乱绑计划', !timerState.linkedTodoId);
    ok('⑥b 没关联时子任务卡不显示', !cardVisible());

    // ⑦ 手动输入时不许覆盖计划本身的备注（detail）—— 这是「自动认领」的护栏
    resetTimer();
    appData.todos[0].detail = '看第3章';
    typeName('数学卷子');
    if (typeof startPomodoroCore === 'function') startPomodoroCore();
    ok('⑦ 自动认领不覆盖计划备注', appData.todos[0].detail === '看第3章');

    // ⑧ 只写了名字的前几个字 → 不许误绑（必须完整匹配）
    resetTimer();
    typeName('数学卷');
    if (typeof startPomodoroCore === 'function') startPomodoroCore();
    ok('⑧ 名字不完整时不误绑', !timerState.linkedTodoId);

    // ⑨ ★ 收口：计时页是子任务「预计番茄」最后一个还会露出 🍅N 的地方，
    //    已随计划行/编辑面板/新建弹窗/记录卡一起移除。老存档里 subs[].pomodoros 还在，
    //    这里故意塞一个值进去 —— 卡片照画、但绝不能把数字画出来（谁把它加回来，这条先红）。
    resetTimer();
    appData.todos[0].subs[0].pomodoros = 2;
    appData.todos[0].subs[1].pomodoros = 1.5;
    typeName('数学卷子');
    if (typeof startPomodoroCore === 'function') startPomodoroCore();
    var sh = box() ? box().innerHTML : '';
    ok('⑨ 计时页子任务卡仍在（值不影响卡片本身）', cardVisible());
    ok('⑨b 计时页子任务行不再显示 🍅N（全站口径：子任务番茄不显示）',
       sh.indexOf('🍅') < 0);
    ok('⑨c 子任务数据本身没被删（老存档字段只藏不删）',
       appData.todos[0].subs[0].pomodoros === 2 && appData.todos[0].subs[1].pomodoros === 1.5);
  } catch (e) {
    ok('用例执行未抛异常: ' + (e && e.message), false);
  } finally {
    try {
      resetTimer();
      appData.todos = JSON.parse(todosBak || '[]');
      if (typeof saveDataNow === 'function') saveDataNow(); else saveData();
    } catch (e2) { ok('还原期异常不影响结论', true); }
  }
  return JSON.stringify(R);
})()
