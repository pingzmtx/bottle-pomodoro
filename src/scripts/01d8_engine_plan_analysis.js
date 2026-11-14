/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01d_engine_features.js 按域拆出（2026-11-14 · S2，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；engine.js 因拼接符 "\n;\n" 在每个新文件边界各多 1 个空语句（共 6 处，长度不变）。
 * 计划/习惯排序、数据分析 v2、记录对账。对外仅 getSortPrefs / sortTodos / sortHabits / ANALYZERS。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot 1 files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01d8_engine_plan_analysis.js
 * 分组：features
 * 职责：业务层——计划与习惯排序、智能关怀、幽灵对比、数据分析 v2、记录↔奖励对账
 * 功能：
 *   - 排序：getSortPrefs / sortTodos / sortHabits
 *   - 智能疲劳干预 · 关怀模式：连续 2 个被打断 / 近 3 天低产 / 连续未达标 ≥2 天 → 非强迫性关怀，轻松模式时长减半且首个满 10 分钟按完整🍅计入
 *   - 过去的自己（幽灵对比）：三档基准（去年今日→昨天→随机历史日）+ 中性化反馈
 *   - 数据分析 v2：周对比 / 效率 / 时长分布 / 周节奏 / 任务 / 打断 / 洞察 / 段位
 *   - 记录 ↔ 奖励对账（删除记录 / 改类型 共用）
 * 函数索引（TOC）：getSortPrefs/sortTodos/sortHabits/getHabitStage/degradeHabits/syncHabitGrowth/getHabitStreak/getWeekStartStr/countDayFullPoints/countWeekTomatoes/checkWeekHabitReq/weekHabitMissingDays（+21 更多）
 * ============================================================ */

/* ===== 计划 & 习惯排序功能 ===== */
/* 默认「自定义顺序」：用户用 ↑↓ 手动决定谁在前；字段排序为可选 */
/* 计划排序：字段 → 默认方向。时间类与四象限都默认「早的/要紧的在前」（升序），
   创建时间看最新的（降序），完成状态默认未完成在前（升序）。
   ★ 只在这里定义一次，setTodoSort 不再自己 if 一串字段名。 */
const TODO_SORT_DEF_DIR = { created: 'desc', pomodoros: 'desc', done: 'asc', planTime: 'asc', quad: 'asc' };
/* 排序偏好的一次性迁移：老数据里存过
     'remind'（按提醒时间）/ 'estend'（按预计结束）→ 现在合并成「计划时间」；
     'grid-day' / 'grid-week'（时间块曾是一种排序模式，现已独立成常驻网格）。
   不迁移的话，下拉框选不中任何 <option> 会显示空白、排序静默退回原序。 */
const TODO_SORT_LEGACY = { remind: 'planTime', estend: 'planTime', 'grid-day': 'planTime', 'grid-week': 'planTime' };
function getSortPrefs() {
  if (!appData.sortPrefs)
    appData.sortPrefs = { todos: { by: 'manual', dir: 'desc' }, habits: { by: 'manual', dir: 'asc' } };
  if (!appData.sortPrefs.todos) appData.sortPrefs.todos = { by: 'manual', dir: 'desc' };
  /* 「隐藏今天已完成」是视图开关，跟排序偏好同属"怎么看列表"，放同一处；
     老存档没有这个字段 → 默认 false（不改变任何人的现有观感）。 */
  if (typeof appData.sortPrefs.todos.hideDone !== 'boolean') appData.sortPrefs.todos.hideDone = false;
  if (!appData.sortPrefs.habits) appData.sortPrefs.habits = { by: 'manual', dir: 'asc' };
  /* 旧偏好迁移：remind / estend → planTime（只做一次，幂等） */
  const tb = appData.sortPrefs.todos.by;
  if (tb && TODO_SORT_LEGACY[tb]) appData.sortPrefs.todos.by = TODO_SORT_LEGACY[tb];
  return appData.sortPrefs;
}
function sortTodos(list) {
  const p = getSortPrefs().todos;
  const f = p.by,
    dir = p.dir === 'asc' ? 1 : -1;
  /* 排序锚点要一个「此刻」，整趟排序只取一次 —— 每条都比较一次 Date.now()，
     会让同一批里相邻的两条拿到不同的 now，顺序变得不可复现。 */
  const _nowD = new Date();
  const _nowDT = getTodayStr() + ' ' + String(_nowD.getHours()).padStart(2, '0') + ':' + String(_nowD.getMinutes()).padStart(2, '0');
  if (f === 'manual') return list.slice(); /* 自定义顺序：保持数组顺序 */
  return list.slice().sort(function (a, b) {
    let r = 0,
      aEmpty = false,
      bEmpty = false;
    if (f === 'created') r = (a.id || 0) - (b.id || 0);
    else if (f === 'pomodoros') {
      const av = a.pomodoros === null || a.pomodoros === undefined ? -1 : a.pomodoros;
      const bv = b.pomodoros === null || b.pomodoros === undefined ? -1 : b.pomodoros;
      r = av - bv;
    } else if (f === 'done') r = (a.done ? 1 : 0) - (b.done ? 1 : 0);
    else if (f === 'planTime') {
      /* 「计划时间」= 一个任务在时间轴上的整段位置。
         先比计划开始（= 提醒/开始时间），开始相同再比计划结束。
         ★ 不能只比某一个端点：只比开始，两个同点开始的任务顺序不稳定；
           只比结束，会让「早上开始、晚上结束」的长任务掉到晚上才开始的任务后面。
         ★ 多段计划：**过了的段不再算数，按还没结束的下一段排**。
            8:20~9:00 + 21:20~21:40 这条，10 点之后就该跟 21:20 那条一起排，
            而不是永远钉在 8:20 的位置上。锚点见 todoSortAnchor（纯函数）。 */
      const ia = todoSortAnchor(a, appData.settings, _nowDT),
        ib = todoSortAnchor(b, appData.settings, _nowDT);
      const ka = ia.start,
        kb = ib.start;
      aEmpty = !ka;
      bEmpty = !kb;
      r = ka === kb ? 0 : ka < kb ? -1 : 1;
      if (r === 0 && !aEmpty) {
        const ea = ia.end,
          eb = ib.end;
        r = ea === eb ? 0 : ea < eb ? -1 : 1;
      }
    } else if (f === 'quad') {
      const ra = quadRank(a.quad),
        rb = quadRank(b.quad);
      aEmpty = ra >= TODO_QUADS.length; /* 未分类 */
      bEmpty = rb >= TODO_QUADS.length;
      r = ra - rb;
    }
    /* ★ 没填这个字段的任务永远垫底，且**不随方向翻转**——
       否则倒序时「没提醒的」会顶到最前面，等于把空值当成了最大值，排序就没意义了。 */
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    if (r === 0) return 0;
    return r * dir;
  });
}
function sortHabits(list) {
  const p = getSortPrefs().habits;
  const f = p.by,
    dir = p.dir === 'asc' ? 1 : -1;
  const today = getTodayStr();
  if (f === 'manual') return list.slice(); /* 自定义顺序：保持数组顺序 */
  return list.slice().sort(function (a, b) {
    let r = 0;
    if (f === 'created') r = (a.id || 0) - (b.id || 0);
    else if (f === 'title') r = String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    else if (f === 'streak') r = getHabitStreak(a.id) - getHabitStreak(b.id);
    else if (f === 'points') r = (a.growthPoints || 0) - (b.growthPoints || 0);
    else if (f === 'checked') {
      const ac = (appData.habitLogs[a.id] || []).includes(today) ? 1 : 0;
      const bc = (appData.habitLogs[b.id] || []).includes(today) ? 1 : 0;
      r = bc - ac; /* 已打卡排前 */
    }
    /* 排序值相同保持原始创建顺序 */
    return r * dir;
  });
}
const HABIT_STAGES = [
  { min: 0, emoji: '🌱', name: '种子' },
  { min: 3, emoji: '🌿', name: '发芽' },
  { min: 7, emoji: '🌾', name: '长叶' },
  { min: 21, emoji: '🌸', name: '开花' },
  { min: 66, emoji: '🍎', name: '结果' }
];
function getHabitStage(points) {
  for (let i = HABIT_STAGES.length - 1; i >= 0; i--) {
    if (points >= HABIT_STAGES[i].min) return HABIT_STAGES[i];
  }
  return HABIT_STAGES[0];
}
/* ★ 2026-11-08 重写（原名保留：init 与 tools/full_patrol.py 都按这个名字调）。
 * 老实现是「每次打开 App 按最后一次打卡到今天的缺口扣分」，两处致命问题：
 *   ① 不看习惯节奏 —— 每周一/三/五/日的习惯，不该做的日子也算欠账；
 *   ② 没有已结算锚点 —— 同一个缺口每打开一次就再扣一遍。
 *   结果：间隔式习惯（每隔 N 天 / 每周几天）的成长点被反复扣到 0，用户实测「一直是 0」。
 * 现在换成一个纯函数按打卡记录重算（00_pure_core.habitGrowthPoints）：
 * 只扣「该做却没做」的过去日子，跳过日与不该做的日子不扣，今天不扣；幂等，开几次都一样。 */
function degradeHabits() {
  const today = getTodayStr();
  let changed = false;
  (appData.habits || []).forEach(function (h) {
    const pts = habitGrowthPoints(h, appData.habitLogs[h.id] || [], today, habitSkipsOf(h));
    if (h.growthPoints !== pts) { h.growthPoints = pts; changed = true; }
  });
  if (changed) saveData();
  return changed;
}
/* 单条重算：打卡 / 补卡 / 改跳过 / 改节奏之后立即同步，
 * 免得列表徽标是旧的、要等下次启动才对。 */
function syncHabitGrowth(h) {
  if (!h || !h.id) return 0;
  const pts = habitGrowthPoints(h, appData.habitLogs[h.id] || [], getTodayStr(), habitSkipsOf(h));
  h.growthPoints = pts;
  return pts;
}
/* 习惯连续数（排序 / 成就 / 周徽章都用这一个入口）。
 * ★ 2026-10-30：这里原来自己写了一份「按自然日往前数」的循环 —— 和 00_pure_core 的
 *   habitCurrentStreak 是同一件事的第二个实现。习惯有了「节奏」之后，连续数的定义变成
 *   「按命中日连续」，两份实现必然分叉（一份会把"今天不用做"算成断链）。
 *   现在只做委派：口径只有 00_pure_core 一处。 */
function getHabitStreak(id) {
  const h = (appData.habits || []).find(function (x) { return idEq(x.id, id); });
  /* ★ 2026-10-30 审查修复（M1）：跳过日必须一起传 —— 不传的话同一习惯
     在列表里「连续 3 天」、在排序 / 成就 / 周徽章里「连续 0 天」。
     读档入口 habitSkipsOf 现在在数据层（01b），这里够得着。 */
  return habitCurrentStreak(appData.habitLogs[id] || [], getTodayStr(), h, habitSkipsOf(h));
}
function getWeekStartStr(date) {
  const d = date ? new Date(date) : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const r = new Date(d.getFullYear(), d.getMonth(), diff);
  return getDateStr(r);
}
function countDayFullPoints(ds) {
  let s = 0;
  (appData.records || []).forEach(function (r) {
    if (getDateStr(r.startTime) === ds) s += getPomos(r);
  });
  return s;
}
/* 战力标专用周计数：完整🍅 减去「换任务」消耗掉的🍅。
   仅战力标使用本函数；趋势图/连续天数/番茄树等统计数据仍走 records，不受消耗影响。 */
function countWeekTomatoes(weekStartStr) {
  const ws = new Date(weekStartStr + 'T00:00:00').getTime();
  const we = ws + 7 * DAY_MS;
  /* 半个番茄按 0.5 计入周标点数（完整=1，半个=0.5），换任务消耗仍只扣完整番茄 */
  const raw = appData.records
    .filter(r => r.startTime >= ws && r.startTime < we)
    .reduce(function (s, r) {
      return s + getPomos(r);
    }, 0);
  return Math.max(0, raw - countSpentTomatoes(ws, we));
}
function checkWeekHabitReq(weekStartStr, habitReq) {
  if (!habitReq) return true;
  if (!appData.habits.length) return false;
  /* 没设习惯=没打卡：登峰造极/独孤求败标必须真实完成习惯打卡才能点亮 */ const totalHabits = appData.habits.length;
  const ws = new Date(weekStartStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let passedDays = 0,
    checkedDays = 0,
    allDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws);
    d.setDate(d.getDate() + i);
    if (d > today) break;
    passedDays++;
    const dateStr = getDateStr(d);
    const c = appData.habits.filter(h => (appData.habitLogs[h.id] || []).includes(dateStr)).length;
    if (c >= 1) checkedDays++;
    if (c >= totalHabits) allDays++;
  }
  if (habitReq === 'king') return checkedDays >= 5;
  /* 王者：本周至少5天打卡（可缺2天） */ if (habitReq === 'glory') return passedDays > 0 && allDays >= passedDays;
  /* 荣耀：每天全部习惯都打卡，不留容错 */ return true;
}
/* 本周至今还差几天才能满足习惯条件（用于界面提示） */
function weekHabitMissingDays(habitReq) {
  if (!habitReq) return 0;
  if (!appData.habits.length) return 7;
  const totalHabits = appData.habits.length;
  const ws = new Date(getWeekStartStr() + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let passedDays = 0,
    checkedDays = 0,
    allDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(ws);
    d.setDate(d.getDate() + i);
    if (d > today) break;
    passedDays++;
    const dateStr = getDateStr(d);
    const c = appData.habits.filter(h => (appData.habitLogs[h.id] || []).includes(dateStr)).length;
    if (c >= 1) checkedDays++;
    if (c >= totalHabits) allDays++;
  }
  if (habitReq === 'king') return Math.max(0, 5 - checkedDays);
  if (habitReq === 'glory') return passedDays - allDays;
  return 0;
}
/* 上一自然周的起始日（战标延续判定用），入参为 YYYY-MM-DD 的周起始日 */
function getPrevWeekStartStr(weekStartStr) {
  const base = weekStartStr || getWeekStartStr();
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() - 7);
  return getDateStr(d);
}
/* 本周「持有」番茄：战标/进度判定口径 = 完成 − 段位下注 − 商店兑换 + 扭蛋额外🍅
   countWeekTomatoes 只减段位下注、不减商店兑换 —— 那正是「兑完番茄战标还不灭」的原因。
   注意：延续标（carry，上周达成）不受影响，见 getBadgeState。 */
function getWeekHeldTomatoes() {
  const extra = (appData.rankSystem && appData.rankSystem.extraWeekTomatoes) || 0;
  const shopSpent = (appData.tree && appData.tree.weekTomatoSpent) || 0;
  return Math.max(0, countWeekTomatoes(getWeekStartStr()) - shopSpent + extra);
}
/* 兑换 spendQty 个番茄后，哪些「本周刚点亮」的战标会熄灭（延续中的标不算） */
function badgesAtRiskBySpend(spendQty) {
  if (!spendQty || spendQty <= 0) return [];
  const held = getWeekHeldTomatoes();
  const after = Math.max(0, held - spendQty);
  const out = [];
  WEEKLY_BADGES.forEach(function (b) {
    if (getBadgeState(b) !== 'this') return; /* 只影响本周刚点亮的 */
    if (held >= b.goal && after < b.goal) out.push(b); /* 兑换后跌破目标线 */
  });
  return out;
}
/* 战标状态：'this' 本周达成 / 'carry' 上周达成、本周延续 / 'off' 已熄灭
   本周达成按「当前持有」判定：番茄被兑换消耗后跌破目标线 → 本周标熄灭；
   上周达成延续中的标是历史既成荣誉，不因本周消耗而熄灭。 */
function getBadgeState(b) {
  const wb = appData.weeklyBadges || {};
  const currentWeek = getWeekStartStr();
  if (getWeekHeldTomatoes() >= b.goal && (!b.habitReq || checkWeekHabitReq(currentWeek, b.habitReq))) return 'this';
  const last = (wb.lastAchievedWeek || {})[b.id];
  if (last && last === getPrevWeekStartStr(currentWeek)) return 'carry';
  return 'off';
}
function processWeeklyBadges() {
  if (!appData.weeklyBadges) appData.weeklyBadges = { processedWeeks: [], cumulative: {}, lastAchievedWeek: {} };
  const wb = appData.weeklyBadges;
  if (!wb.processedWeeks) wb.processedWeeks = [];
  if (!wb.cumulative) wb.cumulative = {};
  if (!wb.lastAchievedWeek) wb.lastAchievedWeek = {};
  const currentWeek =
    getWeekStartStr(); /*[性能增强 v5.7.2] 热路径改走缓存助手；删除文件末尾 v5.7.2 增强模块即自动回退原逻辑*/
  const allWeeks = (function () {
    try {
      const _wi = window.__enhWeekInfo ? window.__enhWeekInfo() : null;
      if (_wi && _wi.currentWeek === currentWeek) return _wi.allWeeks;
    } catch (e) { if (window.__silent) window.__silent(e, '01d:processWeeklyBadges'); }
    const _a = new Set();
    appData.records.forEach(r => {
      if (r.type === 'full' || r.type === 'half') {
        const ws = getWeekStartStr(r.startTime);
        if (ws !== currentWeek) _a.add(ws);
      }
    });
    return _a;
  })();
  let updated = false;
  allWeeks.forEach(weekStr => {
    if (!wb.processedWeeks.includes(weekStr)) {
      const cnt = countWeekTomatoes(weekStr);
      WEEKLY_BADGES.forEach(b => {
        if (cnt >= b.goal && checkWeekHabitReq(weekStr, b.habitReq)) {
          wb.cumulative[b.id] = (wb.cumulative[b.id] || 0) + 1;
          if (!wb.lastAchievedWeek[b.id] || weekStr > wb.lastAchievedWeek[b.id]) wb.lastAchievedWeek[b.id] = weekStr;
          /* 周标传记：仅最近 2 周记（老数据补结算不刷屏），日期用实际周（周一） */ const _nw = getWeekStartStr();
          if (new Date(_nw + 'T00:00:00').getTime() - new Date(weekStr + 'T00:00:00').getTime() <= 14 * DAY_MS) {
            const _bb = UIFX.bioText('badge_new', { name: b.name, icon: b.icon });
            if (_bb) {
              _bb.key = 'badge_' + b.id + '_' + weekStr;
              appData.biographies.unshift({
                date: weekStr,
                key: _bb.key,
                title: _bb.title,
                text: _bb.text,
                edited: false
              });
            }
          }
        }
      });
      wb.processedWeeks.push(weekStr);
      updated = true;
    }
  });
  if (updated) saveData();
}


let _monY = 0,
  _monM = -1,
  _yrY = 0,
  _monthPickY = 0;
function _monCur() {
  const n = new Date();
  return { y: _monY || n.getFullYear(), m: _monM < 0 ? n.getMonth() : _monM };
}
function _monSet(y, m) {
  _monY = y;
  _monM = m;
}
function getDaysUntil(dateStr) {
  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / DAY_MS);
}
/* ===== 智能疲劳干预 · 关怀模式（新增） ===== */
/* 过去的自己（幽灵对比）开关：默认开启；关闭后幽灵条隐藏且不影响任何数据 */
function isGhostEnabled() {
  return appData.settings.ghostEnabled !== false;
}
function isEasyModeActive() {
  return appData.rankSystem.easyModeUntil === getTodayStr();
}
function checkCareNeeded() {
  /* 条件：① 连续2个番茄被打断 ② 近3天完成率低（每天<3个番茄占2天+） ③ 连续未达标≥2天
     ④ 单个番茄内打断次数 ≥3（一天之内就被反复打断，同样是明显的疲劳/受扰信号） */
  const recs = appData.records || [];
  const recent = recs.slice(-2);
  let intCnt = 0;
  recent.forEach(function (r) {
    if ((r.interruptions && r.interruptions.length) || (r.totalInterruptSeconds || 0) > 0) intCnt++;
  });
  if (recent.length >= 2 && intCnt >= 2) return true;
  /* ④ 单次番茄内打断 ≥3 次（不要求连续两个番茄，降低误伤「偶尔被打断一次」的情况） */
  if (recent.some(function (r) {
    return (r.interruptions && r.interruptions.length) >= 3;
  })) return true;
  let lowDays = 0;
  const dayMap = {};
  recs.forEach(function (r) {
    const ds = getDateStr(r.startTime);
    dayMap[ds] = (dayMap[ds] || 0) + getPomos(r);
  });
  const today = getTodayStr();
  for (let i = 1; i <= 3; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = getDateStr(d);
    if (ds === today) continue;
    if (!dayMap[ds]) continue; /* 当天没用过 App（无任何记录）不算「低完成率」——新手/偶尔打开不应被判疲惫 */
    if (dayMap[ds] < 3) lowDays++;
  }
  if (lowDays >= 2) return true;
  if ((appData.rankSystem.consecutiveUnder || 0) >= 2) return true;
  return false;
}
/* ===== 过去的自己（幽灵对比，新增）：三档基准 + 中性化反馈 ===== */
/* 专注段数计算（与 calcFocusRank 严格同表，避免两处口径不一致）：查 FOCUS_SEG_STEPS */
function calcFocusSeg(points) {
  let seg = 1,
    i = 0;
  if (typeof FOCUS_SEG_STEPS === 'undefined') return seg;
  while (i < FOCUS_SEG_STEPS.length && points >= FOCUS_SEG_STEPS[i]) {
    points -= FOCUS_SEG_STEPS[i];
    seg++;
    i++;
  }
  return seg;
}
function getGhostStats() {
  /* 幽灵基准三档：① 某年的同一天（年同比，叙事感强）② 昨天的自己（贴近日常）
     ③ 随机抽取一个有数据的历史日（新鲜感）。
     无论基准是谁，反馈一律中性化 —— 超不过绝不渲染任何「落后」字样。 */
  const recs = appData.records || [];
  const dayMap = {};
  recs.forEach(function (r) {
    const ds = getDateStr(r.startTime);
    dayMap[ds] = (dayMap[ds] || 0) + getPomos(r);
  });
  const now = new Date();
  /* ① 年同比：去年 → 前年 → 大前年 的同一天 */
  for (let y = 1; y <= 3; y++) {
    const d = new Date(now.getFullYear() - y, now.getMonth(), now.getDate());
    if (d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) continue; /* 闰年 2/29 对齐 */
    const ds = getDateStr(d);
    /* 只有今年着色：窗口两端为对齐周而伸出的前后年 padding 列保持空白 */
    const v = ds < now.getFullYear() + '-01-01' ? 0 : dayMap[ds] || 0;
    if (v > 0) return { value: v, label: now.getFullYear() - y + '年今日' };
  }
  /* ② 昨天的自己 */
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yds = getDateStr(y);
  const yv = dayMap[yds] || 0;
  if (yv > 0) return { value: yv, label: '昨天' };
  /* ③ 随机抽一个有数据的历史日（过滤前 20% 超常日，避免随机到「必输局」） */
  const dsList = Object.keys(dayMap).filter(function (k) {
    return dayMap[k] > 0;
  });
  if (dsList.length) {
    const vals = dsList
      .map(function (k) {
        return dayMap[k];
      })
      .sort(function (a, b) {
        return a - b;
      });
    const p80 = vals[Math.floor(vals.length * 0.8)];
    const pool = dsList.filter(function (k) {
      return dayMap[k] <= p80;
    });
    const finalPool = pool.length ? pool : dsList;
    const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
    if (dayMap[pick] > 0) return { value: dayMap[pick], label: pick.slice(0, 4) + '·' + pick.slice(5) };
  }
  return { value: 0, label: '过去' };
}

/* ===== 数据分析 v2：周对比 / 效率 / 时长分布 / 周节奏 / 任务 / 打断 / 洞察 / 段位 ===== */
/* 精确解析段位反馈消息的星数变化：先排除「不掉星」否定句，避免「保星生效！未达标也不掉星」被误判为掉星 */
function parseRankDelta(m) {
  if (m.indexOf('段位晋级') >= 0) return 1;
  if (m.indexOf('不掉星') >= 0 || m.indexOf('不会掉星') >= 0) return 0;
  const dm = m.match(/降星\s*(\d+)/) || m.match(/-\s*(\d+)\s*⭐/);
  if (dm) return -parseInt(dm[1]);
  /* 加分：优先「额外 +N⭐」（爆发/连胜加成），其次 上星/连胜/赌注赢了 */
  const px = m.match(/额外\s*[+]?(\d+)\s*⭐/);
  if (px) return parseInt(px[1]);
  const pm = m.match(/(?:上星|连胜|赌注赢了)[^+\d]*[+]?(\d+)/);
  if (pm) return parseInt(pm[1]);
  const pm2 = m.match(/[+](\d+)/);
  if (pm2 && m.indexOf('星') >= 0) return parseInt(pm2[1]);
  return 0;
}
const _eventsParser = function (f) {
  const t = parseFeedbackTime(f.time);
  if (!t || isNaN(t)) return null;
  return { t: t, d: parseRankDelta(f.msg || '') };
};
function parseFeedbackTime(s) {
  if (!s) return NaN;
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}
/* [瓶子专注 · 作者 瓶子满天星 · ©2026 · MIT] */
/* ===== 记录 ↔ 奖励 对账（删除 / 改类型 共用）=====
   抽奖次数已改为「由 records 派生」，删记录天然回滚；
   但树积分是「累加 + 含运势/成长 buff」的，无法派生，只能在这些操作上做差值回滚 ——
   否则「补记一条 → 删掉」即可无限刷积分与树等级。 */
function recordRewardPomos(rec) {
  const p = getPomos(rec); /* 统一口径：不直接读 .pomos */
  return p > 0 ? p : 0;
}
/* 计划账（actualPomodoros / timeSpent）：计时与补记当时已加过一次，这里按同口径减回去 */
function revertPlanLedger(rec, pomos) {
  if (!rec || rec.todoId == null || rec.type === 'log') return;
  const t = (appData.todos || []).find(function (x) {
    return idEq(x.id, rec.todoId);
  });
  if (!t) return;
  t.actualPomodoros = Math.max(0, (t.actualPomodoros || 0) - pomos);
  t.timeSpent = Math.max(0, (t.timeSpent || 0) - (Number(rec.effectiveSeconds) || 0));
}
/* 记录发出的金币也要跟着回滚 —— 「一次计时 = 一条记录」的最后一块。
   一条记录身上挂着四样东西：时段（segs）、计划账（actualPomodoros/timeSpent）、树积分、金币。
   前三样删记录时已经回滚，只有金币还留在 tree.coinLog 里当孤儿（meta.recordId 指向不存在的记录）——
   这就是"删除后账目对不上"的来源。
   ★ 只认「挂在本记录 id 上的流水」（meta.recordId === rec.id），不碰每日任务/段位奖励那种
     一次性成就入账 —— 那些不是这条记录发的，删一条记录不该连带取消已得的成就。
   ★ 账本只增不删：回滚走 coinUndo 写一条**反向流水**，原始条目原样留着，
     否则「这 1 金币哪去了」以后再也查不出来。重复删 / 已撤过的都不重复撤。 */
function revertRecordCoinTx(rec) {
  if (!rec || rec.id == null) return;
  const log = (appData.tree && Array.isArray(appData.tree.coinLog)) ? appData.tree.coinLog : null;
  if (!log || !log.length) return;
  /* 先快照再遍历：coinUndo 会往同一个数组尾部 push 反向流水，边遍历边改会漏条目 */
  log.slice().forEach(function (tx) {
    if (!tx || !tx.meta || String(tx.meta.recordId) !== String(rec.id)) return;
    if (tx.undoOf) return;                                  /* 它自己就是一条反向流水 */
    const undone = log.some(function (x) {
      return x && x.undoOf && String(x.undoOf) === String(tx.id);
    });
    if (undone) return;                                     /* 已被撤过，别重复撤 */
    try {
      coinUndo(tx.id);
    } catch (e) { if (window.__silent) window.__silent(e, '01d:revertRecordCoinTx'); }
  });
}
/* 删除一批记录时调用：扣回它们当初贡献的树积分、计划账与金币。
   peakPoints / 称号刻意不动 —— 那是「历史峰值、退化不清零」的荣誉，
   且称号晋升、图鉴集齐奖励都是一次性事件，不降峰值也不会被重复领取。 */
function revertRecordRewards(list) {
  if (!list || !list.length) return;
  const tr = appData.tree;
  let pts = tr ? (tr.points || 0) : 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || typeof r !== 'object') continue;
    /* 段落已随记录一起存放（见 tbTodoSegList）：删掉这条记录，它的时段自然消失，
       不必再额外裁"计划身上的那一份" —— 这正是 2026-10-16 打通账本的目的。 */
    revertRecordCoinTx(r);
    if (!tr) continue;
    const p = recordRewardPomos(r);
    if (p > 0) pts -= p;
    revertPlanLedger(r, p);
  }
  if (tr) tr.points = Math.max(0, pts);
}
/* 改类型时调用：按折算番茄数差值补/退树积分与计划账 */
function adjustRecordRewards(rec, oldType, oldPomos) {
  if (!rec) return;
  const _old = Number(oldPomos) > 0 ? Number(oldPomos) : 0;
  const _new = recordRewardPomos(rec);
  const tr = appData.tree;
  if (tr && _new !== _old) tr.points = Math.max(0, (tr.points || 0) + (_new - _old));
  /* 计划账只在「非仅记录」时记账，与发放端 type !== 'log' 的条件保持一致 */
  const _dLedger = (rec.type === 'log' ? 0 : _new) - (oldType === 'log' ? 0 : _old);
  if (_dLedger !== 0 && rec.todoId != null) {
    const t = (appData.todos || []).find(function (x) {
      return idEq(x.id, rec.todoId);
    });
    if (t) t.actualPomodoros = Math.max(0, (t.actualPomodoros || 0) + _dLedger);
  }
}
function addTreePoints(p) {
  /* 防御：旧数据缺字段/损坏时避免 NaN 污染树养成 */
  if (typeof appData.tree.points !== 'number' || isNaN(appData.tree.points)) appData.tree.points = 0;
  /* 枯死状态：先复活或重种，否则不再成长 */
  if (appData.tree.dead) {
    UIFX.toast('🥀 树已枯死，请先重新种植（免费）或使用复活石复活');
    return;
  }
  const oldPoints = appData.tree.points;
  const oldStage = getTreeStage(oldPoints);
  const oldTitle = UIFX.getTreeTitle(appData.tree.peakPoints || 0);
  /* 今日运势 buff + 宝箱成长 buff：大吉/凶 等轻微成长加成（当日有效，乐子级不影响平衡） */
  const _fort = getFortune();
  let _mult = _fort && _fort.buff && _fort.buff.growth ? _fort.buff.growth : 1;
  const _dBoost = typeof appData.tree.dailyGrowBoost === 'number' ? appData.tree.dailyGrowBoost : 1;
  _mult *= _dBoost;
  const _gain = p * _mult;
  appData.tree.points += _gain;
  appData.tree.lastActiveDate = getTodayStr();
  if (appData.tree.points > appData.tree.peakPoints) appData.tree.peakPoints = appData.tree.points;
  /* 果实币经济：每 1 点积分 = 1 果实币（半个番茄向上取整也算 1 币） */
  /* 称号晋升检测（按历史峰值，退化不影响称号） */
  const newTitle = UIFX.getTreeTitle(appData.tree.peakPoints);
  if (newTitle.min > oldTitle.min) {
    UIFX.toast(newTitle.icon + ' 称号晋升：「' + newTitle.name + '」！');
    /* 植物称号进步：每次称号升级 → 赠 100 金币（任意时刻完成即得） */
    UIFX.showGift('🏅 植物称号进步：「' + oldTitle.name + '」→「' + newTitle.name + '」', COIN_TITLE_REWARD);
  }
  /* 检测树种解锁 */
  checkTreeSpeciesUnlock();
  /* 检测里程碑进化 */
  const newStage = getTreeStage(appData.tree.points);
  const evolved = newStage.min > oldStage.min;
  if (evolved) {
    UIFX.showTreeMilestone(oldStage, newStage);
    appData.tree.milestones.push({
      stage: newStage.name,
      emoji: newStage.emoji,
      points: appData.tree.points,
      date: getTodayStr() + ' ' + fmtTime(new Date())
    });
    if (appData.tree.milestones.length > 50) appData.tree.milestones.length = 50;
    /* 每次进化自动获得1个🍅果实（纯纪念品，不影响积分） */
    appData.tree.fruitCount = (appData.tree.fruitCount || 0) + 1;
    appData.tree.totalFruitsHarvested = (appData.tree.totalFruitsHarvested || 0) + 1;
  }
  /* 随机惊喜宝箱：每累计 10 点攒 1 个（含进化点）。
     宝箱次数落在 chestCount 上 —— 该字段此前定义了却无人读写，
     于是 showChest 无凭证乱弹、openChest 直接开奖不消耗任何东西。 */
  if (Math.floor(appData.tree.points / 10) > Math.floor(oldPoints / 10)) {
    appData.tree.chestCount = (appData.tree.chestCount || 0) + 1;
    setTimeout(
      function () {
        UIFX.showChest();
      },
      evolved ? 1400 : 500
    );
  }
  /* 成长图鉴：点亮当前树到达过的阶段（按树种独立收集） */
  const album = ensureTreeAlbum();
  /* 「万物园丁」成就以番茄树 9 阶全收集为准（保持旧成就语义） */
  const tomatoDone = ((appData.tree.speciesAlbum || {}).tomato || []).length >= 9;
  if (tomatoDone && !appData.tree.albumCelebrated) {
    appData.tree.albumCelebrated = true;
    setTimeout(function () {
      UIFX.toast('🎁 成长图鉴全收集！达成「万物园丁」成就！');
    }, 600);
  }
  /* 小里程碑：每 5 点一次过程反馈（非进化时），后期不再「干等大进化」 */
  if (!evolved && Math.floor(appData.tree.points / 5) > Math.floor(oldPoints / 5)) {
    const n = Math.floor(appData.tree.points / 5);
    const msgs = [
      '🌱 树苗又长高了一点',
      '🌿 根须扎得更深了',
      '🍃 新叶悄悄冒出来',
      '✨ 树梢泛起了微光',
      '🌾 枝条更有力了'
    ];
    UIFX.toast(msgs[(n - 1) % msgs.length] + '（累计 ' + appData.tree.points + ' 点）');
  }
  /* 年轮：世界树满级后每 50 点 +1 圈，长线目标不封顶 */
  const stars = getEternalStars(appData.tree.points);
  if (stars > (appData.tree.lastEternalStarAt || 0)) {
    const _old = appData.tree.lastEternalStarAt || 0;
    appData.tree.lastEternalStarAt = stars;
    for (let _n = _old + 1; _n <= stars; _n++) logEternalStar(_n);
    if (appData.tree.points >= 200) logTreeMaxed();
    const _tier = getEternalTier(stars);
    const _isNode =
      typeof ETERNAL_TIERS !== 'undefined' &&
      ETERNAL_TIERS.some(function (t) {
        return t.at === stars;
      });
    setTimeout(function () {
      UIFX.toast(
        '🪵 你的树长出第 ' +
          stars +
          ' 圈年轮！' +
          (_tier && _tier.cur ? '（' + _tier.cur.icon + ' ' + _tier.cur.name + '）' : '')
      );
      if (_isNode && _tier && _tier.cur)
        UIFX.toast(_tier.cur.icon + ' 长成了「' + _tier.cur.name + '」！（纯荣誉，无任何数值加成）');
    }, 1200);
  }
  /* 成长动画反馈 */
  UIFX.playTreeGrowAnim(p);
  /* 多种树：其他已种树也同步获得积分（静默成长，不弹里程碑） */
  let _tr = appData.tree;
  let _curSp = _tr.species || 'tomato';
  let _today = getTodayStr();
  if (!_tr.speciesPoints) _tr.speciesPoints = {};
  if (!_tr.speciesLastActive) _tr.speciesLastActive = {};
  _tr.speciesPoints[_curSp] = _tr.points;
  _tr.speciesLastActive[_curSp] = _today;
  (_tr.plantedSpecies || []).forEach(function (sid) {
    if (sid === _curSp) return;
    _tr.speciesPoints[sid] = (_tr.speciesPoints[sid] || 0) + p;
    _tr.speciesLastActive[sid] = _today;
  });
  /* 专注段数提升轻提示：跨过段边界时弹 */
  const _segOld = appData.tree._lastSeg || 1;
  const _segNew = calcFocusSeg(appData.tree.points);
  if (_segNew > _segOld) {
    UIFX.showLevelUpToast(
      '🎮',
      '专注段数提升',
      '已达 <b>第 ' + _segNew + ' 段</b>（累计 ' + appData.tree.points + ' 积分）',
      'var(--primary)',
      2600
    );
  }
  appData.tree._lastSeg = _segNew;
  saveData();
  checkNewAchievements();
}
