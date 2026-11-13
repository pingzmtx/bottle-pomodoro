/* C68 结算时刻 & 「一次计时 = 一条记录」（段落账本打通）
 *   实测：素描 10:30~12:00 计划做 3 个番茄，第 3 个 12:14 自然完成，
 *   结算窗没写、13:46 重开 App 才点的结算。两个问题同时暴露：
 *
 *   ① 结束时间被写成 13:46（= 点结算那一刻），而不是 12:14（= 倒计时归零那一刻）。
 *      → 日志卡组头「10:30–13:46」与组时长「1小时15分」自相矛盾；日程色块被撑成 117 分钟。
 *   ② 从日志删掉那条记录，日程里的色块还在、计划卡还写着「3 段」。
 *      旧模型把一次计时记到**两处**：计划身上的 actualSegs（开始计时就盖）+ 一条 record
 *      （结算才落），网格取并集画 —— 两个账本之间没有身份，删掉一个另一个就露了出来。
 *
 *   修法（需求批准的"底层打通"）：**一次计时 = 一条记录，段落只活在记录里**。
 *   进行中的那次计时先住 appData.liveSessions（= 同一条记录的待结算形态，id 在开始那刻定下），
 *   结算时整段搬进记录、会话消失 → 删记录 = 整件事消失，**结构上不可能留下孤儿**。
 *   计划身上的 actualSegs 彻底取消；旧数据由一次性迁移 migrateSegLedger() 归位。
 *
 *   四组断言：
 *     A 结束时刻 —— 自然完成取「归零时刻」；手动/补记仍取「现在」（不能一起改坏）
 *     B 账本打通 —— 开计时→会话；结算→搬进记录且会话消失；删记录→时段列表为空
 *     C 迁移 —— 旧 actualSegs 归位；孤儿段（记录已被删）丢弃；待结算的段保住；幂等
 *     D 结构守卫 —— 不再有"第二份账本"，删除路径上真接了这一步
 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  function nowT() { return Date.now(); }

  /* ── 现场备份（tree 会被积分/金币修改，必须深拷贝） ────────── */
  var bakRecs = appData.records;
  var bakTodos = appData.todos;
  /* ★ 自诊断：整个用例正文包一层 try/catch。
     一旦用例自己抛异常（比如引用了不存在的全局），要把异常**上报成一条红断言**，
     而不是让外层拿到空字符串 → 只看到"用例异常 Expecting value"，无从下手。 */
  var bakLive, bakMig, bakSnap, bakTree, bakPf, bakTS;
  try {
    bakLive = appData.liveSessions;
    bakMig = appData.__migration;
    bakSnap = appData.timerSnapshot;
    bakTree = JSON.parse(JSON.stringify(appData.tree || {}));
    bakPf = appData.pendingFinish;
    bakTS = JSON.parse(JSON.stringify(timerState));
  } catch (eBoot) {
    R.push(['✗ 用例准备阶段就抛异常：' + String((eBoot && eBoot.stack) || eBoot), false]);
    return JSON.stringify(R);
  }

  /* 迁移是一次性的：测试里要能重跑，先把"跑过了"的印记擦掉 */
  function clearMigrationMark() {
    if (appData.__migration && Array.isArray(appData.__migration.runs)) {
      appData.__migration.runs = appData.__migration.runs.filter(function (x) {
        return !(x && x.kind === 'segLedgerV2');
      });
    }
  }
  function migrationRuns() {
    return (appData.__migration && Array.isArray(appData.__migration.runs))
      ? appData.__migration.runs.filter(function (x) { return x && x.kind === 'segLedgerV2'; })
      : [];
  }

  try {
    appData.records = [];
    appData.todos = [];
    appData.liveSessions = [];
    appData.pendingFinish = null;
    appData.timerSnapshot = null;
    if (!appData.tree) appData.tree = { points: 0, coinLog: [] };

    /* ═══ A 结束时刻 ═══════════════════════════════════════════
       场景 = 需求的原场景：番茄 12:14 就归零了，人 13:46 才回来点结算。
       用 restorePendingFinish 恢复待结算窗再 confirmFinish 结掉，
       与真实「重开 App → 弹窗 → 选类型」同一条路径。 */
    var A_START = nowT() - 2 * 3600 * 1000;              /* 2 小时前开始 */
    var A_END = A_START + 25 * 60 * 1000;                /* 25 分钟后自然归零 */
    timerState.running = false;
    timerState.mode = 'focus';
    timerState.__noAutoBreak = true;   /* 用例里不触发兜底自动休息，免得留下跑着的计时器 */
    appData.pendingFinish = {
      mode: 'focus', totalDuration: 25 * 60, effectiveSeconds: 25 * 60, minPlan: 25,
      taskName: '结算时刻用例', todoId: null, subName: null, curSubId: null,
      startTime: A_START, endedAt: A_END, startEnergy: null, type: 'full'
    };
    restorePendingFinish();
    var _ft = document.getElementById('finishType');
    if (_ft) _ft.value = 'full';
    confirmFinish();

    var aRec = appData.records[appData.records.length - 1];
    ok('A1 自然完成：结束时刻 = 倒计时归零那一刻', aRec && aRec.endTime === A_END);
    ok('A2 结束时刻不是「点结算」那一刻（相差 ≈1h35m）',
      aRec && (nowT() - aRec.endTime) > 60 * 60 * 1000);
    ok('A3 开始/结束 跨度 = 25 分钟，没有被拉长',
      aRec && (aRec.endTime - aRec.startTime) === 25 * 60 * 1000);
    ok('A4 待结算已被结清（不会无限重弹）', !appData.pendingFinish);
    ok('A5 恢复待结算时不再提前清空 pendingFinish',
      String(restorePendingFinish).indexOf('appData.pendingFinish = null') < 0);

    /* A6 反向：手动提前结束没有 endedAt → 仍按「现在」落库（口径不能被改坏） */
    appData.records = [];
    appData.liveSessions = [];
    timerState.running = false;
    timerState.mode = 'focus';
    timerState.startTime = nowT() - 10 * 60 * 1000;
    timerState.totalDuration = 25 * 60;
    timerState.effectiveSeconds = 10 * 60;
    timerState.finishEndedAt = 0;
    timerState.taskName = '手动结束用例';
    timerState.linkedTodoId = null;
    appData.pendingFinish = null;
    savePomodoroRecord('half');
    var mRec = appData.records[appData.records.length - 1];
    ok('A6 手动提前结束仍以「现在」为结束时刻（差 < 5s）',
      mRec && Math.abs(nowT() - mRec.endTime) < 5000);

    /* ═══ B 一次计时 = 一条记录（段落只活在记录里） ═════════════ */
    /* ★ 假时钟：段落起点取的是「调用那一刻」，所以必须把时钟拨到 B_START 再开计时，
       否则段起点 = 真实 now，后面的断言会拿两套时间轴比。 */
    var _realNow = Date.now;
    var _clk = nowT() - 4 * 3600 * 1000;
    Date.now = function () { return _clk; };
    var B_START = _clk;
    var B_END = B_START + 25 * 60 * 1000;
    appData.records = [];
    appData.liveSessions = [];
    appData.todos = [{ id: 9601, title: '账本用例', done: false, pomodoros: 1, actualPomodoros: 0 }];
    timerState.running = true;
    timerState.mode = 'focus';
    timerState.__noAutoBreak = true;
    timerState.startTime = B_START;
    timerState.totalDuration = 25 * 60;
    timerState.effectiveSeconds = 25 * 60;
    timerState.finishEndedAt = 0;
    timerState.taskName = '账本用例';
    timerState.linkedTodoId = 9601;
    timerState.curSubId = null;
    timerState.interruptions = 0;
    timerState.totalInterruptSeconds = 0;

    /* ① 按下「开始计时」 —— 段落此刻就进 liveSessions（不再往计划身上盖） */
    openTodoActualSeg(9601);
    var _liveB = (appData.liveSessions || []).filter(function (ls) { return ls && ls.todoId === 9601; });
    ok('B1 开计时 → 出现一条进行中会话，且立刻有 1 段',
      _liveB.length === 1 && Array.isArray(_liveB[0].segs) && _liveB[0].segs.length === 1);
    ok('B2 计划身上**不再**有 actualSegs 这份副本',
      appData.todos[0].actualSegs === undefined);
    ok('B3 会话 id = 开始那一刻（结算时原样沿用为记录 id）',
      _liveB[0] && _liveB[0].id === B_START);
    ok('B4 计时中：时段列表能拿到这一段（网格要画"正在做"的块）',
      tbTodoSegList(appData.todos[0]).length === 1);

    /* ② 结算 —— 段落**搬**进记录，会话消失（同一事实只剩一处存放） */
    closeTodoActualSeg(9601, B_END);
    _clk = B_END; /* ★ 结算发生在到点之后：不把假时钟推到 B_END，记录 endTime 会取 B_START，
                     与新加的「段落不得越过记录结束」收口打架（B5 曾经因此红过） */
    timerState.finishEndedAt = B_END;
    savePomodoroRecord('half');
    Date.now = _realNow; /* 假时钟用完立刻还原，别影响后面的用例与页面定时器 */
    var bRec = appData.records[appData.records.length - 1];
    ok('B5 结算 → 段落搬进记录',
      bRec && Array.isArray(bRec.segs) && bRec.segs.length === 1 &&
      bRec.segs[0].s === B_START && bRec.segs[0].e === B_END);
    ok('B6 结算后 liveSessions 里不再留着这次会话',
      (appData.liveSessions || []).every(function (ls) { return !(ls && ls.todoId === 9601); }));
    ok('B7 结算后时段列表仍返回这一段（显示不变）',
      tbTodoSegList(appData.todos[0]).length === 1);

    /* ③ 删记录 —— 段落随记录一起消失，无可残留 */
    var goneB = appData.records.slice();
    appData.records = [];
    revertRecordRewards(goneB);
    ok('B8 删记录后 → 该计划的时段列表为空（色块不可能再残留）',
      tbTodoSegList(appData.todos[0]).length === 0);
    ok('B9 删记录后计划身上也不存在 actualSegs', appData.todos[0].actualSegs === undefined);

    /* ═══ C 旧数据迁移（migrateSegLedger） ═════════════════════ */
    var M0 = nowT() - 6 * 3600 * 1000;
    var M1 = M0 + 25 * 60 * 1000;
    var M2 = M0 + 40 * 60 * 1000;
    var M3 = M2 + 25 * 60 * 1000;

    /* C-1 两段各有对应记录 → 各归各家 */
    appData.liveSessions = [];
    appData.pendingFinish = null;
    appData.timerSnapshot = null;
    appData.todos = [{
      id: 9701, title: '迁移用例', done: false,
      actualSegs: [{ s: M0, e: M1 }, { s: M2, e: M3 }], actualStart: M0,
      actualPomodoros: 2, timeSpent: 3000
    }];
    appData.records = [
      { id: 8101, todoId: 9701, taskName: '迁移用例', type: 'full', startTime: M0, endTime: M1, effectiveSeconds: 1500, pomos: 1 },
      { id: 8102, todoId: 9701, taskName: '迁移用例', type: 'full', startTime: M2, endTime: M3, effectiveSeconds: 1500, pomos: 1 }
    ];
    clearMigrationMark();
    migrateSegLedger();
    ok('C1 旧数据：两段各自归位到对应的记录',
      Array.isArray(appData.records[0].segs) && appData.records[0].segs[0].s === M0 &&
      Array.isArray(appData.records[1].segs) && appData.records[1].segs[0].s === M2);
    ok('C2 计划身上那份副本被删掉', appData.todos[0].actualSegs === undefined);
    ok('C3 迁移后时段列表仍是 2 段（界面上看不出变化）',
      tbTodoSegList(appData.todos[0]).length === 2);
    ok('C4 迁移在 __migration.runs 里留下一条 segLedgerV2 记录', migrationRuns().length === 1);

    /* C-2 幂等：再跑一次不重复动数据 */
    migrateSegLedger();
    ok('C5 幂等：再跑一次既不改数据也不重复记账',
      migrationRuns().length === 1 && tbTodoSegList(appData.todos[0]).length === 2);

    /* C-3 孤儿段（记录已被删掉）→ 丢弃：这正是需求的「把我删掉的那条删掉」 */
    appData.liveSessions = [];
    appData.pendingFinish = null;
    appData.timerSnapshot = null;
    appData.todos = [{
      id: 9702, title: '孤儿段用例', done: false,
      actualSegs: [{ s: M0, e: M1 }, { s: M2, e: M3 }], actualStart: M0
    }];
    appData.records = [{
      id: 8103, todoId: 9702, taskName: '孤儿段用例', type: 'full',
      startTime: M0, endTime: M1, effectiveSeconds: 1500, pomos: 1
    }];
    clearMigrationMark();
    migrateSegLedger();
    ok('C6 有记录的那段留下、没记录的孤儿段被丢弃',
      tbTodoSegList(appData.todos[0]).length === 1 &&
      appData.records[0].segs.length === 1 && appData.records[0].segs[0].s === M0);
    ok('C7 丢弃的段数被记进迁移日志（可追溯，不是静默丢失）',
      migrationRuns().length === 1 && migrationRuns()[0].dropped === 1);

    /* C-4 待结算（计时还在 / 暂停中）→ 段不能被当孤儿丢掉 */
    appData.liveSessions = [];
    appData.records = [];
    appData.timerSnapshot = null;
    appData.todos = [{
      id: 9703, title: '待结算用例', done: false,
      actualSegs: [{ s: M0, e: M1 }], actualStart: M0
    }];
    appData.pendingFinish = { mode: 'focus', todoId: 9703, startTime: M0 };
    clearMigrationMark();
    migrateSegLedger();
    var _liveC = (appData.liveSessions || []).filter(function (ls) { return ls && ls.todoId === 9703; });
    ok('C8 待结算的段不会被当孤儿丢掉 → 落进 liveSessions', 
      _liveC.length === 1 && _liveC[0].segs.length === 1);
    ok('C9 计划身上的副本照样清掉', appData.todos[0].actualSegs === undefined);

    /* C-5 暂停中（快照指着这个计划）同样算"没结算" —— 只判 running 会把暂停中的段误删 */
    appData.liveSessions = [];
    appData.records = [];
    appData.pendingFinish = null;
    appData.todos = [{
      id: 9704, title: '暂停用例', done: false,
      actualSegs: [{ s: M0, e: M1 }], actualStart: M0
    }];
    appData.timerSnapshot = { mode: 'focus', linkedTodoId: 9704, running: false, startTime: M0, paused: true };
    clearMigrationMark();
    migrateSegLedger();
    ok('C10 暂停中的会话（快照指着它、running=false）不被误删',
      (appData.liveSessions || []).some(function (ls) { return ls && ls.todoId === 9704; }));
    appData.timerSnapshot = null;

    /* ═══ D 结构守卫（防回流） ═════════════════════════════════ */
    /* ⚠️ 不要拿 String(savePomodoroRecord) 当守卫：全局这个名字被 05_journey 的
       门禁包了一层包装函数，读到的是包装壳、不是实现（踩过一次）。改用"函数是否还在"。 */
    ok('D1 结算路径把段落搬进记录（consumeLiveSessionForRecord 已接上）',
      typeof consumeLiveSessionForRecord === 'function' &&
      typeof savePomodoroRecord === 'function');
    ok('D2 删除路径不再需要"额外裁段"（旧认亲机制已废）',
      typeof revertRecordRewards === 'function' &&
      typeof dropTodoActualSegForRecord === 'undefined');
    ok('D3 旧认亲机制已从全局移除',
      typeof stampTodoSegRecId === 'undefined' && typeof dropTodoActualSegForRecord === 'undefined' &&
      typeof todoSegIndexOfRecord === 'undefined');
    ok('D4 时段唯一入口 tbTodoSegList 存在',
      typeof tbTodoSegList === 'function');
    /* 网格的实际块由一个闭包内部函数绘制（不是全局，取不到引用），
       所以改用一条更本质的守卫：**取时段的唯一入口**和**删除路径**都不许再碰那个旧字段。 */
    ok('D5 唯一入口/删除路径都不再读 actualSegs（防"第二份账本"复活）',
      String(tbTodoSegList).indexOf('actualSegs') < 0 &&
      String(revertRecordRewards).indexOf('actualSegs') < 0);
    /* 旧实现已下线：留着它就是"同一件事有两个实现"，哪天有人改一边就又开始各说各话 */
    ok('D6 已下线的重复实现不再存在（tbActualSegments / dropTodoActualSegForRecord）',
      typeof tbActualSegments === 'undefined' && typeof dropTodoActualSegForRecord === 'undefined');

    /* ═══ E 删一条记录 = 这条 id 产生的四样东西一起消失 ═══════════
       时段(segs) / 计划账(actualPomodoros·timeSpent) / 树积分 / 金币。
       前三样早就在回滚，只有**金币**漏了 —— 需求真实数据里就留着一条
       meta.recordId 指向已删记录的 +1 流水，成了永远查不出出处的孤儿。 */
    var E_REC = 9801, E_START = nowT() - 3 * 3600 * 1000, E_END = E_START + 25 * 60 * 1000;
    function _eSetup() {
      appData.liveSessions = [];
      appData.pendingFinish = null;
      appData.timerSnapshot = null;
      appData.records = [{
        id: E_REC, todoId: 9801, taskName: '金币用例', type: 'full',
        startTime: E_START, endTime: E_END, effectiveSeconds: 1500, pomos: 1,
        segs: [{ s: E_START, e: E_END }]
      }];
      appData.todos = [{ id: 9801, title: '金币用例', done: false, actualPomodoros: 1, timeSpent: 1500 }];
      appData.tree = appData.tree || {};
      appData.tree.coins = 6;
      appData.tree.coinLog = [
        { id: 'e-tx-dur', at: E_END, amount: 1, type: 'duration', after: 6, undoOf: '', meta: { recordId: E_REC } },
        { id: 'e-tx-daily', at: E_END + 1000, amount: 5, type: 'daily', after: 11, undoOf: '', meta: null }
      ];
    }
    _eSetup();
    revertRecordRewards(appData.records.slice());
    var _eLog = appData.tree.coinLog;
    ok('E1 记录发的金币被反向（写 undo 流水，不抹原始条目 → 账还能查）',
      _eLog.some(function (x) { return x.undoOf === 'e-tx-dur' && x.amount === -1; }) &&
      _eLog.some(function (x) { return x.id === 'e-tx-dur'; }));
    ok('E2 余额同步扣回（6 → 5）', appData.tree.coins === 5);
    ok('E3 不带 recordId 的入账（每日任务）不受牵连',
      _eLog.some(function (x) { return x.id === 'e-tx-daily'; }) &&
      !_eLog.some(function (x) { return x.undoOf === 'e-tx-daily'; }));
    revertRecordRewards(appData.records.slice());
    ok('E4 重复回滚不重复扣（幂等）',
      appData.tree.coins === 5 &&
      _eLog.filter(function (x) { return x.undoOf === 'e-tx-dur'; }).length === 1);
    /* 老记录（没有 todoId）按标题认领 —— 原由 tbActualSegments 承担，
       它下线后这条口径必须由唯一入口 tbTodoSegList 接住，否则老数据会从网格上"消失"。 */
    appData.liveSessions = [];
    appData.records = [{ id: 9901, taskName: '老记录标题', startTime: E_START, endTime: E_END }];
    appData.todos = [{ id: 9902, title: '老记录标题', done: false }];
    /* ★ 终态（名字不是身份，见 C70）：读路径**不再按名字认领**，
       归属只看 todoId。老记录里能认亲的在启动迁移 migrateRecordOwnership 里一次性补挂 id。
       所以这里断言的是新口径：无 todoId → 不认领（不传日期也一样）。 */
    var E_DAY = getDateStr(new Date(E_START));
    ok('E5 无 todoId 的老记录读路径不认领（名字不是身份）',
      tbTodoSegList(appData.todos[0], E_DAY).length === 0);
    ok('E5b 不传日期同样为 0（读路径压根不看名字）', tbTodoSegList(appData.todos[0]).length === 0);
    /* 补挂 id 之后立刻能读到 —— 这就是启动迁移做完的效果 */
    appData.records = [{ id: 9901, taskName: '老记录标题', todoId: 9902, startTime: E_START, endTime: E_END }];
    ok('E5c 补挂 todoId 后读得到（迁移后的唯一口径）', tbTodoSegList(appData.todos[0], E_DAY).length === 1);
    appData.todos = [{ id: 9903, title: '不相干的标题', done: false }];
    ok('E6 标题不符不认领（不会把别人的专注画到自己头上）', tbTodoSegList(appData.todos[0], E_DAY).length === 0);
  } catch (eBody) {
    R.push(['✗ 用例正文抛异常：' + String((eBody && eBody.stack) || eBody), false]);
  } finally {
    /* ── 还原现场 ──────────────────────────────────────────── */
    if (_realNow) Date.now = _realNow; /* 假时钟万一没走到还原点也不会把页面搞坏 */
    appData.records = bakRecs;
    appData.todos = bakTodos;
    appData.liveSessions = bakLive;
    appData.__migration = bakMig;
    appData.timerSnapshot = bakSnap;
    appData.tree = bakTree;
    appData.pendingFinish = bakPf;
    try { Object.assign(timerState, bakTS); } catch (e) { }
    try {
      var fm = document.getElementById('finishModal');
      if (fm) fm.classList.remove('show');
    } catch (e) { }
    try { saveDataNow(); } catch (e) { }
    void bakTree;
  }
  return JSON.stringify(R);
})();
