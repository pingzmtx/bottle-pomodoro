/* ============================================================
 * 01e5 · 番茄树/商店/成长渲染域
 * 由 01e_engine_ui.js 按渲染域拆出（可回退）
 * 函数索引（TOC）：renderTreeShopWeather/renderTreeShopProp/renderTreeShopFun/renderTreeShop/_nextSelfRewardId/addSelfReward/claimSelfReward/removeSelfReward/switchShopTab/initShopWheel/openCoinLedger/renderCoinLedger（+40 更多）
 * ============================================================ */
function renderTreeShopWeather(tr) {
  /* () 已拆自 renderTreeShop：场景天气 区块原样搬移 */
  /* —— 场景天气（单选挂载，可轮换） —— */
  const weEl = document.getElementById('shopWeatherList');
  if (weEl) {
    weEl.innerHTML = TREE_WEATHER.map(function (w) {
      const exp = (tr.weatherExpires || {})[w.id];
      const active = tr.activeWeather === w.id && exp && exp > Date.now();
      /* 过期 = 未拥有：卡片恢复原样（此前只判"买没买过"，过期后永远停在"已到期"） */
      const owned = (tr.weather || []).includes(w.id) && !(exp && exp <= Date.now());
      const status = owned ? '✓ ' + treeRemainDays(exp) : '未拥有';
      /* 续费按钮此前只写「续7天/续30天」不标价，用户看不到要花多少金币。
         这里统一带上动态价格（与未拥有时的购买按钮同口径，均走 treePrice7/30）。 */
      const btn = owned
        ? '<span class="shop-btns"><button class="shop-btn small ' +
          (active ? 'used' : '') +
          '" onclick="useTreeWeather(\'' +
          w.id +
          '\')">' +
          (active ? '使用中' : '使用') +
          '</button><button class="shop-btn small renew" onclick="buyTreeRent(\'weather\',\'' +
          w.id +
          '\',7)">续7天 ' +
          treePrice7(w, tr.coins || 0) +
          '🪙</button><button class="shop-btn small renew" onclick="buyTreeRent(\'weather\',\'' +
          w.id +
          '\',30)">续30天 ' +
          treePrice30(w, tr.coins || 0) +
          '🪙</button></span>'
        : '<span class="shop-btns"><button class="shop-btn small" onclick="buyTreeRent(\'weather\',\'' +
          w.id +
          '\',7)">7天 ' +
          treePrice7(w, tr.coins || 0) +
          '🪙</button><button class="shop-btn small" onclick="buyTreeRent(\'weather\',\'' +
          w.id +
          '\',30)">30天 ' +
          treePrice30(w, tr.coins || 0) +
          '🪙</button></span>';
      return (
        '<div class="shop-item ' +
        _rarity(w.rent7) +
        (owned ? ' is-owned' : '') +
        '"><div class="shop-icon">' +
        w.icon +
        '</div><div class="shop-info"><div class="shop-name">' +
        w.name +
        '<span class="rarity-tag">' +
        _rarityLabel(_rarity(w.rent7)) +
        '</span>' +
        (owned ? '<span class="owned-tag">✓ 已拥有</span>' : '') +
        '</div><div class="shop-desc">' +
        status +
        ' · ' +
        w.desc +
        '</div></div>' +
        btn +
        '</div>'
      );
    }).join('');
  }
}

function renderTreeShopProp(tr) {
  /* () 已拆自 renderTreeShop：地面摆件 区块原样搬移 */
  /* —— 地面摆件（周租 or 买断；最多挂 2 个） —— */
  const propEl = document.getElementById('shopPropList');
  if (propEl) {
    propEl.innerHTML = TREE_PROPS.map(function (p) {
      const permanent = (tr.propExpires || {})[p.id] === 0;
      const exp = (tr.propExpires || {})[p.id];
      /* 过期 = 未拥有：卡片恢复原样 */
      const owned = permanent || (!!exp && exp > Date.now());
      const active = (tr.activeProps || []).includes(p.id);
      const expired = exp && exp <= Date.now();
      const status = owned ? (permanent ? '🏡 永久收藏' : expired ? '已到期' : '✓ ' + treeRemainDays(exp)) : '未拥有';
      let btn;
      if (owned) {
        btn =
          '<span class="shop-btns"><button class="shop-btn small ' +
          (active && !expired ? 'used' : '') +
          '" onclick="toggleTreeProp(\'' +
          p.id +
          '\')">' +
          (active && !expired ? '放置中' : '放置') +
          '</button>' +
          (permanent
            ? ''
            : '<button class="shop-btn small renew" onclick="buyTreeRent(\'prop\',\'' +
              p.id +
              '\',7)">续7天 ' +
              treePrice7(p, tr.coins || 0) +
              '🪙</button><button class="shop-btn small renew" onclick="buyTreeRent(\'prop\',\'' +
              p.id +
              '\',30)">续30天 ' +
              treePrice30(p, tr.coins || 0) +
              '🪙</button>') +
          '</span>';
      } else {
        btn =
          '<span class="shop-btns"><button class="shop-btn small" onclick="buyTreeRent(\'prop\',\'' +
          p.id +
          '\',7)">7天 ' +
          treePrice7(p, tr.coins || 0) +
          '🪙</button><button class="shop-btn small" onclick="buyTreeRent(\'prop\',\'' +
          p.id +
          '\',30)">30天 ' +
          treePrice30(p, tr.coins || 0) +
          '🪙</button><button class="shop-btn small buy" onclick="buyTreeProp(\'' +
          p.id +
          '\')">买断 ' +
          getDynamicPrice(p.buy, tr.coins || 0) +
          '🪙</button></span>';
      }
      return (
        '<div class="shop-item ' +
        _rarity(p.buy || p.rent7) +
        (permanent || (exp && !expired) ? ' is-owned' : '') +
        '"><div class="shop-icon">' +
        p.icon +
        '</div><div class="shop-info"><div class="shop-name">' +
        p.name +
        '<span class="rarity-tag">' +
        _rarityLabel(_rarity(p.buy || p.rent7)) +
        '</span>' +
        (permanent
          ? '<span class="owned-tag">✓ 永久</span>'
          : exp && !expired
            ? '<span class="owned-tag">✓ 已拥有</span>'
            : '') +
        '</div><div class="shop-desc">' +
        status +
        ' · ' +
        p.desc +
        '</div></div>' +
        btn +
        '</div>'
      );
    }).join('');
  }
}

function renderTreeShopFun(tr) {
  /* () 已拆自 renderTreeShop：运势+喂食+自我奖励 区块原样搬移 */
  /* —— 乐子：今日运势签 + 树投喂 + 自我奖励愿望清单 —— */
  const funEl = document.getElementById('shopFunList');
  if (funEl) {
    const ft = getFortune();
    const fc = tr.fortuneCount || 0;
    const fortuneBtn =
      fc >= 1
        ? '<span style="color:var(--text-light);font-size:var(--fs-note);">今日已抽，明天再来</span>'
        : '<button class="shop-btn small" onclick="drawFortune()">抽一签 ' +
          getDynamicPrice(20, tr.coins || 0) +
          '🪙（每天 1 次）</button>';
    const curFortune = ft
      ? '<div style="font-size:var(--fs-note);margin-top:var(--sp-6);background:rgba(0,0,0,.05);border-radius:var(--radius);padding:var(--sp-8) var(--sp-10);">今日运势：<b>' +
        ft.icon +
        ' ' +
        ft.name +
        '</b> · ' +
        ft.desc +
        '</div>'
      : '';
    const feedBtn =
      tr.lastFeedDate === getTodayStr()
        ? '<span style="color: var(--green-ink);font-size:var(--fs-note);">今天已经喂过啦，明天再喂</span>'
        : '<button class="shop-btn small" onclick="feedTree()">喂小食 ' +
          getDynamicPrice(20, tr.coins || 0) +
          '🪙</button>';
    /* 自我奖励愿望清单（用户自定义上架奖励，金币兑换兑现）。
        改：默认折叠成一行标题（不挡下方金币转盘），点开才显示表单与愿望列表 */
    const selfRewards = appData.selfRewards || [];
    const claimedCount = selfRewards.filter(function (r) {
      return r.claimed;
    }).length;
    const rewardItems = selfRewards
      .map(function (r) {
        const enough = (tr.coins || 0) >= r.price;
        /* 每个愿望显示攒钱进度条（已攒/目标），攒满才能兑换 */
        const pct = r.claimed ? 100 : Math.min(100, Math.round(((tr.coins || 0) / r.price) * 100));
        const progressBar =
          r.claimed || r.price <= 1
            ? ''
            : '<div style="margin-top:var(--sp-4);height:7px;background:var(--bg);border-radius:var(--radius-xs);overflow:hidden;"><div style="height:100%;width:' +
              pct +
              '%;background:linear-gradient(90deg,var(--primary),var(--yellow));border-radius:var(--radius-xs);transition:width .4s;"></div></div>' +
              '<div style="font-size:var(--fs-tiny);color:var(--text-light);margin-top:var(--sp-2);">攒钱进度 <b style="color:' +
              (enough ? 'var(--green)' : 'var(--primary)') +
              ';">' +
              pct +
              '%</b>（' +
              Math.min(tr.coins || 0, r.price) +
              '/' +
              r.price +
              '🪙）</div>';
        const claimBtn = r.claimed
          ? '<span style="color: var(--green-ink);font-size:var(--fs-caption);">✅ 已兑现</span>'
          : '<button class="shop-btn small" ' +
            (enough ? '' : 'disabled') +
            ' style="' +
            (enough ? '' : 'opacity:.45;') +
            'background:var(--fill-primary);color:var(--on-fill);" onclick="claimSelfReward(\'' +
            r.id +
            '\')">' +
            (enough ? '用 ' + r.price + '🪙 兑换' : '还差 ' + (r.price - (tr.coins || 0)) + '🪙') +
            '</button>';
        return (
          '<div class="shop-item" style="' +
          (r.claimed ? 'opacity:.6;background:rgba(92,184,92,.06);' : '') +
          '"><div class="shop-icon">' +
          (r.emoji || '🎁') +
          '</div><div class="shop-info"><div class="shop-name" style="' +
          (r.claimed ? 'text-decoration:line-through;' : '') +
          '">' +
          escapeHtml(r.name) +
          '</div><div class="shop-desc" style="font-size:var(--fs-note);">' +
          (r.claimed ? '已奖励自己 · ' : '') +
          r.price +
          '🪙' +
          progressBar +
          '</div></div><span class="shop-btns">' +
          claimBtn +
          '<button class="shop-btn small" style="background:#ECEFF1;color:var(--text-light);margin-left:var(--sp-4);" onclick="removeSelfReward(\'' +
          r.id +
          '\')" title="删除愿望">🗑️</button></span></div>'
        );
      })
      .join('');
    /* 添加愿望的 inline 表单（折叠体） */
    const addFormBody =
      '<div style="padding:var(--sp-10);background:rgba(255,255,255,.5);border:1px solid var(--hairline);border-radius:var(--radius-input);">' +
      '<div style="display:flex;gap:var(--sp-4);flex-wrap:wrap;align-items:center;font-size:var(--fs-note);">' +
      '<input id="selfRewardName" placeholder="奖励名称（一杯奶茶 / 半小时游戏…）" maxlength="14" style="flex:1;min-width:140px;padding:var(--sp-4) var(--sp-8);border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--card);color:var(--text);font-family:inherit;font-size:var(--fs-note);">' +
      '<input id="selfRewardPrice" type="number" min="1" max="9999" placeholder="金币" style="width:70px;padding:var(--sp-4) var(--sp-6);border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--card);color:var(--text);font-family:inherit;font-size:var(--fs-note);" title="需要多少金币才能兑换">' +
      '<select id="selfRewardEmoji" style="padding:var(--sp-4);border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--card);color:var(--text);font-size:var(--fs-body);cursor:pointer;">' +
      '<option value="🎁">🎁</option><option value="🍵">🍵</option><option value="☕">☕</option><option value="📱">📱</option><option value="🎮">🎮</option><option value="🍰">🍰</option><option value="🎬">🎬</option><option value="📚">📚</option><option value="🛁">🛁</option><option value="🎵">🎵</option><option value="🌸">🌸</option><option value="✨">✨</option></select>' +
      '<button class="shop-btn small" style="background:var(--fill-primary);color:var(--on-fill);font-weight:800;padding:var(--sp-4) var(--sp-12);" onclick="addSelfReward()">+ 添加</button>' +
      '</div>' +
      '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-4);">💡 设定一个值得的目标，专注攒金币，达成后认真兑现自己</div>' +
      (rewardItems
        ? rewardItems
        : '<div style="font-size:var(--fs-note);color:var(--text-light);text-align:center;padding:var(--sp-8) 0;margin-top:var(--sp-4);">还没有愿望 ✨ 先设一个吧</div>') +
      '</div>';
    /* 折叠头：一行标题 + 数量徽章 + 箭头（默认折叠，不挡下方转盘） */
    const addForm =
      '<div style="margin-top:var(--sp-10);">' +
      '<div onclick="toggleFold(\'selfRewardBody\',\'selfRewardArrow\')" style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-8) var(--sp-10);background:var(--bg);border:1px solid var(--hairline);border-radius:var(--radius-input);cursor:pointer;user-select:none;">' +
      '<span style="font-size:var(--fs-body);font-weight:800;color:var(--text);">🎁 自定义奖励' +
      (selfRewards.length
        ? ' <span style="font-size:var(--fs-caption);color:var(--text-light);font-weight:400;">（' +
          selfRewards.length +
          ' 个愿望' +
          (claimedCount ? ' · ' + claimedCount + ' 已兑现' : '') +
          '）</span>'
        : '') +
      '</span>' +
      '<span id="selfRewardArrow" style="font-size:var(--fs-body);color:var(--text-light);">▸</span>' +
      '</div>' +
      '<div id="selfRewardBody" style="display:none;margin-top:var(--sp-6);">' +
      addFormBody +
      '</div>' +
      '</div>';
    funEl.innerHTML =
      '<div class="shop-item"><div class="shop-icon">🎴</div><div class="shop-info"><div class="shop-name">今日运势签</div><div class="shop-desc" style="font-size:var(--fs-note);">抽吉凶，附轻微 buff（当日有效）。大吉加速成长，大凶树会毒舌你</div></div><span class="shop-btns">' +
      fortuneBtn +
      '</span></div>' +
      curFortune +
      '<div class="shop-item"><div class="shop-icon">🍪</div><div class="shop-info"><div class="shop-name">树的小食</div><div class="shop-desc" style="font-size:var(--fs-note);">喂小饼干/糖果，树今天会开心地撒娇（纯互动，无加成）</div></div><span class="shop-btns">' +
      feedBtn +
      '</span></div>' +
      addForm;
  }
}

function renderTreeShop() {
  const tr = appData.tree;
  checkTreeExpiry();
  getWeekCoinExchanged();
  /* 周番茄兑金币入口按钮：文案跟随 COIN_EX_RATE，避免常量改了标签没改 */
  const _ceb = document.getElementById('shopCoinExBtn');
  if (_ceb) _ceb.textContent = '🔄 周番茄兑金币（1🍅=' + COIN_EX_RATE + '🪙）';
  renderTreeShopDeco(tr);
  renderTreeShopScene(tr);
  resetWeekTomatoSpentIfNeeded();
  renderTreeShopBalance(tr);
  renderTreeShopItem(tr);
  renderTreeShopAura(tr);
  renderTreeShopWeather(tr);
  renderTreeShopProp(tr);
  renderTreeShopFun(tr);
}
/* ===== 自定义自我奖励商品（用户设愿望 + 金币兑现）===== */
let _selfRewardId = 0;
function _nextSelfRewardId() {
  return 'sr_' + Date.now() + '_' + _selfRewardId++;
}
function addSelfReward() {
  const nameEl = document.getElementById('selfRewardName');
  const priceEl = document.getElementById('selfRewardPrice');
  const emojiEl = document.getElementById('selfRewardEmoji');
  if (!nameEl || !priceEl) return;
  const name = (nameEl.value || '').trim();
  const price = parseInt(priceEl.value);
  const emoji = emojiEl ? emojiEl.value : '🎁';
  if (!name) {
    showToast('请输入奖励名称');
    return;
  }
  if (name.length > 14) {
    showToast('名称太长（≤14 字）');
    return;
  }
  if (!price || price < 1) {
    showToast('请设置合理的金币数（≥1）');
    return;
  }
  if (!Array.isArray(appData.selfRewards)) appData.selfRewards = [];
  appData.selfRewards.push({ id: _nextSelfRewardId(), name: name, emoji: emoji, price: price, claimed: false });
  saveData();
  nameEl.value = '';
  priceEl.value = '';
  showToast('🎁 愿望已加入清单：' + emoji + ' ' + name + '（' + price + '🪙）');
  renderTreeShop();
}
function claimSelfReward(id) {
  const list = appData.selfRewards || [];
  const r = list.find(function (x) {
    return idEq(x.id, id);
  });
  if (!r || r.claimed) return;
  const coins = appData.tree.coins || 0;
  if (coins < r.price) {
    playSound('error');
    /* 微反馈：金币不足时给这条愿望抖一下（视觉+听觉双重反馈） */
    const _liel = document.querySelector('#shopFunList .shop-item'); /* 任意找第一条用户能看到的地方触发 */
    if (_liel) shakeEl(_liel);
    showToast('🪙 金币不足，还差 ' + (r.price - coins) + '🪙');
    return;
  }
  coinSpend(r.price, 'redeem', '兑换自我奖励：' + r.emoji + ' ' + r.name);
  r.claimed = true;
  r.claimedDate = getTodayStr();
  saveData();
  renderTreeShop();
  /* 兑换自我奖励不弹「系统奖励」弹窗（showGift 标题固定"系统奖励"且会把 -1🪙 显示成 ±-1，混淆）。
     改用独立 toast + 弹跳，明确告知这是「自己兑换自己的奖励」 */
  playSound('reward');
  const _card = document.querySelector('#shopFunList .shop-item');
  if (_card) popEl(_card);
  showToast(
    '🎁 自我奖励已兑现：' + r.emoji + ' ' + escapeHtml(r.name) + '（-' + r.price + '🪙）——奖励自己，说到做到！',
    true
  );
}
function removeSelfReward(id) {
  const list = appData.selfRewards || [];
  const i = list.findIndex(function (x) {
    return idEq(x.id, id);
  });
  if (i < 0) return;
  const r = list[i];
  if (r.claimed) {
    showToast('已兑现的愿望会在记账时一起显示，这里先保留吧');
  }
  list.splice(i, 1);
  saveData();
  renderTreeShop();
}
function switchShopTab(tab) {
  const tabs = ['deco', 'scene', 'aura', 'weather', 'prop', 'item', 'skin', 'fun'];
  document.querySelectorAll('#treeShopModal .shop-tab').forEach(function (t, i) {
    t.classList.toggle('active', tabs.indexOf(tab) === i);
  });
  document.getElementById('shopDecoList').style.display = tab === 'deco' ? 'block' : 'none';
  document.getElementById('shopSceneList').style.display = tab === 'scene' ? 'block' : 'none';
  document.getElementById('shopAuraList').style.display = tab === 'aura' ? 'block' : 'none';
  document.getElementById('shopWeatherList').style.display = tab === 'weather' ? 'block' : 'none';
  document.getElementById('shopPropList').style.display = tab === 'prop' ? 'block' : 'none';
  document.getElementById('shopItemList').style.display = tab === 'item' ? 'block' : 'none';
  document.getElementById('shopSkinList').style.display = tab === 'skin' ? 'block' : 'none';
  if (tab === 'skin') renderSkinShop();
  document.getElementById('shopFunList').style.display = tab === 'fun' ? 'block' : 'none';
  document.getElementById('shopWheelBox').style.display = tab === 'fun' ? 'block' : 'none';
  if (tab === 'fun') initShopWheel();
}
function initShopWheel() {
  const sw = document.getElementById('shopWheel');
  if (sw && !sw.innerHTML) sw.innerHTML = buildWheelSVG(SHOP_WHEEL_REWARDS);
  renderShopWheelLegend();
  const btn = document.getElementById('shopWheelBtn');
  const _wc = getDynamicPrice(50, appData.tree.coins || 0);
  if (btn) btn.disabled = (appData.tree.coins || 0) < _wc;
  const _wt = document.getElementById('shopWheelTip');
  if (_wt) _wt.innerHTML = '花 <b style="color: var(--yellow-ink);">' + _wc + '🪙</b> 转一次 · 最低也有 +20，大奖随缘';
}
/* ================= 金币明细（账本流水面板） =================
   读的是 01d3 的账本（appData.tree.coinLog），这里只负责渲染与「撤销」交互。
   ★ 撤销写的是**反向流水**（见 01d3 的 coinUndo），不删原条目 ——
     所以撤完刷新列表，原条目还在、只是多了一行「撤销回滚」，账可回看。 */
function openCoinLedger() {
  renderCoinLedger();
  showModal('coinLedgerModal');
}
function renderCoinLedger() {
  const listEl = document.getElementById('coinLedgerList');
  const sumEl = document.getElementById('coinLedgerSummary');
  if (!listEl) return;
  const log = coinLedgerInit();
  const chk = coinLedgerCheck();
  if (sumEl) {
    let h =
      '当前余额 <b style="color: var(--yellow-ink)">🪙 ' + chk.balance + '</b>' +
      '　·　账本 ' + log.length + ' 笔';
    if (chk.diff !== 0) {
      /* 对不上时给出口，而不是静默 —— 差额本身也是线索（导入脏数据/漏改的旧调用点） */
      h +=
        '<br><span style="color:#C0392B">⚠️ 账目对不上（差额 ' + chk.diff + '）</span> ' +
        '<button class="coin-ledger-undo" onclick="coinLedgerFix()">对账修正</button>';
    }
    sumEl.innerHTML = h;
  }
  if (!log.length) {
    listEl.innerHTML =
      '<div class="coin-ledger-empty">还没有任何金币记录<br>完成专注、签到或买道具后会逐笔记在这里</div>';
    return;
  }
  /* 新的在上（账本是 append 序） */
  listEl.innerHTML = log
    .slice()
    .reverse()
    .map(function (t) {
      const up = Number(t.amount) > 0;
      const isRev = String(t.type) === 'undo';
      const cls = 'coin-ledger-amt' + (up ? '' : ' down') + (isRev ? ' rev' : '');
      const when = fmtTime(new Date(t.at));
      const day = typeof getDateStr === 'function' ? getDateStr(new Date(t.at)) : '';
      let h =
        '<div class="coin-ledger-row">' +
        '<div class="coin-ledger-meta">' +
        '<div class="coin-ledger-rsn">' + escapeHtml(t.reason || coinTxTypeLabel(t.type)) + '</div>' +
        '<div class="coin-ledger-sub">' + day + ' ' + when + '　·　' + escapeHtml(coinTxTypeLabel(t.type)) +
        '　·　余额 ' + t.after + '</div>' +
        '</div>' +
        '<div class="' + cls + '">' + (up ? '+' : '') + t.amount + '</div>';
      if (coinTxUndoable(log, t.id)) {
        h += '<button class="coin-ledger-undo" onclick="coinLedgerUndo(\'' + t.id + '\')">撤销</button>';
      }
      return h + '</div>';
    })
    .join('');
}
/* 面板上的「撤销」：成功与否都给明确反馈，不静默 */
function coinLedgerUndo(id) {
  const okDone = coinUndo(id);
  renderCoinLedger();
  renderTreeSection();
  renderTreeShop();
  showToast(okDone ? '↩️ 已撤销该笔（余额已回退）' : '这笔撤不了（已撤过，或余额不足以收回）');
}
/* 罕见路径：账目真的对不上时手动补差额 */
function coinLedgerFix() {
  const r = coinLedgerRebalance();
  saveData();
  renderCoinLedger();
  renderTreeSection();
  showToast('🧾 已补记差额 ' + r.diff + '🪙（账目已对平）');
}
function openTreeShop() {
  try {
    renderTreeShop();
  } catch (e) { if (window.__silent) window.__silent(e, '01e5:openTreeShop'); }
  showModal('treeShopModal');
}
/* 树种图鉴折叠开关（默认收起，点击标题展开） */
function toggleSpeciesAlbum() {
  const list = document.getElementById('speciesAlbumList');
  const arrow = document.getElementById('speciesAlbumArrow');
  if (!list) return;
  const show = list.style.display !== 'none';
  list.style.display = show ? 'none' : 'block';
  if (arrow) arrow.textContent = show ? '▸' : '▾';
}
/* 树种图鉴：5 棵树各自的 9 阶收集展示。未解锁 / 收集中文案 / 9/9 全收集 */
function renderSpeciesAlbum() {
  const box = document.getElementById('speciesAlbumBox');
  if (!box) return;
  const tr = appData.tree;
  const curSid = tr.species || 'tomato';
  let doneCount = 0;
  const html = Object.keys(TREE_SPECIES)
    .map(function (sid) {
      const sp = TREE_SPECIES[sid];
      const album = tr.speciesAlbum && Array.isArray(tr.speciesAlbum[sid]) ? tr.speciesAlbum[sid] : [];
      const unlocked =
        (tr.unlockedSpecies || ['tomato']).indexOf(sid) >= 0 || (tr.plantedSpecies || []).indexOf(sid) >= 0;
      const full = album.length >= 9;
      if (full) doneCount++;
      const stages = SPECIES_STAGES[sid] || SPECIES_STAGES.tomato;
      let stateHtml;
      if (!unlocked) stateHtml = '<span class="sc-state locked">🔒 集齐' + speciesPrevName(sid) + '图鉴解锁</span>';
      else if (full) stateHtml = '<span class="sc-state done">👑 全收集</span>';
      else stateHtml = '<span class="sc-state part">' + album.length + '/9</span>';
      const cells = stages
        .map(function (s, i) {
          if (!unlocked) return '<div class="ss-cell lock">🔒</div>';
          const lit = album.indexOf(i + 1) >= 0;
          return (
            '<div class="ss-cell' +
            (lit ? ' lit' : '') +
            '" title="' +
            (lit ? '已达成' : '未达成') +
            ' · ' +
            s.name +
            '">' +
            s.emoji +
            '</div>'
          );
        })
        .join('');
      return (
        '<div class="species-card' +
        (sid === curSid ? ' current' : '') +
        '"><div class="species-card-head"><span class="sc-icon">' +
        sp.icon +
        '</span><span style="color:' +
        sp.color +
        ';">' +
        sp.name +
        '</span>' +
        (sid === curSid ? '<span style="font-size:var(--fs-caption);color:var(--text-light);font-weight:400;">当前</span>' : '') +
        stateHtml +
        '</div><div class="species-stages">' +
        cells +
        '</div></div>'
      );
    })
    .join('');
  const listEl = document.getElementById('speciesAlbumList');
  if (listEl) listEl.innerHTML = html;
  const pEl = document.getElementById('speciesAlbumProgress');
  if (pEl) pEl.textContent = doneCount + '/5 树';
}
/* 树命名 */
function openTreeNameModal() {
  const sid = appData.tree.species || 'tomato';
  const sp = TREE_SPECIES[sid];
  const inp = document.getElementById('treeNameInput');
  /* 预填当前生效的名字（自定义或默认名），改起来更方便 */
  if (inp) {
    inp.value = (appData.tree.treeNames || {})[sid] || DEFAULT_TREE_NAMES[sid] || '';
    inp.placeholder = '默认名「' + (DEFAULT_TREE_NAMES[sid] || sp.name) + '」，可改成你喜欢的';
  }
  const icon = document.getElementById('treeNameModalIcon');
  if (icon) icon.textContent = sp.icon;
  /* 改名卡状态提示：改名（含首次起名）一律消耗 1 张改名卡 */
  const hint = document.getElementById('renameCardHint');
  const cards = (appData.tree.inventory || {}).renameCard || 0;
  if (hint) {
    if (cards > 0)
      hint.innerHTML =
        '<span style="color: var(--yellow-ink);">✏️ 本次改名将消耗 1 张改名卡（持有 ' + cards + ' 张）</span>';
    else hint.innerHTML = '<span style="color:var(--danger);">🛒 改名需要改名卡（持有 0 张），请到商店购买</span>';
  }
  showModal('treeNameModal');
  setTimeout(function () {
    if (inp) {
      inp.focus();
      inp.select();
    }
  }, 100);
}
function saveTreeName() {
  const sid = appData.tree.species || 'tomato';
  const sp = TREE_SPECIES[sid];
  const inp = document.getElementById('treeNameInput');
  const name = inp ? (inp.value || '').trim() : '';
  if (!appData.tree.treeNames) appData.tree.treeNames = {};
  const existing = (appData.tree.treeNames[sid] || '').trim();
  /* 改名卡机制：只要最终名字真的会改变（首次起名、二次改名都算），就需要消耗 1 张改名卡；
     保持默认/恢复默认/名字没变 → 免费 */
  const effName = name && name !== (DEFAULT_TREE_NAMES[sid] || '') ? name : '';
  if (effName && effName !== existing) {
    const cards = (appData.tree.inventory || {}).renameCard || 0;
    if (cards <= 0) {
      showToast('✏️ 改名需要改名卡（200🪙），请到商店购买');
      return; /* 不关闭弹窗，让用户先去买卡 */
    }
    appData.tree.inventory.renameCard = cards - 1;
  }
  /* 和默认名一样时视为「保持默认」，数据更干净 */
  appData.tree.treeNames[sid] = name && name !== (DEFAULT_TREE_NAMES[sid] || '') ? name : '';
  saveData();
  closeModal('treeNameModal');
  renderTreeSection();
  renderTimerTree();
  const eff = treeDisplayName(sid);
  showToast(
    name
      ? name === (DEFAULT_TREE_NAMES[sid] || '')
        ? sp.name + '保持默认名「' + eff + '」'
        : '💕 ' + sp.name + '有了新名字：「' + name + '」'
      : sp.name + '保持默认名「' + eff + '」'
  );
}
function clearTreeName() {
  const sid = appData.tree.species || 'tomato';
  const sp = TREE_SPECIES[sid];
  if (!appData.tree.treeNames) appData.tree.treeNames = {};
  delete appData.tree.treeNames[sid];
  saveData();
  closeModal('treeNameModal');
  renderTreeSection();
  renderTimerTree();
  showToast(sp.name + '恢复默认名「' + (DEFAULT_TREE_NAMES[sid] || sp.name) + '」');
}
/* 树成长动画 + 飘字反馈 */
function playTreeGrowAnim(p) {
  const v = document.getElementById('treeVisual');
  if (v) {
    v.classList.remove('growing');
    void v.offsetWidth;
    v.classList.add('growing');
    setTimeout(function () {
      v.classList.remove('growing');
    }, 600);
  }
  const wrap = document.querySelector('.tree-visual-wrap');
  if (wrap) {
    const f = document.createElement('div');
    f.className = 'tree-grow-float';
    f.textContent = '+' + (p % 1 === 0 ? p : p.toFixed(1)) + ' 🌱';
    wrap.appendChild(f);
    setTimeout(function () {
      if (f.parentNode) f.parentNode.removeChild(f);
    }, 1000);
  }
}
/* 未种植的树：点查看后显示种植确认条，明确点「确认种植」才种下 */
function showTreePlantPreview(id) {
  const el = document.getElementById('treePlantConfirm');
  if (!el || !TREE_SPECIES[id]) return;
  const s = TREE_SPECIES[id];
  const stages = SPECIES_STAGES[id] || SPECIES_STAGES.tomato;
  const st = stages[0] || { emoji: '🌱', name: '种子' };
  el.innerHTML =
    '🌱 这是新解锁的<b>' +
    s.icon +
    ' ' +
    s.name +
    '</b>（' +
    st.emoji +
    ' ' +
    st.name +
    '起步）<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-2);">确认种植后将从此树重新成长，当前树的进度会保留，可随时切回</div>' +
    '<div style="display:flex;gap:var(--sp-8);margin-top:var(--sp-8);">' +
    '<button class="tree-lottery-btn" style="flex:1;" onclick="plantSpecies(\'' +
    id +
    '\')">🌱 确认种植</button>' +
    '<button class="btn-small" style="flex:1;" onclick="hideTreePlantPreview()">取消</button>' +
    '</div>';
  el.style.display = 'block';
  el.scrollIntoView({ block: 'nearest' });
}
function hideTreePlantPreview() {
  const el = document.getElementById('treePlantConfirm');
  if (el) el.style.display = 'none';
}
/* 里程碑庆祝弹窗 */
function showTreeMilestone(oldStage, newStage) {
  const overlay = document.getElementById('treeMilestoneOverlay');
  if (!overlay) return;
  document.getElementById('tmOldEmoji').textContent = oldStage.emoji;
  document.getElementById('tmNewEmoji').textContent = newStage.emoji;
  document.getElementById('tmTitle').textContent = '进化成功！';
  document.getElementById('tmSubtitle').textContent = newStage.name;
  const title = getTreeTitle(appData.tree.peakPoints || 0);
  document.getElementById('tmPoints').textContent =
    '🍅 ' + appData.tree.points + ' 积分 · ' + title.icon + ' ' + title.name;
  overlay.classList.add('show');
  /* 图鉴进度展示 */
  const album = ensureTreeAlbum();
  const albumEl = document.getElementById('tmAlbum');
  if (albumEl) {
    albumEl.textContent =
      album.length >= 9
        ? '🎁 成长图鉴 9/9 · 「万物园丁」达成！'
        : '🎁 成长图鉴 ' + album.length + '/9 · 继续种番茄点亮全部阶段';
  }
  /* 生成五彩纸屑 */
  const card = overlay.querySelector('.tree-milestone-card');
  if (card) {
    card.querySelectorAll('.tm-confetti').forEach(c => c.remove());
    const colors = ['#E85D3A', '#5CB85C', '#5B9BD5', '#F0AD4E', '#9B59B6', '#FFD700'];
    for (let i = 0; i < 20; i++) {
      const c = document.createElement('div');
      c.className = 'tm-confetti';
      c.style.background = colors[i % colors.length];
      c.style.left = Math.random() * 100 + '%';
      c.style.top = '0';
      c.style.animationDelay = Math.random() * 0.5 + 's';
      card.appendChild(c);
    }
  }
}
function closeTreeMilestone() {
  const o = document.getElementById('treeMilestoneOverlay');
  if (o) o.classList.remove('show');
}
/* 渲染番茄树区域（在 renderStats 中调用） */
let _speciesBarOpen = false; /* 树种选择器折叠状态：默认只显示本季推荐+当前树 */
function toggleSpeciesBar() {
  _speciesBarOpen = !_speciesBarOpen;
  renderTreeSection();
}
/* 连续专注天数断了 → 显示商城恢复卡指引横幅 */
function renderStreakBreakBanner() {
  const el = document.getElementById('streakBreakBanner');
  if (!el) return;
  const hist = appData.tree.streakHistory || [];
  let broken = false;
  if (hist.length >= 2) {
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    /* 昨天还连续 N 天、今天连续变少 → 断了（3 天内可用恢复卡找回） */
    if (prev.streak > 0 && last.streak < prev.streak) broken = true;
  }
  el.style.display = broken ? 'block' : 'none';
}
function goBuyStreakRecover() {
  openTreeShop();
  setTimeout(function () {
    const items = [].slice.call(document.querySelectorAll('#shopItemList .shop-item'));
    const target = items.find(function (it) {
      return it.textContent.indexOf('连续天数恢复卡') >= 0;
    });
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.style.transition = 'box-shadow .3s';
      target.style.boxShadow = '0 0 0 3px var(--yellow)';
      setTimeout(function () {
        target.style.boxShadow = '';
      }, 2500);
    }
  }, 250);
}
/* 成长 Buff 显示条：转盘「今日+15%」 + 今日运势成长 buff，展示各自来源与总倍率 */
function renderGrowthBuffBar() {
  const el = document.getElementById('treeGrowthBuffBar');
  if (!el) return;
  const tr = appData.tree;
  const fort = getFortune();
  const dBoost = typeof tr.dailyGrowBoost === 'number' ? tr.dailyGrowBoost : 1;
  const chips = [];
  if (dBoost > 1)
    chips.push(
      '<span style="font-size:var(--fs-caption);font-weight:700;color: var(--green-ink);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-2) var(--sp-8);">🌱 转盘 · 今日成长 +15%</span>'
    );
  if (fort && fort.buff && fort.buff.growth) {
    const g = fort.buff.growth;
    const pct = Math.round((g - 1) * 100);
    const txt = (pct > 0 ? '+' : '') + pct + '%';
    const color = pct >= 0 ? 'var(--green)' : 'var(--primary)';
    chips.push(
      '<span style="font-size:var(--fs-caption);font-weight:700;color:' +
        color +
        ';background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-2) var(--sp-8);">' +
        fort.icon +
        ' 运势 · ' +
        fort.name +
        ' ' +
        txt +
        '</span>'
    );
  }
  if (!chips.length) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  const total = ((fort && fort.buff && fort.buff.growth) || 1) * dBoost;
  const totalPct = Math.round((total - 1) * 100);
  el.style.display = 'flex';
  el.innerHTML =
    '<span style="font-size:var(--fs-caption);color:var(--text-light);font-weight:700;">✨ Buff：</span>' +
    chips.join('') +
    '<span style="font-size:var(--fs-caption);font-weight:800;color: var(--yellow-ink);">合计 ×' +
    total.toFixed(2) +
    '（' +
    (totalPct > 0 ? '+' : '') +
    totalPct +
    '%）</span>';
}
function treeTalk() {
  const v = document.getElementById('treeVisual');
  if (v) {
    v.classList.remove('growing');
    void v.offsetWidth;
    v.classList.add('growing');
    setTimeout(function () {
      v.classList.remove('growing');
    }, 600);
  }
  const tr = appData.tree;
  const today = getTodayStr();
  /* 今日首次触碰植物 → 送 5 金币（以对话聊天窗告知；中吉运势翻倍） */
  const touchBonus = getFortune() && getFortune().buff && getFortune().buff.touch ? getFortune().buff.touch : 5;
  if (tr.lastTouchBonusDate !== today) {
    tr.lastTouchBonusDate = today;
    saveData();
    const _b = document.getElementById('treeBubble');
    if (_b) {
      _b.textContent = '主人来看我啦～送你 ' + touchBonus + ' 金币 💰 明天再来哦';
      _b.classList.remove('show');
      void _b.offsetWidth;
      _b.classList.add('show');
      clearTimeout(_b._t);
      _b._t = setTimeout(function () {
        _b.classList.remove('show');
      }, 2600);
    }
    showGift('🌱 今日首次触碰植物，小树开心地送你', touchBonus);
    return;
  }
  const hour = new Date().getHours();
  let msg;
  let companionSid = tr.species || 'tomato'; /* 当前种植的树种，用于含名对话 */
  let st = getTreeStage(tr.points || 0);
  let mood = getTreeMood();
  let noTomato = tr.lastActiveDate !== today;
  let noWater = tr.lastWaterDate !== today;
  /* 不开心时优先说原因 */
  if (mood.fade >= 0.6) {
    if (noTomato && noWater) {
      msg = '你已经很久没来看我了😢 今天还没完成番茄🍅也没浇水💧，来陪陪我吧~';
    } else if (noTomato) {
      msg = '你今天还没完成番茄呢🍅 我好想陪你一起专注呀~';
    } else if (noWater) {
      msg = '我有点渴了💧 浇浇水我就精神啦~';
    } else {
      msg = '我有点想你了😟 多来看看我呀~';
    }
  } else if (mood.fade >= 0.35) {
    if (noTomato && noWater) {
      msg = '今天还没完成番茄🍅也没浇水💧，来一个吧，我陪你~';
    } else if (noTomato) {
      msg = '今天还没完成番茄哦🍅 来一个吧，我陪你~';
    } else if (noWater) {
      msg = '今天还没浇水呢💧 我有点干干的~';
    } else if (hour < 6) {
      msg = pickTalk(TREE_TALKS_TIME.midnight);
    } else if (hour >= 22) {
      msg = pickTalk(TREE_TALKS_TIME.late);
    } else {
      msg = randomTreeTalk(companionSid);
    }
  } else if (noWater) {
    msg = '主人好久没浇水了💧 浇一下我更有精神~';
  } else if (hour < 6) {
    msg = timedTalk(hour, companionSid);
  } else if (hour < 9) {
    msg = timedTalk(hour, companionSid);
  } else if (st && (st.name === '种子' || st.name === '嫩芽' || st.name === '幼苗') && Math.random() < 0.5) {
    /* 早期阶段：一半概率说成长引导话，一半交给时段话术 */
    msg =
      st.name === '种子'
        ? '我是颗小种子🌱 等你浇水把我唤醒~'
        : st.name === '嫩芽'
          ? '我发芽啦🌿 都是你浇灌的功劳！'
          : '正在努力长高中🌾 你也一起加油呀';
  } else {
    msg = timedTalk(hour, companionSid);
  } /* 原 <12/<14/<17/<19/<22/else 六分支行为全部相同，合并为一次调用 */
  /* 喂食后当天：用户再点一下树，树会再口头感谢一次（用完即恢复正常） */
  if (_feedThanksLeft > 0 && tr.lastFeedDate === getTodayStr()) {
    _feedThanksLeft--;
    msg = FEED_THANKS_TALKS[Math.floor(Math.random() * FEED_THANKS_TALKS.length)];
  }
  /* 大凶运势：开启毒舌模式，树会多吐槽你（纯娱乐无数值） */
  if (getFortune() && getFortune().buff && getFortune().buff.dark && Math.random() < 0.4) {
    msg = TREE_DARK_TALKS[Math.floor(Math.random() * TREE_DARK_TALKS.length)];
  }
  const b = document.getElementById('treeBubble');
  if (b) {
    b.textContent = msg;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(b._t);
    b._t = setTimeout(function () {
      b.classList.remove('show');
    }, 2600);
  }
}
let _pendingFeedThanks = null;
let _feedThanksLeft = 0;
const FEED_THANKS_TALKS = [
  '主人又来看我啦～今天的小饼干还回味着呢😋',
  '嘿嘿，吃了主人的小食，我浑身都是干劲！',
  '主人～谢谢你今天的投喂，我会记得很久的💕',
  '刚吃饱饱的，现在精神百倍，快开始专注吧！'
];
function feedTree() {
  const tr = appData.tree;
  if (tr.lastFeedDate === getTodayStr()) {
    showToast('今天已经喂过啦，明天再喂');
    return;
  }
  const _fdCost = getDynamicPrice(20, tr.coins || 0);
  if ((tr.coins || 0) < _fdCost) {
    showToast('🪙 果实币不足（需 ' + _fdCost + '）');
    return;
  }
  coinSpend(_fdCost, 'shop', '喂食小饼干');
  tr.lastFeedDate = getTodayStr();
  saveData();
  _feedThanksLeft = 2; /* 当天留 2 次口头感谢：关店气泡 + 点击树 */
  const feeds = [
    '咔嚓咔嚓～小饼干真好吃，谢谢主人！🍪',
    '唔～糖糖好甜！我今天会超有干劲的！🍬',
    '嗷呜一口！主人喂的什么都好吃😋',
    '吃完小食，我打个饱嗝：嗝～要努力长高高！🌱'
  ];
  const thanks = feeds[Math.floor(Math.random() * feeds.length)];
  const shopOpen =
    document.getElementById('treeShopModal') && document.getElementById('treeShopModal').classList.contains('show');
  if (shopOpen) {
    /* 弹窗开着时气泡被遮：先用 toast 告知，关掉商店后树苗再亲口感谢 */
    showToast('🍪 树吃得很开心，关掉商店它会亲口感谢你~');
    _pendingFeedThanks = thanks;
  } else {
    const _b = document.getElementById('treeBubble');
    if (_b) {
      _b.textContent = thanks;
      _b.classList.remove('show');
      void _b.offsetWidth;
      _b.classList.add('show');
      clearTimeout(_b._t);
      _b._t = setTimeout(function () {
        _b.classList.remove('show');
      }, 2600);
    }
  }
  renderTreeShop();
}
function toggleMystery() {
  const list = document.getElementById('mysteryTaskList');
  const arrow = document.getElementById('mysteryArrow');
  const tip = document.getElementById('mysteryTip');
  if (!list) return;
  const show = list.style.display !== 'none';
  list.style.display = show ? 'none' : 'block';
  if (arrow) arrow.textContent = show ? '▸' : '▾';
  if (tip) tip.style.display = show ? 'none' : 'block';
  if (!show) renderMysteryTasks();
}
function renderMysteryTasks() {
  const list = document.getElementById('mysteryTaskList');
  if (!list) return;
  const mt = ensureMysteryTasks();
  if (!mt || !mt.tasks) return;
  list.innerHTML = mt.tasks
    .map(function (t, i) {
      const def = MYSTERY_POOL.find(function (p) {
        return p.id === t.id;
      });
      if (!def) return '';
      let stateHtml;
      if (t.claimed) stateHtml = '<span style="color: var(--green-ink);font-size:var(--fs-note);font-weight:700;">✅ 已领取</span>';
      else if (t.done)
        stateHtml = '<button class="mystery-claim" onclick="claimMysteryTask(' + i + ')">🎁 领 8🪙</button>';
      else stateHtml = '<span style="color:var(--text-light);font-size:var(--fs-note);">未完成</span>';
      return (
        '<div class="mystery-row' +
        (t.done ? ' done' : '') +
        '"><span class="ms-icon">' +
        def.icon +
        '</span><span class="ms-info"><span class="ms-name">' +
        def.name +
        '</span><span class="ms-desc">' +
        def.desc +
        '</span></span><span class="ms-state">' +
        stateHtml +
        '</span></div>'
      );
    })
    .join('');
}
function doTreeLottery() {
  const tr = appData.tree;
  /* 次数每次现算（由 records 派生），不信内存里的旧值 —— 补记/删除/改类型后额度会变 */
  const cnt = syncLotteryCount();
  if (cnt <= 0) {
    showToast('没有抽奖次数啦～完成一个番茄🍅就能抽一次');
    return;
  }
  tr.lotteryUsed = (tr.lotteryUsed || 0) + 1; /* 已抽数单调递增：删记录不退次数 */
  syncLotteryCount();
  const reward = treeLotteryReward();
  coinEarn(reward, 'gacha', '番茄抽奖（每 ' + LOT_PER_DRAW + ' 个🍅 一次）');
  saveData();
  const res = document.getElementById('treeLotteryResult');
  if (res) {
    res.innerHTML =
      '🪙 +' +
      reward +
      (reward >= 8
        ? ' <span class="tl-lucky">✨ 手气爆棚！</span>'
        : reward >= 5
          ? ' <span class="tl-lucky">不错哦！</span>'
          : '');
    res.classList.remove('tl-pop');
    void res.offsetWidth;
    res.classList.add('tl-pop');
  }
  renderTreeSection();
  renderTreeShop();
  if (reward >= 8) showToast('✨ 恭喜抽中 ' + reward + ' 金币！');
}
/* 履历墙 HTML（可折叠） */
function renderTreeLifeLog() {
  const box = document.getElementById('treeLifeLogBox');
  if (!box) return;
  const tr = appData.tree;
  const ll = (tr && tr.treeLifeLog) || { planted: {}, maxed: {}, stars: [] };
  const sid = tr.species || 'tomato';
  const sp = TREE_SPECIES[sid] || TREE_SPECIES.tomato;
  const stars = (ll.stars || []).slice().sort(function (a, b) {
    return b.n - a.n;
  });
  const totalStars = getEternalStars((tr && tr.points) || 0);
  const planted = ll.planted && ll.planted[sid];
  const maxed = ll.maxed && ll.maxed[sid];
  let h = '';
  h +=
    '<div class="tll-row"><span class="tll-k">🌱 种下</span><span class="tll-v">' +
    (planted || '<span class="tll-unknown">早于本功能上线</span>') +
    '</span></div>';
  h +=
    '<div class="tll-row"><span class="tll-k">👑 满级</span><span class="tll-v">' +
    (maxed || '尚未满级') +
    '</span></div>';
  /* 树龄里程碑（时间线，与积分无关）：十几年后这里是最长的一份纪念册 */
  const ages = (ll.ages || []).slice().sort(function (a, b) {
    return b.days - a.days;
  });
  if (ages.length) {
    h += '<div class="tll-sep">🌳 树龄 · 陪伴里程碑</div>';
    h += ages
      .slice(0, 10)
      .map(function (x) {
        const t = treeAgeTierByDays(x.days);
        const label = t ? t.icon + ' ' + t.name : '陪伴 ' + fmtDays(x.days) + ' 天';
        return '<div class="tll-row"><span class="tll-k">' + label + '</span><span class="tll-v">' + x.date + '</span></div>';
      })
      .join('');
  }
  /* 年度回顾：每满一周年结一次账（番茄 / 天数 / 分钟） */
  const annual = (ll.annual || []).slice().sort(function (a, b) {
    return (b.year || 0) - (a.year || 0);
  });
  if (annual.length) {
    h += '<div class="tll-sep">📅 年度回顾</div>';
    h += annual
      .slice(0, 10)
      .map(function (x) {
        return (
          '<div class="tll-row"><span class="tll-k">第 ' +
          x.year +
          ' 年</span><span class="tll-v">' +
          fmtTomatoNum(x.tomato) +
          ' 个番茄 · ' +
          (x.days || 0) +
          ' 天 · ' +
          fmtMinUnit(x.minutes || 0).num +
          fmtMinUnit(x.minutes || 0).unit +
          '</span></div>'
        );
      })
      .join('');
  }
  if (stars.length) {
    const show = stars.slice(0, 8);
    h += '<div class="tll-sep">🪵 年轮 · 共 ' + totalStars + ' 圈</div>';
    h += '<div class="tll-note">履历从本次更新开始记录，更早的树只显示状态、没有日期</div>';
    h += show
      .map(function (x) {
        return (
          '<div class="tll-row"><span class="tll-k">🪵 第 ' +
          x.n +
          ' 圈</span><span class="tll-v">' +
          x.date +
          '</span></div>'
        );
      })
      .join('');
    if (totalStars > show.length) {
      h += '<div class="tll-more">…以及更早的 ' + (totalStars - show.length) + ' 颗（早于本功能上线，未记日期）</div>';
    }
  } else {
    h += '<div class="tll-empty">还没有年轮 · 满级（200🍅）后每 50 分长一圈</div>';
  }
  box.innerHTML = h;
}
function toggleTreeLifeLog() {
  const b = document.getElementById('treeLifeLogBody');
  const a = document.getElementById('treeLifeLogArrow');
  if (!b) return;
  const open = b.style.display === 'none';
  b.style.display = open ? 'block' : 'none';
  if (a) a.textContent = open ? '▾' : '▸';
}
/* ===== renderTreeSection 区块拆分 =====
 * 纯平移：场景/树种/树视觉/成长数据 4 大功能块原样搬为独立顶层函数（紧贴本函数上方），
 * 各 helper 只读 appData.tree 上下文（顶部量按引用闭包各自前置），函数间无交叉依赖。
  */
function renderTreeSceneBlock() {
  const tr = appData.tree;
  /* 树场景背景：class 主题 + 氛围点缀层 + 天气层 */
  const sceneEl = document.getElementById('treeScene');
  if (sceneEl) {
    const scene =
      TREE_SCENES.find(function (s) {
        return s.id === (appData.tree.activeScene || 'garden');
      }) || TREE_SCENES[0];
    const wx = tr.activeWeather && (tr.weatherExpires || {})[tr.activeWeather] > Date.now() ? tr.activeWeather : null;
    sceneEl.className = 'tree-scene scene-' + scene.id + (wx ? ' weather-' + wx : '');
    sceneEl.title = '场景：' + scene.icon + ' ' + scene.name;
    let deco = sceneEl.querySelector('.scene-deco');
    if (!deco) {
      deco = document.createElement('div');
      deco.className = 'scene-deco';
      sceneEl.insertBefore(deco, sceneEl.firstChild);
    }
    if (deco.getAttribute('data-id') !== scene.id) {
      deco.setAttribute('data-id', scene.id);
      deco.innerHTML = scene.deco || '';
    }
  }
  applySkinToTree();
  /* 摆件层：场景地面小物件（周租/买断，最多 2 个） */
  const propLayer = document.getElementById('treePropLayer');
  if (propLayer) {
    const now = Date.now();
    const aps = (tr.activeProps || []).filter(function (id) {
      const e = (tr.propExpires || {})[id];
      return e === 0 || (e && e > now);
    });
    if (aps.length) {
      propLayer.innerHTML = aps
        .map(function (id, idx) {
          const p = TREE_PROPS.find(function (x) {
            return idEq(x.id, id);
          }) || { id: id, icon: '🧸' };
          return (
            '<span class="prop-item prop-' +
            p.id +
            '" style="left:' +
            (idx === 0 ? '13%' : '68%') +
            ';bottom:6%;">' +
            p.icon +
            '</span>'
          );
        })
        .join('');
      propLayer.style.display = 'block';
    } else {
      propLayer.style.display = 'none';
    }
  }
}

function renderTreeSpeciesPicker() {
  const points = appData.tree.points;
  const species = appData.tree.species || 'tomato';
  const sp = TREE_SPECIES[species] || TREE_SPECIES.tomato;
  const stage = getTreeStage(points);
  const title = getTreeTitle(appData.tree.peakPoints || 0);
  /* 季节 + 推荐提示 */
  const seasonal = getSeasonalInfo();
  const seasonBadge = document.getElementById('treeSeasonBadge');
  if (seasonBadge) {
    seasonBadge.className = 'tree-season-badge ' + seasonal.season;
    seasonBadge.textContent = seasonal.icon + ' ' + seasonal.name + '季';
  }
  const seasonHint = document.getElementById('treeSeasonHint');
  if (seasonHint) {
    const recUnlocked = (appData.tree.unlockedSpecies || ['tomato']).includes(seasonal.recommend);
    seasonHint.innerHTML =
      '💡 本季推荐：<b>' + seasonal.recommendName + '</b> · ' + seasonal.hint + (recUnlocked ? '' : '（未解锁）');
  }
  /* 树种选择器：默认折叠，只显示本季推荐 + 当前种植，其余进“更多” */
  const speciesBar = document.getElementById('treeSpeciesBar');
  if (speciesBar) {
    let html = '';
    const recId = seasonal.recommend;
    let moreCount = 0;
    for (const id in TREE_SPECIES) {
      const s = TREE_SPECIES[id];
      const unlocked = (appData.tree.unlockedSpecies || ['tomato']).includes(id);
      const active = species === id;
      const isRec = id === recId;
      const planted = (appData.tree.plantedSpecies || []).includes(id);
      const spPoints = appData.tree.speciesPoints ? appData.tree.speciesPoints[id] || 0 : 0;
      const stage = planted ? getTreeStageFor(spPoints, id) : null;
      const folded = !isRec && !active && !_speciesBarOpen;
      if (folded) moreCount++;
      html +=
        '<div class="tree-species-btn' +
        (active ? ' active' : '') +
        (!unlocked ? ' locked' : '') +
        (isRec ? ' recommended' : '') +
        (planted ? ' planted' : '') +
        (folded ? ' species-folded' : '') +
        '" onclick="' +
        (unlocked ? "selectTreeSpecies('" + id + "')" : '') +
        '" title="' +
        (unlocked
          ? planted
            ? s.name + ' · ' + stage.name + ' (' + spPoints + '🍅)'
            : '点击查看 ' + s.name + '（确认后才种植）'
          : '未解锁') +
        '"><span class="sp-icon">' +
        s.icon +
        '</span><span>' +
        s.name +
        '</span>' +
        (unlocked
          ? planted
            ? '<span style="font-size:var(--fs-tiny);color: var(--green-ink);">🌱' + stage.emoji + '</span>'
            : '<span style="font-size:var(--fs-tiny);color:var(--text-light);">点我查看</span>'
          : ' 🔒') +
        '</div>';
    }
    if (moreCount > 0 || _speciesBarOpen) {
      html +=
        '<button class="tree-species-more" onclick="toggleSpeciesBar()">' +
        (_speciesBarOpen ? '▴ 收起' : '▾ 更多 ' + moreCount) +
        '</button>';
    }
    speciesBar.innerHTML = html;
  }
}

function renderTreeVisualBlock() {
  const tr = appData.tree;
  const points = appData.tree.points;
  const species = appData.tree.species || 'tomato';
  const sp = TREE_SPECIES[species] || TREE_SPECIES.tomato;
  const stage = getTreeStage(points);
  const title = getTreeTitle(appData.tree.peakPoints || 0);
  /* 树视觉 + 心情滤镜 + 光环特效 + 装饰挂载 + 心情 emoji */
  const treeVisual = document.getElementById('treeVisual');
  const mood = getTreeMood();
  const auraId = tr.activeAura && (tr.auraExpires || {})[tr.activeAura] > Date.now() ? tr.activeAura : null;
  const AURA_COLORS = { gold: '#FFD700', pink: '#FF80AB', firefly: '#69F0AE', crystal: '#82B1FF', flame: '#FF8A50' };
  const AURA_PARTICLES = {
    gold: '#FFD700,#FFB74D,#FFF3E0',
    pink: '#FF80AB,#F8BBD0,#FFD1E3',
    firefly: '#69F0AE,#B9F6CA,#E8F5E9',
    crystal: '#82B1FF,#B388FF,#E1BEE7',
    flame: '#FF8A50,#FF7043,#FFE0B2'
  };
  if (treeVisual) {
    treeVisual.textContent = appData.tree.dead ? '🥀' : stage.emoji;
    let filter = appData.tree.dead
      ? 'grayscale(1) sepia(0.4)'
      : mood.fade > 0
        ? 'sepia(' + mood.fade + ') saturate(' + (1 - mood.fade * 0.6) + ')'
        : '';
    if (auraId && !appData.tree.dead) {
      const c = AURA_COLORS[auraId] || '#FFD700';
      filter += ' drop-shadow(0 0 8px ' + c + ') drop-shadow(0 0 20px ' + c + ')';
    }
    treeVisual.style.filter = filter;
    treeVisual.title = appData.tree.dead ? '🥀 树已枯死：点下方按钮重种或复活' : '点击树和它互动';
  }
  /* 树龄陪伴装饰（随树龄逐步出现的小物件） */
  renderTreeAgeDecor();
  const auraLayer = document.getElementById('treeAuraLayer');
  if (auraLayer) {
    if (auraId && !appData.tree.dead) {
      const cols = (AURA_PARTICLES[auraId] || '#FFD700,#FFB74D,#FFF3E0').split(',');
      auraLayer.innerHTML = cols
        .map(function (c, i) {
          return (
            '<span class="ap" style="--c:' +
            c +
            ';animation-delay:' +
            i * 0.9 +
            's;' +
            (i === 1 ? 'width:6px;height:6px;' : '') +
            '"></span>'
          );
        })
        .join('');
      auraLayer.style.display = 'block';
    } else {
      auraLayer.style.display = 'none';
    }
  }
  const decorLayer = document.getElementById('treeDecorLayer');
  if (decorLayer) {
    const ads = appData.tree.activeDecorations || [];
    decorLayer.innerHTML = ads
      .map(function (id) {
        const d = TREE_DECORATIONS.find(function (x) {
          return idEq(x.id, id);
        });
        return d ? '<span class="tree-decor" title="' + d.name + '">' + d.icon + '</span>' : '';
      })
      .join('');
  }
  const moodEl = document.getElementById('treeMood');
  if (moodEl) {
    moodEl.textContent = mood.emoji;
    moodEl.title = mood.label;
    moodEl.style.display = mood.fade > 0 ? '' : 'none';
  }
  /* 阶段名称和树种名称 */
  const stageNameEl = document.getElementById('treeStageName');
  if (stageNameEl) stageNameEl.textContent = stage.name;
  const speciesNameEl = document.getElementById('treeSpeciesName');
  if (speciesNameEl) speciesNameEl.textContent = sp.name;
  /* 树名徽章：起名后显示名字（用树种色），未起名显示提示 */
  const nameBadge = document.getElementById('treeNameBadge');
  if (nameBadge) {
    const customNm = ((appData.tree.treeNames || {})[species] || '').trim();
    if (customNm) {
      nameBadge.innerHTML = '<span style="color:' + sp.color + ';">' + escapeHtml(customNm) + '</span>';
      nameBadge.style.fontStyle = 'normal';
      nameBadge.style.opacity = '1';
    } else {
      nameBadge.innerHTML =
        '<span style="color:' +
        sp.color +
        ';opacity:.55;">' +
        escapeHtml(DEFAULT_TREE_NAMES[species] || sp.name) +
        '</span>';
      nameBadge.style.fontStyle = 'italic';
      nameBadge.style.opacity = '1';
    }
  }
}

/* ===== renderTreeGrowthMeta 拆分 helper =====
 * treeEternalStarsHtml：年轮区 HTML 构建（满级荣誉圈数展示，纯字符串）
 * calcTreeProgressText：进度条文案三分支（枯死/未满级/世界树重天）
 * renderTreeUnlockNotice：串行解锁通知（预告下一棵树图鉴条件，DOM 副作用） */
/* 封树成林按钮：只在养到「永恒树心」后出现（没到就不打扰） */
function renderTreeSealBtn() {
  const btn = document.getElementById('treeSealBtn');
  if (!btn) return;
  const st = sealTreeStatus();
  if (st.ok) {
    btn.style.display = '';
    btn.textContent = '🌲 封树成林（第 ' + (groveCount(appData.tree.species || 'tomato') + 1) + ' 代）';
  } else {
    btn.style.display = 'none';
  }
}
/* 林地小树：年轮越多越壮实（宽高按圈数增长，封顶在 300 圈） */
function groveTreeSvg(rings, color) {
  const r = Math.max(0, Math.min(Number(rings) || 0, 300));
  const w = Math.round(20 + r * 0.05);
  const h = Math.round(28 + r * 0.07);
  const c = color || '#E85D3A';
  return (
    '<svg width="' + w + '" height="' + h + '" viewBox="0 0 40 56" aria-hidden="true">' +
    '<rect x="17.5" y="33" width="5" height="22" rx="2" fill="#8D6E63"/>' +
    '<circle cx="20" cy="22" r="14" fill="' + c + '"/>' +
    '<circle cx="11" cy="28" r="9" fill="' + c + '" opacity=".85"/>' +
    '<circle cx="29" cy="28" r="9" fill="' + c + '" opacity=".85"/>' +
    '</svg>'
  );
}
/* 树龄陪伴装饰：随树龄在身边慢慢出现的小物件。
   纯氛围（不参与任何数值、不发任何奖励）—— 十几年后树周围会攒下一圈东西，
   比一行数字更能说明"它陪了你多久"。 */
const AGE_DECORS = [
  { at: 1, icon: '🌰', x: '16%', y: '74%' }, /* 100 天 */
  { at: 2, icon: '🪨', x: '78%', y: '76%' }, /* 1 年 */
  { at: 3, icon: '🌿', x: '10%', y: '60%' }, /* 2 年 */
  { at: 4, icon: '🍄', x: '86%', y: '64%' }, /* 3 年 */
  { at: 5, icon: '🏮', x: '22%', y: '44%' }, /* 5 年 */
  { at: 6, icon: '🪑', x: '72%', y: '54%' }, /* 7 年 */
  { at: 7, icon: '🐦', x: '66%', y: '22%' }, /* 10 年 */
  { at: 8, icon: '🏡', x: '12%', y: '36%' }, /* 15 年 */
  { at: 9, icon: '🌙', x: '82%', y: '14%' }, /* 20 年 */
  { at: 10, icon: '🪐', x: '6%', y: '16%' } /* 30 年 */
];
function renderTreeAgeDecor() {
  const el = document.getElementById('treeAgeDecor');
  if (!el) return;
  const tr = appData.tree || {};
  if (tr.dead) {
    el.innerHTML = '';
    return;
  }
  const sid = tr.species || 'tomato';
  const planted = (tr.treeLifeLog && tr.treeLifeLog.planted && tr.treeLifeLog.planted[sid]) || null;
  if (!planted) {
    el.innerHTML = '';
    return;
  }
  const days = treeAgeDays(planted, getTodayStr());
  let n = 0;
  for (let i = 0; i < TREE_AGE_TIERS.length; i++) if (days >= TREE_AGE_TIERS[i].days) n++;
  el.innerHTML = AGE_DECORS.filter(function (d) {
    return d.at <= n;
  })
    .map(function (d) {
      const t = TREE_AGE_TIERS[d.at - 1];
      return (
        '<span style="left:' + d.x + ';top:' + d.y + ';" title="' + (t ? t.name : '') + '">' + d.icon + '</span>'
      );
    })
    .join('');
}
/* 林地列表：每一代封存的树（树种 · 第几代 · 陪了多久 · 几圈年轮） */
function renderTreeGrove() {
  const wrap = document.getElementById('treeGroveWrap');
  const box = document.getElementById('treeGroveBox');
  if (!wrap || !box) return;
  const g = (appData.tree && appData.tree.grove) || [];
  const cntEl = document.getElementById('treeGroveCount');
  if (cntEl) cntEl.textContent = String(g.length);
  if (!g.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  /* 小树林：每封一代画一棵，年轮越多树越壮（纯 SVG，跟着主题色走） */
  const treesEl = document.getElementById('treeGroveTrees');
  if (treesEl) {
    treesEl.innerHTML = g
      .map(function (x) {
        const sp = TREE_SPECIES[x.sid] || { color: '#E85D3A' };
        return (
          '<span title="' +
          escapeHtml((x.name || '树') + ' · 第 ' + x.gen + ' 代 · ' + x.rings + ' 圈') +
          '">' +
          groveTreeSvg(x.rings, sp.color) +
          '</span>'
        );
      })
      .join('');
  }
  const list = g.slice().reverse();
  box.innerHTML = list
    .map(function (x) {
      const sp = TREE_SPECIES[x.sid] || { icon: '🌳', name: '树' };
      const ageTxt = x.days > 0 ? '陪伴 ' + x.days + ' 天 · ' : '';
      return (
        '<div class="tg-row"><span class="tg-k">' +
        sp.icon +
        ' ' +
        escapeHtml(x.name || sp.name) +
        ' <span style="color:var(--text-light);">第 ' +
        x.gen +
        ' 代</span></span><span class="tg-v">' +
        ageTxt +
        x.rings +
        ' 圈 · ' +
        x.sealedAt +
        '</span></div>'
      );
    })
    .join('');
}
function toggleTreeGrove() {
  const b = document.getElementById('treeGroveBody');
  const a = document.getElementById('treeGroveArrow');
  if (!b) return;
  const open = b.style.display === 'none';
  b.style.display = open ? 'block' : 'none';
  if (a) a.textContent = open ? '▾' : '▸';
}
/* 千分位（天数用；不引 toLocaleString，各内核实现不一致） */
function fmtDays(n) {
  const s = String(Math.max(0, Math.floor(Number(n) || 0)));
  let out = '';
  for (let i = s.length - 1, c = 0; i >= 0; i--) {
    out = s[i] + out;
    if (++c % 3 === 0 && i > 0) out = ',' + out;
  }
  return out;
}
/* 树龄行：陪伴 N 天 · 满 N 年 · 当前档 + 距下一档。
   数据来源 treeLifeLog.planted（种植当天记一次，零新增字段）。
   ★ 这条线是长线主轴：积分线看强度（1~4 年走完），时间线只看日历，十几年都有节点。 */
function renderTreeAgeLine() {
  const el = document.getElementById('treeAgeLine');
  if (!el) return;
  const tr = appData.tree || {};
  const sid = tr.species || 'tomato';
  const planted = (tr.treeLifeLog && tr.treeLifeLog.planted && tr.treeLifeLog.planted[sid]) || null;
  if (!planted) {
    el.style.display = 'none';
    return;
  }
  const today = getTodayStr();
  const days = treeAgeDays(planted, today);
  const years = treeAgeYears(planted, today);
  const tier = treeAgeTierOf(days);
  let h = '🌳 陪伴 ' + fmtDays(days) + ' 天' + (years > 0 ? ' · 满 ' + years + ' 年' : '');
  if (tier.cur) h += ' · <span class="ta-tier">' + tier.cur.icon + ' ' + tier.cur.name + '</span>';
  if (tier.next) {
    h += '<div class="tree-age-next">距「' + tier.next.icon + ' ' + tier.next.name + '」还有 ' + (tier.next.days - days) + ' 天</div>';
  }
  el.innerHTML = h;
  el.style.display = '';
  /* 把已经跨过的档全部补记一次：首次渲染会补齐「这棵树陪你走过的所有年头」，
     之后靠 logTreeAgeMark 内部的按天数去重，重复渲染不再写。 */
  for (let i = 0; i < TREE_AGE_TIERS.length; i++) {
    if (days >= TREE_AGE_TIERS[i].days) logTreeAgeMark(TREE_AGE_TIERS[i].days, sid);
    else break;
  }
}
function treeEternalStarsHtml(stars) {
  const tier = getEternalTier(stars);
  /* 年轮真实排布：说明书承诺满级后每 50 点长一圈，此前只有一行文字，年轮从未真正出现过 */
  const iconRow = stars <= 20 ? '🪵'.repeat(stars) : '🪵'.repeat(12) + '<span class="es-more">…×' + stars + '</span>';
  let h = '<div class="es-row">' + iconRow + '</div>';
  h +=
    '<div class="es-title">' +
    (tier.cur ? tier.cur.icon + ' ' + tier.cur.name : '') +
    ' · 年轮 ×' +
    stars +
    ' 圈</div>';
  if (tier.next) {
    const need = tier.next.at - stars;
    h +=
      '<div class="es-next">距「' +
      tier.next.icon +
      ' ' +
      tier.next.name +
      '」再长 ' +
      need +
      ' 圈年轮（纯荣誉）</div>';
  }
  return h;
}
function calcTreeProgressText(points, stage, nextStage, dead, deadDate, stars) {
  let progressText, pct;
  if (dead) {
    progressText =
      '🥀 已枯死' + (deadDate ? '（' + deadDate + '）' : '') + ' · 请重种或用复活石复活';
    pct = 0;
  } else if (nextStage) {
    progressText =
      '距「' +
      nextStage.name +
      '」还差 ' +
      Math.max(1, Math.ceil(nextStage.min - points)) +
      ' 🍅（' +
      stage.name +
      ' → ' +
      nextStage.name +
      '）';
    pct = Math.min(100, ((points - stage.min) / (nextStage.min - stage.min)) * 100);
  } else {
    /* 满级（世界树）：显示重天进度 */
    const starProg = (points - 200) % 50;
    progressText = '世界树 · 第' + stars + '重天（距下一重天还差 ' + Math.max(1, 50 - starProg) + ' 🍅）';
    pct = Math.min(100, (starProg / 50) * 100);
  }
  return { progressText: progressText, pct: pct };
}
function renderTreeUnlockNotice(mlEl, points) {
  /* 解锁通知（串行解锁：预告下一棵树的图鉴收集条件） */
  const unlockedCount = (appData.tree.unlockedSpecies || ['tomato']).length;
  const totalCount = Object.keys(TREE_SPECIES).length;
  if (unlockedCount < totalCount && points >= 40) {
    let nextUnlock = null,
      nextId = null;
    for (const id in TREE_SPECIES) {
      const s = TREE_SPECIES[id];
      if (
        !(appData.tree.unlockedSpecies || []).includes(id) &&
        (nextUnlock === null || s.unlockAt < nextUnlock.unlockAt)
      ) {
        nextUnlock = s;
        nextId = id;
      }
    }
    if (nextUnlock && nextId) {
      const noticeEl = mlEl;
      if (noticeEl && !noticeEl.querySelector('.tree-unlock-notice')) {
        const notice = document.createElement('div');
        notice.className = 'tree-unlock-notice';
        const _pIdx = SPECIES_ORDER.indexOf(nextId) - 1;
        const _prevCnt = _pIdx >= 0 ? ((appData.tree.speciesAlbum || {})[SPECIES_ORDER[_pIdx]] || []).length : 0;
        notice.textContent =
          _pIdx >= 0
            ? '👑 集齐「' + speciesPrevName(nextId) + '」图鉴（' + _prevCnt + '/9）解锁「' + nextUnlock.name + '」'
            : nextUnlock.icon + '「' + nextUnlock.name + '」为起始树种';
        noticeEl.appendChild(notice);
      }
    }
  }
}

function renderTreeGrowthMeta() {
  const points = appData.tree.points;
  const species = appData.tree.species || 'tomato';
  const stages = getCurrentTreeStages();
  const stage = getTreeStage(points);
  const nextStage = stages.find(s => s.min > points);
  const title = getTreeTitle(appData.tree.peakPoints || 0);
  const album = ensureTreeAlbum();
  /* 树种图鉴：5 棵树各自的 9 阶收集 */
  renderSpeciesAlbum();
  /* 陪伴开关状态：当前树种===陪伴树种时勾选，小树阶段(40🍅)以下或枯死时禁用 */
  const cb = document.getElementById('treeCompanionToggle');
  if (cb) {
    const canCompanion = (appData.tree.points || 0) >= 40 && !appData.tree.dead;
    cb.checked = !appData.tree.dead && (appData.tree.timerTreeSpecies || '') === species;
    cb.disabled = !canCompanion;
    const lbl = document.getElementById('treeCompanionLabel');
    if (lbl) {
      lbl.style.opacity = canCompanion ? '1' : '0.5';
      lbl.title = appData.tree.dead
        ? '树已枯死，重种或复活后才能开启陪伴'
        : canCompanion
          ? '勾选后这棵树会去计时页陪伴你'
          : '需要进化到小树(40🍅)才能开启陪伴';
    }
  }
  /* 树龄（陪伴天数）：长线主轴，先于年轮画。
     跨周年时顺带结一次「年度回顾」（幂等：同一年只写一条）。 */
  renderTreeAgeLine();
  checkTreeAnnual();
  /* 年轮（满级后无限成长目标） */
  const stars = getEternalStars(points);
  const esEl = document.getElementById('treeEternalStars');
  if (esEl) {
    if (stars > 0) {
      esEl.style.display = '';
      esEl.innerHTML = treeEternalStarsHtml(stars); /* 年轮 HTML 构建提顶层 helper */
    } else {
      esEl.style.display = 'none';
    }
  }
  /* 封树成林入口 + 林地（超长线收藏：养到「永恒树心」后可以封存，开启新的一代） */
  renderTreeSealBtn();
  renderTreeGrove();
  renderTreeLifeLog();
  /* 浇水按钮 + 露珠徽章 */
  const today = getTodayStr();
  const wb = document.getElementById('treeWaterBtn');
  if (wb) {
    if (appData.tree.dead) {
      wb.textContent = '🥀 已枯死';
      wb.disabled = true;
      wb.classList.add('done');
    } else {
      /* 复活/重种后必须把 disabled 复位：只置 true 不置 false，
         会让按钮在同一会话里永远点不动（刷新才恢复）——「复活后无法浇水」的真因 */
      wb.disabled = false;
      const watered = appData.tree.lastWaterDate === today;
      wb.textContent = watered ? '💧 今日已浇' : '💧 浇水';
      wb.classList.toggle('done', watered);
    }
  }
  const dc = document.getElementById('treeDewCount');
  if (dc)
    dc.innerHTML =
      '<b>💧 露珠徽章 ×' +
      (appData.tree.dewBadges || 0) +
      '</b>' +
      (appData.tree.waterStreak ? ' · 连续浇水 ' + appData.tree.waterStreak + ' 天' : '');
  /* 每日任务条（自动发放，显示进度） */
  const dt = checkTreeDailyTasks();
  const taskEl = document.getElementById('treeDailyTasks');
  if (taskEl) {
    const waterDone = appData.tree.lastWaterDate === today;
    const full1Done = countTomatoPoints(today) >= 1;
    const ptsDone = countTomatoPoints(today) >= 3;
    const rw = (dt && dt.rewarded) || [];
    const mk = function (done, label, rewarded) {
      return (
        '<span class="tree-task' +
        (done ? ' done' : '') +
        '"' +
        (rewarded ? ' title="已领奖"' : ' title="完成可得 ' + COIN_DAILYTASK_REWARD + ' 金币"') +
        '>' +
        (done ? (rewarded ? '✅' : '🟢') : '⬜') +
        ' ' +
        label +
        ' <b class="tree-task-coin' + (rewarded ? ' got' : '') + '">+' + COIN_DAILYTASK_REWARD + '🪙</b>' +
        '</span>'
      );
    };
    taskEl.innerHTML =
      '<div class="tree-task-title">📋 树每日任务</div><div class="tree-task-row">' +
      mk(waterDone, '浇水', rw.includes('water')) +
      mk(full1Done, '1个番茄', rw.includes('full1')) +
      mk(ptsDone, '3个番茄', rw.includes('pts3')) +
      '</div>';
  }
  /* 进度 + 里程碑刻度（25%/50%/75%） */
  /* 进度 + 里程碑刻度（25%/50%/75%）· 三分支文案计算提 calcTreeProgressText */
  const _prog = calcTreeProgressText(points, stage, nextStage, appData.tree.dead, appData.tree.deadDate, stars);
  const progressText = _prog.progressText;
  const pct = _prog.pct;
  const tp = document.getElementById('treeProgress');
  if (tp) tp.textContent = progressText;
  const tpf = document.getElementById('treeProgressFill');
  if (tpf) tpf.style.width = pct + '%';
  /* 枯死操作区显示 */
  const deadActions = document.getElementById('treeDeadActions');
  if (deadActions) deadActions.style.display = appData.tree.dead ? 'block' : 'none';
  /* 进度条 25/50/75 刻度 */
  const wrap = document.querySelector('.tree-progress-wrap');
  if (wrap) {
    wrap.querySelectorAll('.tree-tick').forEach(function (t) {
      t.remove();
    });
    [25, 50, 75].forEach(function (q) {
      const tk = document.createElement('div');
      tk.className = 'tree-tick';
      tk.style.left = q + '%';
      wrap.appendChild(tk);
    });
  }
  /* 果实区域：纯展示，每进化一个阶段获得1个🍅 */
  const fruitDisplay = document.getElementById('treeFruitDisplay');
  if (fruitDisplay) {
    const fc = appData.tree.fruitCount || 0;
    if (fc > 0) {
      fruitDisplay.innerHTML =
        '<span class="tree-fruit-icon">🍅</span><span class="tree-fruit-count">x' +
        fc +
        '</span><span style="font-size:var(--fs-title);color:var(--text-light);margin-left:var(--sp-4);">每进化一阶段+1</span>';
    } else {
      fruitDisplay.innerHTML = '<div class="tree-fruit-empty">累计种出40个🍅番茄时您的树可以到计时界面陪伴你哦</div>';
    }
  }
  /* 成长图鉴：9 阶段收集进度 */
  const grid = document.getElementById('treeAlbumGrid');
  if (grid) {
    grid.innerHTML = stages
      .map(function (s, i) {
        const lit = album.includes(i + 1);
        return (
          '<div class="tree-album-cell' +
          (lit ? ' lit' : '') +
          '" title="' +
          (lit ? '' : '未解锁 ') +
          s.name +
          '">' +
          s.emoji +
          '</div>'
        );
      })
      .join('');
  }
  const ap = document.getElementById('treeAlbumProgress');
  if (ap) ap.textContent = album.length + '/9';
  const af = document.getElementById('treeAlbumFill');
  if (af) af.style.width = Math.min(100, (album.length / 9) * 100) + '%';
  const at = document.getElementById('treeAlbumTip');
  if (at) at.textContent = album.length >= 9 ? '🎉 已达成「万物园丁」成就！' : '集齐 9 个成长阶段点亮全部格子';
  /* 里程碑历史 */
  const mlEl = document.getElementById('treeMilestoneList');
  if (mlEl) {
    const milestones = appData.tree.milestones || [];
    if (milestones.length > 0) {
      const recent = milestones.slice(-5).reverse();
      let mlHtml =
        '<div class="tml-header" onclick="var b=this.nextElementSibling;b.classList.toggle(\'show\');">📜 进化记录（' +
        milestones.length +
        '次）</div>';
      mlHtml += '<div class="tml-body">';
      recent.forEach(function (m) {
        mlHtml +=
          '<div class="tree-milestone-entry"><span>' +
          m.emoji +
          ' ' +
          m.stage +
          '</span><span>' +
          m.date +
          '</span></div>';
      });
      mlHtml += '</div>';
      mlEl.innerHTML = mlHtml;
    } else {
      mlEl.innerHTML = '';
    }
  }
  /* 解锁通知（串行解锁：预告下一棵树）· 提 renderTreeUnlockNotice */
  renderTreeUnlockNotice(mlEl, points);
  /* 打开树页时先刷新连续天数快照，断连横幅才不会误报 / 才不会不消失 */
  snapshotStreakHistory();
  renderStreakBreakBanner();
  renderGrowthBuffBar();
  renderForestPanel();
}
/* 森林成长面板 —— 借鉴 Forest「把专注种成一片森林」的长期心智：
   每天一片地、地里按**番茄**种树，攒的是「林子有多密」，而不是「一棵树有多大」。
   树的口径 / 里程碑 / 展示窗口全在 00_pure_core.js，
   这里只把算好的林子画出来 —— 不自己数数、不写死任何数字。 */
function renderForestPanel() {
  const el = document.getElementById('treeForestPanel');
  if (!el) return;
  const forest = forestFromRecords(appData.records || []);
  const treeCount = forest.reduce(function (s, d) { return s + d.trees; }, 0);
  const totalPomos = forest.reduce(function (s, d) { return s + d.pomoSum; }, 0);
  const minSum = forest.reduce(function (s, d) { return s + d.minutes; }, 0);
  const today = forest.filter(function (d) { return d.date === getTodayStr(); })[0] || null;
  const milestones = forestMilestones(treeCount);
  const next = milestones.filter(function (m) { return !m.unlocked; })[0] || null;
  const unlockedN = milestones.filter(function (m) { return m.unlocked; }).length;
  const win = typeof FOREST_RECENT_DAYS === 'number' ? FOREST_RECENT_DAYS : 14;
  const cap = typeof FOREST_ICONS_PER_DAY === 'number' ? FOREST_ICONS_PER_DAY : 6;
  /* 每天一列：列里竖着堆当天的树，超过 cap 棵折成「+N」（手机上不把面板撑破） */
  const groves = forest
    .slice(-win)
    .map(function (d) {
      const icons = d.icons
        .slice(0, cap)
        .map(function (ic) { return '<span class="tf-t">' + ic + '</span>'; })
        .join('');
      const more = d.icons.length > cap ? '<span class="tf-more">+' + (d.icons.length - cap) + '</span>' : '';
      return (
        '<div class="tf-grove" title="' +
        escapeHtml(d.date + ' · ' + d.trees + ' 棵 · ' + fmtTomatoNum(d.pomoSum) + ' 🍅 · 专注 ' + fmtDurMin(d.minutes)) +
        '"><span class="tf-grove-icons">' + icons + more + '</span>' +
        '<span class="tf-grove-date">' + escapeHtml(d.date.slice(5).replace('-', '/')) + '</span></div>'
      );
    })
    .join('');
  const msHtml = milestones
    .map(function (m) {
      return '<span class="tf-chip' + (m.unlocked ? ' on' : '') + '">' + (m.unlocked ? '🏅 ' : '') + escapeHtml(m.label) + ' ' + m.trees + '</span>';
    })
    .join('');
  el.innerHTML =
    '<div class="tree-forest-title">🌲 我的森林<span class="tf-acc">累计 ' +
    treeCount +
    ' 棵 · ' +
    fmtTomatoNum(totalPomos) +
    ' 🍅</span></div>' +
    '<div class="tf-today">今日：<b>' +
    (today ? today.icons.slice(0, cap).join('') + ' ' + today.trees + ' 棵' : '还没种树') +
    '</b><span class="tf-acc">' +
    (today ? fmtTomatoNum(today.pomoSum) + ' 🍅 · 专注 ' + fmtDurMin(today.minutes) : '开一个番茄就种下第一棵') +
    '</span></div>' +
    '<div class="tf-next">' +
    (next
      ? '下一片：<b>' + escapeHtml(next.label) + '</b> 还差 ' + (next.trees - treeCount) + ' 棵'
      : '🎉 全部森林成就已达成 · 累计专注 ' + escapeHtml(fmtDurMin(minSum))) +
    '</div>' +
    '<div class="tf-groves">' +
    (groves || '<div class="tf-empty">还没有番茄记录，种下第一棵树吧</div>') +
    '</div>' +
    '<div class="tf-chips">' +
    msHtml +
    '<span class="tf-acc">成就 ' +
    unlockedN +
    '/' +
    milestones.length +
    '</span></div>';
}
function renderTreeSection() {
  checkTreeExpiry();
  const tr = appData.tree;
  const points = appData.tree.points;
  const species = appData.tree.species || 'tomato';
  const sp = TREE_SPECIES[species] || TREE_SPECIES.tomato;
  const stages = getCurrentTreeStages();
  const stage = getTreeStage(points);
  const nextStage = stages.find(s => s.min > points);
  const title = getTreeTitle(appData.tree.peakPoints || 0);
  const album = ensureTreeAlbum();
  /* 称号徽章（按历史最高积分，退化不清零）+ 果实币余额 */
  const titleBadge = document.getElementById('treeTitleBadge');
  if (titleBadge) {
    titleBadge.innerHTML = '<span class="tt-star">' + escapeHtml(title.icon) + '</span> ' + escapeHtml(title.name);
  }
  const coinsEl = document.getElementById('treeCoins');
  if (coinsEl) fxVal(coinsEl, appData.tree.coins || 0, '🛍️ 商店 · 🪙 ');  /* E4-04 余额变化弹 */
  /* 金币抽奖状态：次数 + 按钮可用性。
     次数由 records 派生，先同步再画 —— 否则补记/删记录/改类型后这里会显示过期值。 */
  syncLotteryCount();
  const lcEl = document.getElementById('treeLotteryCount');
  if (lcEl) lcEl.textContent = '×' + (appData.tree.lotteryCount || 0);
  const lbEl = document.getElementById('treeLotteryBtn');
  if (lbEl) lbEl.classList.toggle('disabled', (appData.tree.lotteryCount || 0) <= 0);
  /* 神秘际遇：展开时刷新任务状态 */
  const mystEl = document.getElementById('mysteryTaskList');
  if (mystEl && mystEl.style.display !== 'none') renderMysteryTasks();
  /* () 已拆至 renderTreeSceneBlock() */
  renderTreeSceneBlock();
  /* () 已拆至 renderTreeSpeciesPicker() */
  renderTreeSpeciesPicker();
  /* () 已拆至 renderTreeVisualBlock() */
  renderTreeVisualBlock();
  /* () 已拆至 renderTreeGrowthMeta() */
  renderTreeGrowthMeta();
}
let immersionIv = null,
  immersionEnteredAt = 0;

/* 事件委托（2026-10-23）：树卡「详情」折叠。原为内联多语句，抽成具名函数。 */
window.toggleTreeDescBlock = function () {
  var d = document.getElementById('treeDescBody');
  var a = document.getElementById('treeDescArrow');
  if (!d || !a) return;
  if (d.style.display === 'none') {
    d.style.display = 'block';
    a.textContent = '▾';
  } else {
    d.style.display = 'none';
    a.textContent = '▸';
  }
};
