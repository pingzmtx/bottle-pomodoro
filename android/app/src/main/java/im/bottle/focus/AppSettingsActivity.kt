package im.bottle.focus

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * 一级设置页：应用锁 / 小窗 / 通知 / 关于。
 *
 * ## 为什么是原生页
 *
 * 网页是唯一真源，但"无障碍授权 / 悬浮窗授权 / 深度锁机"这三件事**只有系统页能改**，
 * 而它们的状态又必须能在 App 内一眼看到。做成原生页而不是塞进网页：
 * 网页里没有位置（全屏 WebView 强插一个按钮会压住布局，设计 B1b），
 * 而且这些开关与网页状态无关（不能写 `localStorage`，也不该写）。
 *
 * ## 不接门队列（设计 B5）
 *
 * 门队列要防的是"同一帧连跳两张系统页"，那是 `MainActivity` 引导期的问题。
 * 设置页的跳转都是用户单发点击、一次一张，而且此时 MainActivity 已经 `onPause`，
 * 不会并发。这里**自己** `startActivity`，回来自己在 `onResume` 复查 —— 硬接反而多一个
 * busy 泄漏面。
 *
 * ## 深色模式
 *
 * 选的是**资源限定符**（`values-night`）而不是运行时判断：系统切深色 → `uiMode` 变化 →
 * Activity 重建 → 自动取到深色配色，一行代码都不用写；运行时判断要在 20+ 处手动 setColor，
 * 新增一行就漏一处。代价是切主题会重建本页（无输入态，可接受）。
 */
class AppSettingsActivity : Activity() {

    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)
        content = findViewById(R.id.content)
        findViewById<TextView>(R.id.btnBack).setOnClickListener { finish() }
    }

    override fun onResume() {
        super.onResume()
        // 内部 launcher / IME 列表可能变了（设置页也是最常被打开的地方，顺手刷一次）
        Guard.invalidateWhitelist()
        rebuild()
    }

    /** 整页重建：状态都是 prefs 里的事实，重建最不容易出错（不维护任何 ViewHolder 缓存）。 */
    private fun rebuild() {
        content.removeAllViews()
        buildGuardSection()
        buildBubbleSection()
        buildNotifySection()
        buildAboutSection()
    }

    // ---------------------------------------------------------------- 应用锁

    private fun buildGuardSection() {
        content.addView(SettingsUi.sectionTitle(this, "应用锁"))

        val card = SettingsUi.card(this)
        card.addView(
            SettingsUi.switchRow(
                this,
                title = "应用锁",
                desc = "专注时把你打开的分心应用拉回桌面。休息和暂停时不拦。",
                checked = State.guardEnabled(this),
                onChecked = { on -> onGuardToggled(on) }
            )
        )

        val serviceOn = Guard.serviceEnabled(this)
        card.addView(
            SettingsUi.valueRow(
                this,
                title = "无障碍服务",
                value = if (serviceOn) "已开启" else "未开启",
                desc = if (serviceOn) "服务在线，应用锁可正常拦截" else "应用锁必须开启它才会生效",
                onClick = { openAccessibilitySettings() }
            )
        )

        val count = State.guardApps(this).size
        card.addView(
            SettingsUi.valueRow(
                this,
                title = "选择要拦截的应用",
                value = if (count == 0) "未选择" else "$count 个应用",
                desc = if (count == 0) "还没选应用时应用锁不会拦任何东西" else "已选的应用在专注时会被打回",
                onClick = {
                    runCatching { startActivity(Intent(this, GuardAppsActivity::class.java)) }
                        .onFailure { Log.w(TAG, "open guard apps failed", it) }
                }
            )
        )

        card.addView(
            SettingsUi.switchRow(
                this,
                title = "深度锁机（屏幕固定）",
                desc = "把瓶子钉在前台，切不出去。可与应用锁叠加；锁机生效时应用锁自动让位。",
                checked = LockGuard.isEnabled(this),
                onChecked = { on -> LockGuard.setEnabled(this, on) },
                showDivider = false
            )
        )
        content.addView(card)
        content.addView(
            SettingsUi.footnote(
                this,
                "开启路径：小米「设置 → 更多设置 → 无障碍 → 已下载的应用」，" +
                    "华为「设置 → 辅助功能 → 无障碍」，OPPO/vivo 类似。\n" +
                    accessibilityExtraHint()
            )
        )
    }

    /** Android 13 侧载安装后无障碍页会灰掉（「受限制的设置」），只有"跳了没生效"这个信号能发现。 */
    private fun accessibilityExtraHint(): String =
        if (GuardRules.shouldShowRestrictedHint(State.guardAskCount(this))) {
            "如果上面的开关是灰的、点不动：系统设置 → 应用 → 瓶子专注 → 右上角 ⋮ → " +
                "「允许受限制的设置」，然后再回来开启。"
        } else {
            "服务被系统清理掉后应用锁会静默失效，回 App 时会提示一次。"
        }

    private fun onGuardToggled(on: Boolean) {
        State.setGuardEnabled(this, on)
        if (!on) {
            // 关掉就立刻收工，别让用户看到"关掉了还在拦"
            Guard.clearActive(this)
            toast("应用锁已关闭")
            refreshSoon()
            return
        }
        if (Guard.serviceEnabled(this)) {
            toast("应用锁已开启")
        } else {
            toast("还需要开启无障碍服务才会生效")
            openAccessibilitySettings()
        }
        refreshSoon()
    }

    /**
     * 重建页面。
     *
     * ⚠️ 必须 post 一帧再重建：调用点都在 `Switch` 的 `onCheckedChange` 回调里，
     * 当场 `removeAllViews()` 会把"正在派发回调的那个 View"从树上摘掉，
     * 个别 ROM 上会看到开关自己又弹回去（视觉上像"点了没生效"）。
     */
    private fun refreshSoon() {
        content.post { rebuild() }
    }

    /**
     * 跳系统无障碍设置页。
     *
     * 只用标准 action，失败退 `ACTION_SETTINGS`；**不硬编码** ROM 专用的 Activity 类名
     * —— 那些类名随 ROM 版本漂移，`ActivityNotFoundException` 概率高、维护成本也高，
     * 文案（见 [accessibilityExtraHint]）比代码更能兜住差异（设计 A6）。
     */
    private fun openAccessibilitySettings() {
        State.bumpGuardAskCount(this)
        val jumped = try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            true
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "no accessibility settings page, fallback to settings", e)
            false
        } catch (e: Exception) {
            Log.w(TAG, "open accessibility settings failed", e)
            false
        }
        if (jumped) return
        runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
            .onFailure { toast("这台设备打不开设置页，请手动到系统设置里找「无障碍」") }
    }

    // ---------------------------------------------------------------- 小窗

    private fun buildBubbleSection() {
        content.addView(SettingsUi.sectionTitle(this, "小窗"))

        val card = SettingsUi.card(this)
        card.addView(
            SettingsUi.switchRow(
                this,
                title = "显示任务名",
                desc = "小窗左侧显示当前任务名；关掉后收窄到 96dp，只显示时间。",
                checked = State.bubbleShowTaskName(this),
                onChecked = { on -> State.setBubbleShowTaskName(this, on) }
            )
        )
        val canDraw = FloatingBubble.canDraw(this)
        card.addView(
            SettingsUi.valueRow(
                this,
                title = "悬浮窗权限",
                value = if (canDraw) "已授权" else "未授权",
                desc = "计时中的小窗需要它；不给也不影响计时与通知",
                onClick = { if (!canDraw) openOverlaySettings() else toast("已授权，无需操作") },
                showDivider = false
            )
        )
        content.addView(card)
    }

    private fun openOverlaySettings() {
        try {
            startActivity(
                Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            )
        } catch (e: Exception) {
            Log.w(TAG, "open overlay settings failed", e)
            toast("这台设备没有悬浮窗授权页")
        }
    }

    // ---------------------------------------------------------------- 通知

    private fun buildNotifySection() {
        content.addView(SettingsUi.sectionTitle(this, "通知"))

        val actions = State.notifyActions(this)
        val card = SettingsUi.card(this)
        card.addView(
            SettingsUi.switchRow(
                this,
                title = "通知栏「小窗」按钮",
                desc = "计时中点一下就显示 / 恢复小窗",
                checked = "bubble" in actions,
                onChecked = { on ->
                    State.markNotifyAction(this, "bubble", on)
                    Notifications.refreshOngoing(this)
                }
            )
        )
        card.addView(
            SettingsUi.switchRow(
                this,
                title = "通知栏「设置」按钮",
                desc = "没有悬浮窗权限时，用它顶替「小窗」的位置",
                checked = "settings" in actions,
                onChecked = { on ->
                    State.markNotifyAction(this, "settings", on)
                    Notifications.refreshOngoing(this)
                }
            )
        )
        card.addView(
            SettingsUi.valueRow(
                this,
                title = "通知栏「锁机」按钮",
                value = "常驻",
                desc = "屏幕固定期间通知栏不可见，返回键长按 1.5 秒也能解",
                showDivider = false
            )
        )
        content.addView(card)
    }

    // ---------------------------------------------------------------- 关于

    private fun buildAboutSection() {
        content.addView(SettingsUi.sectionTitle(this, "关于"))

        val card = SettingsUi.card(this)
        card.addView(
            SettingsUi.valueRow(
                this,
                title = "应用版本",
                value = "${BuildConfig.VERSION_NAME}(${BuildConfig.VERSION_CODE})"
            )
        )
        card.addView(
            SettingsUi.valueRow(
                this,
                title = "网页版本",
                value = State.readWebVersion(this)
            )
        )
        card.addView(
            SettingsUi.valueRow(
                this,
                title = "数据目录",
                value = filesDir.name,
                desc = "长按显示完整路径（报障时贴它）",
                onClick = null,
                showDivider = false,
                onLongClick = { toast(filesDir.absolutePath) }
            )
        )
        content.addView(card)
        content.addView(
            SettingsUi.footnote(
                this,
                "应用锁只读取前台应用的包名，不读取任何窗口内容，也不联网。"
            )
        )
    }

    private fun toast(text: String) {
        runCatching { Toast.makeText(this, text, Toast.LENGTH_SHORT).show() }
            .onFailure { Log.w(TAG, "toast failed: $text", it) }
    }

    companion object {
        private const val TAG = "BottleSettings"
    }
}
