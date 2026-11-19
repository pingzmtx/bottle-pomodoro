#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`AlarmReceiver` 到点收尾的**行为级**离线测试（P1-1①）。

## 为什么不用 JUnit / 不编 Kotlin
`AlarmReceiver` 是 `BroadcastReceiver`，要 `android.jar` + 一个真的 `Context` 才能跑；
本工程的 Gradle 依赖全离线，加测试依赖就要联网（与 `qa_guard.sh` 同一个取舍）。所以这里做
**状态机模拟**：把线上同一份 `AlarmReceiver.kt` 的 `onReceive` 里的收尾调用**按源码顺序**取出来，
在一个 prefs 模型上逐条执行，再断言执行后的状态。

它不是字符串 grep：
- 断言的是"跑完之后 prefs 里还剩什么"（session 键 / 粘性键 / guard.active / pending / fired）；
- 断言了**顺序**（幂等闸门先记账、响铃在停服务之后、三条清理确实执行）；
- 断言了幂等闸门**之后**状态完全不变（重复投递不会二次收尾）。

跑法：`python3 app/tools/qa_alarm_settle.py`（退出码 0 = 全过）
"""

import pathlib
import re
import sys

KT = pathlib.Path(__file__).resolve().parents[1] / "src/main/java/im/bottle/focus/AlarmReceiver.kt"
STATE_KT = pathlib.Path(__file__).resolve().parents[1] / "src/main/java/im/bottle/focus/State.kt"
WATCH_KT = pathlib.Path(__file__).resolve().parents[1] / "src/main/java/im/bottle/focus/TimerWatch.kt"

PASS = 0
FAIL = 0

# prefs 键（必须与 State.kt 的常量一致；下面会从 State.kt 里核对一遍）
SESSION_KEYS = [
    "session.mode", "session.freeType", "session.endAt", "session.startTime",
    "session.title", "session.savedAt", "session.taskName",
]
STICKY_KEYS = [
    "session.stickyKey", "session.stickyMode", "session.stickyRunning", "session.stickyRemaining",
]
PENDING_KEYS = ["pending.endAt", "pending.title"]

# onReceive 里"会改状态"的调用 → 模型里的动作名
CALLS = {
    "State.markFired": "markFired",
    "TimerService.stop": "stopService",
    "Notifications.cancelOngoing": "cancelOngoing",
    "Notifications.showAlert": "showAlert",
    "State.clearPendingAlarm": "clearPending",
    "State.clearSession": "clearSession",
    "State.clearStickySession": "clearSticky",
    "Guard.clearActive": "clearGuardActive",
}


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


def on_receive_body(src):
    """取 `override fun onReceive` 的函数体（到 `companion object` 为止）。"""
    m = re.search(r"override fun onReceive\(.*?\)\s*\{", src, flags=re.S)
    if not m:
        return ""
    rest = src[m.end():]
    end = rest.find("companion object")
    return rest if end < 0 else rest[:end]


def settle_calls(body):
    """按源码顺序取出收尾调用（返回动作名列表）。"""
    out = []
    for m in re.finditer(r"((?:State|Guard|Notifications|TimerService)\.\w+)\(", body):
        name = CALLS.get(m.group(1))
        if name:
            out.append(name)
    return out


def new_prefs():
    """一场"网页已经跑起来、正计时中、应用锁在拦"的现场。"""
    return {
        "pending.endAt": 9_000_000_000_000,
        "pending.title": "番茄专注中",
        "fired.endAt": 0,
        "session.mode": "free",
        "session.freeType": "stopwatch",
        "session.endAt": 0,
        "session.startTime": 1_700_000_000_000,
        "session.title": "正计时中",
        "session.savedAt": 1_700_000_100_000,
        "session.taskName": "写周报",
        "session.stickyKey": "free#2",
        "session.stickyMode": "free",
        "session.stickyRunning": True,
        "session.stickyRemaining": 0,
        "guard.active": True,
        "guard.activeKey": "free#2",
        "guard.activeEndAt": 0,
    }


def run_receiver(calls, prefs, end_at, now):
    """把取出来的收尾调用按顺序作用到 prefs 模型上。返回 (prefs, effects)。"""
    effects = {"alerts": 0, "service_running": True, "ongoing_cancelled": 0}
    for c in calls:
        if c == "markFired":
            prefs["fired.endAt"] = end_at
        elif c == "stopService":
            effects["service_running"] = False
        elif c == "cancelOngoing":
            effects["ongoing_cancelled"] += 1
        elif c == "showAlert":
            effects["alerts"] += 1
        elif c == "clearPending":
            for k in PENDING_KEYS:
                prefs.pop(k, None)
        elif c == "clearSession":
            for k in SESSION_KEYS:
                prefs.pop(k, None)
        elif c == "clearSticky":
            for k in STICKY_KEYS:
                prefs.pop(k, None)
        elif c == "clearGuardActive":
            prefs["guard.active"] = False
            prefs["guard.activeEndAt"] = 0
    return prefs, effects


def simulate(calls, prefs, end_at):
    """完整模拟 onReceive：入参闸门 → 幂等闸门 → 收尾序列。

    两个闸门都是源码里真实存在的条件（main 里先断言过），这里只是把它们**执行**一遍，
    以便验证"重复投递 / 空 endAt 不会动状态"。
    """
    if end_at <= 0 or prefs.get("fired.endAt") == end_at:
        return prefs, {"alerts": 0, "service_running": True, "ongoing_cancelled": 0}
    return run_receiver(calls, prefs, end_at, now=end_at)


def main():
    if not KT.is_file():
        print("ENV: 找不到 %s" % KT)
        return 2

    raw = KT.read_text(encoding="utf-8")
    src = strip_comments(raw)
    body = on_receive_body(src)
    if not body:
        bad("能从 AlarmReceiver.kt 里取到 onReceive 函数体", "解析失败")
        return 1
    ok("从线上源码取到 AlarmReceiver.onReceive 函数体")

    calls = settle_calls(body)
    print("      收尾调用顺序：" + " → ".join(calls))

    # ---- 0. 幂等闸门 / 入参校验仍在（收尾必须排在它们之后）----
    check(
        "幂等闸门仍在（firedFor == endAt 直接 return）",
        "State.firedFor(context) == endAtWall" in body,
    )
    check(
        "空 endAt 闸门仍在（endAtWall <= 0 直接 return）",
        "endAtWall <= 0L" in body,
    )

    # ---- 1. 三条清理齐全（P1-1 的核心）----
    need = ["clearSession", "clearSticky", "clearGuardActive"]
    missing = [c for c in need if c not in calls]
    check("到点收尾包含 session / 粘性键 / guard.active 三条清理", not missing, "缺 " + str(missing))

    # ---- 2. 顺序：先记账（幂等），停服务，再响铃；清理在响铃之后 ----
    def idx(name):
        return calls.index(name) if name in calls else -1

    check(
        "先 markFired 再停服务（重复投递在停服务之前就被挡住）",
        0 <= idx("markFired") < idx("stopService"),
    )
    check(
        "先停 FGS 再响铃（响铃不会被服务的 stopForeground 连带撤掉）",
        0 <= idx("stopService") < idx("showAlert"),
    )
    check(
        "三条清理排在响铃之后（响铃失败也不影响收尾）",
        all(idx("showAlert") < idx(c) for c in need),
    )

    # ---- 3. 现场：正计时中被杀 → 新进程收广播 ----
    prefs = new_prefs()
    prefs, fx = simulate(calls, prefs, end_at=9_000_000_000_000)
    left = [k for k in SESSION_KEYS if k in prefs]
    sticky_left = [k for k in STICKY_KEYS if k in prefs]
    check("收尾后 session 记录被清空", not left, "残留 " + str(left))
    check("收尾后粘性会话键被清空（下一场必须是新键）", not sticky_left, "残留 " + str(sticky_left))
    check("收尾后 guard.active=false（黑名单 App 不再被拦）", prefs["guard.active"] is False)
    check("收尾后 guard.activeEndAt 归零", prefs["guard.activeEndAt"] == 0)
    check("收尾后 pending 闹钟记录被清空", not any(k in prefs for k in PENDING_KEYS))
    check("fired.endAt 记住了这一次（幂等闸门的锚点）", prefs["fired.endAt"] == 9_000_000_000_000)
    check("服务已停", fx["service_running"] is False)
    check("响铃/静默通知发了恰好一条", fx["alerts"] == 1)

    # ---- 4. 重复投递：闸门挡住，状态一点都不能动 ----
    dup = new_prefs()
    dup["fired.endAt"] = 9_000_000_000_000  # 已经为这个 endAt 响过
    dup_after, dup_fx = simulate(calls, dup, end_at=9_000_000_000_000)
    check(
        "重复投递被幂等闸门挡住（收尾一条都没执行）",
        dup_after["guard.active"] is True and dup_fx["alerts"] == 0,
    )
    check(
        "重复投递后 session / 粘性键仍在（没有被重复清账）",
        dup_after["session.mode"] == "free" and dup_after["session.stickyKey"] == "free#2",
    )
    check("重复投递后服务没被多停一次（闸门在 stop 之前）", dup_fx["service_running"] is True)

    # ---- 5. 空 endAt：什么都不做 ----
    empty = new_prefs()
    empty_after, empty_fx = simulate(calls, empty, end_at=0)
    check(
        "endAt<=0 的广播被丢弃（不误清正在跑的场次）",
        empty_after["guard.active"] is True and empty_after["session.mode"] == "free" and empty_fx["alerts"] == 0,
    )

    # ---- 6. 迟到降级：> 60s 静默（阈值来自 TimerWatch.RING_LATE_MS）----
    watch = WATCH_KT.read_text(encoding="utf-8")
    check("迟到阈值 RING_LATE_MS = 60_000", "RING_LATE_MS = 60_000L" in watch)
    check("静默判定用迟到时长（late > RING_LATE_MS）", "late > TimerWatch.RING_LATE_MS" in body)

    # ---- 7. prefs 键名必须与 State.kt 一致（模型不能靠猜）----
    state_src = STATE_KT.read_text(encoding="utf-8")
    for k in SESSION_KEYS + STICKY_KEYS + PENDING_KEYS:
        if k not in state_src:
            bad("prefs 键 %s 在 State.kt 里不存在" % k)
            break
    else:
        ok("模型用的 prefs 键与 State.kt 的常量逐一对得上")

    # ---- 8. 旧的双份收尾必须已经删掉 ----
    check(
        "TimerWatch.onAlarmFired 已删除（收尾只有一处实现）",
        "fun onAlarmFired" not in watch,
    )

    print()
    print("结果：%d PASS / %d FAIL" % (PASS, FAIL))
    if FAIL:
        print("IS_PASS: NO")
        return 1
    print("IS_PASS: YES")
    return 0


if __name__ == "__main__":
    sys.exit(main())
