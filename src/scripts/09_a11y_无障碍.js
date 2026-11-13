/* ============================================================================
 * 无障碍补课（焦点陷阱 / aria-live / 控件标注）
 * ----------------------------------------------------------------------------
 * 定位：**纯增强层**，只做"加属性 + 加监听 + 建 live 区"，不改任何既有交互路径。
 *       全部逻辑包在 try 里，任一步失败都不影响主流程（无障碍不能反过来搞挂应用）。
 * 覆盖面：
 *   ① 焦点陷阱：弹窗（.modal-overlay.show）内 Tab 循环，不逃逸到底层页面
 *   ② 焦点归位：关闭弹窗后把焦点还回打开它的元素（若还活着）
 *   ③ aria-live：新增常驻 #a11yLive 区域，朗读关键状态变化（番茄完成/开始/暂停）
 *   ④ 控件标注：图标按钮补 aria-label；导航补 role=tablist/tab；当前项 aria-selected
 *   ⑤ 弹窗语义：role=dialog + aria-modal=true + aria-label（取弹窗内首个标题）
 * 说明：本项目已有 Escape 关弹窗（01g），此处**不重复绑定**，只补焦点与语义。
 * 函数索引（TOC）：visible/focusables/activeOverlay/annotateOverlay/hookToast/annotateControls/scheduleAnnotate
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__a11yReady) return;
  window.__a11yReady = true;

  /* 顶层兜底：把两个对外入口先占位声明，确保任何后续语句抛错也不会
   * 让 window.a11yRefresh / a11yAnnounce 变成 undefined（防"静默半瘫痪"）。 */
  window.a11yRefresh = function () {};
  if (typeof window.a11yAnnounce !== 'function') window.a11yAnnounce = function () {};

  var FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.disabled) return false;
    var s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function focusables(root) {
    var list = root ? root.querySelectorAll(FOCUSABLE) : [];
    var out = [];
    for (var i = 0; i < list.length; i++) if (visible(list[i])) out.push(list[i]);
    return out;
  }

  /* ---------- ① 焦点陷阱 + ② 焦点归位 ---------- */
  var _lastTrigger = null;

  function activeOverlay() {
    var all = document.querySelectorAll('.modal-overlay.show');
    return all.length ? all[all.length - 1] : null;   /* 取最上层 */
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var ov = activeOverlay();
    if (!ov) return;
    var f = focusables(ov);
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    var act = document.activeElement;
    /* 焦点不在弹窗内（含刚从底层跳进来）→ 拉回首元素 */
    if (!ov.contains(act)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && act === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
  }, true);

  /* 打开弹窗时：记录触发元素 + 自动聚焦首个可聚焦项 + 补语义 */
  function annotateOverlay(ov) {
    try {
      if (ov.getAttribute('role') !== 'dialog') {
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        var h = ov.querySelector('h1,h2,h3,.modal h3,.jy-name');
        var label = h ? (h.textContent || '').trim() : '';
        if (label && !ov.getAttribute('aria-label')) ov.setAttribute('aria-label', label.slice(0, 40));
      }
    } catch (e) { if (window.__silent) window.__silent(e, '09:annotateOverlay'); }
  }

  var _mo = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var t = muts[i].target;
      if (!t || t.nodeType !== 1 || !t.classList || !t.classList.contains('modal-overlay')) continue;
      if (t.classList.contains('show')) {
        annotateOverlay(t);
        /* 焦点若还在底层，移到弹窗首个可聚焦元素 */
        var rAF = window.requestAnimationFrame || function (fn) { setTimeout(fn, 16); };
        (function (ov) {
          rAF(function () {
            try {
              if (!ov.classList.contains('show')) return;
              if (ov.contains(document.activeElement)) return;
              var f = focusables(ov);
              if (f.length) f[0].focus();
            } catch (e) { if (window.__silent) window.__silent(e, '09:annotateOverlay'); }
          });
        })(t);
      }
    }
  });
  try { _mo.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true }); } catch (e) { if (window.__silent) window.__silent(e, '09:annotateOverlay'); }

  /* 记录"谁打开了弹窗"，用于关闭后归位焦点（捕获阶段，早于业务 onclick） */
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document.body) {
      if (t.nodeType === 1 && (t.tagName === 'BUTTON' || t.tagName === 'A' ||
          (t.getAttribute && (t.getAttribute('onclick') || t.getAttribute('role') === 'button')))) {
        _lastTrigger = t;
        break;
      }
      t = t.parentElement;
    }
  }, true);

  /* 弹窗关闭后：焦点不在任何可见弹窗内 → 归位 */
  var _wasOpen = false;
  var _mo2 = new MutationObserver(function () {
    var ov = activeOverlay();
    if (_wasOpen && !ov) {
      try {
        if (_lastTrigger && document.contains(_lastTrigger) && visible(_lastTrigger)) _lastTrigger.focus();
        else if (document.activeElement === document.body) { /* 不动，避免抢焦点 */ }
      } catch (e) { if (window.__silent) window.__silent(e, '09:annotateOverlay'); }
      _wasOpen = false;
    } else if (ov) {
      _wasOpen = true;
    }
  });
  try { _mo2.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true }); } catch (e) { if (window.__silent) window.__silent(e, '09:annotateOverlay'); }

  /* ---------- ③ aria-live 朗读区 ---------- */
  var live = document.getElementById('a11yLive');
  if (!live) {
    live = document.createElement('div');
    live.id = 'a11yLive';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    live.className = 'a11y-sr-only';
    document.body.appendChild(live);
  }
  var _lastAnnounce = 0;
  /* 供业务调用的朗读入口（不改变既有调用，仅新增可用能力） */
  window.a11yAnnounce = function (msg) {
    try {
      var now = Date.now();
      if (!msg || now - _lastAnnounce < 400) return;   /* 防刷屏 */
      _lastAnnounce = now;
      live.textContent = '';
      setTimeout(function () { live.textContent = String(msg); }, 30);
    } catch (e) { if (window.__silent) window.__silent(e, '09:annotateOverlay'); }
  };
  /* 自动朗读 toast（番茄完成/开始等关键反馈都走 showToast）。
     这里必须是**函数声明**而非 IIFE 具名表达式：具名函数表达式的名字只在
     自身作用域可见，外层 `setTimeout(hookToast, 800)` 会抛 ReferenceError，
     中断后续全部语句（表现为 a11yRefresh 未挂载、键盘焦点环监听未注册）。 */
  function hookToast() {
    try {
      if (typeof window.showToast !== 'function' || window.__a11yToastHooked) return;
      window.__a11yToastHooked = true;
      var orig = window.showToast;
      window.showToast = function (msg, isRank) {
        try { window.a11yAnnounce(msg); } catch (e) { if (window.__silent) window.__silent(e, '09:hookToast'); }
        return orig.apply(this, arguments);
      };
    } catch (e) { if (window.__silent) window.__silent(e, '09:hookToast'); }
  }
  hookToast();
  /* showToast 由 01e 定义，可能晚于本文件执行 → 稍后重试一次 */
  setTimeout(hookToast, 800);

  /* ---------- ④ 控件标注（图标按钮 / 导航语义） ---------- */
  function annotateControls() {
    try {
      /* 底部导航 + 桌面侧栏：补 role=tab + aria-selected */
      var navItems = document.querySelectorAll('.bottom-nav .nav-item, .desktop-sidebar .ds-item');
      for (var i = 0; i < navItems.length; i++) {
        var n = navItems[i];
        if (!n.getAttribute('role')) n.setAttribute('role', 'tab');
        n.setAttribute('aria-selected', n.classList.contains('active') ? 'true' : 'false');
      }
      var nav = document.querySelector('.bottom-nav');
      if (nav && !nav.getAttribute('role')) nav.setAttribute('role', 'tablist');
      var sb = document.querySelector('.desktop-sidebar .ds-nav');
      if (sb && !sb.getAttribute('role')) sb.setAttribute('role', 'tablist');

      /* 统计子导航 */
      var sub = document.querySelectorAll('#statsSubNav .stats-nav-item');
      for (var j = 0; j < sub.length; j++) {
        if (!sub[j].getAttribute('role')) sub[j].setAttribute('role', 'tab');
        sub[j].setAttribute('aria-selected', sub[j].classList.contains('current') ? 'true' : 'false');
      }
      var subNav = document.getElementById('statsSubNav');
      if (subNav && !subNav.getAttribute('role')) subNav.setAttribute('role', 'tablist');

      /* 图标按钮：无文字 → 用 title / emoji 语义兜底 aria-label */
      var btns = document.querySelectorAll('button');
      for (var k = 0; k < btns.length; k++) {
        var b = btns[k];
        if (b.getAttribute('aria-label')) continue;
        var txt = (b.textContent || '').trim();
        /* 纯 emoji/符号（无中日韩、无字母数字）视为图标按钮 */
        var isIcon = txt.length > 0 && txt.length <= 4 && !/[a-zA-Z0-9\u4e00-\u9fa5]/.test(txt);
        if (!txt || isIcon) {
          var t = b.getAttribute('title') || '';
          if (t) b.setAttribute('aria-label', t.split(/[：:（(]/)[0].slice(0, 30));
          else if (txt) {
            /* 符号按钮的兜底名必须「听得懂」：'按钮 ‹' 对屏读用户毫无意义。
               映射常见翻页/方向符号 → 可理解的词；未登记的符号仍走 '按钮 X'（不静默）。
               ★ 有具体语义时**优先走 title**（如「上一月」vs 通用的「上一个」），
                 所以模板里能给 title 就给 —— 这里只是兜底。 */
            var _fb = {
              '‹': '上一个', '›': '下一个', '«': '上一个', '»': '下一个',
              '◀': '上一个', '▶': '下一个', '←': '上一个', '→': '下一个',
              '↑': '上一个', '↓': '下一个', '＋': '新增', '+': '新增',
              '×': '关闭', '✕': '关闭', '✖': '关闭', '⨯': '关闭'
            };
            b.setAttribute('aria-label', _fb[txt] || ('按钮 ' + txt));
          }
        }
      }
      /* 进度条语义 */
      var bars = document.querySelectorAll('.tree-progress-bar, .tree-album-bar, progress');
      for (var m = 0; m < bars.length; m++) {
        if (!bars[m].getAttribute('role')) { bars[m].setAttribute('role', 'progressbar'); }
      }
      /* 计时圆盘：补 live 语义（时间在变，读屏应感知但不刷屏） */
      var tc = document.getElementById('timerTime');
      if (tc && !tc.getAttribute('aria-live')) tc.setAttribute('aria-live', 'off');
    } catch (e) { if (window.__silent) window.__silent(e, '09:annotateControls'); }
  }

  /* 动态内容多 → 首次 + 延迟 + 视图切换后各标一次 */
  function scheduleAnnotate() {
    var rAF = window.requestAnimationFrame || function (fn) { setTimeout(fn, 16); };
    rAF(function () { annotateControls(); });
    setTimeout(annotateControls, 1200);
    setTimeout(annotateControls, 3500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAnnotate);
  } else {
    scheduleAnnotate();
  }
  /* 导航切换后重标（active 态变了） */
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document.body) {
      if (t.nodeType === 1 && (t.classList.contains('nav-item') || t.classList.contains('ds-item') ||
          t.classList.contains('stats-nav-item'))) {
        setTimeout(annotateControls, 120);
        break;
      }
      t = t.parentElement;
    }
  }, true);

  /* 供外部主动补标（新增 DOM 后调用） */
  window.a11yRefresh = scheduleAnnotate;

  /* ---------- 键盘导航标记（决定是否显示焦点环） ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') document.body.classList.add('a11y-kbd');
  }, true);
  document.addEventListener('mousedown', function () {
    document.body.classList.remove('a11y-kbd');
  }, true);
})();
