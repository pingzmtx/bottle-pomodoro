#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🔬 probe_dep.py —— 运行时依赖探针（诊断工具，**不改主构建链路**）
================================================================================
用途：回答「抽掉某个模块后，谁在偷偷依赖它 / 冒烟到底覆盖没覆盖它」。

背景（为什么不能只跑「抽掉 → 看冒烟红绿」）：
  run_smoke.py 是「核心路径回归集」，它测的是"应用还能不能用"，
  不是"这个模块是不是完全没用"。于是「全绿」有两种含义，必须分清：
    · 真可回退   —— 这个模块真的可以安全抽掉
    · 冒烟盲区   —— 这模块只影响次要功能，而冒烟压根没测到那条路径
  两者在「红/绿」口径下无法区分 → 差集口径才能区分。

本工具的做法（差集法）：
  ① 在**临时产物**里注入 window.__touched 探针（不碰正式 index.html）
  ② 在模块的**副作用点**打点（不是函数入口！见下方「打点纪律」）
  ③ 跑一遍冒烟，dump 出「本次实际执行到了哪些副作用点」的集合
  ④ 对每个待测模块：生成一份"抽掉该模块"的变体产物，重复 ③
  ⑤ 基线集合 vs 变体集合 做差 → 差集 = 该模块被用到的面

打点纪律（关键，否则差集同样会骗人）：
  ❌ 不能只记「函数被调用」——`renderCards()` 在容器不存在时早退 `return false`，
     但它**确实被调用了**。若只记入口，抽掉上游后差集仍为空 → 误判"无人依赖"。
  ✅ 要记「函数真干成事」——在副作用落地之后打点（如 `box.innerHTML = html` 之后）。
  本工具两个口径都记，便于对照：
     call:<fn>   —— 进过函数（含空转）
     done:<what> —— 副作用真的发生了
  差集以 done: 为准，call: 留作"空转"证据。

验收口径：
  「可回退」= (a) 抽掉后应用照常启动、不报错；且
              (b) 差集只落在该模块自身的 render 面上，不影响其他模块。
  例外：纯性能/纯体验模块（如 0B_hash路由、03_enh572_性能打磨）
        不按此口径判定，单列一栏、另用性能指标验证（本工具不做，只标注）。

用法：
    python3 tools/probe_dep.py --list                 # 列出模块 + 性能类标注
    python3 tools/probe_dep.py --baseline             # 出基线集合
    python3 tools/probe_dep.py --drop 0E_theme_主题引擎.js
    python3 tools/probe_dep.py --all                  # 全模块依次跑（耗时）
"""
import sys, os, json, re, shutil, tempfile, subprocess, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = None          # 延迟解析：需要内联探针时用 _app_path.single_html()
MANIFEST = os.path.join(ROOT, "src", "manifest.json")
SMOKE = os.path.join(ROOT, "tools", "run_smoke.py")
WORK = os.path.join(tempfile.gettempdir(), "probe_dep")

# ── 打点表：模块 → [(选择器, 打点名)] ────────────────────────────────────────
# 选择器是对源码做**字符串定位**用的锚点；插入点在其后。
# 这是人工挑选的「副作用点」，是本工具的固有成本 —— 不能无脑在函数入口打点。
PROBES = {
    "0E_theme_主题引擎.js": [
        # applyTheme：真正写入 body[data-theme] 之后
        ("document.body.setAttribute(ATTR, key);",
         "done:themeAttr"),
        # renderCards：真正写出 innerHTML 之后
        ("box.innerHTML = html;",
         "done:themeGrid"),
        # setTheme：真正落盘之后
        ("if (typeof saveData === 'function') saveData();",
         "done:themeSave"),
    ],
}

# 纯性能 / 纯体验模块：探针与冒烟对其无效，单列标注（本轮不判定）
PERF_MODULES = {
    "0B_hash路由.js": "体验类：仅影响地址栏 hash 回写/切页历史，抽掉功能不变、体验退化",
    "03_enh572_性能打磨.js": "性能类：缓存/空闲预热，抽掉功能不变、性能退化",
    "04_enh573_统计缓存.js": "性能类：统计聚合缓存，抽掉功能不变、切页变慢",
    "06_errRep_错误监控.js": "可观测类：仅影响错误上报，抽掉功能不变、问题更难查",
}

# 需要额外验「数据兼容」（口径第 3 类）的模块：会往 appData 里写字段的
DATA_COMPAT_MODULES = {
    "0E_theme_主题引擎.js": "写入 appData.settings.theme；旧存档已存该字段",
}


def run_datacompat(html_path):
    """跑数据兼容检查，返回 (退出码, 输出)。"""
    tool = os.path.join(ROOT, "tools", "probe_datacompat.py")
    if not os.path.exists(tool):
        return 3, "(未找到 probe_datacompat.py)"
    r = subprocess.run([sys.executable, tool, html_path],
                       capture_output=True, text=True, timeout=300, cwd=ROOT)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def run_smoke(html_path, timeout=900):
    """跑冒烟（只读调用 run_smoke.py，不修改它），返回 (退出码, 输出)。"""
    env = dict(os.environ)
    r = subprocess.run([sys.executable, SMOKE, "--html", html_path],
                       capture_output=True, text=True, timeout=timeout, env=env, cwd=ROOT)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def load_slots():
    with open(MANIFEST, encoding="utf-8") as f:
        m = json.load(f)
    out = []
    for s in m["slots"]:
        files = s.get("files") or ([s["file"]] if s.get("file") else [])
        for fn in files:
            out.append({"slot": s["slot"], "file": fn})
    return m, out


def read_module(fn):
    p = os.path.join(ROOT, "src", "scripts", fn)
    with open(p, encoding="utf-8") as f:
        return f.read()


def make_probe_js(fn, mods_to_inject):
    """生成探针注入片段：包在 IIFE 里挂 window.__touched，并给模块打点。"""
    return None  # 见 inject()


def inject_probe(html, touched_names):
    """在产物 </body> 前插入探针引导脚本。

    ⚠️ 关键设计：打点必须写进 sessionStorage，**不能只放内存 Set**。
    原因：run_smoke.py 全流程会 reload 8 次（且有 localStorage.clear()），
    纯内存的 window.__touched 会被反复清空 —— 跑完再读只拿到"最后一页"的
    局部状态，差集完全失真。sessionStorage 在同一标签页内跨 reload 保留，
    且不受 localStorage.clear() 影响（两者是不同 storage）。
    """
    tag = (
        "<script>"
        "/* probe_dep 注入：运行时副作用探针（跨 reload 累积，见 probe_dep.py 注释） */"
        "window.__mark=function(n){"
        "try{sessionStorage.setItem('__probe__'+n,'1');}catch(e){}"
        "};"
        "window.__touched=function(){"
        "var s=[];try{for(var i=0;i<sessionStorage.length;i++){"
        "var k=sessionStorage.key(i);"
        "if(k&&k.indexOf('__probe__')===0)s.push(k.slice(9));}}catch(e){}"
        "return s.sort();"
        "};"
        "</script>"
    )
    if "</body>" in html:
        return html.replace("</body>", tag + "\n</body>", 1)
    return html + tag


def patch_module(src, fn):
    """给模块源码打点：把打点表里的锚点替换为「锚点 + __mark(...)」。"""
    probes = PROBES.get(fn)
    if not probes:
        return src, []
    applied = []
    for anchor, name in probes:
        if anchor not in src:
            print(f"   ⚠️ 打点锚点未命中（跳过）：{name}  ← 锚点: {anchor[:52]}")
            continue
        # 在锚点所在行之后插入打点（保持原语句完整）
        src = src.replace(
            anchor,
            anchor + f" if(window.__mark) window.__mark('{name}');",
            1,
        )
        applied.append(name)
    return src, applied


def build_variant(drop_file=None, out_dir=None):
    """生成变体产物：可选手工抽掉一个模块 + 注入探针。返回产物路径与打点清单。"""
    os.makedirs(out_dir, exist_ok=True)
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from _app_path import single_html
    with open(single_html(), encoding="utf-8") as f:
        html = f.read()

    _, slots = load_slots()
    touched = []

    # 抽掉目标模块：它在产物里的体量 = 模块源码（构建是直接拼接）→ 用源码整体替换为空
    if drop_file:
        src = read_module(drop_file)
        body = src.strip()
        # 去掉首尾注释块后取主体，避免误删注释导致定位失败；直接整段匹配
        if body and body in html:
            html = html.replace(body, f"/* [probe_dep] 已抽掉 {drop_file} */", 1)
        else:
            # 退路：按行删除该模块的内容（模块间靠唯一注释头分隔）
            print(f"   ⚠️ 整段匹配失败，尝试行级删除：{drop_file}")
            html = drop_by_lines(html, src, drop_file)

    # 给「未被抽掉」的模块打点
    for s in slots:
        fn = s["file"]
        if drop_file and fn == drop_file:
            continue
        if fn not in PROBES:
            continue
        src = read_module(fn)
        patched, applied = patch_module(src, fn)
        if not applied:
            continue
        if src.strip() in html:
            html = html.replace(src.strip(), patched.strip(), 1)
            touched += applied
        else:
            print(f"   ⚠️ 模块整体替换失败：{fn}")

    html = inject_probe(html, touched)
    out = os.path.join(out_dir, "index.probe.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    return out, touched


def drop_by_lines(html, src, drop_file):
    """行级删除退路：模块头部注释首行 + 后续内容一起删。
    做法保守 —— 只删「源码里出现过的那批连续行」。"""
    lines = src.split("\n")
    head = lines[0].strip() if lines else ""
    if head and head in html:
        html = html.replace(head, f"/* [probe_dep] 已抽掉 {drop_file} */", 1)
    return html


# ── 采集器：委托给 probe_collect.py（避免 f-string 花括号转义地狱） ──────────
COLLECT = os.path.join(ROOT, "tools", "probe_collect.py")


def collect(html_path, wait_ms=2200):
    """起无头 chromium 遍历视图，dump 累积探针集合。返回 (set|None, err|None)。

    为什么自己写一遍遍历而不用 run_smoke.py：
      run_smoke.py 是断言集，跑完就 exit，且中途 8 次 reload + localStorage.clear，
      没有「把 __touched 吐出来」的出口。改它等于动主回归链路（不该做）。
      这里复刻它的**页面覆盖面**（五视图 + 设置页展开）用来采探针 ——
      采集与断言解耦，互不污染。
    """
    r = subprocess.run([sys.executable, COLLECT, html_path, str(wait_ms)],
                       capture_output=True, text=True, timeout=300, cwd=ROOT)
    out = (r.stdout or "") + (r.stderr or "")
    if "CHROMIUM_FAIL" in out or r.returncode == 3:
        return None, "chromium 无法启动（环境不具备或沙箱限制）"
    m = re.search(r"TOUCHED:(.*)", out)
    if not m:
        return None, "未取到 TOUCHED。输出尾部：\n" + out[-600:]
    try:
        return set(json.loads(m.group(1).strip())), None
    except Exception as e:
        return None, "解析 TOUCHED 失败: %s\n原始: %s" % (e, m.group(1)[:300])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="列出模块与性能类标注")
    ap.add_argument("--baseline", action="store_true", help="出基线集合")
    ap.add_argument("--drop", metavar="FILE", help="抽掉指定模块后出集合")
    ap.add_argument("--all", action="store_true", help="对所有有打点的模块依次跑")
    ap.add_argument("--keep", action="store_true", help="保留临时产物供人工检查")
    args = ap.parse_args()

    _, slots = load_slots()

    if args.list:
        print("槽位  模块")
        print("-" * 62)
        for s in slots:
            mark = ""
            if s["file"] in PERF_MODULES:
                mark = "  ⚠️ 性能/体验类（不按功能口径判定）"
            elif s["file"] in PROBES:
                mark = "  🔬 已配探针"
            print(f"{s['slot']:>3}   {s['file']}{mark}")
        print()
        print("性能/体验类模块（本轮只标注，不判定）：")
        for k, v in PERF_MODULES.items():
            print(f"  · {k} —— {v}")
        return

    targets = []
    if args.all:
        targets = [s["file"] for s in slots if s["file"] in PROBES]
    elif args.drop:
        targets = [args.drop]

    print("=" * 66)
    print("🔬 probe_dep 运行时依赖探针")
    print("=" * 66)
    print("正式产物: public/index.html（探针只注入临时副本，正式产物全程只读）")
    print(f"临时目录: {WORK}\n")

    # ── ① 基线 ────────────────────────────────────────────────────────────
    base_html, injected = build_variant(None, os.path.join(WORK, "base"))
    print(f"① 基线产物 → {base_html}")
    print(f"   探针打点: {', '.join(injected) if injected else '(无)'}")
    if not injected:
        print("   ✗ 无任何打点生效，请检查 PROBES 锚点。")
        return 2
    base_set, err = collect(base_html)
    if err:
        print(f"   ✗ 采集失败：{err}")
        return 3
    print(f"   基线集合({len(base_set)}): {sorted(base_set)}\n")

    if not targets:
        print("（未指定 --drop/--all，仅出基线）")
        return 0

    # ── ② 逐个抽模块 ──────────────────────────────────────────────────────
    report = []
    for t in targets:
        out_dir = os.path.join(WORK, "drop_" + re.sub(r"[^A-Za-z0-9]", "_", t))
        h, inj = build_variant(t, out_dir)
        print(f"② 抽掉 {t}")
        print(f"   变体产物 → {h}")
        ds, err = collect(h)
        if err:
            print(f"   ✗ 采集失败：{err}\n")
            report.append((t, None, err))
            continue
        diff = base_set - ds
        new = ds - base_set
        print(f"   集合({len(ds)}), 差集(done 消失)={len(diff)}")
        if diff:
            for d in sorted(diff):
                print(f"     − {d}")
        else:
            print("     − （空）")
        if new:
            print(f"   ⚠️ 出现基线没有的新打点（顺序/分支差异）：{sorted(new)}")
        print()

        # ── 判定（三项齐全） ──
        # (a) 抽掉后照常启动不报错 → 跑冒烟（用 run_smoke.py，只读调用，不改它）
        print("   → 补验口径 (a)：跑冒烟")
        rc, smk_out = run_smoke(h)
        smk_tail = [l for l in smk_out.splitlines() if "断言:" in l or "JS 运行时异常" in l]
        smoke_ok = (rc == 0)
        for l in smk_tail:
            print("     " + l.strip())
        if smoke_ok:
            print("     ✅ (a) 冒烟全绿：抽掉后应用照常启动、不报错")
        else:
            print(f"     ❌ (a) 冒烟未通过（rc={rc}）")

        # (c) 数据兼容（第 3 类，探针扫不到）
        dc_ok = None
        if t in DATA_COMPAT_MODULES:
            print("   → 补验第 3 类：数据兼容（旧存档字段）")
            drc, dout = run_datacompat(h)
            dc_ok = (drc == 0)
            for l in [x for x in dout.splitlines() if "无损" in x or "保留" in x or "✅" in x or "❌" in x]:
                print("     " + l.strip())

        own = {n for n in injected if n in diff}
        alien = diff - set(injected)
        if not diff:
            verdict = "⚠️ 覆盖不到（转补用例）"
            note = ("差集为空 → **不能**判定为「可回退」。当前采集路径（五视图遍历 + "
                    "设置页展开 + 点色卡）没有触发该模块的副作用点，即**覆盖不到**。"
                    "正确动作是补采集路径/用例，而不是标成可回退。")
        elif alien:
            verdict = "❌ 被他模块依赖"
            note = f"差集里出现非本模块打点：{sorted(alien)} → 有别的模块在依赖它，不可直接抽。"
        else:
            verdict = "✅ 本模块自足"
            note = ("差集全部是该模块自身的副作用点，未波及他模块 → 符合口径 (b)。"
                    + ("数据兼容亦通过。" if dc_ok else ""))
        if not smoke_ok and verdict.startswith("✅"):
            verdict = "⚠️ 差集自足但冒烟不过"
            note += " 但口径 (a) 未过，需排查。"
        report.append((t, verdict, note, sorted(diff), smoke_ok, dc_ok))
        print(f"   【判定】{verdict}")
        print(f"   {note}\n")

    # ── ③ 汇总 ────────────────────────────────────────────────────────────
    print("=" * 66)
    print("📋 汇总")
    print("=" * 66)
    for row in report:
        t, v, n = row[0], row[1], row[2]
        diff = row[3] if len(row) > 3 else []
        smk = row[4] if len(row) > 4 else None
        dc = row[5] if len(row) > 5 else None
        flags = []
        flags.append("(a)冒烟%s" % ("✅" if smk else ("❌" if smk is False else "－")))
        flags.append("(b)差集%d%s" % (len(diff), "✅" if diff else "⚠️空"))
        if dc is not None:
            flags.append("(c)数据兼容%s" % ("✅" if dc else "❌"))
        print(f"  {t}\n    → {v}\n      {'  '.join(flags)}")
    print()
    print("口径提醒：")
    print("  可回退 = (a) 抽掉后照常启动不报错；且 (b) 差集只落在该模块自身 render 面。")
    print("  空差集 ≠ 可回退 —— 它等于「本次采集路径覆盖不到」，应转成补用例任务。")
    print("  有数据字段的模块另验 (c) 数据兼容；性能/体验类模块不适用本口径（见 --list）。")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
