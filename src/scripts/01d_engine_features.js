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
 * 函数索引（TOC）：getAchievements/checkNewAchievements/flushSettleSummary/settleTouch/tbTodoOf/liveSessionOf/liveSessionEnsure/liveSessionSegs/closeStaleLiveSessions/dropLiveSession/migrateSegLedger/migrateSegClampV1（+130 更多）
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
function checkNewAchievements() {
  if (!appData.unlockedAchievements) appData.unlockedAchievements = [];
  if (!Array.isArray(appData.pendingAchRewards)) appData.pendingAchRewards = [];
  const achievements = getAchievements();
  const newlyUnlocked = achievements.filter(a => a.unlocked && !appData.unlockedAchievements.includes(a.id));
  if (newlyUnlocked.length > 0) {
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
/* ============================================================
 * 「这条记录属于哪条计划」——**名字不是身份**
 * ============================================================
 * 一类 bug：前几天做过一条「收拾屋子」的专注，今天**新建**一条同名计划，
 * 新计划卡上立刻挂出那天的「✅ 5 段 · 共 132 分 / ⏰ 15:15~15:42 / ⏳ 搁置 7 天」。
 * 病根是「按标题找身份」：同名 ≠ 同一条计划。老记录（todoId 为空）按标题认领时
 * 既不限日期、也不查是否唯一，于是任何一条同名新计划都会把全库同名记录捡走。
 *
 * 现在的准入条件（三条缺一不可），这就是「按名字说话」唯一允许的场合：
 *   ① 有明确的那一天（dateStr）—— 没有日期就没有边界，一律不认；
 *   ② 这段落就落在那一天（按段落起点日期判，跨零点的段落自然归前一天）；
 *   ③ 全库同标题的计划**只有一条** —— 两条同名时谁都别认，否则一段记录被算两次。
 * ★ 宁可认不出来（显示成未计划块），也不要认错：认错会污染计划账、搁置天数、
 *   日程网格三处显示，而且用户完全无从发现。
 */
function tbNormTitle(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
/* 全库同标题（规范化后）计划条数 —— 唯一性判定的单一来源 */
function tbTodoTitleCount(title) {
  const want = tbNormTitle(title);
  if (!want) return 0;
  let n = 0;
  (appData.todos || []).forEach(function (x) {
    if (x && tbNormTitle(x.title) === want) n++;
  });
  return n;
}
/* 计划的创建时刻 —— 计划 id 就是 `Date.now()`（见 01eC 的 addTodo）。
   ★ 这是"名字能不能认亲"的关键边界：**一段专注不可能发生在计划创建之前**。
     这类 bug 的本质就在这里 —— 7 天前的「收拾屋子」被今天新建的同名计划捡走，
     而那天的记录早于今天这条计划的出生时刻。只看名字、不看时间，就必然捡错。
   非时间戳形态的 id（历史数据/手工造的数）一律返回 null = 出生时刻未知（保守：不认亲）。 */
function tbTodoCreatedAt(t) {
  const n = Number(t && t.id);
  if (!isFinite(n)) return null;
  if (n < 1.4e12 || n > Date.now() + 86400000) return null; /* 2014 之前 / 未来一天以后：不是创建时刻 */
  return n;
}
/* 老记录（没有 todoId）能否按标题认亲到这条计划 —— **只给一次性迁移用**
   （见下面的 migrateRecordOwnership）。★ 读路径不得再调用它：
   按名字找主人正是「今天新建一条同名计划，把几天前的旧账捡走」的来源。
   四条准入：标题一致 + 全库标题唯一 + 不是补记(log) + 记录不早于计划创建。
   最后一条由 tbLegacyNameClaimAllowed 的调用方（迁移）传入 createdAt 判定，
   这里做统一兜底，任何一处漏传都退化成"不认"。 */
function tbLegacyNameClaimAllowed(r, t, createdAt) {
  if (!r || !t || r.type === 'log') return false;
  const title = tbNormTitle(t.title);
  if (!title || tbNormTitle(r.taskName) !== title) return false;
  if (tbTodoTitleCount(title) !== 1) return false; /* 同名多条 → 身份不明，不认 */
  if (createdAt == null) createdAt = tbTodoCreatedAt(t);
  if (createdAt == null) return false; /* 出生时刻不明 → 不猜 */
  if (Number(r.startTime) < createdAt) return false; /* 计划还没出生时的事，不可能是它的 */
  return true;
}
/* 写时把「手输的任务名」落到计划上：**只在全库标题唯一、且计划那时已经存在时**才关联。
   两条同名计划时分不清是哪一条 —— 宁可不关联（这条记录就记成未计划），也不记到别人账上。
   这是"输入解析"而不是"身份判定"：只发生一次（落库那一刻），之后归属只看 id。 */
function tbResolveTodoByTitle(title, startTime) {
  const want = tbNormTitle(title);
  if (!want) return null;
  const hits = (appData.todos || []).filter(function (x) {
    return x && tbNormTitle(x.title) === want;
  });
  if (hits.length !== 1) return null;
  /* 有起点就查出生时刻（同一把尺子，别再写第二套判断） */
  if (startTime != null) {
    const created = tbTodoCreatedAt(hits[0]);
    if (created == null || Number(startTime) < created) return null;
  }
  return hits[0];
}
/* 一次性迁移：把"老记录按任务名认亲"从**读路径**搬到启动时跑一次。
   ★ 学 super-productivity 的做法：记录的归属永远是计划 id，名字只用来显示。
     人家那边时长是任务自己的字段（task.timeSpentOnDay[日期]），写入按 id，
     全仓没有一处"按标题找任务"；我们这边是独立流水，老数据只存了 taskName，
     于是每到一处读取都要拿名字反查 —— 这就是「今天新建一条同名计划，
     把几天前同名的自由专注捡走」的来源（实测：⏰ 3:15~3:40 / 5 段 / 搁置 7 天）。
   能认的（当天 + 全库标题唯一）在这里把 todoId 补上并落盘，一次了结；
   认不出的一律保持 todoId = null（= 计划外专注）。从此读路径只认 id。 */
function migrateRecordOwnership() {
  if (!appData.__migration) appData.__migration = { runs: [] };
  if (!Array.isArray(appData.__migration.runs)) appData.__migration.runs = [];
  /* 用迁移日志本身当"跑过了"的标记（与 migrateSegLedger 同一套做法） */
  if (appData.__migration.runs.some(function (x) { return x && x.kind === 'recordOwnerV1'; })) return;
  let claimed = 0, planned = 0, orphans = 0;
  (Array.isArray(appData.records) ? appData.records : []).forEach(function (r) {
    if (!r || r.startTime == null) return;
    if (r.todoId != null) { planned++; return; } /* 已有身份，不动 */
    if (r.type === 'log') { orphans++; return; } /* 补记不对应任何计划 */
    /* 名字 + 唯一 + 出生时刻，三条一起判（tbLegacyNameClaimAllowed 单一来源） */
    const t = tbResolveTodoByTitle(r.taskName);
    if (t && tbLegacyNameClaimAllowed(r, t)) { r.todoId = t.id; claimed++; }
    else orphans++;
  });
  appData.__migration.runs.push({
    at: Date.now(), kind: 'recordOwnerV1', claimed: claimed, planned: planned, orphans: orphans
  });
  /* claimed 为 0 不落盘：没改任何东西就不写存储（空结果守卫，与保留中心同一条规矩） */
  if (claimed) { try { saveDataNow(); } catch (e) { if (window.__silent) window.__silent(e, '01d:migrateRecordOwnership'); } }
}
/* ---------------- 段落索引 ----------------
 * 问题：tbTodoSegList 原来每次都把**全部** records 扫一遍。待办页有 N 条计划就扫 N 遍，
 *   实测 6000 条记录 / 150 条计划时 renderTodos 要 536ms、统计页 1160ms ——
 *   这正是「多年使用就卡」的真正原因（不是数据长得不对，是取数形状不对）。
 * 做法（学 super-productivity 的取数形状，不是数据形状）：一次遍历建 Map<todoId, 段[]>
 *   + Map<'YYYY-MM-DD', 段[]>，之后按 id / 按天 O(1) 取桶，只在桶内再筛。
 * 失效：写入点显式调 tbInvalidateSegIndex()；另外用「数组身份 + 长度 + 版本号」三重校验，
 *   数据被整体替换（导入 / 恢复 / 回滚）时身份变了自动重建 —— **不会读到陈旧数据**。
 * ★ 索引只是缓存，唯一真相仍是 appData.records：取不到索引就重扫，结果必须与直扫逐项相同
 *   （tools/tests/c71_seg_index.js 用随机数据对拍，保证"加速"没改变语义）。 */
let _tbSegIdxVer = 0;
let _tbSegIdxCache = null;
function tbInvalidateSegIndex() { _tbSegIdxVer++; }
function tbSegIndex() {
  const arr = Array.isArray(appData.records) ? appData.records : [];
  const c = _tbSegIdxCache;
  if (c && c.arr === arr && c.len === arr.length && c.ver === _tbSegIdxVer) return c;
  const byTodo = Object.create(null);
  const byDay = Object.create(null);
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (!r || r.startTime == null) continue;
    const segs = (Array.isArray(r.segs) && r.segs.length)
      ? r.segs
      : [{ s: Number(r.startTime), e: Number(r.endTime) || 0 }];
    for (let j = 0; j < segs.length; j++) {
      const sg = segs[j];
      if (!sg || !Number(sg.s)) continue;
      /* ★ 段上带「出处」：recId 指向它所属的记录，authMs 是那条记录的**权威时长**。
         日程色块的长度要认这个数（区间只管画在哪），见 01eA tbActualOf。 */
      const _authSec = Number(r.effectiveSeconds) > 0
        ? Number(r.effectiveSeconds)
        : (Number(r.endTime) && Number(r.startTime) ? Math.max(0, Number(r.endTime) - Number(r.startTime)) / 1000 : 0);
      const seg = { s: Number(sg.s), e: Number(sg.e) || 0, recId: r.id == null ? null : r.id, authMs: _authSec * 1000 };
      const day = getDateStr(new Date(seg.s));
      if (r.todoId != null) {
        const k = String(r.todoId);
        (byTodo[k] || (byTodo[k] = [])).push(seg);
      }
      (byDay[day] || (byDay[day] = [])).push({ todoId: r.todoId, seg: seg });
    }
  }
  for (const k in byTodo) byTodo[k].sort(function (a, b) { return a.s - b.s; });
  _tbSegIdxCache = { arr: arr, len: arr.length, ver: _tbSegIdxVer, byTodo: byTodo, byDay: byDay };
  return _tbSegIdxCache;
}
/* ★ 时长与区间解耦
   sp 的做法：时长是 timeSpentOnDay[date] 逐秒累加的独立数字（task.reducer.ts），
   而 workStart/workEnd 只是"那天大概从几点干到几点"的**参考范围** —— 它在 reducer 里
   随手写 e: Date.now()，因为范围歪了时长一点都不受影响。
   我们此前的"共 X 分"是 Σ(段.e - 段.s)，区间一歪时长立刻跟着歪（43 分的来源）。
   这里把时长改成只认记录的权威值 effectiveSeconds（缺则 endTime-startTime），
   段（segs）只负责"画在哪、分几次"。区间再怎么被收口/裁切，都不再动到统计。

   dateStr 省略 = 不限日期；跨零点的一条记录按"当天的段占总时长的比例"折算。 */
function tbTodoFocusMs(t, dateStr, nowMs) {
  if (!t || t.id == null) return 0;
  const arr = Array.isArray(appData.records) ? appData.records : [];
  let ms = 0;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (!r || r.todoId == null || String(r.todoId) !== String(t.id)) continue;
    const segs = (Array.isArray(r.segs) && r.segs.length)
      ? r.segs
      : [{ s: Number(r.startTime) || 0, e: Number(r.endTime) || 0 }];
    /* 权威时长：落库时就算好的那个数（与日志页同一口径） */
    let authMs = 0;
    const sec = Number(r.effectiveSeconds);
    if (isFinite(sec) && sec > 0) authMs = sec * 1000;
    else if (Number(r.endTime) && Number(r.startTime)) authMs = Math.max(0, Number(r.endTime) - Number(r.startTime));
    if (!dateStr) { ms += authMs; continue; }
    /* 指定某天：按当天段落占全段的比例切一份（跨零点不至于整天或半天空着） */
    let total = 0, inDay = 0;
    for (let j = 0; j < segs.length; j++) {
      const sg = segs[j];
      if (!sg || !Number(sg.s)) continue;
      const d = Math.max(0, (Number(sg.e) || 0) - Number(sg.s));
      total += d;
      if (getDateStr(new Date(Number(sg.s))) === dateStr) inDay += d;
    }
    if (!inDay) continue;
    const share = total > 0 ? (inDay / total) : 1;
    ms += authMs * share;
  }
  /* 正在计时的那条还没落库，只能按区间补（这一段本来就是"到现在为止"） */
  const ls = liveSessionOf(t.id);
  (ls && Array.isArray(ls.segs) ? ls.segs : []).forEach(function (sg) {
    if (!sg || !Number(sg.s)) return;
    if (dateStr && getDateStr(new Date(Number(sg.s))) !== dateStr) return;
    const e = Number(sg.e) || Number(nowMs) || Date.now();
    ms += Math.max(0, e - Number(sg.s));
  });
  return ms;
}
function tbTodoSegList(t, dateStr, excludeLive) {
  if (!t) return [];
  const out = [];
  /* 归属只看 todoId（权威身份）。没挂 id 的记录 = 计划外专注，**不按名字去猜**
     —— 名字不是身份；老数据里能认的在启动时已由 migrateRecordOwnership 补挂。 */
  const bucket = tbSegIndex().byTodo[String(t.id)];
  if (bucket) {
    for (let i = 0; i < bucket.length; i++) {
      const sg = bucket[i];
      if (dateStr && getDateStr(new Date(sg.s)) !== dateStr) continue;
      out.push({ s: sg.s, e: sg.e, recId: sg.recId, authMs: sg.authMs || 0 });
    }
  }
  if (!excludeLive) {
    const ls = liveSessionOf(t.id);
    (ls && Array.isArray(ls.segs) ? ls.segs : []).forEach(function (sg) {
      if (!sg || !Number(sg.s)) return;
      if (dateStr && getDateStr(new Date(Number(sg.s))) !== dateStr) return;
      /* 进行中会话还没落库，没有权威时长 —— 长度只能按区间画，这是"正在做"的语义 */
      out.push({ s: Number(sg.s), e: Number(sg.e) || 0, recId: null, authMs: 0 });
    });
  }
  out.sort(function (a, b) { return a.s - b.s; });
  return out;
}
/* 结算：把进行中会话的段落交给记录，会话随之消失（一次计时至此只剩记录这一份账本）。
   ★ 段落**搬**过去而不是复制：搬完 liveSessions 里就没有了，同一个事实只有一处存放。 */
function consumeLiveSessionForRecord(rec, todoId) {
  if (!rec || !todoId) return;
  const ls = liveSessionOf(todoId);
  if (!ls) return;
  if (Array.isArray(ls.segs) && ls.segs.length) {
    if (!Array.isArray(rec.segs) || !rec.segs.length) {
      /* ★ 落库这一刻是段落与记录的**最后一次对齐机会**，也是唯一一次有机会对齐：
         之后段落只活在记录里（计划身上没有第二份），错了就再也没有第二个地方能纠正。
         所以在这里做两件收口的事：
         ① 还开着的段（e=0）→ 结束 = 这条记录的结束时刻。
            典型成因：App 在专注中途被杀，段落停在"开着"；或 tick 被节流，
            到点那一刻根本没跑到 stopTimerLoop。不收口它就是永远「进行中」——
            计划卡写「5:18~进行中」、日程色块长到今天，而日志卡明明有准确收尾。
         ② 段结束越过记录结束 → 裁到记录结束。同一件事的两个数字不许互相矛盾：
            「✅ 5:18~6:01」配上「25 分钟」正是没做这一步的样子。 */
      const _end = Number(rec.endTime) || 0;
      const _clean = [];
      ls.segs.forEach(function (sg) {
        if (!sg || !Number(sg.s)) return;
        const s = Number(sg.s);
        let e = Number(sg.e) || 0;
        if (!e) e = _end || Date.now();
        if (_end && e > _end) e = _end;
        if (e > s) _clean.push({ s: s, e: e }); /* 退化成零长度 = 没有这件事，别留垃圾 */
      });
      if (_clean.length) {
        rec.segs = _clean;
        tbInvalidateSegIndex(); /* 记录的段落被就地改写（长度没变），必须显式失效 */
      }
    }
  }
  dropLiveSession(todoId);
}

/* 跨模块可变绑定的唯一写入口 */
function __setMustDoEditDate(v) { _mustDoEditDate = v; }
function savePomodoroRecord(type) {
  /* 自由专注：把弹窗里选定的真实时长喂给记录逻辑 */
  if (timerState.finishSource === 'free' && freeSettleSecs) {
    timerState.effectiveSeconds = freeSettleSecs;
    if (window._settleCtx && typeof window._settleCtx === 'object') window._settleCtx.effectiveSeconds = freeSettleSecs;
    bumpFreeStats(freeSettleSecs, (timerState && timerState.taskName) || '');
    freeSettleSecs = null;
  }
  if (type === 'full') {
    /* 完整番茄落库的触感确认（仅 full；half/打断不扰） */
    try { UIFX.fxVibrate(30); } catch (e) { if (window.__silent) window.__silent(e, '01d:savePomodoroRecord'); }
  }
  /* 开启结算收集 — 本次番茄触发的所有 toast 先收进数组，稍后合并为一条汇总 */
  window._settleMsgs = [];
  window._settleCollecting = true;
  /* R 清掉上一轮结算可能残留的 flush/deadline timer（连做两个番茄防串），
     并固化本轮 digest 上下文（flush 时 timerState 可能已被下一轮覆盖） */
  clearTimeout(_settleFlushTimer);
  clearTimeout(_settleDeadlineTimer);
  window._settleCtx = {
    type: type,
    effectiveSeconds: timerState.effectiveSeconds || 0,
    difficulty: timerState.difficulty || appData.settings.difficulty || 'medium'
  };
  window.__settleTouch = settleTouch;
  const energy = UIFX.getGridValue('finishEnergyPicker');
  const mood = UIFX.getGridValue('finishMoodPicker');
  const note = document.getElementById('finishNote').value.trim();
  /* 关联计划解析：优先当前选中的计划（id 权威）；
     手动输入任务名时按「规范化标题」找 —— **必须唯一**：库里两条同名计划时谁都别认，
     否则这个番茄会被记到上周那条同名计划头上（账是错的，而界面上看不出来）。
     ★ 原来这里 find() 取第一个匹配，同名就一定认错。 */
  let lt = timerState.linkedTodoId ? appData.todos.find(x => x.id === timerState.linkedTodoId) : null;
  if (!lt && timerState.taskName) {
    /* 手输名字 → 落计划：唯一 + 计划那时已存在（见 tbResolveTodoByTitle / tbTodoCreatedAt） */
    lt = tbResolveTodoByTitle(timerState.taskName, timerState.startTime);
  }
  /* 结束备注只属于这一次记录（record.note），不回写计划详情（t.detail）。
     计划详情是计划自己的说明，只在计划编辑面板里改；否则重复计划每完成一次
     就被上一轮的感受覆盖，攒几轮后原说明彻底找不回来。
     ★ 与「计时页备注框 ↔ 计划详情」的共通不是一回事：那是计划详情的编辑入口，
       这里是单次结算的备注。 */

  /* 🍅 折算番茄数：完整番茄按时长/25 折算（50分钟=2、25分钟=1），半个=0.5，未完成=0 */
  let _pomos = calcPomos(timerState.effectiveSeconds, type);
  /* 轻松模式（关怀）：今天第一个满 10 分钟的番茄按完整番茄计（同等段位积分，今天仅此一次） */
  if (
    type === 'full' &&
    isEasyModeActive() &&
    timerState.effectiveSeconds >= 600 &&
    !appData.rankSystem.easyModeBonusUsed
  ) {
    appData.rankSystem.easyModeBonusUsed = true;
    _pomos = Math.max(_pomos, 1);
  }
  /* 关联计划的实际用番茄计数：按折算数累加（「仅记录」不动任务账） */
  if (lt && type !== 'log') lt.actualPomodoros = (lt.actualPomodoros || 0) + _pomos;
  /* （timeSpent）：关联计划的累计有效专注时长（秒）同步回写，任务级时间账 */
  if (lt && type !== 'log') lt.timeSpent = (lt.timeSpent || 0) + (timerState.effectiveSeconds || 0);
  /* 金币抽奖：按折算数取整（50分钟=2 次，25分钟=1 次，半个=1 次） */
  if (_pomos > 0) addLotteryChance(Math.round(_pomos));
  /* 日志快照：预计番茄=创建记录时任务的预计值；实际番茄=到这条记录为止该任务的累计完成值。
     之后任务再加番茄，不会追溯修改已生成的旧记录（新番茄会写进新记录里）。 */
  /* 点「完成」时正在做的那条子任务（没有就为 null），记录里留痕 */
  const _curSub = lt ? findSubById(lt.subs, timerState.curSubId) : null;
  /* ★ 结束时刻：优先「自然完成的那一刻」——pendingFinish / 自动结算快照把它带进 finishEndedAt
     （见 01c onTimerComplete / restorePendingFinish / restoreTimerSnapshot）。
     取不到才退回现在：手动提前结束、自由专注、补记都属于「结算即结束」，口径不变。
     两道兜底防脏数据：结束不得早于开始、不得晚于现在。 */
  const _nowMs = Date.now();
  let _recEnd = Number(timerState.finishEndedAt) || 0;
  timerState.finishEndedAt = 0; /* 一次结算只消费一次，别漏给下一个番茄 */
  if (_recEnd <= 0 || _recEnd > _nowMs) _recEnd = _nowMs;
  if (Number(timerState.startTime) && _recEnd < Number(timerState.startTime)) _recEnd = _nowMs;
  /* ★ 起点必须与时长自洽：`startTime` 是「最后一次继续」的时刻（每次暂停→继续都会重设），
     而 `effectiveSeconds` 是**累计专注时长**，两者不是同一个量。
     21:17 开始、中途暂停过的那次专注，落库只剩 21:40~21:49 —— 日志写「8 分钟」，
     结算却说「专注 31 分钟」，用户一眼就看穿这是错的（2026-10-29 他正是这么报的：
     「我明明专注了 31 分钟，但是它是 9:40 到 9:49，这不才 10 分钟吗」）。
     口径：结束时刻不动，起点回推成「结束 − 累计专注时长」。
     代价：暂停的那段不落在区间里 —— 它本来也不该算进专注块。 */
  const _effMs = Math.max(0, Number(timerState.effectiveSeconds) || 0) * 1000;
  let _recStart = Number(timerState.startTime) || 0;
  if (_effMs > 0 && _recStart > 0 && _recEnd - _recStart < _effMs) {
    _recStart = Math.max(0, _recEnd - _effMs);
  }
  const record = {
    id: _nowMs,
    /* 数据契约：uid 是同步主键（id 沿用数值，被 200+ 处引用不改）；
       updatedAt 在结算时等于结束时刻，用户之后编辑会由 touchRecord 刷新。 */
    uid: newUid('rec'),
    updatedAt: _recEnd,
    type: type,
    /* 自由专注没有任务名：用备注当标题，免得日志里一条条全是「未命名（点开可补）」 */
    taskName: (timerState.finishSource === 'free') ? (timerState.taskName || note || '自由专注') : timerState.taskName,
    note: note,
    startTime: _recStart,
    endTime: _recEnd,
    effectiveSeconds: timerState.effectiveSeconds,
    pomos: _pomos,
    difficulty: timerState.difficulty || appData.settings.difficulty || 'medium',
    interruptions: timerState.interruptions,
    totalInterruptSeconds: timerState.totalInterruptSeconds,
    startEnergy: timerState.startEnergy,
    startMood: timerState.startMood,
    energy: energy || null,
    mood: mood || null,
    expectedPomodoros: lt ? (lt.pomodoros != null ? lt.pomodoros : null) : null,
    actualPomodoros: lt ? lt.actualPomodoros || 0 : null,
    /* 计划联动快照：记录里带上计划 id / 标签 / 四象限 / 正在做的那条子任务，
       这样专注记录自己能说清「这是哪个计划的哪一步」，不必回头翻计划表 */
    todoId: lt ? lt.id : null,
    tag: lt && lt.tag ? lt.tag : null,
    quad: lt ? normQuad(lt.quad) : null,
    subTitle: _curSub ? _curSub.title : null,
    subId: _curSub ? _curSub.id : null,
    /* 计划名 + 整份子任务快照：回顾/日志要能直接看到「这个计划的哪几步」，
       只有当前那一条子任务不够用（大多数专注并没有先点某一步）。
       快照而非引用 —— 计划日后改了步骤，历史日志不被改写。 */
    planTitle: lt ? (lt.title || null) : null,
    /* 截止时刻 = 这条记录自己的结束时刻，不是「现在」：
       结算窗拖到晚上才点确认、或 App 被杀后第二天恢复，都不会把之后完成的步骤算进来。
       ★ 例外：用户在结算弹窗里亲手补勾过（settleSubsEdited）→ 不做截断。
         那一下的 doneAt 必然晚于 _recEnd，按截断处理就会把他刚勾的步骤判成"没完成"，
         而这正是他要补的那一步。 */
    planSubs: lt
      ? snapshotPlanSubs(lt, (typeof timerState !== 'undefined' && timerState.settleSubsEdited) ? 0 : _recEnd)
      : null
  };
  appData.records.push(record);
  /* 结算弹窗里「补勾子计划」的标记：已经在上面 planSubs 用掉了，到此清零 */
  if (typeof timerState !== 'undefined') timerState.settleSubsEdited = false;
  tbInvalidateSegIndex(); /* 新记录 → 段落索引必须重建（缓存只是加速，不能变陈旧） */
  /* ★ 把进行中会话的段落**搬**进这条记录（见 consumeLiveSessionForRecord）：
     从这一刻起，这次计时的段落只存在于这条记录里 —— 删记录即整件事消失，不留孤儿。 */
  if (lt) consumeLiveSessionForRecord(record, lt.id);
  /* 🪙 时长奖励：走**收益乘数链**（00_pure_core 的 coinEarnFinal = 档位 × 连续加成 × buff）。
     档位与旧实现完全等价：≥86 分钟 → 6；≥48 → 3；≥24 → 1；不足 24 → 0（取最高档、不叠加）。
     ★ 以后调平衡改 COIN_EARN_TUNING 一处（含连续加成步长），不必回来翻这段 if 链；
       新增一类加成 = 链上再加一个乘数项。 */
  const _durSec = timerState.effectiveSeconds || 0;
  const _durCoin = coinEarnFinal({
    minutes: _durSec / 60,
    streakDays: (appData.tree && appData.tree.waterStreak) || 0
  });
  if (_durCoin > 0 && type !== 'log') {
    coinEarn(_durCoin, 'duration', '专注 ' + Math.floor(_durSec / 60) + ' 分钟时长奖励', { recordId: record.id });
    setTimeout(function () {
      UIFX.toast('🪙 时长奖励 +' + _durCoin + ' 金币（专注 ' + Math.floor(_durSec / 60) + ' 分钟）');
    }, 700);
  }
  if (type === 'full') {
    /* 计数不在这里累加：本轮统计一律由记录现算（computeRoundStats），
       否则删日志 / 改类型 / 导入备份后数字会对不上 */
    /* 结算链加固：树成长/习惯联动/沉浸式/长休/疲劳提示等副作用独立 try，
       任一环节异常只跳过自身，不阻断记录保存与后续结算
       @see ARCHITECTURE-DECISIONS.md #10（错误分级上报 + 局部隔离） */
    try {
      addTreePoints(_pomos);
      /* 金币按树成长自然发放积分转金币，见 addTreePoints） */
      const today = getTodayStr();
      const hasHabitToday = appData.habits.some(h => (appData.habitLogs[h.id] || []).includes(today));
      if (hasHabitToday && appData.tree.lastHabitBonusDate !== today) {
        appData.tree.lastHabitBonusDate = today;
        addTreePoints(1);
        setTimeout(function () {
          UIFX.toast('🌿 习惯打卡联动，番茄树+1奖励！');
        }, 700);
      }
      /* 沉浸式专注：先推进冒险（可能在此结算结局），冒险结束后不再自动触发长休弹窗（总结弹窗独占） */
      UIFX.immersiveOnTomatoSettled(type);
      if (!(appData.settings.immersiveFocus && appData.immersiveFocus.ended)) checkLongBreakTrigger();
      /* 疲劳检测：专注质量下滑时主动建议休息/缩短时长（心流保护） */
      const _fat = checkFatigueAdvice();
      if (_fat) UIFX.toast(_fat, true);
      /* 结算链空 catch 接错误监控（warn 级、按 tag 节流），静默失效可诊断 */
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'settleFull');
    }
  } else if (type === 'half') {
    try {
      addTreePoints(0.5);
      /* 半个番茄也计入段位进度：超额点数满 1 点结算 1 星（内部按 0.5 点数计算） */
      onPomodoroCompleteRank();
      UIFX.immersiveOnTomatoSettled(type);
      if (_pomos > 0) UIFX.showPomodoroCelebration(_pomos);
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'settleHalf');
    }
  } else if (type === 'incomplete') {
    try {
      UIFX.immersiveOnTomatoSettled(type);
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'settleIncomplete');
    }
  }
  saveData();
  /* 冲段提示：跨过第 9 个🍅进入冲刺区 / 达成破限连击(7天×12+) */
  if (_pomos > 0) {
    const _sp = getSprintInfo();
    const _cross9 = _sp.todayCount >= 9 && _sp.todayCount - _pomos < 9;
    if (_cross9) {
      setTimeout(function () {
        UIFX.toast(
          '🔥 今日已超 8 个🍅，进入冲刺区！今日第 9 个起积分 ×' + (_sp.streak >= 7 ? 1.8 : _sp.streak >= 1 ? 1.4 : 1.2),
          true
        );
      }, 1600);
    } else if (_sp.todayCount >= 12 && _sp.todayCount - _pomos < 12) {
      const _st = _sp.streak + 1; /* 含今天的连击 */
      if (_st === 7)
        setTimeout(function () {
          UIFX.toast('⚡ 破限冲刺达成！连续 7 天每天 12+🍅，超额积分 ×1.8', true);
        }, 1600);
    }
  }
  if (_pomos > 0 && (type === 'full' || type === 'half')) {
    try {
      checkGachaTrigger();
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'gachaTrigger');
    }
  }
  UIFX.updateTodayStats();
  UIFX.renderWeeklyBadges();
  checkTreeDailyTasks();
  if (timerState.linkedTodoId) {
    UIFX.renderTodos();
    UIFX.refreshTodoSelect();
  } /* 关联计划的实际用🍅已更新 → 同步计划列表与下拉 */
  UIFX.renderGhostBar();
  if (type === 'full') {
    /* 加固：庆祝/段位结算/成就检查异常不阻断自动休息与传记写入 */
    try {
      UIFX.playSound('completeFull');
      if (_pomos > 0) UIFX.showPomodoroCelebration(_pomos);
      showTomatoDropAnimation();
      onPomodoroCompleteRank();
      setTimeout(() => checkNewAchievements(), 500);
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'settleCelebrate');
    }
  }
  /* 「只要点了结束，就直接进休息」——不按结算类型分成三六九等。
     选「未完成」时若不进休息，会一声不响回到待机（无弹窗、无提示），
     而这条规则界面上完全看不见；休息本身已有「跳过休息」，多一道隐藏门槛没有意义。
     唯一的例外：沉浸式冒险终章结算（其总结弹窗自带「开始休息 / 再来一轮」）。 */
  {
    /* 冒险结束（终章已结算）时不再自动进短休：总结弹窗里提供「开始休息/再来一轮」 */
    const _imfEnd = appData.immersiveFocus;
    /* 走这条链 = 你刚刚真的跑完一段计时（补记是另一条路 addManualRecord，根本不经过这里）。
       所以休息不按「记录类型」分：选「仅记录」只是说这段不计番茄账，
       不等于你刚才没在专注 —— 计不计番茄是记账，休不休息是身体。 */
    if (!(appData.settings.immersiveFocus && _imfEnd && _imfEnd.ended)) {
      setTimeout(() => {
        /* ★ 幂等：结算链（01c）若已按「实际专注时长」进了休息，就别在这里再起一段
           —— 再起的一次会拿「休息自身的时长」去查分级表，把刚起的休息缩短一档
           （50 分钟专注起 10 分休息，300ms 后会被改成 3 分）。
           短时段 / 仅记录由 __noAutoBreak 明确拦下，不强行打断。 */
        const _noAuto = !!timerState.__noAutoBreak;
        timerState.__noAutoBreak = false;
        if (!_noAuto && timerState.mode === 'idle') startBreak('short');
      }, 300);
    }
  }
  try {
    UIFX.checkBiographyEvents();
  } catch (e) {
    if (window.__errRep && __errRep.silent) __errRep.silent(e, 'biographyEvents');
  }
  /* 打断/低产达到阈值时，不必等下次冷启动才可能看到关怀弹窗。
     此前 maybeShowCareModal 只在 App 启动时调一次，用户做完一轮状态很差也不会被推荐轻松模式；
     这里在每次番茄落库后补一次检查（当天只弹一次，由 lastCareModalDate 幂等保护）。 */
  if (type !== 'log' && (type === 'incomplete' || (timerState.interruptions && timerState.interruptions.length))) {
    setTimeout(function () {
      try {
        UIFX.maybeShowCareModal();
      } catch (e) {
        if (window.__errRep && __errRep.silent) __errRep.silent(e, 'careModal');
      }
    }, SETTLE_DEADLINE_MS + 400);
  }
  /* R 不再用固定 3.5s 猜时长。注册"最迟兜底"flush（与历史窗口语义一致），
     提前出卡由 01e showToast 收集分支的 __settleTouch() 事件续期驱动 */
  _settleDeadlineTimer = setTimeout(flushSettleSummary, SETTLE_DEADLINE_MS);
}
function formatPomodoros(p) {
  if (p === null || p === undefined || p === '') return '';
  /* 0 = 没填 —— 没填就别显示「预计0🍅」
     —— 0 不等于"0 个番茄"，等于"用户没说过"。空串让调用方自然不渲染。 */
  if (Number(p) === 0) return '';
  if (p === 0.5) return '半个🍅';
  if (p % 1 === 0) return p + '🍅';
  return p + '🍅';
}
/* 快捷语法解析（标题内联 #标签 +🍅 !最晚完成日 @提醒时间） */
function parseTodoShortSyntax(raw) {
  let title = (raw || '').trim();
  let tag = '',
    deadline = null,
    remindAt = null,
    pomodoros = null;
  title = title.replace(/@(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})/g, function (_, d, t) {
    remindAt = d + ' ' + t;
    return '';
  });
  title = title.replace(/@(\d{1,2}:\d{2})/g, function (_, t) {
    remindAt = getTodayStr() + ' ' + t;
    return '';
  });
  title = title.replace(/!(\d{4}-)?(\d{1,2})-(\d{1,2})/g, function (_, y, m, d) {
    const year = y ? y.slice(0, 4) : String(new Date().getFullYear());
    deadline = year + '-' + String(parseInt(m, 10)).padStart(2, '0') + '-' + String(parseInt(d, 10)).padStart(2, '0');
    return '';
  });
  title = title.replace(/\+\s*(\d+(?:\.\d+)?)/g, function (_, n) {
    pomodoros = parseFloat(n);
    return '';
  });
  title = title.replace(/#([^\s#+!@]+)/g, function (_, m) {
    tag = m.slice(0, 12);
    return '';
  });
  title = title.replace(/\s+/g, ' ').trim();
  return { title: title, tag: tag, deadline: deadline, remindAt: remindAt, pomodoros: pomodoros };
}
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
/* ===== 树种系统：不同树种有独特外观，果实统一为🍅 ===== */
const TREE_SPECIES = {
  tomato: { name: '番茄树', unlockAt: 0, icon: '🍅', color: '#E85D3A' },
  cherry: { name: '樱花树', unlockAt: 50, icon: '🌸', color: '#E91E63' },
  golden: { name: '金松树', unlockAt: 100, icon: '🥇', color: '#FFD700' },
  cosmic: { name: '星辰树', unlockAt: 150, icon: '✨', color: '#9B59B6' },
  life: { name: '生命之树', unlockAt: 200, icon: '🌳', color: '#2ECC71' }
};
/* 树种串行解锁链（长线养成）：按此顺序，上一棵树图鉴集齐 9 阶后，下一棵才可种植。
   unlockAt 字段保留仅作排序参考，不再参与解锁判定 */
const SPECIES_ORDER = ['tomato', 'cherry', 'golden', 'cosmic', 'life'];
function speciesPrevFull(sid) {
  const idx = SPECIES_ORDER.indexOf(sid);
  if (idx <= 0) return true;
  const prev = SPECIES_ORDER[idx - 1];
  return ((appData.tree.speciesAlbum || {})[prev] || []).length >= 9;
}
function speciesPrevName(sid) {
  const idx = SPECIES_ORDER.indexOf(sid);
  return idx > 0 ? (TREE_SPECIES[SPECIES_ORDER[idx - 1]] || {}).name : '';
}
/* 各树种的默认名字：新树天生有名字，用户可随时修改 */
const DEFAULT_TREE_NAMES = {
  tomato: '小番茄',
  cherry: '小樱',
  golden: '小金',
  cosmic: '小星',
  life: '小灵'
};
/* 各树种的进化阶段 emoji 映射 */
const SPECIES_STAGES = {
  tomato: [
    { min: 0, max: 9, emoji: '🌱', name: '种子' },
    { min: 10, max: 24, emoji: '🌿', name: '嫩芽' },
    { min: 25, max: 39, emoji: '🌾', name: '幼苗' },
    { min: 40, max: 59, emoji: '🌳', name: '小树' },
    { min: 60, max: 79, emoji: '🌲', name: '大树' },
    { min: 80, max: 99, emoji: '🌴', name: '茂盛' },
    { min: 100, max: 149, emoji: '🏔️', name: '古树' },
    { min: 150, max: 199, emoji: '✨', name: '神树' },
    { min: 200, max: 99999, emoji: '🌐', name: '世界树' }
  ],
  cherry: [
    { min: 0, max: 9, emoji: '🌰', name: '种子' },
    { min: 10, max: 24, emoji: '🌱', name: '发芽' },
    { min: 25, max: 39, emoji: '🌿', name: '花苗' },
    { min: 40, max: 59, emoji: '🌸', name: '初樱' },
    { min: 60, max: 79, emoji: '🌺', name: '满开' },
    { min: 80, max: 99, emoji: '🏵️', name: '樱海' },
    { min: 100, max: 149, emoji: '🏮', name: '樱灵' },
    { min: 150, max: 199, emoji: '💖', name: '樱神' },
    { min: 200, max: 99999, emoji: '🌷', name: '永恒樱' }
  ],
  golden: [
    { min: 0, max: 9, emoji: '🟡', name: '金种' },
    { min: 10, max: 24, emoji: '🌾', name: '金芽' },
    { min: 25, max: 39, emoji: '🌿', name: '金苗' },
    { min: 40, max: 59, emoji: '🌳', name: '金树' },
    { min: 60, max: 79, emoji: '🌲', name: '金松' },
    { min: 80, max: 99, emoji: '🌴', name: '金冠' },
    { min: 100, max: 149, emoji: '🏆', name: '金灵' },
    { min: 150, max: 199, emoji: '💠', name: '金神' },
    { min: 200, max: 99999, emoji: '👑', name: '金之王' }
  ],
  cosmic: [
    { min: 0, max: 9, emoji: '💫', name: '星种' },
    { min: 10, max: 24, emoji: '✨', name: '星芽' },
    { min: 25, max: 39, emoji: '🌠', name: '星苗' },
    { min: 40, max: 59, emoji: '🌟', name: '星树' },
    { min: 60, max: 79, emoji: '⭐', name: '星群' },
    { min: 80, max: 99, emoji: '🔮', name: '星云' },
    { min: 100, max: 149, emoji: '🌌', name: '星灵' },
    { min: 150, max: 199, emoji: '☄️', name: '星神' },
    { min: 200, max: 99999, emoji: '🌞', name: '宇宙之心' }
  ],
  life: [
    { min: 0, max: 9, emoji: '🌱', name: '生命种' },
    { min: 10, max: 24, emoji: '🌿', name: '生命芽' },
    { min: 25, max: 39, emoji: '🌾', name: '生命苗' },
    { min: 40, max: 59, emoji: '🌳', name: '生命树' },
    { min: 60, max: 79, emoji: '🌲', name: '繁茂' },
    { min: 80, max: 99, emoji: '🌴', name: '生机' },
    { min: 100, max: 149, emoji: '🌈', name: '虹灵' },
    { min: 150, max: 199, emoji: '💖', name: '爱之树' },
    { min: 200, max: 99999, emoji: '♾️', name: '永恒生命' }
  ]
};
function getCurrentTreeStages() {
  return SPECIES_STAGES[appData.tree.species || 'tomato'] || SPECIES_STAGES.tomato;
}
function getTreeStageFor(points, sid) {
  const stages = SPECIES_STAGES[sid] || SPECIES_STAGES.tomato;
  for (let i = stages.length - 1; i >= 0; i--) {
    if (points >= stages[i].min) return stages[i];
  }
  return stages[0];
}
function getTreeStage(points) {
  const stages = getCurrentTreeStages();
  for (let i = stages.length - 1; i >= 0; i--) {
    if (points >= stages[i].min) return stages[i];
  }
  return stages[0];
}
/* 复活石复活·退阶：按历史峰值阶段退 N 阶（阶段越高退越多），
   避免 600 金币就把全部进度"原样复活"。
   规则：阶段 0-2 退 1 阶 / 3-5 退 2 阶 / 6-8 退 3 阶；最低阶段退无可退则回种子。 */
function reviveDegradePoints(peakPoints) {
  const stages = SPECIES_STAGES.tomato;
  let idx = 0;
  for (let i = 0; i < stages.length; i++) {
    if (peakPoints >= stages[i].min) idx = i;
  }
  let back = 1 + Math.floor(idx / 3);
  if (back > idx) back = idx;
  const pts = stages[idx - back].min;
  /* 复活兜底：至少回到「嫩芽」，避免 600 金币复活后仍是 0 分种子
     （种子阶段 0-9 分，宽限期一过就死，复活成 0 分等于"没救活"） */
  return Math.max(stages[1].min, pts);
}
/* ===== 番茄树称号系统（按历史最高积分，退化不影响称号） ===== */
const TREE_TITLES = [
  { min: 0, icon: '🍃', name: '新芽园丁' },
  { min: 10, icon: '🌿', name: '青苗学徒' },
  { min: 25, icon: '🌾', name: '育苗师' },
  { min: 40, icon: '🌳', name: '护林员' },
  { min: 60, icon: '🌲', name: '育林师' },
  { min: 80, icon: '🌴', name: '园艺师' },
  { min: 100, icon: '🏔️', name: '古木守望者' },
  { min: 150, icon: '✨', name: '神树使者' },
  { min: 200, icon: '🌐', name: '世界树之主' },
  { min: 300, icon: '🌌', name: '森之贤者' },
  { min: 400, icon: '🌍', name: '自然之灵' }
];
/* ===== 世界树 V2：果实币经济 / 装饰 / 场景 / 宝箱 / 心情 / 每日任务 ===== */
/* 装饰/场景：price 为参考价，rent7 为 7 天租金（按档位手写：越精致/越热门越贵，平价档便宜）
   deco = 前景氛围点缀（span 内联样式控制位置/大小/动画），bg = 兼容 fallback 渐变 */
const TREE_DECORATIONS = [
  { id: 'heart', icon: '💖', name: '爱心', price: 90, rent7: 100 },
  { id: 'flower', icon: '🌺', name: '花环', price: 120, rent7: 150 },
  { id: 'clover', icon: '🍀', name: '幸运草', price: 150, rent7: 190 },
  { id: 'lights', icon: '✨', name: '彩灯', price: 180, rent7: 240 },
  { id: 'bell', icon: '🎐', name: '风铃', price: 240, rent7: 320 },
  { id: 'butterfly', icon: '🦋', name: '蝴蝶', price: 300, rent7: 410 },
  { id: 'snowman', icon: '⛄', name: '雪人', price: 360, rent7: 510 }
];
const TREE_SCENES = [
  {
    id: 'garden',
    icon: '🏡',
    name: '花园',
    price: 0,
    rent7: 0,
    tier: '默认',
    bg: 'linear-gradient(180deg,#BFE3C0,#E8F5E9 55%,#C8E6C9)',
    deco: '<span style="left:7%;bottom:9%;font-size:var(--fs-hero);animation:floatY 3s ease-in-out infinite;animation-delay:.2s">🌼</span><span style="left:24%;bottom:17%;font-size:var(--fs-body)">🌱</span><span style="left:76%;bottom:11%;font-size:var(--fs-sub);animation:floatY 3.4s ease-in-out infinite;animation-delay:.6s">🌷</span><span style="left:90%;bottom:22%;font-size:var(--fs-body)">🍀</span>'
  },
  {
    id: 'field',
    icon: '🌾',
    name: '田野',
    price: 220,
    rent7: 240,
    tier: '平价',
    bg: 'linear-gradient(180deg,#87CEEB 0%,#B3E5FC 34%,#FCE38A 55%,#F5D56B 100%)',
    deco: '<span style="right:12%;top:7%;font-size:36px">☀️</span><span style="left:8%;bottom:12%;font-size:var(--fs-h1);animation:floatY 3.6s ease-in-out infinite;animation-delay:.4s">🌻</span><span style="left:30%;bottom:8%;font-size:26px;animation:floatY 3.2s ease-in-out infinite;animation-delay:1s">🌾</span><span style="left:60%;bottom:15%;font-size:var(--fs-hero);animation:floatY 4s ease-in-out infinite;animation-delay:.8s">🌻</span><span style="right:16%;bottom:9%;font-size:26px">🌾</span><span style="left:47%;bottom:6%;font-size:var(--fs-sub)">🌾</span>'
  },
  {
    id: 'sea',
    icon: '🏖️',
    name: '海边',
    price: 250,
    rent7: 280,
    tier: '平价',
    bg: 'linear-gradient(180deg,#7EC8E3 0%,#A5D8F3 38%,#BFE9F5 58%,#FFF0C9 88%,#F7DCA8 100%)',
    deco: '<span style="left:13%;top:7%;font-size:26px;animation:drift 9s linear infinite alternate;animation-delay:.3s">☁️</span><span style="left:60%;top:11%;font-size:var(--fs-sub);animation:drift 11s linear infinite alternate">☁️</span><span style="left:18%;bottom:20%;font-size:28px;animation:wave 2.2s ease-in-out infinite">🌊</span><span style="left:66%;bottom:24%;font-size:var(--fs-hero);animation:wave 2.8s ease-in-out .4s infinite">🌊</span><span style="right:11%;bottom:10%;font-size:var(--fs-h1);animation-delay:.9s">🏖️</span><span style="left:7%;bottom:13%;font-size:var(--fs-title);animation-delay:1.3s">🐚</span>'
  },
  {
    id: 'star',
    icon: '🌌',
    name: '星空',
    price: 250,
    rent7: 360,
    tier: '热门',
    bg: 'radial-gradient(1.6px 1.6px at 18% 30%,#fff,transparent 60%),radial-gradient(1.3px 1.3px at 42% 55%,#fff,transparent 60%),radial-gradient(1.8px 1.8px at 68% 22%,#fff,transparent 60%),radial-gradient(1.2px 1.2px at 85% 45%,#fff,transparent 60%),radial-gradient(1.5px 1.5px at 55% 70%,#fff,transparent 60%),radial-gradient(1.2px 1.2px at 30% 78%,#fff,transparent 60%),linear-gradient(180deg,#0B1035 0%,#1A237E 55%,#311B92 100%)',
    deco: '<span style="right:15%;top:9%;font-size:36px;animation:none">🌙</span><span style="left:10%;top:18%;font-size:var(--fs-sub);animation:twinkle 2s ease-in-out infinite alternate">⭐</span><span style="left:30%;top:32%;font-size:var(--fs-body);animation:twinkle 2.6s ease-in-out .5s infinite alternate">✨</span><span style="left:56%;top:16%;font-size:var(--fs-title);animation:twinkle 2.2s ease-in-out 1s infinite alternate">🌟</span><span style="left:80%;top:30%;font-size:var(--fs-body);animation:twinkle 3s ease-in-out .8s infinite alternate">✨</span><span style="left:44%;top:6%;font-size:var(--fs-note);animation:shoot 7s linear infinite">☄️</span>'
  },
  {
    id: 'snow',
    icon: '❄️',
    name: '雪原',
    price: 300,
    rent7: 450,
    tier: '高级',
    bg: 'linear-gradient(180deg,#DDE6F6 0%,#EFF4FC 45%,#DCE8F7 100%)',
    deco: '<span style="left:8%;top:-6%;font-size:var(--fs-sub);animation:fall 7s linear infinite">❄️</span><span style="left:22%;top:-6%;font-size:var(--fs-body);animation:fall 9s linear 1.2s infinite">❄️</span><span style="left:38%;top:-6%;font-size:var(--fs-title);animation:fall 8s linear .6s infinite">❄️</span><span style="left:56%;top:-6%;font-size:var(--fs-note);animation:fall 10s linear 2s infinite">❄️</span><span style="left:72%;top:-6%;font-size:var(--fs-sub);animation:fall 7.5s linear 1.6s infinite">❄️</span><span style="left:88%;top:-6%;font-size:var(--fs-body);animation:fall 9.5s linear .3s infinite">❄️</span><span style="left:11%;bottom:8%;font-size:26px;animation-delay:.5s">⛄</span><span style="right:9%;bottom:8%;font-size:var(--fs-h1);animation-delay:1s">🌲</span><span style="left:52%;bottom:5%;font-size:var(--fs-sub);animation-delay:.8s">🌲</span>'
  }
];
/* 树光环特效：纯 CSS 光晕 + 粒子环绕（多租可轮换，单选挂载） */
const TREE_AURAS = [
  { id: 'gold', icon: '✨', name: '金色光晕', rent7: 120, desc: '暖金光晕 + 金色粒子环绕' },
  { id: 'pink', icon: '🌸', name: '樱粉花雨', rent7: 150, desc: '粉色光晕 + 花瓣粒子环绕' },
  { id: 'firefly', icon: '🪄', name: '萤火之森', rent7: 180, desc: '青绿光晕 + 萤光粒子环绕' },
  { id: 'crystal', icon: '💎', name: '水晶棱光', rent7: 240, desc: '蓝紫棱光 + 星光粒子环绕' },
  { id: 'flame', icon: '🔥', name: '赤焰之环', rent7: 300, desc: '橙红光晕 + 火苗粒子环绕' }
];
/* 场景天气：叠加在场景上的动态天气层（多租可轮换，单选挂载） */
const TREE_WEATHER = [
  { id: 'rain', icon: '🌧️', name: '细雨', rent7: 100, desc: '雨滴缓缓飘落' },
  { id: 'snow', icon: '🌨️', name: '飘雪', rent7: 100, desc: '雪花轻舞飞扬' },
  { id: 'shooting', icon: '☄️', name: '流星雨', rent7: 150, desc: '流星不时划过' },
  { id: 'aurora', icon: '🌈', name: '极光', rent7: 180, desc: '彩色光带随风舞动' },
  { id: 'mist', icon: '🌫️', name: '晨雾', rent7: 130, desc: '朦胧雾气弥漫' }
];
/* 地面摆件：放场景地面的小物件（周租 or 买断永久收藏；最多同时挂 2 个） */
const TREE_PROPS = [
  { id: 'cat', icon: '🐱', name: '小猫咪', rent7: 100, buy: 1200, desc: '会摇尾巴的猫' },
  { id: 'fish', icon: '🐟', name: '锦鲤', rent7: 100, buy: 1200, desc: '在空气中游来游去' },
  { id: 'fountain', icon: '⛲', name: '小喷泉', rent7: 140, buy: 1800, desc: '咕嘟咕嘟冒水珠' },
  { id: 'owl', icon: '🦉', name: '猫头鹰', rent7: 140, buy: 1800, desc: '夜猫子站岗守护' },
  { id: 'mushroom', icon: '🍄', name: '蘑菇屋', rent7: 180, buy: 2400, desc: '童话小屋安家' }
];
/* 宝箱奖励池（免费宝箱：每累计 10 点开一次） */
const CHEST_REWARDS = [
  { type: 'coins', value: 30, w: 36, text: '🪙 +30 果实币' },
  { type: 'coins', value: 60, w: 20, text: '🪙 +60 果实币' },
  { type: 'coins', value: 20, w: 20, text: '🪙 +20 果实币' },
  { type: 'coins', value: 120, w: 8, text: '🪙 +120 果实币' },
  { type: 'decor', value: null, w: 10, text: '🎁 随机装饰' },
  { type: 'dew', value: 1, w: 6, text: '💧 露珠徽章 +1' }
];
function rollChestReward() {
  const total = CHEST_REWARDS.reduce(function (s, r) {
    return s + r.w;
  }, 0);
  let r = Math.floor(Math.random() * total);
  for (let i = 0; i < CHEST_REWARDS.length; i++) {
    r -= CHEST_REWARDS[i].w;
    if (r < 0) return CHEST_REWARDS[i];
  }
  return CHEST_REWARDS[0];
}
/* 商店金币转盘奖池：花 50🪙 转一次（小亏但好玩：最低奖 +20，惠顾 18%，大奖稀有） */
const SHOP_WHEEL_REWARDS = [
  { id: 'none', type: 'none', w: 18, text: '🍀 谢谢惠顾', color: '#90A4AE' },
  { id: 'coins20', type: 'coins', value: 20, w: 14, text: '🪙 +20', color: '#FFF176' },
  { id: 'coins35', type: 'coins', value: 35, w: 12, text: '🪙 +35', color: '#FFEE58' },
  { id: 'coins60', type: 'coins', value: 60, w: 8, text: '🪙 +60', color: '#FFD54F' },
  { id: 'coins120', type: 'coins', value: 120, w: 5, text: '🪙 +120', color: '#FFB300' },
  { id: 'coins250', type: 'coins', value: 250, w: 2, text: '🪙 +250', color: '#FB8C00' },
  { id: 'dew1', type: 'dew', value: 1, w: 4, text: '💧 露珠+1', color: '#4FC3F7' },
  { id: 'decor', type: 'decor', value: null, w: 3, text: '🎁 装饰7天', color: '#BA68C8' },
  { id: 'boostLot', type: 'boost', sub: 'lot', w: 8, text: '🎰 下次×2', color: '#81C784' },
  { id: 'boostGrow', type: 'boost', sub: 'grow', w: 8, text: '🌱 今日+15%', color: '#AED581' },
  { id: 'retry', type: 'retry', w: 8, text: '🔄 再来一次', color: '#26C6DA' },
  { id: 'bigGift', type: 'gift', w: 2, text: '✨ 神秘大奖×2', color: '#FF6B9D' }
];
function rollShopWheelReward() {
  const total = SHOP_WHEEL_REWARDS.reduce(function (s, r) {
    return s + r.w;
  }, 0);
  let r = Math.floor(Math.random() * total);
  for (let i = 0; i < SHOP_WHEEL_REWARDS.length; i++) {
    r -= SHOP_WHEEL_REWARDS[i].w;
    if (r < 0) return SHOP_WHEEL_REWARDS[i];
  }
  return SHOP_WHEEL_REWARDS[0];
}
/* 随机给一个未拥有的装饰；全拥有则给 100 币 */
function randomUnlockedDecor() {
  /* 「已拥有」= 买过 && 还没过期（与商店卡片判定同一口径）。
     只判 includes 会把过期装饰永远当成已拥有 → 转盘再也不送它，可抽的池子凭空少一截。 */
  const owned = appData.tree.decorations || [];
  const expires = appData.tree.decorExpires || {};
  const pool = TREE_DECORATIONS.filter(function (d) {
    if (!owned.includes(d.id)) return true;
    const exp = expires[d.id];
    return !!(exp && exp <= Date.now());
  });
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
/* 转盘旋转锁：防止重复点击反复扣币 */

/* 树心情：按距上次专注/浇水的天数计算（久未打理叶子发黄） */
/* ===== 每日惊喜扭蛋（新增）：每天第 3/6/9 个番茄自动触发 ===== */
function _pickWeighted(pool) {
  let total = 0;
  pool.forEach(function (p) {
    total += p.w;
  });
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= pool[i].w;
    if (r <= 0) return pool[i].v;
  }
  return pool[pool.length - 1].v;
}
function gachaReward() {
  /* 大类概率：金币 55% > 周番茄 30% > 段位星 15%；数值内小值概率大、大值概率小但拿得到 */
  const r = Math.random() * 100;
  if (r < 55) {
    const v = _pickWeighted([
      { v: 5, w: 26 },
      { v: 10, w: 20 },
      { v: 15, w: 15 },
      { v: 20, w: 12 },
      { v: 30, w: 10 },
      { v: 50, w: 7 }
    ]);
    return { type: 'coins', value: v, icon: '🪙' };
  }
  if (r < 85) {
    const v = _pickWeighted([
      { v: 1, w: 40 },
      { v: 2, w: 30 },
      { v: 3, w: 20 },
      { v: 4, w: 10 }
    ]);
    return { type: 'week', value: v, icon: '🍅' };
  }
  const v = _pickWeighted([
    { v: 1, w: 50 },
    { v: 2, w: 35 },
    { v: 3, w: 15 }
  ]);
  return { type: 'stars', value: v, icon: '⭐' };
}
/* {reward, revealed} —— 保证结果一定被看到 */
function checkGachaTrigger() {
  const rs = appData.rankSystem;
  /* 阈值口径是「今日有效番茄数」，所以门槛必须跟着日期走：
     原实现 rs.gachaNext 只累加不重置 —— 第二天今日数从 0 起算，
     却要够到昨天累上去的 8/12/16，于是扭蛋从第二天起基本不再出现。 */
  const _gDate = getTodayStr();
  if (rs.gachaDate !== _gDate) {
    rs.gachaDate = _gDate;
    rs.gachaNext = GACHA_STEP;
  }
  if (!rs.gachaNext) rs.gachaNext = GACHA_STEP;
  const _gFull = getTodayEffectiveFull();
  if (_gFull > 0 && _gFull >= rs.gachaNext) {
    rs.gachaNext = rs.gachaNext + GACHA_STEP;
    saveData();
    /* 庆祝动画后弹出扭蛋，避免同时堆叠 */
    setTimeout(function () {
      UIFX.triggerGacha();
    }, 650);
  }
}
/* ===== 必做3件事 v2（新增）：提前一天立目标 / 可反复重填 / 卡片放大与折叠 / 当天完成拿奖励 ===== */
let _mustDoEditDate = null;
const MUSTDO_EST_OPTIONS = [0.5, 1, 1.5, 2, 3, 4, 6];
function mustDoTomorrowStr() {
  let _d = new Date();
  _d.setDate(_d.getDate() + 1);
  return getDateStr(_d);
}
/* 旧调用点仍在用 refreshTodoSelect / onSelectTodoPlan 这两个名字，这里补别名避免 ReferenceError */
function getMustDoTomorrowStr() {
  return mustDoTomorrowStr();
}
/* 默认全部折叠，只有点过一次才记录"展开" */
function mustDoEst(it) {
  const n = Number(it && it.est);
  return isFinite(n) && n > 0 ? n : 1;
}
function mustDoWorkMin() {
  const m = appData.settings && appData.settings.workDuration;
  return typeof m === 'number' && m > 0 && !isNaN(m) ? m : 25;
}
function toggleMustDo(id) {
  const today = getTodayStr();
  const list = appData.mustDos[today] || [];
  const it = list.filter(function (x) {
    return idEq(x.id, id);
  })[0];
  if (!it) return;
  it.done = !it.done;
  saveData();
  UIFX.renderMustDoSection();
  UIFX.renderPlanMustRows();
  const allDone =
    list.length &&
    list.every(function (x) {
      return x.done;
    });
  if (allDone && !appData.mustDoRewarded[today]) {
    UIFX.playSound('habitDone');
    UIFX.toast('🎉 今日必做 3 件事全部完成！去「🎯 目标」页点「领取 +' + COIN_MUSTDO_REWARD + '🪙」吧');
  }
}
function claimMustDoReward() {
  const today = getTodayStr();
  const list = appData.mustDos[today] || [];
  if (
    !list.length ||
    list.some(function (x) {
      return !x.done;
    })
  ) {
    UIFX.toast('还有没完成的事项哦');
    return;
  }
  if (appData.mustDoRewarded[today]) {
    UIFX.toast('今天的奖励已领取');
    return;
  }
  appData.mustDoRewarded[today] = true;
  coinEarn(COIN_MUSTDO_REWARD, 'mustdo', '今日必做 3 件事全部完成');
  saveData();
  UIFX.renderMustDoSection();
  UIFX.renderPlanMustRows();
  UIFX.renderTreeSection();
  UIFX.renderTreeShop();
  UIFX.renderTimerTree();
  UIFX.toast('🏆 今日必做 3 件事全部完成！+' + COIN_MUSTDO_REWARD + '🪙');
}
function saveMustDos() {
  const date = _mustDoEditDate || mustDoTomorrowStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    UIFX.toast('请选择有效日期');
    return;
  }
  const oldList = appData.mustDos[date] || [];
  const items = [];
  for (let i = 0; i < 3; i++) {
    const inp = document.getElementById('mustDoInput' + i);
    const v = inp ? inp.value.trim() : '';
    if (!v) continue;
    const sel = document.getElementById('mustDoEst' + i);
    const est = sel ? Number(sel.value) : 1;
    /* 同位置优先复用旧条目（保住打卡进度），位置变了再按标题匹配 */
    let oldItem = oldList[i];
    if (!oldItem || oldItem.title !== v)
      oldItem = oldList.filter(function (x) {
        return x.title === v;
      })[0];
    items.push({
      id: oldItem ? oldItem.id : Date.now() + i,
      title: v,
      est: isFinite(est) && est > 0 ? est : 1,
      done: oldItem ? !!oldItem.done : false
    });
  }
  if (!items.length) {
    UIFX.toast('至少填写 1 件事');
    return;
  }
  appData.mustDos[date] = items;
  /* 「明日必做」打上预设标记：次日自动进「计划」列表并显示「🌙 昨晚预设」；改成今日则取消该标记 */
  if (!appData.mustDoFromPrev) appData.mustDoFromPrev = {};
  const today = getTodayStr();
  if (date === today) delete appData.mustDoFromPrev[today];
  else if (date > today) appData.mustDoFromPrev[date] = true;
  saveData();
  UIFX.closeModal('mustDoModal');
  UIFX.renderMustDoSection();
  UIFX.renderPlanMustRows();
  UIFX.toast('✅ 已' + (oldList.length ? '更新' : '设置') + ' ' + date + ' 的必做事项（' + items.length + ' 件）');
}
function clearMustDos(dateStr) {
  const date = dateStr || _mustDoEditDate || mustDoTomorrowStr();
  const list = appData.mustDos[date] || [];
  if (!list.length) {
    UIFX.toast('这天还没有设置内容');
    return;
  }
  var _doClearMust = function () {
    delete appData.mustDos[date];
    if (appData.mustDoFromPrev) delete appData.mustDoFromPrev[date];
    saveData();
    UIFX.closeModal('mustDoModal');
    UIFX.renderMustDoSection();
    UIFX.renderPlanMustRows();
    UIFX.toast('已清空 ' + date + ' 的必做事项');
  };
  var _mustMsg = '确定清空 ' + date + ' 的必做事项吗？';
  if (typeof window.rsAsk === 'function') window.rsAsk(_mustMsg, { title: '清空必做', okText: '清空', danger: true }, _doClearMust);
  else if (confirm(_mustMsg)) _doClearMust();
}

/* ===== 保护卡/恢复卡 系统 ===== */
function isStreakProtected(ds) {
  let arr = appData.tree.streakProtectedDates || [];
  return arr.indexOf(ds) >= 0;
}
function isWaterProtected(ds) {
  let arr = appData.tree.waterProtectedDates || [];
  return arr.indexOf(ds) >= 0;
}
function addProtectedDate(type, ds) {
  let key = type === 'water' ? 'waterProtectedDates' : 'streakProtectedDates';
  if (!appData.tree[key]) appData.tree[key] = [];
  if (appData.tree[key].indexOf(ds) < 0) appData.tree[key].push(ds);
  /* 只保留最近14天 */
  let cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  appData.tree[key] = appData.tree[key].filter(function (d) {
    return new Date(d + 'T00:00:00') >= cutoff;
  });
}
function snapshotStreakHistory() {
  if (!appData.tree.streakHistory) appData.tree.streakHistory = [];
  let today = getTodayStr();
  let last = appData.tree.streakHistory[appData.tree.streakHistory.length - 1];
  /* 今天已有快照时不新增，但**要继续往下走**把今天这条重算一遍
     —— 否则当天补完番茄后，连续天数会一直停在 0、断连横幅也不消失 */
  const _isToday = !!(last && last.date === today);
  /* 计算当前streak */
  let dateSet = new Set(
    (appData.records || [])
      .filter(function (r) {
        return r.type === 'full';
      })
      .map(function (r) {
        return getDateStr(r.startTime);
      })
  );
  /* 自动防断：昨天没完成番茄且未保护 → 自动消耗 1 张库存保护卡，保住连续天数（无需手动激活） */
  let _y = new Date();
  _y.setDate(_y.getDate() - 1);
  let _yds = getDateStr(_y);
  if (!dateSet.has(_yds) && !isStreakProtected(_yds)) {
    if ((appData.tree.inventory.streakProtect || 0) > 0) {
      appData.tree.inventory.streakProtect--;
      addProtectedDate('streak', _yds);
      UIFX.toast('🛡️ 自动防断：消耗 1 张连续天数保护卡，昨天的连续天数保住了！');
    }
  }
  let streak = 0;
  let d = new Date();
  /* 今天还没完成番茄（这一天还没过完）→ 从昨天往回数。
     否则第二天一睁眼就显示"连续 0 天 / 断了"。 */
  let _tds = getDateStr(d);
  if (!dateSet.has(_tds) && !isStreakProtected(_tds)) d.setDate(d.getDate() - 1);
  while (true) {
    let ds = getDateStr(d);
    if (dateSet.has(ds) || isStreakProtected(ds)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  /* 连续打卡 7 天免费获得 1 张保护卡（进度效应：与购买共用上限 2 张，每 7 天一次） */
  let _next = appData.tree.nextFreeProtectAt || 7;
  if (streak >= _next) {
    let _held = (appData.tree.inventory.streakProtect || 0) + (appData.tree.activeStreakProtect ? 1 : 0);
    if (_held < 2) {
      appData.tree.inventory.streakProtect = (appData.tree.inventory.streakProtect || 0) + 1;
      UIFX.toast('🎁 连续打卡 ' + streak + ' 天！免费获得 1 张连续天数保护卡（自动防断）');
    }
    appData.tree.nextFreeProtectAt = streak + 7;
  }
  /* 今天已有快照 → 原地更新（补完番茄立刻回正）；否则新增一条 */
  if (_isToday) {
    last.streak = streak;
    last.waterStreak = appData.tree.waterStreak || 0;
    appData.tree.streakHistory[appData.tree.streakHistory.length - 1] = last;
  } else {
    appData.tree.streakHistory.push({ date: today, streak: streak, waterStreak: appData.tree.waterStreak || 0 });
  }
  /* 只保留3天：断了之后有3天宽限期可用恢复卡找回，超过则彻底断 */
  if (appData.tree.streakHistory.length > 3) appData.tree.streakHistory = appData.tree.streakHistory.slice(-3);
}
/* ===== 段位系统核心逻辑 ===== */
function getRankFromStars(stars) {
  for (let i = RANK_TIERS.length - 1; i >= 0; i--) {
    if (stars >= RANK_TIERS[i].min) return RANK_TIERS[i];
  }
  return RANK_TIERS[0];
}
/* 段位星级显示：「王者 N 星 / 荣耀 N 星」，把段位间的长空窗切成可见的小台阶 */
function getRankStarLabel(stars) {
  const t = getRankFromStars(stars);
  if (!t || !t.starBase) return '';
  return t.name + ' ' + Math.max(0, Math.round(stars) - t.starBase) + ' 星';
}
/* 是否为最高段位（用于「已达最高段位」提示、子段位隐藏） */
function isTopTier(tier) {
  return !!tier && tier.min >= RANK_TIERS[RANK_TIERS.length - 1].min;
}
function getSubRankIndex(stars, tier) {
  if (!tier || isTopTier(tier)) return -1;
  const range = tier.max - tier.min;
  const idx = Math.floor((stars - tier.min) / (range / 3));
  return Math.min(2, Math.max(0, idx));
}
function getRankFullName(stars) {
  const t = getRankFromStars(stars);
  const si = getSubRankIndex(stars, t);
  return t.name + (si >= 0 ? SUB_RANKS[si] : '');
}
/* ===== 赛季锚点：标准赛季 3 个月，起始时间全服统一 =====
   所有玩家都在同一个固定赛季里：从锚点起每 3 个月一个赛季（S0 → S1 → S2 …），
   结束时刻全服统一，何时加入只影响本季剩余天数，不影响赛季号与结束时刻。 */
const SEASON_ANCHOR_YEAR = 2026,
  SEASON_ANCHOR_MONTH = 7,
  SEASON_ANCHOR_DAY = 29;
function seasonAddMonths(months) {
  const d = new Date(SEASON_ANCHOR_YEAR, SEASON_ANCHOR_MONTH, SEASON_ANCHOR_DAY);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}
/* 某个日期属于第几个固定赛季（锚点赛季 = S0；锚点之前返回负数 = 内测） */
function getSeasonNumberAt(dateVal) {
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal + 'T00:00:00');
  let diff = (d.getFullYear() - SEASON_ANCHOR_YEAR) * 12 + (d.getMonth() - SEASON_ANCHOR_MONTH);
  if (d.getDate() < SEASON_ANCHOR_DAY) diff--;
  return Math.floor(diff / SEASON_MONTHS);
}
/* 赛季标签：负数（锚点之前，即今天之前）统一显示为内测；锚点起显示 S0、S1… */
function seasonLabel(n) {
  return n < 0 ? '内测' : 'S' + n;
}
function getSeasonInfo() {
  const now = new Date();
  const n = getSeasonNumberAt(now);
  const seasonStart = seasonAddMonths(n * SEASON_MONTHS);
  const seasonEnd = seasonAddMonths((n + 1) * SEASON_MONTHS);
  return { number: n, startDate: getDateStr(seasonStart), endDate: getDateStr(seasonEnd), seasonStart, seasonEnd };
}

/* 近7天日均点数（原按条数统计，与结算的点数口径不一致） */
function get7dAvgPomodoros() {
  const now = Date.now();
  let pts = 0;
  /* 分母用「近 7 天里真正有记录的天数」，不用硬编码的 7：
     把没打开 App 的日子也按 0 计进分母，会系统性低估目标
     （7 天里只活跃 3 天、共 12 点：除以 7 ≈ 1.71，除以 3 = 4）。
     这样「努力的人目标更高、长期不活跃的人目标不虚高」。 */
  const daySet = {};
  appData.records.forEach(function (r) {
    if (isLogRecord(r)) return; /* 仅记录：不算活跃日、不参与目标均摊 */
    if (r.startTime >= now - 7 * DAY_MS) {
      pts += getPomos(r);
      daySet[getDateStr(r.startTime)] = true;
    }
  });
  const activeDays = Object.keys(daySet).length;
  if (!activeDays) return 0; /* 7 天内零记录 → 无产能参考，交由调用方走下限 */
  return pts / activeDays;
}
function generateDailyTask() {
  const rs = appData.rankSystem;
  const today = getTodayStr();
  if (rs.dailyTask && rs.dailyTask.date === today && rs.dailyTask.target) return;
  /* 任务已延后到明天 → 今天不生成新任务，让延后任务独占明天的任务位；延后任务到期后恢复正常生成 */
  if (rs.dailyTask && rs.dailyTask.postponed && rs.dailyTask.date > today) return;
  /* 任务目标 = 近7天日均×0.6（截断2~15）：锚定产能，超额空间稳定；旧公式的净星/段位系数会滚雪球压死超额 */
  const avg7d = get7dAvgPomodoros();
  let T = Math.round(avg7d * 0.6);
  T = Math.max(2, T);
  /* 连超加成从「≥2天就+1~3」放宽到「≥3天才+1」：追平太快会把超额压没，多做的人拿不到回报 */
  if (rs.consecutiveOver >= 3) T = Math.min(15, T + 1);
  if (rs.consecutiveUnder >= 2) T = Math.max(2, T - Math.min(rs.consecutiveUnder - 1, 2));
  T = Math.max(2, Math.min(15, T));
  rs.dailyTask = {
    date: today,
    target: T,
    starsGainedToday: 0,
    /* 今日「非超额渠道」入账星（周挑战/连胜/扭蛋等走 addRankStars 的），
       结算超额时需从 starsGainedToday 剔除，避免虚占超额星 */
    extToday: 0,
    settled: false,
    overCompleted: false,
    underCompleted: false,
    starMult: 1
  };
  saveData();
}
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
