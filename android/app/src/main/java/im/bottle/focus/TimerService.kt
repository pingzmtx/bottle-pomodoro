package im.bottle.focus

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * 计时期间的**保活前台服务**（Bug 2 的根治手段）。
 *
 * 为什么需要它：Android 12+ 的 **cached app freezer** 会在 App 进入 cached 状态后
 * 冻结整个进程（包含 WebView renderer）。`setInterval` 全停 → 网页的结算、15s 快照、
 * 到期判断全部停摆；解冻后 `endAt - now` 虽然能追平显示，但：
 * - 冻结期间到了点，网页不知道（`AlarmReceiver` 响了，页面却不结算）；
 * - 冻结期间被 LMK 杀掉，最后一次快照最多滞后 15 秒。
 * 用户看到的就是「卡在后台那一刻」。前台服务是 Android 上唯一合规的解法：
 * 只要有 FGS，进程就**不会**进入 cached / freezer。
 *
 * ★ 本服务**不做任何计时**：不算剩余、不起 Handler、不写网页状态。
 *   它只做两件事：① 让进程不进 freezer；② 持有那条计时中通知（同一个槽位）。
 *   秒数依旧由 SystemUI 按通知的 `when` 自己走（零耗电、零漂移）。
 *
 * 通知栏**永远只有一条**，路径表（start/stop 都只碰 id = Notifications.ONGOING_ID）：
 *
 * | 场景                          | 谁 startForeground                     | 谁 stopForeground            |
 * |-------------------------------|----------------------------------------|------------------------------|
 * | 倒计时 arm 成功               | TimerWatch.arm → ensure → 本服务        | —                            |
 * | 正计时（没有闹钟）             | TimerWatch.armCounting → ensure → 本服务 | —                            |
 * | Keep（闹钟不重排，页面仍在跑）  | TimerWatch.onReport → ensure（已 running 时直接返回） | —              |
 * | 回前台 / 开机恢复             | TimerWatch.onAppForeground / BootReceiver→arm → ensure | —            |
 * | 暂停、结束、网页关提醒         | —                                      | TimerWatch.disarm → stop     |
 * | 到点（闹钟广播，本进程内）      | —                                      | AlarmReceiver → stop（若服务还在）    |
 * | 到点（进程被换起，新进程收广播） | 不启动（后台限制），只留通知             | AlarmReceiver → stop（若服务恰好还在） |
 * | 回前台发现闹钟早已过期         | —                                      | onAppForeground → stop       |
 * | 服务自己发现没有活着的场次      | —                                      | onStartCommand → stopSelf    |
 *
 * 也就是说：**同一条通知 id** 只会被"启动 FGS"或"停掉 FGS + 撤通知"两条路径触碰，
 * 不存在"一条服务的通知 + 一条 notify 的通知"并存的情况。
 *
 * Android 12+ 的后台启动限制：从 [BootReceiver] / [AlarmReceiver] 这类后台场景
 * `startForegroundService()` 会抛 `ForegroundServiceStartNotAllowedException`
 * （API 31+；低版本是 IllegalStateException 的其它子类），[ensure] 一律 catch，
 * 降级成"只有通知、没有 FGS" —— 此时仍然靠系统闹钟保底（闹钟由 system_server 负责，
 * 从不依赖我们的进程）。降级后 [RETRY_COOLDOWN_MS] 内不再重试，避免日志刷屏；
 * 下次回前台（[TimerWatch.onAppForeground]）会再试一次，那是合法时机。
 */
class TimerService : Service() {

    override fun onCreate() {
        super.onCreate()
        // 本进程唯一的实例：`stop()` 靠它在同进程里**同步**收工（见 companion 的 stop）。
        instance = this
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent != null && ACTION_STOP == intent.action) {
            Log.i(TAG, "stop action received")
            stopForegroundAndSelf()
            return START_NOT_STICKY
        }

        val spec = specOf(intent)
        if (spec == null) {
            // 没有活着的场次（进程被杀后 START_STICKY 重启 / session 已被 disarm 清掉）：
            // 立刻退出，不挂一条空通知。
            Log.i(TAG, "no live session, service ends")
            stopForegroundAndSelf()
            return START_NOT_STICKY
        }

        // ★ P2-1：通知的**构造**必须和 startForeground 在同一个 try 里。
        //   `Notifications.ongoingNotification(...)` 会读 prefs（会话记录）、
        //   问 `LockGuard.isLockedTask`（`ActivityManager`）—— 任何一处抛
        //   （prefs 类型污染、ROM 的 AppOps 异常、通知被禁）都会让
        //   onStartCommand **带着"已 startForegroundService、却从未 startForeground"的账**退出，
        //   系统 10s 后直接 RemoteServiceException 杀进程，用户看到「应用停止运行」。
        //   这里保证二选一：成功 → 真的进了前台；失败 → 撤前台 + stopSelf + 一条 error。
        var foreground = false
        try {
            val notif = Notifications.ongoingNotification(
                this, spec.baseWall, spec.title, spec.countDown
            )
            // 同一个 id + 同一份内容 = 与 Notifications.showOngoing 那条**同一条通知**，
            // 通知栏不会多出一条。
            ServiceCompat.startForeground(this, Notifications.ONGOING_ID, notif, foregroundType())
            foreground = true
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed (${e.javaClass.simpleName}: ${e.message})", e)
        } finally {
            // 绝不允许"启动了前台服务但没进前台"（那是必崩的账）。
            if (!foreground) stopForegroundAndSelf()
        }
        if (!foreground) {
            Log.e(TAG, "foreground not established, service ends (no notification kept)")
            return START_NOT_STICKY
        }
        running = true
        Log.i(
            TAG,
            "foreground on: countDown=${spec.countDown} base=${spec.baseWall} " +
                "left=${spec.baseWall - System.currentTimeMillis()}ms"
        )
        // START_STICKY：被系统杀掉后按 prefs 里的 session 重建（不猜状态、不做补偿写入）。
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        instance = null
        // 同 P2（0.2.3）：onDestroy 里抛出会走 SystemServer 的"服务崩溃"路径，
        // 用户看到「应用停止运行」，而这里唯一要做的事只是撤掉前台通知。
        runCatching { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE) }
            .onFailure { Log.w(TAG, "stopForeground(REMOVE) failed in onDestroy", it) }
        Log.i(TAG, "service destroyed, foreground removed")
        super.onDestroy()
    }

    /**
     * `startForeground` + `stopSelf` 一起做：任何退出路径都不留半条通知。
     *
     * ★ P2（0.2.3）：两步各自 `runCatching`。本函数是 `onStartCommand` 的 `finally` 里
     * 唯一兜底（P2-1 的"二选一"保证）：一旦 `stopForeground(REMOVE)` 或 `stopSelf()`
     * 自己抛出（ROM 的 AppOps / Binder 异常、服务已被系统摘掉），异常会**逃逸出
     * `onStartCommand`** —— 那样 finally 没走完，而调用方看到的是"服务崩了"，
     * P2-1 立的那条保证就失效了。这里保证两件事：
     * ① 第一步抛了也一定执行第二步（`stopSelf` 不能因为撤通知失败被跳过）；
     * ② 任何一步失败都不会让异常飞出 `onStartCommand`。
     */
    private fun stopForegroundAndSelf() {
        running = false
        runCatching { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE) }
            .onFailure { Log.w(TAG, "stopForeground(REMOVE) failed", it) }
        runCatching { stopSelf() }
            .onFailure { Log.w(TAG, "stopSelf failed", it) }
    }

    /**
     * 这一条 FGS 该用哪种通知形态。
     *
     * 优先用 Intent 里的（正常路径：TimerWatch 刚算完，值最新）；
     * intent 为 null（START_STICKY 重启）时退回落盘的 session ——
     * 只读，不写，也不改变"网页是唯一写者"的结论。
     */
    private fun specOf(intent: Intent?): Spec? {
        if (intent != null) {
            val baseWall = intent.getLongExtra(EXTRA_BASE_WALL, 0L)
            if (baseWall > 0L) {
                return Spec(
                    baseWall = baseWall,
                    title = intent.getStringExtra(EXTRA_TITLE) ?: TimerWatch.DEFAULT_TITLE,
                    countDown = intent.getBooleanExtra(EXTRA_COUNT_DOWN, true)
                )
            }
        }
        val s = State.loadSession(this) ?: return null
        if (!s.active(System.currentTimeMillis())) return null
        return if (s.isCounting) {
            if (s.startTime <= 0L) null else Spec(s.startTime, s.title, countDown = false)
        } else {
            Spec(s.endAt, s.title, countDown = true)
        }
    }

    /** API 34 起 `startForeground` 必须带类型；34 以下传 0（ServiceCompat 会忽略）。 */
    private fun foregroundType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }

    /** FGS 的入参（只描述"通知长什么样"，不含任何计时逻辑）。 */
    private data class Spec(val baseWall: Long, val title: String, val countDown: Boolean)

    companion object {
        private const val TAG = "BottleTimerService"

        /** 显式停止（onStartCommand 里认这个 action，极少用到，留着表达意图）。 */
        private const val ACTION_STOP = "im.bottle.focus.action.TIMER_SERVICE_STOP"

        private const val EXTRA_BASE_WALL = "baseWall"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_COUNT_DOWN = "countDown"

        /** 被后台启动限制拒掉后，多久之内不再重试（避免每次上报都抛一次异常刷日志）。 */
        private const val RETRY_COOLDOWN_MS = 60_000L

        /** 本进程里 FGS 是否活着（只有一个进程，静态标记足够；仅用于"已在跑就别再 start"）。 */
        @Volatile
        private var running = false

        /**
         * 本进程内的服务实例（`onCreate` 赋值、`onDestroy` 清空）。
         *
         * 存在的唯一目的：让 [stop] 能在**同进程内同步**调 `stopForeground(REMOVE)`。
         * 从外部拿不到 Service 实例，只能 `stopService()`（异步），而 FGS 通知在服务还活着时
         * 是撤不掉的（见 [stop] 的说明）。
         */
        @Volatile
        private var instance: TimerService? = null

        /** 后台启动被拒后的静默期（`SystemClock.elapsedRealtime()` 时间轴，0 = 没有静默）。 */
        @Volatile
        private var blockedUntil = 0L

        /** 现在是否有 FGS 在跑（诊断 / 日志用）。 */
        fun isRunning(): Boolean = running

        /**
         * 确保 FGS 在跑（幂等，代价极低）。
         *
         * @return true = FGS 在跑（或已经起来了）；false = 被后台限制拒绝 / 参数无效，
         *         调用方**不需要**做任何补偿 —— 常驻通知已经由 `Notifications.showOngoing*`
         *         发过了，闹钟也照旧由 system_server 负责。
         */
        fun ensure(ctx: Context, baseWall: Long, title: String, countDown: Boolean): Boolean {
            if (baseWall <= 0L) return false
            if (running) return true
            val now = SystemClock.elapsedRealtime()
            if (now < blockedUntil) return false

            val intent = Intent(ctx, TimerService::class.java).apply {
                putExtra(EXTRA_BASE_WALL, baseWall)
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_COUNT_DOWN, countDown)
            }
            return try {
                ContextCompat.startForegroundService(ctx, intent)
                true
            } catch (e: Exception) {
                // Android 12+ 后台启动限制（ForegroundServiceStartNotAllowedException
                // 是 IllegalStateException 的子类，这里按 Exception 兜住，不引用只在 31+
                // 存在的类名）：降级为"只有通知、没有 FGS"，靠闹钟保底。
                blockedUntil = now + RETRY_COOLDOWN_MS
                Log.w(
                    TAG,
                    "startForegroundService refused, degrade to notification-only " +
                        "(${e.javaClass.simpleName}: ${e.message}); alarm still guards the end"
                )
                false
            }
        }

        /**
         * 停掉 FGS 并撤掉它持有的通知（幂等；服务没跑时安全）。
         *
         * ★ P2-2：只 `stopService()` 是不够的。FGS 持有的那条通知带 `FLAG_FOREGROUND_SERVICE`，
         * 在服务退到后台之前 `NotificationManager.cancel(ONGOING_ID)` 会被系统**忽略**；
         * 而 `stopService` 是异步的，服务要几百 ms 后才 `onDestroy` —— 那一段窗口里就会看到
         * 「服务已停、通知还在」的幽灵条。所以：
         * - 同进程里有实例（常态）：直接在实例上做 `stopForeground(STOP_FOREGROUND_REMOVE)` + `stopSelf`，
         *   本函数返回时通知已经撤掉；
         * - 没有实例（FGS 从没起来 / 被后台限制拒过 / 通知只是 `showOngoing` 发的）：
         *   退回 `stopService`（幂等），通知由调用方的 `cancelOngoing` 撤。
         */
        fun stop(ctx: Context) {
            running = false
            blockedUntil = 0L
            val inst = instance
            if (inst != null) {
                inst.stopForegroundAndSelf()
                return
            }
            runCatching { ctx.stopService(Intent(ctx, TimerService::class.java)) }
                .onFailure { Log.w(TAG, "stopService failed", it) }
        }
    }
}
