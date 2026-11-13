#!/usr/bin/env python3
"""重算日程色块的文字档（dark / ink），并核对灰块（计划外）两档。

为什么要有这个工具：TB_PALETTE 的 solid / light 是计划的身份色，动不得；
但文字档如果手挑，人眼一定会挑到"看着还行"的 4.6:1 —— 正好卡在 AA 线上，
竖排粗体压在中灰底上就是一团。所以文字档一律由对比度反推：
   ink = 实色底（solid）上 ≥ 6:1
   dark = 浅底（light）上 ≥ 6:1
反推时保色相：在"等比压暗 / 向白提亮"这条单参数轴上二分，取**刚好达标**的那个点。

用法：
  python3 tools/palette_contrast.py            # 只报告（默认）
  python3 tools/palette_contrast.py --check    # 不达标就退出码 1（可挂 CI / verify）
  python3 tools/palette_contrast.py --rewrite  # 把算出的文字档写回 01eA_ui_timeblock.js
"""
import io
import re
import sys

ROOT = __file__.rsplit('/tools/', 1)[0]
JS = ROOT + '/src/scripts/01eA_ui_timeblock.js'
TARGET = 6.0

# 计划外灰块：底/字/描边（浅色与深色各一档），同样要求 >= TARGET
GRAY = [
    ('浅色', '#A8A6AE', '#2A292C', '#5C5B60'),
    ('深色', '#45444E', '#D6D5DD', '#86848F'),
]


def lum(h):
    h = h.lstrip('#')
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda v: v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def scale(hexs, k):
    hexs = hexs.lstrip('#')
    return '#' + ''.join('%02x' % round(int(hexs[i:i + 2], 16) * k) for i in (0, 2, 4))


def lift(hexs, k):
    hexs = hexs.lstrip('#')
    return '#' + ''.join('%02x' % round(int(hexs[i:i + 2], 16) + (255 - int(hexs[i:i + 2], 16)) * k)
                         for i in (0, 2, 4))


def fit(ink, bg, target=TARGET):
    """在"压暗/提亮"单参数轴上找**刚好达标**的点（保色相，不硬塞纯黑纯白）。"""
    fn = (lambda k: scale(ink, k)) if lum(bg) > lum(ink) else (lambda k: lift(ink, k))
    if ratio(fn(0.0), bg) < target:
        return fn(0.0), ratio(fn(0.0), bg)
    lo, hi = 0.0, 1.0          # lo 达标（改得多），hi 原值（可能不达标）
    for _ in range(40):
        mid = (lo + hi) / 2
        if ratio(fn(mid), bg) >= target:
            lo = mid
        else:
            hi = mid
    return fn(lo), ratio(fn(lo), bg)


def main():
    src = io.open(JS, encoding='utf-8').read()
    rows = re.findall(r"\{ key: '(\w+)',\s+solid: '(#\w+)', light: '(#\w+)', dark: '(#\w+)', ink: '(#\w+)' \}", src)
    if not rows:
        print('✗ 没在 01eA_ui_timeblock.js 里找到 TB_PALETTE')
        return 1
    bad = []
    out = []
    for key, solid, light, dark, ink in rows:
        ok_ink = ratio(ink, solid)
        ok_dark = ratio(dark, light)
        n_ink, _ = fit(ink, solid)
        n_dark, _ = fit(dark, light)
        out.append("{ key: '%s', solid: '%s', light: '%s', dark: '%s', ink: '%s' }," % (key, solid, light, n_dark, n_ink))
        flag = '' if (ok_ink >= TARGET and ok_dark >= TARGET) else '  ← 不达标'
        if flag:
            bad.append(key)
        print('%-10s 实际块 %.2f (%s → %s)  预计块 %.2f (%s → %s)%s'
              % (key, ok_ink, ink, n_ink, ok_dark, dark, n_dark, flag))
    print()
    for name, bg, fg, _bd in GRAY:
        r = ratio(fg, bg)
        print('计划外·%s %s 底 / %s 字 = %.2f%s' % (name, bg, fg, r, '' if r >= TARGET else '  ← 不达标'))
        if r < TARGET:
            bad.append('gray-' + name)
    print()
    if '--rewrite' in sys.argv:
        if not bad:
            print('已经全部达标，无需改写。')
        else:
            new = '\n'.join('    ' + l for l in out)
            start = src.index('const TB_PALETTE = [')
            end = src.index('];', start)
            src = src[:start] + 'const TB_PALETTE = [\n' + new + '\n  ];\n' + src[end + 3:]
            io.open(JS, 'w', encoding='utf-8').write(src)
            print('✓ 已写回 01eA_ui_timeblock.js，重跑 build.py')
    print('结果：%s（阈值 %.1f:1）' % ('全部达标' if not bad else '不达标 ' + ', '.join(bad), TARGET))
    return 1 if (bad and '--check' in sys.argv) else 0


if __name__ == '__main__':
    sys.exit(main())
