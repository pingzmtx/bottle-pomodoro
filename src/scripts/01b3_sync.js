/* ============================================================
 * 01b3_sync.js · 离线变更队列 + 同步适配器（2026-10-23）
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

/* 当前该用哪个上限：适配器真的能推时才放开到 2000。 */
function _outboxCap() {
  const ad = window.SyncAdapter;
  return (ad && ad.enabled !== false && ad.name !== 'noop') ? OUTBOX_MAX : OUTBOX_MAX_IDLE;
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
     写成 'lifeGoal' / 'review' 永远命中不到，下面 `if (!pool) return;` 会静默丢弃，
     而且 setSyncAdapter 目前无调用，一期测不出来，会潜伏到同步真正上线。 */
  const byKind = { record: [], todo: [], habit: [], memo: [], cd: [], lg: [], rv: [] };
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
                      : null;
    if (!pool) return;
    for (let i = 0; i < pool.length; i++) {
      if (idEq(pool[i] && pool[i].uid, c.uid)) {
        if (k === 'todo') takeTodo(pool[i]);
        else (byKind[k] || byKind.record).push(pool[i]);
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
    tombstones: Array.isArray(appData.tombstones) ? appData.tombstones : [],
    cursor: _syncCursor()
  };
}

/* 合并远端一批数据。规则全部在纯函数层（mergeRemoteRecords / mergeTombstoneLists）：
   墓碑优先 → 记录级 LWW → 缺 uid 丢弃。这里只负责「落到 appData 上 + 保存 + 刷界面」。 */
function applyRemoteBatch(batch) {
  if (!batch || typeof batch !== 'object') return { records: 0, todos: 0, tombs: 0 };
  const tombs = mergeTombstoneLists(appData.tombstones, batch.tombstones, TOMBSTONE_MAX);
  const r = mergeRemoteRecords(appData.records, batch.records, tombs);
  const t = mergeRemoteRecords(appData.todos, batch.todos, tombs);
  /* 生活习惯 / 备忘 / 倒计时同样是顶层集合：漏一个，那一类就永远同步不过来 */
  const h = mergeRemoteRecords(appData.habits, batch.habits, tombs);
  const m = mergeRemoteRecords(appData.memos, batch.memos, tombs);
  const c = mergeRemoteRecords(appData.countdowns, batch.countdowns, tombs);
  appData.tombstones = tombs;
  appData.records = r.list;
  appData.todos = t.list;
  appData.habits = h.list;
  appData.memos = m.list;
  appData.countdowns = c.list;
  const changed = r.added + r.updated + t.added + t.updated
    + h.added + h.updated + m.added + m.updated + c.added + c.updated;
  if (changed || (batch.tombstones && batch.tombstones.length)) {
    saveData();
    try {
      invalidateStatsCache();
      if (typeof UIFX.renderTodos === 'function') UIFX.renderTodos();
      if (typeof UIFX.renderLogs === 'function') UIFX.renderLogs();
      if (typeof UIFX.updateTodayStats === 'function') UIFX.updateTodayStats();
      if (typeof UIFX.renderHabits === 'function') UIFX.renderHabits();
    } catch (e) { if (window.__silent) window.__silent(e, '01b3:render'); }
  }
  return {
    records: r.added + r.updated, todos: t.added + t.updated,
    habits: h.added + h.updated, memos: m.added + m.updated, countdowns: c.added + c.updated,
    tombs: tombs.length, skipped: r.skipped + t.skipped + h.skipped + m.skipped + c.skipped
  };
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
