/* ============================================================================
 * 01b1 · 存储适配层（为将来接后端留的唯一一道门）
 * ----------------------------------------------------------------------------
 * 现在只有 local 一种模式：读写一律直通 localStorage，**不缓存、不改写、不吞异常**，
 * 与改造前逐字节同行为（配额满 / 隐私模式禁用时该抛的错照抛，上层 try/catch 逻辑不变）。
 *
 * 为什么不叫 `Storage`：`window.Storage` 是浏览器内置的 Web Storage 接口构造器，
 * 覆盖它会让任何 `instanceof Storage` 判断、以及第三方代码的探测行为发生变化。
 * 名字里的 TF = Tomato Focus，避免与平台 API 撞名。
 *
 * 将来接 remote 时的约定（本次不实现）：
 *   · 只改这个文件 + TF_CONFIG.apiBase，业务侧 15 处调用点不再动；
 *   · read 允许返回 Promise 的方案需要业务侧 await，属于破坏性变更，届时另立方案。
 * 函数索引（TOC）：（本文件无顶层函数，仅常量/IIFE）
 * ========================================================================== */
(function () {
  if (window.__tfStorageReady) return;

  window.TFStorage = {
    mode: 'local',
    read: function (key) {
      return window.localStorage.getItem(key);
    },
    write: function (key, value) {
      window.localStorage.setItem(key, value);
    },
    remove: function (key) {
      window.localStorage.removeItem(key);
    }
  };

  window.__tfStorageReady = true;
})();
