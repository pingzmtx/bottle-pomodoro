// @layer: L1
/* ============================================================
 * 0.4.0 · 内嵌的开源界面入口（小眠）｜症状：设置页点了没反应
 * 函数索引（TOC）：openEmbeddedSpace
 *
 * 只做一件事：把 id 交给 shim 装出来的全局（__bottleEmbedded），
 * 由原生打开**独立页面**（自己的 origin vendor.androidplatform.net，与网页存储隔离）。
 *
 * ★ 网页里没有桥对象名、没有 URL、也没有原生页面名 —— 加一个内嵌页只改数据：
 *   vendor 产物 + 模板里的 data-act-args。
 * ★ 浏览器里预览（无桥）时给一句可读提示，绝不留"点了没反应"。
 * ★ 单独成文件而不是塞进 ui_misc.js：那是存量 2500+ 行的棘轮文件，只准减不准长。
 * ★ 0.4.1 删掉 openCreditsPage：设置页那一行「开源致谢」是重复入口
 *   （「更多 → 关于 → 关于借鉴」里本来就有同一份列表，包括 XMSLEEP 的署名），
 *   网页入口与原生页一起移除，不留"点了回 E_UNKNOWN_CMD"的死函数。
 * ============================================================ */
function openEmbeddedSpace(id) {
  const key = String(id || '').trim();
  if (!key) return;
  if (window.__bottleEmbedded && typeof window.__bottleEmbedded.open === 'function') {
    window.__bottleEmbedded.open(key);
    return;
  }
  if (window.UIFX && typeof window.UIFX.showToast === 'function') {
    window.UIFX.showToast('这个入口要在 App 里打开');
  }
}
