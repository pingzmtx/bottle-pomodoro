package im.bottle.focus

import android.content.Context
import org.json.JSONObject

/**
 * 全局常量与持久化小工具。
 *
 * 这里的三条 URL 常量是**契约**：整个 App 只认这一个 origin。
 */
object State {

    /** WebViewAssetLoader 的保留域（设计 §2）。 */
    const val DOMAIN = "appassets.androidplatform.net"

    /**
     * ⚠️ 一旦发布永远不能改：localStorage / IndexedDB 按 origin 隔离，换 origin = 用户数据全部消失。
     * 所有地方（Bridge 的 allowedOriginRules、documentStart 的 origin 约束、AssetLoader 的 domain）
     * 都从这一个常量派生，不写字面量，避免三处不一致。
     */
    const val ORIGIN = "https://$DOMAIN"

    /**
     * 加载 URL 必须带 `/index.html`，不能写 `/`：
     * `/` 会被映射到目录 `assets/web/`，AssetManager 返回 null → 404 → 白屏（设计 §2）。
     */
    const val BASE_URL = "$ORIGIN/index.html"

    /** 桥对象名。产物全文里出现 0 次，233 个 window 白名单里也不存在（设计 §4.3）。 */
    const val BRIDGE_NAME = "__bottleHost"

    private const val PREFS = "bottle_focus_prefs"
    private const val K_PENDING_END_AT = "pending.endAt"
    private const val K_PENDING_TITLE = "pending.title"
    private const val K_FIRED_END_AT = "fired.endAt"
    private const val K_ASKED_EXACT = "asked.exactAlarm"
    private const val K_DESIRED_WAKE = "desired.wake"

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---------------------------------------------------------------- 待响闹钟

    /** 记下"已经排好、还没响"的闹钟。跨进程可读，所以进程被杀后 BootReceiver 还能用它。 */
    fun savePendingAlarm(ctx: Context, endAtWall: Long, title: String) {
        prefs(ctx).edit()
            .putLong(K_PENDING_END_AT, endAtWall)
            .putString(K_PENDING_TITLE, title)
            .apply()
    }

    fun loadPendingAlarm(ctx: Context): PendingAlarm? {
        val endAt = prefs(ctx).getLong(K_PENDING_END_AT, 0L)
        if (endAt <= 0L) return null
        val title = prefs(ctx).getString(K_PENDING_TITLE, "") ?: ""
        return PendingAlarm(endAt, title)
    }

    fun clearPendingAlarm(ctx: Context) {
        prefs(ctx).edit()
            .remove(K_PENDING_END_AT)
            .remove(K_PENDING_TITLE)
            .apply()
    }

    // -------------------------------------------------------------- 幂等闸门

    /** 同一个 endAt 只响一次：AlarmManager 重复投递 / 重排残留都走这道闸。 */
    fun firedFor(ctx: Context): Long = prefs(ctx).getLong(K_FIRED_END_AT, 0L)

    fun markFired(ctx: Context, endAtWall: Long) {
        prefs(ctx).edit().putLong(K_FIRED_END_AT, endAtWall).apply()
    }

    // --------------------------------------------------------------- 一次性标记

    /** 精确闹钟授权引导只拉一次，否则每次启动都弹系统页，用户会认为 App 有病。 */
    fun exactAlarmAsked(ctx: Context): Boolean = prefs(ctx).getBoolean(K_ASKED_EXACT, false)

    fun markExactAlarmAsked(ctx: Context) {
        prefs(ctx).edit().putBoolean(K_ASKED_EXACT, true).apply()
    }

    /** 网页要的"屏幕常亮"意愿。原生自己记，不依赖 JS 回调（设计 §3.1）。 */
    fun desiredWake(ctx: Context): Boolean = prefs(ctx).getBoolean(K_DESIRED_WAKE, false)

    fun setDesiredWake(ctx: Context, on: Boolean) {
        prefs(ctx).edit().putBoolean(K_DESIRED_WAKE, on).apply()
    }

    // -------------------------------------------------------------- 网页版本号

    /**
     * 从 `assets/web/config.js` 里读 `version: 'xxxx'`，作为报障用的网页版本号。
     * 读文件而不是问 JS：进程刚起、页面还没跑起来时也能回答 device.info。
     */
    fun readWebVersion(ctx: Context): String {
        return try {
            val text = ctx.assets.open("web/config.js").bufferedReader().use { it.readText() }
            val m = Regex("version:\\s*'([^']+)'").find(text)
            m?.groupValues?.get(1) ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }
}

/** 已排好但还没响的闹钟。 */
data class PendingAlarm(val endAtWall: Long, val title: String)

/**
 * 网页 `timerState` + `appData.settings` 的只读投影（设计 §8.7）。
 *
 * 原生只读不写：没有任何一条桥命令能改它，所以"网页/原生两套账"这个问题在结构上不存在。
 */
data class TimerState(
    val mode: String,
    val freeType: String,
    val running: Boolean,
    val paused: Boolean,
    val endAt: Long,
    val startTime: Long,
    val remaining: Int,
    val totalDuration: Int,
    val bgPause: Boolean,
    val notify: Boolean
) {
    companion object {
        /** 从桥上报的 JSON 构造；字段缺失一律取安全默认值（默认"不该响"）。 */
        fun from(o: JSONObject): TimerState = TimerState(
            mode = o.optString("mode", ""),
            freeType = o.optString("freeType", ""),
            running = o.optBoolean("running", false),
            paused = o.optBoolean("paused", true),
            endAt = o.optLong("endAt", 0L),
            startTime = o.optLong("startTime", 0L),
            remaining = o.optInt("remaining", 0),
            totalDuration = o.optInt("totalDuration", 0),
            bgPause = o.optBoolean("bgPause", false),
            notify = o.optBoolean("notify", true)
        )
    }
}
