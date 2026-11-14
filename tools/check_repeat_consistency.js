#!/usr/bin/env node
/**
 * repeat_consistency —— 重复判定一致性门禁（D1）
 *
 * 为什么要有这一段
 * ----------------
 * 「某天该不该做这件事」在这套代码里有两份实现：
 *   ① habitDueOn()      —— 完整版：跳过日 / 眼睛收起 / 创建日前 / 配额型 / 间隔自适应
 *   ② _habitDueFast()   —— 循环内版本：省掉每天重复归一化，给连续数/应做日统计用
 * 注释写着「语义与 habitDueOn 完全一致」，但这句话**没有任何东西在守**。
 * 两份实现里，间隔型（每隔 N 天）走的是不同路径：
 *   ① 有打卡记录时走 habitIntervalPlan（按真实打卡日推进）
 *   ② 永远走 todoRepeatMatchesNorm（锚点网格）
 * 这不是笔误 —— ②少传了 logDates，只能退回锚点网格。差异是**已知且有意**的，
 * 但它必须是"已知"，不能变成"某天有人改了一处、另一处悄悄不一致"。
 *
 * 本段做两件事
 *   1. 包装一致性：todoRepeatMatches(r,ds) 必须恒等于 todoRepeatMatchesNorm(norm(r),ds)。
 *      这是纯包装关系，任何一天出现分歧都是 bug（例如有人在包装里加了特判）。
 *   2. 两份 habit 实现逐日对拍：把差异集合冻结进 baseline（只准缩小，不准新增）。
 *      新增差异 = 有人改了其中一份没改另一份 → 红灯。
 *
 * 用法
 *   node tools/check_repeat_consistency.js            # 门禁（与基线比对）
 *   node tools/check_repeat_consistency.js --update   # 重写基线（差异变小时用）
 *   node tools/check_repeat_consistency.js --list     # 打印全部差异（人看）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../src/scripts/00_pure_core.js');

const BASELINE = path.join(__dirname, 'repeat_consistency_baseline.json');

/* ===== 用例矩阵：规则 × 日期 =====
   规则覆盖 5 种模式 + 边界参数；日期覆盖闰日、月末、跨年、周界。
   200 组不是"越多越好"，是把**每类边界**都点到：
   2/29（闰年才命中）、2/28（平年月末）、12/31→1/1（跨年）、每月 31 号遇短月、间隔型锚点。 */
const RULES = [
  { mode: 'daily' },
  { mode: 'weekdays' },
  { mode: 'weekly', weekdays: [1] },
  { mode: 'weekly', weekdays: [1, 3, 5] },
  { mode: 'weekly', weekdays: [6, 7] },
  { mode: 'weekly', weekdays: [7] },
  { mode: 'monthly', dom: 1 },
  { mode: 'monthly', dom: 15 },
  { mode: 'monthly', dom: 28 },
  { mode: 'monthly', dom: 29 },
  { mode: 'monthly', dom: 30 },
  { mode: 'monthly', dom: 31 },
  { mode: 'monthly', dom: 0 },
  { mode: 'interval', interval: 1, anchor: '2026-01-01' },
  { mode: 'interval', interval: 2, anchor: '2026-01-01' },
  { mode: 'interval', interval: 3, anchor: '2024-02-29' },
  { mode: 'interval', interval: 7, anchor: '2026-03-01' },
  { mode: 'interval', interval: 30, anchor: '2026-01-31' },
  { mode: 'interval', interval: 365, anchor: '2024-02-29' },
  { mode: 'daily', until: '2026-06-30' },
  { mode: 'daily', until: '2024-02-29' },
  { mode: 'weekly', weekdays: [2, 4], until: '2026-12-31' },
  { mode: 'monthly', dom: 31, until: '2027-01-31' },
  { mode: 'interval', interval: 5, anchor: '2026-05-01', until: '2026-05-20' },
  { mode: 'nonsense' },   // 非法模式 → 两份都应判"不重复"
  null,
];

const DATES = [
  '2024-02-28', '2024-02-29', '2024-03-01',
  '2025-02-28', '2026-02-28', '2026-02-29',
  '2026-01-01', '2025-12-31', '2026-12-31', '2027-01-01',
  '2026-01-31', '2026-04-30', '2026-06-30', '2026-07-01',
  '2026-03-02', '2026-03-08', '2026-03-09',
  '2026-05-18', '2026-05-20', '2026-05-21',
  '2026-09-04', '2026-11-14',
];

function habitOf(rule) {
  // freqPerWeek = 7 → 不走配额分支（配额型是另一套模型，不参与本次对拍）
  return { id: 'h', repeat: rule, freqPerWeek: 7, createdAt: '2026-01-01' };
}

function main() {
  const argv = process.argv.slice(2);
  const isRule = (r) => !!P.normTodoRepeat(r);

  /* ---- ① 包装一致性 ---- */
  let wrapBad = [];
  let cases = 0;
  for (const r of RULES) {
    for (const ds of DATES) {
      cases++;
      const a = P.todoRepeatMatches(r, ds);
      const b = P.todoRepeatMatchesNorm(P.normTodoRepeat(r), ds);
      if (a !== b) wrapBad.push({ rule: JSON.stringify(r), ds, wrapper: a, norm: b });
    }
  }

  /* ---- ② 两份 habit 实现对拍 ---- */
  let diffs = [];
  for (const r of RULES) {
    const h = habitOf(r);
    const rr = P.habitRepeatOf(h);
    for (const ds of DATES) {
      // 只看规则本身的分歧：跳过日/眼睛/创建日前全部给"干净"入参
      const slow = P.habitDueOn(h, ds, {}, []);
      const fast = P._habitDueFast(ds, rr, {}, '2026-01-01');
      if (slow !== fast) {
        diffs.push({
          rule: JSON.stringify(r),
          ds: ds,
          slow: slow,
          fast: fast,
          why: (rr && rr.mode === 'interval') ? 'interval 无 logDates：② 走锚点网格' : '未知',
        });
      }
    }
  }

  if (argv.includes('--list')) {
    console.log('=== 包装分歧（应为 0）===');
    wrapBad.forEach((d) => console.log('  ', d));
    console.log('=== habit 两份实现分歧 ===');
    diffs.forEach((d) => console.log(`   ${d.rule} @ ${d.ds}  slow=${d.slow} fast=${d.fast}  (${d.why})`));
    return 0;
  }

  if (argv.includes('--update')) {
    const data = {
      _note: 'slow= habitDueOn / fast= _habitDueFast 的已知差异。只准缩小，不准新增。',
      wrapperMismatch: wrapBad.length,
      cases: cases,
      diffs: diffs.map((d) => `${d.rule}@${d.ds}`).sort(),
    };
    fs.writeFileSync(BASELINE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log('已写基线 %s（差异 %d 组 / 用例 %d 组）', path.basename(BASELINE), diffs.length, cases);
    return 0;
  }

  console.log('=== 重复判定一致性 ===');
  console.log('用例矩阵: %d 条规则 × %d 个日期 = %d 组', RULES.length, DATES.length, cases);

  if (wrapBad.length) {
    console.log('✗ 包装层不一致 %d 处（todoRepeatMatches ≠ 归一化版本）：', wrapBad.length);
    wrapBad.slice(0, 10).forEach((d) => console.log('   ', d.rule, '@', d.ds, d.wrapper, 'vs', d.norm));
    return 1;
  }
  console.log('✓ 包装一致：todoRepeatMatches 恒等于 todoRepeatMatchesNorm(norm(r), ds)');

  if (!fs.existsSync(BASELINE)) {
    console.log('✗ 基线不存在：%s', path.basename(BASELINE));
    console.log('   首次建立：node tools/check_repeat_consistency.js --update');
    return 1;
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));
  const nowSet = new Set(diffs.map((d) => `${d.rule}@${d.ds}`));
  const baseSet = new Set(base.diffs || []);
  const added = [...nowSet].filter((k) => !baseSet.has(k));
  const gone = [...baseSet].filter((k) => !nowSet.has(k));

  console.log('已知差异: 基线 %d → 现在 %d', baseSet.size, nowSet.size);
  if (added.length) {
    console.log('✗ 新增 %d 处分歧（有人改了其中一份实现，另一份没跟上）：', added.length);
    added.slice(0, 15).forEach((k) => {
      const d = diffs.find((x) => `${x.rule}@${x.ds}` === k);
      console.log('   %s   slow=%s fast=%s  (%s)', k, d.slow, d.fast, d.why);
    });
    return 1;
  }
  if (gone.length) {
    console.log('✓ 有 %d 处差异已消失（基线可下调：--update）', gone.length);
  }
  console.log('✅ 通过：新增分歧 0；已知差异全部在基线内');
  return 0;
}

process.exit(main());
