package im.bottle.focus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 开机 / 精确闹钟权限被授予时，按 prefs 恢复影子闹钟。
 *
 * 这里只恢复"**曾经被合法排过**"的闹钟：prefs 里那条记录是当初网页上报后通过
 * §1.4 四条规则校验才写进去的。开机时网页没在跑、设置不可能变，所以按原样恢复是安全的
 * —— 这恰好避开了"重启后误把 bgPause 会话排上"的坑（设计 §12）。
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

        val pending = State.loadPendingAlarm(context) ?: run {
            Log.i(TAG, "$action: no pending alarm")
            return
        }
        val now = System.currentTimeMillis()
        if (pending.endAtWall - now < TimerWatch.MIN_LEAD_MS) {
            // 关机期间就该结束的：不补响（补响只会变成深夜的意外噪音），清账走人。
            State.clearPendingAlarm(context)
            Notifications.cancelOngoing(context)
            Log.i(TAG, "$action: pending expired, dropped")
            return
        }

        Notifications.ensureChannels(context)
        TimerWatch(context).arm(pending.endAtWall, pending.title)
        Log.i(TAG, "$action: restored alarm at ${pending.endAtWall}")
    }

    companion object {
        private const val TAG = "BottleBoot"
        const val ACTION_EXACT_ALARM_GRANTED =
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
    }
}
