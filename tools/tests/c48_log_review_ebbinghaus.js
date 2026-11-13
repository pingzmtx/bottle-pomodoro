/* C48 日志「回顾」按钮 + 艾宾浩斯遗忘曲线
   覆盖：「日志专注记录旁边……新增一个回顾按钮，采用艾宾浩斯遗忘记忆曲线来回顾日期，
   智能科学安排，还要有遗忘、熟练、记牢」。

   打五段：
     ① 入口：筛选/补记 旁边就是回顾按钮（同一行操作区）
     ② 排期：只排「有记录的日子」；记录次日起第一次回顾；毕业的不再排；没轮到的今天不冒头
     ③ 自评：遗忘→回 0 级重来；熟练→进一级；记牢→跳一级；间隔 1→2→4→7→15→30→60
        （四级按钮按 REVIEW_GRADES 顺序渲染，「斩掉」排最左）
     ④ 显示：一天 = 一张卡（日期 + 阶段 + 这天的摘要 + 当天做的事）
     ⑤ 按天成块：点卡进「那天的日志」整块读，可退回列表，看完顺手自评
   ★ 纯函数（ebReview/ebIsDue/EBBINGHAUS_INTERVALS）的边界在 unit_pure.js，这里只打运行时。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var stagesBak = JSON.stringify(appData.reviewStages || {});
  var recBak = JSON.stringify(appData.records || []);
  var today = getTodayStr();
  var y1 = addDaysStr(today, -1), y2 = addDaysStr(today, -2);
  try {
    /* ① 入口 */
    var btn = null;
    [].slice.call(document.querySelectorAll('button')).forEach(function (b) {
      var _h = (b.getAttribute('onclick') || '') + (b.getAttribute('data-act') || '');
      if (_h.indexOf('openReviewModal') >= 0) btn = b;
    });
    ok('① 日志页有「回顾」按钮', !!btn);
    ok('①b 和「筛选」「补记」在同一行操作区',
       !!btn && !!btn.parentNode && btn.parentNode.textContent.indexOf('筛选') >= 0 &&
       btn.parentNode.textContent.indexOf('补记') >= 0);

    /* ② 排期 */
    appData.reviewStages = {};
    appData.records = [
      { id: 9601, taskName: '数学', startTime: new Date(y1 + 'T10:00:00').getTime(), pomos: 1, type: 'full' },
      { id: 9602, taskName: '英语', startTime: new Date(y2 + 'T10:00:00').getTime(), pomos: 1, type: 'full' }
    ];
    var due = dueReviewDates(today);
    ok('② 只有「有记录的日子」才排期（今天没干活不冒头）', due.indexOf(today) < 0);
    ok('②b 昨天记的今天该回顾', due.indexOf(y1) >= 0);
    ok('②c 前天记的今天也还没毕业（初学次日）', due.indexOf(y2) >= 0);

    /* ②d 毕业的不再排 */
    appData.reviewStages[y1] = { level: EBBINGHAUS_INTERVALS.length, last: y1, next: null };
    ok('②d 记牢毕业的日子不再排进来', dueReviewDates(today).indexOf(y1) < 0);

    /* ②e 没轮到的今天不排（next 在未来） */
    appData.reviewStages[y2] = { level: 2, last: y2, next: addDaysStr(today, 5) };
    ok('②e next 还没到就不打扰', dueReviewDates(today).indexOf(y2) < 0);

    /* ③ 自评 */
    appData.reviewStages = {};
    var s0 = ebReview(null, 'ok', today);
    ok('③ 初学「熟练」→ 第 1 级，间隔 2 天', s0.level === 1 && s0.next === addDaysStr(today, 2));
    var s1 = ebReview(s0, 'ok', today);
    ok('③b 再「熟练」→ 第 2 级，间隔 4 天', s1.level === 2 && s1.next === addDaysStr(today, 4));
    var s2 = ebReview(s1, 'solid', today);
    ok('③c 「记牢」跳一级 → 第 4 级，间隔 15 天', s2.level === 4 && s2.next === addDaysStr(today, 15));
    var s3 = ebReview(s2, 'forget', today);
    ok('③d 「遗忘」回炉 → 第 0 级，明天重来', s3.level === 0 && s3.next === addDaysStr(today, 1));
    ok('③e 间隔阶梯就是 1/2/4/7/15/30/60', EBBINGHAUS_INTERVALS.join(',') === '1,2,4,7,15,30,60');
    ok('③f 四级自评齐了、且「斩」排在最左（斩掉/遗忘/熟练/记牢）',
       REVIEW_GRADES.map(function (g) { return g.label; }).join(',') === '斩掉,遗忘,熟练,记牢');

    /* ④ 显示（待回顾列表）：一天 = 一张卡 */
    appData.reviewStages = {};
    appData.records = [
      { id: 9601, taskName: '数学', startTime: new Date(y1 + 'T10:00:00').getTime(), pomos: 1, type: 'full' }
    ];
    appData.reviewStages[y1] = { level: 0, last: y1, next: y1 };
    if (typeof openReviewModal === 'function') openReviewModal();
    var modal = document.getElementById('reviewModal');
    ok('④ 回顾弹窗能打开', !!modal);
    var box = document.getElementById('reviewModalBody') || { querySelector: function () { return null; }, textContent: '' };
    var card = box.querySelector('.review-card[data-date="' + y1 + '"]');
    ok('④b 待回顾的这一天成了一张卡', !!card);
    var mtxt = modal ? modal.textContent : '';
    ok('④c 三档自评按钮都在', mtxt.indexOf('遗忘') >= 0 && mtxt.indexOf('熟练') >= 0 && mtxt.indexOf('记牢') >= 0);
    ok('④d 写明了间隔规则（1→2→4→7…）', mtxt.indexOf('1') >= 0 && mtxt.indexOf('30') >= 0);
    ok('④e 卡上先给出这天的样子（条数与时长摘要）', !!card && card.textContent.indexOf('1 条') >= 0);
    ok('④f 卡上列出当天做的事', !!card && card.textContent.indexOf('数学') >= 0);

    /* ⑤ 按天成块：点卡进去看那一天的整块日志 */
    var hit = card ? card.querySelector('.review-card-hit') : null;
    ok('⑤ 整张卡是可点进「那天的日志」的入口',
       !!hit && ((hit.getAttribute('onclick') || '') + (hit.getAttribute('data-act') || '')).indexOf('openReviewDay') >= 0);
    if (typeof openReviewDay === 'function') openReviewDay(y1);
    var dbody = document.getElementById('reviewModalBody');
    var dhead = dbody ? dbody.querySelector('.review-day-head[data-date="' + y1 + '"]') : null;
    ok('⑤b 点开后是「这一天的记录」而不是一个空弹窗', !!dhead);
    ok('⑤c 那天的日志被整块摆了出来', !!dbody && dbody.querySelectorAll('.log-day-card').length === 1);
    var dtxt = dbody ? dbody.textContent : '';
    ok('⑤d 块里就是那天真正的记录', dtxt.indexOf('数学') >= 0 && dtxt.indexOf('1 条') >= 0);
    ok('⑤e 日详情里也能自评（看完顺手评）', dtxt.indexOf('遗忘') >= 0 && dtxt.indexOf('记牢') >= 0);
    if (typeof reviewBackToList === 'function') reviewBackToList();
    ok('⑤f 能退回待回顾列表', !!box.querySelector('.review-card[data-date="' + y1 + '"]') &&
       !box.querySelector('.review-day-head'));

    /* ⑥ 自评（走界面入口，不是直接调纯函数） */
    if (typeof gradeReview === 'function') {
      if (typeof openReviewDay === 'function') openReviewDay(y1);
      gradeReview(y1, 'ok');
      var st = appData.reviewStages[y1];
      ok('⑥ 点「熟练」把这条推进到第 1 级', !!st && st.level === 1 && st.next === addDaysStr(today, 2));
      ok('⑥b 评完这一天就退出待回顾（不必手动退）', !box.querySelector('.review-card[data-date="' + y1 + '"]'));
      gradeReview(y1, 'solid');
      st = appData.reviewStages[y1];
      ok('⑥c 列表里点「记牢」再跳一级', !!st && st.level === 3);
    } else {
      ok('⑥ 点「熟练」把这条推进到第 1 级', false);
      ok('⑥b 评完这一天就退出待回顾（不必手动退）', false);
      ok('⑥c 列表里点「记牢」再跳一级', false);
    }

    /* ④g 日志行上的回顾小标 */
    appData.reviewStages = {};
    appData.reviewStages[y1] = { level: 0, last: y1, next: y1 };
    appData.records = [
      { id: 9602, taskName: '昨天那条', startTime: new Date(y1 + 'T10:00:00').getTime(), pomos: 1, type: 'full' }
    ];
    if (typeof renderLogs === 'function') renderLogs();
    var lh = (document.getElementById('logList') || {}).innerHTML || '';
    ok('④g 该回顾的那天，日志行上有回顾小标', lh.indexOf('回顾') >= 0);

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.reviewStages = JSON.parse(stagesBak); } catch (e) { appData.reviewStages = {}; }
    try { appData.records = JSON.parse(recBak); } catch (e) { appData.records = []; }
    try { if (typeof closeModal === 'function') closeModal('reviewModal'); } catch (e) {}
    if (typeof renderLogs === 'function') renderLogs();
    saveData();
  }
  return JSON.stringify(R);
})();
