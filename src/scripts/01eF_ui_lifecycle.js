/* ==================== 模块: 01eF_ui_lifecycle.js | 职责: 目标层的周期（本周重点 / 季度检查点 / 月末年末收尾）| 分组: ui ==================== */
/* 为什么单独一个文件（而不是塞进 01eE）：
 * 01eE 管的是「目标本身长什么样」（卡片、列表、编辑弹窗），是**静态结构**；
 * 这个文件管的是「时间在目标上走过时发生了什么」——本周做了什么、季度该看一眼、
 * 月末该收尾。两者的触发时机不同（前者随目标变，后者随日期变），
 * 混在一个文件里，读代码的人会以为周重点也是目标的一个字段。
 *
 * 三条产品约束（都来自调研，不是我的偏好）：
 *   ① 周重点**不进 todos** —— 它是「方向」，不是「今天要干的事」。
 *      混进计划列表会污染日历、统计、番茄记录，而且会被"完成率"绑架。
 *   ② 提示只在「窗口内 + 从未处理」时出现（habitsync 的上升沿）——
 *      持续落后不重复发、确认过就不再提。目标页最怕「打开就欠债」。
 *   ③ 收尾窗口过了也能补录，只是不主动提醒（timeto.me 的教训）——
 *      只给 3 天窗口的产品，错过一次就再也不打开了。
 *
 * 进度一律走 00b_goal_progress.js 的纯函数，这里不重算任何百分比。
 *
 * 函数索引（TOC）：lifeWeekKey/lifeWeekList/lifeWeekItems/lifeWeekById/lifeWeekLastUnfinished/lifeWeekAdd/lifeWeekToggle/lifeWeekDel/lifeWeekCarry/renderLifeWeek/renderLifeWeekHtml/renderLifeNoticeHtml（+28 更多）
 *   lifeWeekCarry/renderLifeWeek/renderLifeWeekHtml/renderLifeNoticeHtml/
 *   renderLifeCycle/lifeGoalCheckpointHtml/lifeGoalCheckpointSet/lifeGoalCheckpointNote/
 *   lifeGoalCheckpointDone/openLifeCheckpointEval/openLifeEval/closeLifeEval/lifeEvalDecide
 * ============================================================ */

/* 一周最多 3 条重点。借 flow-dashboard 的 GOAL_DEFAULT_SLOTS=4 的思路：
 * 一屏 10 条重点等于没有重点。3 条是「一周真正能推进的量」。 */
/* 三个空位是「起步的脚手架」，不是上限。
 * ★ 原来这里叫 LIFE_WEEK_MAX = 3，加到第三条就不让加了 —— 用户当场问
 *   「本周重点你凭什么只能加三件」。他问得对：一周只准有三件是纸手账的排版
 *   限制，不是纪律；软件没有格子数量限制，凭什么替人做减法。
 *   现在是：空的时候画三条待填横线（第一眼的脚手架），写满三条就再给一个「＋」，
 *   想写几条写几条。克制靠「这周有三条重点」这句话，不靠拦着不让写。 */
const LIFE_WEEK_SLOTS = 3;

/* 只提示「上周」的未完成，不追溯更早 —— 三周前的残留自动消失，
 * 不做「你还有 17 条没做完」这种账本。 */
const LIFE_WEEK_CARRY_WINDOW = 1;

let _lifeEvalWin = null;      /* 收尾弹窗当前窗口 */

/* ---------- 周键与读取 ---------- */
function lifeWeekKey(ds) {
  const TF = window.TFGoal;
  if (!TF || !TF.isoWeekKey) return '';
  return TF.isoWeekKey(ds || getTodayStr());
}
function lifeWeekList() {
  if (!Array.isArray(appData.weekFocus)) appData.weekFocus = [];
  return appData.weekFocus;
}
function lifeWeekItems(key) {
  const k = key || lifeWeekKey();
  return lifeWeekList().filter(function (w) { return w && w.weekKey === k; });
}
function lifeWeekById(id) {
  const list = lifeWeekList();
  for (let i = 0; i < list.length; i++) if (list[i] && idEq(list[i].id, id)) return list[i];
  return null;
}
/* 上周未完成的条目：只在「本周还没加任何重点」或用户主动点时才展示，
   不做常驻横幅 —— 否则一周没开 App，周一回来就是一屏欠账。 */
function lifeWeekLastUnfinished() {
  const TF = window.TFGoal;
  if (!TF || !TF.shiftDay || !TF.isoWeekKey) return [];
  const lastKey = TF.isoWeekKey(TF.shiftDay(getTodayStr(), -7));
  if (!lastKey) return [];
  return lifeWeekList().filter(function (w) {
    return w && w.weekKey === lastKey && !w.done && String(w.text || '').trim();
  });
}

/* ---------- 写 ---------- */
function lifeWeekAdd() {
  const input = document.getElementById('lifeWeekInput');
  if (!input) return;
  const text = String(input.value || '').trim();
  if (!text) return;
  const key = lifeWeekKey();
  const list = lifeWeekItems(key);
  /* 不再拦条数。真要拦的是「一条都没做完又开新的」，那是行为问题不是数量问题，
     而且在加的那一下拦不住 —— 写下来总比记在脑子里强。 */
  const id = newUid('wf');
  lifeWeekList().push({
    id: id,
    uid: id,
    weekKey: key,
    text: text,
    done: false,
    doneAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now()
  });
  input.value = '';
  saveData();
  renderLifeWeek();
  /* 加完保持输入态：定周重点时通常一次写两三条，每次都要重新点输入框很烦。
     满员后输入框已经不存在，focus() 自然跳过。 */
  const next = document.getElementById('lifeWeekInput');
  if (next) next.focus();
}
function lifeWeekToggle(id) {
  const w = lifeWeekById(id);
  if (!w) return;
  w.done = !w.done;
  w.doneAt = w.done ? getTodayStr() : null;
  w.updatedAt = Date.now();
  saveData();
  renderLifeWeek();
}

function lifeWeekDel(id) {
  const list = lifeWeekList();
  for (let i = 0; i < list.length; i++) {
    if (list[i] && idEq(list[i].id, id)) {
      list.splice(i, 1);
      saveData();
      renderLifeWeek();
      return;
    }
  }
}

/* 把上周未完成的复制到本周（**复制不搬移**：上周的记录留着，
   否则回看上周会以为"那周我什么都没定"）。
   这是用户主动点的动作，不是自动滚动的欠账。 */
function lifeWeekCarry() {
  const src = lifeWeekLastUnfinished();
  if (!src.length) return;
  const key = lifeWeekKey();
  const cur = lifeWeekItems(key);
  let n = 0;
  for (let i = 0; i < src.length; i++) {
    const id = newUid('wf');
    lifeWeekList().push({
      id: id,
      uid: id,
      weekKey: key,
      lifeGoalId: (src[i].lifeGoalId && lifeGoalById(src[i].lifeGoalId)) ? src[i].lifeGoalId : null,
      text: src[i].text,
      done: false,
      doneAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: Date.now()
    });
    n++;
  }
  saveData();
  renderLifeWeek();
  showToast('带入 ' + n + ' 条');
}

/* ---------- 渲染：本周重点 ---------- */
function renderLifeWeek() {
  const box = document.getElementById('lifeWeekFocus');
  if (!box) return;
  let html = '';
  try {
    html += renderLifeWeekHtml();
  } catch (e) { if (window.__silent) window.__silent(e, '01eF:week'); }
  try {
    html += renderLifeNoticeHtml();
  } catch (e) { if (window.__silent) window.__silent(e, '01eF:notice'); }
  box.innerHTML = html;
}

function renderLifeWeekHtml() {
  const TF = window.TFGoal;
  const key = lifeWeekKey();
  const items = lifeWeekItems(key);
  const range = (TF && TF.weekRangeOf) ? TF.weekRangeOf(getTodayStr()) : { start: '', end: '' };
  const fmt = function (ds) {
    if (!ds) return '';
    return Number(String(ds).slice(5, 7)) + '/' + Number(String(ds).slice(8, 10));
  };
  const doneN = items.filter(function (w) { return w.done; }).length;

  /* 一块一张卡：标题（含这一周是哪几天）、三条槽位、输入行都在同一个底面。
     用户对这一块的原话是「就一行字啊在那，真的很丑」——
     原来空态只有一句「这周还没定重点。写三条，比写十条有用。」，
     高度全靠一句说明支撑。现在**三条槽位永远画出来**（写了的给勾，没写的
     留一条待填的横线），空着也是三行手账的骨架，而不是一句免责声明。 */
  let h = '<div class="lw-card">';

  /* 头部：左「本周重点」+ 下面一行日期；右边三个点表示三条的完成状态。
     原来的「0/3」是一个没有形状的数字，点阵一眼能看出还剩几个空格。 */
  h += '<div class="lw-head">';
  h += '<div class="lw-head-l">';
  h += '<span class="lw-title">本周重点</span>';
  if (range.start) {
    h += '<span class="lw-range">' + fmt(range.start) + ' – ' + fmt(range.end) + '</span>';
  }
  h += '</div>';
  /* 点阵：起步 3 个点，写超过 3 条就按实际条数点（最多 6 个，再多就用文字）。
     点阵在这里只是「几条里做了几条」，不是配额。 */
  const dotN = Math.min(6, Math.max(LIFE_WEEK_SLOTS, items.length));
  h += '<span class="lw-dots" aria-hidden="true">';
  for (let di = 0; di < dotN; di++) {
    const it = items[di];
    h += '<i class="lw-dot' + (it ? (it.done ? ' on' : ' has') : '') + '"></i>';
  }
  h += '</span>';
  h += '</div>';

  /* 三条槽位：条目和空槽位用同一套编号，所以「还有几条没写」是看得见的 */
  h += '<div class="lw-slots">';
  items.forEach(function (w, i) {
    h += '<div class="lw-item' + (w.done ? ' done' : '') + '">';
    h += '<div class="lw-row">';
    h += '<span class="lw-num">' + (i + 1) + '</span>';
    h += '<button class="lw-main" data-act="lifeWeekToggle" data-args=\'' + JSON.stringify([w.id]) + '\'>'
      + '<span class="lw-tick' + (w.done ? ' on' : '') + '"></span>'
      + '<span class="lw-t">' + escapeHtml(w.text || '') + '</span>'
      + '</button>';
    h += '<button class="lw-x" data-act="lifeWeekDel" data-args=\'' + JSON.stringify([w.id]) + '\' data-stop="1" title="删除">×</button>';
    h += '</div></div>';
  });

  /* 输入行就是「下一个空槽」，编号跟着走 —— 一眼知道这是第几条。
     ★ 「不挂目标」那个下拉和每条的「关联」已经去掉：一周三条重点
       是「这周我要推哪几件事」，挂到年度目标上既不改变任何统计，
       又让人以为一周只能服务一个目标。用户原话「你还不如取消呢」。 */
  /* 输入行永远在：写满三条也还在，只是 hint 换成「再加一条」。 */
  {
    h += '<div class="lw-add">';
    h += '<span class="lw-num">' + (items.length + 1) + '</span>';
    h += '<input id="lifeWeekInput" class="lw-input" type="text" placeholder="'
      + (items.length ? '再加一条…' : '这周最想推进的一件事…')
      + '" maxlength="40" data-keys="Enter" data-keydown="lifeWeekAdd">';
    h += '<button class="lw-add-btn" data-act="lifeWeekAdd" title="添加">＋</button>';
    h += '</div>';
  }
  /* 输入行之后的空槽：只有一条待填的横线，不写提示字 —— 三行都写
     「还没写」会把一张卡变成三个提示，而空行本身已经说明一切。 */
  for (let si = items.length + 1; si < LIFE_WEEK_SLOTS; si++) {
    h += '<div class="lw-slot"><span class="lw-num">' + (si + 1) + '</span><span class="lw-slot-line"></span></div>';
  }
  h += '</div>';

  /* 底部一行：空态说清「为什么至少写一条」，全做完就收一句，别的一律不写。
     常驻的说明文字越少，几行重点越像重点。
     ★ 原文案是「先写三条」—— 那时往上加第三条就被拦住（LIFE_WEEK_MAX）。
       条数限制已经取消，这里再说「三条」就是在暗示配额。 */
  let foot = '';
  if (!items.length) foot = '先写一条，想加几条都行 —— 写下来的才是取舍，写在脑子里的只是打算。';
  else if (doneN === items.length) foot = '这周的 ' + items.length + ' 条都做完了。';
  if (foot) h += '<div class="lw-foot">' + foot + '</div>';

  /* 上周未完成：只在「本周还空着」时提示，一次一周，不追溯更早 */
  const last = lifeWeekLastUnfinished();
  if (last.length && !items.length) {
    h += '<button class="lw-carry" data-act="lifeWeekCarry">上周还有 ' + last.length + ' 条没做完 · 带到这周</button>';
  }

  h += '</div>';
  return h;
}

/* ---------- 渲染：提示条（季度检查点 / 收尾窗口）---------- */
function renderLifeNoticeHtml() {
  const TF = window.TFGoal;
  if (!TF) return '';
  const today = getTodayStr();
  const goals = lifeGoalsOf().filter(function (g) { return g && g.status === 'active'; });

  let h = '';

  /* ① 季度检查点：按「到点且未确认」挑，最多提示一次汇总 */
  const due = [];
  goals.forEach(function (g) {
    const cp = TF.dueCheckpoint ? TF.dueCheckpoint(g, today) : null;
    if (cp) due.push({ goal: g, cp: cp });
  });
  if (due.length) {
    /* 只有「所有到点的都是同一季度」时才写 Q3；
       跨季度（比如 Q3 拖到 10 月初、Q4 又开始）硬写一个 Q 号会误导。 */
    const qs = {};
    due.forEach(function (x) { qs[x.cp.q] = 1; });
    const qKeys = Object.keys(qs);
    const qLabel = (qKeys.length === 1) ? ('Q' + qKeys[0] + ' 检查点到了') : '季度检查点到了';
    h += '<button class="lc-notice" data-act="openLifeCheckpointEval">';
    h += '<span class="lc-notice-t">' + qLabel + ' · ' + due.length + ' 个年度目标该看一眼</span>';
    h += '<span class="lc-arrow">›</span></button>';
  }

  /* ② 收尾窗口：只统计「还没下结论」的目标（status 仍 active） */
  const win = TF.lifeGoalEvalWindow ? TF.lifeGoalEvalWindow(today) : null;
  if (win) {
    const inWin = goals.filter(function (g) { return TF.lifeGoalInPeriod(g, win); });
    /* 本周期已经收过尾（有 lastReviewedAt 落在本周期）就不再挂横幅 */
    const pending = inWin.filter(function (g) {
      return String(g.lastReviewedAt || '').slice(0, win.cadence === 'year' ? 4 : 7) !== String(win.period);
    });
    if (pending.length) {
      h += '<button class="lc-notice lc-notice--eval" data-act="openLifeEval">';
      h += '<span class="lc-notice-t">' + escapeHtml(win.label) + ' · ' + pending.length + ' 个目标待确认</span>';
      h += '<span class="lc-arrow">›</span></button>';
    }
  }

  /* ③ 复盘入口已经不在这儿了 —— 挪到日志（日记）页那条提醒条（renderLogReviewBar）。
     ★ 复盘的动作起手就是「翻这周记了什么」，所以它该和日记在一起，
       不该混在目标页的提示区里；而且目标页的提示区只该说目标的事。 */

  /* ④ 数值陈旧：一条灰字，不点也行（点进去是第一个目标的弹窗） */
  const stale = TF.staleMeasureGoals ? TF.staleMeasureGoals(goals, today, 14) : [];
  if (stale.length) {
    h += '<button class="lc-stale" data-act="openLifeGoalModal" data-args=\'' + JSON.stringify([stale[0].id]) + '\'>';
    h += '<span class="lc-stale-t">' + stale.length + ' 个目标 14 天没更新数值</span>';
    h += '<span class="lc-arrow">›</span></button>';
  }

  if (!h) return '';
  /* 只有复盘这一条时，不要再套一层卡片边框 ——
     它会变成「本周重点」卡和分类 chip 之间夹着的一张孤零零的白卡，
     而它本身只是一句「去写复盘」。一条提示不值得一个盒子。 */
  return '<div class="lc-notices' + (h.indexOf('lc-notice-t') === h.lastIndexOf('lc-notice-t') && h.indexOf('lc-notice--eval') < 0 && h.indexOf('lc-stale') < 0 ? ' lc-notices--plain' : '') + '">' + h + '</div>';
}

/* ---------- 季度检查点（编辑弹窗内的片段，由 01eE 调用）---------- */
/* 只在年目标上出现：月目标只有 30 天，拆四个检查点没有意义。
 *
 * ★ 检查点走**草稿**（和标题、日期一起保存），不直接写 appData。
 *   如果它单独落库，就会出现「点了取消，标题的修改丢了，检查点的修改留着」
 *   —— 同一个弹窗里的字段有两套生命周期，用户永远猜不到哪个算数。
 *   代价是必须点保存才生效，但这正是弹窗里其他字段的规则。 */
function lifeGoalCheckpointHtml(g) {
  const TF = window.TFGoal;
  if (!TF || !g || (g.horizon || 'year') !== 'year') return '';
  const today = getTodayStr();
  /* ★ 走 TF.lifeGoalCheckpointsOf，别在这里自己拼「有存量就用存量」：
     存量里可能躺着目标开始之前的季末（老版本按日历年铺的四条），
     直接拿来渲染，10 月才立的目标就还是会出现 3 月、6 月、9 月。
     CheckpointsOf 会把「未确认且不在目标区间里」的滤掉、已确认的留着。 */
  const cps = TF.lifeGoalCheckpointsOf ? TF.lifeGoalCheckpointsOf(g, { today: today })
    : (Array.isArray(g.checkpoints) ? g.checkpoints : []);
  if (!cps.length) return '';

  const measured = (g.progressSource || '') === 'measure';
  /* 「已填几项」只数用户真的动过的（确认过 / 写了备注）。
     target 不算：测量型目标的 target 是按起止值线性插值出来的默认建议，
     四条天然都有数，算进去永远是 4/4，等于告诉用户「都做完了」。 */
  let filled = 0;
  cps.forEach(function (c) {
    if (c.doneAt || String(c.note || '').trim()) filled++;
  });
  /* 有到点的检查点就默认展开 —— 用户是从「Q3 检查点到了」那条提示点进来的，
     进来还得再点一次「展开」等于把入口藏了一层。 */
  const opened = !!(TF.dueCheckpoint && TF.dueCheckpoint(g, today));

  let h = '<details class="lg-cp"' + (opened ? ' open' : '') + '>';
  h += '<summary class="lg-cp-sum">季度检查点<span class="lg-cp-n">' + filled + '/' + cps.length + '</span></summary>';
  h += '<div class="lg-cp-body">';
  /* 以前这句只说了「多久填一次」，没说这是干什么的 —— 用户看完还是不知道
     该怎么用。检查点的意思其实是：一年很长，中途得有几个固定节点回头看一眼，
     不然要到年底才发现方向错了。所以先说清它是什么，再说怎么用。 */
  h += '<div class="lg-help" style="margin:0 0 var(--sp-8)">'
    + '一年太长，季末回头看一次：这季推进到哪了、要不要换个打法。'
    + '只列你这条目标在做的那些季末 —— 中间那格是当时该到的位置，可以改。'
    + '</div>';
  cps.forEach(function (c, i) {
    const dt = String(c.at || '');
    const label = 'Q' + c.q + ' · ' + Number(dt.slice(5, 7)) + '/' + Number(dt.slice(8, 10));
    h += '<div class="lg-cp-row">';
    h += '<div class="lg-cp-head"><span class="lg-cp-q">' + label + '</span>'
      + '<button class="lg-cp-done' + (c.doneAt ? ' on' : '') + '" data-cp="' + i + '"'
      + ' data-act="lifeGoalCheckpointDone" data-args=\'' + JSON.stringify([i]) + '\' data-stop="1"'
      + ' title="标记已看">' + (c.doneAt ? '✓' : '') + '</button></div>';
    h += '<div class="lg-cp-line">';
    if (measured) {
      h += '<input class="lg-input lg-mini-input lg-cp-target" type="number" step="any" inputmode="decimal" '
        + 'value="' + escapeHtml(c.target === null || c.target === undefined ? '' : String(c.target)) + '" '
        + 'placeholder="目标值" data-change="lifeGoalCheckpointSet" data-change-args=\'["' + i + '","@value"]\'>';
    }
    h += '<input class="lg-input lg-cp-note" type="text" maxlength="60" '
      + 'value="' + escapeHtml(c.note || '') + '" placeholder="这季到哪了" '
      + 'data-change="lifeGoalCheckpointNote" data-change-args=\'["' + i + '","@value"]\'>';
    h += '</div></div>';
  });
  h += '</div></details>';
  return h;
}

/* 草稿访问：01eE 持有 _lifeGoalDraft，这里只通过访问器拿引用。
   不把变量直接挂 window —— 那样任何文件都能把草稿整个换掉。 */
function _lgDraft() {
  return (typeof window.lifeGoalDraftGet === 'function') ? window.lifeGoalDraftGet() : null;
}
/* 草稿里还没有检查点时，先把默认值固化进去 —— 否则改的是临时数组，
   下次重画又变回默认值，用户会以为"填了没保存"。 */
function _lgDraftCheckpoints(d) {
  const TF = window.TFGoal;
  if (!Array.isArray(d.checkpoints) || !d.checkpoints.length) {
    const base = (TF && TF.lifeGoalCheckpointDefaults) ? TF.lifeGoalCheckpointDefaults(d, { today: getTodayStr() }) : [];
    d.checkpoints = base.map(function (c) { return Object.assign({}, c); });
  }
  return d.checkpoints;
}
/* 输入时不重画弹窗（会丢焦点），只写草稿 */
function lifeGoalCheckpointSet(idx, val) {
  const d = _lgDraft();
  if (!d) return;
  const cps = _lgDraftCheckpoints(d);
  const cp = cps[Number(idx)];
  if (!cp) return;
  const v = String(val === null || val === undefined ? '' : val).trim();
  cp.target = v === '' ? null : Number(v);
  if (!isFinite(cp.target)) cp.target = null;
  cp.touched = true;   /* 用户改过就不再跟着指标插值走 */
}
function lifeGoalCheckpointNote(idx, val) {
  const d = _lgDraft();
  if (!d) return;
  const cps = _lgDraftCheckpoints(d);
  const cp = cps[Number(idx)];
  if (!cp) return;
  cp.note = String(val || '');
}
/* 点 ✓ 只切那一个按钮的样式，不重画整屏 —— 用户可能正把光标停在备注框里。
   但**目标值输入框要同步**：第一次点 ✓ 会把默认检查点（带插值）固化进草稿，
   若输入框还留空，用户会以为「勾了但没算出来」。 */
function lifeGoalCheckpointDone(idx) {
  const d = _lgDraft();
  if (!d) return;
  const cps = _lgDraftCheckpoints(d);
  const cp = cps[Number(idx)];
  if (!cp) return;
  cp.doneAt = cp.doneAt ? null : getTodayStr();
  const btn = document.querySelector('.lg-cp-done[data-cp="' + Number(idx) + '"]');
  if (btn) {
    btn.classList.toggle('on', !!cp.doneAt);
    btn.textContent = cp.doneAt ? '✓' : '';
  }
  const inputs = document.querySelectorAll('.lg-cp-target');
  for (let i = 0; i < cps.length && i < inputs.length; i++) {
    const t = cps[i] && cps[i].target;
    inputs[i].value = (t === null || t === undefined) ? '' : String(t);
  }
}

/* 从提示条进入：打开第一个到点目标的弹窗，并滚到检查点那一段。
   不做「检查点专用页面」—— 检查点只有 4 行，为它单开一屏不划算。 */
function openLifeCheckpointEval() {
  const TF = window.TFGoal;
  if (!TF) return;
  const today = getTodayStr();
  const goals = lifeGoalsOf().filter(function (g) { return g && g.status === 'active'; });
  for (let i = 0; i < goals.length; i++) {
    if (TF.dueCheckpoint && TF.dueCheckpoint(goals[i], today)) {
      if (typeof openLifeGoalModal === 'function') openLifeGoalModal(goals[i].id);
      /* 弹窗刚渲染完，等一帧再滚 —— 立刻 scrollIntoView 会算在未布局的节点上 */
      setTimeout(function () {
        const sum = document.querySelector('#lgModalBody .lg-cp-sum');
        if (sum && sum.scrollIntoView) sum.scrollIntoView({ block: 'center' });
      }, 60);
      return;
    }
  }
}

/* ---------- 月末 / 年末收尾 ---------- */
function openLifeEval() {
  const TF = window.TFGoal;
  if (!TF || !TF.lifeGoalEvalWindow) return;
  const win = TF.lifeGoalEvalWindow(getTodayStr());
  if (!win) return;
  _lifeEvalWin = win;
  const box = document.getElementById('lifeEvalBody');
  if (!box) return;

  const goals = lifeGoalsOf().filter(function (g) { return TF.lifeGoalInPeriod(g, win); })
    .filter(function (g) {
      return String(g.lastReviewedAt || '').slice(0, win.cadence === 'year' ? 4 : 7) !== String(win.period);
    });

  const isYear = win.cadence === 'year';
  const title = document.getElementById('lifeEvalTitle');
  if (title) title.textContent = win.label;

  let h = '<div class="le-sub">'
    + (isYear ? '「带到明年」= 截止日改到明年年底' : '「继续」= 截止日顺延到下月')
    + '</div>';

  /* 年窗口里同时出现 12 月的月目标：分两组，不混在一起
     （混了会让人以为"这个 12 月目标是我今年的年度目标"） */
  const yearGoals = goals.filter(function (g) { return (g.horizon || 'year') === 'year'; });
  const monthGoals = goals.filter(function (g) { return (g.horizon || '') !== 'year'; });

  const group = function (label, list, yearMode) {
    if (!list.length) return '';
    let s = '<div class="le-group"><div class="le-group-head">' + label + '</div>';
    list.forEach(function (g) {
      const prog = TF.lifeGoalProgress
        ? TF.lifeGoalProgress(g, { today: getTodayStr(), habits: appData.habits || [], habitLogs: appData.habitLogs || {} })
        : { pct: null, measured: false };
      s += '<div class="le-goal">';
      s += '<div class="le-goal-top"><span class="le-goal-t">' + escapeHtml(g.title || '（未命名）') + '</span>';
      s += '<span class="le-goal-p">' + (prog.measured ? prog.pct + '%' : '未测量') + '</span></div>';
      s += '<div class="le-acts">';
      s += '<button class="le-btn" data-act="lifeEvalDecide" data-args=\'' + JSON.stringify([g.id, 'achieved']) + '\'>达成</button>';
      if (yearMode) {
        s += '<button class="le-btn" data-act="lifeEvalDecide" data-args=\'' + JSON.stringify([g.id, 'nextyear']) + '\'>带到明年</button>';
      } else {
        s += '<button class="le-btn" data-act="lifeEvalDecide" data-args=\'' + JSON.stringify([g.id, 'keep']) + '\'>继续</button>';
      }
      s += '<button class="le-btn le-btn--ghost" data-act="lifeEvalDecide" data-args=\'["' + String(g.id).replace(/"/g, '') + '","drop","@this"]\'>放弃</button>';
      s += '</div></div>';
    });
    s += '</div>';
    return s;
  };

  h += group('年度目标', yearGoals, true);
  /* 月目标的组名跟着周期走：年窗口里那组固定是 12 月；
     月窗口里要写「10 月目标」而不是笼统的「本月」—— 跨月补录时（1 月 2 日收 12 月），
     写「本月」会让人以为在收 1 月。 */
  if (monthGoals.length) {
    h += group(isYear ? '12 月目标' : (win.month + ' 月目标'), monthGoals, false);
  }
  /* 全部处理完了就自己关掉。
     ★ 这里原来画的是「这个周期没有需要收尾的目标 + 一个『好』按钮」，
       实测体验是：点完最后一个「继续」，面板还杵在屏幕上挡着下面所有内容，
       用户以为操作没生效。收尾是「一次性动作」，做完就该退场。 */
  if (!goals.length) {
    closeLifeEval();
    showToast(win.label + ' 收完了');
    return;
  }

  box.innerHTML = h;

  const foot = document.getElementById('lifeEvalFoot');
  if (foot) foot.innerHTML = '<button class="lg-btn" data-act="closeLifeEval">稍后再说</button>';
  showModal('lifeEvalModal');
}
function closeLifeEval() {
  closeModal('lifeEvalModal');
  _lifeEvalWin = null;
}

/* 三种结论的落库。共同点：都要写 lastReviewedAt，
 * 否则横幅会一直在（"收过了"这件事必须留痕，不能只靠 status 变）。 */
/* 「放弃」是这一屏唯一的破坏性操作，点错没有任何回退路径（status 一变
   目标就从列表消失）。所以做**二次确认**，而不是 toast 撤销：
   撤销需要考虑「5 秒内又新建了同 id 的目标」这类边角，而二次确认只有一次点击成本。 */
let _leDropArm = null;

function lifeEvalDecide(gid, verdict, el) {
  const g = lifeGoalById(gid);
  const win = _lifeEvalWin;
  if (!g || !win) return;
  const TF = window.TFGoal;
  const today = getTodayStr();

  if (verdict === 'drop' && _leDropArm !== gid) {
    _leDropArm = gid;
    if (el) {
      el.textContent = '确定放弃？';
      el.classList.add('armed');
      const restore = function () {
        if (_leDropArm !== gid) return;
        _leDropArm = null;
        el.textContent = '放弃';
        el.classList.remove('armed');
      };
      setTimeout(restore, 3000);
    }
    return;
  }
  _leDropArm = null;

  if (verdict === 'achieved') {
    g.status = 'achieved';
    g.achievedAt = today;
    g.doneAt = today;
  } else if (verdict === 'keep') {
    /* 顺延到下个月末：原截止日还在本月/更早时，不能原地不动 ——
       否则「时间已过 100%」会一直挂着，等于留了个永远完不成的目标。 */
    const td = String(g.targetDate || '');
    let y = Number(td.slice(0, 4)), m = Number(td.slice(5, 7));
    if (!y || !m) { y = Number(today.slice(0, 4)); m = Number(today.slice(5, 7)) + 1; }
    else { m += 1; }
    if (m > 12) { m = 1; y += 1; }
    const dim = TF && TF.daysInMonth ? TF.daysInMonth(y, m) : 28;
    g.targetDate = y + '-' + (m < 10 ? '0' : '') + m + '-' + dim;
    g.status = 'active';
  } else if (verdict === 'nextyear') {
    const y = Number(win.period) + 1;
    g.targetDate = y + '-12-31';
    g.status = 'active';
    g.checkpoints = [];      /* 新一年重新生成季度检查点，不继承去年的数值 */
  } else if (verdict === 'drop') {
    g.status = 'dropped';
    g.droppedAt = today;
    /* 挂在该目标上的任务不级联删，只解绑 —— 和删除目标时同一条规则 */
    (appData.todos || []).forEach(function (t) { if (t && idEq(t.lifeGoalId, g.id)) t.lifeGoalId = null; });
  }

  g.lastReviewedAt = today;   /* 留痕：不然横幅会一直在（"收过了"不能只靠 status 变） */
  g.updatedAt = Date.now();
  saveData();
  if (typeof renderLifeGoals === 'function') renderLifeGoals();
  openLifeEval();             /* 重画面板：处理完的自动从列表里消失 */
  renderLifeWeek();
}

/* ---------- 「⋯」更多菜单 ----------
   目标页头部的三个次级动作（进度 / 排序 / 管理）收在这里。
   摊成三个 chip 时「管理」会被挤到第二行，一个字挂在下面很难看。 */
function openLifeMore() {
  const box = document.getElementById('lifeMoreBody');
  if (!box) return;
  const n = lifeGoalsOf().length;
  let h = '<div class="lm-list">';
  /* 九向 / 愿望清单已经挪到页面上常驻的手账入口（.lg-hub）。
     这个折叠菜单还留着它们，就等于同一个页面有两条路 —— 用户不会记得哪条是新的。
     这里只留「不是一页，而是对当前列表做事」的动作。 */
  h += '<button class="lm-item" data-act="lifeMorePick" data-args=\'["board"]\'>'
    + '<span>进度一览</span><span class="lc-arrow">›</span></button>';
  if (n > 1) {
    h += '<button class="lm-item" data-act="lifeMorePick" data-args=\'["sort"]\'>'
      + '<span>排序目标</span><span class="lc-arrow">›</span></button>';
  }
  h += '<button class="lm-item" data-act="lifeMorePick" data-args=\'["areas"]\'>'
    + '<span>管理分类</span><span class="lc-arrow">›</span></button>';
  h += '</div>';
  box.innerHTML = h;
  const foot = document.getElementById('lifeMoreFoot');
  if (foot) foot.innerHTML = '<button class="rv-btn" data-act="closeLifeMore">取消</button>';
  showModal('lifeMoreModal');
}
function closeLifeMore() {
  closeModal('lifeMoreModal');
}
function lifeMorePick(kind) {
  closeLifeMore();
  if (kind === 'grid' && typeof openLifeGrid === 'function') openLifeGrid();
  else if (kind === 'board' && typeof openLifeBoard === 'function') openLifeBoard();
  else if (kind === 'sort' && typeof toggleLifeGoalSort === 'function') toggleLifeGoalSort();
  else if (kind === 'areas' && typeof openLifeAreaManager === 'function') openLifeAreaManager();
  else if (kind === 'wish' && typeof openLifeWish === 'function') openLifeWish();
}

/* ---------- 目标进度一览（四期）----------
   不做「和机器人比拼的目标榜」——机器人的目标是假数据，比出来没有意义。
   这里做的是**自己目标之间的排名**：谁在推进、谁在拖。
   排序规则：可测的按进度降序，未测量的沉底（不是当 0 排在最后一名 —— 它压根没参赛）。 */
function openLifeBoard() {
  const TF = window.TFGoal;
  if (!TF) return;
  const box = document.getElementById('lifeBoardBody');
  if (!box) return;
  const ctx = { today: getTodayStr(), habits: appData.habits || [], habitLogs: appData.habitLogs || {} };
  const areas = appData.lifeAreas || [];
  const areaOf = function (id) {
    for (let i = 0; i < areas.length; i++) if (areas[i] && idEq(areas[i].id, id)) return areas[i];
    return null;
  };

  /* 只排还在做的：已经做成或放下的不该继续参与「谁在拖」的排名 ——
     它们已经结算完了，摆在榜尾等于把完结的事重新拉回赛场。 */
  const list = lifeGoalSorted('all').filter(function (g) { return (g.status || 'active') === 'active'; });
  const rows = list.map(function (g) {
    const p = TF.lifeGoalProgress(g, ctx);
    return { g: g, pct: (p && p.measured) ? p.pct : null };
  });
  rows.sort(function (a, b) {
    if (a.pct === null && b.pct === null) return 0;
    if (a.pct === null) return 1;
    if (b.pct === null) return -1;
    return b.pct - a.pct;
  });

  let h = '<div class="lgb-sub">按进度排序</div>';
  if (!rows.length) {
    h += '<div class="le-empty">还没有目标。</div>';
  } else {
    h += '<div class="lgb-list">';
    rows.forEach(function (r, i) {
      const g = r.g;
      const a = areaOf(g.areaId);
      h += '<div class="lgb-row' + (r.pct === null ? ' lgb-row--dim' : '') + '">';
      /* 领域名并进标题行（小字），不再单独占一行 ——
       三行（标题/进度条/领域）读起来像三个独立信息，其实领域只是标题的注解。 */
    const areaLabel = a ? String((a.emoji || '') + ' ' + (a.name || '')).trim() : '';
    h += '<div class="lgb-top">';
    h += '<span class="lgb-rank">' + (r.pct === null ? '—' : (i + 1)) + '</span>';
    h += '<span class="lgb-name">' + escapeHtml(g.title || '（未命名）') + '</span>';
    /* 领域名紧跟标题（带个分隔点），不推到右边 ——
       推到右边会和百分比连在一起，读成「健康 50%」。 */
    if (areaLabel) h += '<span class="lgb-area">· ' + escapeHtml(areaLabel) + '</span>';
    h += '<span class="lgb-spacer"></span>';
    h += '<span class="lgb-pct">' + (r.pct === null ? '未测量' : (r.pct + '%')) + '</span>';
    h += '</div>';
    h += '<div class="lgb-track"><div class="lgb-fill" style="width:' + (r.pct === null ? 0 : r.pct) + '%"></div></div>';
      h += '</div>';
    });
    h += '</div>';
  }
  box.innerHTML = h;
  const foot = document.getElementById('lifeBoardFoot');
  if (foot) foot.innerHTML = '<button class="rv-btn" data-act="closeLifeBoard">关闭</button>';
  showModal('lifeBoardModal');
}
function closeLifeBoard() {
  closeModal('lifeBoardModal');
}

/* ---------- 今年九个方向（手账的一页）----------
 * 为什么是 3×3 而不是 1×9 竖排：九个方向要能一眼同时看见 ——
 * 「今年健康投入很多、关系基本空着」这件事只有并排时才看得出来；
 * 竖排读下来只会变成九条记录，读完也记不住哪几格是空的。
 *
 * ★ 格子内容直接取该领域的年度目标，不另建一套「每格一句话」的字段：
 *   那会变成第二个录入入口，同一件事两处各写一遍，早晚不一致。
 *   想改这格写什么，就去改那个目标。
 *
 * ★ 空着的格子照样占位，而且**不显示 0% 或「待填」**：留白本身是信息
 *   （今年这个方向我没安排），用完成度逼人填满会把留白也变成负债。
 */
function lifeGridHtml() {
  const _y = _lifeGridYear || '';
  if (_y && _y !== getTodayStr().slice(0, 4)) return lifeGridPastHtml(_y);
  const TF = window.TFGoal;
  const areas = appData.lifeAreas || [];
  const ctx = { today: getTodayStr(), habits: appData.habits || [], habitLogs: appData.habitLogs || {} };
  const year = getTodayStr().slice(0, 4);
  /* 九向里放「今年」和「本月」两类目标，而且只放当前周期的。
     ★ 原来只收 horizon === 'year' —— 于是用户兴冲冲加了一条月度目标，
       翻遍九向都找不到，以为功能坏了（「我明明添加了一个，它为什么不支持」）。
       九向问的是「这个方向在动吗」，月度和年度都在动。
       月度后面挂一个小「本月」标，才能分清哪条是这阵子的。
     ★ 但也不能什么年月的都往里塞：2025 年的年度目标、7 月的月度目标
       和今年的目标挤在同一格里，九向就不再是「今年九个方向」了。
       往年的在目标页的「以往」里，这里只看这一期。 */
  const all = lifeGoalSorted('all').filter(function (g) {
    const hz = g.horizon || 'year';
    if (hz !== 'year' && hz !== 'month') return false;
    if (lifeGoalIsPast(g)) return false;
    /* 已达成 / 已搁置的也不进九向：这一向还要不要使劲，看的是在做的那些。
       做完的挂在格子里跟着算平均，会让「这个方向 50%」既不是完成度
       也不是投入度。它们进往年展厅（带 ✓）。 */
    return (g.status || 'active') === 'active';
  });
  /* 没归类 / 归到已删方向的目标不能凭空消失 —— 单列一行「未归类」。
     丢一条用户手写的东西，比多显示一行丑得多。 */
  const areaIds = {};
  areas.forEach(function (a) { areaIds[a.id] = 1; });
  const loose = all.filter(function (g) { return !g.areaId || !areaIds[g.areaId]; });

  /* 年度关键词：年初最上面的那一行。
     ★ 年计划不该只是一串目标列表 —— 目标是「做什么」，关键词是「以什么姿态做」。
       手账年计划第一页写的总是这个，而不是九宫格里的小方块。
       一行字，不填也行：逼人硬想一个词，得到的通常是「努力」这种废话。 */
  const themeKey = (appData.lifeYearTheme || {})[year] || '';
  let h = lifeGridYearBarHtml();
  h += '<div class="lgrid-theme">'
    + '<label class="lgrid-theme-k" for="lgridThemeIn">' + year + ' 年的关键词</label>'
    + '<input class="lgrid-theme-in" id="lgridThemeIn" type="text" maxlength="24"'
    + ' placeholder="一个词，比如「收窄」" value="' + escapeHtml(themeKey) + '"'
    + ' data-input="lifeGridTheme" data-input-args=\'["@value"]\'>'
    + '</div>';

  h += '<div class="lgrid">';
  areas.forEach(function (a) {
    const mine = all.filter(function (g) { return g.areaId === a.id; });
    h += '<button class="lgrid-c' + (mine.length ? ' has' : '') + '"'
      + ' data-act="lifeGridPick" data-args=\'' + JSON.stringify([a.id]) + '\'>';
    /* emoji 和领域名同排，占一行 15px。
       之前它们各占一行，两行 38px 直接吃掉格子三分之一，
       剩下的空间只够写两个字。 */
    h += '<span class="lgrid-hd">'
      + '<span class="lgrid-e">' + escapeHtml(a.emoji || '') + '</span>'
      + '<span class="lgrid-n">' + escapeHtml(a.name || '') + '</span>'
      + '</span>';
    if (mine.length) {
      /* 这个方向下有几条年度目标就列几条。
         上一版只放第一条、其余写成「还有 N 条」—— 那是 3×3 方格时代
         为了等高做的妥协；现在是九行列表，每条本来就占一行，
         把它们折起来等于让用户永远看不到自己写的第二件、第三件事。
         单条也不再截到 2 行：列表里没有理由藏话。 */
      /* ★ 多条必须包进一个纵向容器。.lgrid-c 本身是 flex row（左边领域名、
         右边内容），直接把 .lgrid-line 一个个挂进去，它们会成为**并排的列**
         —— 三条目标挤成三个 60px 宽的竖条。 */
      h += '<span class="lgrid-lines">';
      mine.forEach(function (g) {
        const p = TF ? TF.lifeGoalProgress(g, ctx) : { pct: null, measured: false };
        h += '<span class="lgrid-line">'
          + ((g.horizon === 'month') ? '<span class="lgrid-m">本月</span>' : '')
          + '<span class="lgrid-g">' + escapeHtml(String(g.title || '')) + '</span>'
          + (p && p.measured ? '<span class="lgrid-p">' + p.pct + '%</span>' : '')
          + '</span>';
      });
      h += '</span>';
    } else {
      /* 空格子不写「待填」。写「待填」就是把留白变成负债；
         但右边要留一个极淡的 ＋，否则整行看起来是「这一项坏了 / 没加载出来」，
         而不是「这里还能写」。＋ 只是提示，点击的仍是整行。 */
      h += '<span class="lgrid-empty" aria-hidden="true">＋</span>';
    }
    h += '</button>';
  });
  h += '</div>';

  if (loose.length) {
    h += '<button class="lgrid-c has" data-act="lifeGridPick" data-args=\'["__none"]\'>'
      + '<span class="lgrid-hd"><span class="lgrid-e">❔</span>'
      + '<span class="lgrid-n">未归类</span></span>'
      + '<span class="lgrid-lines">';
    loose.forEach(function (g) {
      const p = TF ? TF.lifeGoalProgress(g, ctx) : { pct: null, measured: false };
      h += '<span class="lgrid-line">'
        + '<span class="lgrid-g">' + escapeHtml(String(g.title || '')) + '</span>'
        + (p && p.measured ? '<span class="lgrid-p">' + p.pct + '%</span>' : '')
        + '</span>';
    });
    h += '</span></button>';
  }

  h += '<div class="lgrid-foot">' + year + ' 年 · 每个方向今年想做成的事都列在这里。'
    + '空着也没关系，那只是今年没往这儿安排。</div>';

  /* 年初寄语：手账九宫格最底下那几行手写。
     ★ 它是**年初**写给自己的期望，不是年底的回看，所以不并进年复盘。
       也不预填任何东西 —— 系统替人写「今年要努力」只会让这句话失效。 */
  const note = (appData.lifeYearNotes || {})[year] || '';
  h += '<div class="lgrid-note">'
    + '<label class="lgrid-note-k" for="lgridNoteIn">年初寄语</label>'
    + '<textarea class="lgrid-note-in" id="lgridNoteIn" rows="3" maxlength="200"'
    + ' placeholder="年初写给自己的话。想不出来就空着。"'
    + ' data-input="lifeGridNote" data-input-args=\'["@value"]\'>'
    + escapeHtml(note) + '</textarea>'
    + '</div>';
  return h;
}

let _lifeGridYear = '';   /* 九向展厅看的是哪一年；空 = 今年 */

/* ---------- 往年回看：九向展厅 ---------- */

/* 有东西可看的年份：今年排第一，往年和今年之后进来的按年倒序。
 * 来源三处都算 —— 写过年复盘（有快照）、写过年计划（有关键词/寄语）、
 * 有那一年的目标。只看复盘会漏掉「计划过但没复盘」的年份。 */
function lifeGridYears() {
  const now = getTodayStr().slice(0, 4);
  const set = {};
  set[now] = 1;
  (appData.reviews || []).forEach(function (r) {
    if (!r || r.cadence !== 'year') return;
    const y = String(r.period || '').slice(0, 4);
    if (/^\d{4}$/.test(y)) set[y] = 1;
  });
  Object.keys(appData.lifeYearTheme || {}).forEach(function (y) { if (/^\d{4}$/.test(y)) set[y] = 1; });
  Object.keys(appData.lifeYearNotes || {}).forEach(function (y) { if (/^\d{4}$/.test(y)) set[y] = 1; });
  (appData.lifeGoals || []).forEach(function (g) {
    const k = lifeGoalCycleKey(g);
    if (k.length === 4) set[k] = 1;
  });
  return Object.keys(set).sort().reverse();
}

/* 年份切换条。往年只读 —— 这是「回看」，不是能穿越回去补记的年计划：
   允许改往年计划等于允许重写历史，明年的复盘就没法对着看了。
   ★ 只有一个年份时不画，一排只有一个选中的 chip 是纯噪音。 */
function lifeGridYearBarHtml() {
  const years = lifeGridYears();
  if (years.length < 2) return '';
  const cur = _lifeGridYear || getTodayStr().slice(0, 4);
  let h = '<div class="lgrid-years">';
  years.forEach(function (y) {
    h += '<button class="lgrid-ys' + (y === cur ? ' on' : '') + '"'
      + ' data-act="lifeGridYear" data-args=\'' + JSON.stringify([y]) + '\'>' + y + '</button>';
  });
  h += '</div>';
  return h;
}

/* 某一年的目标 —— 这里取的是全量，**不排除「放下了」**。
 * 列表页用 lifeGoalSorted('all')，它是活的清单，放弃的不该占位置；
 * 但展厅是回看，那一年「做成了 / 没做完 / 主动放下」三种结局都发生过，
 * 少掉一种，那年的记录就是残缺的。
 */
function _lgYearGoals(y, areaId) {
  const all = (typeof lifeGoalsOf === 'function') ? lifeGoalsOf() : [];
  return all.filter(function (g) {
    if (!g) return false;
    if ((g.areaId || '') !== (areaId || '')) return false;
    return lifeGoalCycleKey(g) === String(y);
  });
}

function lifeGridPastHtml(y) {
  const areas = appData.lifeAreas || [];
  /* 快照取那一年**最后写的**那条年复盘 —— 中途改过年复盘的话，
     以最后一版为准，和用户自己记忆里「那年结束时的样子」一致。 */
  let snap = null;
  (appData.reviews || []).forEach(function (r) {
    if (!r || r.cadence !== 'year') return;
    if (String(r.period || '').slice(0, 4) !== String(y)) return;
    if (!snap || String(r.date || '') > String(snap.date || '')) snap = r;
  });
  const ss = (snap && snap.snapshot) || {};
  const theme = ((appData.lifeYearTheme || {})[y] || '').trim();
  const note = ((appData.lifeYearNotes || {})[y] || '').trim();

  let h = lifeGridYearBarHtml();
  if (theme) {
    h += '<div class="lgrid-theme"><span class="lgrid-theme-k">' + y + ' 年的关键词</span>'
      + '<div class="lgrid-theme-v">' + escapeHtml(theme) + '</div></div>';
  }
  h += '<div class="lgrid">';
  /* 一个方向那年完全没安排，就只说一句「其余 N 个方向那年没安排」。
     九个格子全画出来、八个写着「没安排」，那是把空白当信息 ——
     空白本身不需要一行文字占位。有空的方向才占格子。 */
  const emptyAreas = [];
  areas.forEach(function (a) {
    const mine = _lgYearGoals(y, a.id);
    const s = ss[a.id] || null;
    if (!mine.length && !s) { emptyAreas.push(a.name || ''); return; }
    h += '<div class="lgrid-c' + (mine.length ? ' has' : '') + '">';
    h += '<span class="lgrid-hd"><span class="lgrid-e">' + escapeHtml(a.emoji || '') + '</span>'
      + '<span class="lgrid-n">' + escapeHtml(a.name || '') + '</span></span>';
    if (mine.length) {
      h += '<span class="lgrid-lines">';
      mine.forEach(function (g) {
        const st = g.status || 'active';
        h += '<span class="lgrid-line">'
          + (st === 'achieved' ? '<span class="lgrid-p ok">✓</span>' : '')
          + '<span class="lgrid-g">' + escapeHtml(String(g.title || '')) + '</span>'
          /* 那年留下的目标，除了「做成了」还有两种真实结局：
             没做完（还在，但时代过了）和主动放下。标出来才叫回看。 */
          + (st === 'achieved' ? '' : '<span class="lgrid-snap">' + (st === 'dropped' ? '放下了' : '没做完') + '</span>')
          + '</span>';
      });
      h += '</span>';
      /* 快照是那年结束时冻结的数字，和现在的进度不是一回事，
         所以要标出来源，否则用户会以为这是实时算的。 */
      if (s && !s.backfilled) {
        h += '<span class="lgrid-snap">那年年末 ' + (s.measured ? (s.pct + '%') : '没测')
          + (s.habitPct !== null && s.habitPct !== undefined ? ' · 习惯 ' + s.habitPct + '%' : '')
          + '</span>';
      }
    }
    h += '</div>';
  });
  h += '</div>';
  if (emptyAreas.length) {
    /* 只报个数，不点名。把八个方向名全列出来，一行字占三行高，
       读者真正想知道的只有「那年我只顾了一两个方向」这件事。 */
    h += '<div class="lgrid-snap" style="padding:var(--sp-8) 2px 0">其余 ' + emptyAreas.length
      + ' 个方向那年没安排</div>';
  }

  const doneN = lifeGoalSorted('all').filter(function (g) {
    return lifeGoalCycleKey(g) === String(y) && g.status === 'achieved';
  }).length;
  /* 页脚只说一句实话。标题已经写着「2025 年 · 回看」，这里再重复年份是废话；
     「只能看不能改」也不必声明 —— 页面上没有输入框，用户点两下就明白了。
     数字来源要交代清楚：写过年复盘才有「那年年末」的百分比，没写过就只有目标本身。 */
  if (note) {
    h += '<div class="lgrid-note"><span class="lgrid-note-k">年初寄语</span>'
      + '<div class="lgrid-note-v">' + escapeHtml(note) + '</div></div>';
  }
  /* ★ 统计行放最后：先看那年写了什么（关键词 → 方向 → 寄语），
     再看一句「做成了几件」。中间插一句数字，会把人从回忆里拽出来。 */
  const facts = [];
  if (doneN) facts.push('做成了 ' + doneN + ' 件');
  if (!snap) facts.push('那年没写年复盘，没有当时的进度数字');
  h += '<div class="lgrid-foot">' + (facts.length ? escapeHtml(facts.join('，')) + '。' : '那年没留下什么。') + '</div>';
  return h;
}

function lifeGridPickYear(y) {
  _lifeGridYear = String(y || '');
  openLifeGrid();
}

function openLifeGrid() {
  const box = document.getElementById('lifeGridBody');
  if (!box) return;
  const tit = document.getElementById('lifeGridTitle');
  const _y = _lifeGridYear || '';
  const _past = !!_y && _y !== getTodayStr().slice(0, 4);
  if (tit) tit.textContent = _past ? (_y + ' 年 · 回看') : (getTodayStr().slice(0, 4) + ' 年 · 计划');
  box.innerHTML = lifeGridHtml();
  const foot = document.getElementById('lifeGridFoot');
  if (foot) {
    /* 往年是只读回看，不给「加一方向」—— 那个按钮会往**今年**加，
       出现在 2025 年的页脚上等于让人以为在改 2025 年。 */
    foot.innerHTML = '<button class="rv-btn" data-act="closeLifeGrid">关闭</button>'
      + (_past ? '' : '<button class="rv-btn primary" data-act="lifeGridAddArea">加一方向</button>');
  }
  showModal('lifeGridModal');
}
function closeLifeGrid() { closeModal('lifeGridModal'); }

/* 点格 = 跳到该领域的年度目标。不在这里改内容 ——
   一格能改的话，它就成了第二个编辑面，和弹窗里的正式编辑必然分叉。 */
function lifeGridPick(areaId) {
  closeLifeGrid();
  _lifeGoalFilter = areaId;
  renderLifeGoals();
  const box = document.getElementById('lifeGoalsList');
  if (box && box.scrollIntoView) box.scrollIntoView({ block: 'start' });
}
/* 年度关键词：输入即存，和寄语同一套规则（空串就删，不留 '' 条目）。
   ★ 每次输入都 saveData 会有写放大，但这里输入的是二十来个字的一次性字段，
     一天最多敲几十下，比初稿丢字的代价小得多。 */
function lifeGridTheme(val) {
  const year = getTodayStr().slice(0, 4);
  if (!appData.lifeYearTheme) appData.lifeYearTheme = {};
  const t = String(val || '').trim();
  if (!t) delete appData.lifeYearTheme[year];
  else appData.lifeYearTheme[year] = t;
  if (typeof saveData === 'function') saveData();
}

/* 年初寄语：输入即存（不弹保存按钮 —— 一句话没写完就丢更让人恼火）。
   ★ 只在有内容时建 appData.lifeYearNotes，空串就删掉这个 key，
     否则每年的空寄语会让数据里长出一堆 '' 条目。 */
function lifeGridNote(val) {
  const year = getTodayStr().slice(0, 4);
  if (!appData.lifeYearNotes) appData.lifeYearNotes = {};
  const t = String(val || '');
  if (!t.trim()) delete appData.lifeYearNotes[year];
  else appData.lifeYearNotes[year] = t;
  if (typeof saveData === 'function') saveData();
}

function lifeGridAddArea() {
  closeLifeGrid();
  if (typeof openLifeAreaManager === 'function') openLifeAreaManager();
}

/* ---------- 统一渲染入口（renderGoalPage 调用）---------- */
function renderLifeCycle() {
  renderLifeWeek();
}

/* ---------- 全局桥接 ---------- */
window.renderLifeWeek = renderLifeWeek;
window.renderLifeCycle = renderLifeCycle;
window.lifeWeekAdd = lifeWeekAdd;
window.lifeWeekToggle = lifeWeekToggle;
window.lifeWeekDel = lifeWeekDel;
window.lifeWeekCarry = lifeWeekCarry;
window.lifeGoalCheckpointSet = lifeGoalCheckpointSet;
window.lifeGoalCheckpointNote = lifeGoalCheckpointNote;
window.lifeGoalCheckpointDone = lifeGoalCheckpointDone;
window.openLifeCheckpointEval = openLifeCheckpointEval;
window.openLifeEval = openLifeEval;
window.closeLifeEval = closeLifeEval;
window.lifeEvalDecide = lifeEvalDecide;
window.lifeGoalCheckpointHtml = lifeGoalCheckpointHtml;
window.openLifeMore = openLifeMore;
window.closeLifeMore = closeLifeMore;
window.lifeMorePick = lifeMorePick;
window.openLifeBoard = openLifeBoard;
window.closeLifeBoard = closeLifeBoard;
window.openLifeGrid = openLifeGrid;
window.closeLifeGrid = closeLifeGrid;
window.lifeGridPick = lifeGridPick;
window.lifeGridAddArea = lifeGridAddArea;
window.lifeGridNote = lifeGridNote;
window.lifeGridTheme = lifeGridTheme;
window.lifeGridYear = lifeGridPickYear;
