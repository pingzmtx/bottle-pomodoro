#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""· 单文件规模红线（为什么必须有这一段）

背景：
    项目在 Wave 2 定过一条硬规则 —— **「无 >6000 行文件」**（拆域的直接产物）。
    拆完当期最大文件是 01d，5,836 行，留了 164 行余量。

    但这条规则**只写在文档里**（AGENTS.md / 00_给下一个AI的开场白.md / 交底 doc），
    tools/ 下**没有任何工具在守它**。而 01d 现在已经是 5,959 行 —— 余量只剩 41 行。

    规则和机器脱钩 = 没有规则。文档说 ≤6000，机器不管，那下一个人往 01d 里
    再加一个小功能时，不会有人拦他，文件会悄悄越过红线，直到某天"又撞一次墙"。

    本工具把那条口头规则变成**可执行的规则**：超出即在回归链里 FAIL。

口径：
    - 只统计 src/scripts/*.js（真源里的 JS；index.html 是产物，不计）。
    - template.html 单独作为参考打印，**不参与判定**（它是 HTML+CSS 模板，
      与 JS 的可读性压力不同源，硬套同一个数字没有依据）。

阈值：
    - 5800 行 → WARN（不 FAIL）。给"快满了"一个提前信号，不打断提交。
    - 6000 行 → FAIL（退出码 1）。这正是文档写死的红线，撞线即拦。

    留两档而不是一档，是因为只报 FAIL 的话，人只会在已经撞线时才知道；
    而拆文件这件事需要提前规划，不是撞线当天能补的。

怎么处理 FAIL：
    1. 优先「按渲染/职责域再拆一个文件」——照 01e → 01e2~01e8 的既有先例
       （新文件头写明「由 XX 按 YY 域拆出」，并登记进 src/manifest.json 的 slot 1 files）。
    2. 拆完必须 `python3 tools/build.py` 重建产物，再跑 `verify.py --e2e`。
    3. 不要靠"调大阈值"绕过 —— 阈值来自文档，改阈值要同时改文档，否则又是一次脱钩。

用法：
    python3 tools/w6_size.py            # 报告 + 退出码（有 FAIL=1，仅 WARN=0）
    python3 tools/w6_size.py --json     # 结构化输出
"""
import glob
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
SCRIPTS = os.path.join(_ROOT, "src", "scripts")

AS_JSON = "--json" in sys.argv

WARN_LINES = 5800
FAIL_LINES = 6000


def count_lines(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return sum(1 for _ in f)


def main():
    rows = []
    for p in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        n = count_lines(p)
        rows.append({"file": os.path.basename(p), "lines": n})

    fails = [r for r in rows if r["lines"] > FAIL_LINES]
    warns = [r for r in rows if WARN_LINES < r["lines"] <= FAIL_LINES]
    top = sorted(rows, key=lambda r: -r["lines"])[:8]

    # template.html 仅作参考，不参与判定
    tpl = os.path.join(_ROOT, "src", "template.html")
    tpl_lines = count_lines(tpl) if os.path.exists(tpl) else None

    if AS_JSON:
        print(json.dumps({
            "status": "fail" if fails else ("warn" if warns else "pass"),
            "limit_warn": WARN_LINES,
            "limit_fail": FAIL_LINES,
            "files": len(rows),
            "fail": fails,
            "warn": warns,
            "top8": top,
            "template_html_lines": tpl_lines,
        }, ensure_ascii=False))
        return 1 if fails else 0

    print(f"📏 单文件规模检查  |  红线 {FAIL_LINES} 行 / 预警 {WARN_LINES} 行  |  {len(rows)} 个文件\n")
    print("  最大 8 个文件：")
    for r in top:
        flag = "❌ 超红线" if r["lines"] > FAIL_LINES else ("⚠️ 接近红线" if r["lines"] > WARN_LINES else "")
        print(f"    {r['lines']:>6} 行  {r['file']}{('  ' + flag) if flag else ''}")

    if tpl_lines is not None:
        print(f"\n  参考（不判定）：src/template.html {tpl_lines} 行")

    if warns:
        print(f"\n⚠️ 预警 {len(warns)} 个（未超红线，但已进入需规划拆分的区间）：")
        for r in warns:
            print(f"    {r['file']}  {r['lines']} 行（距红线还剩 {FAIL_LINES - r['lines']} 行）")

    if fails:
        print(f"\n❌ 超红线 {len(fails)} 个（文档规则：无 >{FAIL_LINES} 行文件）：")
        for r in fails:
            print(f"    {r['file']}  {r['lines']} 行（超出 {r['lines'] - FAIL_LINES} 行）")
        print("\n处理办法见本文件头部「怎么处理 FAIL」。禁止直接调大阈值绕过。")
        return 1

    print("\n✓ 无文件超红线")
    return 0


if __name__ == "__main__":
    sys.exit(main())
