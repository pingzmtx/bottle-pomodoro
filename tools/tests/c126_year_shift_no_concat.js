/* C126 —— 年度/月度统计的「‹ ›」不能用字符串拼年份

   用户截图：「年度专注统计 2026-1-1-1111-1年」—— 越点越长。

   根因：模板里按钮是 `data-act="yrStatShift" data-act-args='["-1"]'`，
   委托 readArgs 原样把 JSON 里的字符串丢给函数，而实现写的是
   `__set__yrY((_yrY || 今年) + d)` —— 数字 + 字符串 = **拼接**。
   于是 2026 + "-1" → "2026-1"；再 + "1" → "2026-11"；再 + "-1" → "2026-11-1"…
   标题一路长下去，yearStats("2026-1-1-1111-1") 全 0，图也空了。
   monStatShift 同病：10 + "-1" → "10-1"，月度图错乱。

   两道防线都测：
     A 模板参数已是 JSON 数字（[-1] / [1]），委托拿到的就是 Number
     B 就算有人传字符串（老缓存、内联写法），parseInt 兜底也不能串
     C _yrY 已被污染成字符串时能自愈回今年
     D 真正的切换语义：跨年、跨月、连点多次都对
*/
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }

  var yearBak = _yrY,
    monYBak = _monY,
    monMBak = _monM;

  /* ---- A 模板参数是数字，不是 "1" ---- */
  var btn = document.querySelector('[data-act="yrStatShift"][data-act-args="[1]"]');
  ok('A1 年份按钮的参数是 JSON 数字', !!btn, btn ? 'found' : 'missing');
  ok('A2 参数数组里没有引号包裹的数字', (function () {
    var raw = btn ? btn.getAttribute('data-act-args') : '';
    return raw === '[1]' || raw === '[-1]';
  })(), btn ? btn.getAttribute('data-act-args') : '');

  /* ---- B 字符串参数也不能串（parseInt 兜底） ---- */
  __set__yrY(2026);
  yrStatShift('-1');
  ok('B1 传字符串 "-1" 得到数字 2025（不是 "2026-1"）', _yrY === 2025, typeof _yrY + ':' + _yrY);
  yrStatShift('1');
  ok('B2 再传 "1" 回到 2026', _yrY === 2026, _yrY);
  ok('B3 标题文本干净', (function () {
    var t = document.getElementById('yrStatTitle');
    return !!t && /^\d{4}年$/.test((t.textContent || '').trim());
  })(), (document.getElementById('yrStatTitle') || {}).textContent);

  /* ---- C 连点不累积 ---- */
  for (var i = 0; i < 5; i++) yrStatShift('-1');
  ok('C1 连点 5 次「上一年」= 2021（不是一串数字）', _yrY === 2021, _yrY);
  for (var j = 0; j < 5; j++) yrStatShift(1);
  ok('C2 再连点 5 次回来 = 2026', _yrY === 2026, _yrY);
  ok('C3 年份永远是 4 位整数', typeof _yrY === 'number' && _yrY > 1900 && _yrY < 3000, _yrY);

  /* ---- D 脏值自愈 ---- */
  __set__yrY('2026-1-1-1111-1');
  ok('D1 被污染的年份能解析出今年', yrYearNum() === new Date().getFullYear(), yrYearNum());
  __set__yrY('abc');
  ok('D2 完全不是数字 → 回今年', yrYearNum() === new Date().getFullYear(), yrYearNum());
  __set__yrY(0);
  ok('D3 初始 0 → 回今年', yrYearNum() === new Date().getFullYear(), yrYearNum());

  /* ---- E 月份切换同病同治 ---- */
  __set__yrY(2026);
  _monSet(2026, 0);
  monStatShift('-1');
  var c1 = _monCur();
  ok('E1 1 月往前 = 上一年 12 月（数字，不是 "0-1"）',
     c1.y === 2025 && c1.m === 11, JSON.stringify(c1));
  monStatShift('1');
  var c2 = _monCur();
  ok('E2 12 月往后 = 次年 1 月', c2.y === 2026 && c2.m === 0, JSON.stringify(c2));
  _monSet(2026, 11);
  monStatShift(1);
  var c3 = _monCur();
  ok('E3 连推不越界', c3.y === 2027 && c3.m === 0, JSON.stringify(c3));
  ok('E4 月份始终是 0~11 的整数', (function () {
    for (var k = 0; k < 24; k++) {
      monStatShift(-1);
      var c = _monCur();
      if (typeof c.m !== 'number' || c.m < 0 || c.m > 11) return false;
    }
    return true;
  })(), JSON.stringify(_monCur()));

  /* ---- F 年度统计与年度地图的年份控件（2026-11-07 加） ---- */
  var ybtn = document.getElementById('yrStatYearBtn');
  var ytitle = document.getElementById('yrStatTitle');
  ok('F1 年度统计标题里的年份是个按钮（点开快跳）', !!(ybtn && ytitle) && ybtn.contains(ytitle),
     ybtn ? ybtn.outerHTML.slice(0, 80) : 'missing');
  ok('F2 按钮显示的就是当前年份（不是静止的"跳转"）', (function () {
    __set__yrY(2024); renderYearlyStat();
    return ytitle && ytitle.textContent === '2024年';
  })(), ytitle ? ytitle.textContent : 'missing');
  ok('F3 翻年后按钮文字跟着变', (function () {
    yrStatShift(1);
    return ytitle.textContent === '2025年';
  })(), ytitle ? ytitle.textContent : 'missing');
  ok('F4 年度地图的年份同样是可点按钮', (function () {
    var m = document.getElementById('yrMapYear');
    return !!m && m.getAttribute('data-act') === 'openYearPicker';
  })());

  /* 还原 */
  __set__yrY(yearBak);
  _monSet(monYBak, monMBak);
  try { renderYearlyStat(); renderMonthlyStat(); } catch (e) { /* 视图未激活 */ }
  return JSON.stringify(R);
})();
