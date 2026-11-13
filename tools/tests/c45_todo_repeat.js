/* C45 计划「重复周期」：不用每天手动加一条
   计划：新增「重复周期」，不用每天手动加一条。

   设计：task.repeat = { mode, weekdays[], dom, interval, anchor, last, next }
   - 规则运算全是纯函数（00_pure_core.js），Node 单测在 unit_pure.js 里已覆盖边界；
     本用例只打**运行时**：新增弹窗落盘 / 行内徽标 / 到点复位 / 每日清理不误删 / 编辑面板读写。
   - 「到点复位」的闸门是 repeat.next：next > today 什么都不做（所以一天跑几十次也只复位一次）。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var todosBak = JSON.stringify(appData.todos || []);
  var cleanBak = appData.lastTodoCleanupDate;
  var rankBak = JSON.stringify(appData.rankSystem || {});
  var today = getTodayStr();
  var tomorrow = addDaysStr(today, 1);
  function rowHtml(id) {
    var el = document.querySelector('.todo-item[data-id="' + id + '"]');
    return el ? el.innerHTML : '';
  }

  try {
    /* ① 新增弹窗：选「每天」→ 落盘 + next 指未来 + last = 今天 */
    appData.todos = [];
    if (typeof openAddTodoModal === 'function') openAddTodoModal();
    var sel = document.getElementById('addTodoRepeatMode');
    ok('① 新增弹窗里有重复下拉', !!sel);
    document.getElementById('addTodoTitle').value = '背单词';
    if (sel) {
      sel.value = 'daily';
      if (typeof onRepeatModeChange === 'function') onRepeatModeChange('addTodo');
    }
    if (typeof confirmAddTodo === 'function') confirmAddTodo();
    var t = (appData.todos || []).filter(function (x) { return x.title === '背单词'; })[0];
    ok('①b 「每天」规则落盘', !!t && !!t.repeat && t.repeat.mode === 'daily');
    ok('①c next 指向未来（不是今天）', !!t && !!t.repeat.next && t.repeat.next > today);
    ok('①d last 落在今天', !!t && t.repeat.last === today);

    /* ② 折叠态只留一个重复符号（★ 2026-10-25 口径，取代 10-19 的「另起一行写规则」）：
       周期文案全部收起，卡片上只剩一个 🔄 徽标；规则本身和「今天不做」
       都写进 title / aria-label —— 信息没丢，只是不占文字位。
       （老断言找的是 .todo-extra-line--rep 那一行，那行已经按新口径删了，
        所以这里改成验「徽标在 + 说明写全」，别再把已删的旧设计当契约。） */
    if (t && typeof renderTodos === 'function') renderTodos();
    var h0 = t ? rowHtml(t.id) : '';
    var _bAt = h0.indexOf('todo-rep-badge');
    var _bTag = _bAt < 0 ? '' : h0.slice(_bAt, h0.indexOf('>', _bAt) + 1);
    var _h0Text = h0.replace(/<[^>]*>/g, '');
    ok('② 折叠态只留一个重复符号，不写周期文案',
      _bAt >= 0 && _h0Text.indexOf('每天') < 0 && _h0Text.indexOf('🔄') >= 0, _bTag);
    ok('②a 徽标的 title 写清规则（重复规则：每天）、当天命中时不说「今天不做」',
      _bTag.indexOf('重复规则：每天') >= 0 && _bTag.indexOf('今天不做') < 0, _bTag);
    expandedTodos[t.id] = true;
    if (typeof renderTodos === 'function') renderTodos();
    var h = t ? rowHtml(t.id) : '';
    ok('②b 展开后能看到重复规则', h.indexOf('🔄') >= 0 && h.indexOf('每天') >= 0);
    expandedTodos[t.id] = false;
    if (typeof renderTodos === 'function') renderTodos();

    /* ③ 到期复位：同一条任务回到未完成，而不是复制新任务 */
    appData.todos = [{
      id: 9201, title: '每日复习', done: true, doneAt: today + ' 21:00',
      repeat: { mode: 'daily', last: addDaysStr(today, -1), next: today },
      subs: [{ id: 1, title: '子项', done: true }],
      actualPomodoros: 2, timeSpent: 100, reminded: true,
      remindAt: addDaysStr(today, -1) + ' 09:00', deadline: addDaysStr(today, -1)
    }];
    var changed = (typeof resetDueRepeatingTodos === 'function') ? resetDueRepeatingTodos(today) : null;
    ok('③ 到期的重复计划被复位', changed === true);
    var r1 = appData.todos[0] || {};
    ok('③b done 回到 false', r1.done === false);
    ok('③c 子任务一并复位', !!(r1.subs && r1.subs[0] && r1.subs[0].done === false));
    ok('③d 本次实际番茄/耗时清零', r1.actualPomodoros === 0 && r1.timeSpent === 0);
    ok('③e next 推到今天之后', !!r1.repeat && r1.repeat.next > today);
    ok('③f 幂等：同一天再跑一次什么都不做',
       (typeof resetDueRepeatingTodos === 'function') ? resetDueRepeatingTodos(today) === false : false);
    /* 提醒跟着平移到今天这一次（否则提醒停在昨天，永远不响）；
       截止日**不跟**（2026-10-21 工单方案 a）：它是「最晚完成日」这个约束本身，
       跟着今天走等于永远不逾期 —— 见 01d resetTodoOccurrence 里的说明。 */
    ok('③g 提醒时间平移到今天', String(r1.remindAt || '').slice(0, 10) === today);
    ok('③h 最晚完成日保留原日期（不再被改写成今天）',
       String(r1.deadline || '') === addDaysStr(today, -1),
       'deadline=' + String(r1.deadline) + ' expect ' + addDaysStr(today, -1));
    /* 完成历史不丢：勾选写的是按天记的流水，复位不碰它 */
    ok('③i 复位不产生"补出来的历史任务"', (appData.todos || []).length === 1);

    /* ④ 没到期的重复计划不动（next 在未来） */
    appData.todos = [{ id: 9202, title: '每周计划', done: true, repeat: { mode: 'daily', last: today, next: addDaysStr(today, 3) } }];
    var c4 = (typeof resetDueRepeatingTodos === 'function') ? resetDueRepeatingTodos(today) : null;
    ok('④ 未到期的重复计划不复位', c4 === false && appData.todos[0].done === true);

    /* ⑤ 每日清理：一次性完成的任务照旧清掉，重复计划留着（它明天还要回来） */
    appData.todos = [
      { id: 9203, title: '重复的', done: true, repeat: { mode: 'daily', last: today, next: tomorrow } },
      { id: 9204, title: '一次性的', done: true }
    ];
    appData.lastTodoCleanupDate = addDaysStr(today, -1);
    if (typeof checkNewDay === 'function') checkNewDay();
    var ids = (appData.todos || []).map(function (x) { return x.id; });
    ok('⑤ 已完成的一次性任务被清掉', ids.indexOf(9204) < 0);
    ok('⑤b 已完成的重复计划不会被清掉', ids.indexOf(9203) >= 0);

    /* ⑥ 编辑面板：读得出规则、改得动规则 */
    appData.todos = [{ id: 9205, title: '周计划', done: false, repeat: { mode: 'weekly', weekdays: [1, 3], next: tomorrow, last: today } }];
    if (typeof expandedTodos !== 'undefined') expandedTodos[9205] = true;
    if (typeof editingTodos !== 'undefined') editingTodos[9205] = true;
    if (typeof renderTodos === 'function') renderTodos();
    var mEl = document.getElementById('todo_9205_RepeatMode');
    ok('⑥ 编辑面板有重复控件且读到 weekly', !!mEl && mEl.value === 'weekly');
    var wdOn = document.querySelectorAll('#todo_9205_RepeatWeekdays .repeat-wd.on');
    ok('⑥b 星期二/四被点亮', wdOn.length === 2);
    if (mEl) {
      mEl.value = 'monthly';
      if (typeof onRepeatModeChange === 'function') onRepeatModeChange('todo_9205_', 9205);
      var domWrap = document.getElementById('todo_9205_RepeatDomWrap');
      var domEl = document.getElementById('todo_9205_RepeatDom');
      ok('⑥c 切「每月」后号数控件露出', !!domEl && !!domWrap && domWrap.style.display !== 'none');
      if (domEl) {
        domEl.value = '15';
        if (typeof forceSaveTodoDetail === 'function') forceSaveTodoDetail(9205, true);
        var t5 = (appData.todos || []).filter(function (x) { return x.id === 9205; })[0];
        ok('⑥d 落盘为「每月15日」', !!t5 && !!t5.repeat && t5.repeat.mode === 'monthly' && t5.repeat.dom === 15);
        ok('⑥e 重算 next = 本月/下个 15 号', !!t5 && !!t5.repeat.next && t5.repeat.next > today);
      } else {
        ok('⑥d 落盘为「每月15日」', false);
        ok('⑥e 重算 next = 本月/下个 15 号', false);
      }
    } else {
      ok('⑥c 切「每月」后号数控件露出', false);
      ok('⑥d 落盘为「每月15日」', false);
      ok('⑥e 重算 next = 本月/下个 15 号', false);
    }

    /* ⑦ 默认档 = 不重复：不写 repeat（老存档形状不变） */
    appData.todos = [{ id: 9206, title: '一次性', done: false }];
    if (typeof expandedTodos !== 'undefined') expandedTodos[9206] = true;
    if (typeof editingTodos !== 'undefined') editingTodos[9206] = true;
    if (typeof renderTodos === 'function') renderTodos();
    var m6 = document.getElementById('todo_9206_RepeatMode');
    ok('⑦ 默认档位是「不重复」', !!m6 && m6.value === 'none');
    if (typeof forceSaveTodoDetail === 'function') forceSaveTodoDetail(9206, true);
    ok('⑦b 不重复不写入 repeat 字段', !(appData.todos[0] || {}).repeat);

    /* ⑧ 从「不重复」切到「每周」自动勾上今天（一次点选的活儿） */
    var box = document.getElementById('addTodoRepeatBox');
    if (box) box.innerHTML = repeatUIHtml('addTodo', null);
    var s2 = document.getElementById('addTodoRepeatMode');
    if (s2) {
      s2.value = 'weekly';
      if (typeof onRepeatModeChange === 'function') onRepeatModeChange('addTodo');
    }
    ok('⑧ 切「每周」自动勾上今天', document.querySelectorAll('#addTodoRepeatWeekdays .repeat-wd.on').length >= 1);

    /* ⑩ 每月「最后一天」：
           dom=0 是合法档位，不是"没填"，控件里得真给一项，命中要落当月最后一天 */
    appData.todos = [{ id: 9207, title: '月度结算', done: false, repeat: { mode: 'monthly', dom: 0, last: today, next: tomorrow } }];
    if (typeof expandedTodos !== 'undefined') expandedTodos[9207] = true;
    if (typeof editingTodos !== 'undefined') editingTodos[9207] = true;
    if (typeof renderTodos === 'function') renderTodos();
    var m7 = document.getElementById('todo_9207_RepeatMode');
    var d7 = document.getElementById('todo_9207_RepeatDom');
    ok('⑩ 每月控件里有「最后一天」档', !!d7 && !!d7.querySelector('option[value="0"]'));
    ok('⑩b 打开时选中的是「最后一天」而不是 1 号', !!d7 && d7.value === '0');
    ok('⑩c 文案是「每月末」', todoRepeatLabel({ mode: 'monthly', dom: 0 }) === '每月末');
    ok('⑩d dom=0 只在当月最后一天命中',
       todoRepeatMatches({ mode: 'monthly', dom: 0 }, '2026-02-28') === true &&
       todoRepeatMatches({ mode: 'monthly', dom: 0 }, '2026-02-27') === false &&
       todoRepeatMatches({ mode: 'monthly', dom: 0 }, '2026-04-30') === true);
    ok('⑩e dom=0 能落盘（不被当成非法值丢掉）',
       (normTodoRepeat({ mode: 'monthly', dom: 0 }) || {}).dom === 0);

    /* ⑪ 「重复到哪天为止」：
           控件读得出、落得下；过了截止日自动降级成一次性计划，不留空转规则 */
    var uEl = document.getElementById('todo_9207_RepeatUntil');
    ok('⑪ 编辑面板有「重复到」控件', !!uEl);
    if (m7) { m7.value = 'daily'; if (typeof onRepeatModeChange === 'function') onRepeatModeChange('todo_9207_', 9207); }
    if (uEl) uEl.value = addDaysStr(today, 10);
    if (typeof forceSaveTodoDetail === 'function') forceSaveTodoDetail(9207, true);
    var t7 = (appData.todos || []).filter(function (x) { return x.id === 9207; })[0];
    ok('⑪b 截止日落盘', !!t7 && !!t7.repeat && t7.repeat.until === addDaysStr(today, 10));
    ok('⑪c next 不会越过截止日',
       !t7.repeat.next || t7.repeat.next <= t7.repeat.until);
    appData.todos = [{ id: 9208, title: '到期的重复', done: false, repeat: { mode: 'daily', last: addDaysStr(today, -3), next: today, until: addDaysStr(today, -1) } }];
    var c11 = (typeof resetDueRepeatingTodos === 'function') ? resetDueRepeatingTodos(today) : null;
    ok('⑪d 过了截止日 → 降级为一次性（repeat 清掉）', appData.todos[0].repeat === null);
    ok('⑪e 已过期的规则不命中', todoRepeatMatches({ mode: 'daily', until: addDaysStr(today, -1) }, today) === false);

    /* ⑫ 第二天子任务：保留并重置 / 清空 */
    appData.todos = [{
      id: 9209, title: '重复带子任务', done: true, repeat: { mode: 'daily', last: today, next: today, subsMode: 'reset' },
      subs: [{ id: 1, title: '甲', done: true, pomodoros: 1 }, { id: 2, title: '乙', done: true, pomodoros: 2 }]
    }];
    if (typeof resetDueRepeatingTodos === 'function') resetDueRepeatingTodos(today);
    var t9 = (appData.todos || [])[0];
    ok('⑫ reset 档：子任务留着、勾选清掉', t9.subs.length === 2 && t9.subs[0].done === false && t9.subs[1].done === false);
    ok('⑫b reset 档不动子任务的预计番茄', t9.subs[0].pomodoros === 1 && t9.subs[1].pomodoros === 2);
    appData.todos = [{
      id: 9210, title: '重复清空子任务', done: true, repeat: { mode: 'daily', last: today, next: today, subsMode: 'clear' },
      subs: [{ id: 1, title: '甲', done: true, pomodoros: 1 }]
    }];
    if (typeof resetDueRepeatingTodos === 'function') resetDueRepeatingTodos(today);
    ok('⑫c clear 档：第二天子任务整条清掉', (appData.todos[0].subs || []).length === 0);
    ok('⑫d clear 档落盘到规则里，不会自己漂回 reset',
       (normTodoRepeat({ mode: 'daily', subsMode: 'clear' }) || {}).subsMode === 'clear' &&
       (normTodoRepeat({ mode: 'daily' }) || {}).subsMode === 'reset');
    appData.todos = [{ id: 9209, title: 'T9', done: false, subs: [], repeat: { mode: 'daily', last: null, next: null, subsMode: 'clear' } }];
    expandedTodos[9209] = true; editingTodos[9209] = true; renderTodos();
    var sbSel = document.getElementById('todo_9209_RepeatSubs');
    ok('⑫e 编辑面板有「次日子任务」控件且读回 clear', !!sbSel && sbSel.value === 'clear', sbSel ? sbSel.value : 'MISSING');

    /* ⑬ 子任务的预计番茄：★ 整块收口。显示层 10-15 已移除，
       写入入口 setTodoSubPomo 与纯函数 todoSubPomos 10-17 删除。
       下面断言全部改成**防回流哨兵**：谁把这条路接回来，先红。 */
    appData.todos = [{
      id: 9211, title: '套卷', done: false, pomodoros: 1,
      subs: [{ id: 1, title: '选择题', done: false, pomodoros: 1 }, { id: 2, title: '大题', done: false, pomodoros: 2.5 }]
    }];
    if (typeof expandedTodos !== 'undefined') expandedTodos[9211] = true;
    if (typeof editingTodos !== 'undefined') editingTodos[9211] = true;
    if (typeof renderTodos === 'function') renderTodos();
    ok('⑬ 子任务番茄纯函数已删除（没有第二套口径）', typeof todoSubPomos === 'undefined');
    ok('⑬b 父计划预计只看本身 pomodoros（子任务不计入）', todoEstPomos(appData.todos[0]) === 1);
    ok('⑬c 没有子任务时就是自己', todoEstPomos({ pomodoros: 2 }) === 2 && todoEstPomos({}) === 0);
    ok('⑬d 子任务番茄写入口已删除（setTodoSubPomo 不存在）', typeof setTodoSubPomo === 'undefined');
    var rowTxt = (document.querySelector('.todo-item[data-id="9211"]') || {}).textContent || '';
    ok('⑬e 行内显示的是本身预计 1🍅', rowTxt.indexOf('1🍅') >= 0);
    ok('⑬f 计划行内不再渲染子任务番茄输入',
       document.querySelectorAll('.todo-item[data-id="9211"] .tf-sub-pomo-edit').length === 0);
    ok('⑬g 不再有子任务合计汇总行', rowTxt.indexOf('子任务合计') < 0);
    ok('⑬h 老存档里残留的子任务番茄不进父计划预计', todoEstPomos(appData.todos[0]) === 1 && appData.todos[0].subs[1].pomodoros === 2.5);
    ok('⑬i 行内也不显示子任务番茄值（2.5/1 都不该出现）',
       rowTxt.indexOf('2.5🍅') < 0 && rowTxt.indexOf('🍅2.5') < 0);
    /* 时长估算：给个起点才会走「自动推算」分支，然后比对「1🍅 的时长」。
       子任务那条路（1+1+2.5=4.5🍅）算出来的时长必须不同，否则这条断言没牙齿。 */
    appData.todos[0].remindAt = today + ' 09:00';
    ok('⑬j 时长估算按本身 1🍅（不是 1+1+2.5 = 4.5🍅）',
       todoEstInfo(appData.todos[0], appData.settings).mins === todoEstDurationMin(1, appData.settings) &&
       todoEstDurationMin(1, appData.settings) !== todoEstDurationMin(4.5, appData.settings));
        /* ⑬k 查看态（展开、不编辑）：也绝不能出现子任务番茄汇总。 */
    editingTodos[9211] = false; expandedTodos[9211] = true; renderTodos();
    var viewTxt = (document.querySelector('.todo-item[data-id="9211"]') || {}).textContent || '';
    /* ★ 同 ⑬f ——「含子任务」番茄汇总与子任务番茄徽标都是显示层，已随 10-15 (eb5c4a4) / 10-17 移除 */
    ok('⑬k 查看面板不再写子任务番茄汇总',
       viewTxt.indexOf('含子任务') < 0 && viewTxt.indexOf('子任务合计') < 0);

    /* ⑭ 跳过本次：今天不做、也不装完成 */
    appData.todos = [{
      id: 9212, title: '今天不想做', done: false,
      repeat: { mode: 'daily', last: today, next: today }
    }];
    if (typeof renderTodos === 'function') renderTodos();
    /* 「跳过本次」按钮与「已跳过」提示都在展开态：折叠态只留这一刻要做的事 */
    expandedTodos[9212] = true;
    if (typeof renderTodos === 'function') renderTodos();
    var row12 = document.querySelector('.todo-item[data-id="9212"]');
    ok('⑭ 展开后有「跳过本次」', !!row12 && row12.textContent.indexOf('跳过本次') >= 0);
    if (typeof skipTodoOccurrence === 'function') skipTodoOccurrence(9212);
    var t12 = (appData.todos || [])[0];
    ok('⑭b 跳过不写完成（不污染完成率/连击）', t12.done === false && t12.doneAt == null);
    ok('⑭c 跳过把规则推到下一次命中日', t12.repeat.next === addDaysStr(today, 1) && t12.skippedDate === today);
    var row12b = document.querySelector('.todo-item[data-id="9212"]');
    ok('⑭d 展开态切到「本次已跳过」', !!row12b && row12b.textContent.indexOf('本次已跳过') >= 0 && row12b.className.indexOf('skipped') >= 0);
    if (typeof resetDueRepeatingTodos === 'function') resetDueRepeatingTodos(today);
    ok('⑭e 同一天再跑跨天检查不会把跳过的又翻回来', appData.todos[0].done === false && appData.todos[0].skippedDate === today);
    if (typeof toggleTodo === 'function') toggleTodo(9212);
    ok('⑭f 反悔勾上 → 跳过标记自动清掉', appData.todos[0].skippedDate === null && appData.todos[0].done === true);

    /* ⑨ 行签名只含「规则本身」：last/next 每天自己走，进了签名会让行白白重建、丢输入焦点 */
    ok('⑨ 签名不含 next/last',
       todoRepeatSig({ mode: 'daily', last: '2026-01-01', next: '2026-01-02' }) ===
       todoRepeatSig({ mode: 'daily', last: '2026-09-09', next: '2026-12-12' }));
    ok('⑨b 签名含 weekdays',
       todoRepeatSig({ mode: 'weekly', weekdays: [1] }) !== todoRepeatSig({ mode: 'weekly', weekdays: [2] }));

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.todos = JSON.parse(todosBak); } catch (e) { appData.todos = []; }
    try { appData.rankSystem = JSON.parse(rankBak); } catch (e) {}
    appData.lastTodoCleanupDate = cleanBak;
    for (var _k = 9205; _k <= 9212; _k++) { delete expandedTodos[_k]; delete editingTodos[_k]; }
    if (typeof renderTodos === 'function') renderTodos();
    saveData();
  }
  return JSON.stringify(R);
})();
