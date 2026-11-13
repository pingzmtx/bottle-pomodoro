# -*- coding: utf-8 -*-
"""W6 清理：删除重构期遗留的「（可回退）」注释脚手架。

背景：
    项目在 Wave 1~5 大改造期，为了「万一改错了能退回去」，在每处改动点写了
    「（可回退）：回退：xxx」的说明注释。改造已完成并全绿验证后，这类注释
    只剩下噪音——接手的人分不清哪条是正路、哪条是已废弃的老路。

只做两件事：
    A. 剥离「（可回退）」标记词本身（保留同一行的正文）；
    B. 删除**明确是回退说明**的整行，判定条件是「行首就是 回退：」——
       即在注释行里，去掉注释符号后，**以「回退」二字开头**。

安全边界（第一版踩过的坑，这里写死不许再犯）：
    ❌ 「回退」作动词/业务词的句子绝不能动，例如：
        `/* 🔄 赛季回退：赛季最后 14 天提醒回退目标 */`   ← 业务功能
        `…老用户自动按新规则回退，无需迁移`             ← 业务语义
        `无 Promise 环境自动回退 window.confirm`        ← 容错说明
        `…兑换消耗后进度与点亮状态同步回退`              ← 业务语义
      第一版正则写成 `回退[：:]` 全文匹配，把这 4 类全部腰斩，属于真误伤。
      现在只认「注释行去掉头部符号后以回退开头」，上述句子都以别的词开头，天然免疫。

    下列内容同样明确不动（看着像"回退"，实为产品必需）：
      1. 运行时降级分支（typeof 可用性判断）—— 老浏览器/隐私模式真的会走到；
      2. 数据兼容层（旧格式字段兜底、localStorage 镜像）—— 用户老存档靠它；
      3. 「整段可回退：删除本 <script>` 这类文件头说明 —— 属模块边界说明，
         且删除动作本身风险高，本脚本不碰（出现即列入待办人工决策）。

用法：
    python3 tools/w6_clean_fallback.py --dry-run   # 只报告，不写盘
    python3 tools/w6_clean_fallback.py             # 实际执行
"""
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
SCRIPTS = os.path.join(_ROOT, "src", "scripts")

DRY = "--dry-run" in sys.argv

# A: 标记词本身
RE_MARK = re.compile(r"（可回退）|\(可回退\)")

# B: 「纯回退说明行」——注释行去掉 */ 与前导符后，以「回退」开头
#    形如：` * 回退：删本常量并把表还原回 getAchievements 的 return 即可。 */`
#          ` * 回退：把 renderTodosRows 里的 apply 分支换回 list.innerHTML = html 即可。 */`
RE_PURE_FALLBACK = re.compile(r"^\s*(?:/\*)?\s*\*?\s*回退[：:].*$")

# 致命陷阱（第一版踩过，导致 7 个文件语法崩溃）：
#    「回退：…」这行可能是**注释块的最后一行**（自带 `*/`），也可能是**独立的单行注释**
#    （`/* 回退：… */`，`/*` 和 `*/` 都在同一行）。两者处理方式完全相反：
#      - 块末行：删文字但**必须保留 `*/`**，否则注释块未闭合 → 后续代码被吸进注释；
#      - 单行注释：**整行删干净**，若只保留 `*/` 会留下一个孤立的结束符 → SyntaxError。
#    判定靠 RE_LONE_COMMENT（同一行既有 /* 又有 */）。
RE_CARRIES_CLOSE = re.compile(r"\*/\s*$")
RE_LONE_COMMENT = re.compile(r"/\*.*\*/\s*$")

# B': 行内说明 + 行尾挂回退句，且**行内带有重构编号**（形如 F1-bugfix / P2-xx），
#     用于处理 `* 统一签名 (SC)…。回退：git reset。 */` 这类。
#     要求行内必须出现重构编号，避免误伤普通句子。
RE_INLINE_FALLBACK = re.compile(r"[；;。.]\s*回退[：:][^*]*?(\*/\s*)$")
RE_HAS_REV_TAG = re.compile(r"(R-[A-Za-z0-9\-]+|F\d+-bugfix|\bP\d+-[a-z]+)")

# 文件头「整段可回退」——只报告不处理
RE_WHOLE_MODULE = re.compile(r"整段可回退")


def _is_comment_line(line):
    s = line.strip()
    return s.startswith("*") or s.startswith("/*") or s.startswith("//")


def clean_text(text):
    lines = text.split("\n")
    out = []
    removed = 0
    stripped = 0
    flagged = []

    for line in lines:
        if not _is_comment_line(line):
            out.append(line)
            continue

        # 文件头整段回退说明：只登记，不改
        if RE_WHOLE_MODULE.search(line):
            flagged.append(line.strip()[:100])
            out.append(line)
            continue

        has_mark = bool(RE_MARK.search(line))
        probe = line.strip().lstrip("*/").strip()

        # B: 纯回退说明行 → 删。分两种情况（见上方陷阱说明）：
        #    ① 单行完整注释 `/* 回退：… */` → 整行删干净
        #    ② 注释块末行 ` * 回退：… */` → 只丢文字，保留 `*/` 收尾
        #    ③ 块内中间行 ` * 回退：…` → 整行删
        if RE_PURE_FALLBACK.match(line):
            indent = line[: len(line) - len(line.lstrip())]
            if RE_LONE_COMMENT.search(line) and line.strip().startswith("/*"):
                removed += 1
                continue          # ① 独立单行注释：整行删
            if RE_CARRIES_CLOSE.search(line):
                out.append(indent + " */")
                removed += 1
                continue          # ② 块末行：保留 */
            removed += 1
            continue              # ③ 块内中间行：整行删

        new_line = line

        # B': 带重构编号的行内回退句 → 摘掉该句，保留 */ 收尾
        if "回退：" in new_line and RE_HAS_REV_TAG.search(new_line):
            m = RE_INLINE_FALLBACK.search(new_line)
            if m:
                head = new_line[: m.start()].rstrip()
                new_line = head + " " + m.group(1)
                stripped += 1

        # A: 剥离标记词
        if has_mark:
            new_line = RE_MARK.sub("", new_line)
            new_line = new_line.replace("： ", "： ")  # 全角冒号后的空格统一去掉
            stripped += 1

        out.append(new_line)

    return "\n".join(out), removed, stripped, flagged


def main():
    total_removed = total_stripped = 0
    changed = []
    flagged_all = []

    for name in sorted(os.listdir(SCRIPTS)):
        if not name.endswith(".js"):
            continue
        path = os.path.join(SCRIPTS, name)
        with open(path, "r", encoding="utf-8") as f:
            src = f.read()
        new, rm, st, fl = clean_text(src)
        for x in fl:
            flagged_all.append(f"{name}: {x}")
        if new != src:
            changed.append((name, rm, st))
            total_removed += rm
            total_stripped += st
            if not DRY:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new)

    mode = "【试运行】" if DRY else "【已写入】"
    print(f"{mode} 改动文件数: {len(changed)}")
    for name, rm, st in changed:
        print(f"  {name}: 删除回退行 {rm}, 剥离标记 {st}")
    print(f"合计: 删除回退说明行 {total_removed}, 剥离（可回退）标记 {total_stripped}")

    if flagged_all:
        print(f"\n【需人工决策】发现「整段可回退」模块级说明 {len(flagged_all)} 处（本次不动）:")
        for x in flagged_all:
            print(f"  {x}")

    # 语法守卫（血泪教训）：本脚本曾两次把注释块的 */ 删错位置，
    # 造成 7 个文件语法崩溃 —— 而结构类 lint 查不出来，只有真跑页面才炸。
    # 因此清理后**必须**逐文件语法自检，不通就报错退出，绝不静默放过。
    if not DRY:
        import shutil
        import subprocess
        if shutil.which("node"):
            broken = []
            for name in sorted(os.listdir(SCRIPTS)):
                if not name.endswith(".js"):
                    continue
                p = os.path.join(SCRIPTS, name)
                r = subprocess.run(["node", "--check", p],
                                   capture_output=True, text=True, timeout=30)
                if r.returncode != 0:
                    first = (r.stderr or "").strip().split("\n")
                    brief = next((x for x in first if "SyntaxError" in x), "")
                    broken.append(f"{name}: {brief}")
            if broken:
                print("\n❌ 语法自检失败！清理破坏了代码结构，请回滚：")
                for b in broken:
                    print(f"   {b}")
                return 1
            print("\n✓ 语法自检通过（%d 个脚本全部可解析）" % len([f for f in os.listdir(SCRIPTS) if f.endswith(".js")]))
        else:
            print("\n⚠ 未找到 node，跳过语法自检 —— 强烈建议安装后重跑本脚本")

    # 安全自查：业务语义的「回退」必须完好
    print("\n【安全自查】业务语义词是否完好:")
    for name, kw in [
        ("01e6_ui_rank.js", "赛季回退"),
        ("01d_engine_features.js", "按新规则回退"),
        ("01d_engine_features.js", "回退到树种名"),
        ("01d_engine_features.js", "自动回退 window.confirm"),
        ("01e_engine_ui.js", "同步回退"),
    ]:
        p = os.path.join(SCRIPTS, name)
        ok = os.path.exists(p) and kw in open(p, encoding="utf-8").read()
        print(f"  {'✓' if ok else '✗ 丢失！'} {name}: 「{kw}」")


if __name__ == "__main__":
    main()
