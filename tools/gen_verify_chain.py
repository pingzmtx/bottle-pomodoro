#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gen_verify_chain.py —— 把 AGENTS.md 的「已挂链」列表从 verify.py 自动生成

为什么要这个脚本
----------------
2026-11-14 实测：AGENTS.md 第 154 行手写的「已挂链」列了 13 段，
而 verify.py 实际有 30 段 —— callgraph 与 csstok 两次新增都没同步进文档。
同一份文档里「359 处硬编码颜色」也是手写值，复现不出来只能作废。
结论：**凡是手写的清单都必然过期**（不是这次忘了，是机制上一定会忘）。
所以这段改成从源码生成，并且挂进 verify.py 当门禁 —— 文档与代码不一致就红灯。

生成什么
--------
从 tools/verify.py 的 AST 里读两处：
  1. `steps = [ ("name", cmd), … ]`   → 快档/主链段（按源码顺序）
  2. `steps.append(("name", …))`      → --e2e 才追加的段
不执行 verify.py、不 import 它，纯读源码，所以没有副作用、也不怕它跑起来慢。

用法
----
    python3 tools/gen_verify_chain.py --check   # 门禁：与 AGENTS.md 不一致 → 退出 1
    python3 tools/gen_verify_chain.py --write   # 重写 AGENTS.md 里的标记块
    python3 tools/gen_verify_chain.py           # 只打印生成结果，便于人看
"""
import ast
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFY = os.path.join(ROOT, "tools", "verify.py")
AGENTS = os.path.join(ROOT, "AGENTS.md")
BEGIN = "<!-- verify-chain:begin 由 tools/gen_verify_chain.py 从 verify.py 生成，勿手改 -->"
END = "<!-- verify-chain:end -->"


def collect():
    """返回 (主链段名列表, --e2e 追加段名列表)。

    只认两处，不认其它 append：smoke 在 fast/full/默认 三个分支各 append 一次，
    它不属于「已挂链的固定段」，混进来会重复三次、还会随调用方式变化。
    """
    tree = ast.parse(open(VERIFY, encoding="utf-8").read())
    core, extra = [], []
    for node in ast.walk(tree):
        # steps = [ ("gate", "…"), … ]
        if isinstance(node, ast.Assign):
            tgts = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if tgts == ["steps"] and isinstance(node.value, ast.List):
                for elt in node.value.elts:
                    name = _first_str(elt)
                    if name:
                        core.append((elt.lineno, name))
        # if with_e2e: steps.append(("e2e", "…"))
        elif isinstance(node, ast.If):
            test = node.test
            if isinstance(test, ast.Name) and test.id == "with_e2e":
                for stmt in node.body:
                    call = getattr(stmt, "value", None)
                    if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                            and call.func.attr == "append" and call.args):
                        name = _first_str(call.args[0])
                        if name:
                            extra.append((call.lineno, name))
    # ast.walk 不保证顺序，按源码行号还原
    return [n for _, n in sorted(core)], [n for _, n in sorted(extra)]


def _first_str(node):
    """从 ("name", cmd) 元组里取第一个字符串常量。"""
    if isinstance(node, ast.Tuple) and node.elts:
        e = node.elts[0]
        if isinstance(e, ast.Constant) and isinstance(e.value, str):
            return e.value
    return None


def render():
    core, extra = collect()
    lines = [
        BEGIN,
        "已挂链 %d 段（`python3 tools/verify.py --fast` 依次跑）：%s"
        % (len(core), " / ".join("`%s`" % n for n in core)),
        "",
        "`--e2e` 再追加 %d 段：%s"
        % (len(extra), " / ".join("`%s`" % n for n in extra)),
        END,
    ]
    return "\n".join(lines)


def read_block(text):
    i = text.find(BEGIN)
    if i < 0:
        return None
    j = text.find(END, i)
    if j < 0:
        return None
    return text[i: j + len(END)]


def main():
    argv = sys.argv[1:]
    block = render()
    agents = open(AGENTS, encoding="utf-8").read()
    cur = read_block(agents)

    if "--write" in argv:
        if cur is None:
            print("✗ AGENTS.md 里找不到标记块，无法写入。请先手工放置：")
            print(block)
            return 1
        if cur != block:
            open(AGENTS, "w", encoding="utf-8").write(agents.replace(cur, block))
            print("✅ 已重写 AGENTS.md 的「已挂链」块")
        else:
            print("✅ 已是最新，无需改动")
        return 0

    if "--check" in argv:
        if cur is None:
            print("✗ AGENTS.md 缺少「已挂链」标记块（应含 %s）" % BEGIN)
            return 1
        if cur != block:
            print("✗ AGENTS.md 的「已挂链」列表与 tools/verify.py 不一致")
            print("  文档现写：")
            for ln in cur.splitlines():
                print("    " + ln)
            print("  代码实际：")
            for ln in block.splitlines():
                print("    " + ln)
            print("  修法：python3 tools/gen_verify_chain.py --write")
            return 1
        print("✅ 「已挂链」列表与 verify.py 一致（%d 段 + e2e %d 段）"
              % (len(collect()[0]), len(collect()[1])))
        return 0

    print(block)
    return 0


if __name__ == "__main__":
    sys.exit(main())
