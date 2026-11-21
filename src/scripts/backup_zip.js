// @layer: L1
/* ============================================================
 * backup_zip.js · 备份打包：一个 ZIP + 自动分片 ｜症状：大备份导出体积膨胀 · 导入卡死
 * ------------------------------------------------------------
 * 背景（实测）：老实现 `JSON.stringify(backup, null, 2)` 带两格缩进，体积多 1.8 倍；
 * 导入侧 `readAsText` 整包读 → `JSON.parse` 整包解析 → 覆盖全部数据。用户数据用十几年、
 * 几十 MB 时，这两步都会把主线程按住好几秒，且「导入旧备份 = 覆盖」等于删掉备份之后
 * 新增的一切。
 *
 * 本文件只负责**格式与 I/O**：
 *   · 导出：无缩进序列化 → 超过阈值按年/月切分片 → JSZip 压成一个 .zip；
 *   · 导入：按魔数认 ZIP / 老 JSON → 逐片 async('string') → 逐片解析 → 交给数据层合并。
 * 写 appData 的职责统一留在 engine_data（_backupMergeShard / _backupFinishMerge），
 * 合并语义与多端同步完全一致，所以同一份备份导两次必然是「新增 0 / 更新 0」。
 *
 * 为什么不用 Web Worker：postMessage 的结构化克隆会把整棵对象树**再复制一遍**，
 * 对几十 MB 的备份是负优化（内存峰值翻倍、还要再 GC 一次），而解析本身就是一次遍历。
 * ============================================================ */

/* 单个分片的字节上限。6MB 取自「一次 JSON.parse 不至于让主线程明显卡顿」的保守值；
   ★ 用 UTF-8 字节而不是 JS 字符数：中文/emoji 在 UTF-8 里是 3~4 字节，按 length 算会让
     实际条目悄悄超过 6MB（unzip -l 看到的是字节数，用户看到的也是它）。 */
const BACKUP_SHARD_LIMIT = 6 * 1024 * 1024;
/* 小数据量的单文件入口名（< 6MB 时 ZIP 里只有这一个） */
const BACKUP_ZIP_ENTRY = 'data.json';
/* 「其余顶层字段」的大本营 */
const BACKUP_BASE_ENTRY = 'data-base.json';
/* 导出元信息：分片时永远排在第一个 base 分片里，导入时不当业务字段覆盖 */
const BACKUP_META_KEYS = ['version', 'dataVersion', 'exportSchema', 'exportDate', 'exportTime', 'audit'];

/* ---------- 字节估算（不构造整串，避免几十 MB 的临时字符串） ---------- */
function _backupByteLen(str) {
  const s = String(str);
  try {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
  } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:byteLen'); }
  /* 没有 TextEncoder 的老 WebView：按 3 倍长度估（CJK 的 UTF-8 上界），只会切得更碎，不会超限 */
  return s.length * 3;
}

function _backupJsonBytes(v) {
  return _backupByteLen(JSON.stringify(v));
}

/* 递归估算一个值的 JSON 字节数：数组/对象逐项累加，字符串才真正 stringify。
   为什么不用 JSON.stringify(整包).length：那会先造出一个几十 MB 的临时字符串，
   而我们正是为了避开这个峰值才干分片。 */
function _backupValueBytes(v) {
  if (v === null || v === undefined) return 4;
  if (Array.isArray(v)) {
    let n = 2;
    for (let i = 0; i < v.length; i++) n += _backupValueBytes(v[i]) + 1;
    return n;
  }
  if (typeof v === 'object') {
    let n = 2;
    const ks = Object.keys(v);
    for (let i = 0; i < ks.length; i++) n += _backupByteLen(ks[i]) + _backupValueBytes(v[ks[i]]) + 4;
    return n;
  }
  return _backupJsonBytes(v);
}

/* ---------- 年份 / 月份桶 ---------- */
function _backupYearOfTime(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n <= 0) return 'unknown';
  const d = new Date(n);
  const y = d.getFullYear();
  if (!isFinite(y) || y < 1970 || y > 9999) return 'unknown';
  return String(y);
}

function _backupMonthOfTime(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n <= 0) return 'unknown';
  const d = new Date(n);
  const m = d.getMonth() + 1;
  if (!isFinite(m) || m < 1 || m > 12) return 'unknown';
  return (m < 10 ? '0' : '') + m;
}

function _backupYearOfDiaryKey(key) {
  const s = String(key || '');
  return /^\d{4}/.test(s) ? s.slice(0, 4) : 'unknown';
}

function _backupMonthOfDiaryKey(key) {
  const s = String(key || '');
  return /^\d{4}-\d{2}/.test(s) ? s.slice(5, 7) : 'unknown';
}

/* ---------- 分片切分 ---------- */

/* 把一列条目按字节预算贪心切块。单项超过预算时自成一块（记录/日记单条不会那么大；
   真要超了也不静默丢数据，只是这一片会超过 6MB —— 见 BACKUP_ZIP.md 的遗留风险）。 */
function _backupChunkItems(items, limit, onPart) {
  let cur = [];
  let bytes = 0;
  let part = 1;
  const overhead = 64; /* 分片对象本身的壳：__shard / 字段名 / 括号 */
  for (let i = 0; i < items.length; i++) {
    const b = _backupValueBytes(items[i]) + 1;
    if (cur.length && bytes + b + overhead > limit) {
      onPart(cur, part);
      part++;
      cur = [];
      bytes = 0;
    }
    cur.push(items[i]);
    bytes += b;
  }
  if (cur.length) onPart(cur, part);
}

/* records 按 startTime 年份分桶；单年超限再按月；月内仍超限则继续按条目切块。 */
function _backupSplitRecords(records, limit) {
  const byYear = Object.create(null);
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const y = _backupYearOfTime(r && r.startTime);
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(r);
  }
  const out = [];
  Object.keys(byYear).sort().forEach(function (year) {
    const list = byYear[year];
    if (_backupValueBytes(list) + 64 <= limit) {
      out.push({ year: year, month: null, part: 1, list: list });
      return;
    }
    const byMonth = Object.create(null);
    for (let i = 0; i < list.length; i++) {
      const m = _backupMonthOfTime(list[i] && list[i].startTime);
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(list[i]);
    }
    Object.keys(byMonth).sort().forEach(function (month) {
      _backupChunkItems(byMonth[month], limit, function (chunk, part) {
        out.push({ year: year, month: month, part: part, list: chunk });
      });
    });
  });
  return out;
}

/* diaries 按 key 前 4 位年份分桶（key 是 'YYYY-MM-DD'），超限再按月，再按条目切。 */
function _backupSplitDiaries(diaries, limit) {
  const byYear = Object.create(null);
  Object.keys(diaries).forEach(function (k) {
    const y = _backupYearOfDiaryKey(k);
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(k);
  });
  const out = [];
  Object.keys(byYear).sort().forEach(function (year) {
    const keys = byYear[year];
    const one = function (ks) {
      const map = {};
      for (let i = 0; i < ks.length; i++) map[ks[i]] = diaries[ks[i]];
      return map;
    };
    if (_backupValueBytes(one(keys)) + 64 <= limit) {
      out.push({ year: year, month: null, part: 1, map: one(keys) });
      return;
    }
    const byMonth = Object.create(null);
    for (let i = 0; i < keys.length; i++) {
      const m = _backupMonthOfDiaryKey(keys[i]);
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(keys[i]);
    }
    Object.keys(byMonth).sort().forEach(function (month) {
      _backupChunkItems(byMonth[month], limit, function (chunk, part) {
        out.push({ year: year, month: month, part: part, map: one(chunk) });
      });
    });
  });
  return out;
}

/* 其余顶层字段：按「元信息 → settings → 其余键」的确定顺序贪心装箱。
   单字段本身超限（例如自定义树背景的 base64）时独占一片，不拆字段 —— 拆了就没法还原。 */
function _backupSplitBase(backup, limit) {
  const keys = Object.keys(backup).filter(function (k) {
    return k !== 'records' && k !== 'diaries';
  });
  const ordered = [];
  BACKUP_META_KEYS.forEach(function (k) {
    if (keys.indexOf(k) >= 0) ordered.push(k);
  });
  if (keys.indexOf('settings') >= 0) ordered.push('settings');
  keys.sort().forEach(function (k) {
    if (ordered.indexOf(k) < 0) ordered.push(k);
  });

  const out = [];
  let cur = Object.create(null);
  let bytes = 64;
  ordered.forEach(function (k) {
    const b = _backupByteLen(k) + _backupValueBytes(backup[k]) + 8;
    if (Object.keys(cur).length && bytes + b > limit) {
      out.push(cur);
      cur = Object.create(null);
      bytes = 64;
    }
    cur[k] = backup[k];
    bytes += b;
  });
  if (Object.keys(cur).length || !out.length) out.push(cur);
  return out;
}

function _backupShardFileName(kind, year, month, part) {
  let name = kind + '-' + year;
  if (month) name += '-' + month;
  if (part && part > 1) name += '-' + part;
  return name + '.json';
}

/* 把整包备份规划成「ZIP 条目列表」：小数据一个 data.json；大数据 base + records-年 + diaries-年。 */
function _backupPlanShards(backup) {
  let total = 2;
  Object.keys(backup).forEach(function (k) {
    total += _backupByteLen(k) + _backupValueBytes(backup[k]) + 4;
  });

  if (total < BACKUP_SHARD_LIMIT) {
    return [{
      name: BACKUP_ZIP_ENTRY,
      data: Object.assign({ __shard: { kind: 'full', year: null, month: null, index: 1, total: 1 } }, backup)
    }];
  }

  const entries = [];

  const baseParts = _backupSplitBase(backup, BACKUP_SHARD_LIMIT);
  baseParts.forEach(function (obj, i) {
    entries.push({
      name: i === 0 ? BACKUP_BASE_ENTRY : 'data-base-' + (i + 1) + '.json',
      data: Object.assign({
        __shard: { kind: 'base', year: null, month: null, index: i + 1, total: baseParts.length }
      }, obj)
    });
  });

  const recParts = _backupSplitRecords(Array.isArray(backup.records) ? backup.records : [], BACKUP_SHARD_LIMIT);
  recParts.forEach(function (p, i) {
    entries.push({
      name: _backupShardFileName('records', p.year, p.month, p.part),
      data: {
        __shard: { kind: 'records', year: p.year, month: p.month, index: i + 1, total: recParts.length },
        records: p.list
      }
    });
  });

  const diaParts = _backupSplitDiaries(
    backup.diaries && typeof backup.diaries === 'object' && !Array.isArray(backup.diaries) ? backup.diaries : {},
    BACKUP_SHARD_LIMIT
  );
  diaParts.forEach(function (p, i) {
    entries.push({
      name: _backupShardFileName('diaries', p.year, p.month, p.part),
      data: {
        __shard: { kind: 'diaries', year: p.year, month: p.month, index: i + 1, total: diaParts.length },
        diaries: p.map
      }
    });
  });

  return entries;
}

/* ---------- 导出 ---------- */

/* 收集导出对象：不做字段白名单（手写清单必然遗漏），audit 自检沿用原实现。 */
function _backupCollectBackup() {
  const backup = {};
  let copied = 0;
  Object.keys(appData).forEach(function (k) {
    try {
      backup[k] = appData[k];
      copied++;
    } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:collect'); }
  });
  backup.version = DATA_VERSION;
  backup.exportSchema = EXPORT_SCHEMA_VERSION;
  backup.exportDate = getTodayStr();
  backup.exportTime = new Date().toISOString();
  backup.audit = { appDataKeys: Object.keys(appData).length, exportedKeys: copied };
  return backup;
}

/* 逐条目序列化后交给 JSZip；一次只保留一个字符串，避免所有分片同时在内存里。 */
function _backupZipBlob(entries) {
  return new Promise(function (resolve, reject) {
    const Ctor = typeof window !== 'undefined' ? window.JSZip : null;
    if (typeof Ctor !== 'function') {
      reject(new Error('ZIP 组件（jszip.min.js）没有加载'));
      return;
    }
    let zip;
    try {
      zip = new Ctor();
    } catch (e) {
      reject(new Error('ZIP 初始化失败：' + ((e && e.message) || e)));
      return;
    }
    for (let i = 0; i < entries.length; i++) {
      let json;
      try {
        json = JSON.stringify(entries[i].data);
      } catch (e) {
        reject(new Error('分片「' + entries[i].name + '」序列化失败：' + ((e && e.message) || e)));
        return;
      }
      zip.file(entries[i].name, json);
    }
    zip
      .generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
      .then(resolve, reject);
  });
}

function _backupDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:revoke'); }
  }, 100);
}

/* 移动端优先系统分享面板（可「存储到文件 / 发给自己」，换机闭环更顺）；
   能力不可用 / 分享失败 → 回退浏览器下载；用户取消 → 什么都不做。 */
function _backupDeliver(blob, fileName) {
  const download = function () {
    _backupDownload(blob, fileName);
    return Promise.resolve(true);
  };
  if (typeof navigator !== 'undefined' && navigator.share && navigator.canShare && typeof File !== 'undefined') {
    try {
      const shareFile = new File([blob], fileName, { type: 'application/zip' });
      if (navigator.canShare({ files: [shareFile] })) {
        return navigator
          .share({ files: [shareFile], title: '🍅 番茄专注数据备份', text: '番茄专注数据备份（ZIP，可重新导入）' })
          .then(function () { return true; })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return false; /* 用户取消：不打扰、不落下载 */
            return download();
          });
      }
    } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:share'); }
  }
  return download();
}

function exportData() {
  try {
    const backup = _backupCollectBackup();
    const entries = _backupPlanShards(backup);
    const fileName = 'tomato_backup_' + getTodayStr() + '.zip';
    _backupZipBlob(entries)
      .then(function (blob) { return _backupDeliver(blob, fileName); })
      .then(function (delivered) {
        /* 用户取消分享：不提示、不记导出日（否则「上次导出」会撒谎） */
        if (delivered) _backupMarkExported(entries.length);
      })
      .catch(function (e) {
        UIFX.toast('导出失败：' + ((e && e.message) || e));
      });
  } catch (e) {
    UIFX.toast('导出失败：' + ((e && e.message) || e));
  }
}

/* ---------- 导入 ---------- */

/* 外部 JSON 的解析口：reviver 顺手剔除原型污染三键（与 pure_core 的 deepSanitize 同口径），
   不额外深拷贝 —— 几十万条记录再复制一遍就等于把「逐片解析」的收益吃掉。 */
function _backupSafeParse(text) {
  return JSON.parse(text, function (k, v) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined;
    return v;
  });
}

function _backupReadHead(file, n) {
  const blob = typeof file.slice === 'function' ? file.slice(0, n) : file;
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function (e) { resolve(new Uint8Array(e.target.result)); };
    reader.onerror = function () { reject(new Error('读取文件头失败')); };
    reader.readAsArrayBuffer(blob);
  });
}

function _backupReadText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function (e) { resolve(String(e.target.result)); };
    reader.onerror = function () { reject(new Error('读取文件失败')); };
    reader.readAsText(file);
  });
}

function _backupIsZip(head) {
  if (!head || head.length < 4) return false;
  /* ZIP 魔数 PK\x03\x04 —— 扩展名不可信（改名的 .json 也能走对分支） */
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/* 校验一份「整包 / 分片」并交给数据层合并。错误信息带文件与分片名，便于用户定位。 */
function _backupImportObject(obj, fileName, entryName, ctx, stats) {
  const where = '文件「' + fileName + '」' + (entryName ? '的分片「' + entryName + '」' : '');
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error(where + '：内容不是 JSON 对象');
  }
  const sh = obj.__shard;
  if (!sh || typeof sh !== 'object') {
    /* 老格式：整包 JSON。结构校验沿用原实现（含 exportSchema 升级提示与字段级 warns）。 */
    const vb = validateBackup(obj);
    if (!vb.ok) throw new Error(where + '：' + vb.reason);
    if (vb.warns && vb.warns.length) {
      try {
        console.warn('[导入] 旧格式兼容提示：', vb.warns);
        if (window.__errRep) window.__errRep.warn('import', vb.warns.join('；'));
      } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:warns'); }
    }
  } else if (sh.kind === 'full') {
    const vb = validateBackup(obj);
    if (!vb.ok) throw new Error(where + '：' + vb.reason);
  } else if (sh.kind === 'records') {
    if (!Array.isArray(obj.records)) throw new Error(where + '：records 分片缺少 records 数组');
  } else if (sh.kind === 'diaries') {
    if (!obj.diaries || typeof obj.diaries !== 'object' || Array.isArray(obj.diaries)) {
      throw new Error(where + '：diaries 分片结构异常');
    }
  } else if (sh.kind === 'base') {
    if (obj.settings !== undefined && (!obj.settings || typeof obj.settings !== 'object' || Array.isArray(obj.settings))) {
      throw new Error(where + '：base 分片的 settings 结构异常');
    }
  }
  try {
    _backupMergeShard(obj, ctx, stats);
  } catch (e) {
    throw new Error(where + '：' + ((e && e.message) || e));
  }
}

/* 读一个 ZIP：逐条目 async('string') → 解析 → 合并 → 置空并移除条目。
   峰值内存 ≈ 一个分片（压缩包 + 当前条目），不是整包。 */
async function _backupImportZip(file, ctx, stats) {
  const Ctor = typeof window !== 'undefined' ? window.JSZip : null;
  if (typeof Ctor !== 'function') {
    throw new Error('文件「' + file.name + '」是 ZIP，但 ZIP 组件（jszip.min.js）没有加载');
  }
  const buf = await file.arrayBuffer();
  let zip;
  try {
    zip = await Ctor.loadAsync(buf);
  } catch (e) {
    throw new Error('文件「' + file.name + '」不是有效的 ZIP：' + ((e && e.message) || e));
  }
  const names = Object.keys(zip.files)
    .filter(function (n) {
      const f = zip.files[n];
      return f && !f.dir && /\.json$/i.test(n) && n.indexOf('__MACOSX/') !== 0;
    })
    .sort();
  if (!names.length) throw new Error('文件「' + file.name + '」里没有 .json 分片');

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let text;
    try {
      text = await zip.files[name].async('string');
    } catch (e) {
      throw new Error('文件「' + file.name + '」的分片「' + name + '」读取失败：' + ((e && e.message) || e));
    }
    let obj;
    try {
      obj = _backupSafeParse(text);
    } catch (e) {
      throw new Error('文件「' + file.name + '」的分片「' + name + '」不是合法 JSON：' + ((e && e.message) || e));
    }
    text = null; /* 主动释放：分片字符串在解析完成后就没有用了 */
    _backupImportObject(obj, file.name, name, ctx, stats);
    obj = null;
    try {
      zip.remove(name);
    } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:zipRemove'); }
  }
}

async function _backupImportJson(file, ctx, stats) {
  let text;
  try {
    text = await _backupReadText(file);
  } catch (e) {
    throw new Error('文件「' + file.name + '」读取失败：' + ((e && e.message) || e));
  }
  let obj;
  try {
    obj = _backupSafeParse(text);
  } catch (e) {
    throw new Error('文件「' + file.name + '」不是合法 JSON：' + ((e && e.message) || e));
  }
  text = null;
  _backupImportObject(obj, file.name, null, ctx, stats);
}

async function _backupImportOneFile(file, ctx, stats) {
  let head = null;
  try {
    head = await _backupReadHead(file, 4);
  } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:head'); }
  if (_backupIsZip(head)) return _backupImportZip(file, ctx, stats);
  return _backupImportJson(file, ctx, stats);
}

function _backupAskConfirm(msg) {
  return new Promise(function (resolve) {
    if (typeof window.rsAsk === 'function') {
      try {
        window.rsAsk(
          msg,
          { title: '导入数据', okText: '继续导入' },
          function () { resolve(true); },
          function () { resolve(false); }
        );
        return;
      } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:rsAsk'); }
    }
    resolve(typeof confirm === 'function' ? confirm(msg) : true);
  });
}

function _backupShowImportError(detail) {
  const msg = '导入失败：\n\n' + detail;
  if (typeof window.rsAlert === 'function') {
    window.rsAlert(msg, { title: '导入失败', okText: '知道了' });
    return;
  }
  if (typeof window.rsInfo === 'function') {
    window.rsInfo(msg, { title: '导入失败' });
    return;
  }
  UIFX.toast('导入失败：' + detail);
}

/* 多文件顺序导入：一份失败不影响已合并的分片（合并是增量且幂等的），
   但不再继续读后面的文件 —— 让用户先看清是哪份出的问题。 */
async function _backupRunImport(files, input) {
  const ctx = _backupNewMergeCtx();
  const stats = { added: 0, updated: 0 };
  let failed = null;
  for (let i = 0; i < files.length; i++) {
    try {
      await _backupImportOneFile(files[i], ctx, stats);
    } catch (e) {
      failed = e;
      break;
    }
  }
  let finished = false;
  try {
    _backupFinishMerge(ctx, stats.added, stats.updated, failed ? '' : 'ok');
    finished = true;
  } catch (e2) {
    if (!failed) failed = e2;
    try {
      if (window.__errRep) window.__errRep.warn('import', '合并后归一失败：' + ((e2 && e2.message) || e2));
    } catch (e3) { if (window.__silent) window.__silent(e3, 'backup_zip:finish'); }
  }
  try {
    if (input) input.value = '';
  } catch (e4) { if (window.__silent) window.__silent(e4, 'backup_zip:reset'); }
  if (failed) {
    const tail = finished ? '\n\n（已合并 ' + (stats.added + stats.updated) + ' 条，其余内容未导入）' : '';
    _backupShowImportError(((failed && failed.message) || String(failed)) + tail);
  }
}

function importData(event) {
  const input = event && event.target ? event.target : null;
  const files = input && input.files ? Array.prototype.slice.call(input.files) : [];
  if (!files.length) {
    try {
      if (input) input.value = '';
    } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:reset'); }
    return Promise.resolve();
  }
  /* 文案只说一件事：合并，不删。老文案「将覆盖当前所有数据」正是这次要消灭的。 */
  const msg = '将与你现有的数据合并，不会删除任何记录。\n（导入前数据会自动备份，可恢复）';
  return _backupAskConfirm(msg).then(function (ok) {
    if (!ok) {
      try {
        if (input) input.value = '';
      } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:reset'); }
      return;
    }
    return _autoBackupGuard('导入数据').then(function (proceed) {
      if (!proceed) {
        try {
          if (input) input.value = '';
        } catch (e) { if (window.__silent) window.__silent(e, 'backup_zip:reset'); }
        return;
      }
      return _backupRunImport(files, input);
    });
  }).catch(function (e) {
    _backupShowImportError((e && e.message) || String(e));
    try {
      if (input) input.value = '';
    } catch (e2) { if (window.__silent) window.__silent(e2, 'backup_zip:reset'); }
  });
}
