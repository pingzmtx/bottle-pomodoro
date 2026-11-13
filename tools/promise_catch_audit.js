#!/usr/bin/env node
/* promise_catch_audit.js —— 找出「X().catch(...)」但 X 不返回 Promise 的误用
 *
 * 为什么需要它：`X().catch(h)` 在 X 返回 undefined 时，**在求值 `.catch` 属性时**就抛
 * TypeError（Cannot read properties of undefined (reading 'catch')），那个 h 根本挂不上去。
 * 写 `catch(function(){})` 也不管用——看着像"已处理"，其实从来没生效过。
 * 本项目真实案例：tryBet(level) 不是 async 且尾调用漏了 return，onclick 里却写了
 * `.catch(...)`，点一次炸一次，只因错误面板本身坏了才长期没人看见。
 *
 * 检查两处（因为 bug 常藏在 HTML 字符串里）：
 *   ① 真代码：AST 找 CallExpression.callee 是 `.catch` 的，若其 object 是「本地非 async 函数」
 *      调用 → 报 BUG；名字查不到 → 报 UNKNOWN 供人工确认。
 *   ② 内联处理器：从字符串字面量 + 模板里找 on*="f(...).catch(" 形态，用同样规则判定。
 *
 * 用法：node tools/promise_catch_audit.js [--json]
 * 退出码：0=无 BUG（可能有 UNKNOWN），1=发现 BUG
 */
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, 'vendor', 'acorn.js'));

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');

// ---------- 收集所有文件 ----------
function listFiles() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); }
      else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
  })(SRC);
  return out;
}

// ---------- 第一遍：登记每个函数是否 async ----------
// 跨文件也认（项目是 9 槽拼成一个大作用域，所以全局按名字查）
/**
 * 分析一个函数自身的返回行为。
 * 关键：**只走函数自己的语句，不进嵌套函数**——嵌套回调里的 `return;`
 * 与该函数是否返回 Promise 无关（曾因此把 _playCustom 误判成"契约不一致"）。
 */
function analyzeFn(fnNode, src) {
  let hasBareReturn = false;   // 自身有裸 `return;` → 该路径返回 undefined
  let hasPromiseReturn = false; // 自身有返回 Promise 的 return
  const returnedCalls = [];
  (function walk(n, isRoot) {
    if (!n || typeof n !== 'object') return;
    // 遇到嵌套函数就停：它的 return 影响的是它自己
    if (!isRoot && /FunctionDeclaration|FunctionExpression|ArrowFunctionExpression/.test(n.type)) return;
    if (n.type === 'ReturnStatement') {
      if (!n.argument) { hasBareReturn = true; return; }
      const a = n.argument;
      const text = src.slice(a.start, a.end);
      if (/^new\s+Promise\b/.test(text) || /^Promise\s*\./.test(text) || /^fetch\s*\(/.test(text)) hasPromiseReturn = true;
      if (a.type === 'CallExpression' && a.callee) {
        // return X(...) 或 return X(...).then(...) / .foo()
        let c = a.callee;
        while (c && c.type === 'MemberExpression') c = c.object;
        if (c && c.type === 'CallExpression') returnedCalls.push(calleeName(c));
        else if (a.callee.type === 'Identifier') returnedCalls.push(a.callee.name);
      }
      return;
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(x => walk(x, false));
      else if (v && typeof v === 'object' && v.type) walk(v, false);
    }
  })(fnNode, true);
  return { hasBareReturn, hasPromiseReturn, returnedCalls };
}

function collectFns(files) {
  const fns = new Map();  // name -> true(会返回 Promise) / false(不会)
  const pend = [];        // 「本函数 return 了另一个本地函数」的关系，稍后定点传递
  const bare = new Set(); // 函数自身有裸 `return;`（该路径返回 undefined）
  const asyncs = new Set(); // 显式 async
  for (const f of files) {
    if (f.endsWith('.html')) continue;
    let src, tree;
    try { src = fs.readFileSync(f, 'utf8'); tree = acorn.parse(src, { ecmaVersion: 2022, allowHashBang: true, locations: true }); }
    catch (e) { continue; }
    const note = (node, name) => {
      const key = name || (node.id && node.id.name);
      if (!key) return;
      const a = analyzeFn(node, src);
      // 「会返回 Promise」的判据：async ｜ 返回 new Promise / Promise.x / fetch( ｜ return 某函数()
      const p = !!node.async || a.hasPromiseReturn || a.returnedCalls.length > 0;
      fns.set(key, fns.has(key) ? (fns.get(key) || p) : p);
      if (node.async) asyncs.add(key);
      if (a.hasBareReturn) bare.add(key);
      for (const c of a.returnedCalls) if (c) pend.push([key, c]);
    };
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'FunctionDeclaration') note(n);
      else if (n.type === 'VariableDeclarator' && n.init &&
               /FunctionExpression|ArrowFunctionExpression/.test(n.init.type)) note(n.init, n.id.name);
      else if (n.type === 'AssignmentExpression' && n.operator === '=' &&
               /FunctionExpression|ArrowFunctionExpression/.test(n.right.type) &&
               n.left.type === 'MemberExpression' && n.left.property.name) note(n.right, n.left.property.name);
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object' && v.type) walk(v);
      }
    })(tree);
  }
  // 定点传递：A 里 return B(...) 且 B 会返回 Promise → A 也视作会返回
  for (let i = 0; i < 4; i++) {
    for (const [a, b] of pend) if (fns.get(b)) fns.set(a, true);
  }
  // 「半 Promise」：非 async 的函数，既有会返回 Promise 的 return，又有裸 return;
  // → 契约不一致，某些路径仍返回 undefined，`.catch` 一样炸。
  // （这正是 tryBet 最初的形态：成功路径丢 Promise、失败路径返回 undefined。）
  const mixed = new Set();
  for (const k of fns.keys()) if (!asyncs.has(k) && bare.has(k) && fns.get(k)) mixed.add(k);
  return { fns, mixed };
}

// ---------- 判定 ----------
// 返回 'BUG' | 'OK' | 'UNKNOWN'
function verdict(name, A) {
  if (!name) return 'UNKNOWN';
  if (!A.fns.has(name)) return 'UNKNOWN';     // 认不出（全局/成员调用）→ 需人工确认
  if (A.mixed.has(name)) return 'BUG';        // 契约不一致：有的路径返回 undefined
  return A.fns.get(name) ? 'OK' : 'BUG';      // 本地非 async 函数 → 必炸
}

// 从一个 CallExpression 取被调函数名
function calleeName(node) {
  if (!node || node.type !== 'CallExpression') return null;
  const c = node.callee;
  if (!c) return null;
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression' && c.property && c.property.name) return c.property.name;
  return null;
}

// ---------- ① 真代码里的 .catch ----------
function scanAst(file, A) {
  const hits = [];
  let src, tree;
  try { src = fs.readFileSync(file, 'utf8'); tree = acorn.parse(src, { ecmaVersion: 2022, allowHashBang: true, locations: true }); }
  catch (e) { return hits; }
  const lines = src.split('\n');
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'CallExpression' && n.callee && n.callee.type === 'MemberExpression' &&
        n.callee.property && n.callee.property.name === 'catch') {
      const obj = n.callee.object;
      let name = null, note = '', skip = false, unknownOnly = false;
      if (obj && obj.type === 'CallExpression') {
        name = calleeName(obj);
        note = 'X().catch()';
        if (name === 'then') skip = true;          // .then() 必然返回 Promise，安全
      } else if (obj && obj.type === 'Identifier') {
        name = obj.name; note = '标识符.catch()';
        // 常见防御写法 `if (p && p.catch)` —— 已判空，安全
        const before = src.slice(Math.max(0, obj.start - 160), obj.start);
        if (new RegExp('\\b' + name + '\\s*&&\\s*' + name + '\\s*\\.\\s*catch').test(before)) skip = true;
        else unknownOnly = true;                   // 裸标识符静态判不出 → 只报 UNKNOWN
      } else {
        note = '复合表达式.catch()'; unknownOnly = true;
      }
      if (!skip) {
        const v = unknownOnly ? 'UNKNOWN' : verdict(name, A);
        if (v !== 'OK') {
          const ln = (n.loc && n.loc.start) ? n.loc.start.line : 0;
          hits.push({ file, line: ln, name, verdict: v, note, snippet: (lines[ln - 1] || '').trim().slice(0, 110) });
        }
      }
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && v.type) walk(v);
    }
  })(tree);
  return hits;
}

// ---------- ② 内联处理器（onclick="..." 藏在字符串里，AST 看不见）----------
// 做法：在文件原文里找每个 .catch(，回看 250 字符找最近的 on*=" ，再取其后最近的 标识符(
function scanInline(file, fns) {
  const hits = [];
  const text = fs.readFileSync(file, 'utf8');
  const re = /\.catch\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const win = text.slice(Math.max(0, m.index - 250), m.index);
    const attr = win.match(/\bon[a-z]+\s*=\s*"/g);
    if (!attr) continue;
    const lastAttr = win.lastIndexOf(attr[attr.length - 1]);
    const body = win.slice(lastAttr);
    // handler 体里、.catch 之前最近的一次 标识符(
    const calls = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)];
    if (!calls.length) continue;
    const name = calls[calls.length - 1][1];
    const v = verdict(name, fns);
    if (v === 'OK') continue;
    const line = text.slice(0, m.index).split('\n').length;
    hits.push({ file, line, name, verdict: v, note: '内联处理器', snippet: text.slice(m.index - 90, m.index + 20).replace(/\s+/g, ' ') });
  }
  return hits;
}

// ---------- 主流程 ----------
function main() {
  const files = listFiles();
  const A = collectFns(files);
  let hits = [];
  for (const f of files) {
    if (f.endsWith('.html')) { hits = hits.concat(scanInline(f, A)); continue; }
    hits = hits.concat(scanAst(f, A));
    hits = hits.concat(scanInline(f, A));
  }
  // 去重（同一位置被两种扫描都抓到）
  const seen = new Set();
  hits = hits.filter(h => { const k = h.file + ':' + h.line + ':' + h.name; if (seen.has(k)) return false; seen.add(k); return true; });

  const bugs = hits.filter(h => h.verdict === 'BUG');
  const unk = hits.filter(h => h.verdict === 'UNKNOWN');
  const rel = f => path.relative(ROOT, f);

  if (JSON_OUT) {
    console.log(JSON.stringify({ bugs, unknown: unk, fnsKnown: A.fns.size }, null, 2));
    process.exit(bugs.length ? 1 : 0);
  }

  console.log('🔎 Promise .catch 误用审计');
  console.log(`   登记函数 ${A.fns.size} 个 ｜ 扫描 ${files.length} 文件\n`);
  if (bugs.length) {
    console.log(`✗ ${bugs.length} 处「对非 Promise 取 .catch」——点了就炸，且 catch 处理器从来没生效过：`);
    for (const b of bugs) console.log(`   ${rel(b.file)}:${b.line}  ${b.name}()  [${b.note}]\n      ${b.snippet}`);
  } else {
    console.log('✓ 无「对非 Promise 取 .catch」');
  }
  if (unk.length) {
    console.log(`\n⚠ ${unk.length} 处需人工确认（调用方不在本地函数表里，多半是 fetch/成员方法，正常）：`);
    for (const u of unk) console.log(`   ${rel(u.file)}:${u.line}  ${u.name || '?'}  [${u.note}]`);
  }
  process.exit(bugs.length ? 1 : 0);
}
main();
