#!/usr/bin/env node
/**
 * 作用域感知的「重名顶层函数」门禁（S1）
 * ============================================================
 * 为什么要有这段
 * ------------------------------------------------------------
 * `tools/callgraph_ast.js` 的 `duplicate_fns` 曾经报「13 组重名顶层函数，
 * 后加载的静默覆盖前面的」。2026-11-14 逐个查证，**13 组全是误报**：
 *
 *   它把 depth=0（文件顶层）和 depth=1（文件自己 IIFE 里的私有函数）
 *   混进同一张 name→files 表。`q` / isMinimal / patchObserver 在
 *   07_uiFold 与 08_component_registry 里各有一份，但两份都在各自的
 *   `(function(){ ... })()` 里，作用域不相交，不可能覆盖。
 *
 * 反证不需要跑代码：同一份 callgraph.json 的 `globals`（245 个，口径是
 * 「window.xxx 赋值」）里，这 13 个名字**一个都不在** —— 一个工作正常的
 * 工具不会同时说「它不是全局」和「它被后加载的覆盖」。
 *
 * 所以本段守的不是"名字重复"，而是**同一作用域内同名声明**（真覆盖）。
 * 判据只有一条：把源码按真实作用域树铺开，同一个作用域里出现两次
 * function/let/const 同名声明 → FAIL。
 *
 * 口径（严格版）
 * ------------------------------------------------------------
 * - 跨文件：所有文件的 depth=0 声明并入**同一张全局表**。发布物是单模块，
 *   各 slot 本是独立 <script>，但 `--classic` 回退时 9 个 <script> 共享
 *   window —— 那种情况下重名就是真覆盖。按最严的守，不按最松的守。
 * - 块级：let/const 绑定在当前块（BlockStatement / For* / CatchClause），
 *   var 与函数声明提升到最近的函数（或顶层）。不做这个区分，就会把
 *   `for (const x of a){} for (const x of b){}` 误报成重名 —— 那是合法且常见的。
 * - var 重名**只统计不判红**：`var x` 写在两个 if 里是合法的老写法，
 *   判红等于逼人做无关重构。
 *
 * 跑法: node tools/check_scoped_dups.js        退出码 0 = 通过
 *       node tools/check_scoped_dups.js --list 顺带打印同名但各自私有的清单
 */
'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('./vendor/acorn.js');

const ROOT = path.dirname(__dirname);
const SCRIPTS = path.join(ROOT, 'src', 'scripts');
const MANIFEST = path.join(ROOT, 'src', 'manifest.json');
const LIST = process.argv.includes('--list');

/* ---------- 加载顺序（manifest 是唯一事实源，别用 readdir 排序猜） ---------- */
function loadOrder() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const out = [];
  for (const s of m.slots) {
    if (s.files) out.push(...s.files);
    if (s.file) out.push(s.file);
  }
  return out;
}

const FN_NODE = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

let sid = 0;
function newScope(kind, parent) {
  return { id: sid++, kind, parent, names: new Map() };
}

const violations = [];   // 真覆盖：同一作用域内 let/const/function 重名
let varDupCount = 0;
const allBindings = [];  // {scope, name, kind, file, line}

function bind(scope, name, kind, file, line) {
  if (!scope.names.has(name)) scope.names.set(name, []);
  const list = scope.names.get(name);
  list.push({ kind, file, line });
  allBindings.push({ scope, name, kind, file, line });
}

function nearestFnScope(s) {
  let cur = s;
  while (cur && cur.kind !== 'fn' && cur.kind !== 'global') cur = cur.parent;
  return cur || s;
}

/**
 * 遍历一个文件。depth=0 的声明绑到 globalScope（跨文件共享），
 * 其余按真实作用域树绑定。
 */
function visitFile(ast, file, globalScope) {
  function visit(node, scope, isFnBody) {
    if (!node || typeof node.type !== 'string') return;
    let cur = scope;

    if (FN_NODE.has(node.type)) {
      // 函数声明名绑在**外层**作用域（何况 sloppy 下就是提升到外层）
      if (node.type === 'FunctionDeclaration' && node.id) {
        const target = (scope === globalScope) ? globalScope : scope;
        bind(target, node.id.name, 'function', file, node.loc.start.line);
      }
      cur = newScope('fn', scope);
      if (node.type === 'FunctionExpression' && node.id) {
        bind(cur, node.id.name, 'function', file, node.loc.start.line);
      }
      for (const p of node.params) bindParams(p, cur);
      if (node.body.type === 'BlockStatement') {
        for (const stmt of node.body.body) visit(stmt, cur, true);
      } else {
        visit(node.body, cur, false);   // 箭头函数表达式体
      }
      return;
    }

    if (node.type === 'BlockStatement' && !isFnBody) {
      cur = newScope('block', scope);
      for (const stmt of node.body) visit(stmt, cur, false);
      return;
    }

    if (node.type === 'VariableDeclaration') {
      const target = node.kind === 'var' ? nearestFnScope(scope) : scope;
      for (const d of node.declarations) {
        for (const nm of patternNames(d.id)) bind(target, nm, node.kind, file, node.loc.start.line);
        if (d.init) visit(d.init, scope, false);
      }
      return;
    }

    if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const inner = newScope('block', scope);
      for (const k of ['init', 'left', 'right', 'test', 'update', 'body']) {
        if (node[k]) visit(node[k], inner, false);
      }
      return;
    }

    if (node.type === 'CatchClause') {
      const inner = newScope('block', scope);
      if (node.param) bindParams(node.param, inner);
      visit(node.body, inner, false);
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, cur, false); }
      else if (v && typeof v.type === 'string') visit(v, cur, false);
    }
  }

  function bindParams(p, scope) {
    if (!p) return;
    if (p.type === 'Identifier') { bind(scope, p.name, 'param', file, p.loc.start.line); return; }
    for (const nm of patternNames(p, true)) bind(scope, nm, 'param', file, p.loc.start.line);
    // 默认值里的表达式可能含函数
    if (p.type === 'AssignmentPattern') visit(p.right, scope, false);
  }

  function patternNames(p, deep) {
    const out = [];
    (function rec(n) {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'Identifier') out.push(n.name);
      else if (n.type === 'ObjectPattern') for (const pr of n.properties) rec(pr.value || pr.argument);
      else if (n.type === 'ArrayPattern') for (const el of n.elements) rec(el);
      else if (n.type === 'AssignmentPattern') rec(n.left);
      else if (n.type === 'RestElement') rec(n.argument);
      else if (n.type === 'Property') rec(n.value);
    })(p);
    return out;
  }

  for (const stmt of ast.body) visit(stmt, globalScope, false);
}

/* ---------- 主流程 ---------- */
const order = loadOrder();
const globalScope = newScope('global', null);   // 跨文件共享：depth=0 全在这里
const privateNames = new Map();                  // name -> [file:line]（各自 IIFE 私有）

let depth0 = 0;
let privateFns = 0;

for (const f of order) {
  const p = path.join(SCRIPTS, f);
  if (!fs.existsSync(p)) { console.error(`✗ manifest 里的文件不存在: ${f}`); process.exit(2); }
  const src = fs.readFileSync(p, 'utf8');
  let ast;
  try {
    ast = acorn.parse(src, {
      ecmaVersion: 2022, sourceType: 'script', locations: true,
      allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true,
    });
  } catch (e) {
    console.error(`✗ 解析失败 ${f}: ${e.message}`);
    process.exit(2);
  }
  const before = globalScope.names.size;
  visitFile(ast, f, globalScope);
  depth0 += globalScope.names.size - before;
}

/* 判定 */
for (const [name, list] of globalScope.names) {
  const hard = list.filter((b) => b.kind !== 'var' && b.kind !== 'param');
  if (hard.length > 1) violations.push({ scope: 'global', name, list: hard });
}
/* 非全局作用域：逐 scope 判 */
(function scanPrivateScopes() {
  /* visitFile 里 bind 到私有作用域的记录都在 allBindings，用 scope 分组 */
  const byScope = new Map();
  for (const b of allBindings) {
    if (b.scope === globalScope) continue;
    if (!byScope.has(b.scope.id)) byScope.set(b.scope.id, { scope: b.scope, names: new Map() });
    const g = byScope.get(b.scope.id);
    if (!g.names.has(b.name)) g.names.set(b.name, []);
    g.names.get(b.name).push(b);
  }
  for (const g of byScope.values()) {
    for (const [name, list] of g.names) {
      const hard = list.filter((b) => b.kind !== 'var' && b.kind !== 'param');
      if (hard.length > 1) violations.push({ scope: g.scope.kind, name, list: hard });
    }
  }
})();
(function countVarDups() {
  const seen = new Map();
  for (const b of allBindings) {
    if (b.kind !== 'var') continue;
    const k = b.scope.id + '\u0000' + b.name;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const n of seen.values()) if (n > 1) varDupCount += n;
})();

const totals = allBindings.length;
const globalFns = [...globalScope.names.values()].filter((l) => l.some((b) => b.kind === 'function')).length;

/* ---------- 报告 ---------- */
console.log('=== 作用域重名门禁（S1） ===');
console.log(`文件 ${order.length} · 声明 ${totals} 处 · 作用域 ${sid} 个`);
console.log(`顶层（跨文件共享作用域）: 函数 ${globalFns} 个 · 全部绑定 ${depth0} 个`);
console.log(`同作用域同名（function/let/const）: ${violations.length} 组`);
console.log(`var 同作用域重名（合法，仅统计）  : ${varDupCount} 处`);

if (LIST) {
  console.log('\n【同名但各自 IIFE 私有】（不构成覆盖，仅备查）');
  const byName = new Map();
  for (const b of allBindings) {
    if (b.scope === globalScope) continue;
    if (!byName.has(b.name)) byName.set(b.name, new Set());
    byName.get(b.name).add(b.file);
  }
  for (const [n, files] of [...byName].sort()) {
    if (files.size > 1) console.log(`  ${n}: ${[...files].sort().join(', ')}`);
  }
}

if (violations.length) {
  console.log('\n✗ 同一作用域内同名声明（后者静默覆盖前者）:');
  for (const v of violations) {
    console.log(`  [${v.scope}] ${v.name}`);
    for (const h of v.list) console.log(`      ${h.file}:${h.line}  ${h.kind}`);
  }
  process.exit(1);
}
console.log('✓ 无同作用域重名');
