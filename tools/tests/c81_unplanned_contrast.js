/* C81 日程网格色块的文字对比度（整张色板 · 浅色/深色/六个命名主题）
   ─────────────────────────────────────────────────────────────
   需求原话第一句：「帮我看看为什么我吃饭，还有那个网上图文问诊，
   为什么那个字体颜色那么不清楚？在日程表上，就它背景是个深色，它字体也是一个
   深色，就看着很不明显」
   第二句（我第一版只修了灰块之后）：「白色和深色对比又太明显了 你光修了这一处，
   那其他的呢」

   ★ 这条用例就是为"那其他的呢"写的：**不止灰块，整张色板都要量。**

   两类根因：
   ① 计划外灰块 = `background: var(--border); color: var(--text-light); opacity:.9`
      —— --border 是「描边」语义、--text-light 是「辅助小字」档，两者都是随主题变的暗色
      → 深底 + 深字。实测 rosepine 1.65:1、浅色 2.07:1。
   ② 任务色板 `TB_PALETTE` 的 dark 档只够 3.9~4.6:1（light 底上），
      而实际块是「solid 实色底 + dark 字」→ 只有 **2.2~2.8:1**，整行字都糊。

   本用例锁住（A~F 灰块，G~L 色板，M/N 六主题，反证见 K2）：
     A 计划外块存在且完全不透明
     B 浅色下 字/底 ≥ TC.TH.AA
     C 深色模式下 ≥ TC.TH.AA
     D 深色下灰块确实换了档（不再亮灰一抹）
     E 图例「计划外」与色块同色（两种模式都要）
     F 灰块与纸底能分离（≥ BLOCK_MIN）但不过分（≤ BLOCK_MAX，别又变成刺眼亮块）
     G 全色板 light 底 + dark 字 ≥ AA（16 色逐个）
     H 全色板 solid 底 + ink 字 ≥ AA（16 色逐个）
     I 字色不"过头"：≤ INK_MAX（"太明显"的量化门槛）
     J 色板 dark/ink 与底同色相（不是拿灰黑糊上去）
     K 实际块真实 DOM 的 字/底 ≥ AA
     L 预计块真实 DOM 的 字/底 ≥ AA
     M 六主题×深浅 灰块 字/块 全部 ≥ AA
     N 六主题×深浅 灰块与纸底在 [BLOCK_MIN, BLOCK_MAX]

   ★ 测量原语、阈值、主题清单全部改用 `_contract.js` 的 `TC`。
     以前这条用例自己抄了一份 rgba()/ratio()/hue()，而且主题清单也是本地数组 ——
     于是「color-mix() 的结果是 color(srgb …)」这件事要在每个用例里各修一遍，
     加第 7 个主题要翻遍所有文件。现在这些只有一份，改要求只改 TC.TH。
     **本文件里不该再出现任何颜色字面量或自造的测量函数。** */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function dsOf(off) {
    var d = new Date();
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + off);
    return getDateStr(d);
  }
  var AA = TC.TH.AA, INK_MAX = TC.TH.INK_MAX, TOL = TC.TH.HUE_TOL;

  var bTodos = appData.todos.slice();
  var bRecs = appData.records.slice();
  var today = dsOf(0);
  var PID = 'c81_plan';
  var savedTheme = document.body.getAttribute('data-theme');
  var savedDark = document.body.classList.contains('dark-mode');

  try {
    /* 一条真计划（预计块 + 实际块都画出来）+ 一条计划外记录（灰块） */
    appData.todos = [{
      id: PID, title: '有计划的活', done: false, quad: 'q2', tag: '生活',
      remindAt: today + ' 09:00', estEnd: today + ' 10:00', repeat: null,
      pomodoros: 1, tbColor: 'v4rose'
    }];
    var _s = new Date(today + 'T08:00:00').getTime();
    /* ★ 实际段的唯一来源是 records（见 01d tbSegIndex），只塞 actualSegs 是画不出实际块的 ——
       第一版就栽在这：K 拿到的 0 看着像配色问题，其实是"压根没画出来"。
       所以这里造两条记录：一条挂 todoId 画实际块，一条不挂画计划外灰块。 */
    appData.records = [
      { id: 'c81_act', todoId: PID, type: 'full', taskName: '有计划的活',
        startTime: _s + 60 * 60000, endTime: _s + 90 * 60000, effectiveSeconds: 1800,
        pomos: 1, segs: [{ s: _s + 60 * 60000, e: _s + 90 * 60000 }] },
      { id: 'c81_rec', type: 'full', taskName: '计划外的事',
        startTime: _s, endTime: _s + 25 * 60000, effectiveSeconds: 1500,
        pomos: 1, todoId: null, segs: [{ s: _s, e: _s + 25 * 60000 }] }
    ];
    appData.todos[0].actualPomodoros = 1;
    appData.todos[0].actualSegs = [{ s: _s + 60 * 60000, e: _s + 90 * 60000 }];
    document.body.classList.remove('dark-mode');
    document.body.setAttribute('data-theme', 'rosepine');
    if (window.tbPickDate) window.tbPickDate(today);
    /* ★ 先固定现场再量：全新存档启动停在 view-timer，且折叠真值是 undefined（=折叠），
       不在 view-plan 里量到的纸底是透明的 —— 这类"环境红"一律交给契约 TC.enterPlan()，
       用例里不再自己拨 class（真值在 settings.tbGridFolded，摘 class 会被重绘加回来）。 */
    var unfold = TC.enterPlan();

    var unp = function () { return document.querySelector('.tb-paper-blk.is-unplanned'); };
    var A = unp();
    if (!A) throw new Error('网格里没有计划外块（造数没画出来）');
    var op0 = parseFloat(TC.css(A, 'opacity') || '1');
    ok('A 计划外块存在且完全不透明', op0 === 1, 'opacity=' + op0);
    var r0 = TC.elRatio(A);
    ok('B 浅色主题 灰块 字/底 ≥ ' + AA + ':1', r0 >= AA, 'ratio=' + r0.toFixed(2));
    var bg0 = TC.css(A, 'backgroundColor');
    var keyBg0 = TC.css(document.querySelector('.tb-paper-key.is-unplanned'), 'backgroundColor', '::before');
    ok('E1 浅色下图例「计划外」与灰块同色', keyBg0 === bg0, 'legend=' + keyBg0 + ' blk=' + bg0);

    /* ---- 深色（dark-mode）---- */
    document.body.classList.add('dark-mode');
    try { renderTimeBlockGrid(); } catch (e2) {}
    var C = unp();
    var r1 = TC.elRatio(C);
    ok('C 深色模式 灰块 字/底 ≥ ' + AA + ':1', !!C && r1 >= AA, 'ratio=' + r1.toFixed(2));
    var bg1 = C ? TC.css(C, 'backgroundColor') : '';
    ok('D 深色下灰块换了档（不是同一块亮灰）', !!bg1 && bg1 !== bg0, 'light=' + bg0 + ' dark=' + bg1);
    var keyBg1 = TC.css(document.querySelector('.tb-paper-key.is-unplanned'), 'backgroundColor', '::before');
    ok('E2 深色下图例与灰块同色', keyBg1 === bg1, 'legend=' + keyBg1 + ' blk=' + bg1);
    document.body.classList.remove('dark-mode');
    try { renderTimeBlockGrid(); } catch (e3) {}

    /* F 与纸底分离：太近=糊，太远=刺眼
       ★ 现场已在用例开头由 TC.enterPlan() 固定（视图=plan、非折叠），这里只量，
       不再自己拨 class —— 环境问题归契约，别在每个用例里各修一遍。 */
    var sepL = 0, sepD = 0, paperL = '', paperD = '';
    try {
      paperL = TC.css(TC.paperEl(), 'backgroundColor');
      var pL = TC.parse(paperL);
      if (pL && pL.a >= 1) sepL = TC.contrast(TC.parse(bg0), pL);
      document.body.classList.add('dark-mode');
      try { renderTimeBlockGrid(); } catch (e4) {}
      paperD = TC.css(TC.paperEl(), 'backgroundColor');
      var pD = TC.parse(paperD), bD = TC.parse(bg1);
      if (pD && pD.a >= 1 && bD) sepD = TC.contrast(bD, pD);
    } finally {
      document.body.classList.remove('dark-mode');
      try { renderTimeBlockGrid(); } catch (e5) {}
    }
    ok('F 灰块与纸底能分清但不过分（' + TC.TH.BLOCK_MIN + '~' + TC.TH.BLOCK_MAX + ':1）',
      sepL >= TC.TH.BLOCK_MIN && sepL <= TC.TH.BLOCK_MAX &&
      sepD >= TC.TH.BLOCK_MIN && sepD <= TC.TH.BLOCK_MAX,
      'light=' + sepL.toFixed(2) + ' dark=' + sepD.toFixed(2) +
      ' paperD=' + paperD + ' paperL=' + paperL + ' bg0=' + bg0 + ' bg1=' + bg1);

    /* ---- 全色板：16 色逐个量 ---- */
    var keys = ['v4coral', 'v4amber', 'v4gold', 'v4olive', 'v4lime', 'v4moss', 'v4fern', 'v4jade',
                'v4teal', 'v4sky', 'v4azure', 'v4violet', 'v4plum', 'v4orchid', 'v4magenta', 'v4rose'];
    var badG = [], badH = [], badI = [], badJ = [];
    for (var i = 0; i < keys.length; i++) {
      var c = window.tbPalette(keys[i]);
      var light = TC.hex2rgb(c.light), solid = TC.hex2rgb(c.solid);
      var dark = TC.hex2rgb(c.dark), ink = TC.hex2rgb(c.ink);
      if (!light || !solid || !dark || !ink) { badG.push(keys[i] + ' 色值解析失败'); continue; }
      var rg = TC.contrast(dark, light), rh = TC.contrast(ink, solid);
      if (!(rg >= AA)) badG.push(keys[i] + ' ' + rg.toFixed(2));
      if (!(rh >= AA)) badH.push(keys[i] + ' ' + rh.toFixed(2));
      if (rg > INK_MAX || rh > INK_MAX) badI.push(keys[i] + ' ' + rg.toFixed(1) + '/' + rh.toFixed(1));
      /* dark 与 light 同色相、ink 与 solid 同色相（降明度会带一点色相漂移，容差 TC.TH.HUE_TOL） */
      if (TC.hueDiff(light, dark) > TOL) badJ.push(keys[i] + '.dark');
      if (TC.hueDiff(solid, ink) > TOL) badJ.push(keys[i] + '.ink');
    }
    ok('G 全色板 预计块（light 底 + dark 字）16 色全部 ≥ ' + AA + ':1', badG.length === 0, badG.join(' / '));
    ok('H 全色板 实际块（solid 底 + ink 字）16 色全部 ≥ ' + AA + ':1', badH.length === 0, badH.join(' / '));
    ok('I 字色不"过头"（≤' + INK_MAX + ':1，不用纯黑纯白）', badI.length === 0, badI.join(' / '));
    ok('J 字色与底同色相（不是拿灰黑硬压）', badJ.length === 0, badJ.join(' / '));

    /* ---- 真实 DOM：预计块 / 实际块 ---- */
    var planEl = document.querySelector('.tb-paper-blk.is-plan');
    var actEl = document.querySelector('.tb-paper-blk.is-actual');
    var rK = TC.elRatio(actEl), rL = TC.elRatio(planEl);
    ok('K 实际块真实 DOM 字/底 ≥ ' + AA + ':1', !!actEl && rK >= AA, 'ratio=' + rK.toFixed(2));
    ok('L 预计块真实 DOM 字/底 ≥ ' + AA + ':1', !!planEl && rL >= AA, 'ratio=' + rL.toFixed(2));

    /* ---- M/N：六个命名主题 × 深浅，灰块都得「字看得清 + 块看得见」 ----
       ★ 这条是实地踩坑补的：灰块第一版写成固定两档色，在 nord 深色纸底 #3B4252 上
       只有 1.05:1 —— **块直接消失**，而当时只测了默认主题所以全绿。
       主题清单来自 TC.THEMES：加第 7 个主题只改 _contract.js 一处，这条自动跟上。 */
    var badM = [], badN = [];
    TC.withThemes(function (tag) {
      var ue = document.querySelector('.tb-paper-blk.is-unplanned');
      var pa = document.querySelector('.tb-paper');
      if (!ue || !pa) { badM.push(tag + ' 无灰块'); return; }
      var fg = TC.parse(TC.css(ue, 'color'));
      var bgr = TC.parse(TC.css(ue, 'backgroundColor'));
      var ppr = TC.parse(TC.css(pa, 'backgroundColor'));
      if (!fg || !bgr || !ppr) { badM.push(tag + ' 解析失败'); return; }
      var r1 = TC.contrast(fg, bgr), r2 = TC.contrast(bgr, ppr);
      if (!(r1 >= AA)) badM.push(tag + ' 字/块=' + r1.toFixed(2));
      if (!(r2 >= TC.TH.BLOCK_MIN && r2 <= TC.TH.BLOCK_MAX)) badN.push(tag + ' 块/纸=' + r2.toFixed(2));
    }, function () {
      /* 每切一档重画一次：01eA 的块色是 JS 内联写的，光改 class 不会自动换 */
      try { renderTimeBlockGrid(); } catch (e7) {}
    });
    ok('M 六主题×深浅 灰块字/块 全部 ≥ ' + AA + ':1', badM.length === 0, badM.join(' / '));
    ok('N 六主题×深浅 灰块与纸底 ' + TC.TH.BLOCK_MIN + '~' + TC.TH.BLOCK_MAX + ':1（看得见又不抢眼）',
      badN.length === 0, badN.join(' / '));
  } catch (e) {
    ok('用例执行未抛异常：' + (e && e.message), false);
  } finally {
    appData.todos = bTodos;
    appData.records = bRecs;
    /* 还原现场：视图/折叠真值 + 主题/深浅 + 重画。**不用 toggleDarkMode** ——
       它会把 darkMode 写进 appData.settings，本地批量跑完会污染后面的用例（C52 就吃过这个）。 */
    try { unfold(); } catch (e9) {}
    try { document.body.classList.toggle('dark-mode', savedDark); } catch (e5) {}
    try {
      if (savedTheme) document.body.setAttribute('data-theme', savedTheme);
      else document.body.removeAttribute('data-theme');
    } catch (e8) {}
    try { renderTodos(); renderTimeBlockGrid(); } catch (e6) {}
  }
  return JSON.stringify(R);
})();
