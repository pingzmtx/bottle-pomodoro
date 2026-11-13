/* C71 段落索引（性能）——加速不许改变语义
 *   背景：tbTodoSegList 原来每调一次就全表扫 records。待办页有 N 条计划就扫 N 遍，
 *   实测 6000 条记录 / 150 条计划时 renderTodos 536ms、统计页 1160ms —— 这正是
 *   「多年使用就卡」。改法：一次遍历建 Map<todoId, 段[]>，按 id 取桶（学 sp 的取数形状）。
 *
 *   ★ 缓存最大的风险不是慢，是**陈旧**：显示一条早就该更新的账，比慢 100ms 恶劣得多。
 *     所以本用例的核心是「对拍」：对同一份随机数据，索引取到的段必须与暴力直扫**逐项相同**；
 *     并且每一条写入路径（新增 / 删除 / 就地改写 segs / 整体替换）之后都必须看得到新值。
 *     A 对拍（随机 400 条记录 × 多计划 × 多日期）　B 写入后不陈旧　C 整体替换后不陈旧
 *     D 索引确实被复用（不然就只是把 O(N·M) 换个写法）　E 边界（无 id / 空 segs / 跨天）
 */
(function () {
  const R = [];
  const ok = (n, c) => R.push([n, !!c]);
  const bak = {
    todos: appData.todos,
    records: appData.records,
    live: appData.liveSessions
  };
  /* 暴力直扫：与被测实现完全独立的另一套写法（故意不复用 tbSegIndex） */
  function bruteSegList(t, dateStr) {
    const out = [];
    (appData.records || []).forEach(function (r) {
      if (!r || r.startTime == null || r.todoId == null) return;
      if (String(r.todoId) !== String(t.id)) return;
      const segs = (Array.isArray(r.segs) && r.segs.length)
        ? r.segs
        : [{ s: Number(r.startTime), e: Number(r.endTime) || 0 }];
      segs.forEach(function (sg) {
        if (!sg || !Number(sg.s)) return;
        if (dateStr && getDateStr(new Date(Number(sg.s))) !== dateStr) return;
        out.push({ s: Number(sg.s), e: Number(sg.e) || 0 });
      });
    });
    return out.sort(function (a, b) { return a.s - b.s; });
  }
  const norm = (a) => a.slice().sort(function (x, y) { return x.s - y.s; })
    .map(function (x) { return x.s + '~' + x.e; }).join(',');
  try {
    appData.liveSessions = [];

    /* ---------------- A 对拍 ---------------- */
    const todos = [];
    for (let i = 0; i < 8; i++) todos.push({ id: 880000 + i, title: 'T' + i, done: false, pomodoros: 1, subs: [] });
    const recs = [];
    const base = new Date(getTodayStr() + 'T00:00:00').getTime();
    /* 固定种子的伪随机（可复现，失败能重放） */
    let seed = 20261017;
    const rnd = function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 400; i++) {
      const dayOff = Math.floor(rnd() * 6);
      const st = base - dayOff * 86400000 + Math.floor(rnd() * 20) * 3600000;
      const nSeg = 1 + Math.floor(rnd() * 3);
      const segs = [];
      for (let k = 0; k < nSeg; k++) segs.push({ s: st + k * 1500000, e: st + k * 1500000 + 1500000 });
      const rec = { id: 770000 + i, taskName: 'T' + (i % 8), startTime: st, endTime: segs[nSeg - 1].e, segs: segs };
      /* 一部分挂 id、一部分计划外（todoId 缺失）、一部分 id 悬空（计划已删） */
      const roll = rnd();
      if (roll < 0.7) rec.todoId = 880000 + Math.floor(rnd() * 8);
      else if (roll < 0.85) rec.todoId = null;
      else rec.todoId = 999999;
      recs.push(rec);
    }
    appData.todos = todos;
    appData.records = recs;
    tbInvalidateSegIndex();

    let mismatch = 0;
    const days = {};
    for (let k = 0; k < 6; k++) days[getDateStr(new Date(base - k * 86400000))] = true;
    Object.keys(days).forEach(function (day) {
      todos.forEach(function (t) {
        const got = norm(tbTodoSegList(t, day, true));
        const want = norm(bruteSegList(t, day));
        if (got !== want) mismatch++;
      });
    });
    ok('A1 按天对拍：索引取段 == 暴力直扫（8 计划 × 6 天）', mismatch === 0);
    ok('A2 有真实段可对（不是空对空）',
      todos.some(function (t) { return tbTodoSegList(t, getTodayStr(), true).length > 0; }));
    let m2 = 0;
    todos.forEach(function (t) {
      if (norm(tbTodoSegList(t, null, true)) !== norm(bruteSegList(t, null))) m2++;
    });
    ok('A3 不传日期（全量）对拍一致', m2 === 0);

    /* ---------------- B 写入后不陈旧 ---------------- */
    const t0 = todos[0];
    const beforeN = tbTodoSegList(t0, null, true).length;
    const st = base + 3600000;
    appData.records.push({ id: 771111, todoId: t0.id, startTime: st, endTime: st + 1500000, segs: [{ s: st, e: st + 1500000 }] });
    tbInvalidateSegIndex();
    ok('B1 新增记录后立刻读得到（不陈旧）', tbTodoSegList(t0, null, true).length === beforeN + 1);
    ok('B2 新增的那段确实在里面',
      tbTodoSegList(t0, null, true).some(function (x) { return x.s === st; }));
    /* 删掉刚加的那条 */
    appData.records = appData.records.filter(function (r) { return r.id !== 771111; });
    ok('B3 删除记录后立刻消失（数组身份/长度变了就重建）',
      tbTodoSegList(t0, null, true).length === beforeN);
    /* 就地改 segs（长度不变）：只有显式失效才看得出变化 —— 这正是最容易漏的一种 */
    const target = appData.records.filter(function (r) { return String(r.todoId) === String(t0.id); })[0];
    const oldSegCount = tbTodoSegList(t0, null, true).length;
    if (target && target.segs && target.segs.length) {
      target.segs[0].e = target.segs[0].e + 600000; /* 只改结束时刻 */
      tbInvalidateSegIndex();
      const nowE = tbTodoSegList(t0, null, true).filter(function (x) { return x.s === target.segs[0].s; })[0];
      ok('B4 就地改写 segs 后（显式失效）读到新值', !!nowE && nowE.e === target.segs[0].e);
      ok('B5 就地改写没有改变段数', tbTodoSegList(t0, null, true).length === oldSegCount);
    } else {
      ok('B4 就地改写 segs 后（显式失效）读到新值', false);
      ok('B5 就地改写没有改变段数', false);
    }

    /* ---------------- C 整体替换（导入 / 恢复 / 回滚） ---------------- */
    appData.records = [{ id: 772222, todoId: t0.id, startTime: base, endTime: base + 600000, segs: [{ s: base, e: base + 600000 }] }];
    ok('C1 整体替换 records 后按新数组重建', tbTodoSegList(t0, null, true).length === 1);
    appData.records = [];
    ok('C2 清空后为 0', tbTodoSegList(t0, null, true).length === 0);

    /* ---------------- D 索引确实被复用 ---------------- */
    appData.records = recs.slice();
    tbInvalidateSegIndex();
    const i1 = tbSegIndex();
    const i2 = tbSegIndex();
    ok('D1 同一份数据重复取索引 → 同一个对象（复用，不重建）', i1 === i2);
    tbInvalidateSegIndex();
    ok('D2 显式失效后重建（不是同一个对象）', tbSegIndex() !== i1);
    ok('D3 重建后内容与失效前一致（只是重算，不改语义）',
      norm(tbTodoSegList(todos[1], null, true)) === norm(bruteSegList(todos[1], null)));

    /* ---------------- E 边界 ---------------- */
    appData.records = [
      { id: 773000, todoId: null, startTime: base, endTime: base + 600000 },              /* 无 id → 不属于任何计划 */
      { id: 773001, todoId: 880001, startTime: base, endTime: base + 600000, segs: [] },  /* 空 segs → 用起止兜底 */
      { id: 773002, todoId: 880001, startTime: base - 3000000, endTime: base, segs: [{ s: base - 3000000, e: base }] } /* 跨天 */
    ];
    tbInvalidateSegIndex();
    ok('E1 空 segs 用 startTime/endTime 兜底', tbTodoSegList(todos[1], null, true).length === 2);
    ok('E2 无 todoId 的记录不进任何计划', tbTodoSegList(todos[0], null, true).length === 0);
    ok('E3 对拍仍然一致', norm(tbTodoSegList(todos[1], null, true)) === norm(bruteSegList(todos[1], null)));
  } catch (e) {
    ok('用例无异常 ' + String(e && e.message), false);
  } finally {
    appData.todos = bak.todos;
    appData.records = bak.records;
    appData.liveSessions = bak.live;
    tbInvalidateSegIndex();
  }
  return JSON.stringify(R);
})();
