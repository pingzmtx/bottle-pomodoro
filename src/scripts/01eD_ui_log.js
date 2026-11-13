/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 日志与回顾层：日志页渲染（renderLogs / 分组折叠 / 日历 / 筛选 / 翻页）、时长格式化辅助、
 * 艾宾浩斯「回顾」弹窗与自评（renderReviewModal / gradeReview / graduatedReviewDates）。
 * 全部为**顶层函数声明**，跨 script 全局可见；本文件必须排在 01e_engine_ui.js
 * **之后**加载（见 src/manifest.json 的槽 1 files）。
 * 依赖方向：本文件 → 01e（前向，安全）。本文件使用的 01e 顶层**状态变量**仍留在 01e，
 *   且都在本文件之前初始化，运行期一定可用（例：`_logJumpDate` / `_logCalJumpOpen` /
 *   `_logSig` / `_logOpenGroups` / `_logDaysPerPage` / `logCalMonth` / `REVIEW_CHIP_MAX` /
 *   `_reviewDayView`）。两文件同处全局词法环境，跨文件读写与同文件内等价。
 *   反向不成立：01e **不**依赖本文件的任何东西。
 * 注：本文件调用 `recordSeconds` 等时长辅助（同时被 01e7_ui_stats 使用）；这些辅助随本刀
 *   一并迁入本文件，仍是全局函数，调用方无感。 */
/* ==================== 模块: 04eD-ui-log.js | 职责: 日志页渲染 + 回顾弹窗与自评 | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04eD-ui-log.js（源文件 01eD_ui_log.js）
 * 分组：ui
 * 职责：日志页（渲染 / 分组折叠 / 日历 / 筛选 / 翻页）、时长格式化辅助、
 *       回顾（待回顾列表 / 单日详情 / 自评打分 / 回顾设置）。
 *   · 只搬「顶层 function 声明 + 其紧邻文档注释」，**不搬任何顶层变量、不搬任何顶层
 *     立即执行语句** —— 因此跨 script 的加载顺序只影响「谁先定义」，不影响「谁能看见谁」。
 *   · 本域在 01e 里被倒数日 / 白噪音 / 歌单 / 日记等域打散，且区间内夹着若干顶层
 *     let/const，故本刀改用「按函数声明块精确抽取」而非按行号切段。
 *   · 回退方式：把本文件内容按 TOC 顺序粘回 01e 对应位置，并删掉 src/manifest.json
 *     里本文件那一行。
 * 函数索引（TOC）：switchLogTab/jumpLogDay/logRangeValue/setLogRange/logRangeLabel/logRangeAll/logRangeThisMonth/logRangeToday/openLogCalendar/changeLogCalendarMonth/pomoHeatLevel/renderLogCalendar（+60 更多）
 * ============================================================ */

function switchLogTab(tab) {
  if (currentLogTab === 'diary' && currentDiaryDate) forceSaveDiary(currentDiaryDate);
  __set_currentLogTab(tab);
  document
    .querySelectorAll('#view-log .log-tab')
    .forEach((t, i) =>
      t.classList.toggle(
        'active',
        (tab === 'focus' ? 0 : tab === 'diary' ? 1 : tab === 'bio' ? 2 : tab === 'overview' ? 3 : 4) === i
      )
    );
  document.getElementById('logFocusView').style.display = tab === 'focus' ? 'block' : 'none';
  document.getElementById('logDiaryView').style.display = tab === 'diary' ? 'block' : 'none';
  document.getElementById('logBioView').style.display = tab === 'bio' ? 'block' : 'none';
  document.getElementById('logOverviewView').style.display = tab === 'overview' ? 'block' : 'none';
  /* 「💬 备忘」由 01e9 动态注入（面板可能还没建好）—— 判空，别抛 */
  const _memoV = document.getElementById('logMemoView');
  if (_memoV) _memoV.style.display = tab === 'memo' ? 'block' : 'none';
  const _la = document.getElementById('logJumpArrow');
  if (_la) {
    const _inLogView = document.getElementById('view-log').classList.contains('active');
    _la.style.display = tab === 'focus' && _inLogView ? 'flex' : 'none';
    _la.style.background = 'var(--primary)';
  }
  if (tab === 'focus') _logJumpDate = null;
  if (tab === 'diary') renderDiary();
  if (tab === 'bio') renderBioSection();
  if (tab === 'overview') renderDiaryOverviewPage();
}

function jumpLogDay() {
  /* 与 renderLogs 相同的筛选 */
  const searchEl = document.getElementById('logSearch');
  const typeEl = document.getElementById('logTypeFilter');
  const dateEl = document.getElementById('logDateFilter');
  const kw = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const tf = typeEl ? typeEl.value : '';
  const df = dateEl ? dateEl.value : '';
  let records = [...appData.records].sort((a, b) => b.startTime - a.startTime);
  if (tf) {
    records = records.filter(r => (tf === 'interrupted' ? r.interruptions && r.interruptions.length : r.type === tf));
  }
  /* 关键词：空格分开 = 每个词都要出现（十年后凭零碎记忆找人，单关键词往往命中一大片）。
     搜索范围含任务名、备注和日期 —— 打「2025」就是那年全部，「2025-03」就是那个月。 */
  const _toks = String(kw || '')
    .split(/\s+/)
    .filter(Boolean);
  if (_toks.length) {
    records = records.filter(function (r) {
      const hay = ((r.taskName || '') + ' ' + (r.note || '') + ' ' + getDateStr(r.startTime)).toLowerCase();
      return _toks.every(function (t) {
        return hay.indexOf(t) >= 0;
      });
    });
  }
  /* 时间范围按前缀匹配：'YYYY-MM' 取整月，'YYYY-MM-DD' 取当天 */
  if (df) {
    records = records.filter(r => getDateStr(r.startTime).indexOf(df) === 0);
  }
  if (!records.length) {
    showToast('暂无专注记录');
    return;
  }
  const dates = [];
  records.forEach(r => {
    const ds = getDateStr(r.startTime);
    if (dates[dates.length - 1] !== ds) dates.push(ds);
  });
  const today = getTodayStr();
  let target,
    wrap = false;
  if (!_logJumpDate) {
    target = dates.indexOf(today) >= 0 ? today : dates[0]; /* 今天没记录则跳到最近的一天 */
  } else {
    const i = dates.indexOf(_logJumpDate);
    if (i >= 0 && i < dates.length - 1) {
      target = dates[i + 1];
    } else {
      target = dates[0];
      wrap = true;
    } /* 到底 → 回绕最新 */
  }
  _logJumpDate = target;
  /* 目标日期在第几天（倒序）→ 所在页 */
  const dayIdx = dates.indexOf(target);
  const page = Math.floor(dayIdx / _logDaysPerPage) + 1;
  if (page !== _logPage) {
    _logPage = page;
    renderLogs();
  }
  setTimeout(function () {
    const el = document.querySelector('#logList .log-date-header[data-date="' + target + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.style.background = 'var(--primary)';
      el.style.color = '#fff';
      el.style.borderRadius = '4px';
      el.style.padding = '1px 6px';
      setTimeout(function () {
        el.style.background = '';
        el.style.color = '';
        el.style.padding = '';
      }, 1600);
    }
  }, 60);
  showToast(wrap ? '已回到最新 · 📅 ' + target : '📅 ' + target);
}

/* 时间范围：''=全部时间 / 'YYYY-MM'=整月 / 'YYYY-MM-DD'=某一天。
   十年数据的关键不是"日期框能选一天"，而是**能按月、按年直接跳到想看的那段**。
   口径与传记页同一套（01e7: setBioRange / bioRangeLabel），只是各自独立状态。 */
function logRangeValue() {
  const el = document.getElementById('logDateFilter');
  return el ? String(el.value || '') : '';
}
function setLogRange(r) {
  const v = r || '';
  const el = document.getElementById('logDateFilter');
  if (el) el.value = v;
  _logPage = 1;
  applyLogFilter();
}
/* 一句话说清现在看的是哪段（按钮与摘要行共用） */
function logRangeLabel(r) {
  const v = r == null ? logRangeValue() : r;
  if (!v) return '全部时间';
  if (v.length === 7) return v.slice(0, 4) + '年' + Number(v.slice(5, 7)) + '月';
  return v;
}
function logRangeAll() {
  setLogRange('');
  closeModal('logCalendarModal');
}
function logRangeThisMonth() {
  setLogRange(logCalYear + '-' + String(logCalMonth + 1).padStart(2, '0'));
  closeModal('logCalendarModal');
}
function logRangeToday() {
  pickLogDate(getTodayStr());
}
function openLogCalendar() {
  const now = new Date();
  const cur = logRangeValue();
  if (cur.length >= 7) {
    logCalYear = Number(cur.slice(0, 4)) || now.getFullYear();
    logCalMonth = (Number(cur.slice(5, 7)) || now.getMonth() + 1) - 1;
  } else {
    logCalYear = now.getFullYear();
    logCalMonth = now.getMonth();
  }
  _logCalJumpOpen = false;
  renderLogCalendar();
  showModal('logCalendarModal');
}

function changeLogCalendarMonth(d) {
  logCalMonth += Number(d) || 0;
  if (logCalMonth < 0) {
    logCalMonth = 11;
    logCalYear--;
  } else if (logCalMonth > 11) {
    logCalMonth = 0;
    logCalYear++;
  }
  renderLogCalendar();
}

/* 番茄数 → 热力档位（0~4）。阈值 1/2/4/7 与统计页「年度专注地图」共用同一套，
   避免同一天在月历里是深色、在地图里是浅色。 */
function pomoHeatLevel(n) {
  const v = Number(n) || 0;
  if (v >= 7) return 4;
  if (v >= 4) return 3;
  if (v >= 2) return 2;
  if (v >= 1) return 1;
  return 0;
}

function renderLogCalendar() {
  const title = document.getElementById('logCalTitle');
  const grid = document.getElementById('logCalGrid');
  if (!title || !grid) return;
  title.textContent = logCalYear + '年' + (logCalMonth + 1) + '月';
  const startDow = new Date(logCalYear, logCalMonth, 1).getDay();
  const dim = new Date(logCalYear, logCalMonth + 1, 0).getDate();
  const today = getTodayStr();
  /* 打点口径 = 「这天有几条记录」，含「仅记录」和「半个」。
     byDate 是番茄统计缓存，天然不含「仅记录」，直接用它会让只补记了一天的人看到空日历。
     日历主数字给「番茄数」（用户真正关心的量），条数保留在点开那天的日摘要与 title 里。 */
  const _hasDay = {},
    _pomoDay = {},
    _monCount = {};
  (appData.records || []).forEach(function (r) {
    if (!r || !r.startTime) return;
    const ds = getDateStr(r.startTime);
    _hasDay[ds] = (_hasDay[ds] || 0) + 1;
    _pomoDay[ds] = (_pomoDay[ds] || 0) + getPomos(r);
    const mk = ds.slice(0, 7);
    _monCount[mk] = (_monCount[mk] || 0) + 1;
  });
  /* 有记录的年份直接列出来：用了十几年的人按「上年」要按十几次，这里一眼点到 */
  const _yBox = document.getElementById('logCalJumpYears');
  if (_yBox) {
    const years = Object.keys(_monCount)
      .map(function (k) {
        return Number(k.slice(0, 4));
      })
      .filter(function (y, i, a) {
        return y && a.indexOf(y) === i;
      })
      .sort(function (a, b) {
        return b - a;
      });
    _yBox.innerHTML = years.length
      ? years
          .map(function (y) {
            return (
              '<button class="cal-jump-btn" style="' +
              (y === logCalYear ? 'border-color:var(--primary);color: var(--primary-ink);font-weight:800;' : '') +
              '" onclick="logCalJumpYear(' +
              y +
              ')">' +
              y +
              '</button>'
            );
          })
          .join('')
      : '<span style="font-size:var(--fs-caption);color:var(--text-light);">还没有任何记录</span>';
  }
  /* 月份格里也标条数，没内容的月份淡下去 */
  const _mBox = document.getElementById('logCalJumpMonths');
  if (_mBox) {
    let mh = '';
    for (let m = 1; m <= 12; m++) {
      const n = _monCount[logCalYear + '-' + String(m).padStart(2, '0')] || 0;
      mh +=
        '<button class="cal-jump-m' +
        (m === logCalMonth + 1 ? ' on' : '') +
        '" style="' +
        (n ? '' : 'opacity:.45;') +
        '" onclick="logCalJumpMonth(' +
        m +
        ')" title="' +
        (n ? n + ' 条记录' : '没有记录') +
        '">' +
        m +
        (n ? '<span style="display:block;font-size:var(--fs-micro);font-weight:600;">' + n + '</span>' : '') +
        '</button>';
    }
    _mBox.innerHTML = mh;
  }
  let html = '';
  ['日', '一', '二', '三', '四', '五', '六'].forEach(function (d) {
    html += '<div style="text-align:center;font-size:var(--fs-body);color:var(--text-light);font-weight:700;">' + d + '</div>';
  });
  for (let i = 0; i < startDow; i++) html += '<div></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = logCalYear + '-' + String(logCalMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const n = _hasDay[ds] || 0;
    const p = _pomoDay[ds] || 0;
    const isToday = ds === today;
    const isSel = ds === logRangeValue();
    const lv = n ? pomoHeatLevel(p) : 0;
    let cls = 'logcal-day lv' + lv;
    if (!n) cls += ' empty';
    else if (lv === 0) cls += ' hasrec'; /* 有记录但 0 番茄（纯补记）：给个空心描边，别看起来像空白 */
    if (isToday) cls += ' today';
    if (isSel) cls += ' sel';
    html +=
      '<div class="' +
      cls +
      '" onclick="pickLogDate(\'' +
      ds +
      '\')"' +
      (isToday ? ' style="border:1px solid var(--primary);"' : '') +
      ' title="' +
      ds +
      '：' +
      (n ? fmtTomatoNum(p) + ' 个番茄 · ' + n + ' 条记录' : '没有记录') +
      '">' +
      '<span class="logcal-d">' +
      d +
      '</span>' +
      (n ? '<span class="logcal-n">' + fmtTomatoNum(p) + '</span>' : '') +
      '</div>';
  }
  html +=
    '<div class="logcal-legend">少<span class="hm-cell c1"></span>' +
    '<span class="hm-cell c2"></span><span class="hm-cell c3"></span>' +
    '<span class="hm-cell c4"></span>多</div>';
  grid.innerHTML = html;
  /* 面板状态与年份文字在这里一起同步（renderLogCalJump 反过来调本函数，
     若这里再调它就会无限递归） */
  const _jp = document.getElementById('logCalJump');
  if (_jp) _jp.style.display = _logCalJumpOpen ? 'block' : 'none';
  const _jy = document.getElementById('logCalJumpYear');
  if (_jy) _jy.textContent = logCalYear + '年';
}

function toggleLogCalJump() {
  _logCalJumpOpen = !_logCalJumpOpen;
  renderLogCalJump();
}

function renderLogCalJump() {
  /* 月份格与年份快跳都只在 renderLogCalendar 里生成（条数、选中态、年份清单同一处算），
     这里只负责打开/关闭面板，避免两处各写一份月份按钮。 */
  renderLogCalendar();
}

function changeLogCalYear(d) {
  logCalYear += Number(d) || 0;
  renderLogCalendar();
}

function logCalJumpMonth(m) {
  logCalMonth = m - 1;
  _logCalJumpOpen = false;
  renderLogCalendar();
}

function pickLogDate(ds) {
  const input = document.getElementById('logDateFilter');
  if (input) input.value = ds;
  _logPage = 1;
  applyLogFilter();
  closeModal('logCalendarModal');
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
}
function logCalJumpYear(y) {
  logCalYear = Number(y) || logCalYear;
  _logCalJumpOpen = true;
  renderLogCalendar();
}

function toggleLogFilters() {
  const panel = document.getElementById('logFilterPanel');
  const btn = document.getElementById('logFilterToggleBtn');
  if (!panel) return;
  if (panel.style.display === 'none') {
    panel.style.display = 'block';
    if (btn) btn.textContent = '🔍 收起筛选';
  } else {
    panel.style.display = 'none';
    if (btn) btn.textContent = '🔍 筛选';
  }
  updateFilterSummary();
}

function updateFilterSummary() {
  const panel = document.getElementById('logFilterPanel');
  const sum = document.getElementById('logFilterSummary');
  /* 范围按钮的文案永远跟着实际条件走 —— 否则"全部时间"按钮在筛选已生效时还在说谎 */
  const _rb = document.getElementById('logRangeBtn');
  if (_rb) {
    const _v = logRangeValue();
    /* 页头一行要挤下「标题 + 日期 + 筛选 + 补记 + 回顾」，所以这里用短文案：
       全部 / 2025年3月 / 2025-03-14，不说"全部时间"（多 2 个字就换行）。 */
    const _short = !_v ? '全部' : _v.length === 7 ? _v.slice(0, 4) + '年' + Number(_v.slice(5, 7)) + '月' : _v;
    _rb.textContent = '📅 ' + _short + ' ▾';
    _rb.style.borderColor = _v ? 'var(--primary)' : '';
    _rb.style.color = _v ? 'var(--primary)' : '';
    _rb.style.fontWeight = _v ? '700' : '';
  }
  if (!sum) return;
  const kw = document.getElementById('logSearch');
  const tf = document.getElementById('logTypeFilter');
  const df = document.getElementById('logDateFilter');
  const parts = [];
  if (kw && kw.value.trim()) parts.push('关键词"' + kw.value.trim() + '"');
  if (tf && tf.value) {
    const opts = { full: '完整🍅', half: '半个🍅', incomplete: '未完成', interrupted: '打断', log: '仅记录', pomo: '只看🍅' };
    parts.push(opts[tf.value] || tf.value);
  }
  if (df && df.value) parts.push(logRangeLabel(df.value));
  const active = parts.length > 0;
  const collapsed = panel && panel.style.display === 'none';
  if (active && collapsed) {
    sum.style.display = 'block';
    sum.textContent = '已筛选：' + parts.join(' · ') + '（点击展开）';
  } else {
    sum.style.display = 'none';
    sum.textContent = '';
  }
}

function clearLogFilters() {
  const s = document.getElementById('logSearch');
  if (s) s.value = '';
  const t = document.getElementById('logTypeFilter');
  if (t) t.value = '';
  const d = document.getElementById('logDateFilter');
  if (d) d.value = '';
  const panel = document.getElementById('logFilterPanel');
  if (panel) panel.style.display = 'none';
  const btn = document.getElementById('logFilterToggleBtn');
  if (btn) btn.textContent = '🔍 筛选';
  updateFilterSummary();
  applyLogFilter();
}

function logPageGo(dir) {
  _logPage = Math.max(1, _logPage + dir);
  renderLogs();
  document.querySelector('.main').scrollTop = 0;
}

function logPageJump(p) {
  _logPage = parseInt(p, 10) || 1;
  renderLogs();
  document.querySelector('.main').scrollTop = 0;
}

function applyLogFilter() {
  _logPage = 1;
  _logJumpDate = null;
  renderLogs();
  const btn = document.getElementById('logFilterToggleBtn');
  if (btn) {
    const kw = document.getElementById('logSearch');
    const tf = document.getElementById('logTypeFilter');
    const df = document.getElementById('logDateFilter');
    const active = (kw && kw.value.trim()) || (tf && tf.value) || (df && df.value);
    btn.textContent = active ? '🔍 筛选●' : '🔍 筛选';
  }
  updateFilterSummary();
}

/* （worklog 聚合）：按任务汇总累计专注时长/番茄 —— 已删除整块 */
function renderTaskSummary() {
  const box = document.getElementById('taskSummaryBox');
  if (!box) return;
  box.style.display = 'none';
  box.innerHTML = ''; /* 「按任务汇总」整块已删除 */
}

/* 记录集内容指纹：只比"条数 + 首尾 id/时间"会漏掉"原地改备注 / 任务名"这类修改
   （日志里补填备注后列表不刷新）。覆盖 renderLogs 会渲染到的字段。 */
/* 「完成计划」流水（appData.todoDoneLog）的指纹。
   ★ 它必须进 renderLogs 的脏检查签名：勾选/取消「完成计划」只写这张表、不动
   appData.records，而签名原来只认记录 → 勾完切到日志页签名没变、直接 return，
   页面拿旧 DOM 当新的（用户 10-15 「完成了计划但日志不更新 / 取消了不同步」）。
   内容取「日期 + 条数 + 标题 + 完成时刻」，够区分增删改，又不至于太长。 */
function _logTodoDoneSig() {
  const dl = appData.todoDoneLog || {};
  return Object.keys(dl)
    .sort()
    .map(function (ds) {
      const arr = dl[ds] || [];
      return (
        ds +
        ':' +
        arr.length +
        ':' +
        arr
          .map(function (x) {
            if (!x) return '';
            /* partial（只勾了子计划）+ subs 必须进签名：在结算窗补勾子计划时
               只改这一条的 subs，签名不变就不重渲，日志停在旧样子。 */
            return (
              (x.title || '') + '@' + (x.doneAt || '') + '#' + (x.partial ? 'p' : 'f') +
              '/' + (x.subs || []).map(function (s) { return (s && s.d) ? '1' : '0'; }).join('')
            );
          })
          .join(',')
      );
    })
    .join(';');
}

function _logRecordsSig() {
  let h = 5381;
  const rs = appData.records || [];
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    const s =
      (r.id || '') + '\u0001' + (r.startTime || 0) + '\u0001' + (r.endTime || 0) + '\u0001' +
      (r.type || '') + '\u0001' + (r.duration || 0) + '\u0001' + (r.effectiveSeconds || 0) + '\u0001' +
      (r.taskName || '') + '\u0001' + (r.note || '') + '\u0001' + (r.pending ? 1 : 0) + '\u0001' +
      /* 状态对比（🔋 精力 / 😊 心情，起止各一对）会渲到卡片上，漏了就会「改了不刷新」 */
      (r.startEnergy || '') + '\u0001' + (r.startMood || '') + '\u0001' +
      (r.energy || '') + '\u0001' + (r.mood || '') + '\u0001' +
      (r.expectedPomodoros == null ? '' : r.expectedPomodoros) + '\u0001' +
      (r.actualPomodoros == null ? '' : r.actualPomodoros) + '\u0001' +
      ((r.interruptions && r.interruptions.length) || 0);
    for (let j = 0; j < s.length; j++) h = ((h * 33) ^ s.charCodeAt(j)) | 0;
  }
  return h;
}

/* 时长说人话：≥1 小时写「1 小时 10 分」，否则「25 分钟」 */
function fmtDurationText(sec) {
  /* 不满 1 分钟就写秒 —— 45 秒被说成「1 分钟」跟备注里写的「45 秒」自相矛盾 */
  const s0 = Math.max(0, Math.round(sec || 0));
  if (s0 < 60) return s0 + ' 秒';
  const m = Math.max(1, Math.round(s0 / 60));
  if (m < 60) return m + ' 分钟';
  return Math.floor(m / 60) + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分' : '');
}

/* 一条记录实际算了多久（秒）。
   落库的 effectiveSeconds 是权威值；老数据 / 异常数据缺它时，用 endTime-startTime 反推。
   两个都拿不到就返回 0 —— 调用方据此**不显示时长**，而不是印一个「0 分钟」的假数字。 */
function _toMs(v) {
  var n = Number(v);
  if (isFinite(n) && n > 0) return n;
  var t = new Date(v).getTime();
  return isFinite(t) ? t : 0;
}

function recordSeconds(rec) {
  const s = Number(rec && rec.effectiveSeconds) || 0;
  if (s > 0) return s;
  const a = _toMs(rec && rec.startTime),
    b = _toMs(rec && rec.endTime);
  if (b > a) return (b - a) / 1000;
  /* 老记录/导入记录只有 duration（毫秒），没有 endTime —— 不兜底就会「有时长字段却显示不出时长」 */
  const d = Number(rec && rec.duration) || 0;
  return d > 0 ? d / 1000 : 0;
}

/* 单条记录的时长文案（算不出来就返回空串） */
function recordDurationText(rec) {
  const s = recordSeconds(rec);
  return s > 0 ? fmtDurationText(s) : '';
}

/* 分组的时长文案：优先用分组已算好的合计，否则把各段反推时长加起来 */
function groupDurationText(g) {
  const s = Number(g && g.effectiveSeconds) || 0;
  if (s > 0) return fmtDurationText(s);
  let sum = 0;
  (g.segments || []).forEach(function (x) { sum += recordSeconds(x); });
  return sum > 0 ? fmtDurationText(sum) : '';
}

/* 日期头文案：2026-10-08 → 「10月8日 · 周三」（今天/昨天另标） */
function fmtDayLabel(ds) {
  const p = String(ds || '').split('-');
  if (p.length !== 3) return ds;
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  const label = Number(p[1]) + '月' + Number(p[2]) + '日 · ' + wk;
  const today = getTodayStr();
  if (ds === today) return '今天 · ' + label;
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (ds === getDateStr(y.getTime())) return '昨天 · ' + label;
  return label;
}

/* 合并组的展开键：用第一段的记录 id（只留字母数字，保证能当 DOM id） */
function _logGroupKey(g) {
  return String(g.segments[0].id == null ? 'g' : g.segments[0].id).replace(/[^0-9a-zA-Z_-]/g, '_');
}

/* 合并组的展开/收起：只切 display，不重绘列表（重绘会丢滚动位置） */
function toggleLogGroup(key) {
  _logOpenGroups[key] = !_logOpenGroups[key];
  const el = document.getElementById('logsub-' + key);
  if (!el) return;
  el.style.display = _logOpenGroups[key] ? 'block' : 'none';
  const badge = el.parentNode ? el.parentNode.querySelector('.tag-merge') : null;
  if (badge) badge.textContent = (badge.getAttribute('data-base') || '') + (_logOpenGroups[key] ? ' ▴' : ' ▾');
}

/* 计划关联行的内容：这条专注挂着哪个计划的哪一步 —— 四象限 / 标签 / 子任务。
   传进来的是「若干条记录」：单条就传它自己，合并组传组里的全部分段，
   按组去重汇总 —— 同一个计划做了两段，「重科·数学 / 第3题」这些标签不该消失
   （合并恰恰发生在最常出现的场景：一个计划连着做了好几段）。 */
function planLinkBitsOf(rows) {
  const quads = [],
    tags = [],
    subs = [];
  (rows || []).forEach(function (r) {
    if (!r) return;
    if (r.quad && quads.indexOf(r.quad) < 0) quads.push(r.quad);
    if (r.tag && tags.indexOf(r.tag) < 0) tags.push(r.tag);
    if (r.subTitle && subs.indexOf(r.subTitle) < 0) subs.push(r.subTitle);
  });
  /* ★ 有 planSubs 快照时**不再画**「└ 某一步」标签：快照把整条计划的每一步
     连 ✓/○ 都摊开了，再单独标一次「正在做的那一步」就是同一个信息画两遍
     （截图复核时逮到的：卡片上同时出现「└ 亲自考察一轮」和「○ 亲自考察一轮」）。
     subTitle 只在**没有快照**的老记录上才作为唯一线索保留。 */
  const _hasSnapshot = (rows || []).some(function (r) {
    return r && Array.isArray(r.planSubs) && r.planSubs.length;
  });
  const SUB_MAX = 3; /* 标签一多整行会折得很难看，超过就折成「等 N 项」 */
  let bits = '';
  quads.forEach(function (q) {
    bits += quadBadgeHtml({ quad: q });
  });
  tags.forEach(function (t) {
    bits += '<span class="timeline-tag tag-label">' + escapeHtml(t) + '</span>';
  });
  if (!_hasSnapshot) {
    subs.slice(0, SUB_MAX).forEach(function (s) {
      bits += '<span class="timeline-tag tag-sub">└ ' + escapeHtml(s) + '</span>';
    });
    if (subs.length > SUB_MAX) bits += '<span class="timeline-tag tag-sub">等 ' + subs.length + ' 项</span>';
  }
  const link = bits ? '<div class="log-row-meta3">' + bits + '</div>' : '';
  return link + planSubsHtmlOf(rows);
}

/* 计划子任务快照行：把「这个计划走到哪几步了」摊开在日志里。
   只有记录里存了快照才画（老记录没有这个字段 → 不占位置）；
   合并组取第一段带快照的 —— 同一天同一计划的快照基本一致，不必逐段重复。

   ★ 计划归属胶囊与「今天完成」条**共用 .plan-chip**（见 50_journey.css）：
     完成条 = ✅ 计划名｜记录卡 = 📋 计划名，同一个计划两处长得是一家人。
   ★ 与旧版的关键差别：**不再因为「记录名 == 计划名」就把计划名藏起来**。
     那条去重规则本意是少重复，实际效果却是「关联最紧的那几条记录，恰恰看不出关联」——
     用户截图里抱怨的正是这个。
   独立记录（既无 planTitle 也无 todoId）依旧整行不画 —— 这条口径由 C47 的 B4 守着。 */
function planSubsHtmlOf(rows) {
  let subs = null,
    planTitle = '',
    todoId = null,
    _subsAt = -1;
  (rows || []).forEach(function (r) {
    if (!r) return;
    if (!planTitle && r.planTitle) planTitle = r.planTitle;
    if (todoId == null && r.todoId != null) todoId = r.todoId;
    /* ★ 合并组取**最晚的那份快照**，不是第一份。
       快照一律按「本段结束时刻」截断（见 snapshotPlanSubs 的 cutoffMs），
       所以第 1 段那份看不到第 2 段里勾掉的步骤。组的跨度是两段之和，
       只有取最晚那份才覆盖得住 —— 否则步骤勾了却哪张卡上都不显示，
       而「N 步未完成」还会按第 1 段的口径少算一遍。
       用 endTime 比较而不是数组下标：调用方传进来的顺序不保证。 */
    if (Array.isArray(r.planSubs) && r.planSubs.length) {
      const _at = Number(r.endTime || r.startTime || 0);
      if (_at >= _subsAt) { subs = r.planSubs; _subsAt = _at; }
    }
  });
  /* 只写了 todoId、没写 planTitle 的老格式：能反查就反查，查不到才算独立记录 */
  if (!planTitle && todoId != null) {
    const t = (appData.todos || []).find(function (x) {
      return x && String(x.id) === String(todoId);
    });
    if (t) planTitle = t.title || '';
  }
  /* 计划胶囊只在「记录标题 ≠ 计划名」时才画 —— 两者相同时，卡片标题已经把计划名
     讲了一遍，再来一枚「📋 同一个词」就是把同一句话说两遍（用户截图点名）。
     ★ 与上一版的差别很重要：上一版是只要同名就**一律**藏起来，结果"关联最紧的那几条
       记录反而看不出关联"；这次改成**逐条比较** —— 只压掉真正重复的那一种，
       名字不同时照旧显示（它在那时提供的是新信息）。 */
  /* 卡片的标题字段是 taskName（见上方日志卡渲染），不是 title —— 取组内第一条非空的 */
  let _recTitle = '';
  for (let _i = 0; _i < (rows || []).length; _i++) {
    const _t = String((rows[_i] && rows[_i].taskName) || '').trim();
    if (_t) { _recTitle = _t; break; }
  }
  const _showChip = !!planTitle && String(planTitle).trim() !== _recTitle;
  const head = _showChip ? '<span class="plan-chip">📋 ' + escapeHtml(planTitle) + '</span>' : '';
  if (!head && !subs) return '';
  /* 子步骤 chips：
     10-15 那版把每一步都摊成 ○/✓ 胶囊，一条 5 步的计划挂 5 枚 → 用户嫌乱，整块拿掉。
     但全拿掉之后「这条记录做完了哪一步」在日志里彻底看不见了（需求 10-18 报的就是这个）。
     折中：**只摊已完成的**（它们是这条记录的成果，有信息量），
     未完成的压成一枚「N 步未完成」——重复出现在每张卡上的待办清单没有信息量，
     那是点开计划自己会看到的东西。 */
  let chips = '';
  if (subs) {
    const cap = typeof LOG_PLAN_SUB_SHOW_MAX === 'number' ? LOG_PLAN_SUB_SHOW_MAX : 6;
    const doneSubs = subs.filter(function (s) { return s && s.d; });
    const leftN = subs.length - doneSubs.length;
    chips = doneSubs.slice(0, cap).map(function (s) {
      return '<span class="log-sub-chip done">✓ ' + escapeHtml((s && s.t) || '未命名') + '</span>';
    }).join('');
    if (doneSubs.length > cap) chips += '<span class="log-sub-chip more">等 ' + doneSubs.length + ' 步</span>';
    if (leftN > 0) chips += '<span class="log-sub-chip more">' + leftN + ' 步未完成</span>';
  }
  return '<div class="log-row-plan">' + head + chips + '</div>';
}

/* 时间轴一行。单条记录直接渲染；合并组（同任务名 + 同类型，相接 ≤10 分钟，
   或起止时间重复）折成一行，下面挂原始分段（默认收起，点标题行展开）。
   合并只发生在这里 —— appData.records 一条没动，统计口径也不受影响。 */
function renderLogGroupHTML(g, isLast) {
  const TM = {
    full: ['完整🍅', 'full'],
    half: ['半个🍅', 'half'],
    incomplete: ['未完成', 'incomplete'],
    interrupted: ['打断', 'interrupted'],
    log: ['仅记录', 'log']
  };
  const tp = TM[g.type] || ['未知', ''];
  const tag = tp[0], cls = tp[1];
  const isMerged = g.segments.length > 1 || g.dropped > 0;
  const timeStr = fmtTime(new Date(g.startTime)) + '–' + fmtTime(new Date(g.endTime));
  /* 单条卡片只报**类型**，不报 ×N：类型本身就是"半个/一个"，再乘一遍会写出
     「半个🍅 ×0.5」这种读起来像"半个的半个"的东西。合并组另按段数计数。 */
  const pomoTxt = tag;
  const _dur = groupDurationText(g);
  const durHtml = _dur ? '<span class="timeline-dur">' + _dur + '</span>' : '';
  const iTag =
    g.interruptCount > 0
      ? '<span class="timeline-tag tag-interrupt">打断' + g.interruptCount + '次</span>'
      : '';
  const dot =
    '<span class="timeline-dot ' + cls + (g.pending ? ' pending' : '') + (isMerged ? ' grouped' : '') + '"></span>';
  /* 补记没写名字的不叫「未命名任务」——直接把「这里缺个名字」摆出来 */
  const titleHtml = g.taskName
    ? escapeHtml(g.taskName)
    : '<span style="color:var(--text-light);font-style:italic;font-weight:600;">未命名（点开可补）</span>';

  if (!isMerged) {
    const r = g.segments[0];
    const noteHtml = r.note ? '<div class="log-record-note">' + escapeHtml(r.note) + '</div>' : '';
    const _scmp = formatStateComparison(r);
    const pendingTag = g.pending ? '<span class="timeline-tag tag-pending">待补填</span>' : '';
    /* ★ 这个位置永远只显示用户自己填的「预计🍅」，绝不改成别的字样。
       写成「有预计显示预计、没有预计就退回显示实际」的话，
       用户自己填好的预计过一阵会在同一条卡片上变成「实际」，像被系统换掉了。
       所以标签永不变脸 —— 没有预计就什么都不显示；实际番茄数由左边的
       类型标签（✓完整🍅×N）表达，不在这里重复。 */
    const pomoInfo =
      r.expectedPomodoros != null
        ? '<span class="timeline-tag tag-plan">预计' + fmtTomatoNum(r.expectedPomodoros) + '</span>'
        : '';
    /* 第二层只留「时段 + 类型」；预计/实际、打断、待补填、电量心情全部收进第三层，
       这样每张卡片都是固定的四行，不随标签多少乱换行 */
    const metaBits = '<span class="timeline-tag tag-' + cls + '">' + pomoTxt + '</span>' + pomoInfo + iTag + pendingTag + _scmp;
    const meta2 = metaBits ? '<div class="log-row-meta2">' + metaBits + '</div>' : '';
    /* 计划关联行：独立专注没这些字段就不占位置（见 planLinkBitsOf） */
    const metaLink = planLinkBitsOf([r]);
    return (
      '<div class="timeline-item"><div class="timeline-content" onclick="openRecordDetail(' + idArg(r.id) + ')">' +
      '<div class="log-row-head">' + dot +
      '<span class="timeline-title">' + titleHtml + '</span></div>' +
      '<div class="timeline-time-line"><span class="timeline-time">' + timeStr + '</span>' + durHtml + '</div>' +
      meta2 + metaLink +
      noteHtml +
      '<div class="timeline-more" onclick="event.stopPropagation();showMoreMenu(event,' + idArg(r.id) + ')">⋮</div>' +
      '</div></div>'
    );
  }
  const key = _logGroupKey(g);
  const open = !!_logOpenGroups[key];
  /* 组头标签：**多段一律按类型计数**，不报第一段的类型。
     只看类型是否一致（原来只在 mixedTypes 时计数）会漏掉最常见的组合：
     连着两段「半个🍅」合并成一组，组头写「半个🍅 ×1」——数字是组内番茄之和（=1），
     标签名字却是第一段的类型，读起来就是"今天只做了半个"。按类型计数写「半个🍅 ×2」，
     数字（2 段）和标签粒度（半个）才对得上；合计多少🍅由下面的徽标补。 */
  let mergedTag = pomoTxt;
  if (g.segments.length > 1) {
    const byType = {};
    g.segments.forEach(function (s) {
      byType[s.type] = (byType[s.type] || 0) + 1;
    });
    mergedTag = Object.keys(byType)
      .map(function (t) {
        const m = TM[t] || ['未知', ''];
        return m[0] + ' ×' + byType[t];
      })
      .join(' + ');
  }
  const _badgeParts = [];
  if (g.segments.length > 1) _badgeParts.push('连续 ' + g.segments.length + ' 段');
  /* 组内番茄之和与段数对不上时（两个半个 = 1 个🍅）把合计写出来，
     省得用户自己去数「×2」到底等于几个番茄 */
  if (g.segments.length > 1 && g.pomos > 0) {
    const _perSeg = g.segments.map(function (s) { return getPomos(s); });
    if (_perSeg.some(function (p) { return p !== _perSeg[0]; }) || _perSeg[0] !== 1) {
      _badgeParts.push('合计 ' + fmtTomatoNum(g.pomos) + '🍅');
    }
  }
  if (g.dropped) _badgeParts.push(g.segments.length > 1 ? '去重 ' + g.dropped + ' 条' : '重复 ' + g.dropped + ' 条已并入');
  const badge = _badgeParts.join(' · ');
  /* 合并组的「简介」：把各段的备注**拼起来**（内容相同的只留一份，两段一样时不重复写两遍）。
     ★ 放在**组头**而不是只藏在展开的子段里 —— 默认收起时也得看得见，否则合并等于把备注吞了。 */
  const _notes = [];
  g.segments.forEach(function (s) {
    const n = String(s.note || '').trim();
    if (n && _notes.indexOf(n) < 0) _notes.push(n);
  });
  const groupNoteHtml = _notes.length
    ? '<div class="log-record-note">' + escapeHtml(_notes.join(' · ')) + '</div>'
    : '';
  const subs = g.segments
    .map(function (s) {
      const _sd = recordDurationText(s);
      const _m = TM[s.type] || ['未知', ''];
      /* 混合组里每段标出自己的结算结果，否则用户看不出哪段是完整、哪段是半个 */
      const _typeTag = g.mixedTypes
        ? '<span class="log-sub-type tag-' + _m[1] + '">' + _m[0] + '</span>'
        : '';
      return '<div class="log-sub-item"><span class="log-sub-time">' +
        fmtTime(new Date(s.startTime)) + '–' + fmtTime(new Date(s.endTime)) + '</span>' +
        _typeTag +
        '<span class="log-sub-dur">' + _sd + '</span>' +
        '<span class="log-sub-act" onclick="event.stopPropagation();openRecordDetail(' + idArg(s.id) + ')">详情</span>' +
        '<span class="log-sub-act" onclick="event.stopPropagation();showMoreMenu(event,' + idArg(s.id) + ')">⋮</span></div>';
    })
    .join('');
  return (
    '<div class="timeline-item"><div class="timeline-content grouped" onclick="toggleLogGroup(\'' + key + '\')">' +
    '<div class="log-row-head">' + dot +
    '<span class="timeline-title">' + titleHtml + '</span></div>' +
    '<div class="timeline-time-line"><span class="timeline-time">' + timeStr + '</span>' + durHtml + '</div>' +
    '<div class="log-row-meta2">' + '<span class="timeline-tag tag-' + cls + '">' + mergedTag + '</span>' + iTag +
    '<span class="timeline-tag tag-merge" data-base="' + badge + '">' + badge + (open ? ' ▴' : ' ▾') + '</span></div>' +
    planLinkBitsOf(g.segments) +
    groupNoteHtml +
    '<div class="log-sub-wrap" id="logsub-' + key + '" style="display:' + (open ? 'block' : 'none') + ';">' + subs + '</div>' +
    '</div></div>'
  );
}

/* 一天的记录统计：条数 / 记录时长 / 专注时长 / 番茄数。
   日志页的日期头和回顾弹窗的日期卡**共用这一份口径** —— 两个地方各算各的，
   迟早会出现「日志页说 1.2 小时、回顾里说 45 分钟」这种互相打脸。

   ★ 专注时长 = **实际计时秒数**（focusSec），不是番茄账。
     getPomos 是结算时自评出来的结果：同样坐了 25 分钟，可以记「完整🍅」也可以记
     「半个🍅」——拿它乘 25 分钟当"时长"，等于让自评去改时间：连着记两个半个，
     50 分钟的专注只会说成 25 分钟。时长只认秒表，成果只认🍅，两个数各说各的。 */
function logDayStats(dayRecs) {
  let sec = 0,
    focusSec = 0,
    pomo = 0;
  (dayRecs || []).forEach(function (r) {
    const s = recordSeconds(r);
    sec += s;
    if (!isLogRecord(r)) focusSec += s;
    pomo += getPomos(r);
  });
  return {
    count: (dayRecs || []).length,
    sec: sec,
    focusSec: focusSec,
    dur: fmtMinUnit(Math.round(sec / 60)),
    pomo: pomo,
    focus: fmtMinUnit(Math.round(focusSec / 60))
  };
}

/* 一天的摘要文案：`3 条 · 记录 1.2 小时 · 专注 50 分钟 · 🍅 ×2`。
   两个时长各说各的账：记录 = 每条记录的实际时长合计（含「仅记录」）；
   专注 = 只算专注型记录的实际时长（仅记录不算）。为 0 的项不占位置。
   pomo（折算番茄数）默认跟在最后；日志页的日期头传 false 单独画一个强调色 span。 */
function logDaySummaryText(st, withPomo) {
  let s = st.count + ' 条';
  if (st.dur.num !== '0') s += ' · 记录 ' + st.dur.num + ' ' + st.dur.unit;
  if (st.focus.num !== '0') s += ' · 专注 ' + st.focus.num + ' ' + st.focus.unit;
  if (withPomo !== false && st.pomo > 0) s += ' · 🍅 ×' + fmtTomatoNum(st.pomo);
  return s;
}

/* 「今天完成的任务」条：日志页与回顾弹窗共用（都走 dayLogBlockHtml）。
   老流水条目没有 subs 字段 → 仍然只显示标题，不会报错也不会显示空壳。
   这里**不是**番茄记录，是勾选完成的事项，所以和下面的记录卡分开摆。 */
/* 「今天完成」条：**只列当天没有对应专注记录**的完成项。
   只要今天计过时，下面的记录卡里已经带着「📋 计划名 + 子任务✓○」了；
   再在最上面按「勾选完成」的口径铺一遍，同一条信息就画了两遍，
   而且口径还是「打过勾」而不是「专注过」——看着就是两张皮。
   dayRecs 传当天的原始记录（dayLogBlockHtml 手上有）；不传则退化为全列（兼容旧调用）。 */
function doneTodosStripHtml(date) {
  const arr = (appData.todoDoneLog || {})[date];
  if (!Array.isArray(arr) || !arr.length) return '';
  /* 不再区分「未计时」：直接展示当天全部完成计划（用户点名，全量统计）。 */
  const cap = typeof LOG_PLAN_SUB_SHOW_MAX === 'number' ? LOG_PLAN_SUB_SHOW_MAX : 6;
  /* partial 条（只勾了子计划，整条计划没打勾）不占「N 项」的名额：
     用户点的口径是「勾一个子计划 ≠ 做完一件事」，计数只认整条打勾的。
     但它照样要在日志里留痕 —— 否则「我今天推进了 3 步」这件事就没了。 */
  const _fullN = arr.filter(function (x) { return x && x.title && !x.partial; }).length;
  const _partN = arr.length - _fullN;
  const rows = arr.map(function (x) {
    if (!x || !x.title) return '';
    const quad = x.quad ? quadBadgeHtml({ quad: x.quad }) : '';
    const _ps = x.partial ? todoSubProgress({ subs: (x.subs || []).map(function (s) { return { done: !!(s && s.d) }; }) }) : null;
    /* 子计划竖排挂靠主计划：不再是平铺胶囊，而是缩进 + 竖线，一眼看出
       这一堆子步骤属于上面那个主计划（用户点名：子计划要知道主计划是谁）。 */
    let subsHtml = '';
    if (Array.isArray(x.subs) && x.subs.length) {
      const shown = x.subs.slice(0, cap);
      subsHtml = shown.map(function (s) {
        const done = !!(s && s.d);
        return (
          '<div class="done-todo-sub' + (done ? ' done' : '') + '">' +
          '<span class="done-todo-sub-txt">' + escapeHtml((s && s.t) || '未命名') + '</span>' +
          '</div>'
        );
      }).join('');
      if (x.subs.length > cap) subsHtml += '<div class="done-todo-sub more">等 ' + x.subs.length + ' 步</div>';
      subsHtml = '<div class="done-todo-subs">' + subsHtml + '</div>';
    }
    /* 整条完成 → 主行 ✅ + 加粗标题；只做了几步 → 主行不挂 ✅，
       改挂「做了 2/5 步」，主次一眼分得开（不把推进说成完成）。 */
    return (
      '<div class="done-todo-row' + (x.partial ? ' partial' : '') + '">' +
      '<div class="done-todo-plan">' +
      (x.partial
        ? '<span class="done-todo-check part">◐</span>'
        : '<span class="done-todo-check">✅</span>') +
      '<span class="done-todo-title">' + escapeHtml(x.title) + '</span>' +
      (x.partial && _ps ? '<span class="done-todo-partn">做了 ' + _ps.done + '/' + _ps.total + ' 步</span>' : '') +
      quad + '</div>' +
      subsHtml +
      '</div>'
    );
  }).join('');
  if (!rows) return '';
  /* ★ 文案要跟日期走：过去那些天写「今天完成」是在说谎（用户 10-15 截图里
     10月12日 底下挂着「✅ 今天完成 · 3 项」）。当天才叫今天，别的一律「当天完成」。 */
  const _isToday = date === getTodayStr();
  const _day = _isToday ? '今天' : '当天';
  let label;
  if (!_fullN) {
    /* 一条都没整条勾完：别写「完成 · 0 项」——那读起来像什么都没干 */
    label = _day + '推进了 ' + _partN + ' 条计划';
  } else {
    label = _day + '完成 ' + _fullN + ' 项';
    if (_partN > 0) label += ' · 推进 ' + _partN + ' 条';
  }
  /* 默认折叠 + 明显的「展开/收起」按钮（用户点名：折叠按钮不明显） */
  return (
    '<div class="done-todo-strip">' +
    '<div class="done-todo-head" role="button" tabindex="0" onclick="toggleDoneTodoBody(this)" aria-expanded="false">' +
    '<span class="done-todo-label">✅ ' + label + '</span>' +
    '<span class="done-todo-toggle"><span class="done-todo-caret" aria-hidden="true">▸</span><span class="done-todo-hint">展开</span></span>' +
    '</div>' +
    '<div class="done-todo-body" style="display:none">' + rows + '</div>' +
    '</div>'
  );
}

/* 折叠切换：展开/收起「今天完成 · N 项」清单（doneTodosStripHtml 的 body）。 */
function toggleDoneTodoBody(head) {
  if (!head) return;
  var body = head.nextElementSibling;
  if (!body) return;
  var show = body.style.display === 'none';
  body.style.display = show ? '' : 'none';
  head.setAttribute('aria-expanded', show ? 'true' : 'false');
  var caret = head.querySelector('.done-todo-caret');
  if (caret) caret.textContent = show ? '▾' : '▸';
  var hint = head.querySelector('.done-todo-hint');
  if (hint) hint.textContent = show ? '收起' : '展开';
}

/* 某一天的日志块（日期头 + 记录卡片）：日志页和回顾弹窗「看这一天的记录」共用。
   合并与单行渲染仍走 mergeLogRecords / renderLogGroupHTML，这里只负责
   把一天摆成一块，并且让「哪天算哪天」只有一处定义。
   opts.headless=true 时不画日期头（回顾弹窗自己有一层标题，不必重复）。 */
function dayLogBlockHtml(date, dayRecs, opts) {
  opts = opts || {};
  const st = logDayStats(dayRecs);
  let html = '';
  if (!opts.headless) {
    /* 只勾了完成计划、没计过时的那天没有记录账，摘要别写「0 条」——
       那不是「记了 0 条」，是「这天没计时」。空着比写 0 诚实。 */
    html +=
      '<div class="log-date-header" data-date="' + date + '"' +
      (date === getTodayStr() ? ' data-today="1"' : '') +
      '><span>' + fmtDayLabel(date) + reviewBadgeHtml(date, getTodayStr()) + '</span>' +
      '<span class="log-date-sum">' + (st.count ? logDaySummaryText(st, false) : '') +
      /* 番茄数单独一格强调色：它是「成果」，和时长不是一个口径，
         混在灰字里会被当成「又一个时长」读过去 */
      (st.count && st.pomo > 0 ? '<span class="log-date-pomo">🍅 ×' + fmtTomatoNum(st.pomo) + '</span>' : '') +
      '</span></div>';
  }
  const gs = mergeLogRecords(dayRecs);
  html += doneTodosStripHtml(date);
  /* ★ 没有记录就别画空卡片：日期池现在也收「只勾了完成计划」的日子，
     那种日子 gs 为空，原来会渲染出一个空的 .log-day-card（一条横线）。 */
  if (gs.length) {
    html += '<div class="log-day-card">';
    for (let gi = 0; gi < gs.length; gi++) html += renderLogGroupHTML(gs[gi], gi === gs.length - 1);
    html += '</div>';
  }
  return html;
}

/* ===== 艾宾浩斯「回顾」（遗忘曲线复习计划）=====
 * 复习对象是「日期」：把每个有专注记录的日子当成一张记忆卡。
 * 算法全在 00_pure_core.js（EBBINGHAUS_INTERVALS / ebReview / ebIsDue / ebStageName），
 * 这里只负责「读 appData → 算待办 → 画界面」，不含任何间隔常数。 */
function reviewDatesWithRecords() {
  const set = {};
  (appData.records || []).forEach(function (r) {
    if (!r || !r.startTime) return;
    set[getDateStr(r.startTime)] = true;
  });
  return Object.keys(set).sort().reverse();
}

function reviewState(date) {
  const m = appData.reviewStages || {};
  return m[date] || null;
}

/* 待回顾 = 有记录的日期中「今天到期」的那些；从未排过期的记录从次日起才第一次回顾 */
function dueReviewDates(today) {
  return reviewDatesWithRecords().filter(function (d) {
    const st = reviewState(d);
    if (!st) return d < today;
    return d <= today && ebIsDue(st, today);
  });
}

/* 某一天的记录集（回顾的「一张卡」就是这一天），按日志页同样的顺序 */
function reviewDayRecords(date) {
  return (appData.records || []).filter(function (r) {
    return r && r.startTime && getDateStr(r.startTime) === date;
  });
}

function reviewDaySummary(date) {
  const names = [];
  let planLine = '';
  reviewDayRecords(date).forEach(function (r) {
    /* 芯片用任务名（= 计划名）优先，子任务名只作兜底 —— 之前把子任务名顶上来，
       结果回顾里全是「XX（子任务）」，反而看不出那天做的是哪个计划。 */
    const n = r.taskName || r.subTitle || r.note || '未命名';
    if (names.indexOf(n) < 0) names.push(n);
    /* 计划步骤：取第一条带快照的记录，摊出「计划名：3/5 步 · 甲 · 乙 …」 */
    if (!planLine) {
      const txt = planSubsSummaryText(r.planSubs);
      if (txt) planLine = (r.planTitle ? r.planTitle + '：' : '') + txt;
    }
  });
  if (!names.length) return '';
  const shown = names.slice(0, REVIEW_CHIP_MAX);
  const more = names.length - shown.length;
  return (
    '<div class="review-chips">' +
    shown.map(function (n) { return '<span class="review-chip">' + escapeHtml(n) + '</span>'; }).join('') +
    (more > 0 ? '<span class="review-chip review-chip--more">+' + more + '</span>' : '') +
    '</div>' +
    (planLine ? '<div class="review-plan-line">📋 ' + escapeHtml(planLine) + '</div>' : '')
  );
}

/* 回顾三档自评按钮（列表卡与「看这一天的记录」里共用同一份，含图标与提示） */
function reviewGradeButtonsHtml(date, cls) {
  return (
    '<div class="review-grades' + (cls ? ' ' + cls : '') + '">' +
    REVIEW_GRADES.map(function (g) {
      return (
        '<button class="review-grade-btn" data-grade="' + g.key + '" onclick="gradeReview(\'' + date + '\',\'' + g.key + '\')"' +
        ' title="' + escapeHtml(g.hint) + '"><span class="rg-icon">' + escapeHtml(g.icon) + '</span>' +
        '<span class="rg-label">' + escapeHtml(g.label) + '</span></button>'
      );
    }).join('') +
    '</div>'
  );
}

function openReviewDay(date) {
  _reviewDayView = date;
  renderReviewModal();
}

function reviewBackToList() {
  _reviewDayView = null;
  renderReviewModal();
}

function openReviewModal() {
  _reviewDayView = null;
  _reviewShownPages = 0; /* 每次打开都从第一屏开始，别接着上次的展开深度 */
  renderReviewModal();
  showModal('reviewModal');
}

/* ===== 回顾列表一次最多看几天 =====
   回顾的对象是「一天」，断更一两周回来，待回顾列表一次铺几十张卡，滚不到底也复习不完。
   上限落盘在 settings.reviewMaxDays（0 = 不限，缺省 = REVIEW_MAX_DAYS_DEFAULT）。
   ★ 只决定「画多少张」：被折起的天仍然在 dueReviewDates 里，点「再看 N 天」就接着铺，
     自评、斩掉、恢复一切照旧；排期算法一个字都没动。 */
const REVIEW_MAX_DAYS_DEFAULT = 10;
/* ★ 2026-11-05：原来是 [5,10,15,20,30,0] 的下拉框，用户问「为什么最少只有 5 天」——
   一个"最多显示几天"的显示口径，没有理由替他定档。改成自由填写的数字框：
   填 1 也行，填 200 也行，留空 / 填 0 = 不限。下面的 REVIEW_MAX_DAYS_CHOICES 只剩
   「快捷芯片」的用处，不再是可选范围。 */
const REVIEW_MAX_DAYS_CHOICES = [3, 5, 10, 20, 30];
const REVIEW_MAX_DAYS_LIMIT = 365;
/* ===== 这到底是「显示上限」还是「今天的额度」？——是额度（2026-11-05 定）=====
   一开始做成「列表一次最多显示 N 张」，剩下的折在「再看 N 天」后面。用户实测立刻报：
   「设 5 天，每看完一天它又多给一天，永远是 5 天」——因为上限是对**当前待回顾列表**的
   滑动窗口：自评完一天它离开列表，窗口让位给下一天，看起来就是无穷无尽。
   用户要的是「今天只回顾这么多天，回顾完就收工」。所以口径改成**每日额度**：
     · 已回顾天数 = reviewStages 里 last === 今天 的条数（self-graded 才算，打开不点不算）
     · 今天还能看 = 额度 − 已回顾
     · 额度用完就不再自动补，剩下的天明确写着「明天再来」；
       真想今天多回顾，点那颗显式按钮把额度 +N（只对今天有效）。
   ★ 不变的是：只影响「画几张」，排期算法、被折起的天照常留在 due 里。 */
function reviewMaxDays() {
  const raw = appData.settings ? appData.settings.reviewMaxDays : undefined;
  if (raw === 0 || raw === '0') return 0; /* 明确选了「不限」 */
  const n = parseInt(raw, 10);
  return n > 0 ? Math.min(n, REVIEW_MAX_DAYS_LIMIT) : REVIEW_MAX_DAYS_DEFAULT;
}
/* 今天已经自评过几天（打开卡片但没自评的不算） */
function reviewDoneToday(today) {
  const m = (appData && appData.reviewStages) || {};
  let n = 0;
  Object.keys(m).forEach(function (d) {
    const st = m[d];
    if (st && typeof st === 'object' && st.last === today) n++;
  });
  return n;
}
/* 「今天再看 N 天」的临时放宽：只对今天有效，跨天自动作废（不写进 settings 的常规项） */
function reviewQuotaBonus(today) {
  const b = (appData.settings && appData.settings.reviewQuotaBonus) || null;
  if (!b || b.date !== today) return 0;
  const n = parseInt(b.days, 10);
  return n > 0 ? n : 0;
}
function setReviewQuotaBonus(days, today) {
  if (!appData.settings) appData.settings = {};
  appData.settings.reviewQuotaBonus = { date: today, days: days > 0 ? days : 0 };
  saveData();
}
function setReviewMaxDays(v) {
  if (!appData.settings) appData.settings = {};
  const n = parseInt(v, 10);
  /* 空 / 0 / 非数字 → 不限（输入框的 placeholder 就是「不限」，清空等于不限） */
  appData.settings.reviewMaxDays = n > 0 ? Math.min(n, REVIEW_MAX_DAYS_LIMIT) : 0;
  /* 改了额度，今天手动加的那部分一并作废，否则「改成 5 天却还显示 10 张」 */
  appData.settings.reviewQuotaBonus = { date: getTodayStr(), days: 0 };
  saveData();
  renderReviewSettingsModal();
  renderReviewModal();
  const cap = reviewMaxDays();
  showToast(cap ? '每天最多回顾 ' + cap + ' 天' : '不限额，能回顾多少就多少');
}
/* 显式「今天再多看 N 天」：额度 +N（只今天），不是自动补位 */
function reviewShowMore(days) {
  const today = getTodayStr();
  const cap = reviewMaxDays();
  const add = parseInt(days, 10) > 0 ? parseInt(days, 10) : (cap || 5);
  setReviewQuotaBonus(reviewQuotaBonus(today) + add, today);
  renderReviewModal();
}

/* ===== 回顾弹窗（两个视图：待回顾列表 / 某一天的记录）=====
   设计：回顾的对象是「一天」，所以一天就是一张卡 —— 卡上先给出这天的样子
   （几条、多久、做了什么），要细看就点进「那天的日志」整块读。
   自评按钮独立成行，不跟「点开」抢同一片点击区（点错了就得退出重来）。 */
function renderReviewModal() {
  const box = document.getElementById('reviewModalBody');
  if (!box) return;
  const today = getTodayStr();
  if (_reviewDayView) {
    box.innerHTML = reviewDayDetailHtml(_reviewDayView, today);
    return;
  }
  const all = reviewDatesWithRecords();
  if (!all.length) {
    box.innerHTML =
      '<div class="empty-state"><span class="empty-icon">🧠</span><div class="empty-title">还没有可回顾的记录</div>' +
      '<div class="empty-desc">专注记录几天后，这里会自动排出回顾计划</div></div>';
    return;
  }
  const due = dueReviewDates(today);
  const cap = reviewMaxDays();
  /* 今天的额度：额度 − 今天已自评的天数 + 手动放宽的部分（只在今天有效） */
  const doneToday = reviewDoneToday(today);
  const bonus = reviewQuotaBonus(today);
  const quotaTotal = cap ? cap + bonus : 0;
  const leftToday = cap ? Math.max(0, quotaTotal - doneToday) : due.length;
  const shown = cap ? Math.min(due.length, leftToday) : due.length;
  /* hero 标题：说清「今天还剩几张」，不是「一共欠多少张」 —— 断更两周回来看到
     「今天该回顾 25 天」只会焦虑，而额度口径下他今天只需要处理 5 张。 */
  const heroLeft = cap ? Math.min(due.length, leftToday) : due.length;
  let html =
    '<div class="review-hero' + (due.length ? '' : ' review-hero--done') + '">' +
    '<div class="review-hero-num">' + (cap ? (shown > 0 ? shown : '✓') : due.length) + '</div>' +
    '<div class="review-hero-text"><div class="review-hero-lab">' +
    (due.length
      ? (cap
          ? (leftToday > 0
              ? '今天要回顾 ' + heroLeft + ' 天' + (due.length > shown ? '（还有 ' + (due.length - shown) + ' 天排到明天）' : '')
              : '今天已经回顾 ' + doneToday + ' 天，收工 🌱')
          : '今天该回顾 ' + due.length + ' 天')
      : '今天没有要回顾的') +
    '</div><div class="review-hero-sub">按艾宾浩斯遗忘曲线排期 · 间隔 1→2→4→7→15→30→60 天</div></div>' +
    /* 回顾设置的入口从日志页操作区挪进回顾本身——这块设置本来就是回顾的显示口径。
       margin-left:auto 推到卡片最右；样式复用 .btn-small 再压成次要灰，不新增 CSS 类。
       回顾设置弹窗在 DOM 中位于回顾弹窗之后，同 z-index 下按源序盖在上层，关闭后自然回到这里。 */
    '<button class="btn-small" style="margin-left:auto; flex-shrink:0; background:var(--card); color:var(--text-light); border-color:var(--border)" onclick="openReviewSettingsModal()" title="回顾设置：每天回顾几天 / 已斩掉的天数 / 只看番茄">⚙️</button>' +
    '</div>';
  if (!due.length) {
    html += '<div class="review-empty">休息一天，明天再来 🌱</div>';
  } else {
    if (cap && leftToday <= 0) {
      /* 额度用完了：一张卡都不铺，明确告诉他今天到此为止，剩下的明天自动接上。
         ★ 关键就在这：不再「补位」—— 以前自评完一天窗口立刻让位给下一天，
           用户看到的是永远 5 张，以为列表坏了。 */
      html +=
        '<div class="review-quota-done">今天的 ' + doneToday + ' 天回顾完了，先歇着 🌱' +
        '<em>还有 ' + due.length + ' 天，明天接着来</em></div>';
    } else {
      html += due.slice(0, shown).map(function (d) { return reviewCardHtml(d, today); }).join('');
      if (shown < due.length) {
        const left = due.length - shown;
        html +=
          '<div class="review-quota-hint">今天的额度是 ' + cap + ' 天，还有 ' + left + ' 天排到明天</div>';
      }
    }
    if (cap && due.length > shown) {
      /* 显式放宽：只有用户自己点才加，默认永不自动补 */
      const more = Math.min(cap || 5, due.length - shown);
      html +=
        '<button class="review-more" onclick="reviewShowMore(' + more + ')">今天再看 ' + more + ' 天' +
        '<span class="review-more-sub">也可以明天再回顾</span> ›</button>';
    }
  }
  /* 已排期但还没到期：只报「哪天、几号回来」，给一个整体节奏感。
   条数同样服从「一次最多显示 N 天」，但标题必须报**实际总数** ——
   截断后报截断数，用户会以为本周只有 5 天排了期。 */
const upcomingAll = all
    .filter(function (d) { const s = reviewState(d); return s && s.next && s.next > today; })
    .sort(function (a, b) { return reviewState(a).next < reviewState(b).next ? -1 : 1; });
  const upCap = reviewMaxDays() || 0;
  const upcoming = upCap ? upcomingAll.slice(0, upCap) : upcomingAll.slice(0, 30);
  if (upcoming.length) {
    html +=
      '<details class="review-up-wrap"><summary class="review-h">已排期（' + upcomingAll.length + '）</summary>' +
      '<div class="review-upcoming">' +
      upcoming.map(function (d) {
        const st = reviewState(d);
        /* 未到期也能点开过一遍：只看不改 —— openReviewDay 只切到日详情视图，不碰排期。
           以前这里是一行纯文本，想提前复习只能干等。 */
        return (
          '<div class="review-up-row" role="button" tabindex="0" onclick="openReviewDay(\'' + d + '\')"' +
          ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openReviewDay(\'' + d + '\');}"' +
          ' title="点开提前过一遍（不会改动排期）"><span class="review-up-date">' + escapeHtml(fmtDayLabel(d)) + '</span>' +
          '<span class="review-up-stage">' + escapeHtml(ebStageName(st.level)) + '</span>' +
          '<span class="review-up-next">' + escapeHtml(st.next.slice(5)) + ' 再见</span></div>'
        );
      }).join('') +
      '</div></details>';
  }
  box.innerHTML = html;
}

/* 待回顾列表里的一张卡：日期 + 阶段 + 当天摘要 + 「看这天的日志」+ 三档自评 */
function reviewCardHtml(date, today) {
  const st = reviewState(date);
  const isNew = !st;
  const recs = reviewDayRecords(date);
  const stats = logDayStats(recs);
  return (
    '<div class="review-card' + (isNew ? ' review-card--new' : '') + '" data-date="' + date + '">' +
    '<div class="review-card-hit" onclick="openReviewDay(\'' + date + '\')">' +
    '<div class="review-card-top"><span class="review-date">' + escapeHtml(fmtDayLabel(date)) + '</span>' +
    '<span class="review-stage">' + escapeHtml(isNew ? '初次回顾' : ebStageName(st.level)) + '</span></div>' +
    '<div class="review-card-sum">' + escapeHtml(logDaySummaryText(stats)) + '</div>' +
    reviewDaySummary(date) +
    '<div class="review-open">看这天的日志 ›</div>' +
    '</div>' +
    reviewGradeButtonsHtml(date) +
    '</div>'
  );
}

/* 「某一天」的详情视图：标题 + 统计 + 这一天的整块日志（与日志页逐行同源）+ 自评 */
/* 回顾详情用哪批记录：开了「回顾时只看番茄」，就先把"仅记录 / 未完成"这类滤掉。
   只作用于**回顾页**；日志页有它自己的类型筛选，两者互不干扰。 */
function reviewRecsFor(date) {
  const all = reviewDayRecords(date);
  if (!isReviewPomodoroOnly()) return all;
  return all.filter(function (r) { return isPomodoroRecord(r); });
}
function reviewDayDetailHtml(date, today) {
  const recs = reviewRecsFor(date);
  const stats = logDayStats(recs);
  const st = reviewState(date);
  return (
    '<button class="review-back" onclick="reviewBackToList()">‹ 回到待回顾</button>' +
    '<div class="review-day-head" data-date="' + date + '">' +
    '<div class="review-day-date">' + escapeHtml(fmtDayLabel(date)) + '</div>' +
    '<div class="review-day-sum">' + escapeHtml(logDaySummaryText(stats)) +
    (st ? ' · ' + escapeHtml(ebStageName(st.level)) : '') + '</div></div>' +
    '<div class="review-day-body">' +
    (recs.length ? dayLogBlockHtml(date, recs, { headless: true }) : '<div class="review-empty">这一天的记录已经没有了</div>') +
    '</div>' +
    '<div class="review-day-foot"><div class="review-day-foot-lab">回顾完这一天，感觉如何？</div>' +
    reviewGradeButtonsHtml(date) + '</div>'
  );
}

/* 自评的实际写入（从 gradeReview 拆出：「斩掉」要先过一道确认再调它）。
   在「某一天」的详情里自评完 → 自动回到列表：这一天已经处理过了，
   停在原地只会让人以为没生效（卡片本身会从待回顾里消失）。 */
function applyReviewGrade(date, gradeKey) {
  if (!appData.reviewStages) appData.reviewStages = {};
  const today = getTodayStr();
  const next = ebReview(reviewState(date), gradeKey, today);
  /* 毕业原因落盘：'斩掉'（主动）与'记牢到顶'（自然）在旧数据里是同一个状态，
     分不开就分不清"我斩过哪些"。有 next 时不带 reason —— 恢复排期后就不该再有毕业原因。 */
  delete next.reason;
  if (!next.next) next.reason = gradeKey === REVIEW_GRADE_MASTERED ? 'mastered' : 'solid-top';
  appData.reviewStages[date] = next;
  saveData();
  _reviewDayView = null;
  renderReviewModal();
  if (next.next) {
    const g = reviewGradeMeta(gradeKey);
    showToast('已记录「' + (g ? g.label : gradeKey) + '」：' + next.next.slice(5) + ' 再回顾');
  } else if (gradeKey === REVIEW_GRADE_MASTERED) {
    showToast('✂️ 已斩掉，以后不再复习');
  } else {
    showToast('🎉 已记牢，不再排期');
  }
}

/* 界面入口：遗忘 / 熟练 / 记牢直接生效（后面还能再自评覆盖）；
   「斩掉」是一票毕业的不可逆语义动作，而按钮又排在最左（最容易误点）→ 先弹一次确认，
   取消则完全不动数据。弹窗不可用时回退原生 confirm（同一套 rsAsk 的既有约定）。 */
function gradeReview(date, gradeKey) {
  if (gradeKey !== REVIEW_GRADE_MASTERED) { applyReviewGrade(date, gradeKey); return; }
  const msg = '「斩掉」后 ' + date + ' 不再出现在回顾里，需要时可以到「回顾设置」里恢复。';
  if (typeof window.rsAsk === 'function') {
    window.rsAsk(msg, { title: '斩掉这一天', okText: '斩掉', danger: true }, function () {
      applyReviewGrade(date, gradeKey);
    });
    return;
  }
  if (window.confirm(msg)) applyReviewGrade(date, gradeKey);
}

/* 日志日期头上的回顾状态徽标（空串 = 不显示） */
function reviewBadgeHtml(date, today) {
  const st = reviewState(date);
  if (!st) return date < today ? '<span class="log-review-badge due">🧠 待回顾</span>' : '';
  if (ebIsDue(st, today)) return '<span class="log-review-badge due">🧠 待回顾</span>';
  if (st.next) return '<span class="log-review-badge">🧠 ' + escapeHtml(st.next.slice(5)) + '</span>';
  return '';
}

/* ===== 回顾设置（已斩掉的天数可恢复 + 回顾时只看番茄）=====
   两块都属于「回顾/日志」的显示口径，放一起：
   · 已斩掉的天数：从 appData.reviewStages 里挑出「不再排期」的（判据在纯核心 ebIsGraduated），
     恢复只是把它放回「今天该复习」——不改复习算法本身；
   · 只看番茄：**只影响回顾页**，落盘在 appData.settings.reviewPomodoroOnly（随全部数据导出/导入）。 */
function graduatedReviewDates() {
  const m = appData.reviewStages || {};
  /* 只列「至今仍有记录」的日期。记录被删或被清之后，appData.reviewStages 里对应的键
     就成了孤儿——继续列出来会让「恢复」去排期一个已经不存在的日子（点完什么也看不到），
     份数也会虚高。这里按 records 现算一次白名单，只放有记录的进来。 */
  const hasRec = {};
  (appData.records || []).forEach(function (r) {
    if (r && r.startTime) hasRec[getDateStr(r.startTime)] = true;
  });
  return Object.keys(m)
    .filter(function (d) { return ebIsGraduated(m[d]) && hasRec[d]; })
    .sort()
    .reverse();
}

/* 「回顾时只看番茄」的读与写：**只作用于回顾页**，不动日志页。
   日志页要同样效果，用类型下拉里的「只看🍅」—— 那边是筛选，不是设置。
   ★ 归属换过一次：原名叫 logPomodoroOnly，勾上会把**日志界面**也一起改掉，
     用户明确说"我真正的日志界面不需要那个呀"。现落在 settings.reviewPomodoroOnly。 */
function isReviewPomodoroOnly() {
  return !!(appData.settings && appData.settings.reviewPomodoroOnly);
}

function toggleReviewPomodoroOnly(on) {
  if (!appData.settings) appData.settings = {};
  appData.settings.reviewPomodoroOnly = !!on;
  saveData();
  renderReviewModal();
  showToast(on ? '回顾时只看有番茄的记录' : '回顾时显示全部记录');
}

function openReviewSettingsModal() {
  renderReviewSettingsModal();
  showModal('reviewSettingsModal');
}

function renderReviewSettingsModal() {
  const box = document.getElementById('reviewSettingsBody');
  if (!box) return;
  const dates = graduatedReviewDates();
  const rowsOf = function (list) {
    return list
      .map(function (d) {
        const recs = reviewDayRecords(d);
        let pomos = 0;
        recs.forEach(function (r) { pomos += getPomos(r); });
        return (
          '<div class="rs-day"><div class="rs-day-main"><b>' + escapeHtml(d) + '</b>' +
          '<span class="rs-day-sub">' + recs.length + ' 条记录 · ' + fmtTomatoNum(pomos) + ' 🍅</span></div>' +
          '<button class="btn-small" onclick="restoreReviewDate(\'' + escapeHtml(d) + '\')">恢复</button></div>'
        );
      })
      .join('');
  };
  const sec = function (title, list, empty) {
    return (
      '<div class="rs-sec"><div class="rs-sec-title">' + title + ' · ' + list.length + ' 天</div>' +
      (list.length ? '<div class="rs-days">' + rowsOf(list) + '</div>' : '<div class="rs-empty">' + empty + '</div>') +
      '</div>'
    );
  };
  box.innerHTML =
    '<div class="rs-sec">' +
    '<div class="rs-sec-title">每天回顾几天</div>' +
    '<div class="rs-row"><span>每天最多回顾<em>回顾完就收工，剩下的自动排到明天；留空或填 0 = 不限。只影响显示，不影响回顾排期</em></span>' +
    '<span class="rs-num-wrap"><input type="number" class="rs-select rs-num" min="1" max="' + REVIEW_MAX_DAYS_LIMIT +
    '" step="1" inputmode="numeric" placeholder="不限" value="' +
    (reviewMaxDays() || '') + '" onchange="setReviewMaxDays(this.value)" aria-label="每天最多回顾几天">' +
    '<i class="rs-num-unit">天</i></span>' +
    '</div>' +
    '<div class="rs-quick">' +
    REVIEW_MAX_DAYS_CHOICES.map(function (n) {
      return '<button type="button" class="rs-chip' + (reviewMaxDays() === n ? ' on' : '') +
        '" onclick="setReviewMaxDays(' + n + ')">' + n + ' 天</button>';
    }).join('') +
    '<button type="button" class="rs-chip' + (reviewMaxDays() === 0 ? ' on' : '') +
    '" onclick="setReviewMaxDays(0)">不限</button>' +
    '</div>' +
    '</div>' +
    '<div class="rs-sec">' +
    '<label class="rs-check"><input type="checkbox"' + (isReviewPomodoroOnly() ? ' checked' : '') +
    ' onchange="toggleReviewPomodoroOnly(this.checked)">' +
    '<span>回顾时只显示有番茄的记录<em>只在「回顾」里生效，隐藏「仅记录」和「未完成」；日志页不受影响</em></span></label>' +
    '</div>' +
    /* 合并成一组：不再区分「斩掉」与「练到顶」—— 老数据没存这个原因，
       分两组反而把以前斩掉的误归到「已掌握」（用户点名），合并最省事 */
    sec('✅ 已到顶 / 已斩掉（不再复习）', dates, '还没有不再复习的日子');
}

/* 恢复被斩掉的一天：放回待回顾队列（级别退回初学），日志页的徽标随之刷新 */
function restoreReviewDate(date) {
  if (!appData.reviewStages) appData.reviewStages = {};
  appData.reviewStages[date] = ebRestoreState(getTodayStr());
  saveData();
  renderReviewSettingsModal();
  renderLogs();
  showToast('已恢复 ' + date + '，可以重新回顾了');
}

function renderLogs() {
  /* （worklog 聚合）：任务汇总不依赖下方脏检查，切到日志页每次都刷新 */
  try {
    renderTaskSummary();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:renderLogs'); }
  /* 复盘提醒条已经挪到「📔 日记」标签里（#logDiaryView），由 renderDiarySingle 调用。
     日志页是番茄流水账，提醒写复盘的人不该在这里被拦一道。 */
  /* 脏检查：记录集+筛选条件没变则跳过全量重绘 */
  const _kwEl = document.getElementById('logSearch'),
    _tfEl = document.getElementById('logTypeFilter'),
    _dfEl = document.getElementById('logDateFilter');
  const _f0 = appData.records[0],
    _f1 = appData.records[appData.records.length - 1];
  const _sig2 =
    appData.records.length +
    '|' +
    _logRecordsSig() +
    '|' +
    (_f0 ? _f0.id + ':' + _f0.startTime : '') +
    '|' +
    (_f1 ? _f1.id + ':' + _f1.startTime : '') +
    '|' +
    (_kwEl ? _kwEl.value : '') +
    '|' +
    (_tfEl ? _tfEl.value : '') +
    '|' +
    (_dfEl ? _dfEl.value : '') +
    '|' +
    _logTodoDoneSig() +
    '|' +
    (_logPage || 1);
  /* ★ 习惯提醒卡必须无条件重画：它的内容取决于 habits/habitLogs/todos，
     而这些不在 _sig2 里 → 打卡状态变了回日志页，签名没变就直接 return，卡片不刷新。 */
  renderHabitRemind();
  if (_sig2 === _logSig) return;
  _logSig = _sig2;
  /* 仅当日志页激活时才显示箭头（之前没看 view，导致从日志页切走时
     switchView 隐藏了箭头，但下次 renderLogs 被调用又把它强制显示出来） */
  const _la = document.getElementById('logJumpArrow');
  if (_la) {
    const _inLogView = document.getElementById('view-log').classList.contains('active');
    _la.style.display = currentLogTab === 'focus' && _inLogView ? 'flex' : 'none';
  }
  const view = document.getElementById('logList');
  if (!view) return;
  const searchEl = document.getElementById('logSearch');
  const typeEl = document.getElementById('logTypeFilter');
  const dateEl = document.getElementById('logDateFilter');
  const kw = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const tf = typeEl ? typeEl.value : '';
  const df = dateEl ? dateEl.value : '';
  let records = [...appData.records].sort((a, b) => b.startTime - a.startTime);
  if (tf) {
    if (tf === 'pomo') {
      /* 「只看🍅」= 真的有番茄的记录。只说「有番茄」、不写死类型名，
         口径与种树共用 isPomodoroRecord（避免两处各判各的）。 */
      records = records.filter(function (r) { return isPomodoroRecord(r); });
    } else {
      records = records.filter(r => (tf === 'interrupted' ? r.interruptions && r.interruptions.length : r.type === tf));
    }
  }
  /* 关键词：空格分开 = 每个词都要出现（十年后凭零碎记忆找人，单关键词往往命中一大片）。
     搜索范围含任务名、备注和日期 —— 打「2025」就是那年全部，「2025-03」就是那个月。 */
  const _toks = String(kw || '')
    .split(/\s+/)
    .filter(Boolean);
  if (_toks.length) {
    records = records.filter(function (r) {
      const hay = ((r.taskName || '') + ' ' + (r.note || '') + ' ' + getDateStr(r.startTime)).toLowerCase();
      return _toks.every(function (t) {
        return hay.indexOf(t) >= 0;
      });
    });
  }
  /* 时间范围按前缀匹配：'YYYY-MM' 取整月，'YYYY-MM-DD' 取当天 */
  if (df) {
    records = records.filter(r => getDateStr(r.startTime).indexOf(df) === 0);
  }
  const _hasFilter = !!(kw || tf || df);
  const cntEl = document.getElementById('logCountInfo');
  if (cntEl)
    cntEl.textContent = _hasFilter ? '🔎 找到 ' + records.length + ' 条记录' + (df ? '（' + logRangeLabel(df) + '）' : '') : '';
  const mw = document.getElementById('logMoreWrap');
  /* ★ 日期池不能只来自记录：只勾了「完成计划」、当天没计过时的日子，用户仍认为
     它是「今天做了什么」的一天。旧实现只取 appData.records 的日期 → 这种日子
     整天不出现，哪怕「当天完成」条里挂着 5 条（用户 10-15 反馈）。
     有 关键词/类型 筛选时不补：那时按的是「记录」筛，混进无记录的天只会多出空卡；
     「日期」筛选是用户点名要看的某一天，所以照补。 */
  const _doneLogAll = appData.todoDoneLog || {};
  const _extraDates = [];
  if (!kw && !tf) {
    Object.keys(_doneLogAll).forEach(function (ds) {
      if (!Array.isArray(_doneLogAll[ds]) || !_doneLogAll[ds].length) return;
      if (df && ds.indexOf(df) !== 0) return;
      _extraDates.push(ds);
    });
  }
  if (!records.length && !_extraDates.length) {
    view.innerHTML =
      '<div style="text-align:center;color:var(--text-light);padding:40px;font-size:var(--fs-title);">' +
      (_hasFilter ? (df && !kw && !tf ? '「' + logRangeLabel(df) + '」没有记录' : '没有符合条件的记录') : '还没有专注记录') +
      (_hasFilter
        ? '<br><button class="btn-small" onclick="clearLogFilters()" style="margin-top:12px;">看全部时间</button>'
        : '') +
      '</div>';
    if (mw) mw.innerHTML = '';
    return;
  }
  /* 分页：按天分组，每页最多 _logDaysPerPage 天（论坛式翻页） */
  const groupsAll = {};
  records.forEach(r => {
    const ds = getDateStr(r.startTime);
    if (!groupsAll[ds]) groupsAll[ds] = [];
    groupsAll[ds].push(r);
  });
  _extraDates.forEach(function (ds) {
    if (!groupsAll[ds]) groupsAll[ds] = [];
  });
  /* ★ 必须在并入 _extraDates 之后再算日期池与分页，否则只勾了完成计划、
     没计时的那一天排不进去（分页数也会少一天）。 */
  const datesAll = Object.keys(groupsAll).sort().reverse();
  const totalPages = Math.max(1, Math.ceil(datesAll.length / _logDaysPerPage));
  if (_logPage > totalPages) _logPage = totalPages;
  const pageDates = datesAll.slice((_logPage - 1) * _logDaysPerPage, _logPage * _logDaysPerPage);
  const groups = {};
  pageDates.forEach(function (ds) {
    groups[ds] = groupsAll[ds];
  });
  const dates = pageDates;
  /* 顶部汇总：当前筛选下「总共干了多少」。三样东西三条账，名字必须各说各的：
     · 条记录  = 筛选出的条数（含「仅记录」）
     · 记录时长 = 每条记录的实际时长合计（**含「仅记录」**——补记的「配眼镜 45 分钟」
                  也是这段时间的长度，只是它不算专注）
     · 专注时长 = 只算专注型记录的实际秒数（「仅记录」不算），与 logDayStats().focus 同源 */
  let _sumSec = 0,
    _sumFocusSec = 0,
    _sumPomo = 0;
  records.forEach(function (r) {
    const _s = recordSeconds(r);
    _sumSec += _s;
    if (!isLogRecord(r)) _sumFocusSec += _s;
    _sumPomo += getPomos(r);
  });
  const _sumMin = Math.round(_sumSec / 60);
  const _sumDur = fmtMinUnit(_sumMin);
  const _sumFocus = fmtMinUnit(Math.round(_sumFocusSec / 60));
  /* 单位跟在大数字后面（小号字），格名固定成「记录时长 / 专注时长」——
     否则格名会随单位变脸成「记录小时 / 专注分钟」，用户分不清这一格到底在说什么。 */
  const _unitTag = function (u) {
    return u ? '<span class="log-sum-unit"> ' + u + '</span>' : '';
  };
  /* 汇总放在列表最后：顶上第一屏要留给「今天」，不然每次进来先看到统计、看不到当天记录。
     ★ 一条记录都没有时不画：日期池现在也收「只勾了完成计划」的日子，那种情况下
     这排会全是 0（0 条 / 0 分钟 / 0 分钟 / 0🍅）—— 除了噪音什么也没说（用户 10-15 「乱」）。 */
  const sumStrip = records.length
    ? '<div class="log-sum-strip">' +
      '<div class="log-sum-cell"><div class="log-sum-num">' + records.length + '</div><div class="log-sum-lab">条记录</div></div>' +
      '<div class="log-sum-cell"><div class="log-sum-num">' + _sumDur.num + _unitTag(_sumDur.unit) + '</div><div class="log-sum-lab">记录时长</div></div>' +
      '<div class="log-sum-cell"><div class="log-sum-num">' + _sumFocus.num + _unitTag(_sumFocus.unit) + '</div><div class="log-sum-lab">专注时长</div></div>' +
      '<div class="log-sum-cell"><div class="log-sum-num">' + fmtTomatoNum(_sumPomo) + '</div><div class="log-sum-lab">番茄🍅</div></div>' +
      '</div>'
    : '';
  let html = '';
  for (const date of dates) {
    html += dayLogBlockHtml(date, groups[date]);
  }
  html += sumStrip;
  view.innerHTML = html;
  /* 底部翻页控件（论坛帖子式） */
  if (mw) {
    if (totalPages > 1) {
      const prevBtn =
        _logPage <= 1
          ? '<button class="btn-small" disabled style="opacity:.4;background:var(--card);color:var(--text-light);border-color:var(--border);">‹ 上一页</button>'
          : '<button class="btn-small" style="background:var(--card);color: var(--primary-ink);border-color:var(--primary);" onclick="logPageGo(-1)">‹ 上一页</button>';
      const nextBtn =
        _logPage >= totalPages
          ? '<button class="btn-small" disabled style="opacity:.4;background:var(--card);color:var(--text-light);border-color:var(--border);">下一页 ›</button>'
          : '<button class="btn-small" style="background:var(--card);color: var(--primary-ink);border-color:var(--primary);" onclick="logPageGo(1)">下一页 ›</button>';
      /* 页码下拉：借鉴论坛帖子式翻页，点一下弹下拉直接跳到任意页，不用一页页翻 */
      let pageOpts = '';
      for (let p = 1; p <= totalPages; p++) {
        pageOpts +=
          '<option value="' + p + '"' + (p === _logPage ? ' selected' : '') + '>第 ' + p + ' 页</option>';
      }
      const pageSel =
        '<select onchange="logPageJump(this.value)" title="跳转到第几页" style="padding:var(--sp-4) var(--sp-8); border:2px solid var(--primary); border-radius:var(--radius-sm); font-size:var(--fs-body); font-weight:700; color: var(--primary-ink); background:var(--card); cursor:pointer;">' +
        pageOpts +
        '</select>';
      mw.innerHTML =
        '<div style="display:flex;justify-content:center;align-items:center;gap:var(--sp-8);margin:var(--sp-14) 0 var(--sp-8);">' +
        prevBtn +
        pageSel +
        '<span style="font-size:var(--fs-body);color:var(--text-light);">/ ' +
        totalPages +
        ' 页 · 共 ' +
        datesAll.length +
        ' 天</span>' +
        nextBtn +
        '</div>';
    } else {
      mw.innerHTML = '';
    }
  }
}
