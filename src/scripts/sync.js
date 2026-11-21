// @layer: L2
/* ============================================================
 * sync.js · 离线变更队列 + 同步适配器（2026-10-23） ｜症状：离线改动同步不上去 · 同步重复
 * ============================================================
 * 目标：**后端还没写，但同步这条链先跑通、先被测住。**
 *
 * 为什么先做队列而不是先做接口层：
 *   接后端时最痛的不是「怎么发请求」，是「离线期间改的东西怎么不丢、怎么不重复、
 *   怎么在冲突时不覆盖用户刚改的内容」。这三件事全在客户端，现在就能做完、能测。
 *   服务端只要实现 SyncAdapter 的两个方法（push / pull），其余代码一行不改。
 *
 * 组成：
 *   appData.outbox     变更队列 [{uid, kind, op, at}]，同 uid 合并、超限裁旧
 *   SyncAdapter        适配器接口，默认 noop（不发任何请求）
 *   syncNow()          推一次 + 拉一次 + 合并
 *   applyRemoteBatch() 合并远端数据（墓碑优先 + 记录级 LWW，规则在 00_pure_core）
 *
 * 三条不变量（C113 守）：
 *   ① 队列永不含重复 uid（同一记录只保留最后一次变更）
 *   ② push 失败时队列**不清空**（宁可重推，不能丢）
 *   ③ 只有 ack 里明确确认的 uid 才出队（不做「全清」，防止服务端半成功时丢变更）
 * 函数索引（TOC）：_outboxCap/_kindOfUid/enqueueChange/outboxAck/setSyncAdapter/_syncCursor/_setSyncCursor/_parentTodoOfChild/syncPayload/applyRemoteBatch/syncNow
 * ============================================================ */
const OUTBOX_MAX = 2000;              /* 启用同步时的队列上限（编辑风暴也够撑） */
const OUTBOX_MAX_IDLE = 200;          /* 未启用同步时只留最近 200 条：
                                         它此时只是"最近改过什么"的日志，留 2000 条等于
                                         每次 saveData 多序列化 ~120KB（localStorage 是同步 API）。 */

/* 当前该用哪个上限：适配器真的能推 或 有配对设备（/台数未知）时才放开到 2000。
   ★ 为什么「未知」也放开：pairedCount 来自原生回包（sync.info）。页面刚重载、
     回包还没到时它是 -1 —— 若此时按 200 算，用户一次大扫除改 300 条，
     最早的 100 条变更被静默裁掉（下一次只能靠指纹+全量补差捞回来）。
     裁掉的是**变更记录**而不是数据，所以宁可乐观留多。 */
function _outboxCap() {
  const ad = window.SyncAdapter;
  if (ad && ad.enabled !== false && ad.name !== 'noop') return OUTBOX_MAX;
  const bs = window.BottleSync;
  if (bs && typeof bs.paired === 'function') {
    const n = Number(bs.paired());
    if (!isFinite(n)) return OUTBOX_MAX;
    if (n === -1 || n > 0) return OUTBOX_MAX;
  }
  return OUTBOX_MAX_IDLE;
}
const SYNC_CURSOR_KEY = 'tomato_sync_cursor';

/* 从 uid 前缀推 kind（rec_/todo_/habit_/memo_/sub_/cd_/remind_）。
   好处：touchRecord 不用改签名，任何地方打戳都自动带上正确的类型。 */
function _kindOfUid(uid) {
  const s = String(uid || '');
  const i = s.indexOf('_');
  return i > 0 ? s.slice(0, i) : 'record';
}

/* 入队。合并规则走纯函数 outboxMerge（与单测同一份实现，不另写一遍）。 */
function enqueueChange(uid, kind, op) {
  if (!uid) return;
  if (!Array.isArray(appData.outbox)) appData.outbox = [];
  appData.outbox = outboxMerge(appData.outbox, uid, kind || _kindOfUid(uid), op || 'upsert', Date.now(), _outboxCap());
}

/* 出队：只移除服务端明确 ack 的 uid。
   ★ 不做「推送成功就全清」——服务端返回 200 但只落了一半时，全清就等于丢变更。 */
function outboxAck(uids) {
  if (!Array.isArray(uids) || !uids.length) return 0;
  if (!Array.isArray(appData.outbox)) { appData.outbox = []; return 0; }
  const ack = Object.create(null);   /* uid 来自服务端：避免 __proto__ 键让出队失效 */
  uids.forEach(function (u) { if (u) ack[String(u)] = 1; });
  const before = appData.outbox.length;
  appData.outbox = appData.outbox.filter(function (c) { return c && !ack[String(c.uid)]; });
  return before - appData.outbox.length;
}

/* ---- 适配器接口 ----------------------------------------------------------
 * 服务端接入时实现这两个方法即可，业务代码零改动：
 *   push({ changes, records, tombstones, cursor }) → Promise<{ ack: [uid], cursor }>
 *   pull(cursor)                                   → Promise<{ records, todos, tombstones, cursor }>
 * 默认 noop：ack 为空 → 队列不清空 → 下次上线继续推（不丢）。
 */
window.SyncAdapter = {
  name: 'noop',
  enabled: false,
  push: function () { return Promise.resolve({ ack: [], cursor: null }); },
  pull: function (cursor) { return Promise.resolve({ records: [], todos: [], tombstones: [], cursor: cursor }); }
};

function setSyncAdapter(adapter) {
  if (!adapter || typeof adapter.push !== 'function' || typeof adapter.pull !== 'function') {
    throw new Error('[sync] 适配器必须实现 push() 与 pull()');
  }
  window.SyncAdapter = adapter;
  appData.settings = appData.settings || {};
  appData.settings.syncEnabled = adapter.enabled !== false;
  return adapter;
}

function _syncCursor() {
  try { return JSON.parse(TFStorage.read(SYNC_CURSOR_KEY) || 'null'); } catch (e) { return null; }
}
function _setSyncCursor(c) {
  try { TFStorage.write(SYNC_CURSOR_KEY, JSON.stringify(c)); } catch (e) {
    /* 存不下只是下次多拉一点，不影响正确性；但仍要上报，否则配额满了用户永远查不到 */
    if (window.__silent) window.__silent(e, '01b3:cursor');
  }
}

/* 子任务 / 提醒是**嵌套**在待办里的（todos[].subs / todos[].reminds），
   它们自己不是顶层集合。推的时候必须换成「父待办的完整快照」——
   否则 changes 里有这个 uid、payload 里却没有数据，服务端只能静默忽略，
   表现为「子任务改了但另一台设备永远看不到」。 */
function _parentTodoOfChild(uid) {
  const list = appData.todos || [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t) continue;
    const kids = (t.subs || []).concat(t.reminds || []);
    for (let j = 0; j < kids.length; j++) {
      if (kids[j] && idEq(kids[j].uid, uid)) return t;
    }
  }
  return null;
}

/* 组装本次要推的东西：队列里每条 → 对应集合里的当前快照。
   已删除的记录在本地已经不存在了，只推墓碑（服务端据此删）。 */
function syncPayload() {
  const box = Array.isArray(appData.outbox) ? appData.outbox : [];
  /* 键名必须和 _kindOfUid 切出来的前缀一致：`lg_xxx` → 'lg'、`rv_xxx` → 'rv'。
     写成 'lifeGoal' / 'review' 永远命中不到，下面 `if (!pool) return;` 会静默丢弃。 */
  const byKind = {
    record: [], todo: [], habit: [], memo: [], cd: [], lg: [], rv: [],
    /* 2026-11 多端同步补齐的 5 类。漏一个的症状不是报错，而是「按另一种记录发出去」
       （下面没有回落分支了，所以现在是「静默不发」）：
         wf     → 周重点（旧代码把它塞进 records，对端会多出一条假专注记录）
         area   → 人生目标的分区       hcat → 习惯分类
         reward → 自定义奖励           wish → 愿望清单 */
    wf: [], area: [], hcat: [], reward: [], wish: []
  };
  const seen = { todo: Object.create(null) };
  const changes = [];

  const takeTodo = function (t) {
    if (!t || !t.uid) return;
    const k = String(t.uid);
    if (seen.todo[k]) return;
    seen.todo[k] = 1;
    byKind.todo.push(t);
  };

  box.forEach(function (c) {
    if (!c || !c.uid) return;
    changes.push({ uid: String(c.uid), kind: c.kind, op: c.op, at: c.at });
    if (c.op === 'delete') return;                     /* 删除只靠墓碑，不带快照 */
    const k = c.kind || 'record';

    /* 嵌套集合：转成父待办快照 */
    if (k === 'sub' || k === 'remind') { takeTodo(_parentTodoOfChild(c.uid)); return; }

    const pool = k === 'record' ? appData.records
      : k === 'todo' ? appData.todos
        : k === 'habit' ? appData.habits
          : k === 'memo' ? appData.memos
            : k === 'cd' ? appData.countdowns
              : k === 'lg' ? appData.lifeGoals
                : k === 'rv' ? appData.reviews
                  : k === 'wf' ? appData.weekFocus
                    : k === 'area' ? appData.lifeAreas
                      : k === 'hcat' ? appData.habitCats
                        : k === 'reward' ? appData.selfRewards
                          : k === 'wish' ? appData.wishes
                            : null;
    /* ★ 未知 kind 一律不发：旧版这里是 `(byKind[k] || byKind.record)`，
       于是 area_xxx 这种没登记的集合会被当成**专注记录**发给对端
       （多一条假记录，两端一致、无报错、指纹也看不出来）。 */
    if (!pool || !byKind[k]) return;
    for (let i = 0; i < pool.length; i++) {
      if (idEq(pool[i] && pool[i].uid, c.uid)) {
        if (k === 'todo') takeTodo(pool[i]);
        else byKind[k].push(pool[i]);
        break;
      }
    }
  });

  return {
    changes: changes,
    records: byKind.record,
    todos: byKind.todo,
    habits: byKind.habit,
    memos: byKind.memo,
    countdowns: byKind.cd,
    lifeGoals: byKind.lg,
    reviews: byKind.rv,
    weekFocus: byKind.wf,
    lifeAreas: byKind.area,
    habitCats: byKind.hcat,
    selfRewards: byKind.reward,
    wishes: byKind.wish,
    /* 墓碑不再整表带：P2P 走会话快照（sync_p2p 的 _p2pTombBatch），
       整表带上会让 42 批基线多传 5.9MB。字段保留（空数组）以兼容未来的后端适配器，
       那边仍可按需自己填。 */
    tombstones: [],
    cursor: _syncCursor()
  };
}

/* 合并远端一批数据。规则全部在纯函数层（mergeRemoteRecords / mergeKeyedMap / mergeSetMap /
   mergeTombstoneLists）：墓碑优先 → 记录级 LWW → 缺 uid 丢弃。这里只负责
   「落到 appData 上 + 保存 + 刷界面」。
   opts（第 2 参，可选）：{ skewMs, deferSave, deferRender, saveCtx }
     · skewMs     = 我的时钟域 − 对方的时钟域，透传给 mergeRemoteRecords（§10.2）
     · deferSave  = true 时不调 saveData()（分块同步每块都存一次 20MB 会卡死）
     · deferRender= true 时不重绘（会话内一次都不渲染，commit 时统一一次）
     · saveCtx    = 'sync' 时把 _saveCtx 置位，仅供「空写守卫的同步删除例外」
   ★ 三个开关互相独立；三个都缺省 = 与改动前逐字相同的行为。 */
function applyRemoteBatch(batch, opts) {
  if (!batch || typeof batch !== 'object') {
    return { records: 0, todos: 0, habits: 0, memos: 0, countdowns: 0, tombs: 0 };
  }
  const o = opts || {};
  const _saveCtxPrev = (typeof __set__saveCtx === 'function') ? _saveCtx : null;
  if (o.saveCtx === 'sync' && typeof __set__saveCtx === 'function') __set__saveCtx('sync');
  try {
    const tombs = mergeTombstoneLists(appData.tombstones, batch.tombstones, TOMBSTONE_MAX);
    const mopts = { skewMs: Number(o.skewMs) || 0 };
    /* ① 12 个数组集合：同一个合并器，逐个落地（漏一个 = 那一类永远同步不过来） */
    const r = mergeRemoteRecords(appData.records, batch.records, tombs, mopts);
    const t = mergeRemoteRecords(appData.todos, batch.todos, tombs, mopts);
    const h = mergeRemoteRecords(appData.habits, batch.habits, tombs, mopts);
    const m = mergeRemoteRecords(appData.memos, batch.memos, tombs, mopts);
    const c = mergeRemoteRecords(appData.countdowns, batch.countdowns, tombs, mopts);
    const lg = mergeRemoteRecords(appData.lifeGoals, batch.lifeGoals, tombs, mopts);
    const rv = mergeRemoteRecords(appData.reviews, batch.reviews, tombs, mopts);
    const wf = mergeRemoteRecords(appData.weekFocus, batch.weekFocus, tombs, mopts);
    const ar = mergeRemoteRecords(appData.lifeAreas, batch.lifeAreas, tombs, mopts);
    const hc = mergeRemoteRecords(appData.habitCats, batch.habitCats, tombs, mopts);
    const sr = mergeRemoteRecords(appData.selfRewards, batch.selfRewards, tombs, mopts);
    const wi = mergeRemoteRecords(appData.wishes, batch.wishes, tombs, mopts);

    appData.tombstones = tombs;
    appData.records = r.list;
    appData.todos = t.list;
    appData.habits = h.list;
    appData.memos = m.list;
    appData.countdowns = c.list;
    appData.lifeGoals = lg.list;
    appData.reviews = rv.list;
    appData.weekFocus = wf.list;
    appData.lifeAreas = ar.list;
    appData.habitCats = hc.list;
    appData.selfRewards = sr.list;
    if (Array.isArray(appData.wishes) || Array.isArray(batch.wishes)) appData.wishes = wi.list;

    /* ② 4 个映射集合。tombSet 必须与 mergeRemoteRecords 里那份 tombOf 同一份推导
       （各建一份一旦不同步，就会出现「记录集合删了、日记没删」的对不齐）。 */
    const tombSet = Object.create(null);
    tombs.forEach(function (x) { if (x && x.uid) tombSet[String(x.uid)] = 1; });

    if (!appData.mustDos || typeof appData.mustDos !== 'object' || Array.isArray(appData.mustDos)) appData.mustDos = {};
    if (!appData.mustDosAt || typeof appData.mustDosAt !== 'object' || Array.isArray(appData.mustDosAt)) appData.mustDosAt = {};
    if (!appData.diaries || typeof appData.diaries !== 'object' || Array.isArray(appData.diaries)) appData.diaries = {};

    /* mustDosAt 取两者的较大值：否则「本机改过一次」会被对端的旧时间戳盖回去 */
    if (batch.mustDosAt && typeof batch.mustDosAt === 'object' && !Array.isArray(batch.mustDosAt)) {
      Object.keys(batch.mustDosAt).forEach(function (k) {
        const remoteT = Number(batch.mustDosAt[k]) || 0;
        const localT = Number(appData.mustDosAt[k]) || 0;
        if (remoteT > localT) appData.mustDosAt[k] = remoteT;
      });
    }
    const dy = mergeKeyedMap(appData.diaries, batch.diaries,
      function (k) { return 'diary_' + k; },
      function (v) { return (v && Number(v.updatedAt)) || 0; }, tombSet);
    const md = mergeKeyedMap(appData.mustDos, batch.mustDos,
      function (k) { return 'must_' + k; },
      function (v, k) { return Number(appData.mustDosAt[k]) || 0; }, tombSet);
    appData.diaries = dy.map;
    appData.mustDos = md.map;

    /* 打卡 / 跳过：key 在负载里是习惯 uid，本机是 h.id —— 换 key 的活儿由
       sync_p2p 的 _p2pApplyHabitMap 统一负责（它还要处理「习惯还没到」的缓冲）。
       网页侧没有它时（例如只有 sync.js 的单测）退回并集，不静默丢数据。 */
    let hl = 0, hs = 0;
    if (typeof _p2pApplyHabitMap === 'function' && (batch.habitLogs || batch.habitSkips)) {
      hl = _p2pApplyHabitMap(batch.habitLogs, batch.habitSkips);
      hs = 0;
    } else {
      const l1 = mergeSetMap(appData.habitLogs, batch.habitLogs);
      const l2 = mergeSetMap(appData.habitSkips, batch.habitSkips);
      appData.habitLogs = l1.map;
      appData.habitSkips = l2.map;
      hl = l1.changed;
      hs = l2.changed;
    }

    const changed = r.added + r.updated + t.added + t.updated
      + h.added + h.updated + m.added + m.updated + c.added + c.updated
      + lg.added + lg.updated + rv.added + rv.updated + wf.added + wf.updated
      + ar.added + ar.updated + hc.added + hc.updated + sr.added + sr.updated + wi.added + wi.updated
      + dy.changed + md.changed + hl + hs;
    if (changed || (batch.tombstones && batch.tombstones.length)) {
      if (!o.deferSave) saveData();
      if (!o.deferRender) {
        try {
          invalidateStatsCache();
          if (typeof UIFX.renderTodos === 'function') UIFX.renderTodos();
          if (typeof UIFX.renderLogs === 'function') UIFX.renderLogs();
          if (typeof UIFX.updateTodayStats === 'function') UIFX.updateTodayStats();
          if (typeof UIFX.renderHabits === 'function') UIFX.renderHabits();
        } catch (e) { if (window.__silent) window.__silent(e, '01b3:render'); }
      }
    }
    return {
      records: r.added + r.updated, todos: t.added + t.updated,
      habits: h.added + h.updated, memos: m.added + m.updated, countdowns: c.added + c.updated,
      lifeGoals: lg.added + lg.updated, reviews: rv.added + rv.updated, weekFocus: wf.added + wf.updated,
      lifeAreas: ar.added + ar.updated, habitCats: hc.added + hc.updated,
      selfRewards: sr.added + sr.updated, wishes: wi.added + wi.updated,
      diaries: dy.changed, mustDos: md.changed, habitMaps: hl + hs,
      tombs: tombs.length,
      skipped: r.skipped + t.skipped + h.skipped + m.skipped + c.skipped + lg.skipped + rv.skipped
        + wf.skipped + ar.skipped + hc.skipped + sr.skipped + wi.skipped
    };
  } finally {
    /* _saveCtx 只在这一小段里是 'sync'：绝不外溢到 UI 路径（否则一次误清空能拿到例外） */
    if (o.saveCtx === 'sync' && typeof __set__saveCtx === 'function') __set__saveCtx(_saveCtxPrev);
  }
}

/* 同步一次：推 → ack 出队 → 拉 → 合并 → 存游标。
   ★ 任何一步失败都不清空队列（服务端没确认 ≠ 已送达）。
   ★ 并发保护：同一时刻只跑一次（定时器 + 手动触发的常见冲突）。 */
let _syncing = false;
function syncNow(opts) {
  const o = opts || {};
  if (_syncing) return Promise.resolve({ skipped: 'busy' });
  const ad = window.SyncAdapter;
  if (!ad || ad.enabled === false) return Promise.resolve({ skipped: 'disabled' });
  _syncing = true;
  const payload = syncPayload();
  if (!o.force && !payload.changes.length && !payload.cursor) {
    _syncing = false;
    return Promise.resolve({ skipped: 'empty' });
  }
  return Promise.resolve()
    .then(function () { return ad.push(payload); })
    .then(function (res) {
      const r = res || {};
      const acked = outboxAck(r.ack || []);
      return Promise.resolve()
        .then(function () { return ad.pull(r.cursor !== undefined ? r.cursor : payload.cursor); })
        .then(function (batch) {
          const applied = applyRemoteBatch(batch || {});
          if (batch && batch.cursor !== undefined) _setSyncCursor(batch.cursor);
          /* ★ 出队必须落盘：applyRemoteBatch 只在「拉到了变化」时才 saveData，
             服务端回「没有新数据」时出队只改了内存 → 重启后已送达的变更又回到队列，
             队列越滚越大、每次都重推一遍。 */
          if (acked > 0) saveData();
          _syncing = false;
          return { pushed: payload.changes.length, acked: acked, applied: applied };
        });
    })
    .catch(function (e) {
      _syncing = false;
      /* 失败保留队列：下次上线重推（幂等由服务端按 uid+updatedAt 保证） */
      if (window.__silent) window.__silent(e, '01b3:syncNow');
      return { error: String((e && e.message) || e), queued: (appData.outbox || []).length };
    });
}
