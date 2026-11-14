/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01e7_ui_stats.js 按域拆出（2026-11-14 · S3，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；JS 包只在新增文件边界多 1 个空语句（tools/group_split.py 的拼接符 "\n;\n"，长度不变）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01eU_ui_biography.js
 * 分组：ui
 * 职责：（见各域注释）
 * 功能：
 * 函数索引（TOC）：checkBiographyEvents/toggleBioHelp/applyBioSearch/toggleBioSort/setBioRange/bioRangeLabel/clearBioFilters/bioFilterActiveCount/bioSearchTokens/bioHighlight/turnBioPage/jumpBioPage（+9 更多）
 * ============================================================ */

const BIO_AUTO_OFF = true;
function checkBiographyEvents() {
/* —— 传记补记：把当前已达到、但传记列表里还没有对应条目的里程碑一次性补进去。
   只在第一次结算补，bioBackfillDone 落盘防重复补；
   day_10/day_20/mood/足迹 等无历史日期的特殊项不补，避免错日期 —— */
  if (!appData.bioBackfillDone) bioBackfillOnce(); /* 补记逻辑提顶层 helper */
  const rs = appData.rankSystem;
  const today = getTodayStr();
  const recs = appData.records || [];
  const total = bioTotalPomos(recs);
  const streak =
    appData.tree.streakHistory && appData.tree.streakHistory.length
      ? appData.tree.streakHistory[appData.tree.streakHistory.length - 1].streak || 0
      : 0;
  const todayCnt = countTomatoPoints(today);
  const stars = rs.stars || 0;
  const achN = (appData.unlockedAchievements || []).length;
  /* 首次运行只初始化去重标记，不补记历史里程碑——
     避免「之前已达成的 50/100 番茄、王者段位、连续7天」全部被记到更新当天 */
  if (!appData.bioInitDone) {
    bioInitFlags(); /* 首次初始化标记逻辑提顶层 helper（原 return 语义保留） */
    return;
  }
  const events = [];
  [1, 10, 50, 100, 500, 1000].forEach(function (n) {
    if (total >= n && !appData.bioTriggered['rec_' + n]) {
      appData.bioTriggered['rec_' + n] = true;
      const b = bioText('rec_' + n, { n: n });
      if (b) events.push(b);
    }
  });
  if (stars >= 1200 && !appData.bioTriggered['rank_传奇']) {
    appData.bioTriggered['rank_传奇'] = true;
    const b = bioText('rank_传奇', {});
    if (b) events.push(b);
  }
  if (stars >= 1000 && !appData.bioTriggered['rank_荣耀']) {
    appData.bioTriggered['rank_荣耀'] = true;
    const b = bioText('rank_荣耀', {});
    if (b) events.push(b);
  }
  if (stars >= 500 && !appData.bioTriggered['rank_王者']) {
    appData.bioTriggered['rank_王者'] = true;
    const b = bioText('rank_王者', {});
    if (b) events.push(b);
  }
  if (streak >= 30 && !appData.bioTriggered['streak_30']) {
    appData.bioTriggered['streak_30'] = true;
    const b = bioText('streak_30', {});
    if (b) events.push(b);
  }
  if (streak >= 7 && !appData.bioTriggered['streak_7']) {
    appData.bioTriggered['streak_7'] = true;
    const b = bioText('streak_7', {});
    if (b) events.push(b);
  }
  if (todayCnt >= 20 && !appData.bioTriggered['day_20']) {
    appData.bioTriggered['day_20'] = true;
    const b = bioText('day_20', {});
    if (b) events.push(b);
  }
  if (todayCnt >= 10 && !appData.bioTriggered['day_10']) {
    appData.bioTriggered['day_10'] = true;
    const b = bioText('day_10', {});
    if (b) events.push(b);
  }
  if (achN >= 15 && !appData.bioTriggered['ach_15']) {
    appData.bioTriggered['ach_15'] = true;
    const b = bioText('ach_15', {});
    if (b) events.push(b);
  }
  if (achN >= 5 && !appData.bioTriggered['ach_5']) {
    appData.bioTriggered['ach_5'] = true;
    const b = bioText('ach_5', {});
    if (b) events.push(b);
  }
  /* ★ 2026-11-14：从这里往下全是「会天天/每周触发」的条目
     （连续纪录刷新、单日纪录刷新、一周足迹、状态爆表、效率满分日）。
     用户明确要求「不要每天自动新增」，故整段停用；上面 rec_ 与 rank_ 里程碑是低频事件，保留。 */
  if (BIO_AUTO_OFF) {
    if (events.length) {
      events.forEach(function (b) {
        appData.biographies.unshift({ date: today, key: b.key, title: b.title, text: b.text, edited: false });
      });
      saveData();
      renderBioSection();
    }
    return;
  }
  /* 不天天记，只记「重要时刻」——
     连续纪录刷新（≥3 天破个人纪录）/ 单日纪录刷新（≥5 个破个人纪录）*/
  const bestStreak = appData.bioTriggered['streak_best'] || 0;
  if (streak >= 3 && streak > bestStreak) {
    appData.bioTriggered['streak_best'] = streak;
    const b = bioText('streak_best', { n: streak });
    if (b) events.push(b);
  }
  const bestDay = appData.bioTriggered['day_best'] || 0;
  if (todayCnt >= 5 && todayCnt > bestDay) {
    appData.bioTriggered['day_best'] = todayCnt;
    const b = bioText('day_best', { n: todayCnt });
    if (b) events.push(b);
  }
  if (streak >= 100 && !appData.bioTriggered['streak_100']) {
    appData.bioTriggered['streak_100'] = true;
    const b = bioText('streak_100', {});
    if (b) events.push(b);
  }
  /* 周期性足迹：每 7 天记一条「一周足迹」（不天天记，隔一周丰富传记） */
  const _lastFoot = appData.bioTriggered['footprint_date'] || '';
  const _lastFootTs = _lastFoot ? new Date(_lastFoot + 'T00:00:00').getTime() : 0;
  const _footGap = Math.floor((new Date(today + 'T00:00:00').getTime() - _lastFootTs) / DAY_MS);
  if (_footGap >= 7) {
    appData.bioTriggered['footprint_date'] = today;
    const _weekRecs = recs.filter(function (r) {
      return r.startTime >= new Date(today + 'T00:00:00').getTime() - 7 * DAY_MS;
    });
    const _weekPomos = _weekRecs.reduce(function (s, r) {
      return s + getPomos(r);
    }, 0);
    const _totalPomos = recs.reduce(function (s, r) {
      return s + getPomos(r);
    }, 0);
    const _footCount =
      (appData.biographies || []).filter(function (b) {
        return /^footprint_/.test(b.key);
      }).length + 1;
    const b = bioText('footprint', { week: _footCount, pomos: _weekPomos, total: _totalPomos, streak: streak });
    if (b) {
      b.key = 'footprint_' + today;
      if (b) events.push(b);
    }
  }
  /* —— 从海报汇总数据」 —— */
  const _C = getStatsCache();
  const _t0 = _C.byDate[today] || null;
  /* 状态爆表：今日电量或愉悦平均 ≥8（每天最多一条，用日期做 key） */
  if (_t0) {
    const _en = _t0.energyN ? _t0.energySum / _t0.energyN : 0;
    const _mo = _t0.moodN ? _t0.moodSum / _t0.moodN : 0;
    if ((_en >= 8 || _mo >= 8) && appData.bioTriggered['mood_high'] !== today) {
      appData.bioTriggered['mood_high'] = today;
      const b = bioText('mood_high', {});
      if (b) events.push(b);
    }
    /* 效率满分日：全天完整且 ≥3 个，零半个零未完成（首次达成记一条） */
    if (_t0.full >= 3 && _t0.half === 0 && _t0.incomplete === 0 && !appData.bioTriggered['eff_100']) {
      appData.bioTriggered['eff_100'] = true;
      const b = bioText('eff_100', {});
      if (b) events.push(b);
    }
  }
  /* 活跃天数里程碑 */
  const _activeN = _C.activeDays || 0;
  [50, 100, 200, 365].forEach(function (n) {
    if (_activeN >= n && !appData.bioTriggered['active_' + n]) {
      appData.bioTriggered['active_' + n] = true;
      const b = bioText('active_' + n, {});
      if (b) events.push(b);
    }
  });
  /* 完美周里程碑 */
  const _pw = _C.perfectWeekCount || 0;
  if (_pw >= 1 && !appData.bioTriggered['perfect_1']) {
    appData.bioTriggered['perfect_1'] = true;
    const b = bioText('perfect_1', {});
    if (b) events.push(b);
  }
  if (_pw >= 3 && !appData.bioTriggered['perfect_3']) {
    appData.bioTriggered['perfect_3'] = true;
    const b = bioText('perfect_3', {});
    if (b) events.push(b);
  }
  /* 上星里程碑（100/300/600，1000 交给 rank_荣耀） */
  [100, 300, 600].forEach(function (n) {
    if (stars >= n && !appData.bioTriggered['stars_' + n]) {
      appData.bioTriggered['stars_' + n] = true;
      const b = bioText('stars_' + n, {});
      if (b) events.push(b);
    }
  });
  if (events.length) {
    events.forEach(function (b) {
      appData.biographies.unshift({ date: today, key: b.key, title: b.title, text: b.text, edited: false });
    });
    saveData();
    renderBioSection();
  }
}
/* 传记说明折叠 */
function toggleBioHelp() {
  const body = document.getElementById('bioHelpBody');
  const arrow = document.getElementById('bioHelpArrow');
  if (!body) return;
  const showing = body.style.display === 'block';
  body.style.display = showing ? 'none' : 'block';
  if (arrow) arrow.textContent = showing ? '▸' : '▾';
}
let _bioSearchKey = '';
let _bioPage = 1;
let _bioSortAsc = false; /* true=旧→新 / false=新→旧（默认：最新在前） */
/* 时间范围筛选：''=全部时间 / 'YYYY-MM'=整月 / 'YYYY-MM-DD'=某一天。
   十年数据靠一个月下拉翻不动，导航交给日历弹窗（见 openBioCalendar）。 */
let _bioRange = '';
let _bioSourceFilter = 'all'; /* 来源筛选：all=全部 / bio=传记 / progress=日记「每日进步」/ gratitude=日记「感恩日记」 */
let _bioCalYear = 0,
  _bioCalMonth = 0,
  _bioCalJumpOpen = false;
/* 日历上打点用的计数（每次渲染时按当前关键词/来源重算） */
let _bioDayCount = {},
  _bioMonthCount = {},
  _bioLastCount = 0;
const BIO_PAGE_SIZE = 10;
function applyBioSearch() {
  const inp = document.getElementById('bioSearch');
  _bioSearchKey = inp ? inp.value : '';
  _bioPage = 1;
  renderBioSection();
}
/* 排序方向：只有一个按钮，点了就换头尾。依据固定为日期（来源有 Tab、字数没有意义） */
function toggleBioSort() {
  _bioSortAsc = !_bioSortAsc;
  _bioPage = 1;
  renderBioSection();
}
/* 时间范围（全部 / 某月 / 某天）—— 日历弹窗选完调这里 */
function setBioRange(range) {
  _bioRange = range || '';
  _bioPage = 1;
  renderBioSection();
}
/* 一句话说清当前看的是哪段（按钮文案 + 摘要行共用一份） */
function bioRangeLabel(range) {
  const r = range == null ? _bioRange : range;
  if (!r) return '全部时间';
  if (r.length === 7) return r.slice(0, 4) + '年' + Number(r.slice(5, 7)) + '月';
  if (r.length === 10) return r;
  return '全部时间';
}
/* 一键清空全部筛选（关键词/时间/方向/来源）—— 「筛选」用过以后没有回头路很难受 */
function clearBioFilters() {
  _bioSearchKey = '';
  _bioRange = '';
  _bioSortAsc = false;
  _bioSourceFilter = 'all';
  _bioPage = 1;
  _bioCalJumpOpen = false;
  renderBioSection();
}
function bioFilterActiveCount() {
  return (
    (_bioSearchKey ? 1 : 0) +
    (_bioRange ? 1 : 0) +
    (_bioSortAsc ? 1 : 0) +
    (_bioSourceFilter !== 'all' ? 1 : 0)
  );
}
/* 搜索词按空格拆开，每个词都要出现（AND）—— 十年后想找「2025 报名」这种组合词时有用 */
function bioSearchTokens() {
  return String(_bioSearchKey || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}
/* 把命中的词在正文里标出来（先转义再标，不会把用户输入的 < 当标签）。
   十年翻旧账，光看到"找到 3 条"不够，得一眼看见命中的是哪儿。 */
function bioHighlight(raw, tokens) {
  let s = escapeHtml(String(raw == null ? '' : raw));
  if (!tokens || !tokens.length) return s;
  const pats = tokens
    .map(function (t) {
      return escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .filter(Boolean);
  if (!pats.length) return s;
  try {
    s = s.replace(new RegExp('(' + pats.join('|') + ')', 'gi'), '<mark class="bio-hl">$1</mark>');
  } catch (e) {
    if (window.__silent) window.__silent(e, '01e7:bioHighlight');
  }
  return s;
}
function turnBioPage(delta) {
  _bioPage = Math.max(1, _bioPage + delta);
  renderBioSection();
}
function jumpBioPage(p) {
  _bioPage = parseInt(p, 10) || 1;
  renderBioSection();
}
function renderBioSection() {
  const mainBox = document.getElementById('bioSection');
  const list = appData.biographies || [];
  if (!mainBox) return;
  /* 搜索框是「边打字边筛」的：这个函数会整块重建 innerHTML，输入框本身也被换掉 ——
     不把焦点和光标位置捞回来，手机上是「敲一个字键盘就收、光标跳到开头」。
     备份 → 重建 → 还原，三行。判据用 id，不猜用户点在哪。 */
  const _ae = document.activeElement;
  const _keepFocus = !!_ae && _ae.id === 'bioSearch';
  const _caret = _keepFocus ? _ae.selectionStart : 0;
  const _hasProgress = Object.keys(appData.diaries || {}).some(function (d) {
    const p = appData.diaries[d] && appData.diaries[d].review && appData.diaries[d].review.progress;
    return p && String(p).trim();
  });
  /* 只有感恩日记、没有传记/每日进步时，这一块也得显示出来 */
  const _hasGratitude = Object.keys(appData.diaries || {}).some(function (d) {
    const g = appData.diaries[d] && appData.diaries[d].gratitude;
    return g && Array.isArray(g.items) && g.items.some(function (x) { return String(x || '').trim(); });
  });
  if (!list.length && !_hasProgress && !_hasGratitude) {
    mainBox.style.display = 'none';
    return;
  }
  /* 传记条目的另一个来源：日记「每日进步」(diary.review.progress)。
     它不是独立的 biographies 记录，而是从日记派生 —— 所以统一成同一种「条目」形状，
     只靠 source 区分，筛选/搜索/排序/分页全部共用一套逻辑，不各写一份。 */
  /* 历史条目全部保留展示 —— 用户要求的是「别再自动新增」，不是「把过去删掉」。
     checkBiographyEvents 已停用（BIO_AUTO_OFF），所以这里只会看到旧数据和成就解锁事件。 */
  const bioItems = list.map(function (b, i) {
    return { source: 'bio', date: b.date || '', title: b.title || '', text: b.text || '', bioIndex: i };
  });
  const progItems = [];
  Object.keys(appData.diaries || {}).forEach(function (date) {
    const p = appData.diaries[date] && appData.diaries[date].review && appData.diaries[date].review.progress;
    if (p && String(p).trim()) progItems.push({ source: 'progress', date: date, title: '每日进步', text: String(p).trim(), bioIndex: -1 });
  });
  /* 感恩日记派生：一天一条（当天几条短句并成一句），与「每日进步」完全同构 ——
     同一套筛选/搜索/排序/分页，只是 source 不同。 */
  const gratItems = [];
  Object.keys(appData.diaries || {}).forEach(function (date) {
    const g = appData.diaries[date] && appData.diaries[date].gratitude;
    const arr = g && Array.isArray(g.items)
      ? g.items.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
      : [];
    if (arr.length) gratItems.push({ source: 'gratitude', date: date, title: '感恩日记', text: arr.join(' · '), bioIndex: -1 });
  });
  /* 日记整卡：一天一条，把当天写过的字段全并进一张卡。
     与「进步」「感恩」的关系是「按天 / 按条」两种切法，内容不重不漏。 */
  const diaryItems = [];
  Object.keys(appData.diaries || {}).forEach(function (date) {
    const d = appData.diaries[date] || {};
    const r = d.review || {};
    const segs = [];
    const put = function (ic, label, v) { if (v && String(v).trim()) segs.push(ic + ' ' + label + '：' + String(v).trim()); };
    put('🌱', '进步', r.progress);
    put('🪨', '不足', r.shortcomings);
    put('🔧', '改进', r.improvements);
    put('✋', '该停止', r.stop);
    put('📝', '其他', r.other);
    const gi = (d.gratitude && Array.isArray(d.gratitude.items) ? d.gratitude.items : [])
      .map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    if (gi.length) segs.push('🙏 感恩：' + gi.join(' · '));
    const fb = d.feedback || {};
    if (fb.sleepTime || fb.wakeTime) {
      segs.push('😴 睡眠：' + (fb.sleepTime || '—') + ' 睡 / ' + (fb.wakeTime || '—') + ' 起');
    }
    if (segs.length) diaryItems.push({ source: 'diary', date: date, title: '日记', text: segs.join('\n'), bioIndex: -1 });
  });
  let pool = bioItems.concat(progItems).concat(gratItems);
  if (_bioSourceFilter === 'diary') pool = diaryItems;
  else if (_bioSourceFilter === 'bio') pool = bioItems;
  else if (_bioSourceFilter === 'progress') pool = progItems;
  else if (_bioSourceFilter === 'gratitude') pool = gratItems;
  /* 关键词：空格分隔 = 每个词都要出现；除了标题/正文，也认日期（打「2025」= 那年全部，
     打「2025-03」= 那个月）—— 十年后凭记忆只记得"大概是那年春天"时用得上。 */
  const _tokens = bioSearchTokens();
  let filtered = pool;
  if (_tokens.length) {
    filtered = filtered.filter(function (b) {
      const hay = ((b.title || '') + ' ' + (b.text || '') + ' ' + (b.date || '')).toLowerCase();
      return _tokens.every(function (t) {
        return hay.indexOf(t) >= 0;
      });
    });
  }
  /* 日历上的点数 = 「当前关键词/来源筛完之后，每天有多少条」—— 先记下来，再按日期筛。
     这样在日历里能看到"哪几天写过"，点进去不会是空的。 */
  _bioDayCount = {};
  _bioMonthCount = {};
  filtered.forEach(function (b) {
    if (!b.date) return;
    _bioDayCount[b.date] = (_bioDayCount[b.date] || 0) + 1;
    const m = b.date.slice(0, 7);
    _bioMonthCount[m] = (_bioMonthCount[m] || 0) + 1;
  });
  /* 时间范围：'YYYY-MM' 前缀匹配整月 / 'YYYY-MM-DD' 精确到天 */
  if (_bioRange) {
    filtered = filtered.filter(function (b) {
      return b.date && b.date.indexOf(_bioRange) === 0;
    });
  }
  /* 排序：只按日期，方向单独一个按钮。
     （旧版把「依据 / 来源 / 字数」和方向挤在两个下拉里，打开就是一张看不懂的选项表；
       来源有上面的 Tab，字数排序对翻旧账没有意义，一起删掉。） */
  filtered = filtered.slice().sort(function (a, b) {
    const r = (a.date || '').localeCompare(b.date || '');
    return _bioSortAsc ? r : -r;
  });
  _bioLastCount = filtered.length;
  /* 分页：传记主 Tab 每页 10 条 */
  const totalPages = Math.max(1, Math.ceil(filtered.length / BIO_PAGE_SIZE));
  if (_bioPage > totalPages) _bioPage = totalPages;
  const pageItems = filtered.slice((_bioPage - 1) * BIO_PAGE_SIZE, _bioPage * BIO_PAGE_SIZE);
  const cardOf = function (b, gi, uid) {
    /* 日记派生的条目（「每日进步」「感恩日记」）不可直接编辑 —— 它们是日记的一部分，
       改为给一个「去日记」入口，编辑权留在日记页，避免两处写入打架。 */
    const isProgress = b.source === 'progress';
    const isGratitude = b.source === 'gratitude';
    const isDiaryCard = b.source === 'diary';
    const isDiaryDerived = isProgress || isGratitude || isDiaryCard;
    const headBadge = isProgress
      ? '<span style="font-size:var(--fs-caption);font-weight:700;color: var(--primary-ink);background:var(--surface-2);border-radius:var(--radius-full);padding:1px var(--sp-8);">🌱 每日进步</span>'
      : isGratitude
        ? '<span style="font-size:var(--fs-caption);font-weight:700;color: var(--primary-ink);background:var(--surface-2);border-radius:var(--radius-full);padding:1px var(--sp-8);">🙏 感恩日记</span>'
        : isDiaryCard
          ? '<span style="font-size:var(--fs-caption);font-weight:700;color: var(--primary-ink);background:var(--surface-2);border-radius:var(--radius-full);padding:1px var(--sp-8);">📔 当天全部</span>'
          : '';
    const actBtn = isDiaryDerived
      ? '<button class="btn-small" style="padding:var(--sp-2) var(--sp-10);font-size:var(--fs-caption);" onclick="selectDiaryDate(\'' +
        b.date +
        '\')">📔 去日记</button>'
      : '<button class="btn-small" style="padding:var(--sp-2) var(--sp-10);font-size:var(--fs-caption);" onclick="editBio(' +
        gi +
        ')">✏️ 编辑</button>';
    /* 长文先折成 6 行，要看再展开 —— 十几年攒下来的正文一条条全铺开会翻不动。
       展开只改这一张卡片的 style，不重新渲染整个列表（不会把搜索框弄失焦）。 */
    const _tid = 'bioText' + uid;
    const _long = String(b.text || '').length > 180;
    return (
      '<div style="background:var(--card);border:1px solid var(--border);border-left:4px solid var(--primary);border-radius:var(--radius-input);padding:var(--sp-10) var(--sp-14);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:var(--sp-8);margin-bottom:var(--sp-4);">' +
      '<span style="font-size:var(--fs-caption);color:var(--text-light);">' +
      b.date +
      '</span>' +
      '<span style="display:flex;gap:var(--sp-8);align-items:center;flex-shrink:0;">' +
      actBtn +
      '</span></div>' +
      '<div style="font-size:var(--fs-body);font-weight:800;display:flex;align-items:center;gap:var(--sp-8);flex-wrap:wrap;margin-bottom:var(--sp-4);">' +
      bioHighlight(b.title, _tokens) +
      headBadge +
      '</div>' +
      '<div id="' +
      _tid +
      '" style="font-size:var(--fs-body);line-height:1.7;color:var(--text);' +
      (_long ? 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden;' : '') +
      '">' +
      bioHighlight(b.text, _tokens) +
      '</div>' +
      (_long
        ? '<button class="btn-small" onclick="toggleBioText(\'' +
          _tid +
          '\',this)" style="margin-top:var(--sp-6);padding:var(--sp-2) var(--sp-10);font-size:var(--fs-caption);">展开全文 ▾</button>'
        : '') +
      '</div>'
    );
  };
  /* 长文展开/收起：直接改 DOM，不重画（重画会丢滚动位置与搜索框焦点） */
  window.toggleBioText = function (id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    const folded = el.style.webkitLineClamp === '6';
    el.style.webkitLineClamp = folded ? 'unset' : '6';
    el.style.display = folded ? 'block' : '-webkit-box';
    el.style.overflow = folded ? 'visible' : 'hidden';
    if (btn) btn.textContent = folded ? '收起 ▴' : '展开全文 ▾';
  };
  if (mainBox) {
    /* 头部：标题 + 总数（来源条数在下面的 Tab 上已经有了，不再重复一遍） */
    const headRow =
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-8);margin-bottom:var(--sp-10);flex-wrap:wrap;">' +
      '<div class="section-title" style="margin-bottom:0;">📖 我的专注传记</div>' +
      '<span style="font-size:var(--fs-caption);color:var(--text-light);">共 <b style="color:var(--text);">' +
      pool.length +
      '</b> 条</span></div>';
    const searchBox =
      '<input id="bioSearch" value="' +
      escapeHtml(_bioSearchKey || '') +
      '" placeholder="🔍 搜索标题、内容或年份（多个词用空格隔开）" oninput="applyBioSearch()" style="width:100%;box-sizing:border-box;margin-bottom:var(--sp-8);padding:var(--sp-8) var(--sp-10);border:1px solid var(--border-strong);border-radius:var(--radius);font-size:var(--fs-title);background:var(--card);color:var(--text);font-family:inherit;">';
    /* 一排就三个控件，全部一眼能懂：
       📅 时间（点开是日历，十年数据靠翻月份下拉等于没做导航）
       ↓ 顺序（就一个按钮，点一下换头尾）
       ✕ 清除（只在有条件时出现） */
    const _fActive = bioFilterActiveCount();
    const dateBtn =
      '<button class="btn-small" onclick="openBioCalendar()" title="点开日历，按年 / 月 / 日查看" style="padding:var(--sp-6) var(--sp-10);font-size:var(--fs-note);' +
      (_bioRange ? 'border-color:var(--primary);color: var(--primary-ink);font-weight:700;' : '') +
      '">📅 ' +
      bioRangeLabel() +
      ' ▾</button>';
    const sortBtn =
      '<button class="btn-small" onclick="toggleBioSort()" title="点一下换成另一种顺序" style="padding:var(--sp-6) var(--sp-10);font-size:var(--fs-note);">' +
      (_bioSortAsc ? '↑ 最早在前' : '↓ 最新在前') +
      '</button>';
    const filterRow =
      '<div style="display:flex;gap:var(--sp-8);align-items:center;flex-wrap:wrap;margin-bottom:var(--sp-10);">' +
      dateBtn +
      sortBtn +
      (_fActive
        ? '<button class="btn-small" onclick="clearBioFilters()" title="清空关键词/时间/顺序/来源" style="padding:var(--sp-6) var(--sp-10);font-size:var(--fs-note);color:var(--danger);">✕ 清除</button>'
        : '') +
      '</div>';
    /* 当前条件的一句话摘要：说清「现在看的是什么」，不写只有自己懂的行话 */
    const _sumBits = [];
    if (_bioRange) _sumBits.push(bioRangeLabel());
    if (_tokens.length) _sumBits.push('关键词「' + _bioSearchKey.trim() + '」');
    if (_bioSortAsc) _sumBits.push('最早在前');
    if (_bioSourceFilter !== 'all') {
      const _srcName = { diary: '日记', bio: '传记', progress: '每日进步', gratitude: '感恩日记' }[_bioSourceFilter] || _bioSourceFilter;
      _sumBits.push('只看' + _srcName);
    }
    const countLine = _sumBits.length
      ? '<div style="font-size:var(--fs-caption);color:var(--text-light);margin:0 0 var(--sp-8);">🔎 ' +
        escapeHtml(_sumBits.join(' · ')) +
        ' —— 找到 <b style="color:var(--text);">' +
        filtered.length +
        '</b> 条</div>'
      : '';
    /* 一条都没有时说清是「这天没写」还是「搜不到」，并给一个出口 —— 空白列表最让人困惑 */
    const emptyHtml =
      filtered.length || !(_sumBits.length || pool.length)
        ? ''
        : '<div style="text-align:center;padding:var(--sp-20) var(--sp-10);color:var(--text-light);font-size:var(--fs-note);line-height:1.8;">' +
          (pool.length ? '这一范围里没有内容' : '还没有传记') +
          '<br>' +
          (pool.length
            ? '<button class="btn-small" onclick="clearBioFilters()" style="margin-top:var(--sp-8);padding:var(--sp-6) var(--sp-12);font-size:var(--fs-note);">看全部时间</button>'
            : '') +
          '</div>';
    /* 来源筛选：全部 / 传记 / 每日进步 / 感恩（日记派生）。
       每个按钮带上条数 —— 不给条数的话，"感恩 0 条"和"这个按钮没生效"看起来一模一样。 */
    const _srcBtn = function (key, label, full, n) {
      const on = _bioSourceFilter === key;
      return (
        '<button class="seg-btn' +
        (on ? ' active' : '') +
        '" title="' +
        full +
        '" onclick="setBioSourceFilter(\'' +
        key +
        '\')">' +
        label +
        ' <span style="opacity:.7;font-weight:600;">' +
        n +
        '</span></button>'
      );
    };
    const sourceSeg =
      '<div class="seg-group" style="margin-bottom:var(--sp-8);">' +
      _srcBtn('all', '全部', '全部来源', pool.length) +
      _srcBtn('diary', '📔 日记', '按天看当天写的全部内容', diaryItems.length) +
      _srcBtn('progress', '🌱 进步', '日记里的「每日进步」', progItems.length) +
      _srcBtn('gratitude', '🙏 感恩', '日记里的「感恩日记」', gratItems.length) +
      '</div>';
    let pagHtml = '';
    if (totalPages > 1) {
      let bioPageOpts = '';
      for (let p = 1; p <= totalPages; p++) {
        bioPageOpts +=
          '<option value="' + p + '"' + (p === _bioPage ? ' selected' : '') + '>第 ' + p + ' 页</option>';
      }
      pagHtml =
        '<div style="display:flex;justify-content:center;align-items:center;gap:var(--sp-8);margin-top:var(--sp-12);">' +
        '<button class="btn-small" onclick="turnBioPage(-1)" ' +
        (_bioPage <= 1 ? 'disabled' : '') +
        '>‹ 上一页</button>' +
        '<select onchange="jumpBioPage(this.value)" title="跳转到第几页" style="padding:var(--sp-4) var(--sp-8); border:2px solid var(--primary); border-radius:var(--radius-sm); font-size:var(--fs-body); font-weight:700; color: var(--primary-ink); background:var(--card); cursor:pointer;">' +
        bioPageOpts +
        '</select>' +
        '<span style="font-size:var(--fs-body);color:var(--text-light);">/ ' +
        totalPages +
        ' 页</span>' +
        '<button class="btn-small" onclick="turnBioPage(1)" ' +
        (_bioPage >= totalPages ? 'disabled' : '') +
        '>下一页 ›</button>' +
        '</div>';
    }
    mainBox.style.display = 'block';
    mainBox.innerHTML =
      headRow +
      sourceSeg +
      searchBox +
      filterRow +
      countLine +
      emptyHtml +
      '<div style="display:flex;flex-direction:column;gap:var(--sp-10);">' +
      pageItems
        .map(function (b, ui) {
          return cardOf(b, b.bioIndex, ui);
        })
        .join('') +
      '</div>' +
      pagHtml;
    /* 还原搜索框焦点与光标位置（见函数头的说明） */
    if (_keepFocus) {
      const _ns = document.getElementById('bioSearch');
      if (_ns) {
        try {
          _ns.focus({ preventScroll: true });
          const _pos = Math.min(_caret || 0, _ns.value.length);
          _ns.setSelectionRange(_pos, _pos);
        } catch (e) { if (window.__silent) window.__silent(e, '01e7:renderBioSection'); }
      }
    }
  }
}
function setBioSourceFilter(key) {
  _bioSourceFilter = key === 'diary' || key === 'bio' || key === 'progress' || key === 'gratitude' ? key : 'all';
  _bioPage = 1;
  renderBioSection();
}
/* ================= 传记日历（年 / 月 / 日定位） =================
   十年数据的关键不是"分页够多"，而是**能直接跳到想看的那段**：
   点标题换年、12 个月格（带条数）、有内容的日子打点，点一下只看那天。 */
function openBioCalendar() {
  const d = _bioRange ? new Date(Number(_bioRange.slice(0, 4)), _bioRange.length > 4 ? Number(_bioRange.slice(5, 7)) - 1 : 0, 1) : new Date();
  _bioCalYear = isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  _bioCalMonth = isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth();
  _bioCalJumpOpen = false;
  renderBioCalendar();
  showModal('bioCalModal');
}
function changeBioCalMonth(d) {
  _bioCalMonth += Number(d) || 0;
  if (_bioCalMonth < 0) {
    _bioCalMonth = 11;
    _bioCalYear--;
  } else if (_bioCalMonth > 11) {
    _bioCalMonth = 0;
    _bioCalYear++;
  }
  renderBioCalendar();
}
function changeBioCalYear(d) {
  _bioCalYear += Number(d) || 0;
  renderBioCalendar();
}
function toggleBioCalJump() {
  _bioCalJumpOpen = !_bioCalJumpOpen;
  renderBioCalendar();
}
function bioCalJumpYear(y) {
  _bioCalYear = Number(y) || _bioCalYear;
  renderBioCalendar();
}
function bioCalJumpMonth(m) {
  _bioCalMonth = m - 1;
  _bioCalJumpOpen = false;
  renderBioCalendar();
}
function renderBioCalendar() {
  const title = document.getElementById('bioCalTitle');
  const grid = document.getElementById('bioCalGrid');
  if (!title || !grid) return;
  title.textContent = _bioCalYear + '年' + (_bioCalMonth + 1) + '月';
  const jump = document.getElementById('bioCalJump');
  if (jump) jump.style.display = _bioCalJumpOpen ? 'block' : 'none';
  const jy = document.getElementById('bioCalJumpYear');
  if (jy) jy.textContent = _bioCalYear + '年';
  /* 有内容的年份直接列出来（按年份倒序）——「上年」按钮一年一次，
     用了十几年的人要按十几次；这里一眼就点到想去的年。 */
  const jyh = document.getElementById('bioCalJumpYears');
  if (jyh) {
    const _years = Object.keys(_bioMonthCount)
      .map(function (k) {
        return Number(k.slice(0, 4));
      })
      .filter(function (y) {
        return y;
      })
      .filter(function (y, i, a) {
        return a.indexOf(y) === i;
      })
      .sort(function (a, b) {
        return b - a;
      });
    jyh.innerHTML = _years.length
      ? _years
          .map(function (y) {
            return (
              '<button class="cal-jump-btn" style="' +
              (y === _bioCalYear ? 'border-color:var(--primary);color: var(--primary-ink);font-weight:800;' : '') +
              '" onclick="bioCalJumpYear(' +
              y +
              ')">' +
              y +
              '</button>'
            );
          })
          .join('')
      : '<span style="font-size:var(--fs-caption);color:var(--text-light);">还没有任何内容</span>';
  }
  const jm = document.getElementById('bioCalJumpMonths');
  if (jm) {
    let mh = '';
    for (let m = 1; m <= 12; m++) {
      const key = _bioCalYear + '-' + String(m).padStart(2, '0');
      const n = _bioMonthCount[key] || 0;
      mh +=
        '<button class="cal-jump-m' +
        (m === _bioCalMonth + 1 ? ' on' : '') +
        '" style="' +
        (n ? '' : 'opacity:.45;') +
        '" onclick="bioCalJumpMonth(' +
        m +
        ')" title="' +
        (n ? n + ' 条' : '无内容') +
        '">' +
        m +
        (n ? '<span style="display:block;font-size:var(--fs-micro);font-weight:600;">' + n + '</span>' : '') +
        '</button>';
    }
    jm.innerHTML = mh;
  }
  const startDow = new Date(_bioCalYear, _bioCalMonth, 1).getDay();
  const dim = new Date(_bioCalYear, _bioCalMonth + 1, 0).getDate();
  const today = getTodayStr();
  let html = '';
  ['日', '一', '二', '三', '四', '五', '六'].forEach(function (x) {
    html += '<div style="text-align:center;font-size:var(--fs-body);color:var(--text-light);font-weight:700;">' + x + '</div>';
  });
  for (let i = 0; i < startDow; i++) html += '<div></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = _bioCalYear + '-' + String(_bioCalMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const n = _bioDayCount[ds] || 0;
    const isToday = ds === today;
    const isSel = ds === _bioRange;
    html +=
      '<div onclick="pickBioDate(\'' +
      ds +
      '\')" style="text-align:center;padding:var(--sp-6) 0;border-radius:var(--radius-sm);cursor:pointer;font-size:var(--fs-title);' +
      (n ? 'background:rgba(232,93,58,0.12);color: var(--primary-ink);font-weight:700;' : 'color:var(--text);opacity:' + (n ? 1 : 0.55) + ';') +
      (isToday ? 'border:1px solid var(--primary);' : '') +
      (isSel ? 'outline:2px solid var(--primary);' : '') +
      '">' +
      d +
      (n ? '<span style="display:block;font-size:var(--fs-micro);color: var(--primary-ink);">' + n + '</span>' : '') +
      '</div>';
  }
  grid.innerHTML = html;
}
