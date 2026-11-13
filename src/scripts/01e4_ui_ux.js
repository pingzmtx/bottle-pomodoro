/* ============================================================
 * 01e4 · 极简/快捷面板/难度档与滑动手势
 * 由 01e_engine_ui.js 按渲染域拆出（可回退：本文件整段随 slot1 files 还原）
 * 函数索引（TOC）：toggleMinimalMode/applyMinimalMode/toggleQuickPanel/closeQuickPanel/quickGoImmersive/refreshQuickPanel/renderDurationSuggestion/syncDifficultyWithDuration/getEasyModeEffectiveDuration/renderDifficultyPicker/setDifficulty/showRestFact（+7 更多）
 * ============================================================ */

/* ============================================================
 * 白帽游戏化 · 界面层（极简模式 / 心流推荐 / 难度选择=时长档位 / 休息仪式 / 人机排行榜）
 * 业务逻辑在 03-features.js（推荐时长/疲劳/倍率/排行数据），本文件只做渲染与交互。
 * 难度档位与时长绑定：简单10分钟 / 中等25分钟 / 沉浸式50分钟 / 大师90分钟，奖励按 25 分钟=1 个🍅折算。
 * 手动优先：选过难度档/时长（difficultyTouched）后开始计时严格按所选档位，自适应推荐仅在未手动选择时接管。
 * ============================================================ */
/* ---- 极简模式：一键回归纯粹计时器（白帽游戏化·工具优先：隐藏种树/段位/成就叠加层） ---- */
function toggleMinimalMode() {
  saveSettings();
  applyMinimalMode();
  showToast(
    appData.settings.minimalMode ? '🧘 极简模式已开启：回归纯粹计时器' : '🎮 极简模式已关闭，游戏化叠加层恢复',
    true
  );
}
function applyMinimalMode() {
  const on = !!(appData.settings && appData.settings.minimalMode);
  document.body.classList.toggle('minimal-mode', on);
  refreshQuickPanel();
}
/* ---- 快捷功能面板：白噪音 / 沉浸 / 极简 三合一入口（header 单按钮） ---- */
function toggleQuickPanel() {
  const p = document.getElementById('quickPanel');
  if (!p) return;
  if (p.classList.contains('open')) {
    closeQuickPanel();
    return;
  }
  refreshQuickPanel();
  p.classList.add('open');
}
function closeQuickPanel() {
  const p = document.getElementById('quickPanel');
  if (p) p.classList.remove('open');
}
function quickGoImmersive() {
  closeQuickPanel();
  toggleImmersion();
}
function refreshQuickPanel() {
  const p = document.getElementById('quickPanel');
  if (!p) return;
  const im = document.getElementById('immersionMode');
  const imOn = !!(im && im.classList.contains('show'));
  const iEl = p.querySelector('.qp-item[data-action="immerse"]');
  if (iEl) iEl.classList.toggle('on', imOn);
}
/* 点击面板外任意处自动收起 */
document.addEventListener('click', function (e) {
  const p = document.getElementById('quickPanel');
  if (!p || !p.classList.contains('open')) return;
  if (e.target && e.target.closest && (e.target.closest('#quickPanel') || e.target.closest('#quickBtn'))) return;
  closeQuickPanel();
});
/* ---- 心流自适应 · 时长建议提示：timer 界面显示「推荐 N 分钟（难度名）」；手动锁定档位后仅作建议，不再覆盖 ---- */
function renderDurationSuggestion() {
  const el = document.getElementById('durationSuggestion');
  if (!el) return;
  if (!appData.settings.adaptiveSuggest) {
    el.style.display = 'none';
    return;
  }
  const rec = getRecommendedWorkDuration();
  const cur = appData.settings.workDuration;
  el.style.display = 'block';
  const dName = getDifficultyCfg(getDifficultyByDuration(rec)).name;
  const manual = appData.settings.difficultyTouched === true; /* 已手动锁定档位：推荐只提示，计时按所选档位 */
  if (rec === cur) {
    el.textContent = '💡 当前时长正合适，保持 ' + cur + ' 分钟';
    el.className = 'duration-suggestion ok';
  } else if (rec > cur) {
    el.textContent =
      '📈 近期完成率高，' +
      (manual ? '系统建议' : '推荐升级到') +
      rec +
      ' 分钟·' +
      dName +
      (manual ? '（想采纳就点对应难度档）' : '（心流通道）');
    el.className = 'duration-suggestion up';
  } else {
    el.textContent =
      '📉 近期中断偏多，' +
      (manual ? '系统建议' : '推荐缩短到') +
      rec +
      ' 分钟·' +
      dName +
      (manual ? '（想采纳就点对应难度档）' : '（先找回状态）');
    el.className = 'duration-suggestion down';
  }
}
/* ---- 启动对齐：老数据「难度档位」与「单番茄时长」不一致时，以时长为准反推难度（时长=难度=倍率三位一体） ---- */
function syncDifficultyWithDuration() {
  const d = getDifficultyByDuration(appData.settings.workDuration);
  if ((appData.settings.difficulty || 'medium') !== d) {
    appData.settings.difficulty = d;
    saveData();
  }
}
/* ---- 任务难度选择器：档位=时长（简单10分钟/中等25分钟/沉浸式50分钟/大师90分钟，无倍率，奖励按时长折算） ---- */
/* 轻松模式生效时实际时长减半（最低 10 分钟，与 startPomodoro 同一口径）。
   把减半结果显式渲染进档位卡，消除「选 25 分钟实际只跑 15 分钟」的歧义。 */
function getEasyModeEffectiveDuration(base) {
  const b = Number(base) > 0 ? Number(base) : 25;
  if (isEasyModeActive() && b > 10) return Math.max(10, Math.round(b / 2));
  return b;
}
function renderDifficultyPicker() {
  const c = document.getElementById('difficultyPicker');
  if (!c) return;
  const cur = appData.settings.difficulty || 'medium';
  const easyOn = isEasyModeActive();
  let h = '<div class="difficulty-picker">';
  DIFFICULTY_CONFIG.forEach(function (d) {
    const on = d.key === cur ? ' active' : '';
    const eff = getEasyModeEffectiveDuration(d.duration);
    const halved = easyOn && eff !== d.duration;
    /* 轻松模式：原时长删除线 + 实际时长高亮，一眼看清「点它跑多久」 */
    const durHtml = halved
      ? '<span class="difficulty-duration"><s class="dur-orig">' +
        d.duration +
        '</s>' +
        eff +
        ' 分钟</span>'
      : '<span class="difficulty-duration">' + eff + ' 分钟</span>';
    h +=
      '<div class="difficulty-option' +
      on +
      (halved ? ' easy-halved' : '') +
      '" data-key="' +
      d.key +
      '" onclick="setDifficulty(\'' +
      d.key +
      '\')" title="' +
      d.desc +
      (halved ? '（轻松模式生效中：实际 ' + eff + ' 分钟）' : '') +
      '">' +
      '<span class="difficulty-icon">' +
      d.icon +
      '</span>' +
      '<span class="difficulty-name">' +
      d.name +
      '</span>' +
      durHtml +
      '</div>';
  });
  h += '</div>';
  c.innerHTML = h;
  /* picker 常驻：hint 内容渲染到折叠区里的 difficultyHintBody（模板恒存在；difficultyHint 为历史死引用 已删） */
  const hint = document.getElementById('difficultyHintBody');
  if (hint) {
    const sug = getSuggestedDifficulty();
    const sugCfg = getDifficultyCfg(sug);
    const curCfg = getDifficultyCfg(cur);
    const curEff = getEasyModeEffectiveDuration(curCfg.duration);
    /* 清晰排版：三行分块（当前档位｜档位对照｜金币奖励），不再堆一行长句 */
    const sugTxt =
      sug === cur
        ? '<span class="diff-sug-ok">✅ 当前时长正合适，继续保持</span>'
        : '<span class="diff-sug-up">💡 系统建议：' +
          sugCfg.icon +
          ' ' +
          sugCfg.name +
          '（' +
          getEasyModeEffectiveDuration(sugCfg.duration) +
          ' 分钟）' +
          (appData.settings.difficultyTouched ? '（想采纳就点对应档位）' : '') +
          '</span>';
    hint.innerHTML =
      '<div class="diff-line"><span class="diff-cur">当前档位：' +
      curCfg.icon +
      ' <b>' +
      curCfg.name +
      '（' +
      curEff +
      ' 分钟' +
      (curEff !== curCfg.duration ? '·轻松模式已减半' : '') +
      '）</b></span>' +
      sugTxt +
      '</div>' +
      '<div class="diff-line">选档位 = 定专注时长：' +
      DIFFICULTY_CONFIG.map(function (d) {
        const e = getEasyModeEffectiveDuration(d.duration);
        return (
          '<span class="diff-chip' +
          (d.key === cur ? ' diff-chip-on' : '') +
          '">' +
          d.icon +
          ' ' +
          e +
          '分·' +
          d.name +
          '</span>'
        );
      }).join(' ') +
      '</div>' +
      '<div class="diff-line">🪙 专注越久奖励越多：≥24 分钟 +2 · ≥48 分钟 +5 · ≥86 分钟 +10</div>';
  }
}
function setDifficulty(key) {
  const cfg = getDifficultyCfg(key);
  appData.settings.difficulty = key;
  /* 难度=时长档位：选中即设定单番茄时长（同步设置页输入框 + 守卫标志，防止下次 loadData 被重置回 25） */
  appData.settings.workDuration = cfg.duration;
  appData.settings.workDurationTouched = true;
  appData.settings.difficultyTouched = true; /* 手动锁定档位：开始专注严格按此时长，自适应推荐仅作提示 */
  const inp = document.getElementById('setWork');
  if (inp) inp.value = cfg.duration;
  /* idle 时立即同步计时器显示，专注中则下次开始生效 */
  if (timerState && timerState.mode === 'idle') {
    timerState.remaining = cfg.duration * 60;
    timerState.totalDuration = cfg.duration * 60;
  }
  saveData();
  renderDifficultyPicker();
  renderDurationSuggestion();
  updateTimerDisplay();
  showToast('已选「' + cfg.name + '」：单番茄 ' + cfg.duration + ' 分钟');
}
/* ---- 休息峰值 · 冷知识展示（替代呼吸引导，轻量文字，大脑真正转换） ---- */
function showRestFact() {
  if (!FUN_FACT_POOL || !FUN_FACT_POOL.length) return;
  const fact = FUN_FACT_POOL[Math.floor(Math.random() * FUN_FACT_POOL.length)];
  showToast('🧠 休息冷知识：' + fact, false);
}
/* ---- 结束仪式：休息结束时的鼓励语（峰终定律·带着正面情绪进入下一个番茄） ---- */
function showBreakEndRitual() {
  if (!appData.settings.adaptiveSuggest) return;
  const msg = ENCOURAGE_POOL[Math.floor(Math.random() * ENCOURAGE_POOL.length)];
  showToast(msg, true);
}
/* ---- 人机排行榜：名次 + 名字 + 段位 + 星数（简洁版，波动机制在 03 每日更新） ---- */
/* 排行榜渲染缓存（缓更新 + 懒加载）：数据未变化时跳过 DOM 重建；
   仅在切到「排行榜」子 tab 或打开弹窗时触发（懒加载，不在启动时全量渲染） */
let _lbRenderKey = null;
function renderLeaderboard() {
  let rows = null;
  try {
    rows = getLeaderboardRows();
  } catch (e) {
    /* 数据异常降级：不崩溃，显示空表 */
    if (window.__silent) window.__silent(e, '01e4:renderLeaderboard');
  }
  const list = document.getElementById('leaderboardList');
  if (!list) return;
  if (!rows) {
    list.innerHTML =
      '<div style="text-align:center;color:var(--text-light);padding:var(--sp-14);">排行榜数据异常，稍后自动恢复</div>';
    return;
  }
  /* key = 各行列序+星数+追星状态+观察期：未变化直接复用已渲染 DOM */
  const lb = appData.botLeaderboard;
  const key =
    rows
      .map(function (r) {
        return r.rank + ':' + r.stars;
      })
      .join('|') +
    ':' +
    (lb && lb.chaseMode ? 'C' : '') +
    (lb && lb.chaseLostStreak ? 'S' + lb.chaseLostStreak : '');
  if (key === _lbRenderKey) return;
  _lbRenderKey = key;
  let h = '';
  rows.forEach(function (r, i) {
    const tier = getBotTier(r.stars);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
    const me = r.isMe ? ' me' : '';
    h +=
      '<div class="lb-row' +
      me +
      '">' +
      '<span class="lb-rank">' +
      medal +
      '</span>' +
      '<span class="lb-name">' +
      r.emoji +
      ' ' +
      r.name +
      (r.isMe ? '（我）' : '') +
      '</span>' +
      '<span class="lb-tier" style="color:' +
      tier.color +
      ';">' +
      tier.icon +
      ' ' +
      tier.name +
      '</span>' +
      '<span class="lb-stars">' +
      r.stars +
      '⭐</span>' +
      '</div>';
  });
  list.innerHTML = h;
  /* 追星机制状态提示：榜首被追赶 / 被反超观察期 / 常态 */
  const desc = document.getElementById('lbDesc');
  if (desc) {
    const myRank = rows.find(function (x) {
      return x.isMe;
    }).rank;
    if (lb && lb.chaseMode && myRank === 1) {
      desc.innerHTML =
        '🔥 <b style="color:#E85D3A;">追星模式</b>：你稳居榜首，前 3 名对手正在全力追赶！躺平就会被反超，保持每日全勤才能守住王座。';
      desc.style.border = '1px dashed #E85D3A';
    } else if (lb && lb.chaseMode && myRank > 1) {
      desc.innerHTML =
        '🔥 <b style="color:#E85D3A;">追星观察期</b>：你被反超了！连续 ' +
        CHASE_LOST_DAYS +
        ' 天未夺回榜首，追星将结束（对手恢复常态）。';
      desc.style.border = '1px dashed #E85D3A';
    } else {
      desc.innerHTML =
        '8 位性格各异的「对手」每天都会上星或波动——摆烂的可能突然发力，努力的也可能状态低迷。<b>努力就能登顶，摸鱼就会被反超。</b>';
      desc.style.border = '';
    }
  }
}

/* ========== E4-02 左右滑动切换视图（整段可回退）==========
 * v2（E4-03 调整）：① 触发阈值 64→42px 更灵敏；② 首尾循环（设置→首页、首页→设置）；
 * ③ 屏幕左右边缘各留 24px 让出“系统返回手势/浏览器左右滑”，顶部 24px 让出下拉通知区，
 *    避免和系统/浏览器手势抢；④ 按钮/输入框/横滚区起手仍不触发。 */
(function () {
  const ORDER = ['timer', 'plan', 'log', 'stats', 'settings'];
  const EDGE_X = 34;   /* 左右边缘排除带：全面屏返回手势 & 浏览器前进/后退手势区
                          （24px 太窄——浏览器自己的边缘手势带约 20~30px，取 34 才不会两边同时响应） */
  const EDGE_Y = 24;   /* 顶部排除带：状态栏下拉手势区 */
  const MIN_DX = 42;   /* 触发灵敏度（原 64） */
  const MIN_DX_BTN = 64;/* 从按钮上起滑时的阈值：点按手抖不误切，横滑意图明确才切 */
  const DY_RATIO = 1.4;/* 竖滑明显时让位给页面滚动 */
  const GAP = 450;     /* 两次切换最小间隔 ms（原 550） */
  let _sx = null, _sy = null, _lastAt = 0, _fromBtn = false;
  /* 设置页可关：关掉后本手势整体退出，只能用底部导航切页（见 settings.swipeNav）。
     ★ 坑：appData 是 `let appData = ...` 声明的**顶层词法变量，不是 window 属性** ——
       写成 `window.appData` 永远是 undefined，开关就成了摆设（C50 ⑧ 抓到过）。
       用 typeof 守卫读它：脚本还没跑到 01b 时按「开」处理，别让手势失效。 */
  function _navOff() {
    try {
      if (typeof appData === 'undefined' || !appData || !appData.settings) return false;
      return appData.settings.swipeNav === false;
    } catch (e) { return false; }
  }
  function _isScrollX(el) {
    /* 只在「真的能横向滚」的容器上让位：必须 computed overflow-x 为 auto/scroll。
       ★ 坑：只看 scrollWidth > clientWidth 会把「内容溢出但被 overflow:hidden 裁掉」的元素
         也算成横滚区（高字号下被挤爆的卡片/胶囊就是这种）。滑动起手落在这些元素上时，
         翻页手势被整段排除 → 症状是「明明在屏幕中间滑，却怎么也不切页」。 */
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.classList && n.classList.contains('nav-item')) return true;
      const ox = getComputedStyle(n).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 12) return true;
    }
    return false;
  }
  function _isInteractZone(el) {
    /* 只排除“横滑有别的用途或必然误触”的区域：
       表单输入 / 开关滑块 / 横向可滚动容器 / 计划卡 / 习惯卡（原生手势=完成/展开）。
       按钮不再硬排除——点按无位移不触发翻页，横滑足够远才算翻页（见 MIN_DX_BTN）。 */
    return !!(el && el.closest && el.closest(
      'input, textarea, select, [contenteditable], .slider, .wheel, .range-slider, .todo-item, .habit-item, .tb-paper, #tbShell'));
  }
  function _fromButton(el) {
    return !!(el && el.closest && el.closest('button, [role=button]'));
  }
  function _inNoGoZone(x, y) {
    const W = document.documentElement.clientWidth || window.innerWidth || 0;
    return x < EDGE_X || (W > 0 && x > W - EDGE_X) || y < EDGE_Y;
  }
  document.addEventListener('touchstart', function (e) {
    if (_navOff()) { _sx = null; return; }
    if (e.touches && e.touches.length === 1) {
      const t = e.target;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      if (_inNoGoZone(x, y) || _isInteractZone(t) || _isScrollX(t)) { _sx = null; return; }
      /* 尊重项目原生手势（01g bindSwipe 已完成动作/展开、initTouchDrag 长按重排）：
         若其已在占用横向手势锁，本次触摸不参与翻页。 */
      if (typeof _gestureLock !== 'undefined' && _gestureLock === 'h') { _sx = null; return; }
      _fromBtn = _fromButton(t);
      _sx = x; _sy = y;
    }
  }, { passive: true });
  /* 滑动中途若原生手势系统抢占了横滑（touchmove 里 01g 会置 _gestureLock='h' 并 preventDefault），
     本翻页手势立即作废，避免“卡片右滑完成计划”的同时页面被切走。 */
  document.addEventListener('touchmove', function (e) {
    if (_sx !== null && typeof _gestureLock !== 'undefined' && _gestureLock === 'h') {
      _sx = null; _sy = null; _fromBtn = false;
    }
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (_sx === null || !e.changedTouches || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - _sx;
    const dy = e.changedTouches[0].clientY - _sy;
    const btn = _fromBtn;
    _sx = null; _sy = null; _fromBtn = false;
    const need = btn ? MIN_DX_BTN : MIN_DX;
    if (Math.abs(dx) < need || Math.abs(dx) < Math.abs(dy) * DY_RATIO) return;
    const now = Date.now();
    if (now - _lastAt < GAP) return;
    const active = document.querySelector('.nav-item.active');
    const cur = active && active.dataset ? active.dataset.view : 'timer';
    const idx = ORDER.indexOf(cur);
    if (idx < 0) return;
    const L = ORDER.length;
    let next = null;
    if (dx < 0) next = ORDER[(idx + 1) % L];        /* 左滑：下一页；设置→首页循环 */
    else if (dx > 0) next = ORDER[(idx - 1 + L) % L]; /* 右滑：上一页；首页→设置循环 */
    _lastAt = now;
    switchView(next);
  }, { passive: true });
})();
