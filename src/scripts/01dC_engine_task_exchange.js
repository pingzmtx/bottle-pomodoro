/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01d_engine_features.js 按域拆出（2026-11-14 · S2，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；engine.js 因拼接符 "\n;\n" 在每个新文件边界各多 1 个空语句（共 6 处，长度不变）。
 * 换任务与周挑战结算。对外仅 countSpentTomatoes / getRerollState / getRerollCost / 周挑战入口。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot 1 files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01dC_engine_task_exchange.js
 * 分组：features
 * 职责：业务层——番茄换任务（只扣战力标计数，不碰统计数据）、每周挑战
 * 功能：
 *   - 换任务消耗的番茄：只从战力标计数里扣除，不碰任何统计数据
 *   - 番茄换任务：countSpentTomatoes / getRerollState / getRerollCost
 *   - 每周挑战：周一自动刷新，随机 3 个，完成自动领星（每周最多 +7⭐）
 * 函数索引（TOC）：countSpentTomatoes/getRerollState/getRerollCost/getBetTier/getBetStep/_healWeeklyItems/getWeeklyChallenge/calcWeeklyChallengeProgress/getWeekRangeTs/getWeekTomatoPoints/getWeekSpentTomatoes/getSpendableTomatoes（+10 更多）
 * ============================================================ */

/* ===== 换任务消耗的番茄：只从战力标计数里扣除，不碰任何统计数据 ===== */
function countSpentTomatoes(wsTs, weTs) {
  const obj = (appData.rankSystem && appData.rankSystem.spentTomatoes) || {};
  let n = 0;
  Object.keys(obj).forEach(function (d) {
    const t = new Date(d + 'T00:00:00').getTime();
    if (t >= wsTs && t < weTs) n += obj[d] || 0;
  });
  return n;
}
/* ===== 番茄换任务 ===== */
function getRerollState() {
  const rs = appData.rankSystem;
  const today = getTodayStr();
  if (!rs.reroll || rs.reroll.date !== today) rs.reroll = { date: today, count: 0, spent: 0 };
  return rs.reroll;
}
/* 消耗价格：等差数列，第 N 次（N 从 1 起）= 2N → 2 / 4 / 6 / 8 / 10 … */
const REROLL_COST_BASE = 2;
function getRerollCost(count) {
  return REROLL_COST_BASE * ((count || 0) + 1);
}
/* 赌注三档：投入越大 → 目标上浮越多（挑战越大）→ 赢的奖励越高。
   上浮量按「今日任务目标」动态计算：目标 × 比例，向上取整、不低于保底、不高于封顶——
   低目标按比例拉开梯度，高目标封顶保证可达成（目标 15 大赌只 +5 → 20 个，一天仍有可能）。 */
const BET_TIERS = [
  { level: 1, cost: 2, ratio: 0.2, minStep: 1, maxStep: 3, reward: 5, label: '小赌', icon: '🥉', short: '🥉2🍅+5⭐' },
  { level: 2, cost: 6, ratio: 0.4, minStep: 2, maxStep: 4, reward: 11, label: '中赌', icon: '🥈', short: '🥈6🍅+11⭐' },
  {
    level: 3,
    cost: 12,
    ratio: 0.6,
    minStep: 3,
    maxStep: 5,
    reward: 18,
    label: '大赌',
    icon: '🥇',
    short: '🥇12🍅+18⭐'
  }
];
function getBetTier(level) {
  return BET_TIERS.find(t => t.level === level) || BET_TIERS[0];
}
/* 按今日任务目标计算该档位应上浮的个数：目标 × 比例向上取整，夹在 [保底, 封顶] 之间 */
function getBetStep(tier, target) {
  target = target || 3;
  return Math.max(tier.minStep, Math.min(tier.maxStep, Math.ceil(target * tier.ratio)));
}
/* 难度增幅池：常规从 +1/+2/+3/+5/+7/+9/+11/+13/+15 里随机抽一个，增加量上限 +15（换后任务总量上限 20 个，与赌注封顶一致） */
/* ===== 每周挑战：周一自动刷新，随机 3 个，完成自动领星（每周最多 +7⭐） ===== */
const WEEKLY_CHALLENGE_POOL = [
  { id: 'vol20', icon: '🍅', name: '本周完成 20 个番茄', goal: 20, reward: 3, type: 'vol' },
  { id: 'streak3', icon: '🔥', name: '本周连续 3 天完成任务', goal: 3, reward: 2, type: 'streak' },
  /* ★ goal 必须是 8：进度口径是「本周最高单日番茄数」（见 ctx.day8 = maxDayPts），
     写成 1 就会「今天做了 1 个 → 1 >= 1 → 立刻算完成」。2026-10-29 修 */
  { id: 'day8', icon: '⚡', name: '本周单日完成 8 个番茄', goal: 8, reward: 2, type: 'day8' },
  { id: 'active4', icon: '🌤️', name: '本周 4 天都有番茄', goal: 4, reward: 2, type: 'active' },
  { id: 'done2', icon: '✅', name: '本周完成任务 2 天', goal: 2, reward: 2, type: 'done' },
  { id: 'betWin1', icon: '🎲', name: '本周下注并赢 1 次', goal: 1, reward: 2, type: 'betwin' }
];
/* 存档条目按池里的定义校正 goal/reward/name/type。
   为什么需要：day8 曾经把 goal 写成 1（本意是「1 天达标」，但进度口径是
   「本周最高单日番茄数」），于是做 1 个番茄就 1 >= 1 判定完成。池里改回 8 之后，
   localStorage 里还躺着 goal:1 的旧条目 —— 本周剩下的日子照旧会误判，只能就地校正。
   已发出去的星不回收（不能因为一次判定错误就把 ⭐ 扣成负数），但也不会重复发。 */
function _healWeeklyItems(items) {
  if (!items || !items.length) return false;
  let changed = false;
  items.forEach(function (it) {
    const def = WEEKLY_CHALLENGE_POOL.find(function (c) {
      return c.id === it.id;
    });
    if (!def) return;
    if (it.goal === def.goal && it.reward === def.reward && it.name === def.name) return;
    it.goal = def.goal;
    it.reward = def.reward;
    it.name = def.name;
    it.type = def.type;
    it.icon = def.icon;
    /* 目标变了就按已知进度老实地重算「完成」，别把旧判定的 done 留着 */
    it.done = (Number(it.progress) || 0) >= def.goal;
    changed = true;
  });
  return changed;
}
function getWeeklyChallenge() {
  const rs = appData.rankSystem;
  if (!rs.weeklyChallenge) rs.weeklyChallenge = { weekStart: null, items: [] };
  const ws = getWeekStartStr();
  if (rs.weeklyChallenge.weekStart !== ws) {
    const pool = WEEKLY_CHALLENGE_POOL.slice();
    const picked = [];
    while (picked.length < 3 && pool.length > 0) {
      const i = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(i, 1)[0]);
    }
    rs.weeklyChallenge = {
      weekStart: ws,
      items: picked.map(function (c) {
        return {
          id: c.id,
          icon: c.icon,
          name: c.name,
          goal: c.goal,
          reward: c.reward,
          type: c.type,
          progress: 0,
          done: false,
          claimed: false
        };
      })
    };
  } else {
    _healWeeklyItems(rs.weeklyChallenge.items);
  }
  return rs.weeklyChallenge;
}
/* 计算本周各挑战进度（幂等）；完成且未领奖 → 自动 +reward 星 */
function calcWeeklyChallengeProgress() {
  const rs = appData.rankSystem;
  const wc = getWeeklyChallenge();
  if (!wc.items || !wc.items.length) return wc;
  const ws = getWeekStartStr();
  const wsTs = new Date(ws + 'T00:00:00').getTime();
  const we = wsTs + 7 * DAY_MS;
  const today = getTodayStr();
  /* 本周每日番茄点数 + 有番茄的天数 + 周总点数 */
  const dayPts = {};
  let weekPts = 0;
  appData.records.forEach(function (r) {
    if (r.startTime < wsTs || r.startTime >= we) return;
    if (isLogRecord(r)) return; /* 仅记录：不进本周点数 */
    const ds = getDateStr(r.startTime);
    const pts = r.type === 'half' ? 0.5 : 1;
    dayPts[ds] = (dayPts[ds] || 0) + pts;
    weekPts += pts;
  });
  const activeDays = Object.keys(dayPts).length;
  let maxDayPts = 0;
  for (const k in dayPts) {
    if (dayPts[k] > maxDayPts) maxDayPts = dayPts[k];
  }
  /* 本周完成任务的天数（history 达标日 + 今天）→ 用于 done / streak */
  const doneDays = []; /* 达标日期数组 */
  (rs.dailyStarHistory || []).forEach(function (h) {
    if (h.date >= ws && h.date < today && h.actual !== undefined && h.actual >= (h.target || 3)) doneDays.push(h.date);
  });
  if (rs.dailyTask && rs.dailyTask.date === today && getTodayEffectiveFull() >= (rs.dailyTask.target || 3))
    doneDays.push(today);
  doneDays.sort();
  /* 最大连续达标天数 */
  let maxStreak = 0,
    curStreak = 0,
    prev = null;
  doneDays.forEach(function (ds) {
    if (prev !== null) {
      const d1 = new Date(prev + 'T00:00:00');
      d1.setDate(d1.getDate() + 1);
      if (getDateStr(d1) === ds) curStreak++;
      else curStreak = 1;
    } else {
      curStreak = 1;
    }
    if (curStreak > maxStreak) maxStreak = curStreak;
    prev = ds;
  });
  /* 本周赌赢次数 */
  let betWins = 0;
  (rs.betWinDates || []).forEach(function (ds) {
    if (ds >= ws) betWins++;
  });
  const ctx = {
    vol: weekPts,
    streak: maxStreak,
    day8: maxDayPts,
    active: activeDays,
    done: doneDays.length,
    betwin: betWins
  };
  let claimedAny = false;
  wc.items.forEach(function (it) {
    const v = ctx[it.type] || 0;
    it.progress = v;
    if (!it.done && v >= it.goal) {
      it.done = true;
    }
    if (it.done && !it.claimed) {
      it.claimed = true;
      addRankStars(it.reward, 'weekly');
      claimedAny = true;
      UIFX.showRankFeedback('🎯 周挑战完成：「' + it.name + '」+' + it.reward + '⭐');
    }
  });
  if (claimedAny) {
    saveData();
  }
  return wc;
}
/* 本周（周一 00:00 起）范围时间戳；跨周自动归零，所以「可用番茄」只认本周的 */
function getWeekRangeTs() {
  const ws = getWeekStartStr();
  const wsTs = new Date(ws + 'T00:00:00').getTime();
  return { ws: wsTs, we: wsTs + 7 * DAY_MS };
}
/* 本周番茄点数：完整🍅=1、半个🍅=0.5——统计/段位/商店/下注统一口径，半个也是挣到的，同样能消耗 */
function getWeekTomatoPoints() {
  const r = getWeekRangeTs();
  return (appData.records || []).reduce(function (s, x) {
    if (x.startTime < r.ws || x.startTime >= r.we) return s;
    if (x.type === 'full') return s + 1;
    if (x.type === 'half') return s + 0.5;
    return s;
  }, 0);
}
function getWeekSpentTomatoes() {
  const r = getWeekRangeTs();
  return countSpentTomatoes(r.ws, r.we);
}
/* 可用来换任务的余额 = 本周完成的完整🍅 − 本周已消耗 */
/* 可消耗番茄：与商店 / 统计共用同一个池子（周完成 − 段位下注 − 商店兑换 + 扭蛋额外🍅）。
   只减段位下注的话，商店兑换后这里的数字不变，等于「一番茄两用」。 */
function getSpendableTomatoes() {
  return Math.max(0, getWeekTomatoPoints() - countWeekAllSpent() + (appData.rankSystem.extraWeekTomatoes || 0));
}
/* 本周各系统合计已消耗的番茄：段位下注 + 树商店道具（两套独立消耗，都不影响 records 统计） */
function countWeekAllSpent() {
  resetWeekTomatoSpentIfNeeded();
  const r = getWeekRangeTs();
  const rankSpent = countSpentTomatoes(r.ws, r.we);
  const shopSpent = (appData.tree && appData.tree.weekTomatoSpent) || 0;
  return rankSpent + shopSpent;
}
/* 树商店「本周已消耗」跨周自动归零（按周一归属周） */
function resetWeekTomatoSpentIfNeeded() {
  if (!appData.tree) return;
  const ws = getWeekStartStr();
  if (appData.tree.weekTomatoSpentWeek !== ws) {
    appData.tree.weekTomatoSpent = 0;
    appData.tree.weekTomatoSpentWeek = ws;
  }
}
/* 下注按钮点击：可用 → 正常下注；点不动时点一下 → 说明原因
   （番茄不够 → 显示还差多少个；今天不可能完成 → 已下注/已兑现/已延后/无任务各自说明）

   返回契约：**必须返回 Promise**（故标 async）。按钮在 HTML 里写成
   `tryBet(n).catch(...)`，而 `.catch` 是对「返回值」取属性——一旦返回 undefined，
   取属性那步就抛 TypeError，连 catch 处理器都没机会挂上去（曾真实发生：
   错误面板修好后立刻报出来）。标 async 后，任何早退 `return;` 都会被语言自动
   包成 Promise，以后再加分支也不会破这个契约。 */
async function tryBet(level) {
  const tier = getBetTier(level);
  const rs = appData.rankSystem;
  const today = getTodayStr();
  const realDt = rs.dailyTask || null;
  const dt = realDt && realDt.date === today ? realDt : null;
  if (realDt && realDt.postponed && realDt.date !== today) {
    UIFX.toast('⏭ 今日任务已延后到明天，今天不能下注', true);
    return;
  }
  const avail = getSpendableTomatoes();
  if (avail < tier.cost) {
    UIFX.toast(
      '🍅 ' +
        tier.icon +
        tier.label +
        '需要 ' +
        tier.cost +
        ' 个🍅，还差 ' +
        (tier.cost - avail) +
        ' 个（本周可用 ' +
        avail +
        ' 个）',
      true
    );
    return;
  }
  if (!dt) {
    UIFX.toast('📋 今天还没有今日任务，无法下注', true);
    return;
  }
  if (dt.boosted && dt.boosted.claimed) {
    UIFX.toast('🔥 今天已兑现赌注，明天才能再下注', true);
    return;
  }
  if (dt.boosted) {
    UIFX.toast('🔥 今天已下注，完成新目标后自动结算', true);
    return;
  }
  return rerollDailyTask(level);
}
/* 按钮入口（模板里 data-act="tryBetSafe"）。
   ★ 为什么要这一层，而不是把 data-act 直接改成 tryBet：
     00_delegate 的 run() 只有同步 try/catch，它 `return fn.apply(...)` 就完事，
     管不到 async 函数被 reject 的情况 —— 那就是一个 unhandledrejection，
     在接入错误面板之前连日志都要翻 DevTools 才看得到。
     这层包装把 Promise 接住并走统一上报，保留「失败也要留下痕迹」的契约。
   ★ 命名教训：这个函数曾经**根本不存在**（迁移到模块时模板改成了 tryBetSafe，
     实现没有跟着改）。而 00_delegate 解析不到名字只 console.error 一行，
     界面上表现为「点了没反应」——用户当成卡顿报了上来。
     现在 tools/check_act_targets.py 会扫全部 data-act 与 window 导出是否对得上，
     这类静默死按钮不会再被漏掉。 */
function tryBetSafe(level) {
  var p;
  try {
    p = tryBet(level);
  } catch (e) {
    if (window.__errRep && window.__errRep.push) window.__errRep.push(e, 'tryBetSafe');
    else console.error('[tryBetSafe]', e);
    return;
  }
  if (p && typeof p.catch === 'function') {
    p.catch(function (e) {
      if (window.__errRep && window.__errRep.push) window.__errRep.push(e, 'tryBetSafe');
      else console.error('[tryBetSafe]', e);
    });
  }
  return p;
}
async function rerollDailyTask(level) {
  /* 「🔥 今日赌注」三档：花 2/6/12🍅 下注，赌自己完成更难的今日任务。
     档位越高 → 投入越大、目标上浮越多（挑战越大）→ 赢的奖励越高：
       上浮量按今日目标 × 比例动态算（20%/40%/60%），封顶 +3/+4/+5——目标再高也不会出现做不到的任务
     下注花的 🍅 从今日进度扣除（烧进度）：新目标 = max(原目标, 扣后进度) + step，进度先 -cost。
     赢（完成新目标）→ 按档位额外加星；输（没完成）→ 次日按新目标结算降星（差 N 扣 N⭐）。
     每天一次，不可撤销、下注后不能延后 —— 风险回报 + 损失厌恶：下了注就不甘心输。 */
  const tier = getBetTier(level);
  const rs = appData.rankSystem;
  const today = getTodayStr();
  if (rs.dailyTask && rs.dailyTask.postponed && rs.dailyTask.date !== today) {
    UIFX.toast('⏭ 任务已延后到明天，今天不能下注');
    return;
  }
  const st = getRerollState();
  const cost = tier.cost;
  const avail = getSpendableTomatoes();
  if (avail < cost) {
    UIFX.toast('🍅 不够：' + tier.label + '需 ' + cost + ' 个，本周可用 ' + avail + ' 个');
    return;
  }
  const dt = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask : null;
  if (!dt) {
    UIFX.toast('📋 今天还没有今日任务');
    return;
  }
  if (dt.boosted) {
    UIFX.toast('🔥 今天已经下过注了，明天再来');
    return;
  }
  const todayFull = getTodayEffectiveFull(); /* 下注前有效进度（番茄数） */
  const curTarget = dt.target || 3; /* 原任务目标 */
  const step = getBetStep(tier, curTarget); /* 按今日目标动态计算上浮个数 */
  const leftAfter = Math.max(0, todayFull - cost); /* 花的🍅扣除后剩余进度（≥0） */
  /* 新目标 = 原目标 + 按比例算出的上浮量（20% / 40% / 60%）。
     不能写成 Math.max(curTarget, todayFull) + step：当天已做很多🍅时会把目标直接顶到 30
     （目标 2、今天已做 49 个 → 小赌直接飙到 30）。
     上限 20 = 今日任务目标生成封顶 15 + 大赌最多 +5，即"全力以赴一天"的真实极限，
     不允许出现一天根本完不成的任务。 */
  const newTarget = Math.min(20, curTarget + step);
  const realStep = newTarget - curTarget; /* 目标真实上升幅度（= step，恒 ≤5） */
  const stillNeed = Math.max(0, newTarget - leftAfter); /* 实际还需完成数（已达标则为 0） */
  const doneTag = stillNeed > 0 ? '，还需完成 ' + stillNeed + ' 个' : '，扣后进度已达标 🎉';
  const drop = calcDropStars(newTarget, leftAfter); /* 与任务卡「若现在停止」同一口径：差 N 个扣 N⭐ */
  const msg =
    '🔥' +
    tier.icon +
    ' ' +
    tier.label +
    ' ' +
    cost +
    '🍅 → 完成 +' +
    tier.reward +
    '⭐\n\n' +
    '🎯 当前档位：' +
    curTarget +
    ' → 目标档位：' +
    newTarget +
    '\n' +
    '📊 今日进度：' +
    fmtTomatoNum(todayFull) +
    '-' +
    cost +
    '🍅=' +
    fmtTomatoNum(leftAfter) +
    '\n' +
    '     今日还需要完成：' +
    fmtTomatoNum(stillNeed) +
    '  个番茄\n\n' +
    '结算：\n' +
    '✅ 做完' +
    newTarget +
    '个 → 额外奖励 +' +
    tier.reward +
    '⭐\n' +
    '❌ 没做完 → 📉 若现在停止：明天 -' +
    drop.lost +
    '⭐（当前预估·还差 ' +
    fmtTomatoNum(drop.need) +
    ' 个），押注的' +
    cost +
    '🍅不退还\n' +
    '      ※ 按当前进度预估：之后每多完成 1 个🍅，明早少扣 1⭐；做完' +
    newTarget +
    '个则不扣\n\n' +
    '每天仅1次，不可延后，敢不敢？';
  /* 用应用内确认弹窗（原生 confirm 对多行长文案排版差、移动端易截断）。
     无 Promise 环境自动回退 window.confirm（见 0C 脚本）。 */
  const _ok =
    typeof window.rsConfirm === 'function'
      ? await window.rsConfirm(msg, {
          title: '🔥 确认下注',
          okText: '敢，下注',
          cancelText: '再想想',
          danger: true,
          highlight: ['❌ 没做完', '每天仅1次']
        })
      : confirm(msg);
  if (!_ok) return;
  if (!rs.spentTomatoes) rs.spentTomatoes = {};
  rs.spentTomatoes[today] = (rs.spentTomatoes[today] || 0) + cost;
  st.count = (st.count || 0) + 1;
  st.spent = (st.spent || 0) + cost;
  /* 赌注生效：目标上浮、花的番茄从进度扣除（baseline += cost）、标记已下注（含档位） */
  dt.target = newTarget;
  dt.baseline = (dt.baseline || 0) + cost; /* 下注花的 🍅 从今日进度扣除 */
  dt.boosted = { claimed: false, level: tier.level };
  saveData();
  UIFX.renderRankSystem();
  UIFX.renderWeeklyBadges();
  UIFX.renderRerollUI();
  UIFX.renderTimerRankStrip();
  UIFX.toast(
    '🔥 ' +
      tier.label +
      '已下注！' +
      cost +
      '🍅 已扣，目标 ' +
      newTarget +
      ' 个' +
      (stillNeed > 0 ? '，还需 ' + stillNeed + ' 个' : '，已达标')
  );
}
async function postponeDailyTask() {
  const rs = appData.rankSystem;
  const today = getTodayStr();
  const dt = rs.dailyTask;
  if (!dt || dt.date !== today) {
    UIFX.toast('今天还没有进行中的任务，无法延后');
    return;
  }
  if (dt.postponed) {
    UIFX.toast('⛔ 最多只能延后一天，今天已使用过');
    return;
  }
  if (dt.settled) {
    UIFX.toast('今日任务已结算，无法延后');
    return;
  }
  if (dt.boosted && !dt.boosted.claimed) {
    UIFX.toast('🔥 已下注的任务不能延后——赌注今天必须见分晓！');
    return;
  }
  const todayFull = getTodayEffectiveFull();
  const target = dt.target || 3;
  if (todayFull >= target) {
    UIFX.toast('✅ 今日任务已完成，无需延后');
    return;
  }
  const t = new Date(today + 'T00:00:00');
  t.setDate(t.getDate() + 1);
  const tomorrow = getDateStr(t);
  const msg =
    '确定把今日任务（目标 ' +
    target +
    ' 个🍅）延后到明天吗？\n\n' +
    '⏭ 延后后：今天不结算、不降星、不扣星，任务顺延到明天。\n' +
    '⚠️ 最多只能延后一天：每个任务只能延后 1 次，用后不能再延。\n' +
    '⚠️ 明天需完成 ' +
    target +
    ' 个🍅，完不成仍按未达标降星。';
  /* 改用应用内确认弹窗（同上，长文案原生 confirm 移动端排版差）。 */
  const _ok =
    typeof window.rsConfirm === 'function'
      ? await window.rsConfirm(msg, {
          title: '⏭ 确认延后今日任务',
          okText: '延后到明天',
          cancelText: '取消',
          highlight: ['⚠️ 最多只能延后一天', '⏭ 延后后']
        })
      : confirm(msg);
  if (!_ok) return;
  dt.date = tomorrow;
  dt.postponed = true;
  dt.settled = false;
  dt.starsGainedToday = 0;
  dt.roundBase = 0;
  dt.baseline = 0;
  dt.pendingStars = 0;
  dt.volumeBonus = 0;
  dt.overCompleted = false;
  dt.underCompleted = false;
  dt.rerolled = false;
  dt.starMult = 1;
  saveData();
  UIFX.renderRankSystem();
  UIFX.renderRerollUI();
  UIFX.renderTimerRankStrip();
  UIFX.toast('⏭ 已延后：今日任务顺延到明天，记得明天完成 ' + target + ' 个🍅');
}
/* 按钮入口（模板里 data-act="postponeDailyTaskSafe"）—— 与 tryBetSafe 同一个病：
   模板写了 Safe 后缀，实现没有，点了没反应。
   两处合起来说明这不是手滑一次，而是迁移时的系统性缺口：模板那侧被批量加了
   Safe 后缀，实现那侧没有对应批量补，于是**同一次迁移里成批出现死按钮**。
   所以修完这两处之后立刻加了 tools/check_act_targets.py 做全量扫描，
   而不是逐个等用户报上来。 */
function postponeDailyTaskSafe() {
  var p;
  try {
    p = postponeDailyTask();
  } catch (e) {
    if (window.__errRep && window.__errRep.push) window.__errRep.push(e, 'postponeDailyTaskSafe');
    else console.error('[postponeDailyTaskSafe]', e);
    return;
  }
  if (p && typeof p.catch === 'function') {
    p.catch(function (e) {
      if (window.__errRep && window.__errRep.push) window.__errRep.push(e, 'postponeDailyTaskSafe');
      else console.error('[postponeDailyTaskSafe]', e);
    });
  }
  return p;
}
function fmtNum2(v) {
  if (v % 1 === 0) return v;
  return v.toFixed(1);
}


/* __replace_savePomodoroRecord__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_savePomodoroRecord(fn) { savePomodoroRecord = fn; }


/* __replace_checkNewAchievements__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_checkNewAchievements(fn) { checkNewAchievements = fn; }


/* __replace_claimMustDoReward__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_claimMustDoReward(fn) { claimMustDoReward = fn; }


/* __set__yrY__ */
/* 跨模块可变状态的唯一写入口（ESM 导入绑定只读；读走活绑定） */
function __set__yrY(v) { _yrY = v; }


/* __set__monthPickY__ */
/* 跨模块可变状态的唯一写入口（ESM 导入绑定只读；读走活绑定） */
function __set__monthPickY(v) { _monthPickY = v; }
