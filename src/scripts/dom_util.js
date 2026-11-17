// @layer: L1
/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * DOM 工具层：对外 = escapeHtml。只碰 DOM，不碰 appData / 业务状态 / 存储。 ｜症状：列表里露出 HTML 标签 · 引号把属性截断
 * 引擎层允许直接调用，**不经过 UIFX 门面**：UIFX 的语义是「上行调用 UI 回调」，
 * 不是字符串转换的分发口；把一个无状态纯转换包进门面，只会多一次 window 查找，
 * 且 UI 尚未加载时会返回 undefined、把 HTML 拼成字符串 "undefined"。
 * 红线：本文件只放无状态转换，不放任何依赖 appData 或加载时序的逻辑。 */
/* ============================================================
 * 【M0 DOM 工具】escapeHtml：从 01eQ_ui_timerpanel.js 上移
 * 为什么搬：引擎层调用它 18 处（01g 10 / 01f 5 / 02 2 / 05 1），
 *   它只做 createElement + textContent 的转义转换，与计时面板 UI 无关。
 *   留在 UI 文件里，会让「引擎不许直连 UI」的门禁产生 18 处假阳性——
 *   修法不该是给它加 UIFX. 前缀（那只是把 undefined 风险引进渲染路径），
 *   而该把它放到引擎与 UI 都能直取的公共层。
 * 函数索引（TOC）：escapeHtml
 * ============================================================ */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  /* 补双引号转义：textNode→innerHTML 只转义 & < >，本函数返回值会被拼进
     value="${...}" 等双引号属性上下文（habitDetailName/detailTaskName），不转 " 即属性注入。
     textarea 为 RCDATA 上下文，&quot; 会被实体解码回 " 正常显示（已实机验证回读无损），
     故一处补齐对全部调用点安全。 */
  return div.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
