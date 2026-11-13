#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""主题令牌一致性门禁（静态 / 运行时两层）

为什么要有这一段
----------------
2026-10-25 品质升级时实测：12 个外观（6 主题 × 明暗）的边框值有 12 套写法，
深色块还全部漏写 `--border-strong`，回落到浅色值 → 深底上画了一道蓝灰线。
更麻烦的是，**静态扫 CSS 抓不到"级联导致的值不对"**：`50_journey.css` 是第 22 个
片段、`1A_dark_misc.css` 是第 13 个，同特异性下浅色主题块会盖掉深色值。
所以本脚本分两层：

  静态（默认，<0.1s，挂 verify.py）
    · 10 个主题块 + :root + body.dark-mode 都必须声明 --line-rgb
    · 主题块禁止声明结构类令牌（--border*/--hairline/--radius*/--shadow*/--sp-*/--fs-*/--fx-*）
    · 主题块禁止直接写 --border（必须由 body 派生）
    · 若出现 --primary-ink，则 12 处必须齐全

  运行时（--runtime，需 chromium，约 5s）
    · 真开浏览器遍历 12 外观，读 computed 值
    · 边框三个令牌：alpha 必须等于明色 .10/.22/.07、暗色 .12/.26/.08
    · 三个边框令牌的色相必须等于该外观的 --line-rgb
    · --radius / --radius-card / --shadow 12 外观必须逐字符相同

用法
  python3 tools/check_theme_tokens.py             # 静态
  python3 tools/check_theme_tokens.py --runtime   # 静态 + 运行时
退出码：0 通过 / 1 失败 / 3 环境不具备（无 chromium）
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_CSS = os.path.join(ROOT, "src/template/50_journey.css")
BASE_CSS = os.path.join(ROOT, "src/template/10_tokens.css")
DARK_CSS = os.path.join(ROOT, "src/template/1A_dark_misc.css")

THEMES = ["nord", "tokyo", "gruvbox", "rosepine", "catppuccin"]
LIGHT_ALPHA = {"--border": ".10", "--border-strong": ".22", "--hairline": ".07"}
DARK_ALPHA = {"--border": ".12", "--border-strong": ".26", "--hairline": ".08"}
STRUCT_FORBIDDEN = ("--border", "--hairline", "--radius", "--shadow", "--sp-", "--fs-", "--fx-")


def _blocks(text):
    """返回 [(selector, theme, body)]，匹配 body[data-theme=…] 与 body.dark-mode[data-theme=…]。"""
    out = []
    for m in re.finditer(r'(body(?:\.dark-mode)?\[data-theme="(\w+)"\])\s*\{(.*?)\n\}', text, re.S):
        out.append((m.group(1), m.group(2), m.group(3)))
    return out


def static_check():
    errs, notes = [], []
    theme_src = open(THEME_CSS, encoding="utf-8").read()
    blocks = _blocks(theme_src)
    if len(blocks) != 10:
        errs.append(f"主题块数量异常：期望 10（5 套 × 明暗），实际 {len(blocks)}")

    light_n = dark_n = 0
    for sel, name, body in blocks:
        keys = set(re.findall(r'(--[\w-]+)\s*:', body))
        is_dark = ".dark-mode" in sel
        if is_dark:
            dark_n += 1
        else:
            light_n += 1

        if "--line-rgb" not in keys:
            errs.append(f"{sel} 缺 --line-rgb（边框色相无处来源）")
        if is_dark and "--line-rgb" in body:
            v = re.search(r'--line-rgb\s*:\s*([^;]+);', body).group(1).strip()
            if v.replace(" ", "") != "255,255,255":
                errs.append(f"{sel} 的 --line-rgb 应为 255, 255, 255（深色统一白线），实际 {v}")

        bad = [k for k in keys if k.startswith(STRUCT_FORBIDDEN)]
        if bad:
            errs.append(f"{sel} 越权声明结构/派生令牌：{', '.join(sorted(bad))}（主题块只放颜色）")

    # 基础层
    base = open(BASE_CSS, encoding="utf-8").read()
    if "--line-rgb:" not in base:
        errs.append("10_tokens.css 的 :root 缺 --line-rgb")
    for t in ("--alpha-line:", "--alpha-line-strong:", "--alpha-hairline:"):
        if t not in base:
            errs.append(f"10_tokens.css 的 :root 缺 {t.rstrip(':')}")
    if not re.search(r'^body\s*\{[^}]*--border\s*:\s*rgba\(var\(--line-rgb', base, re.S | re.M):
        errs.append("10_tokens.css 的 body 缺 --border 派生（必须声明在 body，不能是 :root）")

    dark = open(DARK_CSS, encoding="utf-8").read()
    dm = re.search(r'body\.dark-mode\s*\{(.*?)\n\}', dark, re.S)
    if not dm:
        errs.append("1A_dark_misc.css 找不到 body.dark-mode 块")
    else:
        for t in ("--line-rgb:", "--alpha-line:", "--alpha-line-strong:", "--alpha-hairline:"):
            if t not in dm.group(1):
                errs.append(f"body.dark-mode 缺 {t.rstrip(':')}")

    # --primary-ink 一旦引入就必须 12 处齐全
    ink_total = open(BASE_CSS, encoding="utf-8").read().count("--primary-ink:") + theme_src.count("--primary-ink:")
    if ink_total:
        light_ink = sum(1 for _, b in [] if False)
        have_light = len([1 for sel, name, body in blocks if ".dark-mode" not in sel and "--primary-ink" in body])
        have_dark = len([1 for sel, name, body in blocks if ".dark-mode" in sel and "--primary-ink" in body])
        if have_light != 5 or have_dark != 5:
            errs.append(f"--primary-ink 覆盖不全：主题块 浅 {have_light}/5、深 {have_dark}/5（default 另在 :root / body.dark-mode）")
        if "--primary-ink:" not in base:
            errs.append("--primary-ink 已在主题块出现，但 :root 没有默认值")
        if "--primary-ink:" not in dark:
            errs.append("--primary-ink 已在主题块出现，但 body.dark-mode 没有默认值")

    notes.append(f"主题块 {light_n} 浅 + {dark_n} 深 = {len(blocks)} 个；结构越权与缺失共 {len(errs)} 处")
    return errs, notes


def runtime_check():
    """真开浏览器读 computed 值。抓的是静态扫不到的级联问题。"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("SKIP: 未安装 playwright", file=sys.stderr)
        sys.exit(3)

    import http.server
    import socketserver
    import threading
    import json

    public = os.path.join(ROOT, "public")
    if not os.path.isfile(os.path.join(public, "index.html")):
        print("✗ public/index.html 不存在，先跑 build.py", file=sys.stderr)
        return ["public/index.html 不存在"]

    os.chdir(public)
    class _Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = _Quiet
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    js = """
    (t) => {
      const b = document.body;
      if (t === 'default') b.removeAttribute('data-theme'); else b.setAttribute('data-theme', t);
      const cs = getComputedStyle(b), g = n => cs.getPropertyValue(n).trim();
      const parse = s => { const m = s.match(/[\\d.]+/g); return m ? m.map(Number) : null; };
      return {
        theme: t, dark: b.classList.contains('dark-mode'),
        line: g('--line-rgb'), border: g('--border'), strong: g('--border-strong'), hair: g('--hairline'),
        radius: g('--radius'), radiusCard: g('--radius-card'), shadow: g('--shadow'),
        ink: g('--primary-ink'), primary: g('--primary'), onPrimary: g('--on-primary'),
        start: g('--green-dark'), green: g('--green')
      };
    }
    """
    errs = []
    rows = []
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as e:
            print(f"SKIP: 起不来 chromium（{e}）", file=sys.stderr)
            sys.exit(3)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.goto(f"http://127.0.0.1:{port}/index.html", wait_until="networkidle")
        page.wait_for_timeout(1500)
        for dark in (False, True):
            if dark:
                page.evaluate("document.body.classList.add('dark-mode')")
            for t in ["default"] + THEMES:
                rows.append(page.evaluate(js, t))
        browser.close()
    httpd.shutdown()

    def alpha_of(rgba):
        m = re.search(r'rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)', rgba)
        return float(m.group(1)) if m else None

    # 结构令牌按「模式」分组比对：明暗的 --shadow 本来就不同（深色用纯黑），
    # 要比的是"同一模式内 6 套主题是否完全一致"。
    base = {}
    for r in rows:
        mode = "暗" if r["dark"] else "明"
        want = DARK_ALPHA if r["dark"] else LIGHT_ALPHA
        for key, tok in (("border", "--border"), ("strong", "--border-strong"), ("hair", "--hairline")):
            a = alpha_of(r[key])
            if a is None:
                errs.append(f"{r['theme']}/{mode} {tok} 不是 rgba：{r[key]}")
            elif abs(a - float(want[tok])) > 1e-6:
                errs.append(f"{r['theme']}/{mode} {tok} alpha={a}，应为 {want[tok]}")
        # 色相：边框前三个通道必须等于 --line-rgb
        line = [int(x) for x in r["line"].replace(" ", "").split(",")] if r["line"] else None
        if line:
            m = re.match(r'rgba\((\d+),\s*(\d+),\s*(\d+)', r["border"])
            if m and [int(m.group(i)) for i in (1, 2, 3)] != line:
                errs.append(f"{r['theme']}/{mode} 边框色相 {r['border']} ≠ --line-rgb {r['line']}（级联被覆盖）")
        key = (r["radius"], r["radiusCard"], r["shadow"])
        mk = "dark" if r["dark"] else "light"
        if mk not in base:
            base[mk] = (r["theme"], key)
        elif key != base[mk][1]:
            errs.append(f"{r['theme']}/{mode} 结构令牌与本模式基准（{base[mk][0]}）不一致：{key}")

    print("\n  12 外观运行时快照：")
    for r in rows:
        print(f"    {'暗' if r['dark'] else '明'} {r['theme']:11s} border={r['border']:26s} ink={r['ink'] or '—'}")
    return errs


def main():
    errs, notes = static_check()
    print("== 主题令牌门禁（静态） ==")
    for n in notes:
        print("  ·", n)

    if "--runtime" in sys.argv:
        print("== 主题令牌门禁（运行时） ==")
        errs += runtime_check()

    if errs:
        print(f"\n✗ 失败 {len(errs)} 项：")
        for e in errs:
            print("   -", e)
        return 1
    print("\n✓ 主题令牌一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())
