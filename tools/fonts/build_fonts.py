#!/usr/bin/env python3
"""字体子集生成：从全量字体裁出本站用的 woff2，并按 unicode-range 拆成两块。

为什么需要这个脚本
------------------
中文字体一个字形就是一条轮廓，全字库 10 MB 起，不能原样发。所以要裁剪。
但**裁得太狠会出问题**：第一版只按站点的静态文案裁（2049 个汉字），
结果用户往日记/计划/备忘里打一个文案里没出现过的字，浏览器就掉回系统黑体 ——
一行楷体里夹几个黑体字，比全用黑体还难看。裁剪的边界不能是"网站上有什么字"，
必须是"用户可能打出什么字"。

为什么又要拆成两块
------------------
补成 GB2312 全集之后覆盖够了，但**首屏要背 1.55 MB**。实测线上这条链路
`fonts/wenkai-regular.woff2` 要 35–56 秒（同期 app.js 走 gzip 只要 1.6 秒，
因为 woff2 本身已是压缩格式，没法再压）。表现就是「刷新变慢」，
以及字体永远下不完 —— 看上去像「没有字体」。

所以按 unicode-range 拆成两个 @font-face，同属 'WenKai' 家族：
  · wenkai-regular.woff2  站点静态字符（2049 汉字 + 符号）≈ 476 KB  ← 首屏必下
  · wenkai-extra.woff2    GB2312 里站点没用到的那部分          ≈ 1.0 MB ← 用到才下
浏览器只下载「页面上真的出现了的字」所属的那一块。日常界面只碰第一块；
用户哪天在日记里打了个生僻字，第二块才被拉一次，之后就一直在缓存里。
两块必须**各带一份精确的 unicode-range 且互不重叠**，否则浏览器会把两块都当成
「可能用得上」一起下 —— 那就白拆了。

重新生成
--------
    python3 tools/fonts/build_fonts.py --src <全量 TTF 或 woff2>

  --src 可以直接给现在的 web/fonts/wenkai-regular.woff2（它已是 GB2312 全集），
  脚本按字符集重新切分，不需要再去找原版 TTF。要加 GB2312 之外的字才需要原版 TTF。

  产物：web/fonts/*.woff2 + src/template/01b_font_wenkai.css（生成物，勿手改）

上游字体（都是 SIL OFL 协议）：
· 霞鹜文楷 LXGW WenKai   https://github.com/lxgw/LxgwWenKai
· 得意黑 Smiley Sans     https://github.com/atelier-anchor/smiley-sans
· Inter                  https://github.com/rsms/inter
"""

import argparse
import os
import sys

CSS_PATH = "src/template/01b_font_wenkai.css"


def gb2312_hanzi(levels=(1, 2)):
    """GB2312 一级（16-55 区，3755 常用）+ 二级（56-87 区，3008 次常用）。

    一级覆盖日常书写约 99.7%，二级是生僻人名地名用字。两块都进 extra，
    因为它只在真用到时才下载，多覆盖不花首屏的钱。"""
    hi_range = []
    if 1 in levels:
        hi_range.append((0xB0, 0xD8))
    if 2 in levels:
        hi_range.append((0xD8, 0xF8))
    out = []
    for lo_hi, hi_hi in hi_range:
        for hi in range(lo_hi, hi_hi):
            for lo in range(0xA1, 0xFF):
                try:
                    c = bytes([hi, lo]).decode("gb2312")
                except UnicodeDecodeError:
                    continue
                if "\u4e00" <= c <= "\u9fff":
                    out.append(c)
    return "".join(out)


# 站点静态文案用到的非汉字字符（标点、符号等）。
# 汉字部分由 charset.txt 覆盖，这里只补它里面没有的符号。
EXTRA_SYMBOLS = (
    "!\"#$%&'()*+,-./0123456789:;<=>?@"
    "[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
    "§©«±·»×–—“”…‹›※ⅠⅡⅢ←↑→↓↗↩↻−∞≈≤≥⋮⋯"
    "⏩⏭⏮⏰⏱⏳⏸⏹①②③ⓘ└═▣▲▴▶▸▼▾◀◉○●◦⨯⬆⬜⭐　、。"
    "《》「」『』【】〈〉〔〕·‐‑‒―′″々〆〇"
)


def subset(src, out_path, chars):
    """裁一个字集，返回实际写出的字节数。"""
    from fontTools import subset as ft_subset

    args = [
        src,
        "--text=" + chars,
        "--flavor=woff2",
        "--layout-features=",
        "--no-hinting",
        "--desubroutinize",
        "--output-file=" + out_path,
    ]
    devnull = open(os.devnull, "w")
    old = sys.stderr
    sys.stderr = devnull
    try:
        ft_subset.main(args)
    finally:
        sys.stderr = old
        devnull.close()
    return os.path.getsize(out_path)


def cmap_chars(path):
    """读回 woff2 里实际画了的字符。字体缺字时 unicodes 里会有、cmap 里没有，
    以 cmap 为准，否则 unicode-range 会声称覆盖了其实没画的字。"""
    from fontTools.ttLib import TTFont

    f = TTFont(path)
    try:
        return set(f.getBestCmap().keys())
    finally:
        f.close()


def to_unicode_range(codes, width=100):
    """把码位集合压成 CSS unicode-range（连续码位合并成区间，再按宽度折行）。"""
    ranges = []
    codes = sorted(codes)
    i = 0
    n = len(codes)
    while i < n:
        start = end = codes[i]
        while i + 1 < n and codes[i + 1] == end + 1:
            i += 1
            end = codes[i]
        ranges.append("U+%04X" % start if start == end else "U+%04X-%04X" % (start, end))
        i += 1
    lines, cur = [], ""
    for r in ranges:
        if cur and len(cur) + len(r) + 1 > width:
            lines.append(cur)
            cur = ""
        cur += r + ","
    if cur:
        lines.append(cur)
    return "\n    ".join(lines).rstrip(",")


CSS_HEAD = """/* ============================================================================
   ★ 这是生成物，不要手改。改字体见 tools/fonts/build_fonts.py。
   霞鹜文楷拆成两个**独立的字体家族**：
     · WenKai      站点用到的字（首屏必下，488 KB）—— 正文主字体
     · WenKaiExtra GB2312 里站点没用到的其余字（1.15 MB）—— 字体栈里的后备
   ★ 为什么是**后备家族 + 精确 unicode-range**这个组合：
     正交写法是同一个 family 挂两段互不重叠的 unicode-range，让浏览器只下用得
     到的部分 —— 实测这个内核（本机 WebView + 桌面 Chromium）对「第二段」不自动
     取用：页面出现对应汉字时 document.fonts 里它一直是 unloaded，字掉回黑体。
     改成独立家族后就吃标准 fallback 匹配，缺字才会轮到它。
     但**光靠 fallback 不够**：没有 unicode-range 时浏览器无从知道某字在不在包里，
     页面上的 emoji（主字体和它都没有）就会让它白下 1.15 MB —— 实测首屏确实下了。
     所以两份都要：家族名让 fallback 生效，unicode-range 让浏览器能跳过。
   设计理由写在 src/template/01_fonts.css 的注释里。
   ============================================================================ */
"""


def face_block(name, family, ranges=None):
    rng = ""
    if ranges:
        rng = "  unicode-range:\n    %s;\n" % ranges
    return (
        "@font-face {\n"
        "  font-family: '%s';\n"
        "  src: url('../fonts/%s') format('woff2');\n"
        "  font-weight: 400;\n"
        "  font-style: normal;\n"
        "  font-display: swap;\n"
        "  size-adjust: 104%%;\n"
        "%s"
        "}\n" % (family, name, rng)
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="WenKai 全量 TTF / woff2（可以是现有的 GB2312 全集）")
    ap.add_argument("--out", default="web/fonts", help="输出目录（默认 web/fonts）")
    ap.add_argument("--css", default=CSS_PATH, help="生成的 @font-face 片段（默认 %s）" % CSS_PATH)
    ap.add_argument("--charset", default="tools/fonts/charset.txt", help="站点静态字符集文件")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)

    site = ""
    if os.path.exists(args.charset):
        site = open(args.charset, encoding="utf-8").read()
    else:
        print("! 找不到 %s，站点文案会缺字（全部落进 extra）" % args.charset)

    front = "".join(sorted(set(site + EXTRA_SYMBOLS) - set("\x00")))
    gb_all = set(gb2312_hanzi())
    extra = "".join(sorted(gb_all - set(front)))
    print("生成字体子集 →", args.out)
    print("  首屏块 %d 字符 · 备用块 %d 字符" % (len(front), len(extra)))

    p_front = os.path.join(args.out, "wenkai-regular.woff2")
    p_extra = os.path.join(args.out, "wenkai-extra.woff2")
    s1 = subset(args.src, p_front, front)
    s2 = subset(args.src, p_extra, extra)
    print("  %-28s %8d B" % ("wenkai-regular.woff2", s1))
    print("  %-28s %8d B" % ("wenkai-extra.woff2", s2))

    front_cmap = cmap_chars(p_front)
    extra_cmap = cmap_chars(p_extra)
    # 给页面脚本一个「只在备用块里」的样字：document.fonts.load() 必须带具体字符，
    # 不带字符时它只按空格判断，而空格属首屏块 → 永远判定「不需要」、备用块永不下载。
    # 由构建产出而不是在脚本里写死，是为了将来换字体/改文案时样字自动跟着变。
    sample = "".join(chr(c) for c in sorted(extra_cmap - front_cmap) if 0x4E00 <= c <= 0x9FFF)[:6]
    css = (CSS_HEAD
           + face_block("wenkai-regular.woff2", "WenKai", to_unicode_range(front_cmap))
           + face_block("wenkai-extra.woff2", "WenKaiExtra", to_unicode_range(extra_cmap))
           + "\n/* 备用块里的样字，页面脚本用它触发 document.fonts.load() */\n"
           + ":root { --font-extra-sample: \"%s\"; }\n" % sample)
    with open(args.css, "w", encoding="utf-8") as f:
        f.write(css)
    print("  %-28s %8d B" % (os.path.basename(args.css), len(css.encode("utf-8"))))
    print("\n完成。记得跑 python3 tools/build.py（字体复制进 public/ 并写进 STATIC_ASSETS）。")


if __name__ == "__main__":
    main()
