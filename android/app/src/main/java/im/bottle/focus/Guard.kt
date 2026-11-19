package im.bottle.focus

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityManager

/**
 * 应用锁的 **Android 适配层**：prefs 读写、launcher / IME 动态白名单、无障碍开启双路检测、
 * `guard.active` 镜像、残留修复。
 *
 * 判定本身全在 [GuardRules]（纯函数、可离线跑表）；本文件不写任何"策略"，
 * 只负责把系统里的事实取回来喂给它、把结论落进 prefs。这样"白名单漏了谁"这类 bug
 * 可以在 JVM 上跑表复现，不用真机。
 *
 * 三条硬约束：
 * 1. **不读窗口内容**：只要 `event.packageName` 这一个信息（`canRetrieveWindowContent=false`）；
 * 2. **不加 `FOREGROUND_SERVICE`**：无障碍服务被系统杀了会**自动重绑**，比前台服务更可靠（设计 A5）；
 * 3. 不能程序自开无障碍（没有 API）：只能检测 + 引导 + 每场提示一次（[shouldPromptRevoked]）。
 */
object Guard {

    private const val TAG = "BottleGuard"

    /** launcher / IME 白名单缓存时长：避免每个 accessibility 事件都 `queryIntentActivities`。 */
    private const val WHITELIST_TTL_MS = 60_000L

    private var cachedAt = 0L
    private var cachedLaunchers: Set<String> = emptySet()
    private var cachedImes: Set<String> = emptySet()

    // ------------------------------------------------------------------ 白名单

    /**
     * 动态白名单（launcher + IME），缓存 60s。
     *
     * launcher 各家包名不同（`com.miui.home` / `com.huawei.android.launcher` /
     * `com.google.android.apps.nexuslauncher`），**硬编码必翻车**（设计 A3）。
     * IME 同理：键盘弹起时前台包名就是输入法，拦了等于"打字即被打回"。
     *
     * @return first = launcher 包名集合，second = 输入法包名集合
     */
    fun whitelist(ctx: Context): Pair<Set<String>, Set<String>> {
        val now = System.currentTimeMillis()
        if (now - cachedAt < WHITELIST_TTL_MS && cachedAt > 0L) {
            return cachedLaunchers to cachedImes
        }
        cachedLaunchers = queryLaunchers(ctx)
        cachedImes = queryImes(ctx)
        cachedAt = now
        return cachedLaunchers to cachedImes
    }

    /** 强制下一次 [whitelist] 重新查（装 / 卸 / 换 launcher 后由设置页触发）。 */
    fun invalidateWhitelist() {
        cachedAt = 0L
    }

    private fun queryLaunchers(ctx: Context): Set<String> {
        val pm = ctx.packageManager ?: return emptySet()
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return try {
            val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION")
                pm.queryIntentActivities(intent, 0)
            }
            resolved.mapNotNull { it.activityInfo?.packageName }.toSet()
        } catch (e: Exception) {
            Log.w(TAG, "queryIntentActivities(launcher) failed", e)
            emptySet()
        }
    }

    private fun queryImes(ctx: Context): Set<String> {
        return try {
            val imm = ctx.getSystemService(android.view.inputmethod.InputMethodManager::class.java)
                ?: return emptySet()
            imm.enabledInputMethodList.mapNotNull { it.packageName }.toSet()
        } catch (e: Exception) {
            Log.w(TAG, "getEnabledInputMethodList failed", e)
            emptySet()
        }
    }

    // ---------------------------------------------------------------- 拦截判定

    /** 该不该拦这个包（策略全在 [GuardRules.shouldBlock]）。 */
    fun shouldBlock(ctx: Context, pkg: String): Boolean {
        val (launchers, imes) = whitelist(ctx)
        val decision = GuardRules.shouldBlock(
            GuardRules.Input(
                enabled = State.guardEnabled(ctx),
                active = State.guardActive(ctx),
                lockTask = LockGuard.isLockedTask(ctx),
                mode = currentMode(ctx),
                pkg = pkg,
                selfPkg = ctx.packageName,
                apps = State.guardApps(ctx),
                launchers = launchers,
                imes = imes,
                sessionKey = State.sessionKey(ctx),
                unlockedKey = State.unlockedSession(ctx)
            )
        )
        if (decision) Log.i(TAG, "block $pkg (mode=${currentMode(ctx)})")
        return decision
    }

    /** 当前这一场的 mode：优先粘性键（跨进程稳定），没有就退回落盘会话。 */
    fun currentMode(ctx: Context): String {
        val sticky = State.stickySession(ctx).mode
        if (sticky.isNotEmpty()) return sticky
        return State.loadSession(ctx)?.mode ?: ""
    }

    /**
     * 把"这一帧该不该拦"镜像进 prefs（设计 A4c：**唯一写者是 [TimerWatch.onReport]**）。
     *
     * 为什么不放在 Activity 里：GuardService 由 system_server 绑定，生命周期与 Activity 无关；
     * prefs 是唯一跨组件真源，也天然继承"网页是唯一真源"这条铁律。
     */
    fun syncActive(ctx: Context, active: Boolean, endAtWall: Long, sessionKey: String) {
        val prevActive = State.guardActive(ctx)
        val prevEndAt = State.guardActiveEndAt(ctx)
        val prevKey = State.guardActiveKey(ctx)
        // 状态真的变了才写 prefs（每帧都写是白耗 IO，也容易把闪存写坏）
        if (prevActive == active && prevEndAt == (if (active) endAtWall else 0L) &&
            (!active || prevKey == sessionKey)
        ) {
            return
        }
        State.setGuardActiveFrame(ctx, active, endAtWall, sessionKey)
        if (prevActive != active) {
            Log.i(TAG, "guard.active $prevActive -> $active (key=$sessionKey endAt=$endAtWall)")
        }
    }

    /**
     * 清掉"被进程重启留下的正计时场次"的拦截镜像（P1-2，0.2.3）。
     *
     * **只允许在 `App.onCreate` 里调**（且必须排在 [repairResidue] 之前）：
     * `Application.onCreate` 是"新进程刚起"的确定性信号 —— 此刻 WebView 还没创建，
     * 一场正计时若还挂在 prefs 里，它一定已经随上一个进程死了（正计时没有 `endAt`，
     * 唯一的活口判据是 `savedAt + 8h`，而"进程被杀"这件事没有任何记录）。
     *
     * ★ **只清 `guard.active`，不清 session / 粘性键**：
     * - 用户随后打开 App → 网页从快照恢复正计时并重新上报，`syncActive(true)` 会重写镜像
     *   （最多 1 秒空窗，而用户此刻就停在网页上，本来也不需要拦自己）；
     * - 用户不打开 App → 这场正计时已经死了，session 残留 ≤ 8h 无害（它只是数据，
     *   不再驱动拦截）；**已经超 8h 的那一场本函数直接放过**，由 [repairResidue]
     *   的过期分支连 session + 粘性键一起清（保住 0.2.2 的保证，见
     *   [GuardRules.countingOrphanNeedsClear] 的边界说明）；
     * - 粘性键清了就等于换场，四张"本场不再打扰"记账全部落空。
     *
     * 不要在 `MainActivity.onResume` 调它：那里每次回前台都会命中，
     * 会把"用户主动切出去 → 立刻切到微信"的那一帧也一并放开（那是真的在专注）。
     */
    fun clearOrphanCountingActive(ctx: Context) {
        val active = State.guardActive(ctx)
        val session = State.loadSession(ctx)
        val counting = session?.isCounting ?: false
        val savedAt = session?.savedAt ?: 0L
        val now = System.currentTimeMillis()
        if (!GuardRules.countingOrphanNeedsClear(active, counting, savedAt, now)) return
        Log.i(TAG, "clear active: counting session orphaned by process restart")
        clearActive(ctx)
    }

    /** 立刻关闭拦截镜像（会话结束 / 残留修复）。 */
    fun clearActive(ctx: Context) {
        if (!State.guardActive(ctx)) return
        State.setGuardActive(ctx, false)
        State.setGuardActiveEndAt(ctx, 0L)
        Log.i(TAG, "guard.active cleared")
    }

    // ------------------------------------------------------------ 无障碍开启状态

    /**
     * 无障碍服务是否开启（**双路交叉**，设计 A5）。
     *
     * ① `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`：最实时，但不保证所有 ROM 都写；
     * ② `AccessibilityManager.getEnabledAccessibilityServiceList()`：有缓存 / 延迟，但更权威。
     *
     * 任一命中即认为开启 —— **宁松不误报**：误报"没开"会让用户每场都被带去设置页。
     */
    fun serviceEnabled(ctx: Context): Boolean = secureSaysEnabled(ctx) || managerSaysEnabled(ctx)

    private fun componentForms(ctx: Context): List<String> {
        val cn = ComponentName(ctx, GuardService::class.java)
        return listOf(cn.flattenToString(), cn.flattenToShortString())
    }

    private fun secureSaysEnabled(ctx: Context): Boolean = try {
        val raw = Settings.Secure.getString(
            ctx.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: ""
        val forms = componentForms(ctx).map { it.lowercase() }
        raw.split(':')
            .map { it.trim().lowercase() }
            .any { it.isNotEmpty() && it in forms }
    } catch (e: Exception) {
        Log.w(TAG, "read ENABLED_ACCESSIBILITY_SERVICES failed", e)
        false
    }

    private fun managerSaysEnabled(ctx: Context): Boolean = try {
        val am = ctx.getSystemService(AccessibilityManager::class.java)
        val selfName = GuardService::class.java.name
        val list = am?.getEnabledAccessibilityServiceList(
            AccessibilityServiceInfo.FEEDBACK_ALL_MASK
        ) ?: emptyList()
        list.any {
            val si = it.resolveInfo?.serviceInfo ?: return@any false
            si.packageName == ctx.packageName && si.name == selfName
        }
    } catch (e: Exception) {
        Log.w(TAG, "getEnabledAccessibilityServiceList failed", e)
        false
    }

    /** 服务连上了（`onServiceConnected`）：只记日志 —— 守卫不主动开打，等网页下一帧写 active。 */
    fun noteServiceConnected(ctx: Context) {
        val n = State.guardApps(ctx).size
        Log.i(TAG, "service connected (guard.enabled=${State.guardEnabled(ctx)} apps=$n)")
        invalidateWhitelist()
    }

    /**
     * 服务被系统解绑（ROM 省电清理 / 用户手动关掉）。
     *
     * 这里**只记一笔**：不能程序自开（无 API），也不能在前台弹框（Service 上下文）。
     * 真正的提示由 `MainActivity.resumeHostGates` 在回前台时按会话键去重弹一次（设计 A5 ③）。
     */
    fun noteServiceUnbound(ctx: Context) {
        Log.w(TAG, "service unbound: 应用锁暂停生效，回 App 时会提示重新开启")
    }

    // ------------------------------------------------------------------ 残留修复

    /**
     * 修复 `guard.active` 残留（防"没计时也拦"，设计 §6 第 11 条）。
     *
     * 必须在 `App.onCreate` 和 `MainActivity.onResume` **都**跑一次：
     * - 进程被系统杀掉 / 闹钟迟到 / 网页崩了 → 镜像可能停在 true，而 prefs 里早已没有活着的场次；
     * - 这时若不修，用户一整天每次切 App 都被打回，且他不知道为什么。
     *
     * 两条判据（P1-1③ 补了第二条）：
     * ① 没有落盘会话（`session == null`）→ 清镜像；
     * ② 会话存在但**已过期**（倒计时 `endAt` 已过 / 正计时 `savedAt + 8h` 已过）→ 连记账一起清。
     *    过期的那一场不可能再被网页结算（进程被杀 / 网页已死），留着就是永久拦。
     */
    fun repairResidue(ctx: Context) {
        val now = System.currentTimeMillis()
        val session = State.loadSession(ctx)
        val active = State.guardActive(ctx)
        // 会话"活着"= 有记录且没过期（判据在 GuardRules.sessionActive，唯一真源）
        val live = session != null && session.active(now)

        if (GuardRules.residueNeedsRepair(active, live)) {
            val dead = session
            val expired = dead != null && GuardRules.residueExpired(
                active = true,
                hasSession = true,
                savedAt = dead.savedAt,
                endAtWall = dead.endAt,
                counting = dead.isCounting,
                nowWall = now
            )
            if (expired && dead != null) {
                // 过期这一场已经结束：记录与粘性键一起清，否则下一场会沿用上一场的键。
                Log.w(TAG, "residue: guard.active=true but session expired " +
                    "(endAt=${dead.endAt} savedAt=${dead.savedAt} counting=${dead.isCounting} now=$now), reset")
                State.clearSession(ctx)
                State.clearStickySession(ctx)
            } else {
                Log.w(TAG, "residue: guard.active=true but no live session (now=$now), reset")
            }
            clearActive(ctx)
        }
        if (GuardRules.overlayExpired(State.guardOverlayUntil(ctx), now)) {
            // 到期时刻已过去：记账清零；同进程内若真有窗口挂着，一并撤掉（跨进程时窗口已随进程消失）。
            State.setGuardOverlayUntil(ctx, 0L)
            GuardOverlay.dismiss("expired")
        }
    }

    /**
     * `guard.active` 的时间复核（P1-1②）。**由 [GuardService.onAccessibilityEvent] 每 30s 至多调一次。**
     *
     * 为什么需要它（这是三条改法里最有效的一条）：
     * - 正计时没有闹钟，`AlarmReceiver` 不会响，`TimerWatch.disarm` 也就不会被调；
     * - 网页进程被杀后不会再有任何 `timer.report`，`syncActive(false)` 永远等不到；
     * - 而 `repairResidue` 只在**进程创建 / onResume** 跑，无障碍服务把进程一直绑着 → 再也不复检。
     * 于是 `guard.active=true` 会永远留着，用户打开微信就被反复打回（只能卸载 App）。
     *
     * 顺带收益：倒计时到点后，即使用户正在别的 App 里、网页没来得及上报 `running=false`，
     * 这里也会停止拦截（旧行为必须等网页上报才停，最长要等下一次回前台）。
     *
     * 只碰 prefs，不碰 WebView / 服务实例 —— 它可能在任何进程 / 任何线程被调。
     */
    fun recheckExpired(ctx: Context) {
        val now = System.currentTimeMillis()
        val session = State.loadSession(ctx)
        val savedAt = session?.savedAt ?: 0L
        val endAt = session?.endAt ?: 0L
        val counting = session?.isCounting ?: false
        val active = State.guardActive(ctx)

        // savedAt <= 0 → 会话还没落盘（启动那一帧）：**不清**，交给下一次复核。
        if (!GuardRules.recheckNeedsClear(active, savedAt, endAt, counting, now)) return

        Log.w(
            TAG,
            "recheck: session expired (endAt=$endAt savedAt=$savedAt counting=$counting now=$now), " +
                "drop session + sticky key + guard.active"
        )
        State.clearSession(ctx)
        State.clearStickySession(ctx)
        clearActive(ctx)
    }
}
