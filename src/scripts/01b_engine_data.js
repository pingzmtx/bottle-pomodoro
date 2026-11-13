/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 数据层：被依赖≈226。对外=数据默认/读写/备份/迁移/日期工具。
 * 红线：新增 appData 字段必须同步补默认值并登记《AI交接作战手册》§3.4；
 * 勿在业务模块里直接改 key 结构绕过本层默认/迁移。 */
/* ==================== 模块: 01-data.js | 职责: 数据层——存储键、默认设置、数据结构、保存/读取、备份 | 分组: data ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01-data.js
 * 分组：data
 * 职责：数据层——存储键、默认设置、数据结构、保存/读取、备份
 * 功能：
 *   - 存储键与默认设置：STORAGE_KEY、defaultSettings、WEEKLY_BADGES/RANK_TIERS 常量
 *   - 数据结构工厂：createDefaultAppData、全局状态 appData / timerState
 *   - 数据读写：IndexedDB + localStorage 双写，loadData / saveData / saveDataNow
 *   - 备份与恢复：导出/导入/自动备份/恢复/清空数据
 *   - 数据健康：数值防御 sanitizeNumericSettings、sanitizeTreeData、runDataHealthCheck
 *   - 沉浸式专注：immersiveFocus 冒险存档字段与老数据兼容（剧本库/随机剧本已迁移至 06-immersive.js）
 *   - 白帽优化：极简模式/难度档位（档位=时长：简单10/中等25/沉浸式50/大师90分钟）/休息仪式/人机排行榜 的数据字段、词库池与 BOT 玩家配置
 * 函数索引（TOC）：_dataScale/sanitizeNumericSettings/volumeBonusShould/createDefaultAppData/createTimerState/idbGetDb/idbSet/idbGet/_w55Retry/idbWrite/ensureTreeExtras/applyCompanionDefaultGuard（+56 更多）
 * ============================================================ */

const STORAGE_KEY = 'tomato_focus_v3';
/* 备份文件格式版本：数据结构变更时 +1，导入时兼容旧版本 */
const DATA_VERSION = '3.9';
/* ===== 导出结构 schema 版本（独立于数据版本号）
 * exportData 每次写当前 EXPORT_SCHEMA_VERSION；导入方校验：
 * 更高 schema = 更新版本导出（字段结构可能不兼容）→ 拒绝并提示先升级（防静默错位）；
 * 缺失或更小 = 旧格式 → 走字段级兜底 + warns（既有兼容策略）。 */
const EXPORT_SCHEMA_VERSION = 1;
/* 自动备份：导入/清空数据前，把当前数据自动存一份，可随时恢复 */
const AUTO_BACKUP_KEY = STORAGE_KEY + '_auto_backup';
/* ===== 写入戳（守卫 3 用）：记录"最后一次写盘属于哪个窗口、什么时间" =====
   与主数据分开存，体积只有几十字节，可以每次写盘顺手更新、每次写盘前顺手读。 */
const WRITE_STAMP_KEY = STORAGE_KEY + '_stamp';
/* 本窗口的身份：每次页面载入换一个（同一个 html 开两个窗口 = 两个身份） */
const _INSTANCE_ID = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
/* 本窗口"知道的"存储版本时间戳：载入时取读到的 t，每次成功写盘后更新成自己写下的 t */
let _lastWriteT = -1;
/* 读到"别人写过更新的数据"只提示一次 */
let _staleWarned = false;
/* 「另一个窗口写过盘」触发的重载是否已挂起（等页面回到可见再刷，见 _guardStaleWrite） */
let _staleReloadPending = false;
/* 用例用：直接读写"本窗口已知的存储时间戳"（`let` 不在 window 上，用例够不着） */
window.__staleHooks = {
  get t() { return _lastWriteT; },
  set t(v) { _lastWriteT = v; },
  get id() { return _INSTANCE_ID; }
};
/* 清除数据流程标志：清除期间禁止任何保存写回，防止旧数据被防抖定时器重新写入导致清除"失效" */
let _dataClearing = false;
/* ★ 数据是否已从存储读回来。
   页面刚打开时 appData 还是 createDefaultAppData() 的空壳，而 loadData() 是异步的。
   若在这个窗口内触发 saveDataNow()（beforeunload / pagehide / freeze 都会，
   手机上切 app、锁屏、内存回收更是高频），就把空壳写进了存储 ——
   随后 loadData 读到的正是这份空数据，用户看到「全部数据没了」。
   实测复现：抢在 loadData 完成前调 saveDataNow()，存储里 todos/records 双双归零。 */
let _dataLoaded = false;
/* 上一份「非空」数据的规模（关键数组条目数之和），用于空写守卫 */
let _lastNonEmptyScale = 0;
/* 用户内容容器的条目总数：用来判断「这次要写的是不是一份空数据」。
   ★ 这里只能列**用户自己产生的内容**，不能把 settings / tree / rankSystem 这类
   结构对象算进来 —— 那些随时都非空，守卫就永远不触发、等于没有。
   反过来，漏列一类容器同样致命：用户只剩这一类数据时 scale 会被算成 0，
   空写守卫把正常保存拦成「检测到数据被清空」。wishes（愿望清单）就漏过：
   全删光只剩愿望时，愿望保存不进去。新增内容容器时**必须同步这张表**。 */
function _dataScale(d) {
  if (!d || typeof d !== 'object') return 0;
  let n = 0;
  const arrs = [
    'todos', 'records', 'memos', 'selfRewards', 'biographies',
    'lifeGoals', 'weekFocus', 'reviews', 'wishes',
    'habits', 'countdowns', 'unlockedAchievements'
  ];
  for (let i = 0; i < arrs.length; i++) {
    const v = d[arrs[i]];
    if (Array.isArray(v)) n += v.length;
  }
  const maps = ['diaries', 'habitLogs', 'reviewStages', 'todoDoneLog', 'todoSchedLog'];
  for (let j = 0; j < maps.length; j++) {
    const v = d[maps[j]];
    if (v && typeof v === 'object' && !Array.isArray(v)) n += Object.keys(v).length;
  }
  /* mustDos 是 { 日期: [条目] }，按内层条目数算 —— 按外层键数会把某天全删光
     留下的空数组也当成内容，虚高到守卫失灵。 */
  if (d.mustDos && typeof d.mustDos === 'object') {
    Object.keys(d.mustDos).forEach(function (k) {
      const v = d.mustDos[k];
      if (Array.isArray(v)) n += v.length;
    });
  }
  return n;
}
const defaultSettings = {
  workDuration: POMO_DEFAULT_MINUTES,
  shortBreak: 5,
  longBreak: 20,
  longInterval: 4,
  longBreakForce: false,
  bufferTime: 30,
  interruptTolerance: 5,
  microBreak: true,
  microMode: 'random',
  microInterval: 5,
  microMin: 3,
  microMax: 5,
  microDuration: 10,
  microMinGap: 2,
  sound: false,
  nearEndSound: true,
  notify: true,
  /* 专注中在通知栏挂一条「还剩 12:34」的常驻通知（安卓锁屏不用解锁就能看进度）。
     独立开关是因为它和「到点提醒」是两种东西：有人想要提醒但嫌通知栏里一直有条东西。 */
  notifyLive: true,
  fuzzyTimer: false,
  darkMode: false,
  theme: 'default',   /* 主题配色 id（'default' = 项目原配色）；与 darkMode 正交 */
  immersiveFocus: false,
  minimalMode: false,
  adaptiveSuggest: true,
  difficulty: 'medium',
  difficultyTouched: false,
  sfxEnabled: true,
  /* ★ 2026-10-23：默认音量 0.8 → 1.0。峰值最高的音效是 finish 的 0.35 倍，
     1.0 也只是 0.35 振幅，离削波（1.0）还差很远，开到顶不会破音。 */
  sfxVolume: 1.0,
  flowDuration: 50,
  /* 全站字号缩放倍率（1 = 标准）；档位定义见 00_pure_core 的 FONT_SCALE_STEPS */
  fontScale: 1,
  hour12: true,  /* 时间显示用 12 小时制（1–12，不带「上午/下午」前缀）；false → 24 小时制 */
  /* 左右滑动切换视图（边缘 34px 内不接管，给浏览器自己的前进/后退手势）。
     false → 完全关掉，只能用底部导航切。 */
  swipeNav: true
};
/* ===== 数值设置防御：防止 localStorage 损坏导致 workDuration 等变成 NaN ===== */
function sanitizeNumericSettings() {
  const s = appData.settings;
  if (!s) return;
  const numFields = [
    'workDuration',
    'shortBreak',
    'longBreak',
    'longInterval',
    'bufferTime',
    'interruptTolerance',
    'microInterval',
    'microMin',
    'microMax',
    'microDuration',
    'microMinGap'
  ];
  numFields.forEach(function (k) {
    if (typeof s[k] !== 'number' || isNaN(s[k]) || s[k] < 0) {
      s[k] = defaultSettings[k];
    }
  });
  if (s.workDuration < 1) s.workDuration = POMO_DEFAULT_MINUTES;
}
const WEEKLY_BADGES = [
  {
    id: 'bronze',
    icon: '🥉',
    name: '初试锋芒',
    goal: 5,
    desc: '本周5个🍅',
    avg: '0.7',
    positioning: '入门',
    color: '#CD7F32',
    bg: '#FDF2E9'
  },
  {
    id: 'silver',
    icon: '🥈',
    name: '小有所成',
    goal: 10,
    desc: '本周10个🍅',
    avg: '1.4',
    positioning: '养成习惯',
    color: '#999',
    bg: '#F5F5F5'
  },
  {
    id: 'gold',
    icon: '🥇',
    name: '渐入佳境',
    goal: 18,
    desc: '本周18个🍅',
    avg: '2.6',
    positioning: '稳定用户',
    color: '#D4A017',
    bg: '#FFFDE7'
  },
  {
    id: 'platinum',
    icon: '💎',
    name: '持之以恒',
    goal: 28,
    desc: '本周28个🍅',
    avg: '4',
    positioning: '进阶',
    color: '#5B9BD5',
    bg: '#E3F2FD'
  },
  {
    id: 'diamond',
    icon: '💠',
    name: '心无旁骛',
    goal: 40,
    desc: '本周40个🍅',
    avg: '',
    positioning: '高手',
    color: '#4FC3F7',
    bg: '#E0F7FA'
  },
  {
    id: 'star',
    icon: '⭐',
    name: '炉火纯青',
    goal: 55,
    desc: '本周55个🍅',
    avg: '7.9',
    positioning: '专注者',
    color: '#E91E63',
    bg: '#FCE4EC'
  },
  {
    id: 'king',
    icon: '🔥',
    name: '登峰造极',
    goal: 70,
    desc: '本周70个🍅',
    avg: '10',
    positioning: '强者',
    color: '#9B59B6',
    bg: '#F5EEF8',
    habitReq: 'king',
    habitReqDesc: '本周至少5天·每天≥1项打卡'
  },
  {
    id: 'glory',
    icon: '👑',
    name: '独孤求败',
    goal: 90,
    desc: '本周90个🍅',
    avg: '12.9',
    positioning: '极限',
    color: '#FF6B4A',
    bg: '#FFF3E0',
    glow: true,
    habitReq: 'glory',
    habitReqDesc: '每日全部习惯打卡'
  }
];
/* ===== 段位系统常量 ===== */
const RANK_TIERS = [
  /* 段位阶梯（校准）：11 档 + starBase「N 星」显示；王者~荣耀间插入过渡段位；
   荣耀 1000（仿真：12🍅 约83天、16🍅 约67天、20🍅 约59天到，8~10🍅 止步王者系） */
  { name: '青铜', min: 0, max: 30, color: '#CD7F32', bg: '#FDF2E9', icon: '🥉', promotion: false },
  { name: '白银', min: 30, max: 80, color: '#999', bg: '#F5F5F5', icon: '🥈', promotion: false },
  { name: '黄金', min: 80, max: 160, color: '#D4A017', bg: '#FFFDE7', icon: '🥇', promotion: false },
  { name: '铂金', min: 160, max: 280, color: '#5B9BD5', bg: '#E3F2FD', icon: '💎', promotion: false },
  { name: '钻石', min: 280, max: 400, color: '#4FC3F7', bg: '#E0F7FA', icon: '💠', promotion: false },
  { name: '星耀', min: 400, max: 500, color: '#E91E63', bg: '#FCE4EC', icon: '⭐', promotion: false },
  { name: '王者', min: 500, max: 620, color: '#9B59B6', bg: '#F5EEF8', icon: '🔥', promotion: true, starBase: 500 },
  {
    name: '无双王者',
    min: 620,
    max: 760,
    color: '#8E44AD',
    bg: '#F4ECF7',
    icon: '⚔️',
    promotion: false,
    starBase: 500
  },
  {
    name: '荣耀王者',
    min: 760,
    max: 900,
    color: '#C2185B',
    bg: '#FCE4EC',
    icon: '🌟',
    promotion: false,
    starBase: 500
  },
  {
    name: '荣耀',
    min: 1000,
    max: 1200,
    color: '#FF6B4A',
    bg: '#FFF3E0',
    icon: '👑',
    promotion: false,
    glow: true,
    starBase: 1000
  },
  {
    name: '传奇荣耀',
    min: 1200,
    max: 99999,
    color: '#D4AF37',
    bg: '#FFF8E1',
    icon: '🏆',
    promotion: false,
    glow: true,
    starBase: 1000
  }
];

const SUB_RANKS = ['Ⅲ', 'Ⅱ', 'Ⅰ'];
const SEASON_MONTHS = 3;
/* 当日高产奖励：看的是「当天真实完成的完整🍅 总数」，不是相对任务的超额。
   > 16 个就额外 +1⭐，每天只发一次。
   两个「不受」：① 不受每日 6 星上限管；② 不受换任务重置影响（换任务清的是超额进度，
   清不掉真实总数，所以这颗星换几次任务也不会被清掉、也不会重复发）。 */
const DAILY_VOLUME_BONUS_AT = 16;
function volumeBonusShould() {
  /* 半个番茄按 0.5 计入当日总点数，更公平地触发高产奖励 */
  return countTomatoPoints(getTodayStr()) > DAILY_VOLUME_BONUS_AT ? 1 : 0;
}
/* ===== 默认数据结构工厂：全局唯一来源，消除多处重复定义 ===== */
function createDefaultAppData() {
  return {
    __fingerprint: 'bottle-pomodoro-fingerprint-2026' /* 数据隐藏指纹（开源标记） */,
    __bottle_author: 'bottle-pomodoro-2026' /* 作者隐藏字段 */,
    /* 注：历史上这里还有个 `dataVersion: '3.8'` 字段 —— 全仓没有任何逻辑读它
       （几处 `dataVersion` 读取都只是为了兼容「只有 dataVersion 的老备份」），
       留着只会让每个新导出的备份都带上一个没人用的版本号 → 已删。 */
    settings: {},
    todos: [],
    mustDos: {},
    mustDoUI: { collapse: {}, open: {} },
    mustDoRewarded: {},
    /* 待办「完成流水」：日期 → [{id,title,ts}]。每日总结的「完成任务」数读它，
       待办列表每天被清空也不影响回看历史某天勾了几项 */
    todoDoneLog: {},
    /* 计划「排期快照」：日期 → [{id,title,remindAt,estEnd,pomodoros,...}]。
       计划被勾完成（次日删除）或排期被清回未排期后，日程表那天的**预计块**还得画得出来
       —— 见 00_pure_core 的 todoSchedSnapshotOf 注释。只读，永不写回计划。 */
    todoSchedLog: {},
    biographies: [],
    bioTriggered: {},
    bioBackfillDone: false,
    habits: [],
    habitLogs: {},
    /* 跳过日：{ habitId: ['YYYY-MM-DD', ...] }，Loop 的 `-` 语义 ——
       这天既不加分也不减分、不算破链，用于「出门在外做不了」。
       与 habitLogs 分开存：跳过不是打卡，混进日志会让"打了几个"虚高。 */
    habitSkips: {},
    /* 习惯分类（展开的文件夹）：{id,name} 列表，习惯侧只存 catId。
       删除分类只把成员退回未分类，永不连带删习惯。 */
    habitCats: [],
    /* 文件夹展开状态：{catId: true}；缺省=收起（未分类始终展开，不记状态） */
    habitCatOpen: {},
/* 计划页「备忘」留言板：与微信传输助手同构的条状记录。
   元素 = { id, text, ts, done }；保留期/自动删除开关在 settings.memoRetention / memoAutoDelete。
   随主键持久化（saveData 单通道），导出全部数据时一并带走。 */
    memos: [],
    /* 艾宾浩斯复习排期：{ 'YYYY-MM-DD': { level, last, next } }，键 = 被复习的那一天 */
    reviewStages: {},
    records: [],
    /* 删除墓碑：{ uid, kind, deletedAt }。记录被删时写一条，导出/同步一并带走。
       没有它，多端同步会把已删记录重新拉回来（服务端只看到「这边少了一条」）。 */
    tombstones: [],
    /* 离线变更队列：{uid, kind, op:'upsert'|'delete', at}。接后端后由 01b3_sync 推送；
       没接后端时它只是一份"最近改过什么"的日志（有上限，不会无限长）。 */
    outbox: [],
    diaries: {},
    /* ===== 设备级 UI 状态收编单状态树 =====
     * 目标：消灭「同一状态存两份」与散键各自落盘，统一随主键持久化（saveData 单通道）。
     * 原独立键：tomato_ui_fold_v1 / tomato_guide_done / bottle_mypl_tracks /
     *          tomato_im_recent_themes / tomato_errbadge_off / tomato_jy_ann。
     * 迁移：loadData 尾部 migrateLegacyUiPrefs() 一次性搬入并删旧键（幂等）。 */
    uiPrefs: {
      guideDone: false, /* 新手指引是否完成（曾用 tomato_guide_done='1'） */
      myplTracks: [], /* 我的歌单 tracks（曾用 bottle_mypl_tracks） */
      storyRecent: [], /* 沉浸剧情最近使用主题 ×3（曾用 tomato_im_recent_themes） */
      errBadgeOff: false, /* M1 错误角标关闭（曾用 tomato_errbadge_off='1'） */
      annSeen: false, /* 版本更新公告已读（曾用 tomato_jy_ann=ANN_VER） */
      foldPrefs: {} /* 折叠记忆 {key: open}（曾用 tomato_ui_fold_v1） */
    },
    tree: {
      points: 0,
      harvests: [],
      lastActiveDate: null,
      lastHabitBonusDate: null,
      species: 'tomato',
      unlockedSpecies: ['tomato'],
      lastHarvestDate: null,
      fruitCount: 0,
      totalFruitsHarvested: 0,
      milestones: [],
      peakPoints: 0,
      fruitAlbum: [],
      name: '',
      speciesAlbum: {},
      treeNames: {},
      lotteryCount: 0,
      lastTouchBonusDate: null,
      mysteryTasks: { date: null, tasks: [] },
      speciesAlbumClaimed: {},
      lastWaterDate: null,
      waterStreak: 0,
      dewBadges: 0,
      lastEternalStarAt: 0,
      coins: 0,
      decorations: [],
      decorExpires: {},
      scenes: ['garden'],
      sceneExpires: {},
      activeDecorations: [],
      activeScene: 'garden',
      dailyTasks: { date: null, rewarded: [] },
      showTimerTree: false,
      timerTreeSpecies: '',
      waterProtectUntil: 0,
      streakProtectUntil: 0,
      streakHistory: [],
      usedWaterRecoveries: 0,
      usedStreakRecoveries: 0,
      streakProtectedDates: [],
      waterProtectedDates: [],
      weekTomatoSpent: 0,
      weekTomatoSpentWeek: null,
      inventory: {
        waterProtect: 0,
        streakProtect: 0,
        waterRecover: 0,
        streakRecover: 0,
        renameCard: 0,
        reviveStone: 0
      },
      nextFreeProtectAt: 7,
      activeWaterProtect: null,
      activeStreakProtect: null,
      timerTreePos: null,
      speciesPoints: {},
      plantedSpecies: ['tomato'],
      treeLifeLog: { planted: {}, maxed: {}, stars: [] },
      gachaLog: [],
      speciesLastActive: {},
      dead: false,
      deadDate: null,
      auras: [],
      auraExpires: {},
      activeAura: null,
      weather: [],
      weatherExpires: {},
      activeWeather: null,
      props: [],
      propExpires: {},
      activeProps: [],
      fortuneToday: null,
      fortuneCount: 0,
      lastFeedDate: null,
      lotBoost: 1,
      dailyGrowBoost: 1,
      chestCount: 0,
      customTreeBg: { data: '', expires: 0, blur: 0, opacity: 1, updatedAt: 0 },
      customWallpaper: { data: '', expires: 0, blur: 8, opacity: 0.55, updatedAt: 0 },
      treebgPurchaseCount: 0,
      wallpaperPurchaseCount: 0
    },
    round: { startTs: 0 },
    groupStates: {},
    countdowns: [],
    sortPrefs: { todos: { by: 'manual', dir: 'desc' }, habits: { by: 'manual', dir: 'asc' } },
    weeklyBadges: { processedWeeks: [], cumulative: {}, lastAchievedWeek: {} },
    rankSystem: {
      stars: 0,
      seasonNumber: 0,
      seasonStartDate: null,
      dailyTask: {
        date: null,
        target: 3,
        starsGainedToday: 0,
        settled: false,
        overCompleted: false,
        underCompleted: false
      },
      starProtection: 0,
      pendingStarLoss: 0,
      pendingStarLossDate: null,
      consecutiveOver: 0,
      consecutiveUnder: 0,
      consecutiveActiveDays: 0,
      lastActiveDate: null,
      streak: { count: 0, lastDate: null, claimDate: null },
      lastIdlePenaltyDate: null,
      weeklyChallenge: { weekStart: null, items: [] },
      betWinDates: [],
      dailyStarHistory: [],
      history: { maxStarsCareer: 0, maxRankNameCareer: null, seasons: [] },
      extraWeekTomatoes: 0,
      gachaNext: 3,
      easyModeUntil: null,
      easyModeBonusUsed: false,
      hasReachedGlory: false,
      hasReachedKing: false,
      rankFeedback: [],
      spentTomatoes: {},
      reroll: { date: null, count: 0, spent: 0 },
      lastSeasonDecoration: null
    },
    unlockedAchievements: [],
    /* 成就解锁后可手动领取金币奖励（pendingAchRewards=待领取成就 id） */
    pendingAchRewards: [],
    signIn: { lastDate: null, totalDays: 0 } /* 每日签到：今天签到日期 + 累计签到天数 */,
    selfRewards: [] /* 自我奖励愿望清单 {id,name,emoji,price,claimed} */,
    freeFocus: { today: null, minutes: 0, count: 0, history: [] } /* 自由专注（正计时）轻量记录，不污染番茄统计 */,
    teamSystem: {
      stars: 0,
      today: {
        date: null,
        startCode: null,
        partnerJoined: false,
        myEndCode: null,
        myCompleted: null,
        partnerEndCode: null,
        partnerCompleted: null,
        settled: false,
        settlementResult: null
      },
      history: [],
      pendingRankStarDeduction: 0,
      pendingRankStarDeductionDate: null
    },
    immersiveFocus: {
      active: false,
      scriptId: null,
      chapter: 0,
      events: [],
      consecutiveFails: 0,
      badEnding: false,
      ended: false,
      startedAt: 0,
      focusSeconds: 0,
      fear: 0,
      items: [],
      ending: null,
      unlockedAchievements: [],
      script: null,
      fixedChance: 0.4,
      recentFixed: [],
      recentRandom: []
    },
    botLeaderboard: { lastDate: null, bots: [], chaseMode: false, chaseLostStreak: 0, chaseLostDate: null },

    /* ===== 人生目标（2026-10 新增）=====
       ★ 字段名一律 life 前缀：项目里 `goal` 已被「当日番茄目标数」占用
         （renderGoalCard / claimGoalCoin / 周挑战阈值），两个 goal 混在一起
         会让人分不清「今天做几个番茄」和「今年要干什么」。
       四个集合都是"只在目标页出现"的轻量结构，不参与日历/时间块/统计计算，
       所以加它们不影响任何既有功能。 */
    lifeAreas: [],       /* [{ id:'area_health', name:'健康', emoji:'💪', order:0 }] */
    lifeGoals: [],       /* 见下方注释，字段以 00b_goal_progress 的读取为准 */
    lifeGoalOrder: [],   /* uid 数组，排序单独存：筛选态拖拽时只合并可见项 */
    /* 年初寄语：{ '2026': '一句话' }。手账九宫格最底下那几行手写。
       ★ 不塞进 reviews：寄语是**年初**写的期望，复盘是**年末**写的回看，
         同一个字段会互相覆盖 —— 年底写复盘时把年初那句话冲掉，就是丢了原件。 */
    lifeYearNotes: {},
    /* 年度关键词 { 'YYYY': '收窄' }。和 lifeYearNotes 分开存：
       关键词是一行字（写在一年的最上面，决定这一年的姿态），
       寄语是一段话（写在一年的最下面，写给年尾的自己看）。
       合成一个字段的话，想改其中一样就得重写另一样。 */
    lifeYearTheme: {},
    reviews: [],         /* 复盘快照 [{ id, period:'2026-W43', createdAt, snapshot:{}, note, nextStep }] */
    weekFocus: [],       /* 本周重点 [{ weekKey:'2026-W43', lifeGoalId, text, done }] */
    /* ★ lifeMonthPlan 撤了（旧版「月计划」）：月份一格一句在手机上填不满、
       也从不回看。老数据若还留在存档里，读的时候没人碰它，不影响。 */
  };
}
let appData = createDefaultAppData();
/* 计时状态工厂：唯一一份字段定义，startFocus/重置/恢复共用。
   初始定义与「开始专注」各手写一份 20+ 字段的话，加字段时极易漏同步
   （沉浸式新增的 liveEventShown/difficulty/lastSettledType 就曾漏在初始定义里）。 */
function createTimerState(over) {
  const s = {
    mode: 'idle',
    running: false,
    remaining: POMO_DEFAULT_MINUTES * 60,
    totalDuration: POMO_DEFAULT_MINUTES * 60,
    interval: null,
    startTime: 0,
    lastTickTime: 0,
    endAt: 0,
    pausedRemaining: 0,
    pausedElapsed: 0,
    _selId: null,
    taskName: '',
    note: '',
    linkedTodoId: null,
    /* 当前正在做的那条子任务（子任务 id，可空）：只影响记录上写哪条子计划 */
    curSubId: null,
    interruptions: [],
    currentInterruptStart: 0,
    totalInterruptSeconds: 0,
    effectiveSeconds: 0,
    microNextAt: 0,
    microActive: false,
    /* 「连续跳过」计数：原本不在默认字段里，靠 undefined || 0 兜着，
       每轮新番茄因为整个对象重建而自动归零 —— 行为对，但看不出是故意的。
       写进默认值，谁读代码都能一眼知道「这是按场次重置的」。 */
    microSkipStreak: 0,
    microIv: null,
    calibrateIv: null,
    startEnergy: null,
    startMood: null,
    check50: false,
    check75: false,
    last60vibrate: false,
    interruptIv: null,
    interruptQuotaExceeded: false,
    liveEventShown: false,
    difficulty: null,
    lastSettledType: null
  };
  if (over) Object.assign(s, over);
  return s;
}
let timerState = createTimerState();
let editingRecordId = null,
  currentLogTab = 'focus',
  audioCtx = null;
let diaryViewMode = 'single',
  currentDiaryDate = '',
  calendarYear = 0,
  calendarMonth = 0;
let diaryAutoSaveTimers = {},
  todoAutoSaveTimers = {},
  expandedTodos = {},
  editingTodos = {};
let _wakeLock = null;
let todoToDeleteId = null;
let immersionClickCount = 0,
  immersionClickTimer = null;
/* ===== IndexedDB 大容量存储（替代 localStorage 的 5MB 上限） =====
   双写策略：主存 IndexedDB（可用磁盘一半，几 GB），镜像写 localStorage（失败忽略，作快速兜底与旧数据兼容）。 */
const IDB_NAME = 'tomato_focus_db';
const IDB_STORE = 'kv';
let _idbDb = null,
  _idbOpening = null,
  _saveQueue = Promise.resolve();
function idbGetDb() {
  if (_idbDb) return Promise.resolve(_idbDb);
  if (_idbOpening) return _idbOpening;
  _idbOpening = new Promise(function (res, rej) {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () {
        _idbDb = req.result;
        _idbOpening = null;
        res(_idbDb);
      };
      req.onerror = function () {
        _idbOpening = null;
        rej(req.error);
      };
    } catch (e) {
      _idbOpening = null;
      rej(e);
    }
  });
  return _idbOpening;
}
function idbSet(key, val) {
  return idbGetDb().then(function (db) {
    return new Promise(function (res, rej) {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = function () {
        res();
      };
      tx.onerror = function () {
        rej(tx.error);
      };
    });
  });
}
function idbGet(key) {
  return idbGetDb().then(function (db) {
    return new Promise(function (res, rej) {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const rq = tx.objectStore(IDB_STORE).get(key);
      rq.onsuccess = function () {
        res(rq.result);
      };
      rq.onerror = function () {
        rej(rq.error);
      };
    });
  });
}
/* 落盘失败重试（轻量版，不做"离线操作队列"那种过度设计）：
 * 现状链路 = localStorage 同步镜像 + IndexedDB 异步主存。镜像已能兜底，
 * 但 idbWrite 若把失败吞成空 catch，IDB 写失败时既无感知、也无补救 ——
 * 一旦镜像也爆配额，两份皆失。
 * 所以：失败 → 记内存待重试（保留最后一份 payload）+ 计数；
 *       在 visibilitychange / 下轮写入时自动重试，成功则清空。
 * 设计约束：绝不抛错、绝不阻塞主流程；重试仅保最后一份（最新即最全）。 */
let _w55Pending = null; /* 最近一次写失败的 payload（最新即最全，无需队列） */
let _w55Fails = 0;
let _w55RetryTimer = null;
function _w55Retry() {
  if (!_w55Pending) return;
  const payload = _w55Pending;
  _w55Pending = null; /* 先取走，失败时下面的 catch 会重新放回 */
  _saveQueue = _saveQueue.then(function () {
    return idbSet(STORAGE_KEY, payload).catch(function (e) {
      _w55Pending = payload; /* 仍失败 → 放回，等下次机会 */
      _w55Fails++;
      if (window.__errRep && window.__errRep.silent) window.__errRep.silent(e, 'idbRetry');
    });
  });
}
/* 串行化写入，保证顺序；失败不再静默，转入重试通道（localStorage 镜像仍可用） */
function idbWrite(json) {
  if (!window.indexedDB) return;
  _saveQueue = _saveQueue.then(function () {
    return idbSet(STORAGE_KEY, json).catch(function (e) {
      /* 写失败 → 暂存内存并安排重试（原实现此处静默吞掉） */
      _w55Pending = json;
      _w55Fails++;
      if (window.__errRep && window.__errRep.silent) window.__errRep.silent(e, 'idbWrite');
      if (!_w55RetryTimer) {
        _w55RetryTimer = setTimeout(function () {
          _w55RetryTimer = null;
          _w55Retry();
        }, 3000);
      }
    });
  });
}
/* 切回前台 / 网络恢复时补一次重试（用户回到页面往往意味着可以再试） */
try {
  if (!window.__saveRetryHooked) {
    window.__saveRetryHooked = true;
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && _w55Pending) _w55Retry();
    });
    window.addEventListener('online', function () {
      if (_w55Pending) _w55Retry();
    });
  }
} catch (e) { if (window.__silent) window.__silent(e, '01b:idbWrite'); }
function ensureTreeExtras() {
  /* 种树功能字段迁移：旧数据没有新字段时补默认值
     @see ARCHITECTURE-DECISIONS.md #8（新字段 optional + 运行时默认值，不升 schema 版本） */
  if (!appData.tree.species) appData.tree.species = 'tomato';
  if (!appData.tree.unlockedSpecies || !Array.isArray(appData.tree.unlockedSpecies))
    appData.tree.unlockedSpecies = ['tomato'];
  if (!appData.tree.lastHarvestDate) appData.tree.lastHarvestDate = null;
  if (typeof appData.tree.fruitCount !== 'number') appData.tree.fruitCount = 0;
  if (typeof appData.tree.totalFruitsHarvested !== 'number') appData.tree.totalFruitsHarvested = 0;
  if (!appData.tree.milestones || !Array.isArray(appData.tree.milestones)) appData.tree.milestones = [];
  if (typeof appData.tree.peakPoints !== 'number') appData.tree.peakPoints = appData.tree.points || 0;
  if (!appData.tree.fruitAlbum || !Array.isArray(appData.tree.fruitAlbum)) appData.tree.fruitAlbum = [];
  if (typeof appData.tree.waterStreak !== 'number') appData.tree.waterStreak = 0;
  if (typeof appData.tree.dewBadges !== 'number') appData.tree.dewBadges = 0;
  if (typeof appData.tree.lastEternalStarAt !== 'number') appData.tree.lastEternalStarAt = 0;
  if (typeof appData.tree.coins !== 'number' || isNaN(appData.tree.coins))
    appData.tree.coins = Math.floor(appData.tree.points || 0); /* coin-write-allow: 首次建字段（迁移初始化，非变动） */
  /* 金币账本（余额 + 流水）· 加性字段：老存档没有它照常跑，这里只保证类型正确。
     「期初结转」（把既有余额记成第一笔流水，使 Σ流水 ≡ 余额）由 01d3 的
     coinLedgerEnsure 在首次记账/开面板时懒做 —— 那会儿 01d3 已加载完，
     而本文件执行时它还没到，不能在这里调。 */
  if (!Array.isArray(appData.tree.coinLog)) appData.tree.coinLog = [];
  if (!appData.tree.decorations || !Array.isArray(appData.tree.decorations)) appData.tree.decorations = [];
  if (!appData.tree.scenes || !Array.isArray(appData.tree.scenes)) appData.tree.scenes = ['garden'];
  if (!appData.tree.activeDecorations || !Array.isArray(appData.tree.activeDecorations))
    appData.tree.activeDecorations = [];
  if (!appData.tree.activeScene) appData.tree.activeScene = 'garden';
  if (!appData.tree.dailyTasks || !appData.tree.dailyTasks.date) appData.tree.dailyTasks = { date: null, rewarded: [] };
  if (typeof appData.tree.showTimerTree !== 'boolean') appData.tree.showTimerTree = false;
  if (typeof appData.tree.timerTreeSpecies !== 'string' || !TREE_SPECIES[appData.tree.timerTreeSpecies])
    appData.tree.timerTreeSpecies = '';
  if (typeof appData.tree.waterProtectUntil !== 'number') appData.tree.waterProtectUntil = 0;
  if (typeof appData.tree.streakProtectUntil !== 'number') appData.tree.streakProtectUntil = 0;
  if (!Array.isArray(appData.tree.streakHistory)) appData.tree.streakHistory = [];
  if (typeof appData.tree.usedWaterRecoveries !== 'number') appData.tree.usedWaterRecoveries = 0;
  if (typeof appData.tree.usedStreakRecoveries !== 'number') appData.tree.usedStreakRecoveries = 0;
  if (!Array.isArray(appData.tree.streakProtectedDates)) appData.tree.streakProtectedDates = [];
  if (!Array.isArray(appData.tree.waterProtectedDates)) appData.tree.waterProtectedDates = [];
  if (typeof appData.tree.weekTomatoSpent !== 'number') appData.tree.weekTomatoSpent = 0;
  if (typeof appData.tree.weekCoinExchanged !== 'number') appData.tree.weekCoinExchanged = 0;
  if (typeof appData.tree.weekCoinExchangedWeek === 'undefined') appData.tree.weekCoinExchangedWeek = '';
  if (!appData.tree.inventory)
    appData.tree.inventory = { waterProtect: 0, streakProtect: 0, waterRecover: 0, streakRecover: 0, renameCard: 0 };
  if (typeof appData.tree.inventory.renameCard !== 'number') appData.tree.inventory.renameCard = 0;
  if (typeof appData.tree.inventory.reviveStone !== 'number') appData.tree.inventory.reviveStone = 0;
  if (typeof appData.tree.activeWaterProtect === 'undefined') appData.tree.activeWaterProtect = null;
  if (typeof appData.tree.activeStreakProtect === 'undefined') appData.tree.activeStreakProtect = null;
  if (typeof appData.tree.timerTreePos === 'undefined') appData.tree.timerTreePos = null;
  if (!appData.tree.speciesPoints) appData.tree.speciesPoints = {};
  if (!Array.isArray(appData.tree.plantedSpecies)) appData.tree.plantedSpecies = ['tomato'];
  if (!appData.tree.speciesLastActive) appData.tree.speciesLastActive = {};
  /* 树种图鉴：按树种分别收集 9 阶段；旧数据 fruitAlbum 视为番茄树的收集 */
  if (!appData.tree.speciesAlbum) appData.tree.speciesAlbum = {};
  if (!appData.tree.treeLifeLog) appData.tree.treeLifeLog = { planted: {}, maxed: {}, stars: [] };
  /* 光环特效 / 天气 / 摆件：老数据补默认字段 */
  if (!Array.isArray(appData.tree.auras)) appData.tree.auras = [];
  if (!appData.tree.auraExpires) appData.tree.auraExpires = {};
  if (typeof appData.tree.activeAura === 'undefined') appData.tree.activeAura = null;
  if (!Array.isArray(appData.tree.weather)) appData.tree.weather = [];
  if (!appData.tree.weatherExpires) appData.tree.weatherExpires = {};
  if (typeof appData.tree.activeWeather === 'undefined') appData.tree.activeWeather = null;
  if (!Array.isArray(appData.tree.props)) appData.tree.props = [];
  if (!appData.tree.propExpires) appData.tree.propExpires = {};
  if (!Array.isArray(appData.tree.activeProps)) appData.tree.activeProps = [];
  if (typeof appData.tree.fortuneToday === 'undefined') appData.tree.fortuneToday = null;
  if (typeof appData.tree.fortuneCount !== 'number') appData.tree.fortuneCount = 0;
  if (typeof appData.tree.lastFeedDate === 'undefined') appData.tree.lastFeedDate = null;
  if (typeof appData.tree.lotBoost !== 'number') appData.tree.lotBoost = 1;
  /* 自定义皮肤（上传类）：老数据补默认字段 */
  if (!appData.tree.customTreeBg || typeof appData.tree.customTreeBg !== 'object')
    appData.tree.customTreeBg = { data: '', expires: 0, blur: 0, opacity: 1, updatedAt: 0 };
  if (!appData.tree.customWallpaper || typeof appData.tree.customWallpaper !== 'object')
    appData.tree.customWallpaper = { data: '', expires: 0, blur: 8, opacity: 0.55, updatedAt: 0 };
  if (typeof appData.tree.customTreeBg.blur !== 'number') appData.tree.customTreeBg.blur = 0;
  if (typeof appData.tree.customTreeBg.opacity !== 'number') appData.tree.customTreeBg.opacity = 1;
  if (typeof appData.tree.customWallpaper.blur !== 'number') appData.tree.customWallpaper.blur = 8;
  if (typeof appData.tree.customWallpaper.opacity !== 'number') appData.tree.customWallpaper.opacity = 0.55;
  if (typeof appData.tree.treebgPurchaseCount !== 'number') appData.tree.treebgPurchaseCount = 0;
  if (typeof appData.tree.wallpaperPurchaseCount !== 'number') appData.tree.wallpaperPurchaseCount = 0;
  if (typeof appData.tree.dailyGrowBoost !== 'number') appData.tree.dailyGrowBoost = 1;
  if (typeof appData.tree.chestCount !== 'number') appData.tree.chestCount = 0;
  if (typeof appData.tree.name === 'undefined') appData.tree.name = '';
  if (!appData.tree.treeNames) appData.tree.treeNames = {};
  /* 旧全局树名 → 归属当前树种（后续每棵树可单独起名） */
  if (appData.tree.name && !appData.tree.treeNames[appData.tree.species || 'tomato'])
    appData.tree.treeNames[appData.tree.species || 'tomato'] = appData.tree.name;
  if (!appData.tree.speciesAlbum.tomato && appData.tree.fruitAlbum && appData.tree.fruitAlbum.length)
    appData.tree.speciesAlbum.tomato = appData.tree.fruitAlbum;
  if (typeof appData.tree.dead !== 'boolean') appData.tree.dead = false;
  if (!appData.tree.deadDate) appData.tree.deadDate = null;
  if (typeof appData.tree.lotteryCount !== 'number') appData.tree.lotteryCount = 0;
  /* 林地：封树成林留下的每一代。一棵树（永恒树心）封存后记一条，
     它是比「第 N 重」更实在的超长线收藏（见 01d3 sealCurrentTree）。 */
  if (!Array.isArray(appData.tree.grove)) appData.tree.grove = [];
  if (typeof appData.tree.lastTouchBonusDate === 'undefined') appData.tree.lastTouchBonusDate = null;
  if (!appData.tree.mysteryTasks) appData.tree.mysteryTasks = { date: null, tasks: [] };
  if (!appData.tree.speciesAlbumClaimed) appData.tree.speciesAlbumClaimed = {};
  if (appData.tree.weekTomatoSpentWeek === undefined) appData.tree.weekTomatoSpentWeek = null;
  /* 迁移：当前积分存入对应树种（如果树种积分为0但树有积分，同步） */
  let _curSp = appData.tree.species || 'tomato';
  if (
    typeof appData.tree.speciesPoints[_curSp] !== 'number' ||
    (appData.tree.speciesPoints[_curSp] === 0 && (appData.tree.points || 0) > 0)
  )
    appData.tree.speciesPoints[_curSp] = appData.tree.points || 0;
  /* 限时商店迁移：老数据已有装饰/场景但没有到期时间 → 给 7 天宽限。
     ★ 只给一次（__leaseBackfilled 守卫）：原实现「只要 decorExpires 为空就按 now 重算」，
       于是一份旧备份反复导入就能无限续期（每次导入都白送 7 天）。 */
  if (!appData.tree.decorExpires) appData.tree.decorExpires = {};
  if (!appData.tree.sceneExpires) appData.tree.sceneExpires = {};
  if (!appData.tree.__leaseBackfilled) {
    appData.tree.__leaseBackfilled = true;
    if (Object.keys(appData.tree.decorExpires).length === 0 && (appData.tree.decorations || []).length > 0) {
      (appData.tree.decorations || []).forEach(function (id) {
        appData.tree.decorExpires[id] = Date.now() + 7 * DAY_MS;
      });
    }
    if (Object.keys(appData.tree.sceneExpires).length === 0 && (appData.tree.scenes || []).length > 1) {
      (appData.tree.scenes || []).forEach(function (id) {
        if (id !== 'garden') appData.tree.sceneExpires[id] = Date.now() + 7 * DAY_MS;
      });
    }
  }
  /* 抽奖次数派生化后的存量迁移（定义在 01d3，那里有 LOT_PER_DRAW 常量） */
  if (typeof migrateLotteryUsed === 'function') migrateLotteryUsed();
}
/* [瓶子专注 · 作者 瓶子满天星 · ©2026 · MIT] */
/* 陪伴语音默认值守卫（2026-10-25 决策，2c9fd8c）：默认值从 true 改成 false 之后，
   老存档里那个 companion:true 不是用户选的，是旧默认塞给他的 —— 没被主动改过
   （companionTouched !== true）就压回 false；用户自己开过的不会被按回去。
   ★ 抽成具名函数只为让 smoke 验「真实守卫」而不是复制一份判断（C109 A3/A4）。
     行为与原内联两行完全一致：启动载入（loadData）这条路仍然只走这一处口径。
     （导入 / 恢复备份那条路本来就没过这个守卫 —— 那是既有行为，本次不动。） */
function applyCompanionDefaultGuard(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  if (settings.companionTouched !== true) settings.companion = false;
  return settings;
}
async function loadData() {
  let parsed = null,
    bestT = -1,
    legacyParsed = null;
  let _sawRaw = false; /* 存储里「有 key」的标记（解析成功与否都算），用于区分「全新用户」与「读失败」 */
  /* 双源读取（localStorage 镜像 + IndexedDB 主存），按写入时间戳取较新的一份 */
  if (window.indexedDB) {
    try {
      const raw = await idbGet(STORAGE_KEY);
      if (raw) {
        _sawRaw = true;
        const obj = JSON.parse(raw);
        const t = obj && obj.d ? obj.t : 0;
        if (t > bestT) {
          bestT = t;
          parsed = obj && obj.d ? JSON.parse(obj.d) : obj;
        }
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01b:loadData'); }
  }
  try {
    const raw = TFStorage.read(STORAGE_KEY);
    if (raw) {
      _sawRaw = true;
      const obj = JSON.parse(raw);
      if (obj && !obj.d) {
        legacyParsed = obj;
      }
      const t = obj && obj.d ? obj.t : 0;
      if (t > bestT) {
        bestT = t;
        parsed = obj && obj.d ? JSON.parse(obj.d) : obj;
      }
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01b:loadData'); }
  /* 兜底：localStorage 若是旧格式（无 t/d 包装）且数据非空，而选中源恰好是空数据 → 优先旧数据（兼容跨版本过渡） */
  if (
    parsed &&
    legacyParsed &&
    legacyParsed.records &&
    legacyParsed.records.length > 0 &&
    (!parsed.records || parsed.records.length === 0)
  ) {
    parsed = legacyParsed;
  }
  try {
    if (parsed) {
/* 合并进默认结构前，先保留「文件自带的原始版本号」，供 __dataMig 版本迁移链判断。
   直接盖成当前版本会丢失升级轨迹。 */
      let _fromVer = String(parsed.version || parsed.dataVersion || '0');
      /* 迁移完成后打上当前版本号（仅作数据标记，兼容性靠「缺什么补什么」兜底，不依赖版本号） */
      parsed.version = DATA_VERSION;
      /* ★ 与导入路径（:1476）对称地过一遍 deepSanitize（P2-5）：
         主存储同样是"用户可写"的地方 —— file:// 下所有本地页面共享同一 origin，
         任一本地 HTML 都能把含 __proto__ 的 JSON 写进 tomato_focus_v3。
         Object.assign 会把 __proto__ 当普通 key 赋值、进而污染 Object.prototype，
         让后面所有「缺什么补什么」的兜底判断失真。纯核心层早就实现了净化，只是加载路径没接。 */
      appData = Object.assign(createDefaultAppData(), deepSanitize(parsed));
      appData.settings = Object.assign({}, defaultSettings, appData.settings || {});
      ensureRoundShape();
      /* 时长守卫：只有用户主动改过单番茄时长(touched=true)才保留，否则一律默认25（清除历史残留如90/20） */ if (
        appData.settings.workDurationTouched !== true
      )
        appData.settings.workDuration = POMO_DEFAULT_MINUTES;
      /* 陪伴语音守卫（2026-10-25）：默认值从 true 改成 false 了，但老用户存的
         companion:true 会被 Object.assign 覆盖回 true —— 那个 true 不是他自己选的，
         是旧默认塞给他的。所以没被主动改过时就强制关掉。
         ★ 必须有 companionTouched：否则以后用户自己打开陪伴，下次加载又被重置回 false。
         ★ 判断本体在 applyCompanionDefaultGuard（同名函数的注释里有理由）。 */
      applyCompanionDefaultGuard(appData.settings);
/* 结构合并后、字段级兜底前，执行「命名化版本迁移链」（幂等；字段级 if(typeof…) 兜底保留为最终防线）。
   迁移记录写入 appData.__migration，可查每次加载 / 导入的升级轨迹。 */
      if (window.__dataMig && _fromVer !== DATA_VERSION) {
        try {
          window.__dataMig.run(appData, _fromVer, 'load');
        } catch (_me) {
          console.error('[dataMig] load 迁移失败', _me);
        }
      }
/* 星星恒为整数：修正旧数据/异常产生的小数星（超额星按 1 点=1 星向下取整，半个番茄不产生 0.5 星） */
      if (!Number.isInteger(appData.rankSystem.stars))
        appData.rankSystem.stars = Math.floor(appData.rankSystem.stars || 0);
      /* —— 上瘾机制字段（+）：必做3件事 / 传记 / 扭蛋 / 轻松模式 / 免费保护卡 —— */
      if (!appData.mustDos) appData.mustDos = {};
      /* v2：必做卡片 UI 状态（放大视图 / 区块折叠 / 单卡展开）持久化 */
      if (!appData.mustDoUI) appData.mustDoUI = { collapse: {}, open: {} };
      if (!appData.mustDoRewarded) appData.mustDoRewarded = {};
      if (!appData.todoDoneLog || typeof appData.todoDoneLog !== 'object') appData.todoDoneLog = {};
      /* v3：计划排期快照（历史预计块），老存档补空表 */
      if (!appData.todoSchedLog || typeof appData.todoSchedLog !== 'object' || Array.isArray(appData.todoSchedLog)) appData.todoSchedLog = {};
      /* 习惯分类：老数据补默认 + 清洗（去空名/去重名），并保证 habitCatOpen 是对象 */
      appData.habitCats = normHabitCats(appData.habitCats);
      if (!appData.habitCatOpen || typeof appData.habitCatOpen !== 'object') appData.habitCatOpen = {};
      /* 习惯跳过日（2026-10-30）：老存档补空表，脏值交给 normHabitSkips 清（可单测） */
      appData.habitSkips = normHabitSkips(appData.habitSkips);
      if (!appData.biographies) appData.biographies = [];
      if (!appData.bioTriggered) appData.bioTriggered = {};
      if (appData.bioBackfillDone === undefined) appData.bioBackfillDone = false;
      /* 成就领取 + 每日签到 + 自我奖励：老数据补默认 */
      if (!Array.isArray(appData.pendingAchRewards)) appData.pendingAchRewards = [];
      if (!appData.signIn) appData.signIn = { lastDate: null, totalDays: 0 };
      if (typeof appData.signIn.totalDays !== 'number' || isNaN(appData.signIn.totalDays)) appData.signIn.totalDays = 0;
      /* 音效：老数据补默认（开 + 默认音量 100%，见 DEFAULT_SETTINGS.sfxVolume 的说明） */
      if (typeof appData.settings.sfxEnabled !== 'boolean') appData.settings.sfxEnabled = true;
      if (typeof appData.settings.sfxVolume !== 'number' || isNaN(appData.settings.sfxVolume))
        appData.settings.sfxVolume = 1.0;
      if (!Array.isArray(appData.selfRewards)) appData.selfRewards = [];
      /* 自由专注（正计时/倒计时）：老数据补默认（轻量历史，不污染番茄统计口径） */
      if (!appData.freeFocus) appData.freeFocus = { today: null, minutes: 0, count: 0, history: [] };
      if (!Array.isArray(appData.freeFocus.history)) appData.freeFocus.history = [];
      if (typeof appData.freeFocus.minutes !== 'number' || isNaN(appData.freeFocus.minutes))
        appData.freeFocus.minutes = 0;
      if (typeof appData.freeFocus.count !== 'number' || isNaN(appData.freeFocus.count)) appData.freeFocus.count = 0;
      if (appData.rankSystem.easyModeUntil == null) appData.rankSystem.easyModeUntil = null;
      if (appData.rankSystem.easyModeBonusUsed == null) appData.rankSystem.easyModeBonusUsed = false;
      if (appData.rankSystem.extraWeekTomatoes == null) appData.rankSystem.extraWeekTomatoes = 0;
      if (!appData.rankSystem.gachaNext) appData.rankSystem.gachaNext = 3;
      if (!appData.tree.nextFreeProtectAt) appData.tree.nextFreeProtectAt = 7;
      (appData.todos || []).forEach(function (_t) {
        if (!_t.subs) _t.subs = [];
        /* 重复周期：只在真有这个字段时兜底（老数据没有就不加，避免无谓地改存档形状）。
           规则不完整（缺 weekdays / 非法 mode）就整条降级为 null —— 宁可少一条规则，
           也不要留一条「永远不触发」或「天天乱触发」的坏规则。 */
        if (_t.repeat) {
          const _rr = normTodoRepeat(_t.repeat);
          _t.repeat = _rr;
          if (_rr && !_rr.next) {
            _rr.last = _rr.last || getTodayStr();
            _rr.next = nextTodoRepeatDate(_rr, getTodayStr(), false);
          }
        }
      });
      /* ===== 数据契约（2026-10-23）：uid / updatedAt / tombstones =====
         接后端时不用改业务代码，前提是现在就补齐三件事：
           ① 每条可变记录有全局唯一 uid（同步主键，多端不撞车）；
           ② 每条记录有 updatedAt（记录级 LWW 判冲突，不靠「谁后写」猜）；
           ③ 删除留墓碑（否则服务端不知道「这条被删了」，下次拉取把它复活）。
         ★ 不改现有数值 id：id 仍被 200+ 处引用（idArg / idEq / 排序 / URL 参数）。
           uid 是并列字段，老数据按「prefix + id + legacy」确定性补齐（幂等，重跑不变）。 */
      migrateDataContract();
      /* —— 段位系统：周番茄消耗 / 重掷 / 连胜 / 周挑战 / 下注 / 闲置扣星 —— */
      if (!appData.rankSystem.spentTomatoes) appData.rankSystem.spentTomatoes = {};
      if (!appData.rankSystem.reroll) appData.rankSystem.reroll = { date: null, count: 0, spent: 0 };
      if (!appData.rankSystem.streak) appData.rankSystem.streak = { count: 0, lastDate: null, claimDate: null };
      if (!appData.rankSystem.weeklyChallenge) appData.rankSystem.weeklyChallenge = { weekStart: null, items: [] };
      if (!appData.rankSystem.betWinDates) appData.rankSystem.betWinDates = [];
      if (!appData.rankSystem.lastIdlePenaltyDate) appData.rankSystem.lastIdlePenaltyDate = null;
      /* —— 组队：段位星延迟扣除 —— */
      if (appData.teamSystem.pendingRankStarDeduction === undefined) {
        appData.teamSystem.pendingRankStarDeduction = 0;
        appData.teamSystem.pendingRankStarDeductionDate = null;
      }
      /* 沉浸式专注：老数据补默认存档（含随机剧本 script 缓存字段）；剧本不存在（版本变更）则视为无冒险进行中 */ if (
        !appData.immersiveFocus
      )
        appData.immersiveFocus = createDefaultAppData().immersiveFocus;
      if (typeof appData.immersiveFocus.fixedChance !== 'number') appData.immersiveFocus.fixedChance = 0.4;
      if (!Array.isArray(appData.immersiveFocus.recentFixed)) appData.immersiveFocus.recentFixed = [];
      if (!Array.isArray(appData.immersiveFocus.recentRandom)) appData.immersiveFocus.recentRandom = [];
      if (!Array.isArray(appData.immersiveFocus.events)) appData.immersiveFocus.events = [];
      if (!Array.isArray(appData.immersiveFocus.items)) appData.immersiveFocus.items = [];
      if (!Array.isArray(appData.immersiveFocus.unlockedAchievements)) appData.immersiveFocus.unlockedAchievements = [];
      if (typeof appData.immersiveFocus.active !== 'boolean') appData.immersiveFocus.active = false;
      if (typeof appData.immersiveFocus.consecutiveFails !== 'number') appData.immersiveFocus.consecutiveFails = 0;
      if (typeof appData.immersiveFocus.script === 'undefined') appData.immersiveFocus.script = null;
      if (appData.immersiveFocus.active && appData.immersiveFocus.scriptId) {
        let _hasRndScript = !!(
          appData.immersiveFocus.script && appData.immersiveFocus.script.id === appData.immersiveFocus.scriptId
        );
        let _hasFixedScript = (UIFX.get('IMMERSIVE_SCRIPTS') || []).some(function (s) {
          return s.id === appData.immersiveFocus.scriptId;
        });
        if (!_hasRndScript && !_hasFixedScript) {
          appData.immersiveFocus.active = false;
          appData.immersiveFocus.scriptId = null;
          appData.immersiveFocus.script = null;
          appData.immersiveFocus.ended = true;
        }
      }
      /* 人机排行榜：老数据补默认 */ if (!appData.botLeaderboard) appData.botLeaderboard = { lastDate: null, bots: [] };
      if (!Array.isArray(appData.usedTags)) appData.usedTags = [];
      if (!Array.isArray(appData.botLeaderboard.bots)) appData.botLeaderboard.bots = [];
      if (typeof appData.botLeaderboard.chaseMode === 'undefined') {
        appData.botLeaderboard.chaseMode = false;
        appData.botLeaderboard.chaseLostStreak = 0;
        appData.botLeaderboard.chaseLostDate = null;
      }
      ensureTreeExtras(); /* tree 扩展字段迁移（loadData 与导入共用） */
      /* 把读到的数据（含时间戳）镜像写入 IndexedDB，完成旧数据迁移 */
      if (window.indexedDB) idbWrite(JSON.stringify({ t: Date.now(), d: JSON.stringify(appData) }));
    } else {
      appData.settings = Object.assign({}, defaultSettings);
    }
  } catch (e) {
    console.error('加载失败', e);
    appData.settings = Object.assign({}, defaultSettings);
  }
  sanitizeNumericSettings();
  /* ===== 收编后首次加载时，把历史散键值一次性搬进 appData.uiPrefs 并删旧键（幂等） ===== */
  try {
    migrateLegacyUiPrefs();
  } catch (_me) {
    console.error('[uiPrefs] 迁移失败', _me);
  }
  /* ★ 放行写盘的判据：
     ① 读到数据（parsed 非空）→ 放行；
     ② 存储里根本没有 key（真·全新用户）→ 放行；
     ③ 有 key 却读不出来（JSON 解析失败 / IndexedDB 异常）→ **不放行**。
        此时 appData 是空壳，放行就会把用户的数据抹成空 ——
        「暂时存不上」远好过「把原数据覆盖掉」，该修的是存储，不是覆盖它。 */
  _dataLoaded = !!parsed || !_sawRaw;
  /* 记住"载入时存储的版本时间戳"：之后若发现存储里的时间戳比它更新、且不是本窗口写的，
     就说明另一个窗口在我们之后写过盘，本窗口的内存已经过期（守卫 3）。 */
  if (bestT > 0) _lastWriteT = bestT;
  _lastNonEmptyScale = _dataScale(appData);
  if (!_dataLoaded) {
    try {
      if (window.__errRep) window.__errRep.warn('load', '存储中有数据但读取失败，已暂停写盘以保护原数据');
    } catch (_e1) { if (window.__silent) window.__silent(_e1, '01b:loadData'); }
    try {
      UIFX.toast('⚠️ 数据读取异常，已暂停保存以保护原数据。请先导出备份或刷新重试');
    } catch (_e2) { if (window.__silent) window.__silent(_e2, '01b:loadData'); }
  }
}
/* ===== 历史散键 → appData.uiPrefs 一次性搬迁 =====
 * 老版本把同一状态分别存在 localStorage 副键（折叠/引导/歌单/剧情/角标/公告/旅程），
 * 收编后统一只认 appData.uiPrefs 与 appData.journey（主存储单真相）。
 * 本函数幂等：旧键不存在（已搬迁/全新用户）即 no-op。搬迁后立刻 removeItem，不留副本。
 * 注：AR_KEY / AUTO_BACKUP_KEY / IMPORTED_SCRIPTS_KEY 属大内容/独立副本，故意不搬。 */
function migrateLegacyUiPrefs() {
  let u = appData.uiPrefs;
  if (!u || typeof u !== 'object') {
    u = appData.uiPrefs = createDefaultAppData().uiPrefs;
  }
  function _read(k) {
    try {
      return TFStorage.read(k);
    } catch (e) {
      return null;
    }
  }
  function _drop(k) {
    try {
      TFStorage.remove(k);
    } catch (e) { if (window.__silent) window.__silent(e, '01b:_drop'); }
  }
  /* 1) 折叠记忆：{key: open} 原样搬入 foldPrefs */
  let _fold = _read('tomato_ui_fold_v1');
  if (_fold) {
    try {
      let _fo = JSON.parse(_fold);
      if (_fo && typeof _fo === 'object' && !Array.isArray(_fo)) {
        for (let _k in _fo) if (Object.prototype.hasOwnProperty.call(_fo, _k)) u.foldPrefs[_k] = _fo[_k];
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01b:_drop'); }
    _drop('tomato_ui_fold_v1');
  }
  /* 2) 新手指引完成 */
  if (_read('tomato_guide_done') === '1') {
    u.guideDone = true;
    _drop('tomato_guide_done');
  }
  /* 3) 我的歌单 tracks */
  let _mypl = _read('bottle_mypl_tracks');
  if (_mypl) {
    try {
      let _mt = JSON.parse(_mypl);
      if (Array.isArray(_mt)) u.myplTracks = _mt;
    } catch (e) { if (window.__silent) window.__silent(e, '01b:_drop'); }
    _drop('bottle_mypl_tracks');
  }
  /* 4) 沉浸剧情最近主题 */
  let _story = _read('tomato_im_recent_themes');
  if (_story) {
    try {
      let _st = JSON.parse(_story);
      if (Array.isArray(_st)) u.storyRecent = _st;
    } catch (e) { if (window.__silent) window.__silent(e, '01b:_drop'); }
    _drop('tomato_im_recent_themes');
  }
  /* 5) M1 错误角标关闭 */
  if (_read('tomato_errbadge_off') === '1') {
    u.errBadgeOff = true;
    _drop('tomato_errbadge_off');
  }
  /* 6) 更新公告已读（ANN_VER='1'，语义=已读本版公告） */
  if (_read('tomato_jy_ann') === '1') {
    u.annSeen = true;
    _drop('tomato_jy_ann');
  }
  /* 7) 旅程状态兜底：主存储缺失时才认旧 JKEY（正常情况下主存储已是真相，此分支只防极端老档） */
  if (!appData.journey) {
    let _jraw = _read('tomato_journey_v1');
    if (_jraw) {
      try {
        let _j = JSON.parse(_jraw);
        if (_j && typeof _j.enabled === 'boolean') appData.journey = _j;
      } catch (e) { if (window.__silent) window.__silent(e, '01b:_drop'); }
    }
  }
  _drop('tomato_journey_v1');
  if (u.foldPrefs && typeof u.foldPrefs !== 'object') u.foldPrefs = {};
}
/* 防抖包装：300ms 内多次调用合并为一次，减少全量序列化 + 双写开销 */
let _saveTimer = null;
let _lsMirrorWarned = false;
let _jsonFailWarned = false;
/* 空写告警只提示一次，避免刷屏 */
let _emptyWriteBlocked = false;
/* [瓶子专注 · 作者 瓶子满天星 · ©2026 · MIT] */
/* 跨模块可变绑定的唯一写入口（ESM 的 import 绑定只读，外部不能直接赋值） */
function __setTodoToDeleteId(v) { todoToDeleteId = v; }

/* ===== 数据契约工具（2026-10-23）=============================================
 * 三项能力，服务于「将来接后端不用改业务代码」：
 *   newUid / 设备码   —— 记录级同步主键
 *   touchRecord      —— 记录级更新时间（LWW 判冲突的依据）
 *   tombstone        —— 删除墓碑（让服务端知道「这条被删了」，否则同步会复活）
 * 兼容策略：老数据没有这些字段，migrateDataContract() 按确定性规则补齐（幂等）。
 * ========================================================================== */
const TOMBSTONE_MAX = 2000;          /* 墓碑上限：超过按时间裁旧，避免无限增长 */
const DEVICE_TAG_KEY = 'tomato_device_tag';

/* 设备短码：同一个人两台设备同时创建记录时，把 uid 撞车概率再压一档。
   只用于 uid 后缀，不参与任何业务判断；取不到就退化成空串（uid 仍然唯一）。 */
function _deviceTag() {
  try {
    var v = TFStorage.read(DEVICE_TAG_KEY);
    if (!v || v.length < 3) {
      v = Math.random().toString(36).slice(2, 6);
      TFStorage.write(DEVICE_TAG_KEY, v);
    }
    /* 模块作用域下 window.__deviceTag 不会被 newUid 里的 typeof window 直接读到，
       所以显式挂上；普通 script 下这行等价于全局赋值，行为不变。 */
    window.__deviceTag = v;
    return v;
  } catch (e) {
    return '';
  }
}

/* 打更新戳：记录的「最后一次就地修改」时间。
   为什么不用 endTime：编辑一条三个月前的记录，endTime 还是三个月前，
   同步时会被判定为「服务端更新」而被覆盖 —— 用户改的内容凭空消失。 */
function touchRecord(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  obj.updatedAt = Date.now();
  /* 顺手入队（01b3_sync）：编辑 → 待推送。没有这一步，「离线改了但没联网」
     的记录上线后不会被发现 —— 全量比对既慢又可能把本地新值当成旧值。 */
  if (obj.uid && typeof enqueueChange === 'function') enqueueChange(obj.uid, _kindOfUid(obj.uid), 'upsert');
  return obj;
}

/* 写墓碑。同一条重复删除只更新时间，不重复追加（幂等：重复导入同一份备份不会膨胀）。 */
function tombstone(uid, kind) {
  if (!uid) return;
  if (!Array.isArray(appData.tombstones)) appData.tombstones = [];
  var now = Date.now();
  var hit = null;
  for (var i = 0; i < appData.tombstones.length; i++) {
    if (idEq(appData.tombstones[i] && appData.tombstones[i].uid, uid)) { hit = appData.tombstones[i]; break; }
  }
  if (hit) hit.deletedAt = now;
  else appData.tombstones.push({ uid: String(uid), kind: kind || 'record', deletedAt: now });
  /* 删除同样入队：服务端要知道「这条没了」，而不是「这边少一条」。 */
  if (typeof enqueueChange === 'function') enqueueChange(uid, kind || _kindOfUid(uid), 'delete');
  if (appData.tombstones.length > TOMBSTONE_MAX) {
    appData.tombstones.sort(function (a, b) { return (a.deletedAt || 0) - (b.deletedAt || 0); });
    appData.tombstones = appData.tombstones.slice(-TOMBSTONE_MAX);
  }
}

/* 墓碑并集：同 uid 保留更晚的 deletedAt。导入/合并时用 ——
   取并集而不是覆盖，否则「本机删过、备份里还在」的记录会被当成新增重新上传。 */
function mergeTombstones(a, b) {
  var map = {};
  var out = [];
  var push = function (x) {
    if (!x || !x.uid) return;
    var k = String(x.uid);
    var t = Number(x.deletedAt) || 0;
    if (map[k] === undefined) { map[k] = out.length; out.push({ uid: k, kind: x.kind || 'record', deletedAt: t }); }
    else if (t > out[map[k]].deletedAt) { out[map[k]].deletedAt = t; if (x.kind) out[map[k]].kind = x.kind; }
  };
  (Array.isArray(a) ? a : []).forEach(push);
  (Array.isArray(b) ? b : []).forEach(push);
  if (out.length > TOMBSTONE_MAX) {
    out.sort(function (x, y) { return x.deletedAt - y.deletedAt; });
    out = out.slice(-TOMBSTONE_MAX);
  }
  return out;
}

/* 记录被删后是否仍处于「墓碑」里（导入合并时用来挡住「已删又被带回来」）。 */
function isTombstoned(uid) {
  if (!uid || !Array.isArray(appData.tombstones)) return false;
  for (var i = 0; i < appData.tombstones.length; i++) {
    if (idEq(appData.tombstones[i] && appData.tombstones[i].uid, uid)) return true;
  }
  return false;
}

/* 给一条老记录补契约字段。uid 必须是**确定性**的：同一条记录重复迁移得到同一个 uid，
   否则每次加载都会变，同步时会被当成新记录。 */
function _ensureContract(o, prefix, seen) {
  if (!o || typeof o !== 'object') return false;
  var changed = false;
  if (!o.uid) {
    /* 确定性派生：同一条记录每次迁移得到同一个 uid（否则同步会当成新记录反复创建）。
       ★ 但 id 本身**不保证唯一**（补记用 Date.now()+rand(1000)，同毫秒有 1/1000 概率撞），
         撞了的 legacy uid 会让两条不同记录在合并时被当成一条 —— 丢数据且无报错。
         所以这里按「首次出现占原名，后续加序号」去重：同一份数据重复迁移仍然稳定。 */
    var base = prefix + '_' + String(o.id != null ? o.id : 'x') + '_legacy';
    var uid = base, n = 1;
    while (seen && seen[uid]) { n++; uid = base + '_' + n; }
    if (seen) seen[uid] = 1;
    o.uid = uid;
    changed = true;
  } else if (seen) {
    seen[String(o.uid)] = 1;
  }
  if (typeof o.updatedAt !== 'number' || !isFinite(o.updatedAt)) {
    /* 老记录没有编辑时间：退到「这条记录自己的时间」，比 0 更接近事实，
       也让「编辑过」和「没编辑过」在同步里有区分度。 */
    var t = Number(o.endTime || o.startTime || o.ts || 0);
    if (!t && o.createdAt) t = Date.parse(o.createdAt) || 0;
    o.updatedAt = t || 0;
    changed = true;
  }
  return changed;
}

/* 全量补齐（加载与导入共用）。幂等：跑多少次结果都一样。 */
function migrateDataContract() {
  if (!appData) return 0;
  _deviceTag();
  var n = 0;
  if (!Array.isArray(appData.tombstones)) appData.tombstones = [];
  if (!Array.isArray(appData.outbox)) appData.outbox = [];
  /* seen 是全局去重表：不同集合的前缀不同，本来不会互相撞；
     共用一张表还能顺手挡住「导入两份数据导致前缀相同」的情况。 */
  var seen = Object.create(null);   /* uid 来自备份，用户可控：避免 __proto__ 键 */
  (appData.records || []).forEach(function (r) { if (_ensureContract(r, 'rec', seen)) n++; });
  /* ===== 修历史：起点与时长对不上的记录（2026-10-29）=====
     正计时 / 自由专注的 startTime 曾经存的是「最后一次继续」的时刻，而 effectiveSeconds
     是累计专注时长 —— 一次 31 分钟的专注会落成 21:40~21:49（8 分钟），日志自相矛盾。
     新记录已经在 savePomodoroRecord 里按「结束 − 累计时长」写对了，这里补旧的。
     动手条件很保守：时长比区间**多出 15 秒以上**才改（正常番茄的误差在 1 秒内，不会被误伤）；
     改完区间正好等于时长，所以幂等 —— 下次再跑判据不成立。
     ★ 不要试图恢复「真实的墙钟起点」：暂停时长没有单独记录，推不回来；
       能保证的只是「区间长度 == 专注时长」这一条自洽的口径。 */
  (appData.records || []).forEach(function (r) {
    var eff = Number(r.effectiveSeconds) || 0;
    var st = Number(r.startTime) || 0;
    var en = Number(r.endTime) || 0;
    if (eff <= 0 || st <= 0 || en <= st) return;
    if (en - st + 15000 < eff * 1000) {
      r.startTime = Math.max(0, en - eff * 1000);
      r.updatedAt = r.updatedAt || en;
      /* uid 不能变（它是同步主键，改了就成"另一端的新记录"）；这里只动时间戳。 */
      n++;
    }
  });
  (appData.todos || []).forEach(function (t) {
    if (_ensureContract(t, 'todo', seen)) n++;
    (t.subs || []).forEach(function (sb) { if (_ensureContract(sb, 'sub', seen)) n++; });
  });
  /* 眼睛（t.eyesOff = 点它那天的日期串）过期就删掉：它是「今天先不看」的一次性记号，
     第二天起不再被任何判断读到（todoEyesOff 比的是当天日期），留着只是每个计划多 10 字节。
     同一条约束：只留会再被读到的字段。 */
  (appData.todos || []).forEach(function (t) {
    if (!t || !t.eyesOff) return;
    if (String(t.eyesOff).slice(0, 10) < getTodayStr()) { delete t.eyesOff; n++; }
  });
  (appData.habits || []).forEach(function (h) { if (_ensureContract(h, 'habit', seen)) n++; });
  /* 习惯的子计划（2026-11-04）：从同步/导入进来的 subs 可能是脏的
     （空名、没 id、日期写成 '2026/11/4'、time 带秒）—— 统一过一遍 normHabitSubs。
     只在**确有变化**时写回，避免每次启动都 n++ 触发「数据已修正」提示。 */
  (appData.habits || []).forEach(function (h) {
    if (!h || h.subs === undefined) return;
    if (!Array.isArray(h.subs)) { delete h.subs; n++; return; }
    const norm = normHabitSubs(h.subs);
    const before = JSON.stringify(h.subs);
    if (JSON.stringify(norm) !== before) {
      if (norm.length) h.subs = norm; else delete h.subs;
      n++;
    }
  });
  (appData.memos || []).forEach(function (m) { if (_ensureContract(m, 'memo', seen)) n++; });
  /* 倒计时 / 计划提醒同样是可变记录：同步时也要能唯一标识与判先后 */
  (appData.countdowns || []).forEach(function (c) { if (_ensureContract(c, 'cd', seen)) n++; });
  (appData.todos || []).forEach(function (t) {
    (t.reminds || []).forEach(function (r) { if (_ensureContract(r, 'remind', seen)) n++; });
  });
  /* ===== 人生目标（2026-10 新增）=====
     ① 形状兜底必须用 if (!Array.isArray(x))，不能用 `??` ——
        全仓既有写法都是这一套，而且 `Object.assign(默认, 导入的)` 是浅合并，
        备份里 `lifeGoals: null` 会盖掉默认的 `[]`，之后 `lifeGoals.length` 直接 TypeError。
     ② 补 uid / updatedAt：同步与删除墓碑（tombstones）都靠它们认「同一条」，
        漏了会出现"改了目标但另一端当新记录"。
     前缀用 lg / rv：_kindOfUid 取第一个 `_` 之前的部分，同步池的键名必须与之相同。 */
  if (!Array.isArray(appData.lifeAreas)) appData.lifeAreas = [];
  if (!Array.isArray(appData.lifeGoals)) appData.lifeGoals = [];
  if (!Array.isArray(appData.lifeGoalOrder)) appData.lifeGoalOrder = [];
  if (!Array.isArray(appData.reviews)) appData.reviews = [];
  if (!Array.isArray(appData.weekFocus)) appData.weekFocus = [];
  appData.lifeAreas.forEach(function (a) { if (_ensureContract(a, 'area', seen)) n++; });
  appData.lifeGoals.forEach(function (g) { if (_ensureContract(g, 'lg', seen)) n++; });
  /* ★ 年度目标的「开始」曾经写死成当年 1 月 1 日（不管用户哪天建）。
     于是 10 月才立的目标一上来就「时间已过 82% · 落后」，弹窗里还带
     3/6/9 三个自己根本不在场的季度检查点，永远确认不了、永远显示 0/4。
     只修一种：开始日 = 当年 1 月 1 日，但这条目标是 1 月 8 日之后才建的。
     那是默认值填的，不是用户填的。真从年初开始做（1 月初就建了）或者
     自己改过开始日的，一律不动；改过的打 startFixed 标记，不再看第二眼。 */
  appData.lifeGoals.forEach(function (g) {
    if (!g || g.startFixed) return;
    if ((g.horizon || 'year') !== 'year') return;
    if (!/^\d{4}-01-01$/.test(String(g.startDate || ''))) return;
    var ca = Number(g.createdAt ? Date.parse(g.createdAt) : 0);
    if (!ca) return;
    var cd = new Date(ca);
    var y = cd.getFullYear();
    if (y + '-01-01' !== g.startDate) return;
    var created = y + '-' + ('0' + (cd.getMonth() + 1)).slice(-2) + '-' + ('0' + cd.getDate()).slice(-2);
    if (created <= g.startDate) return;
    if (ca - new Date(y + '-01-01T00:00:00').getTime() < 7 * 86400000) return;
    g.startDate = created;
    g.startFixed = 1;
    n++;
  });

  appData.reviews.forEach(function (r) { if (_ensureContract(r, 'rv', seen)) n++; });
  /* 周重点也要 uid：同步池按 wf_ 前缀认它（01b3 的 pool），
     没有 uid 的老数据会在第一次合并时被丢掉。 */
  appData.weekFocus.forEach(function (w) { if (_ensureContract(w, 'wf', seen)) n++; });
  /* 排序表里可能残留已删目标的 uid：只保留仍然存在的，否则拖拽下标会错位。
     ★ 比的是 **uid**，不是 id —— lifeGoalOrder 里存的一直是 uid
       （lifeGoalSorted 的 rank 用 order.indexOf(g.uid)）。这里原来写成 g.id === id，
       于是每次启动都把整张排序表静默清空；因为一期的顺序恰好和 createdAt 顺序
       一致（rank 全是 9999 时退回按创建时间排），所以一直没人发现。
       同时兼容 uid 和 id：早期数据/手改备份里可能混着 id。 */
  appData.lifeGoalOrder = appData.lifeGoalOrder.filter(function (key) {
    return appData.lifeGoals.some(function (g) {
      return g && (idEq(g.uid, key) || idEq(g.id, key));
    });
  });
  return n;
}

function saveData() {
  if (_dataClearing) return;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    _saveDataImmediate();
  }, 300);
}
function saveDataNow() {
  if (_dataClearing) return;
  /* 兜底失效段落索引（定义在 01d，本文件先于它加载 → 用 typeof 防守）：
     任何一次落盘都当作"记录可能变过"，宁可重建一次也别让界面读到陈旧段落。 */
  if (typeof tbInvalidateSegIndex === 'function') tbInvalidateSegIndex();
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  _saveDataImmediate();
}
/* ===== 守卫 3：另一个窗口写过盘 → 本窗口的内存是旧的，绝不覆盖 =====
   实测丢失：App 和浏览器里打开的同一份 html 各持一份内存。早上那个从昨晚
   20:02 起就没再重载过的窗口醒过来跑日切，一份 20:02 的旧数据把 22:57 的数据整份盖掉
   （记录 63→60、数学排期、深色模式、英语完成全没了）。
   判据：存储旁的 WRITE_STAMP_KEY 记着"最后一次写盘是谁、什么时候"。
   若它不是本窗口写的、且时间晚于本窗口载入的时间 → 别人写过更新的数据。
   处置：本次写盘直接作废 + 提示 + 重载（重载后拿到的就是存储里的新数据，不会循环）。 */
function _staleOtherInstance() {
  let st = null;
  try {
    st = JSON.parse(TFStorage.read(WRITE_STAMP_KEY) || 'null');
  } catch (e) {
    st = null;
  }
  if (!st || !st.id || st.id === _INSTANCE_ID) return 0;
  const t = Number(st.t) || 0;
  if (!(t > _lastWriteT + 1000)) return 0;
  return t;
}
function _guardStaleWrite() {
  const t = _staleOtherInstance();
  if (!t) return false;
  if (!_staleWarned) {
    _staleWarned = true;
    try {
      if (window.__errRep)
        window.__errRep.warn('save', '检测到另一个窗口写入了更新的数据（' + new Date(t).toISOString() + '），本窗口停止覆盖并重新载入');
    } catch (e) { if (window.__silent) window.__silent(e, '01b:_guardStaleWrite'); }
    try {
      UIFX.toast('⚠️ 另一个窗口有更新的数据，正在重新载入，以免覆盖它');
    } catch (e2) { if (window.__silent) window.__silent(e2, '01b:_guardStaleWrite'); }
  }
  /* 交回控制权再重载：让当前调用栈里的 UI 收尾，避免半途跳走。
     用例页要断言"这次写盘被挡下了"，不能真的重载 → 给测试留一个开关。 */
  if (window.__staleNoReload) return true;
  /* ★ 2026-10-28：页面在后台时不立刻重载。
     后台重载的观感正是用户报的那句「我一会没看，进去就自己刷一下」——
     切回来的头一帧是重新解析中的半截页面，人看到的是闪一下再重来。
     数据安全不依赖这次重载（写盘已经在本函数里被拦下了），所以挂起到「真的可见」再刷：
     用户回到前台的第一眼已经是完整页面。 */
  const _doReload = function () {
    try {
      location.reload();
    } catch (e) { if (window.__silent) window.__silent(e, '01b:_guardStaleWrite'); }
  };
  if (document.hidden) {
    if (!_staleReloadPending) {
      _staleReloadPending = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        setTimeout(_doReload, 300);
      });
    }
    return true;
  }
  setTimeout(_doReload, 600);
  return true;
}
function _saveDataImmediate() {
  if (_dataClearing) return;
  /* 守卫 1（根因修复）：数据还没从存储读回来，绝不写盘 —— 否则写的是空壳。
     这条同时保护防抖路径与 saveDataNow()，且不受调用来源影响。 */
  if (!_dataLoaded) return;
  try {
    appData.__fingerprint = 'bottle-pomodoro-fingerprint-2026';
  } catch (e) { if (window.__silent) window.__silent(e, '01b:_saveDataImmediate'); }
  let json = '';
  try {
    json = JSON.stringify(appData);
  } catch (e) {
    /* 序列化失败（循环引用 / 超深结构等）：镜像与 IndexedDB 都不会写，本次保存彻底丢失。
       绝不能静默——否则用户以为存上了，实际每次操作都在丢。留痕 + 首次提示导出。 */
    if (!_jsonFailWarned) {
      _jsonFailWarned = true;
      try {
        if (window.__errRep) window.__errRep.warn('save', '数据序列化失败，本次未保存：' + ((e && e.message) || e));
      } catch (e2) { if (window.__silent) window.__silent(e2, '01b:_saveDataImmediate'); }
      try {
        UIFX.toast('⚠️ 数据保存失败，请尽快导出备份');
      } catch (e2) { if (window.__silent) window.__silent(e2, '01b:_saveDataImmediate'); }
    }
    return;
  }
  if (json) {
    /* 守卫 2（兜底）：把「本该有数据」的存储写成全空，几乎必然是异常（竞态、误操作、
       外部清空了存储）。唯一的合法清空路径是设置页的「清除所有数据」——
       那条路会先置 _dataClearing 并在上面直接 return，走不到这里。
       阈值取 3：删最后 1~2 条时放行（用户确实可能清空到只剩一两条），
       而「几十上百条一次归零」一律拦下。宁可让用户删不掉，也不能让他丢掉全部。 */
    if (_dataScale(appData) === 0 && _lastNonEmptyScale >= 3) {
      if (!_emptyWriteBlocked) {
        _emptyWriteBlocked = true;
        try {
          if (window.__errRep) window.__errRep.warn('save', '检测到数据被清空，已阻止写入（防误删）。当前规模基线 ' + _lastNonEmptyScale);
        } catch (e2) { if (window.__silent) window.__silent(e2, '01b:_saveDataImmediate'); }
        try {
          UIFX.toast('⚠️ 检测到数据被清空，已阻止保存以免丢失。若确实要清空，请用设置页的「清除所有数据」');
        } catch (e2) { if (window.__silent) window.__silent(e2, '01b:_saveDataImmediate'); }
      }
      return;
    }
    const _writeT = Date.now();
    const payload = JSON.stringify({ t: _writeT, d: json });
    /* 守卫 3：另一个窗口在我们之后写过盘 → 本窗口内存是旧的，这次写盘作废 */
    if (_guardStaleWrite()) return;
    try {
      TFStorage.write(STORAGE_KEY, payload);
      /* 写盘成功才更新写入戳：镜子写失败时戳也停在旧值，别让别的窗口误以为我们成功了 */
      try {
        TFStorage.write(WRITE_STAMP_KEY, JSON.stringify({ id: _INSTANCE_ID, t: _writeT }));
      } catch (_eStamp) { if (window.__silent) window.__silent(_eStamp, '01b:_saveDataImmediate'); }
      _lastWriteT = _writeT;
    } catch (e) {
      /* 镜像写失败（多半是配额爆满）：保留上一次成功的镜像作为冷备份，绝不删除——
       删除会造成「local 无镜像 + IndexedDB 异步尚未落盘」的极端窗口下两份数据皆失。 */
      if (!_lsMirrorWarned) {
        _lsMirrorWarned = true;
        console.warn('[存储] localStorage 镜像写入失败：保留旧镜像兜底，数据以 IndexedDB 为准');
        try {
          if (window.__errRep) window.__errRep.warn('storage', 'localStorage 镜像写入失败：保留旧镜像兜底，数据以 IndexedDB 为准');
        } catch (e2) { if (window.__silent) window.__silent(e2, '01b:_saveDataImmediate'); }
      }
    }
    idbWrite(payload);
    const _sc = _dataScale(appData);
    if (_sc > 0) _lastNonEmptyScale = _sc;
  }
  checkStorageUsage(json);
}
/* ===== 容量监控 + 旧记录精简（数据量保险，IndexedDB 容量已大幅提升） ===== */
let _lastStorageWarn = 0;
/* 大数单位化：>=1千 用「千」，>=1万 用「万」，>=1亿 用「亿」（避免大数挤压版式） */
function fmtUnitLarge(n) {
  n = Number(n);
  if (isNaN(n)) n = 0;
  n = Math.round(n);
  if (n >= 100000000) {
    let v = n / 100000000;
    return (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + '亿';
  }
  if (n >= 10000) {
    let v = n / 10000;
    let s = (v >= 10 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');
    return s + '万';
  }
  if (n >= 1000) {
    let v = n / 1000;
    let s = (v >= 10 ? v.toFixed(0) : v.toFixed(1)).replace(/\.0$/, '');
    return s + '千';
  }
  return String(n);
}
function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}
function checkStorageUsage(json) {
  if (Date.now() - _lastStorageWarn < 60000) return;
  try {
    const bytes = new Blob([json || '']).size;
    if (bytes > 30 * 1024 * 1024) {
      _lastStorageWarn = Date.now();
      UIFX.toast('📦 数据量已达 ' + formatBytes(bytes) + '，建议导出备份');
    } else if (bytes > 3 * 1024 * 1024) {
      _lastStorageWarn = Date.now();
      UIFX.toast('📦 数据量已达 ' + formatBytes(bytes) + '，可定期导出备份');
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01b:checkStorageUsage'); }
}
function exportData() {
  try {
    /* 通用规则：不做字段白名单 —— 手写清单必然遗漏（此前的实现漏了 freeFocus、
       signIn、journey、幽灵挑战、奖励等 17 个字段，「全部数据」名不副实）。
       改为「appData 的每个顶层字段原样导出 + audit 自检」，以后加新字段自动带上。 */
    const backup = {};
    let copied = 0;
    Object.keys(appData).forEach(function (k) {
      try {
        backup[k] = appData[k];
        copied++;
      } catch (e) { if (window.__silent) window.__silent(e, '01b:exportData'); }
    });
    backup.version = DATA_VERSION;
    backup.exportSchema = EXPORT_SCHEMA_VERSION;
    backup.exportDate = getTodayStr();
    backup.exportTime = new Date().toISOString();
    backup.audit = { appDataKeys: Object.keys(appData).length, exportedKeys: copied };
    const data = JSON.stringify(backup, null, 2);
    const fileName = 'tomato_backup_' + getTodayStr() + '.json';
    /* 导出副作用（下载与系统分享共用）：刷新备份提醒 + 记录导出日 */
    const exportDone = function () {
      /* 部分浏览器（WebView 内核）下载 blob 时会丢掉下面指定的文件名，
         改用随机串命名。把建议文件名一并显示出来，便于用户重命名。 */
      UIFX.toast('已导出 · 建议保存为 ' + fileName);
      appData.lastExportDate = getTodayStr();
      saveData();
      updateBackupReminder();
    };
    /* 浏览器下载（默认路径） */
    const downloadExport = function () {
      const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) { if (window.__silent) window.__silent(e, '01b:exportData'); }
      }, 100);
    };
/* 移动端优先走系统分享面板（可「存储到文件 / 发给自己」，换机闭环更顺）；
   能力不可用 / 用户取消 / 分享失败 → 自动回退浏览器下载 */
    if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare && typeof File !== 'undefined') {
      try {
        const shareFile = new File([data], fileName, { type: 'application/json;charset=utf-8' });
        if (navigator.canShare({ files: [shareFile] })) {
          navigator
            .share({ files: [shareFile], title: '🍅 番茄专注数据备份', text: '番茄专注数据备份（JSON，可重新导入）' })
            .then(exportDone)
            .catch(function (err) {
              if (err && err.name === 'AbortError') return; /* 用户取消分享：不打扰、不落下载 */
              try {
                downloadExport();
                exportDone();
              } catch (e2) {
                exportDone();
              }
            });
          return;
        }
      } catch (eShare) { if (window.__silent) window.__silent(eShare, '01b:exportData'); }
    }
    downloadExport();
    exportDone();
  } catch (e) {
    UIFX.toast('导出失败：' + e.message);
  }
}
/* ===== 数据备份与恢复（安全加固） ===== */
/* 自动备份：导入/清除数据前，把当前数据存一份（含时间），供误操作兜底恢复（低频操作，不卡顿） */
function saveAutoBackup() {
  try {
    TFStorage.write(AUTO_BACKUP_KEY, JSON.stringify({ time: new Date().toISOString(), data: appData }));
    return true;
  } catch (e) {
    /* 绝不静默：兜底失效必须留痕（角标/可导出），否则用户以为备过份、直到误操作才发现没有 */
    try {
      if (window.__errRep) window.__errRep.warn('autobackup', '自动备份写入失败：' + ((e && e.message) || e));
    } catch (e2) { if (window.__silent) window.__silent(e2, '01b:saveAutoBackup'); }
    return false;
  }
}
/* 自动备份失败时的统一处置（导入 / 清除 / 恢复自动备份 三处共用）。
   这三处都是「先备份当前数据、再覆盖它」的破坏性操作，备份失败意味着没有退路。
   返回 Promise<true|false>：true = 继续（用户已确认知晓风险）；false = 中止本次操作。
   正常情况（备份成功）直接 resolve(true)，不打扰用户。 */
function _autoBackupGuard(action) {
  if (saveAutoBackup()) return Promise.resolve(true);
  const _msg =
    '⚠️ 自动备份失败（多半是存储空间不足，或浏览器禁用了本地存储）。\n\n' +
    action + '之后，当前数据将无法找回。\n' +
    '建议先取消，回设置页点「导出全部数据（JSON）」手动存一份。\n\n' +
    '确定仍要继续吗？';
  if (typeof window.rsConfirm === 'function')
    return window.rsConfirm(_msg, { title: '无法自动备份', okText: '仍要继续', danger: true });
  return Promise.resolve(confirm(_msg));
}
/* 校验备份文件结构是否合法，防止导错文件 / 旧版本导致数据损坏。
   返回 {ok, reason, warns[]}：importData / 恢复自动备份 用 reason 给出具体失败原因；
   warns 收集可修复的旧格式提示（结构性缺失不阻断，字段级兜底会补齐）。 */
function validateBackup(data) {
  const warns = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: '不是备份对象', warns };
  /* 更高 exportSchema 的备份可能含当前版本不认识的结构 → 拒绝并提示升级，防静默错位 */
  if (data.exportSchema !== undefined && Number(data.exportSchema) > EXPORT_SCHEMA_VERSION)
    return {
      ok: false,
      reason:
        '该备份由更新版本导出（schema ' +
        data.exportSchema +
        ' > 当前 ' +
        EXPORT_SCHEMA_VERSION +
        '），请先升级应用再导入',
      warns
    };
  if (!Array.isArray(data.records))
    return {
      ok: false,
      reason:
        '缺少 records 记录数组。\n' +
        '这个文件的顶层字段是：' +
        (Object.keys(data || {}).slice(0, 15).join('、') || '（空文件）') +
        '\n\n多半是选错了文件 —— 请选「导出全部数据」生成的那个 .json。',
      warns
    };
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings))
    return { ok: false, reason: '缺少 settings 设置对象', warns };
  if (data.todos !== undefined && !Array.isArray(data.todos)) return { ok: false, reason: 'todos 结构异常', warns };
  if (data.habits !== undefined && !Array.isArray(data.habits)) return { ok: false, reason: 'habits 结构异常', warns };
  if (data.diaries !== undefined && (typeof data.diaries !== 'object' || Array.isArray(data.diaries)))
    return { ok: false, reason: 'diaries 结构异常', warns };
  if (!data.version && !data.dataVersion) {
    warns.push('缺少版本号（按最早版本兼容导入）');
  }
  if (!data.tree) {
    warns.push('缺少 tree 字段（按默认树初始化）');
  }
  if (!data.rankSystem) {
    warns.push('缺少 rankSystem 字段（按默认段位初始化）');
  }
  if (data.biographies === undefined) {
    warns.push('备份不含传记字段（旧版本导出，传记为空）');
  }
  try {
    for (let i = 0; i < data.records.length; i++) {
      const r = data.records[i];
      if (!r || typeof r !== 'object') return { ok: false, reason: '第 ' + (i + 1) + ' 条记录损坏', warns };
      if (r.type !== 'full' && r.type !== 'half' && r.type !== 'incomplete' && r.type !== 'log') {
        /* 新版本可能加了本版还不认识的类型（例：'log' 对老版本就是未知）。
           直接拒绝导入的后果是「装旧版的人拿到新版备份直接卡住」。
           所以放行 + 记警告，真正落库时由 normalizeBackupData 归一成「仅记录」（只记时间，不算番茄）：
           宁可少算番茄，也不让用户的数据进不来。 */
        if (warns.length < 20) warns.push('第 ' + (i + 1) + ' 条记录类型不认识(' + r.type + ')，将按「仅记录」导入');
      }
      if (!(r.startTime > 0)) warns.push('第 ' + (i + 1) + ' 条记录缺少时间戳');
      if (!(Number(r.pomos) > 0)) {
        /* 半个/空记录允许 0.5/0，不阻断 */ if (r.pomos !== 0 && r.pomos !== 0.5)
          warns.push('第 ' + (i + 1) + ' 条记录 pomos 异常');
      }
    }
  } catch (e) {
    return { ok: false, reason: '记录遍历异常', warns };
  }
  return { ok: true, reason: '', warns };
}
/* 本轮统计的形状兜底：老数据里 round 是「完整/半个/未完成」三个自增计数器，
   与记录各算各的（删日志不改数）。新版只保留「本轮起点 startTs」，计数由
   记录现算（computeRoundStats）——两者是同一件事，只能有一个来源。
   升级时起点定在今天 0 点，避免把历史记录全算进本轮。 */
function ensureRoundShape() {
  if (!appData.round || typeof appData.round.startTs !== 'number') {
    let t0 = 0;
    try {
      t0 = new Date(getTodayStr() + 'T00:00:00').getTime();
    } catch (e) {
      t0 = 0;
    }
    appData.round = { startTs: isFinite(t0) ? t0 : 0 };
  }
}
/* 兼容层：老调用点继续用布尔返回值 */
function isValidBackup(data) {
  return validateBackup(data).ok;
}
/* 把备份数据合并进 appData（含全部默认值兜底） */
function normalizeBackupData(data) {
  const defaults = createDefaultAppData();
  /* 租期宽限只认「本机是否已经给过」：标记从导入前的数据继承下来，
     否则反复导入同一份旧备份，每次都会因 decorExpires 为空而重新按 now 算 7 天（无限续期）。 */
  const _hadLeaseFlag = !!(appData && appData.tree && appData.tree.__leaseBackfilled);
  /* 数据契约：appData 会被整个覆盖，本机墓碑必须先留住，否则「本机删过的」记录
     在导入后失去删除凭证，下次同步又被服务端推回来。 */
  const _localTombs = (appData && Array.isArray(appData.tombstones)) ? appData.tombstones : [];
/* 导入 / 恢复前保留文件自带的原始版本号，供 __dataMig 执行版本迁移链（丢失则按最早版本处理） */
  const _impFromVer = String((data && (data.version || data.dataVersion)) || '0');
  /* 合并前深度净化——备份 JSON 的 __proto__ 自有属性经 Object.assign 会触发原型污染 */
  appData = Object.assign(defaults, deepSanitize(data));
  appData.version = DATA_VERSION;
  /* 数据契约：墓碑取并集 + 给备份里的老记录补 uid / updatedAt（幂等） */
  appData.tombstones = mergeTombstones(_localTombs, appData.tombstones);
  migrateDataContract();
  ensureRoundShape();
  /* 写回「本机已给过宽限」的标记（必须在下面 ensureTreeExtras() 之前） */
  if (_hadLeaseFlag && appData.tree) appData.tree.__leaseBackfilled = true;
/* 未知记录类型一律归一成「仅记录」：新版可能加了本版还不认识的类型，
   拒绝导入会让用户的备份进不来。宁可少算番茄，也不丢数据。
   （只认四个合法值；其余一律 type='log' + pomos=0，见 isLogRecord） */
  if (Array.isArray(appData.records)) {
    for (const _r of appData.records) {
      if (!_r || typeof _r !== 'object') continue;
      if (_r.type !== 'full' && _r.type !== 'half' && _r.type !== 'incomplete' && _r.type !== 'log') {
        _r.__origType = _r.type;
        _r.type = 'log';
        _r.pomos = 0;
      }
    }
  }
  if (!appData.tree)
    appData.tree = {
      points: 0,
      harvests: [],
      lastActiveDate: null,
      lastHabitBonusDate: null,
      species: 'tomato',
      unlockedSpecies: ['tomato'],
      lastHarvestDate: null,
      fruitCount: 0,
      totalFruitsHarvested: 0,
      milestones: [],
      peakPoints: 0
    };
  if (!appData.tree.lastActiveDate) appData.tree.lastActiveDate = null;
  if (!appData.tree.lastHabitBonusDate) appData.tree.lastHabitBonusDate = null;
  /* tree 其余扩展字段兜底（species/coins/decorExpires/sceneExpires 含 7 天宽限回填等）
     已与 ensureTreeExtras() 收敛为单一实现，统一由本函数末尾的 ensureTreeExtras() 调用补齐，
     不再在此重复维护一份（两处曾逐字重复 30+ 行，新增字段容易只改一处造成导入/启动口径分叉）。 */
  if (!appData.weeklyBadges) appData.weeklyBadges = { processedWeeks: [], cumulative: {}, lastAchievedWeek: {} };
  if (!appData.rankSystem) appData.rankSystem = defaults.rankSystem;
  if (!appData.rankSystem.spentTomatoes) appData.rankSystem.spentTomatoes = {};
  if (!appData.rankSystem.reroll) appData.rankSystem.reroll = { date: null, count: 0, spent: 0 };
  if (!appData.rankSystem.streak) appData.rankSystem.streak = { count: 0, lastDate: null, claimDate: null };
  if (!appData.rankSystem.weeklyChallenge) appData.rankSystem.weeklyChallenge = { weekStart: null, items: [] };
  if (!appData.rankSystem.betWinDates) appData.rankSystem.betWinDates = [];
  if (!appData.rankSystem.lastIdlePenaltyDate) appData.rankSystem.lastIdlePenaltyDate = null;
  if (!appData.unlockedAchievements) appData.unlockedAchievements = [];
  /* 倒数日字段级兜底：pinned（是否显示在计划页）/ note（备注）是后加的，
     老数据与老备份里没有这两个字段。不补的话渲染读到 undefined，勾选状态和备注都会飘；
     排序还要拿 id 当"添加时间"，id 缺失时归 0 排到最后，避免比较出 NaN。 */
  if (!Array.isArray(appData.countdowns)) appData.countdowns = [];
  for (const _cd of appData.countdowns) {
    if (!_cd || typeof _cd !== 'object') continue;
    if (_cd.pinned === undefined) _cd.pinned = 0;
    if (_cd.note === undefined) _cd.note = '';
    if (_cd.id === undefined || _cd.id === null) _cd.id = 0;
  }
  if (!appData.teamSystem)
    appData.teamSystem = {
      stars: 0,
      today: {
        date: null,
        startCode: null,
        partnerJoined: false,
        myEndCode: null,
        myCompleted: null,
        partnerEndCode: null,
        partnerCompleted: null,
        settled: false,
        settlementResult: null
      },
      history: [],
      pendingRankStarDeduction: 0,
      pendingRankStarDeductionDate: null
    };
  if (!appData.immersiveFocus)
    appData.immersiveFocus = Object.assign({}, createDefaultAppData().immersiveFocus, data.immersiveFocus || {});
  if (!Array.isArray(appData.immersiveFocus.events)) appData.immersiveFocus.events = [];
  if (!Array.isArray(appData.immersiveFocus.items)) appData.immersiveFocus.items = [];
  if (!Array.isArray(appData.immersiveFocus.unlockedAchievements)) appData.immersiveFocus.unlockedAchievements = [];
  if (typeof appData.immersiveFocus.script === 'undefined') appData.immersiveFocus.script = null;
  if (!appData.botLeaderboard) appData.botLeaderboard = { lastDate: null, bots: [] };
  if (!Array.isArray(appData.botLeaderboard.bots)) appData.botLeaderboard.bots = [];
  if (typeof appData.botLeaderboard.chaseMode === 'undefined') {
    appData.botLeaderboard.chaseMode = false;
    appData.botLeaderboard.chaseLostStreak = 0;
    appData.botLeaderboard.chaseLostDate = null;
  }
  ensureTreeExtras(); /* 导入补全 tree 扩展字段（含 inventory），兼容旧版本导出 */
  /* 传记字段兜底（旧备份无此字段；Object.assign 已带入默认 []，这里防脏数据） */
  if (!Array.isArray(appData.biographies)) appData.biographies = [];
  if (!appData.bioTriggered || typeof appData.bioTriggered !== 'object') appData.bioTriggered = {};
  if (appData.bioBackfillDone === undefined) appData.bioBackfillDone = false;
  appData.settings = Object.assign({}, defaultSettings, appData.settings || {});
/* 导入 / 恢复数据同样走版本迁移链（幂等），并留下迁移审计记录 */
  if (window.__dataMig && _impFromVer !== DATA_VERSION) {
    try {
      window.__dataMig.run(appData, _impFromVer, 'import');
    } catch (_me) {
      console.error('[dataMig] import 迁移失败', _me);
    }
  }
}
/* 导入不该让已经买下的限时装饰/场景提前失效：租期取「导入前」与「备份内」的较大值 */
function keepLongerLease(keep) {
  const tr = appData.tree;
  if (!tr || !keep) return;
  const applyTo = function (target, src) {
    if (!target || !src) return;
    Object.keys(src).forEach(function (id) {
      const oldVal = Number(src[id]) || 0;
      if (oldVal > (Number(target[id]) || 0)) target[id] = oldVal;
    });
  };
  applyTo(tr.decorExpires, keep.decor);
  applyTo(tr.sceneExpires, keep.scene);
}
/* 抽奖的「已抽次数」是只增账本：导入时取「导入前」与「备份内」的较大值。
   备份相当于时间机器，不保护的话「导出 → 抽完 → 导入」就能反复抽。
   只护这一个字段：金币、记录、计划、成就等**照常回档** —— 用户本来就该能恢复旧数据。 */
function keepMonotonicLottery(keepUsed) {
  const tr = appData.tree;
  if (!tr) return;
  const used = Number(keepUsed) || 0;
  if (used > (Number(tr.lotteryUsed) || 0)) tr.lotteryUsed = used;
  syncLotteryCount();
}
/* 应用备份数据并刷新全部界面 */
function applyBackupData(data, successMsg) {
  const _keepLease = {
    decor: Object.assign({}, (appData.tree && appData.tree.decorExpires) || {}),
    scene: Object.assign({}, (appData.tree && appData.tree.sceneExpires) || {})
  };
  const _keepUsed = (appData.tree && appData.tree.lotteryUsed) || 0;
  normalizeBackupData(data);
  keepLongerLease(_keepLease);
  keepMonotonicLottery(_keepUsed);
  saveData();
  UIFX.applySettingsToUI();
  UIFX.applyGroupStates();
  UIFX.renderTodos();
  UIFX.renderHabits();
  UIFX.renderLogs();
  UIFX.renderStats();
  UIFX.updateRoundStats();
  UIFX.updateTodayStats();
  UIFX.refreshTodoSelect();
  if (appData.settings.darkMode) document.body.classList.add('dark-mode');
  else document.body.classList.remove('dark-mode');
  UIFX.updateChromeTheme();
  updateAutoBackupInfo();
  UIFX.toast(successMsg || '✅ 数据已应用');
}
/* 设置页显示最近自动备份时间 */
/* 备份提醒提示条：在设置页持久显示距上次导出的天数 */
function updateBackupReminder() {
  const el = document.getElementById('backupReminderBar');
  if (!el) return;
  const today = getTodayStr();
  if (!appData.lastExportDate) {
    if (appData.records.length < 3) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.background = '#FFF3E0';
    el.style.border = '2px solid #FF9800';
    el.style.color = '#E65100';
    el.innerHTML =
      '⚠️ 你有 ' + appData.records.length + ' 条记录但从未导出备份。清浏览器数据会全部丢失，建议立即导出一次。';
    return;
  }
  const last = new Date(appData.lastExportDate + 'T00:00:00');
  const gap = Math.floor((new Date(today + 'T00:00:00') - last) / DAY_MS);
  if (gap >= 14) {
    el.style.display = 'block';
    el.style.background = '#FDEBE5';
    el.style.border = '2px solid #E85D3A';
    el.style.color = '#C0392B';
    el.innerHTML = '🚨 距上次导出已 ' + gap + ' 天！数据丢失风险较高，强烈建议立即导出备份。';
  } else if (gap >= 7) {
    el.style.display = 'block';
    el.style.background = '#FFF3E0';
    el.style.border = '2px solid #FF9800';
    el.style.color = '#E65100';
    el.innerHTML = '⚠️ 距上次导出已 ' + gap + ' 天，该备份一次了。';
  } else {
    el.style.display = 'block';
    el.style.background = '#E8F5E9';
    el.style.border = '2px solid #5CB85C';
    el.style.color = '#2E7D32';
    el.innerHTML = '✅ 上次导出：' + appData.lastExportDate + '（' + gap + ' 天前），数据安全。';
  }
}
function updateAutoBackupInfo() {
  const el = document.getElementById('autoBackupInfo');
  if (!el) return;
  try {
    const raw = TFStorage.read(AUTO_BACKUP_KEY);
    if (!raw) {
      el.textContent = '暂无自动备份';
      el.style.color = 'var(--text-light)';
      return;
    }
    const obj = JSON.parse(raw);
    if (obj && obj.time) {
      const d = new Date(obj.time);
      const timeStr =
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0') +
        ' ' +
        String(d.getHours()).padStart(2, '0') +
        ':' +
        String(d.getMinutes()).padStart(2, '0');
      el.textContent = '最近备份：' + timeStr + (obj.note ? ' · ' + obj.note : '');
      el.style.color = 'var(--green)';
    } else {
      el.textContent = '有自动备份可恢复';
      el.style.color = 'var(--green)';
    }
  } catch (e) {
    el.textContent = '暂无自动备份';
    el.style.color = 'var(--text-light)';
  }
}
/* 恢复自动备份（导入/清空前自动存的那份） */
function restoreAutoBackup() {
  let raw = null;
  try {
    raw = TFStorage.read(AUTO_BACKUP_KEY);
  } catch (e) { if (window.__silent) window.__silent(e, '01b:restoreAutoBackup'); }
  if (!raw) {
    UIFX.toast('没有可恢复的自动备份');
    return;
  }
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    UIFX.toast('自动备份已损坏，无法恢复');
    return;
  }
  const data = obj && obj.data ? obj.data : obj;
  if (!isValidBackup(data)) {
    const _r = validateBackup(data);
    UIFX.toast('自动备份数据异常，无法恢复：' + (_r.reason || '结构不符'));
    return;
  }
  const timeStr = obj && obj.time ? '（' + String(obj.time).slice(0, 16).replace('T', ' ') + '）' : '';
  const _restoreMsg = '确定用自动备份' + timeStr + '覆盖当前数据吗？\n当前数据会先再备份一次，仍可找回。';
  const _doRestore = function () {
    _autoBackupGuard('恢复自动备份').then(function (ok) {
      if (!ok) return;
      applyBackupData(data, '✅ 已恢复自动备份' + timeStr);
    });
  };
  if (typeof window.rsAsk === 'function') window.rsAsk(_restoreMsg, { title: '恢复自动备份', okText: '恢复' }, _doRestore);
  else if (confirm(_restoreMsg)) _doRestore();
}
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      const _vb = validateBackup(parsed);
      if (!_vb.ok) {
        /* 导入失败的原因常常很长（要让用户照着排查），而 toast 一闪而过根本读不完 ——
           实测用户只能记住「说缺少某部分什么数组」这种半句，没法据此定位。
           改用应用内弹窗：能读、能截图、能复制。 */
        const _failMsg = '导入失败：\n\n' + _vb.reason;
        if (typeof window.rsAlert === 'function') window.rsAlert(_failMsg, { title: '导入失败', okText: '知道了' });
        else if (typeof window.rsInfo === 'function') window.rsInfo(_failMsg, { title: '导入失败' });
        else UIFX.toast('导入失败：' + _vb.reason);
        event.target.value = '';
        return;
      }
      if (_vb.warns && _vb.warns.length) {
        try {
          console.warn('[导入] 旧格式兼容提示：', _vb.warns);
          if (window.__errRep) window.__errRep.warn('import', _vb.warns.join('；'));
        } catch (e2) { if (window.__silent) window.__silent(e2, '01b:importData'); }
      }
      /* 版本号口径：本项目**用源码日期当版本号**（见 00_head.html 顶部说明）。
         DATA_VERSION（'3.9'）是**数据结构版本**、纯内部机制，不面向用户 ——
         把它显示成「导入（版本 3.9）」会让人以为产品版本号又变成了 3.9。
         所以这里显示**备份日期**，与全站版本号口径一致。 */
      const versionInfo = parsed.exportDate ? '（备份日期 ' + parsed.exportDate + '）' : '';
      const _importMsg = '导入' + versionInfo + '将覆盖当前所有数据，确定继续吗？\n（导入前数据会自动备份，可恢复）';
      const _doImport = function () {
        _autoBackupGuard('导入数据').then(function (ok) {
          if (!ok) return;
          applyBackupData(parsed, '✅ 数据已导入' + versionInfo + '，导入前数据已自动备份');
        });
      };
      if (typeof window.rsAsk === 'function') window.rsAsk(_importMsg, { title: '导入数据', okText: '继续导入' }, _doImport);
      else if (confirm(_importMsg)) _doImport();
    } catch (err) {
      UIFX.toast('导入失败：文件格式错误');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}
/* 打开清除确认弹窗（用应用内弹窗替代原生 prompt：PWA/WebView 环境常静默拦截 prompt，导致按钮"点了没反应"） */
function clearAllData() {
  const input = document.getElementById('clearConfirmInput');
  if (input) input.value = '';
  UIFX.showModal('clearConfirmModal');
  if (input)
    setTimeout(() => {
      try {
        input.focus();
      } catch (e) { if (window.__silent) window.__silent(e, '01b:clearAllData'); }
    }, 100);
}
/* 用户在弹窗里点击「确认清除」 */
function confirmClearAllData() {
  const inputEl = document.getElementById('clearConfirmInput');
  const word = ((inputEl && inputEl.value) || '').trim();
  if (word !== '清除') {
    UIFX.toast('确认词不匹配，已取消清除');
    return;
  }
  /* 1. 先自动备份（存的是清除前的完整数据，误删可恢复）；失败则中止，避免「清除后无退路」 */
  _autoBackupGuard('清除所有数据').then(function (_okClear) {
    if (_okClear) _wipeAllDataConfirmed();
  });
}
/* 真正执行清空（前置条件：用户已确认 + 已自动备份） */
function _wipeAllDataConfirmed() {
  UIFX.closeModal('clearConfirmModal');
  /* 2. 挂起保存标志：从现在起 saveData/saveDataNow 全部拒发，杜绝防抖定时器把旧数据写回 */
  _dataClearing = true;
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  /* 3. 用「空数据 + 最新时间戳」覆盖双源存储，而不是删 key：
     避免多标签页/其他页面持连接导致 deleteDatabase 被 blocked 卡住（旧行为的隐形失效原因之一） */
  const fresh = createDefaultAppData();
  const payload = JSON.stringify({ t: Date.now(), d: JSON.stringify(fresh) });
  try {
    TFStorage.write(STORAGE_KEY, payload);
  } catch (e) { if (window.__silent) window.__silent(e, '01b:confirmClearAllData'); }
  if (window.indexedDB) {
    /* 关闭旧连接，等队列里残留的写入排空后再覆盖，保证清空结果是最后一次写入 */
    idbGetDb()
      .then(function (db) {
        try {
          db.close();
        } catch (e) { if (window.__silent) window.__silent(e, '01b:confirmClearAllData'); }
        _idbDb = null;
        _idbOpening = null;
        return idbWrite(payload);
      })
      .then(function () {
        location.reload();
      })
      .catch(function () {
        location.reload();
      });
    setTimeout(function () {
      try {
        location.reload();
      } catch (e) { if (window.__silent) window.__silent(e, '01b:confirmClearAllData'); }
    }, 2500);
  } else {
    setTimeout(function () {
      location.reload();
    }, 100);
  }
}
function sanitizeTreeData() {
  /* 树成长值健康检查：不用固定阈值（会误删真正肝了很久的玩家），改按「记录能产生的合理上限」判断——
     每个番茄折算数最多贡献约 10 成长点（积分+习惯/运势等加成余量）+ 2000 保底；
     只有明显超出这个上限的异常值（如被污染成 999999）才判定为污染，
     判定后按真实记录重算成长值（每个折算番茄基础 +1 点），而不是粗暴归 0 —— 不掩盖数据 */
  const tr = appData.tree;
  if (!tr) return;
  const totalPomos = (appData.records || []).reduce(function (s, r) {
    return s + getPomos(r);
  }, 0);
  const legitCeil = totalPomos * 10 + 2000;
  /* 按记录重算的真实成长值（保守：不含 buff 加成；若记录更多，重算值也更高，永不误删） */
  const recovered = Math.min(totalPomos, legitCeil);
  let dirty = false;
  if (typeof tr.points === 'number' && tr.points > legitCeil) {
    tr.points = recovered;
    dirty = true;
  }
  if (typeof tr.peakPoints === 'number' && tr.peakPoints > legitCeil) {
    tr.peakPoints = Math.max(tr.points || 0, recovered);
    dirty = true;
  }
  if (tr.speciesPoints && typeof tr.speciesPoints === 'object') {
    Object.keys(tr.speciesPoints).forEach(function (k) {
      if (typeof tr.speciesPoints[k] === 'number' && tr.speciesPoints[k] > legitCeil) {
        tr.speciesPoints[k] = recovered;
        dirty = true;
      }
    });
  }
  if (dirty) saveDataNow();
}
/* 手动数据体检设置页按钮触发，扫描并清理异常值后反馈结果 */
function runDataHealthCheck() {
  const tr = appData.tree;
  const beforeP = tr ? tr.points || 0 : 0;
  const beforeSp = tr && tr.speciesPoints ? JSON.parse(JSON.stringify(tr.speciesPoints)) : {};
  sanitizeTreeData();
  const fixed = [];
  if (tr && (tr.points || 0) !== beforeP) fixed.push('当前树成长值 ' + beforeP + ' → ' + tr.points);
  Object.keys(beforeSp).forEach(function (k) {
    if ((tr.speciesPoints[k] || 0) !== beforeSp[k])
      fixed.push(
        '「' + (TREE_SPECIES[k] ? TREE_SPECIES[k].name : k) + '」积分 ' + beforeSp[k] + ' → ' + tr.speciesPoints[k]
      );
  });
  UIFX.renderTreeSection();
  UIFX.renderStats();
  if (fixed.length) {
    UIFX.toast('🔧 已修复 ' + fixed.length + ' 处异常数据', true);
    setTimeout(function () {
      const _t = '✅ 数据体检完成，已\n' + fixed.join('\n');
      if (typeof window.rsInfo === 'function') window.rsInfo(_t, { title: '数据体检' });
      else alert(_t);
    }, 100);
  } else {
    UIFX.toast('✅ 数据体检完成，未发现异常', true);
    setTimeout(function () {
      const _t = '✅ 数据体检完成，未发现异常数据。\n当前成长值：' + (tr ? tr.points || 0 : 0);
      if (typeof window.rsInfo === 'function') window.rsInfo(_t, { title: '数据体检' });
      else alert(_t);
    }, 100);
  }
}
/* ============================================================
 * 白帽游戏化 · 数据池（极简模式 / 动态难度 / 休息仪式 / 人机排行榜）
 * ============================================================ */
/* 任务难度配置：档位=单番茄时长（简单10分钟 / 中等25分钟 / 沉浸式50分钟 / 大师90分钟），
   选难度=定时长，奖励统一按「25 分钟=1 个🍅」折算，时长越长奖励越多（无额外倍率） */
const DIFFICULTY_CONFIG = [
  { key: 'easy', name: '简单', icon: '🌱', duration: 10, desc: '10 分钟 · 热身或状态一般' },
  { key: 'medium', name: '中等', icon: '🌿', duration: 25, desc: '25 分钟 · 标准番茄' },
  { key: 'hard', name: '沉浸式', icon: '🔥', duration: 50, desc: '50 分钟 · 深度专注' },
  { key: 'master', name: '大师', icon: '💎', duration: 90, desc: '90 分钟 · 超长深度专注（高手挑战）' }
];
function getDifficultyCfg(key) {
  return (
    DIFFICULTY_CONFIG.find(function (d) {
      return d.key === key;
    }) || DIFFICULTY_CONFIG[1]
  );
}
/* 按时长反查难度档位：≤15→简单 / 16~35→中等 / 36~70→沉浸式 / >70→大师
   （自适应推荐或用户自定义时长时，保证奖励按实际投入时长折算） */
function getDifficultyByDuration(m) {
  if (!m || m <= 15) return DIFFICULTY_CONFIG[0].key;
  if (m <= 35) return DIFFICULTY_CONFIG[1].key;
  if (m <= 70) return DIFFICULTY_CONFIG[2].key;
  return DIFFICULTY_CONFIG[3].key;
}
/* 休息结束仪式 · 鼓励语池（峰终定律：让用户带着正面情绪进入下一个番茄） */
const ENCOURAGE_POOL = [
  '🌿 准备好开启下一个专注了吗？你的花园在等你',
  '✨ 休息好了，状态回满——下一个番茄更顺手',
  '🍅 深呼吸，专注是慢慢累积的，你做得很好',
  '🌟 你已经比昨天更接近目标了，继续',
  '💧 喝口水，伸个懒腰，然后漂亮的开始',
  '🧘 心流不是等来的，是坐下来的——开始吧',
  '🎯 下一个番茄，稳稳拿下',
  '🌙 别急，一步一步来，你已经在路上了'
];
/* 休息峰值设计 · 冷知识/鼓励语池（呼吸引导时展示，让大脑真正转换） */
const FUN_FACT_POOL = [
  '🧠 大脑一次专注 25 分钟后，休息 5 分钟能显著提升记忆留存',
  '🌬️ 每分钟 6 次深呼吸，可以最快让交感神经冷静下来',
  '🕊️ 盯着远处 20 秒，能放松睫状肌，缓解用眼疲劳',
  '💦 专注时大脑耗能比发呆高 20%，及时补水很重要',
  '⏳ 心流状态时，人对时间的感知会变慢或消失',
  '🌳 看 40 秒绿色植物，能小幅提升后续任务表现',
  '🦶 起身走 2 分钟，比坐着休息更能恢复专注力',
  '🍃 简单伸展肩颈 30 秒，就能降低久坐的僵硬感'
];
/* 人机排行榜 · BOT 玩家池（性格各异，每日按性格随机增减星星 + 偶发波动） */
const BOT_PLAYERS = [
  { id: 'bot_zhe', name: '卷王阿哲', emoji: '🔥', persona: '专注型', k: 1.25 },
  { id: 'bot_zaoqi', name: '早起菌', emoji: '🌅', persona: '努力型', k: 1.0 },
  { id: 'bot_yu', name: '摸鱼咸鱼', emoji: '🐟', persona: '休闲型', k: 0.8 },
  { id: 'bot_tang', name: '躺平大师', emoji: '🛋️', persona: '摆烂型', k: 0.6 },
  { id: 'bot_xiao', name: '夜猫子小林', emoji: '🦉', persona: '努力型', k: 1.0 },
  { id: 'bot_foxi', name: '佛系学姐', emoji: '🧘', persona: '休闲型', k: 0.8 },
  { id: 'bot_dagong', name: '打工超人', emoji: '💼', persona: '专注型', k: 1.2 },
  { id: 'bot_diao', name: '掉线玩家', emoji: '📉', persona: '摆烂型', k: 0.6 }
];

/* ============================================================
 * 沉浸式剧情副本 · 用户导入扩展包（5.4.6 新增）
 * 副本 = 「内容扩展」不是用户个人数据：
 *   - 独立 key 存储（IndexedDB 主存 + localStorage 镜像），绝不写入 appData
 *   - 导出备份 / 恢复备份 / 清除数据 均不包含副本 → 备份文件纯净、体积小
 *   - 与用户数据完全共存，互不影响
 * 存储结构：[{id,name,seriesIcon,importedAt,source,script:{...}}]
 *   id 即剧本 id（与 IMMERSIVE_SCRIPTS 同空间，须全局唯一）
 *   script 为与 IMMERSIVE_SCRIPTS 元素完全一致的剧本对象
 * 界面/导入/格式说明见 06-immersive.js；这里只负责存取与缓存。
 * ============================================================ */
const IMPORTED_SCRIPTS_KEY = STORAGE_KEY + '_imported_scripts';
let IMPORTED_SCRIPTS = null; /* 缓存：导入副本列表；null=尚未加载 */
function getImportedScriptList() {
  if (IMPORTED_SCRIPTS === null) IMPORTED_SCRIPTS = [];
  return IMPORTED_SCRIPTS;
}
/* 只取剧本对象（供抽卡池 / 校验脚本存在性复用） */
function getImportedScriptObjects() {
  return getImportedScriptList().map(function (x) {
    return x.script;
  });
}
function importedScriptById(id) {
  const l = getImportedScriptList();
  for (let i = 0; i < l.length; i++) {
    if (idEq(l[i].id, id)) return l[i];
  }
  return null;
}
/* 独立 key 双写：IDB 主存 + localStorage 镜像（与 appData 策略一致） */
function saveImportedScripts() {
  const list = getImportedScriptList();
  let json = '';
  try {
    json = JSON.stringify(list);
  } catch (e) {
    return;
  }
  if (json) {
    const payload = JSON.stringify({ t: Date.now(), d: json });
    try {
      TFStorage.write(IMPORTED_SCRIPTS_KEY, payload);
    } catch (e) {
      try {
        TFStorage.remove(IMPORTED_SCRIPTS_KEY);
      } catch (e2) { if (window.__silent) window.__silent(e2, '01b:saveImportedScripts'); }
    }
    if (window.indexedDB) {
      idbGetDb()
        .then(function (db) {
          return new Promise(function (res) {
            try {
              const tx = db.transaction(IDB_STORE, 'readwrite');
              tx.objectStore(IDB_STORE).put(payload, IMPORTED_SCRIPTS_KEY);
              tx.oncomplete = function () {
                res();
              };
              tx.onerror = function () {
                res();
              };
            } catch (e) {
              res();
            }
          });
        })
        .catch(function (e) {
          if (window.__silent) window.__silent(e, '01b:saveImportedScripts');
        });
    }
  }
}
/* 加载导入副本缓存（IDB 优先、localStorage 兜底），启动时调用一次 */
async function loadImportedScripts() {
  let raw = null;
  if (window.indexedDB) {
    try {
      const v = await idbGet(IMPORTED_SCRIPTS_KEY);
      if (v) {
        const obj = JSON.parse(v);
        raw = obj && obj.d ? JSON.parse(obj.d) : obj;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01b:loadImportedScripts'); }
  }
  if (!raw) {
    try {
      const ls = TFStorage.read(IMPORTED_SCRIPTS_KEY);
      if (ls) {
        const obj = JSON.parse(ls);
        raw = obj && obj.d ? JSON.parse(obj.d) : obj;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01b:loadImportedScripts'); }
  }
  let arr = [];
  if (Array.isArray(raw))
    arr = raw.filter(function (x) {
      return x && x.id && x.script && typeof x.script === 'object';
    });
  IMPORTED_SCRIPTS = arr;
  return arr;
}
/* 追加一个副本（导入前先 validateImportedScript 校验通过） */
function pushImportedScript(meta) {
  const l = getImportedScriptList();
  /* id 冲突保护：同 id 已存在则拒绝（内置剧本 id 由 06 校验层把关） */
  if (
    l.some(function (x) {
      return x.id === meta.id;
    })
  ) {
    return { ok: false, msg: '已存在同 id 的副本（' + meta.id + '），请勿重复导入' };
  }
  l.push(meta);
  saveImportedScripts();
  return { ok: true };
}
/* 删除某个导入副本（仅删除记录，不影响任何用户数据） */
function removeImportedScript(id) {
  const l = getImportedScriptList();
  const i = l.findIndex(function (x) {
    return idEq(x.id, id);
  });
  if (i < 0) return false;
  l.splice(i, 1);
  saveImportedScripts();
  return true;
}


/* __replace_exportData__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_exportData(fn) { exportData = fn; }


/* __replace_applyBackupData__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_applyBackupData(fn) { applyBackupData = fn; }


/* __replace_restoreAutoBackup__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_restoreAutoBackup(fn) { restoreAutoBackup = fn; }


/* __replace_importData__ */
/* 跨模块替换入口：ESM 的 import 绑定只读，外部只能通过它换实现 */
function __replace_importData(fn) { importData = fn; }


/* __set_currentLogTab__ */
/* 跨模块可变状态的唯一写入口（ESM 导入绑定只读；读走活绑定） */
function __set_currentLogTab(v) { currentLogTab = v; }


/* __set_audioCtx__ */
/* 跨模块可变状态的唯一写入口（ESM 导入绑定只读，赋值会抛 TypeError） */
function __set_audioCtx(v) { audioCtx = v; }

/* __set_currentDiaryDate__ */
/* 跨模块可变状态的唯一写入口（ESM 导入绑定只读；读走活绑定） */
function __set_currentDiaryDate(v) { currentDiaryDate = v; }


/* __set_calendarYear__ */
/* 跨模块可变状态的唯一写入口（ESM 导入绑定只读；读走活绑定） */
function __set_calendarYear(v) { calendarYear = v; }


/* __set_calendarMonth__ */
/* 跨模块可变状态的唯一写入口（ESM 导入绑定只读；读走活绑定） */
function __set_calendarMonth(v) { calendarMonth = v; }

/* __habitSkipsOf__ */
/* 某个习惯的跳过日列表 —— 读 habitSkips 的唯一入口。
   ★ 2026-10-30 审查修复：原来放在 01eB（UI 层），于是 01d 的 getHabitStreak
     （排序 / 成就 / 周徽章都走它）拿不到跳过日，只能不传 —— 同一个习惯在
     列表里「连续 3 天」、在成就里「连续 0 天」。读档函数属于数据层，放这里两边都能用。 */
function habitSkipsOf(h) {
  const m = appData.habitSkips || {};
  const v = m[String(h && h.id)];
  return Array.isArray(v) ? v : [];
}
