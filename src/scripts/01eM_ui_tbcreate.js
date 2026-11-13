/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 日程网格的「新建计划」入口：点起始格 → 再点结束格 → 打开「新增计划」并预填起止。
 * 本文件是**封闭 IIFE**：全部符号（tbCreate*）私有，不挂 window、无跨 script 引用
 *   （外部零引用——唯一的出口是 IIFE 底部自己挂的 click 委托与 01eA 渲染完成广播的订阅）；
 *   所以「必须排在 01eA 之后加载」这条**不再成立**：运行期才调 01eA 渲染出来的 DOM，
 *   加载先后都不影响。保留在 manifest 槽 1 只是分组习惯。
 * 它读写的是 01eA 渲染出来的网格与日期条：`.tb-paper-cell[data-tb-min]`、`#tbWeek .tb-day.on`。
 * 依赖方向：本文件 → 01e（toggleNote 的宿主）/ 01eC（openAddTodoModal、tbAddDraftExtraBlock）/
 *   00_pure_core（todoPomosForMinutes）。全部在运行期调用（用户点击时），加载顺序不影响。
 *   反向不成立：01eA 与 01e **不**依赖本文件的任何东西。
 * 回退方式：删掉本文件与 src/manifest.json 里本文件那一行，无残留。 */
/* ==================== 模块: 04eM-ui-tbcreate.js | 职责: 日程网格上两次点击新建计划 | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04eM-ui-tbcreate.js（源文件 01eM_ui_tbcreate.js）
 * 分组：ui
 * 职责：日程网格的「两次点击定头尾」入口 —— 选起点、选终点、打开新增计划并预填起止，
 *       以及网格上方那行可折叠的使用说明。
 * 函数索引（TOC）：tbExtraFind/tbExtraEnsureGridOpen/tbExtraPaintBar/tbDayPlanArm/tbExtraArm/tbHabitArm/tbHabitDayArm/tbExtraArmFromModal/tbExtraDisarm/tbExtraReasonText/tbExtraCommit/tbCreateDateStr（+8 更多）
 * ============================================================ */
(function () {
  /* 已选的起点：{ dateStr, min, lane }；null = 还没选。
     lane = 点的哪一列（0=预计 / 1=实际，见 01eA 的 data-tb-lane）。 */
  var _pick = null;
  /* 选段模式的目标：null 或
     { mode:'todo',  todoId, title }  —— 给已有计划追加
     { mode:'draft', draft,  title }  —— 给"新增计划弹窗里的草稿"追加
     { mode:'habit', habitId, title }    —— 给习惯排「几点做」（点两格 = 追加一段，天天生效）
     { mode:'dayplan', todoId, title } —— 重复计划里**某一天**单独排（点两格 = 那天整组换成这段）
     与 _pick 正交：_arm 决定"这次点两格是给谁加段"，_pick 决定"起点在哪"。
     已有计划模式下：同 id 再点按钮 = 退出；异 id = 切目标（必须清 _pick）。 */
  var _arm = null;

  /* 一格 = 10 分钟。**不引用** 01eA 的 TB_PAPER_SLOT_MIN（常量）：那个 IIFE 封闭、
     不挂 window，本文件拿不到；它是网格渲染用的量纲，这边只在自己的选段语义里用
     （见 tbCreateOpen 的右缘规则），改成两份各自注释、改一处时记得同步另一处。 */
  var TB_PAPER_SLOT_MIN_LOCAL = 10;

  /* ===== 选段模式：给同一条计划追加「另排时段」 =====
   * 不打开任何弹窗 —— 弹窗一盖住网格就没法连续点、更没法切到明天接着点。
   * 状态只活在闭包里（_arm/_pick），DOM 每次重画都重建，所以横幅靠 afterRender 补插。 */
  function tbExtraFind(id) {
    var list = (appData && appData.todos) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }
  /* 网格默认是收起的（首屏留给计划列表）。从计划卡点「＋其他排期」时若网格收着，
     用户会看到一个"什么都没发生"的页面 —— 必须自动展开。 */
  function tbExtraEnsureGridOpen() {
    if (appData && appData.settings && appData.settings.tbGridFolded === false) return;
    /* 走 01eA 暴露的开关，不在这里直接写 settings ——
       settings 是有主人的域，跨文件直接改会把「谁能写」这条线磨没。 */
    if (typeof window.tbToggleGridFold === 'function') window.tbToggleGridFold();
  }
  function tbExtraPaintBar() {
    var wrap = tbCreateWrap();
    if (!wrap) return;
    var body = wrap.querySelector('.tb-paper-body');
    if (!body) return;
    var old = body.querySelector('.tb-arm-bar');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!_arm) return;
    var isDraft = _arm.mode === 'draft';
    var isHabit = _arm.mode === 'habit';
    var isHabitDay = _arm.mode === 'habitday';
    var isDayPlan = _arm.mode === 'dayplan';
    var cnt = 0;
    if (isDraft && typeof window.tbDraftExtraBlocks === 'function') {
      try { cnt = window.tbDraftExtraBlocks().length; } catch (e) { cnt = 0; }
    }
    var txt = isDraft
      ? '正在给「' + (_arm.title || '新计划') + '」排时段（保存后生效）' + (cnt ? ' · 已排 ' + cnt + ' 段' : '')
      : (isHabit
        ? '正在给习惯「' + (_arm.title || '') + '」排时段：点两格 = 它每天这一段做（最多 ' + HABIT_BLOCK_MAX + ' 段）'
        : (isHabitDay
        ? '正在给习惯「' + (_arm.title || '') + '」排「单日」：点两格 = ' + String(_arm.dateStr || '').slice(5) + ' 这天就按这段（其它日子不动）'
        : (isDayPlan
        ? '正在给「' + (_arm.title || '(未命名)') + '」排「单日」：点两格 = 那一天就按这段（其它日子不动）'
        : '正在给「' + (_arm.title || '(未命名)') + '」加排期段：点两格 = 一段')));
    var bar = document.createElement('div');
    bar.className = 'tb-arm-bar';
    bar.innerHTML =
      '<span class="tb-arm-txt">' + escapeHtml(txt) + '</span>' +
      '<button type="button" class="tb-arm-x' + (isDraft ? ' is-done' : '') + '" onclick="todoExtraDisarm()" ' +
      'title="' + (isDraft ? '完成并回到新增计划（Esc）' : '退出选段模式（Esc）') + '" ' +
      'aria-label="' + (isDraft ? '完成并回到新增计划' : '退出选段模式') + '">' +
      (isDraft ? '完成' : '✕') + '</button>';
    body.insertAdjacentElement('afterbegin', bar);
  }
  /* 设置面板「单日」行的「在日程表选」：只改点中的那一天（一天一段，整组替换）。
     「单日是不是也可以选择那个块」「现在今日的怎么只能靠输入呀」。 */
  function tbDayPlanArm(id) {
    var t = tbExtraFind(id);
    if (!t) { showToast('找不到这条计划'); return; }
    if (_arm && _arm.mode === 'dayplan' && String(_arm.todoId) === String(id)) { tbExtraDisarm(); return; }
    var switched = !!_arm;
    _arm = { mode: 'dayplan', todoId: t.id, title: t.title || '(未命名)' };
    _pick = null; /* 切目标必须清半截起点 */
    tbCreatePaint();
    tbExtraEnsureGridOpen();
    tbExtraPaintBar();
    document.body.classList.add('tb-arm');
    /* 重绘一次：习惯块只在选段模式出现（01eA 读 tbArmHabitId），不重画就看不到已排的段 */
    if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
    var shell = document.getElementById('tbShell');
    if (shell && shell.scrollIntoView) shell.scrollIntoView({ block: 'start', behavior: 'smooth' });
    showToast(switched
      ? '已切到「' + _arm.title + '」的单日排期'
      : '点两格 = 那一天就按这段排（只改那一天）');
  }
  /* 设置面板「排期」行里的「＋其他排期」：进入 / 退出 / 切换目标 */
  function tbExtraArm(id) {
    var t = tbExtraFind(id);
    if (!t) { showToast('找不到这条计划'); return; }
    if (_arm && _arm.mode === 'todo' && String(_arm.todoId) === String(id)) { tbExtraDisarm(); return; }
    var switched = !!_arm;
    _arm = { mode: 'todo', todoId: t.id, title: t.title || '(未命名)' };
    /* ★ 切目标必须清掉半截起点：否则上一次点的起点会挂到新任务上，
       产生一条用户从没画过的段。 */
    _pick = null;
    tbCreatePaint();
    tbExtraEnsureGridOpen();
    tbExtraPaintBar();
    document.body.classList.add('tb-arm');
    /* 重绘一次：习惯块只在选段模式出现（01eA 读 tbArmHabitId），不重画就看不到已排的段 */
    if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
    var shell = document.getElementById('tbShell');
    if (shell && shell.scrollIntoView) shell.scrollIntoView({ block: 'start', behavior: 'smooth' });
    showToast(switched
      ? '已切到「' + _arm.title + '」排期'
      : '已进入选段模式：给「' + _arm.title + '」点两格加一段');
  }
  /* ===== 习惯的时段：点两格 = 这个习惯每天这一段做 =====
     * 用户原话：「为什么这个排期不能在表格上选，而且只有子计划才能排期」。
     * 完全复用这一套 _arm/_pick：习惯不落 todo.blocks，落 h.timeBlocks（规则时段），
     * 语义上是"命中的日子每天重复"，所以横幅要讲清"天天生效"，不能照抄任务的"这一段"。 */
  function tbHabitArm(id) {
    var h = null;
    (appData.habits || []).forEach(function (x) { if (x && String(x.id) === String(id)) h = x; });
    if (!h) { showToast('找不到这个习惯'); return; }
    if (_arm && _arm.mode === 'habit' && String(_arm.habitId) === String(id)) { tbExtraDisarm(); return; }
    _arm = { mode: 'habit', habitId: h.id, title: h.name || '习惯' };
    _pick = null;
    tbCreatePaint();
    tbExtraEnsureGridOpen();
    tbExtraPaintBar();
    document.body.classList.add('tb-arm');
    /* 重绘一次：习惯块只在选段模式出现（01eA 读 tbArmHabitId），不重画就看不到已排的段 */
    if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
    var shell = document.getElementById('tbShell');
    if (shell && shell.scrollIntoView) shell.scrollIntoView({ block: 'start', behavior: 'smooth' });
    var rep = (typeof habitRepeatOf === 'function') ? habitRepeatOf(h) : null;
    var when = rep ? ('「' + (typeof habitRepeatLabel === 'function' ? habitRepeatLabel(rep) : '') + '」')
                   : '每天';
    showToast('已进入选段模式：给习惯「' + _arm.title + '」点两格 = ' + when + '这一段做它');
  }
  /* ===== 习惯的「单日」：点两格 = 那一天按这一段（只改那天） =====
     * 和计划的「单日」同一条语义（整组覆盖、删掉回默认），只是对象是习惯的时段：
       写 h.dayPlan[那天]，不碰 h.timeBlocks（规则时段）。
     * 与「加一段排期」的区别必须写在横幅里：那个是"每天这一段"，这个是"就这一天"。 */
  function tbHabitDayArm(id, ds) {
    var h = null;
    (appData.habits || []).forEach(function (x) { if (x && String(x.id) === String(id)) h = x; });
    if (!h) { showToast('找不到这个习惯'); return; }
    var d = String(ds == null ? '' : ds).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = getTodayStr();
    if (_arm && _arm.mode === 'habitday' && String(_arm.habitId) === String(id) && _arm.dateStr === d) { tbExtraDisarm(); return; }
    _arm = { mode: 'habitday', habitId: h.id, title: h.name || '习惯', dateStr: d };
    _pick = null;
    tbCreatePaint();
    tbExtraEnsureGridOpen();
    tbExtraPaintBar();
    document.body.classList.add('tb-arm');
    if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
    var shell = document.getElementById('tbShell');
    if (shell && shell.scrollIntoView) shell.scrollIntoView({ block: 'start', behavior: 'smooth' });
    showToast('点两格 = 习惯「' + _arm.title + '」' + d.slice(5) + ' 这天按这段（只改这一天）');
  }
  /* 新增计划弹窗里的「＋其他排期」：表单先暂存，关弹窗 → 选段 → 重开回填。
     弹窗不关就点不到格子（遮罩覆盖整屏），所以这是唯一可行的顺序。 */
  function tbExtraArmFromModal() {
    if (typeof window.tbReadAddTodoDraft !== 'function') return;
    var d = window.tbReadAddTodoDraft();
    _arm = { mode: 'draft', draft: d, title: (d.title || '').trim() || '新计划' };
    _pick = null;
    tbCreatePaint();
    if (typeof closeModal === 'function') closeModal('addTodoModal');
    tbExtraEnsureGridOpen();
    tbExtraPaintBar();
    document.body.classList.add('tb-arm');
    /* 重绘一次：习惯块只在选段模式出现（01eA 读 tbArmHabitId），不重画就看不到已排的段 */
    if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
    var shell = document.getElementById('tbShell');
    if (shell && shell.scrollIntoView) shell.scrollIntoView({ block: 'start', behavior: 'smooth' });
    showToast('点两格加一段；点「完成」回到保存');
  }
  function tbExtraDisarm() {
    if (!_arm) return;
    var isDraft = _arm.mode === 'draft';
    var draft = _arm.draft;
    _arm = null;
    _pick = null;
    tbCreatePaint();
    tbExtraPaintBar();
    document.body.classList.remove('tb-arm');
    if (isDraft) {
      /* 把草稿里最新加好的段带回去，再重开弹窗 —— 只带标题不带段，等于白排。
         ★ 修：这里原来写的是 `draft.extraBlocks`，而弹窗读的是
         **`draft.blocks`**（_readAddTodoDraft / _applyAddTodoDraft 都只认 blocks）。
         结果：从网格排完的段被丢掉，用户回到弹窗只看见进来时那一行 ——
         他说的「我点完排期，它排的期也不显示」就是这条。
         现在两个字段都写（extraBlocks 是旧名，留着兼容外部调用方）。 */
      if (draft) {
        const _segsNow = typeof window.tbDraftExtraBlocks === 'function'
          ? window.tbDraftExtraBlocks()
          : (draft.blocks || []);
        draft.blocks = _segsNow;
        draft.extraBlocks = _segsNow;
        if (typeof window.tbOpenAddTodoWithDraft === 'function') window.tbOpenAddTodoWithDraft(draft);
      }
      showToast('已排 ' + ((draft && draft.blocks) || []).length + ' 段，点「确定」保存');
      return;
    }
    /* ★ 必须重绘：网格上的习惯块只属于"选段模式"（见 01eA tbArmHabitId），
       退出后不重画就会把他刚才看到的淡绿块留在那儿 —— 用户会以为日程表里真有一堆习惯。
       计划的选段框是 CSS 类控的，习惯块是 JS 渲染的，这里补上这一笔。 */
    if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
    showToast('已退出选段模式');
  }
  function tbExtraReasonText(r) {
    if (r.reason === 'overlap') {
      return '这段时间已有安排' + (r.hitStart ? '（' + r.hitStart + '–' + r.hitEnd + '）' : '');
    }
    if (r.reason === 'tooShort') return '一段至少 10 分钟';
    if (r.reason === 'limit') return '一条计划最多排 ' + TODO_EXTRA_MAX + ' 段';
    if (r.reason === 'dup') return '这段已经排过了';
    if (r.reason === 'crossDay') return '一段不能跨天';
    if (r.reason === 'notFound') return '找不到这条计划';
    return '时间不合法，没加成';
  }
  /* UI 层只做交互与提示，不碰数据；分钟 → datetime 的拼接在 todoAddExtraBlock 里做一次。 */
  function tbExtraCommit(dateStr, aMin, bMin) {
    if (!_arm) return;
    var lo = Math.min(aMin, bMin);
    var hi = Math.max(aMin, bMin) + TB_PAPER_SLOT_MIN_LOCAL; /* 结束格自己也算时长 */
    var isDraft = _arm.mode === 'draft';
    /* ★ 单日模式：这一段 = **那一天的全部排期**（整组替换，不是追加）。
       「我添加了不应该自动就替换那一天吗」+「单日是不是也应该可以选择那个块」。
       点完立刻退出选段模式并回到计划页 —— 一天只会有一段要选，留在网格上没有意义。 */
    /* ★ 习惯模式：一段 = 这个习惯「每天这一段做」。
       不写 todo.blocks（那是按日期展开的实例），写 h.timeBlocks（规则时段），
       所以不改日期、不改规则，只多一段"几点做"。留在选段模式里可以接着点第二段。 */
    if (_arm.mode === 'habit') {
      /* ★ 结束格当**上界**，不是"这一格也算"：计划块要一格一格涂满（所以 hi 要 +10），
         习惯只有「几点到几点」，点 13:00 和 14:00 两格就该是 13:00–14:00，
         存 14:10 会在卡上写成"排到 14:10"，用户一看就知道不对（实测就是这么发现的）。 */
      const r3 = (typeof habitAddBlockMinutes === 'function')
        ? habitAddBlockMinutes(_arm.habitId, lo, Math.max(aMin, bMin)) : { ok: false, reason: 'notFound' };
      if (!r3 || !r3.ok) {
        showToast(r3 && r3.reason === 'full'
          ? '一个习惯最多排 ' + HABIT_BLOCK_MAX + ' 段时段，先删一段'
          : '这一段没排上：时间不合法');
        return;
      }
      _pick = null;
      tbCreatePaint();
      tbExtraPaintBar();
      showToast('「' + _arm.title + '」每天 ' + r3.block.start + '–' + r3.block.end + ' 做它（共 ' + r3.count + ' 段）');
      if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
      return;
    }
    if (_arm.mode === 'habitday') {
      /* 单日：一段 = **那一天的全部时段**（整组覆盖规则时段）。结束格同样当上界，
         与习惯的"几点到几点"口径一致。点完就退出：一天只需要排一段。 */
      const dsD = String(dateStr || _arm.dateStr || '').slice(0, 10);
      const r4 = (typeof habitDayPlanSet === 'function')
        ? habitDayPlanSet(_arm.habitId, dsD, [{ start: dsD + ' ' + tbCreateHM(lo), end: dsD + ' ' + tbCreateHM(Math.max(aMin, bMin)) }])
        : { ok: false, reason: 'notFound' };
      if (!r4 || !r4.ok) { showToast('这一段没排上：时间不合法'); return; }
      const _titleD = _arm.title;
      tbExtraDisarm();
      showToast('「' + _titleD + '」' + dsD.slice(5) + ' 这天改成 ' + tbCreateHM(lo) + '–' +
        tbCreateHM(Math.max(aMin, bMin)) + '（其它日子照旧）');
      return;
    }
    if (_arm.mode === 'dayplan') {
      var ds0 = String(dateStr || '').slice(0, 10);
      var r2 = todoDayPlanSet(_arm.todoId, ds0, [{ start: ds0 + ' ' + tbCreateHM(lo), end: ds0 + ' ' + tbCreateHM(hi) }]);
      if (!r2 || !r2.ok) { showToast('这一段没排上：' + (r2 && r2.reason === 'date' ? '日期不对' : '时间不合法')); return; }
      var _title2 = _arm.title;
      /* 重复计划：说清这段到底算哪一种。用户点「在日程表选」时脑子里是
         「给每周日排个时间」，但选格写的是**单日覆盖** —— 点在周三就成了
         「周三单独排一段」，规则一点没改。不写明白，他只会看到
         「我排的是每周日，怎么跑到周三去了」。
         所以：命中的日子 → 告知规则不变；不命中的日子 → 直接点破那天不是规则的日。 */
      var _rt = (appData.todos || []).filter(function (x) { return String(x.id) === String(_arm.todoId); })[0];
      var _rrep = (_rt && typeof normTodoRepeat === 'function') ? normTodoRepeat(_rt.repeat) : null;
      var _tail = '（只改这一天）';
      if (_rrep) {
        var _rlb = todoRepeatLabel(_rrep);
        _tail = todoRepeatMatches(_rrep, ds0)
          ? '（只改这一天，' + _rlb + '的其它日子照旧）'
          : '（' + ds0.slice(5) + ' 不是「' + _rlb + '」的日子，这段只排这一天；要给' + _rlb + '都排，请在' + _rlb + '那一列再点一次）';
      }
      tbExtraDisarm();
      showToast('「' + _title2 + '」' + ds0.slice(5) + ' 改到 ' + tbCreateHM(lo) + '–' + tbCreateHM(hi) + _tail);
      if (typeof renderTodos === 'function') renderTodos();
      if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
      return;
    }
    /* 草稿模式走 01eC 的 tbAddDraftExtraBlock（只在内存里加，不落盘）；
       已有计划走 01d 的 todoAddBlock（校验 + 落盘）。两边校验口径一致。 */
    var r = isDraft
      ? (typeof window.tbAddDraftExtraBlock === 'function'
        ? window.tbAddDraftExtraBlock(dateStr, lo, hi)
        : { ok: false, reason: 'notFound', count: 0 })
      : todoAddBlock(_arm.todoId, dateStr, lo, hi);
    if (!r.ok) { showToast(tbExtraReasonText(r)); return; }
    if (isDraft) {
      /* ★ 排完一段**立刻回弹窗**，不留在网格上。
         需求「我点完排期，它排的期也不显示」—— 原来是留在选段模式、
         弹窗关着，他看不到刚排的段，只能凭记忆点「完成」。
         现在一段一收：回到弹窗就能看见清单；还想加就点「＋ 再加一段排期」。 */
      tbExtraDisarm();
      return;
    }
    showToast('已加 ' + (r.movedTo ? r.movedTo.slice(5) + '（' + dateStr.slice(5) + ' 不是这条重复计划的日子，已挪到最近的命中日）' : dateStr.slice(5)) +
      ' ' + tbCreateHM(lo) + '–' + tbCreateHM(hi) +
      '（共 ' + r.count + ' 段）');
    if (typeof renderTodos === 'function') renderTodos();
    if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
  }
  /* 网格当前锚定的日期：读日期条上那颗选中态的 title（01eA 把日期串写在那里）。
     不引用它的私有函数，切日期后自然跟随。 */
  function tbCreateDateStr() {
    var on = document.querySelector('#tbWeek .tb-day.on');
    var ds = on && on.getAttribute('title');
    if (ds) return ds;
    return getTodayStr();
  }
  /* 当天分钟数 → "HH:MM"（24 小时制：这里生成的是落盘串，不跟 12 小时制显示开关） */
  function tbCreateHM(min) {
    var m = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(min) || 0)));
    var h = Math.floor(m / 60), mi = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }
  function tbCreateWrap() {
    return document.getElementById('tbGridWrap');
  }
  /* 高亮只亮**所点的那一列**（lane 相同）。
     ★ 不能按 data-tb-min 把同分钟两列一起点亮：每个钟点「预计 / 实际」两列并排，
       那样点一格会并排多出一个红框，用户看着像出了 bug（原设计想的是"连成一段竖条"，
       实际观感是"旁边多出来一个"）—— 只亮自己点的那一格，意外最少。 */
  function tbCreatePaint() {
    var wrap = tbCreateWrap();
    if (!wrap) return;
    var old = wrap.querySelectorAll('.tb-paper-cell.is-tb-pick');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('is-tb-pick');
    if (!_pick) return;
    var sel = '.tb-paper-cell[data-tb-min="' + _pick.min + '"]';
    if (_pick.lane !== null && _pick.lane !== undefined && _pick.lane !== '') {
      sel += '[data-tb-lane="' + _pick.lane + '"]';
    }
    var hit = wrap.querySelectorAll(sel);
    for (var j = 0; j < hit.length; j++) hit[j].classList.add('is-tb-pick');
  }
  function tbCreateClear() {
    if (!_pick) return;
    _pick = null;
    tbCreatePaint();
  }
  /* 把「起点日期 + 起止分钟」写进新增计划弹窗。
     预计番茄数由时长反推（番茄时长里夹着休息，直接除会越界）；
     自动态下预计结束会跟着算出来，排不下半个番茄时改填手填的预计结束 ——
     两种情况都保证起止落在用户点的那两格上。 */
  function tbCreateOpen(dateStr, aMin, bMin) {
    var lo = Math.min(aMin, bMin), hi = Math.max(aMin, bMin);
    /* 结束格取**右缘**（无条件 +10）：一格 = 10 分钟的容器（01eA 的 TB_PAPER_SLOT_MIN=10，
       data-tb-min 只记每格**左缘**，而用户点选结束格的意思是「时段涂到这一格」——
       **结束格自己也计入时长**。所以：
         7:00 第一格 → 7:10 第二格 = 7:00–7:20（20 分钟，两格都算）
         7:00 第一格 → 7:50 末  格 = 7:00–8:00（60 分钟，六格都算）
       ★ 起点不修正：起点取左缘永远正确（7:50 格就是从 7:50 开始）。
       ★ 想要「整小时」请点到「XX:50 那一格」——末格右缘恰是下一整点，
         与「7 点到最后一格 = 8 点」同一条规则；跨小时点下一钟点第一格
         （16:00 → 17:00 格）按本规则是 16:00–17:10，那一格同样计入。 */
    hi += TB_PAPER_SLOT_MIN_LOCAL;
    openAddTodoModal();
    /* ★ 点两格画的是**排期**，不是提醒。
       起两者分开：这里直接把这一段放进新增弹窗的草稿，
       提醒一栏留空（用户想设再自己填）。 */
    var p = todoPomosForMinutes(hi - lo, appData.settings);
    var pz = document.getElementById('addTodoPomodoros');
    if (pz) pz.value = p > 0 ? String(p) : '';
    if (typeof window.tbAddDraftExtraBlock === 'function') {
      window.tbAddDraftExtraBlock(dateStr, lo, hi);
    }
    showToast('已把 ' + tbCreateHM(lo) + '–' + tbCreateHM(hi) + ' 加进排期' +
      (p > 0 ? '（约 ' + p + ' 个🍅）' : ''));
  }
  /* 事件用**委托**挂在网格容器上，不给每个格子写内联 handler（格子每次重画都是新节点）。
     与 01eA 自己的 pointerdown/move/up 不冲突：那几个只认 .tb-paper-blk，背景格不是 blk；
     手指滑动滚页面时浏览器不会补发 click，所以滑动不会误建计划。 */
  function tbCreateOnClick(e) {
    var cell = e.target && e.target.closest ? e.target.closest('.tb-paper-cell') : null;
    if (!cell) return;
    var wrap = tbCreateWrap();
    if (!wrap || !wrap.contains(cell)) return;
    var attr = cell.getAttribute('data-tb-min');
    if (attr == null || attr === '') return;
    var min = Number(attr);
    var lane = cell.getAttribute('data-tb-lane');
    var dateStr = tbCreateDateStr();
    if (!isFinite(min) || !dateStr) return;

    /* 第一次点（或换了日期）：记起点（连同点的哪一列，高亮只亮这一列） */
    if (!_pick || _pick.dateStr !== dateStr) {
      /* 选段模式下用户是"有意跨天连续排"，起点被静默丢弃会让他以为已经选好今天这一段 */
      if (_arm && _pick && _pick.dateStr !== dateStr) {
        showToast('已切换日期，之前选的起点已取消');
      }
      _pick = { dateStr: dateStr, min: min, lane: lane };
      tbCreatePaint();
      showToast('已选起点 ' + tbCreateHM(min) + '，再点结束的格子');
      return;
    }
    /* 同一格点两次：起止重合排不出计划，当作取消 */
    if (_pick.min === min) {
      tbCreateClear();
      showToast('已取消');
      return;
    }
    var a = _pick.min;
    tbCreateClear();
    /* ★ 唯一的插入点：选段模式下第二次点击 = 给目标计划追加一段，不打开新增计划弹窗。
       分支放在 tbCreateOpen 之前 return，保证不会误建计划。 */
    if (_arm) { tbExtraCommit(dateStr, a, min); return; }
    tbCreateOpen(dateStr, a, min);
  }
  /* 网格里那行说明：一行默认折叠的文字，复用设置页的折叠开关（toggleNote + .setting-note-*），
     不额外挂提示框。
     ★ **必须插进 `.tb-paper-body` 内部，不能插在 keys 后面** ——
       `.tb-paper` 折叠时只隐藏 body，插在 keys 与 body 之间就会**单独露在外面**，
       看着像没收进「今日计划」的展开里。放进 body 才跟着一起收放。
     ★ 引导语（「想给某段时间排计划？」）必须**放进折叠内容里** —— 它是说明的一部分，
       露在外面就成了"一句引导 + 一个「展开说明」开关"两个元素并排，看着像没收进去。
     ★ 开关与内容必须相邻（toggleNote 靠 nextElementSibling 找内容），中间不能插别的东西。 */  function tbCreateNote() {
    var wrap = tbCreateWrap();
    if (!wrap) return;
    var body = wrap.querySelector('.tb-paper-body');
    if (!body || wrap.querySelector('.tb-create-note')) return;
    var box = document.createElement('div');
    box.className = 'tb-create-note';
    box.innerHTML =
      '<span class="setting-note-toggle" onclick="toggleNote(this)">💡 展开说明</span>' +
      '<div class="setting-note-content">' +
      '想给某段时间排计划？在日程表上点一下<b>起始格</b>、再点一下<b>结束格</b>，' +
      '就会打开「新增计划」并填好起止时间。<br>' +
      '每格 10 分钟，<b>结束格自己也算时长</b>：点几格就是几格 × 10 分钟' +
      '（7:00 点到 7:10 那格 = 20 分钟；想到整点请点到「XX:50」那一格）。<br>' +
      '预计🍅按你设的专注 / 休息时长自动折算；不想排了直接关掉弹窗，不会改动已有计划。<br>' +
      '<b>按天安排（周计划）</b>：在上面日期条里点某一天（或翻周），网格和下面的计划列表' +
      '会一起切到那天——周三的安排只在周三显示，互不串门。在那天点两格、或按 ＋，' +
      '排的今天就归那天。没设开始时间的计划不归任何一天，会一直在「📌 未排期」里，' +
      '切到哪天都看得到。<br>' +
      '看**未来**的日期时，「⏮ 之前没完成的」默认折起来（规划未来时它们是噪音）——' +
      '点那行题头可以展开/收起；看今天时它默认是展开的。' +
      '</div>';
    body.insertAdjacentElement('afterbegin', box);
  }
  function tbCreateBind() {
    var wrap = tbCreateWrap();
    if (!wrap) return;
    if (wrap.getAttribute('data-tb-create-bound') !== '1') {
      wrap.setAttribute('data-tb-create-bound', '1');
      wrap.addEventListener('click', tbCreateOnClick);
    }
    tbCreateNote();
  }
  /* 网格每次重画都会把内容整体重建（说明行与高亮随之消失），所以要跟着每次渲染补插。
     ★ 走 01eA 的**渲染完成广播**（window.tbOnGridAfterRender），不是包装
       window.renderTimeBlockGrid：01eA 内部有 5 处本地调用（切日期/翻周/回今天/
       折叠切换/空壳入口）走本地函数绑定，包装外部引用覆盖不到它们 ——
       「说明行切个日期、或点一下折叠就消失」正是这么来的。
     广播在渲染末尾同步触发，说明行立刻跟上，不必等观察器回调。
     顺带清掉已选起点 —— 日期或数据变了，旧的起点不再成立。 */
  function tbCreateBoot() {
    if (typeof window.tbOnGridAfterRender === 'function') {
      window.tbOnGridAfterRender(function () {
        tbCreateClear();
        tbCreateBind();
        /* 横幅挂在 .tb-paper-body 里，每次重画都会被清掉；_arm 在闭包里，不随 DOM 重建丢失。
           这是选择这个挂载点的关键理由 —— 切日期/翻周后横幅还在，模式也还在。 */
        tbExtraPaintBar();
      });
    }
    tbCreateBind();
    tbExtraPaintBar();
    /* Esc = 退出选段模式。放在 document 上：横幅按钮不一定在视口里，
       而"点空白处退出"会和"点第一格"打架，不能做。 */
    document.addEventListener('keydown', function (e) {
      if (!_arm) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        tbExtraDisarm();
      }
    });
  }

  /* ★ 白名单登记 ≠ 运行时存在：本文件是封闭 IIFE，内部函数不会自动变成 window 属性。
     这两个是 HTML 内联 onclick 直接引用的（设置面板按钮 / 横幅 ✕），必须显式挂载。
     tbExtraCommit 不进白名单：它只被 tbCreateOnClick 内部调用，没有内联引用。 */
  window.todoExtraArm = tbExtraArm;
  window.todoExtraArmFromModal = tbExtraArmFromModal;
  window.todoExtraDisarm = tbExtraDisarm;
  /* 单日：「在日程表选」按钮（设置面板内联 onclick） */
  window.tbDayPlanArm = tbDayPlanArm;
  window.tbHabitArm = tbHabitArm;
  /* 习惯的「单日」：编辑弹窗里的「在日程表选」 */
  window.tbHabitDayArm = tbHabitDayArm;
  /* 给 01eA 渲染用：网格平时**不画**习惯的规则时段，只有这里返回非 null（正在给某个习惯选段）时，
     才把那一个习惯的段淡画出来当参照。单日排期（h.dayPlan）不受这个开关限制 ——
     那是用户点名要的那一天，永远要画出来（见 01eA 的 habitDayPlanOn 分支）。 */
  window.tbArmHabitId = function () {
    return (_arm && (_arm.mode === 'habit' || _arm.mode === 'habitday')) ? _arm.habitId : null;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tbCreateBoot);
  } else {
    tbCreateBoot();
  }
})();
