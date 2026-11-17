#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""症状词 → 文件定位（「我该改哪个文件」的第一站）。

用法
----
    python3 tools/where.py "热力图"          # 单个词
    python3 tools/where.py 热力图 不刷新      # 多个词：命中任一即列出，命中越多排越前
    python3 tools/where.py "打卡海报" --json  # 结构化
    python3 tools/where.py --list            # 列出全部 71 个文件的症状词（没写的显示 —）

判据
----
每个源文件头里的四个字段按可信度排序：
    症状 > 职责 > 标题 > 其余说明
「症状」是用户会说的话（「看不到热力图」「树不长大」），命中它最可能是要找的文件；
「职责」是归纳过的模块职责；标题只是编号 + 一句话；其余说明是补充背景，权重最低。
函数索引（TOC）不参与打分 —— 里面全是代码标识符，搜中文永远命中不了，搜英文又太宽。

退出码
------
0 找到（至少一个文件）· 1 没找到 · 2 参数错

为什么要有它
------------
71 个文件，文件名是 `ui_tree` / `engine_stats` 这种「域_职责」两段式 —— 它能告诉你
"这块归谁管"，但答不了"用户说的『树不长大』到底落在哪个文件"：那得读文件头的症状行。
此前那行只是给人看的注释，没有任何工具读它 ——
写了等于没写。这个脚本把「用户说法」直接对到「文件 + 函数清单」。
"""

import io
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "scripts")
HEAD_LINES = 24   # 文件头都在前 24 行内；再往下是代码

RE_SYM = re.compile(r"^\s*\*\s*(?:症状|症狀)[:：]\s*(.+?)\s*$")
RE_DUTY = re.compile(r"^\s*\*\s*职责[:：]\s*(.+?)\s*$")
RE_INLINE = re.compile(r"[｜|]\s*(?:症状|症狀)[:：]\s*(.+?)\s*$")   # 「职责：… ｜症状：…」内联
RE_TITLE = re.compile(r"^\s*\*\s*([0-9A-Za-z_]+(?:\.[a-z]+)?\s*·\s*.+?)\s*$")
RE_TOC = re.compile(r"^\s*\*\s*函数索引（TOC）[:：]\s*(.+?)\s*$")
RE_STAR = re.compile(r"^\s*\*\s*(.+?)\s*$")


def parse_head(path):
    """从一个源文件头里抽出可检索字段。缺字段就是空串，不猜。"""
    out = {"symptom": "", "duty": "", "title": "", "extra": [], "toc": ""}
    try:
        with io.open(path, encoding="utf-8") as f:
            lines = [next(f, "") for _ in range(HEAD_LINES)]
    except OSError:
        return out
    in_block = False
    for line in lines:
        if not line:
            continue
        st = line.strip()
        # 只解析注释行（复审 P3）：不限定的话，代码里出现字符串 `"a|症状：x"` 也会被
        # 当成症状词收录。注释块的判定要覆盖 `/*` 与 `*/` 同行的情况。
        opens, closes = "/*" in line, "*/" in line
        is_comment = in_block or opens or st.startswith(("//", "*"))
        if opens:
            in_block = True
        if closes:
            in_block = False
        if not is_comment:
            continue
        # 内联症状可能挂在任意一行上（标题 / 职责 / 首条说明），先统一摘出来，
        # 再去判这一行属于哪个字段 —— 否则「标题行内联」的那批文件永远搜不到症状。
        inline_any = RE_INLINE.search(line)
        if inline_any:
            out["symptom"] = (out["symptom"] + " · " + inline_any.group(1)).strip(" ·")
            line = RE_INLINE.sub("", line)
        m = RE_SYM.search(line)
        if m:
            out["symptom"] = (out["symptom"] + " · " + m.group(1)).strip(" ·")
            continue
        m = RE_DUTY.search(line)
        if m:
            text = m.group(1)
            inline = RE_INLINE.search(text)
            if inline:   # 「职责：… ｜症状：…」：拆开，症状单独计分
                out["symptom"] = (out["symptom"] + " · " + inline.group(1)).strip(" ·")
                text = RE_INLINE.sub("", text).strip()
            out["duty"] = text
            continue
        m = RE_TOC.search(line)
        if m:
            out["toc"] = m.group(1)
            continue
        if not out["title"]:
            m = RE_TITLE.search(line)
            if m:
                out["title"] = m.group(1)
                inline = RE_INLINE.search(out["title"])
                if inline:   # 标题行内联症状
                    out["symptom"] = (out["symptom"] + " · " + inline.group(1)).strip(" ·")
                    out["title"] = RE_INLINE.sub("", out["title"]).strip()
                continue
        m = RE_STAR.search(line)
        if m and "====" not in m.group(1) and not m.group(1).startswith("【模块说明】"):
            out["extra"].append(m.group(1))
    return out


def all_files():
    return sorted(f for f in os.listdir(ROOT) if f.endswith(".js"))


def load_all():
    rows = []
    for f in all_files():
        d = parse_head(os.path.join(ROOT, f))
        d["file"] = f
        rows.append(d)
    return rows


def score(row, words):
    """命中词数 × 字段权重。返回 (分数, 命中字段列表)。

    注意是「命中词数」不是「出现次数」：同一个词在同一字段出现 5 次也只算 1 次，
    否则长「说明」字段靠重复堆分就能压过症状命中。
    """
    fields = [("症状", row["symptom"], 4), ("职责", row["duty"], 3),
              ("标题", row["title"], 2), ("说明", " ".join(row["extra"]), 1)]
    total, hit = 0, []
    for name, text, weight in fields:
        if not text:
            continue
        n = sum(1 for w in words if w in text)
        if n:
            total += n * weight
            hit.append(name)
    return total, hit


def short_toc(toc, limit=8):
    if not toc:
        return "（无 TOC）"
    parts = [x for x in toc.replace("（+", "|+").split("/") if x]
    head = parts[:limit]
    tail = [p for p in parts[limit:] if p.startswith("+")]
    return " / ".join(head + tail)


def main():
    argv = sys.argv[1:]
    known = {"-h", "--help", "--list", "--json"}
    words = [a for a in argv if a not in known and not a.startswith("-")]
    unknown = [a for a in argv if a.startswith("-") and a not in known]
    if unknown:
        print("✗ 不认识的参数：%s（支持 --list / --json / -h）" % " ".join(unknown))
        return 2
    if "-h" in argv or "--help" in argv:
        print(__doc__)
        return 0

    rows = load_all()
    if "--list" in argv:
        for r in rows:
            print("%-34s  %s" % (r["file"], r["symptom"] or "—"))
        return 0
    if not words:
        print("✗ 需要一个症状词（例：python3 tools/where.py 热力图）")
        return 2
    if all(len(w) < 2 for w in words):
        print("提示：单字检索噪音较大（「树」会命中「树种」「树商店」），建议再加一个词。",
              file=sys.stderr)

    ranked = []
    for r in rows:
        s, hit = score(r, words)
        if s:
            ranked.append((s, r, hit))
    ranked.sort(key=lambda x: (-x[0], x[1]["file"]))

    if "--json" in argv:
        print(json.dumps([{"file": r["file"], "score": s, "fields": hit,
                           "symptom": r["symptom"], "duty": r["duty"], "toc": r["toc"]}
                          for s, r, hit in ranked], ensure_ascii=False, indent=1))
        return 0 if ranked else 1

    if not ranked:
        print("没找到含「%s」的文件。" % " ".join(words))
        print("提示：文件头可能还没写「症状：」。用 --list 看哪些文件缺，补在该文件头里。")
        return 1

    print("找到 %d 个文件（症状 > 职责 > 标题 > 说明）：\n" % len(ranked))
    for s, r, hit in ranked:
        print("%-34s  [%s]  %s" % (r["file"], "+".join(hit), r["symptom"] or r["duty"] or r["title"]))
        if r["duty"]:
            print("    职责：%s" % r["duty"])
        print("    TOC ：%s" % short_toc(r["toc"]))
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
