package im.bottle.focus

/**
 * 应用锁的**纯判定层**（零 Android 依赖，可离线跑表）。
 *
 * 为什么要单独一个文件（而不是塞进 `Guard.kt`）：设计 §2 要求 `Guard.kt` 的纯逻辑
 * "无 Service 依赖、可离线单测"，但它同时要 `Context` / `PackageManager` / `Settings.Secure`
 * —— 带 `import android.content.Context` 的文件没法只靠 kotlin-stdlib 编译（本工程不加测试依赖，
 * 见 `qa_sessionkey.sh` 的同一取舍）。所以按既有惯例（`ArmRules` / `SessionKey`）把**判定**抽出来：
 *
 * - 本文件：白名单、拦截条件、失效计数、残留修复 —— 全是纯函数；
 * - [Guard]：prefs 读写、launcher / IME 动态查询、无障碍开启双路检测 —— 只做 I/O 适配。
 *
 * 跑表：`app/tools/qa_guard.sh`（线上同一份源码 + `GuardCheck.kt`）。
 */
object GuardRules {

    /** 任务名长度上限（与 shim 侧的 `slice(0, 64)` 对齐，设计 C4）。 */
    const val MAX_TASK_NAME = 64

    /** 会拦截的 mode：番茄专注 + 自由专注（正计时 / 流式）。休息段不拦（设计 A4）。 */
    val GUARD_MODES: Set<String> = setOf("focus", "free")

    /**
     * 不可配置的系统白名单（设计 A3）。
     *
     * 其中三类是**产品事故级**的，不接受用户配置：
     * - 电话 / 短信 / 紧急拨号（拦电话不是专注功能）；
     * - 闹钟（全屏响铃时点"关闭"被打回，用户会以为闹钟坏了）；
     * - 系统 UI / 权限对话框宿主（拦了系统 UI 会卡死，且下拉通知栏就回不去）；
     * - **设置**：拦它只增加痛苦不增加约束力（长按电源重启一样绕过），却让用户无法关无障碍、
     *   开热点、配蓝牙 —— 补偿手段是失效检测 + 遮罩上的「回到专注」（设计 A3 最后一行）。
     *
     * self / launcher / IME 不写在这里：它们是**运行时**取的（见 [Guard.whitelist]）。
     */
    val ALWAYS_ALLOWED: Set<String> = setOf(
        // 系统 UI / 权限弹窗宿主（下拉通知栏、最近任务、授权对话框）
        "com.android.systemui",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        // 电话 / 来电 / 短信 / 紧急拨号
        "com.android.dialer",
        "com.google.android.dialer",
        "com.android.server.telecom",
        "com.android.incallui",
        "com.android.phone",
        "com.android.mms",
        "com.google.android.apps.messaging",
        "com.android.emergency",
        // 闹钟
        "com.android.deskclock",
        "com.google.android.deskclock",
        // 设置：用户要能关无障碍、开热点、配蓝牙
        "com.android.settings"
    )

    /**
     * IME 兜底包名：`InputMethodManager.getEnabledInputMethodList()` 偶尔在服务刚绑定时返回空，
     * 那一刻弹起的键盘会被当成"前台应用"拦下来（等于打字即被打回）。设计 A3 要求这一条兜底。
     */
    const val IME_FALLBACK = "com.android.inputmethod.latin"

    /** 第几次拉起授权页之后，开始追加 Android 13「受限制的设置」引导文案（设计 A6b）。 */
    const val ASK_COUNT_FOR_RESTRICTED = 2

    /**
     * 拦截判定入参。
     *
     * @param enabled   `guard.enabled`（用户总开关）
     * @param active    `guard.active` 镜像（TimerWatch 每帧写，设计 A4c）
     * @param lockTask  深度锁机是否正在生效（生效期间直接不拦，设计 A1b）
     * @param mode      这一场的 mode（`focus` / `free` / `shortBreak` / `longBreak` / `idle`）
     * @param pkg       事件里的前台包名
     * @param selfPkg   本 App 包名（遮罩点击要回得来）
     * @param apps      用户勾选的黑名单
     * @param launchers 动态取到的 launcher 包名集合
     * @param imes      动态取到的输入法包名集合
     * @param sessionKey    当前会话键（与 [unlockedKey] 比对）
     * @param unlockedKey   「本场不再拦」记下的会话键
     */
    data class Input(
        val enabled: Boolean,
        val active: Boolean,
        val lockTask: Boolean,
        val mode: String,
        val pkg: String,
        val selfPkg: String,
        val apps: Set<String>,
        val launchers: Set<String>,
        val imes: Set<String>,
        val sessionKey: String = "",
        val unlockedKey: String = ""
    )

    /**
     * 这一帧该不该进入"拦截生效"状态（设计 A4 / A4b）。
     *
     * `running && !paused && mode in {focus, free}`：
     * - 休息段（`shortBreak` / `longBreak`）本来就该走开；
     * - 暂停是用户明确表达"我要走开"，暂停还拦等于把暂停变成假暂停。
     */
    fun isActive(mode: String, running: Boolean, paused: Boolean): Boolean =
        running && !paused && mode in GUARD_MODES

    /** 包名归一化：去空白 + 小写（系统事件里偶尔带空格，比对必须稳）。 */
    fun normalizePkg(pkg: String?): String = (pkg ?: "").trim().lowercase()

    /** 白名单判定：自己 / launcher / IME / 系统必放行项。 */
    fun isWhitelisted(
        pkg: String,
        selfPkg: String,
        launchers: Set<String>,
        imes: Set<String>
    ): Boolean {
        val p = normalizePkg(pkg)
        if (p.isEmpty()) return true
        if (p == normalizePkg(selfPkg)) return true
        if (p in ALWAYS_ALLOWED) return true
        if (p == IME_FALLBACK) return true
        if (launchers.any { normalizePkg(it) == p }) return true
        if (imes.any { normalizePkg(it) == p }) return true
        return false
    }

    /**
     * 该不该拦这个包。
     *
     * 顺序即优先级：总开关 → 生效镜像 → 深度锁机 → mode → 黑名单 → 白名单 → 本场已解锁。
     * 最后一条（`unlockedKey`）放在白名单之后：它只影响"是不是本场还拦"，与包名无关，
     * 但放最后可以让前六条在跑表里独立取到 false，不会互相掩盖。
     */
    fun shouldBlock(i: Input): Boolean {
        if (!i.enabled) return false
        if (!i.active) return false
        if (i.lockTask) return false
        if (i.mode !in GUARD_MODES) return false
        val p = normalizePkg(i.pkg)
        if (p.isEmpty()) return false
        if (i.apps.none { normalizePkg(it) == p }) return false
        if (isWhitelisted(p, i.selfPkg, i.launchers, i.imes)) return false
        if (i.sessionKey.isNotEmpty() && i.unlockedKey == i.sessionKey) return false
        return true
    }

    /**
     * 小窗 / 遮罩上要显示的名字（设计 C5）。
     *
     * 空任务名 → 回落到 `session.title`（"番茄专注中 / 正计时中"）；
     * `'自由专注'` 原样显示（网页自由专注的 taskName 就是它，用户要看得到）。
     */
    fun displayName(taskName: String, title: String): String {
        val name = taskName.trim()
        return if (name.isEmpty()) title else name
    }

    /** 任务名归一化：去首尾空白并截到 [MAX_TASK_NAME]（原生侧的兜底，shim 已截过一次）。 */
    fun normalizeTaskName(raw: String?): String {
        val s = (raw ?: "").trim()
        return if (s.length <= MAX_TASK_NAME) s else s.substring(0, MAX_TASK_NAME)
    }

    /** 授权引导次数 +1（`guard.askCount`）。 */
    fun nextAskCount(current: Int): Int = if (current < 0) 1 else current + 1

    /** 是否该追加「受限制的设置」引导（Android 13 侧载安装后无障碍页会灰掉）。 */
    fun shouldShowRestrictedHint(askCount: Int): Boolean = askCount >= ASK_COUNT_FOR_RESTRICTED

    /**
     * 要不要为这一场提示"应用锁失效"（服务被 ROM 静默关掉 / 用户手动关掉）。
     *
     * 每场只提示一次（`guard.revokedKey`），否则用户每次切回来都被弹一次，会直接关掉应用锁。
     * 服务真的开着、或者总开关没开，都不提示。
     */
    fun shouldPromptRevoked(
        revokedKey: String,
        sessionKey: String,
        serviceOn: Boolean,
        guardEnabled: Boolean
    ): Boolean {
        if (!guardEnabled) return false
        if (serviceOn) return false
        if (sessionKey.isEmpty()) return false
        return revokedKey != sessionKey
    }

    /**
     * `guard.active` 是不是残留（防"没在计时也拦"，设计 §6 第 11 条）。
     *
     * 唯一的兜底判据：镜像说"在拦"，但 prefs 里没有任何一场活着的计时 → 一定是异常路径
     * （进程被杀、闹钟迟到）漏置了 false。
     */
    fun residueNeedsRepair(active: Boolean, sessionLive: Boolean): Boolean = active && !sessionLive

    /**
     * 残留判据②（P1-1③）：镜像为真、会话**存在**但已经过期（`endAt` 已过 或 `savedAt + 8h` 已过）。
     *
     * 与 [residueNeedsRepair] 分开是为了日志能说清"是没人报账"还是"账已经过期了"：
     * 两者的修法一样（都要清），但真机上一看日志就知道是哪种路径漏的。
     */
    fun residueExpired(
        active: Boolean,
        hasSession: Boolean,
        savedAt: Long,
        endAtWall: Long,
        counting: Boolean,
        nowWall: Long
    ): Boolean {
        if (!active) return false
        if (!hasSession) return false
        return !sessionActive(savedAt, endAtWall, counting, nowWall)
    }

    /**
     * `App.onCreate` 前置清账的判据（0.2.3 P1-2）：新进程刚起，而镜像说的是**一场正计时**。
     *
     * ## 为什么需要它（0.2.2 漏掉的那一格）
     *
     * 正计时没有 `endAt`，唯一判据是 `savedAt + 8h`，而"进程被 LMK 杀"这件事**没有任何记录**：
     * 网页已死、正计时实际上已经停了，镜像却认为它还在跑。于是 `repairResidue` /
     * `recheckExpired` 的四条路径全部判"活着" → 用户开黑名单 App 照旧被遮罩 + 打回，
     * 一直要到 `savedAt + 8h` 之后的第一条窗口事件才放行。
     *
     * `Application.onCreate` 是"新进程刚起"的**确定性信号**：此刻网页一定还没活
     * （WebView 尚未创建），所以一场正计时如果还挂在 prefs 里，它一定已经死了 ——
     * 进程被杀之后没有任何东西还在给它计时。
     *
     * ## 为什么只清 `guard.active`，不清 session / 粘性键
     *
     * - 用户随后打开 App → 网页从快照恢复正计时并重新上报 → `syncActive(true)` 会重写镜像，
     *   最多 1 秒空窗（而用户此刻正停在网页上，本来也不需要拦自己）；
     * - 用户不打开 App → 这场正计时已经死了，session 残留 ≤ 8h 无害（它只是数据，
     *   不再驱动拦截；`repairResidue` 会按 8h 陈旧门收尾）；
     * - 粘性键更不能清：清了下一次上报就是新一场，四张"本场不再打扰"记账全部落空。
     *
     * ## 边界
     *
     * - `savedAt <= 0`（从没落过盘）→ 不动，交给下一次上报；
     * - 倒计时（`counting == false`）→ 不走这条，仍按 `endAt` 过期判据处理；
     * - `guard.active == false` → 本来就没拦，什么都不做（省几次 prefs 读）；
     * - **已经过了 8h 陈旧门（`now - savedAt > MAX_SESSION_AGE_MS`）→ 也不走这条**：
     *   那一场 `repairResidue` 的过期分支本来就会连 session + 粘性键一起清。
     *   若这里先抢着把 `guard.active` 清掉，`repairResidue` 的"镜像为真"前提就没了，
     *   过期那场会退化成**永久残留的数据**（启动后按它恢复小窗 / FGS 通知）——
     *   这是 0.2.2 已经修好的保证，不能被本轮改回去。
     *   所以本判据只负责"镜像说在跑、8h 内其实早已随进程死掉"这一格。
     *
     * @param active   `guard.active` 镜像
     * @param counting 落盘会话是不是正计时（`SessionRecord.isCounting`）
     * @param savedAt  落盘会话的最后一次保存时刻
     * @param nowWall  现在的 wall clock（由调用方取一次，便于离线跑表）
     */
    fun countingOrphanNeedsClear(
        active: Boolean,
        counting: Boolean,
        savedAt: Long,
        nowWall: Long
    ): Boolean {
        if (!active) return false
        if (!counting) return false
        if (savedAt <= 0L) return false
        // 超 8h 的那一场让位给 repairResidue（它会连 session + 粘性键一起清）
        return nowWall - savedAt <= MAX_SESSION_AGE_MS
    }

    /**
     * `recheckExpired` 的判定（P1-1②）：这一帧该不该把 session / 粘性键 / `guard.active` 清掉。
     *
     * 四种状态（`guard.active` × 会话三态）：
     *
     * | guard.active | 会话                                 | 清? | 说明                                          |
     * |--------------|--------------------------------------|-----|-----------------------------------------------|
     * | false        | 任意                                 | 否  | 本来就没拦，没什么可清（还省几次 prefs 读）    |
     * | true         | `savedAt <= 0`（没落盘 / 无会话）     | 否  | 启动那一帧不能误清；无会话交给 repairResidue   |
     * | true         | 活着（倒计时未到点 / 正计时 8h 内）   | 否  | 正在专注，必须继续拦                          |
     * | true         | 过期（`endAt` 已过 / `savedAt` 超 8h） | 是 | 网页已死但不会再结算 → 不修就是永久拦          |
     */
    fun recheckNeedsClear(
        active: Boolean,
        savedAt: Long,
        endAtWall: Long,
        counting: Boolean,
        nowWall: Long
    ): Boolean {
        if (!active) return false
        if (savedAt <= 0L) return false
        return !sessionActive(savedAt, endAtWall, counting, nowWall)
    }

    /**
     * 落盘会话现在还算不算"活着"（[SessionRecord.active] 的纯函数版本，唯一真源）。
     *
     * 三条判据（顺序即短路顺序）：
     * 1. `savedAt <= 0`：还没落盘（进程刚起、页面还没上报）→ **不算活着**；
     * 2. `now - savedAt > 8h`：正计时没有终点，只能用陈旧门收口；
     * 3. 倒计时且 `endAt <= now`：终点已过 = 这一场结束了。
     *
     * 放在纯逻辑层是因为 `Guard` / `GuardService` 两条复核路径都要用它，
     * 而 `State.kt` 带 `android.content.Context`，离线跑表编不进去。
     */
    fun sessionActive(savedAt: Long, endAtWall: Long, counting: Boolean, nowWall: Long): Boolean {
        if (savedAt <= 0L) return false
        if (nowWall - savedAt > MAX_SESSION_AGE_MS) return false
        if (!counting && endAtWall <= nowWall) return false
        return true
    }

    /**
     * 一场计时最长算"活着"多久（与网页 `FREE_SNAP_STALE_MS` 对齐：8 小时）。
     *
     * 放在这里而不是 [SessionRecord]：本文件必须零 Android 依赖（可离线跑表）。
     * `SessionRecord.MAX_AGE_MS` 直接引用本常量，两边不会各写一个数。
     */
    const val MAX_SESSION_AGE_MS = 8L * 60L * 60L * 1000L

    /** 遮罩到期时刻是不是已经过去了（进程重启后据此立刻清账）。0 = 没有残留，不算过期。 */
    fun overlayExpired(overlayUntil: Long, nowWall: Long): Boolean =
        overlayUntil > 0L && overlayUntil <= nowWall

    /**
     * 遮罩上"剩余 / 已过"的显示口径。
     *
     * @return true = 倒计时（显示"剩余"），false = 正计时（显示"已专注"）
     */
    fun countingDown(endAtWall: Long): Boolean = endAtWall > 0L
}
