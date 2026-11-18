package im.bottle.focus

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.ScriptHandler
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.URLConnection

/**
 * WebView 宿主封装：hardening、资产装载 + MIME、documentStart 注入、导航白名单。
 *
 * 这里只有一件事要做好：**把 `assets/web/` 当成一个 https 站点原样端出去**。
 * 一旦 MIME 或 origin 错了，网页就不是"长得不一样"，而是整包不执行、全白。
 */
class WebAppHost(private val activity: Activity) {

    lateinit var webView: WebView
        private set

    /** attach 之后才为 true；onDestroy 之后调用方不该再碰 webView。 */
    val isAttached: Boolean
        get() = this::webView.isInitialized

    private var assetLoader: WebViewAssetLoader? = null
    private var docStartHandler: ScriptHandler? = null

    /** shim 是否走了 documentStart（false 表示退回了 onPageStarted，有先于页面脚本执行失败的风险）。 */
    var shimAtDocumentStart = false
        private set

    fun attach(container: ViewGroup) {
        webView = WebView(activity).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            // 与网页首屏底色一致，减少首绘前的白/黑闪
            setBackgroundColor(PAGE_BG)
        }
        applySettings()
        if (BuildConfig.DEBUG) {
            // chrome://inspect，真机调试救命（设计 §4.5）
            WebView.setWebContentsDebuggingEnabled(true)
        }
        assetLoader = buildAssetLoader()
        webView.webViewClient = BottleClient()
        // blob: 下载不会回调这里（WebView 不支持 blob: 下载，这正是导出要由 shim + SAF 接管的原因）。
        // 留着只为"别的下载类型"有迹可查：宁可打一条日志，也不要用户点了没反应又查不到东西。
        webView.setDownloadListener { url, _, _, _, _ ->
            Log.w(TAG, "download not handled by host (blob: must go through shim): $url")
        }
        container.addView(webView)
    }

    /**
     * 安装 [WebChromeClient]。**必须早于 loadUrl**。
     *
     * 没有 WebChromeClient 的 WebView 既不会弹 `<input type=file>` 的选择器
     * （`onShowFileChooser` 根本不回调），也会让 `alert/confirm/prompt` 变成静默空操作。
     * 这两件事网页都依赖（导入读文件、`confirm` 兜底），所以这不是可选装饰。
     */
    fun installChromeClient(client: WebChromeClient) {
        webView.webChromeClient = client
    }

    /** §4.5 一次配齐。多一条不写、少一条不行。 */
    @SuppressLint("SetJavaScriptEnabled")
    private fun applySettings() {
        val s = webView.settings
        s.javaScriptEnabled = true                  // 唯一必须开
        s.domStorageEnabled = true                  // localStorage —— 用户全部数据
        s.databaseEnabled = true                    // IndexedDB
        s.allowFileAccess = false
        // 必须为 true：导入要把用户刚授权的 content:// 交给 WebView 读（SAF 选中的那一个文件）。
        // 这是文件选择器的默认前提，关掉后 <input>.files[0] 静默失败 —— 正是「点了没用」。
        // 风险面很小：本工程无 INTERNET、无存储权限、单一受信 origin，且只授到用户选中的 Uri。
        s.allowContentAccess = true
        // SAF 不需要 file:// 通道，保持关闭。
        s.allowFileAccessFromFileURLs = false
        s.allowUniversalAccessFromFileURLs = false
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setGeolocationEnabled(false)
        s.mediaPlaybackRequiresUserGesture = false  // 提示音/白噪音前置
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.textZoom = 100                            // 网页自带字号系统，禁止系统字号二次放大
        s.setSupportZoom(false)
        s.setBuiltInZoomControls(false)
        s.setDisplayZoomControls(false)
        s.useWideViewPort = true
        s.loadWithOverviewMode = false
        s.setSupportMultipleWindows(false)
        s.cacheMode = WebSettings.LOAD_DEFAULT

        // 网页自己声明 color-scheme: light dark 并自带深色样式。
        // 关掉 WebView 的算法压暗，否则深色模式下会被"二次压暗"，颜色就不是网页那个颜色了。
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            try {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
            } catch (e: Exception) {
                Log.w(TAG, "disable algorithmic darkening failed", e)
            }
        }
    }

    /**
     * 资产装载：`https://appassets.androidplatform.net/index.html` → `assets/web/index.html`。
     *
     * `addPathHandler("/")` 表示该域下所有路径都交给这一个 handler，
     * MIME 表就在 handler 里（见 MimeAssetHandler）。
     */
    private fun buildAssetLoader(): WebViewAssetLoader =
        WebViewAssetLoader.Builder()
            .setDomain(State.DOMAIN)
            .addPathHandler("/", MimeAssetHandler(activity.assets, "web"))
            .build()

    /**
     * 安装桥。origin 用 State.ORIGIN，不写字面量 —— 三处（Loader / 桥 / 注入）必须同源。
     */
    fun installBridge(listener: WebViewCompat.WebMessageListener) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.e(TAG, "WebView 不支持 addWebMessageListener（需 WebView >= 88），桥不可用")
            return
        }
        try {
            WebViewCompat.addWebMessageListener(
                webView,
                State.BRIDGE_NAME,
                setOf(State.ORIGIN),
                listener
            )
        } catch (e: Exception) {
            Log.e(TAG, "addWebMessageListener failed", e)
        }
    }

    /**
     * 注入 shim。**必须在 loadUrl 之前调用**。
     *
     * @return true = 走 documentStart；false = 已退回 onPageStarted（有风险，会在日志里标明）
     */
    fun installShim(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Log.w(
                TAG,
                "DOCUMENT_START_SCRIPT 不支持（WebView < 83），退回 onPageStarted 注入：" +
                    "可能晚于页面脚本执行，Notification 能力探测可能仍判为不支持"
            )
            return false
        }
        return try {
            docStartHandler = WebViewCompat.addDocumentStartJavaScript(
                webView,
                Shim.JS,
                setOf(State.ORIGIN)
            )
            shimAtDocumentStart = true
            true
        } catch (e: Exception) {
            Log.e(TAG, "addDocumentStartJavaScript failed，退回 onPageStarted", e)
            false
        }
    }

    /** 加载入口。URL 必须带 `/index.html`（写 `/` 会映射到目录 → 404 白屏）。 */
    fun loadApp() {
        webView.loadUrl(State.BASE_URL)
    }

    fun reload() {
        webView.reload()
    }

    /** 主线程 eval，不等结果。 */
    fun eval(js: String) {
        activity.runOnUiThread {
            try {
                webView.evaluateJavascript(js, null)
            } catch (e: Exception) {
                Log.w(TAG, "eval failed: $js", e)
            }
        }
    }

    /** 主线程 eval 并回传结果（返回的是 JSON 编码后的字符串，带引号）。 */
    fun evalWithResult(js: String, onResult: (String?) -> Unit) {
        activity.runOnUiThread {
            try {
                webView.evaluateJavascript(js) { value -> onResult(value) }
            } catch (e: Exception) {
                Log.w(TAG, "evalWithResult failed", e)
                onResult(null)
            }
        }
    }

    fun destroy() {
        docStartHandler?.remove()
        docStartHandler = null
        try {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        } catch (e: Exception) {
            Log.w(TAG, "destroy failed", e)
        }
    }

    private inner class BottleClient : WebViewClient() {

        /**
         * 所有 appassets 请求本地解答，绝不触网。
         * 返回 null 会让 WebView 真的去发网络请求 → 因未声明 INTERNET 得到 ERR_ACCESS_DENIED。
         * 这个"可见的失败"是刻意的（设计 §2）：宁可报错，也不要静默白屏。
         */
        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest
        ): WebResourceResponse? {
            val url = request.url
            if (url.host != State.DOMAIN) return null
            val loader = assetLoader ?: return null
            val res = loader.shouldInterceptRequest(url)
            if (res == null) {
                Log.e(TAG, "asset miss (will hit network): ${url.path}")
            }
            return res
        }

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            val url = request.url
            if (url.host == State.DOMAIN) {
                // App 内部只允许这一个 origin（页面本身用 replaceState，不产生导航）
                return false
            }
            openExternally(url)
            return true // 外面已经处理掉，WebView 内不加载
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            // 兜底：不支持 documentStart 时只能在旧文档上下文里注入（风险已记录在 installShim 日志）
            if (!shimAtDocumentStart) {
                view.evaluateJavascript(Shim.JS, null)
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            // 断言：shim 到底进去没有。没有就明确报错，不弹自制错误页（设计 §4.5）。
            //
            // ⚠️ 旧版只断言 `bridge=1`，而桥是原生装的、与 shim 死活无关 ——
            // P0 那次 shim 全程是死代码，这里照样打印 "page ready: bridge=1 ..."，一路绿灯。
            // 现在五项必须同时成立，其中 `shim=1`（__bottleShimV1）才是 shim 的自证。
            view.evaluateJavascript(READY_JS) { r ->
                if (isPageReady(r)) {
                    Log.i(TAG, "page ready: $r")
                } else {
                    Log.e(TAG, "shim missing: $r")
                }
            }
            if (!shimAtDocumentStart) {
                view.evaluateJavascript(Shim.JS, null)
            }
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            // 只记诊断，不改界面
            Log.e(TAG, "onReceivedError ${request.url} : ${error.errorCode} ${error.description}")
        }

        override fun onReceivedHttpError(
            view: WebView,
            request: WebResourceRequest,
            errorResponse: WebResourceResponse
        ) {
            Log.e(TAG, "onReceivedHttpError ${request.url} : ${errorResponse.statusCode}")
        }
    }

    private fun openExternally(uri: Uri) {
        val scheme = uri.scheme?.lowercase() ?: return
        if (scheme != "http" && scheme != "https") {
            // intent:// / tel: / mailto: 一律丢弃（设计 §4.5）
            Log.i(TAG, "drop non-http scheme: $uri")
            return
        }
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "no browser for $uri")
        }
    }

    /**
     * 资产处理器：`assets/web/<path>` → WebResourceResponse，并**显式给 MIME**（设计 §2，必需不是优化）。
     *
     * `.js` 若被返回成 `application/octet-stream`，`type="module"` 整包不执行 →
     * 界面全白 + 控制台只有一条 module 错误 —— 极易误诊成"asset 没拷对"。
     *
     * 为什么不用 `WebViewAssetLoader.AssetsPathHandler`：
     * webkit 1.12 的公开构造函数只剩 `AssetsPathHandler(Context)`，它只能从 assets **根目录**
     * 取文件；而我们要的是 `assets/web/` 子目录。原来那个 `(Context, String)` 构造已不在公开 API
     * （设计 §8.2 里的写法在当前 webkit 上编不过）。这里自己实现 PathHandler，
     * 顺便把 MIME 表合并进来，少一层包装、少一处可能猜错的地方。
     */
    private class MimeAssetHandler(
        private val assets: AssetManager,
        private val root: String
    ) : WebViewAssetLoader.PathHandler {

        override fun handle(path: String): WebResourceResponse? {
            var rel = path
            val q = rel.indexOf('?')
            if (q >= 0) rel = rel.substring(0, q)
            val hash = rel.indexOf('#')
            if (hash >= 0) rel = rel.substring(0, hash)
            rel = rel.trimStart('/')

            // 目录本身（空路径 / 结尾斜杠）必然取不到文件，直接 404：
            // 这也是"加载 URL 写成 / 而不是 /index.html 就白屏"的同一个原因。
            if (rel.isEmpty() || rel.endsWith("/") || rel.contains("..")) {
                Log.e(TAG, "bad asset path: $path")
                return notFound()
            }

            val assetPath = if (root.isEmpty()) rel else "$root/$rel"
            val stream = try {
                assets.open(assetPath)
            } catch (e: IOException) {
                Log.e(TAG, "asset not found: $assetPath")
                return notFound()
            }

            val mime = mimeFor(rel)
            val encoding = if (mime.startsWith("text/") ||
                mime == MIME_JSON || mime == MIME_MANIFEST
            ) "utf-8" else null
            return WebResourceResponse(mime, encoding, stream)
        }

        /** 404 而非 null：返回 null 会让 WebView 真的去发网络请求（无 INTERNET → 一串看不懂的错）。 */
        private fun notFound(): WebResourceResponse = WebResourceResponse(
            "text/plain",
            "utf-8",
            404,
            "Not Found",
            HashMap(),
            ByteArrayInputStream(ByteArray(0))
        )

        private fun mimeFor(path: String): String {
            val ext = path.substringAfterLast('.', "").lowercase()
            return when (ext) {
                "js", "mjs" -> MIME_JS
                "css" -> "text/css"
                "html", "htm" -> "text/html"
                "json", "map" -> MIME_JSON
                "webmanifest" -> MIME_MANIFEST
                "woff2" -> "font/woff2"
                "woff" -> "font/woff"
                "ttf" -> "font/ttf"
                "otf" -> "font/otf"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "gif" -> "image/gif"
                "svg" -> "image/svg+xml"
                "ico" -> "image/x-icon"
                "txt" -> "text/plain"
                "mp3" -> "audio/mpeg"
                "m4a" -> "audio/mp4"
                "wav" -> "audio/wav"
                else -> URLConnection.guessContentTypeFromName(path)
                    ?: "application/octet-stream"
            }
        }
    }

    companion object {
        private const val TAG = "BottleHost"
        private const val MIME_JS = "text/javascript"
        private const val MIME_JSON = "application/json"
        private const val MIME_MANIFEST = "application/manifest+json"

        /** 网页首屏底色 #FBF6EF（暖米白）。仅用于首绘前的底色，不参与任何界面绘制。 */
        private val PAGE_BG = Color.parseColor("#FBF6EF")

        /**
         * 页面就绪自检：**五项全中才算 ready**。
         *
         * 每一项都有明确的"坏了会怎样"：
         * - `bridge=1`   桥在（否则 shim 只能降级，到点不响）
         * - `timer=object` 网页已把 timerState 挂上（否则上报无从谈起）
         * - `notif=function` shim 接管了 Notification（否则网页内容"不支持"）
         * - `back=function` 返回键阶梯存在（否则只能直接退出 App）
         * - `shim=1`     shim 自证标记（`__bottleShimV1 === true`，这是 P0 的验证锚点）
         *
         * 只用 eval 返回值里的定长片段拼出来，不做 JSON 解析（evaluateJavascript 返回的是
         * 带引号的 JSON 字符串，含引号的判断很容易被转义坑到）。
         */
        private val READY_JS: String =
            "(function(){var w=window;var b=w." + State.BRIDGE_NAME + "?1:0;" +
                "var t=typeof w.timerState;var n=typeof w.Notification;" +
                "var k=typeof w.__bottleBack;" +
                "var s=(w.__bottleShimV1===true)?1:0;" +
                "return 'bridge='+b+' timer='+t+' notif='+n+' back='+k+' shim='+s})()"

        /** 五项断言全部命中才返回 true。任一项缺失都要 `Log.e("BottleHost", "shim missing: ...")`。 */
        private fun isPageReady(raw: String?): Boolean {
            if (raw == null) return false
            return raw.contains("bridge=1") &&
                raw.contains("timer=object") &&
                raw.contains("notif=function") &&
                raw.contains("back=function") &&
                raw.contains("shim=1")
        }
    }
}
