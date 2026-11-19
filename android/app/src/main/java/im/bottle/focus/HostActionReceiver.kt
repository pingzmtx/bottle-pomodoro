package im.bottle.focus

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast

/**
 * 常驻通知上两个 action 的落地点（D）。
 *
 * 刻意用 `BroadcastReceiver` 而不是 Activity：
 * - Activity 会把"点一下按钮"变成"跳一次页面"（还会短暂覆盖计时页）；
 * - `exported=false` + 显式 ComponentName，外部 App 无法伪造这两个动作。
 *
 * 注意：屏幕固定期间通知栏是被系统隐藏的，所以锁机出口**不能只依赖这条 action**；
 * 真正的保底出口是 `MainActivity` 里的返回键长按 / 连按（见 [LockGuard]）。
 */
class HostActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        val ctx = context?.applicationContext ?: return
        when (intent?.action) {
            ACTION_BUBBLE -> {
                val session = State.loadSession(ctx)
                val now = System.currentTimeMillis()
                if (session == null || !session.active(now)) {
                    Log.i(TAG, "bubble action ignored: no active session")
                    return
                }
                FloatingBubble.showFromUser(ctx, session)
            }

            ACTION_LOCK -> {
                // 「锁机」= **打开开关 + 请求上锁**，不是"翻转开关"（P1-B）。
                //
                // 旧代码走 toggleEnabled()，而通知文案的三态里「锁机」正是"开关开着但当前没锁"，
                // 于是用户首次选「开启」→ 屏幕固定没开 → 没锁上 → 通知显示「锁机」→
                // 点一下 → toast「锁机已关闭」：按"锁机"把锁机关了。
                // 现在点「锁机」永远只会让锁机更"开"，关闭走独立的 ACTION_UNLOCK。
                LockGuard.setEnabled(ctx, true)
                LockGuard.requestLock(ctx)
                Log.i(TAG, "notification action: lock -> enabled=true, requestLock")
                toast(ctx, "锁机已开启")
                refreshSoon(ctx)
            }

            ACTION_UNLOCK -> {
                // 关闭：开关关掉 + 立刻解锁（通知上的「锁机·关」/「解除锁机」都走这里）
                Log.i(TAG, "notification action: unlock")
                LockGuard.setEnabled(ctx, false)
                LockGuard.requestUnlock(ctx)
                toast(ctx, "锁机已关闭")
                refreshSoon(ctx)
            }

            ACTION_SETTINGS -> {
                // 没有悬浮窗权限时用它顶替「小窗」（设计 B1 的第三个入口）。
                // 这里必须用 NEW_TASK：从 Receiver 起 Activity 没有任务栈可复用。
                Log.i(TAG, "notification action: settings")
                runCatching {
                    ctx.startActivity(
                        Intent(ctx, AppSettingsActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }.onFailure { Log.w(TAG, "open settings from notification failed", it) }
            }

            else -> Log.w(TAG, "unknown action: ${intent?.action}")
        }
    }

    /** BroadcastReceiver 的 onReceive 在主线程，可以直接弹 toast（用 applicationContext）。 */
    private fun toast(ctx: Context, text: String) {
        runCatching { Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show() }
            .onFailure { Log.w(TAG, "toast failed: $text", it) }
    }

    /**
     * 刷一次常驻通知的锁机文案。
     *
     * 立刻刷一次（开关已变）+ 800ms 后再刷一次：`startLockTask()` 到系统真的进入
     * 屏幕固定中间可能隔着「固定应用？」确认框，早刷出来的还是「锁机」，
     * 用户会以为"点了没生效"，接着再点一次。
     */
    private fun refreshSoon(ctx: Context) {
        Notifications.refreshOngoing(ctx)
        main.postDelayed({ Notifications.refreshOngoing(ctx) }, REFRESH_DELAY_MS)
    }

    companion object {
        private const val TAG = "BottleAction"

        /** 通知文案的二次刷新延迟（等系统的「固定应用？」确认框走完）。 */
        private const val REFRESH_DELAY_MS = 800L

        private val main = Handler(Looper.getMainLooper())

        const val ACTION_BUBBLE = "im.bottle.focus.action.BUBBLE"
        const val ACTION_LOCK = "im.bottle.focus.action.LOCK"
        const val ACTION_UNLOCK = "im.bottle.focus.action.UNLOCK"

        /** 没有悬浮窗权限时顶替「小窗」的「设置」入口（设计 B1）。 */
        const val ACTION_SETTINGS = "im.bottle.focus.action.SETTINGS"

        /**
         * 显式广播 PendingIntent。
         *
         * `FLAG_IMMUTABLE` 必须加（API 31+ 强制），`FLAG_UPDATE_CURRENT` 保证重复
         * 构建同一 action 时复用同一个 PendingIntent，而不是攒一堆。
         */
        fun pending(ctx: Context, action: String): PendingIntent {
            val intent = Intent(ctx, HostActionReceiver::class.java).setAction(action)
            return PendingIntent.getBroadcast(
                ctx,
                action.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
