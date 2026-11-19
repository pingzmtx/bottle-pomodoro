package im.bottle.focus

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.AlertDialog
import android.content.ActivityNotFoundException
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
import android.view.KeyEvent
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

    /** 锁机出口：长按 1.5s 或 2s 内连按 3 次 → 原生确认框。 */
    private var lockHoldArmed = false
    private var lockTaps = 0
    private var lastLockTapAt = 0L
    private val lockHoldRunnable = Runnable {
        lockHoldArmed = false
        if (LockGuard.isLockedTask(this)) {
            Log.i(TAG, "lock exit: back held ${LOCK_EXIT_HOLD_MS}ms")
            LockGuard.showExitConfirm(this)
        }
    }

    /** 上一帧"计时是否在跑"，用于识别"这一场刚开始"。 */
    private var lastTimerActive = false

    /** 上一帧的会话键：键变了就说明是**新的一场**（暂停继续不会变，见 [SessionKey]）。 */
    private var lastSessionKey = ""

    /**
     * 授权"门"队列。
     *
     * 为什么要队列：悬浮窗授权页、屏幕固定设置页、精确闹钟页**都是系统页**，
     * 同一帧连跳两个时后一个会把前一个覆盖掉（`startActivity` 谁后谁在上），
     * 而被覆盖的那一个的"本场已问过"标记已经置位 → 小窗永久不出现（P1-3）。
     *
     * 一帧最多一个系统页：所有跳页收在 [jumpGate] 一个入口，跳完 `gateBusy = true` 锁住；
     * 用户在 `onResume` 回来（或 2.5s 超时看门狗）再放开，继续 take 下一个。
     */
    private val gateQueue = ArrayDeque<Gate>()
    private var gateBusy = false

    /**
     * "门"令牌。每次置位 busy / 放开 busy 都会 +1，超时定时器带着自己那一格令牌回来，
     * 只有令牌还对得上才允许清 busy。
     *
     * 防的是什么：ROM 忽略 `startActivity` / 系统页立刻 finish 时，`onResume` 不一定来，
     * busy 会永真 → 之后所有引导被吞。看门狗能救回来，但**旧定时器不能误清新门**：
     * 门 A 跳出去后 2.5s 的定时器如果照常执行，会把门 B 的 busy 清掉，
     * 于是门 B 还在系统页上、队列又放开 → 同帧再跳门 C，两张系统页又叠在一起（P1-3 复发）。
     */
    private var gateToken = 0

    /**
     * 首次「专注时是否开启锁机？」对话框是否正在显示（防重复弹）。
     * 它显示期间 [pumpGates] 必须停住：不要在询问框上面再叠一张系统页（P2）。
     */
    private var lockIntroDialogShowing = false

    /** 是否在前台。后台时只更新小窗，不去 startActivity / startLockTask（Android 10+ 会拒绝）。 */
    private var resumed = false

    /**
     * 「应用锁失效」提示框是否正在显示。
     *
     * 与 [lockIntroDialogShowing] 同理：对话框显示期间 [pumpGates] 必须停住，
     * 否则会在我们的询问框上面再叠一张系统页 —— 用户看到的是"点了个框，屏幕上突然
     * 出现了系统的无障碍设置页"，还以为 App 疯了。
     */
    private var guardDialogShowing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 从静态快捷方式 / 通知 action 进来：直接开原生设置页，**不占门**（设计 T04）。
        // 不占门的理由：它不是"引导"而是用户的明确请求，没有并发跳页的问题。
        handleHostIntent(intent)

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
        LockGuard.attach(this)
        host.loadApp()
    }

    /**
     * `singleTask` 的 Activity 被再次拉起（长按快捷方式 / 通知 action）走这里。
     *
     * 必须 `setIntent`：否则后续 `getIntent()` 拿到的还是最初那一次。
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleHostIntent(intent)
    }

    /**
     * 处理"外部请求我打开原生页"的 Intent（静态快捷方式 / 通知 action）。
     *
     * @return true = 认领了这个 Intent
     */
    private fun handleHostIntent(intent: Intent?): Boolean {
        if (intent?.action != ACTION_APP_SETTINGS) return false
        // 清掉 action：Activity 重建（旋转 / 深色切换）时会重新走 onCreate，
        // 不清就会每次重建都再开一遍设置页 —— 用户按返回后又被弹回去。
        intent.action = null
        openAppSettings()
        return true
    }

    /** 打开原生设置页。网页（`app.settings` 桥命令）与快捷方式共用这一个入口。 */
    fun openAppSettings() {
        runCatching { startActivity(Intent(this, AppSettingsActivity::class.java)) }
            .onFailure { Log.w(TAG, "open AppSettingsActivity failed", it) }
    }

    override fun onResume() {
        super.onResume()
        resumed = true

        // ★ 先修残留（设计 §6 第 11 条）：`guard.active` 若在异常路径漏置 false，
        //   用户一整天每次切 App 都被打回，且完全不知道为什么。App.onCreate 也跑一次。
        Guard.repairResidue(this)

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

        // 从系统授权页 / 屏幕固定设置页回来：先放开"门"（上一次那张已经回来了），
        // 再复查并**立刻**生效，最后把该排的门排上、一个一个放。
        releaseGate()
        // 精确闹钟授权引导：只在"用户真的开始计时过"之后问，且只问一次。
        // 它也排进门队列（不再在这里直接 startActivity）：它同样是一张系统页，
        // 和悬浮窗 / 屏幕固定页抢栈时是同一类问题（P1-3），只是以前漏在队列外面。
        maybeRequestExactAlarm()
        resumeHostGates()
    }

    override fun onPause() {
        resumed = false
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
        // 兜底解锁：onDestroy 不解锁会把用户留在一个空白页里（屏幕固定只钉这一个任务）。
        LockGuard.stop(this)
        LockGuard.detach(this)
        if (::files.isInitialized) files.release()
        host.destroy()
        super.onDestroy()
    }

    /**
     * 回前台复查所有"特殊权限"型授权（悬浮窗 / 屏幕固定）。
     *
     * 这一整套之所以存在，是因为它们都**不是**运行时权限：
     * `requestPermissions` 对它们永远返回 denied，只能跳系统页 + 回来复查。
     *
     * 本方法只"排门"，不直接跳页：所有系统页统一由 [pumpGates] 一次一个地放出去。
     */
    private fun resumeHostGates() {
        val now = System.currentTimeMillis()
        val session = State.loadSession(this)
        // 只认"还活着"的那一场（倒计时已过 / 超过 8h 的正计时都不算）
        val live = if (session != null && session.active(now)) session else null

        // ① 通知 action「小窗」在没权限时记下的待办：回来就把用户送到授权页 / 直接把小窗显示出来。
        //    这里**只排门**，不直跳（旧代码在这里 startActivity，紧接着 pumpGates 又跳一个，
        //    同一帧两张系统页 —— P1-C 的旁路之一）。
        if (State.overlayPending(this)) {
            State.setOverlayPending(this, false)
            if (FloatingBubble.canDraw(this)) {
                live?.let { FloatingBubble.restore(this, it) }
            } else {
                enqueueGate(Gate.OVERLAY_USER)
            }
        }

        // ② 正在计时：小窗该在就在；权限没给就排一个授权门（每场一次）
        if (live != null) {
            if (FloatingBubble.canDraw(this)) {
                FloatingBubble.restore(this, live)
            } else {
                enqueueGate(Gate.OVERLAY)
            }
        }

        // ③ 锁机：LockGuard 只回答"我要跳哪个门"（它自己不再 startActivity），
        //    真正跳页由 [jumpGate] 统一做。
        val mode = live?.mode
        if (LockGuard.onResume(this, mode) == LockGuard.Wants.PINNING_SETTINGS) {
            enqueueGate(Gate.PINNING)
        }

        // ④ 应用锁失效复查（设计 A5 ③）：无障碍被 ROM 静默关掉 / 用户手动关掉时，
        //    应用锁等于没开，而用户完全看不出来。每场只提示一次（guard.revokedKey 去重）。
        if (live != null) notifyGuardRevoked()

        if (live != null) {
            enqueueStartGates(mode ?: "")
        }
        pumpGates()
    }

    /**
     * 「应用锁没在生效」提示（每场一次）。
     *
     * 为什么用原生对话框而不是 toast：这是一个"你以为有保护、其实没有"的状态，
     * 需要用户做一个决定（去开启 / 本场算了），toast 一闪而过等于没说。
     */
    private fun notifyGuardRevoked() {
        if (!State.guardEnabled(this)) return
        if (Guard.serviceEnabled(this)) return
        val key = State.sessionKey(this)
        val should = GuardRules.shouldPromptRevoked(
            revokedKey = State.guardRevokedKey(this),
            sessionKey = key,
            serviceOn = false,
            guardEnabled = true
        )
        if (!should) return
        if (guardDialogShowing || isFinishing) return

        // 先记账再弹：弹失败（Window token 失效）也不会下一帧又来一遍
        State.markGuardRevoked(this, key)
        guardDialogShowing = true
        try {
            AlertDialog.Builder(this)
                .setTitle("应用锁没有在生效")
                .setMessage(
                    "系统的无障碍服务被关掉了（国产 ROM 在重启或省电清理后经常这样），" +
                        "现在应用锁拦不住任何东西。\n\n重新开启后，本场专注会立刻恢复拦截。"
                )
                .setPositiveButton("去开启") { dialog, _ ->
                    dialog.dismiss()
                    enqueueGate(Gate.ACCESSIBILITY)
                    pumpGates()
                }
                .setNegativeButton("本场先不拦") { dialog, _ -> dialog.dismiss() }
                .setOnDismissListener {
                    guardDialogShowing = false
                    pumpGates()
                }
                .show()
            Log.i(TAG, "guard revoked prompt shown for session $key")
        } catch (e: Exception) {
            guardDialogShowing = false
            Log.w(TAG, "show guard revoked dialog failed", e)
        }
    }

    /**
     * 按这一场的 mode 排引导门。
     *
     * 顺序有意义：① 首次要不要锁（原生对话框，不跳页）→ ② 悬浮窗授权页
     * → ③ 屏幕固定设置页。悬浮窗必须排在屏幕固定**之前**：
     * 一旦 startLockTask() 生效，任务被钉住，再去拉别的系统页会被系统拒掉。
     *
     * 休息段（`shortBreak` / `longBreak`）**不排锁机相关的门**：休息不锁机（P2-6），
     * 也就没必要问"专注时是否开启锁机"。
     */
    private fun enqueueStartGates(mode: String) {
        val lockable = LockGuard.isLockableMode(mode)
        if (lockable && !State.lockIntroAsked(this)) enqueueGate(Gate.LOCK_INTRO)
        if (!FloatingBubble.canDraw(this)) enqueueGate(Gate.OVERLAY)
        // 无障碍必须排在屏幕固定**之前**：一旦 startLockTask() 生效，任务被钉住，
        // 再拉系统页会被拒掉，用户就永远开不了应用锁（设计 T04 的顺序）。
        enqueueAccessibilityGateIfNeeded()
        if (lockable) enqueueGate(Gate.PINNING)
    }

    /**
     * 排「无障碍授权页」的门（应用锁开着但服务没开时才排）。
     *
     * 每场只排一次：`guard.revokedKey` 记的是"这一场已经提示/跳过了"。
     * 不去重的话，一场专注里每次 `timer.report` 的首帧判断都可能把它重新塞回队列。
     */
    private fun enqueueAccessibilityGateIfNeeded() {
        if (!State.guardEnabled(this)) return
        if (Guard.serviceEnabled(this)) return
        val key = State.sessionKey(this)
        if (key.isEmpty()) return // 还没有会话身份就不记账（空串会和空串相等）
        if (State.guardRevokedKey(this) == key) return
        enqueueGate(Gate.ACCESSIBILITY)
    }

    /**
     * 放门：一次只 take 一个，跳出去就锁住，等 `onResume`（或看门狗超时）再来。
     *
     * 循环继续的条件是"这个门当场就不需要了"（比如权限已经给了 / 本场已经问过），
     * 那是**纯计算**、不会跳页，所以不会出现一帧两个系统页。
     */
    private fun pumpGates() {
        if (!resumed || gateBusy) return
        // 询问框（原生 AlertDialog）正在屏幕上：停住，不要在它上面再叠一张系统页（P2）
        if (lockIntroDialogShowing) return
        if (guardDialogShowing) return
        while (true) {
            val gate = gateQueue.removeFirstOrNull() ?: return
            if (jumpGate(gate)) return
        }
    }

    private fun enqueueGate(gate: Gate) {
        if (!gateQueue.contains(gate)) gateQueue.addLast(gate)
    }

    /**
     * **所有**系统页跳转的唯一入口（P1-C）。
     *
     * 置 busy → 执行 → post 一个 2.5s 的看门狗：万一 `startActivity` 被 ROM 吞掉、
     * 或者页面立刻 finish 而没有回调 `onResume`，busy 也会自己放开，
     * 不至于之后所有引导被永久吞掉（只能切后台自愈）。
     *
     * @return true = 真的跳了页 / 弹了框（队列保持 busy）
     */
    private fun jumpGate(gate: Gate): Boolean {
        if (!resumed || isFinishing) return false
        beginGate()
        val jumped = try {
            launchGate(gate)
        } catch (e: Exception) {
            Log.w(TAG, "gate $gate failed", e)
            false
        }
        if (!jumped) endGate()
        return jumped
    }

    /** 置 busy + 起一个新令牌的看门狗（旧令牌的定时器从此无效）。 */
    private fun beginGate() {
        gateBusy = true
        gateToken++
        mainHandler.postDelayed(GateTimeout(gateToken), GATE_TIMEOUT_MS)
    }

    /** 放开队列，并作废所有在飞的看门狗（令牌 +1）。 */
    private fun endGate() {
        gateToken++
        gateBusy = false
    }

    /** `onResume` 用：用户回来了，上一次那张系统页已经不在栈上。 */
    private fun releaseGate() {
        endGate()
    }

    /**
     * 看门狗：只在自己那一格令牌还是最新的时才清 busy。
     *
     * 举例：门 A 在 t=0 跳出去（令牌 5，定时器 5）。用户在 1s 后回来，
     * `releaseGate` 把令牌推到 6；随后门 B 跳出去，令牌 7。t=2.5s 时 A 的定时器醒了，
     * 带着令牌 5 ≠ 7 → 直接返回，**不会**把 B 的 busy 清掉。
     */
    private inner class GateTimeout(private val token: Int) : Runnable {
        override fun run() {
            if (token != gateToken) return
            Log.w(TAG, "gate watchdog fired (no resume in ${GATE_TIMEOUT_MS}ms), release")
            gateBusy = false
            pumpGates()
        }
    }

    /** @return true = 真的跳了页 / 弹了框（调用方要锁住队列） */
    private fun launchGate(gate: Gate): Boolean = when (gate) {
        Gate.EXACT_ALARM -> requestExactAlarmPage()
        Gate.LOCK_INTRO -> launchLockIntroGate()
        Gate.OVERLAY -> launchOverlayGate()
        Gate.OVERLAY_USER -> openOverlaySettings()
        Gate.ACCESSIBILITY -> launchAccessibilityGate()
        Gate.PINNING -> launchPinningGate()
    }

    private fun launchPinningGate(): Boolean {
        val session = activeSession() ?: return false
        return when (LockGuard.onTimerActive(this, session.mode)) {
            // 直接上锁成功：不占门（没有系统页）
            LockGuard.Wants.LOCKED, LockGuard.Wants.NONE -> false
            // 需要设置页：这是本类唯一的跳页实现，LockGuard 不再自己 startActivity
            LockGuard.Wants.PINNING_SETTINGS -> openPinningSettings()
        }
    }

    /**
     * 通知栏点了「锁机」、但屏幕固定没开：由 LockGuard 回调过来排门。
     *
     * 用户此刻可能不在前台 —— 门会一直排着，回前台由 `onResume` 的 `pumpGates` 放出去。
     */
    fun requestPinningGate() {
        enqueueGate(Gate.PINNING)
        pumpGates()
    }

    private fun activeSession(): SessionRecord? {
        val s = State.loadSession(this) ?: return null
        return if (s.active(System.currentTimeMillis())) s else null
    }

    // ------------------------------------------------------- 门 ① 锁机开关询问

    /**
     * 首次进入计时时问一次「专注时是否开启锁机？」。
     *
     * 为什么必须问：锁机会把用户钉在前台（尽管有返回键长按 / 连按的出口），
     * 这属于"要用户点头"的能力 —— 默认静默上锁是不可接受的（P1-2）。
     * 只问一次（`lock.introAsked` 落盘，跨进程有效）。
     */
    private fun launchLockIntroGate(): Boolean {
        if (State.lockIntroAsked(this)) return false
        if (activeSession() == null) return false
        if (lockIntroDialogShowing || isFinishing) return false
        return showLockIntroDialog()
    }

    private fun showLockIntroDialog(): Boolean {
        lockIntroDialogShowing = true
        return try {
            AlertDialog.Builder(this)
                .setTitle("专注时开启锁机？")
                .setMessage(
                    "开启后，专注期间会用系统「屏幕固定」把瓶子钉在前台，减少中途切走。\n" +
                        "随时可以在通知栏的「锁机」按钮一键切换；返回键长按 1.5 秒也能解开。"
                )
                .setPositiveButton("开启") { dialog, _ ->
                    // 先落状态、再 dismiss：dismiss 会触发 onDismiss → 立刻 pumpGates，
                    // 那个时刻队列看到的必须是"已经开启"的锁机开关，否则顺序会倒过来。
                    State.markLockIntroAsked(this)
                    // 开启路径要顺：不二次确认，直接去屏幕固定设置页，回来就锁（P1-2）
                    LockGuard.setEnabled(this, true)
                    enqueueGate(Gate.PINNING)
                    dialog.dismiss()
                }
                .setNegativeButton("不用") { dialog, _ ->
                    State.markLockIntroAsked(this)
                    LockGuard.setEnabled(this, false)
                    dialog.dismiss()
                }
                .setOnDismissListener {
                    // 三个出口（开启 / 不用 / 返回键取消）都要走到这里。
                    // P2-1：返回键取消以前只关框不记账，于是每次进入计时又弹一次。
                    // 记账放在这里（而不是只在两个按钮里）才覆盖"按返回键"这条出口。
                    State.markLockIntroAsked(this)
                    lockIntroDialogShowing = false
                    endGate()
                    pumpGates()
                }
                .show()
            true
        } catch (e: Exception) {
            lockIntroDialogShowing = false
            // 弹不出来也不能每场重试：记成"问过"，默认保持关闭（安全侧）。
            State.markLockIntroAsked(this)
            Log.w(TAG, "show lock intro dialog failed", e)
            false
        }
    }

    // ------------------------------------------------------- 门 ② 悬浮窗授权

    /**
     * 悬浮窗授权引导（每场计时最多一次）。
     *
     * 不用 `requestPermissions`：`SYSTEM_ALERT_WINDOW` 是特殊权限，那样只会立刻拿到 denied。
     *
     * @return true = 跳了系统页
     */
    private fun launchOverlayGate(): Boolean {
        if (FloatingBubble.canDraw(this)) return false
        if (activeSession() == null) return false
        val key = State.sessionKey(this)
        if (key.isEmpty()) return false // 没有会话身份就不记账（空串会和空串相等）
        if (State.askedOverlaySession(this) == key) return false
        // P2-3：标记写在跳页**之后**。旧代码先写再跳，跳失败（ROM 没有这一页 /
        // 系统拒绝了后台启动）也把本场的标记烧掉，于是这一场的小窗再也不会被引导。
        val jumped = openOverlaySettings()
        if (jumped) State.markAskedOverlaySession(this, key)
        return jumped
    }

    /** @return true = 跳了系统页 */
    private fun openOverlaySettings(): Boolean {
        if (FloatingBubble.canDraw(this)) return false
        return try {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
            Log.i(TAG, "opened overlay permission page")
            true
        } catch (e: ActivityNotFoundException) {
            // 个别 ROM 没有这个页面：只记录，不崩，也不静默假装成功
            Log.w(TAG, "no overlay permission page on this ROM", e)
            false
        } catch (e: Exception) {
            Log.w(TAG, "open overlay settings failed", e)
            false
        }
    }

    // ------------------------------------------------ 门 ④ 应用锁（无障碍）授权页

    /**
     * 应用锁授权引导（**每场最多一次**）。
     *
     * 无障碍**不能程序自开**（没有 API），所以只能跳系统页 + 回来复查。
     * 记账写在跳页**之后**：ROM 没有这一页时（`ActivityNotFoundException`）不烧掉本场的标记
     * —— 这是 P2-3 的同一条原则，小窗/锁机都按这条改过。
     *
     * @return true = 跳了系统页
     */
    private fun launchAccessibilityGate(): Boolean {
        if (!State.guardEnabled(this)) return false
        if (Guard.serviceEnabled(this)) return false
        if (activeSession() == null) return false
        val key = State.sessionKey(this)
        if (key.isNotEmpty() && State.guardRevokedKey(this) == key) return false
        val jumped = openAccessibilitySettings()
        if (!jumped) return false
        if (key.isNotEmpty()) State.markGuardRevoked(this, key)
        val ask = State.bumpGuardAskCount(this)
        Log.i(TAG, "opened accessibility settings (askCount=$ask)")
        return jumped
    }

    /** @return true = 跳了系统页 */
    private fun openAccessibilitySettings(): Boolean {
        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            return true
        } catch (e: ActivityNotFoundException) {
            // 个别 ROM 没有独立入口：退回设置首页，用户仍能自己翻到「无障碍」
            Log.w(TAG, "no accessibility settings page, fallback to settings", e)
        } catch (e: Exception) {
            Log.w(TAG, "open accessibility settings failed", e)
            return false
        }
        return runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
            .onFailure { Log.w(TAG, "open settings failed", it) }
            .isSuccess
    }

    // ----------------------------------------------------- 门 ③ 屏幕固定设置页

    /**
     * 打开「屏幕固定」设置页 —— 全 App 唯一的实现（LockGuard 只提供 Intent）。
     *
     * @return true = 真的跳出了一张系统页（调用方据此锁住"门"队列；
     *         跳失败时返回 false，否则队列会被一个不存在的页面永久卡住）
     */
    private fun openPinningSettings(): Boolean {
        return try {
            startActivity(LockGuard.pinningSettingsIntent())
            // 跳成功才记账：`awaitingPinPage` 让 onResume 只复查/自动锁这一次（避免确认框死循环），
            // `askedPinSession` 让本场不再反复来；跳失败两条都不该烧掉。
            LockGuard.notePinPageOpened(this)
            Log.i(TAG, "opened screen pinning settings")
            true
        } catch (e: ActivityNotFoundException) {
            // 个别 ROM 没有单独这一页：退回安全设置，用户仍能自己找到「屏幕固定」
            Log.w(TAG, "no screen pinning page, fallback to security settings", e)
            val ok = runCatching { startActivity(LockGuard.securitySettingsIntent()) }
                .onFailure { Log.w(TAG, "open security settings failed", it) }
                .isSuccess
            if (ok) LockGuard.notePinPageOpened(this)
            ok
        } catch (e: Exception) {
            Log.w(TAG, "open pinning settings failed", e)
            false
        }
    }

    /**
     * 网页计时状态变化（由 [Bridge] 在 `timer.report` 之后回调）。
     *
     * 只做原生联动，**不写任何网页状态**：
     * - 小窗显示 / 隐藏；
     * - 锁机开始（每场一次）/ 结束（暂停或结束时立刻解锁）。
     */
    fun onTimerState(s: TimerState) {
        val now = System.currentTimeMillis()
        val active = s.running && !s.paused && (s.endAt > now || s.isCounting)

        if (!active) {
            lastTimerActive = false
            lastSessionKey = ""
            // 计时停了：本场的门全部作废，别把"上一次没来得及跳的引导"补到下一次计时里。
            // ⚠️ 清队列必须同时放开 busy 并作废看门狗（P1-C）：旧代码只 clear() 队列，
            //    busy 还是 true，于是下一场开始后所有门都被吞（只能切后台自愈）。
            gateQueue.clear()
            endGate()
            FloatingBubble.hide(this)
            LockGuard.onSessionEnd(this)
            return
        }

        val key: String = State.sessionKey(this)
        val firstFrame = !lastTimerActive || key != lastSessionKey
        lastTimerActive = true
        lastSessionKey = key

        State.loadSession(this)?.let { FloatingBubble.restore(this, it) }
        // 只有在前台才引导：后台 startActivity 会被系统拒绝，反而留下"点了没反应"的日志噪音
        if (!resumed) return
        if (!firstFrame) return

        // 一帧把所有该跳的门**排进队列**（顺序即优先级），由 pumpGates 一个一个放
        enqueueStartGates(s.mode)
        pumpGates()
    }

    // ------------------------------------------------------------------ 锁机出口

    /**
     * 返回键的两段处理。
     *
     * 锁定期间**必须**留一个原生出口，否则用户会被钉在计时页 25 分钟：
     * - 长按 1.5 秒 → 确认框；
     * - 或 2 秒内连按 3 次 → 同一个确认框（按不出长按的人也有路）。
     *
     * 只解锁，不调任何 JS —— 结束/结算仍由用户自己在页面点。
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && LockGuard.isLockedTask(this)) {
            if (event.repeatCount == 0) {
                lockHoldArmed = true
                mainHandler.postDelayed(lockHoldRunnable, LOCK_EXIT_HOLD_MS)
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && LockGuard.isLockedTask(this)) {
            mainHandler.removeCallbacks(lockHoldRunnable)
            if (lockHoldArmed) {
                lockHoldArmed = false
                val now = SystemClock.uptimeMillis()
                lockTaps = if (now - lastLockTapAt <= LOCK_TAP_WINDOW_MS) lockTaps + 1 else 1
                lastLockTapAt = now
                if (lockTaps >= LOCK_TAPS_TO_EXIT) {
                    lockTaps = 0
                    Log.i(TAG, "lock exit: $LOCK_TAPS_TO_EXIT back taps")
                    LockGuard.showExitConfirm(this)
                }
            }
            return true
        }
        return super.onKeyUp(keyCode, event)
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
        // 手势导航不会走 onKeyDown/onKeyUp，只回调这里 —— 锁机出口必须在两条路上都成立。
        if (LockGuard.isLockedTask(this)) {
            val now = SystemClock.uptimeMillis()
            lockTaps = if (now - lastLockTapAt <= LOCK_TAP_WINDOW_MS) lockTaps + 1 else 1
            lastLockTapAt = now
            if (lockTaps >= LOCK_TAPS_TO_EXIT) {
                lockTaps = 0
                LockGuard.showExitConfirm(this)
            } else {
                val left = LOCK_TAPS_TO_EXIT - lockTaps
                Toast.makeText(this, "再按 $left 次返回可解除锁机", Toast.LENGTH_SHORT).show()
            }
            return
        }

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

        // 门队列里有一张系统页正在飞（授权的瞬间就是这个场景）：不要在同一帧再叠一个
        // 系统权限对话框。不写 K_NOTIF_ASKED，下一次 timer.report 会自然重试。
        if (gateBusy) return

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
     *
     * 它也是系统页，所以**只排门**（P1-C）：跳页由 [jumpGate] 统一做。
     * 排在最前面（它是"到点会不会响"的前提，比其他引导更要紧）。
     */
    private fun maybeRequestExactAlarm() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        if (!State.prefs(this).getBoolean(K_TIMER_STARTED, false)) return
        if (State.exactAlarmAsked(this)) return
        val am = getSystemService(AlarmManager::class.java) ?: return
        if (am.canScheduleExactAlarms()) return

        State.markExactAlarmAsked(this)
        if (!gateQueue.contains(Gate.EXACT_ALARM)) gateQueue.addFirst(Gate.EXACT_ALARM)
    }

    /** @return true = 这一帧真的跳了系统页（调用方要把"门"锁住，别同帧再跳第二张） */
    private fun requestExactAlarmPage(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        return try {
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:$packageName")
                )
            )
            true
        } catch (e: Exception) {
            Log.w(TAG, "request exact alarm page failed", e)
            false
        }
    }

    /** 供 Bridge 调用：切换 WebView 的屏幕常亮。 */
    fun applyKeepScreenOn(on: Boolean) {
        runOnUiThread {
            if (::host.isInitialized && host.isAttached) {
                host.webView.keepScreenOn = on
            }
        }
    }

    /**
     * 授权"门"的种类。声明顺序 = 优先级（队列按 enqueue 顺序放）。
     *
     * 悬浮窗（OVERLAY）必须排在屏幕固定（PINNING）之前：
     * `startLockTask()` 生效后任务被钉住，再去拉别的系统页会被系统拒绝。
     * 精确闹钟（EXACT_ALARM）由 [maybeRequestExactAlarm] 插到队首。
     */
    private enum class Gate {
        /** 精确闹钟授权页（`ACTION_REQUEST_SCHEDULE_EXACT_ALARM`）。 */
        EXACT_ALARM,

        /** 首次「专注时是否开启锁机？」原生对话框。 */
        LOCK_INTRO,

        /** 悬浮窗（`SYSTEM_ALERT_WINDOW`）授权页，每场最多一次。 */
        OVERLAY,

        /** 用户主动点通知里的「小窗」但没权限：授权页，不受"每场一次"限制。 */
        OVERLAY_USER,

        /**
         * 应用锁的无障碍授权页（`ACTION_ACCESSIBILITY_SETTINGS`）。
         *
         * 必须排在 [PINNING] **之前**：lockTask 一生效就跳不出去了，用户就永远开不了应用锁。
         */
        ACCESSIBILITY,

        /** 「屏幕固定」设置页 / 直接上锁。 */
        PINNING
    }

    companion object {
        private const val TAG = "BottleMain"
        private const val REQ_NOTIFICATION = 9001

        /**
         * 「打开原生设置页」的请求 action（静态快捷方式 / 通知 action 共用）。
         * 自定义串而不是 `MAIN`：不能让它被当成"再来一次冷启动"。
         */
        const val ACTION_APP_SETTINGS = "im.bottle.focus.action.APP_SETTINGS"

        /**
         * 门看门狗：跳出去 2.5s 还没回来就强行放开队列。
         *
         * 为什么必须有：`startActivity` 可能被 ROM 忽略（后台启动限制 / 页面被裁剪），
         * 或者系统页立刻 finish 而没有回调 `onResume` —— 这两种情况下 `gateBusy` 会永真，
         * 之后所有授权引导都被吞掉，用户只能切后台/重进 App 自愈。
         */
        private const val GATE_TIMEOUT_MS = 2_500L

        /** 返回键等网页回答的最长时间；超时按"网页没处理"继续降级。 */
        private const val BACK_TIMEOUT_MS = 600L

        /** 同一页第二次退出按下的时间窗。 */
        private const val EXIT_WINDOW_MS = 2_000L

        /** 锁机出口：返回键按住多久弹确认框（长按 1.5 秒）。 */
        private const val LOCK_EXIT_HOLD_MS = 1_500L

        /** 或连按 3 次（也允许短按党）。 */
        private const val LOCK_TAPS_TO_EXIT = 3
        private const val LOCK_TAP_WINDOW_MS = 2_000L

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
