#!/usr/bin/env python3
"""把「得意黑」标题字体裁到**它真正渲染的那几个字**。

—— 为什么单独裁它（2026-10-27）

正文的霞鹜文楷不能裁到「站点文案」为止：用户会在任务名、笔记、日记里输入
任意汉字，切出去的字就永远掉回系统黑体。所以文楷保留 GB2312 全集，只在
首屏块/备用块之间分层。

标题字体不一样：它只用于 `.empty-title`（空状态标题），而空状态标题全是
我们自己写死的固定文案 ——「还没有可回顾的记录」「今天没有要做的周期任务」
这类。数了数，所有空状态标题加起来 52 个不同字符。

结果：275388 B → 约 6000 B。省下的 269 KB 比任何缓存技巧都实在。

—— 母本放在 tools/fonts/src/

不能把母本留在 web/fonts/：build.py 会把 web/fonts/ 整个复制进 public/，
母本会跟着上线，275 KB 白搭。工具目录不进产物。

—— 加字了怎么办

改文案后重跑本脚本即可。所需字符若超出母本覆盖范围，脚本会**报错退出**
而不是静默缺字 —— 缺字的症状是「某个空状态标题突然变黑体」，很难想到是字体包。

    python3 tools/fonts/make_title_font.py
"""
import argparse
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# 出现 `empty-title` 的源文件（加新的空状态标题时，只要用了这个 class 就自动收录）
SCAN_DIRS = [os.path.join(ROOT, "src", "scripts")]
# 标题里会拼进来的动态片段：日期（2026-10-27）、序号、百分比、省略号
ALWAYS = "0123456789.:-/%×·…、，。！？（）()「」『』— "


def collect_text():
    """抓所有 `class="empty-title">文案` 里的文案。"""
    pat = re.compile(r'empty-title">([^<]*)')
    texts = []
    for base in SCAN_DIRS:
        for root, _dirs, files in os.walk(base):
            for name in files:
                if not name.endswith(".js"):
                    continue
                path = os.path.join(root, name)
                src = open(path, encoding="utf-8").read()
                for m in pat.finditer(src):
                    texts.append(m.group(1))
    return texts


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=os.path.join(HERE, "src", "smiley-sans-full.woff2"),
                    help="得意黑母本（站点字符子集即可，但不能小于标题用字）")
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "fonts", "smiley-title.woff2"))
    ap.add_argument("--css", default=os.path.join(ROOT, "src", "template", "01b_font_title.css"))
    args = ap.parse_args()

    if not os.path.exists(args.src):
        sys.exit("✗ 找不到母本 %s\n  从 https://github.com/atelier-anchor/smiley-sans 取一个"
                 "覆盖站点字符的 woff2 放到 tools/fonts/src/smiley-sans-full.woff2" % args.src)

    texts = collect_text()
    if not texts:
        sys.exit("✗ 没抓到任何 empty-title 文案 —— 选择器改名了？改 SCAN_DIRS / 正则再跑")

    # 必须覆盖的 = 文案里出现的字。ALWAYS 只是「可能用到的动态字符」，母本没就跳过 ——
    # 硬要求它反而会让脚本因为一个永远不会出现的全角引号而罢工。
    must = {c for c in set("".join(texts)) if c.strip()}
    optional = {c for c in set(ALWAYS) if c.strip()}

    f = TTFont(args.src)
    cmap = set(f.getBestCmap().keys())
    f.close()

    missing = sorted(c for c in must if ord(c) not in cmap)
    if missing:
        sys.exit("✗ 母本缺这些字：%s\n  换一个更全的母本，或别在空状态标题里用它们"
                 % "".join(missing))

    chars = must | {c for c in optional if ord(c) in cmap}
    payload = "".join(sorted(chars))
    subset.main([args.src, "--text=" + payload, "--flavor=woff2", "--layout-features=",
                 "--no-hinting", "--output-file=" + args.out])
    size = os.path.getsize(args.out)
    print("标题字体（得意黑）")
    print("  %d 个字符 ← %d 条空状态标题" % (len(chars), len(texts)))
    for t in texts:
        print("    · %s" % t.strip())
    print("  %-28s %8d B" % (os.path.basename(args.out), size))

    css = """/* ============================================================================
   ★ 这是生成物，不要手改。生成器：tools/fonts/make_title_font.py
   得意黑只用于 `.empty-title`（空状态标题），那些文案全是站点自己写死的，
   所以可以裁到只剩它们用到的 %d 个字符 —— 275 KB 就是这么降到 %d KB 的。
   正文不能这么裁：用户会在任务名/笔记里输入任意汉字（见 01b_font_wenkai.css）。
   加新文案后重跑生成器；用字超出母本时它会报错，不会静默掉字。
   ============================================================================ */
@font-face {
  font-family: 'SmileySans';
  src: url('../fonts/%s') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
""" % (len(chars), max(1, round(size / 1024)), os.path.basename(args.out))
    open(args.css, "w", encoding="utf-8").write(css)
    print("  →", os.path.relpath(args.css, ROOT))


if __name__ == "__main__":
    main()
