/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 组件注册表：对外 registerComponent；新 UI 组件唯一入口。
 * 红线：组件样式/挂载/联动随组件走，禁止在别处手写注册或极简黑名单。 */
/* ============================================================
 * __comp · 组件注册表（统一"联动登记"）
 * ============================================================
 * 整段可回退：删除本 <script> 即 100% 还原。
 *
 * 为什么存在：
 *   加一个组件若要在 极简 CSS 黑名单 / 折叠逻辑 / 样式区 … 手动登记 N 处，
 *   漏一处 = "没藏干净"。registerComponent() 把这些联动登记收成 **一份声明**：
 *
 *     registerComponent({
 *       name: 'myCard',
 *       styleText: '...CSS...',            // 组件自带样式，框架统一注入、去重、可卸载
 *       host: '#view-timer',               // 挂载点：选择器 | 元素 | () => 元素
 *       mount: function(hostEl){ ... return rootEl; },  // 幂等挂载
 *       minimalHide: true,                 // 极简模式自动隐藏该组件根节点（框架生成规则）
 *       foldBox: { key:'myCard', title: 元素|选择器 },  // 参与折叠记忆+极简联动（走 __uiFold）
 *       onState: function(st){...}         // 可选：minimal/journey 状态变化钩子
 *     });
 *
 * 目前框架已实现的面：样式自动注入 / 幂等挂载 / 极简隐藏 / 折叠记忆收编 / 卸载清理。
 * （journey 锁/引导沿用既有 STEPS 机制；组件可用 onState 自行响应，暂不改 journey 内核。）
 *
 * API：
 *   registerComponent(cfg)  -> handle {name, el, deregister()}
 *   __comp.list()           -> 已注册组件名
 *   __comp.deregister(name) -> 卸载（移除 DOM/样式/折叠登记）
 *   __comp.css()            -> 当前框架生成的样式文本（调试）
 * ES5 语法，无新 API 依赖。
 * 函数索引（TOC）：q/resolve/ready/getHost/sanitizeName/ensureStyle/rebuildCSS/mountOne/isMinimal/flushMounts/registerComponent/handleOf（+3 更多）
 * ============================================================ */
(function () {
  let regs = []; /* {name,cfg,el} */
  let STYLE_ID = '__compCss';
  let _pending = [];

  function q(s) {
    try {
      return document.querySelector(s);
    } catch (e) {
      return null;
    }
  }
  function resolve(v) {
    if (!v) return null;
    if (typeof v === 'function') {
      try {
        return resolve(v());
      } catch (e) {
        return null;
      }
    }
    if (typeof v === 'string') return q(v);
    return v && v.nodeType ? v : null;
  }
  function ready() {
    return !!(document.body && document.readyState !== 'loading');
  }
  function getHost(cfg) {
    return resolve(cfg.host);
  }
  function sanitizeName(n) {
    return String(n || '').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  function ensureStyle() {
    try {
      let st = document.getElementById(STYLE_ID);
      if (!st) {
        st = document.createElement('style');
        st.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(st);
      }
      return st;
    } catch (e) {
      return null;
    }
  }
  function rebuildCSS() {
    let st = ensureStyle();
    if (!st) return;
    let css = '';
    for (let i = 0; i < regs.length; i++) {
      let r = regs[i];
      if (r.cfg.styleText) css += '/* __comp:' + r.name + ' */\n' + r.cfg.styleText + '\n';
      /* 修订：必须加 !important。
         原文只论证了「body.minimal-mode #x 压过样式表里的 #x」——那对**内联样式无效**：
         组件里凡由 JS 写过 el.style.display 的（如 renderGhostBar 给 #timerGhostBox
         写 display），内联样式优先级高于任何不带 !important 的选择器，极简模式就压不住它。
         真机浏览器实测：C05「极简模式隐藏」在 timerGhostBox 上失败（=block）——正是这个。
         （原「92 种状态组合下计算样式不变」的审计是在幽灵条关闭态跑的，故漏掉。） */
      if (r.cfg.minimalHide) {
        let sel = r.el && r.el.id ? '#' + r.el.id : '[data-comp="' + sanitizeName(r.name) + '"]';
        css += 'body.minimal-mode ' + sel + '{display:none!important;}\n';
      }
      if (r.cfg.minimalSelectors) {
        for (let j = 0; j < r.cfg.minimalSelectors.length; j++) {
          css += 'body.minimal-mode ' + r.cfg.minimalSelectors[j] + '{display:none!important;}\n';
        }
      }
    }
    st.textContent = css;
  }

  function mountOne(r) {
    try {
      if (r.done) return;
      let host = getHost(r.cfg);
      if (!host) return; /* 宿主未就绪，等待 retry */
      let root = r.cfg.mount ? r.cfg.mount(host) : null;
      if (root && root.nodeType) {
        r.el = root;
      } else if (r.cfg.el) {
        r.el = resolve(r.cfg.el);
      }
      if (!r.el) {
        /* mount 返回空也可接受：组件自己管 DOM */
      }
      if (r.el && r.el.nodeType && !r.el.getAttribute('data-comp')) {
        try {
          r.el.setAttribute('data-comp', r.name);
        } catch (e) { if (window.__silent) window.__silent(e, '08:mountOne'); }
      }
      r.done = true;
      /* 折叠面收编 */
      if (r.cfg.foldBox && window.__uiFold && window.__uiFold.register) {
        let fb = r.cfg.foldBox;
        window.__uiFold.register({
          key: fb.key || r.name,
          sec: fb.sec || r.el,
          title: fb.title,
          label: fb.label
        });
      }
      if (r.cfg.onState)
        try {
          r.cfg.onState({ minimal: isMinimal(), mounted: true });
        } catch (e) { if (window.__silent) window.__silent(e, '08:mountOne'); }
    } catch (e) { if (window.__silent) window.__silent(e, '08:mountOne'); }
  }
  function isMinimal() {
    return !!(document.body && document.body.classList.contains('minimal-mode'));
  }

  function flushMounts() {
    let left = [];
    for (let i = 0; i < _pending.length; i++) {
      let r = _pending[i];
      mountOne(r);
      if (!r.done) left.push(r);
    }
    _pending = left;
  }

  function registerComponent(cfg) {
    if (!cfg || !cfg.name) return null;
    for (let i = 0; i < regs.length; i++) {
      if (regs[i].name === cfg.name) return handleOf(regs[i]);
    }
    let r = { name: cfg.name, cfg: cfg, el: null, done: false };
    regs.push(r);
    /* 纯选择器声明（如旧极简黑名单收编）：无需挂载 */
    if (cfg.minimalSelectors && !cfg.mount && !cfg.host) {
      r.done = true;
    } else if (ready()) {
      mountOne(r);
      if (!r.done) _pending.push(r);
    } else _pending.push(r);
    rebuildCSS();
    return handleOf(r);
  }
  function handleOf(r) {
    return {
      name: r.name,
      el: function () {
        return r.el;
      },
      deregister: function () {
        return deregister(r.name);
      }
    };
  }
  function deregister(name) {
    let idx = -1,
      r = null;
    for (let i = 0; i < regs.length; i++) {
      if (regs[i].name === name) {
        idx = i;
        r = regs[i];
        break;
      }
    }
    if (!r) return false;
    regs.splice(idx, 1);
/* 折叠登记解除 + 还原 DOM 折叠痕迹 */
    if (window.__uiFold) {
      try {
        if (r.cfg.foldBox && r.cfg.foldBox.key) window.__uiFold.remove(r.cfg.foldBox.key);
        else if (r.name && r.cfg.foldBox) window.__uiFold.remove(r.name);
      } catch (e) { if (window.__silent) window.__silent(e, '08:deregister'); }
    }
    if (r.cfg.destroy)
      try {
        r.cfg.destroy(r.el);
      } catch (e) { if (window.__silent) window.__silent(e, '08:deregister'); }
    else if (r.el && r.el.parentNode) {
      try {
        r.el.parentNode.removeChild(r.el);
      } catch (e) { if (window.__silent) window.__silent(e, '08:deregister'); }
    }
    rebuildCSS();
    return true;
  }
  function list() {
    let a = [];
    for (let i = 0; i < regs.length; i++) a.push(regs[i].name);
    return a;
  }

  /* 启动：宿主可能晚到 → body class 变化时顺带补挂（极简/锁等时机） */
  function patchObserver() {
    try {
      if (typeof MutationObserver === 'undefined' || !document.body) return;
      let mo = new MutationObserver(function () {
        try {
          setTimeout(function () {
            try {
              flushMounts();
              rebuildCSS();
            } catch (e) { if (window.__silent) window.__silent(e, '08:patchObserver'); }
          }, 40);
        } catch (e) { if (window.__silent) window.__silent(e, '08:patchObserver'); }
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { if (window.__silent) window.__silent(e, '08:patchObserver'); }
  }
  try {
    ensureStyle();
    /* 旧极简隐藏黑名单收编（M5）：原 CSS 分散在 template 主样式区 + journey 注入样式，
       现统一为注册表「纯选择器声明」，消除双处维护。删除旧规则见 build 产物 diff。 */
    registerComponent({
      name: '__mm_legacy__',
      minimalSelectors: [
        '.bottom-nav .nav-item[data-view="stats"]',
        '#statsSubNav .stats-nav-item[data-tab="tree"]',
        '#statsSubNav .stats-nav-item[data-tab="rank"]',
        '#statsSubNav .stats-nav-item[data-tab="ach"]',
        '#breakDiceSection',
        '#timerTreeCompanion',
        '.immersive-progress',
        '#timerBadge',
        '#timerRankStrip',
        '#timerGhostBox',
        '.jy-bar'
      ]
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try {
          flushMounts();
        } catch (e) { if (window.__silent) window.__silent(e, '08:patchObserver'); }
      });
    }
    patchObserver();
    flushMounts();
    window.registerComponent = registerComponent;
    window.__comp = {
      register: registerComponent,
      deregister: deregister,
      list: list,
      css: function () {
        return (function () {
          let st = document.getElementById(STYLE_ID);
          return st ? st.textContent : '';
        })();
      },
      _dbg: {
        mounts: function () {
          return list();
        }
      }
    };
  } catch (e) { if (window.__silent) window.__silent(e, '08:patchObserver'); }
})();
