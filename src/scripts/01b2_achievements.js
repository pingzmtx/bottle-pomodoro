/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 成就定义表：71 条静态字段（id / group / icon / name / desc / color / bg / tier）+ cond(ctx)。
 * 全部是**顶层 const（无 IIFE）** —— 必须与 01b_engine_data.js 待在**同一个 <script> 槽**
 * （见 src/manifest.json 槽 1）：跨 <script> 的 const 互不可见，01d 的 getAchievements() 就取不到它。
 * 依赖方向：本文件 → 无。cond 里读 appData / getEternalStars 等全局，但只在**运行期**（求 unlocked 时）
 *   被调用，加载期不执行任何语句，所以放在 01b 之后、01d 之前加载都安全。
 *   getAchievements()（01d）→ 读本文件的 ACHIEVEMENT_DEFS。
 * 数据只读：这里只是一张静态表，不写任何数据。
 *
 * ★ 2026-11-14 重排（71 条 = 6 引导 + 65 里程碑；tier 6/15/24/26 —— 条数以数组实测为准，勿抄注释）：
 *   旧表 88 条，问题不是「条数多」，而是「同一件事记三次账 + 门槛扎堆在前 100 个番茄」——
 *   t50 / forest_50 / tree_small（树 40 番茄）在第 7 天同时亮；种树 37 条里 8 条在 100 个番茄内全亮。
 *   这次：id 全部语义化（组_门槛），一个计数器只留一条曲线，门槛按对数刻度铺开 3 年。
 *   孤儿 id 由 01d 的 migrateAchievements() 一次性清理（旧 id 与新 id 无重叠，属预期）。
 */

/* ==================== 模块: 01b2-achievements.js | 职责: 成就定义表（71 条：6 引导 + 65 里程碑） | 分组: engine ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01b2-achievements.js（源文件 01b2_achievements.js）
 * 分组：engine
 * 职责：成就定义表 —— 每条含静态字段与 cond(ctx)；ctx 由 getAchievements()（01d）组装后传入。
 * 函数索引（TOC）：（本文件无顶层函数，仅常量/IIFE）
 * ============================================================ */
/* ===== 成就定义表 =====
 * 三档 tier：guide（引导，前 7 天）/ bronze / silver / gold（里程碑，铺 3 年）。
 * 配色按 tier 统一，不再逐条手写——同一档的颜色必须一致，否则成就墙看起来是拼贴画。
  */
const ACHIEVEMENT_DEFS = [
{
      id: 'g_first',
      group: '基础',
      icon: '🌱',
      name: '初心者',
      desc: '完成第 1 个番茄',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'guide',
      cond: function (g) { return g.totalTomatoes >= 1; }
    },
{
      id: 'g_schedule',
      group: '引导',
      icon: '📅',
      name: '第一次排期',
      desc: '在日程表上排下第一段时间',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'guide',
      cond: function (g) { return (appData.todos||[]).some(function(t){return (t.blocks||[]).length>0;}); }
    },
{
      id: 'g_quad',
      group: '引导',
      icon: '🧭',
      name: '四象限',
      desc: '第一次给任务分出轻重',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'guide',
      cond: function (g) { return (appData.todos||[]).some(function(t){return !!t.quad;}); }
    },
{
      id: 'g_diary',
      group: '记录',
      icon: '📔',
      name: '初试笔锋',
      desc: '写下第 1 篇日记',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'guide',
      cond: function (g) { return g.diaryCount >= 1; }
    },
{
      id: 'g_habit',
      group: '习惯',
      icon: '🌿',
      name: '习惯萌芽',
      desc: '添加第 1 个习惯',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'guide',
      cond: function (g) { return g.habitCount >= 1; }
    },
{
      id: 'g_forest',
      group: '种树',
      icon: '🌳',
      name: '第一棵树',
      desc: '森林里种下第 1 棵树',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'guide',
      cond: function (g) { return g.forestTrees >= 1; }
    },
{
      id: 't_200',
      group: '基础',
      icon: '🍅',
      name: '专注常客',
      desc: '累计 200 个番茄',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.totalTomatoes >= 200; }
    },
{
      id: 't_2000',
      group: '基础',
      icon: '🎯',
      name: '专注老兵',
      desc: '累计 2000 个番茄',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.totalTomatoes >= 2000; }
    },
{
      id: 't_8000',
      group: '基础',
      icon: '🏔',
      name: '万时之基',
      desc: '累计 8000 个番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.totalTomatoes >= 8000; }
    },
{
      id: 'streak_7',
      group: '坚持',
      icon: '🔥',
      name: '连续 7 天',
      desc: '连续 7 天有番茄',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.streak >= 7; }
    },
{
      id: 'streak_21',
      group: '坚持',
      icon: '🔥',
      name: '连续 21 天',
      desc: '连续 21 天有番茄',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.streak >= 21; }
    },
{
      id: 'streak_45',
      group: '坚持',
      icon: '🔥',
      name: '连续 45 天',
      desc: '连续 45 天有番茄',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.streak >= 45; }
    },
{
      id: 'streak_90',
      group: '坚持',
      icon: '🔥',
      name: '连续 90 天',
      desc: '连续 90 天有番茄',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.streak >= 90; }
    },
{
      id: 'streak_180',
      group: '坚持',
      icon: '🔥',
      name: '连续 180 天',
      desc: '连续 180 天有番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.streak >= 180; }
    },
{
      id: 'streak_365',
      group: '坚持',
      icon: '🔥',
      name: '全年不断',
      desc: '连续 365 天有番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.streak >= 365; }
    },
{
      id: 'month_full',
      group: '坚持',
      icon: '📅',
      name: '满勤月',
      desc: '某个自然月每天都有番茄',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.monthFullUnlocked; }
    },
{
      id: 'days_500',
      group: '坚持',
      icon: '🗓',
      name: '累计 500 天',
      desc: '累计 500 天有番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.activeDaysCount >= 500; }
    },
{
      id: 'early_14',
      group: '作息',
      icon: '🌅',
      name: '早起两周',
      desc: '连续 14 天早晨完成番茄',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.earlyStreak >= 14; }
    },
{
      id: 'early_45',
      group: '作息',
      icon: '🌅',
      name: '早起 45 天',
      desc: '连续 45 天早晨完成番茄',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.earlyStreak >= 45; }
    },
{
      id: 'early_180',
      group: '作息',
      icon: '🌅',
      name: '晨间半年',
      desc: '连续 180 天早晨完成番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.earlyStreak >= 180; }
    },
{
      id: 'night_14',
      group: '作息',
      icon: '🌙',
      name: '夜猫两周',
      desc: '连续 14 天深夜完成番茄',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.nightStreak >= 14; }
    },
{
      id: 'night_45',
      group: '作息',
      icon: '🌙',
      name: '熬夜 45 天',
      desc: '连续 45 天深夜完成番茄',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.nightStreak >= 45; }
    },
{
      id: 'night_180',
      group: '作息',
      icon: '🌙',
      name: '夜之半年',
      desc: '连续 180 天深夜完成番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.nightStreak >= 180; }
    },
{
      id: 'day_12',
      group: '挑战',
      icon: '⚡',
      name: '单日 12 个',
      desc: '某天完成 12 个番茄',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.maxDayFull >= 12; }
    },
{
      id: 'day_20',
      group: '挑战',
      icon: '⚡',
      name: '单日 20 个',
      desc: '某天完成 20 个番茄',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.maxDayFull >= 20; }
    },
{
      id: 'day_30',
      group: '挑战',
      icon: '⚡',
      name: '单日 30 个',
      desc: '某天完成 30 个番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.maxDayFull >= 30; }
    },
{
      id: 'nobreak_10',
      group: '挑战',
      icon: '🧘',
      name: '零打断十日',
      desc: '累计 10 个零打断日',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.nobreakDays >= 10; }
    },
{
      id: 'nobreak_30',
      group: '挑战',
      icon: '🧘',
      name: '零打断三十日',
      desc: '累计 30 个零打断日',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.nobreakDays >= 30; }
    },
{
      id: 'perfect_week_4',
      group: '挑战',
      icon: '💎',
      name: '四次完美周',
      desc: '累计 4 次完美周',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.perfectWeekCount >= 4; }
    },
{
      id: 'badge_1',
      group: '战标',
      icon: '🏅',
      name: '首枚战标',
      desc: '累计点亮战标 1 次',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.badgeLights >= 1; }
    },
{
      id: 'badge_10',
      group: '战标',
      icon: '🏅',
      name: '战标十冠',
      desc: '累计点亮战标 10 次',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.badgeLights >= 10; }
    },
{
      id: 'badge_50',
      group: '战标',
      icon: '🏅',
      name: '战标五十',
      desc: '累计点亮战标 50 次',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.badgeLights >= 50; }
    },
{
      id: 'badge_100',
      group: '战标',
      icon: '🏅',
      name: '战标百枚',
      desc: '累计点亮战标 100 次',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.badgeLights >= 100; }
    },
{
      id: 'rank_gold',
      group: '段位',
      icon: '⭐',
      name: '黄金时代',
      desc: '生涯最高达到黄金',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.careerMax >= 100; }
    },
{
      id: 'rank_platinum',
      group: '段位',
      icon: '⭐',
      name: '铂金贵族',
      desc: '生涯最高达到铂金',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.careerMax >= 210; }
    },
{
      id: 'rank_diamond',
      group: '段位',
      icon: '⭐',
      name: '钻石光辉',
      desc: '生涯最高达到钻石',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.careerMax >= 350; }
    },
{
      id: 'rank_king',
      group: '段位',
      icon: '⭐',
      name: '王者加冕',
      desc: '生涯最高达到王者',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.careerMax >= 500; }
    },
{
      id: 'rank_glory',
      group: '段位',
      icon: '👑',
      name: '荣耀之冠',
      desc: '生涯最高达到荣耀',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.careerMax >= 1100; }
    },
{
      id: 'forest_250',
      group: '种树',
      icon: '🌲',
      name: '小树林',
      desc: '森林累计种下 250 棵',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.forestTrees >= 250; }
    },
{
      id: 'forest_1000',
      group: '种树',
      icon: '🌲',
      name: '郁郁葱葱',
      desc: '森林累计种下 1000 棵',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.forestTrees >= 1000; }
    },
{
      id: 'forest_5000',
      group: '种树',
      icon: '🌲',
      name: '一片森林',
      desc: '森林累计种下 5000 棵',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.forestTrees >= 5000; }
    },
{
      id: 'forest_10000',
      group: '种树',
      icon: '🌲',
      name: '万木之林',
      desc: '森林累计种下 10000 棵',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.forestTrees >= 10000; }
    },
{
      id: 'tree_year_1',
      group: '种树',
      icon: '🌳',
      name: '一年之约',
      desc: '同一棵树陪伴你满 1 年',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.treeYears >= 1; }
    },
{
      id: 'tree_year_3',
      group: '种树',
      icon: '🌳',
      name: '三载相守',
      desc: '同一棵树陪伴你满 3 年',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.treeYears >= 3; }
    },
{
      id: 'tree_year_5',
      group: '种树',
      icon: '🌳',
      name: '五载同行',
      desc: '同一棵树陪伴你满 5 年',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.treeYears >= 5; }
    },
{
      id: 'tree_year_10',
      group: '种树',
      icon: '🌳',
      name: '十年之树',
      desc: '同一棵树陪伴你满 10 年',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.treeYears >= 10; }
    },
{
      id: 'tree_year_20',
      group: '种树',
      icon: '🌳',
      name: '廿年古木',
      desc: '同一棵树陪伴你满 20 年',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.treeYears >= 20; }
    },
{
      id: 'ring_10',
      group: '种树',
      icon: '🪵',
      name: '十圈年轮',
      desc: '一棵树长出 10 圈年轮',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.treeRings >= 10; }
    },
{
      id: 'ring_50',
      group: '种树',
      icon: '🪵',
      name: '永恒树心',
      desc: '一棵树长出 50 圈年轮',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.treeRings >= 50; }
    },
{
      id: 'ring_100',
      group: '种树',
      icon: '🪵',
      name: '百圈树心',
      desc: '一棵树长出 100 圈年轮',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.treeRings >= 100; }
    },
{
      id: 'ring_500',
      group: '种树',
      icon: '🪵',
      name: '纪元之树',
      desc: '一棵树长出 500 圈年轮',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.treeRings >= 500; }
    },
{
      id: 'grove_3',
      group: '种树',
      icon: '🌿',
      name: '三树成荫',
      desc: '林地里有 3 棵树',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.grove >= 3; }
    },
{
      id: 'grove_5',
      group: '种树',
      icon: '🌿',
      name: '五树成林',
      desc: '林地里有 5 棵树',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.grove >= 5; }
    },
{
      id: 'grove_1',
      group: '种树',
      icon: '🌿',
      name: '第一片荫',
      desc: '把一棵树养到永恒树心，封进林地',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.grove >= 1; }
    },
{
      id: 'grove_10',
      group: '种树',
      icon: '🌿',
      name: '小林主',
      desc: '林地里有 10 棵树',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.grove >= 10; }
    },
{
      id: 'species_all',
      group: '种树',
      icon: '🧬',
      name: '万树归宗',
      desc: '解锁全部 5 种树种',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return (appData.tree.unlockedSpecies || ['tomato']).length >= 5; }
    },
{
      id: 'album_all',
      group: '种树',
      icon: '📖',
      name: '万物园丁',
      desc: '成长图鉴全部点亮（9 阶段）',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return (appData.tree.fruitAlbum || []).length >= 9; }
    },
{
      id: 'diary_30',
      group: '记录',
      icon: '📔',
      name: '月记不辍',
      desc: '累计写下 30 篇日记',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.diaryCount >= 30; }
    },
{
      id: 'diary_100',
      group: '记录',
      icon: '📔',
      name: '百日之笔',
      desc: '累计写下 100 篇日记',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.diaryCount >= 100; }
    },
{
      id: 'task_20',
      group: '记录',
      icon: '🗂',
      name: '二十面手',
      desc: '累计专注 20 种不同任务',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.uniqueTasks >= 20; }
    },
{
      id: 'task_50',
      group: '记录',
      icon: '🗂',
      name: '百业通',
      desc: '累计专注 50 种不同任务',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.uniqueTasks >= 50; }
    },
{
      id: 'habit_5',
      group: '习惯',
      icon: '🌿',
      name: '习惯培养师',
      desc: '同时培养 5 个习惯',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return g.habitCount >= 5; }
    },
{
      id: 'habit_100',
      group: '习惯',
      icon: '🌿',
      name: '百次坚持',
      desc: '累计习惯打卡 100 次',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.habitTotal >= 100; }
    },
{
      id: 'min_5000',
      group: '时长',
      icon: '⏱',
      name: '八十小时',
      desc: '累计专注 5000 分钟',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return g.totalMinutes >= 5000; }
    },
{
      id: 'min_20000',
      group: '时长',
      icon: '⏱',
      name: '三百小时',
      desc: '累计专注 20000 分钟',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.totalMinutes >= 20000; }
    },
{
      id: 'adv_space',
      group: '冒险',
      icon: '🚀',
      name: '深空逃逸',
      desc: '完成「星际探险」冒险（终章全通）',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_space') >= 0; }
    },
{
      id: 'adv_office',
      group: '冒险',
      icon: '💼',
      name: '职场主角',
      desc: '完成「职场逆袭」冒险（终章全通）',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_office') >= 0; }
    },
{
      id: 'adv_xianxia',
      group: '冒险',
      icon: '⚔',
      name: '逆天改命',
      desc: '完成「仙侠修炼」冒险（终章全通）',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_xianxia') >= 0; }
    },
{
      id: 'adv_detective',
      group: '冒险',
      icon: '🔍',
      name: '完美推理',
      desc: '完成「悬疑推理」冒险（终章全通）',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_detective') >= 0; }
    },
{
      id: 'adv_chase',
      group: '冒险',
      icon: '🚨',
      name: '雷霆行动',
      desc: '完成「警匪追捕」冒险（终章全通）',
      color: '#8A93A0',
      bg: '#F2F4F7',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_chase') >= 0; }
    },
{
      id: 'adv_random',
      group: '冒险',
      icon: '🎲',
      name: '随机冒险家',
      desc: '完成任意一次随机剧本冒险',
      color: '#C08A3E',
      bg: '#FBF0E2',
      tier: 'bronze',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_random') >= 0; }
    },
];
