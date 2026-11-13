/* ============================================================
 * 01d5 · 统计链（统计缓存 / 日期索引 / 连续天数 / 周聚合 / 日质量 / 7日视图 / ANALYZERS 分析器 / 月年统计）
 * 由 01d_engine_features.js 按域拆出（可回退：本文件整段随 slot1 files 还原）
 * 注：本文件由两段区间合并而成（统计缓存链 + 月/年统计），中间夹的 UI 态/疲劳关怀留在 01d。
 * 函数索引（TOC）：invalidateStatsCache/buildStatsDateIndex/calcStreakStats/aggWeekRange/aggDateKeys/calcDayQuality/buildDay7/buildMood7/buildWeekView/buildTaskCompareRows/buildTaskIntStats/buildInterruptStats（+10 更多）
 * ============================================================ */
/* ===== 统计缓存：一次遍历聚合全部统计所需数据，数据未变化时自动复用（性能优化核心） ===== */
let _statsCache = { key: null };
/* 手动作废统计缓存：跨天、海报生成、手动刷新时调用，强制下一次 getStatsCache 重算配套） */
function invalidateStatsCache() {
  _statsCache = { key: null };
}
/* ===== getStatsCache 纯计算拆分 =====
 * 拆分原则：把原单函数内"建日期索引 / 连续天数 / 周区间聚合"三块纯计算抽为命名
 * 顶层函数（逻辑零改写、原样搬移），getStatsCache 变为"组装器"（key 命中判断 +
 * 调子函数 + 其余派生 + 组装返回）。返回结构 43 字段一字不动；缓存键语义不变。
  */
/* ① 单次全量遍历 → byDate 日期索引 + heat 周×时段热力 + periods 时段分布。
   每日期条目字段结构（zero 同构）供 01e 各处消费方直接读。 */
function buildStatsDateIndex(records) {
  const byDate = {};
  const heat = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  const periods = [0, 0, 0, 0];
  records.forEach(function (r) {
    const _rt = new Date(r.startTime);
    if (isNaN(_rt.getTime())) return; /* 防御：损坏/无效时间记录直接跳过，不让统计页崩溃 */
    const ds = getDateStr(r.startTime);
    if (isLogRecord(r)) return; /* 仅记录：不进任何按日统计（番茄/时长/情绪/时段/活跃天数） */
    if (!byDate[ds])
      byDate[ds] = {
        full: 0,
        half: 0,
        incomplete: 0,
        pomos: 0,
        fullPomos: 0,
        int: 0,
        minutes: 0,
        early: 0,
        night: 0,
        energySum: 0,
        energyN: 0,
        moodSum: 0,
        moodN: 0,
        tasks: {},
        durSum: 0,
        durN: 0,
        maxDur: 0,
        intSec: 0,
        pd: [0, 0, 0, 0]
      };
    const b = byDate[ds];
    const h0 = new Date(r.startTime).getHours();
    if (h0 >= 6 && h0 < 9) b.early++;
    if (h0 >= 0 && h0 < 6) b.night++;
    if (r.type === 'full') {
      b.full++;
      b.fullPomos += getPomos(r);
    } else if (r.type === 'half') b.half++;
    else if (r.type === 'incomplete') b.incomplete++;
    b.pomos += getPomos(r);
    /* 累加秒、按天取整一次（不是逐条 floor）：一条 59 秒的零头逐条丢掉，
       一天七八条就能少报 3~4 分钟，和日志页/日记页按秒算出来的数对不上。
       （「仅记录」在上面的 isLogRecord 早退里已经排除，这里不必再判。） */
    b.minutes += (r.effectiveSeconds || 0) / 60;
    if (r.energy) {
      b.energySum += r.energy;
      b.energyN++;
    }
    if (r.mood) {
      b.moodSum += r.mood;
      b.moodN++;
    }
    if (r.duration) {
      b.durSum += r.duration;
      b.durN++;
      if (r.duration > b.maxDur) b.maxDur = r.duration;
    }
    if (r.interruptions && r.interruptions.length) {
      b.int += r.interruptions.length;
      r.interruptions.forEach(function (x) {
        b.intSec += (x.endTime && x.startTime ? (x.endTime - x.startTime) / 1000 : 0) || 0;
      });
    }
    const tn = r.taskName || '未命名任务';
    b.tasks[tn] = (b.tasks[tn] || 0) + 1;
    let p;
    if (h0 >= 6 && h0 < 12) p = 0;
    else if (h0 >= 12 && h0 < 18) p = 1;
    else if (h0 >= 18 && h0 < 24) p = 2;
    else p = 3;
    periods[p]++;
    b.pd[p]++;
    if (r.type === 'full' || r.type === 'half') {
      const d0 = new Date(r.startTime);
      heat[d0.getDay()][p]++;
    }
  });
  Object.keys(byDate).forEach(function (k) {
    byDate[k].minutes = Math.round(byDate[k].minutes);
  });
  const zero = {
    full: 0,
    half: 0,
    incomplete: 0,
    pomos: 0,
    fullPomos: 0,
    int: 0,
    minutes: 0,
    early: 0,
    night: 0,
    energySum: 0,
    energyN: 0,
    moodSum: 0,
    moodN: 0,
    tasks: {},
    durSum: 0,
    durN: 0,
    maxDur: 0,
    intSec: 0,
    pd: [0, 0, 0, 0]
  };
  return {
    byDate: byDate,
    heat: heat,
    periods: periods,
    dateKeys: Object.keys(byDate).sort(),
    zero: zero
  };
}
/* ② 连续天数：当前连续（含 isStreakProtected 补位）+ 早间/夜间最长连续
   ★ 起算点：今天已经有整番茄 → 从今天数；今天还没有（这一天还没过完）
     → 从**昨天**数。原写法从今天起算，今天没整番茄就直接 break，于是
     ① 早上打开 App「连续 0 天」；② 海报按当下取值 → 昨天刚连上的也算 0。
     口径必须与 00_pure_core.habitCurrentStreak / 05_journey / snapshotStreakHistory 同义。 */
function calcStreakStats(byDate, dateKeys) {
  let streak = 0;
  let dt = new Date();
  const _sToday = getDateStr(dt);
  if (!((byDate[_sToday] && byDate[_sToday].full > 0) || isStreakProtected(_sToday))) {
    dt.setDate(dt.getDate() - 1);
  }
  while (true) {
    const ds = getDateStr(dt);
    if ((byDate[ds] && byDate[ds].full > 0) || isStreakProtected(ds)) {
      streak++;
      dt.setDate(dt.getDate() - 1);
    } else break;
  }
  const longestRun = function (pred) {
    let best = 0,
      cur = 0,
      prev = null;
    dateKeys.forEach(function (ds) {
      const d0 = new Date(ds + 'T00:00:00');
      const diff = prev ? Math.round((d0 - new Date(prev + 'T00:00:00')) / DAY_MS) : 1;
      if (diff !== 1) cur = 0;
      if (pred(byDate[ds])) {
        cur++;
        if (cur > best) best = cur;
      } else cur = 0;
      prev = ds;
    });
    return best;
  };
  const earlyStreak = longestRun(function (x) {
    return x.early > 0;
  });
  const nightStreak = longestRun(function (x) {
    return x.night > 0;
  });
  return { streak: streak, earlyStreak: earlyStreak, nightStreak: nightStreak };
}
/* ③ 周区间聚合（周一为周起始的 7 天窗口）：weekNow/weekPrev 复用；与旧 _aggWeek 等值 */
function aggWeekRange(byDate, dateKeys, startT, zero) {
  const keys = dateKeys.filter(function (ds) {
    const t = new Date(ds + 'T00:00:00').getTime();
    return t >= startT && t < startT + 7 * DAY_MS;
  });
  let full = 0,
    half = 0,
    inc = 0,
    mins = 0,
    ints = 0;
  keys.forEach(function (ds) {
    const b = byDate[ds] || zero;
    full += b.full;
    half += b.half;
    inc += b.incomplete;
    mins += b.minutes;
    ints += b.int;
  });
  return {
    full: full,
    half: half,
    inc: inc,
    mins: mins,
    ints: ints,
    eff: full + half + inc ? Math.round((full / (full + half + inc)) * 100) : null
  };
}
/* 自然月/本周聚合（用于海报「日/月番茄」口径，替代动辄上千的累计总番茄）。
   monthKey 形如 '2026-10'；返回与 aggWeekRange 同构，便于统一消费。 */
function aggDateKeys(byDate, keys, zero) {
  let full = 0, half = 0, inc = 0, mins = 0, ints = 0;
  keys.forEach(function (ds) {
    const b = byDate[ds] || zero;
    full += b.full;
    half += b.half;
    inc += b.incomplete;
    mins += b.minutes;
    ints += b.int;
  });
  return {
    full: full,
    half: half,
    inc: inc,
    mins: mins,
    ints: ints,
    eff: full + half + inc ? Math.round((full / (full + half + inc)) * 100) : null
  };
}
/* ===== getStatsCache 拆分 helper =====
 * calcDayQuality：无断档天数/单日峰值/整月达成/完美周计数
 * buildDay7 / buildMood7：近 7 天逐日（番茄+时长）与日记/状态均值
 * buildWeekView：周一为起始的 周对比(weekNow/weekPrev) + 效率/均长/时长分布 + 近 8 周节奏
 * buildTaskIntStats：任务完成度 / 近30天任务聚合 / 打断汇总
 * calcFocusRank：冲段积分（含冲刺区倍率/连击推导）+ 段位难度表 + 当前段位与冲刺信息
 * calcRankData：段位·上星数据（stars/tier/今日/溢缺/反馈） */
function calcDayQuality(dateKeys, byDate) {
const nobreakDays = dateKeys.filter(function (ds) {
  return byDate[ds].full >= 3 && byDate[ds].int === 0;
}).length;
const maxDayFull = dateKeys.reduce(function (s, ds) {
  return Math.max(s, byDate[ds].full);
}, 0);
const monthFull = (function () {
  const ym = {};
  dateKeys.forEach(function (ds) {
    const k = ds.slice(0, 7);
    ym[k] = (ym[k] || 0) + 1;
  });
  for (const k in ym) {
    if (ym[k] >= new Date(parseInt(k.slice(0, 4)), parseInt(k.slice(5, 7)), 0).getDate()) return true;
  }
  return false;
})();
const perfectWeekCount = (function () {
  if (dateKeys.length < 7) return 0;
  const win = {};
  let cnt = 0;
  for (let i = 0; i < dateKeys.length; i++) {
    const ds = dateKeys[i];
    win[ds] = byDate[ds];
    const keys = Object.keys(win).sort();
    while (keys.length && (new Date(keys[0] + 'T00:00:00') - new Date(ds + 'T00:00:00')) / DAY_MS > 6)
      delete win[keys.shift()];
    if (keys.length === 7) {
      let ok = true;
      for (let j = 0; j < 7; j++) {
        const dy = win[keys[j]];
        if (!dy || dy.full < 4 || dy.int > 0) {
          ok = false;
          break;
        }
      }
      if (ok) {
        cnt++;
        delete win[keys[0]];
      }
    }
  }
  return cnt;
})();
  return { nobreakDays: nobreakDays, maxDayFull: maxDayFull, monthFull: monthFull, perfectWeekCount: perfectWeekCount };
}
function buildDay7(byDate, zero) {
const day7 = [];
for (let i = 6; i >= 0; i--) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const ds = getDateStr(d);
  const b = byDate[ds] || zero;
  day7.push({
    ds: ds,
    label: d.getMonth() + 1 + '/' + d.getDate(),
    full: b.full,
    half: b.half,
    inc: b.incomplete,
    minutes: b.minutes,
    ints: b.int,
    count: b.full + b.half * 0.5
  });
}
  return day7;
}
function buildMood7(byDate, zero) {
const mood7 = [];
for (let i = 6; i >= 0; i--) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const ds = getDateStr(d);
  const diary = appData.diaries[ds];
  const b = byDate[ds] || zero;
  mood7.push({
    label: d.getMonth() + 1 + '/' + d.getDate(),
    sleep: diary && diary.feedback && diary.feedback.sleepQuality ? parseInt(diary.feedback.sleepQuality) : null,
    mental: diary && diary.feedback && diary.feedback.mentalState ? parseInt(diary.feedback.mentalState) : null,
    energy: b.energyN ? Math.round(b.energySum / b.energyN) : null,
    pleasure: b.moodN ? Math.round(b.moodSum / b.moodN) : null
  });
}
  return mood7;
}
function buildWeekView(byDate, dateKeys, zero, tb) {
/* 本周 vs 上周（周一为周起始） */
const _ws = new Date();
{
  const _d0 = _ws.getDay() || 7;
  _ws.setDate(_ws.getDate() - (_d0 - 1));
}
_ws.setHours(0, 0, 0, 0);
const _wsT = _ws.getTime();
/* 本周/上周聚合 → aggWeekRange（与旧 _aggWeek 等值） */
const weekNow = aggWeekRange(byDate, dateKeys, _wsT, zero);
const weekPrev = aggWeekRange(byDate, dateKeys, _wsT - 7 * DAY_MS, zero);
/* 今日专注效率 + 平均专注时长（按实际有效秒） */
const _eff =
  tb.full + tb.half + tb.incomplete ? Math.round((tb.full / (tb.full + tb.half + tb.incomplete)) * 100) : null;
let _durSum = 0,
  _durN = 0;
/* 观察窗口 = 最近 DIST_WINDOW_DAYS 天（时长分布与「平均专注时长」共用同一界限）。
   必须声明在使用它的表达式之前 —— 否则顶层求值会撞 TDZ（Cannot access before initialization）。 */
const DIST_WINDOW_DAYS = 30;
const _avgSince = Date.now() - DIST_WINDOW_DAYS * DAY_MS;
(appData.records || []).forEach(function (r) {
  if (isLogRecord(r)) return; /* 仅记录：不进平均专注时长 */
  if ((r.startTime || 0) < _avgSince) return; /* 与时长分布同窗口 */
  if (r.effectiveSeconds) {
    _durSum += r.effectiveSeconds;
    _durN++;
  }
});
const avgDur = _durN ? Math.round(_durSum / _durN / 60) : null;
/* 专注时长分布：<15 / 15-25 / 25-35 / 35+ 分钟
   观察窗口 = 最近 DIST_WINDOW_DAYS 天。以前是对全部历史开天辟地累加，
   数据越多越看不出最近状态（「分布应该是最近 30 天」）。
   窗口与「均长/效率」统一走同一个界限，免得两个数字各看各的区间。 */
const _distSince = Date.now() - DIST_WINDOW_DAYS * DAY_MS;
const durBuckets = [0, 0, 0, 0];
(appData.records || []).forEach(function (r) {
  if (isLogRecord(r)) return; /* 仅记录：不进时长分布 */
  if ((r.startTime || 0) < _distSince) return; /* 窗口外：不参与分布 */
  const m = (r.effectiveSeconds || 0) / 60;
  if (m < 15) durBuckets[0]++;
  else if (m < 25) durBuckets[1]++;
  else if (m < 35) durBuckets[2]++;
  else durBuckets[3]++;
});
/* 近 8 周节奏 */
const week8 = [];
for (let w = 7; w >= 0; w--) {
  const s = _wsT - w * 7 * DAY_MS;
  const keys = dateKeys.filter(function (ds) {
    const t = new Date(ds + 'T00:00:00').getTime();
    return t >= s && t < s + 7 * DAY_MS;
  });
  let full = 0,
    mins = 0;
  keys.forEach(function (ds) {
    const b = byDate[ds] || zero;
    full += b.full;
    mins += b.minutes;
  });
  const _dd = new Date(s);
  week8.push({ label: _dd.getMonth() + 1 + '/' + _dd.getDate(), full: full, mins: mins, isCurrent: w === 0 });
}
  return { weekNow: weekNow, weekPrev: weekPrev, week8: week8, efficiency: _eff, avgDur: avgDur, durBuckets: durBuckets };
}
/* 「任务完成度（计划 vs 实际）」的统一口径：渲染端（01e8）与汇总端共用这一份，
   否则「共 N 个计划」的 N 会跟列表条数对不上。
   只收「填了预计🍅」且（未完成 或 doneAt 在最近 TASK_COMPARE_KEEP_DAYS 天内）的计划；
   已勾选完成但没有 doneAt 的老数据按「很久以前完成」处理 → 自动退场，不再永久挂在统计图上。 */
const TASK_COMPARE_KEEP_DAYS = 7;
function buildTaskCompareRows() {
  const now = Date.now();
  return (appData.todos || []).filter(function (t) {
    if (t.pomodoros == null || t.pomodoros <= 0) return false;
    if (!t.done) return true;
    return !!t.doneAt && now - t.doneAt <= TASK_COMPARE_KEEP_DAYS * DAY_MS;
  });
}
function buildTaskIntStats() {
const _cmpRows = buildTaskCompareRows();
const taskStats = { planned: 0, actual: 0, taskCnt: _cmpRows.length, doneCnt: 0 };
_cmpRows.forEach(function (t) {
  taskStats.planned += t.pomodoros;
  taskStats.actual += t.actualPomodoros || 0;
  if (t.done) taskStats.doneCnt++;
});
/* 近 30 天按任务名聚合（同时统计「有计划的活跃任务」完成情况，供执行力多维度评估） */
const _t30 = Date.now() - 30 * DAY_MS;
const taskAgg = {};
(appData.records || []).forEach(function (r) {
  if (r.startTime < _t30) return;
  if (isLogRecord(r)) return; /* 仅记录：不进近 30 天任务聚合 */
  const tn = r.taskName || '未命名任务';
  if (!taskAgg[tn]) taskAgg[tn] = { full: 0, half: 0, inc: 0, sec: 0 };
  const g = taskAgg[tn];
  if (r.type === 'full') g.full++;
  else if (r.type === 'half') g.half++;
  else if (r.type === 'incomplete') g.inc++;
  g.sec += r.effectiveSeconds || 0;
});
/* 近 30 天有产出（记录过番茄）的计划任务里，真正被勾选完成的占比。
   与「全量任务完成率」互补：全量口径会被陈年未清理的僵尸任务拖低，
   活跃口径只看你最近真的在推进的那批计划。 */
let _activePlan = 0,
  _activeDone = 0;
(appData.todos || []).forEach(function (t) {
  const key = t.title || '未命名任务';
  if (taskAgg[key]) {
    _activePlan++;
    if (t.done) _activeDone++;
  }
});
/* 计划条目里设了预计🍅的数量（衡量「计划粒度」是否落在合理区间） */
let _plannedCnt = 0;
(appData.todos || []).forEach(function (t) {
  if (t.pomodoros != null && t.pomodoros > 0) _plannedCnt++;
});
const taskTop = Object.keys(taskAgg)
  .map(function (k) {
    return { name: k, f: taskAgg[k].full, h: taskAgg[k].half, i: taskAgg[k].inc, sec: taskAgg[k].sec };
  })
  .sort(function (a, b) {
    return b.f + b.h * 0.5 - (a.f + a.h * 0.5);
  })
  .slice(0, 6);
/* 打断汇总：总浪费时长 + 按分类的高频原因（自定义内容自动归并） */
let intSecTotal = 0;
let intCount = 0;
const intReasons = {};
(appData.records || []).forEach(function (r) {
  intSecTotal += r.totalInterruptSeconds || 0;
  (r.interruptions || []).forEach(function (x) {
    intCount++;
    const cat = categorizeInterrupt(x.reason);
    if (!intReasons[cat]) intReasons[cat] = { n: 0, sec: 0 };
    intReasons[cat].n++;
    intReasons[cat].sec += x.duration || 0;
  });
});
const intReasonTop = Object.keys(intReasons)
  .map(function (k) {
    return { reason: k, n: intReasons[k].n, sec: intReasons[k].sec };
  })
  .sort(function (a, b) {
    return b.n - a.n;
  })
  .slice(0, 5);
  return {
    taskStats: taskStats,
    taskTop: taskTop,
    intSecTotal: intSecTotal,
    intReasonTop: intReasonTop,
    intCount: intCount,
    activePlan: _activePlan,
    activeDone: _activeDone,
    plannedCnt: _plannedCnt
  };
}

/* ===== 打断分析的「区间」口径 =====
   buildTaskIntStats 里的打断段是**全历史累计**，它旁边全是「近7天/近8周」的图，
   语义对不上。
   这里给出一份带时间窗的同构聚合，供打断分析卡片按 日/月/年/累计 取数。
   · 两点口径：① 按 [fromMs,toMs) 过滤 ② 排除「仅记录」（它在别处也不进统计）。
   · rangePomos = 区间内 full/half/incomplete 的记录条数（= 打断率的分母）。 */
function buildInterruptStats(fromMs, toMs) {
  let intSecTotal = 0,
    intCount = 0,
    rangePomos = 0,
    rangeRecs = 0;
  const intReasons = {};
  (appData.records || []).forEach(function (r) {
    if (fromMs != null && r.startTime < fromMs) return;
    if (toMs != null && r.startTime >= toMs) return;
    if (isLogRecord(r)) return;
    rangeRecs++;
    if (r.type === 'full' || r.type === 'half' || r.type === 'incomplete') rangePomos++;
    intSecTotal += r.totalInterruptSeconds || 0;
    (r.interruptions || []).forEach(function (x) {
      intCount++;
      const cat = categorizeInterrupt(x.reason);
      if (!intReasons[cat]) intReasons[cat] = { n: 0, sec: 0 };
      intReasons[cat].n++;
      intReasons[cat].sec += x.duration || 0;
    });
  });
  const intReasonTop = Object.keys(intReasons)
    .map(function (k) {
      return { reason: k, n: intReasons[k].n, sec: intReasons[k].sec };
    })
    .sort(function (a, b) {
      return b.n - a.n;
    })
    .slice(0, 5);
  return {
    intSecTotal: intSecTotal,
    intCount: intCount,
    intReasonTop: intReasonTop,
    rangePomos: rangePomos,
    rangeRecs: rangeRecs
  };
}
/* 区间换算：scope ∈ day|month|year|all，offset = 相对本期的偏移（0 当期，-1 上一期）。
   ⚠️ 一律用**本地时间**构造 Date（记录 startTime 也是本地毫秒坐标）；累计档两端 null = 不限。 */
function interruptRangeOf(scope, offset) {
  const now = new Date();
  const off = offset || 0;
  if (scope === 'all') return { from: null, to: null, label: '累计（全部）' };
  if (scope === 'day') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
    const nxt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return {
      from: d.getTime(),
      to: nxt.getTime(),
      label:
        d.getTime() === t0
          ? '今天'
          : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
    };
  }
  if (scope === 'year') {
    const y = now.getFullYear() + off;
    return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), label: y + '年' };
  }
  const m = new Date(now.getFullYear(), now.getMonth() + off, 1);
  return {
    from: m.getTime(),
    to: new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime(),
    label: m.getFullYear() + '年' + String(m.getMonth() + 1).padStart(2, '0') + '月'
  };
}
/* 段位难度表（三次重排：前 30 段再细分 —— 1~5 段涨得最快（每级约 +25%，
   每段 0.4~0.9 天，5 段累计约 3.1 天，快但不秒升），6 段起逐档放缓，
   段 20 约 52 天、段 30 约 155 天、段 100 约 2221 天（≈6 年 @8 番茄/天）；
   越往后每段越长，不再出现前松后紧的断崖）
   ⚠️ 段数是按累计积分实时算出来的派生值：版本更新后老用户自动按新规则回落，无需迁移。 */
const FOCUS_SEG_STEPS = [
  90, 113, 141, 176, 220, 264, 317, 372, 437, 516, 612, 708, 816, 924, 1032, 1181, 1330, 1478, 1627, 1776, 1930, 2083, 2237, 2390, 2544, 2698, 2851, 3005, 3158, 3312, 3418, 3523, 3629, 3734, 3840, 3936, 4032, 4128, 4224, 4320, 4416, 4512, 4608, 4704, 4800, 4896, 4992, 5088, 5184, 5280, 5328, 5376, 5424, 5472, 5520, 5568, 5616, 5664, 5712, 5760, 5808, 5856, 5904, 5952, 6000, 6048, 6096, 6144, 6192, 6240, 6288, 6336, 6384, 6432, 6480, 6528, 6576, 6624, 6672, 6720, 6768, 6816, 6864, 6912, 6960, 7008, 7056, 7104, 7152, 7200, 7248, 7296, 7344, 7392, 7440, 7488, 7536, 7584, 7632, 7680
];

function calcFocusRank(today, totals) {
/* 专注段数：积分只看「努力」（专注时长 + 番茄数量质量），越努力升段越快 */
const focusMinRaw = Math.round(
  (appData.records || []).reduce(function (s, r) {
    if (isLogRecord(r)) return s; /* 仅记录：不计段位积分（积分只看专注时长+番茄质量） */
    return s + (r.effectiveSeconds || 0);
  }, 0) / 60
);
/* 冲段机制（冲刺区）：每天前 8 个🍅(折算)积分照旧 → 原 5 年曲线完全不受影响；
   当天第 9 个🍅起进入「冲刺区」，超额🍅按倍率加成：
   倍率由「该天之前」连续每天≥12个🍅的天数决定 → 连续0天×1.2(冲刺起步) / 1-6天×1.4(冲刺) / ≥7天×1.8(破限)。
   基准线内玩家积分不变；12个/天+冲刺≈3年登顶，16个/天+破限≈1.5年登顶。
   连击实时从 records 推导，无需存储；某天<12个则连击清零 */
const _dayGroups = {};
(appData.records || []).forEach(function (r) {
  const _ds = getDateStr(r.startTime);
  if (!_dayGroups[_ds]) _dayGroups[_ds] = [];
  _dayGroups[_ds].push(r);
});
const _dayKeys = Object.keys(_dayGroups).sort();
const _dayStreak = {};
let _prevStreak = 0;
_dayKeys.forEach(function (_ds) {
  _dayStreak[_ds] = _prevStreak;
  const _cnt = _dayGroups[_ds].reduce(function (s, r) {
    return s + getPomos(r);
  }, 0);
  if (_cnt >= 12) _prevStreak++;
  else _prevStreak = 0;
});
let focusMinTotal = 0;
Object.keys(_dayGroups).forEach(function (_ds) {
  const _recs = _dayGroups[_ds].slice().sort(function (a, b) {
    return (a.startTime || 0) - (b.startTime || 0);
  });
  const _st = _dayStreak[_ds];
  const _mult = _st >= 7 ? 1.8 : _st >= 1 ? 1.4 : 1.2;
  let _pomos = 0;
  _recs.forEach(function (r) {
    if (isLogRecord(r)) return; /* 仅记录：不进冲刺区积分 */
    const _sec = Math.floor((r.effectiveSeconds || 0) / 60);
    let _pts = _sec;
    if (r.type === 'full') _pts += 5;
    else if (r.type === 'half') _pts += 2;
    else if (r.type === 'incomplete') _pts += 1;
    if (_pomos >= 8) focusMinTotal += _pts * _mult;
    else focusMinTotal += _pts;
    _pomos += getPomos(r);
  });
});
const focusPoints = Math.round(focusMinTotal);
/* 与 calcFocusSeg 共用同一张表 */
  const SEG = FOCUS_SEG_STEPS;
let seg = 1,
  remain = focusPoints,
  needNext = SEG[0] || 40;
/* 段数无上限：100 段后每段继续按最后一段的固定难度（FOCUS_SEG_STEPS 末值）递增，没有「满段」 */
while (remain >= needNext) {
  remain -= needNext;
  seg++;
  needNext = SEG[seg - 1] !== undefined ? SEG[seg - 1] : SEG[SEG.length - 1];
}
const tierIcons = ['🌱', '🌿', '🌳', '🌲', '🍅', '🔥', '💎', '👑', '🌟', '🏆'];
const tierNames = ['萌芽', '新苗', '小树', '成林', '丰收', '深耕', '磐石', '宗师', '传说', '不朽'];
const tierColors = [
  'var(--rank-mengya)',
  '#43A047',
  '#26A69A',
  '#1976D2',
  '#F57C00',
  '#E64A19',
  '#8E24AA',
  '#C62828',
  '#D4AF37',
  '#FFD700'
];
const _ti =
  seg <= 10
    ? 0
    : seg <= 20
      ? 1
      : seg <= 30
        ? 2
        : seg <= 40
          ? 3
          : seg <= 50
            ? 4
            : seg <= 60
              ? 5
              : seg <= 70
                ? 6
                : seg <= 80
                  ? 7
                  : seg <= 90
                    ? 8
                    : 9;
/* 冲刺信息（今日视角）：todayCount=今日折算🍅 / streak=今日之前连续达标天数 / mult=今日第9+个🍅的倍率 / mode */
const _todayCnt = _dayGroups[today]
  ? _dayGroups[today].reduce(function (s, r) {
      return s + getPomos(r);
    }, 0)
  : 0;
const _todayStreak = _dayStreak[today] || 0;
const sprintInfo = {
  todayCount: _todayCnt,
  streak: _todayStreak,
  mult: _todayStreak >= 7 ? 1.8 : _todayStreak >= 1 ? 1.4 : 1.2,
  mode: _todayStreak >= 7 ? 'break' : _todayCnt >= 8 ? 'sprint' : 'normal',
  base: 8
};
const focusRank = {
  seg: seg,
  points: focusPoints,
  remain: remain,
  needNext: needNext,
  color: tierColors[_ti],
  tier: tierNames[_ti],
  icon: tierIcons[_ti],
  raw: { focusMin: focusMinRaw, full: totals.full, half: totals.half, inc: totals.inc },
  sprint: sprintInfo
};
  return focusRank;
}
function calcRankData(today) {
/* 段位·上星数据 */
const rs = appData.rankSystem || {};
const rankData = {
  stars: rs.stars || 0,
  tier: getRankFromStars(rs.stars || 0),
  todayGained: rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask.starsGainedToday || 0 : 0,
  over: rs.consecutiveOver || 0,
  under: rs.consecutiveUnder || 0,
  feedback: (rs.rankFeedback || []).slice(0, 6)
};
  return rankData;
}
/* 跨模块函数替换的唯一入口（05 旅程用它临时接管统计口径） */
function __replaceGetStatsCache(fn) { getStatsCache = fn; }
function getStatsCache() {
  const len = appData.records.length;
  const first = len ? appData.records[0] : null;
  const last = len ? appData.records[len - 1] : null;
  /* key 加入日记数量+今日是否填写，日记编辑后缓存失效；段位星变化也需重算 */
  const dKeys = Object.keys(appData.diaries || {});
  const diaryKey =
    dKeys.length +
    '|' +
    (dKeys[0] || '') +
    '|' +
    (dKeys[dKeys.length - 1] || '') +
    '|r' +
    ((appData.rankSystem && appData.rankSystem.stars) || 0) +
    '|' +
    (appData.rankSystem && appData.rankSystem.rankFeedback ? appData.rankSystem.rankFeedback.length : 0);
  /* key 必须带上「今天日期」：App 常驻后台跨天后，记录条数/首尾 id 都没变，
   旧 key 依然命中 → tb（今日）、mood7、day7、连续天数全都停留在跨天前那一天，
   表现为「海报/统计显示的今日数据和实际不符」。加日期后跨天首次访问必定重算。 */
  const key =
    len +
    '|' +
    (first ? first.id : '') +
    '|' +
    (last ? last.id : '') +
    '|' +
    (last ? last.startTime : '') +
    '|' +
    diaryKey +
    '|d' +
    getTodayStr();
  if (_statsCache.key === key) return _statsCache;
  _statsCache.key = key;
  /* 单次遍历建日期索引 → buildStatsDateIndex（byDate/heat/periods/dateKeys/zero） */
  const _idx = buildStatsDateIndex(appData.records);
  const byDate = _idx.byDate;
  const heat = _idx.heat;
  const periods = _idx.periods;
  const dateKeys = _idx.dateKeys;
  const zero = _idx.zero;
  const today = getTodayStr();
  const tb = byDate[today] || zero;
  let totalFull = 0,
    totalHalf = 0,
    totalInc = 0,
    totalAll = 0;
  dateKeys.forEach(function (ds) {
    const b = byDate[ds];
    totalFull += b.full;
    totalHalf += b.half;
    totalInc += b.incomplete;
    totalAll += b.full + b.half + b.incomplete;
  });
  /* 连续天数 → calcStreakStats（当前连续 + 早/晚最长连续） */
  const _stk = calcStreakStats(byDate, dateKeys);
  const streak = _stk.streak;
  const earlyStreak = _stk.earlyStreak;
  const nightStreak = _stk.nightStreak;
  /* 以下计算块已提顶层 helper（逻辑逐行搬移，见文件上方定义） */
  const _dq = calcDayQuality(dateKeys, byDate);
  const nobreakDays = _dq.nobreakDays, maxDayFull = _dq.maxDayFull, monthFull = _dq.monthFull, perfectWeekCount = _dq.perfectWeekCount;
  const day7 = buildDay7(byDate, zero);
  const mood7 = buildMood7(byDate, zero);
  /* 本月聚合（自然月，含当日）——海报改用「日/月番茄」而不是累计总量 */
  const _monthKey = today.slice(0, 7);
  const monthNow = aggDateKeys(
    byDate,
    dateKeys.filter(function (ds) {
      return ds.slice(0, 7) === _monthKey;
    }),
    zero
  );
  const _wv = buildWeekView(byDate, dateKeys, zero, tb);
  const weekNow = _wv.weekNow, weekPrev = _wv.weekPrev, week8 = _wv.week8, efficiency = _wv.efficiency, avgDur = _wv.avgDur, durBuckets = _wv.durBuckets;
  const _ti = buildTaskIntStats();
  const taskStats = _ti.taskStats, taskTop = _ti.taskTop, intSecTotal = _ti.intSecTotal, intReasonTop = _ti.intReasonTop, intCount = _ti.intCount;
  const activePlan = _ti.activePlan, activeDone = _ti.activeDone, plannedCnt = _ti.plannedCnt;
  const focusRank = calcFocusRank(today, { full: totalFull, half: totalHalf, inc: totalInc });
  const rankData = calcRankData(today);
  _statsCache = {
    key: key,
    byDate: byDate,
    dateKeys: dateKeys,
    today: today,
    tb: tb,
    totalFull: totalFull,
    totalHalf: totalHalf,
    totalInc: totalInc,
    totalAll: totalAll,
    activeDays: dateKeys.length,
    streak: streak,
    earlyStreak: earlyStreak,
    nightStreak: nightStreak,
    nobreakDays: nobreakDays,
    maxDayFull: maxDayFull,
    monthFull: monthFull,
    perfectWeekCount: perfectWeekCount,
    monthNow: monthNow,
    day7: day7,
    heat: heat,
    periods: periods,
    mood7: mood7,
    /* 数据分析 v2：周对比 / 效率 / 时长 / 周节奏 / 任务 / 打断 / 段位 */
    weekNow: weekNow,
    weekPrev: weekPrev,
    efficiency: efficiency,
    avgDur: avgDur,
    durBuckets: durBuckets,
    week8: week8,
    taskStats: taskStats,
    taskTop: taskTop,
    activePlan: activePlan,
    activeDone: activeDone,
    plannedCnt: plannedCnt,
    intSecTotal: intSecTotal,
    intReasonTop: intReasonTop,
    intCount: intCount,
    rankData: rankData,
    focusRank: focusRank
  };
  return _statsCache;
}
/* 冲段机制辅助：实时计算今日冲刺状态（不读缓存，保存记录后即时用）。
   基准线=每天8个🍅(折算)；第9个起进入冲刺区；连击=今天之前连续每天≥12个🍅的天数 */
function getSprintInfo() {
  const today = getTodayStr();
  const recs = appData.records || [];
  const cntOf = function (ds) {
    return recs
      .filter(function (r) {
        return getDateStr(r.startTime) === ds;
      })
      .reduce(function (s, r) {
        return s + getPomos(r);
      }, 0);
  };
  const todayCount = cntOf(today);
  let streak = 0,
    d = new Date();
  d.setDate(d.getDate() - 1);
  while (true) {
    const ds = getDateStr(d);
    if (cntOf(ds) >= 12) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  const mult = streak >= 7 ? 1.8 : streak >= 1 ? 1.4 : 1.2;
  return {
    todayCount: todayCount,
    streak: streak,
    mult: mult,
    mode: streak >= 7 ? 'break' : todayCount >= 8 ? 'sprint' : 'normal',
    base: 8
  };
}
/* 12 个板块专属分析器（展开时才执行） */
const ANALYZERS = {
  /* 每个分析器：结论先行（粗体）→ 关键数据支撑 → 行动建议，不复述数据 */
  today: function (SC) {
    const tb = SC.tb;
    const todayAll = tb.full + tb.half + tb.incomplete;
    if (todayAll === 0)
      return '<b>今天还没开工。</b>先开一个 25 分钟番茄，完成 1 个就破了「0」的僵局——万事开头难，别让今天空着。';
    const past = SC.day7.filter(function (d) {
      return d.ds !== SC.today;
    });
    const avg = past.length
      ? Math.round(
          (past.reduce(function (s, d) {
            return s + d.count;
          }, 0) /
            past.length) *
            10
        ) / 10
      : 0;
    const gap = todayAll - avg;
    let s;
    if (gap > 0.5)
      s =
        '<b>今天的进度超过了你的平均水平</b>（' +
        todayAll +
        ' 个 vs 日均 ' +
        avg +
        ' 个）——劲头正足，趁热把最难的 1~2 件事先做完，今天会是高产日。';
    else if (gap < -0.5)
      s =
        '<b>今天比平时慢了一些</b>（' +
        todayAll +
        ' 个 vs 日均 ' +
        avg +
        ' 个）——可能还没进入状态，别自责，晚上补 1 个番茄就能追平。';
    else
      s =
        '<b>今天的节奏和平时持平</b>（' +
        todayAll +
        ' 个 vs 日均 ' +
        avg +
        ' 个）——稳定就是胜利，保持一天 3~4 个的量就很好。';
    if (tb.int > 0)
      s += '<br>· 已打断 ' + tb.int + ' 次——打断多发生在开头 10 分钟，下一轮开始前把手机放远、提前回完消息，能少一半。';
    return s;
  },
  week: function (SC) {
    if (SC.totalAll === 0) return '完成番茄后，这里会告诉你本周比上周是进步、退步还是平稳，以及问题出在哪。';
    const n = SC.weekNow,
      pr = SC.weekPrev;
    const df = n.full - pr.full,
      di = n.ints - pr.ints;
    let s;
    if (df > 2)
      s =
        '<b>本周状态明显回升</b>，比上周多完成 ' +
        df +
        ' 个番茄——大概率是节奏找回来了，趁这个势头把最难的任务排到今天。';
    else if (df < -2)
      s =
        '<b>本周比上周少做了 ' +
        -df +
        ' 个番茄</b>——先别自责，多数是任务安排太满或状态波动，今天只保 1 个番茄找回手感。';
    else s = '<b>本周与上周基本持平</b>——稳定是好事，但想进步就得每天多排 1 个番茄，积少成多。';
    if (di > 2) s += '<br>· 打断比上周多了 ' + di + ' 次——干扰源变多了，建议固定「番茄时段」并把手机调成勿扰。';
    else if (di < -2) s += '<br>· 打断比上周少了 ' + -di + ' 次——专注环境更干净了，这是效率提升的关键，继续保持。';
    if (n.eff != null && pr.eff != null && n.eff < pr.eff - 5)
      s += '<br>· 完整率下滑了 ' + (pr.eff - n.eff) + '%——计划可能排太满，试着砍掉非核心任务。';
    if (df === 0 && di === 0) s += '<br>· 各项都和上周一样——想突破的话，明天多排 1 个番茄试试。';
    return s;
  },
  trend: function (SC) {
    const d7 = SC.day7.filter(function (d) {
      return d.ds !== SC.today && d.count > 0;
    });
    if (d7.length < 3) return '多记录几天，这里会告诉你专注状态是在升温还是降温，帮你抓住状态好的日子。';
    let hi = d7[0],
      lo = d7[0];
    d7.forEach(function (d) {
      if (d.count > hi.count) hi = d;
      if (d.count < lo.count) lo = d;
    });
    const last3 = d7.slice(-3);
    const up = last3[2].count >= last3[1].count && last3[1].count >= last3[0].count;
    const down = last3[2].count <= last3[1].count && last3[1].count <= last3[0].count;
    let s;
    if (up)
      s = '<b>最近三天专注量在连续爬升</b>，状态正在回暖——现在是最容易突破的时候，把重要任务安排上，别浪费这股劲。';
    else if (down)
      s = '<b>最近三天专注量在递减</b>，可能进入了疲劳期——别硬撑，今天只做 1~2 个番茄把节奏稳住，比硬撑更明智。';
    else
      s =
        '<b>近 7 天波动不小</b>（峰值 ' +
        hi.count +
        ' 个在 ' +
        hi.label +
        '，谷值 ' +
        lo.count +
        ' 个在 ' +
        lo.label +
        '）——波动说明生活节奏不固定，试着每天同一时间开始番茄，身体会形成习惯。';
    return s;
  },
  heat: function (SC) {
    const pn = ['早晨(6-12)', '下午(12-18)', '晚上(18-24)', '深夜(0-6)'];
    const total = SC.periods[0] + SC.periods[1] + SC.periods[2] + SC.periods[3];
    if (!total) return '有番茄记录后，这里会找出你一天中状态最好的「黄金时段」，把重要任务排给它。';
    let bp = 0;
    for (let i = 1; i < 4; i++) if (SC.periods[i] > SC.periods[bp]) bp = i;
    const best = SC.periods[bp];
    const bestPct = Math.round((best / total) * 100);
    let s =
      '<b>你的「黄金时段」是 ' +
      pn[bp] +
      '</b>——全部番茄的 ' +
      bestPct +
      '% 都完成在这个时段，说明这个时间段你的专注力最在线。';
    s += '<br>· 行动：把一天里最重要的 1~2 件事固定排在这个时段，效果会明显好于其他时间。';
    if (SC.periods[3] > 0)
      s +=
        '<br>· 你深夜也在专注（' +
        SC.periods[3] +
        ' 个）——深夜效率其实低于白天，把 1 个挪到早晨，睡眠好了状态会整体提升。';
    return s;
  },
  mood: function (SC) {
    const m7 = SC.mood7;
    const has = function (key) {
      return m7.some(function (m) {
        return m[key] != null;
      });
    };
    const avg = function (key) {
      const v = m7
        .filter(function (m) {
          return m[key] != null;
        })
        .map(function (m) {
          return m[key];
        });
      return v.length
        ? Math.round(
            (v.reduce(function (a, b) {
              return a + b;
            }, 0) /
              v.length) *
              10
          ) / 10
        : null;
    };
    const trend = function (key) {
      const arr = m7
        .filter(function (m) {
          return m[key] != null;
        })
        .map(function (m) {
          return m[key];
        });
      if (arr.length < 2) return null;
      return arr[arr.length - 1] - arr[0];
    };
    if (!has('sleep') && !has('mental') && !has('energy') && !has('pleasure'))
      return '<b>近 7 天还没有状态记录</b>——完成番茄时顺手填一下开始电量/结束心情，日记里记一下睡眠和精神，这里会给你一份完整的「身心体检」。';
    const parts = [];
    const slp = avg('sleep'),
      men = avg('mental'),
      en = avg('energy'),
      pl = avg('pleasure');
    /* 1. 睡眠结论 */
    if (slp != null) {
      if (slp >= 7) parts.push('<b>睡眠整体不错</b>（均值 ' + slp + '/10）——这是专注力的地基，继续保持规律作息。');
      else if (slp >= 5)
        parts.push(
          '<b>睡眠中等</b>（均值 ' + slp + '/10）——够用但不算充沛，早点睡 1 小时，白天的专注状态会明显不一样。'
        );
      else
        parts.push(
          '<b>睡眠明显不足</b>（均值 ' +
            slp +
            '/10）——睡眠是专注的地基，最近几天的番茄质量大概率也受影响了，今晚优先补觉。'
        );
      const st = trend('sleep');
      if (st != null && Math.abs(st) >= 2)
        parts.push(
          '睡眠在<b>' +
            (st > 0 ? '变好' : '变差') +
            '</b>（近 7 天 +' +
            (st > 0 ? st : -st) +
            ' 分），' +
            (st > 0 ? '是好信号，保持住' : '明天把睡觉优先级提到番茄前面。')
        );
    } else parts.push('<b>没有睡眠记录</b>——日记里填一下睡眠质量，才能把「睡得好不好」和「专注状态」关联起来。');
    /* 2. 精神状态 */
    if (men != null) {
      if (men >= 7) parts.push('<b>精神状态在线</b>（均值 ' + men + '/10）——白天清醒有干劲，适合安排有难度的任务。');
      else if (men >= 5)
        parts.push('<b>精神中等</b>（均值 ' + men + '/10）——能干活但不够兴奋，把最难的活放在你状态最好的时段。');
      else
        parts.push('<b>精神疲惫</b>（均值 ' + men + '/10）——连续低精神通常伴随低电量，建议今天减少番茄数、保证休息。');
    }
    /* 3. 电量变化：专注是充电还是耗电 */
    if (en != null && pl != null) {
      const delta = pl - en;
      if (delta >= 1)
        parts.push(
          '<b>专注在给你充电</b>（完成时比开始时电量高 ' +
            (delta > 0 ? '+' : '') +
            delta +
            '）——你是「越专注越有劲」型，适合连续作战。'
        );
      else if (delta <= -1)
        parts.push(
          '<b>专注会消耗你</b>（结束时比开始低 ' +
            (delta < 0 ? -delta : delta) +
            '）——正常现象，番茄之间多休息，别连续硬扛。'
        );
      else parts.push('<b>专注基本不损耗状态</b>（电量几乎持平）——节奏很健康，保持。');
    } else if (en != null) {
      const eT = trend('energy');
      if (eT != null && eT <= -1)
        parts.push('近 7 天<b>电量在走低</b>（' + (eT > 0 ? '+' : '') + eT + '）——能量是消耗品，记得补充睡眠和运动。');
    }
    /* 4. 综合评级 */
    const scored = [slp, men].filter(function (v) {
      return v != null;
    });
    if (scored.length) {
      const comb =
        scored.reduce(function (a, b) {
          return a + b;
        }, 0) / scored.length;
      parts.push(
        comb >= 7
          ? '<b>整体状态：良好</b>——身心都在线，适合保持现在的节奏，也可以试着挑战多一点任务。'
          : comb >= 5
            ? '<b>整体状态：中等</b>——能正常运转，但离「最佳状态」还差一步，优先补睡眠。'
            : '<b>整体状态：偏低</b>——先别加码，把睡眠和休息补回来，状态回升后效率自然上来。'
      );
    }
    return parts.join('<br>· ');
  },
  quality: function (SC) {
    const c7 = (appData.records || []).filter(function (r) {
      return r.startTime > Date.now() - 7 * DAY_MS;
    });
    const f = c7.filter(function (r) {
      return r.type === 'full';
    }).length;
    const h = c7.filter(function (r) {
      return r.type === 'half';
    }).length;
    const i = c7.filter(function (r) {
      return r.type === 'incomplete';
    }).length;
    const t = f + h + i;
    if (!t) return '近 7 天还没有记录，完成番茄后这里会分析你的完成质量——完整率低通常意味着目标定太高。';
    const rate = Math.round((f / t) * 100);
    let s;
    if (rate >= 80)
      s =
        '<b>近 7 天的番茄几乎都是完整收官的</b>（完整率 ' +
        rate +
        '%）——这是「认真对待每个番茄」的信号，你的执行力和专注状态都在线。';
    else if (rate >= 60)
      s =
        '<b>完整率 ' +
        rate +
        '%</b>——大部分番茄啃下来了，但中断的那 ' +
        Math.round(((100 - rate) / 10) * 10) +
        '% 大多发生在计划排太满的时候，试着砍掉非核心任务。';
    else
      s =
        '<b>完整率只有 ' +
        rate +
        '%</b>——一半以上的番茄中途结束，这通常说明目标定高了。砍到每天 1~2 个核心任务，先找回「完成感」。';
    if (i > 0)
      s +=
        '<br>· 有 ' +
        i +
        ' 个「未完成」——未完成不计任何进度，等于白白开始又放弃。开始前先问一句：这个番茄，现在真的做吗？';
    return s;
  },
  dur: function (SC) {
    if (SC.avgDur == null) return '完成番茄后，这里会分析你的单次专注深度——深度比数量更能说明问题。';
    const b = SC.durBuckets;
    let bp = 0;
    for (let i = 1; i < 4; i++) if ((b[i] || 0) > (b[bp] || 0)) bp = i;
    const avg = SC.avgDur;
    let s;
    if (bp === 3)
      s =
        '<b>你习惯 35 分钟以上的深度专注</b>（平均 ' +
        avg +
        ' 分钟）——这是处理「需要进入状态」的大任务（写作/编码/学习）的利器，状态很稀缺，好好珍惜。';
    else if (bp === 2)
      s =
        '<b>标准的番茄节奏</b>（平均 ' +
        avg +
        ' 分钟）——25 分钟一循环很科学，但注意番茄之间的休息别刷手机，大脑需要真的放松。';
    else
      s =
        '<b>专注偏碎片化</b>（平均 ' +
        avg +
        ' 分钟）——多数专注在 25 分钟内就断了。把手机放去另一个房间，连续完成 2 个番茄，深度会明显不一样。';
    return s;
  },
  task: function (SC) {
    const todos = (appData.todos || []).filter(function (t) {
      return t.pomodoros != null && t.pomodoros > 0;
    });
    if (!todos.length && !SC.taskTop.length)
      return '在计划页给任务填上预计🍅数后，这里会逐个任务分析差距——超支说明预估偏低，欠账说明计划偏多。';
    let out = '';
    const over = todos.filter(function (t) {
      return (t.actualPomodoros || 0) > t.pomodoros + 0.49;
    });
    const under = todos.filter(function (t) {
      return !t.done && (t.actualPomodoros || 0) < t.pomodoros - 0.49;
    });
    if (over.length)
      out +=
        '<b>有任务「超支」了</b>：' +
        over
          .map(function (t) {
            return UIFX.escapeHtml(t.title);
          })
          .join('、') +
        '——实际用时超过预估，说明这些任务比想象中复杂。下次预计 ×1.5，再把任务拆成更小的步骤。';
    if (under.length)
      out +=
        '<br><b>有任务还没做完</b>：' +
        under
          .map(function (t) {
            return UIFX.escapeHtml(t.title);
          })
          .join('、') +
        '——欠账会拖到明天，今晚挑最小的一个收尾，保住「完成」的闭环感。';
    if (!over.length && !under.length)
      out = '<b>计划与实际基本吻合</b>——你的预估能力很强，可以开始给任务排更紧的节奏，或者挑战更难的任务。';
    return out;
  },
  week8: function (SC) {
    const w8 = SC.week8.filter(function (w) {
      return w.full > 0;
    });
    if (w8.length < 2) return '坚持几周后，这里会告诉你长期节奏是上升还是回落——长期趋势比单周波动更值得关注。';
    const recent = w8.slice(-4).reduce(function (s, w) {
      return s + w.full;
    }, 0);
    const old = w8.slice(0, -4).reduce(function (s, w) {
      return s + w.full;
    }, 0);
    const cur = w8[w8.length - 1];
    let s;
    if (w8.length >= 5) {
      if (recent > old)
        s =
          '<b>长期看你在稳步进步</b>——近 4 周（' +
          recent +
          ' 个）比之前（' +
          old +
          ' 个）多了 ' +
          (recent - old) +
          ' 个，坚持的复利开始显现，千万别断。';
      else if (recent < old)
        s =
          '<b>最近 4 周比之前少了</b>（' +
          recent +
          ' vs ' +
          old +
          '）——可能进入了平台期，试试换时间段、换任务类型，给专注找点新鲜感。';
      else s = '<b>长期节奏非常稳定</b>（近 4 周 ' + recent + ' 个）——稳定本身就是自律的证明，下一步试着小幅加量。';
    } else {
      s =
        recent > old
          ? '<b>开局就是上升趋势</b>——头几周最容易放弃也最容易起飞，坚持住！'
          : '<b>起步有点起伏</b>——先连续坚持 3 周，数据会告诉你自己的规律。';
    }
    s +=
      '<br>· 本周进行中：' +
      cur.full +
      ' 个' +
      (cur.isCurrent ? (cur.full >= 3 ? '——离目标越来越近，别松劲。' : '——还剩几天，还能再冲一冲。') : '');
    return s;
  },
  interrupt: function (SC) {
    if (!SC.intCount)
      return '<b>零打断</b>——你的专注环境非常干净，这是效率最高的一类玩家，继续保持，别让这个记录断掉。';
    const top = SC.intReasonTop[0];
    const pct = Math.round((top.n / SC.intCount) * 100);
    let s =
      '<b>「' +
      top.reason +
      '」吃掉了你 ' +
      pct +
      '% 的打断</b>（' +
      top.n +
      ' 次，约 ' +
      Math.round(top.sec / 60) +
      ' 分钟）——这是最值得下手处理的干扰源，解决它等于直接拿回这些时间。';
    if (top.reason.indexOf('刷手机') >= 0 || top.reason.indexOf('回消息') >= 0)
      s += '<br>· 手机类干扰是意志力的最大对手：番茄开始前把手机扣过来、开勿扰、放远一点，打断次数能直接砍半。';
    else if (top.reason.indexOf('别人') >= 0)
      s += '<br>· 人找人的打断难完全避免，但可以提前：告诉身边人你的番茄时段，或戴上耳机示意勿扰。';
    else
      s +=
        '<br>· 这类打断大多能提前规避——开始专注前先把「可能想起的事」处理完（喝水/上厕所/回消息），专注中就不容易被打断。';
    return s;
  },
  rank: function (SC) {
    const fb = appData.rankSystem.rankFeedback || [];
    if (!fb.length) return '有段位升降记录后，这里会评估你的上分速度——上分靠每日任务和连胜，不是靠单次爆发。';
    const now = Date.now(),
      day = DAY_MS;
    let net = 0,
      evCnt = 0;
    fb.forEach(function (f) {
      const t = parseFeedbackTime(f.time);
      if (isNaN(t) || t < now - 7 * day) return;
      const d = parseRankDelta(f.msg || '');
      if (d !== 0 || (f.msg && f.msg.indexOf('星') >= 0)) {
        net += d;
        evCnt++;
      }
    });
    if (!evCnt)
      return '<b>最近 7 天段位没动</b>——上分是靠每日任务攒出来的，先把今天的任务做满，连续达标比单天爆发更重要。';
    let s;
    if (net > 0)
      s = '<b>近 7 天净上 ' + net + ' 星</b>，上分势头不错——按这个速度，很快能冲击下个段位，别在连胜期间断档。';
    else if (net === 0) s = '<b>近 7 天星数持平</b>——保星成功也算稳住，但想上分需要把每日任务全部完成并保持连胜。';
    else s = '<b>近 7 天掉了 ' + -net + ' 星</b>——多半是某几天没达标，别急着追分，先连续 3 天全勤把节奏找回来。';
    return s;
  },
  focus: function (SC) {
    const fr = SC.focusRank;
    if (!fr || !fr.seg)
      return '完成第一个番茄后，这里会按你的努力速度预测升段时间——段数只看「专注时长+番茄质量」，越努力升得越快。';
    const rec = appData.records || [];
    const rec7 = rec.filter(function (r) {
      return r.startTime > Date.now() - 7 * DAY_MS && !isLogRecord(r);
    });
    const spr = fr.sprint || { todayCount: 0, streak: 0, mult: 1.2, mode: 'normal' };
    /* 冲段加权重算：每天前 8 个🍅按原积分，第 9+ 个（超额）按指定倍率——把冲段机制算进预测 */
    const calc7 = function (mult) {
      const g = {};
      rec7.forEach(function (r) {
        const ds = getDateStr(r.startTime);
        (g[ds] = g[ds] || []).push(r);
      });
      let tot = 0;
      Object.keys(g).forEach(function (ds) {
        const rs = g[ds].slice().sort(function (a, b) {
          return (a.startTime || 0) - (b.startTime || 0);
        });
        let p = 0;
        rs.forEach(function (r) {
          const pts = (r.effectiveSeconds || 0) / 60 + (r.type === 'full' ? 5 : r.type === 'half' ? 2 : 1);
          if (p >= 8) tot += pts * mult;
          else tot += pts;
          p += getPomos(r);
        });
      });
      return tot / 7;
    };
    const need = Math.max(0, fr.needNext - fr.remain);
    const dayPts = Math.round(calc7(spr.mult)); /* 当前冲段状态下的日均（含加成） */
    const dayPtsB = Math.round(calc7(1.8)); /* 破限全开 ×1.8 的日均 */
    const days = dayPts > 0 ? Math.ceil(need / dayPts) : null;
    if (days == null) return '<b>最近 7 天还没有记录</b>——段数积分只涨不降，但不动就没有进度，今天先完成 1 个番茄。';
    let s =
      '<b>按现在的节奏，约 ' +
      days +
      ' 天后升到 ' +
      (fr.seg + 1) +
      ' 段</b>（还差 ' +
      need +
      ' 积分，日均 ' +
      dayPts +
      ' 分，已含冲段加成）。';
    /* 冲段状态标注 */
    if (spr.mode === 'break')
      s += '<br>· ⚡ <b style="color:var(--accent);">破限冲刺中</b>（×1.8）：超额🍅按最高倍率计入，当前就是最快速度。';
    else if (spr.streak >= 1)
      s +=
        '<br>· 🔥 冲刺连击 <b>' +
        spr.streak +
        '</b> 天（×' +
        spr.mult +
        '）：超额🍅已加速；再连 ' +
        (7 - spr.streak) +
        ' 天每天 12+🍅 可达成破限 ×1.8';
    else if (spr.todayCount >= 8) s += '<br>· 🔥 今日已进冲刺区（×' + spr.mult + '）：第 9 个🍅起超额部分开始加速。';
    /* 破限对比 */
    if (dayPtsB > dayPts) {
      const daysB = Math.ceil(need / dayPtsB);
      if (daysB < days)
        s += '<br>· 🚀 若能达成破限（连续 7 天每天 12+🍅），这一段的预计可缩短到 <b>' + daysB + ' 天</b>。';
    }
    if (days <= 3) s += '<br>· 就差临门一脚——今天多完成 2 个番茄就能提前升段，冲一把。';
    else if (days <= 14) s += '<br>· 保持住别断档——断一天要多补好几天，连续比单次爆发更重要。';
    else if (fr.seg >= 70) s += '<br>· 高段数的每一段都是长期积累，能走到这里，坚持本身就是勋章。';
    else s += '<br>· 每天 3~4 个番茄就是最优的爬升节奏，不需要贪多，贵在稳定。';
    return s;
  },
  /* 月度专注分析：结论先行（总量+节奏+峰值+对比+建议），不复述图上的每个数字 */
  monthly: function (SC) {
    const c = _monCur();
    const st = monthStats(c.y, c.m);
    const dims = new Date(c.y, c.m + 1, 0).getDate();
    if (!st.min && !st.pomos) return '<b>本月还没有专注记录</b>——空窗不可怕，从今天开始补上第一个番茄。';
    let bestDay = 0,
      bestV = 0;
    Object.keys(st.days).forEach(function (k) {
      if (st.days[k] > bestV) {
        bestV = st.days[k];
        bestDay = +k;
      }
    });
    const pm = monthStats(c.y, c.m - 1 < 0 ? 11 : c.m - 1);
    let s =
      '<b>' +
      (c.m + 1) +
      '月共 ' +
      st.pomos.toFixed(1).replace(/\.0$/, '') +
      ' 个🍅、专注 ' +
      fmtDurMin(st.min) +
      '</b>（' +
      st.active +
      '/' +
      dims +
      ' 天有记录，日均 ' +
      Math.round(st.min / dims) +
      ' 分）。';
    s +=
      '<br>· 最猛的一天是 <b>' +
      bestDay +
      ' 日（' +
      fmtDurMin(bestV) +
      '）</b>——想想那天是怎么进入状态的，把它复制到下个月。';
    const activeRatio = st.active / dims;
    if (activeRatio < 0.3)
      s +=
        '<br>· 本月只活跃了 ' + st.active + ' 天，节奏偏松散；与其某天猛冲，不如每天固定 2 个番茄保底，把连续跑起来。';
    else if (activeRatio < 0.7)
      s += '<br>· 活跃 ' + st.active + ' 天，一半以上日子有产出；再补一补空窗日，这个月就接近全勤了。';
    else s += '<br>· 活跃 ' + st.active + ' 天，节奏很稳——稳比猛更难得，保持住。';
    if (pm.min > 0) {
      const delta = Math.round(((st.min - pm.min) / pm.min) * 100);
      s +=
        '<br>· 较上月 <b style="color:' +
        (delta >= 0 ? 'var(--green)' : '#E53935') +
        ';">' +
        (delta >= 0 ? '多' : '少') +
        '了 ' +
        Math.abs(delta) +
        '%</b>' +
        (delta >= 0 ? '，势头不错，趁热打铁。' : '，别灰心，对比不是目的，方向才是。');
    } else if (st.min > 0) {
      s += '<br>· 上月没有记录，本月是重新起跑——开头最难，已经走起来了。';
    }
    return s;
  },
  /* 年度专注分析：结论先行（全年总量+最强/最弱月+趋势+建议） */
  yearly: function (SC) {
    const y = (function () { const n = parseInt(_yrY, 10); return n > 0 && n < 10000 ? n : new Date().getFullYear(); })();
    const ms = yearStats(y);
    const total = ms.reduce(function (s, m) {
      return s + m.min;
    }, 0);
    const totalP = ms.reduce(function (s, m) {
      return s + m.pomos;
    }, 0);
    if (!total && !totalP) return '<b>' + y + '年还没有专注记录</b>——一年很长，从今天第一个番茄开始。';
    let best = -1;
    ms.forEach(function (m, i) {
      if (m.min > 0 && (best < 0 || m.min > ms[best].min)) best = i;
    });
    let worst = -1,
      zeroM = 0;
    ms.forEach(function (m, i) {
      if (m.min > 0 && (worst < 0 || m.min < ms[worst].min)) worst = i;
      if (m.min === 0) zeroM++;
    });
    const activeM = 12 - zeroM;
    let s =
      '<b>' +
      y +
      '年共 ' +
      totalP.toFixed(1).replace(/\.0$/, '') +
      ' 个🍅、专注 ' +
      fmtDurMin(total) +
      '</b>（' +
      activeM +
      ' 个月有记录）。';
    s +=
      '<br>· 最强月份是 <b>' +
      (best + 1) +
      '月（' +
      fmtDurMin(ms[best].min) +
      '）</b>，最弱是 <b>' +
      (worst + 1) +
      '月</b>' +
      (zeroM > 0 ? '，还有 <b>' + zeroM + ' 个月完全空白</b>' : '') +
      '——把最强月的习惯总结出来，喂给空窗月。';
    const h1 = ms.slice(0, 6).reduce(function (s, m) {
        return s + m.min;
      }, 0),
      h2 = ms.slice(6).reduce(function (s, m) {
        return s + m.min;
      }, 0);
    if (h1 + h2 > 0) {
      const r = Math.round((h2 / (h1 + h2)) * 100);
      s +=
        '<br>· 下半年占全年专注的 <b>' +
        r +
        '%</b>' +
        (r >= 55
          ? '，后劲很足，越做越好。'
          : r <= 45
            ? '，上半年发力更猛，下半年别松懈。'
            : '，全年分布比较均匀，难得的稳定。');
    }
    if (activeM < 6)
      s += '<br>· 一年只活跃 ' + activeM + ' 个月——专注这件事，连续比爆发重要，试着把「每月至少 10 个番茄」设为底线。';
    return s;
  }
};

/* ===== 月度/年度专注统计：淡紫面积折线图 + 月度对比表 + 月/年总结 ===== */
/* 某月汇总：min=专注分钟，pomos=折算番茄，days[日]=分钟 */
function monthStats(y, m) {
  const out = { min: 0, pomos: 0, days: {}, active: 0 };
  (appData.records || []).forEach(function (r) {
    if (isLogRecord(r)) return; /* 仅记录：不进月度汇总 */
    const d = new Date(r.startTime);
    if (d.getFullYear() === y && d.getMonth() === m) {
      const sec = r.effectiveSeconds || 0;
      out.min += sec / 60;
      out.pomos += getPomos(r);
      const day = d.getDate();
      if (!out.days[day]) out.days[day] = 0;
      out.days[day] += sec / 60;
    }
  });
  out.min = Math.round(out.min);
  out.active = Object.keys(out.days).length;
  return out;
}
/* 某年 12 个月汇总 */
function yearStats(y) {
  const ms = [];
  for (let m = 0; m < 12; m++) ms.push(monthStats(y, m));
  return ms;
}
/* 分钟 → 时长文本（600 → 10小时0分，45 → 45分） */
function fmtDurMin(min) {
  min = Math.round(min || 0);
  const h = Math.floor(min / 60),
    m = min % 60;
  return h > 0 ? h + '小时' + (m ? m + '分' : '0分') : m + '分';
}


/* __replace_invalidateStatsCache__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_invalidateStatsCache(fn) { invalidateStatsCache = fn; }
