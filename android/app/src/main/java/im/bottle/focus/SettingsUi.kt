package im.bottle.focus

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.CompoundButton
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView

/**
 * 设置页的行工厂（设计 B2：**纯 framework View**，不引 appcompat / androidx.preference）。
 *
 * 为什么手搭而不是 `PreferenceFragmentCompat`：它要求 AppCompat/MaterialComponents 主题，
 * 与现有的 `android.app.Activity` + `android:Theme.Material.Light.NoActionBar` 直接冲突
 * （inflate 期就崩），还会带进 appcompat + preference + recyclerview ≈ 1.5MB。
 * 现在整个 APK 只有两个依赖，不该为几张设置行破这条线。
 *
 * 视觉口径（三页共用，改一处三页一起变）：
 * - 白/深卡片、圆角 12dp；
 * - 行高 56dp，左右内边距 16dp；
 * - 分割线只画在内缩进里（leftMargin 16dp），不吃满整行；
 * - 分组标题 12sp 灰字、分组下方留 8dp。
 */
object SettingsUi {

    fun dp(ctx: Context, value: Int): Int =
        (value * ctx.resources.displayMetrics.density).toInt()

    /** 分组标题（小字灰色，如「应用锁」「小窗」「通知」「关于」）。 */
    fun sectionTitle(ctx: Context, text: String): TextView = TextView(ctx).apply {
        this.text = text
        setTextColor(ctx.getColor(R.color.settings_text_dim))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        gravity = Gravity.CENTER_VERTICAL
        val lp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        lp.topMargin = dp(ctx, 18)
        lp.bottomMargin = dp(ctx, 8)
        lp.leftMargin = dp(ctx, 4)
        layoutParams = lp
    }

    /** 一张圆角卡片（多行装进来，行之间由 [divider] 分隔）。 */
    fun card(ctx: Context): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(ctx, 12).toFloat()
            setColor(ctx.getColor(R.color.settings_card))
        }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
    }

    /** 行之间的分割线（内缩进 16dp，与文字左边缘对齐）。 */
    fun divider(ctx: Context): View = View(ctx).apply {
        setBackgroundColor(ctx.getColor(R.color.settings_divider))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            (ctx.resources.displayMetrics.density).toInt().coerceAtLeast(1)
        ).apply { leftMargin = dp(ctx, 16) }
    }

    /**
     * 开关行。
     *
     * @param checked   **初值**：先 setChecked 再挂 listener，否则重建页面时会把用户的开关
     *                  当成一次点击再写一遍（幂等但会触发跳系统页，很吵）
     * @param showDivider 是否在这行下面画分割线（最后一行传 false）
     */
    fun switchRow(
        ctx: Context,
        title: String,
        desc: String,
        checked: Boolean,
        onChecked: (Boolean) -> Unit,
        showDivider: Boolean = true
    ): View {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(ctx, 56)
            setPadding(dp(ctx, 16), dp(ctx, 10), dp(ctx, 16), dp(ctx, 10))
        }
        row.addView(labelColumn(ctx, title, desc), LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
        ))

        val switch = Switch(ctx).apply {
            isChecked = checked
            setOnCheckedChangeListener { _: CompoundButton, value: Boolean -> onChecked(value) }
        }
        row.addView(switch, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        if (!showDivider) return row
        val wrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            addView(row)
            addView(divider(ctx))
        }
        return wrap
    }

    /**
     * 值行 / 可点击行（右侧一行灰字 + 「›」）。
     *
     * @param value 右侧值（"已开启" / "12 个应用" / 版本号）；空串表示不显示
     * @param onClick null = 纯展示行（如「版本」）；非 null = 可点（如「选择要拦截的应用」）
     * @param onLongClick 长按回调（「数据目录」用它显示完整路径：路径太长，正文里只放尾部）
     */
    fun valueRow(
        ctx: Context,
        title: String,
        value: String,
        desc: String = "",
        onClick: (() -> Unit)? = null,
        showDivider: Boolean = true,
        onLongClick: (() -> Unit)? = null
    ): View {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(ctx, 56)
            setPadding(dp(ctx, 16), dp(ctx, 10), dp(ctx, 16), dp(ctx, 10))
            if (onClick != null) {
                isClickable = true
                isFocusable = true
                setOnClickListener { onClick() }
                // 点击水波纹（framework 主题自带，不引 ripple drawable）
                background = ctx.obtainStyledAttributes(
                    intArrayOf(android.R.attr.selectableItemBackground)
                ).let { ta ->
                    val d = ta.getDrawable(0)
                    ta.recycle()
                    d
                }
            }
            if (onLongClick != null) {
                isLongClickable = true
                setOnLongClickListener {
                    onLongClick()
                    true
                }
            }
        }
        row.addView(labelColumn(ctx, title, desc), LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
        ))

        if (value.isNotEmpty()) {
            row.addView(TextView(ctx).apply {
                text = value
                setTextColor(ctx.getColor(R.color.settings_text_dim))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                gravity = Gravity.END
                maxLines = 2
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { leftMargin = dp(ctx, 12) })
        }
        if (onClick != null) {
            row.addView(TextView(ctx).apply {
                text = "›"
                setTextColor(ctx.getColor(R.color.settings_text_dim))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { leftMargin = dp(ctx, 6) })
        }

        if (!showDivider) return row
        val wrap = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            addView(row)
            addView(divider(ctx))
        }
        return wrap
    }

    /** 分组下方的小字说明（跨行，不进卡片）。 */
    fun footnote(ctx: Context, text: String): TextView = TextView(ctx).apply {
        this.text = text
        setTextColor(ctx.getColor(R.color.settings_text_dim))
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        setLineSpacing(dp(ctx, 2).toFloat(), 1f)
        val lp = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        )
        lp.topMargin = dp(ctx, 8)
        lp.leftMargin = dp(ctx, 4)
        lp.rightMargin = dp(ctx, 4)
        layoutParams = lp
    }

    private fun labelColumn(ctx: Context, title: String, desc: String): LinearLayout =
        LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(ctx).apply {
                text = title
                setTextColor(ctx.getColor(R.color.settings_text))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            })
            if (desc.isNotEmpty()) {
                addView(TextView(ctx).apply {
                    text = desc
                    setTextColor(ctx.getColor(R.color.settings_text_dim))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
                    setLineSpacing(dp(ctx, 2).toFloat(), 1f)
                    setPadding(0, dp(ctx, 2), 0, 0)
                })
            }
        }
}
