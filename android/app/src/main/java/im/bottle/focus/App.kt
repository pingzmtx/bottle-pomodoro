package im.bottle.focus

import android.app.Application
import android.util.Log

/**
 * Application：三件事 —— 幂等建通知渠道 + 正计时场次清拦截镜像 + 修应用锁残留。
 *
 * 渠道必须在任何通知之前建好（包括 AlarmReceiver 在新进程里醒来时），所以放在这里，而不是 Activity。
 *
 * ① `Guard.clearOrphanCountingActive`（0.2.3 P1-2）**必须排在 `repairResidue` 之前**：
 *    进程被 LMK 杀 → 重绑时正计时（`endAt == 0`）在 prefs 里仍然"活着"（唯一判据 `savedAt + 8h`
 *    还没到），`repairResidue` / `recheckExpired` 都会判它在跑 —— 而网页已经死了，
 *    正计时其实早停了。`Application.onCreate` 是"新进程刚起"的确定性信号（WebView 还没创建，
 *    网页不可能在跑），所以在这一刻把拦截镜像清掉；session / 粘性键**保留**，
 *    网页恢复上报时会自己把镜像写回来。
 *
 * ② `Guard.repairResidue` 也必须在这里跑一次：进程被杀 / 闹钟迟到 会让 `guard.active`
 *    停在 true，而 prefs 里早已没有活着的场次 —— 不修就是"没在计时也拦"，用户只会卸载 App
 *    （设计 §6 第 11 条）。`MainActivity.onResume` 会再跑一次（两个入口，缺一不可），
 *    但 ① 只在进程创建时跑（理由见 `Guard.clearOrphanCountingActive` 的注释）。
 */
class App : Application() {

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
        try {
            // ① 先清"被进程重启留下的正计时场次"的拦截镜像（只清 active，不动 session）
            Guard.clearOrphanCountingActive(this)
        } catch (e: Exception) {
            // Application.onCreate 抛异常 = 整个进程起不来（用户看到的是"点了图标没反应"）
            Log.w("BottleApp", "clearOrphanCountingActive failed", e)
        }
        try {
            // ② 再修残留（没有活着的场次 / 场次已过期 → 连同记账一起清）
            Guard.repairResidue(this)
        } catch (e: Exception) {
            // Application.onCreate 抛异常 = 整个进程起不来（用户看到的是"点了图标没反应"）
            Log.w("BottleApp", "repairResidue failed", e)
        }
    }
}
