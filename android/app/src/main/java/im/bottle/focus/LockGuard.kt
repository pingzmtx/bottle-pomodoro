package im.bottle.focus

import android.app.Activity
import android.app.ActivityManager
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import java.lang.ref.WeakReference

/**
 * 锁机（官方的屏幕固定，`startLockTask()` / `stopLockTask()`）。
 *
 * 刻意**不用**无障碍、不用 DeviceAdmin：
 * - 无障碍要用户去设置里开一个能读全屏内容的服务，为一个"别切 App"的功能付这个代价太重；
 * - DeviceAdmin 在 Play 上是灰区，普通专注 App 没必要。
 * 屏幕固定是系统自带的用户可见能力，退出路径也在系统手势里，风险最低。
 *
 * 三条硬要求（否则用户会被锁死 25 分钟）：
 * 1. 锁定期间必须有一个**原生**出口：返回键长按 1.5s / 连按 3 次 → 确认框 → `stopLockTask()`；
 * 2. 屏幕固定下通知栏是被系统隐藏的，所以**不能只依赖通知**；
 * 3. 暂停 / 结束 / `onDestroy` 一律兜底解锁（`onDestroy` 不解锁会留下一个空白页）。
 *
 * ## 0.2.4（P0）：不再用「读系统设置」预判能不能锁
 *
 * 旧代码把 `Settings.Secure.getInt("lock_to_app_enabled")` 当成上锁的前置条件。两处都是错的：
 * - 那个键其实在 **`Settings.Global`**（`Settings.Global.LOCK_TO_APP_ENABLED`），Secure 表里没有 →
 *   `getInt` 静默返回默认 0 → 函数**恒返回 false**，连 `catch` 都抓不到；
 * - 就算读对了，它控制的是「用户从最近任务手动固定应用」，与 `Activity.startLockTask()`
 *   是**两条不同的路径** —— 拿它当门槛本身就是错的（各 ROM 差异极大）。
 *
 * 现在的做法：**直接发起固定 → 校验是否真的进了锁任务模式 → 失败才降级提示**。
 * 判断依据只有 `ActivityManager.getLockTaskModeState()` 这一个系统事实，不赌任何设置值。
 *
 * ## 本类**不跳任何页面**（P1-C）
 *
 * 屏幕固定设置页也是系统页，和悬浮窗授权页抢栈时后一个会盖掉前一个。
 * 所以这里只回答"我要跳哪个门"（[Wants]），由 `MainActivity.jumpGate` 统一跳、
 * 统一置 busy、统一超时复位。
 *
 * 另外：解锁**只调 `stopLockTask()`**，绝不 eval 任何 JS —— 网页状态的写者永远只有网页自己。
 */
object LockGuard {

    private const val TAG = "BottleLock"

    /**
     * 可以锁机的 mode：`focus`（番茄专注）与 `free`（自由专注：正计时 / 流式）。
     *
     * 休息段（网页写的是 `shortBreak` / `longBreak`）**不锁**：休息就该能走开，
     * 把用户钉在"该休息了"的页面上是反的。
     *
     * ⚠️ 千万不要写成"只认 focus"：自由专注的 mode 是 `free`，那样会把正计时/流式的
     * 锁机一起废掉（而且 `onResume` 里 `!lockable → stop()` 会**主动解锁**在跑的自由专注）。
     */
    private val LOCKABLE_MODES = setOf("focus", "free")

    /** 这一场该不该锁机（白名单）。 */
    fun isLockableMode(mode: String): Boolean = mode in LOCKABLE_MODES

    /**
     * 应用锁（无障碍拦截）的 mode 判据 —— **与锁机同源**（设计 A4："直接复用同一判定"）。
     *
     * 为什么不去引用 [GuardRules.GUARD_MODES]：那个文件必须零 Android 依赖才能离线跑表，
     * 方向只能是 GuardRules → 本类（不能反过来）。所以两处各写一份字面量，
     * 由 `verify.sh` 逐字断言两边完全一致 —— 口径分叉会在验收期就红。
     *
     * 休息段不拦：休息就该走开（同 [isLockableMode]）。
     */
    fun isGuardableMode(mode: String): Boolean = mode in LOCKABLE_MODES

    /**
     * 「屏幕固定」设置页。
     *
     * `Settings` 里**没有**公开常量（`ACTION_SCREEN_PINNING_SETTINGS` 不存在于 SDK），
     * 框架里的实际 action 字符串就是这一个；打不开时退回安全设置首页。
     */
    private const val ACTION_PINNING_SETTINGS = "android.settings.SCREEN_PINNING_SETTINGS"

    /** 调用方要做什么 —— 这是本类与 `MainActivity` 之间唯一的"跳页"协议。 */
    enum class Wants {
        /** 什么都不用做（不需要锁 / 已经处理完 / 不该锁）。 */
        NONE,

        /** 已经 `startLockTask()` 了（或已在锁任务模式下），不占门、不需要系统页。 */
        LOCKED,

        /** 需要「屏幕固定」设置页：由 MainActivity 统一跳（本类不 startActivity）。 */
        PINNING_SETTINGS
    }

    /**
     * `start()` 的四级结果（P0）。
     *
     * 为什么要分四级而不是 `Boolean`：`startLockTask()` 的失败有三种完全不同的含义，
     * 调用方需要的处理也不同（关着开关不该提示、已锁上不该重复记账、
     * 被系统/ROM 拒掉才需要降级提示）。一个 `false` 把它们糊在一起，
     * 0.2.3 的"静默失败"就是这么来的。
     */
    enum class StartResult {
        /** 用户关着锁机开关：不该发起，也不该提示（不是故障）。 */
        DISABLED,

        /** 已经在锁任务模式里：幂等，不再调一次 `startLockTask()`。 */
        ALREADY,

        /** 真的进了锁任务模式（[isLockedTask] 复核通过）。 */
        LOCKED,

        /** 系统 / ROM 拒绝，或调用成功但**没有**真的进锁任务模式（静默失败）。 */
        REJECTED
    }

    private val main = Handler(Looper.getMainLooper())
    private var activityRef: WeakReference<Activity>? = null
    private var dialogShowing = false

    /**
     * 复核令牌（单调递增）。
     *
     * 每次 [start] 都 +1；在飞的轮询定时器带着自己的 token 回来，对不上就丢弃 ——
     * 否则上一场（或上一次尝试）的定时器会把结果回调到这一场的决策里
     * （典型：暂停前的 2s 轮询在"继续"之后才醒，判 REJECTED → 又把锁记成失败）。
     */
    private var verifySeq = 0

    /** 一次「发起 → 轮询复核」的上下文：token 认领 + `done` 保证**只回调一次**。 */
    private class Verify(val token: Int) {
        var done: Boolean = false
    }

    fun attach(activity: Activity) {
        activityRef = WeakReference(activity)
    }

    fun detach(activity: Activity) {
        if (activityRef?.get() === activity) activityRef = null
    }

    /** 当前是否处在锁定（屏幕固定）状态。 */
    fun isLockedTask(ctx: Context): Boolean = try {
        val am = ctx.getSystemService(ActivityManager::class.java)
        (am?.lockTaskModeState ?: ActivityManager.LOCK_TASK_MODE_NONE) !=
            ActivityManager.LOCK_TASK_MODE_NONE
    } catch (e: Exception) {
        Log.w(TAG, "lockTaskModeState threw", e)
        false
    }

    fun isEnabled(ctx: Context): Boolean = State.lockEnabled(ctx)

    /**
     * 开关锁机。
     *
     * 关闭时**立刻解锁**（否则"我关掉了但还锁着"，用户只能靠返回键出口自救）；
     * Activity 不在时记一笔待办，回来第一件事就是解开。
     *
     * 打开时不动当前这一场的锁定状态：真正上锁由调用方（门队列 / onResume 复查）决定，
     * 因为上锁需要 Activity 在前台。
     */
    fun setEnabled(ctx: Context, on: Boolean) {
        State.setLockEnabled(ctx, on)
        if (!on) {
            val a = activityRef?.get()
            if (a != null) stopManually(a) else State.setLockPendingRelease(ctx, true)
            Log.i(TAG, "lock disabled")
        } else {
            // 用户明确打开了开关 → 之前那次"手动解锁"的记账作废，
            // 否则他会发现"打开了锁机却怎么也不锁"。
            State.markUnlockedSession(ctx, "")
            Log.i(TAG, "lock enabled")
        }
    }

    /**
     * 计时**在跑**（本场第一次 / 暂停后继续 / 冷启动回前台）：直接发起固定，失败才引导。
     *
     * 前置判断（都可同步得出，走回调的同步路径）：mode / 开关 / 已锁 / 会话键 /
     * 用户手动解过。之后**不再预判系统设置**，直接试：
     *
     * - `LOCKED` / `ALREADY` → 结束（已经在锁任务模式里，幂等）；
     * - `REJECTED` → 本场第一次：记账 + 交回 [Wants.PINNING_SETTINGS]，由 MainActivity
     *   跳一次系统「应用固定」页；本场已经跳过 → 只回 [Wants.NONE]，不重复打扰；
     * - `DISABLED` → 开关在调用途中被关掉：不记账、**不跳页**（用户主动关的功能不该被引导）。
     *
     * ## 0.2.5（P0-1）：`askedPinSession` 不再是"不用再锁"
     *
     * 旧代码在这里有一条 `if (askedPinSession == key) return NONE` 早退。会话键是**粘性键**
     * （暂停不清），所以"暂停 → 继续"之后同一场里 `asked == key` 恒成立 → 直接早退 →
     * `startLockTask()` 再也调不到，整场不再上锁。
     *
     * 语义本来就该分开：「**已引导过**（不再跳系统设置页）」≠「**已经锁上**（不用再锁）」。
     * 现在 `askedPinSession` 只表达前者，只在 `REJECTED` 分支里决定"跳不跳页"；
     * "要不要锁"只看 mode / 开关 / `isLockedTask` / `unlockedSession` 这几个事实。
     *
     * @param mode     这一场的网页 mode；只有 [isLockableMode] 为真的才锁
     * @param onWants  决策结果。同步路径（NONE / DISABLED / 调用直接抛异常）**立即**回调；
     *                 需要轮询复核的路径稍后回调（永远在主线程）
     */
    fun onTimerActive(activity: Activity, mode: String, onWants: (Wants) -> Unit) {
        // 休息段不锁机；自由专注（mode=free）照样锁
        if (!isLockableMode(mode)) return onWants(Wants.NONE)
        if (!State.lockEnabled(activity)) return onWants(Wants.NONE)
        if (isLockedTask(activity)) return onWants(Wants.LOCKED)

        val key = State.sessionKey(activity)
        if (key.isEmpty()) return onWants(Wants.NONE) // 还没有会话身份：不记账、不比对
        if (State.unlockedSession(activity) == key) return onWants(Wants.NONE) // 刚手动解过：本场不再锁

        start(activity) { r ->
            when (r) {
                StartResult.LOCKED, StartResult.ALREADY -> onWants(Wants.LOCKED)

                StartResult.REJECTED -> {
                    // 本场是否已经跳过设置页 —— 只决定"跳不跳页"，不决定"锁不锁"
                    val firstTime = State.askedPinSession(activity) != key
                    if (firstTime) {
                        State.markAskedPinSession(activity, key)
                        onWants(Wants.PINNING_SETTINGS) // 跳一次系统设置页兜底
                    } else {
                        onWants(Wants.NONE) // 本场已跳过，不再打扰
                    }
                }

                StartResult.DISABLED -> onWants(Wants.NONE)
            }
        }
    }

    /**
     * 回前台复查。用户从设置页回来（不管有没有开）都会走这里：
     * **直接再试一次 `start()`**，不再先读系统设置。
     *
     * - 成功 → 记账 + 锁上（用户不用再点任何东西）；
     * - 失败 → `isLockedTask()` 复查一次（状态可能迟到）：锁着当成功；仍没锁上才
     *   日志 + toast「锁机未生效」，**不再跳页**，并记账保证本场不会反复提示。
     *   刻意不说"本机不支持"—— 我们只知道这一次没锁上，不知道原因。
     *
     * 只在「刚从设置页回来」那一次自动锁：每次 resume 都试会让系统的「固定应用？」
     * 确认框反复弹（用户按取消 → resume → 再弹），那是死循环。
     *
     * @param sessionMode 当前活跃场次的 mode；null = 没有活跃场次
     * @return 本方法**不再**请求跳页（永远 NONE）；需要跳页的决策发生在
     *         [onTimerActive]，那里才是"第一次尝试失败"的地方
     */
    fun onResume(activity: Activity, sessionMode: String?): Wants {
        attach(activity)

        if (State.lockPendingRelease(activity)) {
            State.setLockPendingRelease(activity, false)
            stopManually(activity)
            return Wants.NONE
        }

        val key = State.sessionKey(activity)
        val backFromSettings = State.awaitingPinPage(activity)
        if (backFromSettings) State.setAwaitingPinPage(activity, false)

        val lockable = sessionMode != null && isLockableMode(sessionMode)
        if (!lockable || !State.lockEnabled(activity)) {
            // 计时已经不在跑 / 这一场是休息 / 用户关掉了锁机：任何残留的锁定都必须解开
            stop(activity)
            return Wants.NONE
        }
        if (isLockedTask(activity)) return Wants.NONE
        // 用户手动解锁过：本场不再自动锁回去（键由粘性键决定，下一场自动恢复）
        if (key.isNotEmpty() && State.unlockedSession(activity) == key) return Wants.NONE
        if (!backFromSettings) return Wants.NONE

        start(activity) { r ->
            when (r) {
                StartResult.LOCKED, StartResult.ALREADY -> {
                    if (key.isNotEmpty()) State.markAskedPinSession(activity, key)
                    Log.i(TAG, "locked after pinning settings page")
                }

                StartResult.REJECTED -> {
                    // 状态可能迟到：`REJECTED` 之后锁才生效也是有的（系统确认框刚点掉 / IPC 滞后）。
                    // 所以判失败前用 `isLockedTask()` 再复查一次 —— 锁着就当成功，绝不对着
                    // 已经锁上的用户弹"没锁上"。
                    val lockedNow = isLockedTask(activity)
                    if (key.isNotEmpty()) State.markAskedPinSession(activity, key)
                    if (lockedNow) {
                        Log.i(TAG, "lock task mode observed on recheck after REJECTED")
                    } else {
                        // 只说这一次没锁上，不断言"本机不支持"：我们并不知道原因。
                        Log.w(
                            TAG,
                            "lock task not effective (lockTaskModeState=${lockState(activity)}); " +
                                "skip locking this session"
                        )
                        toast(activity, "锁机未生效")
                    }
                }

                StartResult.DISABLED -> {
                    // 开关在调用途中被关掉：不是故障，不提示、不记账（下一场照常问）
                    Log.i(TAG, "lock disabled during resume recheck; stay unlocked")
                }
            }
        }
        return Wants.NONE
    }

    /** 计时暂停 / 结束：立刻解锁（用户要能正常离开）。 */
    fun onSessionEnd(activity: Activity) {
        stop(activity)
    }

    /**
     * 用户主动解锁：记下"本场已解锁"，否则下一次 `onResume` 会把他又锁回去。
     * 只调 `stopLockTask()`，不写任何网页状态。
     */
    fun stopManually(activity: Activity) {
        val key = State.sessionKey(activity)
        if (key.isNotEmpty()) State.markUnlockedSession(activity, key)
        stop(activity)
    }

    /**
     * 发起固定并**校验**（P0 的核心）。
     *
     * `startLockTask()` 是跨进程 IPC，`getLockTaskModeState()` 会滞后 —— 有 DeviceOwner /
     * 白名单时几乎立刻进 `LOCK_TASK_MODE_LOCKED`；**没有** DeviceOwner 时要先弹「固定应用？」
     * 系统确认框，用户点完才算数，`NONE` 能持续一秒以上。
     *
     * 所以复核是**多次轮询**（[VERIFY_POLL_MS]，最远 2000ms）：
     * - 任一次读到 `LOCK_TASK_MODE_LOCKED` / `LOCK_TASK_MODE_PINNED` → 立刻 [StartResult.LOCKED]
     *   并作废后续轮询（0.2.4 的 120ms 单点会在确认框还没点的时候误判"锁不上"）；
     * - 全部耗尽仍 NONE → 最后用 `isLockedTask()` 再复查一次，才 [StartResult.REJECTED]
     *   （`Log.w` 带实际 state），这就是"静默失败"的发现点。
     *
     * 每次 `start()` 都递增 [verifySeq]（单调递增 token）：上一个场次还在飞的定时器
     * 回来时 token 对不上，直接丢弃，不会把"上一场的失败"记到这一场头上。
     *
     * 同步路径（DISABLED / ALREADY / 调用抛异常）**立即**回调，这样门队列的
     * "不许同帧跳两张系统页"仍然成立（决策不需要等）。
     */
    fun start(activity: Activity, onResult: (StartResult) -> Unit = {}) {
        if (!State.lockEnabled(activity)) return onResult(StartResult.DISABLED)
        if (isLockedTask(activity)) return onResult(StartResult.ALREADY)

        val called = try {
            activity.startLockTask()
            true
        } catch (e: Exception) {
            // 厂商阉割 / 系统拒绝：降级为普通模式，绝不崩，也绝不让计时中断
            Log.w(TAG, "startLockTask threw: ${e.javaClass.simpleName} ${e.message}")
            false
        }
        if (!called) return onResult(StartResult.REJECTED)

        verifySeq++
        // 只持弱引用：轮询窗口里 Activity 被销毁时不能把整棵树钉在内存里
        scheduleVerify(WeakReference(activity), Verify(verifySeq), 0, onResult)
    }

    /** 排下一次复核（`index` 指向 [VERIFY_POLL_MS] 里的绝对时间点，延迟 = 与前一点的差）。 */
    private fun scheduleVerify(
        ref: WeakReference<Activity>,
        run: Verify,
        index: Int,
        onResult: (StartResult) -> Unit
    ) {
        val at = VERIFY_POLL_MS[index]
        val delay = if (index == 0) at else at - VERIFY_POLL_MS[index - 1]
        main.postDelayed({ verifyOnce(ref, run, index, onResult) }, delay)
    }

    /** 一次复核：命中 → LOCKED 并取消后续；耗尽 → 复查后 REJECTED。 */
    private fun verifyOnce(
        ref: WeakReference<Activity>,
        run: Verify,
        index: Int,
        onResult: (StartResult) -> Unit
    ) {
        if (run.done) return
        if (run.token != verifySeq) {
            // 上一次（甚至上一场）的定时器：token 对不上就不许回调，否则会串场
            run.done = true
            Log.i(TAG, "verify dropped: stale token ${run.token} (current $verifySeq)")
            return
        }
        val a = ref.get()
        if (a == null) {
            run.done = true
            Log.w(TAG, "verify startLockTask skipped: activity gone")
            onResult(StartResult.REJECTED)
            return
        }
        val state = lockState(a)
        if (state != ActivityManager.LOCK_TASK_MODE_NONE) {
            run.done = true
            Log.i(TAG, "startLockTask ok, lockTaskModeState=$state (after ${VERIFY_POLL_MS[index]}ms)")
            onResult(StartResult.LOCKED)
            return
        }
        val next = index + 1
        if (next < VERIFY_POLL_MS.size) {
            scheduleVerify(ref, run, next, onResult)
            return
        }
        // 全部耗尽仍是 NONE：最后复查一次 —— 状态可能就在最后一次轮询之后才到
        val lockedOnRecheck = isLockedTask(a)
        run.done = true
        if (lockedOnRecheck) {
            Log.i(TAG, "startLockTask ok on final recheck (lockTaskModeState was delayed)")
            onResult(StartResult.LOCKED)
        } else {
            Log.w(
                TAG,
                "startLockTask returned but lockTaskModeState=$state after " +
                    "${VERIFY_POLL_MS.last()}ms (expected LOCKED); treat as REJECTED"
            )
            onResult(StartResult.REJECTED)
        }
    }

    fun stop(activity: Activity) {
        if (!isLockedTask(activity)) return
        try {
            activity.stopLockTask()
            Log.i(TAG, "stopLockTask() ok")
        } catch (e: Exception) {
            Log.w(TAG, "stopLockTask failed: ${e.message}")
        }
    }

    /** 退出确认框：只解锁，不写任何网页状态（用户自己在页面点结束）。 */
    fun showExitConfirm(activity: Activity) {
        if (dialogShowing || activity.isFinishing) return
        dialogShowing = true
        try {
            AlertDialog.Builder(activity)
                .setTitle("解除锁机？")
                .setMessage("解除后会回到计时页，计时继续，记录不会丢。")
                .setPositiveButton("解除锁机") { dialog, _ ->
                    dialog.dismiss()
                    stopManually(activity)
                }
                .setNegativeButton("继续专注") { dialog, _ -> dialog.dismiss() }
                .setOnDismissListener { dialogShowing = false }
                .show()
        } catch (e: Exception) {
            // Window token 失效（Activity 正在销毁）等：不能把 dialogShowing 卡在 true
            dialogShowing = false
            Log.w(TAG, "show exit confirm failed", e)
        }
    }

    // ------------------------------------------------------------ 跳页（只给门用）

    /**
     * 「屏幕固定」设置页的 Intent。
     *
     * 本类只**描述**要跳哪里，真正 `startActivity` 的是 `MainActivity.jumpGate` 那条唯一入口。
     */
    fun pinningSettingsIntent(): Intent = Intent(ACTION_PINNING_SETTINGS)

    /** 安全设置首页：个别 ROM 没有单独的「屏幕固定」页时的退路。 */
    fun securitySettingsIntent(): Intent = Intent(Settings.ACTION_SECURITY_SETTINGS)

    /**
     * 设置页真的跳出去了 → 才记"本场已问过"。
     *
     * P2-3 的同一条原则：`asked*` 标记写在跳页**之后**，跳失败不烧掉标记
     * （否则小窗/锁机引导会被一个根本不存在的页面永久吞掉）。
     */
    fun notePinPageOpened(activity: Activity) {
        val key = State.sessionKey(activity)
        if (key.isNotEmpty()) State.markAskedPinSession(activity, key)
        State.setAwaitingPinPage(activity, true)
        Log.i(TAG, "pinning page opened, awaiting review on resume")
    }

    private fun lockState(ctx: Context): Int = try {
        ctx.getSystemService(ActivityManager::class.java)?.lockTaskModeState
            ?: ActivityManager.LOCK_TASK_MODE_NONE
    } catch (e: Exception) {
        ActivityManager.LOCK_TASK_MODE_NONE
    }

    /** toast 一律不吞异常：Activity 可能正在销毁，硬弹只会把一次引导变成一次崩溃。 */
    private fun toast(activity: Activity, text: String) {
        runCatching { Toast.makeText(activity, text, Toast.LENGTH_SHORT).show() }
            .onFailure { Log.w(TAG, "toast failed: $text", it) }
    }

    /**
     * 复核时间点（毫秒，**相对 `startLockTask()` 返回时刻的绝对偏移**，不是增量）。
     *
     * 为什么是轮询而不是 0.2.4 的 120ms 单点：没有 DeviceOwner / lockTask 白名单时，
     * `startLockTask()` 会先走系统「固定应用」确认（弹确认框或直接进 pinned 并显示系统提示条），
     * 120ms 时 `getLockTaskModeState()` 很可能还是 NONE —— 单点复核就会把"马上就要生效"
     * 误判成"锁不上"，还写 `asked` 并弹 toast，用户看到"不支持"却又能锁。
     *
     * 5 个点最远 2000ms，任一次命中即成功并取消后续；全部耗尽才判失败。
     * 2000ms 之后用户仍可返回键长按解锁，不会把谁锁死。
     */
    private val VERIFY_POLL_MS = longArrayOf(120L, 300L, 600L, 1200L, 2000L)
}
