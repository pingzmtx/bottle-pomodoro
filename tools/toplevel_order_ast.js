// 顶层加载顺序检查：只走 Program.body，不进函数体。
//
// 判据：加载期求值的顶层语句里引用的符号，其定义所在文件下标必须 <= 引用所在文件下标。
// 反向（引用更后的文件）在浏览器里就是 ReferenceError / TDZ，本地 file:// 也照样炸。
//
// 用法：node tools/toplevel_order_ast.js <order.json>
//   order.json = 加载顺序的文件名数组（由 check_toplevel_order.py 从
//   src/template/_order.json + src/manifest.json 现算，与 build.assemble() 同源）
// 输出：stdout 单行 JSON，供 Python 侧比对基线。诊断信息一律走 stderr。
const fs = require('fs');
const path = require('path');
const acorn = require(path.join(__dirname, 'vendor', 'acorn.js'));

const ROOT = path.join(__dirname, '..', 'src', 'scripts');
const order = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const idx = new Map(order.map((f, i) => [f, i]));

const FUNC = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

// 遍历一个表达式/语句，找到所有「读到的标识符」。函数体不展开 ——
// 函数体里的调用发生在运行期，与加载顺序无关（这是本门禁与 callgraph 的根本区别）。
function walk(node, parent, cb) {
  if (!node || typeof node.type !== 'string') return;
  cb(node, parent);
  if (FUNC.has(node.type)) return;
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, node, cb); }
    else if (v && typeof v.type === 'string') walk(v, node, cb);
  }
}

function isReadIdent(n, p) {
  if (!n || n.type !== 'Identifier') return false;
  if (p && p.type === 'MemberExpression' && p.property === n && !p.computed) return false; // a.b 的 b
  if (p && p.type === 'Property' && p.key === n && !p.computed && !p.shorthand) return false; // {b: 1} 的 b
  if (p && p.type === 'MethodDefinition' && p.key === n) return false;
  if (p && p.type === 'LabeledStatement') return false;
  if (p && p.type === 'BreakStatement') return false;
  if (p && p.type === 'ContinueStatement') return false;
  return true;
}

// 解构模式里的默认值 `const {a = FOO} = ...` 在加载期求值，别漏。
function walkPattern(p, cb) {
  if (!p) return;
  if (p.type === 'AssignmentPattern') { walk(p.right, p, cb); walkPattern(p.left, cb); }
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => walkPattern(q.value || q.argument, cb));
  else if (p.type === 'ArrayPattern') p.elements.forEach(e => walkPattern(e, cb));
  else if (p.type === 'RestElement') walkPattern(p.argument, cb);
}

function bindingNames(p, out) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => bindingNames(q.value || q.argument, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(e => bindingNames(e, out));
  else if (p.type === 'AssignmentPattern') bindingNames(p.left, out);
  else if (p.type === 'RestElement') bindingNames(p.argument, out);
  return out;
}

const defs = new Map();      // 名字 -> [文件...]（只收顶层声明）
const winOwn = new Map();    // window.NAME = ... 的归属文件
const srcs = new Map();
const parseFail = [];

for (const f of order) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  srcs.set(f, src);
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowHashBang: true }); }
  catch (e) { parseFail.push({ file: f, msg: e.message }); continue; }
  for (const st of ast.body) {
    const add = (n) => { if (!defs.has(n)) defs.set(n, []); defs.get(n).push(f); };
    if (st.type === 'FunctionDeclaration' && st.id) add(st.id.name);
    else if (st.type === 'ClassDeclaration' && st.id) add(st.id.name);
    else if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) bindingNames(d.id, []).forEach(add);
    } else if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression') {
      // window.FOO = ... / window['FOO'] = ... —— 顶层赋值即「定义」，但不在 defs 里（它不是声明）
      const L = st.expression.left;
      if (L.type === 'MemberExpression' && L.object.type === 'Identifier' && L.object.name === 'window') {
        const k = !L.computed && L.property.type === 'Identifier' ? L.property.name
                : (L.computed && L.property.type === 'Literal' ? String(L.property.value) : null);
        if (k && !winOwn.has(k)) winOwn.set(k, f);
      }
    }
  }
}

const edges = [], violations = [], indirect = [];
for (const f of order) {
  const src = srcs.get(f);
  if (!src) continue;
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowHashBang: true }); }
  catch (e) { continue; }

  const local = new Set();
  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration' && st.id) local.add(st.id.name);
    else if (st.type === 'ClassDeclaration' && st.id) local.add(st.id.name);
    else if (st.type === 'VariableDeclaration') for (const d of st.declarations) bindingNames(d.id, []).forEach(n => local.add(n));
  }
  const seen = new Set();
  const line = (node) => src.slice(0, node.start).split('\n').length;

  const report = (name, node) => {
    if (local.has(name) || seen.has(name) || !defs.has(name)) return;
    seen.add(name);
    const targets = defs.get(name);
    for (const t of targets) {
      if (t === f) continue;
      edges.push({ from: f, to: t, name, line: line(node) });
      if (idx.get(t) > idx.get(f)) violations.push({ from: f, to: t, name, line: line(node), at: idx.get(f), def_at: idx.get(t) });
      return;   // 同名多定义由 dups 单独报（>0 时本门禁判 FAIL），这里只取第一个
    }
  };

  const scan = (st) => {
    walk(st, null, (n, p) => {
      if (!isReadIdent(n, p)) return;
      // window.NAME 的间接引用：只在 window.NAME 被顶层赋值过时才认，避免把全局内置当边
      if (n.name === 'window') return;
      if (p && p.type === 'MemberExpression' && p.object === n && winOwn.has(
            !p.computed && p.property.type === 'Identifier' ? p.property.name
            : (p.computed && p.property.type === 'Literal' ? String(p.property.value) : ''))) {
        const k = !p.computed && p.property.type === 'Identifier' ? p.property.name : String(p.property.value);
        const t = winOwn.get(k);
        if (t !== f && idx.get(t) > idx.get(f)) indirect.push({ from: f, to: t, name: 'window.' + k, line: line(n) });
        return;
      }
      report(n.name, n);
    });
  };

  for (const st of ast.body) {
    if (st.type === 'FunctionDeclaration') continue;          // 声明体不在加载期执行
    if (st.type === 'ClassDeclaration') { if (st.superClass) scan(st.superClass); continue; }
    if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) { if (d.init) scan(d.init); walkPattern(d.id, (n, p) => { if (isReadIdent(n, p)) report(n.name, n); }); }
      continue;
    }
    scan(st);
  }
}

// 同名顶层声明跨文件：>0 则「定义在哪个文件」本身没有唯一答案，上面按第一个定义取边会判不准。
const dups = [];
for (const [n, fs_] of defs) if (fs_.length > 1) dups.push({ name: n, files: fs_ });
dups.sort((a, b) => a.name.localeCompare(b.name));

process.stdout.write(JSON.stringify({
  files: order.length,
  edges: edges.sort((a, b) => (a.from + a.name).localeCompare(b.from + b.name)),
  violations: violations.sort((a, b) => (a.from + a.name).localeCompare(b.from + b.name)),
  indirect,
  dups,
  parseFail,
}) + '\n');
