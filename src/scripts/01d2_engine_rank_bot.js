/* ============================================================
 * 01d2 · 建议时长/疲劳/人机排行榜引擎
 * 由 01d_engine_features.js 按域拆出（可回退）
 * 函数索引（TOC）：startTeamMidnightTimer/getTeamInterval/teamTick/getRecommendedWorkDuration/getFatigueScore/checkFatigueAdvice/getBreakByDuration/getSuggestedDifficulty/getBotTier/initBotLeaderboard/getPlayerAvgDailyGain/dailyUpdateLeaderboard（+2 更多）
 * ============================================================ */
let teamMidnightIv = null;
let teamCurrentInterval = 0;
function startTeamMidnightTimer() {
  if (teamMidnightIv) clearInterval(teamMidnightIv);
  UIFX.updateTeamCountdown();
  /* 动态频率：组队中需要秒级倒计时→1秒；未组队只需零点检测→30秒，省电 */
  function getTeamInterval() {
    let ts = appData.teamSystem;
    let teamActive = ts && ts.today && ts.today.partnerJoined && !ts.today.settled;
    return teamActive ? 1000 : 30000;
  }
  function teamTick() {
    let now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 5) {
      let ts = appData.teamSystem;
      if (ts.today && ts.today.date && ts.today.partnerJoined && !ts.today.settled) {
        settleTeamTask();
        UIFX.renderTeamSystem();
      }
    }
    UIFX.updateTeamCountdown();
    /* 组队状态可能变化，动态调整频率 */
    let ni = getTeamInterval();
    if (ni !== teamCurrentInterval) {
      teamCurrentInterval = ni;
      if (teamMidnightIv) clearInterval(teamMidnightIv);
      /* 业务心跳 · 组队倒计时调度（动态调频 + clear；切后台需保活以准点跨天/结算） */
      teamMidnightIv = setInterval(teamTick, ni);
    }
  }
  teamCurrentInterval = getTeamInterval();
  teamMidnightIv = setInterval(teamTick, teamCurrentInterval);
}

/* ============================================================
 * 白帽游戏化 · 业务层（极简模式 / 心流推荐 / 疲劳检测 / 难度档位 / 人机排行榜）
 * ============================================================ */
/* ---- 心流自适应 · 推荐番茄时长（一个标准：近 7 天你专注得怎么样） ----
   推荐 10（简单）：不老专注——老是打断（平均中断≥2 次）/ 老未完成或提前结束（完成率 <40%）/ 有效专注时长很低（完成的大多是半个）；
   推荐 50（沉浸式）：完成度特别高——完成率 ≥80% 且完成的番茄里完整番茄占比 ≥80%（与上面那些情况完全相反）；
   其余一律推荐 25（中等，正常人基线）。数据不足（<3 条）默认 25。 */
function getRecommendedWorkDuration() {
  const DAYS = 7;
  const now = Date.now(),
    from = now - DAYS * DAY_MS;
  const recs = (appData.records || []).filter(function (r) {
    return r.startTime >= from;
  });
  if (recs.length < 3) return 25; /* 数据不足：默认 25 */
  const full = recs.filter(function (r) {
    return r.type === 'full';
  }).length;
  const half = recs.filter(function (r) {
    return r.type === 'half';
  }).length;
  const done = full + half; /* 完成数：完整 + 半个 */
  const rate = recs.length ? done / recs.length : 0; /* 完成率（半个也算完成） */
  const fullRatio = done ? full / done : 0; /* 完成的番茄里完整番茄占比 */
  const intCount = recs.reduce(function (s, r) {
    return s + ((r.interruptions && r.interruptions.length) || 0);
  }, 0);
  const avgInt = recs.length ? intCount / recs.length : 0;
  /* 升级 50：完成率 ≥80% 且完整占比 ≥80%（完成得多，且主要是完整番茄） */
  if (rate >= 0.8 && fullRatio >= 0.8) return 50;
  /* 回简单档 10：完成率低 / 中断偏多 / 完成的大多是半个番茄 → 先找回状态 */
  if (rate < 0.4 || avgInt >= 2 || fullRatio < 0.4) return 10;
  return 25; /* 常规：中等（正常人基线） */
}
/* ---- 疲劳检测：近 2 小时专注质量（完成率/中断/未完成）→ 0~100 ---- */
function getFatigueScore() {
  const now = Date.now(),
    from = now - 2 * 3600000;
  const recs = (appData.records || []).filter(function (r) {
    return r.startTime >= from && !isLogRecord(r); /* 仅记录不参与疲劳判定 */
  });
  if (recs.length < 2) return 0;
  let score = 0;
  const unfinished = recs.filter(function (r) {
    return r.type === 'incomplete';
  }).length;
  const ints = recs.reduce(function (s, r) {
    return s + ((r.interruptions && r.interruptions.length) || 0);
  }, 0);
  score += (unfinished / recs.length) * 60;
  score += Math.min(1, ints / Math.max(1, recs.length * 1.5)) * 40;
  return Math.min(100, Math.round(score));
}
/* 疲劳建议：返回建议文案（疲劳高时由计时层调用），否则 null */
function checkFatigueAdvice() {
  if (!appData.settings.adaptiveSuggest) return null;
  const f = getFatigueScore();
  if (f >= 65) return '🧠 检测到认知疲劳（中断/未完成偏多），建议休息 8 分钟或缩短下一个番茄时长';
  if (f >= 45) return '🌬️ 专注质量略有下滑，建议下一个番茄选简单档（10 分钟）找回状态';
  return null;
}
/* 按专注时长分级休息（简单/中等/沉浸式/大师）
   休息时长封顶 20 分钟（原 30/40 改掉）。 */
function getBreakByDuration(isLong) {
  const mins = (timerState.totalDuration || (appData.settings.workDuration || POMO_DEFAULT_MINUTES) * 60 || POMO_DEFAULT_MINUTES * 60) / 60;
  const BREAK_MAX = 20; /* 单次休息上限（分钟） */
  let short, long;
  if (mins <= 15) {
    short = 3;
    long = 10;
  } /* 简单 ≤15min */ else if (mins <= 35) {
    short = 5;
    long = 20;
  } /* 中等 16-35 */ else if (mins <= 65) {
    short = 10;
    long = 20;
  } /* 沉浸式 36-65：50 分钟配 10 分钟短休 */ else {
    short = 15;
    long = 20;
  } /* 大师 >65 */
  return Math.min(isLong ? long : short, BREAK_MAX);
}
/* ---- 任务难度：建议难度（基于近 7 天完成率 + 完整番茄占比 + 中断，供界面预选；与心流推荐时长同口径：easy=10min/medium=25min/hard=50min） ---- */
function getSuggestedDifficulty() {
  const recs = (appData.records || []).filter(function (r) {
    return r.startTime >= Date.now() - 7 * DAY_MS;
  });
  if (recs.length < 3) return 'medium';
  const full = recs.filter(function (r) {
    return r.type === 'full';
  }).length;
  const half = recs.filter(function (r) {
    return r.type === 'half';
  }).length;
  const done = full + half;
  const rate = done / recs.length;
  const fullRatio = done ? full / done : 0;
  const intCount = recs.reduce(function (s, r) {
    return s + ((r.interruptions && r.interruptions.length) || 0);
  }, 0);
  const avgInt = recs.length ? intCount / recs.length : 0;
  if (rate >= 0.8 && fullRatio >= 0.8) return 'hard'; /* 完成率≥80% 且完整占比≥80% → 沉浸式 */
  if (rate < 0.4 || avgInt >= 2 || fullRatio < 0.4) return 'easy'; /* 完成率低/中断偏多/半个为主 → 简单 */
  return 'medium';
}
/* ---- 人机排行榜：8 个性格各异的 BOT，段位+星数每日波动 ---- */
function getBotTier(stars) {
  const st = stars || 0;
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (st >= RANK_TIERS[i].min) return RANK_TIERS[i];
  }
  return RANK_TIERS[0];
}
function initBotLeaderboard() {
  const lb = appData.botLeaderboard || (appData.botLeaderboard = { lastDate: null });
  if (!lb.bots || !lb.bots.length) {
    /* v2 初始星数按性格错开（摆烂<休闲<努力<专注），起点整体压到玩家之下，
       让「玩家从 0 起步、3~8 天可全面登顶」的新手正反馈成立；之后由目标追随驱动 */
    lb.bots = BOT_PLAYERS.map(function (bp) {
      let base = 0;
      if (bp.persona === '摆烂型') base = Math.floor(Math.random() * 9); /* 0~8 */
      else if (bp.persona === '休闲型') base = 4 + Math.floor(Math.random() * 12); /* 4~15 */
      else if (bp.persona === '努力型') base = 10 + Math.floor(Math.random() * 16); /* 10~25 */
      else base = 18 + Math.floor(Math.random() * 18); /* 18~35 */
      return { id: bp.id, name: bp.name, emoji: bp.emoji, persona: bp.persona, stars: base, gain: 0, event: null };
    });
    lb.lastDate = getTodayStr();
    saveData();
  }
}
/* 每日波动更新：按性格随机增减星 + 20% 触发事件（爆发/低谷/临时性格漂移） */
const CHASE_LOST_DAYS = 3; /* 被反超观察期天数（渲染层提示用） */
function getPlayerAvgDailyGain() {
  /* 玩家近 7 天平均日净星：BOT 单日涨幅的上限基准（v2 排行榜） */
  const rs = appData.rankSystem;
  const h = (rs && rs.dailyStarHistory) || [];
  const recent = h.slice(-7);
  if (!recent.length) return 4;
  let sum = 0;
  recent.forEach(function (x) {
    sum += (x.starsGained || 0) - (x.starsLost || 0);
  });
  return Math.max(1, Math.round(sum / recent.length));
}
function dailyUpdateLeaderboard() {
  const lb = appData.botLeaderboard;
  if (!lb || !lb.bots || !lb.bots.length) initBotLeaderboard();
  const today = getTodayStr();
  if (lb.lastDate === today) return;
  const meStars = Math.max(0, (appData.rankSystem && appData.rankSystem.stars) || 0);
  const meGain = getPlayerAvgDailyGain();
  /* BOT 单日净增上限跟随玩家产能：努力玩家（日均 10 星）→ BOT 上限 7，追得上但必须持续努力；
     摸鱼玩家（日均 3 星）→ BOT 上限 4，躺着就会被超 */
  const cap = Math.max(4, Math.min(12, Math.round(meGain * 0.7)));
  lb.bots.forEach(function (bot) {
    const cfg = BOT_PLAYERS.find(function (bp) {
      return bp.id === bot.id;
    });
    const k = (cfg && cfg.k) || 1;
    /* 目标 = 玩家星数 × 性格系数（专注 1.25 / 努力 1.0 / 休闲 0.8 / 摆烂 0.6） */
    const target = Math.round(meStars * k);
    /* 向目标渐近：每天移动差距的 30%，封顶 cap、净减 ≥ -3（不出现一天暴跌十几星） */
    let g = Math.round((target - (bot.stars || 0)) * 0.3);
    g = Math.max(-3, Math.min(g, cap));
    /* 20% 波动事件（性格漂移 ±1~2，收敛不脱离正常上星范围） */
    if (Math.random() < 0.2) {
      const ev = Math.random();
      if (ev < 0.35) {
        g += 2;
        bot.event = '状态爆发';
      } else if (ev < 0.65) {
        g -= 2;
        bot.event = '状态低谷';
      } else if (ev < 0.85) {
        g += 1;
        bot.event = '突然发力';
      } else {
        g -= 1;
        bot.event = '有所松懈';
      }
    } else {
      bot.event = null;
    }
    bot.stars = Math.max(0, (bot.stars || 0) + g);
    bot.gain = g;
  });
  /* 追星状态：玩家是否榜首 / 被反超天数（渲染层提示用） */
  const meAfter = Math.max(0, (appData.rankSystem && appData.rankSystem.stars) || 0);
  const nowFirst =
    meAfter > 0 &&
    lb.bots.every(function (b) {
      return (b.stars || 0) < meAfter;
    });
  if (nowFirst) {
    lb.chaseMode = true;
    lb.chaseLostStreak = 0;
    lb.chaseLostDate = null;
  } else if (lb.chaseMode) {
    lb.chaseLostStreak = (lb.chaseLostStreak || 0) + 1;
    if (!lb.chaseLostDate) lb.chaseLostDate = today;
  }
  lb.lastDate = today;
  saveData();
}
/* 排行榜行：玩家 + 8 BOT，按星星降序，仅返回 段位+星数（简洁模式） */
/* 排行榜结果缓存（缓更新）：内存缓存 30 秒；日期变化或玩家星数变化立即失效。
   排行榜数据每天只算一次（dailyUpdateLeaderboard 的 lastDate 守卫），
   页面内短时间反复打开不再重复排序计算，移动端低端机也不卡。 */
let _lbRowsCache = null;
function getLeaderboardRows() {
  initBotLeaderboard();
  dailyUpdateLeaderboard();
  const meStars = Math.max(0, Math.round((appData.rankSystem && appData.rankSystem.stars) || 0) || 0);
  const today = getTodayStr();
  if (
    _lbRowsCache &&
    _lbRowsCache.date === today &&
    _lbRowsCache.meStars === meStars &&
    Date.now() - _lbRowsCache.ts < 30000
  ) {
    return _lbRowsCache.rows;
  }
  const me = { id: 'me', name: '我', emoji: '🙋', persona: '玩家', stars: meStars, isMe: true };
  const rows = (appData.botLeaderboard.bots || []).map(function (b) {
    /* 数值防御：星数非法（NaN/负数/超长）一律兜底为 0，防脏数据传播导致排序崩溃 */
    const st = Math.max(0, Math.round(Number(b.stars) || 0) || 0);
    return { id: b.id, name: b.name, emoji: b.emoji, persona: b.persona, stars: st, isMe: false };
  });
  rows.push(me);
  rows.sort(function (a, b) {
    return b.stars - a.stars;
  });
  rows.forEach(function (r, i) {
    r.rank = i + 1;
  });
  _lbRowsCache = { ts: Date.now(), date: today, meStars: meStars, rows: rows };
  return rows;
}
/* 赛季重置联动：玩家段位回退时，BOT 也按性格重置起点（青铜~黄金区间）。
   防止跨赛季星星无限膨胀（全服 BOT 都飙到荣耀段、玩家永远追不上的不合理局面）。
   起点分布参照玩家赛季回退逻辑：普通玩家回退到 0、钻石回退白银(40)、星耀回退黄金(100)。 */
function resetBotLeaderboardForSeason() {
  /* v2：BOT 起点跟随「玩家本赛季回退后的星数」，按性格错开——
     玩家回退后起点低（0~280），BOT 也整体回落，新赛季从接近的起跑线开始竞争 */
  const lb = appData.botLeaderboard;
  if (!lb) return;
  const meStars = Math.max(0, (appData.rankSystem && appData.rankSystem.stars) || 0);
  lb.bots = BOT_PLAYERS.map(function (bp) {
    let base = 0;
    if (bp.persona === '摆烂型') base = Math.floor(Math.random() * Math.max(8, Math.round(meStars * 0.25)));
    else if (bp.persona === '休闲型') base = Math.floor(meStars * 0.4) + Math.floor(Math.random() * 12);
    else if (bp.persona === '努力型') base = Math.floor(meStars * 0.55) + Math.floor(Math.random() * 15);
    else base = Math.floor(meStars * 0.7) + Math.floor(Math.random() * 18);
    return { id: bp.id, name: bp.name, emoji: bp.emoji, persona: bp.persona, stars: base, gain: 0, event: null };
  });
  lb.lastDate = getTodayStr();
  lb.chaseMode = false;
  lb.chaseLostStreak = 0;
  lb.chaseLostDate = null;
  saveData();
}
