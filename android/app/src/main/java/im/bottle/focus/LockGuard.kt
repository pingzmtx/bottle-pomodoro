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
 * 2. 通知 action 也要能解，但屏幕固定下通知栏是隐藏的，所以**不能只依赖通知**；
 * 3. 暂停 / 结束 / `onDestroy` 一律兜底解锁（`onDestroy` 不解锁会留下一个空白页）。
 *
 * ## 本类**不跳任何页面**（P1-C）
 *
 * 屏幕固定设置页也是系统页，和悬浮窗授权页抢栈时后一个会盖掉前一个。
 * 所以这里只回答"我要跳哪个门"（[Wants]），由 `MainActivity.jumpGate` 统一跳、
 * 统一置 busy、统一超时复位。旧代码在这里 `startActivity`，是门队列之外的第二条旁路。
 *
 * 另外：解锁**只调 `stopLockTask()`**，绝不 eval 任何 JS —— 网页状态的写者永远只有网页自己。
 */
object LockGuard {

    private const val TAG = "BottleLock"

    /**
     * 可以锁机的 mode：`focus`（番茄专注）与 `free`（自由专注：正计时 / 流式）。
     *
     * 休息段（网页写的是 `shortBreak` / `longBreak`）**不锁**：休息就该能走开，
     * 把用户钉在"该休息了"的页面上是反的。旧代码只看 `active`，休息时也锁。
     *
     * ⚠️ 千万不要写成"只认 focus"：自由专注的 mode 是 `free`，那样会把正计时/流式的
     * 锁机一起废掉（而且 `onResume` 里 `!lockable → stop()` 会**主动解锁**在跑的自由专注）。
     * 用白名单而不是黑名单，是为了以后新增 mode 时默认"不锁"（安全侧）。
     */
    private val LOCKABLE_MODES = setOf("focus", "free")

    /** 这一场该不该锁机（白名单）。 */
    fun isLockableMode(mode: String): Boolean = mode in LOCKABLE_MODES

    /**
     * 应用锁（无障碍拦截）的 mode 判据 —— **与锁机同源**（设计 A4："直接复用同一判定"）。
     *
     * 为什么不去引用 [GuardRules.GUARD_MODES]：那个文件必须零 Android 依赖才能离线跑表，
     * 方向只能是 GuardRules → 本类（不能反过来）。所以两处各写一份字面量，
     * 由 `verify.sh` 逐字断言两边完全一致 —— 口径分叉会在验收期就红，
     * 而不是等真机上出现"锁机认为在专注、应用锁认为在休息"。
     *
     * 休息段不拦：休息就该走开（同 [isLockableMode]）。
     */
    fun isGuardableMode(mode: String): Boolean = mode in LOCKABLE_MODES

    /**
     * 系统设置里的「屏幕固定」开关（没有公开常量，值是稳定的）。
     */
    private const val SECURE_LOCK_TO_APP = "lock_to_app_enabled"

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

        /** 已经 `startLockTask()` 了，不占门、不需要系统页。 */
        LOCKED,

        /** 需要「屏幕固定」设置页：由 MainActivity 统一跳（本类不 startActivity）。 */
        PINNING_SETTINGS
    }

    private val main = Handler(Looper.getMainLooper())
    private var activityRef: WeakReference<Activity>? = null
    private var dialogShowing = false

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

    /**
     * 系统设置里「屏幕固定」有没有开。
     *
     * 没有公开 API，读 Settings.Secure 是唯一可离线判定的办法；读不到就按"没开"处理
     * （宁可多跳一次设置页，也不要假装能锁）。
     */
    fun screenPinningEnabled(ctx: Context): Boolean = try {
        Settings.Secure.getInt(ctx.contentResolver, SECURE_LOCK_TO_APP, 0) == 1
    } catch (e: Exception) {
        Log.w(TAG, "read $SECURE_LOCK_TO_APP failed", e)
        false
    }

    fun isEnabled(ctx: Context): Boolean = State.lockEnabled(ctx)

    /**
     * 开关锁机。
     *
     * 关闭时**立刻解锁**（否则"我关掉了但还锁着"，用户只能靠返回键出口自救）；
     * Activity 不在时记一笔待办，回来第一件事就是解开。
     *
     * 打开时不动当前这一场的锁定状态：真正上锁由调用方（通知 action / 首次引导）决定，
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
     * 计时**刚刚开始**（每场只调一次）：主动、一步到位地引导。
     *
     * 用户已经明确说过"我允许权限"，所以这里的策略是"需要设置页就申请设置页，回来复查"，
     * 而不是弹一个只出现一次的自制提示。**但前提是用户打开了锁机开关**（默认关，
     * 首次进入计时时由 `MainActivity` 的原生对话框问一次）。
     *
     * @param mode 这一场的网页 mode；只有 [isLockableMode] 为真的才锁
     * @return 需要 MainActivity 做什么（跳哪个门由它决定）
     */
    fun onTimerActive(activity: Activity, mode: String): Wants {
        // 休息段不锁机（P2-6）；自由专注（mode=free）照样锁
        if (!isLockableMode(mode)) return Wants.NONE
        if (!State.lockEnabled(activity)) return Wants.NONE
        if (isLockedTask(activity)) return Wants.LOCKED

        val key = State.sessionKey(activity)
        if (key.isEmpty()) return Wants.NONE // 还没有会话身份：不记账、不比对（空串会和空串相等）
        if (State.askedPinSession(activity) == key) return Wants.NONE // 本场问过：不再打扰
        if (State.unlockedSession(activity) == key) return Wants.NONE // 用户刚手动解过：本场不再锁

        if (screenPinningEnabled(activity)) {
            // 不需要系统页：直接上锁，并把"本场已处理"记账
            State.markAskedPinSession(activity, key)
            return if (start(activity)) Wants.LOCKED else Wants.NONE
        }
        // 需要设置页。**这里不记账**：跳失败（ROM 没有这一页）也不该烧掉本场的标记，
        // 真正的记账在 MainActivity 跳成功之后（[notePinPageOpened]）。
        return Wants.PINNING_SETTINGS
    }

    /**
     * 回前台复查。用户从系统页回来（不管开没开）都会走这里：
     * - 开了 → 立刻 `startLockTask()`，不用再点任何东西；
     * - 没开 → **本次不锁**，只记日志 + toast（P1-4：不赌 ROM 行为，静默上锁比不锁更糟）。
     *
     * 只在「刚从设置页回来」那一次自动锁。每次 resume 都试会让系统的
     * 「固定应用？」确认框反复弹（用户按取消 → resume → 再弹），那是死循环。
     *
     * @param sessionMode 当前活跃场次的 mode；null = 没有活跃场次
     * @return true 语义已改为 [Wants]：需要跳设置页时由调用方排队
     */
    fun onResume(activity: Activity, sessionMode: String?): Wants {
        attach(activity)

        if (State.lockPendingRelease(activity)) {
            State.setLockPendingRelease(activity, false)
            stopManually(activity)
            return Wants.NONE
        }

        var want = Wants.NONE
        if (State.lockPendingStart(activity)) {
            State.setLockPendingStart(activity, false)
            if (screenPinningEnabled(activity)) {
                if (start(activity)) want = Wants.LOCKED
            } else {
                // 通知栏点的「锁机」：屏幕固定没开 → 需要设置页，回来再锁。
                want = Wants.PINNING_SETTINGS
            }
        }

        val key = State.sessionKey(activity)
        val backFromSettings = State.awaitingPinPage(activity)
        if (backFromSettings) State.setAwaitingPinPage(activity, false)

        val lockable = sessionMode != null && isLockableMode(sessionMode)
        if (!lockable || !State.lockEnabled(activity)) {
            // 计时已经不在跑 / 这一场是休息 / 用户关掉了锁机：任何残留的锁定都必须解开
            stop(activity)
            return want
        }
        if (isLockedTask(activity)) return want
        // 用户手动解锁过：本场不再自动锁回去（键由粘性键决定，下一场自动恢复）
        if (key.isNotEmpty() && State.unlockedSession(activity) == key) return want
        if (!backFromSettings) return want

        if (screenPinningEnabled(activity)) {
            if (key.isNotEmpty()) State.markAskedPinSession(activity, key)
            start(activity)
        } else {
            // P1-4：没开就不锁。旧代码在这里 `start(activity)` 赌"很多 ROM 不依赖那个开关"，
            // 结果是"用户明确拒绝后仍然被钉住" —— 这不是容错，是用用户的时间试 ROM。
            Log.i(TAG, "screen pinning still off after settings page; skip locking this session")
            toast(activity, "未开启屏幕固定，本次不锁机")
        }
        return want
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

    fun start(activity: Activity): Boolean {
        if (!State.lockEnabled(activity)) return false
        if (isLockedTask(activity)) return true
        return try {
            activity.startLockTask()
            Log.i(TAG, "startLockTask() ok, state=${lockState(activity)}")
            true
        } catch (e: Exception) {
            // 厂商阉割 / 系统拒绝：降级为普通模式，绝不崩，也绝不让计时中断
            Log.w(TAG, "startLockTask failed: ${e.javaClass.simpleName} ${e.message}")
            false
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

    // ----------------------------------------------------------- 通知 action 入口

    /**
     * 通知 action「锁机」/ 开关打开时的"上锁"入口。
     *
     * 接收器可能在没有 Activity 的后台被调起 —— 那种情况下不在后台偷偷 startLockTask，
     * 只记账，等下一次 `onResume` 再执行（`onResume` 里同样会先看屏幕固定开没开）。
     */
    fun requestLock(ctx: Context) {
        val a = activityRef?.get()
        if (a == null) {
            State.setLockPendingStart(ctx, true)
            return
        }
        main.post {
            if (screenPinningEnabled(a)) {
                start(a)
                State.setLockPendingStart(ctx, false)
            } else {
                // 屏幕固定没开：需要一张设置页。**不在本类跳**（P1-C），
                // 交给 MainActivity 的门队列；它没在前台的话门会一直排着，回前台就跳。
                State.setLockPendingStart(ctx, true)
                (a as? MainActivity)?.requestPinningGate()
            }
        }
    }

    /** 通知 action「解除锁机」。Activity 还活着就立刻解，否则记账等回来解。 */
    fun requestUnlock(ctx: Context) {
        val a = activityRef?.get()
        if (a == null) {
            State.setLockPendingRelease(ctx, true)
            return
        }
        main.post {
            stopManually(a)
            State.setLockPendingRelease(ctx, false)
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
}
