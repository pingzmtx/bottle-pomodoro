package im.bottle.focus

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.util.concurrent.Executors

/**
 * 二级页：选择要拦截的应用（多选）。
 *
 * ## 列应用的方式（设计 B3）
 *
 * `<queries>` 声明 `MAIN/LAUNCHER` → `queryIntentActivities` 全量列，**不用
 * `QUERY_ALL_PACKAGES`**：声明了 queries 之后这些包对本 App 可见，Play 不把 `<queries>`
 * 当敏感权限；`QUERY_ALL_PACKAGES` 才是需要申报的高敏权限。
 *
 * ## 三个细节
 *
 * - **已选优先排序**：打开页面时已选应用排在最前（用户是来核对/追加的，不是从头找）；
 * - **异步图标 + tag 比对**：图标加载在线程池里做，回主线程后先比对 `imageView.tag`
 *   与包名 —— 否则列表被搜索过滤后，回来的图标会贴到错的行上（最经典的错位 bug）；
 * - **选中即写 prefs**：切一格就落盘一次，用户按返回键 / 被系统杀掉都不会丢。
 *   刻意**不**在勾选时重排列表：手指刚点完，那一行突然跳到顶部，人会以为点错了。
 */
class GuardAppsActivity : Activity() {

    /** 一个可选的应用。 */
    private data class AppEntry(val pkg: String, val label: String)

    /** 一行视图 + 它对应的应用（过滤 / 勾选都作用在这一对上）。 */
    private data class Row(
        val entry: AppEntry,
        val wrapper: View,
        val bar: View,
        val switch: Switch
    )

    private lateinit var list: LinearLayout
    private lateinit var countLabel: TextView
    private lateinit var searchInput: EditText
    private lateinit var searchClear: TextView

    private val rows = mutableListOf<Row>()
    private val selected = mutableSetOf<String>()
    private val entries = mutableListOf<AppEntry>()

    private var query = ""

    /** 图标加载：单线程足够（一屏十几个），也不会和主线程抢 CPU。 */
    private val iconExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_guard_apps)

        list = findViewById(R.id.list)
        countLabel = findViewById(R.id.countLabel)
        searchInput = findViewById(R.id.searchInput)
        searchClear = findViewById(R.id.searchClear)

        findViewById<TextView>(R.id.btnBack).setOnClickListener { finish() }
        findViewById<TextView>(R.id.btnDone).setOnClickListener { finish() }

        selected.addAll(State.guardApps(this))

        searchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                query = s?.toString()?.trim().orEmpty()
                searchClear.visibility = if (query.isEmpty()) View.GONE else View.VISIBLE
                applyFilter()
            }
        })
        searchClear.setOnClickListener {
            searchInput.setText("")
            query = ""
            applyFilter()
        }

        loadApps()
    }

    override fun onDestroy() {
        iconExecutor.shutdownNow()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ 加载

    /**
     * 查 `MAIN/LAUNCHER` 全量应用，**排除自己**（自己必须能被点开，否则遮罩点「回到专注」回不来，
     * `GuardRules` 里也有同样的硬放行）。
     */
    private fun loadApps() {
        val pm = packageManager
        Thread {
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val resolved: List<ResolveInfo> = try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
                } else {
                    @Suppress("DEPRECATION")
                    pm.queryIntentActivities(intent, 0)
                }
            } catch (e: Exception) {
                Log.w(TAG, "queryIntentActivities failed", e)
                emptyList()
            }

            val self = packageName
            val seen = HashSet<String>()
            val loaded = ArrayList<AppEntry>(resolved.size)
            for (ri in resolved) {
                val info = ri.activityInfo ?: continue
                val pkg = info.packageName ?: continue
                if (pkg == self || !seen.add(pkg)) continue
                val label = try {
                    ri.loadLabel(pm)?.toString()?.trim().orEmpty().ifEmpty { pkg }
                } catch (e: Exception) {
                    pkg
                }
                loaded.add(AppEntry(pkg, label))
            }
            // 已选优先，其次按名字（中文按 Unicode 序，够用；不做 Collator 是为了零依赖）
            loaded.sortWith(
                compareByDescending<AppEntry> { it.pkg in selected }
                    .thenBy { it.label.lowercase() }
            )

            runOnUiThread {
                entries.clear()
                entries.addAll(loaded)
                buildRows()
                applyFilter()
            }
        }.start()
    }

    private val inflater: LayoutInflater
        get() = LayoutInflater.from(this)

    private fun buildRows() {
        list.removeAllViews()
        rows.clear()
        val density = resources.displayMetrics.density

        for (e in entries) {
            val view = inflater.inflate(R.layout.item_app_choice, list, false)
            val bar = view.findViewById<View>(R.id.selBar)
            val icon = view.findViewById<ImageView>(R.id.icon)
            val name = view.findViewById<TextView>(R.id.name)
            val pkg = view.findViewById<TextView>(R.id.pkg)
            val sw = view.findViewById<Switch>(R.id.sw)

            name.text = e.label
            pkg.text = e.pkg
            bar.visibility = if (e.pkg in selected) View.VISIBLE else View.INVISIBLE
            sw.isChecked = e.pkg in selected

            // 异步图标 + tag 比对（列表过滤后回来的图标不能贴错行）
            icon.tag = e.pkg
            iconExecutor.execute {
                val d: Drawable? = try {
                    packageManager.getApplicationIcon(e.pkg)
                } catch (ex: Exception) {
                    null
                }
                if (d == null) return@execute
                runOnUiThread {
                    if (icon.tag == e.pkg) icon.setImageDrawable(d)
                }
            }

            sw.setOnCheckedChangeListener { _, checked ->
                setSelected(e.pkg, checked, bar)
            }
            // 点整行也能切换（不用精确戳那个小开关）
            view.setOnClickListener { sw.isChecked = !sw.isChecked }

            val wrapper = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(view)
                addView(SettingsUi.divider(this@GuardAppsActivity))
            }
            // 64dp + 1px 分割线，行高与设计一致
            view.layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                (64 * density).toInt()
            )
            list.addView(wrapper, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ))
            rows.add(Row(e, wrapper, bar, sw))
        }
    }

    private fun setSelected(pkg: String, checked: Boolean, bar: View) {
        if (checked) selected.add(pkg) else selected.remove(pkg)
        bar.visibility = if (checked) View.VISIBLE else View.INVISIBLE
        State.markGuardApp(this, pkg, checked) // 立刻落盘（HashSet 拷贝由 State 负责）
        updateCount()
    }

    // ------------------------------------------------------------------ 过滤

    /** 按应用名 / 包名过滤（大小写不敏感）。只切可见性，不重建行、不重载图标。 */
    private fun applyFilter() {
        var visible = 0
        for (r in rows) {
            val hit = query.isEmpty() ||
                r.entry.label.lowercase().contains(query) ||
                r.entry.pkg.lowercase().contains(query)
            r.wrapper.visibility = if (hit) View.VISIBLE else View.GONE
            if (hit) visible++
        }
        if (rows.isEmpty()) {
            countLabel.text = "正在读取应用列表…"
            return
        }
        val base = "已选 ${selected.size} 个"
        countLabel.text = if (query.isEmpty()) {
            "$base · 共 ${rows.size} 个应用"
        } else {
            "$base · 匹配 $visible 个"
        }
    }

    private fun updateCount() {
        applyFilter()
    }

    private fun toast(text: String) {
        runCatching { Toast.makeText(this, text, Toast.LENGTH_SHORT).show() }
            .onFailure { Log.w(TAG, "toast failed: $text", it) }
    }

    companion object {
        private const val TAG = "BottleGuardApps"
    }
}
