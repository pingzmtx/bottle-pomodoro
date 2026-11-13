/* C59 传记条目布局：竖排一列

   原先每条是「标题左 / 日期+操作右」用 space-between 分居两端 —— 看着像左右两栏，
   窄屏下标题还会被日期挤得很短。改成竖排：
     顶行 = 日期 + 操作（工具行）
     次行 = 标题（独占整宽）
     末行 = 正文

   断言用**几何**而不是"看着像不像"：标题块的宽度必须接近条目宽度，
   且它与日期不能在同一个文本块里。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var _bio = null, _diaries = null;
  try {
    _bio = appData.biographies;
    _diaries = appData.diaries;

    var dayOf = function (k) { var x = new Date(); x.setDate(x.getDate() - k); return getDateStr(x); };
    appData.biographies = [
      { date: dayOf(1), key: 'rec_50', title: '累计 50 个番茄', text: '累计完成 50 个番茄。', edited: false }
    ];
    appData.diaries = {};
    if (typeof switchView === 'function') switchView('log');
    if (typeof switchLogTab === 'function') switchLogTab('bio');

    var sec = document.getElementById('bioSection');
    ok('D0 传记块已渲染', !!sec && sec.innerHTML.length > 0);

    /* 用文本精确定位标题块 */
    var titleEl = null,
      all = document.querySelectorAll('#bioSection div');
    for (var i = 0; i < all.length; i++) {
      if (String(all[i].textContent).trim() === '累计 50 个番茄') { titleEl = all[i]; break; }
    }
    ok('D1 找到条目标题块', !!titleEl);

    if (titleEl) {
      var item = titleEl.parentElement;
      var ir = item.getBoundingClientRect();
      var tr = titleEl.getBoundingClientRect();

      /* 标题不与日期同块 —— 原先两者在同一个 flex 行的两端 */
      ok('D2 标题块里不含日期（不再与日期并排）',
        String(titleEl.textContent).indexOf('2026-') < 0 && String(titleEl.textContent).indexOf('-' + dayOf(1).slice(5)) < 0);

      /* 整条 = 工具行 / 标题 / 正文 三块 */
      var kids = [];
      for (var k = 0; k < item.children.length; k++) {
        var tag = item.children[k].tagName;
        if (tag === 'DIV' || tag === 'SPAN') kids.push(item.children[k]);
      }
      ok('D3 条目是竖排三块（工具行 / 标题 / 正文）', kids.length === 3);

      /* 标题独占整宽：不再被右侧日期挤掉一半 */
      ok('D4 标题宽度接近条目宽度（独占整宽）',
        !!ir.width && tr.width / ir.width >= 0.75);

      /* 日期没丢，只是挪到了工具行 */
      ok('D5 日期仍在条目里（只是移到顶行）',
        String(item.textContent).indexOf(dayOf(1)) >= 0);

      /* 日期确实在标题**上方** */
      var dateEl = null;
      var spans = item.querySelectorAll('span');
      for (var m = 0; m < spans.length; m++) {
        if (String(spans[m].textContent).trim() === dayOf(1)) { dateEl = spans[m]; break; }
      }
      ok('D6 找到日期块', !!dateEl);
      if (dateEl) {
        var dr = dateEl.getBoundingClientRect();
        ok('D7 日期在标题上方（竖排顺序：日期 → 标题）', dr.top <= tr.top + 2);
      }

      /* 正文还在 */
      ok('D8 正文仍在条目里',
        String(item.textContent).indexOf('累计完成 50 个番茄') >= 0);

      /* 操作按钮（编辑/去日记）仍在 */
      ok('D9 操作按钮仍在条目里',
        !!item.querySelector('button'));
    }
  } catch (e) {
    R.push(['⚠️ 用例抛异常：' + (e && e.message ? e.message : e), false]);
  } finally {
    try {
      appData.biographies = _bio;
      appData.diaries = _diaries;
      if (typeof switchLogTab === 'function') switchLogTab('focus');
      if (typeof switchView === 'function') switchView('timer');
    } catch (e2) {}
  }
  return JSON.stringify(R);
})();
