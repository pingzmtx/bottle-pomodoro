#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_css_tokens.py —— 颜色令牌棘轮门禁

为什么要有这一段
----------------
字号 / 圆角 / 间距三套令牌有 lint() 拦，颜色从来没有门禁：
AGENTS.md 第 9 条曾把颜色写成「刻意不收」，理由是"字面量 649 种 vs 变量 30 个，
属缺词汇，机器区分不了同色差下的不同性质，改动由人逐处判断"。
写 CSS 的换成人（或 agent）之后，"逐处判断"这一环不存在了 —— 豁免等于无防线。
本工具不改色、不猜语义，只做一件事：把每个文件当前的裸色值数量冻结成基线，
**只准降，不准升**。新增一处裸色值 = 红灯，要么换成令牌，要么显式调高基线并说明理由。

统计口径（三条，互不混用；同一份代码上都能复算）
------------------------------------------------
口径 A「全量裸 hex」：文件原文里所有 #rgb/#rrggbb，含注释、属性选择器、主题块。
    复算：python3 tools/check_css_tokens.py --raw
    2026-11-14 实测 = 1052（15 个分片）。这个数字**不是**门禁判据，
    它会把注释里提到色值的句子也算进去（12_components.css 71 处里 71 处都在注释里）。

口径 B「组件规则内颜色字面量」= 本门禁的判据：
    1. 只看 src/template/*.css 的 15 个真源分片（不看 template.html，那是拼装产物，会重复计数）
    2. 只数**声明值**里的字面量；注释、选择器（如 [style*="#fff"]）里的不算
    3. 主题块（选择器完全等于 :root / html / body.dark-mode / body[data-skin…] / [data-skin…]）
       里的 `--token: 色值` 定义不算 —— 那是配色词汇表本身，12 外观各一套，本来就该是字面量
    4. `rgba(var(--x-rgb), a)` 这类令牌派生不算（它根本没有 hex）；数字型 rgb()/rgba()
       **算**违规，因为 rgba(0,0,0,.45) 不会跟随主题翻转
    5. hex 与数字型 rgb()/rgba() 分开计数，分别进基线（两者修复难度不同，混在一起会互相掩护）
    2026-11-14 实测 = hex 321 + rgb 252 = 573。

口径 C「文档里的 359」：**不可复现，已作废**。
    最接近的复现是"整块跳过含 :root/dark-mode/data-skin 的选择器"，得 383，
    其中 6 个文件的数字与文档表格逐个相同（15_tree 75 / 19_immersive 60 /
    14_log_stats 31 / 17_rank_team 17 / 13_plan 16 / 16_timeblock 12），
    但 1A_dark_misc 得 103（文档 98）、11_layout_timer 得 38（文档 22），
    且文档表未列 18_settings / 12_components / 50_journey（合计 31）。
    该判据还会把 `body.dark-mode .xxx` 整块豁免 —— 深色覆盖正是要收的东西，
    方向反了，所以不采用、也不为凑 359 调参。

退出码：0 = 不超基线；1 = 有文件超基线（或出现未登记的 CSS 分片）。
用法:
    python3 tools/check_css_tokens.py            # 门禁：与基线比对
    python3 tools/check_css_tokens.py --update   # 按当前值重写基线（只允许在数字变小时用）
    python3 tools/check_css_tokens.py --raw      # 只打印口径 A，供复核
    python3 tools/check_css_tokens.py --stats    # 口径 B 的分组统计（只读），P1/P2/P3 目标从这来
    python3 tools/check_css_tokens.py --limit 50 # 失败时最多列多少行（默认 30）
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_DIR = os.path.join(ROOT, "src", "template")
BASELINE = os.path.join(ROOT, "src", "css_token_baseline.json")

HEX = re.compile(r"(?<![\w&])#([0-9a-fA-F]{3,8})(?![\w-])")
RGB_NUM = re.compile(r"\brgba?\(\s*[\d.][^)]*\)")
# 函数式颜色：hsl/hwb/lab/lch/oklch/oklab/color()。2026-11-14 补。
# 之前只认 hex 与数字型 rgb()，`color: hsl(210 60% 80%)` 可以整句放行 —— 等于留了
# 一个「换个函数名就没人管」的后门。它们和数字型 rgb 同性质：写死色相，不跟主题翻转。
FUNC = re.compile(r"\b(?:hsla?|hwb|oklch|oklab|lab|lch|color)\([^)]*\)")
# 「令牌定义区」选择器：只有整块选择器都落在这些形态里，--x: 色值 才算词汇表。
# ★ 2026-11-14 补三处缺口（修洞 A 时暴露出来的，一直存在）：
#   - data-theme：50_journey.css 的 10 个皮肤块写成 body[data-theme="nord"]，
#     原来的 data-skin 一个都匹配不上 → 皮肤块里的令牌定义本来就没被识别；
#     只是改前它们被洞 A 顺带跳过，看不出来。补上后 510 处回归词汇表。
#   - 组合形态：`body.dark-mode[data-theme="nord"]`（每个皮肤的深色版）——
#     枚举写法的通病是漏组合，所以这里改成"由已知片段拼成"的结构式判断。
#   - body：--fill-primary / --on-fill / --border 这些派生令牌刻意写在 body
#     （见 10_tokens.css 注释「写在 :root 会被冻死，深色模式翻不过来」），
#     它和 :root 同性质，只是多一层主题翻转。
THEME_PART = re.compile(
    r"^(?:"
    r":root"
    r"|(?:html|body)(?:\.dark-mode)?(?:\[(?:data-skin|data-theme)[^\]]*\])*"
    r"|\[(?:data-skin|data-theme)[^\]]*\]"
    r")$"
)


def normalize(h):
    """#abc → #aabbcc；统一小写，便于与令牌值比对。"""
    h = h.lower()
    if len(h) == 4:
        return "#" + "".join(ch * 2 for ch in h[1:])
    return h


def strip_noise(src):
    """去掉 <style> 外壳与注释（注释里的色值不算使用）。

    分片真源以 <style data-page-node-id=…> 开头，是页面节点的外壳；
    去掉后第一个选择器才是 :root，否则选择器文本会被前缀污染、主题块识别失效。
    """
    src = re.sub(r"<style[^>]*>|</style>", "", src)
    return re.sub(
        r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), src, flags=re.S
    )


def parse(src):
    """返回 (违规列表, 令牌表)。

    违规项：(行号, 值, 类别 hex|rgb|func, 属性名, 最内层选择器)
    令牌表：{归一化色值: [令牌名…]}，只收主题块里的 --token 定义。
    """
    src = strip_noise(src)
    stack = []          # 每层块的 (选择器, is_theme)
    buf = []
    line = 1
    decl_line = 1       # 当前声明第一个非空字符所在行（定位用）
    bad = []
    tokens = {}
    i, n = 0, len(src)
    while i < n:
        ch = src[i]
        if ch == "\n":
            line += 1
        if ch == "{":
            sel = "".join(buf).strip()
            parts = [p.strip() for p in sel.split(",")]
            is_theme = bool(parts) and all(THEME_PART.match(p) for p in parts)
            stack.append((sel, is_theme))
            buf = []
            i += 1
            continue
        if ch in "};":
            decl = "".join(buf)
            if decl.strip() and ":" in decl and "{" not in decl:
                prop, val = decl.split(":", 1)
                prop = prop.strip().split()[-1] if prop.strip() else ""
                # 主题块里的令牌定义 = 配色词汇表，不算违规
                in_theme = bool(stack) and stack[-1][1]
                leaf = stack[-1][0] if stack else ""
                if prop.startswith("--") and in_theme:
                    for m in HEX.finditer(val):
                        tokens.setdefault(normalize(m.group(0)), []).append(prop)
                else:
                    # ★ 2026-11-14 补洞 A：主题块**之外**的 --x: <色值> 同样计入违规。
                    # 原实现里「--x 且不在主题块」两个分支都不进 → 整条声明被静默跳过，
                    # 于是 `.p { --tmp-c: #abcdef; color: var(--tmp-c) }` 能完全洗白一处颜色。
                    # 局部自定义属性不是词汇表，它只是把裸色值换了个位置存放。
                    for m in HEX.finditer(val):
                        bad.append((decl_line + val[: m.start()].count("\n"),
                                    normalize(m.group(0)), "hex", prop, leaf))
                    for m in RGB_NUM.finditer(val):
                        # 保留原样（只压连续空白）：re.sub(r"\s+","") 会把
                        # rgb(171 205 239) 拼成 rgb(171205239)，报错信息会误导人。
                        bad.append((decl_line + val[: m.start()].count("\n"),
                                    re.sub(r"\s+", " ", m.group(0)).strip(), "rgb", prop, leaf))
                    for m in FUNC.finditer(val):
                        bad.append((decl_line + val[: m.start()].count("\n"),
                                    re.sub(r"\s+", " ", m.group(0)).strip(), "func", prop, leaf))
            if ch == "}":
                if stack:
                    stack.pop()
            buf = []
            i += 1
            continue
        if not "".join(buf).strip():
            decl_line = line
        buf.append(ch)
        i += 1
    return bad, tokens


def scan_file(path):
    src = open(path, encoding="utf-8").read()
    bad, tokens = parse(src)
    return {
        "hex": sum(1 for b in bad if b[2] == "hex"),
        "rgb": sum(1 for b in bad if b[2] == "rgb"),
        "func": sum(1 for b in bad if b[2] == "func"),
        "items": bad,
        "tokens": tokens,
    }


def rgb_of(h):
    h = normalize(h)
    if len(h) == 7:
        return tuple(int(h[i: i + 2], 16) for i in (1, 3, 5))
    return None


def suggest(value, kind, tokens):
    """给出一句可执行建议：同值令牌 > 近似令牌 > 明确说没有。"""
    if kind == "rgb":
        return "无同值令牌（数字型 rgb 无法随主题翻转，应改写为 rgba(var(--x-rgb), a)）"
    if kind == "func":
        return "无同值令牌（函数式颜色不跟主题翻转，换算成 hex 后并入令牌）"
    v = rgb_of(value)
    if value in tokens:
        return "→ var(%s)" % tokens[value][0]
    if v is None:
        return "→ 无同值令牌"
    best = None
    for tok, names in tokens.items():
        t = rgb_of(tok)
        if not t:
            continue
        d = sum((a - b) ** 2 for a, b in zip(v, t)) ** 0.5
        if best is None or d < best[0]:
            best = (d, names[0])
    if best and best[0] <= 12:
        return "≈ var(%s)（近似，ΔRGB=%.0f，需人工确认）" % (best[1], best[0])
    return "无同值/近似令牌（属缺词汇，P1/P2 补令牌后再换）"



def _is_neutral(val, kind):
    """灰阶判定：RGB 三通道最大最小差 ≤10。中性色的收敛由 P1 统一处理。"""
    if kind == "hex":
        t = rgb_of(val)
        return bool(t) and max(t) - min(t) <= 10
    if kind == "rgb":
        nums = re.findall(r"[\d.]+", val)
        if len(nums) >= 3:
            t = tuple(int(float(x)) for x in nums[:3])
            return max(t) - min(t) <= 10
    return False


def _bucket(sel):
    """场景分组（互斥，优先级 scene > im > dark > plain）。

    为什么按选择器分组：P1/P2/P3 三个阶段的削减对象不同，
    只有分组互斥，三段的"削减量"才能直接相加、目标值才对得上账。
    """
    low = (sel or "").lower()
    if "scene-" in low:
        return "scene"
    if re.search(r"\bim-|immersive|imlive", low):
        return "im"
    if ".dark-mode" in low:
        return "dark"
    return "plain"


def stats(cur):
    """口径 B 的分组统计（只读）。文档里的目标值都从这里复算。"""
    rows = []
    for name, r in cur.items():
        for line, val, kind, prop, sel in r["items"]:
            rows.append((name, line, val, kind, prop, sel))

    nh = sum(1 for r in rows if r[3] == "hex")
    nr = sum(1 for r in rows if r[3] == "rgb")
    nf = sum(1 for r in rows if r[3] == "func")
    dh = len({r[2] for r in rows if r[3] == "hex"})
    dr = len({r[2] for r in rows if r[3] == "rgb"})
    neu = [r for r in rows if _is_neutral(r[2], r[3])]
    grp = {}
    for r in rows:
        b = _bucket(r[5])
        k = "neutral" if _is_neutral(r[2], r[3]) else "color"
        grp.setdefault(b, {"color": 0, "neutral": 0})[k] += 1
    dark = [r for r in rows if ".dark-mode" in (r[5] or "")]
    dark_rules = len({(r[0], r[5]) for r in dark})

    print("=== 口径 B 分组统计（只读，不影响门禁）===")
    print("总计          : %d 处 = hex %d + rgb %d + func %d" % (nh + nr + nf, nh, nr, nf))
    print("不同颜色数    : hex %d 种 + rgb %d 种 = %d 种" % (dh, dr, dh + dr))
    print("中性（灰阶）  : %d 处（hex %d / rgb %d）"
          % (len(neu), sum(1 for r in neu if r[3] == "hex"),
             sum(1 for r in neu if r[3] == "rgb")))
    print("按场景分组（互斥，scene > im > dark > plain）：")
    for b in ("plain", "dark", "im", "scene"):
        g = grp.get(b, {"color": 0, "neutral": 0})
        print("  %-6s 彩色 %4d · 中性 %4d" % (b, g["color"], g["neutral"]))
    one = {k: v for k, v in cur.items() if k == "1A_dark_misc.css"}
    if one:
        r = list(one.values())[0]
        nn = sum(1 for it in r["items"] if _is_neutral(it[1], it[2]))
        ns = sum(1 for it in r["items"] if _bucket(it[4]) in ("scene", "im"))
        print("1A_dark_misc  : %d 处（其中中性 %d、场景/沉浸 %d）"
              % (r["hex"] + r["rgb"] + r["func"], nn, ns))
    print("深色覆盖      : .dark-mode 规则内 %d 处 / 涉及 %d 条规则（文件+选择器去重）"
          % (len(dark), dark_rules))
    print()
    print("P1/P2/P3 目标复算：P1 清中性 → %d；P2 再清 scene+im 彩色 %d → %d"
          % (len(rows) - len(neu),
             grp.get("scene", {"color": 0})["color"] + grp.get("im", {"color": 0})["color"],
             len(rows) - len(neu)
             - grp.get("scene", {"color": 0})["color"]
             - grp.get("im", {"color": 0})["color"]))
    return 0


def all_files():
    return sorted(glob.glob(os.path.join(CSS_DIR, "*.css")))


def measure():
    """返回 ({文件: 结果}, 全局令牌表)。

    令牌表要跨文件合并：--card 这类核心令牌定义在 10_tokens.css，
    而违规发生在 13_plan.css —— 只查本文件会得出"没有同值令牌"的错误建议。
    """
    out, tokens = {}, {}
    for f in all_files():
        r = scan_file(f)
        out[os.path.basename(f)] = r
        for k, names in r["tokens"].items():
            tokens.setdefault(k, names)
    return out, tokens


def main():
    argv = sys.argv[1:]
    limit = 30
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])

    if "--raw" in argv:
        total = 0
        for f in all_files():
            c = len(HEX.findall(open(f, encoding="utf-8").read()))
            total += c
            print("%-26s %4d" % (os.path.basename(f), c))
        print("口径 A（全量裸 hex，含注释/选择器/主题块）= %d" % total)
        return 0

    cur, tokens = measure()
    if "--stats" in argv:
        return stats(cur)
    if "--update" in argv:
        data = {k: {"hex": v["hex"], "rgb": v["rgb"], "func": v["func"]}
                for k, v in sorted(cur.items())}
        with open(BASELINE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("已写基线 %s" % os.path.relpath(BASELINE, ROOT))
        for k, v in data.items():
            print("  %-26s hex=%-4d rgb=%-4d func=%d"
                  % (k, v["hex"], v["rgb"], v["func"]))
        return 0

    if not os.path.isfile(BASELINE):
        print("✗ 基线不存在：%s" % os.path.relpath(BASELINE, ROOT))
        print("  首次建立：python3 tools/check_css_tokens.py --update")
        return 1
    base = json.load(open(BASELINE, encoding="utf-8"))

    over, improved, newfile, shown = [], [], [], 0
    for name, v in sorted(cur.items()):
        b = base.get(name)
        if b is None:
            newfile.append(name)
            continue
        dh, dr = v["hex"] - b.get("hex", 0), v["rgb"] - b.get("rgb", 0)
        df = v["func"] - b.get("func", 0)
        if dh > 0 or dr > 0 or df > 0:
            over.append((name, dh, dr, df, b, v))
        elif dh < 0 or dr < 0 or df < 0:
            improved.append((name, dh, dr, df))

    th = sum(v["hex"] for v in cur.values())
    tr = sum(v["rgb"] for v in cur.values())
    tf = sum(v["func"] for v in cur.values())
    bh = sum(v.get("hex", 0) for v in base.values())
    br = sum(v.get("rgb", 0) for v in base.values())
    bf = sum(v.get("func", 0) for v in base.values())
    print("=== 颜色令牌门禁（口径 B：组件规则内颜色字面量）===")
    print("当前合计 : hex %d · rgb %d · func %d · 共 %d" % (th, tr, tf, th + tr + tf))
    print("基线合计 : hex %d · rgb %d · func %d · 共 %d" % (bh, br, bf, bh + br + bf))

    if not over and not newfile:
        if improved:
            print("✅ 不超基线；另有 %d 个文件低于基线（可下调）：" % len(improved))
            for name, dh, dr, df in improved:
                print("   %-26s hex %+d · rgb %+d · func %+d" % (name, dh, dr, df))
            print("   下调：python3 tools/check_css_tokens.py --update")
        print("✅ 通过：%d 个分片，无新增裸色值。" % len(cur))
        return 0

    if newfile:
        print("✗ 有未登记基线的 CSS 分片（新增分片必须先跑 --update 入库）：")
        for name in newfile:
            print("   %s" % name)
    print("注：同值令牌 ≠ 同义（#fff 可能是 --card / --white / --on-primary），按语义选。")
    for name, dh, dr, df, b, v in over:
        print("✗ %s：hex %d → %d（%+d）· rgb %d → %d（%+d）· func %d → %d（%+d）"
              % (name, b.get("hex", 0), v["hex"], dh,
                 b.get("rgb", 0), v["rgb"], dr,
                 b.get("func", 0), v["func"], df))
        # 逐处定位：同一源码行合并成一条，避免一行写 5 个色值就刷 5 行
        by_line = {}
        for line, val, kind, prop, _sel in v["items"]:
            by_line.setdefault(line, []).append((val, kind, prop))
        shown = 0
        for line in sorted(by_line):
            if shown >= limit:
                print("   …（达到 --limit %d，其余略）" % limit)
                break
            parts = []
            for val, kind, prop in by_line[line]:
                parts.append("%s [%s] %s" % (val, prop, suggest(val, kind, tokens)))
            print("   src/template/%s:%d" % (name, line))
            for t in parts:
                print("       %s" % t)
            shown += 1
        print("   修法：换成建议令牌；确属新词汇 → 先补令牌，或调高基线并在改动说明里写明理由")
    print("✗ 失败：%d 个分片超基线 · %d 个未登记" % (len(over), len(newfile)))
    return 1


if __name__ == "__main__":
    sys.exit(main())
