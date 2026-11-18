package im.bottle.focus

import kotlin.system.exitProcess

/**
 * [ArmRules] 的离线跑表（纯 JVM，不需要 JUnit / Robolectric / 设备）。
 *
 * 为什么值得单独做：这 12 条判定就是"到点响不响 / 正计时有没有通知"的全部逻辑，
 * 之前只能靠真机复现。现在规则是纯函数，`app/tools/qa_armrules.sh` 会把
 * `ArmRules.kt`（**线上同一份源码**）和本文件一起编译并运行。
 *
 * 运行：`app/tools/qa_armrules.sh`（退出码 0 = 全过）
 */
object ArmRulesCheck {

    private const val MIN = 60_000L
    private var failures = 0
    private var checks = 0

    private fun input(
        mode: String = "focus",
        freeType: String = "",
        running: Boolean = true,
        paused: Boolean = false,
        endAt: Long = 0L,
        startTime: Long = 0L,
        bgPause: Boolean = false,
        notify: Boolean = true
    ) = ArmRules.Input(mode, freeType, running, paused, endAt, startTime, bgPause, notify)

    private fun expect(name: String, actual: Any?, expected: Any?) {
        checks++
        if (actual == expected) {
            println("PASS  $name")
        } else {
            failures++
            println("FAIL  $name    expected=$expected actual=$actual")
        }
    }

    @JvmStatic
    fun main(args: Array<String>) {
        val now = 1_700_000_000_000L
        val in25 = input(endAt = now + 25 * MIN)

        // ---- 番茄 ----
        expect(
            "focus 进行中 → Arm(endAt)",
            ArmRules.decide(in25, now, 0L),
            ArmRules.Verdict.Arm(now + 25 * MIN)
        )
        expect(
            "暂停 → Disarm(not-running)",
            ArmRules.decide(in25.copy(paused = true), now, 0L),
            ArmRules.Verdict.Disarm("not-running")
        )
        expect(
            "网页关掉提醒 → Disarm(web-notify-off)",
            ArmRules.decide(in25.copy(notify = false), now, 0L),
            ArmRules.Verdict.Disarm("web-notify-off")
        )
        expect(
            "bgPause + focus → Disarm(bg-pause-on)",
            ArmRules.decide(in25.copy(bgPause = true), now, 0L),
            ArmRules.Verdict.Disarm("bg-pause-on")
        )

        // ---- flowtime：这次的真实缺陷回归点 ----
        val flow = input(mode = "free", freeType = "flowtime", endAt = now + 50 * MIN, startTime = now)
        expect(
            "flowtime 有 endAt → Arm（照常排闹钟）",
            ArmRules.decide(flow, now, 0L),
            ArmRules.Verdict.Arm(now + 50 * MIN)
        )
        expect(
            "★ bgPause 开着也不许撤 flowtime（网页只冻结 mode=focus）",
            ArmRules.decide(flow.copy(bgPause = true), now, 0L),
            ArmRules.Verdict.Arm(now + 50 * MIN)
        )

        // ---- stopwatch：A 的核心 ----
        val stop = input(mode = "free", freeType = "stopwatch", endAt = 0L, startTime = now)
        expect(
            "stopwatch → CountUp（不是静默 disarm）",
            ArmRules.decide(stop, now, 0L),
            ArmRules.Verdict.CountUp
        )
        expect(
            "stopwatch + bgPause → 仍然 CountUp",
            ArmRules.decide(stop.copy(bgPause = true), now, 0L),
            ArmRules.Verdict.CountUp
        )

        // ---- 边界 ----
        expect(
            "endAt 已过 → Disarm(too-late)",
            ArmRules.decide(in25.copy(endAt = now - 5 * MIN), now, 0L),
            ArmRules.Verdict.Disarm("too-late")
        )
        expect(
            "距终点 1s → Disarm(too-late)",
            ArmRules.decide(in25.copy(endAt = now + 1_000L), now, 0L),
            ArmRules.Verdict.Disarm("too-late")
        )
        expect(
            "非正计时且 endAt=0 → Disarm(no-end-at)",
            ArmRules.decide(input(endAt = 0L), now, 0L),
            ArmRules.Verdict.Disarm("no-end-at")
        )

        // ---- 漂移 ----
        expect(
            "漂移 2s → Keep(已排的那个)",
            ArmRules.decide(in25, now, now + 25 * MIN + 2_000L),
            ArmRules.Verdict.Keep(now + 25 * MIN + 2_000L)
        )
        expect(
            "漂移 10s → Arm(重排)",
            ArmRules.decide(in25, now, now + 25 * MIN + 10_000L),
            ArmRules.Verdict.Arm(now + 25 * MIN)
        )
        expect(
            "漂移 120s（换会话）→ Arm(按新 endAt)",
            ArmRules.decide(in25, now, now + 25 * MIN + 120_000L),
            ArmRules.Verdict.Arm(now + 25 * MIN)
        )

        println()
        println("===== ArmRules: ${checks - failures} 通过 · $failures 失败 =====")
        exitProcess(if (failures == 0) 0 else 1)
    }
}
