/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 计时核心：对外=timerState 相关 API 与跨天处理。
 * 红线：计时进行中禁止塞打扰 UI；跨天/回拨逻辑只许小步修+回归。 */
/* ==================== 模块: 02-timer.js | 职责: 计时层——番茄钟引擎、打断、休息、音效、通知 | 分组: timer ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：02-timer.js
 * 分组：timer
 * 职责：计时层——番茄钟引擎、打断、休息、音效、通知
 * 功能：
 *   - 番茄钟主体：toggleTimer / startPomodoro / onTimerComplete / finishPomodoro / resetToIdle / 自然完成待结算持久化（pendingFinish 恢复弹窗，防关页丢番茄）
 *   - 倒计时引擎：startTimerLoop / stopTimerLoop / 时间校准 / 模糊计时 / 快照保存恢复
 *   - 打断系统：interruptPomodoro / resumeFromInterrupt / 打断分类与容忍
 *   - 休息系统：短休/长休/微休（startBreak / checkLongBreakTrigger / 微休息调度）
 *   - 休息骰子：BD_REST_ACTIVITIES 活动池 / bdRoll 随机推荐
 *   - 番茄掉落动效与通知：showTomatoDropAnimation / notify / WakeLock 保持亮屏（playSound 定义在 04-ui.js，本模块只负责调用）
 *   - 沉浸式专注：开始专注抽角色卡入口（startPomodoro 拆分）、短休触发章节过渡页、冒险期抑制长休
 *   - 白帽游戏化：心流推荐时长应用 / 疲劳检测提示 / 可变休息时长 / 休息冷知识 / 结束仪式鼓励语
 * 函数索引（TOC）：__replaceApplyTimerModeUI/toggleTimer/strategyOfFreeType/timerStrategy/isFreeMode/toggleFreeMode/switchTimerMode/applyTimerModeUI/resolveFreeLink/refillTimerInputs/toggleFreeTimer/finishFreeTimer（+80 更多）
 * ============================================================ */

/* 跨模块函数替换的唯一入口（01g 用它包一层同步 UI） */
function __replaceApplyTimerModeUI(fn) { applyTimerModeUI = fn; }
function toggleTimer() {
  if (timerState.mode === 'idle') {
    UIFX.showCountdown321(function () {
      startPomodoro();
    });
  }
}
/* ===== 计时模式：自由专注（正计时） =====
   入口是计时页的「⏱ 自由专注」小按钮，点一次切到正计时、再点回番茄钟。
   正计时按「25 分钟 = 1 个完整🍅」折算（与 50/90 分钟难度档位同一口径）：
   整番茄结算 → 写 records（日历/统计/海报可见）+ addTreePoints（树积分=成长 + 金币=货币 同时到账）；
   不足 25 分钟 → 不写统计，给少量鼓励金币。不触发段位/扭蛋/下注/成就（避免污染番茄钟主流程）。 */
let timerMode = 'pomodoro'; /* pomodoro/stopwatch（不持久化，刷新回番茄钟） */

/* ================= 计时模式策略表 =================
   设计出处：Super Productivity 的 `focus-mode-strategies.ts` ——
   每种计时模式实现同一组「问什么答什么」，链路只查表，不再到处 `if (是不是流式)`。
   收益：① 改某个模式的行为只动它那一个对象，不会漏改别处；
        ② 加第四种模式 = 加一个对象，链路一行不动；
        ③ 「两个分支其实一样」这类死代码一眼可见（一个对象只写一份）。

   ★ 三个模式键由现有两个字段组合而来，**不动数据模型**
     （`timerMode` / `freeType` 照旧存储；快照、恢复、导入导出全不受影响）：
       timerMode='pomodoro'                     → pomodoro
       timerMode='free' + freeType='stopwatch'  → stopwatch
       timerMode='free' + freeType='flowtime'   → flowtime
   ★ 本表**只收编已有分支的判定**，算法一个字符没改 —— 行为逐字节等价。
     每个字段都能指回一处真实判定（见各行注释），不是凭空设计的抽象。 */
const TIMER_STRATEGIES = {
  pomodoro: {
    key: 'pomodoro', label: '番茄钟', free: false, clsSuffix: '',
    countsDown: true,               /* 计时方向：往下数（tick 的倒计时分支） */
    freezesRemainingOnPause: false, /* 暂停时是否冻结「那一刻的剩余」 */
    resumesFromRemaining: false,    /* 继续时是否用 pausedRemaining 重设 endAt */
    supportsTimeAdjust: false,      /* ±5 分钟调节是否有意义 */
    ringFromRemaining: true,        /* 进度环由「剩余 / 总时长」推 */
    elapsedIsRemaining: false,      /* 小圆点的「已用秒数」是不是就存在 remaining 里 */
    settleWord: '番茄'
  },
  stopwatch: {
    key: 'stopwatch', label: '正计时', free: true, clsSuffix: 'free-stopwatch',
    countsDown: false,              /* 从 0 累计往上走，没有"到点" */
    freezesRemainingOnPause: false,
    resumesFromRemaining: false,
    supportsTimeAdjust: false,      /* 从 0 累计，不存在「剩余时长」概念（v5.7.6 起直接拒绝） */
    ringFromRemaining: false,       /* 进度环恒 0 */
    elapsedIsRemaining: true,       /* remaining 里存的就是「已跑秒数」 */
    settleWord: '正计时'
  },
  flowtime: {
    key: 'flowtime', label: '流式', free: true, clsSuffix: 'free-flowtime',
    countsDown: true,               /* 定长倒计时，到点弹「要不要继续」 */
    freezesRemainingOnPause: true,  /* 暂停要把那一刻的剩余记进 pausedRemaining */
    resumesFromRemaining: true,     /* 继续时用它重设 endAt，不把暂停时长算进去 */
    supportsTimeAdjust: true,
    ringFromRemaining: true,
    elapsedIsRemaining: false,
    settleWord: '流式计时'
  }
};
/** 自由子模式（stopwatch / flowtime）的策略 —— 旧代码里 `freeType === 'flowtime' ? … : …` 的等价取法。
    上下文**已确定是自由模式**时用这个（如 tick 内部）；要组合判定用 timerStrategy()。 */
function strategyOfFreeType(ft) {
  return ft === 'flowtime' ? TIMER_STRATEGIES.flowtime : TIMER_STRATEGIES.stopwatch;
}
/** 当前模式的策略（timerMode + freeType 组合判定；读不到就按番茄钟兜底，与旧默认值一致）。 */
function timerStrategy() {
  if (timerMode === 'pomodoro') return TIMER_STRATEGIES.pomodoro;
  return strategyOfFreeType(timerState && timerState.freeType);
}
/** 「是不是自由专注（正计时/流式）」—— 取代散落的 `timerMode !== 'pomodoro'`。 */
function isFreeMode() {
  return timerMode !== 'pomodoro';
}
/* 当前"开着"的实际时段属于哪个任务 —— 收段时不能信 timerState.linkedTodoId：
   打断/休息/重置都可能先把 mode 与 linkedTodoId 清掉，那样这一段就永远开着，
   网格里会画出一条一直长到现在的假色块。谁开的段，由它自己记着。 */
let _tbOpenSegTodoId = null;
/* ★ 收段用的「已知真实结束时刻」：自然到点时由 onTimerComplete 塞进来。
   为什么不能靠 closeTodoActualSeg 自己取 Date.now()：tick 会被后台/锁屏节流 ——
   5:18 开始、5:43 到点，人 6:01 才回到 App，tick 那一刻才触发 onTimerComplete，
   于是记录按 endAt 写 5:43（对），段落却按"现在"收到 6:01（错）：
   计划卡「✅ 5:18~6:01」、日程色块撑成 43 分钟，而日志卡写着 25 分钟 —— 三个页面各说一套。
   谁开的段谁记着，哪一刻真的结束也由知道的那一刻传进来。 */
let _tbSegEndAt = 0;
let _lastSnapshotAt = 0; /* 上次快照落盘时间戳（tick 内 15s 节流重写快照用） */
let _dotLastDeg = 0;     /* 小圆点上一帧角度（度）。用于判断该平滑过渡还是瞬间归位——
                            只有正常 +6°/秒 才过渡；重开会话/后台跳变一律瞬间归位，免长弧倒扫。 */
function toggleFreeMode() {
  /* 专注进行中不允许切到自由专注（避免误触丢番茄） */
  if (timerMode === 'pomodoro' && timerState && timerState.mode === 'focus' && timerState.running) {
    UIFX.toast('⏳ 当前番茄专注进行中，先完成或结束后再切自由专注');
    return;
  }
  switchTimerMode(timerMode === 'pomodoro' ? 'stopwatch' : 'pomodoro');
}
function switchTimerMode(m) {
  if (timerMode === m) return;
  timerMode = m;
  if (timerState.mode === 'focus' && timerState.running) {
    stopTimerLoop();
    releaseWakeLock();
    UIFX.toast('已放弃当前番茄，切换为自由专注');
  }
  resetFreeUI();
  applyTimerModeUI();
  UIFX.syncFlowDurUI();
  updateFreeInfo();
  UIFX.playSound('tap');
}
function applyTimerModeUI() {
  const isFree = isFreeMode();
  const fi = document.getElementById('freeInfo');
  if (fi) fi.style.display = isFree ? 'block' : 'none';
  /* 本轮读数 / 结束本轮：交给 updateRoundStats 按「这一轮有没有东西」决定
     —— 直接在这里写 display 会把空态判断盖掉（它俩都在切模式时跑）。
     自由专注没有「轮」的概念，额外强制藏掉。 */
  UIFX.updateRoundStats();
  if (isFree) {
    const rslF = document.getElementById('roundStatsLine');
    if (rslF) rslF.style.display = 'none';
    const siF = document.getElementById('sessionInfo');
    if (siF) siF.style.display = 'none';
  }
  /* 自由专注也要能填任务名/备注、能记录。
     原先这里把整个 .current-todo-section 藏掉 → 自由专注时没有任何输入口，
     记录里永远只有写死的「自由专注」。现改为只藏番茄专属的部件：
       · 任务难度（选填）—— 它是给番茄定时长的，自由专注有自己的一轮时长
       · 心流时长建议 —— 同上
     ★ **选择计划（下拉）不再隐藏**。原来注释写「自由专注不挂计划任务」，
       可那样一来正计时/流式记的那笔账永远挂不到计划上：日程表画不出实际块，
       计划卡的「已用」也不涨 —— 用户看到的就只是「正计时里选不了任务」。
       下拉只是"这笔账记给谁"，与"用哪种计时"无关，两个模式应该一样。
     任务名称／备注／当前状态照常显示，并在结算弹窗确认后落库。 */
  const tcs = document.querySelector('.current-todo-section');
  if (tcs) tcs.style.display = '';
  const freeHide = ['difficultySection', 'durationSuggestion'];
  freeHide.forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.style.display = isFree ? 'none' : '';
  });
  const tgs = document.getElementById('timerGhostBox');
  if (tgs) tgs.style.display = isFree ? 'none' : '';
  const trs = document.getElementById('timerRankStrip');
  if (trs) trs.style.display = isFree ? 'none' : '';
  /* 自由专注入口按钮：低调常驻（不依赖设置），自由模式显示「回番茄钟」+ 高亮 */
  const fmb = document.getElementById('freeModeBtn');
  if (fmb) {
    fmb.textContent = isFree ? '🍅 回番茄钟' : '⏱ 自由专注';
    fmb.classList.toggle('on', isFree);
  }
  UIFX.syncFlowDurUI();
  const bStart = document.getElementById('btnStart');
  const bFinish = document.getElementById('btnFinish');
  const bInterrupt = document.getElementById('btnInterrupt');
  if (isFree) {
    bStart.disabled = false;
    bStart.innerHTML = '<span>开始</span><span class="btn-sub">start</span>';
    bStart.onclick = function () {
      toggleFreeTimer();
    };
    bFinish.disabled = true;
    bFinish.innerHTML = '<span>⏹ 停止</span><span class="btn-sub">finish</span>';
    bFinish.onclick = function () {
      finishFreeTimer();
    };
    if (bInterrupt) bInterrupt.style.display = 'none';
    document.getElementById('timerLabel').textContent = '正计时';
    document.getElementById('timerTodo').textContent = '';
    const tpi = document.getElementById('timerPomodoroInfo');
    if (tpi) tpi.textContent = '';
    timerState.remaining = 0;
    timerState.totalDuration = 0;
    timerState.pausedElapsed = 0;
    timerState.pausedRemaining = 0;
    updateTimerDisplay();
  } else {
    if (bInterrupt) bInterrupt.style.display = '';
    bStart.disabled = false;
    bStart.innerHTML = '<span>开始</span><span class="btn-sub">start</span>';
    bStart.onclick = function () {
      toggleTimer();
    };
    bFinish.disabled = true;
    bFinish.innerHTML = '<span>结束番茄</span><span class="btn-sub">finish</span>';
    bFinish.onclick = function () {
      finishPomodoro();
    };
    bInterrupt.disabled = true;
    bInterrupt.innerHTML = '<span>打断</span><span class="btn-sub">break</span>';
    bInterrupt.onclick = interruptPomodoro;
    document.getElementById('timerLabel').textContent = '准备开始';
    document.getElementById('timerTodo').textContent = '';
    const tpi = document.getElementById('timerPomodoroInfo');
    if (tpi) tpi.textContent = '';
    timerState.remaining = appData.settings.workDuration * 60;
    timerState.totalDuration = appData.settings.workDuration * 60;
    updateTimerDisplay();
  }
  /* 计划下拉两个模式都要是最新的：自由专注现在也能选计划（见上方注释） */
  UIFX.refreshTodoSelect();
}
/* 从输入区读「这一轮要绑哪个计划」：下拉里的纯数字才算 todo id（habit_/mustdo_ 前缀不算），
   没选下拉时再按「名字唯一命中未完成计划」兜一次。番茄钟与自由专注共用同一套口径。 */
function resolveFreeLink() {
  const nameEl = document.getElementById('currentTodoInput');
  const name = nameEl && nameEl.value ? nameEl.value.trim() : '';
  const selEl = document.getElementById('currentTodoSelect');
  const raw = selEl && selEl.value ? String(selEl.value) : '';
  let id = /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  let linked = id ? (appData.todos || []).find(x => idEq(x.id, id)) : null;
  /* 下拉里残留的是已删除计划的 id 时绑不到实体 —— 不能把这个 id 传出去，
     否则后面开实际段会挂到一个不存在的计划上（色块画不出来、日志也归不了档）。 */
  if (id && !linked) id = null;
  if (!id && name) {
    const hits = (appData.todos || []).filter(x => !x.done && String(x.title || '').trim() === name);
    if (hits.length === 1) { id = hits[0].id; linked = hits[0]; }
  }
  return { id: linked ? id : null, linked: linked || null, name: name };
}
/* 恢复现场时把会话里的名字/备注回填到输入框：DOM 是重新渲染的，值是空的。
   不回填的话用户会以为自己填的名字丢了，结算时也确实会退化成「正计时 N 分钟」。 */
function refillTimerInputs() {
  const nEl = document.getElementById('currentTodoInput');
  if (nEl && !nEl.value && timerState.taskName && timerState.taskName !== '自由专注') nEl.value = timerState.taskName;
  const oEl = document.getElementById('currentTodoNote');
  if (oEl && !oEl.value && timerState.note) oEl.value = timerState.note;
}
/* 正计时开始/暂停（秒表：暂停累计 pausedElapsed，继续重设 startTime） */
function toggleFreeTimer() {
  if (timerState.mode !== 'free') {
    const ft = typeof window._freeType !== 'undefined' ? window._freeType : 'stopwatch';
    /* 自由专注也读用户填的任务名／备注／当前状态（与番茄同一套输入区） */
    const _fNoteEl = document.getElementById('currentTodoNote');
    const _fNote = _fNoteEl && _fNoteEl.value ? _fNoteEl.value.trim() : '';
    const _fSe = UIFX.getGridValue('startEnergyPicker');
    const _fSm = UIFX.getGridValue('startMoodPicker');
    /* 关联计划：与番茄钟同一套口径 —— 绑上之后 startTimerLoop 会给它开实际时段，
       结算时记录也带上 todoId/tag/quad，日程表和计划卡的「已用」立刻就能对上。 */
    const _fLink = resolveFreeLink();
    const _fName = _fLink.name;
    const _fLinked = _fLink.linked;
    const _fSelId = _fLink.id;
    const _fState = {
      taskName: _fLinked ? _fLinked.title : (_fName || '自由专注'),
      note: _fNote,
      startEnergy: _fSe || null,
      startMood: _fSm || null,
      linkedTodoId: _fSelId
    };
    if (strategyOfFreeType(ft).countsDown) {
      /* Flowtime 流式倒计时：时长由玩家自己选（档位=任务难度四档，记住上次选择） */
      const base = UIFX.getFlowDuration();
      const dur = base * 60;
      timerState = createTimerState({
        mode: 'free',
        freeType: 'flowtime',
        running: true,
        remaining: dur,
        totalDuration: dur,
        startTime: Date.now(),
        lastTickTime: Date.now(),
        pausedElapsed: 0,
        pausedRemaining: 0,
        endAt: Date.now() + dur * 1000
      });
      document.getElementById('timerLabel').textContent = '流式 ' + UIFX.getFlowDuration() + ' 分钟（到点可选继续）';
    } else {
      timerState = createTimerState({
        mode: 'free',
        freeType: 'stopwatch',
        running: true,
        remaining: 0,
        totalDuration: 0,
        startTime: Date.now(),
        lastTickTime: Date.now(),
        pausedElapsed: 0,
        pausedRemaining: 0
      });
      document.getElementById('timerLabel').textContent = '正计时中';
    }
    Object.assign(timerState, _fState);
    document.getElementById('timerTodo').textContent = _fState.taskName === '自由专注' ? '' : _fState.taskName;
    /* 选了计划：子任务卡与高亮跟番茄钟一致，边做边勾同样可用 */
    UIFX.renderTimerSubs();
    try { UIFX.applyCurrentTaskHighlight(); } catch (e) { if (window.__silent) window.__silent(e, '01c:toggleFreeTimer'); }
    const bS = document.getElementById('btnStart');
    bS.innerHTML = '<span>⏸ 暂停</span><span class="btn-sub">pause</span>';
    const bF = document.getElementById('btnFinish');
    bF.disabled = false;
    /* 与番茄钟一致：一开始就落一次快照。
       不能只靠 15s 心跳 —— 切到后台时 JS 定时器会被冻结、心跳根本不跑，
       自由专注就永远没写进磁盘，页面被回收/重载回来就全没了。 */
    saveTimerSnapshot();
    UIFX.playSound('start');
    UIFX.showFocusQuote('start');
    startTimerLoop();
    scheduleNextMicroBreak();
    updateTimerDisplay();
    requestWakeLock();
    return;
  }
  if (timerState.running) {
    timerState.running = false;
    /* 累计已专注秒数（stopwatch 和 flowtime 都用 pausedElapsed，结算基于真实时间） */
    timerState.pausedElapsed =
      (timerState.pausedElapsed || 0) + Math.max(0, Math.floor((Date.now() - timerState.startTime) / 1000));
    if (strategyOfFreeType(timerState.freeType).freezesRemainingOnPause) {
      timerState.pausedRemaining = timerState.remaining;
    }
    stopTimerLoop();
    const bS = document.getElementById('btnStart');
    bS.innerHTML = '<span>▶ 继续</span><span class="btn-sub">resume</span>';
    UIFX.playSound('tap');
    /* 暂停状态立刻落盘：否则暂停中刷新会丢（快照只认 running） */
    saveTimerSnapshot();
  } else {
    /* 暂停期间可能改选了别的计划：继续时按新的绑定走。
       旧任务的段在暂停那一刻已由 stopTimerLoop 收口，这里只换会话上的绑定字段，
       恢复后 startTimerLoop 会给新任务开一段 —— 时间归属不会串到旧任务头上。
       只认「下拉里选了具体计划」：下拉为空（比如它对应的 option 被渲染过滤掉了）
       不代表用户想解绑，保持原绑定更安全。 */
    const _rLink = resolveFreeLink();
    const _oldId = timerState.linkedTodoId == null ? '' : String(timerState.linkedTodoId);
    const _newId = _rLink.linked ? String(_rLink.linked.id) : '';
    if (_newId && _newId !== _oldId) {
      timerState.linkedTodoId = _rLink.linked.id;
      timerState.taskName = _rLink.linked.title || '自由专注';
      timerState.tag = _rLink.linked.tag || null;
      timerState.quad = _rLink.linked.quad || null;
      const te = document.getElementById('timerTodo');
      if (te) te.textContent = timerState.taskName === '自由专注' ? '' : timerState.taskName;
      /* 换了计划，子任务卡与高亮跟着换（否则边做边勾的还是旧计划的子任务） */
      UIFX.renderTimerSubs();
      try { UIFX.applyCurrentTaskHighlight(); } catch (e) { if (window.__silent) window.__silent(e, '01c:toggleFreeTimer:relink'); }
    }
    timerState.startTime = Date.now();
    timerState.running = true;
    if (strategyOfFreeType(timerState.freeType).resumesFromRemaining && timerState.pausedRemaining > 0) {
      timerState.endAt = Date.now() + timerState.pausedRemaining * 1000;
    }
    const bS = document.getElementById('btnStart');
    bS.innerHTML = '<span>⏸ 暂停</span><span class="btn-sub">pause</span>';
    UIFX.playSound('start');
    startTimerLoop();
    scheduleNextMicroBreak();
    requestWakeLock();
    saveTimerSnapshot();
  }
}
/* 正计时停止并结算 */
function finishFreeTimer() {
  if (timerState.mode !== 'free') return;
  /* 微休息正开着时点「结束」：先正常收掉微休息，别留下悬空的浮层 */
  if (timerState.microActive) skipMicroBreak();
  /* 已用时长一律基于真实累计（pausedElapsed 累计 + 当前段）算，
     不用 totalDuration - remaining：后者会被时长调整带偏。
     ★ 这里原本是 `if (freeType === 'flowtime') { … } else { 同一段 … }` —— 两个分支
     逐字符相同，是历史上两种模式算法统一后留下的死分支（谁也不敢删，因为看不出为什么分开）。
     保留一份，行为逐字节等价。 */
  const secs =
    (timerState.pausedElapsed || 0) +
    (timerState.running ? Math.max(0, Math.floor((Date.now() - timerState.startTime) / 1000)) : 0);
  /* ★ 「我早就结束这段洗漱了、连日志里的记录都删了，它却又跳回计时页说我在计时洗漱」。
     成因：结算弹窗开着时**计时还在跑**（本函数不停表），此刻若页面被系统回收，
     快照里就是一段"活的"计时 —— 重载后 restoreFreeSnapshot 无条件 running，这段就复活了。
     落一个「已点结束、等人选怎么记」的标记：下次进来重弹结算窗，绝不自己接着跑。 */
  try {
    appData.pendingFreeSettle = {
      secs: secs,
      at: Date.now(),
      freeType: timerState.freeType || null,
      taskName: timerState.taskName || '',
      note: timerState.note || '',
      linkedTodoId: timerState.linkedTodoId == null ? null : timerState.linkedTodoId
    };
    saveDataNow();
  } catch (e) { if (window.__silent) window.__silent(e, '01c:finishFreeTimer'); }
  openFreeSettle(secs);
}
let freeSettleSecs = null;
let freeSettleNote = ''; /* 自由专注结算备注预填 */

/* 把这次自由专注计入「自由专注」统计（今日累计/条数/历史，最多留 200 条） */
function bumpFreeStats(secs, taskName) {
  const ff = appData.freeFocus = appData.freeFocus || { today: null, minutes: 0, count: 0, history: [] };
  /* ★ 取「今天」必须用 getTodayStr()（本地时区），与读取端口径一致。
     用 UTC 口径会让凌晨 0–8 点做完的自由专注算进前一天，「今日」恒为 0。 */
  const today = getTodayStr();
  if (ff.today !== today) { ff.today = today; ff.minutes = 0; ff.count = 0; }
  const mins = Math.max(0, Math.round((Number(secs) || 0) / 60));
  ff.minutes = (ff.minutes || 0) + mins;
  ff.count = (ff.count || 0) + 1;
  if (!Array.isArray(ff.history)) ff.history = [];
  ff.history.push({ date: today, minutes: mins, ts: Date.now() , taskName: taskName || ''});
  if (ff.history.length > 200) ff.history = ff.history.slice(-200);
  saveData();
  updateFreeInfo();
}

/* 自由专注结算入口：弹窗，但不定死计时（取消还能继续专注） */
function openFreeSettle(secs) {
  freeSettleSecs = Math.max(0, Math.floor(Number(secs) || 0));
  /* 太短不记：沿用旧规则（<10 秒），否则日志里会冒出「0 分钟」的垃圾条 */
  if (freeSettleSecs < 10) {
    UIFX.toast('太短了，专注 10 秒以上才计入哦');
    resetFreeUI();
    return;
  }
  /* 不足 1 分钟按秒说，别把 45 秒写成「0 分钟」 */
  const _ffDur = (freeSettleSecs < 60) ? (freeSettleSecs + ' 秒') : Math.floor(freeSettleSecs / 60) + ' 分钟';
  /* 备注预填：自由专注没有别的输入机会，先替用户写一句能认出这笔的话（可改） */
  const _ffTni = document.getElementById('currentTodoInput');
  const _ffTno = document.getElementById('currentTodoNote');
  /* ★ 输入框可能已经被清空（页面重载 / 换视图重建 DOM / 锁屏后恢复），
     但用户当时填的名字和备注已经记在会话里 —— 不能因为输入框空了就把标题退回
     「正计时 N 分钟」，那等于用户白填。输入框有值仍以输入框为准（用户可能刚改过）。 */
  const _ffSessName = timerState && timerState.taskName && timerState.taskName !== '自由专注'
    ? String(timerState.taskName).trim() : '';
  const _ffTyped = ((_ffTni && _ffTni.value) || '').trim() || (timerState && !timerState.linkedTodoId ? _ffSessName : '');
  const _ffMemo = ((_ffTno && _ffTno.value) || '').trim()
    || (timerState && timerState.note ? String(timerState.note).trim() : '');
  /* 备注沿用计时页「备注」输入；空则退回「正计时 N 分钟」 */
  freeSettleNote =
    _ffMemo || (strategyOfFreeType(timerState && timerState.freeType).settleWord + ' ' + _ffDur);
  /* 绑了计划时名字以计划为准：输入框里可能还留着上一次的旧名字，
     不能用它去覆盖记录标题（会跟 planTitle 打架，日志里同一条记录两个名字）。 */
  if (timerState && !timerState.linkedTodoId) timerState.taskName = _ffTyped || freeSettleNote;
  timerState.pendingFinish = { source: 'free', secs: freeSettleSecs, at: Date.now(), taskName: _ffTyped || freeSettleNote, note: freeSettleNote };
  /* ★ 正计时不跑番茄倒计时时钟，tick 的 free 分支只更新 remaining，**effectiveSeconds 一直是 0**。
     不在这里对齐，showFinishModal 就会拿 0 去折算：选项写成「完整🍅 ×0.5」、完整🍅 还被
     15 分钟门槛灰掉 —— 用户实测「正计时 45 分钟，只给我记 0.5」，而真按 45 分钟算该是 1.5。
     弹窗里所有折算（选项文字 / 门槛 / 默认选中 / 折算提示）一律以这次的真实时长为口径。 */
  timerState.effectiveSeconds = freeSettleSecs;
  showFinishModal('free');
  tuneFreeSettleModal();
}

/* 按本次真实时长调整弹窗：文案 + 可选项 + 默认选中 */
function tuneFreeSettleModal() {
  const secs = freeSettleSecs || 0;
  const mins = Math.max(1, Math.round(secs / 60));
  const _durText = (secs < 60) ? (secs + ' 秒') : (mins + ' 分钟');
  const $ = (id) => document.getElementById(id);
  const tEl = $('finishModalTitle'); if (tEl) tEl.textContent = '记录这 ' + _durText;
  const info = $('finishInfo'); if (info) info.textContent = '本次自由专注 ' + _durText;
  const wrap = $('finishTypeWrap'); if (wrap) wrap.style.display = '';
  const sel = $('finishType');
  if (!sel) return;
  const allow = { log: true, incomplete: true, half: mins >= 5, full: mins >= 15 };
  for (let i = 0; i < sel.options.length; i++) {
    const o = sel.options[i];
    if (!o.value) continue;
    o.disabled = !allow[o.value];
  }
  const want = (mins >= 25) ? 'full' : ((mins >= 15) ? 'half' : 'log');
  sel.value = allow[want] ? want : 'log';
  /* ★ 选项文字由 showFinishModal 按当时的 effectiveSeconds 写死，本函数只改 disabled/选中，
     以前于是出现「已解禁『完整🍅』、文字却还是 ×0.5」。这里按真实时长重写一遍，
     保证「选什么得多少」和实际落库的 calcPomos(freeSettleSecs, type) 完全一致。 */
  const _f = calcPomos(secs, 'full');
  const optFull = sel.querySelector('option[value="full"]');
  if (optFull) optFull.textContent = '完整🍅 ×' + _f;
  const hint = $('finishTypeHint');
  if (hint) {
    hint.textContent = allow.full ? '按实际时长算：完整🍅 ×' + _f + '，也可选半个 / 未完成 / 仅记录'
      : (allow.half ? '不满一个番茄也能记：可选半个🍅 / 未完成 / 仅记录'
        : '时间较短：可选「未完成」或「仅记录」，不加番茄数');
    /* 文案基线必须无条件重设：此刻 dataset.base 还留着上一个番茄弹窗的话，
       不覆盖就会在「选仅记录 → 再选回来」时把番茄的文案翻出来 */
    hint.dataset.base = hint.textContent;
  }
  if (info) info.dataset.base = info.textContent;
  /* 备注预填（用户改过的内容不动） */
  const noteEl = $('finishNote');
  if (noteEl && !noteEl.value.trim()) noteEl.value = freeSettleNote;
  try { onFinishTypeChange(); } catch (e) { if (window.__silent) window.__silent(e, '01c:finishOnOpen'); }
}

function resetFreeUI() {
  stopTimerLoop();
  releaseWakeLock();
  clearTimerSnapshot(); /* 自由专注收尾：清掉计时快照，免得刷新后又被"复活" */
  /* 待结算标记同理：收尾了就不再欠一次结算 */
  if (appData && appData.pendingFreeSettle) { appData.pendingFreeSettle = null; saveDataNow(); }
  timerState = createTimerState({ mode: 'idle', running: false, remaining: 0, totalDuration: 0 });
  const bS = document.getElementById('btnStart');
  if (bS) {
    bS.disabled = false;
    bS.innerHTML = '<span>开始</span><span class="btn-sub">start</span>';
    bS.onclick = function () {
      toggleFreeTimer();
    };
  }
  const bF = document.getElementById('btnFinish');
  if (bF) {
    bF.disabled = true;
    bF.innerHTML = '<span>⏹ 停止</span><span class="btn-sub">finish</span>';
  }
  const bI = document.getElementById('btnInterrupt');
  if (bI) bI.style.display = 'none';
  const lbl = document.getElementById('timerLabel');
  if (lbl) lbl.textContent = '正计时';
  const td = document.getElementById('timerTodo');
  if (td) td.textContent = '';
  updateTimerDisplay();
}
/* 今日自由专注分钟数显示 */
function updateFreeInfo() {
  const fi = document.getElementById('freeInfo');
  if (!fi) return;
  const ff = appData.freeFocus;
  if (!ff) return;
  const today = getTodayStr();
  const mins = ff.today === today ? ff.minutes || 0 : 0;
  const el = document.getElementById('freeTodayMin');
  if (el) el.textContent = mins;
}
/* 自由专注入口按钮同步（切换模式时调用，恒显示，只切文案与高亮） */
function applyFreeModeBtn() {
  const fmb = document.getElementById('freeModeBtn');
  if (!fmb) return;
  const isFree = isFreeMode();
  fmb.textContent = isFree ? '🍅 回番茄钟' : '⏱ 自由专注';
  fmb.classList.toggle('on', isFree);
}
/* ===== 沉浸式专注入口 =====
   开启沉浸式专注后，点「开始」不再直接计时：无冒险进行中 → 随机抽角色卡全屏展示，
   用户点「进入冒险」才真正开始（startPomodoroCore）；冒险进行中则直接开始下一章。 */
/* [瓶子专注 · 作者 瓶子满天星 · ©2026 · MIT] */
function startPomodoro() {
  if (appData.settings.immersiveFocus) {
    const st = appData.immersiveFocus;
    if (st && !st.active) {
      const script = UIFX.immersivePickRandomScript();
      if (script) {
        UIFX.setPendingImmersiveScript(script);
        UIFX.showImmersiveCard(script);
        return;
      }
    }
  }
  startPomodoroCore();
}
/* ===== 计时持久化：刷新后自动恢复专注倒计时 ===== */
function saveTimerSnapshot() {
  if (typeof timerState === 'undefined') return;
  /* 自由专注（正计时 / 流式）与番茄钟走同一套快照机制，刷新 / 切走再回来能续上。
     暂停中（paused）也要落盘：只存 running 的话，暂停时刷新照样丢。 */
  if (timerState.mode === 'free') {
    const _freeAlive = !!timerState.running || !!timerState.startTime
      || (timerState.pausedElapsed || 0) > 0 || (timerState.pausedRemaining || 0) > 0;
    if (!_freeAlive) return;
    appData.timerSnapshot = {
      mode: 'free',
      savedAt: Date.now(),
      freeType: timerState.freeType,
      endAt: timerState.endAt,
      totalDuration: timerState.totalDuration,
      startTime: timerState.startTime,
      pausedElapsed: timerState.pausedElapsed || 0,
      pausedRemaining: timerState.pausedRemaining || 0,
      paused: !timerState.running,
      remaining: timerState.remaining || 0,
      taskName: timerState.taskName,
      note: timerState.note,
      startEnergy: timerState.startEnergy,
      startMood: timerState.startMood
    };
    saveDataNow();
    return;
  }
  if (timerState.mode !== 'focus') return;
  appData.timerSnapshot = {
    mode: 'focus',
    /* ★ 落盘时刻（P2-3）：focus 快照原来没有时间戳，无法判断"这条是刚写的还是三天前的"。
       关页期间用户回拨系统时钟 → now 变小 → 剩余时间被整体放大，白送专注时长。
       有了 savedAt 就能在恢复时先过陈旧门（见 restoreTimerSnapshot）。 */
    savedAt: Date.now(),
    endAt: timerState.endAt,
    totalDuration: timerState.totalDuration,
    taskName: timerState.taskName,
    note: timerState.note,
    linkedTodoId: timerState.linkedTodoId,
    curSubId: timerState.curSubId,
    startTime: timerState.startTime,
    startEnergy: timerState.startEnergy,
    startMood: timerState.startMood,
    /* ★ 暂停 / 打断态也要落盘，并记下 paused。
       只存 running 的话，恢复时会无条件 running:true —— 暂停被吞掉、计时自己接着跑，
       过点还会自动结算成整颗番茄。 */
    paused: !timerState.running,
    /* ★ 后台暂停的起点也要落盘（P1-5）：bgPause 只停了 tick、running 仍是 true，
       所以 paused 记不出来。进程在后台被杀后重开，靠这个字段把「后台这段时间」补回去，
       否则后台 30 分钟会被当成专注流逝（25 分钟的番茄直接归零自动结算）。 */
    _bgPausedAt: Number(timerState._bgPausedAt) || 0,
    remaining: timerState.remaining || 0,
    pausedRemaining: timerState.pausedRemaining || 0,
    interruptions: timerState.interruptions,
    currentInterruptStart: timerState.currentInterruptStart,
    totalInterruptSeconds: timerState.totalInterruptSeconds,
    effectiveSeconds: timerState.effectiveSeconds,
    check50: timerState.check50,
    check75: timerState.check75,
    last60vibrate: timerState.last60vibrate,
    interruptQuotaExceeded: timerState.interruptQuotaExceeded
  };
  saveDataNow();
}
function clearTimerSnapshot() {
  if (appData.timerSnapshot) {
    appData.timerSnapshot = null;
    saveDataNow();
  }
}
/* ★ 切走（页面被隐藏/卸载）时立刻补落一次快照：
   手机切到别的 App 后 WebView 会冻结 JS 定时器，等不到 15s 心跳，
   此时若进程被回收，磁盘上就是上一次（可能十几秒前）的状态。
   正计时靠 startTime、流式靠 endAt，写一次就够恢复。 */
function saveRunningSnapshotNow() {
  try {
    if (typeof timerState === 'undefined' || !timerState || !timerState.running) return;
    if (timerState.mode !== 'free' && timerState.mode !== 'focus') return;
    saveTimerSnapshot();
  } catch (e) {
    if (window.__silent) window.__silent(e, '01c:snapshot-hidden');
  }
}
document.addEventListener('visibilitychange', function () {
  if (document.hidden) saveRunningSnapshotNow();
});
window.addEventListener('pagehide', saveRunningSnapshotNow);
/* 恢复未结算的完成弹窗（Bug4）：页面重开后补弹，确认后番茄与冒险结算不丢 */
function restorePendingFinish() {
  const pf = appData.pendingFinish;
  if (!pf) return;
  /* ★ 这里**不能**把 pendingFinish 清掉。旧写法先清空+落盘、再弹结算窗 →
     弹窗弹出后如果又被杀掉（后台回收、用户随手划掉），这颗番茄就彻底没了：
     快照早在完成时就清了、待结算也刚被清、记录还没写 —— 与「防关页丢番茄」的本意正好相反。
     结清的责任交给真正结束这个流程的地方：confirmFinish（用户选了类型）负责清；
     closeFinishModal 对自然完成是拒绝关闭的，所以它不会误清。
     代价只是「没结算就再打开」会再弹一次窗 —— 正是想要的行为。 */
  if (timerState.mode === 'focus' && timerState.running) return;
  timerState.mode = 'focus';
  timerState.running = false;
  timerState.remaining = 0;
  timerState.endAt = 0;
  timerState.totalDuration = pf.totalDuration || POMO_DEFAULT_MINUTES * 60;
  timerState.effectiveSeconds = pf.effectiveSeconds || timerState.totalDuration;
  timerState.taskName = pf.taskName || '';
  timerState.note = pf.note || '';
  timerState.linkedTodoId = pf.linkedTodoId || null;
  timerState.curSubId = pf.curSubId || null;
  timerState.startTime = pf.startTime || Date.now();
  /* ★ 自然完成的结束时刻随待结算一起回来了：此时 timerState.endAt 已被清零，
     结算落库要靠它，否则记录又被拉长到「这次打开 App 的时刻」。 */
  timerState.finishEndedAt = Number(pf.endedAt) || 0;
  timerState.startEnergy = pf.startEnergy || null;
  timerState.startMood = pf.startMood || null;
  timerState.interruptQuotaExceeded = !!pf.interruptQuotaExceeded;
  showFinishModal('natural');
}
/* 恢复自由专注快照：正计时把「关闭期间又过去的时间」补回 startTime，
   让 tick 的累计公式自然续上；流式按绝对 endAt 续上；
   关闭期间已到点则停在原地，弹回结算弹窗让用户自己选怎么记这一笔。 */
/* ===== 自由专注快照的两道门（见 restoreFreeSnapshot 开头的说明） ===== */
/* 8 小时：正常的自由专注再长也长不过这个数；超过就是"App 被回收 / 人早就走了"的断头会话。
   故意取宽：宁可让用户偶尔手动点一下结束，也不要在真的连续专注时把人家丢掉。 */
const FREE_SNAP_STALE_MS = 8 * 3600 * 1000;

/* 门①：上次已经点过「结束」，只是没来得及选「怎么记」→ 恢复成待结算弹窗，不自己跑。 */
function restorePendingFreeSettle(snap, now) {
  const pf = appData && appData.pendingFreeSettle;
  if (!pf || !(Number(pf.secs) > 0)) return false;
  if (now - (Number(pf.at) || 0) > FREE_SNAP_STALE_MS) {
    appData.pendingFreeSettle = null;
    try { saveDataNow(); } catch (e) { if (window.__silent) window.__silent(e, '01c:pfSettleExpire'); }
    return false;
  }
  timerMode = 'free';
  applyTimerModeUI();
  const _st = strategyOfFreeType(pf.freeType || (snap && snap.freeType));
  appData.timerSnapshot = null; /* 待结算态不该再带着"在跑"的快照 */
  Object.assign(timerState, {
    mode: 'free',
    freeType: _st.key,
    running: false,
    endAt: 0,
    startTime: 0,
    remaining: 0,
    totalDuration: 0,
    pausedElapsed: Number(pf.secs) || 0,
    pausedRemaining: 0,
    taskName: pf.taskName || (snap && snap.taskName) || '',
    note: pf.note || (snap && snap.note) || '',
    linkedTodoId: pf.linkedTodoId == null ? null : pf.linkedTodoId
  });
  window._freeType = _st.key;
  try { UIFX.syncFreeTypeUI(); } catch (e) { if (window.__silent) window.__silent(e, '01c:pfSettleUI'); }
  const bS = document.getElementById('btnStart');
  if (bS) { bS.disabled = true; }
  const bF = document.getElementById('btnFinish');
  if (bF) {
    bF.disabled = false;
    bF.innerHTML = '<span>⏹ 结束</span><span class="btn-sub">finish</span>';
    bF.onclick = function () { finishFreeTimer(); };
  }
  updateTimerDisplay();
  UIFX.toast('⏱️ 上次的自由专注已经结束，请选择怎么记这一笔');
  openFreeSettle(Number(pf.secs) || 0);
  return true;
}

/* 门②：快照太久远 = 断头会话。丢掉，并按快照时刻把那段实际计时收掉
   （不收的话日程表上那条会一直显示"进行中"，越长越长）。 */
function dropStaleFreeSnapshot(snap) {
  const _tid = snap && snap.linkedTodoId;
  const _endAt = Number(snap && (snap.savedAt || snap.startTime)) || Date.now();
  appData.timerSnapshot = null;
  appData.pendingFreeSettle = null;
  try {
    if (_tid != null && typeof closeTodoActualSeg === 'function') closeTodoActualSeg(_tid, _endAt);
  } catch (e) { if (window.__silent) window.__silent(e, '01c:dropStaleFreeSnapshot'); }
  try { saveDataNow(); } catch (e) { if (window.__silent) window.__silent(e, '01c:dropStaleFreeSnapshot2'); }
  timerMode = 'free';
  applyTimerModeUI();
  try { resetFreeUI(); } catch (e) { if (window.__silent) window.__silent(e, '01c:dropStaleFreeSnapshot3'); }
  UIFX.toast('⏱️ 上次有一段自由专注没正常结束，这次不接着算');
}

function restoreFreeSnapshot(snap, now) {
  /* ===== 两个有效性门 =====
     需求：「我选着选择计划，突然就变成计时界面，说我在计时洗漱 —— 可我早就结束了、
     还在日志里把那条记录删了，数据像回滚了一样」。
     自由专注（正计时）的恢复是**无条件 running**：只要快照还在，一段早就结束的计时就会被重新拉起来，
     日程表上那条实际段也跟着"进行中"地继续长。所以进来先过两道门：
       ① 用户已经点过「结束」（pendingFreeSettle）→ 恢复成待结算，重弹结算窗，不自己跑；
       ② 快照太旧（> FREE_SNAP_STALE_MS）→ 断头会话，丢弃并把那段实际计时按快照时刻收掉。 */
  if (restorePendingFreeSettle(snap, now)) return;
  const _age = now - (Number(snap.savedAt) || Number(snap.startTime) || 0);
  if (_age > FREE_SNAP_STALE_MS) { dropStaleFreeSnapshot(snap); return; }
  /* ★ 恢复时 timerMode 必须一起还原：只还原 timerState 的话，
     刷新 / 重开后 timerMode 仍是默认 'pomodoro' —— 界面按番茄钟画、
     开始按钮接的也是番茄钟的 toggleTimer，点「暂停」没反应。 */
  timerMode = 'free';
  applyTimerModeUI();
  /* 恢复现场同样「按模式取策略」：流式按绝对 endAt 续、把剩余冻进 pausedRemaining；
     正计时只续已跑秒数。isFlow 保留为语义别名，真源是策略表。 */
  const _rStrat = strategyOfFreeType(snap.freeType);
  const isFlow = _rStrat.key === 'flowtime';
  /* ★ 暂停中恢复：只还原成「暂停」，不替用户跑起来。
     正计时剩余 = 已跑秒数（暂停期间没在跑）；流式用暂停那一刻的剩余。 */
  if (snap.paused) {
    const left = isFlow ? snap.pausedRemaining || snap.remaining || 0 : snap.remaining || 0;
    Object.assign(timerState, {
      mode: 'free',
      freeType: _rStrat.key,
      running: false,
      endAt: 0,
      remaining: left,
      totalDuration: snap.totalDuration || 0,
      startTime: snap.startTime || now,
      pausedElapsed: snap.pausedElapsed || 0,
      pausedRemaining: _rStrat.freezesRemainingOnPause ? left : snap.pausedRemaining || 0,
      taskName: snap.taskName || '',
      note: snap.note || '',
    });
    window._freeType = _rStrat.key;
    UIFX.syncFreeTypeUI();
    const bS = document.getElementById('btnStart');
    if (bS) {
      bS.disabled = false;
      bS.innerHTML = '<span>▶ 继续</span><span class="btn-sub">resume</span>';
      bS.onclick = function () { toggleFreeTimer(); };
    }
    const bF = document.getElementById('btnFinish');
    if (bF) {
      bF.disabled = false;
      bF.innerHTML = '<span>⏹ 结束</span><span class="btn-sub">finish</span>';
      bF.onclick = function () { finishFreeTimer(); };
    }
    try { updateFreeInfo(); } catch (e) { if (window.__silent) window.__silent(e, '01c:freeInfoRestore'); }
    updateTimerDisplay();
    UIFX.toast('⏸️ 已恢复（上次是暂停中，点「继续」接着走）', true);
    return;
  }
  if (isFlow && snap.endAt) {
    const leftSec = Math.floor((snap.endAt - now) / 1000);
    if (leftSec <= 0) {
      const done = snap.totalDuration || snap.pausedElapsed || 0;
      Object.assign(timerState, {
        mode: 'free', freeType: 'flowtime', running: false, remaining: 0, endAt: 0,
        totalDuration: snap.totalDuration || 0, startTime: snap.startTime || now,
        pausedElapsed: done, taskName: snap.taskName || '', note: snap.note || '',
        effectiveSeconds: done
      });
      clearTimerSnapshot();
      try { UIFX.showFlowtimeDone(); } catch (e) { if (window.__silent) window.__silent(e, '01c:flowtimeDone'); }
      return;
    }
    Object.assign(timerState, {
      mode: 'free', freeType: 'flowtime', running: true,
      endAt: snap.endAt, remaining: leftSec, totalDuration: snap.totalDuration || 0,
      startTime: snap.startTime || now, pausedElapsed: snap.pausedElapsed || 0,
      taskName: snap.taskName || '', note: snap.note || ''
    });
  } else {
    const gap = Math.max(0, Math.floor((now - (snap.savedAt || now)) / 1000));
    Object.assign(timerState, {
      mode: 'free', freeType: 'stopwatch', running: true, endAt: 0,
      remaining: (snap.remaining || 0) + gap, totalDuration: snap.totalDuration || 0,
      startTime: (snap.startTime || now) - gap, pausedElapsed: snap.pausedElapsed || 0,
      taskName: snap.taskName || '', note: snap.note || ''
    });
  }
  window._freeType = _rStrat.key;
  UIFX.syncFreeTypeUI();
  refillTimerInputs();
  const bS = document.getElementById('btnStart');
  if (bS) { bS.disabled = false; bS.innerHTML = '<span>暂停</span><span class="btn-sub">pause</span>'; }
  const bF = document.getElementById('btnFinish');
  if (bF) {
    bF.disabled = false;
    bF.innerHTML = '<span>⏹ 结束</span><span class="btn-sub">finish</span>';
    bF.onclick = function () { finishFreeTimer(); };
  }
  startTimerLoop();
  try { updateFreeInfo(); } catch (e) { if (window.__silent) window.__silent(e, '01c:freeInfoResume'); }
  updateTimerDisplay();
  requestWakeLock();
  UIFX.toast(isFlow ? '⏱️ 已接着刚才的流式专注' : '⏱️ 已接着刚才的自由专注计时', true);
}

/* ★ 番茄钟「暂停 / 打断」态恢复：与自由专注对称 —— 暂停就是暂停，恢复回来仍要点「继续」才走。
   恢复时若不看 paused、无条件 running:true，暂停就会被吞、计时自己接着跑；
   若关闭期间已过点，还会自动结算成一颗完整番茄。 */
function restorePausedFocusSnapshot(snap, now) {
  const left = Math.max(0, Math.round(snap.pausedRemaining || snap.remaining || 0));
  Object.assign(timerState, snap, {
    running: false,
    remaining: left,
    pausedRemaining: left,
    endAt: 0,
    currentInterruptStart: now, /* 本次暂停从恢复这一刻起算 */
    interval: null,
    microActive: false,
    microStartedAt: 0,
    microNextAt: 0,
    microIv: null,
    calibrateIv: null,
    interruptIv: null,
    breakRemindIv: null
  });
  timerState.mode = 'focus';
  _soundMuteUntil = Date.now() + 3000;
  if (left <= 120) timerState.last60vibrate = true;
  const bS = document.getElementById('btnStart');
  if (bS) {
    bS.disabled = false;
    bS.innerHTML = '<span>▶ 继续</span><span class="btn-sub">resume</span>';
    bS.onclick = continueInterruptedFocus;
  }
  const bF = document.getElementById('btnFinish');
  if (bF) bF.disabled = false;
  const bI = document.getElementById('btnInterrupt');
  if (bI) bI.disabled = true;
  const lbl = document.getElementById('timerLabel');
  if (lbl) lbl.textContent = '已暂停';
  updateTimerDisplay();
  try { saveTimerSnapshot(); } catch (e) { if (window.__silent) window.__silent(e, '01c:restorePausedFocusSnapshot'); }
  UIFX.toast('⏸️ 上次的番茄是中途暂停的，点「继续」接着走（剩 ' + Math.ceil(left / 60) + ' 分钟）');
}

/* 「继续」按钮：从暂停处接着走（暂停时长计入打断，不算专注） */
function continueInterruptedFocus() {
  if (timerState.mode !== 'focus' || timerState.running) return;
  const pausedSec = Math.max(0, Math.floor((Date.now() - (timerState.currentInterruptStart || Date.now())) / 1000));
  if (pausedSec > 0) timerState.totalInterruptSeconds = (timerState.totalInterruptSeconds || 0) + pausedSec;
  timerState.currentInterruptStart = 0;
  const left = Math.max(1, Math.round(timerState.pausedRemaining || timerState.remaining || 0));
  timerState.remaining = left;
  timerState.pausedRemaining = 0;
  timerState.endAt = Date.now() + left * 1000;
  timerState.running = true;
  const bS = document.getElementById('btnStart');
  if (bS) { bS.disabled = true; bS.onclick = toggleTimer; }
  const bI = document.getElementById('btnInterrupt');
  if (bI) { bI.disabled = !!timerState.interruptQuotaExceeded; bI.onclick = interruptPomodoro; }
  const lbl = document.getElementById('timerLabel');
  if (lbl) lbl.textContent = '专注中';
  _soundMuteUntil = Date.now() + 1500;
  startTimerLoop();
  scheduleNextMicroBreak();
  requestWakeLock();
  updateTimerDisplay();
}

function restoreTimerSnapshot() {
  const snap = appData.timerSnapshot;
  if (!snap || !snap.mode) return;
  const now = Date.now();
  /* 自由专注也要活过刷新（原先这里只认番茄钟快照） */
  if (snap.mode === 'free') { restoreFreeSnapshot(snap, now); return; }
  if (snap.mode !== 'focus' || !snap.endAt) return;
  /* ★ 陈旧门（P2-3）：8 小时以上的 focus 快照 = 断头会话（关机过夜、页面被丢弃）。
     此时若按 endAt 结算，会把"根本没在专注的时间"算成番茄；若用户在关页期间回拨了时钟，
     remainSec 还会被放大成几小时。一律不结算、不续跑，清快照回待命。
     （阈值与自由专注的 FREE_SNAP_STALE_MS 共用口径，见 :666。） */
  const _snapSavedAt = Number(snap.savedAt) || 0;
  if (_snapSavedAt > 0 && now - _snapSavedAt > FREE_SNAP_STALE_MS) {
    appData.timerSnapshot = null;
    saveDataNow();
    resetToIdle();
    UIFX.toast('⏱️ 上次的番茄已经很久没动静，这次不接着算');
    return;
  }
  /* ★ 离开时正开着「打断」弹窗（P2-9）：那段时间是打断、不是专注。
     快照里存了 currentInterruptStart，恢复时把这段补进 totalInterruptSeconds，
     并把 endAt 同样后移 —— 否则被杀进程期间墙钟时间会被当成专注流逝。 */
  if (Number(snap.currentInterruptStart) > 0) {
    const _itGap = Math.max(0, Math.floor((now - Number(snap.currentInterruptStart)) / 1000));
    if (_itGap > 0) {
      snap.totalInterruptSeconds = (Number(snap.totalInterruptSeconds) || 0) + _itGap;
      if (snap.endAt) snap.endAt = Number(snap.endAt) + _itGap * 1000;
    }
    snap.currentInterruptStart = 0;
  }
  /* ★ 上次是「打断 / 暂停」中离开的：只还原成暂停，绝不自动续跑、也绝不自动结算 */
  if (snap.paused) { restorePausedFocusSnapshot(snap, now); return; }
  /* ★ 后台暂停跨进程恢复（P1-5）：切后台时 bgPause 只停 tick、running 仍 true，
     进程被杀后重开，这条快照会按「在跑」恢复且 endAt 不加回后台时长 ——
     后台 30 分钟被当成专注流逝，25 分钟的番茄直接归零自动结算，与「后台不计时」相反。
     快照里带了 _bgPausedAt（切后台那一刻），就把这段补回 endAt。
     （同会话返回前台的补偿在 01g 的 visibilitychange 里，那条路不需要这里。） */
  if (Number(snap._bgPausedAt) > 0) {
    const _bgGap = Math.max(0, Math.floor((now - Number(snap._bgPausedAt)) / 1000));
    if (_bgGap > 0) snap.endAt = Number(snap.endAt) + _bgGap * 1000;
    snap._bgPausedAt = 0;
  }
  const remainSec = Math.floor((snap.endAt - now) / 1000);
  if (remainSec <= 0) {
    /* 页面关闭 / 刷新期间番茄已超时 → 按快照自动结算，不丢弃。
       结算规则：按关闭时已完成的「实际有效专注时长」折算番茄数（做满 25 分钟=1🍅、
       做 12 分钟=0.5🍅，见 calcPomos），不虚报时长；
       有效时长不足总时长一半视为未开始，不计入。 */
    try {
      const _total = snap.totalDuration || POMO_DEFAULT_MINUTES * 60;
      const _done = Math.max(0, snap.effectiveSeconds || 0);
      if (_done >= _total * 0.5) {
        Object.assign(timerState, snap, {
          running: false,
          remaining: 0,
          endAt: 0,
          microActive: false,
    microStartedAt: 0,
          microIv: null,
          calibrateIv: null,
          interruptIv: null,
          breakRemindIv: null
        });
        timerState.effectiveSeconds = Math.min(_done, _total);
        timerState.mode = 'focus';
        /* ★ 这条路径同样是「番茄早就到点了，人是后来才回来的」：结束时刻 = 快照里排定的 endAt。
           不传的话记录会写成恢复 App 的时刻（与关页期间补触发同源的那个错）。 */
        timerState.finishEndedAt = Number(snap.endAt) || 0;
        savePomodoroRecord('full');
        UIFX.toast(
          '⏱️ 上次的番茄已自动结算：专注 ' +
            Math.floor(timerState.effectiveSeconds / 60) +
            ' 分钟，+' +
            calcPomos(timerState.effectiveSeconds, 'full') +
            '🍅'
        );
      } else {
        UIFX.toast('⏱️ 上次的番茄专注时间过短，未计入');
        /* ★ 不计入也要把段落收掉：App 被杀时那段是"开着"的，不收回来的话
           它永远显示「进行中」、日程色块一路长到今天，而这次专注其实没有记录。 */
        if (snap.linkedTodoId) closeTodoActualSeg(snap.linkedTodoId, Number(snap.endAt) || 0);
      }
      appData.timerSnapshot = null;
      saveDataNow();
      resetToIdle();
    } catch (e) {
      /* ★ 不许「空吞 + 清快照」（P1-4）。这条是「番茄早到点了、人后来才回来」的自动结算：
         savePomodoroRecord 一旦抛错（结算元素缺失 / 脏数据下 find 异常），
         原实现清掉快照、不写记录、不报错 —— 用户专注了一整颗番茄，数据凭空消失，
         事后连"曾经有过这颗番茄"都查不到。这同时违反「数据不许丢」与「不许空吞」两条规约。

         现在：① 快照原样留着（下次启动还能再结算一次，把可恢复的留着）；
               ② 走 __silent 上报（错误面板能看见）；
               ③ 明确告诉用户"没写进去"，给出可执行的下一步。
         宁可下次启动再弹一次同样的提示，也不把"暂时存不上"变成"永久没有"。 */
      /* 上报与提示放在同一个 try 里：两条都失败也只有一个 catch，
         且块内必须有语句（空 catch 棘轮会记一笔，见 tools/empty_catch_audit.py）。 */
      try {
        if (window.__silent) window.__silent(e, '01c:autoSettle');
        UIFX.toast('⚠️ 上次的番茄自动结算失败，记录没写进去。可到日志页手动补记，或下次打开再试');
      } catch (_e1) {
        console.warn('[autoSettle] 上报/提示失败（数据快照已保留）', _e1);
      }
    }
    return;
  }
  Object.assign(timerState, snap, {
    running: true,
    interval: null,
    pausedRemaining: 0,
    remaining: remainSec,
    microActive: false,
    microStartedAt: 0,
    microNextAt: 0,
    microIv: null,
    calibrateIv: null,
    interruptIv: null,
    breakRemindIv: null
  });
  timerState.mode = 'focus';
  /* 恢复后 3 秒内不响任何提示音（防止刷新/打开页面后突然响） */
  _soundMuteUntil = Date.now() + 3000;
  /* 剩余不足 2 分钟：跳过「快结束」提醒，避免静音窗口一过又突然响 */
  if (remainSec <= 120) timerState.last60vibrate = true;
  const btnS = document.getElementById('btnStart');
  if (btnS) btnS.disabled = true;
  const btnF = document.getElementById('btnFinish');
  if (btnF) btnF.disabled = false;
  const btnI = document.getElementById('btnInterrupt');
  if (btnI) {
    btnI.disabled = !!snap.interruptQuotaExceeded;
    btnI.innerHTML = '<span>打断</span><span class="btn-sub">break</span>';
    btnI.onclick = interruptPomodoro;
  }
  const lbl = document.getElementById('timerLabel');
  if (lbl) lbl.textContent = '专注中';
  const td = document.getElementById('timerTodo');
  if (td) td.textContent = timerState.taskName || '未命名任务';
  /* 快照里没恢复关联计划 → 刷新后子任务卡不显示、结算也记不到那条计划上 */
  timerState.linkedTodoId = (snap.linkedTodoId != null) ? snap.linkedTodoId : null;
  timerState.curSubId = (snap.curSubId != null) ? snap.curSubId : null;
  /* 恢复后立刻重画子任务卡（切走/刷新回来才看得见） */
  UIFX.renderTimerSubs();
  refillTimerInputs();
  startTimerLoop();
  updateTimerDisplay();
  requestWakeLock();
  UIFX.toast('⏱️ 已恢复上次专注（还剩 ' + Math.max(1, Math.ceil(remainSec / 60)) + ' 分钟）', true);
}
function startPomodoroCore() {
  checkBufferReset();
  /* ★ 进入专注时把已经挂着的提醒窗关掉：否则它会整轮遮着计时界面
     （提醒不丢，队列还在，专注结束 remindFocusFlush 会补弹）。 */
  try { UIFX.closeModal('remindModal'); } catch (e) { if (window.__silent) window.__silent(e, '01c:startPomodoroCore'); }
  /* 沉浸式连续性：上一章间隔超过 bufferTime 未继续 → 冒险自动解锁坏结局（普通番茄不受影响） */
  try {
    UIFX.immersiveCheckStale();
  } catch (e) { if (window.__silent) window.__silent(e, '01c:startPomodoroCore'); }
  if (timerState.interruptIv) {
    clearInterval(timerState.interruptIv);
    timerState.interruptIv = null;
  }
  /* 关联计划：选了计划名称就以该计划名为任务名（不再需要手动命名）
     value 可能为 habit_x / mustdo_x 等非 todo 前缀 → 不当作 todo id（不累加任务进度） */
  const selEl = document.getElementById('currentTodoSelect');
  const selRaw = selEl && selEl.value ? String(selEl.value) : '';
  let selId = /^\d+$/.test(selRaw) ? parseInt(selRaw, 10) : null;
  /* 手敲任务名（下拉没选）：若名字与某条未完成计划的标题完全相同且唯一——也认作选中它。
     否则这一路永远不会出现子任务卡，用户会以为子任务卡时有时无。 */
  if (!selId) {
    const _inp = document.getElementById('currentTodoInput');
    const _tn = _inp && _inp.value ? _inp.value.trim() : '';
    if (_tn) {
      const _hits = (appData.todos || []).filter(x => !x.done && String(x.title || '').trim() === _tn);
      if (_hits.length === 1) selId = _hits[0].id;
    }
  }
  const linkedTodo = selId ? appData.todos.find(x => idEq(x.id, selId)) : null;
  const note = document.getElementById('currentTodoNote').value.trim();
  let name;
  if (linkedTodo) {
    /* 计时页备注只属于这一次专注：不写回计划备注（detail 只在计划卡「设置」里改） */
    name = linkedTodo.title;
  } else {
    name = document.getElementById('currentTodoInput').value.trim() || '未命名任务';
  }
  const se = UIFX.getGridValue('startEnergyPicker');
  const sm = UIFX.getGridValue('startMoodPicker');
  /* 心流自适应：仅当用户从未手动选过难度档/时长时才用推荐时长接管；手动选过后以用户选择为准（推荐降级为提示条，见 renderDurationSuggestion） */
  let wd;
  let _wdAuto = false;
  if (appData.settings.adaptiveSuggest && appData.settings.difficultyTouched !== true) {
    /* 心流自适应接管：仅当用户从未手动选过难度档/时长时，本轮按近7天表现推荐 */
    wd = getRecommendedWorkDuration();
    if (wd !== appData.settings.workDuration) _wdAuto = true; /* 与用户设置不同 → 需要明确告知 */
  } else {
    wd = appData.settings.workDuration;
  }
  /* 接管透明化：自动改时长时弹提示说明原因 + 如何固定自己的时长 */
  if (_wdAuto) {
    try {
      UIFX.toast(
        wd < appData.settings.workDuration
          ? '🧭 心流自适应：近7天你打断偏多，本轮先用 ' +
              wd +
              ' 分钟找回状态。想固定时长：点一下表盘下的难度档，或在设置里关掉「自适应建议」'
          : '🧭 状态不错！近7天完成度高，本轮自动用 ' + wd + ' 分钟。想固定时长：点一下难度档即可',
        true
      );
    } catch (e) { if (window.__silent) window.__silent(e, '01c:startPomodoroCore'); }
  }
  /* 轻松模式（关怀）：番茄时长自动减半，最低 10 分钟。
     与 renderDifficultyPicker 共用同一折算函数，UI 档位卡上已显示减半后的实际时长，
     这里再补一条明示 toast，保证「显示 = 实际」不再有歧义。 */
  if (isEasyModeActive() && wd > 10) {
    const _wdBefore = wd;
    wd = Math.max(10, Math.round(wd / 2));
    if (wd !== _wdBefore) {
      try {
        UIFX.toast('🌙 轻松模式生效：本轮 ' + _wdBefore + ' 分钟 → 实际 ' + wd + ' 分钟', true);
      } catch (e) { if (window.__silent) window.__silent(e, '01c:startPomodoroCore'); }
    }
  }
  /* 疲劳检测：开始前如有认知疲劳信号（中断/未完成偏多）主动提示休息或缩短时长 */
  const _fatigueAdvice = checkFatigueAdvice();
  if (_fatigueAdvice) UIFX.toast(_fatigueAdvice, true);
  timerState = createTimerState({
    mode: 'focus',
    running: true,
    remaining: wd * 60,
    totalDuration: wd * 60,
    startTime: Date.now(),
    lastTickTime: Date.now(),
    endAt: Date.now() + wd * 60 * 1000,
    taskName: name,
    note: note,
    linkedTodoId: selId,
    curSubId: null,
    startEnergy: se || null,
    startMood: sm || null,
    difficulty: getDifficultyByDuration(wd)
  });
  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnFinish').disabled = false;
  document.getElementById('btnInterrupt').disabled = false;
  /* 每次开始番茄都强制把按钮重置为「打断」状态，防止上一轮休息自然结束后按钮残留「跳过休息」导致误操作 */
  document.getElementById('btnInterrupt').innerHTML = '<span>打断</span><span class="btn-sub">break</span>';
  document.getElementById('btnInterrupt').onclick = interruptPomodoro;
  document.getElementById('timerLabel').textContent = '专注中';
  document.getElementById('timerTodo').textContent = name;
  if (timerState.breakRemindIv) {
    clearInterval(timerState.breakRemindIv);
    timerState.breakRemindIv = null;
  }
  startTimerLoop();
  scheduleNextMicroBreak();
  updateTimerDisplay();
  requestWakeLock();
  saveTimerSnapshot();
  stampTodoActualStart(timerState.linkedTodoId); /* 需求⑩：第一次给这个任务开番茄 = 实际开始时间 */
  _lastSnapshotAt = Date.now(); /* 与启动快照同步，避免 tick 立即重复落盘 */
  hideBreakDice();
  UIFX.renderTimerSubs(); /* + 音效：开始专注时"低嘟"音 + 屏幕中央滑入一条短引言（3 秒后淡出） */
  UIFX.playSound('start');
  UIFX.showFocusQuote('start');
}
function startTimerLoop() {
  /* 幂等守卫——重复调用先清旧句柄，防双 interval 双倍 tick（此前靠人肉先 stop 再 start） */
  stopTimerLoop();
  /* ★ 实际时段（多段）：**所有**"计时跑起来了"的路都汇到这里 —— 新开一轮、
     暂停后继续、打断后恢复、从快照恢复。所以开段的钩子挂在这儿，不用去十几个
     `running = true` 的赋值点各插一遍（那种写法必漏，本项目已栽过三次）。 */
  if ((timerState.mode === 'focus' || timerState.mode === 'free') && timerState.linkedTodoId) {
    openTodoActualSeg(timerState.linkedTodoId);
    _tbOpenSegTodoId = timerState.linkedTodoId;
  }
  /* lastTickTime 原为只写不读的僵尸字段（微休息用的是 microNextAt，与此无关），
     现复用为「上次采样时刻」，供下面的时钟跳变护栏判断。每次启动重置，避免暂停期的陈旧值。 */
  timerState.lastTickTime = Date.now();
  /* 小圆点相位基准也每次启动重置，避免跨会话的陈旧角度触发长弧倒扫。 */
  _dotLastDeg = 0;
  /* 时序核心 · 专注倒计时主基准（endAt 校准；有 clear，__ivGov 无 clear 语义不适用） */
  timerState.interval = setInterval(() => {
    if (!timerState.running || timerState.microActive) return;
    const now = Date.now();
    /* 时钟跳变护栏：系统时间被**往回**改（改表 / NTP 校正）时 endAt 基准失真，
       剩余时间会凭空变多、白送专注时长。正常 tick 间隔永远为正，故只拦往回跳，
       用同一负偏移重新锚定 endAt，剩余时间原样不受影响。
       向前跳无法与「后台被系统节流」区分（Android 挂后台时 tick 会长时间不来），
       不猜——那种情况下的流逝时间本来就是真流逝。 */
    if (timerState.lastTickTime && now - timerState.lastTickTime < -2000) {
      timerState.endAt += now - timerState.lastTickTime;
    }
    timerState.lastTickTime = now;
    timerState.remaining = Math.max(0, Math.floor((timerState.endAt - now) / 1000));
    /* 通知栏倒计时：每秒的 tick 是最自然的刷新点，内部再按 5 秒节流 */
    try { _maybeLiveNotify(); } catch (e) { if (window.__silent) window.__silent(e, '01c:_maybeLiveNotify'); }
    if (timerState.mode === 'free') {
      /* 自由专注：正计时累计 / 流式倒计时 —— 看策略表，别再直接问 freeType */
      if (strategyOfFreeType(timerState.freeType).countsDown) {
        timerState.remaining = Math.max(0, Math.floor((timerState.endAt - Date.now()) / 1000));
        if (timerState.remaining <= 0) {
          timerState.remaining = 0;
          updateTimerDisplay();
          stopTimerLoop();
          releaseWakeLock();
          UIFX.showFlowtimeDone();
          return;
        }
        if (now - _lastSnapshotAt >= 15000) { _lastSnapshotAt = now; saveTimerSnapshot(); }
        updateTimerDisplay();
        /* 自由专注也要能在专注中途弹微休息（原先这两个分支直接 return，
           连 tick 末尾的 checkMicroBreak() 都走不到） */
        checkMicroBreak();
        return;
      }
      /* 正计时：累计已跑秒数，仅显示；结算只在手动停止时（无自动归零） */
      timerState.remaining =
        (timerState.pausedElapsed || 0) + Math.max(0, Math.floor((Date.now() - timerState.startTime) / 1000));
      if (now - _lastSnapshotAt >= 15000) { _lastSnapshotAt = now; saveTimerSnapshot(); }
      updateTimerDisplay();
      checkMicroBreak();
      return;
    }
    if (timerState.mode === 'focus') {
      const elapsed = timerState.totalDuration - timerState.remaining;
      /* tick 中按结算同口径（elapsed - totalInterruptSeconds）实时累计有效时长，并每 15s 重写快照。
         只在启动时保存一次的话 effectiveSeconds 恒为 0，「超时自动按快照结算」就形同虚设。
         15s 粒度下恢复判定误差最多 15 秒，对 ≥50% 计入阈值影响可忽略。 */
      timerState.effectiveSeconds = Math.max(0, elapsed - timerState.totalInterruptSeconds);
      if (now - _lastSnapshotAt >= 15000) {
        _lastSnapshotAt = now;
        saveTimerSnapshot();
      }
      const pct = timerState.totalDuration > 0 ? elapsed / timerState.totalDuration : 0;
      if (!timerState.check50 && pct >= 0.5) {
        timerState.check50 = true;
        triggerMidCheck('还在专注吗？');
      }
      if (!timerState.check75 && pct >= 0.75) {
        timerState.check75 = true;
        triggerMidCheck('保持节奏');
      }
      if (!timerState.last60vibrate && timerState.remaining <= 60 && timerState.remaining > 0) {
        timerState.last60vibrate = true;
        if (appData.settings.nearEndSound !== false) UIFX.playSound('nearEnd');
        if (navigator.vibrate) navigator.vibrate(200);
      }
      /* 沉浸式专注：倒计时进度实时驱动剧情（场景文案切换 + 中途紧急事件） */ if (
        appData.settings.immersiveFocus &&
        UIFX.immersiveIsActive()
      ) {
        UIFX.updateImmersiveScene(pct);
        UIFX.checkImmersiveLiveEvent(pct);
      }
    }
    if (timerState.remaining <= 0) {
      timerState.remaining = 0;
      onTimerComplete();
      return;
    }
    updateTimerDisplay();
    checkMicroBreak();
  }, 1000);
}
/* 专注过半的文字提醒：只改文字，不发声（避免专注中途乱响） */
function triggerMidCheck(text) {
  const label = document.getElementById('timerLabel');
  const old = label.textContent;
  label.textContent = text;
  label.style.color = 'var(--yellow-dark)';
  label.style.fontWeight = '700';
  setTimeout(() => {
    label.textContent = old;
    label.style.color = '';
    label.style.fontWeight = '';
  }, 3000);
}
function stopTimerLoop() {
  /* 计时停了 → 通知栏那条常驻倒计时也一起收掉。
     放在这里而不是各个 finish/pause 分支，理由同上：所有"计时停了"的路都汇到这一个点。 */
  try { _clearLiveNotify(); } catch (e) { if (window.__silent) window.__silent(e, '01c:stopTimerLoop'); }
  /* ★ 实际时段（多段）：**所有**"计时停了"的路都汇到这里 —— 暂停、打断、到点、
     换任务、退出、休息、重置。所以收段的钩子挂在 stopTimerLoop 这一个点上。
     （名单靠 _tbOpenSegTodoId 而不是 timerState.linkedTodoId：见它的定义处。） */
  if (_tbOpenSegTodoId) {
    /* 有「已知真实结束时刻」就按它收（自然到点），否则按此刻（暂停/打断/换任务/退出） */
    closeTodoActualSeg(_tbOpenSegTodoId, _tbSegEndAt || 0);
    _tbSegEndAt = 0;
    _tbOpenSegTodoId = null;
  }
  if (timerState.interval) {
    clearInterval(timerState.interval);
    timerState.interval = null;
  }
  if (timerState.calibrateIv) {
    clearInterval(timerState.calibrateIv);
    timerState.calibrateIv = null;
  }
}
/* 锁屏常亮：番茄运行时保持屏幕不熄灭，结束/暂停时释放 */
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (_wakeLock) {
      try {
        await _wakeLock.release();
      } catch (e) { if (window.__silent) window.__silent(e, '01c:requestWakeLock'); }
    }
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => {
      _wakeLock = null;
    });
  } catch (e) {
    _wakeLock = null;
  }
}
function releaseWakeLock() {
  if (_wakeLock) {
    try {
      _wakeLock.release();
    } catch (e) { if (window.__silent) window.__silent(e, '01c:releaseWakeLock'); }
  }
  _wakeLock = null;
}
/* 对外只读查询：常亮策略的持有方（增强层）靠它判断要不要再补一次请求，
   不必去读本模块的私有变量 —— 私有状态只在这里读写。 */
function wakeLockActive() { return !!_wakeLock; }
function updateTimerDisplay() {
  if (
    isNaN(timerState.remaining) ||
    timerState.remaining === null ||
    timerState.remaining === undefined ||
    timerState.remaining < 0
  ) {
    const wd =
      appData.settings &&
      appData.settings.workDuration &&
      !isNaN(appData.settings.workDuration) &&
      appData.settings.workDuration > 0
        ? appData.settings.workDuration
        : 25;
    timerState.remaining = wd * 60;
    timerState.totalDuration = wd * 60;
  }
  if (isNaN(timerState.totalDuration) || timerState.totalDuration <= 0) {
    timerState.totalDuration = timerState.remaining;
  }
  const m = Math.floor(timerState.remaining / 60);
  const s = timerState.remaining % 60;
  let timeStr;
  if (appData.settings.fuzzyTimer && timerState.mode === 'focus' && timerState.remaining > 60) {
    if (timerState.remaining >= 20 * 60) timeStr = '20多分钟';
    else if (timerState.remaining >= 15 * 60) timeStr = '15分钟多';
    else if (timerState.remaining >= 10 * 60) timeStr = '10分钟多';
    else if (timerState.remaining >= 5 * 60) timeStr = '几分钟';
    else timeStr = '快结束了';
  } else {
    timeStr = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  document.getElementById('timerTime').textContent = timeStr;
  /* 进度：只有「有总时长且按剩余推」的模式才画（正计时没有总时长概念 → 恒 0）。
     旧写法是三层嵌套三元（free ? (flowtime ? … : 0) : …），两种模式各写一遍同一个公式；
     现在问一次策略表即可。 */
  const _pStrat =
    timerState.mode === 'free' ? strategyOfFreeType(timerState.freeType) : TIMER_STRATEGIES.pomodoro;
  const pct =
    _pStrat.ringFromRemaining && timerState.totalDuration > 0
      ? (1 - timerState.remaining / timerState.totalDuration) * 100
      : 0;
  document.getElementById('timerProgress').style.transform = 'scaleY(' + pct / 100 + ')';
  /* SVG 进度环：周长 2π×105 ≈ 659.73，offset=周长×(1-进度) */ const _ring = document.getElementById('timerRingFill');
  if (_ring) {
    const _C = 2 * Math.PI * 105;
    if (!_ring.getAttribute('stroke-dasharray')) _ring.style.strokeDasharray = _C;
    const _off = !_pStrat.ringFromRemaining ? 0 : Math.max(0, Math.min(_C, _C * (1 - pct / 100)));
    _ring.style.strokeDashoffset = _off.toFixed(1);
  }
  /* 公转小圆点：相位锁到「已用秒数」，与计时器同源。
     用**已用**而非剩余秒数，正计时 / 倒计时两个方向都会顺时针走。
     ⚠️ 角度**故意不取模**，别改成 `(_elapsed % 60) * 6`：
     CSS 过渡对 rotate() 按**角度数值线性插值** —— 354deg → 0deg 会沿**长弧倒退 354°**，
     看上去就是「转完一圈又倒回正上方再转一圈」。
     正确做法：角度只增不减，每 tick +6°，一分钟正好整圈、下分钟自然接着转。
     角度多大都无所谓（25 分钟才 9000deg，CSS 随便吃）。 */
  const _dotWrap = document.querySelector('.timer-circle-wrap');
  if (_dotWrap) {
    const _elapsed = _pStrat.elapsedIsRemaining
      ? Math.max(0, timerState.remaining)                                   /* 正计时：remaining 即已跑秒数 */
      : Math.max(0, (timerState.totalDuration || 0) - timerState.remaining); /* 倒计时/流式 */
    const _deg = _elapsed * 6;
    const _delta = _deg - _dotLastDeg;
    /* 只有「正常走一秒」（+6°，容差到 12° 防零星补偿）才做平滑过渡；
       其余情况（重开会话归 0、后台挂起后时间跳变）一律**瞬间归位** ——
       否则又是同一条老路：沿长弧倒扫一大圈，看着像故障。 */
    _dotWrap.style.setProperty('--dot-dur', _delta > 0 && _delta <= 12 ? '.95s' : '0s');
    _dotWrap.style.setProperty('--dot-rot', _deg.toFixed(1) + 'deg');
    _dotLastDeg = _deg;
  }
  /* 表盘模式类：控制环颜色/呼吸 */ const _tc = document.getElementById('timerCircle');
  if (_tc) {
    const _cls = [
      'mode-break',
      'mode-long',
      'mode-free',
      'free-flowtime',
      'free-stopwatch',
      'is-running',
      'is-paused',
      'is-idle'
    ];
    _cls.forEach(function (c) {
      _tc.classList.remove(c);
    });
    const _modeClass =
      timerState.mode === 'short'
        ? 'mode-break'
        : timerState.mode === 'long'
          ? 'mode-long'
          : timerState.mode === 'free'
            ? 'mode-free'
            : '';
    if (_modeClass) _tc.classList.add(_modeClass);
    if (timerState.mode === 'free') _tc.classList.add(strategyOfFreeType(timerState.freeType).clsSuffix);
    _tc.classList.add(timerState.running ? 'is-running' : 'is-paused');
    if (timerState.mode === 'idle') _tc.classList.add('is-idle');
    _tc._modeClasses = true;
  }
  /* ===== 数字/圆环刷新后【同帧】通知滴答钩子。
   * 02 模块注册 window.__onTimerFrame；滴答与秒数显示同源触发，
   * 根治此前"滴答声与走秒错位/卡一会响一下"（双 1s interval 相位不齐所致）。 */
  if (typeof window.__onTimerFrame === 'function') {
    try {
      window.__onTimerFrame(timerState);
    } catch (e) { if (window.__silent) window.__silent(e, '01c-onTimerFrame'); }
  }
}
function toggleFuzzyTimer() {
  appData.settings.fuzzyTimer = !appData.settings.fuzzyTimer;
  saveData();
  updateFuzzyToggleUI();
  updateTimerDisplay();
}
function updateFuzzyToggleUI() {
  const el = document.getElementById('fuzzyToggle');
  if (el) el.classList.toggle('active', appData.settings.fuzzyTimer);
}
function onTimerComplete() {
  /* ★ 自然完成的「结束时刻」= 倒计时归零那一刻（= 排定的 timerState.endAt），
     **不是**用户点「结算」那一刻。它下面几行就会被清零，所以先抓住。
     用户完全可能在番茄完成后几十分钟才回来结算（关页 / 后台回收 / 就是忘了点），
     旧写法在落库时用 Date.now() 当 endTime，记录被拉成「开始 → 结算时刻」：
     日志卡的组头与组时长自相矛盾、日程网格色块一路撑到结算时刻（实测差 1h32m）。
     注意 endAt 在暂停/恢复时会被重算成绝对时刻，所以它跨冻结依然准确。 */
  const _naturalEndAt = Number(timerState.endAt) || Date.now();
  /* ★ 顺带把「收段的时刻」也钉在归零那一刻：stopTimerLoop 里收段用的是 Date.now()，
     而 tick 可能被后台节流几十分钟才跑起来 —— 那段时间会白白算进这一段。 */
  _tbSegEndAt = _naturalEndAt;
  stopTimerLoop();
  releaseWakeLock();
  timerState.running = false;
  timerState.remaining = 0;
  timerState.endAt = 0;
  let im = document.getElementById('immersionMode');
  if (im && im.classList.contains('show')) {
    im.classList.remove('show');
    UIFX.clearImmersionTimer();
  }
  updateTimerDisplay();
  if (timerState.mode === 'focus') {
    // 仅在专注结束时响，休息结束走下面的 breakEnd，避免两种声音叠在一起
    UIFX.playSound('focusEnd');
    UIFX.showFocusQuote('finish');
    if (navigator.vibrate) navigator.vibrate(200);
    notify('番茄结束', '专注时间到！', { kind: 'pomo-end', sticky: true });
    timerState.effectiveSeconds = timerState.totalDuration;
    clearTimerSnapshot();
    /* 自然完成的番茄持久化「待结算」：关页面/后台回收后回来可恢复结算窗，记录不丢（Bug4） */
    appData.pendingFinish = {
      mode: 'natural',
      effectiveSeconds: timerState.effectiveSeconds,
      totalDuration: timerState.totalDuration,
      taskName: timerState.taskName || '',
      note: timerState.note || '',
      linkedTodoId: timerState.linkedTodoId || null,
      curSubId: timerState.curSubId || null,
      startTime: timerState.startTime || Date.now(),
      /* ★ 归零那一刻（见函数头）：结算时用它当记录的 endTime，而不是结算时刻 */
      endedAt: _naturalEndAt,
      startEnergy: timerState.startEnergy || null,
      startMood: timerState.startMood || null,
      interruptQuotaExceeded: !!timerState.interruptQuotaExceeded
    };
    saveDataNow();
    showFinishModal('natural');
  } else {
    UIFX.playSound('breakEnd');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    notify('休息结束', '该继续专注了！', { kind: 'break-end', sticky: true });
    UIFX.hideImmersiveTransition(); /* 沉浸式专注：休息结束收起章节过渡页与环境音 */
    hideBreakDice();
    UIFX.showBreakEndRitual(); /* 峰终定律·结束仪式：温和提示音 + 鼓励语，带着正面情绪进入下一个番茄 */
    stopTimerLoop();
    timerState.running = false;
    timerState.mode = 'idle';
    /* 按钮/表盘按**当前计时模式**复位（free 下是 00:00「正计时」、番茄钟下是 25:00「准备开始」）。
       这里原来手写的是番茄钟那一套：自由专注结算后进的休息结束后，表盘停在休息剩余、
       按钮却仍是上一轮的接法 —— 与 resetToIdle 同源的漏配对，交给同一个出口画。 */
    applyTimerModeUI();
    /* 休息结束的提示文案最后盖上去（两种模式都要说"该继续了"） */
    document.getElementById('timerLabel').textContent = '⏰ 休息结束，该继续了！';
    if (timerState.breakRemindIv) clearInterval(timerState.breakRemindIv);
    // 休息结束后提示一次，之后只在用户切回页面时再提示，不再每30秒轮播打扰
    UIFX.toast('⏰ 休息结束啦，回来继续吧！');
    timerState.breakRemindShown = false;
    /* 受控轮询 · 休息结束提示（自带 document.hidden 守卫；有 clear） */
    timerState.breakRemindIv = setInterval(() => {
      if (document.hidden) {
        timerState.breakRemindShown = false;
      } else if (!timerState.breakRemindShown) {
        timerState.breakRemindShown = true;
        UIFX.toast('⏰ 休息结束啦，回来继续吧！');
      }
    }, 15000);
  }
}
/* 打断原因分类（分析时按类归并，避免「其他」霸榜） */
const INTERRUPT_CATEGORIES = [
  {
    key: 'phone',
    label: '📱 刷手机',
    keys: ['刷手机', '看手机', '手机', '刷', '抖音', '短视频', '微博', '小红书', '淘宝', '视频', '游戏', '小说']
  },
  {
    key: 'msg',
    label: '💬 回消息',
    keys: ['回消息', '消息', '微信', 'qq', '信息', '回复', '回信', '电话', '来电', '接电话', '邮件']
  },
  {
    key: 'people',
    label: '👥 别人找我',
    keys: [
      '别人找我',
      '别人',
      '找我',
      '同事',
      '老板',
      '家人',
      '妈妈',
      '爸爸',
      '老婆',
      '老公',
      '孩子',
      '客户',
      '领导',
      '同学'
    ]
  },
  { key: 'notice', label: '🔔 通知打扰', keys: ['通知', '提醒', '弹窗', '推送', '铃声', '叮'] },
  { key: 'toilet', label: '🚽 上厕所', keys: ['上厕所', '厕所', '洗手间', '尿急', '小便', '大便', '拉', '尿'] },
  { key: 'drink', label: '💧 喝水', keys: ['喝水', '倒水', '水杯', '口渴'] },
  { key: 'food', label: '🍚 吃东西', keys: ['吃东西', '吃', '饭', '零食', '水果', '泡面', '外卖', '下午茶', '点心'] },
  { key: 'distract', label: '💭 走神发呆', keys: ['走神', '发呆', '想', '神游', '分心', '思绪'] },
  { key: 'tired', label: '😴 困了休息', keys: ['困', '累', '睡', '休息', '闭眼', '眯'] },
  { key: 'house', label: '🏠 家务琐事', keys: ['家务', '扫地', '洗碗', '快递', '取快递', '收衣服', '做饭', '晾'] },
  { key: 'work', label: '💼 临时事务', keys: ['工作', '开会', '会议', '处理', '切换', '临时', '急事', '任务', '事务'] }
];
/* 打断原因归类：优先精确匹配已知类别，其次关键词匹配，最后归「其他」 */
function categorizeInterrupt(reason) {
  const r = (reason || '').trim();
  if (!r) return '📝 其他';
  for (let i = 0; i < INTERRUPT_CATEGORIES.length; i++) {
    const c = INTERRUPT_CATEGORIES[i];
    if (r === c.label || r.indexOf(c.label.slice(2)) >= 0) return c.label;
  }
  for (let i = 0; i < INTERRUPT_CATEGORIES.length; i++) {
    const c = INTERRUPT_CATEGORIES[i];
    for (let j = 0; j < c.keys.length; j++) {
      if (r.indexOf(c.keys[j]) >= 0) return c.label;
    }
  }
  return '📝 其他';
}
function pickInterrupt(val) {
  const el = document.getElementById('interruptReason');
  el.value = val;
  if (!val) {
    el.focus();
    UIFX.toast('📝 写一句具体原因，统计时会归入对应分类');
  } else el.focus();
}
function interruptPomodoro() {
  if (timerState.mode !== 'focus' || !timerState.running) return;
  if (timerState.interruptQuotaExceeded) {
    UIFX.toast('打断额度已用完，无法再打断');
    return;
  }
  timerState.running = false;
  timerState.pausedRemaining = timerState.remaining;
  timerState.currentInterruptStart = Date.now();
  document.getElementById('interruptReason').value = '';
  updateInterruptCountdown();
  UIFX.updateImmersiveInterruptHint();
  UIFX.showModal('interruptModal');
  if (timerState.interruptIv) clearInterval(timerState.interruptIv);
  /* 受控轮询 · 打断弹窗倒计时 1s（有 clear） */
  timerState.interruptIv = setInterval(updateInterruptCountdown, 1000);
}
function updateInterruptCountdown() {
  /* ★ DOM 守卫（P2-6）：这是每秒被调一次的轮询函数。弹窗被切走 / 重建期间
     #interruptInfo 可能不存在，原来的 el.textContent 会每秒抛一次 TypeError，
     错误面板被刷屏、后面的样式分支也全跳过。 */
  const el = document.getElementById('interruptInfo');
  if (!el) {
    if (timerState.interruptIv) { clearInterval(timerState.interruptIv); timerState.interruptIv = null; }
    return;
  }
  const tol = Number((appData.settings && appData.settings.interruptTolerance) || 0) * 60;
  const used = timerState.totalInterruptSeconds + Math.floor((Date.now() - timerState.currentInterruptStart) / 1000);
  const remaining = Math.max(0, tol - used);
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  el.textContent = '剩余打断额度：' + min + '分' + sec + '秒';
  if (remaining > 180) {
    el.style.color = '';
    el.style.fontWeight = '';
    el.style.fontSize = '';
  } else if (remaining > 60) {
    el.style.color = 'var(--yellow-dark)';
    el.style.fontWeight = '700';
  } else {
    el.style.color = '#C0392B';
    el.style.fontWeight = '700';
    el.style.fontSize = '15px';
  }
  if (remaining <= 0) {
    if (timerState.interruptIv) {
      clearInterval(timerState.interruptIv);
      timerState.interruptIv = null;
    }
    const reason = document.getElementById('interruptReason').value.trim();
    /* 钳制 duration：超时后只计剩余额度，多出的时间不算打断，避免 effectiveSeconds 异常 */ const remainingQuota =
      Math.max(0, tol - timerState.totalInterruptSeconds);
    const duration = remainingQuota;
    timerState.totalInterruptSeconds += duration;
    timerState.interruptions.push({ reason: reason, duration: duration, startTime: timerState.currentInterruptStart });
    UIFX.closeModal('interruptModal');
    timerState.interruptQuotaExceeded = true;
    document.getElementById('btnInterrupt').disabled = true;
    timerState.endAt = Date.now() + timerState.pausedRemaining * 1000;
    timerState.running = true;
    UIFX.toast('⚠️ 打断额度已用完，无法继续暂停计时');
  }
}
function resumeFromInterrupt() {
  if (timerState.interruptIv) {
    clearInterval(timerState.interruptIv);
    timerState.interruptIv = null;
  }
  const reason = document.getElementById('interruptReason').value.trim();
  const duration = Math.floor((Date.now() - timerState.currentInterruptStart) / 1000);
  timerState.totalInterruptSeconds += duration;
  timerState.interruptions.push({ reason: reason, duration: duration, startTime: timerState.currentInterruptStart });
  UIFX.closeModal('interruptModal');
  const tol = appData.settings.interruptTolerance * 60;
  if (timerState.totalInterruptSeconds > tol) {
    timerState.interruptQuotaExceeded = true;
    document.getElementById('btnInterrupt').disabled = true;
    timerState.endAt = Date.now() + timerState.pausedRemaining * 1000;
    timerState.running = true;
    UIFX.toast('⚠️ 打断额度已用完，无法继续暂停计时');
    return;
  }
  timerState.endAt = Date.now() + timerState.pausedRemaining * 1000;
  timerState.running = true;
  scheduleNextMicroBreak();
  UIFX.toast('已记录打断，继续加油');
}
function finishPomodoro() {
  if (timerState.mode !== 'focus' || !timerState.running) return;
  /* 微休息正开着时点「结束」：先正常结束微休息（弹窗关闭+结束音照响），避免定时器残留到点突然响 */
  if (timerState.microActive) skipMicroBreak();
  stopTimerLoop();
  releaseWakeLock();
  timerState.running = false;
  timerState.pausedRemaining = timerState.remaining;
  clearTimerSnapshot();
  const elapsed = Math.floor((Date.now() - timerState.startTime) / 1000);
  timerState.effectiveSeconds = Math.max(0, elapsed - timerState.totalInterruptSeconds);
  /* 防负值：打断累计不会超过墙钟时间，仍留兜底 */ showFinishModal('manual');
    try {
      const _sel = document.getElementById('finishType');
      if (_sel && !_sel.value) _sel.value = 'full';
      onFinishTypeChange();
    } catch (e) { if (window.__silent) window.__silent(e, '01c:finishTypeDefault'); }
}
function showFinishModal(source) {
  timerState.finishSource = source;
  document.getElementById('finishNote').value = timerState.note || '';
  document.getElementById('finishType').value = '';
  /* 展示「实际专注 X 分 Y 秒」，不再只给整分（此前 22.5 分钟会被写成「有效专注时长：22 分钟」，
     与设置里的 25 分钟档位看起来对不上，用户误以为计时出错）。这里展示的是**计时结果**，
     与「默认记完整还是半个」（满 25 分钟才默认完整，见本函数末尾的默认选中规则）是两回事。 */
  const _secTotal = Math.max(0, Math.floor(timerState.effectiveSeconds || 0));
  const _em = Math.floor(_secTotal / 60);
  const _es = _secTotal % 60;
  const _planMin = Math.round((timerState.totalDuration || _secTotal) / 60);
  const _lossSec = Math.max(0, (timerState.totalDuration || _secTotal) - _secTotal);
  const _durTxt = _em + ' 分' + _es + ' 秒';
  document.getElementById('finishInfo').textContent =
    '实际专注 ' +
    _durTxt +
    (timerState.finishSource === 'natural'
      ? '（计划 ' + _planMin + ' 分钟，已自然完成）'
      : _lossSec > 0
        ? '（计划 ' + _planMin + ' 分钟，中途被打断约 ' + Math.ceil(_lossSec / 60) + ' 分钟）'
        : '') +
    ' · 按完整番茄折算 ≈ ' +
    calcPomos(timerState.effectiveSeconds, 'full') +
    ' 个🍅（25分钟=1）';
  /* 🍅 按有效专注时长开放选项：完整≥15 分钟可选、半个≥5 分钟可选、未完成始终可选（自评）；
     默认选中规则——**满 25 分钟才默认「完整🍅」，不足 25 分钟一律默认「半个🍅」**，
     想记完整自行选（选了就按 1 个起算）。15 分钟档这类短时段跑不到 25 分钟，不该被默认当完整番茄。 */
  const sel = document.getElementById('finishType');
  const optFull = sel.querySelector('option[value="full"]');
  const optHalf = sel.querySelector('option[value="half"]');
  const optInc = sel.querySelector('option[value="incomplete"]');
  const optLog = sel.querySelector('option[value="log"]');
  const sec = timerState.effectiveSeconds || 0;
  const quotaExceeded = !!timerState.interruptQuotaExceeded;
  const hint = document.getElementById('finishTypeHint');
  const wrap = document.getElementById('finishTypeWrap');
  const showWrap = function (show) {
    if (wrap) wrap.style.display = show ? '' : 'none';
  };
  /* 选项文本显示实际收益 */
  const _f = calcPomos(sec, 'full');
  optFull.textContent = '完整🍅 ×' + _f;
  optHalf.textContent = '半个🍅 ×0.5';
  optInc.textContent = '未完成 ×0';
  /* 「仅记录」任何时候都能选：它压根不是番茄，没有时长门槛 */
  if (optLog) optLog.textContent = '仅记录（只记时间，不算番茄）';
  optFull.disabled = sec < MIN_FULL_MINUTES * 60;
  optHalf.disabled = sec < 5 * 60;
  optInc.disabled = false;
  if (optLog) optLog.disabled = false;
  const onlyOne = optFull.disabled && optHalf.disabled && !quotaExceeded;
  if (quotaExceeded) {
    sel.value = 'half';
    showWrap(true);
    hint.textContent =
      '⚠️ 本次打断较多，建议「半个🍅」或「未完成」（不强制）；完整🍅仍可选，按实际专注折算 ' + _f + ' 个';
  } else if (sec >= POMO_BASE_SECONDS) {
    sel.value = 'full';
    showWrap(true);
    hint.textContent = '专注满 25 分钟，默认「完整🍅 ×' + _f + '」；也可自评半个或未完成';
  } else if (sec >= MIN_FULL_MINUTES * 60) {
    /* 不足 25 分钟：默认「半个🍅」，完整🍅自选 */
    sel.value = 'half';
    showWrap(true);
    hint.textContent =
      '专注不足 25 分钟，默认「半个🍅 ×0.5」；想记「完整🍅」（' + _f + ' 个）可自行选择';
  } else if (sec >= 5 * 60) {
    sel.value = 'half';
    showWrap(true);
    hint.textContent = '专注不足 15 分钟，默认「半个🍅」；未完成也可自评';
  } else {
    /* 不足 5 分钟：默认「未完成」，但**不再把类型选择器整个藏掉** ——
       只做了 3 分钟就去配眼镜、单纯想记下这段时间的情况，本来就要选「仅记录」；
       藏起来只剩默认值，等于逼用户把它记成一次失败的专注。
       完整/半个仍受时长门槛限制（灰掉），可选的只有「未完成」和「仅记录」。 */
    sel.value = 'incomplete';
    showWrap(true);
    hint.textContent = '专注不足 5 分钟，默认按「未完成」；只想记下这段时间，可选「仅记录」';
  }
  UIFX.renderGridPicker('finishEnergyPicker', timerState.startEnergy, 'green');
  UIFX.renderGridPicker('finishMoodPicker', timerState.startMood, 'yellow');
  /* 每次开窗都从「没动过」开始：上次结算补勾的标记不能漏给下一次
     （漏了就会让下一次记录的 planSubs 全部不截断，把更晚完成的步骤也算进去）。 */
  timerState.settleSubsEdited = false;
  try {
    if (typeof renderFinishSubs === 'function') renderFinishSubs();
  } catch (e) { if (window.__silent) window.__silent(e, '01c:renderFinishSubs'); }
  /* 把默认提示记下来：选「仅记录」时换成大白话，选回来要能还原 */
  if (hint) hint.dataset.base = hint.textContent;
  const _fi = document.getElementById('finishInfo');
  if (_fi) _fi.dataset.base = _fi.textContent;
  UIFX.showModal('finishModal');
}
/* 结算类型切换：「仅记录」要把「折算 N 个🍅」这类话换成实话，
   否则界面上会出现「选了仅记录、却写着折算 1 个🍅」的自相矛盾 */
function onFinishTypeChange() {
  const sel = document.getElementById('finishType');
  if (!sel) return;
  const isLog = sel.value === 'log';
  const hint = document.getElementById('finishTypeHint');
  if (hint) {
    if (hint.dataset.base === undefined) hint.dataset.base = hint.textContent;
    hint.textContent = isLog
      ? '仅记录：只把这段时间记进日志（不算番茄、不影响专注效率、不发金币）'
      : hint.dataset.base;
  }
  const info = document.getElementById('finishInfo');
  if (info) {
    if (info.dataset.base === undefined) info.dataset.base = info.textContent;
    if (isLog) {
      /* 自由专注不走番茄时钟：effectiveSeconds 是 0，取本次真实结算时长，否则弹窗写着「0 分钟」 */
      const _logSecs = (timerState.finishSource === 'free' && freeSettleSecs)
        ? freeSettleSecs : (timerState.effectiveSeconds || 0);
      info.textContent =
        '实际时长 ' + ((_logSecs < 60) ? (_logSecs + ' 秒') : (Math.floor(_logSecs / 60) + ' 分钟'))
        + ' · 本条不计入番茄与专注效率';
    } else if (info.dataset.base !== undefined) {
      info.textContent = info.dataset.base;
    }
  }
}
function closeFinishModal() {
  /* 自由专注：取消 = 不记这笔，专注继续 */
  if (timerState.finishSource === 'free') {
    UIFX.closeModal('finishModal');
    timerState.pendingFinish = null;
    freeSettleSecs = null;
    /* 取消 = 这笔不落库，专注继续 → 「已点结束」的标记也要撤掉 */
    appData.pendingFreeSettle = null;
    saveDataNow();
    UIFX.toast('⏱️ 已取消，专注继续');
    return;
  }
  /* 自然完成（倒计时走完）：番茄已完成，点取消/点外面都不允许丢弃 → 强制完成结算 */
  if (timerState.finishSource === 'natural') {
    UIFX.toast('🍅 番茄已完成，请选择类型完成结算', true);
    return;
  }
  UIFX.closeModal('finishModal');
  appData.pendingFinish = null;
  saveDataNow();
  /* 手动点「结束」后取消 → 回到专注继续计时，不丢进度（自然完成没有取消的意义） */
  if (timerState.mode === 'focus' && timerState.finishSource === 'manual' && (timerState.pausedRemaining || 0) > 0) {
    timerState.running = true;
    timerState.endAt = Date.now() + timerState.pausedRemaining * 1000;
    startTimerLoop();
    scheduleNextMicroBreak();
    UIFX.toast('⏱️ 已取消结束，继续专注');
  } else {
    resetToIdle();
  }
}
function confirmFinish() {
  /* ★ 重入保护（P2-8）：极端双击 / 回车连发会让同一次结算走两遍 ——
     第二遍时 pendingFinish 已被清空，但 timerState 还带着上一轮的剩余量，
     结果是同一次专注落两条记录（番茄数、统计都翻倍）。
     用一次性闸门：进来先置位，落库同步完成后再释放（本函数无 await，同步安全）。 */
  if (window.__confirmFinishBusy) return;
  window.__confirmFinishBusy = true;
  try {
    return _confirmFinishInner();
  } finally {
    window.__confirmFinishBusy = false;
  }
}
function _confirmFinishInner() {
  const type = document.getElementById('finishType').value;
  if (!type) {
    UIFX.toast('请先选择番茄类型');
    return;
  }
  /* 先取出自由专注的待结算信息（下面会清掉） */
  var _pf = appData.pendingFinish || (typeof timerState !== 'undefined' && timerState.pendingFinish) || null;
  var _wasFree = !!(_pf && _pf.source === 'free');
  var _freeSecs = _wasFree ? (Number(_pf.secs) || 0) : 0;
  /* ★ 自然完成的结束时刻从待结算里取回来交给落库（见 onTimerComplete / restorePendingFinish）。
     手动提前结束、自由专注、补记都没有这个值 → 落库退回 Date.now()，口径不变。 */
  timerState.finishEndedAt = Number(_pf && _pf.endedAt) || 0;
  UIFX.closeModal('finishModal');
  appData.pendingFinish = null;
  /* 自由专注的「已点结束、待结算」标记到此为止（见 finishFreeTimer / restorePendingFreeSettle） */
  appData.pendingFreeSettle = null;
  savePomodoroRecord(type);
  resetToIdle();
  /* 自由专注结束也按实际专注时长进休息，和番茄钟一致；
     「仅记录」只留痕不打断节奏，不进休息 */
  var _isLogOnly = (type === 'log' || type === 'note');
  /* 「仅记录 / 备注」：番茄钟与自由专注同一个口径 —— 只留痕、不打断节奏，
     必须在这里拦住 01d 的兜底自动休息（过去只写在 _wasFree 分支里 → 番茄钟选「仅记录」照进休息） */
  if (_isLogOnly) timerState.__noAutoBreak = true;
  if (_wasFree) {
    if (!_isLogOnly && _freeSecs >= 5 * 60) {
      /* 休息时长按实际专注时长分级（30 分钟 → 短休 5 分，50 分钟 → 短休 10 分） */
      timerState.__noAutoBreak = false;
      timerState.totalDuration = _freeSecs;
      startBreak('short');
    } else {
      /* 短时段 / 仅记录：只留痕不打断，且要拦住 01d 的兜底自动休息 */
      timerState.__noAutoBreak = true;
    }
  }
}
function resetToIdle() {
  if (timerState.interruptIv) {
    clearInterval(timerState.interruptIv);
    timerState.interruptIv = null;
  }
  if (timerState.microIv) {
    clearInterval(timerState.microIv);
    timerState.microIv = null;
  }
  /* 补登记休息结束提醒定时器——此前仅 startPomodoroCore 清理，
     休息结束后不再开新番茄则 15s interval 永久空转，且 hidden 置位致幽灵 toast */
  if (timerState.breakRemindIv) {
    clearInterval(timerState.breakRemindIv);
    timerState.breakRemindIv = null;
  }
  stopTimerLoop();
  releaseWakeLock();
  clearTimerSnapshot();
  UIFX.hideImmersiveTransition();
  timerState.mode = 'idle';
  timerState.running = false;
  timerState.endAt = 0;
  timerState.pausedRemaining = 0;
  timerState.microActive = false;
  timerState.microNextAt = 0;
  UIFX.renderGridPicker('startEnergyPicker', null, 'green');
  UIFX.renderGridPicker('startMoodPicker', null, 'yellow');
  /* ★ 待命态一律交给 applyTimerModeUI 画 —— 它本来就按 timerMode 分两套：
     按钮文案 / onclick / 表盘归零 / 「打断」显隐 / 番茄专属区显隐 / 刷新计划下拉。
     ★ 为什么不能在这里手写一份：本函数不只在番茄钟里跑 ——
       自由专注结算确认（confirmFinish）与休息结束（exitBreak）也走这里。
       旧写法手写的正是**番茄钟那一套**：`timerMode` 明明还是 stopwatch，
       界面却被刷成「25:00 / 准备开始」，且**没重设开始按钮**，上一轮的「⏸ 暂停」
       留在原地 → 用户点「暂停」反而进了 toggleFreeTimer 的开始分支，正计时才跑起来
       。
     ★ 手写第二份 = 迟早漏配对一个 —— 上一份就是这么来的。 */
  applyTimerModeUI();
  UIFX.renderImmersiveProgress();
  UIFX.updateRoundStats();
  hideBreakDice();
  const _tsb = document.getElementById('timerSubsBox');
  if (_tsb) _tsb.style.display = 'none';
}
function startBreak(mode) {
  /* 守卫：正在专注中（running）不允许切休息。
     完成番茄后的自动休息（300ms 定时器）可能撞上用户刚点下的新番茄，必须放弃，避免打断专注。 */
  if (timerState.mode === 'focus' && timerState.running) return;
  clearTimerSnapshot();
  timerState.mode = mode === 'long' ? 'longBreak' : 'shortBreak';
  timerState.running = true;
  /* 休息时长按专注时长分级（不同分钟数配不同休息，见 getBreakByDuration）：
     简单≤15min→短休3/长休10 · 中等16-35→短休5/长休20 · 沉浸式36-65→短休10/长休30 · 大师>65→短休15/长休40
     关闭自适应时用设置值（默认 5/20） */
  let dur;
  if (mode === 'long') {
    dur = appData.settings.adaptiveSuggest ? getBreakByDuration(true) : appData.settings.longBreak;
  } else {
    dur = appData.settings.adaptiveSuggest ? getBreakByDuration(false) : appData.settings.shortBreak;
  }
  timerState.remaining = dur * 60;
  timerState.totalDuration = dur * 60;
  timerState.startTime = Date.now();
  timerState.endAt = Date.now() + dur * 60 * 1000;
  timerState.pausedRemaining = 0;
  timerState.totalInterruptSeconds = 0;
  timerState.interruptions = [];
  timerState.check50 = false;
  timerState.check75 = false;
  timerState.last60vibrate = false;
  timerState.microNextAt = 0;
  timerState.microActive = false;
  document.getElementById('timerLabel').textContent = mode === 'long' ? '长休息' : '短休息';
  document.getElementById('timerTodo').textContent = '';
  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnFinish').disabled = true;
  document.getElementById('btnInterrupt').disabled = false;
  document.getElementById('btnInterrupt').innerHTML = '<span>跳过休息</span><span class="btn-sub">skip</span>';
  document.getElementById('btnInterrupt').onclick = skipBreak;
  UIFX.playSound('breakStart');
  startTimerLoop();
  updateTimerDisplay();
  showBreakDice();
  /* 峰终定律·峰值设计：休息时展示一条冷知识（轻量文字，大脑转换），关闭自适应则跳过 */
  if (mode !== 'long' && appData.settings.adaptiveSuggest) UIFX.showRestFact();
  /* 沉浸式专注：短休开始且冒险进行中 → 全屏展示章节过渡页（可点击跳过） */
  if (mode !== 'long' && appData.settings.immersiveFocus && UIFX.immersiveIsActive()) {
    UIFX.showImmersiveTransition();
  }
}
function skipBreak() {
  stopTimerLoop();
  timerState.running = false;
  exitBreak();
}
function startLongBreakFromModal() {
  if (timerState.mode === 'focus' && timerState.running) {
    stopTimerLoop();
    timerState.running = false;
  }
  startBreak('long');
}
function exitBreak() {
  stopTimerLoop();
  resetToIdle();
}
/* 休息活动骰子：科学原理 = 眼睛离开屏幕，所有活动都是"不看手机"的真实休息；参考番茄休息站 */
const BD_REST_ACTIVITIES = [
  { emoji: '🙆‍♀️', name: '伸懒腰', desc: '坐着或站起来，慢慢伸一个大大的懒腰' },
  { emoji: '🧍', name: '原地伸展', desc: '站起来，原地走一走，扭扭腰，活动一下' },
  { emoji: '🚶', name: '走一圈', desc: '在室内或过道散步转圈，放松一下腰背' },
  { emoji: '🙆', name: '绕肩', desc: '正绕 5 圈，再反绕 5 圈' },
  { emoji: '🫁', name: '深呼吸', desc: '3 次深呼吸，鼻子慢慢吸气，嘴巴柔柔吐气' },
  { emoji: '💆', name: '梳头皮', desc: '弯曲手指像梳子，轻轻梳理整个头皮' },
  { emoji: '💗', name: '和自己在一起', desc: '右手放在心脏处，闭眼感受与自己在一起' },
  { emoji: '🦋', name: '蝴蝶拍', desc: '双手交叉在胸前，交替轻拍肩膀，各拍 1 次为 1 轮，8-12 轮' },
  { emoji: '💧', name: '喝口水', desc: '起身去接一杯水，慢慢喝完' },
  { emoji: '🪟', name: '看窗外', desc: '走到窗边远眺，让眼睛离开屏幕' },
  { emoji: '👀', name: '扫视环境', desc: '抬头看看桌面和周围，发现平时没注意到的小细节' },
  { emoji: '🧘', name: '正念呼吸', desc: '闭眼做一会儿正念呼吸，感受气息进出' },
  { emoji: '🌿', name: '闻一闻', desc: '闻闻手边的花/茶/咖啡香气' },
  { emoji: '✨', name: '其它放松', desc: '做一件此刻让你放松的小事，身体最知道自己需要什么' }
];
const BD_EXERCISE_ACTIVITIES = [
  { emoji: '🦵', name: '提踵', desc: '扶桌或椅背，慢慢踮起脚后跟再放下', reps: '15 次 × 2 组' },
  { emoji: '🙆', name: '扩胸后展', desc: '双手背后轻轻交握，缓缓挺胸向后展开', reps: '8-10 次' },
  { emoji: '🐈', name: '桌边俯卧撑', desc: '双手撑结实桌沿，倾斜身体慢屈臂再推起', reps: '10 次 × 2 组' },
  { emoji: '🦿', name: '原地高抬腿', desc: '站稳，轮流把膝盖抬到舒服的高度，节奏放慢', reps: '左右各 15 次' },
  { emoji: '🧎', name: '椅子站坐', desc: '不借手臂的力慢慢站起再坐下', reps: '10-12 次' },
  { emoji: '🤸', name: '侧腰伸展', desc: '一手向上过头顶，身体轻轻向另一侧弯，换边', reps: '左右各 15 秒' },
  { emoji: '🦴', name: '猫式弓背', desc: '含胸低头把背拱圆，再慢慢挺胸抬头', reps: '8 次' },
  { emoji: '👐', name: '手臂绕环', desc: '双臂向两侧平举，从小圈到大圈慢慢画圆', reps: '前后各 10 圈' },
  { emoji: '🚶', name: '原地踏步', desc: '原地踏步自然摆臂，让全身热起来', reps: '1-2 分钟' },
  { emoji: '🦢', name: '颈部伸展', desc: '头慢慢向一侧倒，用同侧手轻搭头部加一点点伸展感', reps: '左右各 15 秒' },
  { emoji: '🕊️', name: '肩胛收缩', desc: '双肩向后下方收紧，像把两块肩胛骨夹住', reps: '10 次' }
];
let _bdCategory = 'rest';
let _bdHistory = [];
let _bdRolling = false;
function bdGetPool() {
  return _bdCategory === 'exercise' ? BD_EXERCISE_ACTIVITIES : BD_REST_ACTIVITIES;
}
function setBdCategory(cat) {
  _bdCategory = cat;
  document.getElementById('bdTabRest').classList.toggle('active', cat === 'rest');
  document.getElementById('bdTabExercise').classList.toggle('active', cat === 'exercise');
  document.getElementById('bdEmoji').classList.remove('rolling');
  document.getElementById('bdEmoji').textContent = '🎲';
  document.getElementById('bdName').textContent = '准备好了吗？';
  document.getElementById('bdDesc').textContent = '点击下方按钮，随机抽一个活动';
  const r = document.getElementById('bdReps');
  r.classList.remove('show');
  r.textContent = '';
}
function toggleBdScience() {
  const s = document.getElementById('bdScience');
  const b = document.getElementById('bdHintBtn');
  s.classList.toggle('show');
  b.textContent = s.classList.contains('show') ? '收起 ▴' : '科学原理 ▾';
}
function bdRoll() {
  if (_bdRolling) return;
  _bdRolling = true;
  const btn = document.getElementById('bdRollBtn');
  btn.disabled = true;
  const emojiEl = document.getElementById('bdEmoji');
  const nameEl = document.getElementById('bdName');
  const descEl = document.getElementById('bdDesc');
  const repsEl = document.getElementById('bdReps');
  const pool = bdGetPool();
  emojiEl.classList.add('rolling');
  nameEl.textContent = '…';
  descEl.textContent = '';
  repsEl.classList.remove('show');
  const start = Date.now();
  /* 短一次性 · 抽签动画（600ms 自动清理，无需治理） */
  const iv = setInterval(() => {
    if (Date.now() - start > 600) {
      clearInterval(iv);
      emojiEl.classList.remove('rolling');
      const a = pool[Math.floor(Math.random() * pool.length)];
      emojiEl.textContent = a.emoji;
      nameEl.textContent = a.name;
      descEl.textContent = a.desc;
      if (a.reps) {
        repsEl.textContent = '💪 ' + a.reps;
        repsEl.classList.add('show');
      } else {
        repsEl.textContent = '';
        repsEl.classList.remove('show');
      }
      _bdHistory.unshift(a.emoji);
      if (_bdHistory.length > 8) _bdHistory.pop();
      bdRenderHistory();
      _bdRolling = false;
      btn.disabled = false;
    } else {
      const tmp = pool[Math.floor(Math.random() * pool.length)];
      emojiEl.textContent = tmp.emoji;
    }
  }, 70);
}
function bdRenderHistory() {
  const el = document.getElementById('bdHistory');
  if (!_bdHistory.length) {
    el.innerHTML = '<span class="bd-history-empty">抽到的小活动会显示在这里</span>';
    return;
  }
  el.innerHTML = _bdHistory
    .map(function (em) {
      return '<div class="bd-history-dot">' + em + '</div>';
    })
    .join('');
}
function showBreakDice() {
  const sec = document.getElementById('breakDiceSection');
  if (sec) sec.classList.add('show');
  if (!_bdHistory.length) bdRenderHistory();
}
function hideBreakDice() {
  const sec = document.getElementById('breakDiceSection');
  if (sec) sec.classList.remove('show');
}
/* 本轮统计的取数口径：appData.round.startTs 之后的记录。
   全项目读「本轮」只走这一个函数，避免又冒出一份会对不上的计数。 */
function getRoundStats() {
  return computeRoundStats(appData.records, (appData.round && appData.round.startTs) || 0);
}
/* 开新一轮：只记起点，计数由记录现算（见 computeRoundStats）。
   长休息 / 结束本轮 / 间隔过长 三处都用它，避免各处手写同一份状态。 */
function startNewRound() {
  appData.round = { startTs: Date.now() };
  saveData();
  UIFX.updateRoundStats();
}
function checkLongBreakTrigger() {
  /* 沉浸式专注：冒险进行中不自动长休 */
  if (UIFX.immersiveIsActive()) {
    window._longBreakPending = false;
    return;
  }
  const currentFull = getRoundStats().full;
  const iv = Math.max(1, (appData.settings && Number(appData.settings.longInterval)) || 4);
  /* 贪睡（Snooze）水印：每满一组（iv 的整数倍）提醒一次。点「继续学习」后
     该组内不再重复弹，到下一组阈值（2iv/3iv…）再正常提醒，避免无限弹窗 */
  if (currentFull < iv) {
    window._longBreakPending = false;
    window._longBreakSnoozeCount = 0;
    return;
  }
  const n = window._longBreakSnoozeCount || 0;
  if (currentFull < iv * (n + 1)) {
    window._longBreakPending = false;
    return;
  }
  if (!window._longBreakPending) {
    window._longBreakPending = true;
    if (appData.settings.longBreakForce) {
      setTimeout(function () {
        startNewRound();
        startBreak('long');
        window._longBreakPending = false;
        window._longBreakSnoozeCount = 0;
      }, 500);
    } else {
      UIFX.showModal('longBreakModal');
      window._longBreakSnoozeCount = Math.floor(currentFull / iv);
      window._longBreakPending = false;
    }
  }
}
function startLongBreakFromPrompt() {
  UIFX.closeModal('longBreakModal');
  startNewRound();
  window._longBreakPending = false;
  window._longBreakSnoozeCount = 0;
  startBreak('long');
}
function skipLongBreak() {
  UIFX.closeModal('longBreakModal');
  window._longBreakPending = false;
  /* 保留 SnoozeCount：同组不再提醒 */ UIFX.toast('已跳过，本组内不再提醒长休');
}
function endSession() {
  startNewRound();
  window._longBreakSnoozeCount = 0;
  UIFX.toast('本轮统计已清零');
}
function checkBufferReset() {
  const _rs = getRoundStats();
  if (_rs.lastFullEndTime && _rs.full > 0) {
    const gap = (Date.now() - _rs.lastFullEndTime) / 60000;
    if (gap > appData.settings.bufferTime) {
      startNewRound();
      UIFX.toast('间隔过长，本轮累计番茄数已清零');
    }
  }
}
/* 「多久打扰一次」这件事，随机分布的形状不是重点，重点是下面几条 ——
   而且这三条全都不给用户开关，全藏在代码里。
   设置页已经有一堆东西了，多一个开关就多一份「我得调一下」的压力：
   参数只有真正会因人而异的才配当设置，其余都该是「默认就对」的行为。

   ① 入场保护（MICRO_WARM_IN_MIN）：刚开始那几分钟人还没进状态，这时候打断只有负面作用。
      只把「第一次」推后，推完 into 变 0，对后续毫无影响 —— 天然幂等，重排/恢复/跳过都不会重复生效。
   ② 抗连短：均匀随机能抽出 3、3、3 分钟的连击，体感从「偶尔提醒」变成「它盯着我」。
      上一次偏短，这一次强制从区间上半段取，直接把连击这条路径掐掉。
   ③ 跳过自适应：连续跳过就说明现在不是时候。这是唯一带反馈的一条 —— 它读的是行为，
      不是时钟，所以它算得上「算法」，而不只是「分布」。
   ④ 分段节奏（只对长场次）：见下。 */
const MICRO_WARM_IN_MIN = 6;      /* 开场静默窗口（分钟）封顶。想改就改这一行，不设开关 */
const MICRO_SKIP_STREAK_FROM = 2; /* 连续跳过几次开始放长 */
const MICRO_SKIP_STEP = 0.4;      /* 每多跳一次多放长 40% */
const MICRO_SKIP_MAX = 1.8;       /* 最多放长到 1.8 倍，免得直接变成「永不提醒」 */

/* ⑤ 迟到上限（MICRO_OVERDUE_SEC）：排定的时刻过了太久，就不补这一次，直接重排。
   为什么需要：网页计时靠 setInterval，锁屏 / 切标签 / 切后台都会被浏览器节流，
   回到前台时它可能已经晚了十几分钟。这时候补弹「闭眼，感受呼吸」只有反效果 ——
   用户早就过了那口气，弹出来只是打断他此刻手头的事；而且这次迟到的休息还会
   把后面的间隔整体往后压，密度反而乱掉。
   ★ 90 秒而不是 60 秒：60 秒是给「系统闹钟精度」用的阈值，我们面对的不是闹钟误差
     而是页面被挂起。一次微休息本身才 10~20 秒，晚 90 秒就已经完全错过整个节拍，
     再早的判断（比如 45 秒）会误杀「切出去回一条消息」这种正常情况。 */
const MICRO_OVERDUE_SEC = 90;

/* ④ 分段节奏：长场次的「中段」把间隔拉长。
   依据是「警觉性衰减」的反面 —— 长任务里正确率随时间下降，但中段恰恰是深度思考
   真正发生的时候，这时候频繁打断的代价最高；到了末段人已经疲了，反而需要提醒把
   注意力拽回来。所以形状是「两头正常、中间稀疏」，而不是全程均匀。
   ★ 只在「知道总时长、且总时长够长」的时候启用：
     25 分钟的番茄整场都算入场期，分段没有意义；正计时没有终点，也就没有「末段」。
   ★ 不额外加密末段。对 3~5 分钟这个基准密度来说，中段 ×1.5 之后再回到基准，
     本身就已经是一次「变密」了，再加码等于把人推回被盯着的感觉。 */
const MICRO_PHASE_MIN_TOTAL_MIN = 60; /* 总时长不到这个数就不分段（分钟） */
const MICRO_PHASE_MID_FROM = 0.30;    /* 中段起点：已过总时长的 30% */
const MICRO_PHASE_MID_TO = 0.85;      /* 中段终点：过了 85% 就回到基准密度 */
const MICRO_PHASE_MID_STRETCH = 1.5;  /* 中段间隔放大倍数 */

/* 当前这一抽该不该按「中段」拉长（返回倍数，1 = 不变） */
function _microPhaseStretch() {
  /* 正计时没有总时长，取不到「占了几成」——直接不分段，靠跳过自适应兜着 */
  const countsDown =
    timerState.mode === 'focus' || strategyOfFreeType(timerState.freeType).countsDown;
  if (!countsDown) return 1;
  const total = timerState.totalDuration || 0;
  if (!(total > 0)) return 1;
  if (total / 60 < MICRO_PHASE_MIN_TOTAL_MIN) return 1;
  const frac = _microFocusElapsedSec() / total;
  if (frac >= MICRO_PHASE_MID_FROM && frac < MICRO_PHASE_MID_TO) return MICRO_PHASE_MID_STRETCH;
  return 1;
}

/* 这一场专注已经跑了多少秒（三种模式的「已用」口径不一样，别混） */
function _microFocusElapsedSec() {
  const rem = timerState.remaining || 0;
  const total = timerState.totalDuration || 0;
  if (timerState.mode === 'focus') return Math.max(0, total - rem);
  const strat = strategyOfFreeType(timerState.freeType);
  if (strat.elapsedIsRemaining) return Math.max(0, rem); /* 正计时：remaining 就是已跑秒数 */
  return Math.max(0, total - rem);
}

function _microDrawIntervalMin() {
  const s = appData.settings;
  /* 下限直接取「随机下限」与「最小间隔兜底」的较大者。
     原先先抽再夹：抽到 0.8 分钟被夹成 2 分钟，一堆结果堆在 2.0 这个点上，
     分布多出一个尖峰。现在把夹钳放进区间本身，抽出来就是干净的。 */
  const lo = Math.max(1, s.microMin || 1, s.microMinGap || 1);
  const hi = Math.max(lo, s.microMax || lo);
  let v = lo + Math.random() * (hi - lo);
  /* 抗连短：上一次偏短，这一次强制从上半段取。
     均匀随机里「短-短」连击只能靠运气避开，而连击正是让人觉得被盯着的原因。 */
  const mid = (lo + hi) / 2;
  const last = timerState.microLastInterval || 0;
  if (last && last < mid && v < mid) v = mid + Math.random() * (hi - mid);
  /* 跳过自适应 */
  const streak = timerState.microSkipStreak || 0;
  if (streak >= MICRO_SKIP_STREAK_FROM) {
    v *= Math.min(MICRO_SKIP_MAX, 1 + MICRO_SKIP_STEP * (streak - 1));
  }
  /* 分段节奏：长场次的中段拉长间隔（乘在抽出来的值上，不乘入场保护那个数） */
  v *= _microPhaseStretch();
  return v;
}

function scheduleNextMicroBreak() {
  /* 自由专注（正计时/流式）也要有微休息。
     原先两处守卫都写死 mode !== 'focus'，把自由专注整条路排除了（键在调度与检查两处）。
     现在只认「在专注里」：番茄 focus 与自由专注 free 一视同仁；休息/待机不排。 */
  if (!appData.settings.microBreak) return;
  if (timerState.mode !== 'focus' && timerState.mode !== 'free') return;
  let intervalMin;
  if (appData.settings.microMode === 'fixed') {
    intervalMin = appData.settings.microInterval;
  } else {
    intervalMin = _microDrawIntervalMin();
  }
  if (!(intervalMin > 0)) intervalMin = 1;
  /* 入场保护：只把「第一次」推后，过了这个窗口 into 变成 0，对后续毫无影响 ——
     所以不需要额外的「是否已入场」标记，天然幂等（重排、恢复、跳过都不会重复生效）。 */
  const warmMin = MICRO_WARM_IN_MIN;
  if (warmMin > 0) {
    const countsDown =
      timerState.mode === 'focus' || strategyOfFreeType(timerState.freeType).countsDown;
    /* 短场次要收着点：预热窗口别把整场吃完（10 分钟的流式专注不能被吃掉 5 分钟）。
       25 分钟番茄：6 分钟（占 24%），之后剩 19 分钟 5 次左右，不闷也不吵；
       45 / 90 分钟场次同样是 6 分钟封顶 —— 再长没有额外收益，
       进入状态这件事不因为场次变长而需要更久。 */
    let warm = warmMin;
    if (countsDown) {
      const budgetMin = Math.max(0, (timerState.remaining || 0) / 60);
      if (budgetMin > 0) warm = Math.min(warm, budgetMin * 0.35);
    }
    const into = warm * 60 - _microFocusElapsedSec();
    if (into > intervalMin * 60) intervalMin = into / 60;
  }
  const intervalMs = intervalMin * 60 * 1000;
  /* 「剩余不够就别排」只对倒计时类有意义（番茄 / 流式）。
     正计时的 remaining 是「已跑秒数」（向上累计），拿它比会一启动就归零 → 永远不排。
     ★ 比的是「间隔 + 一次微休息」，不是只有间隔：提示不是孤立事件，它必然带一段
       闭眼休息。只判间隔的话，剩余 5 分钟、抽到 4.9 分钟时会排进去，结果休息还没
       数完专注就先结束了 —— 那一下既打断人又没有任何意义。 */
  const hasBudget =
    timerState.mode === 'focus' || strategyOfFreeType(timerState.freeType).countsDown;
  if (hasBudget) {
    const needMs = intervalMs + Math.max(0, appData.settings.microDuration || 0) * 1000;
    if (needMs > timerState.remaining * 1000) {
      timerState.microNextAt = 0;
      return;
    }
  }
  timerState.microLastInterval = intervalMin;
  timerState.microNextAt = Date.now() + intervalMs;
}
/* 测试钩子：排程相关的内部状态外面只有只读快照（window.timerState），
   写不进去 —— 想验证「中段拉长」这类分段行为，必须能改内部状态并直接看抽样结果。
   只给 smoke / 手工核对用，不进业务路径，删掉不影响运行。 */
try {
  window.__microHooks = {
    draw: function (n) {
      var out = [];
      for (var i = 0; i < (n || 30); i++) out.push(_microDrawIntervalMin());
      return out.sort(function (a, b) { return a - b; });
    },
    phase: function () { return _microPhaseStretch(); },
    /* 直接改内部 timerState（window.timerState 是只读快照，改它没用） */
    patch: function (p) { if (p) Object.assign(timerState, p); return window.__microHooks.state(); },
    /* 「到点该不该响」这件事只有 checkMicroBreak 自己知道（迟到上限就判在里面），
       外面拿不到，所以要能直接催一次。仅测试用。 */
    check: function () { checkMicroBreak(); return window.__microHooks.nextAt(); },
    /* 重新排一次（相当于「刚开一场」或「迟到后重排」走的同一条路） */
    arm: function () { scheduleNextMicroBreak(); return window.__microHooks.nextAt(); },
    nextAt: function () { return timerState.microNextAt; },
    streak: function () { return timerState.microSkipStreak || 0; },
    state: function () {
      return {
        mode: timerState.mode, total: timerState.totalDuration, remaining: timerState.remaining,
        freeType: timerState.freeType, phase: _microPhaseStretch(),
        elapsedMin: +(_microFocusElapsedSec() / 60).toFixed(2)
      };
    }
  };
} catch (e) { if (window.__silent) window.__silent(e, '01c:__microHooks'); }

/* ============================================================
   专注中常驻通知
   ------------------------------------------------------------
   安卓上最有用的一个「通知」其实不是提醒，是**不用解锁就能看一眼还剩多久**。
   番茄钟最常出现的动作就是「拿起手机看时间」，每次都要解锁→切回浏览器→
   看清楚→再锁屏，这中间极容易顺手滑进别的 App。挂一条通知栏里的倒计时，
   这个动作就变成"看一眼锁屏"。
   ★ 用同一个 tag 反复改写同一条（不是每次新建），否则通知栏会被刷出几十条。
   ★ 更新频率 5 秒一次：1 秒一次对通知栏太吵且耗电，5 秒对"看一眼"这个用途
     已经足够（分钟数不会错）。
   ★ 休息、结束、暂停时立刻撤掉 —— 一条停在 00:00 的常驻通知比没有更糟。
   ============================================================ */
var _liveNotifyKey = '';
var _liveNotifyAt = 0;
var _liveNotifyShown = false;
/* ★ 为什么不是「每秒刷新」：
   Web 通知本身支持同 tag 原地替换（不会刷屏、不震动），所以"能不能每秒更新"技术上是可以的。
   真正的限制在浏览器：页面切到后台超过 5 分钟，Chrome 会把 setInterval 压到 1 次/分钟。
   而这条通知最有用的场景恰恰是「锁屏抬头看一眼」——那时候秒数根本跑不动。
   一个冻结在「还剩 5:32」、实际只剩 1 分钟的数字，比没有倒计时更糟，因为它骗人。
   所以按需要的精度分档：
     · 还剩 > 1 分钟 → 只写到分钟（「还剩 12 分钟」），分钟数变了才更新，
       正好落在后台节流的粒度上，锁屏看也是准的；锁屏上精确到秒本来也没意义。
     · 最后 60 秒 → 切秒（「还剩 0:45」），每秒更新，这时候人一般已回前台准备。
   实现上不做「固定间隔节流」，而是「文案变了才发」——同一分钟内 tick 一百次也只发一次。 */
function _liveNotifyLabel(sec, isCountUp) {
  sec = Math.max(0, Math.floor(sec || 0));
  if (isCountUp) {
    var em = Math.floor(sec / 60);
    return '专注中 · 已过 ' + (em < 1 ? sec + ' 秒' : em + ' 分钟');
  }
  /* ★ 边界用 >= 60 而不是 > 60：用 > 的话第 60 秒正好掉进秒级分支，
     拼出「还剩 0:60」这种不存在的写法。60 秒归分钟档 = 「还剩 1 分钟」。 */
  if (sec >= 60) return '专注中 · 还剩 ' + Math.ceil(sec / 60) + ' 分钟';
  return '专注中 · 还剩 0:' + (sec < 10 ? '0' : '') + sec;
}
function _maybeLiveNotify() {
  if (!appData.settings.notify) return;
  if (appData.settings.notifyLive === false) return;
  if (!timerState.running || timerState.microActive) return;
  if (timerState.mode !== 'focus' && timerState.mode !== 'free') return;
  /* 正计时没有终点，通知栏写「已过 12 分钟」而不是倒计时 —— 倒着写的 00:00 会误导 */
  var isCountUp = timerState.mode === 'free' && !strategyOfFreeType(timerState.freeType).countsDown;
  var sec = timerState.remaining || 0;
  var title = _liveNotifyLabel(sec, isCountUp);
  /* 文案没变就一个字都不发：这是「每分钟一次」和「每秒一次」两个档位的唯一开关 */
  if (title === _liveNotifyKey) return;
  _liveNotifyKey = title;
  _liveNotifyAt = Date.now();
  _liveNotifyShown = true;
  var label = timerState.taskName ? String(timerState.taskName) : '';
  if (label.length > 24) label = label.slice(0, 24) + '…';
  notify(title, label || '瓶子专注', { kind: 'live', quiet: true });
}
function _clearLiveNotify() {
  if (!_liveNotifyShown) return;
  _liveNotifyShown = false;
  _liveNotifyKey = '';
  notifyCancel('live');
}
/* 收掉的时机统一在 stopTimerLoop 里（暂停/结束/切休息都会走到），
   不在每个赋值点各插一次 —— 那种写法本项目已经栽过三次，必漏。 */
window.__liveNotifyHooks = { tick: _maybeLiveNotify, clear: _clearLiveNotify, state: function () {
  return { shown: _liveNotifyShown, key: _liveNotifyKey, at: _liveNotifyAt };
} };

function checkMicroBreak() {
  if (!appData.settings.microBreak) return;
  if (timerState.mode !== 'focus' && timerState.mode !== 'free') return;
  if (!timerState.microNextAt) return;
  const now = Date.now();
  if (now < timerState.microNextAt) return;
  /* 见 MICRO_OVERDUE_SEC 的说明：迟太多就不补这一次，重排即可。
     ★ 重排走 scheduleNextMicroBreak 而不是「microNextAt = now + 一个间隔」：
       重排会重新走一遍入场保护 / 抗连短 / 跳过自适应 / 分段节奏，直接加间隔会绕过它们。 */
  const lateSec = (now - timerState.microNextAt) / 1000;
  if (lateSec > MICRO_OVERDUE_SEC) {
    timerState.microNextAt = 0;
    /* 迟到的这一次不计入 microSkipStreak：它不是用户主动跳过，是浏览器把页面挂起了，
       算进去会让「跳过自适应」误以为用户不想要提醒，反而把间隔越拉越长。 */
    scheduleNextMicroBreak();
    return;
  }
  triggerMicroBreak();
}
function triggerMicroBreak() {
  timerState.microActive = true;
  timerState.microStartedAt = Date.now();
  timerState.microNextAt = 0;
  UIFX.playSound('microStart');
  /* 微休息**只在你实际看不到弹窗时**才发系统通知。
     ★ 2026-10-25：原来无条件发，等于是同一件事说两遍 —— 页面里已经弹窗了，
       再推一条通知栏消息纯属重复打扰；而微休息每 3~5 分钟一次，通知栏会被刷得很难受。
       但也确实有非发不可的情况：页面切到后台 / 手机锁屏时，弹窗用户根本看不见，
       那时候一条通知才是唯一能让 ta 知道的通道。
       所以判据是「页面是否可见」：看得见 → 靠弹窗，不发通知；看不见 → 才发。 */
  try {
    var _vis = (typeof document !== 'undefined' && document.visibilityState === 'visible');
    if (!_vis) notify('微休息', '闭眼，感受呼吸', { kind: 'micro' });
  } catch (e) { if (window.__silent) window.__silent(e, '01c:microNotify'); }
  document.getElementById('microBreakTimer').textContent = appData.settings.microDuration;
  UIFX.showModal('microBreakModal');
  /* 微休息只提示「闭眼观察呼吸」。
     曾有一段 4-2-6 节律的跟随文案，还逐秒刷新（"吸气…数到 4（1/4）"）——
     可闭着眼根本看不见，反倒逼人盯着屏幕跟着数，与「闭眼」自相矛盾，已删。
     现在屏幕上只剩一句话 + 倒计时，数完自动关闭。 */
  let remaining = appData.settings.microDuration;
  /* 受控轮询 · 微休息倒计时（有 clear 生命周期，不挂 __ivGov） */
  timerState.microIv = setInterval(() => {
    remaining--;
    document.getElementById('microBreakTimer').textContent = remaining;
    if (remaining <= 0) {
      clearInterval(timerState.microIv);
      finishMicroBreak();
    }
  }, 1000);
}
/* ★ 微休息不该算进专注时长：正计时/停表的累计口径是墙钟（结束 - startTime），而 tick
   在 microActive 期间直接 return（不清零也不扣），闭眼那几十秒会被全额记成「实际专注」，
   结算窗口、bumpFreeStats 的 minutes、日志记录一起虚高。结束时把起点整体推后这么多。
   倒计时类（番茄 / 流式）口径是 endAt，不是墙钟，不受影响，不动。 */
function _microShiftFocusStart() {
  const t0 = timerState.microStartedAt || 0;
  timerState.microStartedAt = 0;
  if (!t0) return;
  const gap = Date.now() - t0;
  if (gap <= 0) return;
  if (
    timerState.mode === 'free' &&
    strategyOfFreeType(timerState.freeType).elapsedIsRemaining &&
    timerState.startTime
  ) {
    timerState.startTime += gap;
  }
}
function finishMicroBreak(skipped) {
  UIFX.playSound('microEnd');
  UIFX.closeModal('microBreakModal');
  _microShiftFocusStart();
  timerState.microActive = false;
  timerState.lastTickTime = Date.now();
  /* 完整休息完了 → 清零「连续跳过」计数。跳过代表相反的意思（用户现在不需要被打断），
     所以由调用方传 skipped=true，这里不动它。 */
  if (!skipped) timerState.microSkipStreak = 0;
  scheduleNextMicroBreak();
}
function skipMicroBreak() {
  if (timerState.microIv) {
    clearInterval(timerState.microIv);
    timerState.microIv = null;
  }
  timerState.microSkipStreak = (timerState.microSkipStreak || 0) + 1;
  finishMicroBreak(true);
}
let _soundMuteUntil = 0; /* 恢复计时后的静音窗口：避免刷新/打开页面后突然响 */
/* 番茄完成掉落动画：从屏幕顶部掉落多个番茄emoji */

function showTomatoDropAnimation() {
  const layer = document.getElementById('tomatoDropLayer');
  if (!layer) return;
  const emojis = ['🍅', '🍅', '🍅', '🍅', '🌿', '✨'];
  for (let i = 0; i < 8; i++) {
    const el = document.createElement('div');
    el.className = 'tomato-drop';
    el.textContent = emojis[i % emojis.length];
    el.style.left = Math.random() * 90 + 5 + '%';
    el.style.animationDelay = Math.random() * 0.3 + 's';
    el.style.fontSize = 24 + Math.random() * 16 + 'px';
    layer.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 1800);
  }
  /* 计时器圆圈脉冲 */
  const circle = document.getElementById('timerCircle');
  if (circle) {
    circle.classList.add('timer-celebrate');
    setTimeout(() => circle.classList.remove('timer-celebrate'), 700);
  }
}
function notify(title, body, opts) {
  if (!appData.settings.notify) return;
  opts = opts || {};
  /* Notification API 缺失时也别直接退出：Service Worker 的 showNotification 仍可用 */
  var hasApi = ('Notification' in window) && typeof Notification !== 'undefined';
  if (hasApi && Notification.permission !== 'granted') return;
  /* ★ 2026-10-23：安卓 Chrome 上 `new Notification()` 永远抛
     "Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."
     —— 也就是说安卓上系统通知从来没弹出过，只是被 catch 吞了。
     有 ServiceWorker 就先走 showNotification（安卓/桌面都支持），不行再退回构造器。 */
  /* ★ tag 必须按类型分开：原来全部写死 tag:'bottle-pomodoro'，浏览器按 tag 去重，
     后到的通知会把前一条直接顶掉。番茄结束和任务提醒撞在一起时用户只看到一条，
     另一条等于没发。现在每个 kind 一个 tag —— 同一类才互相替换（微休息连响两次
     应该合并成一条），不同类型是两件事，应该并存。 */
  var kind = opts.kind || 'misc';
  var tag = opts.tag || 'pomo-' + kind;
  var payload = {
    body: body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: tag,
    renotify: true,
    data: { kind: kind, ts: Date.now() }
  };
  /* requireInteraction：桌面 Chrome 上让通知停住不自动消失。
     安卓上这个字段被忽略（由系统自己管），所以只对桌面有意义，不会影响手机。 */
  if (opts.sticky) payload.requireInteraction = true;
  /* quiet：更新用（同 tag 反复改写的那条，比如「专注还剩 12:34」）——
     不能每次都响一遍，否则通知栏每 5 秒震一下，比不定时提醒还烦。
     renotify:false 让系统按「同一通知内容变化」处理，不重新提醒。 */
  if (opts.quiet) {
    payload.renotify = false;
    payload.silent = true;
  }
  var sw = navigator.serviceWorker;
  if (sw && sw.ready && typeof sw.ready.then === 'function') {
    sw.ready
      .then(function (reg) {
        if (reg && typeof reg.showNotification === 'function') {
          return reg.showNotification(title, payload);
        }
        throw new Error('no showNotification');
      })
      .catch(function () {
        try { new Notification(title, { body: body, tag: tag }); } catch (e) { if (window.__silent) window.__silent(e, '01c:notify'); }
      });
    return;
  }
  try {
    new Notification(title, { body: body });
  } catch (e) { if (window.__silent) window.__silent(e, '01c:notify'); }
}

/* 收掉某一类通知（「专注中」那条常驻的用完必须撤，否则会一直挂在通知栏里）。
   Web 没有撤回接口，只能按 tag 查出来手动 close。 */
function notifyCancel(kind) {
  if (!navigator.serviceWorker || !navigator.serviceWorker.ready) return;
  navigator.serviceWorker.ready
    .then(function (reg) {
      if (!reg || typeof reg.getNotifications !== 'function') return null;
      return reg.getNotifications({ tag: 'pomo-' + kind });
    })
    .then(function (list) {
      if (!list) return;
      list.forEach(function (n) {
        try { n.close(); } catch (e) { if (window.__silent) window.__silent(e, '01c:notifyCancel'); }
      });
    })
    .catch(function () { /* 不支持就作罢，不影响主流程 */ });
}


/* __replace_startPomodoro__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_startPomodoro(fn) { startPomodoro = fn; }


/* __replace_startPomodoroCore__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_startPomodoroCore(fn) { startPomodoroCore = fn; }


/* __replace_onTimerComplete__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_onTimerComplete(fn) { onTimerComplete = fn; }


/* __replace_interruptPomodoro__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_interruptPomodoro(fn) { interruptPomodoro = fn; }


/* __replace_finishPomodoro__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_finishPomodoro(fn) { finishPomodoro = fn; }


/* __replace_resetToIdle__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_resetToIdle(fn) { resetToIdle = fn; }


/* __replace_startBreak__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_startBreak(fn) { startBreak = fn; }


/* __replace_updateTimerDisplay__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_updateTimerDisplay(fn) { updateTimerDisplay = fn; }
