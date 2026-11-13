/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * UI 门面（L1）：引擎层不许直接调 UI。引擎只认 UIFX，UI 在加载时把实现挂上来。
 * 红线：本文件只做「按名转发」，不许在这里写业务逻辑；新增转发项只加一行 bind('xxx')。
 */
/* ============================================================
 * 【M0 UI 门面】解环第一刀：引擎 → UI 的 400 条直接调用里，173 条是 showToast
 * 为什么要有它：01d 结算要知道"给用户说一句"，于是直接调 01e 的 showToast；
 * 01e 又调 01d 的结算 —— 两个目录互相 import 成环，按文件拆模块必踩 TDZ。
 * 解法：引擎只依赖这个**无依赖的门面**，UI 在加载时把实现注册进来（bind）。
 * 语义等价：转发是运行期按名查找，弹窗/提示的行为、去重、结算队列全部不变。
 * 加载期调用（UI 还没挂上）→ 静默跳过，与"UI 尚未加载"时的原行为一致。
 * 函数索引（TOC）：bind
 * ============================================================ */
(function () {
  'use strict';

  var registry = {};

  function bind(name) {
    return function () {
      var fn = registry[name] || window[name];
      if (typeof fn !== 'function') return undefined;
      return fn.apply(window, arguments);
    };
  }

  var UIFX = window.UIFX || {};
  // 引擎层用到的 UI 能力：只列"上行调用"，不列 UI 内部互相调用
  UIFX.toast = UIFX.toast || bind('showToast');
  UIFX.bind = function (map) {
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) registry[k] = map[k];
  };
  UIFX._registry = registry;
  /* 共享状态的**唯一**进出口：引擎不许再直接读写 UI 的模块级变量。
     这两个是本轮解环剩下的真实跨层状态（其余都是注释里的说明文字）。 */
  UIFX.get = function (name) { return window[name]; };
  UIFX.clearImmersionTimer = function () {
    var v = window.immersionIv;
    if (v) clearInterval(v);
    window.immersionIv = null;
  };
  UIFX.setPendingImmersiveScript = function (script) { window._pendingImmersiveScript = script; };
  /* Proxy 兜底：引擎里上行调用的 UI 函数有 60+ 个，逐个 bind 不如按名转发。
     `UIFX.anyUI()` → 运行期取 window.anyUI；UI 没挂上/没这个函数时返回 undefined。 */
  UIFX = new Proxy(UIFX, {
    get: function (t, k) {
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      return function () {
        var fn = registry[k] || window[k];
        if (typeof fn !== 'function') return undefined;
        return fn.apply(window, arguments);
      };
    },
  });
  window.UIFX = UIFX;
})();

/* 模块化后必须显式声明：模块作用域不会把 window.UIFX 当变量解析。
   普通 script 下这行等价于 window.UIFX，行为不变。 */
var UIFX = window.UIFX;
