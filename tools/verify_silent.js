#!/usr/bin/env node
/**
 * verify_silent.js —— 外部代码导入用的「token 级等价校验」
 *
 * 用途：把两份源码树 token 化 → 剥注释 → 剥 __silent 注入 → 逐文件比 token 流。
 * 机械改造（空 catch 批量接线、注释清洗等）必须逐 token 完全一致；
 * 任何不一致都要能归属到某条已声明改动，归不上的就是隐性改动。
 *
 * 用法：
 *   node tools/verify_silent.js <基线目录> <新目录>
 *   node tools/verify_silent.js <基线目录> <新目录> --declared 00_pure_core.js,01b_engine_data.js
 *   不带参数时：<基线目录> 默认取 git 的 HEAD~1（即"导入前"）。
 *
 * 退出码：0 = 全部一致或差异均已声明；1 = 有未声明差异（需人工定位）。
 *
 * ⚠️ 实现坑（务必别踩）：acorn 的标点 token，`value` 是 undefined，
 *    真符号在 `type.label` 里。取值必须写 tok.value === undefined ? tok.type.label : String(tok.value)。
 *    只判 tok.value 会让剥离逻辑从不命中、给出完全错误的结论。
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');

const VENDOR = path.join(__dirname, 'vendor', 'acorn.js');
let tmp = null;   // git ref 导出快照用的临时目录（模块级，便于任何分支清理）
const acorn = require(fs.existsSync(VENDOR) ? VENDOR : 'acorn');

function tokens(src) {
  const t = [];
  const tk = acorn.tokenizer(src, { ecmaVersion: 2022, allowHashBang: true, onComment: () => {} });
  while (true) {
    let tok;
    try { tok = tk.getToken(); } catch (e) { return { err: e.message }; }
    if (!tok || tok.type.label === 'eof') break;
    // 标点 token 的 value 是 undefined —— 真符号在 type.label
    t.push({ label: tok.type.label, value: tok.value === undefined ? tok.type.label : String(tok.value) });
  }
  return { toks: t };
}

/** 从 token 流剔除 `if (window.__silent) window.__silent(...)` 与裸 `window.__silent(...)` */
function strip(toks) {
  const out = [];
  const isCall = (i) => toks[i] && (
    toks[i].value === '__silent' ||
    (toks[i].value === 'window' && toks[i + 1] && toks[i + 1].value === '.' && toks[i + 2] && toks[i + 2].value === '__silent'));
  for (let i = 0; i < toks.length; i++) {
    // 形态 A：if (...) <call> ;
    if (toks[i].value === 'if' && toks[i + 1] && toks[i + 1].value === '(' && isCall(i + 2)) {
      let j = i + 1, depth = 0;
      do { if (toks[j].value === '(') depth++; else if (toks[j].value === ')') depth--; j++; } while (depth > 0 && j < toks.length);
      while (j < toks.length && toks[j].value !== ';') j++;
      i = j;
      continue;
    }
    // 形态 B：裸调用
    if (isCall(i)) {
      let j = i;
      while (j < toks.length && toks[j].value !== '(') j++;
      let depth = 0;
      // 注意：三条分支都必须让 j 前进（曾经在 '(' 分支漏了 j++，导致原地死循环）
      while (j < toks.length) {
        const v = toks[j].value;
        if (v === '(') { depth++; j++; }
        else if (v === ')') { depth--; j++; if (!depth) break; }
        else j++;
      }
      while (j < toks.length && toks[j].value !== ';') j++;
      i = j;
      continue;
    }
    out.push(toks[i]);
  }
  return out;
}

function listScripts(root) {
  const dir = path.join(root, 'src', 'scripts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
}

function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const declArg = process.argv.find(a => a.startsWith('--declared'));
  const declared = new Set(declArg ? (declArg.split('=')[1] || process.argv[process.argv.indexOf(declArg) + 1] || '').split(',').filter(Boolean) : []);
  const base = args[0] || 'HEAD~1';
  const news = args[1] || '.';

  // 基线目录：若是 git ref，先导出快照
  let baseRoot = base;
  tmp = null;
  if (!fs.existsSync(path.join(base, 'src'))) {
    tmp = fs.mkdtempSync('/tmp/vsb_');
    cp.execSync(`git archive ${base} | tar -x -C ${tmp}`, { stdio: 'inherit' });
    baseRoot = tmp;
  }

  const files = listScripts(baseRoot);
  if (!files.length) { console.error('✗ 基线目录里找不到 src/scripts/*.js：' + baseRoot); process.exit(2); }

  let same = 0; const diff = []; const missing = [];
  for (const f of files) {
    const np = path.join(news, 'src', 'scripts', f);
    if (!fs.existsSync(np)) { missing.push(f); continue; }
    const a = tokens(fs.readFileSync(path.join(baseRoot, 'src', 'scripts', f), 'utf8'));
    const b = tokens(fs.readFileSync(np, 'utf8'));
    if (a.err || b.err) { diff.push([f, 'parse error']); continue; }
    if (JSON.stringify(strip(a.toks)) === JSON.stringify(strip(b.toks))) same++;
    else diff.push([f, (b.toks.length - a.toks.length) + ' tok']);
  }

  const undeclared = diff.filter(([f]) => !declared.has(f));
  console.log(`逐 token 等价（剥注释 + 剥 __silent 后完全一致）：${same}/${files.length}`);
  if (diff.length) {
    console.log('不一致：');
    for (const [f, why] of diff) console.log(`   ${f}  (${why})` + (declared.has(f) ? '  ← 已声明' : '  ⚠️ 未声明'));
  }
  if (missing.length) console.log('新目录缺失：' + missing.join(', '));
  if (undeclared.length) {
    console.log(`\n✗ ${undeclared.length} 个文件存在未声明差异 —— 逐条查清归属后再放行。`);
    cleanup();
    process.exit(1);
  }
  console.log('\n✓ 差异均已声明，无隐性改动。');
  cleanup();
}

/** 临时目录一律清掉——包括报错/退出分支，否则 /tmp 里会堆 vsb_* 垃圾。 */
function cleanup() {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}

main();
