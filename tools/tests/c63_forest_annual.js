/* C63 森林长线收口：年度回顾 + 树龄陪伴装饰 + 林地小树林

   这三件是长线的"收口"：
     A 年度回顾 —— 每满一周年把「这一年」结一次账（番茄 / 天数 / 分钟）写进履历。
       十几年尺度上，唯一能让人回头看的正是这些年度小结，而且只由 records 现算，不新开账本。
     B 树龄陪伴装饰 —— 树周围随树龄慢慢添物件（种子→石头→…→小屋→星球）。
       纯氛围、不参与任何数值；它让"陪伴了多久"这件事在视觉上也存在，而不只是一行字。
     C 林地小树林 —— 每封一代画一棵树，年轮越多越壮。图形是补充，文字列表照旧保留。

   ⚠️ 造数纪律：会大改 tree / records 并渲染，finally 全部恢复。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var treeBak = JSON.stringify(appData.tree || {});
  var recBak = JSON.stringify(appData.records || []);
  var sid = (appData.tree && appData.tree.species) || 'tomato';

  try {
    /* ===== A 年度回顾 ===== */
    appData.tree.treeLifeLog = { planted: {}, maxed: {}, stars: [], ages: [], annual: [] };
    appData.tree.treeLifeLog.planted[sid] = '2024-01-01'; /* 满 2 周年 */
    appData.tree.points = 200 + 20 * 50; /* 20 圈 */
    appData.tree.dead = false;
    appData.records = [
      { id: 'C63-1', type: 'full', pomos: 1, effectiveSeconds: 1500, startTime: new Date(2025, 5, 10, 9, 0).getTime(), interruptions: [], totalInterruptSeconds: 0 },
      { id: 'C63-2', type: 'full', pomos: 2, effectiveSeconds: 3000, startTime: new Date(2025, 5, 11, 9, 0).getTime(), interruptions: [], totalInterruptSeconds: 0 },
      { id: 'C63-3', type: 'log', pomos: 0, effectiveSeconds: 600, startTime: new Date(2025, 5, 12, 9, 0).getTime(), interruptions: [], totalInterruptSeconds: 0 }
    ];
    var addedN = checkTreeAnnual();
    var an = appData.tree.treeLifeLog.annual || [];
    ok('A1 跨 2 个周年 → 结 2 条年度回顾', addedN === 2 && an.length === 2);
    ok('A2 第 1 年区间 = 种植日 → +1 年', an[0].from === '2024-01-01' && an[0].to === '2025-01-01');
    ok('A3 第 2 年区间正确', an[1].from === '2025-01-01' && an[1].to === '2026-01-01');
    ok('A4 第 2 年统计到那两条（仅记录不计）', an[1].tomato === 3 && an[1].days === 2 && an[1].minutes === 75);
    ok('A5 第 1 年没记录也照样结账（不丢年份）', an[0].tomato === 0 && an[0].days === 0 && an[0].minutes === 0);
    ok('A6 幂等：再跑不会重复写', checkTreeAnnual() === 0 && appData.tree.treeLifeLog.annual.length === 2);
    if (typeof renderTreeLifeLog === 'function') renderTreeLifeLog();
    var logBox = document.getElementById('treeLifeLogBox');
    ok('A7 履历墙出现「年度回顾」', !!logBox && logBox.innerHTML.indexOf('年度回顾') >= 0);
    ok('A8 履历墙写明了番茄数与天数', !!logBox && logBox.innerHTML.indexOf('3 个番茄') >= 0);

    /* 封树只重置当前树的成长值，不该抹掉已经结过的年度回顾 */
    appData.tree.points = 200 + 50 * 50;
    doSealTree(sid, 50);
    ok('A9 封树不抹掉历史年度回顾', (appData.tree.treeLifeLog.annual || []).length === 2);

    /* ===== B 树龄陪伴装饰 ===== */
    appData.tree.dead = false;
    appData.tree.treeLifeLog.planted[sid] = '2020-01-01'; /* 约 6 年 → 跨 5 档 */
    renderTreeAgeDecor();
    var dec = document.getElementById('treeAgeDecor');
    ok('B1 达到 5 档 → 出现 5 件陪伴物件', !!dec && dec.querySelectorAll('span').length === 5);
    ok('B2 物件带 title 说明是哪一档', !!dec && (dec.innerHTML.indexOf('title=') >= 0));
    appData.tree.treeLifeLog.planted[sid] = getTodayStr();
    renderTreeAgeDecor();
    ok('B3 刚种下的树没有装饰', !!dec && dec.querySelectorAll('span').length === 0);
    appData.tree.treeLifeLog.planted[sid] = '2016-01-01'; /* 约 10 年 → 7 档 */
    renderTreeAgeDecor();
    ok('B4 十年树龄 → 物件更多（7 件）', !!dec && dec.querySelectorAll('span').length === 7);
    appData.tree.dead = true;
    renderTreeAgeDecor();
    ok('B5 枯死时清空装饰', !!dec && dec.querySelectorAll('span').length === 0);
    appData.tree.dead = false;

    /* ===== C 林地小树林 ===== */
    appData.tree.grove = [
      { sid: sid, name: '小番茄', gen: 1, planted: '2019-01-01', sealedAt: '2023-01-01', days: 1461, rings: 50, points: 2700 },
      { sid: sid, name: '小番茄', gen: 2, planted: '2023-01-01', sealedAt: '2026-01-01', days: 1095, rings: 120, points: 6200 }
    ];
    renderTreeGrove();
    var trees = document.getElementById('treeGroveTrees');
    ok('C1 每封一代画一棵树', !!trees && trees.querySelectorAll('svg').length === 2);
    var svgs = trees.querySelectorAll('svg');
    ok('★ C2 年轮多的那棵更壮实（宽度更大）',
      svgs.length === 2 && Number(svgs[1].getAttribute('width')) > Number(svgs[0].getAttribute('width')));
    ok('C3 小树带说明（第几代 / 几圈）', !!trees && trees.innerHTML.indexOf('第 2 代') >= 0);
    ok('C4 文字列表照旧保留', document.getElementById('treeGroveBox').innerHTML.indexOf('第 1 代') >= 0);
  } finally {
    try { appData.tree = JSON.parse(treeBak); } catch (e) { R.push(['!! tree 恢复失败: ' + e.message, false]); }
    try { appData.records = JSON.parse(recBak); } catch (e) { R.push(['!! records 恢复失败: ' + e.message, false]); }
    try { renderTreeSection(); } catch (e) { /* 恢复后重画 */ }
    saveData();
  }
  return JSON.stringify(R);
})();
