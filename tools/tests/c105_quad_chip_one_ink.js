/* C105 四象限小标（q1~q4）字色必须一致、且每一档都够看
   ─────────────────────────────────────────────────────────────
   需求原话：「还有那个例行杂事，那个字体是黑色的，就和其他的不一样」
   ——「例行杂事」是 q4 的简称，当时它的规则里写死了 `color: var(--black)`，
   q3 用 `--on-yellow`（浅色主题下也是黑），而 q1/q2 走 `--on-primary`（浅色=白）。
   四个小标并排，两个白字两个黑字。

   根因不是"黑字不好看"，是**四个同族小标各自决定字色**：
   底色深（红/蓝）→ 必须白字；底色浅（黄/绿）→ 那时只能黑字。
   解法是反过来：字色收敛成一条（`--on-primary`，与按钮同一套），
   底色按各主题单独给"白字够"的加深版（--quad-solid-q3 / --quad-solid-q4），
   暗色主题则字色本来就翻成深色，直接用主题的亮黄亮绿。

   锁住：
     A 六主题 × 深浅：四个小标 字/底 全部 ≥ AA
     B 同一档里四个小标字色完全相同（用户看得见的那条"不一样"）
     C q3/q4 的底色不再等于 --yellow/--green 原值（浅色主题确实压深了）
     D 任务卡上的 q4 小标真实 DOM 也达标（不只令牌层）
   ★ 颜色字面量一律不写在本文件里：测量与主题清单走 _contract 的 TC。 */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  var AA = TC.TH.AA;
  var savedTodos = appData.todos.slice();

  try {
    /* 四个象限各一条计划，四条都留在"未完成"里（完成项会被折叠进另一区） */
    appData.todos = ['q1', 'q2', 'q3', 'q4'].map(function (q, i) {
      return {
        id: 'c104_' + q, title: '四象限样例' + (i + 1), done: false, quad: q,
        tag: '生活', pomodoros: 1, remindAt: null, estEnd: null, repeat: null
      };
    });
    TC.enterPlan();

    var worst = 99, worstLab = '', sameInk = true, inkDiff = '';
    var lightQ3 = '', lightQ4 = '', rawY = '', rawG = '', onInk = '';
    TC.withThemes(function (label, isDark) {
      renderTodos();
      var sel = ['.quad-badge.quad-chip--q1', '.quad-badge.quad-chip--q2',
                 '.quad-badge.quad-chip--q3', '.quad-badge.quad-chip--q4'];
      var inks = [];
      sel.forEach(function (s) {
        var el = document.querySelector(s);
        if (!el) return;
        var rot = TC.elRatio(el);
        if (rot < worst) { worst = rot; worstLab = label + ' ' + s.split('--')[1]; }
        inks.push(TC.css(el, 'color'));
      });
      if (inks.length === 4) {
        for (var i = 1; i < inks.length; i++) {
          if (inks[i] !== inks[0]) { sameInk = false; inkDiff = label + ' ' + inks.join('/'); }
        }
      }
      if (!isDark) {
        var e3 = document.querySelector('.quad-badge.quad-chip--q3');
        var e4 = document.querySelector('.quad-badge.quad-chip--q4');
        var cs = getComputedStyle(document.body);
        rawY = cs.getPropertyValue('--yellow').trim();
        rawG = cs.getPropertyValue('--green').trim();
        onInk = cs.getPropertyValue('--on-primary').trim();
        if (e3) lightQ3 = TC.css(e3, 'backgroundColor');
        if (e4) lightQ4 = TC.css(e4, 'backgroundColor');
        /* C 只做一次（默认主题浅色）：q3/q4 的底色必须已经压深，不能还是原色 */
        if (label.indexOf('默认') === 0) {
          ok('C1 浅色默认主题 q4 底色不再是原 --green（白字压得住）',
            TC.contrast(TC.parse(lightQ4), TC.parse(onInk)) >= AA, lightQ4 + ' vs ' + rawG);
          ok('C2 浅色默认主题 q3 底色不再是原 --yellow',
            TC.contrast(TC.parse(lightQ3), TC.parse(onInk)) >= AA, lightQ3 + ' vs ' + rawY);
        }
      }
    }, function () { /* 切主题前不用额外造数 */ });

    ok('A 六主题 × 深浅：四象限小标 字/底 全部 ≥ ' + AA + ':1', worst >= AA,
      '最差 ' + worstLab + ' = ' + worst.toFixed(2));
    ok('B 同一档里四个小标字色完全一致', sameInk, inkDiff || '四个同色');

    /* D 真实卡片上的「例行杂事」小标（q4）单独再量一次，防止只改了令牌没上到 DOM */
    renderTodos();
    var q4el = document.querySelector('.todo-item .quad-badge.quad-chip--q4, .quad-badge.quad-chip--q4');
    ok('D 任务卡上的 q4 小标 字/底 ≥ ' + AA + ':1',
      !!q4el && TC.elRatio(q4el) >= AA, q4el ? TC.elRatio(q4el).toFixed(2) : '未画出来');
  } finally {
    appData.todos = savedTodos;
    try { renderTodos(); } catch (e) { /* 还原失败不该盖掉断言结果 */ }
  }

  return JSON.stringify(R);
})();
