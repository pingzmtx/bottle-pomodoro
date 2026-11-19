package im.bottle.focus

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Point
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.Chronometer
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 小窗（悬浮窗）：一块 148×48dp 的胶囊，**单行双区** —— 左任务名（12sp）+ 右 Chronometer（16sp）。
 *
 * 为什么必须是 Chronometer 而不是自己画：
 * - 自绘要每秒 setText，等于在原生侧养一个 1Hz 定时器，Doze 下停摆、还费电，
 *   锁屏抬头看到的数字会悄悄停在几分钟前（比没有更糟）。
 * - Chronometer 的 base 是 `SystemClock.elapsedRealtime()` 时间轴，由 choreographer 推进，
 *   不经过我们的 Handler，页面退到后台、进程被冻结也不影响显示。
 *
 * 因此这里**没有任何周期性 Handler**：只在 `endAt` 那一个时刻 post 一次隐藏
 * （一次性定时，不是每秒刷新）。任务名同理：只有 `timer.report` 说它变了才 `setText`
 * （[updateTaskName]），**不重建窗口**、不新增 Handler（设计 C3）。
 *
 * 为什么是"一行"而不是"两行"（设计 C2）：两行会把高度顶到 56dp，锁屏/顶部遮挡更明显；
 * 48dp 是"不挡内容"与"看得清"的折中，而 Chronometer 的 base 逻辑一行都不用改。
 *
 * 权限：`SYSTEM_ALERT_WINDOW` 是**特殊权限**，只能引导用户去系统页手动开，
 * 不能用 `requestPermissions`（那样永远返回 denied）。
 */
object FloatingBubble {

    private const val TAG = "BottleBubble"

    /** 带任务名时的宽度（原 96dp）。 */
    private const val WIDTH_DP = 148

    /** 关掉任务名后回落的宽度（原 96dp，时间仍然完整可见）。 */
    private const val WIDTH_COMPACT_DP = 96

    private const val HEIGHT_DP = 48
    private const val MARGIN_DP = 8

    /** 任务名区最大宽度：72dp / 12sp 约 5–6 个汉字后出省略号（设计 C4）。 */
    private const val NAME_MAX_WIDTH_DP = 72

    private const val REQ_OPEN = 7301

    private val main = Handler(Looper.getMainLooper())

    private var wm: WindowManager? = null
    private var root: View? = null
    private var chronometer: Chronometer? = null
    private var nameView: TextView? = null
    private var params: WindowManager.LayoutParams? = null

    /** 当前展示的场次键（`mode#startTime`）；用于"同一场不重复重建"。 */
    private var shownKey = ""

    /** 当前窗口是"带名字区"还是"紧凑"形态：设置页的开关变了要按它判断是否重建。 */
    private var shownShowName = true

    /** 当前窗口对应的通知标题（空任务名时回落到它，设计 C5）。 */
    private var shownTitle = ""

    /**
     * 当前 Chronometer 的 `base` 是**按哪一组时间基准**算出来的。
     *
     * 这三个字段是"要不要重算 base"的唯一判据（Bug 1 的根因）：
     * 会话键是粘性的（暂停继续不变），所以**键相同不代表时间基准相同** ——
     * 网页在"暂停 → 继续"和"回前台补 gap"时都会重算 `endAt`，
     * 旧代码只比键就直接 return，于是 Chronometer 永远停在暂停前那个 `endAt` 上，
     * 小窗越走越快、差值越积越大。
     */
    private var shownEndAt = 0L
    private var shownStartTime = 0L
    private var shownCounting = false

    /**
     * 进程内最新的任务名（**不落盘**：它是网页状态的投影，真源永远在网页）。
     *
     * 小窗没显示时也记下来：下一次 `show` 直接用最新名字，不会先闪一帧旧名。
     */
    private var currentTaskName = ""

    private var hideAtEnd: Runnable? = null

    /** 悬浮窗权限：系统特殊权限，只能由用户手动授予。 */
    fun canDraw(ctx: Context): Boolean = try {
        Settings.canDrawOverlays(ctx)
    } catch (e: Exception) {
        Log.w(TAG, "canDrawOverlays threw", e)
        false
    }

    /**
     * 现在**真的**挂在 WindowManager 上吗。
     *
     * P2-1：只看 `root != null` 是不够的 —— 窗口可能已经被系统移除（权限被撤销、
     * 系统清理悬浮窗、切用户），而我们的字段还留着旧值。旧代码因此走进
     * `if (isShowing && shownSession == sid) return`，于是"重新授权也显示不出来"。
     * `isAttachedToWindow` 才是"它还活着"的真值。
     */
    val isShowing: Boolean
        get() = root?.isAttachedToWindow == true

    /**
     * 按场次恢复（进程重启 / 回前台 / BootReceiver）。
     *
     * 用户长按关掉的那一场不会自己回来（`bubble.dismissSessionKey == 当前会话键`）；
     * 换一场计时键就变了，于是自动重新出现 —— 这正是"本次会话不再自动弹"。
     */
    fun restore(ctx: Context, session: SessionRecord) {
        val key: String = State.sessionKey(ctx)
        if (key.isNotEmpty() && State.bubbleDismissedSession(ctx) == key) {
            Log.i(TAG, "restore skipped: dismissed for session $key")
            return
        }
        ensureShown(ctx, session)
    }

    /**
     * 已经显示同一场（形态也一致）就什么都不做（避免每次上报都重建）。
     *
     * ★ Bug 1 的闸门（2026-11 真机反馈）：键相同 **不等于** 时间基准相同。
     * 判据必须把 `endAt` / `startTime` / 是否正计时一起比：
     * - 网页暂停→继续时 `endAt = now + remaining*1000`（`engine_timer.js`）；
     * - 回前台 `bgPause` 会把 `endAt += gap*1000`（`engine_init.js`）。
     * 这两种情况会话键都不变，旧代码直接 return → Chronometer 的 base 停在旧 `endAt`，
     * 小窗比网页走得快。现在"键同、基准变"走 [retuneChronometer]：**不重建窗口**
     * （不闪、不丢拖动位置）、也**不起任何 Handler**（零周期 Handler 的设计不变）。
     */
    fun ensureShown(ctx: Context, session: SessionRecord) {
        runOnMain {
            if (!canDraw(ctx)) {
                Log.i(TAG, "overlay permission missing, bubble not shown")
                return@runOnMain
            }
            // 已经过期/陈旧的场次不显示：倒计时归零后挂在屏幕上会一直显示负数
            if (!session.active(System.currentTimeMillis())) {
                hideInternal()
                return@runOnMain
            }
            val key = State.sessionKey(ctx)
            val showName = State.bubbleShowTaskName(ctx)
            if (isShowing && shownKey == key && shownShowName == showName) {
                // 键与形态都没变：只有时间基准变了才需要动（否则每帧都重算 base 也会闪）
                if (shownEndAt == session.endAt &&
                    shownStartTime == session.startTime &&
                    shownCounting == session.isCounting &&
                    shownTitle == session.title
                ) {
                    return@runOnMain
                }
                retuneChronometer(session, key)
                return@runOnMain
            }
            // P2-1：window 已经被系统摘掉，但字段还在 → 先复位（removeView 可能抛，忽略）
            if (root != null && !isShowing) resetState()
            showInternal(ctx, session, key)
        }
    }

    /**
     * 用户**主动**要求显示小窗：即使之前手动关过也要重新出现（`bubble.dismissSessionKey` 清掉）。
     *
     * 0.2.4 起通知栏不再有「小窗」按钮（用户明确要求删掉所有 action），
     * 这条路径留给"以后从设置页 / 快捷方式触发"的入口；没有权限时仍然只记账，
     * 由 `MainActivity.resumeHostGates` 回前台时排授权门（后台不能可靠地拉系统页）。
     */
    fun showFromUser(ctx: Context, session: SessionRecord) {
        runOnMain {
            if (!canDraw(ctx)) {
                State.setOverlayPending(ctx, true)
                Log.i(TAG, "overlay permission missing, pending request recorded")
                return@runOnMain
            }
            State.undismissBubble(ctx)
            showInternal(ctx, session, State.sessionKey(ctx))
        }
    }

    fun hide(ctx: Context) {
        runOnMain { hideInternal() }
    }

    /**
     * 更新任务名（T05，设计 C3）。
     *
     * 只在文本真的变了才 `textView.text = ...`：
     * - **不重建窗口**（重建会闪一下，也会丢掉用户拖到的位置）；
     * - **不加 Handler**（"零周期 Handler"的设计不能破：时间由 Chronometer 自己走，
     *   任务名是低频文本，`timer.report` 的边沿上报已经替我们做了节流）。
     *
     * @param rawTaskName 网页 `timerState.taskName`（shim 已截断 64 字符，这里再归一化一次）
     */
    fun updateTaskName(ctx: Context, rawTaskName: String) {
        val name = GuardRules.normalizeTaskName(rawTaskName)
        if (name == currentTaskName) return
        currentTaskName = name
        runOnMain {
            val tv = nameView ?: return@runOnMain // 窗口没显示：值已经记下，show 时直接用
            val text = GuardRules.displayName(currentTaskName, shownTitle)
            if (tv.text?.toString() == text) return@runOnMain
            tv.text = text
        }
    }

    private fun showInternal(ctx: Context, session: SessionRecord, key: String) {
        hideInternal()
        val w = ctx.getSystemService(WindowManager::class.java) ?: return
        wm = w

        val density = ctx.resources.displayMetrics.density
        val showName = State.bubbleShowTaskName(ctx)
        val width = ((if (showName) WIDTH_DP else WIDTH_COMPACT_DP) * density).toInt()
        val height = (HEIGHT_DP * density).toInt()
        val margin = (MARGIN_DP * density).toInt()
        val padH = (10 * density).toInt()

        val chrono = Chronometer(ctx).apply {
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            includeFontPadding = false
            gravity = Gravity.CENTER
            // base 用 elapsedRealtime 时间轴：
            //   正计时 → 把 startTime 换算成"那一刻的 elapsed"
            //   倒计时 → 把 endAt 换算成"那一刻的 elapsed"（Chronometer 各自向前/向后走）
            base = chronometerBaseFor(session)
            isCountDown = !session.isCounting
            start()
        }

        // 左区：任务名（12sp / maxWidth 72dp / ellipsize=END）
        val name = TextView(ctx).apply {
            setTextColor(0xCCFFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            includeFontPadding = false
            gravity = Gravity.CENTER_VERTICAL or Gravity.START
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            maxWidth = (NAME_MAX_WIDTH_DP * density).toInt()
            text = GuardRules.displayName(currentTaskName, session.title)
            visibility = if (showName) View.VISIBLE else View.GONE
        }

        val container = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(padH, 0, padH, 0)
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = height / 2f
                setColor(COLOR_BG)
                setStroke((1 * density).toInt(), COLOR_STROKE)
            }
            addView(
                name,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.MATCH_PARENT
                ).apply { rightMargin = (6 * density).toInt() }
            )
            addView(
                chrono,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.MATCH_PARENT
                )
            )
        }

        val lp = WindowManager.LayoutParams(
            width,
            height,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = margin
            y = (ctx.resources.displayMetrics.heightPixels * 0.12f).toInt()
        }

        attachGestures(ctx, container, lp, key, margin)

        try {
            w.addView(container, lp)
        } catch (e: Exception) {
            // 权限被撤销 / ROM 拒绝：不崩，也不留半截状态
            Log.w(TAG, "addView failed: ${e.message}")
            resetState()
            return
        }
        root = container
        chronometer = chrono
        nameView = name
        params = lp
        shownKey = key
        shownShowName = showName
        shownTitle = session.title
        shownEndAt = session.endAt
        shownStartTime = session.startTime
        shownCounting = session.isCounting

        // 倒计时到点后小窗没有意义了：只 post 一次，不做每秒刷新。
        scheduleHideAtEnd(session)
        Log.i(
            TAG,
            "bubble shown session=$key counting=${session.isCounting} " +
                "endAt=${session.endAt} name='${GuardRules.displayName(currentTaskName, session.title)}' " +
                "width=$width"
        )
    }

    /**
     * 重算 Chronometer 的基准（Bug 1 的修复动作）。
     *
     * 什么时候会被调用：会话键没变、窗口还在屏幕上，但网页把 `endAt` / `startTime` 改了
     * （暂停→继续、回前台补 gap、时区/时间被改）。**不重建窗口**：
     * 重建会闪一下，也会把用户拖到的位置丢掉。
     *
     * 为什么连 `stop()/start()` 一起做：
     * - `base` / `isCountDown` 的 setter 各自会 `updateText()`（AOSP 实现），文本会立刻正确；
     * - 但 Chronometer 内部的 ticking 循环（`updateRunning()` 那套状态）只在
     *   `mRunning` 变化时才会重新对齐节拍。倒计时→正计时这种方向翻转、
     *   或者长时间冻结后回来，光改 base 可能让节拍停在旧相位上；
     * - 三步（stop → 改 base/方向 → start）在**同一个主线程消息**里同步完成，
     *   中间没有任何一帧被绘制，所以用户看不到"跳一下"。
     */
    private fun retuneChronometer(session: SessionRecord, key: String) {
        val chrono = chronometer ?: return
        hideAtEnd?.let { main.removeCallbacks(it) }
        hideAtEnd = null
        if (!session.active(System.currentTimeMillis())) {
            Log.i(TAG, "retune skipped: session already over, hide bubble")
            hideInternal()
            return
        }
        chrono.stop()
        chrono.base = chronometerBaseFor(session)
        chrono.isCountDown = !session.isCounting
        chrono.start()
        shownTitle = session.title
        shownEndAt = session.endAt
        shownStartTime = session.startTime
        shownCounting = session.isCounting
        // 标题（空任务名时的回落文案）可能随 mode 变了：只 setText，不动窗口（C3 同理）
        nameView?.let { tv ->
            val text = GuardRules.displayName(currentTaskName, session.title)
            if (tv.text?.toString() != text) tv.text = text
        }
        // 终点变了 → 旧的"到点自动隐藏"定时器已经不指新终点了，必须按新 endAt 重排一次
        scheduleHideAtEnd(session)
        Log.i(
            TAG,
            "bubble retuned session=$key counting=${session.isCounting} " +
                "endAt=${session.endAt} startTime=${session.startTime}"
        )
    }

    /**
     * `base` 的换算（`elapsedRealtime` 时间轴）。
     *
     * 正计时：`nowElapsed - (nowWall - startTime)` —— 把起点换算成"那一刻的 elapsed"；
     * 倒计时：`nowElapsed + (endAt - nowWall)` —— 终点同理（Chronometer 自己往回数）。
     * `startTime` 缺失（旧数据 / 网页还没填）时以"现在"为起点，不显示一个天文数字。
     */
    private fun chronometerBaseFor(session: SessionRecord): Long {
        val nowElapsed = SystemClock.elapsedRealtime()
        val nowWall = System.currentTimeMillis()
        return if (session.isCounting) {
            val start = if (session.startTime > 0L) session.startTime else nowWall
            nowElapsed - (nowWall - start)
        } else {
            nowElapsed + (session.endAt - nowWall)
        }
    }

    /** 倒计时到点后自动隐藏：只有这一次性 post，没有周期 Handler。 */
    private fun scheduleHideAtEnd(session: SessionRecord) {
        hideAtEnd?.let { main.removeCallbacks(it) }
        hideAtEnd = null
        if (session.isCounting) return
        val delay = session.endAt - System.currentTimeMillis()
        if (delay <= 0L) return
        val r = Runnable {
            Log.i(TAG, "countdown reached zero, hide bubble")
            hideInternal()
        }
        hideAtEnd = r
        main.postDelayed(r, delay + 800L)
    }

    /** 拖拽 + 松手吸附 + 单击回 App + 长按隐藏。 */
    private fun attachGestures(
        ctx: Context,
        view: View,
        lp: WindowManager.LayoutParams,
        sid: String,
        margin: Int
    ) {
        val slop = ViewConfiguration.get(ctx).scaledTouchSlop
        val longPressTimeout = ViewConfiguration.getLongPressTimeout().toLong()

        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        var longPressed = false
        var downAt = 0L
        var longPress: Runnable? = null

        view.setOnTouchListener { _, ev ->
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = ev.rawX
                    downRawY = ev.rawY
                    startX = lp.x
                    startY = lp.y
                    dragging = false
                    longPressed = false
                    downAt = SystemClock.uptimeMillis()
                    val r = Runnable {
                        longPressed = true
                        Log.i(TAG, "bubble long-pressed, hiding for session $sid")
                        State.dismissBubbleForSession(ctx, sid)
                        hideInternal()
                    }
                    longPress = r
                    main.postDelayed(r, longPressTimeout)
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = (ev.rawX - downRawX).toInt()
                    val dy = (ev.rawY - downRawY).toInt()
                    if (!dragging && (Math.abs(dx) > slop || Math.abs(dy) > slop)) {
                        dragging = true
                        longPress?.let { main.removeCallbacks(it) }
                        longPress = null
                    }
                    if (dragging) {
                        lp.x = startX + dx
                        lp.y = startY + dy
                        runCatching { wm?.updateViewLayout(view, lp) }
                    }
                    true
                }

                MotionEvent.ACTION_UP -> {
                    longPress?.let { main.removeCallbacks(it) }
                    longPress = null
                    val elapsed = SystemClock.uptimeMillis() - downAt
                    if (!longPressed) {
                        if (dragging || elapsed > longPressTimeout) {
                            snapToEdge(ctx, lp, margin)
                        } else {
                            openApp(ctx)
                        }
                    }
                    dragging = false
                    true
                }

                MotionEvent.ACTION_CANCEL -> {
                    longPress?.let { main.removeCallbacks(it) }
                    longPress = null
                    if (dragging) snapToEdge(ctx, lp, margin)
                    dragging = false
                    true
                }

                else -> false
            }
        }
    }

    /** 松手吸附左右边缘（并夹在屏幕内，避免拖出可视区后再也点不到）。 */
    private fun snapToEdge(ctx: Context, lp: WindowManager.LayoutParams, margin: Int) {
        val w = wm ?: return
        val size = screenSize(w)
        val maxX = (size.x - lp.width - margin).coerceAtLeast(margin)
        val maxY = (size.y - lp.height - margin).coerceAtLeast(margin)
        lp.x = if (lp.x + lp.width / 2 < size.x / 2) margin else maxX
        lp.y = lp.y.coerceIn(margin, maxY)
        root?.let { runCatching { w.updateViewLayout(it, lp) } }
    }

    private fun screenSize(w: WindowManager): Point {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = w.currentWindowMetrics.bounds
            return Point(b.width(), b.height())
        }
        val p = Point()
        @Suppress("DEPRECATION")
        w.defaultDisplay.getRealSize(p)
        return p
    }

    /** 点击回 App。`MainActivity` 是 singleTask，会回到原来那一个实例。 */
    private fun openApp(ctx: Context) {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            ctx,
            REQ_OPEN,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        runCatching { pi.send() }.onFailure { Log.w(TAG, "openApp failed", it) }
    }

    private fun hideInternal() {
        hideAtEnd?.let { main.removeCallbacks(it) }
        hideAtEnd = null
        resetState()
        Log.i(TAG, "bubble hidden")
    }

    /**
     * 撤窗口 + 复位内存里的字段。
     *
     * P2-5：旧版只清字段、不 `removeView`，于是"reset 之后又重建"会在屏幕上多留一个
     * 幽灵窗（字段里已经没有它了，谁也撤不掉它，只能等系统回收）。
     * 现在顺序是**先摘窗再清字段**：`removeView` 抛异常（窗口已被系统摘掉 / 权限被撤销）
     * 也要继续把字段清干净 —— 不清字段会让"同一场不重建"的判断永久成立。
     */
    private fun resetState() {
        val v = root
        if (v != null) {
            runCatching { wm?.removeView(v) }
                .onFailure { Log.w(TAG, "removeView failed: ${it.message}") }
        }
        root = null
        chronometer = null
        nameView = null
        params = null
        shownKey = ""
        shownTitle = ""
        // Bug 1：基准字段必须一起清零 —— 留着旧值会让"下一次 show 前的那次比较"
        // 误判成"基准没变"（hide → show 之间是隔着窗口生命周期的，字段必须与窗口同寿）。
        shownEndAt = 0L
        shownStartTime = 0L
        shownCounting = false
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post { block() }
    }

    private val COLOR_BG = 0xE6141A30.toInt()
    private val COLOR_STROKE = 0x33FFFFFF
}
