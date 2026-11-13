/* C98 —— 自由专注快照「不该复活」两道门 + 冷启动回到上次的页面

   「我选着选择计划呢，突然就变成那个计时界面，说我在计时洗漱 ——
   可我早就结束了、还在日志里把那条记录删了，数据好像回滚了一样。」

   两个真问题：
   ① 「结束」弹窗开着时计时还在跑，此刻页面被系统回收 → 快照里是一段"活的"计时，
      重载后 restoreFreeSnapshot 无条件 running，这段就复活了。
      → 落地 pendingFreeSettle：恢复时重弹结算窗，绝不自己接着跑。
      另加陈旧门：快照超过 8 小时 = 断头会话，丢弃（否则正计时永远不会自己结束，能"跑"好几天）。
   ② 地址栏 hash 是关着写的（0B WRITE_HASH=false）→ 页面重载后必然回到默认的计时页。
      → 每次切页记视图名，冷启动回到那一页。

   反证：把两道门关掉（直接走原分支），B/C 组必须变红。 */

(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var now = Date.now();
  var H = 3600 * 1000;

  var _saveSnap = appData.timerSnapshot;
  var _savePf = appData.pendingFreeSettle;
  var _saveTimer = timerState;
  var _saveFreeType = window._freeType;

  function freeSnap(ageMs, over) {
    var s = {
      mode: 'free',
      freeType: 'stopwatch',
      running: true,
      startTime: now - ageMs,
      savedAt: now - ageMs,
      remaining: Math.floor(ageMs / 1000),
      totalDuration: 0,
      pausedElapsed: 0,
      taskName: '洗漱',
      note: '',
      linkedTodoId: null
    };
    if (over) for (var k in over) s[k] = over[k];
    return s;
  }

  /* ---------- A 陈旧快照：丢弃，不复活 ---------- */
  appData.timerSnapshot = freeSnap(9 * H);
  appData.pendingFreeSettle = null;
  timerState = createTimerState({ mode: 'idle' });
  restoreFreeSnapshot(appData.timerSnapshot, now);
  ok('A1 超过 8 小时的快照不复活（不 running）', timerState.running !== true, timerState.running);
  ok('A2 陈旧快照被清掉', appData.timerSnapshot === null, String(appData.timerSnapshot));
  ok('A3 陈旧快照不把任务名带回界面', (timerState.taskName || '') !== '洗漱', timerState.taskName);
  ok('A4 陈旧收尾后回到待命', timerState.mode === 'idle', timerState.mode);

  /* ---------- B 正常快照仍然恢复（反证：别把门做成把正常情况也干掉） ---------- */
  appData.timerSnapshot = freeSnap(30 * 60 * 1000);
  appData.pendingFreeSettle = null;
  timerState = createTimerState({ mode: 'idle' });
  restoreFreeSnapshot(appData.timerSnapshot, now);
  ok('B1 半小时前的正计时照常恢复成在跑', timerState.running === true, timerState.running);
  ok('B2 恢复后名字还是「洗漱」', timerState.taskName === '洗漱', timerState.taskName);
  ok('B3 恢复后模式是自由专注', timerState.mode === 'free', timerState.mode);

  /* 收尾，避免这层"在跑"污染后面的用例 */
  try { resetFreeUI(); } catch (e) { }

  /* ---------- C 已点「结束」但没选怎么记：重弹结算，不自己跑 ---------- */
  /* 恢复路径只在「页面刚加载」时跑，那一刻 DOM 是新的 → 两个输入框必然是空的。
     同一页里连跑多条用例时输入框会残留上一条的值，而 openFreeSettle 的产品规则是
     「输入框有值以输入框为准（用户可能刚改过）」→ 不清就会把「重载后名字带没带回来」
     测成「输入框优先级」。这里按真实启动现场清空，再验恢复。 */
  (function () {
    var _ci = document.getElementById('currentTodoInput');
    if (_ci) _ci.value = '';
    var _cn = document.getElementById('currentTodoNote');
    if (_cn) _cn.value = '';
  })();
  appData.timerSnapshot = freeSnap(40 * 60 * 1000);
  appData.pendingFreeSettle = {
    secs: 2400, at: now - 60 * 1000, freeType: 'stopwatch', taskName: '洗漱', note: '', linkedTodoId: null
  };
  timerState = createTimerState({ mode: 'idle' });
  restoreFreeSnapshot(appData.timerSnapshot, now);
  ok('C1 待结算态不自己跑', timerState.running !== true, timerState.running);
  ok('C2 待结算态保留已跑时长', timerState.pausedElapsed === 2400, timerState.pausedElapsed);
  ok('C3 待结算态把名字带回来（否则弹窗里是空任务）', timerState.taskName === '洗漱', timerState.taskName);
  var fm = document.getElementById('finishModal');
  ok('C4 结算窗被重新打开', !!(fm && fm.classList.contains('show')), fm ? fm.className : 'no modal');
  ok('C5 待结算期间不再留「在跑」的快照', appData.timerSnapshot === null, String(appData.timerSnapshot));

  /* ---------- D 过期的待结算：直接作废 ---------- */
  appData.timerSnapshot = null;
  appData.pendingFreeSettle = { secs: 600, at: now - 10 * H, freeType: 'stopwatch', taskName: '洗漱' };
  timerState = createTimerState({ mode: 'idle' });
  var gotD = restorePendingFreeSettle({ mode: 'free' }, now);
  ok('D1 超过 8 小时的待结算不再弹窗', gotD === false, gotD);
  ok('D2 过期待结算被清掉', !appData.pendingFreeSettle, JSON.stringify(appData.pendingFreeSettle));

  /* ---------- E 点「结束」即记账（不靠内存，重载也认） ---------- */
  try { closeModal('finishModal'); } catch (e) { }
  appData.pendingFreeSettle = null;
  appData.timerSnapshot = {
    mode: 'free', freeType: 'stopwatch', running: true, startTime: now - 600000,
    savedAt: now - 1000, remaining: 600, totalDuration: 0, pausedElapsed: 0,
    taskName: '洗漱', note: '', linkedTodoId: null
  };
  timerState = createTimerState({
    mode: 'free', freeType: 'stopwatch', running: true,
    startTime: now - 600000, pausedElapsed: 0, taskName: '洗漱'
  });
  window._freeType = 'stopwatch';
  finishFreeTimer();
  var pfE = appData.pendingFreeSettle;
  ok('E1 点结束就落下待结算标记', !!(pfE && pfE.secs > 590 && pfE.secs < 700), JSON.stringify(pfE && pfE.secs));
  ok('E2 标记里带着任务名', !!(pfE && pfE.taskName === '洗漱'), pfE && pfE.taskName);
  ok('E3 标记落盘（有 at 时间戳）', !!(pfE && Number(pfE.at) > 0), pfE && pfE.at);
  try { closeModal('finishModal'); } catch (e) { }
  appData.pendingFreeSettle = null;

  /* ---------- F 冷启动回到上次那一页 ---------- */
  localStorage.removeItem('tf_last_view');
  /* 模拟"切到计划页" */
  switchView('plan');
  ok('F1 切页后记住了视图', localStorage.getItem('tf_last_view') === 'plan', localStorage.getItem('tf_last_view'));
  /* 模拟"重载后默认在计时页"：必须走 switchViewCore（switchView 会顺手把记忆也改成 timer，
     那就等于什么都没测）*/
  switchViewCore('timer');
  ok('F2 现在是计时页', document.getElementById('view-timer').classList.contains('active'), '');
  var moved = restoreLastView();
  ok('F3 冷启动回到计划页', moved === true && document.getElementById('view-plan').classList.contains('active'),
    String(moved) + ' / ' + (document.querySelector('.view.active') || {}).id);
  /* hash 优先：地址栏明确指定就别抢 */
  location.hash = '#log';
  switchViewCore('timer');
  var moved2 = restoreLastView();
  ok('F4 地址栏带 hash 时不抢它的目标页', moved2 === false && document.getElementById('view-timer').classList.contains('active'),
    String(moved2));
  history.replaceState(null, '', location.pathname + location.search);

  /* ---------- 还原 ---------- */
  try { closeModal('finishModal'); } catch (e) { }
  appData.timerSnapshot = _saveSnap;
  appData.pendingFreeSettle = _savePf;
  timerState = _saveTimer;
  window._freeType = _saveFreeType;
  localStorage.removeItem('tf_last_view');
  return JSON.stringify(R);
})();
