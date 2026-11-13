/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 定点提醒层：提醒增删与「每天/一次」切换、到点队列与去重、重臂与贪睡、5 秒心跳扫描、与专注的互斥静音
 * 全部为**顶层 function 声明 + 该域私有常量/状态，并含该域末尾那处顶层调用 `startRemindWatcher();`**，跨 script 全局可见；本文件必须排在 01e_engine_ui.js
 * **之后、紧邻**加载（见 src/manifest.json 的槽 1 files）。
 * 依赖方向：本文件 → 01e / 00_pure_core / 01b（前向，安全）。本域**全部私有状态都在本文件内**
 *   （静态核对：01e 剩余部分与其它 39 个文件对它们的引用数均为 0）。
 *   反向不成立：01e **不**依赖本文件的任何东西。
 * 回退方式：把本文件内容按 TOC 顺序粘回 01e_engine_ui.js 原位置，并删掉 manifest 里本文件那一行。 */
/* ==================== 模块: 04eK-ui-remind.js | 职责: 提醒增删与「每天/一次」切换、到点队列与去重、重臂与贪睡、5 秒心跳扫描、与专注的互斥静音 | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04eK-ui-remind.js（源文件 01eK_ui_remind.js）
 * 分组：ui
 * 职责：提醒增删与「每天/一次」切换、到点队列与去重、重臂与贪睡、5 秒心跳扫描、与专注的互斥静音
 * 函数索引（TOC）：syncNewRemindDate/remindChangeRep/remindChangeDate/addRemind/delRemind/remindModalVisible/remindRenderHead/remindFocusRunning/remindFocusHintOnce/remindFocusFlush/remindEnqueue/remindAckCurrent（+7 更多）
 * ============================================================ */

/* —— 定点提醒：添加行「每天/一次」切换日期显隐 —— */
function syncNewRemindDate() {
  let rep = document.getElementById('remindNewRep');
  let d = document.getElementById('remindNewDate');
  if (!rep || !d) return;
  let once = rep.value === 'once';
  d.style.display = once ? '' : 'none';
  if (once && !d.value) d.value = getTodayStr();
}
/* —— 定点提醒：改某条的重复模式 —— */
function remindChangeRep(id, rep) {
  let s = enhBreakDefaults();
  if (!s) return;
  let arr = s.reminds || [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && idEq(arr[i].id, id)) {
      arr[i].repeat = rep === 'once' ? 'once' : 'daily';
      if (arr[i].repeat === 'once' && !arr[i].date)
        arr[i].date = getTodayStr();
      if (arr[i].repeat === 'daily') arr[i].on = true; /* 从「一次」改回「每天」→ 重新打开 */
      remindRearm(id);
      break;
    }
  }
  saveData();
  renderPlanBreakView();
}
/* —— 定点提醒：改一次性提醒的日期（不能早于今天） —— */
function remindChangeDate(id, v) {
  let s = enhBreakDefaults();
  if (!s) return;
  let today = getTodayStr();
  let arr = s.reminds || [];
  let ok = false;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && idEq(arr[i].id, id)) {
      if (v && (!today || v >= today)) {
        arr[i].date = v;
        ok = true;
        remindRearm(id); /* 改了日期 → 重新武装这一天 */
      }
      break;
    }
  }
  saveData();
  if (!ok) {
    try {
      showToast('日期不能早于今天');
    } catch (e) { if (window.__silent) window.__silent(e, '01e:remindChangeDate'); }
    renderPlanBreakView();
    return;
  }
  renderPlanBreakView();
}
function addRemind() {
  let s = enhBreakDefaults();
  if (!s) return;
  let ti = document.getElementById('remindNewTime'),
    li = document.getElementById('remindNewLabel');
  let repEl = document.getElementById('remindNewRep'),
    dateEl = document.getElementById('remindNewDate');
  let t = ti ? ti.value : '',
    l = li ? (li.value || '').trim() : '';
  let rep = repEl && repEl.value === 'once' ? 'once' : 'daily';
  let today = getTodayStr();
  if (!t) {
    try {
      showToast('请先选择提醒时间');
    } catch (e) { if (window.__silent) window.__silent(e, '01e-addRemind'); }
    return;
  }
  if (!l) {
    try {
      showToast('写一句提醒内容吧，例如：站起来喝水');
    } catch (e) { if (window.__silent) window.__silent(e, '01e:addRemind'); }
    return;
  }
  let dateVal = '';
  if (rep === 'once') {
    dateVal = dateEl ? dateEl.value : '';
    if (!dateVal) {
      try {
        showToast('选「只提醒一次」时请同时选一个日期');
      } catch (e) { if (window.__silent) window.__silent(e, '01e:addRemind'); }
      return;
    }
    if (today && dateVal < today) {
      try {
        showToast('一次性提醒的日期不能早于今天');
      } catch (e) { if (window.__silent) window.__silent(e, '01e:addRemind'); }
      return;
    }
  }
  if (!Array.isArray(s.reminds)) s.reminds = [];
  if (s.reminds.length >= 20) {
    try {
      showToast('最多 20 条提醒');
    } catch (e) { if (window.__silent) window.__silent(e, '01e:addRemind'); }
    return;
  }
  s.reminds.push({ id: Date.now(), uid: newUid('remind'), updatedAt: Date.now(), on: true, t: t, label: l, repeat: rep, date: rep === 'once' ? dateVal : '' });
  if (li) li.value = '';
  saveData();
  renderPlanBreakView();
  try {
    showToast(
      rep === 'once'
        ? '📅 已添加：' + dateVal + ' ' + t + ' 提醒「' + l + '」（仅一次）'
        : '⏰ 已添加：每天 ' + t + ' 提醒「' + l + '」'
    );
  } catch (e) { if (window.__silent) window.__silent(e, '01e:addRemind'); }
}
function delRemind(id) {
  let s = enhBreakDefaults();
  if (!s) return;
  if (!Array.isArray(s.reminds)) return;
  s.reminds = s.reminds.filter(function (x) {
    return x && !idEq(x.id, id);
  });
  saveData();
  renderPlanBreakView();
}
/* —— 到点提醒公共件：定点提醒与任务提醒共用同一条「确认队列」 ——
   口径：到点就弹窗；点「知道了」才算确认；没确认 = 每分钟再响一次，当天一直有效。
   专注中不打扰（只轻提示一次、先留在队列里），专注结束由 remindFocusFlush 补弹 ——
   这个判定只写在 remindEnqueue 一处，定点与任务共用（两边各写一份必然漏一个）。
   存档兼容：remindDone[x]=true（旧）与 todo.reminded=true 一律当「已确认」，升级后不会翻旧账。 */
let _remindQueue = [];
let _remindFocusMute = {};
let _remindSnoozeUntil = {};
function remindModalVisible() {
  let el = document.getElementById('remindModal');
  return !!(el && el.classList && el.classList.contains('show'));
}
function remindRenderHead(silent) {
  let it = _remindQueue[0];
  if (!it) {
    try {
      closeModal('remindModal');
    } catch (e) { if (window.__silent) window.__silent(e, '01e:remindRenderHead'); }
    return;
  }
  if (remindFocusRunning() && !remindModalVisible()) return; /* 兜底：专注中绝不弹确认窗 */
  let t = document.getElementById('remindModalTitle'),
    m = document.getElementById('remindModalMsg');
  if (!t || !m) return;
  t.textContent = it.title || '⏰ 提醒到啦';
  m.innerHTML = it.body || '';
  if (!silent) {
    try {
      playSound('tap');
    } catch (e) { if (window.__silent) window.__silent(e, '01e:remindRenderHead'); }
  }
  try {
    showModal('remindModal');
  } catch (e) { if (window.__silent) window.__silent(e, '01e:remindRenderHead'); }
}
/* 正在专注？—— 定点提醒与任务提醒共用的唯一判定，别再各写一份 */
function remindFocusRunning() {
  let st = typeof timerState !== 'undefined' ? timerState : null;
/* ★ 自由专注（正计时/流式，mode:'free'）同样是「正在专注」。
   只认 'focus' 的话，自由专注中照样弹全屏提醒窗。 */
  if (st && st.running && (st.mode === 'focus' || st.mode === 'free')) return true;
  /* ★ 冷启动竞态：快照里躺着一段没跑完的专注，而 restoreTimerSnapshot() 排在 init 的 await 之后，
     5s 心跳可能先跑 —— 那一刻 timerState 还是 idle，会把本该静音的提醒弹出来（用户原投诉的时序版）。
     恢复完成前一律按「专注中」算；__timerSnapshotRestored 由 init 恢复后置位，另有 20s 兜底。 */
  try {
    const snap = appData && appData.timerSnapshot;
    if (snap && !window.__timerSnapshotRestored && !snap.paused && (snap.mode === 'focus' || snap.mode === 'free')) return true;
  } catch (e) { if (window.__silent) window.__silent(e, '01e:remindFocusRunning'); }
  return false;
}
/* 专注中被压住的提醒：只轻提示一次（同一 key 只提示一遍） */
function remindFocusHintOnce(item) {
  let k = String((item && item.key) || '');
  if (!k || _remindFocusMute[k]) return;
  _remindFocusMute[k] = 1;
  let label = (item.label && String(item.label).trim()) || '该做的事';
  try {
    showToast('⏰ ' + label + ' 到啦！这轮专注结束后会再提醒你');
  } catch (e) { if (window.__silent) window.__silent(e, '01e:remindFocusHintOnce'); }
  try {
    playSound('tap');
  } catch (e) { if (window.__silent) window.__silent(e, '01e:remindFocusHintOnce'); }
}
/* 专注结束（或本就没在专注）→ 把静音期间积压的提醒补弹出来；顺手清掉「已轻提示」标记 */
function remindFocusFlush() {
  if (remindFocusRunning()) return;
  /* 已经不在专注了：这一轮专注的「已轻提示」记录作废，下轮专注可以重新提示 */
  _remindFocusMute = {};
  if (!_remindQueue.length) return;
  if (remindModalVisible()) return;
  remindRenderHead(false);
}
/* 入队。同一条重复入队 = 到点了还没确认 → 重催（响一声；弹窗被关掉就重新弹出来）
   专注中一律只轻提示、留在队列里，不弹确认窗（专注结束 remindFocusFlush 补弹）。 */
function remindEnqueue(item) {
  if (!item || !item.key) return;
  for (let i = 0; i < _remindQueue.length; i++) {
    if (_remindQueue[i].key === item.key) {
      if (remindFocusRunning()) { remindFocusHintOnce(item); return; }
      try {
        playSound('tap');
      } catch (e) { if (window.__silent) window.__silent(e, '01e:remindEnqueue'); }
      if (!remindModalVisible()) remindRenderHead(true);
      return;
    }
  }
  _remindQueue.push(item);
  if (remindFocusRunning()) { remindFocusHintOnce(item); return; }
  if (!remindModalVisible()) remindRenderHead(false);
}
/* 「知道了」= 唯一的确认动作；确认完自动接着显示下一条 */
function remindAckCurrent() {
  let it = _remindQueue.shift();
  if (it) delete _remindSnoozeUntil[it.key];
  if (it && typeof it.onAck === 'function') {
    try {
      it.onAck();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:remindAckCurrent'); }
  }
  if (_remindQueue.length) remindRenderHead(false);
  else remindRenderHead(true);
}
/* 确认一条定点提醒：写 remindDone=ok；一次性提醒顺手关掉 */
function remindAckPoint(id) {
  let s = enhBreakDefaults();
  if (!s) return;
  let today = getTodayStr();
  if (s.remindDone && s.remindDone[today]) s.remindDone[today][id] = 'ok';
  let arr = s.reminds || [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && idEq(arr[i].id, id) && arr[i].repeat === 'once') arr[i].on = false;
  }
  try {
    saveData();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:remindAckPoint'); }
  renderPlanBreakView();
}
/* 改了时间 / 重复方式 / 日期 → 重新武装这一天，否则改完还是「今天已响过」 */
function remindRearm(id) {
  let s = enhBreakDefaults();
  if (!s) return;
  let today = getTodayStr();
  if (s.remindDone && s.remindDone[today]) delete s.remindDone[today][id];
  delete _remindFocusMute['point:' + id];
  delete _remindSnoozeUntil['point:' + id];
  for (let i = 0; i < _remindQueue.length; i++) {
    if (_remindQueue[i].key === 'point:' + id) {
      _remindQueue.splice(i, 1);
      break;
    }
  }
}
/* 撤掉待确认项：prefix 相同且 aliveFn(key) 为假的全部移除（任务被勾掉/提醒被清时用） */
/* 「稍后提醒」：先放它一会儿，到点再照常弹出来（默认 10 分钟）。点一次就延一次 */
function remindSnoozeUntil(key) {
  let v = _remindSnoozeUntil[key];
  return typeof v === 'number' ? v : 0;
}
function remindSnoozeCurrent(mins, nowArg) {
  let it = _remindQueue.shift();
  let m = parseInt(mins, 10);
  if (!m || m < 1) m = 10;
  let base = nowArg instanceof Date ? nowArg.getTime() : Date.now();
  if (it) {
    _remindSnoozeUntil[it.key] = base + m * 60000;
    try {
      showToast('🕐 好，' + m + ' 分钟后再提醒你');
    } catch (e) { if (window.__silent) window.__silent(e, '01e:remindSnoozeCurrent'); }
  }
  remindRenderHead(true);
}
function remindPurge(prefix, aliveFn) {
  let n = 0;
  for (let i = _remindQueue.length - 1; i >= 0; i--) {
    let k = String(_remindQueue[i].key || '');
    if (!prefix || k.indexOf(prefix) !== 0) continue;
    if (typeof aliveFn === 'function' && aliveFn(k)) continue;
    _remindQueue.splice(i, 1);
    delete _remindSnoozeUntil[k];
    n++;
  }
  if (n) remindRenderHead(true);
  return n;
}
/* —— 定点提醒：到点扫描（每 5 秒；到点即提醒，未确认每分钟重催，当天一直有效；专注中只轻提示） —— */
let _remindWatchDay = '';
function startRemindWatcher() {
  /* 业务心跳 · 定点提醒扫描 5s（到点窗口触发，保活不错过） */
  setInterval(function () {
    /* 自动化回归要自己造时间（run_smoke C29）：真实时间心跳会和合成时间打架，可暂停 */
    if (window.__remindWatchPaused) return;
    try {
      remindFocusFlush();
      remindCheckTime();
    } catch (e) { if (window.__silent) window.__silent(e, '01e-startRemindWatcher'); }
  }, 5000);
  try {
    remindFocusFlush();
    remindCheckTime();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:startRemindWatcher'); }
}
function remindCheckTime(nowArg) {
  let s = enhBreakDefaults();
  if (!s) return;
  let today = getTodayStr();
  if (!today) return;
  if (_remindWatchDay && _remindWatchDay !== today) {
    s.remindDone = {};
    _remindFocusMute = {};
    /* ★ 隔天要清掉「已经到点/过期」的「稍后」标记：否则昨晨按过稍后又没确认的定点提醒，
       今天会因 snoozeAt 为真而绕过「未到点跳过」，00:00 就把今天的提醒提前弹出来。
       但**不能全清** —— 昨晚 23:57 按下的「稍后 10 分钟」目标落在今天 00:07，
       全清掉就把用户正在等的那次延期静默吃掉（该响的没响）。只留下还没到点的。 */
    for (let _sk in _remindSnoozeUntil) {
      if (!(_remindSnoozeUntil[_sk] > Date.now())) delete _remindSnoozeUntil[_sk];
    }
  }
  _remindWatchDay = today;
  if (!s.remindDone || typeof s.remindDone !== 'object') s.remindDone = {};
  let arr = s.reminds || [];
  if (!arr.length) return;
  let nowD = nowArg instanceof Date ? nowArg : new Date(),
    mn = nowD.getHours() * 60 + nowD.getMinutes(),
    nowMs = nowD.getTime();
  let done = s.remindDone[today];
  if (!done) {
    done = {};
    s.remindDone[today] = done;
  }
  let dirty = false;
  for (let i = 0; i < arr.length; i++) {
    let r = arr[i];
    if (!r || !r.on || !r.t) continue;
    /* 「稍后」提前算：下面的 once 日期闸门和「未到点跳过」都要用它 */
    let snoozeAt = remindSnoozeUntil('point:' + r.id);
    let rep = r.repeat === 'once' ? 'once' : 'daily';
    if (rep === 'once') {
      if (!r.date) {
        r.on = false;
        dirty = true;
        continue;
      } /* 缺日期 → 自动停用 */
      if (r.date !== today) {
/* 例外：昨晚按下、目标落在今天凌晨的「稍后」还没响完 → 放行，响完在下面停用它。
   不看 snoozeAt 就会把这条延期连同提醒一起静默吞掉（变成灰色关闭态）。
   其余「日期已过」的 once 一律自动停用（不再留着）。 */
        if (r.date < today && snoozeAt) {
          /* 仍在「稍后」中：不 continue，走完流程 */
        } else {
          if (r.date < today) {
            r.__del = true;
            dirty = true;
          } /* 过期未提醒 → 第二天直接删除，不再留一行灰的 */
          continue;
        }
      }
    }
    let ps = String(r.t).split(':');
    let tm = (parseInt(ps[0], 10) || 0) * 60 + (parseInt(ps[1], 10) || 0);
    /* 还没到点就跳过；跨过午夜后「今天的这个点」同样还没到，照旧跳过（当天有效口径）。
       唯一例外带「稍后」的：那是用户当场按下的延期，目标时刻可能落到第二天
       （23:57 稍后 10 分钟 → 次日 00:07）。若因跨日整条跳过，这条提醒会被静默吞掉、
       要等第二天那个点才再响，用户按下的「稍后」就白按了 —— 故有未完成的稍后时不跳过。 */
    if (mn < tm && !snoozeAt) continue;
    let rec = done[r.id];
    if (rec === 'ok' || rec === true) continue; /* 已确认（true = 旧存档，当已确认，不翻旧账） */
    if (typeof rec === 'number' && nowMs - rec < 60000) continue; /* 距上次提醒不到 1 分钟，先不催 */
    if (snoozeAt && nowMs < snoozeAt) continue; /* 点过「稍后」→ 到点前别再催 */
    let label = (r.label && String(r.label).trim()) || '该做的事';
    /* once 且日期已过（唯一能走到这里的例外就是跨午夜的「稍后」延期）→ 响过这一回就停用。
       不停用的话 r.date < today 一直为真，配合 snoozeAt 绕过「未到点跳过」，每分钟催一次没完。 */
    if (rep === 'once' && r.date && r.date < today) {
/* 一次提醒的使命只到当天：响完这一回就从列表里删掉，而不是留一条永久灰掉的记录。 */
      r.__del = true;
      dirty = true;
    }
    done[r.id] = nowMs;
    dirty = true;
    let rid = r.id;
    remindEnqueue({
      key: 'point:' + rid,
      label: label,
      title: '⏰ 定点提醒到啦',
      body:
        '<div style="font-size:var(--fs-body);color:var(--text-light)">现在 ' +
        String(r.t) +
        '，该去做了：</div>' +
        '<div style="font-size:var(--fs-sub);font-weight:900;color: var(--primary-ink);margin:var(--sp-8) 0 var(--sp-2)">' +
        escapeHtml(label) +
        '</div>' +
        '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-6)">点「知道了」才算收到，没点就每分钟再提醒一次；想晚点再说就点「稍后 10 分钟」。（' +
        (rep === 'once' ? '这条只提醒这一次' : '这条每天这个点提醒') +
        '）</div>',
      onAck: function () {
        remindAckPoint(rid);
      }
    });
  }
  /* 循环结束后统一摘除标记删除的一次提醒（循环中直接 splice 会打乱下标） */
  if (s.reminds && s.reminds.some(function (x) { return x && x.__del; })) {
    s.reminds = s.reminds.filter(function (x) { return !(x && x.__del); });
    dirty = true;
    try { renderRemindPage(); } catch (e) { if (window.__silent) window.__silent(e, '01e:remindPrune'); }
  }
  if (dirty) {
    try {
      saveData();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:remindCheckTime'); }
  }
}
startRemindWatcher();
