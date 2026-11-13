#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""门禁：产物 CSS 里 calc() 顶层的 + / - 两侧必须有空白。

背景（真实事故，2026-10-25）：
    tools/build.py 的 minify_css() 曾用
        re.sub(r"\\s*([{}:;,>+~])\\s*", r"\\1", t)
    把 `+` 两侧的空白一并删掉，于是
        padding-bottom: calc(80px + env(safe-area-inset-bottom))
    被压成
        padding-bottom: calc(80px+env(safe-area-inset-bottom))
    按 CSS 规范，calc() 内 `+` 与 `-` 的**两侧必须有空白**，否则整个表达式
    判为非法，浏览器把**整条声明丢弃**（不是回退到某个默认值，是当作没写过）。
    结果：.main 的 80px 底部让位空间静默消失，页脚被底部导航栏盖住 54px。

为什么这种 bug 特别值得专门设一道门禁：
    1. 它不报错、不告警，DevTools 的 Styles 面板里那条声明只是显示为删除线，
       但没人会去逐条翻几百条规则；
    2. 它只在**具体数值算错**的地方显形（这里是布局被压塌），
       而布局问题很容易被当成「设计如此」；
    3. 压缩器是构建期代码，改一次影响全站，回归了也没人盯着看。

★ 检查器自身的坑（第一版就是死在这，别再犯）：
    不能对 calc() 内层做裸正则 —— env(safe-area-inset-bottom) 里的
    `safe-area`、var(--fs-boost) 里的 `--fs-boost` 全是连字符，
    一律会被当成减法运算符，75 条全是误报。
    必须按括号深度遍历，**只看 depth==0 的 + 和 -**，
    嵌套括号（env/var/内层 calc）整个跳过。

本脚本支持传文件参数，便于用一段故意写坏的内容验证它真的能抓：
    python3 tools/check_calc_space.py /tmp/bad.css
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"

# 这些字符出现在 +/- 之前时，说明这个 +/- 是**一元正负号**，不是运算符
UNARY_PREV = set("(,*/+-")
# 允许出现在 +/- 之后的字符（数值、变量、括号、小数点）
VALUE_START = set("0123456789.(var-e")


def calc_spans(text):
    """产出 calc(...) 的括号内正文（已去掉最外层 calc 括号）。"""
    for m in re.finditer(r"calc\(", text, re.I):
        i = m.end()
        depth = 1
        while i < len(text) and depth:
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
            i += 1
        if depth:  # 括号不闭合，交给别的检查（这里不报）
            continue
        yield m.start(), text[m.end():i - 1]


def find_bad_operators(inner):
    """只看 depth==0 的 + 和 -，返回违规位置的说明列表。"""
    bad = []
    depth = 0
    for idx, ch in enumerate(inner):
        if ch == "(":
            depth += 1
            continue
        if ch == ")":
            depth -= 1
            continue
        if depth != 0 or ch not in "+-":
            continue

        prev = inner[idx - 1] if idx else ""
        nxt = inner[idx + 1] if idx + 1 < len(inner) else ""

        # 一元正负号：前面跳过空白后是开头或 ( , * / + -
        j = idx - 1
        while j >= 0 and inner[j] == " ":
            j -= 1
        if j < 0 or inner[j] in UNARY_PREV:
            continue

        if prev != " " or nxt != " ":
            bad.append((idx, prev + ch + nxt, inner))
    return bad


def check_file(path):
    text = path.read_text(encoding="utf-8", errors="replace")
    problems = []
    for _pos, inner in calc_spans(text):
        for _i, ctx, _inner in find_bad_operators(inner):
            snippet = inner.strip()
            if len(snippet) > 64:
                snippet = snippet[:61] + "..."
            problems.append((path.name, "calc(" + snippet + ")", ctx))
    return problems


def main(argv):
    targets = [Path(a) for a in argv[1:]]
    if not targets:
        targets = sorted(ASSETS.glob("style*.css"))
        if not targets:
            print("✗ calc 空格: 找不到 public/assets/style*.css（先跑 build.py）")
            return 1

    all_bad = []
    for f in targets:
        if not f.exists():
            print("✗ calc 空格: 文件不存在 %s" % f)
            return 1
        all_bad.extend(check_file(f))

    if all_bad:
        print("✗ calc 空格: %d 处 calc() 顶层运算符缺空白（整条声明会被浏览器丢弃）"
              % len(all_bad))
        for name, snippet, ctx in all_bad[:10]:
            print("    %s  %s" % (name, snippet))
            print("      ↑ 非法相邻字符：%r（+ 和 - 两侧必须有空格）" % ctx)
        if len(all_bad) > 10:
            print("    …… 另有 %d 处" % (len(all_bad) - 10))
        print("\n  通常是 CSS 压缩器把空格删掉了 —— 检查 tools/build.py 的 minify_css()，")
        print("  它的压缩字符类里不能含 + 和 -。")
        return 1

    print("✓ calc 空格: %d 个样式文件，calc() 顶层 + / - 均有正确空白" % len(targets))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
