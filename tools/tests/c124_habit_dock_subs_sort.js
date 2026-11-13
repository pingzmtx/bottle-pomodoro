/* C124 习惯三件事（2026-11-04）

   用户原话：
     「我希望这个习惯可以支持在这个计划页下面展示，也就是说我可以一页就可以看到
       我今天排的计划和习惯，在底部展示，默认折叠」
     「现在习惯不能手动排序，还有这个分类也不能排序」
     「既然都在计划页显示了，那能不能扩展一下？也支持添加，习惯里添加这个子计划，
       然后也允许支持排期」

   四组断言：
   A 计划页 dock：默认折叠、只放今天该做的、勾选与习惯页同口径、开关状态落存档
   B 子计划纯函数：排期过滤 / 勾掉的日期语义 / 脏数据归一化
   C 子计划不改打卡口径：勾完子计划，习惯连续数不变
   D 排序：分类内拖拽改顺序、拖进别的文件夹 = 换分类、分类管理弹窗能上移下移

   数据全部临时造、结尾还原。 */
(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  var habitsBak = JSON.stringify(appData.habits || []);
  var logsBak = JSON.stringify(appData.habitLogs || {});
  var catsBak = JSON.stringify(appData.habitCats || []);
  var catOpenBak = JSON.stringify(appData.habitCatOpen || {});
  var settingsBak = JSON.stringify(appData.settings || {});
  /* ★ 与前面的用例隔离：C118/C120 会留下跳过日、配额、隐藏名单。
     它们会让 habitDueOn 把「别天才做的」判成今天该做，dock 就多出一行，
     A6/A7/E1d/E3/E9 五条一起挂 —— 单跑 C124 是绿的，混批才红。
     这里把自己的口径清干净（不碰别的用例的数据，结尾按备份还原）。 */
  var skipsBak = JSON.stringify(appData.habitSkips || {});
  var today = getTodayStr();
  var tomorrow = addDaysStr(today, 1);
  var list = document.getElementById('habitList');
  var dockHost = document.getElementById('planHabitDock');

  try {
    appData.habitSkips = {};
    /* ★ 打卡历史也要清：dock/习惯页的「今天该不该做」要读 habitLogs（配额型按本周打了几次算）。
       C118/C120 用同一批 id 打过卡，混批时残留的日志会让 9815 被判成"今天该做"，
       A3 报 5 而不是 4、A6/A7/E1d/E9 跟着红 —— 单跑是绿的。 */
    appData.habitLogs = {};
    appData.habitCats = [{ id: 'hcA', name: '甲组' }, { id: 'hcB', name: '乙组' }];
    appData.habitCatOpen = { hcA: true, hcB: true };
    appData.settings = appData.settings || {};
    appData.habits = [
      /* 9811 今天该做，带三步子计划：两步天天出现、一步排到明天 */
      { id: 9811, uid: 'h1241', name: '晨间流程', createdAt: addDaysStr(today, -30), growthPoints: 6,
        subs: [
          { id: 's1', text: '热身', date: '', time: '', doneOn: '' },
          { id: 's2', text: '五公里', date: '', time: '', doneOn: today },
          { id: 's3', text: '明天的拉伸', date: tomorrow, time: '07:30', doneOn: '' }
        ] },
      /* 9812 今天该做，无子计划 */
      { id: 9812, uid: 'h1242', name: '喝水', createdAt: addDaysStr(today, -30), growthPoints: 2 },
      /* 9813 分类甲组，今天该做 */
      { id: 9813, uid: 'h1243', name: '甲组习惯', createdAt: addDaysStr(today, -30), catId: 'hcA' },
      /* 9814 分类甲组，今天该做 */
      { id: 9814, uid: 'h1244', name: '甲组习惯二', createdAt: addDaysStr(today, -30), catId: 'hcA' },
      /* 9815 规则：只在不今天那天 → 不该进 dock */
      { id: 9815, uid: 'h1245', name: '别天才做的', createdAt: addDaysStr(today, -30),
        repeat: { mode: 'weekly', weekdays: [isoWeekday(today) === 7 ? 1 : isoWeekday(today) + 1] } },
      /* 9816 已归档 → 哪都不出现 */
      { id: 9816, uid: 'h1246', name: '归档了的', createdAt: addDaysStr(today, -30), archived: true }
    ];
    appData.habitLogs = {};
    saveData();

    /* ★「今天不用做」折叠区是**模块级 UI 状态**（_habitOffOpen），不在 appData 里，
       清数据清不掉。C118/C120 展开过它以后，dock 一渲染就把 off-body 一起带出来：
       A6 数成 5 行、A7 说「别天才做的」进了 dock —— 单跑绿、混批红。
       ★ 2026-11-09 起不靠"点一下那个开着的小标题"猜状态了：app 提供 __habitUiReset 复位口，
         拿不到才退回行为式点击（老产物也能跑）。 */
    (function closeOffSection() {
      if (typeof window.__habitUiReset === 'function') { window.__habitUiReset(); return; }
      var opened = document.querySelector('.habit-off-head.open');
      if (opened && typeof toggleHabitOffSection === 'function') toggleHabitOffSection();
    })();

    /* ===== A 计划页 dock ===== */
    appData.settings.planHabitDockOpen = false;
    saveData();
    if (typeof switchPlanTab === 'function') switchPlanTab('plan');
    if (typeof renderTodos === 'function') renderTodos();
    if (typeof renderPlanHabitDock === 'function') renderPlanHabitDock();

    ok('A1 计划页存在 #planHabitDock 容器', !!dockHost);
    var head = dockHost.querySelector('.phd-head');
    ok('A2 默认折叠（settings 未开时是折叠态）', !!head && !dockHost.querySelector('.phd-body'), appData.settings.planHabitDockOpen);
    var headTxt = head ? head.innerText.replace(/\s+/g, ' ') : '';
    ok('A3 折叠行报今天该做几个（4 个，不含规则外/归档）', /\/4/.test(headTxt) || /0\/4/.test(headTxt), headTxt);
    ok('A4 折叠行有子计划计数', /🧩/.test(headTxt), headTxt);

    togglePlanHabitDock();
    ok('A5 点开以后落存档 planHabitDockOpen=true', appData.settings.planHabitDockOpen === true);
    var body = dockHost.querySelector('.phd-body');
    ok('A6 展开后出现今日习惯行（.habit-item，与习惯页同一个行组件）',
      !!body && body.querySelectorAll('.habit-item').length === 4,
      body ? body.querySelectorAll('.habit-item').length : -1);
    ok('A7 今天不该做的不进 dock', body && body.innerText.indexOf('别天才做的') < 0);
    ok('A8 归档习惯不进 dock', body && body.innerText.indexOf('归档了的') < 0);
    ok('A9 有「＋ 新建习惯」入口（计划页也能加）', !!body && body.innerText.indexOf('新建习惯') >= 0);
    /* 子计划：2026-11-06 起不再有「哪天做」的过滤 —— 三步全部出现在清单里。
       （原口径是「排到明天的今天不出现」，那个行为正是用户报的「第二天就不显示了」。） */
    var subLines = body ? body.querySelectorAll('.habit-subline') : [];
    var subTxt = subLines[0] ? subLines[0].innerText.replace(/\s+/g, ' ') : '';
    var subRows = subLines[0] ? subLines[0].querySelectorAll('.tf-sub') : [];
    var subDone = subLines[0] ? subLines[0].querySelectorAll('.tf-sub.done').length : -1;
    ok('A10 子计划全部列出（3 步、其中 1 步今天已勾）',
      subLines.length === 1 && subRows.length === 3 && subDone === 1,
      subTxt || subLines.length);

    /* 打卡与习惯页同口径：点 dock 上的勾 → habitLogs 里就是今天 */
    var cb = body ? body.querySelector('.habit-item .habit-checkbox') : null;
    if (cb) cb.click();
    var anyLogged = Object.keys(appData.habitLogs).some(function (k) {
      return (appData.habitLogs[k] || []).indexOf(today) >= 0;
    });
    ok('A11 dock 上勾选写进 habitLogs（和习惯页同一份账）', anyLogged);

    togglePlanHabitDock();
    ok('A12 再点收起来并落存档', appData.settings.planHabitDockOpen === false);

    /* ===== A13/A14 子计划在外显就地勾（2026-11-04 用户要求）=====
       原话：「习惯的这个子计划，它为什么不能像任务里面的子计划在外显选勾呢？非要点进去」。
       现在每步一行 .tf-sub + .sub-cb，点勾直接写 doneOn，不用点 › 进详情。 */
    togglePlanHabitDock();
    var _subsBak = appData.habits.map(function (h) { return h.subs ? JSON.stringify(h.subs) : null; });
    var body2 = dockHost.querySelector('.phd-body');
    var cbRow = body2 ? body2.querySelector('.habit-subline .tf-sub:not(.done) .sub-cb') : null;
    ok('A13 习惯行里每步子计划都有勾选框（.sub-cb，和任务子任务同一个组件）',
      !!cbRow && body2.querySelectorAll('.habit-subline .tf-sub').length === 3,
      body2 ? body2.querySelectorAll('.habit-subline .sub-cb').length : -1);
    if (cbRow) cbRow.click();
    var body3 = dockHost.querySelector('.phd-body');
    var doneNow = body3 ? body3.querySelectorAll('.habit-subline .tf-sub.done').length : -1;
    ok('A14 在列表上点勾即完成（已完成 1 → 2，不必点进详情）', doneNow === 2, doneNow);
    /* 还原：后面的 B/C/D 段按原始子计划数据算 */
    appData.habits.forEach(function (h, i) {
      if (_subsBak[i]) h.subs = JSON.parse(_subsBak[i]);
    });
    renderHabits();

    /* ===== B 子计划纯函数 ===== */
    var h1 = appData.habits[0];
    ok('B1 habitSubsOn 返回全部子计划（3 个）', habitSubsOn(h1, today).length === 3, habitSubsOn(h1, today).length);
    /* 2026-11-06：子计划不再按 date 过滤，明天同样是这三步 */
    var _tm = habitSubsOn(h1, tomorrow).map(function (s) { return s.text; });
    ok('B2 明天也列出全部三步（不再按日期藏）', _tm.length === 3, _tm.join('/'));
    ok('B3 勾掉的计在 doneOn 那一天', habitSubsDoneOn(h1, today) === 1, habitSubsDoneOn(h1, today));
    ok('B4 换一天回未完成（未排期的步骤不跨天继承）', habitSubsDoneOn(h1, addDaysStr(today, 2)) === 0);
    var dirty = normHabitSubs([
      { text: '  空格两头  ' },
      { text: '' },
      { text: '日期脏', date: '2026/11/4', time: '7:3' },
      null,
      { text: '正常', date: today, time: '07:30' }
    ]);
    ok('B5 空名步骤被丢掉', dirty.length === 3, dirty.length);
    ok('B6 文本去掉两头空格', dirty[0].text === '空格两头', JSON.stringify(dirty[0].text));
    ok('B7 非法日期/时间当没排期', dirty[1].date === '' && dirty[1].time === '', JSON.stringify(dirty[1]));
    ok('B8 合法值保留', dirty[2].date === today && dirty[2].time === '07:30');
    ok('B9 步骤都有 id', dirty.every(function (s) { return !!s.id; }));

    /* ===== C 子计划不改打卡口径 ===== */
    var stBefore = habitStats(h1, appData.habitLogs[h1.id] || [], today, HABIT_WINDOW_DAYS);
    toggleHabitSub(h1.id, 's1');
    var stAfter = habitStats(h1, appData.habitLogs[h1.id] || [], today, HABIT_WINDOW_DAYS);
    ok('C1 勾子计划不改习惯的连续数', stBefore.cur === stAfter.cur, stBefore.cur + '→' + stAfter.cur);
    ok('C2 勾子计划不写 habitLogs', (appData.habitLogs[h1.id] || []).indexOf(today) < 0 || stBefore.cur === stAfter.cur);
    ok('C3 再点一次取消勾（幂等开关）', (function () {
      toggleHabitSub(h1.id, 's1');
      var s = habitSubsOf(h1).filter(function (x) { return x.id === 's1'; })[0];
      return s && normHabitSubDate(s.doneOn) === '';
    })());

    /* ===== D 排序 ===== */
    if (typeof renderHabits === 'function') renderHabits();
    var box = list.querySelector('.habit-folder-body[data-cat="hcA"]');
    var r3 = list.querySelector('.habit-item[data-id="9813"]');
    var r4 = list.querySelector('.habit-item[data-id="9814"]');
    ok('D1 分类里的行挂在带 data-cat 的容器里', !!box && !!r3 && r3.parentNode === box);
    box.insertBefore(r4, r3);   /* 模拟拖拽：4 挪到 3 前面 */
    syncHabitOrderFromDom();
    var i3 = appData.habits.findIndex(function (h) { return h.id === 9813; });
    var i4 = appData.habits.findIndex(function (h) { return h.id === 9814; });
    ok('D2 分类内拖拽改了顺序', i4 < i3, 'i3=' + i3 + ' i4=' + i4);

    /* 拖进别的分组 → 换分类 */
    var boxB = list.querySelector('.habit-folder-body[data-cat="hcB"]') || (function () {
      /* 乙组是空的，文件夹体可能不渲染 → 自己造一个容器验证归属判定 */
      var d = document.createElement('div');
      d.className = 'habit-folder-body';
      d.dataset.cat = 'hcB';
      list.appendChild(d);
      return d;
    })();
    var r2 = list.querySelector('.habit-item[data-id="9812"]');
    boxB.appendChild(r2);
    syncHabitOrderFromDom();
    var h2 = appData.habits.filter(function (h) { return h.id === 9812; })[0];
    ok('D3 拖进别的文件夹 = 换分类', h2 && String(h2.catId) === 'hcB', h2 ? h2.catId : 'missing');

    /* 分类排序：管理弹窗的上移下移 */
    var orderBak = JSON.stringify(appData.habitCats);
    ok('D4 分类有 id（排序的前提）', appData.habitCats.every(function (c) { return !!c.id; }));
    if (typeof moveHabitCat === 'function') {
      var firstId = appData.habitCats[0].id;
      moveHabitCat(firstId, 1);
      ok('D5 分类下移一位生效', appData.habitCats[1] && appData.habitCats[1].id === firstId,
        appData.habitCats.map(function (c) { return c.name; }).join('>'));
      moveHabitCat(firstId, -1);
      ok('D6 再上移回到原位（可逆）', appData.habitCats[0] && appData.habitCats[0].id === firstId,
        appData.habitCats.map(function (c) { return c.name; }).join('>'));
      /* 边界：第一位再上移不动、最后一位再下移不动 */
      moveHabitCat(appData.habitCats[0].id, -1);
      ok('D7 首位的上移是空操作', appData.habitCats[0].id === firstId);
      var lastId = appData.habitCats[appData.habitCats.length - 1].id;
      moveHabitCat(lastId, 1);
      ok('D8 末位的下移是空操作', appData.habitCats[appData.habitCats.length - 1].id === lastId);
    } else {
      ok('D5 分类排序函数存在（moveHabitCat）', false, 'missing');
      ok('D6 再上移回到原位（可逆）', false, 'missing');
      ok('D7 首位的上移是空操作', false, 'missing');
      ok('D8 末位的下移是空操作', false, 'missing');
    }
    appData.habitCats = JSON.parse(orderBak);

    /* 分类管理弹窗真的画得出来 */
    if (typeof openHabitCatModal === 'function') {
      openHabitCatModal();
      var cm = document.getElementById('habitCatModal');
      ok('D9 分类管理弹窗打开后有内容', !!cm && cm.innerText.indexOf('分类管理') >= 0);
      ok('D10 每个分类都有上/下按钮', !!cm && cm.querySelectorAll('[onclick*="moveHabitCat"]').length >= 4,
        cm ? cm.querySelectorAll('[onclick*="moveHabitCat"]').length : -1);
    } else {
      ok('D9 分类管理弹窗打开后有内容', false, 'missing openHabitCatModal');
      ok('D10 每个分类都有上/下按钮', false, 'missing');
    }

    /* ===== E dock 与习惯页「同一个渲染源」（2026-11-04，第七版）=====
       用户原话：「你不要重新造，你就直接复刻那个习惯页，直接搬下来就行了呀，
                  复刻一下很难吗？」
       于是 dock 不再自己拼行，改为直接调 habitListBodyHtml() —— 和习惯页是同一个函数。
       E 组现在锁的就是这件事本身：**两边 HTML 必须逐字节相同**（去掉空白后）。
       之前那套 dock 专用分支（.habit-plus 就地加一步 / .phd-row / .phd-subform）
       全部撤掉，一并写成"不许再出现"的断言。 */
    appData.settings.planHabitDockOpen = true;
    saveData();
    renderHabits();
    renderPlanHabitDock();
    var body2 = dockHost.querySelector('.phd-body');
    var norm = function (el) { return el ? el.innerHTML.replace(/\s+/g, ' ').trim() : ''; };
    /* 习惯页那份带归档区、dock 那份不带（dock 里没有「已归档」这件事），
       所以比对前把 dock 自己的「＋ 新建习惯」尾巴和习惯页的归档区各自切掉。 */
    var a = norm(body2);
    var b = norm(list);
    a = a.replace(/<button class="phd-add"[^]*$/, '');
    b = b.replace(/<div class="habit-archive-h"[^]*$/, '');
    ok('E1 dock 的内容就是习惯页那一段（同一函数产出，逐字符相同）', a === b && a.length > 100,
      'dock=' + a.length + ' habit=' + b.length + ' eq=' + (a === b));
    ok('E1b 分类文件夹头也一起搬过来了（不是平铺）',
      !!body2 && body2.querySelectorAll('.habit-folder-head').length >= 2 &&
      body2.querySelectorAll('.habit-folder-head').length === list.querySelectorAll('.habit-folder-head').length,
      body2 ? body2.querySelectorAll('.habit-folder-head').length : -1);
    ok('E1c 「今天该做 N 个 · 已打 M 个」统计行也在', !!body2 && !!body2.querySelector('.habit-due-line'));
    ok('E1d 「今天不用做」折叠区也在（复刻的一部分，默认收起）',
      !!body2 && !!body2.querySelector('.habit-off-head') && !body2.querySelector('.habit-off-body'));
    ok('E2 dock 里没有任何 dock 专属按钮（.habit-plus 已撤）',
      dockHost.querySelectorAll('.habit-plus, .phd-plus, .phd-subform, .phd-row').length === 0,
      dockHost.querySelectorAll('.habit-plus, .phd-plus, .phd-subform, .phd-row').length);
    /* 宽度也要一样：dock 若多留一圈内距，热力图就会折行、统计行被省略号吃掉 ——
       那正是用户说"为什么不照搬"的那种差别。
       ★ 习惯页那份在另一个子标签里（display:none），直接量 getBoundingClientRect
       拿到的是 0 → Δ 永远是 dock 的整宽（362px），这条断言其实从来没真正量过。
       改成测量期间把习惯子标签临时显示出来，两边同时参与布局，量完立刻还原。 */
    var habitView = document.getElementById('planHabitView');
    var viewBak = habitView ? habitView.style.display : null;
    if (habitView) habitView.style.display = 'block';
    var dRow = dockHost.querySelector('.habit-item');
    var hRows = list.querySelectorAll('.habit-item');
    var hRow = hRows.length ? hRows[0] : null;
    var gapW = (dRow && hRow) ? Math.abs(dRow.getBoundingClientRect().width - hRow.getBoundingClientRect().width) : 999;
    var dInfo = dRow ? dRow.querySelector('.habit-info') : null;
    var hInfo = hRow ? hRow.querySelector('.habit-info') : null;
    var gapI = (dInfo && hInfo) ? Math.abs(dInfo.getBoundingClientRect().width - hInfo.getBoundingClientRect().width) : 999;
    if (habitView) habitView.style.display = viewBak;
    ok('E3 dock 行宽与习惯页行宽一致（差 ≤ 3px）', gapW <= 3, 'Δ=' + Math.round(gapW) + 'px');
    ok('E3b 信息列（名字 + 连续天数 + 热力图）宽度也一致', gapI <= 3, 'Δ=' + Math.round(gapI) + 'px');
    /* 打卡同步：dock 里勾一下，习惯页那份立刻跟着变（同一份 appData + 同一个渲染入口） */
    var cb2 = body2 ? body2.querySelector('.habit-item .habit-checkbox') : null;
    if (cb2) cb2.click();
    var cbAfter = list.querySelector('.habit-item .habit-checkbox');
    ok('E4 dock 打卡后习惯页同步（同一个渲染源，不会各写各的）',
      !!cbAfter && cbAfter.classList.contains('checked'),
      cbAfter ? cbAfter.className : 'nocb');
    if (cb2) cb2.click();

    /* ★ 2026-11-04 用户：「你不要重新造，你就直接复刻那个习惯页，直接搬下来」
       于是 E9 组从"子计划长什么样"升级成"dock 的行**就是**习惯页的行"：
       两边都用 _habitRowHtml，类名必须逐个子集相同，自造行整套撤掉。 */
    var dockRows = dockHost.querySelectorAll('.habit-item');
    ok('E9 dock 每行都是习惯页同一个行组件 .habit-item',
      dockRows.length === 4, dockRows.length);
    ok('E9b 行内有习惯页的五件套（勾选框 / 信息列 / 连续天数 / 热力图 / ›）',
      !!dockRows[0] && !!dockRows[0].querySelector('.habit-checkbox') &&
      !!dockRows[0].querySelector('.habit-info .habit-name') &&
      !!dockRows[0].querySelector('.habit-streak') &&
      !!dockRows[0].querySelector('.habit-heatmap, .habit-heat') &&
      !!dockRows[0].querySelector('.habit-arrow'),
      dockRows[0] ? dockRows[0].className : 'norow');
    ok('E9c 没有自造的行/子计划类（.phd-row / .phd-name / .phd-subs 全部撤掉）',
      dockHost.querySelectorAll('.phd-row, .phd-name, .phd-subs, [class*="hsub-"]').length === 0,
      dockHost.querySelectorAll('.phd-row, .phd-name, .phd-subs').length);

    /* 子计划：行里只留摘要（.habit-subline），逐条编辑在 › 详情里做 —— 和习惯页一样。
       这里先把一条子计划塞进 9812，后面 E10~ 的详情断言继续用同一条落库路径。 */
    h2 = appData.habits.filter(function (h) { return h.id === 9812; })[0];
    ok('E9d 加一步只有一条落库路径（addHabitSubQuick）', typeof addHabitSubQuick === 'function');
    ok('E9e 空内容不落库（防空白步骤）', addHabitSubQuick(9812, '   ') === false, habitSubsOf(h2).length);
    addHabitSubQuick(9812, '晚上泡脚');
    ok('E9f 加进去的那一步默认每天都做', habitSubsOf(h2).length === 1 &&
      habitSubsOn(h2, today).length === 1 && habitSubsOn(h2, tomorrow).length === 1,
      habitSubsOf(h2).length);

    /* 排期：加完之后点那一步（详情里点名字）改哪天做 —— 同一条落库路径 */
    openHabitDetail(9812);
    var det = document.getElementById('habitDetailBody');
    ok('E10 详情子计划区用 .tf-subs 容器', !!det && !!det.querySelector('.habit-sub-group .tf-subs'));
    ok('E10b 详情里每一步都是 .tf-sub（勾选框+文字+✕）',
      !!det && det.querySelectorAll('.habit-sub-group .tf-sub').length === 1,
      det ? det.querySelectorAll('.habit-sub-group .tf-sub').length : -1);
    ok('E11 详情里每一步都有 .tf-sub-del 删除按钮',
      !!det && det.querySelectorAll('.habit-sub-group .tf-sub-del').length === 1,
      det ? det.querySelectorAll('.habit-sub-group .tf-sub-del').length : -1);
    ok('E11b 详情不使用自造的 .hsub-item',
      !!det && det.querySelectorAll('.hsub-item').length === 0);

    /* 2026-11-06：子计划不再有任何排期控件（日期、时间都去掉了）。
       一行就是「勾选框 + 名字 + ✕」，和计划卡的子任务完全一样。 */
    ok('E12 子计划行里没有排期控件',
      !!det && det.querySelectorAll('.habit-sub-group .hsub-icon').length === 0 &&
               det.querySelectorAll('.habit-sub-group .hsub-panel').length === 0 &&
               det.querySelectorAll('.habit-sub-group input[type="date"]').length === 0 &&
               det.querySelectorAll('.habit-sub-group input[type="time"]').length === 0);
    ok('E12b 子计划行里没有日期/时间小签',
      !!det && det.querySelectorAll('.habit-sub-group .tf-sub-sched').length === 0 &&
               det.querySelectorAll('.habit-sub-group .hsub-sched-txt').length === 0);
    det = document.getElementById('habitDetailBody');
    var subId = habitSubsOf(h2)[0].id;
    var subRow = det ? det.querySelector('.habit-sub-group .tf-sub') : null;
    ok('E13 子计划行只有勾选框 / 名字 / 删除三件',
      !!subRow && subRow.children.length === 3,
      subRow ? subRow.children.length : -1);
    ok('E14 老数据的 date/time 不影响出现在哪天',
      habitSubsOn(h2, today).length === 1 && habitSubsOn(h2, tomorrow).length === 1,
      habitSubsOn(h2, today).length + '/' + habitSubsOn(h2, tomorrow).length);

    /* 详情里的添加：常驻一行 .tf-sub-add（和计划卡一样，没有「先点开」这一步） */
    det = document.getElementById('habitDetailBody');
    var detAdd = det && det.querySelector('.habit-sub-group .tf-sub-add');
    ok('E17 详情添加是常驻的 .tf-sub-add', !!detAdd,
      (det ? ('len=' + det.innerHTML.length + ' grp=' + !!det.querySelector('.habit-sub-group') + ' add=' + det.querySelectorAll('.tf-sub-add').length + ' hf=' + typeof _hsubForm + ':' + JSON.stringify(_hsubForm)) : 'nodet'));
    ok('E17b 没有「＋ 添加子计划」的开合按钮（计划卡也没有）',
      !!det && det.querySelectorAll('.habit-sub-group .tf-chip--action').length === 0);
    hsubFormDraftSet('text', '拉伸十分钟');
    confirmHabitSubForm(9812);
    ok('E18 详情里加成第二步', habitSubsOf(h2).length === 2, habitSubsOf(h2).length);
    ok('E19 详情加完输入框清空、仍常驻', !!document.querySelector('#habitDetailBody .habit-sub-group .tf-sub-add'));
    var todaySubs = habitSubsOn(h2, today);
    ok('E20 详情加的这步立刻出现在清单里',
      todaySubs.length === 2 && todaySubs.some(function (s) { return s.text === '拉伸十分钟'; }),
      JSON.stringify(todaySubs.map(function (s) { return s.text; })));
    ok('E21 删除一步的入口是函数', typeof delHabitSub === 'function');

    /* 第五版硬约束：源码里不许再有自造视觉 */
    /* ★ 习惯自己也能排期（2026-11-04）：「只有子计划才能排期」是用户点名的毛病。
       时段写 h.timeBlocks；★ 排期入口在**习惯卡**上（编辑弹窗「开始 → 结束」两个框），
       日程表里一格习惯都没有 —— 用户原话「为什么在日程表上放一堆习惯？」。 */
    ok('E23 习惯时段数据层存在（habitBlocksOf / habitBlocksOn）',
      typeof habitBlocksOf === 'function' && typeof habitBlocksOn === 'function');
    ok('E24 详情里有「排期」行 + 「改时段」回编辑弹窗',
      !!det && typeof renderHabitBlockBox === 'function' &&
      !!document.querySelector('#habitDetailBody .habit-block-stack .habit-block-row') &&
      document.querySelectorAll('#habitDetailBody [onclick*="openHabitEditModal"]').length >= 1);
    var rblk = habitAddBlockMinutes(9812, 420, 480);
    ok('E25 加一段时段（7:00-8:00）',
      !!rblk && rblk.ok === true && habitBlocksOf(h2).length === 1,
      JSON.stringify(habitBlocksOf(h2)));
    ok('E26 时段落在 h.timeBlocks 而不是 todo.blocks',
      !!h2.timeBlocks && habitBlocksOf(h2)[0].start === '07:00' && habitBlocksOf(h2)[0].end === '08:00',
      JSON.stringify(h2.timeBlocks));
    ok('E27 命中的日子每天都有这一段（规则时段）',
      habitBlocksOn(h2, today).length === 1 && habitBlocksOn(h2, tomorrow).length === 1,
      habitBlocksOn(h2, today).length + '/' + habitBlocksOn(h2, tomorrow).length);
    ok('E28 排期入口是「到日程表点两格」（入口有、默认不画习惯）',
      typeof window.tbHabitArm === 'function' &&
      document.querySelectorAll('.tb-paper-blk.is-habit').length === 0);
    ok('E29 删除一段时段', (function () {
      habitDelBlock(9812, '07:00');
      return habitBlocksOf(h2).length === 0;
    })());
    ok('E22 详情子计划容器不再叫 .hsub-empty/.hsub-form 之类',
      !document.querySelector('.hsub-form, .hsub-edit-row'),
      document.querySelectorAll('[class*="hsub-"]').length);

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.habits = JSON.parse(habitsBak); } catch (e) { appData.habits = []; }
    try { appData.habitLogs = JSON.parse(logsBak); } catch (e) { appData.habitLogs = {}; }
    try { appData.habitCats = JSON.parse(catsBak); } catch (e) { appData.habitCats = []; }
    try { appData.habitCatOpen = JSON.parse(catOpenBak); } catch (e) { appData.habitCatOpen = {}; }
    try { appData.settings = JSON.parse(settingsBak); } catch (e) {}
    try { if (typeof closeModal === 'function') closeModal('habitCatModal'); } catch (e) {}
    try { if (typeof closeModal === 'function') closeModal('habitEditModal'); } catch (e) {}
    try { if (typeof closeModal === 'function') closeModal('habitDetailModal'); } catch (e) {}
    try { _phdSubForm = null; _hsubForm = { text: '' }; } catch (e) {}
    if (typeof renderHabits === 'function') renderHabits();
    try { if (typeof switchPlanTab === 'function') switchPlanTab('plan'); } catch (e) {}
    saveData();
  }
  return JSON.stringify(R);
})();
