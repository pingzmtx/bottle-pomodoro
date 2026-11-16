// 引擎→UI 边界检查（AST 侧）。只输出事实，判定在 check_engine_ui_boundary.py。
//
// 判据口径：
//   direct —— 引擎文件里以**裸标识符**调用 UI 文件声明的函数（`renderTodos()`）。
//             这是 E3 契约禁止的方向，也是「按加载序号切文件」留下的反向依赖。
//   uifx   —— 引擎文件里 `UIFX.xxx` 的 xxx 集合。门面是 Proxy，任何名字都能取到
//             函数或 undefined，所以必须靠白名单把「能调什么」钉死。
//
// 只认 CallExpression：`const f = renderTodos` 这类别名引用不是调用，
// 它是更深的耦合（01g 里就有 monkey-patch），由门禁单列 lint 提示，不在此判 FAIL。
//
// 用法：node tools/engine_ui_ast.js  → stdout 单行 JSON；诊断走 stderr。
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, 'vendor', 'acorn.js'));

const ROOT = path.join(__dirname, '..', 'src', 'scripts');
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).sort();

// 与 check_duplicate / 派工单同一口径：按文件名判定归属
const isUI = f => /ui|view|component|a11y/i.test(f);
// UI 判定优先：01e_engine_ui.js 两边的模式都命中，但它是 UI 能力层（showToast/closeModal）。
// 07_uiFold 同理 —— 折叠记忆是 UI 行为，不是引擎。
const isEng = f => !isUI(f) && /engine|enh|journey|errRep|fold|hash|路由|渐进/i.test(f);

const owner = {};
const asts = {};
const parseFail = [];

for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  let ast;
  try {
    ast = acorn.parse(text, { ecmaVersion: 2022, locations: true });
  } catch (e) {
    parseFail.push({ file: f, error: e.message });
    continue;
  }
  asts[f] = ast;
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' && n.id && !owner[n.id.name]) owner[n.id.name] = f;
    if (n.type === 'VariableDeclaration')
      for (const d of n.declarations)
        if (d.id && d.id.type === 'Identifier' && !owner[d.id.name]) owner[d.id.name] = f;
  }
}

function walk(node, fn, parent) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => c && c.type && walk(c, fn, node));
    else if (v && v.type) walk(v, fn, node);
  }
}

const direct = [];
const uifx = new Set();
const alias = [];

// 已归位的工具函数：定义已不在 UI 文件里，即便还在 UI 文件里也不算上行能力
const NOT_UI_CAPABILITY = new Set(['escapeHtml']);

for (const f of files) {
  if (!isEng(f) || !asts[f]) continue;
  walk(asts[f], (node, parent) => {
    if (node.type === 'CallExpression') {
      const c = node.callee;
      if (c.type === 'MemberExpression' &&
          c.object.type === 'Identifier' && c.object.name === 'UIFX' &&
          c.property.type === 'Identifier') {
        uifx.add(c.property.name);
        return;
      }
      if (c.type === 'Identifier') {
        const name = c.name;
        const own = owner[name];
        if (!own || own === f || !isUI(own)) return;
        if (NOT_UI_CAPABILITY.has(name)) return;
        direct.push({ file: f, line: node.loc.start.line, name, owner: own });
      }
      return;
    }
    // 别名引用：不是调用，但同样是引擎在摸 UI 的内部实现。两种情况分别记：
    //   alias —— 把 UI 函数取出来存着（`const f = renderTodos`）
    //   patch —— 直接改写 UI 的全局实现（`window.renderTodos = function(){…}`）
    // 其余位置（声明 id、成员属性、标签、函数名）一律不算，否则误报一片。
    if (node.type === 'AssignmentExpression') {
      const L = node.left;
      // 只认 window.X = … / globalThis.X = …
      // 必须是**全局对象**才叫改写 UI 的实现；`appData.mustDoUI = {}` 这类
      // 只是同名属性碰撞（owner 表里有同名的 UI 函数），不算。
      if (L.type === 'MemberExpression' && L.property.type === 'Identifier' &&
          L.object.type === 'Identifier' &&
          (L.object.name === 'window' || L.object.name === 'globalThis')) {
        const nm = L.property.name;
        const own = owner[nm];
        if (own && own !== f && isUI(own) && !NOT_UI_CAPABILITY.has(nm)) {
          alias.push({ file: f, line: node.loc.start.line, name: nm, owner: own, patch: true });
        }
      }
      return;
    }
    if (node.type === 'Identifier') {
      const okPos = parent && (
        (parent.type === 'VariableDeclarator' && parent.init === node) ||
        (parent.type === 'ReturnStatement') ||
        (parent.type === 'Property' && parent.value === node)
      );
      if (!okPos) return;
      const own = owner[node.name];
      if (!own || own === f || !isUI(own) || NOT_UI_CAPABILITY.has(node.name)) return;
      alias.push({ file: f, line: node.loc.start.line, name: node.name, owner: own });
    }
  });
}

const out = {
  files: files.length,
  engineFiles: files.filter(isEng),
  uiFiles: files.filter(isUI),
  direct,
  uifx: [...uifx].sort(),
  alias,
  parseFail,
};
process.stdout.write(JSON.stringify(out) + '\n');
