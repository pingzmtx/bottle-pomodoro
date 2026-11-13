#!/usr/bin/env python3
"""本地批量跑用例（不接真机桥、不起 chromium）：把多条 tools/tests/*.js 一起内联进
index.html 副本，一次加载跑完，结果挂 window.__RES，用一次 browser_use 取回。

用法：
  python3 tools/local_batch.py c75_sched_snapshot_history c74_seg_length_decoupled ...
  （不带参数 = 跑 tools/local_batch.list 里列的那批）
然后：
  browser_use navigate minis://workspace/_batch.html
  browser_use execute_js `return JSON.stringify(window.__RES)`

为什么这样做：minis:// 页面里 `<script src>` 不执行、fetch 会失败，CSP 又禁 eval，
所以只能内联；好处是**秒级**，不用起浏览器进程、不用连桥。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get("POMO_OUT") or os.path.join(__import__("tempfile").gettempdir(), "_batch.html")
LIST = os.path.join(ROOT, "tools", "local_batch.list")
CONTRACT = os.path.join(ROOT, "tools", "tests", "_contract.js")


def contract_js():
    """用例公共契约（TC：阈值/主题清单/测量原语）。

    必须和 run_smoke.py 走同一份 —— 两条跑法的结果才可比。
    注意：`_contract.js` 是共享文件，不参与"用例名"解析（见下面的 skip）。
    """
    with open(CONTRACT, encoding="utf-8") as f:
        return f.read()


def names_from_args():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if args:
        return args
    if os.path.exists(LIST):
        return [l.strip() for l in open(LIST, encoding="utf-8")
                if l.strip() and not l.startswith("#")]
    return []


def main():
    names = names_from_args()
    if not names:
        print(__doc__)
        return 2
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from _app_path import single_html     # 自包含产物按需生成（多产物没法内联用例 JS）
    html = open(single_html(), encoding="utf-8").read()
    parts = []
    for n in names:
        fn = n if n.endswith(".js") else n + ".js"
        path = os.path.join(ROOT, "tools", "tests", fn)
        if not os.path.exists(path):
            print("✗ 没找到用例文件:", fn)
            return 1
        body = open(path, encoding="utf-8").read().strip()
        if body.endswith(";"):
            body = body[:-1].rstrip()
        if "</script" in body:
            print("✗ 用例含 </script>，无法内联:", fn)
            return 1
        key = fn[:-3]
        parts.append(
            "  try { window.__RES[%r] = JSON.parse((%s)); }\n"
            "  catch (e) { window.__RES[%r] = [['★ 用例抛异常：' + ((e && e.stack) || e), false]]; }\n"
            % (key, body, key)
        )
    boot = """
<script>
/* 本地批量用例注入：load 后等 app 初始化稳定，再逐条跑（每条自己 finally 还原现场） */
/* ★ 用例公共契约（TC）在这里注入一次，所有用例共用 —— 与 run_smoke.py 的 _case_js 同源 */
%s
window.addEventListener('load', function () {
  setTimeout(function () {
    window.__RES = {};
    /* 测试基线：minis:// 同源共享 localStorage，探针页/上一批用例改过的排序偏好会漏进来
       （c46 曾因此在"已经是 planTime"的状态下 setTodoSort 变成翻方向 → 四条假红）。
       每批开跑前把「怎么看列表」的偏好还原成全新安装的默认值。 */
    try {
      if (typeof appData !== 'undefined' && appData && appData.sortPrefs) {
        appData.sortPrefs.todos = { by: 'manual', dir: 'desc', hideDone: false };
        appData.sortPrefs.habits = { by: 'manual', dir: 'asc' };
      }
    } catch (e) { if (window.__silent) window.__silent(e, 'local_batch:sortPrefs'); }
    try {
%s    } catch (e) { window.__FATAL = String((e && e.stack) || e); }
    window.__DONE = 1;
  }, 1200);
});
</script>
""" % (contract_js(), "".join(parts))
    tail = "</body>" if "</body>" in html else "</html>"
    if tail not in html:
        print("✗ index.html 里找不到收尾标签")
        return 1
    out = html.replace(tail, boot + tail, 1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w", encoding="utf-8").write(out)
    print("✓ %s（%d 字节），用例 %d 条：%s" % (OUT, len(out), len(names), " ".join(names)))
    print("→ minis://workspace/_batch.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
