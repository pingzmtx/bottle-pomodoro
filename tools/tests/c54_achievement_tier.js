/* C54 成就分层与梯度（tier 四档 + 早起鸟/夜猫子 门槛）

   覆盖：「我就完成了几天，我就解锁了十几个成就，感觉成就系统需要升级」。
   根因不是数字太小，而是 **8 个「第一次做某事」的成就**（`cond` 里写 `>= 1`）
   与「连续 100 天」摆在同一个列表里同权 —— 前者本质是**功能引导**，后者才是成就。

   两轮收口：
     ① 分层（只动展示）：给每条加 `tier`（guide/bronze/silver/gold），成就页分档展示；
     ② 梯度（动 cond）：早起鸟 / 夜猫子 由 `>= 1` 提到 `>= 连续 3 天`，
        并**脱离 guide 层**（它们不再是「第一次」，而是需要坚持才拿得到）。
        ★ 已解锁的记录**不撤销**（成就不可撤销）。

   本用例把两件事都钉住，尤其是**分层数量**：数字一变就必须同步改这里 ——
   「机器门禁」比「人记得」可靠，防止以后有人悄悄往 guide 里塞东西。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }

  var defs = (typeof ACHIEVEMENT_DEFS !== 'undefined') ? ACHIEVEMENT_DEFS : [];
  ok('A0 拿到成就定义表', defs.length > 0);

  /* ===== A 分层 ===== */
  var TIERS = ['guide', 'bronze', 'silver', 'gold'];
  var byt = {};
  TIERS.forEach(function (t) { byt[t] = 0; });
  var bad = 0;
  defs.forEach(function (a) {
    if (TIERS.indexOf(a.tier) < 0) bad++;
    else byt[a.tier]++;
  });
  ok('A1 每条成就都有合法 tier', bad === 0);
  /* 这组数字是**约定**：改动门槛/分层时必须回到这里同步改（否则本用例红）。
     追加 11 条长线成就（森林规模 5000/10000 棵、树龄 1/3/5/10/20 年、
     年轮 10/50/100/500 圈），bronze +2 / silver +3 / gold +6。 */
  ok('A2 guide=6 / bronze=24 / silver=34 / gold=26 / 共 90（含 6 条森林里程碑）',
     byt.guide === 6 && byt.bronze === 24 && byt.silver === 34 && byt.gold === 26 &&
     defs.length === 90);

  /* A4 长线跨度门禁：森林要能撑住「用几年甚至十几年」，
     所以必须存在 10 年以上的树龄档与 100 圈以上的年轮档 ——
     防止以后有人把长线阈值改小、又把成就拉回「几天解锁一堆」。 */
  var _years = defs.filter(function (a) { return a.id.indexOf('tree_year_') === 0; })
                   .map(function (a) { return Number(a.id.replace('tree_year_', '')) || 0; });
  var _rings = defs.filter(function (a) { return a.id.indexOf('ring_') === 0; })
                   .map(function (a) { return Number(a.id.replace('ring_', '')) || 0; });
  ok('A4 树龄档覆盖到 10 年以上', _years.length >= 5 && Math.max.apply(null, _years) >= 10);
  ok('A5 年轮档覆盖到 100 圈以上', _rings.length >= 3 && Math.max.apply(null, _rings) >= 100);
  ok('A6 森林规模档覆盖到 10000 棵（约 27 年）',
     defs.some(function (a) { return a.id === 'forest_10000'; }));

  /* A3 guide 层必须**全部**是「第一次做某事」（cond 里出现 >= 1 的语义），
     不允许把需要坚持的成就塞进 guide —— 那正是上一版的病根。 */
  var GUIDE_IDS = ['badge1', 'diary1', 'first', 'habit1', 'tree_eternal1', 'tree_harvest1'];
  var guideIds = defs.filter(function (a) { return a.tier === 'guide'; })
                     .map(function (a) { return a.id; }).sort();
  ok('A3 guide 层就是那 6 个「第一次做某事」',
     JSON.stringify(guideIds) === JSON.stringify(GUIDE_IDS.slice().sort()));

  /* ===== B 梯度：早起鸟 / 夜猫子 ===== */
  var early = defs.filter(function (a) { return a.id === 'early'; })[0];
  var night = defs.filter(function (a) { return a.id === 'night'; })[0];
  ok('B0 找到早起鸟 / 夜猫子', !!early && !!night);
  if (early && night) {
    var g1 = { earlyStreak: 1, nightStreak: 1 };
    var g2 = { earlyStreak: 2, nightStreak: 2 };
    var g3 = { earlyStreak: 3, nightStreak: 3 };
    ok('B1 早起鸟：1 天不再解锁（原 >= 1 太廉价）', early.cond(g1) === false);
    ok('B2 早起鸟：2 天仍不解锁', early.cond(g2) === false);
    ok('B3 早起鸟：连续 3 天解锁', early.cond(g3) === true);
    ok('B4 夜猫子：1 天不再解锁', night.cond(g1) === false);
    ok('B5 夜猫子：连续 3 天解锁', night.cond(g3) === true);
    ok('B6 两者都已脱离 guide 层', early.tier !== 'guide' && night.tier !== 'guide');
    ok('B7 说明文案与门槛一致（都写「连续3天」）',
       early.desc.indexOf('连续3天') >= 0 && night.desc.indexOf('连续3天') >= 0);
  }

  /* ===== C 成就页确实按四档渲染 ===== */
  (function () {
    var host = document.getElementById('achievementList');
    if (!host) { ok('C0 成就列表容器存在', false); return; }
    try {
      if (typeof switchView === 'function') switchView('stats');
      if (typeof switchStatsSubTab === 'function') switchStatsSubTab('ach');
      if (typeof renderAchListOnly === 'function') renderAchListOnly();
    } catch (e) {}
    var html = host.innerHTML || '';
    ok('C1 成就页画出了四档总览', ['入门', '铜', '银', '金'].every(function (t) { return html.indexOf(t) >= 0; }));
    /* 总览每档渲染成 `已点亮/总数`：'/' 紧跟该档总数再闭合 span */
    ok('C2 总览里的分档总数与定义表一致（6/24/34/26）',
       html.indexOf('/6</span>') >= 0 && html.indexOf('/24</span>') >= 0 &&
       html.indexOf('/34</span>') >= 0 && html.indexOf('/26</span>') >= 0);
  })();

  return JSON.stringify(R);
})();
