/* ============================================================
 * 01d3 · 树商店 / 金币经济 / 道具 / 皮肤 / 扭蛋 / 运势 / 树种
 * 函数索引（TOC）：skinPriceWithSurcharge/getSkinTier/getSkinPurchaseCount/bumpSkinPurchaseCount/getSkinDef/getSkin/skinIsActive/safeSkinUrl/skinRemainDays/addLotteryChance/syncLotteryCount/getWeekCoinExchanged（+62 更多）
 * ============================================================ */
/* ===== 道具库存系统 ===== */
/* ===== 周番茄兑金币：1 周番茄 = 6 金币，每周最多兑 120 金币。
   只消耗「可消耗余额」（getSpendableTomatoes），计入 weekTomatoSpent 消耗池，
   原始统计 getWeekTomatoPoints 不变 → 段位/统计/海报照常 ===== */
/* ================= 自定义皮肤（上传类商品）· 参数集中配置 =================
   两个商品：treebg=自定义树木背景 / wallpaper=计时器壁纸
    两商品统一阶梯定价（按各自历史购买次数计）：
     第1次 50币/7天 → 第2次 500币/7天 → 第3次起 2000币/月
    皮肤是「对外宣传固定价」的商品（2000🪙/月），【不走】商店动态定价（getDynamicMult），
     保证用户攒到 4000/6000 也不会突然变贵；仅在余额 ≥8000🪙 时小额上浮 10%（见下）。 */
const SKIN_DAYS = 30; /* 常规档有效期（天）：到期自动清除图片数据，释放存储 */
/* 阶梯定价表：按购买次数（0=从未买过）查表，返回 {price, days} */
const SKIN_TIER_TABLE = [
  { price: 50, days: 7 } /* 第1次：50币体验7天 */,
  { price: 500, days: 7 } /* 第2次：500币体验7天 */,
  { price: 2000, days: 30 } /* 第3次及以后：2000币/月 */
];
/* 皮肤「高余额小额上浮」：余额 ≥8000🪙 时，档位价仅 ×1.1（2000→2200），且不再随余额继续涨 */
const SKIN_SURCHARGE_AT = 8000;
const SKIN_SURCHARGE_MULT = 1.1;
function skinPriceWithSurcharge(basePrice) {
  const coins = (appData.tree && appData.tree.coins) || 0;
  if (coins >= SKIN_SURCHARGE_AT) return Math.max(basePrice, Math.round((basePrice * SKIN_SURCHARGE_MULT) / 5) * 5);
  return basePrice;
}
function getSkinTier(count) {
  if (count <= 0) return SKIN_TIER_TABLE[0];
  if (count === 1) return SKIN_TIER_TABLE[1];
  return SKIN_TIER_TABLE[2];
}
/* 各自历史购买次数（决定下次价格档）：treebg / wallpaper 分开计数 */
function getSkinPurchaseCount(kind) {
  const key = kind === 'treebg' ? 'treebgPurchaseCount' : 'wallpaperPurchaseCount';
  return appData.tree && typeof appData.tree[key] === 'number' ? appData.tree[key] : 0;
}
function bumpSkinPurchaseCount(kind) {
  const tr = appData.tree;
  if (!tr) return;
  const key = kind === 'treebg' ? 'treebgPurchaseCount' : 'wallpaperPurchaseCount';
  if (typeof tr[key] !== 'number') tr[key] = 0;
  tr[key]++;
}
/* 图片一律走图床链接：本地只存一个 URL 字符串，不占存储、不进备份。
   显示时由 CSS background-size:cover 自动按区域比例铺满并裁切，不会拉伸变形。 */
const SKIN_KINDS = [
  { key: 'treebg', name: '自定义树木背景', icon: '🌳', field: 'customTreeBg' },
  { key: 'wallpaper', name: '计时器壁纸', icon: '🪟', field: 'customWallpaper' }
];
function getSkinDef(kind) {
  return (
    SKIN_KINDS.filter(function (k) {
      return k.key === kind;
    })[0] || SKIN_KINDS[0]
  );
}
function getSkin(kind) {
  const tr = appData.tree;
  if (!tr) return { data: '', expires: 0, blur: 0, opacity: 1, updatedAt: 0 };
  const f = getSkinDef(kind).field;
  if (!tr[f] || typeof tr[f] !== 'object')
    tr[f] = {
      data: '',
      expires: 0,
      blur: kind === 'wallpaper' ? 8 : 0,
      opacity: kind === 'wallpaper' ? 0.55 : 1,
      updatedAt: 0
    };
  return tr[f];
}
function skinIsActive(kind) {
  const sk = getSkin(kind);
  return !!(sk.data && sk.expires && sk.expires > Date.now());
}
/* 皮肤 URL 严格白名单——sk.data 会拼进 innerHTML 的 style 属性（皮肤预览）与
   style.backgroundImage（树/计时页）。提交入口的旧正则只排除空白，备份导入路径更是零校验：
   恶意备份可写入含 " 的 data 值逃逸 style 属性注入任意 HTML（XSS）。
   白名单放行 URL 常用字符，禁掉 " ' ( ) < > 反斜杠 与全部空白；
   业务上 sk.data 唯一合法来源就是 http(s) 图床链接，非法一律视为无皮肤。 */
const SKIN_URL_SAFE_RE = /^https?:\/\/[\w\-./:%?&=#~+@!$,;*[\]]+$/i;
function safeSkinUrl(u) {
  return typeof u === 'string' && SKIN_URL_SAFE_RE.test(u) ? u : '';
}
function skinRemainDays(kind) {
  const sk = getSkin(kind);
  if (!sk.expires) return 0;
  return Math.max(0, Math.ceil((sk.expires - Date.now()) / DAY_MS));
}
/* ================= 金币经济参数（集中配置） =================
   调平衡只改这里的数就行：分散在满文件里找会漏。
   注意产出端与消耗端要一起调 —— 只压产出会把商店动态定价顶到封顶，仍然抑制不住收入。 */
const COIN_ALBUM_REWARD = 150; /* 成长图鉴集齐（每树种）      原 500 */
const COIN_TITLE_REWARD = 30; /* 植物称号进步（每次）        原 100 */
const COIN_RANKUP_REWARD = 20; /* 段位晋级                    原 50  */
const COIN_MYSTERY_REWARD = 8; /* 神秘任务（每项，每天 3 个）  原 20  */
const COIN_MUSTDO_REWARD = 25; /* 必做三件事（每天 1 次）      原 50  */
const COIN_DAILYTASK_REWARD = 6; /* 每日任务（每项，每天 3 项）  原 10  */
const GACHA_STEP = 4; /* 扭蛋触发间隔：第 4/8 个🍅    原 3/6/9 */
const LOT_PER_DRAW = 2; /* 每 2 个🍅 换 1 次抽奖机会    原 1 个 1 次 */
/* 抽奖额度唯一口径见 00_pure_core 的 lotteryQuotaOf / lotteryAvailFrom：
   额度由 records 现算 = floor(Σround(pomos) / LOT_PER_DRAW)，再减去已抽掉的 lotteryUsed。
   不存「已发次数」计数器 —— 计数器删记录不回滚，「补记→删除」就能无限刷。
   本函数保留为空壳：结算/补记的调用点、渐进解锁门禁（gateSingle）都依赖这个名字存在。 */
function addLotteryChance(pomos) {
  if (typeof pomos !== 'number') return; /* 参数保留，语义已迁移到 syncLotteryCount */
}
/* 把派生额度写回 tr.lotteryCount（UI 的 ×N 与抽奖判断都读这个字段）。 */
function syncLotteryCount() {
  const tr = appData.tree;
  if (!tr) return 0;
  if (typeof tr.lotteryUsed !== 'number' || isNaN(tr.lotteryUsed)) tr.lotteryUsed = 0;
  const n = lotteryAvailFrom(appData.records, tr.lotteryUsed, LOT_PER_DRAW);
  tr.lotteryCount = n;
  return n;
}
const COIN_EX_RATE = 6; /* 1 个本周番茄 = 6 金币（原 10，经济再平衡下调） */
const COIN_EX_WEEK_MAX = 120; /* 每周最多兑换 120 金币（原 200，经济再平衡下调） */
function getWeekCoinExchanged() {
  const ws = getWeekStartStr();
  const tr = appData.tree;
  if (!tr) return 0;
  if (tr.weekCoinExchangedWeek !== ws) {
    tr.weekCoinExchanged = 0;
    tr.weekCoinExchangedWeek = ws;
  }
  const v = tr.weekCoinExchanged || 0;
  /* 上限下调后，老用户本周已兑数可能超过新上限（如按 10币/🍅 兑过 195），封顶后显示才不自相矛盾 */
  return Math.min(v, COIN_EX_WEEK_MAX);
}
/* 可兑换额度 = 周完成 - 全部已消耗（段位下注+商店道具卡+已兑换），与道具卡共用池子不重复 */
function getExchangeAvail() {
  return Math.max(0, getWeekTomatoPoints() - countWeekAllSpent() + (appData.rankSystem.extraWeekTomatoes || 0));
}
function doCoinExchange(n) {
  const tr = appData.tree;
  if (!tr) return;
  getWeekCoinExchanged();
  const avail = Math.floor(getExchangeAvail());
  const used = getWeekCoinExchanged();
  const canTrade = Math.min(avail, Math.floor(Math.max(0, COIN_EX_WEEK_MAX - used) / COIN_EX_RATE));
  if (canTrade <= 0) {
    /* 区分三种「兑不了」的原因，别一律说额度用完 */
    const extra = (appData.rankSystem && appData.rankSystem.extraWeekTomatoes) || 0;
    let msg;
    if (used >= COIN_EX_WEEK_MAX) {
      msg = '🪙 本周兑换额度已用完（已兑 ' + used + '/' + COIN_EX_WEEK_MAX + ' 🪙），下周一重置';
    } else if (avail <= 0) {
      msg =
        getWeekTomatoPoints() > 0 || extra > 0
          ? '🍅 番茄已经用完了（本周可消耗 0 个）——再完成几个完整🍅就能继续兑换'
          : '🍅 本周还没有可消耗的番茄——先完成几个完整🍅再来兑换';
    } else {
      msg = '🪙 剩余额度只剩 ' + (COIN_EX_WEEK_MAX - used) + ' 🪙，不足一份（' + COIN_EX_RATE + ' 🪙），下周再来';
    }
    UIFX.toast(msg);
    UIFX.closeModal('coinExchangeModal');
    return;
  }
  let qty = n;
  if (qty < 0) qty = canTrade; /* -1 = 全部可兑 */
  qty = Math.max(1, Math.min(qty, canTrade));
  const _lost = badgesAtRiskBySpend(qty);
  const coins = qty * COIN_EX_RATE;
  resetWeekTomatoSpentIfNeeded();
  tr.weekTomatoSpent = (tr.weekTomatoSpent || 0) + qty; /* 消耗可兑额度（与道具卡共用消耗池） */
  tr.weekCoinExchanged = used + coins;
  coinEarn(coins, 'exchange', qty + ' 个周番茄兑换');
  saveData();
  UIFX.toast('🔄 已兑换 ' + qty + ' 个周番茄 → ' + coins + ' 🪙（统计与海报不受影响）');
  if (_lost.length)
    UIFX.toast(
      '⚠️ ' +
        _lost
          .map(function (b) {
            return b.icon + b.name;
          })
          .join('、') +
        ' 因番茄消耗已熄灭（再完成几个🍅 可重新点亮）'
    );
  UIFX.closeModal('coinExchangeModal');
  /* 改用手写多路 render → 统一广播。
   * 原实现此处手写 5 行 renderTreeShop/renderTreeSection/renderWeeklyBadges/
   * renderRankSystem/renderStats，新增一处依赖就要回来补一行（漏刷根源）。
   * 现改为广播 store 事件 'tree.coins'，由各热区自行订阅（见 0D 脚本注册点）。 */
  if (window.store && window.store.emit) {
    try {
      window.store.emit('tree.coins');
    } catch (e) { if (window.__silent) window.__silent(e, '01d3:doCoinExchange'); }
  } else {
    UIFX.renderTreeShop();
    UIFX.renderTreeSection();
    UIFX.renderWeeklyBadges();
    UIFX.renderRankSystem();
    UIFX.renderStats();
  }
}
/* ================= 金币账本（余额 + 流水）· 全局唯一记账入口 =================
   @see ARCHITECTURE-DECISIONS.md #5（金币 = 余额 + 流水）
   为什么要有账本：此前金币只存一个余额，约 15 处直接 `tr.coins ±= n`，
   一旦对不上账，**没有任何线索能回答「这金币哪来的、被谁扣的」**，误发也退不回。
   现改为：所有余额变动**一律**走 coinEarn / coinSpend（唯一入口），每次变动同步落流水。
   余额仍是唯一真相（一切既有读取路径零改动）；流水是加性旁路 ——
   老存档没有 coinLog 也能跑，首次访问自动补一笔「期初结转」使账目自洽。

   ★ 新增金币来源 / 消耗时：调 coinEarn / coinSpend，**不许再直接写 tr.coins**。
     type 取 00_pure_core 的 COIN_TX_TYPES 键；meta 放可回溯的业务 id（todoId / recordId / 商品名）。 */

const COIN_LOG_MAX = 500; /* 账本上限（超出裁最旧；余额不受影响，只影响能翻查多久） */

/** 取账本数组（只保证存在，不做期初结转 —— 结转见 coinLedgerInit）。 */
function coinLedgerEnsure() {
  const tr = appData && appData.tree;
  if (!tr) return [];
  if (!Array.isArray(tr.coinLog)) tr.coinLog = [];
  return tr.coinLog;
}
/** 账本初始化（幂等）：老存档 / 导入备份只有余额没有流水时，补齐「期初结转」，
    使 Σ流水 ≡ 余额 恒成立。
    ★ 判据是**差额**（余额 − Σ流水），不是「账本是否为空」——
      记账是「先改余额、后落流水」两步，中间那一刻账本还是空的、余额却已变，
      用「空账本」当判据会把这笔入账误当成需要结转的历史余额：
      实测 120 元的入账被记成 opening 120 + earn 120 = 240，账目当场歪掉
      （audit_coinledger L2-② 抓到的就是这个）。
      改用差额补则**任何时刻调用都自洽**，且天然幂等。 */
function coinLedgerInit() {
  const tr = appData && appData.tree;
  if (!tr) return [];
  const log = coinLedgerEnsure();
  if (tr.coinLogInit) return log;
  tr.coinLogInit = true;
  const diff = coinLedgerDiff(log, tr.coins);
  if (diff !== 0) {
    const first = log[0];
    /* opening 必须排在**最前**（它是最早的历史），且 at 取比最早一笔更早，
       否则「按时间看账」时它会出现在中间，running balance 链读起来断裂。 */
    log.unshift(coinTxMake({
      type: 'opening', amount: diff, after: diff,
      at: first ? Number(first.at) - 1 : Date.now(),
      reason: '期初结转（记账功能上线时的余额）'
    }));
  }
  return log;
}
/** 落一条流水并裁剪（内部用）。 */
function coinLedgerPush(tx) {
  const log = coinLedgerEnsure();
  log.push(tx);
  if (log.length > COIN_LOG_MAX) coinLedgerCompact();
  return tx;
}
/** 账本压实：超过上限时把最旧的若干笔**合并成一条「结转」**放头部。
    不能直接丢掉旧笔 —— 丢掉的净额会让 Σ流水 ≠ 余额，对账从此永远报差额。
    合并成结转条是会计的标准做法：期间流水照常可查，更早的历史折成一个期初数。
    ★ 上限留 1 个位置给结转条，保证压实后长度 = COIN_LOG_MAX。 */
function coinLedgerCompact() {
  const log = appData.tree && appData.tree.coinLog;
  if (!Array.isArray(log) || log.length <= COIN_LOG_MAX) return;
  const keep = COIN_LOG_MAX - 1;
  const cutCount = log.length - keep;
  const cut = log.slice(0, cutCount);
  const last = cut[cut.length - 1];
  const carried = coinTxMake({
    type: 'opening', amount: coinLedgerSum(cut), after: last.after, at: last.at,
    reason: '结转（更早 ' + cutCount + ' 笔已合并）'
  });
  appData.tree.coinLog = [carried].concat(log.slice(cutCount));
}
/** 收入：余额 +n 并记流水。n<=0 直接忽略（防脏参数造出 0 元流水）。 */
function coinEarn(amount, type, reason, meta) {
  const n = Math.round(Number(amount) || 0);
  if (!appData || !appData.tree || n <= 0) return null;
  coinLedgerInit();
  appData.tree.coins = (Number(appData.tree.coins) || 0) + n; /* coin-write-allow: 账本唯一入账口 */
  return coinLedgerPush(coinTxMake({
    type: type, amount: n, reason: reason, meta: meta, after: appData.tree.coins
  }));
}
/** 支出：余额不足 → 返回 false 且**不记账**（调用方照旧自己判余额，这里是第二道闸）。 */
function coinSpend(amount, type, reason, meta) {
  const n = Math.round(Number(amount) || 0);
  if (!appData || !appData.tree || n <= 0) return false;
  coinLedgerInit();
  if ((Number(appData.tree.coins) || 0) < n) return false;
  appData.tree.coins = (Number(appData.tree.coins) || 0) - n; /* coin-write-allow: 账本唯一出账口 */
  coinLedgerPush(coinTxMake({
    type: type, amount: -n, reason: reason, meta: meta, after: appData.tree.coins
  }));
  return true;
}
/** 撤销某笔流水：写一条**反向流水**（不删原条目）—— 审计友好的做法：
    原记录与撤销记录都在，谁在何时撤的、撤的是哪笔一目了然。
    已花掉的钱退不回来（余额不够）→ 拒绝并返回 false。 */
function coinUndo(txId) {
  const log = coinLedgerInit();
  const id = String(txId);
  if (!coinTxUndoable(log, id)) return false;
  const hit = log.filter(function (t) { return String(t.id) === id; })[0];
  if (!hit) return false;
  const back = -hit.amount;
  /* 撤销一笔支出 = 退回金币（总能退）；撤销一笔收入 = 收回金币（余额得够） */
  if (back < 0 && (Number(appData.tree.coins) || 0) < Math.abs(back)) return false;
  appData.tree.coins = (Number(appData.tree.coins) || 0) + back; /* coin-write-allow: 撤销回滚 */
  coinLedgerPush(coinTxMake({
    type: 'undo', amount: back, after: appData.tree.coins, undoOf: id,
    reason: '撤销：' + (hit.reason || coinTxTypeLabel(hit.type)),
    meta: { undoneType: hit.type }
  }));
  saveData();
  return true;
}
/** 对账：{ sum, balance, diff }。diff≠0 = 账本与余额不一致（历史脏数据 / 导入异常 / 漏改的旧调用点）。 */
function coinLedgerCheck() {
  const log = coinLedgerInit();
  const balance = Number((appData.tree && appData.tree.coins) || 0);
  return { sum: coinLedgerSum(log), balance: balance, diff: coinLedgerDiff(log, balance) };
}
/** 强制对平：差额补成一条 'migrate' 流水（仅在确实对不上时写）。 */
function coinLedgerRebalance() {
  const r = coinLedgerCheck();
  if (r.diff === 0) return r;
  coinLedgerPush(coinTxMake({
    type: 'migrate', amount: r.diff, after: r.balance,
    reason: '对账修正（补记差额）'
  }));
  return coinLedgerCheck();
}

let ITEM_DEFS = {
  waterProtect: {
    name: '连续浇水保护卡',
    icon: '💧',
    price: 350,
    currency: 'coin',
    desc: '使用后，明天不浇水也不断连续浇水天数',
    type: 'protect'
  },
  streakProtect: {
    name: '连续天数保护卡',
    icon: '🔥',
    price: 18,
    currency: 'week',
    desc: '使用后，明天不完成番茄也不断连续天数',
    type: 'protect'
  },
  waterRecover: {
    name: '浇水恢复卡',
    icon: '♻️',
    price: 500,
    currency: 'coin',
    desc: '断掉后3天内使用，恢复连续浇水天数',
    type: 'recover'
  },
  streakRecover: {
    name: '连续天数恢复卡',
    icon: '🔄',
    price: 30,
    currency: 'week',
    desc: '断掉后3天内使用，恢复连续专注天数',
    type: 'recover'
  },
  renameCard: {
    name: '改名卡',
    icon: '✏️',
    price: 300,
    currency: 'coin',
    desc: '修改树的名字，每张可改一次（改名时自动消耗）',
    type: 'rename'
  },
  reviveStone: {
    name: '复活石',
    icon: '🪄',
    price: 600,
    currency: 'coin',
    desc: '枯死的树使用后原地复活（一次性；树没枯死不可用，可提前囤）',
    type: 'revive'
  }
};
function buyItem(id) {
  resetWeekTomatoSpentIfNeeded();
  let tr = appData.tree;
  let def = ITEM_DEFS[id];
  /* 保护卡限购：库存 + 待命中的合计最多 2 张，用完一张才能再买 */
  if (def.type === 'protect') {
    let _ak = id === 'waterProtect' ? 'activeWaterProtect' : 'activeStreakProtect';
    let _held = (tr.inventory[id] || 0) + (tr[_ak] ? 1 : 0);
    if (_held >= 2) {
      UIFX.toast('🛡️ ' + def.name + '已达持有上限（2 张），用掉一张才能再买');
      return;
    }
  }
  if (def.currency === 'coin') {
    const _realPrice = getDynamicPrice(def.price, tr.coins || 0);
    if ((tr.coins || 0) < _realPrice) {
      UIFX.toast('🪙 果实币不足（需 ' + _realPrice + '）');
      return;
    }
    coinSpend(_realPrice, 'prop', '道具卡：' + def.name);
  } else {
    let avail = getExchangeAvail(); /* 与段位/统计/金币兑换同口径：周完成 − 段位下注 − 商店已消耗 + 扭蛋额外🍅 */
    if (avail < def.price) {
      UIFX.toast('🍅 本周可用番茄不足（需 ' + def.price + '，当前 ' + Math.floor(avail) + '）');
      return;
    }
    tr.weekTomatoSpent = (tr.weekTomatoSpent || 0) + def.price;
  }
  tr.inventory[id] = (tr.inventory[id] || 0) + 1;
  saveData();
  UIFX.renderTreeShop();
  UIFX.toast('✅ 已购买 ' + def.name + '！已存入库存，点击"使用"才生效');
}
function useItem(id) {
  let tr = appData.tree;
  let def = ITEM_DEFS[id];
  if ((tr.inventory[id] || 0) <= 0) {
    UIFX.toast('库存不足');
    return;
  }
  if (def.type === 'rename') {
    UIFX.openTreeNameModal();
    return;
  } /* 改名卡：点使用直接弹出命名窗口，保存时自动消耗 */
  if (def.type === 'revive') {
    /* 复活石：树枯死时使用原地复活（不扣金币）；没枯死不消耗 */
    if (!appData.tree.dead) {
      UIFX.toast('🌳 树没有枯死，用不到复活石');
      return;
    }
    appData.tree.dead = false;
    appData.tree.deadDate = null;
    /* 复活退阶：按历史峰值退 N 阶，不"原样复活"、也不粗暴归零 */
    const _revivePts = reviveDegradePoints(appData.tree.peakPoints || 0);
    appData.tree.points = _revivePts;
    appData.tree.lastActiveDate = getTodayStr();
    appData.tree.species = 'tomato';
    appData.tree.speciesPoints = { tomato: _revivePts };
    appData.tree.plantedSpecies = ['tomato'];
    appData.tree.speciesLastActive = {};
    /* 复活保护期：复活后 7 天内不退化（否则低分树复活后一闲又死，600 金币打水漂） */
    appData.tree.reviveProtectUntil = addDaysStr(getTodayStr(), 7);
    appData.tree.inventory[id] = (appData.tree.inventory[id] || 0) - 1;
    saveData();
    UIFX.renderTreeShop();
    UIFX.renderTreeSection();
    UIFX.renderTimerTree();
    const _rs = getTreeStage(_revivePts);
    UIFX.toast('🪄 复活石生效！树复活到「' + _rs.emoji + ' ' + _rs.name + '」阶段');
    return;
  }
  let tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  let tds = getDateStr(tomorrow);
  if (def.type === 'protect') {
    let activeKey = id === 'waterProtect' ? 'activeWaterProtect' : 'activeStreakProtect';
    let protType = id === 'waterProtect' ? 'water' : 'streak';
    if (tr[activeKey] === tds) {
      UIFX.toast('明天已经在保护中了');
      return;
    }
    tr[activeKey] = tds;
    addProtectedDate(protType, tds);
    tr.inventory[id]--;
    UIFX.toast('🛡️ ' + def.name + '已激活！明天(' + tds + ')受保护');
  } else {
    /* 恢复卡立即生效 */
    let hist = tr.streakHistory || [];
    if (!hist.length) {
      UIFX.toast('暂无历史记录可恢复');
      return;
    }
    if (id === 'waterRecover') {
      let maxWS = 0;
      hist.forEach(function (h) {
        if (h.waterStreak > maxWS) maxWS = h.waterStreak;
      });
      if (maxWS <= 0) {
        UIFX.toast('没有可恢复的浇水连续记录');
        return;
      }
      tr.waterStreak = maxWS;
      let y = new Date();
      y.setDate(y.getDate() - 1);
      tr.lastWaterDate = getDateStr(y);
      tr.usedWaterRecoveries = (tr.usedWaterRecoveries || 0) + 1;
      UIFX.toast('✅ 浇水连续已恢复为 ' + maxWS + ' 天！');
    } else {
      let maxStreak = 0;
      hist.forEach(function (h) {
        if (h.streak > maxStreak) maxStreak = h.streak;
      });
      if (maxStreak <= 0) {
        UIFX.toast('没有可恢复的连续天数记录');
        return;
      }
      for (let i = 1; i <= maxStreak; i++) {
        let dd = new Date();
        dd.setDate(dd.getDate() - i);
        addProtectedDate('streak', getDateStr(dd));
      }
      tr.usedStreakRecoveries = (tr.usedStreakRecoveries || 0) + 1;
      UIFX.toast('✅ 连续天数已恢复为 ' + maxStreak + ' 天！');
    }
    tr.inventory[id]--;
  }
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
  UIFX.renderStats();
}
function cancelProtection(id) {
  let tr = appData.tree;
  let activeKey = id === 'waterProtect' ? 'activeWaterProtect' : 'activeStreakProtect';
  let protType = id === 'waterProtect' ? 'water' : 'streak';
  let ds = tr[activeKey];
  if (!ds) {
    UIFX.toast('当前没有激活的保护');
    return;
  }
  /* 待命式保护：直接取消退回 */
  if (ds === true) {
    tr[activeKey] = null;
    tr.inventory[id] = (tr.inventory[id] || 0) + 1;
    saveData();
    UIFX.renderTreeShop();
    UIFX.renderTreeSection();
    UIFX.renderStats();
    UIFX.toast('🛡️ 已取消保护待命，道具退回库存');
    return;
  }
  let today = getTodayStr();
  if (ds <= today) {
    UIFX.toast('保护日已到/已过，道具已生效使用，无法取消退回');
    return;
  }
  /* 从保护日期列表中移除 */
  let key = protType === 'water' ? 'waterProtectedDates' : 'streakProtectedDates';
  if (tr[key]) {
    let idx = tr[key].indexOf(ds);
    if (idx >= 0) tr[key].splice(idx, 1);
  }
  tr[activeKey] = null;
  /* 退还到库存 */
  tr.inventory[id] = (tr.inventory[id] || 0) + 1;
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
  UIFX.renderStats();
  UIFX.toast('已取消保护，道具已退回库存');
}
function getTreeMood() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tr = appData.tree;
  const lastActive = tr.lastActiveDate
    ? Math.floor((today - new Date(tr.lastActiveDate + 'T00:00:00')) / DAY_MS)
    : 999;
  const lastWater = tr.lastWaterDate ? Math.floor((today - new Date(tr.lastWaterDate + 'T00:00:00')) / DAY_MS) : 999;
  const days = Math.max(lastActive, lastWater);
  if (days <= 1) return { emoji: '😊', label: '精神饱满', fade: 0 };
  if (days <= 2) return { emoji: '🙂', label: '有点蔫', fade: 0.35 };
  if (days <= 4) return { emoji: '😟', label: '想你了', fade: 0.6 };
  return { emoji: '😢', label: '快枯萎了', fade: 0.85 };
}
/* 点击树的互动：晃动 + 气泡说话（按上下文） */
const TREE_TALKS = [
  '主人加油！🌱',
  '你专注的样子真好看✨',
  '再坚持一下，我陪你🍅',
  '一个番茄，一分成长📈',
  '今天也要好好喝水呀💧',
  '离下一阶段越来越近了🏆',
  '我在旁边看着你长大呢🌳',
  '每一次坚持都在悄悄改变你💪',
  '慢慢来，比较快🐢',
  '种一棵树最好的时间是十年前，其次是现在🌱',
  '你努力的样子会发光✨',
  '今天也辛苦啦，摸摸头😊',
  '专注的时候，世界都安静下来了🌙',
  '我把阳光都攒起来给你啦☀️',
  '等你完成这轮，我给你唱歌听🎵',
  '别怕，这条路我陪你走🌿',
  '深呼吸，放轻松～你已经很棒了',
  '哪怕只进步一点点，也是向前🚶',
  '我的叶子在为你摇旗呐喊🌿🎉',
  '再坚持一下下，胜利就在前方🏁',
  '专注是给未来最好的礼物🎁',
  '主人最厉害了！我超崇拜你的🌟',
  '亲亲抱抱举高高！再完成一个嘛💕',
  '你一动笔，全世界都安静了✨',
  '叮！你的小树来充电啦，摸摸头🔋',
  '辛苦啦辛苦啦，快奖励自己一个番茄🍅',
  '我在心里给你放小烟花🎆',
  '主人棒棒！今天也要闪闪发光呀✨',
  '靠着我休息一分钟，然后继续冲🏃',
  '你是我的光，我也是你的光呀🌞',
  '嘿嘿，偷看你认真工作的样子好心动💓',
  '加油加油！完成这个就抱抱你🤗',
  '我的小主人天下第一可爱😘',
  '再坚持 5 分钟，我请你吃糖糖🍬',
  '哗啦哗啦～我摇着叶子给你打拍子🎶',
  '今天也一点点变强了呢，真为你高兴🥰',
  '困了就眨眨眼，我在这儿呢👀',
  '摸摸树皮，是不是很踏实？这就是坚持的样子',
  '有我在，你永远不会是一个人🌳',
  /* —— 撒娇卖萌 —— */
  '主人，我今天有没有更可爱一点？🌷',
  '把耳朵凑过来，我偷偷告诉你个秘密：你超棒！🤫',
  '叮咚！您的树已开启撒娇模式，完成一个番茄可解锁更多～😝',
  '我好喜欢主人摸我的叶子，软软的～🍃',
  '主人主人，你看我一眼，我就开花给你看呀🌸',
  '抱抱！把我攒的运气都分给你🍀',
  '你是电你是光你是唯一的神话～（树式走音）🎤',
  '主人再摸一下嘛，就一下下～叶子都给你摸秃了啦🙈',
  '我今天的任务就是：夸你！夸你！还是夸你！🎉',
  '嘿嘿，主人认真工作的侧脸，我能看一整天💓',
  /* —— 腹黑吐槽 —— */
  '哼，又在玩手机？我可都看见了👀',
  '这位主人，您的树已看穿一切：今天打算拖延到几点？😏',
  '你再不浇水，我就要变成枯枝甩你脸上了（认真的）💢',
  '说好每天都来，结果呢？你的良心不会痛吗😤',
  '浇水！浇水！浇水！重要的事情说三遍！',
  '我建议你打开番茄计时，不然我可要闹了（叉腰）',
  '主人，拖延一时爽，明天火葬场，我替你着急呀～',
  '你的树冷笑一声：呵，又想白嫖我的成长值？',
  '再偷懒，我就把「咸鱼」两个字写在你脑门上（小声）',
  '摸我这么多次，倒是完成个番茄给我看看啊喂',
  '我叶子都竖起来了，你还在发呆？专心！🌿',
  '这位主人，您今天的专注时长……算了，我不说了😑',
  '我已经是小树啦🌳 可以为你遮风挡雨了',
  '我的树荫很舒服🌲 累了就来靠靠',
  '我连接着整个世界🌟 但最珍贵的还是你'
];
/* 分时段话术池：不同时间说不同的话（撒娇卖萌 + 腹黑混合） */
const TREE_TALKS_TIME = {
  midnight: [
    '夜深啦，再不睡，我可要去找你妈告状了🌙',
    '凌晨的专注我佩服，但熬夜我可要心疼了，去睡吧🛌',
    '夜猫子主人，你的树拒绝陪你修仙，快睡！😤',
    '都这个点了，是在等我给你唱摇篮曲吗？🎵'
  ],
  morning: [
    '早呀早呀！太阳都出来了，你怎么还赖床☀️',
    '新的一天！元气满满的树已上线，主人跟上～🌞',
    '清晨的番茄最甜了，来一个吗？🍅',
    '早！我连夜把露珠给你攒好啦，快起床看看💧'
  ],
  am: [
    '上午好呀～趁脑子清醒，先干掉一个番茄？💪',
    '都快中午了，你还没开始，我可要着急了😤',
    '上午的黄金时间，别浪费在刷手机上啦👀',
    '叮！您的树提醒：早上效率高，别磨蹭啦～'
  ],
  noon: [
    '到饭点啦！先吃饭再干活，身体最重要🍚',
    '午休一下下，下午才有力气继续冲～😴',
    '吃饱了吗？吃饱了就来个番茄消消食🍅',
    '下午计划好了吗？你的树已经准备好了🌿'
  ],
  afternoon: [
    '下午容易犯困，来杯水+一个番茄提提神☕',
    '再坚持一下，今天快过半啦，你的番茄完成几个了？',
    '下午好！阳光正好，正是专注的好时候✨',
    '犯困了吧？站起来伸个懒腰，我陪你继续🌳'
  ],
  evening: [
    '傍晚啦～今天的番茄还差几个？我帮你数数🍅',
    '夕阳超好看，快完成最后一个番茄，一起看日落🌇',
    '下班了吗？别急着走，再陪我专注一会儿嘛～',
    '傍晚的风很舒服，适合来一个认真的番茄🍅'
  ],
  night: [
    '晚上好呀～今天辛苦了，收个尾就休息吧🌙',
    '晚上的时间也是时间，别让它悄悄溜走哦👀',
    '吃完晚饭，来陪我专注一会儿嘛～',
    '今晚的目标定好了吗？你的树已经就位🌳'
  ],
  late: [
    '该休息啦！明天继续，树皮都替你熬不住了🛌',
    '这么晚还在拼，我感动但也心疼，快睡吧主人😴',
    '深夜档选手，你的树要打烊了，明早见🌙',
    '再熬夜我可要报警了！快去睡觉！🚨'
  ]
};
/* 按当前小时取对应时段话术池 */
function treeTimePool(hour) {
  if (hour < 6) return TREE_TALKS_TIME.midnight;
  if (hour < 9) return TREE_TALKS_TIME.morning;
  if (hour < 12) return TREE_TALKS_TIME.am;
  if (hour < 14) return TREE_TALKS_TIME.noon;
  if (hour < 17) return TREE_TALKS_TIME.afternoon;
  if (hour < 19) return TREE_TALKS_TIME.evening;
  if (hour < 22) return TREE_TALKS_TIME.night;
  return TREE_TALKS_TIME.late;
}
function pickTalk(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
/* 时段话术为主、偶尔穿插通用池（卖萌/腹黑/鼓励）；深夜时段优先健康提醒 */
function timedTalk(hour, sid) {
  const pool = treeTimePool(hour);
  const isLate = hour < 6 || hour >= 22;
  if (Math.random() < (isLate ? 0.85 : 0.5)) return pickTalk(pool);
  return randomTreeTalk(sid);
}
/* 树每日任务：自动检测并发放（无需手动领取） */
function checkTreeDailyTasks() {
  const tr = appData.tree;
  if (!tr) return;
  const today = getTodayStr();
  if (!tr.dailyTasks || tr.dailyTasks.date !== today) tr.dailyTasks = { date: today, rewarded: [] };
  const dt = tr.dailyTasks;
  if (!dt.rewarded || !Array.isArray(dt.rewarded)) dt.rewarded = [];
  let changed = false;
  const give = function (id, msg) {
    if (!dt.rewarded.includes(id)) {
      coinEarn(COIN_DAILYTASK_REWARD, 'daily', msg);
      dt.rewarded.push(id);
      UIFX.toast(msg + ' +' + COIN_DAILYTASK_REWARD + '🪙');
      changed = true;
    }
  };
  if (tr.lastWaterDate === today) give('water', '💧 每日任务·浇水');
  if (countTomatoPoints(today) >= 1) give('full1', '🍅 每日任务·完成1个番茄');
  if (countTomatoPoints(today) >= 3) give('pts3', '🎯 每日任务·累计3个番茄');
  if (changed) {
    saveData();
    UIFX.renderTreeSection();
  }
  return dt;
}
/* 商店：购买与使用 */
/* ===== 商店：限时机制（7天/30天，到期自动卸下，可续费） ===== */
/* 7天租金：直接用档位租金 rent7（平价便宜/热门高级贵）；30天=7天×3（整月约8折，长期租更划算）
   动态定价 — 接受当前金币，按 getDynamicMult 上浮（防止通胀）。显示价 = 实际扣价 = 同一公式 */
function treePrice7(item, coins) {
  return getDynamicPrice(item.rent7 != null ? item.rent7 : Math.ceil((item.price * 1.5) / 10) * 10, coins);
}
function treePrice30(item, coins) {
  return getDynamicPrice(Math.ceil((treePrice7(item, 0) * 3) / 10) * 10, coins);
}
/* ===== 商店动态定价：金币多了价格上浮，防止通胀 ===== */
/* 设计（v5 · 狠版 ×3.0 封顶）：
   · ≤ 300🪙    → ×1.0（平价保护：300 以内原价）
   · 300~4000   → ×1.0 → ×2.0（过 300 就一路走高，囤到 4000 要多付一倍）
   · 4000~8000  → ×2.0 → ×3.0（继续加速）
   · ≥ 8000     → 封顶 ×3.0
   参考点：300→×1.00 / 500→×1.05 / 1000→×1.19 / 1500→×1.32 / 2000→×1.46 /
           3000→×1.73 / 4000→×2.00 / 5000→×2.25 / 6000→×2.50 / 8000+→×3.00 */
function getDynamicMult(coins) {
  coins = coins || 0; /* coin-write-allow: 局部形参归一化，不是余额 */
  if (coins <= 300) return 1;
  if (coins < 4000) return 1 + ((coins - 300) / 3700) * 1.0; /* 1.00 → 2.00 */
  if (coins < 8000) return 2 + ((coins - 4000) / 4000) * 1.0; /* 2.00 → 3.00 */
  return 3;
}
function getDynamicPrice(base, coins) {
  const m = getDynamicMult(coins);
  /* 取整到 5 的倍数，让价格好看（避免出现 273🪙 这种零碎数） */
  return Math.max(1, Math.round((base * m) / 5) * 5);
}
/* 检查所有装饰/场景是否过期：过期自动卸下/回默认场景 */
function checkTreeExpiry() {
  const tr = appData.tree;
  if (!tr) return;
  const now = Date.now();
  const dex = tr.decorExpires || {};
  const sex = tr.sceneExpires || {};
  let changed = false;
  const act = tr.activeDecorations || [];
  tr.activeDecorations = act.filter(function (id) {
    const exp = dex[id];
    if (!exp) {
      return true;
    } /* 无到期时间（老数据永久）暂时保留 */
    if (exp <= now) {
      UIFX.toast(
        '⏰ ' +
          ((
            TREE_DECORATIONS.find(function (d) {
              return idEq(d.id, id);
            }) || {}
          ).name || '装饰') +
          ' 已到期，可去商店续费'
      );
      changed = true;
      return false;
    }
    return true;
  });
  if (tr.activeScene && sex[tr.activeScene] && sex[tr.activeScene] <= now) {
    UIFX.toast('⏰ 场景已到期，已切换回花园');
    tr.activeScene = 'garden';
    changed = true;
  }
  /* 光环特效过期：自动卸下 */
  if (tr.activeAura && (tr.auraExpires || {})[tr.activeAura] && (tr.auraExpires || {})[tr.activeAura] <= now) {
    UIFX.toast('⏰ 光环特效已到期，可去商店续费');
    tr.activeAura = null;
    changed = true;
  }
  /* 天气过期：自动卸下 */
  if (
    tr.activeWeather &&
    (tr.weatherExpires || {})[tr.activeWeather] &&
    (tr.weatherExpires || {})[tr.activeWeather] <= now
  ) {
    UIFX.toast('⏰ 天气已到期，可去商店续费');
    tr.activeWeather = null;
    changed = true;
  }
  /* 摆件过期：自动卸下（propExpires[id]===0 为买断永久，不受影响） */
  const pex = tr.propExpires || {};
  const aps = tr.activeProps || [];
  tr.activeProps = aps.filter(function (id) {
    if (pex[id] === 0) return true;
    const e = pex[id];
    if (!e) return false;
    if (e <= now) {
      UIFX.toast('⏰ 摆件已到期，可去商店续费或买断收藏');
      return false;
    }
    return true;
  });
  /* 自定义皮肤过期：清除图片数据（释放存储，DOM 层同步移除） */
  SKIN_KINDS.forEach(function (k) {
    const sk = tr[k.field];
    if (sk && sk.data && sk.expires && sk.expires <= now) {
      sk.data = '';
      sk.expires = 0;
      sk.updatedAt = 0;
      UIFX.toast('⏰ ' + k.name + '已到期，图片已自动清除，可去商店续费');
      changed = true;
    }
  });
  if (changed) {
    saveData();
    UIFX.applySkinsToDOM();
  }
}
function buyTreeItem(kind, id, days) {
  days = days || 7;
  const tr = appData.tree;
  const coins = tr.coins || 0;
  if (kind === 'decor') {
    const d = TREE_DECORATIONS.find(function (x) {
      return idEq(x.id, id);
    });
    if (!d) return;
    const price =
      days === 30 ? treePrice30(d, coins) : days === 7 ? treePrice7(d, coins) : getDynamicPrice(d.price, coins);
    if ((tr.coins || 0) < price) {
      UIFX.toast('🪙 果实币不足（需 ' + price + '）');
      return;
    }
    coinSpend(price, 'shop', '装饰：「' + d.name + '」' + days + ' 天');
    if (!tr.decorExpires) tr.decorExpires = {};
    if (!tr.decorations) tr.decorations = [];
    if (!tr.decorations.includes(id)) tr.decorations.push(id);
    /* 续费：在原到期时间基础上顺延（已过期则从现在起算） */
    const cur = tr.decorExpires[id] || 0;
    tr.decorExpires[id] = Math.max(Date.now(), cur) + days * DAY_MS;
    if (!tr.activeDecorations) tr.activeDecorations = [];
    if (tr.activeDecorations.length < 2 && !tr.activeDecorations.includes(id)) tr.activeDecorations.push(id);
    UIFX.toast(
      (tr.decorations.includes(id) && cur > 0 ? '✅ 已续费 ' : '✅ 已购买 ') +
        d.icon +
        ' ' +
        d.name +
        '（' +
        (days === 30 ? '30天' : '7天') +
        ' · 实付 ' +
        price +
        '🪙）'
    );
  } else {
    const s = TREE_SCENES.find(function (x) {
      return idEq(x.id, id);
    });
    if (!s) return;
    const price =
      days === 30 ? treePrice30(s, coins) : days === 7 ? treePrice7(s, coins) : getDynamicPrice(s.price, coins);
    if ((tr.coins || 0) < price) {
      UIFX.toast('🪙 果实币不足（需 ' + price + '）');
      return;
    }
    coinSpend(price, 'shop', '场景：「' + s.name + '」' + days + ' 天');
    if (!tr.sceneExpires) tr.sceneExpires = {};
    if (!tr.scenes) tr.scenes = [];
    if (!tr.scenes.includes(id)) tr.scenes.push(id);
    const cur = tr.sceneExpires[id] || 0;
    tr.sceneExpires[id] = Math.max(Date.now(), cur) + days * DAY_MS;
    tr.activeScene = id;
    UIFX.toast(
      (tr.scenes.includes(id) && cur > 0 ? '✅ 已续费 ' : '✅ 已购买 ') +
        s.icon +
        ' ' +
        s.name +
        '（' +
        (days === 30 ? '30天' : '7天') +
        ' · 实付 ' +
        price +
        '🪙）'
    );
  }
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
function toggleTreeDecor(id) {
  const tr = appData.tree;
  if (!(tr.decorations || []).includes(id)) return;
  const exp = (tr.decorExpires || {})[id];
  if (exp && exp <= Date.now()) {
    UIFX.toast('⏰ 该装饰已到期，请先续费');
    return;
  }
  if (!tr.activeDecorations) tr.activeDecorations = [];
  if (tr.activeDecorations.includes(id)) {
    tr.activeDecorations = tr.activeDecorations.filter(function (x) {
      return x !== id;
    });
  } else {
    if (tr.activeDecorations.length >= 2) {
      UIFX.toast('最多同时挂 2 个装饰');
      return;
    }
    tr.activeDecorations.push(id);
  }
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
function useTreeScene(id) {
  const tr = appData.tree;
  if (id === 'garden') {
    /* 默认场景：永久免费，随时可切回 */
    tr.activeScene = 'garden';
    saveData();
    UIFX.renderTreeShop();
    UIFX.renderTreeSection();
    return;
  }
  if (!(tr.scenes || []).includes(id)) return;
  const exp = (tr.sceneExpires || {})[id];
  if (exp && exp <= Date.now()) {
    UIFX.toast('⏰ 该场景已到期，请先续费');
    return;
  }
  tr.activeScene = id;
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
/* ===== 光环特效 / 天气 / 摆件：租用 + 轮换 + 买断 ===== */
function buyTreeRent(kind, id, days) {
  days = days || 7;
  const tr = appData.tree;
  const coins = tr.coins || 0;
  let list, ownKey, expKey;
  if (kind === 'aura') {
    list = TREE_AURAS;
    ownKey = 'auras';
    expKey = 'auraExpires';
  } else if (kind === 'weather') {
    list = TREE_WEATHER;
    ownKey = 'weather';
    expKey = 'weatherExpires';
  } else if (kind === 'prop') {
    list = TREE_PROPS;
    ownKey = 'props';
    expKey = 'propExpires';
  } else return;
  const item = list.find(function (x) {
    return idEq(x.id, id);
  });
  if (!item) return;
  const price =
    days === 30 ? treePrice30(item, coins) : days === 7 ? treePrice7(item, coins) : getDynamicPrice(item.rent7, coins);
  if ((tr.coins || 0) < price) {
    UIFX.toast('🪙 果实币不足（需 ' + price + '）');
    return;
  }
  coinSpend(price, 'shop', (item.name || '特效') + ' ' + days + ' 天');
  if (!tr[expKey]) tr[expKey] = {};
  if (!tr[ownKey]) tr[ownKey] = [];
  if (!tr[ownKey].includes(id)) tr[ownKey].push(id);
  const cur = tr[expKey][id] || 0;
  tr[expKey][id] = Math.max(Date.now(), cur) + days * DAY_MS;
  if (kind === 'aura') tr.activeAura = id;
  if (kind === 'weather') tr.activeWeather = id;
  if (kind === 'prop' && !(tr.activeProps || []).includes(id) && (tr.activeProps || []).length < 2)
    tr.activeProps.push(id);
  UIFX.toast(
    '✅ 已' +
      (cur > 0 ? '续费 ' : '租用 ') +
      item.icon +
      ' ' +
      item.name +
      '（' +
      (days === 30 ? '30天' : '7天') +
      ' · 实付 ' +
      price +
      '🪙）'
  );
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
function useTreeAura(id) {
  const tr = appData.tree;
  const exp = (tr.auraExpires || {})[id];
  if (exp && exp <= Date.now()) {
    UIFX.toast('⏰ 该特效已到期，请先续费');
    return;
  }
  tr.activeAura = id;
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
function useTreeWeather(id) {
  const tr = appData.tree;
  const exp = (tr.weatherExpires || {})[id];
  if (exp && exp <= Date.now()) {
    UIFX.toast('⏰ 该天气已到期，请先续费');
    return;
  }
  tr.activeWeather = id;
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
function toggleTreeProp(id) {
  const tr = appData.tree;
  const permanent = (tr.propExpires || {})[id] === 0;
  const exp = (tr.propExpires || {})[id];
  if (!permanent && (!exp || exp <= Date.now())) {
    UIFX.toast('⏰ 该摆件已到期，请先续费');
    return;
  }
  if (!tr.activeProps) tr.activeProps = [];
  if (tr.activeProps.includes(id)) {
    tr.activeProps = tr.activeProps.filter(function (x) {
      return x !== id;
    });
  } else {
    if (tr.activeProps.length >= 2) {
      UIFX.toast('最多同时放 2 个摆件');
      return;
    }
    tr.activeProps.push(id);
  }
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
function buyTreeProp(id) {
  const tr = appData.tree;
  const coins = tr.coins || 0;
  const p = TREE_PROPS.find(function (x) {
    return idEq(x.id, id);
  });
  if (!p) return;
  const buyPrice = getDynamicPrice(p.buy, coins);
  if ((tr.coins || 0) < buyPrice) {
    UIFX.toast('🪙 果实币不足（需 ' + buyPrice + '）');
    return;
  }
  coinSpend(buyPrice, 'shop', '买断摆件：' + p.name);
  if (!tr.props) tr.props = [];
  if (!tr.props.includes(id)) tr.props.push(id);
  if (tr.propExpires) tr.propExpires[id] = 0; /* 0 = 永久 */
  UIFX.toast('🏡 已买断 ' + p.icon + ' ' + p.name + '（永久收藏）');
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
/* ===== 乐子：今日运势签 + 投喂小食 ===== */
const TREE_FORTUNE = [
  { id: 'great', icon: '🍀', name: '大吉', desc: '今日树成长 +8%，树会开心开花', buff: { growth: 1.08 } },
  { id: 'good', icon: '🌸', name: '中吉', desc: '今日首次触碰树金币翻倍（+10）', buff: { touch: 10 } },
  { id: 'small', icon: '🌿', name: '小吉', desc: '今日浇水多算 1 天露珠进度', buff: { dew: 1 } },
  { id: 'normal', icon: '📜', name: '平', desc: '平平淡淡才是真，树说句鼓励的话', buff: {} },
  { id: 'bad', icon: '🌧️', name: '凶', desc: '今日树成长 -5%，树会多吐槽你', buff: { growth: 0.95 } },
  { id: 'dread', icon: '💀', name: '大凶', desc: '今日树成长 -8%，开启毒舌模式', buff: { growth: 0.92, dark: true } }
];
const TREE_FORTUNE_WEIGHTS = [8, 16, 20, 30, 18, 8];
const TREE_DARK_TALKS = [
  '今日大凶：本树拒绝营业，先去完成番茄再说！',
  '凶兆已至：你再偷懒，天都要塌啦（假的）',
  '今天我不哄你了，自己看着办吧😤',
  '毒舌模式：主人，你的树觉得你还能再努努力',
  '大凶预警：小心点，别被自己的拖延绊倒',
  '本树掐指一算：你今天又会摸鱼，准没跑'
];
function getFortune() {
  const tr = appData.tree;
  if (!tr.fortuneToday) return null;
  if (tr.fortuneToday.date !== getTodayStr()) {
    /* 跨日：清掉旧签 + 重置成长 buff */
    tr.fortuneToday = null;
    if (tr.dailyGrowBoost && tr.dailyGrowBoost !== 1) tr.dailyGrowBoost = 1;
    return null;
  }
  return (
    TREE_FORTUNE.find(function (f) {
      return f.id === tr.fortuneToday.id;
    }) || null
  );
}
function drawFortune() {
  const tr = appData.tree;
  if ((tr.fortuneCount || 0) >= 1) {
    UIFX.toast('🎴 今天已经抽过运势签啦，明天再来');
    return;
  }
  const _fCost = getDynamicPrice(20, tr.coins || 0);
  if ((tr.coins || 0) < _fCost) {
    UIFX.toast('🪙 果实币不足（需 ' + _fCost + '）');
    return;
  }
  coinSpend(_fCost, 'shop', '抽运势签');
  tr.fortuneCount = (tr.fortuneCount || 0) + 1;
  const total = TREE_FORTUNE_WEIGHTS.reduce(function (s, w) {
    return s + w;
  }, 0);
  let r = Math.floor(Math.random() * total);
  let idx = 0;
  for (let i = 0; i < TREE_FORTUNE_WEIGHTS.length; i++) {
    r -= TREE_FORTUNE_WEIGHTS[i];
    if (r < 0) {
      idx = i;
      break;
    }
  }
  const f = TREE_FORTUNE[idx];
  tr.fortuneToday = { date: getTodayStr(), id: f.id };
  saveData();
  /* 状态补偿：已经摸过树/浇过水的，抽到对应 buff 直接当场兑现，不浪费 */
  const today = getTodayStr();
  if (f.id === 'good' && tr.lastTouchBonusDate === today) {
    coinEarn(5, 'fortune', '中吉补偿：今日已摸过树，补发翻倍差额');
    UIFX.toast('🌸 中吉：你今天已经摸过树啦，直接补你 5🪙（翻倍那部分）');
  } else if (f.id === 'small' && tr.lastWaterDate === today) {
    tr.waterStreak = (tr.waterStreak || 0) + 1;
    UIFX.toast('🌿 小吉：你今天已经浇过水啦，直接加 1 天露珠进度');
  } else {
    UIFX.toast('🎴 抽到：' + f.icon + ' ' + f.name);
  }
  saveData();
  UIFX.renderTreeShop();
  UIFX.renderTreeSection();
}
/* 商店里喂食后，等关掉弹窗再让树苗气泡感谢 */
/* 喂食当天剩余口头感谢次数（关店气泡 1 次 + 点击树 1 次） */
/* 剩余天数文案 */
function treeRemainDays(exp) {
  if (!exp) return '永久';
  const d = Math.ceil((exp - Date.now()) / DAY_MS);
  if (d <= 0) return '已到期';
  return '剩余 ' + d + ' 天';
}
/* 果实图鉴：点亮到达过的阶段序号（1..9） */
/* 树种图鉴：按「当前树种」分别收集到达过的阶段序号（1..9）。
   每棵树的成长阶段独立收集：番茄树收集番茄树的 9 阶，樱花树收集樱花树的 9 阶…… */
function ensureSpeciesAlbum() {
  const tr = appData.tree;
  if (!tr.speciesAlbum) tr.speciesAlbum = {};
  const sid = tr.species || 'tomato';
  if (!Array.isArray(tr.speciesAlbum[sid])) tr.speciesAlbum[sid] = [];
  const stages = SPECIES_STAGES[sid] || SPECIES_STAGES.tomato;
  const curStage = getTreeStage(tr.points || 0);
  const idx = stages.findIndex(function (s) {
    return s.name === curStage.name && s.min === curStage.min;
  });
  if (idx >= 0) {
    for (let k = 0; k <= idx; k++) {
      if (tr.speciesAlbum[sid].indexOf(k + 1) < 0) tr.speciesAlbum[sid].push(k + 1);
    }
    tr.speciesAlbum[sid].sort(function (a, b) {
      return a - b;
    });
  }
  /* 任务图鉴（单树成长图鉴）集齐 9 阶段 → 赠 500 金币（每种树仅首次集齐有效） */
  if (!tr.speciesAlbumClaimed) tr.speciesAlbumClaimed = {};
  if (tr.speciesAlbum[sid].length >= 9 && !tr.speciesAlbumClaimed[sid]) {
    tr.speciesAlbumClaimed[sid] = true;
    UIFX.showGift('📕 成长图鉴集齐：「' + TREE_SPECIES[sid].name + '」全部 9 阶段', COIN_ALBUM_REWARD);
  }
  /* 串行解锁检查：图鉴刚集齐 9 阶时立即解锁下一棵树（不必等下次成长点变化） */
  checkTreeSpeciesUnlock();
  return tr.speciesAlbum[sid];
}
/* 兼容旧引用 */
function ensureTreeAlbum() {
  return ensureSpeciesAlbum();
}
/* 树名展示：优先用用户起的名字，其次用该树种的默认名，最后回退到树种名。可传 sid 指定树种 */
function treeDisplayName(sid) {
  const s = sid || appData.tree.species || 'tomato';
  const n = ((appData.tree.treeNames || {})[s] || '').trim();
  if (n) return n;
  return DEFAULT_TREE_NAMES[s] || (TREE_SPECIES[s] ? TREE_SPECIES[s].name : '小树');
}
/* ===== 神秘板块「🕵️ 神秘际遇」：每日 3 个神秘小任务，每个 +8🪙，与每日任务不重复 ===== */
const MYSTERY_POOL = [
  {
    id: 'early',
    icon: '🌅',
    name: '早起鸟',
    desc: '今天 10:00 前完成 1 个番茄',
    check: function (s) {
      return s.early >= 1;
    }
  },
  {
    id: 'night',
    icon: '🌙',
    name: '夜猫子',
    desc: '今天 22:00 后完成 1 个番茄',
    check: function (s) {
      return s.night >= 1;
    }
  },
  {
    id: 'long',
    icon: '🧊',
    name: '长跑选手',
    desc: '完成 1 次 45 分钟以上的专注',
    check: function (s) {
      return s.long >= 1;
    }
  },
  {
    id: 'clean',
    icon: '🧘',
    name: '心无旁骛',
    desc: '完成 1 次零打断的专注',
    check: function (s) {
      return s.clean >= 1;
    }
  },
  {
    id: 'note',
    icon: '📝',
    name: '记录达人',
    desc: '给番茄写 1 条备注',
    check: function (s) {
      return s.note >= 1;
    }
  },
  {
    id: 'mood',
    icon: '💭',
    name: '心情涂鸦',
    desc: '记录 1 次身心电量/愉悦值',
    check: function (s) {
      return s.mood >= 1;
    }
  },
  {
    id: 'sprint',
    icon: '🚀',
    name: '火力全开',
    desc: '今天完成 5 个完整番茄',
    check: function (s) {
      return s.fiveFull >= 1;
    }
  },
  {
    id: 'combo',
    icon: '⚡',
    name: '无缝衔接',
    desc: '2 个番茄间隔 <60 分钟连做',
    check: function (s) {
      return s.combo >= 1;
    }
  }
];
function getMysteryStats() {
  const today = getTodayStr();
  let early = 0,
    night = 0,
    long = 0,
    clean = 0,
    note = 0,
    mood = 0,
    fiveFull = 0,
    combo = 0;
  const times = [];
  (appData.records || []).forEach(function (x) {
    if (getDateStr(x.startTime) !== today) return;
    const h = new Date(x.startTime).getHours();
    if (x.type === 'full' || x.type === 'half') {
      if (h < 10) early++;
      if (h >= 22) night++;
      if ((x.effectiveSeconds || 0) >= 2700) long++;
      if (x.type === 'full' && (!x.interruptions || x.interruptions.length === 0)) clean++;
      if (x.note && x.note.trim()) note++;
      if (x.mood || x.energy) mood++;
      if (x.type === 'full') fiveFull++;
      times.push(x.startTime);
    }
  });
  times.sort(function (a, b) {
    return a - b;
  });
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] < 3600000) {
      combo++;
      break;
    }
  }
  return {
    early: early,
    night: night,
    long: long,
    clean: clean,
    note: note,
    mood: mood,
    fiveFull: fiveFull,
    combo: combo
  };
}
function ensureMysteryTasks() {
  const tr = appData.tree;
  if (!tr.mysteryTasks) tr.mysteryTasks = { date: null, tasks: [] };
  const mt = tr.mysteryTasks;
  const today = getTodayStr();
  if (mt.date !== today) {
    const pool = MYSTERY_POOL.slice();
    const picked = [];
    while (picked.length < 3 && pool.length > 0) {
      const i = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(i, 1)[0]);
    }
    mt.date = today;
    mt.tasks = picked.map(function (t) {
      return { id: t.id, done: false, claimed: false };
    });
  }
  const stats = getMysteryStats();
  let changed = false;
  mt.tasks.forEach(function (t) {
    const def = MYSTERY_POOL.find(function (p) {
      return p.id === t.id;
    });
    if (def && def.check(stats) && !t.done) {
      t.done = true;
      changed = true;
    }
  });
  if (changed) {
    saveData();
  }
  return mt;
}
function claimMysteryTask(idx) {
  const mt = appData.tree.mysteryTasks;
  if (!mt || !mt.tasks || !mt.tasks[idx]) return;
  const t = mt.tasks[idx];
  if (!t.done) {
    UIFX.toast('还没完成这个神秘任务哦');
    return;
  }
  if (t.claimed) {
    UIFX.toast('已经领过啦');
    return;
  }
  t.claimed = true;
  coinEarn(COIN_MYSTERY_REWARD, 'mystery', '神秘任务奖励（第 ' + (idx + 1) + ' 项）');
  saveData();
  UIFX.renderTreeSection();
  UIFX.renderTreeShop();
  UIFX.toast('🕵️ 神秘任务完成！+8🪙');
}
/* ===== 金币抽奖：完成番茄得次数，抽 1~10 金币 =====
   概率权重（对应金币 1~10）：越小越高，10 也有 2% 不算太稀有 */
const TREE_LOTTERY_WEIGHTS = [28, 20, 15, 11, 8, 6, 5, 3, 2, 2];
function treeLotteryReward() {
  const total = TREE_LOTTERY_WEIGHTS.reduce(function (a, b) {
    return a + b;
  }, 0);
  let r = Math.floor(Math.random() * total);
  for (let i = 0; i < 10; i++) {
    r -= TREE_LOTTERY_WEIGHTS[i];
    if (r < 0) return i + 1;
  }
  return 1;
}
/* 带树名的亲切话语：{name} 会被替换成用户给树起的名字 */
const TREE_TALKS_NAMED = [
  '{name}在给你加油打气呢！🌱',
  '主人加油，{name}一直陪着你✨',
  '摸摸头，{name}最喜欢认真的你啦💕',
  '{name}说：再坚持一下下就好啦！',
  '有{name}陪你，什么都不怕💪',
  '{name}把阳光都给你攒着啦☀️',
  '主人最棒了，{name}为你骄傲🌟',
  '累了就靠靠{name}，树荫最舒服啦🌳',
  '{name}摇着叶子给你鼓掌👏',
  '嘘～{name}在偷偷夸你认真呢🤫',
  '主人亲亲{name}！下个番茄更有劲！',
  '{name}：今天也要和主人一起发光✨',
  '{name}说：主人再玩手机，我可要生气了哦😤',
  '{name}今天也超乖，快夸我快夸我！',
  '哼，{name}在吃醋：你摸别的树的时候我可都看着呢',
  '{name}小声嘀咕：这个人怎么还不开始专注呀',
  '主人完成番茄，{name}就送你一片新叶子🍃',
  '{name}：再不浇水，我就把你鞋带系在一起！'
];
/* 陪伴树随机话语（鼓励/卖萌/撒娇，含树名亲切版） */
function randomTreeTalk(sid) {
  const nm = treeDisplayName(sid);
  const pool = TREE_TALKS.concat(
    TREE_TALKS_NAMED.map(function (t) {
      return t.replace('{name}', nm);
    })
  );
  return pool[Math.floor(Math.random() * pool.length)];
}
/* 满级后年轮：>=200 每 50 点 +1 圈（第 N 圈） */
function getEternalStars(points) {
  return points >= 200 ? Math.floor((points - 200) / 50) + 1 : 0;
}
/* 年轮荣誉阶梯（纯荣誉，无任何数值加成）：节点按累计圈数递增 5 / 10 / 20 / 50，
   50 圈之后每再攒 50 圈进一阶。只影响称号与展示，不影响积分、金币与成长速度。
   注意：段位体系已占用「星」（段位星⭐ / 星耀段位 / 荣耀王者 / 成就星耀之巅），
   这里刻意改名「年轮」+ 量词「圈」，与段位彻底不打架。 */
const ETERNAL_TIERS = [
  { at: 1, name: '初轮', icon: '🌱' },
  { at: 5, name: '成木', icon: '🌿' },
  { at: 10, name: '十载', icon: '🌳' },
  { at: 20, name: '廿载古木', icon: '🌲' },
  { at: 50, name: '永恒树心', icon: '♾️' },
  /* 长尾补齐：50 圈之后原本只有「永恒树心 N 重」这一个纯数字，十几年只剩数字在动、
     没有任何新节点。按 2~10 倍的节奏补到 1000 圈 —— 单树 1000 圈 ≈ 5 万点，
     按每天 2 个番茄约 68 年，之后每 1000 圈一重（几乎等于没有尽头）。 */
  { at: 100, name: '百轮树心', icon: '🏛️' },
  { at: 200, name: '千轮树心', icon: '🌌' },
  { at: 500, name: '纪元之树', icon: '🪐' },
  { at: 1000, name: '不朽之树', icon: '👑' }
];
const ETERNAL_TOP = 1000; /* 顶档圈数；越过之后每 ETERNAL_TOP 圈进一重 */
function getEternalTier(stars) {
  stars = Number(stars) || 0;
  if (stars <= 0) return { cur: null, next: ETERNAL_TIERS[0] };
  let cur = ETERNAL_TIERS[0],
    next = null;
  for (let i = 0; i < ETERNAL_TIERS.length; i++) {
    if (stars >= ETERNAL_TIERS[i].at) cur = ETERNAL_TIERS[i];
    else {
      next = ETERNAL_TIERS[i];
      break;
    }
  }
  if (!next && stars >= ETERNAL_TOP) {
    const extra = Math.floor(stars / ETERNAL_TOP); /* 1000 圈 = 第 1 重 */
    return {
      cur: { at: extra * ETERNAL_TOP, name: '不朽之树' + (extra > 1 ? ' ' + extra + ' 重' : ''), icon: '👑' },
      next: { at: (extra + 1) * ETERNAL_TOP, name: '不朽之树 ' + (extra + 1) + ' 重', icon: '👑' }
    };
  }
  return { cur: cur, next: next };
}
/* 履历：记录每圈年轮的达成日期（历史圈数无日期可回溯，显示「早于本功能上线」） */
function logEternalStar(n, sid) {
  const tr = appData.tree;
  if (!tr) return;
  if (!tr.treeLifeLog) tr.treeLifeLog = { planted: {}, maxed: {}, stars: [] };
  if (!Array.isArray(tr.treeLifeLog.stars)) tr.treeLifeLog.stars = [];
  if (
    tr.treeLifeLog.stars.some(function (x) {
      return x.n === n;
    })
  )
    return;
  tr.treeLifeLog.stars.push({ n: n, date: getTodayStr(), sid: sid || tr.species || 'tomato' });
  tr.treeLifeLog.stars.sort(function (a, b) {
    return a.n - b.n;
  });
}
/* ===== 封树成林（超长线）=====
   一棵树走到「永恒树心」后可以封进林地：它的一生被记下来，当前树种从零开始新的一代。
   为什么要这个：积分线在 3.7 年后就没有内容了，而「我在这棵树上养到了第几代」
   是能撑十几年的收藏线 —— 每次封树都是对过去几年的一个交代，比「第 N 重」这种纯数字有感情。
   代价必须讲清楚（成长值与年轮清零），所以入口带二次确认。 */
const SEAL_MIN_RINGS = 50; /* 至少养到「永恒树心」才允许封树 */
function sealTreeStatus() {
  const tr = appData.tree || {};
  const rings = getEternalStars(tr.points || 0);
  return { ok: rings >= SEAL_MIN_RINGS, rings: rings, need: Math.max(0, SEAL_MIN_RINGS - rings) };
}
/* 林地棵数（不传 sid 就是全部） */
function groveCount(sid) {
  const g = (appData.tree && appData.tree.grove) || [];
  if (!sid) return g.length;
  return g.filter(function (x) {
    return x && x.sid === sid;
  }).length;
}
function sealCurrentTree() {
  const st = sealTreeStatus();
  const tr = appData.tree || {};
  const sid = tr.species || 'tomato';
  if (!st.ok) {
    UIFX.toast('🌲 还差 ' + st.need + ' 圈年轮（满 ' + SEAL_MIN_RINGS + ' 圈才能封树成林）');
    return;
  }
  const nm = treeDisplayName(sid);
  const gen = groveCount(sid) + 1;
  const msg =
    '把「' + nm + '」封进林地？\n\n' +
    '· 它的一生会被记住：第 ' + gen + ' 代 · ' + st.rings + ' 圈年轮\n' +
    '· 当前' + TREE_SPECIES[sid].name + '从零开始新的一代（成长值与年轮清零，树龄重新起算）\n' +
    '· 已解锁树种、图鉴、称号、金币都不受影响\n' +
    '封树不可逆 —— 这是给它的一个交代 🌲';
  const _do = function () {
    doSealTree(sid, st.rings);
  };
  if (typeof window.rsConfirm === 'function') {
    window.rsConfirm(msg, { title: '🌲 封树成林', okText: '封树' }).then(function (ok) {
      if (ok) _do();
    });
  } else if (confirm(msg)) {
    _do();
  }
}
function doSealTree(sid, rings) {
  const tr = appData.tree;
  if (!tr) return;
  if (!Array.isArray(tr.grove)) tr.grove = [];
  if (!tr.treeLifeLog) tr.treeLifeLog = { planted: {}, maxed: {}, stars: [] };
  if (!tr.treeLifeLog.planted) tr.treeLifeLog.planted = {};
  const today = getTodayStr();
  const planted = tr.treeLifeLog.planted[sid] || null;
  const gen = groveCount(sid) + 1;
  const nm = treeDisplayName(sid);
  tr.grove.push({
    sid: sid,
    name: nm,
    gen: gen,
    planted: planted,
    sealedAt: today,
    days: planted ? treeAgeDays(planted, today) : 0, /* 这一代陪了多久 */
    rings: rings,
    points: tr.points || 0
  });
  /* 这一代结束：成长值 / 年轮 / 成长里程碑归零，种植日重新起算（树龄线随之开启新的一段）。
     称号按 peakPoints 走「退化不清零」，图鉴、已解锁树种、金币一律不动。 */
  tr.points = 0;
  if (!tr.speciesPoints) tr.speciesPoints = {};
  tr.speciesPoints[sid] = 0;
  tr.milestones = [];
  tr.fruitCount = 0;
  tr.treeLifeLog.planted[sid] = today;
  saveData();
  UIFX.showRankFeedback('🌲 封树成林：「' + nm + '」住进林地了（第 ' + gen + ' 代）');
  try {
    UIFX.renderTreeSection();
  } catch (e) {
    if (window.__silent) window.__silent(e, '01d3:doSealTree');
  }
}
/* 履历：记录树龄档首次达成（同一个档只记一次，反复渲染不会重复写）。
   树龄是"陪伴天数"这条时间线，与积分/年轮无关 —— 十几年后它就是最长的纪念册。 */
function logTreeAgeMark(days, sid) {
  const tr = appData.tree;
  if (!tr) return;
  const k = Math.floor(Number(days) || 0);
  if (k <= 0) return;
  if (!tr.treeLifeLog) tr.treeLifeLog = { planted: {}, maxed: {}, stars: [] };
  if (!Array.isArray(tr.treeLifeLog.ages)) tr.treeLifeLog.ages = [];
  if (
    tr.treeLifeLog.ages.some(function (x) {
      return x.days === k;
    })
  )
    return;
  tr.treeLifeLog.ages.push({ days: k, date: getTodayStr(), sid: sid || tr.species || 'tomato' });
  tr.treeLifeLog.ages.sort(function (a, b) {
    return a.days - b.days;
  });
  saveData();
}
/* ===== 年度回顾 =====
   每满一周年，把「这一年」结一次账写进履历（只写一次、可回看）。
   为什么要有：十几年尺度上，唯一能让人回头的就是这些年度小结 ——
   「第 3 年：426 个番茄 · 198 天 · 10,650 分钟」比任何数字都更能说明一段时间。
   只用 records 现算，不新开账本；封树不影响（封树只重置当前树的成长值）。 */
function checkTreeAnnual() {
  const tr = appData.tree;
  if (!tr || !tr.treeLifeLog) return 0;
  const sid = tr.species || 'tomato';
  const planted = tr.treeLifeLog.planted && tr.treeLifeLog.planted[sid];
  if (!planted) return 0;
  const today = getTodayStr();
  const years = treeAgeYears(planted, today);
  if (years < 1) return 0;
  if (!Array.isArray(tr.treeLifeLog.annual)) tr.treeLifeLog.annual = [];
  const done = tr.treeLifeLog.annual.reduce(function (m, x) {
    return x && x.sid === sid ? Math.max(m, Math.floor(Number(x.year) || 0)) : m;
  }, 0);
  let added = 0;
  for (let y = done + 1; y <= years; y++) {
    const from = addYearsToDate(planted, y - 1);
    const to = addYearsToDate(planted, y);
    if (!from || !to) break;
    const st = rangeStatsFrom(appData.records, from, to);
    tr.treeLifeLog.annual.push({
      sid: sid,
      year: y,
      from: from,
      to: to,
      date: to,
      /* 字段名刻意用 tomato：这是「已经结好账的年度快照」，
         不是 records 里的记录，别让番茄单一口径门禁把它当成原始字段读 */
      tomato: st.pomos,
      days: st.days,
      minutes: st.minutes,
      rings: getEternalStars(tr.points || 0)
    });
    added++;
  }
  if (added) {
    saveData();
    const nm = treeDisplayName(sid);
    UIFX.showRankFeedback('📅 你陪「' + nm + '」走过 ' + years + ' 年了 · 年度回顾已记进履历');
  }
  return added;
}
function logTreeMaxed(sid) {
  const tr = appData.tree;
  if (!tr) return;
  if (!tr.treeLifeLog) tr.treeLifeLog = { planted: {}, maxed: {}, stars: [] };
  if (!tr.treeLifeLog.maxed) tr.treeLifeLog.maxed = {};
  const k = sid || tr.species || 'tomato';
  if (tr.treeLifeLog.maxed[k]) return;
  tr.treeLifeLog.maxed[k] = getTodayStr();
}
function logTreePlanted(sid) {
  const tr = appData.tree;
  if (!tr) return;
  if (!tr.treeLifeLog) tr.treeLifeLog = { planted: {}, maxed: {}, stars: [] };
  if (!tr.treeLifeLog.planted) tr.treeLifeLog.planted = {};
  const k = sid || tr.species || 'tomato';
  if (tr.treeLifeLog.planted[k]) return;
  tr.treeLifeLog.planted[k] = getTodayStr();
}

/* 检测并解锁树种 */
/* 多种树枯死检查：与主树同一退化曲线——闲置2天起每天退化（3、5、7、9…递增），
   退化到种子(0点) → 直接枯死（不再按固定7天无番茄直接判死；新种时本来就在0点的种子不判死） */
function checkTreeDeath() {
  let tr = appData.tree;
  if (!tr.plantedSpecies || !tr.plantedSpecies.length) return;
  if (!tr.speciesLastActive) tr.speciesLastActive = {};
  let today = new Date(getTodayStr() + 'T00:00:00');
  let died = [];
  tr.plantedSpecies.forEach(function (sid) {
    if (sid === tr.species) return; /* 当前活跃树由 degradeTree 处理 */
    let last = tr.speciesLastActive[sid] || tr.lastActiveDate;
    if (!last) return;
    let days = Math.floor((today - new Date(last + 'T00:00:00')) / DAY_MS);
    /* 模拟逐日退化：闲置第3天起每天扣 3、5、7、9…（与主树一致），退到 0 点为止 */
    let pts = tr.speciesPoints[sid] || 0;
    let day = 0;
    while (day < days && pts > 0) {
      day++;
      if (day > 2) pts = Math.max(0, pts - (3 + 2 * (day - 3)));
    }
    tr.speciesPoints[sid] = pts;
    /* 退化到 0 点（且确实经历过退化，day>0）→ 直接枯死 */
    if (pts <= 0 && day > 0) {
      died.push(sid);
      if (tr.speciesLastActive) delete tr.speciesLastActive[sid];
    }
  });
  if (died.length) {
    tr.plantedSpecies = tr.plantedSpecies.filter(function (s) {
      return died.indexOf(s) < 0;
    });
    /* 如果当前树枯死，切回番茄树 */
    if (died.indexOf(tr.species) >= 0) {
      tr.species = 'tomato';
      tr.points = tr.speciesPoints['tomato'] || 0;
    }
    died.forEach(function (sid) {
      UIFX.toast('💀 ' + TREE_SPECIES[sid].name + '退化到了种子，已枯死，需重新种植');
    });
    saveData();
  }
}
/* ===== 枯死树的复活 / 重种 ===== */
function replantTree() {
  if (!appData.tree.dead) {
    UIFX.toast('🌳 树没有枯死，不需要重种');
    return;
  }
  appData.tree.dead = false;
  appData.tree.deadDate = null;
  appData.tree.points = 0;
  appData.tree.peakPoints = Math.max(appData.tree.peakPoints || 0, 0);
  appData.tree.lastActiveDate = getTodayStr();
  appData.tree.species = 'tomato';
  appData.tree.speciesPoints = { tomato: 0 };
  appData.tree.plantedSpecies = ['tomato'];
  appData.tree.speciesLastActive = {};
  saveData();
  UIFX.renderTreeSection();
  UIFX.renderTimerTree();
  UIFX.toast('🌱 已重新种下一棵新树！');
}
function checkTreeSpeciesUnlock() {
  let unlocked = false;
  for (const id in TREE_SPECIES) {
    if ((appData.tree.unlockedSpecies || []).includes(id)) continue;
    /* 串行解锁（长线养成）：上一棵树图鉴集齐 9 阶后，下一棵才解锁（不再按成长点峰值解锁） */
    if (!speciesPrevFull(id)) continue;
    if (!appData.tree.unlockedSpecies) appData.tree.unlockedSpecies = ['tomato'];
    appData.tree.unlockedSpecies.push(id);
    unlocked = true;
    UIFX.showRankFeedback(
      '👑 ' +
        speciesPrevName(id) +
        '图鉴全收集！解锁新树种：' +
        TREE_SPECIES[id].icon +
        TREE_SPECIES[id].name +
        '！可在番茄树页面切换'
    );
  }
  return unlocked;
}
/* 季节系统（纯展示，不影响任何数值）+ 树种推荐 */
function getSeasonalInfo() {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5)
    return {
      season: 'spring',
      name: '春',
      icon: '🌸',
      recommend: 'cherry',
      recommendName: '樱花树',
      hint: '春暖花开，樱花树正当季'
    };
  if (m >= 6 && m <= 8)
    return {
      season: 'summer',
      name: '夏',
      icon: '☀️',
      recommend: 'tomato',
      recommendName: '番茄树',
      hint: '夏日炎炎，番茄树生机旺盛'
    };
  if (m >= 9 && m <= 11)
    return {
      season: 'autumn',
      name: '秋',
      icon: '🍂',
      recommend: 'golden',
      recommendName: '金松树',
      hint: '秋意渐浓，金松树金黄夺目'
    };
  return {
    season: 'winter',
    name: '冬',
    icon: '❄️',
    recommend: 'cosmic',
    recommendName: '星辰树',
    hint: '冬夜清朗，星辰树熠熠生辉'
  };
}
/* 切换树种 */
function selectTreeSpecies(id) {
  if (!TREE_SPECIES[id]) return;
  if (!(appData.tree.unlockedSpecies || []).includes(id)) {
    UIFX.toast('该树种尚未解锁');
    return;
  }
  let tr = appData.tree;
/* 当前已经在种这棵树：点击不重置不切换（否则点「本季推荐」卡会把 2 阶段树重置） */
  if (tr.species === id) {
    UIFX.toast('🌳 你已经在种' + TREE_SPECIES[id].name + '啦，安心等它长大');
    return;
  }
  let planted = tr.plantedSpecies || [];
  /* 未种植：先预览确认（点查看≠种植，明确点「确认种植」按钮才种） */
  if (!planted.includes(id)) {
    UIFX.showTreePlantPreview(id);
    return;
  }
  /* 保存当前树积分，加载新树积分 */
  let cur = tr.species || 'tomato';
  tr.speciesPoints[cur] = tr.points || 0;
  tr.species = id;
  tr.points = tr.speciesPoints[id] || 0;
  saveData();
  UIFX.renderTreeSection();
  UIFX.hideTreePlantPreview();
  UIFX.toast('已切换为' + TREE_SPECIES[id].name);
}
function plantSpecies(id) {
  /* 串行解锁校验：上一棵树图鉴未集齐 9 阶不可种植 */
  if (!speciesPrevFull(id)) {
    UIFX.toast('🔒 需先集齐「' + speciesPrevName(id) + '」图鉴（9/9）才能种植');
    return;
  }
  let tr = appData.tree;
  if (!tr.plantedSpecies) tr.plantedSpecies = [];
  if (tr.plantedSpecies.includes(id)) {
    UIFX.toast(TREE_SPECIES[id].name + '已经在种植中');
    return;
  }
  tr.plantedSpecies.push(id);
  logTreePlanted(id);
  if (!tr.speciesPoints) tr.speciesPoints = {};
  tr.speciesPoints[id] = 0;
  if (!tr.speciesLastActive) tr.speciesLastActive = {};
  tr.speciesLastActive[id] = getTodayStr();
  /* 保存当前树积分，切换到新树 */
  let cur = tr.species || 'tomato';
  tr.speciesPoints[cur] = tr.points || 0;
  tr.species = id;
  tr.points = 0;
  saveData();
  UIFX.renderTreeSection();
  UIFX.hideTreePlantPreview();
  UIFX.toast('🌱 已种下' + TREE_SPECIES[id].name + '！从种子开始成长吧~');
}
/* 每日浇水：连续 7 天获得一颗露珠徽章（纯纪念，不参与积分平衡） */
function waterTree() {
  const tr = appData.tree;
  const today = getTodayStr();
  if (tr.lastWaterDate === today) {
    UIFX.toast('💧 今天已经浇过水啦，明天再来吧');
    return;
  }
  if (tr.lastWaterDate) {
    const y = new Date(today + 'T00:00:00');
    y.setDate(y.getDate() - 1);
    const yds = getDateStr(y);
    if (tr.lastWaterDate === yds) {
      tr.waterStreak = (tr.waterStreak || 0) + 1;
    } else if (isWaterProtected(yds)) {
      tr.waterStreak = (tr.waterStreak || 0) + 1;
      UIFX.toast('🛡️ 保护卡生效：昨天虽未浇水，连续不断！');
    } else {
      tr.waterStreak = 1;
    }
  } else {
    tr.waterStreak = 1;
  }
  tr.lastWaterDate = today;
  /* 小吉运势：今日浇水多算 1 天露珠进度（乐子级 buff） */
  if (getFortune() && getFortune().buff && getFortune().buff.dew) {
    tr.waterStreak = (tr.waterStreak || 0) + 1;
    UIFX.toast('🌿 小吉运势：浇水进度额外 +1 天！');
  }
  if ((tr.waterStreak || 0) >= 7 && tr.waterStreak % 7 === 0) {
    tr.dewBadges = (tr.dewBadges || 0) + 1;
    UIFX.toast('💧 连续浇水7天！获得露珠徽章（累计 ×' + tr.dewBadges + '）');
  } else {
    const left = 7 - ((tr.waterStreak || 0) % 7);
    UIFX.toast('💧 浇水成功！连续 ' + tr.waterStreak + ' 天（再浇 ' + left + ' 天得一颗💧）');
  }
  saveData();
  UIFX.renderTreeSection();
  checkTreeDailyTasks();
  checkNewAchievements();
}
function degradeTree(silent) {
  /* 静默模式：init 启动时传 true，树退化只在后台结算不弹 toast（打开页面不被打扰）；
     其他主动场景不传参，照常提示 */
  if (!appData.tree.lastActiveDate) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  /* 复活保护期：保护期内不退化；保护期一过，把闲置起点提到保护期结束日，
     避免「复活后一直没种番茄」被一次性扣一大笔 */
  if (appData.tree.reviveProtectUntil) {
    const protEnd = new Date(appData.tree.reviveProtectUntil + 'T00:00:00');
    if (today <= protEnd) return;
    if (appData.tree.lastActiveDate < appData.tree.reviveProtectUntil) {
      appData.tree.lastActiveDate = appData.tree.reviveProtectUntil;
    }
    delete appData.tree.reviveProtectUntil;
  }
  const last = new Date(appData.tree.lastActiveDate + 'T00:00:00');
  const gapDays = Math.floor((today - last) / DAY_MS);
  const beforePoints = appData.tree.points || 0; /* 退化前的积分 */
  /* 退化：闲置第3天起每天扣 3、5、7、9…（越久退化越狠，非匀速），只退积分不退峰值 */
  if (gapDays > 2) {
    const degradeDays = gapDays - 2;
    let lost = 0;
    for (let i = 1; i <= degradeDays; i++) lost += 3 + 2 * (i - 1);
    if (lost > 0 && beforePoints > 0) {
      const newPoints = Math.max(0, beforePoints - lost);
      appData.tree.points = newPoints;
      const realLost = beforePoints - newPoints;
      if (realLost > 0 && !silent) UIFX.toast('🌱 闲置' + gapDays + '天，树退化了' + realLost + '点');
      /* 退化到种子(0点) → 直接枯死（不需要再等缓冲）；
         注意：新种/复活后本来就在 0 点的种子不在此列，那是正常初始状态 */
      if (newPoints <= 0 && !appData.tree.dead) {
        appData.tree.dead = true;
        appData.tree.deadDate = getTodayStr();
        UIFX.toast('🥀 树已退化到种子（0🍅），枯死了。请到种树页重新种植（免费）或使用复活石复活');
        saveData();
      }
    }
  }
}
