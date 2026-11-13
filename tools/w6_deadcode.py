#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""· 死代码检测（纯静态，只读不改）

为什么需要独立工具：
    这个项目是 ES5 单文件应用，函数会通过**字符串形式**被引用——内联 onclick
    属性、setTimeout 名字字符串、组件注册表 name 字段——因此"某函数定义后没人调用"
    不等于"死代码"。误报会让人删掉线上功能，比不报更糟。

判定策略（两阶段，先建索引再查，避免 N×M 正则爆炸）：
    Phase 1：把全仓 JS + 模板里**所有标识符出现**扫成一张计数表（单遍正则）。
    Phase 2：对每个顶层定义名，查表并扣掉"定义处自己那一次"。

    命中即存活。只有全表 0 命中的才是死代码。

明确豁免：EXEMPT 集合（框架回调等有意保留的名字）。

输出：可读清单 + 可选 JSON。
用法：
  python3 tools/w6_deadcode.py              # 只打印
  python3 tools/w6_deadcode.py --json       # 结构化
"""
import glob
import json
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
SCRIPTS = os.path.join(_ROOT, "src", "scripts")
TEMPLATE = os.path.join(_ROOT, "src", "template.html")

AS_JSON = "--json" in sys.argv

RE_FUNC = re.compile(r"^\s*function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)
RE_TOP_VAR = re.compile(r"^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=", re.M)

# 一遍扫出所有标识符（含字符串内的名字——本项目的字符串引用传统要求如此）
RE_IDENT = re.compile(r"[A-Za-z_$][\w$]*")

EXEMPT = {
    "hookToast",
    # --- 以下为 人工复核后「有意保留」，非死代码 ---
    # 顶层状态变量：预留但当前无读写（删了会让"下次谁想接"时找不到挂载点）
    "editingRecordId", "immersionClickCount",
    # 定价口径锚点：承载"皮肤走固定价"的产品决策，删了会丢设计意图
    "SKIN_DAYS",
    # 日志分页上限：与 _logPage/_logDaysPerPage 配套，属分页机制的一部分
    "_logLimit",
    # 示例剧本导入：功能入口尚未接线，但实现完整（UI 接上即可用）
    "importSampleImmersiveScript",
    # 模块内部工具：可能经动态名字派发，静态扫描覆盖不到，保守保留
    "_sbClearToday", "stepIdxById",
}


def main():
    files = sorted(glob.glob(os.path.join(SCRIPTS, "*.js")))
    js = {os.path.basename(p): open(p, encoding="utf-8").read() for p in files}
    tmpl = open(TEMPLATE, encoding="utf-8").read() if os.path.exists(TEMPLATE) else ""

    # --- Phase 1：标识符计数表（单遍全量扫描）---
    counts = {}
    for name, text in js.items():
        for m in RE_IDENT.finditer(text):
            w = m.group(0)
            counts[w] = counts.get(w, 0) + 1
    for m in RE_IDENT.finditer(tmpl):
        w = m.group(0)
        counts[w] = counts.get(w, 0) + 1

    # --- 收集顶层定义 ---
    defs = {}
    for name, text in js.items():
        for m in RE_FUNC.finditer(text):
            nm = m.group(1)
            if nm not in defs:
                defs[nm] = (name, "function", text[: m.start()].count("\n") + 1)
        for m in RE_TOP_VAR.finditer(text):
            nm = m.group(1)
            if nm not in defs:
                defs[nm] = (name, "var", text[: m.start()].count("\n") + 1)

    # --- Phase 2：查表，扣掉定义处那一次 ---
    dead = []
    for nm, (f, kind, line) in sorted(defs.items()):
        if nm in EXEMPT:
            continue
        # 该名字在定义文件里至少出现 1 次（就是定义本身）
        n = counts.get(nm, 0)
        if n <= 1:
            dead.append((nm, f, kind, line, n))

    if AS_JSON:
        print(json.dumps({
            "defined": len(defs),
            "dead": [{"name": n, "file": f, "kind": k, "line": l, "hits": h}
                     for n, f, k, l, h in dead],
        }, ensure_ascii=False, indent=2))
        return 0 if not dead else 1

    print(f"顶层定义总数: {len(defs)}")
    print(f"\n【死代码候选】{len(dead)} 个（全仓标识符计数 ≤1，即仅有定义处本身）")
    print("（本项目有 [] 字符串引用与内联 onclick 传统；本工具按'标识符出现'计数，")
    print("  已覆盖字符串/模板/属性赋值，比 AST 调用图更保守——只会少报不会多报。）")
    print()
    for n, f, k, l, h in sorted(dead, key=lambda x: (x[1], x[3])):
        print(f"  {f}:{l}  {k:8s} {n}")

    return 0 if not dead else 1


if __name__ == "__main__":
    sys.exit(main())
