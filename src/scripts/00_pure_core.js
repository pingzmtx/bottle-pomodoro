/* ============================================================
 * 00_pure_core.js · 纯函数核心（M4d）
 * ============================================================
 * 只放「不碰 DOM / appData / 存储」的纯函数，浏览器与 Node 共用同一份：
 *   - 浏览器：作为最早执行的 <script>，顶层 function 声明即全局可用；
 *   - Node：  require() 后取 exports（.default 同引用）。
 *
 * 迁移守则：从引擎迁函数进来时**原样拷贝函数体**并在原处删定义留注释，
 * 确保全局只有一份实现（消除"同名双份、改一处漏一处"）。
 * 新增纯函数优先放这里 + tests/unit_pure.js 补用例。
 * @see ARCHITECTURE-DECISIONS.md #2（番茄单一口径）#5（金币账本）#6（收益乘数链）#7（依赖方向单向）
 * ES5/ES6 保守语法（雷区：老浏览器）。
 * 函数索引（TOC）：getTodayStr/todoEyesOff/coinTxTypeLabel/coinTxNewId/coinTxMake/coinLedgerSum/coinLedgerDiff/coinTxUndoable/coinLedgerTrim/coinDurBase/coinStreakMult/coinEarnFinal（+183 更多）
 * ============================================================ */
function getTodayStr() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  const localD = new Date(d.getTime() - offset);
  return localD.toISOString().split('T')[0];
}
/* 「这条计划今天先不看」：eyesOff 记的是那天本身（YYYY-MM-DD），不是时间戳、也不是布尔。
 * 为什么用日期而不是"隐藏开关 + 明天清空"：
 *   ① 不需要任何定时任务或"打开时先清理"的逻辑 —— 字符串不再相等，第二天自然回来；
 *   ② 翻到别的日子看（列表支持切日期）能给出正确结果，而不是"全局藏起来了"；
 *   ③ 存储只有一个日期串，不会随天数增长。
 * 语义边界：只管**看**，不碰数据 —— 不加完成记录、不改下次到期、不影响连续天数。
 * 与 hideDone / hideRepOff 的区别：那两个是全局开关（藏一整类），这个是针对单条。 */
function todoEyesOff(t, day) {
  if (!t || !t.eyesOff) return false;
  const want = String(day || getTodayStr()).slice(0, 10);
  return String(t.eyesOff).slice(0, 10) === want;
}
/* ===== 魔法数字常量 =====
 * 折算基准口径：1 个完整番茄 = 25 分钟有效专注（1500 秒）。
 * 红线：POMO_BASE_SECONDS 是「统计/成就/段位折算基准」，禁止改为读取用户自定义
 * 专注时长（settings.workDuration，可被用户调成非 25 分钟）——一旦跟随用户设置，
 * 历史按 25 分钟基准折算的口径全部断裂，见《劣质代码深度检查报告》附录 B 红线。
 * POMO_DEFAULT_MINUTES 与基准值相同但语义独立：它是「专注时长默认设置」（用户可改），
 * 仅用于各处的"默认/兜底"初始化，不参与折算。
 * MIN_FULL_MINUTES：完成弹窗「完整🍅」**可选**下限（01d finishTypePlanText 与 01c 完成
 * 选项 UI 的 15 分钟判定统一走它）。⚠️ 它只是「能不能选完整🍅」的线，
 * **不是默认选中的线**——默认线见下。
 *
 * 🍅 完整/半个 的默认口径：
 *   有效专注 **满 25 分钟（POMO_BASE_SECONDS）→ 默认「完整🍅」**；
 *   **不足 25 分钟 → 一律默认「半个🍅」（0.5）**，想记完整可在完成弹窗里自行选择
 *   （≥15 分钟即可选，选了就按 1 个起算，见 calcPomos）。
 *   理由：15 分钟档之类的短时段本来就跑不到 25 分钟，不该被默认当成完整番茄。 */
const POMO_BASE_SECONDS = 1500;
const POMO_DEFAULT_MINUTES = 25;
const MIN_FULL_MINUTES = 15;
const DAY_MS = 86400000;   /* 一天的毫秒数（日期跨天/区间计算通用） */
/* (已废弃) 「九成即完整🍅」= 25×0.9 = 22.5 分钟。曾用作完成弹窗**默认选中**
   「完整🍅」的判定线，于是 22.5~24.99 分钟的整番茄被记成 0.5 —— 文案说「完整」、
   账上给半个，自相矛盾（22.5~24.99 分钟的整番茄会被记成 0.5）。
   现行口径：不足 25 分钟默认「半个🍅」，完整由用户自选。此常量**不再参与任何判定**，
   仅保留定义以免外部脚本/旧测试读到 undefined。 */
const POMO_ALMOST_FULL_MINUTES = 22.5;
const COIN_EVERY_MINUTES = 15;       /* (补) 专注分钟 → 金币：每满 15 分钟 1 金币（与完整🍅门槛值相同但语义独立） */

/* ===== 金币账本（纯函数层） =====
   @see ARCHITECTURE-DECISIONS.md #5（金币 = 余额 + 流水）
   设计出处：HabitTrove 的货币模型 = **余额 + 流水**（{ balance, transactions[] }）。
   只存余额的货币**无法撤销、无法审计** —— 算错一次就永远说不清「这金币哪来的」。
   本项目：余额唯一真相仍是树对象的 coins 字段（一切既有读取路径不动），
   `coinLog` 是**加性旁路账本**，只为审计 / 撤销 / 对账服务，老存档没有它照常跑。
   本层不碰 appData 与 DOM，浏览器与 Node 同一份实现，直接可测（tools/tests/unit_pure.js）。
   ⚠️ 记账入口在 01d3（coinEarn / coinSpend），本层只做计算 —— 这就是「薄服务 + 纯函数下沉」。 */

/** 流水类型 → 中文标签（UI 与导出共用一份，不许各处手写字符串）。 */
const COIN_TX_TYPES = {
  opening: '期初结转',
  gift: '系统奖励',
  exchange: '周番茄兑换',
  daily: '每日任务',
  mystery: '神秘任务',
  fortune: '运势补偿',
  duration: '专注时长',
  mustdo: '必做三件事',
  signin: '每日签到',
  shop: '商店消费',
  prop: '道具卡',
  skin: '皮肤/壁纸',
  gacha: '抽奖',
  redeem: '奖励兑换',
  undo: '撤销回滚',
  migrate: '数据迁移',
  misc: '其他'
};
function coinTxTypeLabel(type) {
  return COIN_TX_TYPES[String(type)] || String(type || '其他');
}
/* 流水 id 生成：时间戳 + 进程内自增序号（同毫秒多条也不会撞）。
   不用随机数 —— 便于测试复现；导入的旧流水带原 id，与本序列基本不会重号。 */
let __coinTxSeq = 0;
function coinTxNewId(now) {
  __coinTxSeq = (__coinTxSeq + 1) % 100000;
  return 'c' + String(Number(now) || Date.now()) + '-' + __coinTxSeq;
}
/** 造一条流水条目。amount 收入为正、支出为负。
    `after` = 记账后的余额（running balance）：余额一旦对不上，
    能从「哪一笔的 after 与下一笔推算对不上」直接定位。 */
function coinTxMake(o) {
  o = o || {};
  const at = Number(o.at) || Date.now();
  return {
    id: String(o.id != null ? o.id : coinTxNewId(at)),
    at: at,
    amount: Math.round(Number(o.amount) || 0),
    type: String(o.type || 'misc'),
    reason: String(o.reason || ''),
    after: Math.round(Number(o.after) || 0),
    undoOf: o.undoOf != null ? String(o.undoOf) : '',
    meta: o.meta && typeof o.meta === 'object' ? o.meta : null
  };
}
/** 账本累计（Σamount）。空值/非数组 → 0。 */
function coinLedgerSum(txs) {
  if (!Array.isArray(txs)) return 0;
  let s = 0;
  for (let i = 0; i < txs.length; i++) {
    s += Math.round(Number(txs[i] && txs[i].amount) || 0);
  }
  return s;
}
/** 对账：余额 − Σ流水 = 差额。0 = 平账（期初结转那笔就是让这个恒为 0）。 */
function coinLedgerDiff(txs, balance) {
  return Math.round((Number(balance) || 0) - coinLedgerSum(txs));
}
/** 这笔流水能不能撤：
    ① 撤销流水自身不能再撤；② 同一笔不能撤两次；③ 期初结转是基准不能撤；
    ④ 金额为 0 无意义。 */
function coinTxUndoable(txs, id) {
  if (!Array.isArray(txs) || id == null) return false;
  const sid = String(id);
  let hit = null;
  for (let i = 0; i < txs.length; i++) {
    if (String(txs[i] && txs[i].id) === sid) { hit = txs[i]; break; }
  }
  if (!hit || hit.undoOf) return false;
  if (hit.type === 'opening' || !Number(hit.amount)) return false;
  for (let j = 0; j < txs.length; j++) {
    if (String(txs[j] && txs[j].undoOf) === sid) return false;   /* 已撤过 */
  }
  return true;
}
/** 裁剪账本：只保留最近 max 条（返回新数组，不动原数组；max<=0 = 不裁）。
    裁剪只影响「能翻查到多久以前」，**余额不受任何影响**（余额是独立字段）。 */
function coinLedgerTrim(txs, max) {
  if (!Array.isArray(txs)) return [];
  const n = Math.floor(Number(max) || 0);
  if (n <= 0 || txs.length <= n) return txs.slice();
  return txs.slice(txs.length - n);
}

/* ===== 金币收益乘数链（纯函数层） =====
   @see ARCHITECTURE-DECISIONS.md #6（收益走乘数链，参数集中）
   设计出处：Level-Up-Life 的 calculateFinalXP —— 收益不写死成"一张奖励表 + 一串 if"，
   而是一条**乘数链**：final = round(base × streakMult × buffMult)，每项独立可调。
   好处三条：
     ① 新增一类加成 = 链上再加一个乘数项，既有分支一行不动；
     ② 调平衡只改 COIN_EARN_TUNING 一处（默认值的**单一出处**）；
     ③ 公式纯函数化 → 每个乘数与边界都能单测（tools/tests/unit_pure.js）。
   ★ 默认参数与改版前**数值等价**（STREAK_STEP = 0 即关闭连续加成），不动既有经济平衡：
     改版前是 24/48/86 分钟 → 1/3/6 金币，取最高档不叠加。 */
const COIN_EARN_TUNING = {
  /* 时长档位：从上往下第一个命中的 min 生效（= 取最高档、不叠加，与旧实现一致） */
  DUR_TIERS: [
    { min: 86, coins: 6 },
    { min: 48, coins: 3 },
    { min: 24, coins: 1 }
  ],
  STREAK_STEP: 0,      /* 连续天数每 1 天的加成（0.05 = 每天 +5%）。默认 0 = 与现状等价 */
  STREAK_CAP: 0.5,     /* 连续加成封顶（+50%，别让老玩家收益失控） */
  STREAK_MIN_DAYS: 3   /* 连续天数达到多少才起步 */
};
/** 时长档位基础金币（多数值 × 分钟数 → 取最高档）。 */
function coinDurBase(minutes, tiers) {
  const m = Number(minutes) || 0;
  const list = Array.isArray(tiers) && tiers.length ? tiers : COIN_EARN_TUNING.DUR_TIERS;
  for (let i = 0; i < list.length; i++) {
    if (m >= list[i].min) return list[i].coins;
  }
  return 0;
}
/** 连续加成乘数（×1 起，封顶）。step=0 → 恒为 1（关闭态，与旧数值等价）。 */
function coinStreakMult(days, step, cap, minDays) {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  const s = step == null ? COIN_EARN_TUNING.STREAK_STEP : Number(step) || 0;
  if (!s) return 1;
  const mn = minDays == null ? COIN_EARN_TUNING.STREAK_MIN_DAYS : Number(minDays) || 0;
  if (d < mn) return 1;
  const c = cap == null ? COIN_EARN_TUNING.STREAK_CAP : Number(cap) || 0;
  return 1 + Math.min(s * (d - mn + 1), c);
}
/** 专注时长收益（乘数链入口）。o = { minutes, streakDays, buffMult, ...覆盖项 } */
function coinEarnFinal(o) {
  o = o || {};
  const base = coinDurBase(o.minutes, o.tiers);
  if (base <= 0) return 0;
  const mult =
    coinStreakMult(o.streakDays, o.streakStep, o.streakCap, o.streakMinDays) *
    Math.max(0, Number(o.buffMult) || 1);
  return Math.max(0, Math.round(base * mult));
}
/* ⏱ 时分显示的唯一入口（只用于「给人看」的文本）。
   默认 12 小时制（1–12，**不带「上午/下午」前缀**）；设置里关掉「12 小时制」则用 24 小时制。
   ⚠️ 存储、输入框、CSV/备份导出一律保持 24 小时制 —— 只有这里管显示。 */
let __H12 = true;                       /* 纯函数本文件内的唯一开关，由 setHour12() 从设置同步（不读 appData，保持本文件纯净） */
function setHour12(v) { __H12 = v !== false; return __H12; }
function clockHour12() { return __H12; }
function _p2(n) { n = String(n); return n.length >= 2 ? n : '0' + n; }
function fmtHM(h, m) {
  h = Number(h); m = Number(m);
  if (!isFinite(h) || !isFinite(m)) return '';
  if (!clockHour12()) return _p2(h) + ':' + _p2(m);
  /* 12 小时制：只保留 1–12 的钟点，**不印「上午/下午」前缀**。
     ⚠️ 这是**已知且刻意保留的取舍**：去掉前缀后 "7:31" 分不出是上午还是下午，
        0 点与 12 点也都显示 "12:xx"。用户明确要这个写法，不是漏改；
        要消除歧义只有切到 24 小时制（设置里的「12 小时制」开关）。
     小时不补零，与块内时段、日程轴同一写法（见 fmtTime / tbHourLabel）。 */
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ':' + _p2(m);
}
function fmtTime(d) {
  return fmtHM(d.getHours(), d.getMinutes());
}
/* 把尾部带 "HH:MM" 的字符串（'14:00' 或 'YYYY-MM-DD HH:MM'）按当前时制转成显示文本 */
function fmtClockHM(v) {
  const s = String(v == null ? '' : v);
  const m = s.match(/(\d{1,2}):(\d{2})\s*$/);
  if (!m) return s;
  return fmtHM(+m[1], +m[2]);
}
/* 时间戳 → 本地 "9:05"（用于计划卡「实际开始/实际完成」这类快照展示） */
function fmtStampHM(ms) {
  if (!ms) return '';
  return fmtTime(new Date(ms));
}
/* 把时间戳/Date 转成本地 YYYY-MM-DD */function getDateStr(v) {
  let d = v instanceof Date ? v : new Date(v);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* 🍅 番茄折算（按 **用户在完成弹窗里选的类型** 算，不是按自动判定）：
   完整🍅 → 至少 1 个，超出部分按 时长/25 加（25min=1、37.5min=1.5、50min=2）；
   半个🍅 → 固定 0.5（简单档 10 分钟=半个 0.5）；未完成 → 0。
   ⚠️ 完整🍅 记 ≥1：选了「完整🍅」就是「跑完了一个整番茄」，账上必须是 1 个起，
   否则出现「完整🍅 ×0.5」的自相矛盾账。
   谁会被默认选成完整🍅 由 01c 完成弹窗决定（有效专注满 25 分钟才默认完整）。 */
function calcPomos(effSec, type) {
  if (type === 'incomplete') return 0;
  /* 「仅记录」不折算番茄（不是专注，不该进任何番茄账） */
  if (type === 'log') return 0;
  if (type === 'half') return 0.5;
  const sec = Math.max(0, effSec || 0);
  /* ×2/2 = 0.5 粒度：折算结果按半档递增（25min=1、37.5min=1.5、50min=2…） */
  const units = Math.floor((sec / POMO_BASE_SECONDS) * 2) / 2;
  /* **完整🍅 就是 1 个起，多出来的分钟数才往上加**：
     达「完整🍅」下限（MIN_FULL_MINUTES 15 分钟——也正是完成弹窗开放该选项的线）
     就至少记 1 个，更长才涨（25min=1、37.5min=1.5、50min=2）。
     原先一律 floor ⇒ 15~24.99 分钟（含「跑满 25 分钟但被打断几十秒」的，
     因为 effectiveSeconds = elapsed - totalInterruptSeconds）只记 0.5，
     与弹窗**默认选中「完整🍅」**的文案自相矛盾（整番茄会被记成 0.5）。
     15 分钟以下 UI 本就不给选「完整🍅」；那条路径（数据导入等）保留 0.5 兜底。 */
  if (sec >= MIN_FULL_MINUTES * 60) return Math.max(1, units);
  return Math.max(0.5, units);
}
/* 「仅记录」（type:'log'）：用户补记的非专注事项（例：去配眼镜）。
   只留在日志时间线里（可看、可编辑、可筛选），不折算番茄，也不进
   专注效率 / 专注时长 / 时长分布 / 最专注时段 / 段位积分 / 成就 / 番茄树 / 金币 / 连击。
   判断一律走本函数，别在别处手写 r.type === 'log'。 */
function isLogRecord(r) { return !!r && r.type === 'log'; }
/* ===== 金币抽奖额度（唯一口径）=====
   额度**由 records 现算**：每 perDraw 个折算番茄换 1 次抽奖机会。
   为什么不存 lotteryCount 计数器：计数器是「发放瞬间写死」的，删掉/改掉记录都不会回收，
   于是「补记一条 → 删掉」即可无限刷次数。
   改成派生后，删记录 → 番茄总额回落 → 可用次数自动消失，天然对账。
   pomos 口径与发放端一致：发放端用 Math.round(折算番茄)，这里同样 round。 */
function lotteryQuotaOf(records, perDraw) {
  const per = Number(perDraw) > 0 ? Number(perDraw) : 2;
  let quota = 0;
  const list = records || [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || typeof r !== 'object') continue;
    /* 走 getPomos 统一口径：不直接读 .pomos，老记录缺该字段时也能按类型折算 */
    const p = getPomos(r);
    if (!(p > 0)) continue; /* log / incomplete / interrupted 折算为 0 */
    quota += Math.round(p);
  }
  return Math.floor(quota / per);
}
/* 可用次数 = 额度 − 已抽掉数（used 单调递增，只增不减：删记录不退次数）。 */
function lotteryAvailFrom(records, used, perDraw) {
  const q = lotteryQuotaOf(records, perDraw);
  const u = Number(used) > 0 ? Math.floor(Number(used)) : 0;
  return Math.max(0, q - u);
}
/* ===== 树龄（陪伴天数）· 长线主轴 =====
   为什么要它：积分驱动的成长线（9 阶 → 年轮）取决于用户强度，
   1~4 年就会走完，之后十几年没有新节点。而「陪伴了多久」是不随强度缩水的
   确定性长线——**纯纪念与展示，不发任何奖励**（不给奖励，就不会长出新的可刷点）。 */
const TREE_AGE_TIERS = [
  { days: 100, name: '百日之木', icon: '🌱' },
  { days: 365, name: '一岁', icon: '🎂' },
  { days: 730, name: '两岁', icon: '🌿' },
  { days: 1095, name: '三载', icon: '🌳' },
  { days: 1825, name: '五载同行', icon: '🌲' },
  { days: 2555, name: '七年之木', icon: '🎋' },
  { days: 3650, name: '十年之树', icon: '🏔️' },
  { days: 5475, name: '十五载', icon: '⭐' },
  { days: 7300, name: '廿年古木', icon: '🌌' },
  { days: 10950, name: '三十载', icon: '🪐' }
];
/* 'YYYY-MM-DD' → 本地 0 点时间戳（不认格式返回 null，调用方兜 0） */
function dateStrToTs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return isNaN(t) ? null : t;
}
function treeAgeDays(plantedStr, todayStr) {
  const a = dateStrToTs(plantedStr),
    b = dateStrToTs(todayStr);
  if (a === null || b === null) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}
/* 完整周年数：按日历算（先比月、月同再比日），闰年不会漂 */
function treeAgeYears(plantedStr, todayStr) {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(plantedStr || ''));
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayStr || ''));
  if (!m1 || !m2) return 0;
  let y = Number(m2[1]) - Number(m1[1]);
  /* 先比月；月相同再比日（月差为 0 时才轮到日差） */
  const rest = Number(m2[2]) - Number(m1[2]) || Number(m2[3]) - Number(m1[3]);
  if (rest < 0) y -= 1;
  return Math.max(0, y);
}
/* 按天数反查档位定义（履历墙用 days 存，展示时要回查名字与图标） */
function treeAgeTierByDays(days) {
  const d = Math.floor(Number(days) || 0);
  for (let i = 0; i < TREE_AGE_TIERS.length; i++) if (TREE_AGE_TIERS[i].days === d) return TREE_AGE_TIERS[i];
  return null;
}
/* 日期加年（2/29 落到平年的 2/28；Date 会自动进位到 3/1，这里拉回来） */
function addYearsToDate(dateStr, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const mo = Number(m[2]),
    d = Number(m[3]);
  const dt = new Date(Number(m[1]) + (Number(n) || 0), mo - 1, d);
  if (isNaN(dt.getTime())) return null;
  if (dt.getMonth() !== mo - 1) dt.setDate(0);
  return getDateStr(dt);
}
/* 一段日期区间 [from, to) 的专注结账：番茄数 / 活跃天数 / 分钟数。
   年度回顾用它算「这一年」——只认记录，不引入任何新账本。 */
function rangeStatsFrom(records, fromStr, toStr) {
  const out = { pomos: 0, days: 0, minutes: 0 };
  const from = dateStrToTs(fromStr),
    to = dateStrToTs(toStr);
  if (from === null || to === null || to <= from) return out;
  const daySet = {};
  const list = records || [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || isLogRecord(r)) continue; /* 仅记录不算专注 */
    const t = Number(r.startTime);
    if (!(t >= from && t < to)) continue;
    out.pomos += getPomos(r);
    out.minutes += (Number(r.effectiveSeconds) || 0) / 60;
    daySet[getDateStr(t)] = 1;
  }
  out.days = Object.keys(daySet).length;
  out.pomos = Math.round(out.pomos * 10) / 10;
  out.minutes = Math.round(out.minutes);
  return out;
}
/* 当前树龄档 + 下一档（供树面板显示进度用） */
function treeAgeTierOf(days) {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  let cur = null,
    next = null;
  for (let i = 0; i < TREE_AGE_TIERS.length; i++) {
    if (d >= TREE_AGE_TIERS[i].days) cur = TREE_AGE_TIERS[i];
    else {
      next = TREE_AGE_TIERS[i];
      break;
    }
  }
  return { cur: cur, next: next, days: d };
}
/* 「有番茄」的记录（完整🍅 / 半个🍅）—— 与「仅记录」相对的另一半。
   森林（种树）与日志页「只看番茄」筛选**共用这一条口径**，不许各自再数一遍：
   未完成（incomplete）虽不是「仅记录」，但同样没产出番茄，不算数。 */
function isPomodoroRecord(r) { return getPomos(r) > 0; }
/* 记录类型的中文名：CSV 导出的表头全是中文，值也应该是中文（'log' 这种英文枚举读不懂） */
const RECORD_TYPE_LABELS = {
  full: '完整',
  half: '半个',
  incomplete: '未完成',
  log: '仅记录',
};
function typeLabel(t) { return RECORD_TYPE_LABELS[t] || (t == null ? '' : String(t)); }
/* CSV 单元格转义：换行折叠成空格（Excel 里单元格内换行会把行切乱）；
   含逗号或双引号的用双引号整体包住，内部引号翻倍。 */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[\r\n]+/g, ' ');
  /* ★ 公式注入防护（P2-25）：以 = + - @ 或制表符开头的单元格，Excel/WPS 打开会当公式求值
     （`=HYPERLINK(...)`、`=cmd|...` 一类）。前置一个单引号是最通用的"当文本"标记，
     导出文件在表格软件里显示时不带这个引号。 */
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
  /* ⚠️ 这里**刻意不用**带引号的字符类正则：tools/check_tomato_single_source.py 的
     strip_comments() 是个"够用的小状态机"（自带注释说明它不解析正则字面量），
     正则里出现引号会让它误判成"字符串开始"，于是**本文件此后的块注释全部不再被剥离** ——
     结果把别处注释里提到的字段名当成真代码报错。
     用 indexOf / split-join 表达同一件事，对状态机安全。 */
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0) {
    s = '"' + s.split('"').join('""') + '"';
  }
  return s;
}
/* 子计划快照 → 一行文本，如「✓看周计划 ○制定计划」。
   planSubs 是 [{t:步骤名, d:是否完成}] 结构，直接 String() 只会得到 [object Object]。 */
function planSubsText(subs) {
  if (!Array.isArray(subs) || !subs.length) return '';
  return subs
    .map(function (s) {
      return (s && s.d ? '✓' : '○') + String((s && s.t) || '未命名');
    })
    .join(' ');
}
/* ===== 专注记录 → CSV 表格（**唯一定义处**）=====
   此前有两份各自维护的实现：设置页「手动导出全部记录」17 列、
   「记录清理前自动备份」14 列 —— 同一份数据两个结构，连「折算番茄」的算法都不同
   （一处走 getPomos 折算、一处直接读原始 pomos）。这份表统一两者，两边都取用，
   以后给 records 加字段只改这里一处。
   纯函数（不碰 DOM / 不碰存储），浏览器与 Node 单测共用同一份实现。
   返回 { head:[...], lines:[...] }；调用方自己拼 BOM、换行、文件名与落盘。
   兼容老记录：字段缺失一律输出空串，不报错、也不会串位。 */
function recordsCsvTable(recs) {
  const head = [
    '日期',
    '开始时间',
    '结束时间',
    '有效时长(分)',
    '折算番茄',
    '类型',
    '难度',
    '任务',
    '备注',
    '打断次数',
    '累计打断(秒)',
    '开始精力',
    '开始心情',
    '结束精力',
    '结束心情',
    '预计番茄',
    '实际番茄',
    /* ↓ 计划关联快照。前 17 列的顺序与取值不动 —— 外部表格可能已依赖列序；
       新列只在**末尾追加**，老记录取不到值就留空。 */
    '计划',
    '子任务',
    '标签',
    '四象限',
    '子计划进度',
    '计划ID'
  ];
  const list = Array.isArray(recs) ? recs : [];
  const lines = [head.join(',')];
  for (let i = 0; i < list.length; i++) {
    const r = list[i] || {};
    const sd = new Date(r.startTime || 0);
    const ed = new Date(r.endTime || r.startTime || 0);
    const hm = function (d) {
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    const qm = r.quad ? quadMeta(r.quad) : null;
    lines.push(
      [
        getDateStr(sd),
        hm(sd),
        hm(ed),
        Math.round((Number(r.effectiveSeconds) || 0) / 60),
        fmtTomatoNum(getPomos(r)), /* 走「唯一读路径」，兼容无 pomos 的老记录 */
        typeLabel(r.type),
        r.difficulty || '',
        r.taskName || '',
        r.note || '',
        (r.interruptions && r.interruptions.length) || 0,
        Math.round(Number(r.totalInterruptSeconds) || 0),
        r.startEnergy || '',
        r.startMood || '',
        r.energy || '',
        r.mood || '',
        r.expectedPomodoros == null ? '' : r.expectedPomodoros,
        r.actualPomodoros == null ? '' : r.actualPomodoros,
        /* —— 以下为计划关联快照，老记录没有这些字段 —— */
        r.planTitle || '',
        r.subTitle || '',
        r.tag || '',
        qm ? qm.label : r.quad ? String(r.quad) : '',
        planSubsText(r.planSubs),
        r.todoId == null ? '' : r.todoId
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return { head: head, lines: lines };
}
/* 读取记录折算番茄数（兼容历史记录无 pomos 字段） */
function pomosOf(r) {
  /* 「这条记录算几分」的唯一读路径：getPomos 与 getEffectiveFull（有效番茄折算）都从这里取。
     两处各写一份 full/half 映射的话，加类型或改分值就得改两遍，必然分叉。 */
  if (!r) return 0;
  if (r.pomos !== undefined && r.pomos !== null) return Number(r.pomos) || 0;
  return r.type === 'full' ? 1 : r.type === 'half' ? 0.5 : 0;
}
function getPomos(r) {
  return pomosOf(r);
}
/* 番茄点数显示：整数不带小数，小数保留 1 位 */
function fmtTomatoNum(n) {
  n = Math.max(0, n || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
/* 大数番茄：整数部分加千分位（12338 → '12,338'）。只用于**展示**，算术一律用原始数值。
   ★ 为什么不用「万」：累计卡是 `之前 + 今天 = 累计` 的一行账，压缩到万 →
     「1.23万 + 8 = 1.23万」两边相等，看起来像算错了。千分位保住个位，
     加号右侧永远能看出今天涨了多少；位数多了靠降字号解决（见 .ppc-num 的档位）。 */
function fmtPomoGrouped(n) {
  n = Math.max(0, Number(n) || 0);
  const s = fmtTomatoNum(n);
  const dot = s.indexOf('.');
  const int = dot < 0 ? s : s.slice(0, dot);
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dot < 0 ? '' : s.slice(dot));
}
/* 时长单位自适应：满 60 分钟用「小时」（1 位小数，整数不带 .0），不到 1 小时仍用「分钟」。
   目的：长年累计的分钟数会撑出 6~8 位长数字（排不下、也没人读得懂），换算成小时后位数砍到 1/60。
   返回 {num: 显示用字符串, unit: '小时'|'分钟'}。 */
function fmtMinUnit(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  if (min < 60) return { num: String(min), unit: '分钟' };
  const h = Math.round(min / 6) / 10; /* = min/60，保留 1 位小数 */
  return { num: Number.isInteger(h) ? String(h) : h.toFixed(1), unit: '小时' };
}
/* 🍅 → 时间（分钟）：番茄账折出来的「专注时长」唯一口径（4🍅 = 100 分钟）。
   一律用 POMO_BASE_SECONDS 换算，禁止别处写死 25 —— 改基准时这里跟着变。
   ⚠️ 这是「番茄账换出来的时间」，与「记录的实际计时时长」是两个口径，展示时勿混。 */
function pomosToMinutes(p) {
  const n = Math.max(0, Number(p) || 0);
  return Math.round((n * POMO_BASE_SECONDS) / 60);
}
/* 深度净化外部数据（导入备份/剧本 JSON.parse 结果）。
   JSON.parse 产生的 __proto__ 是【自有数据属性】，经 Object.assign/展开合并时
   会走 [[Set]] 语义触发目标对象的 __proto__ setter → 原型被替换（原型污染），
   之后所有「读不存在键」的兜底逻辑都会读到污染值。
   对策：递归剔除 __proto__/constructor/prototype 三个危险键；返回新对象，不改入参。 */
function deepSanitize(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const a = [];
    for (let i = 0; i < v.length; i++) a.push(deepSanitize(v[i]));
    return a;
  }
  const o = {};
  for (const k in v) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = deepSanitize(v[k]);
  }
  return o;
}
/* ===== 日志相邻记录合并（纯函数 · 只服务展示层）=====
 * 场景一：同一件任务连着做了两段（满 25 分钟结算后紧接着又开一轮），
 *         日志里是一行一条，读起来看不出「这其实是一整段」。
 * 场景二：补记时手滑把同一段时间记了两遍，列表里出现一条一模一样的幽灵记录。
 * 本函数只做「展示分组」，**一条记录都不碰、不改任何统计口径**：
 *   ① 去重：相邻且同任务名 + 同类型 + 起止时间都在 LOG_DUP_TOLERANCE_SEC 内
 *      → 判为同一段，只留先出现的那条（dropped 记原始多出来的条数，供界面标注）。
 *   ② 合并：相邻且同任务名 + 同一「类别」，且后一条开始 - 前一条结束 ≤ LOG_MERGE_GAP_SECONDS
 *      → 归为一组，时长与番茄数累加。
 *      **间隔可以是负数（轻微重叠）**：补记只填到分钟，前一段结束在 16:42:10、
 *      后一段从 16:42:00 起，天然重叠十几秒；旧写法要求 gap>=0 会把同一件事拆成两行。
 *      重叠容忍上限 LOG_MERGE_OVERLAP_TOL_SEC，超过就视为两件独立的事，不合并。
 *      类别只看「是不是补记（仅记录）」：同一件任务先跑完一个完整番茄、接着又补个半个 / 未完成，
 *      本来就是一整段；要求 type 完全相同会让它硬生生断成两行。
 *      混合类别时置 g.mixedTypes=true，交给渲染层在组头把各段的结算结果列清楚。
 * 「待补填」（pending）的记录一律不参与合并：它的起止时间还没确认。
 * 入参 records 是渲染顺序（startTime 降序）；返回同样降序的分组数组。 */
const LOG_MERGE_GAP_SECONDS = 30 * 60;
const LOG_MERGE_OVERLAP_TOL_SEC = 120;
const LOG_DUP_TOLERANCE_SEC = 60;
/* 合并只看粗粒度类别：专注类（完整/半个/未完成/打断）互相可续，补记(仅记录)单独一类。 */
function logMergeKind(type) {
  return type === 'log' ? 'log' : 'focus';
}
function mergeLogRecords(records) {
  const list = (records || [])
    .slice()
    .sort(function (a, b) { return (a.startTime || 0) - (b.startTime || 0); });
  const pomosOf = function (r) {
    if (typeof r.pomos === 'number') return r.pomos;
    return calcPomos(r.effectiveSeconds || 0, r.type);
  };
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const name = r.taskName || '';
    const g = out.length ? out[out.length - 1] : null;
    if (g && !r.pending && !g.pending && g.taskName === name && logMergeKind(g.type) === logMergeKind(r.type)) {
      const last = g.segments[g.segments.length - 1];
      const dup =
        Math.abs((r.startTime || 0) - (last.startTime || 0)) <= LOG_DUP_TOLERANCE_SEC * 1000 &&
        Math.abs((r.endTime || 0) - (last.endTime || 0)) <= LOG_DUP_TOLERANCE_SEC * 1000;
      if (dup) {
        g.dropped++;
        continue;
      }
      /* 用整组的「最晚结束」而不是上一段的结束：段可能参差不齐，
         拿上一段比会把已经覆盖过去的时间当成空档。 */
      const gap = ((r.startTime || 0) - g.endTime) / 1000;
      /* gap 为负 = 两段在时间上重叠：补记只填到分钟，前一段 16:42:10 结束、
         后一段 16:42:00 开始，天然重叠十几秒 —— 那是同一件事写成两条，不是两件事。
         超过 LOG_MERGE_OVERLAP_TOL_SEC 的重叠才判为独立，不合并。 */
      if (gap <= LOG_MERGE_GAP_SECONDS && gap >= -LOG_MERGE_OVERLAP_TOL_SEC) {
        if (r.type !== g.type) g.mixedTypes = true;
        g.segments.push(r);
        g.endTime = Math.max(g.endTime, r.endTime || 0);
        g.effectiveSeconds += r.effectiveSeconds || 0;
        g.pomos += pomosOf(r);
        g.interruptCount += (r.interruptions && r.interruptions.length) || 0;
        continue;
      }
    }
    out.push({
      taskName: name,
      type: r.type,
      startTime: r.startTime || 0,
      endTime: r.endTime || 0,
      effectiveSeconds: r.effectiveSeconds || 0,
      pomos: pomosOf(r),
      segments: [r],
      dropped: 0,
      /* 组内出现不同结算结果（如 完整+半个）时置位：渲染层据此把各段结果列出来 */
      mixedTypes: false,
      interruptCount: (r.interruptions && r.interruptions.length) || 0,
      pending: !!r.pending
    });
  }
  out.sort(function (a, b) { return b.startTime - a.startTime; });
  return out;
}
/* ===== 「本轮」统计（纯函数 · 唯一真相是记录本身）=====
 * 「本轮：完整🍅 x｜半个🍅 y｜未完成 z」不能用 round 里三个自增数字：
 * 那样会和记录各算各的 —— 删掉日志、把类型改掉、导入备份之后数字不会跟着变
 * （出现「未完成 4」而列表里只剩 1 条这种对不上的情况）。
 * 数字与记录是同一件事，就必须只有一个来源：一律由记录现算，删 / 改 / 导入天然同步。
 * 本轮起点 startTs：长休息、结束本轮、间隔太久(TIMER_BUFFER) 时刷新，
 * 只保留 startTs 之后的记录。 */
function computeRoundStats(records, startTs) {
  const st = { full: 0, half: 0, incomplete: 0, lastFullEndTime: 0 };
  const from = Number(startTs) || 0;
  const list = records || [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || isLogRecord(r)) continue; /* 仅记录不是专注，不进本轮 */
    if ((Number(r.startTime) || 0) < from) continue;
    if (r.type === 'full') {
      st.full++;
      const e = Number(r.endTime) || 0;
      if (e > st.lastFullEndTime) st.lastFullEndTime = e;
    } else if (r.type === 'half') {
      st.half++;
    } else if (r.type === 'incomplete') {
      st.incomplete++;
    }
  }
  return st;
}
/* ===== id 工具（内联 handler 安全嵌入 + 跨类型 id 容错比较）=====
 * 背景：记录/待办/习惯的 id 正常是 Date.now() 数字，但**备份文件与导入**
 * （01b applyBackupData / importData）会原样照搬外部 JSON，id 可能是字符串。
 * 两处后果：① 内联 handler 裸拼 `${x.id}` → 浏览器把 `rec_abc` 当变量名解析
 * （ReferenceError，菜单/删除按钮点了没反应）；② `x.id === id` 严格比较
 * 在 number vs "1759…" 时恒不相等 → 删除**静默失效**（不报错、删不掉）。
 * 修法：内联 handler 一律用 idArg() 安全嵌入；id 比较一律用 idEq() 容错。 */

/* 把 id 安全嵌进内联 handler 的 JS 字面量：数字原样返回，
 * 其余按「单引号字符串字面量」转义（先 & < 再引号，避免二次转义）。 */
function idArg(v) {
  if (typeof v === 'number' && isFinite(v)) return String(v);
  return "'" + String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;') + "'";
}
/* id 容错比较：先严格相等，再字符串化兜底（跨类型 id 也能配对）。 */
function idEq(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}
/* 在子任务数组里按 id 取一条；id 为空或找不到都返回 null。
   计时页「正在做哪条子任务」与记录回填共用，避免各写一遍 for 循环。 */
function findSubById(subs, id) {
  if (!subs || !subs.length || id === null || id === undefined || id === '') return null;
  for (let i = 0; i < subs.length; i++) if (idEq(subs[i] && subs[i].id, id)) return subs[i];
  return null;
}
/* ===== 计划「时间」纯函数：提醒=开始(remindAt) / 预计结束(estEnd) =====
 * 口径：把 N 个番茄排成时间线，专注与休息交替，据预计开始推出预计结束。
 *   [专注, 休息, 专注, 休息, ...]；第 i 段休息后是否长休＝ i 是否 longInterval 的整数倍
 *   （与 01c checkLongBreakTrigger 的口径一致：每完成 longInterval 个完整番茄后长休）。
 *   半个番茄（0.5 之类）排在最后，只占半个专注时长，后面不再接休息。
 * 时长一律读用户真实设置（workDuration/shortBreak/longBreak/longInterval），
 * 不写死 25 分钟——用户改专注时长，预计结束要跟着变。 */
function todoEstDurationMin(pomodoros, settings) {
  const pRaw = Number(pomodoros);
  if (!isFinite(pRaw) || pRaw <= 0) return 0;
  /* ★ 上限 999：用 for 循环逐个累加休息时，在计划框 / 新建弹窗里粘一个天文数字（比如 1e9）
     会把页面卡死。现在用公式一步算出，并在入口钳制上限，双保险。 */
  const p = Math.min(pRaw, 999);
  const s = settings || {};
  const wd = Number(s.workDuration) > 0 ? Number(s.workDuration) : POMO_DEFAULT_MINUTES;
  const sb = Number(s.shortBreak) >= 0 ? Number(s.shortBreak) : 5;
  const lb = Number(s.longBreak) >= 0 ? Number(s.longBreak) : 20;
  const iv = Math.max(1, Math.floor(Number(s.longInterval)) || 4);
  const fulls = Math.floor(p + 1e-9);   /* 整番茄个数（浮点误差兜底） */
  const frac = p - fulls;               /* 末尾零头（0.5 之类） */
  let mins = p * wd;                    /* 专注总时长（含零头） */
  /* 整番茄之间的休息（共 fulls-1 段，其中每 iv 番茄后为长休）——用公式一步算，不再 for 循环 */
  if (fulls > 1) {
    const gaps = fulls - 1;
    const longs = Math.floor(gaps / iv);
    mins += longs * lb + (gaps - longs) * sb;
  }
  /* 零头番茄之前的那段休息（第 fulls 个整番茄之后） */
  if (frac > 0 && fulls >= 1) mins += (fulls % iv === 0) ? lb : sb;
  return Math.round(mins);
}
/* "YYYY-MM-DD HH:MM" / "YYYY-MM-DDTHH:MM" → 本地 Date（非法返回 null） */
function parseLocalDT(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  return isNaN(d.getTime()) ? null : d;
}
/* 本地时间加分钟，回 "YYYY-MM-DD HH:MM"（跨天/跨月自动进位；非法输入返回 ''） */
function addMinutesToLocal(dtStr, mins) {
  const d = parseLocalDT(dtStr);
  if (!d || !isFinite(Number(mins))) return '';
  d.setMinutes(d.getMinutes() + Math.round(Number(mins)));
  /* ★ 越界保护：分钟数过大时 Date 超出可表示范围，getFullYear() 全是 NaN，
     会吐出 "NaN-NaN-NaN NaN:NaN" 这种脏值直接显示在计划行上（normDT 的“脏值一律空串”约定被绕过）。 */
  if (isNaN(d.getTime())) return '';
  const out = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + _hm24(d);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(out) ? out : '';
}
/* 内部：24 小时制 "HH:MM" —— **专供生成落盘/比较用的数据串**。
   ★ 不要在这里用 fmtTime()：fmtTime 受「12 小时制」显示开关影响，
     一旦开关打开，normDT/addMinutesToLocal 会吐出 "2026-10-11 下午2:00" 这种脏串（数据损坏）。 */
function _hm24(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
/* 归一化时间串 → "YYYY-MM-DD HH:MM"（接受 T 或空格分隔；非法/空 一律 ''）。
   落盘、比较、显示统一走这里，界面上就不会再出现半截的脏值。 */
function normDT(s) {
  const d = parseLocalDT(s);
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + _hm24(d);
}
/* "YYYY-MM-DD HH:MM" → <input type=datetime-local> 需要的 "YYYY-MM-DDTHH:MM" */
function dtToInput(s) {
  const n = normDT(s);
  return n ? n.replace(' ', 'T') : '';
}
/* 计划时间模型（唯一真相）：提醒时间 = 预计开始时间，两者本就是一个字段。
 *   auto  —— 是否「自动推算」态：有预计番茄数 且 有开始(提醒)时间 且 **用户没指定过结束**
 *   start —— 预计开始（= 提醒时间，已归一化）
 *   end   —— 预计结束：auto 时由番茄时长推算，否则取用户手填的 estEnd
 *   manual—— 结束时间是用户指定的（estEndManual）：哪怕有开始 + 番茄数也不自动算，
 *            免得「日程表点两格定的时段 / 手改的结束时间」被反算顶掉（用户实测过的 bug）。
 * 未标 manual 时（老数据一律如此）**优先自动推算**，用户手填的 estEnd 不参与显示、也不该落盘。 */
function todoEstAuto(t, settings) {
  /* 与 todoEstInfo 同源，避免「自动态」的判定在两处各写一遍后走偏 */
  return todoEstInfo(t, settings).auto;
}
/* 「预计时段」= 排期里的第一段。
 * 之后不再有「提醒 + 预计番茄自动推算结束」这回事：
 * 提醒是提醒，排期是排期，段的起止由用户自己画。
 * auto 恒为 false —— 保留字段只为不炸旧调用点（UI 里那些"自动推算"文案要一并删掉）。 */
function todoEstInfo(t, settings) {
  const b = todoBlocksOf(t, settings)[0];
  if (!b) return { auto: false, start: '', end: '', mins: 0, manual: true };
  const sm = tbHHMMToMin(b.start);
  const em = tbHHMMToMin(b.end);
  return {
    auto: false,
    start: b.start,
    end: b.end,
    mins: (sm != null && em != null && em > sm) ? em - sm : 0,
    manual: true
  };
}
/* 只要预计结束时间（大多数调用点用这个） */
function todoEstEnd(t, settings) {
  return todoEstInfo(t, settings).end;
}
/* 时长 → 预计番茄数：todoEstDurationMin 的反函数。取**不超过**该时长的最大番茄数（0.5 粒度），
   使「提醒时间 + 这些番茄排出来的时长」不会越过后一个时刻。
   不做除法：番茄时长不是固定值 —— 时间线里夹着短休/长休（见 todoEstDurationMin），
   直接除会算出一个结束时间越界的番茄数。
   返回 0 表示该时长排不下最小的半个番茄，调用方自行决定怎么落位。 */
function todoPomosForMinutes(mins, settings) {
  const m = Number(mins);
  if (!isFinite(m) || m <= 0) return 0;
  let best = 0;
  /* 上限 999 与 todoEstDurationMin 的入口钳制对齐，避免这里空转 */
  for (let p = 0.5; p <= 999; p += 0.5) {
    if (todoEstDurationMin(p, settings) <= m) best = p;
    else break;
  }
  return best;
}
/* ===== 计划「四象限」（重要/紧急 二维分类）=====
 * 只放分类本身（键 / 中文名 / 排序序 / 处理建议），不放任何 DOM 或配色 —— 配色属于视图层。
 * 排序序 = 数组下标，所以「按四象限排序」永远是 q1→q4，未分类垫底。 */
const TODO_QUADS = [
  { key: 'q1', label: '重要又紧急', short: '重要紧急', hint: '马上做' },
  { key: 'q2', label: '重要不紧急', short: '重要不急', hint: '排期做' },
  { key: 'q3', label: '紧急不重要', short: '紧急次要', hint: '尽快做' },
  { key: 'q4', label: '不重要不紧急', short: '例行杂事', hint: '有空做' }
];
/* 任意输入 → 合法象限键；认不出（含空、旧数据、脏串）一律 null = 未分类 */
function normQuad(v) {
  const s = v === null || v === undefined ? '' : String(v).trim().toLowerCase();
  for (let i = 0; i < TODO_QUADS.length; i++) if (TODO_QUADS[i].key === s) return s;
  return null;
}
/* 象限元信息；未分类返回 null（调用方自己决定怎么显示） */
function quadMeta(v) {
  const k = normQuad(v);
  if (!k) return null;
  for (let i = 0; i < TODO_QUADS.length; i++) if (TODO_QUADS[i].key === k) return TODO_QUADS[i];
  return null;
}
/* 排序权重：q1..q4 = 0..3，未分类 = 4（永远最后） */
function quadRank(v) {
  const k = normQuad(v);
  if (!k) return TODO_QUADS.length;
  for (let i = 0; i < TODO_QUADS.length; i++) if (TODO_QUADS[i].key === k) return i;
  return TODO_QUADS.length;
}
/* ===== 习惯统计（纯计算；视图层只管画）=====
 * 数据模型向后兼容，旧习惯没这些字段时按默认值处理：
 *   h.repeat       节奏规则（与计划页 todo.repeat 同构；缺省 = 每天）
 *   h.freqPerWeek  老口径目标频次（次/周，1..7；只在没有 repeat 时生效）
 *   h.createdAt    创建日 'YYYY-MM-DD'（缺省时视为"一直都在"，不虚增分母）
 * 「习惯强度」只取最近 HABIT_WINDOW_DAYS 天的达标率，不做 Loop 那种指数平滑 ——
 * 平滑窗口需要额外参数，对手机端小屏反而难解释。
 *
 * ★ 2026-10-30 习惯「节奏」升级（口径全部收在这一段，别处不许再算一遍）：
 *   数据：h.repeat 与 todo.repeat 同构，直接复用 normTodoRepeat / todoRepeatMatches。
 *         **没有 repeat 字段 = 每天**，所以老存档零迁移、行为与升级前逐项一致。
 *   口径：有 repeat → 「该不该做」由 habitDueOn 决定，freqPerWeek 一律不再参与统计
 *         （值原样留着不删，免得丢信息；但两套口径绝不叠加）。
 *         没有 repeat → 退回 freqPerWeek 老公式（天数 × N/7）。
 *   连续天数：规则型习惯改为**按命中日连续** —— 规则不命中的日子（比如「每周一三五」
 *         的周二）压根不参与判断，既不加分也不算断链；该做而没做的那天才算断。
 *         所以文案是「连续 N 次」而不是「连续 N 天」（见 habitStreakUnit）。
 *   达标率：分子也只数「应做日」的打卡（非应做日的补卡不进分子，否则 30 天里天天补卡
 *         也能刷到 100%）。分母 = 窗口内的命中日数。
 */
const HABIT_WINDOW_DAYS = 30;
const HABIT_FREQ_DEFAULT = 7;
/* 习惯的节奏规则（归一化后的副本）；没有规则 / 规则非法 → null（= 每天）
 * interval 的锚点优先取规则自带，其次取创建日：缺锚点时 todoRepeatMatches 会把
 * 「每隔 N 天」当成每天都命中（diff 恒为 0），那是静默的错，宁可按创建日锚死。 */
function habitRepeatOf(h) {
  if (!h || !h.repeat) return null;
  const rr = normTodoRepeat(h.repeat);
  if (!rr) return null;
  if (rr.mode === 'interval' && !rr.anchor) {
    const created = h.createdAt ? String(h.createdAt).slice(0, 10) : '';
    if (isDateStrOk(created)) return Object.assign({}, rr, { anchor: created });
  }
  return rr;
}
/* 「配额型」= 没有日历规则、但给自己定了每周不到 7 次的目标（freqPerWeek < 7）。
 * 这种习惯的正确问法不是「今天该不该做」，而是「这周还差几次」——
 * 参考 Loop / OpenHabitTracker 的额度模型（见 习惯项目调研.md §4②）。
 * 判据收在这里一处：判定、统计、文案三边都问它，才不会各说各的。 */
function habitIsQuota(h) {
  return !habitRepeatOf(h) && habitFreqPerWeek(h) < 7;
}
/* 所在周的周一（周一为一周之始，与 isoWeekday 的 1..7 对齐） */
function weekStartStr(ds) {
  return addDaysStr(ds, -(isoWeekday(ds) - 1));
}
/* 跳过日的集合 { 'YYYY-MM-DD': true }
 * 只来自存档里的跳过长表（按习惯 id 存日期，Loop 的 `-` 语义 = 提前声明的休息日）。
 * 跳过日的语义 —— **这天既不欠账也不破链**：分母少一次、连续数直接跨过去、也不进「今天该做」。
 *
 * ★ 2026-11-04：h.skipOn（眼睛按钮）**不再算跳过日**。
 *   用户原话：「假如今天没完成，我就想不看了，把眼睛一关闭 —— 那个跳过，为什么它会保留连续的天数呢」。
 *   眼睛只是「今天这张卡收起来」，不等于"这天我请假了"：没做就是没做，
 *   连续数该断就断、达标率该扣就扣。今天还没过完所以不影响今天的连续数，
 *   过了零点还没打卡，第二天就会看到断链 —— 这才是老实话。
 *   旧存档里的 skipOn 原本是"跳过"凭据，现在按同一个字面意思读成"藏起来"，不迁移、不报错。 */
function habitSkipSet(h, skipDates) {
  const set = {};
  /* 脏输入不许崩：传对象/字符串进来最多是"没有跳过"，不能抛错（视图层传 null 是常态） */
  (Array.isArray(skipDates) ? skipDates : []).forEach(function (d) {
    const s = String(d == null ? '' : d).slice(0, 10);
    if (isDateStrOk(s)) set[s] = true;
  });
  void h;
  return set;
}
/* 这一天是不是被眼睛收起来了（h.skipOn 只在当天有效，次日自动失效）。
 * 只影响「今天该做 / 今天不用做」这两处列表，不进分母、不保护连续数。 */
function habitHiddenOn(h, ds) {
  const s = String(ds == null ? '' : ds).slice(0, 10);
  if (!isDateStrOk(s)) return false;
  const hid = h && h.skipOn ? String(h.skipOn).slice(0, 10) : '';
  return !!hid && hid === s;
}
/* 跳过日表归一化：{ habitId: ['YYYY-MM-DD', ...] }
 * 脏值（非数组 / 非日期串 / 重复 / 空表）一律丢掉 —— 一个坏 key 会让每次渲染都跑无意义的正则。
 * 抽成纯函数是为了能单测：原来这段 inline 在 loadData() 里，用例根本调不到。 */
function normHabitSkips(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(function (k) {
    const v = raw[k];
    if (!Array.isArray(v)) return;
    const arr = [];
    v.forEach(function (d) {
      const s = String(d == null ? '' : d).slice(0, 10);
      if (isDateStrOk(s) && arr.indexOf(s) < 0) arr.push(s);
    });
    if (arr.length) { arr.sort(); out[k] = arr; }
  });
  return out;
}
/* 配额型：本周（周一起）已经打够 N 次 → 今天不再出现；没打够 → 今天该做。
 * 「做满 N 次就收工」比「每天都摆在那儿」诚实得多：前者能兑现，后者只能制造欠账感。 */
function habitQuotaDueOn(h, ds, logDates) {
  const s = String(ds == null ? '' : ds).slice(0, 10);
  const n = habitFreqPerWeek(h);
  const start = weekStartStr(s);
  const set = {};
  (logDates || []).forEach(function (d) { set[String(d).slice(0, 10)] = true; });
  let done = 0;
  let cur = start;
  for (let i = 0; i < 7 && cur && cur <= s; i++) {
    if (set[cur]) done++;
    cur = addDaysStr(cur, 1);
  }
  return done < n;
}
/* 这一天「该做这个习惯」吗
 *   repeat 规则 → 命中日才算该做；
 *   配额型（每周 N 次）→ 本周额度没用完才算该做；
 *   其余（每天）→ 恒 true。
 * 早于创建日的日子一律不算该做：刚建的习惯不该背建之前的历史欠账。
 * 跳过日一律不算该做 —— 一处豁免，分母/连续数/列表三处同时生效。 */
function habitDueOn(h, ds, skips, logDates) {
  const s = String(ds == null ? '' : ds).slice(0, 10);
  if (!isDateStrOk(s)) return false;
  /* 容错：调用方直接塞数组时就地归一化，免得漏转一次就静默失效 */
  if (Array.isArray(skips)) skips = habitSkipSet(null, skips);
  if (skips && skips[s]) return false;
  /* 眼睛收起来的今天：不进「今天该做」，也不进「今天不用做」的该做判定之外的东西。
     注意它不保护连续数（见 habitSkipSet 的说明）。 */
  if (habitHiddenOn(h, s)) return false;
  const created = h && h.createdAt ? String(h.createdAt).slice(0, 10) : '';
  if (isDateStrOk(created) && s < created) return false;
  if (habitIsQuota(h)) return habitQuotaDueOn(h, s, logDates);
  const rr = habitRepeatOf(h);
  if (!rr) return true;
  /* 间隔型：有打卡记录 → 按真实打卡间隔推（见 habitIntervalPlan）；
     还没打过卡 → 沿用「锚点=创建日」的老口径，这样新建的习惯当天就显示该做。 */
  if (rr.mode === 'interval' && Array.isArray(logDates) && logDates.length) {
    return !!habitIntervalPlan(logDates, rr.interval, skips, s).due[s];
  }
  return todoRepeatMatches(rr, s);
}
/* 间隔型（每隔 N 天）的自适应「该做日」网格 —— 2026-11-08 新增。
 * ★ 为什么不能沿用 todoRepeatMatches 的锚点网格：间隔式没有真正的日历锚点，
 *   用户「每隔 3 天」实际打卡日往往和锚点差一天，锚点网格就会把他每一次打卡
 *   都判成「不是该做日」、把他没打卡的日子全判成「该做但没做」——
 *   实测：规律打 23 次，月历全红、达标 0%、成长点 0。
 * 口径：以真实打卡日推进。任一打卡日都是"该做日"；两次打卡之间的空档
 *   超过 N 天时，从上一个打卡日 +N 起每 N 天算一个漏点，最多算到 +N*BREAK
 *   （更久 = 断更，不再继续累积欠账，与 habitGrowthPoints 的断更重置保持一致）。
 * 返回 { due: {日期:true}, miss: {日期:true} }，纯函数、只依赖入参。
 * upto：只推到这一天为止（月历翻到旧月份时不必推到现在）。 */
function habitIntervalPlan(logDates, interval, skipDates, upto) {
  const n = Math.max(1, parseInt(interval, 10) || 1);
  const skips = skipDates || {};
  const ds = (logDates || [])
    .map(function (x) { return String(x == null ? '' : x).slice(0, 10); })
    .filter(function (x) { return isDateStrOk(x); })
    .sort();
  const due = {}, miss = {};
  if (!ds.length) return { due: due, miss: miss };
  const end = isDateStrOk(String(upto || '').slice(0, 10))
    ? String(upto).slice(0, 10) : ds[ds.length - 1];
  due[ds[0]] = true;
  for (let i = 1; i < ds.length; i++) {
    const prev = ds[i - 1], cur = ds[i];
    due[cur] = true;
    const gap = daysBetweenStr(prev, cur);
    if (gap <= n) continue;
    /* 空档太长：标漏点，但最多到 prev + n*BREAK（再往后算断更，不累积） */
    for (let k = 1; k <= HABIT_GP_BREAK && k * n < gap; k++) {
      const m = addDaysStr(prev, k * n);
      if (m < cur && !skips[m] && !due[m]) miss[m] = true;
    }
  }
  /* 最后一次打卡之后的空档：今天还没过完，所以只标 < end 的日子 */
  const last = ds[ds.length - 1];
  if (last < end) {
    for (let k = 1; k <= HABIT_GP_BREAK; k++) {
      const m = addDaysStr(last, k * n);
      if (m < end && !skips[m] && !due[m]) miss[m] = true;
    }
  }
  return { due: due, miss: miss };
}
/* habitDueOn 的"循环内"版本：rr / created / skips 由调用方在循环外算好传进来。
 * 语义与 habitDueOn 完全一致，只省掉每天三次重复归一化（habitRepeatOf → normTodoRepeat）。
 * 只给 habitExpectedIn / habitCurrentStreak / habitBestStreak 用 ——
 * 那三处是「一天一天往前数」，一次统计能调上千次（实测 50 个习惯 47→83ms）。
 * 配额型不进这里：调用方已在外层按 habitIsQuota 分流掉了。 */
function _habitDueFast(s, rr, skips, created) {
  if (skips && skips[s]) return false;
  if (created && s < created) return false;
  if (!rr) return true;
  return todoRepeatMatchesNorm(rr, s);
}
/* 这一天是不是被用户「跳过」了（眼睛层逐条 + 长期跳过记录）。
 * 与规则无关：规则说不该做 = 压根不用看；跳过说今天不欠这一笔 = 藏起来但随时能放回。
 * 注意语义升级（2026-10-30）：以前只是一条"今天先不看"的 UI 开关，
 * 现在它同时是「这天不破链、不进分母」的凭据 —— 见 habitSkipSet。 */
function habitSkippedOn(h, ds, skipDates) {
  const s = String(ds == null ? '' : ds).slice(0, 10);
  if (!isDateStrOk(s)) return false;
  return !!habitSkipSet(h, skipDates)[s] || habitHiddenOn(h, s);
}
/* createdAt 归一化一次就够：合法才返回，否则空串。
 * 循环里（连续数每天一次、最多 700 次）不该反复跑正则 —— 这是渲染耗时的大头之一。 */
function _habitCreatedOf(h) {
  const c = h && h.createdAt ? String(h.createdAt).slice(0, 10) : '';
  return isDateStrOk(c) ? c : '';
}
/* 连续数的单位：规则型 = 「应做日做到了几次」；配额型 = 「连续达标几周」；每天 = 天 */function habitStreakUnit(h) {
  if (habitIsQuota(h)) return '周';
  return habitRepeatOf(h) ? '次' : '天';
}
/* 给人看的节奏文案（无规则且每天 = 每天；配额型 = 每周 N 次）
 * 这条文案和详情里的「目标频次」曾经同屏矛盾（一个说"每天"、一个说"每周 3 次"），
 * 根因是 freqPerWeek 只进了分母没进判定 —— 现在它进判定，文案也跟着认它。 */
function habitRepeatLabel(h) {
  const rr = habitRepeatOf(h);
  if (rr) return todoRepeatLabel(rr);
  if (habitIsQuota(h)) return '每周 ' + habitFreqPerWeek(h) + ' 次';
  return '每天';
}
/* 任意输入 → 合法周频次（1..7 取整）；认不出按每天 */
function habitFreqPerWeek(h) {
  const n = h && h.freqPerWeek;
  if (typeof n === 'number' && isFinite(n) && n >= 1 && n <= 7) return Math.round(n);
  return HABIT_FREQ_DEFAULT;
}
/* 最近 days 天的日期串（含 today，倒序：今天在最前） */
function recentDateStrs(today, days) {
  const out = [];
  for (let i = 0; i < days; i++) out.push(addDaysStr(today, -i));
  return out;
}
/* 窗口内"应打卡次数"：
 *   规则型习惯 = 窗口内命中日数（下界同时受 createdAt 约束）；
 *   配额/每天型 = 天数 × 周频次 / 7，四舍五入但至少 1（保持升级前公式，一行不改）。
 * createdAt 之后才开始计分（老习惯没 createdAt 则整窗都算）。
 * 跳过日从分母里扣掉：跳过 = 用户明确说过这天不算，不该在月末找他要这一笔。 */
function habitExpectedIn(h, today, days, skipDates, logDates) {
  const n = days || HABIT_WINDOW_DAYS;
  const created = _habitCreatedOf(h);
  const first = addDaysStr(today, -(n - 1));
  const skips = habitSkipSet(h, skipDates);
  const rr = habitRepeatOf(h);
  /* 间隔型：分母 = 窗口内的「该做点」（打卡日 + 漏点），见 habitIntervalPlan */
  if (rr && rr.mode === 'interval') {
    const plan = habitIntervalPlan(logDates, rr.interval, skips, today);
    const from = first > (created || first) ? first : (created || first);
    let due = 0;
    Object.keys(plan.due).forEach(function (d) { if (d >= from && d <= today) due++; });
    Object.keys(plan.miss).forEach(function (d) { if (d >= from && d <= today && !plan.due[d]) due++; });
    return due;
  }
  if (rr) {
    /* 规则型：逐日数命中。起点 = max(窗口首日, 创建日)；创建日缺失则整窗都数。 */
    let start = first;
    if (created) {
      if (created > today) return 0;
      if (created > first) start = created;
    }
    let due = 0;
    let cur = start;
    /* created 已在上面算进 start，这里传 '' 免得每天再比一次（口径不变） */
    for (let i = 0; i < n && cur && cur <= today; i++) {
      if (_habitDueFast(cur, rr, skips, '')) due++;
      cur = addDaysStr(cur, 1);
    }
    return due;
  }
  const fps = habitFreqPerWeek(h);
  let d = n;
  if (created) {
    if (created > today) d = 0;
    else if (created > first) d = daysBetweenStr(created, today) + 1;
  }
  if (d <= 0) return 0;
  /* 扣掉窗口内的跳过日（只在 createdAt 之后的才扣） */
  let sk = 0;
  recentDateStrs(today, n).forEach(function (x) {
    if (created && x < created) return;
    if (skips[x]) sk++;
  });
  d = Math.max(0, d - sk);
  if (d <= 0) return 0;
  if (fps >= 7) return d;
  return Math.max(1, Math.round((d * fps) / 7));
}
/* 配额型：连续达标的周数。本周还没打满时从上周往前数（本周还有机会，不算断） */
function habitQuotaWeekStreak(set, today, h) {
  const n = habitFreqPerWeek(h);
  const cntWeek = function (start) {
    let c = 0;
    for (let i = 0; i < 7; i++) if (set[addDaysStr(start, i)]) c++;
    return c;
  };
  let ws = weekStartStr(today);
  let weeks = cntWeek(ws) >= n ? 1 : 0;
  ws = addDaysStr(ws, -7);
  /* 上限 260 周（5 年）：纯函数不许空转 */
  for (let i = 0; i < 260; i++) {
    if (cntWeek(ws) < n) break;
    weeks++;
    ws = addDaysStr(ws, -7);
  }
  return weeks;
}
/* 连续打卡数（从今天/昨天往前数；今天还没打不算断链）：
 *   每天型   → 自然日连续，口径与升级前一致（跳过日跨过去，不破链）；
 *   规则型   → 只在命中日上数：不命中的日子跳过，命中却没打的那天（今天除外）才算断；
 *   配额型   → 数「连续达标的周数」，见 habitQuotaWeekStreak。 */
/* 间隔型的连续次数：从最后一次打卡往前数，相邻打卡间隔 ≤ N 天就连上。
 * 今天还没到「上次 + N」时不减连续（今天还有机会），与每天型的口径一致。 */
function _habitIntervalStreak(logDates, interval, today) {
  const n = Math.max(1, parseInt(interval, 10) || 1);
  const t = String(today == null ? '' : today).slice(0, 10);
  const ds = (logDates || [])
    .map(function (x) { return String(x == null ? '' : x).slice(0, 10); })
    .filter(function (x) { return isDateStrOk(x) && x <= t; })
    .sort();
  if (!ds.length) return 0;
  let cnt = 1;
  for (let i = ds.length - 1; i > 0; i--) {
    if (daysBetweenStr(ds[i - 1], ds[i]) > n) break;
    cnt++;
  }
  /* 最近一次已经超期到「再也补不回来」（> N*BREAK）→ 这段算断更 */
  if (daysBetweenStr(ds[ds.length - 1], t) > n * HABIT_GP_BREAK) return 0;
  return cnt;
}
function habitCurrentStreak(logDates, today, h, skipDates) {
  const set = {};
  (logDates || []).forEach(function (d) { set[String(d).slice(0, 10)] = true; });
  const skips = habitSkipSet(h, skipDates);
  if (habitIsQuota(h)) return habitQuotaWeekStreak(set, today, h);
  /* 间隔型：从最近一次打卡往前数，相邻间隔 ≤ N 就算连上（不是"每天都得有"） */
  const rrI = habitRepeatOf(h);
  if (rrI && rrI.mode === 'interval') return _habitIntervalStreak(logDates, rrI.interval, today);

  const created = _habitCreatedOf(h);
  const rr = habitRepeatOf(h);
  let cursor = today;
  let n = 0;
  /* 上限 3660 次（10 年）：纯函数不许空转，脏数据也不能把页面卡死 */
  for (let i = 0; i < 3660; i++) {
    if (!cursor) break;
    if (created && cursor < created) break;   /* 建之前没有欠账 */
    if (skips[cursor]) { cursor = addDaysStr(cursor, -1); continue; }  /* 跳过日：跨过去 */
    /* 规则不命中的日子不参与（每天型的 rr 为 null，_habitDueFast 恒 true） */
    if (!_habitDueFast(cursor, rr, skips, '')) { cursor = addDaysStr(cursor, -1); continue; }
    if (set[cursor]) { n++; cursor = addDaysStr(cursor, -1); continue; }
    if (cursor === today) {
      /* 今天还有机会（今天没打不算断 —— 这正是用户要的：
         「点一下眼睛就是今天先不看，第二天还没打勾才断连续天数」）。
         ★ 眼睛在这里**一个字都不许改**：藏卡和没打卡的统计口径必须完全一样，
           否则用户看到的是"点一下就归零"这种莫名其妙的惩罚。 */
      cursor = addDaysStr(cursor, -1);
      continue;
    }
    break;
  }
  return n;
}
/* 配额型：历史最长连续达标周数 */
function habitQuotaBestWeeks(set, arr, h) {
  const n = habitFreqPerWeek(h);
  if (!arr.length) return 0;
  let ws = weekStartStr(arr[0]);
  const lastWeek = weekStartStr(arr[arr.length - 1]);
  let best = 0, cur = 0;
  for (let i = 0; i < 600 && ws && ws <= lastWeek; i++) {
    let c = 0;
    for (let j = 0; j < 7; j++) if (set[addDaysStr(ws, j)]) c++;
    cur = c >= n ? cur + 1 : 0;
    if (cur > best) best = cur;
    ws = addDaysStr(ws, 7);
  }
  return best;
}
/* prev 与 d 之间是不是只隔着跳过日（是则两者仍算"连着"） */
function _habitOnlySkippedBetween(prev, d, skips) {
  let cur = addDaysStr(prev, 1);
  let guard = 0;
  while (cur && cur < d && guard < 4000) {
    if (!skips[cur]) return false;
    cur = addDaysStr(cur, 1);
    guard++;
  }
  return true;
}
/* 历史最长连续数（每天型 = 自然日；规则型 = 命中日；配额型 = 达标周）*/
function habitBestStreak(logDates, h, skipDates) {
  const arr = (logDates || []).map(function (d) { return String(d).slice(0, 10); })
    .filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); })
    .sort();
  const skips = habitSkipSet(h, skipDates);
  const set = {};
  arr.forEach(function (d) { set[d] = true; });
  if (habitIsQuota(h)) return habitQuotaBestWeeks(set, arr, h);
  const rr = habitRepeatOf(h);
  /* 间隔型：最长 = 相邻间隔都 ≤ N 的最长一段（与 habitCurrentStreak 同一口径） */
  if (rr && rr.mode === 'interval') {
    const n = Math.max(1, parseInt(rr.interval, 10) || 1);
    let best = arr.length ? 1 : 0, run = 1;
    for (let i = 1; i < arr.length; i++) {
      run = daysBetweenStr(arr[i - 1], arr[i]) <= n ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  }
  if (!rr) {
    /* 每天型：相邻两次打卡之间只隔跳过日 → 仍算连着 */
    let best = 0, cur = 0, prev = null;
    arr.forEach(function (d) {
      cur = (prev && _habitOnlySkippedBetween(prev, d, skips)) ? cur + 1 : 1;
      if (cur > best) best = cur;
      prev = d;
    });
    return best;
  }
  if (!arr.length) return 0;
  /* 从第一次打卡的命中日走到最后一次：命中日打了 +1，命中日没打归零，不命中/跳过的跨过去
     created 也传进去：历史最长本来就只在已有打卡的区间内走，这里保持一致 */
  const created = _habitCreatedOf(h);
  let best = 0, cur = 0;
  let cursor = arr[0];
  for (let i = 0; i < 3660 && cursor && cursor <= arr[arr.length - 1]; i++) {
    if (skips[cursor]) { cursor = addDaysStr(cursor, 1); continue; }
    if (_habitDueFast(cursor, rr, skips, created)) {
      if (set[cursor]) { cur++; if (cur > best) best = cur; } else cur = 0;
    }
    cursor = addDaysStr(cursor, 1);
  }
  return best;
}
/* 窗口统计：done 实打 / expected 应打 / rate 达标率 0..1 / cur·best 连续数
 * weekDone·weekTarget 只在配额型有意义（本周打了几个 / 目标几个）。
 * 规则型的 done 只数「应做日」的打卡；跳过日两边都不算。 */
function habitStats(h, logDates, today, days, skipDates) {
  const n = days || HABIT_WINDOW_DAYS;
  const win = recentDateStrs(today, n);
  const set = {};
  (logDates || []).forEach(function (d) { set[String(d).slice(0, 10)] = true; });
  const skips = habitSkipSet(h, skipDates);
  const rr = habitRepeatOf(h);
  const created = _habitCreatedOf(h);
  let done = 0;
  win.forEach(function (d) {
    if (!set[d]) return;
    /* 间隔型：每一次打卡都算数（本就没有固定该做日，见 habitIntervalPlan） */
    if (rr && rr.mode === 'interval') { if (!skips[d]) done++; return; }
    /* 规则型：非应做日的补卡不进分子（配额/每天型保持升级前的口径，只看跳过日） */
    if (rr) { if (!_habitDueFast(d, rr, skips, created)) return; }
    else if (skips[d]) return;
    done++;
  });
  const expected = habitExpectedIn(h, today, n, skipDates, logDates);
  const quota = habitIsQuota(h);
  let weekDone = 0;
  if (quota) {
    const ws = weekStartStr(today);
    for (let i = 0; i < 7; i++) {
      const x = addDaysStr(ws, i);
      if (x > today) break;
      if (set[x] && !skips[x]) weekDone++;
    }
  }
  return {
    done: done,
    expected: expected,
    rate: expected > 0 ? Math.min(1, done / expected) : 0,
    cur: habitCurrentStreak(logDates, today, h, skipDates),
    best: habitBestStreak(logDates, h, skipDates),
    quota: quota,
    weekDone: weekDone,
    weekTarget: quota ? habitFreqPerWeek(h) : 0
  };
}
/* ===== 习惯成长点（2026-11-08 重写：纯函数、按记录重算）=====
 * 老实现是 01d 的 degradeHabits()，两个问题让「间隔式」习惯的成长点恒为 0：
 *   ① 只按「最后一次打卡日 → 今天」的自然日间隔扣分，**完全不看 h.repeat**：
 *      每周一/三/五/日的习惯，周二、周四本来不该做，照样算欠账；
 *      每隔 N 天的习惯更惨，几乎天天都在"欠账"。
 *   ② 没有「今天已结算」的锚点 —— 每次打开 App 都把同一个缺口再扣一遍
 *      （树的退化有 lastActiveDate 做锚，习惯这边没有）。
 *      一次打卡 +1、打开一次扣 5 点，于是点数永远是 0。
 * 现在改成按打卡记录重算的纯函数：
 *   加分：每个打卡日 +1；该做日连续命中（中间"不该做"的日子不算断链）再 +1。
 *   扣分：只在「该做却没做」的过去日子上扣，每次固定 -1（原先递增 2/3/4…
 *         会把稀疏习惯永久压到 0 —— 打一次 +1、漏两次 -5，越坚持越像坏了）；
 *         跳过日、不该做的日子一律不扣；今天还没过完，不扣今天。
 *   起点：第一次打卡那天。建了习惯还没开始做的日子不算欠账。
 *   断更重置：连续漏做 HABIT_GP_BREAK（3）个「该做日」= 这段作废、从下一个该做日重新计分。
 *     不是永久背债 —— 用户实测「按节奏做了几个月还是 0」正是永久累计扣分造成的；
 *     断更重置之后，只有"最近这一段"决定分数，跟直觉一致。
 *   配额型（每周 N 次）：按整周结算 —— 过去的某一周没做满才扣，本周不扣。
 * 纯函数 = 幂等：打开几次都是同一个数，也能在 Node 里直接单测。
 * 参数：skipDates 就是存档里的跳过长表（调用方传 habitSkipsOf(h)）。 */
var HABIT_GP_BREAK = 3;   /* 连续漏做几个「该做日」= 断更（重新开始计分），不是永久背债 */
function habitGrowthPoints(h, logDates, today, skipDates) {
  const t = String(today == null ? '' : today).slice(0, 10);
  if (!isDateStrOk(t)) { return 0; }
  const set = {};
  const dates = [];
  (logDates || []).forEach(function (d) {
    const s = String(d == null ? '' : d).slice(0, 10);
    if (!isDateStrOk(s) || set[s]) return;
    set[s] = true;
    dates.push(s);
  });
  dates.sort();
  const firstLog = dates.length ? dates[0] : '';
  const created = _habitCreatedOf(h);
  /* 起点取「第一次打卡那天」：建了习惯还没开始的那些日子属于"还没开始"，不是欠账 */
  const start = firstLog;
  if (!start || start > t) { return 0; }
  const skips = habitSkipSet(h, skipDates);
  /* 一个「计分段」= 从重新开始那天到断更那天。断更就丢掉之前的账，从头算 ——
     否则一个坚持了一年的习惯会因为「三个月前断过两周」被永久压在 0 分上。 */
  function settle(gain, pen) { return Math.max(0, gain - pen); }

  if (habitIsQuota(h)) {
    /* 配额型（每周 N 次）：按整周结算。缺 1 次 -1、做满整周再 +1。 */
    const target = Math.max(1, habitFreqPerWeek(h));
    const tws = weekStartStr(t);
    let gain = 0, pen = 0, missWeeks = 0;
    dates.forEach(function (d) { if (d <= t) gain++; });
    let ws = weekStartStr(start);
    let guard = 0;
    while (ws < tws && guard < 600) {
      guard++;
      let done = 0;
      for (let i = 0; i < 7; i++) {
        const d = addDaysStr(ws, i);
        if (d < start || d > t) continue;
        if (skips[d]) continue;
        if (set[d]) done++;
      }
      const missing = target - done;
      if (missing > 0) {
        pen += missing;
        missWeeks++;
        /* 空着好几周 = 断更，重新开始（含本批打卡收益一起重来，避免"断更前的加练"抬着分） */
        if (missWeeks >= HABIT_GP_BREAK) { gain = 0; pen = 0; }
      } else {
        missWeeks = 0;
        gain += 1;
      }
      ws = addDaysStr(ws, 7);
    }
    return settle(gain, pen);
  }

  const rr = habitRepeatOf(h);
  /* 间隔型（每隔 N 天）单独一档：它没有"固定该做日"，
     用锚点网格判定的话，用户哪天差一天打卡就整批被判成漏做（实测：规律打 23 次只得 1 分）。
     改成按**相邻两次打卡的间隔**结算，这才是"间隔式"的本义。 */
  if (rr && rr.mode === 'interval') {
    const n = Math.max(1, parseInt(rr.interval, 10) || 1);
    let gain = 0;
    let prev = '';
    dates.forEach(function (d) {
      if (d > t) return;
      if (!prev) { prev = d; gain = 1; return; }
      const gap = daysBetweenStr(prev, d);
      /* 断更太久：这段作废，从这次重新算（只有这一次 +1） */
      if (gap > n * HABIT_GP_BREAK) { gain = 1; }
      /* 没在该做的日子做 = 欠一次（−1），这次补上算打了一次卡（+1），且不给连击 → 净 0。
         ★ 不给「迟到分」：用户的原话「我迟到了，我就是没做」—— 迟到不是成绩，只是把账补平。 */
      else if (gap > n) { /* 净 0，连击断掉 */ }
      else { gain += 2; }                                  /* 做到 +1，连着上一次做到再 +1 */
      prev = d;
    });
    return gain;
  }

  let gain = 0, pen = 0, missRun = 0, chain = false;
  /* active=false = 还没「重新开始」：断更之后的空白日子不扣分，等到下一次打卡才重新计分。
     否则断更后继续空着的每一天都在加重欠账，人一回来看见的还是 0 —— 就是这次要修的病。 */
  let active = false;
  let cur = start;
  let guard = 0;
  /* 上限 3660 天（10 年）：纯函数不许空转，脏数据也不能把页面卡死 */
  while (cur && cur <= t && guard < 3660) {
    guard++;
    const done = !!set[cur];
    const skipped = !!skips[cur];
    const due = !skipped && _habitDueFast(cur, rr, skips, created || '');
    /* 不该做的日子也打了卡：额外做的，+1（不加连击，也不改漏做计数） */
    if (!due && done) gain += 1;
    /* 请假（跳过）= 不欠账也不破链：连击位与漏做计数都不动 */
    if (due) {
      if (!active) {
        /* 断更后的空白：不欠账，等下一次打卡重新开始 */
        /* 重新开始：这一天算「做了一次」，所以连击位直接点亮，下一个该做日就能吃连击 */
        if (done) { active = true; gain = 0; pen = 0; gain += 1; chain = true; missRun = 0; }
      } else if (done) {
        /* 打一次 +1；紧接着上一个该做日也做到，再 +1 */
        gain += 1;
        if (chain) gain += 1;
        chain = true;
        missRun = 0;
      } else if (cur === t) { /* 今天还没过完：不扣、也不算漏 */ }
      else {
        pen += 1;
        missRun++;
        chain = false;
        /* 连漏 3 个该做日 = 断更：这一段作废，从下一次打卡重新开始 */
        if (missRun >= HABIT_GP_BREAK) { gain = 0; pen = 0; active = false; }
      }
    }
    cur = addDaysStr(cur, 1);
  }
  return settle(gain, pen);
}

/* ===== 习惯分类（展开的文件夹）=====
 * 分类只是一层「标签」：习惯本身仍是一条，分类表独立存放。
 * 删除分类**不删习惯**，只把成员退回「未分类」—— 避免"删个文件夹连习惯一起没了"。
 * 未分类用空串作哨兵：和"没设分类"同义，不必再造一个 'none' 常量。 */
const HABIT_CAT_UNGROUPED = '';
const HABIT_CAT_NAME_MAX = 12;
function habitCatOf(h) {
  return h && h.catId ? String(h.catId) : HABIT_CAT_UNGROUPED;
}
function normHabitCatName(s) {
  return String(s == null ? '' : s).trim().slice(0, HABIT_CAT_NAME_MAX);
}
/* 去空名 / 去重名 / 裁剪长度；id 缺失的丢弃（分类必须有 id 才能挂成员） */
function normHabitCats(list) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach(function (c) {
    if (!c || c.id === undefined || c.id === null) return;
    const id = String(c.id);
    const name = normHabitCatName(c.name);
    if (!id || !name || seen[id]) return;
    seen[id] = 1;
    out.push({ id: c.id, name: name });
  });
  return out;
}
/* habits → 文件夹分组。顺序 = cats 声明顺序，未分类永远殿后（它是兜底，不该插中间）。
 * 不丢习惯：挂到已不存在的 catId 上时自动归入未分类。 */
function habitCatGroups(habits, cats) {
  const cs = normHabitCats(cats);
  const byId = {};
  const groups = cs.map(function (c) {
    const g = { id: String(c.id), name: c.name, items: [] };
    byId[g.id] = g;
    return g;
  });
  const rest = { id: HABIT_CAT_UNGROUPED, name: '未分类', items: [] };
  (Array.isArray(habits) ? habits : []).forEach(function (h) {
    if (!h) return;
    const cid = habitCatOf(h);
    if (cid && byId[cid]) byId[cid].items.push(h);
    else rest.items.push(h);
  });
  if (rest.items.length) groups.push(rest);
  return groups;
}
/* ===== 习惯的「子计划」（2026-11-04）=====
 * 一个习惯可以拆成几步（例：跑步 = 热身 / 5 公里 / 拉伸），每步可以**排期**：
 *   date 为空 → 跟随习惯，习惯哪天该做，这天它就在（「每次都要做的一步」）
 *   date 有值 → 只在那个日期出现（「这周五的这一步」）
 * ★ 子计划只是清单，**不改习惯的打卡口径**：习惯那天算不算完成，仍只看 habitLogs。
 *   否则「3 个子计划勾了 2 个」会让连续天数开始抖，用户读不懂。
 * doneOn 存日期而不是 bool：勾掉是"哪天的这一下"，跨天后未排期步骤自动回未完成，
 * 排期过的步骤保留它那天的完成状态（它是那一天的账）。 */
const HABIT_SUB_TEXT_MAX = 24;
function habitSubsOf(h) {
  if (!h || !Array.isArray(h.subs)) return [];
  return h.subs.filter(function (s) {
    return s && typeof s === 'object' && String(s.text == null ? '' : s.text).trim();
  });
}
function normHabitSubText(s) {
  return String(s == null ? '' : s).trim().slice(0, HABIT_SUB_TEXT_MAX);
}
/* 'YYYY-MM-DD' 才认；其它一律当"没排期"，别把脏字符串带进判定 */
function normHabitSubDate(d) {
  const s = String(d == null ? '' : d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function normHabitSubTime(t) {
  const s = String(t == null ? '' : t).slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}
/* ---------- 习惯自己的时段（2026-11-04）----------
 * 用户原话：「为什么这个排期不能在表格上选，而且只有子计划才能排期」。
 * 原来只有子计划能挂日期，习惯本身只有「哪天做」（repeat），没有「几点做」，
 * 日程表上也就画不出它的位置。现在习惯多一个 timeBlocks：
 *   [{ start:'07:30', end:'08:00' }]  —— 命中的日子（habitDueOn 为真）每天重复。
 * 不跟 todo 的 blocks 混用：那是按日期展开的实例，习惯这条是"规则时段"。 */
const HABIT_BLOCK_MAX = 4;
function normHabitHM(v) {
  const s = String(v == null ? '' : v).slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}
function hmToMin(v) {
  const s = normHabitHM(v);
  if (!s) return null;
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}
function minToHM(m) {
  const n = Math.round(Number(m));
  if (!isFinite(n) || n < 0) return '';
  const mm = Math.min(n, 23 * 60 + 59);
  return String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
}
function normHabitBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const a = hmToMin(b.start), z = hmToMin(b.end);
  if (a == null || z == null || z <= a) return null;
  return { start: normHabitHM(b.start), end: normHabitHM(b.end) };
}
/* 归一 + 去重 + 按开始时间排。空/非法项直接丢，不报错（存档里可能有半截数据）。 */
function normHabitBlocks(list) {
  const out = [], seen = {};
  (Array.isArray(list) ? list : []).forEach(function (b) {
    const n = normHabitBlock(b);
    if (!n) return;
    const k = n.start + '-' + n.end;
    if (seen[k]) return;
    seen[k] = 1;
    out.push(n);
  });
  out.sort(function (a, b) { return hmToMin(a.start) - hmToMin(b.start); });
  return out.slice(0, HABIT_BLOCK_MAX);
}
function habitBlocksOf(h) {
  return h ? normHabitBlocks(h.timeBlocks) : [];
}
/* ---------- 习惯的「单独某天」（2026-11-09）----------
 * 计划有 t.dayPlan（某天单独一套），习惯之前只有「每天重复的时段」，
 * 想改一天的作息没处说 —— 用户原话：「计划不是可以支持给单独哪天排期吗？习惯不支持，复用一下」。
 * 所以照抄同一形状：h.dayPlan = { 'YYYY-MM-DD': [{ start:'YYYY-MM-DD HH:MM', end:'…' }] }。
 * 语义也照抄，只有一条：**这天有覆盖 → 整组替换规则时段；删掉那天 → 回到规则时段**。
 * 段存完整 datetime（与 t.dayPlan 一致）→ 直接复用 normExtraBlocks 的校验，不另立格式。 */
const HABIT_DAYPLAN_MAX_DAYS = 60;
function habitDayPlanNormAll(h) {
  if (!h || typeof h !== 'object' || !h.dayPlan || typeof h.dayPlan !== 'object') return {};
  return dayPlanNormAll(h.dayPlan, HABIT_DAYPLAN_MAX_DAYS);
}
/* 这一天单独排了几段（已清洗升序）；没排过就空数组 */
function habitDayPlanOn(h, ds) {
  const d = String(ds == null ? '' : ds).slice(0, 10);
  if (!d) return [];
  return habitDayPlanNormAll(h)[d] || [];
}
/* 这天要画哪几段：
   ① 那天单独排过 → 就按那天的（覆盖规则时段，也不问「今天该不该做」—— 用户手排的那天就是这天要做）
   ② 没单独排 → 规则时段，且只在命中日画
   返回的仍是 { start:'HH:MM', end:'HH:MM' }，调用方（网格）不用区分来源。 */
function habitBlocksOn(h, ds, skips, logDates) {
  if (!h) return [];
  const ov = habitDayPlanOn(h, ds);
  if (ov.length) {
    return ov.map(function (b) {
      return { start: String(b.start).slice(11, 16), end: String(b.end).slice(11, 16) };
    });
  }
  if (!habitDueOn(h, ds, skips, logDates)) return [];
  return habitBlocksOf(h);
}
function normHabitSubs(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (s) {
    if (!s || typeof s !== 'object') return;
    const text = normHabitSubText(s.text);
    if (!text) return;
    out.push({
      id: s.id == null ? 'hs' + out.length : s.id,
      text: text,
      date: normHabitSubDate(s.date),
      time: normHabitSubTime(s.time),
      doneOn: normHabitSubDate(s.doneOn)
    });
  });
  return out;
}
/* 某一天该出现的子计划 = 全部子计划（2026-11-06）。
   ★ 原来带排期的只在那一天出现，第二天没做完就整个消失 —— 用户的理解是
     「子计划就是一张清单，没勾就一直在这儿」，和计划卡的子任务完全一致。
     那个日期字段被当成了期限，实际上没有任何意义（他也没在用它做「只在那天做」）。
     现在一律不看 date：没勾的就显示，勾了当天算完成，次日自动回到未完成。
     存档里的 s.date 保留不动，只是不再参与任何判定。 */
function habitSubsOn(h, ds) {
  return habitSubsSort(habitSubsOf(h));
}
/* 子计划的展示顺序：有时间的按时间排前面，没时间的排后面（"定时的事先做"）。
 * 抽成公共函数是因为卡片和详情要用**同一个顺序** —— 两边差别只在"取哪些"
 * （卡片只取今天有份的、详情取全部），顺序本身不该有两份实现。
 * 之前详情直接用 habitSubsOf 的原序，于是同一批步骤在卡片上按 7:10 / 22:40 排、
 * 点进详情变成 22:40 / 洗漱 / 7:10，用户会以为详情里的排序坏了。 */
function habitSubsSort(list) {
  return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
    const ta = normHabitSubTime(a.time), tb = normHabitSubTime(b.time);
    if (ta && tb) return ta < tb ? -1 : ta > tb ? 1 : 0;
    if (ta) return -1;
    if (tb) return 1;
    return 0;
  });
}
function habitSubsDoneOn(h, ds, list) {
  const d = normHabitSubDate(ds);
  return (list || habitSubsOn(h, ds)).filter(function (s) {
    return normHabitSubDate(s.doneOn) === d;
  }).length;
}
/* 记录里的「计划子任务快照」上限：日志卡只画前几步，多了折成「等 N 步」 */
const PLAN_SUB_SNAPSHOT_MAX = 12;
const LOG_PLAN_SUB_SHOW_MAX = 6;
/* 专注记录 / 完成流水都存**快照**而非引用：计划日后改了子任务，历史日志不该被改写。
   ★ （快照口径：记录应该是快照，"今天下午几点几点只显示我那时完成了多少"）：
   cutoffMs 给定时按**子任务自己的完成时刻**过滤 —— 这一条记录只认「这条记录结束前
   已经勾掉的步骤」，之后才勾的在后面的记录里体现，绝不倒灌回前面那条。
   老数据没有 doneAt（10-18 之前勾的没法追溯），此时退回 !!done，不做假判断。 */
function snapshotPlanSubs(todo, cutoffMs) {
  if (!todo || !Array.isArray(todo.subs) || !todo.subs.length) return null;
  const hasCut = typeof cutoffMs === 'number' && isFinite(cutoffMs) && cutoffMs > 0;
  return todo.subs.slice(0, PLAN_SUB_SNAPSHOT_MAX).map(function (s) {
    let d = !!(s && s.done);
    if (hasCut && d) {
      const at = s && Number(s.doneAt);
      if (at > 0 && at > cutoffMs) d = false;
    }
    return { t: String((s && s.title) || ''), d: d };
  });
}
/* 快照 → 一行紧凑文本，如「3/5 步 · 背单词 · 写卷子 …」；无快照返回 '' */
function planSubsSummaryText(subs, max) {
  if (!Array.isArray(subs) || !subs.length) return '';
  const cap = max || LOG_PLAN_SUB_SHOW_MAX;
  let done = 0;
  subs.forEach(function (s) { if (s && s.d) done++; });
  const titles = subs.slice(0, cap).map(function (s) {
    return (s && s.t ? s.t : '未命名');
  });
  let txt = done + '/' + subs.length + ' 步 · ' + titles.join(' · ');
  if (subs.length > cap) txt += ' 等 ' + subs.length + ' 步';
  return txt;
}

/* ===== 艾宾浩斯遗忘曲线复习（间隔分级参考 Anki/SM-2 的成熟度阶梯）=====
 * 复习对象是「一天」：以日期为一张记忆卡，记录掌握级别 → 决定下次复习日。
 * 级别 0..EBBINGHAUS_INTERVALS.length（等于长度 = 已记牢毕业，不再排期）。
 * 只做纯运算，读写的 appData 字段由数据层负责。 */
const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30, 60];
const EBBINGHAUS_GRADUATED = EBBINGHAUS_INTERVALS.length;
/* 三档自评：遗忘（回炉）/ 熟练（进一级）/ 记牢（跳一级）。
   icon 只是这三个键的固定字形，和 label 一样属于**元信息** —— 放在这里，
   视图层就不必再维护一份 key→图标 的映射（两份映射迟早会对不上）。 */
const REVIEW_GRADES = [
  /* 「斩掉」= 百词斩那种一票毕业：直接顶到毕业级，next 落 null，以后不再排期。
     它不是"记得更牢"，是"这条别再出来了"，所以 delta 用比剩余级差更大的值，
     由 ebReview 夹到毕业级；视图层据此给一条独立文案（见 gradeReview）。
     排在首位：自评按钮按本数组顺序渲染，用户「斩」落在最左。 */
  { key: 'mastered', label: '斩掉', icon: '✂️', delta: 99, hint: '不再复习，直接毕业' },
  { key: 'forget', label: '遗忘', icon: '↻', delta: 0, hint: '重新从明天算起' },
  { key: 'ok', label: '熟练', icon: '→', delta: 1, hint: '进入下一级间隔' },
  { key: 'solid', label: '记牢', icon: '✓', delta: 2, hint: '跳一级，更快拉长间隔' }
];
const REVIEW_GRADE_MASTERED = 'mastered';
function reviewGradeMeta(k) {
  for (let i = 0; i < REVIEW_GRADES.length; i++) if (REVIEW_GRADES[i].key === k) return REVIEW_GRADES[i];
  return null;
}

/* ===== 全站字号缩放（设置页「字号大小」）=====
 * 参照 iOS「文字大小」/ 微信「字体大小」的档位思路：给用户 4 个够用的档，
 * 而不是一根 0.5~3.0 的滑杆（档少反而好选，也不会把布局撑坏）。
 * 单一事实源放在这里：CSS 侧读 --fs-scale，JS 侧读本表，两边不会各写一套数字。 */
const FONT_SCALE_STEPS = [
  { key: 'std', label: '标准', factor: 1, note: '默认' },
  { key: 'large', label: '大字', factor: 1.15, note: '比默认大 15%' },
  { key: 'xlarge', label: '特大', factor: 1.3, note: '比默认大 30%' },
  { key: 'elder', label: '老年', factor: 1.5, note: '最大档，适合视力不佳' }
];
const FONT_SCALE_MIN = 0.85;
const FONT_SCALE_MAX = 1.6;
function fontScaleMeta(key) {
  for (let i = 0; i < FONT_SCALE_STEPS.length; i++) if (FONT_SCALE_STEPS[i].key === key) return FONT_SCALE_STEPS[i];
  return FONT_SCALE_STEPS[0];
}
/* 容错：老数据 / 手改过的值经这里归一，永远落在 [MIN, MAX] 且有限。 */
function normFontScale(v) {
  const n = Number(v);
  if (!isFinite(n)) return 1;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, n));
}
/* 级别 → 间隔天数；已毕业返回 0 */
function ebIntervalDays(level) {
  const lv = Math.max(0, Math.min(EBBINGHAUS_GRADUATED, Math.round(level || 0)));
  return lv >= EBBINGHAUS_GRADUATED ? 0 : EBBINGHAUS_INTERVALS[lv];
}
/* 级别 → 中文阶段名 */
function ebStageName(level) {
  const lv = Math.max(0, Math.min(EBBINGHAUS_GRADUATED, Math.round(level || 0)));
  if (lv <= 0) return '初学';
  if (lv >= EBBINGHAUS_GRADUATED) return '记牢';
  return '第' + lv + '级';
}
/* 自评 → 新状态。遗忘回 0 级；熟练 +1；记牢 +2；不超过毕业级别。
 * 返回 { level, last, next }（next 为 'YYYY-MM-DD'；毕业则 next = null）。 */
function ebReview(state, gradeKey, today) {
  const st = state && typeof state === 'object' ? state : {};
  const cur = Math.max(0, Math.min(EBBINGHAUS_GRADUATED, Math.round(st.level || 0)));
  const g = reviewGradeMeta(gradeKey);
  let lv;
  if (!g || g.key === 'forget') lv = 0;
  else lv = Math.min(EBBINGHAUS_GRADUATED, cur + g.delta);
  const interval = ebIntervalDays(lv);
  return {
    level: lv,
    last: today,
    next: interval > 0 ? addDaysStr(today, interval) : null
  };
}
/* 该日期今天是否需要复习：没排期过（新卡）= 该复习；next 为空（已毕业）= 不复习 */
function ebIsDue(state, today) {
  if (!state || typeof state !== 'object') return true;
  if (!state.next) return false;
  return String(state.next) <= today;
}
/* 「已毕业 / 已斩掉」= next 为空（不再排期）。
   两种毕业（自评「记牢」到顶、或直接「斩掉」）在数据上是同一个状态，
   视图层也只需要「它还会不会再出现」这一个事实，所以不再多存一个来源字段。 */
function ebIsGraduated(state) {
  return !!state && typeof state === 'object' && !state.next;
}
/* 毕业原因：'mastered' = 主动「斩掉」；'solid-top' = 自评「记牢」累计到顶。
   为什么要分开：这两种毕业在玩法上一个"我不再需要它"、一个"我完全掌握了"，
   设置页混在一起列会让人分不清自己斩过哪些。
   老数据没有 reason 字段 —— 一律按 solid-top 兜底（斩掉是后加的强语义动作），
   免得把当年练到顶的日子误报成"我亲手斩掉的"。 */
function ebGraduateReason(state) {
  if (!ebIsGraduated(state)) return null;
  return state.reason === 'mastered' ? 'mastered' : 'solid-top';
}
/* 恢复被斩掉的一天：放回「今天就该复习」的队列，级别退回初学。
   参数是当天日期串（而不是内部读时钟），保持本层可测、无副作用。 */
function ebRestoreState(today) {
  return { level: 0, last: null, next: today };
}
/* ===== 计划「重复周期」（重复任务）=====
 * 一条任务挂一条「重复规则」，每到规则命中的日子就自动回到「未完成」，
 * 而不是每天手删再加一遍。这里只放**纯规则运算**，不碰 appData / DOM。
 *
 * 规则字段（落盘，normalize 后会丢掉多余字段）：
 *   mode      'daily' | 'weekdays' | 'weekly' | 'monthly' | 'interval'
 *   weekdays  [1..7]（周一=1 … 周日=7；weekly 用）
 *   dom       0..31（每月几号；0 = 每月最后一天，遇短月取当月最后一天，如 31 → 2 月取 28/29）
 *   interval  N（每隔 N 天；interval 用）
 *   anchor    'YYYY-MM-DD'（interval 的起算锚点，不设则按首次创建日）
 *   until     'YYYY-MM-DD'（重复到哪天为止；null = 一直重复。过期的规则自动降级为一次性）
 *   subsMode  'reset' | 'clear'（第二天子任务：重置为未完成 / 直接清空）
 *   last      'YYYY-MM-DD'（最近一次已生成的日期，幂等闸门）
 *   next      'YYYY-MM-DD'（下一次重置日；缓存，永远可由规则+last 重算）
 * 「next 未到就什么都不做」= 同一天把 checkNewDay 跑一百遍也只重置一次。 */
const REPEAT_WEEK_CN = ['一', '二', '三', '四', '五', '六', '日'];
const REPEAT_MODES = ['daily', 'weekdays', 'weekly', 'monthly', 'interval'];
/* 'YYYY-MM-DD' → 本地 Date（当天 00:00）；非法返回 null（不抛） */
function dateStrToDate(ds) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ds || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}
/* 'YYYY-MM-DD' 加减天数；非法输入返回 '' */
function addDaysStr(ds, n) {
  const d = dateStrToDate(ds);
  if (!d) return '';
  d.setDate(d.getDate() + (parseInt(n, 10) || 0));
  return getDateStr(d);
}
/* b - a（天）；任一非法返回 0 */
function daysBetweenStr(a, b) {
  const da = dateStrToDate(a),
    db = dateStrToDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / DAY_MS);
}
/* 某年某月（m: 1-12）的天数 */
function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}
/* ISO 星期：周一=1 … 周日=7（JS 的 getDay() 周日=0，最容易在周计划上差一天） */
function isoWeekday(ds) {
  const d = dateStrToDate(ds);
  if (!d) return 0;
  const w = d.getDay();
  return w === 0 ? 7 : w;
}
/* 严格的日期串校验：光「Date 造得出对象」不够 —— new Date(2026, 12, 99) 会悄悄滚成 2029 年，
   脏数据必须当场判死，不能让它变成一条永远命中的重复规则 */
function isDateStrOk(ds) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ds == null ? '' : ds));
  if (!m) return false;
  const y = +m[1],
    mo = +m[2],
    d = +m[3];
  if (mo < 1 || mo > 12) return false;
  return d >= 1 && d <= daysInMonth(y, mo);
}
/* 规则规范化：不合法一律返回 null（调用方据此当作「不重复」） */
function normTodoRepeat(r) {
  if (!r || typeof r !== 'object') return null;
  const mode = String(r.mode || '');
  if (REPEAT_MODES.indexOf(mode) < 0) return null;
  const out = { mode: mode, last: r.last || null, next: r.next || null };
  /* 重复到哪天为止：只认合法日期串，否则当没设 */
  const until = isDateStrOk(r.until) ? String(r.until) : null;
  if (until) out.until = until;
  /* 第二天子任务怎么办（三档）：
     reset = 全部回到未完成（清单不动，勾选清零，默认）；
     clearDone = 只删已完成的，未完成的留着（进度继承）；
     clear = 子任务整条清掉，第二天从空清单重新列。 */
  out.subsMode = (r.subsMode === 'clear' || r.subsMode === 'clearDone') ? r.subsMode : 'reset';
  if (mode === 'weekly') {
    const wd = [];
    (Array.isArray(r.weekdays) ? r.weekdays : []).forEach(function (v) {
      const n = parseInt(v, 10);
      if (n >= 1 && n <= 7 && wd.indexOf(n) < 0) wd.push(n);
    });
    if (!wd.length) return null; /* 「每周」但一天都没选 = 没有意义，当不重复 */
    out.weekdays = wd.sort(function (a, b) { return a - b; });
  } else if (mode === 'monthly') {
    /* 0 = 每月最后一天，1..31 = 指定日 */
    const dom = parseInt(r.dom, 10);
    if (!(dom >= 0 && dom <= 31)) return null;
    out.dom = dom;
  } else if (mode === 'interval') {
    const iv = parseInt(r.interval, 10);
    if (!(iv >= 1 && iv <= 365)) return null;
    out.interval = iv;
    out.anchor = r.anchor || null;
  }
  return out;
}
/* 这条规则今天命中吗 */
function todoRepeatMatches(r, ds) {
  const rr = normTodoRepeat(r);
  if (!rr) return false;
  return todoRepeatMatchesNorm(rr, ds);
}
/* 与 todoRepeatMatches 同义，但要求调用方已经归一化好规则 ——
   供"一天一天往前数"的循环用（习惯的连续数 / 应做日统计）。那里每次
   重新 normTodoRepeat 一个对象是纯浪费：50 个习惯渲染一次要多花一倍时间（实测）。 */
function todoRepeatMatchesNorm(rr, ds) {
  if (!rr) return false;
  /* 有截止日：过了就不再命中（重复到某天为止） */
  if (rr.until && daysBetweenStr(rr.until, ds) > 0) return false;
  if (rr.mode === 'daily') return true;
  if (rr.mode === 'weekdays') {
    const w = isoWeekday(ds);
    return w >= 1 && w <= 5;
  }
  if (rr.mode === 'weekly') return rr.weekdays.indexOf(isoWeekday(ds)) >= 0;
  if (rr.mode === 'monthly') {
    const d = dateStrToDate(ds);
    if (!d) return false;
    const last = daysInMonth(d.getFullYear(), d.getMonth() + 1);
    /* dom=0 = 每月最后一天；短月收口：选了 31 号，2 月就落在当月最后一天，而不是整月跳过 */
    return d.getDate() === (rr.dom === 0 ? last : Math.min(rr.dom, last));
  }
  if (rr.mode === 'interval') {
    const a = rr.anchor || ds;
    const diff = daysBetweenStr(a, ds);
    return diff >= 0 && diff % rr.interval === 0;
  }
  return false;
}
/* 这条计划在 ds 这一天「生效」吗 —— 也就是「该不该在这一天的日程网格上占一个预计块」。
   两个来源合并，缺一个就会出现「今天有块、明天以后就没了」：
     ① 排期日就是这一天：一次性计划，也是重复计划的首日（排期日 = 提醒/开始时间的日期部分）；
     ② 重复规则命中这一天：每天 / 工作日 / 每周…（规则运算只有 todoRepeatMatches 一份，这里不另写一套）。
   另外补一条下界：**早于排期日的日子一律不算**。
     因为 daily 之类的规则本身不看起始日 —— 少了这条，「下周一才开始、每天重复」的计划
     会在今天以前的日子也画出块来。
   ⚠️ 只做判定，**绝不改数据**：日程网格是渲染层，某一天的块由规则**算出**；
     不往存档的计划数组里塞「未来那几天」的副本（那会污染存档、导出的数据也会凭空变多）。
   参数：startDs 由调用方给（它本来就要用 tbStartDateOf 算），避免这里反向依赖设置层。 */
function todoOccursOn(t, ds, startDs) {
  if (!t || !ds) return false;
  const s = String(ds).slice(0, 10);
  const sd = startDs == null ? '' : String(startDs).slice(0, 10);
  const isRep = !!normTodoRepeat(t.repeat);
  /* 不重复：只在排期日当天生效 */
  if (!isRep) return !!sd && sd === s;
  /* 重复计划：**任何一天都要过规则这一关，包括排期首日**。
     旧的「首日恒生效」让一段挂在周三、规则是「每周日」的计划在周三画出块 ——
     用户看到的正是「我排的是每周日，它却出现在不是周日的日程表上」。
     首日对重复计划只是**模板的锚点**（钟点从这儿读），不是一次真实的发生。 */
  if (sd && s < sd) return false;              /* 规则还没开始的日子不画 */
  return todoRepeatMatches(t.repeat, s);
}
/* 下一个命中日：includeSelf=true 含 fromDs 当天，否则从次日算起。
   找不到（参数非法）返回 null；循环上限 3660 天 = 10 年，绝不空转到卡页面。 */
function nextTodoRepeatDate(r, fromDs, includeSelf) {
  let rr = normTodoRepeat(r);
  if (!rr) return null;
  if (rr.mode === 'interval' && !rr.anchor) rr = Object.assign({}, rr, { anchor: fromDs });
  const start = includeSelf ? fromDs : addDaysStr(fromDs, 1);
  if (!start) return null;
  let cur = start;
  for (let i = 0; i < 3660; i++) {
    if (todoRepeatMatches(rr, cur)) return cur;
    cur = addDaysStr(cur, 1);
    if (!cur) return null;
  }
  return null;
}
/* 规则是不是已经走到头了（设了截止日且今天已经在截止日之后）——
   调用方据此把「重复计划」降级成普通一次性计划，绝不留一条永远不触发的空转规则。 */
function todoRepeatExpired(r, ds) {
  const rr = normTodoRepeat(r);
  if (!rr || !rr.until) return false;
  return daysBetweenStr(rr.until, ds) > 0;
}
/* 给人看的规则文案（列表徽标 / 编辑面板同一句） */
function todoRepeatLabel(r) {
  const rr = normTodoRepeat(r);
  if (!rr) return '';
  let s = '';
  if (rr.mode === 'daily') s = '每天';
  else if (rr.mode === 'weekdays') s = '工作日';
  else if (rr.mode === 'weekly') s = '每周' + rr.weekdays.map(function (n) { return REPEAT_WEEK_CN[n - 1]; }).join('、');
  else if (rr.mode === 'monthly') s = rr.dom === 0 ? '每月末' : '每月' + rr.dom + '日';
  else s = '每' + rr.interval + '天';
  if (rr.until) s += ' 至 ' + rr.until;
  return s;
}
/* ===== 预计番茄口径（唯一真相：只看任务本身）=====
 * `todoSubPomos` 已删（10-17）：子任务不参与预计 —— 子任务只是拆解用的展示清单，
 * 填的番茄数既不显示、也不计入总数。删掉它是为了**让口径没有第二条路**：
 * 只要那个函数还在，就总有人能顺手把子任务重新加回预计里。
 * 数据字段 subs[].pomodoros 保留不删（老存档可能还有值），只是不再被任何地方读取。 */
function todoEstPomos(t) {
  if (!t) return 0;
  const own = Number(t.pomodoros);
  return isFinite(own) && own > 0 ? Math.round(own * 2) / 2 : 0;
}
/* ===== 子任务进度（纯函数）=====
 * 只读 subs，不碰 DOM。**先过滤脏项再计数**：老存档里可能混入 null / 字符串
 * （splice 出错、手改存档都会留下），把它们算进 total 就会出现
 * 「界面上只有 1 行、进度却写 1/2」这种对不上的数字。
 * done 认严格真值；没有有效子任务时 total=0、pct=0（调用方据此不渲染进度条）。 */
function todoValidSubs(t) {
  const subs = t && Array.isArray(t.subs) ? t.subs : [];
  const out = [];
  for (let i = 0; i < subs.length; i++) {
    const x = subs[i];
    if (x && typeof x === 'object') out.push(x);
  }
  return out;
}
function todoSubProgress(t) {
  const subs = todoValidSubs(t);
  let done = 0;
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].done) done++;
  }
  const total = subs.length;
  return { done: done, total: total, pct: total ? Math.round((done * 100) / total) : 0 };
}
/* ===== 排期快照读取（纯函数）=====
 * 写入器是 todoSchedSnapshotOf（从活对象生成快照），这里是**读取器**：
 * 给「某一天的快照数组」和 id，取回那一条。数组结构属于 01b 的存储层，
 * UI 不该自己手写 todoSchedLog[date] 的遍历。 */
function todoSchedSnapshotOn(dayScheds, id) {
  if (!Array.isArray(dayScheds) || id == null) return null;
  const key = String(id);
  for (let i = 0; i < dayScheds.length; i++) {
    const x = dayScheds[i];
    if (x && String(x.id) === key) return x;
  }
  return null;
}
/* ===== 排期清单（纯函数）=====
 * 把「主段 + 另排段」摊成一张按时间排序的表，供展开态渲染与「复制排期」共用。
 * ★ 口径必须与日程表一致：主段只认 remindAt 起点（只有 estEnd 的脏数据画不出块），
 *   另排段走 normExtraBlocks（同日、≥10 分钟、去重）。这样截图上写的时间，
 *   和网格里看到的块是同一份事实，不会出现"图上有一块、文字里没有"。
 *
 * 参数（v1.2 加）：
 *   viewDate  — 正在看哪一天（计划页日期条的锚定日）；缺省取 today。
 *   dayScheds — 那一天的快照数组（由调用方从存档里取出），历史日优先读它。
 *   today     — 由调用方传入，纯函数不自己读系统日期，单测才能固定。
 *
 * 返回 [{ date, start, end, endDate, nextDay, main, snap }]
 *   date/endDate 是 YYYY-MM-DD，start/end 是**分钟数**（排序与格式化解耦）。
 */
function todoScheduleLines(t, viewDate, settings, dayScheds, today) {
  if (!t || typeof t !== 'object') return [];
  const d10 = function (x) {
    const v = String(x == null ? '' : x).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  };
  const vd = d10(viewDate);
  const td = d10(today) || vd;
  const rows = [];
  let fromSnap = false;

  /* 历史日优先快照：那天的段可能已被日切从活对象上清掉，
     只有快照还留着"当时几点做"。快照存在时不再叠加当前段。 */
  if (vd && td && vd < td) {
    const snap = todoSchedSnapshotOn(dayScheds, t.id);
    if (snap) {
      fromSnap = true;
      (Array.isArray(snap.blocks) ? snap.blocks : []).forEach(function (b) {
        if (!b || typeof b !== 'object') return;
        const st = String(b.start == null ? '' : b.start).trim();
        const en = String(b.end == null ? '' : b.end).trim();
        const sd = d10(st);
        const sm = tbHHMMToMin(st);
        const em = tbHHMMToMin(en);
        if (!sd || sm == null || em == null) return;
        rows.push({ date: sd, start: sm, end: em, endDate: d10(en) || sd, snap: true });
      });
      if (!rows.length) {
        const rs = String(snap.remindAt == null ? '' : snap.remindAt).trim();
        const re = String(snap.estEnd == null ? '' : snap.estEnd).trim();
        const sd = d10(rs);
        const sm = tbHHMMToMin(rs);
        if (sd && sm != null) {
          const em = tbHHMMToMin(re);
          rows.push({ date: sd, start: sm, end: em == null ? sm : em, endDate: d10(re) || sd, snap: true });
        }
      }
    }
  }

  if (!fromSnap) {
    /* 重复任务：先由 tbBlocksOf 把**整套段**平移到查看日（重复 = 同一份安排再来一次）；
       一次性任务：直接列**全部段**（多段排期允许排在不同的天，只列查看日那天的段
       会让"明天那段"整块消失 —— 「不同的隔天排期这都不一样」）。
       两条来源之后走**同一个**循环：段的日期一律取段自己，跨天段各自归各自那天。

    ★ 「重复的，刨开那个单日排期，为什么它还会精确到日呢？这会让人产生误解」
      —— 重复任务的模板段，日期是**平移算出来的**（每天都会再来一次），写死某一天就是假精度。
      所以行上带来源标记，渲染层据此决定写不写日期：
        rep   = 重复规则的默认排期 → 日期无意义，改写成规则文案（每天 / 每周一、三）
        fixed = 按天覆盖（dayPlan）→ 日期**是真的**，只有这一天，必须写清楚
      一次性任务的段不带 rep（日期是用户自己排的，必须写）。
      快照行（历史天）也不带：那一天做过什么，是真实历史。 */
    const _isRep = !!(vd && normTodoRepeat(t.repeat));
    const _isFixed = _isRep && todoDayPlanOn(t, vd).length > 0;
    const src = _isRep
      ? tbBlocksOf(t, settings, vd).map(function (b) { return { start: b.rawStart, end: b.rawEnd }; })
      : todoBlocksOf(t, settings);
    src.forEach(function (b) {
      const sd = d10(b.start) || vd;
      rows.push({
        date: sd,
        start: tbHHMMToMin(b.start),
        end: tbHHMMToMin(b.end),
        endDate: d10(b.end) || sd,
        snap: false,
        rep: _isRep && !_isFixed,
        fixed: _isFixed
      });
    });
  }

  rows.sort(function (a, b) {
    const ka = a.date + '#' + (a.start < 1000 ? '0' : '') + (a.start < 100 ? '0' : '') + (a.start < 10 ? '0' : '') + a.start;
    const kb = b.date + '#' + (b.start < 1000 ? '0' : '') + (b.start < 100 ? '0' : '') + (b.start < 10 ? '0' : '') + b.start;
    return ka < kb ? -1 : (ka > kb ? 1 : 0);
  });
  const seen = {};
  const out = [];
  rows.forEach(function (r) {
    const k = r.date + '#' + r.start;
    if (seen[k]) return;
    seen[k] = 1;
    r.nextDay = r.endDate > r.date;
    out.push(r);
  });
  return out;
}
/* ===== 计划页「备忘」留言板（纯规则；不碰 DOM/appData/存储）=====
 * 形态对标微信「文件传输助手」：单侧气泡、只追加、按时间正序。
 * 保留期从**写入时刻**起算：到期后按设置里的保留策略「提醒我删」或「自动删」，策略在设置里选。
 * 这里只算「哪些过期、还剩几天」，不删任何东西 —— 删是视图层的决定。 */
const MEMO_RETENTION_OPTIONS = [
  { key: '1m', label: '1 个月', days: 30, hint: '30 天前的备忘会被清出' },
  { key: '1y', label: '1 年', days: 365, hint: '整整一年的备忘都留着（默认）' },
  { key: 'forever', label: '永久保留', days: 0, hint: '不清理，数据会一直长大' }
];
const MEMO_RETENTION_DEFAULT = '1y';
const MEMO_TEXT_MAX = 500; /* 单条上限：防止一次粘贴几十 KB 把列表撑爆 */
/* 保留期元信息；认不出的键回落到默认档（保证永远返回一个可用对象） */
function memoRetentionMeta(key) {
  const s = key == null ? '' : String(key);
  for (let i = 0; i < MEMO_RETENTION_OPTIONS.length; i++) if (MEMO_RETENTION_OPTIONS[i].key === s) return MEMO_RETENTION_OPTIONS[i];
  for (let j = 0; j < MEMO_RETENTION_OPTIONS.length; j++) if (MEMO_RETENTION_OPTIONS[j].key === MEMO_RETENTION_DEFAULT) return MEMO_RETENTION_OPTIONS[j];
  return null;
}
/* 归一化单条备忘：脏值返回 null（调用方直接跳过）；文本裁剪到上限；时间戳必须有限正数 */
function normMemo(m) {
  if (!m || typeof m !== 'object') return null;
  const ts = Number(m.ts);
  if (!isFinite(ts) || ts <= 0) return null;
  const text = String(m.text == null ? '' : m.text).trim();
  if (!text) return null;
  /* ★ id 必须过字符集白名单（P1-3）：它会被拼进 onclick 的 JS 字符串参数
     （`replyMemo('<id>')`），备份导入是用户可控通道 ——
     一个 `a','+alert(1)+'` 的 id 就是存储型 XSS（file:// 下同源放大）。
     非法 id 不丢整条（丢数据比脏 id 更糟），改用 ts 派生一个确定性 id：
     纯函数里不能引入 Date.now/Math.random，否则单测就不确定了。
     replyTo 同理，指向脏 id 的引用直接丢弃（它只会渲染成找不到父的普通气泡）。 */
  const _rawId = m.id == null ? '' : String(m.id);
  const _safeId = /^[A-Za-z0-9_-]{1,64}$/.test(_rawId) ? _rawId : 'm' + Math.round(ts).toString(36);
  const _o = { id: _safeId, text: text.slice(0, MEMO_TEXT_MAX), ts: Math.round(ts) };
  /* 引用回复：用可选父指针表达 A→B→A 的来回。
     **加新字段、不改老字段** —— 老数据没有 replyTo 就是普通气泡，零迁移。
     自引用（replyTo === 自己 id）无意义，直接丢弃，避免渲染成死循环。 */
  if (m.replyTo != null && String(m.replyTo) !== '') {
    const _rt = String(m.replyTo);
    /* 同上：父指针也过白名单，脏值直接丢弃（渲染成普通气泡，不炸也不注入） */
    if (_rt !== _o.id && /^[A-Za-z0-9_-]{1,64}$/.test(_rt)) _o.replyTo = _rt;
  }
  /* 对话方向：'other' = 左栏（对面说的）；缺省即右栏（我说的）。
     镜像 IM 的常规布局（自己靠右、对方靠左）。
     **只存非默认值** —— 老数据没有 side 就是右栏，与升级前的观感完全一致，零迁移。 */
  if (m.side === 'other') _o.side = 'other';
  /* 数据契约字段**原样透传**：本函数会重建对象，不透传等于每条备忘一发出去
     就把 uid / updatedAt 洗掉，同步时被当成新记录反复创建。 */
  if (m.uid) _o.uid = String(m.uid).slice(0, 80);
  if (typeof m.updatedAt === 'number' && isFinite(m.updatedAt)) _o.updatedAt = m.updatedAt;
  return _o;
}
/* 归一化整个留言板：过滤脏值 + 按时间正序（同一毫秒按 id 兜底，排序稳定） */
function normMemoList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach(function (m) {
    const n = normMemo(m);
    if (n) out.push(n);
  });
  out.sort(function (a, b) {
    return a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return out;
}
/* 按保留期切分 → { keep, expired }（永久档全部归 keep）。nowMs 由调用方传入，保证可测 */
function memoSplitByRetention(list, nowMs, key) {
  const meta = memoRetentionMeta(key);
  const arr = normMemoList(list);
  if (!meta || !meta.days) return { keep: arr, expired: [] };
  const now = isFinite(Number(nowMs)) ? Number(nowMs) : 0;
  const cutoff = now - meta.days * DAY_MS;
  const keep = [];
  const expired = [];
  arr.forEach(function (m) {
    (m.ts < cutoff ? expired : keep).push(m);
  });
  return { keep: keep, expired: expired };
}
/* 距离过期还剩几天（用于「还有 N 天」提示）；永久档或无有效值返回 -1 */
function memoDaysLeft(m, nowMs, key) {
  const meta = memoRetentionMeta(key);
  if (!meta || !meta.days || !m) return -1;
  return Math.ceil((Number(m.ts) + meta.days * DAY_MS - Number(nowMs || 0)) / DAY_MS);
}
/* ===== 时间块计划板（纯几何/布局；不碰 DOM/appData）=====
 * 三个概念严格分开（这是这个功能的核心，别做成普通日历）：
 *   planned  计划块 —— 由计划「提醒时间(=开始) → 预计结束」得到
 *   actual   实际块 —— 由专注记录按 todoId 关联得到，**可能多段**（暂停/中断/多个番茄）
 *   deadline 截止   —— 只做「小旗子」标记，不画成块
 * 视图层负责颜色与像素，这里只算「分钟数 / 多轨布局 / 吸附」。 */
const TB_SLOT_MIN = 30;             /* 吸附粒度：一格 30 分钟（15 分钟粒度对小屏太碎） */
const TB_DAY_MINUTES = 1440;        /* 一天 24h，纵向时间轴的总长度 */
/* 历史常量，**保留只为不破坏已导出的名字**（可能被外部/测试引用）：绘图链已不再引用它。
 * 它原本的理由是"再短的块也给 15 分钟高度，否则点不到"——但那张网格是**只读**的
 * （不提供点按排期、拖拽改时长），"点不到"不成立；真实代价是 1 秒的专注被画成 15 分钟。 */
const TB_MIN_SPAN_MIN = 15;
/* 绘图用的最小可见高度（分钟）：1 分钟 ≈ 3px 的一条细线 —— 有记录就一定画得出来，
 * 但**不夸大时长**。具体的"最少占几行人眼才看得见"归绘图层（01eA）判，
 * L0 只给这个语义正确的下限，别在纯计算层偷偷把短段撑长。 */
const TB_DRAW_MIN_MIN = 1;
const TB_MAX_LANES = 3;             /* 同一时刻最多并排 3 列，再多挤成一列（小屏现实约束） */
/* —— 网格版式（照用户纸质表，不是自造）：横向 = 时间，每小时 2 列（预计/实际）；
 *    纵向 = 一小时内的 10 分钟格，6 行 = 60 分钟；一「带」= 9 小时，上下两带拼成 06–23。
 *    （2026-11-04：原来两带是 07–14 / 15–22。用户要「上半部分加一个 6 点、下半部分加一个 11 点」，
 *      即早上提前到 06:00、晚上延到 23:00，两带各 9 小时 → 18 列。）
 *    一列自上而下 = 这一小时从 :00 到 :50 的 10 分钟格（不是「一列 = 一小时」）。*/
const TB_GRID_SLOT_MIN = 10;                 /* 每小格 10 分钟 */
const TB_GRID_ROWS = 60 / TB_GRID_SLOT_MIN;  /* 6 行 */
const TB_GRID_BANDS = [[6, 14], [15, 23]];   /* [起, 止] 闭区间，各 9 小时 → 18 列 */
const TB_GRID_LANES = ['plan', 'actual'];    /* 每小时两列：左=预计，右=实际 */
/* 分钟数 → 网格坐标 {band, hour, slot}；不在 06–23 内返回 null */
function tbGridCellOf(min) {
  const v = Number(min);
  if (!isFinite(v)) return null;
  const h = Math.floor(v / 60);
  const slot = Math.floor((v % 60) / TB_GRID_SLOT_MIN);
  for (let b = 0; b < TB_GRID_BANDS.length; b++) {
    const lo = TB_GRID_BANDS[b][0], hi = TB_GRID_BANDS[b][1];
    if (h >= lo && h <= hi) return { band: b, hour: h, hourIdx: h - lo, slot: slot };
  }
  return null;
}
/* 网格坐标 → 分钟数（会话内可越界，靠调用方夹取） */
function tbGridMinOf(band, hourIdx, slot) {
  const lo = TB_GRID_BANDS[band] ? TB_GRID_BANDS[band][0] : 0;
  return (lo + hourIdx) * 60 + slot * TB_GRID_SLOT_MIN;
}
/* 网格里可落笔的最小/最大分钟（06:00 ~ 23:59 的下一格） */
function tbGridRange() {
  return { min: TB_GRID_BANDS[0][0] * 60, max: (TB_GRID_BANDS[1][1] + 1) * 60 };
}
/* 分钟区间 → 它覆盖的单元格列表（跨小时自动断开，带外丢弃） */
function tbGridCellsOf(startMin, endMin) {
  const out = [];
  const r = tbGridRange();
  let s = Math.max(r.min, Math.round(startMin / TB_GRID_SLOT_MIN) * TB_GRID_SLOT_MIN);
  let e = Math.min(r.max, Math.round(endMin / TB_GRID_SLOT_MIN) * TB_GRID_SLOT_MIN);
  for (let m = s; m < e; m += TB_GRID_SLOT_MIN) {
    const c = tbGridCellOf(m);
    if (c) out.push(c);
  }
  return out;
}
/* 两个单元格是否同一列（用于把多格合成一条连续的块） */
function tbGridSameCol(a, b) {
  return !!a && !!b && a.band === b.band && a.hourIdx === b.hourIdx;
}
/* "HH:MM" 或 "YYYY-MM-DD HH:MM" → 当天分钟数（0..1439）；认不出返回 null */
function tbHHMMToMin(s) {
  const m = String(s == null ? '' : s).match(/(\d{1,2}):(\d{2})\s*$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!isFinite(h) || !isFinite(mi) || h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
/* 分钟数 → "HH:MM"（超出一天的部分取模，负数也安全） */
function tbMinToHHMM(min) {
  let v = Math.round(Number(min));
  if (!isFinite(v)) return '';
  v = ((v % TB_DAY_MINUTES) + TB_DAY_MINUTES) % TB_DAY_MINUTES;
  const h = Math.floor(v / 60);
  const m = v % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}
/* 分钟数 → 「给人看的」时刻文本（跟随设置里的 12/24 小时制，走 fmtHM 这个唯一入口）。
   ⚠️ 只用于**显示**。存储、输入框、备份导出仍一律用 tbMinToHHMM（恒 24 小时制），
   两者不能互换 —— 一旦把显示口径写进 remindAt/estEnd，用户关掉 12 小时制时数据就坏了。
   拆成两个函数的原因：日程表原先把 tbMinToHHMM 直接印在标题上，同一个时刻
   在计划卡显示「9:00」（跟随设置）、在日程表显示「09:00」（恒 24 小时制、补零），两处对不上。 */
function tbMinLabel(min) {
  const v = Math.round(Number(min));
  if (!isFinite(v)) return '';
  const w = ((v % TB_DAY_MINUTES) + TB_DAY_MINUTES) % TB_DAY_MINUTES;
  return fmtHM(Math.floor(w / 60), w % 60);
}
/* 网格轴上的钟点标签：跟随 12/24 小时制，且**只到小时**
   （fmtHM 会带上分钟，而轴上每小时只占一列，放不下）。
   与块内时间共用同一个时钟口径，避免"轴写 21、块里写 9"这种自相矛盾。
   12 小时制下**不印「上午/下午」前缀**，与 fmtHM 同一取舍（见那里的说明）。 */
function tbHourLabel(h) {
  const v = Math.round(Number(h));
  if (!isFinite(v)) return '';
  if (!clockHour12()) return (v < 10 ? '0' : '') + v;
  let h12 = v % 12;
  if (h12 === 0) h12 = 12;
  return String(h12);
}
/* 吸附到最近格子并限幅在 [0, TB_DAY_MINUTES] */
function tbSnapMin(min, slotMin) {
  const slot = Number(slotMin) > 0 ? Number(slotMin) : TB_SLOT_MIN;
  let v = Number(min);
  if (!isFinite(v)) return 0;
  v = Math.round(v / slot) * slot;
  if (v < 0) v = 0;
  if (v > TB_DAY_MINUTES) v = TB_DAY_MINUTES;
  return Math.round(v);
}
/* 一天分成多少格 */
function tbSlotCount(slotMin) {
  const slot = Number(slotMin) > 0 ? Number(slotMin) : TB_SLOT_MIN;
  return Math.round(TB_DAY_MINUTES / slot);
}
/* 计划卡 → 计划块（只算数值；start/end/deadline 都是「当天分钟数」，null = 没设） */
function tbBlockOf(t, settings) {
  if (!t) return null;
  const info = todoEstInfo(t, settings);
  const start = tbHHMMToMin(info.start);
  let end = tbHHMMToMin(info.end);
  /* 预计结束早于开始（跨天/脏数据）→ 至少给一格，避免画成负高度 */
  if (start != null && (end == null || end <= start)) end = Math.min(TB_DAY_MINUTES, start + TB_SLOT_MIN);
  return {
    id: t.id,
    title: String(t.title == null ? '' : t.title),
    tag: String(t.tag == null ? '' : t.tag),
    quad: normQuad(t.quad),
    start: start,
    end: end,
    deadline: tbHHMMToMin(t.deadline),
    startDate: info.start ? String(info.start).slice(0, 10) : '',
    estPomos: todoEstPomos(t),
    actPomos: Number(t.actualPomodoros) || 0,
    done: !!t.done,
    actualStart: Number(t.actualStart) || 0,
    doneAt: Number(t.doneAt) || 0
  };
}
/* ===== 排期段（唯一数据形状）=====
 * t.blocks = [{ start: 'YYYY-MM-DD HH:MM', end: 'YYYY-MM-DD HH:MM' }, ...]
 *   · **所有段平等**，没有主段/另排之分；
 *   · 提醒是独立字段 t.remindAt，只负责"到点响"，不参与画块；
 *   · 段的身份 = (任务, start)，不引入新 id，删除按 start 字符串定位；
 *   · 日期不单独存，一律取 start 的前 10 位（与快照按日归档同一口径）。
 * 约束（写入期校验在 01d 的 todoAddBlock）：
 *   同日、end > start、≥10 分钟（一格）、同任务内不重叠、每任务 ≤24 段。
 * 旧名 normExtraBlocks 保留为别名，调用点逐步替换。 */
const TODO_EXTRA_MAX = 24;
const TODO_EXTRA_MIN_MIN = 10;
/* 任意输入 → 干净的额外段数组（升序、去重、截断）。
   非法项**静默丢弃**而不是抛：脏数据只该少画一个块，不该让整张网格挂掉。 */
function normExtraBlocks(arr) {
  const out = [];
  if (!Array.isArray(arr)) return out;
  const seen = {};
  for (let i = 0; i < arr.length; i++) {
    const b = arr[i];
    if (!b || typeof b !== 'object') continue;
    /* 先做**严格的日期形状校验**再做 normDT：Date 会把 2026-13-01 静默进位成
       、把 2026-02-30 进位成 03-02 —— 脏数据不该被"修好"后画到另一天。
       六条约束合成一个 ok 判断（而不是六个 early-return）：少一层分支，
       也避免"哪条没过"在阅读时被拆散。 */
    const sdRaw = String(b.start == null ? '' : b.start).trim().slice(0, 10);
    const edRaw = String(b.end == null ? '' : b.end).trim().slice(0, 10);
    const s = normDT(b.start);
    const e = normDT(b.end);
    const sm = tbHHMMToMin(s);
    const em = tbHHMMToMin(e);
    const ok = !!s && !!e && sm != null && em != null
      && /^\d{4}-\d{2}-\d{2}$/.test(sdRaw) && /^\d{4}-\d{2}-\d{2}$/.test(edRaw)
      && s.slice(0, 10) === sdRaw && e.slice(0, 10) === edRaw  /* 被进位过 → 丢弃 */
      && sdRaw === edRaw                                       /* 同日：跨午夜不支持 */
      && e > s                                                 /* 同格式字符串比较安全 */
      && em - sm >= TODO_EXTRA_MIN_MIN;                        /* 不足一格不画 */
    if (!ok) continue;
    if (seen[s]) continue;                          /* 同一开始时刻只留一条 */
    seen[s] = 1;
    out.push({ start: s, end: e });
  }
  out.sort(function (a, b) { return a.start < b.start ? -1 : (a.start > b.start ? 1 : 0); });
  return out.length > TODO_EXTRA_MAX ? out.slice(0, TODO_EXTRA_MAX) : out;
}
/* ===== 一条计划的全部排期段（唯一取数入口）=====
 * 新写法读 t.blocks；没有这个字段时，从旧字段合成（remindAt+estEnd 一段 + extraBlocks），
 * 只读、不写回 —— 老存档打开即用，不会因为升级丢掉已经排好的时间。 */
function todoBlocksOf(t, settings) {
  if (!t || typeof t !== 'object') return [];
  /* ★ 空数组要继续往下走（2026-11-06）。新建计划一律写 blocks: []，
     以前这里看到「是数组」就直接返回，于是 remindAt 上排的那段永远不会被算出来 ——
     日程表上看得见提醒时刻、列表却说这条没排期（掉进「📌 未排期」）。 */
  if (Array.isArray(t.blocks) && t.blocks.length) return normExtraBlocks(t.blocks);
  const out = [];
  const s0 = normDT(t.remindAt);
  if (s0) {
    let e0 = normDT(t.estEnd);
    if (!e0) {
      const mins = todoEstDurationMin(todoEstPomos(t), settings);
      if (mins > 0) e0 = addMinutesToLocal(s0, mins);
    }
    if (e0 && e0 > s0) out.push({ start: s0, end: e0 });
  }
  normExtraBlocks(t.extraBlocks).forEach(function (b) { out.push(b); });
  return normExtraBlocks(out);
}
/* ===== 排序锚点：「接下来那一段」=====
 * 「按计划时间」排序时，一条有多段的计划该拿哪一段去比？
 * 每过一段，就按下一段的开始时间排。
 * 规则：取**第一个还没结束**的段（正在进行中的也算它）；全部已结束 → 取最后一段的起点。
 *   前者让任务随着时间推进自然下移；后者保证「全过的」仍按时间先后排，且天然排在未来的前面。
 * 只读、不改数据。返回 { start, end }；没有段 → 空串（排序时按空值垫底）。 */
function todoSortAnchor(t, settings, nowDT) {
  const now = normDT(nowDT) || '';
  /* 今天被单独排过 → 按覆盖段排（用户刚把今天挪到 19:00，排序还得按 21:00 就自相矛盾）。
     其它情况仍按模板。 */
  const _ov = now ? todoDayPlanOn(t, now.slice(0, 10)) : [];
  const blocks = _ov.length ? _ov : todoBlocksOf(t, settings);
  if (!blocks.length) return { start: '', end: '' };
  if (now) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const en = normDT(b.end) || normDT(b.start);
      if (!en || en > now) return { start: b.start, end: b.end };
    }
  }
  const last = blocks[blocks.length - 1];
  return { start: last.start, end: last.end };
}
/* ===== 重复计划的「按天单独排期」（dayPlan）=====
 * 真实需求：「每天」的重复计划只有**一套**排期模板，
 * 21:00 那条每天都是 21:00；哪天想改成早上，只能改模板 → 之后天天都变。
 * 于是加一层「某天单独一套」：t.dayPlan = { 'YYYY-MM-DD': [ {start,end}, … ] }
 *
 * 三条硬规则（写在这里，因为它们是这条数据结构的全部语义）：
 *  1. **只对查那一天生效**：tbBlocksOf 一看到这天有覆盖就整组替换模板（不是叠加）——
 *     「今天改成 19:00」= 今天只有 19:00，模板那条 21:00 不该还留在屏幕上。
 *  2. **过去的日子不受影响**：历史块读的是排期快照（todoSchedLog），已冻结；
 *     覆盖只改「今天及以后」，所以改哪天都不会动到前几天。
 *  3. **日切时清掉过期的覆盖**：昨天那套覆盖留着只会让 dayPlan 无限长大；
 *     清除之前 resetTodoOccurrence 已经先冻结了快照，块不会丢。
 *
 * 段存完整 datetime（与 t.blocks 同一形状）→ 直接复用 normExtraBlocks 的全部校验，
 * 不另立一套「只有钟点」的格式。键是日期，段必须落在同一个键日子里（跨天不支持）。
 * 一天最多 24 段、整个 dayPlan 最多 TODO_DAYPLAN_MAX_DAYS 天 —— 脏数据只该少画块，不该卡页面。 */
const TODO_DAYPLAN_MAX_DAYS = 60;
/* 任意输入 → { 'YYYY-MM-DD': [已清洗段] }，只保留有段的日期，按日期升序。
   ★ 2026-11-09 起计划与习惯共用这一份（习惯的 h.dayPlan 同形状）：
     同一个「单日覆盖」概念只允许有一处清洗口径，否则迟早两边对脏数据的耐心不一样。 */
function dayPlanNormAll(src, maxDays) {
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  const cap = (Number(maxDays) > 0) ? Number(maxDays) : TODO_DAYPLAN_MAX_DAYS;
  const keys = Object.keys(src).sort();
  let days = 0;
  for (let i = 0; i < keys.length; i++) {
    const ds = String(keys[i] || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) continue;
    /* 形状对不等于日子存在：'2026-13-01' 过得了正则 → 用"能不能原样往返"做真值校验 */
    const _dt = new Date(ds + 'T00:00:00');
    if (isNaN(_dt.getTime()) || getDateStr(_dt) !== ds) continue;
    const segs = normExtraBlocks(src[keys[i]]).filter(function (b) {
      return b.start.slice(0, 10) === ds;
    });
    if (!segs.length) continue;
    if (++days > cap) break;
    out[ds] = segs;
  }
  return out;
}
function todoDayPlanNormAll(t) {
  if (!t || typeof t !== 'object' || !t.dayPlan || typeof t.dayPlan !== 'object') return {};
  return dayPlanNormAll(t.dayPlan, TODO_DAYPLAN_MAX_DAYS);
}
/* 这一天有没有「单独排期」。返回该日的段（已清洗升序）；没有就空数组。 */
function todoDayPlanOn(t, dateStr) {
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (!ds) return [];
  const all = todoDayPlanNormAll(t);
  return all[ds] || [];
}
/* 这一天「几点该响」—— 单独排期过就按那天最早一段，否则按模板提醒。
   ★ 不这么写会出现「今天改成 19:00，提醒却在 21:00 响」：排期一处、提醒另一处，
     正是这一串 bug 的老毛病（同一个词两个出口）。 */
function todoRemindOn(t, dateStr) {
  if (!t) return '';
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (ds) {
    const ov = todoDayPlanOn(t, ds);
    if (ov.length) return String(ov[0].start).replace('T', ' ');
  }
  const rm = normDT(t.remindAt);
  if (!rm) return '';
  return (ds && rm.slice(0, 10) !== ds) ? '' : rm;
}
/* 某一天生效的额外段（已清洗、已排序） */
function todoExtraBlocksOn(t, dateStr) {
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (!t || !ds) return [];
  return normExtraBlocks(t.extraBlocks).filter(function (b) { return b.start.slice(0, 10) === ds; });
}
/* 这条计划**有块**的所有日期（主段日期 ∪ 额外段日期），升序。
   重复计划的「主段日期」仍只取初始排期日 —— 与 todoOccursOn 的 startDs 同口径。 */
function todoBlockDates(t, settings) {
  if (!t) return [];
  const set = {};
  const out = [];
  const add = function (ds) {
    if (ds && !set[ds]) { set[ds] = 1; out.push(ds); }
  };
  if (t._hist && Array.isArray(t._histBlocks)) {
    t._histBlocks.forEach(function (b) { add(String(b.rawStart || '').slice(0, 10)); });
    out.sort();
    return out;
  }
  todoBlocksOf(t, settings).forEach(function (b) { add(b.start.slice(0, 10)); });
  /* 单独排期的那几天也算「有块的日子」：清掉模板之后只剩覆盖的日子，
     不加这一行 → 那天画得出块、却进不了列表/冻结不了快照。 */
  const _dp = todoDayPlanNormAll(t);
  Object.keys(_dp).forEach(function (ds) { add(ds); });
  out.sort();
  return out;
}

function todoFirstBlockDate(t) {
  const ds = todoBlockDates(t);
  return ds.length ? ds[0] : '';
}
/* 这条计划**历史上**排过期的最后一天（只查排期快照，不看当前块）。
   为什么需要它：一次性计划的段过了日子会被 clearStaleOneOffSchedule 清掉
   （remindAt 清空、blocks 清空），活对象上再也算不出「它曾经排在昨天」。
   列表分组若只看活对象，就会把一条**明明白白排过昨天**的任务归进
   「📌 未排期（没设开始时间，不随日期变）」—— 事实是设过，只是那天过去了。
   快照是这件事的唯一残留（保留 3 年，见 TODO_SCHED_LOG_KEEP_DAYS）。
   参数 log 由调用方传排期快照表，纯函数不自取存档。
   返回 YYYY-MM-DD；从没排过 → ''。 */
function todoHistSchedDate(t, log) {
  if (!t || t.id == null || !log || typeof log !== 'object') return '';
  const key = String(t.id);
  let best = '';
  const keys = Object.keys(log);
  for (let i = 0; i < keys.length; i++) {
    const ds = String(keys[i]).slice(0, 10);
    if (ds.length !== 10) continue;
    const arr = log[keys[i]];
    if (!Array.isArray(arr)) continue;
    if (ds > best && todoSchedSnapshotOn(arr, key)) best = ds;
  }
  return best;
}
/* 这条计划在 ds 这天有没有块（网格取数口径） */
function todoHasAnyBlock(t, ds, startDs) {
  if (!t) return false;
  return todoOccursOn(t, ds, startDs) || todoExtraBlocksOn(t, ds).length > 0
    || todoDayPlanOn(t, ds).length > 0;
}
/* 一条计划在某天的**全部**块（主段 + 额外段）。日程网格的唯一取数入口。
   返回契约（单位必须分清，混用必现位置错乱）：
     startMin / endMin  当天分钟数（0–1440），喂 tbPaperLayout
     rawStart / rawEnd  完整 datetime 串，给快照、文案、缓存
     deadline           分钟数（不是 "HH:MM"），额外段恒 null
     estPomos / actPomos 额外段恒 0（番茄数是工作量，不随时间安排变）
   ★ 历史伪任务（_hist）走冻结分支：快照是「那天该画成什么样已经定死了」，
     不能再经过 normExtraBlocks —— 否则今天的规则会改写历史。 */
/* 段（完整 datetime）→ 网格要的块对象。tbBlocksOf 的两个分支共用这一处，
   避免「模板一套字段、覆盖一套字段」漏掉 deadline/estPomos 之类的键。 */
function tbBlockObjsOf(t, segs, ds) {
  const out = [];
  (segs || []).forEach(function (b) {
    const sm = tbHHMMToMin(b.start);
    const em = tbHHMMToMin(b.end);
    if (sm == null || em == null) return;
    out.push({
      startMin: sm,
      endMin: em,
      /* rawStart/rawEnd 的日期必须是**这一天**（ds）：重复任务的段挂在首日，
         拿首日当 rawStart 会让快照/缓存按日期读时错位。 */
      rawStart: b.start.slice(0, 10) + ' ' + b.start.slice(11, 16),
      rawEnd: b.end.slice(0, 10) + ' ' + b.end.slice(11, 16),
      /* 所有段平等：这里恒为 false，渲染层不再画虚线区分 */
      isExtra: false,
      key: String(t.id) + '|' + ds + '|' + sm,
      order: sm,
      title: String(t.title == null ? '' : t.title),
      tag: String(t.tag == null ? '' : t.tag),
      quad: normQuad(t.quad),
      deadline: tbHHMMToMin(t.deadline),
      estPomos: todoEstPomos(t),
      actPomos: Number(t.actualPomodoros) || 0,
      done: !!t.done
    });
  });
  /* 排序按**完整时间**（rawStart 含日期）：跨天多段的先后由日期决定，
     只比 startMin 会让「明天 08:00」排在「今天 20:00」前面。 */
  out.sort(function (a, b) {
    return (a.rawStart + '|' + a.key) < (b.rawStart + '|' + b.key) ? -1 : 1;
  });
  return out;
}

function tbBlocksOf(t, settings, dateStr) {
  if (!t) return [];
  if (t._hist && Array.isArray(t._histBlocks)) return t._histBlocks.slice();
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (!ds) return [];
  /* ★ 按天覆盖优先于一切模板：「今天改成 19:00」就是今天只有 19:00，
     模板那条 21:00 不能还留在屏幕上 —— 所以这里是**整组替换**，不是叠加。
     放在 dayPlan 归一之后、todoBlocksOf 之前：没有模板段、只有覆盖的日子也要能画。
     历史伪任务走上面的 _hist 分支，永远不受今天的 dayPlan 影响。 */
  const _ov = todoDayPlanOn(t, ds);
  if (_ov.length) return tbBlockObjsOf(t, _ov, ds);
  const all = todoBlocksOf(t, settings);
  if (!all.length) return [];
  const baseDate = all[0].start.slice(0, 10);
  /* 段画在哪一天：
     · 段自己的日期 → 照原样画；
     · 重复任务的其它命中日 → **整套段**平移到那天。
       重复就是"同一份安排再来一次"：几段一起搬。
       只搬第一段会让第二段停在首日，用户看到的就是"第二天少了一段"。 */
  const isRep = !!normTodoRepeat(t.repeat);
  /* 重复计划：这一天必须是规则命中的日子（首日同样要过规则，见 todoOccursOn）。
     否则「每周日」的计划会在它被创建的那一天（可能是周三）画出一块。 */
  if (isRep && !todoOccursOn(t, ds, baseDate)) return [];
  /* ★ 非重复任务的段可以排在**不同的天**（多段排期允许跨天）。
     以前这里对 baseDate === ds 的情况把 `all` 全量返回，并且 rawStart 一律写成 ds
     → 「今天 20:00 + 明天 08:00」会被画成今天两块（明天那块被冒领成今天的 8:00），
     折叠行的日期也对不上（需求：「不同的隔天排期这都不一样」）。
     现在：非重复只取**自己的日期 = ds** 的段；重复任务仍把整套段平移到 ds（保持相对天偏移）。 */
  /* 平移量：重复任务**总是**按「查看日 − 首日」平移（同日时 shift=0，也走同一条路径）。
     一次性任务不平移，只认段自己的日期。 */
  const shift = isRep ? daysBetweenStr(baseDate, ds) : -1;
  /* 先算出「这一天该有的段」（已按平移量搬到 ds 那天），再交给 tbBlockObjsOf 统一映射。
     以前映射逻辑内联在这里，和覆盖分支各写一遍字段 —— 漏掉 deadline / estPomos
     这种"模板有、覆盖没有"的差异时，只会在某个界面上表现成空白，很难追。 */
  const segs = [];
  all.forEach(function (b) {
    const bd0 = String(b.start).slice(0, 10);
    if (shift < 0 && bd0 !== ds) return;
    /* bd0 已由 todoBlocksOf 归一（合法日期），平移不会失败，无需再兜底判空 */
    const bd = shift > 0 ? addDaysStr(bd0, shift) : bd0;
    segs.push({ start: bd + ' ' + b.start.slice(11, 16), end: bd + ' ' + b.end.slice(11, 16) });
  });
  return tbBlockObjsOf(t, segs, ds);
}
/* ===== 每段排期各自提醒=====
 * 原来只认 t.remindAt 一个时刻、t.reminded 一个布尔 —— 一条计划排了多段
 * （8:20–9:00 和 9:20–9:40）也只会在第一段起点响一次，第二段永远沉默。
 *
 * 这里把「当天该响的每一段」摊平成一列，一段一个 key，各自确认：
 *   { ack, key, at, hhmm, startMin, endMin, idx, n, extra }
 *     ack  —— 落进 t.remindAcked 的那个键（日期|起始分钟），确认就写它
 *     key  —— 提醒队列里的任务 id（`<id>` 主段、`<id>#<hhmm>` 其它段）
 *     at   —— 'YYYY-MM-DD HH:MM'，到点判据用它做字符串比较
 *     idx/n—— 第几段 / 共几段，只用于文案（只有 1 段时不提"第几段"）
 * 有排期就按排期走；**没排期但手设了提醒**的仍按 remindAt 响一次（老用法不能废）。
 */
function todoRemindSlots(t, settings, dateStr) {
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return [];
  if (t.done) return [];
  const acked = (t.remindAcked && typeof t.remindAcked === 'object' && !Array.isArray(t.remindAcked)) ? t.remindAcked : {};
  const blocks = tbBlocksOf(t, settings, ds) || [];
  const out = [];
  const seen = {};
  const idStr = String(t.id);
  blocks.forEach(function (b) {
    if (!b) return;
    const sm = Number(b.startMin);
    if (!isFinite(sm)) return;
    const hhmm = tbMinToHHMM(sm);
    if (seen[hhmm]) return; /* 同一起点只响一次（主段与额外段重合时别重复） */
    seen[hhmm] = 1;
    const ack = ds + '|' + sm;
    out.push({
      ack: ack,
      key: out.length === 0 ? idStr : idStr + '#' + hhmm,
      at: ds + ' ' + hhmm,
      hhmm: hhmm,
      startMin: sm,
      endMin: Number(b.endMin),
      extra: !!b.isExtra,
      acked: !!acked[ack]
    });
  });
  /* 没排期、只有提醒时刻：按 remindAt 单独一条（ack 用 remindAt 的时分，避免与日切冲突） */
  if (!out.length) {
    const ra = String(t.remindAt == null ? '' : t.remindAt);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ra) && ra.slice(0, 10) === ds) {
      const sm = tbHHMMToMin(ra.slice(11, 16));
      const ack = ds + '|' + sm;
      out.push({ ack: ack, key: idStr, at: ra, hhmm: ra.slice(11, 16), startMin: sm, endMin: sm, extra: false, acked: !!acked[ack] });
    }
  }
  const n = out.length;
  out.forEach(function (s, i) {
    s.idx = i + 1;
    s.n = n;
  });
  return out;
}
/* 这一段的提醒是否已经确认过。
   t.reminded 是旧版的"整条计划已提醒"布尔：只对**第一段**生效，用来平滑迁移
   （老存档里 reminded=true 的计划不该在新版里再被催一次）。 */
function todoRemindSlotAcked(t, slot) {
  if (!slot) return true;
  if (slot.acked) return true;
  if (t && t.reminded && slot.idx === 1) return true;
  return false;
}

/* 这一天的「主块」key：有主段就用主段，否则用最早的额外段；空数组返回 ''。
   唯一用途 = 让实际段（tbActualOf）对同一条计划只取一次，避免 N 块画 N 份。 */
function tbPrimaryBlockKey(blocks) {
  if (!blocks || !blocks.length) return '';
  for (let i = 0; i < blocks.length; i++) if (!blocks[i].isExtra) return blocks[i].key;
  return blocks[0].key;
}

/* ===== 计划「排期快照」：历史那天的预计块不能依赖一个会被删掉的对象 =====
 * 用户报：一次性计划勾完成后，次日 checkNewDay 会把它从活动计划列表
 * 里删掉（列表只装当前任务）；而日程表的**预计块**是从 todos 现算的 ——
 * 于是回看那一天只剩 records 画出实际块，预计块凭空消失，看着像"计划从没存在过"。
 *
 * 两件事必须分开：
 *   · 「实际做了多久、几点到几点」是记录（records）的事实 —— 记录永不删；
 *   · 「本来几点该做、做到几点」是计划在那一天的事实 —— 冻结成快照，跟着那一天走。
 * 所以计划**脱离活动列表的那一刻**（勾完成 / 排期被清回未排期）写一份快照进
 * 排期快照表 todoSchedLog[某天]，日程表渲染时按它补画预计块。
 * ★ 快照只读：伪任务不参与任何写回，也不会出现在计划列表里（列表只读活动计划表）。 */
const TODO_SCHED_LOG_MAX_PER_DAY = 200; /* 一天最多留多少条排期快照，防脏数据把存档撑爆 */
/* 快照保留天数：只留最近 3 年。
   快照只为「回看某天当时怎么排的」服务，实际专注记录仍在 records 里（永久保留）。
   按天无限攒会让存档每年涨 1–2MB，最终拖慢保存、撞 localStorage 配额。 */
const TODO_SCHED_LOG_KEEP_DAYS = 1095;
/* 按日期裁掉过期快照：返回 { log, changed }。
   changed=false 时原样返回入参（不复制，避免每次启动都重建整个表）；
   changed=true 时返回新对象，调用方整体替换即可。
   非日期键一律丢弃 —— 它们永远不会被任何一天查到，只会占空间。 */
function pruneTodoSchedLog(log, today) {
  const src = (log && typeof log === 'object' && !Array.isArray(log)) ? log : {};
  const t = String(today == null ? '' : today).slice(0, 10);
  /* 两道校验合成一次：日期不合法 / 算不出截止日 → 原样返回（fail-open，不误删） */
  const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(t) ? addDaysStr(t, -TODO_SCHED_LOG_KEEP_DAYS) : '';
  if (!cutoff) return { log: src, changed: false };
  const out = {};
  let changed = false;
  Object.keys(src).forEach(function (k) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && k >= cutoff) out[k] = src[k];
    else changed = true;
  });
  return { log: changed ? out : src, changed: changed };
}
/* 只取**主段**的日期（remindAt，缺则 estEnd）；没有任何主段返回 ''。
   ⚠️ 多段计划请用 todoBlockDates / todoFirstBlockDate —— 这个函数看不见 extraBlocks，
      拿它判断「这条计划排在哪天」会漏掉"只有另排段"的日子。
      名字里保留 Main 就是为了让这层局限在使用处一眼可见。 */
function todoMainDateOf(t) {
  if (!t || typeof t !== 'object') return '';
  /* planDate 优先：它是用户「这天要做这条」的明确归属（不带提醒、不带排期块）。
     ★ 2026-11-06 加：在日程表某天点＋新建，不该靠 remindAt 表达归属 ——
       那样卡片上会凭空出现一个闹钟，而用户要的只是「那天能看到」。 */
  const p = String(t.planDate == null ? '' : t.planDate).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  const a = normDT(t.remindAt), b = normDT(t.estEnd);
  const ds = (a && a.slice(0, 10)) || (b && b.slice(0, 10)) || '';
  return /^\d{4}-\d{2}-\d{2}$/.test(ds) ? ds : '';
}
/* 一条计划在 dateStr 那天的排期快照；那天没有任何块返回 null。
 * ★ 判据是「有没有块」，不是「有没有 remindAt」—— 只有额外段的日子也必须能冻结，
 *   否则计划一被删，那天的段就跟着消失。 */
function todoSchedSnapshotOf(t, dateStr, settings) {
  if (!t || typeof t !== 'object') return null;
  const ds = String(dateStr || todoMainDateOf(t) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return null;
  /* 光有形状不算日期：'2026-13-01' 也过得了正则。用"能不能原样往返"做真值校验，
     否则快照会挂在一个根本不存在的日子上（月历/网格永远查不到它 = 静默丢失）。 */
  const _dt = new Date(ds + 'T00:00:00');
  if (isNaN(_dt.getTime()) || getDateStr(_dt) !== ds) return null;
  /* 冻结「那天画出来的块」：直接存绘制结果，不存 extraBlocks 让读回时二次展开。
     这样即使原始段后来被删、清洗规则后来改了，历史那天也不会变。
     ★ 判据把「有额外段」也算作有排期：「只有额外段」的计划（没有 remindAt/estEnd）
       同样必须能冻结，否则计划一被删，那天的段就跟着消失
*/
  const blocks = tbBlocksOf(t, settings, ds);
  /* ★ 判据要同时认三样东西：提醒/预计结束、额外段、以及**显式排过的模板段**。
     以前不认第三种 —— 于是「只设了 blocks、没设提醒」的重复计划一整天都冻不下来，
     历史上那天的预计块就永久丢了（C96 的 C1 抓到的真缺陷）。
     用 todoBlocksOf（不依赖 settings 推算）而不是上面的 blocks：settings 缺省时
     blocks 会因为算不出预计时长而为空，那会把"有提醒但没设置"的情况误判成没块。 */
  if (!normDT(t.remindAt) && !normDT(t.estEnd) && !normExtraBlocks(t.extraBlocks).length
    && !todoDayPlanOn(t, ds).length && !todoBlocksOf(t, {}).length) return null;
  return {
    id: t.id,
    date: ds,
    title: t.title == null ? '' : String(t.title),
    quad: normQuad(t.quad),
    tag: t.tag == null ? '' : String(t.tag),
    /* 时间字段**原样冻结**：不做"平移到今天"，它就是那一天的样子 */
    remindAt: normDT(t.remindAt) || '',
    estEnd: normDT(t.estEnd) || '',
    estEndManual: !!t.estEndManual,
    deadline: t.deadline || null,
    pomodoros: Number(t.pomodoros) || 0,
    tbColor: t.tbColor || '',
    actPomos: Number(t.actualPomodoros) || 0,
    doneAt: Number(t.doneAt) || 0,
    blocks: blocks.map(function (b) {
      return { start: b.rawStart, end: b.rawEnd };
    })
  };
}
/* 快照 → 日程表能直接画的「伪任务」。字段沿用真任务的形状，tbBlockOf/配色原样复用。
 * 标 _hist:1 让视图知道它只是历史（点击不该跳计划卡、也不该被写回）。
 * _histBlocks = 冻结的块，tbBlocksOf 首个分支直通返回；旧快照没有 blocks 字段时留空，
 * 走回 tbBlockOf 的单段兼容路径（行为与改版前一致）。 */
function todoSchedPseudoTodo(snap) {
  if (!snap || !snap.id || snap.id === 0) return null;
  const hb = [];
  if (Array.isArray(snap.blocks)) {
    snap.blocks.forEach(function (b) {
      if (!b) return;
      const s = String(b.start || '');
      const e = String(b.end || '');
      const sm = tbHHMMToMin(s);
      const em = tbHHMMToMin(e);
      if (sm == null || em == null) return;
      hb.push({
        startMin: sm,
        endMin: em,
        rawStart: s,
        rawEnd: e,
        isExtra: !!b.isExtra,
        key: 'hist|' + s,
        order: sm,
        title: snap.title == null ? '' : String(snap.title),
        tag: snap.tag == null ? '' : String(snap.tag),
        quad: normQuad(snap.quad),
        deadline: tbHHMMToMin(snap.deadline),
        estPomos: b.isExtra ? 0 : (Number(snap.pomodoros) || 0),
        actPomos: b.isExtra ? 0 : (Number(snap.actPomos) || 0),
        done: true
      });
    });
  }
  return {
    id: snap.id,
    title: snap.title || '',
    quad: snap.quad || null,
    tag: snap.tag || '',
    remindAt: snap.remindAt || '',
    estEnd: snap.estEnd || '',
    estEndManual: !!snap.estEndManual,
    deadline: snap.deadline || null,
    pomodoros: Number(snap.pomodoros) || 0,
    tbColor: snap.tbColor || '',
    actualPomodoros: Number(snap.actPomos) || 0,
    done: true,
    doneAt: Number(snap.doneAt) || 0,
    _hist: 1,
    _histBlocks: hb.length ? hb : null
  };
}
/* 某一天的快照 → 伪任务列表。
 * liveIds：当前仍在活动计划列表里的 id 集合 —— 计划还在列表里时**以活对象为准**
 * （用户改过时间就该显示改后的），快照只在"这条计划已经不在了"时补位。
 * 同一天同一 id 只补一次（后写的覆盖先写的，见 01d 的 pushTodoSchedSnapshot）。 */
function todoSchedPseudoTodos(dayScheds, liveIds) {
  const arr = Array.isArray(dayScheds) ? dayScheds : [];
  const live = liveIds || {};
  const out = [], seen = {};
  for (let i = arr.length - 1; i >= 0; i--) {  /* 倒序：同 id 后者优先 */
    const s = arr[i];
    if (!s) continue;
    const k = String(s.id);
    if (seen[k]) continue;
    if (live[k]) continue;
    seen[k] = 1;
    const t = todoSchedPseudoTodo(s);
    if (t) out.push(t);
  }
  return out;
}
/* 把「区间」与「时长」分开：块画在哪由区间定，块有多长由记录的权威时长定。
 * ★ 这条是从 super-productivity 学来的、之前没落地的那一半：
 *    sp 的 timeSpentOnDay 是一个**独立的数字**（task.reducer.ts 每秒 += duration），
 *    worklog 的 {s,e} 只是"大概从几点干到几点"的**参考范围** —— 所以它敢在 reducer 里
 *    随手写 e: Date.now()，因为区间歪了时长一点不受影响。
 *    我们此前凡是"共 X 分"都等于 Σ(段.e − 段.s)，区间一歪（迟到结算、App 被杀后收口）
 *    时长立刻跟着歪 —— 43 分就是这么来的。
 *
 * 入参 segs: [{ start, end, recId, authMs }]（坐标系无所谓，只要 start/end 同单位；
 *            authMs 是毫秒，内部按比例折算，与 start/end 的单位无关）。
 * 返回：新数组，不修改入参。缺 recId / 缺 authMs 的段原样返回（进行中会话就属于这种，
 *      它还没落库，"正在做"只能按区间画）。
 * 同一条记录拆成多段时按各段跨度占比分配 —— 只有相对比例有意义。 */
function tbAuthScaleSegs(segs) {
  const src = Array.isArray(segs) ? segs : [];
  const out = src.map(function (sg) {
    if (!sg) return sg;
    const span0 = Number(sg.end) - Number(sg.start);
    return {
      start: sg.start, end: sg.end, recId: sg.recId, authMs: sg.authMs || 0,
      /* 有些调用方只给 start/end，minutes 由这里补 —— 出口永远带 minutes，调用方不必各算一遍 */
      minutes: sg.minutes != null ? sg.minutes : span0
    };
  });
  const acc = Object.create(null);
  out.forEach(function (sg) {
    if (!sg || sg.recId == null || !(sg.authMs > 0)) return;
    const k = 'r' + sg.recId;
    if (!acc[k]) acc[k] = { total: 0, authMin: sg.authMs / 60000 };
    acc[k].total += (Number(sg.end) - Number(sg.start));
  });
  out.forEach(function (sg) {
    if (!sg || sg.recId == null) return;
    const a = acc['r' + sg.recId];
    if (!a || !(a.total > 0) || !(a.authMin > 0)) return;
    /* ★ 块的**长度不得超过真实区间**（只缩不长）。
       正计时暂停时会把 startTime 重设为此刻，effectiveSeconds 却是**累计**的：
       21:40:54 开始、21:49:11 结束（真实 8 分钟）的那条记录，有效时长是 1907 秒
       （31 分钟）—— 那是「今天累计专注 31 分钟」，不是「这一段占了 31 分钟」。
       旧写法按比例把块从起点往右拉长，于是 8 分钟的块被画到 22:12，直接画进未来，
       用户看到「现在才 21:55，日程表怎么到 10 点多了」。
       单位注意：本文件坐标系是**距 00:00 的分钟数**（不是毫秒）。 */
    const realSpan = Number(sg.start) >= 0 ? Number(sg.end) - Number(sg.start) : 0;
    const want = realSpan * (a.authMin / a.total);
    /* 只缩不长：块的长度以权威时长为准，但**不许超过真实区间** */
    const span = Math.min(realSpan, want);
    sg.end = Number(sg.start) + span;
    sg.minutes = span;
  });
  return out;
}

/* 「计划外专注」：当天**归属不上任何计划**的专注记录 → 当日时间段（多段）。
 * 每段 { start, end, minutes, pomos, title }，坐标系与日程网格一致（当天第几分钟）。
 *
 * 为什么要有它：记录没挂计划（早期记录根本没有 todoId），只是"没排进计划"，
 * 不代表没做过 —— 网格的实际列必须把这段时间画出来，否则用户在日程页看不到自己真正做过的事。
 *
 * 归日口径与日志列表一致：只认 startTime 所在的**那一天**（跨天记录不在当天重复出现）。
 * 归属判定只看 **todoId**：能对上已知计划（knownIds）→ 属于那条计划，不算计划外。
 * ★ 不再有"记录没 todoId 但名字与计划标题相同 → 认领"这条口径：名字不是身份。
 *   老记录里能认亲的在启动时由 01d 的 migrateRecordOwnership 一次性补挂 todoId，
 *   补不上的就是**真的计划外**，应当在网格上显示成灰块（以前按名字猜，猜错就给
 *   几天前同名的自由专注补一个灰块、盖住新计划的彩色块）。
 * ★ type === 'log' / 'full' 与"是否计划外"**无关**：有 log 挂了计划，也有 full 没挂。
 *   一律只看 todoId 能不能落到某条计划上。
 * 纯函数：不读 appData，记录与计划都从参数进来（便于单测）。 */
function tbUnplannedSegments(records, dateStr, knownIds) {
  if (!Array.isArray(records) || !dateStr) return [];
  const want = String(dateStr).slice(0, 10);
  const known = {};
  (Array.isArray(knownIds) ? knownIds : []).forEach(function (id) {
    if (id != null) known[String(id)] = true;
  });
  const out = [];
  records.forEach(function (r) {
    if (!r || r.startTime == null) return;
    if (r.todoId != null && known[String(r.todoId)]) return;        /* 挂了计划 */
    const stMs = tbRecMs(r.startTime);
    if (isNaN(stMs)) return;
    const st = new Date(stMs);
    if (getDateStr(st) !== want) return;
    const s = st.getHours() * 60 + st.getMinutes() + st.getSeconds() / 60;
    const enMs = tbRecMs(r.endTime);
    const sec = isNaN(enMs) ? 0 : enMs - stMs;
    /* 时长口径与计划实际块一致：**权威值 effectiveSeconds 优先**，缺它才用结束−开始反推。
       灰块和彩色块是同一段时间的两种画法，换算口径不一样就会一块高一块矮。
       ★ 顺序不能倒：区间是会被收口/裁切的东西，拿它当尺子，
         结算晚了块就长出来一截 —— 与计划卡「43 分」是同一个病。 */
    const mins = Number(r.effectiveSeconds) > 0 ? Number(r.effectiveSeconds) / 60
      : sec > 0 ? sec / 60000 : TB_DRAW_MIN_MIN;
    let e = s + Math.max(TB_DRAW_MIN_MIN, mins);
    if (e > TB_DAY_MINUTES) e = TB_DAY_MINUTES;
    out.push({
      start: s, end: e, minutes: Math.max(TB_DRAW_MIN_MIN, e - s),
      pomos: Number(r.pomos) || 0, title: String(r.taskName || '')
    });
  });
  return out;
}
/* 记录的 startTime/endTime 历史上存过两种写法：毫秒时间戳（数字）与 ISO 字符串。
 * 旧代码只按 Number() 解，ISO 串会得到 NaN 被整条丢掉 —— 网格「实际」列
 * 对那批记录永远空着，就是这里。两种都认。 */
function tbRecMs(v) {
  if (v == null || v === '') return NaN;
  const n = Number(v);
  if (!isNaN(n)) return n;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? NaN : d.getTime();
}
/* 同一时刻重叠的块分轨：贪心占用「最早的可用列」。
 * 输入元素需带 { start, end }；返回新数组，元素追加 lane（0 起）与 lanes（同时刻最大列数）。 */
function tbAssignLanes(items) {
  const arr = (Array.isArray(items) ? items : []).filter(function (x) {
    return x && isFinite(Number(x.start)) && isFinite(Number(x.end));
  });
  arr.sort(function (a, b) {
    return a.start - b.start || a.end - b.end;
  });
  const laneEnds = [];
  const placed = arr.map(function (x) {
    let lane = -1;
    for (let i = 0; i < laneEnds.length && i < TB_MAX_LANES; i++) {
      if (laneEnds[i] <= x.start) { lane = i; break; }
    }
    if (lane < 0) {
      if (laneEnds.length < TB_MAX_LANES) lane = laneEnds.length;
      else lane = TB_MAX_LANES - 1; /* 超上限：挤在最后一列（视图层会做半透明叠加提示） */
    }
    laneEnds[lane] = x.end;
    const o = {};
    for (const k in x) if (Object.prototype.hasOwnProperty.call(x, k)) o[k] = x[k];
    o.lane = lane;
    return o;
  });
  /* lanes = 实际用到的列数（至少 1），供视图层算列宽 */
  let used = 1;
  placed.forEach(function (p) {
    if (p.lane + 1 > used) used = p.lane + 1;
  });
  placed.forEach(function (p) {
    p.lanes = used;
  });
  return placed;
}
/* ===== 森林 · 长期养成（纯规则）=====
 * 借鉴 Forest：让人上瘾的不是「一棵树长到底」，而是**每次专注成功都往林子里多种一棵** ——
 * 单棵树迟早满级，林子才会一直扩张。
 *
 * 树的账（只此一份口径，视图层不许自己再数一遍）：
 *   ① **只有「有番茄」的记录才种树**（完整🍅 / 半个🍅）。仅记录不是专注、未完成没做成，
 *      都不该在林子里留下痕迹；按分钟数折算更糟 —— 那会把「挂着计时器发呆」种成大树。
 *   ② **一条记录 = 一次专注**，体格按这条记录的**真实时长**分档（见 FOREST_TREE_LEVELS）；
 *      超过 60 分钟的场次按 floor(分钟/30) 一次收 2~4 棵（见 forestTreesPerRecord）——
 *      「连着坐了 90 分钟」和「做了三个番茄」在林子里本来就该长得不一样。
 *   ③ 一天 = 一片地：按天分组只为「看得见日子」，不参与计数。
 * 数据从 records 推导（不新增存储），导出/导入天然带上。 */
/* 树种表：**这一次专注的真实时长**决定种出什么（借鉴 Forest「20 分钟以内长不出树」）。
 * 为什么不再按番茄数分档：番茄数只说得清「做了几个」，说不出「连续坐了多久」。
 * 数组必须按 atMin 升序写，取最高命中项。
 * ★ level 是**下标**，视图层（01eN）按它挑形状 —— 加档位必须同时加形状，否则会画成前一档。 */
const FOREST_TREE_LEVELS = [
  { atMin: 0, label: '幼苗', icon: '🌿', hint: '不到 10 分钟' },
  { atMin: 10, label: '灌木', icon: '🌱', hint: '10 分钟以上' },
  { atMin: 25, label: '成树', icon: '🌳', hint: '25 分钟以上' },
  { atMin: 60, label: '大树', icon: '🌲', hint: '60 分钟以上' }
];
/* 一条记录最多收几棵树：Forest 是 60-89 分钟 2 棵 / 90-119 分钟 3 棵，
 * 这里按 floor(分钟/30) 推并封顶 4 —— 再长也不该堆成一片，那样反倒看不出"这是一次专注"。 */
const FOREST_TREES_MAX = 4;
const FOREST_MILESTONES = [
  { trees: 10, label: '萌芽林' },
  { trees: 50, label: '小树林' },
  { trees: 100, label: '半亩林' },
  { trees: 365, label: '一年之林' },
  { trees: 1000, label: '郁郁葱葱' },
  { trees: 3000, label: '一片森林' }
];
/* 森林面板「最近 N 天小树」的窗口长度（视图层不写死这个数） */
const FOREST_RECENT_DAYS = 14;
/* 森林面板里一天最多竖着画几个树图标，多出来的折成「+N」（视图层不写死这个数） */
const FOREST_ICONS_PER_DAY = 6;
/* 一次专注的**分钟数** → 树的等级**下标**（0=幼苗 / 1=灌木 / 2=成树 / 3=大树）。
   视图层靠它决定画多大的树；单独给一个函数，免得渲染处去反查 emoji。 */
function forestTreeLevelOf(minutes) {
  const p = Number(minutes);
  if (!isFinite(p)) return 0;
  let idx = 0;
  for (let i = 0; i < FOREST_TREE_LEVELS.length; i++) if (p >= FOREST_TREE_LEVELS[i].atMin) idx = i;
  return idx;
}
/* 一次专注的分钟数 → 这棵树长什么样（永远返回一项，非 null） */
function forestTreeOf(minutes) {
  const p = Number(minutes);
  let hit = FOREST_TREE_LEVELS[0];
  if (!isFinite(p)) return hit;
  for (let i = 0; i < FOREST_TREE_LEVELS.length; i++) if (p >= FOREST_TREE_LEVELS[i].atMin) hit = FOREST_TREE_LEVELS[i];
  return hit;
}
/* 一次专注的分钟数 → 这条记录在林子里种下几棵树。
 * 不足 60 分钟只种 1 棵（哪怕它长成了大树）：一次专注就是「做出了一件事」；
 * 超过 60 分钟才有"一次坐太久，等于连做了几轮"的意思，才多给 —— 见 FOREST_TREES_MAX 的注释。 */
function forestTreesPerRecord(minutes) {
  const m = Number(minutes);
  if (!isFinite(m) || m < 60) return 1;
  return Math.min(FOREST_TREES_MAX, Math.floor(m / 30));
}
/* 专注记录 → 森林：每天一片地、地里有若干棵树，按日期升序。
   返回 [{ date, trees, pomoSum, minutes, icons:[图标…] }]，icons 按当天专注发生的先后排。
   ★ 聚合字段叫 pomoSum 而不是 pomos：`X.pomos` 这个写法被番茄门禁保留给
     「记录上的原始字段」（读它必须过 getPomos 兜底），聚合结果换个名字，两者不会混。 */
function forestFromRecords(records) {
  if (!Array.isArray(records)) return [];
  /* 先把「树」挑出来、排好序，再按天归片：records 的数组顺序并无保证
     （补记、导入都会打乱），直接按数组顺序 push 会让「今天第几棵」跟着数据顺序漂。 */
  const trees = [];
  records.forEach(function (r) {
    if (!r || r.startTime == null || !isPomodoroRecord(r)) return;
    const ts = Number(r.startTime);
    if (!isFinite(ts)) return;
    const sec = Number(r.effectiveSeconds) > 0
      ? Number(r.effectiveSeconds)
      : Math.max(0, Number(r.endTime) - ts) / 1000;
    const pomo = getPomos(r); /* ★ 唯一读路径：老记录没有 pomos 字段也能算对 */
    const mins = isFinite(sec) && sec > 0 ? sec / 60 : 0;
    /* 没有时长字段的记录（极老的导出、手改过的数据）按「1 个番茄 ≈ 25 分钟」折算，
       否则它会在林子里长成一株 0 分钟的幼苗 —— 明明做过，却比只做了 5 分钟还小。 */
    const effMin = mins > 0 ? mins : pomo * 25;
    const count = forestTreesPerRecord(effMin);
    trees.push({
      ts: ts,
      date: getDateStr(ts),
      pomo: pomo,
      icon: forestTreeOf(effMin).icon,
      level: forestTreeLevelOf(effMin),
      mins: mins,
      count: count
    });
  });
  trees.sort(function (a, b) { return a.ts - b.ts; });
  const byDay = {};
  const order = [];
  trees.forEach(function (t) {
    if (!byDay[t.date]) {
      byDay[t.date] = { date: t.date, trees: 0, pomoSum: 0, minutes: 0, icons: [], levels: [] };
      order.push(t.date);
    }
    const d = byDay[t.date];
    /* 棵树可能 >1（长场次）：各级数组按棵数补齐，视图层仍可按 icons/levels 一一对应地画 */
    for (let i = 0; i < t.count; i++) {
      d.trees += 1;
      d.icons.push(t.icon);
      d.levels.push(t.level);
    }
    d.pomoSum += t.pomo;
    d.minutes += t.mins;
  });
  return order
    .map(function (k) {
      const d = byDay[k];
      return {
        date: d.date,
        trees: d.trees,
        pomoSum: Math.round(d.pomoSum * 2) / 2, /* 半档对齐：写 1.5，不写 1.4999999 */
        minutes: Math.round(d.minutes),
        icons: d.icons,
        levels: d.levels /* 与 icons 一一对应的等级下标，供视图层画不同大小的树 */
      };
    })
    .sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
}
/* 已解锁的里程碑（按树数）；返回 [{...milestone, unlocked:boolean}]，保证顺序稳定 */
function forestMilestones(treeCount) {
  const n = Number(treeCount) || 0;
  return FOREST_MILESTONES.map(function (m) {
    return { trees: m.trees, label: m.label, unlocked: n >= m.trees };
  });
}
/* ============================================================
 * 日记 → 「一条日记里有什么」的字段表（总览/传记共用）
 * ============================================================
 * 为什么要有这张表：总览原来把手写的 4 行 review + 1 行 feedback 拼在
 * renderAllDiaryBrowser 里，日记后来加了「🙏 感恩日记」，总览不知道 ——
 * 那天明明写了感恩，总览上却是一条空白。**字段清单散在渲染函数里，就是
 * 「新字段静默不显示」的成因**。现在：日记里有哪些可展示字段，只在这张表登记一次；
 * 没登记的顶层字段走兜底（原样短显示），保证再也不会「新增了东西、总览看不见」。
 *
 * 纯函数：只吃一个日记对象，不碰 DOM / appData / 存储，浏览器与 Node 共用。
 * 返回 { rows:[{label,text}], feedback:string, extra:[{label,text}] }
 *   rows     —— 有内容的登记字段（按表顺序）
 *   feedback —— 今日反馈压成一行（睡眠/精神），没填就是 ''
 *   extra    —— 表里没登记、但有内容的顶层字段（感恩之外的新字段不至于消失）
 */
/* 登记顺序 = 总览上的显示顺序。clip 是「这一栏最多显示几个字」。 */
const DIARY_FIELD_SPEC = [
  { key: 'plan', label: '📝 今日计划', clip: 60 },
  { key: 'review.progress', label: '进步', clip: 50 },
  { key: 'review.shortcomings', label: '不足', clip: 50 },
  { key: 'review.improvements', label: '改进', clip: 50 },
  { key: 'review.other', label: '其他', clip: 50 },
  { key: 'gratitude.items', label: '🙏 感恩', clip: 40, list: true }
];
/* 这些顶层键**不算「没登记的新字段」**：它们不是给人看的正文，
   或者已经由 rows / feedback 表达过了。planSnapshot 是当天的计划快照，
   feedback 拆成了一行，review / gratitude 走 rows。 */
const DIARY_NON_TEXT_KEYS = ['plan', 'planSnapshot', 'review', 'feedback', 'gratitude'];
/* 反馈栏的字段顺序与中文名（压成一行显示） */
const DIARY_FEEDBACK_SPEC = [
  { key: 'sleepTime', label: '睡' },
  { key: 'wakeTime', label: '醒' },
  { key: 'sleepQuality', label: '睡眠' },
  { key: 'mentalState', label: '精神' }
];

/* 截断：超长补省略号。中文按「字」算，不按字节 —— 这里只做显示，不参与统计。 */
function clipText(s, n) {
  const t = String(s == null ? '' : s);
  if (!n || t.length <= n) return t;
  return t.slice(0, n) + '…';
}
/* 按 'a.b' 取嵌套值，任一层缺失都返回 undefined（不抛） */
function diaryFieldAt(obj, path) {
  const parts = String(path || '').split('.');
  let v = obj;
  for (let i = 0; i < parts.length; i++) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[parts[i]];
  }
  return v;
}
/* 数组 → 一行短句（逐条 trim 丢空，各自截断后用 · 连起来） */
function diaryListText(arr, clip) {
  if (!Array.isArray(arr)) return '';
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const t = String(arr[i] == null ? '' : arr[i]).trim();
    if (t) out.push(clipText(t.replace(/\s*\n+\s*/g, ' '), clip));
  }
  return out.join(' · ');
}
function diaryOverviewParts(d) {
  const entry = d && typeof d === 'object' ? d : {};
  const rows = [];
  for (let i = 0; i < DIARY_FIELD_SPEC.length; i++) {
    const f = DIARY_FIELD_SPEC[i];
    const raw = diaryFieldAt(entry, f.key);
    let text = '';
    if (f.list) {
      text = diaryListText(raw, f.clip);
    } else {
      const s = String(raw == null ? '' : raw).trim();
      /* 多行正文压成一行：总览是「扫一眼」的地方，不是读日记的地方 */
      if (s) text = clipText(s.replace(/\s*\n+\s*/g, ' · '), f.clip);
    }
    if (text) rows.push({ label: f.label, text: text });
  }
  /* 今日反馈：只拼填过的项 */
  const fb = entry.feedback && typeof entry.feedback === 'object' ? entry.feedback : {};
  const bits = [];
  for (let i = 0; i < DIARY_FEEDBACK_SPEC.length; i++) {
    const f = DIARY_FEEDBACK_SPEC[i];
    const v = fb[f.key];
    const s = String(v == null ? '' : v).trim();
    if (s) bits.push(f.label + ' ' + clipText(s, 12));
  }
  const feedback = bits.length ? (fb.sleepDay === 'today' ? '🌙 ' : '😴 ') + bits.join(' · ') : '';
  /* 兜底：未登记的顶层字段。字符串/数组原样短显示，对象只报条数 ——
     目的不是排版好看，是「有东西就说有东西」，绝不再静默吞掉。 */
  const extra = [];
  const keys = Object.keys(entry);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (DIARY_NON_TEXT_KEYS.indexOf(k) >= 0) continue;
    const v = entry[k];
    if (v == null) continue;
    let text = '';
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) text = clipText(s.replace(/\s*\n+\s*/g, ' · '), 40);
    } else if (Array.isArray(v)) {
      text = diaryListText(v, 20);
    } else if (typeof v === 'object') {
      const inner = Object.keys(v).length;
      if (inner) text = '（' + inner + ' 项）';
    } else {
      text = clipText(String(v), 20);
    }
    if (text) extra.push({ label: k, text: text });
  }
  return { rows: rows, feedback: feedback, extra: extra };
}
/* 双模导出 */
/* 记录级全局唯一 ID（数据契约，2026-10-23）。
   为什么不用 Date.now() 当唯一键：多端同时创建会撞车，同步时两条不同记录被当成同一条。
   形状：<prefix>_<时间base36>_<随机6位>[_<设备短码>]，对 UI 不透明，只做标识、不参与展示与排序。
   ★ 不替换现有数值 id：id 仍被 200+ 处引用（idArg / idEq / 排序 / URL 参数），
     只加并列字段，风险最小、收益一样。 */
function newUid(prefix) {
  var tag = (typeof window !== 'undefined' && window.__deviceTag) || '';
  return String(prefix || 'x') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + (tag ? '_' + tag : '');
}

/* ===== 同步合并规则（纯函数，2026-10-23）=====================================
 * 为什么放在纯函数层：这是唯一「接后端时最容易写错、又最难在浏览器里复现」的一段逻辑。
 * 放在这里 = Node 单测可覆盖 = 不会等上线才发现「删除被复活 / 旧值覆盖新值」。
 *
 * 三条规则，按优先级：
 *   ① 墓碑优先：只要 uid 在墓碑里，就判删除 —— 用户点过删除，之后任何更新都不该让它复活；
 *   ② 记录级 LWW：updatedAt 大的赢（相等时保留本地，避免无意义的抖动）；
 *   ③ 未知形状不合并：缺 uid 的远端记录直接丢弃（服务端不该产生这种数据，
 *      真出现了说明协议错位，宁可少一条也不要把脏数据灌进本地）。
 * ========================================================================= */

/* 单条比较：'local' | 'remote' | 'same'
   local/remote 任一方缺失时，另一方直接胜（新增 / 删除后的残留）。 */
function lwwPick(localRec, remoteRec) {
  var hasL = !!(localRec && typeof localRec === 'object');
  var hasR = !!(remoteRec && typeof remoteRec === 'object');
  if (!hasL && !hasR) return 'same';
  if (!hasL) return 'remote';
  if (!hasR) return 'local';
  var tl = Number(localRec.updatedAt) || 0;
  var tr = Number(remoteRec.updatedAt) || 0;
  if (tl === tr) return 'same';
  return tr > tl ? 'remote' : 'local';
}

/* 把远端一批记录并进本地列表。返回 { list, added, updated, skipped }。
   ★ 不修改入参（纯函数）：调用方拿到新数组再替换 appData 里的字段，
     这样「合并失败」永远不会把本地数据搞成半截状态。 */
function mergeRemoteRecords(localList, remoteList, tombstones) {
  var locals = Array.isArray(localList) ? localList : [];
  var remotes = Array.isArray(remoteList) ? remoteList : [];
  var tombs = Array.isArray(tombstones) ? tombstones : [];

  /* ★ 字典一律 Object.create(null)：uid 来自远端/备份，是**用户可控输入**。
     用普通 {} 时 uid="__proto__" 会命中 Object.prototype 那条链：
       - tombOf["__proto__"] 永远 !== undefined → 该记录被判"已删除"，静默丢弃；
       - byUid["__proto__"] 拿到 Object.prototype → 把**原型对象**当成一条记录塞进结果；
       - mergeTombstoneLists 里更直接：读 .deletedAt 抛 TypeError，整次同步失败。
     项目里 deepSanitize 早就在防原型污染，这里不能成为新的缺口。
     （实证见 C115：四条断言分别对应上面三种表现。） */
  var tombOf = Object.create(null);
  tombs.forEach(function (t) {
    if (t && t.uid) tombOf[String(t.uid)] = Number(t.deletedAt) || 0;
  });

  var byUid = Object.create(null);
  var order = [];
  var kept = [];                       /* 无 uid 的本地记录：原样保留，不参与合并 */
  locals.forEach(function (r) {
    if (!r) return;
    if (!r.uid) { kept.push(r); return; }
    var k = String(r.uid);
    /* ★ 同 uid 只在 order 里占一次位：否则输出两份**同一个对象引用**，
       界面上同一条记录显示两次，而且改一处两处都变。 */
    if (!byUid[k]) { byUid[k] = r; order.push(k); }
  });

  var added = 0, updated = 0, skipped = 0;
  remotes.forEach(function (r) {
    if (!r || !r.uid) { skipped++; return; }           /* 缺 uid：协议错位，丢弃 */
    var k = String(r.uid);
    /* ① 墓碑优先：删过的，任何远端更新都不接 */
    if (tombOf[k] !== undefined) { skipped++; return; }
    var cur = byUid[k];
    if (!cur) { byUid[k] = r; order.push(k); added++; return; }
    /* ② 记录级 LWW */
    if (lwwPick(cur, r) === 'remote') { byUid[k] = r; updated++; }
    else skipped++;
  });

  var out = [];
  order.forEach(function (k) {
    var rec = byUid[k];
    if (!rec) return;
    /* ① 本地这条若已被墓碑标记，也要移除（另一端删的，这边得跟着删） */
    if (tombOf[String(rec.uid)] !== undefined) return;
    out.push(rec);
  });
  /* ★ 无 uid 的本地老记录必须原样留在结果里：
     本函数不该假设「调用方一定已经迁移过」。丢一条就是丢一条用户数据，
     而它只会出现在「迁移之前就被同步触发」的窄窗口里 —— 越难复现越不能赌。 */
  return { list: kept.concat(out), added: added, updated: updated, skipped: skipped };
}

/* 墓碑并集（与 01b 的 mergeTombstones 同语义，纯函数版供单测与同步层共用）：
   同 uid 保留更晚的 deletedAt，按时间裁到 max 条。 */
function mergeTombstoneLists(a, b, max) {
  var cap = Number(max) > 0 ? Number(max) : 2000;
  var idx = Object.create(null), out = [];
  function push(x) {
    if (!x || !x.uid) return;
    var k = String(x.uid);
    var t = Number(x.deletedAt) || 0;
    if (idx[k] === undefined) { idx[k] = out.length; out.push({ uid: k, kind: x.kind || 'record', deletedAt: t }); }
    else if (t > out[idx[k]].deletedAt) {
      out[idx[k]].deletedAt = t;
      if (x.kind) out[idx[k]].kind = x.kind;
    }
  }
  (Array.isArray(a) ? a : []).forEach(push);
  (Array.isArray(b) ? b : []).forEach(push);
  if (out.length > cap) {
    out.sort(function (x, y) { return x.deletedAt - y.deletedAt; });
    out = out.slice(-cap);
  }
  return out;
}

/* 变更队列的合并/裁剪（纯函数）：同 uid 只留最后一次，超过 cap 裁最旧。
   why 合并而不是全部保留：一次编辑会连打多次 touch（自动保存 5 秒一次），
   不合并的话队列里十条有九条是同一条记录的中间态，推上去只是浪费。 */
function outboxMerge(list, uid, kind, op, at, cap) {
  var arr = Array.isArray(list) ? list.slice() : [];
  var limit = Number(cap) > 0 ? Number(cap) : 2000;
  var hit = -1;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && idEq(arr[i].uid, uid)) { hit = i; break; }
  }
  var rec = { uid: String(uid), kind: kind || 'record', op: op || 'upsert', at: Number(at) || 0 };
  if (hit >= 0) arr.splice(hit, 1);
  arr.push(rec);
  if (arr.length > limit) arr = arr.slice(-limit);
  return arr;
}

(function (g) {
  let api = {
    clipText: clipText,
    diaryFieldAt: diaryFieldAt,
    diaryOverviewParts: diaryOverviewParts,
    DIARY_FIELD_SPEC: DIARY_FIELD_SPEC,
    getTodayStr: getTodayStr,
    getTodayStr: getTodayStr,
    fmtTime: fmtTime,
    getDateStr: getDateStr,
    calcPomos: calcPomos,
    todoEstDurationMin: todoEstDurationMin,
    parseLocalDT: parseLocalDT,
    addMinutesToLocal: addMinutesToLocal,
    normDT: normDT,
    dtToInput: dtToInput,
    todoEstAuto: todoEstAuto,
    todoEstInfo: todoEstInfo,
    todoEstEnd: todoEstEnd,
    todoPomosForMinutes: todoPomosForMinutes,
    /* 计划重复周期（纯规则运算，见文件上方注释块） */
    dateStrToDate: dateStrToDate,
    addDaysStr: addDaysStr,
    daysBetweenStr: daysBetweenStr,
    daysInMonth: daysInMonth,
    isoWeekday: isoWeekday,
    normTodoRepeat: normTodoRepeat,
    todoRepeatMatches: todoRepeatMatches,
    todoOccursOn: todoOccursOn,
    nextTodoRepeatDate: nextTodoRepeatDate,
    todoRepeatExpired: todoRepeatExpired,
    todoRepeatLabel: todoRepeatLabel,
    todoEstPomos: todoEstPomos,
    todoBlocksOf: todoBlocksOf,
    todoValidSubs: todoValidSubs,
    todoSubProgress: todoSubProgress,
    todoSchedSnapshotOn: todoSchedSnapshotOn,
    todoScheduleLines: todoScheduleLines,
    /* 计划页「备忘」留言板（保留期规则） */
    MEMO_RETENTION_OPTIONS: MEMO_RETENTION_OPTIONS,
    MEMO_RETENTION_DEFAULT: MEMO_RETENTION_DEFAULT,
    MEMO_TEXT_MAX: MEMO_TEXT_MAX,
    memoRetentionMeta: memoRetentionMeta,
    normMemo: normMemo,
    normMemoList: normMemoList,
    memoSplitByRetention: memoSplitByRetention,
    memoDaysLeft: memoDaysLeft,
    /* 时间块计划板（几何/多轨布局） */
    TB_SLOT_MIN: TB_SLOT_MIN,
    TB_DAY_MINUTES: TB_DAY_MINUTES,
    TB_MIN_SPAN_MIN: TB_MIN_SPAN_MIN,
    TB_DRAW_MIN_MIN: TB_DRAW_MIN_MIN,
    TB_MAX_LANES: TB_MAX_LANES,
    TB_GRID_SLOT_MIN: TB_GRID_SLOT_MIN,
    TB_GRID_ROWS: TB_GRID_ROWS,
    TB_GRID_BANDS: TB_GRID_BANDS,
    TB_GRID_LANES: TB_GRID_LANES,
    tbGridCellOf: tbGridCellOf,
    tbGridMinOf: tbGridMinOf,
    tbGridRange: tbGridRange,
    tbGridCellsOf: tbGridCellsOf,
    tbGridSameCol: tbGridSameCol,
    tbHHMMToMin: tbHHMMToMin,
    tbMinToHHMM: tbMinToHHMM,
    tbHourLabel: tbHourLabel,
    tbSnapMin: tbSnapMin,
    tbSlotCount: tbSlotCount,
    tbBlockOf: tbBlockOf,
    /* 多段排期：额外段 + 一条计划 N 个块的唯一取数口径 */
    TODO_EXTRA_MAX: TODO_EXTRA_MAX,
    TODO_EXTRA_MIN_MIN: TODO_EXTRA_MIN_MIN,
    normExtraBlocks: normExtraBlocks,
    todoExtraBlocksOn: todoExtraBlocksOn,
    todoBlockDates: todoBlockDates,
    todoFirstBlockDate: todoFirstBlockDate,
    todoHistSchedDate: todoHistSchedDate,
    todoHasAnyBlock: todoHasAnyBlock,
    /* 重复计划的「按天单独排期」 */
    TODO_DAYPLAN_MAX_DAYS: TODO_DAYPLAN_MAX_DAYS,
    HABIT_DAYPLAN_MAX_DAYS: HABIT_DAYPLAN_MAX_DAYS,
    dayPlanNormAll: dayPlanNormAll,
    todoDayPlanNormAll: todoDayPlanNormAll,
    todoDayPlanOn: todoDayPlanOn,
    tbBlocksOf: tbBlocksOf,
    tbPrimaryBlockKey: tbPrimaryBlockKey,
    TODO_SCHED_LOG_MAX_PER_DAY: TODO_SCHED_LOG_MAX_PER_DAY,
    TODO_SCHED_LOG_KEEP_DAYS: TODO_SCHED_LOG_KEEP_DAYS,
    pruneTodoSchedLog: pruneTodoSchedLog,
    todoMainDateOf: todoMainDateOf,
    todoSchedSnapshotOf: todoSchedSnapshotOf,
    todoSchedPseudoTodo: todoSchedPseudoTodo,
    todoSchedPseudoTodos: todoSchedPseudoTodos,
    tbUnplannedSegments: tbUnplannedSegments,
    tbAuthScaleSegs: tbAuthScaleSegs,
    tbAssignLanes: tbAssignLanes,
    /* 森林（长期养成） */
    FOREST_TREE_LEVELS: FOREST_TREE_LEVELS,
    FOREST_MILESTONES: FOREST_MILESTONES,
    FOREST_RECENT_DAYS: FOREST_RECENT_DAYS,
    FOREST_ICONS_PER_DAY: FOREST_ICONS_PER_DAY,
    forestTreeOf: forestTreeOf,
    forestTreeLevelOf: forestTreeLevelOf,
    forestTreesPerRecord: forestTreesPerRecord,
    FOREST_TREES_MAX: FOREST_TREES_MAX,
    forestFromRecords: forestFromRecords,
    forestMilestones: forestMilestones,
    /* 四象限：分类常量 + 归一化 + 排序权重 */
    TODO_QUADS: TODO_QUADS,
    normQuad: normQuad,
    quadMeta: quadMeta,
    quadRank: quadRank,
    /* 习惯统计 */
    HABIT_WINDOW_DAYS: HABIT_WINDOW_DAYS,
    HABIT_FREQ_DEFAULT: HABIT_FREQ_DEFAULT,
    habitFreqPerWeek: habitFreqPerWeek,
    habitRepeatOf: habitRepeatOf,
    habitDueOn: habitDueOn,
    habitIntervalPlan: habitIntervalPlan,
    habitIsQuota: habitIsQuota,
    habitQuotaDueOn: habitQuotaDueOn,
    habitSkipSet: habitSkipSet,
    normHabitSkips: normHabitSkips,
    weekStartStr: weekStartStr,
    habitSkippedOn: habitSkippedOn,
    habitHiddenOn: habitHiddenOn,
    habitStreakUnit: habitStreakUnit,
    habitRepeatLabel: habitRepeatLabel,
    habitExpectedIn: habitExpectedIn,
    habitCurrentStreak: habitCurrentStreak,
    habitBestStreak: habitBestStreak,
    habitStats: habitStats,
    habitGrowthPoints: habitGrowthPoints,
    recentDateStrs: recentDateStrs,
    /* 艾宾浩斯复习 */
    EBBINGHAUS_INTERVALS: EBBINGHAUS_INTERVALS,
    EBBINGHAUS_GRADUATED: EBBINGHAUS_GRADUATED,
    REVIEW_GRADES: REVIEW_GRADES,
    reviewGradeMeta: reviewGradeMeta,
    ebIntervalDays: ebIntervalDays,
    ebStageName: ebStageName,
    ebReview: ebReview,
    ebIsDue: ebIsDue,
    ebIsGraduated: ebIsGraduated,
    ebGraduateReason: ebGraduateReason,
    ebRestoreState: ebRestoreState,
    REPEAT_WEEK_CN: REPEAT_WEEK_CN,
    getPomos: getPomos,
    isLogRecord: isLogRecord,
    lotteryQuotaOf: lotteryQuotaOf,
    lotteryAvailFrom: lotteryAvailFrom,
    TREE_AGE_TIERS: TREE_AGE_TIERS,
    dateStrToTs: dateStrToTs,
    treeAgeDays: treeAgeDays,
    treeAgeYears: treeAgeYears,
    treeAgeTierOf: treeAgeTierOf,
    treeAgeTierByDays: treeAgeTierByDays,
    addYearsToDate: addYearsToDate,
    rangeStatsFrom: rangeStatsFrom,
    isPomodoroRecord: isPomodoroRecord,
    typeLabel: typeLabel,
    /* CSV 表格（记录 → 表头 + 行，唯一定义处） */
    csvCell: csvCell,
    planSubsText: planSubsText,
    recordsCsvTable: recordsCsvTable,
    computeRoundStats: computeRoundStats,
    mergeLogRecords: mergeLogRecords,
    fmtTomatoNum: fmtTomatoNum,
    pomosToMinutes: pomosToMinutes,
    fmtHM: fmtHM,
    fmtTime: fmtTime,
    fmtClockHM: fmtClockHM,
    clockHour12: clockHour12,
    setHour12: setHour12,
    deepSanitize: deepSanitize,
    /* id 工具：内联 handler 安全嵌入 + 跨类型 id 容错比较 */
    idArg: idArg,
    idEq: idEq,
    findSubById: findSubById,
    /* 常量一并导出：未来给 calcPomos 补单测时用常量表达期望值，禁止写死 1500 */
    POMO_BASE_SECONDS: POMO_BASE_SECONDS,
    FONT_SCALE_STEPS: FONT_SCALE_STEPS,
    FONT_SCALE_MIN: FONT_SCALE_MIN,
    FONT_SCALE_MAX: FONT_SCALE_MAX,
    fontScaleMeta: fontScaleMeta,
    normFontScale: normFontScale,
    /* 习惯分类（展开的文件夹）+ 计划子任务快照 */
    HABIT_CAT_UNGROUPED: HABIT_CAT_UNGROUPED,
    HABIT_CAT_NAME_MAX: HABIT_CAT_NAME_MAX,
    habitCatOf: habitCatOf,
    normHabitCatName: normHabitCatName,
    normHabitCats: normHabitCats,
    habitCatGroups: habitCatGroups,
    HABIT_SUB_TEXT_MAX: HABIT_SUB_TEXT_MAX,
    habitSubsOf: habitSubsOf,
    normHabitSubText: normHabitSubText,
    normHabitSubDate: normHabitSubDate,
    normHabitSubTime: normHabitSubTime,
    normHabitSubs: normHabitSubs,
    normHabitBlocks: normHabitBlocks,
    habitBlocksOf: habitBlocksOf,
    habitBlocksOn: habitBlocksOn,
    habitDayPlanNormAll: habitDayPlanNormAll,
    habitDayPlanOn: habitDayPlanOn,
    hmToMin: hmToMin,
    minToHM: minToHM,
    normHabitHM: normHabitHM,
    habitSubsOn: habitSubsOn,
    habitSubsDoneOn: habitSubsDoneOn,
    PLAN_SUB_SNAPSHOT_MAX: PLAN_SUB_SNAPSHOT_MAX,
    LOG_PLAN_SUB_SHOW_MAX: LOG_PLAN_SUB_SHOW_MAX,
    snapshotPlanSubs: snapshotPlanSubs,
    planSubsSummaryText: planSubsSummaryText,
    REVIEW_GRADE_MASTERED: REVIEW_GRADE_MASTERED,
    LOG_MERGE_GAP_SECONDS: LOG_MERGE_GAP_SECONDS,
    LOG_MERGE_OVERLAP_TOL_SEC: LOG_MERGE_OVERLAP_TOL_SEC,
    LOG_DUP_TOLERANCE_SEC: LOG_DUP_TOLERANCE_SEC,
    POMO_DEFAULT_MINUTES: POMO_DEFAULT_MINUTES,
    MIN_FULL_MINUTES: MIN_FULL_MINUTES,
    DAY_MS: DAY_MS,
    POMO_ALMOST_FULL_MINUTES: POMO_ALMOST_FULL_MINUTES,
    COIN_EVERY_MINUTES: COIN_EVERY_MINUTES,
    /* 金币账本（余额 + 流水）纯函数 —— 记账入口在 01d3 的 coinEarn/coinSpend */
    COIN_TX_TYPES: COIN_TX_TYPES,
    coinTxTypeLabel: coinTxTypeLabel,
    coinTxNewId: coinTxNewId,
    coinTxMake: coinTxMake,
    coinLedgerSum: coinLedgerSum,
    coinLedgerDiff: coinLedgerDiff,
    coinTxUndoable: coinTxUndoable,
    coinLedgerTrim: coinLedgerTrim,
    /* 金币收益乘数链（时长档位 × 连续加成 × buff） */
    COIN_EARN_TUNING: COIN_EARN_TUNING,
    coinDurBase: coinDurBase,
    coinStreakMult: coinStreakMult,
    coinEarnFinal: coinEarnFinal,
    /* 数据契约：全局唯一 ID 生成 */
    newUid: newUid,
    /* 同步合并（纯函数，Node 可测） */
    lwwPick: lwwPick,
    mergeRemoteRecords: mergeRemoteRecords,
    mergeTombstoneLists: mergeTombstoneLists,
    outboxMerge: outboxMerge
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  g.__pure = api;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
