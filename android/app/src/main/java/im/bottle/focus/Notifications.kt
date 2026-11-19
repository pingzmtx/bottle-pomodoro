package im.bottle.focus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * 两个通知渠道 + 三种通知形态（设计 §5.2）。
 *
 * 关键点：计时中的通知用 `chronometer`，秒数由 SystemUI 按终点自己走，
 * **完全不经过我们进程**——零耗电、零漂移、锁屏也准。任何"App 每秒刷通知"的写法
 * 都会在 Doze 下停摆并疯狂唤醒 CPU。
 */
object Notifications {

    private const val TAG = "BottleNotify"

    /** 计时中：LOW，无声。 */
    const val CH_ONGOING = "pomo_ongoing_v1"

    /** 到点：HIGH，响铃 + 震动。渠道建成后声音/震动不可改，改声音必须升 id。 */
    const val CH_ALERT = "pomo_alert_v1"

    private const val ID_ONGOING = 1001

    /**
     * 计时中通知的槽位 id（与 [ID_ONGOING] 是同一个数）。
     *
     * 为什么要把私有常量再暴露一份：[TimerService] 必须用**同一个 id** 调
     * `startForeground(id, notification)`，否则通知栏会出现两条（一条服务持有、
     * 一条我们自己 notify 的）。这里用常量引用而不是再写一次 1001，
     * 数值永远不可能漂。
     */
    const val ONGOING_ID: Int = ID_ONGOING

    private const val ID_ALERT = 1002

    /** 网页通知的唯一槽位 id（P1-4 a）：所有 notify.show 都覆盖这同一条。 */
    private const val ID_WEB = 2001

    /**
     * 网页通知的固定 tag。固定 tag + 固定 id = "同槽位更新"，Android 不会新增一条。
     * 这也是"同一次番茄结束出现两条通知"里，网页那一条不再堆叠的关键。
     */
    const val WEB_TAG = "web-notify"

    /** 原生响铃后多久内，网页发出的"相似内容"通知视为重复（P1-4 b）。 */
    private const val DEDUPE_WINDOW_MS = 90_000L

    /** 最近一次原生响铃的时刻（wall clock，秒级足够）与文案。跨进程可读，只做去重刻度。 */
    private const val K_LAST_ALERT_AT = "notify.alertAt"
    private const val K_LAST_ALERT_TEXT = "notify.alertText"

    /** 命中任一关键词且两条文案都命中，就认为说的是同一次"到点"。 */
    private val ALERT_KEYWORDS = listOf("番茄", "时间到", "结束", "休息", "专注")

    /** 归一化时丢掉的标点（中英文常见的那几个，够用即可）。 */
    private val PUNCT = charArrayOf(
        '，', '。', '！', '？', '、', '；', '：', '「', '」', '（', '）', '~',
        ',', '.', '!', '?', ';', ':', '"', '\'', '(', ')', '·', '…', '✓', '✅'
    )

    /** 幂等创建两个渠道（Application.onCreate 调，重复调用安全）。 */
    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return

        val ongoing = NotificationChannel(
            CH_ONGOING,
            "计时中",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "专注/休息进行时的倒计时提示，静音"
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val alert = NotificationChannel(
            CH_ALERT,
            "到点提醒",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "番茄结束时的响铃与震动"
            setShowBadge(true)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
            val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            setSound(alarmUri, attrs)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        nm.createNotificationChannel(ongoing)
        nm.createNotificationChannel(alert)
    }

    /**
     * 计时中常驻通知：倒计时形态。
     *
     * @param endAtWall 网页算出的到点时刻（wall clock，毫秒）
     */
    fun showOngoing(ctx: Context, endAtWall: Long, title: String) {
        showOngoingInternal(ctx, endAtWall, title, countDown = true)
    }

    /**
     * 计时中常驻通知：**正计时**形态（A）。
     *
     * 与 [showOngoing] 共用同一个 `ID_ONGOING`（计时中只该有一条），差别只有三处：
     * - `setWhen(startTimeWall)`：Chronometer 的 base 就是通知的 `when`；
     * - `setChronometerCountDown(false)`：**往上数**，不是倒计时；
     * - 文案改成"已计时"。
     *
     * 秒数依旧由 SystemUI 自己走，`setUsesChronometer(true)` 是唯一的驱动，
     * 我们**不做**任何 1Hz 刷新（Doze 下会停摆、还费电）。
     *
     * @param startTimeWall 网页 `timerState.startTime`（wall clock，毫秒）
     */
    fun showOngoingCounting(ctx: Context, startTimeWall: Long, title: String) {
        showOngoingInternal(ctx, startTimeWall, title, countDown = false)
    }

    /**
     * 锁机按钮的三态（P1-B）。
     *
     * 旧代码把「锁机」两件事混在一个 toggle 上：文案三态 + 点击翻转，于是
     * "开关开着但当前没锁"（文案正是「锁机」）点一下就变成**关掉锁机**。
     * 新规则：**点哪个文案就做哪件事**，两个方向各用各的 action。
     */
    private data class LockAction(val label: String, val action: String, val icon: Int)

    private fun lockActions(ctx: Context): List<LockAction> {
        val locked = LockGuard.isLockedTask(ctx)
        val enabled = LockGuard.isEnabled(ctx)
        return when {
            // 已经锁着：只有"解除"这一个方向
            locked -> listOf(
                LockAction("解除锁机", HostActionReceiver.ACTION_UNLOCK, android.R.drawable.ic_lock_lock)
            )
            // 开关开着但没锁（没开屏幕固定 / 已手动解锁）：能锁、也能明确关掉开关
            enabled -> listOf(
                LockAction("锁机", HostActionReceiver.ACTION_LOCK, android.R.drawable.ic_lock_lock),
                LockAction("锁机·关", HostActionReceiver.ACTION_UNLOCK, android.R.drawable.ic_lock_idle_lock)
            )
            // 开关关着：点它就是打开并上锁（不再"关掉一个本来关着的东西"）
            else -> listOf(
                LockAction("开启锁机", HostActionReceiver.ACTION_LOCK, android.R.drawable.ic_lock_idle_lock)
            )
        }
    }

    /**
     * 只构造、不发送：计时中常驻通知的**唯一** builder。
     *
     * 抽成公开函数是为了让 [TimerService] 能用 `startForeground(ONGOING_ID, n)` 挂上
     * **同一条**通知 —— 前台服务的通知和这里 notify 出去的是同一个槽位、同一份内容，
     * 任何时刻通知栏都只会有一条（见 TimerService 的路径表）。
     */
    fun ongoingNotification(
        ctx: Context,
        baseWall: Long,
        title: String,
        countDown: Boolean
    ): Notification = buildOngoing(ctx, baseWall, title, countDown)

    private fun buildOngoing(
        ctx: Context,
        baseWall: Long,
        title: String,
        countDown: Boolean
    ): Notification {
        val builder = NotificationCompat.Builder(ctx, CH_ONGOING)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(if (countDown) "剩余时间" else "已计时")
            .setWhen(baseWall)
            .setShowWhen(true)
            .setUsesChronometer(true)
            // API 24+，minSdk 26 安全。倒计时 true / 正计时 false，这是两种形态唯一的实质差别。
            .setChronometerCountDown(countDown)
            .setOngoing(true)
            .setOnlyAlertOnce(true) // 保持：更新同一条时不再响/震
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppIntent(ctx))
        // D：纯原生动作。都走 BroadcastReceiver（exported=false），不用 Activity。
        //
        // 条件化（设计 B1 的第三个入口）：有悬浮窗权限 → 「小窗」占这个位置；
        // 没有权限 → 「设置」顶替它（位置本来就是小窗的，不额外挤掉什么）。
        // 挂不挂由 `notify.actions` 决定，用户可以在原生设置页关掉。
        val actions = State.notifyActions(ctx)
        val canBubble = FloatingBubble.canDraw(ctx)
        val first = when {
            canBubble && "bubble" in actions ->
                Triple(android.R.drawable.ic_menu_view, "小窗", HostActionReceiver.ACTION_BUBBLE)

            !canBubble && "settings" in actions ->
                Triple(
                    android.R.drawable.ic_menu_preferences,
                    "设置",
                    HostActionReceiver.ACTION_SETTINGS
                )

            else -> null
        }
        if (first != null) {
            builder.addAction(first.first, first.second, HostActionReceiver.pending(ctx, first.third))
        }
        // 锁机动作按三态挂（最多两条：锁 / 关）
        lockActions(ctx).forEach { a ->
            builder.addAction(a.icon, a.label, HostActionReceiver.pending(ctx, a.action))
        }
        return builder.build()
    }

    private fun showOngoingInternal(
        ctx: Context,
        baseWall: Long,
        title: String,
        countDown: Boolean
    ) {
        // setWhen(baseWall) 变了就整条重发一次：同 id 同 tag 的更新是"原地替换"，
        // 不会多出一条；SystemUI 的 Chronometer 读到新的 when 会直接跳到新基准
        // （暂停继续 / 回前台补 gap 后，通知栏的秒数必须跟着跳，见 Bug 1 的通知侧）。
        safeNotify(ID_ONGOING, buildOngoing(ctx, baseWall, title, countDown), ctx)
    }

    /**
     * 按已落盘的 session 重建常驻通知（切换锁机开关后刷一次 action 文案用）。
     *
     * 只读 session、不猜状态：没有活跃会话就什么都不做。
     */
    fun refreshOngoing(ctx: Context) {
        val session = State.loadSession(ctx) ?: return
        if (!session.active(System.currentTimeMillis())) return
        if (session.isCounting) {
            showOngoingCounting(ctx, session.startTime, session.title)
        } else {
            showOngoing(ctx, session.endAt, session.title)
        }
    }

    fun cancelOngoing(ctx: Context) {
        runCatching {
            ctx.getSystemService(NotificationManager::class.java)?.cancel(ID_ONGOING)
        }
    }

    /**
     * 到点提醒。
     *
     * @param silent 迟到超过 60s 时降级为静默（深夜迟到 5 分钟还响一声，比不响更烦）
     */
    fun showAlert(ctx: Context, title: String, body: String, silent: Boolean) {
        val channel = if (silent) CH_ONGOING else CH_ALERT
        val builder = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(if (silent) NotificationCompat.PRIORITY_LOW else NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppIntent(ctx))
        if (silent) builder.setSilent(true)
        safeNotify(ID_ALERT, builder.build(), ctx)

        // 记下"原生刚刚替谁响过"：网页回前台后会自己再发一条（P1-4），据此刻度去重。
        //
        // 为什么落 prefs 而不是记一个字段：到点是 AlarmReceiver 在**新进程**里跑的
        // （设计 §5.1，进程可能已经被杀），字段活不过那个进程。落盘后，用户冷启动回来时
        // 网页再发的那条通知同样能被判定成重复。
        // 用 wall clock 而不是 elapsedRealtime：跨进程/重启后只有一个时间是共同的。
        State.prefs(ctx).edit()
            .putLong(K_LAST_ALERT_AT, System.currentTimeMillis())
            .putString(K_LAST_ALERT_TEXT, title + " " + body)
            .apply()
    }

    fun cancelAlert(ctx: Context) {
        runCatching {
            ctx.getSystemService(NotificationManager::class.java)?.cancel(ID_ALERT)
        }
    }

    /**
     * 网页 `notify.show` 带 tag 时用它。
     *
     * P1-4 选了 **a + b 组合**，理由：
     * - **a（固定 tag 槽位）**：同一次番茄结束，网页可能连发多条（完成提示 / 测试通知 / 情绪文案）。
     *   用固定 tag + 固定 id，Android 语义是**更新同一条**而不是新增，通知栏不会堆叠。
     *   网页自己的 tag 只做日志用：它一次只会有一条通知，"多槽位"在这个 App 里没有真实用途。
     * - **b（90s 内容去重）**：AlarmReceiver 已经用 CH_ALERT 响过铃（响铃+震动）了，
     *   网页回前台再发的那条永远是静音的残影 —— 同一次"到点"两通知，用户只会觉得吵且重复。
     *   90s 窗口覆盖"响铃后用户点通知 / 手动回 App"的正常节奏，超出窗口就不再吞。
     *
     * 没选 c（单独渠道 `pomo_web_v1`）：多一个渠道只是把"重复"变成"两条不同渠道的重复"，
     * 用户看到的提醒条数并没有减少，反而多了一个要维护的渠道 id（渠道建好后不可改）。
     *
     * @return true = 真的发了；false = 判定为原生响铃的重复，已吞掉（Bridge 会把它回给网页）
     */
    fun showTagged(ctx: Context, tag: String, title: String, body: String, sticky: Boolean): Boolean {
        if (isDuplicateOfAlert(ctx, title, body)) {
            Log.i(TAG, "web notify suppressed (duplicate of native alert): tag=$tag title=$title")
            return false
        }
        val builder = NotificationCompat.Builder(ctx, CH_ONGOING)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(!sticky)
            .setOngoing(sticky)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppIntent(ctx))
        // 注：Notification.tag 字段不在公开 SDK 里，改由 notify(tag, id, n) 显式指定
        safeNotify(ID_WEB, builder.build(), ctx, WEB_TAG)
        return true
    }

    /**
     * 按 tag 取消网页通知。
     *
     * 因为所有网页通知共用一个槽位（P1-4 a），任何 tag 的取消都落到同一个 tag/id 上 ——
     * 这与"网页同一时刻只有一条通知"的事实一致，也避免了"show 进 A 槽位、cancel 找 B 槽位"的漏撤。
     */
    fun cancelTag(ctx: Context, tag: String) {
        runCatching {
            ctx.getSystemService(NotificationManager::class.java)?.cancel(WEB_TAG, ID_WEB)
        }
        Log.i(TAG, "web notify cancelled: tag=$tag")
    }

    /**
     * 网页通知是不是"原生刚响过的那一声"的重复。
     *
     * 窗口内且文案相似 → 吞。窗口外（用户过了一分钟才回来）→ 不吞，
     * 因为那时原生那条可能已被划掉，网页这条是唯一能看到的。
     */
    private fun isDuplicateOfAlert(ctx: Context, title: String, body: String): Boolean {
        val p = State.prefs(ctx)
        val at = p.getLong(K_LAST_ALERT_AT, 0L)
        if (at <= 0L) return false
        // 同时刻/未来时刻（用户把系统时间往回拨了）也按窗口内处理，别让去重永久失效
        val delta = System.currentTimeMillis() - at
        if (delta > DEDUPE_WINDOW_MS) return false
        if (delta < -DEDUPE_WINDOW_MS) return false
        val last = p.getString(K_LAST_ALERT_TEXT, "") ?: ""
        return similarText(last, title + " " + body)
    }

    /** 只做保守的相似判断：互相包含，或命中同一批"这是个到点提醒"的关键词。 */
    private fun similarText(a: String, b: String): Boolean {
        val na = normalizeText(a)
        val nb = normalizeText(b)
        if (na.isEmpty() || nb.isEmpty()) return true // 空文案无法区分，按同一次处理（宁可少一条）
        if (na.contains(nb) || nb.contains(na)) return true
        for (k in ALERT_KEYWORDS) {
            if (na.contains(k) && nb.contains(k)) return true
        }
        return false
    }

    /** 去掉空白与常见标点，避免"时间到！" vs "时间到" 被判成两条。 */
    private fun normalizeText(s: String): String {
        val sb = StringBuilder(s.length)
        for (ch in s) {
            if (ch.isWhitespace()) continue
            if (ch in PUNCT) continue
            sb.append(ch.lowercaseChar())
        }
        return sb.toString()
    }

    private fun safeNotify(id: Int, n: Notification, ctx: Context, tag: String? = null) {
        try {
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            if (tag != null) nm.notify(tag, id, n) else nm.notify(id, n)
        } catch (e: SecurityException) {
            // API 33+ 未授权 POST_NOTIFICATIONS 时系统会静默丢弃，个别 ROM 抛异常。
            // 不崩：网页内的完成界面照常工作（设计 §5.3）。
            Log.w(TAG, "notify denied: ${e.message}")
        } catch (e: Exception) {
            Log.w(TAG, "notify failed", e)
        }
    }

    private fun openAppIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            ctx,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
