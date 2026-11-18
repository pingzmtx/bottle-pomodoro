package im.bottle.focus

import kotlin.system.exitProcess

/**
 * [SessionKey.decide] 的离线跑表（纯 JVM，零 Android 依赖）。
 *
 * 这 8 条用例就是 P1-A 的**全部事实依据**，其中 1/2/3 对应真页面实测里
 * "自由专注在继续时会重写 startTime" 的事实（不再假设 startTime 稳定）。
 *
 *  1. pomodoro 暂停 → 继续：键不变
 *  2. stopwatch 暂停 → 继续（startTime 被重写）：键不变
 *  3. flowtime  暂停 → 继续（startTime 被重写）：键不变
 *  4. 结束后再开一场：键不同
 *  5. 进程重启（只剩 prefs 的 mode/startTime/key，running=true）：键不变
 *  6. 进程重启且 remaining=0：键被清
 *  7. 切换模式（番茄 → 正计时，中间未 idle）：键变
 *  8. 时钟回拨 / 改系统时间（endAt 漂移）：键不变
 *  9. 暂停 → 杀进程 → 重开首帧 idle → 恢复出暂停帧 → 继续：键全程不变（0.1.4）
 * 10. 直接结束（真实 idle 帧）→ 再开：键变（0.1.4）
 * 11. 暂停 → 杀进程 → 重开 → 不继续、直接开新一场（必经 resetToIdle）：键变（0.1.4）
 *
 * 9–11 覆盖 0.1.4 修的缺陷：清键曾带 `!prev.running` 兜底，暂停态（running=false）
 * 在"重开首帧 idle"时被误清，于是 `unlockedSession` / `askedPinSession` /
 * `askedOverlaySession` / `bubbleDismissSession` 四张记账全部落空。
 *
 * 运行：`app/tools/qa_sessionkey.sh`（退出码 0 = 全过）
 */
object SessionKeyCheck {

    private var failures = 0
    private var checks = 0

    private fun expect(name: String, actual: Any?, expected: Any?) {
        checks++
        if (actual == expected) {
            println("PASS  $name")
        } else {
            failures++
            println("FAIL  $name    expected=$expected actual=$actual")
        }
    }

    private fun expectSame(name: String, actual: String, expected: String) {
        checks++
        if (actual == expected && expected.isNotEmpty()) {
            println("PASS  $name  (key=$actual)")
        } else {
            failures++
            println("FAIL  $name    expected=$expected actual=$actual（必须相同且非空）")
        }
    }

    private fun expectNotSame(name: String, a: String, b: String) {
        checks++
        if (a != b && a.isNotEmpty() && b.isNotEmpty()) {
            println("PASS  $name  (a=$a b=$b)")
        } else {
            failures++
            println("FAIL  $name    a=$a b=$b（必须不同且非空）")
        }
    }

    // ------------------------------------------------------------ 小工具

    /** 网页的一帧上报。`endAt` 故意单独给，便于第 8 条证明它不参与判定。 */
    private fun frame(
        mode: String,
        running: Boolean,
        remaining: Int,
        freeType: String = "",
        endAt: Long = 0L
    ) = SessionKey.Frame(mode, freeType, running, remaining, endAt)

    /** 跑一帧：把 [prev] 和判定结果拼成下一帧的 prev（等价于 State.updateStickySession 的读写）。 */
    private class Sim {
        var sticky = SessionKey.Sticky()
            private set
        var seq = 0L
            private set

        /** 进程内是否见过真实计时帧（等价于 State 里那个不落盘的 seenLiveFrame）。 */
        var seenLive = false
            private set

        /** 模拟"进程重启"：粘性状态保留，进程内的 seenLive 归零。 */
        fun restart() {
            seenLive = false
        }

        fun feed(f: SessionKey.Frame): String {
            val d = SessionKey.decide(sticky, f, seq + 1L, seenLive)
            if (d.generated) seq += 1L
            if (SessionKey.normalizeMode(f.mode) != SessionKey.IDLE) seenLive = true
            sticky = SessionKey.Sticky(d.key, d.mode, f.running, f.remaining)
            return d.key
        }
    }

    @JvmStatic
    fun main(args: Array<String>) {
        // 有参数 = 回放模式：把**真页面**录下来的 timer.report 帧喂给同一份 decide()，
        // 证明"网页重写 startTime 也不换键"（qa_sessionkey_live.py 生成这个文件）。
        //   args[0] = 帧文件；args[1] = 期望的会话键个数（默认 1）
        if (args.isNotEmpty()) {
            exitProcess(replay(args[0], args.getOrNull(1)?.toIntOrNull() ?: 1))
        }
        unitTable()
        println()
        println("===== SessionKey: ${checks - failures} 通过 · $failures 失败 =====")
        exitProcess(if (failures == 0) 0 else 1)
    }

    /**
     * 回放真页面帧（每行 `mode|freeType|running|remaining|endAt`，`#` 开头是注释）。
     *
     * 断言只依赖帧流本身、不依赖"哪一帧是第几步"这种注释里的约定：
     * - **A**：相邻两帧都在跑且 mode 相同 → 键必须相同
     *   （这一条直接杀掉"继续时 startTime 被重写 → 键变"的 bug）；
     * - **B**：整段录像里非空键的**不同取值个数**等于 `expectSessions`
     *   （一场计时中间暂停/继续过 → 1；结束再开一场 → 2）；
     * - **C**：最后回到 idle（网页 finish）之后键必须被清。
     */
    private fun replay(path: String, expectSessions: Int): Int {
        val sim = Sim()
        var lastRunning: SessionKey.Frame? = null
        var lastKey = ""
        val keys = LinkedHashSet<String>()
        var frames = 0
        var aFail = 0

        java.io.File(path).forEachLine { raw ->
            val line = raw.trim()
            if (line.isEmpty() || line.startsWith("#")) return@forEachLine
            val f = line.split('|')
            if (f.size < 5) return@forEachLine
            val frame = SessionKey.Frame(
                mode = f[0],
                freeType = f[1],
                running = f[2].toBoolean(),
                remaining = f[3].toIntOrNull() ?: 0,
                endAt = f[4].toLongOrNull() ?: 0L
            )
            val key = sim.feed(frame)
            frames++
            if (frame.running) keys.add(key)
            val prev = lastRunning
            if (prev != null && prev.running && frame.running &&
                SessionKey.normalizeMode(prev.mode) == SessionKey.normalizeMode(frame.mode) &&
                key != lastKey
            ) {
                aFail++
                println("FAIL  A：同一场里键变了 mode=${frame.mode}  ${lastKey} -> ${key}")
            }
            lastRunning = frame
            lastKey = key
            println("frame %2d  %-11s running=%-5s remaining=%-5d key=%s"
                .format(frames, frame.mode, frame.running.toString(), frame.remaining, key))
        }

        checks++
        if (frames > 0 && aFail == 0) {
            println("PASS  A：相邻的在跑帧 mode 相同 → 键始终相同（$frames 帧）")
        } else {
            failures++
            println("FAIL  A：有帧换了键（$aFail 次）")
        }

        checks++
        if (keys.size == expectSessions) {
            println("PASS  B：整段录像出现 ${keys.size} 个会话键 $keys（与期望场次数一致）")
        } else {
            failures++
            println("FAIL  B：出现 ${keys.size} 个不同的键 $keys（期望 $expectSessions 个）")
        }

        checks++
        if (lastKey.isEmpty()) {
            println("PASS  C：回到 idle 之后键已清空（下一场必是新键）")
        } else {
            failures++
            println("FAIL  C：结束时键没清（$lastKey）")
        }

        println()
        println("===== 真页回放: ${checks - failures} 通过 · $failures 失败 =====")
        return if (failures == 0) 0 else 1
    }

    private fun unitTable() {
        // ============ 1. pomodoro 暂停 → 继续：startTime 不变，键必须不变 ============
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1500, endAt = 1_730_000_000_000L))
            val k2 = sim.feed(frame("focus", false, 1490, endAt = 1_730_000_000_000L)) // 暂停
            val k3 = sim.feed(frame("focus", true, 1490, endAt = 1_730_000_600_000L)) // 继续（endAt 重算）
            expectSame("① pomodoro 暂停→继续：键不变", k1, k2)
            expectSame("① pomodoro 继续后仍是同一场", k1, k3)
            expect("① 键形状是 mode#seq", SessionKey.modeOf(k1), "focus")
            expect("① 键里恰好一个 '#' 分隔符", k1.count { it == SessionKey.SEP }, 1)
        }

        // ============ 2. stopwatch 暂停 → 继续：网页重写 startTime，键必须不变 ============
        run {
            val sim = Sim()
            // 实测：第一帧 running=true 时 remaining=0（正计时还没有"已过秒数"）
            val k1 = sim.feed(frame("free", true, 0, freeType = "stopwatch"))
            val k2 = sim.feed(frame("free", false, 1, freeType = "stopwatch")) // 暂停
            // 继续：真实网页把 startTime 从 179...987 改写成 179...670 —— 本状态机看不到它
            val k3 = sim.feed(frame("free", true, 1, freeType = "stopwatch"))
            expectSame("② stopwatch 暂停→继续：键不变", k1, k2)
            expectSame("② stopwatch 继续后仍是同一场", k1, k3)
        }

        // ============ 3. flowtime 暂停 → 继续：同上 ============
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("free", true, 3000, freeType = "flowtime", endAt = 1_730_003_000_000L))
            val k2 = sim.feed(frame("free", false, 2998, freeType = "flowtime", endAt = 1_730_003_000_000L))
            val k3 = sim.feed(frame("free", true, 2996, freeType = "flowtime", endAt = 1_730_003_006_000L))
            expectSame("③ flowtime 暂停→继续：键不变", k1, k2)
            expectSame("③ flowtime 继续后仍是同一场", k1, k3)
        }

        // ============ 4. 结束后再开一场：键必须不同 ============
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1500, endAt = 1_730_000_000_000L))
            val ended = sim.feed(frame("idle", false, 0)) // btnFinish 后网页回到 idle
            expect("④ 结束后键被清", ended, "")
            val k2 = sim.feed(frame("focus", true, 1500, endAt = 1_730_002_000_000L))
            expectNotSame("④ 新一场 → 键不同", k1, k2)
        }
        run {
            // 变体：网页 resetToIdle() 会把 remaining 填回整段时长（实测 1500），
            // 只靠 remaining<=0 判结束会漏，所以 idle 本身也是"结束"信号。
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1500, endAt = 1_730_000_000_000L))
            val ended = sim.feed(frame("idle", false, 1500))
            expect("④b resetToIdle（remaining 回到 1500）也算结束", ended, "")
            val k2 = sim.feed(frame("focus", true, 1500, endAt = 1_730_002_000_000L))
            expectNotSame("④b 新一场 → 键不同", k1, k2)
        }

        // ============ 5. 进程重启（running=true）：键不变 ============
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1200, endAt = 1_730_000_000_000L))
            sim.restart()
            // 冷启动第一帧是"页面状态还没加载完"的默认值（实测 idle / remaining=1500）
            val loading = sim.feed(frame("idle", false, 1500))
            expectSame("⑤ 重启后加载前的默认 idle 帧不清键", loading, k1)
            val k2 = sim.feed(frame("focus", true, 1180, endAt = 1_730_000_000_000L))
            expectSame("⑤ 进程重启后键不变（running=true 沿用）", k1, k2)
        }
        run {
            // 变体：连"加载前的默认帧"都没有，重启后第一帧就是 running
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1200, endAt = 1_730_000_000_000L))
            sim.restart()
            val k2 = sim.feed(frame("focus", true, 1200, endAt = 1_730_000_000_000L))
            expectSame("⑤b 重启后首帧即 running：键不变", k1, k2)
        }

        // ============ 6. 进程重启且 remaining=0：键被清 ============
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1500, endAt = 1_730_000_000_000L))
            expect("⑥ 前置：键已生成", k1.isNotEmpty(), true)
            sim.restart()
            val k2 = sim.feed(frame("focus", false, 0))
            expect("⑥ 重启且 remaining=0 → 键被清", k2, "")
            val k3 = sim.feed(frame("focus", true, 1500, endAt = 1_730_002_000_000L))
            expectNotSame("⑥ 之后开新一场 → 键不同", k1, k3)
        }

        // ============ 7. 切换模式（番茄 → 正计时，中间未 idle）：键变 ============
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1490, endAt = 1_730_000_000_000L))
            val k2 = sim.feed(frame("free", true, 0, freeType = "stopwatch"))
            expectNotSame("⑦ mode 变了 → 键变", k1, k2)
            val k3 = sim.feed(frame("free", true, 3, freeType = "stopwatch"))
            expectSame("⑦ 切换后同一场继续沿用", k2, k3)
        }
        run {
            // 专注 → 休息也是同一个规则（休息有自己的键，且休息不锁机）
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1490, endAt = 1_730_000_000_000L))
            val k2 = sim.feed(frame("shortBreak", true, 300, endAt = 1_730_000_300_000L))
            expectNotSame("⑦b 专注 → 短休息：键变", k1, k2)
            expect("⑦b 休息键的 mode 是 shortBreak", SessionKey.modeOf(k2), "shortBreak")
        }

        // ============ 8. 时钟回拨 / 改系统时间：endAt 漂移不影响键 ============
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1200, endAt = 1_730_000_000_000L))
            // 用户把系统时间往回拨一小时：同一场的 endAt 变成 -3600_000
            val k2 = sim.feed(frame("focus", true, 1200, endAt = 1_729_996_400_000L))
            expectSame("⑧ 时钟回拨（endAt 大幅漂移）→ 键不变", k1, k2)
            val k3 = sim.feed(frame("focus", true, 1200, endAt = 1_730_100_000_000L))
            expectSame("⑧ 时钟前拨 → 键不变", k1, k3)
            val k4 = sim.feed(frame("focus", false, 1190, endAt = 1_730_100_000_000L))
            expectSame("⑧ 漂移后再暂停 → 键仍不变", k1, k4)
        }
        run {
            // 直接证明"decide 完全不读 endAt"：同一粘性状态、只有 endAt 不同的两帧判定必须一致
            val prev = SessionKey.Sticky(key = "focus#3", mode = "focus", running = true, remaining = 900)
            val a = SessionKey.decide(prev, frame("focus", true, 900, endAt = 0L), 4L, true)
            val b = SessionKey.decide(prev, frame("focus", true, 900, endAt = -1L), 4L, true)
            val c = SessionKey.decide(prev, frame("focus", true, 900, endAt = 1_730_000_000_000L), 4L, true)
            expect("⑧b endAt=0 / 负 / 巨大：判定完全一致", listOf(a, b, c).distinct().size, 1)
        }

        // ============ 9.（0.1.4）暂停 → 杀进程 → 重开首帧 idle → 恢复出暂停帧 → 继续 ============
        // 本轮缺陷的复现：暂停态的 `prev.running` 是 false，旧代码的 `!prev.running` 兜底让
        // "重开首帧（未加载完的 idle）"也清了键；网页随后才恢复出真实帧（focus/false/1400），
        // 那一刻键已经没了 → 四个"本场不再打扰"标记全部落空。
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1500, endAt = 1_730_000_000_000L))
            val paused = sim.feed(frame("focus", false, 1400, endAt = 0L)) // 用户暂停
            expectSame("⑨ 暂停时键不变", k1, paused)

            sim.restart() // 杀进程：粘性状态落盘还在，进程内的 seenLive 归零
            // 重开首帧：页面本地状态还没加载完（实测 idle / remaining=1500 / running=false）
            val loading = sim.feed(frame("idle", false, 1500))
            expectSame("⑨ 重开首帧的未初始化 idle 帧不清键", k1, loading)

            // 网页随后恢复出暂停态（restorePausedFocusSnapshot：mode=focus/running=false/remaining=left）
            val restored = sim.feed(frame("focus", false, 1400, endAt = 0L))
            expectSame("⑨ 恢复出的暂停帧沿用同一个键", k1, restored)

            // 用户点「▶ 继续」：endAt 重算、startTime 重写，键必须还是同一个
            val resumed = sim.feed(frame("focus", true, 1399, endAt = 1_730_000_600_000L))
            expectSame("⑨ 继续后仍是同一场（不换场）", k1, resumed)
            expect("⑨ 全程只生成过一个键（没有中途换场）", sim.seq, 1L)
        }

        // ============ 10.（0.1.4）直接结束（真实 idle 帧）→ 再开：键变 ============
        // 反方向：不能为了修 9 而把"真结束"也变成不清键。同一个进程里先见过真实帧，
        // 之后的 idle 帧就是真的"回到空闲"。
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1500, endAt = 1_730_000_000_000L))
            sim.feed(frame("focus", false, 1400, endAt = 0L)) // 暂停
            // 用户按「结束」：网页 resetToIdle() → mode='idle'（本进程已见过真实帧）
            val ended = sim.feed(frame("idle", false, 1500))
            expect("⑩ 真实 idle 帧 → 键被清", ended, "")
            val k2 = sim.feed(frame("focus", true, 1500, endAt = 1_730_002_000_000L))
            expectNotSame("⑩ 再开一场 → 键变（标记不漏到下一场）", k1, k2)
        }

        // ============ 11.（0.1.4）暂停 → 杀进程 → 重开 → 不继续、直接开新一场：键必须变 ============
        // 这是**唯一必须换场**的路径（其余重启路径一律沿用键）。
        //
        // 为什么要经过一次 idle 帧：暂停态下网页只给两条路 ——「▶ 继续」（toggleTimer → running=true）
        // 和「结束」（resetToIdle → mode='idle'）。要开新一场必须先结束旧的，
        // 所以真实帧序列里必然有这一帧 idle；它出现在"本进程已见过真实帧（暂停帧）"之后 → 清键。
        // 也正因为有这个闸门，"开新场"和"继续"在帧上才分得开。
        run {
            val sim = Sim()
            val k1 = sim.feed(frame("focus", true, 1500, endAt = 1_730_000_000_000L))
            sim.feed(frame("focus", false, 1400, endAt = 0L)) // 暂停
            sim.restart()                                     // 杀进程
            sim.feed(frame("idle", false, 1500))              // 重开首帧（不清键）
            val restored = sim.feed(frame("focus", false, 1400, endAt = 0L))
            expectSame("⑪ 重启后恢复出的暂停帧沿用旧键（前置）", k1, restored)

            // 用户不继续，先结束旧的（resetToIdle：真实 idle 帧）
            val ended = sim.feed(frame("idle", false, 1500))
            expect("⑪ 结束旧场（真实 idle 帧）→ 键被清", ended, "")
            val k2 = sim.feed(frame("focus", true, 1500, endAt = 1_730_003_000_000L))
            expectNotSame("⑪ 新一场 → 键必须变", k1, k2)
            expect("⑪ 新一场只生成一个新键（共 2 个）", sim.seq, 2L)
        }

        // ============ 附加不变式 ============
        run {
            // 空 mode 不能产生会撞车的键
            val sim = Sim()
            val k = sim.feed(frame("", true, 10, endAt = 1L))
            expect("空 mode → unknown#seq", SessionKey.modeOf(k), SessionKey.UNKNOWN)
            // 非法键取不出 mode（调用方据此跳过比对）
            expect("非法键的 modeOf 是空串", SessionKey.modeOf("focus"), "")
            // 键可以安全落盘（SharedPreferences String 往返）
            val roundTrip = String(k.toByteArray(Charsets.UTF_8), Charsets.UTF_8)
            expect("键经 UTF-8 往返不变", roundTrip, k)
        }
    }
}
