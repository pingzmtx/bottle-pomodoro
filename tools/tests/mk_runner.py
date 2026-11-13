#!/usr/bin/env python3
"""把 run_smoke 的某个用例（或 tools/tests/ 下的断言文件）装进一个临时页面里跑。

为什么需要：内置浏览器打不开 minis:// 的 fetch，手工「抄一遍断言」既慢又会抄漂。
这个脚本直接读产物 index.html，把用例的 js() 片段按顺序原样内联进页面，
浏览器打开它，用例自己跑完，结果放在 window.__CASERESULT。

用法：
    python3 tools/tests/mk_runner.py c31            # run_smoke.py 里的 @case c31
    python3 tools/tests/mk_runner.py -f 文件.js     # 直接内联某个断言文件
跑完记得删：python3 tools/tests/mk_runner.py --clean
"""
import ast
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SMOKE = os.path.join(ROOT, "tools", "run_smoke.py")
INDEX = None          # 延迟到用时解析：多产物走 public/，需要内联时用 single_html()
OUT = os.path.join(ROOT, "tools", "tests", "_tmp_run.html")

# 必须在应用脚本之前执行：掐掉「回前台自动同步」（05_journey 的 setupCrossTabSync）。
# 它按「记录条数不一致」从存档全量重载 appData，会把用例刚注进内存的假数据冲回真实存档——
# 表现是「断言跑着跑着数据自己变回去了」，且上一次的注入还会被存进用户数据。
# 只影响这个一次性页面，产物 index.html 不受影响。
PRE = """
<script>
(function () {
  var orig = document.addEventListener.bind(document);
  document.addEventListener = function (type, fn, opt) {
    if (type === 'visibilitychange') { window.__blockedVT = (window.__blockedVT || 0) + 1; return; }
    return orig(type, fn, opt);
  };
})();
</script>
"""

WRAP = """
<script>
/* 时间线探针：每 100ms 记一次记录条数，用来抓「谁在测试跑完后又动了 appData」 */
window.__TL = [];
var __t0 = Date.now();
setInterval(function () {
  if (window.__TL.length > 300) return;
  window.__TL.push([Date.now() - __t0,
    (typeof appData !== 'undefined' && appData.records) ? appData.records.length : -1,
    (typeof window.__c31bk !== 'undefined' || typeof window.__c32bk !== 'undefined') ? 1 : 0]);
}, 100);
window.addEventListener('load', function () {
  setTimeout(function () {
    /* 断掉持久化：这个页面只用来跑用例，绝不该把测试记录写进用户的 storage */
    window.__writes = [];
    try {
      window._saveDataImmediate = function () { window.__writes.push(appData.records.length); };
      window.idbWrite = function () {};
    } catch (e) { window.__noStub = String(e); }
    var __R = null, __err = null;
    try {
      %s
    } catch (e) { __err = e; }
    window.__CASERESULT = __err
      ? JSON.stringify([['⚠️ 用例抛异常：' + (__err && __err.message ? __err.message : __err), false]])
      : __R;
  }, 600);
});
</script>
"""


def _js_calls(fn):
    """按源码顺序取用例里所有 js('...') 的字面量（_case_js('x.js') 会展开成文件内容）。"""
    calls = []
    for n in ast.walk(fn):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "js":
            a0 = n.args[0]
            if isinstance(a0, ast.Constant) and isinstance(a0.value, str) and "function" in a0.value:
                calls.append((n.lineno, a0.value))
            elif (isinstance(a0, ast.Call) and isinstance(a0.func, ast.Name)
                  and a0.func.id == "_case_js" and a0.args
                  and isinstance(a0.args[0], ast.Constant)):
                p = os.path.join(ROOT, "tools", "tests", a0.args[0].value)
                calls.append((n.lineno, open(p, encoding="utf-8").read().strip()))
    calls.sort()
    return [c[1] for c in calls]


def _first_real_script(html):
    """产物头部有大段 HTML 注释，里面的示例代码也含 <script> 字样；
    直接找第一个 <script 会插进注释里，脚本永远不执行。先算出注释区间再找。"""
    spans, pos = [], 0
    while True:
        a = html.find("<!--", pos)
        if a < 0:
            break
        b = html.find("-->", a)
        if b < 0:
            b = len(html)
        spans.append((a, b))
        pos = b + 3
    idx = 0
    while True:
        i = html.find("<script", idx)
        if i < 0:
            return -1
        if not any(a <= i < b for a, b in spans):
            return i
        idx = i + 7


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    if sys.argv[1] == "--clean":
        if os.path.exists(OUT):
            os.remove(OUT)
            print("已删除", OUT)
        return
    if sys.argv[1] == "-f":
        path = sys.argv[2]
        if not os.path.isabs(path):
            path = os.path.join(ROOT, path)
        runs = [open(path, encoding="utf-8").read().strip()]
    else:
        name = sys.argv[1]
        src = open(SMOKE, encoding="utf-8").read()
        tree = ast.parse(src)
        fns = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name]
        if not fns:
            sys.exit("没找到用例 " + name)
        runs = _js_calls(fns[0])
        if not runs:
            sys.exit("用例里没有可内联的 js() 片段")

    stmts = ["var __ALL = [];"]
    for i, code in enumerate(runs):
        stmts.append("__ALL.push((%s));" % code)
    stmts.append("for (var __i = __ALL.length - 1; __i >= 0; __i--) {"
                 " if (typeof __ALL[__i] === 'string' && __ALL[__i].charAt(0) === '[') {"
                 " __R = __ALL[__i]; break; } }")
    # 内联的片段是当表达式嵌进 __ALL.push((...)) 的：用例若多写一个结尾分号
    # （或任何语法错），整块 <script> 直接不执行 —— 页面看着正常，__CASERESULT 永远是
    # undefined，人却以为「测试没跑完」。这里先本地做一次语法检查，宁可当场报错。
    _block = "var __ALL = [];\n" + "".join("__ALL.push((%s));\n" % c for c in runs)
    _bp = os.path.join(os.path.dirname(OUT), "_tmp_block.js")
    open(_bp, "w", encoding="utf-8").write(_block)
    _chk = subprocess.run(["node", "--check", _bp], capture_output=True, text=True)
    if _chk.returncode != 0:
        sys.exit("内联片段有语法错误（页面会静默不执行）:\n" + (_chk.stderr or "").strip()[:800])
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from _app_path import single_html
    html = open(single_html(), encoding="utf-8").read()
    for marker in ("</body>", "</html>"):
        i = html.rfind(marker)
        if i >= 0:
            break
    else:
        sys.exit("产物里既没有 </body> 也没有 </html>")
    html = html[:i] + (WRAP % ("\n      ".join(stmts))) + html[i:]
    s = _first_real_script(html)
    if s < 0:
        sys.exit("找不到真正的 <script>，掐不掉跨窗口同步")
    html = html[:s] + PRE + html[s:]
    open(OUT, "w", encoding="utf-8").write(html)
    print("已生成", OUT, os.path.getsize(OUT), "字节，内联 %d 段" % len(runs))


if __name__ == "__main__":
    main()
