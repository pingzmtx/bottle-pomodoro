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

    /**
     * 上一次 `onReport` 的 wall clock。**只用于诊断**（Bug 2 的补强）。
     *
     * 正常节奏下网页的边沿上报是秒级/十秒级；如果两次上报之间隔了 > 90s，
     * 说明中间的进程被冻结过（cached freezer）或被杀过。打一条带 `bgPause` 与
     * `endAt` 漂移的 warn，真机一出问题就能判断是"冻结"、"bgPause 打开"还是
     * "网页改了 endAt"，不用再靠猜。
     */
    private var lastReportAt = 0L

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

        // ★ Bug 2 的诊断补强（成本一条日志）：上报间隔 > 90s = 中间被冻结/被杀过。
        //   带上 bgPause 与 endAt 漂移，就能把"冻结"、"bgPause 生效"、"网页改 endAt"
        //   三种情况在真机日志里分开 —— 否则只能看到"计时停了"这一个现象。
        val gap = if (lastReportAt > 0L) now - lastReportAt else 0L
        lastReportAt = now
        // 已排闹钟的终点（下面判定还要用，这里读一次就好，避免两次读 prefs）
        val armed = State.loadPendingAlarm(ctx)?.endAtWall ?: 0L
        if (gap > REPORT_GAP_WARN_MS) {
            Log.w(
                TAG,
                "report gap ${gap}ms (frozen or killed?), bgPause=${s.bgPause}, " +
                    "endAt drift=${if (armed != 0L) s.endAt - armed else 0L}ms, " +
                    "endAt=${s.endAt} armed=$armed fgs=${TimerService.isRunning()} " +
                    "running=${s.running} paused=${s.paused} mode=${s.mode}"
            )
        }

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

        // ★ 应用锁镜像（设计 A4c）：**唯一写者就是这里**。
        //   判定是纯函数（GuardRules.isActive：running && !paused && mode ∈ {focus, free}）；
        //   GuardService 由 system_server 绑定、生命周期与 Activity 无关，所以只能读 prefs。
        //   放在 updateStickySession 之后：activeKey 要写"这一帧之后的键"。
        Guard.syncActive(
            ctx,
            GuardRules.isActive(s.mode, s.running, s.paused),
            s.endAt,
            State.sessionKey(ctx)
        )

        // T05：任务名给小窗。只有真的变了才会 setText（不重建窗口、不起 Handler）。
        if (running) FloatingBubble.updateTaskName(ctx, s.taskName)

        // P2-3：网页明确说"停了"（暂停 / 结束）时，小窗必须立刻消失 ——
        // 不依赖 Activity 是否还活着，也不依赖闹钟事件：**正计时没有闹钟**，
        // 旧代码里正计时小窗只能等进程死或用户手动长按才消失。
        // 这里刻意放在判定之前、无条件执行：这是"事实"而不是"判定结果"。
        if (!running) FloatingBubble.hide(ctx)

        val verdict = ArmRules.decide(s.toRulesInput(), now, armed)
        return when (verdict) {
            ArmRules.Verdict.CountUp -> armCounting(s, now)

            is ArmRules.Verdict.Arm -> arm(verdict.endAtWall, titleFor(s.mode, s.freeType), s)

            is ArmRules.Verdict.Keep -> {
                // 常驻通知可能被系统清理 / 被用户划掉（虽然 ongoing 一般划不掉）。
                // Keep 只表示"闹钟不用重排"，不代表通知还在 —— 这里补一次重建。
                //
                // 基准用**网页的 endAt** 而不是已排闹钟的 fireAt：两者最多差 DRIFT_OK_MS，
                // 但通知栏要跳就必须跳到网页那个值（暂停继续 / 回前台补 gap 之后。
                // 见 Bug 1 的通知侧检查）。
                val title = titleFor(s.mode, s.freeType)
                Notifications.showOngoing(ctx, s.endAt, title)
                // ★ Bug 1：Keep 以前不写 session 记录，于是小窗从 prefs 读到的是**旧** endAt
                //   （暂停继续 / gap 补时之后差几分钟），现在把网页最新值落进去。
                //   只在真的变了才写，边沿上报下这是低频 IO。
                refreshSession(s, now, title)
                // FGS 是幂等的：已在跑就直接返回；被后台限制拒过则静默 60s。
                TimerService.ensure(ctx, s.endAt, title, countDown = true)
                ArmResult.Keep(verdict.fireAt)
            }

            is ArmRules.Verdict.Disarm -> disarm(verdict.reason)
        }
    }

    /**
     * 把这一帧的时间基准写进 session 记录（**只写变化的部分**）。
     *
     * 为什么必须做：小窗 / 开机恢复 / 通知刷新都从 `State.loadSession` 读 `endAt`，
     * 而 Keep 分支（闹钟不重排）以前完全不落盘 —— 网页在暂停继续或回前台补 gap 后
     * 改了 `endAt`，原生这边还拿着旧值，小窗就会"越走越快"（Bug 1 的根因之一）。
     */
    private fun refreshSession(s: TimerState, now: Long, title: String) {
        val prev = State.loadSession(ctx)
        val taskName = GuardRules.normalizeTaskName(s.taskName)
        if (prev != null &&
            prev.mode == s.mode && prev.freeType == s.freeType &&
            prev.endAt == s.endAt && prev.startTime == s.startTime &&
            prev.title == title && prev.taskName == taskName
        ) {
            return
        }
        State.saveSession(
            ctx,
            SessionRecord(
                mode = s.mode,
                freeType = s.freeType,
                endAt = s.endAt,
                startTime = s.startTime,
                title = title,
                savedAt = now,
                taskName = taskName
            )
        )
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
                savedAt = now,
                taskName = GuardRules.normalizeTaskName(s.taskName)
            )
        )
        Notifications.showOngoingCounting(ctx, startAt, title)
        // ★ Bug 2：正计时也要 FGS —— 它没有闹钟，"冻结期间到点"这个问题不适用，
        //   但"挂后台很久、回来发现计时停摆（快照/界面都不动）"完全一样。
        TimerService.ensure(ctx, startAt, title, countDown = false)
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
        // ★ Bug 2：让进程不进 cached freezer（否则 WebView 的 JS 定时器全停 →
        //   冻结期间到点了网页不结算、快照滞后 15s）。幂等；被后台限制拒绝时静默降级。
        TimerService.ensure(ctx, endAtWall, title, countDown = true)
        // s == null 的两条调用路径（时钟变更重排 / 开机恢复）手上只有 pending 的 endAt，
        // 没有 startTime。此时**绝不能**重写 session 记录：那会把 startTime 抹成 0，
        // 会话键从 `focus#<startTime>` 掉成 `focus#<endAt>`，同一场计时被换了一个身份
        // （P1-1 的键稳定性就是靠这里守住的）。已有记录原样沿用即可。
        if (s != null) {
            // 已有记录里可能已经有任务名（同一场的后续帧），这一帧的 taskName 是同一份真源，直接覆盖。
            State.saveSession(
                ctx,
                SessionRecord(
                    mode = s.mode,
                    freeType = s.freeType,
                    endAt = endAtWall,
                    startTime = s.startTime,
                    title = title,
                    savedAt = System.currentTimeMillis(),
                    taskName = GuardRules.normalizeTaskName(s.taskName)
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
        // ★ P2-2：FGS 持有的通知带 `FLAG_FOREGROUND_SERVICE`，`NotificationManager.cancel(1001)`
        //   对它是**无效**的，真正撤掉的是 `stopForeground(STOP_FOREGROUND_REMOVE)`。
        //   所以顺序只能是：① [TimerService.stop] —— 同进程里有服务实例时它**同步**走
        //   `stopForeground(REMOVE)` + `stopSelf`，通知在 return 之前就没了；
        //   ② [Notifications.cancelOngoing] 只作兜底（FGS 被后台限制拒过、或通知只是
        //   `showOngoing` 发的孤儿条时才真的生效）。两条路径合起来才不会出现
        //   「服务已停、通知还在」的幽灵条。
        //
        // ⚠️ 刻意**不**按 QA 的建议"web-notify-off 只撤通知、不动 FGS"：FGS 必须有可见通知，
        //   用户把通知关掉就不能再靠 FGS 保活 —— 「关通知 = 放弃后台保活」是用户的知情选择，
        //   不是缺陷。这里只撤通知（FGS 也随之结束），后台保活按该选择退出，行为保持不变。
        TimerService.stop(ctx)
        Notifications.cancelOngoing(ctx)
        // ★ 小窗只在"会话结束 / 暂停"时撤（P2-4）。
        //
        // 旧代码无条件 hide：用户在网页里关掉「通知」开关（规则 4 → `web-notify-off`）时，
        // 小窗被一起撤掉，下一次上报又按 session 恢复回来 —— 屏幕上闪一下，
        // 用户以为小窗坏了。关通知不该动小窗：它是另一个开关控制的东西。
        if (reason in BUBBLE_HIDE_REASONS) {
            FloatingBubble.hide(ctx)
            // 应用锁同步收工（与 hide 同一组原因：暂停 / 到点 / 冻结 —— 这三种都不该再拦）。
            // ⚠️ 刻意**不**包含 web-notify-off：用户只是关了通知，拦截该继续。
            Guard.clearActive(ctx)
        }
        if (had != null) Log.i(TAG, "disarm($reason), dropped ${had.endAtWall}")
        return ArmResult.Disarmed(reason)
    }

    // 注：旧版这里有一个 `TimerWatch.onAlarmFired(endAtWall)`，内容和 AlarmReceiver 的收尾
    // 几乎逐行相同，但**全仓没有任何调用者**（闹钟唯一的投递入口是 manifest 里的
    // AlarmReceiver）。两份"到点该清什么"各写一遍必然漂移 —— P1-1 的 `guard.active` 残留
    // 就是 AlarmReceiver 那侧漏了三条清理。0.2.2 直接删掉，收尾只留 AlarmReceiver 一处实现。

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
                // 回前台是"启动 FGS"的合法时机：上次在后台被拒（或进程刚重启）的，
                // 这里补一次 —— 否则这一整场都只能在"没有 FGS"的状态下跑。
                TimerService.ensure(ctx, session.startTime, session.title, countDown = false)
            } else {
                TimerService.stop(ctx)
                Notifications.cancelOngoing(ctx)
                if (session != null) State.clearSession(ctx)
            }
            return
        }
        if (pending.endAtWall - now < MIN_LEAD_MS) {
            State.clearPendingAlarm(ctx)
            State.clearSession(ctx)
            TimerService.stop(ctx)
            Notifications.cancelOngoing(ctx)
            // 闹钟早已过期 = 这一场在进程不在时就结束了 → 粘性键一并清掉，
            // 否则下一次"开一场"会沿用上一场（其实是昨天那场）的键，锁机永不触发。
            State.clearStickySession(ctx)
            Guard.clearActive(ctx)
            return
        }
        // 还活着的一场倒计时：补一次 FGS（合法时机 + 幂等），顺带修掉"通知被清掉"的残留。
        TimerService.ensure(ctx, pending.endAtWall, pending.title, countDown = true)
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

        /**
         * 两次 `onReport` 间隔超过它就打一条 warn（Bug 2 的诊断）。
         *
         * 90s 的来由：网页是**边沿上报**（秒级），加上 Doze 下 WebView 定时器被压到
         * 1 次/分钟，正常最长也就 60s 出头；超过 90s 只可能是进程被冻结过 / 被杀过。
         */
        const val REPORT_GAP_WARN_MS = 90_000L

        /** 非精确通道的冗余量：Doze 下 setAndAllowWhileIdle 的最小间隔约 9 分钟，这里只做兜底。 */
        private const val LATE_FALLBACK_MS = 90_000L

        const val DEFAULT_TITLE = "番茄专注中"
    }
}
