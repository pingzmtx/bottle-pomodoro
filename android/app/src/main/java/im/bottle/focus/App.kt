package im.bottle.focus

import android.app.Application

/**
 * Application：只做一件事 —— 幂等建两个通知渠道。
 *
 * 渠道必须在任何通知之前建好（包括 AlarmReceiver 在新进程里醒来时），
 * 所以放在这里，而不是 Activity。
 */
class App : Application() {

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
    }
}
