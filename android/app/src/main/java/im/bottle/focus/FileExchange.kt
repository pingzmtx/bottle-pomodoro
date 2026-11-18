package im.bottle.focus

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.util.Log
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast
import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONObject
import java.io.OutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * 文件交换：网页的两个「不可能自己完成」的动作，在这里补上。
 *
 * 1. **导入**：网页 `engine_data.js` 的 `importData(event)` 读的是
 *    `<input type="file">` 的 `event.target.files[0]`。WebView 只有在设了
 *    `WebChromeClient` 并实现 `onShowFileChooser` 之后才会弹出选择器 ——
 *    之前宿主一个都没设，所以「导入数据」点了既没反应也不报错。
 *    这里用 SAF（`ACTION_OPEN_DOCUMENT`）选文件，把 `content://` 原样交回网页，
 *    **校验与落库全部由网页自己的 `validateBackup` / `applyBackupData` 完成**，
 *    原生一个字节的数据都不碰（安全边界见架构设计 §1）。
 *
 * 2. **导出**：WebView 不支持 `<a download>` + `blob:`（`DownloadListener` 也收不到
 *    blob:），网页 `downloadExport()` 因此什么都不会落盘，而它的 `exportDone()`
 *    紧接着无条件弹了「已导出」—— 真机上就是"假成功"。
 *    这里用 SAF（`ACTION_CREATE_DOCUMENT`）让用户选位置，再把 shim 转过来的
 *    备份文本**分块**写入。分块不是炫技：单条 WebMessage 塞几 MB JSON 有体积风险，
 *    256K 字符一块既避开体积上限，也让写入有天然的背压（上一块 ack 了才发下一块）。
 *
 * 两条路径都**不新增任何权限**：SAF 是系统授权的，不需要 READ/WRITE_EXTERNAL_STORAGE。
 */
class FileExchange(private val activity: Activity) : WebChromeClient() {

    private val main = Handler(Looper.getMainLooper())

    /** 单线程写盘：保证块序，且不占用主线程（几 MB 写盘会让 UI 卡一下）。 */
    private val writer: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "bottle-file-writer").apply { isDaemon = true }
    }

    /** 网页 `<input type=file>` 的回调。同一时刻只允许一个（重复触发先 cancel 旧的）。 */
    private var pendingChooser: ValueCallback<Array<Uri>>? = null

    /** 已发起 `ACTION_CREATE_DOCUMENT`、还在等用户选位置的导出。 */
    private var pendingExport: PendingExport? = null

    /** 已拿到目标 Uri、正在接收分块的导出会话。 */
    private var session: ExportSession? = null

    private val sessionSeq = AtomicInteger(0)

    // ================================================================== 导入

    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>?,
        fileChooserParams: FileChooserParams?
    ): Boolean {
        if (filePathCallback == null) {
            Log.w(TAG, "onShowFileChooser without callback, let WebView default decide")
            return false
        }

        // ★ 只保留一个 pending。上一次还没回来（用户切走 / 网页连续触发）又来了新的，
        //   必须先把旧的回应掉：不回应等于把 WebView 的文件输入永久挂起，之后再点没反应。
        cancelPendingChooser("superseded")

        val multiple = fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = MIME_ANY
            // 网页的 accept=".json" 只影响它自己的展示；这里给系统一份明确的候选类型，
            // 免得部分 ROM 在 */* 下把 .json 灰掉。
            putExtra(Intent.EXTRA_MIME_TYPES, IMPORT_MIME_TYPES)
            if (multiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        pendingChooser = filePathCallback
        return try {
            activity.startActivityForResult(intent, REQ_IMPORT)
            Log.i(TAG, "file chooser opened (multiple=$multiple)")
            true
        } catch (e: Exception) {
            // 不只 catch ActivityNotFoundException：Activity 正在 finishing、SecurityException
            // 等同样会抛。漏掉就留下 pendingChooser，导入从此永久点不动 —— 而且没有报错可查。
            Log.e(TAG, "startActivityForResult(ACTION_OPEN_DOCUMENT) failed", e)
            pendingChooser = null
            filePathCallback.onReceiveValue(null)
            toast("导入失败：无法打开文件选择器")
            true
        }
    }

    /**
     * 选择器回来。
     *
     * ★ 取消（`RESULT_CANCELED`）必须 `onReceiveValue(null)`。
     * 这是这个 API 最常见的坑：不回调 → 网页的 file input 停在"打开中" →
     * 再点「导入数据」永远没反应，而且没有任何错误可查。
     */
    private fun deliverImport(resultCode: Int, data: Intent?) {
        val cb = pendingChooser
        pendingChooser = null
        if (cb == null) {
            Log.w(TAG, "import result without pending callback (already cancelled?)")
            return
        }

        val uris: Array<Uri>? = if (resultCode != Activity.RESULT_OK) {
            null
        } else {
            val clip = data?.clipData
            when {
                clip != null && clip.itemCount > 0 ->
                    Array(clip.itemCount) { clip.getItemAt(it).uri }
                data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
        }

        // uris == null 时即 onReceiveValue(null)：网页 importData() 的 `if (!file) return;` 会正常退出
        cb.onReceiveValue(uris)
        Log.i(TAG, "import result: code=$resultCode picked=${uris?.size ?: 0}")
    }

    // ================================================================== 导出

    /**
     * `file.export.begin`：让用户选保存位置。
     *
     * 应答是**异步**的（用户在文件管理器里可能要逛很久），所以这里只登记 pending，
     * 真正回包在 [onActivityResult] 里。
     */
    fun beginExport(
        id: String,
        name: String,
        mime: String,
        proxy: JavaScriptReplyProxy
    ) {
        // ★ 闸门一：用户还停在「另存为」对话框（上一个 begin 未应答）。
        //   这里必须「拒」，不能「顶掉」：顶掉会拉起第二个保存框，而旧 cmdId 再没人应答，
        //   shim 的 pending[id] 就永久泄漏（QA 实测 保存框=2、b1 应答数=0）。
        val inFlight = pendingExport
        if (inFlight != null) {
            Log.w(TAG, "begin rejected: previous export still pending (${inFlight.id})")
            toast("上一次导出还没结束")
            BridgeReply.err(id, E_STATE_CONFLICT, proxy)
            return
        }

        // ★ 闸门二：上一笔已经进了写盘阶段。它那条 begin 早已被应答（回了 sessionId），
        //   所以这里只能作废会话、不能再补一条应答，否则同一个 cmdId 会收两次包。
        if (session != null) {
            Log.w(TAG, "begin supersedes in-progress export session")
            abortCurrent("superseded")
        }

        val safeName = sanitizeFileName(name)
        // mime 跟着 blob 来（CSV → text/csv）；空值时按备份 JSON 兜底，免得 Intent 没有 type
        val safeMime = if (mime.isBlank()) MIME_JSON else mime
        pendingExport = PendingExport(id, safeName, proxy)

        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = safeMime
            putExtra(Intent.EXTRA_TITLE, safeName)
        }
        try {
            activity.startActivityForResult(intent, REQ_EXPORT)
            Log.i(TAG, "export picker opened for $safeName")
        } catch (e: Exception) {
            // 同导入：finishing / SecurityException 都会走到这里，必须清状态且回包，
            // 否则 pendingExport 残留 → 之后再点导出直接被闸门拒掉，永远导不出来。
            Log.e(TAG, "startActivityForResult(ACTION_CREATE_DOCUMENT) failed", e)
            pendingExport = null
            toast("导出失败：无法打开保存对话框")
            BridgeReply.err(id, E_INTERNAL, proxy)
        }
    }

    private fun onExportPicked(resultCode: Int, data: Intent?) {
        val p = pendingExport
        pendingExport = null
        if (p == null) {
            Log.w(TAG, "export result without pending begin")
            return
        }

        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            // ★ 取消必须明确告知。网页的 exportDone() 已经无条件弹过「已导出」，
            //   不补这一句，用户就会以为文件存下来了（这就是要修的那个"假成功"）。
            Log.i(TAG, "export cancelled by user")
            toast("已取消保存，备份未写入")
            BridgeReply.ok(
                p.id,
                JSONObject().put("saved", false).put("cancelled", true),
                p.proxy
            )
            return
        }

        val out = try {
            activity.contentResolver.openOutputStream(uri, "wt")
        } catch (e: Exception) {
            Log.e(TAG, "openOutputStream failed: $uri", e)
            null
        }
        if (out == null) {
            toast("导出失败：无法写入所选位置")
            BridgeReply.err(p.id, E_INTERNAL, p.proxy)
            return
        }

        val sid = "x" + sessionSeq.incrementAndGet() + "-" + System.currentTimeMillis().toString(36)
        session = ExportSession(sid, p.name, uri, out)
        BridgeReply.ok(
            p.id,
            JSONObject()
                .put("saved", true)
                .put("cancelled", false)
                .put("sessionId", sid)
                .put("name", p.name),
            p.proxy
        )
        Log.i(TAG, "export target ready: ${p.name} -> $uri ($sid)")
    }

    /** `file.export.chunk`：写一块。ack 在**真正写完之后**才发，天然形成背压。 */
    fun writeChunk(id: String, sessionId: String, text: String, proxy: JavaScriptReplyProxy) {
        val s = session
        if (s == null || s.id != sessionId) {
            Log.w(TAG, "chunk for unknown session: $sessionId")
            BridgeReply.err(id, E_STATE_CONFLICT, proxy)
            return
        }
        writer.execute {
            try {
                s.write(text)
                BridgeReply.ok(id, JSONObject().put("bytes", s.bytes), proxy)
            } catch (e: Exception) {
                Log.e(TAG, "write chunk failed after ${s.bytes}B", e)
                abortCurrent("write failed")
                BridgeReply.err(id, E_INTERNAL, proxy)
            }
        }
    }

    /** `file.export.end`：flush + close，成功了才回 `saved=true`。 */
    fun endExport(id: String, sessionId: String, proxy: JavaScriptReplyProxy) {
        val s = session
        if (s == null || s.id != sessionId) {
            Log.w(TAG, "end for unknown session: $sessionId")
            BridgeReply.err(id, E_STATE_CONFLICT, proxy)
            return
        }
        session = null
        writer.execute {
            try {
                s.close()
                Log.i(TAG, "export saved: ${s.name} ${s.bytes}B -> ${s.uri}")
                toast("已保存 " + s.name)
                BridgeReply.ok(
                    id,
                    JSONObject()
                        .put("saved", true)
                        .put("name", s.name)
                        .put("bytes", s.bytes)
                        .put("uri", s.uri.toString()),
                    proxy
                )
            } catch (e: Exception) {
                Log.e(TAG, "close failed after ${s.bytes}B", e)
                s.closeQuietly()
                deleteQuietly(s.uri)
                toast("导出失败：写入过程中出错")
                BridgeReply.err(id, E_INTERNAL, proxy)
            }
        }
    }

    /** `file.export.abort`：网页侧读块失败时收尾，别把半截文件留在用户目录里。 */
    fun abortExport(id: String, sessionId: String, proxy: JavaScriptReplyProxy) {
        val s = session
        if (s == null || s.id != sessionId) {
            // 已经结束了（重复 abort）：当成功处理，避免网页把"收尾"变成一次报错
            BridgeReply.ok(id, JSONObject().put("aborted", true), proxy)
            return
        }
        session = null
        writer.execute {
            s.closeQuietly()
            deleteQuietly(s.uri)
            Log.i(TAG, "export aborted: ${s.name} (${s.bytes}B discarded)")
            BridgeReply.ok(id, JSONObject().put("aborted", true), proxy)
        }
    }

    // ============================================================== 生命周期

    /**
     * @return true = 这个 requestCode 归我处理（调用方不必再往 super 递）
     */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        return when (requestCode) {
            REQ_IMPORT -> {
                deliverImport(resultCode, data)
                true
            }
            REQ_EXPORT -> {
                onExportPicked(resultCode, data)
                true
            }
            else -> false
        }
    }

    /** Activity 销毁：回调与流都不能带着走（否则下次进来点导入还是没反应）。 */
    fun release() {
        cancelPendingChooser("release")
        pendingExport = null
        abortCurrent("release")
        writer.shutdown()
    }

    private fun cancelPendingChooser(reason: String) {
        val cb = pendingChooser ?: return
        pendingChooser = null
        Log.w(TAG, "cancel pending file chooser: $reason")
        try {
            cb.onReceiveValue(null)
        } catch (e: Exception) {
            Log.w(TAG, "cancel pending chooser failed", e)
        }
    }

    private fun abortCurrent(reason: String) {
        val s = session ?: return
        session = null
        Log.w(TAG, "abort export session ${s.id}: $reason")
        writer.execute {
            s.closeQuietly()
            deleteQuietly(s.uri)
        }
    }

    private fun deleteQuietly(uri: Uri) {
        try {
            DocumentsContract.deleteDocument(activity.contentResolver, uri)
        } catch (e: Exception) {
            // 不是 DocumentsProvider 的 Uri、或用户已删除：都无需处理
            Log.w(TAG, "delete partially written document skipped: $uri", e)
        }
    }

    private fun toast(message: String) {
        val ctx = activity.applicationContext
        if (Looper.myLooper() == Looper.getMainLooper()) {
            Toast.makeText(ctx, message, Toast.LENGTH_LONG).show()
        } else {
            main.post { Toast.makeText(ctx, message, Toast.LENGTH_LONG).show() }
        }
    }

    // ================================================================== 数据类

    private class PendingExport(
        val id: String,
        val name: String,
        val proxy: JavaScriptReplyProxy
    )

    private class ExportSession(
        val id: String,
        val name: String,
        val uri: Uri,
        private val out: OutputStream
    ) {
        var bytes: Long = 0L
            private set

        fun write(text: String) {
            val data = text.toByteArray(Charsets.UTF_8)
            out.write(data)
            bytes += data.size
        }

        fun close() {
            out.flush()
            out.close()
        }

        fun closeQuietly() {
            try {
                out.close()
            } catch (e: Exception) {
                Log.w(TAG, "close quietly failed", e)
            }
        }
    }

    companion object {
        private const val TAG = "BottleFiles"

        /** 避开 MainActivity 的 REQ_NOTIFICATION = 9001。 */
        private const val REQ_IMPORT = 9002
        private const val REQ_EXPORT = 9003

        private const val MIME_ANY = "*/*"
        private const val MIME_JSON = "application/json"
        private const val DEFAULT_NAME = "tomato_backup.json"
        private const val MAX_NAME = 120
        /** 超过这个长度的「扩展名」按无扩展名处理（防止 take() 传入负数）。 */
        private const val MAX_EXT = 16

        private const val E_INTERNAL = "E_INTERNAL"
        private const val E_STATE_CONFLICT = "E_STATE_CONFLICT"

        /**
         * `EXTRA_MIME_TYPES`：json 与文本都给上。
         * 不加 `application/octet-stream` —— 那会让「任意类型」形同虚设，用户更容易选错文件。
         */
        private val IMPORT_MIME_TYPES = arrayOf(MIME_JSON, "text/*")

        /**
         * 文件名兜底：只取最后一段、剔掉路径分隔与控制字符。
         * 名字最终还会经 `EXTRA_TITLE` 交给系统，系统自己也会再校验一次。
         *
         * ★ 先拆扩展名、再截主体：以前是「先截 120 再判断有没有 `.`」，
         * 于是 `"x"*200 + ".csv"` 截完成一堆 x、扩展名没了，又被补成 `.json`。
         */
        private fun sanitizeFileName(raw: String): String {
            val base = raw.substringAfterLast('/').substringAfterLast('\\')
                .replace(Regex("[\\x00-\\x1F<>:\"|?*]"), "_")
                .trim()
            if (base.isEmpty() || base == "." || base == "..") return DEFAULT_NAME

            val dot = base.lastIndexOf('.')
            // 超过 MAX_EXT 的「扩展名」不是扩展名（`a.` + 300 个字符），按无扩展名处理
            val ext = if (dot > 0 && dot < base.length - 1 && base.length - dot <= MAX_EXT) {
                base.substring(dot)
            } else {
                ""
            }
            val suffix = if (ext.isEmpty()) ".json" else ext
            var body = if (ext.isEmpty()) base else base.substring(0, dot)
            val maxBody = MAX_NAME - suffix.length
            if (body.length > maxBody) body = body.take(maxBody)
            body = body.trimEnd('.', ' ')
            if (body.isEmpty()) return DEFAULT_NAME
            return body + suffix
        }
    }
}
