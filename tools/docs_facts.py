#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""文档数字的单一来源（P3：消灭"宣称 vs 实测"漂移）。

背景：README / AGENTS / 各工具 docstring 里的数字各写各的——
"33 个源文件"（实际 46）、"99 项冒烟断言"（实际 1700+）、"十段验证链"（实际 22）、
"01d 5,959 行余量 41 行"（实际 3,742 行，余量 2,258）。数字没有生成机制，
每加一个用例就漂一点，最后没人敢信文档。

用法：
    python3 tools/docs_facts.py            # 打印事实表
    python3 tools/docs_facts.py --write    # 写入 docs/FACTS.md（人读，供 README 引用）

原则：**只统计、不改 README**。自动改文档会制造新的"不知道谁改的"，
而一份带时间戳的事实表足够让读者自查漂移。
"""
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "src", "scripts")
OUT = os.path.join(ROOT, "docs", "FACTS.md")


def count_funcs(src):
    return len(re.findall(r"^\s*function\s+([A-Za-z_$][\w$]*)\s*\(", src, re.M))


def main():
    js = sorted(f for f in os.listdir(SCRIPTS) if f.endswith(".js"))
    texts = {f: open(os.path.join(SCRIPTS, f), encoding="utf-8").read() for f in js}
    n_funcs = sum(count_funcs(t) for t in texts.values())

    runner = open(os.path.join(ROOT, "tools", "run_smoke.py"), encoding="utf-8").read()
    n_cases = len(re.findall(r'@case\("', runner))
    n_checks = len(re.findall(r"\n\s*check\(", runner))

    unit = open(os.path.join(ROOT, "tools", "tests", "unit_pure.js"), encoding="utf-8").read()
    n_unit = len(re.findall(r"\b(?:eq|ok)\(", unit))

    verify_src = open(os.path.join(ROOT, "tools", "verify.py"), encoding="utf-8").read()
    n_steps = len(re.findall(r'^\s*\("[\w-]+",', verify_src, re.M))

    e2e = open(os.path.join(ROOT, "tools", "tests", "e2e_flows.py"), encoding="utf-8").read()
    n_e2e = len(set(re.findall(r"\bF(\d)\b", e2e)))

    pub = os.path.join(ROOT, "public")
    idx_mb = (sum(os.path.getsize(os.path.join(dp, f)) for dp, _dn, fn in os.walk(pub) for f in fn)
              / 1024 / 1024) if os.path.isdir(pub) else 0

    # 空 catch（与 empty_catch_audit 同口径：catch (...) { } 或 { 仅注释 }）
    n_empty_catch = sum(len(re.findall(r"catch\s*\([^)]*\)\s*\{\s*\}", t)) for t in texts.values())

    # 最大源文件
    biggest = max(((len(t.splitlines()), f) for f, t in texts.items()), default=(0, "-"))

    rows = [
        ("JS 源文件数", len(js)),
        ("顶层函数总数", n_funcs),
        ("冒烟注册用例数", n_cases),
        ("runner 内联 check() 数", n_checks),
        ("unit_pure 断言数（静态计数）", n_unit),
        ("verify 链段数", f"{n_steps}（加 --e2e 为 {n_steps + 3}）"),
        ("e2e 动线数", n_e2e),
        ("public/ 产物总大小 (MB，未压缩)", round(idx_mb, 2)),
        ("空 catch 数（静态）", n_empty_catch),
        ("最大源文件", f"{biggest[1]}（{biggest[0]} 行）"),
    ]

    width = max(len(k) for k, _ in rows)
    lines = [f"{k.ljust(width)}  {v}" for k, v in rows]
    body = "\n".join(lines)
    print(body)

    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        md = [
            "# 项目事实表（自动生成）",
            "",
            f"> 生成时间：{time.strftime('%Y-%m-%d %H:%M')}　命令：`python3 tools/docs_facts.py --write`",
            "> 文档里的数字以本表为准；发现 README 与本表不一致时，改 README、不要改本表。",
            "",
            "| 指标 | 实测 |",
            "|---|---|",
        ]
        md += [f"| {k} | {v} |" for k, v in rows]
        md.append("")
        md.append("## 为什么要有这张表")
        md.append("")
        md.append("历史问题：README 写「33 个源文件」实际 46、「99 项冒烟断言」实际 1700+、")
        md.append("「十段验证链」实际 22 段、「01d 余量 41 行」实际 2,258 行。数字没有生成机制，")
        md.append("每加一个用例就漂一点，最后维护者不敢信文档、也就不会去读。")
        open(OUT, "w", encoding="utf-8").write("\n".join(md) + "\n")
        print(f"\n✓ 已写入 {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
