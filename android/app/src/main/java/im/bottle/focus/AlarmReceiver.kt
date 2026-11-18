package im.bottle.focus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 到点：幂等闸门 → 撤常驻 → 发响铃/静默通知。
 *
 * 接收器可能在**新进程**里跑（设计 §5.1），所以这里不碰任何 WebView 状态、不做任何"写回"。
 * 网页下次打开会按自己的 `endAt` 自行结算（`restoreTimerSnapshot` 超时分支）。
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null || intent == null) return
        val endAtWall = intent.getLongExtra(EXTRA_END_AT, 0L)
        if (endAtWall <= 0L) {
            Log.w(TAG, "fire without endAt, dropped")
            return
        }

        // 幂等闸门：同一个 endAt 只响一次。AlarmManager 重复投递、重排残留、时钟回拨都走这里。
        if (State.firedFor(context) == endAtWall) {
            Log.i(TAG, "already fired for $endAtWall, skip")
            return
        }
        State.markFired(context, endAtWall)

        Notifications.ensureChannels(context)
        Notifications.cancelOngoing(context)

        // 迟到 > 60s 降级为静默：深夜迟到 5 分钟还响一声，比不响更烦（设计 §5.2）
        val late = System.currentTimeMillis() - endAtWall
        val silent = late > TimerWatch.RING_LATE_MS
        val title = if (silent) "番茄已结束" else "时间到"
        val body = if (silent) {
            "这一轮已经结束，回来看看结果吧"
        } else {
            "专注完成，休息一下"
        }
        Notifications.showAlert(context, title, body, silent)
        State.clearPendingAlarm(context)
        Log.i(TAG, "ring endAt=$endAtWall late=${late}ms silent=$silent")
    }

    companion object {
        private const val TAG = "BottleAlarm"
        const val ACTION_FIRE = "im.bottle.focus.action.FIRE"
        const val EXTRA_END_AT = "endAt"
    }
}
