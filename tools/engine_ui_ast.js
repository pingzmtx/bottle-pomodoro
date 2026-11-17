// 引擎→UI 边界检查（AST 侧）。只输出事实，判定在 check_engine_ui_boundary.py。
//
// 判据口径：
//   direct —— 引擎文件里以**裸标识符**调用 UI 文件声明的函数（`renderTodos()`）。
//             这是 E3 契约禁止的方向，也是「按加载序号切文件」留下的反向依赖。
//   uifx   —— 引擎文件里 `UIFX.xxx` 的 xxx 集合。门面是 Proxy，任何名字都能取到
//             函数或 undefined，所以必须靠白名单把「能调什么」钉死。
//   patch  —— 引擎改写 UI 的全局实现。两种形态，语义相同：
//             a) `window.renderTodos = function(){…}`   （显式写全局对象）
//             b) `renderTodos = function(){…}`          （裸赋值 —— 本项目所有函数都在
//                全局作用域，运行时命中同一个绑定）
//             b 形态在 2026-11-16 之前完全检测不到：门禁只认 MemberExpression 左值，
//             而 `applySettingsToUI = function(){…}`（01g:2068）是裸标识符左值。
//
// 只认「把函数值写进一个 UI 函数」这一件事。裸赋值里还有两类长得像、但不是 patch 的：
//   · 定时器句柄   `immersionIv = 0`      —— 目标是 UI 里的 let 变量，右值是字面量
//   · 脏检查签名   `_todoSig = '__force__'` —— 同上，把字符串写进 UI 变量
// 判据因此卡两处：目标必须是**函数形态的声明**（func / var 初始化成函数），
// 右值必须是**函数值**（函数表达式 / 箭头 / 另一个函数符号）。两类都满足才叫改写。
//
// 用法：node tools/engine_ui_ast.js  → stdout 单行 JSON；诊断走 stderr。
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, 'vendor', 'acorn.js'));

const ROOT = path.join(__dirname, '..', 'src', 'scripts');
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).sort();

// 与 check_duplicate / 派工单同一口径：按文件名判定归属
const isUI = f => /ui|view|component|a11y/i.test(f);
// 「非 UI」= 除 UI 文件之外的全部文件，不再用第二组关键字白名单。
//
// 2026-11-17 修正（审核发现）：原来写的是 /engine|enh|journey|errRep|fold|hash|路由|渐进/，
// 只覆盖 60/71 个文件，剩下 11 个（00_pure_core / 00_delegate / 00b / 01a1 / 01b1 / 01b2 /
// 01b3 / 0A / 0C / 0D / 0E）既不匹配 UI 也不匹配引擎，**整类不进扫描** —— 而输出照样打印
// 「裸调 0 处」，没有任何「11 个文件没分类」的提示。实测 0D_store通知.js 有 5 处真实裸调
// （renderTreeShop/renderTreeSection/renderWeeklyBadges/renderRankSystem/renderStats）。
// 门禁的形状必须是「默认管、例外要显式」，而不是「命中关键字才管」——否则新增一个
// 命名不落关键字的新文件，就自动豁免了全部检查，且没人会发现。
const isEng = f => !isUI(f);

const owner = {};
const declKind = {};   // 'func' | 'varfn' | 'var'  —— 决定裸赋值算不算「改写实现」
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
    if (n.type === 'FunctionDeclaration' && n.id && !owner[n.id.name]) {
      owner[n.id.name] = f;
      declKind[n.id.name] = 'func';
    }
    if (n.type === 'VariableDeclaration')
      for (const d of n.declarations)
        if (d.id && d.id.type === 'Identifier' && !owner[d.id.name]) {
          owner[d.id.name] = f;
          declKind[d.id.name] = (d.init && /Function|Arrow/.test(d.init.type)) ? 'varfn' : 'var';
        }
  }
}

const isFnDecl = name => declKind[name] === 'func' || declKind[name] === 'varfn';
const isFnValue = rhs => {
  if (!rhs) return false;
  if (rhs.type === 'FunctionExpression' || rhs.type === 'ArrowFunctionExpression') return true;
  if (rhs.type === 'Identifier') return isFnDecl(rhs.name);
  return false;
};

// 同文件里有没有同名局部绑定（形参 / 函数内声明）。有的话 `X = …` 改的是局部量，
// 不是全局的 UI 函数 —— 不算 patch。（当前样本 0 例，判据先立着，免得以后误报。）
const localBinds = {};
for (const f of files) {
  const s = new Set();
  if (!asts[f]) { localBinds[f] = s; continue; }
  walk(asts[f], node => {
    if (/Function/.test(node.type)) {
      for (const p of node.params || []) {
        if (p.type === 'Identifier') s.add(p.name);
        if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') s.add(p.left.name);
      }
    }
    if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'Identifier') s.add(node.id.name);
    if (node.type === 'FunctionDeclaration' && node.id) s.add(node.id.name);
  });
  localBinds[f] = s;
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
const notPatch = [];   // 裸赋值里被排除的（句柄/字符串写进 UI 变量），供 -v 自证不误报

// escapeHtml 已上移到 01a1_dom_util.js（非 UI 文件），owner 判定自然会放过它，
// 不再需要豁免名单。保留空集只是为了少改六处调用点；语义上它必须一直是空的 ——
// 一旦往里加名字，就是「允许引擎直连某个 UI 函数」，那是门禁开口子，要走基线不是走这里。
const NOT_UI_CAPABILITY = new Set();

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
      // a) window.X = … / globalThis.X = …
      // 必须是**全局对象**才叫改写 UI 的实现；`appData.mustDoUI = {}` 这类
      // 只是同名属性碰撞（owner 表里有同名的 UI 函数），不算。
      if (L.type === 'MemberExpression' && L.property.type === 'Identifier' &&
          L.object.type === 'Identifier' &&
          (L.object.name === 'window' || L.object.name === 'globalThis')) {
        const nm = L.property.name;
        const own = owner[nm];
        if (own && own !== f && isUI(own) && !NOT_UI_CAPABILITY.has(nm)) {
          alias.push({ file: f, line: node.loc.start.line, name: nm, owner: own,
                       patch: true, form: 'window' });
        }
        return;
      }
      // b) 裸赋值 X = …（见文件头：本项目全是全局绑定，语义与 window.X = … 相同）
      if (L.type === 'Identifier') {
        const nm = L.name, own = owner[nm];
        if (!own || own === f || !isUI(own) || NOT_UI_CAPABILITY.has(nm)) return;
        if (localBinds[f] && localBinds[f].has(nm)) return;   // 局部同名量，不是全局
        const fnTarget = isFnDecl(nm);
        const fnValue = isFnValue(node.right);
        // c) X = UIFX.X —— 把全局绑定指回门面。
        //
        // 这不是「消除耦合」，是 patch 换了个写法：原来引擎自带一层实现包住 UI，
        // 现在让全局名指向门面；门面再按名查 registry/window，很可能指回自己。
        // 审核实测过：把 03:704 的 `window.renderStats = function(){…}` 改成
        // `renderStats = UIFX.renderStats`，旧判据会打印「旧 patch 已消失（耦合变少，不拦）」
        // 并 PASS —— 棘轮被白送一次下降。这种形态必须与 patch 同等计数。
        const isUifxAlias = node.right.type === 'MemberExpression' &&
          node.right.object.type === 'Identifier' && node.right.object.name === 'UIFX' &&
          node.right.property.type === 'Identifier' && node.right.property.name === nm;
        if (fnTarget && (fnValue || isUifxAlias)) {
          alias.push({ file: f, line: node.loc.start.line, name: nm, owner: own,
                       patch: true, form: isUifxAlias ? 'uifx-alias' : 'bare' });
        } else {
          // 看了但不算：留着给 -v 输出，证明判据不是「看见赋值就当 patch」
          notPatch.push({ file: f, line: node.loc.start.line, name: nm, owner: own,
                          ownerKind: declKind[nm], rhs: node.right.type });
        }
        return;
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
  notPatch,
  parseFail,
};
process.stdout.write(JSON.stringify(out) + '\n');
