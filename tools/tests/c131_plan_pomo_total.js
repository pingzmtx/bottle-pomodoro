/* C131 —— 计划页底部「累计番茄」卡：本自然年的一行账 + 下方全历史总量

   用户要求（2026-11-07 两轮）：
     1. 「计划下面不是有一个累计番茄吗？我想改成近一年」→ 追问后定为**本自然年**
        （他否掉了滚动 365 天：「每少一天我这边多加一天，总数不变」）。
     2. 「在它下面有一行字，就是累计番茄，在上面标着总番茄数量」
        → 卡片下半截单独给全历史总量。
     3. 另外强调数字可能到几千到万，不能撑破框 —— 第一版换「万」导致
        `1.23万 + 8 = 1.23万` 两边相等，所以现在一律千分位精确数 + 字号降档。

   锁五件事：
     A fmtPomoGrouped 的边界（0 / 千位 / 百万 / 小数 / 字符串脏值）
     B 卡片就是 `之前 + 今天 = 本年`，三段都对；总量在下半截
     C 一万、百万级都不许出现「万」，不许裁切溢出（含总量那个数）
     D 无记录时不占位
     E 年份口径：去年的记录进总量、不进本年；今天跨年当天也成立
*/
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }

  /* ---- A 格式化纯函数 ---- */
  ok('A1 fmtPomoGrouped 存在', typeof fmtPomoGrouped === 'function');
  ok('A2 0 → "0"', fmtPomoGrouped(0) === '0', fmtPomoGrouped(0));
  ok('A3 999 → "999"（不满千不加逗号）', fmtPomoGrouped(999) === '999', fmtPomoGrouped(999));
  ok('A4 1000 → "1,000"', fmtPomoGrouped(1000) === '1,000', fmtPomoGrouped(1000));
  ok('A5 12338 → "12,338"', fmtPomoGrouped(12338) === '12,338', fmtPomoGrouped(12338));
  ok('A6 1234567 → "1,234,567"', fmtPomoGrouped(1234567) === '1,234,567', fmtPomoGrouped(1234567));
  ok('A7 半番茄 0.5 → "0.5"（小数位不参与分组）', fmtPomoGrouped(0.5) === '0.5', fmtPomoGrouped(0.5));
  ok('A8 1234.5 → "1,234.5"', fmtPomoGrouped(1234.5) === '1,234.5', fmtPomoGrouped(1234.5));
  ok('A9 负数/脏值不当成 NaN 显示', fmtPomoGrouped(-5) === '0' && fmtPomoGrouped('abc') === '0',
     fmtPomoGrouped(-5) + '/' + fmtPomoGrouped('abc'));
  ok('A10 不再有 fmtPomoCompact（换万那套已删）', typeof fmtPomoCompact === 'undefined');

  /* ---- 造记录：yearP 个落在本年内（含 todayP 个在今天的），oldP 个落在去年 ---- */
  var bak = appData.records;
  var today = getTodayStr();
  var yearStart = today.slice(0, 4) + '-01-01';
  /* 本年内能放历史记录的日子：今天之前、且不早于 1/1。
     1 月 1 日当天没有这块空间，就把历史那部分全算在今天（断言按实际口径走）。 */
  var prevYearDay = addDaysStr(yearStart, -1);
  function ts(ds) { return dateStrToDate(ds).getTime() + 12 * 3600000; }
  function build(yearP, todayP, oldP) {
    var recs = [];
    var rest = yearP - todayP;
    if (rest > 0 && yearStart !== today) {
      recs.push({ id: 'cy', startTime: ts(yearStart), duration: 1500, effectiveSeconds: 1500,
                  type: 'full', pomos: rest });
    } else {
      todayP += rest;   /* 今天就是 1/1：没有"之前的今年"，全归今天 */
      rest = 0;
    }
    if (todayP > 0) {
      recs.push({ id: 'ct', startTime: Date.now(), duration: 1500, effectiveSeconds: 1500,
                  type: 'full', pomos: todayP });
    }
    if (oldP > 0) {
      recs.push({ id: 'co', startTime: ts(prevYearDay), duration: 1500, effectiveSeconds: 1500,
                  type: 'full', pomos: oldP });
    }
    appData.records = recs;
    renderPlanPomoTotal();
    var host = document.getElementById('planPomoTotal');
    return {
      host: host,
      expect: { year: yearP, today: todayP, before: yearP - todayP, total: yearP + oldP },
      nums: [].map.call(host.querySelectorAll('.ppc-num'), function (n) {
        return { t: n.textContent, fs: (n.className || '').replace('ppc-num ', ''),
                 overflow: n.scrollWidth > n.clientWidth + 1 };
      }),
      text: (host.innerText || '').replace(/\s+/g, ' ')
    };
  }

  /* ---- B 182 场景（+ 去年 1000）：三段账 + 下方总量 ---- */
  var a = build(182, 8, 1000);
  ok('B1 卡片有四个数：之前 / 今天 / 本年 / 总量', a.nums.length === 4, a.nums.length);
  ok('B2 174 + 8 = 182（本年账）',
     a.nums[0] && a.nums[0].t === '174' && a.nums[1] && a.nums[1].t === '8' && a.nums[2] && a.nums[2].t === '182',
     a.nums.map(function (x) { return x.t; }).join('|'));
  ok('B3 下半截是总量 1,182（去年的 1000 也算进来）',
     a.nums[3] && a.nums[3].t === '1,182', a.nums[3] && a.nums[3].t);
  ok('B4 标签是 之前 / 今天 / 本年', /之前/.test(a.text) && /今天/.test(a.text) && /本年/.test(a.text), a.text);
  ok('B5 明说这一行账是「本自然年」（否则会被读成从有记录以来）',
     a.text.indexOf('本自然年') >= 0, a.text.slice(0, 40));
  ok('B6 总量那段有「累计番茄」字样（用户要的那行字）',
     /累计番茄/.test(a.text), a.text.slice(-30));
  ok('B7 三位数用最大档 fs-xl', a.nums[0].fs === 'fs-xl' && a.nums[2].fs === 'fs-xl', a.nums[0].fs);
  ok('B8 口径：before + today = year，total 独立', (function () {
    var t = planPomoTotals();
    return t.before + t.today === t.year && t.year === 182 && t.today === 8 && t.total === 1182;
  })(), JSON.stringify(planPomoTotals()));

  /* ---- C 万级 / 百万级：必须看得出"今天涨了多少" ---- */
  var b = build(12338, 8, 5000000);
  ok('C1 一万级：之前 = "12,330"', b.nums[0] && b.nums[0].t === '12,330', b.nums[0] && b.nums[0].t);
  ok('C2 一万级：本年 = "12,338"（能看出 +8）', b.nums[2] && b.nums[2].t === '12,338', b.nums[2] && b.nums[2].t);
  ok('C3 一万级：加号两边不相等（这正是换"万"的病）', b.nums[0].t !== b.nums[2].t);
  ok('C4 一百万级总量：不出现「万」字', !/万/.test(b.host.innerText), b.host.innerText.slice(0, 60));
  ok('C5 一万级 / 百万级总量：没有数字被裁切',
     !b.nums.some(function (x) { return x.overflow; }),
     b.nums.map(function (x) { return x.t + (x.overflow ? '(裁)' : ''); }).join('|'));
  ok('C6 总量"5,012,338"精确显示，没被压缩', b.nums[3] && b.nums[3].t === '5,012,338', b.nums[3] && b.nums[3].t);

  var c = build(1234567, 8, 0);
  ok('C7 百万级本年：本年 = "1,234,567"', c.nums[2] && c.nums[2].t === '1,234,567', c.nums[2] && c.nums[2].t);
  ok('C8 百万级：降到最小档 fs-xs', c.nums[2] && c.nums[2].fs === 'fs-xs', c.nums[2] && c.nums[2].fs);
  ok('C9 百万级：没有数字被裁切', !c.nums.some(function (x) { return x.overflow; }));

  /* 字号档位单调：位数越多档位越小（不许出现长数字反而更大） */
  function rank(fs) { return ['fs-xs', 'fs-s', 'fs-m', 'fs-l', 'fs-xl'].indexOf(fs); }
  ok('C10 字号档位随位数单调递减', (function () {
    var prev = 99;
    var seq = [999, 9999, 99999, 999999, 9999999];
    for (var i = 0; i < seq.length; i++) {
      var r = build(seq[i], 0, 0).nums[2];
      if (!r) return false;
      if (rank(r.fs) > prev) return false;
      prev = rank(r.fs);
    }
    return true;
  })());

  /* ---- D 无记录不占位 ---- */
  appData.records = [];
  renderPlanPomoTotal();
  ok('D1 一条记录都没有 → 卡片留空（不显示 0）',
     document.getElementById('planPomoTotal').innerHTML === '',
     document.getElementById('planPomoTotal').innerHTML.slice(0, 40));

  /* ---- E 年份口径 ---- */
  /* 去年最后一天的一笔：只进总量，不进本年 */
  appData.records = [{ id: 'e1', startTime: ts(prevYearDay), duration: 1500,
                       effectiveSeconds: 1500, type: 'full', pomos: 77 }];
  renderPlanPomoTotal();
  var e1 = planPomoTotals();
  ok('E1 去年最后一笔 → 进总量（77），本年 = 0', e1.total === 77 && e1.year === 0 && e1.today === 0,
     JSON.stringify(e1));
  ok('E2 本年为 0 但总量有值 → 卡片仍然画（不能因为本年空着就整块消失）',
     document.getElementById('planPomoTotal').innerHTML !== '', '');
  /* 本年第一天 00:00：必须算进本年（边界不许差一天） */
  appData.records = [{ id: 'e2', startTime: ts(yearStart), duration: 1500,
                       effectiveSeconds: 1500, type: 'full', pomos: 5 }];
  renderPlanPomoTotal();
  var e2 = planPomoTotals();
  ok('E3 本年 1 月 1 日的那一笔算进本年（边界含起点）', e2.year === 5, JSON.stringify(e2));
  /* 没时间的脏记录：只进总量，不许崩 */
  appData.records = [{ id: 'e3', duration: 1500, effectiveSeconds: 1500, type: 'full', pomos: 2 },
                     { id: 'e4', duration: 1500, effectiveSeconds: 1500, type: 'full', pomos: 3 }];
  renderPlanPomoTotal();
  var e3 = planPomoTotals();
  ok('E4 没有 startTime 的记录只进总量，不猜它属于哪一天', e3.total === 5 && e3.year === 0,
     JSON.stringify(e3));

  /* 还原 */
  appData.records = bak;
  try { renderPlanPomoTotal(); } catch (e) { /* 视图未激活 */ }
  return JSON.stringify(R);
})();
