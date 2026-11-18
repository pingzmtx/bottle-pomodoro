package im.bottle.focus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 开机 / 精确闹钟权限被授予时，按 prefs 恢复影子闹钟与常驻 UI（通知 + 小窗）。
 *
 * 这里只恢复"**曾经被合法排过**"的场次：prefs 里那条记录是当初网页上报后通过
 * §1.4 四条规则校验才写进去的。开机时网页没在跑、设置不可能变，所以按原样恢复是安全的
 * —— 这恰好避开了"重启后误把 bgPause 会话排上"的坑（设计 §12）。
 *
 * 正计时（stopwatch）**没有闹钟**，所以它的恢复依据是 `session.*` 那条记录：
 * 8 小时内的场次重建正计时常驻通知 + 小窗，超时就当作用户早忘了，不伪造计时。
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) return
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != ACTION_EXACT_ALARM_GRANTED
        ) {
            return
        }

        Notifications.ensureChannels(context)
        val now = System.currentTimeMillis()
        val pending = State.loadPendingAlarm(context)

        if (pending != null) {
            if (pending.endAtWall - now < TimerWatch.MIN_LEAD_MS) {
                // 关机期间就该结束的：不补响（补响只会变成深夜的意外噪音），清账走人。
                State.clearPendingAlarm(context)
                State.clearSession(context)
                Notifications.cancelOngoing(context)
                FloatingBubble.hide(context)
                Log.i(TAG, "$action: pending expired, dropped")
                return
            }
            TimerWatch(context).arm(pending.endAtWall, pending.title)
            Log.i(TAG, "$action: restored alarm at ${pending.endAtWall}")
        } else {
            // 没有闹钟：可能是一场仍在进行的正计时
            val session = State.loadSession(context)
            if (session != null && session.isCounting && session.active(now)) {
                Notifications.showOngoingCounting(context, session.startTime, session.title)
                Log.i(TAG, "$action: restored counting since ${session.startTime}")
            } else {
                State.clearSession(context)
                Notifications.cancelOngoing(context)
                Log.i(TAG, "$action: no pending alarm")
            }
        }

        // 小窗：权限在就恢复，用户手动关过的那一场不会自己回来
        State.loadSession(context)?.let { session ->
            if (session.active(now)) FloatingBubble.restore(context, session)
        }
    }

    companion object {
        private const val TAG = "BottleBoot"
        const val ACTION_EXACT_ALARM_GRANTED =
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
    }
}
