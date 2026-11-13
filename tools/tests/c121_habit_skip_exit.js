/* C121 习惯「跳过日」的退出路径 + 跨入口口径一致（2026-10-30 审查修复回归）

   这一轮的六个修复点，每条一个断言组 —— 它们全是"代码能跑、界面看着也对，
   但数字悄悄错了"的那类问题，只有把行为钉死才防得住回退：

   A 跳过 → 补卡：补卡必须算数（S1）
   B 打卡后再点跳过：按钮不给、接口也拦住（S2）
   C 同一习惯的连续数：列表与 getHabitStreak 必须一致（M1）
   D 窗口内无应做日：不显示"达标 0%"（M2）
   E 删习惯：跳过日一起清（M3）
   F 跳过期：有 400 天上限（L1）

   数据全部临时造、结尾还原。 */
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var habitsBak = JSON.stringify(appData.habits || []);
  var logsBak = JSON.stringify(appData.habitLogs || {});
  var skipsBak = JSON.stringify(appData.habitSkips || {});
  var catsBak = JSON.stringify(appData.habitCats || []);
  var today = getTodayStr();
  var yest = addDaysStr(today, -1);
  var list = document.getElementById('habitList');

  try {
    appData.habitCats = []; appData.habitCatOpen = {};

    /* —— A 跳过 → 补卡：补卡必须算数 —— */
    appData.habits = [{ id: 99601, uid: 'h99601', name: '审查A', createdAt: addDaysStr(today, -30), growthPoints: 0, freqPerWeek: 7 }];
    appData.habitLogs = { 99601: [yest, addDaysStr(today, -2)] };
    appData.habitSkips = {};
    var hA = appData.habits[0];
    var aBefore = habitStats(hA, appData.habitLogs[99601], today, 30, habitSkipsOf(hA));

    toggleHabitSkip(99601);                     /* 先收起（今天不看） */
    ok('A1 收起来只记 h.skipOn，不写跳过记录（眼睛不是请假）',
      hA.skipOn === today && (appData.habitSkips['99601'] || []).indexOf(today) < 0,
      JSON.stringify(appData.habitSkips['99601'] || null) + ' skipOn=' + hA.skipOn);
    toggleHabit(99601);                         /* 后来又做了，补一次卡 */
    var aAfter = habitStats(hA, appData.habitLogs[99601], today, 30, habitSkipsOf(hA));
    ok('A2 跳过后补卡：打卡记录写进去了', (appData.habitLogs[99601] || []).indexOf(today) >= 0);
    ok('A3 跳过后补卡：当天的跳过记录被撤掉',
      (appData.habitSkips['99601'] || []).indexOf(today) < 0,
      JSON.stringify(appData.habitSkips['99601'] || null));
    ok('A4 跳过后补卡：这次补卡算进分子', aAfter.done === aBefore.done + 1,
      'before=' + aBefore.done + ' after=' + aAfter.done);
    ok('A5 跳过后补卡：连续数跟着 +1', aAfter.cur === aBefore.cur + 1,
      'before=' + aBefore.cur + ' after=' + aAfter.cur);

    /* —— B 打卡后再点跳过：不给按钮、接口也拦 ——
       独立造一条"今天已打卡、没有任何跳过记录"的习惯，别让 A 组的中间状态影响判断。 */
    appData.habits = [{ id: 99607, uid: 'h99607', name: '审查B', createdAt: addDaysStr(today, -30), growthPoints: 0, freqPerWeek: 7 }];
    appData.habitLogs = { 99607: [today] };
    appData.habitSkips = {};
    var hB = appData.habits[0];
    renderHabits();
    var rowB = list.querySelector('.habit-item[data-id="99607"]');
    ok('B1 已打卡的行上没有「跳过」眼睛', !!rowB && !rowB.querySelector('.habit-eye'),
      rowB ? (rowB.querySelector('.habit-eye') ? '有眼睛' : '无眼睛') : '没找到行');
    var bDone = habitStats(hB, appData.habitLogs[99607], today, 30, habitSkipsOf(hB)).done;
    toggleHabitSkip(99607);                     /* 绕过 UI 直接调接口 */
    ok('B2 已打卡时调 toggleHabitSkip 被拦住（不写跳过记录）',
      (appData.habitSkips['99607'] || []).indexOf(today) < 0,
      JSON.stringify(appData.habitSkips['99607'] || null));
    ok('B3 被拦住后分子不受影响',
      habitStats(hB, appData.habitLogs[99607], today, 30, habitSkipsOf(hB)).done === bDone,
      'before=' + bDone + ' after=' + habitStats(hB, appData.habitLogs[99607], today, 30, habitSkipsOf(hB)).done);

    /* —— C 连续数：列表与 getHabitStreak 同口径 —— */
    appData.habits = [{ id: 99602, uid: 'h99602', name: '审查C', createdAt: addDaysStr(today, -30), growthPoints: 0, freqPerWeek: 7 }];
    appData.habitLogs = { 99602: [yest] };
    appData.habitSkips = { 99602: [yest] };
    var hC = appData.habits[0];
    var statsCur = habitStats(hC, appData.habitLogs[99602], today, 30, habitSkipsOf(hC)).cur;
    var entryCur = (typeof getHabitStreak === 'function') ? getHabitStreak(99602) : statsCur;
    ok('C1 昨天被跳过时，列表与 achievement 入口的连续数一致',
      String(statsCur) === String(entryCur), 'stats=' + statsCur + ' entry=' + entryCur);

    /* 规则型也校一遍：每周一三五，本周命中日都打了 */
    appData.habits = [{
      id: 99603, uid: 'h99603', name: '审查C2', createdAt: addDaysStr(today, -60), growthPoints: 0,
      repeat: { mode: 'weekly', weekdays: [1, 3, 5] }
    }];
    var wk = weekStartStr(today);
    appData.habitLogs = { 99603: [wk] };
    appData.habitSkips = {};
    var hC2 = appData.habits[0];
    ok('C2 规则型：两个入口也一致',
      String(habitStats(hC2, appData.habitLogs[99603], today, 30, habitSkipsOf(hC2)).cur)
      === String(getHabitStreak(99603)),
      'stats=' + habitStats(hC2, appData.habitLogs[99603], today, 30, []).cur + ' entry=' + getHabitStreak(99603));

    /* —— D 窗口内无应做日：不写"达标 0%" ——
       ★ 真正常见的场景不是"每月 31 号"，而是**规则设了截止日、已经过期**：
         习惯还在列表里（用户没归档），但最近 30 天一次都不该做。
         以前这里 expected=0 → rate=0 → 界面写"达标 0%"，像是他整月偷懒。 */
    var hD = { id: 99604, uid: 'h99604', name: '审查D', createdAt: '2026-01-01', growthPoints: 0, repeat: { mode: 'daily', until: '2026-01-05' } };
    appData.habits = [hD];
    appData.habitLogs = { 99604: [] };
    appData.habitSkips = {};
    var noDueToday = '2026-03-05';   /* 窗口 2/4~3/5，整段都在截止日之后 */
    var hsD = habitStats(hD, [], noDueToday, 30);
    ok('D1 规则已过截止日：窗口内应做日 = 0', hsD.expected === 0, 'expected=' + hsD.expected);
    var lineD = habitStatsLine(hD, noDueToday);
    ok('D2 此时不显示「达标 0%」', lineD.indexOf('达标 0%') < 0, lineD);
    ok('D3 改为说明「本期无需打卡」', lineD.indexOf('无需打卡') >= 0, lineD);

    /* —— E 删习惯：跳过日一起清 —— */
    appData.habits = [{ id: 99605, uid: 'h99605', name: '审查E', createdAt: addDaysStr(today, -10), growthPoints: 0, freqPerWeek: 7 }];
    appData.habitLogs = { 99605: [yest] };
    appData.habitSkips = { 99605: [yest] };
    /* 删除走确认框：测试里把它短路掉（同 C119 的做法） */
    var rcBak = window.rsConfirm, cnfBak = window.confirm;
    window.rsConfirm = function () { return { then: function (cb) { cb(true); } }; };
    window.confirm = function () { return true; };
    deleteHabit(99605);
    window.rsConfirm = rcBak; window.confirm = cnfBak;
    ok('E1 删除习惯后 habitSkips 里没有这个 key',
      !(appData.habitSkips && appData.habitSkips['99605']),
      JSON.stringify(appData.habitSkips && appData.habitSkips['99605']));
    ok('E2 打卡记录也一起清了', !(appData.habitLogs && appData.habitLogs['99605']));

    /* —— F 跳过期有上限 —— */
    appData.habits = [{ id: 99606, uid: 'h99606', name: '审查F', createdAt: addDaysStr(today, -600), growthPoints: 0, freqPerWeek: 7 }];
    appData.habitLogs = { 99606: [] };
    appData.habitSkips = { 99606: [] };
    for (var i = 0; i < 500; i++) appData.habitSkips['99606'].push(addDaysStr(today, -i));
    _habitSetSkip(appData.habits[0], today, true);
    var kept = (appData.habitSkips['99606'] || []).length;
    ok('F1 跳过期截断到 400 天上限', kept <= 400, '实际 ' + kept + ' 条');
    ok('F2 截断保留的是最近的那批（今天还在）',
      (appData.habitSkips['99606'] || []).indexOf(today) >= 0);
  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.habits = JSON.parse(habitsBak); } catch (e1) { appData.habits = []; }
    try { appData.habitLogs = JSON.parse(logsBak); } catch (e2) { appData.habitLogs = {}; }
    try { appData.habitSkips = JSON.parse(skipsBak); } catch (e3) { appData.habitSkips = {}; }
    try { appData.habitCats = JSON.parse(catsBak); } catch (e4) { appData.habitCats = []; }
    if (typeof renderHabits === 'function') renderHabits();
    try { if (typeof switchPlanTab === 'function') switchPlanTab('plan'); } catch (e5) {}
  }
  return JSON.stringify(R);
})();
