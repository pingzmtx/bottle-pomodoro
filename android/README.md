# 瓶子专注 · Android 宿主

把 `public/index.html`（网页版）原样装进一个 Android App，**界面一像素不改**。

计时逻辑、数据、界面全部在网页里，原生不复制任何一份账本。原生只做四件事：**承载网页**、**补回 WebView 缺失的能力**、**用系统闹钟保证到点会响**、**把计时搬到通知栏 / 悬浮小窗 / 应用锁**。

---

## 目录

```
android/
├── app/
│   ├── build.gradle.kts        构建配置 + syncWeb / verifyWebAssets 任务
│   └── src/main/
│       ├── AndroidManifest.xml 7 条权限（无 INTERNET）+ 无障碍服务 + 前台服务
│       ├── assets/web/         网页产物（21 个文件，随 APK 打进）
│       ├── java/im/bottle/focus/
│       │   ├── MainActivity.kt       入口、生命周期、返回键、权限门队列
│       │   ├── WebAppHost.kt         WebView 配置、origin 拦截、桥与 shim 安装
│       │   ├── Bridge.kt             JS ⇄ 原生 命令分发（全部只读或纯动作）
│       │   ├── Shim.kt               注入网页的 JS（Notification / WakeLock / 返回键 / 导出 / 设置入口）
│       │   ├── FileExchange.kt       导入（系统文件选择器）与导出（分块落盘）
│       │   ├── TimerWatch.kt         读 timerState，排 / 撤系统闹钟，驱动通知与小窗
│       │   ├── ArmRules.kt           排闹钟的纯规则层（可离线跑表）
│       │   ├── SessionKey.kt         「这一场」的粘性标识（暂停继续不换场）
│       │   ├── Notifications.kt      倒计时 / 正计时通知、到点提醒、通知 action
│       │   ├── TimerService.kt       前台服务：只为让进程不进 freezer，零计时逻辑
│       │   ├── FloatingBubble.kt     桌面悬浮小窗（Chronometer + 任务名）
│       │   ├── GuardService.kt       无障碍服务：识别前台应用，命中黑名单就拦
│       │   ├── GuardOverlay.kt       拦截遮罩（全屏，三条出口）
│       │   ├── Guard.kt              应用锁的 I/O 适配（白名单、镜像、残留修复）
│       │   ├── GuardRules.kt         应用锁的纯判定层（可离线跑表）
│       │   ├── LockGuard.kt          屏幕固定「深度锁机」与出口
│       │   ├── AppSettingsActivity.kt 原生设置页
│       │   ├── GuardAppsActivity.kt   应用多选页（搜索 + 已选优先）
│       │   ├── SettingsUi.kt          设置页行工厂（纯 framework View）
│       │   ├── HostActionReceiver.kt  通知按钮的接收器
│       │   ├── AlarmReceiver.kt       闹钟到点
│       │   ├── BootReceiver.kt        开机 / 授权变更后恢复
│       │   ├── App.kt                 Application：建渠道、清拦截残留
│       │   └── State.kt               常量与持久化
│       └── res/                图标、主题（含 values-night）、布局、无障碍配置、快捷方式
├── verify.sh                   326 项一致性检查（静态 + 产物 + 跑表）
├── app/tools/                  离线验证脚本（真页面注入、规则跑表、会话键真值表）
└── README.md
```

---

## 构建

**依赖**：JDK 17+、Android SDK platform 34 / build-tools 34.0.0、**Gradle 8.9**（AGP 8.7.3 不接受 Gradle 9）。

先让 Gradle 找到 SDK：在 `android/local.properties` 写 `sdk.dir=/你的/Android/sdk`，或设环境变量 `ANDROID_HOME`。

```bash
# 1) 生成网页产物（在仓库根，产出 public/）
python3 tools/build.py

# 2) 同步进 App（网页更新后只需重跑这一步）
cd android
gradle :app:syncWeb

# 3) 打包
gradle :app:assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

`preBuild` 会自动跑 `verifyWebAssets`：`assets/web` 与 `public/` 逐字节比对，**不一致直接构建失败**，避免"拷漏一个文件 → 白屏"。找不到 `public/` 时跳过校验，直接用已提交的 `assets/web`（所以只 clone 本目录也能构建）。

`bash verify.sh` 是另一层保险：326 项检查，含产物级断言（`aapt2 dump`）、真页面注入、纯函数跑表。

---

## 三条不能动的约束

1. **origin 必须永远是 `https://appassets.androidplatform.net/`**
   WebView 的 localStorage / IndexedDB 按 origin 隔离。换 origin = 用户全部数据消失。`State.kt` 里一个常量派生到 AssetLoader、桥的 `allowedOriginRules`、shim 注入域，三处不允许出现字面量。

2. **桥不能写网页状态**
   `Bridge.kt` 的命令全部只读（`timer.report`）或纯动作（通知、常亮、文件、开设置页）。没有任何一条能写 `timerState` / `localStorage`。导入走的是网页自己的 `validateBackup → applyBackupData`，原生一个字节都不碰数据。

3. **不声明 INTERNET 权限**
   所有资源由 `WebViewAssetLoader` 本地拦截。不声明 = 数据物理上出不了设备；拦截漏了会立刻 `ERR_ACCESS_DENIED`，故障可见而不是静默白屏。

---

## 这一版有什么

| 能力 | 实现 |
|---|---|
| 到点响铃 + 震动 | `AlarmManager.setAlarmClock`，锁屏 / 杀进程后仍准点；不可用时降级 `setAndAllowWhileIdle` |
| 通知栏倒计时 | `setUsesChronometer(true)` + `setChronometerCountDown(true)`，秒数由 SystemUI 自己走 |
| 通知栏正计时 | 同上但 `setChronometerCountDown(false)`，`setWhen(startTime)`；正计时没有终点也照样有通知 |
| 后台保活 | `TimerService`（`foregroundServiceType=specialUse`）持有同一条常驻通知，让进程不进 cached-freezer |
| 悬浮小窗 | `TYPE_APPLICATION_OVERLAY` + 系统 `Chronometer`；显示**当前任务名**（超长省略）+ 剩余时间；可拖动、吸附边缘、点击回 App、长按隐藏 |
| **应用锁** | `AccessibilityService` 监听 `TYPE_WINDOW_STATE_CHANGED` 取前台包名；命中用户勾选的黑名单 → 先盖全屏遮罩、下一帧 `GLOBAL_ACTION_HOME`。白名单含 launcher（动态查）/ 输入法 / 系统 UI / 电话短信闹钟 / 设置 |
| 深度锁机（可选） | `startLockTask()` 屏幕固定；默认关。应用锁是默认路径，屏幕固定给"完全不分心"场景 |
| 原生设置页 | 桌面长按图标 →「应用设置」；网页设置页底部注入入口；通知 action。含应用锁总开关 / 应用多选 / 小窗 / 通知 action / 关于 |
| 返回键 | 拦截后走网页语义阶梯（关弹窗 → 回上一页 → 2 秒内再按才退） |
| 导入 / 导出 | 导入走 SAF，导出分块落盘；CSV 保留 UTF-8 BOM，mime 按源 blob 透传 |
| 屏幕常亮 | `screen.wake` → `keepScreenOn`，不申请 `WAKE_LOCK` |
| 后台恢复 | 进程被杀后重开，网页按 `endAt` 自愈；原生按粘性会话键恢复通知 / 小窗 / 锁机状态 |

## 应用锁的边界

- **只在用户勾选的应用上拦**，不是"非白名单即拦"。
- **只在专注进行中拦**（`running && !paused && mode ∈ {focus, free}`）；休息段、暂停态不拦。
- **设置类应用永远放行**：拦了设置只增痛苦不增约束力（长按电源一样能绕过），却让用户无法关闭服务、开热点、配蓝牙。
- 遮罩三条出口：点「回到专注」、长按 2 秒「本场不再拦」、最长 6 秒自撤。
- 无障碍配置 `canRetrieveWindowContent=false`、`packageNames` 留空、flags 最小——**只判包名，不读任何界面内容**。

## 已知限制

- **debug 证书签名**：自用可装，上架需换正式签名；换签名必须先卸载，本地数据会清空（先导出备份）。
- **应用锁需要无障碍权限**：国产 ROM（MIUI / EMUI / ColorOS）入口路径不同，部分需要在「应用信息 → 特殊权限」里打开「允许受限制的设置」。服务被系统静默关闭后，回 App 会提示一次。
- **白噪音仍可能被掐**：`TimerService` 保的是计时与上报，不是音频流。要锁屏持续播放需 `mediaPlayback` 类型的前台服务。
- **屏幕固定依赖系统设置**：没开启时一律不锁，只提示；部分 ROM 没有 `SCREEN_PINNING_SETTINGS` 页。
- **网页升级不自动生效**：网页改了要重新跑 `build.py` + `syncWeb` + 重新打包。

## 调试

```bash
adb logcat -s BottleWatch BottleAlarm BottleBridge BottleFile BottleBubble BottleLock BottleGuard BottleApp
```

debug 包支持 `chrome://inspect`（`BuildConfig.DEBUG` 下已开启 `setWebContentsDebuggingEnabled`）。

## 版本

`0.2.3` / versionCode 9。包名 `im.bottle.focus`，minSdk 26，targetSdk 34。
权限 7 条：通知、震动、精确闹钟、开机、悬浮窗、前台服务、前台服务(specialUse)——**没有 INTERNET**，没有存储权限，没有无障碍的 `uses-permission`（无障碍是 `<service>` 声明）。
