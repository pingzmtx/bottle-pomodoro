#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""· 文件级 TOC（函数索引）自动生成器。

为什么自动化：
    项目有 28 个源文件、1358 个顶层定义。手写索引必然漂移——今天写了，明天加个
    函数就过期，最终变成一份没人信、还误导人的假文档。所以索引用**生成**而非**手写**，
    与代码同源，可随时重跑对齐。

产出形态（插在文件头注释块内）：
    * 函数索引（TOC）：fn1/fn2/fn3（超过 12 个时截断并标 "+N 更多"）

匹配现有 8 个文件里已经手工写好的同款格式，保持一致。

用法：
    python3 tools/w6_toc.py --check   # 只报告哪些文件缺/过期（CI 用，不写盘）
    python3 tools/w6_toc.py           # 写入/刷新索引行
"""
import glob
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
SCRIPTS = os.path.join(_ROOT, "src", "scripts")

CHECK_ONLY = "--check" in sys.argv

RE_FUNC = re.compile(r"^\s*function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)
RE_TOP_VAR = re.compile(r"^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", re.M)
RE_TOC_LINE = re.compile(r"^\s*\*\s*函数索引（TOC）：.*$", re.M)

MAX_LIST = 12


def collect_defs(text):
    """收集顶层函数名（按出现顺序、去重）。变量不进索引——索引只服务"找函数"。"""
    seen = []
    for m in RE_FUNC.finditer(text):
        nm = m.group(1)
        if nm not in seen:
            seen.append(nm)
    return seen


def build_toc(names):
    if not names:
        return " * 函数索引（TOC）：（本文件无顶层函数，仅常量/IIFE）"
    head = names[:MAX_LIST]
    tail = f"（+{len(names) - MAX_LIST} 更多）" if len(names) > MAX_LIST else ""
    return " * 函数索引（TOC）：" + "/".join(head) + tail


def main():
    files = sorted(glob.glob(os.path.join(SCRIPTS, "*.js")))
    missing, stale, ok = [], [], 0

    for path in files:
        name = os.path.basename(path)
        text = open(path, encoding="utf-8").read()
        want = build_toc(collect_defs(text))
        m = RE_TOC_LINE.search(text)

        if not m:
            missing.append(name)
            if not CHECK_ONLY:
                lines = text.split("\n")
                # 策略：跳过文件开头的**全部连续注释块**（很多文件是「耦合契约块 +
                # 模块说明块」两连），把索引插在**最后一个块**的末尾——即代码真正
                # 开始之前。这样索引跟着模块说明走，不会孤零零飘在最上面。
                insert_at = None
                i = 0
                # 跳过开头空行
                while i < len(lines) and not lines[i].strip():
                    i += 1
                # 逐个块扫描：块以 /* 起、以 */ 止
                last_multiline_end = None   # 最后一个「多行」注释块的结束行索引
                while i < len(lines) and lines[i].strip().startswith("/*"):
                    # 找本块的结束行
                    j = i
                    while j < len(lines) and "*/" not in lines[j]:
                        j += 1
                    if j >= len(lines):
                        break
                    block_end = j
                    # 单行完整注释（`/* ... */` 在同一行）不是"模块说明块"，
                    #    它通常是「===== 某函数 =====」这类小标题，跳过它继续往后找。
                    #   否则会把索引插到这种小标题之后 —— 那已在注释块外，直接语法错误。
                    is_lone = ("/*" in lines[i]) and ("*/" in lines[i]) and (i == j)
                    if not is_lone:
                        last_multiline_end = block_end
                    # 块之后允许有空行
                    k = block_end + 1
                    while k < len(lines) and not lines[k].strip():
                        k += 1
                    if k < len(lines) and lines[k].strip().startswith("/*"):
                        i = k          # 还有下一个注释块，继续
                        continue
                    break
                insert_at = last_multiline_end  # 插到最后一个多行块的 */ 之前

                if insert_at is None:
                    lines[0:0] = ["/*", want, " */"]
                else:
                    # 必须插在结束行**之前**（注释块内部），否则索引会落到 `*/` 之外
                    #   —— 那会变成裸代码，直接 SyntaxError（曾把 01e 弄坏）。
                    #   注意很多文件的结束行是 ` * ===== */`（带内容），不是纯 `*/`，
                    #   所以判断用 "*/" in line 而不是 strip() == "*/"。
                    lines.insert(insert_at, want)
                open(path, "w", encoding="utf-8").write("\n".join(lines))
        elif m.group(0).strip() != want.strip():
            stale.append(name)
            if not CHECK_ONLY:
                text = RE_TOC_LINE.sub(lambda _: want, text, count=1)
                open(path, "w", encoding="utf-8").write(text)
        else:
            ok += 1

    mode = "【检查模式】" if CHECK_ONLY else "【已写入】"
    print(f"{mode} 文件总数 {len(files)}：对齐 {ok}，新增 {len(missing)}，刷新 {len(stale)}")
    for n in missing:
        print(f"  新增: {n}")
    for n in stale:
        print(f"  刷新: {n}")

    if CHECK_ONLY and (missing or stale):
        print("\n提示：跑 `python3 tools/w6_toc.py` 可一键对齐本节。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
