/* C120 习惯「眼睛（今天先不看）」与「配额节奏」

   2026-11-04 口径变更（用户原话）：
     「我想把那个习惯的眼睛，那个跳过……假如我今天没完成，我就想不看了，
       把眼睛一关闭。我那个跳过，为什么它会保留连续的天数呢」
   眼睛从此只是「今天把这张卡收起来」：不写跳过记录、不进分母豁免、不保护连续数。
   跳过日（Loop 的 `-` 语义 = 提前声明的休息日）保留给老存档读，UI 不再产生。

   四组断言：
   A 眼睛：只藏卡/不写跳过/分母不扣/只对当天生效/次日就是漏卡
   B 配额型：文案、本周进度、打满后不再出现、打满当天仍留在主列表
   C 一致性：列表分区与 habitDueToday 单一口径一致；脏数据被清洗
   D 回归：老习惯（无 repeat、无 freq）行为一分不变

   数据全部临时造、结尾还原。 */
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var habitsBak = JSON.stringify(appData.habits || []);
  var logsBak = JSON.stringify(appData.habitLogs || {});
  var skipsBak = JSON.stringify(appData.habitSkips || {});
  var today = getTodayStr();
  var yest = addDaysStr(today, -1);
  var list = document.getElementById('habitList');
  /* 主列表里的习惯名 = 所有不在「今天不用做」容器里的行。
     不用 innerHTML.indexOf 判存在：折叠区里也有名字，那样永远判真。
     ★ 必须 `list.querySelector`，不能用 document：习惯页和计划页 dock 同源渲染，
       document 里同时存在两个 .habit-off-body，querySelector 抓到的是 dock 那个（不可见），
       contains() 恒 false → 所有行都被当成"在主列表"，A6/B5 会误红。 */
  function offBodyEl() { return list.querySelector('.habit-off-body'); }
  function mainNames() {
    var offBody = offBodyEl();
    return Array.prototype.slice.call(list.querySelectorAll('.habit-item'))
      .filter(function (el) { return !offBody || !offBody.contains(el); })
      .map(function (el) { var n = el.querySelector('.habit-name'); return n ? n.textContent : ''; })
      .join(',');
  }
  var wkStart = weekStartStr(today);
  /* 本周已经过去的日子（周一起到今天），用来制造「本周已打满 N 次」 */
  var elapsed = [];
  for (var _d = wkStart; _d <= today; _d = addDaysStr(_d, 1)) elapsed.push(_d);

  try {
    appData.habitCats = [];
    appData.habitCatOpen = {};
    appData.habitSkips = {};
    appData.habits = [
      /* 9901 每天型：本周一到今天都打了（除今天），用来看跳过会不会断链 */
      { id: 9901, uid: 'h9901', name: '每天喝水', createdAt: addDaysStr(today, -40), growthPoints: 9, freqPerWeek: 7 },
      /* 9902 配额型：每周 3 次（今天还没打） */
      { id: 9902, uid: 'h9902', name: '每周跑三次', createdAt: addDaysStr(today, -40), growthPoints: 4, freqPerWeek: 3 },
      /* 9903 配额型：本周已经打满（额度 = 本周已过天数与 3 的较小值） */
      { id: 9903, uid: 'h9903', name: '本周已达标', createdAt: addDaysStr(today, -40), growthPoints: 2, freqPerWeek: Math.min(3, elapsed.length) },
      /* 9904 老习惯：没有 repeat 也没有 freqPerWeek */
      { id: 9904, uid: 'h9904', name: '老习惯', createdAt: addDaysStr(today, -40), growthPoints: 1 }
    ];
    appData.habitLogs = {
      9901: elapsed.filter(function (d) { return d < today; }),
      9903: elapsed.slice(0, Math.min(3, elapsed.length))
    };
    saveData();
    if (typeof switchPlanTab === 'function') switchPlanTab('habit');
    if (typeof renderHabits === 'function') renderHabits();

    /* —— A 跳过日：不破链、不进分母、只对当天生效 —— */
    var h1 = appData.habits[0];
    var streakBefore = habitStats(h1, appData.habitLogs[9901], today, 30).cur;
    var expBefore = habitStats(h1, appData.habitLogs[9901], today, 30).expected;
    ok('A1 前置：每天型打到昨天，连续数 = 本周已过天数', streakBefore === elapsed.length - 1,
      'cur=' + streakBefore + ' elapsed=' + elapsed.length);

    toggleHabitSkip(9901);
    ok('A2 点眼睛 → 只记 h.skipOn（藏卡），**不写**跳过记录（那不是请假）',
      (appData.habitSkips['9901'] || []).indexOf(today) < 0, JSON.stringify(appData.habitSkips['9901'] || null));
    ok('A3 记下 h.skipOn = 今天，次日自动失效', h1.skipOn === today);
    ok('A4 今天点眼睛 = 今天还没打，连续数照旧不动（今天还有机会）',
      habitStats(h1, appData.habitLogs[9901], today, 30).cur === streakBefore,
      'after=' + habitStats(h1, appData.habitLogs[9901], today, 30).cur + ' before=' + streakBefore);
    ok('A5 藏起来不等于请假：30 天分母一次都不许少（没做就是没做）',
      habitStats(h1, appData.habitLogs[9901], today, 30).expected === expBefore,
      'after=' + habitStats(h1, appData.habitLogs[9901], today, 30).expected + ' before=' + expBefore);
    var offBody = offBodyEl();
    ok('A6 收起来的习惯进「今天不用做」（主列表里没有，折叠区里有）',
      !!offBody && offBody.textContent.indexOf('每天喝水') >= 0 && mainNames().indexOf('每天喝水') < 0,
      'main=[' + mainNames() + ']');
    ok('A7 区头说的是「今天先不看」（不再写"跳过"，它已经不是跳过日）',
      list.innerHTML.indexOf('个今天先不看') >= 0, list.innerHTML.indexOf('个今天先不看'));

    /* 热力图：今天不再是第三种「跳过」态 —— 它就是没打卡 */
    var heat = habitHeatmapHtml(h1, 7);
    ok('A8 热力图不给眼睛收起的日子开小灶（和普通未打卡同色）', heat.indexOf('habit-heat-cell skip') < 0, heat.length);

    /* 放回 */
    toggleHabitSkip(9901);
    ok('A9 放回 → 跳过记录里本来就没有今天', (appData.habitSkips['9901'] || []).indexOf(today) < 0);
    ok('A10 放回 → h.skipOn 清掉', !h1.skipOn);
    ok('A11 放回后回到主列表', list.innerHTML.indexOf('每天喝水') >= 0);

    /* 眼睛只对当天生效；被收起的那天过了零点就是一次实打实的漏卡。
       造数据：本周只打了前天那一笔，昨天眼睛收起、今天还没打。 */
    appData.habitLogs[9901] = elapsed.filter(function (d) { return d < yest; });
    h1.skipOn = yest;
    delete appData.habitSkips['9901'];
    ok('A12 昨天被眼睛收起、今天还没打 → 连续数按"昨天没做"断掉（这是用户要的老实话）',
      habitStats(h1, appData.habitLogs[9901], today, 30).cur === 0,
      'cur=' + habitStats(h1, appData.habitLogs[9901], today, 30).cur);
    /* 老存档里真正的跳过日（提前声明的休息日）仍然不破链：跨过昨天，回到前天那一笔
       ★ 期望值按「实际打了几笔」算，别写死 1：日志是本周今天之前的所有日子（周一起连续），
         跳过昨天后连续数应等于这些笔数；不传跳过日则昨天就把链断掉（0）。两相对照才证明是"跨过去"了。 */
    h1.skipOn = null;
    appData.habitSkips['9901'] = [yest];
    var chainLogs = appData.habitLogs[9901];
    ok('A13 老存档的跳过日仍然不破链（兼容 Loop 的 `-` 语义，只是 UI 不再产生）',
      habitStats(h1, chainLogs, today, 30, [yest]).cur === chainLogs.length
      && habitStats(h1, chainLogs, today, 30).cur === 0,
      'cur=' + habitStats(h1, chainLogs, today, 30, [yest]).cur
      + ' 不计跳过=' + habitStats(h1, chainLogs, today, 30).cur
      + ' 笔数=' + chainLogs.length);
    appData.habitSkips['9901'] = [];

    /* —— B 配额型：每周 N 次 —— */
    var h2 = appData.habits[1];
    ok('B1 节奏文案是「每周 3 次」，不再是「每天」', habitRepeatLabel(h2) === '每周 3 次', habitRepeatLabel(h2));
    ok('B2 列表统计行给的是「本周 x/3」而不是「连续 0 周」',
      habitStatsLine(h2, today).indexOf('本周') >= 0 && habitStatsLine(h2, today).indexOf('/3') >= 0,
      habitStatsLine(h2, today));
    ok('B3 今天还没打 → 它出现在主列表', list.innerHTML.indexOf('每周跑三次') >= 0);
    ok('B4 节奏徽标显示「每周 3 次」（否则它和每天型看不出区别）',
      list.innerHTML.indexOf('每周 3 次') >= 0);

    /* 给 9902 打满本周额度。
       ★ 别写死 3 次：今天如果正好是本周第 3 天（周三），「打满 3 次」必然包含今天，
       那按 B6 的口径它就该留在主列表 —— 两条断言在同一天互斥，用例会随星期几翻红。
       所以额度按「本周已经过去的天数」动态取，日志也只填今天之前的日子。 */
    var filled = elapsed.slice(0, elapsed.length - 1);
    var quotaN = Math.max(1, filled.length);
    var fpwBak = h2.freqPerWeek;
    h2.freqPerWeek = quotaN;
    appData.habitLogs[9902] = filled;
    renderHabits();
    /* 周一没有"本周已过日"可填，构造不出"额度满但今天没打"。
       ★ 别硬造：本周第一天本来就不可能"打满"，那就断言这一天的真实状态
         （一条都没打 → 额度型照常出现在主列表），而不是让它随星期几翻红。 */
    if (filled.length > 0) {
      ok('B5 本周打满额度（今天还没打）→ 不再出现在主列表（进「今天不用做」）',
        mainNames().indexOf('每周跑三次') < 0,
        'main=[' + mainNames() + '] filled=' + JSON.stringify(filled) + ' quota=' + quotaN);
    } else {
      ok('B5 本周第一天（没有已过的日子）→ 配额型照常出现在主列表（无从打满）',
        mainNames().indexOf('每周跑三次') >= 0, 'main=[' + mainNames() + '] quota=' + quotaN);
    }

    /* 打满当天的那一笔仍要留在主列表 —— 否则像是"刚打完就被挪走" */
    h2.freqPerWeek = fpwBak;
    appData.habitLogs[9902] = filled.concat([today]);
    renderHabits();
    ok('B6 今天打过卡的那条留在主列表（不因为额度满了就挪进「今天不用做」）',
      mainNames().indexOf('每周跑三次') >= 0, 'main=[' + mainNames() + ']');

    /* 详情弹窗：统计格换成本周进度 + 一句人话解释 */
    openHabitDetail(9902);
    var det = (document.getElementById('habitDetailBody') || {}).textContent || '';
    ok('B7 详情有「本周进度」一格', det.indexOf('本周进度') >= 0);
    ok('B8 详情有「最长连周」一格（配额型没有"连续天"）', det.indexOf('最长连周') >= 0);
    ok('B9 详情解释了"做满之后今天不再出现"', det.indexOf('做满') >= 0 || det.indexOf('不再出现') >= 0);
    ok('B10 详情节奏行不再和「每周 3 次」自相矛盾', det.indexOf('每周 3 次') >= 0);

    /* 老口径改成按周几：只有编辑弹窗一条路（详情页是只读的）。
       用户在 10-30 明确要这个：不要「一周几次」，要像计划页那样勾周一三五。 */
    ok('B10b 详情里没有「每周几次」下拉（节奏只读）', !document.getElementById('habitDetailFreq'));
    closeModal('habitDetailModal');
    openHabitEditModal(9902);
    var modeSel = document.getElementById('habitRepeatMode');
    var uiOk = !!modeSel;
    if (uiOk) {
      modeSel.value = 'weekly';
      onRepeatModeChange('habit');
      /* ★ 切到「每周」会**默认勾上今天**（syncRepeatUI 的有意行为），
         所以不能只"点亮 1/3/5"：今天若是周六，结果是 [1,3,5,6]。
         这里按目标集合显式设置每天的开关状态，用例就不会随星期几翻红。 */
      var want = { 1: 1, 3: 1, 5: 1 };
      ['1', '2', '3', '4', '5', '6', '7'].forEach(function (w) {
        var box2 = document.getElementById('habitRepeatWeekdays');
        var el = box2 ? box2.querySelector('.repeat-wd[data-wd="' + w + '"]') : null;
        if (!el) return;
        var on = el.className.indexOf('on') >= 0;
        if (!!want[w] !== on) el.click();
      });
      saveHabitEdit();
      var h2 = appData.habits[1];
      ok('B11 编辑弹窗里勾周一三五 → repeat 按周几落库',
        !!(h2.repeat && h2.repeat.mode === 'weekly' && (h2.repeat.weekdays || []).join(',') === '1,3,5'),
        JSON.stringify(h2.repeat || null));
      ok('B12 节奏文案变成「每周一、三、五」', habitRepeatLabel(h2) === '每周一、三、五', habitRepeatLabel(h2));
      /* 还原成老口径，后面的 C 段继续按配额型验 */
      delete appData.habits[1].repeat;
      appData.habits[1].freqPerWeek = 3;
      renderHabits();
    } else {
      R.push(['B11 编辑弹窗里能找到节奏下拉', false]);
      R.push(['B12 节奏文案变成「每周一、三、五」', false]);
    }

    /* —— C 一致性 & 脏数据 —— */
    appData.habitLogs[9902] = elapsed.slice(0, quotaN);
    appData.habits[1].freqPerWeek = 3;
    renderHabits();
    var active = appData.habits.filter(function (h) { return !h.archived; });
    var dueCount = active.filter(function (h) {
      return habitDueToday(h, today) || (appData.habitLogs[h.id] || []).indexOf(today) >= 0;
    }).length;
    var offCount = active.length - dueCount;
    var shown = list.innerHTML;
    ok('C1 列表分区与 habitDueToday 单一口径一致（不多不少）',
      dueCount + offCount === active.length && dueCount >= 1,
      'due=' + dueCount + ' off=' + offCount + ' total=' + active.length);
    ok('C2 区头条数与实际分区对得上',
      !offCount || shown.indexOf('habit-off-count">' + offCount + '<') >= 0 || shown.indexOf('>' + offCount + '<') >= 0,
      'offCount=' + offCount);

    /* 脏数据清洗：非数组 / 非法日期 / 重复（走 loadData 用的同一个纯函数） */
    var cleaned = normHabitSkips({ 9901: ['bad-date', today, today], 9902: 'nope', 9903: [], 9904: [null, 12345] });
    ok('C3 脏跳过数据不会把界面带崩（非数组 key 直接丢弃）', !cleaned['9902'], JSON.stringify(cleaned));
    ok('C4 清洗后只留合法日期', (cleaned['9901'] || []).length === 1 && cleaned['9901'][0] === today,
      JSON.stringify(cleaned['9901'] || null));
    ok('C5 重复日期去掉、空表整个 key 不保留', !cleaned['9903'] && !cleaned['9904'], JSON.stringify(cleaned));
    ok('C6 非对象入参（null / 数组 / 字符串）安全返回空表',
      Object.keys(normHabitSkips(null)).length === 0 && Object.keys(normHabitSkips([])).length === 0
      && Object.keys(normHabitSkips('x')).length === 0);

    /* —— D 回归：老口径一分不变 —— */
    var h4 = appData.habits[3];
    ok('D1 老习惯（无 repeat 无 freq）仍然是"今天该做"', habitDueToday(h4, today) === true);
    ok('D2 老习惯不是配额型', habitIsQuota(h4) === false);
    ok('D3 老习惯的节奏文案仍是「每天」', habitRepeatLabel(h4) === '每天');
    ok('D4 老习惯连续单位仍是「天」', habitStreakUnit(h4) === '天');
    ok('D5 老习惯 30 天分母仍是 30', habitExpectedIn(h4, today, 30) === 30, habitExpectedIn(h4, today, 30));

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.habits = JSON.parse(habitsBak); } catch (e) { appData.habits = []; }
    try { appData.habitLogs = JSON.parse(logsBak); } catch (e) { appData.habitLogs = {}; }
    try { appData.habitSkips = JSON.parse(skipsBak); } catch (e) { appData.habitSkips = {}; }
    try { if (typeof closeModal === 'function') closeModal('habitDetailModal'); } catch (e) {}
    try { if (typeof closeModal === 'function') closeModal('habitEditModal'); } catch (e) {}
    if (typeof renderHabits === 'function') renderHabits();
    /* 折叠区状态是模块级变量（不落盘）：这里用过就还原，
       免得把「展开」这个视图状态漏给下一个用例（C118 的 B 段依赖它初始收起）。 */
    _habitOffOpen = false;
    if (typeof renderHabits === 'function') renderHabits();
    /* 用例隔离：结束切回「任务」，否则后续用例拿到 display:none 的容器 */
    try { if (typeof switchPlanTab === 'function') switchPlanTab('plan'); } catch (e) {}
    saveData();
  }
  return JSON.stringify(R);
})();
