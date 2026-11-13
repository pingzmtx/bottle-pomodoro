#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
⚠️ 本文件已由 tools/callgraph_ast.js 取代（正则 → AST），保留供对照。
------------------------------------------------------------
替代原因（本文件头注释自己就承认了其中一半）：
  1. 它只统计「顶层 function 的跨文件调用」，数据耦合（appData 全局共享）
     明确写着"无法用文本统计"——AST 版把 appData 读写做成了 state 边。
  2. 正则 `名字(` 找不到归属：`window.__silent()` / `window.__errRep.push()` 这类
     间接调用，正则只能看到字面量，不知道它属于哪个模块——AST 版有 globalOwner 表。
  3. 重名顶层函数（本项目 14 组，如 esc 定义在 02/06/0C 三处）在 owner 表里
     被 setdefault 静默丢弃，只剩第一个——AST 版保留全部并显式列冲突。
  4. 注释/字符串里的函数名、与顶层函数同名的局部变量（如 01e8 的 const pick）
     在正则下必然误报——AST 版做作用域解析。
  5. DOM id 契约（getElementById('x') ↔ id="x"）完全扫不到——AST 版是第三类边。

新工具用法：
    node tools/callgraph_ast.js              # 生成 tools/callgraph.json + 报告
    node tools/callgraph_ast.js --impact <fn> # 反查影响面
    node tools/callgraph_ast.js --module <文件>
    node tools/callgraph_ast.js --selfcheck   # 自检

保留本文件的价值：迁移期的**对照基线**——同一个问题上两个工具结论不一致的地方，
就是"正则 vs AST"的真实差距（见 docs 里的对照记录）。
"""
import re
import sys
import glob
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "src", "scripts")


def load_defs():
    """file -> set(顶层函数名)（已剔除注释，避免注释文本污染统计）"""
    defs = {}
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        s = open(f, encoding="utf-8").read()
        s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)  # 剥块注释
        s = "\n".join(
            ln for ln in s.splitlines() if not ln.lstrip().startswith("//")
        )  # 剥整行注释（保留字符串内的 https:// 等）
        names = set(re.findall(r"function\s+([A-Za-z_$][\w$]*)\s*\(", s))
        names |= set(re.findall(r"^\s*([A-Za-z_$][\w$]*)\s*=\s*function\b", s, re.M))
        defs[os.path.basename(f)] = names
    return defs


def _clean_src(f):
    s = open(os.path.join(SCRIPTS, f), encoding="utf-8").read()
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = "\n".join(ln for ln in s.splitlines() if not ln.lstrip().startswith("//"))
    return s


def build_graph(defs):
    """file -> [(被调用的定义文件, 次数)]；同时返回被依赖计数与依赖计数"""
    edges = {}  # 调用方 -> [(被调用方文件, 次数)]
    total = 0
    for f in sorted(defs):
        s = _clean_src(f)
        for g in sorted(defs):
            if g == f:
                continue
            cnt = 0
            for n in defs[g]:
                cnt += len(re.findall(r"\b" + re.escape(n) + r"\s*\(", s))
            if cnt:
                edges.setdefault(f, []).append((g, cnt))
                total += cnt
    return edges, total


def _extract_body(src, fn_name):
    """提取 function fnName(...) { ... } 的函数体（粗略括号配对，仅供影响面分析）"""
    m = re.search(r"\bfunction\s+" + re.escape(fn_name) + r"\s*\([^)]*\)\s*\{", src)
    if not m:
        return ""
    start = m.start()
    i = m.end() - 1  # 指向 '{'
    depth = 0
    while i < len(src):
        ch = src[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return src[start : i + 1]
        i += 1
    return src[start:]  # 未闭合（理论不发生），退化为取到文件尾


def impact(fn_name):
    """--impact：输出函数定义文件、被调用点、函数体内调用的高信号顶层函数（预测 UI 副作用）"""
    defs = load_defs()
    where = [f for f, ns in defs.items() if fn_name in ns]
    print(f"目标函数: {fn_name}")
    print(f"定义在  : {where if where else '⚠️ 未找到顶层定义'}")

    # 1) 被谁调用（跨文件 + 同文件都列）
    callers = []
    for f in sorted(defs):
        s = _clean_src(f)
        for m in re.finditer(r"\b" + re.escape(fn_name) + r"\s*\(", s):
            line = s[: m.start()].count("\n") + 1
            callers.append((f, line))
    if callers:
        print(f"被调用点: {len(callers)} 处")
        for f, ln in callers:
            print(f"  - {f}:{ln}")
    else:
        print("被调用点: 0 处（⚠️ 可能死代码，或仅被动态包装引用）")

    # 2) 函数体内调用了哪些"高信号"顶层函数（渲染/保存/统计 → 预计影响的 UI）
    if where:
        src = _clean_src(where[0])
        body = _extract_body(src, fn_name)
        if body:
            known = sorted(defs[where[0]])  # 该文件内全部顶层函数为候选
            # 也纳入其它文件的顶层函数（跨文件影响）
            all_fns = {}
            for f, ns in defs.items():
                for n in ns:
                    all_fns.setdefault(n, []).append(f)
            hits = []
            for n in sorted(all_fns):
                if n == fn_name:
                    continue
                if re.search(r"\b" + re.escape(n) + r"\s*\(", body):
                    hits.append((n, all_fns[n]))
            hot = [n for n, fl in hits if re.match(r"(render|update|save|refresh|build|calc|show|sync)\w*|saveData|exportData", n)]
            if hot:
                print(f"函数内调用的高信号顶层函数（预计副作用 / 需回归）: {len(hot)} 个")
                for n in hot:
                    print(f"  - {n}  {all_fns[n]}")
            if hits:
                other = [n for n, fl in hits if n not in hot]
                print(f"函数内调用的其它顶层函数: {len(other)} 个（同上可查）")
                for n in other[:20]:
                    print(f"  - {n}")
    return 0


def fn_map(module_kw=None):
    """--map [模块关键词]：列出各文件顶层函数（名 + 起始行），可按文件名关键词过滤"""
    out = []
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        base = os.path.basename(f)
        if module_kw and module_kw.lower() not in base.lower():
            continue
        s = open(f, encoding="utf-8").read()
        s2 = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
        lines = s2.splitlines()
        funcs = []
        for i, ln in enumerate(lines, 1):
            if ln.lstrip().startswith("//"):
                continue
            m = re.search(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(", ln)
            if m:
                funcs.append((m.group(1), i))
        out.append((base, funcs))
    return out


def main():
    # ===== --map [模块关键词]：函数定位地图（自动生成，永不漂移） =====
    if "--map" in sys.argv:
        i = sys.argv.index("--map")
        kw = sys.argv[i + 1] if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--") else None
        total = 0
        for base, funcs in fn_map(kw):
            print(f"\n### {base}  （{len(funcs)} 个顶层函数）")
            for name, ln in funcs:
                print(f"  {ln:>6}  {name}")
            total += len(funcs)
        print(f"\n合计 {total} 个顶层函数")
        return 0
    # ===== Wave 6.5：--impact <函数名> 改动影响面反查 =====
    # 让 AI/维护者改某个函数前，先知道：定义在哪、被谁调用、函数内会触发哪些渲染/副作用。
    if "--impact" in sys.argv:
        i = sys.argv.index("--impact")
        if i + 1 >= len(sys.argv):
            print("用法: python3 tools/dep_report.py --impact <函数名>")
            return 2
        return impact(sys.argv[i + 1])

    write_md = "--md" in sys.argv
    defs = load_defs()
    edges, total = build_graph(defs)
    refcnt = Counter()   # 被引用
    for f, lst in edges.items():
        for g, c in lst:
            refcnt[g] += c
    depcnt = Counter({f: sum(c for _, c in lst) for f, lst in edges.items()})
    funcs = sum(len(v) for v in defs.values())
    lines = []
    lines.append("# 模块依赖耦合报告（自动生成快照）")
    lines.append("")
    lines.append(f"- 生成时间：见 git/文件时间；源文件数 **{len(defs)}**；顶层函数数 **{funcs}**；")
    lines.append(f"- 跨文件直接调用总次数 **{total}**（结构耦合近似画像；数据耦合需人工 Review）。")
    lines.append("")
    lines.append("## 被依赖 Top10（被别的模块调用最多 = 公共 API 最重）")
    lines.append("")
    lines.append("| 文件 | 被引用次数 |")
    lines.append("|---|---|")
    for g, c in refcnt.most_common(10):
        lines.append(f"| {g} | {c} |")
    lines.append("")
    lines.append("## 依赖他人 Top10（引用别的模块最多 = 对该模块最敏感）")
    lines.append("")
    lines.append("| 文件 | 引用次数 |")
    lines.append("|---|---|")
    for f, c in depcnt.most_common(10):
        lines.append(f"| {f} | {c} |")
    lines.append("")
    lines.append("> 用法：改结构前跑 `python3 tools/dep_report.py` 看基线；改完再跑对比，")
    lines.append("> 若「被依赖 Top」或总调用边数大幅上升，说明新代码又把耦合堆到全局函数上了。")
    lines.append("")
    report = "\n".join(lines)
    print("源文件数:", len(defs), "| 顶层函数数:", funcs, "| 跨文件调用总次数:", total)
    print("\n被依赖 Top8:")
    for g, c in refcnt.most_common(8):
        print(f"  {g:32} {c}")
    print("依赖他人 Top8:")
    for f, c in depcnt.most_common(8):
        print(f"  {f:32} {c}")
    if write_md:
        # 原快照文档 docs/current/模块依赖报告.md 已清理（避免长期漂移的过时快照）。
        # --md 改为按需输出到项目根，看过即弃，不进版本库。
        dst = os.path.join(ROOT, "模块依赖报告.generated.md")
        with open(dst, "w", encoding="utf-8") as fh:
            fh.write(report)
        print("已生成 模块依赖报告.generated.md（按需查看，勿入库）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
