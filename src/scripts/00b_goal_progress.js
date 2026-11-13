/* ============================================================================
 * 00b_goal_progress.js —— 人生目标的进度计算（纯函数，无 DOM、无副作用）
 *
 * 为什么单独一个文件：
 *   进度公式会被 3 处调用（目标卡、周视图、复盘快照），如果每处各写一遍，
 *   迟早出现「卡片 60%、复盘存 58%」这种对不上的情况。lifeos 就是两份实现
 *   对 null 的理解不一致，同一概念养出两套 bug。所以这里只留一份。
 *
 * 三个空值必须分得清（这是最容易写错的地方）：
 *     null / undefined / ''  = 没设 —— 未测量
 *     0                      = 真的是 0
 *   任何一处把 null 当 0，就会出现「未测量显示 0%」的假进度；
 *   反过来把 '' 当数字算（'' - 22 → -22）会算出负数或 NaN。
 *
 * 命名：函数名一律带 lifeGoal 前缀。项目里 goal 已被「当日番茄目标数」占用
 *   （renderGoalCard / claimGoalCoin / 周挑战阈值），两个 goal 不能混。
 * 函数索引（TOC）：num/todayOf/daysBetween/_idEq/habitStatsOf/habitWindowDefault/capPct/lifeGoalProgress/lifeGoalTimePct/lifeGoalPace/shiftDay/isoWd（+27 更多）
 *   二期：shiftDay/isoWd/_lpad/daysInMonth/isoWeekParts/isoWeekKey/weekRangeOf/quarterEndsOf/
 *         lifeGoalCheckpointDefaults/lifeGoalCheckpointsOf/dueCheckpoint/lifeGoalEvalWindow/
 *         lifeGoalInPeriod/staleMeasureGoals
 * ========================================================================== */
(function (root) {
  'use strict';

  /* 任意输入 → 有限数字或 null。空字符串必须当 null，不能当 0。 */
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function todayOf(ctx) {
    if (ctx && ctx.today) return ctx.today;
    if (typeof getTodayStr === 'function') return getTodayStr();
    return new Date().toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    if (typeof daysBetweenStr === 'function') return daysBetweenStr(a, b);
    var t1 = Date.parse(a + 'T00:00:00Z');
    var t2 = Date.parse(b + 'T00:00:00Z');
    if (!isFinite(t1) || !isFinite(t2)) return 0;
    return Math.round((t2 - t1) / 86400000);
  }

  /* idEq 在 00_pure_core（浏览器里一定有，Node 单测里没有） */
  function _idEq(a, b) {
    if (typeof idEq === 'function') return idEq(a, b);
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return String(a) === String(b);
  }

  /* 习惯统计：优先用调用方注入的（单测用），否则用全局 habitStats（slot 9） */
  function habitStatsOf(ctx) {
    if (ctx && typeof ctx.habitStats === 'function') return ctx.habitStats;
    if (typeof habitStats === 'function') return habitStats;
    return null;
  }

  function habitWindowDefault() {
    if (typeof HABIT_WINDOW_DAYS === 'number') return HABIT_WINDOW_DAYS;
    return 30;
  }

  /* 百分比收敛：先判是否真的满，再压到 99。
     顺序反了（先 round 再 min(99)）会让 99.5 四舍五入成 100 ——
     等于绕过「没做完不给 100」这条规则。 */
  function capPct(raw) {
    if (!isFinite(raw)) return null;
    if (raw >= 100) return 100;
    return Math.min(99, Math.max(0, Math.round(raw)));
  }

  /* --------------------------------------------------------------------------
   * 主函数：算出 { pct, measured, source, ...明细 }
   *   pct       0..100 或 null（null = 未测量，UI 不画进度条）
   *   measured  false 表示「读不到有效输入」，不是「进度为 0」
   * ------------------------------------------------------------------------ */
  function lifeGoalProgress(g, ctx) {
    if (!g || typeof g !== 'object') return { pct: null, measured: false, source: 'manual' };
    var src = g.progressSource || 'manual';
    var today = todayOf(ctx);

    /* ===== 量化指标 ===== */
    if (src === 'measure') {
      /* 没有起始日就没有「从哪到哪」，不假装有进度 */
      if (!g.startDate) return { pct: null, measured: false, source: src };

      var raw = (g.measure && g.measure.items) || [];
      var items = [];
      var declared = 0;    /* 用户写了名字的指标数 = 他打算量化的项数 */
      var i;
      for (i = 0; i < raw.length; i++) {
        var m = raw[i];
        if (!m || typeof m !== 'object') continue;
        if (String(m.name || '').trim()) declared++;
        var from = num(m.from);
        var to = num(m.to);
        /* from/to 缺一个或相等 → 这一项无法构成区间，剔除；
           留着会让 span=0 或 NaN，整张卡显示 NaN% */
        if (from === null || to === null || to === from) continue;
        items.push({ from: from, to: to, current: num(m.current) });
      }
      /* 一项都没构成区间：仍然把「他填了几个名字」报出去，
         卡片才能说「5 项都还没填数值」，而不是笼统的「未测量」 */
      if (!items.length) {
        return { pct: null, measured: false, source: src, filled: 0, total: declared };
      }

      var each = [];
      for (i = 0; i < items.length; i++) {
        if (items[i].current === null) continue;   /* 这一项没填 → 不进分母，不算 0 */
        var span = items[i].to - items[i].from;
        var moved = items[i].current - items[i].from;
        each.push(Math.max(0, Math.min(100, (moved / span) * 100)));
      }
      if (!each.length) {
        return { pct: null, measured: false, source: src, filled: 0, total: items.length };
      }
      var sum = 0;
      for (i = 0; i < each.length; i++) sum += each[i];
      return {
        pct: capPct(sum / each.length),
        measured: true,
        source: src,
        /* filled < total 时卡片要标「基于 1/5 项指标」，
           否则 5 项填 1 项、那 1 项达标 → 100% → 显示「完成」，是假完成。
           ★ total 取 max(declared, items.length) 而不是 items.length：
             items 已经滤掉了「有名字但还没填起止」的项，用它当分母会让
             filled 永远等于 total，提示永远不出现。 */
        filled: each.length,
        total: Math.max(declared, items.length)
      };
    }

    /* ===== 里程碑勾选 ===== */
    if (src === 'milestone') {
      var ms = [];
      var rawMs = g.milestones || [];
      for (var k = 0; k < rawMs.length; k++) {
        if (rawMs[k] && typeof rawMs[k] === 'object') ms.push(rawMs[k]);   /* 剔除 null 元素 */
      }
      if (!ms.length) return { pct: null, measured: false, source: src };
      var done = 0;
      for (var j = 0; j < ms.length; j++) if (ms[j].done === true) done++;
      return {
        pct: done >= ms.length ? 100 : capPct((done / ms.length) * 100),
        done: done,
        total: ms.length,
        measured: true,
        source: src
      };
    }

    /* ===== 习惯驱动 =====
       ★ 两次返工，记下原因：
       第一版：分母用 habitExpectedIn 的**滚动窗口**（近 30 天）折算。
         用户原话「我是这个月的月计划，这个月打卡次数 ≥ 80% 或者至少 5 次，
         你这个也做不到呀」—— 对。目标是「10 月的」，进度却按近 30 天滚，
         跨月就串味：11 月 3 号看这条 10 月目标，算的是 10/5–11/3。
       第二版（现在）：**一律按目标自己的区间** [startDate, targetDate] 算，
       而且允许用户直接指定「要打几次卡」（g.habitTarget）——
         · 有 habitTarget → 分母就是它，进度 = 区间内实际打卡 / habitTarget
           （「这个月至少打卡 5 次」直接能写出来）
         · 没 habitTarget → 分母按 freqPerWeek 在这一整段里折算
           （「完成率 ≥ 80%」= 打了 / 该打）
       两句都用同一个分子：落在区间里的打卡天数。 */
    if (src === 'habit') {
      if (!g.habitId || !g.startDate) return { pct: null, measured: false, source: src };
      var habits = (ctx && ctx.habits) || [];
      var h = null;
      for (var q = 0; q < habits.length; q++) {
        if (habits[q] && _idEq(habits[q].id, g.habitId)) { h = habits[q]; break; }
      }
      if (!h) return { pct: null, measured: false, source: src };   /* 习惯被删了，不算 0 */

      var logs = (ctx && ctx.habitLogs && ctx.habitLogs[g.habitId]) || null;
      if (!logs || !logs.length) return { pct: null, measured: false, source: src };

      /* 目标区间：[起始日, 截止日]；没有截止日就说到今天，不假装有终点 */
      var spanStart = String(g.startDate).slice(0, 10);
      var hasEnd = /^\d{4}-\d{2}-\d{2}$/.test(String(g.targetDate || ''));
      var spanEnd = hasEnd ? String(g.targetDate).slice(0, 10) : today;
      if (spanEnd < spanStart) spanEnd = spanStart;
      var countUntil = (spanEnd < today) ? spanEnd : today;   /* 只数到已经过去的部分 */
      if (countUntil < spanStart) countUntil = spanStart;

      /* 分子：区间内实际打过几次（去重 —— 同一天打两次卡也只算一次） */
      var seen = {}, doneInSpan = 0;
      for (var li = 0; li < logs.length; li++) {
        var dd = String(logs[li] || '').slice(0, 10);
        if (dd.length < 10 || dd < spanStart || dd > countUntil) continue;
        if (seen[dd]) continue;
        seen[dd] = 1; doneInSpan++;
      }

      var perWeek = Number(h.freqPerWeek || h.timesPerWeek || 0);

      /* 分母：用户指定的次数优先，其次按频率在这一整段里折算 */
      var habitTarget = num(g.habitTarget);
      var needTotal = null;
      if (habitTarget !== null && habitTarget >= 1) {
        needTotal = Math.round(habitTarget);
      } else if (perWeek > 0) {
        /* 习惯是后来才建的：区间前段它还不存在，不能凭空要次数 */
        var from = spanStart;
        var created = h.createdAt ? String(h.createdAt).slice(0, 10) : '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(created) && created > from) from = created;
        var fullDays = (from > spanEnd) ? 0 : (daysBetween(from, spanEnd) + 1);
        if (fullDays > 0) {
          needTotal = (perWeek >= 7) ? fullDays : Math.max(1, Math.round(fullDays * perWeek / 7));
        }
      }
      if (!needTotal) return { pct: null, measured: false, source: src };
      if (!doneInSpan && !hasEnd) return { pct: null, measured: false, source: src };

      /* 分母是整段（含未来），所以「月中看着还差很多」是正常的；
         但绝不能超 100 —— 提前完成就是 100，不给 103%。 */
      var rate = doneInSpan / needTotal;
      return {
        pct: capPct(rate * 100),
        done: doneInSpan,
        total: needTotal,
        /* 卡片上那句「到 12/31 需 61 次，已打 24 次」用这两个 */
        doneAll: doneInSpan,
        needTotal: needTotal,
        perWeek: perWeek > 0 ? perWeek : null,
        spanEnd: spanEnd,
        spanStart: spanStart,
        /* 有 habitTarget 才是「凑次数」；否则是「按频率坚持」——卡片文案要分开说 */
        byTarget: (habitTarget !== null && habitTarget >= 1),
        windowDays: Math.max(1, daysBetween(spanStart, countUntil) + 1),
        measured: true,
        source: src
      };
    }

    /* ===== 手动 ===== */
    var manual = num(g.manualPct);
    if (manual === null) return { pct: null, measured: false, source: 'manual' };
    return { pct: Math.max(0, Math.min(100, manual)), measured: true, source: 'manual' };
  }

  /* --------------------------------------------------------------------------
   * 时间进度：从起始日到截止日，今天走了多少（0..100），没日期返回 null
   * ------------------------------------------------------------------------ */
  function lifeGoalTimePct(g, ctx) {
    if (!g || !g.startDate || !g.targetDate) return null;
    var today = todayOf(ctx);
    var total = daysBetween(g.startDate, g.targetDate);
    if (!(total > 0)) return null;
    var passed = daysBetween(g.startDate, today);
    return Math.max(0, Math.min(100, (passed / total) * 100));
  }

  /* --------------------------------------------------------------------------
   * 落后判定：只在「明显落后」时才提示，且由调用方按月节流。
   *   返回 'danger' | 'warn' | 'ok' | 'ahead' | null（没有可比的进度或时间）
   * 阈值来源：调研里 timeto.me 反对「未完成消耗注意力」、habitsync 用阈值告警
   *   而不是常驻红字，所以这里不做逐日红点。
   * ------------------------------------------------------------------------ */
  function lifeGoalPace(prog, timePct) {
    if (!prog || prog.pct === null || prog.pct === undefined) return null;
    if (timePct === null || timePct === undefined) return null;
    var gap = timePct - prog.pct;    /* 正数 = 时间跑在进度前面 = 落后 */
    if (gap >= 30) return 'danger';
    if (gap >= 15) return 'warn';
    if (gap >= -10) return 'ok';
    return 'ahead';
  }

  /* ==========================================================================
   * 二期：周期（ISO 周 / 季度检查点 / 收尾窗口）
   *
   * 这一段的共同前提：**时间只是标尺，不产生"欠账"**。
   *   周重点跨周不自动滚到下一条、季度检查点错过就静默跳过、
   *   收尾窗口过了仍可补记（只是不再主动提醒）。
   *   调研里 timeto.me 的原话是「未完成会分散注意力」，habitsync 用上升沿
   *   告警而不是每日巡检 —— 这里照后者做：只在「从未处理过」时提示一次。
   * ====================================================================== */

  /* 纯日期加减（用 UTC 毫秒，避免本地时区把 00:00 变成前一天 23:00） */
  function shiftDay(ds, n) {
    var t = Date.parse(String(ds || '') + 'T00:00:00Z');
    if (!isFinite(t)) return ds;
    return new Date(t + n * 86400000).toISOString().slice(0, 10);
  }

  /* ISO 星期：1=周一 … 7=周日。全局已有 isoWeekday（00_pure_core.js:1134），
     这里保留自算兜底，免得单测环境取不到。 */
  function isoWd(ds) {
    if (typeof isoWeekday === 'function') return isoWeekday(ds);
    var t = Date.parse(String(ds || '') + 'T00:00:00Z');
    if (!isFinite(t)) return 1;
    var d = new Date(t).getUTCDay();
    return d === 0 ? 7 : d;
  }

  /* 补零：浏览器里直接用 00_pure_core 的 _p2（唯一实现）；
     Node 单测环境没有那个文件，退回本地兜底 —— 这样门禁的「补零只有一份」
     仍然成立，单测也不用去 require 一个 5 万行的运行时。 */
  var _lpad = (typeof window !== 'undefined' && typeof window._p2 === 'function')
    ? window._p2
    : function (n) { return (n < 10 ? '0' : '') + n; };

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  /* ISO 周归属：以「本周周四所在年」为准。
     ★ 12/31 可能属于次年第 1 周、1/1 可能属于上一年第 53 周 —— 这是标准行为，
       不是 bug。若按「日历年」切，跨年那一周会在 1/1 突然变成第 1 周，
       同一周里前后两天算出不同的 weekKey，周重点就丢一半。 */
  function isoWeekParts(ds) {
    var t = Date.parse(String(ds || '') + 'T00:00:00Z');
    if (!isFinite(t)) return { year: 0, week: 0 };
    var thu = t + (4 - isoWd(ds)) * 86400000;
    var year = new Date(thu).getUTCFullYear();
    var jan4 = Date.parse(year + '-01-04T00:00:00Z');
    var week1Mon = jan4 - (isoWd(year + '-01-04') - 1) * 86400000;
    return { year: year, week: Math.floor((t - week1Mon) / (7 * 86400000)) + 1 };
  }

  /* '2026-W44' —— 周重点按这个键归组，比存日期稳：
     同一周里任何一天打开都落到同一组，跨年也不会裂开。 */
  function isoWeekKey(ds) {
    var p = isoWeekParts(ds);
    if (!p.year) return '';
    return p.year + '-W' + _lpad(p.week);
  }

  /* 本周首尾（周一 ~ 周日），用于「10/26 - 11/01」这种抬头 */
  function weekRangeOf(ds) {
    var wd = isoWd(ds);
    return { start: shiftDay(ds, -(wd - 1)), end: shiftDay(ds, 7 - wd) };
  }

  /* 季度末固定日期：3/31 6/30 9/30 12/31（不用月末推算，省得闰年二月掺进来） */
  function quarterEndsOf(year) {
    return [
      { q: 1, at: year + '-03-31' },
      { q: 2, at: year + '-06-30' },
      { q: 3, at: year + '-09-30' },
      { q: 4, at: year + '-12-31' }
    ];
  }

  /* --------------------------------------------------------------------------
   * 年目标的默认季度检查点（只生成、不落库；用户改过就以用户的为准）
   *   measure 类型给一个线性插值的参考值（22→18 的 Q1 是 21），
   *   其它类型 target 为 null —— 里程碑目标没有「本季该到多少」这种数。
   * ------------------------------------------------------------------------ */
  /* 目标的时间区间（缺一头就补上半年 / 全年，别让空字段把整段检查点清空） */
  function _goalSpan(g, year) {
    var sd = String(g.startDate || '').slice(0, 10);
    var ed = String(g.targetDate || '').slice(0, 10);
    if (!sd) sd = year + '-01-01';
    if (!ed) ed = year + '-12-31';
    if (ed < sd) ed = sd;
    return { start: sd, end: ed };
  }

  /* 某条检查点是否落在这条目标的时间里（用来看历史存下来的检查点还作不作数） */
  function _cpInSpan(cp, g, year) {
    if (!cp || !cp.at) return false;
    var sp = _goalSpan(g, year);
    return String(cp.at) >= sp.start && String(cp.at) <= sp.end;
  }

  function lifeGoalCheckpointDefaults(g, ctx) {
    if (!g || (g.horizon || 'year') !== 'year') return [];
    var today = todayOf(ctx);
    var td = String(g.targetDate || '');
    var year = Number(td.slice(0, 4));
    if (!year) year = Number(String(today).slice(0, 4));
    if (!year) return [];

    var from = null, to = null;
    if ((g.progressSource || '') === 'measure') {
      var items = (g.measure && g.measure.items) || [];
      for (var i = 0; i < items.length; i++) {
        var a = num(items[i] && items[i].from);
        var b = num(items[i] && items[i].to);
        if (a !== null && b !== null && a !== b) { from = a; to = b; break; }
      }
    }
    /* ★ 只取「目标真正存在的那段」里的季末。
       以前固定给 3/6/9/12 四条：10 月才立的目标，一打开就看见 3 月、6 月、
       9 月三个自己根本不在场的季末 —— 那三格永远确认不了（季末窗口早过了），
       折叠区永远停在 0/4，而它还顺带告诉用户「你落后了三个季度」。
       现在 10-27 立的年度目标只剩 12/31 一条；1 月立的还是四条；
       11 月立、12 月中结束的短目标一条都不给 —— 与其塞一条已经超出目标的
       12/31，不如这一段根本不出现。 */
    var sp = _goalSpan(g, year);
    var ends = quarterEndsOf(year).filter(function (e) {
      return e.at >= sp.start && e.at <= sp.end;
    });
    var span = daysBetween(sp.start, sp.end);
    var out = [];
    for (var k = 0; k < ends.length; k++) {
      var t = null;
      if (from !== null && to !== null) {
        /* 插值按「这个季末在目标区间里走了多远」算，不按季度序号。
           序号法只在四条齐全时碰巧对；只剩 Q4 一条时，目标其实才走了
           三个月，序号法仍然给出终值。位置法永远说得通。 */
        var pos = span > 0 ? daysBetween(sp.start, ends[k].at) / span : 1;
        pos = Math.max(0, Math.min(1, pos));
        /* 保留一位小数就够了：22→18 这种量级，「21.02」的第二位是伪精度 */
        t = Math.round((from + (to - from) * pos) * 10) / 10;
      }
      out.push({ q: ends[k].q, at: ends[k].at, target: t, note: '', doneAt: null });
    }
    return out;
  }

  /* 读取检查点：有就用存的，没有（老数据/刚建）就现场生成默认值。
     默认值不写回 —— 读的时候顺手改 appData 会让「打开页面」变成写操作。 */
  function lifeGoalCheckpointsOf(g, ctx) {
    var cps = (g && Array.isArray(g.checkpoints)) ? g.checkpoints.filter(function (c) {
      return c && typeof c === 'object' && c.at;
    }) : [];
    if (cps.length) {
      /* 老数据里可能存着整年的四个季末。目标改过开始日后，已经在场之前的
         那些检查点就不该再出现 —— 但**已经确认过的不动**：那是用户当时
         真的看过一眼的记录，抹掉等于改历史。 */
      var y = Number(String(g.targetDate || g.startDate || '').slice(0, 4)) ||
        Number(String(todayOf(ctx)).slice(0, 4));
      var kept = cps.filter(function (c) { return c.doneAt || _cpInSpan(c, g, y); });
      if (kept.length) return kept;
      return [];
    }
    return lifeGoalCheckpointDefaults(g, ctx);
  }

  /* --------------------------------------------------------------------------
   * 到点的检查点：窗口 [at-7, at+7]，且**从未确认过**（doneAt 为空）
   *   为什么是 ±7：季末那天用户未必开 App；只给「当天」等于随机丢弃。
   *   为什么只认未确认：确认过之后每季度还会再提醒一次，就变成常驻噪音
   *   （habitsync 的反面教材：新建规则时状态被置 true → 第一条永远不发；
   *     反过来「永远为 false」就会天天发）。
   * ------------------------------------------------------------------------ */
  function dueCheckpoint(g, today, beforeDays, afterDays) {
    if (!g || (g.horizon || 'year') !== 'year') return null;
    if (g.status && g.status !== 'active') return null;
    var ds = today || todayOf();
    var b = (beforeDays === null || beforeDays === undefined) ? 7 : beforeDays;
    var a = (afterDays === null || afterDays === undefined) ? 7 : afterDays;
    var cps = lifeGoalCheckpointsOf(g, { today: ds });
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i];
      if (cp.doneAt) continue;
      var d = daysBetween(ds, cp.at);      /* 正数 = 还没到 */
      if (d <= b && d >= -a) return cp;
    }
    return null;
  }

  /* --------------------------------------------------------------------------
   * 收尾窗口（二期只做「收尾动作」，完整复盘在三期）
   *   月：当月最后 3 天 + 次月前 3 天
   *   年：12/15 起 + 次年 1/15 前
   * 年优先，但**不吞掉 12 月的月目标**：
   *   12/29 之后年窗口已经开启，若严格按「年优先」判定，12 月的月目标
   *   整个月都进不了任何收尾面板（12/29-31 被年挡住，1/4 之后月窗口已关）。
   *   所以年窗口自带 alsoMonth，面板里多一组「12 月目标」。
   * period 是「这次收的是哪个周期」，不是「今天」：
   *   1 月 2 日打开，收的是去年 12 月 —— 写今天的年月会让 12 月永远收不了尾。
   * ------------------------------------------------------------------------ */
  function lifeGoalEvalWindow(today) {
    var ds = today || todayOf();
    var y = Number(String(ds).slice(0, 4));
    var m = Number(String(ds).slice(5, 7));
    var d = Number(String(ds).slice(8, 10));
    if (!y || !m || !d) return null;

    if ((m === 12 && d >= 15) || (m === 1 && d <= 15)) {
      var yy = (m === 12) ? y : y - 1;
      var win = { cadence: 'year', period: String(yy), label: yy + ' 年收尾', year: yy, month: null, alsoMonth: null };
      if ((m === 12 && d >= 29) || (m === 1 && d <= 3)) win.alsoMonth = yy + '-12';
      return win;
    }
    var last = daysInMonth(y, m);
    if (d >= last - 2) {
      return { cadence: 'month', period: y + '-' + _lpad(m), label: m + ' 月收尾', year: y, month: m, alsoMonth: null };
    }
    if (d <= 3) {
      var pm = m - 1, py = y;
      if (pm < 1) { pm = 12; py = y - 1; }
      return { cadence: 'month', period: py + '-' + _lpad(pm), label: pm + ' 月收尾', year: py, month: pm, alsoMonth: null };
    }
    return null;
  }

  /* 目标是否属于这个收尾周期：按 targetDate 落在哪个月/年判断，
     不看 createdAt —— 9 月建的年度目标，12 月照样要收尾。 */
  function lifeGoalInPeriod(g, win) {
    if (!g || !win) return false;
    if (g.status && g.status !== 'active') return false;
    var td = String(g.targetDate || '');
    if (win.cadence === 'year') {
      if ((g.horizon || 'year') === 'year') return td.slice(0, 4) === String(win.period);
      /* 年末那几天：12 月的月目标也在这张面板里收，但不混进年度目标那一组 */
      return !!(win.alsoMonth && (g.horizon || '') === 'month'
        && td.slice(0, 7) === String(win.alsoMonth).slice(0, 7));
    }
    return (g.horizon || '') === 'month' && td.slice(0, 7) === String(win.period);
  }

  /* --------------------------------------------------------------------------
   * 数值太久没更新的目标（周视图顶部一行提示用）
   *   只对 measure 且 active 的目标判断。没有 measureUpdatedAt 的老数据
   *   退到 updatedAt / createdAt —— 宁可少提示，不要天天喊。
   * ------------------------------------------------------------------------ */
  function staleMeasureGoals(goals, today, days) {
    var ds = today || todayOf();
    var limit = (typeof days === 'number' && days > 0) ? days : 14;
    var list = goals || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g || (g.progressSource || '') !== 'measure') continue;
      if (g.status && g.status !== 'active') continue;
      var last = String(g.measureUpdatedAt || g.updatedAt || g.createdAt || '').slice(0, 10);
      if (!last) { out.push(g); continue; }
      if (daysBetween(last, ds) >= limit) out.push(g);
    }
    return out;
  }

  /* ==========================================================================
   * 三期：复盘（周期列表 / 快照 / 上次的下一步）
   *
   * 复盘的三个铁律（都来自 lifeos，也是它唯一值得抄的地方）：
   *   ① 快照必须**冻结**。以后改目标、删目标，历史复盘的数字不能跟着变。
   *      所以存的是「当时的 pct 和是否测过」，不是目标本身。
   *   ② 未测量要如实记。`pct: null, measured: false` 和「0%」是两回事，
   *      把没测的算成 0，会让一年的复盘曲线看起来「一直在原地」。
   *   ③ 读不到数据要单独标记。`habitAvailable: false` 是「取不到习惯数据」，
   *      不是「习惯完成率 0」—— 前者不该进平均值，后者才是真的没做。
   * ====================================================================== */

  /* 可复盘的周期列表：从当前往回退 n 个。
     ★ 三种颗粒度都做。早先只做月 / 年，理由是「周复盘一年 52 次，列出来太密」——
       那说的是**提醒**的频率，不是**选单**的长度。补录上周的复盘时，
       下拉里一个周都没有，人只能得出「这里只能补月」的结论。只列最近 10 周即可。 */
  function lifeReviewPeriods(today, n, cadence) {
    var ds = today || todayOf();
    var y = Number(String(ds).slice(0, 4));
    var m = Number(String(ds).slice(5, 7));
    if (!y || !m) return [];
    var out = [];
    var count = (typeof n === 'number' && n > 0) ? n : 6;
    var i;
    if (cadence === 'week') {
      /* 按周一锚定往回倒，跨年也对（isoWeekKey 自己算 52/53 周） */
      var mon = shiftDay(ds, -(isoWd(ds) - 1));
      var md = function (s) { return Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)); };
      for (i = 0; i < count; i++) {
        out.push({
          cadence: 'week',
          period: isoWeekKey(mon),
          label: md(mon) + ' – ' + md(shiftDay(mon, 6)) + ' 那周',
          monday: mon
        });
        mon = shiftDay(mon, -7);
      }
      return out;
    }
    if (cadence === 'year') {
      for (i = 0; i < count; i++) {
        out.push({ cadence: 'year', period: String(y - i), label: (y - i) + ' 年' });
      }
      return out;
    }
    for (i = 0; i < count; i++) {
      var mm = m - i, yy = y;
      while (mm < 1) { mm += 12; yy -= 1; }
      out.push({ cadence: 'month', period: yy + '-' + _lpad(mm), label: yy + ' 年 ' + mm + ' 月' });
    }
    return out;
  }

  /* 该周期里有没有「东西可复盘」：有目标，或者有挂在该领域目标上的习惯。
     一个领域两个都没有，就不为它单开一屏 —— 「这周成长方面怎么样」而
     成长方面一片空白，只会让人卡在那里不知道写什么。
     cadence / period 目前用不到（领域是跨周期的，目标不会因为换周期就不存在），
     留着是为了将来按周期过滤「当时还不存在的目标」时不用改签名。 */
  function lifeReviewAreaIds(areas, goals, cadence, period) {
    var out = [];
    var list = areas || [];
    var gl = goals || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !a.id) continue;
      var hit = false;
      for (var j = 0; j < gl.length; j++) {
        var g = gl[j];
        if (!g || g.areaId !== a.id) continue;
        if (g.status && g.status !== 'active' && g.status !== 'achieved') continue;
        hit = true;
        break;
      }
      if (hit) out.push(a.id);
    }
    return out;
  }

  /* --------------------------------------------------------------------------
   * 快照：按领域冻结一份当时的进度
   *   pct       该领域 active 目标的平均进度（未测量的目标不进分母）
   *   measured  是否至少有一个可测目标
   *   goalCount 该领域 active 目标数
   *   habitPct  该领域挂着的习惯的完成率
   *   habitAvailable  false = 「习惯数据取不到」，与「没有习惯」区分
   * ------------------------------------------------------------------------ */
  function lifeReviewSnapshot(areas, goals, ctx) {
    var out = {};
    var list = areas || [];
    var gl = goals || [];
    var today = todayOf(ctx);
    var habits = (ctx && ctx.habits) || [];
    var logs = (ctx && ctx.habitLogs) || {};
    var hstat = habitStatsOf(ctx);
    var winDefault = habitWindowDefault();

    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !a.id) continue;
      var sum = 0, n = 0, count = 0;
      for (var j = 0; j < gl.length; j++) {
        var g = gl[j];
        if (!g || g.areaId !== a.id) continue;
        if (g.status && g.status !== 'active') continue;
        count++;
        var p = lifeGoalProgress(g, ctx);
        if (p && p.measured && p.pct !== null && p.pct !== undefined) { sum += p.pct; n++; }
      }

      /* 习惯：只算「挂在本领域目标上」的习惯。
         认两个字段：goal.habitId 是真源（目标用哪个习惯计量），
         habit.lifeGoalId 是老存档里的镜像 —— 两个都认，才不会因为
         「只写了一边」把挂在目标上的习惯整个漏掉。 */
      var hSum = 0, hN = 0, hSeen = 0;
      for (var k = 0; k < habits.length; k++) {
        var h = habits[k];
        if (!h || h.archived) continue;
        var owner = null;
        for (var q = 0; q < gl.length; q++) {
          if (!gl[q]) continue;
          if (_idEq(gl[q].habitId, h.id) || (!gl[q].habitId && _idEq(gl[q].id, h.lifeGoalId))) { owner = gl[q]; break; }
        }
        if (!owner || owner.areaId !== a.id) continue;
        hSeen++;
        if (!hstat) continue;
        var lg = logs[h.id];
        if (!lg) continue;
        var st = hstat(h, lg, today, winDefault);
        if (!st || !st.expected) continue;
        hSum += (typeof st.rate === 'number') ? st.rate : Math.min(1, st.done / st.expected);
        hN++;
      }

      out[a.id] = {
        pct: n ? Math.round(sum / n) : null,
        measured: n > 0,
        goalCount: count,
        habitPct: hN ? Math.round((hSum / hN) * 100) : null,
        /* 三种情况必须分清：
             统计函数可用            → true（有数据就是有数据，哪怕这个领域没习惯）
             不可用 + 这个领域有习惯  → false（真的读不到，不能当 0）
             不可用 + 这个领域没习惯  → true（本来就是空的） */
        habitAvailable: hstat ? true : (hSeen > 0 ? false : true)
      };
    }
    return out;
  }

  /* 上一次同节奏复盘里该领域写的「下一步」——复盘价值的一半在这里。 */
  function lifeReviewLastNext(reviews, cadence, areaId) {
    var list = reviews || [];
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || r.cadence !== cadence) continue;
      if (!best || String(r.period || '') > String(best.period || '')) best = r;
    }
    if (!best || !best.notes || !best.notes[areaId]) return '';
    return String(best.notes[areaId].next || '');
  }

  /* 某周期是否已经复盘过（同一 cadence + period 只留一条，再写就是覆盖） */
  function lifeReviewFind(reviews, cadence, period) {
    var list = reviews || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].cadence === cadence && String(list[i].period) === String(period)) return list[i];
    }
    return null;
  }

  /* ==========================================================================
   * 四期 · 目标层 CSV
   *
   * 为什么单独一张表而不是塞进「专注记录 CSV」：两者根本不是一回事 ——
   * 记录是流水（一行一个番茄），目标是实体（一行一个目标）。混在一张表里，
   * 用户在 Excel 里筛「日期」会把目标行全带出来。
   *
   * 三类实体共用一张表、用「类型」列区分，是为了「一个文件打开就能看全」：
   * 导出三份文件反而没人打开第二份。
   * ====================================================================== */
  function _csvCell(v) {
    if (typeof csvCell === 'function') return csvCell(v);
    var s = (v === null || v === undefined) ? '' : String(v);
    s = s.replace(/[\r\n]+/g, ' ');
    if (/^[=+\-@\t]/.test(s)) s = "'" + s;
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0) s = '"' + s.split('"').join('""') + '"';
    return s;
  }

  function lifeCsvTable(goals, weekFocus, reviews, areas, ctx) {
    var head = ['类型', '周期/周', '领域', '标题', '状态', '进度%', '开始', '截止', '备注', '下一步'];
    var lines = [head.map(_csvCell).join(',')];
    var areaName = {};
    (areas || []).forEach(function (a) { if (a && a.id) areaName[a.id] = (a.emoji ? a.emoji + ' ' : '') + (a.name || ''); });

    var HORIZON = { year: '年度', month: '月度', someday: '愿望' };
    var STATUS = { active: '进行中', achieved: '已达成', paused: '暂停', dropped: '已放弃' };
    var SOURCE = { milestone: '里程碑', measure: '数值', habit: '习惯', manual: '手动' };

    (goals || []).forEach(function (g) {
      if (!g) return;
      var p = lifeGoalProgress(g, ctx);
      lines.push([
        '目标', HORIZON[g.horizon || 'year'] || '', areaName[g.areaId] || g.areaId || '',
        g.title || '', STATUS[g.status || 'active'] || '',
        (p && p.measured && p.pct !== null) ? p.pct : '',
        g.startDate || '', g.targetDate || '',
        g.why || '',
        SOURCE[g.progressSource || 'manual'] || ''
      ].map(_csvCell).join(','));
    });

    (weekFocus || []).forEach(function (w) {
      if (!w) return;
      var g = null;
      (goals || []).forEach(function (x) { if (x && _idEq(x.id, w.lifeGoalId)) g = x; });
      lines.push([
        '本周重点', w.weekKey || '', g ? (areaName[g.areaId] || '') : '', w.text || '',
        w.done ? '已完成' : '未完成', '', '', '', g ? ('服务于：' + (g.title || '')) : '', ''
      ].map(_csvCell).join(','));
    });

    (reviews || []).forEach(function (r) {
      if (!r) return;
      var notes = r.notes || {};
      var snap = r.snapshot || {};
      var keys = Object.keys(notes);
      if (!keys.length) {
        /* 没有分领域内容的一条（周复盘就是这种）：把顶层的 next 放进「下一步」列 */
        lines.push(['复盘', r.period || '', '', r.focus || '', '', '', r.date || '', '', '', r.next || ''].map(_csvCell).join(','));
        return;
      }
      keys.forEach(function (aid, i) {
        var n = notes[aid] || {};
        var s = snap[aid] || {};
        lines.push([
          i === 0 ? '复盘' : '', i === 0 ? (r.period || '') : (r.cadence === 'year' ? '年' : '月'),
          areaName[aid] || aid, i === 0 ? (r.focus || '') : '',
          '', (s.measured && s.pct !== null) ? s.pct : '',
          i === 0 ? (r.date || '') : '', '',
          n.reflection || '', n.next || ''
        ].map(_csvCell).join(','));
      });
    });
    return { head: head, lines: lines };
  }

  /* ==========================================================================
   * 五期：筛选态下的排序合并
   *
   * 目标页按 horizon 分成「今年 / 本月 / 愿望」三段，用户很可能在**只看月度**
   * 时拖拽。天真做法（把当前可见列表整个写回 lifeGoalOrder）会把隐藏的年度
   * 目标顺序全冲掉 —— 这是 lifeos 报告里花最大篇幅讲的一个设计。
   *
   * 做法：记住可见项在**全量数组里的位置**，把新顺序填回这些位置。
   *   例：全量 [A,B,C,D]，只显示 [B,D]，拖成 [D,B]
   *   → 取 B、D 的下标 1、3 → 填回去 → [A,D,C,B]
   * ====================================================================== */
  function mergeVisibleOrder(fullOrder, visibleBefore, visibleAfter) {
    var full = Array.isArray(fullOrder) ? fullOrder.slice() : [];
    var before = Array.isArray(visibleBefore) ? visibleBefore : [];
    var after = Array.isArray(visibleAfter) ? visibleAfter : [];
    if (!after.length) return full;

    /* 可见项在全量里的槽位（升序）。找不到的（刚新建、还没进 order）跳过 */
    var slots = [];
    for (var i = 0; i < before.length; i++) {
      var idx = full.indexOf(before[i]);
      if (idx >= 0) slots.push(idx);
    }
    slots.sort(function (a, b) { return a - b; });
    if (!slots.length) return full;

    /* 只在「可见项数量没变」时才合并 —— 数量变了说明中间增删过，
       按下标填会错位，宁可不动（下一次完整渲染会重建顺序）。 */
    if (slots.length !== after.length) return full;

    /* 还要校验是同一批项：数量相同但内容不同（比如调用方传错了数组）
       会让某个 uid 被写进两个槽、另一个凭空消失。这类脏输入宁可整体放弃。 */
    for (var j = 0; j < after.length; j++) {
      if (before.indexOf(after[j]) < 0) return full;
    }

    for (var k = 0; k < slots.length; k++) full[slots[k]] = after[k];
    return full;
  }

  /* ==========================================================================
   * 五期：周复盘的一句话
   * 周复盘不做 stepper（一年 52 次，分步引导会变成负担），只问两件事：
   * 这周发生了什么、下周想推进什么。所有字段都可空。
   * ====================================================================== */
  function lifeWeekReviewOf(reviews, weekKey) {
    var list = reviews || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r && r.cadence === 'week' && String(r.period) === String(weekKey)) return r;
    }
    return null;
  }

  /* ===== 六期：把日记里的日复盘整理成「回看」素材 =====
   *
   * ★ 用途只有一个：回看时给用户看的**参考资料**。绝不预填进复盘输入框。
   *   原因（用户明确纠正过）：复盘的价值是重新想一遍，不是把写过的东西摊出来
   *   再编辑一遍。预填会让人变成「改上个月的作业」，反而挤掉重新掂量的过程。
   *
   * 所以这个函数是只读的：调用方拿到数据只用于展示，写回由用户自己打字。
   *
   * 四栏与 KISS 的对应：
   *   progress     → keep     今天进步
   *   shortcomings → improve  今天不足
   *   improvements → start    明天改进
   *   stop         → stop     该停止（六期新加，老日记没有这个键）
   *
   * 只收集，不判断：不合并、不摘要、不改写。同一件事写了五次就出现五次，
   * 次数本身就是信号 —— 自动合并会把这个信号抹掉。
   * 空值口径与进度算法一致：只有空白字符不算一条。
   *
   * cadence: 'week' | 'month' | 'year'
   *   week  → period 是 ISO 周键 '2026-W43'，逐天比对 isoWeekKey
   *   month → period 是 '2026-10'，且 '2026-1' 不能吃掉 '2026-10'
   *   year  → period 是 '2026'
   * 日期倒序：回看时最近的在最前面。
   */
  function lifeDiaryKiss(diaries, cadence, period, limit) {
    var out = { keep: [], improve: [], start: [], stop: [], days: 0, filled: 0, truncated: false };
    if (!diaries || typeof diaries !== 'object') return out;
    var cap = num(limit) || 12;
    var pref = String(period == null ? '' : period);
    if (!pref) return out;
    var keys = Object.keys(diaries).sort().reverse();
    for (var i = 0; i < keys.length; i++) {
      var day = keys[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (cadence === 'week') {
        if (isoWeekKey(day) !== pref) continue;
      } else {
        if (day.slice(0, pref.length) !== pref) continue;
        /* 「2026-1」不能吃掉「2026-10」：月键后面必须紧跟 '-' 或结束 */
        if (cadence === 'month' && day.length > pref.length && day.charAt(pref.length) !== '-') continue;
      }
      var d = diaries[day];
      if (!d) continue;
      out.days++;
      var rv = d.review || {};
      var map = [['keep', rv.progress], ['improve', rv.shortcomings],
                 ['start', rv.improvements], ['stop', rv.stop]];
      var any = false;
      for (var j = 0; j < map.length; j++) {
        var txt = String(map[j][1] == null ? '' : map[j][1]).trim();
        if (!txt) continue;
        any = true;
        if (out[map[j][0]].length < cap) out[map[j][0]].push({ date: day, text: txt });
        else out.truncated = true;
      }
      if (any) out.filled++;
    }
    return out;
  }

  /* 回看用：某一天**实际做了什么**（与「写了什么」是两件事）。
   *
   * ★ 同样只读、只展示。写进复盘的那四栏永远是用户自己打的字。
   *
   * records: appData.records（startTime 是毫秒时间戳）
   * todos:   appData.todos（done + doneAt 毫秒）
   *
   * 口径：
   *   番茄数 = 记录自带的 pomos 之和（「仅记录」type=log 的 pomos 本来就是 0，不用另判）
   *   专注分钟 = effectiveSeconds，不足 1 分钟按 0 显示，不四舍五入骗人
   *   任务名去重、按当天第一次出现的先后排 —— 同一天对同一个任务做了 3 个番茄只列一次
   *   没有记录就返回 null，让调用方画「这天没有记录」，而不是画一排 0
   */
  function _pomoOf(r) {
    if (!r) return 0;
    if (typeof getPomos === 'function') return num(getPomos(r));
    if (r.pomos !== undefined && r.pomos !== null) return num(r.pomos) || 0;
    return r.type === 'full' ? 1 : (r.type === 'half' ? 0.5 : 0);
  }

  function lifeDayFacts(records, todos, day) {
    var want = String(day == null ? '' : day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) return null;
    var out = { pomo: 0, minutes: 0, tasks: [], doneTodos: [], has: false };

    /* 本地日期，不用 toISOString：东八区凌晨会被算到前一天 */
    var dayOf = function (ms) {
      var t = Number(ms);
      if (!t) return '';
      var d = new Date(t);
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };

    var recs = Array.isArray(records) ? records : [];
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (!r || dayOf(r.startTime) !== want) continue;
      /* 番茄点数只走唯一口径 getPomos（老记录没有 pomos 字段，靠 type 兜底）。
         本文件要能在 node 里单跑（单测 require 它），所以没有 getPomos 时才降级，
         降级写法与 00_pure_core 的 pomosOf 保持一致。 */
      var pomo = _pomoOf(r);
      out.pomo += pomo > 0 ? pomo : 0;
      var sec = num(r.effectiveSeconds);
      if (sec > 0) out.minutes += Math.max(1, Math.round(sec / 60));
      var name = String(r.taskName == null ? '' : r.taskName).trim();
      if (name && out.tasks.indexOf(name) < 0) out.tasks.push(name);
      out.has = true;
    }

    var list = Array.isArray(todos) ? todos : [];
    for (var j = 0; j < list.length; j++) {
      var t = list[j];
      if (!t || !t.done || !t.doneAt) continue;
      if (dayOf(t.doneAt) !== want) continue;
      var title = String(t.title == null ? '' : t.title).trim();
      if (title) out.doneTodos.push(title);
      out.has = true;
    }
    return out.has ? out : null;
  }

  /* 回看用：一个周期里「有内容可看」的全部日期（倒序）。
   * ★ 不只日记 —— 那天可能没写复盘，但做了 5 个番茄。
   *   lifeDiaryDays 只认日记，直接用会让「干了一整天没写字」的日子凭空消失，
   *   而回看最想知道的恰恰常常是那些天。
   * 返回 [{ day, diary: bool }]，diary 用来决定那天该不该显示复盘四栏。 */
  function lifeRecallDays(diaries, records, todos, cadence, period) {
    var map = {};
    var pref = String(period == null ? '' : period);
    if (!pref) return [];
    var inPeriod = function (day) {
      if (cadence === 'week') return isoWeekKey(day) === pref;
      if (day.slice(0, pref.length) !== pref) return false;
      if (cadence === 'month' && day.length > pref.length && day.charAt(pref.length) !== '-') return false;
      return true;
    };
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    var dayOf = function (ms) {
      var t = Number(ms);
      if (!t) return '';
      var d = new Date(t);
      return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    };

    if (diaries && typeof diaries === 'object') {
      Object.keys(diaries).forEach(function (k) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && diaries[k]) map[k] = true;
      });
    }
    var recs = Array.isArray(records) ? records : [];
    for (var i = 0; i < recs.length; i++) {
      var d1 = recs[i] ? dayOf(recs[i].startTime) : '';
      if (d1) map[d1] = map[d1] || false;
    }
    var list = Array.isArray(todos) ? todos : [];
    for (var j = 0; j < list.length; j++) {
      var d2 = (list[j] && list[j].done && list[j].doneAt) ? dayOf(list[j].doneAt) : '';
      if (d2) map[d2] = map[d2] || false;
    }

    var out = [];
    Object.keys(map).forEach(function (k) {
      if (!inPeriod(k)) return;
      out.push({ day: k, diary: map[k] === true });
    });
    out.sort(function (a, b) { return a.day < b.day ? 1 : (a.day > b.day ? -1 : 0); });
    return out;
  }

  /* 回看用：给定周期，返回该周期内所有日记的日期列表（倒序）。
   * 和 lifeDiaryKiss 分开是因为「有日记但复盘四栏都空」也算有记录 ——
   * 用户想回看的是这一天做了什么，不该因为没有写复盘就消失。 */
  function lifeDiaryDays(diaries, cadence, period) {
    var out = [];
    if (!diaries || typeof diaries !== 'object') return out;
    var pref = String(period == null ? '' : period);
    if (!pref) return out;
    var keys = Object.keys(diaries).sort().reverse();
    for (var i = 0; i < keys.length; i++) {
      var day = keys[i];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (cadence === 'week') {
        if (isoWeekKey(day) !== pref) continue;
      } else {
        if (day.slice(0, pref.length) !== pref) continue;
        if (cadence === 'month' && day.length > pref.length && day.charAt(pref.length) !== '-') continue;
      }
      if (diaries[day]) out.push(day);
    }
    return out;
  }

  var API = {
    num: num,
    lifeGoalProgress: lifeGoalProgress,
    lifeGoalTimePct: lifeGoalTimePct,
    lifeGoalPace: lifeGoalPace,
    /* 二期 */
    shiftDay: shiftDay,
    isoWeekKey: isoWeekKey,
    weekRangeOf: weekRangeOf,
    daysInMonth: daysInMonth,
    quarterEndsOf: quarterEndsOf,
    lifeGoalCheckpointDefaults: lifeGoalCheckpointDefaults,
    lifeGoalCheckpointsOf: lifeGoalCheckpointsOf,
    dueCheckpoint: dueCheckpoint,
    lifeGoalEvalWindow: lifeGoalEvalWindow,
    lifeGoalInPeriod: lifeGoalInPeriod,
    staleMeasureGoals: staleMeasureGoals,
    /* 三期 */
    lifeReviewPeriods: lifeReviewPeriods,
    lifeReviewAreaIds: lifeReviewAreaIds,
    lifeReviewSnapshot: lifeReviewSnapshot,
    lifeReviewLastNext: lifeReviewLastNext,
    lifeReviewFind: lifeReviewFind,
    /* 四期 */
    lifeCsvTable: lifeCsvTable,
    /* 五期 */
    mergeVisibleOrder: mergeVisibleOrder,
    lifeWeekReviewOf: lifeWeekReviewOf,
    /* 六期 */
    lifeDiaryKiss: lifeDiaryKiss,
    lifeDiaryDays: lifeDiaryDays,
    lifeDayFacts: lifeDayFacts,
    lifeRecallDays: lifeRecallDays
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.TFGoal = API;
})(typeof window !== 'undefined' ? window : globalThis);
