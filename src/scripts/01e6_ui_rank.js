/* ============================================================
 * 01e6 · 段位/成就/签到/历史渲染域
 * 函数索引（TOC）：toggleImmersion/showSubRankUp/showRankUpCelebration/closeRankUpModal/showPomodoroCelebration/showRankFeedback/fmtMonthDay/fmtSeasonRange/renderRankSystem/renderStarRecords/renderSignIn/doSignIn（+10 更多）
 * ============================================================ */
function toggleImmersion() {
  const im = document.getElementById('immersionMode');
  if (!im) return;
  // 已进入沉浸模式：点击屏幕退出（进入后 600ms 内忽略，防止连点误退出）
  if (im.classList.contains('show')) {
    if (Date.now() - immersionEnteredAt < 600) return;
    im.classList.remove('show');
    if (immersionIv) {
      clearInterval(immersionIv);
      immersionIv = null;
    }
    return;
  }
  // 进入沉浸模式：单击即可，不需要双击
  if (timerState.mode !== 'focus' || !timerState.running) {
    showToast('请先开始一个专注番茄');
    return;
  }
  im.classList.add('show');
  immersionEnteredAt = Date.now();
  /* 横屏/平板「全屏专注不显示」（第二处）：全局公告/浮层若已弹在屏幕上，
     会盖住刚进入的全屏专注界面 —— 用户看到的是公告卡，以为"专注界面没显示"。
     进入全屏专注时主动收起这些打断性浮层（只关已弹出的，不动它们的"已读"记录，
     关掉即视作用户已处理，不会立刻重弹）。 */
  (function () {
    const _hideLayers = [
      'jyAnn', /* 增强模块「本次更新：渐进解锁」公告 */
      'jyAnn2', /* 其第二段提示 */
      'firstGuide', /* 新手引导浮层（同 #3：跨界面残留） */
      'quickPanel', /* 快捷功能面板 */
      'treeShopModal',
      'careModal'
    ];
    for (let _i = 0; _i < _hideLayers.length; _i++) {
      const _el = document.getElementById(_hideLayers[_i]);
      if (!_el) continue;
      try {
        _el.classList.remove('jy-open');
        _el.classList.remove('show');
      } catch (e) { if (window.__silent) window.__silent(e, '01e6:toggleImmersion'); }
      try {
        if (_el.style && _el.style.display === 'flex') _el.style.display = 'none';
      } catch (e) { if (window.__silent) window.__silent(e, '01e6:toggleImmersion'); }
    }
    /* 公告「已读」落盘：避免关掉后下一个 tick 又把它弹回来，把用户困在公告里 */
    try {
      if (typeof appData !== 'undefined' && appData && appData.uiPrefs && appData.journey) {
        appData.uiPrefs.jyAnnSeen = true;
        saveData();
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01e6:toggleImmersion'); }
  })();
  document.getElementById('immersiveTime').textContent = document.getElementById('timerTime').textContent;
  document.getElementById('immersiveTask').textContent = timerState.taskName;
  if (immersionIv) clearInterval(immersionIv);
  /* 受控轮询 · 沉浸页时间同步 500ms（退出沉浸时 clear） */
  immersionIv = setInterval(() => {
    document.getElementById('immersiveTime').textContent = document.getElementById('timerTime').textContent;
  }, 500);
}
/* 段位晋升专属提示：升段瞬间全屏光效弹窗，区别于普通 toast/rankFeedback */
/* 子段位（段数 Ⅲ→Ⅱ→Ⅰ）提升轻提示：段位没变、但段内小级提升时触发 */
let _subRankTimer = null;
function showSubRankUp(tier, subIdx) {
  const el = document.getElementById('subRankUp');
  if (!el) return;
  const sub = SUB_RANKS[subIdx] || 'Ⅰ';
  document.getElementById('subRankUpIcon').textContent = tier.icon || '🎖️';
  document.getElementById('subRankUpText').textContent = tier.name + ' ' + sub;
  document.getElementById('subRankUpText').style.color = tier.color || 'var(--primary)';
  el.classList.add('show');
  clearTimeout(_subRankTimer);
  _subRankTimer = setTimeout(function () {
    el.classList.remove('show');
  }, 2200);
}
function showRankUpCelebration(tier, firstEver) {
  const modal = document.getElementById('rankUpModal');
  if (!modal) return;
  document.getElementById('rankUpIcon').textContent = tier.icon || '🎖️';
  document.getElementById('rankUpName').textContent = '晋升 ' + tier.name;
  document.getElementById('rankUpName').style.color = tier.color || 'var(--primary)';
  document.getElementById('rankUpSub').textContent = firstEver
    ? '🎉 第一次踏上' + tier.name + '！这是你一路坚持的最好证明'
    : '⚡ 继续加油，下一个段位在向你招手！';
  modal.classList.add('show');
  document.getElementById('rankUpModal').style.display = 'flex';
  setTimeout(function () {
    closeRankUpModal();
  }, 3800);
}
function closeRankUpModal() {
  const modal = document.getElementById('rankUpModal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
}
let _celebTimer = null;
/* 番茄完成即时反馈（统一）：屏幕中央大字个性化祝贺，2 秒自动消失。
   集中承载「+1🍅/连续完成/打破昨日/用时效率」等亮点，取代完成时零散堆叠的 toast。 */
function showPomodoroCelebration(pomos) {
  const layer = document.getElementById('celebrationLayer');
  if (!layer) return;
  const tFull = getTodayEffectiveFull();
  const isFull = pomos >= 1;
  let title = (isFull ? '+' + Math.round(pomos) : '+' + fmtTomatoNum(pomos)) + ' 🍅！';
  let sub = '';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yFull = countDayFullPoints(getDateStr(y));
  if (tFull > yFull && yFull > 0) sub = '🔥 打破昨日记录（昨日 ' + fmtTomatoNum(yFull) + ' 个）！';
  else if (tFull === yFull && yFull > 0) sub = '⚡ 追平昨日记录（' + fmtTomatoNum(yFull) + ' 个）';
  else if (tFull >= 3) sub = '⚡ 今日已完成 ' + fmtTomatoNum(tFull) + ' 个';
  const sp = getSprintInfo();
  const streak = sp ? sp.streak : 0;
  if (streak >= 2) sub = (sub ? sub + ' · ' : '') + '🔥 连续完成 ' + streak + ' 个';
  const total = timerState.totalDuration || POMO_DEFAULT_MINUTES * 60;
  const eff = Math.round(((timerState.effectiveSeconds || 0) / total) * 100);
  if (eff > 100) sub = (sub ? sub + ' · ' : '') + '⚡ 用时效率 ' + eff + '%';
  layer.innerHTML =
    '<div class="celeb-title">' + title + '</div>' + (sub ? '<div class="celeb-sub">' + sub + '</div>' : '');
  layer.classList.add('show');
  clearTimeout(_celebTimer);
  _celebTimer = setTimeout(function () {
    layer.classList.remove('show');
  }, 2000);
}
function showRankFeedback(msg) {
  /* 重要通知与普通 toast 统一排队（一次只显示一条，点击可跳过） */
  showToast(msg, true);
  const rs = appData.rankSystem;
  if (!rs.rankFeedback) rs.rankFeedback = [];
  rs.rankFeedback.unshift({ msg, time: getTodayStr() + ' ' + fmtTime(new Date()) });
  if (rs.rankFeedback.length > 12) rs.rankFeedback.length = 12; /* 反馈滚动保留最近 12 条，旧的自动被新反馈顶掉 */
}
function fmtMonthDay(dateStr) {
  const p = dateStr.split('-');
  return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
}
function fmtSeasonRange(startStr, endStr) {
  /* 兜底：历史/异常数据缺 endDate 时按同一年当月展示，不让段位历史面板崩溃 */
  if (!startStr) return '';
  if (!endStr) return fmtMonthDay(startStr);
  const sy = startStr.slice(0, 4),
    ey = endStr.slice(0, 4);
  if (sy === ey) return fmtMonthDay(startStr) + ' 至 ' + fmtMonthDay(endStr);
  return sy + '年' + fmtMonthDay(startStr) + ' 至 ' + ey + '年' + fmtMonthDay(endStr);
}
function renderRankSystem() {
  checkRankPromotion();
  const rs = appData.rankSystem;
  if (!rs) return;
  if (
    Array.isArray(rs.dailyStarHistory) &&
    rs.dailyStarHistory.some(function (x) {
      return !x.date;
    })
  ) {
    rs.dailyStarHistory = rs.dailyStarHistory.filter(function (x) {
      return !!x.date;
    });
    saveData();
  }
  /* 清理历史遗留的空日期记录（会让战绩凭空多出扣星） */ if (rs.starProtection === undefined) rs.starProtection = 0;
  if (rs.consecutiveOver === undefined) rs.consecutiveOver = 0;
  if (rs.consecutiveUnder === undefined) rs.consecutiveUnder = 0;
  if (rs.consecutiveActiveDays === undefined) rs.consecutiveActiveDays = 0;
  if (rs.dailyTask === undefined || rs.dailyTask === null)
    rs.dailyTask = {
      date: null,
      target: 3,
      starsGainedToday: 0,
      settled: false,
      overCompleted: false,
      underCompleted: false,
      starMult: 1
    };
  if (rs.dailyTask.starsGainedToday === undefined) rs.dailyTask.starsGainedToday = 0;
  const tier = getRankFromStars(rs.stars);
  const subIdx = getSubRankIndex(rs.stars, tier);
  const today = getTodayStr();
  const todayFull = getTodayEffectiveFull();
  const target = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask.target : 3;
  const box = document.getElementById('rankBadgeBox');
  if (box) {
    box.textContent = tier.icon;
    box.style.borderColor = tier.color;
    box.style.background = tier.bg;
    if (tier.glow) box.classList.add('rank-glow');
    else box.classList.remove('rank-glow');
  }
  const rn = document.getElementById('rankName');
  if (rn) {
    rn.textContent = tier.name;
    rn.style.color = tier.color;
  }
  const rs2 = document.getElementById('rankSub');
  if (rs2) {
    rs2.textContent = subIdx >= 0 ? SUB_RANKS[subIdx] : '';
  }
  const rstars = document.getElementById('rankStars');
  if (rstars) {
    rstars.textContent = rs.stars + ' ⭐';
    rstars.style.color = tier.color;
    if (rstars.getAttribute('data-v') !== String(rs.stars)) {
      rstars.setAttribute('data-v', String(rs.stars));
      fxNumPop(rstars); /* E4-01 仅数值真变时跳动 */
    }
  }
  const fill = document.getElementById('rankProgressFill');
  const ptext = document.getElementById('rankProgressText');
  if (fill && ptext) {
    if (tier.name === '荣耀') {
      fill.style.width = '100%';
      fill.style.background = tier.color;
      ptext.textContent = '已达最高段位';
    } else {
      const range = tier.max - tier.min;
      const pos = rs.stars - tier.min;
      const pct = Math.min(100, (pos / range) * 100);
      fill.style.width = pct + '%';
      fill.style.background = tier.color;
      const nextSub = Math.floor(pos / (range / 3)) + 1;
      let nextText = '';
      if (nextSub < 3) {
        nextText = '距' + tier.name + SUB_RANKS[nextSub] + ' ' + (Math.ceil((range / 3) * nextSub) - pos) + '星';
      } else {
        const nextTier = RANK_TIERS[RANK_TIERS.indexOf(tier) + 1];
        if (nextTier) nextText = '距' + nextTier.name + 'Ⅲ ' + (tier.max - rs.stars) + '星';
        else nextText = '已达最高';
      }
      ptext.textContent = nextText;
    }
  }
  const rankDt = rs.dailyTask;
  const rankPostponed = !!(rankDt && rankDt.postponed && rankDt.date !== today);
  const tp = document.getElementById('rankTaskProgress');
  const ts = document.getElementById('rankTaskStatus');
  if (rankPostponed) {
    if (tp) tp.textContent = '⏭ 今日任务已延后至明天（目标 ' + (rankDt.target || 3) + ' 个🍅）';
    if (ts) {
      ts.textContent = '明天再战';
      ts.style.color = 'var(--yellow-dark)';
      ts.style.background = 'rgba(255,183,77,0.12)';
    }
  } else {
    if (tp) tp.textContent = '完成 ' + fmtTomatoNum(todayFull) + '/' + target + ' 个番茄';
    if (ts) {
      if (todayFull >= target) {
        ts.textContent = '✅ 超额' + fmtTomatoNum(Math.max(0, todayFull - target)) + '个';
        ts.style.color = 'var(--green)';
        ts.style.background = 'rgba(92,184,92,0.1)';
      } else {
        ts.textContent = '还差' + Math.max(1, Math.ceil(target - todayFull)) + '个';
        ts.style.color = 'var(--text-light)';
        ts.style.background = 'var(--bg)';
      }
    }
  }
  /* 段位任务卡：本周实际可消耗的番茄（= 本周完成完整🍅 − 段位下注消耗；不影响统计数据） */
  const rtAvailEl = document.getElementById('rankTaskAvail');
  if (rtAvailEl) {
    const spendable = getSpendableTomatoes();
    const weekFullRank = getWeekTomatoPoints();
    const spentAll = countWeekAllSpent(); /* 段位下注 + 商店兑换，合计 */
    const spentBet = getWeekSpentTomatoes();
    const exAvail = Math.max(0, spentAll - spentBet); /* 商店兑换掉的部分 */
    rtAvailEl.textContent =
      '🍅 本周可消耗 ' +
      fmtTomatoNum(spendable) +
      ' 个（完成 ' +
      fmtTomatoNum(weekFullRank) +
      ' · 已消耗 ' +
      fmtTomatoNum(spentAll) +
      (exAvail > 0 ? '，其中兑换 ' + fmtTomatoNum(exAvail) : '') +
      '）';
    rtAvailEl.style.color = spendable > 0 ? 'var(--green-dark)' : 'var(--text-light)';
  }
  const extras = document.getElementById('rankExtras');
  if (extras) {
    let html = '';
    const _bst = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask.boosted || null : null;
    if (_bst) {
      /* 奖励星数必须按实际下注档位取，不能写死 5。
         此前 UI 写死「+5⭐」而按钮/结算按档位给（小赌5/中赌11/大赌18），
         于是同一注在不同位置显示 5 和 18，用户完全看不懂。 */
      const _bt = getBetTier(_bst.level);
      const _rw = _bt ? _bt.reward : 5;
      const _lbl = _bt ? _bt.icon + ' ' + _bt.label : '';
      html +=
        '<div class="rank-extra-item" style="color: var(--primary-ink);font-weight:800;">🔥 ' +
        (_bst.claimed ? _lbl + ' 赌赢 +' + _rw + '⭐ ✅' : _lbl + ' 已下注：完成新目标 +' + _rw + '⭐') +
        '</div>';
    }
    html += '<div class="rank-extra-item">🛡️ 保星: ' + rs.starProtection + '/1</div>';
    html += '<div class="rank-extra-item">🔥 连续超额: ' + (rs.consecutiveOver || 0) + '天</div>';
    html += '<div class="rank-extra-item">📅 活跃: ' + (rs.consecutiveActiveDays || 0) + '天</div>';
    if (tier.promotion) html += '<div class="rank-extra-item" style="color:var(--purple);">🏆 晋升赛</div>';
    extras.innerHTML = html;
  }
  const stag = document.getElementById('seasonTag');
  if (stag) {
    const si = getSeasonInfo();
    rs.seasonNumber = si.number;
    stag.textContent = seasonLabel(si.number) + ' · ' + fmtSeasonRange(si.startDate, si.endDate);
  }
  renderTimerRankStrip();
  renderRerollUI();
  renderStarPath();
  renderDropWarn();
  renderGhostBar();
  renderEasyModeTag();
  renderStarRecords();
  renderSignIn();
}
/* 战绩面板：聚合 dailyStarHistory 最近 7 天（含今天）的加减星（王者荣耀式） */
function renderStarRecords() {
  const body = document.getElementById('starRecordBody');
  if (!body) return;
  const rs = appData.rankSystem;
  if (!rs) return;
  const today = getTodayStr();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = getDateStr(d);
    let gained = 0,
      lost = 0,
      actual = null,
      target = null,
      note = '';
    if (ds === today) {
      gained = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask.starsGainedToday || 0 : 0;
      lost = rs.pendingStarLossDate === today ? rs.pendingStarLoss || 0 : 0; /* 怠惰衰减等当天扣星也要显示 */
      actual = rs.dailyTask && rs.dailyTask.date === today ? countTomatoPoints(today) : 0;
      target = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask.target : null;
    } else {
      const h = (rs.dailyStarHistory || []).find(function (x) {
        return x.date === ds;
      });
      if (h) {
        gained = h.starsGained || 0;
        lost = h.starsLost || 0;
        actual = h.actual;
        target = h.target;
        if (h.bonusStars) note = '🎁 超额+' + h.bonusStars;
        else if (h.protectionUsed) note = '🛡️ 保星';
        else if (h.betLost && lost === 0) note = '🔥 下注输·未降星';
        else if (h.betLost) note = '🔥 下注输';
        else if (!gained && !lost && target != null && actual != null) note = '无变化';
      }
    }
    days.push({
      ds: ds,
      gained: gained,
      lost: lost,
      actual: actual,
      target: target,
      note: note,
      isToday: ds === today
    });
  }
  body.innerHTML =
    '<div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">' +
    days
      .slice()
      .reverse()
      .map(function (d) {
        const net = d.gained - d.lost;
        const netColor = net > 0 ? 'var(--green)' : net < 0 ? '#E53935' : 'var(--text-light)';
        const netTxt = net > 0 ? '+' + net + '⭐' : net < 0 ? net + '⭐' : '—';
        const met = d.target != null && d.actual != null;
        const metTxt = met
          ? '<b style="color:' +
            (d.actual >= d.target ? 'var(--green)' : '#E53935') +
            ';">' +
            fmtTomatoNum(d.actual) +
            '/' +
            d.target +
            '</b>'
          : '—';
        return (
          '<div style="display:flex;align-items:center;gap:var(--sp-10);padding:var(--sp-8) var(--sp-12);' +
          (d.isToday ? 'background:var(--bg);' : 'border-top:1px solid var(--border);') +
          '">' +
          '<div style="width:62px;flex-shrink:0;"><div style="font-size:var(--fs-body);font-weight:800;color:' +
          (d.isToday ? 'var(--primary)' : 'var(--text)') +
          ';">' +
          (d.isToday ? '今天' : '周' + '日一二三四五六'[new Date(d.ds + 'T00:00:00').getDay()]) +
          '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">' +
          d.ds.slice(5) +
          '</div></div>' +
          '<div style="flex:1;font-size:var(--fs-note);color:var(--text-light);">🍅 ' +
          metTxt +
          (d.note ? ' <span style="font-size:var(--fs-caption);">' + d.note + '</span>' : '') +
          '</div>' +
          '<div style="flex-shrink:0;font-size:var(--fs-body);font-weight:900;color:' +
          netColor +
          ';">' +
          netTxt +
          '</div>' +
          '</div>'
        );
      })
      .join('') +
    '</div>';
  const a = document.getElementById('starRecordArrow');
  if (a) a.textContent = body.style.display === 'none' ? '▸' : '▾';
}
/* =====  每日签到：完成 ≥1 个番茄后可签 +10🪙，每天一次，累计 7 天解锁成就 ===== */
const SIGNIN_COINS = 10;
function renderSignIn() {
  const bar = document.getElementById('signInBar');
  if (!bar) return;
  const s = appData.signIn || (appData.signIn = { lastDate: null, totalDays: 0 });
  const today = getTodayStr();
  const signed = s.lastDate === today;
  const hasTomato = (appData.records || []).some(function (r) {
    return getDateStr(r.startTime) === today && (r.type === 'full' || r.type === 'half');
  });
  const total = s.totalDays || 0;
  if (signed) {
    bar.style.display = 'block';
    bar.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);padding:var(--sp-10) var(--sp-12);background:var(--surface-2);border:0;border-left:2px solid var(--hairline);border-radius:var(--radius-sm);margin-top:var(--sp-8);">' +
      '<div style="font-size:var(--fs-body);color:var(--text);font-weight:700;">📅 今日已签到</div>' +
      '<div style="font-size:var(--fs-caption);color:var(--text-light);">累计签到 <b style="color: var(--yellow-ink);">' +
      total +
      '</b> 天' +
      (total >= 7 ? ' 🏅' : total > 0 ? ' · 成就第' + total + '/7 次' : '') +
      '</div>' +
      '</div>';
  } else if (hasTomato) {
    bar.style.display = 'block';
    bar.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);padding:var(--sp-10) var(--sp-12);background:var(--surface-2);border:0;border-left:2px solid var(--hairline);border-radius:var(--radius-sm);margin-top:var(--sp-8);">' +
      '<div style="font-size:var(--fs-body);color:var(--text);font-weight:700;">📅 今日签到 <b style="color: var(--yellow-ink);">+' +
      SIGNIN_COINS +
      '🪙</b>' +
      (total + 1 < 7 ? ' · 成就第' + (total + 1) + '/7 次' : '') +
      '</div>' +
      '<button class="btn-small" style="background:var(--yellow);color:#fff;font-weight:800;padding:var(--sp-6) var(--sp-14);white-space:nowrap;" onclick="doSignIn()">🖐 签到领金币</button>' +
      '</div>';
  } else {
    bar.style.display = 'block';
    bar.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);padding:var(--sp-10) var(--sp-12);background:var(--surface-2);border:0;border-left:2px solid var(--hairline);border-radius:var(--radius-sm);margin-top:var(--sp-8);">' +
      '<div style="font-size:var(--fs-note);color:var(--text-light);">📅 完成 <b style="color:var(--text);">1 个番茄</b>后可签到 +' +
      SIGNIN_COINS +
      '🪙' +
      (total < 7 ? ' · 成就第' + (total + 1) + '/7 次' : '') +
      '</div>' +
      '<button class="btn-small" style="padding:var(--sp-6) var(--sp-12);white-space:nowrap;opacity:.55;" disabled>🖐 签到</button>' +
      '</div>';
  }
}
function doSignIn() {
  const s = appData.signIn || (appData.signIn = { lastDate: null, totalDays: 0 });
  const today = getTodayStr();
  if (s.lastDate === today) {
    showToast('今天已经签过到啦，明天再来');
    return;
  }
  const hasTomato = (appData.records || []).some(function (r) {
    return getDateStr(r.startTime) === today && (r.type === 'full' || r.type === 'half');
  });
  if (!hasTomato) {
    showToast('完成 1 个番茄后才能签到，快去开始吧 🍅');
    return;
  }
  s.lastDate = today;
  s.totalDays = (s.totalDays || 0) + 1;
  /* 金币不在这里直接加：统一由 showGift 入账（否则礼包弹窗点开时再加一遍 = 双倍） */
  saveData();
  /* 累计 7 天 → 自动检测「一周都没落下」成就（解锁会记传记 + 可领取金币） */
  try {
    checkNewAchievements();
  } catch (e) { if (window.__silent) window.__silent(e, '01e6:doSignIn'); }
  renderSignIn();
  renderRankSystem();
  /* 签到成功给关键元素 pop 动画 + 双叮咚音效 */
  const _sib = document.getElementById('signInBar');
  if (_sib) popEl(_sib);
  playSound('reward');
  showGift('📅 每日签到（第 ' + s.totalDays + ' 天）', SIGNIN_COINS);
}
/* 通用折叠开关：toggleFold(内容id, 箭头id) */
function toggleFold(bodyId, arrowId) {
  const d = document.getElementById(bodyId),
    a = document.getElementById(arrowId);
  if (!d) return;
  const open = d.style.display !== 'none';
  d.style.display = open ? 'none' : 'block';
  if (a) a.textContent = open ? '▸' : '▾';
}
function renderRerollUI() {
  /* 「🔥 今日赌注」：花 🍅 下注（三档）→ 目标上浮、花的🍅 从进度扣除；完成按档位 +5~18⭐，没完成按新目标降星 */
  const el = document.getElementById('rerollBox');
  if (!el) return;
  const rs = appData.rankSystem;
  const today = getTodayStr();
  const st = getRerollState();
  const cost = getRerollCost(st.count);
  const avail = getSpendableTomatoes();
  const can = avail >= cost;
  const realDt = rs.dailyTask || null;
  const postponedToday = !!(realDt && realDt.postponed && realDt.date !== today);
  const dt = realDt && realDt.date === today ? realDt : null;
  const boosted = dt ? dt.boosted || null : null;
  const claimed = boosted && boosted.claimed;
  const todayFull = getTodayEffectiveFull();
  const curTarget = dt ? dt.target || 3 : 3;
  /* 延后按钮（已下注未兑现时不可延后） */
  const canPostpone = !!(
    realDt &&
    !realDt.postponed &&
    !realDt.settled &&
    realDt.date === today &&
    !boosted &&
    todayFull < curTarget
  );
  let postponeBtn = '';
  if (canPostpone) {
    postponeBtn =
      '<button class="reroll-postpone-btn" data-act="postponeDailyTaskSafe">⏭ 延后一天</button>';
  } else if (realDt && realDt.postponed) {
    postponeBtn =
      '<button class="reroll-postpone-btn" style="opacity:.45;cursor:not-allowed;" title="最多只能延后一天">⏭ ' +
      (postponedToday ? '已延后至明天' : '已延过') +
      '</button>';
  } else if (boosted && !claimed) {
    postponeBtn =
      '<button class="reroll-postpone-btn" style="opacity:.45;cursor:not-allowed;" title="已下注不能延后，今天必须见分晓">⏭ 已下注·不可延后</button>';
  }
  /* 赌注三档按钮（未下注）/ 已下注状态 */
  let boostBtn = '';
  const curTier = boosted ? getBetTier(boosted.level) : null;
  if (claimed) {
    boostBtn =
      '<button class="history-btn" style="white-space:nowrap;opacity:.45;cursor:not-allowed;" title="今天已兑现">🔥 赌赢了 +' +
      (curTier ? curTier.reward : 5) +
      '⭐ ✅</button>';
  } else if (boosted) {
    boostBtn =
      '<button class="history-btn" style="white-space:nowrap;opacity:.6;cursor:not-allowed;" title="完成新目标后自动到账">🔥 ' +
      curTier.icon +
      '已下注 · ' +
      fmtTomatoNum(todayFull) +
      '/' +
      curTarget +
      ' · 完成+' +
      curTier.reward +
      '⭐</button>';
  } else {
    const canBet = can && !postponedToday;
    boostBtn = BET_TIERS.map(function (t) {
      const okTier = canBet && avail >= t.cost;
      return (
        '<button class="history-btn bet-tier-btn" data-act="tryBetSafe" data-act-args=\'[' +
        t.level +
        ']\' style="' +
        (okTier ? '' : 'opacity:.45;') +
        '" title="' +
        t.icon +
        ' ' +
        t.label +
        '：花 ' +
        t.cost +
        '🍅，目标上浮 ' +
        getBetStep(t, curTarget) +
        ' 个，完成 +' +
        t.reward +
        '⭐（点击下注，详情见弹窗）">' +
        t.icon +
        ' ' +
        t.label +
        ' +' +
        t.reward +
        '⭐</button>'
      );
    }).join('');
  }
  /* 赌注状态徽章 */
  let boostBadge = '';
  if (boosted) {
    boostBadge =
      '<span style="font-size:var(--fs-body);font-weight:800;color: var(--primary-ink);background:#FFF3CD;border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-2) var(--sp-8);">🔥 ' +
      (claimed
        ? '赌赢 +' + (curTier ? curTier.reward : 5) + '⭐ ✅'
        : '已下注：目标 ' + curTarget + '，进度 ' + fmtTomatoNum(todayFull) + '/' + curTarget) +
      '</span>';
  }
  /* 布局：三档赌注均分一行（主操作），「延后一天」降级成右下角一行灰字链接。
     之前把延后塞进同一行 flex-wrap 里，它会被挤成 351px 宽 × 30px 高的细长条 ——
     一个只有 4 个字的按钮占满一整行，视觉重量和三个赌注按钮完全不相称。
     延后是「今天先不算」的逃生口，不是主操作，所以给它最小的视觉重量。 */
  el.innerHTML =
    '<div class="reroll-bets">' +
    boostBadge +
    boostBtn +
    '</div>' +
    (postponeBtn ? '<div class="reroll-postpone">' + postponeBtn + '</div>' : '');
  /* 折叠说明占位 */
  function setRrTxt(id, v) {
    let n = document.getElementById(id);
    if (n) n.textContent = v;
  }
  setRrTxt('rrCost', cost);
  setRrTxt('rrAvail', avail);
  setRrTxt('rrCount', st.count);
  let s = document.getElementById('rrGot');
  if (s) s.textContent = (dt ? dt.starsGainedToday || 0 : 0) + ' ⭐';
}
/* 掉星预警：任务卡里动态显示「现在停止明天扣多少星」，让扣星机制看得见 */
function renderDropWarn() {
  const el = document.getElementById('rankDropWarn');
  if (!el) return;
  const rs = appData.rankSystem;
  if (!rs) return;
  const today = getTodayStr();
  const dt = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask : null;
  if (!dt || dt.postponed) {
    el.innerHTML = '';
    return;
  }
  const eff = getTodayEffectiveFull();
  const target = dt.target || 3;
  const teamToday =
    appData.teamSystem &&
    appData.teamSystem.today &&
    appData.teamSystem.today.date === today &&
    appData.teamSystem.today.partnerJoined;
  let html = '';
  if (eff >= target) {
    const teamTag = teamToday ? '（⚠️ 今天组队了：还需<b>队友也完成</b>，明天才不掉星）' : '';
    html += '<span class="rdw-ok">✅ 今日任务已达标，明天不掉星' + teamTag + '</span>';
  } else {
    const drop = calcDropStars(target, eff);
    const starsNow = rs.stars || 0;
    if (starsNow <= 0) {
      /* 0 星扣不动：简洁提示不掉星 */
      html += '<span class="rdw-ok">✅ 段位 0 星，不掉星</span>';
    } else {
      const lost = Math.min(drop.lost, starsNow);
      const extra = (rs.consecutiveUnder || 0) >= 1 ? '（连续未达标额外 -1⭐）' : '';
      const betTag = dt.boosted && !dt.boosted.claimed ? ' · 已下注按新目标结算' : '';
      const teamTag = teamToday ? ' · 组队日需双方都完成' : '';
      html +=
        '<span class="rdw-warn">📉 若现在停止：明天 -' +
        lost +
        '⭐（还差 ' +
        fmtTomatoNum(target - eff) +
        ' 个）' +
        extra +
        betTag +
        teamTag +
        '</span>';
    }
  }
  /* 怠惰衰减：连续 7 天完全无番茄 → 每 7 天 -1⭐ */
  let _lr = 0;
  appData.records.forEach(function (r) {
    if (r.startTime > _lr) _lr = r.startTime;
  });
  if (_lr > 0 && rs.stars > 0) {
    let _idle = Math.floor((Date.now() - _lr) / DAY_MS);
    if (_idle >= 7)
      html += '<span class="rdw-idle">😴 已连续 ' + _idle + ' 天未专注：每 7 天 -1⭐（回来做个番茄即可停止）</span>';
  }
/* 赛季回退：赛季最后 14 天提醒回退目标 */
  try {
    const _si = getSeasonInfo();
    const _daysLeft = Math.ceil((_si.seasonEnd.getTime() - Date.now()) / DAY_MS);
    if (_daysLeft > 0 && _daysLeft <= 14) {
      const _tier = getRankFromStars(rs.stars);
      const _fb = {
        荣耀: '钻石Ⅰ',
        王者: '铂金Ⅰ',
        星耀: '黄金Ⅰ',
        钻石: '白银Ⅰ',
        铂金: '青铜Ⅰ',
        黄金: '青铜Ⅰ',
        白银: '青铜Ⅰ',
        青铜: '青铜Ⅰ'
      }[_tier.name];
      if (_fb && _tier.name !== '青铜')
        html +=
          '<span class="rdw-season">🔄 赛季还剩 ' + _daysLeft + ' 天：结束后 ' + _tier.name + ' → ' + _fb + '</span>';
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01e6:renderDropWarn'); }
  el.innerHTML = html;
}
/* ⭐ 今日星途：多元上星面板（今日星构成 + 连胜 + 每周挑战） */
function renderStarPath() {
  const el = document.getElementById('starPathBox');
  if (!el) return;
  const rs = appData.rankSystem;
  if (!rs) return;
  const today = getTodayStr();
  const dt = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask : null;
  const target = dt ? dt.target || 3 : 3;
  const todayFull = getTodayEffectiveFull();
  const todayPts = countTomatoPoints(today);
  /* —— 今日已得构成 —— */
  const volHave = dt ? dt.volumeBonus || 0 : 0;
  const roundBase = dt ? dt.roundBase || 0 : 0;
  /* 与结算口径对齐——"超额完成"不含完成今日任务奖励星。
   * 结算层(01d onPomodoroCompleteRank)的 roundGot 剔除了 _bstDone(doneReward)，
   * 展示层此前漏剔，把完成任务奖励错标成"超额完成"，导致面板构成与实际入账对不上。 */
  const doneGot = dt && dt.doneReward ? dt.doneReward : 0;
  const roundGot = Math.max(
    0,
    (dt ? dt.starsGainedToday || 0 : 0) -
      roundBase -
      volHave -
      doneGot -
      (dt ? dt.extToday || 0 : 0) -
      (dt && dt.burst ? (dt.burst.includes(14) ? 2 : dt.burst.includes(10) ? 1 : 0) : 0) -
      (dt && dt.boosted && dt.boosted.claimed ? 5 : 0)
  );
  const excess = Math.max(0, todayFull - target);
  const roundLeft = Math.max(0, calcExcessStars(excess) - roundGot);
  const streak = rs.streak || { count: 0, claimDate: null };
  const streakGot = streak.claimDate === today ? (streak.count >= 7 ? 2 : 1) : 0;
  const burst = dt ? dt.burst || [] : [];
  const burstGot = burst.includes(14) ? 2 : burst.includes(10) ? 1 : 0;
  const boosted = dt ? dt.boosted || null : null;
  const betGot = boosted && boosted.claimed ? 5 : 0;
  const got = dt ? dt.starsGainedToday || 0 : 0;
  /* —— 今日已得（人话）：非零项才列出，全零显示鼓励语 —— */
  const gotParts = [];
  if (doneGot > 0) gotParts.push('完成今日任务 +' + doneGot + '⭐');
  if (roundGot > 0) gotParts.push('超额完成 +' + roundGot + '⭐');
  if (streakGot > 0) gotParts.push('连胜奖励 +' + streakGot + '⭐');
  if (burstGot > 0) gotParts.push('今日冲量 +' + burstGot + '⭐');
  if (betGot > 0) gotParts.push('赌注赢 +' + betGot + '⭐');
  let html = '';
  /* 极简版：标题一行（已拿星数）+ 还能拿一行 + 连胜一行 */
  html +=
    '<div class="sp-title">⭐ 今日拿星 ' +
    (got > 0
      ? '<span style="font-size:var(--fs-body);color: var(--primary-ink);font-weight:800;">已拿 ' +
        got +
        ' ⭐</span>' +
        (gotParts.length
          ? '<span style="font-size:var(--fs-caption);color:var(--text-light);font-weight:400;">（' +
            gotParts.join('·') +
            '）</span>'
          : '')
      : '<span style="font-size:var(--fs-body);color:var(--text-light);font-weight:400;">今天还没拿星</span>') +
    '</div>';
  /* 还能拿：合并为一行短句（· 分隔），每项只说"做什么→拿什么" */
  const more = [];
  if (todayFull < target && !boosted)
    more.push('完成今日任务（还差 ' + fmtTomatoNum(Math.max(0, target - todayFull)) + ' 个）不掉星');
  if (roundLeft > 0) more.push('超额每多 1 个 +1⭐');
  if (!burst.includes(10)) more.push('到 10 个🍅 +1⭐');
  else if (!burst.includes(14)) more.push('到 14 个🍅 再 +2⭐');
  if (more.length) html += '<div class="sp-more">📈 还能拿：' + more.join(' · ') + '</div>';
  /* 连胜：一行极简 */
  const streakTxt =
    streak.count <= 0
      ? '🔥 连胜 0 天（连续 3 天起每天 +1⭐）'
      : streak.count >= 3
        ? '🔥 连胜 ' + streak.count + ' 天（每天 +1⭐）'
        : '🔥 连胜 ' + streak.count + ' 天（再 ' + (3 - streak.count) + ' 天起每天 +1⭐）';
  html += '<div class="sp-streak">' + streakTxt + '</div>';
  /* 每周挑战 */
  calcWeeklyChallengeProgress();
  const wc = rs.weeklyChallenge || { items: [] };
  html += '<div class="sp-wc">';
  if (wc.items && wc.items.length) {
    wc.items.forEach(function (it) {
      const pct = Math.min(100, Math.round((it.progress / it.goal) * 100));
      html +=
        '<div class="sp-wc-item' +
        (it.done ? ' done' : '') +
        '"><span class="wc-icon">' +
        (it.done ? '✅' : it.icon) +
        '</span><div class="wc-info"><div class="wc-name">' +
        it.name +
        '</div><div class="wc-bar"><div class="wc-fill" style="width:' +
        pct +
        '%"></div></div></div><span class="wc-reward">' +
        (it.done ? '已领 +' + it.reward + '⭐' : fmtNum2(it.progress) + '/' + it.goal + ' → +' + it.reward + '⭐') +
        '</span></div>';
    });
  }
  html += '</div>';
  el.innerHTML = html;
}
/* ===== 计时页段位条（开始/结束/打断 按钮下方） ===== */
function renderTimerRankStrip() {
  const rs = appData.rankSystem;
  if (!rs) return;
  const tier = getRankFromStars(rs.stars);
  const sub = getSubRankIndex(rs.stars, tier);
  const set = (id, v) => {
    const e = document.getElementById(id);
    if (e) e.textContent = v;
  };
  set('trsIcon', tier.icon);
  const nameEl = document.getElementById('trsName');
  if (nameEl) {
    nameEl.textContent = tier.name + (sub >= 0 ? ' ' + SUB_RANKS[sub] : '');
    nameEl.style.color = tier.color;
  }
  const stEl = document.getElementById('trsStars');
  if (stEl) {
    stEl.textContent = rs.stars + ' ⭐';
    stEl.style.color = tier.color;
    if (stEl.getAttribute('data-v') !== String(rs.stars)) {
      stEl.setAttribute('data-v', String(rs.stars));
      fxNumPop(stEl); /* E4-01 仅数值真变时跳动 */
    }
  }
  const today = getTodayStr();
  const todayFull = getTodayEffectiveFull();
  const rsDt = rs.dailyTask;
  const postponedDay = !!(rsDt && rsDt.postponed && rsDt.date !== today);
  const target = rsDt && rsDt.date === today ? rsDt.target : 3;
  const pct = postponedDay ? 0 : Math.min(100, Math.round((todayFull / Math.max(1, target)) * 100));
  const base = rsDt && rsDt.date === today && rsDt.baseline ? rsDt.baseline : 0;
  const _bst2 = rsDt && rsDt.date === today ? rsDt.boosted || null : null;
  /* 这里同样不能写死 +5，按实际档位输出（与下注按钮/结算同一口径） */
  const _bst2Rw = _bst2 ? (getBetTier(_bst2.level).reward) : 0;
  /* 把「今日做了几个完整 / 几个半个」摊开写。
     只显示 0.5/3 时，用户会以为"半个番茄根本没算进去"——实际上算了，只是没说明。
     这里在有半个番茄时补一句来源明细，进度是怎么涨的一目了然。 */
  const _tbHalf = ((getStatsCache().tb || {}).half) || 0;
  const _tbFull = ((getStatsCache().tb || {}).full) || 0;
  const _halfNote = _tbHalf > 0 ? '（完整 ' + _tbFull + ' · 半个 ' + _tbHalf + '，各计 1 / 0.5）' : '';
  set(
    'trsTask',
    postponedDay
      ? '⏭ 今日任务已延后至明天（目标 ' + target + ' 🍅）'
      : '今日任务 ' +
          fmtTomatoNum(todayFull) +
          '/' +
          target +
          ' 🍅' +
          (todayFull >= target ? ' ✅ 已完成' : '') +
          _halfNote +
          (_bst2 && !_bst2.claimed
            ? ' 🔥已下注'
            : _bst2 && _bst2.claimed
              ? ' 🔥赌赢+' + _bst2Rw + '⭐'
              : '') +
          (base ? '（换任务后重算，已作废 ' + base + '）' : '')
  );
  /* 段位条右栏：今日待办 / 今日待打卡（紧凑提示，不变宽） */
  const trsAvailEl = document.getElementById('trsAvail');
  if (trsAvailEl) {
    const undone = (appData.todos || []).filter(function (t) {
      return !t.done;
    }).length;
    const today = getTodayStr();
    const habits = appData.habits || [];
    /* 只数「今天该做」的（规则/配额命中 + 非归档 + 今天没跳过）：口径归 habitDueToday */
    const dueHabits = habits.filter(function (h) {
      return h && !h.archived && habitDueToday(h, today);
    });
    const hLeft = dueHabits.length
      ? dueHabits.filter(function (h) {
          return !(appData.habitLogs[h.id] || []).includes(today);
        }).length
      : 0;
    if (undone === 0 && hLeft === 0) {
      /* 待办与习惯全部清空：不显示任何状态文字（「✓ 全部完成」容易误读成段位任务完成，已去掉） */
      trsAvailEl.innerHTML = '';
      trsAvailEl.style.color = '';
    } else {
      const parts = [];
      if (undone > 0)
        parts.push(
          '<span style="color:var(--text);">📋 <b style="color: var(--primary-ink);">' + undone + '</b> 待办</span>'
        );
      if (hLeft > 0)
        parts.push(
          '<span style="color:var(--text);">🌱 <b style="color: var(--yellow-ink);">' + hLeft + '</b> 待打卡</span>'
        );
      trsAvailEl.innerHTML = parts.join(' <span style="color:var(--text-light);">·</span> ');
      trsAvailEl.style.color = '';
    }
  }
  const fill = document.getElementById('trsFill');
  if (fill) {
    fill.style.width = pct + '%';
    fill.style.background = tier.color;
  }
  const box = document.getElementById('timerRankStrip');
  if (box) box.style.borderColor = tier.color;
  updateHonorEffects();
  renderGhostBar();
}
/* ===== 荣誉特效：段位光环 + 战力标计时文本变色 ===== */
function updateHonorEffects() {
  const circle = document.getElementById('timerCircle');
  const timeEl = document.getElementById('timerTime');
  if (!circle || !timeEl) return;
  /* 段位光环：钻石/星耀静态微光，王者红色呼吸，荣耀黑金呼吸；上赛季王者/荣耀装饰延续一期 */
  const rs = appData.rankSystem;
  const tier = rs ? getRankFromStars(rs.stars) : null;
  let decoTier = null;
  /* 适配：按星数判断（>=900 荣耀系黑金、>=500 王者系红金），段位增删不用改这里 */
  const _stN = (rs && rs.stars) || 0;
  if (_stN >= 1000) decoTier = 'glory';
  else if (_stN >= 500) decoTier = 'king';
  if (!decoTier && rs && rs.lastSeasonDecoration && rs.lastSeasonDecoration.season === rs.seasonNumber) {
    decoTier = rs.lastSeasonDecoration.tier === '荣耀' ? 'glory' : 'king';
  }
  circle.classList.remove('rank-glow', 'rank-glory', 'rank-static-diamond', 'rank-static-star');
  if (decoTier === 'glory') circle.classList.add('rank-glory');
  else if (decoTier === 'king') circle.classList.add('rank-glow');
  else if (tier && tier.name === '星耀') circle.classList.add('rank-static-star');
  else if (tier && tier.name === '钻石') circle.classList.add('rank-static-diamond');
  /* 战力标点亮 → 计时文本变色：王者金色 / 荣耀黑金渐变 / 其他标用其主题色 */
  timeEl.classList.remove('badge-gold', 'badge-glory-gold');
  timeEl.style.color = '';
  let bestBadge = null,
    bestState = 'off';
  for (let i = WEEKLY_BADGES.length - 1; i >= 0; i--) {
    const st = getBadgeState(WEEKLY_BADGES[i]);
    if (st !== 'off') {
      bestBadge = WEEKLY_BADGES[i];
      bestState = st;
      break;
    }
  }
  if (bestBadge && bestState !== 'off') {
    if (bestBadge.id === 'glory') timeEl.classList.add('badge-glory-gold');
    else if (bestBadge.id === 'king') timeEl.classList.add('badge-gold');
    else timeEl.style.color = bestBadge.color;
  }
}
function showHistoryPanel() {
  const rs = appData.rankSystem;
  const body = document.getElementById('historyBody');
  if (!body) return;
  let html = '<div class="history-section"><h4>🏆 生涯最高</h4>';
  html +=
    '<div class="history-stat-row"><span>最高星数</span><span style="font-weight:700;color: var(--primary-ink);">' +
    (rs.history.maxStarsCareer || 0) +
    ' ⭐</span></div>';
  html +=
    '<div class="history-stat-row"><span>最高段位</span><span style="font-weight:700;">' +
    (rs.history.maxRankNameCareer || '青铜Ⅲ') +
    '</span></div>';
  html += '</div>';
  html += '<div class="history-section"><h4>📋 赛季档案</h4>';
  if (!rs.history.seasons || !rs.history.seasons.length) {
    const si = getSeasonInfo();
    html +=
      '<div class="history-season-card"><div class="history-season-title">' +
      seasonLabel(si.number) +
      ' · 进行中（' +
      fmtSeasonRange(si.startDate, si.endDate) +
      '）</div>';
    html +=
      '<div class="history-stat-row"><span>当前星数</span><span style="font-weight:700;">' +
      rs.stars +
      ' ⭐</span></div>';
    html +=
      '<div class="history-stat-row"><span>当前段位</span><span style="font-weight:700;">' +
      getRankFullName(rs.stars) +
      '</span></div></div>';
    html +=
      '<div style="text-align:center;color:var(--text-light);padding:var(--sp-10);font-size:var(--fs-title);">暂无历史赛季记录</div>';
  } else {
    const si = getSeasonInfo();
    html +=
      '<div class="history-season-card" style="border-color:var(--primary);"><div class="history-season-title">' +
      seasonLabel(si.number) +
      ' · 进行中（' +
      fmtSeasonRange(si.startDate, si.endDate) +
      '）</div>';
    html +=
      '<div class="history-stat-row"><span>当前星数</span><span style="font-weight:700;">' +
      rs.stars +
      ' ⭐</span></div>';
    html +=
      '<div class="history-stat-row"><span>当前段位</span><span style="font-weight:700;">' +
      getRankFullName(rs.stars) +
      '</span></div></div>';
    rs.history.seasons
      .slice()
      .reverse()
      .forEach(s => {
        html +=
          '<div class="history-season-card"><div class="history-season-title">' +
          seasonLabel(getSeasonNumberAt(s.startDate)) +
          ' · ' +
          fmtSeasonRange(s.startDate, s.endDate) +
          '</div>';
        html +=
          '<div class="history-stat-row"><span>最高星数</span><span style="font-weight:700;">' +
          s.maxStars +
          ' ⭐</span></div>';
        html +=
          '<div class="history-stat-row"><span>最高段位</span><span style="font-weight:700;">' +
          s.maxRankName +
          '</span></div></div>';
      });
  }
  html += '</div>';
  if (rs.rankFeedback && rs.rankFeedback.length) {
    html +=
      '<div class="history-section"><h4>💬 最近反馈（显示最近 ' + Math.min(8, rs.rankFeedback.length) + ' 条）</h4>';
    rs.rankFeedback.slice(0, 8).forEach(f => {
      html +=
        '<div style="padding:var(--sp-2) 0;font-size:var(--fs-title);color:var(--text-light);border-bottom:1px solid #eee;">' +
        f.msg +
        ' <span style="font-size:var(--fs-title);">' +
        f.time +
        '</span></div>';
    });
    if (rs.rankFeedback.length > 8)
      html +=
        '<div style="font-size:var(--fs-note);color:var(--text-light);padding:var(--sp-6) 0 var(--sp-2);line-height:1.5;">其余 ' +
        (rs.rankFeedback.length - 8) +
        ' 条更早反馈已收起；反馈数据滚动保留最近 12 条，无需手动清理。</div>';
    html += '</div>';
  }
  html +=
    '<div style="text-align:center;font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-10);line-height:1.5;">每3月为一个赛季 · 赛季结束段位回退<br>每日任务根据近期表现动态生成 · 最多每日升6星<br>当日>10番茄获保星机会(最多存1次)</div>';
  body.innerHTML = html;
  showModal('historyModal');
}
/* 时间戳 → HH:MM */
function formatClockTime(ts) {
  if (!ts) return '';
  return fmtTime(new Date(ts));
}
/* 把星数还原成段位展示：{icon,name,stars,color,html}；星数未知返回 null */
function formatPartnerRank(stars) {
  if (stars === null || stars === undefined || isNaN(stars)) return null;
  stars = parseInt(stars, 10);
  let tier = getRankFromStars(stars);
  let sub = getSubRankIndex(stars, tier);
  let name = tier.name + (sub >= 0 ? ' ' + SUB_RANKS[sub] : '');
  return {
    icon: tier.icon,
    name: name,
    stars: stars,
    color: tier.color,
    html:
      '<span style="font-weight:800;color:' + tier.color + ';">' + tier.icon + ' ' + name + ' · ' + stars + ' ⭐</span>'
  };
}
