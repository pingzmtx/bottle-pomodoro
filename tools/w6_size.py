#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""· 单文件规模红线（棘轮版）

为什么要有这一段：
    项目在 Wave 2 定过「无 >6000 行文件」。拆完当期最大是 01d 5,836 行，留了 164 行余量。
    但这条规则只写在文档里，tools/ 下没有任何工具守它 —— 于是 01d 一路涨到 3,928 行
    （拆过一次后又长回来），而机器一直绿灯，因为红线定在 6000。

    规则和机器脱钩 = 没有规则。更糟的是：**红线定得太高，等于没有红线**。
    一个 3,900 行的文件离 6,000 还有 2,100 行可加，制度等于在鼓励「继续往里塞」。

口径（棘轮 ratchet）：
    - 新文件（不在 baseline 里）：**≤ 800 行**。这是给"下一件事"定的粒度：
      一个文件装一件事，而不是装一个页面域。
    - 存量文件（在 `tools/size_baseline.json` 里）：**只许变小，不许变大**。
      当前行数 > 基线 → FAIL；< 基线 → 提示跑 `--bump` 把基线降下来。
      基线只降不升，所以整个仓库的"总脂肪"只会减少，不会反弹。
    - 绝对红线 6000 行仍然保留（历史文档写死的数字，双保险）。

为什么是 800：
    - 800 行 ≈ 20~25 个函数，是一个"能在一屏里想清楚"的规模；
    - 对比 SP（2,600 个文件 / 278k 行，平均 107 行）与 Bottle（55 个 / 61k 行，平均 1,125 行），
      800 是两者之间的合理中点，不会逼出碎片化（下限 120 行，见下）；
    - 下限 120 行：把 55 个文件拆成 400 个 100 行的碎片是另一种失败。

用法：
    python3 tools/w6_size.py            # 报告 + 退出码（有 FAIL=1）
    python3 tools/w6_size.py --json     # 结构化输出
    python3 tools/w6_size.py --bump     # 把基线下调到当前值（只降不升，用于拆完文件后收口）

怎么处理 FAIL：
    1. 优先「按职责域再拆一个文件」——照 01e → 01e2~01e8 的既有先例
       （新文件头写明「由 XX 按 YY 域拆出」，并登记进 src/manifest.json 的 slot 1 files）。
    2. 拆分是**纯移动**：不改一行逻辑，产物 `sha256` 必须不变。
    3. 拆完 `python3 tools/build.py` 重建，再跑 `verify.py --fast`，
       然后 `python3 tools/w6_size.py --bump` 把基线收下来 —— 这一步不能忘，
       否则下次有人把这 200 行加回去不会被拦。
    4. 不要靠"调大阈值"绕过 —— 阈值来自本文件与 baseline，改它要同时改文档。
"""
import glob
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
SCRIPTS = os.path.join(_ROOT, "src", "scripts")
BASELINE = os.path.join(_HERE, "size_baseline.json")

AS_JSON = "--json" in sys.argv
BUMP = "--bump" in sys.argv

NEW_LIMIT = 800        # 新文件上限
FLOOR_LINES = 120      # 下限：低于它只提示，不 FAIL（避免碎片化被当成"好"）
HARD_CAP = 6000        # 绝对红线（历史规则，双保险）


def count_lines(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return sum(1 for _ in f)


def load_baseline():
    if not os.path.exists(BASELINE):
        return {}
    with open(BASELINE, encoding="utf-8") as f:
        return json.load(f)


def save_baseline(d):
    with open(BASELINE, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def main():
    base = load_baseline()
    rows = []
    for p in sorted(glob.glob(os.path.join(SCRIPTS, "*.js"))):
        name = os.path.basename(p)
        rows.append({"file": name, "lines": count_lines(p), "base": base.get(name)})

    grown, over_cap, new_big, dropped, tiny = [], [], [], [], []
    for r in rows:
        n, b = r["lines"], r["base"]
        if n > HARD_CAP:
            over_cap.append(r)
        if b is None:
            if n > NEW_LIMIT:
                new_big.append(r)
        else:
            if n > b:
                r["delta"] = n - b
                grown.append(r)
            elif n < b:
                r["delta"] = b - n
                dropped.append(r)
        if n < FLOOR_LINES:
            tiny.append(r)

    fails = over_cap + new_big + grown
    top = sorted(rows, key=lambda r: -r["lines"])[:10]

    if BUMP:
        changed = 0
        for r in rows:
            b = r["base"]
            if b is None:
                if r["lines"] > NEW_LIMIT:
                    print(f"✗ 拒绝：{r['file']} 是新文件且 {r['lines']} 行 > {NEW_LIMIT}，先拆再 bump")
                    return 1
                continue
            if r["lines"] < b:
                base[r["file"]] = r["lines"]
                changed += 1
        # 已删除的文件从基线里清掉
        alive = {r["file"] for r in rows}
        for k in list(base):
            if k not in alive:
                del base[k]
                changed += 1
        save_baseline(base)
        print(f"✓ 基线已收口：{changed} 个文件下调（只降不升）")
        return 0

    if AS_JSON:
        print(json.dumps({
            "status": "fail" if fails else "pass",
            "new_limit": NEW_LIMIT,
            "hard_cap": HARD_CAP,
            "files": len(rows),
            "baseline_files": len(base),
            "grown": grown,
            "new_over_limit": new_big,
            "over_hard_cap": over_cap,
            "can_bump": dropped,
            "top10": top,
        }, ensure_ascii=False))
        return 1 if fails else 0

    print(f"📏 单文件规模检查（棘轮）  |  新文件 ≤{NEW_LIMIT} 行 · 存量只准降  |  "
          f"{len(rows)} 个文件 / 基线 {len(base)} 个\n")
    print("  最大 10 个：")
    for r in top:
        tag = ""
        if r["base"] is None:
            tag = "🆕 新文件" if r["lines"] <= NEW_LIMIT else "❌ 新文件超限"
        elif r["lines"] > r["base"]:
            tag = f"❌ 比基线多 {r['lines'] - r['base']} 行"
        elif r["lines"] < r["base"]:
            tag = f"↓ 比基线少 {r['base'] - r['lines']} 行（可 --bump）"
        print(f"    {r['lines']:>6} 行  {r['file']}{('  ' + tag) if tag else ''}")

    if dropped:
        print(f"\n✓ 有 {len(dropped)} 个文件变瘦了 —— 拆完记得收口基线：")
        print("    python3 tools/w6_size.py --bump")
        for r in dropped[:8]:
            print(f"    {r['file']}  {r['base']} → {r['lines']}（-{r['delta']}）")

    if grown:
        print(f"\n❌ 有 {len(grown)} 个文件比基线变大了（棘轮只准降）：")
        for r in grown:
            print(f"    {r['file']}  基线 {r['base']} → 现在 {r['lines']}（+{r['delta']}）")
        print("    处理：把那 {n} 行拆去新文件，或说明为什么必须加（并在 PR 里改基线）。".format(n="新增"))

    if new_big:
        print(f"\n❌ 有 {len(new_big)} 个新文件超过 {NEW_LIMIT} 行：")
        for r in new_big:
            print(f"    {r['file']}  {r['lines']} 行（超 {r['lines'] - NEW_LIMIT}）")

    if over_cap:
        print(f"\n❌ 有 {len(over_cap)} 个文件超过绝对红线 {HARD_CAP} 行：")
        for r in over_cap:
            print(f"    {r['file']}  {r['lines']} 行")

    if tiny:
        print(f"\n⚠️ 有 {len(tiny)} 个文件少于 {FLOOR_LINES} 行（碎片化不是目标，仅提示）：")
        print("    " + " · ".join(r["file"] for r in tiny[:10]))

    if fails:
        print("\n处理办法见本文件头部「怎么处理 FAIL」。禁止直接调大阈值绕过。")
        return 1

    print("\n✓ 没有文件在变大")
    return 0


if __name__ == "__main__":
    sys.exit(main())
