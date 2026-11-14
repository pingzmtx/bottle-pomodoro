#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_derived_tokens.py —— 「派生令牌被冻死」门禁（P1 深色标题回归的根因）

为什么要有这一段
----------------
2026-11-14 视觉验收发现真回归：深色下 `.header h1` 计算色是 rgb(30,42,56)（浅色值），
对比度 1.3:1，标题看不见。根因不是某个值写错，而是 CSS 自定义属性的**计算时机**：

    :root { --text-1: var(--text); }          /* 在 html 上定型成 #1E2A38 */
    body.dark-mode { --text: #EDEDF2; }       /* 在 body 上改，html 追不上 */

自定义属性在**声明所在的那个元素**上完成替换，然后作为「已解析的值」往下继承。
所以：`T` 在 html 上派生于 `y`，而 `y` 只在 body 上被覆盖 → `T` 在 body 里仍是浅色值。

这条判据完全静态可判：**若 T 声明的元素层级上没有 y 的定义，而 y 在更深的元素上有定义，
则 T 被冻死在该层之上**。检查的是「声明位置」，与具体色值无关。

三种典型形态（都会被本门禁抓到）：
  ① `:root { --text-1: var(--text) }` + `body.dark-mode { --text: … }`
  ② `:root { --text-3: var(--ink-mute, #…) }` + 连 :root 都没有 --ink-mute
     （fallback 恒定 → 12 外观全用同一个 #7B88A1）
  ③ 主题块 `body[data-theme=x] { --primary-rgb: … }` 改了分量，
     而 `:root { --focus-ring: rgba(var(--primary-rgb), .28) }` 没跟着重声明

修法固定一种：把派生令牌写在**覆盖发生的同一层或更深**（本项目里就是 `body`）。
不要在每个主题块里逐个补 —— 那是把词汇表复制 12 份，下次加主题必漏。

豁免：确实需要冻结在 html 层的（例如给 html 自身用、不能随 body 变的），
写进 `src/derived_token_allow.json`，每条必须带理由；无理由条目本工具直接判失败。

用法:
    python3 tools/check_derived_tokens.py            # 门禁
    python3 tools/check_derived_tokens.py --list     # 列出全部派生关系（只读排查）
退出码：0 通过 / 1 有违规
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_DIR = os.path.join(ROOT, "src", "template")
ALLOW = os.path.join(ROOT, "src", "derived_token_allow.json")

COMMENT = re.compile(r"/\*.*?\*/", re.S)
VARREF = re.compile(r"var\(\s*(--[\w-]+)")


def strip_comments(text):
    """去掉注释但保留换行，行号仍对得上原文。"""
    return COMMENT.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def parse(text):
    """返回 [(selector, prop, value, line)]；selector 是「最内层非 @ 规则」那一层。

    只处理本项目的写法（无嵌套 CSS、值里没有字符串花括号），够用且不引第三方解析器。
    """
    text = strip_comments(text)
    stack = []
    out = []
    buf = []
    cur = []
    i = 0
    line = 1
    decl_line = 1
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "{":
            sel = "".join(buf).strip()
            if ">" in sel:          # 片段文件以 <style …> 开头，标签不是选择器的一部分
                sel = sel.rsplit(">", 1)[1].strip()
            buf = []
            stack.append((sel, sel.startswith("@")))
            cur = []
            decl_line = line
        elif ch == "}":
            if stack:
                stack.pop()
            buf = []
            cur = []
        elif ch == ";":
            if stack:
                piece = "".join(cur)
                if ":" in piece:
                    prop, val = piece.split(":", 1)
                    out.append((_real_selector(stack), prop.strip(), val.strip(), decl_line))
            cur = []
        else:
            buf.append(ch)
            cur.append(ch)
            if ch == "\t":
                pass
        if ch == "\n":
            line += 1
            if not "".join(cur).strip():
                decl_line = line
        i += 1
    return out


def _real_selector(stack):
    for sel, is_at in reversed(stack):
        if not is_at:
            return sel
    return ""


def element_of(selector):
    """把选择器归到「声明在哪个元素上」：html / body / other。

    只关心继承边界：html(:root) 与 body 之间是唯一会被「已解析值继承」切断的一层。
    多选择器（`, ` 分隔）只要有 body 就算 body（项目里没有混写的情况）。
    """
    parts = [p.strip() for p in selector.split(",") if p.strip()]
    elems = set()
    for p in parts:
        if p in (":root", "html") or p.startswith("html.") or p.startswith("html["):
            elems.add("html")
        elif p.startswith("body") or p.startswith("html body"):
            elems.add("body")
        else:
            elems.add("other")
    if "body" in elems:
        return "body"
    if "html" in elems:
        return "html"
    return "other"


def collect():
    defs = {}   # token -> [(file, line, elem, selector, value)]
    files = sorted(os.listdir(CSS_DIR))
    for fn in files:
        if not fn.endswith(".css"):
            continue
        p = os.path.join(CSS_DIR, fn)
        txt = open(p, encoding="utf-8").read()
        for sel, prop, val, ln in parse(txt):
            if not prop.startswith("--"):
                continue
            defs.setdefault(prop, []).append((fn, ln, element_of(sel), sel, val))
    return defs


def check(defs, allow):
    errs = []
    for token, sites in sorted(defs.items()):
        token_elems = {d[2] for d in sites}
        for fn, ln, elem, sel, val in sites:
            if elem == "other":
                continue
            for dep in dict.fromkeys(VARREF.findall(val)):
                dep_sites = defs.get(dep, [])
                deeper = [d for d in dep_sites if _rank(d[2]) > _rank(elem)]
                if not deeper:
                    continue
                # 该派生令牌只要在「最深覆盖层」也有声明，就能在那一层重新求值 → 通过
                lowest = max(_rank(d[2]) for d in deeper)
                if any(_rank(e2) >= lowest for e2 in token_elems):
                    continue
                where = "；".join(f"{d[0]}:{d[1]} [{d[3]}]" for d in deeper[:3])
                key = f"{token}<-{dep}@{elem}"
                if key in allow:
                    continue
                errs.append({
                    "key": key,
                    "token": token, "dep": dep, "elem": elem,
                    "at": f"{fn}:{ln}", "sel": sel, "val": val,
                    "where": where,
                })
    return errs


def _rank(elem):
    return {"html": 0, "body": 1}.get(elem, 2)


def load_allow():
    if not os.path.exists(ALLOW):
        return {}
    data = json.load(open(ALLOW, encoding="utf-8"))
    out = {}
    bad = []
    for k, v in data.items():
        if k.startswith("_"):
            continue
        why = (v or {}).get("why", "").strip() if isinstance(v, dict) else ""
        if len(why) < 8:
            bad.append(k)
        else:
            out[k] = why
    return {"allow": out, "bad": bad}


def main():
    defs = collect()
    allow_raw = load_allow()
    allow = allow_raw.get("allow", {}) if isinstance(allow_raw, dict) else {}
    bad = allow_raw.get("bad", []) if isinstance(allow_raw, dict) else []

    if "--list" in sys.argv:
        rows = []
        for token, sites in defs.items():
            for fn, ln, elem, sel, val in sites:
                for dep in VARREF.findall(val):
                    rows.append((token, dep, elem, fn, ln, sel))
        print(f"派生令牌共 {len(rows)} 条")
        for token, dep, elem, fn, ln, sel in sorted(rows):
            print(f"  {fn}:{ln}  [{elem}] {token} ← {dep}")
        return 0

    errs = check(defs, allow)
    print("== 派生令牌冻死门禁（声明层级判据）==")
    print(f"  · CSS 分片 {len({d[0] for s in defs.values() for d in s})} 个 · "
          f"令牌 {len(defs)} 个 · 派生关系 {sum(len(VARREF.findall(v)) for s in defs.values() for *_, v in s)} 条"
          f" · 豁免 {len(allow)} 条")
    if bad:
        print(f"  ✗ 豁免表里有 {len(bad)} 条缺理由：{', '.join(bad)}")
        return 1
    if not errs:
        print("  ✓ 0 处：没有任何派生令牌被声明在依赖项的上一层级")
        return 0
    print(f"  ✗ {len(errs)} 处派生令牌被冻死（声明在 {', '.join(sorted({e['elem'] for e in errs}))} 层，依赖却在更深层被覆盖）：")
    for e in errs:
        print(f"    {e['at']}  [{e['sel']}]")
        print(f"      {e['token']}: {e['val'][:70]}")
        print(f"      而 {e['dep']} 在更深层被定义：{e['where']}")
    print("\n  修法：把该派生令牌的声明从该层移到 body（或更深），不要在 12 个主题块里逐个补。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
