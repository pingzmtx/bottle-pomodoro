package im.bottle.focus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 到点：幂等闸门 → 撤常驻 → 发响铃/静默通知 → **清单收尾**（session / 粘性键 / guard.active）。
 *
 * 本类是全仓**唯一**的"到点收尾"实现（0.2.2 删掉了 `TimerWatch.onAlarmFired()`：
 * 那份代码从没有调用者，且与这里各写一遍 —— 两份"到点该清什么"必然漂移，
 * P1-1 的 `guard.active` 残留就是这么漏出来的）。
 *
 * 接收器可能在**新进程**里跑（设计 §5.1），所以这里不碰任何 WebView 状态、不做任何"写回"，
 * 只碰 prefs。网页下次打开会按自己的 `endAt` 自行结算（`restoreTimerSnapshot` 超时分支）。
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
        // 到点：FGS 的使命结束。广播可能在新进程里跑（服务根本不存在），stop 是幂等的；
        // 若服务恰好还活着，这一步保证它的 stopForeground(REMOVE) 不会在响铃通知之后
        // 又把通知栏刷一遍。
        TimerService.stop(context)
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
        // ★ P1-1①：到点 = 这一场确实结束了，三件收尾必须做全（旧代码只停了服务、撤了通知，
        //   于是 guard.active 永远停在 true → 黑名单 App 被永久拦，用户只能长按 2s 放行或卸载）。
        //   1) session：这一场已经结束，留着会让小窗 / 通知按旧账重建；
        //   2) 粘性键：下一场必须是新键，否则"本场不再拦"会跨场生效；
        //   3) guard.active：镜像收工，Application 锁不再拦。
        //   注意：广播可能跑在**新进程**里，所以这里只碰 prefs，不碰任何 WebView / 服务实例。
        State.clearSession(context)
        State.clearStickySession(context)
        Guard.clearActive(context)
        Log.i(TAG, "ring endAt=$endAtWall late=${late}ms silent=$silent")
    }

    companion object {
        private const val TAG = "BottleAlarm"
        const val ACTION_FIRE = "im.bottle.focus.action.FIRE"
        const val EXTRA_END_AT = "endAt"
    }
}
