/* C37 树枯死 → 复活/重种之后必须能浇水
   树木：复活之后浇水按钮仍然点不动。

   根因：`renderTreeSection()` 里浇水按钮的状态是**单向**写的 ——
     枯死分支 `wb.disabled = true;`，活着分支只改文字/样式，**从不复位 disabled**。
   于是同一次会话里：树枯死 → 按钮被禁用 → 复活（renderTreeSection 重跑，走 else 分支）
     → dead=false 了，但 disabled 还是 true → 点不动 = 「复活后无法浇水」。
   刷新页面会重跑渲染、按钮回到模板初始（无 disabled）状态 → 所以只有「复活后当场」点不动。

   修法：活着的分支补 `wb.disabled = false;`（有期限/状态类 UI 一律双向赋值）。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var btn = function () { return document.getElementById('treeWaterBtn'); };
  var treeBak = JSON.stringify(appData.tree || {});
  function today() { return getTodayStr(); }
  function setDead() {
    appData.tree.dead = true;
    appData.tree.deadDate = today();
    appData.tree.points = 0;
    if (typeof renderTreeSection === 'function') renderTreeSection();
  }

  try {
    /* 注：树不是独立视图（没有 view-tree），不能调 switchView('tree')；
       树区块住在计时页/统计页里，renderTreeSection 与可见性无关，直接调即可。 */

    // ① 枯死态：按钮禁用（原有行为，不能被改坏）
    setDead();
    ok('① 枯死时浇水按钮被禁用', !!btn() && btn().disabled === true);
    ok('①b 枯死时按钮文案是「已枯死」', !!btn() && btn().textContent.indexOf('已枯死') >= 0);

    // ② 重种（免费）之后 → 按钮必须解禁
    appData.tree.lastWaterDate = null;
    if (typeof replantTree === 'function') replantTree();
    ok('② replantTree 后 tree.dead=false', appData.tree.dead === false);
    ok('②b 重种后浇水按钮解禁（核心回归）', !!btn() && btn().disabled === false);
    ok('②c 重种后文案回到「浇水」', !!btn() && btn().textContent.indexOf('浇水') >= 0 && btn().textContent.indexOf('已枯死') < 0);

    // ③ 解禁之后水要真的浇得下去
    if (typeof waterTree === 'function') waterTree();
    ok('③ 重种后能浇上水（lastWaterDate=今天）', appData.tree.lastWaterDate === today());
    ok('③b 浇完后按钮显示「今日已浇」', !!btn() && btn().textContent.indexOf('今日已浇') >= 0);

    // ④ 复活石那条路（useItem）同样要解禁 —— 真机上走的就是这条路
    setDead();
    ok('④ 再次枯死后按钮又禁用', !!btn() && btn().disabled === true);
    appData.tree.inventory = appData.tree.inventory || {};
    appData.tree.inventory.reviveStone = (appData.tree.inventory.reviveStone || 0) + 1;
    appData.tree.lastWaterDate = null;
    if (typeof useItem === 'function') useItem('reviveStone');
    ok('④b 复活石生效（dead=false）', appData.tree.dead === false);
    ok('④c 复活石复活后浇水按钮解禁（核心回归）', !!btn() && btn().disabled === false);
    if (typeof waterTree === 'function') waterTree();
    ok('④d 复活石复活后能浇上水', appData.tree.lastWaterDate === today());

    // ⑤ 双向性：枯死→禁用、复活→解禁，来回两轮不许粘住
    setDead();
    ok('⑤ 第二轮枯死仍禁用', !!btn() && btn().disabled === true);
    if (typeof replantTree === 'function') replantTree();
    ok('⑤b 第二轮复活仍解禁', !!btn() && btn().disabled === false);
  } catch (e) {
    R.push(['JS 异常：' + (e && e.message), false]);
  } finally {
    try {
      appData.tree = JSON.parse(treeBak);
      if (typeof saveData === 'function') saveData();
      if (typeof renderTreeSection === 'function') renderTreeSection();
      if (typeof renderTreeShop === 'function') renderTreeShop();
      if (typeof renderTimerTree === 'function') renderTimerTree();
    } catch (e2) { /* 收尾失败不掩盖断言结果 */ }
  }
  return JSON.stringify(R);
})();
