/* C73 「计时到点了但我过一会才结算」——段落必须收在归零那一刻，不许收到结算那一刻
 *
 * 实测：5:18 开始一个 25 分钟番茄，5:43 到点，
 * 人 6:01 才回到 App 才点结算。结果：
 *   · 专注记录写 25 分钟（对，因为 endTime 走 finishEndedAt/endAt）
 *   · 计划卡写「✅ 5:18~6:01」+「共 43 分」（错）
 *   · 日程色块撑成 43 分钟（错）
 * 同一个番茄在三个页面给出三套数字。上一轮（C68）只修了**记录**的结束时刻，
 * 没人管**段落**的结束时刻 —— 那是另一条代码路径（01c stopTimerLoop → 01d closeTodoActualSeg），
 * 它一直取 Date.now()。
 *
 * 本轮堵的三处：
 *   A closeTodoActualSeg 收段用「已知真实结束时刻」（_tbSegEndAt，由 onTimerComplete 钉住）
 *   B 落库 consumeLiveSessionForRecord 收口：还开着的段（e=0）→ 按记录结束收；
 *     越过记录结束的段 → 裁回记录结束（这是段落与记录最后的对齐机会）
 *   C 一次性迁移 migrateSegClampV1：把已经写坏的历史记录改回来（幂等）
 *   D 结果一致：tbTodoSegList / 计划卡 / 日程块 与记录时长说同一个数
 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }

  var bak = {
    recs: appData.records, todos: appData.todos, live: appData.liveSessions,
    mig: appData.__migration, snap: appData.timerSnapshot, pf: appData.pendingFinish
  };
  var realNow = Date.now;
  var D = new Date();
  var T0 = new Date(D.getFullYear(), D.getMonth(), D.getDate(), 5, 18, 0).getTime();
  var TE = T0 + 25 * 60000;          /* 5:43 倒计时归零 */
  var LATE = TE + 18 * 60000;        /* 6:01 人才回来结算 */

  try {
    /* ── A 收段用归零时刻 ───────────────────────────── */
    appData.todos = [{ id: 9001, title: '收拾屋子', done: false, repeat: null, pomodoros: 1.5, subs: [], tag: '生活', actualPomodoros: 0 }];
    appData.records = [];
    appData.liveSessions = [];
    appData.__migration = { runs: [] };

    /* 让"现在"停在 6:01 —— 模拟 tick 被后台节流到这一刻才跑起来 */
    var fake = T0;
    Date.now = function () { return fake; };
    Object.assign(timerState, {
      mode: 'focus', type: 'full', running: true, linkedTodoId: 9001,
      startTime: T0, endAt: TE, effectiveSeconds: 0, totalSeconds: 1500,
      interruptions: 0, totalInterruptSeconds: 0, pomos: 1, pomodoroSeconds: 1500,
      finishEndedAt: 0, finishSource: '', taskName: '收拾屋子', pausedRemaining: 0
    });
    startTimerLoop();
    ok('A1 开计时 → 开出一段', !!(appData.liveSessions[0] && appData.liveSessions[0].segs.length === 1));

    fake = LATE;
    onTimerComplete();
    var sg = ((appData.liveSessions[0] || { segs: [{}] }).segs || [{}])[0];
    ok('A2 收段结束 = 归零时刻 5:43（不是 tick 迟到的 6:01）', !!sg && sg.e === TE);
    ok('A3 待结算里记的结束时刻也是 5:43', !!(appData.pendingFinish && appData.pendingFinish.endedAt === TE));
    try { clearInterval(timerState.interval); } catch (e0) {}
    timerState.running = false; timerState.interval = null; timerState.mode = 'idle'; timerState.linkedTodoId = null;
    Date.now = realNow;
    appData.pendingFinish = null;

    /* ── B 落库收口 ──────────────────────────────── */
    appData.liveSessions = [{ id: T0, todoId: 9001, startTime: T0, segs: [{ s: T0, e: 0 }] }];
    var rec = { id: 101, startTime: T0, endTime: TE };
    consumeLiveSessionForRecord(rec, 9001);
    ok('B1 还开着的段按记录结束收口', !!(rec.segs && rec.segs[0].e === TE));
    ok('B2 会话被消费掉（不留在 liveSessions 里）', !liveSessionOf(9001));

    appData.liveSessions = [{ id: T0, todoId: 9001, startTime: T0, segs: [{ s: T0, e: LATE }] }];
    rec = { id: 102, startTime: T0, endTime: TE };
    consumeLiveSessionForRecord(rec, 9001);
    ok('B3 越过记录结束的段被裁回记录结束', !!(rec.segs && rec.segs[0].e === TE));

    appData.liveSessions = [{ id: T0, todoId: 9001, startTime: T0, segs: [{ s: TE + 60000, e: 0 }] }];
    rec = { id: 103, startTime: T0, endTime: TE };
    consumeLiveSessionForRecord(rec, 9001);
    ok('B4 结束早于开始的垃圾段被丢弃', !rec.segs || !rec.segs.length);

    appData.liveSessions = [];
    rec = { id: 104, startTime: T0, endTime: TE, segs: [{ s: T0, e: TE }] };
    appData.liveSessions = [{ id: T0, todoId: 9001, startTime: T0, segs: [{ s: T0, e: TE }] }];
    consumeLiveSessionForRecord(rec, 9001);
    ok('B5 已经正确的段不被改动', !!rec.segs && rec.segs[0].e === TE);

    /* ── C 历史数据迁移 ───────────────────────────── */
    appData.records = [
      { id: 201, startTime: T0, endTime: TE, segs: [{ s: T0, e: LATE }] },   /* 越界 */
      { id: 202, startTime: T0, endTime: TE, segs: [{ s: T0, e: 0 }] },      /* 还开着 */
      { id: 203, startTime: T0, endTime: TE, segs: [{ s: T0, e: TE }] }      /* 本来就对 */
    ];
    appData.liveSessions = [];
    appData.__migration = { runs: [] };
    migrateSegClampV1();
    ok('C1 历史越界段裁回记录结束', appData.records[0].segs[0].e === TE);
    ok('C2 历史开口段收口', appData.records[1].segs[0].e === TE);
    ok('C3 本来就对的记录一字不改', appData.records[2].segs[0].e === TE);
    ok('C4 迁移留下一次标记', appData.__migration.runs.some(function (x) { return x && x.kind === 'segClampV1'; }));
    var n1 = appData.__migration.runs.length;
    migrateSegClampV1();
    ok('C5 幂等：不重复迁移', appData.__migration.runs.length === n1);

    /* ── D 三个页面说同一个数 ──────────────────────── */
    appData.todos = [{ id: 9001, title: '收拾屋子', done: true, repeat: null, pomodoros: 1.5, subs: [], tag: '生活', actualPomodoros: 1 }];
    appData.records = [{
      id: 301, startTime: T0, endTime: TE, todoId: 9001, type: 'full', taskName: '收拾屋子',
      effectiveSeconds: 1500, pomos: 1, segs: [{ s: T0, e: LATE }]
    }];
    appData.__migration = { runs: [] };
    migrateSegClampV1();
    var list = tbTodoSegList(appData.todos[0], getDateStr(T0));
    ok('D1 计划只看到一段', list.length === 1);
    ok('D2 段时长 = 25 分钟（不是 43）', list.length === 1 && Math.round((list[0].e - list[0].s) / 60000) === 25);
    try {
      renderTodos();
      var txt = [].slice.call(document.querySelectorAll('.todo-actual'))
        .map(function (x) { return x.textContent; }).join(' | ');
      ok('D3 计划卡写 5:18~5:43 而不是 5:18~6:01 :: ' + txt,
        /5:18/.test(txt) && /5:43/.test(txt) && !/6:01/.test(txt));
    } catch (e2) {
      ok('D3 渲染抛异常：' + e2.message, false);
    }
    var recDur = Math.round((appData.records[0].endTime - appData.records[0].startTime) / 60000);
    ok('D4 记录时长与段落时长一致（25 = 25）',
      list.length === 1 && Math.round((list[0].e - list[0].s) / 60000) === recDur);

    /* ── F 启动扫尾：没人认领的开口段必须收掉 ──────────────
       段落只在「计时停」和「结算落库」两处被收。App 被系统杀掉时两处都没机会跑，
       那段在数据里就永远是 e=0 → 计划卡「进行中」、日程色块一路长到今天。启动时必须扫。 */
    timerState.running = false; timerState.linkedTodoId = null;
    appData.pendingFinish = null; appData.timerSnapshot = null;
    appData.records = [{ id: 1, startTime: T0, endTime: TE, todoId: 9001, segs: [{ s: T0, e: TE }] }];
    appData.liveSessions = [{ id: T0, todoId: 9001, startTime: T0, segs: [{ s: T0, e: 0 }] }];
    closeStaleLiveSessions();
    ok('F1 无计时在跑 → 按同起点那条记录的结束收口',
      !!appData.liveSessions[0] && appData.liveSessions[0].segs[0].e === TE);

    appData.records = [];
    appData.liveSessions = [{ id: 2, todoId: 9002, startTime: T0, segs: [{ s: T0, e: 0 }] }];
    closeStaleLiveSessions();
    ok('F2 一点证据都没有 → 整条会话丢弃（不留「进行中」）', appData.liveSessions.length === 0);

    appData.timerSnapshot = { mode: 'focus', linkedTodoId: 9003, endAt: TE + 600000 };
    appData.liveSessions = [{ id: 3, todoId: 9003, startTime: T0, segs: [{ s: T0, e: 0 }] }];
    closeStaleLiveSessions();
    ok('F3 有快照 → 按快照排定的 endAt 收口',
      !!appData.liveSessions[0] && appData.liveSessions[0].segs[0].e === TE + 600000);

    timerState.running = true; timerState.linkedTodoId = 9004;
    appData.liveSessions = [{ id: 4, todoId: 9004, startTime: T0, segs: [{ s: T0, e: 0 }] }];
    closeStaleLiveSessions();
    ok('F4 真在跑的那条不被误收（它不是"断掉的段"）',
      appData.liveSessions.length === 1 && appData.liveSessions[0].segs[0].e === 0);
    timerState.running = false; timerState.linkedTodoId = null;

    appData.pendingFinish = { todoId: 9005, endedAt: TE };
    appData.liveSessions = [{ id: 5, todoId: 9005, startTime: T0, segs: [{ s: T0, e: 0 }] }];
    closeStaleLiveSessions();
    ok('F5 待结算 → 按 pendingFinish.endedAt 收口（不是 now）',
      !!appData.liveSessions[0] && appData.liveSessions[0].segs[0].e === TE);
    /* ---- G. 时长与区间解耦（借鉴 super-productivity：时长是累加值，区间只负责定位） ---- */
    try {
      var G0 = new Date('2026-10-17T05:18:00').getTime();
      var G1 = new Date('2026-10-17T05:43:00').getTime();
      var G2 = new Date('2026-10-17T06:01:00').getTime();
      appData.todos = [{ id: 9901, name: '测试计划', date: '2026-10-17', done: false, actualSegs: [], createdAt: G0 }];
      appData.records = [{
        id: 8801, todoId: 9901, taskName: '测试计划',
        startTime: G0, endTime: G1, effectiveSeconds: 1500, pomodoros: 1,
        segs: [{ s: G0, e: G2 }] /* 段落故意写坏到 6:01 */
      }];
      appData.liveSessions = [];
      var gMs = tbTodoFocusMs(appData.todos[0], '2026-10-17', Date.now());
      ok('G1 段落跨到 6:01，权威时长仍是 25 分（不随区间走）', Math.round(gMs / 60000) === 25);
      ok('G2 同一份数据用旧的 Σ(e-s) 会算成 43 分（证明这条断言有对比价值）',
        Math.round((G2 - G0) / 60000) === 43);
      /* 段落完全丢失时，时长也不许归零 —— 记录的 effectiveSeconds 才是账本 */
      appData.records[0].segs = [];
      ok('G3 段落被清空，时长仍按记录 25 分', Math.round(tbTodoFocusMs(appData.todos[0], '2026-10-17', Date.now()) / 60000) === 25);
      /* 缺 effectiveSeconds 的老数据才退回 endTime-startTime */
      delete appData.records[0].effectiveSeconds;
      appData.records[0].segs = [{ s: G0, e: G2 }];
      ok('G4 老数据无 effectiveSeconds → 退回 endTime-startTime（25 分）',
        Math.round(tbTodoFocusMs(appData.todos[0], '2026-10-17', Date.now()) / 60000) === 25);
      /* 别的日子的记录不计入当天 */
      ok('G5 换一天查询不计入（0 分）',
        tbTodoFocusMs(appData.todos[0], '2026-10-16', Date.now()) === 0);
      /* 进行中的会话按 now 补 */
      appData.liveSessions = [{ todoId: 9901, segs: [{ s: G1, e: 0 }] }];
      ok('G6 进行中的会话按「此刻 - 开始」补足',
        Math.round(tbTodoFocusMs(appData.todos[0], '2026-10-17', G2) / 60000) === 43);
    } catch (e) {
      R.push(['⚠️ G 组异常：' + (e && (e.stack || e.message) || e), false]);
    }
  } catch (e) {
    R.push(['⚠️ 用例抛异常：' + (e && (e.stack || e.message) || e), false]);
  } finally {
    try {
      clearInterval(timerState.interval);
      timerState.running = false; timerState.interval = null;
      timerState.mode = 'idle'; timerState.linkedTodoId = null; timerState.finishEndedAt = 0;
      appData.pendingFinish = null;
    } catch (e3) {}
    Date.now = realNow;
    appData.records = bak.recs; appData.todos = bak.todos;
    appData.liveSessions = bak.live; appData.__migration = bak.mig;
    appData.timerSnapshot = bak.snap; appData.pendingFinish = bak.pf;
    try { if (typeof renderTodos === 'function') renderTodos(); } catch (e4) {}
  }
  return JSON.stringify(R);
})();
