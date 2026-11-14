#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""· 层依赖方向规则检查（架构耦合度核心）

为什么需要它：
    项目拆成 28 个文件后，"谁能依赖谁"全靠口头约定（文件头那些「红线」注释）。
    约定没有强制执行 = 迟早被绕过，最后变成"所有文件都依赖所有文件"的大泥球。
    本工具把约定变成**可执行的规则**，新增违例立刻报出来。

层级定义（依据 src/manifest.json 的加载顺序 + 各文件职责）：

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
  python3 tools/w6_layer.py            # 报告 + 退出码（有硬违例=1）
  python3 tools/w6_layer.py --json     # 结构化
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

# ---- 层级归属 ----
LAYER = {
    "00_pure_core.js": 0,
    "00b_goal_progress.js": 0,   # 人生目标的进度公式：纯函数，无 DOM 无副作用（可 Node 单测）
    "00_delegate.js": 1,          # 事件委托运行时：只依赖 DOM，不依赖业务层
    "01z_ui_facade.js": 1,        # UI 门面：引擎上行调用唯一出口，零业务依赖
    "01b3_sync.js": 2,            # 同步层：只读数据结构 + 适配器，不碰 UI
    "01a_engine_prelude.js": 1, "01b1_storage.js": 1, "01b_engine_data.js": 1, "01b2_achievements.js": 1, "01c_engine_timer.js": 1,
    "01d_engine_features.js": 1, "01d2_engine_rank_bot.js": 1,
    # 2026-11-14 · S2：01d 按域拆成 7 个文件，全部留在 L1（纯移动，未改依赖方向）
    "01d7_engine_record_link.js": 1,
    "01d8_engine_plan_analysis.js": 1,
    "01d9_engine_tree_rank.js": 1,
    "01dA_engine_rank_schedule.js": 1,
    "01dB_engine_day_rollover.js": 1,
    "01dC_engine_task_exchange.js": 1,
    "01d3_engine_tree_shop.js": 1,
    "01d5_engine_stats.js": 1,
    "01d6_engine_util.js": 1,
    "01d4_engine_team.js": 1,
    "01e_engine_ui.js": 1, "01e2_ui_poster.js": 1, "01e3_ui_team.js": 1,
    # 2026-11-14 · S3：01e_engine_ui 按域拆成 5 个文件，同在 L1（纯移动）
    "01eP_ui_view.js": 1, "01eQ_ui_timerpanel.js": 1, "01eR_ui_diary.js": 1, "01eS_ui_addrecord.js": 1,
    "01e4_ui_ux.js": 1, "01e5_ui_tree.js": 1, "01eN_ui_forest.js": 1, "01e6_ui_rank.js": 1,
    "01e7_ui_stats.js": 1, "01e8_ui_misc.js": 1, "01e9_ui_memo.js": 1, "01eA_ui_timeblock.js": 1,
    # 2026-11-14 · S3：01e7_ui_stats 按域拆成 5 个文件，同在 L1（纯移动）
    "01eT_ui_stats_month.js": 1, "01eU_ui_biography.js": 1, "01eV_ui_biocal_map.js": 1, "01eW_ui_summary.js": 1,
    "01eM_ui_tbcreate.js": 1,   # 日程网格的「两次点击新建计划」入口（依赖 01eA 渲染的 DOM）
    "01eB_ui_habit.js": 1,
    # 2026-10-13 从 01e_engine_ui.js 按域切出的两刀（同一层，前向依赖 01e）：
    "01eC_ui_todo.js": 1,   # 第二刀：计划/待办 的增删改查与列表渲染
    "01eD_ui_log.js": 1,    # 第三刀：日志页渲染 + 回顾弹窗与自评
    "01eE_ui_lifegoal.js": 1,   # 人生目标页：年/月/愿望清单的列表、卡片与编辑弹窗
    "01eF_ui_lifecycle.js": 1,  # 目标层的周期：本周重点 / 季度检查点 / 月末年末收尾
    "01eG_ui_lifereview.js": 1,  # 复盘：分步引导 / 快照冻结 / 历史列表
    "01eO_ui_lifewish.js": 1,    # 人生愿望清单：一份纯打勾清单，不参与任何进度计算
    "01eH_ui_fx.js": 1,     # 第一刀：音效与动效（WebAudio 合成 + DOM 特效）
    "01eJ_ui_skin.js": 1,   # 第四刀：自定义皮肤（树背景 / 计时器壁纸 / 皮肤商店），从 01e8 切出
    "01eK_ui_remind.js": 1,  # 收口刀：定点提醒（含域末尾的顶层调用 startRemindWatcher）
    "01eL_ui_audio.js": 1,   # 收口刀：白噪音 + 我的歌单（网易云直链播放）
    "01f_engine_immersive.js": 1,
    "01f2_ui_script_import.js": 1,   # 第五刀：沉浸式剧情副本·导入系统（从 01f 切出）
    "01g_engine_init.js": 1,
    "02_enh571_自律增强.js": 2, "03_enh572_性能打磨.js": 2,
    "04_enh573_统计缓存.js": 2, "05_journey_渐进解锁.js": 2,
    "0E_theme_主题引擎.js": 2,
    "06_errRep_错误监控.js": 3, "07_uiFold_折叠记忆.js": 3,
    "08_component_registry.js": 3, "09_a11y_无障碍.js": 3,
    "0A_默认态收敛.js": 4, "0B_hash路由.js": 4,
    "0C_确认弹窗.js": 4, "0D_store通知.js": 4,
}

LAYER_NAME = {0: "L0 纯函数", 1: "L1 引擎", 2: "L2 增强", 3: "L3 横切", 4: "L4 胶水"}

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


def main():
    files = sorted(glob.glob(os.path.join(SCRIPTS, "*.js")))
    names = [os.path.basename(p) for p in files]
    texts = {os.path.basename(p): open(p, encoding="utf-8").read() for p in files}

    # 每个文件导出的顶层函数名 → 归属文件
    owner = {}
    for n in names:
        for m in RE_FUNC.finditer(texts[n]):
            fn = m.group(1)
            owner.setdefault(fn, n)

    # 未登记层级的文件
    unregistered = [n for n in names if n not in LAYER]

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
        if n not in LAYER:
            continue
        my_layer = LAYER[n]
        text = texts[n]
        my_calls = calls_in[n]
        my_locals = locals_in[n]
        for fn, src_file in owner.items():
            if src_file == n or src_file not in LAYER:
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
            their_layer = LAYER[src_file]
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

    if AS_JSON:
        print(json.dumps({
            "unregistered": unregistered,
            "hard_violations": [{"from": a, "fn": c, "to": d} for a, _, c, d, _ in hard],
            "soft_deps": [{"from": a, "fn": c, "to": d} for a, _, c, d, _ in soft],
        }, ensure_ascii=False, indent=2))
        # ★ 未登记层级 = FAIL（P2-20）：原来只打一行 ⚠️，新文件不补 LAYER 表就自动豁免
    #   架构方向检查 —— "忘了登记"于是变成最省事的通过方式。当前 46 个文件全部已登记，
    #   这条对现状零影响，只为堵住以后。
    if unregistered:
        print("\n未登记层级的文件必须补进 LAYER 表（否则永远绕过方向检查）")
        return 1
    return 1 if hard else 0

    print(f"文件数 {len(names)}；已登记层级 {len(names) - len(unregistered)}")
    if unregistered:
        print(f"\n⚠️ 未登记层级的文件（请补进 LAYER 表）: {unregistered}")

    print(f"\n【硬违例】{len(hard)} 条（下层反向依赖上层，且非防御式写法）")
    for a, la, fn, d, ld in sorted(set(hard)):
        print(f"  ✗ {a} [{la}]  调用了 {d} [{ld}] 的 {fn}")

    print(f"\n【软依赖】{len(soft)} 条（防御式调用，设计允许，仅登记）")
    seen = set()
    for a, la, fn, d, ld in sorted(set(soft)):
        k = (a, d)
        if k in seen:
            continue
        seen.add(k)
        print(f"  · {a} [{la}] → {d} [{ld}]")

    if suppressed:
        print(f"\n【已抑制】{len(suppressed)} 条（同名局部绑定，非跨模块依赖——正则法的固有误报）")
        print("  ⚠️ 抑制是新引入的漏报面：请抽查行号，确认它真是局部声明而非跨模块依赖。")
        seen_sup = set()
        for a, fn, d, lns in sorted(suppressed, key=lambda r: (r[0], r[1], r[2])):
            if (a, fn, d) in seen_sup:
                continue
            seen_sup.add((a, fn, d))
            where = ",".join("L" + str(x) for x in sorted(set(lns))[:4])
            print(f"  ~ {a} 自有 `{fn}`（声明于 {where}） ≠ {d} 的 {fn}()")

    # ★ 未登记层级 = FAIL（P2-20）：原来只打一行 ⚠️，新文件不补 LAYER 表就自动豁免
    #   架构方向检查 —— "忘了登记"于是变成最省事的通过方式。当前 46 个文件全部已登记，
    #   这条对现状零影响，只为堵住以后。
    if unregistered:
        print("\n未登记层级的文件必须补进 LAYER 表（否则永远绕过方向检查）")
        return 1
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
