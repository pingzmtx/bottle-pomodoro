/* C122 月历「‹ ›」翻月翻年（2026-10-30 回归）

   用户 2026-10-30 报「日程这里点击切换有问题」，附带的错误日志里是：
     TypeError: Assignment to constant variable.
       at HTMLButtonElement.changeCalendarMonth (assets/app.js:469:50)
   根因：calendarYear / calendarMonth 的真身在 01b（`let`），打包后 01e 拿到的是
   ESM 导入绑定 —— **导入绑定只读**，`calendarYear++` 当场抛错，
   于是左右箭头点了毫无反应（而且每次点一条控制台错误）。
   同理还有 currentDiaryDate / audioCtx 两处。

   这类 bug 的特征：src 里看是裸全局（合法），产物里才是只读绑定；
   点一下才有，unit / build --check 全绿。所以断言必须**真的点箭头**，不能只调函数。

   A 翻月 / B 跨年进位退位 / C 翻年 / D 跳月 / E 12 次回到原点 / F 真的点按钮也生效 */
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  function title() { return (document.getElementById('calendarTitle') || {}).textContent || ''; }
  function ym() { return calendarYear + '/' + (calendarMonth + 1); }

  try {
    /* 先收掉前面用例可能开着的弹窗：C69 会留一个打开的 modal，
       带着 overlay 打开月历会抛错（本用例 0.0s 就挂，正是这个）。 */
    /* 逐个关掉前面用例可能开着的弹窗（C69 会留一个），关不掉也不影响本用例 */
    [].forEach.call(document.querySelectorAll('.modal.show, .modal.active'), function (m) {
      if (!m.id) return;
      try { closeModal(m.id); } catch (e) {}
    });
    /* 不要写 _calendarPick = null：它在产物里同样是导入绑定（只读），
       赋值当场抛 Assignment to constant variable —— 用例自己踩了同一个坑。 */
    try { openCalendarModal(); }
    catch (e) { R.push(['! openCalendarModal 抛错：' + e.message, false]); }
    ok('A0 打开月历：标题与状态一致', title() === calendarYear + '年' + (calendarMonth + 1) + '月', title());

    /* —— A 翻月（不跨年）：先把状态摆到 3 月 —— */
    jumpCalendarMonth(3);
    var y0 = calendarYear;
    changeCalendarMonth(1);
    ok('A1 ‹›翻到下个月：月份 +1 且不抛错', calendarMonth === 3 && calendarYear === y0, ym());
    ok('A2 标题跟着走', title() === y0 + '年4月', title());
    changeCalendarMonth(-1);
    ok('A3 翻回上个月：月份 -1', calendarMonth === 2 && calendarYear === y0, ym());

    /* —— B 跨年：12 月 +1 → 次年 1 月；1 月 -1 → 上年 12 月 —— */
    jumpCalendarMonth(12);
    changeCalendarMonth(1);
    ok('B1 12 月往后翻 → 次年 1 月', calendarMonth === 0 && calendarYear === y0 + 1, ym());
    ok('B2 进位后标题不显示「13 月」', title() === (y0 + 1) + '年1月', title());
    jumpCalendarMonth(1);
    changeCalendarMonth(-1);
    ok('B3 1 月往前翻 → 上年 12 月', calendarMonth === 11 && calendarYear === y0, ym());

    /* —— C 翻年 —— */
    changeCalendarYear(1);
    ok('C1 翻到次年', calendarYear === y0 + 1 && calendarMonth === 11, ym());
    changeCalendarYear(-2);
    ok('C2 翻回上一年', calendarYear === y0 - 1, ym());
    changeCalendarYear(0);
    ok('C3 delta=0 不动', calendarYear === y0 - 1, ym());

    /* —— D 跳月：保留年份，越界夹住 —— */
    jumpCalendarMonth(6);
    ok('D1 直接跳 6 月', calendarMonth === 5 && calendarYear === y0 - 1, ym());
    jumpCalendarMonth(99);
    ok('D2 越界夹到 12 月', calendarMonth === 11, ym());

    /* —— E 连点 12 次回到原点（月份取模不能漂） —— */
    jumpCalendarMonth(5);
    var yE = calendarYear, mE = calendarMonth;
    for (var i = 0; i < 12; i++) changeCalendarMonth(1);
    /* 12 个月正好一年：月份回到原处，年份 +1 */
    ok('E1 翻 12 次：月份回到原处、年份 +1', calendarYear === yE + 1 && calendarMonth === mE, ym());
    for (var j = 0; j < 12; j++) changeCalendarMonth(-1);
    ok('E2 再往前翻 12 次：回到原来的年月', calendarYear === yE && calendarMonth === mE, ym());

    /* —— F 真的点 DOM 按钮（用户点的是它，错误也出在它上面） —— */
    openCalendarModal();
    var btns = [].slice.call(document.querySelectorAll('#calendarModal [data-act="changeCalendarMonth"]'));
    ok('F1 月历上有上一月/下一月按钮', btns.length >= 2, btns.length);
    var before = ym();
    var nextBtn = btns.filter(function (b) { return b.getAttribute('data-act-args') === '["1"]'; })[0] || btns[1];
    nextBtn.click();
    ok('F2 点「下一月」按钮真的换了月（不抛 TypeError）', ym() !== before, before + ' → ' + ym());
    ok('F3 标题同步', title() === calendarYear + '年' + (calendarMonth + 1) + '月', title());
    var prevBtn = btns.filter(function (b) { return b.getAttribute('data-act-args') === '["-1"]'; })[0] || btns[0];
    prevBtn.click();
    ok('F4 点「上一月」回到原处', ym() === before, before + ' → ' + ym());
  } catch (e) {
    /* 异常信息塞进断言名：harness 只打印名字，extra 不显示，留 extra 等于没留 */
    ok('X 用例执行期间不抛异常：' + (e && e.message), false);
  } finally {
    try { closeModal('calendarModal'); } catch (e2) {}
    try { openCalendarModal(); closeModal('calendarModal'); } catch (e3) {}
  }
  return JSON.stringify(R);
})();
