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
 * 函数索引（TOC）：renderGridPicker/setGridValue/getGridValue/_refreshStateIcon/updateGridLabel/formatStateComparison/_cmpStr/showToast/_switchRowLabel/notifySwitchChanged/showSettleSummary/dismissSettle（+5 更多）
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
