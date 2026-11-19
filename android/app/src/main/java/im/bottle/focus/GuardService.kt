package im.bottle.focus

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Choreographer
import android.view.accessibility.AccessibilityEvent

/**
 * 应用锁的运行时（`AccessibilityService`）。
 *
 * ## 只做五件事
 *
 * ① 只收 `TYPE_WINDOW_STATE_CHANGED`（配置里也只要这一种）；
 * ② 取 `event.packageName` → [Guard.shouldBlock] 判定；
 * ③ 同包名 1.5s 节流（一个 App 内部的 Activity 切换会连发好几个窗口事件）；
 * ④ 命中则**先 `addView` 全屏遮罩 → 下一帧 `performGlobalAction(GLOBAL_ACTION_HOME)`**；
 * ⑤ 每 30s 至多一次 [Guard.recheckExpired]（P1-1②）：把"到点 / 8h 过期却没人结算"的
 *    `guard.active` 收掉 —— 本服务是进程被绑住期间**唯一**还会被系统叫醒的东西，
 *    所以这道复核放在这里最有效（`App.onCreate` / `onResume` 可能永远不再发生）。
 *
 * ## 为什么不用"只看包名"以外的信息
 *
 * `canRetrieveWindowContent=false`：本类从不调 `getRootInActiveWindow()` / `getWindows()`，
 * 也不碰 `event.source`。权限面只有"前台是谁"这一个事实 —— 这是隐私说明能站得住的技术依据。
 *
 * ## 与深度锁机的关系（设计 A1b）
 *
 * `LockGuard.isLockedTask()` 为真时**直接 return**：任务已经被钉住，用户根本切不出去；
 * 再跑无障碍只是白耗电，而且 `GLOBAL_ACTION_HOME` 在 lockTask 下没有意义。
 */
class GuardService : AccessibilityService() {

    private val main = Handler(Looper.getMainLooper())

    /** 上一次判定的包名与时刻（同包 1.5s 节流）。 */
    private var lastPkg = ""
    private var lastAtMs = 0L

    /** 这一轮"回桌面"是否已经发过（Choreographer 帧回调与兜底定时器共用，防重复 HOME）。 */
    private var homeSent = false

    /**
     * 上一次时间复核的时刻（[SystemClock.uptimeMillis]，0 = 本进程还没复核过）。
     *
     * 为什么要有它：`onAccessibilityEvent` 在一次切 App 里会连发好几个事件，
     * 每个都读一遍 prefs 既费 IO 也没意义。30s 一次足够把"到点了却没人结算"的
     * `guard.active` 收掉（P1-1②）。
     */
    private var lastRecheckAt = 0L

    override fun onCreate() {
        super.onCreate()
        // 服务刚起来就先复核一次：此时很可能是"进程被杀 → 系统立刻重绑"的那一帧，
        // 也可能是闹钟响过但没人收尾的那一场。Guard.recheckExpired 自己会挡掉
        // `savedAt <= 0`（会话还没落盘）的情形，所以这里不必额外判断。
        recheckExpiredIfDue()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Guard.noteServiceConnected(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val e = event ?: return
        if (e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val pkg = e.packageName?.toString()?.trim().orEmpty()
        if (pkg.isEmpty()) return

        // ★ P1-1②：过期复核放在所有 return 之前 —— 即使此刻在 lockTask、或这个包名
        //   马上被 1.5s 节流掉，也要有机会把「到点了但网页不会再结算」的会话收掉。
        //   内部按 30s 节流，不会每个事件都读 prefs。
        recheckExpiredIfDue()

        // 深度锁机生效期间不拦（否则只是白耗电，且 HOME 在 lockTask 下无意义）
        if (LockGuard.isLockedTask(this)) return

        val now = SystemClock.uptimeMillis()
        if (pkg == lastPkg && now - lastAtMs < THROTTLE_MS) return
        lastPkg = pkg
        lastAtMs = now

        if (!Guard.shouldBlock(this, pkg)) return
        blockNow(pkg)
    }

    /**
     * 至多每 [RECHECK_MS] 复核一次 `guard.active` 是否还有活着的场次。
     *
     * 复核本身可能读 prefs / 清 prefs（异常路径），绝不能让无障碍服务因此崩掉 ——
     * 崩了系统会解绑，用户的应用锁直接失效。
     */
    private fun recheckExpiredIfDue() {
        val now = SystemClock.uptimeMillis()
        if (lastRecheckAt != 0L && now - lastRecheckAt < RECHECK_MS) return
        lastRecheckAt = now
        try {
            Guard.recheckExpired(this)
        } catch (e: Exception) {
            Log.w(TAG, "recheckExpired failed", e)
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "onInterrupt: 服务被系统打断，等系统重绑")
    }

    /**
     * 服务被解绑（ROM 省电清理 / 用户手动关掉 / 应用被停用）。
     *
     * 只记一笔：不能程序自开（无 API），也**不能**在这里起界面。真正的提示在
     * `MainActivity.resumeHostGates` 里按会话键去重弹一次（设计 A5 ③）。
     * 返回值保持父类语义（true）—— 系统会按自己的策略重绑，我们不去干预。
     */
    override fun onUnbind(intent: Intent?): Boolean {
        Guard.noteServiceUnbound(this)
        return super.onUnbind(intent)
    }

    // ------------------------------------------------------------------ 拦截动作

    /**
     * 命中黑名单：**先盖后打**（设计 A2）。
     *
     * 遮罩 `addView` 成功 → 下一帧 HOME（本帧目标 App 已经被盖住，用户看不到它）；
     * `addView` 失败（ROM 禁止后台弹窗）→ 直接 HOME（静默降级，不影响计时与网页状态）。
     */
    private fun blockNow(pkg: String) {
        val session = State.loadSession(this)
        val endAt = State.guardActiveEndAt(this)
        val key = State.guardActiveKey(this)

        val content = GuardOverlay.Content(
            taskName = session?.taskName ?: "",
            title = session?.title ?: TimerWatch.DEFAULT_TITLE,
            endAtWall = endAt,
            startAt = session?.startTime ?: 0L,
            sessionKey = key
        )
        val covered = GuardOverlay.show(this, content)
        Log.i(TAG, "blocked $pkg covered=$covered")
        homeToLauncher(covered)
    }

    /**
     * 回桌面：遮罩 attach 之后**下一帧**再发 HOME（[Choreographer] 的帧回调）。
     *
     * 另有一个 150ms 的兜底：极个别场景（屏幕刚亮、vsync 被冻结）帧回调可能迟到，
     * 没有兜底就等于"遮罩挂着但用户还在目标 App 里"，6s 后遮罩一撤用户会以为自己眼花了。
     */
    private fun homeToLauncher(afterOverlay: Boolean) {
        homeSent = false
        val send = Runnable { sendHome() }
        if (afterOverlay) {
            Choreographer.getInstance().postFrameCallback { send.run() }
            main.postDelayed(send, HOME_FALLBACK_MS)
        } else {
            main.post(send)
        }
    }

    private fun sendHome() {
        if (homeSent) return
        homeSent = true
        val ok = runCatching { performGlobalAction(GLOBAL_ACTION_HOME) }.getOrDefault(false)
        Log.i(TAG, "performGlobalAction(HOME) -> $ok")
    }

    companion object {
        private const val TAG = "BottleGuardSvc"

        /** 同一个包名 1.5s 内只处理一次（App 内部 Activity 切换不重复拦）。 */
        private const val THROTTLE_MS = 1_500L

        /** 帧回调的兜底：帧回调没来也必须把 HOME 发出去。 */
        private const val HOME_FALLBACK_MS = 150L

        /**
         * 过期复核的最小间隔（P1-1②）。
         *
         * 30s 的来由：`guard.active` 过期只可能发生在"到点 / 8h 陈旧"这两个时刻之后，
         * 早 30s 晚 30s 对用户没有区别；而一次切 App 会连发多个窗口事件，每事件读 prefs 白耗 IO。
         */
        private const val RECHECK_MS = 30_000L

        /** 无障碍服务是否已开启（双路检测在 [Guard.serviceEnabled]）。 */
        fun isEnabled(ctx: Context): Boolean = Guard.serviceEnabled(ctx)
    }
}
