#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_case_meta.py — 冒烟用例「元数据」门禁（tier / owner 必须写全、且指得准）

为什么要有这条门禁：
  「按改动选跑用例」的前提是每条用例都声明了自己归谁管（@case(..., tier=, owner=)）。
  但声明这件事靠人/靠 AI 记性，迟早漏 —— 漏了不会报错，只会**静默地少跑**：
      · 新加的用例忘写 owner  → 改到它那块功能时，它永远不会被选中 → 假绿。
      · owner 写错一个字（01e7 → 01e6）→ 同样永远选不中，还没人发现。
  少跑 = 假绿，比多跑严重得多。所以把它做成机器门禁：写错/漏写就提交不上去。

只做三件确定性检查（纯静态、<1s）：
  1. tier ∈ {core, feature}
  2. owner 非空（feature 层必须能被选中；core 层是兜底，允许空）
  3. owner 里每个前缀都能在 src/ 下匹配到真实文件 —— 防拼错（typo = 永远选不中）
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SMOKE = os.path.join(HERE, "run_smoke.py")

RE_CASE = re.compile(
    r'@case\(\s*"([^"]+)"\s*(?:,\s*tier\s*=\s*"([^"]*)")?\s*(?:,\s*owner\s*=\s*"([^"]*)")?\s*\)')

TIERS = ("core", "feature")
CORE_MAX = 15   # core 层是「每改任何东西都跑」的固定成本，必须封顶（否则会悄悄涨成全量）


def src_files():
    fs = glob.glob(os.path.join(ROOT, "src", "scripts", "*.js"))
    fs += glob.glob(os.path.join(ROOT, "src", "*.html"))
    return [os.path.relpath(f, ROOT) for f in fs]


def main():
    src = open(SMOKE, encoding="utf-8").read()
    decos = re.findall(r'@case\(', src)
    cases = RE_CASE.findall(src)
    problems = []

    if len(cases) != len(decos):
        problems.append(
            f"有 {len(decos) - len(cases)} 条 @case 没被解析出来 —— "
            "多半是跨行写了装饰器；本门禁要求 @case(...) 写在一行内")

    files = src_files()

    for name, tier, owner in cases:
        if tier not in TIERS:
            problems.append(f"{name}: tier={tier!r} 非法，只能是 {' / '.join(TIERS)}")
        toks = owner.split()
        if not toks:
            if tier == "core":
                continue
            problems.append(
                f"{name}: 没写 owner —— 改到它那块模块时它永远不会被选中（假绿），"
                "要么补 owner，要么升成 tier=\"core\"")
            continue
        for t in toks:
            if not any(t in f for f in files):
                problems.append(
                    f"{name}: owner 前缀 {t!r} 在 src/ 下匹配不到任何文件（拼错？）"
                    "→ 它永远选不中")

    n_core = len([1 for _n, t, _o in cases if t == "core"])
    if n_core > CORE_MAX:
        problems.append(
            f"core 层 {n_core} 条 > 上限 {CORE_MAX} —— core 是**每次改任何东西都要跑**的"
            "固定成本，它涨 = 日常成本涨。先问：这条真的「任何改动都可能踩到」吗？"
            "不是就降成 tier=\"feature\"（改到它那块才跑）")
    print(f"用例元数据: {len(cases)} 条（core {n_core} / feature {len(cases)-n_core}）")
    if problems:
        print(f"❌ {len(problems)} 处问题：")
        for p in problems:
            print("   · " + p)
        return 1
    print("✓ 全部用例 tier/owner 齐备且指向真实文件")
    return 0


if __name__ == "__main__":
    sys.exit(main())
