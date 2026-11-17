#!/usr/bin/env node
/**
 * 文件名唯一映射（JS 版，与 tools/filemap.py 同语义）。
 *
 * 用法：
 *   node tools/filemap.js --check
 *   node tools/filemap.js --list
 *   node tools/filemap.js --path ui_tree
 *   node tools/filemap.js --key 01e5_ui_tree.js
 *
 * 脚本里：
 *   const FM = require('./filemap');
 *   FM.path('pure_core')        // → '00_pure_core.js'
 *
 * 为什么 JS 也要一份：check_repeat_consistency / unit_pure / callgraph_ast 等
 * 是 node 脚本，不能 import Python。两份实现必须对同一份 manifest 得出同一结果，
 * 由 verify 的 filemap 段同时跑 `python3 --check` 与 `node --check` 来钉住。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'src', 'manifest.json');
const SCRIPTS = path.join(ROOT, 'src', 'scripts');
const RE_PREFIX = /^[0-9][0-9A-Za-z]{0,3}_/;

function keyOf(filename) {
  const base = filename.endsWith('.js') ? filename.slice(0, -3) : filename;
  return base.replace(RE_PREFIX, '');
}

function loadFiles() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const slots = (m.slots || []).slice().sort((a, b) => (a.slot || 0) - (b.slot || 0));
  const out = [];
  for (const s of slots) {
    if (Array.isArray(s.files)) out.push(...s.files);
    else if (typeof s.file === 'string') out.push(s.file);
  }
  if (!out.length) throw new Error('manifest 里没有解析到任何 .js');
  return out;
}

const FILES = loadFiles();
const BY_KEY = {};
const DUPS = {};
for (const f of FILES) {
  const k = keyOf(f);
  if (BY_KEY[k]) (DUPS[k] = DUPS[k] || [BY_KEY[k]]).push(f);
  else BY_KEY[k] = f;
}

function key(filename) {
  if (!FILES.includes(filename)) throw new Error('不在 manifest：' + filename);
  return keyOf(filename);
}

function pathOf(token) {
  if (BY_KEY[token]) return BY_KEY[token];
  if (FILES.includes(token)) return token;
  const hits = FILES.filter(f => f.endsWith(token) || f.includes(token));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error('无法解析为文件：' + token);
  throw new Error('有歧义（' + hits.length + ' 个候选）：' + token + ' → ' + hits.join(', '));
}

function check() {
  const errs = [];
  for (const k of Object.keys(DUPS)) errs.push('语义键冲突：' + k + ' ← ' + DUPS[k].join(' / '));
  const disk = new Set(fs.readdirSync(SCRIPTS).filter(f => f.endsWith('.js')));
  const man = new Set(FILES);
  const onlyDisk = [...disk].filter(f => !man.has(f)).sort();
  const onlyMan = [...man].filter(f => !disk.has(f)).sort();
  if (onlyDisk.length) errs.push('磁盘有、manifest 没有：' + onlyDisk.join(', '));
  if (onlyMan.length) errs.push('manifest 有、磁盘没有：' + onlyMan.join(', '));
  return errs;
}

module.exports = { path: pathOf, key, all: () => FILES.slice(), check, keyOf, FILES };

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a.includes('-h') || a.includes('--help')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(0);
  }
  if (a.includes('--check')) {
    const errs = check();
    if (errs.length) { errs.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
    console.log('✓ filemap.js 一致：' + FILES.length + ' 个文件，' + Object.keys(BY_KEY).length + ' 个语义键');
    process.exit(0);
  }
  if (a.includes('--list')) {
    FILES.forEach(f => console.log(keyOf(f).padEnd(40) + ' ' + f));
    process.exit(0);
  }
  const ip = a.indexOf('--path'), ik = a.indexOf('--key');
  if (ip >= 0) {
    if (!a[ip + 1]) { console.log('✗ --path 需要一个键'); process.exit(2); }
    try { console.log(pathOf(a[ip + 1])); } catch (e) { console.log('✗ ' + e.message); process.exit(1); }
    process.exit(0);
  }
  if (ik >= 0) {
    if (!a[ik + 1]) { console.log('✗ --key 需要一个文件名'); process.exit(2); }
    try { console.log(key(a[ik + 1])); } catch (e) { console.log('✗ ' + e.message); process.exit(1); }
    process.exit(0);
  }
  console.log('✗ 需要一个动作：--check / --list / --path KEY / --key FILE');
  process.exit(2);
}
