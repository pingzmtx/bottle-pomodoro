/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01e7_ui_stats.js 按域拆出（2026-11-14 · S3，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；JS 包只在新增文件边界多 1 个空语句（tools/group_split.py 的拼接符 "\n;\n"，长度不变）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01eV_ui_biocal_map.js
 * 分组：ui
 * 职责：年度专注地图（365 天热力图，新增）；renderYearHeatmap 年度热力图区块拆分
 * 功能：
 *   - 年度专注地图（365 天热力图，新增）
 *   - renderYearHeatmap 年度热力图区块拆分
 * 函数索引（TOC）：pickBioDate/bioCalAll/bioCalToday/editBio/saveBioEdit/toggleGhostEnabled/renderEasyModeTag/maybeShowCareModal/enableEasyMode/dismissCareModal/showLevelUpToast/renderGhostBar（+8 更多）
 * ============================================================ */

function pickBioDate(ds) {
  setBioRange(ds);
  closeModal('bioCalModal');
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
  showToast('📅 ' + ds + ' · 找到 ' + (typeof _bioLastCount === 'number' ? _bioLastCount : 0) + ' 条');
}
function bioCalAll() {
  setBioRange('');
  closeModal('bioCalModal');
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
}
function bioCalToday() {
  pickBioDate(getTodayStr());
}
let _bioEditIdx = -1;
function editBio(i) {
  const list = appData.biographies || [];
  if (!list[i]) return;
  _bioEditIdx = i;
  const ta = document.getElementById('bioEditText');
  if (ta) ta.value = list[i].text;
  const t = document.getElementById('bioEditTitle');
  if (t) t.textContent = '✏️ 编辑 · ' + list[i].title;
  showModal('bioEditModal');
}
function saveBioEdit() {
  const ta = document.getElementById('bioEditText');
  const list = appData.biographies || [];
  if (_bioEditIdx < 0 || !list[_bioEditIdx]) return;
  const v = ta ? ta.value.trim() : '';
  if (!v) {
    showToast('内容不能为空');
    return;
  }
  list[_bioEditIdx].text = v;
  list[_bioEditIdx].edited = true;
  saveData();
  closeModal('bioEditModal');
  renderBioSection();
  showToast('✅ 传记已更新');
}
function toggleGhostEnabled() {
  const cb = document.getElementById('setGhostEnabled');
  if (!cb) return;
  appData.settings.ghostEnabled = cb.checked;
  saveData();
  renderGhostBar();
  showToast(cb.checked ? '👻 已显示「过去的自己」对比条' : '🙈 已隐藏「过去的自己」对比条');
}
function renderEasyModeTag() {
  const tag = document.getElementById('easyModeTag');
  if (!tag) return;
  tag.style.display = isEasyModeActive() ? 'inline' : 'none';
}
function maybeShowCareModal() {
  if (isEasyModeActive()) return;
  const today = getTodayStr();
  if (appData.lastCareModalDate === today) return;
  if (!checkCareNeeded()) return;
  appData.lastCareModalDate = today;
  saveData();
  const modal = document.getElementById('careModal');
  if (modal) modal.classList.add('show');
}
function enableEasyMode() {
  appData.rankSystem.easyModeUntil = getTodayStr();
  appData.rankSystem.easyModeBonusUsed = false;
  appData.lastCareModalDate = getTodayStr();
  saveData();
  const modal = document.getElementById('careModal');
  if (modal) modal.classList.remove('show');
  showToast(
    '🍃 轻松模式已开启：番茄时长减半（档位卡已显示实际时长），开启后第一次满 10 分钟的番茄按完整🍅计入（今日任务的星星⭐照拿，仅一次）！'
  );
  renderRankSystem();
  renderTimerRankStrip();
  /* 档位卡时长显示跟着减半，避免「点 25 分钟实际跑 15 分钟」的歧义 */
  renderDifficultyPicker();
  renderDurationSuggestion();
  updateTimerDisplay();
}
function dismissCareModal() {
  const modal = document.getElementById('careModal');
  if (modal) modal.classList.remove('show');
}
/* 通用升级轻提示：段位子段位 + 专注段数共用 */
function showLevelUpToast(icon, line1, line2, color, duration) {
  const el = document.getElementById('subRankUp');
  if (!el) return;
  document.getElementById('subRankUpIcon').textContent = icon || '🎖️';
  const txt = document.getElementById('subRankUpText');
  txt.innerHTML =
    line1 + (line2 ? '<br><span style="font-size:var(--fs-note);font-weight:600;opacity:.85;">' + line2 + '</span>' : '');
  txt.style.color = color || 'var(--primary)';
  el.classList.add('show');
  if (window._subRankTimer) clearTimeout(window._subRankTimer);
  window._subRankTimer = setTimeout(function () {
    el.classList.remove('show');
  }, duration || 2400);
}
function renderGhostBar() {
  const boxes = [document.getElementById('ghostBar'), document.getElementById('timerGhostBox')].filter(Boolean);
  if (!boxes.length) return;
  if (!isGhostEnabled()) {
    boxes.forEach(function (b) {
      b.style.display = 'none';
    });
    return;
  }
  const today = getTodayStr();
  if (appData.ghostBeatDate !== today) {
    appData.ghostBeatDate = today;
    appData.ghostBeat = false;
    appData.ghostHalf = false;
  }
  const g = getGhostStats();
  const todayFull = getTodayEffectiveFull();
  /* 没有历史数据：显示引导条，让幽灵功能始终可见（而不是消失） */
  if (g.value <= 0) {
    const guideHtml =
      '<div style="display:flex;align-items:flex-start;gap:var(--sp-8);font-size:var(--fs-note);color:var(--text-light);background:var(--surface-2);border:0;border-left:2px solid var(--hairline);border-radius:var(--radius-sm);padding:var(--sp-10) var(--sp-12);margin-top:var(--sp-8);line-height:1.6;">' +
      '<span style="font-size:var(--fs-title);">👻</span>' +
      '<span>过去的自己：每天的专注都会留下印记。某一天，你会和过去某天的自己重逢——看看那时的你走了多远。</span>' +
      '</div>';
    boxes.forEach(function (b) {
      b.style.display = 'block';
      b.innerHTML = guideHtml;
    });
    return;
  }
  const pct = Math.min(100, Math.round((todayFull / g.value) * 100));
  const leading = todayFull > g.value;
  /* 中性化：不渲染任何「落后」字眼，超过也只是让今日数字变绿（惊喜留给孩子庆祝） */
  const barHtml =
    '<div style="display:flex;justify-content:space-between;font-size:var(--fs-note);margin:var(--sp-6) 0 var(--sp-2);">' +
    '<span style="color:var(--text-light);">👻 ' +
    g.label +
    '：' +
    fmtTomatoNum(g.value) +
    ' 个</span>' +
    '<span style="' +
    (leading ? 'color: var(--green-ink);font-weight:800;' : 'color:var(--text);') +
    '">今日 ' +
    fmtTomatoNum(todayFull) +
    ' 个</span>' +
    '</div>' +
    '<div style="position:relative;height:8px;background:var(--border);border-radius:var(--radius-xs);">' +
    '<div style="position:absolute;left:0;top:0;bottom:0;width:' +
    pct +
    '%;background:var(--primary);border-radius:var(--radius-xs);opacity:.85;"></div>' +
    '<div style="position:absolute;left:' +
    pct +
    '%;top:-3px;bottom:-3px;width:2px;background:var(--green);border-radius:var(--radius-xs);"></div>' +
    '</div>';
  boxes.forEach(function (b) {
    b.style.display = 'block';
    b.innerHTML = barHtml;
  });
  /* 里程碑阶梯（每天各一次）：50% 温和鼓励 → 100% 大字庆祝，任何一天都有正反馈 */
  if (!appData.ghostHalf && todayFull >= g.value * 0.5 && todayFull < g.value) {
    appData.ghostHalf = true;
    saveData();
    let hl;
    if (g.label.indexOf('年今日') >= 0) hl = '去年今日';
    else if (g.label === '昨天') hl = '昨天的你';
    else hl = '历史水平';
    setTimeout(function () {
      showToast('🌿 已到' + hl + '的一半，状态不错！');
    }, 400);
  }
  if (leading && !appData.ghostBeat) {
    appData.ghostBeat = true;
    saveData();
    setTimeout(function () {
      ghostFlash(g.label);
    }, 400);
  }
}
function ghostFlash(label) {
  const el = document.getElementById('ghostFlash');
  if (!el) return;
  /* 按幽灵类型生成顺口文案：年同比 → 「超越一年前的自己」；历史最佳 → 「打破历史最佳」 */
  let msg;
  if (label.indexOf('年今日') >= 0) msg = '👻 你超越了一年前的自己！';
  else if (label === '昨天') msg = '👻 你超越了昨天的自己！';
  else msg = '👻 你超越了过去的自己！';
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function () {
    el.classList.remove('show');
  }, 2600);
}
/* 年度多维度分析折叠开关 */
let _yearAnaOpen = false;
function toggleYearAnalysis() {
  _yearAnaOpen = !_yearAnaOpen;
  const body = document.getElementById('yearAnaBody');
  const arrow = document.getElementById('yearAnaArrow');
  if (body) body.style.display = _yearAnaOpen ? 'block' : 'none';
  if (arrow) arrow.textContent = _yearAnaOpen ? '▾' : '▸';
}
/* ===== 年度专注地图（365 天热力图，新增） ===== */
/* 年度热力图：把「当前月(16号所在周)」对准视窗中心的稳健版。
   折叠/懒加载场景下渲染时容器可能是 0 宽（居中必然失败），
   所以额外挂 ResizeObserver：一旦容器真正可见或有尺寸变化（展开查看更多/旋转屏幕），自动重新居中。 */
function centerYearHeat() {
  try {
    const b = document.getElementById('yearHeatmapContainer');
    if (!b || !b.scrollWidth) return;
    if (b.scrollWidth <= b.clientWidth + 2) return; /* 内容不溢出：整年都在视野里，无需滚动 */
    const cur = new Date();
    let s0 = new Date(cur.getFullYear(), 0, 1);
    while (s0.getDay() !== 0) s0.setDate(s0.getDate() - 1);
    const mid = new Date(cur.getFullYear(), cur.getMonth(), 16);
    const wi = Math.floor((mid - s0) / (7 * DAY_MS)); /* 当前月所在列 */
    const colW = 15; /* 12px 格 + 3px gap */
    const colLeft = wi * colW - 3; /* 第 wi 列左缘（首列左缘=0，其余减一个 gap） */
    /* 当前月列放视口约 40% 处：右侧留出 60% 空间，让 10-12 月“未来空月+月份标签”直接可见、提示可继续滑动；左侧保留全年历史可回滚 */
    const target = Math.max(0, Math.min(b.scrollWidth - b.clientWidth, colLeft + 6 - b.clientWidth * 0.4));
    if (Math.abs(b.scrollLeft - target) > 2) b.scrollLeft = target;
  } catch (e) { if (window.__silent) window.__silent(e, '01e7:centerYearHeat'); }
}
(function () {
  try {
    if (window.__yrCenterResize) return;
    window.__yrCenterResize = true;
    const b = document.getElementById('yearHeatmapContainer');
    if (!b || typeof ResizeObserver === 'undefined') return;
    let _seen = false;
    new ResizeObserver(function () {
      try {
        if (b.clientWidth > 8 && b.scrollWidth > b.clientWidth + 2) {
          centerYearHeat();
          _seen = true;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '01e7:centerYearHeat'); }
    }).observe(b);
  } catch (e) { if (window.__silent) window.__silent(e, '01e7:centerYearHeat'); }
})();
/* ===== renderYearHeatmap 年度热力图区块拆分 =====
 * 纯平移：窗口格子/统计算账/指标卡/12月分布/文字分析 拆为 5 个独立顶层函数（紧贴本函数上方），
 * 渲染 helper 以 calcYearReportStats 返回的 stats 集合为唯一数据入参；函数间无交叉依赖、逻辑零改写。
  */
function renderYearHeatGrid(dayMap, now) {
/* 窗口固定为「今年 1-12 月」+ 边界 padding 调到周日/周六，
   保证每年 1-12 月格子 + 月份标签全部完整显示。
   用「当前月±6 月」会让 1-2 月 / 11-12 月掉出窗口。 */
  let start = new Date(now.getFullYear(), 0, 1);
  while (start.getDay() !== 0) start.setDate(start.getDate() - 1);
  let _end = new Date(now.getFullYear(), 11, 31);
  while (_end.getDay() !== 6) _end.setDate(_end.getDate() + 1);
  const weeks = [];
  let curWeek = [];
  const d = new Date(start);
  while (d <= _end) {
    const ds = getDateStr(d);
    const v = dayMap[ds] || 0;
    /* 分档统一走 pomoHeatLevel（定义在 01eD），月历与年度地图共用一套阈值 */
    const cls = 'c' + pomoHeatLevel(v);
    /* 格子太小点不到，去掉点击跳转（玩家更在意颜色深浅） */
    curWeek.push('<div class="hm-cell ' + cls + '" title="' + ds + '：' + fmtTomatoNum(v) + ' 个🍅"></div>');
    d.setDate(d.getDate() + 1);
    if (curWeek.length === 7) {
      weeks.push(curWeek);
      curWeek = [];
    }
  }
  if (curWeek.length) {
    while (curWeek.length < 7) curWeek.push('<div class="hm-cell c0" style="visibility:hidden;"></div>');
    weeks.push(curWeek);
  }
/* 年份/月份合并循环，年份只在 1 月切换列（且非起始列）显示：
   两行独立渲染时，2025-12-28 与 2026-01-04 紧邻，4 字符「2025」会溢出 12px 列宽并覆盖「2026」。
   只让「1 月」这一列承载年份，月份切换但不是 1 月时年份列空白，两者不再水平冲突。 */
  let monthRow = '',
    yearRow = '';
  let lastMonth = -2;
  const thisY = now.getFullYear();
  for (let w = 0; w < weeks.length; w++) {
    const wd = new Date(start.getTime() + w * 7 * DAY_MS);
    const m = wd.getMonth();
    const inYear = wd.getFullYear() === thisY;
    /* 只有落在今年的列承担月份/年份标签：窗口两端为对齐周伸出的前后年列保持空白占位，
       最左不再出现去年的「12月」尾巴，月份行严格 1→12 */
    if (inYear && m !== lastMonth) {
      monthRow +=
        '<span style="display:inline-block;width:12px;flex-shrink:0;text-align:center;font-size:var(--fs-micro);color:var(--text-light);white-space:nowrap;overflow:visible;cursor:pointer;" title="查看 ' +
        (m + 1) +
        ' 月统计" onclick="jumpToBlock(\'monthlyStatWrap\')">' +
        (m + 1) +
        '月</span>';
      if (m === 0) {
        yearRow +=
          '<span style="display:inline-block;width:12px;flex-shrink:0;text-align:center;font-size:var(--fs-tiny);font-weight:800;color: var(--primary-ink);white-space:nowrap;overflow:visible;">' +
          thisY +
          '</span>';
      } else {
        yearRow += '<span style="display:inline-block;width:12px;flex-shrink:0;"></span>';
      }
      lastMonth = m;
    } else {
      monthRow += '<span style="display:inline-block;width:12px;flex-shrink:0;"></span>';
      yearRow += '<span style="display:inline-block;width:12px;flex-shrink:0;"></span>';
    }
  }
  return { weeks: weeks, monthRow: monthRow, yearRow: yearRow };
}

function calcYearReportStats(dayMap, now) {
  /* 年度小结（指标卡 + 详细多维度分析） */
  const yearRecs = Object.keys(dayMap).filter(function (k) {
    /* 上限必须写死：地图现在能翻往年，只看 >= 年开始会把之后所有年份的记录
       也算进这一年（翻到 2024 会看见 2025/2026 的量）。 */
    const y = now.getFullYear();
    return k >= y + '-01-01' && k <= y + '-12-31';
  });
  let total = 0,
    bestDs = '',
    bestV = 0;
  const monthMap = {};
  yearRecs.forEach(function (k) {
    const v = dayMap[k];
    total += v;
    if (v > bestV) {
      bestV = v;
      bestDs = k;
    }
    const mm = k.slice(5, 7);
    monthMap[mm] = (monthMap[mm] || 0) + v;
  });
  let bestMonth = '--',
    bestMV = -1,
    worstMonth = '--',
    worstMV = Infinity;
  for (const mm in monthMap) {
    if (monthMap[mm] > bestMV) {
      bestMV = monthMap[mm];
      bestMonth = mm;
    }
    if (monthMap[mm] < worstMV) {
      worstMV = monthMap[mm];
      worstMonth = mm;
    }
  }
  /* 今年最长连续天数 */
  let maxStreak = 0,
    cur = 0,
    curStart = -1,
    curEnd = -1,
    tmpStart = -1,
    bestStreakStart = -1,
    bestStreakEnd = -1;
  const yStart = new Date(now.getFullYear(), 0, 1);
  const yd = new Date(yStart);
  while (yd <= now) {
    const ds = getDateStr(yd);
    if ((dayMap[ds] || 0) > 0) {
      if (cur === 0) tmpStart = ds;
      cur++;
      if (cur > maxStreak) {
        maxStreak = cur;
        bestStreakStart = tmpStart;
        bestStreakEnd = ds;
      }
    } else {
      cur = 0;
    }
    yd.setDate(yd.getDate() + 1);
  }
  const yearDayCount = Math.floor((now - yStart) / DAY_MS) + 1;
  const activeDays = yearRecs.length;
  const avgPerActive = activeDays ? total / activeDays : 0;
  const avgPerDay = total / yearDayCount;
  const totalMinutes = yearRecs.reduce(function (s, k) {
    return s + (dayMap[k] || 0) * 25;
  }, 0);
  /* 工作日 vs 周末 */
  let workTotal = 0,
    workDays = 0,
    wkTotal = 0,
    wkDays = 0;
  yearRecs.forEach(function (k) {
    const d = new Date(k + 'T00:00:00');
    const wd = d.getDay();
    if (wd === 0 || wd === 6) {
      wkTotal += dayMap[k];
      if (dayMap[k] > 0) wkDays++;
    } else {
      workTotal += dayMap[k];
      if (dayMap[k] > 0) workDays++;
    }
  });
  const workAvg = workDays ? workTotal / workDays : 0;
  const wkAvg = wkDays ? wkTotal / wkDays : 0;
  /* 一周内最佳工作日（DOW） */
  const dowMap = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    dowCnt = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  yearRecs.forEach(function (k) {
    const d = new Date(k + 'T00:00:00');
    const wd = d.getDay();
    dowMap[wd] += dayMap[k];
    if (dayMap[k] > 0) dowCnt[wd]++;
  });
  let bestDow = -1,
    bestDowAvg = -1;
  for (let i = 0; i < 7; i++) {
    const a = dowCnt[i] ? dowMap[i] / dowCnt[i] : 0;
    if (a > bestDowAvg) {
      bestDowAvg = a;
      bestDow = i;
    }
  }
  const dowNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  /* 月份分布：前/中/后阶段对比 */
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const monthArr = [];
  for (let m = 0; m < 12; m++) {
    monthArr.push({ m: m, total: monthMap[String(m + 1).padStart(2, '0')] || 0 });
  }
  let firstHalfT = 0,
    secondHalfT = 0;
  monthArr.forEach(function (x) {
    if (x.m < 6) firstHalfT += x.total;
    else secondHalfT += x.total;
  });
  const pastHalf = Math.min(6, now.getMonth() + 1);
  const recentHalf = Math.max(0, now.getMonth() + 1 - 6);
  const avgFirst = firstHalfT / Math.max(1, pastHalf);
  const avgSecond = secondHalfT / Math.max(1, recentHalf);
  /* 趋势：上半年 vs 下半年（按月均） */
  const trendArrow = avgSecond > avgFirst * 1.15 ? '📈 上行' : avgSecond < avgFirst * 0.85 ? '📉 下行' : '➡️ 平稳';
  /* 一致性得分：变异系数（CV）的反向，1 - 偏差率（活跃日中标准差/均） */
  let consistency = '—';
  if (activeDays >= 7) {
    const mean = avgPerActive;
    const variance =
      yearRecs.reduce(function (s, k) {
        return s + Math.pow((dayMap[k] || 0) - mean, 2);
      }, 0) / activeDays;
    const std = Math.sqrt(variance);
    const cv = mean ? std / mean : 0;
    if (cv < 0.4) consistency = '高 🟢';
    else if (cv < 0.8) consistency = '中 🟡';
    else consistency = '低 🔴';
  }
  return {
    total: total, bestV: bestV, bestDs: bestDs, bestMonth: bestMonth, bestMV: bestMV,
    worstMonth: worstMonth, maxStreak: maxStreak, yearDayCount: yearDayCount,
    activeDays: activeDays, avgPerActive: avgPerActive, avgPerDay: avgPerDay, totalMinutes: totalMinutes,
    workDays: workDays, wkDays: wkDays, workAvg: workAvg, wkAvg: wkAvg,
    bestDow: bestDow, bestDowAvg: bestDowAvg, dowNames: dowNames, monthNames: monthNames,
    monthArr: monthArr, pastHalf: pastHalf, recentHalf: recentHalf, avgFirst: avgFirst,
    avgSecond: avgSecond, trendArrow: trendArrow, consistency: consistency
  };
}

function renderYearSummaryHTML(st) {
  const { total, bestV, bestDs, maxStreak, bestMonth, activeDays, avgPerActive, consistency } = st;
  const summary =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-8);margin:var(--sp-10) 0 var(--sp-8);">' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-6);text-align:center;"><div style="font-size:var(--fs-title);font-weight:900;color: var(--primary-ink);">' +
    total +
    '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">今年🍅</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-6);text-align:center;"><div style="font-size:var(--fs-title);font-weight:900;color: var(--blue-ink);">' +
    bestV +
    '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">最佳日' +
    (bestDs ? ' ' + bestDs.slice(5) : '') +
    '</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-6);text-align:center;"><div style="font-size:var(--fs-title);font-weight:900;color: var(--green-ink);">' +
    maxStreak +
    '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">最长连续</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-6);text-align:center;"><div style="font-size:var(--fs-title);font-weight:900;color: var(--yellow-ink);">' +
    bestMonth +
    '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">最佳月份</div></div>' +
    '</div>';
  /* 4 个次级指标小卡（活跃天数 + 日均 + 总专注时长 + 起始强度） */
  const subMetrics =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-6);margin:0 0 var(--sp-10);font-size:var(--fs-tiny);color:var(--text-light);text-align:center;">' +
    '<div style="background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-4) var(--sp-4);"><b style="font-size:var(--fs-body);color:var(--text);">' +
    activeDays +
    '</b><br>活跃天数</div>' +
    '<div style="background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-4) var(--sp-4);"><b style="font-size:var(--fs-body);color:var(--text);">' +
    avgPerActive.toFixed(1) +
    '</b><br>活跃日均</div>' +
    '<div style="background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-4) var(--sp-4);"><b style="font-size:var(--fs-body);color:var(--text);">' +
    (avgPerActive >= 1 ? '已达' : '未达') +
    '</b><br>日均≥1</div>' +
    '<div style="background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-4) var(--sp-4);"><b style="font-size:var(--fs-body);color:var(--text);">' +
    (consistency !== '—' ? consistency.split(' ')[0] : '—') +
    '</b><br>稳定性</div>' +
    '</div>';
  return summary + subMetrics;
}

function renderYearMonthChart(st) {
  const { monthArr, monthNames, bestMonth } = st;
  /* 月份数据可视化条 */
  const maxMonth = Math.max.apply(
    null,
    monthArr.map(function (x) {
      return x.total;
    })
  );
  const monthBars = monthArr
    .map(function (x) {
      const pct = maxMonth ? Math.round((x.total / maxMonth) * 100) : 0;
      const isBest = x.m + 1 === parseInt(bestMonth, 10);
      return (
        '<div style="display:flex;align-items:center;gap:var(--sp-4);font-size:var(--fs-tiny);">' +
        '<span style="width:24px;color:var(--text-light);text-align:right;">' +
        monthNames[x.m] +
        '</span>' +
        '<div style="flex:1;background:var(--bg);border-radius:var(--radius-xs);height:10px;overflow:hidden;border:1px solid var(--border);">' +
        '<div style="height:100%;width:' +
        pct +
        '%;background:' +
        (isBest ? 'linear-gradient(90deg,#FFD54F,#FF9800)' : 'linear-gradient(90deg,#FFD180,#FFB74D)') +
        ';border-radius:var(--radius-xs);"></div></div>' +
        '<span style="width:28px;font-weight:700;color:var(--text);text-align:right;">' +
        x.total +
        '</span></div>'
      );
    })
    .join('');
  /* 显示 12 月的迷你条形图 */
  const monthChart =
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-10);margin:var(--sp-8) 0 var(--sp-6);">' +
    '<div style="font-size:var(--fs-note);font-weight:700;color:var(--text);margin-bottom:var(--sp-6);">📅 12 个月番茄分布 <span style="font-size:var(--fs-tiny);color:var(--text-light);font-weight:400;">（越高越强 · 当前最佳 ' +
    monthNames[parseInt(bestMonth, 10) - 1] +
    '）</span></div>' +
    monthBars +
    '</div>';
  return monthChart;
}

function renderYearInsightLines(st, now) {
  const { total, activeDays, yearDayCount, avgPerActive, workDays, wkDays, workAvg, wkAvg,
          consistency, pastHalf, recentHalf, avgFirst, avgSecond, trendArrow, bestDow, dowNames,
          bestDowAvg, bestMV, bestMonth, bestV, bestDs, totalMinutes } = st;
  /* 详细文字分析（从 5 个维度解读年度数据，不只是念数） */
  const nowMonth = now.getMonth() + 1;
  const insightLines = [];
  if (total <= 0) {
    insightLines.push('今年还没有番茄记录。从今天开始，每一个 🍅 都是给明天的你的礼物。');
  } else {
    /* 节奏 */
    if (activeDays >= 300)
      insightLines.push(
        '🗓️ <b>全年节奏</b>：你今年有 <b>' +
          activeDays +
          ' 天</b>在专注，覆盖全年 <b>' +
          Math.round((activeDays / yearDayCount) * 100) +
          '%</b> 的日子——这已经是专业级的稳定度。活跃日均 <b>' +
          avgPerActive.toFixed(1) +
          '</b> 个🍅，相当于每次坐下来就能完成一整个番茄。'
      );
    else if (activeDays >= 100)
      insightLines.push(
        '🗓️ <b>全年节奏</b>：你今年坚持了 <b>' +
          activeDays +
          ' 天</b>的专注，活跃日均 <b>' +
          avgPerActive.toFixed(1) +
          '</b> 个🍅。每隔几天就能坐下来一次——这就是进步的样子。'
      );
    else if (activeDays >= 30)
      insightLines.push(
        '🗓️ <b>全年节奏</b>：今年 <b>' +
          activeDays +
          ' 天</b>都有产出，是起步阶段很扎实的数据。下一步可以试试把连续天数推高。'
      );
    else
      insightLines.push('🗓️ <b>全年节奏</b>：今年 <b>' + activeDays + ' 天</b>有专注记录。看着少，但每一步都是根基。');
    /* 工作日 vs 周末 */
    if (workDays > 0 && wkDays > 0) {
      const diffPct = workAvg ? (wkAvg / workAvg) * 100 - 100 : 0;
      if (diffPct > 15)
        insightLines.push(
          '💼 <b>工作日 vs 周末</b>：工作日均 <b>' +
            workAvg.toFixed(1) +
            '</b> vs 周末均 <b>' +
            wkAvg.toFixed(1) +
            '</b>（高 <b>' +
            Math.round(diffPct) +
            '%</b>）——周末反而是你更能专注的时段，可以尝试把更重要的任务挪过来。'
        );
      else if (diffPct < -15)
        insightLines.push(
          '💼 <b>工作日 vs 周末</b>：工作日均 <b>' +
            workAvg.toFixed(1) +
            '</b> vs 周末均 <b>' +
            wkAvg.toFixed(1) +
            '</b>（低 <b>' +
            Math.abs(Math.round(diffPct)) +
            '%</b>）——工作日状态更稳定。周末稍微掉线是正常的，毕竟你在休息。'
        );
      else
        insightLines.push(
          '💼 <b>工作日 vs 周末</b>：工作日 <b>' +
            workAvg.toFixed(1) +
            '</b> ≈ 周末 <b>' +
            wkAvg.toFixed(1) +
            '</b>——你是个均衡输出型选手，不挑日子都能进入状态。'
        );
    } else if (wkDays > 0 && workDays === 0) {
      insightLines.push(
        '💼 <b>工作日 vs 周末</b>：你今年只在周末有专注产出（<b>' +
          wkDays +
          ' 天</b>）。如果工作日也能提个 15 分钟试试，年度产量会翻倍。'
      );
    } else if (workDays > 0 && wkDays === 0) {
      insightLines.push(
        '💼 <b>工作日 vs 周末</b>：专注都发生在工作日（<b>' +
          workDays +
          ' 天</b>）。周末 0 产出——给自己放假也是种专注。'
      );
    }
    /* 一致性 */
    insightLines.push(
      '📊 <b>稳定性</b>：<b>' +
        consistency +
        '</b>。变异系数反映你「每天产出是否稳定」——稳定性越高，越容易把状态变成下意识。'
    );
    /* 月度趋势 */
    if (pastHalf >= 2) {
      insightLines.push(
        trendArrow.slice(0, 2) +
          ' <b>月度趋势</b>：前 ' +
          pastHalf +
          ' 月均 <b>' +
          avgFirst.toFixed(1) +
          '</b> 个🍅 · 近 ' +
          recentHalf +
          ' 月均 <b>' +
          avgSecond.toFixed(1) +
          '</b> 个🍅。' +
          (avgSecond > avgFirst ? '下半年在加力，越打越顺手。' : '近期有波动，看看是什么打扰了你。')
      );
    }
    /* 高产日/周规律 */
    if (bestDow >= 0) {
      insightLines.push(
        '🎯 <b>你最高效的星期</b>：<b>' +
          dowNames[bestDow] +
          '</b>（活跃日均 <b>' +
          bestDowAvg.toFixed(1) +
          '</b> 个🍅）。本周这一天，是你安排大事的好窗口。'
      );
    }
    /* 最佳月份（最深信息） */
    if (bestMV > 0) {
      insightLines.push(
        '🏆 <b>最佳月份 ' +
          parseInt(bestMonth, 10) +
          '月</b>：累计 <b>' +
          bestMV +
          '</b> 个🍅，日均 <b>' +
          (bestMV / new Date(now.getFullYear(), parseInt(bestMonth, 10), 0).getDate()).toFixed(1) +
          '</b>。回忆一下那个月你做对了什么——把那个状态复制到现在。'
      );
    }
    /* 最佳日峰值 */
    if (bestV >= 8)
      insightLines.push(
        '⚡ <b>巅峰日 ' +
          bestDs.slice(5) +
          '</b>：单日 <b>' +
          bestV +
          '</b> 个🍅（约 ' +
          Math.round((bestV * 25) / 60) +
          ' 小时纯专注）——这是你今年最有力量的 25 分钟们堆出来的成绩。'
      );
    else if (bestV >= 4)
      insightLines.push(
        '⚡ <b>巅峰日 ' + bestDs.slice(5) + '</b>：单日 <b>' + bestV + '</b> 个🍅。稳产不爆，是可持续的节奏。'
      );
    /* 累计时间 */
    insightLines.push(
      '⏱️ <b>累计专注</b>：<b>' +
        Math.round(totalMinutes / 60) +
        '</b> 小时——这是 <b>' +
/* totalMinutes 的单位是分钟，要除以 POMO_DEFAULT_MINUTES(25) 折算成「25 分钟番茄」个数。
   除以 1500（按秒算）会让数字小 60 倍（365🍅 的年显示成 6）。 */
        (totalMinutes / POMO_DEFAULT_MINUTES).toFixed(0) +
        '</b> 个 25 分钟番茄的沉淀。换算成连续看一部电影（2 小时），要看 <b>' +
        Math.round(totalMinutes / 120) +
        '</b> 部才到这个量。'
    );
  }
  return insightLines;
}

