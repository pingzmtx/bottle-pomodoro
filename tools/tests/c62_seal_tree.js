/* C62 封树成林：超长线收藏（十几年的目标）+ 封树时的数据安全

   缘起：积分线 3.7 年就走完了，之后只剩「永恒树心 N 重」这样的纯数字。
   补的是「我在这棵树上养到了第几代」这条收藏线 —— 每次封树都是对过去几年的交代。

   封树 = 把当前这一代记进林地（tree.grove），当前树种从零开始新的一代。
   代价必须讲清楚，所以有两道防线：① 满 50 圈才允许；② 入口带二次确认（含代价说明）。

   ⚠️ 这里的断言重点是**封树别把不该清的东西清了**（称号/金币/图鉴/已解锁树种），
      以及**切走再切回来不会把旧积分复活**（speciesPoints 槽位必须同步归零）。

   ⚠️ 造数纪律：会大改 tree 并渲染，finally 全部恢复。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var treeBak = JSON.stringify(appData.tree || {});
  var seg = 200 + 50 * 50; /* 满级 200 点 + 50 圈 × 每圈 50 点 = 刚好「永恒树心」 */
  var sid = (appData.tree && appData.tree.species) || 'tomato';

  try {
    if (!appData.tree.unlockedSpecies) appData.tree.unlockedSpecies = ['tomato'];
    if (appData.tree.unlockedSpecies.indexOf(sid) < 0) appData.tree.unlockedSpecies.push(sid);
    appData.tree.grove = [];

    /* ===== A 门槛 ===== */
    /* 49 圈的区间是 2600~2649 点（每 50 点一圈，200 点起算） */
    appData.tree.points = seg - 100;
    var s1 = sealTreeStatus();
    ok('A1 差一圈：不能封树，并算出还差多少', s1.ok === false && s1.need === 1);
    appData.tree.points = seg;
    ok('A2 满 50 圈：可以封树', sealTreeStatus().ok === true);

    /* ===== B 封树动作与数据安全 ===== */
    if (!appData.tree.treeLifeLog) appData.tree.treeLifeLog = { planted: {}, maxed: {}, stars: [] };
    if (!appData.tree.treeLifeLog.planted) appData.tree.treeLifeLog.planted = {};
    appData.tree.treeLifeLog.planted[sid] = '2020-01-01';
    appData.tree.peakPoints = 3000;
    appData.tree.coins = 500;
    appData.tree.fruitCount = 7;
    appData.tree.milestones = [{ stage: '世界树', emoji: '🌐', points: 200, date: '2020-08-01 10:00' }];
    if (!appData.tree.speciesPoints) appData.tree.speciesPoints = {};
    appData.tree.speciesPoints[sid] = seg;

    doSealTree(sid, 50);

    ok('B1 林地记下一条', (appData.tree.grove || []).length === 1);
    var g0 = appData.tree.grove[0];
    ok('B2 记录含代际 / 年轮 / 陪伴天数 / 封树日',
      g0.gen === 1 && g0.rings === 50 && g0.days > 0 && !!g0.sealedAt && g0.sid === sid);
    ok('B3 成长值归零', appData.tree.points === 0);
    ok('B4 年轮随之归零', getEternalStars(appData.tree.points) === 0);
    ok('B5 种植日重置为今天（新的一代）', appData.tree.treeLifeLog.planted[sid] === getTodayStr());
    ok('B6 成长里程碑清空（新的一代重新走）', (appData.tree.milestones || []).length === 0);
    ok('★ B7 树种积分槽位同步归零（切走再切回来不会复活旧值）', (appData.tree.speciesPoints[sid] || 0) === 0);
    ok('B8 称号依据 peakPoints 保留（退化不清零）', appData.tree.peakPoints === 3000);
    ok('B9 金币不受影响', appData.tree.coins === 500);
    ok('B10 已解锁树种不受影响', (appData.tree.unlockedSpecies || []).indexOf(sid) >= 0);
    ok('B11 图鉴不受影响（不会被封树清掉）', !!appData.tree.speciesAlbum);

    /* ===== C 渲染 ===== */
    renderTreeGrove();
    var wrap = document.getElementById('treeGroveWrap');
    ok('C1 林地区块显示', !!wrap && wrap.style.display !== 'none');
    var box = document.getElementById('treeGroveBox');
    ok('C2 列表里能看到「第 1 代」', !!box && box.innerHTML.indexOf('第 1 代') >= 0);
    ok('C3 棵数计数为 1', (document.getElementById('treeGroveCount') || {}).textContent === '1');
    ok('C4 groveCount 按树种过滤', groveCount(sid) === 1 && groveCount('cherry') === 0);

    /* ===== D 再封一代 ===== */
    appData.tree.points = seg;
    doSealTree(sid, 50);
    ok('D1 第二代代际为 2', appData.tree.grove[1].gen === 2);
    ok('D2 林地共 2 棵', groveCount(sid) === 2);
    ok('D3 两代的陪伴区间各自独立记录', appData.tree.grove[0].sealedAt !== undefined && appData.tree.grove[1].sealedAt !== undefined);

    /* ===== E 成就 ===== */
    var defs = (typeof ACHIEVEMENT_DEFS !== 'undefined') ? ACHIEVEMENT_DEFS : [];
    function ach(id) {
      return defs.filter(function (a) { return a.id === id; })[0];
    }
    ok('E1 第一片荫：0 棵不解锁 / 1 棵解锁',
      ach('grove_1').cond({ grove: 0 }) === false && ach('grove_1').cond({ grove: 1 }) === true);
    ok('E2 五树成林：4 棵不解锁 / 5 棵解锁',
      ach('grove_5').cond({ grove: 4 }) === false && ach('grove_5').cond({ grove: 5 }) === true);
    ok('E3 林地成就都在「种树」分组', ['grove_1', 'grove_3', 'grove_5', 'grove_10'].every(function (id) {
      return ach(id) && ach(id).group === '种树';
    }));

    /* ===== F 按钮显隐与代际提示 ===== */
    appData.tree.points = 0;
    renderTreeSealBtn();
    ok('F1 归零后按钮隐藏', (document.getElementById('treeSealBtn') || {}).style.display === 'none');
    appData.tree.points = seg;
    renderTreeSealBtn();
    var btn = document.getElementById('treeSealBtn');
    ok('F2 达标后按钮出现并写明代际', !!btn && btn.style.display !== 'none' && /第 3 代/.test(btn.textContent));
  } finally {
    try { appData.tree = JSON.parse(treeBak); } catch (e) { R.push(['!! tree 恢复失败: ' + e.message, false]); }
    try { renderTreeSection(); } catch (e) { /* 恢复后重画 */ }
    saveData();
  }
  return JSON.stringify(R);
})();
