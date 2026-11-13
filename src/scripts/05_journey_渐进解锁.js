/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 渐进解锁：包装 8 个推进函数做闸口，整段可回退。
 * 红线：新增玩法要登记 STEPS + 闸口 + UI 锁；勿把旅程状态写进 appData 之外。
 * （旅程状态只存 appData.journey，原独立键 tomato_journey_v1 已删。） */
/* ════════════════════════════════════════════════════════════════════
    08-journey.js —— 成长之旅·渐进解锁
   ────────────────────────────────────────────────────────────────────
   机制：
   ① 新用户（无任何记录）首次启动自动开启旅程；有数据的用户默认关闭、全放行。
   ② 玩法按累计有效🍅逐步解锁：1 树 / 3 段位 / 5 金币 / 7 成就 / 10 沉浸。
   ③ "冻结 = 从解锁那一刻才开始"：对树/段位/金币等"当场推进型"结算，
      在本模块里包装其推进函数做闸口——未解锁一律不推进、不积累。
   ④ 每跨一档弹一张解锁介绍卡（跨多档只弹最高档，其余挂 pending 供后续 NEW 标记）。
   ⑤ 计时页下方一条「下一解锁」提示条，专注中自动隐藏，全部解锁后消失。
   卸载：整段移除本 <script> 即可 100% 回退原版（所有包装随之失效）。
 * 函数索引（TOC）：hasApp/totalPomos/demoSig/persist/ensureJourney/journey/enabled/unlocked/coinLocked/freshlyUnlocked/allDone/nextStep（+45 更多）
   ════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.__journeyInjected) return;
  window.__journeyInjected = true;

  /* ---- 解锁表（要调节奏只改这里 at 数字） ---- */
  let STEPS = [
    { id: 'tree', at: 1, emoji: '🌳', name: '番茄树', intro: '🍅 会成为树的养分——亲手种下你的第 1 棵树吧' },
    { id: 'rank', at: 3, emoji: '🏆', name: '段位·战标', intro: '完成任务升段位，跟 8 个 BOT 抢榜首' },
    { id: 'coin', at: 5, emoji: '🪙', name: '金币经济', intro: '专注换金币：商店、扭蛋、每日任务都开了' },
    { id: 'achieve', at: 7, emoji: '🏅', name: '成就·传记', intro: '你的旅程开始被铭记' },
    { id: 'immerse', at: 10, emoji: '🎮', name: '沉浸冒险', intro: '抽一张角色卡，番茄变成一场冒险' }
  ];
  let STEP_MAP = {};
  STEPS.forEach(function (s) {
    STEP_MAP[s.id] = s;
  });

  /* ---- 基础工具 ---- */
  function hasApp() {
    try {
      return typeof appData !== 'undefined' && !!appData && !!appData.settings;
    } catch (e) {
      return false;
    }
  }
  function totalPomos() {
/* 旅程进度 = 旅程起点(startTs)之后完成的🍅；老玩家开启旅程后从 0 重新解锁。
   旧存档无 startTs 时回退为终身累计（兼容）。关闭旅程时该值不参与任何判定。 */
    try {
      if (!journey() || !journey().enabled) return 0;
      let since = journey().startTs || 0;
      let recs = appData.records || [];
      let s = 0;
      for (let i = 0; i < recs.length; i++) {
        let r = recs[i];
        if (r && !isLogRecord(r) && (r.type === 'full' || r.type === 'half') && r.startTime >= since) s += getPomos(r);
      }
      return s;
    } catch (e) {
      return 0;
    }
  }
  /* 演示/预览：URL 带 ?jy=1 强制走旅程；?jy=0 强制关闭（便于作者自测，不影响正常用户） */
  function demoSig() {
    try {
      return /[?&]jy=1([&#]|$)/.test(location.search) ? 1 : /[?&]jy=0([&#]|$)/.test(location.search) ? 0 : -1;
    } catch (e) {
      return -1;
    }
  }
  /* ===== 旅程状态只存 appData.journey（主存储单真相），
   * 原 JKEY(tomato_journey_v1) 双写镜像已删除——persist 只走 saveDataNow；
   * 极端老档（主存储无 journey 仅剩旧键）由 01b migrateLegacyUiPrefs() 一次性兜底搬迁。 */
  function persist() {
    try {
      saveDataNow();
    } catch (e) { if (window.__silent) window.__silent(e, '05:persist'); }
  }
  function ensureJourney() {
    if (!hasApp()) return false;
    if (!appData.journey) {
      let dm = demoSig();
      let brandNew = dm === 1 ? true : dm === 0 ? false : !((appData.records || []).length > 0);
      appData.journey = {
        enabled: brandNew,
        seen: [],
        pending: [],
        achieveSince: null,
        startTs: brandNew ? Date.now() : null,
        legacy: !brandNew
      };
    }
    /* 已存在（含从独立存储恢复）时不再强制覆盖 enabled：用户手动关闭后保持关闭（jy= 仅在无存档时生效） */
    return true;
  }
  function journey() {
    return appData.journey;
  }
  function enabled() {
    return journey().enabled;
  }
  function unlocked(id) {
    if (!journey() || !journey().enabled) return true; /* 旅程关闭 = 全解锁 */
    let s = STEP_MAP[id];
    if (!s) return true; /* 未纳入旅程的新玩法默认可用 */
    /* 已在使用的功能不锁：immersive 开启过的玩家继续可用 */
    if (id === 'immerse') {
      let _used = false;
      try {
        _used =
          !!(appData && appData.settings && appData.settings.immersiveFocus) ||
          !!(
            appData &&
            appData.immersiveFocus &&
            appData.immersiveFocus.events &&
            appData.immersiveFocus.events.length > 0
          );
      } catch (e) { if (window.__silent) window.__silent(e, '05:unlocked'); }
      if (_used) return true;
      try {
        let _ex = journey().extraUnlocked || [];
        if (_ex.indexOf('immerse') >= 0) return true;
      } catch (e) { if (window.__silent) window.__silent(e, '05:unlocked'); }
    }
    return totalPomos() >= s.at;
  }
  function coinLocked() {
    return !!(journey() && journey().enabled && !unlocked('coin'));
  }
  /* 已跨过但尚未介绍过的档（本次新解锁） */
  function freshlyUnlocked() {
    if (!journey() || !journey().enabled) return [];
    let t = totalPomos(),
      out = [];
    STEPS.forEach(function (s) {
      if (t >= s.at && journey().seen.indexOf(s.id) < 0) out.push(s);
    });
    return out;
  }
  function allDone() {
    if (!journey() || !journey().enabled) return true;
    let t = totalPomos();
    return STEPS.every(function (s) {
      return t >= s.at;
    });
  }
  function nextStep() {
    if (!journey() || !journey().enabled) return null;
    let t = totalPomos();
    for (let i = 0; i < STEPS.length; i++) if (t < STEPS[i].at) return STEPS[i];
    return null;
  }

  /* ============ ① 结算后：跨档检测 + 解锁介绍卡 ============ */
  function afterSettle() {
    try {
      if (!ensureJourney()) return;
      if (!journey().enabled) return;
      let fresh = freshlyUnlocked();
      if (!fresh.length) return;
      /* 跨多档：只弹最高档（at 最大），其余进入 pending（供统计页 NEW，M3 接入） */
      fresh.sort(function (a, b) {
        return a.at - b.at;
      });
      let top = fresh[fresh.length - 1];
      let others = fresh.slice(0, fresh.length - 1);
      fresh.forEach(function (s) {
        journey().seen.push(s.id);
      });
      ensureAchOnUnlock(
        fresh.map(function (s) {
          return s.id;
        })
      );
      syncBodyFlags();
      others.forEach(function (s) {
        if (journey().pending.indexOf(s.id) < 0) journey().pending.push(s.id);
      });
      persist();
      if (allDone()) hideBar();
      setTimeout(function () {
        try {
          showCard(top);
        } catch (e) { if (window.__silent) window.__silent(e, '05:afterSettle'); }
      }, 1200);
    } catch (e) { if (window.__silent) window.__silent(e, '05:afterSettle'); }
  }
  function showCard(step) {
    let ov = document.getElementById('jyCard');
    if (!ov) return;
    document.getElementById('jyCardEmoji').textContent = step.emoji;
    document.getElementById('jyCardName').textContent = step.name;
    document.getElementById('jyCardIntro').textContent = step.intro;
    ov.classList.add('jy-open');
  }
  function closeCard(go) {
    let ov = document.getElementById('jyCard');
    if (ov) {
      ov.classList.remove('jy-open');
      ov.removeAttribute('data-from-tab'); /* 关闭即清来源标记 */
    }
    if (go) {
      try {
        switchView('stats');
      } catch (e) { if (window.__silent) window.__silent(e, '05:closeCard'); }
    }
  }
  function gotoStatsTab(stepId) {
    try {
      switchView('stats');
      let map = { tree: 'tree', rank: 'rank', coin: 'tree', achieve: 'ach', immerse: 'rank' };
      let tab = map[stepId];
      /* 尽力切到对应二级 tab；无则停在统计页 */
      let btn = document.querySelector('#statsSubNav .stats-nav-item[data-tab="' + tab + '"]');
      if (btn && typeof btn.click === 'function') btn.click();
    } catch (e) { if (window.__silent) window.__silent(e, '05:gotoStatsTab'); }
  }

  /* ============ ② 数据推进闸口（冻结核心） ============ */
  function gateSingle(name, stepId) {
    let o = window[name];
    if (typeof o !== 'function') return;
    window[name] = function () {
      if (!unlocked(stepId)) {
        if (name === 'addTreePoints') return 0; /* 保持调用方数值语义 */
        return;
      }
      return o.apply(this, arguments);
    };
  }
  /* 已核实的结算推进函数 → 对应解锁档 */
  gateSingle('addTreePoints', 'tree');
  gateSingle('onPomodoroCompleteRank', 'rank');
  gateSingle('addLotteryChance', 'coin');
  gateSingle('checkGachaTrigger', 'coin');
  gateSingle('checkTreeDailyTasks', 'coin');
  gateSingle('checkNewAchievements', 'achieve');
  gateSingle('checkBiographyEvents', 'achieve');
  gateSingle('immersiveOnTomatoSettled', 'immerse');

  /* 计时页段位相关 UI：解锁前不渲染（战标徽章 / 段位条） */
  (function () {
    let ob = window.renderTimerBadge;
    if (typeof ob === 'function')
      window.renderTimerBadge = function () {
        let r = ob.apply(this, arguments);
        try {
          if (!unlocked('rank')) {
            let el = document.getElementById('timerBadge');
            if (el) {
              el.classList.remove('show');
              el.innerHTML = '';
            }
          }
        } catch (e) { if (window.__silent) window.__silent(e, '05:gateSingle'); }
        return r;
      };
    let os = window.renderTimerRankStrip;
    if (typeof os === 'function')
      window.renderTimerRankStrip = function () {
        let r = os.apply(this, arguments);
        try {
          let box = document.getElementById('timerRankStrip');
          if (box) box.style.display = unlocked('rank') ? '' : 'none';
        } catch (e) { if (window.__silent) window.__silent(e, '05:gateSingle'); }
        return r;
      };
  })();

  /* ============ ③ 结算中枢包装：结算后检查跨档 ============ */
  let _origSpr = window.savePomodoroRecord;
  if (typeof _origSpr === 'function') {
    __replace_savePomodoroRecord(function () {
      let _bc = typeof appData !== 'undefined' && appData && appData.tree ? appData.tree.coins || 0 : 0;
      let r = _origSpr.apply(this, arguments);
      try {
        if (coinLocked() && appData && appData.tree && (appData.tree.coins || 0) > _bc) {
          /* 金币玩法未解锁：本期结算产生的金币不入账（树成长/段位等照常）。
             ★ 余额回滚的同时必须补一条反向流水 —— 否则账本里会留着这几笔「已发放」的
             假记录，而余额已被退回：Σ流水 ≠ 余额，账目对不上（对账会永远报差额）。 */
          const _bk = appData.tree.coins;
          appData.tree.coins = _bc; /* coin-write-allow: 未解锁门禁回滚（配反向流水，见下） */
          coinLedgerPush(coinTxMake({
            type: 'migrate', amount: _bc - _bk, after: _bc,
            reason: '金币玩法未解锁：本期结算金币不计入'
          }));
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:gateSingle'); }
      try {
        setTimeout(afterSettle, 100);
      } catch (e) { if (window.__silent) window.__silent(e, '05:gateSingle'); }
      return r;
    });
  }
  /* 金币锁期：礼物(金币)与必做3件事领取拦截 */
  let _ogf = window.showGift;
  if (typeof _ogf === 'function') {
    window.showGift = function () {
      try {
        if (coinLocked()) {
          return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:gateSingle'); }
      return _ogf.apply(this, arguments);
    };
  }
  let _ocm = window.claimMustDoReward;
  if (typeof _ocm === 'function') {
    __replace_claimMustDoReward(function () {
      try {
        if (coinLocked()) {
          showToast('🔒 金币玩法需完成 5 个🍅后解锁', true);
          return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:gateSingle'); }
      return _ocm.apply(this, arguments);
    });
  }

  /* ============ ④ 计时页「下一解锁」提示条 ============ */
  function hideBar() {
    let b = document.getElementById('jyBar');
    if (b) b.style.display = 'none';
  }
  function pollUnlockCards() {
    /* 兜底：补记/导入等不走结算中枢的番茄，靠每秒轮询补弹解锁介绍卡（空闲时才弹，不打断专注） */
    try {
      if (!journey() || !journey().enabled || allDone()) return;
      if (window.timerState && timerState.mode === 'focus' && timerState.running) return;
      let fresh = freshlyUnlocked();
      if (!fresh.length) return;
      fresh.sort(function (a, b) {
        return a.at - b.at;
      });
      let top = fresh[fresh.length - 1],
        others = fresh.slice(0, fresh.length - 1);
      fresh.forEach(function (s) {
        if (journey().seen.indexOf(s.id) < 0) journey().seen.push(s.id);
      });
      others.forEach(function (s) {
        if (journey().pending.indexOf(s.id) < 0) journey().pending.push(s.id);
      });
      persist();
      syncBodyFlags();
      setTimeout(function () {
        try {
          showCard(top);
        } catch (e) { if (window.__silent) window.__silent(e, '05:pollUnlockCards'); }
      }, 300);
    } catch (e) { if (window.__silent) window.__silent(e, '05:pollUnlockCards'); }
  }
  function renderBar() {
    try {
      syncBodyFlags();
      if (!ensureJourney() || !journey().enabled || allDone()) {
        hideBar();
        return;
      }
      pollUnlockCards();
      let host = document.getElementById('timerRankStrip');
      if (!host) return;
      let bar = document.getElementById('jyBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'jyBar';
        bar.className = 'jy-bar';
        bar.onclick = function () {
          showRoute();
        };
        host.parentNode.insertBefore(bar, host);
      }
      try {
        refreshLockUI();
      } catch (e) { if (window.__silent) window.__silent(e, '05-renderBar'); }
      let nxt = nextStep();
      if (!nxt) {
        hideBar();
        return;
      }
      let remain = Math.max(1, Math.ceil(nxt.at - totalPomos()));
      bar.innerHTML = '🔒 再完成 <b>' + remain + '</b> 个🍅 → 解锁 ' + nxt.emoji + ' ' + nxt.name;
      bar.style.display = '';
      /* 专注中隐藏（零打扰） */
      try {
        if (window.timerState && timerState.mode === 'focus' && timerState.running) bar.style.display = 'none';
      } catch (e) { if (window.__silent) window.__silent(e, '05:renderBar'); }
    } catch (e) { if (window.__silent) window.__silent(e, '05:renderBar'); }
  }
  function showRoute() {
    /* 展开完整解锁路线（轻量弹层） */
    let ov = document.getElementById('jyRoute');
    if (!ov) return;
    let banner = document.getElementById('jyRouteBanner');
    if (banner) {
      banner.innerHTML = allDone()
        ? '🎉 全部玩法已解锁，去发现你的专属玩法吧'
        : '🍅 完成番茄即可逐个解锁玩法';
    }
    let t = totalPomos();
    let html = '';
    STEPS.forEach(function (s) {
      let done = t >= s.at;
      let st = done
        ? '<span class="jy-r-done">✅ 已解锁</span>'
        : '<span class="jy-r-lock">🔒 还差 ' + Math.max(1, Math.ceil(s.at - t)) + ' 个🍅</span>';
      html +=
        '<div class="jy-r-item' +
        (done ? ' jy-r-on' : '') +
        '"><span class="jy-r-ico">' +
        s.emoji +
        '</span><div class="jy-r-body"><div class="jy-r-name">' +
        s.name +
        '</div><div class="jy-r-sub">' +
        s.intro +
        '</div></div>' +
        st +
        '</div>';
    });
    document.getElementById('jyRouteBody').innerHTML = html;
    ov.classList.add('jy-open');
  }
  function closeRoute() {
    let ov = document.getElementById('jyRoute');
    if (ov) ov.classList.remove('jy-open');
  }

  /* ============ ⑧ 成就「从解锁日开始」：窗口统计 + 静默归档 ============ */
  /* 窗口统计：只聚合 achieveSince 之后的记录（复刻成就所需派生量的算法，不碰主统计引擎） */
  function _jyWinCache() {
    let since = appData.journey.achieveSince || Date.now();
    let recs = (appData.records || []).filter(function (r) {
      return r && r.startTime && r.startTime >= since;
    });
    let byDate = {},
      zero = { full: 0, int: 0 };
    recs.forEach(function (r) {
      let ds = getDateStr(r.startTime);
      let h = new Date(r.startTime).getHours();
      if (!byDate[ds]) byDate[ds] = { full: 0, half: 0, int: 0, early: 0, night: 0 };
      let b = byDate[ds];
      if (r.type === 'full') b.full++;
      else if (r.type === 'half') b.half++;
      if (h >= 6 && h < 9) b.early++;
      if (h >= 0 && h < 6) b.night++;
      if (r.interruptions && r.interruptions.length) b.int += r.interruptions.length;
    });
    let dateKeys = Object.keys(byDate).sort();
    let totalFull = 0;
    dateKeys.forEach(function (ds) {
      totalFull += byDate[ds].full;
    });
    /* 连续天数：今天还没产生记录时，游标从**昨天**起算。
       否则上午打开 App 会看到「连续 0 天」，哪怕昨天已经连续 30 天 —— 玩家每天
       看到的第一个数字是错的，要等当天出了记录才跳回真值。
       口径与 00_pure_core 的 habitCurrentStreak 对齐（两处必须同义）。 */
    let streak = 0;
    let dt = new Date();
    const _todayKey = getDateStr(dt);
    if (!(byDate[_todayKey] && byDate[_todayKey].full > 0)) dt.setDate(dt.getDate() - 1);
    while (true) {
      let ds = getDateStr(dt);
      if (byDate[ds] && byDate[ds].full > 0) {
        streak++;
        dt.setDate(dt.getDate() - 1);
      } else break;
    }
    let longestRun = function (pred) {
      let best = 0,
        cur = 0,
        prev = null;
      dateKeys.forEach(function (ds) {
        let d0 = new Date(ds + 'T00:00:00');
        let diff = prev ? Math.round((d0 - new Date(prev + 'T00:00:00')) / DAY_MS) : 1;
        if (diff !== 1) cur = 0;
        if (pred(byDate[ds])) {
          cur++;
          if (cur > best) best = cur;
        } else cur = 0;
        prev = ds;
      });
      return best;
    };
    let earlyStreak = longestRun(function (x) {
      return x.early > 0;
    });
    let nightStreak = longestRun(function (x) {
      return x.night > 0;
    });
    let nobreakDays = dateKeys.filter(function (ds) {
      return byDate[ds].full >= 3 && byDate[ds].int === 0;
    }).length;
    let maxDayFull = dateKeys.reduce(function (m, ds) {
      return Math.max(m, byDate[ds].full);
    }, 0);
    let monthFull = (function () {
      let ym = {};
      dateKeys.forEach(function (ds) {
        let k = ds.slice(0, 7);
        ym[k] = (ym[k] || 0) + 1;
      });
      for (let k in ym) {
        if (ym[k] >= new Date(parseInt(k.slice(0, 4)), parseInt(k.slice(5, 7)), 0).getDate()) return true;
      }
      return false;
    })();
    let perfectWeekCount = (function () {
      if (dateKeys.length < 7) return 0;
      let win = {},
        cnt = 0;
      for (let i = 0; i < dateKeys.length; i++) {
        let ds = dateKeys[i];
        win[ds] = byDate[ds];
        let ks = Object.keys(win).sort();
        while (ks.length && (new Date(ks[0] + 'T00:00:00') - new Date(ds + 'T00:00:00')) / DAY_MS > 6)
          delete win[ks.shift()];
        if (ks.length === 7) {
          let ok = true;
          for (let j = 0; j < 7; j++) {
            let dy = win[ks[j]];
            if (!dy || dy.full < 4 || dy.int > 0) {
              ok = false;
              break;
            }
          }
          if (ok) {
            cnt++;
            delete win[ks[0]];
          }
        }
      }
      return cnt;
    })();
    return {
      key: 'jywin' + since,
      byDate: byDate,
      dateKeys: dateKeys,
      totalFull: totalFull,
      activeDays: dateKeys.length,
      streak: streak,
      earlyStreak: earlyStreak,
      nightStreak: nightStreak,
      nobreakDays: nobreakDays,
      maxDayFull: maxDayFull,
      monthFull: monthFull,
      perfectWeekCount: perfectWeekCount
    };
  }
  /* 解锁成就档瞬间：记起点 + 把「历史已满足但窗口下不满足」的成就静默归档（不通知/不发奖/不写传记） */
  function ensureAchieveStart() {
    let j = journey();
    if (!j || !j.enabled) return false;
    if (!unlocked('achieve')) return false;
    if (j.achieveSince) return true;
    j.achieveSince = Date.now();
    try {
      let all = getAchievements();
      let winIds = achieveIdsUnderWindow();
      if (appData.unlockedAchievements)
        all.forEach(function (a) {
          if (a.unlocked && winIds.indexOf(a.id) < 0 && appData.unlockedAchievements.indexOf(a.id) < 0)
            appData.unlockedAchievements.push(a.id);
        });
    } catch (e) { if (window.__silent) window.__silent(e, '05:ensureAchieveStart'); }
    persist();
    return true;
  }
  function achieveIdsUnderWindow() {
    let oc = getStatsCache;
    __replaceGetStatsCache(function () {
      return _jyWinCache();
    });
    try {
      return getAchievements()
        .filter(function (a) {
          return a.unlocked;
        })
        .map(function (a) {
          return a.id;
        });
    } catch (e) {
      return [];
    } finally {
      __replaceGetStatsCache(oc);
    }
  }
  /* checkNewAchievements 包装：旅程用户 = 一律用窗口统计（历史不参与），老用户 = 原逻辑 */
  let _oca = window.checkNewAchievements;
  if (typeof _oca === 'function') {
    __replace_checkNewAchievements(function () {
      try {
        if (
          typeof appData !== 'undefined' &&
          appData &&
          appData.journey &&
          appData.journey.enabled &&
          unlocked('achieve') &&
          appData.journey.achieveSince
        ) {
          let oc = getStatsCache;
          __replaceGetStatsCache(function () {
            return _jyWinCache();
          });
          try {
            return _oca.apply(this, arguments);
          } finally {
            __replaceGetStatsCache(oc);
          }
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:achieveIdsUnderWindow'); }
      return _oca.apply(this, arguments);
    });
  }
  /* 解锁档跨过时若含成就 → 立即初始化窗口起点（须在结算链 500ms 的 check 之前完成） */
  function ensureAchOnUnlock(freshIds) {
    if (freshIds.indexOf('achieve') >= 0) {
      try {
        ensureAchieveStart();
      } catch (e) { if (window.__silent) window.__silent(e, '05:ensureAchOnUnlock'); }
    }
  }

  /* ============ ⑨ 统计页锁卡 / NEW / 首种树提示 / 设置锁定 ============ */
  let TAB_STEP_MAP = { tree: 'tree', rank: 'rank', ach: 'achieve' };
  function refreshLockUI() {
    try {
      /* 清掉「悬空 NEW」——有效记录被删除/归档后 totalPomos 可能回落到某档门槛
         之下，该档重新变成锁定态，但它的 id 还留在 pending 里。此时点 tab 只会弹
         「尚未解锁」卡并提前 return，pending 永远清不掉 → NEW 常驻。这里把「已锁定却
         还挂着 NEW」的档直接移出 pending。 */
      try {
        let _j = journey();
        if (_j && Array.isArray(_j.pending) && _j.pending.length) {
          let pd = _j.pending;
          let kept = pd.filter(function (id) {
            return !_j.enabled || unlocked(id);
          });
          if (kept.length !== pd.length) {
            _j.pending = kept;
            persist();
          }
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:refreshLockUI:prune'); }
      let nav = document.querySelectorAll('#statsSubNav .stats-nav-item');
      if (!nav.length) return;
      nav.forEach(function (n) {
        let tab = n.getAttribute('data-tab');
        let sid = TAB_STEP_MAP[tab];
        if (!sid) return;
        n.style.display = '';
        let lock = !!(journey().enabled && !unlocked(sid));
        if (lock && n.getAttribute('data-jylock') !== '1') {
          n.setAttribute('data-jylock', '1');
          /* 锁标记做成右上角小角标，**不占字宽**。
             以前是 afterbegin 塞一个 🔒 前缀，Tab 改成等分宽度后，
             「🔒🌳 种树」这种两项 emoji 的会挤成省略号，用户看到的是「🔒🌳 ...」。 */
          n.insertAdjacentHTML('beforeend', '<span class="stats-nav-lock">🔒</span>');
        }
        if (!lock && n.getAttribute('data-jylock') === '1') {
          n.removeAttribute('data-jylock');
          let ic = n.querySelector('.stats-nav-lock');
          if (ic) ic.remove();
        }
        /* **不再渲染 NEW 角标**。
           原设计是「解锁了但还没看过」的提醒，靠 journey().pending 驱动；实测它是
           纯噪音——用户已经知道有这个 tab，角标只会让人以为是没读完的消息。
           pending 字段保留不动：它现在还负责「第一次点开该档 tab 时弹一次玩法介绍卡」
           （见 switchStatsSubTab 包装），删掉会丢功能。 */
      });
      /* 各档位 body 锁标记（供 CSS 隐藏未解锁玩法在首页/树页的入口） */
      ['tree', 'rank', 'coin', 'achieve', 'immerse'].forEach(function (sid) {
        let _lock = !!(journey().enabled && !unlocked(sid));
        document.body.classList.toggle('jy-lock-' + sid, _lock);
      });
      /* 沉浸相关设置组：真正禁用（置灰不可点），解锁后恢复 */
      let ig = document.querySelector('.settings-group[data-group="immersive"]');
      if (ig) {
        let immLock = !!(journey().enabled && !unlocked('immerse'));
        if (immLock) {
          ig.setAttribute('data-jylock', '1');
          ig.style.opacity = '.8';
        } else if (ig.getAttribute('data-jylock') === '1') {
          ig.removeAttribute('data-jylock');
          ig.style.opacity = '';
        }
        /* 注：不再禁用控件——玩家主动打开沉浸开关即自动解锁该档（见下方监听） */
        let hd = ig.querySelector('.group-header');
        if (hd) {
          if (immLock && ig.getAttribute('data-lockmark') !== '1') {
            ig.setAttribute('data-lockmark', '1');
            hd.innerHTML = '🔒' + hd.innerHTML;
          } else if (!immLock && ig.getAttribute('data-lockmark') === '1') {
            ig.removeAttribute('data-lockmark');
            hd.innerHTML = hd.innerHTML.replace(/^🔒/, '');
          }
        }
      }
    } catch (e) { if (window.__silent) window.__silent(e, '05:refreshLockUI'); }
  }
  function showLockCard(tab) {
    let sid = TAB_STEP_MAP[tab] || tab;
    let step = STEP_MAP[sid];
    if (!step) return;
    let remain = Math.max(1, Math.ceil(step.at - totalPomos()));
    let ov = document.getElementById('jyLock');
    if (!ov) return;
    document.getElementById('jyLockEmoji').textContent = step.emoji;
    document.getElementById('jyLockName').textContent = step.name;
    document.getElementById('jyLockIntro').innerHTML =
      (escapeHtml(step.intro)) +
      '<br>再完成 <b>' + remain + '</b> 个🍅 就能解锁';
    ov.classList.add('jy-open');
  }
  function closeLock() {
    let ov = document.getElementById('jyLock');
    if (ov) ov.classList.remove('jy-open');
  }
  function unlockImmersiveOnOpen() {
    try {
      if (!journey() || !journey().enabled) return;
      if (unlocked('immerse')) return;
      if (!journey().extraUnlocked) journey().extraUnlocked = [];
      if (journey().extraUnlocked.indexOf('immerse') < 0) journey().extraUnlocked.push('immerse');
      persist();
      afterToggleRefresh();
      try {
        showToast('🎮 已解锁「沉浸式专注」：开启即视为开始体验，旅程不再锁定', true);
      } catch (e) { if (window.__silent) window.__silent(e, '05:unlockImmersiveOnOpen'); }
    } catch (e) { if (window.__silent) window.__silent(e, '05:unlockImmersiveOnOpen'); }
  }
  function bindImmersiveOpenUnlock() {
    try {
      let im = document.getElementById('setImmersive');
      if (!im || im.getAttribute('data-jyopen')) return;
      im.setAttribute('data-jyopen', '1');
      im.addEventListener('change', function () {
        try {
          if (this && this.checked) unlockImmersiveOnOpen();
        } catch (e) { if (window.__silent) window.__silent(e, '05:bindImmersiveOpenUnlock'); }
      });
    } catch (e) { if (window.__silent) window.__silent(e, '05:bindImmersiveOpenUnlock'); }
  }
  function hintTreeOnce() {
    let j = journey();
    if (!j || !j.enabled) return;
    if (!unlocked('tree') || j.treeHintDone) return;
    j.treeHintDone = true;
    persist();
    try {
      showToast('🌱 点右下角的 🌱 按钮，亲手种下你的第 1 棵树', true);
    } catch (e) { if (window.__silent) window.__silent(e, '05-hintTreeOnce'); }
  }
  /* 包装 switchStatsSubTab：锁 / NEW 介绍 / 首种树提示 */
  let _ost = window.switchStatsSubTab;
  if (typeof _ost === 'function') {
    window.switchStatsSubTab = function (tab) {
      try {
        if (typeof appData !== 'undefined' && appData && appData.journey && appData.journey.enabled) {
          let sid = TAB_STEP_MAP[tab];
          if (sid && !unlocked(sid)) {
            showLockCard(tab);
            return;
          }
          if (tab === 'tree') hintTreeOnce();
          _ost.apply(this, arguments);
          if (tab === 'data' || !tab) {
            try {
              setTimeout(reapFoldByIds, 150);
            } catch (e) { if (window.__silent) window.__silent(e, '05:hintTreeOnce'); }
            try {
              setTimeout(reapFoldByIds, 600);
            } catch (e) { if (window.__silent) window.__silent(e, '05:hintTreeOnce'); }
          }
          if (sid && (journey().pending || []).indexOf(sid) >= 0) {
            let idx = journey().pending.indexOf(sid);
            if (idx >= 0) journey().pending.splice(idx, 1);
            persist();
            refreshLockUI();
            let step = STEP_MAP[sid];
            if (step)
              setTimeout(function () {
                /* 由 tab 主动点开＝用户已经看到这张卡，打上来源标记。
                   否则卡上「稍后再说」会把该档重新挂回 pending，
                   于是点 tab 清 NEW → 弹卡 → 稍后再说 → NEW 又回来，无限循环。 */
                let _c = document.getElementById('jyCard');
                if (_c) _c.dataset.fromTab = '1';
                showCard(step);
              }, 350);
          }
          return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:hintTreeOnce'); }
      _ost.apply(this, arguments);
    };
  }
  /* ============ ⑫ 统计页精简：本周VS上周起收进「查看全部」懒加载折叠 ============ */

/* 分享海报卡单独常驻：它原嵌在「身心状态趋势(moodBox)」块底部，会随折叠一起进"查看更多"。
   把整张卡片（标题文案+按钮）搬到统计页底部、段数块之后。幂等：只执行一次。 */
  function splitPosterCard() {
    try {
      if (document.body.getAttribute('data-jyposter')) return;
      let host = document.getElementById('statsDataView');
      let fr = document.getElementById('focusRankWrap');
      if (!host || !fr) return;
      let found = null;
      let all = host.querySelectorAll('button');
      for (let i = 0; i < all.length; i++) {
        let oc = all[i].getAttribute && (all[i].getAttribute('onclick') || '');
        if (oc.indexOf('openSharePoster') >= 0) {
          found = all[i];
          break;
        }
      }
      if (!found) return;
      let card = found;
      /* 向上爬到「带 id 的容器」(moodBox) 为止——停在最外层的无 id 卡片容器 */
      while (card.parentNode && card.parentNode !== host) {
        let np = card.parentNode;
        if (np === host) break;
        if (np.id && np.id !== '') break;
        card = np;
      }
      let par = card.parentNode;
      if (par === host) {
        if (fr.parentNode === host) host.insertBefore(card, fr.nextSibling);
        else host.appendChild(card);
        document.body.setAttribute('data-jyposter', '1');
        return;
      }
      if (par) {
        try {
          par.removeChild(card);
        } catch (e) { if (window.__silent) window.__silent(e, '05:splitPosterCard'); }
      }
      if (fr.parentNode === host) host.insertBefore(card, fr.nextSibling);
      else host.appendChild(card);
      document.body.setAttribute('data-jyposter', '1');
    } catch (e) {
      try {
        console.warn('splitPosterCard', e);
      } catch (_e) { if (window.__silent) window.__silent(_e, '05:splitPosterCard'); }
    }
  }
  function injectStatsFold() {
    try {
      if (!document.getElementById('jyMoreCss')) {
        let cs = document.createElement('style');
        cs.id = 'jyMoreCss';
        cs.textContent =
          '.jy-more-btn{margin:var(--sp-14) 0 var(--sp-10);padding:var(--sp-10) var(--sp-12);text-align:center;font-size:var(--fs-body);font-weight:700;color:var(--text-light);background:var(--card);border:1px solid var(--hairline);border-radius:var(--radius);cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;}.jy-more-btn:active{transform:scale(.99);}.jy-more-arrow{font-size:var(--fs-caption);margin-left:var(--sp-6);color:var(--text-light);}.jy-more-body{margin-bottom:var(--sp-6);}';
        document.head.appendChild(cs);
      }
      let host = document.getElementById('statsDataView');
      if (!host || document.getElementById('jyMoreWrap')) return;
      let wk = document.getElementById('weekCompareBox');
      if (!wk) return;
      let kids = Array.prototype.slice.call(host.children);
      let startIdx = -1;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i] === wk || kids[i].id === 'weekCompareBox') {
          startIdx = i;
          break;
        }
      }
      if (startIdx < 0) return;
      /* 折叠区=本周VS上周起全部图表；段数块 focusRankWrap 与「生成分享海报」卡留在外面作页尾（海报在段数下边） */
      let holder = document.createElement('div');
      holder.style.display = 'none';
      let tail = [];
      for (let j = startIdx; j < kids.length; j++) {
        let el = kids[j];
        if (el && el.id === 'focusRankWrap') {
          tail.push(el);
          continue;
        }
        if (el && el.id === 'jyMoreWrap') continue;
        if (el && el.querySelector && el.querySelector('button[onclick*="openSharePoster"]')) {
          tail.push(el);
          continue;
        }
        holder.appendChild(el);
      }
      document.body.appendChild(holder);
      let sec = document.createElement('div');
      sec.id = 'jyMoreWrap';
      sec.className = 'jy-more-wrap';
      let btn = document.createElement('div');
      btn.className = 'jy-more-btn';
      btn.onclick = function () {
        jyToggleMore();
      };
      btn.innerHTML = '📊 查看更多数据分析 <span class="jy-more-arrow">▼ 点此展开</span>';
      sec.appendChild(btn);
      let body = document.createElement('div');
      body.id = 'jyMoreBody';
      body.className = 'jy-more-body';
      body.style.display = 'none';
      sec.appendChild(body);
      window.__jyMore = { holder: holder, body: body, arrow: btn.querySelector('.jy-more-arrow'), opened: false };
      host.appendChild(sec);
      tail.forEach(function (el) {
        host.appendChild(el);
      });
      let _fr = document.getElementById('focusRankWrap');
      if (_fr && !host.contains(_fr)) {
        try {
          let _p = _fr.parentNode;
          if (_p) _p.removeChild(_fr);
        } catch (e) { if (window.__silent) window.__silent(e, '05-injectStatsFold'); }
        try {
          host.appendChild(_fr);
        } catch (e) { if (window.__silent) window.__silent(e, '05:injectStatsFold'); }
      }
      if (_fr) host.appendChild(_fr);
    } catch (e) { if (window.__silent) window.__silent(e, '05:injectStatsFold'); }
  }
  function jyToggleMore() {
    try {
      let M = window.__jyMore;
      if (!M) return;
      if (!M.opened) {
        while (M.holder.firstChild) M.body.appendChild(M.holder.firstChild);
        M.body.style.display = 'block';
        M.arrow.textContent = '▲';
        M.opened = true;
        setTimeout(function () {
          try {
            renderStats();
          } catch (e) { if (window.__silent) window.__silent(e, '05-jyToggleMore'); }
        }, 80);
        setTimeout(function () {
          try {
            centerYearHeat();
          } catch (e) { if (window.__silent) window.__silent(e, '05:jyToggleMore'); }
        }, 260);
      } else {
        while (M.body.firstChild) M.holder.appendChild(M.body.firstChild);
        M.body.style.display = 'none';
        M.arrow.textContent = '▼';
        M.opened = false;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '05:jyToggleMore'); }
  }
  /* 白名单收纳：统计页“分析图表”的明确 id 集合。无论这些块何时出现在数据区
     （含 renderStats 后续放回的情况），进入统计页数据视图后统一收进折叠区；段数与海报不在名单，永不移。 */
  let FOLD_IDS = [
    'weekCompareBox',
    'statsTrend',
    'enhHourlyBox',
    'enhHeat52Box',
    'yearHeatmapBox',
    'heatmapBox',
    'moodBox',
    'qualityBox',
    'durBox',
    'week8Box',
    'interruptWrap',
    'rankTrendWrap',
    'monthlyStatWrap',
    'yearlyStatWrap'
  ];
  function reapFoldByIds() {
    try {
      let M = window.__jyMore,
        host = document.getElementById('statsDataView');
      if (!M || !host) return;
      for (let i = 0; i < FOLD_IDS.length; i++) {
        let el = document.getElementById(FOLD_IDS[i]);
        if (el && el.parentNode === host) M.holder.appendChild(el); /* 只收数据区的直接子；已在折叠/隐藏容器的不动 */
      }
      /* 保持段数→海报的页尾顺序 */
      let fr = document.getElementById('focusRankWrap');
      if (fr && fr.parentNode === host) host.appendChild(fr);
      let bts = host.querySelectorAll('button[onclick*="openSharePoster"]');
      for (let q = 0; q < bts.length; q++) {
        let c = bts[q];
        while (c && c.parentNode && c.parentNode !== host) c = c.parentNode;
        if (c && c.parentNode === host) {
          host.appendChild(c);
          break;
        }
      }
    } catch (e) { if (window.__silent) window.__silent(e, '05:reapFoldByIds'); }
  }
  /* 折叠后的 Tab 跳转：先自动展开折叠区，再平滑滚动到目标块 */
  let _ojb = window.jumpToBlock;
  if (typeof _ojb === 'function') {
    window.jumpToBlock = function (id) {
      try {
        let el = document.getElementById(id);
        let M = window.__jyMore;
        if (el && M && !M.opened && M.holder && M.holder.contains(el)) {
          jyToggleMore();
          setTimeout(function () {
            try {
              _ojb(id);
            } catch (e) { if (window.__silent) window.__silent(e, '05:reapFoldByIds'); }
          }, 200);
          return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:reapFoldByIds'); }
      return _ojb.apply(this, arguments);
    };
  }
  window.jyToggleMore = jyToggleMore;

  /* ============ ⑪ 主题设置分组：配色色卡 + 蓝调(深色) + 跟随系统 + 极简/进度样式 归入同一组 ============ */
  function injectThemeGroup() {
    try {
      if (document.getElementById('themeGroup')) return;
      let darkRow = document.querySelector('#setDarkMode')
        ? document.getElementById('setDarkMode').closest('.setting-row')
        : null;
      let autoRow = document.querySelector('#enh571AutoDark')
        ? document.getElementById('enh571AutoDark').closest('.setting-row')
        : null;
      let minRow = document.querySelector('#setMinimalMode')
        ? document.getElementById('setMinimalMode').closest('.setting-row')
        : null;
      let prgRow = document.querySelector('#progressStyleSeg')
        ? document.getElementById('progressStyleSeg').closest('.setting-row')
        : null;
      if (!darkRow && !autoRow && !minRow && !prgRow) return;
      let first = document.querySelector('#view-settings .settings-group');
      if (!first) return;
      let g = document.createElement('div');
      g.className = 'settings-group foldable collapsed';
      g.id = 'themeGroup';
      g.setAttribute('data-group', 'theme');
      let hd = document.createElement('h3');
      hd.className = 'group-header';
      hd.innerHTML = '🎨 主题 <span class="group-arrow">▼</span>';
      hd.onclick = function () {
        try {
          toggleGroup('theme');
        } catch (e) { if (window.__silent) window.__silent(e, '05:injectThemeGroup'); }
      };
      g.appendChild(hd);
      let body = document.createElement('div');
      body.className = 'group-body';
      g.appendChild(body);
      if (darkRow) body.appendChild(darkRow);
      if (autoRow) body.appendChild(autoRow);
      if (prgRow) body.appendChild(prgRow);
      if (minRow) {
        if (body.firstChild) body.insertBefore(minRow, body.firstChild);
        else body.appendChild(minRow);
      }
      /* 主题配色的色卡网格：必须待在「🎨 主题」组内。
         该组是本函数运行时动态创建的（template.html 里没有它的静态节点），
         所以色卡不能写在 template.html —— 否则会像之前那样飘在组外。
         放在最前：先选配色主题，再选深色开关，阅读顺序从「外观」到「明暗」更顺。
         注入后再调 themeEngine.renderCards() 重渲一次：模板里的 #themeGrid 容器
         此刻已被本行一并搬进来，若引擎先前已在旧位置渲染过，重渲可保证卡片落在新容器里（幂等）。 */
      let themeRow = document.createElement('div');
      themeRow.id = 'W8ThemeRow';
      themeRow.className = 'setting-row';
      themeRow.style.cssText = 'flex-direction:column; align-items:stretch; gap:0;';
      themeRow.innerHTML =
        '<div class="setting-label" style="flex:none;">配色主题<div class="setting-desc">换一套配色，只改颜色不改布局。与「蓝调模式」互相独立，可任意组合。</div></div>' +
        '<div class="theme-grid" id="themeGrid"></div>';
      if (body.firstChild) body.insertBefore(themeRow, body.firstChild);
      else body.appendChild(themeRow);
      /* 「🔠 字号大小」：整站文字缩放（标准/大字/特大/老年）。
         放在主题组内、配色主题之后 —— 同属"外观"心智。
         选项由 FONT_SCALE_STEPS 渲染（纯层单一事实源），这里不写死档位数字。 */
      let fontRow = document.createElement('div');
      fontRow.id = 'W8FontRow';
      fontRow.className = 'setting-row';
      let fopts = '';
      try {
        let steps = typeof FONT_SCALE_STEPS !== 'undefined' ? FONT_SCALE_STEPS : [];
        for (let i = 0; i < steps.length; i++) {
          /* option 只印档名（标准/大字/特大/老年）—— 档位说明放进 title。
             选项文字一长，select 会把整行撑满，左侧说明被挤成"竖排"（中文可逐字断行）。 */
          fopts += '<option value="' + steps[i].key + '" title="' + steps[i].note + '">' + steps[i].label + '</option>';
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:injectThemeGroup'); }
      fontRow.innerHTML =
        '<div class="setting-label">字号大小<div class="setting-desc">整站文字一起放大缩小，只影响可读性，不改布局结构。</div></div>' +
        '<select id="setFontScale" class="setting-select" data-change="setFontScaleSafe" data-change-args=\'["@value"]\'>' + fopts + '</select>';
      if (themeRow.nextSibling) body.insertBefore(fontRow, themeRow.nextSibling);
      else body.appendChild(fontRow);
      try {
        applyFontScale(appData.settings.fontScale);
      } catch (e) { if (window.__silent) window.__silent(e, '05:injectThemeGroup'); }
      /* 「📲 添加到主屏幕」不再单独占一个设置组：并进「🎨 主题」组末尾。 */
      try {
        /* 模板里那个独立分组已整个删掉（用户要求：不要单独占一个设置组）。
           现在直接在主题组末尾造这一行，只留「标题 + 一句说明 + 按钮」，
           状态文案和手动步骤默认是空的（stepsHtml 对 ready/standalone 返回 ''），
           所以正常情况这一行就很短；浏览器弹不了框时才会长出步骤列表。 */
        let instRow = document.createElement('div');
        instRow.id = 'W8InstallRow';
        instRow.className = 'setting-row';
        instRow.style.cssText =
          'flex-direction:column; align-items:stretch; gap:0; padding-top:var(--sp-10);' +
          'border-top:1px solid var(--border); margin-top:var(--sp-6);';
        instRow.innerHTML =
          '<div class="setting-label" style="flex:none;">📲 添加到主屏幕' +
            '<div class="setting-desc">装到桌面，从图标直接打开：没有地址栏，断网也能用。数据也更不容易被浏览器清掉。</div>' +
          '</div>' +
          '<button class="save-btn" data-act="installApp" id="installBtn" style="margin-bottom:0;">📲 添加到主屏幕</button>' +
          '<div id="installStatus" style="font-size:var(--fs-note); color:var(--text-light); line-height:1.6; opacity:.85; margin-top:var(--sp-6);"></div>' +
          '<div id="installSteps" style="font-size:var(--fs-note); color:var(--text); line-height:1.7; background:var(--bg); border:1px solid var(--hairline); border-radius:var(--radius); padding:var(--sp-10) var(--sp-12); margin-top:var(--sp-6);"></div>';
        body.appendChild(instRow);
        /* 原分组的 <h3 data-after="renderInstallRow"> 被一并删掉了 —— 它同时是
           「点开组时刷新安装状态」的触发器。搬进主题组后必须自己补一次渲染，
           否则按钮永远停在模板写死的「📲 添加到主屏幕」文案上，
           hintText / stepsHtml 都不再更新（installState 变化也不反映）。 */
        /* 必须延迟一帧再渲染：同步调用时本页的初始化流程还没走完，
           紧接着有代码把这一块的文案按模板默认值重刷（实测：同步调用后
           状态文案又被清空，按钮回到「📲 添加到主屏幕」）。放到 rAF 里跑，
           等初始化彻底落定，状态才是最终状态。 */
        var _instRender = function () {
          try {
            if (typeof window.renderInstallRow === 'function') window.renderInstallRow(true);
          } catch (e) { if (window.__silent) window.__silent(e, '05:installRow'); }
        };
        if (window.requestAnimationFrame) window.requestAnimationFrame(_instRender);
        else setTimeout(_instRender, 0);
      } catch (e) { if (window.__silent) window.__silent(e, '05:injectThemeGroup'); }
      first.parentNode.insertBefore(g, first);
      try {
        if (window.themeEngine && typeof themeEngine.renderCards === 'function') themeEngine.renderCards();
      } catch (e) { if (window.__silent) window.__silent(e, '05:injectThemeGroup'); }
    } catch (e) { if (window.__silent) window.__silent(e, '05:injectThemeGroup'); }
  }

  /* ============ ⑩ 成长之旅开关：可随时关闭直接体验全部玩法 ============ */
  function setJourneyEnabled(on) {
    try {
      if (!ensureJourney()) return;
      let j = journey();
      if (on) {
        let _lastAt = STEPS[STEPS.length - 1].at;
        let _full = totalPomos() >= _lastAt;
        if (!j.startTs || j.legacy || _full) {
          /* 老玩家首次开启 / 已通关后再次开启 = 像新玩家一样重新解锁（历史数据保留，玩法从 0 再逐档开） */
          j.startTs = Date.now();
          j.seen = [];
          j.pending = [];
          j.legacy = false;
          j.achieveSince = null;
        }
        j.enabled = true;
      } else {
        j.enabled = false;
      }
      persist();
      afterToggleRefresh();
      try {
        showToast(
          on ? '🧭 成长之旅已开启：玩法将随🍅逐步解锁（与新人一样从 0 开始）' : '🎮 已关闭成长之旅：全部玩法直接开放',
          true
        );
      } catch (e) { if (window.__silent) window.__silent(e, '05:setJourneyEnabled'); }
    } catch (e) { if (window.__silent) window.__silent(e, '05:setJourneyEnabled'); }
  }
  window.setJourneyEnabled = setJourneyEnabled;
  let _wasUnfinished = null;
  function syncBodyFlags() {
    try {
      let unfinished = !!(journey() && journey().enabled && !allDone());
      document.body.classList.toggle('journey-unfinished', unfinished);
      if (_wasUnfinished !== null && _wasUnfinished === true && unfinished === false) {
        /* 全部解锁瞬间：把旅程期间隐藏的计时页玩法重新渲染出来 */
        try {
          renderTimerRankStrip();
        } catch (e) { if (window.__silent) window.__silent(e, '05-syncBodyFlags'); }
        try {
          renderTimerBadge();
        } catch (e) { if (window.__silent) window.__silent(e, '05:syncBodyFlags'); }
        try {
          refreshLockUI();
        } catch (e) { if (window.__silent) window.__silent(e, '05:syncBodyFlags'); }
      }
      _wasUnfinished = unfinished;
    } catch (e) { if (window.__silent) window.__silent(e, '05-syncBodyFlags'); }
  }
  function afterToggleRefresh() {
    syncBodyFlags();
    try {
      renderBar();
    } catch (e) { if (window.__silent) window.__silent(e, '05-afterToggleRefresh'); }
    try {
      refreshLockUI();
    } catch (e) { if (window.__silent) window.__silent(e, '05:afterToggleRefresh'); }
    try {
      renderTimerRankStrip();
    } catch (e) { if (window.__silent) window.__silent(e, '05:afterToggleRefresh'); }
    try {
      renderTimerBadge();
    } catch (e) { if (window.__silent) window.__silent(e, '05:afterToggleRefresh'); }
    try {
      let _c = document.getElementById('jyToggleEnable');
      if (_c) _c.checked = !!(journey() && journey().enabled);
    } catch (e) { if (window.__silent) window.__silent(e, '05:afterToggleRefresh'); }
  }
  function injectSettingsToggle() {
    try {
      let host = null;
      let rows = document.querySelectorAll('#view-settings .setting-row');
      rows.forEach(function (r) {
        if (r.textContent.indexOf('重新查看新手指引') >= 0) host = r;
      });
      if (!host) return;
      if (document.getElementById('jyToggleRow')) return;
      let div = document.createElement('div');
      div.className = 'setting-row';
      div.id = 'jyToggleRow';
      div.style.cssText = 'margin-top:var(--sp-2);border-top:1px solid var(--border);padding-top:var(--sp-10);';
      let _on0 = journey().enabled;
      div.innerHTML =
        '<div class="setting-label" style="flex:1">🧭 成长之旅（渐进解锁）' +
        '<div class="setting-desc">玩法随完成的🍅逐步解锁；关闭后全部玩法立即开放（可随时重新开启）</div></div>' +
        '<label class="switch"><input type="checkbox" id="jyToggleEnable" ' +
        (_on0 ? 'checked' : '') +
        ' onchange="setJourneyEnabled(this.checked)"><span class="switch-slider"></span></label>';
      host.parentNode.insertBefore(div, host);
    } catch (e) { if (window.__silent) window.__silent(e, '05:injectSettingsToggle'); }
  }

  function injectEnableCard() {
    if (document.getElementById('jyEnableCard')) return;
    let c = document.createElement('div');
    c.className = 'jy-ov';
    c.id = 'jyEnableCard';
    c.innerHTML =
      '<div class="jy-card" style="text-align:center">' +
      '<div style="font-size:42px;line-height:1">🧭</div>' +
      '<div class="jy-name" style="font-size:var(--fs-title)">成长之旅当前是关闭的</div>' +
      '<div class="jy-intro">想体验玩法随🍅逐步解锁？开启后（老数据也会从 0 重新解锁）：先专注，再一个个发现乐趣。<br><br>也可以继续使用完整版，之后随时到「设置 → 新手引导」开启。</div>' +
      '<div class="jy-btns"><button class="jy-btn primary" id="jyEnableGo">开启成长之旅</button><button class="jy-btn" id="jyEnableNo">暂不</button></div></div>';
    document.body.appendChild(c);
    c.addEventListener('click', function (e) {
      if (e.target === c) closeEnableCard(false);
    });
    document.getElementById('jyEnableGo').onclick = function () {
      closeEnableCard(true);
    };
    document.getElementById('jyEnableNo').onclick = function () {
      closeEnableCard(false);
    };
  }
  function injectLockUI() {
    if (document.getElementById('jyLock')) return;
    let css = document.createElement('style');
    css.textContent =
      '.jy-lock-card{text-align:center}.jy-lock-ico{font-size:44px;margin-bottom:var(--sp-4)}.jy-lock-name{font-size:var(--fs-sub);font-weight:900;color:var(--text);margin:var(--sp-4) 0 var(--sp-8)}.jy-lock-intro{font-size:var(--fs-note);color:var(--text-light);line-height:1.6;margin-bottom:var(--sp-14)}';
    document.head.appendChild(css);
    let l = document.createElement('div');
    l.className = 'jy-ov';
    l.id = 'jyLock';
    l.innerHTML =
      '<div class="jy-card jy-lock-card">' +
      '<div class="jy-lock-ico" id="jyLockEmoji">🔒</div>' +
      '<div class="jy-lock-name" id="jyLockName"></div>' +
      '<div class="jy-lock-intro" id="jyLockIntro"></div>' +
      '<button class="jy-btn primary" id="jyLockOk">知道了</button></div>';
    document.body.appendChild(l);
    l.addEventListener('click', function (e) {
      if (e.target === l) closeLock();
    });
    document.getElementById('jyLockOk').onclick = closeLock;
  }

  /* ============ ⑥ 版本更新公告（新老用户都弹一次，可跳过） ============ */
  /* 公告已读状态收编进 appData.uiPrefs.annSeen（原 tomato_jy_ann=ANN_VER 独立键已删） */
  function annSeen() {
    try {
      return !!(appData && appData.uiPrefs && appData.uiPrefs.annSeen);
    } catch (e) {
      return false;
    }
  }
  function annMarkSeen() {
    try {
      if (appData && appData.uiPrefs) {
        appData.uiPrefs.annSeen = true;
        saveDataNow();
      }
    } catch (e) { if (window.__silent) window.__silent(e, '05:annMarkSeen'); }
  }
  let _annBootAt = Date.now(),
    _annShown = false;
  /* M3 体验：公告"不挡手"。jy-nb 公告层背景 pointer-events:none（可穿透点击底层），
     卡片本身可点；任意点卡片外 → 公告自动关闭（记已读）且那次点击照常落到页面功能上。
     解决"老用户首开被公告盖住，点不了精力/心情/开始"的困惑。 */
  function annBindTapDismiss(id) {
    let ov = document.getElementById(id);
    if (!ov) return;
    let fnD =
      id === 'jyAnn'
        ? annDismiss
        : function () {
            ann2Close(false);
          };
    let h = function (e) {
      if (!ov.classList.contains('jy-open')) {
        document.removeEventListener('pointerdown', h, true);
        return;
      }
      if (e.target && e.target.closest && e.target.closest('.jy-card')) return; /* 卡片内交给按钮 */
      document.removeEventListener('pointerdown', h, true);
      fnD();
    };
    document.addEventListener('pointerdown', h, true);
  }
  function announceTick() {
    try {
      if (_annShown) return;
      if (!ensureJourney()) return;
      if (journey().enabled) return; /* 新用户/旅程开启：直接引导即可，不弹"本次更新"公告 */
      if (annSeen()) return;
      if (Date.now() - _annBootAt < 2000) return; /* 启动 2s 后再弹，等首屏/原有引导安定 */
      /* 横屏/平板「全屏专注不显示」：本公告是全局弹窗，启动满 2s 就无条件弹出的话，
         会盖在全屏专注（#immersionMode）之上 —— 用户看到的是公告卡而不是专注界面，
         误以为"全屏专注没显示"。改为：全屏专注期间、或专注计时进行中一律不弹，
         轮询会一直等到用户回到空闲状态再弹（不是丢弃，只是延后）。 */
      try {
        const _im = document.getElementById('immersionMode');
        if (_im && _im.classList.contains('show')) return;
      } catch (e) { if (window.__silent) window.__silent(e, '05:announceTick'); }
      try {
        if (typeof timerState !== 'undefined' && timerState && timerState.mode === 'focus' && timerState.running) return;
      } catch (e) { if (window.__silent) window.__silent(e, '05:announceTick'); }
      /* 其它全屏浮层（角色卡/章节过渡/结算/晋升庆祝）压制中同样不弹，避免叠层 */
      try {
        const _busy = ['immersiveCardModal', 'countdownOverlay', 'rankUpModal', 'finishModal'];
        for (let _i = 0; _i < _busy.length; _i++) {
          const _el = document.getElementById(_busy[_i]);
          if (!_el) continue;
          const _cs = getComputedStyle(_el);
          if (_el.classList.contains('show') || _cs.display === 'flex') return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:announceTick'); }
      let ov = document.getElementById('jyAnn');
      if (!ov) return;
      ov.classList.add('jy-open');
      _annShown = true;
      annBindTapDismiss('jyAnn');
    } catch (e) { if (window.__silent) window.__silent(e, '05:announceTick'); }
  }
  function annDismiss() {
    /* 点击遮罩空白：视作已读，直接整段关闭，不再弹第二段（防止连环弹窗吞掉页面点击） */
    let ov = document.getElementById('jyAnn');
    if (ov) ov.classList.remove('jy-open');
    _annShown = true;
    annMarkSeen();
  }
  function annSkip() {
    let ov = document.getElementById('jyAnn');
    if (ov) ov.classList.remove('jy-open');
    _annShown = true;
    annMarkSeen();
    /* 第二段小弹窗：提示可去设置重走（仅"跳过"路径出现） */
    let ov2 = document.getElementById('jyAnn2');
    if (ov2)
      setTimeout(function () {
        ov2.classList.add('jy-open');
        annBindTapDismiss('jyAnn2');
      }, 250);
  }
  function annGo() {
    /* 老用户点"开始体验"：直接重播新手引导，不再追问 */
    let ov = document.getElementById('jyAnn');
    if (ov) ov.classList.remove('jy-open');
    _annShown = true;
    annMarkSeen();
    try {
      setTimeout(function () {
        try {
          replayGuide();
        } catch (e) { if (window.__silent) window.__silent(e, '05:annGo'); }
      }, 150);
      return;
    } catch (e) { if (window.__silent) window.__silent(e, '05:annGo'); }
    annSkip();
  }
  function ann2Close(go) {
    let ov2 = document.getElementById('jyAnn2');
    if (ov2) ov2.classList.remove('jy-open');
    if (go) {
      try {
        switchView('settings');
      } catch (e) { if (window.__silent) window.__silent(e, '05:ann2Close'); }
    }
  }
  function injectAnnounce() {
    if (document.getElementById('jyAnn')) return;
    let a1 = document.createElement('div');
    a1.className = 'jy-ov jy-nb';
    a1.id = 'jyAnn';
    a1.innerHTML =
      '<div class="jy-card">' +
      '<div class="jy-ico" style="font-size:44px">📦</div>' +
      '<div class="jy-name" style="font-size:var(--fs-sub)">本次更新：渐进解锁</div>' +
      '<div class="jy-intro">玩法现在会随你完成的🍅逐步开启：第 1 个解锁番茄树、第 3 个段位、第 5 个金币玩法、第 7 个成就、第 10 个沉浸冒险。<br><br>让开头几个番茄更纯粹——先专注，再一个个发现乐趣。解锁过的玩法永久保留。<br><br>⚙️ 想直接体验全部玩法？可随时到「设置 → 新手引导」处一键关闭（也可重新开启）。</div>' +
      '<div class="jy-btns"><button class="jy-btn primary" id="jyAnnGo">开始体验</button><button class="jy-btn" id="jyAnnSkip">跳过</button></div></div>';
    document.body.appendChild(a1);
    a1.addEventListener('click', function (e) {
      if (e.target === a1) annDismiss();
    });
    let a2 = document.createElement('div');
    a2.className = 'jy-ov jy-nb';
    a2.id = 'jyAnn2';
    a2.innerHTML =
      '<div class="jy-card">' +
      '<div class="jy-ico" style="font-size:44px">🧭</div>' +
      '<div class="jy-name" style="font-size:var(--fs-title)">还想再看一遍解锁过程？</div>' +
      '<div class="jy-intro">去「设置」→「重新查看新手指引」，可以随时重走一遍渐进解锁介绍。</div>' +
      '<div class="jy-btns"><button class="jy-btn primary" id="jyAnn2Go">去设置</button><button class="jy-btn" id="jyAnn2Close">关闭</button></div></div>';
    document.body.appendChild(a2);
    a2.addEventListener('click', function (e) {
      if (e.target === a2) ann2Close(false);
    });
    document.getElementById('jyAnnGo').onclick = annGo; /* 开始体验=重播新手指引 */
    document.getElementById('jyAnnSkip').onclick = annSkip; /* 跳过=提示可去设置重走 */
    document.getElementById('jyAnn2Go').onclick = function () {
      ann2Close(true);
    };
    document.getElementById('jyAnn2Close').onclick = function () {
      ann2Close(false);
    };
  }

  /* ============ ⑤ UI 注入（样式 + 提示条 + 解锁卡 + 路线层） ============ */
  function injectUI() {
    if (document.getElementById('jyCard')) return;
    let css = document.createElement('style');
    css.textContent =
      '.jy-bar{display:none;text-align:center;font-size:var(--fs-caption);color:var(--text-light);background:var(--card);border:1px solid var(--hairline);border-radius:var(--radius);padding:var(--sp-6) var(--sp-10);margin:var(--sp-8) var(--sp-16) 0;line-height:1.5;cursor:pointer;user-select:none;}' +
      '.jy-bar b{color: var(--primary-ink);}' +
      '.jy-ov{position:fixed;left:0;top:0;right:0;bottom:0;z-index:9990;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:26px;backdrop-filter:blur(2px);}' +
      '.jy-ov.jy-open{display:flex;}' +
      '.jy-ov.jy-nb{pointer-events:none;}' /* M3：公告背景可穿透，不挡底层操作 */ +
      '.jy-ov.jy-nb .jy-card{pointer-events:auto;}' +
      '.jy-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-soft-xl);max-width:320px;width:100%;text-align:center;padding:var(--sp-24) var(--sp-20) var(--sp-16);animation:jyIn .22s ease;}' +
      '@keyframes jyIn{from{opacity:0;transform:scale(.86) translateY(10px);}to{opacity:1;transform:none;}}' +
      '.jy-ico{font-size:52px;line-height:1;margin-bottom:var(--sp-6);}' +
      '.jy-name{font-size:var(--fs-sub);font-weight:900;color:var(--text);margin:var(--sp-4) 0 var(--sp-8);}' +
      '.jy-intro{font-size:var(--fs-body);line-height:1.6;color:var(--text-light);margin-bottom:var(--sp-16);}' +
      '.jy-btns{display:flex;gap:var(--sp-8);}' +
      '.jy-btn{flex:1;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:var(--fs-body);font-weight:800;padding:var(--sp-10) var(--sp-6);border-radius:var(--radius);cursor:pointer;}' +
      '.jy-btn:active{transform:scale(.95);}' +
      '.jy-btn.primary{background:var(--primary);border-color:var(--primary-dark);color:var(--on-primary);}' +
      '.jy-tag{display:inline-block;font-size:var(--fs-micro);font-weight:900;letter-spacing:1px;color: var(--yellow-ink);border:1.5px solid var(--yellow-dark);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-8);margin-bottom:var(--sp-4);}' +
      '.jy-route-item{display:flex;align-items:center;gap:var(--sp-10);background:var(--card);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--sp-10) var(--sp-12);margin-bottom:var(--sp-8);}' +
      '.jy-route-item .jy-r-ico{font-size:26px;}' +
      '.jy-route-item .jy-r-name{font-size:var(--fs-body);font-weight:800;color:var(--text);}' +
      '.jy-route-item .jy-r-sub{font-size:var(--fs-caption);color:var(--text-light);line-height:1.4;}' +
      '.jy-route-banner{font-size:var(--fs-note);font-weight:700;color: var(--primary-ink);background:rgba(var(--primary-rgb),.08);border:1px dashed rgba(var(--primary-rgb),.4);border-radius:var(--radius);padding:var(--sp-6) var(--sp-10);margin:var(--sp-2) 0 var(--sp-8);line-height:1.5;}' +
      '.jy-route-item .jy-r-st{font-size:var(--fs-tiny);font-weight:800;flex-shrink:0;}' +
      '.jy-r-done{color: var(--green-ink);}.jy-r-lock{color:var(--text-light);}' +
      'body.journey-unfinished #timerGhostBox{display:none!important;}' +
      'body.jy-lock-coin #treeCoins,body.jy-lock-coin #treeDailyTasks,body.jy-lock-coin #mysteryTip{display:none;}';
    document.head.appendChild(css);

    let card = document.createElement('div');
    card.className = 'jy-ov';
    card.id = 'jyCard';
    card.innerHTML =
      '<div class="jy-card">' +
      '<div class="jy-ico" id="jyCardEmoji">🔓</div>' +
      '<div class="jy-name" id="jyCardName"></div>' +
      '<div class="jy-tag">🎉 已解锁</div>' +
      '<div class="jy-intro" id="jyCardIntro"></div>' +
      '<div class="jy-btns">' +
      '<button class="jy-btn primary" id="jyGoBtn">🔓 去体验</button>' +
      '<button class="jy-btn" id="jyLaterBtn">稍后再说</button>' +
      '</div></div>';
    document.body.appendChild(card);
    card.addEventListener('click', function (e) {
      if (e.target === card) closeCard(false);
    });
    document.getElementById('jyGoBtn').onclick = function () {
      let id = document.getElementById('jyCardName').dataset.stepId || '';
      closeCard(false);
      let s = STEP_MAP[id];
      if (s) {
        gotoStatsTab(id);
      } else {
        closeCard(true);
      }
    };
    document.getElementById('jyLaterBtn').onclick = function () {
      let _c = document.getElementById('jyCard');
      let id = document.getElementById('jyCardName').dataset.stepId || '';
      let _fromTab = !!(_c && _c.dataset.fromTab);
      /* 从 tab 点开的卡＝已读，不再挂回 pending（否则 NEW 常驻）；
         自动弹卡时的「稍后再说」才保留提醒语义。 */
      if (!_fromTab && id && journey().pending.indexOf(id) < 0) journey().pending.push(id);
      closeCard(false);
    };
    /* showCard 时记录 stepId 供按钮跳转 */
    let _origShow = showCard;
    showCard = function (step) {
      document.getElementById('jyCardName').dataset.stepId = step.id;
      _origShow(step);
    };

    /* 路线弹层 */
    let rt = document.createElement('div');
    rt.className = 'jy-ov';
    rt.id = 'jyRoute';
    rt.innerHTML =
      '<div class="jy-card">' +
      '<div class="jy-name" style="font-size:var(--fs-title)">🗺️ 玩法解锁路线</div>' +
      '<div id="jyRouteBanner" class="jy-route-banner"></div>' +
      '<div id="jyRouteBody" style="text-align:left;margin:var(--sp-6) 0 var(--sp-14)"></div>' +
      '<button class="jy-btn primary" id="jyRouteClose">知道了</button></div>';
    document.body.appendChild(rt);
    rt.addEventListener('click', function (e) {
      if (e.target === rt) closeRoute();
    });
    document.getElementById('jyRouteClose').onclick = closeRoute;
    injectAnnounce();
    injectLockUI();
    bindImmersiveOpenUnlock();
    injectEnableCard();
    injectSettingsToggle();
    injectThemeGroup();
    splitPosterCard();
    injectStatsFold();
  }

  /* ============ ⑦ 新手引导结束 → 接「玩法解锁路线」引导 ============ */
  function journeyAfterGuide() {
    try {
      if (!ensureJourney()) return;
      /* 旅程开着时**不再自动弹路线**：新人刚点完 4 步引导，紧接着又被塞一屏
         「还差 N 个🍅」的目录，就成了弹窗接力 —— 而那时他还什么都没解锁，目录也读不出意义。
         进度入口在计时页那条常驻提示条上（jyBar：点开即完整路线），想看时随时点。 */
      if (!journey().enabled) showEnableCard();
    } catch (e) { if (window.__silent) window.__silent(e, '05:journeyAfterGuide'); }
  }
  function showEnableCard() {
    let ov = document.getElementById('jyEnableCard');
    if (!ov) return;
    ov.classList.add('jy-open');
  }
  function closeEnableCard(doOpen) {
    let ov = document.getElementById('jyEnableCard');
    if (ov) ov.classList.remove('jy-open');
    if (doOpen) {
      setJourneyEnabled(true);
      try {
        setTimeout(journeyAfterGuide, 200);
      } catch (e) { if (window.__silent) window.__silent(e, '05:closeEnableCard'); }
    }
  }
  /* 包装原 skipGuide：走完引导或点跳过，结束后都走一次 journeyAfterGuide
     （它只在「旅程被关闭」时提示可开启，不再弹路线 —— 见该函数注释） */
  let _origSkipGuide = window.skipGuide;
  if (typeof _origSkipGuide === 'function') {
    window.skipGuide = function () {
      let r = _origSkipGuide.apply(this, arguments);
      try {
        setTimeout(journeyAfterGuide, 500);
      } catch (e) { if (window.__silent) window.__silent(e, '05:closeEnableCard'); }
      return r;
    };
  }

  /* ============ 启动 ============ */

  /* ============ ⑬ 跨会话/跨功能补强 ============ */

  /* 视图切换钩子（原来靠包装 window.switchView）：
     切**前**保存展开中的计划详情（防切页丢失正在编辑的备注/🍅/最晚完成日）；
     切**后**若是进统计页，回收折叠卡（200ms 与 800ms 各收一次，覆盖慢渲染）。 */
  tbOnViewSwitch(function () {
    try {
      if (typeof appData !== 'undefined' && appData && Array.isArray(appData.todos)) {
        for (let i = 0; i < appData.todos.length; i++) {
          let t = appData.todos[i];
          try {
            if (
              t &&
              expandedTodos &&
              expandedTodos[t.id] &&
              document.getElementById('todo_detail_' + t.id)
            )
              forceSaveTodoDetail(t.id, true);
          } catch (e) { if (window.__silent) window.__silent(e, '05:cell'); }
        }
      }
    } catch (e) { if (window.__silent) window.__silent(e, '05:cell'); }
  }, 'before');
  tbOnViewSwitch(function (view) {
    try {
      if (view === 'stats') {
        setTimeout(function () {
          try {
            reapFoldByIds();
          } catch (e) { if (window.__silent) window.__silent(e, '05:cell'); }
        }, 200);
        setTimeout(function () {
          try {
            reapFoldByIds();
          } catch (e) { if (window.__silent) window.__silent(e, '05:cell'); }
        }, 800);
      }
    } catch (e) { if (window.__silent) window.__silent(e, '05:cell'); }
  }, 'after');

  /* 沉浸冒险：重启浏览器/杀后台 ≠ 断更。每个新会话第一次开始番茄时，
     若距上次推进超过 buffer 但在半天内，把间隔起点顺延到当前，避免一回来就吃坏结局 */
  let _ostale = window.immersiveCheckStale;
  if (typeof _ostale === 'function') {
    window.immersiveCheckStale = function () {
      try {
        if (
          !window.__jyStaleGrace &&
          typeof appData !== 'undefined' &&
          appData &&
          appData.immersiveFocus &&
          appData.immersiveFocus.active &&
          appData.immersiveFocus.lastAdvanceAt
        ) {
          window.__jyStaleGrace = true;
          let _buf =
            appData.settings && Number(appData.settings.bufferTime) > 0 ? Number(appData.settings.bufferTime) : 30;
          let _gp = (Date.now() - appData.immersiveFocus.lastAdvanceAt) / 60000;
          if (_gp > _buf && _gp < 360) {
            appData.immersiveFocus.lastAdvanceAt = Date.now();
            try {
              saveDataNow();
            } catch (e) { if (window.__silent) window.__silent(e, '05:cell'); }
          }
        }
      } catch (e) { if (window.__silent) window.__silent(e, '05:cell'); }
      return _ostale.apply(this, arguments);
    };
  }

  /* 多标签页/多窗口同步：回前台时读一次存档，记录条数不一致则全量重载并重绘（专注中不打扰） */
  function setupCrossTabSync() {
    try {
      if (window.__jySyncDone) return;
      window.__jySyncDone = true;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        try {
          if (window.timerState && timerState.running && timerState.mode === 'focus') return;
          idbGet(STORAGE_KEY)
            .then(function (raw) {
              try {
                if (!raw) return;
                let obj = JSON.parse(raw);
                let fr = obj && obj.d ? JSON.parse(obj.d) : obj;
                let fl = (fr.records || []).length || 0;
                let cl = (appData.records || []).length || 0;
                if (fl === cl) return;
                loadData()
                  .then(function () {
                    try {
                      ensureJourney();
                      afterToggleRefresh();
                      updateTodayStats();
                      renderStats();
                      renderTodos();
                      renderLogs();
                      renderTeamSystem();
                      try {
                        showToast('🔄 检测到其他窗口有更新，已自动同步', true);
                      } catch (e) { if (window.__silent) window.__silent(e, '05:setupCrossTabSync'); }
                    } catch (e) { if (window.__silent) window.__silent(e, '05-setupCrossTabSync'); }
                  })
                  .catch(function (e) {
                    if (window.__silent) window.__silent(e, '05:setupCrossTabSync');
                  });
              } catch (e) { if (window.__silent) window.__silent(e, '05:setupCrossTabSync'); }
            })
            .catch(function (e) {
              if (window.__silent) window.__silent(e, '05:setupCrossTabSync');
            });
        } catch (e) { if (window.__silent) window.__silent(e, '05:setupCrossTabSync'); }
      });
    } catch (e) { if (window.__silent) window.__silent(e, '05:setupCrossTabSync'); }
  }

  let tries = 0;
  (function boot() {
    try {
      if (hasApp()) {
        ensureJourney();
        injectUI();
        renderBar();
        setupCrossTabSync();
        if (window.__ivGov) {
          __ivGov.add(announceTick, 800);
        } else {
          setInterval(announceTick, 800);
        } /* 更新公告：M1 起切后台休眠，回前台自动恢复探测 */
        if (!journey().enabled) return; /* 老数据默认关闭：什么都不做，全放行 */
        if (allDone()) return; /* 已全解锁：仍保留模块但无提示条 */
        if (window.__ivGov) {
          __ivGov.add(renderBar, 1000);
        } else {
          setInterval(renderBar, 1000);
        } /* 专注中隐藏/下一目标刷新 · M1 后台休眠 */
        return;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '05:boot'); }
    tries++;
    if (tries > 300) return;
    setTimeout(boot, 500);
  })();

  /* 调试钩子（不影响运行，供自测/排查） */
  window.__jy = {
    totalPomos: totalPomos,
    unlocked: unlocked,
    ensure: ensureJourney,
    afterSettle: afterSettle,
    enabled: enabled,
    steps: STEPS,
    win: _jyWinCache,
    setEnabled: setJourneyEnabled
  };
})();
