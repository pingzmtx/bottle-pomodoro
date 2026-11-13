/* C69 总览日记字段 + 总览年切换 + 传记筛选升级

   三个用户当场提出的问题，一条用例钉住：
     A 总览「全部日记」看不到新字段（感恩日记…）
       根因不是"忘了写感恩"一件事：字段清单是以手写 <b>进步：</b>… 的形式焊在
       renderAllDiaryBrowser 里的，加一个字段就要回来改一次，漏一次就静默丢一块内容。
       现在字段表在 00_pure_core 的 DIARY_FIELD_SPEC，未登记字段走 extra 兜底。
       所以 A 组不只断言"感恩显示出来了"，还断言"**再塞一个没登记过的新字段也显示**"。
     B 总览只能按月翻、不能换年（日志的专注记录日历早就做了年月快跳）
       —— 断言真的跨年、且复用同一套 cal-jump 面板（12 个月格 + 年份步进）。
     C 「点标题换年」不明显：标题必须是**按钮**（可点 + 有描边 + 有 ▾），不是加了
       cursor:pointer 的纯文字。
     D 传记筛选"很一般"：搜索框每敲一个字就整块重建 → 焦点/光标丢失；排序把"依据"
       和"方向"挤在一个按钮上；月份下拉是扁平列表看不出年份；条件只能加不能清。

   全部用几何/状态断言，不靠"看着对吧"。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var $ = function (s) { return document.querySelector(s); };
  var txt = function (id) { var e = document.getElementById(id); return e ? e.textContent : ''; };
  var _diaries = null, _bios = null, _title = null;

  try {
    _diaries = appData.diaries;
    _bios = appData.biographies;

    /* ---------- A 总览日记字段 ---------- */
    appData.diaries = {};
    appData.diaries['2026-10-15'] = {
      plan: '把数学错题本过一遍',
      review: { progress: '去学校报名了', shortcomings: '', improvements: '明天开始学习', other: '' },
      feedback: { sleepTime: '01:10', wakeTime: '20:05', sleepQuality: 7, mentalState: 6, sleepDay: 'today' },
      gratitude: { items: ['感恩我妈今天做米饭'] }
    };
    /* 没在字段表里登记过的新字段：总览必须自己显示出来 */
    appData.diaries['2026-10-16'] = { review: { progress: '有人夸我辅助很会玩' }, morningNotes: '六点半起来背单词' };
    appData.diaries['2026-10-17'] = {}; /* 只建了空日记 */

    if (typeof switchView === 'function') switchView('log');
    if (typeof switchLogTab === 'function') switchLogTab('overview');

    var ovText = ($('#allDiaryBrowser') || {}).textContent || '';
    ok('A1 总览显示「🙏 感恩」（旧版整段看不见）', ovText.indexOf('感恩我妈今天做米饭') >= 0);
    ok('A2 感恩有中文标签，不是一坨裸文本', ovText.indexOf('🙏 感恩：') >= 0);
    ok('A3 今日计划字段也显示出来', ovText.indexOf('把数学错题本过一遍') >= 0);
    ok('A4 未登记的新字段（morningNotes）照样显示', ovText.indexOf('六点半起来背单词') >= 0);
    ok('A5 空日记不再渲染成一条空白卡片', ovText.indexOf('（这天只建了空日记）') >= 0);
    ok('A6 反馈行仍压成一行（睡眠/精神）',
      ovText.indexOf('睡 01:10') >= 0 && ovText.indexOf('精神 6') >= 0);
    var ovItemCount = document.querySelectorAll('#allDiaryBrowser .diary-overview-item').length;
    ok('A7 三天日记都有条目（含空日记那张）', ovItemCount === 3);

    /* ---------- B 总览年切换 ---------- */
    _title = txt('overviewCalTitle');
    ok('B0 总览标题一开始是"YYYY年M月"', /\d{4}年\d{1,2}月/.test(_title));
    var _y0 = Number(_title.slice(0, 4));
    var _m0 = Number(_title.slice(_title.indexOf('年') + 1, _title.indexOf('月')));
    if (typeof changeOverviewYear === 'function') changeOverviewYear(-1);
    ok('B1 上年 → 标题年份 -1', Number(txt('overviewCalTitle').slice(0, 4)) === _y0 - 1);
    if (typeof toggleOverviewJump === 'function') toggleOverviewJump();
    var _jb = document.getElementById('overviewJump');
    ok('B2 年月快跳面板能打开', !!_jb && _jb.style.display === 'block');
    ok('B3 面板里有 12 个月份格', document.querySelectorAll('#overviewJump .cal-jump-m').length === 12);
    ok('B4 面板年份与标题同步', txt('overviewJumpYear') === String(_y0 - 1));
    ok('B5 面板复用了专注记录日历那套样式类（不是又写一套）',
      document.querySelectorAll('#overviewJump .cal-jump-line').length === 2 &&
      document.querySelectorAll('#overviewJump .cal-jump-btn').length === 2);
    /* 换年后面板不收起（连着跳几个月/几年不用反复点开） */
    if (typeof changeOverviewYear === 'function') changeOverviewYear(1);
    ok('B6 换年后面板保持打开', !!_jb && _jb.style.display === 'block');
    if (typeof overviewJumpMonth === 'function') overviewJumpMonth(12);
    ok('B7 点 12 月 → 标题变成 12 月',
      Number(txt('overviewCalTitle').slice(txt('overviewCalTitle').indexOf('年') + 1, txt('overviewCalTitle').indexOf('月'))) === 12);
    ok('B8 选完月份面板收起', !!_jb && _jb.style.display === 'none');
    /* 复位到当前年月，不把状态留给后面的用例 */
    if (typeof goToOverviewMonth === 'undefined' && typeof overviewJumpMonth === 'function') {
      var _now = new Date();
      var _curY = Number(txt('overviewCalTitle').slice(0, 4));
      if (typeof changeOverviewYear === 'function') changeOverviewYear(_now.getFullYear() - _curY);
      overviewJumpMonth(_now.getMonth() + 1);
    }
    ok('B9 复位后回到当前年月',
      txt('overviewCalTitle') === new Date().getFullYear() + '年' + (new Date().getMonth() + 1) + '月');

    /* ---------- C 标题按钮是否"一眼是按钮" ---------- */
    var _tb = $('.calendar-header button.cal-title-btn');
    ok('C1 总览标题是 <button>（可聚焦/可点），不是纯文字', !!_tb);
    var _cs = _tb ? getComputedStyle(_tb) : null;
    /* ★ 2026-10-30：门槛从「>= 1px」降到 0.5。
       移动端窄视口（390）下页面有缩放，Chrome 把 1 CSS px 的描边报成 0.76px
       （used value 经过 zoom），于是「明明有描边」被判成没有。
       判据改为「描边存在且是实线」——样式是 solid、宽度 > 0 即成立。 */
    ok('C2 标题按钮有描边', !!_cs && _cs.borderTopStyle === 'solid'
      && parseFloat(_cs.borderTopWidth) >= 0.5,
      _cs && _cs.borderTopStyle + ' ' + _cs.borderTopWidth);
    ok('C3 标题按钮宽度自适应（没被日历箭头压成 32px 方块）',
      !!_cs && parseFloat(_cs.width) > 80);
    ok('C4 标题带 ▾ 箭头提示可点开', !!_tb && !!_tb.querySelector('.ct-arrow'));
    /* 三处日历（总览 / 专注记录 / 日记）共用同一套：日记日历与日志日历也必须有 */
    ok('C5 日记日历标题也换成按钮', !!document.querySelector('#calendarModal .calendar-header button.cal-title-btn'));
    ok('C6 专注记录日历标题也换成按钮', !!document.querySelector('#logCalendarModal button.cal-title-btn'));

    /* ---------- D 传记筛选 ---------- */
    appData.biographies = [
      { date: '2026-10-01', key: 'k1', title: '累计 50 个番茄', text: '累计完成 50 个番茄。', edited: false },
      { date: '2025-12-01', key: 'k2', title: '连续 7 天', text: '连续 7 天都有专注记录，很难得的一段日子。', edited: false }
    ];
    appData.diaries = {
      '2026-10-15': { review: { progress: '去学校报名了，紧张但顺利' }, gratitude: { items: ['感恩我妈做米饭'] } },
      '2026-10-16': { review: { progress: '有人夸我辅助很会玩' } }
    };
    if (typeof switchLogTab === 'function') switchLogTab('bio');
    var _box = document.getElementById('bioSection');
    ok('D0 传记块已渲染', !!_box && _box.innerHTML.length > 0);

    /* D1 来源按钮带条数：不给条数，"0 条"和"没生效"看起来一模一样 */
    var _segs = document.querySelectorAll('#bioSection .seg-btn');
    var _gratTxt = '';
    for (var i = 0; i < _segs.length; i++) if (_segs[i].textContent.indexOf('感恩') >= 0) _gratTxt = _segs[i].textContent;
    ok('D1 来源按钮带条数（如「感恩 1」）', /\d/.test(_gratTxt));
    ok('D2 来源按钮仍是 4 个（没被合并掉）', _segs.length === 4);

    /* D3 搜索框边打字边筛，焦点与光标不能丢 */
    var _inp = document.getElementById('bioSearch');
    ok('D3 搜索框存在', !!_inp);
    if (_inp) {
      _inp.focus();
      _inp.value = '番茄';
      _inp.setSelectionRange(1, 1); /* 光标停在"番"后面，重建后要回到同一位置 */
      _inp.dispatchEvent(new Event('input', { bubbles: true }));
      var _ns = document.getElementById('bioSearch');
      ok('D4 打字后焦点仍在搜索框（旧版整块重建 → 手机键盘直接收）',
        document.activeElement && document.activeElement.id === 'bioSearch');
      ok('D5 光标位置被还原（不是跳回开头/末尾）', !!_ns && _ns.selectionStart === 1);
      ok('D6 关键词真的过滤了列表', (_box.textContent || '').indexOf('连续 7 天') < 0);
    }

    /* D6 之后关键词还留着，先清干净再验日期导航（否则"只看那一天"会被关键词叠加） */
    if (typeof clearBioFilters === 'function') clearBioFilters();
    /* D7 传记的时间导航必须是日历，不是几十项的下拉。
       需求原话：「我都看不懂，什么命中」「用了十年、十几年，现在这个就不支持查询」。
       所以断言的不只是"有个日期按钮"，而是：点开真有日历、日历上能看出哪天有内容、
       点一天就只剩那天、能一键回全部。 */
    ok('D7 有「📅 全部时间」日期按钮', (_box.textContent || '').indexOf('📅 全部时间') >= 0);
    ok('D8 顺序按钮只说人话（最新/最早在前）',
      (_box.textContent || '').indexOf('最新在前') >= 0 || (_box.textContent || '').indexOf('最早在前') >= 0);
    ok('D8b 不再有「排序依据」下拉（日期/来源/字数那张看不懂的选项表）', !document.getElementById('bioSortKey'));
    ok('D8c 不再有月份下拉', !document.getElementById('bioMonthFilter'));
    ok('D8d 界面不再出现「命中」二字', (_box.textContent || '').indexOf('命中') < 0);

    if (typeof openBioCalendar === 'function') openBioCalendar();
    var _cm = document.getElementById('bioCalModal');
    ok('D9 点日期按钮打开日历弹窗', !!_cm && _cm.classList.contains('show'));
    var _cg = document.getElementById('bioCalGrid');
    ok('D10 日历网格渲染出该月天数', !!_cg && _cg.children.length >= 28);
    ok('D11 有内容的日子带条数（不是空日历）', !!_cg && /\d/.test(_cg.textContent || ''));
    if (typeof toggleBioCalJump === 'function') toggleBioCalJump();
    var _cj = document.getElementById('bioCalJump');
    ok('D12 标题可换年/换月，面板里 12 个月份格', !!_cj && _cj.style.display === 'block' &&
      document.querySelectorAll('#bioCalJumpMonths .cal-jump-m').length === 12);
    ok('D11b 有内容的年份直接列出来（用了十几年不用按十几次「上年」）',
      document.querySelectorAll('#bioCalJumpYears .cal-jump-btn').length >= 1);
    if (typeof changeBioCalYear === 'function') changeBioCalYear(2026 - Number((document.getElementById('bioCalTitle') || {}).textContent.slice(0, 4)));
    if (typeof bioCalJumpMonth === 'function') bioCalJumpMonth(10);
    if (typeof pickBioDate === 'function') pickBioDate('2026-10-15');
    ok('D12b 选一天后日历关闭', !!_cm && !_cm.classList.contains('show'));
    var _t2 = document.getElementById('bioSection').textContent || '';
    ok('D12c 只显示那天的内容', _t2.indexOf('去学校报名了') >= 0 && _t2.indexOf('累计 50 个番茄') < 0);
    ok('D12d 日期按钮显示选中的那天', _t2.indexOf('📅 2026-10-15') >= 0);
    ok('D12e 摘要行说人话：找到 N 条，不是"命中"', _t2.indexOf('找到') >= 0 && _t2.indexOf('命中') < 0);
    /* 多词搜索：空格分隔 = 都要出现（十年后靠组合词定位） */
    if (typeof clearBioFilters === 'function') clearBioFilters();
    var _i2 = document.getElementById('bioSearch');
    if (_i2) {
      _i2.value = '连续 7 天';
      _i2.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var _t3 = document.getElementById('bioSection').textContent || '';
    ok('D12f 多词搜索按 AND 过滤', _t3.indexOf('累计 50 个番茄') < 0 && _t3.indexOf('连续 7 天') >= 0);
    ok('D12g 搜到的词在正文里高亮', !!document.querySelector('#bioSection mark'));
    /* 留一个关键词给 D13/D14 验「清除」按钮的出现与消失 */
    var _i3 = document.getElementById('bioSearch');
    if (_i3) {
      _i3.value = '番茄';
      _i3.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /* D13 有筛选时会给出「清除」出口（旧版只能一项项撤） */
    var _hasClear = (_box.textContent || '').indexOf('✕ 清除') >= 0;
    ok('D13 关键词/排序生效时出现「✕ 清除」', _hasClear);
    ok('D14 清除按钮只在有条件时出现（不是常驻噪音）',
      !![].slice.call(document.querySelectorAll('#bioSection button')).filter(function (b) {
        return ((b.getAttribute('onclick') || '') + (b.getAttribute('data-act') || '')).indexOf('clearBioFilters') >= 0;
      }).length);
    if (typeof clearBioFilters === 'function') clearBioFilters();
    var _after = document.getElementById('bioSection').textContent || '';
    ok('D15 清除后显示「全部时间」且条目全部回来',
      _after.indexOf('📅 全部时间') >= 0 && _after.indexOf('累计 50 个番茄') >= 0 && _after.indexOf('连续 7 天') >= 0);
    ok('D15b 条件清空后「清除」按钮自己消失', ![].slice.call(document.querySelectorAll('#bioSection button')).filter(function (b) {
        return ((b.getAttribute('onclick') || '') + (b.getAttribute('data-act') || '')).indexOf('clearBioFilters') >= 0;
      }).length);
    ok('D16 清除后搜索框也清空', (document.getElementById('bioSearch') || {}).value === '');
  } catch (e) {
    R.push(['⚠️ 用例抛异常：' + (e && e.message ? e.message : e), false]);
  } finally {
    /* 还原共享状态，不给后续用例留脏数据 */
    try {
      if (_diaries !== null) appData.diaries = _diaries;
      if (_bios !== null) appData.biographies = _bios;
      if (typeof clearBioFilters === 'function') clearBioFilters();
      if (typeof renderDiaryOverviewPage === 'function') renderDiaryOverviewPage();
    } catch (e2) {}
  }
  return JSON.stringify(R);
})();
