#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""分组拆模块实验：按 core / base / engine / app 四组产出真模块，import 自动生成。

用法:
    python3 tools/group_split.py --out /tmp/pz-groups
    python3 -m http.server 8850 --directory /tmp/pz-groups
    python3 tools/run_smoke.py --html http://127.0.0.1:8850/index.html

背景:
    tools/build.py 现在是"一个模块 + 从 core 拆出去"。本工具验证下一档：
    按依赖方向切成 4 个模块，组间只靠生成的 import 连接。
    能切的前提是引擎层对 UI 的引用已全部走 UIFX 门面（2026-10-23 已做完）。

注意:
    · 加载顺序取 template 里 <script> 标记的实际顺序（slot 9 的 00_pure_core 最先），
      不是 manifest 的槽号顺序。
    · 扫描"组内用到的外部名字"前会剥掉注释与字符串字面量 —— 只在注释里出现的名字
      不能生成 import，否则 engine→app 会造出循环。
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
SCRIPTS = os.path.join(SRC, "scripts")
TPL = os.path.join(SRC, "template.html")

GROUPS = [
    ("core", ["00_pure_core.js"]),
    ("base", ["00_delegate.js", "01z_ui_facade.js"]),
    ("engine", ["01a_engine_prelude.js", "01b1_storage.js", "01b_engine_data.js",
                "01b2_achievements.js", "01c_engine_timer.js", "01d_engine_features.js",
                "01d7_engine_record_link.js", "01d8_engine_plan_analysis.js",
                "01d9_engine_tree_rank.js", "01dA_engine_rank_schedule.js",
                "01dB_engine_day_rollover.js", "01dC_engine_task_exchange.js",
                "01d2_engine_rank_bot.js", "01d3_engine_tree_shop.js", "01d4_engine_team.js",
                "01d5_engine_stats.js", "01d6_engine_util.js"]),
]
GROUP_OF = {f: g for g, fs in GROUPS for f in fs}


def load_order():
    """template 里占位标记的顺序 = 真实加载顺序。"""
    tpl = open(TPL, encoding="utf-8").read()
    mani = json.load(open(os.path.join(SRC, "manifest.json"), encoding="utf-8"))
    by = {m["slot"]: m for m in mani["slots"]}
    out = []
    for sid in [int(x) for x in re.findall(r"<!--@@__JSS_(\d+)__@@-->", tpl)]:
        m = by.get(sid)
        if not m:
            continue
        out += m.get("files") or ([m["file"]] if m.get("file") else [])
    return out


def strip_code(text):
    """去掉注释与字符串字面量，只留标识符 —— 用于判断"真实引用"。"""
    out = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif c in "\"'`":
            q = c
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def ast_names(text, tag):
    """用 acorn 取**真正的**顶层声明（正则会把缩进为 0 的函数内 const 也算进来）。"""
    tmp = os.path.join("/tmp", "_gs_%s.js" % tag)
    open(tmp, "w", encoding="utf-8").write(text)
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "gen_bridge.js"), "--exports", tmp],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-500:])
        return set()
    inner = r.stdout[r.stdout.index("{") + 1:r.stdout.rindex("}")]
    return {x.strip() for x in inner.split(",") if x.strip()}


def top_names(text):
    names = set()
    for m in re.finditer(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)", text, re.M):
        names.add(m.group(1))
    for m in re.finditer(r"^(?:var|let|const)\s+([A-Za-z_$][\w$]*)", text, re.M):
        names.add(m.group(1))
    for m in re.finditer(r"^class\s+([A-Za-z_$][\w$]*)", text, re.M):
        names.add(m.group(1))
    return names


def transform(pub):
    """就地把一个多产物目录改成 core/base/engine/app 四模块。返回模块文件名列表。"""
    html = open(os.path.join(pub, "index.html"), encoding="utf-8").read()
    order = load_order()
    bodies = {f: open(os.path.join(SCRIPTS, f), encoding="utf-8").read() for f in order}
    groups = [(g, fs) for g, fs in GROUPS]
    assigned = {f for _g, fs in groups for f in fs}
    groups.append(("app", [f for f in order if f not in assigned]))

    names = {g: ast_names("\n;\n".join(bodies[f] for f in fs), g) for g, fs in groups}
    ORDER = [g for g, _ in groups]

    mods = []
    for g, fs in groups:
        own = names[g]
        earlier = ORDER[:ORDER.index(g)]
        others = set().union(*[names[o] for o in earlier]) - own if earlier else set()
        by_src = {}
        for name in others:
            for og in earlier:
                if name in names[og]:
                    by_src.setdefault(og, []).append(name)
                    break
        imp = "".join("import { %s } from './%s.js';\n" % (", ".join(sorted(v)), k)
                      for k, v in sorted(by_src.items()))
        mods.append((g, imp, "\n;\n".join(bodies[f] for f in fs), own))

    def bridge_of(text):
        tmp = os.path.join(pub, "_b.js")
        open(tmp, "w", encoding="utf-8").write(text)
        r = subprocess.run(["node", os.path.join(ROOT, "tools", "gen_bridge.js"), tmp],
                           capture_output=True, text=True)
        os.remove(tmp)
        if r.returncode != 0:
            raise SystemExit("✗ 桥生成失败：" + (r.stderr or r.stdout)[-600:])
        return r.stdout

    assets = os.path.join(pub, "assets")
    for f in glob.glob(os.path.join(assets, "*.js")):
        os.remove(f)
    files = []
    try:
        import rjsmin
    except ImportError:
        raise SystemExit("✗ 缺 rjsmin（pip install rjsmin）：分组产物需要压缩，否则 gz 会翻倍")
    for g, imp, body, own in mods:
        text = imp + bridge_of(body) + "\n;\n" + body + "\n;\nexport { %s };\n" % ", ".join(sorted(own))
        # 只在构建期压（源码注释永远保留 —— 项目不可协商条款）
        text = rjsmin.jsmin(text)
        open(os.path.join(assets, "%s.js" % g), "w", encoding="utf-8").write(text)
        files.append("assets/%s.js" % g)

    html = re.sub(r'<script[^>]*src="assets/app\.[^"]*"[^>]*></script>', "", html)
    tag = '<script type="module" src="assets/app.js"></script>\n'
    if "</body>" in html:
        html = html.replace("</body>", tag + "</body>", 1)
    else:
        html = html.replace("</html>", tag + "</html>", 1)
    open(os.path.join(pub, "index.html"), "w", encoding="utf-8").write(html)

    # sw 预缓存要跟着换（否则离线首屏拿不到新模块）
    css = [os.path.basename(x) for x in glob.glob(os.path.join(assets, "style.*.css"))]
    precache = ["./", "./index.html", "./manifest.webmanifest"] + ["assets/" + c for c in css] + files
    # ★ 字体 / 图标不放这里：它们跨版本不变，放进按 BUILD_ID 换代的预缓存 = 每次发版
    #   重下 1.9 MB（文楷 1.5 MB）。它们归 STATIC_CACHE，见 web/sw.js 的 STATIC_ASSETS。
    #   这里同时写 STATIC_ASSETS，是为了加/删字体文件时不用手改两处。
    font_dir = os.path.join(pub, "fonts")
    fonts = []
    if os.path.isdir(font_dir):
        # 超过 600 KB 的单个字体不预缓存（文楷备用块 1.15 MB）：装 SW 时下它等于白拆块，
        # 它靠 web/sw.js 里 fetch 处理器的缓存优先分支惰性落地。与 build.py 的
        # PRECACHE_LIMIT 保持同一口径。
        fonts = ["./fonts/" + f for f in sorted(os.listdir(font_dir))
                 if f.endswith(".woff2")
                 and os.path.getsize(os.path.join(font_dir, f)) <= 600 * 1024]
    static = ["./icons/icon-192.png", "./icons/icon-512.png"] + fonts
    swp = os.path.join(pub, "sw.js")
    if os.path.exists(swp):
        sw = open(swp, encoding="utf-8").read()
        sw = re.sub(r"const PRECACHE = \[.*?\];",
                    "const PRECACHE = " + json.dumps(precache, ensure_ascii=False) + ";", sw, count=1, flags=re.S)
        sw = re.sub(r"const STATIC_ASSETS = \[.*?\];",
                    "const STATIC_ASSETS = " + json.dumps(static, ensure_ascii=False) + ";", sw, count=1, flags=re.S)
        open(swp, "w", encoding="utf-8").write(sw)
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/pz-groups")
    args = ap.parse_args()

    order = load_order()
    bodies = {f: open(os.path.join(SCRIPTS, f), encoding="utf-8").read() for f in order}
    groups = [(g, fs) for g, fs in GROUPS]
    assigned = {f for _g, fs in groups for f in fs}
    rest = [f for f in order if f not in assigned]
    groups.append(("app", rest))

    names = {g: ast_names("\n;\n".join(bodies[f] for f in fs), g) for g, fs in groups}

    # 依赖方向：core < base < engine < app。只允许"向后依赖"，避免任何循环。
    ORDER = [g for g, _ in groups]

    mods = []
    for g, fs in groups:
        own = names[g]
        earlier = ORDER[:ORDER.index(g)]
        others = set().union(*[names[o] for o in earlier]) - own if earlier else set()
        # 全量导入：窗口桥要按名暴露**所有**名字，少导入一个就会在 getter 里 ReferenceError
        # （被 try 吞掉 → 表现为 window.X undefined，极难查）。反正都在同一个 chunk 里，
        # 导入完整不影响体积，只影响可读性。
        used = set(others)
        by_src = {}
        for name in used:
            for og in earlier:
                if name in names[og]:
                    by_src.setdefault(og, []).append(name)
                    break
        imp = "".join("import { %s } from './%s.js';\n" % (", ".join(sorted(v)), k)
                      for k, v in sorted(by_src.items()))
        mods.append((g, imp, "\n;\n".join(bodies[f] for f in fs), own))

    pub = os.path.join(args.out, "public")
    if os.path.isdir(args.out):
        shutil.rmtree(args.out)
    shutil.copytree(os.path.join(ROOT, "public"), pub)
    for f in glob.glob(os.path.join(pub, "assets", "*.js")):
        os.remove(f)

    def bridge_of(text):
        tmp = os.path.join(args.out, "_b.js")
        open(tmp, "w", encoding="utf-8").write(text)
        r = subprocess.run(["node", os.path.join(ROOT, "tools", "gen_bridge.js"), tmp],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit("✗ 桥生成失败：" + (r.stderr or r.stdout)[-600:])
        return r.stdout

    for g, imp, body, own in mods:
        text = imp + body + "\n;\nexport { %s };\n" % ", ".join(sorted(own))
        # 每个模块各暴露自己声明的名字：window.X = v 才能落到**真正的绑定**上
        # （只在最后一个模块里暴露，跨模块的 setter 会写到导入绑定 → TypeError）。
        text = bridge_of(body) + "\n;\n" + text
        open(os.path.join(pub, "assets", "%s.js" % g), "w", encoding="utf-8").write(text)

    html = open(os.path.join(pub, "index.html"), encoding="utf-8").read()
    html = re.sub(r'<script[^>]*src="assets/app\.[^"]*"[^>]*></script>', "", html)
    tag = '<script type="module" src="assets/app.js"></script>\n'
    if "</body>" in html:
        html = html.replace("</body>", tag + "</body>", 1)
    else:
        # 本项目的模板没有 </body>（只有 </html>），挂在 </html> 前同样合法
        html = html.replace("</html>", tag + "</html>", 1)
    open(os.path.join(pub, "index.html"), "w", encoding="utf-8").write(html)

    print("✓ 生成", args.out)
    for g, imp, body, own in mods:
        print("  %-7s %6d 行 · 导出 %3d · %s" % (
            g, body.count("\n"), len(own), imp.count("import") and "import " + str(imp.count("import")) + " 组" or "无 import"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
