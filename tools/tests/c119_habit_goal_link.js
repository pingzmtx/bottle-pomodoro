/* C119 习惯 ↔ 目标 关联双向一致（2026-10-30）

   用户原话：「我在目标新建了个目标关联习惯，我那里关联上了，但是在习惯那里显示没有关联」

   根因（改前的代码就是这样）：
     目标页写 g.habitId（00b 的进度计算只认它），
     习惯详情读 h.lifeGoalId —— 两个字段互不相干，谁也没写过对方。
     于是「目标里选好了 → 习惯里显示未关联」；
     反过来在习惯里挂了目标，目标那边也只显示「未测量」。

   断言分五组：
   A 目标侧选中习惯（走真实保存路径 saveLifeGoal）→ 目标拿真源、习惯拿镜像
   B 习惯详情能看见这条关联（chips 选中态），且列表里只有一个目标
   C 习惯侧勾选/取消 → 目标 habitId 跟着动，镜像不倒退
   D 删除习惯 → 目标不再指向一个不存在的习惯
   E 老存档只有一边有值（只写了 h.lifeGoalId）→ 领域统计仍然认它

   数据全部临时造、结尾还原。 */
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var habitsBak = JSON.stringify(appData.habits || []);
  var logsBak = JSON.stringify(appData.habitLogs || {});
  var goalsBak = JSON.stringify(appData.lifeGoals || []);
  var orderBak = JSON.stringify(appData.lifeGoalOrder || []);
  var rcBak = window.rsConfirm;
  var cnfBak = window.confirm;
  var draftBak = _lifeGoalDraft;
  var editBak = _lifeGoalEditing;

  var today = getTodayStr();
  var yest = addDaysStr(today, -1);

  try {
    /* 一个习惯、两个目标：多对一是正常用法（跑步既服务「跑 500 公里」也服务「每周 3 次」） */
    appData.habits = [
      { id: 9901, uid: 'h9901', name: '跑步', createdAt: addDaysStr(today, -30), growthPoints: 6, freqPerWeek: 7 }
    ];
    appData.habitLogs = { 9901: [yest, today] };
    appData.lifeGoals = [
      {
        id: 'lg9901', uid: 'lg09901', title: '跑满 500 公里', areaId: 'area_health',
        horizon: 'year', status: 'active', startDate: addDaysStr(today, -20), targetDate: today,
        progressSource: 'habit', habitId: 9901, milestones: [], measure: { items: [] }
      },
      {
        id: 'lg9902', uid: 'lg09902', title: '每周跑三次', areaId: 'area_health',
        horizon: 'month', status: 'active', startDate: addDaysStr(today, -10), targetDate: today,
        progressSource: 'habit', habitId: null, milestones: [], measure: { items: [] }
      }
    ];
    appData.lifeGoalOrder = ['lg09901', 'lg09902'];
    saveData();

    /* —— A 目标侧保存：走用户真实路径（草稿 + saveLifeGoal）—— */
    _lifeGoalEditing = 'lg9902';
    _lifeGoalDraft = JSON.parse(JSON.stringify(appData.lifeGoals[1]));
    _lifeGoalDraft.habitId = 9901;               /* 用户在弹窗里选了「跑步」 */
    saveLifeGoal();
    var g2 = lifeGoalById('lg9902');
    ok('A1 目标侧选习惯 → goal.habitId 落盘', String(g2.habitId) === '9901', g2.habitId);
    var hRun = appData.habits[0];
    ok('A2 镜像 h.lifeGoalId 被一起写上（改前这里是 null = 用户看到的「未关联」）',
      !!hRun.lifeGoalId, String(hRun.lifeGoalId));

    /* —— B 习惯详情能看见 —— */
    openHabitDetail(9901);
    var box = document.getElementById('habitDetailGoals');
    ok('B1 详情弹窗有「用于目标」区块', !!box);
    if (box) {
      var chips = box.querySelectorAll('.tf-chip');
      var onChips = box.querySelectorAll('.tf-chip.on');
      ok('B2 两个目标都列出来', chips.length === 2, chips.length);
      ok('B3 两个目标都是选中态（被这条习惯计量）', onChips.length === 2, onChips.length);
      ok('B4 选中项带 × 号（可点掉）', box.querySelectorAll('.tf-chip.on .tf-chip-x').length === 2);
      ok('B5 标题里能看见目标名', box.innerHTML.indexOf('跑满 500 公里') >= 0);
    }
    closeModal('habitDetailModal');

    /* —— C 习惯侧勾选/取消 —— */
    toggleHabitGoal(9901, 'lg9901');
    ok('C1 点一下取消 → 该目标不再用它计量', lifeGoalById('lg9901').habitId === null,
      String(lifeGoalById('lg9901').habitId));
    ok('C2 另一个目标不受影响（不连带断掉）', String(lifeGoalById('lg9902').habitId) === '9901');
    ok('C3 镜像改指还在用它的那个目标', String(hRun.lifeGoalId) === 'lg9902', String(hRun.lifeGoalId));
    toggleHabitGoal(9901, 'lg9901');
    ok('C4 再点一下勾回来', String(lifeGoalById('lg9901').habitId) === '9901');

    /* 反向验证：目标真的能用这个习惯算进度（不是只写了个字段） */
    var TF = window.TFGoal;
    var pr = TF && TF.lifeGoalProgress ? TF.lifeGoalProgress(lifeGoalById('lg9902'), {
      habits: appData.habits, habitLogs: appData.habitLogs
    }) : null;
    ok('C5 目标进度能算出实测值（改前 habitId 为空时永远是「未测量」）',
      !!pr && pr.measured === true && pr.pct !== null, pr ? (pr.measured + '/' + pr.pct) : 'null');

    /* —— D 删习惯：目标不能还指着一个不存在的习惯 —— */
    window.rsConfirm = function () { return { then: function (cb) { cb(true); } }; };
    window.confirm = function () { return true; };
    deleteHabit(9901);
    ok('D1 习惯真删掉了', !appData.habits.some(function (h) { return String(h.id) === '9901'; }));
    ok('D2 目标 habitId 被清空', lifeGoalById('lg9901').habitId === null && lifeGoalById('lg9902').habitId === null,
      String(lifeGoalById('lg9901').habitId) + '/' + String(lifeGoalById('lg9902').habitId));
    ok('D3 目标本身还在（不级联删）', !!lifeGoalById('lg9901') && !!lifeGoalById('lg9902'));

    /* —— E 老存档兼容：只有 h.lifeGoalId，没有 g.habitId —— */
    var snap = (TF && TF.lifeReviewSnapshot) ? TF.lifeReviewSnapshot(
      [{ id: 'area_health', name: '身体' }],
      [{ id: 'lgOld', areaId: 'area_health', status: 'active', habitId: null, startDate: addDaysStr(today, -20), targetDate: today }],
      {
        today: today,
        habits: [{ id: 9911, name: '老习惯', createdAt: addDaysStr(today, -20), freqPerWeek: 7, lifeGoalId: 'lgOld' }],
        habitLogs: { 9911: [yest, today] },
        habitStats: habitStats
      }
    ) : null;
    ok('E1 老数据（只有镜像）仍被领域统计认到', !!snap && snap.area_health && snap.area_health.habitPct !== null,
      snap && snap.area_health ? ('habitPct=' + snap.area_health.habitPct) : 'null');

    /* 新数据（只有真源）：同样认到，且不会因为镜像为空而漏 */
    var snap2 = (TF && TF.lifeReviewSnapshot) ? TF.lifeReviewSnapshot(
      [{ id: 'area_health', name: '身体' }],
      [{ id: 'lgNew', areaId: 'area_health', status: 'active', habitId: 9921, startDate: addDaysStr(today, -20), targetDate: today }],
      {
        today: today,
        habits: [{ id: 9921, name: '新习惯', createdAt: addDaysStr(today, -20), freqPerWeek: 7, lifeGoalId: null }],
        habitLogs: { 9921: [yest, today] },
        habitStats: habitStats
      }
    ) : null;
    ok('E2 新数据（只有真源）也被认到', !!snap2 && snap2.area_health && snap2.area_health.habitPct !== null,
      snap2 && snap2.area_health ? ('habitPct=' + snap2.area_health.habitPct) : 'null');
  } finally {
    appData.habits = JSON.parse(habitsBak);
    appData.habitLogs = JSON.parse(logsBak);
    appData.lifeGoals = JSON.parse(goalsBak);
    appData.lifeGoalOrder = JSON.parse(orderBak);
    _lifeGoalDraft = draftBak;
    _lifeGoalEditing = editBak;
    window.rsConfirm = rcBak;
    window.confirm = cnfBak;
    saveData();
    if (typeof renderHabits === 'function') renderHabits();
  }
  return JSON.stringify(R);
})();
