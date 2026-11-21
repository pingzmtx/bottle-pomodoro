/*
 * 函数索引（TOC）：_p2pCollOfKind/_p2pSnapshotOf/_p2pMapSliceOf/_p2pMapByHabitUid/_p2pApplyHabitMap/apply/_p2pFlushHabitMapPending/_p2pAttachSnapshot/_p2pDetach/_p2pAttachMapValue/_fpHash/_fpOfList（+6 更多）
 */
// @layer: L2
/* ============================================================
 * sync_p2p_payload.js · 同步「负载的编解码 + 指纹」（2026-11）
 * ------------------------------------------------------------
 * 由 sync_p2p.js 按职责域拆出的第二半（`tools/w6_size.py` 的新文件红线 800 行）：
 *   · 快照切片：把 outbox / 扫描出的一个 uid 换成「当前内容的快照」；
 *   · 负载挂载：把切片并进 payload（含超额回退用的 _p2pDetach）；
 *   · 指纹：FNV-1a 32 的 _fpHash / _fpOfList / _fpOfMap / _fpAll / _fpTomb 与比对。
 * 会话 / 水位 / 提交 / 事件入口留在 sync_p2p.js。两个文件同属 manifest slot 0，
 * 拼在同一个 <script> 里，共享 appData / saveDataNow / _kindOfUid 等词法绑定。
 *
 * ★ 与 sync_p2p.js 顶部同一条隐式契约：这里只**读**数据造负载、只**读**数据算指纹，
 *   绝不 touchRecord / 绝不 enqueueChange。合并一律交给 applyRemoteBatch。
 * ============================================================ */

/* ===== 快照：把 outbox 里的一个 uid 换成「当前内容的快照」=====
 * 为什么必须走这里而不是直接按 kind 取集合：
 *   ① 子任务/提醒不是顶层集合 → 换成父待办快照（否则对端只收到一个孤零零的 uid）；
 *   ② 映射集合（日记/必填/打卡）按 key 组织，要单独切；
 *   ③ 未知 kind **一律不发**（旧代码回落到 records，会把周重点发成一条假专注记录）。 */
function _p2pCollOfKind(kind) {
  var k = String(kind || '');
  if (P2P_KIND_COLL[k]) return { name: P2P_KIND_COLL[k], type: 'array' };
  if (P2P_KIND_MAP[k]) return { name: P2P_KIND_MAP[k], type: 'map' };
  return null;
}

function _p2pSnapshotOf(uid, kind) {
  var k = String(kind || (typeof _kindOfUid === 'function' ? _kindOfUid(uid) : 'record'));
  /* 嵌套结构 → 父待办快照 */
  if (k === 'sub' || k === 'remind') return _parentTodoOfChild(uid) || null;
  var coll = _p2pCollOfKind(k);
  if (!coll) return null;                       /* 未知 kind：不发（不回落） */
  if (coll.type === 'map') return null;         /* 映射集合走 _p2pMapSliceOf */
  var list = appData[coll.name];
  if (!Array.isArray(list)) return null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && idEq(list[i].uid, uid)) return list[i];
  }
  return null;
}

/* 映射集合的单 uid 切片。返回的形状**就是负载里的字段名**，调用方直接并进 payload。
 *   diary_<date>  → { diaries: { <date>: {...} } }
 *   must_<date>   → { mustDos: { <date>: [...] }, mustDosAt: { <date>: ms } }
 *   habit_<uid>   → { habitLogs: { <uid>: [...] }, habitSkips: { <uid>: [...] } }
 * 打卡/跳过的 key 在负载里**换成习惯 uid**（本机 key 仍是 h.id，30+ 处 UI 读取不动）。 */
function _p2pMapSliceOf(uid, kind) {
  var k = String(kind || '');
  var out = {};
  if (k === 'diary') {
    var date = String(uid).slice('diary_'.length);
    var dd = appData.diaries && appData.diaries[date];
    if (dd) out.diaries = (function () { var m = {}; m[date] = dd; return m; })();
    return out;
  }
  if (k === 'mustdos') {
    var d2 = String(uid).slice('must_'.length);
    var md = appData.mustDos && appData.mustDos[d2];
    if (Array.isArray(md) && md.length) {
      var m2 = {}; m2[d2] = md;
      var a2 = {}; a2[d2] = Number((appData.mustDosAt || {})[d2]) || 0;
      out.mustDos = m2;
      out.mustDosAt = a2;
    }
    return out;
  }
  if (k === 'habit') {
    var hu = String(uid);
    var logs = _p2pMapByHabitUid(appData.habitLogs)[hu];
    var skips = _p2pMapByHabitUid(appData.habitSkips)[hu];
    if (Array.isArray(logs) && logs.length) { var l = {}; l[hu] = logs; out.habitLogs = l; }
    if (Array.isArray(skips) && skips.length) { var s = {}; s[hu] = skips; out.habitSkips = s; }
    return out;
  }
  return out;
}

/* 出：本机 {h.id: [日期]} → 负载 {habitUid: [日期]} */
function _p2pMapByHabitUid(src) {
  var out = Object.create(null);
  var list = Array.isArray(appData.habits) ? appData.habits : [];
  for (var i = 0; i < list.length; i++) {
    var h = list[i];
    if (!h || !h.uid) continue;
    var v = src && src[String(h.id)];
    if (Array.isArray(v) && v.length) out[String(h.uid)] = v.slice();
  }
  return out;
}

/* 入：负载 {habitUid: [日期]} → 本机 {h.id: [日期]}。
   习惯还没到（对端先发了日志、后发习惯）→ 先进缓冲，等习惯到了再刷。
   返回落地（或进缓冲）的 change 计数。 */
function _p2pApplyHabitMap(remoteLogs, remoteSkips) {
  var byUid = Object.create(null);
  (appData.habits || []).forEach(function (h) { if (h && h.uid) byUid[String(h.uid)] = h; });
  function apply(kind, remoteObj, localMap) {
    if (!remoteObj || typeof remoteObj !== 'object') return 0;
    var changed = 0;
    Object.keys(remoteObj).forEach(function (uid) {
      var h = byUid[uid];
      var arr = Array.isArray(remoteObj[uid]) ? remoteObj[uid] : [];
      if (!h) {                                  /* 习惯还没同步过来：先存缓冲，本次不落地 */
        if (arr.length) {
          var slot = _p2pHabitMapPending[uid] || (_p2pHabitMapPending[uid] = { logs: [], skips: [] });
          slot[kind === 'logs' ? 'logs' : 'skips'] = arr.slice();
        }
        return;
      }
      var key = String(h.id);
      var lv = Array.isArray(localMap[key]) ? localMap[key] : [];
      var set = Object.create(null);
      lv.forEach(function (d) { set[String(d).slice(0, 10)] = 1; });
      var grew = false;
      arr.forEach(function (d) {
        var dd = String(d).slice(0, 10);
        if (!set[dd]) { set[dd] = 1; lv.push(dd); grew = true; changed++; }
      });
      if (grew || lv.length) { lv.sort(); localMap[key] = lv; }
    });
    return changed;
  }
  if (!appData.habitLogs || typeof appData.habitLogs !== 'object') appData.habitLogs = {};
  if (!appData.habitSkips || typeof appData.habitSkips !== 'object') appData.habitSkips = {};
  var n = apply('logs', remoteLogs, appData.habitLogs);
  n += apply('skips', remoteSkips, appData.habitSkips);
  return n;
}

/* 把缓冲里「现在能找到习惯」的落地，处理完删除缓冲项。
   ★ commit 之前必须调一次，否则「本次已同步」的日志会与落盘内容不一致。 */
function _p2pFlushHabitMapPending() {
  var uids = Object.keys(_p2pHabitMapPending);
  if (!uids.length) return 0;
  var logsObj = Object.create(null), skipsObj = Object.create(null);
  var byUid = Object.create(null);
  (appData.habits || []).forEach(function (h) { if (h && h.uid) byUid[String(h.uid)] = h; });
  var n = 0;
  uids.forEach(function (uid) {
    if (!byUid[uid]) return;                     /* 还是没到：留着，下次再说 */
    var slot = _p2pHabitMapPending[uid];
    if (slot.logs && slot.logs.length) logsObj[uid] = slot.logs;
    if (slot.skips && slot.skips.length) skipsObj[uid] = slot.skips;
    delete _p2pHabitMapPending[uid];
  });
  if (Object.keys(logsObj).length || Object.keys(skipsObj).length) n = _p2pApplyHabitMap(logsObj, skipsObj);
  return n;
}

/* 把一个 uid 的快照塞进 payload。返回 {bucket, item, bytes}（供超额回退用）。 */
function _p2pAttachSnapshot(payload, uid, kind) {
  var k = String(kind || '');
  var rec = _p2pSnapshotOf(uid, k);
  if (rec) {
    var coll = _p2pCollOfKind(k === 'sub' || k === 'remind' ? 'todo' : k);
    if (!coll || coll.type !== 'array') return null;
    if (!Array.isArray(payload[coll.name])) payload[coll.name] = [];
    /* 同一条父待办在一批里只出现一次 */
    var bucket = payload[coll.name];
    for (var i = 0; i < bucket.length; i++) if (idEq(bucket[i] && bucket[i].uid, rec.uid)) return null;
    bucket.push(rec);
    return { bucket: coll.name, item: rec, bytes: JSON.stringify(rec).length };
  }
  /* 映射集合：切片并在前面记账（bytes 用切片大小近似） */
  var slice = _p2pMapSliceOf(uid, k);
  var names = Object.keys(slice);
  if (!names.length) return null;
  names.forEach(function (nm) {
    if (nm === 'mustDosAt') {
      Object.keys(slice.mustDosAt).forEach(function (d) { payload.mustDosAt[d] = slice.mustDosAt[d]; });
      return;
    }
    if (!payload[nm] || typeof payload[nm] !== 'object') payload[nm] = {};
    Object.keys(slice[nm]).forEach(function (d) { payload[nm][d] = slice[nm][d]; });
  });
  return { bucket: 'map', item: slice, bytes: JSON.stringify(slice).length };
}

function _p2pDetach(payload, add) {
  if (!add) return;
  if (add.bucket === 'map') {
    var slice = add.item || {};
    Object.keys(slice).forEach(function (nm) {
      if (nm === 'mustDosAt') {
        Object.keys(slice.mustDosAt).forEach(function (d) { delete payload.mustDosAt[d]; });
        return;
      }
      Object.keys(slice[nm]).forEach(function (d) { delete payload[nm][d]; });
    });
    return;
  }
  var arr = payload[add.bucket];
  if (!Array.isArray(arr)) return;
  var at = arr.indexOf(add.item);
  if (at >= 0) arr.splice(at, 1);
}

function _p2pAttachMapValue(payload, it) {
  if (it.coll === 'diaries') {
    if (!payload.diaries[it.key]) payload.diaries[it.key] = it.value;
  } else if (it.coll === 'mustDos') {
    payload.mustDos[it.key] = it.value;
    payload.mustDosAt[it.key] = it.ts;
  } else if (it.coll === 'habitLogs' || it.coll === 'habitSkips') {
    payload[it.coll][it.key] = it.value;
  }
  return { bucket: 'map', item: { one: it }, bytes: JSON.stringify(it.value || '').length + String(it.key).length };
}

/* ===== 指纹（§9.7）：两端必须算出同一个值 =====
 * FNV-1a 32 位，步进用 Math.imul（精确 32 位乘法），每步 >>> 0。
 * ★ _fpAll 里**不做任何时钟偏移换算**：存的是原始 updatedAt。
 *   一旦把远端戳归一到本地域再存下来，两台机器对同一条记录就存了不同的 updatedAt，
 *   指纹永远对不上（所以 skew 只在比较时用，见 lwwPick）。 */
function _fpHash(s) {
  var h = 0x811c9dc5;
  var str = String(s == null ? '' : s);
  for (var i = 0; i < str.length; i++) {
    h ^= (str.charCodeAt(i) & 0xffff);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function _fpOfList(list) {
  var arr = Array.isArray(list) ? list : [];
  var keys = [], chs = [], maxU = 0;
  for (var i = 0; i < arr.length; i++) {
    var r = arr[i];
    if (!r || !r.uid) continue;                       /* 无 uid 的老记录：与合并规则一致，不参与 */
    var t = Math.floor(Number(r.updatedAt) || 0);
    if (t > maxU) maxU = t;
    keys.push(String(r.uid) + ':' + t);
    chs.push(_fpHash(_canon(r)));
  }
  keys.sort();                                        /* 默认比较器 = UTF-16 码元升序，跨设备确定 */
  chs.sort();
  return { n: keys.length, m: maxU, h: _fpHash(keys.join(',')), ch: _fpHash(chs.join(',')) };
}

function _fpOfMap(kind, map) {
  var keys = [], chs = [], maxU = 0, n = 0;
  if (!map || typeof map !== 'object') return { n: 0, m: 0, h: _fpHash(''), ch: _fpHash('') };
  var ks = Object.keys(map);
  for (var i = 0; i < ks.length; i++) {
    var k = ks[i], v = map[k];
    var t = 0, cnt = 0;
    if (kind === 'set') {                              /* habitLogs / habitSkips：字符串数组 */
      if (!Array.isArray(v) || !v.length) continue;
      cnt = v.length; n += cnt;
      keys.push(k + ':' + v.slice().map(function (x) { return String(x).slice(0, 10); }).sort().join(','));
      chs.push(_fpHash(_canon(v)));
    } else if (kind === 'diary') {                      /* diaries：每天一个对象 */
      if (!v || typeof v !== 'object') continue;
      t = Math.floor(Number(v.updatedAt) || 0); cnt = 1; n += 1;
      keys.push(k + ':' + t);
      chs.push(_fpHash(_canon(v)));
    } else {                                            /* mustDos：每天一个数组，时间戳在 mustDosAt */
      if (!Array.isArray(v) || !v.length) continue;
      t = Math.floor(Number((appData.mustDosAt || {})[k]) || 0); cnt = v.length; n += cnt;
      keys.push(k + ':' + t);
      chs.push(_fpHash(_canon(v)));
    }
    if (t > maxU) maxU = t;
  }
  keys.sort(); chs.sort();
  return { n: n, m: maxU, h: _fpHash(keys.join(',')), ch: _fpHash(chs.join(',')) };
}

function _fpAll() {
  var parts = [];
  for (var i = 0; i < FP_ARRAYS.length; i++) {
    var k = FP_ARRAYS[i], f = _fpOfList(appData[k]);
    parts.push(k + ':' + f.n + ':' + f.m + ':' + f.h);
  }
  for (var j = 0; j < FP_MAPS.length; j++) {
    var m = FP_MAPS[j], g = _fpOfMap(m[1], appData[m[0]]);
    parts.push(m[0] + ':' + g.n + ':' + g.m + ':' + g.h);
  }
  return _fpHash(parts.join('|'));
}

/* 墓碑摘要：只进 FINGERPRINT / 日志 / NEED_FIX.reason，**不参与 equal**。
   为什么：墓碑会被裁（两端时机不同）→ 集合本身合法地不相等；
   而「删除」的效果已体现在记录集合里（记录不见了），所以它既不该漏检也不该误报。 */
function _fpTomb() {
  var t = Array.isArray(appData.tombstones) ? appData.tombstones : [];
  var max = 0, keys = [];
  for (var i = 0; i < t.length; i++) {
    var d = Math.floor(Number(t[i] && t[i].deletedAt) || 0);
    if (d > max) max = d;
    keys.push(String(t[i] && t[i].uid) + ':' + d);
  }
  keys.sort();
  return { n: t.length, max: max, h: _fpHash(keys.join(',')) };
}

function _p2pCounts() {
  var counts = {};
  FP_ARRAYS.forEach(function (k) { counts[k] = _fpOfList(appData[k]); });
  FP_MAPS.forEach(function (m) { counts[m[0]] = _fpOfMap(m[1], appData[m[0]]); });
  return counts;
}

function _p2pFingerprint() {
  return { fp: _fpAll(), counts: _p2pCounts(), tomb: _fpTomb() };
}

/* 比对：equal **只看** fp + counts（§6.3、C38）。
   墓碑摘要与内容摘要只进 reason / 日志 —— 它们参与观测，不参与判定。 */
function _p2pCompare(peerFp, peerCounts, peerTomb) {
  var mine = _p2pFingerprint();
  var diff = [];
  var countsEqual = true;
  FP_COLLECTIONS.forEach(function (k) {
    var a = mine.counts[k] || { n: 0, m: 0, h: '' };
    var b = (peerCounts && peerCounts[k]) || null;
    if (!b) { countsEqual = false; diff.push(k); return; }
    if (Number(b.n) !== a.n || Number(b.m) !== a.m || String(b.h) !== a.h) { countsEqual = false; diff.push(k); }
  });
  var equal = (String(peerFp || '') === mine.fp) && countsEqual;
  var reason = 'fp=' + mine.fp + ' peerFp=' + String(peerFp || '')
    + ' diff=' + (diff.length ? diff.join(',') : '-')
    + ' tomb=' + (peerTomb ? (Number(peerTomb.n) || 0) + '/' + (Number(peerTomb.max) || 0) + '/' + String(peerTomb.h || '') : '-')
    + ' myTomb=' + mine.tomb.n + '/' + mine.tomb.max + '/' + mine.tomb.h
    + ' ch=' + diff.map(function (k) { return k + ':' + ((mine.counts[k] || {}).ch || ''); }).join(',');
  return { equal: equal, diff: diff, reason: reason };
}
