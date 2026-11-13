#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
· window 白名单事实清单生成器 + 同名冲突审计
==================================================
为什么存在这个工具（而不是手写清单）：
  手写白名单会随代码漂移，最终变成一份没人信的假文档。本工具从两处**事实来源**
  自动提取"到底有哪些名字必须挂在 window 上"，生成清单并落盘；lint 再拿它当判决依据。

两处事实来源（缺一不可）：
  A. src/template.html 的内联事件属性（onclick="switchView('stats')" 等）
     → 内联事件在全局作用域求值，因此被引用的函数**必须**是 window 属性。
       本项目有 308 处内联事件，这是白名单的**主要来源**，也是"≤120 不可达"的根本原因。
  B. src/scripts/*.js 里显式的 `window.X = ...` 桥接赋值
     → 跨 <script> 槽被间接调用的名字（如 window.__ivGov / window.switchView）。

用法：
  python3 tools/win_whitelist.py            # 打印汇总 + 审计报告（只读，不改文件）
  python3 tools/win_whitelist.py --write    # 把事实清单写入 src/window_whitelist.json
  python3 tools/win_whitelist.py --json     # 结构化输出，供 lint / AI 解析
退出码：审计有硬错误=1，否则 0。
"""
import os
import re
import sys
import json
import glob
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "src", "scripts")
TPL = os.path.join(ROOT, "src", "template.html")
OUT = os.path.join(ROOT, "src", "window_whitelist.json")

# 内联事件里出现的"非全局引用"——不是自定义函数，误提取需剔除
# （浏览器内置方法 / 语法关键字 / 纯表达式片段）
BUILTIN = {
    "click", "getElementById", "if", "preventDefault", "select", "setTimeout",
    "stopPropagation", "open", "setInterval", "clearInterval", "setTimeout",
    "focus", "blur", "alert", "confirm", "prompt", "parseInt", "parseFloat",
    "String", "Number", "Boolean", "Array", "Object", "JSON", "Math", "Date",
    "encodeURIComponent", "decodeURIComponent", "isNaN", "typeof",
    # 内联属性里常见的"语法关键字 / 立即执行函数写法"，不是要查找的自定义函数
    "function", "return", "new", "delete", "void", "await", "event", "this",
    "Promise", "Error", "Set", "Map", "RegExp", "Symbol", "BigInt",
    "window", "document", "console", "localStorage", "sessionStorage",
}

# 内联事件属性名（含 on 前缀的事件）
# 脚本里是 JS 字符串，引号可能被转义（\" / \'），所以单独一套正则
SCRIPT_EVENT_ATTR = re.compile(
    r"\bon(?:click|change|input|submit|blur|focus|load|error|scroll|"
    r"mouse[a-z]+|touch[a-z]+|key[a-z]+|drag[a-z]*|drop|pointer[a-z]*|"
    r"animation[a-z]+|transition[a-z]+|wheel|contextmenu|dblclick|resize)\s*=\s*\\?[\"']([^\"'\n]{0,160})",
    re.I,
)

EVENT_ATTR = re.compile(
    r"\bon(?:click|change|input|submit|blur|focus|load|error|scroll|"
    r"mouse[a-z]+|touch[a-z]+|key[a-z]+|drag[a-z]*|drop|pointer[a-z]*|"
    r"animation[a-z]+|transition[a-z]+|wheel|contextmenu|dblclick|resize)\s*=\s*\"([^\"]*)\"",
    re.I,
)


def strip_comments(s):
    """剥块注释与整行注释（保留字符串内的 https:// 等）"""
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return "\n".join(l for l in s.splitlines() if not l.lstrip().startswith("//"))


def collect_top_defs():
    """只收「真顶层」声明，用于同名冲突判定。

    与 collect_defs 的区别：本函数**不收**缩进的嵌套函数声明。
    原因：同名冲突关心的是"哪个顶层定义会被后一个覆盖"，
    嵌套函数各自在自己的函数作用域里，不构成全局冲突。
    """
    top = defaultdict(set)
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        base = os.path.basename(f)
        s = strip_comments(open(f, encoding="utf-8").read())
        for n in re.findall(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", s, re.M):
            top[n].add(base)
        for n in re.findall(r"^([A-Za-z_$][\w$]*)\s*=\s*function\b", s, re.M):
            top[n].add(base)
        for n in re.findall(r"^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=", s, re.M):
            top[n].add(base)
    return top


def collect_defs():
    """返回 {名字: [定义所在文件...]}，**仅顶层**声明。

    关键：必须区分顶层与函数内局部。
      - function 声明：用「行首零缩进 + function」判定顶层（局部函数声明必带缩进）。
      - let/const/var：同上，行首零缩进才算顶层变量。
    否则 `const a = ...` 这类函数内局部会被误判成"同名冲突"，
    历史实测误报高达 435 项（a/W/_e/active …），会让 lint 沦为噪音。
    """
    defs = defaultdict(set)
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        base = os.path.basename(f)
        s = strip_comments(open(f, encoding="utf-8").read())
        # 顶层 function 声明：行首（无缩进）function
        for n in re.findall(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", s, re.M):
            defs[n].add(base)
        # 顶层函数表达式赋值：行首 name = function
        for n in re.findall(r"^([A-Za-z_$][\w$]*)\s*=\s*function\b", s, re.M):
            defs[n].add(base)
        # 顶层 let/const/var：行首声明
        for n in re.findall(r"^(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*=", s, re.M):
            defs[n].add(base)
        # 嵌套函数声明（含缩进）——专供"悬空引用"判定：只要能找到定义即可，不参与同名冲突
        for n in re.findall(r"^\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", s, re.M):
            defs.setdefault(n, set()).add(base)
    return defs


def collect_inline_refs():
    """从 template.html 内联事件里提取被引用的全局名"""
    tpl = open(TPL, encoding="utf-8").read()
    names = set()
    for expr in EVENT_ATTR.findall(tpl):
        for m in re.finditer(r"([A-Za-z_$][\w$]*)\s*\(", expr):
            n = m.group(1)
            if n not in BUILTIN:
                names.add(n)
    return names


def collect_inline_refs_from_scripts():
    """从 src/scripts/*.js **生成的 HTML 字符串**里提取内联事件引用的全局名。

    为什么必须单独扫：内联事件在**全局作用域**求值，跟它是写在 template.html 里、
    还是写在 JS 字符串里完全无关。只扫 template.html 会漏掉一整类真 bug
    ——「JS 拼出来的按钮 → 点了 ReferenceError」
    （实例：计划页「修改每日目标」的 toggleGoalEdit 没桥接到 window，点了必挂）。

    取到属性值后按 JS 字符串边界截断（' / " / \\' / \\"），否则会把拼串时的构建期
    调用（如 `+ _esc(id) +`）误当成内联引用。
    """
    names = {}
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        base = os.path.basename(f)
        s = strip_comments(open(f, encoding="utf-8").read())
        for raw in SCRIPT_EVENT_ATTR.findall(s):
            expr = re.split(r"""['"]|\\['"]""", raw)[0]
            for m in re.finditer(r"(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(", expr):
                n = m.group(1)
                if n not in BUILTIN:
                    names.setdefault(n, base)
    return names


def collect_window_bridges():
    """从 src/scripts 里提取显式 window.X = 的桥接名"""
    names = set()
    for f in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        s = strip_comments(open(f, encoding="utf-8").read())
        for m in re.finditer(r"\bwindow\.([A-Za-z_$][\w$]*)\s*=", s):
            names.add(m.group(1))
    return names


def build_report():
    defs = collect_defs()
    inline = collect_inline_refs()
    inline_js = collect_inline_refs_from_scripts()
    bridges = collect_window_bridges()
    union = sorted(inline | bridges)

    # ---- 审计 1：同名冲突（同一顶层名在多个文件重复定义）----
    # 注意：只用零缩进的"真顶层"判定，避免把函数内局部变量误报成冲突
    top = collect_top_defs()
    dup = {n: sorted(v) for n, v in top.items() if len(v) > 1}

    # ---- 审计 2：白名单里的名字是否真的有定义（防悬空引用）----
    # 注意：跨槽 `window.X = function(){}` 由**对方文件运行时**挂载，静态不可证伪，
    # 故仅作告警而非硬错误（误判会让人无视 lint）。
    dangling = sorted(n for n in union if n not in defs and not n.startswith("__"))

    # ---- 审计 3：JS 生成的内联事件 → 全局可达性（硬错误）----
    # 内联事件一律在**全局作用域**求值，所以被调用的名字只有两条活路：
    #   (a) window.X = … 显式桥接   (b) 零缩进顶层函数声明（拼接后即全局函数）
    # 两条都不满足 = 点击必抛 ReferenceError（真例：toggleGoalEdit）。
    # 零缩进判定与审计 1 同源：本仓库的自包裹槽会把 IIFE 内的函数缩进 2 格，
    # 因此"缩进 ≠ 0"精确等价于"运行时不在全局"。
    unreachable = sorted(
        n for n in inline_js if n not in bridges and n not in top
    )
    unreachable_files = {n: inline_js[n] for n in unreachable}

    return {
        "total_defs": len(top),
        "inline_count": len(inline),
        "inline_js_count": len(inline_js),
        "bridge_count": len(bridges),
        "union": union,
        "union_count": len(union),
        "overlap": sorted(inline & bridges),
        "dup_conflicts": dup,
        "dangling": dangling,
        "unreachable_inline": unreachable_files,
    }


def audit():
    """供 lint 调用的审计入口：返回 (errors, warnings)"""
    r = build_report()
    errors, warnings = [], []

    # 同名冲突 = 硬错误：同名函数被后定义者覆盖，是历史"updateTitle×2 / 热力图×2"的复发风险
    for n, files in sorted(r["dup_conflicts"].items()):
        errors.append(f"同名顶层定义冲突: {n} → {', '.join(files)}")

    # 悬空引用 = 告警（非硬错误，见 build_report 注释）
    for n in r["dangling"]:
        warnings.append(f"白名单引用无静态定义: {n}（可能由跨槽运行时挂载，请人工确认）")

    # JS 生成的内联事件引用全局不可达的名字 = 硬错误
    # （点了必 ReferenceError，静态可证伪，所以不给"人工确认"的缓冲）
    for n, f in sorted(r["unreachable_inline"].items()):
        errors.append(
            f"内联事件引用全局不可达的名字: {n}() ← 来自 {f} 生成的 onclick；"
            f"内联事件在全局作用域求值，需 `window.{n} = {n};` 桥接或改零缩进顶层声明"
        )

    # 白名单规模告警（不阻断）：仅提示是否超出登记口径
    reg = load_registered()
    if reg is not None:
        cur, base = r["union_count"], reg.get("union_count", 0)
        if base and cur > base:
            added = sorted(set(r["union"]) - set(reg.get("union", [])))
            warnings.append(
                f"窗口暴露新增 {cur - base} 个（{base}→{cur}）：{', '.join(added[:12])}"
                + (" …" if len(added) > 12 else "")
            )
    return errors, warnings, r


def load_registered():
    if not os.path.exists(OUT):
        return None
    try:
        return json.load(open(OUT, encoding="utf-8"))
    except Exception:
        return None


def main():
    write = "--write" in sys.argv
    as_json = "--json" in sys.argv
    errors, warnings, r = audit()

    if write:
        data = {
            "_note": "自动生成的事实白名单 · 由 tools/win_whitelist.py --write 产出，勿手改",
            "union_count": r["union_count"],
            "inline_count": r["inline_count"],
            "bridge_count": r["bridge_count"],
            "union": r["union"],
        }
        json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        if not as_json:
            print(f"✓ 已写入 {os.path.relpath(OUT, ROOT)}（{r['union_count']} 项）")

    if as_json:
        print(json.dumps({"result": r, "errors": errors, "warnings": warnings},
                         ensure_ascii=False, indent=2))
        return 1 if errors else 0

    print("=" * 56)
    print("· window 白名单事实清单")
    print("=" * 56)
    print(f"顶层定义总数        : {r['total_defs']}")
    print(f"内联事件引用        : {r['inline_count']}")
    print(f"↳ 其中来自JS字符串  : {r['inline_js_count']}（生成式按钮，易漏桥接）")
    print(f"脚本内 window 桥接  : {r['bridge_count']}")
    print(f"↳ 两者重叠          : {len(r['overlap'])}")
    print(f"窗口暴露并集        : {r['union_count']}")
    print()
    if errors:
        print(f"✗ 硬错误 {len(errors)} 项：")
        for e in errors:
            print("   -", e)
    else:
        print("✓ 审计通过：无同名冲突 / 无悬空引用 / 内联事件全部全局可达")
    if warnings:
        print(f"\n⚠ 告警 {len(warnings)} 项：")
        for w in warnings:
            print("   -", w)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
