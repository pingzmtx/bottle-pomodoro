/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * UI/渲染大头：被依赖≈588 / 引用他人≈827（当前耦合最重，属历史现状）。
 * 对外白名单=render 系 / show 系 / toggle 系 / switchView 等渲染与交互入口；
 * 红线：其他模块勿直读 _todoSig/expandedTodos/_settleMsgs 等本文件内部状态，
 * 勿复制本文件私有 helper（_el/_tagSafe…）；新 UI 一律走 registerComponent(08)。 */
/* ==================== 模块: 04-ui.js | 职责: 界面层——所有显示、渲染、弹窗、图表、海报 | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04-ui.js
 * 分组：ui
 * 职责：界面层——所有显示、渲染、弹窗、图表、海报
 * 功能：
 *   - 基础组件：toast 通知队列 / 弹窗 / 格子选择器 / 视图切换
 *   - 设置界面：applySettingsToUI / saveSettings / 主题 / 通知开关
 *   - 今日统计显示：updateTodayStats / updateRoundStats
 *   - 计划与习惯界面：待办增删改 / 排序 / 习惯渲染与打卡
 *   - 日志与记录：renderLogs / 日历跳转 / 筛选 / 记录详情编辑
 *   - 日记与倒计时：日记编辑自动保存 / 日历 / 搜索 / 倒数日
 *   - 白噪音：音轨播放 / 切换 / 音量
 *   - 统计图表：月/年统计 / 趋势图 / 区块分析 / 鼓励语
 *   - 树界面：计时陪伴树 / 树商店 / 物种图鉴 / 种植预览 / 成长里程碑
 *   - 树养成交互：树对话 treeTalk / 投喂 feedTree / 神秘任务面板 / 生命日志 / 扭蛋 triggerGacha / 宝箱 openChest / 转盘 spinShopChest / 礼包 showGift
 *   - 自定义皮肤与壁纸：皮肤商店渲染 / 图片 URL 录入 / 拖拽定位（openSkinDrag / bindSkinDragEvents / 缩放与偏移）/ 应用到树与计时器
 *   - 音效：playSound（供 02-timer.js 等模块调用）
 *   - 必做3件事面板：renderMustDoSection / openMustDoModal / 卡片放大与折叠
 *   - 金币兑换与组队倒计时：openCoinExchange / updateTeamCountdown
 *   - 段位界面：星路图 / 冲刺提示 / 段位渲染 / 荣耀特效
 *   - 组队界面：组队面板 / 历史 / 复制码
 *   - 海报生成：drawPoster 画布海报 / 主题 / 分享
 *   - 沉浸模式：专注沉浸切换
 *   - 沉浸式专注：设置开关渲染与调用点（界面实现已迁移至 06-immersive.js）
 *   - 白帽游戏化界面：极简模式切换 / 心流时长建议 / 难度选择器（档位=时长，选中即设定单番茄时长并反向同步）/ 休息冷知识 / 结束仪式 / 人机排行榜
 * 函数索引（TOC）：renderGridPicker/setGridValue/getGridValue/_refreshStateIcon/updateGridLabel/formatStateComparison/_cmpStr/showToast/_switchRowLabel/notifySwitchChanged/showSettleSummary/dismissSettle（+126 更多）
 * ============================================================ */

/* ===== 格子选择器函数 ===== */
function renderGridPicker(containerId, selectedValue, colorClass, readonly) {
  const c = document.getElementById(containerId);
  if (!c) return;
  if (readonly) c.classList.add('state-readonly');
  else c.classList.remove('state-readonly');
  c.dataset.color = colorClass || '';
  let h = '';
  for (let i = 1; i <= 10; i++) {
    const a = selectedValue && i <= selectedValue ? 'active' + (colorClass ? ' ' + colorClass : '') : '';
    const ro = readonly ? ' readonly' : '';
    const oc = readonly ? '' : ` onclick="setGridValue('${containerId}',${i})"`;
    h += `<div class="grid-cell ${a}${ro}" data-val="${i}"${oc}>${i}</div>`;
  }
  c.innerHTML = h;
  updateGridLabel(containerId, selectedValue);
}
function setGridValue(containerId, val) {
  const c = document.getElementById(containerId);
  if (!c || c.classList.contains('state-readonly')) return;
  const cells = c.querySelectorAll('.grid-cell');
  const cur = getGridValue(containerId);
  let nv;
  if (cur === val) {
    nv = val > 1 ? val - 1 : null;
  } else {
    nv = val;
  }
  const cc = c.dataset.color || '';
  cells.forEach(cell => {
    const v = parseInt(cell.dataset.val);
    if (nv && v <= nv) {
      cell.classList.add('active');
      if (cc) cell.classList.add(cc);
    } else {
      cell.classList.remove('active');
      if (cc) cell.classList.remove(cc);
    }
  });
  updateGridLabel(containerId, nv);
}
function getGridValue(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return null;
  const active = c.querySelectorAll('.grid-cell.active');
  if (!active.length) return null;
  return parseInt(active[active.length - 1].dataset.val);
}
/* 状态打分 Emoji（1~10 随分值渐变）：能量 = 电量从低到满，心情 = 从难过到开心 */
const _STATE_EMOJI_ENERGY = ['🪫', '🪫', '🪫', '🔋', '🔋', '🔋', '🔋', '⚡', '⚡', '🔥'];
const _STATE_EMOJI_MOOD = ['😭', '😢', '😞', '😕', '😐', '🙂', '😊', '😄', '🤩', '🥳'];
function _refreshStateIcon(containerId, val) {
  const c = document.getElementById(containerId);
  if (!c) return;
  const row = c.closest('.state-row');
  if (!row) return;
  const icon = row.querySelector('.state-icon');
  if (!icon) return;
  if (!icon.dataset.def) icon.dataset.def = icon.textContent || '';
  if (!val) {
    icon.textContent = icon.dataset.def;
    return;
  }
  let arr = null;
  if (/Energy/i.test(containerId)) arr = _STATE_EMOJI_ENERGY;
  else if (/Mood/i.test(containerId)) arr = _STATE_EMOJI_MOOD;
  if (!arr) return;
  const v = parseInt(val, 10);
  if (v >= 1 && v <= 10) icon.textContent = arr[v - 1];
}
function updateGridLabel(containerId, val) {
  _refreshStateIcon(containerId, val);
  /* 支持两类 id：
     - finishEnergyPicker → finishEnergyLabel（精力/心情选择器，原有逻辑）
     - single_fq_日期_grid → single_fq_日期_label（日记睡眠/精神 grid） */
  let lid = containerId.replace('Picker', 'Label');
  if (lid === containerId) lid = containerId.replace('_grid', '_label');
  if (lid === containerId) return;
  const l = document.getElementById(lid);
  if (l) l.textContent = val ? val + '' : '';
}
function formatStateComparison(r) {
  if (!r.startEnergy && !r.startMood && !r.energy && !r.mood) return '';
  let g = [];
  function _cmpStr(a, b) {
    if (a && b) return '<span class="st-val">' + a + '</span><span class="st-arw">→</span><span class="st-val">' + b + '</span>';
    if (b) return '<span class="st-arw">→</span><span class="st-val">' + b + '</span>';
    return '<span class="st-val">' + a + '</span><span class="st-arw">→</span>';
  }
  if (r.startEnergy || r.energy) {
    g.push('<span class="st-grp"><span class="st-ico">🔋</span>' + _cmpStr(r.startEnergy, r.energy) + '</span>');
  }
  if (r.startMood || r.mood) {
    g.push('<span class="st-grp"><span class="st-ico">😊</span>' + _cmpStr(r.startMood, r.mood) + '</span>');
  }
  return g.length ? ' <span class="log-state-cmp">' + g.join('') + '</span>' : '';
}
/* Toast 队列：一次只显示一条，自动消失后显示下一条；点击当前提示可立即跳过 */
let _toastQueue = [];
let _toastBusy = false;
/* onTap：点这条 toast 时执行（可选）。删除类操作的「撤销」靠它 ——
   一期把「· 撤销」写进了文案却没有接点击，用户点上去只会把提示关掉。 */
function showToast(msg, isRank, onTap) {
  /* 番茄结算期间（_settleCollecting）不逐个蹦 toast，收进数组，
     结算完统一合并成一条「结算汇总」显示完成提示太多叠来叠去） */
  if (window._settleCollecting) {
    if (!window._settleMsgs) window._settleMsgs = [];
    window._settleMsgs.push(String(msg));
    /* R 消息落袋即通知 01d 续期合并 timer（事件驱动 flush，替代固定 3.5s 等待） */
    if (window.__settleTouch) window.__settleTouch();
    return;
  }
  _lastToastTs = Date.now();
  _lastToastMsg = String(msg);
  _toastQueue.push({ msg: msg, isRank: !!isRank, onTap: typeof onTap === 'function' ? onTap : null });
  pumpToast();
}
/* 最近一次 toast 的时间与文案：开关的通用回执靠它避让「自己已经有专属提示」的那几个开关
   （蓝调模式会单独播一条，不能一条动作弹两次）。只按时间避让不行 —— 连点两个开关时
   第二条会被前一条的 150ms 闷掉；所以还要求「刚播的那条里已经出现了这个开关的名字」。 */
let _lastToastTs = 0;
let _lastToastMsg = '';
/* 开关必须有回话：滑块只翻个位置，用户看不出「现在到底是开还是关」。
   设置页有十几个开关，逐个写 onchange 容易漏，统一在 document 上挂一个代理：
   凡是 <label class="switch"> 里的复选框，变化后都用它所在行的标签文字播一条回执。
   capture=false —— 让内联 onchange 先跑完，专属提示（如蓝调模式）已经弹过就不再重复。 */
function _switchRowLabel(input) {
  let row = input && input.closest ? input.closest('.setting-row') : null;
  if (!row || !row.querySelector) return '';
  const lab = row.querySelector('.setting-label');
  if (!lab) return '';
  /* 只取标签的第一行文本：设置项标题后面跟着 .setting-desc 说明，不能一起念出来 */
  let s = '';
  const kids = lab.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].nodeType === 3) s += kids[i].textContent;
  }
  s = String(s).replace(/\s+/g, ' ').trim();
  if (!s) s = String(lab.textContent || '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 20);
}
function notifySwitchChanged(input) {
  if (!input || input.type !== 'checkbox') return;
  if (!input.closest || !input.closest('label.switch')) return;
  /* 显式标记优先于一切启发式：带标记 = 这个开关刚由自己的专属提示播过一条。
     必须在这里 delete（不能只 return）—— 否则该开关此后再也不会播通用回执。 */
  if (input.dataset && input.dataset.toastOwned === '1') {
    delete input.dataset.toastOwned;
    return;
  }
  const name = _switchRowLabel(input) || '开关';
  /* 专属提示刚播过、且说的就是这个开关 → 让它说话，别叠一条通用回执。
     但通用回执自己发的那条（"已开启：…"）不算专属，否则同一个开关连点两次
     第二条会被上一条闷掉。 */
  const _ownGeneric = _lastToastMsg.indexOf('已开启：') === 0 || _lastToastMsg.indexOf('已关闭：') === 0;
  if (!_ownGeneric && Date.now() - _lastToastTs < 400 && _lastToastMsg.indexOf(name) >= 0) return;
  showToast((input.checked ? '已开启：' : '已关闭：') + name);
}
document.addEventListener('change', function (e) {
  const t = e && e.target;
  if (t && t.tagName === 'INPUT') notifySwitchChanged(t);
}, false);
/* 合并结算提示：居中遮罩 + 大卡片（不自动消失，用户看完手动关闭） */
let _settleTimer = null;
function showSettleSummary(msgs, digest) {
  if (!msgs || !msgs.length) return;
  const seen = {};
  const lines = [];
  msgs.forEach(function (m) {
    if (seen[m]) return;
    seen[m] = true;
    lines.push(m);
  });
  /* 全部列出，不再截断。
     曾按 _cap（5/6 条）折叠并补一句「…还有 N 条已并入统计」—— 但「已并入统计」
     说的是「这些提示没显示」，用户读到的却是「有数据被合并掉了」，每次结算都要
     怀疑自己漏看了什么。结算卡片本来就是一次性读一遍就关的东西，多两行不占地方。 */
  /* 若已有结算卡片，直接更新内容而不是叠加 */
  let mask = document.getElementById('settleMask');
  if (!mask) {
    mask = document.createElement('div');
    mask.className = 'settle-mask';
    mask.id = 'settleMask';
    mask.onclick = function () {
      dismissSettle();
    };
    document.body.appendChild(mask);
  }
  const card = document.createElement('div');
  card.className = 'settle-card';
  card.innerHTML =
    '<div class="settle-title">🍅 本次番茄结算</div>' +
    '<div class="settle-lines">' +
    (digest ? '<div class="settle-line" style="opacity:.85;">' + digest + '</div>' : '') +
    lines
      .map(function (m) {
        return '<div class="settle-line">' + m + '</div>';
      })
      .join('') +
    '</div>' +
    '<button class="settle-ok">知道了</button>';
  card.onclick = function (e) {
    e.stopPropagation();
  };
  card.querySelector('.settle-ok').onclick = function () {
    dismissSettle();
  };
  mask.innerHTML = '';
  mask.appendChild(card);
  mask.classList.add('show');
  requestAnimationFrame(function () {
    card.classList.add('show');
  });
}

function dismissSettle() {
  const mask = document.getElementById('settleMask');
  if (!mask) return;
  if (_settleTimer) {
    clearTimeout(_settleTimer);
    _settleTimer = null;
  }
  mask.classList.remove('show');
  setTimeout(function () {
    if (mask.parentNode) mask.parentNode.removeChild(mask);
  }, 260);
}
function pumpToast() {
  if (_toastBusy || _toastQueue.length === 0) return;
  _toastBusy = true;
  const item = _toastQueue.shift();
  const c = document.getElementById('toastContainer');
  if (!c) {
    _toastBusy = false;
    return;
  }
  c.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'toast-item' + (item.isRank ? ' rank-toast-item' : '');
  t.textContent = item.msg;
  t.onclick = function () {
    /* 带撤销的提示：点它执行撤销，而不是单纯关掉 */
    if (item.onTap) {
      try { item.onTap(); } catch (e) { if (window.__silent) window.__silent(e, 'toast:onTap'); }
    }
    dismissToast(t);
  };
  c.appendChild(t);
  requestAnimationFrame(function () {
    t.classList.add('show');
  });
  t._timer = setTimeout(
    function () {
      dismissToast(t);
    },
    item.isRank ? 5200 : 3400
  );
}
function dismissToast(t) {
  if (!t || t._done) return;
  t._done = true;
  clearTimeout(t._timer);
  t.classList.remove('show');
  setTimeout(function () {
    if (t.parentNode) t.parentNode.removeChild(t);
    _toastBusy = false;
    pumpToast();
  }, 280);
}
/* 遮罩背后的页面不许动。
   CSS 的 overscroll-behavior: contain 只切断「从遮罩外溢」这一条路；但只要遮罩
   自身没有可滚范围，某些 WebView 会把触摸直接交给 html 滚动器 ——
   结果就是弹层开着、底下的页面还能上下跑（用户：「为什么打开那个背景依旧能滑动」）。
   所以再锁一层：有任何 .modal-overlay.show 时给 body 挂 modal-open，
   样式里让 html/body 的滚动停住。

   ★ 判据直接查 DOM（querySelector 而不是计数器）：
     全库有几十处是直接 el.classList.add('show') 开窗、绕过 showModal 的，
     用计数器迟早对不上，而且对不上时是「锁死不放开」这种更严重的故障。 */
function _syncModalLock() {
  const any = document.querySelector('.modal-overlay.show');
  document.body.classList[any ? 'add' : 'remove']('modal-open');
}
function showModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  _syncModalLock();
}
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  /* 商店里喂食的感谢语：等弹窗关闭后让树苗气泡说出口 */
  if (id === 'treeShopModal' && _pendingFeedThanks) {
    const t = _pendingFeedThanks;
    _pendingFeedThanks = null;
    _feedThanksLeft = Math.max(0, _feedThanksLeft - 1); /* 关店气泡算一次口头感谢 */
    const b = document.getElementById('treeBubble');
    if (b) {
      b.textContent = t;
      b.classList.remove('show');
      void b.offsetWidth;
      b.classList.add('show');
      clearTimeout(b._t);
      b._t = setTimeout(function () {
        b.classList.remove('show');
      }, 2600);
    }
  }
  _syncModalLock();
}
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
function updateTodayStats() {
  renderTimerRankStrip();
  renderRerollUI();
  renderStarPath();
  const today = getTodayStr();
  const todayRecords = appData.records.filter(r => {
    if (isLogRecord(r)) return false; /* 仅记录：不进今日专注统计（分钟/打断） */
    const d = new Date(r.startTime);
    return getDateStr(d) === today;
  });
  const full = todayRecords.filter(r => r.type === 'full').length;
  const half = todayRecords.filter(r => r.type === 'half').length;
  const interruptCount = todayRecords.reduce((s, r) => s + (r.interruptions ? r.interruptions.length : 0), 0);
  const todayMinutes = Math.floor(todayRecords.reduce((s, r) => s + (r.effectiveSeconds || 0), 0) / 60);
  fxVal(document.getElementById('todayFull'), full);          /* E4-04 今日完整🍅 */
  fxVal(document.getElementById('todayHalf'), half);          /* E4-04 今日半个🍅 */
  document.getElementById('todayInterrupt').textContent = interruptCount;
  let sf = document.getElementById('statFocus');
  if (sf) sf.textContent = todayMinutes;
  let st = document.getElementById('statsTotal');
  if (st) {
    let _tp = todayRecords.reduce(function (a, r) {
      return a + getPomos(r);
    }, 0);
    fxVal(st, _tp.toFixed(1).replace(/\.0$/, ''));           /* E4-04 今日折算大数字 */
    applyTodayTier(_tp);
  }
  let si = document.getElementById('statInterrupt');
  if (si) si.textContent = interruptCount;
  const tp = document.getElementById('todayProgress');
  if (tp) {
    const total = full + half * 0.5;
    const display = Number.isInteger(total) ? total : total.toFixed(1);
    fxVal(tp, display, '今日 ', ' 🍅');                        /* E4-04 计时页今日胶囊 */
  }
  renderEncourage();
  renderTimerBadge();
}
/* ===== 计划 / 待办 的增删改查与列表渲染已迁至 01eC_ui_todo.js（回退见该文件头注释）===== */
/* 计时界面子任务卡：开始番茄时同步展示主计划下的子任务，可勾选（与计划页数据一致） */
/* 子任务勾选框（计划列表与计时页共用）：走 CSS 类，深色模式自动提亮 */
const SUB_CB_SVG =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect class="cb-shape" x="2.5" y="2.5" width="19" height="19" rx="6"/><polyline class="cb-check" points="6,12 10.5,16.5 18,8"/></svg>';
/* 计时页「当前这条计划」的唯一口径：
   计时进行中认 timerState.linkedTodoId（这是专注记录归属的权威，不能被覆盖）；
   还没开始、但下拉里已经选了计划时，退回 timerState._selId ——
   否则「选完计划」与「看到它的子任务」之间隔着一个「开始」，
   而实际要走的流程是「选计划 → 挑这次做哪一步 → 开始」。
   与 01g_engine_init 里高亮逻辑的 `linkedTodoId || _selId` 同一口径，避免两处各说各话。 */
function timerLinkedTodo() {
  const id = timerState.linkedTodoId != null ? timerState.linkedTodoId : timerState._selId;
  if (id == null || id === '') return null;
  if (!/^\d+$/.test(String(id))) return null; /* mustdo_/habit_ 之类不是 todo */
  return (
    appData.todos.find(function (x) {
      return idEq(x.id, id);
    }) || null
  );
}
function renderTimerSubs() {
  const box = document.getElementById('timerSubsBox');
  if (!box) return;
  const lt = timerLinkedTodo();
  const subs = lt ? lt.subs || [] : [];
  if (!subs.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  /* 正在做哪条子任务：只为让专注记录留下「子计划」痕迹，不影响完成勾选 */
  const curSub = findSubById(subs, timerState.curSubId);
  box.innerHTML =
    '<div style="font-size:var(--fs-note);font-weight:800;margin-bottom:var(--sp-6);color:var(--text-light);">📝 子任务 · 边做边勾' +
    (curSub ? ' · 正在做「' + escapeHtml(curSub.title) + '」' : ' · 点标题选中「正在做」') +
    '</div>' +
    subs
      .map(function (s, si) {
        const isCur = !!(curSub && idEq(curSub.id, s.id));
        return (
          '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-8) var(--sp-10);background:' +
          (s.done ? 'linear-gradient(135deg,rgba(46,125,50,.16),rgba(46,125,50,.06))' : 'var(--card)') +
          ';border:1.5px solid ' +
          (isCur ? 'var(--primary)' : s.done ? 'var(--green)' : 'var(--border)') +
          ';border-radius:var(--radius-md);margin-bottom:var(--sp-6);box-shadow:' +
          (s.done ? '0 1px 8px rgba(46,125,50,.12)' : 'none') +
          ';transition:background .2s,border-color .2s;">' +
          '<div class="sub-cb ' +
          (s.done ? 'checked' : '') +
          '" onclick="toggleTimerSub(' +
          si +
          ')" title="' +
          (s.done ? '点击取消完成' : '点击标记完成') +
          '">' +
          SUB_CB_SVG +
          '</div>' +
          '<span style="font-size:var(--fs-body);line-height:1.4;flex:1;' +
          (s.done
            ? 'text-decoration:line-through;text-decoration-color:var(--green);opacity:.8;color:var(--text-light);'
            : '') +
          '" title="点一下 = 这次番茄在做这条" onclick="selectTimerSub(' +
          si +
          ')">' +
          (isCur ? '▶ ' : '') +
          escapeHtml(s.title) +
          '</span>' +
          /* 子任务的预计番茄不再显示（10-17 收尾：计划行/编辑面板/新建弹窗/记录卡四处 10-15 已去掉，
             这里是最后一个还会露出 🍅N 的地方 —— 全站口径必须一致：子任务番茄不显示、不计入）。 */
          '</div>'
        );
      })
      .join('');
}
/* ===== 结算弹窗里的「这次做完的子计划」=====
   用户原话：「一个番茄完了，我来不及在计时那边边做边勾，番茄一进休息我就勾不了了；
   就算勾了，日志里那条记录还是写着一步都没完成」。
   两个原因各修一处：
     ① 结算那一下没地方勾 → 这里补一张清单；
     ② 记录里的 planSubs 快照按「结束时刻」截断（见 snapshotPlanSubs 的 cutoffMs），
        番茄结束后才勾的 doneAt 会晚于 cutoff，被判定成"没完成" →
        结算弹窗里勾的，一律记 timerState.settleSubsEdited，落库时不做截断。 */
function renderFinishSubs() {
  const wrap = document.getElementById('finishSubsWrap');
  const box = document.getElementById('finishSubsBox');
  if (!wrap || !box) return;
  const lt = timerLinkedTodo();
  const subs = lt ? todoValidSubs(lt) : [];
  if (!subs.length) {
    wrap.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  wrap.style.display = '';
  const p = todoSubProgress(lt);
  box.innerHTML =
    '<div class="finish-subs-head">' + escapeHtml(lt.title || '') +
    ' · 已完成 ' + p.done + '/' + p.total + ' 步</div>' +
    subs.map(function (s, si) {
      return (
        '<div class="finish-sub-row' + (s.done ? ' done' : '') + '" onclick="toggleFinishSub(' + si + ')">' +
        '<div class="sub-cb' + (s.done ? ' checked' : '') + '">' + SUB_CB_SVG + '</div>' +
        '<span class="finish-sub-txt">' + escapeHtml(s.title || '') + '</span>' +
        '</div>'
      );
    }).join('');
}
/* 结算弹窗补勾：只改子任务本身，不替用户把整条计划打勾（那是计划页的事）。 */
function toggleFinishSub(si) {
  const lt = timerLinkedTodo();
  if (!lt) return;
  const subs = todoValidSubs(lt);
  const s = subs[si];
  if (!s) return;
  s.done = !s.done;
  if (s.done) s.doneAt = Date.now();
  else delete s.doneAt;
  /* ★ 在结算窗里动过子计划 = 用户明确表示「这次做到了这些」，
     落库时 planSubs 不做时间截断，否则刚勾的这一步会被当成"番茄结束后才勾的"排除掉。 */
  if (typeof timerState !== 'undefined') timerState.settleSubsEdited = true;
  saveData();
  renderFinishSubs();
  try { renderTimerSubs(); } catch (e) { if (window.__silent) window.__silent(e, '01e:toggleFinishSub'); }
  /* 日志页「今天完成」也要跟着留痕（只勾子计划没打勾整条计划的情况） */
  try {
    if (typeof _syncTodoPartialLog === 'function') _syncTodoPartialLog(lt);
    if (typeof renderTodos === 'function') renderTodos();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:toggleFinishSub:log'); }
}
/* 点标题 = 把它设为正在做的子任务（再点一下取消）。
   与「打勾完成」分开：后者写 todos，前者只是本轮番茄的标签。 */
function selectTimerSub(si) {
  const lt = timerLinkedTodo();
  const s = lt ? (lt.subs || [])[si] : null;
  if (!s) return;
  timerState.curSubId = idEq(timerState.curSubId, s.id) ? null : s.id;
  renderTimerSubs();
}
function toggleTimerSub(si) {
  const lt = timerLinkedTodo();
  if (!lt || !(lt.subs || [])[si]) return;
  lt.subs[si].done = !lt.subs[si].done;
  /* 同计划卡：记下勾掉的时刻，供专注记录按时间做快照 */
  if (lt.subs[si].done) lt.subs[si].doneAt = Date.now();
  else delete lt.subs[si].doneAt;
  /* 与计划卡同一口径：只勾子计划也要进日志「今天完成」 */
  try { if (typeof _syncTodoPartialLog === 'function') _syncTodoPartialLog(lt); } catch (e) { if (window.__silent) window.__silent(e, '01e:toggleTimerSub:log'); }
  saveData();
  renderTimerSubs();
  renderTodos();
}
let _todoSig = '';
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  /* 补双引号转义：textNode→innerHTML 只转义 & < >，本函数返回值会被拼进
     value="${...}" 等双引号属性上下文（habitDetailName/detailTaskName），不转 " 即属性注入。
     textarea 为 RCDATA 上下文，&quot; 会被实体解码回 " 正常显示（已实机验证回读无损），
     故一处补齐对全部调用点安全。 */
  return div.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
/* 今日番茄分级：0-5 正常（红橙）｜6-9 努力（绿）｜10+ 十分努力（金+发光） */
function applyTodayTier(tc) {
  const _stEl = document.getElementById('statsTotal');
  if (_stEl) {
    if (tc >= 10) {
      _stEl.style.color = 'var(--yellow-dark)';
      _stEl.style.textShadow = '0 0 20px rgba(217,149,48,.5)';
    } else if (tc >= 6) {
      _stEl.style.color = 'var(--green)';
      _stEl.style.textShadow = '';
    } else {
      _stEl.style.color = 'var(--primary)';
      _stEl.style.textShadow = '';
    }
  }
  const _tierEl = document.getElementById('statsTierLabel');
  if (_tierEl) {
    if (tc >= 10) {
      _tierEl.style.display = '';
      _tierEl.innerHTML =
        '⚡ 十分努力 <span style="color:var(--text-light);font-weight:400;">（' + tc + ' 个 🍅）</span>';
      _tierEl.style.color = 'var(--yellow-dark)';
    } else if (tc >= 6) {
      _tierEl.style.display = '';
      _tierEl.innerHTML =
        '🔥 努力中 <span style="color:var(--text-light);font-weight:400;">（' + tc + ' 个 🍅）</span>';
      _tierEl.style.color = 'var(--green)';
    } else {
      _tierEl.style.display = 'none';
    }
  }
}
function mustDoUI() {
  if (!appData.mustDoUI || typeof appData.mustDoUI !== 'object') appData.mustDoUI = {};
  const u = appData.mustDoUI;
  if (!u.collapse || typeof u.collapse !== 'object') u.collapse = {}; /* 区块折叠状态 */
  if (!u.open || typeof u.open !== 'object') u.open = {}; /* 单卡展开状态（v2 改：默认全部折叠，只看标题） */
  return u;
}
/* v2 改：点「必做 3 件事」标题行 → 整块折叠（折叠后只剩标题行，不留摘要） */
function toggleMustDoSection() {
  const u = mustDoUI();
  u.collapse['section'] = !u.collapse['section'];
  saveData();
  renderMustDoSection();
}
function toggleMustDoBlock(key) {
  const u = mustDoUI();
  u.collapse[key] = !u.collapse[key];
  saveData();
  renderMustDoSection();
}
function toggleMustDoCard(id) {
  const u = mustDoUI();
  u.open[id] = !(u.open[id] === true);
  saveData();
  renderMustDoSection();
} /* 单张任务卡：标准视图（不再有放大切换） */
function mustDoCardHtml(it, locked) {
  const ui = mustDoUI();
  const done = !!it.done;
  const est = mustDoEst(it);
  const open = ui.open[it.id] !== false; /* 默认展开详情；点过 ▾ 后记住折叠（保持卡片可读，少一步点击） */
  let h = '<div class="md-card' + (done ? ' done' : '') + (locked ? ' locked' : '') + (open ? ' open' : '') + '">';
  h += '<div class="md-row">';
  if (locked) {
    h += '<div class="md-box lock">🔒</div>';
  } else {
    h +=
      '<div class="md-box' +
      (done ? ' on' : '') +
      '" onclick="toggleMustDo(' +
      it.id +
      ')">' +
      (done ? '✓' : '') +
      '</div>';
  }
  h += '<div class="md-name">' + escapeHtml(it.title) + '</div>';
  h += '<span class="md-est">🍅 ' + est + '</span>';
  h +=
    '<button class="md-fold" onclick="toggleMustDoCard(' +
    it.id +
    ')" title="' +
    (open ? '折叠' : '展开') +
    '">▾</button>';
  h += '</div>';
  h +=
    '<div class="md-body">' +
    '<div>预计 <b>' +
    est +
    ' 个番茄</b> · 约 <b>' +
    Math.round(est * mustDoWorkMin()) +
    ' 分钟</b>（单番茄 ' +
    mustDoWorkMin() +
    ' 分钟）</div>' +
    '<div>' +
    (locked
      ? '🔒 明天 0:00 自动加入「计划」列表顶部并带标记，全部打勾后可领 +' + COIN_MUSTDO_REWARD + '🪙'
      : '✅ 勾选会同步到「计划」列表；三件全完成可领 +' + COIN_MUSTDO_REWARD + '🪙') +
    '</div>' +
    '</div>';
  h += '</div>';
  return h;
}
function renderMustDoSection() {
  const box = document.getElementById('planGoalMustDo');
  if (!box) return;
  const ui = mustDoUI();
  const today = getTodayStr();
  const tomorrow = mustDoTomorrowStr();
  const prevFlag = !!(appData.mustDoFromPrev || {})[today]; /* 昨晚预设 → 今日必做 */
  const listToday = appData.mustDos[today] || [];
  const listTomorrow = appData.mustDos[tomorrow] || [];
  const rewarded = !!appData.mustDoRewarded[today];
  const doneCnt = listToday.filter(function (x) {
    return x.done;
  }).length;
  /* 从「必做 3 件事」这一行直接折叠整块：折叠后只剩标题行，不带任何摘要 */
  const secCol = !!ui.collapse['section'];
  /* 今天、明天都空的时候，这一整块其实没有内容 —— 只有三句说明书。
     原来它照样占 158px 排在最上面，把「今日目标」「本周重点」全推下去，
     打开目标页第一屏看到的是一张空卡。现在退成一行：标题 + 一个「＋」。
     说明（金币规则、明天 0:00 生效）挪进 ＋ 的 title 和弹窗里。 */
  const empty = !listToday.length && !listTomorrow.length;
  if (empty) {
    /* 空态是**一个按钮**，不是「一行标题 + 一个圆形＋」。
       原来那一行右端挂着一个 32px 的圆圈 ＋，左边还有「还没定」三个字：
       一个说明、一个控件，说明自己不会告诉你该干什么，圆圈又小得像角标。
       现在整行就是一整块可点区域，右边直接写要做的动作。 */
    box.innerHTML = '<button class="md-wrap md-wrap--empty md-empty-row"'
      + ' title="全部打勾可领 ' + COIN_MUSTDO_REWARD + ' 金币；明天 0:00 自动出现在计划顶部"'
      + ' onclick="openMustDoModal()">'
      + '<span class="md-title">🎯 必做 3 件事</span>'
      + '<span class="md-empty-cta">去定三件事 ›</span>'
      + '</button>';
    return;
  }
  let h = '<div class="md-wrap">';
  h +=
    '<div class="md-head" onclick="toggleMustDoSection()">' +
    '<div class="md-title">🎯 必做 3 件事</div>' +
    '<span class="md-caret' +
    (secCol ? ' collapsed' : '') +
    '">▾</span>' +
    '</div>';
  h += '<div class="md-content' + (secCol ? ' collapsed' : '') + '">';
  h += '<div class="md-sub">提前立下，全部打勾领 +' + COIN_MUSTDO_REWARD + '🪙</div>';
  /* —— 今日：可勾选 / 领取 / 也可重新编辑 —— */
  if (listToday.length) {
    /* 全部完成但还没领奖时，强制展开今日区块，避免折叠后找不到领取按钮 */
    const pendingClaim = doneCnt === listToday.length && !rewarded;
    const col = !!ui.collapse['today'] && !pendingClaim;
    const allDone = doneCnt === listToday.length;
    h +=
      '<div class="md-block-head" onclick="toggleMustDoBlock(\'today\')">' +
      '<span class="md-caret' +
      (col ? ' collapsed' : '') +
      '">▾</span>' +
      '<span>📌 今日目标</span>' +
      (prevFlag
        ? '<span style="font-size:var(--fs-tiny);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-8);color:var(--text-light);font-weight:700">🌙 昨晚预设</span>'
        : '') +
      '<span class="md-side"><button class="md-tool" onclick="event.stopPropagation();openMustDoModal(\'' +
      today +
      '\')">✏️ 重新编辑</button></span>' +
      '</div>';
    if (!col) {
      h += '<div class="md-list">';
      listToday.forEach(function (it) {
        h += mustDoCardHtml(it, false);
      });
      h += '</div>';
      h +=
        '<div class="md-foot" style="color:' +
        (allDone ? 'var(--green)' : 'var(--primary)') +
        ';">完成 ' +
        doneCnt +
        '/' +
        listToday.length +
        ' 件 · ' +
        (rewarded
          ? '<button class="md-btn" disabled>🏆 已领取 +' + COIN_MUSTDO_REWARD + '🪙</button>'
          : allDone
            ? '<button class="md-btn green" onclick="claimMustDoReward()">🎁 领取 +' + COIN_MUSTDO_REWARD + '🪙</button>'
            : '<button class="md-btn" disabled title="把今天的事全部打勾后才能领取">🎁 +' + COIN_MUSTDO_REWARD + '🪙（还差 ' +
              (listToday.length - doneCnt) +
              ' 件）</button>') +
        '</div>';
    }
  }
  /* —— 明日：卡片直接展示（第二天 0:00 自动进「计划」列表顶部并带特殊标记），底部保留两个操作按钮 —— */
  if (listTomorrow.length) {
    h += '<div class="md-list" style="margin-top:var(--sp-8);">';
    listTomorrow.forEach(function (it) {
      h += mustDoCardHtml(it, true);
    });
    h += '</div>';
    h +=
      '<div class="md-actions">' +
      '<button class="md-btn" disabled title="明天 0:00 自动进计划列表，打完全部才发奖励">🔒 +' + COIN_MUSTDO_REWARD + '🪙（明天自动进入计划列表）</button>' +
      '<button class="md-btn" onclick="openMustDoModal(\'' +
      tomorrow +
      '\')">✏️ 重新输入明日必做</button>' +
      '<button class="md-btn ghost" onclick="clearMustDos(\'' +
      tomorrow +
      '\')">🗑 清空</button>' +
      '</div>';
  } else {
    h +=
      '<div style="margin:var(--sp-10) 0;font-size:var(--fs-caption);color:var(--text-light);line-height:1.6;">明天 0:00 自动出现在「计划」顶部</div>';
    h +=
      '<div class="md-actions"><button class="md-btn" onclick="openMustDoModal()">📝 设置明天的必做 3 件事</button></div>';
  }
  h += '</div>';
  h += '</div>';
  box.innerHTML = h;
}
/* 「计划」页顶部：今日必做以特殊样式列出（由昨日预设自动带入 / 与目标页勾选同源同步） */
function renderPlanMustRows() {
  const box = document.getElementById('planTodoMustRows');
  if (!box) return;
  const today = getTodayStr();
  const list = (appData.mustDos && appData.mustDos[today]) || [];
  if (!list.length) {
    box.innerHTML = '';
    return;
  }
  const prev = !!(appData.mustDoFromPrev || {})[today];
  const done = list.filter(function (x) {
    return x.done;
  }).length;
  const all = done === list.length;
  const rewarded = !!appData.mustDoRewarded[today];
  let h =
    '<div style="border:1.5px solid var(--green);border-radius:var(--radius-card);overflow:hidden">' +
    '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-6) var(--sp-10);background:linear-gradient(135deg,rgba(46,125,50,.14),rgba(46,125,50,.04));font-size:var(--fs-body);font-weight:900;color:var(--text)">🔥 今日必做' +
    (prev
      ? '<span style="font-size:var(--fs-tiny);background:var(--card);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-8);color:var(--text-light);font-weight:700">🌙 昨晚预设</span>'
      : '') +
    '<span style="margin-left:auto;font-size:var(--fs-caption);color:var(--text-light);font-weight:700">' +
    done +
    '/' +
    list.length +
    (rewarded && all ? ' · 🏆 已领' : '') +
    (all && !rewarded ? ' · 🎁 可领' : '') +
    '</span>' +
    '</div>';
  h += '<div style="background:var(--card)">';
  for (let i = 0; i < list.length; i++) {
    const it = list[i],
      doneIt = !!it.done;
    h +=
      '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-8) var(--sp-10);border-top:1px solid var(--border)">' +
      '<div onclick="toggleMustDo(' +
      it.id +
      ')" style="min-width:22px;height:22px;border-radius:50%;border:2px solid var(--green);background:' +
      (doneIt ? 'var(--green)' : 'transparent') +
      ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:var(--fs-note);cursor:pointer;flex:0 0 auto">' +
      (doneIt ? '✓' : '') +
      '</div>' +
      '<span style="flex:1;min-width:0;font-size:var(--fs-body);' +
      (doneIt ? 'text-decoration:line-through;opacity:.65;color:var(--text-light)' : 'color:var(--text)') +
      '">' +
      escapeHtml(it.title || '') +
      '</span>' +
      '<span style="flex:0 0 auto;font-size:var(--fs-tiny);border:1px solid var(--green);color: var(--green-ink);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-8);font-weight:800">必做</span>' +
      '</div>';
  }
  h += '</div></div>';
  box.innerHTML = h;
}
function openMustDoModal(dateStr) {
  __setMustDoEditDate(dateStr || mustDoTomorrowStr());
  const isToday = _mustDoEditDate === getTodayStr();
  const old = appData.mustDos[_mustDoEditDate] || [];
  for (let i = 0; i < 3; i++) {
    const inp = document.getElementById('mustDoInput' + i);
    if (inp) inp.value = (old[i] && old[i].title) || '';
    const sel = document.getElementById('mustDoEst' + i);
    if (sel) {
      if (!sel.options.length) {
        MUSTDO_EST_OPTIONS.forEach(function (v) {
          const o = document.createElement('option');
          o.value = String(v);
          o.textContent = v + '🍅';
          sel.appendChild(o);
        });
      }
      sel.value = String(old[i] ? mustDoEst(old[i]) : 1);
    }
  }
  const t = document.getElementById('mustDoModalTitle');
  if (t) t.textContent = isToday ? '🎯 必做 3 件事 · 今日（可改）' : '🎯 必做 3 件事 · 明日';
  const lab = document.getElementById('mustDoDateLabel');
  if (lab) {
    let _txt = (isToday ? '今天的事（' : '明天的事（') + _mustDoEditDate + '）';
    try {
      const _tg = new Date(_mustDoEditDate + 'T00:00:00');
      const _diff = _tg.getTime() - Date.now();
      if (_diff > 0) {
        const _h = Math.floor(_diff / 3600000);
        const _m = Math.floor((_diff % 3600000) / 60000);
        _txt += ' · 距设定时间还有 ' + _h + ' 小时 ' + _m + ' 分';
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01e:openMustDoModal'); }
    lab.textContent = _txt;
  }
  const tip = document.getElementById('mustDoModalTip');
  if (tip)
    tip.innerHTML =
      (old.length
        ? '已填写 ' + old.length + ' 件，改完保存即覆盖；'
        : '为' + (isToday ? '今天' : '明天') + '立下「非完成不可」的 1~3 件事，') +
      (isToday ? '今天' : '明天') +
      '全部打勾完成 → <b style="color: var(--primary-ink);">+' + COIN_MUSTDO_REWARD + '🪙</b>（奖励只在当天有效，过后作废）';
  showModal('mustDoModal');
}
/* ===== 计划 / 待办 的增删改查与列表渲染已迁至 01eC_ui_todo.js（回退见该文件头注释）===== */
/* 计划页二级导航：计划 / 习惯 / 目标 / 定点休息 */
function switchPlanTab(tab) {
  let tv = document.getElementById('planTodoView');
  let hv = document.getElementById('planHabitView');
  let gv = document.getElementById('planGoalView');
  let bv = document.getElementById('planBreakView');
  let cv = document.getElementById('planCountdownView');
  if (tv) tv.style.display = tab === 'plan' ? 'block' : 'none';
  if (hv) hv.style.display = tab === 'habit' ? 'block' : 'none';
  if (gv) gv.style.display = tab === 'goal' ? 'block' : 'none';
  if (bv) bv.style.display = tab === 'break' ? 'block' : 'none';
  if (cv) cv.style.display = tab === 'countdown' ? 'block' : 'none';
  document.querySelectorAll('#view-plan .log-tab').forEach(function (t) {
    let key = t.getAttribute('data-tab');
    if (!key)
      key =
        t.textContent.indexOf('习惯') >= 0
          ? 'habit'
          : t.textContent.indexOf('目标') >= 0
            ? 'goal'
            : t.textContent.indexOf('休息') >= 0
              ? 'break'
              : t.textContent.indexOf('倒数日') >= 0
                ? 'countdown'
                : 'plan';
    t.classList.toggle('active', key === tab);
  });
  if (tab === 'habit') renderHabits();
  if (tab === 'goal') {
    try {
      window.renderGoalPage && window.renderGoalPage();
    } catch (e) { if (window.__silent) window.__silent(e, '01e-switchPlanTab'); }
    try {
      renderMustDoSection();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:switchPlanTab'); }
  }
  if (tab === 'break') {
    try {
      renderPlanBreakView();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:switchPlanTab'); }
  }
  if (tab === 'countdown') renderCountdowns();
}
/* ⏰ 定点休息面板：由「设置 → 计时设置」移入计划页二级页签（v5.7.6）。
   读写 appData.enhSettings.special（4 个时段）与 sbDone（当日已提醒），与原设置项/到点提醒逻辑完全同源 */
function enhBreakDefaults() {
  if (typeof appData === 'undefined' || !appData) return null;
  if (!appData.enhSettings) appData.enhSettings = {};
  let s = appData.enhSettings;
  let empty = function () {
    return { on: false, t: '', label: '' };
  };
  if (!Array.isArray(s.special) || s.special.length < 4) {
    s.special = [empty(), empty(), empty(), empty()];
  }
  for (let i = 0; i < s.special.length; i++) {
    if (!s.special[i] || typeof s.special[i] !== 'object') s.special[i] = empty();
  }
  if (!s.sbDone || typeof s.sbDone !== 'object') s.sbDone = {};
  if (!Array.isArray(s.reminds)) s.reminds = []; /* 通用定点提醒 {id,on,t,label} */
  if (!s.remindDone || typeof s.remindDone !== 'object') s.remindDone = {}; /* 当日已提醒 {date:{id:1}} */
  return s;
}
/* ⏰ 提醒页签：上半「定点提醒」（自定义时间+事项），下半「定点休息」（原有 4 组休息槽） */
function renderPlanBreakView() {
  let box = document.getElementById('planBreakView');
  if (!box) return;
  let s = enhBreakDefaults();
  if (!s) return;
  /* ===== 卡片1：定点提醒 ===== */
  let html =
    '<div style="padding:var(--sp-16) var(--sp-16);border-radius:var(--radius-lg);background:var(--card);border:1px solid var(--border)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);margin-bottom:var(--sp-2)">' +
    '<div style="font-size:var(--fs-title);font-weight:900;color:var(--text)">⏰ 定点提醒</div>' +
    '<span class="ph-btn" onclick="togglePh(this,\'phRemindDesc\')" style="flex:0 0 auto;font-size:var(--fs-caption);color:var(--text-light);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-10);cursor:pointer">ⓘ 说明 ▾</span>' +
    '</div>' +
    '<div id="phRemindDesc" style="display:none;font-size:var(--fs-note);color:var(--text-light);line-height:1.7;margin:var(--sp-8) 0 var(--sp-2)">⏰ 到点就弹出来提醒你，<b style="color:var(--text)">点「知道了」才算收到</b>；没点就每分钟再提醒一次，当天一直有效；临时不想处理可以点「稍后 10 分钟」，到点它会再来（同时有好几条就一条一条确认）。选「🔁 每天重复」＝每天这个点提醒；选「📅 只提醒一次」＝只在选定的那一天提醒，点掉后自动关闭。正在专注时不打断，只轻提示一次，这轮专注结束接着提醒。</div>';
  let arr = s.reminds || [];
  if (!arr.length) {
    html +=
      '<div style="padding:var(--sp-6) 0 var(--sp-10);color:var(--text-light);font-size:var(--fs-body);line-height:1.6">还没有提醒，在下面加一条吧</div>';
  } else {
    html += '<div class="ios-list">';
    for (let i = 0; i < arr.length; i++) {
      let r = arr[i] || {};
      let rep = r.repeat === 'once' ? 'once' : 'daily';
      let todayMini = getTodayStr();
      html +=
        '<div class="ios-row' + (r.on ? '' : ' ios-row-off') + '">' +
        '<div class="ios-row-main">' +
        '<input type="time" data-rmt="' +
        i +
        '" value="' +
        (r.t || '') +
        '" class="ios-time-input">' +
        '<input type="text" maxlength="30" placeholder="提醒我做什么？" data-rml="' +
        i +
        '" value="' +
        escapeHtml(r.label || '') +
        '" class="ios-label-input">' +
        '<div class="ios-chip-row">' +
        '<select data-rmr="' +
        i +
        '" onchange="remindChangeRep(' +
        r.id +
        ',this.value)" title="重复方式" class="ios-chip">' +
        '<option value="daily"' +
        (rep === 'daily' ? ' selected' : '') +
        '>🔁 每天</option>' +
        '<option value="once"' +
        (rep === 'once' ? ' selected' : '') +
        '>📅 一次</option></select>' +
        (rep === 'once'
          ? '<input type="date" data-rmd="' +
            i +
            '" value="' +
            (r.date || todayMini) +
            '" min="' +
            todayMini +
            '" onchange="remindChangeDate(' +
            r.id +
            ',this.value)" class="ios-chip">'
          : '<span class="ios-chip ios-chip-quiet">像闹钟，每天这个点</span>') +
        '</div>' +
        '</div>' +
        '<div class="ios-row-right">' +
        '<label class="ios-switch"><input type="checkbox" data-rm="' +
        i +
        '"' +
        (r.on ? ' checked' : '') +
        '><span class="ios-switch-slider"></span></label>' +
        '<button type="button" class="ios-row-del" onclick="delRemind(' +
        r.id +
        ')" title="删除这条提醒">✕</button>' +
        '</div>' +
        '</div>';
    }
    html += '</div>';
  }
  html +=
    '<div style="padding:var(--sp-10) var(--sp-12);border:0;border-top:1px solid var(--hairline);border-radius:0;background:transparent;margin-top:var(--sp-10)">' +
    '<div style="display:flex;align-items:center;gap:var(--sp-8);flex-wrap:wrap">' +
    '<input type="time" id="remindNewTime" value="09:00" class="flat-time" style="flex:0 0 104px;padding:0;border:0;background:transparent;color:var(--text)">' +
    '<select id="remindNewRep" onchange="syncNewRemindDate()" class="flat-select" style="padding:0;border:0;background:transparent;color:var(--text);font-size:var(--fs-note)">' +
    '<option value="daily">🔁 每天重复</option>' +
    '<option value="once">📅 只提醒一次</option></select>' +
    '<input type="date" id="remindNewDate" class="flat-time" style="display:none;flex:0 0 auto;padding:0;border:0;background:transparent;color:var(--text);font-size:var(--fs-note)">' +
    '<button class="btn-small" type="button" onclick="addRemind()" style="background:var(--fill-primary);color:var(--on-fill);margin-left:auto">＋ 添加提醒</button>' +
    '</div>' +
    '<input type="text" maxlength="30" id="remindNewLabel" placeholder="提醒我做什么？例如：站起来喝水 / 开会 / 吃药…" class="flat-input" style="width:100%;margin-top:var(--sp-6);padding:0;border:0;background:transparent;color:var(--text);font">' +
    '</div>' +
    '</div>';
  /* ===== 卡片2：定点休息 ===== */
  html +=
    '<div style="padding:var(--sp-16) var(--sp-16);border-radius:var(--radius-lg);background:var(--card);border:1px solid var(--hairline);margin-top:var(--sp-14)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);margin-bottom:var(--sp-2)">' +
    '<div style="font-size:var(--fs-title);font-weight:900;color:var(--text)">🍱 定点休息</div>' +
    '<span class="ph-btn" onclick="togglePh(this,\'phBreakDesc\')" style="flex:0 0 auto;font-size:var(--fs-caption);color:var(--text-light);border:1px solid var(--border);border-radius:var(--radius-full);padding:var(--sp-2) var(--sp-10);cursor:pointer">ⓘ 说明 ▾</span>' +
    '</div>' +
    '<div id="phBreakDesc" style="display:none;font-size:var(--fs-note);color:var(--text-light);line-height:1.7;margin:var(--sp-8) 0 var(--sp-2)">固定时刻提醒休息（如 12:00 午餐、15:30 下午茶）。空闲时直接弹窗；专注中先提示、本轮结束后再弹。每天最多 4 组。</div>';
  for (let i2 = 0; i2 < 4; i2++) {
    let slot = s.special[i2] || { on: false, t: '', label: '' };
    html +=
      '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-8) 0;border-bottom:1px solid var(--hairline)">' +
      '<label style="display:flex;align-items:center;flex:0 0 auto"><input type="checkbox" data-sb="' +
      i2 +
      '"' +
      (slot.on ? ' checked' : '') +
      ' style="accent-color:var(--primary)"></label>' +
      '<input type="time" data-sbt="' +
      i2 +
      '" value="' +
      (slot.t || '') +
      '" class="flat-time" style="flex:0 0 108px;padding:0;border:0;background:transparent;color:var(--text)">' +
      '<input type="text" maxlength="8" placeholder="备注：午餐…" data-sbl="' +
      i2 +
      '" value="' +
      escapeHtml(slot.label || '') +
      '" class="flat-text" style="flex:1;min-width:0;padding:0;border:0;background:transparent;color:var(--text);font-size:var(--fs-body)">' +
      '</div>';
  }
  html +=
    '<div style="display:flex;align-items:center;gap:var(--sp-10);flex-wrap:wrap;margin-top:var(--sp-10)">' +
    '<button class="btn-small" type="button" id="planSbReset" style="font-size:var(--fs-body)">↻ 重置今日「已提醒」记录</button>' +
    '<span style="font-size:var(--fs-caption);color:var(--text-light);line-height:1.6">休息提醒在到点后 5 分钟内触发，当天不重复；定点提醒到点即弹、没点「知道了」就每分钟再催一次。「重置」会清掉今天的「已提醒」记录（休息+提醒）。</span>' +
    '</div></div>';
  box.innerHTML = html;
  /* 绑定：定点提醒列表 */
  let rcbs = box.querySelectorAll('[data-rm]'),
    rtis = box.querySelectorAll('[data-rmt]'),
    rlis = box.querySelectorAll('[data-rml]');
  let arr2 = enhBreakDefaults().reminds || [];
  for (let k = 0; k < arr2.length; k++) {
    (function (idx, id) {
      if (rcbs[idx])
        rcbs[idx].addEventListener('change', function (ev) {
          let s2 = enhBreakDefaults();
          if (s2.reminds[idx]) s2.reminds[idx].on = ev.target.checked;
          remindRearm(id); /* 关掉 → 撤掉待确认；再打开 → 今天重新算 */
          saveData();
        });
      if (rtis[idx])
        rtis[idx].addEventListener('change', function (ev) {
          let s2 = enhBreakDefaults();
          if (s2.reminds[idx]) s2.reminds[idx].t = ev.target.value || '';
          remindRearm(id); /* 改了时间 → 重新武装这一天 */
          saveData();
        });
      if (rlis[idx])
        rlis[idx].addEventListener('input', function (ev) {
          let s2 = enhBreakDefaults();
          if (s2.reminds[idx]) s2.reminds[idx].label = ev.target.value || '';
          saveData();
        });
    })(k, arr2[k].id);
  }
  /* 绑定：定点休息 4 槽 */
  let cbs = box.querySelectorAll('[data-sb]'),
    tis = box.querySelectorAll('[data-sbt]'),
    lbs = box.querySelectorAll('[data-sbl]');
  for (let j = 0; j < 4; j++) {
    (function (idx) {
      if (cbs[idx])
        cbs[idx].addEventListener('change', function (ev) {
          enhBreakDefaults().special[idx].on = ev.target.checked;
          saveData();
        });
      if (tis[idx])
        tis[idx].addEventListener('change', function (ev) {
          enhBreakDefaults().special[idx].t = ev.target.value || '';
          saveData();
        });
      if (lbs[idx])
        lbs[idx].addEventListener('input', function (ev) {
          enhBreakDefaults().special[idx].label = ev.target.value || '';
          saveData();
        });
    })(j);
  }
  let rst = box.querySelector('#planSbReset');
  if (rst)
    rst.addEventListener('click', function () {
      let s3 = enhBreakDefaults();
      s3.sbDone = {};
      s3.remindDone = {};
      saveData();
      try {
        showToast('✅ 今日「已提醒」记录已重置（休息+提醒）');
      } catch (e) { if (window.__silent) window.__silent(e, '01e:renderPlanBreakView'); }
    });
}
/* —— 定点提醒：增删 —— */
/* —— 折叠说明：点「ⓘ 说明」展开/收起（默认收起，不挡视线） —— */
function togglePh(btn, descId) {
  let d = document.getElementById(descId);
  if (!d) return;
  let open = d.style.display !== 'none';
  d.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? 'ⓘ 说明 ▾' : 'ⓘ 说明 ▴';
}
/* ===== 定点提醒（413 行）已迁至 01eK_ui_remind.js（回退见该文件头注释）===== */
/* ===== 日志与回顾（1 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
/* 日志页右下角逐天跳转：第1次→今天，之后逐天往下，到底回到最新；目标日期不在当前页时自动翻页 */
let _logJumpDate = null;
/* ===== 日志与回顾（1 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
let editingCountdownId = null;
/* 专区排序方式：'date' 按剩余天数（默认，近的在上）｜'added' 按添加时间（新的在上）。
   只用内存变量、不落盘 —— 排序偏好不是数据，是临时视图，
   存进 appData 反而多一份真相要维护。 */
let countdownSortMode = 'date';
let overviewCalYear = 0,
  overviewCalMonth = 0;
let allDiaryPage = 1;
const ALL_DIARY_PAGE_SIZE = 10;
function renderDiaryOverviewPage() {
  const now = new Date();
  if (!overviewCalYear) {
    overviewCalYear = now.getFullYear();
    overviewCalMonth = now.getMonth();
  }
  renderOverviewCalendar();
  renderAllDiaryBrowser();
}
function renderAllDiaryBrowser() {
  const container = document.getElementById('allDiaryBrowser');
  const pagEl = document.getElementById('allDiaryPagination');
  if (!container) return;
  const dates = Object.keys(appData.diaries).sort().reverse();
  const totalPages = Math.max(1, Math.ceil(dates.length / ALL_DIARY_PAGE_SIZE));
  if (allDiaryPage > totalPages) allDiaryPage = totalPages;
  const start = (allDiaryPage - 1) * ALL_DIARY_PAGE_SIZE;
  const pageDates = dates.slice(start, start + ALL_DIARY_PAGE_SIZE);
  if (!dates.length) {
    container.innerHTML =
      '<div style="text-align:center;color:var(--text-light);padding:var(--sp-20) var(--sp-16);font-size:var(--fs-title);line-height:1.6">📖 还没有日记<br><span style="display:block;font-size:var(--fs-note);margin-top:var(--sp-8);color:var(--text-light)">今天有什么感悟？哪怕一句话，未来的你会感谢现在的记录</span></div>';
    if (pagEl) pagEl.innerHTML = '';
    return;
  }
  /* 条目正文**不再在这里手写字段**：一律走 00_pure_core 的 diaryOverviewParts()。
     那段手写的 `<b>进步：</b>…` 就是「日记加了感恩日记、总览看不见」的病根 ——
     字段清单写死在渲染函数里，加一个字段就要回来改一次，漏一次就静默丢一块内容。
     现在 rows（登记的字段）+ extra（没登记但有内容的字段）都来自同一张表。 */
  container.innerHTML = pageDates
    .map(date => {
      const d = appData.diaries[date];
      const isToday = date === getTodayStr();
      const parts = diaryOverviewParts(d);
      const rows = parts.rows
        .map(r => `<div><b>${escapeHtml(r.label)}：</b>${escapeHtml(r.text)}</div>`)
        .join('');
      /* 未登记字段用淡一点的颜色：内容照样看得见，但先不抢登记字段的视线 */
      const extra = parts.extra
        .map(r => `<div style="color:var(--text-light);"><b>${escapeHtml(r.label)}：</b>${escapeHtml(r.text)}</div>`)
        .join('');
      const fb = parts.feedback
        ? `<div style="color:var(--text-light);margin-top:var(--sp-4);">${escapeHtml(parts.feedback)}</div>`
        : '';
      const empty = !rows && !extra && !fb ? '<div style="color:var(--text-light);">（这天只建了空日记）</div>' : '';
      return `<div class="diary-overview-item" data-date="${date}"><div class="diary-overview-header" onclick="goToDiaryDate('${date}')"><span class="ov-date">📅 ${date}${isToday ? '（今天）' : ''}</span><span class="ov-arrow">▸</span></div><div class="diary-overview-body" style="font-size:var(--fs-body);line-height:1.6;">${rows}${extra}${fb}${empty}</div></div>`;
    })
    .join('');
  if (pagEl) {
    let pHtml = '';
    let diaryPageOpts = '';
    for (let p = 1; p <= totalPages; p++) {
      diaryPageOpts += `<option value="${p}"${p === allDiaryPage ? ' selected' : ''}>第 ${p} 页</option>`;
    }
    pHtml += `<button class="btn-small" ${allDiaryPage <= 1 ? 'disabled style="opacity:0.4;"' : ''} onclick="changeAllDiaryPage(-1)">‹ 上一页</button>`;
    pHtml += `<select onchange="jumpAllDiaryPage(this.value)" title="跳转到第几页" style="padding:var(--sp-4) var(--sp-8);border:2px solid var(--primary);border-radius:var(--radius-sm);font-size:var(--fs-body);font-weight:700;color: var(--primary-ink);background:var(--card);cursor:pointer;">${diaryPageOpts}</select>`;
    pHtml += `<span style="font-size:var(--fs-body);color:var(--text-light);">/ ${totalPages} 页</span>`;
    pHtml += `<button class="btn-small" ${allDiaryPage >= totalPages ? 'disabled style="opacity:0.4;"' : ''} onclick="changeAllDiaryPage(1)">下一页 ›</button>`;
    pagEl.innerHTML = pHtml;
  }
}

function changeAllDiaryPage(delta) {
  const dates = Object.keys(appData.diaries);
  const totalPages = Math.max(1, Math.ceil(dates.length / ALL_DIARY_PAGE_SIZE));
  allDiaryPage = Math.max(1, Math.min(totalPages, allDiaryPage + delta));
  renderAllDiaryBrowser();
}
function jumpAllDiaryPage(p) {
  const dates = Object.keys(appData.diaries);
  const totalPages = Math.max(1, Math.ceil(dates.length / ALL_DIARY_PAGE_SIZE));
  allDiaryPage = Math.max(1, Math.min(totalPages, parseInt(p, 10) || 1));
  renderAllDiaryBrowser();
}
function renderOverviewCalendar() {
  const _ovT = document.getElementById('overviewCalTitle');
  if (_ovT) _ovT.textContent = overviewCalYear + '年' + (overviewCalMonth + 1) + '月';
  const grid = document.getElementById('overviewCalendar');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let html = weekdays.map(w => `<div class="calendar-weekday">${w}</div>`).join('');
  const firstDay = new Date(overviewCalYear, overviewCalMonth, 1).getDay();
  const daysInMonth = new Date(overviewCalYear, overviewCalMonth + 1, 0).getDate();
  const today = getTodayStr();
  for (let i = 0; i < firstDay; i++) html += '<div class="calendar-day empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const ds =
      overviewCalYear + '-' + String(overviewCalMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const hasDiary = !!appData.diaries[ds];
    const isToday = ds === today;
    let cls = 'calendar-day';
    if (hasDiary) cls += ' has-diary';
    if (isToday) cls += ' today';
    const onclick = `onclick="goToDiaryDate('${ds}')"`;
    html += `<div class="${cls}" ${onclick}>${day}</div>`;
  }
  grid.innerHTML = html;
  renderOverviewJump();
}
/* 总览的「年 / 月」快跳面板。
   总览此前只能一月一月地翻 —— 想回看去年同一个月份要按 12 次。
   这里**复用**日记日历/专注记录日历那套 cal-jump 结构与样式（同一批 class、
   同一套「年 ‹ 2026 › + 12 个月」布局），三处日历行为一致，不各写一套。
   面板开着的时候换年/换月都不收起 —— 连着跳几个月不用反复点开。 */
let overviewCalJumpOpen = false;
function renderOverviewJump() {
  const box = document.getElementById('overviewJump');
  if (!box) return;
  box.style.display = overviewCalJumpOpen ? 'block' : 'none';
  if (!overviewCalJumpOpen) return;
  let monthHtml = '<span class="cal-jump-lbl">月</span>';
  for (let m = 1; m <= 12; m++) {
    monthHtml +=
      '<button class="cal-jump-m' +
      (m === overviewCalMonth + 1 ? ' on' : '') +
      '" onclick="overviewJumpMonth(' +
      m +
      ')">' +
      m +
      '</button>';
  }
  box.innerHTML =
    '<div class="cal-jump-line"><span class="cal-jump-lbl">年</span>' +
    '<button class="cal-jump-btn" onclick="changeOverviewYear(-1)">‹ 上年</button>' +
    '<span class="cal-jump-val" id="overviewJumpYear">' +
    overviewCalYear +
    '</span>' +
    '<button class="cal-jump-btn" onclick="changeOverviewYear(1)">下年 ›</button></div>' +
    '<div class="cal-jump-line">' +
    monthHtml +
    '</div>';
}
function toggleOverviewJump() {
  overviewCalJumpOpen = !overviewCalJumpOpen;
  renderOverviewJump();
}
function changeOverviewYear(delta) {
  overviewCalYear += Number(delta) || 0;
  renderDiaryOverviewPage();
}
function overviewJumpMonth(m) {
  overviewCalMonth = Math.max(0, Math.min(11, (Number(m) || 1) - 1));
  overviewCalJumpOpen = false;
  renderDiaryOverviewPage();
}
function changeOverviewMonth(delta) {
  overviewCalMonth += Number(delta) || 0;
  if (overviewCalMonth < 0) {
    overviewCalMonth = 11;
    overviewCalYear--;
  } else if (overviewCalMonth > 11) {
    overviewCalMonth = 0;
    overviewCalYear++;
  }
  renderDiaryOverviewPage();
}
function goToDiaryDate(date) {
  __set_currentDiaryDate(date);
  switchLogTab('diary');
}
/* 倒数日排序：按剩余天数（近的在前）。同一天用标题兜底，保证顺序稳定、不会每次重排都跳。 */
function _cdSort(a, b) {
  if (countdownSortMode === 'added') return (Number(b.id) || 0) - (Number(a.id) || 0);
  const d = getDaysUntil(a.date) - getDaysUntil(b.date);
  return d !== 0 ? d : String(a.title).localeCompare(String(b.title));
}
function setCountdownSort(mode) {
  countdownSortMode = mode === 'added' ? 'added' : 'date';
  const sel = document.getElementById('cdSortSelect');
  if (sel && sel.value !== countdownSortMode) sel.value = countdownSortMode;
  renderCountdowns();
}
/* 「展示在计划页」这件事**只留一个真相来源**：这里的两个函数。
   专区负责改（勾选），计划页/复盘页负责读。
   三处各写一份「取前 N 个」的判断，数量上限就会散落三地、互不相知。 */
function _isPinned(c) {
  return !!(c && (c.pinned === 1 || c.pinned === true || c.pinned === '1'));
}
function pinnedCountdowns() {
  const all = Array.isArray(appData.countdowns) ? appData.countdowns : [];
  return all.filter(_isPinned);
}
function renderCountdowns() {
  const list = document.getElementById('countdownList');
  if (!list) return;
  if (!appData.countdowns.length) {
    list.innerHTML =
      '<div style="text-align:center;color:var(--text-light);padding:40px;font-size:var(--fs-title);">还没有倒数日，点右上角添加</div>';
    return;
  }
  const sorted = [...appData.countdowns].sort(_cdSort);
  list.innerHTML = sorted
    .map(c => {
      const days = getDaysUntil(c.date);
      let color = 'var(--text-light)';
      if (days <= 7) color = 'var(--danger)';
      else if (days <= 30) color = 'var(--yellow-dark)';
      const isPin = _isPinned(c);
/* 勾选按钮必须 stopPropagation：整条卡片有 onclick（打开详情），
   不拦冒泡会「点了勾选，详情框也跟着弹」。 */
      const pinBtn =
        '<button class="btn-small" onclick="event.stopPropagation();toggleCountdownPin(' +
        idArg(c.id) +
        ')" title="' +
        (isPin ? '取消显示在计划页' : '显示在计划页') +
        '" style="flex-shrink:0;background:' +
        (isPin ? 'var(--primary)' : 'transparent') +
        ';color:' +
        (isPin ? 'var(--white)' : 'var(--text-light)') +
        ';border:2px solid ' +
        (isPin ? 'var(--primary)' : 'var(--border)') +
        ';padding:2px 8px;font-size:var(--fs-note);line-height:1.6;margin-right:var(--sp-6);">' +
        (isPin ? '📌 计划页' : '📌') +
        '</button>';
      const noteHtml = c.note
        ? '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          escapeHtml(c.note) +
          '</div>'
        : '';
      /* 首条高亮改「只在天数模式且未勾选时」才给：勾选模式下高亮会误导成「这条最重要」 */
      const borderLeft = '';
      return (
        '<div class="countdown-item" style="' +
        borderLeft +
        '" onclick="openCountdownDetail(' +
        idArg(c.id) +
        ')"><div style="font-size:34px;flex-shrink:0;width:40px;text-align:center;">' +
        escapeHtml(c.icon || '📌') +
        '</div><div class="countdown-info" style="min-width:0;"><div class="countdown-title">' +
        escapeHtml(c.title) +
        '</div><div class="countdown-date">' +
        escapeHtml(c.date) +
        (days >= 0 ? ' · 还剩' : ' · 已过') +
        Math.abs(days) +
        '天</div>' +
        noteHtml +
        '</div>' +
        pinBtn +
        '<div class="countdown-days"><div class="num" style="color:' +
        color +
        ';">' +
        (days >= 0 ? days : Math.abs(days)) +
        '</div><div class="unit">' +
        (days >= 0 ? '天后' : '天前') +
        '</div></div></div>'
      );
    })
    .join('');
}
function toggleCountdownPin(id) {
  const c = appData.countdowns.find(x => idEq(x.id, id));
  if (!c) return;
  const isPin = _isPinned(c);
  c.pinned = isPin ? 0 : 1;
  saveData();
  renderCountdowns();
  renderPlanCountdowns();
  renderDiary();
  showToast(isPin ? '已从计划页移除' : '已显示在计划页');
}
function renderPlanCountdowns() {
  const el = document.getElementById('planCountdownList');
  if (!el) return;
  const all = Array.isArray(appData.countdowns) ? appData.countdowns : [];
  if (!all.length) {
    el.innerHTML = '';
    return;
  }
  const sorted = [...all].sort(_cdSort);
  const pins = pinnedCountdowns().sort(_cdSort);
  /* 规则：计划页只显示在「倒数日」里勾选过的条目。
     一个都没勾时**不显示任何条目**，只留一行入口 —— 自动顶上「最近 1 条」不行：
     没勾过的也会出现在计划页，而且新加一个就把原来那行换掉，用户会以为
     「我加的东西被顶掉了」，也分不清哪条是自己勾的。
     「倒数日」整块已移入计划页，所以出口直接切计划页那个子标签就行。 */
  if (!pins.length) {
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg);border:1px solid var(--hairline);border-radius:var(--radius-sm);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-title);color:var(--text-light);cursor:pointer;" onclick="switchPlanTab(\'countdown\')"><span>📌 倒数日</span><span>全部 ' +
      sorted.length +
      ' 个 ▸</span></div>';
    return;
  }
  /* 「在『倒数日』里可调整」那行字太难看，删掉。
     但入口本身要留 —— 否则从计划页就没有路去倒数日了。
     改用整行标题可点 + 右侧一个 ▸ 表示可进入（不再放整句话）。 */
  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:var(--sp-6);cursor:pointer;" onclick="switchPlanTab(\'countdown\')">' +
    '<span style="font-size:var(--fs-title);color:var(--text-light);font-weight:700;">📌 你关注的日子</span>' +
    '<span style="font-size:var(--fs-caption);color:var(--text-light);">▸</span>' +
    '</div>' +
    pins
      .map(c => {
        const days = getDaysUntil(c.date);
        let color = 'var(--text-light)';
        if (days <= 7) color = 'var(--danger)';
        else if (days <= 30) color = 'var(--yellow-dark)';
        const noteHtml = c.note
          ? '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
            escapeHtml(c.note) +
            '</div>'
          : '';
        return (
          '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--card);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:var(--sp-8) var(--sp-12);margin-bottom:var(--sp-6);cursor:pointer;" onclick="openCountdownDetail(' +
          idArg(c.id) +
          ')"><div style="display:flex;align-items:center;gap:var(--sp-6);min-width:0;"><span style="font-size:var(--fs-hero);flex-shrink:0;">' +
          escapeHtml(c.icon || '📌') +
          '</span><div style="min-width:0;"><span style="font-size:var(--fs-title);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
          escapeHtml(c.title) +
          '</span>' +
          noteHtml +
          '</div></div><div style="font-size:var(--fs-title);font-weight:800;color:' +
          color +
          ';flex-shrink:0;margin-left:var(--sp-8);">' +
          (days >= 0 ? days : Math.abs(days)) +
          '<span style="font-size:var(--fs-title);font-weight:400;">' +
          (days >= 0 ? '天后' : '天前') +
          '</span></div></div>'
        );
      })
      .join('');
}

function openAddCountdownModal() {
  editingCountdownId = null;
  document.getElementById('countdownModalTitle').textContent = '➕ 新增倒数日';
  document.getElementById('countdownIcon').value = '📌';
  document.getElementById('countdownTitle').value = '';
  document.getElementById('countdownDate').value = getTodayStr();
  const _n0 = document.getElementById('countdownNote');
  if (_n0) _n0.value = '';
  const _p0 = document.getElementById('countdownPinned');
  if (_p0) _p0.checked = false;
  document.getElementById('countdownDeleteBtn').style.display = 'none';
  showModal('countdownModal');
}
function openEditCountdownModal(id) {
  const c = appData.countdowns.find(x => idEq(x.id, id));
  if (!c) return;
  editingCountdownId = id;
  document.getElementById('countdownModalTitle').textContent = '✏️ 编辑倒数日';
  document.getElementById('countdownIcon').value = c.icon || '📌';
  document.getElementById('countdownTitle').value = c.title;
  document.getElementById('countdownDate').value = c.date;
  const _n1 = document.getElementById('countdownNote');
  if (_n1) _n1.value = c.note || '';
  const _p1 = document.getElementById('countdownPinned');
  if (_p1) _p1.checked = _isPinned(c);
  document.getElementById('countdownDeleteBtn').style.display = '';
  showModal('countdownModal');
}
function saveCountdown() {
  const title = document.getElementById('countdownTitle').value.trim();
  const date = document.getElementById('countdownDate').value;
  const icon = document.getElementById('countdownIcon').value;
  const noteEl = document.getElementById('countdownNote');
  const note = noteEl ? noteEl.value.trim() : '';
  const pinEl = document.getElementById('countdownPinned');
  const pinned = pinEl && pinEl.checked ? 1 : 0;
  if (!title) {
    showToast('请输入事件名称');
    return;
  }
  if (!date) {
    showToast('请选择日期');
    return;
  }
  if (editingCountdownId) {
    const c = appData.countdowns.find(x => x.id === editingCountdownId);
    if (c) {
      c.title = title;
      c.date = date;
      c.icon = icon;
      c.note = note;
      c.pinned = pinned;
    }
  } else {
    appData.countdowns.push({
      id: Date.now(),
      uid: newUid('cd'),
      updatedAt: Date.now(),
      title: title,
      date: date,
      icon: icon,
      note: note,
      pinned: pinned,
    });
  }
  saveData();
  renderCountdowns();
  renderPlanCountdowns();
  closeModal('countdownModal');
  showToast('已保存');
}
function deleteCountdown(id, closeId) {
  /* 同 deleteRecord：避开原生 confirm 在 WebView 里静默返回 false 的坑。
     closeId 由调用方给（倒数日编辑框 / 详情框用的是不同的 modal），
     且**只在确认删除后**才关 —— rsConfirm 是异步的，写在外面会提前关掉。 */
  var doDel = function () {
    appData.countdowns = appData.countdowns.filter(c => !idEq(c.id, id));
    saveData();
    renderCountdowns();
    renderPlanCountdowns();
    closeModal(closeId || 'countdownModal');
    showToast('已删除');
  };
  var msg = '确定删除这个倒数日吗？';
  /* 同 deleteRecord：确认框弹出前先收起来源弹窗，避免两窗叠加；取消则放回。 */
  if (closeId) closeModal(closeId);
  if (typeof window.rsConfirm === 'function') {
    window.rsConfirm(msg, { title: '删除倒数日', okText: '删除', danger: true }).then(function (ok) {
      if (ok) { doDel(); } else if (closeId) { showModal(closeId); }
    });
  } else if (confirm(msg)) {
    doDel();
  } else if (closeId) {
    showModal(closeId);
  }
}
function openCountdownDetail(id) {
  const c = appData.countdowns.find(x => idEq(x.id, id));
  if (!c) return;
  const days = getDaysUntil(c.date);
  const total = Math.abs(days);
  const passed = days < 0 ? total : Math.max(0, total - 0);
  const related = appData.records.filter(
    r => r.taskName && r.taskName.includes(c.title) && !isLogRecord(r)
  );
  const pomoCount = related.filter(r => r.type === 'full').length + related.filter(r => r.type === 'half').length * 0.5;
  const focusMin = Math.floor(related.reduce((s, r) => s + (r.effectiveSeconds || 0), 0) / 60);
  document.getElementById('recordDetailTitle').textContent = (c.icon || '📌') + ' ' + c.title;
  document.getElementById('recordDetailBody').innerHTML =
    `<div class="settings-group"><div style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-10);">目标日期：${escapeHtml(c.date)}</div>${c.note ? `<div style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-10);">📝 ${escapeHtml(c.note)}</div>` : ''}<div style="display:flex;justify-content:space-around;text-align:center;margin:var(--sp-12) 0;"><div><div style="font-size:29px;font-weight:800;color: var(--primary-ink);">${days >= 0 ? days : Math.abs(days)}</div><div style="font-size:var(--fs-title);color:var(--text-light);">${days >= 0 ? '剩余天数' : '已过天数'}</div></div><div><div style="font-size:29px;font-weight:800;color: var(--green-ink);">${pomoCount}</div><div style="font-size:var(--fs-title);color:var(--text-light);">关联番茄</div></div><div><div style="font-size:29px;font-weight:800;color: var(--blue-ink);">${focusMin}</div><div style="font-size:var(--fs-title);color:var(--text-light);">专注分钟</div></div></div><div class="modal-buttons" style="margin-top:var(--sp-4)"><button class="modal-btn secondary" style="background:${_isPinned(c) ? 'var(--yellow-dark)' : 'var(--card)'};color:${_isPinned(c) ? 'var(--white)' : 'var(--text)'};" onclick="toggleCountdownPin(${idArg(c.id)});closeModal('recordDetailModal')">${_isPinned(c) ? '📌 已显示在计划页（点此取消）' : '📌 显示在计划页'}</button><button class="modal-btn secondary" onclick="closeModal('recordDetailModal');openEditCountdownModal(${idArg(c.id)})">✏️ 编辑</button></div><div class="modal-buttons" style="margin-top:var(--sp-8)"><button class="modal-btn danger" onclick="deleteCountdown(${idArg(c.id)},'recordDetailModal')">🗑️ 删除</button></div></div>`;
  showModal('recordDetailModal');
}
function toggleDiaryCountdown() {
  const dd = document.getElementById('diaryCountdownDropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}
/* 专注记录日历：弹窗月历，红点标记有记录的日期，点日期按天筛选 */
let logCalYear = 0,
  logCalMonth = 0;
/* ===== 日志与回顾（3 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
/* ===== 年月跳转（和日记日历同一套面板样式）=====
 * 之前只能一月一月点箭头：想翻到去年要按十几次。
 * 点标题展开：上年/下年 + 12 个月格子，一步到位。 */
let _logCalJumpOpen = false;
/* ===== 日志与回顾（8 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */

/* ===== 白噪音 + 我的歌单（387 行）已迁至 01eL_ui_audio.js（回退见该文件头注释）===== */
let _logLimit = 30;
let _logPage = 1;
const _logDaysPerPage = 7; /* 每页最多容纳 7 天（一周，按天分组折叠，超过即翻页） */
/* ===== 日志与回顾（2 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
let _logSig = '';
/* ===== 日志与回顾（9 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */

const _logOpenGroups = {};
/* ===== 日志与回顾（12 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
/* 某天的记录摘要：只取任务名，去重后最多列 REVIEW_CHIP_MAX 个（弹窗里够看，不用滚） */
const REVIEW_CHIP_MAX = 3;
/* ===== 日志与回顾（2 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
/* 当前正在看哪一天的详情；null = 停在「待回顾列表」。
   只是弹窗内部的临时视图状态，不落盘（关掉弹窗即忘，符合"看一眼就走"）。 */
let _reviewDayView = null;
/* 待回顾列表已展开到第几屏（0 = 只显示第一屏）。上限由「回顾设置」里的
   「一次最多显示 N 天」决定（settings.reviewMaxDays，0 = 不限）。
   断更两周再打开回顾，一次铺几十张卡滚不到底，所以默认收在 10 天。 */
let _reviewShownPages = 0;
/* ===== 日志与回顾（16 个函数）已迁至 01eD_ui_log.js（回退见该文件头注释）===== */
let activeMoreMenu = null;
function showMoreMenu(e, id) {
  document.querySelectorAll('.more-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'more-menu';
  /* ⚠️ 每个菜单项都要 event.stopPropagation()：
     菜单是 appendChild 到 .timeline-content 里的，而那张卡片自身带
     onclick="openRecordDetail(id)"。菜单项不拦冒泡的话，点「删除记录」会在
     弹出确认框之后**又冒泡触发卡片**，把记录详情弹窗打开 —— 就出现「确认框
     下面还压着一个弹窗」。 */
  let items = `<div class="more-menu-item" onclick="event.stopPropagation();editRecordField(${idArg(id)})">编辑/补填</div>`;
  const r = appData.records.find(x => idEq(x.id, id));
  if (r && r.type === 'interrupted')
    items += `<div class="more-menu-item" onclick="event.stopPropagation();closeMoreMenu();openRecordDetail(${idArg(id)})">查看打断详情</div>`;
  items += `<div class="more-menu-item danger" onclick="event.stopPropagation();deleteRecord(${idArg(id)})">删除记录</div>`;
  menu.innerHTML = items;
  e.target.closest('.timeline-content').appendChild(menu);
  activeMoreMenu = menu;
  setTimeout(() => document.addEventListener('click', closeMoreMenu, { once: true }), 10);
}
function closeMoreMenu() {
  if (activeMoreMenu) {
    activeMoreMenu.remove();
    activeMoreMenu = null;
  }
}
function editRecordField(id) {
  closeMoreMenu();
  openRecordDetail(id);
}
function deleteRecord(id, closeId) {
  closeMoreMenu();
  /* ⚠️ 不用原生 confirm：Android WebView 未实现 onJsConfirm 时会**静默返回 false**，
     表现就是「点了删除没反应、记录还在」。
     rsConfirm 是应用内弹窗（0C_w53），无 Promise 环境才回退原生。
     id 比较走 idEq：备份/导入来的 id 可能是字符串，严格 === 会静默漏删。
     closeId：确认删除后才关闭的弹窗 id（详情页删除按钮传 'recordDetailModal'）。
     ⚠️ 不能在外面写 `deleteRecord(id);closeModal(...)` —— rsConfirm 是异步的，
     那样会在**还没问用户**时就把详情页关掉，点「取消」也回不来。 */
  var msg = '确定删除这条记录吗？';
  var doDel = function () {
    /* 先留一份被删记录：它们当初发的树积分/计划账要在这里收回去。
       （抽奖次数已由 records 派生，删掉记录即自动回落，不需在此处理。） */
    var _gone = appData.records.filter(function (r) { return idEq(r.id, id); });
    appData.records = appData.records.filter(function (r) { return !idEq(r.id, id); });
    /* 墓碑：物理删除之外留一条「这条没了」的凭证。没有它，换设备/同步时
       服务端只会看到「这边比它少一条」，于是把已删记录原样拉回来。 */
    _gone.forEach(function (r) { tombstone(r.uid, 'record'); });
    tbInvalidateSegIndex(); /* 删记录 → 段落索引失效 */
    revertRecordRewards(_gone);
    saveData();
    updateTodayStats();
    updateRoundStats();
    renderTreeSection();
    renderLogs();
    if (closeId) closeModal(closeId);
    showToast('已删除');
  };
  /* ⚠️ 确认框弹出前先把详情页收起来：否则两个弹窗会**叠在一起**
     （「点删除那个弹窗，它下面还有一个弹窗」）。
     点「取消」再把详情页放回来，保住编辑上下文。 */
  if (closeId) closeModal(closeId);
  if (typeof window.rsConfirm === 'function') {
    window.rsConfirm(msg, { title: '删除记录', okText: '删除', danger: true }).then(function (ok) {
      if (ok) { doDel(); } else if (closeId) { showModal(closeId); }
    });
  } else if (confirm(msg)) {
    doDel();
  } else if (closeId) {
    showModal(closeId);
  }
}
/* 详情弹窗的类型下拉：按本条**实际时长**开放选项，与结算/补记同一套门槛
   （完整🍅 ≥15 分钟、半个🍅 ≥5 分钟；未完成与仅记录不限时长）。
   改类型只影响这条记录与统计口径，不追溯已发的奖励。 */
function fillDetailTypeOptions(r) {
  const sel = document.getElementById('detailRecordType');
  if (!sel) return;
  const sec = Math.max(0, Math.floor(r.effectiveSeconds || 0));
  const opts = [
    ['full', '完整🍅（折算 ' + fmtTomatoNum(calcPomos(sec, 'full')) + ' 个）', sec < MIN_FULL_MINUTES * 60],
    ['half', '半个🍅（折算 0.5 个）', sec < 5 * 60],
    ['incomplete', '未完成（不算番茄）', false],
    ['log', '仅记录（只记时间，不算番茄）', false]
  ];
/* 早期版本 / 导入备份里的「打断」类型：新记录已不再产生它，常规下拉不放。
   但这条记录本身就是打断时补一个原样选项，免得被静默改成别的类型。 */
  if (r.type === 'interrupted') opts.push(['interrupted', '打断（旧记录，保留原样）', false]);
  sel.innerHTML = opts
    .map(function (o) {
      return '<option value="' + o[0] + '"' + (o[2] ? ' disabled' : '') + '>' + o[1] + '</option>';
    })
    .join('');
  /* 老数据/导入的未知类型已归一成 log，这里兜底：认不出来的值一律按「仅记录」摆 */
  sel.value = r.type;
  if (!sel.value) sel.value = 'log';
  onDetailTypeChange();
}
/* 切换类型时给出后果说明（下拉选项本身只写折算数量，不解释影响） */
function onDetailTypeChange() {
  const sel = document.getElementById('detailRecordType');
  const hint = document.getElementById('detailTypeHint');
  if (!sel || !hint) return;
  const t = sel.value;
  if (t === 'interrupted') hint.textContent = '打断：旧版本留下的记录类型，只作展示用，不算番茄。改成上面四种之一才会重算口径。';
  else if (t === 'log') hint.textContent = '仅记录：只把这段时间记进日志，不算番茄、不进专注效率、不发金币。';
  else if (t === 'incomplete') hint.textContent = '未完成：保留时长记录，但不算番茄、占专注效率的分母。';
  else hint.textContent = '改类型只影响这条记录与统计数据；已发的金币/连击不追溯。';
}

function openRecordDetail(id) {
  const r = appData.records.find(x => idEq(x.id, id));
  if (!r) return;
  const typeMap = { full: '完整🍅', half: '半个🍅', incomplete: '未完成', interrupted: '打断', log: '仅记录' };
  /* 「仅记录」的时长只是这段时间的长度，不是专注时长，说明要写清 */
  const durTxt = isLogRecord(r)
    ? Math.floor((r.effectiveSeconds || 0) / 60) + ' 分钟（不计入专注）'
    : Math.floor(r.effectiveSeconds / 60) + '分' + r.effectiveSeconds % 60 + '秒';
  let interruptHtml = '';
  if (r.interruptions && r.interruptions.length) {
    interruptHtml = `<div class="settings-group" style="margin-top:var(--sp-12);"><h3>打断明细（共${r.interruptions.length}次，累计${r.totalInterruptSeconds}秒）</h3>`;
    r.interruptions.forEach((it, i) => {
      interruptHtml += `<div class="harvest-item">第${i + 1}次：${escapeHtml(it.reason || '未填写原因')}（${it.duration}秒）</div>`;
    });
    interruptHtml += '</div>';
  }
  document.getElementById('recordDetailTitle').textContent = '📋 记录详情';
  document.getElementById('recordDetailBody').innerHTML =
    `<div class="settings-group"><h3>基本信息</h3><div class="setting-row"><div class="setting-label">类型</div><select class="setting-input" id="detailRecordType" onchange="onDetailTypeChange()" style="flex:1;"></select></div><div style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-4);">有效时长：${durTxt}</div><div id="detailTypeHint" style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-10);line-height:1.5;"></div><div class="setting-row"><div class="setting-label">任务名称</div><input type="text" class="setting-input" id="detailTaskName" value="${escapeHtml(r.taskName || '')}" style="flex:1;"></div><div class="setting-row"><div class="setting-label">备注</div></div><textarea id="detailNote" style="width:100%;padding:var(--sp-8);border:1px solid var(--border-strong);border-radius:var(--radius-sm);min-height:60px;font-family:inherit;">${escapeHtml(r.note || '')}</textarea><div class="state-section" style="margin-top:var(--sp-10);"><div class="state-section-title">专注开始时的状态</div><div class="state-row"><span class="state-icon">🔋</span><div class="grid-picker" id="detailStartEnergyPicker"></div><span class="state-label" id="detailStartEnergyLabel"></span></div><div class="state-row"><span class="state-icon">😊</span><div class="grid-picker" id="detailStartMoodPicker"></div><span class="state-label" id="detailStartMoodLabel"></span></div></div><div class="state-section" style="margin-top:var(--sp-10);"><div class="state-section-title">专注结束时的状态（可修改）</div><div class="state-row"><span class="state-icon">🔋</span><div class="grid-picker" id="detailEndEnergyPicker"></div><span class="state-label" id="detailEndEnergyLabel"></span></div><div class="state-row"><span class="state-icon">😊</span><div class="grid-picker" id="detailEndMoodPicker"></div><span class="state-label" id="detailEndMoodLabel"></span></div></div><div class="modal-buttons" style="margin-top:var(--sp-12)"><button class="modal-btn primary" onclick="saveRecordDetail(${idArg(id)})">保存修改</button></div><div class="modal-buttons" style="margin-top:var(--sp-8)"><button class="modal-btn danger" onclick="deleteRecord(${idArg(id)},'recordDetailModal')">删除记录</button></div></div>${interruptHtml}`;
  showModal('recordDetailModal');
  fillDetailTypeOptions(r);
  injectDetailPlanRow(r);
  renderGridPicker('detailStartEnergyPicker', r.startEnergy, 'green');
  renderGridPicker('detailStartMoodPicker', r.startMood, 'yellow');
  renderGridPicker('detailEndEnergyPicker', r.energy, 'green');
  renderGridPicker('detailEndMoodPicker', r.mood, 'yellow');
}
/* 记录详情里的「关联计划」行 —— **事后补挂**的入口。
   为什么需要：补记 / 自由专注产生的记录很可能没有 todoId
   （旧版本连字段都不写；就算写也只有「任务名精确匹配」这一条路，名字对不上就静默失联）。
   用户截图里那条「网站开发」就是这么一条：看着跟计划毫无关系。
   这里插一行下拉，把这些历史记录也能挂回计划上。
   实现上**动态插 DOM**（不改 openRecordDetail 里那段超长 innerHTML 串），
   锚点是「任务名称」那一行，插在它后面。 */
function injectDetailPlanRow(r) {
  const body = document.getElementById('recordDetailBody');
  const anchor = document.getElementById('detailTaskName');
  if (!body || !anchor) return;
  const wrap = anchor.closest ? anchor.closest('.setting-row') : null;
  const row = document.createElement('div');
  row.className = 'setting-row';
  const label = document.createElement('div');
  label.className = 'setting-label';
  label.textContent = '关联计划';
  const sel = document.createElement('select');
  sel.className = 'setting-input';
  sel.id = 'detailPlanId';
  sel.style.flex = '1';
  const opts = ['<option value="">不关联</option>'];
  const cur = r.todoId != null ? String(r.todoId) : '';
  let curInList = false;
  (appData.todos || []).forEach(function (t) {
    if (!t) return;
    if (String(t.id) === cur) curInList = true;
    opts.push(
      '<option value="' + escapeHtml(String(t.id)) + '">' +
      escapeHtml((t.title || '未命名') + (t.done ? '（已完成）' : '')) + '</option>'
    );
  });
  /* 计划被删过：当前关联的目标已不在 todos 里 —— 补一个只读项兜住，
     否则下拉会静默跳成「不关联」，用户一保存就把关联弄丢了。 */
  if (cur && !curInList) {
    opts.push(
      '<option value="' + escapeHtml(cur) + '">' +
      escapeHtml((r.planTitle || '原计划') + '（已删除）') + '</option>'
    );
  }
  sel.innerHTML = opts.join('');
  sel.value = cur;
  row.appendChild(label);
  row.appendChild(sel);
  if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(row, wrap.nextSibling);
  else body.insertBefore(row, body.firstChild);
}

function saveRecordDetail(id) {
  const r = appData.records.find(x => x.id == id || String(x.id) === String(id));
  if (!r) {
    showToast('❌ 找不到这条记录（id=' + id + '）');
    return;
  }
  r.taskName = document.getElementById('detailTaskName').value.trim() || '未命名任务';
  r.note = document.getElementById('detailNote').value.trim();
  const se = getGridValue('detailStartEnergyPicker');
  const sm = getGridValue('detailStartMoodPicker');
  r.startEnergy = se || null;
  r.startMood = sm || null;
  const e = getGridValue('detailEndEnergyPicker');
  const m = getGridValue('detailEndMoodPicker');
  r.energy = e || null;
  r.mood = m || null;
  /* 改类型：同一段时长下 pomos 跟着新类型重算，并按差值**对账**树积分与计划账

     金币与连击仍不追溯：那些是结算瞬间的存量，追不回也不该倒扣。 */
  const _typeSel = document.getElementById('detailRecordType');
  if (_typeSel && _typeSel.value && _typeSel.value !== r.type) {
    const _oldType = r.type;
    const _oldPomos = getPomos(r);
    r.type = _typeSel.value;
    r.pomos = calcPomos(r.effectiveSeconds || 0, r.type);
    adjustRecordRewards(r, _oldType, _oldPomos);
    updateTodayStats();
    updateRoundStats();
  }
  /* 关联计划的改挂 / 摘除：只改**这条记录自己的快照**。
     不回写计划的实际番茄账 —— 那块账在计时/补记当时就已经记过一次，
     这里再加减就是重复计（改类型同理，见上面的注释）。
     摘除关联（选「不关联」）会把快照字段一并清空，日志卡随之不再画归属行。 */
  const _planSel = document.getElementById('detailPlanId');
  if (_planSel) {
    const v = String(_planSel.value || '');
    const oldId = r.todoId != null ? String(r.todoId) : '';
    if (v !== oldId) {
      const t = findTodoByIdStr(v);
      r.todoId = t ? t.id : null;
      r.tag = t && t.tag ? t.tag : null;
      r.quad = t ? normQuad(t.quad) : null;
      r.planTitle = t ? t.title || null : null;
      r.planSubs = t ? snapshotPlanSubs(t, r.endTime) : null;
      /* 换了计划，原先「正在做的那一步」已不适用 → 一起清掉，不留在记录里误导 */
      r.subTitle = null;
      r.subId = null;
    }
  }
  /* 编辑即刷新 updatedAt：否则这条记录的时间戳仍停在三个月前，
     同步时会被判定为「服务端更新」而被覆盖，用户刚改的内容凭空消失。 */
  touchRecord(r);
  saveData();
  /* 编辑记录（任务名/心情/精力）不改变统计缓存键的任何分量，
     必须显式失效，否则任务聚合/心情曲线长期显示旧值直至下一条新记录 */
  invalidateStatsCache();
  renderLogs();
  closeModal('recordDetailModal');
  showToast('✅ 已保存');
}
function fillAddRecordTimeOptions(now) {
  const hSel = document.getElementById('addRecordHour');
  const mSel = document.getElementById('addRecordMinute');
  if (!hSel || !mSel) return;
  hSel.innerHTML = '';
  for (let i = 0; i < 24; i++) {
    const o = document.createElement('option');
    o.value = String(i).padStart(2, '0');
    o.textContent = String(i).padStart(2, '0');
    hSel.appendChild(o);
  }
  mSel.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const o = document.createElement('option');
    o.value = String(i).padStart(2, '0');
    o.textContent = String(i).padStart(2, '0');
    mSel.appendChild(o);
  }
  hSel.value = String(now.getHours()).padStart(2, '0');
  mSel.value = String(now.getMinutes()).padStart(2, '0');
}
function updateAddRecordEnd() {
  const h = parseInt(document.getElementById('addRecordHour').value) || 0;
  const m = parseInt(document.getElementById('addRecordMinute').value) || 0;
  const dur = parseInt(document.getElementById('addRecordDuration').value) || 0;
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const d = new Date(base);
  d.setHours(h, m + dur, 0, 0);
  let txt = fmtTime(d);
  if (d.getDate() !== base.getDate()) txt = '次日 ' + txt;
  const el = document.getElementById('addRecordEndShow');
  if (el) el.textContent = txt;
}
function openAddRecordModal() {
  const now = new Date();
  document.getElementById('addRecordDate').value = getTodayStr();
  fillAddRecordTimeOptions(now);
  document.getElementById('addRecordTask').value = '';
  document.getElementById('addRecordDuration').value = '25';
  document.getElementById('addRecordType').value = 'full';
  renderGridPicker('addRecordEnergyPicker', null, 'green');
  renderGridPicker('addRecordMoodPicker', null, 'yellow');
  fillAddRecordPlanOptions();
  showModal('addRecordModal');
  updateAddRecordEnd();
}

/* ===== 补记的「关联计划」下拉 =====
   背景——
   而根因就在这里：原实现只有一句 `todos.find(x => x.title === task)`，
   按**任务名精确匹配**找计划。名字差一个字（或干脆是临时起的名字）就静默失联，
   记录落盘时连 todoId 都不写，日志卡自然什么都显示不出来。
   现在给一个**显式入口**；名字匹配降级为「没选下拉时的兼容兜底」。 */
function fillAddRecordPlanOptions() {
  const sel = document.getElementById('addRecordPlan');
  const sub = document.getElementById('addRecordSub');
  if (sub) {
    sub.innerHTML = '<option value="">整条计划</option>';
    sub.disabled = true;
  }
  if (!sel) return;
  /* 只列**未完成**的计划：已完成的再补记一条专注，挂上去语义不对
     （完成流水那条路径已经负责呈现「当天完成的计划」）。顺序沿用列表顺序。 */
  const list = (appData.todos || []).filter(function (t) {
    return t && !t.done && !(t.archived);
  });
  const opts = ['<option value="">不关联</option>'];
  list.forEach(function (t) {
    const nm = t.title || '未命名';
    const subs = Array.isArray(t.subs) ? t.subs.length : 0;
    const quad = normQuad(t.quad);
    const qm = quad ? quadMeta(quad) : null;
    const qn = qm ? qm.short + ' · ' : '';
    opts.push(
      '<option value="' + escapeHtml(String(t.id)) + '">' +
      escapeHtml(qn + nm + (subs ? '（' + subs + ' 步）' : '')) +
      '</option>'
    );
  });
  sel.innerHTML = opts.join('');
  sel.value = '';
}

/* 计划下拉联动：切换计划 → 重建子任务下拉，并把任务名回填。
   取消关联时**不动**已填的任务名（用户可能正想改它）。 */
function onAddRecordPlanChange() {
  const sel = document.getElementById('addRecordPlan');
  const taskEl = document.getElementById('addRecordTask');
  const t = findTodoByIdStr(sel ? sel.value : '');
  if (t && taskEl) taskEl.value = t.title || '';
  fillAddRecordSubOptions(t);
}

function fillAddRecordSubOptions(t) {
  const sub = document.getElementById('addRecordSub');
  if (!sub) return;
  const subs = t && Array.isArray(t.subs) ? t.subs : [];
  sub.innerHTML = '<option value="">整条计划</option>' + subs.map(function (s) {
    return (
      '<option value="' + escapeHtml(String(s && s.id)) + '">' +
      escapeHtml((s && s.done ? '✓ ' : '') + ((s && s.title) || '未命名')) +
      '</option>'
    );
  }).join('');
  sub.disabled = !subs.length;
}

/* 按 id 字符串找计划：下拉的 value 一律是 String(id)，比较也一律转字符串，
   免得数字 id（Date.now()）与字符串 id（mustdo_ 之类）两种形态对不上。 */
function findTodoByIdStr(v) {
  const key = String(v == null ? '' : v);
  if (!key) return null;
  return (
    (appData.todos || []).find(function (x) {
      return x && String(x.id) === key;
    }) || null
  );
}

function saveAddRecord() {
  const dateStr = (document.getElementById('addRecordDate').value || '').trim() || getTodayStr();
  const task = document.getElementById('addRecordTask').value.trim() || '未命名任务';
  const dur = parseInt(document.getElementById('addRecordDuration').value) || 25;
  const type = document.getElementById('addRecordType').value;
  if (type === 'full' && dur < 15) {
    showToast('❌ 完整番茄需要专注至少 15 分钟');
    return;
  }
  if (type === 'half' && dur < 5) {
    showToast('❌ 半个番茄需要专注至少 5 分钟');
    return;
  }
  const hh = document.getElementById('addRecordHour').value || '09';
  const mm = document.getElementById('addRecordMinute').value || '00';
  const start = new Date(dateStr + 'T' + hh + ':' + mm + ':00');
  if (isNaN(start.getTime())) {
    showToast('❌ 日期/时间无效，请检查');
    return;
  }
  const end = new Date(start.getTime() + dur * 60000);
  const ae = getGridValue('addRecordEnergyPicker');
  const am = getGridValue('addRecordMoodPicker');
  /* 计划关联两条路（优先级从高到低）：
     ① 显式选了「关联计划」下拉 → 用它（这才是用户看得见的入口）；
     ② 没选 → 退回按任务名精确匹配（老习惯：手动敲的计划名正好对得上）。
     两条都没命中 → 独立记录，**不写任何计划字段**（C47 用例 B4 就守这条）。 */
  const _planSel = document.getElementById('addRecordPlan');
  let lt = findTodoByIdStr(_planSel ? _planSel.value : '');
  if (!lt && task) lt = (appData.todos || []).find(x => String(x.title || '').replace(/\s+/g, ' ').trim() === String(task || '').replace(/\s+/g, ' ').trim()) || null;
  const _subSel = document.getElementById('addRecordSub');
  const _subKey = String((_subSel && _subSel.value) || '');
  const _curSub = lt && _subKey
    ? (lt.subs || []).find(function (s) {
        return s && String(s.id) === _subKey;
      }) || null
    : null;
  const _ap = calcPomos(dur * 60, type);
  if (lt && type !== 'log') lt.actualPomodoros = (lt.actualPomodoros || 0) + _ap;
  if (lt && type !== 'log') lt.timeSpent = (lt.timeSpent || 0) + dur * 60;
  tbInvalidateSegIndex(); /* 补记记录 → 段落索引失效（写在 push 之前，顺序无所谓，意在就近） */
  appData.records.push({
    id: Date.now() + Math.floor(Math.random() * 1000),
    uid: newUid('rec'),
    updatedAt: Date.now(),
    type: type,
    taskName: task,
    note: '',
    startTime: start.getTime(),
    endTime: end.getTime(),
    effectiveSeconds: dur * 60,
    pomos: _ap,
    interruptions: [],
    totalInterruptSeconds: 0,
    startEnergy: null,
    startMood: null,
    energy: ae || null,
    mood: am || null,
    expectedPomodoros: lt ? (lt.pomodoros != null ? lt.pomodoros : null) : null,
    actualPomodoros: lt ? lt.actualPomodoros || 0 : null,
    /* ★ 与计时路径（savePomodoroRecord）**同构**的计划快照。
       补记过去只写 expected/actual 两个番茄数，不写这些 —— 于是补记出来的记录
       在日志里既没有 📋 计划名、也没有子任务 chips，看着和计划毫无关系。
       快照而非引用：计划日后改了步骤，历史日志不改写。 */
    todoId: lt ? lt.id : null,
    tag: lt && lt.tag ? lt.tag : null,
    quad: lt ? normQuad(lt.quad) : null,
    subTitle: _curSub ? _curSub.title : null,
    subId: _curSub ? _curSub.id : null,
    planTitle: lt ? lt.title || null : null,
    planSubs: lt ? snapshotPlanSubs(lt, end.getTime()) : null
  });
  if (_ap > 0) addLotteryChance(Math.round(_ap));
  if (_ap > 0) addTreePoints(_ap);
  saveData();
  updateTodayStats();
  renderLogs();
  closeModal('addRecordModal');
  showToast(lt ? '已补记 · 已关联计划「' + (lt.title || '未命名') + '」' : '已补记');
  if (type === 'full' && dateStr === getTodayStr()) onPomodoroCompleteRank();
}
function showAutoSaveHint() {
  const hint = document.getElementById('autoSaveHint');
  if (!hint) return;
  hint.classList.add('show');
  clearTimeout(hint._timer);
  hint._timer = setTimeout(() => hint.classList.remove('show'), 2000);
}
function ensureDiary(date) {
  if (appData.diaries[date]) {
    const d = appData.diaries[date];
    if (!d.review) d.review = { progress: '', shortcomings: '', improvements: '', stop: '', other: '' };
    /* stop（该停止）是六期新加的：老日记没有这个键。
       不补一个空串也能跑（读的时候一律 String(x || '')），但补上之后
       「这条日记是哪一版写的」就不再靠字段存在与否去猜。 */
    if (d.review && d.review.stop === undefined) d.review.stop = '';
    if (!d.feedback) d.feedback = { sleepTime: '', wakeTime: '', sleepQuality: '', mentalState: '', sleepDay: 'prev' };
    if (d.feedback && !d.feedback.sleepDay) d.feedback.sleepDay = 'prev';
    if (d.planSnapshot === undefined) d.planSnapshot = [];
    return d;
  }
  return {
    plan: '',
    planSnapshot: [],
    review: { progress: '', shortcomings: '', improvements: '', stop: '', other: '' },
    feedback: { sleepTime: '', wakeTime: '', sleepQuality: '', mentalState: '', sleepDay: 'prev' }
  };
}
function cleanupEmptyDiaries() {
  let changed = false;
  for (const date of Object.keys(appData.diaries)) {
    const d = appData.diaries[date];
    const hasContent =
      d.plan ||
      (d.review && (d.review.progress || d.review.shortcomings || d.review.improvements || d.review.other)) ||
      (d.gratitude && Array.isArray(d.gratitude.items) && d.gratitude.items.length) ||
      (d.feedback &&
        (d.feedback.sleepTime || d.feedback.wakeTime || d.feedback.sleepQuality || d.feedback.mentalState));
    if (!hasContent) {
      delete appData.diaries[date];
      changed = true;
    }
  }
  if (changed) saveData();
}
function renderDiary() {
  renderDiarySingle();
}
/* 日记文本框自适应高：先归零再按 scrollHeight 定高（否则删字后不会变矮）。
   长到 CSS 的 max-height 就转框内滚动，不会把整页顶长。 */
function diaryAutoGrow(el) {
  if (!el) return;
  try {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  } catch (e) { if (window.__silent) window.__silent(e, '01e:diaryAutoGrow'); }
}
function diaryAutoGrowAll(prefix, date) {
  ['plan', 'rp', 'rs', 'ri', 'ro'].forEach(function (k) {
    diaryAutoGrow(document.getElementById(prefix + '_' + k + '_' + date));
  });
}
/* 日记里的小折叠（「其他记录」/「今日反馈」）：只切 display，**不重画整页** ——
   textarea 的值此刻还在 DOM 上、没同步进 state，重画会把用户刚打的字丢掉。 */
function toggleDiaryFoldHead(head) {
  const body = head.nextElementSibling;
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  head.classList.toggle('open', open);
  if (open) diaryAutoGrowAll('single', currentDiaryDate);
}
function buildDiaryForm(date, prefix) {
  const d = ensureDiary(date);
  let countdownHtml = '';
  const sorted = [...appData.countdowns].sort(_cdSort);
  if (sorted.length > 0) {
/* 与计划页共用同一套规则。
   下拉若固定列前 5 条、顺序还和专区不一致 —— 加了 10 个倒数日的人
   在复盘页永远看不到后 5 个。现在下拉列全部且与专区同序。 */
    const pins = sorted.filter(_isPinned);
    /* 与计划页同规则：复盘区也只自动显示勾选过的。
       一条都没勾时不再顶「最近 1 条」—— 「没添加到计划页的，它也自己
       出现在复盘页里」。此时只留一行可展开的入口，点开照旧能看到全部。 */
    const nearest = pins.length ? pins[0] : null;
    const days = nearest ? getDaysUntil(nearest.date) : 0;
    /* title/icon 为用户自由输入（备份导入路径亦可控），拼 innerHTML 前必须转义 */
    const text = nearest
      ? days === 0
        ? `今天就是'${escapeHtml(nearest.title)}'！`
        : `距离'${escapeHtml(nearest.title)}'还有 ${days} 天`
      : '';
    const color = days === 0 ? 'var(--danger)' : 'var(--text-light)';
    const dropdownItems = sorted
      .map(c => {
        const cd = getDaysUntil(c.date);
        const ct = cd === 0 ? `今天就是'${escapeHtml(c.title)}'！` : `距离'${escapeHtml(c.title)}'还有 ${cd} 天`;
        return `<div style="padding:var(--sp-8) var(--sp-12);border-bottom:1px solid var(--border);cursor:pointer;font-size:var(--fs-title);" onclick="event.stopPropagation();openCountdownDetail(${idArg(c.id)});document.getElementById('diaryCountdownDropdown').style.display='none';">${escapeHtml(c.icon || '📌')} ${ct}${_isPinned(c) ? ' <span style="font-size:var(--fs-caption);color:var(--text-light);">📌</span>' : ''}</div>`;
      })
      .join('');
    const cdHeadLine = nearest
      ? `<div style="background:var(--bg);border:1px dashed var(--yellow);border-radius:var(--radius-sm);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-title);color:${color};font-weight:600;cursor:pointer;" onclick="toggleDiaryCountdown()">${escapeHtml(nearest.icon || '📌')} ${text} <span style="float:right;">▾</span></div>`
      : `<div style="background:var(--bg);border:1px solid var(--hairline);border-radius:var(--radius-sm);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-title);color:var(--text-light);cursor:pointer;" onclick="toggleDiaryCountdown()">📌 倒数日 · 全部 ${sorted.length} 个 <span style="float:right;">▾</span></div>`;
    countdownHtml = `<div style="margin-bottom:var(--sp-12);">${cdHeadLine}<div id="diaryCountdownDropdown" style="display:none;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);margin-top:var(--sp-4);overflow:hidden;">${dropdownItems}</div></div>`;
  }
  // 昨日待改进自动带入
  const yd = new Date(date + 'T00:00:00');
  yd.setDate(yd.getDate() - 1);
  const yds = getDateStr(yd);
  const yesterdayImprove = ((appData.diaries[yds] && appData.diaries[yds].review && appData.diaries[yds].review.improvements) || '');
  const yesterdayHtml = yesterdayImprove
    ? `<div class="settings-group" style="margin-bottom:var(--sp-10);background:var(--bg);border:3px solid var(--border);"><h3 style="color:var(--blue-dark);">📌 昨日待改进</h3><div style="font-size:var(--fs-title);color:var(--text);padding:var(--sp-8);background:var(--card);border-radius:var(--radius-xs);line-height:1.6;">${escapeHtml(yesterdayImprove)}</div></div>`
    : '';
  /* 今日反馈的摘要：收起时也看得见「睡 7h · 精神 8」，不用展开就知道填过没 */
  const _fb = d.feedback || {};
  const _fbBits = [];
  if (_fb.sleepTime) _fbBits.push('睡 ' + escapeHtml(_fb.sleepTime));
  if (_fb.wakeTime) _fbBits.push('醒 ' + escapeHtml(_fb.wakeTime));
  if (_fb.sleepQuality) _fbBits.push('睡眠 ' + escapeHtml(String(_fb.sleepQuality)));
  if (_fb.mentalState) _fbBits.push('精神 ' + escapeHtml(String(_fb.mentalState)));
  const fbSummary = _fbBits.length ? _fbBits.join(' · ') : '还没填';
  /* 感恩日记：一天 1~3 条短句（三件好事练习）。读法容忍老日记没有这个字段。 */
  const _gr = (d.gratitude && Array.isArray(d.gratitude.items)) ? d.gratitude.items : [];
  let gratitudeGroup = '';
  for (let gi = 0; gi < 3; gi++) {
    gratitudeGroup +=
      '<div class="gratitude-row"><span class="gr-i">' + (gi + 1) + '</span>' +
      '<input type="text" id="' + prefix + '_gr_' + gi + '_' + date + '" maxlength="200"' +
      ' placeholder="第 ' + (gi + 1) + ' 件…" value="' + escapeHtml(_gr[gi] || '') + '"' +
      ' oninput="scheduleDiaryAutoSave(\'' + date + '\')"></div>';
  }
  gratitudeGroup =
    '<div class="settings-group" style="margin-bottom:var(--sp-10);"><h3>🙏 感恩日记</h3>' +
    '<div style="font-size:var(--fs-note);color:var(--text-light);margin-bottom:var(--sp-8);">今天有哪几件小事值得感谢？写不满也没关系，一件就够。</div>' +
    gratitudeGroup +
    '</div>';
  /* 复盘四栏：前三个常驻，第四个「其他记录」默认收起 —— 它最少用，
     却和另三个一样各占一屏高度，正是"每天要滑很久"的主要来源。
     填过内容就默认展开（不然用户看不到自己写过的东西）。 */
  const _roOpen = !!(d.review.other && String(d.review.other).trim());
  const _revFields =
    `<div class="diary-field"><label>今天进步</label><textarea id="${prefix}_rp_${date}" placeholder="写一件做成的、哪怕很小的事" oninput="scheduleDiaryAutoSave('${date}');diaryAutoGrow(this)">${escapeHtml(d.review.progress || '')}</textarea></div>` +
    `<div class="diary-field"><label>今天不足</label><textarea id="${prefix}_rs_${date}" placeholder="今天卡在哪、被打断了几次" oninput="scheduleDiaryAutoSave('${date}');diaryAutoGrow(this)">${escapeHtml(d.review.shortcomings || '')}</textarea></div>` +
    `<div class="diary-field"><label>明天改进</label><textarea id="${prefix}_ri_${date}" placeholder="明天只改一件" oninput="scheduleDiaryAutoSave('${date}');diaryAutoGrow(this)">${escapeHtml(d.review.improvements || '')}</textarea></div>` +
    /* 「该停止」和「今天不足」不是一回事：不足是「没做好」，停止是「就不该做」。
       合成一格时「刷了两小时短视频」会被写进不足里，而它真正需要的是被停掉，
       不是被改进。用单行而不是 textarea —— 这件事越短越有用。 */
    `<div class="diary-field"><label>该停止</label><input type="text" id="${prefix}_rst_${date}" maxlength="120" placeholder="今天最该戒掉的一件事（可选）" oninput="scheduleDiaryAutoSave('${date}')" value="${escapeHtml(d.review.stop || '')}"></div>` +
    `<div class="diary-subfold"><div class="diary-fold-head${_roOpen ? ' open' : ''}" onclick="toggleDiaryFoldHead(this)"><span>其他记录</span><span class="dfh-arrow">▸</span></div><div class="diary-fold-body" style="display:${_roOpen ? 'block' : 'none'}"><div class="diary-field"><textarea id="${prefix}_ro_${date}" placeholder="想记的杂事、情绪、想法…" oninput="scheduleDiaryAutoSave('${date}');diaryAutoGrow(this)">${escapeHtml(d.review.other || '')}</textarea></div></div></div>`;
  /* 今日反馈：**默认展开**——
     收起改为纯用户动作，不再由"填过没"自动决定；条目多时用户可自行点收起。 */
  const _fbOpen = true;
  return `${countdownHtml}${yesterdayHtml}<div class="settings-group" style="margin-bottom:var(--sp-10);"><h3>🔍 每日复盘</h3>${_revFields}</div>${gratitudeGroup}<div class="settings-group" style="margin-bottom:var(--sp-10);"><div class="diary-fold-head${_fbOpen ? ' open' : ''}" onclick="toggleDiaryFoldHead(this)"><h3 style="margin:0">😴 今日反馈<span style="font-size:var(--fs-caption);font-weight:400;color:var(--text-light);margin-left:var(--sp-6)">${fbSummary}</span></h3><span class="dfh-arrow">▸</span></div><div class="diary-fold-body" style="display:${_fbOpen ? 'block' : 'none'}"><div class="diary-row"><div class="diary-field"><label>昨晚入睡</label><div style="display:flex;gap:var(--sp-6);align-items:center;"><select id="${prefix}_fsd_${date}" onchange="scheduleDiaryAutoSave('${date}')" style="flex:1;min-width:0;padding:var(--sp-8);border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-size:var(--fs-body);background:var(--card);color:var(--text);"><option value="prev" ${(d.feedback.sleepDay || 'prev') === 'prev' ? 'selected' : ''}>昨晚</option><option value="today" ${(d.feedback.sleepDay || 'prev') === 'today' ? 'selected' : ''}>今天凌晨</option></select><input type="time" id="${prefix}_fs_${date}" value="${d.feedback.sleepTime || ''}" onchange="scheduleDiaryAutoSave('${date}')" style="flex:1.2;min-width:0;"></div><div style="font-size:var(--fs-tiny);color:var(--text-light);margin-top:var(--sp-2);">昨晚 23:30 睡选「昨晚」；拖到凌晨 1 点才睡选「今天凌晨」</div></div><div class="diary-field"><label>起床时间</label><input type="time" id="${prefix}_fw_${date}" value="${d.feedback.wakeTime || ''}" onchange="scheduleDiaryAutoSave('${date}')"></div></div><div class="diary-field"><label>睡眠质量</label><div class="grid-picker" id="${prefix}_fq_${date}_grid"></div><span id="${prefix}_fq_${date}_label" style="margin-left:var(--sp-8);font-size:var(--fs-body);font-weight:800;color:var(--blue-dark);"></span></div><div class="diary-field"><label>精神状态</label><div class="grid-picker" id="${prefix}_fe_${date}_grid"></div><span id="${prefix}_fe_${date}_label" style="margin-left:var(--sp-8);font-size:var(--fs-body);font-weight:800;color: var(--yellow-ink);"></span></div></div></div><button class="save-btn" onclick="forceSaveDiary('${date}');showToast('✅保存成功')">💾 立即保存</button>`;
}
function renderDiarySingle() {
  const view = document.getElementById('diarySingleView');
  const today = getTodayStr();
  if (!currentDiaryDate) __set_currentDiaryDate(today);
  const isToday = currentDiaryDate === today;
  /* 复盘提醒条挂在日记页顶部：它看的是日期和 reviews，跟记录集无关，
     所以不能塞进 renderLogs 的脏检查里（记录没变就跳过 → 跨过零点也不刷新）。 */
  try {
    if (typeof renderLogReviewBar === 'function') renderLogReviewBar();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:reviewBar'); }
  renderDailyFocusSummary(currentDiaryDate);
  renderBioSection();
  view.innerHTML = `<div class="diary-current-date">📅 ${currentDiaryDate}${isToday ? '（今天）' : ''}<button class="btn-small" style="margin-left:var(--sp-8);" onclick="openCalendarModal()">选择日期</button></div>${buildDiaryForm(currentDiaryDate, 'single')}`;
  initDiaryGrids('single', currentDiaryDate);
  /* 文本框按内容定高（要等元素进了 DOM 才量得到 scrollHeight） */
  diaryAutoGrowAll('single', currentDiaryDate);
}
function initDiaryGrids(prefix, date) {
  const fq = document.getElementById(prefix + '_fq_' + date + '_grid');
  const fe = document.getElementById(prefix + '_fe_' + date + '_grid');
  if (fq) {
    const d = ensureDiary(date);
    renderGridPicker(fq.id, d.feedback.sleepQuality ? parseInt(d.feedback.sleepQuality) : null, 'blue');
    fq.querySelectorAll('.grid-cell').forEach(cell => {
      cell.onclick = () => {
        setGridValue(fq.id, parseInt(cell.dataset.val));
        scheduleDiaryAutoSave(date);
      };
    });
  }
  if (fe) {
    const d = ensureDiary(date);
    renderGridPicker(fe.id, d.feedback.mentalState ? parseInt(d.feedback.mentalState) : null, 'yellow');
    fe.querySelectorAll('.grid-cell').forEach(cell => {
      cell.onclick = () => {
        setGridValue(fe.id, parseInt(cell.dataset.val));
        scheduleDiaryAutoSave(date);
      };
    });
  }
}
function scheduleDiaryAutoSave(date) {
  if (diaryAutoSaveTimers[date]) clearTimeout(diaryAutoSaveTimers[date]);
  diaryAutoSaveTimers[date] = setTimeout(() => {
    forceSaveDiary(date);
    showAutoSaveHint();
  }, 5000);
}
function forceSaveDiary(date) {
  if (diaryAutoSaveTimers[date]) {
    clearTimeout(diaryAutoSaveTimers[date]);
    diaryAutoSaveTimers[date] = null;
  }
  const d = ensureDiary(date);
  const planEl = document.getElementById('single_plan_' + date);
  if (planEl) d.plan = planEl.value;
  const rp = document.getElementById('single_rp_' + date);
  if (rp) d.review.progress = rp.value;
  const rs = document.getElementById('single_rs_' + date);
  if (rs) d.review.shortcomings = rs.value;
  const ri = document.getElementById('single_ri_' + date);
  if (ri) d.review.improvements = ri.value;
  const rst = document.getElementById('single_rst_' + date);
  if (rst) d.review.stop = rst.value;
  const ro = document.getElementById('single_ro_' + date);
  if (ro) d.review.other = ro.value;
  const fs = document.getElementById('single_fs_' + date);
  if (fs) d.feedback.sleepTime = fs.value;
  const fsd = document.getElementById('single_fsd_' + date);
  if (fsd) d.feedback.sleepDay = fsd.value;
  const fw = document.getElementById('single_fw_' + date);
  if (fw) d.feedback.wakeTime = fw.value;
  const fq = document.getElementById('single_fq_' + date + '_grid');
  if (fq) d.feedback.sleepQuality = getGridValue(fq.id) || '';
  const fe = document.getElementById('single_fe_' + date + '_grid');
  if (fe) d.feedback.mentalState = getGridValue(fe.id) || '';
  /* 感恩日记：1~3 条短句，逐条 trim、丢空串、单条截到 200 字；
     一条都没有就把整个对象删掉（不留空壳，导出也干净）。 */
  const grItems = [];
  for (let gi = 0; gi < 3; gi++) {
    const ge = document.getElementById('single_gr_' + gi + '_' + date);
    if (!ge) continue;
    const gv = String(ge.value || '').trim().slice(0, 200);
    if (gv) grItems.push(gv);
  }
  if (grItems.length) d.gratitude = { items: grItems };
  else delete d.gratitude;
  const hasContent =
    d.plan ||
    d.review.progress ||
    d.review.shortcomings ||
    d.review.improvements ||
    d.review.other ||
    d.feedback.sleepTime ||
    d.feedback.wakeTime ||
    d.feedback.sleepQuality ||
    d.feedback.mentalState ||
    grItems.length;
  if (hasContent) {
    appData.diaries[date] = d;
  } else if (appData.diaries[date] && !hasContent) {
    delete appData.diaries[date];
  }
  saveData();
}
/* 月历的「选完回调」：为空 = 日记模式（老行为）；
   传入 { onPick, mark } = 通用选日期模式（时间块网格在用），选完调 onPick 并关闭。
   通用模式还可以再给两个可选项，把「这天长什么样」整个交出去：
     · dayCell(ds, day) → { cls, html, title }：自画格子（日程表用它画番茄热力格）
     · legend：格子下面那行图例的 HTML（不给就不占行） */
let _calendarPick = null;
function openCalendarModal(opts) {
  _calendarPick = (opts && typeof opts.onPick === 'function') ? opts : null;
  const now = new Date();
  __set_calendarYear(now.getFullYear());
  __set_calendarMonth(now.getMonth());
  const _s = document.getElementById('calendarSearch');
  if (_s) _s.value = '';
  const _sr = document.getElementById('calendarSearchResults');
  if (_sr) _sr.innerHTML = '';
  /* 通用选日期模式没有「日记关键词」这回事，把搜索条藏掉 */
  if (_s) _s.style.display = _calendarPick ? 'none' : '';
  /* 每次打开收起跳转面板，回到当前年月 */
  const _jrow = document.getElementById('calendarJumpRow');
  if (_jrow) _jrow.style.display = 'none';
  renderCalendar();
  showModal('calendarModal');
}
function renderCalendar() {
  document.getElementById('calendarTitle').textContent = calendarYear + '年' + (calendarMonth + 1) + '月';
  /* 同步年月跳转面板（年份 + 12 个月份快捷格） */
  const _jy = document.getElementById('calendarJumpYear');
  if (_jy) _jy.textContent = calendarYear;
  const _jm = document.getElementById('calendarJumpMonths');
  if (_jm) {
    if (!_jm.childNodes.length) {
      let mh = '<span class="cal-jump-lbl">月</span>';
      for (let m = 1; m <= 12; m++) mh += '<button class="cal-jump-m" data-m="' + m + '" onclick="jumpCalendarMonth(' + m + ')">' + m + '</button>';
      _jm.innerHTML = mh;
    }
    Array.prototype.forEach.call(_jm.querySelectorAll('.cal-jump-m'), function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-m')) === calendarMonth + 1);
    });
  }
  const grid = document.getElementById('calendarGrid');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let html = weekdays.map(w => `<div class="calendar-weekday">${w}</div>`).join('');
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const today = getTodayStr();
  const todayDate = new Date();
  const pick = _calendarPick;
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr =
      calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const isToday = dateStr === today;
    /* 日记不该写未来的（没意义）；通用选日期可以随便选，包括往后翻 */
    const isFuture = !pick && new Date(dateStr) > new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
    const onclick = !isFuture ? `onclick="calendarDayPick('${dateStr}')"` : '';
    /* ★ 格子交给调用方自画（日程表选日期模式，pick.dayCell）：class / 内容 / title 都由
       日程那边给。为什么不在本函数里判"这天该长什么样"——那是日程的业务口径
       （番茄热力 / 有没有一次性排期），日历弹窗只管摆位置；两处各判一次，迟早出现
       「日历说这天有安排、网格里一格都没有」。老调用（日记）不带 dayCell，
       照旧走下面的 has-diary 涂色，一个字节不变。 */
    if (pick && typeof pick.dayCell === 'function') {
      const c = pick.dayCell(dateStr, day) || {};
      const cls =
        'calendar-day hm' + (c.cls ? ' ' + c.cls : '') + (isToday ? ' today' : '') + (isFuture ? ' disabled' : '');
      const ttl = c.title ? ` title="${escapeHtml(String(c.title))}"` : '';
      html += `<div class="${cls}" ${onclick}${ttl}>${c.html == null ? day : c.html}</div>`;
      continue;
    }
    const marked = pick ? (typeof pick.mark === 'function' ? !!pick.mark(dateStr) : false) : !!appData.diaries[dateStr];
    let cls = 'calendar-day';
    if (marked) cls += ' has-diary';
    if (isToday) cls += ' today';
    if (isFuture) cls += ' disabled';
    html += `<div class="${cls}" ${onclick}>${day}</div>`;
  }
  /* 图例也由调用方给（日程：少→多 四档）。不给就不占行。 */
  if (pick && pick.legend) html += '<div class="logcal-legend">' + pick.legend + '</div>';
  grid.innerHTML = html;
}
/* 展开/收起年-月跳转面板 */
function openCalendarJump() {
  const row = document.getElementById('calendarJumpRow');
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'block' : 'none';
}
/* 跨年切换（此前只有 changeCalendarMonth，翻 12 个月才能到上一年）
 *   ★ 2026-10-30 修：calendarYear / calendarMonth 的真身在 01b（数据层），
 *   本文件拿到的是 ESM 导入绑定 —— **导入绑定只读**，`calendarYear++` 直接抛
 *   TypeError: Assignment to constant variable，表现为「点日历左右箭头毫无反应」。
 *   跨模块可变状态必须走 01b 的 __set_* 写入口（读仍是活绑定，不用改）。 */
function changeCalendarYear(delta) {
  __set_calendarYear(calendarYear + (Number(delta) || 0));
  renderCalendar();
}
/* 直接跳到某月（保留当前年份） */
function jumpCalendarMonth(m) {
  const mm = Math.max(1, Math.min(12, Number(m) || 1)) - 1;
  __set_calendarMonth(mm);
  renderCalendar();
}
function changeCalendarMonth(delta) {
  /* 先算好目标年月再一次性写回：中途分两次 set，中间态不合法时（如 13 月）
     任何一次重入渲染都会画出错误月份。 */
  let y = calendarYear;
  let m = calendarMonth + (Number(delta) || 0);
  while (m < 0) { m += 12; y--; }
  while (m > 11) { m -= 12; y++; }
  __set_calendarYear(y);
  __set_calendarMonth(m);
  renderCalendar();
}
/* 月历里点了一天：带选完回调 → 走回调（时间块网格）；否则是日记的老路径 */
function calendarDayPick(date) {
  if (_calendarPick) {
    const h = _calendarPick.onPick;
    _calendarPick = null;
    closeModal('calendarModal');
    h(date);
    return;
  }
  selectDiaryDate(date);
}
function selectDiaryDate(date) {
  forceSaveDiary(currentDiaryDate);
  __set_currentDiaryDate(date);
  closeModal('calendarModal');
  switchLogTab('diary');
  renderDiarySingle();
}
function goToTodayDiary() {
  calendarDayPick(getTodayStr());
}
function searchDiaries(keyword) {
  const kw = keyword.trim().toLowerCase();
  const results = document.getElementById('calendarSearchResults');
  if (!kw) {
    results.innerHTML = '';
    return;
  }
  const matches = [];
  Object.keys(appData.diaries).forEach(date => {
    const d = appData.diaries[date];
    const text = [d.plan, d.review && d.review.progress, d.review && d.review.shortcomings, d.review && d.review.improvements, d.review && d.review.other]
      .join(' ')
      .toLowerCase();
    if (text.includes(kw)) {
      const snippet = ((d.review && d.review.progress) || d.plan || '').substring(0, 40);
      matches.push({ date, snippet });
    }
  });
  matches.sort((a, b) => b.date.localeCompare(a.date));
  if (!matches.length) {
    results.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:var(--sp-10);font-size:var(--fs-title);">未找到匹配的日记</div>';
    return;
  }
  results.innerHTML = matches
    .map(
      m =>
        `<div class="calendar-search-item" onclick="selectDiaryDate('${m.date}')"><div class="sr-date">${m.date}</div><div class="sr-snippet">${escapeHtml(m.snippet)}…</div></div>`
    )
    .join('');
}
function renderWeeklyBadges() {
  const container = document.getElementById('weeklyBadgeList');
  if (!container) return;
  const weekDone = getWeekTomatoPoints();
  /* 原始完成量：不减任何消耗，统计/海报口径 */ const currentWeekCount = getWeekHeldTomatoes();
  /* 持有量：战标判定口径 */ const wcEl = document.getElementById('weekTomatoCount');
  if (wcEl) wcEl.textContent = fmtTomatoNum(weekDone);
  const whEl = document.getElementById('weekTomatoHeld');
  if (whEl) {
    whEl.textContent = fmtTomatoNum(currentWeekCount);
    whEl.style.color = currentWeekCount > 0 ? 'var(--green)' : 'var(--red,#C0392B)';
  }
  container.innerHTML = WEEKLY_BADGES.map(b => {
    const cumulative = ((appData.weeklyBadges && appData.weeklyBadges.cumulative && appData.weeklyBadges.cumulative[b.id]) || 0);
    const habitMet = !b.habitReq || checkWeekHabitReq(getWeekStartStr(), b.habitReq);
    const state = getBadgeState(b);
    const lit = state !== 'off';
    let progressHint = '';
    if (!lit) {
      if (b.habitReq && currentWeekCount >= b.goal) {
        const miss = weekHabitMissingDays(b.habitReq);
        progressHint = '还差 习惯打卡（' + (miss > 0 ? miss + '天' : '') + '）';
      } else if (currentWeekCount < b.goal) {
        progressHint = '还差 ' + Math.max(1, Math.ceil(b.goal - currentWeekCount)) + ' 🍅';
      }
    }
    const gloryClass = b.glow && lit ? ' badge-glory' : '';
    const habitHtml = b.habitReq
      ? `<div style="font-size:var(--fs-title);color:${habitMet ? 'var(--green)' : 'var(--primary)'};margin-top:var(--sp-2);">🌿${b.habitReqDesc}</div>`
      : '';
    const stateText = state === 'this' ? '✅ 本周达成' : state === 'carry' ? '⏳ 延续中·本周需再达成' : '熄灭';
    const stateColor = state === 'this' ? 'var(--green)' : state === 'carry' ? 'var(--yellow-dark)' : '#999';
    return `<div class="badge-card${gloryClass}" style="text-align:center;padding:var(--sp-10) var(--sp-6);width:82px;border:2px solid ${lit ? b.color : '#ddd'};border-radius:var(--radius);background:${lit ? b.bg : '#f9f9f9'};opacity:${lit || cumulative > 0 ? '1' : '0.5'};${lit ? 'box-shadow:0 0 8px ' + b.color + ';' : ''}"><div style="font-size:34px;filter:${lit ? 'none' : 'grayscale(1)'};">${b.icon}</div><div style="font-size:var(--fs-title);font-weight:700;margin-top:var(--sp-2);color:${lit ? b.color : '#999'};">${b.name}</div><div style="font-size:var(--fs-title);color:var(--text-light);">${b.desc}</div>${habitHtml}<div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-2);">日均${b.avg}🍅</div><div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-2);">${b.positioning}</div>${progressHint ? `<div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-2);">${progressHint}</div>` : ''}<div style="font-size:var(--fs-title);margin-top:var(--sp-2);color:${stateColor};font-weight:${lit ? '700' : '400'};">${stateText}</div><div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-2);">累计${cumulative}次</div></div>`;
  }).join('');
  renderTimerBadge();
}
/* 今日习惯/计划打卡提醒卡（在日志页专注记录上方：习惯页层级深易忘，这里直接提醒+一键直达） */
function renderHabitRemind() {
  const el = document.getElementById('habitRemindCard');
  if (!el) return;
  const habits = appData.habits || [];
  const undone = (appData.todos || []).filter(function (t) {
    return !t.done;
  }).length;
  const today = getTodayStr();
  /* ★ 2026-10-30：只数「今天该做」的习惯（非归档 + 节奏/配额命中 + 今天没跳过）。
     原来是 habits.length 一把抓 —— 归档的习惯永远算"没打卡"，每周一三五的习惯
     周二也在催你，这块提醒卡就成了永远关不掉的黄色条。
     判定统一交给 habitDueToday：这里再拼一遍条件，就会和习惯页的列表对不上。 */
  const todayHabits = habits.filter(function (h) {
    return h && !h.archived && habitDueToday(h, today);
  });
  const done = todayHabits.filter(function (h) {
    return (appData.habitLogs[h.id] || []).includes(today);
  }).length;
  const left = todayHabits.length - done;
  /* 全部完成（习惯+计划）→ 整块隐藏，不打扰 */
  if (left <= 0 && undone === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  let html = '';
  /* 习惯卡：未完成时提醒 */
  if (todayHabits.length && left > 0) {
    html +=
      '<div style="display:flex;align-items:center;gap:var(--sp-8);background:var(--card);border:2px solid var(--yellow-dark);border-radius:var(--radius-input);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-body);margin-bottom:var(--sp-8);"><span style="font-size:var(--fs-sub);">🌱</span><div style="flex:1;"><b>今日习惯 ' +
      done +
      '/' +
      todayHabits.length +
      '</b>，还有 ' +
      left +
      ' 个没打卡<br><span style="font-size:var(--fs-note);color:var(--text-light);">连续打卡才能养成习惯，点一下就来</span></div><button onclick="goHabitCheck()" style="background:var(--yellow-dark);color:#fff;border:none;border-radius:var(--radius);padding:var(--sp-6) var(--sp-14);font-weight:700;flex-shrink:0;">去打卡 ›</button></div>';
  }
  /* 计划卡：有未完成时提醒 */
  if (undone > 0) {
    html +=
      '<div style="display:flex;align-items:center;gap:var(--sp-8);background:var(--card);border:2px solid var(--blue);border-radius:var(--radius-input);padding:var(--sp-8) var(--sp-12);font-size:var(--fs-body);"><span style="font-size:var(--fs-sub);">📋</span><div style="flex:1;"><b>今日计划还有 ' +
      undone +
      ' 项未完成</b><br><span style="font-size:var(--fs-note);color:var(--text-light);">未完成的计划明天会继续留着，今天收尾压力更小</span></div><button onclick="goPlanCheck()" style="background:var(--blue);color:#fff;border:none;border-radius:var(--radius);padding:var(--sp-6) var(--sp-14);font-weight:700;flex-shrink:0;">去完成 ›</button></div>';
  }
  el.innerHTML = html;
}
function goHabitCheck() {
  switchView('plan');
  switchPlanTab('habit');
}
function goPlanCheck() {
  switchView('plan');
  switchPlanTab('plan');
}
function renderTimerBadge() {
  const el = document.getElementById('timerBadge');
  if (!el) return;
  const currentWeekCount = getWeekHeldTomatoes();
  /* 战标按「持有」判定：兑换消耗后进度与点亮状态同步回退 */ let bestIdx = -1,
    bestState = 'off';
  for (let i = WEEKLY_BADGES.length - 1; i >= 0; i--) {
    const st = getBadgeState(WEEKLY_BADGES[i]);
    if (st !== 'off') {
      bestIdx = i;
      bestState = st;
      break;
    }
  }
  if (bestIdx < 0) {
    el.classList.remove('show');
    el.innerHTML = '';
    updateHonorEffects();
    return;
  }
  const bestBadge = WEEKLY_BADGES[bestIdx]; /* 找下一个未点亮的更高目标标 */
  let nextBadge = null;
  for (let i = bestIdx + 1; i < WEEKLY_BADGES.length; i++) {
    if (getBadgeState(WEEKLY_BADGES[i]) === 'off') {
      nextBadge = WEEKLY_BADGES[i];
      break;
    }
  }
  const gloryCls = bestBadge.glow ? ' badge-glory' : '';
  el.className = 'timer-badge show' + gloryCls;
  el.style.borderColor = bestBadge.color;
  const darkMode = typeof document.body !== 'undefined' && document.body.classList.contains('dark-mode');
  el.style.background = darkMode ? 'rgba(24,28,50,.92)' : bestBadge.bg;
  /* v5.7.6 精简：徽章只保留 图标 + 名称 + 简短状态；"距下一战标还差几个🍅"统一放到「每周战标」页查看 */
  let stateHtml;
  if (bestState === 'carry') stateHtml = '<div class="tb-state" style="color: var(--yellow-ink)">⏩ 延续中</div>';
  else if (nextBadge) stateHtml = '<div class="tb-state" style="color: var(--green-ink)">✅ 本周达成</div>';
  else stateHtml = '<div class="tb-state" style="color: var(--green-ink)">👑 本周最高</div>';
  el.innerHTML = `<div class="tb-icon">${bestBadge.icon}</div><div class="tb-name" style="color:${bestBadge.color};">${bestBadge.name}</div>${stateHtml}`;
  updateHonorEffects();
}
/* 段数规则折叠：展开/收起规则与冲段说明（全局状态，重渲染后恢复） */
let _segRulesOpen = false;
function toggleSegRules() {
  _segRulesOpen = !_segRulesOpen;
  const b = document.getElementById('segRulesBody');
  const a = document.getElementById('segRulesArrow');
  if (b) b.style.display = _segRulesOpen ? 'block' : 'none';
  if (a) a.textContent = _segRulesOpen ? '▾' : '▸';
}

/* 事件委托（2026-10-23）：原内联 onchange 带 typeof 守卫（旧存档可能没有该函数）。 */
window.setFontScaleSafe = function (v) {
  if (typeof setFontScale === 'function') setFontScale(v);
};
