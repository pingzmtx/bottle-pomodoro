#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键全绿链：gate → lint → build → check → pubsync → callgraph → layer → toc → docchain → size → ids → unit → catch → promise → [e2e · perf · viewport] → smoke（tomato=番茄计数单一口径门禁）
用法:
  python3 tools/verify.py             # 全量（含 smoke ~1-2min）
  python3 tools/verify.py --fast      # 快档：**只跳过 smoke**，全部静态段照跑（含 pubsync/csstok/derived）
  python3 tools/verify.py --e2e       # 全量 + E2E 5 动线（e2e 先于 smoke 拆 01e 的每批基线）
  python3 tools/verify.py --strict    # 任一段没跑就判非零退出（发布前卡口）
  python3 tools/verify.py --json      # 结构化输出，AI 可直接解析后决定是否提交
退出码：全过=0，任一失败=1；--strict 下「有段没跑」=2。
环境不具备（如本机跑不了无头浏览器，子步骤退出码 3）记为 SKIP 而非 FAIL——
沙箱限制不该伪装成代码回归失败。跳过项会打印原因，逐条可见，不会静默变绿。

以前汇总只印 `✅ ALL PASS`，即使 smoke / e2e 根本没跑，甚至
e2e 不加 --e2e 时连「跳过」都不出现、整段从链里消失。而这两段是唯一能抓
「点击 / 渲染 / 状态」类回归的网——把「没跑」表现成「通过」是这套链最大的信任漏洞。
现在：ok=「跑了的都过了」，verified=「该跑的都跑了且都过了」，两者分开报告，
汇总行标出 通过 / 跳过 / 未运行 的真实组成，JSON 增 verified 与 not_run 字段。
阅读者请认 verified，不要只认 status。"""
import sys, os, json, subprocess, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(step, cmd):
    t0 = time.time()
    # ★ 超时（P2-21）：原来没有 timeout，任一段挂起（等浏览器、等 stdin）就把整条链无限挂住。
    #   900s 足够跑 viewport（实测 152s）与全量 smoke（66s），超过必然是卡死而非慢。
    try:
        r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, timeout=900)
    except subprocess.TimeoutExpired as _te:
        return {"step": step, "ok": False, "sec": round(time.time() - t0, 1),
                "tail": ["✗ 超时（>900s）：该段疑似挂起，已强制结束"]}
    tail = (r.stdout + r.stderr).strip().splitlines()
    # 退出码 3 = 环境不具备（如本机跑不了无头浏览器），记 SKIP 而非 FAIL——
    # 它不是代码坏了，别让沙箱限制伪装成回归失败。
    if r.returncode == 3:
        # 退出码 3 = 环境不具备 → SKIP。**原因让子步骤自己说**，别在这里写死——
        # 写死会张冠李戴：gate 段跳过是因为"不是 git 仓库"，不是"没有浏览器"。
        reason = ""
        for line in tail:
            ls = line.strip()
            if ls.startswith("○"):
                reason = ls.lstrip("○ ").strip()
                break
        return {
            "step": step,
            "ok": True,
            "skipped": True,
            "skip_reason": reason or "环境不具备（子步骤以退出码 3 报告，原因见该段输出）",
            "sec": round(time.time() - t0, 1),
            "tail": tail[-3:] if tail else [],
        }
    if r.returncode == 0:
        return {"step": step, "ok": True, "sec": round(time.time() - t0, 1),
                "tail": tail[-2:] if tail else []}
    # ★ 失败时不能只留最后两行（P2-21）：w6_layer / data_ownership 把违例打在输出**开头**，
    #   而原来只截 tail[-2:]，链里看到的恰好是无关的收尾行（"共 N 处"却没有具体是谁）。
    head = tail[:12]
    rest = tail[-12:] if len(tail) > 12 else []
    return {
        "step": step,
        "ok": False,
        "sec": round(time.time() - t0, 1),
        "tail": head + (["   …"] if rest else []) + rest,
    }


def main():
    fast = "--fast" in sys.argv
    jsonout = "--json" in sys.argv
    with_e2e = "--e2e" in sys.argv  # E2E 5 动线纳入一键回归链
    not_run = []                     # 全程没被请求跑、因而静默缺席的段
    steps = [
        # 门禁钩子有没有上膛。本挂载点剥执行位，.git/hooks/ 里的钩子会被 git
        # 静默忽略——「门禁形同虚设」本身就是一类回归，必须显形在全绿链里。
        ("gate", "python3 tools/install_hooks.py --check"),
        ("lint", "python3 tools/build.py --lint"),
        ("build", "python3 tools/build.py"),          # 2026-10-22：默认多产物 → public/
        ("check", "python3 tools/build.py --check"),   # 逐文件比对 public/ 与 src 重建结果
        # 发布物落地（2026-11-14）：`check` 只证明 public/ 能由 src/ 精确重建，
        # 它管不到「根目录那份线上站点是不是也更新了」。这两件事必须分开守：
        # 实测漂了一整代 —— 根目录 sw.js 的 BUILD_ID 是 423fad73c0d3，public/ 是
        # 2bfbe006368f，PRECACHE 还指着已删除的 style.cb9ccd30ce86.css。
        # 后果是静默的：CACHE 名不变 → 老用户永远命中旧缓存，新版本等于没发；
        # 预缓存清单指向不存在的文件 → 离线打开缺样式。23 个产物少同步一个，
        # 页面看起来完全正常，没人会发现。所以判据要机器化，且必须双向：
        #   ① public/ 有的，根目录必须逐字节相同（漏同步）；
        #   ② 根目录有的，public/ 也必须产出（上次构建的残骸，会原样发上线）。
        ("pubsync", "python3 tools/check_public_sync.py"),
        # 调用图自检（2026-11-14 从 pre-commit 提进链）：两条"不变量"——
        # ① 每个源文件必须能被 acorn 解析（拼进同一 <script> 前先证各自合法）
        # ② 每个模块必须在 LAYER 里登记层级（漏登记 = 依赖方向从此没人守）
        # 为什么必须进链：这段原先只挂在 pre-commit 上（钩子独有），任何不走钩子的
        # 路径都永远漏掉它——--no-verify、新 clone 没 install_hooks、CI 直跑 verify、
        # 或者钩子被删。所以它不是"顺手多一道"，而是结构上必须有两个入口。
        # 失败可定位：解析错误打「解析失败 <文件>: <行:列 原因>」，漏登记会列出文件名；
        # 两者都指到具体文件，不需要再手工二分。
        ("callgraph", "node tools/callgraph_ast.js --selfcheck"),
        # 层依赖方向检查：硬违例（下层反向依赖上层）会 FAIL，挂门禁防架构腐化
        ("layer", "python3 tools/w6_layer.py"),
        # TOC 一致性：函数增删后索引必须同步，否则文档与代码脱节
        ("toc", "python3 tools/w6_toc.py --check"),
        # 文档里的「已挂链」清单必须等于本文件的段清单（2026-11-14）。
        # 手写清单必然过期，不是记性问题而是机制问题：同一天就查出 AGENTS 第 154 行
        # 漏了 callgraph 与 csstok 两段，同一份文档还留着复现不出来的「359 处硬编码」。
        # 所以这段不比"文档写得对不对"，只比"文档是否由代码生成"——名单由
        # gen_verify_chain.py 的 AST 读取产生，人改不了、也忘不了。
        ("docchain", "python3 tools/gen_verify_chain.py --check"),
        # 单文件规模红线：文档写了「无 >6000 行文件」，此前无工具守
        # （01d 已 5,959 行，余量 41 行）→ 挂门禁，防止悄悄越线
        ("size", "python3 tools/w6_size.py"),
        # DOM id 对账：JS 里 getElementById('x') 的那个 x 必须真的存在
        # （模板里 / JS 动态创建）。这类错**静态看不错、一跑就 null**，而且改完 id
        # 忘了同步是手滑高发区 —— 与「忘了重建产物」同一类「靠记性」的漏洞。
        # 纯静态、确定性、<1s，所以挂链（此前只写在 AGENTS「改 id 后跑」里，等于没守）。
        ("ids", "python3 tools/id_audit.py"),
        # 番茄计数单一口径：完整🍅=1、半个🍅=0.5 只有一份权威实现。
        # 历史病根：countFullTomatoes 只数完整番茄，却被 5 处当成"总番茄数"用，
        # 于是"半个番茄不算"反复出现、每次打补丁又漏一处。现在改成登记制——
        # 任何新的番茄取值函数不登记就 FAIL，同名两份定义也 FAIL。
        ("tomato", "python3 tools/check_tomato_single_source.py"),
        # 金币「单一入口」：余额只许经 coinEarn/coinSpend 变动，流水类型必须登记。
        # 历史病根：金币只存余额、21 处直接 ±=，账目一旦对不上就永远说不清钱从哪来、
        # 误发也退不回。改用「余额 + 流水」账本后，入口与类型表都必须靠门禁守。
        ("coin", "python3 tools/check_coin_single_source.py"),
        # 数据领域边界（棘轮式）：appData 每个域声明「谁有权写」，现状冻结为基线，
        # 之后新增越界写入 → FAIL。32 个域里 29 个是多文件共写 —— 这正是「改一处坏三处」
        # 的成因；未来加新域（如人生管理）时靠它强制边界，不必再手工收敛 400 处。
        ("domain", "python3 tools/data_ownership.py"),
        # 小工具「唯一实现」：补零/取今天/取日期/HTML 转义这类小事，全仓只许有一份实现。
        # 病根是「每个文件各写一份、名字还不同」（补零曾有 4 种写法），改一处必漏三处。
        # 例外（错误监控自包含转义）登记在工具里并写明理由。
        # 合并后语法：每个源文件单独 node --check 都过，拼进同一个 <script> 仍可能整段崩。
        # 2026-10-17 真实事故：新函数 logCalMonth() 撞上同名的 let 变量 → 整个槽位解析失败
        # → 全局 appData 未定义 → 所有用例一律"抛异常"，而 build/id/弹窗检查全绿。
        ("bundle", "python3 tools/check_bundle_syntax.py"),
        # 隐式全局赋值：切 ES 模块后每个产物是严格模式，`X = v` 若 X 从未声明
        # 会抛 ReferenceError（而非像单文件非严格模式那样自动造全局）。
        # 真实事故：2026-10-23 拖音效音量滑条报 `_lastSfxVol is not defined`，
        # 这正是模块化迁移漏网的一处；没有本段就只能等用户点到才发现。
        ("implicit", "node tools/check_implicit_globals.js"),
        # data-act 派发的步进参数必须先过 Number()：00_delegate.js 的 readArgs()
        # 对 `data-act-args='["-1"]'` 返回的是**字符串**，`month += delta` 于是变成
        # 字符串拼接 8 → "8-1" → "8-1-1"…
        # 真实事故：2026-10-25 日志页日历点几下左右箭头，标题成了
        # `2026年9-1111-1-1-111月`，new Date() 得到 Invalid Date，日期格子全空。
        # 同批查出四处日历 + 月份选择器共 8 个函数全中（都是同一个病）。
        ("actargs", "python3 tools/check_actargs_number.py"),
        # data-act 指向的函数必须真的存在：00_delegate 解析不到名字只 console.error
        # 一行，界面上表现为「按钮点了没反应」，不抛错不弹提示，用户只会当成卡顿。
        # 真实事故：2026-10-25 用户报「小赌/中赌/大赌点了没反应」—— 模板写的是
        # tryBetSafe，实现里只有 tryBet；同批还查出「延后一天」的
        # postponeDailyTaskSafe 也是死的。都是迁移到 ES 模块时模板侧批量加了
        # Safe 后缀、实现侧没跟上造成的系统性缺口。
        ("act", "python3 tools/check_act_targets.py"),
        # calc() 里 + 和 - 两侧必须有空白，否则整条声明被浏览器丢弃（不是回退）。
        # 真实事故：2026-10-25 用户报「页脚被底部导航挡住」—— build.py 的 CSS
        # 压缩器把 calc(80px + env(safe-area-inset-bottom)) 里的空格删了，
        # .main 那 80px 底部让位空间静默消失，页脚被压掉 54px。
        # 这类 bug 不报错、不告警，只是那条声明在 DevTools 里显示为删除线。
        ("calcspace", "python3 tools/check_calc_space.py"),
        ("dup", "python3 tools/check_dup_utils.py"),
        # 无障碍（a11y）：图标按钮必须有可访问名。09_a11y_无障碍.js 写了焦点陷阱/
        # aria-live/弹窗语义，但**没有验证它是否生效**——本段把「写了」变成「守住了」。
        # 用 --static（纯静态 <0.3s）；深度检查（弹窗语义/焦点陷阱，需浏览器）手动跑
        # `python3 tools/a11y_audit.py`。
        ("a11y", "python3 tools/a11y_audit.py --static"),
        # 单测覆盖率（棘轮）：用 V8 coverage 算 00_pure_core.js 的函数覆盖率，
        # 已覆盖函数数不得降、未进入分支块数不得升。363→574 条断言后已到 100% 函数覆盖。
        ("cov", "python3 tools/coverage.py"),
        # 用例元数据门禁：每条 @case 的 tier/owner 必须写全、且 owner 指向真实文件。
        # 「按改动选跑」的前提是归属声明齐全 —— 漏写/拼错不会报错，只会让用例
        # **永远选不中**（假绿）。所以它跟单一口径一样必须上闸门，不能靠记性。
        ("casemeta", "python3 tools/check_case_meta.py"),
        # 用例↔runner 契约（P0-1 的机器守卫）：孤儿用例 / 缺 return JSON.stringify(R) /
        # R.push 元组宽度与 runner 解包不匹配。事故背景：c95–c104 的 9 条用例返回三元组、
        # runner 按二元组解包 → 恒定抛异常、零断言执行，而报告只显示"用例异常"；
        # c33 则是另一个极端——文件躺在 tools/tests/ 里，从没被 @case 引用，零覆盖且无声。
        ("contract", "python3 tools/check_case_contract.py"),
        # 用例脆弱度门禁：断言里不许「抄实现现值」（具体色值/px、自造颜色解析、
        # 本地抄一份主题清单）。起因：改一次灰块配色 → 断言逐条变红，每次都要手改。
        # 现在阈值/主题清单/测量原语收敛在 tools/tests/_contract.js，存量 19 处只减不增。
        ("casefix", "python3 tools/check_case_fragility.py"),
        ("unit", "node tools/tests/unit_pure.js"),
        # 空 catch 棘轮：存量 464 处只减不增，新增必须显式登记基线
        ("catch", "python3 tools/empty_catch_audit.py"),
        # 对非 Promise 取 .catch（点了就抛 TypeError，且 catch 处理器从未生效）
        # 起因：错误面板修好后立刻报出 tryBet() 的这处老 bug
        ("promise", "node tools/promise_catch_audit.js"),
        # 弹窗结构收编：应用内弹窗必须同构（h3 标题 + .modal-buttons 容器 + .modal-btn 变体），
        # 偏离的要么改成统一结构，要么在 tools/modal_unify_allow.json 写明理由豁免。
        # 起因：37 个弹窗各写各的按钮/标题样式，暗色模式补丁只能一处一处数着打。
        ("modals", "python3 tools/check_modal_unify.py"),
        # 主题令牌一致性（2026-10-25 品质升级）：12 个外观（6 主题 × 明暗）的
        # 边框色相 / 透明度、圆角 / 阴影必须同源。加这段的直接原因是实测发现
        # 深色 5 个块全缺 --border-strong（回落到浅色蓝灰），而静态门禁能挡住
        # "又漏一个"。运行时层（真开浏览器读 computed，抓级联覆盖）用
        # `python3 tools/check_theme_tokens.py --runtime` 手动跑。
        ("theme", "python3 tools/check_theme_tokens.py"),
        # 颜色令牌棘轮（2026-11-14）：组件规则里的裸色值按文件冻结成基线，只准降不准升。
        # 为什么要有：字号/圆角/间距有 lint() 拦，颜色从来只报数——写 CSS 的换成人之后，
        # "逐处判断"这一环不存在，豁免等于无防线（一次弹窗改版就能悄悄新增几十处）。
        # 与 theme 段的区别：theme 守"12 个外观的令牌是否一致"，本段守"有没有绕过令牌"。
        ("csstok", "python3 tools/check_css_tokens.py"),
        # 派生令牌冻死（2026-11-14，深色标题回归的根因）：csstok 只数「有没有裸色值」，
        # theme 只查「12 个外观的令牌值一致没」，两者都看不见「令牌声明在哪一层」。
        # 自定义属性在**声明所在元素**上完成替换再往下继承，所以写在 :root 的
        # `--text-1: var(--text)` 永远拿 html 那一份值（浅色），body.dark-mode 追不上。
        # 本段纯静态：T 声明的层级上没有依赖项 y 的定义、y 却在更深层被定义 → FAIL。
        # 首次运行抓到 4 处（--text-1/2/3/--focus-ring），即本次回归的全部成因。
        ("derived", "python3 tools/check_derived_tokens.py"),
        # 重复判定一致性（D1，2026-11-14）：「某天该不该做」有两份实现 ——
        # habitDueOn（完整版）与 _habitDueFast（循环内版，注释自称"语义完全一致"）。
        # 这句话此前没有任何东西在守；本段用 25 条规则 × 22 个日期逐日对拍，
        # 首次运行就抓到一处真分歧：非法日期 "2026-02-29" 下 fast 判「该做」而 slow 判「不该做」。
        # 同时校验 todoRepeatMatches 恒等于 todoRepeatMatchesNorm(norm(r))（纯包装关系）。
        ("repeat", "node tools/check_repeat_consistency.js"),
        # 作用域重名（S1，2026-11-14）：callgraph 的 duplicate_fns 曾报「13 组重名顶层函数，
        # 后加载的静默覆盖」。逐个查证后 **13 组全是误报** —— 它把 depth=0（文件顶层）和
        # depth=1（各自 IIFE 内私有）混进同一张表，`q`/isMinimal/patchObserver 不过是
        # 07 与 08 各写了一份同名私有函数。反证不需跑代码：同一份 callgraph.json 的
        # globals（245 个）里这 13 个名字一个都不在。
        # 所以本段守的不是"名字重复"，而是**同一作用域同名声明**（真覆盖）：
        # 跨文件 depth=0 并入同一张全局表（--classic 下 9 个 <script> 共享 window，按最严守），
        # 块级 let/const 与函数提升分开算（否则 `for (const x of a){} for (const x of b){}` 误报）。
        ("scopedup", "node tools/check_scoped_dups.js"),
        # 人生目标的进度算法（2026-10）：纯函数单测，不启浏览器。
        # 这些用例每一条都对应一次真实算错（清空输入框算出 100%、
        # 跨年度目标被 366 天截断成 0.3%、null 当 0 显示"未测量 0%"）。
        ("lifeGoal", "node tools/check_life_goal_progress.js"),
    ]
    if with_e2e:
        steps.append(("e2e", "python3 tools/tests/e2e_flows.py"))
        # 性能回归门禁：bench 的三项指标（冷启动/视图切换/统计页 8000 条）基线化，
        # 超 max(基线×1.5, 基线+下限) 即 FAIL。放在 --e2e 里（同样要 chromium）。
        # 历史状态：性能只有一次性数据、没有守，退化无人知 —— 这一段把它变成机制。
        steps.append(("perf", "python3 tools/perf_gate.py"))
        # 移动兼容门禁：在 320/360/375/414/768 五档渲染核心视图，各检测项计数
        # （横向溢出 / 元素越界 / 点击目标过小 / 文本截断 / 被底栏截断）冻结为
        # 棘轮基线 tools/viewport_baseline.json，新增即 FAIL。此前 rs_viewport 只
        # 做一次性检查、没有任何东西守着 —— 「验证过没问题」不等于「以后不会变坏」。
        # 也需 chromium、单跑约 2~3 分钟，故与 e2e/perf 并列在 --e2e 分支。
        steps.append(("viewport", "python3 tools/rs_viewport.py --check"))
    else:
        # 以前不加 --e2e，e2e 连「跳过」都不打印，整段从链里消失，
        # 而汇总照样印 ALL PASS。它是唯一能抓「点击/渲染/状态」类回归的网，
        # 必须在输出里显形，否则「没跑」会被读成「已通过」。
        not_run.append(("e2e", "未请求（要加 --e2e）"))
    if fast:
        steps.append(("smoke", None))  # 占位：跳过
    elif "--full" in sys.argv:
        # 全量：127 条 UI 用例一条条跑（本机跑不完，只在有 Chrome 的机器/大改前用）
        steps.append(("smoke", "python3 tools/run_smoke.py"))
    else:
        # ★ 2026-11-09 起默认只跑「兜底 15 条 core」，全量 UI 用例退到 --full。
        # 理由（实测，不是偏好）：127 条 UI 用例里 113 条 feature 断言的是文案/DOM 结构，
        # 产品每改一次文案就红一批 —— 2026-11-09 那一轮 9 条红，0 个功能回归，
        # 全是断言过期或用例间状态残留。红信号被噪音淹没 = 门禁等于没有，
        # 而它还额外挡住了每一次发版。真正在守数据与算法的两层（unit 1017 条 +
        # core 冒烟）从来没给过假红。要跑全量随时 `verify.py --full`。
        steps.append(("smoke", "python3 tools/run_smoke.py --tier core"))

    # 快档不许悄悄瘦身（2026-11-14）。docstring 当时写的是「--fast（lint+check+unit，
    # 跳过 smoke）」，有人据此判断"快档不含 pubsync"，于是认定发版路径没有产物一致性门禁。
    # 代码没这么写（fast 只影响 smoke 一行），但一句错文档就能让人理直气壮地绕过检查。
    # 这里把"快档必须有哪些段"写成可执行断言：以后谁把某段挪到 only-full 分支，立刻红，
    # 而不是等下一次漏提交再回头查文档。
    FAST_MUST = ("lint", "build", "check", "pubsync", "unit", "csstok", "derived")
    if fast:
        _have = {n for n, _c in steps}
        _miss = [n for n in FAST_MUST if n not in _have]
        if _miss:
            print("✗ 快档缺段：%s —— --fast 只该跳过 smoke，不该跳过任何静态段"
                  % "、".join(_miss))
            return 1

    results = []
    for name, cmd in steps:
        if cmd is None:
            results.append({"step": name, "ok": True, "sec": 0, "skipped": True,
                            "skip_reason": "--fast 模式不跑 smoke"})
            continue
        results.append(run(name, cmd))

    ok = all(r["ok"] for r in results)
    passed = [r for r in results if r["ok"] and not r.get("skipped")]
    skipped = [r for r in results if r.get("skipped")]
    failed = [r for r in results if not r["ok"]]
    # ok 只说明「跑了的都过了」；verified 才说明「该跑的都跑了且都过了」。
    # 两者必须分开——把「没跑」表现成「通过」是这套链最大的信任漏洞。
    verified = ok and not skipped and not not_run

    if jsonout:
        print(json.dumps({
            "status": "pass" if ok else "fail",
            "verified": verified,
            "passed": len(passed),
            "failed": [r["step"] for r in failed],
            "skipped": [{"step": r["step"], "reason": r.get("skip_reason", "环境不具备")}
                        for r in skipped],
            "not_run": [{"step": s, "reason": why} for s, why in not_run],
            "steps": results,
        }, ensure_ascii=False))
    else:
        print("\n===== 全绿链汇总 =====")
        for r in results:
            mark = "✓" if r["ok"] and not r.get("skipped") else ("✗" if not r["ok"] else "○")
            if r.get("skipped"):
                note = f"跳过：{r.get('skip_reason', '环境不具备')}"
            else:
                note = f"{r['sec']}s"
            print(f"  {mark} {r['step']:6} {note}")
            if not r["ok"]:
                for ln in r["tail"]:
                    print(f"      {ln[:180]}")
        for s, why in not_run:
            print(f"  – {s:6} 未运行：{why}")
        bits = [f"{len(passed)} 通过"]
        if failed:
            bits.append(f"{len(failed)} 失败")
        if skipped:
            bits.append("{} 跳过（{}）".format(len(skipped), "、".join(r["step"] for r in skipped)))
        if not_run:
            bits.append("{} 未运行（{}）".format(len(not_run), "、".join(s for s, _ in not_run)))
        if failed:
            head = "❌ 有问题，别发"
        elif verified:
            head = "✅ 通过，可以发"
        else:
            head = "✅ 通过，可以发"
        print(f"\n结果: {head}　{' · '.join(bits)}")
        if not verified and not failed and not jsonout:
            # 只解释一句，不吓人：没跑的段不算失败。但**不能说谎**——
            # 2026-11-14 修：原来这里无条件印「本机没有 Chrome，冒烟那一段跳过」，
            # 而实跑全量时 smoke 明明跑了且是绿的（25.4s），只是 e2e 没请求；
            # --fast 时 smoke 也根本没被请求（不是环境缺浏览器）。两句话都不成立，
            # 等于门禁自己在输出里写假话 —— 和"注释写 64 条实测 71 条"同一类问题。
            sk = {r["step"] for r in skipped}
            nr = {s2 for s2, _ in not_run}
            if "smoke" in sk:
                print(f"      （smoke 跳过：{next(r.get('skip_reason', '环境不具备') for r in skipped if r['step'] == 'smoke')}；"
                      f"发版前按《发版前点这10下.md》手点一遍）")
            elif "smoke" in nr:
                print("      （快档不跑浏览器段（smoke / e2e / perf / viewport）；"
                      "发版前跑 python3 tools/verify.py 全量，或按《发版前点这10下.md》手点一遍）")
            elif "e2e" in nr:
                print("      （e2e 未请求（要加 --e2e）；smoke 已跑过）")
    if "--strict" in sys.argv and not verified:
        return 2  # --strict = 有任意一段没跑就判非零，供发布前卡口使用
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
