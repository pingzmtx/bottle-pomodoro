package im.bottle.focus

/**
 * 会话身份（会话键）—— 「这一场计时」的唯一标识，**由原生自己维护的粘性键**。
 *
 * ## 为什么不再从单帧数据现算（0.1.2 的错）
 *
 * 0.1.2 用 `mode#startTime` 从每一帧上报里现算键，前提是"暂停→继续时网页不改 startTime"。
 * 真页面实测把这个前提否掉了：
 *
 * | 模式      | 开始 / 暂停 / 继续 的 startTime                      | 现算键稳定? |
 * |-----------|------------------------------------------------------|-------------|
 * | pomodoro  | 1795033891686 / 同 / 同                              | ✅          |
 * | stopwatch | 1795033898743 / 同 / **1795033901459**               | ❌          |
 * | flowtime  | 1795033906043 / 同 / **1795033908758**               | ❌          |
 *
 * 自由专注是**正计时**，已过时间就是 `now - startTime`；网页在"继续"的那一刻必然把
 * `startTime` 重写成当前时刻，否则它会以为中间那段暂停也算专注。
 * 于是现算的键一变，挂在键上的四个"本场不再打扰"标记
 * （`unlockedSession` / `askedPinSession` / `askedOverlaySession` / `bubbleDismissSession`）
 * 全部失效：手动解锁后又跳设置页、小窗又回来、授权页又弹 —— P1-1 等于没修。
 *
 * ## 现在的做法：粘性键（sticky key）
 *
 * 键**只在"新的一场开始"时生成一次**，此后由原生落盘保存，暂停 / 继续 / 暂停中 / 时钟变动
 * 都不再重算。判定只看三件事：`running`、`remaining`、`mode`；`startTime` / `endAt` 的漂移
 * **一律不参与**（时钟回拨、后台暂停、继续时的重写都不该把同一场判成新场）。
 *
 * 真值表（`app/tools/SessionKeyCheck.kt` 逐条离线跑）：
 *
 * | # | prev（落盘）                              | 这一帧（mode / running / remaining） | 结果     |
 * |---|-------------------------------------------|--------------------------------------|----------|
 * | 1 | focus#7 / running                       | focus / true / 1200                  | 沿用 #7  |
 * | 2 | free#8 / running                        | free / true（startTime 被重写）      | 沿用 #8  |
 * | 3 | free#9 / running                        | free / true（startTime 被重写）      | 沿用 #9  |
 * | 4 | focus#7 / not running / remaining=0     | idle / false / 0                     | 清空→下一场新键 |
 * | 5 | focus#7 / running（进程重启）           | idle / false / 1500（加载前的默认帧）→ focus / true / 1200 | 沿用 #7 |
 * | 6 | focus#7 / running / remaining=0         | focus / false / 0                    | 清空     |
 * | 7 | focus#7 / running                       | free / true / 0                      | 新键 #8  |
 * | 8 | focus#7 / running                       | focus / true（endAt 任意漂移）       | 沿用 #7  |
 * | 9 | focus#7 / 暂停（remaining=1400）        | idle / false / 1500（重启首帧）→ focus / false / 1400（恢复出的暂停帧）→ focus / true / 1400 | 全程沿用 #7 |
 * |10 | focus#7 / 暂停                          | idle / false / 1500（**真实**结束帧，本进程已见过真实帧）→ focus / true / 1500 | 清空 → 新键 #8 |
 * |11 | focus#7 / 暂停（重启后恢复出暂停帧）    | idle / false / 1500（用户开新场前的 resetToIdle）→ focus / true / 1500 | 清空 → 新键 #8 |
 *
 * 第 9–11 条是 0.1.4 补的：0.1.3 的清键条件里带了一个 `!prev.running` 兜底，
 * 于是"暂停（prev.running=false）→ 杀进程 → 重开首帧 idle"满足了兜底 → 键被误清，
 * 网页随后才恢复出真实帧（`mode=focus, running=false, remaining>0`，即暂停态），
 * 此时键已经没了：手动解锁 / 悬浮窗授权四张记账全部落空，暂停一次再继续又跳一遍系统页。
 *
 * 纯函数、零 Android 依赖：`app/tools/qa_sessionkey.sh` 用**线上同一份源码**离线跑表。
 */
object SessionKey {

    /** 键里的分隔符。键的形态固定是 `<mode>#<seq>`，恰好一个 `#`。 */
    const val SEP: Char = '#'

    /** 网页"没有在计时"时的 mode（`resetToIdle()` / 冷启动默认值）。 */
    const val IDLE: String = "idle"

    /** mode 缺失时的兜底，避免产生 `#12` 这种和任何模式都不匹配的键。 */
    const val UNKNOWN: String = "unknown"

    /**
     * 落盘/内存里的「当前粘性键」。
     *
     * @param key       形如 `focus#7`；空串 = 目前没有会话身份
     * @param mode      生成这个键时用的 mode（键里也有一份，落盘一份便于直接读）
     * @param running   上一次看到的"在跑"状态（冷启动时要靠它判断"这场还活着吗"）
     * @param remaining 上一次看到的剩余秒数（判"已结束"用）
     */
    data class Sticky(
        val key: String = "",
        val mode: String = "",
        val running: Boolean = false,
        val remaining: Int = 0
    )

    /**
     * 一帧 `timer.report` 里参与判定的字段。
     *
     * @param endAt 刻意保留但**从不参与判定**：它是 wall clock，时钟回拨/改时区会漂移，
     *              而漂移不代表换场。写在这里只是为了让"它不参与"这件事可被单测证明。
     */
    data class Frame(
        val mode: String,
        val freeType: String,
        val running: Boolean,
        val remaining: Int,
        val endAt: Long
    ) {
        /** 正计时（自由专注里的 stopwatch）：没有终点，`remaining` 是"已过秒数"，开局就是 0。 */
        val isCounting: Boolean
            get() = mode == "free" && freeType == "stopwatch"
    }

    /**
     * 判定结果。
     *
     * @param key       这一帧之后的粘性键（空串 = 没有会话身份）
     * @param mode      与 [key] 对应的 mode
     * @param generated 这一帧**新生成**了键（调用方要把序号推进一格）
     * @param cleared   这一帧**清空**了键（会话结束）
     */
    data class Decision(
        val key: String,
        val mode: String,
        val generated: Boolean = false,
        val cleared: Boolean = false
    )

    /** mode 归一化：去空白、空串落到 [UNKNOWN]。 */
    fun normalizeMode(mode: String): String = mode.trim().ifEmpty { UNKNOWN }

    /** 从键里取出 mode；键非法时返回空串（调用方据此判"没有可比的 mode"）。 */
    fun modeOf(key: String): String {
        val i = key.indexOf(SEP)
        return if (i <= 0) "" else key.substring(0, i)
    }

    /** 造一个新键。序号由调用方给（落盘的单调计数），所以新一场必然与旧键不同。 */
    fun make(mode: String, seq: Long): String {
        val safeMode = normalizeMode(mode)
        return "$safeMode#$seq"
    }

    /**
     * 粘性键的状态机（纯函数）。
     *
     * @param prev          上一次落盘的粘性状态
     * @param frame         这一帧的网页上报
     * @param seq           **候选**序号（调用方给 `已存序号 + 1`；只有 [Decision.generated] 时才落盘）
     * @param seenLiveFrame 本次进程是否已经见过"真实计时态"（mode != idle）的帧。
     *
     * 为什么需要 [seenLiveFrame]：网页冷启动的第一帧是**本地状态还没加载完**的默认值
     * （实测 `mode=idle, remaining=1500, running=false`）。若把这一帧当成"用户回到了空闲"，
     * 进程重启后正在跑的那一场就会被误清键（正好破坏"重启后键不变"）。
     * 这个标志是**进程内**的（不落盘）：它表达的是"页面的真实状态已经到货了"。
     *
     * 0.1.4：**"回到 idle" 只有在见过真实帧之后才算结束**。清键的触发条件收成一条：
     *   - `mode == IDLE` 且 `!seenLiveFrame` → 这是重启时未初始化的帧，**不清键**（本轮缺陷）；
     *   - `mode == IDLE` 且 `seenLiveFrame`  → 真的回到空闲，清键；
     *   - `!running && remaining <= 0`（非正计时）→ 真的到点结束，清键。
     *
     * ⚠️ 第三条**不**加 `seenLiveFrame` 闸门：未初始化的帧 `mode` 恒为 idle（`createTimerState()`
     * 的默认值），所以闸门在第 1 条就已经覆盖它；若把第三条也挂上闸门，
     * "重启后首帧就是 `focus / remaining=0` 的真结束帧"会漏清（用例 ⑥ 会退化）。
     */
    fun decide(prev: Sticky, frame: Frame, seq: Long, seenLiveFrame: Boolean): Decision {
        val mode = normalizeMode(frame.mode)

        if (!frame.running) {
            // ① 重启首帧：mode 恒为 idle（页面本地状态还没加载完）。
            //    **这一帧不构成"这一场结束了"的证据**，键原样保留。
            //    0.1.3 这里写的是 `(seenLiveFrame || !prev.running)`：暂停态的 `prev.running`
            //    正好是 false，于是"暂停 → 杀进程 → 重开"把还在的键清掉了（本轮缺陷）。
            if (mode == IDLE && !seenLiveFrame) return Decision(prev.key, prev.mode)
            // ② 已结束：倒计时归零。
            //    正计时排除在外：它的 `remaining` 是"已过秒数"，开局就是 0，
            //    暂停在第 0 秒时 remaining 也还是 0 —— 那不是结束。
            if (!frame.isCounting && frame.remaining <= 0) return cleared(prev)
            // ③ 见过真实帧之后回到 idle = 这一场结束了（网页 `resetToIdle()` 后 remaining 会回到
            //    整段时长，所以不能只靠 remaining<=0 判结束）。
            if (mode == IDLE) return cleared(prev)
            // ④ 暂停（`mode != IDLE && running == false && remaining > 0`）→ 沿用，什么都不改。
            //    重启后网页恢复出来的暂停帧也走这一条：键必须活着。
            return Decision(prev.key, prev.mode)
        }

        // ⑤ 在跑但没有键 → 新的一场（首帧在跑、上次是空闲、或者键被清过）
        if (prev.key.isEmpty()) return generated(mode, seq)
        // ⑥ 在跑但 mode 换了（番茄 → 正计时 / 专注 → 休息，中间没回 idle）→ 新的一场
        if (modeOf(prev.key) != mode) return generated(mode, seq)
        // ⑦ 在跑且 mode 一致 → 沿用。
        //    暂停 → 继续、继续 → 暂停、暂停中手动解锁，全部走这一条；
        //    `startTime` 被重写、`endAt` 漂移都不影响。
        return Decision(prev.key, prev.mode)
    }

    private fun cleared(prev: Sticky): Decision =
        if (prev.key.isEmpty() && prev.mode.isEmpty()) Decision("", "")
        else Decision("", "", cleared = true)

    private fun generated(mode: String, seq: Long): Decision =
        Decision(make(mode, seq), mode, generated = true)
}
