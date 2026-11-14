/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01d_engine_features.js 按域拆出（2026-11-14 · S2，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；engine.js 因拼接符 "\n;\n" 在每个新文件边界各多 1 个空语句（共 6 处，长度不变）。
 * 树养成与世界树、段位核心。对外白名单：addTreePoints / rollChestReward / rollShopWheelReward / onPomodoroCompleteRank 之外的树与段位 API；增强模块只许包装，不许复制第二份实现。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot 1 files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01d9_engine_tree_rank.js
 * 分组：features
 * 职责：业务层——树种与称号、世界树 V2、每日扭蛋、必做 3 件事、保护卡、段位核心与赛季锚点
 * 功能：
 *   - 树种系统：不同树种有独特外观，果实统一为🍅 / 番茄树称号（按历史最高积分，退化不影响称号）
 *   - 世界树 V2：果实币经济 / 装饰 / 场景 / 宝箱 / 心情 / 每日任务
 *   - 每日惊喜扭蛋：每天第 3/6/9 个番茄自动触发（金币 55% > 周番茄 30% > 段位星 15%）
 *   - 必做 3 件事 v2：提前一天立目标 / 可反复重填 / 卡片放大与折叠 / 当天完成拿奖励
 *   - 保护卡 / 恢复卡系统（连续 7 天免费送卡、断签自动消耗）
 *   - 段位系统核心逻辑（11 档位 + 星级、超额星分段、任务目标锚定产能）+ 赛季锚点（标准赛季 3 个月，全服统一）
 * 函数索引（TOC）：speciesPrevFull/speciesPrevName/getCurrentTreeStages/getTreeStageFor/getTreeStage/reviveDegradePoints/rollChestReward/rollShopWheelReward/randomUnlockedDecor/_pickWeighted/gachaReward/checkGachaTrigger（+23 更多）
 * ============================================================ */

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
