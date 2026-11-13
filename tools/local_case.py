#!/usr/bin/env python3
"""本地单条用例跑法（不接真机桥、不起 chromium）。

原理：dist 的 index.html 是自包含的，浏览器直接打开就能跑；但 minis:// 页面里
`<script src=...>` 不执行、`fetch('minis://...')` 会 Failed to fetch —— 所以用例文本
**必须内联**进副本尾部。本脚本就是把 tools/tests/<case>.js 贴进 index.html 的副本，
等 app 初始化完成后求值，结果存成 JSON 字符串挂在 window.__CASE 上。

用法：
  python3 tools/local_case.py c75_sched_snapshot_history
  → 输出 /var/minis/workspace/_case.html
然后用 browser_use：
  navigate minis://workspace/_case.html → execute_js `return window.__CASE`

注意：页面 CSP 是 script-src 'unsafe-inline'（无 unsafe-eval），所以 new Function / eval
一律被拒；用例必须是**内联脚本**，不能靠字符串求值。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("POMO_OUT") or os.path.join(__import__("tempfile").gettempdir(), "_case.html")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    name = sys.argv[1]
    if not name.endswith(".js"):
        name += ".js"
    case_path = os.path.join(ROOT, "tools", "tests", name)
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from _app_path import single_html     # 自包含产物按需生成（多产物没法内联用例 JS）
    html = open(single_html(), encoding="utf-8").read()
    case = open(case_path, encoding="utf-8").read().strip()
    contract = open(os.path.join(ROOT, "tools", "tests", "_contract.js"), encoding="utf-8").read().strip()
    expr = case[:-1].rstrip() if case.endswith(";") else case
    if "</script" in expr or "</script" in contract:
        print("✗ 用例里含 </script>，无法内联")
        return 1
    # 直接内联表达式本身（不做函数包装，避免套一层 return 时的歧义）
    boot = """
<script>
/* 本地用例注入：等 app 初始化完（各模块 DOMContentLoaded + 首帧渲染）再求值 */
window.addEventListener('load', function () {
  setTimeout(function () {
    try { window.__CASE = (function () { %s
      return (%s); })(); }
    catch (e) { window.__ERR = String((e && e.stack) || e);
                window.__CASE = JSON.stringify([['★ 用例抛异常：' + (e && e.message ? e.message : e), false]]); }
  }, 1200);
});
</script>
""" % (contract, expr)
    tail = "</body>" if "</body>" in html else "</html>"
    if tail not in html:
        print("✗ index.html 里找不到收尾标签")
        return 1
    out = html.replace(tail, boot + tail, 1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(out)
    print("✓ 已写出 %s（%d 字节）" % (OUT, len(out)))
    print("→ minis://workspace/_case.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
