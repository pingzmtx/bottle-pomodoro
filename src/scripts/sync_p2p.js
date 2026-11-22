// @layer: L2
/* ============================================================
 * sync_p2p.js · 局域网直连同步的「网页数据层」（2026-11）
 * ------------------------------------------------------------
 * 职责边界（写死，别越界）：
 *   · 这里只做**数据**：取快照、切批、合并、算指纹、提交/回滚、墓碑通道、诊断。
 *   · 不碰 UI（本文件不含任何 render 调用，除了 _p2pFlushAndRender 里那一次收口），
 *     不碰原生（唯一的出口是 sync.reply / sync.log 两条桥命令），不开 socket。
 *   · 网页界面「一像素不改」：本文件不新增任何 DOM 结构、不发任何文案。
 *
 * ★★ 一条隐式契约（违反它会导致两台手机乒乓推）：
 *   **applyRemoteBatch 只做合并，绝不 touchRecord / 绝不 enqueueChange。**
 *   合并进来的远端记录一旦进了 outbox，下一轮就会被当成「本地新变更」推回去，
 *   对端再推回来 —— 两台机器永远在互推同一条记录。
 *
 * 会话状态的生命周期（§3.4-②、§19.10）：
 *   _p2pSessionBegin 建 → onEvent 各步用 → _p2pCommit / _p2pAbort 清。
 *   游标**不持久化**：宁可重传一遍，也不要出现「游标说发过、对端没收到」这种
 *   指纹也发现不了的静默漏批。
 *
 * 函数索引（TOC）：_p2pIsSelf/_p2pLog/_p2pDiag/_p2pPeers/_p2pPairedCount/_p2pReady/_p2pDataVersion/_p2pQueryInfo/_p2pBootstrapInfo/_p2pSessionBegin/_p2pTombFloor/_p2pTombBatch（+21 更多）
 *   _p2pSessionBegin/_p2pTombBatch/_p2pBuildOutboxBatch/_p2pCollectSince/_p2pApplyBatch/
 *   _p2pCommit/_p2pFlushAndRender/_p2pAbort/_p2pForgetPeer/_p2pResetPeer/_p2pPairCode/
 *   outboxPruneByWatermark/_p2pTombFloor/_p2pOnEvent/_p2pTestReset
 * 另一半在 sync_p2p_payload.js（快照切片 + 负载挂载 + 指纹 + 比对）：_p2pCollOfKind/
 *   _p2pSnapshotOf/_p2pMapSliceOf/_p2pMapByHabitUid/_p2pApplyHabitMap/_p2pFlushHabitMapPending/
 *   _p2pAttachSnapshot/_p2pDetach/_p2pAttachMapValue/_fpHash/_fpOfList/_fpOfMap/_fpAll/_fpTomb/
 *   _p2pCounts/_p2pFingerprint/_p2pCompare（拆文件是 tools/w6_size.py 的新文件 800 行红线，
 *   纯移动、不改一行逻辑）。
 * ============================================================ */

/* ===== 常量（全部具名，禁止在函数体里散落魔法数）===== */
var P2P_GUARD_MS = 3000;              /* 水位推进的安全带：T0 − 3000（§9.4） */
var P2P_PART_TARGET_BYTES = 512 * 1024; /* 单批目标字节（明文字节） */
var P2P_PART_MAX_RECORDS = 2000;      /* 单批最多记录数（与 outbox 上限同量级） */
var P2P_TOMB_BATCH_MAX_BYTES = 64 * 1024; /* 墓碑帧单片上限，超了分片（§7.3） */
/* 0.6.13：拉取方向的墓碑上限（约 400KB，仍在单帧 4MB 之内）。
   collect 只在一帧里顺带墓碑，不做分片 —— 超出就保留最新的这些，剩下的靠
   水位推进后下一轮再带（`deletedAt > since` 会自然缩小）。 */
var P2P_TOMB_IN_PULL_MAX = 6000;
var P2P_COMMIT_WAIT_MS = 3000;        /* 等 IDB 队列兑现的上限（§9.5 第 5 步） */
var P2P_DIAG_RING = 80;               /* 诊断环形缓冲条数 */
var P2P_INFO_RETRY_MAX = 60;          /* 数据就绪后向原生问 sync.info 的轮询次数上限 */

/* 16 个集合：12 数组 + 4 映射。顺序固定 —— 指纹与 collect 都按它走，两端必须逐字一致。 */
var FP_ARRAYS = ['records', 'todos', 'habits', 'memos', 'countdowns', 'lifeGoals', 'lifeAreas',
  'reviews', 'weekFocus', 'habitCats', 'selfRewards', 'wishes'];
var FP_MAPS = [['diaries', 'diary'], ['habitLogs', 'set'], ['habitSkips', 'set'], ['mustDos', 'daily']];
var FP_COLLECTIONS = FP_ARRAYS.concat(FP_MAPS.map(function (x) { return x[0]; }));

/* kind → 集合名（_kindOfUid 切出来的前缀就是这里的键） */
var P2P_KIND_COLL = {
  rec: 'records', record: 'records', todo: 'todos', habit: 'habits', memo: 'memos', cd: 'countdowns',
  lg: 'lifeGoals', rv: 'reviews', wf: 'weekFocus', area: 'lifeAreas', hcat: 'habitCats',
  reward: 'selfRewards', wish: 'wishes'
};
/* 映射集合的 kind（它们不在数组清单里，走 _p2pMapSliceOf / mergeKeyedMap / mergeSetMap） */
var P2P_KIND_MAP = { diary: 'diaries', mustdos: 'mustDos' };

/* ===== 模块级状态（都在会话内，会话结束即清）===== */
var _p2pSess = null;            /* {sid, peerId, endAt, tombSnap, cursors:{}, snaps:{}, seenParts:{}, dupCount} */
var _p2pPaired = -1;            /* -1 = 从未收到过 sync.info 的回包（未知）；_outboxCap 对未知取 2000 */
var _p2pInfoAsked = false;
var _p2pDiagRing = [];
var _p2pHabitMapPending = Object.create(null);  /* habitUid → {logs:[], skips:[]}，习惯还没到时先存 */
var _p2pSid = '';               /* 当前会话世代号（§13.17） */
var _p2pSelfDid = '';           /* 本机自己的 did（来自 sync.info 的 selfId，可能一直为空） */

/* 本机自己的 did 判定（§5.3 的去重前置条件）。
   原生侧收包第一件事就该丢弃 did == selfId，但「页面重载后白名单残留」「老 App
   把 self 塞进 peerChanged」都可能让一条 self 记录漏到网页层。这里再挡一道：
   self 不进 syncPeers、不计 dupCount、不计任何错 —— 否则会凭一条假记录
   给 outbox 造出一个「永远不推进的 peer」，裁剪逻辑从此再也不裁，队列无限涨。 */
function _p2pIsSelf(did) {
  var s = String(did || '');
  return !!s && !!_p2pSelfDid && s === _p2pSelfDid;
}

/* 唯一日志出口：native 的 sync.log 通道优先，其次 __errRep，最后 console。
   一行一次会话关键节点，固定 key=value（诊断靠它，不造第二套格式）。 */
function _p2pLog(line) {
  var s = 'sync ' + String(line == null ? '' : line);
  _p2pDiagRing.push({ at: Date.now(), line: s });
  if (_p2pDiagRing.length > P2P_DIAG_RING) _p2pDiagRing.shift();
  try {
    if (typeof window.__bottleBridge === 'object' && window.__bottleBridge
      && typeof window.__bottleBridge.call === 'function') {
      window.__bottleBridge.call('sync.log', { line: s });
      return;
    }
  } catch (e) { if (window.__silent) window.__silent(e, 'p2p:log'); }
  try {
    if (window.__errRep && typeof window.__errRep.silent === 'function') { window.__errRep.silent(s, 'sync'); return; }
  } catch (e2) { if (window.__silent) window.__silent(e2, 'p2p:log'); }
  try { console.log('[BottleSync] ' + s); } catch (e3) { if (window.__silent) window.__silent(e3, 'p2p:log'); }
}

/* 诊断出口（sync.diag 的网页侧）：最近 N 行日志 + 本次会话的关键字段 */
function _p2pDiag() {
  var sess = null;
  if (_p2pSess) {
    sess = {
      sid: _p2pSess.sid, peerId: _p2pSess.peerId, endAt: _p2pSess.endAt,
      tombSnapN: (_p2pSess.tombSnap || []).length, dupCount: _p2pSess.dupCount || 0,
      cursors: _p2pSess.cursors ? Object.keys(_p2pSess.cursors) : []
    };
  }
  return {
    recent: _p2pDiagRing.slice(-40).map(function (x) { return x.line; }),
    sess: sess,
    info: {
      ready: _p2pReady(), pairedCount: _p2pPaired, dataVersion: _p2pDataVersion(),
      tombCount: (appData.tombstones || []).length, outboxLen: (appData.outbox || []).length,
      fp: _fpAll()
    }
  };
}

function _p2pPeers() {
  if (!appData.syncPeers || typeof appData.syncPeers !== 'object' || Array.isArray(appData.syncPeers)) {
    appData.syncPeers = Object.create(null);
  }
  return appData.syncPeers;
}

/* 已配对设备数。**从未**收到 sync.info 回包时返回 -1（"未知"）——
   返回 0 会让 _outboxCap 把队列裁到 200（见 sync.js 的注释）。 */
function _p2pPairedCount() { return _p2pPaired; }

function _p2pReady() {
  return (typeof _dataLoaded !== 'undefined' && _dataLoaded === true)
    && !!appData && Array.isArray(appData.outbox);
}

function _p2pDataVersion() {
  try { return (typeof DATA_VERSION === 'string') ? DATA_VERSION : ''; } catch (e) { return ''; }
}

/* 向原生问一次 sync.info 并缓存 pairedCount。
   桥不可用（网页直接打开）时保持 -1 —— 不写 0，也不报错。 */
function _p2pQueryInfo() {
  var br = window.__bottleBridge;
  if (!br || typeof br.call !== 'function') return;
  try {
    var p = br.call('sync.info', {});
    if (p && typeof p.then === 'function') {
      p.then(function (r) {
        if (r && typeof r === 'object' && isFinite(Number(r.pairedCount))) _p2pPaired = Number(r.pairedCount);
        if (r && typeof r === 'object' && r.selfId) _p2pSelfDid = String(r.selfId);
      }, function () { /* 拿不到就保持未知 */ });
    } else if (p && typeof p === 'object' && isFinite(Number(p.pairedCount))) {
      _p2pPaired = Number(p.pairedCount);
      if (p.selfId) _p2pSelfDid = String(p.selfId);
    }
  } catch (e) { if (window.__silent) window.__silent(e, 'p2p:info'); }
}

/* 数据加载完成后**显式**问一次 sync.info（§15.1 的 P1-1）：
   不等它 → pairedCount 恒为 -1 → 我们乐观按 2000 处理（不会丢变更），
   但配对数为 0 时会多留 1800 条队列（体积成本，可接受）。
   轮询上限 60 次（约 30s），到点就放弃 —— 绝不无限 setTimeout。 */
function _p2pBootstrapInfo(n) {
  var tries = Number(n) || 0;
  if (_p2pReady()) {
    if (!_p2pInfoAsked) { _p2pInfoAsked = true; _p2pQueryInfo(); }
    return;
  }
  if (tries >= P2P_INFO_RETRY_MAX) return;
  setTimeout(function () { _p2pBootstrapInfo(tries + 1); }, 500);
}

/* ===== 快照切片（_p2pCollOfKind / _p2pSnapshotOf / _p2pMapSliceOf / _p2pMapByHabitUid /
 * _p2pApplyHabitMap / _p2pFlushHabitMapPending）住在 sync_p2p_payload.js ——
 * 与「负载挂载 + 指纹」同一个职责域，这边只调用。 ===== */

/* ===== 会话 ===== */
function _p2pSessionBegin(peerId, sid) {
  var peer = String(peerId || '');
  _p2pSess = {
    sid: String(sid || ''),
    peerId: peer,
    endAt: -1,                    /* -1 = 不限；真实上界由 ev=collect 的入参决定 */
    tombSnap: (Array.isArray(appData.tombstones) ? appData.tombstones : []).slice(), /* 会话快照 */
    cursors: Object.create(null), /* 'push' / 'pull' */
    snaps: Object.create(null),   /* 首次 build/collect 时挂上的有序快照 */
    keys: Object.create(null),    /* cursor.key 的固定值 */
    seenParts: Object.create(null),
    dupCount: 0,
    asideAt: Date.now()
  };
  _p2pHabitMapPending = Object.create(null);
  var wm = Number((_p2pPeers()[peer] || {}).watermark) || 0;
  _p2pLog('sess=' + _p2pSess.sid + ' ev=begin peer=' + peer + ' wm=' + wm + ' tombSnapN=' + _p2pSess.tombSnap.length);
  return {
    ok: true,
    wmLocal: wm,
    tombFloor: _p2pTombFloor(),
    tombSnapN: _p2pSess.tombSnap.length
  };
}

function _p2pTombFloor() {
  var list = Array.isArray(appData.tombstones) ? appData.tombstones : [];
  var min = 0;
  for (var i = 0; i < list.length; i++) {
    var d = Number(list[i] && list[i].deletedAt) || 0;
    if (!min || d < min) min = d;
  }
  return min;
}

/* 墓碑帧：**首帧必带**（§7.3 规则 1），超 64KiB 分片（规则 1 的分片形式）。
 * 取用规则（写死）：
 *   ① 本会话的墓碑集合 = 会话开始时的**整份快照**（tombSnap），不受 since 过滤；
 *   ② outbox 里 op:'delete' 的条目**强制携带**其 uid 的墓碑（即使不在快照里 —— 那是
 *      本会话期间新产生的删除，必须本次送到，否则水位一推进就永远送不出去）。
 * 为什么不能按 `deletedAt > since` 过滤：一旦 since 偏大一格，那条删除就永远发不出去，
 * 对端记录复活、指纹看不出来（墓碑不参与 equal）→ 演化成永久 FAILED_DIVERGED。
 * cursor = {idx, part}；idx 是**本帧起点在待发列表里的下标**，只增不减。 */
function _p2pTombBatch(cursor) {
  var cur = cursor && typeof cursor === 'object' ? cursor : {};
  var idx = Math.max(0, Math.floor(Number(cur.idx) || 0));
  var key = 'T' + (_p2pSess ? _p2pSess.sid : '');
  if (cur.key && String(cur.key) !== key) throw new Error('E_STATE');
  var list = _p2pTombList();
  var out = [];
  var bytes = 0;
  var i = idx;
  for (; i < list.length; i++) {
    var one = JSON.stringify(list[i]);
    /* +1 是分隔逗号：JSON.stringify(整帧) 会比逐条长度之和多出 (n−1) 个逗号，
       不把它算进去就会出现「每片 64KiB、整帧 65KiB」的越界。 */
    if (out.length && bytes + one.length + 1 > P2P_TOMB_BATCH_MAX_BYTES) break;
    out.push(list[i]);
    bytes += one.length + 1;
  }
  var last = i >= list.length;
  return {
    payload: { tombstones: out, part: Math.max(0, Math.floor(Number(cur.part) || 0)), last: last },
    last: last,
    count: out.length,
    nextCursor: { kind: 'tomb', key: key, idx: i, part: Math.max(0, Math.floor(Number(cur.part) || 0)) + 1, endAt: 0 },
    total: list.length
  };
}

/* 待发墓碑列表（去重、稳定顺序）：会话快照 ∪ outbox 里的 delete 条目。 */
function _p2pTombList() {
  var map = Object.create(null);
  var out = [];
  function push(t) {
    if (!t || !t.uid) return;
    var k = String(t.uid);
    if (map[k]) return;
    map[k] = 1;
    out.push({ uid: k, kind: t.kind || 'record', deletedAt: Number(t.deletedAt) || 0 });
  }
  var snap = (_p2pSess && Array.isArray(_p2pSess.tombSnap)) ? _p2pSess.tombSnap : (appData.tombstones || []);
  snap.forEach(push);
  (Array.isArray(appData.outbox) ? appData.outbox : []).forEach(function (c) {
    if (!c || c.op !== 'delete' || !c.uid) return;
    if (!map[String(c.uid)]) push({ uid: c.uid, kind: c.kind, deletedAt: Number(c.at) || Date.now() });
  });
  return out;
}

/* PUSH 方向：按 outbox 造批。
 * cursor = {kind:'push', key, idx, part, endAt:0}
 *   · 首次调用时把「outbox 的有序快照」挂在会话上，之后**只信 idx**，绝不重扫
 *     （重扫会让第 2 批重复第 1 批：切分依赖 maxBytes，重扫结果不保证一致）。
 *   · key 不符 → throw E_STATE（静默重扫是「重复批」的根源）。 */
function _p2pBuildOutboxBatch(peerId, cursor, maxBytes) {
  var cur = cursor && typeof cursor === 'object' ? cursor : {};
  if (!_p2pSess) throw new Error('E_STATE');
  var key = String(cur.key || '');
  if (!key) key = 'S' + Date.now();
  if (_p2pSess.keys.push && _p2pSess.keys.push !== key) throw new Error('E_STATE');
  _p2pSess.keys.push = key;
  if (!_p2pSess.snaps.push) {
    /* 快照 = outbox 当前的 uid 列表（去重；delete 条目只带墓碑，不带快照） */
    var seen = Object.create(null), list = [];
    (Array.isArray(appData.outbox) ? appData.outbox : []).forEach(function (c) {
      if (!c || !c.uid) return;
      var k = String(c.uid);
      if (seen[k]) return;
      seen[k] = 1;
      list.push({ uid: k, kind: c.kind || (typeof _kindOfUid === 'function' ? _kindOfUid(c.uid) : 'record'), op: c.op || 'upsert' });
    });
    _p2pSess.snaps.push = list;
  }
  var snap = _p2pSess.snaps.push;
  var idx = Math.max(0, Math.floor(Number(cur.idx) || 0));
  var limit = Number(maxBytes) > 0 ? Number(maxBytes) : P2P_PART_TARGET_BYTES;
  var payload = _p2pEmptyPayload();
  var bytes = 0, count = 0;
  var i = idx;
  for (; i < snap.length; i++) {
    if (count >= P2P_PART_MAX_RECORDS) break;
    var item = snap[i];
    var add = _p2pAttachSnapshot(payload, item.uid, item.kind);
    if (!add) continue;                        /* 快照取不到（记录已删/未知 kind）：跳过，不发 */
    var sz = add.bytes;
    if (count > 0 && bytes + sz > limit) { _p2pDetach(payload, add); break; }
    bytes += sz;
    count++;
  }
  var last = i >= snap.length;
  payload.part = Math.max(0, Math.floor(Number(cur.part) || 0));
  payload.last = last;
  return {
    payload: payload, last: last, count: count,
    nextCursor: { kind: 'push', key: key, idx: i, part: payload.part + 1, endAt: 0 },
    total: snap.length
  };
}

function _p2pEmptyPayload() {
  return {
    part: 0, last: true, changes: [],
    records: [], todos: [], habits: [], memos: [], countdowns: [], lifeGoals: [], lifeAreas: [],
    reviews: [], weekFocus: [], habitCats: [], selfRewards: [], wishes: [],
    diaries: {}, habitLogs: {}, habitSkips: {}, mustDos: {}, mustDosAt: {},
    tombstones: []
  };
}

/* 负载挂载 / 回退（_p2pAttachSnapshot / _p2pDetach / _p2pAttachMapValue）
   住在 sync_p2p_payload.js：与快照切片同一职责域。 */

/* PULL 方向：从集合扫描造批。
 *   · 只返回 `updatedAt > since` **且** `updatedAt <= endAt` 的记录（endAt === -1 = 不限）；
 *   · 首次调用挂快照，之后只信 idx（会话内扫描集固定 → 游标单调可续）；
 *   · key = cols.join('+')，不符 → E_STATE。 */
function _p2pCollectSince(peerId, since, cols, cursor, maxBytes) {
  var cur = cursor && typeof cursor === 'object' ? cursor : {};
  if (!_p2pSess) throw new Error('E_STATE');
  var from = Number(since) || 0;
  var endAt = (cur.endAt === undefined || cur.endAt === null) ? _p2pSess.endAt : Number(cur.endAt);
  if (endAt === undefined) endAt = -1;
  var list = _p2pNormalizeCols(cols);
  var key = list.slice().sort().join('+');
  if (cur.key && String(cur.key) !== key) throw new Error('E_STATE');
  if (_p2pSess.keys.pull && _p2pSess.keys.pull !== key) throw new Error('E_STATE');
  _p2pSess.keys.pull = key;
  if (!_p2pSess.snaps.pull || _p2pSess.snaps.pull.key !== key) {
    _p2pSess.snaps.pull = { key: key, items: _p2pScanSince(from, endAt, list) };
  }
  var snap = _p2pSess.snaps.pull.items;
  var idx = Math.max(0, Math.floor(Number(cur.idx) || 0));
  var limit = Number(maxBytes) > 0 ? Number(maxBytes) : P2P_PART_TARGET_BYTES;
  var payload = _p2pEmptyPayload();
  /* 0.6.13（真机 FAILED_DIVERGED 的第二个根因）：**拉取方向也必须带墓碑**。
     墓碑原先只走 push 方向的 `tomb` 帧，而应答方没有 push 通道 —— 它删过的记录
     永远传不到发起方。于是 A 那条删不掉的记录让两端指纹永久不等，界面就是
     「两端数据没有完全对上」，而且点多少次重试都一样（每次都在同一个地方卡住）。
     `applyRemoteBatch` 早就认 `batch.tombstones`（mergeTombstoneLists），
     空负载里也有这个键，这里只是把第一帧填上 —— 协议一个字都不用改。
     只带 `deletedAt > since` 的：更早的删除，对方在自己的水位里已经知道了。
     超过上限就按 deletedAt 降序截断（保留最新的：越新越可能还没传过去）。 */
  if (idx === 0) {
    var src = Array.isArray(appData.tombstones) ? appData.tombstones : [];
    var tombs = [];
    for (var ti = 0; ti < src.length; ti++) {
      var tt = src[ti];
      if (!tt || !tt.uid) continue;
      if ((Number(tt.deletedAt) || 0) <= from) continue;
      tombs.push(tt);
    }
    if (tombs.length > P2P_TOMB_IN_PULL_MAX) {
      tombs.sort(function (a, b) {
        return (Number(b.deletedAt) || 0) - (Number(a.deletedAt) || 0);
      });
      tombs = tombs.slice(0, P2P_TOMB_IN_PULL_MAX);
    }
    payload.tombstones = tombs;
    if (tombs.length) {
      _p2pLog('pull tombs=' + tombs.length + '/' + src.length + ' since=' + from);
    }
  }
  var bytes = 0, count = 0, i = idx;
  for (; i < snap.length; i++) {
    if (count >= P2P_PART_MAX_RECORDS) break;
    var it = snap[i];
    var add = null;
    if (it.type === 'array') add = _p2pAttachSnapshot(payload, it.uid, it.kind);
    else add = _p2pAttachMapValue(payload, it);
    if (!add) continue;
    if (count > 0 && bytes + add.bytes > limit) { _p2pDetach(payload, add); break; }
    bytes += add.bytes;
    count++;
  }
  var last = i >= snap.length;
  payload.part = Math.max(0, Math.floor(Number(cur.part) || 0));
  payload.last = last;
  return {
    payload: payload, last: last, count: count,
    nextCursor: { kind: 'pull', key: key, idx: i, part: payload.part + 1, endAt: endAt },
    total: snap.length
  };
}

function _p2pNormalizeCols(cols) {
  if (!cols || cols === '*' || (Array.isArray(cols) && !cols.length)) return FP_COLLECTIONS.slice();
  var arr = Array.isArray(cols) ? cols : [cols];
  var out = [];
  arr.forEach(function (c) {
    var n = String(c || '');
    if (FP_COLLECTIONS.indexOf(n) >= 0 && out.indexOf(n) < 0) out.push(n);
  });
  return out.length ? out : FP_COLLECTIONS.slice();
}

/* 扫描 16 个集合里 updatedAt ∈ (since, endAt] 的记录。
   顺序固定（集合顺序 → 记录按 uid 升序），两端算出的切片才可复现。 */
function _p2pScanSince(since, endAt, cols) {
  var out = [];
  var unlimited = (endAt === -1 || endAt === null || endAt === undefined);
  function inRange(ts) {
    var t = Number(ts) || 0;
    if (t <= since) return false;
    if (!unlimited && t > Number(endAt)) return false;
    return true;
  }
  cols.forEach(function (name) {
    if (FP_ARRAYS.indexOf(name) >= 0) {
      var list = Array.isArray(appData[name]) ? appData[name] : [];
      var tmp = [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (!r || !r.uid) continue;
        if (!inRange(r.updatedAt)) continue;
        tmp.push({ type: 'array', kind: _p2pKindOfColl(name), uid: String(r.uid) });
      }
      tmp.sort(function (a, b) { return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0; });
      out = out.concat(tmp);
      return;
    }
    if (name === 'diaries') {
      var dm = appData.diaries && typeof appData.diaries === 'object' ? appData.diaries : {};
      var dk = Object.keys(dm).sort();
      dk.forEach(function (d) {
        var v = dm[d];
        if (!v || typeof v !== 'object') return;
        if (!inRange(v.updatedAt)) return;
        out.push({ type: 'map', coll: 'diaries', key: d, value: v, ts: Number(v.updatedAt) || 0 });
      });
      return;
    }
    if (name === 'mustDos') {
      var mm = appData.mustDos && typeof appData.mustDos === 'object' ? appData.mustDos : {};
      Object.keys(mm).sort().forEach(function (d) {
        var v = mm[d];
        if (!Array.isArray(v) || !v.length) return;
        var ts = Number((appData.mustDosAt || {})[d]) || 0;
        if (!inRange(ts)) return;
        out.push({ type: 'map', coll: 'mustDos', key: d, value: v, ts: ts });
      });
      return;
    }
    /* habitLogs / habitSkips：没有自己的时间戳，跟随「习惯记录」的 updatedAt ——
       习惯在范围内就带上它的打卡/跳过切片（否则第一次基线传不过去打勾记录）。 */
    if (name === 'habitLogs' || name === 'habitSkips') {
      var src = appData[name];
      var byUid = _p2pMapByHabitUid(src);
      var list2 = Array.isArray(appData.habits) ? appData.habits : [];
      var seenUid = Object.create(null);
      list2.forEach(function (h) {
        if (!h || !h.uid) return;
        if (!inRange(h.updatedAt)) return;
        var hu = String(h.uid);
        var kk = name + ':' + hu;
        if (seenUid[kk]) return;
        seenUid[kk] = 1;
        if (!Array.isArray(byUid[hu]) || !byUid[hu].length) return;
        out.push({ type: 'map', coll: name, key: hu, value: byUid[hu], ts: Number(h.updatedAt) || 0 });
      });
    }
  });
  return out;
}

function _p2pKindOfColl(name) {
  var k = '';
  Object.keys(P2P_KIND_COLL).forEach(function (kk) { if (P2P_KIND_COLL[kk] === name && !k) k = kk; });
  /* 反向映射取「规范前缀」：records → rec，todos → todo，countdowns → cd … */
  if (name === 'records') return 'rec';
  if (name === 'todos') return 'todo';
  if (name === 'countdowns') return 'cd';
  return k || 'rec';
}

/* APPLY 方向：把一批负载并进本地。
 *   · part 去重（同一批重复送 100 次也只算一次，且不判 E_BAD_FRAME）；
 *   · 合并只走 applyRemoteBatch（它内部只合并、不打戳、不入队 —— §9.6 不回环）；
 *   · 每批之后刷一次 habit 缓冲；last 时 commit 前还会再刷一次。 */
function _p2pApplyBatch(peerId, jsonText, skewMs, last, opts) {
  var batch = jsonText;
  if (typeof jsonText === 'string') {
    try { batch = JSON.parse(jsonText); } catch (e) { throw new Error('E_BAD_FRAME'); }
  }
  if (!batch || typeof batch !== 'object') throw new Error('E_BAD_FRAME');
  var o = opts || {};
  var part = Math.floor(Number(batch.part) || 0);
  var dup = false;
  if (_p2pSess) {
    var pk = String(peerId || '') + ':' + part;
    if (_p2pSess.seenParts[pk]) { dup = true; _p2pSess.dupCount = (_p2pSess.dupCount || 0) + 1; }
    else _p2pSess.seenParts[pk] = 1;
  }
  if (dup) return { applied: {}, ack: [], dup: true };
  var r = applyRemoteBatch(batch, {
    skewMs: Number(skewMs) || 0,
    deferSave: !!o.deferSave,
    deferRender: !!o.deferRender,
    saveCtx: 'sync'
  });
  /* 习惯晚到 / 早到都能落地：每批之后把「现在能找到习惯」的缓冲刷掉 */
  var hm = _p2pFlushHabitMapPending();
  if (hm) r.habitMaps = (r.habitMaps || 0) + hm;
  var ack = [];
  (batch.changes || []).forEach(function (c) { if (c && c.uid) ack.push(String(c.uid)); });
  return { applied: r, ack: ack, dup: false, last: !!last };
}

/* ===== 指纹（§9.7）住在 sync_p2p_payload.js =====
 * _fpHash / _fpOfList / _fpOfMap / _fpAll / _fpTomb / _p2pCounts / _p2pFingerprint /
 * _p2pCompare —— 与「快照切片 + 负载挂载」同一职责域，这边只调用。
 * ★ 契约不变：_fpAll 里不做任何时钟偏移换算；equal 只看 fp + counts。
 */

/* ===== 提交点（§9.5）=====
 * 水位的唯一判据：equal === true 且 本端 commit 落盘成功。
 * 落盘失败（not-ready / json-fail / empty-blocked / stale / clearing）→ 回滚水位 + 再存一次。
 * 'quota' / 'idb-pending' 视为成功（数据以 IndexedDB 为准）。
 * ★ stale 不是「回滚后继续」：它意味着页面马上要换代，会话必须按失败处理。 */
var P2P_COMMIT_FAIL = { 'not-ready': 1, 'json-fail': 1, 'empty-blocked': 1, 'stale': 1, 'clearing': 1 };

/* 本端还能不能把「删除凭据」补给这个 peer：最早一条墓碑晚于对方水位
   → 对方从没听过这条删除，而凭据可能已经被裁掉了 = 有损（§7.3 规则 4、C41）。
   调用方不显式传 tombLossy 时由 _p2pCommit 用这个函数现算，避免两处各写一遍判据。 */
function _p2pTombLossy(wm) {
  var floor = _p2pTombFloor();
  return !!floor && Number(wm) < floor;
}

function _p2pCommit(peerId, wm, tombLossy) {
  var peer = String(peerId || '');
  var peers = _p2pPeers();
  var prev = peers[peer] && typeof peers[peer] === 'object' ? Object.assign({}, peers[peer]) : {};
  var newWm = Number(wm) || 0;
  /* tombLossy 由调用方给就用它的，不给就按「最早墓碑 vs 对方水位」现算（C41）。 */
  var lossy = (tombLossy === undefined || tombLossy === null) ? _p2pTombLossy(newWm) : !!tombLossy;
  /* 数据与水印同一次 JSON.stringify 落盘：不存在「水印进了、数据没进」的中间态 */
  peers[peer] = {
    watermark: newWm,
    offset: Number(prev.offset) || 0,
    lastAt: Date.now(),
    tombLossy: lossy
  };
  _p2pFlushHabitMapPending();
  var status = 'ok';
  /* 置位一律走数据层的写入口（ESM 产物里 _saveCtx 是只读 import，直接赋值会抛） */
  var _prevCtx = __set__saveCtx('sync');
  try {
    status = saveDataNow();
  } finally {
    __set__saveCtx(_prevCtx);
  }
  if (P2P_COMMIT_FAIL[status]) {
    peers[peer] = prev;                            /* 回滚水位（业务数据不回滚：合并是幂等的） */
    try {
      __set__saveCtx('sync');
      saveDataNow();
    } finally { __set__saveCtx(_prevCtx); }
    _p2pLog('sess=' + _p2pSid + ' ev=commit status=' + status + ' wm=rollback outboxLeft=' + (appData.outbox || []).length);
    return Promise.resolve({ committed: false, status: status, outboxLeft: (appData.outbox || []).length });
  }
  /* 等 IDB 队列兑现：false 只降级成 'idb-pending'（仍算提交成功），不阻塞 3s 以上 */
  return waitSaveQueue(P2P_COMMIT_WAIT_MS).then(function (okp) {
    var st = status;
    if (!okp) {
      st = 'idb-pending';
      try {
        if (window.__errRep) window.__errRep.warn('sync', 'IDB 队列未在 3s 内兑现');
      } catch (e) { if (window.__silent) window.__silent(e, 'p2p:commit'); }
    }
    var left = outboxPruneByWatermark();
    _p2pLog('sess=' + _p2pSid + ' ev=commit status=' + st + ' wm=' + newWm + ' outboxLeft=' + (appData.outbox || []).length);
    return { committed: true, status: st, outboxLeft: (appData.outbox || []).length, pruned: left };
  });
}

/* outbox 按水位裁剪（不是按 ack）：三台设备时「B ack 了就出队」会把 C 饿死。
   uid 出队 ⟺ 每个已配对 peer 都越过了这条变更（wm >= entry.at）。 */
function outboxPruneByWatermark() {
  var list = Array.isArray(appData.outbox) ? appData.outbox : [];
  var peers = _p2pPeers();
  var wms = [];
  Object.keys(peers).forEach(function (k) {
    var p = peers[k];
    if (p && typeof p === 'object') wms.push(Number(p.watermark) || 0);
  });
  if (!wms.length) return 0;                      /* 没有 peer：无从确认，全留（上限由 outboxMerge 管） */
  var before = list.length;
  appData.outbox = list.filter(function (c) {
    if (!c) return false;
    var at = Number(c.at) || 0;
    return wms.some(function (w) { return w < at; });   /* 还有人没收到 → 留着 */
  });
  return before - appData.outbox.length;
}

/* 统一落盘 + 一次全量渲染（commit 与 abort 共用同一段，绝不各写一份）。
   为什么 abort 也要渲染：deferRender 保证会话内一次都没重绘，若中止时也不渲染，
   用户回到主界面看到的是「同步前的旧数据」，而盘上其实已经有 3 万条了。 */
function _p2pFlushAndRender() {
  var status = 'ok';
  var prev = __set__saveCtx('sync');
  try { status = saveDataNow(); } finally { __set__saveCtx(prev); }
  try {
    if (typeof invalidateStatsCache === 'function') invalidateStatsCache();
    if (typeof UIFX === 'object' && UIFX) {
      if (typeof UIFX.renderTodos === 'function') UIFX.renderTodos();
      if (typeof UIFX.renderLogs === 'function') UIFX.renderLogs();
      if (typeof UIFX.updateTodayStats === 'function') UIFX.updateTodayStats();
      if (typeof UIFX.renderHabits === 'function') UIFX.renderHabits();
    }
  } catch (e) { if (window.__silent) window.__silent(e, 'p2p:flush'); }
  return status;
}

/* 中止：两档（§13.18）。
   flush 默认 true → saveDataNow + 渲染（**不写水位**）；
   cancelReason 非空且不是 'yield' → 不 flush 不渲染（用户亲手取消，别把他的界面翻一遍）。 */
function _p2pAbort(peerId, opts) {
  var o = opts || {};
  var reason = String(o.reason || '');
  var cancel = !!reason && reason !== 'yield';
  var wantFlush = (o.flush === undefined) ? true : !!o.flush;
  var flushed = false, status = 'skipped';
  if (wantFlush && !cancel) {
    status = _p2pFlushAndRender();
    flushed = true;
  }
  _p2pLog('sess=' + _p2pSid + ' ev=abort peer=' + String(peerId || '') + ' reason=' + (reason || '-')
    + ' flush=' + (flushed ? 1 : 0) + ' status=' + status);
  /* 清会话状态（游标只活在会话内，不持久化） */
  _p2pSess = null;
  _p2pHabitMapPending = Object.create(null);
  _p2pSid = '';
  return { flushed: flushed, status: status };
}

/* 解除配对：删掉这个 peer 的全部同步状态（否则旧水位会被复用 —— 对方可能已经换机） */
function _p2pForgetPeer(peerId) {
  var peers = _p2pPeers();
  var k = String(peerId || '');
  if (Object.prototype.hasOwnProperty.call(peers, k)) delete peers[k];
  var status = saveDataNow();
  _p2pLog('ev=forget peer=' + k + ' status=' + status);
  return { forgotten: true, status: status };
}

/* 重置同步状态（§14.5 的逃生门）：只删 watermark / offset / tombLossy，
   **不动任何业务数据**。下一场会做一次全量比对（代价是一次全量传输，换来能脱困）。 */
function _p2pResetPeer(peerId) {
  var peers = _p2pPeers();
  var k = String(peerId || '');
  var p = peers[k];
  if (p && typeof p === 'object') {
    delete p.watermark;
    delete p.offset;
    delete p.tombLossy;
  }
  var status = saveDataNow();
  _p2pLog('ev=reset peer=' + k + ' status=' + status);
  return { reset: true, status: status };
}

/* 配对码（仅诊断面板复算用，不参与协议）：FNV-1a 32 → %9000 + 1000，四位无前导零。
   跨语言常量：pairCode("a3f19c2e5b7d4018","c97c5d51405e3538") === "4172"。 */
function _p2pPairCode(aNonce, bNonce) {
  var h = 0x811c9dc5;
  var s = String(aNonce || '') + String(bNonce || '');
  for (var i = 0; i < s.length; i++) {
    h ^= (s.charCodeAt(i) & 0xffff);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  var n = (h >>> 0) % 9000 + 1000;
  return String(n);
}

/* ===== 原生 → JS 的唯一入口 =====
 * 第一件事判 sid（§13.17）：页面在会话中途被重载过 → 世代号对不上 →
 * 直接回 {ok:false,error:'E_STALE_SID'}，**不做任何动作**（连游标都不碰）。
 * "重置后继续"在这套设计里没有意义：页面换代了，appData 都重读了，
 * 继续用旧游标才是灾难（那正是「第 2 批重复第 1 批」的来源）。 */
function _p2pOnEvent(ev) {
  var e = ev;
  if (typeof ev === 'string') {
    try { e = JSON.parse(ev); } catch (err) { return { ok: false, error: 'E_BAD_FRAME' }; }
  }
  if (!e || typeof e !== 'object') return { ok: false, error: 'E_BAD_FRAME' };
  var name = String(e.ev || e.name || '');
  var a = e.args && typeof e.args === 'object' ? e.args : {};
  /* `begin` 是**建立**世代号的那一步（此刻 _p2pSid 还是空的），必须放行；
     info / peerChanged / diag 是会话外的查询，与世代号无关。 */
  var noSid = (name === 'begin' || name === 'info' || name === 'peerChanged' || name === 'diag');

  if (name === 'info') {
    return {
      ok: true,
      ready: _p2pReady(),
      dataVersion: _p2pDataVersion(),
      pairedCount: _p2pPaired,
      tombCount: (appData.tombstones || []).length,
      outboxLen: (appData.outbox || []).length
    };
  }
  if (name === 'peerChanged') {
    _p2pQueryInfo();
    /* self 的 did 一律不认：不建 syncPeers 条目、不 forget/reset（§5.3）。 */
    if (a.removed && !_p2pIsSelf(a.removed)) _p2pForgetPeer(a.removed);
    if (a.reset && !_p2pIsSelf(a.reset)) _p2pResetPeer(a.reset);
    return { ok: true, ignored: (_p2pIsSelf(a.added) || _p2pIsSelf(a.removed) || _p2pIsSelf(a.reset)) ? 'self' : '' };
  }
  if (!noSid && a.sid !== undefined && String(a.sid) !== _p2pSid) {
    _p2pLog('ev=' + name + ' rejected E_STALE_SID got=' + String(a.sid) + ' cur=' + _p2pSid);
    return { ok: false, error: 'E_STALE_SID' };
  }

  try {
    switch (name) {
      case 'begin': {
        /* 自连（对端 did == 本机 did）在这里就断掉：不建会话、不动游标、不写 syncPeers。
           原生侧应当更早拦住它（FAILED_SAME_ORIGIN），这里是网页层的兜底。 */
        if (_p2pIsSelf(a.peerId)) return { ok: false, error: 'E_SAME_ORIGIN' };
        _p2pSid = String(a.sid || '');
        var began = _p2pSessionBegin(a.peerId, a.sid);
        /* 发起方会带 endAt（=自己域里的会话快照上界）；响应方拿到的恒为 0 且必须忽略 ——
           响应方的上界唯一来源是 PULL_SINCE.endAt（§9.2、P0-3）。 */
        if (a.endAt !== undefined && a.endAt !== null && Number(a.endAt) !== 0) {
          _p2pSessBeginEndAt(Number(a.endAt));
        }
        return began;
      }
      case 'build':
        return _p2pBuildOutboxBatch(a.peerId, a.cursor, a.maxBytes);
      /* 墓碑帧（§7.3）。原生 `SyncSession.doPush` 的第一步就是发 `tomb`：
         漏掉这个分支会让会话在握手后立刻停在 default → E_NO_EV，
         两端表现为「一台报错、一台连接中断」。 */
      case 'tomb':
        return _p2pTombBatch(a.cursor);
      case 'collect':
        return _p2pCollectSince(a.peerId, a.since, a.cols, a.cursor, a.maxBytes);
      case 'apply':
        return _p2pApplyBatch(a.peerId, a.payload, a.skewMs, a.last,
          { deferSave: a.deferSave, deferRender: a.deferRender });
      case 'fingerprint':
        return _p2pFingerprint();
      case 'compare':
        return _p2pCompare(a.peerFp, a.peerCounts, a.peerTomb);
      case 'commit':
        return _p2pCommit(a.peerId, a.wm, a.tombLossy);
      case 'abort':
        return _p2pAbort(a.peerId, { flush: a.flush, reason: a.reason });
      case 'diag':
        return _p2pDiag();
      default:
        return { ok: false, error: 'E_NO_EV' };
    }
  } catch (err) {
    var msg = String((err && err.message) || err);
    _p2pLog('sess=' + _p2pSid + ' ev=' + name + ' error=' + msg);
    return { ok: false, error: msg };
  }
}

/* begin 只对**发起方**有意义（响应方的 endAt 恒为 0 且必须忽略，唯一来源是 PULL_SINCE.endAt） */
function _p2pSessBeginEndAt(v) {
  if (!_p2pSess) return;
  _p2pSess.endAt = Number(v) || 0;
}

/* 网页侧对外的唯一门面。注意：网页 UI **不许**知道它存在（一像素不改）；
   读它的只有 sync.js 的 _outboxCap（paired）与原生桥。
   ★ `ready` 用 defineProperty 挂而不是写 `get ready()`：层级门禁（tools/w6_layer.py）
     的函数调用扫描会把对象字面量里的 `get ready()` 当成一次 `ready(` 调用，
     误判成「L2 反向依赖 L3 的 component_registry.ready」。语义与 getter 完全相同。 */
window.BottleSync = {
  paired: function () { return _p2pPairedCount(); },
  /* 对原生的唯一门面。**成功也必须显式带 `ok:true`** —— 原生 `SyncSession.jsOk`
     的判据是 `optBoolean("ok", false)`，缺省即失败。旧实现只有出错才写 ok，
     于是 begin 之后的第一个成功事件（tomb）被当成失败、error 又是空的，
     界面上兜底成 E_JS_ERROR，链路从这一步整个断掉。在这里统一补齐，
     比在 8 个 case 里各写一遍可靠。 */
  onEvent: function (ev) {
    var r = _p2pOnEvent(ev);
    /* `commit` 是唯一返回 Promise 的事件（要等 IDB 落盘确认）。
       对 thenable 不补 ok，交给 __bottleSyncEvent 等 resolve 后再回包。 */
    if (r && typeof r === 'object' && !Array.isArray(r) && typeof r.then !== 'function'
      && r.ok === undefined) r.ok = true;
    return r;
  },
  /* 诊断用途（sync.diag / 长按标题 5 次）：不参与协议 */
  diag: function () { return _p2pDiag(); },
  fp: function () { return _p2pFingerprint(); }
};
Object.defineProperty(window.BottleSync, 'ready', {
  get: function () { return _p2pReady(); },
  enumerable: true,
  configurable: true
});

/* 原生注入调用点：window.__bottleSyncEvent(<ev 的 JSON 文本>) → 处理 → sync.reply。
   文本由原生 JSONObject(...).toString() 生成（不在 JS 里再 stringify 一层）。 */
window.__bottleSyncEvent = function (evJson) {
  var ev = null;
  try { ev = (typeof evJson === 'string') ? JSON.parse(evJson) : evJson; } catch (e) { ev = null; }
  var token = ev && ev.token ? String(ev.token) : '';
  var sid = ev && ev.args && ev.args.sid !== undefined ? String(ev.args.sid) : '';
  /* 回包只有这一个出口：同步结果立刻发，异步结果（commit 等落盘）resolve 后再发。 */
  function reply(data) {
    var r = { token: token, sid: sid, ok: !(data && data.ok === false), data: data };
    try {
      var br = window.__bottleBridge;
      if (br && typeof br.call === 'function') br.call('sync.reply', r);
    } catch (e3) { if (window.__silent) window.__silent(e3, 'p2p:reply'); }
    return r;
  }
  var data;
  try {
    /* 走门面而不是直接调 _p2pOnEvent：门面负责给成功响应补 `ok:true`（见上）。 */
    data = window.BottleSync.onEvent(ev || {});
  } catch (e2) {
    return reply({ ok: false, error: String((e2 && e2.message) || e2) });
  }
  /* `commit` 返回 Promise（要等 IDB 队列兑现才叫「落盘成功」）。
     旧实现直接把 Promise 丢给 JSON.stringify → 变成 `{}` → 原生读不到
     `committed` → 判定为 false → 同步在最后一步报「存储空间不足」（必然发生）。
     原生 `SyncJs.request` 本来就在等回包（最多 20s），所以这里延后回复即可。 */
  if (data && typeof data.then === 'function') {
    data.then(function (v) { reply(v); }, function (e4) {
      reply({ ok: false, error: String((e4 && e4.message) || e4) });
    });
    return null;
  }
  return reply(data);
};

/* 数据加载完成后问一次 sync.info（pairedCount 的唯一来源；拿不到就保持 -1 未知） */
try { _p2pBootstrapInfo(0); } catch (e) { if (window.__silent) window.__silent(e, 'p2p:bootstrap'); }

/* 用例/诊断用：把模块级状态清干净（只在测试里调；正常运行时无人调用） */
function _p2pTestReset() {
  _p2pSess = null;
  _p2pPaired = -1;
  _p2pInfoAsked = false;
  _p2pDiagRing = [];
  _p2pHabitMapPending = Object.create(null);
  _p2pSid = '';
  _p2pSelfDid = '';
}
