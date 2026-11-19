#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`LockGuard.start()` / `onTimerActive()` / `onResume()` 的**行为级**离线测试（0.2.5）。

## 被验的现场

**P0-1（0.2.4 遗留）**：开深度锁机 → 开始（锁上）→ 暂停（`onSessionEnd` 解锁）→ 继续
→ 之后整场再也不锁。根因是 `onTimerActive()` 里有一条
`if (askedPinSession == key) return NONE` 早退：会话键是**粘性键**（暂停不清），
所以同一场里 `asked == key` 恒成立 → `startLockTask()` 从未被再次调用。

语义上这两件事必须分开：
- `askedPinSession` = 「本场已经跳过系统设置页」（只决定跳不跳页）；
- 要不要锁 = mode / 开关 / `isLockTaskModeState` / `unlockedSession` 这些事实。

**P0-2**：`startLockTask()` 的复核从 120ms 单点改成多个时间点轮询
（`VERIFY_POLL_MS = [120, 300, 600, 1200, 2000]`）。没有 DeviceOwner 时系统要先弹
「固定应用」确认框，120ms 时 state 往往还是 NONE —— 单点复核会把"马上就要生效"
误判成"锁不上"，还会写 `asked` + 弹"不支持"，本场不再重试。

## 为什么是"源码抽取 + 状态机模型"而不是 JUnit

`startLockTask()` / `getLockTaskModeState()` 是 `android.jar` 里的 IPC，本工程 Gradle
依赖全离线、加测试依赖要联网（与 `qa_guard.sh` / `qa_orphan_active.py` 同一取舍）。
所以：**从线上同一份 LockGuard.kt 抽出常量与调用顺序**，在一份 Activity/系统模型上执行，
断言的是"跑完之后 prefs / 返回值 / 调用次数 / 定时器队列变成什么"。

跑法：`python3 app/tools/qa_lock_start.py`（退出码 0 = 全过）
"""

import heapq
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
LIB = ROOT / "src/main/java/im/bottle/focus/LockGuard.kt"

PASS = 0
FAIL = 0

DISABLED = "DISABLED"
ALREADY = "ALREADY"
LOCKED = "LOCKED"
REJECTED = "REJECTED"

MODE_NONE = 0
MODE_PINNED = 2  # ActivityManager.LOCK_TASK_MODE_LOCKED / PINNED

SELF_KEY = "focus#7"
NEXT_KEY = "focus#8"

TOAST_FAILED = "锁机未生效"


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
    m = re.search(signature_re, src, flags=re.S)
    if not m:
        return ""
    # 参数表结尾的 `) {` 才是函数体起点：`onResult: (StartResult) -> Unit = {}`
    # 里的 `{}` 是默认值，不是函数体。
    mm = re.search(r"\)[^{]*\{", src[m.end() - 1:])
    if not mm:
        return ""
    i = src.find("{", m.end() - 1 + mm.end() - 1)
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


SRC_RAW = LIB.read_text(encoding="utf-8")
SRC = strip_comments(SRC_RAW)
START = fun_body(SRC, r"fun start\(activity: Activity, onResult: \(StartResult\) -> Unit")
ON_RESUME = fun_body(SRC, r"fun onResume\(activity: Activity, sessionMode: String\?\)")
ON_TIMER_ACTIVE = fun_body(SRC, r"fun onTimerActive\(activity: Activity, mode: String, onWants")
VERIFY_ONCE = fun_body(SRC, r"private fun verifyOnce\(")

# 复核时间点直接从线上源码抽取：模型与实现不许各写一份字面量
_POLL = re.search(r"VERIFY_POLL_MS\s*=\s*longArrayOf\(([^)]*)\)", SRC)
POLL_MS = [int(x.strip().rstrip("Ll")) for x in _POLL.group(1).split(",")] if _POLL else []


# ---------------------------------------------------------------- 系统 / Activity 模型


class World:
    """`Activity` + `ActivityManager` 的事实面：只回答"现在 lockTaskModeState 是什么"。"""

    def __init__(
        self,
        lock_enabled=True,
        initial_locked=False,
        enter_after_ms=None,
        throw_on_start=False,
    ):
        self.lock_enabled = lock_enabled
        self.locked = initial_locked
        # None = 永远不进锁任务模式（系统拒绝 / 用户按取消）
        self.enter_after_ms = enter_after_ms
        self.throw_on_start = throw_on_start
        self.start_calls = 0
        self.stop_calls = 0
        self.pending_from = None

    def start_lock_task(self, now):
        """Activity.startLockTask()：请求发出去了，真正生效要等 `enter_after_ms`。"""
        self.start_calls += 1
        if self.throw_on_start:
            raise RuntimeError("SecurityException: not allowed to lock task")
        self.pending_from = now

    def stop_lock_task(self, now):
        """LockGuard.stop()：没锁着就是空操作（线上也是 `if (!isLockedTask) return`）。"""
        if self.mode(now) == MODE_NONE:
            return
        self.stop_calls += 1
        self.locked = False
        self.pending_from = None

    def mode(self, now):
        if self.locked:
            return MODE_PINNED
        if self.enter_after_ms is None or self.pending_from is None:
            return MODE_NONE
        return MODE_PINNED if now - self.pending_from >= self.enter_after_ms else MODE_NONE


class Session:
    """会话 / 记账（asked.pinSessionKey、lock.awaitingPinPage、lock.unlockedSessionKey）。"""

    def __init__(self, key=SELF_KEY, asked="", awaiting=False, unlocked=""):
        self.key = key
        self.asked = asked
        self.awaiting = awaiting
        self.unlocked = unlocked
        self.pages_opened = 0

    def open_pinning_page(self):
        self.pages_opened += 1
        # MainActivity.openPinningSettings → LockGuard.notePinPageOpened
        if self.key:
            self.asked = self.key
        self.awaiting = True


class Run:
    """一次「发起 → 轮询复核」：token 认领 + done 保证只回调一次。"""

    def __init__(self, token, t0):
        self.token = token
        self.t0 = t0
        self.done = False


class Sim:
    """`LockGuard` 的语义模型（含主线程 postDelayed 调度）。"""

    def __init__(self, world, session):
        self.world = world
        self.session = session
        self.now = 0
        self.verify_seq = 0
        self.queue = []
        self.order = 0
        self.results = []  # (触发时刻, StartResult)
        self.drop_stale = 0

    # -- 调度 --------------------------------------------------------------

    def post(self, delay, run, index, cb):
        self.order += 1
        heapq.heappush(self.queue, (self.now + delay, self.order, run, index, cb))

    def run_pending(self):
        """跑完所有到点的定时器（模拟主线程 Looper 一直转）。"""
        while self.queue:
            fire_at, _, run, index, cb = heapq.heappop(self.queue)
            self.now = max(self.now, fire_at)
            self._verify_once(run, index, cb)

    def _verify_once(self, run, index, cb):
        if run.done:
            return
        if run.token != self.verify_seq:
            # 上一场 / 上一次尝试的定时器：token 对不上，丢弃
            run.done = True
            self.drop_stale += 1
            return
        state = self.world.mode(self.now)
        if state != MODE_NONE:
            run.done = True
            self.results.append((self.now, LOCKED))
            cb(LOCKED, self.now)
            return
        nxt = index + 1
        if nxt < len(POLL_MS):
            self.post(POLL_MS[nxt] - POLL_MS[index], run, nxt, cb)
            return
        # 全部耗尽：最后一次 isLockedTask 复查
        run.done = True
        result = LOCKED if self.world.mode(self.now) != MODE_NONE else REJECTED
        self.results.append((self.now, result))
        cb(result, self.now)

    # -- LockGuard.start() -------------------------------------------------

    def start(self, cb):
        if not self.world.lock_enabled:
            cb(DISABLED, self.now)
            return
        if self.world.mode(self.now) != MODE_NONE:
            cb(ALREADY, self.now)
            return
        try:
            self.world.start_lock_task(self.now)
        except RuntimeError:
            cb(REJECTED, self.now)
            return
        self.verify_seq += 1
        run = Run(self.verify_seq, self.now)
        self.post(POLL_MS[0], run, 0, cb)

    # -- LockGuard.onTimerActive() ----------------------------------------

    def on_timer_active(self, mode="focus"):
        out = []

        if mode not in ("focus", "free"):
            return ["NONE"]
        if not self.world.lock_enabled:
            return ["NONE"]
        if self.world.mode(self.now) != MODE_NONE:
            return ["LOCKED"]

        key = self.session.key
        if not key:
            return ["NONE"]
        # 注意：这里**没有** askedPinSession 早退（0.2.5 / P0-1 删掉的那一条）
        if self.session.unlocked == key:
            return ["NONE"]

        def cb(result, _at):
            if result in (LOCKED, ALREADY):
                out.append("LOCKED")
            elif result == REJECTED:
                first_time = self.session.asked != key
                if first_time:
                    self.session.asked = key
                    out.append("PINNING_SETTINGS")
                else:
                    out.append("NONE")
            else:  # DISABLED：不记账、不跳页
                out.append("NONE")

        self.start(cb)
        self.run_pending()
        return out

    # -- LockGuard.onResume() ---------------------------------------------

    def on_resume(self, mode="focus", back_from_settings=True, enters_after_ms=None):
        """返回 (wants, toasts)。线上 onResume 永远返回 NONE（不请求跳页）。"""
        out = {"wants": "NONE", "toasts": []}
        if back_from_settings:
            self.session.awaiting = False
        if enters_after_ms is not None:
            self.world.enter_after_ms = enters_after_ms
        if mode not in ("focus", "free") or not self.world.lock_enabled:
            self.world.stop_lock_task(self.now)
            return out
        if self.world.mode(self.now) != MODE_NONE:
            return out
        key = self.session.key
        if key and self.session.unlocked == key:
            return out
        if not back_from_settings:
            return out

        def cb(result, at):
            if result in (LOCKED, ALREADY):
                if key:
                    self.session.asked = key
                return
            if result == REJECTED:
                if key:
                    self.session.asked = key
                # 复查：锁着就当成功（状态迟到），否则才提示一次「锁机未生效」
                if self.world.mode(at) != MODE_NONE:
                    return
                out["toasts"].append(TOAST_FAILED)
                return
            # DISABLED：不提示、不记账

        self.start(cb)
        self.run_pending()
        return out

    # -- 用户动作 ----------------------------------------------------------

    def pause(self):
        """MainActivity.onTimerState(!active) → LockGuard.onSessionEnd()。"""
        self.world.stop_lock_task(self.now)


# ------------------------------------------------------------------ ① start() 四态


def start_four_results():
    print("\n--- ① start() 的四级返回 ---")

    # DISABLED
    sim = Sim(World(lock_enabled=False), Session())
    got = []
    sim.start(lambda r, at: got.append(r))
    sim.run_pending()
    check("start()：lockEnabled=false → DISABLED（不发起、不提示）", got == [DISABLED], str(got))
    check("start()：DISABLED 时一次 startLockTask() 都没调", sim.world.start_calls == 0,
          str(sim.world.start_calls))

    # ALREADY
    sim = Sim(World(initial_locked=True), Session())
    got = []
    sim.start(lambda r, at: got.append(r))
    sim.run_pending()
    check("start()：已在锁任务模式 → ALREADY（幂等）", got == [ALREADY], str(got))
    check("start()：ALREADY 时没有再调 startLockTask()", sim.world.start_calls == 0,
          str(sim.world.start_calls))

    # REJECTED（抛异常）
    sim = Sim(World(throw_on_start=True), Session())
    got = []
    sim.start(lambda r, at: got.append(r))
    sim.run_pending()
    check("start()：startLockTask() 抛异常 → REJECTED", got == [REJECTED], str(got))

    # LOCKED（调用成功 + 首次轮询就真的进了锁任务模式）
    sim = Sim(World(enter_after_ms=50), Session())
    wants = sim.on_timer_active("focus")
    check("start()：调用成功 + 复核进入锁任务 → LOCKED", wants == ["LOCKED"], str(wants))
    check("start()：LOCKED 时调了一次 startLockTask()", sim.world.start_calls == 1,
          str(sim.world.start_calls))

    # REJECTED（静默失败：5 个时间点全是 NONE）
    sim = Sim(World(enter_after_ms=None), Session())
    wants = sim.on_timer_active("focus")
    check(
        "start()：调用成功但复核仍是 NONE → REJECTED（静默失败被发现）",
        wants == ["PINNING_SETTINGS"],
        str(wants),
    )
    check("start()：静默失败也记账（同一场只引导一次）", sim.session.asked == SELF_KEY,
          sim.session.asked)
    check(
        "start()：轮询在最后一个时间点判定失败（累计等 %dms）" % (POLL_MS[-1] if POLL_MS else -1),
        bool(POLL_MS) and sim.results and sim.results[-1][1] == REJECTED
        and sim.results[-1][0] == POLL_MS[-1],
        str(sim.results),
    )


# ------------------------------------------------- ② onResume 失败后的行为


def resume_failure():
    print("\n--- ② onResume(backFromSettings) 失败后的行为 ---")

    sim = Sim(World(enter_after_ms=None), Session(awaiting=True))
    out = sim.on_resume(mode="focus", back_from_settings=True)
    check("onResume：从设置页回来会**再试一次** startLockTask()",
          sim.world.start_calls == 1, str(sim.world.start_calls))
    check("onResume：失败后 toast「锁机未生效」", out["toasts"] == [TOAST_FAILED], str(out["toasts"]))
    check("onResume：失败后不再请求跳页（wants=NONE）", out["wants"] == "NONE", out["wants"])
    check("onResume：失败后不再跳「应用固定」页", sim.session.pages_opened == 0,
          str(sim.session.pages_opened))
    check("onResume：失败后记 asked.pinSessionKey（本场不再来）", sim.session.asked == SELF_KEY,
          sim.session.asked)
    check("onResume：awaitingPinPage 被清掉（只复查一次）", sim.session.awaiting is False,
          str(sim.session.awaiting))

    # 同一场再来一次（用户又切了一次后台回来）：不该再尝试、也不该再弹
    out2 = sim.on_resume(mode="focus", back_from_settings=False)
    check("onResume：同一场第二次（非设置页返回）不再尝试", sim.world.start_calls == 1,
          str(sim.world.start_calls))
    check("onResume：同一场第二次不再提示", out2["toasts"] == [], str(out2["toasts"]))

    # 成功路径：回到设置页开了 → 直接锁上，不需要用户再点
    sim3 = Sim(World(enter_after_ms=None), Session(awaiting=True))
    out3 = sim3.on_resume(mode="focus", back_from_settings=True, enters_after_ms=300)
    check("onResume：从设置页回来且能锁 → 直接锁上（用户不用再点）",
          sim3.world.mode(sim3.now) == MODE_PINNED)
    check("onResume：成功路径静默（没有 toast）", out3["toasts"] == [], str(out3["toasts"]))

    # REJECTED 之后状态才到：复查锁着就当成功，绝不弹「锁机未生效」。
    # （源码顺序见 ⑦ 的静态契约：isLockedTask 出现在 REJECTED 之前）
    sim4 = Sim(World(enter_after_ms=None), Session(awaiting=True))
    out4 = sim4.on_resume(mode="focus", back_from_settings=True, enters_after_ms=1200)
    check("onResume：状态迟到（1200ms 才进锁任务）→ 判成功、不提示",
          out4["toasts"] == [] and sim4.world.mode(sim4.now) == MODE_PINNED,
          f"toasts={out4['toasts']} mode={sim4.world.mode(sim4.now)}")

    # 用户手动解锁过的那一场：不锁
    sim5 = Sim(World(enter_after_ms=10), Session(awaiting=True, unlocked=SELF_KEY))
    sim5.on_resume(mode="focus", back_from_settings=True)
    check("onResume：本场手动解锁过 → 不自动锁回去", sim5.world.start_calls == 0,
          str(sim5.world.start_calls))

    # 换一场（新键）→ 手动解锁的记账不适用，照样锁
    sim6 = Sim(World(enter_after_ms=10), Session(key=NEXT_KEY, awaiting=True, unlocked=SELF_KEY))
    sim6.on_resume(mode="focus", back_from_settings=True)
    check("onResume：下一场（新键）自动恢复锁机", sim6.world.mode(sim6.now) == MODE_PINNED)


# -------------------------------------- ③ onTimerActive：只引导一次（但每场都要重新锁）


def timer_active_once():
    print("\n--- ③ onTimerActive：失败只引导一次 ---")

    sim = Sim(World(enter_after_ms=None), Session())
    first = sim.on_timer_active("focus")
    check(
        "onTimerActive：第一次失败 → Wants.PINNING_SETTINGS（交给门队列跳一次）",
        first == ["PINNING_SETTINGS"],
        str(first),
    )
    sim.session.open_pinning_page()  # 跳成功 → notePinPageOpened
    second = sim.on_timer_active("focus")
    check(
        "onTimerActive：同一场第二次 → NONE（不死循环跳系统页）",
        second == ["NONE"],
        str(second),
    )
    check("onTimerActive：第二次仍然**重新尝试** startLockTask()（锁不锁与跳不跳页分开）",
          sim.world.start_calls == 2, str(sim.world.start_calls))
    check("onTimerActive：跳页只发生一次", sim.session.pages_opened == 1,
          str(sim.session.pages_opened))
    check("onTimerActive：跳页后 asked=本场键 / awaiting=true（只复查一次）",
          sim.session.asked == SELF_KEY and sim.session.awaiting is True,
          f"{sim.session.asked} / {sim.session.awaiting}")

    # 休息段不锁：白名单只有 focus / free（模型照抄这条口径）
    lockable = re.search(r"LOCKABLE_MODES\s*=\s*setOf\(([^)]*)\)", SRC)
    modes = set(re.findall(r'"([^"]+)"', lockable.group(1))) if lockable else set()
    check("onTimerActive：可锁 mode 只有 focus / free（休息段不锁）", modes == {"focus", "free"},
          str(modes))
    check(
        "onTimerActive：休息段（shortBreak / longBreak）不发起锁机",
        "shortBreak" not in modes and "longBreak" not in modes,
        str(modes),
    )
    check(
        "onTimerActive：源码里没有 screenPinningEnabled 预检",
        "screenPinningEnabled" not in ON_TIMER_ACTIVE,
    )


# ------------------------------------------- ④ 0.2.5 新增：暂停→继续必须重新上锁


def resume_after_pause_relocks():
    print("\n--- ④ 0.2.5：暂停 → 继续 必须重新上锁（P0-1）---")

    # 开始 → 锁上（120ms 轮询命中）
    sim = Sim(World(enter_after_ms=50), Session())
    wants = sim.on_timer_active("focus")
    check("暂停继续：开始时锁上", wants == ["LOCKED"] and sim.world.mode(sim.now) == MODE_PINNED,
          str(wants))
    # 现场还原：本场已经"引导过"（粘性键，暂停不清）——旧代码就是被这一条早退吃掉的
    sim.session.asked = SELF_KEY
    calls_after_start = sim.world.start_calls

    # 暂停：MainActivity.onTimerState(!active) → LockGuard.onSessionEnd → stopLockTask()
    sim.pause()
    check("暂停继续：暂停时解锁（stopLockTask 被调用）", sim.world.stop_calls == 1,
          str(sim.world.stop_calls))
    check("暂停继续：暂停后不在锁任务模式", sim.world.mode(sim.now) == MODE_NONE)

    # 继续：粘性键不变，asked 仍然是本场键
    again = sim.on_timer_active("focus")
    check(
        "暂停继续：继续后必须再次调用 startLockTask()（asked 命中不再是早退理由）",
        sim.world.start_calls == calls_after_start + 1,
        f"{calls_after_start} -> {sim.world.start_calls}",
    )
    check("暂停继续：继续后重新锁上", again == ["LOCKED"] and sim.world.mode(sim.now) == MODE_PINNED,
          str(again))
    check("暂停继续：asked 命中也不会再跳系统页（本场已跳过）",
          again != ["PINNING_SETTINGS"], str(again))


# --------------------------------- ⑤ 0.2.5 新增：REJECTED 只跳一次页


def rejected_pages_once():
    print("\n--- ⑤ 0.2.5：REJECTED 只跳一次页，但每次都重试锁（P0-1 语义分离）---")

    sim = Sim(World(enter_after_ms=None), Session())

    first = sim.on_timer_active("focus")
    check("REJECTED 一次：第一次失败 → 跳一次系统设置页", first == ["PINNING_SETTINGS"], str(first))
    check("REJECTED 一次：记账 asked.pinSessionKey=本场键", sim.session.asked == SELF_KEY,
          sim.session.asked)

    sim.session.open_pinning_page()  # 页面真的跳出去了
    second = sim.on_timer_active("focus")
    check("REJECTED 二次：第 2 次失败 → 不跳页（NONE）", second == ["NONE"], str(second))
    check("REJECTED 二次：跳页次数仍是 1", sim.session.pages_opened == 1,
          str(sim.session.pages_opened))
    check("REJECTED 二次：但确实又试了一次 startLockTask()", sim.world.start_calls == 2,
          str(sim.world.start_calls))

    # 下一场（新键）：重新可以引导一次
    sim.session.key = NEXT_KEY
    sim.session.asked = SELF_KEY
    third = sim.on_timer_active("focus")
    check("REJECTED 下一场：新键 → 又允许引导一次", third == ["PINNING_SETTINGS"], str(third))


# --------------------------------- ⑥ 0.2.5 新增：轮询中途命中即成功、后续不再回调


def poll_stops_on_first_hit():
    print("\n--- ⑥ 0.2.5：轮询中第 3 次读到 LOCKED → 判成功、后续定时器不回调（P0-2）---")

    check(
        "轮询：VERIFY_POLL_MS 至少 5 个时间点",
        len(POLL_MS) >= 5,
        str(POLL_MS),
    )
    check(
        "轮询：时间点 = 120 / 300 / 600 / 1200 / 2000（累计 2 秒）",
        POLL_MS == [120, 300, 600, 1200, 2000],
        str(POLL_MS),
    )

    # enter_after_ms=600 → 第 1 次(120) NONE、第 2 次(300) NONE、第 3 次(600) LOCKED
    sim = Sim(World(enter_after_ms=600), Session())
    wants = sim.on_timer_active("focus")
    check("轮询中途命中：整体判成功（Wants.LOCKED）", wants == ["LOCKED"], str(wants))
    check("轮询中途命中：回调只发生一次", sim.results == [(600, LOCKED)], str(sim.results))
    check(
        "轮询中途命中：第 3 个时间点就落定（600ms），不再等到 2000ms",
        bool(sim.results) and sim.results[0][0] == POLL_MS[2],
        str(sim.results),
    )
    check("轮询中途命中：后续定时器已全部取消（队列为空）", sim.queue == [], str(sim.queue))

    # 反例：锁在 250ms 才生效 → 第 2 个时间点（300）命中
    sim2 = Sim(World(enter_after_ms=250), Session())
    out2 = sim2.on_timer_active("focus")
    check("轮询第 2 点命中：300ms 判成功（不是 120ms 就误判失败）",
          out2 == ["LOCKED"] and sim2.results == [(300, LOCKED)], str(sim2.results))

    # token：上一场的轮询不许在下一场回调
    sim3 = Sim(World(enter_after_ms=None), Session())
    sim3.start(lambda r, at: sim3.results.append((at, r)))
    stale_runs = [entry[2] for entry in sim3.queue]
    check("token：start() 后确实排了轮询定时器", len(stale_runs) == 1, str(len(stale_runs)))
    sim3.verify_seq += 1  # 新的一场 start() 已经把 token 推走
    sim3.run_pending()
    check("token：旧 token 的轮询被丢弃，不产生任何回调", sim3.results == [], str(sim3.results))
    check("token：丢弃计到 drop_stale", sim3.drop_stale == 1, str(sim3.drop_stale))


# ------------------------------------------------- ⑦ 源码契约（不是"出现几次"）


def source_contract():
    print("\n--- ⑦ 源码契约（顺序 / 常量 / 无设置预判 / 无 asked 早退）---")

    for name in (DISABLED, ALREADY, LOCKED, REJECTED):
        check(f"enum StartResult 有 {name}", re.search(r"\b" + name + r"\b", SRC) is not None)

    check("start() 取到函数体", bool(START))
    i_lock = START.find("State.lockEnabled")
    i_task = START.find("activity.startLockTask()")
    i_verify = START.find("scheduleVerify")
    check(
        "start() 的顺序是「判开关 → 调 startLockTask → 排轮询复核」",
        -1 < i_lock < i_task < i_verify,
        f"lockEnabled={i_lock} startLockTask={i_task} scheduleVerify={i_verify}",
    )
    check("start() 在 try/catch 里调 startLockTask（ROM 拒绝不崩）", "catch (e: Exception)" in START)
    check(
        "复核分支用 lockState 判定，成功才 LOCKED（在 verifyOnce 里）",
        "onResult(StartResult.LOCKED)" in VERIFY_ONCE and "lockState(" in VERIFY_ONCE,
    )
    check(
        "start() 复核失败打 Log.w 并返回 REJECTED（静默失败有日志）",
        "treat as REJECTED" in START or "onResult(StartResult.REJECTED)" in START,
    )
    check(
        "start() 用单调递增 token 防串场（verifySeq / run.token）",
        "verifySeq" in SRC and "run.token != verifySeq" in SRC,
    )
    check(
        "start() 的 REJECTED 之前有一次 isLockedTask 复查（状态迟到）",
        -1 < START.find("isLockedTask(") < START.find("onResult(StartResult.REJECTED)"),
        f"isLockedTask={START.find('isLockedTask(')} "
        f"REJECTED={START.find('onResult(StartResult.REJECTED)')}",
    )

    # ---- P0-1 的核心：onTimerActive 里没有 askedPinSession 早退 ----
    early = re.search(
        r"askedPinSession\s*\([^)]*\)\s*==\s*key\s*\)\s*return", ON_TIMER_ACTIVE
    )
    check(
        "onTimerActive 里没有 askedPinSession == key 的早退（P0-1 的根因已删）",
        early is None,
        early.group(0) if early else "",
    )
    check(
        "onTimerActive 保留的前置判断只有 mode / lockEnabled / isLockedTask / key / unlockedSession",
        "isLockableMode(mode)" in ON_TIMER_ACTIVE
        and "State.lockEnabled(activity)" in ON_TIMER_ACTIVE
        and "isLockedTask(activity)" in ON_TIMER_ACTIVE
        and "key.isEmpty()" in ON_TIMER_ACTIVE
        and "unlockedSession(activity) == key" in ON_TIMER_ACTIVE,
    )
    check(
        "askedPinSession 只在 REJECTED 分支里读一次（用途收窄为「本场是否已跳过设置页」）",
        len(re.findall(r"askedPinSession\s*\(", ON_TIMER_ACTIVE)) == 1,
        str(re.findall(r"askedPinSession\s*\(", ON_TIMER_ACTIVE)),
    )
    check(
        "REJECTED 分支按 firstTime 决定跳不跳页",
        "firstTime" in ON_TIMER_ACTIVE
        and "onWants(Wants.PINNING_SETTINGS)" in ON_TIMER_ACTIVE,
    )
    check(
        "DISABLED 分支不记账、只回 NONE",
        "StartResult.DISABLED -> onWants(Wants.NONE)" in ON_TIMER_ACTIVE,
    )

    check("onResume 取到函数体", bool(ON_RESUME))
    i_back = ON_RESUME.find("backFromSettings")
    i_try = ON_RESUME.find("start(activity)")
    check(
        "onResume：从设置页回来**直接再试**（start(activity) 在 backFromSettings 分支里）",
        -1 < i_back < i_try,
        f"back={i_back} start={i_try}",
    )
    check(
        "onResume：旧文案「未开启屏幕固定」已删除",
        "未开启屏幕固定" not in SRC_RAW,
    )
    check(
        "onResume：失败文案是「锁机未生效」（不下「本机不支持」的断言）",
        TOAST_FAILED in SRC_RAW and "本机不支持屏幕固定" not in SRC_RAW,
    )
    i_rej = ON_RESUME.find("StartResult.REJECTED")
    i_recheck = ON_RESUME.find("isLockedTask(", i_rej + 1) if i_rej >= 0 else -1
    check(
        "onResume：REJECTED 分支里有 isLockedTask 复查（状态迟到当成功）",
        -1 < i_rej < i_recheck,
        f"REJECTED={i_rej} recheck={i_recheck}",
    )
    check(
        "onResume：没有 screenPinningEnabled 预检",
        "screenPinningEnabled" not in ON_RESUME,
    )
    check(
        "LockGuard 里已无 screenPinningEnabled / SECURE_LOCK_TO_APP（不再判系统设置）",
        "screenPinningEnabled" not in SRC and "SECURE_LOCK_TO_APP" not in SRC,
    )
    check(
        "LockGuard 里没有 if (screenPinningEnabled( —— 门槛彻底消失",
        "if (screenPinningEnabled(" not in SRC_RAW,
    )
    check("LockGuard 里没有 lockPendingStart（通知 action 已删）", "lockPendingStart" not in SRC_RAW)
    check(
        "LockGuard 里没有 requestLock / requestUnlock（通知 action 已删）",
        "requestLock" not in SRC_RAW and "requestUnlock" not in SRC_RAW,
    )


def main():
    start_four_results()
    resume_failure()
    timer_active_once()
    resume_after_pause_relocks()
    rejected_pages_once()
    poll_stops_on_first_hit()
    source_contract()

    print()
    print(f"结果：{PASS} PASS / {FAIL} FAIL")
    if FAIL > 0:
        print("IS_PASS: NO")
        return 1
    print("IS_PASS: YES")
    return 0


if __name__ == "__main__":
    sys.exit(main())
