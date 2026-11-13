#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""w6_color.py —— 颜色审计（报告工具，不做机械替换）

为什么必须有这一段
------------------
字号 / 圆角 / 间距三轮能机械收口，是因为「同一意图被写成了不同数」。
颜色不同：本项目的 651 种字面量里，绝大多数是**正经的一次性色**
（奖章金、段位色、渐变）或**根本还没有对应变量**的色 —— 是「缺词汇」，不是「写错」。

实测证据：按 RGB 色差找「最近的已有变量」，ΔE 相近的两组性质相反：
    #eee    → --bg #f5f0e8   ΔE=9.4   灰 vs 米白，**不同色系**（并过去页面会变米色）
    #1a2440 → --ink-strong #1a2438 ΔE=8.0  同一个深蓝，**纯漂移**
任何按数值执行的脚本都区分不了这两者 → **所以颜色不做批量替换**，
由本工具把「哪些是纯漂移 / 哪些与变量同值」列出来，交给人做语义判断。

本工具只报告，不修改任何文件（没有 --apply，故意的）。
用法:
    python3 tools/w6_color.py            # 人类可读报告
    python3 tools/w6_color.py --json     # 结构化输出
"""
import os, re, sys, json, glob
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def norm(c):
    """颜色规范化：小写、去空格、#abc → #aabbcc"""
    c = c.lower().replace(" ", "")
    m = re.fullmatch(r"#([0-9a-f]{3})", c)
    if m:
        return "#" + "".join(ch * 2 for ch in m.group(1))
    return c


def parse_rgb(c):
    c = norm(c)
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 6:
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    m = re.fullmatch(r"rgba?\(([\d.]+),([\d.]+),([\d.]+)[^)]*\)", c)
    if m:
        return tuple(int(float(m.group(i))) for i in (1, 2, 3))
    return None


def collect():
    """返回 (变量定义 dict, 字面量 Counter)。变量只认 :root 与 dark-mode 覆盖。"""
    tpl = open(os.path.join(ROOT, "src", "template.html"), encoding="utf-8").read()
    root_m = re.search(r":root\s*\{(.*?)\n\}", tpl, re.S)
    root = root_m.group(1) if root_m else ""
    vars_ = {}
    for m in re.finditer(r"(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*;", root):
        vars_.setdefault(norm(m.group(2)), []).append(m.group(1))
    lits = Counter()
    loc = {}
    files = [os.path.join(ROOT, "src", "template.html")] + \
            sorted(glob.glob(os.path.join(ROOT, "src", "scripts", "*.js")))
    for f in files:
        s = open(f, encoding="utf-8").read()
        for m in re.finditer(r"#[0-9a-fA-F]{3,8}\b|rgba?\([0-9.,\s%]+\)", s):
            k = norm(m.group(0))
            lits[k] += 1
            loc.setdefault(k, []).append((os.path.relpath(f, ROOT),
                                          s[:m.start()].count("\n") + 1))
    return vars_, lits, loc


def audit():
    vars_, lits, loc = collect()
    exact = []      # 与已有变量精确同值（可无损转变量，但变量名是否语义合适需人判断）
    for v, c in lits.most_common():
        if v in vars_:
            exact.append({"color": v, "count": c, "vars": vars_[v]})
    # 字面量之间的近似对（纯漂移嫌疑）：只比不透明色 —— 带透明度的值没法与实色比较
    keys = [k for k in lits if parse_rgb(k) and not k.startswith("rgba")]
    near = []
    for i in range(len(keys)):
        ri = parse_rgb(keys[i])
        for j in range(i + 1, len(keys)):
            rj = parse_rgb(keys[j])
            d = max(abs(ri[t] - rj[t]) for t in range(3))
            if 0 < d <= 6:
                near.append({"a": keys[i], "b": keys[j], "maxchan": d,
                             "ca": lits[keys[i]], "cb": lits[keys[j]]})
    near.sort(key=lambda x: (x["maxchan"], -(x["ca"] + x["cb"])))
    return {
        "var_count": sum(len(v) for v in vars_.values()),
        "var_shades": len(vars_),
        "literal_shades": len(lits),
        "literal_occurrences": sum(lits.values()),
        "exact_matches": exact,
        "exact_total": sum(e["count"] for e in exact),
        "near_pairs": near,
        "near_total": sum(n["ca"] + n["cb"] for n in near),
    }


def main():
    r = audit()
    if "--json" in sys.argv:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0
    print("颜色审计（只报告，不修改）")
    print("=" * 52)
    print("变量 %d 个 / %d 种色值   ｜   字面量 %d 种 / %d 处"
          % (r["var_count"], r["var_shades"], r["literal_shades"], r["literal_occurrences"]))
    print()
    print("① 与已有变量【精确同值】的字面量 %d 处（可无损转变量）" % r["exact_total"])
    print("   注意：变量名是否语义合适仍需人判断（例如 #fff 可能是 --card/--on-primary）")
    for e in r["exact_matches"][:10]:
        print("   %-10s x%-4d → %s" % (e["color"], e["count"], " / ".join(e["vars"][:3])))
    print()
    print("② 字面量之间的【近似对】%d 组（纯漂移嫌疑，须人眼确认）" % len(r["near_pairs"]))
    print("   色差一样大的，性质可能相反 —— 灰/米白是不同色系，#1a2440/#1a2438 才是笔误")
    for n in r["near_pairs"][:10]:
        print("   %-10s(%dx) vs %-10s(%dx)  最大通道差=%d"
              % (n["a"], n["ca"], n["b"], n["cb"], n["maxchan"]))
    print()
    print("结论：颜色不做批量替换（理由见本文件头部）。要动请按域逐个确认。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
