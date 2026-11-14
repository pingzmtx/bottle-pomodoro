#!/usr/bin/env node
/**
 * D 方案 · AST 调用图（静态依赖的真实画像）
 * ============================================================
 * 用法:
 * node tools/callgraph_ast.js # 生成 tools/callgraph.json + 控制台报告
 * node tools/callgraph_ast.js --json # 只输出 JSON 到 stdout（不写文件）
 * node tools/callgraph_ast.js --impact <函数> # 反查：谁依赖我 / 我依赖谁
 * node tools/callgraph_ast.js --module <文件> # 单模块的入度/出度明细
 * node tools/callgraph_ast.js --selfcheck # 自检：解析率 / 边数 / 层对齐
 * 为什么需要它（它是 dep_report.py 的精确版）:
 * 本项目的产物是「src/template.html + src/scripts/*.js 顺序拼接」的单文件，
 * 所有顶层 function 共享**同一个脚本作用域**，跨模块调用不需要 window. 前缀。
 * 于是"facade 边界"是个虚构——facade-only 的探针会系统性漏掉隐藏依赖。
 * dep_report.py 用正则找 `名字(` 来数跨文件调用，它必然：
 * 漏 → ① 动态引用（字符串里存函数名再反射调用）
 * ② 通过 window.xxx / 命名空间对象的间接调用（正则数不到归属）
 * ③ 同名函数在多文件重复定义时，owner 表 setdefault 只留第一个，其余静默丢失
 * ④ 数据耦合（appData 全局共享）——它头注释自认"无法用文本统计"
 * 误 → ① 注释文本里的函数名
 * ② 字符串字面量里的函数名
 * ③ 与顶层函数同名的局部变量/形参（如 list.slice()）
 * 本工具用 acorn 解析真 AST，只记**真实语法节点**上的边。三类边：
 * A. call —— CallExpression：函数调用 / 成员方法调用 / IIFE
 * B. state —— MemberExpression：读写共享全局状态（appData.* 及模块命名空间）
 * C. dom —— DOM id 契约：getElementById('x')/querySelector('#x') ↔ id="x"
 * （两端都是字符串字面量，正则也扫得到；但只有 AST 能把
 * 左端定位到**调用方模块**、右端定位到**创建方模块**，
 * 从而把"谁改了我依赖的元素"这条隐性耦合显式化。）
 * 设计约束（对齐 tools/w6_layer.py 的规则，不另立标准）:
 * - 模块归属: 文件名 → LAYER（直接读 w6_layer.py 的 LAYER 表，单一事实源）
 * - 输出必须能回答: "这条边是不是下层依赖上层" → 与 w6_layer 同口径
 * - 不跑、不依赖 dep_report.py 的输出（那是"用近似工具定精确工具的边界"）
 * - 防御式调用（typeof foo === 'function' / window.store && ...）单独归类为
 * 「软依赖」，与 w6_layer.py 的硬违例判定保持一致。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('./vendor/acorn.js');

const HERE = __dirname;
const ROOT = path.dirname(HERE);
const SCRIPTS = path.join(ROOT, 'src', 'scripts');
const TEMPLATE = path.join(ROOT, 'src', 'template.html');
const OUT_JSON = path.join(HERE, 'callgraph.json');
const TPL = 'src/template.html';

const ARGS = process.argv.slice(2);
const HAS = (f) => ARGS.includes(f);
const VAL = (f) => { const i = ARGS.indexOf(f); return i >= 0 ? ARGS[i + 1] : null; };

/* ============================================================
 * 0. 层级表：从 w6_layer.py 源码里读，保证单一事实源
 * ============================================================ */
function loadLayers() {
  const src = fs.readFileSync(path.join(HERE, 'w6_layer.py'), 'utf8');
  const m = src.match(/LAYER\s*=\s*\{([\s\S]*?)\n\}/);
  if (!m) throw new Error('无法从 w6_layer.py 提取 LAYER 表');
  const out = {};
  const re = /"([^"]+\.js)"\s*:\s*(\d+)/g;
  let g;
  while ((g = re.exec(m[1]))) out[g[1]] = Number(g[2]);
  if (!Object.keys(out).length) throw new Error('LAYER 表提取为空');
  return out;
}

const LAYER = loadLayers();
const LAYER_NAME = { 0: 'L0纯函数', 1: 'L1引擎', 2: 'L2增强', 3: 'L3横切', 4: 'L4胶水' };

/* ============================================================
 * 1. AST 遍历小工具（不引第三方 walker）
 * ============================================================ */
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'range', '__parent']);

function walk(node, visit, parent, key) {
  if (!node || typeof node.type !== 'string') return;
  if (parent) {
    Object.defineProperty(node, '__parent', {
      value: parent, enumerable: false, configurable: true, writable: true,
    });
  }
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    if (SKIP_KEYS.has(k)) continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, node, k);
    } else if (v && typeof v.type === 'string') {
      walk(v, visit, node, k);
    }
  }
}

/* 成员表达式拍平成字符串路径：a.b.c / a[b] / a['b'] */
function memberPath(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression') {
    const o = memberPath(node.object);
    if (o == null) return null;
    if (!node.computed && node.property.type === 'Identifier') return o + '.' + node.property.name;
    if (node.computed && node.property.type === 'Literal') return o + '.' + String(node.property.value);
    if (node.computed && node.property.type === 'TemplateLiteral' && node.property.expressions.length === 0)
      return o + '.' + node.property.quasis.map((q) => q.value.cooked).join('');
    return o + '.*'; // 动态属性 a[b] → 只知道前缀
  }
  return null;
}

const isLiteralString = (n) =>
  !!n && ((n.type === 'Literal' && typeof n.value === 'string') ||
          (n.type === 'TemplateLiteral' && n.expressions.length === 0));

const litValue = (n) =>
  n.type === 'Literal' ? n.value : n.quasis.map((q) => q.value.cooked).join('');

/* ============================================================
 * 2. 解析所有模块
 * ============================================================ */
const files = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.js')).sort();
const mods = {};

for (const f of files) {
  const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8');
  let ast;
  try {
    ast = acorn.parse(src, {
      ecmaVersion: 2022,
      sourceType: 'script',   // 拼接式普通脚本，不是 ESM
      locations: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowHashBang: true,
    });
  } catch (e) {
    console.error(`解析失败 ${f}: ${e.message}`);
    process.exit(2);
  }
  mods[f] = { src, ast, topFns: new Map(), aliasOf: new Map() };
}

/* 2.1 顶层函数：0 缩进声明 + IIFE 内的声明（L2/L3/L4 全在 IIFE 里） */
function collectTopFns(f) {
  const m = mods[f];
  const add = (name, node, depth) => {
    if (!m.topFns.has(name)) m.topFns.set(name, { name, depth, line: node.loc.start.line });
  };
  for (const stmt of m.ast.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id) add(stmt.id.name, stmt, 0);
    else if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        if (d.id.type === 'Identifier' && d.init &&
            (d.init.type === 'FunctionExpression' || d.init.type === 'ArrowFunctionExpression'))
          add(d.id.name, d, 0);
      }
    } else if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'CallExpression') {
      const callee = stmt.expression.callee;
      if (callee.type !== 'FunctionExpression' && callee.type !== 'ArrowFunctionExpression') continue;
      const body = callee.body.type === 'BlockStatement' ? callee.body.body : [];
      for (const inner of body) {
        if (inner.type === 'FunctionDeclaration' && inner.id) add(inner.id.name, inner, 1);
        else if (inner.type === 'VariableDeclaration') {
          for (const d of inner.declarations) {
            if (d.id.type === 'Identifier' && d.init &&
                (d.init.type === 'FunctionExpression' || d.init.type === 'ArrowFunctionExpression'))
              add(d.id.name, d, 1);
          }
        } else if (inner.type === 'ExpressionStatement' && inner.expression.type === 'AssignmentExpression') {
          const mp = memberPath(inner.expression.left);
          if (mp && mp.startsWith('window.')) m.aliasOf.set(mp.slice(7), inner.expression.right);
        }
      }
    }
  }
}
files.forEach(collectTopFns);

/* 2.2 函数名 → 归属文件（重名时全保留，显式记录冲突）
 * ⚠ 口径（2026-11-14 修正）：**只有 depth=0 才可能互相覆盖**。
 *   depth=0 是文件顶层声明 —— 拼接后它们共享同一个脚本作用域，后写的覆盖前面的；
 *   depth=1 是各文件自己 IIFE 里的私有函数 —— 作用域不相交，同名纯属巧合同名。
 *   旧代码把两者并进同一张表，于是 07_uiFold 与 08_component_registry 里各一份
 *   `q`/isMinimal/patchObserver` 被报成「13 组静默覆盖」。逐个查证：13 组全是误报，
 *   且同一份输出的 globals（245 个 window.xxx）里这 13 个名字一个都不在 ——
 *   工具不可能同时说「它不是全局」和「它被后加载的覆盖」。
 *   fnOwner 仍保留全部（--impact / 调用归属需要能查到私有函数），
 *   冲突判定单独用 fnOwnerShared（只含 depth=0）。 */
const fnOwner = new Map();
const fnOwnerShared = new Map();
const fnDepthIdx = new Map();   // name -> { d0:[files], d1:[files] }
for (const f of files) for (const [name, info] of mods[f].topFns) {
  if (!fnOwner.has(name)) fnOwner.set(name, []);
  fnOwner.get(name).push(f);
  if (!fnDepthIdx.has(name)) fnDepthIdx.set(name, { d0: [], d1: [] });
  fnDepthIdx.get(name)[info.depth === 0 ? 'd0' : 'd1'].push(f);
  if (info.depth === 0) {
    if (!fnOwnerShared.has(name)) fnOwnerShared.set(name, []);
    fnOwnerShared.get(name).push(f);
  }
}
/* 真覆盖：同一共享作用域内同名（后者静默生效） */
const dupNames = [...fnOwnerShared].filter(([, v]) => v.length > 1).map(([k, v]) => [k, v]);
/* 同名但不同作用域：不构成覆盖，仅备查。两类——
 * ① 各自私有（两个 IIFE 各写一份，纯巧合同名）
 * ② 同名遮蔽（文件内私有那份遮住别处的全局同名，改全局时这份不会跟着变 → 漂移风险） */
const dupPrivate = [...fnDepthIdx]
  .filter(([k, v]) => !fnOwnerShared.has(k) ? v.d0.length + v.d1.length > 1 : v.d1.length > 0)
  .map(([k, v]) => [k, v]);
const dupShadow = dupPrivate.filter(([, v]) => v.d0.length && v.d1.length).map(([k]) => k);

/* 2.3 全局挂载名 → 归属文件（window.xxx = ... 与 window.NS = (function(){...})()） */
const globalOwner = new Map();
for (const f of files) {
  walk(mods[f].ast, (node) => {
    if (node.type !== 'AssignmentExpression') return;
    const mp = memberPath(node.left);
    if (!mp || !mp.startsWith('window.')) return;
    const top = mp.slice(7).split('.')[0];
    if (top && !globalOwner.has(top)) globalOwner.set(top, f);
  });
}

/* 2.4 appData 归属：let appData 在哪个文件声明（B 类边的目标） */
let appDataOwner = null;
for (const f of files) {
  walk(mods[f].ast, (node) => {
    if (node.type !== 'VariableDeclaration') return;
    for (const d of node.declarations)
      if (d.id.type === 'Identifier' && d.id.name === 'appData') appDataOwner = f;
  });
}
if (!appDataOwner) appDataOwner = '01b_engine_data.js';

/* ============================================================
 * 3. 边采集
 * ============================================================ */
const edges = [];
const edgeSeen = new Set();

const LAYER_OF = (f) => (f === TPL ? 0 : LAYER[f]);

function pushEdge(e) {
  const key = [e.kind, e.from, e.toFile || '', e.toFn || e.toSym || '', e.line].join('|');
  if (edgeSeen.has(key)) return;
  edgeSeen.add(key);
  e.layerFrom = LAYER_OF(e.from);
  e.layerTo = e.toFile ? LAYER_OF(e.toFile) : null;
  if (e.layerFrom != null && e.layerTo != null)
    e.dir = e.layerTo > e.layerFrom ? 'up' : (e.layerTo < e.layerFrom ? 'down' : 'same');
  else e.dir = 'unknown';
  /* criterion 是判据名字符串（或 null）；defensive 是它的布尔投影。
   * 保留判据名，才能回答"这条是被哪条判据判软的"——否则漏报面不可审计。 */
  e.criterion = e.criterion || null;
  e.defensive = !!e.criterion;
  edges.push(e);
}

/* 通用短名/方法名黑名单 —— 与 w6_layer.py 的 COMMON_NOISE 同源。
 * 不做这层过滤，`list.slice()` 会被误判成"调用了 08_component_registry.js 里的 list()"。 */
const COMMON_NOISE = new Set([
  'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'join', 'map', 'filter',
  'forEach', 'find', 'some', 'every', 'reduce', 'sort', 'concat', 'indexOf',
  'remove', 'add', 'get', 'set', 'has', 'list', 'done', 'cell', 'wrap', 'apply',
  'resolve', 'reject', 'then', 'catch', 'bind', 'call', 'enabled', 'unlocked',
  'warn', 'error', 'log', 'info', 'debug', 'build', 'init', 'update', 'render',
  'show', 'hide', 'close', 'open', 'reset', 'clear', 'load', 'save', 'check',
  'journey', 'state', 'value', 'name', 'type', 'key', 'data', 'item', 'items',
  'vis', 'run', 'verNum', 'curVer', 'allDone', 'totalPomos', '_recs', 'annSeen',
  'backupRecordsCSV', 'errBadgeOff', 'updateTitle',
  // 内置方法名（避免 obj.toString() 之类落到同名顶层函数上）
  'toString', 'valueOf', 'hasOwnProperty', 'toFixed', 'padStart', 'padEnd',
  'split', 'replace', 'test', 'exec', 'match', 'trim', 'charAt', 'substring',
  'toLowerCase', 'toUpperCase', 'startsWith', 'endsWith', 'includes', 'repeat',
  'getTime', 'pushState', 'addEventListener', 'removeEventListener',
  'setAttribute', 'getAttribute', 'removeAttribute', 'appendChild', 'setItem',
  'getItem', 'removeItem', 'querySelector', 'querySelectorAll', 'getElementById',
  'stringify', 'parse', 'assign', 'keys', 'values', 'entries', 'from', 'isArray',
  'floor', 'ceil', 'round', 'abs', 'min', 'max', 'pow', 'random', 'now',
]);

const BUILTIN_OBJS = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
  'Date', 'RegExp', 'Promise', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Symbol',
  'document', 'window', 'localStorage', 'sessionStorage', 'indexedDB', 'location',
  'history', 'navigator', 'performance', 'CustomEvent', 'Event',
  'requestAnimationFrame', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
]);

/* 防御式调用的文本兜底判据（最弱，命中即标注 context-240 供人工复核） */
const DEF_RE = /typeof\s+[\w.$]*\s*===?\s*['"]function['"]|typeof\s+window\.|window\.store\s*&&|typeof\s+[\w$]+\s*!==?\s*['"]undefined['"]/;

/* 防御式调用判定 —— 与 w6_layer.py 同口径。
 * 返回命中判据的**名称**（字符串）或 null，而不是布尔值：
 * 'if-guard' if (window.foo) window.foo(...) ← 条件里出现 callee 的前缀
 * 'if-typeof' if (typeof foo === 'function') foo(...)
 * 'logical' guard && foo(...) / guard || foo(...)
 * 'ternary' guard ? foo(...) : fallback
 * 'context-240' 调用点所在语句 ±240 字符内出现 DEF_RE（兜底，最弱，需人工复核）
 * 【精确命中条件】if-guard
 * 设 callee 的完整路径为 C（如 `window.__errRep.warn`），
 * 设 guard 文本中出现且被 `window.` 限定的标识符为 G（如 `window.__errRep`）。
 * 命中 = 存在某个 G，使 **G 是 C 的前缀**（G == C 或 C 以 G + '.' 开头）。
 * —— 即"守卫的正是我要调的那个对象"。
 * 反之，若 guard 里出现的是 **别的** window.X（G 不是 C 的前缀），
 * 则本条**不算** if-guard 防御，落入 `guard-mismatch`（吞掉风险面），
 * 由 --evidence 单列，强制人工目视，而不是被静默归入"防御式"。
 * 上一版曾把"callee 是否含 window."当作吞掉测度 —— 那是错的：
 * `if (window.X) window.Y()` 里两部分都含 window.，但 guard 的不是 Y。
 */
function isDefensive(node, parent, src, calleePath) {
  /* 最强判据：调用位于 `if (guard) call` 的 then 分支里 */
  {
    let p = node;
    for (let i = 0; i < 5 && p && p.__parent; i++) {
      p = p.__parent;
      if (p.type === 'IfStatement') {
        const cond = src.slice(p.test.start, p.test.end);
        if (/^\s*typeof\s/.test(cond)) return 'if-typeof';
        if (calleePath) {
          /* guard 里所有 "window.X" 形态的被守卫对象 */
          const guards = [...cond.matchAll(/window\.([A-Za-z_$][\w$]*)/g)].map((m) => 'window.' + m[1]);
          if (guards.length) {
            /* C 的所有前缀（从 window 到完整路径） */
            const segs = calleePath.split('.');
            const prefixes = [];
            for (let k = 1; k <= segs.length; k++) prefixes.push(segs.slice(0, k).join('.'));
            /* 命中 = 某个 guard 是 C 的前缀；且 guard 里确实描述了"存在性/类型" */
            const hit = guards.some((g) => prefixes.includes(g) || calleePath.startsWith(g + '.'));
            if (hit && /(^|[^!<>=])=[^=]|typeof|&&|\|\||window\./.test(cond)) return 'if-guard';
            /* guard 写的是别的对象 → 吞掉风险面，单列而非静默归软 */
            if (!hit) return 'guard-mismatch';
          }
        }
        break;
      }
      if (p.type === 'VariableDeclarator') break;
    }
  }
  /* 次强：`cond && call()` / `cond || call()` */
  if (parent && parent.type === 'LogicalExpression' &&
      (parent.operator === '&&' || parent.operator === '||')) {
    const other = parent.left === node ? parent.right : parent.left;
    if (other && other.start != null) {
      const o = src.slice(other.start, other.end);
      if (DEF_RE.test(o) || /typeof/.test(o) || /^[\s(]*window\./.test(o)) return 'logical';
    }
  }
  /* 三元守卫：`guard ? call() : fallback` */
  if (parent && parent.type === 'ConditionalExpression') {
    const test = src.slice(parent.test.start, parent.test.end);
    if (/typeof/.test(test) || /^[\s(]*window\./.test(test)) return 'ternary';
  }
  /* 兜底：调用点所在语句 ±240 字符内出现 DEF_RE（最弱判据） */
  let q = node;
  for (let i = 0; i < 8 && q && q.__parent; i++) {
    if (q.type === 'IfStatement' || q.type === 'ExpressionStatement' ||
        q.type === 'VariableDeclarator' || q.type === 'LogicalExpression' ||
        q.type === 'ConditionalExpression') break;
    q = q.__parent;
  }
  const s = q && q.start != null ? q.start : node.start;
  const e = q && q.end != null ? q.end : node.end;
  const ctx = src.slice(Math.max(0, s - 240), Math.min(src.length, e + 60));
  if (DEF_RE.test(ctx)) return 'context-240';
  return null;
}

function stateRole(node, parent) {
  if (!parent) return 'read';
  if (parent.type === 'AssignmentExpression' && parent.left === node) return 'write';
  if (parent.type === 'UpdateExpression' && parent.argument === node) return 'write';
  if (parent.type === 'UnaryExpression' && parent.operator === 'delete') return 'write';
  return 'read';
}

/* 3.1 DOM id：谁用 / 谁建 */
const domUsed = new Map();
const domCreated = new Map();

for (const f of files) {
  walk(mods[f].ast, (node) => {
    // getElementById('x') / querySelector('#x')
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const mp = memberPath(node.callee);
      const a0 = node.arguments[0];
      if (mp && (mp === 'document.getElementById' || mp === 'document.querySelector') && isLiteralString(a0)) {
        const raw = String(litValue(a0));
        const id = mp.endsWith('querySelector') ? (/^#([\w-]+)$/.exec(raw) || [])[1] : raw;
        if (id) { if (!domUsed.has(id)) domUsed.set(id, new Set()); domUsed.get(id).add(f); }
      }
    }
    // x.id = 'y'
    if (node.type === 'AssignmentExpression' && node.operator === '=' &&
        node.left.type === 'MemberExpression' && !node.left.computed &&
        node.left.property.type === 'Identifier' && node.left.property.name === 'id' &&
        isLiteralString(node.right)) {
      const id = String(litValue(node.right));
      if (!domCreated.has(id)) domCreated.set(id, new Set());
      domCreated.get(id).add(f);
    }
    // innerHTML = '...id="x"...' （静态拼接也算创建）
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
        !node.left.computed && node.left.property.type === 'Identifier' &&
        node.left.property.name === 'innerHTML') {
      const text = literalConcat(node.right);
      if (text && text.includes('id=')) {
        const re = /\bid=["']([^"']+)["']/g;
        let g;
        while ((g = re.exec(text))) {
          if (!domCreated.has(g[1])) domCreated.set(g[1], new Set());
          domCreated.get(g[1]).add(f);
        }
      }
    }
  });
}

function literalConcat(n) {
  if (!n) return null;
  if (isLiteralString(n)) return String(litValue(n));
  if (n.type === 'BinaryExpression' && n.operator === '+') {
    const l = literalConcat(n.left), r = literalConcat(n.right);
    return l == null || r == null ? null : l + r;
  }
  return null;
}

/* template.html 里的静态 id */
const tplIds = new Set();
{
  const html = fs.readFileSync(TEMPLATE, 'utf8');
  const re = /\bid=["']([^"']+)["']/g;
  let g;
  while ((g = re.exec(html))) tplIds.add(g[1]);
}

/* 3.2 逐模块扫 call / state 边 */
for (const f of files) {
  const m = mods[f];
  /* 先算「本模块自身定义/绑定的名字」：局部 const/let/var、形参、内层 function。
   * 这是正则工具**做不到**的一层：`const pick = function(){}` 与跨模块的
   * `pick()` 同名，正则必然误报（w6_layer.py 现在就在误报这一条）。 */
  const localBindings = collectLocalBindings(m.ast);

  walk(m.ast, (node, parent) => {
    /* ---- A. CallExpression ---- */
    if (node.type === 'CallExpression') {
      const line = node.loc.start.line;
      const callee = node.callee;
      const criterion = isDefensive(node, parent, m.src, memberPath(callee));

      // 裸调用 foo()
      if (callee.type === 'Identifier') {
        const name = callee.name;
        // 本模块自己有同名绑定（局部函数/变量/形参）→ 不是跨模块依赖
        if (!COMMON_NOISE.has(name) && name.length > 3 && !localBindings.has(name)) {
          const owners = fnOwner.get(name);
          if (owners) for (const o of owners) {
            if (o === f) continue;
            pushEdge({ kind: 'call', from: f, toFile: o, toFn: name, line, via: name + '()', criterion });
          }
        }
      }
      // 成员调用 window.foo() / NS.fn() / a.b()
      else if (callee.type === 'MemberExpression') {
        const mp = memberPath(callee);
        if (!mp) { /* skip */ }
        else if (mp.startsWith('window.')) {
          const parts = mp.slice(7).split('.');
          const top = parts[0], sub = parts[1];
          const owner = globalOwner.get(top);
          // window.foo() 且 foo 就是被挂上去的顶层函数 → 也算该模块的调用面
          if (owner && owner !== f) {
            pushEdge({ kind: 'call', from: f, toFile: owner,
                       toSym: 'window.' + top + (sub ? '.' + sub : ''), line,
                       via: 'window.' + top + (sub ? '.' + sub : '') + '()', indirect: true, criterion });
          }
        } else if (mp.includes('.')) {
          const [obj, method] = mp.split('.');
          const owner = globalOwner.get(obj);
          const looksCustom = method && !COMMON_NOISE.has(method) &&
                              (!BUILTIN_OBJS.has(obj) || globalOwner.has(obj));
          if (owner && owner !== f && looksCustom) {
            pushEdge({ kind: 'call', from: f, toFile: owner, toSym: obj + '.' + method, line,
                       via: mp + '()', indirect: true, criterion });
          }
        }
      }
    }

    /* ---- B. MemberExpression：appData 全局状态读写 ---- */
    if (node.type === 'MemberExpression') {
      const mp = memberPath(node);
      if (mp && (mp === 'appData' || mp.startsWith('appData.'))) {
        // 只记最外层（`appData.a.b` 会同时命中内层 `appData.a`，去重后只留最长路径）
        if (parent && parent.type === 'AssignmentExpression' && parent.left === node) return; // 交给外层
        pushEdge({ kind: 'state', from: f, toFile: appDataOwner, toSym: mp,
                   line: node.loc.start.line, via: mp, role: stateRole(node, parent),
                   criterion: isDefensive(node, parent, m.src) });
      }
    }
  });
}

/* 3.3 DOM 契约边：用方 → 建方 */
for (const [id, users] of domUsed) {
  const creators = new Set();
  if (domCreated.has(id)) for (const c of domCreated.get(id)) creators.add(c);
  if (tplIds.has(id)) creators.add(TPL);
  if (!creators.size) continue;
  for (const u of users) for (const c of creators) {
    if (c === u) continue;
    pushEdge({ kind: 'dom', from: u, toFile: c, toSym: '#' + id, line: 0, via: '#' + id });
  }
}

/* 收集一个模块内所有「局部绑定名」：
 * - 任意层级的 VariableDeclarator（const/let/var）
 * - 任意 FunctionDeclaration 的名字（含嵌套）
 * - 函数形参（含解构）
 * - catch 的 param
 * 有了它，`const pick = ...` 就不会被误判成「调用了别的模块的 pick()」。 */
function collectLocalBindings(ast) {
  const names = new Set();
  const addPattern = (p) => {
    if (!p) return;
    if (p.type === 'Identifier') names.add(p.name);
    else if (p.type === 'ObjectPattern') for (const pr of p.properties) addPattern(pr.value || pr.argument);
    else if (p.type === 'ArrayPattern') for (const el of p.elements) addPattern(el);
    else if (p.type === 'AssignmentPattern') addPattern(p.left);
    else if (p.type === 'RestElement') addPattern(p.argument);
  };
  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator') addPattern(node.id);
    else if (node.type === 'FunctionDeclaration' && node.id) names.add(node.id.name);
    else if (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      for (const p of node.params) addPattern(p);
      if (node.id) names.add(node.id.name);
    } else if (node.type === 'CatchClause') addPattern(node.param);
    else if (node.type === 'ClassDeclaration' && node.id) names.add(node.id.name);
  });
  return names;
}

/* ============================================================
 * 4. 汇总
 * ============================================================ */
const byKind = { call: 0, state: 0, dom: 0 };
for (const e of edges) byKind[e.kind]++;

const inDeg = {}, outDeg = {};
for (const f of [...files, TPL]) { inDeg[f] = 0; outDeg[f] = 0; }
for (const e of edges) {
  if (outDeg[e.from] != null) outDeg[e.from]++;
  if (e.toFile && inDeg[e.toFile] != null) inDeg[e.toFile]++;
}

/* ── 人工复核登记表（weak-criterion 软依赖） ──
 * 键 = `文件:行:callee`；值 = 复核结论。
 * 只有登记为 'defensive' 的条目，才从硬违例上界里扣除（区间收紧）。
 * 登记为 'hard' 的条目会被**并入硬违例**——即人工推翻工具判定。
 * 未登记的弱判据条目一律计入上界（保守）。
 * 维护纪律：改源码导致行号漂移时，这里的键会失配 → 上界自动回退变宽，
 * 不会"悄悄变窄"，这是刻意的失效方向。 */
const REVIEWED = {
  '01d_engine_features.js:5413:window.rsConfirm': 'defensive',  // typeof window.rsConfirm==='function' ? await ... : window.confirm
  '01d_engine_features.js:5487:window.rsConfirm': 'defensive',  // 同上（延后今日任务）
};

/* 层违例（与 w6_layer 同口径：下层调上层 且 非防御式） —— 只算跨文件 call/state/dom */
const hardViol = edges.filter((e) => e.dir === 'up' && !e.defensive);
const softDep = edges.filter((e) => e.dir === 'up' && e.defensive);

/* ── 硬违例的真实区间 [下界, 上界] ──
 * 下界 = 判非防御式（工具把握）+ 人工登记的 'hard'（人工推翻工具）。
 * 上界 = 下界 + 尚未登记的弱判据软依赖（context-240 / guard-mismatch）。
 * 这些"若判错就是硬违例"，必须单列，否则上界收不紧。
 * 上下界相等 = 区间已收紧，结论可当定论。 */
const WEAK_CRITERIA = new Set(['context-240', 'guard-mismatch']);
/* 注意：边对象上的字段是 `toSym`/`toFn`（JSON 序列化时才改名 sym/to_fn）。
 * 键格式：`文件:行:符号` —— 与 --evidence 打印的一致，便于人工对照登记。 */
const edgeKey = (e) => `${e.from}:${e.line}:${e.toSym || e.toFn || e.via}`;
const reviewedDefensive = new Set();
const promotedHard = [];
for (const e of softDep) {
  const v = REVIEWED[edgeKey(e)];
  if (v === 'defensive') reviewedDefensive.add(e);
  else if (v === 'hard') promotedHard.push(e);
}
const unrevWeak = softDep.filter((e) =>
  WEAK_CRITERIA.has(e.criterion) && !reviewedDefensive.has(e));
const bound = {
  lower: hardViol.length + promotedHard.length,
  upper: hardViol.length + promotedHard.length + unrevWeak.length,
  weak: unrevWeak.length,
  reviewed: reviewedDefensive.size,
  strong: softDep.length - softDep.filter((e) => WEAK_CRITERIA.has(e.criterion)).length,
};

/* ============================================================
 * 5. 视角开关（--evidence 输出完整证据清单）
 * ============================================================ */
const SHOW_EVIDENCE = HAS('--evidence');

/* 每一条 up 边都带「判定依据」，供人工复核「判据判过的东西里有没有判错的」 */
function upEdgeRow(e) {
  const d = e.defensive ? '软' : '硬';
  const crit = e.defensive ? e.criterion : '—';
  return `  [${d}] ${e.kind.padEnd(5)} ${e.from} → ${e.toFile}  ${e.via}  :${e.line}` +
         `  判据=${crit}`;
}

/* ============================================================
 * 5.5 --evidence：把「报了数字但没给证据」的四类全部输出
 * ① 每条 up 边的逐条明细 + 判据名（硬/软都列）
 * ② 重名顶层函数 39 条（名字 + 全部定义文件）
 * ③ 判据分布（软依赖按判据归类；context-240 是最弱判据，必须人工复核）
 * ============================================================ */
if (HAS('--evidence')) {
  console.log('=== 证据清单（--evidence） ===\n');

  console.log(`【① 层向上依赖逐条】共 ${hardViol.length + softDep.length} 条`
    + `（硬 ${hardViol.length} · 软 ${softDep.length}）`);
  console.log('  ── 硬违例（非防御式，判据=—）──');
  if (!hardViol.length) console.log('  (无)');
  for (const e of hardViol) console.log(upEdgeRow(e));
  console.log('  ── 软依赖（防御式，逐条标出判据）──');
  for (const e of softDep) console.log(upEdgeRow(e));

  console.log(`\n【② 重名顶层函数】真覆盖 ${dupNames.length} 组`
    + `（只算 depth=0：拼接后共享脚本作用域）`);
  for (const [n, fs2] of dupNames.slice().sort()) {
    console.log(`  ${n}  →  ${fs2.join(', ')}`);
  }
  console.log(`  另有同名私有 ${dupPrivate.length} 组（作用域不相交，不算覆盖；`
    + `其中同名遮蔽 ${dupShadow.length} 组，如 ${dupShadow.slice(0, 3).sort().join('/') || '无'}）`);

  console.log('\n【③ 软依赖判据分布】');
  const critCount = {};
  for (const e of softDep) critCount[e.criterion] = (critCount[e.criterion] || 0) + 1;
  for (const [k, v] of Object.entries(critCount).sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(14)} ${v} 条`);
  console.log(`  ── 合计 ${softDep.length} 条`);
  console.log('\n  ⚠️ 判据说明（漏报面在此）:');
  console.log('    if-guard    : `if (window.foo) window.foo(...)` —— 精确条件：guard 里出现的');
  console.log('                  某个 `window.X` 必须是 callee 路径的**前缀**（守卫的正是被调对象）。');
  console.log('                  若 guard 写的是别的 window.Y，则不算防御式而落 guard-mismatch。');
  console.log("    if-typeof   : `if (typeof foo === 'function')` —— 教科书防御，误判面最小。");
  console.log('    logical     : `guard && foo()` / `guard || foo()`。');
  console.log('    ternary     : `guard ? foo() : fallback`。');
  console.log('    context-240 : ★最弱。仅在调用点 ±240 字符内见到 DEF_RE 字样就判软，需人工复核。');
  console.log('    guard-mismatch: ★若出现，= guard 守的不是被调对象，有吞掉真依赖的风险。');

  console.log(`\n【④ 硬违例区间】[${bound.lower}, ${bound.upper}]`
    + (bound.lower === bound.upper ? '  ✅ 已收紧' : '  ⚠️ 未收紧'));
  console.log(`  下界 = 判非防御式 ${hardViol.length}`
    + (promotedHard.length ? ` + 人工推翻 ${promotedHard.length}` : ''));
  console.log(`  上界 = 下界 + 未复核的弱判据软依赖 ${bound.weak}`);
  console.log(`  人工复核登记（REVIEWED）：${bound.reviewed} 条`);
  for (const [k, v] of Object.entries(REVIEWED)) {
    const matched = softDep.some((e) => edgeKey(e) === k);
    console.log(`    ${matched ? '✓' : '✗ 失配(行号可能已漂移)'} ${v.padEnd(10)} ${k}`);
  }
  if (bound.weak) {
    console.log('  ⚠️ 以下弱判据条目未登记，需人工目视后写进 REVIEWED：');
    for (const e of unrevWeak) console.log(`    ? ${edgeKey(e)}  (${e.criterion})`);
  }

  process.exit(0);
}

/* ============================================================
 * 6. --selfcheck
 * selfcheck 摘要是**门禁判据**，不是统计快照。它只含两类字段：
 * ① 始终必须成立的不变量：acorn 版本、模块能否全部解析、层级是否全部登记
 * ② 供人工比对"是否异常跳变"的规模数字：edges / by_kind / dup
 * 为什么不写进版本库：② 类数字会随源码漂移，入库立刻过期，读的人会当成"当前值"。
 * 所以 callgraph.json 与 callgraph.selfcheck.json 都在 .gitignore 里，
 * 按需用 `node tools/callgraph_ast.js [--selfcheck]` 重建。
 * 真正该长期留存的边界说明，写在 tools/callgraph_ast.js 头注释与
 * docs/current/AST调用图与依赖工具对照.md 的「边界」一节（人读，不随代码漂）。
 * ============================================================ */
if (HAS('--selfcheck')) {
  const unreg = files.filter((f) => !(f in LAYER));
  const selfcheck = {
    // ① 不变量（变了就是工具坏了/漏登记）
    acorn: acorn.version,
    modules: files.length,
    unregistered: unreg,
    parse_ok: true,
    // ② 规模数字（供比对跳变，非"验收值"）
    top_fns: fnOwner.size,
    edges: edges.length,
    by_kind: byKind,
    dup_groups: dupNames.length,
    dup_private_groups: dupPrivate.length,
    hard_up: hardViol.length,
    soft_up: softDep.length,
    /* 判据分布——漏报面就在这：context-240 条目越少越可信 */
    soft_by_criterion: softDep.reduce((a, e) => (a[e.criterion] = (a[e.criterion] || 0) + 1, a), {}),
    hard_bound: [bound.lower, bound.upper],
    weak_soft: bound.weak,
  };
  console.log('=== callgraph_ast 自检 ===');
  console.log('acorn 版本      :', acorn.version, '(不变量)');
  console.log('模块数          :', files.length, unreg.length ? `(未登记层: ${unreg})` : '(全部已登记层)');
  console.log('顶层函数(去重)  :', fnOwner.size, '| 真覆盖:', dupNames.length, '组',
    `| 同名私有(不覆盖): ${dupPrivate.length} 组`);
  console.log('边总数          :', edges.length, `(call=${byKind.call} state=${byKind.state} dom=${byKind.dom})`);
  console.log('appData 归属    :', appDataOwner);
  console.log('全局挂载名      :', globalOwner.size);
  console.log('层向上依赖      : 硬', hardViol.length, '· 软(防御式)', softDep.length);
  console.log('软依赖判据分布  :', JSON.stringify(selfcheck.soft_by_criterion));
  console.log(`硬违例区间      : [${bound.lower}, ${bound.upper}]`
    + `  （下界=判非防御式；上界=下界+${bound.weak}条弱判据软依赖）`
    + (bound.lower === bound.upper ? '  ✅ 已收紧' : ''));
  if (bound.weak) {
    console.log(`  ⚠️ 上界未收紧：${bound.weak} 条弱判据软依赖需人工目视（--evidence 会列出源码行）`);
    console.log(`     复核完请在下方 REVIEWED 集合里登记，区间才会收成 [${bound.lower}, ${bound.lower}]。`);
  }
  fs.writeFileSync(OUT_JSON.replace(/\.json$/, '.selfcheck.json'),
    JSON.stringify(selfcheck, null, 2), 'utf8');
  process.exit(unreg.length ? 1 : 0);
}

/* ============================================================
 * 6. --impact / --module
 * ============================================================ */
if (HAS('--impact')) {
  const fn = VAL('--impact');
  const owners = fnOwner.get(fn) || [];
  console.log(`目标函数: ${fn}`);
  console.log(`定义于  : ${owners.length ? owners.map((o) => o + ' [L' + LAYER[o] + ']').join(', ') : '⚠️ 未找到顶层定义'}`);
  console.log('\n【谁调用我】（入向 call 边）');
  const ins = edges.filter((e) => e.kind === 'call' && e.toFn === fn);
  if (!ins.length) console.log('  (无跨模块调用点)');
  for (const e of ins)
    console.log(`  ← ${e.from} [${LAYER_NAME[e.layerFrom]}] :${e.line}  ${e.via}${e.defensive ? '  (软)' : ''}`);
  if (owners.length) {
    console.log(`\n【我依赖谁】（${owners[0]} 的出向 call 边）`);
    const uniq = {};
    for (const e of edges) if (e.kind === 'call' && e.from === owners[0])
      uniq[e.toFile] = (uniq[e.toFile] || 0) + 1;
    const ent = Object.entries(uniq).sort((a, b) => b[1] - a[1]);
    if (!ent.length) console.log('  (无跨模块调用)');
    for (const [k, v] of ent) console.log(`  → ${k} [${LAYER_NAME[LAYER[k]] || '?'}]  ${v} 处`);
  }
  process.exit(0);
}

if (HAS('--module')) {
  const f = VAL('--module');
  const mm = files.find((x) => x === f) || files.find((x) => x.includes(f));
  if (!mm) { console.log(`未找到模块: ${f}`); process.exit(2); }
  console.log(`模块: ${mm}  [${LAYER_NAME[LAYER[mm]] || '未登记'}]`);
  const o = {}, i = {}, ok = {};
  for (const e of edges) {
    if (e.from === mm && e.toFile) { o[e.toFile] = (o[e.toFile] || 0) + 1; ok[e.kind] = (ok[e.kind] || 0) + 1; }
    if (e.toFile === mm && e.from) i[e.from] = (i[e.from] || 0) + 1;
  }
  console.log('\n【出向】依赖了谁');
  for (const [k, v] of Object.entries(o).sort((a, b) => b[1] - a[1]))
    console.log(`  → ${k} [${LAYER_NAME[LAYER[k]] || '静态结构'}]  ${v}`);
  console.log('  按类型:', JSON.stringify(ok));
  console.log('\n【入向】谁依赖我');
  for (const [k, v] of Object.entries(i).sort((a, b) => b[1] - a[1]))
    console.log(`  ← ${k} [${LAYER_NAME[LAYER[k]] || '?'}]  ${v}`);
  process.exit(0);
}

/* ============================================================
 * 7. 默认：写 JSON + 报告
 * ============================================================ */
const out = {
  meta: {
    tool: 'callgraph_ast.js',
    acorn: acorn.version,
    modules: files.length,
    top_fns: fnOwner.size,
    edges: edges.length,
    by_kind: byKind,
    appData_owner: appDataOwner,
    hard_up: hardViol.length,
    soft_up: softDep.length,
  },
  layers: LAYER,
  globals: Object.fromEntries(globalOwner),
  duplicate_fns: dupNames.map(([n, fs2]) => ({ name: n, files: fs2 })),
  private_same_name_fns: dupPrivate.map(([n, fs2]) => ({ name: n, files: fs2 })),
  edges: edges.map((e) => ({
    kind: e.kind, from: e.from, to: e.toFile,
    to_fn: e.toFn || null, sym: e.toSym || null,
    line: e.line, via: e.via, role: e.role || null,
    layer_from: e.layerFrom, layer_to: e.layerTo, dir: e.dir,
    indirect: !!e.indirect, defensive: !!e.defensive, criterion: e.criterion,
  })),
};

if (HAS('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
/* 默认输出压缩版 JSON（1.4 MB 的可读缩进版是派生快照，不值得进版本库；
 * 需要人工细看时用 --json 打印到 stdout）。 */
fs.writeFileSync(OUT_JSON, JSON.stringify(out), 'utf8');

console.log('=== AST 调用图（D 方案） ===');
console.log(`acorn ${acorn.version} · 模块 ${files.length} · 顶层函数 ${fnOwner.size} · 边 ${edges.length}`);
console.log(`  call=${byKind.call}  state=${byKind.state}  dom=${byKind.dom}`);
console.log(`  appData 归属 ${appDataOwner} · 全局挂载名 ${globalOwner.size}`
  + ` · 真覆盖 ${dupNames.length} 组 · 同名私有 ${dupPrivate.length} 组`);
console.log(`已写 ${path.relative(ROOT, OUT_JSON)}`);

console.log('\n【被依赖 Top12】（入度，三类边合计）');
for (const [f, v] of Object.entries(inDeg).sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`  ${f.padEnd(32)} ${String(v).padStart(5)}   ${f === TPL ? '静态结构' : (LAYER_NAME[LAYER[f]] || '未登记')}`);

console.log('\n【依赖他人 Top12】（出度）');
for (const [f, v] of Object.entries(outDeg).sort((a, b) => b[1] - a[1]).slice(0, 12))
  console.log(`  ${f.padEnd(32)} ${String(v).padStart(5)}   ${LAYER_NAME[LAYER[f]] || '未登记'}`);

console.log(`\n层向上依赖: 硬违例 ${hardViol.length} 条 · 软依赖(防御式) ${softDep.length} 条`);
/* 正/反向表：重依赖模块只给数字，稀疏方向才铺开画边 */
console.log('\n【硬违例明细】（下层反向依赖上层，且非防御式）');
const byPair = {};
for (const e of hardViol) {
  const k = e.from + ' → ' + e.toFile;
  (byPair[k] = byPair[k] || { n: 0, layers: [e.layerFrom, e.layerTo], fns: new Set(), sample: e });
  byPair[k].n++;
  byPair[k].fns.add(e.via);
}
for (const [k, v] of Object.entries(byPair).sort((a, b) => b[1].n - a[1].n)) {
  const fns = [...v.fns];
  const brief = fns.length <= 4 ? fns.join(', ') : `${fns.slice(0, 4).join(', ')} … (+${fns.length - 4})`;
  console.log(`  ✗ ${k}  L${v.layers[0]}→L${v.layers[1]}  ${v.n} 处  [${brief}]`);
}

if (dupNames.length) {
  console.log(`\n⚠️ 真覆盖 ${dupNames.length} 组（depth=0 同名，后加载的静默生效）`);
  for (const [n, fs2] of dupNames) console.log(`  ${n}: ${fs2.join(', ')}`);
}
if (dupPrivate.length) {
  console.log(`\nℹ️ 同名私有 ${dupPrivate.length} 组（各自 IIFE 内，不构成覆盖；仅供检索时留意）`);
}
