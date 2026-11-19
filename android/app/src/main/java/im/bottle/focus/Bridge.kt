package im.bottle.focus

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONObject

/**
 * 桥：12 条命令，**读写都不落在网页的状态上**。
 *
 * 没有任何一条能改 `localStorage`、改 `timerState`、执行任意命令、打开任意 URL。
 * 这不是"克制地不写"，是压根没有写的方法 —— 冲突不是被解决，是不存在（设计 §1）。
 *
 * 唯一涉及"数据"的是 4 条 `file.export.*`：它们只把**网页自己算好的备份文本**写进
 * 用户刚在系统对话框里选中的那个文件里，既不读也不改 `localStorage`。
 * 导入方向原生完全不参与（`FileExchange.onShowFileChooser` 只负责把 `content://`
 * 交回网页，校验与落库由网页自己的 `validateBackup` / `applyBackupData` 完成）。
 *
 * 通信走 `WebViewCompat.addWebMessageListener`：回调在主线程、来源被 origin 规则限制、
 * JS 可达面只有一个 `postMessage`（不是反射暴露一堆方法）。
 */
class Bridge(
    private val activity: MainActivity,
    private val host: WebAppHost,
    private val watch: TimerWatch,
    private val files: FileExchange
) : WebViewCompat.WebMessageListener {

    /** 等系统权限对话框结果的 reply 代理（`notify.request` 是异步的）。 */
    private val pendingPermReplies = mutableMapOf<String, JavaScriptReplyProxy>()

    private var lastGestureEvalAt = 0L

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy
    ) {
        // ① 来源校验：只认自己那个 origin 的主框架
        val origin = sourceOrigin.toString().trimEnd('/')
        if (origin != State.ORIGIN || !isMainFrame) {
            Log.w(TAG, "drop message origin=$origin mainFrame=$isMainFrame")
            return
        }

        val raw = message.data ?: run {
            Log.w(TAG, "drop non-string message")
            return
        }
        val json = try {
            JSONObject(raw)
        } catch (e: Exception) {
            Log.w(TAG, "bad json: $raw")
            return
        }

        val id = json.optString("id", "")
        val cmd = json.optString("cmd", "")
        val payload = json.optJSONObject("payload") ?: JSONObject()
        if (id.isEmpty() || cmd.isEmpty()) {
            Log.w(TAG, "bad envelope: $raw")
            return
        }

        try {
            dispatch(id, cmd, payload, replyProxy)
        } catch (e: Exception) {
            Log.e(TAG, "handle $cmd failed", e)
            replyErr(id, E_INTERNAL, replyProxy)
        }
    }

    private fun dispatch(
        id: String,
        cmd: String,
        payload: JSONObject,
        proxy: JavaScriptReplyProxy
    ) {
        when (cmd) {
            "hello" -> replyOk(id, buildHello(), proxy)

            "notify.permission" -> replyOk(
                id, JSONObject().put("state", notificationPermissionState()), proxy
            )

            "notify.request" -> handleNotifyRequest(id, proxy)

            "notify.show" -> {
                val title = payload.optString("title", "")
                val body = payload.optString("body", "")
                // 长度上限：入参一律校验，超限直接拒（设计 §4.4）
                if (title.length > MAX_TEXT || body.length > MAX_TEXT) {
                    replyErr(id, E_BAD_PAYLOAD, proxy)
                    return
                }
                val tag = payload.optString("tag", "")
                val sticky = payload.optBoolean("sticky", false)
                val webTag = if (tag.isEmpty()) DEFAULT_TAG else tag
                // 所有网页通知共用一个槽位（P1-4 a），是否真的发出去由 Notifications 判定
                // （原生刚响过 90s 内、文案相似 → 吞掉，避免同一次"到点"两条通知）。
                val shown = Notifications.showTagged(activity, webTag, title, body, sticky)
                replyOk(
                    id,
                    JSONObject()
                        .put("shown", shown)
                        .put("suppressed", !shown)
                        .put("tag", Notifications.WEB_TAG),
                    proxy
                )
            }

            "notify.cancel" -> {
                val tag = payload.optString("tag", "")
                Notifications.cancelTag(activity, if (tag.isEmpty()) DEFAULT_TAG else tag)
                replyOk(id, JSONObject().put("cancelled", true), proxy)
            }

            "screen.wake" -> {
                val on = payload.optBoolean("on", false)
                State.setDesiredWake(activity, on)
                activity.applyKeepScreenOn(on)
                replyOk(id, JSONObject().put("on", on), proxy)
            }

            "timer.report" -> handleTimerReport(id, payload, proxy)

            /**
             * 打开原生设置页（设计 T04）。
             *
             * 它**没有任何写网页状态的能力**：不接受任何参数、不改 timerState / localStorage，
             * 唯一副作用是把一个原生 Activity 拉到前台。网页里的「⚙ 应用设置」入口就是点它。
             */
            "app.settings" -> {
                activity.openAppSettings()
                replyOk(id, JSONObject().put("opened", true), proxy)
            }

            "device.info" -> replyOk(id, buildDeviceInfo(), proxy)

            // ---- 导出（写文件）：三段式 + abort，见 FileExchange ----
            // 每条入参都过长度上限再往下走：这是桥唯一的"外部输入"面。
            "file.export.begin" -> {
                val name = payload.optString("name", "")
                val mime = payload.optString("mime", MIME_JSON)
                if (name.length > MAX_FILE_NAME || mime.length > MAX_MIME) {
                    Log.w(TAG, "file.export.begin rejected: name=${name.length} mime=${mime.length}")
                    replyErr(id, E_BAD_PAYLOAD, proxy)
                    return
                }
                Log.i(TAG, "file.export.begin name=$name total=${payload.optLong("total", 0L)}")
                files.beginExport(id, name, mime, proxy)
            }

            "file.export.chunk" -> {
                val sid = payload.optString("sessionId", "")
                val data = payload.optString("data", "")
                if (sid.isEmpty() || sid.length > MAX_SESSION_ID || data.length > MAX_CHUNK_CHARS) {
                    Log.w(TAG, "file.export.chunk rejected: sid=${sid.length} data=${data.length}")
                    replyErr(id, E_BAD_PAYLOAD, proxy)
                    return
                }
                files.writeChunk(id, sid, data, proxy)
            }

            "file.export.end" -> {
                val sid = payload.optString("sessionId", "")
                if (sid.isEmpty() || sid.length > MAX_SESSION_ID) {
                    replyErr(id, E_BAD_PAYLOAD, proxy)
                    return
                }
                files.endExport(id, sid, proxy)
            }

            "file.export.abort" -> {
                val sid = payload.optString("sessionId", "")
                if (sid.isEmpty() || sid.length > MAX_SESSION_ID) {
                    replyErr(id, E_BAD_PAYLOAD, proxy)
                    return
                }
                files.abortExport(id, sid, proxy)
            }

            // 未知命令：降级但不静默（JS 侧 console.warn 后走"不支持"分支）
            else -> replyErr(id, E_UNKNOWN_CMD, proxy)
        }
    }

    /**
     * 计时上报走这里：**唯一**会动闹钟的路径。
     *
     * 注意这里没有任何回写 —— 原生只回答"我排/撤了"，不告诉网页该怎么做。
     */
    private fun handleTimerReport(id: String, payload: JSONObject, proxy: JavaScriptReplyProxy) {
        val s = TimerState.from(payload)
        val result = watch.onReport(s)

        // 响了但网页仍在跑 → 说明之前那条"到点"抄了旧值，撤掉它（设计 §1.4 末行）。
        // 只撤通知，不改数据：结算永远由网页按自己的 endAt 做。
        if (s.running && s.endAt > System.currentTimeMillis() + 2_000L &&
            State.firedFor(activity) != 0L
        ) {
            Notifications.cancelAlert(activity)
        }

        val out = JSONObject()
        when (result) {
            is TimerWatch.ArmResult.Armed -> {
                out.put("armed", true).put("fireAt", result.fireAt)
            }
            is TimerWatch.ArmResult.Keep -> {
                out.put("armed", true).put("fireAt", result.fireAt).put("kept", true)
            }
            is TimerWatch.ArmResult.Counting -> {
                // 正计时：没有闹钟，但常驻通知已经是正计时形态（A）。
                // 显式告诉网页"我在数着"，别写成 armed=false 让它以为失败了。
                out.put("armed", false)
                    .put("counting", true)
                    .put("startAt", result.startAt)
                    .put("reason", "count-up")
            }
            is TimerWatch.ArmResult.Disarmed -> {
                out.put("armed", false).put("reason", result.reason)
            }
        }
        replyOk(id, out, proxy)

        // 小窗 / 锁机是**纯原生联动**，只读投影、不回写任何网页状态。
        activity.onTimerState(s)

        // 首次真正"开始计时"时才申请通知权限（有手势、有上下文，不是冷启动骚扰）
        if (s.running && !s.paused) {
            activity.onTimerRunningReported()
        }
    }

    private fun handleNotifyRequest(id: String, proxy: JavaScriptReplyProxy) {
        val state = notificationPermissionState()
        if (state != PERMISSION_DEFAULT || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            replyOk(id, JSONObject().put("state", state), proxy)
            return
        }
        pendingPermReplies[id] = proxy
        activity.requestNotificationPermission()
    }

    /**
     * `Notification.permission` 的真值。
     *
     * 只有"系统真的没授权"才返回 default/denied —— 网页据此渲染引导行，探测反而更准。
     */
    private fun notificationPermissionState(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return PERMISSION_GRANTED
        val granted = ContextCompat.checkSelfPermission(
            activity, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) return PERMISSION_GRANTED
        val deniedBefore = State.prefs(activity).getBoolean(K_NOTIF_DENIED, false)
        return if (deniedBefore) PERMISSION_DENIED else PERMISSION_DEFAULT
    }

    /** 系统对话框关闭后由 MainActivity 调：回推 JS + 兑现挂起的 reply。 */
    fun onPermissionResult(granted: Boolean) {
        State.prefs(activity).edit().putBoolean(K_NOTIF_DENIED, !granted).apply()
        val state = if (granted) PERMISSION_GRANTED else PERMISSION_DENIED

        // 推给 shim：通知页里的"未授权"立刻变成"已授权"，不用重启
        host.eval("window.__bottleSetPerm && window.__bottleSetPerm('$state')")

        val snapshot = pendingPermReplies.toMap()
        pendingPermReplies.clear()
        snapshot.forEach { (id, proxy) ->
            replyOk(id, JSONObject().put("state", state), proxy)
        }
    }

    /**
     * 触摸打点：shim 用它判断"这次 requestPermission 有没有用户手势"。
     *
     * 没手势不弹框（冷启动网页会主动调 requestPermission，必须挡住，设计 §3.3）。
     */
    fun markUserGesture() {
        val now = System.currentTimeMillis()
        if (now - lastGestureEvalAt < 400L) return // 节流，不要在滑动时疯狂 eval
        lastGestureEvalAt = now
        host.eval("window.__lastTouch=$now")
    }

    private fun buildHello(): JSONObject = JSONObject().apply {
        put("appVersion", BuildConfig.VERSION_NAME)
        put("versionCode", BuildConfig.VERSION_CODE)
        put("webVersion", State.readWebVersion(activity))
        put("sdk", Build.VERSION.SDK_INT)
        put("origin", State.ORIGIN)
        put("shimAtDocumentStart", host.shimAtDocumentStart)
    }

    private fun buildDeviceInfo(): JSONObject = JSONObject().apply {
        put("appVersion", BuildConfig.VERSION_NAME)
        put("versionCode", BuildConfig.VERSION_CODE)
        put("webVersion", State.readWebVersion(activity))
        put("package", activity.packageName)
        put("sdk", Build.VERSION.SDK_INT)
        put("release", Build.VERSION.RELEASE)
        put("model", Build.MODEL)
        put("manufacturer", Build.MANUFACTURER)
        put("origin", State.ORIGIN)
        put("notifyPermission", notificationPermissionState())
        // 应用锁状态（报障用）：总开关 / 服务是否真的在线 / 拦了多少个应用。
        // 只读投影，网页拿它只做诊断展示，不构成"原生写网页状态"。
        put("guardEnabled", State.guardEnabled(activity))
        put("guardServiceOn", Guard.serviceEnabled(activity))
        // 0.2.4（C）：黑名单 → 白名单。键名同步改成 guardAllow（网页没有读它，见 verify 断言的
        // device.info 字段清单）。语义是"允许使用的应用数量"，0 = 除系统应用外全拦。
        put("guardAllow", State.guardAllow(activity).size)
    }

    private fun replyOk(id: String, payload: JSONObject, proxy: JavaScriptReplyProxy) {
        BridgeReply.ok(id, payload, proxy)
    }

    private fun replyErr(id: String, code: String, proxy: JavaScriptReplyProxy) {
        BridgeReply.err(id, code, proxy)
    }

    companion object {
        private const val TAG = "BottleBridge"

        private const val MAX_TEXT = 200
        private const val DEFAULT_TAG = "bottle.web"

        /** `file.export.chunk` 单块上限：shim 按 256K 字符切，留一倍余量给异常实现。 */
        private const val MAX_CHUNK_CHARS = 400_000

        /** 文件名（含扩展名）与 MIME 的长度上限。 */
        private const val MAX_FILE_NAME = 200
        private const val MAX_MIME = 100

        private const val MAX_SESSION_ID = 64

        private const val MIME_JSON = "application/json"

        private const val PERMISSION_GRANTED = "granted"
        private const val PERMISSION_DENIED = "denied"
        private const val PERMISSION_DEFAULT = "default"

        private const val K_NOTIF_DENIED = "notif.denied"

        // 错误码只留 4 个（设计附录）
        private const val E_UNKNOWN_CMD = "E_UNKNOWN_CMD"
        private const val E_BAD_PAYLOAD = "E_BAD_PAYLOAD"
        private const val E_INTERNAL = "E_INTERNAL"
    }
}

/**
 * 统一应答出口：Bridge 与 FileExchange 共用。
 *
 * 抽出来只为一件事：`FileExchange` 的回包来自写盘线程，而 [JavaScriptReplyProxy.postMessage]
 * 只在主线程调用最稳 —— 一处做线程收敛，比两处各写一遍可靠。
 */
internal object BridgeReply {

    private val main = Handler(Looper.getMainLooper())

    fun ok(id: String, payload: JSONObject, proxy: JavaScriptReplyProxy) {
        post(
            proxy,
            JSONObject().put("v", 1).put("id", id).put("ok", true).put("payload", payload).toString()
        )
    }

    fun err(id: String, code: String, proxy: JavaScriptReplyProxy) {
        post(
            proxy,
            JSONObject()
                .put("v", 1)
                .put("id", id)
                .put("ok", false)
                .put("error", JSONObject().put("code", code))
                .toString()
        )
    }

    private fun post(proxy: JavaScriptReplyProxy, text: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            deliver(proxy, text)
        } else {
            main.post { deliver(proxy, text) }
        }
    }

    private fun deliver(proxy: JavaScriptReplyProxy, text: String) {
        try {
            proxy.postMessage(text)
        } catch (e: Exception) {
            // WebView 已销毁 / 页面已导航：回包发不出去是正常情况，不崩
            Log.w("BottleBridge", "reply failed: $text", e)
        }
    }
}
