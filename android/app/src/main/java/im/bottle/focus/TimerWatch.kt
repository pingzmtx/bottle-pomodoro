package im.bottle.focus

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

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

        /**
         * 正计时：不排闹钟，但已显示正计时常驻通知。
         *
         * 刻意与 [Disarmed] 分开 —— 旧代码在这里 `disarm("count-up")`，
         * 语义上等于"什么都没做"，于是正计时既没有闹钟也没有通知（本期主要缺陷）。
         */
        data class Counting(val startAt: Long) : ArmResult()
    }

    /**
     * 网页状态变化 → 决定排、留、还是撤。
     *
     * 判定本身在 [ArmRules]（纯函数，可离线跑表）；这里只负责"落地"：
     * 系统闹钟、prefs、常驻通知三件事必须同步。
     */
    fun onReport(s: TimerState): ArmResult {
        val now = System.currentTimeMillis()

        // ★ 先推进粘性会话键（P1-A）。必须排在任何判定之前：
        //   同一帧后面 MainActivity.onTimerState / LockGuard 就要读它（小窗按场次恢复、
        //   授权引导按场次去重、锁机按场次记账），读到旧的键就会把"同一场"当成"上一场"。
        //   这一步只看 mode / running / remaining，**不看 startTime / endAt 的漂移**。
        State.updateStickySession(
            ctx,
            SessionKey.Frame(
                mode = s.mode,
                freeType = s.freeType,
                running = s.running && !s.paused,
                remaining = s.remaining,
                endAt = s.endAt
            )
        )

        val running = s.running && !s.paused

        // P2-3：网页明确说"停了"（暂停 / 结束）时，小窗必须立刻消失 ——
        // 不依赖 Activity 是否还活着，也不依赖闹钟事件：**正计时没有闹钟**，
        // 旧代码里正计时小窗只能等进程死或用户手动长按才消失。
        // 这里刻意放在判定之前、无条件执行：这是"事实"而不是"判定结果"。
        if (!running) FloatingBubble.hide(ctx)

        val armed = State.loadPendingAlarm(ctx)?.endAtWall ?: 0L
        val verdict = ArmRules.decide(s.toRulesInput(), now, armed)
        return when (verdict) {
            ArmRules.Verdict.CountUp -> armCounting(s, now)

            is ArmRules.Verdict.Arm -> arm(verdict.endAtWall, titleFor(s.mode, s.freeType), s)

            is ArmRules.Verdict.Keep -> {
                // 常驻通知可能被系统清理 / 被用户划掉（虽然 ongoing 一般划不掉）。
                // Keep 只表示"闹钟不用重排"，不代表通知还在 —— 这里补一次重建。
                Notifications.showOngoing(ctx, verdict.fireAt, titleFor(s.mode, s.freeType))
                ArmResult.Keep(verdict.fireAt)
            }

            is ArmRules.Verdict.Disarm -> disarm(verdict.reason)
        }
    }

    /**
     * 正计时：不排闹钟，但显示**正计时**常驻通知（`setChronometerCountDown(false)`）。
     *
     * 三件事：
     * ① 撤掉可能残留的倒计时闹钟（从 flowtime 切到 stopwatch 时会留一条）；
     * ② 落盘 session（正计时没有闹钟，这是进程重启后唯一的恢复依据）；
     * ③ 显示正计时常驻通知。
     */
    private fun armCounting(s: TimerState, now: Long): ArmResult {
        runCatching {
            ctx.getSystemService(AlarmManager::class.java)?.cancel(alarmIntent(0L))
        }
        State.clearPendingAlarm(ctx)

        val startAt = if (s.startTime > 0L) s.startTime else now
        val title = titleFor(s.mode, s.freeType)
        State.saveSession(
            ctx,
            SessionRecord(
                mode = s.mode,
                freeType = s.freeType,
                endAt = 0L,
                startTime = startAt,
                title = title,
                savedAt = now
            )
        )
        Notifications.showOngoingCounting(ctx, startAt, title)
        Log.i(TAG, "counting since $startAt (no alarm by design)")
        return ArmResult.Counting(startAt)
    }

    /** 排闹钟。优先 `setAlarmClock`（唯一的"准点 + 唤醒"原语），失败降级。 */
    fun arm(endAtWall: Long, title: String = DEFAULT_TITLE, s: TimerState? = null): ArmResult {
        // ★ 先显示常驻通知 / 落 session，再去碰 AlarmManager。
        //
        // 旧顺序是"排成功才显示通知"，于是 `arm-failed` 分支（精确闹钟被关 + 厂商又禁了
        // setAndAllowWhileIdle）返回时**连通知都没有** —— 用户看到的是"计时在跑，
        // 通知栏什么都没有"，也就无从判断是权限问题还是 App 坏了。
        // 通知是"当前在计时"的陈述，不依赖闹钟是否排成功；闹钟失败由日志和下次上报重试兜底。
        Notifications.showOngoing(ctx, endAtWall, title)
        // s == null 的两条调用路径（时钟变更重排 / 开机恢复）手上只有 pending 的 endAt，
        // 没有 startTime。此时**绝不能**重写 session 记录：那会把 startTime 抹成 0，
        // 会话键从 `focus#<startTime>` 掉成 `focus#<endAt>`，同一场计时被换了一个身份
        // （P1-1 的键稳定性就是靠这里守住的）。已有记录原样沿用即可。
        if (s != null) {
            State.saveSession(
                ctx,
                SessionRecord(
                    mode = s.mode,
                    freeType = s.freeType,
                    endAt = endAtWall,
                    startTime = s.startTime,
                    title = title,
                    savedAt = System.currentTimeMillis()
                )
            )
        }

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
                // 常驻通知已经显示（上面），这里只报"闹钟没排上"，下次上报会重试。
                return ArmResult.Disarmed("arm-failed")
            }
        }
        State.savePendingAlarm(ctx, endAtWall, title)
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
        State.clearSession(ctx)
        Notifications.cancelOngoing(ctx)
        // ★ 小窗只在"会话结束 / 暂停"时撤（P2-4）。
        //
        // 旧代码无条件 hide：用户在网页里关掉「通知」开关（规则 4 → `web-notify-off`）时，
        // 小窗被一起撤掉，下一次上报又按 session 恢复回来 —— 屏幕上闪一下，
        // 用户以为小窗坏了。关通知不该动小窗：它是另一个开关控制的东西。
        if (reason in BUBBLE_HIDE_REASONS) FloatingBubble.hide(ctx)
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
        State.clearSession(ctx)
        // 闹钟响了 = 这一场确实结束了 → 粘性键该清（下一场必须是新键）。
        State.clearStickySession(ctx)
    }

    /**
     * 回前台。
     *
     * 不做"补偿写回"（网页是唯一写者），只做三件事：
     * ① 清掉 prefs 里已经没有对应闹钟的残留常驻通知；
     * ② 已过期的账清掉（迟到的响铃没意义，网页会自己结算）；
     * ③ **正计时**没有闹钟，只要 session 还活着就重建它的常驻通知
     *    （否则 `onAppForeground` 会把正在跑的正计时通知当成"残留"撤掉）。
     */
    fun onAppForeground() {
        val pending = State.loadPendingAlarm(ctx)
        val now = System.currentTimeMillis()
        if (pending == null) {
            val session = State.loadSession(ctx)
            // 正计时只要"最后一次已知状态是 running"就重建通知：
            // 不用 SessionRecord.active 的 8h 陈旧门（那是给开机恢复用的），
            // 否则一场超过 8 小时的正计时会在回前台时被当成残留撤掉。
            // 真正的暂停/结束会走 disarm → clearSession，所以走不到这里的"假残留"。
            if (session != null && session.isCounting) {
                Notifications.showOngoingCounting(ctx, session.startTime, session.title)
            } else {
                Notifications.cancelOngoing(ctx)
                if (session != null) State.clearSession(ctx)
            }
            return
        }
        if (pending.endAtWall - now < MIN_LEAD_MS) {
            State.clearPendingAlarm(ctx)
            State.clearSession(ctx)
            Notifications.cancelOngoing(ctx)
            // 闹钟早已过期 = 这一场在进程不在时就结束了 → 粘性键一并清掉，
            // 否则下一次"开一场"会沿用上一场（其实是昨天那场）的键，锁机永不触发。
            State.clearStickySession(ctx)
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

    /**
     * 通知标题（按 mode 判，mode 不认识时才看 freeType）。
     *
     * ⚠️ 休息段的 mode 是 `shortBreak` / `longBreak`（真页实测：`startBreak('short')` 后
     * `timerState.mode === 'shortBreak'`），不是早期设计写的 `break` / `rest`。
     * 旧代码只认 `short|long|break|rest`，于是休息时标题回落成「番茄专注中」——
     * 用户以为自己还在专注，还以为计时算错了。
     */
    private fun titleFor(mode: String, freeType: String): String = when {
        mode == "focus" -> "番茄专注中"
        mode == "shortBreak" -> "短休息中"
        mode == "longBreak" -> "长休息中"
        // 老名字留着：万一网页换回去，标题也不会掉成"番茄专注中"
        mode == "short" || mode == "long" || mode == "break" || mode == "rest" -> "休息中"
        mode == "free" && freeType == "flowtime" -> "流式专注中"
        mode == "free" && freeType == "stopwatch" -> "正计时中"
        freeType == "flowtime" -> "流式专注中"
        freeType == "stopwatch" -> "正计时中"
        else -> DEFAULT_TITLE
    }

    companion object {
        private const val TAG = "BottleWatch"
        private const val REQ_ALARM = 4101

        /**
         * 只有这些撤销原因才撤小窗（P2-4）：
         * - `not-running`：暂停 / 结束（网页说的，最可信）；
         * - `too-late`：终点已过（这一场已经结束）；
         * - `bg-pause-on`：网页自己把番茄冻结了（等价于暂停，正计时小窗继续走是错的）；
         * - `clock-changed-expired`：改时间后发现终点早已过去。
         *
         * **不含** `web-notify-off`（用户只关了通知）和 `arm-failed`（计时还在跑，只是闹钟没排上）。
         */
        private val BUBBLE_HIDE_REASONS =
            setOf("not-running", "too-late", "bg-pause-on", "clock-changed-expired")

        // 注：旧版这里有一个 `K_RUNNING = "timer.running"` 的布尔闸，用来检测"停 → 跑"并给
        // session id +1。那条逻辑是 P1-1 的根因（暂停 = running:false → 继续 = 一个新的 session），
        // 现已整体删除：会话身份改由网页自己写的 `mode#startTime` 派生（见 [SessionKey]），
        // 原生不再需要"猜"一场计时从哪一刻开始。

        /** 距终点不足 1.5s 就别排了：排了也是立刻响，没有意义。 */
        const val MIN_LEAD_MS = ArmRules.MIN_LEAD_MS

        /** ≤ 3s 视为可接受漂移，不重排。 */
        const val DRIFT_OK_MS = ArmRules.DRIFT_OK_MS

        /** > 60s 判为换会话。 */
        const val DRIFT_MAX_MS = ArmRules.DRIFT_MAX_MS

        /** 迟到超过 60s 降级为静默通知。 */
        const val RING_LATE_MS = 60_000L

        /** 非精确通道的冗余量：Doze 下 setAndAllowWhileIdle 的最小间隔约 9 分钟，这里只做兜底。 */
        private const val LATE_FALLBACK_MS = 90_000L

        const val DEFAULT_TITLE = "番茄专注中"
    }
}
