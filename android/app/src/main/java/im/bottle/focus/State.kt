package im.bottle.focus

import android.content.Context
import android.util.Log
import org.json.JSONObject

/**
 * 全局常量与持久化小工具。
 *
 * 这里的三条 URL 常量是**契约**：整个 App 只认这一个 origin。
 */
object State {

    /** WebViewAssetLoader 的保留域（设计 §2）。 */
    const val DOMAIN = "appassets.androidplatform.net"

    /**
     * ⚠️ 一旦发布永远不能改：localStorage / IndexedDB 按 origin 隔离，换 origin = 用户数据全部消失。
     * 所有地方（Bridge 的 allowedOriginRules、documentStart 的 origin 约束、AssetLoader 的 domain）
     * 都从这一个常量派生，不写字面量，避免三处不一致。
     */
    const val ORIGIN = "https://$DOMAIN"

    /**
     * 加载 URL 必须带 `/index.html`，不能写 `/`：
     * `/` 会被映射到目录 `assets/web/`，AssetManager 返回 null → 404 → 白屏（设计 §2）。
     */
    const val BASE_URL = "$ORIGIN/index.html"

    /** 桥对象名。产物全文里出现 0 次，233 个 window 白名单里也不存在（设计 §4.3）。 */
    const val BRIDGE_NAME = "__bottleHost"

    private const val PREFS = "bottle_focus_prefs"
    private const val K_PENDING_END_AT = "pending.endAt"
    private const val K_PENDING_TITLE = "pending.title"
    private const val K_FIRED_END_AT = "fired.endAt"
    private const val K_ASKED_EXACT = "asked.exactAlarm"
    private const val K_DESIRED_WAKE = "desired.wake"

    // ---- 会话（正计时没有闹钟，必须单独落盘才能在进程重启后恢复小窗/通知）----
    private const val K_SESSION_MODE = "session.mode"
    private const val K_SESSION_FREE_TYPE = "session.freeType"
    private const val K_SESSION_END_AT = "session.endAt"
    private const val K_SESSION_START_AT = "session.startTime"
    private const val K_SESSION_TITLE = "session.title"
    private const val K_SESSION_SAVED_AT = "session.savedAt"

    // ---- 一次计时 = 一个 session **键**（粘性键，见 [SessionKey]）。
    //      授权引导按 session 键去重：拒绝后本场不再骚扰，下一场（键不同）再问一次。
    //
    // ⚠️ 这四个标记的 pref 名必须与旧版不同：旧版存的是 Long，新版存的是 String，
    //    SharedPreferences 用 getString 读一个 Long 值会抛 ClassCastException。
    //    换名字让旧值自然成为孤儿（升级后最多多问一次），比 try/catch 兜底更可控。
    private const val K_STICKY_KEY = "session.stickyKey"
    private const val K_STICKY_MODE = "session.stickyMode"
    private const val K_STICKY_RUNNING = "session.stickyRunning"
    private const val K_STICKY_REMAINING = "session.stickyRemaining"
    private const val K_STICKY_SEQ = "session.keySeq"
    private const val K_ASKED_PIN_SESSION = "asked.pinSessionKey"
    private const val K_ASKED_OVERLAY_SESSION = "asked.overlaySessionKey"
    private const val K_OVERLAY_PENDING = "overlay.pendingRequest"
    private const val K_LOCK_PENDING_START = "lock.pendingStart"
    private const val K_LOCK_PENDING_RELEASE = "lock.pendingRelease"
    private const val K_LOCK_ENABLED = "lock.enabled"
    private const val K_LOCK_INTRO_ASKED = "lock.introAsked"
    private const val K_BUBBLE_DISMISS_SESSION = "bubble.dismissSessionKey"
    private const val K_UNLOCK_SESSION = "lock.unlockedSessionKey"
    private const val K_AWAITING_PIN = "lock.awaitingPinPage"

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---------------------------------------------------------------- 待响闹钟

    /** 记下"已经排好、还没响"的闹钟。跨进程可读，所以进程被杀后 BootReceiver 还能用它。 */
    fun savePendingAlarm(ctx: Context, endAtWall: Long, title: String) {
        prefs(ctx).edit()
            .putLong(K_PENDING_END_AT, endAtWall)
            .putString(K_PENDING_TITLE, title)
            .apply()
    }

    fun loadPendingAlarm(ctx: Context): PendingAlarm? {
        val endAt = prefs(ctx).getLong(K_PENDING_END_AT, 0L)
        if (endAt <= 0L) return null
        val title = prefs(ctx).getString(K_PENDING_TITLE, "") ?: ""
        return PendingAlarm(endAt, title)
    }

    fun clearPendingAlarm(ctx: Context) {
        prefs(ctx).edit()
            .remove(K_PENDING_END_AT)
            .remove(K_PENDING_TITLE)
            .apply()
    }

    // -------------------------------------------------------------- 幂等闸门

    /** 同一个 endAt 只响一次：AlarmManager 重复投递 / 重排残留都走这道闸。 */
    fun firedFor(ctx: Context): Long = prefs(ctx).getLong(K_FIRED_END_AT, 0L)

    fun markFired(ctx: Context, endAtWall: Long) {
        prefs(ctx).edit().putLong(K_FIRED_END_AT, endAtWall).apply()
    }

    // --------------------------------------------------------------- 一次性标记

    /** 精确闹钟授权引导只拉一次，否则每次启动都弹系统页，用户会认为 App 有病。 */
    fun exactAlarmAsked(ctx: Context): Boolean = prefs(ctx).getBoolean(K_ASKED_EXACT, false)

    fun markExactAlarmAsked(ctx: Context) {
        prefs(ctx).edit().putBoolean(K_ASKED_EXACT, true).apply()
    }

    /** 网页要的"屏幕常亮"意愿。原生自己记，不依赖 JS 回调（设计 §3.1）。 */
    fun desiredWake(ctx: Context): Boolean = prefs(ctx).getBoolean(K_DESIRED_WAKE, false)

    fun setDesiredWake(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(K_DESIRED_WAKE, on).apply()
    }

    // ------------------------------------------------------------ 会话落盘

    /**
     * 记录"当前这一场计时"。
     *
     * 倒计时原本只靠 `pending.endAt` 就够（闹钟在系统里）；但正计时**没有闹钟**，
     * 系统里唯一记得它的地方就是这里 —— 进程被杀 / 重启后，小窗与常驻通知要凭它恢复。
     *
     * 会话键**不在这里算**：它由 [updateStickySession] 单独维护（粘性键的寿命比这条记录长，
     * 暂停时这条记录会被清掉，但键必须留着）。
     */
    fun saveSession(ctx: Context, s: SessionRecord) {
        prefs(ctx).edit()
            .putString(K_SESSION_MODE, s.mode)
            .putString(K_SESSION_FREE_TYPE, s.freeType)
            .putLong(K_SESSION_END_AT, s.endAt)
            .putLong(K_SESSION_START_AT, s.startTime)
            .putString(K_SESSION_TITLE, s.title)
            .putLong(K_SESSION_SAVED_AT, s.savedAt)
            .apply()
    }

    fun loadSession(ctx: Context): SessionRecord? {
        val p = prefs(ctx)
        if (!p.contains(K_SESSION_MODE)) return null
        return SessionRecord(
            mode = p.getString(K_SESSION_MODE, "") ?: "",
            freeType = p.getString(K_SESSION_FREE_TYPE, "") ?: "",
            endAt = p.getLong(K_SESSION_END_AT, 0L),
            startTime = p.getLong(K_SESSION_START_AT, 0L),
            title = p.getString(K_SESSION_TITLE, "") ?: "",
            savedAt = p.getLong(K_SESSION_SAVED_AT, 0L)
        )
    }

    /**
     * 清掉"当前这一场"的计时记录（暂停 / 到点 / 结束）。
     *
     * ⚠️ **刻意不删**粘性键（`session.sticky*`）：会话身份的寿命比"这一场是否在跑"长。
     * 暂停时记录被清掉，但用户可能正在暂停态里手动解锁 / 长按关小窗 —— 那两个动作
     * 要按"哪一场"记账；继续时键原样留着，于是记账仍然有效（P1-1 的关键）。
     * 删掉它就会让"暂停期间的解锁"记了个空键，继续后又锁回去。
     */
    fun clearSession(ctx: Context) {
        prefs(ctx).edit()
            .remove(K_SESSION_MODE)
            .remove(K_SESSION_FREE_TYPE)
            .remove(K_SESSION_END_AT)
            .remove(K_SESSION_START_AT)
            .remove(K_SESSION_TITLE)
            .remove(K_SESSION_SAVED_AT)
            .apply()
    }

    // ------------------------------------------------------------ 粘性会话键

    /**
     * 本次进程是否已经见过"真实计时态"的帧。
     *
     * **不落盘**：它表达的是"这一帧之后页面状态已经加载完了"，跨进程没有意义。
     * 用途见 [SessionKey.decide] 的参数 `seenLiveFrame`。
     */
    private var seenLiveFrame = false

    /** 当前（或最近一场）的粘性会话键，形如 `focus#7`。空串 = 没有会话身份。 */
    fun sessionKey(ctx: Context): String = prefs(ctx).getString(K_STICKY_KEY, "") ?: ""

    /** 当前粘性键的完整状态（键 + mode + 上一次的 running/remaining）。 */
    fun stickySession(ctx: Context): SessionKey.Sticky {
        val p = prefs(ctx)
        return SessionKey.Sticky(
            key = p.getString(K_STICKY_KEY, "") ?: "",
            mode = p.getString(K_STICKY_MODE, "") ?: "",
            running = p.getBoolean(K_STICKY_RUNNING, false),
            remaining = p.getInt(K_STICKY_REMAINING, 0)
        )
    }

    /**
     * 用这一帧上报推进粘性键，并按需落盘。
     *
     * 只有状态真的变了才写 prefs（每帧都写是在浪费 IO，也容易把闪存写坏）。
     * 键的判定全部在 [SessionKey.decide]（纯函数、可离线跑表），这里只负责读写。
     *
     * @return 这一帧之后的键（空串 = 会话已结束）
     */
    fun updateStickySession(ctx: Context, frame: SessionKey.Frame): String {
        val p = prefs(ctx)
        val prev = stickySession(ctx)
        // 候选序号：只有真的生成新键时才落盘，所以"探一下"没有副作用。
        val seq = p.getLong(K_STICKY_SEQ, 0L) + 1L

        val d = SessionKey.decide(prev, frame, seq, seenLiveFrame)
        // 给下一帧用：见过非 idle 的帧之后，"回到 idle"才算真的结束。
        if (SessionKey.normalizeMode(frame.mode) != SessionKey.IDLE) seenLiveFrame = true

        if (d.key == prev.key && d.mode == prev.mode &&
            frame.running == prev.running && frame.remaining == prev.remaining
        ) {
            return d.key
        }

        val editor = p.edit()
            .putString(K_STICKY_KEY, d.key)
            .putString(K_STICKY_MODE, d.mode)
            .putBoolean(K_STICKY_RUNNING, frame.running)
            .putInt(K_STICKY_REMAINING, frame.remaining)
        if (d.generated) editor.putLong(K_STICKY_SEQ, seq)
        editor.apply()

        if (d.generated) Log.i("BottleState", "session key generated: ${d.key}")
        if (d.cleared) Log.i("BottleState", "session key cleared (session ended)")
        return d.key
    }

    /**
     * 清空粘性键。
     *
     * 只在"这一场确实结束了"的地方调用：闹钟响了 / 回前台发现闹钟早已过期
     * （进程不在时到点）。**不要**在暂停或会话记录被清时调用 —— 见 [clearSession]。
     */
    fun clearStickySession(ctx: Context) {
        val had = sessionKey(ctx)
        prefs(ctx).edit()
            .remove(K_STICKY_KEY)
            .remove(K_STICKY_MODE)
            .remove(K_STICKY_RUNNING)
            .remove(K_STICKY_REMAINING)
            .apply()
        if (had.isNotEmpty()) Log.i("BottleState", "session key dropped: $had")
    }

    // ------------------------------------------------------- session 键 / 引导

    private fun askedSession(ctx: Context, key: String): String =
        prefs(ctx).getString(key, "") ?: ""

    private fun markAskedSession(ctx: Context, key: String, session: String) {
        prefs(ctx).edit().putString(key, session).apply()
    }

    fun askedPinSession(ctx: Context): String = askedSession(ctx, K_ASKED_PIN_SESSION)

    fun markAskedPinSession(ctx: Context, session: String) =
        markAskedSession(ctx, K_ASKED_PIN_SESSION, session)

    fun askedOverlaySession(ctx: Context): String = askedSession(ctx, K_ASKED_OVERLAY_SESSION)

    fun markAskedOverlaySession(ctx: Context, session: String) =
        markAskedSession(ctx, K_ASKED_OVERLAY_SESSION, session)

    /** 用户点了通知里的「小窗」但还没有悬浮窗权限：记一笔，回 App 时主动跳授权页。 */
    fun overlayPending(ctx: Context): Boolean = prefs(ctx).getBoolean(K_OVERLAY_PENDING, false)

    fun setOverlayPending(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(K_OVERLAY_PENDING, on).apply()
    }

    fun lockPendingStart(ctx: Context): Boolean = prefs(ctx).getBoolean(K_LOCK_PENDING_START, false)

    fun setLockPendingStart(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(K_LOCK_PENDING_START, on).apply()
    }

    fun lockPendingRelease(ctx: Context): Boolean = prefs(ctx).getBoolean(K_LOCK_PENDING_RELEASE, false)

    fun setLockPendingRelease(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(K_LOCK_PENDING_RELEASE, on).apply()
    }

    /**
     * 锁机开关。**默认关**：锁机把用户钉在前台，属于"要用户点头"的能力，
     * 静默上锁是不可接受的（P1-2）。首次进入计时时问一次，之后由用户在通知栏随时切换。
     */
    fun lockEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean(K_LOCK_ENABLED, false)

    fun setLockEnabled(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(K_LOCK_ENABLED, on).apply()
    }

    /** 首次进计时时那句「专注时是否开启锁机？」问过没有（只问一次，跨进程有效）。 */
    fun lockIntroAsked(ctx: Context): Boolean = prefs(ctx).getBoolean(K_LOCK_INTRO_ASKED, false)

    fun markLockIntroAsked(ctx: Context) {
        prefs(ctx).edit().putBoolean(K_LOCK_INTRO_ASKED, true).apply()
    }

    /** 用户长按小窗手动关掉了：记住是"哪一场"（会话键），本场不再自动弹。 */
    fun bubbleDismissedSession(ctx: Context): String = prefs(ctx).getString(K_BUBBLE_DISMISS_SESSION, "") ?: ""

    fun dismissBubbleForSession(ctx: Context, session: String) {
        prefs(ctx).edit().putString(K_BUBBLE_DISMISS_SESSION, session).apply()
    }

    fun undismissBubble(ctx: Context) {
        prefs(ctx).edit().remove(K_BUBBLE_DISMISS_SESSION).apply()
    }

    /** 用户手动解锁过的那一场（会话键）：本场不再自动锁回去（否则每次 onResume 又锁上）。 */
    fun unlockedSession(ctx: Context): String = prefs(ctx).getString(K_UNLOCK_SESSION, "") ?: ""

    fun markUnlockedSession(ctx: Context, session: String) {
        prefs(ctx).edit().putString(K_UNLOCK_SESSION, session).apply()
    }

    /** 我们刚把用户送到「屏幕固定」设置页：回来要复查（且只复查这一次，避免死循环弹系统框）。 */
    fun awaitingPinPage(ctx: Context): Boolean = prefs(ctx).getBoolean(K_AWAITING_PIN, false)

    fun setAwaitingPinPage(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(K_AWAITING_PIN, on).apply()
    }

    // -------------------------------------------------------------- 网页版本号

    /**
     * 从 `assets/web/config.js` 里读 `version: 'xxxx'`，作为报障用的网页版本号。
     * 读文件而不是问 JS：进程刚起、页面还没跑起来时也能回答 device.info。
     */
    fun readWebVersion(ctx: Context): String {
        return try {
            val text = ctx.assets.open("web/config.js").bufferedReader().use { it.readText() }
            val m = Regex("version:\\s*'([^']+)'").find(text)
            m?.groupValues?.get(1) ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }
}

/** 已排好但还没响的闹钟。 */
data class PendingAlarm(val endAtWall: Long, val title: String)

/**
 * 落盘的"当前计时场次"。
 *
 * 正计时（`freeType == "stopwatch"`）没有终点、也就没有闹钟，
 * 进程重启后唯一能恢复小窗/通知依据就是这条记录。
 */
data class SessionRecord(
    val mode: String,
    val freeType: String,
    val endAt: Long,
    val startTime: Long,
    val title: String,
    val savedAt: Long
) {
    /** 正计时：只累计已过时间，没有终点。 */
    val isCounting: Boolean
        get() = freeType == "stopwatch" || endAt <= 0L

    /**
     * 这条记录现在还算"活着"吗。
     *
     * 倒计时：`endAt` 已过就不算（和闹钟的 MIN_LEAD 判据一致）。
     * 正计时：网页自身的自由专注快照有 8 小时陈旧门（`FREE_SNAP_STALE_MS`），
     * 这里用同一个上限 —— 超过就当作"用户早就不记得这回事了"，不恢复假计时。
     */
    fun active(nowWall: Long): Boolean {
        if (savedAt <= 0L) return false
        if (nowWall - savedAt > MAX_AGE_MS) return false
        if (!isCounting && endAt <= nowWall) return false
        return true
    }

    companion object {
        /** 与网页 `FREE_SNAP_STALE_MS` 对齐（8 小时）。 */
        const val MAX_AGE_MS = 8L * 60L * 60L * 1000L
    }
}

/**
 * 网页 `timerState` + `appData.settings` 的只读投影（设计 §8.7）。
 *
 * 原生只读不写：没有任何一条桥命令能改它，所以"网页/原生两套账"这个问题在结构上不存在。
 */
data class TimerState(
    val mode: String,
    val freeType: String,
    val running: Boolean,
    val paused: Boolean,
    val endAt: Long,
    val startTime: Long,
    val remaining: Int,
    val totalDuration: Int,
    val bgPause: Boolean,
    val notify: Boolean
) {
    /** 正计时（自由专注 stopwatch）：没有终点，只累计。 */
    val isCounting: Boolean
        get() = mode == "free" && freeType == "stopwatch"

    /** 投影成纯规则层入参（[ArmRules] 不依赖任何 Android 类型，便于离线单测）。 */
    fun toRulesInput(): ArmRules.Input = ArmRules.Input(
        mode = mode,
        freeType = freeType,
        running = running,
        paused = paused,
        endAt = endAt,
        startTime = startTime,
        bgPause = bgPause,
        notify = notify
    )

    companion object {
        /** 从桥上报的 JSON 构造；字段缺失一律取安全默认值（默认"不该响"）。 */
        fun from(o: JSONObject): TimerState = TimerState(
            mode = o.optString("mode", ""),
            freeType = o.optString("freeType", ""),
            running = o.optBoolean("running", false),
            paused = o.optBoolean("paused", true),
            endAt = o.optLong("endAt", 0L),
            startTime = o.optLong("startTime", 0L),
            remaining = o.optInt("remaining", 0),
            totalDuration = o.optInt("totalDuration", 0),
            bgPause = o.optBoolean("bgPause", false),
            notify = o.optBoolean("notify", true)
        )
    }
}
