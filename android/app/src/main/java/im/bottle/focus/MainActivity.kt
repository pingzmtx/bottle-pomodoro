package im.bottle.focus

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.MotionEvent
import android.widget.FrameLayout
import android.widget.Toast
import androidx.core.content.ContextCompat

/**
 * 宿主 Activity：容器、返回键阶梯的下半段（"2 秒内再按一次"）、权限申请/回填、
 * 时钟变更监听、触摸打点。
 *
 * 刻意不用 AppCompat（设计 §7）：WebView 把 99% 的 UI 干完了，多一个依赖只是多一份升级负担。
 */
class MainActivity : Activity() {

    private lateinit var container: FrameLayout
    private lateinit var host: WebAppHost
    private lateinit var bridge: Bridge
    private lateinit var watch: TimerWatch
    private lateinit var files: FileExchange

    private val mainHandler = Handler(Looper.getMainLooper())

    private var clockWatcher: BroadcastReceiver? = null

    /** 返回键状态机：token 防"上一次的异步结果"污染这一次。 */
    private var backToken = 0
    private var backResolved = false
    private var lastExitPressAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 状态栏/导航栏用网页自己声明的 theme-color（设计 §0.4），不自己挑颜色
        window.statusBarColor = CHROME_COLOR
        window.navigationBarColor = CHROME_COLOR

        container = FrameLayout(this)
        container.setBackgroundColor(PAGE_BG)
        setContentView(container)

        host = WebAppHost(this)
        host.attach(container)
        watch = TimerWatch(applicationContext)
        files = FileExchange(this)
        bridge = Bridge(this, host, watch, files)

        // 顺序要紧：先装桥（addWebMessageListener）再装 shim，最后才 loadUrl。
        // shim 的第一行就会读 window.__bottleHost，桥晚一天装它就只剩一条 "[bottle] bridge missing"。
        host.installBridge(bridge)
        // WebChromeClient 也必须早于 loadUrl：导入要它弹选择器，alert/confirm 要它才不是空操作。
        host.installChromeClient(files)
        if (!host.installShim()) {
            Log.w(
                TAG,
                "shim 退回 onPageStarted 注入：可能晚于页面脚本，" +
                    "Notification 能力探测有概率仍判为不支持（设计 §3.2 已记录该风险）"
            )
        }
        host.loadApp()
    }

    override fun onResume() {
        super.onResume()

        if (clockWatcher == null) {
            val receiver = watch.createClockWatcher()
            clockWatcher = receiver
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_TIME_CHANGED)
                addAction(Intent.ACTION_TIMEZONE_CHANGED)
            }
            // 系统广播：NOT_EXPORTED 也能收到，且不对外暴露
            ContextCompat.registerReceiver(
                this, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED
            )
        }

        watch.onAppForeground()

        // 唤醒锁状态漂移（设计 §3.1）：系统在 onPause 时会自动清 keep-screen-on，
        // 但没法给 JS 派 release 事件 → 网页里的 _wakeLock 一直是真值 → 回来不再补请求。
        // 解法：原生自己记意愿，回前台无条件重放，不依赖 JS 的任何回调。
        if (State.desiredWake(this)) {
            host.webView.keepScreenOn = true
        }

        // 精确闹钟授权引导：只在"用户真的开始计时过"之后问，且只问一次
        maybeRequestExactAlarm()
    }

    override fun onPause() {
        clockWatcher?.let {
            runCatching { unregisterReceiver(it) }
            clockWatcher = null
        }
        // 刻意不调 webView.onPause()：让 JS 定时器尽量继续跑，
        // 也避免 onPause/onResume 反复触发 WebView 的可见性变化。
        super.onPause()
    }

    override fun onDestroy() {
        clockWatcher?.let {
            runCatching { unregisterReceiver(it) }
            clockWatcher = null
        }
        mainHandler.removeCallbacksAndMessages(null)
        if (::files.isInitialized) files.release()
        host.destroy()
        super.onDestroy()
    }

    /**
     * 文件选择 / 导出目的地的结果回填。
     *
     * 宿主是 `android.app.Activity`（不是 AppCompat），没有 `registerForActivityResult`，
     * 所以只能走这条老路：requestCode 由 [FileExchange] 自己认领（9002 / 9003，
     * 刻意避开本类的 REQ_NOTIFICATION = 9001），认领不到才交给 super。
     */
    @Deprecated("Activity#onActivityResult", ReplaceWith("registerForActivityResult"))
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (::files.isInitialized && files.onActivityResult(requestCode, resultCode, data)) return
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    /**
     * 返回键。
     *
     * 前四级阶梯在网页里（与网页自己的 Escape handler 同序），原生只拿 `'handled' | 'exit'`。
     * 绝不走 WebView 的历史栈返回：切 tab 走 `replaceState`，不产生历史记录，
     * 历史栈返回会把用户直接退出 App（设计 §0.3）。
     */
    // 注：Activity#onBackPressed 在新 SDK 标记为 deprecated，但 manifest 里
    // enableOnBackInvokedCallback="false" 让它继续是唯一入口，这里刻意保留。
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        backToken++
        val token = backToken
        backResolved = false

        // 兜底：WebView 卡死 / 还没加载完时回调可能不来，不能把用户困在 App 里
        val fallback = Runnable {
            if (token == backToken && !backResolved) {
                backResolved = true
                onExitBranch()
            }
        }
        mainHandler.postDelayed(fallback, BACK_TIMEOUT_MS)

        host.evalWithResult(BACK_JS) { raw ->
            if (token != backToken || backResolved) return@evalWithResult
            backResolved = true
            mainHandler.removeCallbacks(fallback)
            val verdict = raw?.trim()?.trim('"')
            if (verdict != "handled") {
                onExitBranch()
            }
        }
    }

    /** 第五级：2 秒内再按一次才真的退出。 */
    private fun onExitBranch() {
        val now = SystemClock.uptimeMillis()
        if (now - lastExitPressAt <= EXIT_WINDOW_MS) {
            finish()
            return
        }
        lastExitPressAt = now
        Toast.makeText(this, "再按一次返回键退出", Toast.LENGTH_SHORT).show()
    }

    /** 触摸打点：供 shim 判断"这次 requestPermission 有没有用户手势"。 */
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
            if (::bridge.isInitialized) bridge.markUserGesture()
        }
        return super.dispatchTouchEvent(ev)
    }

    // ------------------------------------------------------------------ 权限

    fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        runCatching {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATION)
        }.onFailure { Log.w(TAG, "request notification permission failed", it) }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_NOTIFICATION) return
        val granted = grantResults.isNotEmpty() &&
            grantResults[0] == PackageManager.PERMISSION_GRANTED
        Log.i(TAG, "notification permission granted=$granted")
        // 回推 JS：设置页的"未授权"立刻变"已授权"，不用重启（设计 §5.3）
        bridge.onPermissionResult(granted)
    }

    /**
     * 首次真正开始计时时调（由 Bridge 在收到 running 上报时触发）。
     * 冷启动不弹任何权限框 —— 有手势、有上下文时才问。
     */
    fun onTimerRunningReported() {
        val prefs = State.prefs(this)
        prefs.edit().putBoolean(K_TIMER_STARTED, true).apply()

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (prefs.getBoolean(K_NOTIF_ASKED, false)) return
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) return
        prefs.edit().putBoolean(K_NOTIF_ASKED, true).apply()
        requestNotificationPermission()
    }

    /**
     * 精确闹钟授权：`canScheduleExactAlarms()` 为 false 时拉起系统页，**只拉一次**。
     * 被拒后走 `setAndAllowWhileIdle`，Doze 下迟到几分钟，数据不受影响（设计 §5.3）。
     */
    private fun maybeRequestExactAlarm() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        if (!State.prefs(this).getBoolean(K_TIMER_STARTED, false)) return
        if (State.exactAlarmAsked(this)) return
        val am = getSystemService(AlarmManager::class.java) ?: return
        if (am.canScheduleExactAlarms()) return

        State.markExactAlarmAsked(this)
        runCatching {
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:$packageName")
                )
            )
        }.onFailure { Log.w(TAG, "request exact alarm page failed", it) }
    }

    /** 供 Bridge 调用：切换 WebView 的屏幕常亮。 */
    fun applyKeepScreenOn(on: Boolean) {
        runOnUiThread {
            if (::host.isInitialized && host.isAttached) {
                host.webView.keepScreenOn = on
            }
        }
    }

    companion object {
        private const val TAG = "BottleMain"

        private const val REQ_NOTIFICATION = 9001

        /** 返回键等网页回答的最长时间；超时按"网页没处理"继续降级。 */
        private const val BACK_TIMEOUT_MS = 600L

        /** 同一页第二次退出按下的时间窗。 */
        private const val EXIT_WINDOW_MS = 2_000L

        private const val K_TIMER_STARTED = "timer.started"
        private const val K_NOTIF_ASKED = "notif.asked"

        private const val CHROME_COLOR = 0xFF141A30.toInt()
        private const val PAGE_BG = 0xFFFBF6EF.toInt()

        /**
         * 阶梯全在网页里执行，这里只关心两个返回值。
         * `window.__bottleBack` 不存在时（shim 注入失败）一律当 exit —— 不把用户困死。
         */
        private const val BACK_JS =
            "(function(){try{return (window.__bottleBack?window.__bottleBack():'exit');}" +
                "catch(e){return 'exit';}})()"
    }
}
