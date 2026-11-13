/* ============================================================
 * 01d6 · 通用工具（段位星数查询 / 番茄折算 / 掉星计算）
 * 由 01d_engine_features.js 按域拆出（可回退：本文件整段随 slot1 files 还原）
 * 说明：这 7 个工具被 01d3/01d4/01e 多域共用，独立成文件便于复用与定位。
 * 函数索引（TOC）：getMyRankStars/finishTypePlanText/countTomatoPoints/getEffectiveFull/getTodayEffectiveFull/calcDropStars
 * ============================================================ */
/* 本人当前段位星数（写进编码里给队友看） */
function getMyRankStars() {
  return appData.rankSystem && typeof appData.rankSystem.stars === 'number' ? appData.rankSystem.stars : 0;
}
/* --- 业务逻辑 --- */
/* 把时间戳/Date 转成 YYYY-MM-DD，全局复用，避免到处手写拼接 */
/* (M4d) getDateStr 已迁移至 00_pure_core.js */
/* 某天的番茄点数：完整🍅=1，半个🍅=0.5（段位进度/周标/树养成统一按点数计算，半个番茄不再被忽略） */
/* 🍅 番茄折算：完整(≥15min)至少 1 个，超出部分按 时长/25 加（25min=1、37.5min=1.5、50min=2）；半个固定 0.5（简单档 10 分钟=半个 0.5）；未完成 0
   ⚠️ 达「完整🍅」下限（MIN_FULL_MINUTES 15 分钟）即记 ≥1：完成弹窗本来就默认选中
   「完整🍅」，若仍折算成 0.5 就出现「完整🍅 ×0.5」的自相矛盾账（详见 00_pure_core.js calcPomos） */
/* 完成弹窗选项预览：与 showFinishModal 的开放/默认规则一致
   （完整≥15 分钟**可选**、半个≥5 分钟可选、未完成始终可选；<5 分钟只剩未完成；
   **满 25 分钟才默认完整🍅，不足 25 分钟默认半个🍅**） */
function finishTypePlanText(minutes) {
  if (minutes >= POMO_BASE_SECONDS / 60) return '默认「完整🍅」，得 ' + calcPomos(minutes * 60, 'full') + ' 个（也可自评半个/未完成）';
  if (minutes >= MIN_FULL_MINUTES)
    return '默认「半个🍅」(0.5 个)；想记「完整🍅」(' + calcPomos(minutes * 60, 'full') + ' 个) 可自行选择';
  if (minutes >= 5) return '可选「半个🍅」(0.5 个) 或「未完成」(0 个)';
  return '按「未完成」结算，得 0 个';
}
/* (M4d) calcPomos 已迁移至 00_pure_core.js */
/* 读取记录折算番茄数（兼容历史记录无 pomos 字段） */
/* (M4d) getPomos 已迁移至 00_pure_core.js */

function countTomatoPoints(dateStr) {
  return appData.records.reduce(function (s, r) {
    if (getDateStr(r.startTime) !== dateStr) return s;
    return s + getPomos(r);
  }, 0);
}
/* 番茄点数显示：整数不带小数，小数保留 1 位（如 2、2.5） */
/* (M4d) fmtTomatoNum 已迁移至 00_pure_core.js */
/* 换任务后，今日进度从 0 重新起算：有效数 = 当日点数 − 换任务那一刻锁定的基准线。
   注意：只影响「今日任务进度 / 超额升星 / 次日结算」，records 统计本身一根不动。
   半个番茄按 0.5 点计入任务进度。 */
function getEffectiveFull(dateStr, baseline) {
  return Math.max(0, countTomatoPoints(dateStr) - (baseline || 0));
}
function getTodayEffectiveFull() {
  const rs = appData.rankSystem;
  const today = getTodayStr();
  const b = rs.dailyTask && rs.dailyTask.date === today && rs.dailyTask.baseline ? rs.dailyTask.baseline : 0;
  return getEffectiveFull(today, b);
}
/* 掉星计算（唯一口径）：差 N 个扣 N⭐，向上取整。任务卡预警「若现在停止」与下注确认弹窗共用本函数，保证两处数字一致 */
function calcDropStars(target, eff) {
  const need = Math.max(0, target - eff);
  return { lost: Math.ceil(need), need: need };
}
