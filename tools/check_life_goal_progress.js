#!/usr/bin/env node
/* ============================================================================
 * check_life_goal_progress.js —— 目标进度算法的纯函数单测（不启浏览器）
 *
 * 跑法：node tools/check_life_goal_progress.js
 * 退出码 0 = 全过；1 = 有失败（verify.py 直接看退出码）
 *
 * 为什么这些用例值得写死：
 *   每一条都对应一次真实算错。尤其是 #8「清空输入框算出 100%」和
 *   #11「跨年度目标被截断成 0.3%」—— 后者是这份实现里曾经真的写错的地方。
 * ========================================================================== */
'use strict';

const path = require('path');
const G = require(path.join(__dirname, '..', 'src', 'scripts', '00b_goal_progress.js'));

/* ---- 极简断言 ---- */
let pass = 0;
const fails = [];
function eq(name, got, want, note) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓ ' + name); return; }
  fails.push(name);
  console.log('  ✗ ' + name + '   期望 ' + JSON.stringify(want) + '  实际 ' + JSON.stringify(got)
    + (note ? '   （' + note + '）' : ''));
}

/* ---- 假的习惯统计：模拟 00_pure_core 的 habitStats 语义 ----
   真函数是 habitStats(h, logs, today, days)：窗口 days 天、expected 按 freqPerWeek 折算。
   这里用同一套规则实现一份，保证测的是「调用方怎么用」而不是「真函数对不对」。 */
function fakeHabitStats(h, logs, today, days) {
  const set = new Set((logs || []).map(d => String(d).slice(0, 10)));
  // 生成窗口内的日期
  let done = 0;
  const t = Date.parse(today + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(t - i * 86400000).toISOString().slice(0, 10);
    if (set.has(d)) done++;
  }
  const fps = (h && h.freqPerWeek) || 7;
  // createdAt 截断
  let dd = days;
  const created = h && h.createdAt ? String(h.createdAt).slice(0, 10) : '';
  if (created) {
    const first = new Date(t - (days - 1) * 86400000).toISOString().slice(0, 10);
    if (created > today) dd = 0;
    else if (created > first) dd = Math.round((t - Date.parse(created + 'T00:00:00Z')) / 86400000) + 1;
  }
  if (dd <= 0) return { done: done, expected: 0, rate: 0, cur: 0, best: 0 };
  const expected = fps >= 7 ? dd : Math.max(1, Math.round(dd * fps / 7));
  return { done: done, expected: expected, rate: expected > 0 ? Math.min(1, done / expected) : 0, cur: 0, best: 0 };
}

const ctxBase = { today: '2026-10-26', habitStats: fakeHabitStats, habits: [], habitLogs: {} };

console.log('\n【milestone】');
eq('1. 3 个勾 1 个 → 33%',
  G.lifeGoalProgress({ progressSource: 'milestone', milestones: [{ done: true }, { done: false }, { done: false }] }, ctxBase).pct, 33);
eq('2. 3 个勾 2 个 → 67%（不是 66）',
  G.lifeGoalProgress({ progressSource: 'milestone', milestones: [{ done: true }, { done: true }, { done: false }] }, ctxBase).pct, 67);
eq('3. 3 个全勾 → 100%',
  G.lifeGoalProgress({ progressSource: 'milestone', milestones: [{ done: true }, { done: true }, { done: true }] }, ctxBase).pct, 100);
eq('4. 空数组 → 未测量',
  G.lifeGoalProgress({ progressSource: 'milestone', milestones: [] }, ctxBase), { pct: null, measured: false, source: 'milestone' });
eq('5. 数组里混 null 元素 → 分母不虚高（1/2 而非 1/3）',
  G.lifeGoalProgress({ progressSource: 'milestone', milestones: [null, { done: true }, { done: false }] }, ctxBase).pct, 50);

console.log('\n【measure】');
const mk = (items, extra) => Object.assign({ progressSource: 'measure', startDate: '2026-01-01', measure: { items } }, extra || {});
eq('6. 22→18，当前 20 → 50%', G.lifeGoalProgress(mk([{ from: 22, to: 18, current: 20 }]), ctxBase).pct, 50);
eq('7. 当前 17（超目标）→ 封顶 100%', G.lifeGoalProgress(mk([{ from: 22, to: 18, current: 17 }]), ctxBase).pct, 100);
eq('8. 当前清空（"" ）→ 未测量，不是 0% 也不是 100%',
  G.lifeGoalProgress(mk([{ from: 22, to: 18, current: '' }]), ctxBase), { pct: null, measured: false, source: 'measure', filled: 0, total: 1 });
eq('9. 当前 null → 未测量', G.lifeGoalProgress(mk([{ from: 22, to: 18, current: null }]), ctxBase).measured, false);
eq('10. 当前低于起点（30）→ 0%，不出现负数',
  G.lifeGoalProgress(mk([{ from: 22, to: 18, current: 30 }]), ctxBase).pct, 0);
eq('11. from == to → 该项剔除，整组未测量',
  G.lifeGoalProgress(mk([{ from: 18, to: 18, current: 18 }]), ctxBase).measured, false);
eq('12. to 是字符串 "18" 也能算', G.lifeGoalProgress(mk([{ from: 22, to: '18', current: '20' }]), ctxBase).pct, 50);
eq('13. 5 项填 1 项且达标 → 100% 但 filled=1 total=5（卡片要标「基于 1/5 项」）',
  (() => { const r = G.lifeGoalProgress(mk([
    { from: 0, to: 10, current: 10 }, { from: 0, to: 10, current: null },
    { from: 0, to: 10, current: null }, { from: 0, to: 10, current: null }, { from: 0, to: 10, current: null }
  ]), ctxBase); return { pct: r.pct, filled: r.filled, total: r.total }; })(),
  { pct: 100, filled: 1, total: 5 });
/* 有名字但没填起止的项：不进计算，但要进分母 —— 否则「5 项只填 1 项」
   会被算成 filled=1/total=1，卡片上永远不会出现「基于 1/5 项指标」。 */
eq('13b. 4 项只写了名字没填数值 → 未测量，但 total=5（分母含未填项）',
  (() => { const r = G.lifeGoalProgress(mk([
    { name: '体脂', from: 22, to: 18, current: 20 },
    { name: '体重', from: null, to: null, current: null },
    { name: '腰围', from: '', to: '', current: '' },
    { name: '静息心率', from: null, to: null, current: null },
    { name: '深蹲', from: 60, to: 100, current: null }
  ]), ctxBase); return { pct: r.pct, filled: r.filled, total: r.total }; })(),
  { pct: 50, filled: 1, total: 5 });
eq('14. 99.5% 不能变成 100%（先判 100 再 min(99)）',
  G.lifeGoalProgress(mk([{ from: 22, to: 18, current: 18.02 }]), ctxBase).pct, 99);
eq('15. 没有 startDate → 未测量', G.lifeGoalProgress({ progressSource: 'measure', measure: { items: [{ from: 22, to: 18, current: 20 }] } }, ctxBase).measured, false);

console.log('\n【habit】');
function habitCtx(logs, habits) {
  return Object.assign({}, ctxBase, { habits: habits, habitLogs: { h1: logs } });
}
function daysAgo(n) {
  return new Date(Date.parse('2026-10-26T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
}
const hDaily = { id: 'h1', freqPerWeek: 7, createdAt: '2020-01-01' };
eq('16. 30 天窗口打了 15 天 → 50%',
  G.lifeGoalProgress({ progressSource: 'habit', habitId: 'h1', startDate: daysAgo(29) },
    habitCtx(Array.from({ length: 15 }, (_, i) => daysAgo(i * 2)), [hDaily])).pct, 50);
eq('17. 习惯被删 → 未测量（不是 0%）',
  G.lifeGoalProgress({ progressSource: 'habit', habitId: 'h1', startDate: daysAgo(29) }, habitCtx([], [])).measured, false);
eq('18. 没有 startDate → 未测量',
  G.lifeGoalProgress({ progressSource: 'habit', habitId: 'h1' }, habitCtx([], [hDaily])).measured, false);
/* ★ 这条守的是「366 截断」回归：
   2022-01-01 起、1760 天、1395 次打卡 → 1395/1760 ≈ 79%。
   若实现里把窗口封成 366 天，会算成 0.3%。 */
const longLogs = Array.from({ length: 1395 }, (_, i) => daysAgo(i));
eq('19. 跨年度目标不被截断（1760 天 / 1395 次 → ≈79%，不是 0%）',
  G.lifeGoalProgress({ progressSource: 'habit', habitId: 'h1', startDate: '2022-01-01' },
    habitCtx(longLogs, [hDaily])).pct, 79);
/* 每周 3 次：30 天窗口的期望是 round(30×3/7)=13 次，不是 30 次。
   打满 13 次即 100%（若分母错用「天数」，会算成 13/30=43%）。 */
eq('20. 每周 3 次、30 天窗口打 13 次 → 100%（分母 13 不是 30）',
  G.lifeGoalProgress({ progressSource: 'habit', habitId: 'h1', startDate: daysAgo(29) },
    habitCtx(Array.from({ length: 13 }, (_, i) => daysAgo(i)), [{ id: 'h1', freqPerWeek: 3, createdAt: '2020-01-01' }])).pct, 100);
eq('20b. 每周 3 次、30 天窗口打 6 次 → 46%（6/13，不是 20%）',
  G.lifeGoalProgress({ progressSource: 'habit', habitId: 'h1', startDate: daysAgo(29) },
    habitCtx(Array.from({ length: 6 }, (_, i) => daysAgo(i)), [{ id: 'h1', freqPerWeek: 3, createdAt: '2020-01-01' }])).pct, 46);

console.log('\n【manual / 时间线 / 落后】');
eq('21. manual 40 → 40%', G.lifeGoalProgress({ progressSource: 'manual', manualPct: 40 }, ctxBase).pct, 40);
eq('22. manual 空 → 未测量', G.lifeGoalProgress({ progressSource: 'manual', manualPct: '' }, ctxBase).measured, false);
eq('23. 时间线：1/1→12/31，今天 10/26 → 约 82%',
  Math.round(G.lifeGoalTimePct({ startDate: '2026-01-01', targetDate: '2026-12-31' }, ctxBase)), 82);
eq('24. 时间线：没有截止日 → null',
  G.lifeGoalTimePct({ startDate: '2026-01-01' }, ctxBase), null);
eq('25. 落后：进度 33 / 时间 58 → warn（差 25）', G.lifeGoalPace({ pct: 33 }, 58), 'warn');
eq('26. 落后：进度 20 / 时间 70 → danger', G.lifeGoalPace({ pct: 20 }, 70), 'danger');
eq('27. 同步：进度 60 / 时间 62 → ok', G.lifeGoalPace({ pct: 60 }, 62), 'ok');
eq('28. 未测量 → 不做落后判定', G.lifeGoalPace({ pct: null }, 70), null);

console.log('\n【二期 · ISO 周】');
/* 周重点按 weekKey 归组。这几条守的是「跨年」与「周内稳定」：
   同一周里任何一天必须算出同一个键，否则周一加的重点周二就看不见了。
   2026 年有 53 个 ISO 周（1/1 与 12/31 都是周四），是特别容易算错的年份。 */
eq('29. 2026-10-26（周一）→ 2026-W44', G.isoWeekKey('2026-10-26'), '2026-W44');
eq('30. 同一周周四 → 同一个键', G.isoWeekKey('2026-10-29'), '2026-W44');
eq('31. 同一周周日 11/01 → 还是 W44（不跳到下一周）', G.isoWeekKey('2026-11-01'), '2026-W44');
eq('32. 2026-01-01（周四）→ W01，不是上一年 W53', G.isoWeekKey('2026-01-01'), '2026-W01');
eq('33. 2027-01-01（周五）→ 2026-W53（跨年归到周四所在年）', G.isoWeekKey('2027-01-01'), '2026-W53');
eq('34. 2024-12-30（周一）→ 2025-W01', G.isoWeekKey('2024-12-30'), '2025-W01');
eq('35. 周范围：10/26 → {10-26, 11-01}',
  G.weekRangeOf('2026-10-26'), { start: '2026-10-26', end: '2026-11-01' });
eq('36. 周范围从周日算也对（11/01 周日 → 同一条周）',
  G.weekRangeOf('2026-11-01'), { start: '2026-10-26', end: '2026-11-01' });

console.log('\n【二期 · 季度检查点】');
eq('37. 闰年 2 月 29 天 / 平年 28 天', [G.daysInMonth(2024, 2), G.daysInMonth(2026, 2)], [29, 28]);
const yg = {
  horizon: 'year', progressSource: 'measure', targetDate: '2026-12-31',
  measure: { items: [{ from: 22, to: 18, current: 20 }] }
};
const cps = G.lifeGoalCheckpointDefaults(yg, ctxBase);
eq('38. 22→18 的四个季度参考值线性插值', cps.map(c => c.target), [21, 20, 19, 18]);
eq('39. 季度末日期固定', cps.map(c => c.at), ['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31']);
eq('40. 里程碑目标不给数值参考',
  G.lifeGoalCheckpointDefaults({ horizon: 'year', progressSource: 'milestone', targetDate: '2026-12-31' }, ctxBase)
    .map(c => c.target), [null, null, null, null]);
eq('41. 月目标不生成季度检查点',
  G.lifeGoalCheckpointDefaults({ horizon: 'month', targetDate: '2026-10-31' }, ctxBase).length, 0);
/* ★ 检查点只铺在目标活着的这段时间里。
   以前固定给四个季末，10 月才立的目标会带着 3/6/9 三个自己不在场的季末 ——
   那三格永远确认不了（季末窗口早过），折叠区永远是 0/4，
   等于一建好就替用户认了三笔没做过的账。 */
const late = G.lifeGoalCheckpointDefaults(
  { horizon: 'year', startDate: '2026-10-27', targetDate: '2026-12-31' }, ctxBase);
eq('43. 10 月才开始的年度目标只留一个季末', late.map(c => c.at), ['2026-12-31']);
/* 位置法在这里是对的：只剩 12/31 一条时它正好落在区间终点 → 参考值 = 终值。
   旧的序号法（按 q 序号乘 1/4）在只剩 Q4 时也会给终值，但目标是
   10/01→次年 03/31 时，季末 12/31 只在半程，序号法会给 25% 处的值。 */
const lateNum = G.lifeGoalCheckpointDefaults({
  horizon: 'year', startDate: '2026-10-27', targetDate: '2026-12-31',
  progressSource: 'measure', measure: { items: [{ from: 22, to: 18 }] }
}, ctxBase);
eq('44. 只剩一条季末时数值参考落在终值', lateNum.map(c => c.target), [18]);
eq('45. 11 月立、12 月中结束的短目标不给检查点',
  G.lifeGoalCheckpointDefaults(
    { horizon: 'year', startDate: '2026-11-05', targetDate: '2026-12-15' }, ctxBase).length, 0);
/* 老数据里躺着区间外的空白检查点：滤掉；但确认过的（doneAt）一律保留 ——
   那是用户当时真的看过一眼的记录，抹掉等于改历史。 */
const legacy = G.lifeGoalCheckpointsOf({
  horizon: 'year', startDate: '2026-10-27', targetDate: '2026-12-31',
  checkpoints: [
    { q: 1, at: '2026-03-31', target: 21, note: '', doneAt: null },
    { q: 3, at: '2026-09-30', target: 19, note: '', doneAt: null },
    { q: 4, at: '2026-12-31', target: 18, note: '', doneAt: null }
  ]
}, ctxBase);
eq('46. 老数据里区间外的空白检查点被滤掉', legacy.map(c => c.at), ['2026-12-31']);
const legacyDone = G.lifeGoalCheckpointsOf({
  horizon: 'year', startDate: '2026-10-27', targetDate: '2026-12-31',
  checkpoints: [{ q: 3, at: '2026-09-30', target: 19, note: '当时确实看过', doneAt: 1759000000000 }]
}, ctxBase);
eq('47. 区间外但已确认的检查点保留', legacyDone.length, 1);

eq('42. 存过就以存的为准，不覆盖用户的修改',
  G.lifeGoalCheckpointsOf({ horizon: 'year', targetDate: '2026-12-31', checkpoints: [{ q: 2, at: '2026-06-30', target: 20.5, note: '加了力量训练' }] }, ctxBase).length, 1);
/* 上升沿：窗口内且没确认过才提示；确认过 / 已过窗口 / 未到窗口都不提示 */
const cpGoal = {
  horizon: 'year', status: 'active', targetDate: '2026-12-31',
  checkpoints: [{ q: 3, at: '2026-09-30', target: 19, note: '', doneAt: null }]
};
eq('43. 季末前 7 天到点', G.dueCheckpoint(cpGoal, '2026-09-25').q, 3);
eq('44. 季末后 7 天内仍可补（不因错过一天就丢）', G.dueCheckpoint(cpGoal, '2026-10-06').q, 3);
eq('45. 过了窗口就静默跳过', G.dueCheckpoint(cpGoal, '2026-10-20'), null);
eq('46. 确认过就不再提示（不做常驻噪音）',
  G.dueCheckpoint({ horizon: 'year', status: 'active', targetDate: '2026-12-31', checkpoints: [{ q: 3, at: '2026-09-30', doneAt: 1 }] }, '2026-09-30'), null);
eq('47. 已放弃的目标不提示',
  G.dueCheckpoint({ horizon: 'year', status: 'dropped', targetDate: '2026-12-31', checkpoints: [{ q: 3, at: '2026-09-30', doneAt: null }] }, '2026-09-30'), null);

console.log('\n【二期 · 收尾窗口】');
eq('48. 10/30 → 收 10 月', G.lifeGoalEvalWindow('2026-10-30'), { cadence: 'month', period: '2026-10', label: '10 月收尾', year: 2026, month: 10, alsoMonth: null });
eq('49. 11/02 → 仍在收 10 月（跨月补录）', G.lifeGoalEvalWindow('2026-11-02').period, '2026-10');
eq('50. 11/10 → 不在窗口', G.lifeGoalEvalWindow('2026-11-10'), null);
/* 年末那几天：年收尾优先，但 12 月的月目标不能因此永远收不了尾
   （12/29-31 被年挡住、1/4 之后月窗口已关 → 必须挂在 alsoMonth 上一起收） */
eq('51. 01/03 → 年收尾，同时带 alsoMonth=2026-12', [G.lifeGoalEvalWindow('2027-01-03').cadence, G.lifeGoalEvalWindow('2027-01-03').alsoMonth], ['year', '2026-12']);
eq('52. 12/20 → 年收尾优先，也不同时弹月收尾', [G.lifeGoalEvalWindow('2026-12-20').cadence, G.lifeGoalEvalWindow('2026-12-20').alsoMonth], ['year', null]);
eq('53. 01/10（次年）→ 仍在收上一年', G.lifeGoalEvalWindow('2027-01-10').period, '2026');
eq('54. 2 月的最后 3 天算窗口（平年 26 号起）', G.lifeGoalEvalWindow('2027-02-26').period, '2027-02');
eq('55. 目标归属：年度目标按 targetDate 年份',
  G.lifeGoalInPeriod({ horizon: 'year', status: 'active', targetDate: '2026-12-31' }, G.lifeGoalEvalWindow('2026-12-20')), true);
eq('56. 目标归属：9 月建的年度目标，12 月照样要收尾（不看 createdAt）',
  G.lifeGoalInPeriod({ horizon: 'year', status: 'active', targetDate: '2026-12-31', createdAt: '2026-09-01T00:00:00Z' }, G.lifeGoalEvalWindow('2026-12-20')), true);
eq('57. 已放弃的目标不进收尾列表',
  G.lifeGoalInPeriod({ horizon: 'month', status: 'dropped', targetDate: '2026-10-31' }, G.lifeGoalEvalWindow('2026-10-30')), false);
eq('58. 年收尾期间，12 月的月目标挂在 alsoMonth 里也能收',
  G.lifeGoalInPeriod({ horizon: 'month', status: 'active', targetDate: '2026-12-31' }, G.lifeGoalEvalWindow('2027-01-02')), true);
eq('58b. 年收尾期间，11 月的月目标不混进来',
  G.lifeGoalInPeriod({ horizon: 'month', status: 'active', targetDate: '2026-11-30' }, G.lifeGoalEvalWindow('2027-01-02')), false);

console.log('\n【二期 · 数值陈旧】');
eq('59. 15 天没更新的 measure 目标被点名',
  G.staleMeasureGoals([{ progressSource: 'measure', status: 'active', measureUpdatedAt: '2026-10-01' }], '2026-10-26').length, 1);
eq('60. 5 天前更新过的不点名',
  G.staleMeasureGoals([{ progressSource: 'measure', status: 'active', measureUpdatedAt: '2026-10-21' }], '2026-10-26').length, 0);
eq('61. 里程碑 / 手动目标不参与（它们本来就不用填数）',
  G.staleMeasureGoals([{ progressSource: 'milestone' }, { progressSource: 'manual' }, { progressSource: 'habit' }], '2026-10-26').length, 0);

console.log('\n【三期 · 复盘周期】');
eq('62. 2026-10 往前 3 个月跨年', G.lifeReviewPeriods('2026-01-15', 3).map(p => p.period), ['2026-01', '2025-12', '2025-11']);
eq('63. 年度周期列表', G.lifeReviewPeriods('2026-10-26', 2, 'year').map(p => p.period), ['2026', '2025']);
eq('64. 只给有目标的领域出题（空领域不占一屏）',
  G.lifeReviewAreaIds([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
    [{ areaId: 'a1', status: 'active' }, { areaId: 'a3', status: 'active' }], 'month', '2026-10'), ['a1', 'a3']);
eq('65. 放弃的目标不算「有内容」',
  G.lifeReviewAreaIds([{ id: 'a1' }], [{ areaId: 'a1', status: 'dropped' }], 'month', '2026-10'), []);
eq('66. 已达成也算有内容（那个领域确实发生过事）',
  G.lifeReviewAreaIds([{ id: 'a1' }], [{ areaId: 'a1', status: 'achieved' }], 'month', '2026-10'), ['a1']);

console.log('\n【三期 · 快照冻结】');
const areas2 = [{ id: 'a1' }, { id: 'a2' }];
const snap = G.lifeReviewSnapshot(areas2, [
  { areaId: 'a1', status: 'active', progressSource: 'milestone', milestones: [{ done: true }, { done: true }, { done: false }, { done: false }] },
  { areaId: 'a1', status: 'active', progressSource: 'manual', manualPct: 80 },
  { areaId: 'a2', status: 'active', progressSource: 'measure', startDate: '2026-01-01', measure: { items: [{ from: 1, to: 2, current: null }] } }
], ctxBase);
eq('67. 平均进度 = (50 + 80) / 2', snap.a1.pct, 65);
eq('68. 目标数只算 active', snap.a1.goalCount, 2);
eq('69. 只有未测量目标时 pct 是 null，不是 0', [snap.a2.pct, snap.a2.measured], [null, false]);
eq('70. 没有目标的领域 goalCount=0', G.lifeReviewSnapshot([{ id: 'a3' }], [], ctxBase).a3.goalCount, 0);
/* 快照是「当时算出来的数」，不引用目标对象 —— 后面改目标不能影响它 */
const frozen = JSON.parse(JSON.stringify(snap));
eq('71. 快照可 JSON 序列化（不含函数/循环引用）', JSON.stringify(frozen) === JSON.stringify(snap), true);

console.log('\n【三期 · 上次的下一步】');
const rvList = [
  { cadence: 'month', period: '2026-08', notes: { a1: { next: '旧' } } },
  { cadence: 'month', period: '2026-09', notes: { a1: { next: '每天读 20 页' }, a2: { next: 'x' } } },
  { cadence: 'year', period: '2025', notes: { a1: { next: '年度的' } } }
];
eq('72. 取最近一次同节奏的 next', G.lifeReviewLastNext(rvList, 'month', 'a1'), '每天读 20 页');
eq('73. 年复盘不会串到月复盘里', G.lifeReviewLastNext(rvList, 'year', 'a1'), '年度的');
eq('74. 没写过 → 空串', G.lifeReviewLastNext(rvList, 'month', 'a9'), '');
eq('75. 同周期只留一条：能找到就返回它（再次写 = 覆盖）',
  (G.lifeReviewFind([{ cadence: 'month', period: '2026-09', id: 'r1' }], 'month', '2026-09') || {}).id, 'r1');
eq('76. 不同节奏的同名周期不混（2026 年 ≠ 2026-01）',
  G.lifeReviewFind([{ cadence: 'month', period: '2026-01', id: 'r2' }], 'year', '2026'), null);

console.log('\n【五期 · 筛选态排序合并】');
/* 只看月目标时拖动，不能把隐藏的年度目标顺序冲掉 */
eq('77. 部分可见：B、D 对调，A、C 不动',
  G.mergeVisibleOrder(['A', 'B', 'C', 'D'], ['B', 'D'], ['D', 'B']), ['A', 'D', 'C', 'B']);
eq('78. 全可见时就是整体重排',
  G.mergeVisibleOrder(['A', 'B', 'C'], ['A', 'B', 'C'], ['C', 'A', 'B']), ['C', 'A', 'B']);
eq('79. 相邻两项对调只影响这两个槽位',
  G.mergeVisibleOrder(['A', 'B', 'C', 'D'], ['B', 'C'], ['C', 'B']), ['A', 'C', 'B', 'D']);
eq('80. 脏输入（数量同但内容不同）整体放弃，不写坏数据',
  G.mergeVisibleOrder(['A', 'B', 'C'], ['B'], ['C']), ['A', 'B', 'C']);
eq('81. 可见项根本不在全量里 → 原样返回',
  G.mergeVisibleOrder(['A', 'B'], ['X'], ['Y']), ['A', 'B']);
eq('82. 空可见列表 → 原样返回',
  G.mergeVisibleOrder(['A', 'B'], [], []), ['A', 'B']);

console.log('\n【五期 · 周复盘】');
const wrs = [
  { cadence: 'week', period: '2026-W43', focus: '上周' },
  { cadence: 'week', period: '2026-W44', focus: '本周' },
  { cadence: 'month', period: '2026-10', focus: '月' }
];
eq('83. 按周键找到本周那条', (G.lifeWeekReviewOf(wrs, '2026-W44') || {}).focus, '本周');
eq('84. 不把月复盘当成周复盘', G.lifeWeekReviewOf(wrs, '2026-10'), null);
eq('85. 没写过 → null', G.lifeWeekReviewOf(wrs, '2026-W45'), null);

console.log('\n' + (fails.length ? '✗ ' + fails.length + ' 条失败 / 共 ' + (pass + fails.length) : '✓ 全部 ' + pass + ' 条通过'));
process.exit(fails.length ? 1 : 0);
