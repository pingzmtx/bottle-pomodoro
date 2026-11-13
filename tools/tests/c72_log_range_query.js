/* C71 · 专注记录页的「十年可用性」：按月浏览 / 日历条数 / 年份快跳 / 多词搜索
   ------------------------------------------------------------------
   需求原话：「我主要是想要更方便吧，就是以后用了10年、十几年，现在这个就不支持查询吧，
             就很不方便」「我之前那个日历功能怎么没加上呀」。

   所以这条用例守的不是"有个日期框"，而是四件事：
     ① 时间范围能是「整月」，不只是"某一天"（十年数据按月翻）
     ② 日历上能看出哪年哪月哪日有记录、有多少条（不是满屏红点）
     ③ 有记录的年份直接列出来（不用按十几次「上年」）
     ④ 关键词空格分隔 = 都要出现，且认日期（打「2025」= 那年）
*/
(function () {
  const R = [];
  const ok = (n, c) => R.push([n, !!c]);
  const bak = {
    records: appData.records,
    logSig: typeof _logSig !== 'undefined' ? _logSig : null,
    page: typeof _logPage !== 'undefined' ? _logPage : 1,
  };
  try {
    /* 造 12 年的记录：每年 3 月 1 条、10 月 1 条，2026-10 额外两条（验证条数） */
    const mk = (y, m, d, name, note) => {
      const t = new Date(y, m - 1, d, 9, 0, 0).getTime();
      return {
        id: 'c71_' + y + m + d + '_' + Math.random().toString(36).slice(2, 7),
        taskName: name,
        note: note || '',
        type: 'full',
        startTime: t,
        endTime: t + 25 * 60000,
        pomos: 1,
        segs: [{ s: t, e: t + 25 * 60000 }],
      };
    };
    const recs = [];
    for (let y = 2015; y <= 2026; y++) {
      recs.push(mk(y, 3, 1, '春季复盘', y + ' 年三月'));
      recs.push(mk(y, 10, 8, '秋季复盘', y + ' 年十月'));
    }
    recs.push(mk(2026, 10, 8, '秋季复盘二', '同一天第二条'));
    appData.records = recs;
    if (typeof _logSig !== 'undefined') _logSig = null;
    if (typeof _logPage !== 'undefined') _logPage = 1;

    /* 先把筛选清空（前序用例可能留了关键词） */
    const _s = document.getElementById('logSearch'),
      _t = document.getElementById('logTypeFilter'),
      _d = document.getElementById('logDateFilter');
    if (_s) _s.value = '';
    if (_t) _t.value = '';
    if (_d) _d.value = '';
    if (typeof switchView === 'function') switchView('log');
    if (typeof switchLogTab === 'function') switchLogTab('focus');
    if (typeof applyLogFilter === 'function') applyLogFilter();

    /* ① 时间范围控件不再是只能选一天的日期框 */
    ok('A1 有「📅 全部时间」范围按钮', !!document.getElementById('logRangeBtn'));
    ok('A2 日期不再用原生 date 框（它选不了整月）',
      (document.getElementById('logDateFilter') || {}).type === 'hidden');

    /* ①b ★ 页头四颗按钮必须和「专注记录」四个字**同一行、靠右**。
       上一版在窄屏折到下一行、而且退化成左对齐（外层 space-between 折行后
       把按钮组当单元素行处理）—— 这里量真实几何，不靠"看着差不多"。 */
    (function () {
      /* 用 page-node-id 精确定位「专注记录」那个标题 —— 不能用
         '#logFocusView .section-title'：提醒卡/汇总区里也可能有同名 class，
         querySelector 取到别的标题，几何断言就会假绿（反证时当场踩到）。 */
      const title = document.querySelector('[data-page-node-id="R4A8DeLjiaeVmzRl9qOU2O"]');
      const grp = title && title.parentElement && title.parentElement.children[1];
      if (!title || !grp) return ok('A3 找到了「专注记录」标题与按钮组', false);
      const tb = title.getBoundingClientRect(), gb = grp.getBoundingClientRect();
      ok('A3 断言锚点确实是「专注记录」（防止比错元素）', (title.textContent || '').trim() === '专注记录');
      /* 必须先证明这块是**可见**的：display:none 时所有 getBoundingClientRect 都是 0，
         下面的几何断言会全部"通过"——第一次做反证时就是这么假绿的。 */
      ok('A3b 页头确实在显示（宽高 > 0，否则几何断言全假绿）',
        tb.width > 0 && tb.height > 0 && gb.width > 0 && gb.height > 0);
      ok('A4 按钮组与标题同一行（垂直中心差 < 12px）',
        Math.abs((tb.top + tb.bottom) / 2 - (gb.top + gb.bottom) / 2) < 12);
      ok('A5 按钮组在标题右侧（left 大于标题 right）', gb.left > tb.right - 1);
      /* 标题必须保持**单行**：旧版标题是 flex:1 1 auto，被按钮挤窄后「专注记录」
         会折成两行（4 个字挤成 2+2），看起来像页头散架 —— 高度超过一行就算坏。 */
      ok('A5b 标题是单行（没被按钮挤成两行字）',
        tb.height < parseFloat(getComputedStyle(title).fontSize) * 2.2);
      ok('A6 按钮组靠右收口（右边缘贴着容器右边缘 ±2px）',
        Math.abs(gb.right - title.parentElement.getBoundingClientRect().right) <= 2);
      const btns = [...grp.querySelectorAll('button')];
      ok('A7 四颗按钮都在同一行（top 差 < 2px）',
        btns.length === 4 && btns.every(b => Math.abs(b.getBoundingClientRect().top - btns[0].getBoundingClientRect().top) < 2));
      ok('A8 按钮组不换行（flex-wrap 不是 wrap）',
        getComputedStyle(grp).flexWrap === 'nowrap');
      ok('A9 页头没把页面撑宽（无横向溢出）',
        document.documentElement.scrollWidth <= window.innerWidth + 1);
    })();

    /* ② 日历：年份快跳 + 月份条数 + 日子条数 */
    openLogCalendar();
    const _m = document.getElementById('logCalendarModal');
    ok('B1 点范围按钮打开日历', !!_m && _m.classList.contains('show'));
    ok('B2 有记录的年份都列出来（12 年 → 12 个按钮）',
      document.querySelectorAll('#logCalJumpYears .cal-jump-btn').length >= 12);
    toggleLogCalJump();
    ok('B3 展开面板后 12 个月份格都在',
      document.querySelectorAll('#logCalJumpMonths .cal-jump-m').length === 12);
    ok('B4 月份格带条数（不是空白格）', /\d/.test(document.getElementById('logCalJumpMonths').textContent || ''));
    /* 跳到 2026-10，看 10-08 那天是不是 2 条 */
    logCalJumpYear(2026);
    logCalJumpMonth(10);
    let _day8 = null;
    document.querySelectorAll('#logCalGrid div[onclick],#logCalGrid div[data-act]').forEach(function (c) {
      if (((c.getAttribute('onclick') || '') + (c.getAttribute('data-act-args') || '')).indexOf("'2026-10-08'") >= 0) _day8 = c;
    });
    ok('B5 日期格显示当天条数（2026-10-08 = 2）', !!_day8 && (_day8.textContent || '').indexOf('2') >= 0);

    /* ③ 看整月：一次只留那个月的记录 */
    logRangeThisMonth();
    ok('B6 选「看整月」后日历关闭', !_m.classList.contains('show'));
    ok('B7 范围按钮写清是哪个月', (document.getElementById('logRangeBtn').textContent || '').indexOf('2026年10月') >= 0);
    const _dates1 = Array.prototype.map.call(
      document.querySelectorAll('#logList .log-date-header'),
      function (h) {
        return h.getAttribute('data-date');
      }
    );
    ok('B8 整月筛选后只剩 2026-10 的日子：' + JSON.stringify(_dates1),
      _dates1.length > 0 && _dates1.every(function (d) {
        return !d || d.indexOf('2026-10') === 0;
      }));
    ok('B9 计数行走大白话（找到 N 条）', (document.getElementById('logCountInfo').textContent || '').indexOf('找到') >= 0);

    /* ④ 点某一天 → 只那天 */
    pickLogDate('2019-03-01');
    const _dates2 = Array.prototype.map.call(
      document.querySelectorAll('#logList .log-date-header'),
      function (h) {
        return h.getAttribute('data-date');
      }
    );
    ok('C1 点 2019-03-01 后只剩那天', _dates2.length === 1 && _dates2[0] === '2019-03-01');

    /* ⑤ 多词搜索 + 认日期 */
    setLogRange('');
    if (_s) {
      _s.value = '春季 复盘';
      _s.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ok('C2 两个词都要出现 → 只剩 春季复盘 那些', (document.getElementById('logCountInfo').textContent || '').indexOf('12') >= 0);
    if (_s) {
      _s.value = '2019';
      _s.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ok('C3 按年份关键词也能搜（打年份 = 那年全部）',
      (document.getElementById('logCountInfo').textContent || '').indexOf('2') >= 0);
    if (_s) {
      _s.value = '2019-03';
      _s.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ok('C4 按年月关键词也能搜', (document.getElementById('logCountInfo').textContent || '').indexOf('1') >= 0);

    /* ⑥ 清除后回到全部时间 */
    clearLogFilters();
    ok('D1 清除后范围按钮回到「📅 全部」',
      (document.getElementById('logRangeBtn').textContent || '').indexOf('📅 全部') >= 0);
    ok('D2 清除后隐藏域清空', (document.getElementById('logDateFilter') || {}).value === '');
    ok('D3 清除后记录全部回来（26 条 → 卡片重现）',
      (document.getElementById('logCountInfo').textContent || '') === '');
  } catch (e) {
    R.push(['⚠️ 用例抛异常：' + (e && e.message ? e.message : e), false]);
  } finally {
    try {
      appData.records = bak.records;
      if (typeof _logSig !== 'undefined') _logSig = bak.logSig;
      if (typeof _logPage !== 'undefined') _logPage = bak.page;
      const _s2 = document.getElementById('logSearch'),
        _t2 = document.getElementById('logTypeFilter');
      if (_s2) _s2.value = '';
      if (_t2) _t2.value = '';
      if (typeof setLogRange === 'function') setLogRange('');
      else if (typeof applyLogFilter === 'function') applyLogFilter();
    } catch (e2) {}
  }
  return JSON.stringify(R);
})();
