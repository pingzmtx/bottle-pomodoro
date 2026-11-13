#!/usr/bin/env node
/**
 * check_implicit_globals.js —— 找出「隐式全局」赋值：在模块（严格模式）下会抛
 * ReferenceError 的那一类，例如 `_lastSfxVol = vol;` 但全项目从未 `let _lastSfxVol`。
 *
 * 为什么需要它：
 *   2026-10-23 切 ES 模块后，`updateSfxVolume` 里 `_lastSfxVol` 从来没声明过 ——
 *   单文件时代它靠「非严格模式给未声明变量赋值 = 创建全局变量」蒙混过关，
 *   模块是严格模式，同样的代码直接抛 ReferenceError，用户一拖音量滑条就报错。
 *   unit_pure / build --check / verify 全绿都抓不到：它们不跑浏览器事件。
 *
 * 判据（只认这一种，误报率低）：
 *   赋值目标（`x = ...` / `x += ...` / `x++`）里的裸标识符，
 *   若在整个 src/scripts 里从未被 var/let/const/function/class/参数/catch/
 *   解构/import 声明过，也从未出现在 WINDOW_ASSIGN 白名单里 → 违规。
 *   注意：读一个全局属性（不带 window.）是合法的，只有「赋值」会抛，所以只查赋值目标。
 *
 * 用法：
 *   node tools/check_implicit_globals.js            # 检查，有违规时 exit 1
 *   node tools/check_implicit_globals.js --json     # 机器可读
 *   node tools/check_implicit_globals.js --baseline # 与 tools/implicit_globals_baseline.json 比对
 */
'use strict';

const fs = require('fs');
const path = require('path');
const acorn = require('./vendor/acorn.js');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'scripts');
const BASELINE = path.join(ROOT, 'tools', 'implicit_globals_baseline.json');

const ARGV = process.argv.slice(2);
const AS_JSON = ARGV.includes('--json');
const USE_BASELINE = ARGV.includes('--baseline');

/* ---------- 1. 解析所有源文件 ---------- */
function parseFile(file, forceModule) {
  const code = fs.readFileSync(file, 'utf8');
  const isModule = forceModule || /^\s*(import|export)\s/m.test(code);
  try {
    return acorn.parse(code, {
      ecmaVersion: 2022,
      sourceType: isModule ? 'module' : 'script',
      locations: true,
      allowReturnOutsideFunction: true,
      allowHashBang: true,
    });
  } catch (e) {
    console.error('[解析失败] ' + file + ': ' + e.message);
    process.exit(2);
  }
}

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();

/* ---------- 2. 收集「曾经声明过」的名字（跨文件合并算，宁可多算不漏算） ---------- */
const declared = new Set();

function collectPattern(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier':
      out.add(node.name);
      break;
    case 'ObjectPattern':
      node.properties.forEach((p) => {
        if (p.type === 'RestElement') collectPattern(p.argument, out);
        else collectPattern(p.value, out);
      });
      break;
    case 'ArrayPattern':
      node.elements.forEach((el) => collectPattern(el, out));
      break;
    case 'AssignmentPattern':
      collectPattern(node.left, out);
      break;
    case 'RestElement':
      collectPattern(node.argument, out);
      break;
    default:
      break;
  }
}

function walkForDecls(node, out) {
  if (!node || typeof node.type !== 'string') return;
  switch (node.type) {
    case 'VariableDeclaration':
      node.declarations.forEach((d) => collectPattern(d.id, out));
      break;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      if (node.id) out.add(node.id.name);
      node.params.forEach((p) => collectPattern(p, out));
      break;
    case 'ClassDeclaration':
    case 'ClassExpression':
      if (node.id) out.add(node.id.name);
      break;
    case 'CatchClause':
      collectPattern(node.param, out);
      break;
    case 'ImportDeclaration':
      node.specifiers.forEach((s) => out.add(s.local.name));
      break;
    default:
      break;
  }
  for (const k in node) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walkForDecls(c, out));
    else if (v && typeof v.type === 'string') walkForDecls(v, out);
  }
}

const asts = {};
for (const f of files) {
  const ast = parseFile(path.join(SRC, f));
  asts[f] = ast;
  walkForDecls(ast, declared);
}

/* ---------- 3. 找赋值目标里的裸标识符 ---------- */
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=',
  '&=', '|=', '^=', '&&=', '||=', '??=']);

const violations = [];

function checkAssignTarget(node, file, isUpdate) {
  if (!node) return;
  // 解构赋值也要查：`[a, b] = f()`
  if (node.type === 'ArrayPattern' || node.type === 'ObjectPattern') {
    const tmp = new Set();
    collectPattern(node, tmp);
    tmp.forEach((name) => {
      if (!declared.has(name)) {
        violations.push({ file, line: node.loc.start.line, name, kind: isUpdate ? 'update' : 'assign' });
      }
    });
    return;
  }
  if (node.type !== 'Identifier') return;
  if (declared.has(node.name)) return;
  violations.push({ file, line: node.loc.start.line, name: node.name, kind: isUpdate ? 'update' : 'assign' });
}

function walkAssignments(node, file) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'AssignmentExpression' && ASSIGN_OPS.has(node.operator)) {
    checkAssignTarget(node.left, file, false);
  } else if (node.type === 'UpdateExpression') {
    checkAssignTarget(node.argument, file, true);
  }
  for (const k in node) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walkAssignments(c, file));
    else if (v && typeof v.type === 'string') walkAssignments(v, file);
  }
}

for (const f of files) walkAssignments(asts[f], f);

/* ---------- 3b. 「只读绑定」赋值：给 import 进来的名字赋值 ----------
 *   ES 模块的导入绑定是**只读**的（等价 const）。写它不会静默失败，而是当场抛
 *   TypeError: Assignment to constant variable. —— 2026-10-30 实例：
 *   01b 用 `let calendarYear` 持有年月、并导出 __set_calendarYear 写入口；
 *   01e 里的 changeCalendarMonth 却写 `calendarYear++`，
 *   于是「日历左右箭头点了完全没反应」，控制台每次一条 TypeError。
 *   unit_pure / build --check / verify --fast 全绿都抓不到（都不跑点击）。
 *   判据（误报率极低）：赋值目标的名字出现在本文件的 import 列表里，
 *   且本文件没有同名本地声明（同名遮蔽时是真变量，不算）。
 */
const readOnlyHits = [];
for (const f of files) {
  const ast = asts[f];
  const imported = new Set();
  const localDecl = new Set();
  ast.body.forEach((n) => {
    if (n.type === 'ImportDeclaration') n.specifiers.forEach((s) => imported.add(s.local.name));
    else walkForDecls(n, localDecl);
  });
  const isReadOnly = (name) => imported.has(name) && !localDecl.has(name);
  (function walk(node) {
    if (!node || typeof node.type !== 'string') return;
    let target = null;
    if (node.type === 'AssignmentExpression' && ASSIGN_OPS.has(node.operator)) target = node.left;
    else if (node.type === 'UpdateExpression') target = node.argument;
    if (target) {
      const names = new Set();
      collectPattern(target, names);
      names.forEach((name) => {
        if (isReadOnly(name)) {
          readOnlyHits.push({ file: f, line: target.loc.start.line, name });
        }
      });
    }
    for (const k in node) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c));
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
}

/* ---------- 3c. 同一判据跑一遍**构建产物** ----------
 *   src 里这些变量是裸全局（跨文件可见、赋值合法），真正的 import 绑定是 build.py
 *   打包时才生成的 —— 所以在 src 上扫不到这类 bug，必须在 public/assets/*.js 上再扫一次。
 *   2026-10-30 的 `calendarYear++` 就是只在产物里才是只读绑定。 */
const BUILT_DIR = path.join(ROOT, 'public', 'assets');
let builtScanned = 0;
if (fs.existsSync(BUILT_DIR)) {
  const builtFiles = fs.readdirSync(BUILT_DIR).filter((f) => f.endsWith('.js')).sort();
  for (const f of builtFiles) {
    const full = path.join(BUILT_DIR, f);
    const ast = parseFile(full, true);
    const imported = new Set();
    const localDecl = new Set();
    ast.body.forEach((n) => {
      if (n.type === 'ImportDeclaration') n.specifiers.forEach((s) => imported.add(s.local.name));
      else walkForDecls(n, localDecl);
    });
    const isReadOnly = (name) => imported.has(name) && !localDecl.has(name);
    (function walk(node) {
      if (!node || typeof node.type !== 'string') return;
      let target = null;
      if (node.type === 'AssignmentExpression' && ASSIGN_OPS.has(node.operator)) target = node.left;
      else if (node.type === 'UpdateExpression') target = node.argument;
      if (target) {
        const names = new Set();
        collectPattern(target, names);
        names.forEach((name) => {
          if (isReadOnly(name)) {
            readOnlyHits.push({ file: 'public/assets/' + f, line: target.loc.start.line, name });
          }
        });
      }
      for (const k in node) {
        if (k === 'loc' || k === 'start' || k === 'end') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach((c) => walk(c));
        else if (v && typeof v.type === 'string') walk(v);
      }
    })(ast);
    builtScanned++;
  }
}

/* ---------- 4. 去重 + 报告 ---------- */
const uniq = {};
for (const v of violations) {
  const key = v.file + ':' + v.line + ':' + v.name;
  uniq[key] = v;
}
const list = Object.keys(uniq).sort().map((k) => uniq[k]);

if (AS_JSON) {
  console.log(JSON.stringify({ implicit: list, readOnly: readOnlyHits }, null, 1));
} else if (!list.length && !readOnlyHits.length) {
  console.log('✓ 无隐式全局赋值、无只读绑定赋值（' + files.length + ' 个文件，声明名 ' + declared.size + ' 个）');
} else {
  if (list.length) {
    console.log('✗ 发现 ' + list.length + ' 处隐式全局赋值（模块严格模式下会抛 ReferenceError）：');
    const byName = {};
    list.forEach((v) => {
      (byName[v.name] = byName[v.name] || []).push(v.file + ':' + v.line);
    });
    Object.keys(byName).sort().forEach((n) => {
      console.log('  ' + n.padEnd(24) + byName[n].join(', '));
    });
  }
  if (readOnlyHits.length) {
    console.log('✗ 发现 ' + readOnlyHits.length + ' 处「给导入绑定赋值」（ESM 导入只读，'
      + '运行时抛 TypeError: Assignment to constant variable）：');
    readOnlyHits.forEach((v) => {
      console.log('  ' + v.name.padEnd(24) + v.file + ':' + v.line
        + '   → 改用数据层的 __set_' + v.name + '() 写入口');
    });
  }
  if (USE_BASELINE && fs.existsSync(BASELINE) && list.length) {
    const base = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')));
    const fresh = list.filter((v) => !base.has(v.file + ':' + v.line + ':' + v.name));
    if (!fresh.length) {
      console.log('\n○ 隐式全局全部在基线内（不阻塞）');
      process.exit(readOnlyHits.length ? 1 : 0);
    }
    console.log('\n✗ 基线外新增 ' + fresh.length + ' 处');
  }
  process.exit(1);
}
