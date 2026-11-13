/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 成就定义表：75 条静态字段（id / group / icon / name / desc / color / bg / tier）+ cond(ctx)。
 * 全部是**顶层 const（无 IIFE）** —— 必须与 01b_engine_data.js 待在**同一个 <script> 槽**
 * （见 src/manifest.json 槽 1）：跨 <script> 的 const 互不可见，01d 的 getAchievements() 就取不到它。
 * 依赖方向：本文件 → 无。cond 里读 appData / getEternalStars 等全局，但只在**运行期**（求 unlocked 时）
 *   被调用，加载期不执行任何语句，所以放在 01b 之后、01d 之前加载都安全。
 *   getAchievements()（01d）→ 读本文件的 ACHIEVEMENT_DEFS。
 * 数据只读：这里只是一张静态表，不写任何数据。 */
/* ==================== 模块: 01b2-achievements.js | 职责: 成就定义表（75 条：静态字段 + 解锁条件） | 分组: engine ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01b2-achievements.js（源文件 01b2_achievements.js）
 * 分组：engine
 * 职责：成就定义表 —— 每条含静态字段与 cond(ctx)；ctx 由 getAchievements()（01d）组装后传入。
 * 函数索引（TOC）：（本文件无顶层函数，仅常量/IIFE）
 * ============================================================ */
/* ===== 成就定义表 =====
 * 成就静态字段 + 解锁条件（cond(ctx)，原 unlocked 表达式 1:1 搬入，仅局部量改经 ctx 读取；
 * 直接读全局 appData 的表达式原样保留）。getAchievements() 组装 ctx 后逐条求 unlocked。
  */
const ACHIEVEMENT_DEFS = [
{
      id: 'first',
      group: '基础',
      icon: '🌱',
      name: '初心者',
      desc: '完成第1个番茄',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'guide',
      cond: function (g) { return g.totalTomatoes >= 1; }
    },
{
      id: 't10',
      group: '基础',
      icon: '🍅',
      name: '专注新手',
      desc: '累计10个番茄',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'bronze',
      cond: function (g) { return g.totalTomatoes >= 10; }
    },
{
      id: 't50',
      group: '基础',
      icon: '🎯',
      name: '半月达人',
      desc: '累计50个番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'silver',
      cond: function (g) { return g.totalTomatoes >= 50; }
    },
{
      id: 't100',
      group: '基础',
      icon: '⚡',
      name: '效率大师',
      desc: '累计100个番茄',
      color: '#E85D3A',
      bg: '#FDEBE5',
      tier: 'gold',
      cond: function (g) { return g.totalTomatoes >= 100; }
    },
{
      id: 's7',
      group: '坚持',
      icon: '🔥',
      name: '连续7天',
      desc: '连续7天有番茄',
      color: '#E85D3A',
      bg: '#FDEBE5',
      tier: 'bronze',
      cond: function (g) { return g.streak >= 7; }
    },
{
      id: 's14',
      group: '坚持',
      icon: '📅',
      name: '半月连胜',
      desc: '连续14天有番茄',
      color: '#E85D3A',
      bg: '#FDEBE5',
      tier: 'silver',
      cond: function (g) { return g.streak >= 14; }
    },
{
      id: 's30',
      group: '坚持',
      icon: '🔥🔥',
      name: '连续30天',
      desc: '连续30天有番茄',
      color: '#E85D3A',
      bg: '#FDEBE5',
      tier: 'silver',
      cond: function (g) { return g.streak >= 30; }
    },
{
      id: 's60',
      group: '坚持',
      icon: '⏳',
      name: '双月坚守',
      desc: '连续60天有番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.streak >= 60; }
    },
{
      id: 's100',
      group: '坚持',
      icon: '🧱',
      name: '百日不断',
      desc: '连续100天有番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.streak >= 100; }
    },
{
      id: 'd100',
      group: '坚持',
      icon: '🏆',
      name: '百日坚持',
      desc: '累计100天有番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return g.activeDaysCount >= 100; }
    },
{
      id: 'signin_7',
      group: '坚持',
      icon: '📅',
      name: '一周都没落下',
      desc: '累计完成7天每日签到',
      color: '#FF9800',
      bg: '#FFF3E0',
      tier: 'bronze',
      cond: function (g) { return ((appData.signIn && appData.signIn.totalDays) || 0) >= 7; }
    },
{
      id: 'monthfull',
      group: '坚持',
      icon: '🗓️',
      name: '满勤月',
      desc: '某自然月每天都有番茄',
      color: '#6B5B95',
      bg: '#F0EBF7',
      tier: 'silver',
      cond: function (g) { return g.monthFullUnlocked; }
    },
{
      id: 'early',
      group: '作息',
      icon: '🌅',
      name: '早起鸟',
      desc: '连续3天早上6-9点完成番茄',
      color: '#F0AD4E',
      bg: '#FEF5E6',
      /* 门槛取「连续 3 天」而不是「任意一次」：单次早起的番茄不构成习惯，
         门槛太低这项就没有区分度。分层用 bronze —— 它要靠坚持才拿得到，
         不属于「第一次做某事」的功能引导（guide）。
         ★ 只调门槛与分层，**不撤销已解锁的记录**（成就不可撤销）。 */
      tier: 'bronze',
      cond: function (g) { return g.earlyStreak >= 3; }
    },
{
      id: 'early7',
      group: '作息',
      icon: '🌅✨',
      name: '早起达人',
      desc: '连续7天早晨完成番茄',
      color: '#F0AD4E',
      bg: '#FEF5E6',
      tier: 'silver',
      cond: function (g) { return g.earlyStreak >= 7; }
    },
{
      id: 'early30',
      group: '作息',
      icon: '☀️',
      name: '晨间王者',
      desc: '连续30天早晨完成番茄',
      color: '#E85D3A',
      bg: '#FDEBE5',
      tier: 'gold',
      cond: function (g) { return g.earlyStreak >= 30; }
    },
{
      id: 'night',
      group: '作息',
      icon: '🌙',
      name: '夜猫子',
      desc: '连续3天凌晨0-6点完成番茄',
      color: '#6B5B95',
      bg: '#F0EBF7',
      /* 梯度校准：同「早起鸟」，`>= 1` → `>= 3` 且 guide → bronze（理由见上）。 */
      tier: 'bronze',
      cond: function (g) { return g.nightStreak >= 3; }
    },
{
      id: 'night7',
      group: '作息',
      icon: '🌙✨',
      name: '熬夜选手',
      desc: '连续7天深夜完成番茄',
      color: '#6B5B95',
      bg: '#F0EBF7',
      tier: 'silver',
      cond: function (g) { return g.nightStreak >= 7; }
    },
{
      id: 'night30',
      group: '作息',
      icon: '🦉',
      name: '夜之守护者',
      desc: '连续30天深夜完成番茄',
      color: '#6B5B95',
      bg: '#F0EBF7',
      tier: 'gold',
      cond: function (g) { return g.nightStreak >= 30; }
    },
{
      id: 'nobreak',
      group: '挑战',
      icon: '💎',
      name: '零打断日',
      desc: '某天零打断完成3个番茄',
      color: '#5B9BD5',
      bg: '#E8F2FA',
      tier: 'bronze',
      cond: function (g) { return g.nobreakUnlocked; }
    },
{
      id: 'nobreak5',
      group: '挑战',
      icon: '💎×5',
      name: '零打断五日',
      desc: '累计5个零打断日',
      color: '#5B9BD5',
      bg: '#E8F2FA',
      tier: 'silver',
      cond: function (g) { return g.nobreakDays >= 5; }
    },
{
      id: 'pw7',
      group: '挑战',
      icon: '🏅',
      name: '完美一周',
      desc: '连续7天每天4+番茄且零打断',
      color: '#6B5B95',
      bg: '#F0EBF7',
      tier: 'silver',
      cond: function (g) { return g.perfectWeekUnlocked; }
    },
{
      id: 'pw3',
      group: '挑战',
      icon: '🏅×3',
      name: '完美三周',
      desc: '累计3次完美周',
      color: '#6B5B95',
      bg: '#F0EBF7',
      tier: 'gold',
      cond: function (g) { return g.perfectWeekCount >= 3; }
    },
{
      id: 'day5',
      group: '挑战',
      icon: '💪',
      name: '高产日',
      desc: '单日完成5个番茄',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'bronze',
      cond: function (g) { return g.maxDayFull >= 5; }
    },
{
      id: 'day10',
      group: '挑战',
      icon: '🚀',
      name: '爆发日',
      desc: '单日完成10个番茄',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'bronze',
      cond: function (g) { return g.maxDayFull >= 10; }
    },
{
      id: 'day16',
      group: '挑战',
      icon: '🌋',
      name: '极限日',
      desc: '单日完成16个番茄',
      color: '#E85D3A',
      bg: '#FDEBE5',
      tier: 'silver',
      cond: function (g) { return g.maxDayFull >= 16; }
    },
{
      id: 'badge1',
      group: '战标',
      icon: '🥉',
      name: '首枚战标',
      desc: '累计点亮任意战标1次',
      color: '#CD7F32',
      bg: '#FDF2E9',
      tier: 'guide',
      cond: function (g) { return g.badgeLights >= 1; }
    },
{
      id: 'badge5',
      group: '战标',
      icon: '🥈',
      name: '战标五连',
      desc: '累计点亮战标5次',
      color: '#999',
      bg: '#F5F5F5',
      tier: 'bronze',
      cond: function (g) { return g.badgeLights >= 5; }
    },
{
      id: 'badge10',
      group: '战标',
      icon: '🥇',
      name: '战标十冠',
      desc: '累计点亮战标10次',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'silver',
      cond: function (g) { return g.badgeLights >= 10; }
    },
{
      id: 'badge20',
      group: '战标',
      icon: '👑',
      name: '战标霸主',
      desc: '累计点亮战标20次',
      color: '#9B59B6',
      bg: '#F5EEF8',
      tier: 'gold',
      cond: function (g) { return g.badgeLights >= 20; }
    },
{
      id: 'rank_silver',
      group: '段位',
      icon: '🥈',
      name: '白银之约',
      desc: '生涯最高达到白银',
      color: '#A0A0A0',
      bg: '#F2F2F2',
      tier: 'bronze',
      cond: function (g) { return g.careerMax >= 40; }
    },
{
      id: 'rank_gold',
      group: '段位',
      icon: '🥇',
      name: '黄金时代',
      desc: '生涯最高达到黄金',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'silver',
      cond: function (g) { return g.careerMax >= 100; }
    },
{
      id: 'rank_platinum',
      group: '段位',
      icon: '💎',
      name: '铂金贵族',
      desc: '生涯最高达到铂金',
      color: '#5B9BD5',
      bg: '#E8F2FA',
      tier: 'silver',
      cond: function (g) { return g.careerMax >= 210; }
    },
{
      id: 'rank_diamond',
      group: '段位',
      icon: '💠',
      name: '钻石光辉',
      desc: '生涯最高达到钻石',
      color: '#4FC3F7',
      bg: '#E0F7FA',
      tier: 'silver',
      cond: function (g) { return g.careerMax >= 350; }
    },
{
      id: 'rank_star',
      group: '段位',
      icon: '⭐',
      name: '星耀之巅',
      desc: '生涯最高达到星耀',
      color: '#E91E63',
      bg: '#FCE4EC',
      tier: 'gold',
      cond: function (g) { return g.careerMax >= 500; }
    },
{
      id: 'rank_king',
      group: '段位',
      icon: '🔥',
      name: '王者加冕',
      desc: '生涯最高达到王者',
      color: '#9B59B6',
      bg: '#F5EEF8',
      tier: 'gold',
      cond: function (g) { return g.careerMax >= 650; }
    },
{
      id: 'rank_glory',
      group: '段位',
      icon: '👑',
      name: '荣耀之冠',
      desc: '生涯最高达到荣耀',
      color: '#FF6B4A',
      bg: '#FFF3E0',
      tier: 'gold',
      cond: function (g) { return g.careerMax >= 1100; }
    },
{
      id: 'forest_10',
      group: '种树',
      icon: '🌱',
      name: '萌芽林',
      desc: '森林累计种下 10 棵',
      color: '#8BC34A',
      bg: '#F1F8E9',
      tier: 'bronze',
      cond: function (g) { return g.forestTrees >= 10; }
    },
{
      id: 'forest_50',
      group: '种树',
      icon: '🌳',
      name: '小树林',
      desc: '森林累计种下 50 棵',
      color: '#4CAF50',
      bg: '#E8F5E9',
      tier: 'bronze',
      cond: function (g) { return g.forestTrees >= 50; }
    },
{
      id: 'forest_100',
      group: '种树',
      icon: '🏞️',
      name: '半亩林',
      desc: '森林累计种下 100 棵',
      color: '#2E7D32',
      bg: '#E8F5E9',
      tier: 'silver',
      cond: function (g) { return g.forestTrees >= 100; }
    },
{
      id: 'forest_365',
      group: '种树',
      icon: '🎋',
      name: '一年之林',
      desc: '森林累计种下 365 棵',
      color: '#00897B',
      bg: '#E0F2F1',
      tier: 'silver',
      cond: function (g) { return g.forestTrees >= 365; }
    },
{
      id: 'forest_1000',
      group: '种树',
      icon: '🌲',
      name: '郁郁葱葱',
      desc: '森林累计种下 1000 棵',
      color: '#00695C',
      bg: '#E0F2F1',
      tier: 'gold',
      cond: function (g) { return g.forestTrees >= 1000; }
    },
{
      id: 'forest_3000',
      group: '种树',
      icon: '🏔️',
      name: '一片森林',
      desc: '森林累计种下 3000 棵',
      color: '#33691E',
      bg: '#F1F8E9',
      tier: 'gold',
      cond: function (g) { return g.forestTrees >= 3000; }
    },
/* ===== 长线成就（十几年尺度）=====
   森林要能撑住「用几年甚至十几年」的场景：积分线 1~4 年就走完了，
   所以补的是两条与强度无关、只随时间与陪伴增长的线 —— 树龄（年）与年轮（圈）。
   阈值刻意拉开：一年 → 三年 → 十年 → 廿年，避免再出现「几天就解锁一堆」。 */
{
      id: 'forest_5000',
      group: '种树',
      icon: '🌏',
      name: '原始森林',
      desc: '森林累计种下 5000 棵',
      color: '#1B5E20',
      bg: '#F1F8E9',
      tier: 'gold',
      cond: function (g) { return g.forestTrees >= 5000; }
    },
{
      id: 'forest_10000',
      group: '种树',
      icon: '🌳',
      name: '万木之林',
      desc: '森林累计种下 10000 棵',
      color: '#0D3B0D',
      bg: '#F1F8E9',
      tier: 'gold',
      cond: function (g) { return g.forestTrees >= 10000; }
    },
{
      id: 'tree_year_1',
      group: '种树',
      icon: '🎂',
      name: '一年之约',
      desc: '同一棵树陪伴你满 1 年',
      color: '#66BB6A',
      bg: '#F1F8E9',
      tier: 'bronze',
      cond: function (g) { return g.treeYears >= 1; }
    },
{
      id: 'tree_year_3',
      group: '种树',
      icon: '🌳',
      name: '三载相守',
      desc: '同一棵树陪伴你满 3 年',
      color: '#43A047',
      bg: '#E8F5E9',
      tier: 'silver',
      cond: function (g) { return g.treeYears >= 3; }
    },
{
      id: 'tree_year_5',
      group: '种树',
      icon: '🌲',
      name: '五载同行',
      desc: '同一棵树陪伴你满 5 年',
      color: '#2E7D32',
      bg: '#E8F5E9',
      tier: 'silver',
      cond: function (g) { return g.treeYears >= 5; }
    },
{
      id: 'tree_year_10',
      group: '种树',
      icon: '🏔️',
      name: '十年之树',
      desc: '同一棵树陪伴你满 10 年',
      color: '#1B5E20',
      bg: '#F1F8E9',
      tier: 'gold',
      cond: function (g) { return g.treeYears >= 10; }
    },
{
      id: 'tree_year_20',
      group: '种树',
      icon: '🌌',
      name: '廿年古木',
      desc: '同一棵树陪伴你满 20 年',
      color: '#0D3B0D',
      bg: '#F1F8E9',
      tier: 'gold',
      cond: function (g) { return g.treeYears >= 20; }
    },
{
      id: 'ring_10',
      group: '种树',
      icon: '🪵',
      name: '十圈年轮',
      desc: '一棵树长出 10 圈年轮',
      color: '#A1887F',
      bg: '#EFEBE9',
      tier: 'bronze',
      cond: function (g) { return g.treeRings >= 10; }
    },
{
      id: 'ring_50',
      group: '种树',
      icon: '♾️',
      name: '永恒树心',
      desc: '一棵树长出 50 圈年轮',
      color: '#8D6E63',
      bg: '#EFEBE9',
      tier: 'silver',
      cond: function (g) { return g.treeRings >= 50; }
    },
{
      id: 'ring_100',
      group: '种树',
      icon: '🏛️',
      name: '百圈树心',
      desc: '一棵树长出 100 圈年轮',
      color: '#6D4C41',
      bg: '#EFEBE9',
      tier: 'gold',
      cond: function (g) { return g.treeRings >= 100; }
    },
{
      id: 'ring_500',
      group: '种树',
      icon: '🪐',
      name: '纪元之树',
      desc: '一棵树长出 500 圈年轮',
      color: '#4E342E',
      bg: '#EFEBE9',
      tier: 'gold',
      cond: function (g) { return g.treeRings >= 500; }
    },
/* 林地（封树成林）：每一代都要先把一棵树养到 50 圈，天然是十几年尺度 */
{
      id: 'grove_1',
      group: '种树',
      icon: '🌲',
      name: '第一片荫',
      desc: '把一棵树养到永恒树心，封进林地',
      color: '#2E7D32',
      bg: '#E8F5E9',
      tier: 'bronze',
      cond: function (g) { return g.grove >= 1; }
    },
{
      id: 'grove_3',
      group: '种树',
      icon: '🌲',
      name: '三树成荫',
      desc: '林地里有 3 棵树',
      color: '#1B5E20',
      bg: '#E8F5E9',
      tier: 'silver',
      cond: function (g) { return g.grove >= 3; }
    },
{
      id: 'grove_5',
      group: '种树',
      icon: '🏞️',
      name: '五树成林',
      desc: '林地里有 5 棵树',
      color: '#0D3B0D',
      bg: '#F1F8E9',
      tier: 'gold',
      cond: function (g) { return g.grove >= 5; }
    },
{
      id: 'grove_10',
      group: '种树',
      icon: '🌳',
      name: '小林主',
      desc: '林地里有 10 棵树',
      color: '#0D3B0D',
      bg: '#F1F8E9',
      tier: 'gold',
      cond: function (g) { return g.grove >= 10; }
    },
{
      id: 'tree_seedling',
      group: '种树',
      icon: '🌿',
      name: '初见绿意',
      desc: '番茄树达到嫩芽阶段(10🍅)',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'bronze',
      cond: function (g) { return (appData.tree.peakPoints || appData.tree.points) >= 10; }
    },
{
      id: 'tree_small',
      group: '种树',
      icon: '🌳',
      name: '亭亭如盖',
      desc: '番茄树长成小树(40🍅)',
      color: '#5CB85C',
      bg: '#EAF7EA',
      tier: 'silver',
      cond: function (g) { return (appData.tree.peakPoints || appData.tree.points) >= 40; }
    },
{
      id: 'tree_big',
      group: '种树',
      icon: '🌲',
      name: '参天巨木',
      desc: '番茄树长成大树(60🍅)',
      color: '#2E7D32',
      bg: '#E8F5E9',
      tier: 'silver',
      cond: function (g) { return (appData.tree.peakPoints || appData.tree.points) >= 60; }
    },
{
      id: 'tree_ancient',
      group: '种树',
      icon: '🏔️',
      name: '千年古树',
      desc: '番茄树达到古树阶段(100🍅)',
      color: '#6B5B95',
      bg: '#F0EBF7',
      tier: 'gold',
      cond: function (g) { return (appData.tree.peakPoints || appData.tree.points) >= 100; }
    },
{
      id: 'tree_world',
      group: '种树',
      icon: '🌐',
      name: '世界之树',
      desc: '番茄树达到世界树(200🍅)',
      color: '#FFD700',
      bg: '#FFF8E1',
      tier: 'gold',
      cond: function (g) { return (appData.tree.peakPoints || appData.tree.points) >= 200; }
    },
{
      id: 'tree_harvest1',
      group: '种树',
      icon: '🍎',
      name: '初次结果',
      desc: '树第一次进化获得果实',
      color: '#E85D3A',
      bg: '#FDEBE5',
      tier: 'guide',
      cond: function (g) { return (appData.tree.totalFruitsHarvested || 0) >= 1; }
    },
{
      id: 'tree_harvest10',
      group: '种树',
      icon: '🧺',
      name: '硕果累累',
      desc: '累计收集10个果实',
      color: '#D4A017',
      bg: '#FFF8E1',
      tier: 'bronze',
      cond: function (g) { return (appData.tree.totalFruitsHarvested || 0) >= 10; }
    },
{
      id: 'tree_harvest50',
      group: '种树',
      icon: '🏆',
      name: '果园主人',
      desc: '累计收集50个果实',
      color: '#9B59B6',
      bg: '#F5EEF8',
      tier: 'silver',
      cond: function (g) { return (appData.tree.totalFruitsHarvested || 0) >= 50; }
    },
{
      id: 'tree_species2',
      group: '种树',
      icon: '🌸',
      name: '树种收藏家',
      desc: '解锁2种以上树种',
      color: '#E91E63',
      bg: '#FCE4EC',
      tier: 'silver',
      cond: function (g) { return (appData.tree.unlockedSpecies || ['tomato']).length >= 2; }
    },
{
      id: 'tree_species_all',
      group: '种树',
      icon: '🌈',
      name: '万树归宗',
      desc: '解锁全部5种树种',
      color: '#FF6B4A',
      bg: '#FFF3E0',
      tier: 'gold',
      cond: function (g) { return (appData.tree.unlockedSpecies || ['tomato']).length >= 5; }
    },
{
      id: 'tree_album',
      group: '种树',
      icon: '🎁',
      name: '万物园丁',
      desc: '成长图鉴全部点亮(9阶段)',
      color: '#E85D3A',
      bg: '#FFF3E0',
      tier: 'gold',
      cond: function (g) { return (appData.tree.fruitAlbum || []).length >= 9; }
    },
{
      id: 'tree_eternal1',
      group: '种树',
      icon: '🪵',
      name: '初轮',
      desc: '世界树长出第 1 圈年轮',
      color: '#FFD700',
      bg: '#FFFDE7',
      tier: 'guide',
      cond: function (g) { return getEternalStars(appData.tree.points || 0) >= 1; }
    },
{
      id: 'tree_eternal5',
      group: '种树',
      icon: '🪵×5',
      name: '五环同心',
      desc: '世界树长出 5 圈年轮',
      color: '#FFD700',
      bg: '#FFF8E1',
      tier: 'silver',
      cond: function (g) { return getEternalStars(appData.tree.points || 0) >= 5; }
    },
{
      id: 'tree_dew3',
      group: '种树',
      icon: '💧',
      name: '露珠收藏家',
      desc: '收集3颗露珠徽章',
      color: '#1E88E5',
      bg: '#E3F2FD',
      tier: 'bronze',
      cond: function (g) { return (appData.tree.dewBadges || 0) >= 3; }
    },
{
      id: 'tree_water10',
      group: '种树',
      icon: '🚿',
      name: '甘霖使者',
      desc: '累计浇水10次',
      color: '#29B6F6',
      bg: '#E1F5FE',
      tier: 'bronze',
      cond: function (g) { return (appData.tree.waterStreak || 0) >= 10; }
    },
{
      id: 'tree_water30',
      group: '种树',
      icon: '🌊',
      name: '雨神降临',
      desc: '累计浇水30次',
      color: '#0288D1',
      bg: '#E1F5FE',
      tier: 'silver',
      cond: function (g) { return (appData.tree.waterStreak || 0) >= 30; }
    },
{
      id: 'diary1',
      group: '记录',
      icon: '📔',
      name: '初试笔锋',
      desc: '写下第一篇日记',
      color: '#8D6E63',
      bg: '#EFEBE9',
      tier: 'guide',
      cond: function (g) { return g.diaryCount >= 1; }
    },
{
      id: 'diary7',
      group: '记录',
      icon: '📚',
      name: '周记达人',
      desc: '累计写下7篇日记',
      color: '#8D6E63',
      bg: '#EFEBE9',
      tier: 'bronze',
      cond: function (g) { return g.diaryCount >= 7; }
    },
{
      id: 'diary30',
      group: '记录',
      icon: '📖',
      name: '书写人生',
      desc: '累计写下30篇日记',
      color: '#5D4037',
      bg: '#EFEBE9',
      tier: 'silver',
      cond: function (g) { return g.diaryCount >= 30; }
    },
{
      id: 'habit1',
      group: '习惯',
      icon: '🌱',
      name: '习惯萌芽',
      desc: '添加第一个习惯',
      color: '#66BB6A',
      bg: '#E8F5E9',
      tier: 'guide',
      cond: function (g) { return g.habitCount >= 1; }
    },
{
      id: 'habit5',
      group: '习惯',
      icon: '🌿',
      name: '习惯培养师',
      desc: '同时培养5个习惯',
      color: '#43A047',
      bg: '#E8F5E9',
      tier: 'bronze',
      cond: function (g) { return g.habitCount >= 5; }
    },
{
      id: 'habit100',
      group: '习惯',
      icon: '🌳',
      name: '百次坚持',
      desc: '累计习惯打卡100次',
      color: '#2E7D32',
      bg: '#E8F5E9',
      tier: 'silver',
      cond: function (g) { return g.habitTotal >= 100; }
    },
{
      id: 'min600',
      group: '时长',
      icon: '⏱️',
      name: '专注一小时',
      desc: '累计专注满600分钟',
      color: '#26A69A',
      bg: '#E0F2F1',
      tier: 'bronze',
      cond: function (g) { return g.totalMinutes >= 600; }
    },
{
      id: 'min3000',
      group: '时长',
      icon: '🕰️',
      name: '五十小时',
      desc: '累计专注满3000分钟(50小时)',
      color: '#00897B',
      bg: '#E0F2F1',
      tier: 'silver',
      cond: function (g) { return g.totalMinutes >= 3000; }
    },
{
      id: 'min10000',
      group: '时长',
      icon: '⌛',
      name: '百小时传说',
      desc: '累计专注满10000分钟(约167小时)',
      color: '#00695C',
      bg: '#E0F2F1',
      tier: 'gold',
      cond: function (g) { return g.totalMinutes >= 10000; }
    },
{
      id: 'task10',
      group: '记录',
      icon: '🗂️',
      name: '多面手',
      desc: '累计专注10种不同任务',
      color: '#7E57C2',
      bg: '#EDE7F6',
      tier: 'bronze',
      cond: function (g) { return g.uniqueTasks >= 10; }
    },
{
      id: 'task20',
      group: '记录',
      icon: '🧠',
      name: '全才',
      desc: '累计专注20种不同任务',
      color: '#5E35B1',
      bg: '#EDE7F6',
      tier: 'silver',
      cond: function (g) { return g.uniqueTasks >= 20; }
    },
{
      id: 'adv_space',
      group: '冒险',
      icon: '🚀',
      name: '深空逃逸',
      desc: '完成「星际探险」冒险（终章全通）',
      color: '#4FC3F7',
      bg: '#E3F2FD',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_space') >= 0; }
    },
{
      id: 'adv_office',
      group: '冒险',
      icon: '💼',
      name: '职场主角',
      desc: '完成「职场逆袭」冒险（终章全通）',
      color: '#FFB74D',
      bg: '#FFF3E0',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_office') >= 0; }
    },
{
      id: 'adv_xianxia',
      group: '冒险',
      icon: '⚔️',
      name: '逆天改命',
      desc: '完成「仙侠修炼」冒险（终章全通）',
      color: '#9B59B6',
      bg: '#F5EEF8',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_xianxia') >= 0; }
    },
{
      id: 'adv_detective',
      group: '冒险',
      icon: '🕵️',
      name: '完美推理',
      desc: '完成「悬疑推理」冒险（终章全通）',
      color: '#5B9BD5',
      bg: '#E8F2FA',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_detective') >= 0; }
    },
{
      id: 'adv_chase',
      group: '冒险',
      icon: '🚓',
      name: '雷霆行动',
      desc: '完成「警匪追捕」冒险（终章全通）',
      color: '#E85D3A',
      bg: '#FDEBE5',
      tier: 'silver',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_chase') >= 0; }
    },
{
      id: 'adv_random',
      group: '冒险',
      icon: '🎲',
      name: '随机冒险家',
      desc: '完成任意一次随机剧本冒险',
      color: '#9575CD',
      bg: '#F3E5F5',
      tier: 'bronze',
      cond: function (g) { return ((appData.immersiveFocus && appData.immersiveFocus.unlockedAchievements) || []).indexOf('adv_random') >= 0; }
    }
];
