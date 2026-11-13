/* C70 「名字不是身份」——归属只看 todoId，名字只在启动迁移里用一次
 *   实测：前几天做过「收拾屋子」（自由专注，记录里没有 todoId），
 *   今天新建一条同名计划，卡片上立刻冒出：
 *     ⏰ 15:15~15:42　✅ 5 段 · 共 132 分　⏳ 搁置 7 天
 *   三个数全是那天的旧账。病根：四处代码都拿**任务名**当身份、不限日期、不查唯一。
 *
 *   ★ 终态：
 *     sp 那边时长是任务自己的字段 task.timeSpentOnDay[日期]，写入按 **id**，
 *     全仓没有一处「按标题找任务」；重复任务每个实例还有确定性 id
 *     rpt_${repeatCfgId}_${dueDay}。也就是说它从数据结构上就没有"名字当身份"这回事。
 *     我们受限于老数据只有 taskName，于是把按名字认亲**从读路径搬到启动迁移**：
 *       migrateRecordOwnership() 一次性给"当天 + 全库标题唯一"的老记录补挂 todoId 并落盘；
 *       认不出来的一律 todoId = null（= 真的计划外专注）。
 *     此后 tbTodoSegList / 搁置天数 / 计划外灰块 **全部只认 id**，名字退出身份判断。
 *
 *   A 读路径不按名字认领（bug 本体）　B 迁移把能认的老账补上 id（一次了结）
 *   C 迁移的三条准入（当天/唯一/不用补记认）　D 写时解析同一条规矩
 *   E 搁置天数只看自己的记录　F 计划外灰块
 */
(function () {
  const R = [];
  const ok = (n, c) => R.push([n, !!c]);
  const bak = {
    todos: appData.todos,
    records: appData.records,
    live: appData.liveSessions,
    mig: appData.__migration
  };
  try {
    appData.liveSessions = [];
    appData.__migration = { runs: [] };
    const today = getTodayStr();
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const oldDay = getDateStr(d);
    /* 旧账：7 天前 5 段同名自由专注（记录里没有 todoId，正是线上数据的样子） */
    const oldRecs = [];
    for (let i = 0; i < 5; i++) {
      const st = new Date(oldDay + 'T' + String(9 + i).padStart(2, '0') + ':00:00').getTime();
      oldRecs.push({
        id: 900100 + i,
        taskName: '收拾屋子',
        todoId: null,
        type: 'focus',
        startTime: st,
        endTime: st + 25 * 60000,
        durMin: 25,
        pomos: 1,
        segs: [{ s: st, e: st + 25 * 60000 }]
      });
    }
    /* 计划 id 就是 Date.now()（见 01eC addTodo）→ 它就是"出生时刻"。
       今天 08:00 出生，所以"今天的记录"能认，7 天前的记录一定不能认。 */
    const createdTs = new Date(today + 'T08:00:00').getTime();
    const todayNew = { id: createdTs, title: '收拾屋子', done: false, estPomos: 1 };

    /* ---- A 读路径只认 id：同名的新计划捡不走任何旧账 ---- */
    appData.todos = [todayNew];
    appData.records = oldRecs.slice();
    ok('A1 新计划的段列表里没有 7 天前的旧账', tbTodoSegList(todayNew, today).length === 0);
    ok('A1b 看那一天也不认领（读路径压根不看名字）',
      tbTodoSegList(todayNew, oldDay).length === 0);
    ok('A2 不传日期时同样为 0', tbTodoSegList(todayNew).length === 0);
    ok('A3 读操作不改数据（诊断不该写库）', appData.records[0].todoId === null);
    ok('A4 标题唯一性判定为 1（迁移判据仍需要它）', tbTodoTitleCount('收拾屋子') === 1);
    ok('A5 计划外灰块把 5 段旧账都算上（它真做过，只是没挂计划）',
      tbUnplannedSegments(appData.records, oldDay, [todayNew.id]).length === 5);

    /* ---- B 迁移：一次性把能认亲的老账补上 todoId ---- */
    const sameDayRec = {
      id: 900200,
      taskName: '收拾屋子',
      todoId: null,
      type: 'focus',
      startTime: new Date(today + 'T10:00:00').getTime(),
      endTime: new Date(today + 'T10:25:00').getTime(),
      pomos: 1,
      segs: [{
        s: new Date(today + 'T10:00:00').getTime(),
        e: new Date(today + 'T10:25:00').getTime()
      }]
    };
    /* 迁移前先让"当天那条"有主人可认：同一天的计划 id 对得上
       —— 这里用 todayNew（它今天才建，但记录也是今天的，属于"当天 + 唯一"） */
    appData.records = oldRecs.concat([sameDayRec]);
    migrateRecordOwnership();
    ok('B1 迁移给当天的老记录补上了 todoId', appData.records[5].todoId === todayNew.id);
    ok('B2 迁移不碰 7 天前的（那天没有同名计划）',
      appData.records.slice(0, 5).every(r => r.todoId === null));
    ok('B3 迁移后台账立刻能读到那一段（读路径只认 id 也不丢）',
      tbTodoSegList(todayNew, today).length === 1);
    ok('B4 迁移记了运行轨迹（可查、可幂等）',
      appData.__migration.runs.some(x => x && x.kind === 'recordOwnerV1' && x.claimed === 1));
    ok('B5 旧账依旧 0 段（补的是当天的，不是旧的）',
      tbTodoSegList(todayNew, oldDay).length === 0);
    /* 幂等：再跑一次不会重复处理、也不会把 claimed 再算一遍 */
    const runsBefore = appData.__migration.runs.length;
    const claimedBefore = appData.records.filter(r => r.todoId != null).length;
    migrateRecordOwnership();
    ok('B6 幂等：再跑不新增轨迹、不改数据',
      appData.__migration.runs.length === runsBefore &&
      appData.records.filter(r => r.todoId != null).length === claimedBefore);

    /* ---- C 迁移的三条准入 ---- */
    /* C1 同名多条 → 认不出来（宁可不认，也不记到某一条头上） */
    const twin = { id: createdTs + 1800000, title: '收拾屋子', done: false, estPomos: 1 };
    appData.todos = [todayNew, twin];
    appData.records = [Object.assign({}, sameDayRec, { todoId: null })];
    appData.__migration = { runs: [] };
    migrateRecordOwnership();
    ok('C1 同名两条 → 迁移不认领（身份不明）', appData.records[0].todoId === null);
    /* C2 补记（type='log'）不对应任何计划 */
    appData.todos = [todayNew];
    appData.records = [Object.assign({}, sameDayRec, { todoId: null, type: 'log' })];
    appData.__migration = { runs: [] };
    migrateRecordOwnership();
    ok('C2 补记（log）不挂计划', appData.records[0].todoId === null);
    /* C3 记录早于计划创建 → 不认（**这就是这类 bug 的真正判据**：
       名字相同、全库唯一，但那段专注发生在今天这条计划出生之前，不可能是它的） */
    appData.records = [Object.assign({}, oldRecs[0], { todoId: null })];
    appData.__migration = { runs: [] };
    migrateRecordOwnership();
    ok('C3 早于计划创建时刻的记录不被认领（bug 本体）', appData.records[0].todoId === null);
    /* C5 反过来：计划确实是那天建的（真实老数据），那天的记录就该认 —— 别把该认的也砍掉 */
    const oldPlan = { id: new Date(oldDay + 'T07:00:00').getTime(), title: '收拾屋子', done: false };
    appData.todos = [oldPlan];
    appData.records = oldRecs.map(r => Object.assign({}, r, { todoId: null }));
    appData.__migration = { runs: [] };
    migrateRecordOwnership();
    ok('C5 计划建在当天 → 那天的同名记录照旧补挂（老账不丢）',
      appData.records.every(r => r.todoId === oldPlan.id));
    ok('C5b 补挂后 5 段都能读到', tbTodoSegList(oldPlan, oldDay).length === 5);
    /* C6 出生时刻不明的 id（非时间戳）→ 不猜，宁可不认 */
    appData.todos = [{ id: 700002, title: '收拾屋子', done: false }];
    appData.records = [Object.assign({}, oldRecs[0], { todoId: null })];
    appData.__migration = { runs: [] };
    migrateRecordOwnership();
    ok('C6 id 不是时间戳（出生时刻不明）→ 不认亲', appData.records[0].todoId === null);
    appData.todos = [todayNew];
    /* C4 已有 id 的一律不动 */
    appData.records = [Object.assign({}, sameDayRec, { todoId: createdTs })];
    appData.__migration = { runs: [] };
    migrateRecordOwnership();
    ok('C4 已有 todoId 的记录原样保留', appData.records[0].todoId === createdTs);

    /* ---- D 写时解析：同样只认唯一标题 ---- */
    appData.todos = [todayNew];
    ok('D1 唯一标题 → 解析到那条计划', tbResolveTodoByTitle('收拾屋子').id === createdTs);
    ok('D2 首尾空白不影响（规范化标题）', tbResolveTodoByTitle(' 收拾屋子 ').id === createdTs);
    /* 规范化只合并连续空白、去首尾；不删正文里的空格 —— 「收拾 屋子」与「收拾屋子」
       是两个名字，认成一个就会把两条不同计划的账混在一起。 */
    ok('D2b 中间有空格的标题不被认成同一个', tbResolveTodoByTitle('收拾 屋子') === null);
    appData.todos = [todayNew, twin];
    ok('D3 同名两条 → 不解析（宁可不关联也不记错账）', tbResolveTodoByTitle('收拾屋子') === null);
    ok('D4 空标题/不存在 → null',
      tbResolveTodoByTitle('') === null && tbResolveTodoByTitle('不存在') === null);
    /* D5 写时也查出生时刻：8:00 建的计划，7:30 就开始的那次专注不可能是它的 */
    appData.todos = [todayNew];
    ok('D5 起点早于创建时刻 → 不关联', tbResolveTodoByTitle('收拾屋子', createdTs - 1800000) === null);
    ok('D5b 起点晚于创建时刻 → 关联（唯一且已出生）',
      tbResolveTodoByTitle('收拾屋子', createdTs + 3600000).id === createdTs);

    /* ---- E 搁置天数只看这条计划自己的记录 ---- */
    appData.todos = [todayNew];
    appData.records = oldRecs.slice(); /* 全是无 todoId 的旧账 */
    const sigNoOwn = todoRowSig(todayNew, today);
    ok('E1 新计划的行签名里不含 7 天前的段', sigNoOwn.indexOf(String(oldRecs[0].startTime)) < 0);
    ok('E1b 没做过 → 不算搁置（0）', todoStallDays(todayNew, undefined, today) === 0);
    ok('E1c 旧账（无 todoId）不被当成"这条计划做过的"', tbTodoSegList(todayNew).length === 0);
    /* 挂上 id 后（= 这条计划真做过），搁置信息才允许出现 */
    const ownRec = Object.assign({}, oldRecs[0], { todoId: createdTs });
    appData.records = [ownRec];
    ok('E2 有自己的记录（todoId 命中）→ 搁置 7 天',
      todoStallDays(todayNew, ownRec.startTime, today) === 7);
    ok('E2b 搁置天数进了行签名（补挂 id 后行会重绘，不留旧状态）',
      todoRowSig(todayNew, today, ownRec.startTime) !== sigNoOwn);
    ok('E3 有 todoId 时不受日期边界限制（权威身份）', tbTodoSegList(todayNew).length === 1);

    /* ---- F 计划外灰块：没 id 就是计划外，跟名字无关 ---- */
    appData.todos = [todayNew];
    appData.records = [Object.assign({}, oldRecs[0], { todoId: null })];
    ok('F1 同名的自由专注画成灰块（不被新计划捡走，也不消失）',
      tbUnplannedSegments(appData.records, oldDay, [todayNew.id]).length === 1);
    appData.records = [Object.assign({}, oldRecs[0], { todoId: createdTs })];
    ok('F2 挂了 id 就不算计划外（同一段时间不会被画两次）',
      tbUnplannedSegments(appData.records, oldDay, [todayNew.id]).length === 0);
  } finally {
    appData.todos = bak.todos;
    appData.records = bak.records;
    appData.liveSessions = bak.live;
    appData.__migration = bak.mig;
  }
  return JSON.stringify(R);
})();
