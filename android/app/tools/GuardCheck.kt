package im.bottle.focus

/**
 * [GuardRules] 的离线跑表（纯逻辑，不碰 Android 运行时）。
 *
 * 为什么不用 JUnit：本工程的 Gradle 依赖是离线缓存好的，加测试依赖就得联网。
 * 这里用缓存里已有的 kotlin-compiler-embeddable 编译「线上同一份 GuardRules.kt +
 * 本文件」，在 JVM 上跑（与 `SessionKeyCheck.kt` / `ArmRulesCheck.kt` 同款）。
 *
 * 覆盖四块（都是真机上极难复现、但一错就是"用户被反复打回"的东西）：
 * ① 白名单判定（自己 / launcher / IME / 系统必放行 / 相机不放行）；
 * ② 拦截条件（running × paused × mode 全组合 + shouldBlock 的真值表）；
 * ③ 失效计数（授权引导次数、Android 13 受限设置阈值、掉线提示去重）；
 * ④ residue 修复（guard.active 残留的两条判据）+ 任务名归一化。
 *
 * 跑法：`app/tools/qa_guard.sh`（退出码 0 = 全过；2 = 环境不可用）
 */
object GuardCheck {

    private var pass = 0
    private var fail = 0

    private const val SELF = "im.bottle.focus"

    private val LAUNCHERS = setOf(
        "com.miui.home",                       // 小米
        "com.huawei.android.launcher",          // 华为
        "com.google.android.apps.nexuslauncher" // 原生
    )

    private val IMES = setOf("com.sohu.inputmethod.sogou", "com.baidu.input")

    @JvmStatic
    fun main(args: Array<String>) {
        whitelist()
        blockConditions()
        askCount()
        residue()
        taskName()
        recheckExpired()
        repairExpired()
        countingOrphan()

        println()
        println("结果：$pass PASS / $fail FAIL")
        if (fail > 0) {
            println("IS_PASS: NO")
            kotlin.system.exitProcess(1)
        }
        println("IS_PASS: YES")
    }

    // ------------------------------------------------------------------ ① 白名单

    private fun whitelist() {
        section("① 白名单判定")

        check("自己包名放行（遮罩点击要回得来）", GuardRules.isWhitelisted(SELF, SELF, LAUNCHERS, IMES))
        check("小米 launcher 放行", GuardRules.isWhitelisted("com.miui.home", SELF, LAUNCHERS, IMES))
        check(
            "华为 launcher 放行",
            GuardRules.isWhitelisted("com.huawei.android.launcher", SELF, LAUNCHERS, IMES)
        )
        check(
            "原生 launcher 放行",
            GuardRules.isWhitelisted("com.google.android.apps.nexuslauncher", SELF, LAUNCHERS, IMES)
        )
        check("输入法放行（拦了等于打字即被打回）", GuardRules.isWhitelisted("com.sohu.inputmethod.sogou", SELF, LAUNCHERS, IMES))
        check(
            "IME 兜底包名放行（getEnabledInputMethodList 偶发返回空）",
            GuardRules.isWhitelisted(GuardRules.IME_FALLBACK, SELF, LAUNCHERS, IMES)
        )
        check("SystemUI 放行（下拉通知栏 / 最近任务）", GuardRules.isWhitelisted("com.android.systemui", SELF, LAUNCHERS, IMES))
        check(
            "权限弹窗宿主放行",
            GuardRules.isWhitelisted("com.android.permissioncontroller", SELF, LAUNCHERS, IMES)
        )
        check("设置放行（用户要能关服务 / 开热点）", GuardRules.isWhitelisted("com.android.settings", SELF, LAUNCHERS, IMES))
        check("拨号放行（拦电话是产品事故）", GuardRules.isWhitelisted("com.android.dialer", SELF, LAUNCHERS, IMES))
        check("来电 UI 放行", GuardRules.isWhitelisted("com.android.incallui", SELF, LAUNCHERS, IMES))
        check("紧急拨号放行", GuardRules.isWhitelisted("com.android.emergency", SELF, LAUNCHERS, IMES))
        check("闹钟放行（否则用户以为闹钟坏了）", GuardRules.isWhitelisted("com.android.deskclock", SELF, LAUNCHERS, IMES))

        check("相机**不**放行（典型分心源）", !GuardRules.isWhitelisted("com.android.camera", SELF, LAUNCHERS, IMES))
        check("微信不放行（普通黑名单逻辑）", !GuardRules.isWhitelisted("com.tencent.mm", SELF, LAUNCHERS, IMES))
        check(
            "包名带空白 / 大小写也能正确比对",
            GuardRules.isWhitelisted("  COM.MIUI.HOME  ", SELF, LAUNCHERS, IMES)
        )
        check(
            "launcher 集合为空时（query 失败）不误放行",
            !GuardRules.isWhitelisted("com.miui.home", SELF, emptySet(), IMES)
        )
    }

    // -------------------------------------------------------------- ② 拦截条件

    private fun blockConditions() {
        section("② 拦截条件（running × paused × mode）")

        check("focus + running + 未暂停 → 拦", GuardRules.isActive("focus", running = true, paused = false))
        check("free + running + 未暂停 → 拦（自由专注同样要拦）", GuardRules.isActive("free", running = true, paused = false))
        check("shortBreak + running → 不拦（休息该走开）", !GuardRules.isActive("shortBreak", running = true, paused = false))
        check("longBreak + running → 不拦", !GuardRules.isActive("longBreak", running = true, paused = false))
        check("idle → 不拦", !GuardRules.isActive("idle", running = true, paused = false))
        check("空 mode → 不拦", !GuardRules.isActive("", running = true, paused = false))
        check("focus 但没在跑 → 不拦", !GuardRules.isActive("focus", running = false, paused = false))
        check("focus 暂停 → 不拦（暂停是「我要走开」）", !GuardRules.isActive("focus", running = true, paused = true))
        check("free 暂停 → 不拦", !GuardRules.isActive("free", running = true, paused = true))

        val wechat = "com.tencent.mm"
        val base = GuardRules.Input(
            enabled = true,
            active = true,
            lockTask = false,
            mode = "focus",
            pkg = wechat,
            selfPkg = SELF,
            apps = setOf(wechat),
            launchers = LAUNCHERS,
            imes = IMES,
            sessionKey = "focus#7",
            unlockedKey = ""
        )
        check("命中黑名单 + 专注中 → 拦", GuardRules.shouldBlock(base))
        check("总开关关 → 不拦", !GuardRules.shouldBlock(base.copy(enabled = false)))
        check("active 镜像为 false（暂停/休息）→ 不拦", !GuardRules.shouldBlock(base.copy(active = false)))
        check("深度锁机生效 → 不拦（A1b：钉住了就别再耗电）", !GuardRules.shouldBlock(base.copy(lockTask = true)))
        check("休息段 → 不拦", !GuardRules.shouldBlock(base.copy(mode = "shortBreak")))
        check("不在黑名单 → 不拦", !GuardRules.shouldBlock(base.copy(apps = setOf("com.other.app"))))
        check("黑名单里但属于白名单（设置）→ 不拦", !GuardRules.shouldBlock(base.copy(pkg = "com.android.settings", apps = setOf("com.android.settings"))))
        check("空包名 → 不拦（事件异常时宁可不动）", !GuardRules.shouldBlock(base.copy(pkg = "  ")))
        check(
            "本场已「不再拦」（会话键相同）→ 不拦",
            !GuardRules.shouldBlock(base.copy(unlockedKey = "focus#7"))
        )
        check(
            "上一场解锁过、这一场是新键 → 照样拦",
            GuardRules.shouldBlock(base.copy(unlockedKey = "focus#6"))
        )
        check(
            "黑名单集合大小写 / 空白不影响判定",
            GuardRules.shouldBlock(base.copy(apps = setOf("  COM.Tencent.MM ")))
        )
    }

    // -------------------------------------------------------------- ③ 失效计数

    private fun askCount() {
        section("③ 失效计数与提示去重")

        check("askCount 0 → 1", GuardRules.nextAskCount(0) == 1)
        check("askCount 1 → 2", GuardRules.nextAskCount(1) == 2)
        check("askCount 异常负值 → 1（不自增成 0）", GuardRules.nextAskCount(-3) == 1)
        check("第 1 次跳授权页不追加「受限制的设置」文案", !GuardRules.shouldShowRestrictedHint(1))
        check("第 2 次开始追加（Android 13 侧载后无障碍页是灰的）", GuardRules.shouldShowRestrictedHint(2))
        check("第 3 次继续追加", GuardRules.shouldShowRestrictedHint(3))

        check(
            "服务在线 → 不提示掉线",
            !GuardRules.shouldPromptRevoked("focus#7", "focus#7", serviceOn = true, guardEnabled = true)
        )
        check(
            "总开关没开 → 不提示（用户主动关的，不是故障）",
            !GuardRules.shouldPromptRevoked("", "focus#7", serviceOn = false, guardEnabled = false)
        )
        check(
            "没有会话键 → 不提示（空串会和空串相等，会变成每次提示）",
            !GuardRules.shouldPromptRevoked("", "", serviceOn = false, guardEnabled = true)
        )
        check(
            "本场已经提示过 → 不再提示",
            !GuardRules.shouldPromptRevoked("focus#7", "focus#7", serviceOn = false, guardEnabled = true)
        )
        check(
            "新的一场 + 服务掉了 → 提示一次",
            GuardRules.shouldPromptRevoked("focus#7", "focus#8", serviceOn = false, guardEnabled = true)
        )
    }

    // -------------------------------------------------------------- ④ residue

    private fun residue() {
        section("④ residue 修复（防「没计时也拦」）")

        check("active=true 但没有活着的场次 → 必须修", GuardRules.residueNeedsRepair(active = true, sessionLive = false))
        check("active=true 且场次活着 → 不动", !GuardRules.residueNeedsRepair(active = true, sessionLive = true))
        check("active=false → 不动", !GuardRules.residueNeedsRepair(active = false, sessionLive = false))
        check("active=false 但场次活着（还没开始拦）→ 不动", GuardRules.residueNeedsRepair(active = false, sessionLive = true).not())

        val now = 1_700_000_000_000L
        check("没有遮罩记账（0）→ 不算过期", !GuardRules.overlayExpired(0L, now))
        check("遮罩到期时刻已过 → 算过期（进程重启后清账）", GuardRules.overlayExpired(now - 1, now))
        check("到期时刻正好是现在 → 算过期", GuardRules.overlayExpired(now, now))
        check("还没到期 → 不算过期", !GuardRules.overlayExpired(now + 1_000, now))
    }

    // -------------------------------------------------------------- ⑤ 任务名

    private fun taskName() {
        section("⑤ 任务名（T05）")

        check("空任务名 → 回落到通知标题", GuardRules.displayName("", "番茄专注中") == "番茄专注中")
        check("自由专注的 taskName 原样显示", GuardRules.displayName("自由专注", "正计时中") == "自由专注")
        check(
            "超过 64 字符截断",
            GuardRules.normalizeTaskName("x".repeat(100)).length == GuardRules.MAX_TASK_NAME
        )
        check("64 字符整不截断", GuardRules.normalizeTaskName("y".repeat(64)).length == 64)
        check("首尾空白被去掉", GuardRules.normalizeTaskName("  写周报  ") == "写周报")
        check("null 归一化为空串（不抛）", GuardRules.normalizeTaskName(null) == "")
        check("endAt > 0 → 倒计时", GuardRules.countingDown(1_700_000_000_000L))
        check("endAt == 0（正计时）→ 往上数", !GuardRules.countingDown(0L))
    }

    // ------------------------------------------- ⑥ recheckExpired（P1-1② 的判定表）

    /**
     * `GuardService.onAccessibilityEvent` 每 30s 调一次 `Guard.recheckExpired`，
     * 它只问 [GuardRules.recheckNeedsClear] 一个问题：这一帧该不该把
     * session / 粘性键 / `guard.active` 清掉。
     *
     * 这里跑的是**四种状态 × 边界**（now 前后各 1ms、8h 边界）——
     * 真机上"清早了"= 正在专注却不再拦，"清晚了"= 黑名单 App 被永久拦，两个方向都是事故。
     */
    private fun recheckExpired() {
        section("⑥ recheckExpired（30s 时间复核）")

        val now = 1_700_000_000_000L
        val max = GuardRules.MAX_SESSION_AGE_MS

        check(
            "recheck：倒计时到点（endAt 已过）→ 清",
            GuardRules.recheckNeedsClear(true, now - 1_000, now - 1, counting = false, nowWall = now)
        )
        check(
            "recheck：倒计时还有 1ms → 不清（正在专注，必须继续拦）",
            !GuardRules.recheckNeedsClear(true, now - 1_000, now + 1, counting = false, nowWall = now)
        )
        check(
            "recheck：endAt 正好等于 now → 清（与 ArmRules 的 MIN_LEAD 口径一致）",
            GuardRules.recheckNeedsClear(true, now - 1_000, now, counting = false, nowWall = now)
        )
        check(
            "recheck：正计时正好 8h（边界内）→ 不清",
            !GuardRules.recheckNeedsClear(true, now - max, 0L, counting = true, nowWall = now)
        )
        check(
            "recheck：正计时超过 8h → 清（网页已死，不会再结算）",
            GuardRules.recheckNeedsClear(true, now - max - 1, 0L, counting = true, nowWall = now)
        )
        check(
            "recheck：savedAt=0（会话还没落盘）→ 不清（启动那一帧不能误清）",
            !GuardRules.recheckNeedsClear(true, 0L, 0L, counting = true, nowWall = now)
        )
        check(
            "recheck：savedAt=0 且倒计时 endAt 已过 → 仍然不清（没落盘就无从判断）",
            !GuardRules.recheckNeedsClear(true, 0L, now - 1, counting = false, nowWall = now)
        )
        check(
            "recheck：guard.active=false → 不清（本来就没拦）",
            !GuardRules.recheckNeedsClear(false, now - 1_000, now - 1, counting = false, nowWall = now)
        )
        check(
            "recheck：没有会话且 active=false → 不清",
            !GuardRules.recheckNeedsClear(false, 0L, 0L, counting = false, nowWall = now)
        )
    }

    // --------------------------------- ⑦ repairResidue 的过期分支（P1-1③）

    private fun repairExpired() {
        section("⑦ repairResidue 过期分支（镜像为真但账已过期）")

        val now = 1_700_000_000_000L
        val max = GuardRules.MAX_SESSION_AGE_MS

        check(
            "repairResidue：没有会话（session == null）→ 修",
            GuardRules.residueNeedsRepair(active = true, sessionLive = false)
        )
        check(
            "repairResidue：会话已过期（倒计时 endAt 已过）→ 修",
            GuardRules.residueExpired(
                active = true, hasSession = true,
                savedAt = now - 1_000, endAtWall = now - 1, counting = false, nowWall = now
            )
        )
        check(
            "repairResidue：会话已过期（正计时 savedAt + 8h 已过）→ 修",
            GuardRules.residueExpired(
                active = true, hasSession = true,
                savedAt = now - max - 1, endAtWall = 0L, counting = true, nowWall = now
            )
        )
        check(
            "repairResidue：会话还活着（倒计时未到点）→ 不动",
            !GuardRules.residueExpired(
                active = true, hasSession = true,
                savedAt = now - 1_000, endAtWall = now + 60_000, counting = false, nowWall = now
            )
        )
        check(
            "repairResidue：会话还活着（正计时 8h 内）→ 不动",
            !GuardRules.residueExpired(
                active = true, hasSession = true,
                savedAt = now - max, endAtWall = 0L, counting = true, nowWall = now
            )
        )
        check(
            "repairResidue：guard.active=false → 过期也不清（没在拦）",
            !GuardRules.residueExpired(
                active = false, hasSession = true,
                savedAt = now - max - 1, endAtWall = 0L, counting = true, nowWall = now
            )
        )
        check(
            "repairResidue：没有会话记录 → 过期判据不适用（走 residueNeedsRepair）",
            !GuardRules.residueExpired(
                active = true, hasSession = false,
                savedAt = 0L, endAtWall = 0L, counting = false, nowWall = now
            )
        )
        check(
            "sessionActive：savedAt=0 一律不算活着",
            !GuardRules.sessionActive(0L, 0L, counting = true, nowWall = now)
        )
    }

    // ------------------------------- ⑧ App.onCreate 清「被进程重启留下的正计时场次」

    /**
     * 0.2.3 P1-2：`App.onCreate` 里那条**前置**清账（跑在 `repairResidue` 之前）。
     *
     * 现场（QA 逐帧推演）：正计时（`endAt=0`，`savedAt=T0`）、`guard.active=true`、
     * 黑名单含微信 → LMK 杀进程（prefs 全留）→ 重绑。`repairResidue` 与
     * `recheckExpired` 都只看 `savedAt + 8h`，于是判"还活着"，用户开微信照旧被遮罩 + 打回，
     * 一直要到 `savedAt + 8h` 之后的第一条窗口事件才放行。
     *
     * 判据只有一条 [GuardRules.countingOrphanNeedsClear]：`active && counting && savedAt > 0`
     * 且**尚未过 8h 陈旧门**（过了就让位给 `repairResidue`，见该函数的边界说明）。
     * 这里跑的就是它的真值表 —— 边界都在"清早了 = 正在专注却不拦 / 清晚了 = 被永久拦"这两侧。
     */
    private fun countingOrphan() {
        section("⑧ App.onCreate 清正计时孤儿镜像（P1-2）")

        val now = 1_700_000_000_000L

        check(
            "App.onCreate：正计时场次 + guard.active=true → 清 active",
            GuardRules.countingOrphanNeedsClear(true, true, now, now)
        )
        check(
            "App.onCreate：savedAt=0（从没落过盘）→ 不动",
            !GuardRules.countingOrphanNeedsClear(true, true, 0L, now)
        )
        check(
            "App.onCreate：savedAt 异常负值 → 不动（同上，没有落盘时刻就无从判断）",
            !GuardRules.countingOrphanNeedsClear(true, true, -1L, now)
        )
        check(
            "App.onCreate：倒计时（endAt>0，counting=false）→ 不走这条（仍按 endAt 过期判）",
            !GuardRules.countingOrphanNeedsClear(true, false, now, now)
        )
        check(
            "App.onCreate：guard.active=false → 本来就没拦，什么都不做",
            !GuardRules.countingOrphanNeedsClear(false, true, now, now)
        )
        check(
            "App.onCreate：没有会话（counting=false / savedAt=0）→ 交给 repairResidue",
            !GuardRules.countingOrphanNeedsClear(true, false, 0L, now)
        )
        // 正计时"刚起 1ms"与"正好 8h"都必须清：进程重启与场次新旧无关，
        // 网页此刻都不可能活着（WebView 还没创建）。
        check(
            "App.onCreate：正计时刚起 1ms 也清（进程重启与场次新旧无关）",
            GuardRules.countingOrphanNeedsClear(true, true, now - 1, now)
        )
        check(
            "App.onCreate：正计时正好 8h（边界内）→ 仍然清",
            GuardRules.countingOrphanNeedsClear(true, true, now - GuardRules.MAX_SESSION_AGE_MS, now)
        )
        check(
            "App.onCreate：正计时超 8h → 让位给 repairResidue（否则过期那场的数据永远不清）",
            !GuardRules.countingOrphanNeedsClear(
                true, true, now - GuardRules.MAX_SESSION_AGE_MS - 1, now
            )
        )
        check(
            "App.onCreate：超 8h 那一场仍由 repairResidue 的过期判据负责",
            GuardRules.residueExpired(
                active = true, hasSession = true,
                savedAt = now - GuardRules.MAX_SESSION_AGE_MS - 1,
                endAtWall = 0L, counting = true, nowWall = now
            )
        )
        // 清完镜像之后：shouldBlock 的 active 闸门必须让它变成"不拦"（这正是 P1-2 的目的）。
        val wechat = "com.tencent.mm"
        val before = GuardRules.Input(
            enabled = true, active = true, lockTask = false, mode = "free",
            pkg = wechat, selfPkg = SELF, apps = setOf(wechat),
            launchers = LAUNCHERS, imes = IMES, sessionKey = "free#2", unlockedKey = ""
        )
        check("清账前：正计时中开微信 → 拦（这是缺陷现状）", GuardRules.shouldBlock(before))
        check("清账后：同一条判定 → 不拦（P1-2 的验收口径）", !GuardRules.shouldBlock(before.copy(active = false)))
    }

    // ------------------------------------------------------------------ 工具

    private fun section(title: String) {
        println()
        println("--- $title ---")
    }

    private fun check(name: String, ok: Boolean) {
        if (ok) {
            pass++
            println("PASS  $name")
        } else {
            fail++
            println("FAIL  $name")
        }
    }
}
