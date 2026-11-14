/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01e_engine_ui.js 按域拆出（2026-11-14 · S3，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；JS 包只在新增文件边界多 1 个空语句（tools/group_split.py 的拼接符 "\n;\n"，长度不变）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01eP_ui_view.js
 * 分组：ui
 * 职责：记住上次看的视图
 * 功能：
 *   - 记住上次看的视图
 * 函数索引（TOC）：tbOnViewSwitch/_fireViewSwitchHooks/rememberLastView/restoreLastView/switchView/switchViewCore/switchStatsSubTab/setWorkPreset/updateChromeTheme/toggleHour12/systemFontBoost/applyFontScale（+19 更多）
 * ============================================================ */

/* ================= 视图切换钩子（前 / 后两相）=================
   为什么要有它：此前有 4 个模块**各自包装** window.switchView ——
   01g 同步桌面侧边栏 / 02 兜底刷统计图 / 05 存展开中的计划（切前）+ stats 折卡回收（切后）/
   0B 同步 hash。谁先包谁后包由 <script> 顺序决定（隐性依赖），加第 5 个得先读懂全部 4 个；
   而且「切前要做」和「切后要做」混在同一个包装里，看调用点分不出先后。
   现改为：switchView 自己按序触发钩子，各模块只注册自己那一件事。
     phase 'before' —— 原视图还没切走（适合保存正在编辑的状态）
     phase 'after'  —— 已切完（适合刷新 UI / 写 hash）
   ★ 钩子按**注册顺序**执行（= 各文件的加载顺序），与旧包装的嵌套执行顺序一致；
   ★ 钩子异常只跳过自身（__silent 上报），绝不阻断切换；
   ★ after 钩子放在 **finally** 里触发 —— 与旧包装「apply 之后无条件执行」等价
     （01g 原来的包装就是 try/finally：切换出错也要把侧边栏同步好）。 */
const _viewSwitchBefore = [];
const _viewSwitchAfter = [];
function tbOnViewSwitch(fn, phase) {
  if (typeof fn !== 'function') return;
  (phase === 'before' ? _viewSwitchBefore : _viewSwitchAfter).push(fn);
}
function _fireViewSwitchHooks(list, view) {
  for (let i = 0; i < list.length; i++) {
    try {
      list[i](view);
    } catch (e) { if (window.__silent) window.__silent(e, '01e:viewSwitchHook'); }
  }
}
/* ===== 记住上次看的视图 =====
   需求：「我选着选择计划呢，突然就变成那个计时界面了」。
   地址栏 hash 是关着写的（0B WRITE_HASH=false），所以页面一旦被系统回收后重载，
   视图必然回到默认的计时页 —— 人还在计划页，回来就成了计时器，像是数据自己回滚了。
   → 每次切页记一个视图名，冷启动时若地址栏没指定就回到那一页。 */
const LAST_VIEW_KEY = 'tf_last_view';
function rememberLastView(view) {
  try {
    if (!view) return;
    TFStorage.write(LAST_VIEW_KEY, String(view));
  } catch (e) { if (window.__silent) window.__silent(e, '01e:rememberLastView'); }
}
function restoreLastView() {
  try {
    /* 地址栏带 hash（分享来的链接 / 前进后退）优先，别抢它的目标页 */
    const h = String(location.hash || '').replace(/^#/, '');
    if (h && document.getElementById('view-' + h)) return false;
    const v = TFStorage.read(LAST_VIEW_KEY);
    if (!v || !document.getElementById('view-' + v)) return false;
    const act = document.querySelector('.view.active');
    if (act && act.id === 'view-' + v) return false;
    switchView(v);
    return true;
  } catch (e) {
    if (window.__silent) window.__silent(e, '01e:restoreLastView');
    return false;
  }
}
/** 视图切换：触发切前钩子 → 正文（switchViewCore）→ 切后钩子。 */
function switchView(view) {
  _fireViewSwitchHooks(_viewSwitchBefore, view);
  try {
    switchViewCore(view);
  } finally {
    _fireViewSwitchHooks(_viewSwitchAfter, view);
    rememberLastView(view);
  }
}
function switchViewCore(view) {
  if (currentLogTab === 'diary') {
    if (diaryViewMode === 'single' && currentDiaryDate) forceSaveDiary(currentDiaryDate);
  }
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  /* 轻量换页过渡：新视图淡入+微位移（180ms，不堆叠） */
  (function () {
    const _vv = document.getElementById('view-' + view);
    if (_vv) { _vv.classList.remove('view-in'); void _vv.offsetWidth; _vv.classList.add('view-in'); }
  })();
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  /* 日志页逐天跳转箭头：仅「日志-专注记录」视图显示，其他视图一律隐藏 */
  const _la = document.getElementById('logJumpArrow');
  if (_la) _la.style.display = view === 'log' && currentLogTab === 'focus' ? 'flex' : 'none';
  if (view === 'plan') {
    renderPlanCountdowns();
    renderTodos();
    renderHabits();
    try {
      renderPlanMustRows();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:switchView'); }
  }
  if (view === 'log') renderLogs();
  if (view === 'stats') {
    switchStatsSubTab('data');
    renderTeamSystem();
  } /* 每次进入统计页默认「数据分析」 */
  if (view === 'timer') {
    refreshTodoSelect();
    /* 切回计时页要重画子任务卡：否则刷新/切走再回来，卡就没了 */
    renderTimerSubs();
    renderTimerBadge();
    renderTimerTree();
    updateFreeInfo();
  }
  /* 新手引导条只属于计时页 —— 切页时同步显隐，
     否则「点习惯」看到的会是讲番茄钟的引导，误以为跳错了界面 */
  try {
    syncGuideVisibility();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:switchView'); }
  /* 用户主动切换界面 = 用行动表达"我要用功能，不看公告了"。
     渐进解锁公告层虽 pointer-events:none 可穿透点击，但半透明遮罩仍视觉挡页；
     若用户不等公告自己消失就切页，视为已读并收起，避免"切到哪都盖一层"的困惑。
     只在公告确实打开时动手，没弹过/已关过则完全无副作用。 */
  try {
    const _ja = document.getElementById('jyAnn');
    if (_ja && _ja.classList.contains('jy-open')) {
      _ja.classList.remove('jy-open');
      const _ja2 = document.getElementById('jyAnn2');
      if (_ja2) _ja2.classList.remove('jy-open');
      if (typeof appData !== 'undefined' && appData && appData.uiPrefs) {
        appData.uiPrefs.annSeen = true;
        saveData();
      }
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01e:switchView'); }
}
function switchStatsSubTab(tab) {
  document.getElementById('statsDataView').style.display = tab === 'data' ? 'block' : 'none';
  document.getElementById('statsTreeView').style.display = tab === 'tree' ? 'block' : 'none';
  document.getElementById('statsRankView').style.display = tab === 'rank' ? 'block' : 'none';
  document.getElementById('statsAchView').style.display = tab === 'ach' ? 'block' : 'none';
  const lbv = document.getElementById('statsLbView');
  if (lbv) lbv.style.display = tab === 'lb' ? 'block' : 'none';
  document.querySelectorAll('#statsSubNav .stats-nav-item').forEach(function (n) {
    n.classList.toggle('current', n.dataset.tab === tab);
  });
  if (tab !== 'data') {
    renderStats();
    renderTeamSystem();
  }
  if (tab === 'tree') {
    renderTimerTree();
  }
  if (tab === 'lb') {
    renderLeaderboard();
  }
  if (tab === 'data') {
    renderStats();
  }
}
/* 单番茄时长预设快捷设置（预设=难度档位：10简单/25中等/50沉浸式；其他自定义值按区间映射难度） */
function setWorkPreset(m) {
  const inp = document.getElementById('setWork');
  if (inp) inp.value = m;
  appData.settings.workDuration = m;
  appData.settings.workDurationTouched = true;
  appData.settings.difficultyTouched = true; /* 手动设定时长：同样视为主动选择，自适应推荐不再覆盖 */
  /* 难度档位跟随时长反向同步，保持「时长=难度档位」一致 */
  appData.settings.difficulty = getDifficultyByDuration(m);
  renderDifficultyPicker();
  /* idle 时立即同步计时器显示，专注中则下次开始生效 */
  if (timerState && timerState.mode === 'idle') {
    timerState.remaining = m * 60;
    timerState.totalDuration = m * 60;
  }
  saveData();
  updateTimerDisplay();
  const _dc = getDifficultyCfg(appData.settings.difficulty);
  showToast(
    '单番茄时长 ' + m + ' 分钟 · ' + _dc.icon + _dc.name + '档 · 完成后' + finishTypePlanText(m) + '（25分钟=1 折算）'
  );
}
/* 浏览器状态栏/地址栏颜色：浅色 #1A2440、深色 #141A30，动态设置让 Via 等浏览器实时跟随，避免状态栏残留红色 */
function updateChromeTheme() {
  const dark = document.body.classList.contains('dark-mode');
  const color = dark ? '#141A30' : '#1A2440';
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', color);
  try {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) { if (window.__silent) window.__silent(e, '01e:updateChromeTheme'); }
}
/* 12 小时制开关：改设置 → 重新落盘 → 强制重画所有含时间的列表
   （计划行 todoRowSig、日志 _logSig 都是脏检查，不强制就会留着旧时制） */
function toggleHour12(el) {
  appData.settings.hour12 = !!(el && el.checked);
  setHour12(appData.settings.hour12);
  saveSettings();
  try {
    const tl = document.getElementById('todoList');
    if (tl) tl.innerHTML = '';
    renderTodos();
    renderHabitRemind();
    _logSig = null;                                   /* 绕开日志脏检查 */
    const ll = document.getElementById('logList');
    if (ll) ll.innerHTML = '';
    renderLogs();
  } catch (e) { if (window.__silent) window.__silent(e, 'toggleHour12'); }
}
/* 系统字号归一（--fs-boost）：
   手机上的 WebView / 各种"H5 浏览器"可以把「系统字体大小 / 网页字体大小」再加一层缩放。
   它只乘 font-size，不乘 width/height/padding —— 于是字撑破卡片、折行、横向溢出，
   看起来就像"浏览器强行双指放大"，而不是界面变大；顺带把滑动手势的横滚判定搅乱。
   CSS 的 text-size-adjust 拦不住它（100%/none 实测都无效），原生 App 的标准做法是
   WebSettings.setTextZoom(100) 把它关掉；纯网页只能量出来再除回去。
   ★ 量一次、只认 1.05~3 之间的系数，桌面/无缩放环境量到 1 → boost = 1，等于没这回事。 */
let _sysFontBoost = null;
function systemFontBoost() {
  if (_sysFontBoost !== null) return _sysFontBoost;
  let k = 1;
  try {
    const host = document.body || document.documentElement;
    const p = document.createElement('div');
    p.setAttribute('aria-hidden', 'true');
    /* 探针必须用字面 px，不能走 --fs-* 令牌（否则量的是自己写进去的值） */
    p.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;font-size:100px;line-height:1;';
    p.textContent = 'M';
    host.appendChild(p);
    const used = parseFloat(getComputedStyle(p).fontSize);
    p.remove();
    if (isFinite(used) && used > 0) k = used / 100;
  } catch (e) { if (window.__silent) window.__silent(e, '01e:systemFontBoost'); }
  _sysFontBoost = (k > 1.05 && k < 3) ? (1 / k) : 1;
  return _sysFontBoost;
}
/* 字号缩放（设置页「字号大小」）：**只放大文字，不改布局**。
   ★ 落法是给 <html> 写 --fs-user，只有 --fs-* 字号令牌乘它；
     width/height/padding/圆角/间距一分不动 —— 放大只影响可读性，一屏看到的行数不变。
     （这正是「整页 zoom」做不到的：zoom 把盒子一起放大，屏上内容会跟着变少。）
   ★ 代价是"字大了、盒子没跟着大"，所以每一档都不能把文字挤出容器 ——
     这条由冒烟 C51（各档不横向溢出）守着。
   ★ --fs-boost 是另一件事（抵掉系统字体缩放），两者各自独立、互不覆盖。
   档位/范围这类"数字口径"在 00_pure_core（FONT_SCALE_STEPS / normFontScale），
   本函数只做三件事：落 DOM + 归一系统字号 + 把下拉回填到当前档位。 */
function applyFontScale(factor) {
  const f = normFontScale(factor);
  try {
    const root = document.documentElement;
    root.style.setProperty('--fs-user', String(f));
    root.style.setProperty('--fs-boost', String(systemFontBoost()));
  } catch (e) { if (window.__silent) window.__silent(e, '01e:applyFontScale'); }
  const sel = document.getElementById('setFontScale');
  if (sel) {
    const steps = typeof FONT_SCALE_STEPS !== 'undefined' ? FONT_SCALE_STEPS : [];
    let hit = steps.length ? steps[0].key : '';
    for (let i = 0; i < steps.length; i++) {
      if (Math.abs(steps[i].factor - f) < 0.001) hit = steps[i].key;
    }
    sel.value = hit;
  }
  return f;
}
/* 设置页下拉 onchange：写设置 → 立即生效 → 落盘 */
function setFontScale(key) {
  const meta = fontScaleMeta(key);
  appData.settings.fontScale = meta.factor;
  applyFontScale(meta.factor);
  saveDataNow();
  saveSettings();
  showToast('🔠 字号：' + meta.label, true);
}
function applySettingsToUI() {
  const s = appData.settings;
  /* 字号先于其它设置生效：它写的是全站 CSS 变量，越早写越好（避免首帧用旧字号）。 */
  applyFontScale(s.fontScale);
  document.getElementById('setWork').value = s.workDuration;
  document.getElementById('setShortBreak').value = s.shortBreak;
  document.getElementById('setLongBreak').value = s.longBreak;
  document.getElementById('setLongInterval').value = s.longInterval;
  document.getElementById('setBufferTime').value = s.bufferTime;
  document.getElementById('setLongForce').checked = s.longBreakForce;
  document.getElementById('setInterruptTolerance').value = s.interruptTolerance;
  document.getElementById('setMicroBreak').checked = s.microBreak;
  document.getElementById('setMicroMode').value = s.microMode;
  document.getElementById('setMicroInterval').value = s.microInterval;
  document.getElementById('setMicroMin').value = s.microMin;
  document.getElementById('setMicroMax').value = s.microMax;
  document.getElementById('setMicroDuration').value = s.microDuration;
  document.getElementById('setMicroMinGap').value = s.microMinGap;
  document.getElementById('setNotify').checked = s.notify;
  /* 通知权限的实际状态（已授权 / 被拒 / 不支持）每次回填设置时都重画一遍 ——
     这个状态不归 appData 管，是浏览器的，用户随时可能在外面改掉。 */
  try { renderNotifyPermRow(); } catch (e) { if (window.__silent) window.__silent(e, '01e:renderNotifyPermRow'); }
  document.getElementById('setSound').checked = s.sound;
  const _ne = document.getElementById('setNearEndSound');
  if (_ne) _ne.checked = s.nearEndSound !== false;
  const _nl = document.getElementById('setNotifyLive');
  if (_nl) _nl.checked = s.notifyLive !== false;
  const _dc = document.getElementById('setDarkMode');
  if (_dc) _dc.checked = !!s.darkMode;
  if (s.darkMode) document.body.classList.add('dark-mode');
  /* 回填主题色卡。设置页 HTML 可能晚于引擎初始化插入，
     故这里兜底再渲染一次，并把选中态与已存主题对齐（幂等）。 */
  if (window.themeEngine) {
    if (typeof themeEngine.applyTheme === 'function') themeEngine.applyTheme(s.theme || 'default');
    if (typeof themeEngine.renderCards === 'function') themeEngine.renderCards();
  }
  const _imf = document.getElementById('setImmersive');
  if (_imf) _imf.checked = !!s.immersiveFocus;
  const _ifc = document.getElementById('imFixedChance');
  if (_ifc) {
    const _fcv =
      appData.immersiveFocus && typeof appData.immersiveFocus.fixedChance === 'number'
        ? appData.immersiveFocus.fixedChance
        : 0.4;
    const _pct = Math.min(IM_FIXED_CHANCE_MAX, Math.round(_fcv * 100));
    _ifc.value = _pct;
    const _ifcl = document.getElementById('imFixedChanceVal');
    if (_ifcl) _ifcl.textContent = _pct + '%';
  }
  const _gh = document.getElementById('setGhostEnabled');
  if (_gh) _gh.checked = s.ghostEnabled !== false;
  const _ads = document.getElementById('setAdaptiveSuggest');
  if (_ads) _ads.checked = s.adaptiveSuggest !== false;
  const _mim = document.getElementById('setMinimalMode');
  if (_mim) _mim.checked = !!s.minimalMode;
  const _h12el = document.getElementById('setHour12');
  if (_h12el) _h12el.checked = appData.settings.hour12 !== false;
  setHour12(appData.settings.hour12 !== false);
  const _swn = document.getElementById('setSwipeNav');
  if (_swn) _swn.checked = s.swipeNav !== false;
  const _se2 = document.getElementById('setSfxEnabled');
  if (_se2) _se2.checked = s.sfxEnabled !== false;
  const _bgp = document.getElementById('setBgPause');
  if (_bgp) _bgp.checked = !!s.bgPause;
  const _sv = document.getElementById('setSfxVolume');
  if (_sv) {
    _sv.value = s.sfxVolume != null ? s.sfxVolume : 1.0;
    const _lb = document.getElementById('sfxVolLabel');
    if (_lb) _lb.textContent = Math.round((s.sfxVolume != null ? s.sfxVolume : 1.0) * 100) + '%';
  }
  applyFreeModeBtn();
}
function saveSettings() {
  const _wNew = parseInt(document.getElementById('setWork').value) || 25;
  const _wChanged = _wNew !== appData.settings.workDuration;
  /* 手动改输入框时长=主动选择，自适应推荐不再覆盖 */ appData.settings = {
    workDuration: _wNew,
    workDurationTouched: true,
    shortBreak: parseInt(document.getElementById('setShortBreak').value) || 5,
    longBreak: parseInt(document.getElementById('setLongBreak').value) || 20,
    longInterval: parseInt(document.getElementById('setLongInterval').value) || 4,
    bufferTime: parseInt(document.getElementById('setBufferTime').value) || 30,
    longBreakForce: document.getElementById('setLongForce').checked,
    interruptTolerance: parseInt(document.getElementById('setInterruptTolerance').value) || 5,
    microBreak: document.getElementById('setMicroBreak').checked,
    microMode: document.getElementById('setMicroMode').value,
    microInterval: parseInt(document.getElementById('setMicroInterval').value) || 5,
    microMin: parseInt(document.getElementById('setMicroMin').value) || 3,
    microMax: parseInt(document.getElementById('setMicroMax').value) || 5,
    microDuration: parseInt(document.getElementById('setMicroDuration').value) || 10,
    microMinGap: parseInt(document.getElementById('setMicroMinGap').value) || 2,
    notify: document.getElementById('setNotify').checked,
    notifyLive: document.getElementById('setNotifyLive')
      ? document.getElementById('setNotifyLive').checked
      : appData.settings.notifyLive !== false,
    sound: document.getElementById('setSound').checked,
    nearEndSound: document.getElementById('setNearEndSound')
      ? document.getElementById('setNearEndSound').checked
      : appData.settings.nearEndSound !== false,
    fuzzyTimer: appData.settings.fuzzyTimer,
    hour12: document.getElementById('setHour12')
      ? document.getElementById('setHour12').checked
      : appData.settings.hour12 !== false,
    darkMode: document.getElementById('setDarkMode').checked,
    immersiveFocus: document.getElementById('setImmersive')
      ? document.getElementById('setImmersive').checked
      : !!appData.settings.immersiveFocus,
    adaptiveSuggest: document.getElementById('setAdaptiveSuggest')
      ? document.getElementById('setAdaptiveSuggest').checked
      : appData.settings.adaptiveSuggest !== false,
    minimalMode: document.getElementById('setMinimalMode')
      ? document.getElementById('setMinimalMode').checked
      : !!appData.settings.minimalMode,
    sfxEnabled: document.getElementById('setSfxEnabled')
      ? document.getElementById('setSfxEnabled').checked
      : appData.settings.sfxEnabled !== false,
    bgPause: document.getElementById('setBgPause')
      ? document.getElementById('setBgPause').checked
      : !!appData.settings.bgPause,
    sfxVolume: parseFloat(
      document.getElementById('setSfxVolume')
        ? document.getElementById('setSfxVolume').value
        : appData.settings.sfxVolume != null
          ? appData.settings.sfxVolume
          : 1.0
    ),
    difficulty: appData.settings.difficulty || 'medium',
    /* 字号只由设置页的下拉驱动（没有 select 时保留旧值，别在别处把它洗掉） */
    fontScale: normFontScale(appData.settings.fontScale),
    difficultyTouched: appData.settings.difficultyTouched === true || _wChanged,
    /* 主题 id 不来自 DOM 控件（由 themeEngine 色卡直接写入 appData），
       此处原样透传；若为 undefined 则回落 default，避免被重建时抹掉。 */
    theme: appData.settings.theme || 'default',
    /* 左右滑动切视图；控件不在（老页面）就保留旧值，别在重建时洗掉 */
    swipeNav: document.getElementById('setSwipeNav')
      ? document.getElementById('setSwipeNav').checked
      : appData.settings.swipeNav !== false
  };
  /* 难度档位跟随时长反向同步（自定义时长按区间映射：≤15简单/16~35中等/>35沉浸式），保持「时长=难度=倍率」三位一体 */ appData.settings.difficulty =
    getDifficultyByDuration(appData.settings.workDuration);
  renderDifficultyPicker();
  saveData();
  updateMicroModeUI();
  updateTimerDisplay();
  renderImmersiveProgress();
  renderDurationSuggestion();
  applyFreeModeBtn();
}
function updateMicroModeUI() {
  const mode = appData.settings.microMode;
  document.getElementById('rowMicroFixed').style.display = mode === 'fixed' ? 'flex' : 'none';
  document.getElementById('rowMicroRandom').style.display = mode === 'random' ? 'flex' : 'none';
}
function toggleNotify(el) {
  saveSettings();
  if (el.checked && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(function () { renderNotifyPermRow(); });
  } else {
    renderNotifyPermRow();
  }
}

/* ============================================================
   通知权限状态行
   ------------------------------------------------------------
   为什么需要这块：Chrome 的权限提示**每个站点只弹一次**。用户第一次进来
   随手点了「阻止」，之后 requestPermission() 会直接返回 'denied'，不再弹框，
   代码里四五个 `permission === 'default'` 的判断全部失效 —— 开关还亮着、
   设置里什么都没变，但再也不会有任何通知。以前网页对此只有一个「不弹」，
   用户完全无从知道发生了什么，更不知道去哪里改回来。
   ★ 所以这里做三件事：①把真实状态写在开关下面；②能重弹就重弹；
     ③不能重弹就给出该浏览器里具体点哪里（不同浏览器路径不一样，不能只写
     一句「去浏览器设置」——那等于没写）。
   ============================================================ */
function notifyPermState() {
  if (!('Notification' in window) || typeof Notification === 'undefined') return 'unsupported';
  /* iOS Safari 只有装到主屏幕（standalone）后才支持通知，普通标签页里没有 Notification */
  var p = Notification.permission;
  if (p === 'granted') return 'granted';
  if (p === 'denied') return 'denied';
  return 'default';
}
function notifyPermSteps() {
  var ua = navigator.userAgent || '';
  var isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua);
  var isEdge = /Edg\//.test(ua);
  var isFirefox = /Firefox\//.test(ua);
  var isiOS = /iPhone|iPad|iPod/.test(ua);
  if (isiOS) {
    return 'iOS 需要先「添加到主屏幕」，再从主屏幕图标打开才支持通知；然后在 设置 → 通知 → 瓶子专注 里打开。';
  }
  if (isFirefox) {
    return '点地址栏左边的 🔒 图标 → 连接 → 更多信息 → 权限 → 通知 → 允许，然后刷新页面。';
  }
  if (isEdge) {
    return '点地址栏左边的 🔒(或 ⓘ) 图标 → 权限 → 通知 → 允许，然后刷新页面。';
  }
  if (isChrome) {
    return '点地址栏左边的 🔒(或 ⓘ/⚙) 图标 → 权限 → 通知 → 允许，然后刷新页面。' +
      '也可以在 Chrome 的 设置 → 网站设置 → 通知 里找到本网站改回来。';
  }
  return '在浏览器的「网站设置 / 站点权限」里把「通知」改成允许，然后刷新页面。';
}
function renderNotifyPermRow() {
  var host = document.getElementById('notifyPermRow');
  /* 设置页的 HTML 可能晚于引擎初始化插入，找不到就先不动 —— 回填设置时会再调一次 */
  if (!host) return;
  var st = notifyPermState();
  var txt = '';
  var btn = '';
  if (st === 'granted') {
    txt = '✅ 已授权，通知可以正常送达';
    btn = '';
  } else if (st === 'default') {
    txt = '还没决定。点右边按钮申请，浏览器会弹一次授权框';
    btn = '申请权限';
  } else if (st === 'denied') {
    txt = '⚠️ 已被拒绝，浏览器不会再弹授权框，' + notifyPermSteps();
    btn = '再试一次';
  } else {
    txt = '这个浏览器不支持网页通知（或当前不是安全连接）。换成 Chrome / Edge 打开本页即可。';
    btn = '';
  }
  var label = document.getElementById('notifyPermText');
  var b = document.getElementById('notifyPermBtn');
  if (label) label.textContent = txt;
  if (b) {
    b.style.display = btn ? '' : 'none';
    b.textContent = btn;
  }
  host.style.display = '';
}
function askNotifyPermAgain() {
  var st = notifyPermState();
  if (st === 'unsupported') {
    showToast('这个浏览器不支持网页通知');
    return;
  }
  if (st === 'denied') {
    /* 已经被拒的情况下 requestPermission() 不会弹框，只会立刻返回 denied。
       所以这里不假装能申请，直接把路指清楚 —— 装能改的地方在浏览器自己那儿。 */
    showToast('这个网站的权限已被阻止，只能到浏览器设置里改回来');
    var label = document.getElementById('notifyPermText');
    if (label && label.scrollIntoView) label.scrollIntoView({ block: 'center' });
    return;
  }
  if (st === 'granted') {
    showToast('已经授权了，不用再申请');
    return;
  }
  Notification.requestPermission().then(function (r) {
    renderNotifyPermRow();
    if (r === 'granted') showToast('✅ 通知已开启，锁屏也能收到提醒');
    else if (r === 'denied') showToast('被拒绝了，之后只能在浏览器设置里改回来');
  });
}
/* 发一条测试通知 —— 用来区分「权限没给」和「代码没发」。
   点下去如果什么都没出现，说明是浏览器/系统层面拦掉了（权限、免打扰、
   Chrome 的通知总开关、系统应用通知被静音），不是定时逻辑的问题。 */
function sendTestNotify() {
  var st = notifyPermState();
  if (st === 'unsupported') {
    showToast('这个浏览器不支持网页通知（安卓上的 VIA 就不支持，换 Chrome）');
    return;
  }
  if (st === 'denied') {
    showToast('通知权限已被阻止，先按上面提示到浏览器设置里改回来');
    return;
  }
  var go = function () {
    /* 测试按钮要能看见「发了」这件事，所以绕过 notify() 里的开关判断，
       直接走和正式通知同一条链路（SW showNotification），否则测不到真问题。 */
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      showToast('还是没有权限，浏览器没有给出授权');
      return;
    }
    var payload = {
      body: '如果你看到这条，说明通知链路是通的 ✓',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'pomo-test',
      renotify: true,
      data: { kind: 'test', ts: Date.now() }
    };
    var sw = navigator.serviceWorker;
    if (sw && sw.ready && typeof sw.ready.then === 'function') {
      sw.ready.then(function (reg) {
        if (reg && typeof reg.showNotification === 'function') {
          return reg.showNotification('测试通知 · 瓶子专注', payload);
        }
        throw new Error('no sw');
      }).then(function () {
        showToast('已发送，看看通知栏 / 锁屏');
      }).catch(function (e) {
        showToast('发送失败：' + (e && e.message ? e.message : e));
      });
      return;
    }
    try {
      new Notification('测试通知 · 瓶子专注', { body: payload.body, tag: 'pomo-test' });
      showToast('已发送（旧式通知）');
    } catch (e) {
      showToast('发送失败：' + (e && e.message ? e.message : e));
    }
  };
  if (st === 'default') {
    Notification.requestPermission().then(function (r) {
      renderNotifyPermRow();
      if (r === 'granted') go();
      else showToast('没有授权，通知发不出去');
    });
    return;
  }
  go();
}
/* 注意：这里**不需要**手写 window.xxx = xxx。
   tools/gen_bridge.js 在构建时为每个顶层声明自动生成 window 访问器，
   手写一遍就是第二份赋值来源（同一件事两份实现），而且 setter 会被覆盖掉。
   renderNotifyPermRow 等只在模块内调用，走自动桥即可。 */

/* 把权限状态行插到「系统通知」那一行的紧后面。
   为什么不写进模板：模板里每个节点都带 pnid 标记、进 ID 对账，为一行提示去动
   3000 行的模板不划算；这类「运行时才知道状态」的行本来就是运行时画的
   （安装行 W8InstallRow 也是这个路子）。 */
function injectNotifyPermRow() {
  if (document.getElementById('notifyPermRow')) { renderNotifyPermRow(); return true; }
  var sw = document.getElementById('setNotify');
  if (!sw) return false;
  var row = sw.closest ? sw.closest('.setting-row') : null;
  if (!row || !row.parentNode) return false;
  var box = document.createElement('div');
  box.className = 'setting-row';
  box.id = 'notifyPermRow';
  box.style.display = 'none';
  var txt = document.createElement('div');
  txt.className = 'setting-desc';
  txt.id = 'notifyPermText';
  var btn = document.createElement('button');
  btn.id = 'notifyPermBtn';
  btn.className = 'btn-small';
  btn.type = 'button';
  btn.onclick = askNotifyPermAgain;
  /* 「发一条测试通知」始终存在：这是用户唯一能自证「到底通不通」的东西。
     原来只有被拒时才有按钮，而恰好已授权、却因为系统静音 / 免打扰收不到的情况
     最需要它 —— 那时候页面看起来一切正常，用户完全无从判断。 */
  var testBtn = document.createElement('button');
  testBtn.id = 'notifyTestBtn';
  testBtn.className = 'btn-small';
  testBtn.type = 'button';
  testBtn.textContent = '发一条测试通知';
  testBtn.onclick = sendTestNotify;
  var btnRow = document.createElement('div');
  btnRow.className = 'notify-perm-btns';
  box.appendChild(txt);
  btnRow.appendChild(btn);
  btnRow.appendChild(testBtn);
  box.appendChild(btnRow);
  row.parentNode.insertBefore(box, row.nextSibling);
  renderNotifyPermRow();
  return true;
}
/* 设置页可能在引擎初始化之后才被插入 DOM，所以不能只调一次：先试一次，
   再在 DOMContentLoaded 与「首帧之后」各补一次（都是幂等的，已存在就直接重画）。 */
try {
  if (!injectNotifyPermRow()) {
    document.addEventListener('DOMContentLoaded', function () { injectNotifyPermRow(); });
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () { injectNotifyPermRow(); });
    }
    setTimeout(function () { injectNotifyPermRow(); }, 1200);
  }
} catch (e) { if (window.__silent) window.__silent(e, '01e:injectNotifyPermRow'); }
function toggleDarkMode(on) {
  saveSettings();
  /* 立即同步写入设置 */
  saveDataNow();
  if (on) document.body.classList.add('dark-mode');
  else document.body.classList.remove('dark-mode');
  updateChromeTheme();
  /* ★ 日程表色块分浅/深两套色档（深色纸底上不能再用奶油底的浅粉块），
     其余页面靠 CSS 变量自动换色，只有这块是 JS 内联色 → 切主题必须重画一次。 */
  if (typeof renderTimeBlockGrid === 'function') {
    const planView = document.getElementById('view-plan');
    if (planView && planView.classList.contains('active')) renderTimeBlockGrid();
  }
  /* 不再自动刷新：深色切换即时生效（刷新在部分浏览器上反而会引发状态栏颜色残留问题） */
  /* 打「本条已由专属提示负责」的标记：通用回执见到就跳过。
     以前靠「400ms 内、且上一条 toast 文案里含开关名」来猜，一旦专属提示被
     _settleCollecting 收进结算队列，_lastToastMsg 就停在旧值，猜不中 → 一条动作弹两条。 */
  var _dm = document.getElementById('setDarkMode');
  if (_dm) _dm.dataset.toastOwned = '1';
  showToast(on ? '🌙 蓝调模式已开启' : '☀️ 已切回浅色', true);
}
function toggleGroup(name) {
  const group = document.querySelector(`.settings-group[data-group="${name}"]`);
  if (!group) return;
  group.classList.toggle(
    'collapsed'
  ); /* 折叠仅会话内生效：不写 groupStates、不 saveData；刷新/重启后设置页统一默认折叠 */
}
function scrollToSettingGroup(name) {
  const group = document.querySelector(`.settings-group[data-group="${name}"]`);
  if (!group) return;
  group.classList.remove('collapsed');
  appData.groupStates[name] = false;
  /* 等一帧：折叠组展开落位后再算位置，滚动更准 */
  requestAnimationFrame(function () {
    const vs = document.getElementById('view-settings');
    if (!vs || !vs.classList.contains('active')) return;
    /* 真正滚动的容器是 .main（overflow-y:auto），不是 #view-settings；
       桌面若窗口滚动则退回页面级 */
    let scroller = null;
    const mains = document.querySelectorAll('.main');
    for (let i = 0; i < mains.length; i++) {
      const m = mains[i];
      if (m.scrollHeight > m.clientHeight + 1) {
        scroller = m;
        break;
      }
    }
    const docScroller = document.scrollingElement || document.documentElement;
    if (!scroller && docScroller.scrollHeight > docScroller.clientHeight + 1) scroller = docScroller;
    if (!scroller) return;
    let top;
    if (scroller === docScroller || scroller === document.documentElement || scroller === document.body) {
      top = group.getBoundingClientRect().top + (window.pageYOffset || docScroller.scrollTop || 0) - 64;
    } else {
      top = group.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 64;
    }
    top = Math.max(0, top);
    try {
      scroller.scrollTo({ top: top, behavior: 'smooth' });
    } catch (e) {
      scroller.scrollTop = top;
    }
  });
}
function applyGroupStates() {
  document.querySelectorAll('.settings-group.foldable').forEach(g => {
    g.classList.add('collapsed');
  }); /* 设置页默认全部折叠；本会话手动展开的组保持展开，刷新/重进后恢复默认折叠 */
}
/* 固定副本概率上限 60%：保底 40% 留给随机剧本，避免玩家永远只刷固定副本 */
const IM_FIXED_CHANCE_MAX = 60;
function onImFixedChance(v) {
  const val = Math.max(0, Math.min(IM_FIXED_CHANCE_MAX, parseInt(v, 10) || 0));
  const lab = document.getElementById('imFixedChanceVal');
  if (lab) lab.textContent = val + '%';
  const st = appData.immersiveFocus;
  if (!st) return;
  st.fixedChance = val / 100;
  saveData();
}
/* 剧本抽取比例：默认折叠成一行标题，点开显示滑杆 */
function toggleImFixedPanel() {
  const panel = document.getElementById('imFixedPanel');
  const arrow = document.getElementById('imFixedHeadArrow');
  if (!panel) return;
  const open = panel.style.display !== 'flex';
  panel.style.display = open ? 'flex' : 'none';
  if (arrow) arrow.textContent = open ? '▼' : '▶';
}
function toggleNote(el) {
  const content = el.nextElementSibling;
  content.classList.toggle('show');
  el.textContent = content.classList.contains('show') ? '收起说明' : '展开说明';
}
let _roundSig = '';
function updateRoundStats() {
  const _rs = getRoundStats();
  const _rf = _rs.full, _rh = _rs.half, _ri = _rs.incomplete;
  const _empty = !_rf && !_rh && !_ri;
  const _line = document.getElementById('roundStatsLine');
  const _sess = document.getElementById('sessionInfo');
  /* 一轮还没记下任何东西时，「本轮：完整 0｜半个 0｜未完成 0」和「结束本轮」
     都只是在描述一个不存在的过去：页面下半屏还另有一份今日统计，
     两处并排放着三个 0，启动时第一屏读起来就是一张空表。
     什么都没发生时不给读数，也不给「结束」的动作入口。 */
  if (_line) {
    _line.style.display = _empty ? 'none' : '';
    if (_empty) {
      /* ★ 空态必须把旧内容清掉：只 display:none 会留下一段过期数字
         （上一轮「完整 1·半个 0」还挂在 DOM 里），读屏/导出/回归断言都会读到它，
         实测就出过「只有一条仅记录，却读到半个 1」。 */
      _line.innerHTML = '';
    } else {
      /* 分隔符从手打的全角竖线换成中圆点：之前「｜」正文同等粗细，
         三个数字被它切成三段柱状统计，看起来像排行榜而不是一句概述。 */
      _line.innerHTML =
        '<span class="full">完整 ' + _rf + '</span>'
        + '<span class="rs-dot">·</span><span class="half">半个 ' + _rh + '</span>'
        + '<span class="rs-dot">·</span><span class="incomplete">未完成 ' + _ri + '</span>';
    }
  }
  if (_sess) _sess.style.display = _empty ? 'none' : '';
  /* 本轮完整数变化时弹一下（DOM 重建后对新节点触发） */
  const _sig = _rf + '|' + _rh + '|' + _ri;
  if (_roundSig !== _sig) {
    _roundSig = _sig;
    const _f = document.querySelector('#roundStatsLine .full');
    if (_f && _rf) fxNumPop(_f);
  }
}
