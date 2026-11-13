/* C61 森林长线：树龄（时间轴）+ 年轮长尾 + 长线成就

   缘起：「我想它就是做一个长线的，因为用户可能要用好几年甚至十几年，
   你要保证长线上让它有意思，别让成就那么快得到」。

   现状体检（算出来的，不是感觉）：
     番茄树 9 阶          200 点   ≈ 100 天   （按每天 2 个番茄）
     5 树种全图鉴         1000 点  ≈ 1.4 年
     单树 50 圈(永恒树心)  2700 点  ≈ 3.7 年
     森林 3000 棵         3000 天  ≈ 8.2 年
   → 1.4 年后「图鉴/树种」这条线结束；3.7 年后只剩「永恒树心 N 重」一个纯数字，
     中间十几年没有任何新节点。问题不是阈值小，而是**没有第二条轴**。

   三条补充（都不发奖励，纯展示/纪念 —— 不给奖励就不会长出新的可刷点）：
     A 树龄：陪伴天数/周年（纯时间轴，强度再低也不缩水），档位铺到 30 年
     B 年轮长尾：50 圈之后补 100/200/500/1000，之后每 1000 圈一重
     C 长线成就：森林 5000/10000 棵、树龄 1/3/5/10/20 年、年轮 10/50/100/500 圈

   ⚠️ 造数纪律：会改 tree / 履历并渲染，finally 全部恢复。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var treeBak = JSON.stringify(appData.tree || {});

  try {
    /* ===== A 树龄：纯时间轴 ===== */
    ok('A1 树龄天数按日历算', treeAgeDays('2026-10-13', '2027-10-13') === 365);
    ok('A2 未满整年不算一年（2/29 → 次年 2/28）', treeAgeYears('2024-02-29', '2025-02-28') === 0);
    ok('A3 过完周年才算一年', treeAgeYears('2024-02-29', '2025-03-01') === 1);
    ok('A4 跨多年正确', treeAgeYears('2016-05-20', '2026-05-19') === 9 &&
      treeAgeYears('2016-05-20', '2026-05-20') === 10);
    ok('A5 脏输入归 0 不炸', treeAgeDays(null, '2026-10-13') === 0 && treeAgeYears('xx', 'yy') === 0);
    ok('A6 档位：100 天', treeAgeTierOf(100).cur.name === '百日之木');
    ok('A7 档位：10 年', treeAgeTierOf(3650).cur.name === '十年之树');
    ok('A8 下一档可追', treeAgeTierOf(200).next.days === 365);
    ok('A9 最远档铺到 30 年', TREE_AGE_TIERS[TREE_AGE_TIERS.length - 1].days >= 10950);
    ok('A10 档位按天数递增（顺序表可用）', (function () {
      for (var i = 1; i < TREE_AGE_TIERS.length; i++)
        if (TREE_AGE_TIERS[i].days <= TREE_AGE_TIERS[i - 1].days) return false;
      return true;
    })());

    /* ===== B 年轮长尾 ===== */
    ok('B1 50 圈 = 永恒树心', getEternalTier(50).cur.name === '永恒树心');
    ok('B2 100 圈 = 百轮树心', getEternalTier(100).cur.name === '百轮树心');
    ok('B3 500 圈 = 纪元之树', getEternalTier(500).cur.name === '纪元之树');
    ok('B4 1000 圈 = 不朽之树', getEternalTier(1000).cur.name === '不朽之树');
    ok('B5 2000 圈 = 不朽之树 2 重', getEternalTier(2000).cur.name === '不朽之树 2 重');
    ok('B6 过顶后仍给下一档（不会没目标）', !!getEternalTier(2000).next);
    ok('B7 未满级区间不受影响（20→50）', getEternalTier(30).cur.name === '廿载古木' && getEternalTier(30).next.at === 50);
    ok('B8 0 圈没有当前档', getEternalTier(0).cur === null);

    /* ===== C 树面板渲染 + 履历 ===== */
    var sid = appData.tree.species || 'tomato';
    if (!appData.tree.treeLifeLog) appData.tree.treeLifeLog = { planted: {}, maxed: {}, stars: [] };
    if (!appData.tree.treeLifeLog.planted) appData.tree.treeLifeLog.planted = {};
    appData.tree.treeLifeLog.planted[sid] = '2020-01-01'; /* 约 6 年前 */
    appData.tree.treeLifeLog.ages = [];
    renderTreeAgeLine();
    var el = document.getElementById('treeAgeLine');
    ok('C1 树龄行已渲染出来', !!el && el.style.display !== 'none');
    ok('C2 文案含「陪伴」与「满 N 年」',
      !!el && el.textContent.indexOf('陪伴') >= 0 && el.textContent.indexOf('满') >= 0);
    ok('C3 显示当前档名', !!el && el.textContent.indexOf('五载同行') >= 0);
    var ages = appData.tree.treeLifeLog.ages || [];
    ok('C4 跨过的档位写入履历', ages.length >= 1);
    var n0 = ages.length;
    renderTreeAgeLine();
    renderTreeAgeLine();
    ok('C5 重复渲染不重复写履历', (appData.tree.treeLifeLog.ages || []).length === n0);
    if (typeof renderTreeLifeLog === 'function') renderTreeLifeLog();
    var box = document.getElementById('treeLifeLogBox');
    ok('C6 履历墙出现树龄段', !!box && box.innerHTML.indexOf('树龄') >= 0);

    /* ===== D 长线成就条件（阈值必须真的够长） ===== */
    var defs = (typeof ACHIEVEMENT_DEFS !== 'undefined') ? ACHIEVEMENT_DEFS : [];
    function ach(id) {
      return defs.filter(function (a) { return a.id === id; })[0];
    }
    var y10 = ach('tree_year_10');
    ok('D1 十年之树：9 年不解锁', !!y10 && y10.cond({ treeYears: 9 }) === false);
    ok('D2 十年之树：10 年解锁', !!y10 && y10.cond({ treeYears: 10 }) === true);
    var r100 = ach('ring_100');
    ok('D3 百圈树心：99 圈不解锁 / 100 圈解锁',
      !!r100 && r100.cond({ treeRings: 99 }) === false && r100.cond({ treeRings: 100 }) === true);
    var f10k = ach('forest_10000');
    ok('D4 万木之林：需 10000 棵', !!f10k && f10k.cond({ forestTrees: 9999 }) === false &&
      f10k.cond({ forestTrees: 10000 }) === true);
    ok('D5 长线成就都在「种树」分组', [y10, r100, f10k].every(function (a) { return a && a.group === '种树'; }));
  } finally {
    try { appData.tree = JSON.parse(treeBak); } catch (e) { R.push(['!! tree 恢复失败: ' + e.message, false]); }
    try { renderTreeSection(); } catch (e) { /* 恢复后重画 */ }
    saveData();
  }
  return JSON.stringify(R);
})();
