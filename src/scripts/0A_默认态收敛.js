/* ============================================================================
 * 信息架构默认态收敛（首进只开"必用"，选填/低频默认收起）
 * ----------------------------------------------------------------------------
 * 背景：首屏（计时页）此前把「当前状态」「任务难度」两个**选填**板块默认展开，
 *       加上下方若干折叠点，导致 .main 滚动高度 ~1560px（375×667 下要滚 2.3 屏），
 *       新用户第一眼看到的"可操作区"被表单挤占，找不到"开始专注"这个主线动作。
 *
 * 策略（低频收、高频开）：
 *   - 计时页「当前状态」（选填、开始前打分、偏复盘）→ 默认收起
 *   - 计时页「任务难度」（决定时长档位，属高频）→ 保持默认展开
 *   - 设置页各分组（主题/沉浸式/过去的自己/计时/微休息…）→ 已有"默认全折叠"，保持
 *
 * 实现：纯声明式，调 __uiFold.defaultClosed(keys)。
 *   只在用户**从未手动改过**该块时生效；用户点过一次后即以手动偏好为准，不再覆盖。
 *   可重复调用（幂等）；数据未就绪时不落盘（由 07 的 wantOpen 兜底读声明）。
 * 函数索引（TOC）：apply
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__defaultFoldReady) return;
  window.__defaultFoldReady = true;

  /* 首进默认折叠的板块 key（登记于此，便于审阅；勿散落他处） */
  var DEFAULT_CLOSED = [
    'timer_state' /* 计时页 · 当前状态（选填，开始前打分 → 低频） */
  ];

  var tries = 0;
  function apply() {
    try {
      if (window.__uiFold && window.__uiFold.defaultClosed) {
        window.__uiFold.defaultClosed(DEFAULT_CLOSED);
        return;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '0A:apply'); }
    /* 折叠模块可能晚于本文件执行 / 容器尚未挂载 → 有限次重试 */
    if (tries++ < 40) setTimeout(apply, 100);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
  /* 数据就绪后（loadData 会把 true 偏好装载进来）再对齐一次，
     确保"老用户已手动展开过"的偏好不被误折叠。 */
  setTimeout(apply, 1500);
})();
