/* C123 —— 回顾「每天最多回顾 N 天」= 每日额度，不是滑动显示窗口

   用户提了两轮：
   ①「这个回顾为什么最少只有 5 天？能不能让用户自己填」→ 改成自由数字框。
   ②「我就想今天只回顾这么多天，回顾完就不要再看了。为什么我每看完一天它给我多一天，
      一直是 5 天？」→ 这才是真正的病：原来是**显示上限**，自评完一天它离开列表，
      窗口立刻让位给下一天，用户看到的是无穷无尽的 5 张。

   现在的口径：
     A 缺省 10 天；可自由填写（1~365），留空 / 0 = 不限
     B 25 天到期、额度 10 → 只画 10 张，标题报「今天要回顾 10 天」
     C **自评一天后只画 9 张**（绝不补位回 10 张 —— 这正是用户报的 bug）
     D 额度用尽 → 一张卡都不画，显示「今天的 N 天回顾完了」，剩下的明天再来
     E 显式点「今天再看 N 天」才放宽，且只对今天有效（reviewQuotaBonus 跨天作废）
     F 只影响显示：被折起的天仍在 dueReviewDates 里，自评 / 排期不受影响
     G 落盘：settings.reviewMaxDays 写进数据、重载读得回；非法值回退缺省
*/
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }

  var recBak = appData.records.slice();
  var setBak = appData.settings ? Object.assign({}, appData.settings) : null;
  var stageBak = appData.reviewStages ? JSON.parse(JSON.stringify(appData.reviewStages)) : {};

  /* 造 n 天、每天一条 25 分钟的记录（从昨天往前推，全部未排期 = 全部到期） */
  function seed(n) {
    var list = [];
    var now = new Date();
    for (var i = 1; i <= n; i++) {
      var d = new Date(now.getTime() - i * 86400000);
      d.setHours(9, 0, 0, 0);
      list.push({
        id: 'c123_' + i,
        startTime: d.getTime(),
        endTime: d.getTime() + 1500000,
        effectiveSeconds: 1500,
        taskName: '任务' + i,
        type: 'full',
        pomos: 1
      });
    }
    appData.records = list;
    appData.reviewStages = {};
    if (!appData.settings) appData.settings = {};
    delete appData.settings.reviewMaxDays;
    delete appData.settings.reviewQuotaBonus;
  }
  function cards() { return document.querySelectorAll('#reviewModalBody .review-card').length; }
  function bodyText() {
    var b = document.getElementById('reviewModalBody');
    return b ? b.innerText : '';
  }
  function heroNum() {
    var el = document.querySelector('#reviewModalBody .review-hero-num');
    return el ? el.innerText : '';
  }
  function dueDatesShown() {
    return [].map.call(document.querySelectorAll('#reviewModalBody .review-card'), function (c) {
      return c.getAttribute('data-date');
    });
  }

  /* ---- A 缺省口径 ---- */
  seed(25);
  ok('A1 没设置时缺省 10 天', reviewMaxDays() === 10, reviewMaxDays());

  /* ---- B 额度 10，25 天到期 ---- */
  openReviewModal();
  ok('B1 只画 10 张卡', cards() === 10, cards());
  ok('B2 标题报今天要回顾 10 天（不是欠 25 天）', heroNum() === '10', heroNum());
  ok('B3 提示还有 15 天排到明天', bodyText().indexOf('还有 15 天排到明天') >= 0, bodyText().slice(0, 120));
  ok('B4 折起的天仍在待回顾里（数据没被裁）', dueReviewDates(getTodayStr()).length === 25,
     dueReviewDates(getTodayStr()).length);

  /* ---- C 自评一天后「不补位」---- */
  var first = dueDatesShown()[0];
  applyReviewGrade(first, 'forget');
  ok('C1 自评一天后只剩 9 张（旧版会补回 10 张）', cards() === 9, cards());
  ok('C2 已回顾的那天不再出现', dueDatesShown().indexOf(first) < 0, first);
  ok('C3 今天已回顾计数 = 1', reviewDoneToday(getTodayStr()) === 1, reviewDoneToday(getTodayStr()));

  /* ---- D 额度用尽 → 收工 ---- */
  var guard = 0;
  while (cards() > 0 && guard++ < 30) {
    var d0 = dueDatesShown()[0];
    if (!d0) break;
    applyReviewGrade(d0, 'forget');
  }
  ok('D1 额度用尽后一张卡都不画', cards() === 0, cards());
  ok('D2 显示「今天已经回顾完」的收尾语', bodyText().indexOf('回顾完了') >= 0, bodyText().slice(0, 160));
  ok('D2b 大数字显示对勾而不是 0', heroNum() === '✓', heroNum());
  ok('D3 今天已回顾正好 10 天', reviewDoneToday(getTodayStr()) === 10, reviewDoneToday(getTodayStr()));
  ok('D4 其余 15 天仍在待回顾队列', dueReviewDates(getTodayStr()).length === 15,
     dueReviewDates(getTodayStr()).length);

  /* ---- E 显式放宽：只今天有效 ---- */
  reviewShowMore(5);
  ok('E1 点「今天再看 5 天」→ 再画 5 张', cards() === 5, cards());
  ok('E2 放宽记在 reviewQuotaBonus 且带日期', (function () {
    var b = appData.settings.reviewQuotaBonus;
    return !!b && b.date === getTodayStr() && b.days === 5;
  })(), JSON.stringify(appData.settings.reviewQuotaBonus || null));
  appData.settings.reviewQuotaBonus = { date: '2000-01-01', days: 5 };
  renderReviewModal();
  ok('E3 跨天自动作废（昨天的放宽不算今天）', cards() === 0, cards());
  appData.settings.reviewQuotaBonus = { date: getTodayStr(), days: 0 };

  /* ---- F 额度只影响显示：自评照常 ---- */
  setReviewMaxDays(0);
  ok('F1 不限 → 15 张全画', cards() === 15, cards());
  var d5 = dueDatesShown()[0];
  applyReviewGrade(d5, 'ok');
  ok('F2 不限额度下自评照常生效', dueDatesShown().indexOf(d5) < 0, d5);
  ok('F3 排期仍按遗忘曲线推后', (function () {
    var st = appData.reviewStages[d5];
    return !!st && st.next > getTodayStr();
  })(), JSON.stringify(appData.reviewStages[d5] || {}));

  /* ---- G 自由填写 + 落盘 + 非法规避 ---- */
  /* 重新造数据：上面的 D~F 已经把「今天已回顾」累积到 10 天以上，
     额度口径下再设 3 天会被「今天已超额」吃掉 —— 那是正确行为，不是缺陷。
     测「填几天就画几张」必须在没回顾过任何一天的干净状态下做。 */
  seed(25);
  setReviewMaxDays(3);
  ok('G1 填 3 天就画 3 张', cards() === 3, cards());
  ok('G2 输入框回填当前值', (function () {
    var i = document.querySelector('#reviewSettingsBody .rs-num');
    return !!i && String(i.value) === '3';
  })(), '');
  setReviewMaxDays(1);
  ok('G3 可以填 1 天（旧版下拉最少 5）', cards() === 1, cards());
  setReviewMaxDays(500);
  ok('G4 超大值压到上限 365（不会把列表撑爆）', reviewMaxDays() === 365, reviewMaxDays());
  setReviewMaxDays(7);
  saveDataNow();
  ok('G5 设置写进 appData.settings', appData.settings.reviewMaxDays === 7, appData.settings.reviewMaxDays);
  ok('G6 存进 localStorage（重载能读回）', (function () {
    try {
      var raw = JSON.parse(localStorage.getItem('tomato_focus_v3'));
      var d = typeof raw.d === 'string' ? JSON.parse(raw.d) : raw.d;
      return d.settings && d.settings.reviewMaxDays === 7;
    } catch (e) { return false; }
  })(), '');
  appData.settings.reviewMaxDays = 'abc';
  ok('G7 非法值回退缺省 10', reviewMaxDays() === 10, reviewMaxDays());
  appData.settings.reviewMaxDays = '0';
  ok('G8 老存档里的字符串 "0" 也算不限', reviewMaxDays() === 0, reviewMaxDays());

  /* 还原 */
  appData.records = recBak;
  appData.reviewStages = stageBak;
  if (setBak) appData.settings = setBak;
  _reviewShownPages = 0;
  try { renderReviewModal(); } catch (e) { /* 弹窗可能已关 */ }
  return JSON.stringify(R);
})();
