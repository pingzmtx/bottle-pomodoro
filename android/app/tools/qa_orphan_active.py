#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""正计时场次被进程重启后清拦截镜像的**行为级**离线测试（0.2.3 / P1-2）。

## 被验的那条现场（QA 逐帧推演）

```
正计时（stopwatch, endAt=0, savedAt=T0），guard.active=true，黑名单含微信
F0 LMK 杀进程 → prefs 全留
F1 重绑 → App.onCreate.repairResidue：session.active()=true（正计时只判 8h）→ 不修
        → GuardService.onCreate.recheckExpiredIfDue：同样判 true → 不修
F2 用户开微信 → 遮罩 + HOME    ← 缺陷
F3 之后每 30s 复核都判"活着"，直到 savedAt+8h 后的第一条窗口事件才放行
```

## 为什么不用 JUnit / 不编 Kotlin

`App.onCreate` 是 `Application` 的生命周期，要 `android.jar` + 真的 `Context` 才能跑；
本工程 Gradle 依赖全离线，加测试依赖就要联网（与 `qa_guard.sh` / `qa_alarm_settle.py` 同一取舍）。
所以这里做**状态机模拟**：从线上同一份 `App.kt` 里按源码顺序取出 `onCreate` 的调用序列，
在一个 prefs 模型上执行，再断言执行后的状态。

它不是字符串 grep：
- 断言的是"跑完之后 prefs 里还剩什么"（`guard.active` / `session.*` / `session.sticky*`）；
- 断言了**顺序**（清正计时镜像排在 `repairResidue` 之前）与**范围**（只清 active，不清 session）；
- 断言了**可观察结果**：清账前开微信 = 拦，清账后开微信 = 不拦；
- 还断言了"网页恢复上报后镜像会被写回来"（不能把功能清死）。

跑法：`python3 app/tools/qa_orphan_active.py`（退出码 0 = 全过；2 = 环境不可用）
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP_KT = ROOT / "src/main/java/im/bottle/focus/App.kt"
GUARD_KT = ROOT / "src/main/java/im/bottle/focus/Guard.kt"
RULES_KT = ROOT / "src/main/java/im/bottle/focus/GuardRules.kt"
STATE_KT = ROOT / "src/main/java/im/bottle/focus/State.kt"
MA_KT = ROOT / "src/main/java/im/bottle/focus/MainActivity.kt"

PASS = 0
FAIL = 0

# prefs 键（与 State.kt 的常量一致；下面会核对一遍）
SESSION_KEYS = [
    "session.mode", "session.freeType", "session.endAt", "session.startTime",
    "session.title", "session.savedAt", "session.taskName",
]
STICKY_KEYS = [
    "session.stickyKey", "session.stickyMode", "session.stickyRunning", "session.stickyRemaining",
]
GUARD_KEYS = ["guard.active", "guard.activeEndAt", "guard.activeKey"]

# App.onCreate 里"会改状态"的调用 → 模型里的动作名
CALLS = {
    "Guard.clearOrphanCountingActive": "clearOrphanCountingActive",
    "Guard.repairResidue": "repairResidue",
}

WECHAT = "com.tencent.mm"
NOW = 1_700_000_000_000
MAX_AGE_MS = 8 * 60 * 60 * 1000  # 与 GuardRules.MAX_SESSION_AGE_MS 对齐（下面会核对）


def ok(name):
    global PASS
    PASS += 1
    print("PASS  " + name)


def bad(name, detail=""):
    global FAIL
    FAIL += 1
    print("FAIL  " + name + (("  <- " + detail) if detail else ""))


def check(name, cond, detail=""):
    if cond:
        ok(name)
    else:
        bad(name, detail)


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    out = []
    for line in src.splitlines():
        s = line.strip()
        if s.startswith("*") or s.startswith("//"):
            continue
        out.append(re.sub(r"//.*$", "", line))
    return "\n".join(out)


def fun_body(src, signature_re):
    """按正则取函数体（花括号配平），取不到返回空串。"""
    m = re.search(signature_re, src, flags=re.S)
    if not m:
        return ""
    i = src.find("{", m.end() - 1)
    if i < 0:
        return ""
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1:j]
    return ""


# ------------------------------------------------------------------ prefs 模型


def new_prefs(counting=True, saved_at=NOW, active=True):
    """一场"网页跑起来、正在专注、应用锁在拦"的现场。"""
    p = {
        "session.mode": "free" if counting else "focus",
        "session.freeType": "stopwatch" if counting else "",
        "session.endAt": 0 if counting else NOW + 25 * 60 * 1000,
        "session.startTime": NOW - 60_000,
        "session.title": "正计时中" if counting else "番茄专注中",
        "session.savedAt": saved_at,
        "session.taskName": "写周报",
        "session.stickyKey": "free#2" if counting else "focus#7",
        "session.stickyMode": "free" if counting else "focus",
        "session.stickyRunning": True,
        "session.stickyRemaining": 0,
        "guard.active": active,
        "guard.activeEndAt": 0 if counting else NOW + 25 * 60 * 1000,
        "guard.activeKey": "free#2" if counting else "focus#7",
    }
    return p


def is_counting(prefs):
    """SessionRecord.isCounting：freeType == stopwatch || endAt <= 0。"""
    return prefs.get("session.freeType") == "stopwatch" or prefs.get("session.endAt", 0) <= 0


def session_active(prefs, now):
    """GuardRules.sessionActive 的模型：savedAt<=0 → false；>8h → false；倒计时到点 → false。"""
    saved_at = prefs.get("session.savedAt", 0)
    if saved_at <= 0:
        return False
    if now - saved_at > MAX_AGE_MS:
        return False
    if not is_counting(prefs) and prefs.get("session.endAt", 0) <= now:
        return False
    return True


def should_block(prefs, mode, pkg, pkg_in_apps=True):
    """GuardRules.shouldBlock 的前四道闸门（总开关 → active 镜像 → lockTask → mode）。

    本用例只关心 `guard.active` 这一格（黑名单 / 白名单在 qa_guard.sh 里逐条跑过），
    所以模型只到 mode 这一道为止，之后假定"包在黑名单里且不在白名单里"。
    """
    if not prefs.get("guard.enabled", True):
        return False
    if not prefs.get("guard.active", False):
        return False
    if mode not in ("focus", "free"):
        return False
    return pkg_in_apps and pkg == WECHAT


def run_clear_orphan(prefs, now=NOW):
    """Guard.clearOrphanCountingActive 的模型（判据 = GuardRules.countingOrphanNeedsClear）。"""
    active = prefs.get("guard.active", False)
    counting = is_counting(prefs) if "session.mode" in prefs else False
    saved_at = prefs.get("session.savedAt", 0)
    # active && counting && savedAt > 0 && 未过 8h 陈旧门（过了让位给 repairResidue）
    if not (active and counting and saved_at > 0 and now - saved_at <= MAX_AGE_MS):
        return prefs
    # ★ 只清 active 这一件事，session / 粘性键一个字都不动
    prefs["guard.active"] = False
    prefs["guard.activeEndAt"] = 0
    return prefs


def run_repair_residue(prefs, now):
    """Guard.repairResidue 的模型（0.2.2 的原有行为，这里原样保留以证明它漏了这一格）。"""
    active = prefs.get("guard.active", False)
    has_session = "session.mode" in prefs
    live = has_session and session_active(prefs, now)
    if not (active and not live):
        return prefs
    expired = has_session and not session_active(prefs, now)
    if expired:
        for k in SESSION_KEYS + STICKY_KEYS:
            prefs.pop(k, None)
    prefs["guard.active"] = False
    prefs["guard.activeEndAt"] = 0
    return prefs


def simulate(calls, prefs, now):
    for c in calls:
        if c == "clearOrphanCountingActive":
            prefs = run_clear_orphan(prefs, now)
        elif c == "repairResidue":
            prefs = run_repair_residue(prefs, now)
    return prefs


# ---------------------------------------------------------------------- main


def main():
    for f in (APP_KT, GUARD_KT, RULES_KT, STATE_KT):
        if not f.is_file():
            print("ENV: 找不到 %s" % f)
            return 2

    app_src = strip_comments(APP_KT.read_text(encoding="utf-8"))
    guard_src = strip_comments(GUARD_KT.read_text(encoding="utf-8"))
    rules_raw = RULES_KT.read_text(encoding="utf-8")
    rules_src = strip_comments(rules_raw)
    state_src = STATE_KT.read_text(encoding="utf-8")

    # ---- 0. 从线上源码取 App.onCreate 的调用序列 ----
    body = fun_body(app_src, r"override fun onCreate\(\)")
    if not body:
        bad("能从 App.kt 里取到 onCreate 函数体", "解析失败")
        return 1
    calls = [CALLS[m.group(1)] for m in re.finditer(r"(Guard\.\w+)\(", body) if m.group(1) in CALLS]
    print("      App.onCreate 的守卫调用顺序：" + " → ".join(calls))
    check(
        "App.onCreate 里同时有 clearOrphanCountingActive 与 repairResidue",
        calls.count("clearOrphanCountingActive") == 1 and calls.count("repairResidue") == 1,
        "实际顺序 " + str(calls),
    )
    check(
        "清正计时镜像排在 repairResidue 之前（前置，不是分支）",
        calls.index("clearOrphanCountingActive") < calls.index("repairResidue"),
        "实际顺序 " + str(calls),
    )
    check(
        "两步各自被 try 包住（Application.onCreate 抛异常 = 整个进程起不来）",
        body.count("try {") >= 2 and body.count("catch (e: Exception)") >= 2,
    )

    # ---- 1. Guard.clearOrphanCountingActive 的范围：只清 active ----
    clear_body = fun_body(guard_src, r"fun clearOrphanCountingActive\(ctx: Context\)")
    check("Guard.clearOrphanCountingActive 存在且非空", bool(clear_body))
    check(
        "判据来自纯逻辑层 GuardRules.countingOrphanNeedsClear（可离线跑表）",
        "GuardRules.countingOrphanNeedsClear" in clear_body,
    )
    check("清的是 guard.active（clearActive）", "clearActive(ctx)" in clear_body)
    check(
        "不动 session（没有 State.clearSession）",
        "State.clearSession" not in clear_body,
    )
    check(
        "不动粘性键（没有 State.clearStickySession）",
        "State.clearStickySession" not in clear_body,
    )
    check(
        "有可 grep 的一条日志：counting session orphaned by process restart",
        '"clear active: counting session orphaned by process restart"' in guard_src,
    )

    # ---- 2. 判据真值表（GuardRules 源码里三条短路必须在）----
    rule_body = fun_body(rules_src, r"fun countingOrphanNeedsClear\(")
    check("GuardRules.countingOrphanNeedsClear 存在", bool(rule_body))
    check("判据①：active=false 直接返回 false（本来就没拦）", "if (!active) return false" in rule_body)
    check("判据②：非正计时直接返回 false（倒计时仍按 endAt 判）", "if (!counting) return false" in rule_body)
    check("判据③：savedAt<=0 直接返回 false（从没落过盘不要动）", "if (savedAt <= 0L) return false" in rule_body)
    check(
        "判据④：超 8h 让位给 repairResidue（否则过期那场的数据永远清不掉）",
        "nowWall - savedAt <= MAX_SESSION_AGE_MS" in rule_body,
    )
    check(
        "8h 陈旧门常量仍是 8 小时（与网页 FREE_SNAP_STALE_MS 对齐，本用例模型同值）",
        "const val MAX_SESSION_AGE_MS = 8L * 60L * 60L * 1000L" in rules_src,
    )

    # ---- 3. 现场回放：正计时被 LMK 杀 → 重绑 ----
    prefs = new_prefs(counting=True, saved_at=NOW - 60_000, active=True)
    check(
        "F1 重绑前：repairResidue 判它「活着」→ 不修（0.2.2 的缺陷现场复现）",
        run_repair_residue(new_prefs(counting=True, saved_at=NOW - 60_000, active=True), NOW)[
            "guard.active"
        ]
        is True,
    )
    check("F2 清账前：用户开微信 → 拦（缺陷现状）", should_block(prefs, "free", WECHAT))

    prefs = simulate(calls, prefs, NOW)
    check("F2 清账后：guard.active=false", prefs["guard.active"] is False)
    check("F2 清账后：用户开微信 → 不拦（P1-2 的验收口径）", not should_block(prefs, "free", WECHAT))
    lost = [k for k in SESSION_KEYS if k not in prefs]
    check("F2 清账后：session 记录**仍在**（网页要能凭它恢复正计时）", not lost, "丢了 " + str(lost))
    lost_sticky = [k for k in STICKY_KEYS if k not in prefs]
    check("F2 清账后：粘性键**仍在**（本场记账不失效，不换场）", not lost_sticky, "丢了 " + str(lost_sticky))
    check("F2 清账后：session.savedAt 未被改写", prefs["session.savedAt"] == NOW - 60_000)
    check("F2 清账后：guard.activeKey 保留（遮罩/去重按会话键记账）", prefs["guard.activeKey"] == "free#2")

    # ---- 4. 用户随后打开 App：网页恢复上报 → 镜像被写回来（功能不能清死）----
    prefs["guard.active"] = True       # TimerWatch.onReport → Guard.syncActive(true)
    prefs["guard.activeEndAt"] = 0
    check(
        "F3 网页重新上报后镜像回到 true，且重新开始拦（不会把应用锁清死）",
        should_block(prefs, "free", WECHAT),
    )

    # ---- 5. 边界：不该动的一律不动 ----
    # 5a 先只跑这一条分支（隔离）：savedAt=0 时它必须一个字都不动
    p = run_clear_orphan(new_prefs(counting=True, saved_at=0, active=True), NOW)
    check(
        "savedAt=0（从没落过盘）→ 这条分支不动 guard.active",
        p["guard.active"] is True,
    )
    # 5b 完整 onCreate：那就轮到 repairResidue 的老判据（会话不算活着 → 清镜像），本分支没抢功
    p = simulate(calls, new_prefs(counting=True, saved_at=0, active=True), NOW)
    check(
        "savedAt=0 的完整 onCreate 仍由 repairResidue 收尾（本轮分支没有改变旧行为）",
        p["guard.active"] is False,
    )

    p = simulate(calls, new_prefs(counting=False, saved_at=NOW - 60_000, active=True), NOW)
    check(
        "倒计时（endAt>0）未到点 → 仍拦（正计时那条分支不能误伤倒计时）",
        p["guard.active"] is True and should_block(p, "focus", WECHAT),
    )

    p = simulate(calls, new_prefs(counting=False, saved_at=NOW - 60_000, active=True), NOW + 30 * 60 * 1000)
    check(
        "倒计时已到点 → repairResidue 照旧连记账一起清（旧保证一个字没放松）",
        p["guard.active"] is False and "session.mode" not in p,
    )

    p = simulate(calls, new_prefs(counting=True, saved_at=NOW - 2 * MAX_AGE_MS, active=True), NOW)
    check(
        "正计时超 8h → 本分支让位，repairResidue 把 session + 粘性键 + 镜像一起清",
        p["guard.active"] is False and "session.mode" not in p and "session.stickyKey" not in p,
    )

    p = simulate(
        calls, new_prefs(counting=True, saved_at=NOW - MAX_AGE_MS, active=True), NOW
    )
    check(
        "正计时正好 8h（边界内）→ 只清镜像，session 仍留给网页恢复",
        p["guard.active"] is False and "session.mode" in p,
    )

    p = simulate(calls, new_prefs(counting=True, saved_at=NOW - 60_000, active=False), NOW)
    check("guard.active=false → 幂等（没什么可清，也不报错）", p["guard.active"] is False)

    # ---- 6. 只允许在进程创建时跑：MainActivity.onResume 不许调它 ----
    ma_src = strip_comments(MA_KT.read_text(encoding="utf-8")) if MA_KT.is_file() else ""
    resume_body = fun_body(ma_src, r"override fun onResume\(\)") if ma_src else ""
    check(
        "MainActivity.onResume 仍只跑 repairResidue（回前台不能把正在专注的镜像清掉）",
        "Guard.repairResidue(this)" in resume_body
        and "clearOrphanCountingActive" not in ma_src,
    )

    # ---- 7. prefs 键名必须与 State.kt 一致（模型不能靠猜）----
    missing = [k for k in SESSION_KEYS + STICKY_KEYS + GUARD_KEYS if k not in state_src]
    check("模型用的 prefs 键与 State.kt 的常量逐一对得上", not missing, "缺 " + str(missing))

    print()
    print("结果：%d PASS / %d FAIL" % (PASS, FAIL))
    if FAIL:
        print("IS_PASS: NO")
        return 1
    print("IS_PASS: YES")
    return 0


if __name__ == "__main__":
    sys.exit(main())
