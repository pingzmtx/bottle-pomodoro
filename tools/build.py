#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
🍅 番茄专注 · 构建脚本（默认多产物）
=================================
用法:
    python3 build.py              # 默认：由 src/ 生成 public/（唯一发布物，单个 ES 模块）
    python3 build.py --classic    # 回退：9 个普通 <script>（本地 file:// 预览时用）
    python3 build.py --check      # 校验：public/ 能否由 src/ 精确重建（逐文件逐字节）
    python3 build.py --single     # 可选：生成自包含单文件 index.html（仅本地预览 / 需要内联的工具）
    python3 build.py --check --single  # 校验单文件产物
    python3 build.py split        # 一次性：把单文件产物切回 src/（历史迁移用）

产物口径（2026-10-22 起）:
    public/index.html + assets/*.js + assets/*.css + config.js + sw.js
    单文件 index.html 不再是发布物，也不进仓库；需要时用 --single 现场生成。

原理:
    开发态 src/ 由 template 片段 + 47 个脚本组成（顺序见 src/manifest.json）。
    旧单文件产物是"模板 + N 个 <script> 内联槽"，split() 用状态机精确切分；
    assemble() 反向合并 —— 无改动时逐字节一致（sha256 相等）。

目录:
    src/template.html    —— 除脚本槽外的全部 HTML/CSS/注释（含占位标记）
    src/scripts/*.js     —— 每个真实 <script> 一个文件（可按需继续细拆）
    src/manifest.json    —— 槽顺序 / 文件名 / 原开闭标签（构建依据）
"""
import json, re, hashlib, sys, os, shutil, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
SCRIPTS = os.path.join(SRC, "scripts")
WEB_DIR = os.path.join(ROOT, "web")
INDEX = os.path.join(ROOT, "index.html")
TPL = os.path.join(SRC, "template.html")          # 模板**产物**（由片段拼装，勿手改）
TPL_DIR = os.path.join(SRC, "template")           # 模板片段目录（★ 真源）
TPL_ORDER = os.path.join(TPL_DIR, "_order.json")  # 片段顺序清单
# 装 SW 时预缓存单个文件的上限。超过就不预缓存，改由 fetch 处理器惰性缓存 ——
# 文楷备用块（1.15 MB，GB2312 里站点没用到的字）专为这条规则存在：
# 预缓存它等于让每个新用户都在安装阶段背一整块，那就白拆了。
PRECACHE_LIMIT = 600 * 1024
MANI = os.path.join(SRC, "manifest.json")
MARK = "<!--@@__JSS_{n}__@@-->"


def tag_end(s, i):
    """从 '<' 起找 '>'，跳过引号内内容，返回 > 位置(含)之后的游标与开标签原文。"""
    j = i + 1
    n = len(s)
    quote = None
    while j < n:
        c = s[j]
        if quote:
            if c == quote:
                quote = None
        elif c in ('"', "'"):
            quote = c
        elif c == '>':
            return j + 1
        j += 1
    return -1


def find_ci(s, sub, start):
    return s.lower().find(sub.lower(), start)


def scan_slots(text):
    """状态机扫描：返回 [(start, end, open_tag, close_tag, body)]；start/end 为整槽区间。"""
    slots = []
    n = len(text)
    i = 0
    state = "normal"  # normal | comment | style | script
    while i < n:
        if state == "normal":
            if text.startswith("<!--", i):
                state = "comment"; i += 4; continue
            if text.startswith("<style", i) and (i + 6 >= n or not (text[i+6].isalpha() or text[i+6] in "/")):
                # 进入 style 原文本
                state = "style"; i += 6; continue
            if text.startswith("<script", i) and (i + 7 >= n or not (text[i+7].isalpha() or text[i+7] in "/")):
                te = tag_end(text, i)
                if te < 0:
                    break
                open_tag = text[i:te]
                ce = find_ci(text, "</script>", te)
                if ce < 0:
                    break
                close_tag = text[ce:ce + 9]
                body = text[te:ce]
                slots.append([i, ce + 9, open_tag, close_tag, body])
                i = ce + 9
                continue
            i += 1
        elif state == "comment":
            e = text.find("-->", i)
            i = n if e < 0 else e + 3
            if e >= 0:
                state = "normal"
        elif state == "style":
            e = find_ci(text, "</style>", i)
            i = n if e < 0 else e + 8
            if e >= 0:
                state = "normal"
        else:
            break
    return slots


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def split():
    """首次迁移：把 index.html 切成 src/。注意：若 src 已与 index 不一致（有人在 src 里改过），需 --force 才会覆盖。"""
    if os.path.exists(MANI):
        try:
            if assemble() != open(INDEX, encoding="utf-8").read():
                if "--force" not in sys.argv:
                    print("✗ src/ 与 index.html 不一致（看起来有人在 src 里改过）。")
                    print("  若确认要“以 index.html 为准”重新切分，请加 --force 运行：python3 build.py split --force")
                    sys.exit(1)
        except Exception as e:
            print("✗ 检查 src 一致性失败:", e); sys.exit(1)
    os.makedirs(SCRIPTS, exist_ok=True)
    text = open(INDEX, encoding="utf-8").read()
    slots = scan_slots(text)
    if not slots:
        print("✗ 未找到任何 script 槽"); sys.exit(1)
    # 用开标签行号/文件角色命名
    names = slot_names(slots)
    manifest = []
    # 自后向前替换，保持位置正确
    out = text
    for idx, (st, en, ot, ct, body) in enumerate(reversed(slots)):
        real = len(slots) - idx - 1
        out = out[:st] + MARK.format(n=real + 1) + out[en:]
    open(TPL, "w", encoding="utf-8").write(out)
    for i, (st, en, ot, ct, body) in enumerate(slots):
        is_engine = ("模块: 01-data.js" in body) and len(body) > 300000
        if is_engine:
            # 主引擎槽：按内部「模块: 0X-xx.js」横幅切成多分片（拼接后逐字节还原）
            segs = seg_engine(body)
            files = []
            for j, (seg_name, seg_body) in enumerate(segs):
                p = os.path.join(SCRIPTS, seg_name)
                open(p, "w", encoding="utf-8").write(seg_body)
                files.append(seg_name)
            manifest.append({
                "slot": 1, "files": files, "open": ot, "close": ct,
                "len": len(body), "parts": len(files),
                "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest()
            })
        else:
            fn = names[i]
            path = os.path.join(SCRIPTS, fn)
            open(path, "w", encoding="utf-8").write(body)
            manifest.append({
                "slot": i + 1, "file": fn, "open": ot, "close": ct,
                "len": len(body), "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest()
            })
    open(MANI, "w", encoding="utf-8").write(json.dumps({
        "generated_from": "index.html",
        "template": "template.html",
        "script_dir": "scripts",
        "marker": MARK,
        "slots": manifest,
    }, ensure_ascii=False, indent=2))
    print(f"✓ 已切分 {len(slots)} 个脚本槽 → src/scripts/")
    for i, m in enumerate(manifest):
        disp = " + ".join(m.get("files") or [m["file"]])
        print(f"   槽{i+1:>2} {disp}  ({m['len']:,} 字符)")
    print(f"✓ 模板: src/template.html  清单: src/manifest.json")


def seg_engine(body):
    """把主引擎正文按 '模块: 0X-xx.js' 横幅切成若干连续分片（含横幅行），拼接 === 原正文。"""
    import re as _re
    lines = body.splitlines(keepends=True)
    marks = []
    for i, ln in enumerate(lines):
        s = ln.lstrip()
        if s.startswith("/*") and "模块: " in s and ".js |" in s:
            m = _re.search(r"模块: ([\w.-]+)", s)
            code = m.group(1) if m else f"m{i}"
            marks.append((i, code))
    if not marks:
        return [("01a_engine_prelude.js", body)]
    out = []
    starts = [0] + [mi for mi, _ in marks]
    segno = 0
    for k in range(len(marks) + 1):
        a = starts[k]
        b = starts[k + 1] if k + 1 < len(starts) else len(lines)
        chunk = "".join(lines[a:b])
        if k == 0:
            nm = "01a_engine_prelude.js"
        else:
            code = marks[k - 1][1]
            segno += 1
            token = code.split("-")[1].split(".")[0] if "-" in code and "." in code else code
            nm = f"01{chr(ord('b') + segno - 1)}_engine_{token}.js"
        out.append((nm, chunk))
    return out


def slot_names(slots):
    hints = [
        ("01_main_engine.js", "主引擎(预置__ivGov/__dataMig+核心JS)"),
        ("02_enh571_自律增强.js", "07-enh v5.7 自律·提醒·统计"),
        ("03_enh572_性能打磨.js", "v5.7.1 性能与打磨"),
        ("04_enh573_统计缓存.js", "v5.7.2 统计热路径缓存"),
        ("05_journey_渐进解锁.js", "08-journey 成长之旅+归档"),
        ("06_errRep_错误监控.js", "M1 __errRep"),
        ("07_uiFold_折叠记忆.js", "M3 __uiFold"),
    ]
    n = len(slots)
    return [hints[i][0] if i < len(hints) else f"{i+1:02d}_slot.js" for i in range(n)]


def load_template():
    """按 src/template/_order.json 把片段拼成完整模板全文。

    模板真源 = src/template/ 下的片段（CSS 按原编号分节切、DOM 按视图切）。
    src/template.html 是拼装**产物**，供 E2E / 各审计工具读取，不再手工维护。
    动因：拆分前 template.html 是 7843 行巨型文件（63% 是 CSS），任何样式改动
    都命中 affected_cases 的全局名单 → 逼出全量回归。现在改样式只动对应片段。
    """
    order = json.load(open(TPL_ORDER, encoding="utf-8"))["order"]
    parts = []
    for name in order:
        p = os.path.join(TPL_DIR, name)
        if not os.path.exists(p):
            print(f"✗ 模板片段缺失: {name}")
            sys.exit(1)
        parts.append(open(p, encoding="utf-8").read())
    return "".join(parts)


def sync_template():
    """把片段拼装结果同步回 src/template.html（产物）。内容相同则不写。"""
    tpl = load_template()
    try:
        prev = open(TPL, encoding="utf-8").read()
    except FileNotFoundError:
        prev = None
    if tpl != prev:
        open(TPL, "w", encoding="utf-8").write(tpl)
        return True
    return False


def _read_meta_ver(text):
    """从产物首行 <!--@tomato-src ... --> 里取出 ver 字段。"""
    import base64
    m = re.search(r"<!--@tomato-src ([A-Za-z0-9+/=]+)-->", text)
    if not m:
        return None
    try:
        return json.loads(base64.b64decode(m.group(1))).get("ver")
    except Exception:
        return None


_VER_SEQ_FILE = os.path.join(ROOT, "tools", ".ver_seq.json")


def _bump_label():
    """版本号 = 日期.当天第几版（形如 2026.10.22.3）。

    为什么带序号：只看日期分不清「今天最早那一版」和「刚刚发的那版」。
    一天里连发几版修同一个问题时，用户打开设置页只能看到同一个日期，
    没法判断手机上拿到的是不是最新的 —— 那就等于没有版本号。
    """
    import datetime
    today = datetime.date.today().strftime("%Y.%m.%d")
    n = 0
    try:
        with open(_VER_SEQ_FILE, encoding="utf-8") as f:
            d = json.load(f)
        if d.get("date") == today:
            n = int(d.get("n", 0))
    except Exception:
        pass
    # 计数器丢了（新机器 / 被清理）也要接着上一次产物的序号往上走
    try:
        prev = _read_meta_ver(open(INDEX, encoding="utf-8").read()) or ""
        if prev.startswith(today + "."):
            n = max(n, int(prev.rsplit(".", 1)[1]))
    except Exception:
        pass
    n += 1
    try:
        with open(_VER_SEQ_FILE, "w", encoding="utf-8") as f:
            json.dump({"date": today, "n": n}, f)
    except Exception:
        pass
    return "%s.%d" % (today, n)


def minify_css(css):
    """压缩一段 CSS：去注释 + 折叠空白 + 去标点两侧空格。

    **只作用于构建时的内存字符串**，src/ 下的 .css 不碰（见方案 §12 保全条款）。
    字符串字面量（content:"..." 之类）原样保留：先把 CSS 切成「字符串/非字符串」
    两类片段，只对非字符串片段做空白处理，避免把 content 里的空格吃掉。
    """
    chunks = []
    buf = []
    n = len(css)
    i = 0

    def flush():
        if buf:
            t = "".join(buf)
            buf.clear()
            t = re.sub(r"\s+", " ", t)
            # ★ 这里不能把 + 和 - 两侧的空格一起删掉。
            #   CSS 规范要求 calc() 里 + 与 - 的**两侧必须有空白**，写成
            #   calc(80px+env(...)) 会让浏览器判定整条声明非法并直接丢弃。
            #   真实事故（2026-10-25）：这条正则把 .main 的
            #   `padding-bottom: calc(80px + env(safe-area-inset-bottom))`
            #   压成了无空格版本，于是整个 80px 的底部让位空间静默消失，
            #   页脚被底部导航栏盖住 54px。之前一直没暴露，是因为页脚那时
            #   opacity 只有 0.45、根本看不见，用户也就不会发现它被挡住。
            #   保留 + 的空格只多几百字节，gzip 后几乎为零；而丢一条规则
            #   的代价是无声的布局错误，属于最贵的一类 bug。
            #   相邻兄弟选择器（a + b）因此会保留空格，对功能无影响。
            t = re.sub(r"\s*([{}:;,>~])\s*", r"\1", t)
            chunks.append(t)

    while i < n:
        c = css[i]
        if c == "/" and i + 1 < n and css[i + 1] == "*":
            j = css.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in "\"'":
            flush()
            q = c
            j = i + 1
            while j < n:
                if css[j] == "\\" and j + 1 < n:
                    j += 2
                    continue
                if css[j] == q:
                    j += 1
                    break
                j += 1
            chunks.append(css[i:j])
            i = j
            continue
        buf.append(c)
        i += 1
    flush()
    return "".join(chunks).strip()


def minify_js(js):
    """压缩一段 JS：去注释 + 折叠空白，语义不变（rjsmin）。

    **只作用于构建时的内存字符串**，src/scripts/*.js 一字不动（方案 §12 保全条款）。
    中文注释占源码 41%，gzip 对中文压缩率只有 50~60%，所以去注释是体积收益的大头
    （实测 JS gz 757 KB → 411 KB）。rjsmin 是纯 Python、无外部依赖，且不动分号，
    不引入 ASI 风险。
    """
    try:
        import rjsmin
    except ImportError:
        print("✗ 缺少 rjsmin，无法压缩 JS。装：pip install rjsmin")
        sys.exit(1)
    out = rjsmin.jsmin(js)
    if "</script>" in out:
        print("✗ 压缩后出现 </script> 字面量，会提前闭合内联脚本"); sys.exit(1)
    return out

def minify_style_blocks(text):
    """把产物里所有 <style> 块的内容替换成压缩版；其余字节不动。"""
    def _repl(m):
        return m.group(1) + minify_css(m.group(2)) + m.group(3)

    return re.sub(r"(<style[^>]*>)(.*?)(</style>)", _repl, text, flags=re.S)


def assemble(ver=None):
    """按 src/manifest.json 合并 template.html + scripts → index.html 全文。

    产物第一行会缝入「恢复清单」注释 <!--@tomato-src base64 -->：
    记录每个 <script> 槽按执行顺序对应的源文件与分片边界。
    用途：当本地只剩 index.html 时，可用 v6 合成器/恢复脚本把它完整还原回 src 工程。
    ver 传 None 用源码日期（只读场景），显式传入由调用方决定并负责递增。"""
    import re as _re, base64
    mani = json.load(open(MANI, encoding="utf-8"))
    # ★ 只在这里压样式：src/template.html 保持未压缩（它是产物，也是可读的真源镜像）。
    tpl = minify_style_blocks(load_template())
    order = [int(x) for x in _re.findall(r"<!--@@__JSS_(\d+)__@@-->", tpl)]
    by = {m["slot"]: m for m in mani["slots"]}
    out = tpl
    entries = []
    for sid in order:
        m = by.get(sid)
        if not m:
            continue
        if m.get("files"):
            parts = []
            body = ""
            cum = 0
            for fi, f in enumerate(m["files"]):
                c = open(os.path.join(SCRIPTS, f), encoding="utf-8").read()
                body += c
                part = {"file": f, "start": cum, "end": cum + len(c)}
                # 数字偏移依赖字符串编码口径（python 码点 vs JS UTF-16 会因 emoji 错位），
                # 因此额外记录每个分片(除首个)的开头唯一行，供浏览器按"找标记"切分。
                if fi > 0:
                    part["marker"] = c.split("\n", 1)[0]
                else:
                    part["marker"] = None
                parts.append(part)
                cum += len(c)
            entry = {"slot": sid, "open": m["open"], "close": m["close"], "parts": parts}
        else:
            body = open(os.path.join(SCRIPTS, m["file"]), encoding="utf-8").read()
            entry = {"slot": sid, "open": m["open"], "close": m["close"], "file": m["file"]}
        entries.append(entry)
        out = out.replace(MARK.format(n=sid), m["open"] + body + m["close"])
    if MARK.format(n=1) in out:
        print("✗ 模板中存在未填充的槽标记，中止"); sys.exit(1)
    # 源的 JS 里若出现 </script> 字面量，内联进单文件后会把 <script> 提前闭合。
    # 当前 0 处；这里显式失败，把这条边界钉死（方案 §2 的硬规则）。
    for _f in sorted(os.listdir(SCRIPTS)):
        if _f.endswith(".js"):
            if "</script>" in open(os.path.join(SCRIPTS, _f), encoding="utf-8").read():
                print("✗ %s 含 </script> 字面量，无法安全内联" % _f); sys.exit(1)
    # 构建版本：用「源码最近一次改动日期」当版本号（形如 2026.10.06），显示在设置页。
    # 用途：本地 file:// 场景下浏览器会复制一份产物，光看文件名分不清手机里跑的是哪一版。
    # 取日期而非构建时刻 —— 同样的源码无论重建多少次，版本号都一样，不会污染 diff。
    # 优先取 git 里 src/ 最后一次提交的日期；没有 git 就退回源文件最新的修改时间。
    def _src_date():
        import subprocess, datetime
        try:
            r = subprocess.run(
                ["git", "log", "-1", "--format=%cd", "--date=format:%Y.%m.%d", "--", SRC],
                capture_output=True, text=True, cwd=ROOT, timeout=5
            )
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.strip()
        except Exception:
            pass
        newest = 0.0
        for _root, _dirs, _files in os.walk(SRC):
            for _f in _files:
                p = os.path.join(_root, _f)
                try:
                    newest = max(newest, os.path.getmtime(p))
                except OSError:
                    pass
        if newest:
            return datetime.date.fromtimestamp(newest).strftime("%Y.%m.%d")
        return datetime.date.today().strftime("%Y.%m.%d")

    _h = hashlib.sha256()
    _h.update(tpl.encode("utf-8"))
    for _f in sorted(os.listdir(SCRIPTS)):
        if _f.endswith(".js"):
            _h.update(_f.encode("utf-8"))
            _h.update(open(os.path.join(SCRIPTS, _f), "rb").read())
    meta_b64 = base64.b64encode(
        json.dumps(
            {"v": 1, "ver": ver if ver else _src_date(), "h": _h.hexdigest()[:8], "meta": entries},
            ensure_ascii=False,
        ).encode("utf-8")
    ).decode("ascii")
    return "<!--@tomato-src " + meta_b64 + "-->\n" + out


def build():
    """默认：同步模板产物 + 重写 index.html。

    --no-sync：只重写 index.html，**不碰 src/template.html**。
    为什么需要它：verify 链里 build 段排在 check 段之前，而 sync_template() 会顺手
    改源树里的 src/template.html —— 于是一次「只读校验」实际上产生了工作区变更，
    与紧随其后的 `--check` 形成"先写再比对"的自证循环（P1-6）。
    门禁链只该读、不该写；模板产物由人显式跑一次 `python3 tools/build.py` 生成。
    """
    if "--no-sync" in sys.argv:
        print("○ 已跳过 src/template.html 同步（--no-sync：门禁链不改源树）")
    elif sync_template():
        print("✓ 已由片段同步 src/template.html（模板产物）")
    # 先按现有产物的版本号试拼：内容没变就不写盘，也不消耗序号
    try:
        prev = open(INDEX, encoding="utf-8").read()
    except FileNotFoundError:
        prev = ""
    keep = _read_meta_ver(prev) if prev else None
    out = assemble(keep)
    if keep and out == prev:
        print("✓ 合并完成：与当前 index.html 完全一致（无内容变化）")
    else:
        out = assemble(_bump_label())
        open(INDEX, "w", encoding="utf-8").write(out)
        print(f"✓ 已写出 index.html（{len(out):,} 字符；旧 {len(prev):,}）")
        print(f"  版本号 {_read_meta_ver(out)}")


def _identity(text):
    """把产物头部里「随日期 / 文件 mtime 浮动」的字段抹平，用于内容比对。

    头部 `<!--@tomato-src <base64>-->` 的 JSON 含 {"ver": "<src 最新 mtime 日期>"}，
    它只表示"哪天构建的"，不代表内容差异。而 mtime 会随 git clone / 解压 /
    换机器而变 —— 若它参与逐字节比对，`build.py --check` 会在跨天或异地
    解压后**误报 FAIL**，让接手的人以为仓库坏了。那是环境噪声，不是回归。
    """
    m = re.search(r"<!--@tomato-src ([A-Za-z0-9+/=]+)-->", text)
    if not m:
        return text
    import base64
    try:
        data = json.loads(base64.b64decode(m.group(1)))
    except Exception:
        return text
    data["ver"] = "<volatile>"
    raw = base64.b64encode(json.dumps(data).encode("utf-8")).decode()
    return text[:m.start()] + "<!--@tomato-src " + raw + "-->" + text[m.end():]


def check():
    # 模板产物是否与片段漂移（有人手改 template.html）——这类漂移会被下次 build
    # 静默覆盖、把改动丢掉，必须显形，否则「改了半天没生效」查不出原因。
    try:
        tpl_on_disk = open(TPL, encoding="utf-8").read()
    except FileNotFoundError:
        tpl_on_disk = None
    if tpl_on_disk != load_template():
        print("✗ CHECK FAIL：src/template.html 与片段拼装结果不一致。"
              "template.html 是**产物**，请改 src/template/ 下的片段（勿手改）。")
        return 1
    prev = open(INDEX, encoding="utf-8").read()
    # 用产物里已有的版本号拼：check 只读，不能消耗序号，也不该因为版本号不同就报不等
    out = assemble(_read_meta_ver(prev))
    if out == prev:
        print("✓ CHECK PASS：按 src 合并 == 当前 index.html（逐字节一致）")
        return 0
    # 逐字节不等时，先排除"仅日期戳不同"这种环境噪声再下结论。
    if _identity(out) == _identity(prev):
        print("✓ CHECK PASS：与 index.html 内容一致（仅头部构建日期戳不同 —— mtime 属环境噪声，不算回归）")
        return 0
    print(f"✗ CHECK FAIL：长度 src={len(out)} vs index={len(prev)}")
    return 1


def lint():
    """M5 结构自检：manifest 与 src 文件一致性 + 模板标记完整性 + 产物可重建。"""
    errs = []
    _no_node = False   # 缺 node → 语法检查没跑，最后以退出码 3 报"S KIP"而不是伪装 PASS
    mani = json.load(open(MANI, encoding="utf-8"))
    used_files = set()
    for m in mani["slots"]:
        fs = m.get("files") or ([m["file"]] if m.get("file") else [])
        if not fs:
            errs.append(f"槽{m['slot']} 缺少 file/files"); continue
        for f in fs:
            p = os.path.join(SCRIPTS, f)
            if not os.path.exists(p):
                errs.append(f"槽{m['slot']} 引用的源文件缺失: {f}")
            else:
                used_files.add(f)
    for f in sorted(os.listdir(SCRIPTS)):
        if f not in used_files:
            errs.append(f"src/scripts/ 存在未登记文件: {f}")
    # 模板片段完整性：清单里的片段必须都在，目录里也不能有未登记片段
    try:
        _tpl_order = json.load(open(TPL_ORDER, encoding="utf-8"))["order"]
    except Exception as e:
        errs.append(f"模板片段清单不可读: {e}")
        _tpl_order = []
    _tpl_files = (sorted(f for f in os.listdir(TPL_DIR) if f != "_order.json")
                  if os.path.isdir(TPL_DIR) else [])
    for f in _tpl_order:
        if f not in _tpl_files:
            errs.append(f"模板片段缺失: {f}")
    for f in _tpl_files:
        if f not in _tpl_order:
            errs.append(f"src/template/ 存在未登记片段: {f}")
    tpl = load_template()
    for m in mani["slots"]:
        if MARK.format(n=m["slot"]) not in tpl:
            errs.append(f"模板缺少槽{m['slot']} 标记")
    import re as _re
    leftover = _re.findall(r"<!--@@__JSS_\d+__@@-->", tpl)
    if len(leftover) != len(mani["slots"]):
        errs.append(f"模板占位标记数({len(leftover)})与清单槽数({len(mani['slots'])})不一致")
    out = assemble()
    if not out.strip().endswith("</html>"):
        errs.append("合并产物未以 </html> 结尾")
    # 纯函数守卫：00_pure_core 禁止沾染浏览器/数据依赖（M5 制度）
    import re as _re2
    pure = open(os.path.join(SCRIPTS, "00_pure_core.js"), encoding="utf-8").read()
    if _re2.search(r"(document\.|localStorage\.|sessionStorage\.|appData\.)", pure):
        errs.append("00_pure_core.js 混入浏览器/数据依赖（须保持纯函数）")
    # ===== W6-补：逐文件 JS 语法检查（门禁补漏）=====
    # 为什么必须有这一段：此前 lint 只查"结构一致性"（文件是否登记、标记是否齐全），
    # **不看语法**。结果是：一次批量注释清理误删了注释块的 */ 结束符，把后续代码整个
    # 吸进注释里 —— 结构检查全绿、快链全绿，但页面运行时抛 SyntaxError 直接罢工。
    # 教训：门禁不能只查"结构对不对"，必须查"代码能不能解析"。
    # 用 node --check 逐文件解析（不执行），抓的是真正的语法错误而非风格问题。
    import shutil as _sh
    import subprocess as _sp
    if _sh.which("node"):
        for f in sorted(os.listdir(SCRIPTS)):
            if not f.endswith(".js"):
                continue
            _r = _sp.run(["node", "--check", os.path.join(SCRIPTS, f)],
                         capture_output=True, text=True, timeout=30)
            if _r.returncode != 0:
                _msg = (_r.stderr or "").strip().split("\n")
                _brief = next((x for x in _msg if "SyntaxError" in x), _msg[0] if _msg else "未知")
                _ln = next((x for x in _msg if f in x), "")
                errs.append(f"语法错误 {f}: {_brief} {_ln}".strip())
    else:
        # 环境不具备 ≠ 代码有问题：verify 链据此记 SKIP（退出码 3），不能伪装成绿。
        print("○ 未找到 node —— 逐文件语法检查没跑（exit 3，由 verify 记为 SKIP）")
        _no_node = True
    # ===== 空语句门禁：`foo;` 这类漏掉括号的调用必须报错 =====
    # 为什么必须有这一段：一次"清理开发痕迹"的批量替换把注释里的编号连同 `()` 一起删掉，
    # bioBackfillOnce; / saveData; / waitDataThenSync; 全成了空语句 —— 语法合法、node --check
    # 全绿、结构 lint 全绿，但功能整片失效（传记补记、皮肤缩放保存、折叠记忆同步）。
    # 教训：`X;` 单独成句在 JS 里永远是 no-op，凡出现必是漏括号（break/continue/return/debugger 除外）。
    # 判定交给 tools/js_dead_stmt.py：那里是真正的词法分析（字符串/模板串/正则/注释按 JS 规则
    # 切分）后在 token 流上判定，不是逐行正则 —— 首版逐行正则有 5 类漏报（多语句同行、换行
    # 注释、跨行块注释、嵌套括号、上行以 `)` 结尾被误当续行），而 `node --check` 对空语句永远
    # 合法，门禁一旦静默放行就没人看得见。
    _tdir = os.path.dirname(os.path.abspath(__file__))
    if _tdir not in sys.path:
        sys.path.insert(0, _tdir)
    try:
        from js_dead_stmt import find_dead_statements as _find_dead_statements
    except ImportError as _imp_err:
        errs.append(f"空语句门禁不可用（缺 tools/js_dead_stmt.py）: {_imp_err}")
        _find_dead_statements = lambda _s: []

    for f in sorted(os.listdir(SCRIPTS)):
        if not f.endswith(".js"):
            continue
        _src = open(os.path.join(SCRIPTS, f), encoding="utf-8").read()
        for _line, _text in _find_dead_statements(_src):
            errs.append(f"空语句（疑似漏括号的调用）{f}:{_line}  {_text}")
    # ===== 设计令牌门禁：字号只许走变量 =====
    # 为什么必须有这一段：全项目曾有 49 种字号（含 9.5/10.5/11.5 等半像素），
    # 而 --fs-* 变量早已定义、JS 里引用了 194 次，template.html 却硬编码 655 处 ——
    # 结果是"看着不专业"说不出哪不对。已一次性收编到 9 档；此处挂门禁防回流。
    # 豁免两类（它们各有理由，不是漏网）：① @media 内的响应式缩放 ② >24px 的
    # 时钟/大数字显示字号（各自独用、互不相邻，强行归并会压缩版面）。
    def _fs_media_ranges(s):
        out, i = [], 0
        while True:
            i = s.find("@media", i)
            if i < 0:
                return out
            j = s.find("{", i)
            if j < 0:
                return out
            d, k = 1, j + 1
            while k < len(s) and d > 0:
                if s[k] == "{":
                    d += 1
                elif s[k] == "}":
                    d -= 1
                k += 1
            out.append((i, k))
            i = k

    import re as _re3
    _fs_targets = [TPL] + [os.path.join(SCRIPTS, f) for f in sorted(os.listdir(SCRIPTS)) if f.endswith(".js")]
    _fs_bad = []
    for _p in _fs_targets:
        _src = open(_p, encoding="utf-8").read()
        _rs = _fs_media_ranges(_src) if _p.endswith(".html") else []
        for _m in _re3.finditer(r"font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)px", _src):
            _v = float(_m.group(1))
            if _v > 24:
                continue
            if any(a <= _m.start() < b for a, b in _rs):
                continue
            _ln = _src[:_m.start()].count("\n") + 1
            _fs_bad.append(f"{os.path.relpath(_p, ROOT)}:{_ln} font-size:{_m.group(1)}px")
    if _fs_bad:
        errs.append(
            "字号硬编码 %d 处（须改用 var(--fs-*)，档位见 template.html :root）：" % len(_fs_bad)
            + "；".join(_fs_bad[:6])
            + (" …" if len(_fs_bad) > 6 else "")
        )
    # ===== 设计令牌门禁（续）：圆角只许走变量 =====
    # 为什么必须有这一段：全项目曾有 19 种圆角（2/3/4/5/6/7/8/9/10/11/12/14/16/18/20/22/24/26/30px）。
    # 其中 20/26/30px 长在高度 17~42px 的胶囊/badge 上 —— 圆角早已超过半高、本就渲染成药丸，
    # 那是"语义写错"而非"尺度漂移"。已一次性收编到 7 档
    # （--radius-xs 4 / -sm 6 / --radius 8 / -md 12 / -lg 16 / -xl 24 / -full 999）；
    # 此处挂门禁防回流，与上面的字号门禁同源同理。
    # 豁免：@media 内的响应式缩放、0、百分比圆形（头像）、已写成 var() 的。
    _rd_bad = []
    for _p in _fs_targets:
        _src = open(_p, encoding="utf-8").read()
        _rs = _fs_media_ranges(_src) if _p.endswith(".html") else []
        for _m in _re3.finditer(r"border-radius\s*:\s*([^;}\n]+)", _src):
            _raw = _m.group(1).rstrip("\"'> ").strip()
            if "var(" in _raw or "%" in _raw:
                continue
            if any(a <= _m.start() < b for a, b in _rs):
                continue
            if not _re3.search(r"[0-9]+px", _raw):
                continue
            _ln = _src[:_m.start()].count("\n") + 1
            _rd_bad.append(f"{os.path.relpath(_p, ROOT)}:{_ln} border-radius:{_raw}")
    if _rd_bad:
        errs.append(
            "圆角硬编码 %d 处（须改用 var(--radius-*)，档位见 template.html :root）：" % len(_rd_bad)
            + "；".join(_rd_bad[:6])
            + (" …" if len(_rd_bad) > 6 else "")
        )
    # ===== 设计令牌门禁（续 2）：间距只许走变量 =====
    # 为什么必须有这一段：全项目曾有 25 种间距字面量（1~40px 几乎每个整数都有）。
    # 已一次性收编到 10 档 --sp-2/4/6/8/10/12/14/16/20/24（档位按实际用量定，不硬套 4px 栅格）。
    # 此处挂门禁防回流。豁免：@media 内的响应式缩放、>24px（大留白/时钟版面）、
    # 负值（定位偏移）、百分比/auto/calc/var()。
    # CSS 与 JS 内联样式用同一套语法，一起扫。
    _sp_bad = []
    _sp_ok = {2, 4, 6, 8, 10, 12, 14, 16, 20, 24}   # 合法档位
    _sp_props = r"(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|bottom|left|right))?"
    for _p in _fs_targets:
        _src = open(_p, encoding="utf-8").read()
        _rs = _fs_media_ranges(_src) if _p.endswith(".html") else []
        for _m in _re3.finditer(_sp_props + r"\s*:\s*([^;}\"'\\\\\n]+)", _src):
            _raw = _m.group(1).strip()
            if any(x in _raw for x in ("var(", "%", "auto", "calc(")):
                continue
            if any(a <= _m.start() < b for a, b in _rs):
                continue
            _hit = False
            for _t in _raw.split():
                _mm = _re3.fullmatch(r"(-?)(\d+)px", _t)
                if _mm and not _mm.group(1) and 1 <= int(_mm.group(2)) <= 24 and int(_mm.group(2)) not in _sp_ok:
                    _hit = True
            if _hit:
                _ln = _src[:_m.start()].count("\n") + 1
                _sp_bad.append(f"{os.path.relpath(_p, ROOT)}:{_ln} {_raw}")
    if _sp_bad:
        errs.append(
            "间距硬编码 %d 处（须改用 var(--sp-*)，档位见 template.html :root）：" % len(_sp_bad)
            + "；".join(_sp_bad[:6])
            + (" …" if len(_sp_bad) > 6 else "")
        )
    # ===== 颜色审计：只告警、不阻断 =====
    # 为什么是告警而不是 FAIL：颜色与前三维不同源。字号/圆角/间距是"同一意图写了不同数"，
    # 可机械归并；颜色是"不同意图 + 部分笔误"混合 —— 实测存在 "#eee(16x) ~ --bg#f5f0e8"
    # 与 "#1a2440(8x) ~ #1b2440(笔误)" 两类，色差一样大而性质相反，脚本无法区分，
    # 强转会做出肉眼可见的错误（把灰底改成米色）。故此处只把规模暴露出来，改动留给人做。
    # 明细与建议走 `python3 tools/w6_color.py`。
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import w6_color as _wc
        _rep = _wc.audit()
        print("⚠ 颜色审计 %d 种字面量/%d 处 ｜ 变量 %d 个 ｜ 与变量精确同值 %d 处 ｜ 近似对 %d 组"
              "（不阻断；明细 python3 tools/w6_color.py）"
              % (_rep["literal_shades"], _rep["literal_occurrences"], _rep["var_shades"],
                 _rep["exact_total"], len(_rep["near_pairs"])))
    except Exception as _e:
        print("⚠ 颜色审计跳过：%s" % _e)
    # ===== （可回退）：窗口暴露同名审计 —— 同名冲突=硬错误，白名单超界=告警 =====
    # 依据 tools/win_whitelist.py（从 template 内联事件 + 脚本 window 桥接自动提取的事实白名单）
    # 告警仅存数目摘要，明细走 `python3 tools/win_whitelist.py`，避免刷屏淹没真正的错误
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import win_whitelist as _ww
        _errs, _warns, _r = _ww.audit()
        errs.extend(_errs)
        if _warns:
            print(f"⚠ 白名单告警 {len(_warns)} 项（不阻断，明细见 tools/win_whitelist.py）")
        _globals_summary = f"{_r['union_count']} 项"
    except Exception as _e:  # 审计工具异常不阻断构建，但必须可见
        print(f"⚠ 白名单审计跳过（{type(_e).__name__}: {_e}）")
        _globals_summary = "未审计"
    # ===== （可回退）：innerHTML 注入扫描 —— 新增"用户源未转义"点=告警 =====
    # 依据 tools/innerhtml_scan.py（启发式定位 + 基线登记）。启发式误报不可当门禁，
    #   故只对"基线外的可疑点"告警，强制人工复核；明细走 `python3 tools/innerhtml_scan.py`。
    try:
        import innerhtml_scan as _is
        _ierrs, _iwarns, _irep = _is.audit()
        errs.extend(_ierrs)
        if _iwarns:
            print(f"⚠ 注入扫描告警 {len(_iwarns)} 项（不阻断，明细见 tools/innerhtml_scan.py）")
        _inj_summary = f"{_irep['api_sites']} 注入点/{_irep['dynamic']} 动态"
    except Exception as _e:
        print(f"⚠ 注入扫描跳过（{type(_e).__name__}: {_e}）")
        _inj_summary = "未扫描"
    if errs:
        print("✗ LINT FAIL")
        for e in errs:
            print("   -", e)
        return 1
    if _no_node:
        print("○ LINT 未完全验证：本机缺 node，逐文件语法检查跳过（exit 3 → verify 记 SKIP）")
        return 3
    print(f"✓ LINT PASS：{len(mani['slots'])} 槽 / {len(used_files)} 源文件 / 模板一致 / 产物可重建 / 窗口暴露 {_globals_summary} / 注入 {_inj_summary}")
    return 0


# ---------------------------------------------------------------------------
# 多文件产物（--multi）：public/index.html + assets/*.js + assets/*.css
#
# 设计约束（与单文件产物并存，互不影响）：
#   · 9 个槽各出一个外部文件，**不合并、不加 defer** —— <script src> 不带 defer
#     与内联 <script> 的执行时机完全一致，只多一次请求；
#   · 槽 1 的 data-page-node-id / data-pnid-children 原样保留在 <script src> 上；
#   · 两个 <style> 块合并成一个 assets/style.<hash>.css，id="jyvx-css" 挂到 <link>；
#   · 多产物**不写** <!--@tomato-src--> 恢复清单：它的 parts 偏移对应的是内联布局，
#     外链后无法据此还原 src/，写了反而会误导。
# ---------------------------------------------------------------------------
PUB = os.path.join(ROOT, "public")

# 独立模块清单（--split）：源文件 → 模块名。只放**已验证无对外依赖**的叶子层。
# 第一块是 00_pure_core（callgraph 实测 out-edges = 0），后续按层往上加。
SPLIT_MODULES = {
    "00_pure_core.js": "core",
}


def _node_exports(path):
    """用 acorn 取顶层声明，返回 (名字列表, export 语句)。"""
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "gen_bridge.js"), "--exports", path],
                       capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print("✗ 生成导出失败：" + (r.stderr or r.stdout)[-500:]); sys.exit(1)
    stmt = r.stdout.strip()
    inner = stmt[stmt.index("{") + 1:stmt.rindex("}")]
    names = [x.strip() for x in inner.split(",") if x.strip()]
    return names, stmt


def scan_styles(text):
    """扫出真实的 <style> 块（跳过 HTML 注释里的假标签）。返回 [(start, end, open_tag, body)]。"""
    res = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("<!--", i):
            j = text.find("-->", i + 4)
            i = n if j < 0 else j + 3
            continue
        if text.startswith("<style", i) and (i + 6 >= n or not (text[i + 6].isalpha() or text[i + 6] in "/")):
            te = tag_end(text, i)
            if te < 0:
                break
            ce = find_ci(text, "</style>", te)
            if ce < 0:
                break
            res.append((i, ce + len("</style>"), text[i:te], text[te:ce]))
            i = ce + len("</style>")
            continue
        i += 1
    return res


def _sha12(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]

def _site_build_id(idx_path, assets_dir):
    """站点版本号 = index.html + assets/ 全部文件的 sha256 前 12 位。

    ★ 只取 index.html 是不够的（2026-11-05 实测踩到）：模块化构建后脚本文件名是
    **固定**的 assets/app.js，不随内容变哈希。于是「只改了 JS、没改 CSS/模板」的一次
    发版，index.html 逐字节不变 → BUILD_ID 不变 → sw.js 内容也不变 → 浏览器认为
    Service Worker 没更新，继续拿 cache-first 里那份旧 app.js。
    表现：源码和线上都改好了，装了 PWA 的用户点按钮还是老行为，刷新清缓存都没用
    （缓存名没换，activate 里那套"删旧代"也就不会动它）。
    把 assets 一起算进哈希，任何一种文件变化都会换一代缓存，SW 才会真的更新。
    """
    h = hashlib.sha256()
    h.update(open(idx_path, "rb").read())
    if os.path.isdir(assets_dir):
        for root, _dirs, files in os.walk(assets_dir):
            for f in sorted(files):
                p = os.path.join(root, f)
                h.update(os.path.relpath(p, assets_dir).replace(os.sep, "/").encode("utf-8"))
                h.update(open(p, "rb").read())
    return h.hexdigest()[:12]


def _emit_multi(dest=PUB, module=False):
    """把多产物渲染到 dest（默认 public/）。--check 用它渲染到临时目录做逐字节比对。

    module=True 时把 9 个槽合成**一个** ES 模块（`--module`），并生成 window 公开接口；
    这一步不减少体积，只是把"全局作用域"换成"模块作用域"，为后续按层拆分铺路。
    """
    import base64  # noqa: F401  (保持与单文件同一套解析口径)
    mani = json.load(open(MANI, encoding="utf-8"))
    tpl = load_template()
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    assets = os.path.join(dest, "assets")
    os.makedirs(assets)

    # ---- 样式：两个块合并成一个文件 ----
    blocks = scan_styles(tpl)
    css = "\n".join(minify_css(b[3]) for b in blocks)
    css_hash = _sha12(css)
    css_name = "style.%s.css" % css_hash
    open(os.path.join(assets, css_name), "w", encoding="utf-8").write(css)

    # 自后向前替换，保持前段偏移有效；第一块换成 <link>，其余删除
    for idx in range(len(blocks) - 1, -1, -1):
        st, en, open_tag, _body = blocks[idx]
        if idx == 0:
            repl = '<link id="jyvx-css" rel="stylesheet" href="assets/%s">' % css_name
        else:
            repl = ""
        tpl = tpl[:st] + repl + tpl[en:]

    # ---- 脚本：每个槽一个文件 ----
    order = [int(x) for x in re.findall(r"<!--@@__JSS_(\d+)__@@-->", tpl)]
    by = {m["slot"]: m for m in mani["slots"]}
    written = []
    split_mods = []
    debug_parts = []
    NO_MINIFY = "--no-minify" in sys.argv
    for sid in order:
        m = by.get(sid)
        if not m:
            continue
        if m.get("files"):
            body = "".join(open(os.path.join(SCRIPTS, f), encoding="utf-8").read() for f in m["files"])
        else:
            body = open(os.path.join(SCRIPTS, m["file"]), encoding="utf-8").read()
        raw_body = body
        body = minify_js(body) if not NO_MINIFY else body
        # 默认开启拆分（叶子层无依赖，安全）；--no-split 可整体关掉，便于 A/B。
        split_name = SPLIT_MODULES.get(m.get("file") or "") if (module and "--no-split" not in sys.argv) else None
        if split_name:
            _names, _stmt = _node_exports(os.path.join(SCRIPTS, m["file"]))
            _mod = body + "\n;\n" + _stmt
            _fn = "%s.%s.js" % (split_name, _sha12(_mod))
            open(os.path.join(assets, _fn), "w", encoding="utf-8").write(_mod)
            split_mods.append(("assets/" + _fn, _names))
            tpl = tpl.replace(MARK.format(n=sid), "")
            continue
        name = "app.%d.%s.js" % (sid, _sha12(body))
        open(os.path.join(assets, name), "w", encoding="utf-8").write(body)
        debug_parts.append((name, raw_body))
        written.append("assets/" + name)
        open_tag = m["open"]
        if open_tag.endswith("/>"):
            tag = open_tag[:-2] + ' src="assets/%s">' % name
        else:
            tag = open_tag[:-1] + ' src="assets/%s">' % name
        tpl = tpl.replace(MARK.format(n=sid), tag + m["close"])
    if MARK.format(n=0) in tpl or re.search(r"<!--@@__JSS_\d+__@@-->", tpl):
        print("✗ 多产物：仍有未填充的槽标记"); sys.exit(1)

    # ---- config.js：运行期配置门（现在全默认，接后端时只改这一个文件） ----
    cfg = (
        "/* 构建生成，勿手改。空 apiBase = 纯本地模式。 */\n"
        "window.TF_CONFIG = window.TF_CONFIG || {\n"
        "  apiBase: '',\n"
        "  analytics: { provider: '', id: '' },\n"
        "  version: '%s',\n"
        "  features: { sync: false, community: false }\n"
        "};\n"
    ) % _sha12(tpl)
    open(os.path.join(dest, "config.js"), "w", encoding="utf-8").write(cfg)
    # 必须容错：config.js 404 不能连带整页崩（业务侧一律 (window.TF_CONFIG||{}).xxx）
    tag_cfg = '<script src="config.js" onerror="window.TF_CONFIG=window.TF_CONFIG||{}"></script>'
    first_script = tpl.find('<script src="assets/')
    if first_script < 0:
        print("✗ 多产物：找不到脚本标签，无法注入 config.js"); sys.exit(1)
    tpl = tpl[:first_script] + tag_cfg + "\n" + tpl[first_script:]

    idx_path = os.path.join(dest, "index.html")
    open(idx_path, "w", encoding="utf-8").write(tpl)

    # ---- 静态附属：manifest / icons / sw.js ----
    shutil.copy2(os.path.join(WEB_DIR, "manifest.webmanifest"), os.path.join(dest, "manifest.webmanifest"))
    if os.path.isdir(os.path.join(WEB_DIR, "icons")):
        shutil.copytree(os.path.join(WEB_DIR, "icons"), os.path.join(dest, "icons"))
    # 字体走**静态文件名**，不加内容哈希：它们已经按站点字符集裁过，改动极少（见 tools/fonts/README）
    if os.path.isdir(os.path.join(WEB_DIR, "fonts")):
        shutil.copytree(os.path.join(WEB_DIR, "fonts"), os.path.join(dest, "fonts"))

    build_id = _site_build_id(idx_path, assets)
    sw = open(os.path.join(WEB_DIR, "sw.js"), encoding="utf-8").read().replace("__BUILD_ID__", build_id)
    precache = ["./", "./index.html", "./manifest.webmanifest", "assets/" + css_name] + written
    # 字体 / 图标不进按版本换代的 PRECACHE：它们**永不变化**，但每次发版换代都要重下
    # 一遍（光是文楷首屏块就 488 KB）。放进 STATIC_CACHE，跨版本共用，只在缺的时候补。
    # ★ 超过 PRECACHE_LIMIT 的单个字体**不预缓存**：文楷备用块有 1.15 MB，装 SW 时下它
    #   等于把「拆块」白做了 —— 它只在页面上真出现生僻字时由 fetch 处理器惰性缓存。
    static = ["./icons/icon-192.png", "./icons/icon-512.png"]
    font_dir = os.path.join(dest, "fonts")
    if os.path.isdir(font_dir):
        static += sorted("fonts/" + n for n in os.listdir(font_dir)
                         if n.endswith(".woff2")
                         and os.path.getsize(os.path.join(font_dir, n)) <= PRECACHE_LIMIT)
    sw = re.sub(r"const PRECACHE = \[.*?\];", "const PRECACHE = " + json.dumps(precache, ensure_ascii=False) + ";",
                sw, count=1, flags=re.S)
    sw = re.sub(r"const STATIC_ASSETS = \[.*?\];",
                "const STATIC_ASSETS = " + json.dumps(static, ensure_ascii=False) + ";",
                sw, count=1, flags=re.S)
    open(os.path.join(dest, "sw.js"), "w", encoding="utf-8").write(sw)

    # ---- 分组拆模块（默认）：core / base / engine / app ----
    if module and "--no-split" not in sys.argv:
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        import group_split
        written = group_split.transform(dest)
        tpl = open(os.path.join(dest, "index.html"), encoding="utf-8").read()

    if "--debug" in sys.argv and dest == PUB:
        # 排错用：行号对得上 src，不给线上引用
        open(os.path.join(assets, "style.debug.css"), "w", encoding="utf-8").write(
            "\n".join(b[3] for b in blocks))
        open(os.path.join(assets, "app.debug.js"), "w", encoding="utf-8").write(
            "\n;\n".join(b for _n, b in debug_parts))
        print("  ↳ 调试产物：assets/style.debug.css、assets/app.debug.js（未压缩，不参与预缓存）")

    return {"index": idx_path, "scripts": written, "css": css_name,
            "build_id": build_id, "precache": precache}


def build_multi():
    dest = PUB
    if "--out" in sys.argv:
        dest = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])
    module = "--classic" not in sys.argv          # 2026-10-23 起默认 ES 模块；--classic 回退到 9 个普通 script
    # ★ 多产物路径同样要刷新 src/template.html。它是拼装产物，E2E 和各审计工具读的是它；
    #   原来只有单文件 build() 会同步，默认的 build_multi() 一直漏掉 ——
    #   结果改完片段、线上是对的，但 template.html 停在几天前的样子，
    #   谁去 grep 它都会得出「这个改动没生效」的错误结论。
    if "--no-sync" not in sys.argv:
        if sync_template():
            print("✓ 已由片段同步 src/template.html（模板产物）")
    r = _emit_multi(dest, module=module)
    print("✓ %s：%d 个脚本 · 1 个样式 · BUILD_ID %s%s"
          % (os.path.relpath(dest, ROOT), len(r["scripts"]), r["build_id"],
             "（ES 模块）" if module else ""))
    print("  预缓存 %d 项；index.html %.1f KB" % (len(r["precache"]), os.path.getsize(r["index"]) / 1024))
    if module:
        print("  ⚠ file:// 打不开模块页（CORS），预览必须走 http：python3 -m http.server 8080 --directory %s"
              % os.path.relpath(dest, ROOT))
    return 0


def _list_rel(root):
    out = {}
    for dp, _dn, fn in os.walk(root):
        for name in fn:
            p = os.path.join(dp, name)
            out[os.path.relpath(p, root).replace(os.sep, "/")] = p
    return out


def check_multi():
    """校验 public/ 能否由 src/ 精确重建：渲染到临时目录，逐文件逐字节比对。

    为什么不用「比 index.html 一份」：多产物是一组文件，少一个 assets/app.7.*.js
    或者 sw.js 的预缓存清单过期，单看 index.html 都发现不了 —— 线上就是白屏 / 缓存打不中。
    文件名带内容哈希，所以「名字对不上」等价于「内容对不上」。
    """
    import tempfile
    if not os.path.isdir(PUB):
        print("✗ CHECK FAIL：public/ 不存在。先跑 python3 tools/build.py")
        return 1
    # 按**盘上产物形态**决定比对口径：public/ 里有 app.mod.* 就是模块模式，
    # 否则是 9 个普通 script。这样--check 不会因为上次用了 --classic 就误报。
    import glob as _glob
    module_mode = bool(_glob.glob(os.path.join(PUB, "assets", "app.mod.*.js"))
                       or _glob.glob(os.path.join(PUB, "assets", "app.js")))
    if "--classic" in sys.argv:
        module_mode = False
    tmp = tempfile.mkdtemp(prefix=".pz-check-")
    try:
        _emit_multi(tmp, module=module_mode)
        want, have = _list_rel(tmp), _list_rel(PUB)
        missing = sorted(set(want) - set(have))
        extra = sorted(k for k in set(have) - set(want) if not k.startswith("assets/") or True)
        diffs = []
        for rel in sorted(set(want) & set(have)):
            a = open(want[rel], "rb").read()
            b = open(have[rel], "rb").read()
            if a != b:
                diffs.append(rel)
        if missing or extra or diffs:
            print("✗ CHECK FAIL：public/ 与 src/ 重建结果不一致")
            for rel in missing[:10]:
                print(f"   · 缺文件 {rel}")
            for rel in extra[:10]:
                print(f"   · 多文件 {rel}（旧构建残留？）")
            for rel in diffs[:10]:
                print(f"   · 内容不同 {rel}（盘上 {os.path.getsize(have[rel])}B / 重建 {os.path.getsize(want[rel])}B）")
            print("   修复：python3 tools/build.py")
            return 1
        print(f"✓ CHECK PASS：public/ {len(want)} 个文件与 src/ 重建结果逐字节一致")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "split":
        split()
    elif "--check" in sys.argv:
        # 默认校验多产物（唯一发布物）；--single 才校验历史单文件产物
        sys.exit(check() if "--single" in sys.argv else check_multi())
    elif "--single" in sys.argv:
        sys.exit(build())
    elif "--lint" in sys.argv:
        sys.exit(lint())
    elif "--bump" in sys.argv:
        # 只刷版本号、不重建内容：把当天序号往前推一格并重写产物首行。
        # 用途：改了 sw.js / 图标这类不进 index.html 的东西后，也想让页脚版本号动一下。
        if not os.path.exists(INDEX):
            print("✗ 没有单文件产物 index.html（2026-10-22 起已停用）。")
            print("  需要它做本地预览或自包含产物时：python3 tools/build.py --single")
            sys.exit(1)
        _p = open(INDEX, encoding="utf-8").read()
        _new = assemble(_bump_label())
        _new = _new[:_new.index("\n") + 1] + _p[_p.index("\n") + 1:]
        open(INDEX, "w", encoding="utf-8").write(_new)
        print("✓ 版本号已推进到 " + str(_read_meta_ver(_new)))
    else:
        # 默认 = 多产物（public/，单个 ES 模块）。单文件只在显式 --single 时生成。
        sys.exit(build_multi())

