/* C97 重复计划的排期不该写死某一天

   
     「那既然重复的，刨开那个单日那个排期，为什么它还会精确到日呢？这会让人产生误解吧」

   根因：重复任务的模板段是从「首日」**平移**到查看日的，日期是算出来的、每天都会再生成一次。
   写死成「2026-10-19 周一」就被读成「只有这一天这样」，跟下面的重复规则自相矛盾。

   本用例锁住四条口径：
     A 数据层：todoScheduleLines 给行打来源标记 —— rep（重复模板）/ fixed（按天覆盖）/ 都没有（一次性）
     B 展开态：重复模板段不写年月日，日期头换成规则文案（每天 / 每周一、三）
     C 按天覆盖：日期是真的 → 仍写完整年月日，并标「仅这天」
     D 一次性任务、历史快照：日期是真的 → 仍写完整年月日（防熊：别把精度一并删了）
     E 编辑面板：重复计划的段 chip 不写年月日，「排期」标签旁写明规则
     F 反证前提：rep 行的 date 恰好等于查看日（说明它只是平移来的，不是"那天专属") */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  function list() { return document.getElementById('todoList'); }
  function row(id) { return list().querySelector('.todo-item[data-id="' + id + '"]'); }
  function txt(el) { return el ? String(el.textContent).replace(/\s+/g, '') : ''; }
  /* ★ 别把时分写成字面量：tbMinLabel 跟 12/24 小时制设置走，
     21:00 在 12 小时制下会显示成「9:00」，写死断言就是假红（这轮踩过一次）。 */
  function hm(m) { return tbMinLabel(m); }

  var today = getTodayStr();
  var tmw = addDaysStr(today, 1);
  var YEAR = today.slice(0, 4) + '-';
  var bTodos = appData.todos.slice();
  var bLog = appData.todoSchedLog;

  try {
    /* ---------- A 数据层来源标记 ---------- */
    var tRep = {
      id: 'c97_rep', title: 'C97每天', done: false, pomodoros: 1, tag: '',
      repeat: { mode: 'daily', last: today, next: tmw },
      blocks: [{ start: today + ' 21:00', end: today + ' 21:30' }]
    };
    var tOnce = {
      id: 'c97_once', title: 'C97一次', done: false, pomodoros: 1, tag: '',
      remindAt: today + ' 07:00', estEnd: today + ' 08:00', estEndManual: true
    };
    var tRepDp = {
      id: 'c97_dp', title: 'C97覆盖', done: false, pomodoros: 1, tag: '',
      repeat: { mode: 'daily', last: today, next: tmw },
      blocks: [{ start: today + ' 21:00', end: today + ' 21:30' }],
      dayPlan: {}
    };
    tRepDp.dayPlan[today] = [{ start: today + ' 19:00', end: today + ' 19:40' }];

    var lRep = todoScheduleLines(tRep, today, appData.settings, null, today);
    var lOnce = todoScheduleLines(tOnce, today, appData.settings, null, today);
    var lDp = todoScheduleLines(tRepDp, today, appData.settings, null, today);
    ok('A1 重复计划的段被标成 rep（日期无意义）', lRep.length === 1 && lRep[0].rep === true,
      JSON.stringify(lRep));
    ok('A2 重复计划的段不被标成 fixed', lRep.length === 1 && !lRep[0].fixed);
    ok('A3 一次性任务的段不带 rep/fixed（日期是用户自己排的）',
      lOnce.length === 1 && !lOnce[0].rep && !lOnce[0].fixed, JSON.stringify(lOnce));
    ok('A4 按天覆盖那天被标成 fixed（日期是真的）',
      lDp.length === 1 && lDp[0].fixed === true && !lDp[0].rep, JSON.stringify(lDp));
    ok('A5 覆盖段的时间就是覆盖的那个时间', lDp.length === 1 && lDp[0].start === 19 * 60,
      lDp.length ? lDp[0].start : 'no row');
    /* 反证前提：rep 行的 date 就是查看日 —— 它就是平移出来的，写出来只会误导 */
    ok('F1 反证前提：rep 段的日期恰好等于查看日（平移结果，不是专属那天）',
      lRep.length === 1 && lRep[0].date === today, lRep.length ? lRep[0].date : 'no row');
    /* 历史快照行：那一天做过什么，是真实历史 → 不许打 rep */
    var yday = addDaysStr(today, -1);
    var snapLog = {};
    snapLog[yday] = [{
      id: 'c97_rep', date: yday, title: 'C97快照', quad: null, tag: '', remindAt: '',
      estEnd: '', estEndManual: false, deadline: null, pomodoros: 1, tbColor: '',
      actPomos: 0, doneAt: 0,
      blocks: [{ start: yday + ' 21:00', end: yday + ' 21:30' }]
    }];
    var lSnap = todoScheduleLines(tRep, yday, appData.settings, snapLog[yday], today);
    ok('A6 历史快照行不打 rep（历史是真实的那一天）',
      lSnap.length === 1 && !lSnap[0].rep && !lSnap[0].fixed, JSON.stringify(lSnap));

    /* ---------- DOM：展开态 ---------- */
    appData.todos = [tRep, tOnce, tRepDp];
    expandedTodos = {};
    editingTodos = {};
    switchView('plan');
    renderTodos();
    expandedTodos = { c97_rep: true, c97_once: true, c97_dp: true };
    renderTodos();

    var rRep = row('c97_rep');
    var rOnce = row('c97_once');
    var rDp = row('c97_dp');

    var schedRep = rRep ? rRep.querySelector('.tf-note-sched') : null;
    ok('B1 重复计划展开后有排期块', !!schedRep);
    ok('B2 排期块里不出现完整年月日（这就是误解的来源）',
      schedRep && txt(schedRep).indexOf(YEAR) < 0, schedRep ? txt(schedRep) : 'no block');
    var repHead = rRep ? rRep.querySelector('.tf-sched-day--rep') : null;
    ok('B3 日期头换成规则文案（.tf-sched-day--rep）', !!repHead);
    ok('B4 规则文案写的是「每天」', txt(repHead) === '每天', txt(repHead));
    ok('B5 时段照常写出来（按当前小时制格式化 21:00–21:30）',
      schedRep && txt(schedRep).indexOf(hm(1260) + '–' + hm(1290)) >= 0, schedRep ? txt(schedRep) : 'no block');
    ok('B6 重复计划不再出现普通日期头',
      rRep && !rRep.querySelector('.tf-sched-day:not(.tf-sched-day--rep)'));

    /* ---------- C 按天覆盖那天：日期是真的 ---------- */
    var schedDp = rDp ? rDp.querySelector('.tf-note-sched') : null;
    ok('C1 覆盖那天仍写完整年月日', schedDp && txt(schedDp).indexOf(today) >= 0,
      schedDp ? txt(schedDp) : 'no block');
    ok('C2 覆盖那天标「仅这天」', !!(rDp && rDp.querySelector('.tf-sched-tag')));
    /* 规则头只许跟着「其余日子」走；覆盖行本身不写规则（它是这一天的话，不是每次的话） */
    ok('C3 规则头只出现在「其余日子」行里，不混进「仅这天」那行', (function () {
      if (!rDp) return false;
      var heads = rDp.querySelectorAll('.tf-sched-day--rep');
      for (var i = 0; i < heads.length; i++) {
        var par = heads[i].closest('.tf-sched-row');
        if (!par || par.className.indexOf('tf-sched-row--tpl') < 0) return false;
      }
      return true;
    })(), rDp ? txt(rDp) : 'no row');
    /* ★ 模板那段**可以**出现在「其余日子」行里（那是它的正确归属），
       但绝不能与覆盖段混在同一行 —— 混在一起才叫"两个答案"。 */
    ok('C4 覆盖那天的时段是覆盖段，模板那段不混进「仅这天」那行',
      schedDp && txt(schedDp).indexOf(hm(1140) + '–' + hm(1180)) >= 0 && (function () {
        var rows = schedDp.querySelectorAll('.tf-sched-row');
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].className.indexOf('tf-sched-row--tpl') >= 0) continue;
          if (rows[i].textContent.indexOf(hm(1260)) >= 0) return false;
        }
        return true;
      })(), schedDp ? txt(schedDp) : 'no block');

    /* ---------- D 一次性任务：精度不许一起被删 ---------- */
    var schedOnce = rOnce ? rOnce.querySelector('.tf-note-sched') : null;
    ok('D1 一次性任务仍写完整年月日', schedOnce && txt(schedOnce).indexOf(today) >= 0,
      schedOnce ? txt(schedOnce) : 'no block');
    ok('D2 一次性任务没有规则头', !(rOnce && rOnce.querySelector('.tf-sched-day--rep')));
    ok('D3 一次性任务没有「仅这天」标（它本来就是那一天）',
      !(rOnce && rOnce.querySelector('.tf-sched-tag')));

    /* ---------- E 编辑面板 ---------- */
    editingTodos = { c97_rep: true, c97_once: true };
    renderTodos();
    var eRep = row('c97_rep');
    var eOnce = row('c97_once');
    var chipsRep = eRep ? Array.prototype.slice.call(eRep.querySelectorAll('.tf-chip--block')) : [];
    var chipsOnce = eOnce ? Array.prototype.slice.call(eOnce.querySelectorAll('.tf-chip--block')) : [];
    ok('E1 重复计划的段 chip 存在', chipsRep.length === 1, 'chips=' + chipsRep.length);
    ok('E2 重复计划的段 chip 不写年月日',
      chipsRep.length === 1 && txt(chipsRep[0]).indexOf(YEAR) < 0, chipsRep.length ? txt(chipsRep[0]) : '');
    ok('E3 重复计划的段 chip 仍写时分',
      chipsRep.length === 1 && txt(chipsRep[0]).indexOf(hm(1260) + '–' + hm(1290)) >= 0,
      chipsRep.length ? txt(chipsRep[0]) : '');
    ok('E4 「排期」标签旁写明规则', eRep && /每天都按这个时间来/.test(txt(eRep)));
    ok('E5 一次性计划的段 chip 仍写完整年月日',
      chipsOnce.length === 1 && txt(chipsOnce[0]).indexOf(today) >= 0,
      chipsOnce.length ? txt(chipsOnce[0]) : '');
    ok('E6 一次性计划的「排期」标签旁不加规则说明', eOnce && !/都按这个时间来/.test(txt(eOnce)));
  } finally {
    appData.todos = bTodos;
    appData.todoSchedLog = bLog;
    expandedTodos = {};
    editingTodos = {};
    renderTodos();
  }

  /* ===== G 组：被按天覆盖那天，模板也得看得见 + 卡片底部 🏁 不写死日期 =====
     需求同一条质疑的另外两个出口：
       ① 覆盖那天只写「仅这天 7:00–7:40」，模板 21:00 就没地方出现了 → 像是被改掉了；
       ② 卡片 meta 的「🏁 2026-10-20 21:30」对重复任务同样是假精度。 */
  (function () {
    var tg = { id: 'c97_tpl', title: 'C97模板', done: false, pomodoros: 1, tag: '',
      repeat: { mode: 'daily', last: today, next: tmw },
      blocks: [{ start: today + ' 21:00', end: today + ' 21:30' }] };
    tg.dayPlan = {}; tg.dayPlan[today] = [{ start: today + ' 19:00', end: today + ' 19:40' }];
    appData.todos = [tg];
    expandedTodos = {}; expandedTodos[tg.id] = true; editingTodos = {};
    switchViewCore('plan'); renderTodos();
    var row = document.querySelector('.todo-item[data-id="' + tg.id + '"]');
    var tplRow = row ? row.querySelector('.tf-sched-row--tpl') : null;
    ok('G1 覆盖那天补出「其余日子」一行（模板没被吞掉）', !!tplRow,
      row ? String(row.textContent).replace(/\s+/g, '').slice(0, 160) : 'no row');
    ok('G2 那一行写的是模板时段（不是覆盖段）',
      !!tplRow && tplRow.textContent.indexOf(hm(1260) + '–' + hm(1290)) >= 0 &&
        tplRow.textContent.indexOf(hm(1140)) < 0,
      tplRow ? tplRow.textContent : '');
    ok('G3 那一行带重复规则文案（其余日子 · 每天）',
      !!tplRow && tplRow.textContent.indexOf('其余日子') >= 0 && /每天|工作日|每周|每月|每天隔/.test(tplRow.textContent),
      tplRow ? tplRow.textContent : '');

    /* ④ 卡片底部的「🏁 结束」：重复任务只写时分 + （每次），不写死某天 */
    var te = { id: 'c97_est', title: 'C97结束', done: false, pomodoros: 1, tag: '',
      repeat: { mode: 'daily', last: today, next: tmw },
      remindAt: today + ' 21:00', estEnd: today + ' 21:30', estEndManual: true };
    appData.todos = [te];
    expandedTodos = {}; expandedTodos[te.id] = true; editingTodos = {};
    switchViewCore('plan'); renderTodos();
    var rowE = document.querySelector('.todo-item[data-id="' + te.id + '"]');
    var metaTxt = rowE ? String(rowE.textContent).replace(/\s+/g, '') : '';
    ok('G4 重复任务的「🏁 结束」不写年月日',
      metaTxt.indexOf('🏁' + today) < 0, metaTxt.slice(0, 200));
    ok('G5 但仍写出时分 + 说明它是每次',
      metaTxt.indexOf(hm(1290)) >= 0 && metaTxt.indexOf('每次') >= 0, metaTxt.slice(0, 200));

    appData.todos = bTodos; appData.todoSchedLog = bLog;
    expandedTodos = {}; editingTodos = {};
  })();

  return JSON.stringify(R);
})();
