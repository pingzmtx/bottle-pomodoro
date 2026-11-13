/* ==================== 模块: 01eG_ui_lifereview.js | 职责: 复盘（分步引导 / 快照冻结 / 历史）| 分组: ui ==================== */
/* 为什么单独一个文件：复盘是「回顾」这个动作本身，不是目标的属性。
 * 它读目标、读习惯，但不改它们（除了写 reviews）——放进 01eE / 01eF 会让
 * 「谁写 lifeGoals」这件事变得说不清（data_ownership 里正卡这条）。
 *
 * 三条设计约束：
 *   ① 复盘是事件，不是常驻表单（flow 的评估窗口）。平时只有一条入口，
 *      点开才进入分步引导；写完就退回入口。
 *   ② 分步而不是一屏四个输入框：一屏八格没人填。一步只问一个领域，
 *      而且先把「上次你说的」摊出来 —— 复盘一半的价值在这。
 *   3. 保存时冻结快照。以后改目标、删目标，历史复盘的数字不动。
 *
 * 只做月 / 年两种节奏：周复盘一年 52 次，必然变成新负担；
 * 季度由 01eF 的检查点承担，不重复设一套。
 *
 * 函数索引（TOC）：rvReviews/rvAreaOf/rvCtx/openLifeReview/closeLifeReview/rvDraftHasContent/rvKissEditHtml/rvKissHtml/rvGrowOne/rvBindGrow/_rvExtraScreens/_rvTotal（+40 更多）
 *   rvStart/rvSetStep/rvSetField/rvPickPeriod/rvPrev/rvNext/rvSave/rvOpenView/rvDelete
 * ============================================================ */

let _rv = {
  mode: 'list',      /* list | edit | view | week | recall */
  step: 0,
  draft: null,       /* { cadence, period, focus, notes:{areaId:{reflection,next}} } */
  areaIds: [],
  viewId: null,
  /* 回看：只读，看的是日记原文，不预填进任何输入框。
     不复用 draft —— 回看和复盘是两件事，混在一起早晚会把回看的内容当成草稿存进去。 */
  recallCadence: 'month',
  recallPeriod: '',
  /* 切周期时的草稿暂存：{ 'month|2026-09': {focus, notes} }
     ★ 没有这个缓存，「10 月写了半天 → 好奇去看 9 月 → 再切回 10 月」内容就没了；
       更糟的是切到没写过的周期时 notes 还留着上一个周期的，保存时直接串期。 */
  cache: {}
};

function rvReviews() {
  if (!Array.isArray(appData.reviews)) appData.reviews = [];
  /* 新的在前。按**写入日期**倒序而不是 period：
     周（2026-W44）、月（2026-10）、年（2026）三种键没有可比的字符串顺序，
     混排时按 period 排会把「2026-W44」插到「2026-10」后面。 */
  return appData.reviews.slice().sort(function (a, b) {
    if (!a || !b) return 0;
    const da = String(a.date || ''), db = String(b.date || '');
    if (da !== db) return da < db ? 1 : -1;
    return (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0);
  });
}
function rvAreaOf(id) {
  const list = appData.lifeAreas || [];
  for (let i = 0; i < list.length; i++) if (list[i] && idEq(list[i].id, id)) return list[i];
  return null;
}
function rvCtx() {
  return {
    today: getTodayStr(),
    habits: appData.habits || [],
    habitLogs: appData.habitLogs || {}
  };
}

/* ---------- 打开 / 关闭 ---------- */
function openLifeReview(id) {
  _rv.mode = id ? 'view' : 'list';
  _rv.viewId = id || null;
  _rv.step = 0;
  _rv.draft = null;
  renderLifeReview();
  showModal('lifeReviewModal');
}
function closeLifeReview() {
  /* 编辑态里写了东西再关 = 丢掉。用项目已有的 rsConfirm（原生 confirm 在 WebView 里会静默返回 false）。 */
  if (_rv.mode === 'edit' && rvDraftHasContent()) {
    const doClose = function () {
      closeModal('lifeReviewModal');
      _rv.mode = 'list';
      _rv.draft = null;
      _rv.viewId = null;
      renderLifeReview();
    };
    if (typeof window.rsConfirm === 'function') {
      window.rsConfirm('这次写的内容还没保存，确定丢掉？').then(function (ok) { if (ok) doClose(); });
    } else {
      doClose();
    }
    return;
  }
  closeModal('lifeReviewModal');
  _rv.mode = 'list';
  _rv.draft = null;
  _rv.viewId = null;
  renderLifeReview();      /* 关掉后入口那条要更新（可能刚写完） */
}

/* 草稿里有没有「值得挽留」的内容：focus 或任一领域的反思/下一步 */
function rvDraftHasContent() {
  const d = _rv.draft;
  if (!d) return false;
  if (String(d.focus || '').trim()) return true;
  const notes = d.notes || {};
  return Object.keys(notes).some(function (k) {
    const n = notes[k] || {};
    return String(n.reflection || '').trim() || String(n.next || '').trim();
  });
}

/* ---------- KISS 四象限（周 / 月共用）----------
   四个动词 = 四个方向的自我提问，不是统计。STOP 尤其重要：
   「该停止什么」是任何进度条都算不出来的那一栏。
   ★ 原来只有月复盘有，周复盘被我自己否掉了（注释写着「一周只有两句话，
     加四象限是把它写重」）—— 用户否了回来：一周做砸了，最先想清楚的就是
     「什么在消耗我」，周复盘恰恰是最该问 STOP 的地方。现在周、月共用同一套。 */
const RV_KISS_Q = [
  ['keep', '保留', '哪些做法值得继续'],
  ['improve', '改进', '哪件事换个做法会更好'],
  ['start', '开始', '接下来要开始做什么'],
  ['stop', '停止', '什么在悄悄消耗你']
];

/* 编辑态的四格。setter = 写入函数名，path = 字段前缀（"month." / "kiss."） */
function rvKissEditHtml(obj, setter, path) {
  const m = obj || {};
  let h = '<div class="rv-kiss">';
  RV_KISS_Q.forEach(function (q) {
    h += '<div class="rv-kiss-b rv-kiss-b--' + q[0] + '">'
      + '<div class="rv-kiss-h"><b>' + q[1] + '</b><span>' + q[2] + '</span></div>'
      + '<textarea class="rv-input rv-kiss-t" rows="2" maxlength="200"'
      + ' data-input="' + setter + '"'
      + ' data-input-args=\'' + JSON.stringify([path + q[0], '@value']) + '\''
      + ' placeholder="">' + escapeHtml(m[q[0]] || '') + '</textarea></div>';
  });
  h += '</div>';
  return h;
}

/* 只读态：只画写了的那几栏，但顺序固定（KEEP 永远在 STOP 前面），
   以后翻旧复盘能横向对比「那几个月我一直在停止同一件事」。 */
function rvKissHtml(obj) {
  if (!obj) return '';
  const has = RV_KISS_Q.some(function (q) { return String(obj[q[0]] || '').trim(); });
  if (!has) return '';
  let h = '<div class="rv-kiss rv-kiss--view">';
  RV_KISS_Q.forEach(function (q) {
    const v = String(obj[q[0]] || '').trim();
    if (!v) return;
    h += '<div class="rv-kiss-b rv-kiss-b--' + q[0] + '">'
      + '<div class="rv-kiss-h"><b>' + q[1] + '</b></div>'
      + '<div class="rv-kiss-v">' + escapeHtml(v) + '</div></div>';
  });
  h += '</div>';
  return h;
}

/* ---------- 输入框跟着内容长高 ----------
   KISS 四栏是 2 列，430 宽下每格只有 ~170px。自带滚动条的话写三行就得在框里
   上下蹭 —— 用户的原话是「它就只能输入几个字，多出来那个字要往下滑」。
   这里按 scrollHeight 定高，先归零再量（不归零的话删字后不会变矮）。
   绑定挂在 #lifeReviewBody 上只做一次：每步重渲染 innerHTML 但容器不变，
   绑在 textarea 上就得每次重绑，迟早漏一处。 */
function rvGrowOne(el) {
  if (!el) return;
  try {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  } catch (e) { if (window.__silent) window.__silent(e, '01eG:rvGrowOne'); }
}
function rvBindGrow(box) {
  if (!box) return;
  if (!box.dataset.growBound) {
    box.addEventListener('input', function (e) {
      const t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains('rv-kiss-t') || t.classList.contains('rv-area')) rvGrowOne(t);
    });
    box.dataset.growBound = '1';
  }
  const list = box.querySelectorAll('.rv-kiss-t, .rv-area');
  for (let i = 0; i < list.length; i++) rvGrowOne(list[i]);
}

/* ---------- 渲染总入口 ---------- */
/* 步数：选周期 + [年复盘多一屏「这一年」] + N 个领域 + 汇总。
   ★ 必须只有一个算法：之前 total 在 renderLifeReview / rvEditHtml / rvEditFootHtml /
     rvNext 各写了一遍，加一屏就会漏改一处，表现为「最后一步点下一步没反应」
     或「提前保存」。 */
function _rvExtraScreens(d) {
  /* 年复盘多「这一年」，月复盘多「这一月」（主题 + 优先 + KISS）。
     周复盘没有这一屏 —— 一周只有两句话（focus / next），加四象限是把它写重。 */
  if (!d) return 0;
  return (d.cadence === 'year' || d.cadence === 'month') ? 1 : 0;
}

function _rvTotal(d) {
  return _rv.areaIds.length + 2 + _rvExtraScreens(d);
}

function renderLifeReview() {
  const body = document.getElementById('lifeReviewBody');
  const foot = document.getElementById('lifeReviewFoot');
  const title = document.getElementById('lifeReviewTitle');
  if (!body) return;

  if (_rv.mode === 'edit') {
    const total = _rvTotal(_rv.draft);
    if (title) title.textContent = '复盘 · ' + (_rv.step + 1) + '/' + total;
    body.innerHTML = rvEditHtml();
    if (foot) foot.innerHTML = rvEditFootHtml();
    rvBindGrow(body);
    /* 每次切步都滚回顶部，否则从长页面切到短页面会停在中间 */
    setTimeout(function () { body.scrollTop = 0; }, 0);
    return;
  }
  if (_rv.mode === 'week') {
    if (title) title.textContent = '周复盘';
    body.innerHTML = rvWeekHtml();
    rvBindGrow(body);
    if (foot) {
      foot.innerHTML = '<button class="rv-btn" data-act="closeLifeReview">取消</button>'
        + '<button class="rv-btn primary" data-act="rvSaveWeek">保存</button>';
    }
    setTimeout(function () { body.scrollTop = 0; }, 0);
    return;
  }
  if (_rv.mode === 'view') {
    if (title) title.textContent = '复盘';
    body.innerHTML = rvViewHtml();
    rvBindGrow(body);
    if (foot) foot.innerHTML = '<button class="rv-btn" data-act="closeLifeReview">关闭</button>';
    return;
  }
  if (title) title.textContent = '复盘';
  body.innerHTML = rvListHtml();
  const again = (appData.reviews || []).length ? '<button class="rv-btn" data-act="closeLifeReview">关闭</button>' : '';
  if (foot) foot.innerHTML = again + '<button class="rv-btn primary" data-act="rvStart">写 / 补一份复盘</button>';
}

/* ---------- 回看：已并入日志页 ----------
   原来这里有一整块「回看」：周 / 月 / 年分段 + 每周期逐天列出日记原文 + 当天事实。
   做出来之后用户的判断更干脆：「那个回看功能，你就利用那个日志的筛选不就得了？直接跳转就行」。
   他是对的 —— 日志页本来就有日期筛选（logDateFilter 前缀匹配 /YYYY-MM/ 或 /YYYY-MM-DD/）
   和日历挑选，把同一份数据在这里再实现一遍，等于维护两套渲染、两套分页、两套年份边界。
   所以：回看板整块删掉，列表里换成一句跳转（rvOpenLogRange），
   把「看这段时间」交给日志页那套已经调好的筛选。
   ★ 保留 lifeRecallDays / lifeDayFacts（00b_goal_progress.js）：它们是纯函数，
     现在没人调也不删 —— 日志页将来若要按天聚合可直接用，删掉反而是丢能力。 */
/* '2026-W44' → 那周周一的 YYYY-MM-DD。
   ★ 不能用 isoWeekKey 反解（那是有损的）：第 1 周的周一是「1 月 4 日所在那周的周一」，
   直接按 (week-1)*7 从 1/1 加会偏一周。 */
function _weekKeyMonday(key) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(key || ''));
  if (!m) return '';
  const year = Number(m[1]);
  const week = Number(m[2]);
  /* Jan 4 必在第一周；退到它所在周的周一 = 第 1 周的周一 */
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const wd = jan4.getUTCDay() || 7;
  const w1 = jan4.getTime() - (wd - 1) * 86400000;
  const mon = new Date(w1 + (week - 1) * 7 * 86400000);
  const p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  return mon.getUTCFullYear() + '-' + p2(mon.getUTCMonth() + 1) + '-' + p2(mon.getUTCDate());
}

function rvOpenLogRange(cadence, period) {
  /* 周期 → 日志页认的日期前缀。周没有「前缀」这回事（跨月、跨年），
     退到那周的周一那一天：日志按天翻，箭头就是逐天前后翻页。 */
  let range = '';
  const p = String(period || '');
  if (cadence === 'year') range = p.slice(0, 4);
  else if (cadence === 'month') range = p.slice(0, 7);
  else range = _weekKeyMonday(p) || p;
  closeModal('lifeReviewModal');
  _rv.mode = 'list';
  _rv.draft = null;
  switchView('log');
  if (typeof setLogRange === 'function') setLogRange(range);
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
}
/* ---------- 列表态 ---------- */
function rvListHtml() {
  const list = rvReviews();
  let h = '';
  const TF = window.TFGoal;
  const today = getTodayStr();

  /* ---------- 三个周期各自一格 ----------
     ★ 之前这里只有「本周」一格 + 底下一个「写一份复盘」，而「写一份复盘」
       永远落在月复盘。用户看到的首屏只有周，于是结论是「这个复盘只能周复盘，
       而且很简陋」—— 而 KISS 四栏明明就在月复盘里。
       周期不是选择题，是三个不同的问题：
         周 = 一句话（这周怎么样）
         月 = 主题 + 5 件优先 + KISS 四栏
         年 = 满意度 + 12 个月高光 + 教训
       所以三格并排摆出来，每格自己说明自己要问什么，不让人去猜。 */
  /* ★「什么时候该写哪一种」——用户原话：「你这种情况都不知道什么时候该周复盘，
     什么时候该月复盘，什么时候该年复盘」。所以每一格都写着它的时间窗口，
     现在正处在窗口内就换成主色并说清「今天/还有几天」：
       周 = 周末写（周六 ~ 周一都算，周一是补上周）
       月 = 月底最后三天写
       年 = 12 月写
     窗口不进任何数据，只是提示 —— 过了窗口照样能补写。 */
  const rvWhen = function (k, d) {
    if (k === 'week') {
      const wd = d.getDay();               /* 0 = 周日 */
      if (wd === 0) return { due: true, t: '今天周日 · 写下这周' };
      if (wd === 6) return { due: true, t: '明天就周末了' };
      if (wd === 1) return { due: true, t: '周一 · 上周的还能补' };
      return { due: false, t: '周日写' };
    }
    if (k === 'month') {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const left = last - d.getDate();
      if (left <= 0) return { due: true, t: '今天月底 · 写这个月' };
      if (left <= 2) return { due: true, t: '还有 ' + left + ' 天到月底' };
      return { due: false, t: '月底写' };
    }
    if (d.getMonth() + 1 === 12) return { due: true, t: '12 月 · 该回头看了' };
    return { due: false, t: '12 月写' };
  };
  const CADS = [
    { k: 'week', t: '周复盘', q: '这周怎么样，下周推进什么' },
    { k: 'month', t: '月复盘', q: '月末回头看：保留 / 改进 / 开始 / 停止' },
    { k: 'year', t: '年复盘', q: '满意度 · 12 个月高光 · 教训' }
  ];
  const todayD = new Date(today + 'T00:00:00');
  const md = function (ds) {
    return Number(String(ds).slice(5, 7)) + '/' + Number(String(ds).slice(8, 10));
  };
  h += '<div class="rv-cads">';
  CADS.forEach(function (c) {
    let period = '';
    if (c.k === 'week') period = (typeof lifeWeekKey === 'function') ? lifeWeekKey() : '';
    else if (c.k === 'month') period = today.slice(0, 7);
    else period = today.slice(0, 4);
    const done = (c.k === 'week')
      ? (TF && TF.lifeWeekReviewOf ? TF.lifeWeekReviewOf(appData.reviews || [], period) : null)
      : (TF && TF.lifeReviewFind ? TF.lifeReviewFind(appData.reviews || [], c.k, period) : null);
    /* 这一格覆盖的是哪几天 —— 周/月/年各自不同，不写出来就只剩一个名词 */
    let span = '';
    if (c.k === 'week') {
      const rg = (TF && TF.weekRangeOf) ? TF.weekRangeOf(today) : null;
      if (rg && rg.start) span = md(rg.start) + ' – ' + md(rg.end);
    } else if (c.k === 'month') {
      span = today.slice(0, 4) + ' 年 ' + Number(today.slice(5, 7)) + ' 月';
    } else {
      span = today.slice(0, 4) + ' 年';
    }
    const when = rvWhen(c.k, todayD);
    h += '<button class="rv-cad' + (done ? ' done' : '') + (when.due ? ' due' : '') + '" data-act="rvStartAt"'
      + ' data-args=\'' + JSON.stringify([c.k, period]) + '\'>'
      + '<span class="rv-cad-t">' + c.t + (done ? '<i class="rv-cad-done">已写</i>' : '') + '</span>'
      + '<span class="rv-cad-q">' + c.q + '</span>'
      + '<span class="rv-cad-p">' + span + '</span>'
      + '<span class="rv-cad-when">' + when.t + '</span>'
      + '</button>';
  });
  h += '</div>';

  /* 「这段日子我干了什么」不在这里再摆一个只读页面 —— 日志页已经有日期筛选
     （📅 全部 ▾ 和日历），这里只负责把人送过去，落到对应的年 / 月 / 那周的周一。
     用户的原话：「那个回看功能，你就利用那个日志的筛选不就得了？直接跳转得了」。 */
  /* 三个粒度各一个，点哪个就把日志筛到哪个（周 → 那周周一，日志里能逐天前后翻）。
     不做成一个大按钮再让用户选粒度：多一步，且这里本来就是「顺手看看」。 */
  h += '<div class="rv-jump"><span class="rv-jump-tx">这段日子我干了什么</span>';
  [['本周', 'week', (TF && TF.isoWeekKey ? TF.isoWeekKey(today) : today)],
   ['本月', 'month', today.slice(0, 7)],
   ['今年', 'year', today.slice(0, 4)]].forEach(function (x) {
    h += '<button class="rv-jump-b" data-act="rvOpenLogRange"'
      + ' data-args=\'' + JSON.stringify([x[1], x[2]]) + '\'>' + x[0] + ' ›</button>';
  });
  h += '</div>';
  if (!list.length) {
    h += '<div class="rv-empty">还没有写过的复盘。点上面任意一格就能开始。</div>';
    return h;
  }
  h += '<div class="rv-list">';
  list.forEach(function (r) {
    /* ★ 这里原来还有个「周 / 月 / 年」的小徽章，紧挨着周期名。
       可周期名本身已经带单位（「10/12 – 10/18」「2026 年 10 月」「2025 年」），
       并排就是「10/12 那周 周」「2026 年 10 月 月」—— 两个同义字挨着。撤掉。
       label 留给下面的 aria / 提示用。 */
    const first = r.focus || (function () {
      /* 没写 focus 就取第一段反思的头一句，比显示「（空）」有用 */
      const notes = r.notes || {};
      const keys = Object.keys(notes);
      for (let i = 0; i < keys.length; i++) {
        const t = String((notes[keys[i]] || {}).reflection || '').trim();
        if (t) return t.slice(0, 30);
      }
      return '';
    })();
    h += '<button class="rv-item" data-act="rvOpenView" data-args=\'' + JSON.stringify([r.id]) + '\'>';
    h += '<div class="rv-item-top"><span class="rv-item-p">' + escapeHtml(rvPeriodLabel(r)) + '</span></div>';
    if (first) h += '<div class="rv-item-t">' + escapeHtml(first) + '</div>';
    h += '<div class="rv-item-d">' + escapeHtml(String(r.date || '')) + '</div>';
    h += '</button>';
  });
  h += '</div>';
  return h;
}

/* ---------- 编辑态（分步） ---------- */
function rvEditHtml() {
  const d = _rv.draft;
  if (!d) return '';
  const total = _rvTotal(d);

  /* 第 1 步：确认周期 + 一句话 */
  if (_rv.step === 0) {
    /* ★ 一道下拉，三段分组：周 / 月 / 年。
       早先只列**当前这个颗粒度**的周期，理由是「11 项混合清单让人不知道在选什么」——
       但那是缺分组，不是缺颗粒度。补录上周的复盘时下拉里一个周都没有，
       用户只会得出「这里只能补月计划」的结论（他真的这么问了）。
       现在用 optgroup 分组，三种颗粒度一眼都在，选到「周」直接进周复盘那一屏。 */
    const periodsOf = function (c, n) { return window.TFGoal.lifeReviewPeriods(getTodayStr(), n, c); };
    const opt = function (p) {
      const on = (p.cadence === d.cadence && p.period === d.period) ? ' selected' : '';
      return '<option value="' + p.cadence + '|' + p.period + '"' + on + '>' + escapeHtml(p.label) + '</option>';
    };
    const groups = [
      { c: 'week', t: '周（最近 10 周）', n: 10 },
      { c: 'month', t: '月（最近 12 个月）', n: 12 },
      { c: 'year', t: '年（最近 5 年）', n: 5 }
    ];
    let h = '<div class="rv-step">';
    h += '<div class="rv-q">复盘哪一段时间？</div>';
    h += '<select class="rv-select" data-change="rvPickPeriod" data-change-args=\'["@value"]\'>'
      + groups.map(function (g) {
        return '<optgroup label="' + g.t + '">' + periodsOf(g.c, g.n).map(opt).join('') + '</optgroup>';
      }).join('') + '</select>';
    /* ★ 这里原来还有一个「这次想搞清楚什么？（可选）」输入框，删掉了。
       用户原话：「每次复盘前输入一个这次最想搞清什么，是什么意思？有什么意义」。
       对 —— 那是「关于复盘的复盘」，只有方法论爱好者会填。打开复盘的人
       已经知道自己在想什么，再让他先写一句元问题，等于进门先填一张表。 */
    /* 补录要如实说清楚：系统不存历史进度，这个周期的百分比只能是空的。
       与其拿今天的数字冒充三个月前，不如直接标「无当时数据」。 */
    if (!rvIsCurrentPeriod(d)) {
      h += '<div class="rv-help rv-warn">补录：这个周期没有进度记录</div>';
    }
    h += '</div>';
    return h;
  }

  /* 年复盘多一屏「这一年」：满意度 + 12 个月的记忆锚点 + 教训。
     ★ 手账的年复盘不是「把 12 个月加起来」，是回头挑出还记得的那几件事。
       所以每个月一个空行，不是一张统计表 —— 想不起来就留空，留空也是答案。
     ★ 仍然一个字都不预填：12 个月的高光如果由系统代写，
       那写下的就不是「我记得的」，而是「数据里有的」。 */
  /* 月复盘只剩「回头看」。
     ★ 原来这一屏装了两件事：月初定方向（主题 + 5 件优先）+ 月末回头看（KISS）。
       用户当场问：「这个月最想干什么？我有病啊，我这个月都结束了」。
       曾经把「往前看」那一半拆成独立的「月计划」，后来整块撤了 ——
       月份一格一句在手机上填不满，也从不回看。现在这里只有
       「发生了什么、下次怎么改」，年计划的排期交给待办和日历。
     ★ KISS 四个动词（保留/改进/开始/停止）是手账月复盘的核心，不是统计。
       特别是 STOP ——「该停止什么」是任何进度条都算不出来的那一栏。 */
  if (d.cadence === 'month' && _rv.step === 1) {
    const m = d.month || {};
    let h = '<div class="rv-step">';

    /* 月份键：跳去日记时按「YYYY-MM」筛。 */
    const mk = String(d.period || '').slice(0, 7);
    h += rvLogGoNote('想不起来就翻翻日记 —— 这个月记了什么、写了什么，都在那儿。', mk);
    h += rvKissEditHtml(m, 'rvSetField', 'month.');
    h += '</div>';
    return h;
  }

  const yearStep = (d.cadence === 'year');
  if (yearStep && _rv.step === 1) {
    const y = d.year || {};
    const hs = y.highlights || {};
    const sat = (y.sat === 0 || y.sat) ? Number(y.sat) : null;
    let h = '<div class="rv-step">';
    /* 年初写了什么，年末先看一眼再说。
       ★ 复盘最容易变成「凭印象给这一年打分」—— 把年初的关键词和「今年不做什么」
         摆在最上面，是让人对着自己当初下的注评卷，而不是对着记忆。
         只读：要改就回年计划改，同一句话两处可编辑早晚不一致。 */
    h += rvYearStartHtml(d.period);
    h += '<div class="rv-q">' + escapeHtml(String(d.period || '')) + ' 这一年</div>';
    h += '<div class="rv-meta">这一年的整体感觉，10 分是最满意</div>';
    h += '<div class="rv-sat">';
    for (let i = 0; i <= 10; i++) {
      h += '<button class="rv-sat-b' + (sat === i ? ' on' : '') + '" data-act="rvSetYear"'
        + ' data-args=\'' + JSON.stringify(['sat', i]) + '\'>' + i + '</button>';
    }
    h += '</div>';
    h += '<div class="rv-q" style="margin-top:var(--sp-16)">每个月记得住的一件事</div>';
    /* ★ 原来是「想不起来的就空着。空着比硬凑一句真。」—— 说得很对，但没给出口：
       用户想不起来的时候需要的不是被安慰，而是一眼看到那周都干了什么。
       这句话本来就是个按钮，只是画成了灰字。 */
    h += rvLogGoNote('想不起来就翻翻日记 —— 这一年干了什么、写了什么，都在那儿。', '');
    const MN = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月',
      '7 月', '8 月', '9 月', '10 月', '11 月', '12 月'];
    h += '<div class="rv-months">';
    for (let m = 1; m <= 12; m++) {
      h += '<div class="rv-mrow"><span class="rv-mk">' + MN[m - 1] + '</span>'
        + '<input class="rv-input rv-mv" type="text" maxlength="80" data-input="rvSetHighlight"'
        + ' data-input-args=\'["' + m + '","@value"]\''
        + ' value="' + escapeHtml(hs[m] || '') + '" placeholder=""></div>';
    }
    h += '</div>';
    h += '<div class="rv-q" style="margin-top:var(--sp-16)">这一年最深刻的一个教训</div>';
    h += '<textarea class="rv-input" rows="3" maxlength="500" data-input="rvSetField"'
      + ' data-input-args=\'["year.lesson","@value"]\''
      + ' placeholder="不必总结，写那句让你停了一下的话">' + escapeHtml(y.lesson || '') + '</textarea>';
    h += '</div>';
    return h;
  }

  /* 最后一步：汇总 */
  if (_rv.step === total - 1) {
    const snap = d.snapshot || {};
    let h = '<div class="rv-step">';
    h += '<div class="rv-q">' + escapeHtml(rvPeriodLabel(d)) + ' 复盘</div>';
    if (d.focus) h += '<div class="rv-focus">' + escapeHtml(d.focus) + '</div>';
    h += rvMonthHtml(d.month);
    h += rvYearHtml(d.year);
    _rv.areaIds.forEach(function (aid) {
      const a = rvAreaOf(aid);
      const note = (d.notes && d.notes[aid]) || {};
      const s = snap[aid] || {};
      h += '<div class="rv-sum">';
      h += '<div class="rv-sum-head"><span>' + escapeHtml(rvAreaLabel(a)) + '</span>';
      h += '<span class="rv-sum-p">' + rvSnapText(s) + '</span></div>';
      if (String(note.reflection || '').trim()) h += '<div class="rv-sum-k">反思</div><div class="rv-sum-v">' + escapeHtml(note.reflection) + '</div>';
      if (String(note.next || '').trim()) h += '<div class="rv-sum-k">下一步</div><div class="rv-sum-v">' + escapeHtml(note.next) + '</div>';
      if (!String(note.reflection || '').trim() && !String(note.next || '').trim()) {
        h += '<div class="rv-sum-v rv-dim">这一段空着，也可以。</div>';
      }
      h += '</div>';
    });
    h += '<div class="rv-help">保存后不能修改</div>';
    h += '</div>';
    return h;
  }

  /* 中间：每个领域一屏 */
  const aid = _rv.areaIds[_rv.step - 1 - _rvExtraScreens(d)];
  const a = rvAreaOf(aid);
  const note = (d.notes && d.notes[aid]) || {};
  const snap = (d.snapshot && d.snapshot[aid]) || {};
  const lastNext = window.TFGoal.lifeReviewLastNext(appData.reviews || [], d.cadence, aid);

  let h = '<div class="rv-step">';
  h += '<div class="rv-q">' + escapeHtml(rvAreaLabel(a) || '这个领域') + '</div>';
  h += '<div class="rv-meta">' + (snap.goalCount ? (snap.goalCount + ' 个目标') : '没有目标')
    + (snap.backfilled ? ' · 补录，没有当时的进度数字' : (snap.measured ? (' · 平均 ' + snap.pct + '%') : ''))
    + (snap.habitPct !== null && snap.habitPct !== undefined ? (' · 习惯 ' + snap.habitPct + '%') : '')
    + '</div>';

  if (lastNext) {
    h += '<div class="rv-last"><div class="rv-last-k">上次你写的下一步</div>'
      + '<div class="rv-last-v">' + escapeHtml(lastNext) + '</div></div>';
  }

  h += '<div class="rv-q" style="margin-top:var(--sp-16)">发生了什么</div>';
  h += '<textarea class="rv-input rv-area" rows="4" maxlength="500" data-input="rvSetField"'
    + ' data-input-args=\'["note.' + aid + '.reflection","@value"]\''
    + ' placeholder="做到的和没做到的">' + escapeHtml(note.reflection || '') + '</textarea>';
  h += '<div class="rv-q" style="margin-top:var(--sp-14)">下一步</div>';
  h += '<input class="rv-input" type="text" maxlength="120" data-input="rvSetField"'
    + ' data-input-args=\'["note.' + aid + '.next","@value"]\''
    + ' value="' + escapeHtml(note.next || '') + '" placeholder="具体做一件事">';
  h += '</div>';
  return h;
}

function rvEditFootHtml() {
  const total = _rvTotal(_rv.draft);
  const last = _rv.step === total - 1;
  let f = '';
  if (_rv.step > 0) f += '<button class="rv-btn" data-act="rvPrev">上一步</button>';
  else f += '<button class="rv-btn" data-act="closeLifeReview">取消</button>';
  f += last
    ? '<button class="rv-btn primary" data-act="rvSave">保存</button>'
    : '<button class="rv-btn primary" data-act="rvNext">下一步</button>';
  return f;
}

/* ---------- 只读查看 ---------- */
function rvViewHtml() {
  const r = (appData.reviews || []).filter(function (x) { return x && idEq(x.id, _rv.viewId); })[0];
  if (!r) return '<div class="rv-empty">这条复盘不在了。</div>';
  const snap = r.snapshot || {};
  const notes = r.notes || {};
  const ids = Object.keys(notes);
  let h = '<div class="rv-step">';
  h += '<div class="rv-q">' + escapeHtml(rvPeriodLabel(r)) + ' 复盘</div>';
  h += '<div class="rv-meta">' + escapeHtml(String(r.date || '')) + ' 写</div>';
  if (r.focus) h += '<div class="rv-focus">' + escapeHtml(r.focus) + '</div>';
  /* 周复盘的四象限：月复盘的四栏在 rvMonthHtml 里画（那里还有主题和优先事项） */
  if (r.cadence === 'week') h += rvKissHtml(r.kiss);
  if (String(r.next || '').trim()) {
    h += '<div class="rv-sum-k">下周想推进</div>'
      + '<div class="rv-sum-v">' + escapeHtml(String(r.next)) + '</div>';
  }
  h += rvMonthHtml(r.month);
  h += rvYearHtml(r.year);
  ids.forEach(function (aid) {
    const a = rvAreaOf(aid);
    const s = snap[aid] || {};
    const n = notes[aid] || {};
    h += '<div class="rv-sum">';
    h += '<div class="rv-sum-head"><span>' + escapeHtml(rvAreaLabel(a)) + '</span>';
    h += '<span class="rv-sum-p">' + rvSnapText(s) + '</span></div>';
    if (String(n.reflection || '').trim()) h += '<div class="rv-sum-k">反思</div><div class="rv-sum-v">' + escapeHtml(n.reflection) + '</div>';
    if (String(n.next || '').trim()) h += '<div class="rv-sum-k">下一步</div><div class="rv-sum-v">' + escapeHtml(n.next) + '</div>';
    h += '</div>';
  });
  h += '<div class="rv-actions"><button class="rv-btn danger" data-act="rvDelete" data-args=\'' + JSON.stringify([r.id]) + '\'>删除这条复盘</button></div>';
  h += '</div>';
  return h;
}

/* 领域名兜底：分类被删掉之后，历史复盘里还留着 areaId。
   显示原始 id（area_health）比显示「已删除的分类」更让人困惑。 */
/* 快照的文字口径：补录的周期不能显示「未测量」——
   未测量是「有目标但没测」，补录是「当时没记录」，两件事。 */
function rvSnapText(s) {
  if (!s) return '未测量';
  if (s.backfilled) return '无当时数据';
  return s.measured ? (s.pct + '%') : '未测量';
}

/* 年复盘特有内容的只读渲染。没有这一块时，写完的年复盘在查看页
   只剩下领域那几段 —— 满意度、12 个月、教训全看不见，等于白写。 */
/* 月复盘的只读块：主题 / 优先 / KISS 四栏。
   四栏按固定顺序排，不按有没有内容筛 —— KEEP 和 STOP 的位置固定，
   以后翻旧月复盘时能横向对比「那几个月我一直在停止同一件事」。 */
function rvMonthHtml(m) {
  if (!m) return '';
  let h = '';
  if (String(m.theme || '').trim()) {
    h += '<div class="rv-focus">' + escapeHtml(m.theme) + '</div>';
  }
  const prio = Array.isArray(m.prio) ? m.prio.filter(function (x) { return String(x || '').trim(); }) : [];
  if (prio.length) {
    h += '<div class="rv-sum"><div class="rv-sum-head"><span>这个月最想完成的事</span>'
      + '<span class="rv-sum-p">' + prio.length + ' 件</span></div>';
    prio.forEach(function (t, i) {
      h += '<div class="rv-li"><span class="rv-li-k">' + (i + 1) + '</span>'
        + '<span class="rv-li-v">' + escapeHtml(t) + '</span></div>';
    });
    h += '</div>';
  }
  h += rvKissHtml(m);
  return h;
}

/* 年复盘顶部：年初写下的关键词。
   没有就整块不出现（空着比画一个「没写」的框好）。 */
function rvYearStartHtml(period) {
  const y = String(period || '').slice(0, 4);
  if (!/^\d{4}$/.test(y)) return '';
  const theme = ((appData.lifeYearTheme || {})[y] || '').trim();
  if (!theme) return '';
  let h = '<div class="rv-start">';
  h += '<div class="rv-start-r"><span class="rv-start-k">今年的关键词</span>'
    + '<span class="rv-start-v">' + escapeHtml(theme) + '</span></div>';
  h += '<div class="rv-start-t">年初写的。想改就回年计划改 —— 这里只让你对着答卷看一眼。</div>';
  h += '</div>';
  return h;
}

function rvYearHtml(y) {
  if (!y) return '';
  let h = '';
  const sat = (y.sat === 0 || y.sat) ? Number(y.sat) : null;
  if (sat !== null) h += '<div class="rv-sum"><div class="rv-sum-head"><span>这一年的整体感觉</span>'
    + '<span class="rv-sum-p">' + sat + ' / 10</span></div></div>';
  const hs = y.highlights || {};
  const keys = Object.keys(hs).filter(function (k) { return String(hs[k] || '').trim(); })
    .sort(function (a, b) { return Number(a) - Number(b); });
  if (keys.length) {
    h += '<div class="rv-sum"><div class="rv-sum-head"><span>记得住的事</span>'
      + '<span class="rv-sum-p">' + keys.length + ' 个月</span></div>';
    keys.forEach(function (k) {
      h += '<div class="rv-li"><span class="rv-li-k">' + k + '月</span>'
        + '<span class="rv-li-v">' + escapeHtml(hs[k]) + '</span></div>';
    });
    h += '</div>';
  }
  if (String(y.lesson || '').trim()) {
    h += '<div class="rv-sum"><div class="rv-sum-head"><span>教训</span></div>'
      + '<div class="rv-sum-v">' + escapeHtml(y.lesson) + '</div></div>';
  }
  return h;
}

function rvAreaLabel(a) {
  if (!a) return '（已删除的分类）';
  return String((a.emoji || '') + ' ' + (a.name || '')).trim();
}

function rvIsCurrentPeriod(d) {
  if (!d) return true;
  const today = getTodayStr();
  return (d.cadence === 'month') ? (d.period === today.slice(0, 7)) : (d.period === today.slice(0, 4));
}

function rvPeriodLabel(d) {
  if (!d) return '';
  if (d.cadence === 'week') {
    /* 「10/26 那周」比「2026-W44」好读；没有 weekStart 的老数据退回原键。
       ★ 但老数据也能算出来 —— 有 period 就用 _weekKeyMonday 反推周一，
         否则日志页那条「上次复盘 · …」会露出一串 W44 这样的机器编号。 */
    let ws = String(d.weekStart || '');
    if (ws.length < 10 && d.period) ws = _weekKeyMonday(String(d.period));
    if (ws && ws.length >= 10) {
      const md = function (x) { return Number(x.slice(5, 7)) + '/' + Number(x.slice(8, 10)); };
      return md(ws) + ' – ' + md(addDaysStr(ws, 6));
    }
    return String(d.period || '');
  }
  if (d.cadence === 'year') return d.period + ' 年';
  const parts = String(d.period).split('-');
  return Number(parts[0]) + ' 年 ' + Number(parts[1]) + ' 月';
}

/* ---------- 动作 ---------- */
/* ---------- 周复盘：一屏两句话 ----------
   不做 stepper。月/年复盘分领域问，是因为「今年健康怎么样」值得展开；
   周复盘一年 52 次，分四屏会让人第二次就不想打开。 */
function rvStartWeek(key) {
  const TF = window.TFGoal;
  if (!TF || !TF.lifeWeekReviewOf) return;
  /* 从月 / 年的编辑态切过来时，先把那边没保存的内容存着，切回去还在 */
  if (_rv.draft && _rv.mode === 'edit') {
    _rv.cache[_rv.draft.cadence + '|' + _rv.draft.period] = {
      focus: _rv.draft.focus || '',
      notes: JSON.parse(JSON.stringify(_rv.draft.notes || {}))
    };
  }
  const wk = key || lifeWeekKey();
  const exist = TF.lifeWeekReviewOf(appData.reviews || [], wk);
  _rv.mode = 'week';
  _rv.weekKey = wk;
  const ek = (exist && exist.kiss) || {};
  _rv.weekDraft = {
    focus: exist ? String(exist.focus || '') : '',
    next: exist ? String(exist.next || '') : '',
    /* 四象限：老周复盘没有 kiss 字段，读出来就是四个空串 */
    kiss: {
      keep: String(ek.keep || ''),
      improve: String(ek.improve || ''),
      start: String(ek.start || ''),
      stop: String(ek.stop || '')
    }
  };
  /* 切回来时优先用刚才没保存的草稿（否则「切去看看月复盘」就等于丢掉这一周写的话） */
  const wkCache = _rv.weekCache && _rv.weekCache[wk];
  if (wkCache) {
    _rv.weekDraft = JSON.parse(JSON.stringify(wkCache));
    delete _rv.weekCache[wk];
  }
  renderLifeReview();
}

/* 还能不能往后翻一周：本周是上限。 */
function _rvCanNextWeek() {
  if (typeof _weekKeyMonday !== 'function' || typeof addDaysStr !== 'function') return false;
  const cur = _weekKeyMonday(_rv.weekKey);
  const todayMon = _weekKeyMonday((window.TFGoal && window.TFGoal.isoWeekKey)
    ? window.TFGoal.isoWeekKey(getTodayStr()) : getTodayStr());
  if (!cur || !todayMon) return false;
  return addDaysStr(cur, 7) <= todayMon;
}

/* 周复盘前后翻一周。补录上周 / 上上周的复盘只能从这里进 ——
   月、年的周期下拉在第 1 步，周复盘是一屏到底，不经过那一步。 */
function rvWeekStep(n) {
  const cur = (typeof _weekKeyMonday === 'function') ? _weekKeyMonday(_rv.weekKey) : '';
  if (!cur) return;
  if (Number(n) > 0 && !_rvCanNextWeek()) return;   /* 不许翻到还没过完的周 */
  /* 先存下当前这周写了的东西，翻回来还在 */
  if (_rv.weekKey && _rv.weekDraft) {
    _rv.weekCache = _rv.weekCache || {};
    _rv.weekCache[_rv.weekKey] = JSON.parse(JSON.stringify(_rv.weekDraft));
  }
  const nm = addDaysStr(cur, Number(n || 1) * 7);
  const key = (window.TFGoal && window.TFGoal.isoWeekKey) ? window.TFGoal.isoWeekKey(nm) : nm;
  rvStartWeek(key);
}

function rvSetWeek(key, val) {
  if (!_rv.weekDraft) return;
  /* "kiss.stop" 走两段路径，其余是一段（focus / next） */
  const seg = String(key || '').split('.');
  if (seg.length === 2) {
    if (!_rv.weekDraft.kiss) _rv.weekDraft.kiss = { keep: '', improve: '', start: '', stop: '' };
    _rv.weekDraft.kiss[seg[1]] = val;
    return;
  }
  _rv.weekDraft[key] = val;
}

/* 上一次周复盘写的「下一步」——周复盘不分领域，所以只看最近一条 week。
   ★ 必须是「当前这一周之前」的那条，不是全库最新那条。
     补录 8 月某一周时，如果取全库最新，屏幕上会出现 10 月写的话，
     读者会以为那是 8 月那周留下的交代。 */
function _rvLastWeekNext() {
  const list = (appData.reviews || []).filter(function (r) {
    return r && r.cadence === 'week' && String(r.period) < String(_rv.weekKey);
  });
  let best = null;
  list.forEach(function (r) {
    if (!best || String(r.period) > String(best.period)) best = r;
  });
  return best ? String(best.next || '') : '';
}

function rvWeekHtml() {
  const TF = window.TFGoal;
  const d = _rv.weekDraft || { focus: '', next: '' };
  /* ★ 范围必须跟着 _rv.weekKey 走。原来写的是 weekRangeOf(getTodayStr())，
     补录上周时会显示「本周 10/26–11/01」却在写另一周的话。 */
  const mon = (typeof _weekKeyMonday === 'function') ? _weekKeyMonday(_rv.weekKey) : '';
  const range = (TF && TF.weekRangeOf) ? TF.weekRangeOf(mon || getTodayStr()) : { start: '', end: '' };
  const fmt = function (ds) {
    if (!ds) return '';
    return Number(String(ds).slice(5, 7)) + '/' + Number(String(ds).slice(8, 10));
  };
  const items = (typeof lifeWeekItems === 'function') ? lifeWeekItems(_rv.weekKey) : [];
  const done = items.filter(function (w) { return w && w.done; }).length;
  const last = _rvLastWeekNext();

  let h = '<div class="rv-step">';
  /* 一周一屏，所以补录别的周只能在这里翻 —— 下拉放在月 / 年那一步，进不来。
     ★ 「下一周」翻到本周就停：周复盘是回顾，不是计划，
       能翻到未来的话就能给还没发生的一周写复盘，写完了还会在列表里当真。 */
  const canNext = _rvCanNextWeek();
  h += '<div class="rv-wnav">'
    + '<button class="rv-wnav-b" data-act="rvWeekStep" data-args=\'["-1"]\'>‹ 上一周</button>'
    + '<span class="rv-wnav-t">' + fmt(range.start) + ' – ' + fmt(range.end) + '</span>'
    + (canNext
      ? '<button class="rv-wnav-b" data-act="rvWeekStep" data-args=\'["1"]\'>下一周 ›</button>'
      : '<button class="rv-wnav-b off" disabled>下一周 ›</button>')
    + '</div>';
  h += '<div class="rv-meta">'
    + (items.length ? ('重点 ' + done + '/' + items.length) : '这周还没定重点') + '</div>';
  if (last) {
    h += '<div class="rv-last"><div class="rv-last-k">上周你说下周要推进</div>'
      + '<div class="rv-last-v">' + escapeHtml(last) + '</div></div>';
  }
  h += '<div class="rv-q" style="margin-top:var(--sp-16)">这周发生了什么</div>';
  h += '<textarea class="rv-input rv-area" rows="3" maxlength="300" data-input="rvSetWeek"'
    + ' data-input-args=\'["focus","@value"]\' placeholder="这周做得怎么样">'
    + escapeHtml(d.focus || '') + '</textarea>';
  /* 四个动词：写完「发生了什么」马上问「为什么」，再问「下一步往哪」。
     ★ 周复盘原来没有这一屏，理由是「一周只有两句话，加四象限是把它写重」。
       用户否了：一周做砸了，最先想清楚的就是「什么在消耗我」。 */
  h += '<div class="rv-q" style="margin-top:var(--sp-16)">四个方向</div>';
  /* 留白提示后面挂一个出口：周复盘最容易「想不起来」，而记录都在日志里 */
  h += rvLogGoNote('写不出来就空着 —— 想不起来这周干了什么，翻一眼日记就有。',
    (typeof _weekKeyMonday === 'function' ? _weekKeyMonday(_rv.weekKey) : ''));
  h += rvKissEditHtml(d.kiss, 'rvSetWeek', 'kiss.');
  h += '<div class="rv-q" style="margin-top:var(--sp-16)">下周想推进</div>';
  h += '<input class="rv-input" type="text" maxlength="120" data-input="rvSetWeek"'
    + ' data-input-args=\'["next","@value"]\' value="' + escapeHtml(d.next || '') + '"'
    + ' placeholder="下周最重要的一件事">';
  h += '</div>';
  return h;
}

function rvSaveWeek() {
  const TF = window.TFGoal;
  const d = _rv.weekDraft;
  if (!TF || !d || !_rv.weekKey) return;
  const focus = String(d.focus || '').trim();
  const next = String(d.next || '').trim();
  const kis = d.kiss || {};
  /* 四栏各自 trim；全空就整个不落库 —— 写一个 kiss:{keep:'',...} 进去，
     以后 view 态会以为「这条有 KISS」而画出四行空标题 */
  const kiss = {};
  let kissAny = false;
  ['keep', 'improve', 'start', 'stop'].forEach(function (k) {
    const v = String(kis[k] || '').trim();
    kiss[k] = v;
    if (v) kissAny = true;
  });
  if (!focus && !next && !kissAny) { showToast('至少写一句'); return; }

  const today = getTodayStr();
  const range = TF.weekRangeOf ? TF.weekRangeOf(today) : { start: today };
  const exist = TF.lifeWeekReviewOf(appData.reviews || [], _rv.weekKey);
  if (exist) {
    exist.focus = focus;
    exist.next = next;
    if (kissAny) exist.kiss = kiss;
    else delete exist.kiss;
    exist.date = today;
    exist.updatedAt = Date.now();
  } else {
    appData.reviews.push({
      id: newUid('rvi'),
      uid: newUid('rv'),
      cadence: 'week',
      period: _rv.weekKey,
      /* weekStart 存下来只为显示「10/26 那周」。★ 必须从 _rv.weekKey 反解出那一周的周一 ——
         原来写的是 weekRangeOf(今天)，补录上周时会存成本周的周一，
         列表里就显示成「10/26 那周」而内容其实属于 10/19 那周。 */
      weekStart: (typeof _weekKeyMonday === 'function' && _weekKeyMonday(_rv.weekKey)) || range.start,
      date: today,
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      focus: focus,
      next: next,
      notes: {},
      snapshot: {}
    });
    if (kissAny) appData.reviews[appData.reviews.length - 1].kiss = kiss;
  }
  saveData();
  _rv.mode = 'list';
  _rv.weekDraft = null;
  renderLifeReview();
  if (typeof renderLifeWeek === 'function') renderLifeWeek();
  showToast(exist ? '这周的话已更新' : '这周记下了');
}

function rvStart() {
  const today = getTodayStr();
  rvStartAt('month', today.slice(0, 7));
}

/* 直接进入某个周期的复盘（列表页的「本周 / 本月 / 今年」三行点进来）。
   ★ 之前只有一个「写一份复盘」按钮，点开永远落在月复盘，而列表首屏只摆着
     「本周」那一格 —— 用户得出的结论是「这个复盘只能周复盘」。周期不能靠
     一个下拉去猜，三个入口要各自摆出来。 */
function rvStartAt(cadence, period) {
  const TF = window.TFGoal;
  const today = getTodayStr();
  let p = period;
  if (!p) {
    if (cadence === 'year') p = today.slice(0, 4);
    else if (cadence === 'month') p = today.slice(0, 7);
    else p = (typeof lifeWeekKey === 'function') ? lifeWeekKey() : today;
  }
  if (cadence === 'week') { rvStartWeek(p); return; }
  /* 从周复盘切过来时把那边的草稿存着 */
  if (_rv.mode === 'week' && _rv.weekKey && _rv.weekDraft) {
    _rv.weekCache = _rv.weekCache || {};
    _rv.weekCache[_rv.weekKey] = _rv.weekDraft;
  }
  /* ★ 这里原来写的是 `_rv.cache = {}`（「新开一份，别把上一次编辑的残留带进来」）。
     但缓存是按 `cadence|period` 存键的，本来就不会串期 —— 一刀清空的实际效果是
     「从月切到周再切回来，刚才写的字全没了」。现在只保留本次目标周期的缓存。 */
  _rv.mode = 'edit';
  _rv.step = 0;
  _rv.draft = {
    cadence: cadence || 'month',
    period: p,
    focus: '',
    notes: {},
    snapshot: {}
  };
  _rvRebuildAreas();
  /* 这个周期刚才有没保存的草稿就接回来（按周期存键，不会串期） */
  const kept = _rv.cache[(_rv.draft.cadence) + '|' + (_rv.draft.period)];
  if (kept) {
    _rv.draft.focus = kept.focus || '';
    _rv.draft.notes = JSON.parse(JSON.stringify(kept.notes || {}));
    _rv.draft._loaded = true;
  }
  renderLifeReview();
}

/* 周期一变，能复盘的领域和快照都要重算。
   ★ 两个必须处理的：
     ① 先把当前周期已写的内容存进 _rv.cache，否则切一下周期就白写；
     ② 新周期如果有历史复盘就载入它，没有就**必须清空** ——
        留着上一个周期的 notes 会让「9 月的复盘里出现 10 月的话」。
   还有一件做不到的事：补录历史周期时**没有当时的进度**（系统不存历史快照）。
   所以 backfilled 的周期 pct 记 null，UI 显示「补录 · 无当时数据」，
   而不是拿今天的数字冒充 9 月的。 */
function _rvRebuildAreas() {
  const TF = window.TFGoal;
  const d = _rv.draft;
  if (!d || !TF) { _rv.areaIds = []; return; }
  const today = getTodayStr();
  const isNow = (d.cadence === 'month') ? (d.period === today.slice(0, 7)) : (d.period === today.slice(0, 4));

  _rv.areaIds = TF.lifeReviewAreaIds(appData.lifeAreas || [], appData.lifeGoals || [], d.cadence, d.period);
  d.snapshot = TF.lifeReviewSnapshot(appData.lifeAreas || [], appData.lifeGoals || [], rvCtx());

  if (!isNow) {
    /* 补录：进度一项都不能留 */
    Object.keys(d.snapshot).forEach(function (k) {
      d.snapshot[k] = Object.assign({}, d.snapshot[k], { pct: null, measured: false, backfilled: true });
    });
  }

  const prev = TF.lifeReviewFind(appData.reviews || [], d.cadence, d.period);
  if (prev) {
    d.focus = prev.focus || '';
    d.notes = JSON.parse(JSON.stringify(prev.notes || {}));
    d._loaded = true;
  }
}

/* 切周期：缓存旧草稿 → 换周期 → 恢复（缓存优先，其次历史复盘，最后空） */
function rvPickPeriod(val) {
  const parts = String(val || '').split('|');
  if (parts.length !== 2) return;
  /* 周是另一套渲染（一屏两句话，不分领域），选到周就直接换过去 */
  if (parts[0] === 'week') { rvStartWeek(parts[1]); return; }
  if (!_rv.draft) return;
  const d = _rv.draft;
  const oldKey = d.cadence + '|' + d.period;
  _rv.cache[oldKey] = { focus: d.focus || '', notes: JSON.parse(JSON.stringify(d.notes || {})) };

  d.cadence = parts[0];
  d.period = parts[1];
  d._loaded = false;
  d.focus = '';
  d.notes = {};
  d.year = null;   /* 年字段只属于年复盘，切周期必须清掉，否则会带到别的年份/月份上 */
  d.month = null;  /* 月字段同理 */
  _rvRebuildAreas();

  const cached = _rv.cache[d.cadence + '|' + d.period];
  if (cached) {
    d.focus = cached.focus;
    d.notes = cached.notes;
  }
  renderLifeReview();
}

/* 字段写入：支持 "note.<areaId>.<key>" 这种路径，省掉为每个领域写一个函数 */
function rvSetField(path, val) {
  const d = _rv.draft;
  if (!d) return;
  const seg = String(path || '').split('.');
  if (seg[0] === 'focus') { d.focus = val; return; }
  if (seg[0] === 'month') {
    if (!d.month) d.month = { theme: '', prio: [], keep: '', improve: '', start: '', stop: '' };
    d.month[seg[1]] = val;
    return;
  }
  if (seg[0] === 'year' && seg[1] === 'lesson') {
    if (!d.year) d.year = { sat: null, highlights: {}, lesson: '' };
    d.year.lesson = val;
    return;
  }
  if (seg[0] === 'note' && seg.length === 3) {
    const aid = seg[1], key = seg[2];
    if (!d.notes[aid]) d.notes[aid] = {};
    d.notes[aid][key] = val;
  }
}

/* 年复盘的两个专用写入：满意度是点选的数，高光是 12 个格子。
   走 rvSetField 的 "year.xxx" 路径也行，但满意度是 number 不是 string，
   混在一起会让保存时多一层类型判断 —— 分开更省事。 */
function rvSetPrio(i, val) {
  const d = _rv.draft;
  if (!d) return;
  if (!d.month) d.month = { theme: '', prio: [], keep: '', improve: '', start: '', stop: '' };
  if (!Array.isArray(d.month.prio)) d.month.prio = [];
  d.month.prio[Number(i)] = val;
}

function rvSetYear(key, val) {
  const d = _rv.draft;
  if (!d) return;
  if (!d.year) d.year = { sat: null, highlights: {}, lesson: '' };
  if (key === 'sat') {
    const n = Number(val);
    d.year.sat = (n >= 0 && n <= 10) ? n : null;
    /* 满意度是点选，不是打字：整屏重绘比只改一个按钮的 class 更省心，
       而且能保证同一个数只有一个是选中的 */
    renderLifeReview();
    return;
  }
  d.year[key] = val;
}

function rvSetHighlight(m, val) {
  const d = _rv.draft;
  if (!d) return;
  const k = String(m);
  if (!d.year) d.year = { sat: null, highlights: {}, lesson: '' };
  if (!d.year.highlights) d.year.highlights = {};
  d.year.highlights[k] = val;
}

function rvNext() {
  const total = _rvTotal(_rv.draft);
  if (_rv.step >= total - 1) return;
  _rv.step++;
  renderLifeReview();
}
function rvPrev() {
  if (_rv.step <= 0) return;
  _rv.step--;
  renderLifeReview();
}

function rvSave() {
  const d = _rv.draft;
  if (!d) return;
  const TF = window.TFGoal;
  const today = getTodayStr();
  const existing = TF.lifeReviewFind(appData.reviews || [], d.cadence, d.period);

  /* 只保留有内容的领域：一片空白的分段写进库里，以后回看会以为「当时什么都没想」 */
  const notes = {};
  const snap = {};
  _rv.areaIds.forEach(function (aid) {
    const n = (d.notes && d.notes[aid]) || {};
    const ref = String(n.reflection || '').trim();
    const nxt = String(n.next || '').trim();
    if (!ref && !nxt) return;
    notes[aid] = { reflection: ref, next: nxt };
    snap[aid] = (d.snapshot && d.snapshot[aid]) || { pct: null, measured: false, goalCount: 0, habitPct: null, habitAvailable: true };
  });

  /* 年复盘特有：满意度 / 12 个月高光 / 教训。
     全空就不写这个字段 —— 存一个 {sat:null, highlights:{»}, lesson:''} 进库，
     回看会以为「当时答了但都是空」，和「当时没答」是两件事。 */
  let year = null;
  if (d.cadence === 'year' && d.year) {
    const hs = {};
    Object.keys(d.year.highlights || {}).forEach(function (k) {
      const v = String(d.year.highlights[k] == null ? '' : d.year.highlights[k]).trim();
      if (v) hs[k] = v;
    });
    const lesson = String(d.year.lesson || '').trim();
    const sat = (d.year.sat === 0 || d.year.sat) ? Number(d.year.sat) : null;
    if (sat !== null || lesson || Object.keys(hs).length) year = { sat: sat, highlights: hs, lesson: lesson };
  }

  /* 月复盘特有：主题 / 5 件优先 / KISS 四栏。全空不落库（同 year 的理由）。 */
  let month = null;
  if (d.cadence === 'month' && d.month) {
    const mm = d.month;
    const prio = (Array.isArray(mm.prio) ? mm.prio : [])
      .map(function (x) { return String(x == null ? '' : x).trim(); })
      .filter(function (x) { return x; });
    const obj = {
      theme: String(mm.theme || '').trim(),
      prio: prio,
      keep: String(mm.keep || '').trim(),
      improve: String(mm.improve || '').trim(),
      start: String(mm.start || '').trim(),
      stop: String(mm.stop || '').trim()
    };
    const any = obj.theme || prio.length || obj.keep || obj.improve || obj.start || obj.stop;
    if (any) month = obj;
  }

  if (!Object.keys(notes).length && !String(d.focus || '').trim() && !year && !month) {
    showToast('至少写一句');
    return;
  }

  if (existing) {
    existing.focus = String(d.focus || '').trim();
    existing.notes = notes;
    existing.snapshot = snap;
    if (year) existing.year = year;
    else if (existing.year) delete existing.year;
    if (month) existing.month = month;
    else if (existing.month) delete existing.month;
    existing.date = today;
    existing.updatedAt = Date.now();
  } else {
    appData.reviews.push({
      id: newUid('rvi'),
      uid: newUid('rv'),
      cadence: d.cadence,
      period: d.period,
      date: today,
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      focus: String(d.focus || '').trim(),
      notes: notes,
      snapshot: snap,
      year: year,
      month: month
    });
    /* 复盘也算一次「收尾」：写了复盘，这个周期的收尾横幅就该消失，
       否则用户会看到「已复盘」和「3 个目标待确认」并存，不知道还差什么。 */
    markReviewedForPeriod(d.cadence, d.period);
  }

  saveData();
  _rv.mode = 'list';
  _rv.draft = null;
  _rv.step = 0;
  renderLifeReview();
  if (typeof renderLifeWeek === 'function') renderLifeWeek();
  if (typeof renderLifeGoals === 'function') renderLifeGoals();
  showToast(existing ? '已更新这份复盘' : '复盘已存下');
}

/* 写复盘 = 这个周期算收过尾了。只给「这个周期内到期且还没下结论」的目标打标，
   不动 status —— 结论该由用户在收尾面板里给，复盘不替他做决定。 */
function markReviewedForPeriod(cadence, period) {
  const TF = window.TFGoal;
  if (!TF || !TF.lifeGoalInPeriod) return;
  const win = cadence === 'year'
    ? { cadence: 'year', period: String(period), alsoMonth: null }
    : { cadence: 'month', period: String(period), alsoMonth: null };
  const today = getTodayStr();
  (appData.lifeGoals || []).forEach(function (g) {
    if (!g || g.status !== 'active') return;
    if (!TF.lifeGoalInPeriod(g, win)) return;
    if (String(g.lastReviewedAt || '').slice(0, cadence === 'year' ? 4 : 7) === String(period)) return;
    g.lastReviewedAt = today;
    g.updatedAt = Date.now();
  });
}

function rvOpenView(id) {
  _rv.mode = 'view';
  _rv.viewId = id;
  renderLifeReview();
}

function rvDelete(id) {
  const list = appData.reviews || [];
  const idx = list.findIndex(function (r) { return r && idEq(r.id, id); });
  if (idx < 0) return;
  const go = function () {
    list.splice(idx, 1);
    saveData();
    _rv.mode = 'list';
    _rv.viewId = null;
    renderLifeReview();
    if (typeof renderLifeWeek === 'function') renderLifeWeek();
    showToast('已删除');
  };
  /* 复盘是「一年只有 12 次」的东西，删了就真没了，值得问一句 */
  if (typeof window.rsConfirm === 'function') window.rsConfirm('删除这份复盘？删掉之后不能恢复。').then(function (ok) { if (ok) go(); });
  else go();
}

/* ---------- 日志页顶部的复盘提醒条 ----------
   ★ 「写一份复盘」原来挂在目标页的本周重点下面。用户的原话：
     「我希望把那个写一份复盘移到日记那里」—— 复盘本来就属于日记，
     目标页是「定方向」的地方，不该同时承担「回看」的动作。
   这里做三件事：
     ① 到点了就说话（周日提周复盘 / 月底提月复盘 / 12 月提年复盘），
        没到点不打扰；
     ② 说清楚「哪一段还没写」，而不是笼统一句「去复盘」；
     ③ 点一下直接进那一段的编辑态（不是进列表再让人选一次）。
   宁少不多：同一时刻最多两条（周 + 月），年复盘和月复盘撞车时只留年。 */
function _rvLogBarItems() {
  const today = getTodayStr();
  const d = new Date(today + 'T00:00:00');
  const dow = d.getDay();                 /* 0 周日 */
  const y = today.slice(0, 4), m = today.slice(0, 7);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const items = [];
  const has = function (cadence, period) {
    const list = appData.reviews || [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r && r.cadence === cadence && String(r.period) === String(period)) return true;
    }
    return false;
  };
  const wk = (typeof lifeWeekKey === 'function') ? lifeWeekKey() : '';
  const ws = (typeof _weekKeyMonday === 'function') ? _weekKeyMonday(wk) : '';
  const range = ws ? (Number(ws.slice(5, 7)) + '/' + Number(ws.slice(8, 10)) + ' – ' +
    Number(addDaysStr(ws, 6).slice(5, 7)) + '/' + Number(addDaysStr(ws, 6).slice(8, 10))) : '';

  /* 周复盘：周日、或周一（补上周）提醒 */
  if (wk && (dow === 0 || dow === 1) && !has('week', wk)) {
    items.push({ cadence: 'week', period: wk, t: '这周（' + range + '）还没写复盘',
      s: dow === 0 ? '今天正好周日' : '上周过去了', go: '写周复盘' });
  }
  /* 月复盘：月底最后两天、或次月头两天 */
  if (!has('month', m) && (d.getDate() >= lastDay - 1 || d.getDate() <= 2)) {
    items.push({ cadence: 'month', period: m, t: Number(m.slice(5, 7)) + ' 月还没写复盘',
      s: '月初定方向 · 月末回头看', go: '写月度' });
  }
  /* 年复盘：12 月下半月、或 1 月头一周 */
  if (!has('year', y) && ((d.getMonth() === 11 && d.getDate() >= 15) || (d.getMonth() === 0 && d.getDate() <= 7))) {
    items.push({ cadence: 'year', period: y, t: y + ' 年还没写复盘',
      s: '满意度 · 12 个月高光 · 教训', go: '写年复盘' });
  }
  return items;
}

function renderLogReviewBar() {
  const box = document.getElementById('logReviewBar');
  if (!box) return;
  const items = _rvLogBarItems();
  const list = rvReviews();
  const last = list[0];
  let h = '';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    h += '<button class="lr-bar" data-act="rvJump" data-args=\'' + escapeHtml(JSON.stringify([it.cadence, it.period])) + '\'>'
      + '<span class="lr-bar-main">'
      + '<span class="lr-bar-t">' + escapeHtml(it.t) + '</span>'
      + '<span class="lr-bar-s">' + escapeHtml(it.s) + '</span>'
      + '</span>'
      + '<span class="lr-bar-go">' + escapeHtml(it.go) + ' ›</span>'
      + '</button>';
  }
  if (!h) {
    /* ★ 这里曾经加过「本周还没写复盘（10/26 – 11/1）｜写周复盘 ›」这条常驻催办，
       用户第二天（周二）就否了：「我周二我写什么周复盘呀，我是让在日记里面整」。
       对：周复盘的提醒点就是周日 / 周一（_rvLogBarItems 已经在管），
       平时的日志页是用来写日记的地方，不是待办清单。
       所以没到点就只留一条很淡的入口，不催、不喊、不数日子。 */
    const label = last ? ('上次复盘 · ' + rvPeriodLabel(last)) : '还没写过复盘';
    h = '<button class="lr-bar lr-bar--quiet" data-act="openLifeReview">'
      + '<span class="lr-bar-main"><span class="lr-bar-t">📝 ' + escapeHtml(label) + '</span>'
      + '<span class="lr-bar-s">周日写周、月底写月、12 月写年 · 什么时候写都不晚</span></span>'
      + '<span class="lr-bar-go">复盘 ›</span></button>';
  }
  box.innerHTML = h;
}

/* 从日志页直接进某一段的编辑态（周 / 月 / 年） */
/* 「想不起来就空着」这句话本身没错，错在它是个死句 —— 用户想不起来的时候
   需要的不是被安慰，而是一眼看到那段时间到底记了什么。
   ★ 跳的是「📔 日记」标签那一天，不是「🍅 日志」标签：
     日志页只有番茄流水账，日记页顶部那行「今日专注 + 今日待办」摘要在
     renderDailyFocusSummary 里，再往下才是当天写的字 —— 想回忆一天的全部，
     在日记页一屏就够了。带 anchor 就翻到那天，空就退回今天。 */
function rvLogGoNote(tip, anchor) {
  const a = (typeof anchor === 'string') ? anchor : '';
  return '<div class="rv-pick-note">' + escapeHtml(tip)
    + '<button class="rv-pick-go" data-act="rvJumpToLog" data-args=\''
    + escapeHtml(JSON.stringify([a])) + '\'>打开日记 ›</button></div>';
}

function rvJumpToLog(dateStr) {
  closeModal('lifeReviewModal');
  if (typeof switchView === 'function') switchView('log');
  /* anchor 三种形态：'YYYY-MM-DD'（那周周一）、'YYYY-MM'（那个月）、''（今天）。
     月复盘只带年月，落到那个月 1 号 —— 日记页有日期选择器，到了那附近就能往后翻。 */
  let ds = (typeof dateStr === 'string') ? dateStr : '';
  if (/^\d{4}-\d{2}$/.test(ds)) ds = ds + '-01';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) ds = getTodayStr();
  setTimeout(function () {
    try {
      if (typeof switchLogTab === 'function') switchLogTab('diary');
      if (typeof __set_currentDiaryDate === 'function') __set_currentDiaryDate(ds);
      if (typeof renderDiary === 'function') renderDiary();
      window.scrollTo(0, 0);
    } catch (e) { window.scrollTo(0, 0); }
  }, 60);
}

function rvJump(cadence, period) {
  _rv.mode = 'list';
  _rv.draft = null;
  renderLifeReview();
  if (cadence === 'week') { rvStartWeek(); }
  else { rvStartAt(cadence, period); }
  showModal('lifeReviewModal');
}

/* ---------- 全局桥接 ---------- */
window.openLifeReview = openLifeReview;
window.closeLifeReview = closeLifeReview;
window.renderLifeReview = renderLifeReview;
window.rvStart = rvStart;
window.rvStartAt = rvStartAt;
window.rvNext = rvNext;
window.rvPrev = rvPrev;
window.rvSave = rvSave;
window.rvSetField = rvSetField;
window.rvSetPrio = rvSetPrio;
window.rvSetYear = rvSetYear;
window.rvSetHighlight = rvSetHighlight;
window.rvPickPeriod = rvPickPeriod;
window.rvOpenView = rvOpenView;
window.rvJump = rvJump;
window.rvJumpToLog = rvJumpToLog;
window.renderLogReviewBar = renderLogReviewBar;
window.rvDelete = rvDelete;
/* 复盘入口已经从目标页撤走（搬到日志页的 renderLogReviewBar），
   lifeReviewEntryHtml 这个函数跟着删了 —— 桥接行留着就是 ReferenceError。 */
window.rvStartWeek = rvStartWeek;
window.rvSaveWeek = rvSaveWeek;
window.rvSetWeek = rvSetWeek;
window.rvWeekStep = rvWeekStep;
