/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01e_engine_ui.js 按域拆出（2026-11-14 · S3，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；JS 包只在新增文件边界多 1 个空语句（tools/group_split.py 的拼接符 "\n;\n"，长度不变）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01eR_ui_diary.js
 * 分组：ui
 * 职责：年月跳转（和日记日历同一套面板样式）
 * 功能：
 *   - 年月跳转（和日记日历同一套面板样式）
 * 函数索引（TOC）：togglePh/renderDiaryOverviewPage/renderAllDiaryBrowser/changeAllDiaryPage/jumpAllDiaryPage/renderOverviewCalendar/renderOverviewJump/toggleOverviewJump/changeOverviewYear/overviewJumpMonth/changeOverviewMonth/goToDiaryDate（+22 更多）
 * ============================================================ */

function togglePh(btn, descId) {
  let d = document.getElementById(descId);
  if (!d) return;
  let open = d.style.display !== 'none';
  d.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? 'ⓘ 说明 ▾' : 'ⓘ 说明 ▴';
}
/* ===== 定点提醒（413 行）已迁至 01eK_ui_remind.js（回退见该文件头注释）===== */
/* ===== 日志与回顾（1 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
/* 日志页右下角逐天跳转：第1次→今天，之后逐天往下，到底回到最新；目标日期不在当前页时自动翻页 */
let _logJumpDate = null;
/* ===== 日志与回顾（1 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
let editingCountdownId = null;
/* 专区排序方式：'date' 按剩余天数（默认，近的在上）｜'added' 按添加时间（新的在上）。
   只用内存变量、不落盘 —— 排序偏好不是数据，是临时视图，
   存进 appData 反而多一份真相要维护。 */
let countdownSortMode = 'date';
let overviewCalYear = 0,
  overviewCalMonth = 0;
let allDiaryPage = 1;
const ALL_DIARY_PAGE_SIZE = 10;
function renderDiaryOverviewPage() {
  const now = new Date();
  if (!overviewCalYear) {
    overviewCalYear = now.getFullYear();
    overviewCalMonth = now.getMonth();
  }
  renderOverviewCalendar();
  renderAllDiaryBrowser();
}
function renderAllDiaryBrowser() {
  const container = document.getElementById('allDiaryBrowser');
  const pagEl = document.getElementById('allDiaryPagination');
  if (!container) return;
  const dates = Object.keys(appData.diaries).sort().reverse();
  const totalPages = Math.max(1, Math.ceil(dates.length / ALL_DIARY_PAGE_SIZE));
  if (allDiaryPage > totalPages) allDiaryPage = totalPages;
  const start = (allDiaryPage - 1) * ALL_DIARY_PAGE_SIZE;
  const pageDates = dates.slice(start, start + ALL_DIARY_PAGE_SIZE);
  if (!dates.length) {
    container.innerHTML =
      '<div style="text-align:center;color:var(--text-light);padding:var(--sp-20) var(--sp-16);font-size:var(--fs-title);line-height:1.6">📖 还没有日记<br><span style="display:block;font-size:var(--fs-note);margin-top:var(--sp-8);color:var(--text-light)">今天有什么感悟？哪怕一句话，未来的你会感谢现在的记录</span></div>';
    if (pagEl) pagEl.innerHTML = '';
    return;
  }
  /* 条目正文**不再在这里手写字段**：一律走 00_pure_core 的 diaryOverviewParts()。
     那段手写的 `<b>进步：</b>…` 就是「日记加了感恩日记、总览看不见」的病根 ——
     字段清单写死在渲染函数里，加一个字段就要回来改一次，漏一次就静默丢一块内容。
     现在 rows（登记的字段）+ extra（没登记但有内容的字段）都来自同一张表。 */
  container.innerHTML = pageDates
    .map(date => {
      const d = appData.diaries[date];
      const isToday = date === getTodayStr();
      const parts = diaryOverviewParts(d);
      const rows = parts.rows
        .map(r => `<div><b>${escapeHtml(r.label)}：</b>${escapeHtml(r.text)}</div>`)
        .join('');
      /* 未登记字段用淡一点的颜色：内容照样看得见，但先不抢登记字段的视线 */
      const extra = parts.extra
        .map(r => `<div style="color:var(--text-light);"><b>${escapeHtml(r.label)}：</b>${escapeHtml(r.text)}</div>`)
        .join('');
      const fb = parts.feedback
        ? `<div style="color:var(--text-light);margin-top:var(--sp-4);">${escapeHtml(parts.feedback)}</div>`
        : '';
      const empty = !rows && !extra && !fb ? '<div style="color:var(--text-light);">（这天只建了空日记）</div>' : '';
      return `<div class="diary-overview-item" data-date="${date}"><div class="diary-overview-header" onclick="goToDiaryDate('${date}')"><span class="ov-date">📅 ${date}${isToday ? '（今天）' : ''}</span><span class="ov-arrow">▸</span></div><div class="diary-overview-body" style="font-size:var(--fs-body);line-height:1.6;">${rows}${extra}${fb}${empty}</div></div>`;
    })
    .join('');
  if (pagEl) {
    let pHtml = '';
    let diaryPageOpts = '';
    for (let p = 1; p <= totalPages; p++) {
      diaryPageOpts += `<option value="${p}"${p === allDiaryPage ? ' selected' : ''}>第 ${p} 页</option>`;
    }
    pHtml += `<button class="btn-small" ${allDiaryPage <= 1 ? 'disabled style="opacity:0.4;"' : ''} onclick="changeAllDiaryPage(-1)">‹ 上一页</button>`;
    pHtml += `<select onchange="jumpAllDiaryPage(this.value)" title="跳转到第几页" style="padding:var(--sp-4) var(--sp-8);border:2px solid var(--primary);border-radius:var(--radius-sm);font-size:var(--fs-body);font-weight:700;color: var(--primary-ink);background:var(--card);cursor:pointer;">${diaryPageOpts}</select>`;
    pHtml += `<span style="font-size:var(--fs-body);color:var(--text-light);">/ ${totalPages} 页</span>`;
    pHtml += `<button class="btn-small" ${allDiaryPage >= totalPages ? 'disabled style="opacity:0.4;"' : ''} onclick="changeAllDiaryPage(1)">下一页 ›</button>`;
    pagEl.innerHTML = pHtml;
  }
}

function changeAllDiaryPage(delta) {
  const dates = Object.keys(appData.diaries);
  const totalPages = Math.max(1, Math.ceil(dates.length / ALL_DIARY_PAGE_SIZE));
  allDiaryPage = Math.max(1, Math.min(totalPages, allDiaryPage + delta));
  renderAllDiaryBrowser();
}
function jumpAllDiaryPage(p) {
  const dates = Object.keys(appData.diaries);
  const totalPages = Math.max(1, Math.ceil(dates.length / ALL_DIARY_PAGE_SIZE));
  allDiaryPage = Math.max(1, Math.min(totalPages, parseInt(p, 10) || 1));
  renderAllDiaryBrowser();
}
function renderOverviewCalendar() {
  const _ovT = document.getElementById('overviewCalTitle');
  if (_ovT) _ovT.textContent = overviewCalYear + '年' + (overviewCalMonth + 1) + '月';
  const grid = document.getElementById('overviewCalendar');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let html = weekdays.map(w => `<div class="calendar-weekday">${w}</div>`).join('');
  const firstDay = new Date(overviewCalYear, overviewCalMonth, 1).getDay();
  const daysInMonth = new Date(overviewCalYear, overviewCalMonth + 1, 0).getDate();
  const today = getTodayStr();
  for (let i = 0; i < firstDay; i++) html += '<div class="calendar-day empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const ds =
      overviewCalYear + '-' + String(overviewCalMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const hasDiary = !!appData.diaries[ds];
    const isToday = ds === today;
    let cls = 'calendar-day';
    if (hasDiary) cls += ' has-diary';
    if (isToday) cls += ' today';
    const onclick = `onclick="goToDiaryDate('${ds}')"`;
    html += `<div class="${cls}" ${onclick}>${day}</div>`;
  }
  grid.innerHTML = html;
  renderOverviewJump();
}
/* 总览的「年 / 月」快跳面板。
   总览此前只能一月一月地翻 —— 想回看去年同一个月份要按 12 次。
   这里**复用**日记日历/专注记录日历那套 cal-jump 结构与样式（同一批 class、
   同一套「年 ‹ 2026 › + 12 个月」布局），三处日历行为一致，不各写一套。
   面板开着的时候换年/换月都不收起 —— 连着跳几个月不用反复点开。 */
let overviewCalJumpOpen = false;
function renderOverviewJump() {
  const box = document.getElementById('overviewJump');
  if (!box) return;
  box.style.display = overviewCalJumpOpen ? 'block' : 'none';
  if (!overviewCalJumpOpen) return;
  let monthHtml = '<span class="cal-jump-lbl">月</span>';
  for (let m = 1; m <= 12; m++) {
    monthHtml +=
      '<button class="cal-jump-m' +
      (m === overviewCalMonth + 1 ? ' on' : '') +
      '" onclick="overviewJumpMonth(' +
      m +
      ')">' +
      m +
      '</button>';
  }
  box.innerHTML =
    '<div class="cal-jump-line"><span class="cal-jump-lbl">年</span>' +
    '<button class="cal-jump-btn" onclick="changeOverviewYear(-1)">‹ 上年</button>' +
    '<span class="cal-jump-val" id="overviewJumpYear">' +
    overviewCalYear +
    '</span>' +
    '<button class="cal-jump-btn" onclick="changeOverviewYear(1)">下年 ›</button></div>' +
    '<div class="cal-jump-line">' +
    monthHtml +
    '</div>';
}
function toggleOverviewJump() {
  overviewCalJumpOpen = !overviewCalJumpOpen;
  renderOverviewJump();
}
function changeOverviewYear(delta) {
  overviewCalYear += Number(delta) || 0;
  renderDiaryOverviewPage();
}
function overviewJumpMonth(m) {
  overviewCalMonth = Math.max(0, Math.min(11, (Number(m) || 1) - 1));
  overviewCalJumpOpen = false;
  renderDiaryOverviewPage();
}
function changeOverviewMonth(delta) {
  overviewCalMonth += Number(delta) || 0;
  if (overviewCalMonth < 0) {
    overviewCalMonth = 11;
    overviewCalYear--;
  } else if (overviewCalMonth > 11) {
    overviewCalMonth = 0;
    overviewCalYear++;
  }
  renderDiaryOverviewPage();
}
function goToDiaryDate(date) {
  __set_currentDiaryDate(date);
  switchLogTab('diary');
}
/* 倒数日排序：按剩余天数（近的在前）。同一天用标题兜底，保证顺序稳定、不会每次重排都跳。 */
function _cdSort(a, b) {
  if (countdownSortMode === 'added') return (Number(b.id) || 0) - (Number(a.id) || 0);
  const d = getDaysUntil(a.date) - getDaysUntil(b.date);
  return d !== 0 ? d : String(a.title).localeCompare(String(b.title));
}
function setCountdownSort(mode) {
  countdownSortMode = mode === 'added' ? 'added' : 'date';
  const sel = document.getElementById('cdSortSelect');
  if (sel && sel.value !== countdownSortMode) sel.value = countdownSortMode;
  renderCountdowns();
}
/* 「展示在计划页」这件事**只留一个真相来源**：这里的两个函数。
   专区负责改（勾选），计划页/复盘页负责读。
   三处各写一份「取前 N 个」的判断，数量上限就会散落三地、互不相知。 */
function _isPinned(c) {
  return !!(c && (c.pinned === 1 || c.pinned === true || c.pinned === '1'));
}
function pinnedCountdowns() {
  const all = Array.isArray(appData.countdowns) ? appData.countdowns : [];
  return all.filter(_isPinned);
}
function renderCountdowns() {
  const list = document.getElementById('countdownList');
  if (!list) return;
  if (!appData.countdowns.length) {
    list.innerHTML =
      '<div style="text-align:center;color:var(--text-light);padding:40px;font-size:var(--fs-title);">还没有倒数日，点右上角添加</div>';
    return;
  }
  const sorted = [...appData.countdowns].sort(_cdSort);
  list.innerHTML = sorted
    .map(c => {
      const days = getDaysUntil(c.date);
      let color = 'var(--text-light)';
      if (days <= 7) color = 'var(--danger)';
      else if (days <= 30) color = 'var(--yellow-dark)';
      const isPin = _isPinned(c);
/* 勾选按钮必须 stopPropagation：整条卡片有 onclick（打开详情），
   不拦冒泡会「点了勾选，详情框也跟着弹」。 */
      const pinBtn =
        '<button class="btn-small" onclick="event.stopPropagation();toggleCountdownPin(' +
        idArg(c.id) +
        ')" title="' +
        (isPin ? '取消显示在计划页' : '显示在计划页') +
        '" style="flex-shrink:0;background:' +
        (isPin ? 'var(--primary)' : 'transparent') +
        ';color:' +
        (isPin ? 'var(--white)' : 'var(--text-light)') +
        ';border:2px solid ' +
        (isPin ? 'var(--primary)' : 'var(--border)') +
        ';padding:2px 8px;font-size:var(--fs-note);line-height:1.6;margin-right:var(--sp-6);">' +
        (isPin ? '📌 计划页' : '📌') +
        '</button>';
      const noteHtml = c.note
        ? '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          escapeHtml(c.note) +
          '</div>'
        : '';
      /* 首条高亮改「只在天数模式且未勾选时」才给：勾选模式下高亮会误导成「这条最重要」 */
      const borderLeft = '';
      return (
        '<div class="countdown-item" style="' +
        borderLeft +
        '" onclick="openCountdownDetail(' +
        idArg(c.id) +
        ')"><div style="font-size:34px;flex-shrink:0;width:40px;text-align:center;">' +
        escapeHtml(c.icon || '📌') +
        '</div><div class="countdown-info" style="min-width:0;"><div class="countdown-title">' +
        escapeHtml(c.title) +
        '</div><div class="countdown-date">' +
        escapeHtml(c.date) +
        (days >= 0 ? ' · 还剩' : ' · 已过') +
        Math.abs(days) +
        '天</div>' +
        noteHtml +
        '</div>' +
        pinBtn +
        '<div class="countdown-days"><div class="num" style="color:' +
        color +
        ';">' +
        (days >= 0 ? days : Math.abs(days)) +
        '</div><div class="unit">' +
        (days >= 0 ? '天后' : '天前') +
        '</div></div></div>'
      );
    })
    .join('');
}
function toggleCountdownPin(id) {
  const c = appData.countdowns.find(x => idEq(x.id, id));
  if (!c) return;
  const isPin = _isPinned(c);
  c.pinned = isPin ? 0 : 1;
  saveData();
  renderCountdowns();
  renderPlanCountdowns();
  renderDiary();
  showToast(isPin ? '已从计划页移除' : '已显示在计划页');
}
function renderPlanCountdowns() {
  const el = document.getElementById('planCountdownList');
  if (!el) return;
  const all = Array.isArray(appData.countdowns) ? appData.countdowns : [];
  if (!all.length) {
    el.innerHTML = '';
    return;
  }
  const sorted = [...all].sort(_cdSort);
  const pins = pinnedCountdowns().sort(_cdSort);
  /* 规则：计划页只显示在「倒数日」里勾选过的条目。
     一个都没勾时**不显示任何条目**，只留一行入口 —— 自动顶上「最近 1 条」不行：
     没勾过的也会出现在计划页，而且新加一个就把原来那行换掉，用户会以为
     「我加的东西被顶掉了」，也分不清哪条是自己勾的。
     「倒数日」整块已移入计划页，所以出口直接切计划页那个子标签就行。 */
  if (!pins.length) {
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg);border:1px solid var(--hairline);border-radius:var(--radius-sm);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-title);color:var(--text-light);cursor:pointer;" onclick="switchPlanTab(\'countdown\')"><span>📌 倒数日</span><span>全部 ' +
      sorted.length +
      ' 个 ▸</span></div>';
    return;
  }
  /* 「在『倒数日』里可调整」那行字太难看，删掉。
     但入口本身要留 —— 否则从计划页就没有路去倒数日了。
     改用整行标题可点 + 右侧一个 ▸ 表示可进入（不再放整句话）。 */
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:var(--sp-6);cursor:pointer;" onclick="switchPlanTab(\'countdown\')">' +
    '<span style="font-size:var(--fs-title);color:var(--text-light);font-weight:700;">📌 你关注的日子</span>' +
    '<span style="font-size:var(--fs-caption);color:var(--text-light);">▸</span>' +
    '</div>' +
    pins
      .map(c => {
        const days = getDaysUntil(c.date);
        let color = 'var(--text-light)';
        if (days <= 7) color = 'var(--danger)';
        else if (days <= 30) color = 'var(--yellow-dark)';
        const noteHtml = c.note
          ? '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            escapeHtml(c.note) +
            '</div>'
          : '';
        return (
          '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--card);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:var(--sp-8) var(--sp-12);margin-bottom:var(--sp-6);cursor:pointer;" onclick="openCountdownDetail(' +
          idArg(c.id) +
          ')"><div style="display:flex;align-items:center;gap:var(--sp-6);min-width:0;"><span style="font-size:var(--fs-hero);flex-shrink:0;">' +
          escapeHtml(c.icon || '📌') +
          '</span><div style="min-width:0;"><span style="font-size:var(--fs-title);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          escapeHtml(c.title) +
          '</span>' +
          noteHtml +
          '</div></div><div style="font-size:var(--fs-title);font-weight:800;color:' +
          color +
          ';flex-shrink:0;margin-left:var(--sp-8);">' +
          (days >= 0 ? days : Math.abs(days)) +
          '<span style="font-size:var(--fs-title);font-weight:400;">' +
          (days >= 0 ? '天后' : '天前') +
          '</span></div></div>'
        );
      })
      .join('');
}

function openAddCountdownModal() {
  editingCountdownId = null;
  document.getElementById('countdownModalTitle').textContent = '➕ 新增倒数日';
  document.getElementById('countdownIcon').value = '📌';
  document.getElementById('countdownTitle').value = '';
  document.getElementById('countdownDate').value = getTodayStr();
  const _n0 = document.getElementById('countdownNote');
  if (_n0) _n0.value = '';
  const _p0 = document.getElementById('countdownPinned');
  if (_p0) _p0.checked = false;
  document.getElementById('countdownDeleteBtn').style.display = 'none';
  showModal('countdownModal');
}
function openEditCountdownModal(id) {
  const c = appData.countdowns.find(x => idEq(x.id, id));
  if (!c) return;
  editingCountdownId = id;
  document.getElementById('countdownModalTitle').textContent = '✏️ 编辑倒数日';
  document.getElementById('countdownIcon').value = c.icon || '📌';
  document.getElementById('countdownTitle').value = c.title;
  document.getElementById('countdownDate').value = c.date;
  const _n1 = document.getElementById('countdownNote');
  if (_n1) _n1.value = c.note || '';
  const _p1 = document.getElementById('countdownPinned');
  if (_p1) _p1.checked = _isPinned(c);
  document.getElementById('countdownDeleteBtn').style.display = '';
  showModal('countdownModal');
}
function saveCountdown() {
  const title = document.getElementById('countdownTitle').value.trim();
  const date = document.getElementById('countdownDate').value;
  const icon = document.getElementById('countdownIcon').value;
  const noteEl = document.getElementById('countdownNote');
  const note = noteEl ? noteEl.value.trim() : '';
  const pinEl = document.getElementById('countdownPinned');
  const pinned = pinEl && pinEl.checked ? 1 : 0;
  if (!title) {
    showToast('请输入事件名称');
    return;
  }
  if (!date) {
    showToast('请选择日期');
    return;
  }
  if (editingCountdownId) {
    const c = appData.countdowns.find(x => x.id === editingCountdownId);
    if (c) {
      c.title = title;
      c.date = date;
      c.icon = icon;
      c.note = note;
      c.pinned = pinned;
    }
  } else {
    appData.countdowns.push({
      id: Date.now(),
      uid: newUid('cd'),
      updatedAt: Date.now(),
      title: title,
      date: date,
      icon: icon,
      note: note,
      pinned: pinned,
    });
  }
  saveData();
  renderCountdowns();
  renderPlanCountdowns();
  closeModal('countdownModal');
  showToast('已保存');
}
function deleteCountdown(id, closeId) {
  /* 同 deleteRecord：避开原生 confirm 在 WebView 里静默返回 false 的坑。
     closeId 由调用方给（倒数日编辑框 / 详情框用的是不同的 modal），
     且**只在确认删除后**才关 —— rsConfirm 是异步的，写在外面会提前关掉。 */
  var doDel = function () {
    appData.countdowns = appData.countdowns.filter(c => !idEq(c.id, id));
    saveData();
    renderCountdowns();
    renderPlanCountdowns();
    closeModal(closeId || 'countdownModal');
    showToast('已删除');
  };
  var msg = '确定删除这个倒数日吗？';
  /* 同 deleteRecord：确认框弹出前先收起来源弹窗，避免两窗叠加；取消则放回。 */
  if (closeId) closeModal(closeId);
  if (typeof window.rsConfirm === 'function') {
    window.rsConfirm(msg, { title: '删除倒数日', okText: '删除', danger: true }).then(function (ok) {
      if (ok) { doDel(); } else if (closeId) { showModal(closeId); }
    });
  } else if (confirm(msg)) {
    doDel();
  } else if (closeId) {
    showModal(closeId);
  }
}
function openCountdownDetail(id) {
  const c = appData.countdowns.find(x => idEq(x.id, id));
  if (!c) return;
  const days = getDaysUntil(c.date);
  const total = Math.abs(days);
  const passed = days < 0 ? total : Math.max(0, total - 0);
  const related = appData.records.filter(
    r => r.taskName && r.taskName.includes(c.title) && !isLogRecord(r)
  );
  const pomoCount = related.filter(r => r.type === 'full').length + related.filter(r => r.type === 'half').length * 0.5;
  const focusMin = Math.floor(related.reduce((s, r) => s + (r.effectiveSeconds || 0), 0) / 60);
  document.getElementById('recordDetailTitle').textContent = (c.icon || '📌') + ' ' + c.title;
  document.getElementById('recordDetailBody').innerHTML =
    `<div class="settings-group"><div style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-10);">目标日期：${escapeHtml(c.date)}</div>${c.note ? `<div style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-10);">📝 ${escapeHtml(c.note)}</div>` : ''}<div style="display:flex;justify-content:space-around;text-align:center;margin:var(--sp-12) 0;"><div><div style="font-size:29px;font-weight:800;color: var(--primary-ink);">${days >= 0 ? days : Math.abs(days)}</div><div style="font-size:var(--fs-title);color:var(--text-light);">${days >= 0 ? '剩余天数' : '已过天数'}</div></div><div><div style="font-size:29px;font-weight:800;color: var(--green-ink);">${pomoCount}</div><div style="font-size:var(--fs-title);color:var(--text-light);">关联番茄</div></div><div><div style="font-size:29px;font-weight:800;color: var(--blue-ink);">${focusMin}</div><div style="font-size:var(--fs-title);color:var(--text-light);">专注分钟</div></div></div><div class="modal-buttons" style="margin-top:var(--sp-4)"><button class="modal-btn secondary" style="background:${_isPinned(c) ? 'var(--yellow-dark)' : 'var(--card)'};color:${_isPinned(c) ? 'var(--white)' : 'var(--text)'};" onclick="toggleCountdownPin(${idArg(c.id)});closeModal('recordDetailModal')">${_isPinned(c) ? '📌 已显示在计划页（点此取消）' : '📌 显示在计划页'}</button><button class="modal-btn secondary" onclick="closeModal('recordDetailModal');openEditCountdownModal(${idArg(c.id)})">✏️ 编辑</button></div><div class="modal-buttons" style="margin-top:var(--sp-8)"><button class="modal-btn danger" onclick="deleteCountdown(${idArg(c.id)},'recordDetailModal')">🗑️ 删除</button></div></div>`;
  showModal('recordDetailModal');
}
function toggleDiaryCountdown() {
  const dd = document.getElementById('diaryCountdownDropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
/* 专注记录日历：弹窗月历，红点标记有记录的日期，点日期按天筛选 */
let logCalYear = 0,
  logCalMonth = 0;
/* ===== 日志与回顾（3 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
/* ===== 年月跳转（和日记日历同一套面板样式）=====
 * 之前只能一月一月点箭头：想翻到去年要按十几次。
 * 点标题展开：上年/下年 + 12 个月格子，一步到位。 */
let _logCalJumpOpen = false;
/* ===== 日志与回顾（8 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */

/* ===== 白噪音 + 我的歌单（387 行）已迁至 01eL_ui_audio.js（回退见该文件头注释）===== */
let _logLimit = 30;
let _logPage = 1;
const _logDaysPerPage = 7; /* 每页最多容纳 7 天（一周，按天分组折叠，超过即翻页） */
/* ===== 日志与回顾（2 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
let _logSig = '';
/* ===== 日志与回顾（9 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */

const _logOpenGroups = {};
/* ===== 日志与回顾（12 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
/* 某天的记录摘要：只取任务名，去重后最多列 REVIEW_CHIP_MAX 个（弹窗里够看，不用滚） */
const REVIEW_CHIP_MAX = 3;
/* ===== 日志与回顾（2 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
/* 当前正在看哪一天的详情；null = 停在「待回顾列表」。
   只是弹窗内部的临时视图状态，不落盘（关掉弹窗即忘，符合"看一眼就走"）。 */
let _reviewDayView = null;
/* 待回顾列表已展开到第几屏（0 = 只显示第一屏）。上限由「回顾设置」里的
   「一次最多显示 N 天」决定（settings.reviewMaxDays，0 = 不限）。
   断更两周再打开回顾，一次铺几十张卡滚不到底，所以默认收在 10 天。 */
let _reviewShownPages = 0;
/* ===== 日志与回顾（16 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
let activeMoreMenu = null;
function showMoreMenu(e, id) {
  document.querySelectorAll('.more-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'more-menu';
  /* ⚠️ 每个菜单项都要 event.stopPropagation()：
     菜单是 appendChild 到 .timeline-content 里的，而那张卡片自身带
     onclick="openRecordDetail(id)"。菜单项不拦冒泡的话，点「删除记录」会在
     弹出确认框之后**又冒泡触发卡片**，把记录详情弹窗打开 —— 就出现「确认框
     下面还压着一个弹窗」。 */
  let items = `<div class="more-menu-item" onclick="event.stopPropagation();editRecordField(${idArg(id)})">编辑/补填</div>`;
  const r = appData.records.find(x => idEq(x.id, id));
  if (r && r.type === 'interrupted')
    items += `<div class="more-menu-item" onclick="event.stopPropagation();closeMoreMenu();openRecordDetail(${idArg(id)})">查看打断详情</div>`;
  items += `<div class="more-menu-item danger" onclick="event.stopPropagation();deleteRecord(${idArg(id)})">删除记录</div>`;
  menu.innerHTML = items;
  e.target.closest('.timeline-content').appendChild(menu);
  activeMoreMenu = menu;
  setTimeout(() => document.addEventListener('click', closeMoreMenu, { once: true }), 10);
}
function closeMoreMenu() {
  if (activeMoreMenu) {
    activeMoreMenu.remove();
    activeMoreMenu = null;
  }
}
function editRecordField(id) {
  closeMoreMenu();
  openRecordDetail(id);
}
function deleteRecord(id, closeId) {
  closeMoreMenu();
  /* ⚠️ 不用原生 confirm：Android WebView 未实现 onJsConfirm 时会**静默返回 false**，
     表现就是「点了删除没反应、记录还在」。
     rsConfirm 是应用内弹窗（0C_w53），无 Promise 环境才回退原生。
     id 比较走 idEq：备份/导入来的 id 可能是字符串，严格 === 会静默漏删。
     closeId：确认删除后才关闭的弹窗 id（详情页删除按钮传 'recordDetailModal'）。
     ⚠️ 不能在外面写 `deleteRecord(id);closeModal(...)` —— rsConfirm 是异步的，
     那样会在**还没问用户**时就把详情页关掉，点「取消」也回不来。 */
  var msg = '确定删除这条记录吗？';
  var doDel = function () {
    /* 先留一份被删记录：它们当初发的树积分/计划账要在这里收回去。
       （抽奖次数已由 records 派生，删掉记录即自动回落，不需在此处理。） */
    var _gone = appData.records.filter(function (r) { return idEq(r.id, id); });
    appData.records = appData.records.filter(function (r) { return !idEq(r.id, id); });
    /* 墓碑：物理删除之外留一条「这条没了」的凭证。没有它，换设备/同步时
       服务端只会看到「这边比它少一条」，于是把已删记录原样拉回来。 */
    _gone.forEach(function (r) { tombstone(r.uid, 'record'); });
    tbInvalidateSegIndex(); /* 删记录 → 段落索引失效 */
    revertRecordRewards(_gone);
    saveData();
    updateTodayStats();
    updateRoundStats();
    renderTreeSection();
    renderLogs();
    if (closeId) closeModal(closeId);
    showToast('已删除');
  };
  /* ⚠️ 确认框弹出前先把详情页收起来：否则两个弹窗会**叠在一起**
     （「点删除那个弹窗，它下面还有一个弹窗」）。
     点「取消」再把详情页放回来，保住编辑上下文。 */
  if (closeId) closeModal(closeId);
  if (typeof window.rsConfirm === 'function') {
    window.rsConfirm(msg, { title: '删除记录', okText: '删除', danger: true }).then(function (ok) {
      if (ok) { doDel(); } else if (closeId) { showModal(closeId); }
    });
  } else if (confirm(msg)) {
    doDel();
  } else if (closeId) {
    showModal(closeId);
  }
}
/* 详情弹窗的类型下拉：按本条**实际时长**开放选项，与结算/补记同一套门槛
   （完整🍅 ≥15 分钟、半个🍅 ≥5 分钟；未完成与仅记录不限时长）。
   改类型只影响这条记录与统计口径，不追溯已发的奖励。 */
function fillDetailTypeOptions(r) {
  const sel = document.getElementById('detailRecordType');
  if (!sel) return;
  const sec = Math.max(0, Math.floor(r.effectiveSeconds || 0));
  const opts = [
    ['full', '完整🍅（折算 ' + fmtTomatoNum(calcPomos(sec, 'full')) + ' 个）', sec < MIN_FULL_MINUTES * 60],
    ['half', '半个🍅（折算 0.5 个）', sec < 5 * 60],
    ['incomplete', '未完成（不算番茄）', false],
    ['log', '仅记录（只记时间，不算番茄）', false]
  ];
/* 早期版本 / 导入备份里的「打断」类型：新记录已不再产生它，常规下拉不放。
   但这条记录本身就是打断时补一个原样选项，免得被静默改成别的类型。 */
  if (r.type === 'interrupted') opts.push(['interrupted', '打断（旧记录，保留原样）', false]);
  sel.innerHTML = opts
    .map(function (o) {
      return '<option value="' + o[0] + '"' + (o[2] ? ' disabled' : '') + '>' + o[1] + '</option>';
    })
    .join('');
  /* 老数据/导入的未知类型已归一成 log，这里兜底：认不出来的值一律按「仅记录」摆 */
  sel.value = r.type;
  if (!sel.value) sel.value = 'log';
  onDetailTypeChange();
}
/* 切换类型时给出后果说明（下拉选项本身只写折算数量，不解释影响） */
function onDetailTypeChange() {
  const sel = document.getElementById('detailRecordType');
  const hint = document.getElementById('detailTypeHint');
  if (!sel || !hint) return;
  const t = sel.value;
  if (t === 'interrupted') hint.textContent = '打断：旧版本留下的记录类型，只作展示用，不算番茄。改成上面四种之一才会重算口径。';
  else if (t === 'log') hint.textContent = '仅记录：只把这段时间记进日志，不算番茄、不进专注效率、不发金币。';
  else if (t === 'incomplete') hint.textContent = '未完成：保留时长记录，但不算番茄、占专注效率的分母。';
  else hint.textContent = '改类型只影响这条记录与统计数据；已发的金币/连击不追溯。';
}

function openRecordDetail(id) {
  const r = appData.records.find(x => idEq(x.id, id));
  if (!r) return;
  const typeMap = { full: '完整🍅', half: '半个🍅', incomplete: '未完成', interrupted: '打断', log: '仅记录' };
  /* 「仅记录」的时长只是这段时间的长度，不是专注时长，说明要写清 */
  const durTxt = isLogRecord(r)
    ? Math.floor((r.effectiveSeconds || 0) / 60) + ' 分钟（不计入专注）'
    : Math.floor(r.effectiveSeconds / 60) + '分' + r.effectiveSeconds % 60 + '秒';
  let interruptHtml = '';
  if (r.interruptions && r.interruptions.length) {
    interruptHtml = `<div class="settings-group" style="margin-top:var(--sp-12);"><h3>打断明细（共${r.interruptions.length}次，累计${r.totalInterruptSeconds}秒）</h3>`;
    r.interruptions.forEach((it, i) => {
      interruptHtml += `<div class="harvest-item">第${i + 1}次：${escapeHtml(it.reason || '未填写原因')}（${it.duration}秒）</div>`;
    });
    interruptHtml += '</div>';
  }
  document.getElementById('recordDetailTitle').textContent = '📋 记录详情';
  document.getElementById('recordDetailBody').innerHTML =
    `<div class="settings-group"><h3>基本信息</h3><div class="setting-row"><div class="setting-label">类型</div><select class="setting-input" id="detailRecordType" onchange="onDetailTypeChange()" style="flex:1;"></select></div><div style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-4);">有效时长：${durTxt}</div><div id="detailTypeHint" style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-10);line-height:1.5;"></div><div class="setting-row"><div class="setting-label">任务名称</div><input type="text" class="setting-input" id="detailTaskName" value="${escapeHtml(r.taskName || '')}" style="flex:1;"></div><div class="setting-row"><div class="setting-label">备注</div></div><textarea id="detailNote" style="width:100%;padding:var(--sp-8);border:1px solid var(--border-strong);border-radius:var(--radius-sm);min-height:60px;font-family:inherit;">${escapeHtml(r.note || '')}</textarea><div class="state-section" style="margin-top:var(--sp-10);"><div class="state-section-title">专注开始时的状态</div><div class="state-row"><span class="state-icon">🔋</span><div class="grid-picker" id="detailStartEnergyPicker"></div><span class="state-label" id="detailStartEnergyLabel"></span></div><div class="state-row"><span class="state-icon">😊</span><div class="grid-picker" id="detailStartMoodPicker"></div><span class="state-label" id="detailStartMoodLabel"></span></div></div><div class="state-section" style="margin-top:var(--sp-10);"><div class="state-section-title">专注结束时的状态（可修改）</div><div class="state-row"><span class="state-icon">🔋</span><div class="grid-picker" id="detailEndEnergyPicker"></div><span class="state-label" id="detailEndEnergyLabel"></span></div><div class="state-row"><span class="state-icon">😊</span><div class="grid-picker" id="detailEndMoodPicker"></div><span class="state-label" id="detailEndMoodLabel"></span></div></div><div class="modal-buttons" style="margin-top:var(--sp-12)"><button class="modal-btn primary" onclick="saveRecordDetail(${idArg(id)})">保存修改</button></div><div class="modal-buttons" style="margin-top:var(--sp-8)"><button class="modal-btn danger" onclick="deleteRecord(${idArg(id)},'recordDetailModal')">删除记录</button></div></div>${interruptHtml}`;
  showModal('recordDetailModal');
  fillDetailTypeOptions(r);
  injectDetailPlanRow(r);
  renderGridPicker('detailStartEnergyPicker', r.startEnergy, 'green');
  renderGridPicker('detailStartMoodPicker', r.startMood, 'yellow');
  renderGridPicker('detailEndEnergyPicker', r.energy, 'green');
  renderGridPicker('detailEndMoodPicker', r.mood, 'yellow');
}
/* 记录详情里的「关联计划」行 —— **事后补挂**的入口。
   为什么需要：补记 / 自由专注产生的记录很可能没有 todoId
   （旧版本连字段都不写；就算写也只有「任务名精确匹配」这一条路，名字对不上就静默失联）。
   用户截图里那条「网站开发」就是这么一条：看着跟计划毫无关系。
   这里插一行下拉，把这些历史记录也能挂回计划上。
   实现上**动态插 DOM**（不改 openRecordDetail 里那段超长 innerHTML 串），
   锚点是「任务名称」那一行，插在它后面。 */
function injectDetailPlanRow(r) {
  const body = document.getElementById('recordDetailBody');
  const anchor = document.getElementById('detailTaskName');
  if (!body || !anchor) return;
  const wrap = anchor.closest ? anchor.closest('.setting-row') : null;
  const row = document.createElement('div');
  row.className = 'setting-row';
  const label = document.createElement('div');
  label.className = 'setting-label';
  label.textContent = '关联计划';
  const sel = document.createElement('select');
  sel.className = 'setting-input';
  sel.id = 'detailPlanId';
  sel.style.flex = '1';
  const opts = ['<option value="">不关联</option>'];
  const cur = r.todoId != null ? String(r.todoId) : '';
  let curInList = false;
  (appData.todos || []).forEach(function (t) {
    if (!t) return;
    if (String(t.id) === cur) curInList = true;
    opts.push(
      '<option value="' + escapeHtml(String(t.id)) + '">' +
      escapeHtml((t.title || '未命名') + (t.done ? '（已完成）' : '')) + '</option>'
    );
  });
  /* 计划被删过：当前关联的目标已不在 todos 里 —— 补一个只读项兜住，
     否则下拉会静默跳成「不关联」，用户一保存就把关联弄丢了。 */
  if (cur && !curInList) {
    opts.push(
      '<option value="' + escapeHtml(cur) + '">' +
      escapeHtml((r.planTitle || '原计划') + '（已删除）') + '</option>'
    );
  }
  sel.innerHTML = opts.join('');
  sel.value = cur;
  row.appendChild(label);
  row.appendChild(sel);
  if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(row, wrap.nextSibling);
  else body.insertBefore(row, body.firstChild);
}

function saveRecordDetail(id) {
  const r = appData.records.find(x => x.id == id || String(x.id) === String(id));
  if (!r) {
    showToast('❌ 找不到这条记录（id=' + id + '）');
    return;
  }
  r.taskName = document.getElementById('detailTaskName').value.trim() || '未命名任务';
  r.note = document.getElementById('detailNote').value.trim();
  const se = getGridValue('detailStartEnergyPicker');
  const sm = getGridValue('detailStartMoodPicker');
  r.startEnergy = se || null;
  r.startMood = sm || null;
  const e = getGridValue('detailEndEnergyPicker');
  const m = getGridValue('detailEndMoodPicker');
  r.energy = e || null;
  r.mood = m || null;
  /* 改类型：同一段时长下 pomos 跟着新类型重算，并按差值**对账**树积分与计划账

     金币与连击仍不追溯：那些是结算瞬间的存量，追不回也不该倒扣。 */
  const _typeSel = document.getElementById('detailRecordType');
  if (_typeSel && _typeSel.value && _typeSel.value !== r.type) {
    const _oldType = r.type;
    const _oldPomos = getPomos(r);
    r.type = _typeSel.value;
    r.pomos = calcPomos(r.effectiveSeconds || 0, r.type);
    adjustRecordRewards(r, _oldType, _oldPomos);
    updateTodayStats();
    updateRoundStats();
  }
  /* 关联计划的改挂 / 摘除：只改**这条记录自己的快照**。
     不回写计划的实际番茄账 —— 那块账在计时/补记当时就已经记过一次，
     这里再加减就是重复计（改类型同理，见上面的注释）。
     摘除关联（选「不关联」）会把快照字段一并清空，日志卡随之不再画归属行。 */
  const _planSel = document.getElementById('detailPlanId');
  if (_planSel) {
    const v = String(_planSel.value || '');
    const oldId = r.todoId != null ? String(r.todoId) : '';
    if (v !== oldId) {
      const t = findTodoByIdStr(v);
      r.todoId = t ? t.id : null;
      r.tag = t && t.tag ? t.tag : null;
      r.quad = t ? normQuad(t.quad) : null;
      r.planTitle = t ? t.title || null : null;
      r.planSubs = t ? snapshotPlanSubs(t, r.endTime) : null;
      /* 换了计划，原先「正在做的那一步」已不适用 → 一起清掉，不留在记录里误导 */
      r.subTitle = null;
      r.subId = null;
    }
  }
  /* 编辑即刷新 updatedAt：否则这条记录的时间戳仍停在三个月前，
     同步时会被判定为「服务端更新」而被覆盖，用户刚改的内容凭空消失。 */
  touchRecord(r);
  saveData();
  /* 编辑记录（任务名/心情/精力）不改变统计缓存键的任何分量，
     必须显式失效，否则任务聚合/心情曲线长期显示旧值直至下一条新记录 */
  invalidateStatsCache();
  renderLogs();
  closeModal('recordDetailModal');
  showToast('✅ 已保存');
}
