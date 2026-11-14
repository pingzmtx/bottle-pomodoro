/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01e_engine_ui.js 按域拆出（2026-11-14 · S3，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；JS 包只在新增文件边界多 1 个空语句（tools/group_split.py 的拼接符 "\n;\n"，长度不变）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01eS_ui_addrecord.js
 * 分组：ui
 * 职责：补记的「关联计划」下拉
 * 功能：
 *   - 补记的「关联计划」下拉
 * 函数索引（TOC）：fillAddRecordTimeOptions/updateAddRecordEnd/openAddRecordModal/fillAddRecordPlanOptions/onAddRecordPlanChange/fillAddRecordSubOptions/findTodoByIdStr/saveAddRecord/showAutoSaveHint/ensureDiary/cleanupEmptyDiaries/renderDiary（+24 更多）
 * ============================================================ */

function fillAddRecordTimeOptions(now) {
  const hSel = document.getElementById('addRecordHour');
  const mSel = document.getElementById('addRecordMinute');
  if (!hSel || !mSel) return;
  hSel.innerHTML = '';
  for (let i = 0; i < 24; i++) {
    const o = document.createElement('option');
    o.value = String(i).padStart(2, '0');
    o.textContent = String(i).padStart(2, '0');
    hSel.appendChild(o);
  }
  mSel.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const o = document.createElement('option');
    o.value = String(i).padStart(2, '0');
    o.textContent = String(i).padStart(2, '0');
    mSel.appendChild(o);
  }
  hSel.value = String(now.getHours()).padStart(2, '0');
  mSel.value = String(now.getMinutes()).padStart(2, '0');
}
function updateAddRecordEnd() {
  const h = parseInt(document.getElementById('addRecordHour').value) || 0;
  const m = parseInt(document.getElementById('addRecordMinute').value) || 0;
  const dur = parseInt(document.getElementById('addRecordDuration').value) || 0;
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const d = new Date(base);
  d.setHours(h, m + dur, 0, 0);
  let txt = fmtTime(d);
  if (d.getDate() !== base.getDate()) txt = '次日 ' + txt;
  const el = document.getElementById('addRecordEndShow');
  if (el) el.textContent = txt;
}
function openAddRecordModal() {
  const now = new Date();
  document.getElementById('addRecordDate').value = getTodayStr();
  fillAddRecordTimeOptions(now);
  document.getElementById('addRecordTask').value = '';
  document.getElementById('addRecordDuration').value = '25';
  document.getElementById('addRecordType').value = 'full';
  renderGridPicker('addRecordEnergyPicker', null, 'green');
  renderGridPicker('addRecordMoodPicker', null, 'yellow');
  fillAddRecordPlanOptions();
  showModal('addRecordModal');
  updateAddRecordEnd();
}

/* ===== 补记的「关联计划」下拉 =====
   背景——
   而根因就在这里：原实现只有一句 `todos.find(x => x.title === task)`，
   按**任务名精确匹配**找计划。名字差一个字（或干脆是临时起的名字）就静默失联，
   记录落盘时连 todoId 都不写，日志卡自然什么都显示不出来。
   现在给一个**显式入口**；名字匹配降级为「没选下拉时的兼容兜底」。 */
function fillAddRecordPlanOptions() {
  const sel = document.getElementById('addRecordPlan');
  const sub = document.getElementById('addRecordSub');
  if (sub) {
    sub.innerHTML = '<option value="">整条计划</option>';
    sub.disabled = true;
  }
  if (!sel) return;
  /* 只列**未完成**的计划：已完成的再补记一条专注，挂上去语义不对
     （完成流水那条路径已经负责呈现「当天完成的计划」）。顺序沿用列表顺序。 */
  const list = (appData.todos || []).filter(function (t) {
    return t && !t.done && !(t.archived);
  });
  const opts = ['<option value="">不关联</option>'];
  list.forEach(function (t) {
    const nm = t.title || '未命名';
    const subs = Array.isArray(t.subs) ? t.subs.length : 0;
    const quad = normQuad(t.quad);
    const qm = quad ? quadMeta(quad) : null;
    const qn = qm ? qm.short + ' · ' : '';
    opts.push(
      '<option value="' + escapeHtml(String(t.id)) + '">' +
      escapeHtml(qn + nm + (subs ? '（' + subs + ' 步）' : '')) +
      '</option>'
    );
  });
  sel.innerHTML = opts.join('');
  sel.value = '';
}

/* 计划下拉联动：切换计划 → 重建子任务下拉，并把任务名回填。
   取消关联时**不动**已填的任务名（用户可能正想改它）。 */
function onAddRecordPlanChange() {
  const sel = document.getElementById('addRecordPlan');
  const taskEl = document.getElementById('addRecordTask');
  const t = findTodoByIdStr(sel ? sel.value : '');
  if (t && taskEl) taskEl.value = t.title || '';
  fillAddRecordSubOptions(t);
}

function fillAddRecordSubOptions(t) {
  const sub = document.getElementById('addRecordSub');
  if (!sub) return;
  const subs = t && Array.isArray(t.subs) ? t.subs : [];
  sub.innerHTML = '<option value="">整条计划</option>' + subs.map(function (s) {
    return (
      '<option value="' + escapeHtml(String(s && s.id)) + '">' +
      escapeHtml((s && s.done ? '✓ ' : '') + ((s && s.title) || '未命名')) +
      '</option>'
    );
  }).join('');
  sub.disabled = !subs.length;
}

/* 按 id 字符串找计划：下拉的 value 一律是 String(id)，比较也一律转字符串，
   免得数字 id（Date.now()）与字符串 id（mustdo_ 之类）两种形态对不上。 */
function findTodoByIdStr(v) {
  const key = String(v == null ? '' : v);
  if (!key) return null;
  return (
    (appData.todos || []).find(function (x) {
      return x && String(x.id) === key;
    }) || null
  );
}

function saveAddRecord() {
  const dateStr = (document.getElementById('addRecordDate').value || '').trim() || getTodayStr();
  const task = document.getElementById('addRecordTask').value.trim() || '未命名任务';
  const dur = parseInt(document.getElementById('addRecordDuration').value) || 25;
  const type = document.getElementById('addRecordType').value;
  if (type === 'full' && dur < 15) {
    showToast('❌ 完整番茄需要专注至少 15 分钟');
    return;
  }
  if (type === 'half' && dur < 5) {
    showToast('❌ 半个番茄需要专注至少 5 分钟');
    return;
  }
  const hh = document.getElementById('addRecordHour').value || '09';
  const mm = document.getElementById('addRecordMinute').value || '00';
  const start = new Date(dateStr + 'T' + hh + ':' + mm + ':00');
  if (isNaN(start.getTime())) {
    showToast('❌ 日期/时间无效，请检查');
    return;
  }
  const end = new Date(start.getTime() + dur * 60000);
  const ae = getGridValue('addRecordEnergyPicker');
  const am = getGridValue('addRecordMoodPicker');
  /* 计划关联两条路（优先级从高到低）：
     ① 显式选了「关联计划」下拉 → 用它（这才是用户看得见的入口）；
     ② 没选 → 退回按任务名精确匹配（老习惯：手动敲的计划名正好对得上）。
     两条都没命中 → 独立记录，**不写任何计划字段**（C47 用例 B4 就守这条）。 */
  const _planSel = document.getElementById('addRecordPlan');
  let lt = findTodoByIdStr(_planSel ? _planSel.value : '');
  if (!lt && task) lt = (appData.todos || []).find(x => String(x.title || '').replace(/\s+/g, ' ').trim() === String(task || '').replace(/\s+/g, ' ').trim()) || null;
  const _subSel = document.getElementById('addRecordSub');
  const _subKey = String((_subSel && _subSel.value) || '');
  const _curSub = lt && _subKey
    ? (lt.subs || []).find(function (s) {
        return s && String(s.id) === _subKey;
      }) || null
    : null;
  const _ap = calcPomos(dur * 60, type);
  if (lt && type !== 'log') lt.actualPomodoros = (lt.actualPomodoros || 0) + _ap;
  if (lt && type !== 'log') lt.timeSpent = (lt.timeSpent || 0) + dur * 60;
  tbInvalidateSegIndex(); /* 补记记录 → 段落索引失效（写在 push 之前，顺序无所谓，意在就近） */
  appData.records.push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    uid: newUid('rec'),
    updatedAt: Date.now(),
    type: type,
    taskName: task,
    note: '',
    startTime: start.getTime(),
    endTime: end.getTime(),
    effectiveSeconds: dur * 60,
    pomos: _ap,
    interruptions: [],
    totalInterruptSeconds: 0,
    startEnergy: null,
    startMood: null,
    energy: ae || null,
    mood: am || null,
    expectedPomodoros: lt ? (lt.pomodoros != null ? lt.pomodoros : null) : null,
    actualPomodoros: lt ? lt.actualPomodoros || 0 : null,
    /* ★ 与计时路径（savePomodoroRecord）**同构**的计划快照。
       补记过去只写 expected/actual 两个番茄数，不写这些 —— 于是补记出来的记录
       在日志里既没有 📋 计划名、也没有子任务 chips，看着和计划毫无关系。
       快照而非引用：计划日后改了步骤，历史日志不改写。 */
    todoId: lt ? lt.id : null,
    tag: lt && lt.tag ? lt.tag : null,
    quad: lt ? normQuad(lt.quad) : null,
    subTitle: _curSub ? _curSub.title : null,
    subId: _curSub ? _curSub.id : null,
    planTitle: lt ? lt.title || null : null,
    planSubs: lt ? snapshotPlanSubs(lt, end.getTime()) : null
  });
  if (_ap > 0) addLotteryChance(Math.round(_ap));
  if (_ap > 0) addTreePoints(_ap);
  saveData();
  updateTodayStats();
  renderLogs();
  closeModal('addRecordModal');
  showToast(lt ? '已补记 · 已关联计划「' + (lt.title || '未命名') + '」' : '已补记');
  if (type === 'full' && dateStr === getTodayStr()) onPomodoroCompleteRank();
}
function showAutoSaveHint() {
  const hint = document.getElementById('autoSaveHint');
  if (!hint) return;
  hint.classList.add('show');
  clearTimeout(hint._timer);
  hint._timer = setTimeout(() => hint.classList.remove('show'), 2000);
}
function ensureDiary(date) {
  if (appData.diaries[date]) {
    const d = appData.diaries[date];
    if (!d.review) d.review = { progress: '', shortcomings: '', improvements: '', stop: '', other: '' };
    /* stop（该停止）是六期新加的：老日记没有这个键。
       不补一个空串也能跑（读的时候一律 String(x || '')），但补上之后
       「这条日记是哪一版写的」就不再靠字段存在与否去猜。 */
    if (d.review && d.review.stop === undefined) d.review.stop = '';
    if (!d.feedback) d.feedback = { sleepTime: '', wakeTime: '', sleepQuality: '', mentalState: '', sleepDay: 'prev' };
    if (d.feedback && !d.feedback.sleepDay) d.feedback.sleepDay = 'prev';
    if (d.planSnapshot === undefined) d.planSnapshot = [];
    return d;
  }
  return {
    plan: '',
    planSnapshot: [],
    review: { progress: '', shortcomings: '', improvements: '', stop: '', other: '' },
    feedback: { sleepTime: '', wakeTime: '', sleepQuality: '', mentalState: '', sleepDay: 'prev' }
  };
}
function cleanupEmptyDiaries() {
  let changed = false;
  for (const date of Object.keys(appData.diaries)) {
    const d = appData.diaries[date];
    const hasContent =
      d.plan ||
      (d.review && (d.review.progress || d.review.shortcomings || d.review.improvements || d.review.other)) ||
      (d.gratitude && Array.isArray(d.gratitude.items) && d.gratitude.items.length) ||
      (d.feedback &&
        (d.feedback.sleepTime || d.feedback.wakeTime || d.feedback.sleepQuality || d.feedback.mentalState));
    if (!hasContent) {
      delete appData.diaries[date];
      changed = true;
    }
  }
  if (changed) saveData();
}
function renderDiary() {
  renderDiarySingle();
}
/* 日记文本框自适应高：先归零再按 scrollHeight 定高（否则删字后不会变矮）。
   长到 CSS 的 max-height 就转框内滚动，不会把整页顶长。 */
function diaryAutoGrow(el) {
  if (!el) return;
  try {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  } catch (e) { if (window.__silent) window.__silent(e, '01e:diaryAutoGrow'); }
}
function diaryAutoGrowAll(prefix, date) {
  ['plan', 'rp', 'rs', 'ri', 'ro'].forEach(function (k) {
    diaryAutoGrow(document.getElementById(prefix + '_' + k + '_' + date));
  });
}
/* 日记里的小折叠（「其他记录」/「今日反馈」）：只切 display，**不重画整页** ——
   textarea 的值此刻还在 DOM 上、没同步进 state，重画会把用户刚打的字丢掉。 */
function toggleDiaryFoldHead(head) {
  const body = head.nextElementSibling;
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  head.classList.toggle('open', open);
  if (open) diaryAutoGrowAll('single', currentDiaryDate);
}
function buildDiaryForm(date, prefix) {
  const d = ensureDiary(date);
  let countdownHtml = '';
  const sorted = [...appData.countdowns].sort(_cdSort);
  if (sorted.length > 0) {
/* 与计划页共用同一套规则。
   下拉若固定列前 5 条、顺序还和专区不一致 —— 加了 10 个倒数日的人
   在复盘页永远看不到后 5 个。现在下拉列全部且与专区同序。 */
    const pins = sorted.filter(_isPinned);
    /* 与计划页同规则：复盘区也只自动显示勾选过的。
       一条都没勾时不再顶「最近 1 条」—— 「没添加到计划页的，它也自己
       出现在复盘页里」。此时只留一行可展开的入口，点开照旧能看到全部。 */
    const nearest = pins.length ? pins[0] : null;
    const days = nearest ? getDaysUntil(nearest.date) : 0;
    /* title/icon 为用户自由输入（备份导入路径亦可控），拼 innerHTML 前必须转义 */
    const text = nearest
      ? days === 0
        ? `今天就是'${escapeHtml(nearest.title)}'！`
        : `距离'${escapeHtml(nearest.title)}'还有 ${days} 天`
      : '';
    const color = days === 0 ? 'var(--danger)' : 'var(--text-light)';
    const dropdownItems = sorted
      .map(c => {
        const cd = getDaysUntil(c.date);
        const ct = cd === 0 ? `今天就是'${escapeHtml(c.title)}'！` : `距离'${escapeHtml(c.title)}'还有 ${cd} 天`;
        return `<div style="padding:var(--sp-8) var(--sp-12);border-bottom:1px solid var(--border);cursor:pointer;font-size:var(--fs-title);" onclick="event.stopPropagation();openCountdownDetail(${idArg(c.id)});document.getElementById('diaryCountdownDropdown').style.display='none';">${escapeHtml(c.icon || '📌')} ${ct}${_isPinned(c) ? ' <span style="font-size:var(--fs-caption);color:var(--text-light);">📌</span>' : ''}</div>`;
      })
      .join('');
    const cdHeadLine = nearest
      ? `<div style="background:var(--bg);border:1px dashed var(--yellow);border-radius:var(--radius-sm);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-title);color:${color};font-weight:600;cursor:pointer;" onclick="toggleDiaryCountdown()">${escapeHtml(nearest.icon || '📌')} ${text} <span style="float:right;">▾</span></div>`
      : `<div style="background:var(--bg);border:1px solid var(--hairline);border-radius:var(--radius-sm);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-title);color:var(--text-light);cursor:pointer;" onclick="toggleDiaryCountdown()">📌 倒数日 · 全部 ${sorted.length} 个 <span style="float:right;">▾</span></div>`;
    countdownHtml = `<div style="margin-bottom:var(--sp-12);">${cdHeadLine}<div id="diaryCountdownDropdown" style="display:none;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);margin-top:var(--sp-4);overflow:hidden;">${dropdownItems}</div></div>`;
  }
  // 昨日待改进自动带入
  const yd = new Date(date + 'T00:00:00');
  yd.setDate(yd.getDate() - 1);
  const yds = getDateStr(yd);
  const yesterdayImprove = ((appData.diaries[yds] && appData.diaries[yds].review && appData.diaries[yds].review.improvements) || '');
  const yesterdayHtml = yesterdayImprove
    ? `<div class="settings-group" style="margin-bottom:var(--sp-10);background:var(--bg);border:3px solid var(--border);"><h3 style="color:var(--blue-dark);">📌 昨日待改进</h3><div style="font-size:var(--fs-title);color:var(--text);padding:var(--sp-8);background:var(--card);border-radius:var(--radius-xs);line-height:1.6;">${escapeHtml(yesterdayImprove)}</div></div>`
    : '';
  /* 今日反馈的摘要：收起时也看得见「睡 7h · 精神 8」，不用展开就知道填过没 */
  const _fb = d.feedback || {};
  const _fbBits = [];
  if (_fb.sleepTime) _fbBits.push('睡 ' + escapeHtml(_fb.sleepTime));
  if (_fb.wakeTime) _fbBits.push('醒 ' + escapeHtml(_fb.wakeTime));
  if (_fb.sleepQuality) _fbBits.push('睡眠 ' + escapeHtml(String(_fb.sleepQuality)));
  if (_fb.mentalState) _fbBits.push('精神 ' + escapeHtml(String(_fb.mentalState)));
  const fbSummary = _fbBits.length ? _fbBits.join(' · ') : '还没填';
  /* 感恩日记：一天 1~3 条短句（三件好事练习）。读法容忍老日记没有这个字段。 */
  const _gr = (d.gratitude && Array.isArray(d.gratitude.items)) ? d.gratitude.items : [];
  let gratitudeGroup = '';
  for (let gi = 0; gi < 3; gi++) {
    gratitudeGroup +=
      '<div class="gratitude-row"><span class="gr-i">' + (gi + 1) + '</span>' +
      '<input type="text" id="' + prefix + '_gr_' + gi + '_' + date + '" maxlength="200"' +
      ' placeholder="第 ' + (gi + 1) + ' 件…" value="' + escapeHtml(_gr[gi] || '') + '"' +
      ' oninput="scheduleDiaryAutoSave(\'' + date + '\')"></div>';
  }
  gratitudeGroup =
    '<div class="settings-group" style="margin-bottom:var(--sp-10);"><h3>🙏 感恩日记</h3>' +
    '<div style="font-size:var(--fs-note);color:var(--text-light);margin-bottom:var(--sp-8);">今天有哪几件小事值得感谢？写不满也没关系，一件就够。</div>' +
    gratitudeGroup +
    '</div>';
  /* 复盘四栏：前三个常驻，第四个「其他记录」默认收起 —— 它最少用，
     却和另三个一样各占一屏高度，正是"每天要滑很久"的主要来源。
     填过内容就默认展开（不然用户看不到自己写过的东西）。 */
  const _roOpen = !!(d.review.other && String(d.review.other).trim());
  const _revFields =
    `<div class="diary-field"><label>今天进步</label><textarea id="${prefix}_rp_${date}" placeholder="写一件做成的、哪怕很小的事" oninput="scheduleDiaryAutoSave('${date}');diaryAutoGrow(this)">${escapeHtml(d.review.progress || '')}</textarea></div>` +
    `<div class="diary-field"><label>今天不足</label><textarea id="${prefix}_rs_${date}" placeholder="今天卡在哪、被打断了几次" oninput="scheduleDiaryAutoSave('${date}');diaryAutoGrow(this)">${escapeHtml(d.review.shortcomings || '')}</textarea></div>` +
    `<div class="diary-field"><label>明天改进</label><textarea id="${prefix}_ri_${date}" placeholder="明天只改一件" oninput="scheduleDiaryAutoSave('${date}');diaryAutoGrow(this)">${escapeHtml(d.review.improvements || '')}</textarea></div>` +
    /* 「该停止」和「今天不足」不是一回事：不足是「没做好」，停止是「就不该做」。
       合成一格时「刷了两小时短视频」会被写进不足里，而它真正需要的是被停掉，
       不是被改进。用单行而不是 textarea —— 这件事越短越有用。 */
    `<div class="diary-field"><label>该停止</label><input type="text" id="${prefix}_rst_${date}" maxlength="120" placeholder="今天最该戒掉的一件事（可选）" oninput="scheduleDiaryAutoSave('${date}')" value="${escapeHtml(d.review.stop || '')}"></div>` +
    `<div class="diary-subfold"><div class="diary-fold-head${_roOpen ? ' open' : ''}" onclick="toggleDiaryFoldHead(this)"><span>其他记录</span><span class="dfh-arrow">▸</span></div><div class="diary-fold-body" style="display:${_roOpen ? 'block' : 'none'}"><div class="diary-field"><textarea id="${prefix}_ro_${date}" placeholder="想记的杂事、情绪、想法…" oninput="scheduleDiaryAutoSave('${date}');diaryAutoGrow(this)">${escapeHtml(d.review.other || '')}</textarea></div></div></div>`;
  /* 今日反馈：**默认展开**——
     收起改为纯用户动作，不再由"填过没"自动决定；条目多时用户可自行点收起。 */
  const _fbOpen = true;
  return `${countdownHtml}${yesterdayHtml}<div class="settings-group" style="margin-bottom:var(--sp-10);"><h3>🔍 每日复盘</h3>${_revFields}</div>${gratitudeGroup}<div class="settings-group" style="margin-bottom:var(--sp-10);"><div class="diary-fold-head${_fbOpen ? ' open' : ''}" onclick="toggleDiaryFoldHead(this)"><h3 style="margin:0">😴 今日反馈<span style="font-size:var(--fs-caption);font-weight:400;color:var(--text-light);margin-left:var(--sp-6)">${fbSummary}</span></h3><span class="dfh-arrow">▸</span></div><div class="diary-fold-body" style="display:${_fbOpen ? 'block' : 'none'}"><div class="diary-row"><div class="diary-field"><label>昨晚入睡</label><div style="display:flex;gap:var(--sp-6);align-items:center;"><select id="${prefix}_fsd_${date}" onchange="scheduleDiaryAutoSave('${date}')" style="flex:1;min-width:0;padding:var(--sp-8);border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-size:var(--fs-body);background:var(--card);color:var(--text);"><option value="prev" ${(d.feedback.sleepDay || 'prev') === 'prev' ? 'selected' : ''}>昨晚</option><option value="today" ${(d.feedback.sleepDay || 'prev') === 'today' ? 'selected' : ''}>今天凌晨</option></select><input type="time" id="${prefix}_fs_${date}" value="${d.feedback.sleepTime || ''}" onchange="scheduleDiaryAutoSave('${date}')" style="flex:1.2;min-width:0;"></div><div style="font-size:var(--fs-tiny);color:var(--text-light);margin-top:var(--sp-2);">昨晚 23:30 睡选「昨晚」；拖到凌晨 1 点才睡选「今天凌晨」</div></div><div class="diary-field"><label>起床时间</label><input type="time" id="${prefix}_fw_${date}" value="${d.feedback.wakeTime || ''}" onchange="scheduleDiaryAutoSave('${date}')"></div></div><div class="diary-field"><label>睡眠质量</label><div class="grid-picker" id="${prefix}_fq_${date}_grid"></div><span id="${prefix}_fq_${date}_label" style="margin-left:var(--sp-8);font-size:var(--fs-body);font-weight:800;color:var(--blue-dark);"></span></div><div class="diary-field"><label>精神状态</label><div class="grid-picker" id="${prefix}_fe_${date}_grid"></div><span id="${prefix}_fe_${date}_label" style="margin-left:var(--sp-8);font-size:var(--fs-body);font-weight:800;color: var(--yellow-ink);"></span></div></div></div><button class="save-btn" onclick="forceSaveDiary('${date}');showToast('✅保存成功')">💾 立即保存</button>`;
}
function renderDiarySingle() {
  const view = document.getElementById('diarySingleView');
  const today = getTodayStr();
  if (!currentDiaryDate) __set_currentDiaryDate(today);
  const isToday = currentDiaryDate === today;
  /* 复盘提醒条挂在日记页顶部：它看的是日期和 reviews，跟记录集无关，
     所以不能塞进 renderLogs 的脏检查里（记录没变就跳过 → 跨过零点也不刷新）。 */
  try {
    if (typeof renderLogReviewBar === 'function') renderLogReviewBar();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:reviewBar'); }
  renderDailyFocusSummary(currentDiaryDate);
  renderBioSection();
  view.innerHTML = `<div class="diary-current-date">📅 ${currentDiaryDate}${isToday ? '（今天）' : ''}<button class="btn-small" style="margin-left:var(--sp-8);" onclick="openCalendarModal()">选择日期</button></div>${buildDiaryForm(currentDiaryDate, 'single')}`;
  initDiaryGrids('single', currentDiaryDate);
  /* 文本框按内容定高（要等元素进了 DOM 才量得到 scrollHeight） */
  diaryAutoGrowAll('single', currentDiaryDate);
}
function initDiaryGrids(prefix, date) {
  const fq = document.getElementById(prefix + '_fq_' + date + '_grid');
  const fe = document.getElementById(prefix + '_fe_' + date + '_grid');
  if (fq) {
    const d = ensureDiary(date);
    renderGridPicker(fq.id, d.feedback.sleepQuality ? parseInt(d.feedback.sleepQuality) : null, 'blue');
    fq.querySelectorAll('.grid-cell').forEach(cell => {
      cell.onclick = () => {
        setGridValue(fq.id, parseInt(cell.dataset.val));
        scheduleDiaryAutoSave(date);
      };
    });
  }
  if (fe) {
    const d = ensureDiary(date);
    renderGridPicker(fe.id, d.feedback.mentalState ? parseInt(d.feedback.mentalState) : null, 'yellow');
    fe.querySelectorAll('.grid-cell').forEach(cell => {
      cell.onclick = () => {
        setGridValue(fe.id, parseInt(cell.dataset.val));
        scheduleDiaryAutoSave(date);
      };
    });
  }
}
function scheduleDiaryAutoSave(date) {
  if (diaryAutoSaveTimers[date]) clearTimeout(diaryAutoSaveTimers[date]);
  diaryAutoSaveTimers[date] = setTimeout(() => {
    forceSaveDiary(date);
    showAutoSaveHint();
  }, 5000);
}
function forceSaveDiary(date) {
  if (diaryAutoSaveTimers[date]) {
    clearTimeout(diaryAutoSaveTimers[date]);
    diaryAutoSaveTimers[date] = null;
  }
  const d = ensureDiary(date);
  const planEl = document.getElementById('single_plan_' + date);
  if (planEl) d.plan = planEl.value;
  const rp = document.getElementById('single_rp_' + date);
  if (rp) d.review.progress = rp.value;
  const rs = document.getElementById('single_rs_' + date);
  if (rs) d.review.shortcomings = rs.value;
  const ri = document.getElementById('single_ri_' + date);
  if (ri) d.review.improvements = ri.value;
  const rst = document.getElementById('single_rst_' + date);
  if (rst) d.review.stop = rst.value;
  const ro = document.getElementById('single_ro_' + date);
  if (ro) d.review.other = ro.value;
  const fs = document.getElementById('single_fs_' + date);
  if (fs) d.feedback.sleepTime = fs.value;
  const fsd = document.getElementById('single_fsd_' + date);
  if (fsd) d.feedback.sleepDay = fsd.value;
  const fw = document.getElementById('single_fw_' + date);
  if (fw) d.feedback.wakeTime = fw.value;
  const fq = document.getElementById('single_fq_' + date + '_grid');
  if (fq) d.feedback.sleepQuality = getGridValue(fq.id) || '';
  const fe = document.getElementById('single_fe_' + date + '_grid');
  if (fe) d.feedback.mentalState = getGridValue(fe.id) || '';
  /* 感恩日记：1~3 条短句，逐条 trim、丢空串、单条截到 200 字；
     一条都没有就把整个对象删掉（不留空壳，导出也干净）。 */
  const grItems = [];
  for (let gi = 0; gi < 3; gi++) {
    const ge = document.getElementById('single_gr_' + gi + '_' + date);
    if (!ge) continue;
    const gv = String(ge.value || '').trim().slice(0, 200);
    if (gv) grItems.push(gv);
  }
  if (grItems.length) d.gratitude = { items: grItems };
  else delete d.gratitude;
  const hasContent =
    d.plan ||
    d.review.progress ||
    d.review.shortcomings ||
    d.review.improvements ||
    d.review.other ||
    d.feedback.sleepTime ||
    d.feedback.wakeTime ||
    d.feedback.sleepQuality ||
    d.feedback.mentalState ||
    grItems.length;
  if (hasContent) {
    appData.diaries[date] = d;
  } else if (appData.diaries[date] && !hasContent) {
    delete appData.diaries[date];
  }
  saveData();
}
/* 月历的「选完回调」：为空 = 日记模式（老行为）；
   传入 { onPick, mark } = 通用选日期模式（时间块网格在用），选完调 onPick 并关闭。
   通用模式还可以再给两个可选项，把「这天长什么样」整个交出去：
     · dayCell(ds, day) → { cls, html, title }：自画格子（日程表用它画番茄热力格）
     · legend：格子下面那行图例的 HTML（不给就不占行） */
let _calendarPick = null;
function openCalendarModal(opts) {
  _calendarPick = (opts && typeof opts.onPick === 'function') ? opts : null;
  const now = new Date();
  __set_calendarYear(now.getFullYear());
  __set_calendarMonth(now.getMonth());
  const _s = document.getElementById('calendarSearch');
  if (_s) _s.value = '';
  const _sr = document.getElementById('calendarSearchResults');
  if (_sr) _sr.innerHTML = '';
  /* 通用选日期模式没有「日记关键词」这回事，把搜索条藏掉 */
  if (_s) _s.style.display = _calendarPick ? 'none' : '';
  /* 每次打开收起跳转面板，回到当前年月 */
  const _jrow = document.getElementById('calendarJumpRow');
  if (_jrow) _jrow.style.display = 'none';
  renderCalendar();
  showModal('calendarModal');
}
function renderCalendar() {
  document.getElementById('calendarTitle').textContent = calendarYear + '年' + (calendarMonth + 1) + '月';
  /* 同步年月跳转面板（年份 + 12 个月份快捷格） */
  const _jy = document.getElementById('calendarJumpYear');
  if (_jy) _jy.textContent = calendarYear;
  const _jm = document.getElementById('calendarJumpMonths');
  if (_jm) {
    if (!_jm.childNodes.length) {
      let mh = '<span class="cal-jump-lbl">月</span>';
      for (let m = 1; m <= 12; m++) mh += '<button class="cal-jump-m" data-m="' + m + '" onclick="jumpCalendarMonth(' + m + ')">' + m + '</button>';
      _jm.innerHTML = mh;
    }
    Array.prototype.forEach.call(_jm.querySelectorAll('.cal-jump-m'), function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-m')) === calendarMonth + 1);
    });
  }
  const grid = document.getElementById('calendarGrid');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let html = weekdays.map(w => `<div class="calendar-weekday">${w}</div>`).join('');
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const today = getTodayStr();
  const todayDate = new Date();
  const pick = _calendarPick;
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr =
      calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const isToday = dateStr === today;
    /* 日记不该写未来的（没意义）；通用选日期可以随便选，包括往后翻 */
    const isFuture = !pick && new Date(dateStr) > new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
    const onclick = !isFuture ? `onclick="calendarDayPick('${dateStr}')"` : '';
    /* ★ 格子交给调用方自画（日程表选日期模式，pick.dayCell）：class / 内容 / title 都由
       日程那边给。为什么不在本函数里判"这天该长什么样"——那是日程的业务口径
       （番茄热力 / 有没有一次性排期），日历弹窗只管摆位置；两处各判一次，迟早出现
       「日历说这天有安排、网格里一格都没有」。老调用（日记）不带 dayCell，
       照旧走下面的 has-diary 涂色，一个字节不变。 */
    if (pick && typeof pick.dayCell === 'function') {
      const c = pick.dayCell(dateStr, day) || {};
      const cls =
        'calendar-day hm' + (c.cls ? ' ' + c.cls : '') + (isToday ? ' today' : '') + (isFuture ? ' disabled' : '');
      const ttl = c.title ? ` title="${escapeHtml(String(c.title))}"` : '';
      html += `<div class="${cls}" ${onclick}${ttl}>${c.html == null ? day : c.html}</div>`;
      continue;
    }
    const marked = pick ? (typeof pick.mark === 'function' ? !!pick.mark(dateStr) : false) : !!appData.diaries[dateStr];
    let cls = 'calendar-day';
    if (marked) cls += ' has-diary';
    if (isToday) cls += ' today';
    if (isFuture) cls += ' disabled';
    html += `<div class="${cls}" ${onclick}>${day}</div>`;
  }
  /* 图例也由调用方给（日程：少→多 四档）。不给就不占行。 */
  if (pick && pick.legend) html += '<div class="logcal-legend">' + pick.legend + '</div>';
  grid.innerHTML = html;
}
/* 展开/收起年-月跳转面板 */
function openCalendarJump() {
  const row = document.getElementById('calendarJumpRow');
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'block' : 'none';
}
/* 跨年切换（此前只有 changeCalendarMonth，翻 12 个月才能到上一年）
 *   ★ 2026-10-30 修：calendarYear / calendarMonth 的真身在 01b（数据层），
 *   本文件拿到的是 ESM 导入绑定 —— **导入绑定只读**，`calendarYear++` 直接抛
 *   TypeError: Assignment to constant variable，表现为「点日历左右箭头毫无反应」。
 *   跨模块可变状态必须走 01b 的 __set_* 写入口（读仍是活绑定，不用改）。 */
function changeCalendarYear(delta) {
  __set_calendarYear(calendarYear + (Number(delta) || 0));
  renderCalendar();
}
/* 直接跳到某月（保留当前年份） */
function jumpCalendarMonth(m) {
  const mm = Math.max(1, Math.min(12, Number(m) || 1)) - 1;
  __set_calendarMonth(mm);
  renderCalendar();
}
function changeCalendarMonth(delta) {
  /* 先算好目标年月再一次性写回：中途分两次 set，中间态不合法时（如 13 月）
     任何一次重入渲染都会画出错误月份。 */
  let y = calendarYear;
  let m = calendarMonth + (Number(delta) || 0);
  while (m < 0) { m += 12; y--; }
  while (m > 11) { m -= 12; y++; }
  __set_calendarYear(y);
  __set_calendarMonth(m);
  renderCalendar();
}
/* 月历里点了一天：带选完回调 → 走回调（时间块网格）；否则是日记的老路径 */
function calendarDayPick(date) {
  if (_calendarPick) {
    const h = _calendarPick.onPick;
    _calendarPick = null;
    closeModal('calendarModal');
    h(date);
    return;
  }
  selectDiaryDate(date);
}
function selectDiaryDate(date) {
  forceSaveDiary(currentDiaryDate);
  __set_currentDiaryDate(date);
  closeModal('calendarModal');
  switchLogTab('diary');
  renderDiarySingle();
}
function goToTodayDiary() {
  calendarDayPick(getTodayStr());
}
function searchDiaries(keyword) {
  const kw = keyword.trim().toLowerCase();
  const results = document.getElementById('calendarSearchResults');
  if (!kw) {
    results.innerHTML = '';
    return;
  }
  const matches = [];
  Object.keys(appData.diaries).forEach(date => {
    const d = appData.diaries[date];
    const text = [d.plan, d.review && d.review.progress, d.review && d.review.shortcomings, d.review && d.review.improvements, d.review && d.review.other]
      .join(' ')
      .toLowerCase();
    if (text.includes(kw)) {
      const snippet = ((d.review && d.review.progress) || d.plan || '').substring(0, 40);
      matches.push({ date, snippet });
    }
  });
  matches.sort((a, b) => b.date.localeCompare(a.date));
  if (!matches.length) {
    results.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:var(--sp-10);font-size:var(--fs-title);">未找到匹配的日记</div>';
    return;
  }
  results.innerHTML = matches
    .map(
      m =>
        `<div class="calendar-search-item" onclick="selectDiaryDate('${m.date}')"><div class="sr-date">${m.date}</div><div class="sr-snippet">${escapeHtml(m.snippet)}…</div></div>`
    )
    .join('');
}
function renderWeeklyBadges() {
  const container = document.getElementById('weeklyBadgeList');
  if (!container) return;
  const weekDone = getWeekTomatoPoints();
  /* 原始完成量：不减任何消耗，统计/海报口径 */ const currentWeekCount = getWeekHeldTomatoes();
  /* 持有量：战标判定口径 */ const wcEl = document.getElementById('weekTomatoCount');
  if (wcEl) wcEl.textContent = fmtTomatoNum(weekDone);
  const whEl = document.getElementById('weekTomatoHeld');
  if (whEl) {
    whEl.textContent = fmtTomatoNum(currentWeekCount);
    whEl.style.color = currentWeekCount > 0 ? 'var(--green)' : 'var(--red,#C0392B)';
  }
  container.innerHTML = WEEKLY_BADGES.map(b => {
    const cumulative = ((appData.weeklyBadges && appData.weeklyBadges.cumulative && appData.weeklyBadges.cumulative[b.id]) || 0);
    const habitMet = !b.habitReq || checkWeekHabitReq(getWeekStartStr(), b.habitReq);
    const state = getBadgeState(b);
    const lit = state !== 'off';
    let progressHint = '';
    if (!lit) {
      if (b.habitReq && currentWeekCount >= b.goal) {
        const miss = weekHabitMissingDays(b.habitReq);
        progressHint = '还差 习惯打卡（' + (miss > 0 ? miss + '天' : '') + '）';
      } else if (currentWeekCount < b.goal) {
        progressHint = '还差 ' + Math.max(1, Math.ceil(b.goal - currentWeekCount)) + ' 🍅';
      }
    }
    const gloryClass = b.glow && lit ? ' badge-glory' : '';
    const habitHtml = b.habitReq
      ? `<div style="font-size:var(--fs-title);color:${habitMet ? 'var(--green)' : 'var(--primary)'};margin-top:var(--sp-2);">🌿${b.habitReqDesc}</div>`
      : '';
    const stateText = state === 'this' ? '✅ 本周达成' : state === 'carry' ? '⏳ 延续中·本周需再达成' : '熄灭';
    const stateColor = state === 'this' ? 'var(--green)' : state === 'carry' ? 'var(--yellow-dark)' : '#999';
    return `<div class="badge-card${gloryClass}" style="text-align:center;padding:var(--sp-10) var(--sp-6);width:82px;border:2px solid ${lit ? b.color : '#ddd'};border-radius:var(--radius);background:${lit ? b.bg : '#f9f9f9'};opacity:${lit || cumulative > 0 ? '1' : '0.5'};${lit ? 'box-shadow:0 0 8px ' + b.color + ';' : ''}"><div style="font-size:34px;filter:${lit ? 'none' : 'grayscale(1)'};">${b.icon}</div><div style="font-size:var(--fs-title);font-weight:700;margin-top:var(--sp-2);color:${lit ? b.color : '#999'};">${b.name}</div><div style="font-size:var(--fs-title);color:var(--text-light);">${b.desc}</div>${habitHtml}<div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-2);">日均${b.avg}🍅</div><div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-2);">${b.positioning}</div>${progressHint ? `<div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-2);">${progressHint}</div>` : ''}<div style="font-size:var(--fs-title);margin-top:var(--sp-2);color:${stateColor};font-weight:${lit ? '700' : '400'};">${stateText}</div><div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-2);">累计${cumulative}次</div></div>`;
  }).join('');
  renderTimerBadge();
}
/* 今日习惯/计划打卡提醒卡（在日志页专注记录上方：习惯页层级深易忘，这里直接提醒+一键直达） */
function renderHabitRemind() {
  const el = document.getElementById('habitRemindCard');
  if (!el) return;
  const habits = appData.habits || [];
  const undone = (appData.todos || []).filter(function (t) {
    return !t.done;
  }).length;
  const today = getTodayStr();
  /* ★ 2026-10-30：只数「今天该做」的习惯（非归档 + 节奏/配额命中 + 今天没跳过）。
     原来是 habits.length 一把抓 —— 归档的习惯永远算"没打卡"，每周一三五的习惯
     周二也在催你，这块提醒卡就成了永远关不掉的黄色条。
     判定统一交给 habitDueToday：这里再拼一遍条件，就会和习惯页的列表对不上。 */
  const todayHabits = habits.filter(function (h) {
    return h && !h.archived && habitDueToday(h, today);
  });
  const done = todayHabits.filter(function (h) {
    return (appData.habitLogs[h.id] || []).includes(today);
  }).length;
  const left = todayHabits.length - done;
  /* 全部完成（习惯+计划）→ 整块隐藏，不打扰 */
  if (left <= 0 && undone === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  let html = '';
  /* 习惯卡：未完成时提醒 */
  if (todayHabits.length && left > 0) {
    html +=
      '<div style="display:flex;align-items:center;gap:var(--sp-8);background:var(--card);border:2px solid var(--yellow-dark);border-radius:var(--radius-input);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-body);margin-bottom:var(--sp-8);"><span style="font-size:var(--fs-sub);">🌱</span><div style="flex:1;"><b>今日习惯 ' +
      done +
      '/' +
      todayHabits.length +
      '</b>，还有 ' +
      left +
      ' 个没打卡<br><span style="font-size:var(--fs-note);color:var(--text-light);">连续打卡才能养成习惯，点一下就来</span></div><button onclick="goHabitCheck()" style="background:var(--yellow-dark);color:#fff;border:none;border-radius:var(--radius);padding:var(--sp-6) var(--sp-14);font-weight:700;flex-shrink:0;">去打卡 ›</button></div>';
  }
  /* 计划卡：有未完成时提醒 */
  if (undone > 0) {
    html +=
      '<div style="display:flex;align-items:center;gap:var(--sp-8);background:var(--card);border:2px solid var(--blue);border-radius:var(--radius-input);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-body);"><span style="font-size:var(--fs-sub);">📋</span><div style="flex:1;"><b>今日计划还有 ' +
      undone +
      ' 项未完成</b><br><span style="font-size:var(--fs-note);color:var(--text-light);">未完成的计划明天会继续留着，今天收尾压力更小</span></div><button onclick="goPlanCheck()" style="background:var(--blue);color:#fff;border:none;border-radius:var(--radius);padding:var(--sp-6) var(--sp-14);font-weight:700;flex-shrink:0;">去完成 ›</button></div>';
  }
  el.innerHTML = html;
}
function goHabitCheck() {
  switchView('plan');
  switchPlanTab('habit');
}
function goPlanCheck() {
  switchView('plan');
  switchPlanTab('plan');
}
function renderTimerBadge() {
  const el = document.getElementById('timerBadge');
  if (!el) return;
  const currentWeekCount = getWeekHeldTomatoes();
  /* 战标按「持有」判定：兑换消耗后进度与点亮状态同步回退 */ let bestIdx = -1,
    bestState = 'off';
  for (let i = WEEKLY_BADGES.length - 1; i >= 0; i--) {
    const st = getBadgeState(WEEKLY_BADGES[i]);
    if (st !== 'off') {
      bestIdx = i;
      bestState = st;
      break;
    }
  }
  if (bestIdx < 0) {
    el.classList.remove('show');
    el.innerHTML = '';
    updateHonorEffects();
    return;
  }
  const bestBadge = WEEKLY_BADGES[bestIdx]; /* 找下一个未点亮的更高目标标 */
  let nextBadge = null;
  for (let i = bestIdx + 1; i < WEEKLY_BADGES.length; i++) {
    if (getBadgeState(WEEKLY_BADGES[i]) === 'off') {
      nextBadge = WEEKLY_BADGES[i];
      break;
    }
  }
  const gloryCls = bestBadge.glow ? ' badge-glory' : '';
  el.className = 'timer-badge show' + gloryCls;
  el.style.borderColor = bestBadge.color;
  const darkMode = typeof document.body !== 'undefined' && document.body.classList.contains('dark-mode');
  el.style.background = darkMode ? 'rgba(24,28,50,.92)' : bestBadge.bg;
  /* v5.7.6 精简：徽章只保留 图标 + 名称 + 简短状态；"距下一战标还差几个🍅"统一放到「每周战标」页查看 */
  let stateHtml;
  if (bestState === 'carry') stateHtml = '<div class="tb-state" style="color: var(--yellow-ink)">⏩ 延续中</div>';
  else if (nextBadge) stateHtml = '<div class="tb-state" style="color: var(--green-ink)">✅ 本周达成</div>';
  else stateHtml = '<div class="tb-state" style="color: var(--green-ink)">👑 本周最高</div>';
  el.innerHTML = `<div class="tb-icon">${bestBadge.icon}</div><div class="tb-name" style="color:${bestBadge.color};">${bestBadge.name}</div>${stateHtml}`;
  updateHonorEffects();
}
/* 段数规则折叠：展开/收起规则与冲段说明（全局状态，重渲染后恢复） */
let _segRulesOpen = false;
function toggleSegRules() {
  _segRulesOpen = !_segRulesOpen;
  const b = document.getElementById('segRulesBody');
  const a = document.getElementById('segRulesArrow');
  if (b) b.style.display = _segRulesOpen ? 'block' : 'none';
  if (a) a.textContent = _segRulesOpen ? '▾' : '▸';
}

/* 事件委托（2026-10-23）：原内联 onchange 带 typeof 守卫（旧存档可能没有该函数）。 */
window.setFontScaleSafe = function (v) {
  if (typeof setFontScale === 'function') setFontScale(v);
};
