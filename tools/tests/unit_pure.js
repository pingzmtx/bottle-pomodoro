#!/usr/bin/env node
/**
 * 🍅 M4d · 纯函数 Node 单测
 * 用法: node tests/unit_pure.js     （退出码 0=全绿）
 * 被测: src/scripts/00_pure_core.js（浏览器与 Node 同一份实现）
 */
'use strict';
const P = require('../../src/scripts/00_pure_core.js');
let pass = 0, fail = 0;
function eq(desc, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { pass++; }
  else { fail++; console.log('✗', desc, '→ 期望', JSON.stringify(b), '实际', JSON.stringify(a)); }
}
function ok(desc, cond) { eq(desc, !!cond, true); }

/* —— getDateStr：本地日期 YYYY-MM-DD（补零/跨年） —— */
eq('getDateStr(Date)', P.getDateStr(new Date(2026, 8, 4, 13, 30)), '2026-09-04');
eq('getDateStr(时间戳)', P.getDateStr(new Date(2026, 8, 4, 13, 30).getTime()), '2026-09-04');
eq('getDateStr 补零/跨年', P.getDateStr(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
ok('getDateStr 类型', typeof P.getDateStr(new Date()) === 'string');

/* —— fmtTomatoNum：整数不带小数、1 位小数、负数归零 —— */
eq('fmtTomatoNum 整数', P.fmtTomatoNum(2), '2');
eq('fmtTomatoNum 一位小数', P.fmtTomatoNum(2.5), '2.5');
eq('fmtTomatoNum 负数归零', P.fmtTomatoNum(-1), '0');
eq('fmtTomatoNum 空值归零', P.fmtTomatoNum(null), '0');

/* —— calcPomos：时长→🍅 折算（完整/半个/未完成，0.5 粒度，下限 0.5） —— */
eq('calcPomos 25min=1', P.calcPomos(1500, 'full'), 1);
eq('calcPomos 45min=1.5', P.calcPomos(2700, 'full'), 1.5);
eq('calcPomos 50min=2', P.calcPomos(3000, 'full'), 2);
eq('calcPomos 半个=0.5', P.calcPomos(600, 'half'), 0.5);
eq('calcPomos 未完成=0', P.calcPomos(1500, 'incomplete'), 0);
/* 「仅记录」：只记时间、不算番茄（补记非专注事项，例：去配眼镜） */
eq('calcPomos 仅记录=0', P.calcPomos(1500, 'log'), 0);
eq('calcPomos 仅记录超长也=0', P.calcPomos(7200, 'log'), 0);
ok('isLogRecord 只认 type=log', P.isLogRecord({ type: 'log' }) === true && P.isLogRecord({ type: 'full' }) === false && P.isLogRecord(null) === false);
/* CSV 导出的「类型」列用中文（表头全中文，值不该是 full/half/log 这种枚举） */
eq('typeLabel 完整', P.typeLabel('full'), '完整');
eq('typeLabel 半个', P.typeLabel('half'), '半个');
eq('typeLabel 未完成', P.typeLabel('incomplete'), '未完成');
eq('typeLabel 仅记录', P.typeLabel('log'), '仅记录');
eq('typeLabel 未知值原样返回', P.typeLabel('weird'), 'weird');
eq('typeLabel 空值返回空串', P.typeLabel(undefined), '');
eq('calcPomos 极短完整→下限0.5', P.calcPomos(300, 'full'), 0.5);
/* 完整🍅 **至少 1 个**，多出来的分钟数才往上加。
   是否算「完整」由用户在完成弹窗里选（默认只有满 25 分钟才默认选它，见 01c showFinishModal）。
   原先一律 floor ⇒ 选了「完整🍅」却只给 0.5，文案与账目自相矛盾。 */
eq('calcPomos 15min 选完整=1（完整就是 1 个起）', P.calcPomos(900, 'full'), 1);
eq('calcPomos 22.5min 选完整=1', P.calcPomos(1350, 'full'), 1);
eq('calcPomos 24.83min 选完整=1', P.calcPomos(1490, 'full'), 1);
eq('calcPomos 15min 选半个=0.5', P.calcPomos(900, 'half'), 0.5);
eq('calcPomos 37.5min 选完整=1.5（多出的分钟往上加）', P.calcPomos(2250, 'full'), 1.5);

/* —— getPomos：新老记录兼容 —— */
eq('getPomos 读 pomos 字段', P.getPomos({ pomos: 3 }), 3);
eq('getPomos 历史 full', P.getPomos({ type: 'full' }), 1);
eq('getPomos 历史 half', P.getPomos({ type: 'half' }), 0.5);
eq('getPomos 空记录', P.getPomos(null), 0);

/* —— fmtTime / getTodayStr —— */
eq('fmtTime 12h 补零', P.fmtTime(new Date(2026, 8, 4, 9, 7)), '9:07');
ok('getTodayStr 形如 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(P.getTodayStr()));

/* —— deepSanitize：原型污染键递归剔除 —— */
eq('deepSanitize 删顶层 __proto__', P.deepSanitize(JSON.parse('{"a":1,"__proto__":{"x":9}}')), { a: 1 });
eq('deepSanitize 递归删嵌套 constructor', P.deepSanitize({ s: JSON.parse('{"constructor":{"a":1},"b":2}') }), { s: { b: 2 } });
eq('deepSanitize 数组内对象净化', P.deepSanitize([JSON.parse('{"__proto__":{},"k":1}'), 2]), [{ k: 1 }, 2]);
eq('deepSanitize 普通字段无损', P.deepSanitize({ a: [1, { b: 'x' }], c: null }), { a: [1, { b: 'x' }], c: null });
eq('deepSanitize 原始值原样返回', P.deepSanitize(7), 7);
ok('deepSanitize 不改入参（纯函数）', (function () { const src = { a: 1 }; P.deepSanitize(src); return JSON.stringify(src) === '{"a":1}'; })());

/* —— idArg：内联 handler 的 id 安全嵌入 —— */
eq('idArg 数字原样', P.idArg(1759800000000), '1759800000000');
eq('idArg 字符串加引号', P.idArg('rec_abc'), "'rec_abc'");
eq('idArg 数字字符串加引号', P.idArg('1759800000000'), "'1759800000000'");
eq('idArg 转义单引号', P.idArg("a'b"), "'a\\'b'");
eq('idArg 转义双引号', P.idArg('a"b'), "'a&quot;b'");
eq('idArg 转义尖括号与 &', P.idArg('<x>&y'), "'&lt;x>&amp;y'");
eq('idArg 空值不炸', P.idArg(null), "'null'");

/* —— idEq：跨类型 id 容错比较 —— */
ok('idEq 数字相同', P.idEq(123, 123) === true);
ok('idEq 数字 vs 数字字符串', P.idEq(1759800000000, '1759800000000') === true);
ok('idEq 不同值', P.idEq('a', 'b') === false);
ok('idEq null 不配 undefined', P.idEq(null, undefined) === false);
ok('idEq null 配 null', P.idEq(null, null) === true);
ok('idEq 0 与 "0"', P.idEq(0, '0') === true);

/* —— mergeLogRecords：日志展示层合并（不改数据、不改统计） —— */
const MK = function (id, name, type, s, e, sec, extra) {
  return Object.assign({ id: id, taskName: name, type: type, startTime: s, endTime: e, effectiveSeconds: sec }, extra || {});
};
const B0 = new Date(2026, 9, 8, 8, 0, 0).getTime();
const MIN = 60000;
/* 相接两段同任务同类型 → 一组两段，时长/番茄累加 */
var _g1 = P.mergeLogRecords([
  MK(2, '数学', 'full', B0 + 25 * MIN, B0 + 50 * MIN, 25 * 60, { pomos: 1 }),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60, { pomos: 1 })
]);
eq('合并:相接两段→一组', _g1.length, 1);
eq('合并:段数', _g1[0].segments.length, 2);
eq('合并:时长累加', _g1[0].effectiveSeconds, 50 * 60);
eq('合并:番茄累加', _g1[0].pomos, 2);
eq('合并:起止范围', [_g1[0].startTime, _g1[0].endTime], [B0, B0 + 50 * MIN]);
/* 间隔 ≤ LOG_MERGE_GAP_SECONDS（含端点）→ 合并；超过 → 断开成两条。
   阈值来自纯函数层常量，测试跟着常量走（改阈值不用手改这里的分钟数）。 */
const _gapMin = P.LOG_MERGE_GAP_SECONDS / 60;
eq('合并:间隔恰好等于阈值→合并', P.mergeLogRecords([
  MK(2, '数学', 'full', B0 + (25 + _gapMin) * MIN, B0 + (50 + _gapMin) * MIN, 25 * 60),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60)
]).length, 1);
eq('合并:超过阈值 1 分钟→不合并', P.mergeLogRecords([
  MK(2, '数学', 'full', B0 + (26 + _gapMin) * MIN, B0 + (51 + _gapMin) * MIN, 25 * 60),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60)
]).length, 2);
/* 轻微重叠（补记只填到分钟 → 前一段 16:42:10 结束、后一段 16:42:00 开始）→ 仍合并。
   旧写法要求 gap>=0，同一件事被拆成两行。 */
var _tolSec = P.LOG_MERGE_OVERLAP_TOL_SEC;
eq('合并:重叠 10 秒→合并（补记按分钟取整的常态）', P.mergeLogRecords([
  MK(2, '报税', 'log', B0 + 25 * MIN - 10 * 1000, B0 + 50 * MIN - 10 * 1000, 25 * 60),
  MK(1, '报税', 'log', B0, B0 + 25 * MIN, 25 * 60)
]).length, 1);
eq('合并:重叠恰好等于容忍上限→合并', P.mergeLogRecords([
  MK(2, '报税', 'log', B0 + 25 * MIN - _tolSec * 1000, B0 + 50 * MIN - _tolSec * 1000, 25 * 60),
  MK(1, '报税', 'log', B0, B0 + 25 * MIN, 25 * 60)
]).length, 1);
eq('合并:重叠超过容忍上限→不合并', P.mergeLogRecords([
  MK(2, '报税', 'log', B0 + 25 * MIN - (_tolSec + 1) * 1000, B0 + 50 * MIN, 25 * 60),
  MK(1, '报税', 'log', B0, B0 + 25 * MIN, 25 * 60)
]).length, 2);
/* 组内段参差不齐时，间隔按「整组最晚结束」算，不能拿上一段的结束当基准。
   构造：第 1 段 0–25，第 2 段与它重叠 1 分钟（容忍内）→ 并组后组尾 25；
   第 3 段 25 分 30 秒开始 —— 用组尾算 gap=+30s 合并，用「上一段结束」也算得对，
   所以这里额外让第 2 段结束早于第 1 段（24 分 → 组尾仍是 25 分），才能分辨两种写法。 */
eq('合并:前一段更长时按组尾比间隔', P.mergeLogRecords([
  MK(3, '数学', 'full', B0 + 25 * MIN + 30 * 1000, B0 + 50 * MIN, 20 * 60),
  MK(2, '数学', 'full', B0 + 24 * MIN, B0 + 24.9 * MIN, 54 * 1000),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60)
]).length, 1);
/* 任务名不同 / 类型不同 → 不合并 */
eq('合并:任务名不同不合并', P.mergeLogRecords([
  MK(2, '英语', 'full', B0 + 25 * MIN, B0 + 50 * MIN, 25 * 60),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60)
]).length, 2);
/* 专注类（完整/半个/未完成/打断）互相可续；补记「仅记录」单独一类，不与专注混并 */
eq('合并:专注与补记不跨类合并', P.mergeLogRecords([
  MK(2, '数学', 'log', B0 + 25 * MIN, B0 + 50 * MIN, 25 * 60),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60)
]).length, 2);
/* 同一任务 完整🍅 接着 半个🍅：结算结果不同，但就是一整段，必须合并 */
var _gm = P.mergeLogRecords([
  MK(2, '数学', 'half', B0 + 26 * MIN, B0 + 38 * MIN, 12 * 60, { pomos: 0.5 }),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60, { pomos: 1 })
]);
eq('合并:完整+半个 同任务→一组', _gm.length, 1);
eq('合并:完整+半个 保留两段', _gm[0].segments.length, 2);
eq('合并:完整+半个 标记 mixedTypes', _gm[0].mixedTypes, true);
eq('合并:完整+半个 番茄累加', _gm[0].pomos, 1.5);
/* 起止完全相同的重复记录 → 去重成一段并记 dropped */
var _g2 = P.mergeLogRecords([
  MK(2, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60, { pomos: 1 }),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60, { pomos: 1 })
]);
eq('合并:完全重复→一组', _g2.length, 1);
eq('合并:重复只留一段', _g2[0].segments.length, 1);
eq('合并:多余条数记在 dropped', _g2[0].dropped, 1);
eq('合并:去重后时长不翻倍', _g2[0].effectiveSeconds, 25 * 60);
/* 同类型合并时不应误标 mixedTypes */
eq('合并:同类型未误标 mixedTypes', _g2[0].mixedTypes, false);
/* 待补填不合并（起止时间还没定） */
eq('合并:待补填不合并', P.mergeLogRecords([
  MK(2, '数学', 'full', B0 + 25 * MIN, B0 + 50 * MIN, 25 * 60, { pending: true }),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60, { pending: true })
]).length, 2);
/* 输出按 startTime 降序（渲染顺序） */
var _g3 = P.mergeLogRecords([
  MK(2, '数学', 'full', B0 + 25 * MIN, B0 + 50 * MIN, 25 * 60),
  MK(1, '数学', 'full', B0, B0 + 25 * MIN, 25 * 60),
  MK(3, '英语', 'full', B0 + 120 * MIN, B0 + 145 * MIN, 25 * 60)
]);
eq('合并:两组', _g3.length, 2);
ok('合并:输出按时间降序', _g3[0].startTime > _g3[1].startTime);
/* 空数组安全 */
eq('合并:空输入', P.mergeLogRecords([]).length, 0);
eq('合并:null 输入安全', P.mergeLogRecords(null).length, 0);
ok('合并:已导出', typeof P.mergeLogRecords === 'function');

/* ===== 本轮统计（computeRoundStats）：唯一真相是记录 =====
 * 背景：本轮三个数字以前是自增计数器，删日志/改类型后不会回落，
 * 于是「未完成 4」而列表里只剩 1 条。改成从记录现算，删/改/导入天然同步。 */
const R0 = new Date(2026, 9, 8, 9, 0).getTime();
const RMIN = 60000;
function RK(id, type, offMin, endMin) {
  return { id: id, taskName: '数学', type: type, startTime: R0 + offMin * RMIN, endTime: R0 + endMin * RMIN, duration: (endMin - offMin) * 60 };
}
const _rs1 = P.computeRoundStats([
  RK(1, 'full', 25, 50),
  RK(2, 'half', 60, 70),
  RK(3, 'incomplete', 80, 90)
], R0);
eq('本轮:完整数', _rs1.full, 1);
eq('本轮:半个数', _rs1.half, 1);
eq('本轮:未完成数', _rs1.incomplete, 1);
eq('本轮:起点前的记录不算本轮', P.computeRoundStats([RK(1, 'full', -60, -35)], R0).full, 0);
/* 删掉记录 → 数字跟着掉（用户报的就是这条） */
const _two = [RK(1, 'incomplete', 1, 10), RK(2, 'incomplete', 20, 30)];
eq('本轮:删除前 2 条', P.computeRoundStats(_two, R0).incomplete, 2);
eq('本轮:删除后剩 1 条', P.computeRoundStats(_two.slice(0, 1), R0).incomplete, 1);
/* 改类型也立刻反映 */
const _chg = [RK(1, 'incomplete', 1, 10)];
_chg[0].type = 'full';
eq('本轮:改类型后未完成归零', P.computeRoundStats(_chg, R0).incomplete, 0);
eq('本轮:改类型后完整 +1', P.computeRoundStats(_chg, R0).full, 1);
/* 「仅记录」既不算专注、也不算未完成 */
eq('本轮:仅记录不计未完成', P.computeRoundStats([RK(9, 'log', 1, 10)], R0).incomplete, 0);
eq('本轮:仅记录不计完整', P.computeRoundStats([RK(9, 'log', 1, 10)], R0).full, 0);
/* lastFullEndTime 取最后一个完整番茄的结束时间（长休判定要用） */
eq('本轮:lastFullEndTime 取最后一条', P.computeRoundStats([RK(1, 'full', 25, 50), RK(2, 'full', 120, 145)], R0).lastFullEndTime, R0 + 145 * RMIN);
/* 空 / 脏输入安全 */
eq('本轮:空输入', P.computeRoundStats([], R0).full, 0);
eq('本轮:null 安全', P.computeRoundStats(null, R0).incomplete, 0);
eq('本轮:脏元素安全', P.computeRoundStats([null, undefined, {}], R0).incomplete, 0);
ok('本轮:已导出', typeof P.computeRoundStats === 'function');

/* —— 计划预计时段：todoEstDurationMin（专注+休息时间线） —— */
const _S = { workDuration: 25, shortBreak: 5, longBreak: 20, longInterval: 4 };
eq('时长:1🍅=25', P.todoEstDurationMin(1, _S), 25);
eq('时长:2🍅=25+5+25', P.todoEstDurationMin(2, _S), 55);
eq('时长:4🍅=4段专注+3短休', P.todoEstDurationMin(4, _S), 4 * 25 + 3 * 5);
eq('时长:5🍅第1个长休', P.todoEstDurationMin(5, _S), 5 * 25 + 3 * 5 + 20);
eq('时长:0.5🍅=半个专注', P.todoEstDurationMin(0.5, _S), 13);   /* 12.5 → round */
eq('时长:1.5🍅=专注+短休+半个', P.todoEstDurationMin(1.5, _S), 25 + 5 + 13);
eq('时长:4.5🍅长休后接半个', P.todoEstDurationMin(4.5, _S), 4 * 25 + 3 * 5 + 20 + 13);
eq('时长:读用户设置(50min)', P.todoEstDurationMin(1, { workDuration: 50, shortBreak: 10, longBreak: 30, longInterval: 2 }), 50);
eq('时长:长休跟随 longInterval', P.todoEstDurationMin(3, { workDuration: 25, shortBreak: 5, longBreak: 30, longInterval: 2 }), 3 * 25 + 5 + 30);
eq('时长:无番茄=0', P.todoEstDurationMin(0, _S), 0);
eq('时长:空值=0', P.todoEstDurationMin(null, _S), 0);
eq('时长:脏值=0', P.todoEstDurationMin('abc', _S), 0);
eq('时长:无设置用默认', P.todoEstDurationMin(1, null), P.POMO_DEFAULT_MINUTES);

/* —— 本地时间加减：addMinutesToLocal / parseLocalDT —— */
eq('解析 DT 空', P.parseLocalDT(''), null);
eq('解析 DT 非法', P.parseLocalDT('今天下午'), null);
eq('解析 DT 分钟', P.parseLocalDT('2026-10-11 14:00').getHours(), 14);
eq('加分钟:普通', P.addMinutesToLocal('2026-10-11 14:00', 105), '2026-10-11 15:45');
eq('加分钟:跨天', P.addMinutesToLocal('2026-10-11 23:30', 45), '2026-10-12 00:15');
eq('加分钟:跨月', P.addMinutesToLocal('2026-10-31 23:30', 45), '2026-11-01 00:15');
eq('加分钟:接受 T 分隔', P.addMinutesToLocal('2026-10-11T14:00', 60), '2026-10-11 15:00');
eq('加分钟:非法输入空', P.addMinutesToLocal('', 60), '');
eq('加分钟:非法分钟空', P.addMinutesToLocal('2026-10-11 14:00', NaN), '');

/* —— 预计时段 = 排期第一段 ——
   提醒与排期分开，不再有「提醒时间 + 番茄数自动推算结束」这套。
   老字段（remindAt/estEnd）仍能合成一段，纯粹为了不炸旧存档；新写入只走 blocks。 */
eq('预计结束:取第一段的结束',
  P.todoEstEnd({ blocks: [{ start: '2026-10-11 14:00', end: '2026-10-11 14:55' }] }, _S), '2026-10-11 14:55');
eq('预计结束:多段时取最早那段',
  P.todoEstEnd({ blocks: [
    { start: '2026-10-11 15:00', end: '2026-10-11 16:00' },
    { start: '2026-10-11 09:00', end: '2026-10-11 10:00' }
  ] }, _S), '2026-10-11 10:00');
eq('预计结束:没有排期段 → 空', P.todoEstEnd({ pomodoros: 2 }, _S), '');
eq('预计结束:只有提醒、没有段也没有番茄 → 空', P.todoEstEnd({ remindAt: '2026-10-11 14:00' }, _S), '');
eq('预计结束:老字段 remindAt + 番茄 → 合成一段',
  P.todoEstEnd({ remindAt: '2026-10-11 14:00', pomodoros: 2 }, _S), '2026-10-11 14:55');
eq('预计结束:老字段有 estEnd 时用它',
  P.todoEstEnd({ remindAt: '2026-10-11 14:00', pomodoros: 2, estEnd: '2026-10-11 18:00' }, _S), '2026-10-11 18:00');
eq('预计结束:estEnd 垃圾值 → 回落到番茄推算',
  P.todoEstEnd({ remindAt: '2026-10-11 14:00', pomodoros: 2, estEnd: '瞎写' }, _S), '2026-10-11 14:55');
eq('预计结束:null 安全', P.todoEstEnd(null, _S), '');

/* —— todoEstInfo：只描述第一段，不再有「自动推算」态 —— */
eq('todoEstAuto:恒 false（提醒不再推算结束）',
  P.todoEstAuto({ remindAt: '2026-10-11 14:00', pomodoros: 2 }, _S), false);
const _I1 = P.todoEstInfo({ blocks: [{ start: '2026-10-11 14:00', end: '2026-10-11 14:55' }] }, _S);
eq('todoEstInfo:auto 恒 false', _I1.auto, false);
eq('todoEstInfo:start 是第一段开始', _I1.start, '2026-10-11 14:00');
eq('todoEstInfo:end 是第一段结束', _I1.end, '2026-10-11 14:55');
eq('todoEstInfo:mins 是这一段时长', _I1.mins, 55);
eq('todoEstInfo:空 todo 不炸', P.todoEstInfo(null, _S).end, '');
eq('todoEstInfo:没有段 → 空', P.todoEstInfo({ remindAt: '2026-10-11 14:00' }, _S).end, '');

/* —— 24 小时制（hour12:false）：同一批函数换挡，数据串仍 24h —— */
P.setHour12(false);
eq('24h fmtHM', P.fmtHM(14, 5), '14:05');
eq('24h fmtHM 补零', P.fmtHM(9, 7), '09:07');
eq('24h fmtTime', P.fmtTime(new Date(2026, 8, 4, 9, 7)), '09:07');
eq('24h fmtClockHM', P.fmtClockHM('2026-10-11 14:00'), '14:00');
eq('24h clockHour12=false', P.clockHour12(), false);
P.setHour12(true);
eq('默认(无设置) 走 12 小时制', P.clockHour12(), true);

/* —— 时间显示：12 小时制（**不印上午/下午前缀**，口径为定稿）+ 数据串不受开关影响 —— */
eq('fmtHM 12h 下午', P.fmtHM(14, 5), '2:05');
eq('fmtHM 12h 上午', P.fmtHM(9, 0), '9:00');
eq('fmtHM 12h 零点', P.fmtHM(0, 30), '12:30');
eq('fmtHM 12h 正午', P.fmtHM(12, 5), '12:05');
eq('fmtClockHM 带日期', P.fmtClockHM('2026-10-11 14:00'), '2:00');
eq('fmtClockHM 纯时分', P.fmtClockHM('14:00'), '2:00');
eq('fmtClockHM 空串', P.fmtClockHM(''), '');
eq('fmtTime 12h', P.fmtTime(new Date(2026, 9, 11, 14, 5)), '2:05');
/* ★ 关键回归：落盘数据串永远 24 小时制，绝不能被显示开关污染 */
eq('normDT 不受 12 小时制影响', P.normDT('2026-10-11 14:00'), '2026-10-11 14:00');
eq('dtToInput 不受 12 小时制影响', P.dtToInput('2026-10-11 14:00'), '2026-10-11T14:00');
eq('addMinutesToLocal 跨天正常', P.addMinutesToLocal('2026-10-11 23:50', 20), '2026-10-12 00:10');
eq('addMinutesToLocal 溢出 → 空(不进脏串)', P.addMinutesToLocal('2026-10-11 09:00', 3e11), '');
/* 跨天的段在本模型里不成立（网格只画 07:00–22:00），合成时被丢弃 */
eq('todoEstEnd 跨天数据 → 不成段', P.todoEstEnd({ remindAt: '2026-10-11 23:50', pomodoros: 2 }, _S), '');

/* —— 计划「重复周期」纯函数（规则运算，跟界面无关） —— */
/* 2026-10-10=周六(6) 10-11=周日(7) 10-12=周一(1)，拿这几天当基准 */
eq('isoWeekday 周日=7', P.isoWeekday('2026-10-11'), 7);
eq('isoWeekday 周六=6', P.isoWeekday('2026-10-10'), 6);
eq('isoWeekday 周一=1', P.isoWeekday('2026-10-12'), 1);
eq('daysInMonth 平年二月', P.daysInMonth(2026, 2), 28);
eq('daysInMonth 闰年二月', P.daysInMonth(2024, 2), 29);

/* 规范化：不合法一律 null（调用方据此当"不重复"），绝不猜 */
eq('normTodoRepeat null', P.normTodoRepeat(null), null);
eq('normTodoRepeat 非对象', P.normTodoRepeat('daily'), null);
eq('normTodoRepeat 非法 mode', P.normTodoRepeat({ mode: 'hourly' }), null);
eq('normTodoRepeat none 不是合法 mode', P.normTodoRepeat({ mode: 'none' }), null);
eq('normTodoRepeat daily（含默认的子任务次日策略）', P.normTodoRepeat({ mode: 'daily' }), { mode: 'daily', last: null, next: null, subsMode: 'reset' });
eq('normTodoRepeat weekly 一天没选 → null', P.normTodoRepeat({ mode: 'weekly', weekdays: [] }), null);
eq('normTodoRepeat weekly 去重+排序', P.normTodoRepeat({ mode: 'weekly', weekdays: [5, 1, 3, 3] }).weekdays, [1, 3, 5]);
eq('normTodoRepeat weekly 越界值丢掉', P.normTodoRepeat({ mode: 'weekly', weekdays: [0, 8, '2'] }).weekdays, [2]);
eq('normTodoRepeat monthly dom=31', P.normTodoRepeat({ mode: 'monthly', dom: 31 }).dom, 31);
/* dom=0 是「每月最后一天」这个合法档位，不是没填 */
eq('normTodoRepeat monthly dom=0 = 月末', P.normTodoRepeat({ mode: 'monthly', dom: 0 }).dom, 0);
eq('normTodoRepeat monthly dom=-1 → null', P.normTodoRepeat({ mode: 'monthly', dom: -1 }), null);
eq('normTodoRepeat monthly dom=32 → null', P.normTodoRepeat({ mode: 'monthly', dom: 32 }), null);
eq('normTodoRepeat interval=2', P.normTodoRepeat({ mode: 'interval', interval: 2 }).interval, 2);
eq('normTodoRepeat interval=0 → null', P.normTodoRepeat({ mode: 'interval', interval: 0 }), null);
eq('normTodoRepeat 保留 last/next', P.normTodoRepeat({ mode: 'daily', last: '2026-10-10', next: '2026-10-12' }), { mode: 'daily', last: '2026-10-10', next: '2026-10-12', subsMode: 'reset' });
eq('normTodoRepeat until 只收合法日期', P.normTodoRepeat({ mode: 'daily', until: '2026-13-99' }).until, undefined);
eq('normTodoRepeat until 合法则保留', P.normTodoRepeat({ mode: 'daily', until: '2026-12-31' }).until, '2026-12-31');
eq('normTodoRepeat 子任务次日只认 clear', P.normTodoRepeat({ mode: 'daily', subsMode: 'clear' }).subsMode, 'clear');
eq('normTodoRepeat 子任务次日乱填 → reset', P.normTodoRepeat({ mode: 'daily', subsMode: '删掉' }).subsMode, 'reset');

/* 命中判断：每个 mode 至少一正一反 */
eq('匹配 daily 任意一天都命中', P.todoRepeatMatches({ mode: 'daily' }, '2026-10-11'), true);
eq('匹配 weekdays 周日不命中', P.todoRepeatMatches({ mode: 'weekdays' }, '2026-10-11'), false);
eq('匹配 weekdays 周一命中', P.todoRepeatMatches({ mode: 'weekdays' }, '2026-10-12'), true);
eq('匹配 weekly [一三五] 周一命中', P.todoRepeatMatches({ mode: 'weekly', weekdays: [1, 3, 5] }, '2026-10-12'), true);
eq('匹配 weekly [一三五] 周二不命中', P.todoRepeatMatches({ mode: 'weekly', weekdays: [1, 3, 5] }, '2026-10-13'), false);
eq('匹配 monthly 31 号当天命中', P.todoRepeatMatches({ mode: 'monthly', dom: 31 }, '2026-10-31'), true);
eq('匹配 monthly 31 号非当天不命中', P.todoRepeatMatches({ mode: 'monthly', dom: 31 }, '2026-10-30'), false);
/* ★ 短月收口：选了 31 号，2 月落到月末，而不是整月跳过 —— 这是"每月"两个字的本意 */
eq('匹配 monthly 31 号在 2 月落到月末', P.todoRepeatMatches({ mode: 'monthly', dom: 31 }, '2026-02-28'), true);
eq('匹配 monthly 31 号在 4 月底(30)也命中', P.todoRepeatMatches({ mode: 'monthly', dom: 31 }, '2026-04-30'), true);
eq('匹配 monthly 30 号在 31 天月当天命中', P.todoRepeatMatches({ mode: 'monthly', dom: 30 }, '2026-10-30'), true);
eq('匹配 monthly 30 号超长同样收口到月末', P.todoRepeatMatches({ mode: 'monthly', dom: 30 }, '2026-02-28'), true);
/* ★ interval 锚点：从锚点起每 N 天，不是"从今天起每 N 天" */
eq('匹配 interval 2 锚点日命中', P.todoRepeatMatches({ mode: 'interval', interval: 2, anchor: '2026-10-11' }, '2026-10-11'), true);
eq('匹配 interval 2 隔天不命中', P.todoRepeatMatches({ mode: 'interval', interval: 2, anchor: '2026-10-11' }, '2026-10-12'), false);
eq('匹配 interval 2 两天后命中', P.todoRepeatMatches({ mode: 'interval', interval: 2, anchor: '2026-10-11' }, '2026-10-13'), true);
eq('匹配 interval 锚点之前不命中', P.todoRepeatMatches({ mode: 'interval', interval: 2, anchor: '2026-10-11' }, '2026-10-09'), false);
eq('匹配 非法规则不命中', P.todoRepeatMatches(null, '2026-10-11'), false);

/* 下一个命中日：exclude-self 是复位后推算的标准姿势 */
eq('next daily 次日', P.nextTodoRepeatDate({ mode: 'daily' }, '2026-10-11', false), '2026-10-12');
eq('next daily 含当天', P.nextTodoRepeatDate({ mode: 'daily' }, '2026-10-11', true), '2026-10-11');
eq('next weekdays 周日 → 次日周一', P.nextTodoRepeatDate({ mode: 'weekdays' }, '2026-10-11', false), '2026-10-12');
eq('next weekly [一] 周日 → 次日周一', P.nextTodoRepeatDate({ mode: 'weekly', weekdays: [1] }, '2026-10-11', false), '2026-10-12');
eq('next monthly 31 号', P.nextTodoRepeatDate({ mode: 'monthly', dom: 31 }, '2026-10-11', false), '2026-10-31');
eq('next interval 锚点起每2天', P.nextTodoRepeatDate({ mode: 'interval', interval: 2, anchor: '2026-10-11' }, '2026-10-11', false), '2026-10-13');
eq('next interval 无锚点则锚在 from 当天', P.nextTodoRepeatDate({ mode: 'interval', interval: 3 }, '2026-10-11', false), '2026-10-14');
eq('next 非法规则 → null', P.nextTodoRepeatDate({ mode: 'nope' }, '2026-10-11', false), null);
eq('next 垃圾日期 → null', P.nextTodoRepeatDate({ mode: 'daily' }, '??', false), null);
/* 幂等：同一规则连算两次结果一致（复位逻辑靠这个做闸门） */
eq('next 幂等', P.nextTodoRepeatDate({ mode: 'weekly', weekdays: [2] }, '2026-10-11', false), P.nextTodoRepeatDate({ mode: 'weekly', weekdays: [2] }, '2026-10-11', false));

/* 重复截止日与月末：命中判断两头都要收口 */
eq('until 之前照常命中', P.todoRepeatMatches({ mode: 'daily', until: '2026-10-20' }, '2026-10-11'), true);
eq('until 当天还算命中', P.todoRepeatMatches({ mode: 'daily', until: '2026-10-11' }, '2026-10-11'), true);
eq('until 之后不命中', P.todoRepeatMatches({ mode: 'daily', until: '2026-10-10' }, '2026-10-11'), false);
eq('next 不越过 until', P.nextTodoRepeatDate({ mode: 'daily', until: '2026-10-13' }, '2026-10-11', false), '2026-10-12');
eq('next 顶到 until 之后再无命中 → null', P.nextTodoRepeatDate({ mode: 'daily', until: '2026-10-11' }, '2026-10-11', false), null);
eq('expired: 过了截止日才算过期', P.todoRepeatExpired({ mode: 'daily', until: '2026-10-11' }, '2026-10-12'), true);
eq('expired: 截止日当天没过期', P.todoRepeatExpired({ mode: 'daily', until: '2026-10-11' }, '2026-10-11'), false);
eq('expired: 没设截止日永远不过期', P.todoRepeatExpired({ mode: 'daily' }, '2030-01-01'), false);
eq('月末 2 月命中 28', P.todoRepeatMatches({ mode: 'monthly', dom: 0 }, '2026-02-28'), true);
eq('月末 2 月 27 不命中', P.todoRepeatMatches({ mode: 'monthly', dom: 0 }, '2026-02-27'), false);
eq('月末 闰年 2 月 29', P.todoRepeatMatches({ mode: 'monthly', dom: 0 }, '2024-02-29'), true);
eq('月末 30 天的月', P.todoRepeatMatches({ mode: 'monthly', dom: 0 }, '2026-04-30'), true);
eq('月末 next', P.nextTodoRepeatDate({ mode: 'monthly', dom: 0 }, '2026-10-11', false), '2026-10-31');
eq('月末文案', P.todoRepeatLabel({ mode: 'monthly', dom: 0 }), '每月末');
eq('带截止日的文案', P.todoRepeatLabel({ mode: 'daily', until: '2026-12-31' }), '每天 至 2026-12-31');

/* 预计番茄口径：只认任务本身。子任务那一套（todoSubPomos / setTodoSubPomo / .tf-sub-pomo-*）
   已于 10-17 全部删除 —— 下面几条是**防回流哨兵**：谁把子任务番茄加回来，这里先红。 */
eq('子任务番茄：todoSubPomos 已彻底删除（口径只剩一条路）', typeof P.todoSubPomos, 'undefined');
eq('estPomos 只看本身 pomodoros，子任务不计入', P.todoEstPomos({ pomodoros: 1, subs: [{ pomodoros: 2 }, { pomodoros: 1.5 }] }), 1);
eq('estPomos 只填了子任务（本身没填）→ 0', P.todoEstPomos({ subs: [{ pomodoros: 3 }] }), 0);
eq('estPomos 谁都没填 → 0', P.todoEstPomos({}), 0);
eq('estPomos 自己非法 → 0（子任务不算）', P.todoEstPomos({ pomodoros: 'x', subs: [{ pomodoros: 2 }] }), 0);
eq('estPomos 老存档里残留的子任务番茄也不计入', P.todoEstPomos({ pomodoros: 2, subs: [{ pomodoros: 99 }] }), 2);

/* ===== 子任务进度（纯函数）：只数 done，脏值不影响总数 ===== */
eq('子任务进度 2/5', P.todoSubProgress({ subs: [{ done: true }, { done: false }, { done: true }, {}, {}] }), { done: 2, total: 5, pct: 40 });
eq('子任务进度 全完成 → 100%', P.todoSubProgress({ subs: [{ done: true }, { done: true }] }), { done: 2, total: 2, pct: 100 });
eq('子任务进度 没有子任务 → 0/0', P.todoSubProgress({}), { done: 0, total: 0, pct: 0 });
eq('子任务进度 null 不炸', P.todoSubProgress(null), { done: 0, total: 0, pct: 0 });
eq('子任务进度 subs 非数组 → 0/0', P.todoSubProgress({ subs: 'x' }), { done: 0, total: 0, pct: 0 });
eq('子任务进度 空数组 → 0/0（不除以零）', P.todoSubProgress({ subs: [] }).pct, 0);
eq('子任务进度 脏项不计入总数（界面只有 1 行就写 1/1）', P.todoSubProgress({ subs: [null, { done: true }] }), { done: 1, total: 1, pct: 100 });
eq('有效子任务：非数组 → 空', P.todoValidSubs({ subs: 'x' }).length, 0);
eq('有效子任务：过滤 null/字符串，留对象', P.todoValidSubs({ subs: [null, '', { done: 1 }] }).length, 1);

/* ===== 排期清单：多段平等 / 去重 / 快照优先 =====
   起没有「主段 / 另排」：所有段同一身份，按开始时间排。 */
{
  const D = '2026-10-18';
  const base = { id: 1, title: '背诵单词', blocks: [{ start: D + ' 07:00', end: D + ' 08:00' }], pomodoros: 1 };
  const L = P.todoScheduleLines;

  const a = L(base, D, {}, null, D);
  eq('排期：一段 → 一行', a.length, 1);
  eq('排期：起点 07:00（420 分）', a[0].start, 420);
  eq('排期：结束 08:00（480 分）', a[0].end, 480);
  eq('排期：不再有 main 标记（段平等）', a[0].main, undefined);
  eq('排期：当天不读快照', L(base, D, {}, [{ id: 1, blocks: [] }], D).length, 1);

  const b = L({ id: 1, title: '两段', blocks: [
    { start: D + ' 07:00', end: D + ' 08:00' },
    { start: D + ' 15:00', end: D + ' 16:00' }
  ] }, D, {}, null, D);
  eq('排期：两段 → 两行', b.length, 2);
  eq('排期：按开始时间排序', b[0].start < b[1].start, true);
  eq('排期：第二段起点 15:00', b[1].start, 900);

  const c = L({ id: 1, blocks: [
    { start: D + ' 07:00', end: D + ' 08:00' },
    { start: D + ' 07:00', end: D + ' 09:00' }
  ] }, D, {}, null, D);
  eq('排期：同起点只留一行', c.length, 1);
  eq('排期：同起点保留先出现的那段', c[0].end, 480);

  eq('排期：跨天段被丢弃（本模型只支持同日段）',
    L({ id: 3, blocks: [{ start: D + ' 23:00', end: '2026-10-19 00:30' }] }, D, {}, null, D).length, 0);

  const snaps = [{ id: 1, date: D, blocks: [{ start: D + ' 09:00', end: D + ' 10:00' }] }];
  const hist = { id: 1, blocks: [
    { start: D + ' 07:00', end: D + ' 08:00' },
    { start: D + ' 15:00', end: D + ' 16:00' }
  ] };
  const h = L(hist, D, {}, snaps, '2026-10-20');
  eq('排期：历史日优先读快照', h.length, 1);
  eq('排期：历史日不叠加当前段', h[0].start, 540);
  eq('排期：快照行标 snap', h[0].snap, true);

  const oldSnap = [{ id: 1, date: D, remindAt: D + ' 07:00', estEnd: D + ' 08:00' }];
  const ho = L(hist, D, {}, oldSnap, '2026-10-20');
  eq('排期：旧快照没有 blocks 时用 remindAt 补一段', ho.length, 1);
  eq('排期：补出来的是 07:00', ho[0].start, 420);

  eq('排期：viewDate 缺省不炸', L(base).length, 1);
  eq('排期：null 任务 → 空', L(null, D, {}, null, D).length, 0);

  /* 2026-10-19：跨天多段。一次性/重复两条来源都要把每段挂回它自己那天 ——
     否则展开面板里「明天 08:00」会被写成今天。 */
  const twoDays = { id: 7, blocks: [
    { start: D + ' 20:00', end: D + ' 22:00' },
    { start: '2026-10-19 08:00', end: '2026-10-19 09:00' }
  ] };
  const tdL = L(twoDays, D, {}, null, D);
  eq('排期：一次性跨天 → 两行', tdL.length, 2);
  eq('排期：跨天首段归当天', tdL[0].date, D);
  eq('排期：跨天次段归第二天', tdL[1].date, '2026-10-19');
  eq('排期：跨天次段起点 08:00', tdL[1].start, 480);
  const repL = { id: 8, repeat: { mode: 'daily', last: D, next: D }, blocks: twoDays.blocks };
  const rpL = L(repL, D, {}, null, D);
  eq('排期：重复任务也列全部段（整套平移）', rpL.length, 2);
  eq('排期：重复任务跨天段同样归第二天', rpL[1].date, '2026-10-19');

  /* 段模型的基础边界（不给这些分支留白，覆盖率才不会把它算成"没测过的新代码"） */
  eq('todoBlocksOf 空对象 → 空', P.todoBlocksOf({}, {}).length, 0);
  eq('todoBlocksOf null → 空', P.todoBlocksOf(null, {}).length, 0);
  eq('todoBlockDates 没有段 → 空', P.todoBlockDates({ id: 1 }, {}), []);
  eq('tbBlocksOf 非重复任务：别的日期没有块',
    P.tbBlocksOf({ id: 1, blocks: [{ start: D + ' 07:00', end: D + ' 08:00' }] }, {}, '2026-10-19').length, 0);
  eq('tbBlocksOf 没有段 → 空',
    P.tbBlocksOf({ id: 1, blocks: [] }, {}, D).length, 0);
  eq('todoEstInfo 段时长为 0 → mins 0',
    P.todoEstInfo({ blocks: [{ start: D + ' 07:00', end: D + ' 07:00' }] }, {}).mins, 0);

  /* 脏快照与边界：这些分支不补，覆盖率会把它们算成"没测过的新代码" */
  const dirty = [{ id: 1, blocks: [{ start: 'bad', end: 'bad' }, null, { start: D + ' 09:00', end: '' }] }];
  eq('排期：快照里的脏块被跳过（没有可画的就返回空）', L(hist, D, {}, dirty, '2026-10-20').length, 0);
  const noEnd = [{ id: 1, remindAt: D + ' 07:00' }];
  eq('排期：旧快照没有结束时间时按起点补一段', L(hist, D, {}, noEnd, '2026-10-20')[0].end, 420);
}

/* ===== 快照读取器 ===== */
{
  const arr = [{ id: 1 }, { id: '2' }];
  eq('快照读取：按 id 命中', P.todoSchedSnapshotOn(arr, 1).id, 1);
  eq('快照读取：id 是字符串也能命中', P.todoSchedSnapshotOn(arr, '2').id, '2');
  eq('快照读取：未命中 → null', P.todoSchedSnapshotOn(arr, 9), null);
  eq('快照读取：非数组 → null', P.todoSchedSnapshotOn('x', 1), null);
  eq('快照读取：id 为空 → null', P.todoSchedSnapshotOn(arr, null), null);
}


/* 文案：列表徽标与编辑面板同一句 */
eq('label daily', P.todoRepeatLabel({ mode: 'daily' }), '每天');
eq('label weekdays', P.todoRepeatLabel({ mode: 'weekdays' }), '工作日');
eq('label weekly 多选按序', P.todoRepeatLabel({ mode: 'weekly', weekdays: [3, 1, 5] }), '每周一、三、五');
eq('label monthly', P.todoRepeatLabel({ mode: 'monthly', dom: 31 }), '每月31日');
eq('label interval', P.todoRepeatLabel({ mode: 'interval', interval: 2 }), '每2天');
eq('label 非法 → 空串(不是 undefined)', P.todoRepeatLabel(null), '');

/* —— 专注记录 CSV 表格（唯一定义处：recordsCsvTable）——
   此前 03 手动导出 / 05 归档导出 / 05 清理备份 各维护一份表头（17/14/14 列，取值算法还不同）。
   这里把这套口径钉住，防止再分叉。 */
const CSV_HEAD17 = ['日期', '开始时间', '结束时间', '有效时长(分)', '折算番茄', '类型', '难度', '任务', '备注',
  '打断次数', '累计打断(秒)', '开始精力', '开始心情', '结束精力', '结束心情', '预计番茄', '实际番茄'];
eq('CSV 表头 23 列', P.recordsCsvTable([]).head.length, 23);
eq('CSV 前 17 列顺序锁定（老 Excel 模板向后兼容）', P.recordsCsvTable([]).head.slice(0, 17), CSV_HEAD17);
eq('CSV 追加的 6 列为计划关联快照', P.recordsCsvTable([]).head.slice(17),
  ['计划', '子任务', '标签', '四象限', '子计划进度', '计划ID']);
eq('CSV 空输入只有表头', P.recordsCsvTable([]).lines.length, 1);
eq('CSV null 输入不炸', P.recordsCsvTable(null).lines.length, 1);

const _csvRec = { startTime: new Date(2026, 9, 13, 9, 0).getTime(), endTime: new Date(2026, 9, 13, 9, 25).getTime(),
  effectiveSeconds: 1500, type: 'full', taskName: '数学卷子', planTitle: '数学卷子', subTitle: '第3题',
  tag: '学习', quad: 'q1', planSubs: [{ t: '看例题', d: true }, { t: '做第3题', d: false }], todoId: 12345, pomos: 1 };
const _csvRows = P.recordsCsvTable([_csvRec]).lines;
eq('CSV 行数 = 表头 + 记录数', _csvRows.length, 2);
ok('CSV 新记录带计划名', _csvRows[1].indexOf('数学卷子') >= 0);
ok('CSV 四象限转中文（不是 q1）', _csvRows[1].indexOf('重要又紧急') >= 0);
ok('CSV 子计划快照转 ✓/○', _csvRows[1].indexOf('✓看例题 ○做第3题') >= 0);
ok('CSV 计划ID 落列', _csvRows[1].indexOf('12345') >= 0);

const _csvOld = P.recordsCsvTable([{ startTime: 0, type: 'half', effectiveSeconds: 900, taskName: '旧' }]).lines[1];
eq('CSV 老记录末尾 6 列留空（不报错不串位）', _csvOld.split(',').slice(-6), ['', '', '', '', '', '']);
eq('CSV 老记录折算番茄按类型兜底', _csvOld.split(',')[4], '0.5');

eq('csvCell 逗号整体加引号', P.csvCell('a,b'), '"a,b"');
eq('csvCell 引号翻倍', P.csvCell('say "hi"'), '"say ""hi"""');
eq('csvCell 换行折叠成空格', P.csvCell('a\nb'), 'a b');
eq('csvCell 空值', P.csvCell(null), '');
/* 公式注入防护（P2-25）：Excel/WPS 会把 = + - @ 开头的单元格当公式求值 */
eq('csvCell = 开头加单引号', P.csvCell('=1+1'), "'=1+1");
eq('csvCell + 开头加单引号', P.csvCell('+cmd'), "'+cmd");
eq('csvCell - 开头加单引号', P.csvCell('-2'), "'-2");
eq('csvCell @ 开头加单引号', P.csvCell('@SUM'), "'@SUM");
eq('csvCell 普通文本不动', P.csvCell('普通文本'), '普通文本');
eq('planSubsText 正常', P.planSubsText([{ t: 'A', d: true }, { t: 'B', d: false }]), '✓A ○B');
eq('planSubsText 非数组 → 空串', P.planSubsText('坏值'), '');
ok('CSV 脏 quad 保留原值（便于排查，不静默吞）',
  P.recordsCsvTable([{ startTime: 0, quad: 'q9' }]).lines[1].indexOf('q9') >= 0);

/* —— 森林：树的等级与"每天的树" ——
   视图层靠等级决定画多高的树（不再反查 emoji），所以**时长分档的边界**必须钉住：
   档位改了而这里没红，说明重绘会画出错档的树形。 */
eq('levelOf 5 分钟 → 幼苗档(0)', P.forestTreeLevelOf(5), 0);
eq('levelOf 9.9 分钟 → 幼苗档(0)', P.forestTreeLevelOf(9.9), 0);
eq('levelOf 15 分钟 → 灌木档(1)', P.forestTreeLevelOf(15), 1);
eq('levelOf 25 分钟 → 成树档(2)', P.forestTreeLevelOf(25), 2);
eq('levelOf 59 分钟 → 仍是成树档(2)', P.forestTreeLevelOf(59), 2);
eq('levelOf 90 分钟 → 大树档(3)', P.forestTreeLevelOf(90), 3);
eq('levelOf 空值不返回 undefined', P.forestTreeLevelOf(null), 0);
eq('levelOf 脏串 → 幼苗档', P.forestTreeLevelOf('abc'), 0);
/* 多树：60 分钟才翻倍，之后每 30 分钟一棵，封顶 4（Forest 的 60-89→2 / 90-119→3） */
eq('多树 59 分钟只给 1 棵', P.forestTreesPerRecord(59), 1);
eq('多树 60 分钟给 2 棵', P.forestTreesPerRecord(60), 2);
eq('多树 89 分钟仍是 2 棵', P.forestTreesPerRecord(89), 2);
eq('多树 90 分钟给 3 棵', P.forestTreesPerRecord(90), 3);
eq('多树 150 分钟封顶 4 棵', P.forestTreesPerRecord(150), P.FOREST_TREES_MAX);
eq('多树 脏值回落到 1 棵', P.forestTreesPerRecord(null), 1);

const _fday = new Date(); _fday.setHours(9, 0, 0, 0);
const _mkRec = (i, mins, type, pomos) => ({
  startTime: _fday.getTime() + i * 36e5,
  endTime: _fday.getTime() + i * 36e5 + mins * 60000,
  effectiveSeconds: mins * 60, type: type, pomos: pomos
});
const _frecs = [
  _mkRec(0, 8, 'half', 0.5),
  _mkRec(1, 25, 'full', 1),
  _mkRec(2, 50, 'full', 2)
];
const _f = P.forestFromRecords(_frecs)[0];
eq('森林每天输出「与图标一一对应」的等级', _f.levels, [0, 2, 2]);
eq('森林 levels 与 icons 等长', _f.levels.length, _f.icons.length);
eq('森林每天照样给树数（不足 60 分钟各 1 棵）', _f.trees, 3);
/* 一次 90 分钟长专注 → 3 棵树，但 3 棵都按这一场的时长算档（大树），
   不是「3 棵小树」：它们来自同一段连续投入。 */
const _f2 = P.forestFromRecords([_mkRec(0, 90, 'full', 3)])[0];
eq('长场次一次收 3 棵', _f2.trees, 3);
eq('长场次的树全是最高档', _f2.levels, [3, 3, 3]);
/* 没有时长字段的老记录按「1 个番茄 ≈ 25 分钟」折算，不能长成 0 分钟幼苗 */
const _f3 = P.forestFromRecords([{ startTime: _fday.getTime(), endTime: _fday.getTime(), pomos: 1, type: 'full' }])[0];
eq('无时长老记录按 25 分钟折算 → 成树档', _f3.levels, [2]);
eq('森林空输入 → 空数组（不炸）', P.forestFromRecords(null), []);

/* —— 金币抽奖额度：必须由 records 派生 ——
   旧实现把次数存在 lotteryCount 计数器上，「补记一条 → 删掉」不回滚 → 可无限刷。
   派生后删记录即回落，下面带 ★ 的两条就是钉死这件事的。 */
const _lr = (pomos, type) => ({ pomos: pomos, type: type || 'full' });
eq('抽奖额度 空记录 → 0', P.lotteryQuotaOf([], 2), 0);
eq('抽奖额度 每 2 个番茄 1 次', P.lotteryQuotaOf([_lr(1), _lr(1)], 2), 1);
eq('抽奖额度 半个番茄按 round 计（0.5→1）', P.lotteryQuotaOf([_lr(0.5), _lr(0.5)], 2), 1);
eq('抽奖额度 仅记录(log, pomos=0) 不参与', P.lotteryQuotaOf([_lr(1), _lr(0, 'log')], 2), 0);
eq('抽奖额度 50 分钟大番茄记 2', P.lotteryQuotaOf([_lr(2)], 1), 2);
eq('抽奖可用 = 额度 − 已抽', P.lotteryAvailFrom([_lr(1), _lr(1), _lr(1), _lr(1)], 1, 2), 1);
eq('★ 删掉记录后可用回落（防「补记→删除」无限刷）', P.lotteryAvailFrom([], 1, 2), 0);
eq('★ 已抽数不因删记录而退（可用不为负）', P.lotteryAvailFrom([_lr(1), _lr(1)], 5, 2), 0);
eq('抽奖可用 脏输入不炸', P.lotteryAvailFrom(null, null, 0), 0);

/* —— 树龄（陪伴天数）：森林的长线主轴，靠日历而不是积分 —— */
eq('树龄天数', P.treeAgeDays('2026-10-13', '2027-10-13'), 365);
eq('树龄天数 同日为 0', P.treeAgeDays('2026-10-13', '2026-10-13'), 0);
eq('树龄天数 脏输入归 0', P.treeAgeDays(null, '2026-10-13'), 0);
eq('树龄年 未满整年不算（2/29 → 次年 2/28）', P.treeAgeYears('2024-02-29', '2025-02-28'), 0);
eq('树龄年 过完周年才算', P.treeAgeYears('2024-02-29', '2025-03-01'), 1);
eq('树龄年 先比月再比日', P.treeAgeYears('2016-05-20', '2026-05-19'), 9);
eq('树龄年 同月同日正好满年', P.treeAgeYears('2016-05-20', '2026-05-20'), 10);
eq('树龄档 100 天', P.treeAgeTierOf(100).cur.name, '百日之木');
eq('树龄档 下一档可追', P.treeAgeTierOf(200).next.days, 365);
eq('树龄档 未达成时没有当前档', P.treeAgeTierOf(10).cur, null);
ok('树龄档最远铺到 30 年', P.TREE_AGE_TIERS[P.TREE_AGE_TIERS.length - 1].days >= 10950);
ok('树龄档按天数严格递增', (function () {
  for (let i = 1; i < P.TREE_AGE_TIERS.length; i++)
    if (P.TREE_AGE_TIERS[i].days <= P.TREE_AGE_TIERS[i - 1].days) return false;
  return true;
})());

/* —— 年度回顾：日期加年 + 区间结账 —— */
eq('加年 普通', P.addYearsToDate('2020-03-01', 1), '2021-03-01');
eq('加年 2/29 落平年 2/28', P.addYearsToDate('2024-02-29', 1), '2025-02-28');
eq('加年 4 年后仍是 2/29', P.addYearsToDate('2024-02-29', 4), '2028-02-29');
eq('加年 脏输入返回 null', P.addYearsToDate('xx', 1), null);
const _yearRecs = [
  { startTime: new Date(2025, 0, 5, 10, 0).getTime(), effectiveSeconds: 1500, type: 'full', pomos: 1 },
  { startTime: new Date(2025, 0, 5, 14, 0).getTime(), effectiveSeconds: 3000, type: 'full', pomos: 2 },
  { startTime: new Date(2025, 0, 6, 10, 0).getTime(), effectiveSeconds: 600, type: 'log', pomos: 0 },
  { startTime: new Date(2026, 0, 5, 10, 0).getTime(), effectiveSeconds: 1500, type: 'full', pomos: 1 }
];
eq('区间结账 番茄只算区间内', P.rangeStatsFrom(_yearRecs, '2025-01-01', '2026-01-01').pomos, 3);
eq('区间结账 活跃天数按不同日期去重', P.rangeStatsFrom(_yearRecs, '2025-01-01', '2026-01-01').days, 1);
eq('区间结账 分钟数', P.rangeStatsFrom(_yearRecs, '2025-01-01', '2026-01-01').minutes, 75);
eq('区间结账 仅记录不计入', P.rangeStatsFrom(_yearRecs, '2025-01-06', '2025-01-07').pomos, 0);
eq('区间结账 空/倒序不炸', P.rangeStatsFrom(null, '2026-01-01', '2025-01-01').pomos, 0);

/* —— 回顾毕业原因：把「主动斩掉」与「练到顶」分开 —— */
eq('毕业原因 老数据无 reason → 按练到顶兜底', P.ebGraduateReason({ level: 7, next: null }), 'solid-top');
eq('毕业原因 主动斩掉', P.ebGraduateReason({ level: 7, next: null, reason: 'mastered' }), 'mastered');
eq('毕业原因 未毕业返回 null', P.ebGraduateReason({ level: 2, next: '2026-01-01' }), null);
eq('毕业原因 空值不炸', P.ebGraduateReason(null), null);

/* —— 金币账本（余额 + 流水）· 纯函数层 ——
   设计出处 HabitTrove：货币 = { balance, transactions[] }。
   记账入口在 01d3（coinEarn/coinSpend，要 appData），本层只管算。 */
eq('coinTxMake 四舍五入', P.coinTxMake({ amount: 12.6, type: 'gift', reason: 'x', after: 100 }).amount, 13);
eq('coinTxMake 负数保留', P.coinTxMake({ amount: -8 }).amount, -8);
ok('coinTxMake 缺参不炸', P.coinTxMake().amount === 0 && P.coinTxMake().type === 'misc' && P.coinTxMake().undoOf === '');
ok('coinTxMake 带 meta 原样保留', P.coinTxMake({ amount: 1, meta: { recordId: 7 } }).meta.recordId === 7);
ok('coinTxMake 非对象 meta → null', P.coinTxMake({ amount: 1, meta: 'x' }).meta === null);
ok('coinTxNewId 同毫秒不重号', P.coinTxNewId(1000) !== P.coinTxNewId(1000));
eq('coinLedgerSum 空值 → 0', P.coinLedgerSum(null), 0);
eq('coinLedgerSum 空数组 → 0', P.coinLedgerSum([]), 0);
eq('coinLedgerSum 混合收支', P.coinLedgerSum([{ amount: 10 }, { amount: -3 }, { amount: 5 }]), 12);
eq('coinLedgerSum 脏条目当 0', P.coinLedgerSum([{ amount: 10 }, null, { amount: 'x' }]), 10);
eq('coinLedgerDiff 平账 → 0', P.coinLedgerDiff([{ amount: 10 }, { amount: -3 }], 7), 0);
eq('coinLedgerDiff 余额少 3', P.coinLedgerDiff([{ amount: 10 }], 7), -3);
eq('coinLedgerDiff 余额多 5', P.coinLedgerDiff([{ amount: 10 }], 15), 5);
const _coinLog = [{ id: 'a', amount: 10, type: 'gift' }, { id: 'b', amount: -5, type: 'shop' }];
ok('coinTxUndoable 普通收入可撤', P.coinTxUndoable(_coinLog, 'a') === true);
ok('coinTxUndoable 普通支出可撤', P.coinTxUndoable(_coinLog, 'b') === true);
ok('coinTxUndoable 撤销流水自身不可撤', P.coinTxUndoable([{ id: 'u', amount: -10, undoOf: 'a' }], 'u') === false);
ok('coinTxUndoable 已撤过不可再撤',
  P.coinTxUndoable([{ id: 'a', amount: 10 }, { id: 'u', amount: -10, undoOf: 'a' }], 'a') === false);
ok('coinTxUndoable 期初结转不可撤', P.coinTxUndoable([{ id: 'o', amount: 100, type: 'opening' }], 'o') === false);
ok('coinTxUndoable 金额 0 不可撤', P.coinTxUndoable([{ id: 'z', amount: 0 }], 'z') === false);
ok('coinTxUndoable 不存在 → false', P.coinTxUndoable(_coinLog, 'zzz') === false);
ok('coinTxUndoable 空账本不炸', P.coinTxUndoable(null, 'a') === false && P.coinTxUndoable([], null) === false);
eq('coinLedgerTrim 保最近 N 条', P.coinLedgerTrim([1, 2, 3, 4, 5], 2), [4, 5]);
eq('coinLedgerTrim 未超长原样', P.coinLedgerTrim([1, 2], 5), [1, 2]);
eq('coinLedgerTrim max<=0 不裁', P.coinLedgerTrim([1, 2, 3], 0), [1, 2, 3]);
eq('coinLedgerTrim 非数组 → 空', P.coinLedgerTrim(null, 3), []);
eq('coinTxTypeLabel 已登记类型', P.coinTxTypeLabel('gift'), '系统奖励');
eq('coinTxTypeLabel 撤销类型', P.coinTxTypeLabel('undo'), '撤销回滚');
eq('coinTxTypeLabel 未登记原样回退', P.coinTxTypeLabel('wat'), 'wat');
eq('coinTxTypeLabel 空值兜底', P.coinTxTypeLabel(null), '其他');

/* —— 金币收益乘数链：默认参数必须与旧实现（24/48/86 → 1/3/6）100% 等价 ——
   设计出处 Level-Up-Life：final = round(base × streakMult × buffMult)，每项独立可调。 */
eq('档位 86min → 6', P.coinEarnFinal({ minutes: 86 }), 6);
eq('档位 120min → 6（封顶不叠加）', P.coinEarnFinal({ minutes: 120 }), 6);
eq('档位 85.9min → 3', P.coinEarnFinal({ minutes: 85.9 }), 3);
eq('档位 48min → 3', P.coinEarnFinal({ minutes: 48 }), 3);
eq('档位 47min → 1', P.coinEarnFinal({ minutes: 47 }), 1);
eq('档位 24min → 1', P.coinEarnFinal({ minutes: 24 }), 1);
eq('档位 23.9min → 0', P.coinEarnFinal({ minutes: 23.9 }), 0);
eq('档位 0 → 0', P.coinEarnFinal({ minutes: 0 }), 0);
eq('档位空值不炸', P.coinEarnFinal({ minutes: null }), 0);
eq('秒折算一致（1500 秒 = 25 分 → 1）', P.coinEarnFinal({ minutes: 1500 / 60 }), 1);
eq('连续加成默认关闭 → 乘数恒 1', P.coinStreakMult(30), 1);
eq('连续加成开启：第 3 天 → 1.05', P.coinStreakMult(3, 0.05, 0.5, 3), 1.05);
eq('连续加成封顶 +50%', P.coinStreakMult(100, 0.05, 0.5, 3), 1.5);
eq('连续天数不足起步 → 1', P.coinStreakMult(2, 0.05, 0.5, 3), 1);
eq('链式相乘后取整（6×1.05×2=12.6→13）',
  P.coinEarnFinal({ minutes: 86, streakDays: 3, streakStep: 0.05, buffMult: 2 }), 13);
eq('buffMult=0 视为 1（不吞收益）', P.coinEarnFinal({ minutes: 48, buffMult: 0 }), 3);
eq('自定义档位表生效', P.coinDurBase(30, [{ min: 10, coins: 9 }]), 9);
eq('空档位表回退默认表', P.coinDurBase(86, []), 6);
eq('默认档位表与旧表 24/48/86 → 1/3/6 等价',
  P.COIN_EARN_TUNING.DUR_TIERS.map(t => t.coins).reverse().join(','), '1,3,6');

/* ==================================================================
 * 覆盖率补测：下面这批函数此前**从未被任何测试执行过**
 * （`tools/coverage.py` 的 V8 覆盖率抓出来的，纯函数层 47 个裸奔）。
 * 它们全是**业务规则的载体**（习惯连续天数怎么算、复习间隔怎么定、
 * 计划怎么归日…）—— 特点是改错了不报错、只静默改变行为，正该有回归网。
 * 断言只描述**现有行为**，不改任何产品代码。
 * ================================================================== */

/* —— 习惯系统 · 周频次归一化 —— */
eq('habitFreqPerWeek 合法值', P.habitFreqPerWeek({ freqPerWeek: 3 }), 3);
eq('habitFreqPerWeek 小数取整', P.habitFreqPerWeek({ freqPerWeek: 2.6 }), 3);
eq('habitFreqPerWeek 超范围回默认 7', P.habitFreqPerWeek({ freqPerWeek: 9 }), 7);
eq('habitFreqPerWeek 空对象回默认', P.habitFreqPerWeek({}), 7);
eq('habitFreqPerWeek null 回默认', P.habitFreqPerWeek(null), 7);
eq('habitFreqPerWeek 字符串不回默认（类型不对）', P.habitFreqPerWeek({ freqPerWeek: '3' }), 7);

/* —— 习惯系统 · 最近 N 天（含今天、倒序）—— */
eq('recentDateStrs 3 天含今天倒序', P.recentDateStrs('2026-10-14', 3),
  ['2026-10-14', '2026-10-13', '2026-10-12']);
eq('recentDateStrs 跨月', P.recentDateStrs('2026-11-01', 2), ['2026-11-01', '2026-10-31']);

/* —— 习惯系统 · 窗口内应打卡次数 —— */
eq('habitExpectedIn 每天习惯 = 天数', P.habitExpectedIn({ freqPerWeek: 7 }, '2026-10-14', 7), 7);
eq('habitExpectedIn 周 3 次 × 7 天 = 3', P.habitExpectedIn({ freqPerWeek: 3 }, '2026-10-14', 7), 3);
eq('habitExpectedIn 周 1 次也有下限 1', P.habitExpectedIn({ freqPerWeek: 1 }, '2026-10-14', 3), 1);
eq('habitExpectedIn createdAt=今天 → 只算今天', P.habitExpectedIn({ freqPerWeek: 7, createdAt: '2026-10-14' }, '2026-10-14', 7), 1);
eq('habitExpectedIn createdAt 在窗口内 → 按天差+1', P.habitExpectedIn({ freqPerWeek: 7, createdAt: '2026-10-12' }, '2026-10-14', 7), 3);
eq('habitExpectedIn createdAt 在未来 → 0（不虚增分母）', P.habitExpectedIn({ freqPerWeek: 7, createdAt: '2026-10-20' }, '2026-10-14', 7), 0);
eq('habitExpectedIn createdAt 早于窗口 → 整窗算', P.habitExpectedIn({ freqPerWeek: 7, createdAt: '2020-01-01' }, '2026-10-14', 7), 7);

/* —— 习惯系统 · 当前连续天数（今天没打不算断链）—— */
eq('habitCurrentStreak 连打 3 天', P.habitCurrentStreak(['2026-10-14', '2026-10-13', '2026-10-12'], '2026-10-14'), 3);
eq('habitCurrentStreak 今天没打但昨天打了 → 不断链', P.habitCurrentStreak(['2026-10-13', '2026-10-12'], '2026-10-14'), 2);
eq('habitCurrentStreak 昨天也没打 → 断', P.habitCurrentStreak(['2026-10-12'], '2026-10-14'), 0);
eq('habitCurrentStreak 空日志 → 0', P.habitCurrentStreak([], '2026-10-14'), 0);
eq('habitCurrentStreak 带时间戳的日期串也能认', P.habitCurrentStreak(['2026-10-14T09:00:00'], '2026-10-14'), 1);

/* —— 习惯系统 · 历史最长连续 —— */
eq('habitBestStreak 取最长那段', P.habitBestStreak(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07']), 3);
eq('habitBestStreak 脏值被过滤', P.habitBestStreak(['2026-10-01', 'bad', '2026-10-02']), 2);
eq('habitBestStreak 空 → 0', P.habitBestStreak([]), 0);
eq('habitBestStreak 乱序也正确', P.habitBestStreak(['2026-10-07', '2026-10-06', '2026-10-05']), 3);

/* —— 习惯系统 · 窗口统计 —— */
var _hs = P.habitStats({ freqPerWeek: 7 }, ['2026-10-14', '2026-10-13'], '2026-10-14', 7);
eq('habitStats done 实打', _hs.done, 2);
eq('habitStats expected 应打', _hs.expected, 7);
eq('habitStats rate 达标率', _hs.rate, 2 / 7);
eq('habitStats cur', _hs.cur, 2);
eq('habitStats best', _hs.best, 2);
eq('habitStats 无分母时 rate=0（不除零）',
  P.habitStats({ freqPerWeek: 7, createdAt: '2026-11-01' }, [], '2026-10-14', 7).rate, 0);

/* ==================================================================
 * 习惯「节奏」升级（2026-10-30）：repeat 规则 + 按命中日算连续
 * 需求原话：「有的习惯吧，就它就不是天天打卡的…那个格只支持连续天数」。
 * 口径：有 repeat → 按规则算应做日，freqPerWeek 不再参与；没有 repeat → 老口径逐项不变。
 * 日期锚点：2026-10-14 = 周三（周一 10-12 / 周五 10-16 / 周六 10-17）。
 * ================================================================== */
var _wk135 = { mode: 'weekly', weekdays: [1, 3, 5] };
var _hWk = { name: '跑步', createdAt: '2026-01-01', repeat: _wk135 };

/* —— 归一化与「该不该做」—— */
eq('habitRepeatOf 无规则 → null（= 每天）', P.habitRepeatOf({}), null);
eq('habitRepeatOf 非法规则 → null（脏数据当每天，不静默断链）', P.habitRepeatOf({ repeat: { mode: 'weekly' } }), null);
eq('habitRepeatOf 归一化 weekly 周几升序', P.habitRepeatOf({ repeat: { mode: 'weekly', weekdays: [5, 1, 3] } }).weekdays, [1, 3, 5]);
ok('habitDueOn 无规则恒 true（老习惯行为不变）', P.habitDueOn({}, '2026-10-14') === true);
ok('habitDueOn 每周一三五：周三命中', P.habitDueOn(_hWk, '2026-10-14') === true);
ok('habitDueOn 每周一三五：周二不命中', P.habitDueOn(_hWk, '2026-10-13') === false);
ok('habitDueOn 工作日：周五命中', P.habitDueOn({ repeat: { mode: 'weekdays' } }, '2026-10-16') === true);
ok('habitDueOn 工作日：周六不命中', P.habitDueOn({ repeat: { mode: 'weekdays' } }, '2026-10-17') === false);
ok('habitDueOn 每月 31 号遇 2 月落到当月最后一天', P.habitDueOn({ repeat: { mode: 'monthly', dom: 31 } }, '2026-02-28') === true);
ok('habitDueOn 每月 31 号：2 月 27 号不命中', P.habitDueOn({ repeat: { mode: 'monthly', dom: 31 } }, '2026-02-27') === false);
ok('habitDueOn 有截止日：过了不再命中',
  P.habitDueOn({ repeat: { mode: 'daily', until: '2026-10-10' } }, '2026-10-14') === false);
ok('habitDueOn 早于创建日不算该做（不背历史欠账）',
  P.habitDueOn({ createdAt: '2026-10-12', repeat: { mode: 'daily' } }, '2026-10-01') === false);
ok('habitDueOn 每隔 3 天：锚点=创建日（10-01），10-13 命中，10-14 不命中',
  P.habitDueOn({ createdAt: '2026-10-01', repeat: { mode: 'interval', interval: 3 } }, '2026-10-13') === true &&
  P.habitDueOn({ createdAt: '2026-10-01', repeat: { mode: 'interval', interval: 3 } }, '2026-10-14') === false);

/* —— 应打卡次数：有规则时只数命中日（freqPerWeek 不再叠加）—— */
eq('habitExpectedIn 每周一三五 × 7 天 = 3', P.habitExpectedIn(_hWk, '2026-10-14', 7), 3);
eq('habitExpectedIn 有 repeat 时 freqPerWeek 不参与（7 次/周也不改口径）',
  P.habitExpectedIn({ freqPerWeek: 7, createdAt: '2026-01-01', repeat: _wk135 }, '2026-10-14', 7), 3);
eq('habitExpectedIn 每天规则 = 天数', P.habitExpectedIn({ repeat: { mode: 'daily' } }, '2026-10-14', 7), 7);
eq('habitExpectedIn 规则型 + 刚建 3 天 → 只数这 3 天里命中的',
  P.habitExpectedIn({ createdAt: '2026-10-12', repeat: { mode: 'daily' } }, '2026-10-14', 7), 3);

/* —— 连续数：按命中日连（不做的日子不判断）—— */
eq('habitCurrentStreak 每周一三五：周一+周三都打了 = 连续 2 次（周二不算断）',
  P.habitCurrentStreak(['2026-10-12', '2026-10-14'], '2026-10-14', _hWk), 2);
eq('habitCurrentStreak 每周一三五：今天不命中，昨天（周一）打了 = 仍连续',
  P.habitCurrentStreak(['2026-10-12', '2026-10-09'], '2026-10-13', _hWk), 2);
eq('habitCurrentStreak 每周一三五：跳过一个应做日就断',
  P.habitCurrentStreak(['2026-10-09', '2026-10-14'], '2026-10-14', _hWk), 1);
eq('habitCurrentStreak 每周一三五：今天该做但还没打 → 不断链',
  P.habitCurrentStreak(['2026-10-12', '2026-10-09'], '2026-10-14', _hWk), 2);
eq('habitCurrentStreak 无规则时口径不变（自然日）',
  P.habitCurrentStreak(['2026-10-13', '2026-10-12'], '2026-10-14', {}), 2);
eq('habitBestStreak 每周一三五：跨过非命中日的两段应做日也算连续',
  P.habitBestStreak(['2026-10-09', '2026-10-12', '2026-10-14'], _hWk), 3);
eq('habitBestStreak 每周一三五：漏掉周一就断在 2',
  P.habitBestStreak(['2026-10-09', '2026-10-12', '2026-10-16'], _hWk), 2);

/* —— 达标率：分子只数应做日 —— */
var _hsWk = P.habitStats(_hWk, ['2026-10-12', '2026-10-13'], '2026-10-14', 7);
eq('habitStats 规则型：非应做日的补卡不进分子', _hsWk.done, 1);
eq('habitStats 规则型：分母 = 命中日数', _hsWk.expected, 3);
eq('habitStats 规则型：达标率 1/3', _hsWk.rate, 1 / 3);
eq('habitStats 规则型：连续也用命中日口径', _hsWk.cur, 1);

/* —— 眼睛层（今天先不看）—— */
ok('habitSkippedOn 命中今天', P.habitSkippedOn({ skipOn: '2026-10-14' }, '2026-10-14') === true);
ok('habitSkippedOn 次日自动失效', P.habitSkippedOn({ skipOn: '2026-10-14' }, '2026-10-15') === false);
ok('habitSkippedOn 无字段安全', P.habitSkippedOn({}, '2026-10-14') === false);
ok('habitSkippedOn null 安全', P.habitSkippedOn(null, '2026-10-14') === false);

/* —— 跳过日（Loop 的 `-` 语义）：这天既不欠账也不破链 ——
 * 参考 习惯项目调研.md §4①。日期取 2026-10-30（周五，所在周周一 = 10-26）。 */
var _T30 = '2026-10-30';
var _hDay = { createdAt: '2026-09-01', freqPerWeek: 7 };                       /* 每天型 */
var _hRule = { createdAt: '2026-09-01', repeat: { mode: 'weekly', weekdays: [1, 3, 5] } }; /* 一三五 */
/* ★ 2026-11-04 口径变更：眼睛（h.skipOn）= 只藏卡，不再是跳过日。
 * 用户原话：「假如今天没完成，我就想不看了，把眼睛一关闭。那个跳过，为什么它会保留连续的天数呢」
 * —— 没做就是没做，连续数该断就断。所以 habitSkipSet 只认长期跳过表，
 * habitSkippedOn 仍返回 true（界面要知道这张卡被收起来了），但它不再进分母豁免。 */
ok('habitHiddenOn 命中今天（眼睛只对当天有效）',
  P.habitHiddenOn({ skipOn: '2026-10-30' }, '2026-10-30') === true
  && P.habitHiddenOn({ skipOn: '2026-10-30' }, '2026-10-31') === false
  && P.habitHiddenOn({}, '2026-10-30') === false
  && P.habitHiddenOn({ skipOn: 'bad' }, '2026-10-30') === false
  && P.habitHiddenOn({ skipOn: '2026-10-30' }, 'x') === false
  && P.habitHiddenOn(null, null) === false);
ok('habitSkipSet 只认长期跳过表，眼睛不算跳过日（不保护连续数）',
  (function () {
    var s = P.habitSkipSet({ skipOn: '2026-10-30' }, ['2026-10-28']);
    return s['2026-10-30'] === undefined && s['2026-10-28'] === true;
  })());
ok('habitSkippedOn 认眼睛（界面据此把卡收进「今天不用做」）',
  P.habitSkippedOn({ skipOn: '2026-10-30' }, '2026-10-30') === true);
ok('habitDueOn 眼睛收起的当天不进「今天该做」', P.habitDueOn(_hDay, _T30, null) === true
  && P.habitDueOn({ createdAt: '2026-09-01', freqPerWeek: 7, skipOn: _T30 }, _T30) === false);
ok('habitDueOn 眼睛只影响它记下的那一天（别的日子照常该做）',
  P.habitDueOn({ createdAt: '2026-09-01', freqPerWeek: 7, skipOn: '2026-10-29' }, _T30) === true
  && P.habitDueOn({ createdAt: '2026-09-01', freqPerWeek: 7, skipOn: 'bad' }, _T30) === true);
ok('habitSkippedOn 脏日期一律 false（不抛错、不当成收起来）',
  P.habitSkippedOn({ skipOn: _T30 }, 'x', null) === false
  && P.habitSkippedOn(null, _T30, null) === false
  && P.habitSkippedOn({ skipOn: _T30 }, _T30, ['2026-10-28']) === true);
eq('眼睛收起来的昨天照样断开连续数（没做就是没做）',
  P.habitCurrentStreak(['2026-10-28', '2026-10-30'],
    '2026-10-30', { createdAt: '2026-09-01', repeat: { mode: 'daily' }, skipOn: '2026-10-29' }), 1);
eq('点了今天的眼睛 = 今天还没打，连续数照旧不扣（今天还有机会，明天才算断）',
  P.habitCurrentStreak(['2026-10-28', '2026-10-29'],
    '2026-10-30', { createdAt: '2026-09-01', repeat: { mode: 'daily' }, skipOn: '2026-10-30' }), 2);
eq('眼睛收起的昨天、今天还没打 → 和从来没用过眼睛一模一样的断链',
  P.habitCurrentStreak(['2026-10-28', '2026-10-29'],
    '2026-10-30', { createdAt: '2026-09-01', repeat: { mode: 'daily' }, skipOn: '2026-10-30' }),
  P.habitCurrentStreak(['2026-10-28', '2026-10-29'],
    '2026-10-30', { createdAt: '2026-09-01', repeat: { mode: 'daily' } }));
eq('没点眼睛时今天还有机会（同一份数据连续数照旧是 2）',
  P.habitCurrentStreak(['2026-10-28', '2026-10-29'],
    '2026-10-30', { createdAt: '2026-09-01', repeat: { mode: 'daily' } }), 2);
eq('眼睛收起来的那天照样进分母（达标率按没做扣）',
  P.habitExpectedIn({ createdAt: '2026-09-01', repeat: { mode: 'daily' }, skipOn: '2026-10-29' },
    '2026-10-30', 3), 3);
ok('habitSkipSet 脏输入（非数组 / 非法日期）不炸也不生效',
  (function () { var s = P.habitSkipSet(null, 'nope'); return Object.keys(s).length === 0; })());
ok('habitSkippedOn 也认长期跳过记录（第三参）',
  P.habitSkippedOn({}, '2026-10-30', ['2026-10-30']) === true);
eq('每天型：跳过今天，连续数不断（打到周四 = 4）',
  P.habitCurrentStreak(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'], _T30, _hDay, ['2026-10-30']), 4);
eq('每天型：昨天跳过、前天打了 → 连续数照样认（1）',
  P.habitCurrentStreak(['2026-10-28'], _T30, _hDay, ['2026-10-29']), 1);
eq('每天型：跳过日从分母里扣掉（30 → 29）',
  P.habitExpectedIn(_hDay, _T30, 30, ['2026-10-30']), 29);
eq('每天型：跳过日不打也不计入分子',
  P.habitStats(_hDay, ['2026-10-29'], _T30, 30, ['2026-10-30']).done, 1);
ok('规则型：该做的那天跳过 → 那天不算该做',
  P.habitDueOn(_hRule, _T30, { '2026-10-30': true }) === false);
eq('规则型：周三跳过，周一与周五都打了 → 连续 2 次（跳过那天跨过去）',
  P.habitCurrentStreak(['2026-10-26', '2026-10-30'], _T30, _hRule, ['2026-10-28']), 2);
eq('规则型：不跳过时同样两天只算 1 次（证明上面那 2 是跳过带来的）',
  P.habitCurrentStreak(['2026-10-26', '2026-10-30'], _T30, _hRule, []), 1);
eq('规则型：跳过日也从命中日分母里扣掉（13 → 12）',
  P.habitExpectedIn(_hRule, _T30, 30, ['2026-10-30']), 12);
eq('最长连续：中间隔一天跳过仍算连着（4）',
  P.habitBestStreak(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-30'], _hDay, ['2026-10-29']), 4);
eq('最长连续：不跳过时同样记录只有 3（对照）',
  P.habitBestStreak(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-30'], _hDay, []), 3);

/* —— 配额模型（每周 N 次）：参考 Loop / OpenHabitTracker，见 习惯项目调研.md §4② ——
 * 老口径 freqPerWeek 只进了分母、没进判定，于是详情里「节奏：每天」和「每周 3 次」同屏矛盾。
 * 现在它进判定：本周额度没用完才算「今天该做」。 */
var _hQ = { createdAt: '2026-09-01', freqPerWeek: 3 };
ok('habitIsQuota：每周 3 次 = 配额型', P.habitIsQuota(_hQ) === true);
ok('habitIsQuota：每天（7 次）不是配额型', P.habitIsQuota({ freqPerWeek: 7 }) === false);
ok('habitIsQuota：有日历规则时一律走规则，不叠加配额', P.habitIsQuota(_hRule) === false);
eq('配额文案：「每周 3 次」而不是「每天」', P.habitRepeatLabel(_hQ), '每周 3 次');
eq('配额单位：连续数按「周」计', P.habitStreakUnit(_hQ), '周');
ok('配额型：本周打满 3 次 → 今天不再出现',
  P.habitDueOn(_hQ, _T30, {}, ['2026-10-26', '2026-10-27', '2026-10-28']) === false);
ok('配额型：本周只打 2 次 → 今天还在',
  P.habitDueOn(_hQ, _T30, {}, ['2026-10-26', '2026-10-27']) === true);
ok('配额型：上周打满不算本周的额度（周一照样出现）',
  P.habitDueOn(_hQ, '2026-10-26', {}, ['2026-10-19', '2026-10-20', '2026-10-21']) === true);
ok('配额型：额度判定不跨周串号（本周一就有额度）',
  P.habitDueOn(_hQ, '2026-10-26', {}, []) === true);
eq('配额型：分母仍是 天数×N/7（30 天 = 13，与升级前同一公式，历史达标率不突变）',
  P.habitExpectedIn(_hQ, _T30, 30), 13);
eq('配额型：连续两周达标 → 连续 2 周',
  P.habitCurrentStreak(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-26', '2026-10-27', '2026-10-28'], _T30, _hQ), 2);
eq('配额型：本周还没打满时从上周往前数（本周还有机会，不算断）',
  P.habitCurrentStreak(['2026-10-19', '2026-10-20', '2026-10-21'], '2026-10-23', _hQ), 1);
eq('配额型：中间断一周 → 最长连周只算断之前的两周',
  P.habitBestStreak(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-26'], _hQ), 2);
ok('配额型：habitStats 带出本周进度（2/3）',
  (function () { var s = P.habitStats(_hQ, ['2026-10-26', '2026-10-27'], _T30, 30); return s.quota === true && s.weekDone === 2 && s.weekTarget === 3; })());
ok('非配额型：weekTarget 为 0，界面据此不画「本周进度」', P.habitStats(_hDay, [], _T30, 7).weekTarget === 0);

/* —— 新代码的分支/脏输入（覆盖门禁要求：新增分支必须被测到）—— */
ok('habitSkipSet：h.skipOn 是非法日期时忽略',
  Object.keys(P.habitSkipSet({ skipOn: 'bad' }, [])).length === 0);
ok('habitSkipSet：跳过表里混非法日期只留合法的',
  (function () { var s = P.habitSkipSet(null, ['bad', '2026-10-30']); return Object.keys(s).length === 1 && s['2026-10-30'] === true; })());
ok('habitDueOn：第三参直接给数组也认（调用方漏转一次不会静默失效）',
  P.habitDueOn(_hDay, _T30, ['2026-10-30']) === false);
eq('habitExpectedIn：整窗都被跳过 → 分母 0（不虚增欠账）',
  P.habitExpectedIn(_hDay, _T30, 7, ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']), 0);
eq('habitCurrentStreak：配额型空日志 → 0（不除零、不空转）',
  P.habitCurrentStreak([], _T30, _hQ), 0);
eq('habitBestStreak：配额型空日志 → 0', P.habitBestStreak([], _hQ), 0);
eq('habitBestStreak：规则型遇到跳过日跨过去（周一、周三都打，周二跳过也当连着）',
  P.habitBestStreak(['2026-10-26', '2026-10-28'], { repeat: { mode: 'daily' } }, ['2026-10-27']), 2);
eq('habitQuotaDueOn：本周还没开始时不会误判（周一自身就是起点）',
  P.habitQuotaDueOn(_hQ, '2026-10-26', []), true);
ok('normHabitSkips：null / 数组 / 字符串入参安全返回空表',
  Object.keys(P.normHabitSkips(null)).length === 0
  && Object.keys(P.normHabitSkips([])).length === 0
  && Object.keys(P.normHabitSkips('x')).length === 0);
ok('normHabitSkips：非数组值、非法日期、重复日期都清掉，空表整个 key 不保留',
  (function () {
    var o = P.normHabitSkips({ a: ['2026-10-30', '2026-10-30', 'bad'], b: 'nope', c: [] });
    return Object.keys(o).length === 1 && o.a.length === 1 && o.a[0] === '2026-10-30';
  })());
ok('habitIsQuota：freqPerWeek 脏值（0 / 99 / 字符串）不被当成配额型',
  P.habitIsQuota({ freqPerWeek: 0 }) === false && P.habitIsQuota({ freqPerWeek: 99 }) === false
  && P.habitIsQuota({ freqPerWeek: '3' }) === false);

/* —— 脏输入与边界（分支覆盖：脏数据不许把界面带崩）—— */
ok('habitDueOn 非法日期 → false，不是"每天都该做"', P.habitDueOn(_hRule, 'bad') === false);
eq('habitRepeatOf interval 无锚点且无创建日 → 锚点留空（退化成每天，不静默断链）',
  P.habitRepeatOf({ repeat: { mode: 'interval', interval: 3 } }).anchor, null);
eq('habitExpectedIn 规则型 + 创建日在未来 → 0（不虚增分母）',
  P.habitExpectedIn({ createdAt: '2026-11-01', repeat: { mode: 'daily' } }, '2026-10-14', 7), 0);
eq('habitBestStreak 规则型 + 空日志 → 0', P.habitBestStreak([], _hRule), 0);
eq('habitCurrentStreak 创建日之后才有记录（早于创建日不算欠账）',
  P.habitCurrentStreak(['2026-10-13'], '2026-10-14', { createdAt: '2026-10-14', repeat: { mode: 'daily' } }), 0);
/* null / 缺省入参：视图层拿不到日志时传 null 是常态，纯函数不许炸 */
eq('habitRepeatOf(null) 安全', P.habitRepeatOf(null), null);
eq('habitSkippedOn 日期缺省安全', P.habitSkippedOn({ skipOn: '2026-10-14' }, null), false);
eq('habitCurrentStreak null 日志安全', P.habitCurrentStreak(null, '2026-10-14', _hRule), 0);
eq('habitStats 日志 null / days 缺省安全',
  P.habitStats({ freqPerWeek: 7 }, null, '2026-10-14', null).done, 0);
eq('habitExpectedIn days 缺省按 30 天窗', P.habitExpectedIn({ repeat: { mode: 'daily' } }, '2026-10-14'), 30);

/* —— 迁移幂等：规则归一化跑两遍结果一致（老存档无 repeat 时连字段都不生出来）—— */
eq('normTodoRepeat 幂等（习惯规则跑两遍）',
  P.normTodoRepeat(P.normTodoRepeat(_wk135)), P.normTodoRepeat(_wk135));
ok('无 repeat 的老习惯不会被凭空当成规则型', P.habitRepeatOf({ freqPerWeek: 3 }) === null);
eq('habitRepeatLabel 无规则 = 每天', P.habitRepeatLabel({}), '每天');
eq('habitRepeatLabel 每周一三五', P.habitRepeatLabel(_hRule), '每周一、三、五');
eq('habitStreakUnit 规则型 = 次', P.habitStreakUnit(_hRule), '次');
eq('habitStreakUnit 老习惯 = 天', P.habitStreakUnit({}), '天');

/* —— 习惯分类 —— */
eq('habitCatOf 有分类返回 id', P.habitCatOf({ catId: 'c1' }), 'c1');
eq('habitCatOf 无分类返回空串哨兵', P.habitCatOf({}), '');
eq('habitCatOf null 安全', P.habitCatOf(null), '');
eq('normHabitCatName trim 后截 12 字', P.normHabitCatName('abcdefghijklmnop'), 'abcdefghijkl');
eq('normHabitCatName null 安全', P.normHabitCatName(null), '');
eq('normHabitCats 去无 id / 空名 / 重名，name 被 trim',
  P.normHabitCats([
    { id: 'c1', name: ' 学习 ' }, { id: 'c1', name: '重复' },
    { id: null, name: '无id' }, { id: 'c2', name: '   ' }, { id: 'c3', name: '运动' }
  ]), [{ id: 'c1', name: '学习' }, { id: 'c3', name: '运动' }]);
eq('normHabitCats 非数组安全', P.normHabitCats(null), []);
var _hg = P.habitCatGroups(
  [{ id: 'h1', catId: 'c1' }, { id: 'h2', catId: 'cX' }, { id: 'h3' }],
  [{ id: 'c1', name: '学习' }, { id: 'c2', name: '运动' }]);
eq('habitCatGroups 组数 = 声明分类数 + 未分类', _hg.length, 3);
eq('habitCatGroups 成员按 catId 归组', _hg[0].items.map(function (x) { return x.id; }), ['h1']);
eq('habitCatGroups 空分类仍保留（顺序=声明顺序）', _hg[1].items.length, 0);
eq('habitCatGroups 孤儿 catId 与无分类都进「未分类」且殿后',
  _hg[2].id + ':' + _hg[2].items.map(function (x) { return x.id; }).join(','), ':h2,h3');
eq('habitCatGroups 无成员时不追加未分类',
  P.habitCatGroups([{ id: 'h1', catId: 'c1' }], [{ id: 'c1', name: 'A' }]).length, 1);

/* —— 艾宾浩斯复习 · 自评档位 —— */
eq('reviewGradeMeta 遗忘 delta=0', P.reviewGradeMeta('forget').delta, 0);
eq('reviewGradeMeta 熟练 delta=1', P.reviewGradeMeta('ok').delta, 1);
eq('reviewGradeMeta 记牢 delta=2', P.reviewGradeMeta('solid').delta, 2);
eq('reviewGradeMeta 未知 → null', P.reviewGradeMeta('xxx'), null);

/* —— 艾宾浩斯复习 · 级别 → 间隔/阶段 —— */
eq('ebIntervalDays 0 级取首档', P.ebIntervalDays(0), P.EBBINGHAUS_INTERVALS[0]);
eq('ebIntervalDays 毕业 → 0（不再排期）', P.ebIntervalDays(P.EBBINGHAUS_GRADUATED), 0);
eq('ebIntervalDays 越界钳到毕业 → 0', P.ebIntervalDays(999), 0);
eq('ebStageName 0 → 初学', P.ebStageName(0), '初学');
eq('ebStageName 1 → 第1级', P.ebStageName(1), '第1级');
eq('ebStageName 毕业 → 记牢', P.ebStageName(P.EBBINGHAUS_GRADUATED), '记牢');

/* —— 艾宾浩斯复习 · 自评推进 —— */
eq('ebReview 遗忘 → 回 0 级', P.ebReview({ level: 3 }, 'forget', '2026-10-14').level, 0);
eq('ebReview 熟练 → +1', P.ebReview({ level: 1 }, 'ok', '2026-10-14').level, 2);
eq('ebReview 记牢 → +2', P.ebReview({ level: 1 }, 'solid', '2026-10-14').level, 3);
eq('ebReview 不超过毕业级别',
  P.ebReview({ level: P.EBBINGHAUS_GRADUATED - 1 }, 'solid', '2026-10-14').level, P.EBBINGHAUS_GRADUATED);
eq('ebReview 毕业时 next=null', P.ebReview({ level: P.EBBINGHAUS_GRADUATED }, 'ok', '2026-10-14').next, null);
eq('ebReview last 记今天', P.ebReview({ level: 0 }, 'ok', '2026-10-14').last, '2026-10-14');
eq('ebReview next = 今天 + 该级间隔',
  P.ebReview({ level: 0 }, 'ok', '2026-10-14').next, P.addDaysStr('2026-10-14', P.ebIntervalDays(1)));
eq('ebReview 空 state 当 0 级处理', P.ebReview(null, 'ok', '2026-10-14').level, 1);
eq('ebReview 未知档位当遗忘处理', P.ebReview({ level: 3 }, 'xx', '2026-10-14').level, 0);

/* —— 艾宾浩斯复习 · 是否到期 / 毕业 / 毕业原因 —— */
eq('ebIsDue 新卡（null）→ 该复习', P.ebIsDue(null, '2026-10-14'), true);
eq('ebIsDue 无 next（已毕业）→ 不再复习', P.ebIsDue({ level: 5, next: null }, '2026-10-14'), false);
eq('ebIsDue next=今天 → 该复习', P.ebIsDue({ next: '2026-10-14' }, '2026-10-14'), true);
eq('ebIsDue next=明天 → 还没到', P.ebIsDue({ next: '2026-10-15' }, '2026-10-14'), false);
eq('ebIsDue next=昨天 → 该复习（欠着）', P.ebIsDue({ next: '2026-10-13' }, '2026-10-14'), true);
eq('ebIsGraduated next 空 → true', P.ebIsGraduated({ next: null }), true);
eq('ebIsGraduated 有 next → false', P.ebIsGraduated({ next: '2026-10-15' }), false);
eq('ebGraduateReason 主动斩掉', P.ebGraduateReason({ next: null, reason: 'mastered' }), 'mastered');
eq('ebGraduateReason 老数据兜底为 solid-top', P.ebGraduateReason({ next: null }), 'solid-top');
eq('ebGraduateReason 未毕业 → null', P.ebGraduateReason({ next: '2026-10-15' }), null);
eq('ebRestoreState 恢复被斩的：回初学 + 今天就该复习',
  JSON.stringify(P.ebRestoreState('2026-10-14')), JSON.stringify({ level: 0, last: null, next: '2026-10-14' }));

/* —— 全站字号缩放 —— */
eq('fontScaleMeta 标准档 factor=1', P.fontScaleMeta('std').factor, 1);
eq('fontScaleMeta 未知 key → 回落标准', P.fontScaleMeta('xxx').key, 'std');
eq('fontScaleMeta null → 回落标准', P.fontScaleMeta(null).key, 'std');
eq('normFontScale 低于下限夹到 MIN', P.normFontScale(0.1), P.FONT_SCALE_MIN);
eq('normFontScale 高于上限夹到 MAX', P.normFontScale(9), P.FONT_SCALE_MAX);
eq('normFontScale 非数字 → 1', P.normFontScale('abc'), 1);
eq('normFontScale 合法值原样保留', P.normFontScale(1.3), 1.3);

/* —— 备忘录 · 保留期档位 —— */
eq('memoRetentionMeta 1 年档 = 365 天', P.memoRetentionMeta('1y').days, 365);
eq('memoRetentionMeta 永久档 days=0', P.memoRetentionMeta('forever').days, 0);
eq('memoRetentionMeta 未知 key → 回落默认 1y', P.memoRetentionMeta('zzz').key, '1y');
eq('memoRetentionMeta null → 回落默认', P.memoRetentionMeta(null).key, '1y');

/* —— 备忘录 · 单条归一化 —— */
eq('normMemo 非对象 → null', P.normMemo('x'), null);
eq('normMemo 缺 ts → null', P.normMemo({ text: 'a' }), null);
eq('normMemo ts<=0 → null', P.normMemo({ ts: 0, text: 'a' }), null);
eq('normMemo 空文本 → null', P.normMemo({ ts: 1, text: '   ' }), null);
var _nm = P.normMemo({ id: 1, text: '  hi  ', ts: 1000.6 });
eq('normMemo 文本被 trim', _nm.text, 'hi');
eq('normMemo id 转字符串', _nm.id, '1');
eq('normMemo ts 四舍五入取整', _nm.ts, 1001);
eq('normMemo 长文本截到 500', P.normMemo({ ts: 1, text: new Array(601).join('x') }).text.length, P.MEMO_TEXT_MAX);
eq('normMemo 自引用 replyTo 被丢弃（防死循环）',
  Object.prototype.hasOwnProperty.call(P.normMemo({ id: 'a', ts: 1, text: 'x', replyTo: 'a' }), 'replyTo'), false);
eq('normMemo 正常 replyTo 保留', P.normMemo({ id: 'a', ts: 1, text: 'x', replyTo: 'b' }).replyTo, 'b');
eq('normMemo side=other 落字段（左栏）', P.normMemo({ ts: 1, text: 'x', side: 'other' }).side, 'other');
eq('normMemo 默认 side 不落字段（老数据零迁移）',
  Object.prototype.hasOwnProperty.call(P.normMemo({ ts: 1, text: 'x' }), 'side'), false);

/* —— 备忘录 · 列表归一化与保留期切分 —— */
var _ml = P.normMemoList([{ ts: 200, text: 'b' }, { id: 'z', ts: 100, text: 'a' }, { ts: 0, text: 'bad' }]);
eq('normMemoList 过滤脏值 + 按时间正序', _ml.map(function (m) { return m.ts; }), [100, 200]);
eq('normMemoList 非数组 → []', P.normMemoList(null), []);
eq('normMemoList 同毫秒按 id 稳定排序',
  P.normMemoList([{ id: 'b', ts: 5, text: 'B' }, { id: 'a', ts: 5, text: 'A' }]).map(function (m) { return m.id; }),
  ['a', 'b']);
var _nowMs = 100 * P.DAY_MS;
var _sp = P.memoSplitByRetention([
  { ts: _nowMs - 40 * P.DAY_MS, text: '40天前' },     /* 超 30 天档 → 过期 */
  { ts: _nowMs - 5 * P.DAY_MS, text: '5天前' }        /* 未超 → 保留 */
], _nowMs, '1m');
eq('memoSplitByRetention 超期进 expired', _sp.expired.map(function (m) { return m.text; }), ['40天前']);
eq('memoSplitByRetention 未超期进 keep', _sp.keep.map(function (m) { return m.text; }), ['5天前']);
eq('memoSplitByRetention 永久档全部 keep',
  P.memoSplitByRetention([{ ts: 1, text: '上古' }], _nowMs, 'forever').keep.length, 1);
eq('memoSplitByRetention 永久档无过期',
  P.memoSplitByRetention([{ ts: 1, text: '上古' }], _nowMs, 'forever').expired.length, 0);
eq('memoDaysLeft 还剩 10 天', P.memoDaysLeft({ ts: _nowMs - 20 * P.DAY_MS }, _nowMs, '1m'), 10);
eq('memoDaysLeft 永久档 → -1（不适用）', P.memoDaysLeft({ ts: 1 }, _nowMs, 'forever'), -1);
eq('memoDaysLeft 无条目 → -1', P.memoDaysLeft(null, _nowMs, '1m'), -1);

/* —— 日程网格 · 分钟 ↔ 网格坐标 ——
   ★ 2026-11-04：两带各扩一小时（06–14 / 15–23），窗口从 07:00–22:59 变成 06:00–23:59。
     带内小时的下标是**相对带首**算的，所以 07:00 由 hourIdx 0 变成 1。 */
eq('tbGridCellOf 06:00 → 带0/首小时/第0格',
  JSON.stringify(P.tbGridCellOf(6 * 60)), JSON.stringify({ band: 0, hour: 6, hourIdx: 0, slot: 0 }));
eq('tbGridCellOf 07:00 → 带0/7点/第1格',
  JSON.stringify(P.tbGridCellOf(7 * 60)), JSON.stringify({ band: 0, hour: 7, hourIdx: 1, slot: 0 }));
eq('tbGridCellOf 07:20 → 第 2 小格（10 分/格）', P.tbGridCellOf(7 * 60 + 20).slot, 2);
eq('tbGridCellOf 15:00 → 第二带首小时', P.tbGridCellOf(15 * 60).hourIdx, 0);
eq('tbGridCellOf 22:00 → 第二带 7 点', P.tbGridCellOf(22 * 60).hourIdx, 7);
eq('tbGridCellOf 23:00 → 第二带末小时（新增档）', P.tbGridCellOf(23 * 60).hourIdx, 8);
eq('tbGridCellOf 05:59 带外 → null', P.tbGridCellOf(5 * 60 + 59), null);
eq('tbGridCellOf 24:00 带外 → null', P.tbGridCellOf(24 * 60), null);
eq('tbGridCellOf 非法输入 → null', P.tbGridCellOf('x'), null);
eq('tbGridMinOf 带0 首格 = 360（06:00）', P.tbGridMinOf(0, 0, 0), 360);
eq('tbGridMinOf 带1 首格 = 900（15:00）', P.tbGridMinOf(1, 0, 0), 900);
eq('tbGridMinOf 带0 第1小时第3格 = 450（07:30）', P.tbGridMinOf(0, 1, 3), 450);
eq('tbGridRange 下界 360', P.tbGridRange().min, 360);
eq('tbGridRange 上界 1440（次日 00:00）', P.tbGridRange().max, 1440);
var _cells = P.tbGridCellsOf(7 * 60, 7 * 60 + 30);
eq('tbGridCellsOf 07:00-07:30 覆盖 3 格', _cells.length, 3);
eq('tbGridCellsOf 首格坐标正确',
  JSON.stringify(_cells[0]), JSON.stringify({ band: 0, hour: 7, hourIdx: 1, slot: 0 }));
eq('tbGridCellsOf 带外区间整体丢弃', P.tbGridCellsOf(0, 60).length, 0);
eq('tbGridCellsOf 23:30-24:00 已进带内（新增档）', P.tbGridCellsOf(23 * 60 + 30, 24 * 60).length, 3);
eq('tbGridSameCol 同带同小时 → true',
  P.tbGridSameCol(P.tbGridCellOf(7 * 60), P.tbGridCellOf(7 * 60 + 20)), true);
eq('tbGridSameCol 不同小时 → false',
  P.tbGridSameCol(P.tbGridCellOf(7 * 60), P.tbGridCellOf(8 * 60)), false);
eq('tbGridSameCol 空值 → false', P.tbGridSameCol(null, null), false);

/* —— 日程网格 · 时刻换算与吸附 —— */
eq('tbHHMMToMin 07:30 → 450', P.tbHHMMToMin('07:30'), 450);
eq('tbHHMMToMin 带日期前缀也认', P.tbHHMMToMin('2026-10-14 07:30'), 450);
eq('tbHHMMToMin 24:00 → null（小时越界）', P.tbHHMMToMin('24:00'), null);
eq('tbHHMMToMin 07:60 → null（分钟越界）', P.tbHHMMToMin('07:60'), null);
eq('tbHHMMToMin 空串 → null', P.tbHHMMToMin(''), null);
eq('tbHHMMToMin null → null', P.tbHHMMToMin(null), null);
eq('tbMinToHHMM 450 → "07:30"', P.tbMinToHHMM(450), '07:30');
eq('tbMinToHHMM 超一天取模（1500 → 01:00）', P.tbMinToHHMM(1500), '01:00');
eq('tbMinToHHMM 负数安全（-60 → 23:00）', P.tbMinToHHMM(-60), '23:00');
eq('tbMinToHHMM 非法 → 空串', P.tbMinToHHMM('x'), '');
ok('tbHourLabel 返回非空标签（跟随 12/24 制）', P.tbHourLabel(7).length > 0);
eq('tbHourLabel 非法 → 空串', P.tbHourLabel('x'), '');
eq('tbSnapMin 吸附到 30 分格（467 → 480）', P.tbSnapMin(467, 30), 480);
eq('tbSnapMin 默认 30 分粒度（464 → 450）', P.tbSnapMin(464), 450);
eq('tbSnapMin 负数夹到 0', P.tbSnapMin(-100, 30), 0);
eq('tbSnapMin 超一天夹到 1440', P.tbSnapMin(9999, 30), 1440);
eq('tbSnapMin 非法 → 0', P.tbSnapMin('x', 30), 0);
eq('tbSlotCount 默认 30 分 → 48 格', P.tbSlotCount(), 48);
eq('tbSlotCount 15 分 → 96 格', P.tbSlotCount(15), 96);
eq('tbSlotCount 非法粒度回落默认 → 48', P.tbSlotCount(0), 48);

/* —— 日程网格 · 计划块 / 实际段 / 计划外段 —— */
eq('tbBlockOf null → null', P.tbBlockOf(null), null);
var _b1 = P.tbBlockOf({ id: 't1', title: '测试', remindAt: '2026-10-14 09:00', pomodoros: 2 }, {});
eq('tbBlockOf id/title 透传', _b1.id + '/' + _b1.title, 't1/测试');
eq('tbBlockOf start 取提醒时间（09:00→540）', _b1.start, 540);
ok('tbBlockOf end 落在 start 之后', _b1.end > _b1.start);
ok('tbBlockOf 未分类 quad 为 null', _b1.quad === null);
eq('tbBlockOf startDate 取日期部分', _b1.startDate, '2026-10-14');
var _d = '2026-10-14';
/* tbActualSegments 已下线：日程网格的实际块改由 01d 的
   tbTodoSegList（记录 segs ∪ 进行中会话）统一喂数，本文件不再重复测一份实现。
   它此前的"老记录按 taskName 认领"口径，已在 C68 的 E6/E7 接到唯一入口上。 */
var _rec3 = [
  { todoId: 't1', startTime: new Date(2026, 9, 14, 9, 0, 0).getTime(), endTime: new Date(2026, 9, 14, 9, 30, 0).getTime() },
  { taskName: '随手记', startTime: new Date(2026, 9, 14, 13, 0, 0).getTime(), endTime: new Date(2026, 9, 14, 13, 25, 0).getTime() }
];
eq('tbUnplannedSegments 挂了计划的被剔除，只剩 1 段', P.tbUnplannedSegments(_rec3, _d, ['t1']).length, 1);
eq('tbUnplannedSegments 灰块带 taskName（知道它是啥）',
  P.tbUnplannedSegments(_rec3, _d, ['t1'])[0].title, '随手记');
/* 第 4 个参数 claimedNames（"被计划按名字认领的标题"）已删除：
   名字不再参与归属判定。没挂 todoId 的记录一律是计划外 —— 老数据里能认亲的已在启动时
   由 migrateRecordOwnership 补挂 id。下面这条就是这类 bug 的纯函数级证明：
   标题与某条计划同名的自由专注，必须仍然画成灰块，而不是被那条计划捡走。 */
eq('tbUnplannedSegments 同名的自由专注仍算计划外（名字不是身份）',
  P.tbUnplannedSegments(_rec3, _d, ['t1']).length, 1);
eq('tbUnplannedSegments 挂了 id 才算那条计划的（同名不同 id 不顶替）',
  P.tbUnplannedSegments(_rec3, _d, ['other-id']).length, 2);
eq('tbUnplannedSegments 非当天不取', P.tbUnplannedSegments(_rec3, '2026-10-13', []).length, 0);
eq('tbUnplannedSegments 非数组安全', P.tbUnplannedSegments(null, _d, [], []), []);
/* 时长不吃区间：
   结算晚了区间被裁成 43 分，但记录的 effectiveSeconds 是 25 分 → 灰块按 25 分画。 */
var _recAuth = [{ taskName: 'x', startTime: new Date(2026, 9, 14, 5, 18, 0).getTime(),
  endTime: new Date(2026, 9, 14, 6, 1, 0).getTime(), effectiveSeconds: 1500 }];
eq('tbUnplannedSegments 灰块长度认 effectiveSeconds（区间 43 分 → 画 25 分）',
  P.tbUnplannedSegments(_recAuth, _d, [])[0].minutes, 25);
var _segA = [{ start: 318, end: 361, minutes: 43, recId: 1, authMs: 1500000 }];
eq('tbAuthScaleSegs 单段按权威时长收缩', P.tbAuthScaleSegs(_segA)[0].minutes, 25);
eq('tbAuthScaleSegs 不改入参', _segA[0].minutes, 43);
eq('tbAuthScaleSegs 无 authMs 原样保留', P.tbAuthScaleSegs([{ start: 0, end: 30 }])[0].minutes, 30);
/* ★ 权威时长比真实区间还长时：块长压回区间，不许画到区间之外。
   来历（2026-10-29 用户报）：正计时暂停会把 startTime 重设成此刻，而
   effectiveSeconds 是累计值 —— 21:40:54~21:49:11 只跨 8 分钟，有效却是 1907 秒。
   按比例拉长的话块会画到 22:12，用户看到「现在才 21:55，日程表怎么到 10 点多了」。
   日程表坐标系是「距 00:00 的分钟数」，所以这里的数都是分钟。 */
var _over37 = P.tbAuthScaleSegs([{ start: 1300.9, end: 1309.18, recId: 9, authMs: 1907000 }])[0];
eq('tbAuthScaleSegs 权威时长 > 真实区间时压回区间', Math.round(_over37.minutes * 100) / 100, 8.28);
eq('tbAuthScaleSegs 这时块的终点 = 真实终点（不画进未来）', Math.round(_over37.end * 100) / 100, 1309.18);
eq('tbAuthScaleSegs 非数组安全', P.tbAuthScaleSegs(null), []);
eq('tbAuthScaleSegs 只有 start/end 也补出 minutes', P.tbAuthScaleSegs([{ start: 5, end: 25 }])[0].minutes, 20);
/* 不变量：同一记录的所有段缩完，合计恒等于权威时长 —— 哪怕段与段时间上重叠。
   （分母是各段跨度之和，不是并集跨度，所以重叠不会被重复计算。） */
var _ov = P.tbAuthScaleSegs([{ start: 0, end: 40, recId: 1, authMs: 1500000 },
  { start: 20, end: 60, recId: 1, authMs: 1500000 }]);
eq('tbAuthScaleSegs 段重叠时合计仍=权威25分',
  _ov.reduce(function (x, y) { return x + y.minutes; }, 0), 25);
eq('tbAuthScaleSegs 段重叠时两段各分一半', [_ov[0].minutes, _ov[1].minutes], [12.5, 12.5]);
/* tbRecMs 是**内部函数（未导出）** —— 它被 tbUnplannedSegments 调用，
   经调用链覆盖。这里用 ISO 串走一遍它的 Date 兜底分支（注释里强调的「历史两种写法」）。 */
eq('tbRecMs（经计划外段）认 ISO 字符串时间',
  P.tbUnplannedSegments([{
    taskName: '随手记', startTime: '2026-10-14T09:00:00', endTime: '2026-10-14T09:30:00'
  }], '2026-10-14', []).length, 1);
eq('tbRecMs（经计划外段）垃圾时间戳整条丢弃',
  P.tbUnplannedSegments([{ taskName: '随手记', startTime: 'zzz' }], '2026-10-14', []).length, 0);

/* —— 日程网格 · 多轨布局 —— */
var _ln = P.tbAssignLanes([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 12, end: 20 }]);
eq('tbAssignLanes 贪心占最早可用列（12 可复用第 0 列）',
  _ln.map(function (x) { return x.lane; }).join(','), '0,1,0');
eq('tbAssignLanes lanes = 实际用到的列数', _ln[0].lanes, 2);
eq('tbAssignLanes 极端重叠超上限挤最后一列',
  P.tbAssignLanes([
    { start: 0, end: 100 }, { start: 1, end: 100 }, { start: 2, end: 100 },
    { start: 3, end: 100 }, { start: 4, end: 100 }
  ]).map(function (x) { return x.lane; }).join(','), '0,1,2,2,2');
eq('tbAssignLanes 过滤非法项', P.tbAssignLanes([{ start: 0, end: 10 }, { start: 'x' }, null]).length, 1);
eq('tbAssignLanes 非数组安全', P.tbAssignLanes(null), []);

/* —— 履历 / 番茄账 / 子任务 / 归日 / 里程碑 —— */
eq('treeAgeTierByDays 命中已有档位',
  P.treeAgeTierByDays(P.TREE_AGE_TIERS[0].days).days, P.TREE_AGE_TIERS[0].days);
eq('treeAgeTierByDays 不存在的天数 → null', P.treeAgeTierByDays(123456), null);
eq('treeAgeTierByDays 非法输入 → null', P.treeAgeTierByDays('x'), null);
eq('pomosToMinutes 4🍅 = 100 分钟', P.pomosToMinutes(4), 100);
eq('pomosToMinutes 0.5🍅 → 13（四舍五入）', P.pomosToMinutes(0.5), 13);
eq('pomosToMinutes 负数归零', P.pomosToMinutes(-5), 0);
eq('pomosToMinutes 非法归零', P.pomosToMinutes('x'), 0);
eq('findSubById 命中返回该条', P.findSubById([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], 'b').title, 'B');
eq('findSubById 数字/字符串 id 等价', P.findSubById([{ id: 5, title: 'N' }], '5').title, 'N');
eq('findSubById 找不到 → null', P.findSubById([{ id: 'a' }], 'z'), null);
eq('findSubById 空 id → null', P.findSubById([{ id: 'a' }], ''), null);
eq('findSubById null subs → null', P.findSubById(null, 'a'), null);
ok('todoPomosForMinutes 120 分钟 → 排得下若干番茄', P.todoPomosForMinutes(120) >= 1);
eq('todoPomosForMinutes 0 分钟 → 0', P.todoPomosForMinutes(0), 0);
eq('todoPomosForMinutes 负数 → 0', P.todoPomosForMinutes(-10), 0);
ok('todoPomosForMinutes 与 todoEstDurationMin 互为界（排出的时长不越界）',
  P.todoEstDurationMin(P.todoPomosForMinutes(100), {}) <= 100);
eq('quadRank q1 = 0', P.quadRank('q1'), 0);
eq('quadRank q4 = 3', P.quadRank('q4'), 3);
eq('quadRank 未分类 = 4（永远垫底）', P.quadRank(''), 4);
eq('quadRank 脏值 = 4', P.quadRank('zzz'), 4);
eq('quadRank 大写经归一化也认', P.quadRank('Q2'), 1);
eq('snapshotPlanSubs 无子任务 → null', P.snapshotPlanSubs({ subs: [] }), null);
eq('snapshotPlanSubs 无 subs 字段 → null', P.snapshotPlanSubs({}), null);
eq('snapshotPlanSubs null → null', P.snapshotPlanSubs(null), null);
eq('snapshotPlanSubs 压成 {t,d} 快照（存快照而非引用）',
  JSON.stringify(P.snapshotPlanSubs({ subs: [{ title: '背单词', done: true }, { title: '写卷子' }] })),
  JSON.stringify([{ t: '背单词', d: true }, { t: '写卷子', d: false }]));
eq('snapshotPlanSubs 超上限截断',
  P.snapshotPlanSubs({ subs: Array.from({ length: 20 }, function (_, i) { return { title: 's' + i }; }) }).length,
  P.PLAN_SUB_SNAPSHOT_MAX);
/* ★ cutoff 让记录只认「它自己结束前完成的那几步」。
   之后才勾的不许倒灌回前面那条记录（需求：记录要是快照，不是实时同步）。 */
var _B1 = 1790000000000;
eq('snapshotPlanSubs cutoff：记录结束前勾的 → d=true',
  JSON.stringify(P.snapshotPlanSubs({ subs: [{ title: 'A', done: true, doneAt: _B1 - 600000 }] }, _B1)),
  JSON.stringify([{ t: 'A', d: true }]));
eq('snapshotPlanSubs cutoff：记录结束后才勾的 → d=false',
  JSON.stringify(P.snapshotPlanSubs({ subs: [{ title: 'B', done: true, doneAt: _B1 + 600000 }] }, _B1)),
  JSON.stringify([{ t: 'B', d: false }]));
eq('snapshotPlanSubs cutoff：恰好等于记录结束 → 算完成（含边界）',
  JSON.stringify(P.snapshotPlanSubs({ subs: [{ title: 'C', done: true, doneAt: _B1 }] }, _B1)),
  JSON.stringify([{ t: 'C', d: true }]));
eq('snapshotPlanSubs cutoff：未勾的仍是 false',
  JSON.stringify(P.snapshotPlanSubs({ subs: [{ title: 'D', done: false }] }, _B1)),
  JSON.stringify([{ t: 'D', d: false }]));
eq('snapshotPlanSubs cutoff：老数据无 doneAt → 退回 !!done（不做假判断）',
  JSON.stringify(P.snapshotPlanSubs({ subs: [{ title: 'E', done: true }] }, _B1)),
  JSON.stringify([{ t: 'E', d: true }]));
eq('snapshotPlanSubs cutoff 传 0/NaN → 等同不传',
  JSON.stringify(P.snapshotPlanSubs({ subs: [{ title: 'F', done: true, doneAt: _B1 + 1 }] }, 0)),
  JSON.stringify([{ t: 'F', d: true }]));
eq('planSubsSummaryText 空 → 空串', P.planSubsSummaryText([]), '');
eq('planSubsSummaryText 非数组 → 空串', P.planSubsSummaryText(null), '');
eq('planSubsSummaryText 统计完成数', P.planSubsSummaryText([{ t: 'A', d: true }, { t: 'B', d: false }]), '1/2 步 · A · B');
eq('planSubsSummaryText 未命名兜底', P.planSubsSummaryText([{ d: false }]), '0/1 步 · 未命名');
ok('planSubsSummaryText 超展示上限折成「等 N 步」',
  P.planSubsSummaryText(Array.from({ length: 9 }, function (_, i) { return { t: 's' + i, d: false }; }))
    .indexOf('等 9 步') >= 0);

/* —— 归日判定（周计划的核心规则）—— */
var _oc1 = { id: 'x', title: 'T', remindAt: '2026-10-14 09:00' };
eq('todoOccursOn 排期日当天 → 生效', P.todoOccursOn(_oc1, '2026-10-14', '2026-10-14'), true);
eq('todoOccursOn 非排期日且不重复 → 不生效', P.todoOccursOn(_oc1, '2026-10-15', '2026-10-14'), false);
eq('todoOccursOn 早于排期日 → 不生效（下界）', P.todoOccursOn(_oc1, '2026-10-13', '2026-10-14'), false);
var _oc2 = { id: 'y', title: 'D', remindAt: '2026-10-14 09:00', repeat: { mode: 'daily' } };
eq('todoOccursOn 每天重复：次日也生效', P.todoOccursOn(_oc2, '2026-10-15', '2026-10-14'), true);
eq('todoOccursOn 每天重复：早于排期日仍不生效（下界优先于规则）',
  P.todoOccursOn(_oc2, '2026-10-13', '2026-10-14'), false);
eq('todoOccursOn 空 ds → false', P.todoOccursOn(_oc1, '', '2026-10-14'), false);
eq('todoOccursOn 空 todo → false', P.todoOccursOn(null, '2026-10-14', '2026-10-14'), false);

/* —— 森林里程碑 —— */
var _fm = P.forestMilestones(0);
eq('forestMilestones 返回全部里程碑', _fm.length, P.FOREST_MILESTONES.length);
eq('forestMilestones 每项都有 trees/label/unlocked',
  _fm.every(function (m) { return 'trees' in m && 'label' in m && 'unlocked' in m; }), true);
eq('forestMilestones 极大树数 → 全解锁', P.forestMilestones(99999).every(function (m) { return m.unlocked; }), true);
eq('forestMilestones 非法输入按 0 处理',
  P.forestMilestones('x').map(function (m) { return m.unlocked; }).join(','),
  P.forestMilestones(0).map(function (m) { return m.unlocked; }).join(','));

/* —— 日记总览字段表 diaryOverviewParts：新字段不许再静默消失 —— */
var _d1 = {
  plan: '今天先把数学错题过一遍',
  review: { progress: '把最难的那部分先做掉了', shortcomings: '', improvements: '明天早点起', other: '' },
  feedback: { sleepTime: '23:10', wakeTime: '07:00', sleepQuality: '7', mentalState: '', sleepDay: 'prev' },
  gratitude: { items: [' 感谢我妈做的米饭 ', '', '感谢同桌借我橡皮'] }
};
var _p1 = P.diaryOverviewParts(_d1);
eq('diaryOverviewParts 空日记 → 三块都空',
  P.diaryOverviewParts({}), { rows: [], feedback: '', extra: [] });
eq('diaryOverviewParts null 不抛', P.diaryOverviewParts(null).rows, []);
eq('diaryOverviewParts 只列有内容的字段（空 shortcomings/other 不占行）',
  _p1.rows.map(function (r) { return r.label; }).join(','), '📝 今日计划,进步,改进,🙏 感恩');
eq('diaryOverviewParts 感恩逐条 trim、丢空串、用 · 连接',
  _p1.rows[3].text, '感谢我妈做的米饭 · 感谢同桌借我橡皮');
eq('diaryOverviewParts 反馈压成一行', _p1.feedback, '😴 睡 23:10 · 醒 07:00 · 睡眠 7');
eq('diaryOverviewParts 已知字段不重复进 extra', _p1.extra.length, 0);
/* 关键回归：日记**新加一个字段**（这里模拟），总览必须自己显示出来 */
var _d2 = { review: { progress: 'x' }, morning: '六点半起来背单词' };
var _p2 = P.diaryOverviewParts(_d2);
eq('diaryOverviewParts 未登记字段进 extra（新字段不会被吞）',
  _p2.extra.length === 1 && _p2.extra[0].label === 'morning' && _p2.extra[0].text === '六点半起来背单词', true);
eq('diaryOverviewParts 未登记的对象字段报条数',
  P.diaryOverviewParts({ weather: { mood: 'sun', temp: 26 } }).extra[0].text, '（2 项）');
eq('diaryOverviewParts 多行正文压成一行',
  P.diaryOverviewParts({ review: { progress: '第一行\n第二行' } }).rows[0].text, '第一行 · 第二行');
eq('diaryOverviewParts planSnapshot 不算缺省字段',
  P.diaryOverviewParts({ planSnapshot: [{ t: 1 }] }).extra.length, 0);
ok('clipText 超长补省略号', P.clipText('一二三四五', 3) === '一二三…' && P.clipText('ab', 3) === 'ab');
eq('diaryFieldAt 任一层缺失返回 undefined', P.diaryFieldAt({ a: 1 }, 'b.c'), undefined);

/* —— 计划「排期快照」：历史那天的预计块不能依赖会被删掉的对象 —— */
eq('todoMainDateOf 取 remindAt 的日期', P.todoMainDateOf({ remindAt: '2026-10-16 18:28' }), '2026-10-16');
eq('todoMainDateOf 无 remindAt 时用 estEnd', P.todoMainDateOf({ estEnd: '2026-10-15 20:00' }), '2026-10-15');
eq('todoMainDateOf 都没设 → 空串', P.todoMainDateOf({ title: '无排期' }), '');
eq('todoMainDateOf 脏数据 → 空串', P.todoMainDateOf({ remindAt: '昨天下午' }), '');
/* planDate：只记「这条计划是哪天的」，不带钟点、不产生提醒（2026-11-06） */
eq('todoMainDateOf planDate 优先于 remindAt',
  P.todoMainDateOf({ planDate: '2026-11-08', remindAt: '2026-11-09 09:00' }), '2026-11-08');
eq('todoMainDateOf 只有 planDate', P.todoMainDateOf({ planDate: '2026-11-08' }), '2026-11-08');
eq('todoMainDateOf planDate 脏值 → 退回 remindAt',
  P.todoMainDateOf({ planDate: '明天', remindAt: '2026-11-09 09:00' }), '2026-11-09');
/* 与 remindAt 同口径：只做形状校验（YYYY-MM-DD），不做日历校验 —— 两边行为要一致 */
eq('todoMainDateOf planDate 形状合法即采用（与 remindAt 同口径）',
  P.todoMainDateOf({ planDate: '2026-13-01' }), '2026-13-01');
{
  const snap = P.todoSchedSnapshotOf({ id: 7, title: '收拾屋子', quad: 'Q2', tag: '家务', remindAt: '2026-10-16 17:15', estEnd: '2026-10-16 18:00', pomodoros: 2, actualPomodoros: 1, tbColor: 'v4moss', done: true }, '2026-10-16');
  eq('快照冻结原排期（不跟着"今天"平移）', snap.remindAt, '2026-10-16 17:15');
  eq('快照保留预计结束', snap.estEnd, '2026-10-16 18:00');
  eq('快照保留预计番茄', snap.pomodoros, 2);
  eq('快照保留配色（块的颜色要跟计划一致）', snap.tbColor, 'v4moss');
  eq('四象限归一化（脏值 Q2 → q2）', snap.quad, 'q2');
  eq('没排期的计划没有快照', P.todoSchedSnapshotOf({ id: 8, title: 'x' }, '2026-10-16'), null);
  eq('非法日期没有快照', P.todoSchedSnapshotOf({ id: 8, remindAt: '2026-10-16 10:00' }, '乱写'), null);
  const ps = P.todoSchedPseudoTodo(snap);
  eq('伪任务带 _hist 标记（视图据此不写回）', ps._hist, 1);
  eq('伪任务按"已完成"画', ps.done, true);
  eq('伪任务保留原 id（实际块靠它认亲）', ps.id, 7);
  eq('id 缺失的脏快照不生成伪任务', P.todoSchedPseudoTodo({ title: 'x' }), null);
}
{
  const day = [
    { id: 1, title: 'A-旧', remindAt: '2026-10-16 09:00', estEnd: '2026-10-16 09:30', pomodoros: 1 },
    { id: 1, title: 'A-新', remindAt: '2026-10-16 10:00', estEnd: '2026-10-16 10:30', pomodoros: 1 },
    { id: 2, title: 'B', remindAt: '2026-10-16 11:00', estEnd: '2026-10-16 11:30', pomodoros: 1 }
  ];
  const out = P.todoSchedPseudoTodos(day, {});
  eq('同一天同 id 只补一次', out.length, 2);
  eq('同 id 取后写的那份（最后的样子）', out.filter(function (t) { return t.id === 1; })[0].remindAt, '2026-10-16 10:00');
  eq('计划还在列表里 → 以活对象为准，快照不抢', P.todoSchedPseudoTodos(day, { '1': 1 }).map(function (t) { return t.id; }), [2]);
  eq('没有快照 → 空数组（不是 undefined）', P.todoSchedPseudoTodos(null, {}), []);
}

/* 排期快照的边界分支（脏数据不能让渲染层炸，也不能凭空造块） */
eq('todoMainDateOf 非对象 → 空串', P.todoMainDateOf(null), '');
eq('todoMainDateOf 数字 → 空串', P.todoMainDateOf(42), '');
/* 只有日期没有钟点 → 没有块可画（块的高度/位置全来自分钟），按"无排期"处理 */
eq('todoMainDateOf 纯日期（无钟点）→ 空串', P.todoMainDateOf({ remindAt: '2026-10-16' }), '');
eq('todoSchedSnapshotOf 非对象 → null', P.todoSchedSnapshotOf(null, '2026-10-16'), null);
eq('todoSchedSnapshotOf 空日期 → 用计划自己的日期', P.todoSchedSnapshotOf({ id: 3, remindAt: '2026-10-14 08:00' }, '').date, '2026-10-14');
eq('todoSchedSnapshotOf 月份越界 → null', P.todoSchedSnapshotOf({ id: 3, remindAt: '2026-10-14 08:00' }, '2026-13-01'), null);
{
  const snap = P.todoSchedSnapshotOf({ id: 5, remindAt: '2026-10-16 09:00' }, '2026-10-16');
  eq('缺 title → 空串（不是 undefined）', snap.title, '');
  eq('缺 tag → 空串', snap.tag, '');
  eq('缺 pomodoros → 0', snap.pomodoros, 0);
  eq('缺 doneAt → 0', snap.doneAt, 0);
  eq('字符串数字的番茄转成数', P.todoSchedSnapshotOf({ id: 5, remindAt: '2026-10-16 09:00', pomodoros: '2' }, '2026-10-16').pomodoros, 2);
}
eq('伪任务：id=0 视为无效', P.todoSchedPseudoTodo({ id: 0, remindAt: '2026-10-16 09:00' }), null);
eq('伪任务：null 快照', P.todoSchedPseudoTodo(null), null);
eq('伪任务列表：非数组 → 空数组', P.todoSchedPseudoTodos('x', {}), []);
eq('伪任务列表：数组里夹 null 也不炸', P.todoSchedPseudoTodos([null, { id: 9, remindAt: '2026-10-16 09:00' }], {}).length, 1);

/* 排期快照：字段兜底与"全靠 estEnd 排期"的路径 */
{
  const sn = P.todoSchedSnapshotOf({ id: 11, estEnd: '2026-10-13 21:00', deadline: '2026-10-20 23:59', estEndManual: 1, actualPomodoros: 3 }, '');
  eq('没有 remindAt 时用 estEnd 那天', sn.date, '2026-10-13');
  eq('estEnd 冻结', sn.estEnd, '2026-10-13 21:00');
  eq('deadline 原样保留', sn.deadline, '2026-10-20 23:59');
  eq('estEndManual 保留', sn.estEndManual, true);
  eq('实际番茄数一并冻结（历史块上要对得上）', sn.actPomos, 3);
}
eq('两样排期都没有 + 没传日期 → null', P.todoSchedSnapshotOf({ id: 12 }, ''), null);
{
  const ps = P.todoSchedPseudoTodo({ id: 13, remindAt: '2026-10-13 09:00', pomodoros: 1, estEndManual: 1, actPomos: 2, doneAt: 111, tbColor: 'v3blue' });
  eq('伪任务保留配色', ps.tbColor, 'v3blue');
  eq('伪任务保留完成时刻', ps.doneAt, 111);
  eq('伪任务保留实际番茄', ps.actualPomodoros, 2);
  eq('伪任务的 quad 缺省为 null（不写 undefined）', ps.quad, null);
}

eq('不传日期 → 用计划自己的日期', P.todoSchedSnapshotOf({ id: 14, remindAt: '2026-10-12 07:30' }).date, '2026-10-12');
{
  const ps = P.todoSchedPseudoTodo({ id: 15, remindAt: '2026-10-12 07:30' });
  eq('伪任务缺预计番茄 → 0（不是 NaN）', ps.pomodoros, 0);
  eq('伪任务缺实际番茄 → 0', ps.actualPomodoros, 0);
  eq('伪任务缺完成时刻 → 0', ps.doneAt, 0);
}

{
  /* 全字段到齐的快照（覆盖每个 `|| 默认值` 的"有值"分支） */
  const full = { id: 21, date: '2026-10-11', title: '全字段', quad: 'q1', tag: '学习', remindAt: '2026-10-11 08:00', estEnd: '2026-10-11 09:00', estEndManual: true, deadline: '2026-10-11 22:00', pomodoros: 3, tbColor: 'v2gold', actPomos: 2, doneAt: 1234 };
  const ps = P.todoSchedPseudoTodo(full);
  eq('全字段快照：标题', ps.title, '全字段');
  eq('全字段快照：四象限', ps.quad, 'q1');
  eq('全字段快照：标签', ps.tag, '学习');
  eq('全字段快照：预计结束', ps.estEnd, '2026-10-11 09:00');
  eq('全字段快照：渲染成一条', P.todoSchedPseudoTodos([full], {}).length, 1);
}

/* —— 导出面 —— */
ok('导出与 __pure 同源', typeof P.getDateStr === 'function' && P.fmtTomatoNum === P.fmtTomatoNum);
ok('日记字段表已导出', typeof P.diaryOverviewParts === 'function' && Array.isArray(P.DIARY_FIELD_SPEC));
ok('id 工具已导出', typeof P.idArg === 'function' && typeof P.idEq === 'function');
ok('CSV 三件套已导出', typeof P.recordsCsvTable === 'function' && typeof P.csvCell === 'function' && typeof P.planSubsText === 'function');

/* —— 日记字段表：分支覆盖（把边角也钉死，避免"只测了好路径"） —— */
eq('diaryListText 非数组 → 空（老数据 gratitude 是字符串也不炸）',
  P.diaryOverviewParts({ gratitude: { items: '写错了形状' } }).rows.length, 0);
eq('日记载体不是对象 → 全空', P.diaryOverviewParts('坏数据').rows.length, 0);
eq('未登记字段是数字/布尔也照样显示',
  P.diaryOverviewParts({ moodScore: 8 }).extra[0].text, '8');
eq('未登记字段是空数组 → 不显示', P.diaryOverviewParts({ tags: [] }).extra.length, 0);
eq('未登记字段是字符串数组 → 用 · 连接',
  P.diaryOverviewParts({ tags: [' 甲 ', '', '乙'] }).extra[0].text, '甲 · 乙');
eq('未登记字段是 null → 跳过', P.diaryOverviewParts({ note: null }).extra.length, 0);
eq('反馈写成"today"时用 🌙 前缀',
  P.diaryOverviewParts({ feedback: { sleepTime: '01:10', sleepDay: 'today' } }).feedback.indexOf('🌙') === 0, true);
eq('反馈写成"prev"时用 😴 前缀',
  P.diaryOverviewParts({ feedback: { sleepTime: '23:00', sleepDay: 'prev' } }).feedback.indexOf('😴') === 0, true);
eq('多行感恩条目里的换行被压成空格',
  P.diaryOverviewParts({ gratitude: { items: ['谢谢\n妈妈'] } }).rows[0].text, '谢谢 妈妈');
eq('plan 数字也当文本显示', P.diaryOverviewParts({ plan: 3 }).rows[0].text, '3');
ok('clipText 不传长度就不截断', P.clipText('很长很长的一段话') === '很长很长的一段话');
eq('diaryFieldAt 中间层是标量也不抛', P.diaryFieldAt({ a: 1 }, 'a.b'), undefined);

/* ===== 多段排期：额外段清洗 / 取数 / 首块日期 ===== */
{
  const norm = P.normExtraBlocks;
  eq('额外段：非数组 → 空', norm(undefined), []);
  eq('额外段：元素为 null / 缺字段 → 丢弃',
    norm([null, {}, { start: '2026-10-18 15:00' }, 3]), []);
  eq('额外段：非法日期（2026-13-01）→ 丢弃',
    norm([{ start: '2026-13-01 15:00', end: '2026-13-01 16:00' }]), []);
  eq('额外段：end == start → 丢弃',
    norm([{ start: '2026-10-18 15:00', end: '2026-10-18 15:00' }]), []);
  eq('额外段：end < start → 丢弃',
    norm([{ start: '2026-10-18 16:00', end: '2026-10-18 15:00' }]), []);
  eq('额外段：跨日 → 丢弃',
    norm([{ start: '2026-10-18 23:00', end: '2026-10-19 01:00' }]), []);
  eq('额外段：不足 10 分钟 → 丢弃',
    norm([{ start: '2026-10-18 15:00', end: '2026-10-18 15:09' }]), []);
  eq('额外段：正好 10 分钟 → 保留',
    norm([{ start: '2026-10-18 15:00', end: '2026-10-18 15:10' }]).length, 1);
  eq('额外段：T 分隔符也能归一',
    norm([{ start: '2026-10-18T15:00', end: '2026-10-18T16:00' }])[0].start, '2026-10-18 15:00');
  eq('额外段：未排序输入 → 输出升序',
    norm([
      { start: '2026-10-19 09:00', end: '2026-10-19 10:00' },
      { start: '2026-10-18 15:00', end: '2026-10-18 16:00' }
    ]).map((b) => b.start),
    ['2026-10-18 15:00', '2026-10-19 09:00']);
  eq('额外段：同一开始时刻去重',
    norm([
      { start: '2026-10-18 15:00', end: '2026-10-18 16:00' },
      { start: '2026-10-18 15:00', end: '2026-10-18 17:00' }
    ]).length, 1);
  const many = [];
  for (let i = 0; i < 30; i++) {
    const d = '2026-11-' + String(i + 1).padStart(2, '0');
    many.push({ start: d + ' 09:00', end: d + ' 10:00' });
  }
  eq('额外段：超过 24 段截断', norm(many).length, P.TODO_EXTRA_MAX);

  eq('额外段：只有日期没有钟点 → 丢弃',
    norm([{ start: '2026-10-18', end: '2026-10-18' }]), []);
  eq('额外段：空/空对象输入不炸',
    norm([{ start: '', end: '' }]), []);
  eq('todoExtraBlocksOn(null) → 空', P.todoExtraBlocksOn(null, '2026-10-18'), []);
  eq('todoHasAnyBlock(null) → false', P.todoHasAnyBlock(null, '2026-10-18', ''), false);
  eq('tbPrimaryBlockKey 空数组 → 空串', P.tbPrimaryBlockKey([]), '');
  eq('tbPrimaryBlockKey 多段 → 取最早那段',
    P.tbPrimaryBlockKey(P.tbBlocksOf({ id: 30, blocks: [
      { start: '2026-10-18 15:00', end: '2026-10-18 16:00' },
      { start: '2026-10-18 09:00', end: '2026-10-18 10:00' }
    ] }, {}, '2026-10-18')), '30|2026-10-18|540');
  eq('无块 → 首块日期为空串', P.todoFirstBlockDate({ id: 31 }), '');
  eq('todoBlockDates 同一天多段只留一个日期',
    P.todoBlockDates({ id: 32, remindAt: '2026-10-18 07:00', extraBlocks: [
      { start: '2026-10-18 15:00', end: '2026-10-18 16:00' }
    ] }), ['2026-10-18']);
  eq('todoBlockDates 历史伪任务按冻结块算日期',
    P.todoBlockDates({ _hist: 1, _histBlocks: [
      { rawStart: '2026-10-17 09:00' }, { rawStart: '2026-10-17 15:00' }
    ] }), ['2026-10-17']);

  const t1 = {
    id: 7, title: '背诵单词',
    remindAt: '2026-10-18 07:00',
    estEnd: '2026-10-18 08:00',
    extraBlocks: [{ start: '2026-10-18 15:00', end: '2026-10-18 16:00' }]
  };
  eq('当天额外段取数', P.todoExtraBlocksOn(t1, '2026-10-18').length, 1);
  eq('todoExtraBlocksOn 空日期 → 空', P.todoExtraBlocksOn(t1, ''), []);
  eq('tbBlocksOf 空日期 → 空', P.tbBlocksOf(t1, {}, ''), []);
  eq('别的日期取不到', P.todoExtraBlocksOn(t1, '2026-10-19').length, 0);
  eq('首块日期 = 主段那天', P.todoFirstBlockDate(t1), '2026-10-18');
  eq('有块日期去重升序', P.todoBlockDates(t1), ['2026-10-18']);
  eq('主段 + 额外段 = 两个块', P.tbBlocksOf(t1, {}, '2026-10-18').length, 2);
  const blocks1 = P.tbBlocksOf(t1, {}, '2026-10-18');
  eq('块按分钟升序：主段在前', blocks1[0].startMin, 7 * 60);
  eq('额外段起点分钟数', blocks1[1].startMin, 15 * 60);
  ok('所有段 isExtra 均为 false（不再分主次）',
    blocks1.every(function (b) { return b.isExtra === false; }));
  eq('额外段不占番茄数', blocks1[1].estPomos, 0);
  eq('额外段 deadline 为 null', blocks1[1].deadline, null);
  eq('块 key = 任务|日期|起始分钟', blocks1[0].key, '7|2026-10-18|420');
  eq('第二块 key 用它的起始分钟', blocks1[1].key, '7|2026-10-18|900');
  eq('首块 key = 最早那段（段平等，谁早谁是第一块）',
    P.tbPrimaryBlockKey(P.tbBlocksOf({
      id: 8, remindAt: '2026-10-18 15:00', estEnd: '2026-10-18 16:00',
      extraBlocks: [{ start: '2026-10-18 07:00', end: '2026-10-18 08:00' }]
    }, {}, '2026-10-18')), '8|2026-10-18|420');
  /* 只有额外段、没有主段：网格靠 todoHasAnyBlock 才收得住 */
  const t2 = { id: 9, extraBlocks: [{ start: '2026-10-19 09:00', end: '2026-10-19 10:00' }] };
  eq('无主段：那天仍有块', P.tbBlocksOf(t2, {}, '2026-10-19').length, 1);
  eq('无主段：首块日期取额外段', P.todoFirstBlockDate(t2), '2026-10-19');
  ok('无主段：todoHasAnyBlock 为真', P.todoHasAnyBlock(t2, '2026-10-19', '') === true);
  ok('无主段：别的日期没有块', P.todoHasAnyBlock(t2, '2026-10-20', '') === false);
  /* 重复计划：主段在初始日之后的第 3 天仍要出现（不能用 startDate === ds 判） */
  const rep = { id: 10, remindAt: '2026-10-18 07:00', estEnd: '2026-10-18 08:00',
    repeat: { mode: 'daily', last: '2026-10-18', next: '2026-10-22' } };
  eq('每天重复：第 3 天仍有主段块', P.tbBlocksOf(rep, {}, '2026-10-21').length, 1);
  eq('每天重复：起始日之前不画', P.tbBlocksOf(rep, {}, '2026-10-17').length, 0);
  /* 2026-10-19：一次性任务的段可以排在不同的天。以前 baseDate === ds 就全量返回、
     rawStart 一律写 ds，把"明天 08:00"冒领成"今天 08:00"。
     现在：非重复只给**自己那天**的段；重复仍整套平移。 */
  const multi = { id: 11, blocks: [
    { start: '2026-10-19 20:00', end: '2026-10-19 22:00' },
    { start: '2026-10-20 08:00', end: '2026-10-20 09:30' }
  ] };
  eq('跨天一次性：今天只有 1 段', P.tbBlocksOf(multi, {}, '2026-10-19').length, 1);
  eq('跨天一次性：今天那段是 20:00', P.tbBlocksOf(multi, {}, '2026-10-19')[0].startMin, 20 * 60);
  eq('跨天一次性：今天的 rawStart 日期仍是今天',
    P.tbBlocksOf(multi, {}, '2026-10-19')[0].rawStart, '2026-10-19 20:00');
  eq('跨天一次性：明天那段归明天', P.tbBlocksOf(multi, {}, '2026-10-20')[0].startMin, 8 * 60);
  eq('跨天一次性：明天的 rawStart 日期是明天',
    P.tbBlocksOf(multi, {}, '2026-10-20')[0].rawStart, '2026-10-20 08:00');
  eq('跨天一次性：没排段的那天没有块', P.tbBlocksOf(multi, {}, '2026-10-21').length, 0);
  const multiRep = { id: 12, repeat: { mode: 'daily', last: '2026-10-19', next: '2026-10-19' },
    blocks: [
      { start: '2026-10-19 20:00', end: '2026-10-19 22:00' },
      { start: '2026-10-20 08:00', end: '2026-10-20 09:30' }
    ] };
  const mr = P.tbBlocksOf(multiRep, {}, '2026-10-22');
  eq('跨天重复：整套平移到查看日（2 段）', mr.length, 2);
  eq('跨天重复：首段落到 22 日', mr[0].rawStart, '2026-10-22 20:00');
  eq('跨天重复：次段保持相对天差（23 日）', mr[1].rawStart, '2026-10-23 08:00');
  /* rawStart 的日期必须是**查看的那天**，否则快照/缓存会把它挂回首次排期日 */
  eq('每天重复：块上的原始日期跟着查看的那天走',
    P.tbBlocksOf(rep, {}, '2026-10-21')[0].rawStart, '2026-10-21 07:00');
  eq('每天重复：结束日期同样落在查看的那天',
    P.tbBlocksOf(rep, {}, '2026-10-21')[0].rawEnd.slice(0, 10), '2026-10-21');
  /* 历史快照：冻结结果直通，不再规范化 */
  const hist = {
    id: 11, _hist: 1,
    _histBlocks: [{ startMin: 900, endMin: 960, rawStart: '2026-10-18 23:55', rawEnd: '2026-10-18 23:59', isExtra: true, key: 'hist|x' }]
  };
  eq('历史块直通（即使只有 4 分钟也不被清洗掉）', P.tbBlocksOf(hist, {}, '2026-10-18')[0].endMin, 960);
}
/* 快照冻结：只有额外段的那天也要能存下来（否则计划一删，历史就少一块） */
{
  const t = { id: 21, title: '只有另排', extraBlocks: [{ start: '2026-10-18 15:00', end: '2026-10-18 16:00' }] };
  const sn = P.todoSchedSnapshotOf(t, '2026-10-18', {});
  ok('只有一段（没有提醒）的那天也能写快照', !!sn);
  eq('快照 blocks 含那一段', sn.blocks.length, 1);
  eq('快照块只存起止，不再带 isExtra', sn.blocks[0].start, '2026-10-18 15:00');
  const ps = P.todoSchedPseudoTodo(sn);
  eq('伪任务读回一个块', P.tbBlocksOf(ps, {}, '2026-10-18').length, 1);
  eq('读回的块起点不变', P.tbBlocksOf(ps, {}, '2026-10-18')[0].startMin, 900);
  /* 同一天主段 + 额外段 → 两个块都进快照 */
  const t3 = {
    id: 22, title: '两段',
    remindAt: '2026-10-18 07:00', estEnd: '2026-10-18 08:00', estEndManual: 1,
    extraBlocks: [{ start: '2026-10-18 15:00', end: '2026-10-18 16:00' }]
  };
  eq('快照冻结两个块', P.todoSchedSnapshotOf(t3, '2026-10-18', {}).blocks.length, 2);
  eq('旧快照（无 blocks）仍走单段兼容',
    P.tbBlocksOf(P.todoSchedPseudoTodo({ id: 23, remindAt: '2026-10-18 07:00', estEnd: '2026-10-18 08:00' }), {}, '2026-10-18').length, 1);
}

/* ===== 快照保留期：只留最近 3 年，过期日期与非日期键都裁掉 ===== */
{
  const T = '2026-10-18';
  const cutoff = P.addDaysStr(T, -P.TODO_SCHED_LOG_KEEP_DAYS);
  const oldDay = P.addDaysStr(cutoff, -1);
  const log = {};
  log[oldDay] = [{ id: 1 }];
  log['2020-01-01'] = [{ id: 2 }];
  log[cutoff] = [{ id: 3 }];
  log[T] = [{ id: 4 }];
  log['not-a-date'] = [{ id: 5 }];
  const r = P.pruneTodoSchedLog(log, T);
  ok('保留期：过期日期被删', !r.log[oldDay] && r.changed);
  ok('保留期：边界当天保留', !!r.log[cutoff]);
  ok('保留期：今天保留', !!r.log[T]);
  ok('保留期：非日期键丢弃', !r.log['not-a-date']);
  eq('保留期：无变化时原样返回', P.pruneTodoSchedLog({ '2026-10-18': [] }, T).log, { '2026-10-18': [] });
  eq('保留期：无变化 changed=false', P.pruneTodoSchedLog({ '2026-10-18': [] }, T).changed, false);
  eq('保留期：非对象入参不炸', P.pruneTodoSchedLog('x', T).changed, false);
  eq('保留期：非法今天不裁', P.pruneTodoSchedLog({ '2020-01-01': [] }, 'x').changed, false);
}

/* ===== 重复计划的「按天单独排期」dayPlan ===== */
{
  const D = '2026-10-19';
  const rep = { mode: 'daily', last: D, next: '2026-10-20' };
  const mk = (extra) => Object.assign({
    id: 90, title: '每天', done: false, pomodoros: 1,
    repeat: JSON.parse(JSON.stringify(rep)),
    blocks: [{ start: D + ' 21:00', end: D + ' 21:30' }]
  }, extra || {});
  const S = {};

  eq('dayPlan：没有覆盖时不凭空冒出',
    P.todoDayPlanOn(mk(), D), []);
  eq('dayPlan：非对象入参不炸', P.todoDayPlanOn(null, D), []);

  const t = mk({ dayPlan: { '2026-10-20': [{ start: '2026-10-20 19:00', end: '2026-10-20 19:40' }] } });
  eq('dayPlan：那天只有覆盖这一段（模板 21:00 被整组替换）',
    P.tbBlocksOf(t, S, '2026-10-20').map((b) => b.startMin), [19 * 60]);
  eq('dayPlan：没被覆盖的日子仍按模板',
    P.tbBlocksOf(t, S, D).map((b) => b.startMin), [21 * 60]);
  eq('dayPlan：rawStart 的日期是覆盖那天',
    P.tbBlocksOf(t, S, '2026-10-20')[0].rawStart, '2026-10-20 19:00');
  eq('dayPlan：块上带着模板的标题/番茄数',
    P.tbBlocksOf(t, S, '2026-10-20')[0].estPomos, 1);

  ok('dayPlan：覆盖日算「有块的日子」',
    P.todoBlockDates(mk({ dayPlan: { '2026-10-22': [{ start: '2026-10-22 08:00', end: '2026-10-22 08:30' }] } }), S)
      .indexOf('2026-10-22') >= 0);
  ok('dayPlan：覆盖日算「这天有块」',
    P.todoHasAnyBlock(mk({ dayPlan: { '2026-10-22': [{ start: '2026-10-22 08:00', end: '2026-10-22 08:30' }] } }), '2026-10-22'));

  /* 清洗：脏键、跨天段、非法日期 */
  const dirty = mk({
    dayPlan: {
      '2026-10-21': [
        { start: '2026-10-21 08:00', end: '2026-10-21 08:30' },
        { start: '2026-10-22 09:00', end: '2026-10-22 09:30' },
        { start: '2026-10-21 10:00', end: '2026-10-21 09:00' }
      ],
      '2026-13-01': [{ start: '2026-13-01 08:00', end: '2026-13-01 08:30' }],
      'x': [{ start: '2026-10-21 08:00', end: '2026-10-21 08:30' }]
    }
  });
  eq('dayPlan：跨天段 / 反向段 / 非法日期键都被洗掉',
    Object.keys(P.todoDayPlanNormAll(dirty)), ['2026-10-21']);
  eq('dayPlan：越过上限的日期被截断',
    Object.keys(P.todoDayPlanNormAll(mk({
      dayPlan: Object.fromEntries(Array.from({ length: 70 }, (_, i) => {
        const _d = P.addDaysStr(D, i + 1);
        return [_d, [{ start: _d + ' 08:00', end: _d + ' 08:30' }]];
      }))
    }))).length, P.TODO_DAYPLAN_MAX_DAYS);

  /* 边角：这些分支不测就会让「未进入分支块」一路涨（门禁按棘轮卡） */
  eq('dayPlan：日期传空 → 没有覆盖', P.todoDayPlanOn(mk(), ''), []);
  eq('dayPlan：日期传空 → 也没有块', P.tbBlocksOf(mk(), S, ''), []);
  eq('dayPlan：空段数组的日期不算覆盖日',
    Object.keys(P.todoDayPlanNormAll(mk({ dayPlan: { '2026-10-22': [] } }))), []);
  eq('dayPlan：起止缺一方的段被丢掉，那天回落到模板',
    P.tbBlocksOf(mk({ dayPlan: { '2026-10-22': [{ start: '2026-10-22 08:00', end: '' }] } }), S, '2026-10-22')
      .map((b) => b.startMin), [21 * 60]);
  ok('dayPlan：null 计划没有块', P.todoHasAnyBlock(null, D) === false);
  eq('dayPlan：null 计划取块 → 空', P.tbBlocksOf(null, S, D), []);
  eq('dayPlan：dayPlan 被写成字符串也不炸', P.todoDayPlanOn({ dayPlan: 'x' }, D), []);
  eq('dayPlan：dayPlan 里塞 null 的那天被跳过',
    Object.keys(P.todoDayPlanNormAll({ dayPlan: { '2026-10-23': null } })), []);
  ok('dayPlan：历史伪任务的日期取自冻结块',
    P.todoBlockDates(P.todoSchedPseudoTodo({
      id: 91,
      blocks: [{ start: '2026-10-10 08:00', end: '2026-10-10 08:30' }]
    }), S).indexOf('2026-10-10') >= 0);

  /* 快照：历史伪任务永远不读今天的覆盖 */
  /* 伪任务只认自己冻结的 blocks：即便 t 后来又被加了别的覆盖，这一天也不变 */
  const frozen = P.todoSchedPseudoTodo({
    id: 90,
    blocks: P.tbBlocksOf(t, S, '2026-10-20').map((b) => ({ start: b.rawStart, end: b.rawEnd }))
  });
  t.dayPlan['2026-10-20'] = [{ start: '2026-10-20 23:00', end: '2026-10-20 23:30' }];
  eq('dayPlan：历史快照不受后来覆盖影响',
    P.tbBlocksOf(frozen, S, '2026-10-20')[0].startMin, 19 * 60);
}

/* —— 数据契约：newUid（同步主键） —— */
{
  const a = P.newUid('rec'), b = P.newUid('rec');
  ok('newUid 带前缀', a.indexOf('rec_') === 0);
  ok('newUid 两次不同（同毫秒也不撞）', a !== b);
  ok('newUid 形状：prefix_时间_随机', /^rec_[0-9a-z]+_[0-9a-z]{6}$/.test(a));
  ok('newUid 无前缀也能用', P.newUid().indexOf('x_') === 0);
  /* 设备短码分支：浏览器里 window.__deviceTag 存在时要拼到尾部（多端撞车概率再降一档）。
     Node 下没有 window，这里临时挂一个再摘掉。 */
  const _w = global.window;
  global.window = { __deviceTag: 'ab12' };
  ok('newUid 带上设备短码', /_ab12$/.test(P.newUid('rec')));
  global.window = _w;
}

/* —— 数据契约：normMemo 必须原样透传 uid / updatedAt ——
   它会重建对象；不透传等于每条备忘一发出去就把同步主键洗掉，之后被当成新记录反复创建。 */
{
  const m = P.normMemo({ id: 'm1', text: 'hi', ts: 1000, uid: 'memo_abc_xyz', updatedAt: 2000 });
  eq('normMemo 保留 uid', m && m.uid, 'memo_abc_xyz');
  eq('normMemo 保留 updatedAt', m && m.updatedAt, 2000);
  const noUid = P.normMemo({ id: 'm2', text: 'hi', ts: 1000 });
  ok('normMemo 老数据不凭空造 uid（迁移统一负责）', noUid && noUid.uid === undefined);
  const badTs = P.normMemo({ id: 'm3', text: 'hi', ts: 1000, uid: 'memo_x', updatedAt: 'oops' });
  ok('normMemo 脏 updatedAt 直接丢掉，不写进对象', badTs && badTs.updatedAt === undefined);
  const nanTs = P.normMemo({ id: 'm4', text: 'hi', ts: 1000, uid: 'memo_y', updatedAt: NaN });
  ok('normMemo updatedAt=NaN 也丢掉（isFinite 兜底）', nanTs && nanTs.updatedAt === undefined);
}

/* —— 同步合并规则（接后端时最容易写错、又最难在浏览器复现的一段） —— */
{
  eq('lwwPick：两端都空 → same', P.lwwPick(null, null), 'same');
  eq('lwwPick：只有远端 → remote', P.lwwPick(null, { updatedAt: 1 }), 'remote');
  eq('lwwPick：远端更新 → remote', P.lwwPick({ updatedAt: 10 }, { updatedAt: 20 }), 'remote');
  eq('lwwPick：本地更新 → local', P.lwwPick({ updatedAt: 30 }, { updatedAt: 20 }), 'local');
  eq('lwwPick：时间相同 → same（不抖）', P.lwwPick({ updatedAt: 5 }, { updatedAt: 5 }), 'same');
  eq('lwwPick：缺 updatedAt 当 0', P.lwwPick({}, { updatedAt: 1 }), 'remote');

  /* 合并：新增 / 覆盖 / 跳过 / 墓碑 */
  const local = [
    { uid: 'rec_a', v: 'L-a', updatedAt: 100 },
    { uid: 'rec_b', v: 'L-b', updatedAt: 300 },
    { v: 'no-uid-legacy' }
  ];
  const remote = [
    { uid: 'rec_a', v: 'R-a', updatedAt: 200 },   /* 远端更新 → 覆盖 */
    { uid: 'rec_b', v: 'R-b', updatedAt: 100 },   /* 本地更新 → 跳过 */
    { uid: 'rec_c', v: 'R-c', updatedAt: 50 },    /* 本地没有 → 新增 */
    { uid: 'rec_d', v: 'R-d', updatedAt: 999 },   /* 在墓碑里 → 丢弃 */
    { v: 'bad' }                                   /* 缺 uid → 丢弃 */
  ];
  const m = P.mergeRemoteRecords(local, remote, [{ uid: 'rec_d', deletedAt: 1 }]);
  eq('合并：新增 1 条', m.added, 1);
  eq('合并：覆盖 1 条', m.updated, 1);
  /* 跳过 3 = 本地更新 1 + 墓碑 1 + 缺 uid 1（远端脏数据不算新增） */
  eq('合并：跳过 3 条（本地更新 + 墓碑 + 缺 uid）', m.skipped, 3);
  const byUid = {};
  m.list.forEach((r) => { if (r.uid) byUid[r.uid] = r.v; });
  eq('合并：远端更新赢', byUid.rec_a, 'R-a');
  eq('合并：本地更新保留', byUid.rec_b, 'L-b');
  eq('合并：新记录进来', byUid.rec_c, 'R-c');
  eq('合并：墓碑里的不进本地', byUid.rec_d, undefined);
  ok('合并：无 uid 的本地老记录原样保留', m.list.some((r) => r.v === 'no-uid-legacy'));

  /* 本地已被墓碑标记的，要在合并时被移除（另一端删的，这边跟着删） */
  const m2 = P.mergeRemoteRecords([{ uid: 'rec_x', updatedAt: 1 }], [], [{ uid: 'rec_x', deletedAt: 2 }]);
  eq('合并：远端墓碑删掉本地记录', m2.list.length, 0);

  /* 纯函数：不许改入参 */
  const srcLocal = [{ uid: 'rec_z', v: 'orig', updatedAt: 1 }];
  P.mergeRemoteRecords(srcLocal, [{ uid: 'rec_z', v: 'new', updatedAt: 9 }], []);
  eq('合并：不修改传入的本地数组', srcLocal[0].v, 'orig');

  /* 墓碑并集 */
  const tb = P.mergeTombstoneLists(
    [{ uid: 'a', deletedAt: 10 }, { uid: 'b', deletedAt: 20 }],
    [{ uid: 'a', deletedAt: 30 }, { uid: 'c', deletedAt: 5 }], 2000);
  eq('墓碑并集：三条', tb.length, 3);
  eq('墓碑并集：同 uid 取更晚', tb.filter((x) => x.uid === 'a')[0].deletedAt, 30);
  eq('墓碑并集：空入参不炸', P.mergeTombstoneLists(null, undefined, 0).length, 0);

  /* 变更队列：同 uid 合并且移到末尾（末尾 = 最新） */
  let box = [];
  box = P.outboxMerge(box, 'rec_1', 'record', 'upsert', 100, 2000);
  box = P.outboxMerge(box, 'rec_2', 'record', 'upsert', 101, 2000);
  box = P.outboxMerge(box, 'rec_1', 'record', 'upsert', 102, 2000);
  eq('队列：同 uid 不重复', box.length, 2);
  eq('队列：最新一条在末尾', box[box.length - 1].uid, 'rec_1');
  eq('队列：时间被刷新', box[box.length - 1].at, 102);
  box = P.outboxMerge(box, 'rec_1', 'record', 'delete', 103, 2000);
  eq('队列：删除覆盖同 uid 的 upsert', box[box.length - 1].op, 'delete');
  /* 上限裁剪：留最近的 */
  let cap = [];
  for (let i = 0; i < 5; i++) cap = P.outboxMerge(cap, 'rec_' + i, 'record', 'upsert', i, 3);
  eq('队列：超上限裁最旧', cap.length, 3);
  eq('队列：留下的是最近三条', cap.map((x) => x.uid).join(','), 'rec_2,rec_3,rec_4');
}

/* —— 同步合并的边角：空值 / 脏元素 / 裁剪 —— */
{
  eq('lwwPick：只有本地 → local', P.lwwPick({ updatedAt: 1 }, null), 'local');
  eq('lwwPick：本地不是对象 → remote', P.lwwPick('x', { updatedAt: 1 }), 'remote');
  eq('合并：null 元素不炸', P.mergeRemoteRecords([null, { uid: 'rec_q', updatedAt: 1 }], null, null).list.length, 1);
  eq('合并：远端 null 元素被跳过', P.mergeRemoteRecords([], [null, { uid: 'rec_w', updatedAt: 1 }], []).added, 1);
  eq('墓碑并集：cap 生效留最近', P.mergeTombstoneLists(
    [{ uid: 'a', deletedAt: 1 }, { uid: 'b', deletedAt: 2 }, { uid: 'c', deletedAt: 3 }], [], 2).map((x) => x.uid).join(','), 'b,c');
  eq('队列：cap 传 0 退回默认 2000', P.outboxMerge([], 'rec_z', 'record', 'upsert', 1, 0).length, 1);
  eq('队列：同 uid 用字符串比较（数字/字符串混用也能合并）',
    P.outboxMerge([{ uid: '123', kind: 'rec', op: 'upsert', at: 1 }], 123, 'rec', 'upsert', 2, 2000).length, 1);

  /* 入参不是数组：全部退回空集合，不许抛（同步层会在「首次运行、字段还没建」时传进来） */
  eq('合并：本地列表非数组 → 当空', P.mergeRemoteRecords(null, [{ uid: 'rec_n', updatedAt: 1 }], []).added, 1);
  eq('合并：墓碑数组里的脏元素被跳过', P.mergeRemoteRecords([{ uid: 'rec_m', updatedAt: 1 }], [], [null, {}, { uid: 'rec_m', deletedAt: 9 }]).list.length, 0);
  eq('墓碑并集：同 uid 更晚的带 kind 会覆盖', P.mergeTombstoneLists(
    [{ uid: 'k', deletedAt: 1, kind: 'record' }], [{ uid: 'k', deletedAt: 2, kind: 'todo' }], 0)[0].kind, 'todo');
  eq('队列：list 非数组也能起队', P.outboxMerge(null, 'rec_a', 'record', 'upsert', 1, 2000).length, 1);
  eq('队列：数组里的 null 元素不会让匹配炸',
    P.outboxMerge([null, { uid: 'rec_b', kind: 'record', op: 'upsert', at: 1 }], 'rec_b', 'record', 'upsert', 2, 2000).length, 2);
}

/* ==================================================================
 * 习惯成长点（2026-11-08 重写为纯函数 habitGrowthPoints）
 * 起因（用户原话）：「我那种间隔式的打卡，为什么我的成长点一直是 0 呢？」
 * 老实现 degradeHabits 两处病根：
 *   ① 只看「最后打卡日 → 今天」的自然日间隔扣分，不看 repeat ——
 *      每周一/三/五/日的习惯，周二周四本来不该做，照样算欠账；每隔 N 天几乎天天欠账。
 *   ② 没有「今天已结算」的锚点 —— 每打开一次 App 就把同一个缺口再扣一遍。
 *      一次打卡 +1、打开一次扣 5，于是恒为 0。
 * 日期锚点：2026-11-02 周一 / 11-04 周三 / 11-06 周五 / 11-08 周日。
 * ================================================================== */
var _hMon = { name: '习惯A', createdAt: '2026-11-02', repeat: { mode: 'weekly', weekdays: [1] } };
/* ★ 核心回归：每周只做周一，11-02 打了一次，11-04 看 —— 老代码 gap=2 扣 2 分 → 0 */
eq('成长点·每周一：只打了周一，周三仍看得见 1 分（老代码是 0）',
  P.habitGrowthPoints(_hMon, ['2026-11-02'], '2026-11-04'), 1);
/* ★ 间隔式：每隔 3 天，11-01 打了一次，11-04 看 —— 老代码 gap=3 扣 5 分 → 0 */
eq('成长点·每隔3天：只打了锚点那天，第 3 天仍看得见 1 分（老代码是 0）',
  P.habitGrowthPoints({ createdAt: '2026-11-01', repeat: { mode: 'interval', interval: 3 } },
    ['2026-11-01'], '2026-11-04'), 1);
/* ★ 幂等：同一个数开几次都一样（老代码是每开一次少一点） */
eq('成长点·幂等（连算 3 次同值）',
  (function () {
    var a = P.habitGrowthPoints(_hMon, ['2026-11-02'], '2026-11-04');
    var b = P.habitGrowthPoints(_hMon, ['2026-11-02'], '2026-11-04');
    var c = P.habitGrowthPoints(_hMon, ['2026-11-02', '2026-11-02'], '2026-11-04');
    return a === b && b === c ? 1 : [a, b, c];
  })(), 1);
/* 每天型：连打 3 天 = 3 次 + 2 次连击 */
eq('成长点·每天型连打 3 天 = 3+2',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['2026-11-01', '2026-11-02', '2026-11-03'], '2026-11-03'), 5);
/* 漏一天：连打 3 天(+5) 后漏 11-04，11-05 看 → 扣 2 */
eq('成长点·漏一个应做日扣 1',
  P.habitGrowthPoints({ createdAt: '2026-11-01' },
    ['2026-11-01', '2026-11-02', '2026-11-03'], '2026-11-05'), 4);
/* 今天还没过完：今天该做但没做，不扣 */
eq('成长点·今天没打卡不扣（时间还没到）',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['2026-11-01'], '2026-11-02'), 1);
/* 跳过日：不欠账 */
eq('成长点·跳过日不扣分',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['2026-11-01'], '2026-11-03', ['2026-11-02']), 1);
/* 非该做日也打卡：照样 +1（加练不是欠账） */
eq('成长点·非该做日补卡也 +1',
  P.habitGrowthPoints(_hMon, ['2026-11-02', '2026-11-03'], '2026-11-03'), 2);
/* 连击只跨「该做日」：周一 + 下周一 都做了 = 2 + 1(连击) */
eq('成长点·每周一命中两次含连击 = 3',
  P.habitGrowthPoints(_hMon, ['2026-11-02', '2026-11-09'], '2026-11-09'), 3);
/* 久不打卡扣到 0 为止，不会成负数 */
eq('成长点·长期不打卡最低到 0（不为负）',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['2026-11-01'], '2026-11-07'), 0);
/* 脏数据不崩 */
eq('成长点·空习惯/空记录/坏日期 → 0',
  [P.habitGrowthPoints(null, null, 'bad'), P.habitGrowthPoints({}, null, '2026-11-04')], [0, 0]);
eq('成长点·记录里的坏日期被忽略',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['bad', '2026-11-01'], '2026-11-01'), 1);
/* 配额型：整周结算 —— 做满一周 +1（10-26 那周做了 2 次，目标 2） */
eq('成长点·配额型做满一周 = 2 次打卡 + 1 周奖励',
  P.habitGrowthPoints({ createdAt: '2026-10-26', freqPerWeek: 2 }, ['2026-10-26', '2026-10-28'], '2026-11-02'), 3);
eq('成长点·配额型缺 2 次扣 2（缺几次扣几分，做一次能抵一次）',
  P.habitGrowthPoints({ createdAt: '2026-10-26', freqPerWeek: 3 }, ['2026-10-26'], '2026-11-02'), 0);
/* 创建日之前不背欠账 */
eq('成长点·创建日之前的空白不算欠账',
  P.habitGrowthPoints({ createdAt: '2026-11-03' }, [], '2026-11-04'), 0);


/* 成长点：边界与分支补测（cov 门禁要求新增分支都有用例，别留白） */
eq('成长点·记录全在未来 → 0（起点还没到）',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['2026-12-01'], '2026-11-04'), 0);
eq('成长点·配额型跳过日不进"漏了多少"',
  P.habitGrowthPoints({ createdAt: '2026-10-26', freqPerWeek: 1 },
    ['2026-10-26'], '2026-11-02', ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']), 2);
eq('成长点·配额型 + 记录跨多周（每满一周都有奖励）',
  P.habitGrowthPoints({ createdAt: '2026-10-05', freqPerWeek: 1 },
    ['2026-10-05', '2026-10-12', '2026-10-19'], '2026-10-26'), 3 + 3);
eq('成长点·该做日的跳过不算断链（连击保持）',
  P.habitGrowthPoints({ createdAt: '2026-11-01' },
    ['2026-11-01', '2026-11-03'], '2026-11-03', ['2026-11-02']), 3);
eq('成长点·十年内正常返回（不空转）',
  typeof P.habitGrowthPoints({ createdAt: '2016-01-01' }, ['2016-01-01'], '2026-11-04'), 'number');
eq('成长点·today 带时间戳也能认',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['2026-11-01'], '2026-11-01T09:00:00'), 1);
/* 成长点：分支补测二（未来记录不进分子、周中起算、周中间的日子跳过） */
eq('成长点·未来那笔打卡不算进分子',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['2026-11-01', '2026-11-09'], '2026-11-02'), 1);
eq('成长点·配额型从周中开始（当周只数已过的日子）',
  P.habitGrowthPoints({ createdAt: '2026-10-28', freqPerWeek: 1 }, ['2026-10-28'], '2026-11-02'), 2);
eq('成长点·配额型周末那几天还没到，不算漏',
  P.habitGrowthPoints({ createdAt: '2026-10-26', freqPerWeek: 2 }, ['2026-10-26'], '2026-10-28'), 1);
/* 追诉期：90 天以外的漏做不再扣分（否则坚持一年也会被"三个月前断过"永久压 0）。
   构造：6-01 起过（随后大段断档，全在窗口外，不追究），8-06 起到今天每天打满。
   8-06~11-04 = 91 天：91 次 + 90 次连击 = 181，再加 6-01 那一次 = 182，窗口内没有漏做 → 182。 */
/* ★ 用 P.getDateStr 生成（本地日期）。toISOString 在 +08 时区会把本地零点算成前一天，
   以前这里就悄悄少了一天，用例数字全靠手算对不上。 */
var _gpRun = (function () {
  var out = ['2026-06-01'];
  var d = new Date(2026, 7, 6);
  var end = new Date(2026, 10, 4);
  while (d <= end) { out.push(P.getDateStr(d)); d.setDate(d.getDate() + 1); }
  return out;
})();
/* 连续做满：首日 +1，之后每个该做日都吃到连击 +2 → 91 天 = 1 + 90*2 = 181 */
eq('成长点·连续做满 91 天 = 1 + 90×2',
  P.habitGrowthPoints({ createdAt: '2026-06-01' }, _gpRun, '2026-11-04'), 181);
/* 中间空掉 7 个该做日（> 3）→ 断更重置，只剩最后一天 = 1 */
eq('成长点·中途空一周 = 断更重置，只从最近一段算',
  P.habitGrowthPoints({ createdAt: '2026-06-01' }, _gpRun.filter(function (x) { return x < '2026-10-28' || x > '2026-11-03'; }), '2026-11-04'), 1);
/* 只空 2 个该做日（< 3）→ 不断更，扣 2 分 */
/* 漏 2 天（< 3）：不断更，分数仍在高位；扣分 = 2 天欠账 + 连击中断的连带损失。
   这里只锁性质（没被清零、比满分低），不去锁死具体常数 —— 常数会随扣分力度调整而变。 */
(function () {
  var v = P.habitGrowthPoints({ createdAt: '2026-06-01' },
    _gpRun.filter(function (x) { return x !== '2026-10-30' && x !== '2026-10-31'; }), '2026-11-04');
  eq('成长点·只漏 2 天不断更（不被清零）', v > 150, true);
  eq('成长点·只漏 2 天比满分低', v < 181, true);
})();

/* 分支补测三：配额整周做满的加分行、不该做日额外打卡、脏 today */
eq('成长点·配额型整周做满给连击奖励（加分不是只从打卡来）',
  P.habitGrowthPoints({ createdAt: '2026-10-05', freqPerWeek: 2 },
    ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14'], '2026-10-19'), 4 + 2);
eq('成长点·不该做的日子打卡也 +1（额外做的）',
  P.habitGrowthPoints({ createdAt: '2026-11-02', repeat: { mode: 'weekly', weekdays: [1] } },
    ['2026-11-02', '2026-11-04'], '2026-11-04'), 2);
eq('成长点·today 是脏值 → 0（不抛错）',
  P.habitGrowthPoints({ createdAt: '2026-11-01' }, ['2026-11-01'], 'abc'), 0);

/* 间隔型（每隔 N 天）：按相邻打卡间隔结算，不按锚点网格 ——
   ★ 回归：用户真实症状「每隔 3 天规律打，成长点一直是 0」。
   打卡日与锚点网格差一天时，老实现把它们全判成漏做，3 连漏就断更清零。 */
(function () {
  var ds = [];
  for (var i = 0; i < 10; i++) { ds.push(P.addDaysStr('2026-09-01', i * 3)); }
  eq('成长点·每隔3天准时打10次 = 10 + 9 连击',
    P.habitGrowthPoints({ createdAt: '2026-09-01', repeat: { mode: 'interval', interval: 3, anchor: '2026-08-31' } }, ds, '2026-10-05'), 19);
  /* 迟到 = 欠一次(−1) + 打一次(+1) = 净 0，且不给连击；首日算 1 分，后两次都迟到 → 1 */
  eq('成长点·每隔3天迟到到 5 天 → 迟到那几次净 0',
    P.habitGrowthPoints({ createdAt: '2026-09-01', repeat: { mode: 'interval', interval: 3 } },
      ['2026-09-01', '2026-09-06', '2026-09-11'], '2026-09-20'), 1);
  eq('成长点·每隔3天断更两个月 → 只从最近一次算',
    P.habitGrowthPoints({ createdAt: '2026-09-01', repeat: { mode: 'interval', interval: 3 } },
      ['2026-09-01', '2026-09-04', '2026-11-01'], '2026-11-05'), 1);
})();

/* 间隔型自适应网格（2026-11-08）——锁住「规律打卡 ≠ 天天欠账」这个口径 */
(function () {
  var logs = [];
  for (var i = 0; i < 10; i++) { logs.push(P.addDaysStr('2026-09-01', i * 3)); }
  var h = { createdAt: '2026-09-01', repeat: { mode: 'interval', interval: 3 } };
  eq('间隔·打卡日自己一定算该做', P.habitDueOn(h, '2026-09-04', {}, logs), true);
  eq('间隔·打卡之间的空档不虚增该做日', P.habitDueOn(h, '2026-09-05', {}, logs), false);
  var st = P.habitStats(h, logs, '2026-10-05', 30);
  eq('间隔·30 天窗口内 8 次打卡 / 10 个该做点 → 80%', st.rate, 0.8);
  eq('间隔·连续 = 10（含窗口外的）', st.cur, 10);
  eq('间隔·漏一次只少一天连续，不是清零',
    P.habitCurrentStreak(['2026-09-01', '2026-09-04', '2026-09-13'], '2026-09-14', h), 1);
  eq('间隔·自己空格太久 → 断更归零',
    P.habitCurrentStreak(['2026-09-01'], '2026-10-05', h), 0);
  var plan = P.habitIntervalPlan(['2026-09-01', '2026-09-20'], 3, {}, '2026-09-21');
  eq('间隔·长空档即使 9 天也只标到 3 个漏点（断更不再累积）',
    Object.keys(plan.miss).length, 3);
})();

/* 间隔网格的边角：脏日期、跳过日、无记录、超期、窗口起点 */
(function () {
  var h = { createdAt: '2026-09-01', repeat: { mode: 'interval', interval: 3 } };
  var p0 = P.habitIntervalPlan([], 3, {}, '2026-09-10');
  eq('间隔网格·无记录 → 空计划', Object.keys(p0.due).length + Object.keys(p0.miss).length, 0);
  var p1 = P.habitIntervalPlan(['', 'abc', '2026-13-45'], 3, {}, '2026-09-10');
  eq('间隔网格·全是脏日期 → 空计划', Object.keys(p1.due).length, 0);
  var p2 = P.habitIntervalPlan(['2026-09-01', '2026-09-20'], 0, {}, '2026-09-21');
  eq('间隔网格·interval 写 0 当 1 天处理（不除零）', Object.keys(p2.miss).length, 3);
  var p3 = P.habitIntervalPlan(['2026-09-01', '2026-09-20'], 3, { '2026-09-04': true }, '2026-09-21');
  eq('间隔网格·跳过日不进漏点', !!p3.miss['2026-09-04'], false);
  var p4 = P.habitIntervalPlan(['2026-09-01', '2026-09-20'], 3, {}, 'bogus');
  eq('间隔网格·upto 是脏值 → 最后一条打卡日兜底', Object.keys(p4.miss).length, 3);
  /* 最后一次打卡 9-04，到 10-05 早已超期：只标 3 个漏点（断更后不再累积欠账） */
  eq('间隔·expected 只算 3 个漏点（断更封顶）',
    P.habitExpectedIn(h, '2026-10-05', 30, {}, ['2026-09-01', '2026-09-04']), 3);
  var st2 = P.habitStats(h, ['2026-09-01', '2026-09-04', '2026-09-07'], '2026-09-08', 30, ['2026-09-04']);
  eq('间隔·统计里跳过日不算打卡', st2.done, 2);
  eq('间隔·只有一次打卡 → 连续 1',
    P.habitCurrentStreak(['2026-09-01'], '2026-09-02', h), 1);
  eq('间隔·没有打卡 → 连续 0', P.habitCurrentStreak([], '2026-09-02', h), 0);
})();

/* 成长点·间隔型的三条分支（只有1次打卡 / 迟到 / 未来打卡） */
(function () {
  var h = { createdAt: '2026-09-01', repeat: { mode: 'interval', interval: 3 } };
  eq('间隔成长点·只有一次打卡 = 1', P.habitGrowthPoints(h, ['2026-09-01'], '2026-09-02'), 1);
  eq('间隔成长点·迟到（隔 5 天 > 3）净 0，不给迟到分',
    P.habitGrowthPoints(h, ['2026-09-01', '2026-09-06'], '2026-09-07'), 1);
  eq('间隔成长点·未来那笔不算', P.habitGrowthPoints(h, ['2026-09-01', '2026-12-01'], '2026-09-02'), 1);
  eq('间隔成长点·断更后重来 = 1',
    P.habitGrowthPoints(h, ['2026-09-01', '2026-09-04', '2026-12-01'], '2026-12-02'), 1);
})();

/* 间隔型最长连续（2026-11-08） */
(function () {
  var h = { createdAt: '2026-09-01', repeat: { mode: 'interval', interval: 3 } };
  var ds = [];
  for (var i = 0; i < 10; i++) { ds.push(P.addDaysStr('2026-09-01', i * 3)); }
  eq('间隔·最长连续 = 全部 10 次', P.habitStats(h, ds, '2026-10-05', 60).best, 10);
  eq('间隔·中间断一次 → 最长只在断点前',
    P.habitStats(h, ['2026-09-01', '2026-09-04', '2026-09-20', '2026-09-23'], '2026-09-25', 60).best, 2);
  eq('间隔·没有记录 → 最长 0', P.habitBestStreak([], h), 0);
})();

/* ===== 习惯的「单独某天」h.dayPlan（2026-11-09）=====
   和计划 t.dayPlan 同一条语义：这天有覆盖 → 整组替换规则时段；没有 → 规则时段照旧。
   这里锁住三件事：覆盖优先、覆盖日不受「今天该不该做」限制、脏数据只少画不炸。 */
{
  const D = '2026-11-10';
  const rule = { start: '07:00', end: '08:00' };
  const mk = (extra) => Object.assign({ id: 1, name: '习惯A', timeBlocks: [rule] }, extra || {});

  eq('习惯单日：没排过 → 空', P.habitDayPlanOn(mk(), D), []);
  eq('习惯单日：入参 null 不炸', P.habitDayPlanOn(null, D), []);
  eq('习惯单日：日期传空 → 空', P.habitDayPlanOn(mk({ dayPlan: { [D]: [{ start: D + ' 06:00', end: D + ' 06:30' }] } }), ''), []);
  eq('习惯单日：dayPlan 被写成字符串不炸', P.habitDayPlanOn({ dayPlan: 'x' }, D), []);

  const ov = mk({ dayPlan: { [D]: [{ start: D + ' 06:00', end: D + ' 06:30' }] } });
  eq('习惯单日：那天按覆盖的钟点画（不是规则时段）',
    P.habitBlocksOn(ov, D).map((b) => b.start + '-' + b.end), ['06:00-06:30']);
  eq('习惯单日：没覆盖的日子还是规则时段',
    P.habitBlocksOn(ov, '2026-11-11').map((b) => b.start), ['07:00']);
  ok('习惯单日：覆盖日不问「今天该不该做」—— 手排的那天就是要做',
    P.habitBlocksOn(mk({
      repeat: { mode: 'weekly', weekdays: [3] },
      dayPlan: { '2026-11-10': [{ start: '2026-11-10 06:00', end: '2026-11-10 06:30' }] }
    }), '2026-11-10').length === 1);
  eq('习惯单日：规则时段该做才画（周二不在每周三里）',
    P.habitBlocksOn(mk({ repeat: { mode: 'weekly', weekdays: [3] } }), D), []);
  eq('习惯单日：跳过日仍然不画规则时段',
    P.habitBlocksOn(mk(), D, { [D]: true }), []);

  /* 清洗：跨天段 / 反向段 / 非法日期键 / 空数组那天 */
  const dirty = mk({
    dayPlan: {
      [D]: [
        { start: D + ' 06:00', end: D + ' 06:30' },
        { start: '2026-11-12 06:00', end: '2026-11-12 06:30' },
        { start: D + ' 09:00', end: D + ' 08:00' }
      ],
      '2026-13-01': [{ start: '2026-13-01 08:00', end: '2026-13-01 08:30' }],
      x: [{ start: D + ' 08:00', end: D + ' 08:30' }],
      '2026-11-13': []
    }
  });
  eq('习惯单日：脏数据只留合法那天', Object.keys(P.habitDayPlanNormAll(dirty)), [D]);
  eq('习惯单日：一天最多 60 天（超出的截断）', Object.keys(P.habitDayPlanNormAll(mk({
    dayPlan: Object.fromEntries(Array.from({ length: 70 }, (_, i) => {
      const _d = P.addDaysStr(D, i);
      return [_d, [{ start: _d + ' 08:00', end: _d + ' 08:30' }]];
    }))
  }))).length, P.HABIT_DAYPLAN_MAX_DAYS);
  eq('习惯单日：数组形状的 dayPlan 不炸', P.habitDayPlanNormAll({ dayPlan: [] }), {});
  /* 入参兜底分支：不测就会让「未进入分支块」往上涨（门禁按棘轮卡） */
  eq('习惯单日：null 习惯没有段', P.habitBlocksOn(null, D), []);
  eq('习惯单日：日期传 null → 空', P.habitDayPlanOn(mk(), null), []);
  eq('习惯单日：多段覆盖按开始时间升序',
    P.habitBlocksOn(mk({ dayPlan: { [D]: [
      { start: D + ' 09:00', end: D + ' 09:30' },
      { start: D + ' 06:00', end: D + ' 06:30' }
    ] } }), D).map((b) => b.start), ['06:00', '09:00']);
  eq('通用清洗：入参不是对象 → 空', P.dayPlanNormAll('x', 5), {});
  eq('通用清洗：maxDays 是脏值 → 用默认上限',
    Object.keys(P.dayPlanNormAll({ [D]: [{ start: D + ' 06:00', end: D + ' 06:30' }] }, 'abc')), [D]);
}

console.log(`\nunit_pure: PASS ${pass}  FAIL ${fail}`);
process.exit(fail ? 1 : 0);
