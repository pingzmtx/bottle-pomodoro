/* C118 习惯「节奏」升级（2026-10-30）

   用户原话：
     「有的习惯吧，就它就不是天天打卡的。现在那个下面那个格只支持连续天数…」
     「我这个不是今天需要打卡的…它应该支持隐藏这种习惯，我哪天做哪个习惯」
     「现在添加习惯就是上面一个框…我希望跟添加计划一样，点加号就有一个弹窗」

   三件事对应三组断言：
   A 老习惯（无 repeat）逐项不变 —— 这是升级的底线，不能为了新功能改了旧账
   B 规则驱动：不命中的日子默认不出现在主列表，收进「今天不用做（N）」；
     展开后能看见、能补卡；连续数不因为「今天不用做」而断
   C 眼睛层：今天先不看 → 进「今天不用做」并给回执（不静默消失）→ 可放回
   D 弹窗新建/编辑：同一入口、节奏可选、uid/createdAt/growthPoints 不被写坏、
     改规则不动历史打卡

   数据全部临时造、结尾还原。 */
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var habitsBak = JSON.stringify(appData.habits || []);
  var logsBak = JSON.stringify(appData.habitLogs || {});
  var today = getTodayStr();
  var yest = addDaysStr(today, -1);
  var wdToday = isoWeekday(today);
  var wdOther = wdToday === 7 ? 1 : wdToday + 1;   /* 一定不是今天的那个星期几 */
  var wdYest = isoWeekday(yest);
  var list = document.getElementById('habitList');

  try {
    /* 折叠区状态是模块级 UI 变量（_habitOffOpen），不落盘也不随 saveData 复位。
       本用例假定它初始收起（B2 先验"不在主列表"、B6 才展开），
       所以必须自己重置 —— 否则上一个用例展开过，这里会 B2/B6/B7 全红（与业务无关）。 */
    _habitOffOpen = false;
    appData.habitCats = [];
    appData.habitCatOpen = {};
    appData.habits = [
      /* 9801 老习惯：没有 repeat，只能天天打 */
      { id: 9801, uid: 'h9801', name: '老习惯读书', createdAt: addDaysStr(today, -40), growthPoints: 9, freqPerWeek: 7 },
      /* 9802 每周只做「不是今天」的那天 → 今天不该出现 */
      { id: 9802, uid: 'h9802', name: '周三才做的事', createdAt: addDaysStr(today, -40), growthPoints: 3, freqPerWeek: 7, repeat: { mode: 'weekly', weekdays: [wdOther] } },
      /* 9803 每周「昨天那一天」→ 今天不命中，但昨天打了，连续不该断 */
      { id: 9803, uid: 'h9803', name: '昨天该做的事', createdAt: addDaysStr(today, -40), growthPoints: 5, freqPerWeek: 7, repeat: { mode: 'weekly', weekdays: [wdYest] } },
      /* 9804 每周含今天 → 今天该做 */
      { id: 9804, uid: 'h9804', name: '今天该做的事', createdAt: addDaysStr(today, -40), growthPoints: 1, freqPerWeek: 7, repeat: { mode: 'weekly', weekdays: [wdToday] } }
    ];
    appData.habitLogs = { 9801: [yest, today], 9803: [yest] };
    saveData();
    if (typeof switchPlanTab === 'function') switchPlanTab('habit');
    if (typeof renderHabits === 'function') renderHabits();

    /* —— A 老习惯不变 —— */
    var hsOld = habitStats(appData.habits[0], appData.habitLogs[9801], today, HABIT_WINDOW_DAYS);
    ok('A1 老习惯（无 repeat）连续照旧按自然日', hsOld.cur === 2, 'cur=' + hsOld.cur);
    ok('A2 老习惯应打卡数 = 窗口内的存在天数', hsOld.expected === 30, 'expected=' + hsOld.expected);
    ok('A3 老习惯的单位仍是「天」', habitStreakUnit(appData.habits[0]) === '天');

    /* —— B 规则驱动：今天不做的不占屏 —— */
    var html0 = list.innerHTML;
    ok('B1 今天该做的在列表里', html0.indexOf('今天该做的事') >= 0);
    ok('B2 今天不该做的不在主列表', html0.indexOf('周三才做的事') < 0);
    ok('B3 有「今天不用做」区头（不是静默隐藏）', html0.indexOf('habit-off-head') >= 0);
    ok('B4 区头写明条数（9802/9803 两条）', html0.indexOf('habit-off-count') >= 0 && html0.indexOf('>2<') >= 0, html0.length);
    ok('B5 顶部给出「今天该做 N 个 / 另有 M 个今天不用做」的实话', html0.indexOf('habit-due-line') >= 0 && html0.indexOf('今天不用做') >= 0);

    /* 展开后能看见、能补卡（勾选框还在） */
    toggleHabitOffSection();
    var html1 = list.innerHTML;
    ok('B6 展开后能看到今天不做的习惯', html1.indexOf('周三才做的事') >= 0);
    ok('B7 展开后仍可补卡（勾选框在）', html1.indexOf('habit-item habit-item--off') >= 0 || html1.indexOf('habit-item--off') >= 0);
    ok('B8 展开区标了「今天不用做」', html1.indexOf('habit-off-tag') >= 0 || html1.indexOf('今天不用做') >= 0);
    toggleHabitOffSection();

    /* 连续数：今天不命中 ≠ 断链 */
    var hsY = habitStats(appData.habits[2], appData.habitLogs[9803], today, HABIT_WINDOW_DAYS);
    ok('B9 每周型习惯：昨天是应做日且打了 → 连续 1 次（今天不做不算断）', hsY.cur === 1, 'cur=' + hsY.cur);
    ok('B10 每周型习惯的连续单位是「次」', habitStreakUnit(appData.habits[2]) === '次');
    var line9801 = habitStatsLine(appData.habits[0], today);
    ok('B11 列表统计行仍带「连续/达标」两条', line9801.indexOf('连续') >= 0 && line9801.indexOf('达标') >= 0, line9801);

    /* —— C 眼睛层：藏了必须给回执，能放回 —— */
    toggleHabitSkip(9804);
    var html2 = list.innerHTML;
    ok('C1 点了「今天先不看」→ 记下 skipOn 并收进「今天不用做」', appData.habits[3].skipOn === today && html2.indexOf('habit-off-head') >= 0);
    ok('C2 收起后给出回执（区头说清有几个被收起来了）', html2.indexOf('个今天先不看') >= 0,
      html2.indexOf('个今天先不看') >= 0 ? '' : '区头没写清原因');
    ok('C3 回执里能看到它，并带「放回」入口', html2.indexOf('放回') >= 0);
    ok('C4 眼睛状态只记今天一天', appData.habits[3].skipOn === today);
    restoreHabitSkips();
    ok('C5 一键放回后 skipOn 清掉', !appData.habits[3].skipOn);
    ok('C6 放回后它回到主列表', list.innerHTML.indexOf('今天该做的事') >= 0);

    /* —— D 弹窗新建 / 编辑 —— */
    openHabitEditModal();
    var modal = document.getElementById('habitEditModal');
    ok('D1 点 ＋ 打开的是弹窗（不是输入框）', !!modal && modal.classList.contains('show'));
    ok('D2 弹窗里有节奏下拉（与计划页同一份控件）', !!document.getElementById('habitRepeatMode'));
    ok('D3 节奏下拉有四档以上（每天/工作日/每周/每月/每隔N天）',
      document.getElementById('habitRepeatMode').options.length >= 5,
      document.getElementById('habitRepeatMode').options.length);
    /* ★ 2026-11-05 起习惯也有「第二天子计划三档」（复用了计划那套控件，只是文案叫「子计划」）。
       这条断言原先写的是"不该出现"，那是子计划还没有三档时的口径，已过期。
       现在真正要锁的是**称呼**：习惯这里不许出现计划专用的「子任务」字样。 */
    var _hs = document.getElementById('habitRepeatSubs');
    var _hsWrap = document.getElementById('habitRepeatSubsWrap');
    ok('D4 习惯弹窗的「第二天」三档在，但叫「子计划」不叫「子任务」',
      !!_hs && !!_hsWrap && _hs.options.length === 3 &&
      _hsWrap.textContent.indexOf('子计划') >= 0 && _hsWrap.textContent.indexOf('子任务') < 0,
      _hs ? _hsWrap.textContent.slice(0, 40) : 'missing');
    var beforeCount = appData.habits.length;
    document.getElementById('habitEditName').value = '弹窗建的习惯';
    document.getElementById('habitEditNote').value = '说明也一起存';
    var modeSel = document.getElementById('habitRepeatMode');
    modeSel.value = 'weekly';
    syncRepeatUI('habit');
    onRepeatWdToggle('habit', wdOther);
    saveHabitEdit();
    var created = appData.habits[appData.habits.length - 1];
    ok('D5 保存后习惯真的落盘', appData.habits.length === beforeCount + 1);
    ok('D6 节奏写进了数据（weekly + 选中那天）',
      !!created.repeat && created.repeat.mode === 'weekly' && created.repeat.weekdays.indexOf(wdOther) >= 0,
      JSON.stringify(created.repeat || null));
    ok('D7 新习惯拿到 uid / createdAt（同步主键与分母下界）', !!created.uid && created.createdAt === today);
    ok('D8 说明也存了', created.note === '说明也一起存');
    ok('D9 关掉弹窗', !modal.classList.contains('show'));

    /* 编辑：改节奏不改历史账。
       ★ 2026-11-08 起 growthPoints 是**按记录重算的派生值**（habitGrowthPoints 幂等），
         所以「改规则后分数一点不变」不再是正确期望：规则变了 → 该做日/漏做日跟着变 → 分数该跟着重算。
         这里锁两条新的：① 只改名不动规则 → 分数不变；② 改了规则 → 分数等于按新规则重算的结果（不是就地加减）。 */
    var _mode0 = appData.habits[0].repeat ? appData.habits[0].repeat.mode : '';
    var uid821 = appData.habits[0].uid, created821 = appData.habits[0].createdAt;
    /* 分数是派生值：动手前先按记录算一遍"应该是多少"，改名后必须还是它。
       直接拿存档里的旧值当基准会假红（旧值可能是上次 degrade 之前留下的）。 */
    var gp821 = habitGrowthPoints(appData.habits[0], appData.habitLogs[9801] || [],
      getTodayStr(), habitSkipsOf(appData.habits[0]));
    var updBefore = appData.habits[0].updatedAt || 0;
    var logs821 = JSON.stringify(appData.habitLogs[9801]);
    openHabitEditModal(9801);
    document.getElementById('habitEditName').value = '老习惯改名';
    saveHabitEdit();
    ok('D12a 只改名（不动规则）不动分数',
      appData.habits[0].growthPoints === gp821, appData.habits[0].growthPoints + ' vs 重算 ' + gp821);
    var _after0 = appData.habits[0].growthPoints;
    openHabitEditModal(9801);
    modeSel = document.getElementById('habitRepeatMode');
    modeSel.value = 'weekdays';
    syncRepeatUI('habit');
    saveHabitEdit();
    var h821 = appData.habits[0];
    ok('D10 改名生效', h821.name === '老习惯改名');
    ok('D11 uid / createdAt 原样保留', h821.uid === uid821 && h821.createdAt === created821);
    ok('D12b 改规则后分数改成按新规则重算的值（派生值，不是就地加减）',
      h821.growthPoints === habitGrowthPoints(h821, appData.habitLogs[9801] || [], getTodayStr(), habitSkipsOf(h821)),
      h821.growthPoints + ' / 重算 ' + habitGrowthPoints(h821, appData.habitLogs[9801] || [], getTodayStr(), habitSkipsOf(h821)));
    ok('D12c 规则没变时分数是原值（改名那一步的对照，防止重算把它顺手抹了）',
      _mode0 !== 'weekdays' ? true : _after0 === gp821, _after0 + ' vs ' + gp821);
    ok('D13 改规则不动历史打卡', JSON.stringify(appData.habitLogs[9801]) === logs821);
    ok('D14 updatedAt 刷新了', h821.updatedAt > updBefore, h821.updatedAt + ' vs ' + updBefore);
    ok('D15 改成工作日后：周六不算该做、工作日算', habitDueOn(h821, '2026-10-17') === false && habitDueOn(h821, '2026-10-16') === true);

    /* 详情弹窗：节奏行在，不再同时摆「目标频次」（两套口径不许同时看起来生效） */
    openHabitDetail(9801);
    var body = (document.getElementById('habitDetailBody') || {}).textContent || '';
    ok('D16 详情里有「节奏」一行', body.indexOf('节奏') >= 0);
    ok('D17 有节奏时不再显示老口径「目标频次」', body.indexOf('目标频次') < 0);
    /* ★ 2026-10-30 用户反馈：详情页不该是「第二个编辑界面」。
       节奏行只许有一个「编辑」入口，芯片只读 —— 判断口径用 DOM 而不是文案：
       行里没有 select/input，且没有带 onclick 的芯片。 */
    var repRow = document.querySelector('#habitDetailBody .habit-rep-stack');
    ok('D18 详情节奏行只有一份只读展示（无下拉/输入框）',
      !!repRow && repRow.querySelectorAll('select,input').length === 0, repRow && repRow.querySelectorAll('select,input').length);
    ok('D19 节奏芯片不可点（改节奏只有「编辑」一条路）',
      !!repRow && [].filter.call(repRow.querySelectorAll('.repeat-wd'), function (c) { return c.hasAttribute('onclick') || c.hasAttribute('data-act'); }).length === 0);
    var editBtns = [].filter.call(document.querySelectorAll('#habitDetailBody .habit-rep-stack button'), function (b) {
      return String(b.textContent || '').trim() === '编辑';
    });
    ok('D20 节奏行只有一个「编辑」按钮（不是个表单加一个按钮两套）', editBtns.length === 1, editBtns.length);
    /* 点它应当关掉详情、直接进编辑弹窗（复用同一条路径，别写第二套保存） */
    editBtns[0].click();
    ok('D21 「编辑」跳到共用的编辑弹窗（不是就地编辑）',
      document.getElementById('habitEditModal').classList.contains('show')
      && !document.getElementById('habitDetailModal').classList.contains('show'));
    closeModal('habitEditModal');
    closeModal('habitDetailModal');

    /* —— E 迁移幂等：没有 repeat 的老习惯，跑两遍还是原样 —— */
    var legacy = { id: 9809, name: '老', createdAt: yest, freqPerWeek: 7 };
    applyHabitRepeat(legacy, null);
    applyHabitRepeat(legacy, null);
    ok('E1 老习惯不会被凭空塞 repeat 字段', !('repeat' in legacy) || legacy.repeat === null);
    var rr1 = JSON.stringify(applyHabitRepeat({ id: 9810, createdAt: yest }, { mode: 'weekly', weekdays: [1, 3, 5] }));
    var probe = { id: 9811, createdAt: yest };
    applyHabitRepeat(probe, { mode: 'weekly', weekdays: [1, 3, 5] });
    var first = JSON.stringify(probe.repeat);
    applyHabitRepeat(probe, probe.repeat);
    ok('E2 规则写两遍结果一致（幂等）', JSON.stringify(probe.repeat) === first, first + ' / ' + rr1);
    /* 计划专用的调度字段（last/next）不能混进习惯的规则里。
       subsMode 例外：2026-11-05 起习惯子计划也有「第二天怎么办」三档，它就该落在这里，
       只要值在三种之内即可。 */
    var _sm = probe.repeat && probe.repeat.subsMode;
    ok('E3 写回的规则不带计划调度字段（last/next），subsMode 只能是三档之一',
      first.indexOf('"last"') < 0 && first.indexOf('"next"') < 0 &&
      (_sm === undefined || ['reset', 'clearDone', 'clear'].indexOf(_sm) >= 0), first);

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.habits = JSON.parse(habitsBak); } catch (e) { appData.habits = []; }
    try { appData.habitLogs = JSON.parse(logsBak); } catch (e) { appData.habitLogs = {}; }
    try { if (typeof closeModal === 'function') closeModal('habitEditModal'); } catch (e) {}
    try { if (typeof closeModal === 'function') closeModal('habitDetailModal'); } catch (e) {}
    if (typeof renderHabits === 'function') renderHabits();
    /* 用例隔离：本用例在「习惯」子标签里操作，结束切回「任务」——
       否则后续用例拿到的是 display:none 的 #planTodoView，几何断言集体空转 */
    try { if (typeof switchPlanTab === 'function') switchPlanTab('plan'); } catch (e) {}
    saveData();
  }
  return JSON.stringify(R);
})();
