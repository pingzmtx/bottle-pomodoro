package im.bottle.focus

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 应用锁的全屏遮罩（`TYPE_APPLICATION_OVERLAY`）。
 *
 * ## 为什么"先盖后打"（设计 A2）
 *
 * 只发 `GLOBAL_ACTION_HOME` 会让目标 App 显示约 1 帧（500ms 空窗那种体验的放大版）。
 * 正确顺序是：**先 `addView` 全屏遮罩 → 下一帧再 HOME**（由 [GuardService] 负责第二步）。
 * 本类只保证"盖住"这件事是可观测的成功（[show] 返回 true 才让 Service 去打 HOME）。
 *
 * ## 必须有自动失效路径（设计 A2b）
 *
 * 遮罩是原生全屏窗，一个 bug 就是"手机变砖"。所以三条出口同时存在：
 * ① 点「回到专注」→ PendingIntent 回 App（system 代理点击，绕过 Android 10+ 后台启动限制）；
 * ② 长按 2 秒 →「本场不再拦」（按会话键记账，下一场自动恢复）；
 * ③ **最长 6s 自动撤**，且**最短驻留 1.2s**（避免"刚盖就被撤"导致用户看到裸的目标 App）。
 *
 * ## 其它约束
 *
 * - `FLAG_NOT_FOCUSABLE`：可触摸、不抢 IME、不吞返回键（设计 A2c）；
 * - `addView` 全程 try-catch：部分 ROM 禁止后台弹窗（"后台弹出界面"是独立权限），
 *   抛异常时静默降级为"只 HOME"，不影响计时与网页状态（设计 §6 第 8 条）；
 * - 没有任何周期性 Handler：时间是系统 `Chronometer` 自己走的（与小窗同一套理由）。
 */
object GuardOverlay {

    private const val TAG = "BottleGuardOv"

    /** 最短驻留：任何"撤"的请求都推迟到这一刻之后。 */
    private const val MIN_SHOW_MS = 1_200L

    /** 最长驻留：到点无条件撤（唯一的兜底出口，不许删）。 */
    private const val MAX_SHOW_MS = 6_000L

    /** 长按多久 = 「本场不再拦」。 */
    private const val LONG_PRESS_MS = 2_000L

    private const val REQ_BACK = 7501

    private val main = Handler(Looper.getMainLooper())

    private var wm: WindowManager? = null
    private var root: View? = null
    private var maxTimer: Runnable? = null
    private var deferred: Runnable? = null

    /**
     * 上屏时用的 `applicationContext`。
     *
     * 存一份是为了 [hideNow] 能自己把 `guard.overlayUntil` 清零 —— 那个键是"跨进程的残留凭证"，
     * 手动撤（点按钮 / 长按）之后不清，下一次 `repairResidue` 会看到"没过期"而放过它。
     */
    private var appCtx: Context? = null

    private var shownAt = 0L
    private var shownKey = ""

    /** 遮罩上要显示的内容（由 [GuardService] 从 prefs 组装）。 */
    data class Content(
        val taskName: String,
        val title: String,
        val endAtWall: Long,
        val startAt: Long,
        val sessionKey: String
    )

    /** 现在真的有遮罩挂在窗口上吗。 */
    val isShowing: Boolean
        get() = root?.isAttachedToWindow == true

    /**
     * 盖一层全屏遮罩。
     *
     * @return true = 遮罩已经请求上屏（调用方**下一帧**再 `performGlobalAction(HOME)`）；
     *         false = 没有权限 / ROM 拒绝，调用方应直接 HOME（静默降级，不重试、不崩）
     */
    fun show(ctx: Context, content: Content): Boolean {
        hideNow() // 幂等：上一次的残留先拆掉，避免叠两层
        val w = ctx.getSystemService(WindowManager::class.java) ?: return false
        wm = w
        val density = ctx.resources.displayMetrics.density

        val name = GuardRules.displayName(content.taskName, content.title)
        val countingDown = GuardRules.countingDown(content.endAtWall)

        val rootView = FrameLayout(ctx).apply {
            setBackgroundColor(ctx.getColor(R.color.guard_overlay_bg))
        }

        val column = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }

        val nameView = TextView(ctx).apply {
            text = name
            setTextColor(ctx.getColor(R.color.guard_overlay_text))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            gravity = Gravity.CENTER
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            includeFontPadding = false
        }
        column.addView(nameView, LinearLayout.LayoutParams(-2, -2))

        val unitLabel = TextView(ctx).apply {
            text = if (countingDown) "剩余" else "已专注"
            setTextColor(ctx.getColor(R.color.guard_overlay_dim))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            gravity = Gravity.CENTER
        }
        column.addView(unitLabel, LinearLayout.LayoutParams(-2, -2).apply {
            topMargin = (12 * density).toInt()
        })

        val timeView = Chronometer(ctx).apply {
            setTextColor(ctx.getColor(R.color.guard_overlay_text))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 36f)
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            gravity = Gravity.CENTER
            includeFontPadding = false
            val nowElapsed = SystemClock.elapsedRealtime()
            val nowWall = System.currentTimeMillis()
            base = if (countingDown) {
                nowElapsed + (content.endAtWall - nowWall)
            } else {
                val start = if (content.startAt > 0L) content.startAt else nowWall
                nowElapsed - (nowWall - start)
            }
            isCountDown = countingDown
            start()
        }
        column.addView(timeView, LinearLayout.LayoutParams(-2, -2).apply {
            topMargin = (4 * density).toInt()
        })

        val backButton = Button(ctx).apply {
            text = ctx.getString(R.string.guard_overlay_back)
            isAllCaps = false
            setTextColor(0xFFFFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = 24 * density
                setColor(ctx.getColor(R.color.guard_overlay_button))
            }
            setPadding(
                (32 * density).toInt(), (12 * density).toInt(),
                (32 * density).toInt(), (12 * density).toInt()
            )
            setOnClickListener {
                Log.i(TAG, "back to focus tapped (session=$shownKey)")
                // PendingIntent 由系统代理点击：Android 10+ 的后台启动限制对"系统发的 PI"不生效。
                sendBackIntent(ctx)
                dismiss("back")
            }
        }
        column.addView(backButton, LinearLayout.LayoutParams(-2, -2).apply {
            topMargin = (32 * density).toInt()
        })

        val hint = TextView(ctx).apply {
            text = ctx.getString(R.string.guard_overlay_hint)
            setTextColor(ctx.getColor(R.color.guard_overlay_dim))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            gravity = Gravity.CENTER
        }
        column.addView(hint, LinearLayout.LayoutParams(-2, -2).apply {
            topMargin = (40 * density).toInt()
        })

        val center = FrameLayout.LayoutParams(-2, -2).apply {
            gravity = Gravity.CENTER
            leftMargin = (32 * density).toInt()
            rightMargin = (32 * density).toInt()
        }
        rootView.addView(column, center)

        // 长按 2 秒 = 「本场不再拦」。遮罩是 FLAG_NOT_FOCUSABLE，返回值 true 把触摸吃掉，
        // 不让它穿透到底下的 App（否则用户"点了没反应"更困惑）。
        attachLongPress(ctx, rootView)

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            android.graphics.PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

        return try {
            w.addView(rootView, lp)
            root = rootView
            appCtx = ctx.applicationContext
            shownAt = SystemClock.uptimeMillis()
            shownKey = content.sessionKey
            State.setGuardOverlayUntil(ctx, System.currentTimeMillis() + MAX_SHOW_MS)
            scheduleAutoDismiss(ctx)
            Log.i(
                TAG,
                "overlay shown: name=$name countingDown=$countingDown " +
                    "endAt=${content.endAtWall} session=$shownKey"
            )
            true
        } catch (e: Exception) {
            // 没有悬浮窗权限 / ROM 拒绝后台弹窗：静默降级（退出路径只有 HOME，不影响计时）
            Log.w(TAG, "addView failed, degrade to HOME only: ${e.javaClass.simpleName} ${e.message}")
            root = null
            false
        }
    }

    /**
     * 撤遮罩（可被「回到专注」/ 长按 / 到点 / 残留修复调用）。
     *
     * 尊重**最短驻留 1.2s**：刚盖上就被撤会让用户看到"闪一下目标 App"，比不撤更糟。
     */
    fun dismiss(reason: String) {
        runOnMain {
            val elapsed = SystemClock.uptimeMillis() - shownAt
            if (root == null) {
                cancelTimers()
                return@runOnMain
            }
            if (shownAt > 0L && elapsed < MIN_SHOW_MS) {
                deferred?.let { main.removeCallbacks(it) }
                val r = Runnable {
                    Log.i(TAG, "dismiss(deferred $reason)")
                    hideNow()
                }
                deferred = r
                main.postDelayed(r, MIN_SHOW_MS - elapsed)
                return@runOnMain
            }
            Log.i(TAG, "dismiss($reason)")
            hideNow()
        }
    }

    private fun scheduleAutoDismiss(ctx: Context) {
        cancelTimers()
        val r = Runnable {
            Log.i(TAG, "auto dismiss after ${MAX_SHOW_MS}ms (session=$shownKey)")
            State.setGuardOverlayUntil(ctx, 0L)
            hideNow()
        }
        maxTimer = r
        main.postDelayed(r, MAX_SHOW_MS)
    }

    private fun cancelTimers() {
        maxTimer?.let { main.removeCallbacks(it) }
        maxTimer = null
        deferred?.let { main.removeCallbacks(it) }
        deferred = null
    }

    /** 立即摘窗 + 复位字段。先 `removeView` 再清字段（与小窗同一条教训：不留幽灵窗）。 */
    private fun hideNow() {
        cancelTimers()
        val v = root
        if (v != null) {
            runCatching { wm?.removeView(v) }
                .onFailure { Log.w(TAG, "removeView failed: ${it.message}") }
        }
        // 残留凭证跟着窗口一起清：窗口没了，`guard.overlayUntil` 就没有意义了。
        appCtx?.let { State.setGuardOverlayUntil(it, 0L) }
        root = null
        wm = null
        appCtx = null
        shownAt = 0L
        shownKey = ""
    }

    private fun attachLongPress(ctx: Context, host: View) {
        var pressStart = 0L
        var fired = false
        var pending: Runnable? = null

        host.setOnTouchListener { _, ev ->
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    pressStart = SystemClock.uptimeMillis()
                    fired = false
                    val r = Runnable {
                        fired = true
                        val key = shownKey
                        Log.i(TAG, "long press: allow session $key")
                        if (key.isNotEmpty()) State.markUnlockedSession(ctx, key)
                        runCatching {
                            android.widget.Toast.makeText(
                                ctx, "本场不再拦截", android.widget.Toast.LENGTH_SHORT
                            ).show()
                        }
                        dismiss("long-press")
                    }
                    pending = r
                    main.postDelayed(r, LONG_PRESS_MS)
                    true
                }

                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    pending?.let { main.removeCallbacks(it) }
                    pending = null
                    if (!fired && SystemClock.uptimeMillis() - pressStart < LONG_PRESS_MS) {
                        // 短按空白处：不关（关掉就等于放行一次），只提示一下怎么出去
                        runCatching {
                            android.widget.Toast.makeText(
                                ctx, "长按 2 秒可本场放行", android.widget.Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                    true
                }

                else -> true
            }
        }
    }

    private fun sendBackIntent(ctx: Context) {
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            ctx,
            REQ_BACK,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        runCatching { pi.send() }.onFailure { Log.w(TAG, "send back intent failed", it) }
    }

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post { block() }
    }
}
