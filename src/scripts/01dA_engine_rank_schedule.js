/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01d_engine_features.js 按域拆出（2026-11-14 · S2，纯移动：一行逻辑都没改，产物 sha256 不变）。
 * 段位星记账与排期写入口（唯一）。对外仅 addRankStars / settlePreviousDay / setTodoOccurrence / setDayPlan 等写入 API。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot 1 files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01dA_engine_rank_schedule.js
 * 分组：features
 * 职责：业务层——段位星统一记账、日结、重复计划复位与跳过、排期段 / 当天排期的写入口
 * 功能：
 *   - 段位星统一记账入口：addRankStars（唯一入口）+ settlePreviousDay（日结）
 *   - 重复计划的每日复位：resetTodoOccurrence / resetDueRepeatingTodos
 *   - 跳过本次（重复任务专用）：skipTodoOccurrence
 *   - 一次性计划的「排期已过」清理
 *   - 排期段写入口（唯一）/ 单独某天的排期（dayPlan）写入口
 * 函数索引（TOC）：addRankStars/settlePreviousDay/resetTodoOccurrence/resetDueRepeatingTodos/skipTodoOccurrence/todoEnsureBlocks/todoAddBlock/todoRemoveBlock/todoDayPlanAdd/todoDayPlanSet/todoDayPlanClear/todoDayPlanRemoveSeg（+2 更多）
 * ============================================================ */

/* ===== 段位星统一记账入口 =====
   所有星数变动都必须走这里，否则「近 7 天战绩」会漏记
   （扭蛋段位星 / 周挑战星 / 怠惰衰减都曾绕过这里，没写进 starsGainedToday 与 dailyStarHistory）。
     加星 → 进 dailyTask.starsGainedToday（今日），明日结算时写入 history；
     扣星 → 进 rs.pendingStarLoss（带日期），明日结算时并入 history.starsLost。
   n 为正=加星，为负=扣星；reason 仅用于排查。 */
function addRankStars(n, reason) {
  n = Number(n) || 0;
  if (!n) return;
  const rs = appData.rankSystem;
  if (!rs) return;
  const today = getTodayStr();
  if (n > 0) {
    rs.stars = (rs.stars || 0) + n;
    if (rs.dailyTask && rs.dailyTask.date === today) {
      rs.dailyTask.starsGainedToday = (rs.dailyTask.starsGainedToday || 0) + n;
      /* 外部渠道星（周挑战/连胜/扭蛋等 reason）当日也入 starsGainedToday，
         单独累加 extToday，超额结算剔除时不让它们虚占超额星 */
      if (reason !== 'settle') rs.dailyTask.extToday = (rs.dailyTask.extToday || 0) + n;
    } else {
      /* 今日任务还没生成（刚跨天/还没开番茄）→ 直接补一条当天 history 兜底 */
      if (!rs.dailyStarHistory) rs.dailyStarHistory = [];
      let _h = rs.dailyStarHistory.filter(function (x) {
        return x.date === today;
      })[0];
      if (!_h) {
        _h = { date: today, target: null, actual: null, starsGained: 0, starsLost: 0 };
        rs.dailyStarHistory.push(_h);
      }
      _h.starsGained = (_h.starsGained || 0) + n;
    }
  } else {
    let _b = rs.stars || 0;
    rs.stars = Math.max(0, _b + n);
    let _realLost = _b - rs.stars; /* 0 星时不再虚记扣星 */
    if (_realLost > 0) {
      rs.pendingStarLoss = (rs.pendingStarLoss || 0) + _realLost;
      rs.pendingStarLossDate = today;
    }
  }
  saveData();
}
function settlePreviousDay() {
  const rs = appData.rankSystem;
  const today = getTodayStr();
  if (!rs.dailyTask || rs.dailyTask.date === today) return;
  const taskDate = rs.dailyTask.date;
  if (rs.dailyTask.settled) return;
  let _extraLoss = rs.pendingStarLossDate === taskDate && rs.pendingStarLoss ? rs.pendingStarLoss : 0;
  /* 扭蛋/周挑战之外的扣星（如怠惰衰减）在这里并入当天战绩 */ const dayFullCount = getEffectiveFull(
    taskDate,
    rs.dailyTask.baseline
  );
  const target = rs.dailyTask.target || 3;
  const betLost = !!(rs.dailyTask.boosted && !rs.dailyTask.boosted.claimed && dayFullCount < target);
  /* 赌注输：下注日未完成新目标 */ let starsLost = 0;
  if (dayFullCount < target) {
    starsLost = Math.ceil(target - dayFullCount);
    /* 半个番茄按0.5点计入进度，不足的部分向上取整扣星（如差0.5点算差1星） */ /* 降星已自动按下注后的新目标与清零后进度结算——这正是赌输的代价 */ if (
      rs.starProtection > 0
    ) {
      rs.starProtection = 0;
      /* 保星=未达标也不扣星（不额外加星） */ rs.dailyStarHistory.push({
        date: taskDate,
        target: target,
        actual: dayFullCount,
        starsGained: rs.dailyTask.starsGainedToday || 0,
        starsLost: 0 + _extraLoss,
        protectionUsed: true,
        bonusStars: 0,
        betLost: betLost
      });
      UIFX.showRankFeedback('🛡️ 保星生效！未达标也不掉星');
    } else {
      let _sB = rs.stars || 0;
      rs.stars = Math.max(0, _sB - starsLost);
      starsLost = _sB - rs.stars;
      /* 记实际扣掉的星（星数触底时战绩不虚记） */ rs.dailyStarHistory.push({
        date: taskDate,
        target: target,
        actual: dayFullCount,
        starsGained: rs.dailyTask.starsGainedToday || 0,
        starsLost: starsLost + _extraLoss,
        betLost: betLost
      });
      if (betLost) UIFX.showRankFeedback('🔥 赌注输了：未完成下注目标，降星 ' + starsLost + '⭐');
    }
  } else {
    rs.dailyStarHistory.push({
      date: taskDate,
      target: target,
      actual: dayFullCount,
      starsGained: rs.dailyTask.starsGainedToday || 0,
      starsLost: 0 + _extraLoss,
      betLost: betLost
    });
    if (betLost) UIFX.showRankFeedback('🔥 赌注输了：未完成下注目标（未降星）');
  }
  if (dayFullCount >= target) {
    rs.consecutiveOver = (rs.consecutiveOver || 0) + 1;
    rs.consecutiveUnder = 0;
    /* 达标正反馈：平时只在扣星/保星时出声、达标反而安静——补一条确认，让用户知道昨日已正常结算 */
    if (!betLost) {
      UIFX.showRankFeedback('✅ 昨日目标达标，未扣星（连续 ' + rs.consecutiveOver + ' 天）');
    }
  } else {
    rs.consecutiveUnder = (rs.consecutiveUnder || 0) + 1;
    rs.consecutiveOver = 0;
    /* 连续未达标惩罚：≥2 天未达标 → 额外 -1⭐（躺平可见成本；达标即重置） */ if (
      rs.consecutiveUnder >= 2 &&
      rs.stars > 0
    ) {
      rs.stars = Math.max(0, rs.stars - 1);
      let _h = rs.dailyStarHistory[rs.dailyStarHistory.length - 1];
      if (_h) {
        _h.starsLost = (_h.starsLost || 0) + 1;
      }
      UIFX.showRankFeedback('📉 连续 ' + rs.consecutiveUnder + ' 天未达标，额外 -1⭐（今天完成今日任务即可恢复）');
    }
    rs.pendingStarLoss = 0;
    rs.pendingStarLossDate = null;
  }
  if (rs.lastActiveDate) {
    const last = new Date(rs.lastActiveDate + 'T00:00:00');
    const cur = new Date(taskDate + 'T00:00:00');
    const gap = Math.round((cur - last) / DAY_MS);
    if (gap === 1) rs.consecutiveActiveDays = (rs.consecutiveActiveDays || 0) + 1;
    else if (gap > 1) rs.consecutiveActiveDays = 1;
  } else {
    rs.consecutiveActiveDays = 1;
  }
  rs.lastActiveDate = taskDate;
  rs.dailyTask.settled = true;
  if (rs.stars > rs.history.maxStarsCareer) {
    rs.history.maxStarsCareer = rs.stars;
    UIFX.showRankFeedback('🏆 打破记录！当前' + rs.stars + '星');
  }
  const curName = getRankFullName(rs.stars);
  if (rs.history.maxRankNameCareer) {
    const oldTier = RANK_TIERS.find(t => t.name === rs.history.maxRankNameCareer.replace(/[ⅢⅡⅠ]/g, ''));
    const newTier = getRankFromStars(rs.stars);
    if (newTier && oldTier && RANK_TIERS.indexOf(newTier) > RANK_TIERS.indexOf(oldTier)) {
      rs.history.maxRankNameCareer = curName;
    }
  } else {
    rs.history.maxRankNameCareer = curName;
  }
  saveData();
}
/* ===== 重复计划的每日复位 =====
 * 「重复计划」不是每天复制一条新任务，而是同一条任务按规则回到未完成。
 * 幂等闸门 = repeat.next：
 *   next > today → 什么都不做（所以 checkNewDay 一天跑几十次也只复位一次）
 *   next ≤ today → 复位 + 把 next 推到今天之后的下一个命中日
 * 一眼忘掉的日子（比如出去玩一周没开 App）不会补出七条任务，只复位成"今天这一次"。
 * 已完成的历史不丢：勾选时写的 todoDoneLog 是按天记的，复位只清任务本身的状态。
 * 子任务按规则处理：
 *   subsMode='reset'（默认）保留清单、勾选清零；'clear' 整条清掉，第二天从空清单开始。 */
function resetTodoOccurrence(t, today, rr) {
  /* ★ 先把「过去那几天画出来的块」冻下来，再动字段。
     病灶与 2026-10-17 那个一模一样：预计块是从活对象现算的，而这里会把 remindAt
     平移到今天、顺手删掉过期的额外段 —— 两个动作都让**昨天**再也算不出钟点。
     一次性计划那条路由 clearStaleOneOffSchedule 先快照再清，重复计划却漏了这一步，
     结果就是「排了钟点、当天没做完的重复任务，第二天日程表上昨天那块凭空消失」

     必须在改字段之前拍：快照要存的是那一刻的 doneAt / actualPomodoros / 钟点。
     只拍 < today 的：今天的块平移后仍是今天的块，活对象自己会画，冻一份是死数据。 */
  todoBlockDates(t, appData.settings).forEach(function (ds) {
    if (ds < today) pushTodoSchedSnapshot(t, ds);
  });
  t.done = false;
  t.doneAt = null;
  t.actualPomodoros = 0;
  t.timeSpent = 0;
  t.reminded = false;
  t.skippedDate = null;
  delete t.actualStart; /* 需求⑩：新一轮 = 新的实际起止，旧快照不能留到下一轮 */
  delete t.actualEnd;
  /* 进行中会话同理：新一轮从零开始，别把上一轮的段落带过来
     （段落平时只活在记录里，只有"正在计时"时才会在 liveSessions 留一份） */
  dropLiveSession(t.id);
  /* subsMode 缺省/非法一律按 reset（保留清单只清勾选）：
     老存档没有这个字段，默认行为必须是"最不破坏用户内容"的那一种。
     clearDone：已完成的直接删掉（做过的不用再做），未完成的留下继续，
     同样把 done 清成 false —— 留下来的都是本来没完成的，清零是无副作用的。 */
  if (rr && rr.subsMode === 'clear') t.subs = [];
  else if (rr && rr.subsMode === 'clearDone') {
    t.subs = todoValidSubs(t).filter(function (s) { return !s.done; }).map(function (s) {
      const o = {};
      Object.keys(s).forEach(function (k) { o[k] = s[k]; });
      delete o.done;
      delete o.doneAt;
      return o;
    });
  } else todoValidSubs(t).forEach(function (s) {
    s.done = false;
    /* doneAt 是「勾掉那一刻」的戳：只清 done 不清它，第二天这条子任务会带着昨天的
       时间戳参与「按完成时刻过滤记录」的统计（01e7 的子任务快照就是这么算的）。 */
    delete s.doneAt;
  });
  /* 完成父任务时记下的「自动勾选下标」属于上一轮：复位后下标仍指向同一批子任务，
     下一次取消完成会把它们误清掉 —— 一并丢弃。 */
  try {
    if (window.__todoAutoSubs) delete window.__todoAutoSubs[t.id];
  } catch (e) { if (window.__silent) window.__silent(e, '01d:resetTodoOccurrence'); }
  /* 时间字段跟着平移到"今天这一次"，保持原来的钟点（否则提醒会停在旧日期上永不触发） */
  const toToday = function (v, withTime) {
    const n = normDT(v);
    if (!n) return null;
    return withTime ? today + ' ' + n.slice(11, 16) : today;
  };
  /* ★ 先取段、再平移提醒：反过来会出 bug ——
     提醒先变成今天、结束还停在昨天，合成时段就"跨日"，被清洗规则整段丢掉，
     结果是"提醒滚到今天了，但今天画不出块"。 */
  const _bs = todoBlocksOf(t, appData.settings);
  if (t.remindAt) t.remindAt = toToday(t.remindAt, true) || t.remindAt;
  /* 排期段整组平移到今天：重复＝同一份安排再来一次，几段一起搬。
     只搬第一段会让第二段停在昨天，用户看到的就是"第二天少了一段"。 */
  if (_bs.length) {
    const _moved = [];
    _bs.forEach(function (b) {
      const sm = tbHHMMToMin(b.start);
      const em = tbHHMMToMin(b.end);
      if (sm == null || em == null) return;
      _moved.push({ start: today + ' ' + tbMinToHHMM(sm), end: today + ' ' + tbMinToHHMM(em) });
    });
    t.blocks = normExtraBlocks(_moved);
  }
  /* ★ 截止日**不再改写成今天**（2026-10-21 工单，方案 a：保留原日期）。
     旧代码把 deadline 平移到 today，等于对重复任务说「最晚完成日永远是今天」——
     填了也白填，逾期标反倒天天亮，成了噪音。
     为什么选「保留原日期」而不是「重复任务不显示该字段」：
       · 「这周日之前背完」这类重复计划，截止日是真约束，藏掉字段等于又造一个黑洞；
       · 保留之后逾期标是真实生效的 —— 过了 10-20 还挂着，用户立刻看得见；
       · 少一个「填了但实际被覆盖」的中间状态，比多一个开关诚实。
     已知后果：旧版本被改写过日期的老数据，复位后可能显示逾期 —— 那是真实状态。 */
  /* 旧字段 extraBlocks 已由上面的整组平移覆盖，不再单独处理。 */
}
function resetDueRepeatingTodos(today) {
  let changed = false;
  (appData.todos || []).forEach(function (t) {
    if (!t || !t.repeat) return;
    const rr = normTodoRepeat(t.repeat);
    if (!rr) { t.repeat = null; return; } /* 脏数据（换平台/手改导出）当一次性任务处理，别卡住跨天 */
    t.repeat = rr;
    /* 已过截止日（「重复到 X 为止」）：降级成普通一次性计划 —— 规则留着也永远不会触发，
       留着只会让徽标继续骗人。 */
    if (todoRepeatExpired(rr, today)) { t.repeat = null; changed = true; return; }
    if (!rr.next) {
      /* 规则缺 next（老数据 / 外部导入）。此时不能只补 next 就走 ——
         那样这张计划的提醒/开始时间会永远停在旧日期上、reminded 也不清，
         用户看到的就是「设了重复但提醒不跟着新的一天走」。
         先判断今天算不算命中日：算、且计划本来就到期了（排期日 ≤ 今天）→ 今天就是这一次，
         按同一次滚动处理；否则只补「下次命中日」，不动这一次（排期在未来的别提前拉过来）。 */
      const cur = (normDT(t.remindAt) || '').slice(0, 10);
      if (todoRepeatMatches(rr, today) && (!cur || cur <= today)) {
        resetTodoOccurrence(t, today, rr);
        rr.last = today;
        rr.next = nextTodoRepeatDate(rr, today, false);
        changed = true;
        return;
      }
      const nx = nextTodoRepeatDate(rr, cur && cur > today ? cur : today, false);
      if (!nx) { t.repeat = null; changed = true; return; } /* 往后 10 年都不可能再命中 → 降级，别空转 */
      rr.last = rr.last || today;
      rr.next = nx;
      changed = true;
      return;
    }
    if (today >= rr.next) {
      resetTodoOccurrence(t, today, rr);
      rr.last = today;
      rr.next = nextTodoRepeatDate(rr, today, false);
      changed = true;
    }
  });
  if (changed) {
    saveData();
    UIFX.renderTodos();
    UIFX.refreshTodoSelect();
  }
  return changed;
}
/* ===== 跳过本次（重复任务专用）=====
 * 今天不做，但也不算完成：不写 done/doneAt（否则完成率、连击、番茄统计都被污染），
 * 只把规则推到下一次命中日，并记 skippedDate 让卡片显示「已跳过本次」。
 * 为什么要它而不是删任务：重复任务是同一条，删掉就再也回不来了；
 * 跳过只是这一轮不要，明天照常。 */
function skipTodoOccurrence(id) {
  const t = (appData.todos || []).find(function (x) { return String(x.id) === String(id); });
  if (!t || t.done) return false;
  const rr = normTodoRepeat(t.repeat);
  if (!rr) return false;
  const today = getTodayStr();
  const nx = nextTodoRepeatDate(Object.assign({}, rr, { last: today }), today, false) || addDaysStr(today, 1);
  t.repeat = Object.assign({}, rr, { last: today, next: nx });
  t.skippedDate = today;
  t.reminded = false;
  saveData();
  UIFX.renderTodos();
  UIFX.toast('已跳过本次，下次 ' + String(nx).slice(5).replace('-', '/'));
  return true;
}
/* ===== 一次性计划的「排期已过」清理 =====
 * 没完成的一次性计划，一旦排期日早于今天，就把排期字段清掉、回到「未排期」：
 *   提醒/开始时间（remindAt）、预计结束（estEnd，仅手动设的）、已经过去的截止日。
 * 不清的话会同时出现三种「看着不对」：提醒停在旧日期上不再触发、截止徽标天天标过期、
 * 日程表当天不收它（列表里有、网格里没有）。
 * 重复计划不走这里 —— 由 resetDueRepeatingTodos 把时间平移到下一轮。 */
/* ===== 排期段的写入口（唯一）=====
 * 新模型：t.blocks = [{start, end}] 就是**全部**段，没有主次之分。
 * 首次写入时把旧字段合成进来（remindAt/estEnd + extraBlocks），之后不再读写旧字段。 */
function todoEnsureBlocks(t, settings) {
  if (!t || typeof t !== 'object') return [];
  if (!Array.isArray(t.blocks)) t.blocks = todoBlocksOf(t, settings || appData.settings);
  return t.blocks;
}
/* 加一段：同日、≥10 分钟、不与已有段重叠、每条 ≤24 段。
 * 校验与落盘在同一次调用里完成 —— 分开写迟早出现"校验过了但没存进去"。 */
function todoAddBlock(id, dateStr, aMin, bMin) {
  const t = (appData.todos || []).find(function (x) { return String(x.id) === String(id); });
  if (!t) return { ok: false, reason: 'no-todo' };
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return { ok: false, reason: 'date' };
  /* 重复计划的段必须落在规则命中的日子上（锚点同时是平移基准）：
     用户在网格里点了周三、可这条是「每周日」—— 照原样写下去，周三不画（规则不认这天），
     周日也画不对（基准还是周三），等于排了个哪儿都不出现的时间。
     所以顺手挪到「从这天算起最近的一个命中日」，并把挪到哪天回报给调用方。 */
  let dsUse = ds;
  let movedTo = null;
  if (normTodoRepeat(t.repeat) && !todoRepeatMatches(t.repeat, ds)) {
    const hit = nextTodoRepeatDate(t.repeat, ds, true);
    if (hit && hit !== ds) { dsUse = hit; movedTo = hit; }
  }
  const lo = Math.min(Number(aMin), Number(bMin));
  const hi = Math.max(Number(aMin), Number(bMin));
  if (!isFinite(lo) || !isFinite(hi)) return { ok: false, reason: 'time' };
  if (hi - lo < TODO_EXTRA_MIN_MIN) return { ok: false, reason: 'short' };
  /* 结束必须落在当天之内：hi === 24:00 会被 tbMinToHHMM 绕回 00:00，
     拼出来就是"23:00 → 次日 00:00"的跨日段，而这模型不收跨日段。 */
  if (lo < 0 || hi >= TB_DAY_MINUTES) return { ok: false, reason: 'range' };
  const list = todoEnsureBlocks(t).slice();
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || b.start.slice(0, 10) !== dsUse) continue;
    const bs = tbHHMMToMin(b.start);
    const be = tbHHMMToMin(b.end);
    if (bs == null || be == null) continue;
    if (lo < be && bs < hi) return { ok: false, reason: 'overlap', hitStart: bs, hitEnd: be, movedTo: movedTo };
  }
  if (list.length >= TODO_EXTRA_MAX) return { ok: false, reason: 'max' };
  list.push({ start: dsUse + ' ' + tbMinToHHMM(lo), end: dsUse + ' ' + tbMinToHHMM(hi) });
  t.blocks = normExtraBlocks(list);
  saveData();
  return { ok: true, count: t.blocks.length, movedTo: movedTo };
}
/* 删一段：按 start 字符串定位（不用下标 —— 下标依赖"渲染顺序 == 数组顺序"这条隐式约定） */
function todoRemoveBlock(id, startStr) {
  const t = (appData.todos || []).find(function (x) { return String(x.id) === String(id); });
  if (!t) return false;
  const key = String(startStr == null ? '' : startStr);
  const list = todoEnsureBlocks(t);
  const next = list.filter(function (b) { return b.start !== key; });
  if (next.length === list.length) return false;
  t.blocks = next;
  saveData();
  return true;
}
/* ===== 单独某天的排期（dayPlan）的写入口 =====
 * 只做「这一天」的事，不碰模板 t.blocks —— 这正是这条规则：
 * 改哪天就只改哪天，模板和其它天一个字都不动。
 * 段校验口径与 todoAddBlock 完全一致（同日、≥10 分、不重叠、≤24 段）。 */
function todoDayPlanAdd(id, dateStr, aMin, bMin) {
  const t = (appData.todos || []).find(function (x) { return String(x.id) === String(id); });
  if (!t) return { ok: false, reason: 'no-todo' };
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return { ok: false, reason: 'date' };
  const lo = Math.min(Number(aMin), Number(bMin));
  const hi = Math.max(Number(aMin), Number(bMin));
  if (!isFinite(lo) || !isFinite(hi)) return { ok: false, reason: 'time' };
  if (hi - lo < TODO_EXTRA_MIN_MIN) return { ok: false, reason: 'short' };
  if (lo < 0 || hi >= TB_DAY_MINUTES) return { ok: false, reason: 'range' };
  if (!t.dayPlan || typeof t.dayPlan !== 'object' || Array.isArray(t.dayPlan)) t.dayPlan = {};
  const list = (t.dayPlan[ds] || []).slice();
  for (let i = 0; i < list.length; i++) {
    const bs = tbHHMMToMin(list[i].start);
    const be = tbHHMMToMin(list[i].end);
    if (bs == null || be == null) continue;
    if (lo < be && bs < hi) return { ok: false, reason: 'overlap', hitStart: bs, hitEnd: be };
  }
  if (list.length >= TODO_EXTRA_MAX) return { ok: false, reason: 'max' };
  const wasEmpty = !list.length;
  list.push({ start: ds + ' ' + tbMinToHHMM(lo), end: ds + ' ' + tbMinToHHMM(hi) });
  t.dayPlan[ds] = normExtraBlocks(list);
  saveData();
  /* replaced：这天的覆盖是**这一次新建**的（原来那套模板时段被整组替换）——
     UI 据此提示一句，免得用户以为模板也跟着改了。 */
  return { ok: true, count: t.dayPlan[ds].length, replaced: wasEmpty };
}
/* 整组替换某一天的覆盖（面板「这天改成 08:00–09:00」用这个）。
   segs 传空 = 撤掉这天的单独排期、恢复模板。 */
function todoDayPlanSet(id, dateStr, segs) {
  const t = (appData.todos || []).find(function (x) { return String(x.id) === String(id); });
  if (!t) return { ok: false, reason: 'no-todo' };
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return { ok: false, reason: 'date' };
  const clean = normExtraBlocks(segs).filter(function (b) { return b.start.slice(0, 10) === ds; });
  if (!clean.length) return { ok: false, reason: 'empty' };
  if (!t.dayPlan || typeof t.dayPlan !== 'object' || Array.isArray(t.dayPlan)) t.dayPlan = {};
  t.dayPlan[ds] = clean;
  saveData();
  return { ok: true, count: clean.length };
}
/* 撤掉某一天的覆盖 → 那天回到模板排期 */
function todoDayPlanClear(id, dateStr) {
  const t = (appData.todos || []).find(function (x) { return String(x.id) === String(id); });
  if (!t || !t.dayPlan || typeof t.dayPlan !== 'object') return false;
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (!t.dayPlan[ds]) return false;
  delete t.dayPlan[ds];
  /* 空了就把字段一起删掉：留着空对象会让导出多一行无意义的 dayPlan:{} */
  if (!Object.keys(t.dayPlan).length) delete t.dayPlan;
  saveData();
  return true;
}
/* 删掉某天覆盖里的一段；删空了 = 这天回到模板 */
function todoDayPlanRemoveSeg(id, dateStr, startStr) {
  const t = (appData.todos || []).find(function (x) { return String(x.id) === String(id); });
  if (!t || !t.dayPlan) return false;
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  const list = t.dayPlan[ds];
  if (!Array.isArray(list)) return false;
  const key = String(startStr == null ? '' : startStr);
  const next = list.filter(function (b) { return b && b.start !== key; });
  if (next.length === list.length) return false;
  if (!next.length) return todoDayPlanClear(id, ds);
  t.dayPlan[ds] = next;
  saveData();
  return true;
}
/* 日切清理：删掉早于今天的覆盖。
 * ★ 必须在**冻结快照之后**调用（checkNewDay 里排在 snapshotDoneTodosLeaving 后面）：
 *   快照要拍的是"那天画出来的块"，dayPlan 还没删时才画得出来。 */
function pruneExpiredDayPlans(today) {
  let changed = false;
  (appData.todos || []).forEach(function (t) {
    if (!t || !t.dayPlan || typeof t.dayPlan !== 'object') return;
    Object.keys(t.dayPlan).forEach(function (ds) {
      if (String(ds).slice(0, 10) >= today) return;
      delete t.dayPlan[ds];
      changed = true;
    });
    if (!Object.keys(t.dayPlan).length) { delete t.dayPlan; changed = true; }
  });
  if (changed) saveData();
  return changed;
}
/* ===== 一次性计划的「排期已过」清理 =====
 * 没完成的**一次性**计划，所有段都早于今天 → 清回「未排期」：
 * 清之前先冻结那天原本的排期（快照），再清 blocks / 过期提醒 / 过期截止日。
 * 重复计划不走这里 —— 由 resetDueRepeatingTodos 把整组段平移到今天。 */
function clearStaleOneOffSchedule(today) {
  let changed = false;
  (appData.todos || []).forEach(function (t) {
    if (!t || t.done) return;
    if (normTodoRepeat(t.repeat)) return;
    const blocks = todoBlocksOf(t, appData.settings);
    if (!blocks.length) return;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].start.slice(0, 10) >= today) return;  /* 还有今天/以后的段 → 不动 */
    }
    /* 先冻住，再清 —— 反了就再也算不出"原本几点做" */
    todoBlockDates(t, appData.settings).forEach(function (ds) {
      if (ds < today) pushTodoSchedSnapshot(t, ds);
    });
    t.blocks = [];
    const rm = normDT(t.remindAt);
    if (rm && rm.slice(0, 10) < today) t.remindAt = null;
    /* ★ 截止日**不跟着清**（2026-10-21）：这里原来有一句
         if (t.deadline && String(t.deadline).slice(0, 10) < today) t.deadline = null;
       它让「这活本来 20 号要交」永久查不到 —— 排期过期只是"不再往网格上画块"，
       不等于"这条计划没定过死线"。逾期信息是用户自己的历史，别替用户抹掉。
       清理只做该做的：清段、清过期提醒。截止日留着，逾期标照常显示。 */
    t.reminded = false;
    changed = true;
  });
  if (changed) saveData();
  return changed;
}
