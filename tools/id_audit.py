#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""id 对账审计：JS 引用的纯字面量 id 是否能在模板/已注册动态 id 中找到。
用法: python3 tools/id_audit.py        # 只输出缺失清单（可读 + 退出码 0/1）
      python3 tools/id_audit.py --json # AI 结构化解析

规则:
  - 纯字面量: getElementById('timerTime') / getElementById("todoList")
  - 动态引用(排除): 参数含 ${} / 字符串拼接 + / 变量名(非引号字面量)
  - 模板静态 id 来源: src/template.html 的 id="xxx"（含 JS 内联拼接出静态 id 的部分交给人工复核）"""
import re, sys, os, json, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "src", "template.html")
SCRIPTS = os.path.join(ROOT, "src", "scripts")


def load_static_ids():
    s = open(TPL, encoding="utf-8").read()
    return set(re.findall(r'\bid="([A-Za-z_][\w-]*)"', s))


def scan():
    static = load_static_ids()
    dynamic = set()
    # 收集 JS 中"动态创建 id"的字面量：.id='xxx' / id='xxx'（字符串模板内）/ setAttribute
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        s = open(f, encoding="utf-8").read()
        dynamic |= {x[1] for x in re.findall(r"\.id\s*=\s*(['\"])([A-Za-z_][\w-]*)\1", s)}
        dynamic |= {x[1] for x in re.findall(r"\bid\s*=\s*(['\"])([A-Za-z_][\w-]*)\1", s)}
        dynamic |= {x[1] for x in re.findall(r"setAttribute\(\s*['\"]id['\"]\s*,\s*(['\"])([A-Za-z_][\w-]*)\1\s*\)", s)}
    known = static | dynamic
    missing = []
    refs = []
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        base = os.path.basename(f)
        s = open(f, encoding="utf-8").read()
        s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
        s = "\n".join(ln for ln in s.splitlines() if not ln.lstrip().startswith("//"))
        for m in re.finditer(r"getElementById\(\s*(['\"])([A-Za-z_][\w-]*)\1\s*\)", s):
            refs.append((base, m.group(2)))
    seen = {}
    for base, rid in refs:
        if rid not in known:
            seen.setdefault(rid, []).append(base)
    return seen, len(refs), len(static), len(dynamic)


def main():
    seen, total, nstatic, ndyn = scan()
    jsonout = "--json" in sys.argv
    if jsonout:
        print(json.dumps({"total_refs": total, "static_ids": nstatic, "dynamic_ids": ndyn, "missing": seen}, ensure_ascii=False))
    else:
        print(f"静态引用 {total} ｜模板静态 id {nstatic} ｜JS 动态创建 id {ndyn} ｜真正缺失: {len(seen)}")
        for rid, files in sorted(seen.items()):
            print(f"  ✗ #{rid}  <- {', '.join(sorted(set(files)))}")
        if not seen:
            print("✅ 所有 getElementById 字面量均有出处（模板或动态创建）")
    return 0 if not seen else 1


if __name__ == "__main__":
    sys.exit(main())
