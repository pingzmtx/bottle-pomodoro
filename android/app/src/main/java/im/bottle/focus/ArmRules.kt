package im.bottle.focus

/**
 * 影子闹钟的纯决策层（**不引任何 Android 类型**）。
 *
 * 为什么单独抽出来：这四条规则是"到点会不会响"的全部判定，之前埋在 `TimerWatch` 里，
 * 只能靠真机/模拟器验证。抽成纯函数后可以在 JVM 上直接跑表（`app/tools/ArmRulesCheck.kt`），
 * 规则回归不再依赖设备。
 *
 * 不变式：任何一条规则命中都返回 [Verdict.Disarm] 或 [Verdict.CountUp]，
 * 因为它们的共同含义都是"这一场没有可排的终点"。
 */
object ArmRules {

    /** 距终点不足 1.5s 就别排了：排了也是立刻响，没有意义。 */
    const val MIN_LEAD_MS = 1_500L

    /** ≤ 3s 视为可接受漂移，不重排。 */
    const val DRIFT_OK_MS = 3_000L

    /** > 60s 判为换会话。 */
    const val DRIFT_MAX_MS = 60_000L

    /** 网页状态投影（字段与 `timer.report` 一一对应）。 */
    data class Input(
        val mode: String,
        val freeType: String,
        val running: Boolean,
        val paused: Boolean,
        val endAt: Long,
        val startTime: Long,
        val bgPause: Boolean,
        val notify: Boolean
    )

    sealed class Verdict {
        /** 正计时：不排闹钟，但必须显示正计时常驻通知（不是静默 disarm）。 */
        object CountUp : Verdict()

        /** 按这个终点排闹钟。 */
        data class Arm(val endAtWall: Long) : Verdict()

        /** 已经有同一场闹钟，保持不动（但仍应刷新常驻通知，防止被系统清掉后不回来）。 */
        data class Keep(val fireAt: Long) : Verdict()

        /** 这一场没有可排的终点。 */
        data class Disarm(val reason: String) : Verdict()
    }

    /**
     * 决策入口。
     *
     * @param i 网页当前状态
     * @param nowWall 当前 wall clock（毫秒）
     * @param armedAtWall prefs 里已排闹钟的终点；0 表示没有
     */
    fun decide(i: Input, nowWall: Long, armedAtWall: Long): Verdict {
        // 规则 4：用户在网页里关掉了提醒
        if (!i.notify) return Verdict.Disarm("web-notify-off")
        // 规则 1：暂停没有"到点"
        if (!i.running || i.paused) return Verdict.Disarm("not-running")

        // ★ 规则 2：bgPause 只对**番茄专注**生效。
        //
        // 网页侧的唯一实现是 app.js 的 visibilitychange 分支：
        //     if (bgPause && timerState.running && timerState.mode === 'focus')
        // 也就是说它只冻结 `mode === 'focus'`，自由专注（flowtime / stopwatch）
        // 在后台照常走。旧代码把这一条当成全局开关，结果开了"后台暂停"的用户
        // 一旦切后台，flowtime 的闹钟和常驻通知就被一起撤掉 —— 而网页其实还在倒计时。
        // 这是"flowtime 没通知"最真实的一条原因（见交付说明）。
        if (i.bgPause && i.mode == "focus") return Verdict.Disarm("bg-pause-on")

        // 规则 3：正计时没有终点，但要常驻通知（A 的核心修复点）
        if (i.mode == "free" && i.freeType == "stopwatch") return Verdict.CountUp

        if (i.endAt <= 0L) return Verdict.Disarm("no-end-at")
        // 终点已经过了（或近到排了也来不及）：不排，交给网页自己的恢复逻辑结算
        if (i.endAt - nowWall < MIN_LEAD_MS) return Verdict.Disarm("too-late")

        if (armedAtWall != 0L) {
            val drift = kotlin.math.abs(i.endAt - armedAtWall)
            return when {
                // 抖动不重排（否则每秒重排会把 AlarmManager 打爆）
                drift <= DRIFT_OK_MS -> Verdict.Keep(armedAtWall)
                // 打断恢复 / endAt 后移：重排一次
                drift <= DRIFT_MAX_MS -> Verdict.Arm(i.endAt)
                // 判为换会话，丢旧闹钟按新 endAt 排
                else -> Verdict.Arm(i.endAt)
            }
        }
        return Verdict.Arm(i.endAt)
    }
}
