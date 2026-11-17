#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""· 层依赖方向规则检查（架构耦合度核心）

为什么需要它：
    项目拆成 69 个文件后，"谁能依赖谁"全靠口头约定（文件头那些「红线」注释）。
    约定没有强制执行 = 迟早被绕过，最后变成"所有文件都依赖所有文件"的大泥球。
    本工具把约定变成**可执行的规则**，新增违例立刻报出来。

层级的**唯一来源是源文件第一行的 `// @layer: Lx`**（2026-11-16 起）。
这里原来还有一张 69 行的 `LAYER = {文件: 层}` 中央表做回落，已整表删除：
同一条事实存两份，两侧一致只是运气，不一致时任何一边都不可信 —— 删掉一份，
「两侧不一致」这个失效模式就从构造上不存在了。当前哪个文件在哪一层，用
`python3 tools/w6_layer.py --list` 看（由文件头生成，不会漂）。

新增文件只写一处：文件头那行。漏写 = FAIL，不再有「忘了登记 = 自动豁免」。

层级定义：

    L0 纯函数层   00_pure_core.js
        —— 只放不碰 DOM/appData/存储的纯函数。**不许依赖任何东西**。

    L1 引擎层     01a~01g（prelude/data/timer/features/ui/immersive/init）
        —— 业务主干。可依赖 L0，L1 内部按 01a→01b→…→01g 顺序单向即可
           （实践中允许引擎内部互相调用，因为它们是同一层被拆分的结果）。

    L2 增强层     02/03/04/05/0E
        —— 包装式注入。可依赖 L0/L1，**不许依赖 L3/L4**（增强模块不能反向要求插件）。
           0E_theme_主题引擎 属此层：纯前端换肤，只改 body[data-theme] 与 CSS 变量，
           对 appData 只有读写 settings.theme 一处，不反向要求上层。

    L3 横切层     06_errRep / 07_uiFold / 08_component_registry / 09_a11y
        —— 基础设施，被所有层用但不依赖业务。**只可依赖 L0**。

    L4 胶水层     0A/0B/0C/0D（W3/W5 新增的路由、弹窗、store）
        —— 最晚加载，可依赖 L0~L3，**不许被 L0~L3 依赖**（否则加载顺序会崩）。

违例判定：
  - 静态扫描 A 文件里对 B 文件顶层函数名的调用（本工具沿用正则口径，属"结构耦合的
    近似画像"；**精确版见 tools/callgraph_ast.js**——AST 版额外覆盖 state/dom 两类边
    与重名函数丢失问题。两者共存：本工具是快检门禁，AST 版是画像与反查）；
  - 若 B 的层级 > A 的层级（数字更大 = 更晚/更上层），记一条违例；
  - 但允许**运行时防御式调用**：形如 `typeof foo === 'function'` 或
    `window.store && window.store.x` —— 这是本项目刻意的降级写法，不算违例，
    单独归类为「软依赖」计数。

用法：
  python3 tools/w6_layer.py            # 报告 + 退出码（有硬违例/未登记/自相矛盾 = 1）
  python3 tools/w6_layer.py --json     # 结构化（含 layer_from_header / layer_problems）
  python3 tools/w6_layer.py --brief    # 只打印失败项（lint 用这个：声明问题 + 硬违例）
  python3 tools/w6_layer.py --list     # 按层分组列出文件（人读的唯一入口，避免文档漂）

lint 为什么必须跑它
  2026-11-15 造过一处冲突（表里 L3、文件头 L0）：w6_layer.py 自己报得出来，
  但 `build.py --lint` 完全不管层级 —— 发版路径（pre-commit → 上线.sh）照绿。
  判据放在只被 verify 调用的工具里 = 只要有人只跑 lint 就失灵。现在 lint 直接调它，
  而且跑完整判定（不只查语法式的声明完整性）：把某文件的层改错，方向违例立刻红。
"""
import glob
import json
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
SCRIPTS = os.path.join(_ROOT, "src", "scripts")

AS_JSON = "--json" in sys.argv
BRIEF = "--brief" in sys.argv
LIST = "--list" in sys.argv

# ---- 层级归属：没有表了（2026-11-16） ----
# 原来这里是 69 行手写 `LAYER = {文件: 层}`，与文件头 `// @layer:` 同存一份事实。
# 表里的注释（「同步层：只读数据结构 + 适配器」「事件委托：只依赖 DOM」等）不是新信息，
# 各文件头第二段本来就在讲这件事，所以整表删除、零行迁移。理由见文件头。

LAYER_NAME = {0: "L0 纯函数", 1: "L1 引擎", 2: "L2 增强", 3: "L3 横切", 4: "L4 胶水"}

# ---- 层级的第一来源：文件头 `// @layer: Lx`（2026-11-15） ----
# 为什么搬家：层级原来只存在于上面这张中央表里，于是「新增一个文件」的代价里有
# 「记得去改另一处」，而漏改的表现是——新文件自动豁免方向检查。最省事的做法恰好最坏。
# 现在每个源文件第一行自己声明层级，中央表已于 2026-11-16 整表删除 ——
# 不存在「文件头读不到就回落」这回事，读不到就是漏写、直接 FAIL。
# 验收标准是「新增文件只写文件头这一处」。
LAYER_DECL_RE = re.compile(r"^\s*//\s*@layer:\s*L([0-4])\s*$", re.M)
HEAD_SCAN_LINES = 12   # 只在前 12 行找：正文里偶然出现的同名注释不算声明


def declared_layer(text):
    """从文件头读 `// @layer: Lx`；没有则 None。"""
    head = "\n".join(text.splitlines()[:HEAD_SCAN_LINES])
    m = LAYER_DECL_RE.search(head)
    return int(m.group(1)) if m else None


def declared_layers_all(text):
    """文件头里出现的全部 `@layer` 值（按出现顺序）。用于查「同一个文件自己说自己两层」。"""
    head = "\n".join(text.splitlines()[:HEAD_SCAN_LINES])
    return [int(m.group(1)) for m in LAYER_DECL_RE.finditer(head)]


def resolve_layers(names, texts):
    """只读文件头。返回 (effective, problems, n_from_head)。

    problems 每条是 (文件名, 类别, 明细)：
      missing    —— 文件头没有 `// @layer: Lx`。这是 FAIL，不是"默认 L1"：
                    漏写的后果是该文件永远绕过方向检查，而"忘了写"恰好是最省事的通过方式。
      ambiguous  —— 前 12 行里写了两个不同的 @layer。同一份文件自相矛盾，
                    取第一个是猜测，不是解析 —— 报错让人改，别替人做决定。
    """
    eff, problems, n_head = {}, [], 0
    for n in names:
        vals = declared_layers_all(texts[n])
        uniq = sorted(set(vals))
        if not vals:
            problems.append((n, "missing", "文件头前 %d 行没有 `// @layer: Lx`" % HEAD_SCAN_LINES))
        elif len(uniq) > 1:
            problems.append((n, "ambiguous", "前 %d 行出现 %d 个不同声明：%s"
                             % (HEAD_SCAN_LINES, len(uniq), ", ".join("L%d" % v for v in vals))))
        else:
            eff[n] = uniq[0]
            n_head += 1
    return eff, problems, n_head

RE_FUNC = re.compile(r"^\s*function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)

# 通用短名/方法名黑名单：这些词在本项目里几乎总是局部变量、内置方法或配置键，
# 作为"跨文件函数调用"的证据价值极低，误报会淹没真问题。
# 判定原则：名字 ≤6 字符 且 属于下列常用词 → 不作为依赖证据。
COMMON_NOISE = {
    "push", "pop", "shift", "unshift", "slice", "splice", "join", "map", "filter",
    "forEach", "find", "some", "every", "reduce", "sort", "concat", "indexOf",
    "remove", "add", "get", "set", "has", "list", "done", "cell", "wrap", "apply",
    "resolve", "reject", "then", "catch", "bind", "call", "enabled", "unlocked",
    "warn", "error", "log", "info", "debug", "build", "init", "update", "render",
    "show", "hide", "close", "open", "reset", "clear", "load", "save", "check",
    "journey", "state", "value", "name", "type", "key", "data", "item", "items",
    "vis", "run", "verNum", "curVer", "allDone", "totalPomos", "_recs", "annSeen",
    "backupRecordsCSV", "errBadgeOff", "updateTitle",
}

# 字符串字面量与注释剥离：只有"真实代码"里的调用来算依赖证据
def strip_noise(text):
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", " ", text)
    return text


# 本模块内部的绑定名（const/let/var 声明、形参、内层 function 名）——粗粒度作用域过滤。
# 为什么需要：01e8 里 `const pick = function(arr){...}` 与 0E 里跨模块的 pick()
# 同名，正则会把它误判成"L1 依赖 L2"。这是 callgraph_ast.js 用 AST 精确解决的，
# 这里用「全文件收集声明名 + 行号」的近似手法兜住最常见的误报形态，
# 并把抑制结果**逐条打印**（含声明行号），避免抑制变成新的静默漏报面。
RE_LOCAL_DECL = re.compile(
    r"(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)"
    r"|\bfunction\s+([A-Za-z_$][\w$]*)"
    r"|\(([^()]*)\)\s*=>)"          # 箭头函数形参（粗提）
)


def local_bindings(code):
    """返回 {绑定的名字 -> [声明出现的行号]}。
    带行号是为了让「已抑制」清单可审计——人能去源码那一行确认它真是局部声明。

    ⚠️ 必须传**未剥注释的原文**，否则行号会整体偏移（剥注释会删行/换行）。
    """
    names = {}

    def add(name, pos):
        ln = code.count("\n", 0, pos) + 1
        names.setdefault(name, []).append(ln)

    for m in re.finditer(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)", code):
        add(m.group(1), m.start(1))
    for m in re.finditer(r"\bfunction\s+([A-Za-z_$][\w$]*)", code):
        add(m.group(1), m.start(1))
    # 解构：const {a, b: c} = x / const [x, y] = z —— 逐个 token 各自定位
    for m in re.finditer(r"\b(?:const|let|var)\s*[\[{]([^\]}]*)[\]}]", code):
        base = m.start(1)
        for tm in re.finditer(r"[A-Za-z_$][\w$]*", m.group(1)):
            add(tm.group(0), base + tm.start())
    # 箭头函数形参：(a, b) => —— 逐个 token 各自定位
    for m in re.finditer(r"\(([^()]{0,200})\)\s*=>", code):
        base = m.start(1)
        for tm in re.finditer(r"[A-Za-z_$][\w$]*", m.group(1)):
            add(tm.group(0), base + tm.start())
    return names


def report_decl(problems, names):
    """只报层级声明问题。由 --brief 在 problems 非空时调用 —— 此时方向扫描已经跑完，
    这里不要再扫一遍（那是重复 0.5s）。"""
    if not problems:
        print(f"✓ 层级声明：{len(names)} 个文件全部在前 12 行声明了合法 @layer")
        return 0
    print(f"✗ 层级声明有问题 {len(problems)} 处（层级唯一来源是文件头的 `// @layer: Lx`）：")
    for n, kind, detail in problems:
        print(f"    {n}  [{kind}]  {detail}")
    print("  修法：每个 src/scripts/*.js 的文件头必须有且只有一个 `// @layer: L0|L1|L2|L3|L4`。")
    print("        新增文件只写这一处，不需要改任何中央表（表已删除）。")
    return 1


def list_layers(eff):
    """按层分组列文件 —— 文档里要提「某文件在几层」时看这里，别手写（会漂）。"""
    for lv in sorted(set(eff.values())):
        fs = sorted(n for n, v in eff.items() if v == lv)
        print(f"\n{LAYER_NAME[lv]}（{len(fs)} 个）")
        for n in fs:
            print(f"  {n}")
    return 0


def main():
    files = sorted(glob.glob(os.path.join(SCRIPTS, "*.js")))
    names = [os.path.basename(p) for p in files]
    texts = {os.path.basename(p): open(p, encoding="utf-8").read() for p in files}

    # 层级：只读文件头
    eff, problems, n_head = resolve_layers(names, texts)

    if LIST:
        return list_layers(eff)

    # 每个文件导出的顶层函数名 → 归属文件
    owner = {}
    for n in names:
        for m in RE_FUNC.finditer(texts[n]):
            fn = m.group(1)
            owner.setdefault(fn, n)

    # 没读到层级的文件不参与方向判定（它们在 report_decl 里已经判过一次 FAIL）
    unregistered = [n for n in names if n not in eff]

    # 一次性提取每个文件里出现的"所有函数调用名"（形如 name(），避免下面
    # 对 (文件 × 函数) 做 O(N×M) 次全文正则——那是 18 秒的来源。
    call_re = re.compile(r"\b([A-Za-z_$][\w$]*)\s*\(")
    calls_in = {}
    for n in names:
        calls_in[n] = set(call_re.findall(strip_noise(texts[n])))

    # 每文件的局部绑定名（用于抑制「同名局部变量 vs 跨模块函数」的误报）。
    # 用**原文** texts[n]（非 strip_noise），否则行号会偏移、无法人工复核。
    #     注释里出现的 `const xxx` 也会被收进来，但那只影响「是否抑制」的召回，
    #     不影响本清单的可审计性（行号指向原文，能直接看）。
    locals_in = {n: local_bindings(texts[n]) for n in names}

    hard, soft = [], []
    suppressed = []
    for n in names:
        if n not in eff:
            continue
        my_layer = eff[n]
        text = texts[n]
        my_calls = calls_in[n]
        my_locals = locals_in[n]
        for fn, src_file in owner.items():
            if src_file == n or src_file not in eff:
                continue
            # 过滤通用短名噪音
            if fn in COMMON_NOISE or len(fn) <= 3:
                continue
            # 该文件是否调用过这个函数（集合查询，O(1)）
            if fn not in my_calls:
                continue
            # 本文件自己有同名绑定（const/let/var/形参/内层 function）→ 是局部名字，
            # 不是跨模块依赖。例：01e8 的 `const pick = function(arr){}` 与 0E 的 pick()。
            if fn in my_locals:
                suppressed.append((n, fn, src_file, my_locals[fn]))
                continue
            their_layer = eff[src_file]
            if their_layer <= my_layer:
                continue  # 正常方向（依赖更下层或同层）

            # 判定是否「防御式调用」（软依赖）：在原文里找调用点看上下文
            code = strip_noise(text)
            is_soft = False
            for pm in re.finditer(r"\b" + re.escape(fn) + r"\s*\(", code):
                ctx = code[max(0, pm.start() - 140): pm.end() + 40]
                if ("typeof" in ctx and "function" in ctx) or "window.store" in ctx \
                        or "typeof window." in ctx:
                    is_soft = True
                    break
            rec = (n, LAYER_NAME[my_layer], fn, src_file, LAYER_NAME[their_layer])
            (soft if is_soft else hard).append(rec)

    # ---- 输出与判定 ----
    # 2026-11-15 修：这里原来把 `if unregistered: return 1` 和 `return 1 if hard else 0`
    # 写在报告打印**之前**，于是非 --json 模式下本工具打印 0 行、只回退出码 ——
    # docstring 承诺的「报告 + 退出码」只有一半是真的，而"没输出"看着像"没问题"。
    if AS_JSON:
        print(json.dumps({
            "layer_problems": [{"file": n, "kind": k, "detail": d} for n, k, d in problems],
            "layer_from_header": n_head,
            "hard_violations": [{"from": a, "fn": c, "to": d} for a, _, c, d, _ in hard],
            "soft_deps": [{"from": a, "fn": c, "to": d} for a, _, c, d, _ in soft],
        }, ensure_ascii=False, indent=2))
    else:
        if not BRIEF:
            print(f"文件数 {len(names)}；层级来源：文件头 {n_head} · 无中央表（2026-11-16 删除）")

        if hard or not BRIEF:
            print(f"\n【硬违例】{len(hard)} 条（下层反向依赖上层，且非防御式写法）")
        for a, la, fn, d, ld in sorted(set(hard)):
            print(f"  ✗ {a} [{la}]  调用了 {d} [{ld}] 的 {fn}")

        if BRIEF:
            pass  # 软依赖/已抑制是登记用的，不进 lint 输出
        else:
            print(f"\n【软依赖】{len(soft)} 条（防御式调用，设计允许，仅登记）")
            seen = set()
            for a, la, fn, d, ld in sorted(set(soft)):
                k = (a, d)
                if k in seen:
                    continue
                seen.add(k)
                print(f"  · {a} [{la}] → {d} [{ld}]")

        if suppressed and not BRIEF:
            print(f"\n【已抑制】{len(suppressed)} 条（同名局部绑定，非跨模块依赖——正则法的固有误报）")
            print("  ⚠️ 抑制是新引入的漏报面：请抽查行号，确认它真是局部声明而非跨模块依赖。")
            seen_sup = set()
            for a, fn, d, lns in sorted(suppressed, key=lambda r: (r[0], r[1], r[2])):
                if (a, fn, d) in seen_sup:
                    continue
                seen_sup.add((a, fn, d))
                where = ",".join("L" + str(x) for x in sorted(set(lns))[:4])
                print(f"  ~ {a} 自有 `{fn}`（声明于 {where}） ≠ {d} 的 {fn}()")

    # 层级声明问题 = FAIL：漏写 → 该文件绕过全部方向检查；自相矛盾 → 取第一个是猜测不是解析。
    if problems:
        print()
        report_decl(problems, names)
        return 1
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
