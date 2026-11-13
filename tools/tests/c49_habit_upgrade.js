/* C49 习惯功能升级（参考「小日常」/习惯类 App 的常规做法）

   升级点：列表行信息收敛（只留当前连续 + 近 30 天达标），历史最长/成长点/段位
   移到详情弹窗；窗口达标率对「每周 N 次」的习惯按 天数×N/7 折算，不是一律按天算；
   归档的习惯不混在在用列表里，单列一区；当天已打卡的行有勾选态与热力图。
   ★ 纯函数（habitStats 的折算与边界）在 unit_pure.js，这里只打运行时。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var habitsBak = JSON.stringify(appData.habits || []);
  var logsBak = JSON.stringify(appData.habitLogs || {});
  var today = getTodayStr(), y1 = addDaysStr(today, -1), y2 = addDaysStr(today, -2);
  try {
    appData.habits = [
      { id: 9701, name: '读书', createdAt: addDaysStr(today, -60), growthPoints: 40, freqPerWeek: 7 },
      { id: 9702, name: '背单词', createdAt: addDaysStr(today, -60), growthPoints: 120, freqPerWeek: 3, archived: true },
      { id: 9703, name: '跑步', createdAt: addDaysStr(today, -60), growthPoints: 0, freqPerWeek: 2 }
    ];
    appData.habitLogs = { 9701: [y2, y1, today], 9702: [y1], 9703: [y2] };
    saveData();
    if (typeof switchPlanTab === 'function') switchPlanTab('habit');
    if (typeof renderHabits === 'function') renderHabits();

    /* 列表行：只两条信息，不再挤成三行 */
    var line = habitStatsLine(appData.habits[0], today);
    ok('① 列表行显示「当前连续」', line.indexOf('连续') >= 0 && line.indexOf('3') >= 0);
    ok('①b 列表行显示「近30天达标」', line.indexOf('达标') >= 0 && line.indexOf('%') >= 0);
    ok('①c 列表行不再塞历史最长/成长点（那些进详情）',
       line.indexOf('最长') < 0 && line.indexOf('成长') < 0);

    var listHtml = (document.getElementById('habitList') || {}).innerHTML || '';
    ok('② 行上有连续/达标那一行（habit-streak）', listHtml.indexOf('habit-streak') >= 0);
    ok('②b 行上有段位徽标', listHtml.indexOf('habit-stage-badge') >= 0);
    ok('②c 行上有 30 天热力图', listHtml.indexOf('habit-heat') >= 0);
    ok('②d 今天已打卡的那条是勾选态', listHtml.indexOf('habit-checkbox checked') >= 0);

    /* 归档区：在用/已归档分开，归档的不给上下移按钮 */
    ok('③ 归档的习惯单独一区', listHtml.indexOf('已归档') >= 0);
    var archStart = listHtml.indexOf('已归档');
    ok('③b 归档区里有「背单词」，在用区里没有',
       listHtml.indexOf('背单词', archStart) > archStart &&
       listHtml.slice(0, archStart).indexOf('背单词') < 0);

    /* 详情弹窗：把被收走的数字都放回来了 */
    if (typeof openHabitDetail === 'function') openHabitDetail(9701);
    var body = (document.getElementById('habitDetailBody') || {}).textContent || '';
    ok('④ 详情里有当前连续', body.indexOf('当前连续') >= 0);
    ok('④b 详情里有历史最长', body.indexOf('历史最长') >= 0);
    ok('④c 详情里有近30天达标', body.indexOf('达标') >= 0);
    ok('④d 详情里有成长点/段位', body.indexOf('成长点') >= 0);

    /* 每周 N 次：达标率按 N/7 折算，不是按天算 */
    var hs7 = habitStats(appData.habits[0], appData.habitLogs[9701], today, HABIT_WINDOW_DAYS);
    var hs3 = habitStats(appData.habits[1], appData.habitLogs[9701], today, HABIT_WINDOW_DAYS);
    ok('⑤ 每天的习惯：应打 = 窗口天数', hs7.expected === HABIT_WINDOW_DAYS);
    ok('⑤b 每周 3 次：应打按 天×3/7 折算（不是 30 天全勤）',
       hs3.expected > 0 && hs3.expected < HABIT_WINDOW_DAYS && hs3.expected === Math.max(1, Math.round(HABIT_WINDOW_DAYS * 3 / 7)));
    ok('⑤c 达标率封顶 100%', hs7.rate <= 1 && hs3.rate <= 1);
    ok('⑤d 连着打的 3 天算连续 3 天', hs7.cur === 3);
    /* ⑤e 刚建的习惯不该按整个窗口算「应打」——只算它存在的那几天
       （新建第 3 天就要求 30 天全勤，等于开局即不合格） */
    var young = { id: 9704, name: '新习惯', createdAt: addDaysStr(today, -4), growthPoints: 0, freqPerWeek: 7 };
    var hsY = habitStats(young, [], today, HABIT_WINDOW_DAYS);
    ok('⑤e 刚建 5 天的习惯：应打只算这 5 天', hsY.expected === 5);
    var young3 = { id: 9705, name: '新习惯3', createdAt: addDaysStr(today, -4), growthPoints: 0, freqPerWeek: 3 };
    ok('⑤f 刚建 5 天 + 每周 3 次：应打 = max(1, 5×3/7)', habitStats(young3, [], today, HABIT_WINDOW_DAYS).expected === Math.max(1, Math.round(5 * 3 / 7)));

    /* 打卡走界面入口：统计跟着涨
       ★ 2026-10-30 口径变更（见 习惯项目调研.md §4②）：freqPerWeek < 7 的习惯改成
         「配额型」，连续数按「连续达标周数」计、不再数自然日 —— 所以这里改验证本周进度。
         「打卡后连续天数 +1」由每天型的 9701 继续覆盖（⑥b2），老口径没有被丢掉。 */
    appData.habitLogs[9703] = [y2, y1];
    var w0 = habitStats(appData.habits[2], appData.habitLogs[9703], today, HABIT_WINDOW_DAYS).weekDone;
    if (typeof toggleHabit === 'function') toggleHabit(9703);
    ok('⑥ 打卡后当天记上了', (appData.habitLogs[9703] || []).indexOf(today) >= 0);
    ok('⑥b 配额型（每周 2 次）打卡后本周进度 +1',
       habitStats(appData.habits[2], appData.habitLogs[9703], today, HABIT_WINDOW_DAYS).weekDone === w0 + 1,
       'weekDone ' + w0 + ' → ' + habitStats(appData.habits[2], appData.habitLogs[9703], today, HABIT_WINDOW_DAYS).weekDone);
    ok('⑥b2 每天型：昨天、前天、今天都打 = 连续 3 天',
       habitStats(appData.habits[0], appData.habitLogs[9701], today, HABIT_WINDOW_DAYS).cur === 3,
       habitStats(appData.habits[0], appData.habitLogs[9701], today, HABIT_WINDOW_DAYS).cur);
    if (typeof toggleHabit === 'function') toggleHabit(9703);
    ok('⑥c 再点一次取消打卡', (appData.habitLogs[9703] || []).indexOf(today) < 0);

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.habits = JSON.parse(habitsBak); } catch (e) { appData.habits = []; }
    try { appData.habitLogs = JSON.parse(logsBak); } catch (e) { appData.habitLogs = {}; }
    try { if (typeof closeModal === 'function') closeModal('habitDetailModal'); } catch (e) {}
    if (typeof renderHabits === 'function') renderHabits();
    /* 用例隔离：本用例在「习惯」子标签里操作，结束必须切回「任务」——
       否则后续用例（如 C52 的网格几何）拿到的是 display:none 的 #planTodoView，
       像素高度全为 0，一串几何断言集体空转（曾经真的这么红过）。 */
    try { if (typeof switchPlanTab === 'function') switchPlanTab('plan'); } catch (e) {}
    saveData();
  }
  return JSON.stringify(R);
})();
