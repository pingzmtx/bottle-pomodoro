#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用例 ↔ runner 契约门禁（P0-1 的机器守卫）。

为什么需要它
------------
2026-10 的真实事故：c95–c104 里 9 个用例的 ok() 往 R 里 push 三元组
（`[name, cond, detail]`），而 runner 写的是 `for name, okv in res:` ——
UnpackingError，整条用例恒定抛异常。**断言一条都没跑，报告里却只显示"用例异常"**，
而它们恰好覆盖旧窗口覆盖守卫、每段提醒、按天对账这些数据安全核心。
更早两天，c33 表现得"会随时间变红"，真相是它压根没注册进 runner：文件躺在
tools/tests/ 里，100 条用例里查无此编号 —— 零覆盖，比红更安静。

本门禁只做三件确定性检查（纯静态、<0.5s，不需要浏览器）：

  ① **孤儿用例**：tools/tests/*.js 里每个用例都必须被 run_smoke.py 以
     `_case_js("<文件名>")` 引用。没有 → FAIL（"写了不等于跑了"）。
  ② **返回形态**：用例必须 `return JSON.stringify(R)`（否则 runner 拿到 undefined，
     json.loads 直接 ValueError，报错信息还看不出是哪条用例）。
  ③ **元组宽度**：R.push([...]) 的顶层元素数必须能被 runner 的当前解包方式接住：
     - runner 用 `_r[0], _r[1]`（宽容）→ 允许 ≥2
     - runner 用 `for name, okv in ...`（严格）→ 必须恰好 2

明确不管：断言内容对不对、常量是否过时（那是 check_case_fragility / 用例本身的事）。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.join(ROOT, "tools", "tests")
RUNNER = os.path.join(ROOT, "tools", "run_smoke.py")

# 不是"用例"的文件：公共契约、探针、临时脚本、Node 单测（自己 assert，不走 R 契约）
NOT_CASES = {"_contract.js", "_probe.js", "_tmp_block.js", "unit_pure.js"}

fails = []
notes = []


def split_top_level(text, start):
    """从 text[start] == '[' 开始，返回（顶层元素数, 结束下标）。

    只做括号/引号感知，不求完整 JS 解析：够用且不会误判常见的
    `[name + (d ? ' :: ' + d : ''), !!c]` 这种写法。
    """
    depth = 0
    quote = None
    esc = False
    count = 1
    i = start
    while i < len(text):
        ch = text[i]
        if quote:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == quote:
                quote = None
        else:
            if ch in "'\"`":
                quote = ch
            elif ch in "[{(":
                depth += 1
            elif ch in "]})":
                depth -= 1
                if depth == 0:
                    return count, i
            elif ch == "," and depth == 1:
                count += 1
        i += 1
    return None, None


def pushes(src):
    """返回该文件所有 R.push([...]) 的顶层元素数。"""
    out = []
    for m in re.finditer(r"R\.push\(\s*\[", src):
        start = src.index("[", m.start())
        n, _end = split_top_level(src, start)
        if n is not None:
            out.append(n)
    return out


def main():
    runner_src = open(RUNNER, encoding="utf-8").read()

    # ★ runner 里新旧两种解包**并存**：c32 那批老包装写 `for name, okv in json.loads(...)`，
    #   c95 之后与本次统一过的是 `for _r in res: name, okv = _r[0], _r[1]`。
    #   所以不能"全局取一种风格"，必须按 @case 块逐块判定 —— 否则宽容模式的 3 元组
    #   会被另一段严格解包判死（第一版就踩了这个，9 条全误报）。
    style_by_file = {}
    for blk in re.split(r"\n@case\(", runner_src):
        m_file = re.search(r'_case_js\("([^"]+)"\)', blk)
        if not m_file:
            continue
        fname = m_file.group(1)
        if re.search(r"_r\[0\]\s*,\s*_r\[1\]", blk):
            st = "lenient"
        elif re.search(r"for\s+name\s*,\s*okv\s+in", blk):
            st = "strict"
        else:
            st = None
        # 同一文件被多个包装引用时取最严格的那个（严格必须 =2）
        prev = style_by_file.get(fname)
        style_by_file[fname] = "strict" if "strict" in (prev, st) else (st or prev)

    strict_n = sum(1 for v in style_by_file.values() if v == "strict")
    lenient_n = sum(1 for v in style_by_file.values() if v == "lenient")
    notes.append(f"runner 解包：{lenient_n} 个文件宽容(≥2) / {strict_n} 个文件严格(=2)")
    unknown = [f for f, v in style_by_file.items() if v is None]
    if unknown:
        fails.append("这些文件的包装函数里找不到解包语句，守卫无从判断：" + ", ".join(sorted(unknown)))

    files = sorted(f for f in os.listdir(TESTS) if f.endswith(".js"))
    case_files = [f for f in files if f not in NOT_CASES]

    for f in case_files:
        path = os.path.join(TESTS, f)
        src = open(path, encoding="utf-8").read()

        # ① 孤儿：必须被 runner 用 _case_js("文件名") 引用
        if f not in style_by_file:
            fails.append(f"{f}: 孤儿用例 —— tools/tests/ 里有这个文件，但 run_smoke.py 从没 _case_js(\"{f}\") 引用它，等于零覆盖")
            continue

        # ② 返回形态
        if "return JSON.stringify(R)" not in src:
            fails.append(f"{f}: 没有 `return JSON.stringify(R)` —— runner 会拿到 undefined 并抛 ValueError")

        # ③ 元组宽度（按该文件自己的解包方式判）
        style = style_by_file[f]
        widths = pushes(src)
        if not widths:
            fails.append(f"{f}: 找不到任何 R.push([...]) —— ok() 没有往结果里写东西？")
            continue
        if style == "strict":
            bad = [w for w in widths if w != 2]
            tip = "严格解包要求恰好 2 元（[name, cond]）"
        else:
            bad = [w for w in widths if w < 2]
            tip = "宽容解包要求至少 2 元"
        if bad:
            fails.append(
                f"{f}: R.push 元组宽度 {sorted(set(bad))} 不合法 —— {tip}"
                f"（共 {len(bad)} 处，全部宽度 {sorted(set(widths))}）"
            )
        elif len(set(widths)) > 1:
            notes.append(f"{f}: 同一文件里混用宽度 {sorted(set(widths))}（{style} 能接，记录在案）")

    # 反向检查：runner 引用了不存在的文件
    for m in re.finditer(r'_case_js\("([^"]+)"\)', runner_src):
        name = m.group(1)
        if not os.path.exists(os.path.join(TESTS, name)):
            fails.append(f"run_smoke.py 引用了不存在的用例文件：tools/tests/{name}")

    print(f"用例文件：{len(case_files)} 个（另有 {len(files) - len(case_files)} 个公共/临时文件不检查）")
    for n in notes:
        print(f"  · {n}")
    if fails:
        print(f"\n✗ FAIL：{len(fails)} 处契约问题")
        for f in fails:
            print(f"  ✗ {f}")
        return 1
    print("\n✓ PASS：孤儿用例 0 / 返回形态齐全 / 元组宽度与 runner 解包一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
