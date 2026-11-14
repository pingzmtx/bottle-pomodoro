#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顶层加载顺序门禁：脚本在加载期引用的符号，不能来自「排在它后面」的文件。

为什么需要它
    69 个脚本被拼成一个大 `<script>`，执行顺序 = manifest 数组顺序。
    函数体之间的互相调用发生在运行期，先后无所谓；但**顶层语句**在加载期就求值，
    一旦引用后面才定义的东西，浏览器直接 ReferenceError / TDZ —— 而这类错误
    只在真机加载时出现，`--check`（重建产物逐字节比对）和 smoke 都可能漏。

判据（只走 Program.body，不进函数体）
    顶层 `const/let/var` 的初始化表达式、解构默认值、顶层 `class X extends Y`、
    其余顶层语句里的标识符读取 —— 解析到定义所在文件下标，必须 <= 引用所在文件下标。
    `window.FOO = ...`（顶层赋值）算定义，顶层读 `window.FOO` 算边（当前 0 条）。

三类一起判 FAIL
    1. violations  引用指向更后的文件 —— 真会炸
    2. dups        同名顶层声明跨文件 —— 「定义在哪」不唯一，边也就不唯一，判据不成立
    3. parseFail   解析失败 —— 判不了就是没判

基线
    tools/toplevel_order_baseline.json 只记录**边的集合**（不含行号，行号天天变）。
    新增一条边 → FAIL，要你显式跑 `--update` 收基线（那会出现在 diff 里）。
    边消失 → 只提示，不拦：拆文件/删代码让耦合变少是好事。

用法
    python3 tools/check_toplevel_order.py            # 校验
    python3 tools/check_toplevel_order.py -v         # 校验 + 列出全部边
    python3 tools/check_toplevel_order.py --update   # 收基线（有违例时拒绝）
退出码：0 通过 / 1 失败 / 3 环境不具备（没有 node）
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")
BASE = os.path.join(TOOLS, "toplevel_order_baseline.json")


def load_order():
    """与 build.assemble() 同源：模板片段顺序 → 槽占位顺序 → manifest 里的文件顺序。

    直接 import build 而不是抄一遍，避免「门禁算出来的顺序」和「构建用的顺序」漂开 ——
    两者一旦不一致，这条门禁就变成了自娱自乐。
    """
    sys.path.insert(0, TOOLS)
    import build  # noqa: E402  （build.py 模块级只有常量，import 无副作用）

    tpl = build.load_template()
    slots = [int(x) for x in re.findall(r"<!--@@__JSS_(\d+)__@@-->", tpl)]
    mani = json.load(open(build.MANI, encoding="utf-8"))
    by = {m["slot"]: m for m in mani["slots"]}
    seq = []
    for sid in slots:
        m = by.get(sid)
        if not m:
            continue
        if m.get("files"):
            seq.extend(m["files"])
        else:
            seq.append(m["file"])
    return seq


def main():
    verbose = "-v" in sys.argv or "--verbose" in sys.argv
    update = "--update" in sys.argv
    unknown = [a for a in sys.argv[1:] if a not in ("-v", "--verbose", "--update")]
    if unknown:
        print(f"✗ 不认识的参数：{' '.join(unknown)}")
        return 2

    if shutil.which("node") is None:
        print("○ 没有 node，跳过顶层顺序检查")
        return 3

    order = load_order()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump(order, fh, ensure_ascii=False)
        tmp = fh.name
    try:
        r = subprocess.run(["node", os.path.join(TOOLS, "toplevel_order_ast.js"), tmp],
                           capture_output=True, text=True, timeout=120)
    finally:
        os.unlink(tmp)
    if r.returncode != 0 or not r.stdout.strip():
        print("✗ 解析脚本执行失败：")
        print((r.stderr or r.stdout).strip()[:800])
        return 1
    res = json.loads(r.stdout)

    edges = [(e["from"], e["to"], e["name"]) for e in res["edges"]]
    have = set(edges)
    base = {"edges": []}
    if os.path.exists(BASE):
        base = json.load(open(BASE, encoding="utf-8"))
    known = {tuple(x) for x in base["edges"]}

    print(f"加载顺序 {res['files']} 个文件 · 顶层跨文件引用边 {len(edges)} 条"
          f"（基线 {len(known)} 条）")

    fatal = 0      # 违例/重复/解析失败：任何情况下都 FAIL，也不许 --update 掩盖
    if res["parseFail"]:
        fatal += 1
        print(f"\n✗ 解析失败 {len(res['parseFail'])} 个文件 —— 判不了就是没判：")
        for p in res["parseFail"]:
            print(f"    {p['file']}：{p['msg']}")

    if res["dups"]:
        fatal += 1
        print(f"\n✗ 同名顶层声明跨文件 {len(res['dups'])} 组 —— 定义不唯一，判据不成立：")
        for d in res["dups"]:
            print(f"    {d['name']}：{' / '.join(d['files'])}")

    if res["violations"]:
        fatal += 1
        print(f"\n✗ 引用指向更后的文件 {len(res['violations'])} 处（加载期就会炸）：")
        for v in res["violations"]:
            print(f"    {v['from']}:{v['line']}  {v['name']}  →  {v['to']}"
                  f"   [下标 {v['at']} → {v['def_at']}]")

    if res["indirect"]:
        fatal += 1
        print(f"\n✗ window.X 间接引用指向更后的文件 {len(res['indirect'])} 处：")
        for v in res["indirect"]:
            print(f"    {v['from']}:{v['line']}  {v['name']}  →  {v['to']}")

    new = sorted(have - known)
    gone = sorted(known - have)
    if new:
        print(f"\n✗ 新增 {len(new)} 条加载期耦合（不在基线里）：")
        for a, b, n in new:
            print(f"    {a}  →  {b}  {n}")
        print("    确认这是有意的（且方向正确）后：python3 tools/check_toplevel_order.py --update")

    if gone:
        print(f"\n· {len(gone)} 条旧边消失（耦合变少，不拦）：")
        for a, b, n in gone:
            print(f"    {a}  →  {b}  {n}")

    if verbose:
        print("\n全部边：")
        for e in res["edges"]:
            print(f"    {e['from']}:{e['line']}  →  {e['to']}  {e['name']}")

    if update:
        if fatal:
            print("\n✗ 有违例/重复/解析失败时不允许 --update —— 那不是「基线该收」，是代码有问题")
            return 1
        json.dump({"_note": "顶层加载期引用边（不含行号）。新增边必须显式 --update，diff 可见。",
                   "count": len(edges),
                   "edges": [list(e) for e in sorted(have)]},
                  open(BASE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"\n✓ 基线已更新：{len(edges)} 条边 → {os.path.relpath(BASE, ROOT)}")
        return 0

    if fatal or new:
        return 1
    print(f"✓ 顶层顺序 OK：{len(edges)} 条边全部指向同序或更前的文件，违例 0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
