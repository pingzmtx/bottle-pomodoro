/* ============================================================================
 * 应用内统一弹窗（收编 confirm / alert / prompt 三种原生弹窗）
 * ----------------------------------------------------------------------------
 * 动机：原生 confirm/alert/prompt 在移动端对**多行长文案**排版极差（换行错乱、
 *       被系统截断、无法富文本强调），而且**完全不吃主题**（浅色/深色/大字号都失控）。
 *       项目里"下注 / 延后任务 / 删除分类"等说明长达 5~8 行，体验最差。
 *
 * 提供（全部复用全局 .modal-overlay / .modal 样式，明暗主题自动适配）：
 *   - window.rsConfirm(msg, opts) -> Promise<boolean>  确认/取消
 *   - window.rsAlert(msg, opts)   -> Promise<true>     只有「知道了」
 *   - window.rsPrompt(msg, opts)  -> Promise<string|null>  文本输入，取消为 null
 *   opts：title / okText / cancelText / danger / highlight[] /
 *         value（prompt 初值）/ placeholder / multiline（prompt 多行）
 *   msg 支持多行（\n 分段），关键行用 opts.highlight 数组做强调。
 *   Esc 取消 / 点遮罩取消 / 焦点陷阱（若 09 无障碍模块可用则自动生效）
 *   **无 Promise 环境兜底**：回退原生（老浏览器不死锁）。
 *
 * 用法（改动调用点）：
 *   原： if (!confirm(msg)) return;
 *   新： if (!(await rsConfirm(msg, {danger:true}))) return;
 *   ※ 仅用于**已是 async 或可安全异步化**的调用点；同步强依赖处保留原生 confirm。
 * 函数索引（TOC）：build/openDialog/done/rsConfirm/rsAlert/rsPrompt/rsAsk/rsInfo
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__confirmModalReady) return;
  window.__confirmModalReady = true;

  var _cur = null; /* 当前弹窗（同时只允许一个） */


  function build(msg, opts) {
    opts = opts || {};
    var ov = document.createElement('div');
    ov.className = 'modal-overlay rs-confirm';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    var title = opts.title || (opts.prompt ? '请输入' : opts.alert ? '提示' : '请确认');
    ov.setAttribute('aria-label', title);

    var lines = String(msg == null ? '' : msg).split('\n');
    var body = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!ln.length) { body += '<div class="rs-gap"></div>'; continue; }
      var emphasized = false;
      if (opts.highlight) {
        for (var h = 0; h < opts.highlight.length; h++) {
          if (ln.indexOf(opts.highlight[h]) >= 0) { emphasized = true; break; }
        }
      }
      body += emphasized
        ? '<div class="rs-line rs-hl">' + escapeHtml(ln) + '</div>'
        : '<div class="rs-line">' + escapeHtml(ln) + '</div>';
    }

    /* 输入区（prompt）：与 msg 同卡片，样式全部走令牌（.rs-input） */
    var input = '';
    if (opts.prompt) {
      var v = escapeHtml(opts.value == null ? '' : opts.value);
      var ph = escapeHtml(opts.placeholder || '');
      input = opts.multiline
        ? '<textarea data-rs-input class="rs-input" rows="3" placeholder="' + ph + '">' + v + '</textarea>'
        : '<input data-rs-input class="rs-input" type="text" value="' + v + '" placeholder="' + ph + '">';
    }

    /* 弹窗收编：按钮只用 .modal-btn 家族（与静态弹窗同款），不再各写 inline 色值/尺寸 */
    var okCls = 'modal-btn ' + (opts.danger ? 'danger' : 'primary');
    var cancelBtn = opts.alert
      ? ''
      : '<button type="button" class="modal-btn secondary" data-rs-cancel>' + escapeHtml(opts.cancelText || '取消') + '</button>';
    ov.innerHTML =
      '<div class="modal modal--confirm">' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<div class="rs-body">' + body + '</div>' +
      input +
      '<div class="modal-buttons rs-foot">' +
      cancelBtn +
      '<button type="button" class="' + okCls + '" data-rs-ok>' +
      escapeHtml(opts.okText || (opts.alert ? '知道了' : '确定')) + '</button>' +
      '</div></div>';
    return ov;
  }

  /* 弹窗内核：返回 Promise，resolve 值由各 API 决定（true/false/字符串/null）。
     opts.prompt 存在时 resolve 输入框文本（取消 → null），否则 resolve 布尔。 */
  function openDialog(msg, opts) {
    opts = opts || {};
    if (typeof Promise === 'undefined') {
      try {
        if (opts.prompt) return window.prompt(msg, opts.value || '');
        return opts.alert ? true : window.confirm(msg);
      } catch (e) { return opts.prompt ? null : false; }
    }
    return new Promise(function (resolve) {
      /* 先扫掉上一次遗留的僵尸弹窗（未带 .show 的 rs-confirm）：
         若它残留且仍可点，会挡住整页交互。 */
      try {
        var stale = document.querySelectorAll('.rs-confirm');
        for (var si = 0; si < stale.length; si++) {
          if (!stale[si].classList.contains('show') && stale[si].parentNode) {
            stale[si].parentNode.removeChild(stale[si]);
          }
        }
      } catch (e) { if (window.__silent) window.__silent(e, '0C:openDialog'); }
      var ov = build(msg, opts);
      var prevFocus = document.activeElement;
      var inp = ov.querySelector('[data-rs-input]');
      function done(v) {
        try {
          ov.classList.remove('show');
          /* ⚠️ 立即断掉指针事件：200ms 后才真正 remove，若此时被浏览器节流
             （后台标签页/长任务），残留 overlay 会**全屏挡住点击**——表现就是
             「点什么都没反应」。先断指针，动画照常。 */
          ov.style.pointerEvents = 'none';
          setTimeout(function () {
            try { ov.parentNode && ov.parentNode.removeChild(ov); } catch (e) { if (window.__silent) window.__silent(e, '0C:done'); }
          }, 200);
        } catch (e) { if (window.__silent) window.__silent(e, '0C:done'); }
        _cur = null;
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) { if (window.__silent) window.__silent(e, '0C:done'); }
        if (inp) {
          resolve(v ? String(inp.value) : null);
        } else {
          resolve(v);
        }
      }
      ov.querySelector('[data-rs-ok]').addEventListener('click', function (e) {
        e.stopPropagation();
        done(true);
      });
      var cancelEl = ov.querySelector('[data-rs-cancel]');
      if (cancelEl) {
        cancelEl.addEventListener('click', function (e) {
          e.stopPropagation();
          done(false);
        });
      }
      /* 点遮罩空白处 = 取消（点卡片内部不触发） */
      ov.addEventListener('click', function (e) {
        if (e.target === ov) done(false);
      });
      ov.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); }
        if (e.key === 'Enter' && inp && !opts.multiline) { e.stopPropagation(); done(true); }
      });
      document.body.appendChild(ov);
      _cur = ov;
      /* 触发显示动画 + 聚焦确定键（键盘/读屏可直达） */
      void ov.offsetWidth;
      ov.classList.add('show');
      setTimeout(function () {
        try {
          var ok = ov.querySelector('[data-rs-ok]');
          if (inp) inp.focus();
          else if (ok) ok.focus();
        } catch (e) { if (window.__silent) window.__silent(e, '0C:done'); }
      }, 60);
    });
  }

  function rsConfirm(msg, opts) {
    var o = opts || {};
    o.prompt = false;
    return openDialog(msg, o);
  }
  function rsAlert(msg, opts) {
    var o = opts || {};
    o.alert = true;
    return openDialog(msg, o);
  }
  function rsPrompt(msg, opts) {
    var o = opts || {};
    o.prompt = true;
    return openDialog(msg, o);
  }

  /* 便捷包装（收编调用点用一行搞定，避免每处都写 then）：
     - rsAsk(msg, opts, onOk, onCancel)：确认后执行 onOk、取消后执行 onCancel（可选）；
       不可用时回退原生 confirm。
       ★ onCancel 是必要的：调用点若在弹窗**之前**已改过 UI（例如 onchange 先把开关勾上），
         取消时必须能回滚，否则会出现「看着开了、其实没开」的状态不一致。
     - rsInfo(msg, opts)：只有一个「知道了」的提示（替代原生 alert）。 */
  function rsAsk(msg, opts, onOk, onCancel) {
    var o = opts || {};
    o.prompt = false;
    if (typeof window.rsConfirm === 'function') {
      window.rsConfirm(msg, o).then(function (ok) {
        if (ok) onOk();
        else if (onCancel) onCancel();
      });
      return;
    }
    if (window.confirm(msg)) onOk();
    else if (onCancel) onCancel();
  }
  function rsInfo(msg, opts) {
    var o = opts || {};
    o.alert = true;
    return openDialog(msg, o);
  }

  window.rsConfirm = rsConfirm;
  window.rsAlert = rsAlert;
  window.rsPrompt = rsPrompt;
  window.rsAsk = rsAsk;
  window.rsInfo = rsInfo;
})();
