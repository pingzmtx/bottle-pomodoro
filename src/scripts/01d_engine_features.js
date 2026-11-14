/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 游戏化/结算逻辑大户：被依赖≈378。对外白名单：
 * savePomodoroRecord / addTreePoints / onPomodoroCompleteRank / settlePreviousDay /
 * checkNewDay / 成就与传记入口 / showRankFeedback 等业务 API。
 * 红线：本文件的函数是全项目结算链主干，增强模块只许"包装白名单函数"，
 * 禁止复制第二份同名实现；改结算链必须小步+全量回归。 */
/* ==================== 模块: 03-features.js | 职责: 业务层——番茄联动、树养成、段位、成就、组队、统计计算 | 分组: features ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：03-features.js
 * 分组：features
 * 职责：业务层——番茄联动、树养成、段位、成就、组队、统计计算
 * 功能：
 *   - 番茄完成联动：savePomodoroRecord（记录 → 树成长 → 段位加星 → 统计更新）
 *   - 成就与周徽章：getAchievements / processWeeklyBadges / 习惯打卡要求 / 成就手动领取金币（解锁进 pendingAchRewards，成就页点 🎁 领取 +20🪙）/ 每日签到（完成 1 个番茄后可签 +10🪙，累计 7 天解锁成就）
 *   - 统计计算：getStatsCache / monthStats / yearStats / ANALYZERS 智能分析器（已拆至 01d5_engine_stats.js）
 *   - 树养成·业务：addTreePoints / 树种 / 成长阶段（getTreeStage / getTreeStageFor / getCurrentTreeStages）/ 死亡复活 / 种植 / 浇水 / 投喂 / 心情 / 运势签 / 生命日志数据
 *   - 树商店·业务：宝箱与转盘奖励（rollChestReward / rollShopWheelReward）/ 道具购买使用 / 装饰 / 场景 / 光环 / 天气 / 摆件 / 动态定价 / 限时到期
 *   - 树玩法·业务：神秘任务生成与领取 / 扭蛋奖励（gachaReward / checkGachaTrigger）/ 物种图鉴 / 命名 / 台词词库（对话框与弹窗界面见 04-ui.js）
 *   - 自定义皮肤·业务：SKIN_KINDS / getSkinDef / getSkin / skinIsActive / skinRemainDays / 定价（渲染、URL 录入、拖拽定位界面见 04-ui.js）
 *   - 待办快捷语法：parseTodoShortSyntax / 排序偏好 getSortPrefs
 *   - 段位系统：onPomodoroCompleteRank / 每日任务结算 / 赌注 / 周挑战 / 连胜 / 重构（11 档位+星级显示、超额星分段、完成奖励、任务目标锚定产能、赛季回退按星数）
 *   - 组队系统：组队码生成 / 输入 / 结算 / 午夜重置（已拆至 01d4_engine_team.js）
 *   - 树商店·业务：宝箱与转盘奖励 / 道具购买使用 / 装饰 / 场景 / 光环 / 天气 / 摆件 / 动态定价 / 限时到期（已拆至 01d3_engine_tree_shop.js）
 *   - 通用工具：getTodayStr / getDateStr / getPomos / countTomatoPoints / fmtDurMin（核心工具已拆至 01d6_engine_util.js）
 *   - 沉浸式专注：savePomodoroRecord 冒险联动与长休抑制（状态机已迁移至 06-immersive.js）
 *   - 白帽游戏化：心流时长推荐（10/25/50，与难度档位同口径；手动选档后以用户为准、推荐仅提示）/ 疲劳检测 / 难度档位结算（档位=时长，奖励按 25 分钟=1 个🍅折算）/ 人机排行榜 v2（目标追随模型：BOT 目标=玩家星数×性格系数，单日涨幅跟随玩家产能）
 *   -  上瘾机制：必做3件事（提前一天立目标、当天全完成 +25🪙）/ 计划子任务（可折叠、计时界面同步勾选）/ 断签保护强化（连续7天免费送卡、断签自动消耗）/ 番茄完成中央大字庆祝（打破昨日/连续/效率亮点，2秒消失，toast 去堆叠）/ 年度专注地图（365 天热力图）/ 周报月报简报（总时长/最专注时段/任务TOP/较上期进退步）/ 每日专注总结（日记页，含明日建议）/ 每日惊喜扭蛋（第3/6/9个番茄触发：金币55%>周番茄30%>段位星15%）/ 赌注赢返还部分🍅
 *   -  情感化：段位晋升专属全屏光效弹窗（每升一段触发）/ 过去的自己·幽灵对比（三档基准：去年今日→昨天→随机历史日；中性化反馈：50%里程碑鼓励/超越大字庆祝/未达到静默；设置可开关，默认开启）/ 智能疲劳关怀（连续2个被打断或近3天低产或连续未达标≥2天 → 非强迫性关怀弹窗，开启轻松模式：时长减半、首个满10分钟按完整🍅计入进度、星星奖励照拿）/ 专注传记（50/100/500…记录、首次王者/荣耀/传奇、连续7/30天、单日10/20、成就数里程碑自动生成可编辑成长日记）
 * 函数索引（TOC）：getAchievements/migrateAchievements/checkNewAchievements/flushSettleSummary/settleTouch/tbTodoOf/liveSessionOf/liveSessionEnsure/liveSessionSegs/closeStaleLiveSessions/dropLiveSession/migrateSegLedger（+4 更多）
 * ============================================================ */

function getAchievements() {
  const C = getStatsCache();
  const totalTomatoes = C.totalFull;
  const streak = C.streak;
  const activeDaysCount = C.activeDays;
  const earlyStreak = C.earlyStreak;
  const nightStreak = C.nightStreak;
  const nobreakDays = C.nobreakDays;
  const maxDayFull = C.maxDayFull;
  const monthFullUnlocked = C.monthFull;
  const perfectWeekCount = C.perfectWeekCount;
  const nobreakUnlocked = nobreakDays >= 1;
  const perfectWeekUnlocked = perfectWeekCount >= 1;
  const rs = appData.rankSystem || {};
  const careerMax = Math.max(rs.stars || 0, (rs.history && rs.history.maxStarsCareer) || 0);
  const cum = (appData.weeklyBadges && appData.weeklyBadges.cumulative) || {};
  const badgeLights = Object.keys(cum).reduce(function (s, k) {
    return s + (cum[k] || 0);
  }, 0);
  const diaryCount = Object.keys(appData.diaries || {}).length;
  const habitCount = (appData.habits || []).length;
  const habitTotal = Object.keys(appData.habitLogs || {}).reduce(function (s, hid) {
    return s + (appData.habitLogs[hid] || []).length;
  }, 0);
  const totalMinutes = Math.floor(
    (appData.records || []).reduce(function (s, r) {
      if (isLogRecord(r)) return s; /* 仅记录：不计入「累计专注分钟」成就 */
      return s + (r.effectiveSeconds || 0) / 60;
    }, 0)
  );
  const uniqueTasks = new Set(
    (appData.records || []).map(function (r) {
      return r.taskName || '未命名任务';
    })
  ).size;
  /* 森林规模：累计种下的树数。口径与「我的森林」面板完全一致（都走 forestFromRecords），
     否则同一件事在两处会给出两个数。森林里程碑并入成就表后要靠它求值。 */
  const forestTrees = (function () {
    try {
      return forestFromRecords(appData.records || []).reduce(function (s, d) {
        return s + (d.trees || 0);
      }, 0);
    } catch (e) {
      return 0;
    }
  })();
  /* 成就定义表已外置 01b2_achievements.js（ACHIEVEMENT_DEFS：75 条静态字段 + cond(ctx)）。
     本函数只组装 ctx 并对每条求 unlocked；静态字段原样引用常量，每次返回全新对象数组
     （与原行为一致：调用方改动返回值不会污染常量表）。 */
  /* 长线维度（都取「当前树种」的口径，与树面板显示一致）：
     树龄 = 陪伴年数（时间线，十几年不缩水）；年轮 = 满级后的圈数（修为线）。 */
  const _curSid = (appData.tree && appData.tree.species) || 'tomato';
  const _planted =
    (appData.tree && appData.tree.treeLifeLog && appData.tree.treeLifeLog.planted && appData.tree.treeLifeLog.planted[_curSid]) ||
    null;
  const _treeYears = _planted ? treeAgeYears(_planted, getTodayStr()) : 0;
  const _treeRings = getEternalStars((appData.tree && appData.tree.points) || 0);
  const _g = {
    totalTomatoes: totalTomatoes,
    treeYears: _treeYears,
    treeRings: _treeRings,
    grove: groveCount(),
    streak: streak,
    activeDaysCount: activeDaysCount,
    earlyStreak: earlyStreak,
    nightStreak: nightStreak,
    nobreakDays: nobreakDays,
    maxDayFull: maxDayFull,
    monthFullUnlocked: monthFullUnlocked,
    perfectWeekCount: perfectWeekCount,
    nobreakUnlocked: nobreakUnlocked,
    perfectWeekUnlocked: perfectWeekUnlocked,
    careerMax: careerMax,
    badgeLights: badgeLights,
    diaryCount: diaryCount,
    habitCount: habitCount,
    habitTotal: habitTotal,
    totalMinutes: totalMinutes,
    uniqueTasks: uniqueTasks,
    forestTrees: forestTrees
  };
  return ACHIEVEMENT_DEFS.map(function (a) {
    const _o = {};
    for (const _k in a) if (_k !== 'cond') _o[_k] = a[_k];
    _o.unlocked = a.cond(_g);
    return _o;
  });
}
/* 成就表 2026-11-14 重排（88 → 64）后的一次性迁移。
   ① 清孤儿：旧 id 在新表里不存在 → 从 unlockedAchievements 移除，否则成就页会显示 71/64；
   ② 首次静默：有历史记录却一条都没记（重装 / 恢复备份 / 老版本升级）→ 直接把已达成的标记为已解锁，
      **不推送、不写传记**。这是「一打开 App 亮一片」的主要来源。 */
function migrateAchievements() {
  const ids = ACHIEVEMENT_DEFS.map(function (a) { return a.id; });
  const before = Array.isArray(appData.unlockedAchievements) ? appData.unlockedAchievements : [];
  const kept = before.filter(function (id) { return ids.indexOf(id) >= 0; });
  let changed = kept.length !== before.length;
  appData.unlockedAchievements = kept;
  if (!appData.achMigrated64) {
    appData.achMigrated64 = true;
    changed = true;
    const hasHistory = (appData.records || []).length > 0 ||
      ((appData.stats && appData.stats.totalFull) || 0) > 0;
    if (!kept.length && hasHistory) {
      getAchievements().forEach(function (a) { if (a.unlocked) kept.push(a.id); });
      appData.unlockedAchievements = kept;
    }
  }
  if (changed) saveData();
}
/* 每日最多点亮 3 个：超出的不丢弃、也不写库，下次结算会重新算到（自然排队到次日）。
   门槛后移后一天通常只亮 1~2 个，这个上限是兜底，防止「一次导入/一次批量买树」连跳多档。 */
const ACH_DAILY_CAP = 3;
function checkNewAchievements() {
  if (!appData.unlockedAchievements) appData.unlockedAchievements = [];
  if (!Array.isArray(appData.pendingAchRewards)) appData.pendingAchRewards = [];
  migrateAchievements();
  const today = getTodayStr();
  const doneToday = (appData.achDaily && appData.achDaily.date === today) ? (appData.achDaily.count || 0) : 0;
  if (doneToday >= ACH_DAILY_CAP) return;
  const achievements = getAchievements();
  const newlyUnlocked = achievements
    .filter(a => a.unlocked && !appData.unlockedAchievements.includes(a.id))
    .slice(0, ACH_DAILY_CAP - doneToday);
  if (newlyUnlocked.length > 0) {
    appData.achDaily = { date: today, count: doneToday + newlyUnlocked.length };
    newlyUnlocked.forEach(a => {
      appData.unlockedAchievements.push(a.id);
      appData.pendingAchRewards.push(a.id);
      /* 成就解锁后可手动领取金币（pendingAchRewards 标记，成就页点 🎁 领取） */ /* 每点亮一个成就 → 传记记一条（key 用成就 id，天然去重） */ const _ab =
        UIFX.bioText('ach_new', { name: a.name, icon: a.icon });
      if (_ab) {
        _ab.key = 'ach_' + a.id;
        appData.biographies.unshift({
          date: getTodayStr(),
          key: _ab.key,
          title: _ab.title,
          text: _ab.text,
          edited: false
        });
      }
    });
    saveData();
    /* 成就解锁仅显示通知，不发金币（任务图鉴金币走成长图鉴集齐） */ newlyUnlocked.forEach((a, i) => {
      setTimeout(() => {
        UIFX.showRankFeedback('🏅 成就解锁：' + a.name + '！点击成就页可领取奖励');
      }, i * 1500);
    });
  }
}
/* (M4d) getTodayStr 已迁移至 00_pure_core.js（Node 单测同源） */
/* (M4d) fmtTime 已迁移至 00_pure_core.js */
/* ===== 结算 toast 合并 =====
 * 一次番茄会连发好几条 toast（奖励 / 成长 / 段位…），逐条弹会糊成一片，
 * 所以先收集、再合成一张结算卡：
 *   ① 每条延迟 toast 落袋时触达 __settleTouch()，把合并窗口续期到 SETTLE_TOUCH_WINDOW 之后；
 *   ② 同时排一个 SETTLE_DEADLINE_MS 的最迟兜底 timer —— 消息流停了也能出卡。
 * 只有 1 条消息时不必占满屏幕，当普通 toast 飘过即可（见 flushSettleSummary）。
 * collecting 标志在出卡后必须复位。
 */
let _settleFlushTimer = 0;
let _settleDeadlineTimer = 0;
const SETTLE_TOUCH_WINDOW = 1600; /* 覆盖相邻延迟 toast 的最大间隔（成就解锁链 i*1500 递增） */
const SETTLE_DEADLINE_MS = 3500; /* 最迟兜底：对齐历史固定窗口，保证 collecting 必复位 */
function flushSettleSummary() {
  if (!window._settleCollecting) return; /* 幂等：touch 续期与 deadline 兜底都可能触发，只执行一次 */
  window._settleCollecting = false;
  clearTimeout(_settleFlushTimer);
  clearTimeout(_settleDeadlineTimer);
  const _msgs = window._settleMsgs || [];
  window._settleMsgs = [];
  /* 摘要首行（可选）：浓缩本番茄的时长与难度档；仅在有其它播报项时附带，不重复奖励明细。
     digest 上下文在 savePomodoroRecord 开头固化进 _settleCtx，避免 flush 时
     timerState 已被后续结算/自动休息覆盖而取错值（连做番茄的防串保证之一）。 */
  const _ctx = window._settleCtx || {};
  let _digest = null;
  if ((_ctx.type === 'full' || _ctx.type === 'half') && _msgs.length) {
    const _secAll = Math.max(0, Math.floor(_ctx.effectiveSeconds || 0));
    const _durMin = Math.floor(_secAll / 60);
    const _durSec = _secAll % 60;
    const _dCfg = getDifficultyCfg(_ctx.difficulty || 'medium');
    /* 有零头秒时展示「22 分 30 秒」，避免四舍五入成整分后被误读为「计时不准」 */
    _digest = '⏱ 专注 ' + _durMin + ' 分' + (_durSec ? ' ' + _durSec + ' 秒' : '') + ' · ' + _dCfg.name;
  }
  /* 只有 1 条消息时不值得占满屏幕弹张卡片：那条当作普通 toast 飘一下即可。
     卡片是给「这次结算东西很多」用的；每完成一个番茄都拦一下，反而不地道。
     0 条消息则本就无事可报，直接收工。 */
  if (_msgs.length < 2) {
    if (_msgs.length === 1) UIFX.toast(_msgs[0]);
    return;
  }
  UIFX.showSettleSummary(_msgs, _digest);
}
function settleTouch() {
  if (!window._settleCollecting) return;
  clearTimeout(_settleFlushTimer);
  _settleFlushTimer = setTimeout(flushSettleSummary, SETTLE_TOUCH_WINDOW);
}
/* ── 实际时段：**多段**记录 ─────────────────────────────────────────────
   只存 actualStart / actualEnd 两个点是不够的：一个任务 9:00 开、中途去干别的、11:00 勾完成，
   那样「离开的那段」也会被算成在做这个任务，网格里就画出一条 9:00–11:00 的假色块。
   现在按「这一段真的在计时」来记：计时开跑开一段，暂停 / 打断 / 换任务 / 到点就收一段，
   回来接着做就是**新的一段**（两段之间留白 = 这段时间去干别的了）。
   段存 { s, e }（毫秒时间戳；e === 0 表示这段还开着）。
   兼容：actualStart（首次开始，列表 / 快照仍在读）继续写；actualEnd 仍由勾选完成时维护。 */
function tbTodoOf(todoId) {
  if (!todoId) return null;
  return (appData.todos || []).find(function (x) {
    return x && idEq(x.id, todoId);
  }) || null;
}
/* ── 一次计时 = 一条记录（唯一账本）──────────────────────────────────────────
   旧模型（已废）：一次计时被记到**两个地方** ——
     ① 计划身上的 actualSegs：按下「开始计时」就盖（好让网格上的块实时长出来）；
     ② 日志里的 record：结算那一刻才落。
   网格把两者求并集来画，于是"删了记录，日程里的色块还在"这类失联永远可能发生：
   段与记录之间没有身份，只能靠时间戳猜关系，猜不中就留下孤儿

   新模型：一次计时 = **一条记录**，从「开始计时」那一刻就出生、当场拿到 id，
   结算只是把这条记录补全并挪进 records。专注段（segs）就存在记录自己身上 ——
   删记录 = 整件事一起消失，**结构上不可能留下孤儿**。
   进行中的那条放在 appData.liveSessions（不混进 records），
   这样统计 / 积分 / 金币全都只看 records，不必到处过滤"还没结算的"。 */
function liveSessionOf(todoId) {
  const arr = Array.isArray(appData.liveSessions) ? appData.liveSessions : null;
  if (!arr) return null;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && idEq(arr[i].todoId, todoId)) return arr[i];
  }
  return null;
}
/* 取（没有就建）这个计划的进行中会话。id 在这里就定下，结算时原样沿用为记录 id。
   ★ id 取**这一段计时的起点**（actualStart 已经是"第一次开始计时"那一刻），
     不用调用当下的 Date.now() —— 否则"会话 id / 段起点 / 记录起点"会差几十毫秒，
     一个本来该唯一的东西变成三个近似值，正是旧账本留下的毛病。 */
function liveSessionEnsure(todoId) {
  const t = tbTodoOf(todoId);
  if (!t) return null;
  if (!Array.isArray(appData.liveSessions)) appData.liveSessions = [];
  let ls = liveSessionOf(t.id);
  if (!ls) {
    const start = Number(t.actualStart) || Date.now();
    ls = { id: start, todoId: t.id, startTime: start, segs: [] };
    appData.liveSessions.push(ls);
  }
  return ls;
}
/* 进行中会话的段落数组（没有会话就地建一个） */
function liveSessionSegs(todoId) {
  const ls = liveSessionEnsure(todoId);
  if (!ls) return null;
  if (!Array.isArray(ls.segs)) ls.segs = [];
  return ls.segs;
}
/* 启动扫尾：把"没有任何计时在跑"却还开着的段落收掉。
   【为什么必须有】段落只在两处被收：计时停下（stopTimerLoop）和结算落库。
   App 被系统杀死时这两处都没机会跑，于是段落在数据里永远是 e=0 ——
   计划卡写「进行中」、日程色块从那一刻一直画到"现在"（还越长越长），
   而记录根本不存在。启动时能确定的只有一件事：**现在没有计时在跑，这段就是断的**。
   结束时刻的取法（按可信度从高到低）：快照里排定的 endAt → 记录里同起点的那条 → 段起点本身（无证据即零长度）。
   宁可按零长度收掉，也不能让它继续"现在进行中"地长下去。 */
function closeStaleLiveSessions() {
  const arr = Array.isArray(appData.liveSessions) ? appData.liveSessions : [];
  if (!arr.length) return;
  const active = (timerState && timerState.running && timerState.linkedTodoId) ? timerState.linkedTodoId : null;
  const snap = appData.timerSnapshot || null;
  const snapEnd = snap && snap.endAt ? Number(snap.endAt) : 0;
  const snapTodo = snap ? snap.linkedTodoId : null;
  const pf = appData.pendingFinish || null;
  const pfEnd = pf && pf.endedAt ? Number(pf.endedAt) : 0;
  let closed = 0;
  arr.forEach(function (ls) {
    if (!ls || !Array.isArray(ls.segs)) return;
    if (active !== null && idEq(ls.todoId, active)) return; /* 真在跑的那一条不动 */
    const recs = Array.isArray(appData.records) ? appData.records : [];
    ls.segs.forEach(function (sg) {
      if (!sg || !Number(sg.s) || Number(sg.e)) return;
      let end = 0;
      /* 待结算的番茄：结束时刻就是快照里那一颗的 endedAt（已结算过但记录还没落） */
      if (pfEnd && pf.todoId != null && idEq(pf.todoId, ls.todoId)) end = pfEnd;
      if (!end && snapEnd && snapTodo !== null && idEq(snapTodo, ls.todoId)) end = snapEnd;
      if (!end) {
        for (let i = 0; i < recs.length; i++) {
          const r = recs[i];
          if (r && idEq(r.todoId, ls.todoId) && Math.abs((Number(r.startTime) || 0) - Number(sg.s)) <= 60000) {
            end = Number(r.endTime) || 0;
            break;
          }
        }
      }
      if (!end) end = Number(sg.s); /* 没有任何证据 → 零长度，后面会整段丢弃 */
      sg.e = Math.max(Number(sg.s), end);
      closed++;
    });
  });
  /* 收完发现整条会话都是空的（所有段都被压成零长度）→ 连会话一起丢掉。
     ★ 正在跑的那条除外：它本来就该是「开着」的（e=0），不能因为"没有结束时刻"被扫掉。 */
  appData.liveSessions = arr.filter(function (ls) {
    if (!ls || !Array.isArray(ls.segs)) return false;
    if (active !== null && idEq(ls.todoId, active)) return true;
    return ls.segs.some(function (sg) { return sg && Number(sg.s) && Number(sg.e) > Number(sg.s); });
  });
  if (closed) {
    tbInvalidateSegIndex();
    try { saveDataNow(); } catch (e) { if (window.__silent) window.__silent(e, '01d:closeStaleLiveSessions'); }
  }
}
function dropLiveSession(todoId) {
  if (!Array.isArray(appData.liveSessions)) return;
  appData.liveSessions = appData.liveSessions.filter(function (ls) {
    return !(ls && idEq(ls.todoId, todoId));
  });
}
/* 一次性迁移：把旧模型里挂在计划身上的 actualSegs 归位到记录上，再删掉那份副本。
   认亲靠起点容差；认不出的 = 记录已被删掉的孤儿段 → 丢弃并计数。
   标记落在 __migration.runs 里（kind:'segLedgerV2'）—— 是一次性迁移，不是常驻清理规则。 */
const SEG_MIGRATE_TOL_MS = 60 * 1000;
function migrateSegLedger() {
  /* 用迁移日志本身当"跑过了"的标记 —— 少一个长期躺在数据里的一次性标志位 */
  if (!appData.__migration) appData.__migration = { runs: [] };
  if (!Array.isArray(appData.__migration.runs)) appData.__migration.runs = [];
  if (appData.__migration.runs.some(function (x) { return x && x.kind === 'segLedgerV2'; })) return;
  let attached = 0, dropped = 0, sessions = 0;
  const recs = Array.isArray(appData.records) ? appData.records : [];
  /* ① 给还没有 segs 的记录补上（老记录只有起止，退化成单段） */
  recs.forEach(function (r) {
    if (!r) return;
    if (!Array.isArray(r.segs) || !r.segs.length) {
      if (Number(r.startTime)) r.segs = [{ s: Number(r.startTime), e: Number(r.endTime) || Number(r.startTime) }];
      /* 迁移会就地补 segs：结尾统一 tbInvalidateSegIndex()，见 migrateSegLedger 末尾 */
    }
  });
  /* 有没有"还挂在这个计划上、尚未结算"的计时？有的话它的段不该被当孤儿丢掉。
     ★ 判据要用「快照还指着这个计划」而不是「timerState.running」——
       暂停中（paused）也照样是"没结算"的会话，只判 running 会把暂停中的段误删。 */
  const _live = function (todoId) {
    const pf = appData.pendingFinish;
    if (pf && pf.todoId != null && idEq(pf.todoId, todoId)) return true;
    const snap = appData.timerSnapshot;
    if (snap && snap.linkedTodoId != null && idEq(snap.linkedTodoId, todoId)
      && (snap.mode === 'focus' || snap.mode === 'free')) return true;
    return false;
  };
  (appData.todos || []).forEach(function (t) {
    if (!t) return;
    if (!Array.isArray(t.actualSegs) || !t.actualSegs.length) { delete t.actualSegs; return; }
    if (_live(t.id)) {
      /* 会话还在进行：整段落进 liveSessions，等结算时自然变成那条记录 */
      if (!Array.isArray(appData.liveSessions)) appData.liveSessions = [];
      const _ls = liveSessionOf(t.id);
      const _st = Number(t.actualStart) || Number(t.actualSegs[0].s) || Date.now();
      if (_ls) { _ls.segs = t.actualSegs.slice(); } else {
        appData.liveSessions.push({ id: _st, todoId: t.id, startTime: _st, segs: t.actualSegs.slice() });
        sessions++;
      }
      delete t.actualSegs;
      return;
    }
    t.actualSegs.forEach(function (sg) {
      const s = Number(sg && sg.s) || 0;
      const e = Number(sg && sg.e) || 0;
      if (!s) { dropped++; return; }
      let hit = null, best = SEG_MIGRATE_TOL_MS;
      recs.forEach(function (r) {
        if (!r || r.todoId == null || !idEq(r.todoId, t.id)) return;
        const d = Math.abs((Number(r.startTime) || 0) - s);
        if (d <= best) { best = d; hit = r; }
      });
      if (hit) {
        if (!Array.isArray(hit.segs)) hit.segs = [];
        const dup = hit.segs.some(function (x) { return Math.abs((Number(x.s) || 0) - s) <= SEG_MIGRATE_TOL_MS; });
        if (!dup) hit.segs.push({ s: s, e: e });
        attached++;
      } else {
        /* 认不出主人：多半是记录已被删掉的孤儿段 → 丢弃 */
        dropped++;
      }
    });
    delete t.actualSegs;
  });
  try {
    appData.__migration.runs.push({
      at: Date.now(), kind: 'segLedgerV2',
      attached: attached, dropped: dropped, sessions: sessions
    });
  } catch (e) { if (window.__silent) window.__silent(e, '01d:migrateSegLedger'); }
  tbInvalidateSegIndex(); /* 迁移就地改过 records[].segs（长度可能没变）→ 索引作废 */
}
/* 一次性迁移：记录里的段落必须落在记录自己的起止之间。
   5:18 开始、5:43 到点，人 6:01 才回到 App：
   记录写的是 5:18~5:43（25 分钟），段落却被"收段那一刻"(Date.now()) 写成 6:01 ——
   于是计划卡「✅ 5:18~6:01」配着「25 分钟」、日程色块撑成 43 分钟、日志卡 25 分钟，三个页面三套数字。
   源头已在 01c（收段按归零时刻）+ 落库（consumeLiveSessionForRecord 收口）两处堵住，
   这里只负责把**已经写坏的历史记录**改回来；改完自我标记，不再重跑。 */
function migrateSegClampV1() {
  if (!appData.__migration) appData.__migration = { runs: [] };
  if (!Array.isArray(appData.__migration.runs)) appData.__migration.runs = [];
  if (appData.__migration.runs.some(function (x) { return x && x.kind === 'segClampV1'; })) return;
  let clamped = 0, closed = 0, dropped = 0, touched = 0;
  (Array.isArray(appData.records) ? appData.records : []).forEach(function (r) {
    if (!r || !Array.isArray(r.segs) || !r.segs.length) return;
    const end = Number(r.endTime) || 0;
    if (!end) return;
    let dirty = false;
    const out = [];
    r.segs.forEach(function (sg) {
      if (!sg || !Number(sg.s)) return;
      const s = Number(sg.s);
      let e = Number(sg.e) || 0;
      if (!e) { e = end; closed++; dirty = true; }          /* 开着的 → 按记录结束收口 */
      else if (e > end) { e = end; clamped++; dirty = true; } /* 越界的 → 裁回记录结束 */
      if (e > s) out.push({ s: s, e: e }); else { dropped++; dirty = true; }
    });
    if (dirty) { r.segs = out; touched++; }
  });
  try {
    appData.__migration.runs.push({
      at: Date.now(), kind: 'segClampV1',
      records: touched, clamped: clamped, closed: closed, dropped: dropped
    });
  } catch (e) { if (window.__silent) window.__silent(e, '01d:migrateSegClampV1'); }
  tbInvalidateSegIndex();
  if (touched) {
    try { saveDataNow(); } catch (e) { if (window.__silent) window.__silent(e, '01d:migrateSegClampV1'); }
  }
}
function openTodoActualSeg(todoId) {
  const t = tbTodoOf(todoId);
  if (!t) return;
  const now = Date.now();
  if (!t.actualStart) t.actualStart = now;
  const segs = liveSessionSegs(t.id);
  if (!segs) return;
  const last = segs.length ? segs[segs.length - 1] : null;
  /* 已有关着的最后一段、且间隔很短（< 2 分钟）→ 直接"续上"它，不再切一段。
     为什么要有这一步：暂停后马上又点继续、或 startTimerLoop 内部的
     stop→start 幂等收尾，都会在同一刻各碰一次开关；不合并就会被切成一堆几秒的碎段。 */
  if (last && last.e && now - last.e < 2 * 60 * 1000) {
    last.e = 0;
  } else if (last && !last.e) {
    /* 已经有一段开着 → 不动（幂等，防重复调用开两段） */
  } else {
    segs.push({ s: now, e: 0 });
  }
  try {
    saveData();
  } catch (e) {
    if (window.__silent) window.__silent(e, '01d:openTodoActualSeg');
  }
}
/* 收掉当前开着的那段（暂停 / 打断 / 到点 / 换任务 / 退出）。
   ★ 每支都必须写全：这里没有"另一边会顺手补上"的假设 —— 收尾只有这一个入口。 */
function closeTodoActualSeg(todoId, endMs) {
  const t = tbTodoOf(todoId);
  const segs = t ? liveSessionSegs(t.id) : null;
  if (!t || !segs || !segs.length) return;
  const last = segs[segs.length - 1];
  if (!last || last.e) return;
  const end = Number(endMs) || Date.now();
  if (end <= last.s) {
    /* 退化成零点段（同一毫秒内开了又收）→ 直接丢掉，别留垃圾 */
    segs.pop();
  } else {
    last.e = end;
  }
  /* ★ 这里**不写** actualEnd：它的口径是「勾选完成的那一刻」，
     暂停 / 打断时写进去会把色块在暂停处截断 —— 那不是完成。 */
  try {
    saveData();
  } catch (e) {
    if (window.__silent) window.__silent(e, '01d:closeTodoActualSeg');
  }
}
/* 旧名保留：01c 的 startPomodoroCore 仍在调它（第一次开番茄 = 实际开始） */
function stampTodoActualStart(todoId) {
  openTodoActualSeg(todoId);
}
/* ── 实际时段的唯一来源：记录（+ 进行中的会话）──────────────────────────────
   旧模型（已废）把一次计时记到**两处**：计划身上的 actualSegs（一按开始就盖）+ 一条 record
   （结算才落），再由网格取并集绘制。两个账本之间没有身份，只能靠时间戳猜关系 ——
   于是"删了记录，日程里的色块还在、计划卡还写着 3 段"永远可能发生。
   新模型：**段落只活在记录里**。进行中的那次计时先住在 appData.liveSessions
   （= 同一条记录的待结算形态，id 在"开始计时"那刻就定下），结算时整段搬进记录、会话消失。
   删记录 = 段落随记录一起消失，**结构上不可能留下孤儿**。
   tbTodoSegList 是 计划卡 / 日程网格 取「这条计划做过哪些段」的唯一入口。 */
