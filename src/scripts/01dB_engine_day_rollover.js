/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01d_engine_features.js 按域拆出（2026-11-14 · S2，纯移动：一行逻辑都没改，产物 sha256 不变）。
 * 换日与赛季结算主干。对外白名单：checkNewDay / onPomodoroCompleteRank / checkRankPromotion。改这段必须小步 + 全量回归（它是结算链主干）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot 1 files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01dB_engine_day_rollover.js
 * 分组：features
 * 职责：业务层——排期快照、换日（checkNewDay）、赛季推进、番茄完成结算与晋升
 * 功能：
 *   - 计划排期快照的写入口（唯一）：pushTodoSchedSnapshot / dropTodoSchedSnapshot / snapshotDoneTodosLeaving
 *   - 换日：checkNewDay（跨天复位 + 赛季推进 + 快照落库）
 *   - 赛季：startNewSeason（标准赛季 3 个月，全服统一锚点）
 *   - 结算主干：onPomodoroCompleteRank / calcExcessStars / checkRankPromotion
 * 函数索引（TOC）：pushTodoSchedSnapshot/dropTodoSchedSnapshot/snapshotDoneTodosLeaving/checkNewDay/startNewSeason/calcExcessStars/onPomodoroCompleteRank/checkRankPromotion
 * ============================================================ */

/* ===== 计划排期快照的写入口（唯一）=====
 * 规则在 00_pure_core 的 todoSchedSnapshotOf/ todoSchedPseudoTodos 里（可单测），这里只负责落库。
 * ★ 什么时候写：计划**离开活动列表**的前一刻 —— 勾完成（次日会被 checkNewDay 删掉）、
 *   排期被清回未排期。写的是"那一天的样子"，之后无论计划怎么变、有没有被删，都不再动它。
 * ★ 什么时候撤：用户取消勾选完成（_unlogTodoDone）—— 那件事被撤回了，历史块也不该留。 */
function pushTodoSchedSnapshot(t, dateStr) {
  /* 快照要把「那天画出来的块」一起冻住（含额外段）。settings 在这里自取，
     保持两参签名不变 —— 调用方只关心「哪条计划、哪一天」。 */
  const snap = todoSchedSnapshotOf(t, dateStr, appData.settings);
  if (!snap) return false;
  if (!appData.todoSchedLog || typeof appData.todoSchedLog !== 'object' || Array.isArray(appData.todoSchedLog)) {
    appData.todoSchedLog = {};
  }
  let arr = appData.todoSchedLog[snap.date];
  if (!Array.isArray(arr)) arr = appData.todoSchedLog[snap.date] = [];
  const key = String(snap.id);
  let hit = -1;
  for (let i = 0; i < arr.length; i++) if (arr[i] && String(arr[i].id) === key) { hit = i; break; }
  if (hit >= 0) arr[hit] = snap; else arr.push(snap);
  /* 脏数据防线：一天最多留 N 条（正常一天几十条就顶天了） */
  if (arr.length > TODO_SCHED_LOG_MAX_PER_DAY) arr.splice(0, arr.length - TODO_SCHED_LOG_MAX_PER_DAY);
  return true;
}
function dropTodoSchedSnapshot(id, dateStr) {
  const log = appData.todoSchedLog;
  if (!log || typeof log !== 'object' || Array.isArray(log)) return false;
  const ds = String(dateStr || '').slice(0, 10);
  const keys = ds ? [ds] : Object.keys(log);
  let changed = false;
  for (let k = 0; k < keys.length; k++) {
    const arr = log[keys[k]];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter(function (x) { return !(x && String(x.id) === String(id)); });
    if (kept.length !== arr.length) { log[keys[k]] = kept; changed = true; }
  }
  return changed;
}
/* 旧的「一次完成 = 一条日志」快照在 todoDoneLog 里；它只存 title/ts，**没有钟点**，
 * 画不出块。这里在删之前补一份排期快照，老存档的那一天也能补回来。 */
function snapshotDoneTodosLeaving(today) {
  (appData.todos || []).forEach(function (t) {
    if (!t || !t.done) return;
    if (normTodoRepeat(t.repeat)) return; /* 重复计划不走删除逻辑 */
    /* 多段计划可能横跨好几天：每一天都要单独冻一份，只拍主段那天会让后面那天的块凭空消失。
       只拍今天及以前 —— 已完成的计划不该在未来的日程上继续占块。 */
    const dates = todoBlockDates(t);
    if (!dates.length) return;
    dates.forEach(function (ds) {
      if (ds <= today) pushTodoSchedSnapshot(t, ds);
    });
  });
}
function checkNewDay() {
  const rs = appData.rankSystem;
  const today = getTodayStr();
  /* 快照按天无限累积：日切时裁掉 3 年以前的（records 不受影响，只裁"当时怎么排的"） */
  if (appData.todoSchedLog && typeof appData.todoSchedLog === 'object') {
    const _pr = pruneTodoSchedLog(appData.todoSchedLog, today);
    if (_pr.changed) {
      appData.todoSchedLog = _pr.log;
      saveData();
    }
  }
  let ts = appData.teamSystem;
  if (ts && ts.today && ts.today.date && ts.today.date !== today && ts.today.partnerJoined && !ts.today.settled) {
    settleTeamTask();
  }
  /* 重复计划先复位（不依赖 lastTodoCleanupDate：跨天第一次进来就得回未完成） */
  resetDueRepeatingTodos(today);
  /* 习惯子计划的「第二天怎么办」（三档：重置 / 只留未完成 / 清空）：
     和计划卡的 subsMode 是同一件事，就该走同一个日切闸门 —— 只放在渲染里的话，
     App 挂着过午夜、人没切页，任务复位了而习惯的子计划还停在昨天。 */
  if (typeof rollHabitSubs === 'function') rollHabitSubs(today);
  /* 一次性计划：排期日已过 → 清回「未排期」（提醒/开始/截止都不该停在昨天） */
  clearStaleOneOffSchedule(today);
  if (appData.lastTodoCleanupDate !== today) {
    const before = appData.todos.length;
    /* ★ 先冻结排期、再删（顺序不能反）：删掉之后就没东西能算"原本几点该做了" */
    snapshotDoneTodosLeaving(today);
    /* 重复计划不随勾选被清掉——它明天还要回来；一次性任务保持老行为 */
    var _leaving = appData.todos.filter(t => t.done && !normTodoRepeat(t.repeat));
    appData.todos = appData.todos.filter(t => !t.done || !!normTodoRepeat(t.repeat));
    /* 跨天清掉的一次性计划也要留墓碑，否则另一端会把「昨天已完成的计划」同步回来 */
    _leaving.forEach(function (x) { tombstone(x.uid, 'todo'); });
    if (appData.todos.length !== before) {
      saveData();
      UIFX.renderTodos();
      UIFX.refreshTodoSelect();
    }
    appData.lastTodoCleanupDate = today;
  }
  /* 单独排期（dayPlan）里已经过去的日子清掉：昨天的覆盖留着只会无限长大。
     ★ 一定排在 snapshotDoneTodosLeaving 之后 —— 快照刚把那些天画出来的块冻住，
       顺序反了就是「先删覆盖、再冻结」，冻结时那天已经变回模板（甚至一块都没有）。 */
  pruneExpiredDayPlans(today);
  if (rs.dailyTask && rs.dailyTask.date !== today && !rs.dailyTask.settled) {
    settlePreviousDay();
  }
  /* 怠惰衰减：连续 7 天完全无番茄 → -1⭐（每 7 天窗口 1 次，0 星不扣，恢复专注即停） */
  let _lastRec = 0;
  appData.records.forEach(function (r) {
    if (r.startTime > _lastRec) _lastRec = r.startTime;
  });
  if (_lastRec > 0) {
    let _idle = Math.floor((Date.now() - _lastRec) / DAY_MS);
    if (_idle >= 7 && rs.stars > 0) {
      let _lp = rs.lastIdlePenaltyDate;
      let _canPenalty = !_lp || Date.now() - new Date(_lp + 'T00:00:00').getTime() >= 7 * DAY_MS;
      if (_canPenalty) {
        addRankStars(-1, 'idle');
        rs.lastIdlePenaltyDate = today;
        saveData();
        UIFX.showRankFeedback('😴 已连续 ' + _idle + ' 天未专注，怠惰衰减 -1⭐（回来种一个番茄即可停止）');
      }
    }
  }
  const si = getSeasonInfo();
  if (!rs.seasonStartDate || si.startDate !== rs.seasonStartDate) {
    startNewSeason(si);
  }
  generateDailyTask();
  settleTeamTask();
  UIFX.renderTeamSystem();
  snapshotStreakHistory();
  /* 跨日时第一时间追加一条今日足迹，让用户每天打开都能看到新东西，不焦虑"今天系统有没有忘加" */
  UIFX.checkBiographyEvents();
}
/* 回到前台再补一次跨天检查：把 App 当 PWA 一直开着、跨过零点时，
   只在启动跑一次的 checkNewDay 不会再触发 —— 重复计划那天就滚不到新的一天。
   checkNewDay 本身幂等（每步都有「处理过就跳过」的闸门），重复调用安全。 */
(function () {
  if (window.__newDayVisibleHooked) return;
  window.__newDayVisibleHooked = true;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    /* 守卫 3：回前台先看"另一个窗口是不是写过更新的数据"。
       实测：一个从昨晚 20:02 就没再重载过的窗口早上醒来跑日切，
       把 22:57 的数据整份盖掉（记录 63→60、数学排期、深色模式、英语完成全没了）。
       ★ 必须排在 checkNewDay 之前：日切会改数据并落盘，旧内存一落盘就覆水难收。 */
    if (typeof _staleOtherInstance === 'function' && _staleOtherInstance()) {
      try { _guardStaleWrite(); } catch (e) { if (window.__silent) window.__silent(e, '01d:newDayVisible'); }
      return;
    }
    try { checkNewDay(); } catch (e) { if (window.__silent) window.__silent(e, '01d:newDayVisible'); }
  });
})();
function startNewSeason(si) {
  const rs = appData.rankSystem;
  const hadSeason = !!rs.seasonStartDate;
  if (rs.seasonStartDate) {
    const prevMaxStars = rs.history.maxStarsCareer || rs.stars;
    const prevRankName = getRankFullName(rs.stars);
    rs.history.seasons.push({
      seasonNumber: rs.seasonNumber,
      startDate: rs.seasonStartDate,
      endDate: si.startDate,
      maxStars: prevMaxStars,
      maxRankName: prevRankName
    });
  }
  const oldTier = getRankFromStars(rs.stars);
  /* 赛季荣誉装饰延续：王者系/荣耀系保留到下赛季（endStars 声明提到使用前，规避 TDZ） */
  const newSeasonNum = si.number;
  const endStars = rs.stars || 0;
  if (endStars >= 1000) {
    rs.lastSeasonDecoration = { season: newSeasonNum, tier: oldTier.name };
  } else if (rs.lastSeasonDecoration && rs.lastSeasonDecoration.season !== newSeasonNum) {
    rs.lastSeasonDecoration = null;
  }
  /* 回退起点取新段位表的 min；按「赛季末星数」分档而不是段位名字，
   以后增删段位不用再改这里，也不会出现新段位没被覆盖导致「上赛季荣耀却从 0 星重开」。 */
  const tierStartOf = function (nm) {
    const t = RANK_TIERS.filter(function (x) {
      return x.name === nm;
    })[0];
    return t ? t.min : 0;
  };
  let newStars = 0;
  if (endStars >= 1000) newStars = tierStartOf('钻石'); /* 荣耀 / 传奇荣耀 */
  else if (endStars >= 500) newStars = tierStartOf('铂金'); /* 王者 / 无双王者 / 荣耀王者 */
  else if (endStars >= 400) newStars = tierStartOf('黄金'); /* 星耀 */
  else if (endStars >= 280) newStars = tierStartOf('白银'); /* 钻石 */
  else newStars = 0;
  rs.stars = newStars;
  rs.seasonNumber = si.number;
  rs.seasonStartDate = si.startDate;
  rs.consecutiveOver = 0;
  rs.consecutiveUnder = 0;
  rs.consecutiveActiveDays = 0;
  rs.pendingStarLoss = 0;
  rs.pendingStarLossDate = null;
  rs.starProtection = 0;
  rs.streak = null;
  rs.boosted = null;
  rs.dailyTask = {
    date: null,
    target: 3,
    starsGainedToday: 0,
    extToday: 0,
    settled: false,
    overCompleted: false,
    underCompleted: false,
    starMult: 1
  };
  resetBotLeaderboardForSeason();
  UIFX.checkBiographyEvents();
  /* 白帽游戏化：BOT 排行榜随赛季重置，防星星无限膨胀 */ saveData();
  UIFX.renderRankSystem();
  if (hadSeason) UIFX.showRankFeedback('🎊 新赛季开始！段位已重置，起始星数:' + newStars);
}
/* 超额星分段递减（0~6 个 1:1，6~12 每2个1⭐，12+ 每4个1⭐，硬顶10）：超额越多星越多，重度用户不被封顶 */
function calcExcessStars(ex) {
  ex = Math.max(0, ex || 0);
  let s = 0,
    r = ex;
  /* 超额点数每满 1 点才结算 1 星（向下取整）：半个番茄 0.5 点不产生 0.5 星，星星恒为整数 */
  s += Math.floor(Math.min(r, 6));
  r -= Math.min(r, 6);
  s += Math.floor(Math.min(r, 6) / 2);
  r -= Math.min(r, 6);
  s += Math.floor(Math.min(r, 8) / 4);
  return Math.min(s, 10);
}
function onPomodoroCompleteRank() {
  const rs = appData.rankSystem;
  checkNewDay();
  const today = getTodayStr();
  /* 今日任务已延后到明天 → 今天不结算超额星；真实专注仍可累计保星机会 */
  if (rs.dailyTask && rs.dailyTask.postponed && rs.dailyTask.date !== today) {
    if (countTomatoPoints(today) > 10 && rs.starProtection < 1) {
      rs.starProtection = 1;
      UIFX.showRankFeedback('🛡️ 获得保星机会！明日未达标也不掉星');
    }
    saveData();
    UIFX.renderRankSystem();
    return;
  }
  const todayFull = getTodayEffectiveFull();
  const target = rs.dailyTask.target || 3;
  const excess = Math.max(0, todayFull - target);
  /* 今日星 = ①本轮超额星（封顶 6） ②当日高产奖励（>16🍅 +1，只发一次）
   已获得的星存在 starsGainedToday 里持续累加，任何时候都不收回。
   高产奖励走独立字段 volumeBonus：不受超额星上限管，也不会重复发。
   半个番茄按 0.5 点计入超额进度，但每满 1 点才结算 1 星（向下取整）。
   「🔥 今日赌注」= 花 🍅 下注（三档）：目标上浮 1~3、花的🍅 从今日进度扣除，完成新目标按档位额外加星（在下面兑现）。 */
  const volHave = rs.dailyTask.volumeBonus || 0;
  const volNew = volumeBonusShould() - volHave;
  const roundBase = rs.dailyTask.roundBase || 0;
  /* roundGot 只统计「超额星」：爆发星 / 赌注星也计入 starsGainedToday，需剔除，否则会少发超额星。
     爆发实际发放为 14 档 +2⭐ / 10 档 +1⭐（见下方 burst 发放处），剔除值必须与之一致。 */
  const _bstBurst = rs.dailyTask.burst
    ? rs.dailyTask.burst.includes(14)
      ? 2
      : rs.dailyTask.burst.includes(10)
        ? 1
        : 0
    : 0;
  const _bstBet = rs.dailyTask.boosted && rs.dailyTask.boosted.claimed ? 5 : 0;
  /* 完成今日任务奖励：按目标难度给星（目标4→1⭐、8→2⭐、12→3⭐），每天一次 */
  let doneNew = 0;
  if (todayFull >= target && !rs.dailyTask.doneRewarded) {
    rs.dailyTask.doneRewarded = true;
    doneNew = Math.max(1, Math.round(target * 0.25));
    rs.dailyTask.doneReward = doneNew;
    UIFX.showRankFeedback('✅ 完成今日任务（' + target + ' 个🍅） +' + doneNew + '⭐');
  }
  const _bstDone = rs.dailyTask.doneReward || 0;
  const roundGot = Math.max(
    0,
    (rs.dailyTask.starsGainedToday || 0) -
      roundBase -
      volHave -
      _bstBurst -
      _bstBet -
      _bstDone -
      (rs.dailyTask.extToday || 0)
  );
  const roundShould = calcExcessStars(excess);
  const roundNew = Math.max(0, roundShould - roundGot);
  let newStars = roundNew + volNew + doneNew;
  /* 爆发分段：单日 10 / 14 个番茄额外星（与 >16 高产奖励独立，各有一次） */
  const todayPts = countTomatoPoints(today);
  if (!rs.dailyTask.burst) rs.dailyTask.burst = [];
  if (todayPts >= 14 && !rs.dailyTask.burst.includes(14)) {
    rs.dailyTask.burst.push(14);
    newStars += 2;
    UIFX.showRankFeedback('⚡ 爆发！今日 14+ 番茄，额外 +2⭐');
  }
  if (todayPts >= 10 && !rs.dailyTask.burst.includes(10)) {
    rs.dailyTask.burst.push(10);
    newStars += 1;
    UIFX.showRankFeedback('⚡ 爆发！今日 10+ 番茄，额外 +1⭐');
  }
  /* 完成今日段位任务 → 赠 10 金币（每天一次，礼物弹窗收下） */
  if (todayFull >= target && !rs.dailyTask.dailyCoinRewarded) {
    rs.dailyTask.dailyCoinRewarded = true;
    UIFX.showGift('🏅 完成今日段位任务（目标 ' + target + ' 个🍅）', 10);
  }
  /* 连胜加成：连续完成任务 ≥3 天每天 +1⭐（当天即时给，每天一次，不封顶） */
  if (todayFull >= target) {
    const stk = rs.streak || (rs.streak = { count: 0, lastDate: null, claimDate: null });
    const d0 = new Date(today + 'T00:00:00');
    d0.setDate(d0.getDate() - 1);
    const yds = getDateStr(d0);
    if (stk.lastDate === today) {
      /* 今天已算过 */
    } else if (stk.lastDate === yds) {
      stk.count = (stk.count || 0) + 1;
    } else {
      stk.count = 1;
    }
    stk.lastDate = today;
    let streakStar = 0;
    if (stk.count >= 3 && stk.claimDate !== today) {
      streakStar = 1;
      stk.claimDate = today;
    }
    if (streakStar > 0) {
      newStars += streakStar;
      UIFX.showRankFeedback('🔥 连胜 ' + stk.count + ' 天！额外 +1⭐');
    }
  }
  /* 今日赌注兑现：完成新目标时按档位额外加星（每天一次，不会重复给；超额星照常另算） */
  if (rs.dailyTask.boosted && !rs.dailyTask.boosted.claimed && todayFull >= target) {
    rs.dailyTask.boosted.claimed = true;
    const _btier = getBetTier(rs.dailyTask.boosted.level);
    newStars += _btier.reward;
    const _bfund = _btier.cost >= 12 ? 3 : _btier.cost >= 6 ? 2 : 1;
    /* 返还 🍅 冲回「下注消耗池」（rs.spentTomatoes），不能写进商店池 weekTomatoSpent ——
       那会让商店已消耗被凭空冲小、与段位下注池对不上 */
    const _sd0 = getTodayStr();
    if (!rs.spentTomatoes) rs.spentTomatoes = {};
    rs.spentTomatoes[_sd0] = Math.max(0, (rs.spentTomatoes[_sd0] || 0) - _bfund);
    if (!rs.betWinDates) rs.betWinDates = [];
    if (!rs.betWinDates.includes(today)) rs.betWinDates.push(today); /* 周挑战「赌赢1次」进度 */
    UIFX.showRankFeedback('🔥🔥 赌注赢了！+' + _btier.reward + '⭐（' + _btier.label + '，返还 ' + _bfund + '🍅）');
  }
  if (newStars > 0) {
    rs.dailyTask.starsGainedToday = (rs.dailyTask.starsGainedToday || 0) + newStars;
    if (volNew > 0) rs.dailyTask.volumeBonus = 1;
    let teamActive =
      appData.teamSystem &&
      appData.teamSystem.today &&
      appData.teamSystem.today.date === today &&
      appData.teamSystem.today.partnerJoined &&
      !appData.teamSystem.today.settled;
    if (teamActive) {
      rs.dailyTask.pendingStars = (rs.dailyTask.pendingStars || 0) + newStars;
      rs.dailyTask.overCompleted = true;
      UIFX.showRankFeedback('⭐ 本轮超额+' + newStars + '星（组队中，延迟结算）');
    } else {
      rs.stars += newStars;
      rs.dailyTask.overCompleted = true;
      const pct = Math.min(99, 80 + newStars);
      UIFX.showRankFeedback('⭐ 今日+' + newStars + '星！超越' + pct + '%用户');
      if (volNew > 0)
        UIFX.showRankFeedback(
          '🔥 当日高产！今天做了 ' +
            fmtTomatoNum(countTomatoPoints(today)) +
            ' 个🍅（>' +
            DAILY_VOLUME_BONUS_AT +
            '），额外 +1⭐'
        );
      const oldTier = getRankFromStars(rs.stars - newStars);
      const newTier = getRankFromStars(rs.stars);
      if (newTier.name !== oldTier.name) {
        let _firstEver = false;
        if (newTier.min >= 1000 && !rs.hasReachedGlory) {
          rs.hasReachedGlory = true;
          _firstEver = true;
        } else if (newTier.min >= 500 && !rs.hasReachedKing) {
          rs.hasReachedKing = true;
          _firstEver = true;
        }
        UIFX.showRankUpCelebration(newTier, _firstEver);
        if (newTier.promotion && oldTier && !oldTier.promotion) {
          UIFX.showRankFeedback('🏆 触发晋升赛！继续保持！');
        }
      } else {
        const _os = getSubRankIndex(rs.stars - newStars, oldTier);
        const _ns = getSubRankIndex(rs.stars, newTier);
        if (_ns >= 0 && _ns > _os) {
          UIFX.showSubRankUp(newTier, _ns);
        }
      }
      if (rs.stars > rs.history.maxStarsCareer) {
        rs.history.maxStarsCareer = rs.stars;
        UIFX.showRankFeedback('🏆 打破记录！当前' + rs.stars + '星');
      }
    }
  }
  /* 保星机会看的是「当日真实专注点数」（半个番茄也算），换任务清零不该把它抹掉 */
  if (countTomatoPoints(today) > 10 && rs.starProtection < 1) {
    rs.starProtection = 1;
    UIFX.showRankFeedback('🛡️ 获得保星机会！明日未达标也不掉星');
  }
  calcWeeklyChallengeProgress(); /* 周挑战进度推进 + 完成自动领星 */
  saveData();
  UIFX.renderRankSystem();
  UIFX.renderStarPath();
}
/* 段位晋级奖励：跨过段位阈值（如青铜→白银）赠 50 金币。放在 renderRankSystem 开头检测，
   覆盖所有加星路径（完成番茄/结算/赌注/组队/周挑战），用 lastTierIdx 防重复 */
function checkRankPromotion() {
  const rs = appData.rankSystem;
  if (!rs || !RANK_TIERS) return;
  const stars = rs.stars || 0;
  let idx = 0;
  for (let i = 0; i < RANK_TIERS.length; i++) {
    if (stars >= RANK_TIERS[i].min) idx = i;
  }
  const last = rs.lastTierIdx;
  if (last === undefined || last === null) {
    rs.lastTierIdx = idx;
    return;
  } /* 老用户首载：只记录不奖励 */
  const promoted = idx > last;
  rs.lastTierIdx = idx;
  if (promoted)
    UIFX.showGift(
      '🎉 段位晋级！从「' + RANK_TIERS[last].name + '」升到「' + RANK_TIERS[idx].name + '」',
      COIN_RANKUP_REWARD
    );
}
