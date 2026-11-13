/* ============================================================================
 * Hash 路由 + 深度链接（轻量版）
 * ----------------------------------------------------------------------------
 * 目标：
 *   ① 切换视图时同步 location.hash（#timer / #plan / #log / #stats / #settings）
 *   ② 启动时读 hash 直达对应视图（例：index.html#stats 直接进统计页）
 *   ③ 浏览器前进/后退有效（hashchange 驱动）
 *
 * 设计原则（零侵入、可回退）：
 *   - **不修改** switchView 本体，而是包裹它：记下路由来源，避免回环写入 hash。
 *   - 复用既有 switchView(view) 作为唯一执行入口，不另起一套视图切换逻辑。
 *   - 老浏览器兜底：无 history API 也能用（只操作 location.hash）。
 *   - 全程 try 包裹：路由异常不得影响主应用（最坏情况=回到无路由状态）。
 *
 * 地址栏 hash 累积（`index.html#log#stats`）
 *   - 背景：部分第三方浏览器（本地 file:// 打开时）对 replaceState 的相对片段
 *     解析与标准不同，会把新片段**接在旧片段后面** → 地址栏出现 `#log#stats`，
 *     应用读到非法片段，切页失效 / 报错。只按 '/' 切分时，整串会被判废，
 *     于是既不切页也不收拾，脏片段永久留存、每点一次更脏一层。
 *   - 对策：
 *     ① **读**：readHash 容错 —— 按 '/', '#', '&', '?' 切分，取**最后一个**合法视图名。
 *        `#log#stats` → stats，深链接照常生效，且**永不抛错**。
 *     ② **写**：WRITE_HASH 关闭 —— 切页不再改动地址栏。地址栏恒定停在
 *        `index.html`（与历史版本表现一致），任何内核都不可能再累积片段。
 *        若要恢复「地址栏跟随视图」，把 WRITE_HASH 改回 true 即可；
 *        writeHash 内部用 location.hash 赋值（替换语义），并带逐级兜底与事后校验。
 *     ③ 注：normalizeHash 保留，受 WRITE_HASH 约束——关写时它是空操作，
 *        开启后用于把已存在的畸形片段重写成干净地址。
 * 函数索引（TOC）：valid/activeView/readHash/cleanBase/writeHash/normalizeHash/patchSwitchView/onHashChange/boot
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__hashRouteReady) return;
  window.__hashRouteReady = true;

  /* fix：切页是否回写地址栏。
     关闭 = 地址栏恒定停在 index.html（历史版本行为，杜绝片段累积）。
     开启 = 地址栏跟随视图（#stats 等），深链接可复制分享。 */
  var WRITE_HASH = false;

  var VIEWS = ['timer', 'plan', 'log', 'stats', 'settings'];
  var DEFAULT_VIEW = 'timer';
  var _fromHash = false; /* 标记"本次切换源自 hashchange"，防止回环写 hash */
  /* （原 `_orig` 包装 switchView 的残留已随钩子化移除） */

  function valid(v) {
    return !!v && VIEWS.indexOf(v) >= 0;
  }

/* 当前激活视图名（渲染缺失时回退默认值） */
  function activeView() {
    try {
      var act = document.querySelector('.view.active');
      if (act && act.id) {
        var v = act.id.replace('view-', '');
        if (valid(v)) return v;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '0B:activeView'); }
    return DEFAULT_VIEW;
  }

  /* 从 location.hash 解析视图名。
     fix：容错解析 —— 畸形片段（#log#stats / #log/stats / #log&stats）
     取**最后一个**合法视图名，而不是整串判废。 */
  function readHash() {
    try {
      var h = String(location.hash || '').replace(/^#+/, '');
      if (!h) return null;
      var segs = h.split(/[\/#&?]+/);
      for (var i = segs.length - 1; i >= 0; i--) {
        if (valid(segs[i])) return segs[i];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /* 去掉 href 里已有的片段，得到干净的基地址（兼容 file:// 与带查询串的情况） */
  function cleanBase() {
    try {
      var href = String(location.href || '');
      var i = href.indexOf('#');
      var base = i >= 0 ? href.slice(0, i) : href;
      return base === '#' ? '' : base;
    } catch (e) {
      return '';
    }
  }

  /* 写 hash（不触发 switchView，避免回环）。
     ★ 顺序很关键：**先 replaceState**。
       用 `location.hash = view` 会往浏览器历史栈里塞一条记录 ——
       每切一次页面历史就 +1，于是浏览器返回键 / 边缘滑 变成在应用内来回切页面，
       和本应用自己的左右滑手势撞在一起。
       改用 replaceState 后，切页面**不产生历史记录**：返回键/边缘滑 = 真正离开应用，
       应用内切页面只由底部导航和应用自己的滑动手势负责。
     每次写入后当场校验，避免在同一帧内反复叠加。 */
  function writeHash(view) {
    try {
      if (!WRITE_HASH) return;
      if (!valid(view)) return;
      var next = '#' + view;
      if (String(location.hash || '') === next) return;
      var ok = false;
      /* ① 首选：replaceState（替换语义，**不新增历史记录**） */
      var base0 = cleanBase();
      if (base0 && window.history && window.history.replaceState) {
        try {
          window.history.replaceState(null, '', base0 + next);
          ok = String(location.hash || '') === next;
        } catch (eReplace0) { if (window.__silent) window.__silent(eReplace0, '0B:writeHash'); }
      }
/* ② 回退：直接赋值 hash（会新增一条历史记录，但 file:// 等场景 replaceState 会被拒，只能用它） */
      if (!ok) {
        try {
          location.hash = view;
          ok = String(location.hash || '') === next;
        } catch (eHash) { if (window.__silent) window.__silent(eHash, '0B:writeHash'); }
      }
      /* ③ 末选：location.replace 重写（同文档内不重载） */
      if (!ok) {
        var b2 = cleanBase();
        if (b2) {
          try {
            location.replace(b2 + next);
          } catch (eReplace2) { if (window.__silent) window.__silent(eReplace2, '0B:writeHash'); }
        }
      }
    } catch (e) { if (window.__silent) window.__silent(e, '0B:writeHash'); }
  }

  /* fix：地址栏自愈。当前片段含多余 '#' 或非法值时，按解析结果重写干净地址。
     WRITE_HASH 关闭时为空操作（不改地址栏，也不会出错）。 */
  function normalizeHash() {
    try {
      if (!WRITE_HASH) return;
      var raw = String(location.hash || '');
      if (!raw) return;
      var body = raw.replace(/^#+/, '');
      var segs = body.split(/[\/#&?]+/).filter(function (s) {
        return s !== '';
      });
      var isDirty = body.indexOf('#') >= 0 || segs.length !== 1 || !valid(segs[0]);
      if (!isDirty) return;
      writeHash(readHash() || activeView());
    } catch (e) { if (window.__silent) window.__silent(e, '0B:normalizeHash'); }
  }

  /* 视图切换后同步 hash —— 走视图切换钩子（原来靠包装 window.switchView） */
  function patchSwitchView() {
    if (window.__hashViewPatched) return true;
    tbOnViewSwitch(function (view) {
      try {
        if (!_fromHash && valid(view)) writeHash(view);
      } catch (e) { if (window.__silent) window.__silent(e, '0B:patchSwitchView'); }
    }, 'after');
    window.__hashViewPatched = true;
    return true;
  }

  /* hashchange → 切视图（用户点前进/后退 / 手改地址栏） */
  function onHashChange() {
    try {
      normalizeHash(); /* 先收拾畸形片段，再按结果切视图 */
      var v = readHash();
      if (!v) return;
      /* 已经是当前视图则不重复切换（避免 renderLogs 等重复跑） */
      var act = document.querySelector('.view.active');
      if (act && act.id === 'view-' + v) return;
      _fromHash = true;
      try {
        window.switchView(v);
      } finally {
        _fromHash = false;
      }
    } catch (e) {
      _fromHash = false;
    } /* 路由失败不影响主流程 */
  }

  /* 启动：读 hash 直达（WRITE_HASH 开启且无 hash 时，把当前视图写进地址栏便于分享） */
  function boot() {
    try {
      if (!patchSwitchView()) {
        /* switchView 尚未定义（脚本顺序）→ 有限次重试 */
        if ((boot._t = (boot._t || 0) + 1) < 40) setTimeout(boot, 100);
        return;
      }
      normalizeHash();
      var v = readHash();
      if (v) {
        _fromHash = true;
        try {
          window.switchView(v);
        } finally {
          _fromHash = false;
        }
      } else if (WRITE_HASH) {
        /* 首次进入无 hash：以当前激活视图为准写入（多为 timer） */
        writeHash(activeView());
      }
    } catch (e) { if (window.__silent) window.__silent(e, '0B:boot'); }
  }

  window.addEventListener('hashchange', onHashChange);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  /* 主引擎 init 完成后（视图已就绪）再补一次，覆盖脚本顺序晚于本文件的情况 */
  setTimeout(boot, 800);
})();
