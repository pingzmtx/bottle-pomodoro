# 瓶子专注 · Android 宿主

把 `public/index.html`（网页版）原样装进一个 Android App，**界面一像素不改**。
原生只做四件事：**承载网页**、**补回 WebView 缺失的能力**、**用系统闹钟保证到点会响**、**把计时搬到通知栏与悬浮小窗**。

计时逻辑、数据、界面全部在网页里，原生不复制任何一份账本。

---

## 目录

```
android/
├── app/
│   ├── build.gradle.kts        构建配置 + syncWeb / verifyWebAssets 任务
│   └── src/main/
│       ├── AndroidManifest.xml 5 条权限（无 INTERNET）
│       ├── assets/web/         网页产物（21 个文件，随 APK 打进）
│       ├── java/im/bottle/focus/
│       │   ├── MainActivity.kt       入口、生命周期、返回键、权限门队列
│       │   ├── WebAppHost.kt         WebView 配置、origin 拦截、桥与 shim 安装
│       │   ├── Bridge.kt             JS ⇄ 原生 命令分发（全部只读或纯动作）
│       │   ├── Shim.kt               注入网页的 JS（Notification / WakeLock / 返回键 / 导出）
│       │   ├── FileExchange.kt       导入（系统文件选择器）与导出（分块落盘）
│       │   ├── TimerWatch.kt         读 timerState，排 / 撤系统闹钟，驱动通知与小窗
│       │   ├── ArmRules.kt           排闹钟的纯规则层（可离线跑表）
│       │   ├── SessionKey.kt         「这一场」的粘性标识（暂停继续不换场）
│       │   ├── Notifications.kt      倒计时 / 正计时通知、到点提醒、通知 action
│       │   ├── FloatingBubble.kt     桌面悬浮小窗（Chronometer，可拖动）
│       │   ├── LockGuard.kt          屏幕固定锁机与出口
│       │   ├── HostActionReceiver.kt 通知按钮的接收器
│       │   ├── AlarmReceiver.kt      闹钟到点
│       │   ├── BootReceiver.kt       开机 / 授权变更后恢复
│       │   └── State.kt              常量与持久化
│       └── res/                图标、主题、字符串
├── verify.sh                   174 项一致性检查（静态 + 产物 + 跑表）
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

`bash verify.sh` 是另一层保险：174 项检查，含产物级断言（`aapt2 dump`）、真页面注入、纯函数跑表。

---

## 三条不能动的约束

1. **origin 必须永远是 `https://appassets.androidplatform.net/`**
   WebView 的 localStorage / IndexedDB 按 origin 隔离。换 origin = 用户全部数据消失。`State.kt` 里一个常量派生到 AssetLoader、桥的 `allowedOriginRules`、shim 注入域，三处不允许出现字面量。

2. **桥不能写网页状态**
   `Bridge.kt` 的命令全部只读（`timer.report`）或纯动作（通知、常亮、文件）。没有任何一条能写 `timerState` / `localStorage`。导入走的是网页自己的 `validateBackup → applyBackupData`，原生一个字节都不碰数据。

3. **不声明 INTERNET 权限**
   所有资源由 `WebViewAssetLoader` 本地拦截。不声明 = 数据物理上出不了设备；拦截漏了会立刻 `ERR_ACCESS_DENIED`，故障可见而不是静默白屏。

---

## 这一版有什么

| 能力 | 实现 |
|---|---|
| 到点响铃 + 震动 | `AlarmManager.setAlarmClock`，锁屏 / 杀进程后仍准点；不可用时降级 `setAndAllowWhileIdle` |
| 通知栏倒计时 | `setUsesChronometer(true)` + `setChronometerCountDown(true)`，秒数由 SystemUI 自己走 |
| 通知栏正计时 | 同上但 `setChronometerCountDown(false)`，`setWhen(startTime)`；正计时没有终点也照样有通知 |
| 悬浮小窗 | `TYPE_APPLICATION_OVERLAY` + 系统 `Chronometer`，可拖动、吸附边缘、点击回 App、长按隐藏 |
| 锁机（屏幕固定） | `startLockTask()`；默认关，首次计时询问一次；出口：长按返回 1.5s / 连按 3 次 / 通知按钮 |
| 返回键 | 拦截后走网页语义阶梯（关弹窗 → 回上一页 → 2 秒内再按才退） |
| 导入 / 导出 | 导入走 SAF，导出分块落盘；CSV 保留 UTF-8 BOM，mime 按源 blob 透传 |
| 屏幕常亮 | `screen.wake` → `keepScreenOn`，不申请 `WAKE_LOCK` |
| 后台恢复 | 进程被杀后重开，网页按 `endAt` 自愈；原生按粘性会话键恢复通知 / 小窗 / 锁机状态 |

## 已知限制

- **debug 证书签名**：自用可装，上架需换正式签名；换签名必须先卸载，本地数据会清空（先导出备份）。
- **不做前台服务**：长时间后台（尤其锁屏 + 省电模式）时，网页里的白噪音 / 音效可能被系统掐掉；到点提示音不受影响——那是系统闹钟 + 通知，不依赖进程存活。要可靠后台播放需加 `foregroundServiceType=mediaPlayback` 的前台服务，代价是常驻通知。
- **锁机依赖系统「屏幕固定」**：没开启时一律不锁，只提示；部分 ROM 没有 `SCREEN_PINNING_SETTINGS` 页。
- **网页升级不自动生效**：网页改了要重新跑 `build.py` + `syncWeb` + 重新打包。

## 调试

```bash
adb logcat -s BottleWatch BottleAlarm BottleBridge BottleFile BottleBubble BottleLock
```

debug 包支持 `chrome://inspect`（`BuildConfig.DEBUG` 下已开启 `setWebContentsDebuggingEnabled`）。

## 版本

`0.1.4` / versionCode 5。包名 `im.bottle.focus`，minSdk 26，targetSdk 34。权限 5 条：通知、震动、精确闹钟、开机、悬浮窗——**没有 INTERNET**。
