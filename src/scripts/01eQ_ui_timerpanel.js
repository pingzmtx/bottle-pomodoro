/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01e_engine_ui.js 按域拆出（2026-11-14 · S3，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；JS 包只在新增文件边界多 1 个空语句（tools/group_split.py 的拼接符 "\n;\n"，长度不变）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01eQ_ui_timerpanel.js
 * 分组：ui
 * 职责：结算弹窗里的「这次做完的子计划」
 * 功能：
 *   - 结算弹窗里的「这次做完的子计划」
 * 函数索引（TOC）：updateTodayStats/timerLinkedTodo/renderTimerSubs/renderFinishSubs/toggleFinishSub/selectTimerSub/toggleTimerSub/escapeHtml/applyTodayTier/mustDoUI/toggleMustDoSection/toggleMustDoBlock（+8 更多）
 * ============================================================ */

function updateTodayStats() {
  renderTimerRankStrip();
  renderRerollUI();
  renderStarPath();
  const today = getTodayStr();
  const todayRecords = appData.records.filter(r => {
    if (isLogRecord(r)) return false; /* 仅记录：不进今日专注统计（分钟/打断） */
    const d = new Date(r.startTime);
    return getDateStr(d) === today;
  });
  const full = todayRecords.filter(r => r.type === 'full').length;
  const half = todayRecords.filter(r => r.type === 'half').length;
  const interruptCount = todayRecords.reduce((s, r) => s + (r.interruptions ? r.interruptions.length : 0), 0);
  const todayMinutes = Math.floor(todayRecords.reduce((s, r) => s + (r.effectiveSeconds || 0), 0) / 60);
  fxVal(document.getElementById('todayFull'), full);          /* E4-04 今日完整🍅 */
  fxVal(document.getElementById('todayHalf'), half);          /* E4-04 今日半个🍅 */
  document.getElementById('todayInterrupt').textContent = interruptCount;
  let sf = document.getElementById('statFocus');
  if (sf) sf.textContent = todayMinutes;
  let st = document.getElementById('statsTotal');
  if (st) {
    let _tp = todayRecords.reduce(function (a, r) {
      return a + getPomos(r);
    }, 0);
    fxVal(st, _tp.toFixed(1).replace(/\.0$/, ''));           /* E4-04 今日折算大数字 */
    applyTodayTier(_tp);
  }
  let si = document.getElementById('statInterrupt');
  if (si) si.textContent = interruptCount;
  const tp = document.getElementById('todayProgress');
  if (tp) {
    const total = full + half * 0.5;
    const display = Number.isInteger(total) ? total : total.toFixed(1);
    fxVal(tp, display, '今日 ', ' 🍅');                        /* E4-04 计时页今日胶囊 */
  }
  renderEncourage();
  renderTimerBadge();
}
/* ===== 计划 / 待办 的增删改查与列表渲染已迁至 01eC_ui_todo.js（回退见该文件头注释）===== */
/* 计时界面子任务卡：开始番茄时同步展示主计划下的子任务，可勾选（与计划页数据一致） */
/* 子任务勾选框（计划列表与计时页共用）：走 CSS 类，深色模式自动提亮 */
const SUB_CB_SVG =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect class="cb-shape" x="2.5" y="2.5" width="19" height="19" rx="6"/><polyline class="cb-check" points="6,12 10.5,16.5 18,8"/></svg>';
/* 计时页「当前这条计划」的唯一口径：
   计时进行中认 timerState.linkedTodoId（这是专注记录归属的权威，不能被覆盖）；
   还没开始、但下拉里已经选了计划时，退回 timerState._selId ——
   否则「选完计划」与「看到它的子任务」之间隔着一个「开始」，
   而实际要走的流程是「选计划 → 挑这次做哪一步 → 开始」。
   与 01g_engine_init 里高亮逻辑的 `linkedTodoId || _selId` 同一口径，避免两处各说各话。 */
function timerLinkedTodo() {
  const id = timerState.linkedTodoId != null ? timerState.linkedTodoId : timerState._selId;
  if (id == null || id === '') return null;
  if (!/^\d+$/.test(String(id))) return null; /* mustdo_/habit_ 之类不是 todo */
  return (
    appData.todos.find(function (x) {
      return idEq(x.id, id);
    }) || null
  );
}
function renderTimerSubs() {
  const box = document.getElementById('timerSubsBox');
  if (!box) return;
  const lt = timerLinkedTodo();
  const subs = lt ? lt.subs || [] : [];
  if (!subs.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  /* 正在做哪条子任务：只为让专注记录留下「子计划」痕迹，不影响完成勾选 */
  const curSub = findSubById(subs, timerState.curSubId);
  box.innerHTML =
    '<div style="font-size:var(--fs-note);font-weight:800;margin-bottom:var(--sp-6);color:var(--text-light);">📝 子任务 · 边做边勾' +
    (curSub ? ' · 正在做「' + escapeHtml(curSub.title) + '」' : ' · 点标题选中「正在做」') +
    '</div>' +
    subs
      .map(function (s, si) {
        const isCur = !!(curSub && idEq(curSub.id, s.id));
        return (
          '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-8) var(--sp-10);background:' +
          (s.done ? 'linear-gradient(135deg,rgba(46,125,50,.16),rgba(46,125,50,.06))' : 'var(--card)') +
          ';border:1.5px solid ' +
          (isCur ? 'var(--primary)' : s.done ? 'var(--green)' : 'var(--border)') +
          ';border-radius:var(--radius-md);margin-bottom:var(--sp-6);box-shadow:' +
          (s.done ? '0 1px 8px rgba(46,125,50,.12)' : 'none') +
          ';transition:background .2s,border-color .2s;">' +
          '<div class="sub-cb ' +
          (s.done ? 'checked' : '') +
          '" onclick="toggleTimerSub(' +
          si +
          ')" title="' +
          (s.done ? '点击取消完成' : '点击标记完成') +
          '">' +
          SUB_CB_SVG +
          '</div>' +
          '<span style="font-size:var(--fs-body);line-height:1.4;flex:1;' +
          (s.done
            ? 'text-decoration:line-through;text-decoration-color:var(--green);opacity:.8;color:var(--text-light);'
            : '') +
          '" title="点一下 = 这次番茄在做这条" onclick="selectTimerSub(' +
          si +
          ')">' +
          (isCur ? '▶ ' : '') +
          escapeHtml(s.title) +
          '</span>' +
          /* 子任务的预计番茄不再显示（10-17 收尾：计划行/编辑面板/新建弹窗/记录卡四处 10-15 已去掉，
             这里是最后一个还会露出 🍅N 的地方 —— 全站口径必须一致：子任务番茄不显示、不计入）。 */
          '</div>'
        );
      })
      .join('');
}
/* ===== 结算弹窗里的「这次做完的子计划」=====
   用户原话：「一个番茄完了，我来不及在计时那边边做边勾，番茄一进休息我就勾不了了；
   就算勾了，日志里那条记录还是写着一步都没完成」。
   两个原因各修一处：
     ① 结算那一下没地方勾 → 这里补一张清单；
     ② 记录里的 planSubs 快照按「结束时刻」截断（见 snapshotPlanSubs 的 cutoffMs），
        番茄结束后才勾的 doneAt 会晚于 cutoff，被判定成"没完成" →
        结算弹窗里勾的，一律记 timerState.settleSubsEdited，落库时不做截断。 */
function renderFinishSubs() {
  const wrap = document.getElementById('finishSubsWrap');
  const box = document.getElementById('finishSubsBox');
  if (!wrap || !box) return;
  const lt = timerLinkedTodo();
  const subs = lt ? todoValidSubs(lt) : [];
  if (!subs.length) {
    wrap.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  wrap.style.display = '';
  const p = todoSubProgress(lt);
  box.innerHTML =
    '<div class="finish-subs-head">' + escapeHtml(lt.title || '') +
    ' · 已完成 ' + p.done + '/' + p.total + ' 步</div>' +
    subs.map(function (s, si) {
      return (
        '<div class="finish-sub-row' + (s.done ? ' done' : '') + '" onclick="toggleFinishSub(' + si + ')">' +
        '<div class="sub-cb' + (s.done ? ' checked' : '') + '">' + SUB_CB_SVG + '</div>' +
        '<span class="finish-sub-txt">' + escapeHtml(s.title || '') + '</span>' +
        '</div>'
      );
    }).join('');
}
/* 结算弹窗补勾：只改子任务本身，不替用户把整条计划打勾（那是计划页的事）。 */
function toggleFinishSub(si) {
  const lt = timerLinkedTodo();
  if (!lt) return;
  const subs = todoValidSubs(lt);
  const s = subs[si];
  if (!s) return;
  s.done = !s.done;
  if (s.done) s.doneAt = Date.now();
  else delete s.doneAt;
  /* ★ 在结算窗里动过子计划 = 用户明确表示「这次做到了这些」，
     落库时 planSubs 不做时间截断，否则刚勾的这一步会被当成"番茄结束后才勾的"排除掉。 */
  if (typeof timerState !== 'undefined') timerState.settleSubsEdited = true;
  saveData();
  renderFinishSubs();
  try { renderTimerSubs(); } catch (e) { if (window.__silent) window.__silent(e, '01e:toggleFinishSub'); }
  /* 日志页「今天完成」也要跟着留痕（只勾子计划没打勾整条计划的情况） */
  try {
    if (typeof _syncTodoPartialLog === 'function') _syncTodoPartialLog(lt);
    if (typeof renderTodos === 'function') renderTodos();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:toggleFinishSub:log'); }
}
/* 点标题 = 把它设为正在做的子任务（再点一下取消）。
   与「打勾完成」分开：后者写 todos，前者只是本轮番茄的标签。 */
function selectTimerSub(si) {
  const lt = timerLinkedTodo();
  const s = lt ? (lt.subs || [])[si] : null;
  if (!s) return;
  timerState.curSubId = idEq(timerState.curSubId, s.id) ? null : s.id;
  renderTimerSubs();
}
function toggleTimerSub(si) {
  const lt = timerLinkedTodo();
  if (!lt || !(lt.subs || [])[si]) return;
  lt.subs[si].done = !lt.subs[si].done;
  /* 同计划卡：记下勾掉的时刻，供专注记录按时间做快照 */
  if (lt.subs[si].done) lt.subs[si].doneAt = Date.now();
  else delete lt.subs[si].doneAt;
  /* 与计划卡同一口径：只勾子计划也要进日志「今天完成」 */
  try { if (typeof _syncTodoPartialLog === 'function') _syncTodoPartialLog(lt); } catch (e) { if (window.__silent) window.__silent(e, '01e:toggleTimerSub:log'); }
  saveData();
  renderTimerSubs();
  renderTodos();
}
let _todoSig = '';
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  /* 补双引号转义：textNode→innerHTML 只转义 & < >，本函数返回值会被拼进
     value="${...}" 等双引号属性上下文（habitDetailName/detailTaskName），不转 " 即属性注入。
     textarea 为 RCDATA 上下文，&quot; 会被实体解码回 " 正常显示（已实机验证回读无损），
     故一处补齐对全部调用点安全。 */
  return div.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
/* 今日番茄分级：0-5 正常（红橙）｜6-9 努力（绿）｜10+ 十分努力（金+发光） */
function applyTodayTier(tc) {
  const _stEl = document.getElementById('statsTotal');
  if (_stEl) {
    if (tc >= 10) {
      _stEl.style.color = 'var(--yellow-dark)';
      _stEl.style.textShadow = '0 0 20px rgba(217,149,48,.5)';
    } else if (tc >= 6) {
      _stEl.style.color = 'var(--green)';
      _stEl.style.textShadow = '';
    } else {
      _stEl.style.color = 'var(--primary)';
      _stEl.style.textShadow = '';
    }
  }
  const _tierEl = document.getElementById('statsTierLabel');
  if (_tierEl) {
    if (tc >= 10) {
      _tierEl.style.display = '';
      _tierEl.innerHTML =
        '⚡ 十分努力 <span style="color:var(--text-light);font-weight:400;">（' + tc + ' 个 🍅）</span>';
      _tierEl.style.color = 'var(--yellow-dark)';
    } else if (tc >= 6) {
      _tierEl.style.display = '';
      _tierEl.innerHTML =
        '🔥 努力中 <span style="color:var(--text-light);font-weight:400;">（' + tc + ' 个 🍅）</span>';
      _tierEl.style.color = 'var(--green)';
    } else {
      _tierEl.style.display = 'none';
    }
  }
}
function mustDoUI() {
  if (!appData.mustDoUI || typeof appData.mustDoUI !== 'object') appData.mustDoUI = {};
  const u = appData.mustDoUI;
  if (!u.collapse || typeof u.collapse !== 'object') u.collapse = {}; /* 区块折叠状态 */
  if (!u.open || typeof u.open !== 'object') u.open = {}; /* 单卡展开状态（v2 改：默认全部折叠，只看标题） */
  return u;
}
/* v2 改：点「必做 3 件事」标题行 → 整块折叠（折叠后只剩标题行，不留摘要） */
function toggleMustDoSection() {
  const u = mustDoUI();
  u.collapse['section'] = !u.collapse['section'];
  saveData();
  renderMustDoSection();
}
function toggleMustDoBlock(key) {
  const u = mustDoUI();
  u.collapse[key] = !u.collapse[key];
  saveData();
  renderMustDoSection();
}
function toggleMustDoCard(id) {
  const u = mustDoUI();
  u.open[id] = !(u.open[id] === true);
  saveData();
  renderMustDoSection();
} /* 单张任务卡：标准视图（不再有放大切换） */
function mustDoCardHtml(it, locked) {
  const ui = mustDoUI();
  const done = !!it.done;
  const est = mustDoEst(it);
  const open = ui.open[it.id] !== false; /* 默认展开详情；点过 ▾ 后记住折叠（保持卡片可读，少一步点击） */
  let h = '<div class="md-card' + (done ? ' done' : '') + (locked ? ' locked' : '') + (open ? ' open' : '') + '">';
  h += '<div class="md-row">';
  if (locked) {
    h += '<div class="md-box lock">🔒</div>';
  } else {
    h +=
      '<div class="md-box' +
      (done ? ' on' : '') +
      '" onclick="toggleMustDo(' +
      it.id +
      ')">' +
      (done ? '✓' : '') +
      '</div>';
  }
  h += '<div class="md-name">' + escapeHtml(it.title) + '</div>';
  h += '<span class="md-est">🍅 ' + est + '</span>';
  h +=
    '<button class="md-fold" onclick="toggleMustDoCard(' +
    it.id +
    ')" title="' +
    (open ? '折叠' : '展开') +
    '">▾</button>';
  h += '</div>';
  h +=
    '<div class="md-body">' +
    '<div>预计 <b>' +
    est +
    ' 个番茄</b> · 约 <b>' +
    Math.round(est * mustDoWorkMin()) +
    ' 分钟</b>（单番茄 ' +
    mustDoWorkMin() +
    ' 分钟）</div>' +
    '<div>' +
    (locked
      ? '🔒 明天 0:00 自动加入「计划」列表顶部并带标记，全部打勾后可领 +' + COIN_MUSTDO_REWARD + '🪙'
      : '✅ 勾选会同步到「计划」列表；三件全完成可领 +' + COIN_MUSTDO_REWARD + '🪙') +
    '</div>' +
    '</div>';
  h += '</div>';
  return h;
}
function renderMustDoSection() {
  const box = document.getElementById('planGoalMustDo');
  if (!box) return;
  const ui = mustDoUI();
  const today = getTodayStr();
  const tomorrow = mustDoTomorrowStr();
  const prevFlag = !!(appData.mustDoFromPrev || {})[today]; /* 昨晚预设 → 今日必做 */
  const listToday = appData.mustDos[today] || [];
  const listTomorrow = appData.mustDos[tomorrow] || [];
  const rewarded = !!appData.mustDoRewarded[today];
  const doneCnt = listToday.filter(function (x) {
    return x.done;
  }).length;
  /* 从「必做 3 件事」这一行直接折叠整块：折叠后只剩标题行，不带任何摘要 */
  const secCol = !!ui.collapse['section'];
  /* 今天、明天都空的时候，这一整块其实没有内容 —— 只有三句说明书。
     原来它照样占 158px 排在最上面，把「今日目标」「本周重点」全推下去，
     打开目标页第一屏看到的是一张空卡。现在退成一行：标题 + 一个「＋」。
     说明（金币规则、明天 0:00 生效）挪进 ＋ 的 title 和弹窗里。 */
  const empty = !listToday.length && !listTomorrow.length;
  if (empty) {
    /* 空态是**一个按钮**，不是「一行标题 + 一个圆形＋」。
       原来那一行右端挂着一个 32px 的圆圈 ＋，左边还有「还没定」三个字：
       一个说明、一个控件，说明自己不会告诉你该干什么，圆圈又小得像角标。
       现在整行就是一整块可点区域，右边直接写要做的动作。 */
    box.innerHTML = '<button class="md-wrap md-wrap--empty md-empty-row"'
      + ' title="全部打勾可领 ' + COIN_MUSTDO_REWARD + ' 金币；明天 0:00 自动出现在计划顶部"'
      + ' onclick="openMustDoModal()">'
      + '<span class="md-title">🎯 必做 3 件事</span>'
      + '<span class="md-empty-cta">去定三件事 ›</span>'
      + '</button>';
    return;
  }
  let h = '<div class="md-wrap">';
  h +=
    '<div class="md-head" onclick="toggleMustDoSection()">' +
    '<div class="md-title">🎯 必做 3 件事</div>' +
    '<span class="md-caret' +
    (secCol ? ' collapsed' : '') +
    '">▾</span>' +
    '</div>';
  h += '<div class="md-content' + (secCol ? ' collapsed' : '') + '">';
  h += '<div class="md-sub">提前立下，全部打勾领 +' + COIN_MUSTDO_REWARD + '🪙</div>';
  /* —— 今日：可勾选 / 领取 / 也可重新编辑 —— */
  if (listToday.length) {
    /* 全部完成但还没领奖时，强制展开今日区块，避免折叠后找不到领取按钮 */
    const pendingClaim = doneCnt === listToday.length && !rewarded;
    const col = !!ui.collapse['today'] && !pendingClaim;
    const allDone = doneCnt === listToday.length;
    h +=
      '<div class="md-block-head" onclick="toggleMustDoBlock(\'today\')">' +
      '<span class="md-caret' +
      (col ? ' collapsed' : '') +
      '">▾</span>' +
      '<span>📌 今日目标</span>' +
      (prevFlag
        ? '<span style="font-size:var(--fs-tiny);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-8);color:var(--text-light);font-weight:700">🌙 昨晚预设</span>'
        : '') +
      '<span class="md-side"><button class="md-tool" onclick="event.stopPropagation();openMustDoModal(\'' +
      today +
      '\')">✏️ 重新编辑</button></span>' +
      '</div>';
    if (!col) {
      h += '<div class="md-list">';
      listToday.forEach(function (it) {
        h += mustDoCardHtml(it, false);
      });
      h += '</div>';
      h +=
        '<div class="md-foot" style="color:' +
        (allDone ? 'var(--green)' : 'var(--primary)') +
        ';">完成 ' +
        doneCnt +
        '/' +
        listToday.length +
        ' 件 · ' +
        (rewarded
          ? '<button class="md-btn" disabled>🏆 已领取 +' + COIN_MUSTDO_REWARD + '🪙</button>'
          : allDone
            ? '<button class="md-btn green" onclick="claimMustDoReward()">🎁 领取 +' + COIN_MUSTDO_REWARD + '🪙</button>'
            : '<button class="md-btn" disabled title="把今天的事全部打勾后才能领取">🎁 +' + COIN_MUSTDO_REWARD + '🪙（还差 ' +
              (listToday.length - doneCnt) +
              ' 件）</button>') +
        '</div>';
    }
  }
  /* —— 明日：卡片直接展示（第二天 0:00 自动进「计划」列表顶部并带特殊标记），底部保留两个操作按钮 —— */
  if (listTomorrow.length) {
    h += '<div class="md-list" style="margin-top:var(--sp-8);">';
    listTomorrow.forEach(function (it) {
      h += mustDoCardHtml(it, true);
    });
    h += '</div>';
    h +=
      '<div class="md-actions">' +
      '<button class="md-btn" disabled title="明天 0:00 自动进计划列表，打完全部才发奖励">🔒 +' + COIN_MUSTDO_REWARD + '🪙（明天自动进入计划列表）</button>' +
      '<button class="md-btn" onclick="openMustDoModal(\'' +
      tomorrow +
      '\')">✏️ 重新输入明日必做</button>' +
      '<button class="md-btn ghost" onclick="clearMustDos(\'' +
      tomorrow +
      '\')">🗑 清空</button>' +
      '</div>';
  } else {
    h +=
      '<div style="margin:var(--sp-10) 0;font-size:var(--fs-caption);color:var(--text-light);line-height:1.6;">明天 0:00 自动出现在「计划」顶部</div>';
    h +=
      '<div class="md-actions"><button class="md-btn" onclick="openMustDoModal()">📝 设置明天的必做 3 件事</button></div>';
  }
  h += '</div>';
  h += '</div>';
  box.innerHTML = h;
}
/* 「计划」页顶部：今日必做以特殊样式列出（由昨日预设自动带入 / 与目标页勾选同源同步） */
function renderPlanMustRows() {
  const box = document.getElementById('planTodoMustRows');
  if (!box) return;
  const today = getTodayStr();
  const list = (appData.mustDos && appData.mustDos[today]) || [];
  if (!list.length) {
    box.innerHTML = '';
    return;
  }
  const prev = !!(appData.mustDoFromPrev || {})[today];
  const done = list.filter(function (x) {
    return x.done;
  }).length;
  const all = done === list.length;
  const rewarded = !!appData.mustDoRewarded[today];
  let h =
    '<div style="border:1.5px solid var(--green);border-radius:var(--radius-card);overflow:hidden">' +
    '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-6) var(--sp-10);background:linear-gradient(135deg,rgba(46,125,50,.14),rgba(46,125,50,.04));font-size:var(--fs-body);font-weight:900;color:var(--text)">🔥 今日必做' +
    (prev
      ? '<span style="font-size:var(--fs-tiny);background:var(--card);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-8);color:var(--text-light);font-weight:700">🌙 昨晚预设</span>'
      : '') +
    '<span style="margin-left:auto;font-size:var(--fs-caption);color:var(--text-light);font-weight:700">' +
    done +
    '/' +
    list.length +
    (rewarded && all ? ' · 🏆 已领' : '') +
    (all && !rewarded ? ' · 🎁 可领' : '') +
    '</span>' +
    '</div>';
  h += '<div style="background:var(--card)">';
  for (let i = 0; i < list.length; i++) {
    const it = list[i],
      doneIt = !!it.done;
    h +=
      '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-8) var(--sp-10);border-top:1px solid var(--border)">' +
      '<div onclick="toggleMustDo(' +
      it.id +
      ')" style="min-width:22px;height:22px;border-radius:50%;border:2px solid var(--green);background:' +
      (doneIt ? 'var(--green)' : 'transparent') +
      ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:var(--fs-note);cursor:pointer;flex:0 0 auto">' +
      (doneIt ? '✓' : '') +
      '</div>' +
      '<span style="flex:1;min-width:0;font-size:var(--fs-body);' +
      (doneIt ? 'text-decoration:line-through;opacity:.65;color:var(--text-light)' : 'color:var(--text)') +
      '">' +
      escapeHtml(it.title || '') +
      '</span>' +
      '<span style="flex:0 0 auto;font-size:var(--fs-tiny);border:1px solid var(--green);color: var(--green-ink);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-8);font-weight:800">必做</span>' +
      '</div>';
  }
  h += '</div></div>';
  box.innerHTML = h;
}
function openMustDoModal(dateStr) {
  __setMustDoEditDate(dateStr || mustDoTomorrowStr());
  const isToday = _mustDoEditDate === getTodayStr();
  const old = appData.mustDos[_mustDoEditDate] || [];
  for (let i = 0; i < 3; i++) {
    const inp = document.getElementById('mustDoInput' + i);
    if (inp) inp.value = (old[i] && old[i].title) || '';
    const sel = document.getElementById('mustDoEst' + i);
    if (sel) {
      if (!sel.options.length) {
        MUSTDO_EST_OPTIONS.forEach(function (v) {
          const o = document.createElement('option');
          o.value = String(v);
          o.textContent = v + '🍅';
          sel.appendChild(o);
        });
      }
      sel.value = String(old[i] ? mustDoEst(old[i]) : 1);
    }
  }
  const t = document.getElementById('mustDoModalTitle');
  if (t) t.textContent = isToday ? '🎯 必做 3 件事 · 今日（可改）' : '🎯 必做 3 件事 · 明日';
  const lab = document.getElementById('mustDoDateLabel');
  if (lab) {
    let _txt = (isToday ? '今天的事（' : '明天的事（') + _mustDoEditDate + '）';
    try {
      const _tg = new Date(_mustDoEditDate + 'T00:00:00');
      const _diff = _tg.getTime() - Date.now();
      if (_diff > 0) {
        const _h = Math.floor(_diff / 3600000);
        const _m = Math.floor((_diff % 3600000) / 60000);
        _txt += ' · 距设定时间还有 ' + _h + ' 小时 ' + _m + ' 分';
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01e:openMustDoModal'); }
    lab.textContent = _txt;
  }
  const tip = document.getElementById('mustDoModalTip');
  if (tip)
    tip.innerHTML =
      (old.length
        ? '已填写 ' + old.length + ' 件，改完保存即覆盖；'
        : '为' + (isToday ? '今天' : '明天') + '立下「非完成不可」的 1~3 件事，') +
      (isToday ? '今天' : '明天') +
      '全部打勾完成 → <b style="color: var(--primary-ink);">+' + COIN_MUSTDO_REWARD + '🪙</b>（奖励只在当天有效，过后作废）';
  showModal('mustDoModal');
}
/* ===== 计划 / 待办 的增删改查与列表渲染已迁至 01eC_ui_todo.js（回退见该文件头注释）===== */
/* 计划页二级导航：计划 / 习惯 / 目标 / 定点休息 */
function switchPlanTab(tab) {
  let tv = document.getElementById('planTodoView');
  let hv = document.getElementById('planHabitView');
  let gv = document.getElementById('planGoalView');
  let bv = document.getElementById('planBreakView');
  let cv = document.getElementById('planCountdownView');
  if (tv) tv.style.display = tab === 'plan' ? 'block' : 'none';
  if (hv) hv.style.display = tab === 'habit' ? 'block' : 'none';
  if (gv) gv.style.display = tab === 'goal' ? 'block' : 'none';
  if (bv) bv.style.display = tab === 'break' ? 'block' : 'none';
  if (cv) cv.style.display = tab === 'countdown' ? 'block' : 'none';
  document.querySelectorAll('#view-plan .log-tab').forEach(function (t) {
    let key = t.getAttribute('data-tab');
    if (!key)
      key =
        t.textContent.indexOf('习惯') >= 0
          ? 'habit'
          : t.textContent.indexOf('目标') >= 0
            ? 'goal'
            : t.textContent.indexOf('休息') >= 0
              ? 'break'
              : t.textContent.indexOf('倒数日') >= 0
                ? 'countdown'
                : 'plan';
    t.classList.toggle('active', key === tab);
  });
  if (tab === 'habit') renderHabits();
  if (tab === 'goal') {
    try {
      window.renderGoalPage && window.renderGoalPage();
    } catch (e) { if (window.__silent) window.__silent(e, '01e-switchPlanTab'); }
    try {
      renderMustDoSection();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:switchPlanTab'); }
  }
  if (tab === 'break') {
    try {
      renderPlanBreakView();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:switchPlanTab'); }
  }
  if (tab === 'countdown') renderCountdowns();
}
/* ⏰ 定点休息面板：由「设置 → 计时设置」移入计划页二级页签（v5.7.6）。
   读写 appData.enhSettings.special（4 个时段）与 sbDone（当日已提醒），与原设置项/到点提醒逻辑完全同源 */
function enhBreakDefaults() {
  if (typeof appData === 'undefined' || !appData) return null;
  if (!appData.enhSettings) appData.enhSettings = {};
  let s = appData.enhSettings;
  let empty = function () {
    return { on: false, t: '', label: '' };
  };
  if (!Array.isArray(s.special) || s.special.length < 4) {
    s.special = [empty(), empty(), empty(), empty()];
  }
  for (let i = 0; i < s.special.length; i++) {
    if (!s.special[i] || typeof s.special[i] !== 'object') s.special[i] = empty();
  }
  if (!s.sbDone || typeof s.sbDone !== 'object') s.sbDone = {};
  if (!Array.isArray(s.reminds)) s.reminds = []; /* 通用定点提醒 {id,on,t,label} */
  if (!s.remindDone || typeof s.remindDone !== 'object') s.remindDone = {}; /* 当日已提醒 {date:{id:1}} */
  return s;
}
/* ⏰ 提醒页签：上半「定点提醒」（自定义时间+事项），下半「定点休息」（原有 4 组休息槽） */
function renderPlanBreakView() {
  let box = document.getElementById('planBreakView');
  if (!box) return;
  let s = enhBreakDefaults();
  if (!s) return;
  /* ===== 卡片1：定点提醒 ===== */
  let html =
    '<div style="padding:var(--sp-16) var(--sp-16);border-radius:var(--radius-lg);background:var(--card);border:1px solid var(--border)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);margin-bottom:var(--sp-2)">' +
    '<div style="font-size:var(--fs-title);font-weight:900;color:var(--text)">⏰ 定点提醒</div>' +
    '<span class="ph-btn" onclick="togglePh(this,\'phRemindDesc\')" style="flex:0 0 auto;font-size:var(--fs-caption);color:var(--text-light);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-10);cursor:pointer">ⓘ 说明 ▾</span>' +
    '</div>' +
    '<div id="phRemindDesc" style="display:none;font-size:var(--fs-note);color:var(--text-light);line-height:1.7;margin:var(--sp-8) 0 var(--sp-2)">⏰ 到点就弹出来提醒你，<b style="color:var(--text)">点「知道了」才算收到</b>；没点就每分钟再提醒一次，当天一直有效；临时不想处理可以点「稍后 10 分钟」，到点它会再来（同时有好几条就一条一条确认）。选「🔁 每天重复」＝每天这个点提醒；选「📅 只提醒一次」＝只在选定的那一天提醒，点掉后自动关闭。正在专注时不打断，只轻提示一次，这轮专注结束接着提醒。</div>';
  let arr = s.reminds || [];
  if (!arr.length) {
    html +=
      '<div style="padding:var(--sp-6) 0 var(--sp-10);color:var(--text-light);font-size:var(--fs-body);line-height:1.6">还没有提醒，在下面加一条吧</div>';
  } else {
    html += '<div class="ios-list">';
    for (let i = 0; i < arr.length; i++) {
      let r = arr[i] || {};
      let rep = r.repeat === 'once' ? 'once' : 'daily';
      let todayMini = getTodayStr();
      html +=
        '<div class="ios-row' + (r.on ? '' : ' ios-row-off') + '">' +
        '<div class="ios-row-main">' +
        '<input type="time" data-rmt="' +
        i +
        '" value="' +
        (r.t || '') +
        '" class="ios-time-input">' +
        '<input type="text" maxlength="30" placeholder="提醒我做什么？" data-rml="' +
        i +
        '" value="' +
        escapeHtml(r.label || '') +
        '" class="ios-label-input">' +
        '<div class="ios-chip-row">' +
        '<select data-rmr="' +
        i +
        '" onchange="remindChangeRep(' +
        r.id +
        ',this.value)" title="重复方式" class="ios-chip">' +
        '<option value="daily"' +
        (rep === 'daily' ? ' selected' : '') +
        '>🔁 每天</option>' +
        '<option value="once"' +
        (rep === 'once' ? ' selected' : '') +
        '>📅 一次</option></select>' +
        (rep === 'once'
          ? '<input type="date" data-rmd="' +
            i +
            '" value="' +
            (r.date || todayMini) +
            '" min="' +
            todayMini +
            '" onchange="remindChangeDate(' +
            r.id +
            ',this.value)" class="ios-chip">'
          : '<span class="ios-chip ios-chip-quiet">像闹钟，每天这个点</span>') +
        '</div>' +
        '</div>' +
        '<div class="ios-row-right">' +
        '<label class="ios-switch"><input type="checkbox" data-rm="' +
        i +
        '"' +
        (r.on ? ' checked' : '') +
        '><span class="ios-switch-slider"></span></label>' +
        '<button type="button" class="ios-row-del" onclick="delRemind(' +
        r.id +
        ')" title="删除这条提醒">✕</button>' +
        '</div>' +
        '</div>';
    }
    html += '</div>';
  }
  html +=
    '<div style="padding:var(--sp-10) var(--sp-12);border:0;border-top:1px solid var(--hairline);border-radius:0;background:transparent;margin-top:var(--sp-10)">' +
    '<div style="display:flex;align-items:center;gap:var(--sp-8);flex-wrap:wrap">' +
    '<input type="time" id="remindNewTime" value="09:00" class="flat-time" style="flex:0 0 104px;padding:0;border:0;background:transparent;color:var(--text)">' +
    '<select id="remindNewRep" onchange="syncNewRemindDate()" class="flat-select" style="padding:0;border:0;background:transparent;color:var(--text);font-size:var(--fs-note)">' +
    '<option value="daily">🔁 每天重复</option>' +
    '<option value="once">📅 只提醒一次</option></select>' +
    '<input type="date" id="remindNewDate" class="flat-time" style="display:none;flex:0 0 auto;padding:0;border:0;background:transparent;color:var(--text);font-size:var(--fs-note)">' +
    '<button class="btn-small" type="button" onclick="addRemind()" style="background:var(--fill-primary);color:var(--on-fill);margin-left:auto">＋ 添加提醒</button>' +
    '</div>' +
    '<input type="text" maxlength="30" id="remindNewLabel" placeholder="提醒我做什么？例如：站起来喝水 / 开会 / 吃药…" class="flat-input" style="width:100%;margin-top:var(--sp-6);padding:0;border:0;background:transparent;color:var(--text);font">' +
    '</div>' +
    '</div>';
  /* ===== 卡片2：定点休息 ===== */
  html +=
    '<div style="padding:var(--sp-16) var(--sp-16);border-radius:var(--radius-lg);background:var(--card);border:1px solid var(--hairline);margin-top:var(--sp-14)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);margin-bottom:var(--sp-2)">' +
    '<div style="font-size:var(--fs-title);font-weight:900;color:var(--text)">🍱 定点休息</div>' +
    '<span class="ph-btn" onclick="togglePh(this,\'phBreakDesc\')" style="flex:0 0 auto;font-size:var(--fs-caption);color:var(--text-light);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-10);cursor:pointer">ⓘ 说明 ▾</span>' +
    '</div>' +
    '<div id="phBreakDesc" style="display:none;font-size:var(--fs-note);color:var(--text-light);line-height:1.7;margin:var(--sp-8) 0 var(--sp-2)">固定时刻提醒休息（如 12:00 午餐、15:30 下午茶）。空闲时直接弹窗；专注中先提示、本轮结束后再弹。每天最多 4 组。</div>';
  for (let i2 = 0; i2 < 4; i2++) {
    let slot = s.special[i2] || { on: false, t: '', label: '' };
    html +=
      '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-8) 0;border-bottom:1px solid var(--hairline)">' +
      '<label style="display:flex;align-items:center;flex:0 0 auto"><input type="checkbox" data-sb="' +
      i2 +
      '"' +
      (slot.on ? ' checked' : '') +
      ' style="accent-color:var(--primary)"></label>' +
      '<input type="time" data-sbt="' +
      i2 +
      '" value="' +
      (slot.t || '') +
      '" class="flat-time" style="flex:0 0 108px;padding:0;border:0;background:transparent;color:var(--text)">' +
      '<input type="text" maxlength="8" placeholder="备注：午餐…" data-sbl="' +
      i2 +
      '" value="' +
      escapeHtml(slot.label || '') +
      '" class="flat-text" style="flex:1;min-width:0;padding:0;border:0;background:transparent;color:var(--text);font-size:var(--fs-body)">' +
      '</div>';
  }
  html +=
    '<div style="display:flex;align-items:center;gap:var(--sp-10);flex-wrap:wrap;margin-top:var(--sp-10)">' +
    '<button class="btn-small" type="button" id="planSbReset" style="font-size:var(--fs-body)">↻ 重置今日「已提醒」记录</button>' +
    '<span style="font-size:var(--fs-caption);color:var(--text-light);line-height:1.6">休息提醒在到点后 5 分钟内触发，当天不重复；定点提醒到点即弹、没点「知道了」就每分钟再催一次。「重置」会清掉今天的「已提醒」记录（休息+提醒）。</span>' +
    '</div></div>';
  box.innerHTML = html;
  /* 绑定：定点提醒列表 */
  let rcbs = box.querySelectorAll('[data-rm]'),
    rtis = box.querySelectorAll('[data-rmt]'),
    rlis = box.querySelectorAll('[data-rml]');
  let arr2 = enhBreakDefaults().reminds || [];
  for (let k = 0; k < arr2.length; k++) {
    (function (idx, id) {
      if (rcbs[idx])
        rcbs[idx].addEventListener('change', function (ev) {
          let s2 = enhBreakDefaults();
          if (s2.reminds[idx]) s2.reminds[idx].on = ev.target.checked;
          remindRearm(id); /* 关掉 → 撤掉待确认；再打开 → 今天重新算 */
          saveData();
        });
      if (rtis[idx])
        rtis[idx].addEventListener('change', function (ev) {
          let s2 = enhBreakDefaults();
          if (s2.reminds[idx]) s2.reminds[idx].t = ev.target.value || '';
          remindRearm(id); /* 改了时间 → 重新武装这一天 */
          saveData();
        });
      if (rlis[idx])
        rlis[idx].addEventListener('input', function (ev) {
          let s2 = enhBreakDefaults();
          if (s2.reminds[idx]) s2.reminds[idx].label = ev.target.value || '';
          saveData();
        });
    })(k, arr2[k].id);
  }
  /* 绑定：定点休息 4 槽 */
  let cbs = box.querySelectorAll('[data-sb]'),
    tis = box.querySelectorAll('[data-sbt]'),
    lbs = box.querySelectorAll('[data-sbl]');
  for (let j = 0; j < 4; j++) {
    (function (idx) {
      if (cbs[idx])
        cbs[idx].addEventListener('change', function (ev) {
          enhBreakDefaults().special[idx].on = ev.target.checked;
          saveData();
        });
      if (tis[idx])
        tis[idx].addEventListener('change', function (ev) {
          enhBreakDefaults().special[idx].t = ev.target.value || '';
          saveData();
        });
      if (lbs[idx])
        lbs[idx].addEventListener('input', function (ev) {
          enhBreakDefaults().special[idx].label = ev.target.value || '';
          saveData();
        });
    })(j);
  }
  let rst = box.querySelector('#planSbReset');
  if (rst)
    rst.addEventListener('click', function () {
      let s3 = enhBreakDefaults();
      s3.sbDone = {};
      s3.remindDone = {};
      saveData();
      try {
        showToast('✅ 今日「已提醒」记录已重置（休息+提醒）');
      } catch (e) { if (window.__silent) window.__silent(e, '01e:renderPlanBreakView'); }
    });
}
/* —— 定点提醒：增删 —— */
/* —— 折叠说明：点「ⓘ 说明」展开/收起（默认收起，不挡视线） —— */
