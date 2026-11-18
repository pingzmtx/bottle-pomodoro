package im.bottle.focus

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import kotlin.math.abs

/**
 * 影子计时：只读网页上报的 `endAt`，据此排/撤系统闹钟。
 *
 * 为什么需要它：WebView 后台 JS 定时器被压到 1 次/分钟，Doze 下进程还会被冻/杀。
 * 只靠网页，"25 分钟后响"这件事没有任何东西保证。闹钟必须由系统进程负责。
 *
 * 为什么不会冲突：桥是只读的，网页是唯一写者。原生这里**只抄不写**，
 * 所以"两套账对不上"这个问题在结构上不存在（设计 §1）。
 */
class TimerWatch(private val ctx: Context) {

    sealed class ArmResult {
        data class Armed(val fireAt: Long) : ArmResult()
        data class Keep(val fireAt: Long) : ArmResult()
        data class Disarmed(val reason: String) : ArmResult()
    }

    /**
     * 网页状态变化 → 决定排、留、还是撤。
     *
     * 四条防错规则（设计 §1.4）里，任何一条命中都**不排**，
     * 因为它们的共同含义都是"网页不会在 endAt 那一刻宣布结束"。
     */
    fun onReport(s: TimerState): ArmResult {
        val now = System.currentTimeMillis()

        // 规则 4：用户在网页里关掉了提醒
        if (!s.notify) return disarm("web-notify-off")
        // 规则 1：暂停没有"到点"
        if (!s.running || s.paused) return disarm("not-running")
        // ★ 规则 2：bgPause 开着时网页的 endAt 会主动后移 = 后台不计时。
        //    此时按离开时的 endAt 定闹钟会在网页还剩几分钟时提前响（设计 §0.1 / §12）。
        //    这是本次最容易翻车的一条，不需要"优化"，是硬前置校验。
        if (s.bgPause) return disarm("bg-pause-on")
        // 规则 3：正计时没有终点；流式（flowtime）有 endAt，要排
        if (s.mode == "free" && s.freeType == "stopwatch") return disarm("count-up")
        if (s.endAt <= 0L) return disarm("no-end-at")
        // 终点已经过了（或近到排了也来不及）：不排，交给网页自己的恢复逻辑结算
        if (s.endAt - now < MIN_LEAD_MS) return disarm("too-late")

        val armed = State.loadPendingAlarm(ctx)?.endAtWall ?: 0L
        if (armed != 0L) {
            val drift = abs(s.endAt - armed)
            when {
                // ≤ 3s：抖动，不重排（否则每秒重排会把 AlarmManager 打爆）
                drift <= DRIFT_OK_MS -> return ArmResult.Keep(armed)
                // 3s~60s：打断恢复 / endAt 后移，重排一次
                drift <= DRIFT_MAX_MS -> {
                    Log.i(TAG, "drift ${drift}ms → rearm")
                    return arm(s.endAt, titleFor(s.mode, s.freeType))
                }
                // > 60s：判为换会话，丢旧闹钟按新 endAt 排
                else -> {
                    Log.i(TAG, "drift ${drift}ms > ${DRIFT_MAX_MS}ms → new session")
                    return arm(s.endAt, titleFor(s.mode, s.freeType))
                }
            }
        }
        return arm(s.endAt, titleFor(s.mode, s.freeType))
    }

    /** 排闹钟。优先 `setAlarmClock`（唯一的"准点 + 唤醒"原语），失败降级。 */
    fun arm(endAtWall: Long, title: String = DEFAULT_TITLE): ArmResult {
        val am = ctx.getSystemService(AlarmManager::class.java)
            ?: return ArmResult.Disarmed("no-alarm-service")
        val pi = alarmIntent(endAtWall)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                throw SecurityException("canScheduleExactAlarms=false")
            }
            am.setAlarmClock(AlarmManager.AlarmClockInfo(endAtWall, showAppIntent()), pi)
        } catch (e: SecurityException) {
            // 精确闹钟被用户关掉：走非精确通道，Doze 下会迟到几分钟。
            // 数据不受影响，只是响得晚（设计 §5.3）。
            Log.w(TAG, "精确闹钟不可用，降级 setAndAllowWhileIdle: ${e.message}")
            try {
                am.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    endAtWall + LATE_FALLBACK_MS,
                    pi
                )
            } catch (e2: Exception) {
                Log.e(TAG, "arm failed", e2)
                return ArmResult.Disarmed("arm-failed")
            }
        }
        State.savePendingAlarm(ctx, endAtWall, title)
        Notifications.showOngoing(ctx, endAtWall, title)
        Log.i(TAG, "armed at $endAtWall (${endAtWall - System.currentTimeMillis()}ms later)")
        return ArmResult.Armed(endAtWall)
    }

    /** 撤闹钟：取消 PendingIntent、清 prefs、撤常驻通知。三件事必须一起做。 */
    fun disarm(reason: String): ArmResult {
        val had = State.loadPendingAlarm(ctx)
        runCatching {
            ctx.getSystemService(AlarmManager::class.java)?.cancel(alarmIntent(0L))
        }
        State.clearPendingAlarm(ctx)
        Notifications.cancelOngoing(ctx)
        if (had != null) Log.i(TAG, "disarm($reason), dropped ${had.endAtWall}")
        return ArmResult.Disarmed(reason)
    }

    /**
     * 闹钟响时调用（由 AlarmReceiver 在广播里直接走 State+Notifications 流程，
     * 这里保留给"进程内投递"场景，语义一致）。
     */
    fun onAlarmFired(endAtWall: Long) {
        if (State.firedFor(ctx) == endAtWall) return // 幂等闸门
        State.markFired(ctx, endAtWall)
        Notifications.cancelOngoing(ctx)
        val late = System.currentTimeMillis() - endAtWall
        val silent = late > RING_LATE_MS
        Notifications.showAlert(ctx, DEFAULT_TITLE, if (silent) "番茄已结束" else "时间到，休息一下", silent)
        State.clearPendingAlarm(ctx)
    }

    /**
     * 回前台。
     *
     * 不做"补偿写回"（网页是唯一写者），只做两件事：
     * ① 清掉 prefs 里已经没有对应闹钟的残留常驻通知；
     * ② 已过期的账清掉（迟到的响铃没意义，网页会自己结算）。
     */
    fun onAppForeground() {
        val pending = State.loadPendingAlarm(ctx)
        val now = System.currentTimeMillis()
        if (pending == null) {
            Notifications.cancelOngoing(ctx)
            return
        }
        if (pending.endAtWall - now < MIN_LEAD_MS) {
            State.clearPendingAlarm(ctx)
            Notifications.cancelOngoing(ctx)
        }
    }

    /**
     * 系统时间 / 时区变化后重排。
     *
     * `endAt` 是 wall clock，用户改时间会让"还剩多久"整体改变；
     * 而 AlarmManager 里的 RTC 闹钟不会自动跟着变。
     */
    fun handleClockChange() {
        val pending = State.loadPendingAlarm(ctx) ?: return
        val now = System.currentTimeMillis()
        if (pending.endAtWall - now < MIN_LEAD_MS) {
            disarm("clock-changed-expired")
        } else {
            arm(pending.endAtWall, pending.title)
        }
    }

    /** 时钟变更监听器（MainActivity 在 onResume 注册、onPause 反注册）。 */
    fun createClockWatcher(): BroadcastReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, intent: Intent?) {
            Log.i(TAG, "clock changed: ${intent?.action}")
            handleClockChange()
        }
    }

    private fun alarmIntent(endAtWall: Long): PendingIntent {
        val i = Intent(ctx, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_FIRE
            // 固定 requestCode + UPDATE_CURRENT：任何时刻只应该存在一个影子闹钟。
            // PendingIntent 的匹配不看 extras，所以 cancel 时传 0 也能命中同一个。
            putExtra(AlarmReceiver.EXTRA_END_AT, endAtWall)
        }
        return PendingIntent.getBroadcast(
            ctx,
            REQ_ALARM,
            i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun showAppIntent(): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            ctx,
            0,
            i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun titleFor(mode: String, freeType: String): String = when {
        mode == "focus" -> "番茄专注中"
        mode == "break" || mode == "rest" -> "休息中"
        freeType == "flowtime" -> "流式专注中"
        else -> DEFAULT_TITLE
    }

    companion object {
        private const val TAG = "BottleWatch"
        private const val REQ_ALARM = 4101

        /** 距终点不足 1.5s 就别排了：排了也是立刻响，没有意义。 */
        const val MIN_LEAD_MS = 1_500L

        /** ≤ 3s 视为可接受漂移，不重排。 */
        const val DRIFT_OK_MS = 3_000L

        /** > 60s 判为换会话。 */
        const val DRIFT_MAX_MS = 60_000L

        /** 迟到超过 60s 降级为静默通知。 */
        const val RING_LATE_MS = 60_000L

        /** 非精确通道的冗余量：Doze 下 setAndAllowWhileIdle 的最小间隔约 9 分钟，这里只做兜底。 */
        private const val LATE_FALLBACK_MS = 90_000L

        const val DEFAULT_TITLE = "番茄专注中"
    }
}
