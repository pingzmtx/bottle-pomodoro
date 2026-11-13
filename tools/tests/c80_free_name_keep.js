/* C80 自由专注（正计时/流式）不许把用户填的名字弄丢

   现象（用户 10-18 报）：正计时里明明填了任务名和备注，结算后日程表的实际块和日志标题
   都只剩「正计时 2 分钟」，看起来像没填过。

   根因：openFreeSettle 只从 DOM 读 currentTodoInput/currentTodoNote。
   页面重载（WebView 被回收）或换视图重建 DOM 后输入框是空的 —— 会话里明明有名字，
   却被 `_ffTyped || freeSettleNote` 退回成「正计时 N 分钟」。
   记录标题与日程块标题都取 r.taskName，于是两处一起错。

   断言：
     A 输入框有值 → 以输入框为准
     B 输入框空、会话里有名字 → 仍用会话名（核心反证）
     C 备注同理
     D 会话名就是「自由专注」且没输入 → 才允许退化成「正计时 N 分钟」
     E 真的落库：record.taskName 不是「正计时…」
     F 恢复现场回填输入框；已有值不覆盖
   全程真状态，finally 复原。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  function el(id) { return document.getElementById(id); }
  var b = {
    mode: timerState.mode, running: timerState.running, taskName: timerState.taskName,
    note: timerState.note, linked: timerState.linkedTodoId, pending: appData.pendingFinish || null,
    startTime: timerState.startTime, pausedElapsed: timerState.pausedElapsed,
    inName: el('currentTodoInput') ? el('currentTodoInput').value : '',
    inNote: el('currentTodoNote') ? el('currentTodoNote').value : '',
    recs: appData.records.length
  };
  function clearPending() {
    appData.pendingFinish = null; timerState.pendingFinish = null;
    try { closeModal('finishModal'); } catch (e) { }
  }
  function settle(nameVal, noteVal, sessName, sessNote) {
    clearPending();
    if (el('currentTodoInput')) el('currentTodoInput').value = nameVal;
    if (el('currentTodoNote')) el('currentTodoNote').value = noteVal;
    timerState.mode = 'free';
    timerState.linkedTodoId = null;
    timerState.taskName = sessName;
    timerState.note = sessNote;
    openFreeSettle(130);
    return appData.pendingFinish || timerState.pendingFinish || null;
  }
  try {
    // A 输入框有值：以输入框为准
    var pfA = settle('输入框的名字', '输入框的备注', '会话里的旧名字', '会话旧备注');
    ok('A1 输入框有名字 → 用它', !!pfA && pfA.taskName === '输入框的名字');
    ok('A2 输入框有备注 → 用它', !!pfA && pfA.note === '输入框的备注');

    // B 输入框被清空（重载/重建）：会话名要顶上（这是本次修复的核心）
    var pfB = settle('', '', '写周报总结', '第三季度');
    ok('B1 输入框空了，仍用会话里的名字（不退化成「正计时 N 分钟」）',
      !!pfB && pfB.taskName === '写周报总结');
    ok('B2 备注同理', !!pfB && pfB.note === '第三季度');

    // C 备注：输入框空、会话有备注
    var pfC = settle('', '', '只有名字', '会话里的备注');
    ok('C1 名字取会话名', !!pfC && pfC.taskName === '只有名字');
    ok('C2 备注取会话备注', !!pfC && pfC.note === '会话里的备注');

    // D 真的什么都没填，才允许用「正计时 N 分钟」
    var pfD = settle('', '', '自由专注', '');
    ok('D1 什么都没填时，标题才退回「正计时…」', !!pfD && pfD.taskName.indexOf('正计时') >= 0);

    // E 落库：记录标题不许是「正计时…」
    var pfE = settle('', '', '落库验证计划名', '落库备注');
    timerState.running = false;
    timerState.mode = 'free';
    timerState.startTime = Date.now() - 130 * 1000;
    timerState.pausedElapsed = 130;
    if (pfE) { pfE.secs = 130; }
    confirmFinish();
    var rec = appData.records[appData.records.length - 1];
    ok('E1 记录已生成', appData.records.length === b.recs + 1 && !!rec);
    ok('E2 记录标题用用户填的名字', !!rec && rec.taskName === '落库验证计划名');
    ok('E3 记录标题不是「正计时…」', !!rec && String(rec.taskName || '').indexOf('正计时') < 0);
    ok('E4 记录备注也是用户填的', !!rec && rec.note === '落库备注');

    // F 恢复现场回填输入框
    if (el('currentTodoInput')) el('currentTodoInput').value = '';
    if (el('currentTodoNote')) el('currentTodoNote').value = '';
    timerState.taskName = '回填测试';
    timerState.note = '回填备注';
    refillTimerInputs();
    ok('F1 输入框空 → 回填成会话里的名字', !!el('currentTodoInput') && el('currentTodoInput').value === '回填测试');
    ok('F2 备注也回填', !!el('currentTodoNote') && el('currentTodoNote').value === '回填备注');
    el('currentTodoInput').value = '用户刚改的';
    refillTimerInputs();
    ok('F3 输入框已有值时不覆盖（用户可能刚改过）', el('currentTodoInput').value === '用户刚改的');

    // G 反证哨兵：会话名是「自由专注」占位值时不当成用户输入
    var pfG = settle('', '', '自由专注', '');
    ok('G1 占位名「自由专注」不冒充用户输入', !!pfG && pfG.taskName !== '自由专注');
  } catch (e) {
    ok('★ 用例抛异常：' + (e && e.message), false);
  } finally {
    clearPending();
    timerState.mode = b.mode; timerState.running = false;
    timerState.taskName = b.taskName; timerState.note = b.note;
    timerState.linkedTodoId = b.linked; timerState.startTime = b.startTime;
    timerState.pausedElapsed = b.pausedElapsed;
    appData.pendingFinish = b.pending;
    if (el('currentTodoInput')) el('currentTodoInput').value = b.inName;
    if (el('currentTodoNote')) el('currentTodoNote').value = b.inNote;
    try { if (appData.records.length > b.recs) appData.records.length = b.recs; } catch (e2) { }
    try { saveData(); } catch (e3) { }
  }
  return JSON.stringify(R);
})();
