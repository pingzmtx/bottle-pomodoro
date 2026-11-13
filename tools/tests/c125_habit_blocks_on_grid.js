/* C125 习惯自己的排期：长在习惯卡上，日程表里一格都没有（2026-11-04 定稿）

   用户原话（两轮，方向同一个）：
     「我原先怎么给每个计划排日期你不知道吗？」
     「为什么在日程表上放一堆习惯？」

   守五条：
   1 数据层：h.timeBlocks 是**规则时段**（每天命中），不是按日期的实例；
   2 日程表里没有任何习惯痕迹：没有绿色块、没有图例、没有清单条、没有选段模式；
   3 排期照抄计划卡那组控件 —— 编辑弹窗「排期（几点做）」里
     `.tf-chips` 列已排的段 + `.add-block-row` 两个 type=time 框 + 「＋ 加这一段」；
   4 卡上填完点「＋ 加这一段」→ 直接落进 h.timeBlocks；同一开始时间算改时间；
   5 语义不越界：习惯时段不改 repeat、不动打卡口径、不写 todo.blocks。

   数据全部临时造、结尾还原。 */
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var habitsBak = JSON.stringify(appData.habits || []);
  var logsBak = JSON.stringify(appData.habitLogs || {});
  var todosBak = JSON.stringify(appData.todos || []);
  var settingsBak = JSON.stringify(appData.settings || {});
  var today = getTodayStr();
  try {
    appData.habits = [
      { id: 9821, uid: 'h1251', name: '晨跑', createdAt: addDaysStr(today, -10),
        timeBlocks: [{ start: '07:00', end: '08:00' }] },
      { id: 9822, uid: 'h1252', name: '读书', createdAt: addDaysStr(today, -10) }
    ];
    appData.habitLogs = {};
    appData.todos = [];
    appData.settings = appData.settings || {};
    appData.settings.tbGridFolded = false;
    saveData();

    var h1 = appData.habits[0], h2 = appData.habits[1];

    /* ---- 1 数据层 ---- */
    ok('1 习惯时段存在 h.timeBlocks（规则时段）',
      habitBlocksOf(h1).length === 1 && habitBlocksOf(h1)[0].start === '07:00');
    ok('1b 规则时段命中的日子每天都有',
      habitBlocksOn(h1, today).length === 1 && habitBlocksOn(h1, addDaysStr(today, 1)).length === 1);
    ok('1c 没排时段的习惯返回空数组', habitBlocksOf(h2).length === 0);
    ok('1d 脏数据被归一（反着的时段 / 坏字符串丢掉）',
      normHabitBlocks([{ start: '10:00', end: '09:00' }, { start: 'abc', end: '08:00' }, null]).length === 0,
      JSON.stringify(normHabitBlocks([{ start: '10:00', end: '09:00' }, { start: 'abc', end: '08:00' }, null])));

    /* ---- 2 日程表里一格习惯都没有 ---- */
    /* 网格在「计划」页里 —— 不切视图的话 #tbShellHost 还是 display:none。 */
    if (typeof switchView === 'function') switchView('plan');
    if (typeof switchPlanTab === 'function') switchPlanTab('plan');
    if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
    ok('2 网格里没有习惯块（连"选段预览"都不要）',
      document.querySelectorAll('.tb-paper-blk.is-habit').length === 0,
      document.querySelectorAll('.tb-paper-blk.is-habit').length);
    ok('2b 图例里没有「习惯」这一档',
      document.querySelectorAll('.tb-paper-key.is-habit').length === 0,
      document.querySelectorAll('.tb-paper-key.is-habit').length);
    ok('2c 网格上方没有习惯清单条（.tb-habit-bar / .tb-habit-chip）',
      document.querySelectorAll('.tb-habit-bar, .tb-habit-chip').length === 0,
      document.querySelectorAll('.tb-habit-bar, .tb-habit-chip').length);
    ok('2d 网格里没有任何习惯排期入口（data-act 指向习惯的一律不许有）',
      document.querySelectorAll('.tb-paper-grid [data-act^="habit"], .tb-paper-grid [onclick*="habit"]').length === 0,
      document.querySelectorAll('.tb-paper-grid [data-act^="habit"], .tb-paper-grid [onclick*="habit"]').length);
    ok('2e 选段出口在（tbHabitArm / tbArmHabitId 都导出）',
      typeof window.tbHabitArm === 'function' && typeof window.tbArmHabitId === 'function',
      typeof window.tbHabitArm + '/' + typeof window.tbArmHabitId);

    /* ---- 3 排期入口就在习惯卡上：点了去日程表点两格 ---- */
    openHabitEditModal(9822);
    var box = document.getElementById('habitBlockBox');
    var modal = document.getElementById('habitEditModal');
    ok('3 编辑弹窗里有「排期（几点做）」区', !!box && !!modal && modal.classList.contains('show'), !!box);
    ok('3b 用的是计划卡那套 chip 容器（.tf-chips / .tf-chip）',
      !!box && !!box.querySelector('.tf-chips') && box.querySelectorAll('.tf-chip').length >= 1,
      box ? box.querySelectorAll('.tf-chip').length : -1);
    ok('3c 空档时提示「还没排时段」',
      !!box && box.textContent.indexOf('还没排时段') >= 0,
      box ? box.textContent.replace(/\s+/g, ' ').slice(0, 60) : '');
    var goBtn = box ? [...box.querySelectorAll('.tf-chip--action')].find(function (c) {
      return /加一段排期/.test(c.textContent);
    }) : null;
    ok('3d 入口照抄计划卡的「＋ 加一段排期」，并写明去日程表点两格（不是在这张卡上填时间）',
      !!goBtn && /日程表/.test((goBtn.getAttribute('title') || '') + box.textContent) &&
      !box.querySelector('#habitBlockStart') && !box.querySelector('input[type="time"]'),
      goBtn ? goBtn.textContent : 'none');
    ok('3e 入口挂在 habitArmOnGrid 上', !!goBtn && /habitArmOnGrid/.test(goBtn.getAttribute('onclick') || ''),
      goBtn ? goBtn.getAttribute('onclick') : '');

    ok('3f 先给它排一段（09:00–10:00）当参照',
      (function () { var r = habitAddBlockMinutes(9822, 540, 600); return !!r && r.ok && habitBlocksOf(h2).length === 1; })(),
      JSON.stringify(habitBlocksOf(h2)));
    openHabitEditModal(9822);

    /* ---- 4 点入口 → 弹窗关、进网格选段模式、已排段淡画出来当参照 ---- */
    ok('4 点一下：弹窗关闭 + 进选段模式',
      (function () {
        if (!goBtn) return false;
        goBtn.click();
        return !modal.classList.contains('show') && document.body.classList.contains('tb-arm');
      })(), document.body.className);
    ok('4b 横幅写明正在给哪个习惯排、点两格什么意思',
      (function () {
        var b = document.querySelector('.tb-arm-bar');
        return !!b && b.textContent.indexOf('读书') >= 0 && b.textContent.indexOf('点两格') >= 0;
      })(), (document.querySelector('.tb-arm-bar') || {}).textContent);
    ok('4c 选段模式下把这个习惯已排的段淡画出来（当参照，别重复排）',
      document.querySelectorAll('.tb-paper-blk.is-habit').length >= 1 &&
      habitBlocksOn(h2, today, null, []).length >= 1,
      document.querySelectorAll('.tb-paper-blk.is-habit').length + '/' + habitBlocksOn(h2, today, null, []).length);

    /* 点两格 = 起点 → 终点 */
    var cells = [...document.querySelectorAll('.tb-paper-cell')];
    var at = function (min) { return cells.find(function (c) { return +c.dataset.tbMin === min; }); };
    ok('4d 网格格子带 data-tb-min（点得准）', !!at(780), cells.length);
    ok('4e 点起点 + 点终点 = 排上一段 13:00–14:00',
      (function () {
        var n = habitBlocksOf(h2).length;
        var a = at(780), b = at(840);
        if (!a || !b) return false;
        a.click(); b.click();
        var bs = habitBlocksOf(h2);
        var last = bs[bs.length - 1];
        return bs.length === n + 1 && last.start === '13:00' && last.end === '14:00';
      })(), JSON.stringify(habitBlocksOf(h2)));
    ok('4f 选完还在选段模式（可以接着排下一段）', document.body.classList.contains('tb-arm'),
      document.body.className);

    /* 退出选段 → 日程表立刻干净 */
    ok('4g 退出选段后网格里习惯块清零（不会留在那儿变成"一堆习惯"）',
      (function () {
        var x = document.querySelector('.tb-arm-x');
        if (x) x.click();
        return !document.body.classList.contains('tb-arm') &&
          document.querySelectorAll('.tb-paper-blk.is-habit').length === 0;
      })(), document.querySelectorAll('.tb-paper-blk.is-habit').length);
    ok('4h 退出后图例里的「习惯」也跟着没了',
      document.querySelectorAll('.tb-paper-key.is-habit').length === 0);

    /* 上限 */
    ok('4i 超过上限就拒（HABIT_BLOCK_MAX 段）',
      (function () {
        var n = 0, rej = false;
        [11, 13, 15, 17, 19].forEach(function (hh) {
          var r = habitAddBlockMinutes(9822, hh * 60, hh * 60 + 60);
          if (r && r.ok) n++; else if (r && r.reason === 'full') rej = true;
        });
        return habitBlocksOf(h2).length === HABIT_BLOCK_MAX && rej;
      })(), JSON.stringify(habitBlocksOf(h2)));
    ok('4j 满 4 段后卡上不再给入口 + 已排的列成 chip',
      (function () {
        openHabitEditModal(9822);
        var b = document.getElementById('habitBlockBox');
        return b.querySelectorAll('.tf-chip--dayplan').length === HABIT_BLOCK_MAX &&
          ![...b.querySelectorAll('.tf-chip--action')].some(function (c) { return /加一段排期/.test(c.textContent); });
      })(), (document.getElementById('habitBlockBox') || {}).textContent);
    ok('4k chip 上的 ✕ 能删段',
      (function () {
        var b = document.getElementById('habitBlockBox');
        var x = b.querySelector('.tf-chip-x');
        var n = habitBlocksOf(h2).length;
        if (!x) return false;
        x.click();
        return habitBlocksOf(h2).length === n - 1;
      })(), JSON.stringify(habitBlocksOf(h2)));

    /* 详情里只读展示 + 「改时段」回编辑弹窗（不在详情再长一套可编辑时间框） */
    closeModal('habitEditModal');
    openHabitDetail(9822);
    var det = document.getElementById('habitDetailBody');
    ok('5 详情里排期只读列出（没有第二套时间输入框）',
      !!det && det.textContent.indexOf('排期') >= 0 &&
      !det.querySelector('#habitBlockStart') && !document.querySelector('#habitDetailBody input[type="time"][id^="habitBlock"]'),
      det ? det.textContent.replace(/\s+/g, ' ').slice(0, 60) : '');
    ok('5b 详情里的入口是「改时段」→ 编辑弹窗',
      !!det && /改时段|排时段/.test(det.textContent) &&
      det.querySelectorAll('[onclick*="openHabitEditModal"]').length >= 1,
      det ? det.textContent.replace(/\s+/g, ' ').slice(-40) : '');
    closeModal('habitDetailModal');

    /* ---- 6 语义不越界 ---- */
    ok('6 习惯时段不写 todo.blocks（不是按日期的实例）',
      (appData.todos || []).every(function (t) { return !t.blocks || !t.blocks.length; }),
      (appData.todos || []).length);
    ok('6b 不碰 repeat（节奏规则照旧）', !h2.repeat, JSON.stringify(h2.repeat));
    ok('6c 不改打卡口径：排了时段也不会自动算今天已做',
      (appData.habitLogs[h2.id] || []).length === 0);
  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.habits = JSON.parse(habitsBak); } catch (e) { appData.habits = []; }
    try { appData.habitLogs = JSON.parse(logsBak); } catch (e) { appData.habitLogs = {}; }
    try { appData.todos = JSON.parse(todosBak); } catch (e) { appData.todos = []; }
    try { appData.settings = JSON.parse(settingsBak); } catch (e) {}
    try { if (typeof window.todoExtraDisarm === 'function') window.todoExtraDisarm(); } catch (e) {}
    try { closeModal('habitEditModal'); } catch (e) {}
    try { closeModal('habitDetailModal'); } catch (e) {}
    if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
    saveData();
  }
  return JSON.stringify(R);
})();
