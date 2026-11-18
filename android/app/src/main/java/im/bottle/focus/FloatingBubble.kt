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
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.Chronometer
import android.widget.FrameLayout

/**
 * 小窗（悬浮窗）：一块 96×44dp 的胶囊，里面是**系统 Chronometer**。
 *
 * 为什么必须是 Chronometer 而不是自己画：
 * - 自绘要每秒 setText，等于在原生侧养一个 1Hz 定时器，Doze 下停摆、还费电，
 *   锁屏抬头看到的数字会悄悄停在几分钟前（比没有更糟）。
 * - Chronometer 的 base 是 `SystemClock.elapsedRealtime()` 时间轴，由 choreographer 推进，
 *   不经过我们的 Handler，页面退到后台、进程被冻结也不影响显示。
 *
 * 因此这里**没有任何周期性 Handler**：只在 `endAt` 那一个时刻 post 一次隐藏
 * （一次性定时，不是每秒刷新）。
 *
 * 权限：`SYSTEM_ALERT_WINDOW` 是**特殊权限**，只能引导用户去系统页手动开，
 * 不能用 `requestPermissions`（那样永远返回 denied）。
 */
object FloatingBubble {

    private const val TAG = "BottleBubble"

    private const val WIDTH_DP = 96
    private const val HEIGHT_DP = 44
    private const val MARGIN_DP = 8

    private const val REQ_OPEN = 7301

    private val main = Handler(Looper.getMainLooper())

    private var wm: WindowManager? = null
    private var root: View? = null
    private var chronometer: Chronometer? = null
    private var params: WindowManager.LayoutParams? = null

    /** 当前展示的场次键（`mode#startTime`）；用于"同一场不重复重建"。 */
    private var shownKey = ""
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

    /** 已经显示同一场就什么都不做（避免每次上报都重建）。 */
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
            if (isShowing && shownKey == key) return@runOnMain
            // P2-1：window 已经被系统摘掉，但字段还在 → 先复位（removeView 可能抛，忽略）
            if (root != null && !isShowing) resetState()
            showInternal(ctx, session, key)
        }
    }

    /** 用户主动点通知里的「小窗」：即使之前手动关过也要重新出现。 */
    fun showFromUser(ctx: Context, session: SessionRecord) {
        runOnMain {
            if (!canDraw(ctx)) {
                // 通知 action 里不能可靠地拉起系统页（Android 10+ 后台启动限制），
                // 记一笔，回 App 时由 MainActivity 主动跳授权页。
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

    private fun showInternal(ctx: Context, session: SessionRecord, key: String) {
        hideInternal()
        val w = ctx.getSystemService(WindowManager::class.java) ?: return
        wm = w

        val density = ctx.resources.displayMetrics.density
        val width = (WIDTH_DP * density).toInt()
        val height = (HEIGHT_DP * density).toInt()
        val margin = (MARGIN_DP * density).toInt()

        val chrono = Chronometer(ctx).apply {
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            includeFontPadding = false
            gravity = Gravity.CENTER
            // base 用 elapsedRealtime 时间轴：
            //   正计时 → 把 startTime 换算成"那一刻的 elapsed"
            //   倒计时 → 把 endAt 换算成"那一刻的 elapsed"（Chronometer 各自向前/向后走）
            val nowElapsed = SystemClock.elapsedRealtime()
            val nowWall = System.currentTimeMillis()
            base = if (session.isCounting) {
                val start = if (session.startTime > 0L) session.startTime else nowWall
                nowElapsed - (nowWall - start)
            } else {
                nowElapsed + (session.endAt - nowWall)
            }
            isCountDown = !session.isCounting
            start()
        }

        val container = FrameLayout(ctx).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = height / 2f
                setColor(COLOR_BG)
                setStroke((1 * density).toInt(), COLOR_STROKE)
            }
            addView(
                chrono,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }
        container.setPadding(margin, 0, margin, 0)

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
        params = lp
        shownKey = key

        // 倒计时到点后小窗没有意义了：只 post 一次，不做每秒刷新。
        if (!session.isCounting) {
            val delay = session.endAt - System.currentTimeMillis()
            if (delay > 0L) {
                val r = Runnable {
                    Log.i(TAG, "countdown reached zero, hide bubble")
                    hideInternal()
                }
                hideAtEnd = r
                main.postDelayed(r, delay + 800L)
            }
        }
        Log.i(TAG, "bubble shown session=$key counting=${session.isCounting}")
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
        params = null
        shownKey = ""
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post { block() }
    }

    private val COLOR_BG = 0xE6141A30.toInt()
    private val COLOR_STROKE = 0x33FFFFFF
}
