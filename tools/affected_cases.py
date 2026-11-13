#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""affected_cases.py — 从改动文件推出「该跑哪些冒烟用例」

为什么有它：全量冒烟 2~4 分钟，输出几万字符全进上下文（费 token）。
绝大多数改动只碰 1~2 个模块，跑全量是纯浪费。默认动作应该是
「兜底层(core) ∪ 本次改动相关(feature)」，而不是全量。

★ 归属关系不再写在这张表里（老版本的手写 MAP 已删）。
  它写在各用例自己的 `@case(..., tier=, owner=)` 上，本文件直接解析 run_smoke.py。
  原因：手写的「文件→用例」表**一定会漏登记** —— 新功能加了用例，没人回头补表，
  于是改到那块功能时推不出对应用例，不完整的集合不敢用，最后只能全量。
  归属跟着用例走，登记就成了写用例的一部分，漏不掉。

用法：
  python3 tools/affected_cases.py                     # 读 git diff --name-only HEAD
  python3 tools/affected_cases.py src/scripts/01c_engine_timer.js ...
  python3 tools/affected_cases.py --staged            # 只看暂存区
  python3 tools/affected_cases.py --cmd               # 输出可直接复制的命令

判定：
  - core 层永远在；feature 层按 owner 子串命中改动路径进集合；
  - 命中「全局文件」(template.html / manifest.json / tools/build.py / tools/run_smoke.py)
    → 全量（这些文件一改，所有视图/所有用例都可能受影响）。
退出码 0 永远（只是建议）。
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SMOKE = os.path.join(HERE, "run_smoke.py")

# 全局文件：一改就可能波及所有用例，直接全量。
# ★ 00_pure_core.js 必须留在名单里：它是所有模块的 L0 依赖（改一处塌一片），
#   且 C32（日志合并阈值）等用例直接依赖它的常量 —— 曾经被移出，导致改它只跑 26/52 且漏掉 C32。
# ★ src/template.html 已**移出**名单：它已被拆成 src/template/ 下的片段（拆分前是
#   7843 行巨型文件、63% 是 CSS，任何样式改动都命中这里 → 逼出全量回归）。
#   现在改样式只跑「显示类用例」（owner 里带 template.html 的那些）。
GLOBAL = ("src/scripts/00_pure_core.js", "src/manifest.json", "tools/build.py", "tools/run_smoke.py")

# 模板片段路径 → 归一化成「模板整体」路径：用例的 owner 写的是 "template.html"
# （含义是"我依赖整个模板的渲染/布局"），因此改任意片段都该命中它们。
TEMPLATE_DIR = "src/template/"
TEMPLATE_AS = "src/template.html"


def _norm(f):
    """把 src/template/ 片段路径归一化成 src/template.html，供 owner 子串匹配。"""
    return TEMPLATE_AS if f.startswith(TEMPLATE_DIR) else f

_CASE_RE = re.compile(
    r'@case\(\s*"([^"]+)"\s*(?:,\s*tier\s*=\s*"([^"]*)")?\s*(?:,\s*owner\s*=\s*"([^"]*)")?\s*\)')


def parse_cases(path=SMOKE):
    """从 run_smoke.py 源码解析用例清单 → [(全名, tier, [owner...])]。

    用正则而不是 import：run_smoke 顶部 import websocket 等重依赖，
    这里只想快速拿元数据，不该被它的运行环境绑架。
    """
    src = open(path, encoding="utf-8").read()
    out = []
    for m in _CASE_RE.finditer(src):
        out.append((m.group(1), m.group(2) or "feature",
                    (m.group(3) or "").split()))
    return out


def changed(argv):
    if argv and not argv[0].startswith("-"):
        return list(argv)
    staged = "--staged" in argv
    args = ["git", "-c", "core.quotepath=false", "diff", "--name-only"]
    args.append("--cached" if staged else "HEAD")
    try:
        out = subprocess.run(args, capture_output=True, text=True).stdout
    except Exception:
        return []
    files = [l.strip() for l in out.splitlines() if l.strip()]
    if not staged:
        # 新加的模块文件在 `git diff HEAD` 里看不见（还没 add）——
        # 而「新加一个 01f_xxx.js」恰恰是最需要跑相关用例的时候。
        try:
            other = subprocess.run(["git", "ls-files", "--others", "--exclude-standard"],
                                   capture_output=True, text=True).stdout
            files += [l.strip() for l in other.splitlines() if l.strip()]
        except Exception:
            pass
    return files


def select(files, meta=None):
    """→ (选中用例全名的集合, full: bool, reason: str)

    meta 可传入已解析的用例表（run_smoke 直接复用内存里的 _cases）；
    不给则自己解析 run_smoke.py。
    """
    meta = meta or parse_cases()
    core = {n for n, t, _o in meta if t == "core"}
    norm = [_norm(f) for f in files]
    for f in norm:
        if any(f == g or f.endswith(g) for g in GLOBAL):
            return set(n for n, _t, _o in meta), True, f"命中全局文件 {f}"
    if not files:
        # 干净工作区（多半是已提交完才跑）→ 选不出任何 feature。
        # 这里**不能**客气地只跑 core：静默少跑 = 假绿，比多跑严重得多。
        return set(n for n, _t, _o in meta), True, \
            "工作区无改动（已提交完？）→ 无法判断影响面，退回全量"
    hit = set()
    orphan_case = []
    for n, t, owners in meta:
        if t == "core":
            continue
        if not owners:
            # 没写 owner 的 feature 用例永远选不中 —— 别静默丢了，一律拉进来并报告。
            # （tools/check_case_meta.py 门禁会把它拦在提交前，这里只是兜底不静默。）
            hit.add(n); orphan_case.append(n)
            continue
        if any(o in f for f in norm for o in owners):
            hit.add(n)
    reason = f"core {len(core)} 条 ∪ 相关 {len(hit)} 条"
    sel = core | hit
    total = len(meta)
    if len(sel) >= total * 0.8:
        # 命中上帝文件（01e_engine_ui / 01b_engine_data 之类）时选集≈全量，
        # 与其假装精确，不如直说：这时候省不下时间，直接全量更好读。
        return set(n for n, _t, _o in meta), True, \
            f"改动命中全局模块：{len(sel)}/{total} 条 ≈ 全量，直接全量"
    orphan = unclaimed(files, meta)
    if orphan:
        # 不静默：告诉人「这块代码目前没有用例认领」，改它只能靠兜底层
        reason += "；⚠️ 无用例认领的模块: " + ", ".join(orphan) + "（改这里只跑兜底层）"
    if orphan_case:
        reason += "；⚠️ 未声明 owner 的用例（一律跑）: " + ", ".join(
            c.split()[0] for c in orphan_case)
    return sel, False, reason


def unclaimed(files, meta=None):
    """改动里没有任何 owner 认领的源文件（= 覆盖盲区）。"""
    meta = meta or parse_cases()
    owners = {o for _n, _t, os_ in meta for o in os_}
    return [f for f in files
            if f.startswith("src/") and not any(o in _norm(f) for o in owners)]


def audit():
    """列出 src 下**没有任何用例认领**的模块——这就是覆盖盲区，也是老板说的「每加功能就造用例」
    的另一面：不是用例太多，是有些模块一条都没有。"""
    import glob
    meta = parse_cases()
    owners = {o for _n, _t, os_ in meta for o in os_}
    files = sorted(glob.glob(os.path.join(HERE, "..", "src", "scripts", "*.js")))
    files += sorted(f for f in glob.glob(os.path.join(HERE, "..", "src", "template", "*"))
                    if not f.endswith("_order.json"))
    blind = [os.path.relpath(f, os.path.join(HERE, "..")) for f in files
             if not any(o in f for o in owners)]
    print("覆盖盲区（%d 个模块没有用例认领）:" % len(blind))
    for b in blind:
        print("   " + b)
    print("\n要不要补，看这些模块近期会不会改；不改就是零成本。")
    return 0


def main():
    argv = [a for a in sys.argv[1:]]
    if "--audit" in argv:
        return audit()
    want_cmd = "--cmd" in argv
    files = changed([a for a in argv if not a.startswith("-")])
    meta = parse_cases()
    names, full, reason = select(files, meta)
    ordered = sorted(names, key=lambda c: (len(c), c))

    print("改动文件 (%d): %s" % (len(files), ", ".join(files) if files else "(无)"))
    print("用例总数 %d（core %d / feature %d）"
          % (len(meta), len([1 for _n, t, _o in meta if t == "core"]),
             len([1 for _n, t, _o in meta if t == "feature"])))

    if full:
        print("\n==> 建议：全量冒烟（FULL）—— %s" % reason)
        print("    python3 tools/run_smoke.py --via browser")
        print("    交给子代理跑，只回收「PASS/FAIL 汇总 + 失败项」结论。")
        return 0

    print("\n==> 建议跑 %d 条（%s）：" % (len(ordered), reason))
    print("    " + ", ".join(c.split()[0] for c in ordered))
    if want_cmd:
        print("\n    # 桥模式（真机浏览器）——不用再抄 --only，--affected 自己会挑")
        print("    sh tools/smoke_via_browser.sh start --affected")
        print("    # 或显式指定：")
        print("    sh tools/smoke_via_browser.sh start --only %s"
              % ",".join(c.split()[0] for c in ordered))
    return 0


if __name__ == "__main__":
    sys.exit(main())
