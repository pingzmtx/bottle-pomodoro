#!/usr/bin/env node
/* 生成 ES 模块的 window 公开接口（供 build.py --module 使用）。
 *
 * 为什么需要它：模块作用域不会把顶层声明挂到 window，而本项目大量代码与回归用例
 * 仍按全局读写（`window.appData`、`appData.records = ...`、用例打桩 `window.showToast = ...`）。
 * 这里按 AST 顶层声明逐一生成访问器：
 *   function/class → get+set（函数声明是可变绑定，set 让打桩真正替换模块内实现）
 *   let/var        → get+set（**必须访问器**：直接赋值是值拷贝，之后模块内改了外面读到旧值）
 *   const          → 只读 get
 * getter 内 try/catch 兜 TDZ：桥放在模块最前面，此时 let/const 尚未初始化，读到的语义
 * 应与普通 script 的"还没定义"一致（undefined），而不是抛错。
 *
 * 用法：node tools/gen_bridge.js <merged.js>            → stdout 输出桥代码
 *       node tools/gen_bridge.js --exports <file.js>     → stdout 输出 `export { … };`（拆模块用）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, 'vendor', 'acorn.js'));

const exportsMode = process.argv[2] === '--exports';
const file = exportsMode ? process.argv[3] : process.argv[2];
if (!file) {
  console.error('用法: node tools/gen_bridge.js [--exports] <file.js>');
  process.exit(2);
}
const code = fs.readFileSync(file, 'utf8');
let ast;
try {
  ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' });
} catch (e) {
  console.error('✗ 模块语法解析失败: ' + e.message);
  process.exit(1);
}

const SKIP = new Set(['window', 'document', 'navigator', 'location', 'localStorage',
                      'indexedDB', 'console', 'globalThis']);
const kinds = {};
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration' && n.id) kinds[n.id.name] = 'fn';
  else if (n.type === 'ClassDeclaration' && n.id) kinds[n.id.name] = 'fn';
  else if (n.type === 'VariableDeclaration') {
    for (const d of n.declarations) if (d.id.type === 'Identifier') kinds[d.id.name] = n.kind;
  }
}

if (exportsMode) {
  const names = Object.keys(kinds).filter(n => !SKIP.has(n)).sort();
  if (!names.length) { console.error('✗ 没有可导出的顶层声明'); process.exit(1); }
  /* ⚠️ 必须用 fs.writeSync 同步写：`process.stdout.write` 走管道是异步的，
     紧接 `process.exit()` 会在 8192 字节处被截断 —— 导出清单少了尾部名字，
     下游 append 出 `export { …, }` 语法错误，或 rindex('}') 直接抛。 */
  fs.writeSync(1, '\nexport { ' + names.join(', ') + ' };\n');
  process.stderr.write(`  ↳ 导出 ${names.length} 项\n`);
  process.exitCode = 0;
  return;
}

const out = [];
for (const name of Object.keys(kinds).sort()) {
  if (SKIP.has(name)) continue;
  const get = `get:function(){try{return ${name};}catch(e){return undefined;}}`;
  if (kinds[name] === 'const') {
    // const 不能重新赋值：给一个"只读 + 兜底影子"的 setter。
    // 正常路径不动它；外部（用例/打包脚本）硬写时退化成可写影子属性，不炸整页。
    out.push(`Object.defineProperty(window, ${JSON.stringify(name)}, {configurable:true, ${get},`
      + ` set:function(v){try{${name}=v;}catch(e){Object.defineProperty(window, ${JSON.stringify(name)},`
      + `{value:v, writable:true, configurable:true});}}});`);
  } else {
    out.push(`Object.defineProperty(window, ${JSON.stringify(name)}, {configurable:true, ${get},`
      + ` set:function(v){${name}=v;}});`);
  }
}
process.stdout.write(out.join('\n') + '\n');
console.error(`  ↳ 公开接口 ${out.length} 项（function ${Object.values(kinds).filter(k => k === 'fn').length}`
  + ` / const ${Object.values(kinds).filter(k => k === 'const').length}`
  + ` / 其余 ${Object.values(kinds).filter(k => k !== 'fn' && k !== 'const').length}）`);
