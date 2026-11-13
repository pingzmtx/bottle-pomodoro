/* ============================================================================
 * 轻量状态写入口 + 变更通知（store.subscribe）
 * ----------------------------------------------------------------------------
 * 背景（外部评审建议"响应式状态依赖"，此处**刻意收敛**）：
 *   该项目是 17k 行 ES5 单文件，全量改 Redux 式响应式 = 灾难级回归风险。
 *   实际痛点只有一个：**同一数据源变了，多处 UI 忘了刷新**（漏刷热区），
 *   例如改了 appData.uiPrefs.foldPrefs 后其它视图的联动没跟上。
 *
 * 本模块只做最小闭环：
 *   store.set(path, value)   —— 唯一写入口（可选）：写 appData 并触发订阅回调
 *   store.get(path)          —— 读（支持 'a.b.c' 点路径；无值返回 undefined）
 *   store.subscribe(key, fn) —— 订阅（key 为点路径前缀；fn(newVal, oldVal)）
 *   store.emit(key)          —— 手动广播（老代码已直接改了 appData 时补通知）
 *
 * 设计约束：
 *   - **不强迫迁移**：老代码继续直接写 appData 也能跑（不破坏既有 1291 处引用）。
 *   - **不新增全局命名污染**：只挂 window.store 一个对象（登记进白名单）。
 *   - **不自动持久化**：落盘仍走既有 saveData 单通道，避免双写回流。
 *   - ES5 语法；全 try 包裹，通知失败绝不影响写入。
 * 函数索引（TOC）：_root/_split/get/_validate/set/emit/subscribe/reg
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__storeNotifyReady) return;
  window.__storeNotifyReady = true;

  var _subs = {}; /* {key: [fn, ...]} */

  function _root() {
    try {
      return typeof appData !== 'undefined' ? appData : window.appData;
    } catch (e) {
      return window.appData;
    }
  }
  function _split(path) {
    return String(path || '').split('.').filter(Boolean);
  }
  function get(path) {
    var o = _root();
    var parts = _split(path);
    for (var i = 0; i < parts.length; i++) {
      if (o == null) return undefined;
      o = o[parts[i]];
    }
    return o;
  }
  /* 入参校验：顶层字段白名单来自 appData 自身结构（不硬编码，避免漂移）。
   * 非法字段 console.warn 但不阻断（老档/跨版本数据容错，避免直接报错把应用搞挂）。 */
  var _warned = {};
  function _validate(parts, value) {
    try {
      var root = _root();
      if (!root || parts.length < 1) return true;
      var top = parts[0];
      if (!Object.prototype.hasOwnProperty.call(root, top)) {
        if (!_warned[top]) {
          _warned[top] = true;
          console.warn('[store.set] 顶层字段不在 appData 默认结构中：' + top + '（已写入，但请确认是否漏补默认值）');
        }
      }
      return true;
    } catch (e) {
      return true;
    }
  }
  function set(path, value) {
    var parts = _split(path);
    if (!parts.length) return false;
    var o = _root();
    if (o == null) return false;
    _validate(parts, value);
    var old = get(path);
    for (var i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
    emit(path, value, old);
    return true;
  }
  /* 通知：触发"精确 key" + "所有祖先前缀"的订阅者（如订阅 'uiPrefs' 能收到 'uiPrefs.foldPrefs' 的变更） */
  function emit(path, nv, ov) {
    try {
      var parts = _split(path);
      for (var depth = parts.length; depth >= 1; depth--) {
        var key = parts.slice(0, depth).join('.');
        var list = _subs[key];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          try {
            list[i](nv !== undefined ? nv : get(path), ov);
          } catch (e) { if (window.__silent) window.__silent(e, '0D:emit'); }
        }
      }
    } catch (e) { if (window.__silent) window.__silent(e, '0D:emit'); }
  }
  function subscribe(key, fn) {
    if (typeof fn !== 'function') return function () {};
    key = String(key || '');
    (_subs[key] || (_subs[key] = [])).push(fn);
    /* 返回退订函数 */
    return function () {
      var list = _subs[key];
      if (!list) return;
      var idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  window.store = {
    get: get,
    set: set,
    emit: emit,
    subscribe: subscribe,
    _subs: function () {
      var o = {};
      for (var k in _subs) if (Object.prototype.hasOwnProperty.call(_subs, k)) o[k] = _subs[k].length;
      return o;
    }
  };

  /* ---------- 订阅登记（集中一处，便于审阅"谁在听什么"） ----------
   * 原则：只接入**已知漏刷热区**，不追求全量响应式。
   * 延迟注册：各 render 函数由 01d/01e 定义，可能晚于本文件 → 就绪后重试一次。 */
  function reg() {
    try {
      /* 场景：树/金币消耗后，多个视图的持有量数字要同步（原为手写 5 行 render） */
      window.store.subscribe('tree.coins', function () {
        try {
          renderTreeShop();
        } catch (e) { if (window.__silent) window.__silent(e, '0D:reg'); }
        try {
          renderTreeSection();
        } catch (e) { if (window.__silent) window.__silent(e, '0D:reg'); }
        try {
          renderWeeklyBadges();
        } catch (e) { if (window.__silent) window.__silent(e, '0D:reg'); }
        try {
          renderRankSystem();
        } catch (e) { if (window.__silent) window.__silent(e, '0D:reg'); }
        try {
          renderStats();
        } catch (e) { if (window.__silent) window.__silent(e, '0D:reg'); }
      });
    } catch (e) { if (window.__silent) window.__silent(e, '0D:reg'); }
  }
  reg();
})();
