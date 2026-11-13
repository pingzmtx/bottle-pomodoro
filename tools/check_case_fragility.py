#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用例「脆弱度」门禁 —— 断言只许量性质，不许抄实现的现值。

━━━ 为什么要有这一段（2026-10-19，需求当面问的）━━━
需求原话：
  「你每次改一个东西，这些断言都会失败。我感觉这是不合理的。
    那以后还有那么多，那以后每次这断言都有问题，你都要一个一个修吗？」

这个抱怨是对的，而且病根不在"改得太多"，在**断言的写法**。

一条断言红了，只可能是四类原因之一：

  ① 契约红   —— 要求没变、行为坏了          → **这红得对，是真 bug**，改代码。
  ② 实现钉红 —— 要求没变、实现换了（改公式/换色板/换结构）
                断言里写着旧实现的现值         → **断言写错了**，它不该知道实现长什么样。
  ③ 环境红   —— 视口宽 320/390、真实存档里有历史脏数据、折叠状态…
                断言把"某台设备/某份数据"当成常量 → **断言写错了**，要写基线差或固定视口。
  ④ 规范红   —— 产品口径真的变了（如"子任务番茄不再计入"）→ 该改，但一次改一处。

只有 ② 会"每次改都红一大片"。而 ② 是可以机器判定的：
**断言里出现实现产出的具体值（#A8A6AE / 4px / 某个主题清单）就是 ② 的种子。**

━━━ 所以本工具的规则 ━━━
R1 不许在用例里自造测量函数（rgba/lum/contrast/hue…）→ 用 `_contract.js` 的 `TC.*`
   （2026-10-18 真实事故：C81 自己写的 rgba() 不认 `color(srgb …)`，换配色后
     12 组对比度全变 NaN，一次假红排查了半小时。同一个解析器写 5 份 = 修 5 次。）
R2 不许拿颜色/像素字面量做等值断言（`x === '#A8A6AE'`、`h === '24px'`）
   → 改断言为**关系式**：`TC.contrast(块, 纸) >= TC.TH.BLOCK_MIN`。
     配色改了，关系不变，断言就不该红。
R3 不许在用例里抄一份主题清单（同时出现 nord/gruvbox/catppuccin 基本就是在抄）
   → 用 `TC.THEMES`；加第 7 个主题只改 _contract.js 一处。
R4 不许手搓取色（用了 getComputedStyle 却整个文件没碰 TC）
   → 说明它在自己解析 CSS 颜色，等于新一轮 ② 的种子。

━━━ 棘轮 ━━━
存量（历史用例）冻结成基线 `tools/case_fragility_baseline.json`，
**只许降不许升**：新写一条违反上述规则的断言 → 立刻 FAIL。
  首次/迁移后更新：  python3 tools/check_case_fragility.py --write
  看当前清单：      python3 tools/check_case_fragility.py --list

★ 这条门禁保护的不是"代码"，是**下一轮修改的成本**：
  断言只写性质，改实现就不用碰断言；改要求才碰断言，而且只碰一处。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(ROOT, "tools", "tests")
BASELINE = os.path.join(ROOT, "tools", "case_fragility_baseline.json")
SELF = "_contract.js"

# R1 自造测量函数：这些都是 _contract.js 已提供的原语，用例里不该再出现定义
R1 = re.compile(
    r"function\s+(?:rgba|toRgb|hex2rgb|flatten|lum|ratio|contrast|elRatio|hue|hueDiff|alphaOf|parseColor)\s*\("
)
# R2 颜色/像素字面量做等值比较（允许出现在文案字符串里解释"旧值长什么样"，
#    只禁止它出现在比较号右边 —— 那里就是"把实现现值当期望值"）
R2 = re.compile(
    r"[=!]==?\s*(['\"])(?:#[0-9a-fA-F]{3,8}|rgba?\([^'\"]*|\d+(?:\.\d+)?px)\1"
)
# R3 本地抄一份主题清单
R3 = re.compile(r"nord")
R3_NEED = ("gruvbox", "catppuccin")
# R4 手搓取色
R4 = re.compile(r"getComputedStyle\s*\(")


def strip_comments(src):
    """去掉注释再做匹配：注释里写 #A8A6AE 是在解释历史，不是断言。"""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
    src = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    return src


def scan():
    """返回 [{'file','rule','line','text'}]，按文件+行排序。"""
    hits = []
    if not os.path.isdir(TESTS):
        return hits
    for name in sorted(os.listdir(TESTS)):
        if not name.endswith(".js") or name == SELF:
            continue
        path = os.path.join(TESTS, name)
        with open(path, encoding="utf-8") as f:
            raw = f.read()
        src = strip_comments(raw)
        lines = src.split("\n")

        def add(rule, i, why):
            hits.append({"file": name, "rule": rule, "line": i + 1,
                         "text": lines[i].strip()[:110], "why": why})

        for i, ln in enumerate(lines):
            if R1.search(ln):
                add("R1", i, "自造测量函数 → 用 TC.*")
            if R2.search(ln):
                add("R2", i, "颜色/像素字面量当期望值 → 改写成关系式")
        if R3.search(src) and all(k in src for k in R3_NEED):
            # 指向真正抄清单的那一行
            for i, ln in enumerate(lines):
                if "nord" in ln:
                    add("R3", i, "本地抄了主题清单 → 用 TC.THEMES")
                    break
        if R4.search(src) and "TC." not in src:
            for i, ln in enumerate(lines):
                if R4.search(ln):
                    add("R4", i, "手搓取色却没用 TC → 用 TC.css()/TC.parse()")
                    break
    return hits


def summarize(hits):
    by_rule = {}
    files = {}
    for h in hits:
        by_rule[h["rule"]] = by_rule.get(h["rule"], 0) + 1
        files[h["file"]] = files.get(h["file"], 0) + 1
    return {"total": len(hits), "by_rule": by_rule, "files": files}


def main():
    hits = scan()
    summary = summarize(hits)

    if "--list" in sys.argv:
        if not hits:
            print("✓ 用例里没有脆弱写法（R1~R4 全空）")
            return 0
        print("当前清单（file:line  rule  说明）")
        for h in hits:
            print("  %-38s:%-5d %s  %s\n      %s" % (h["file"], h["line"], h["rule"], h["why"], h["text"]))
        print("\n合计 %d 处：%s" % (summary["total"],
                                 "、".join("%s=%d" % kv for kv in sorted(summary["by_rule"].items()))))
        return 0

    if "--write" in sys.argv:
        with open(BASELINE, "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2, sort_keys=True)
            f.write("\n")
        print("✓ 已写入基线 %s：%d 处（%s）" % (
            os.path.relpath(BASELINE, ROOT), summary["total"],
            "、".join("%s=%d" % kv for kv in sorted(summary["by_rule"].items())) or "空"))
        return 0

    base = {"total": 0, "by_rule": {}, "files": {}}
    if os.path.exists(BASELINE):
        with open(BASELINE, encoding="utf-8") as f:
            base = json.load(f)
    golden = int(base.get("total", 0))
    now = summary["total"]

    if now > golden:
        old_files = base.get("files") or {}
        # 只报"新增"的那几处，别把历史旧账全倒出来（那正是刷屏、让人不想修的原因）
        fresh = [h for h in hits if h["file"] not in old_files]
        for h in hits:
            if h["file"] in old_files and summary["files"].get(h["file"], 0) > old_files[h["file"]]:
                fresh.append(h)
        print("✗ FAIL：用例脆弱度上升 %d → %d（基线 %d）" % (golden, now, golden))
        print("  新写的断言里混进了「抄实现现值」的写法：\n")
        show = fresh or hits
        for h in show:
            print("  %-38s:%-5d %s  %s\n      %s" % (h["file"], h["line"], h["rule"], h["why"], h["text"]))
        print("\n  怎么改：")
        print("    · 量配色 → 断言关系（TC.contrast(a, b) >= TC.TH.AA），别断言具体色值")
        print("    · 量布局 → 断言顺序/包含关系，别断言 12px 这种现值")
        print("    · 量主题 → 遍历 TC.THEMES，别在用例里再抄一份主题名")
        print("    · 真要改要求 → 改 _contract.js 里的 TC.TH 一处，不是逐条改断言")
        print("  确实需要放宽基线（极少见，须在提交说明里写理由）：")
        print("    python3 tools/check_case_fragility.py --write")
        return 1

    if now < golden:
        print("⚠️  用例脆弱度下降 %d → %d（比基线更好，建议收窄基线）" % (golden, now))
        print("  执行：python3 tools/check_case_fragility.py --write")
        return 0

    print("✓ 用例脆弱度 %d = 基线 %d（%s）" % (
        now, golden,
        "、".join("%s=%d" % kv for kv in sorted(summary["by_rule"].items())) or "R1~R4 全空"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
