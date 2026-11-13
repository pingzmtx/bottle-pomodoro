#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""门禁：data-act 派发的步进参数必须先归一成数字。

病根：00_delegate.js 的 readArgs() 对 `data-act-args='["-1"]'` 原样返回**字符串**。
于是 `month += delta` 变成字符串拼接：8 → "8-1" → "8-1-1" → …
真实事故（2026-10-25 用户截图）：日志页「日历总览」点几下左右箭头，
标题变成 `2026年9-1111-1-1-111月`，`new Date(2026, "9-1111-1-1-111")` 是
Invalid Date → 整个日期格子渲染不出来，只剩星期行。
同批排查发现**四处日历全都中招**（总览 / 日志 / 传记 / 统计），共 7 个函数。

为什么不能只改 data-act-args 里的引号：模板里的 `["1"]` 是人工写的，
漏一个就复发；而且 `@value` 返回的本来就一定是字符串。
所以规则定在**函数入口**：凡是「X += 参数」形态的累加，右侧必须过 Number()。

本检查用窄口径正则：只抓「标识符 += 标识符」这一种形态，右侧不是
Number()/parseInt()/parseFloat()/一元加号 就报。宁可漏掉变形写法，
也不要因为误报让人把门禁关掉。
"""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "scripts")

# 只匹配「左标识符 += / -= 右标识符;」这类累加
PAT = re.compile(r"^\s*[A-Za-z_$][\w$]*\s*(?:\+=|-=)\s*([A-Za-z_$][\w$]*)\s*;")
# 只有这些名字才是「从模板传进来的步进量」。其余 `total += d` 是一般的数值累加
# （d 在那里是 DataPoint 之类的对象成员），不加白名单会淹在误报里 ——
# 一个天天误报的门禁，最后一定被人关掉。宁可窄。
STEP_NAMES = {"d", "delta", "diff", "step", "dir", "direction", "dd", "page", "offset"}
# 右侧出现这些就算已归一
SAFE = re.compile(r"\b(Number|parseInt|parseFloat)\s*\(")

# 已知安全：这些标识符不是「来自模板的步进量」，而是本文件内的计数循环变量。
ALLOW_NAMES = {"i", "j", "k", "n", "idx", "count", "pomoCount"}


FUNC = re.compile(r"function\s*[\w$]*\s*\(([^)]*)\)\s*\{")
ARROW = re.compile(r"^\s*(?:const|let|var)?\s*[\w$]*\s*=?\s*\(([^)]*)\)\s*=>")


def _is_param(lines, idx, name):
    """向上找最近的函数形参表，判断 name 是否是形参。"""
    for back in range(idx - 1, max(-1, idx - 60), -1):
        line = lines[back]
        m = FUNC.search(line) or ARROW.search(line)
        if not m:
            continue
        params = [p.strip().split("=")[0].strip() for p in m.group(1).split(",")]
        return name in params
    return False


def scan():
    bad = []
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".js"):
            continue
        path = os.path.join(SRC, name)
        lines = io.open(path, encoding="utf-8").read().split("\n")
        for no, line in enumerate(lines, 1):
            if line.lstrip().startswith(("*", "//", "/*")):
                continue
            m = PAT.match(line)
            if not m:
                continue
            rhs = m.group(1)
            if rhs not in STEP_NAMES:
                continue  # 一般数值累加，不是步进参数
            if rhs in ALLOW_NAMES or SAFE.search(line):
                continue
            # 只有「确实是该函数的形参」才算 bug。若它是本文件里 const/let 出来的
            # 数值（例如 `const d = parseRankDelta(...)`），那是正常累加。
            if not _is_param(lines, no - 1, rhs):
                continue
            bad.append((name, no, line.strip()))
    return bad


def main():
    bad = scan()
    if not bad:
        print("✓ 步进参数均已归一（没有裸的 `x += 参数`）")
        return 0
    print("✗ 发现未归一数字的累加（data-act 传进来的是字符串，会拼成 '8-1-1'）：")
    for name, no, line in bad:
        print("  %s:%d  %s" % (name, no, line))
    print("  修法：右侧加 Number(...) —— 例如 `month += Number(delta) || 0;`")
    return 1


if __name__ == "__main__":
    sys.exit(main())
