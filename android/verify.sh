#!/usr/bin/env bash
# 瓶子专注 · Android 验收脚本
#
# 把「安装包元信息 / assets 逐字节一致 / 返回键不用 history / 返回键用 switchView / 桥名不撞车 /
# shim 自证标记 / shim 运行时注入实测」串成一条可重跑的命令。
# 全部通过退出码 0，任一失败退出码 1（WARN 不计失败）。
#
# 第 8、9 节是 2026-11 P0 之后加的：那一轮 32 条静态 grep 全绿，而 shim 整段是死代码
# （`if (__bottleHost) return` 恒真 → 到点不响、返回键恒 exit）。教训很直接：
# **静态 grep 证明不了"这行代码被执行过"**，所以第 9 节会真的把 JS 抽出来注入真页面跑一遍。
#
# 用法：  ./verify.sh
#         VERIFY_STRICT_INJECT=1 ./verify.sh   # 注入测试跑不了时按 FAIL（CI 用）
# 前置：  已跑过 /opt/gradle-8.9/bin/gradle :app:assembleDebug
#         第 9 节需要 python3 + playwright + chromium；缺了只 WARN 不失败

set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APK="$PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
WEB_SRC="$PROJECT_DIR/../web-src/public"
WHITELIST="$PROJECT_DIR/../web-src/src/window_whitelist.json"
AAPT2="${AAPT2:-/opt/android-sdk/build-tools/34.0.0/aapt2}"

PASS=0
FAIL=0
WARN=0

ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$1"; WARN=$((WARN + 1)); }
head_() { printf '\n\033[1m[%s] %s\033[0m\n' "$1" "$2"; }

# ---------------------------------------------------------------- 0. APK 存在
head_ 0 "APK 产物"
if [ -f "$APK" ]; then
    ok "APK 存在：$APK ($(stat -c%s "$APK") 字节)"
else
    bad "APK 不存在，请先执行：/opt/gradle-8.9/bin/gradle :app:assembleDebug"
    printf '\n\033[31m中止：没有产物可验。\033[0m\n'
    exit 1
fi

if [ ! -x "$AAPT2" ]; then
    bad "找不到 aapt2：$AAPT2"
    printf '\n\033[31m中止。\033[0m\n'
    exit 1
fi

BADGING="$("$AAPT2" dump badging "$APK" 2>/dev/null)"

# ------------------------------------------------------- 1. 包名 / 版本 / SDK
head_ 1 "包名 · 版本 · SDK"
printf '%s\n' "$BADGING" | grep -q "package: name='im.bottle.focus'" \
    && ok "包名 im.bottle.focus" || bad "包名不是 im.bottle.focus"
# 0.1.1 已经被一个**不含本轮功能**的包占用了，继续用同一个版本号会让装过那个包的
# 测试机"看起来已经升级"（覆盖安装成功、功能却是旧的）。0.1.2 同理。
# 所以这里是修正版本漂移，不是把断言放松：版本号必须精确等于本次要发的包。
printf '%s\n' "$BADGING" | grep -q "versionName='0.1.4'" \
    && ok "versionName 0.1.4" || bad "versionName 不是 0.1.4"
printf '%s\n' "$BADGING" | grep -q "versionCode='5'" \
    && ok "versionCode 5" || bad "versionCode 不是 5"
printf '%s\n' "$BADGING" | grep -q "^sdkVersion:'26'" \
    && ok "minSdk 26" || bad "minSdk 不是 26"
printf '%s\n' "$BADGING" | grep -q "^targetSdkVersion:'34'" \
    && ok "targetSdk 34" || bad "targetSdk 不是 34"

# ------------------------------------------------------------------ 2. 权限
head_ 2 "权限清单（android.permission.* 恰好 5 条，且无 INTERNET）"
for p in POST_NOTIFICATIONS VIBRATE SCHEDULE_EXACT_ALARM RECEIVE_BOOT_COMPLETED SYSTEM_ALERT_WINDOW; do
    printf '%s\n' "$BADGING" | grep -q "uses-permission: name='android.permission.$p'" \
        && ok "已声明 $p" || bad "缺少 $p"
done
# 总数：5 条。（aapt2 还会列出 im.bottle.focus.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION，
# 那是 androidx.core 自动生成的签名级权限，不属于 android.permission.*，这里不计。）
PERM_COUNT=$(printf '%s\n' "$BADGING" | grep -c "uses-permission: name='android.permission.")
if [ "$PERM_COUNT" -eq 5 ]; then
    ok "android.permission.* 恰好 5 条（4 条旧 + SYSTEM_ALERT_WINDOW）"
else
    bad "android.permission.* 有 $PERM_COUNT 条（应为 5）"
fi
for p in INTERNET FOREGROUND_SERVICE WAKE_LOCK USE_EXACT_ALARM; do
    if printf '%s\n' "$BADGING" | grep -q "name='android.permission.$p'"; then
        bad "不该声明却声明了 $p"
    else
        ok "刻意未声明 $p"
    fi
done

# --------------------------------------------------------- 3. launcher activity
head_ 3 "启动入口"
printf '%s\n' "$BADGING" | grep -q "launchable-activity: name='im.bottle.focus.MainActivity'" \
    && ok "launcher activity = im.bottle.focus.MainActivity" \
    || bad "找不到 launcher activity（点桌面图标会打不开）"

# ------------------------------------- 4. assets 完整性与逐字节一致（对比 public）
head_ 4 "assets/web 与 web-src/public 逐字节一致"
if [ ! -d "$WEB_SRC" ]; then
    bad "找不到源目录 $WEB_SRC"
else
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    unzip -q -o "$APK" 'assets/web/*' -d "$TMP_DIR" 2>/dev/null
    APK_WEB="$TMP_DIR/assets/web"

    if [ -d "$APK_WEB" ]; then
        ok "APK 内含 assets/web/"
    else
        bad "APK 内没有 assets/web/（打开必然白屏）"
    fi

    # 关键文件逐个点名（拷漏一个就是白屏）
    for f in index.html config.js sw.js manifest.webmanifest \
             assets/app.js assets/base.js assets/core.js assets/engine.js \
             fonts/smiley-title.woff2 fonts/wenkai-regular.woff2 \
             icons/icon-192.png; do
        if [ -f "$APK_WEB/$f" ]; then
            ok "存在 $f"
        else
            bad "缺少 $f"
        fi
    done

    # 逐字节：整个目录 diff（-r 递归比内容）
    if diff -r "$WEB_SRC" "$APK_WEB" >/dev/null 2>&1; then
        N=$(find "$WEB_SRC" -type f | wc -l | tr -d ' ')
        ok "整目录逐字节一致（$N 个文件）"
    else
        bad "与 web-src/public 不一致，差异如下："
        diff -r "$WEB_SRC" "$APK_WEB" 2>&1 | head -20 | sed 's/^/       /'
    fi

    # 关键文件 sha256 对照（人眼可复核）
    printf '       %-28s %-64s %s\n' "文件" "SHA256" "结果"
    ALIGN="index.html assets/app.js assets/engine.js assets/core.js assets/base.js"
    for f in $ALIGN; do
        if [ -f "$WEB_SRC/$f" ] && [ -f "$APK_WEB/$f" ]; then
            A=$(sha256sum "$WEB_SRC/$f" | cut -d' ' -f1)
            B=$(sha256sum "$APK_WEB/$f" | cut -d' ' -f1)
            if [ "$A" = "$B" ]; then
                printf '       %-28s %s %s\n' "$f" "${A:0:24}…" "same"
            else
                printf '       %-28s %s %s\n' "$f" "${A:0:24}…" "DIFF"
            fi
        fi
    done

    # CSS 文件名带 hash，单独找
    CSS=$(cd "$WEB_SRC" && ls assets/style.*.css 2>/dev/null | head -1)
    if [ -n "$CSS" ] && [ -f "$APK_WEB/$CSS" ]; then
        ok "存在 $CSS"
    else
        bad "缺少 style.*.css"
    fi
fi

# ------------------------------------------- 5. 返回键不用 history（必须为空）
head_ 5 "返回键不使用 canGoBack / goBack"
HITS=$(grep -rn "canGoBack\|goBack" "$PROJECT_DIR/app/src/main/java/" 2>/dev/null || true)
if [ -z "$HITS" ]; then
    ok "grep -rn 'canGoBack|goBack' app/src/main/java/ → 空（切 tab 不产生历史，back 会直接退出 App）"
else
    bad "发现 history 式返回键代码："
    printf '%s\n' "$HITS" | sed 's/^/       /'
fi

# -------------------------------------- 6. 返回键必须走网页自己的 switchView
head_ 6 "返回键调用网页的 switchView"
if grep -rq "switchView" "$PROJECT_DIR/app/src/main/java/"; then
    ok "grep -rn 'switchView' app/src/main/java/ → 有命中"
else
    bad "找不到 switchView：返回键第 4 级会退化成直接退出 App"
fi

# ------------------------------------------- 7. 桥对象名不与网页 233 个全局撞车
head_ 7 "桥对象名 __bottleHost 不撞车"
if [ -f "$WHITELIST" ]; then
    C=$(grep -c "__bottleHost" "$WHITELIST" || true)
    if [ "$C" -eq 0 ]; then
        ok "window_whitelist.json 中 __bottleHost 出现 0 次"
    else
        bad "window_whitelist.json 中 __bottleHost 出现 $C 次（会覆盖网页全局）"
    fi
else
    bad "找不到 $WHITELIST"
fi
# 产物全文再扫一遍（白名单只统计赋值型全局，defineProperty 型不在里面）
if [ -d "$WEB_SRC" ]; then
    C2=$(grep -rl "__bottleHost" "$WEB_SRC" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$C2" -eq 0 ]; then
        ok "public/ 全文中 __bottleHost 出现 0 次"
    else
        bad "public/ 全文里有 $C2 个文件包含 __bottleHost"
    fi
fi

# ------------------------------- 8. shim 自证标记（P0 的静态锚点，不能只靠运行时）
head_ 8 "shim 自证标记 __bottleShimV1"
SHIM_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/Shim.kt"
if [ -f "$SHIM_KT" ]; then
    # 赋值 + 判断，至少 2 处；少一处就说明"幂等/自证"这对逻辑被谁改掉了
    C=$(grep -c "__bottleShimV1" "$SHIM_KT" || true)
    if [ "$C" -ge 2 ]; then
        ok "Shim.kt 中 __bottleShimV1 出现 $C 次（要求 ≥ 2：判断 + 赋值）"
    else
        bad "Shim.kt 中 __bottleShimV1 只出现 $C 次（要求 ≥ 2）"
    fi
    if grep -q "__bottleShimV1 = true" "$SHIM_KT"; then
        ok "存在赋值 __bottleShimV1 = true（shim 能自证已安装）"
    else
        bad "找不到 __bottleShimV1 = true：注入测试的锚点会整体失效"
    fi
    # 旧的死代码形态必须彻底消失：对"桥存在"做 early-return。
    # 桥一定先装 → 这个条件恒真 → 后面所有行都执行不到。回来一次就再死一次。
    HITS=$(grep -nE "if *\( *window(\.|\[['\"])__BOTTLE_BRIDGE__" "$SHIM_KT" || true)
    if [ -z "$HITS" ]; then
        ok "没有对桥存在性做 early-return（P0 的死代码形态已消失）"
    else
        bad "发现对桥存在性做 early-return（桥一定先装 → 后面全是死代码）："
        printf '%s\n' "$HITS" | sed 's/^/       /'
    fi
    # 降级路径只许 warn：shim 里一条 console.error 都不该有（QA 断言的就是"没有 [bottle] error"）
    C=$(grep -c "console.error" "$SHIM_KT" || true)
    if [ "$C" -eq 0 ]; then
        ok "Shim.kt 里 console.error 出现 0 次（降级只许 warn）"
    else
        bad "Shim.kt 里还有 $C 处 console.error（降级不该用 error 级别）"
    fi
    # 桥缺失时必须降级而不是整体 return
    if grep -q "bridge missing" "$SHIM_KT"; then
        ok "保留了 bridge missing 的降级分支（无桥不整体 return）"
    else
        bad "找不到 bridge missing 降级分支"
    fi
else
    bad "找不到 $SHIM_KT"
fi
if [ -f "$WHITELIST" ]; then
    C=$(grep -c "__bottleShimV1" "$WHITELIST" || true)
    if [ "$C" -eq 0 ]; then
        ok "window_whitelist.json 中 __bottleShimV1 出现 0 次（233 个名字里没有）"
    else
        bad "window_whitelist.json 中 __bottleShimV1 出现 $C 次（会覆盖网页全局）"
    fi
else
    bad "找不到 $WHITELIST"
fi
if [ -d "$WEB_SRC" ]; then
    C2=$(grep -rl "__bottleShimV1" "$WEB_SRC" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$C2" -eq 0 ]; then
        ok "public/ 全文中 __bottleShimV1 出现 0 次"
    else
        bad "public/ 全文里有 $C2 个文件包含 __bottleShimV1"
    fi
fi

# ------------------------- 9. shim 运行时注入实测（静态 grep 看不见执行路径）
head_ 9 "shim 运行时注入实测（extract + node --check + Playwright）"
EXTRACT="$PROJECT_DIR/app/tools/extract_shim.py"
INJECT="$PROJECT_DIR/app/tools/inject_test.py"
BUILD_SHIM="$PROJECT_DIR/app/build/shim.js"

if [ ! -f "$EXTRACT" ] || [ ! -f "$INJECT" ]; then
    bad "缺少 app/tools/extract_shim.py 或 app/tools/inject_test.py"
else
    # 9.1 提取：静态 grep 之后的第一道"真的拿出来"的检查
    if OUT=$(python3 "$EXTRACT" 2>&1); then
        ok "extract_shim.py 提取成功（$(printf '%s' "$OUT" | grep -c . ) 行输出，含插值审计）"
    else
        bad "extract_shim.py 失败："
        printf '%s\n' "$OUT" | tail -5 | sed 's/^/       /'
    fi

    # 9.2 语法：抽出来的 JS 必须是合法脚本（node 不在就 WARN，不失败）
    if [ -f "$BUILD_SHIM" ]; then
        if ! command -v node >/dev/null 2>&1; then
            warn "没有 node，跳过 node --check $BUILD_SHIM"
        elif node --check "$BUILD_SHIM" >/dev/null 2>&1; then
            ok "node --check app/build/shim.js 通过（$(stat -c%s "$BUILD_SHIM") 字节）"
        else
            bad "node --check 失败：app/build/shim.js 不是合法 JS"
            node --check "$BUILD_SHIM" 2>&1 | head -5 | sed 's/^/       /'
        fi
    else
        bad "app/build/shim.js 未生成"
    fi

    # 9.3 注入：真页面 + 真 shim，两个模式各 5 条断言
    #     退出码 0 = 全 PASS；2 = 环境不行（WARN，不算失败）；其它 = 真失败
    for MODE in bridge nobridge; do
        OUT=$(timeout 300 python3 "$INJECT" --mode "$MODE" 2>&1)
        RC=$?
        if [ "$RC" -eq 0 ]; then
            ok "inject_test.py --mode $MODE：5/5 PASS"
            printf '%s\n' "$OUT" | grep -E '^(PASS|FAIL)' | sed 's/^/       /'
        elif [ "$RC" -eq 2 ]; then
            warn "inject_test.py --mode $MODE 跑不了（$(printf '%s' "$OUT" | grep '^ENV:' | head -1)）"
            [[ "${VERIFY_STRICT_INJECT:-0}" == "1" ]] && bad "VERIFY_STRICT_INJECT=1：注入测试必须真跑"
        else
            bad "inject_test.py --mode $MODE 有用例 FAIL（退出码 $RC）："
            printf '%s\n' "$OUT" | grep -E '^(PASS|FAIL)' | sed 's/^/       /'
        fi
    done
fi

# ------------------------------- 10. 导入 / 导出（P2：文件交换，网页一行不许改）
head_ 10 "导入 / 导出（WebChromeClient + SAF）"
FE_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/FileExchange.kt"
HOST_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/WebAppHost.kt"
MANIFEST="$PROJECT_DIR/app/src/main/AndroidManifest.xml"
PROTOCOL="$PROJECT_DIR/../android-kernel/contracts/protocol.json"
CONTRACT_MD="$PROJECT_DIR/../android-kernel/contracts/CONTRACT.md"

if [ -f "$FE_KT" ]; then
    ok "存在 FileExchange.kt（导入选择器 + 导出落盘）"

    # 导入：必须有 onShowFileChooser，且用 ACTION_OPEN_DOCUMENT（GET_CONTENT 已废弃）
    grep -q "onShowFileChooser" "$FE_KT" \
        && ok "实现了 onShowFileChooser（不实现它，<input type=file> 点了没有任何反应）" \
        || bad "FileExchange.kt 里找不到 onShowFileChooser"
    grep -q "ACTION_OPEN_DOCUMENT" "$FE_KT" \
        && ok "导入用 Intent.ACTION_OPEN_DOCUMENT" \
        || bad "导入没用 ACTION_OPEN_DOCUMENT"
    grep -q "ACTION_GET_CONTENT" "$FE_KT" \
        && bad "仍在使用已废弃的 ACTION_GET_CONTENT" \
        || ok "未使用已废弃的 ACTION_GET_CONTENT"
    grep -q "EXTRA_MIME_TYPES" "$FE_KT" \
        && ok "给了 EXTRA_MIME_TYPES（免得部分 ROM 把 .json 灰掉）" \
        || bad "缺少 EXTRA_MIME_TYPES"

    # 取消必须回调 null：不回就等于把网页的文件输入永久挂起（最常见的坑）
    # 只统计「代码行」：注释里提到 onReceiveValue 是在解释行为，不是调用点。
    N=$(grep -vE '^[[:space:]]*(\*|//|/\*)' "$FE_KT" | grep -c "onReceiveValue" || true)
    if [ "$N" -ge 3 ]; then
        ok "onReceiveValue 真实调用 $N 处（选择器异常 / 选择返回 / 取消或释放），行首注释不计"
    else
        bad "onReceiveValue 真实调用只有 $N 处（应为 3：异常、选择返回、取消/释放缺一 → 输入会挂死）"
    fi

    # 导出：必须是 ACTION_CREATE_DOCUMENT（SAF 免权限），且分块写入
    grep -q "ACTION_CREATE_DOCUMENT" "$FE_KT" \
        && ok "导出用 Intent.ACTION_CREATE_DOCUMENT（SAF 免存储权限）" \
        || bad "导出没用 ACTION_CREATE_DOCUMENT"
    grep -q "已取消保存" "$FE_KT" \
        && ok "用户取消保存时有明确提示（不是静默）" \
        || bad "找不到取消保存的提示文案"
    grep -q "deleteDocument" "$FE_KT" \
        && ok "abort 时会删掉半截文件（不留残缺备份）" \
        || bad "找不到半截文件的清理逻辑"
else
    bad "找不到 $FE_KT"
fi

# 宿主必须真的装上 WebChromeClient（否则 FileExchange 永远是死代码）
if [ -f "$HOST_KT" ]; then
    grep -q "webChromeClient = client" "$HOST_KT" \
        && ok "WebAppHost 里设置了 webView.webChromeClient" \
        || bad "WebAppHost 没有设置 WebChromeClient（onShowFileChooser 永不回调）"
    grep -q "installChromeClient" "$PROJECT_DIR/app/src/main/java/im/bottle/focus/MainActivity.kt" \
        && ok "MainActivity 调用了 installChromeClient（不调就是死代码）" \
        || bad "MainActivity 没有调用 installChromeClient"
else
    bad "找不到 $HOST_KT"
fi

# shim 必须只拦 blob: 的 <a download>，其余 click 原样透传
grep -q "HTMLAnchorElement.prototype.click" "$SHIM_KT" \
    && ok "shim 劫持了 HTMLAnchorElement.prototype.click（blob: 导出转原生）" \
    || bad "shim 没有劫持 anchor.click，导出仍会静默失败"
grep -q '\^blob:' "$SHIM_KT" \
    && ok "只处理 /^blob:/ 的 href（其余点击原样透传）" \
    || bad "找不到 blob: 条件判断，可能把所有点击都拦掉了"
grep -q "file.export" "$SHIM_KT" \
    && ok "shim 走 file.export.* 三段式（分块，不是一次性塞几 MB）" \
    || bad "shim 没有调用 file.export.*"

# 桥不许直写 localStorage / timerState（安全边界）
# 只统计"代码行"：注释里出现这两个词是在解释边界，不算违规。
N=$(grep -h "localStorage\|timerState" "$PROJECT_DIR/app/src/main/java/im/bottle/focus/Bridge.kt" "$FE_KT" 2>/dev/null \
    | grep -vE '^[[:space:]]*(\*|//|/\*)' | wc -l | tr -d ' ')
if [ "$N" -eq 0 ]; then
    ok "Bridge.kt / FileExchange.kt 里 localStorage、timerState 出现 0 次（安全边界没破）"
else
    bad "Bridge.kt / FileExchange.kt 里出现了 $N 次 localStorage/timerState"
fi

# 不新增任何存储权限
if [ -f "$MANIFEST" ]; then
    HITS=$(grep -nE "EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE|WRITE_SETTINGS" "$MANIFEST" || true)
    if [ -z "$HITS" ]; then
        ok "manifest 没有存储类权限（SAF 免权限，导出照样能落盘）"
    else
        bad "manifest 新增了存储权限："
        printf '%s\n' "$HITS" | sed 's/^/       /'
    fi
fi

# 契约登记：版本 + 四条命令 + 文档
if [ -f "$PROTOCOL" ]; then
    grep -q '"contractVersion": "1.2.0"' "$PROTOCOL" \
        && ok "protocol.json contractVersion = 1.2.0" \
        || bad "protocol.json contractVersion 不是 1.2.0"
    for c in file.export.begin file.export.chunk file.export.end file.export.abort; do
        grep -q "\"$c\"" "$PROTOCOL" \
            && ok "protocol.json 登记了 $c" \
            || bad "protocol.json 缺少 $c"
    done
else
    bad "找不到 $PROTOCOL"
fi
if [ -f "$CONTRACT_MD" ] && grep -q "file.export.begin" "$CONTRACT_MD"; then
    ok "CONTRACT.md 补了 file.export 一节"
else
    bad "CONTRACT.md 没有 file.export 的说明"
fi

# ------------------------------- 11. 本期三项能力（正计时通知 / 小窗 / 锁机 / action）
head_ 11 "正计时通知 · 小窗 · 锁机 · 通知 action"
NOTIF_KT2="$PROJECT_DIR/app/src/main/java/im/bottle/focus/Notifications.kt"
TW_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/TimerWatch.kt"
ARM_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/ArmRules.kt"
FB_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/FloatingBubble.kt"
LG_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/LockGuard.kt"
HAR_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/HostActionReceiver.kt"
BR_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/BootReceiver.kt"
MA_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/MainActivity.kt"
BRIDGE_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/Bridge.kt"

# ---- A. 正计时（stopwatch）必须有自己的常驻通知形态 ----
[ -f "$NOTIF_KT2" ] \
    && ok "存在 Notifications.kt" || bad "找不到 Notifications.kt"
grep -q "fun showOngoingCounting" "$NOTIF_KT2" \
    && ok "Notifications.showOngoingCounting(ctx, startTimeWall, title) 存在" \
    || bad "缺少 showOngoingCounting"
grep -q "setChronometerCountDown(false)" "$NOTIF_KT2" \
    && ok "正计时常驻通知 setChronometerCountDown(false)" \
    || bad "正计时通知没有 setChronometerCountDown(false)"
grep -q "setUsesChronometer(true)" "$NOTIF_KT2" \
    && ok "通知用 setUsesChronometer(true)（秒数由 SystemUI 走，不是 App 每秒刷）" \
    || bad "缺少 setUsesChronometer(true)"
grep -q "setWhen(baseWall)" "$NOTIF_KT2" \
    && ok "Chronometer base 用 setWhen(baseWall)（倒计时/正计时共用一条通道）" \
    || bad "找不到 setWhen(baseWall)"
grep -q "private const val ID_ONGOING" "$NOTIF_KT2" \
    && ok "倒计时与正计时共用同一个 ID_ONGOING（计时中只该有一条）" \
    || bad "找不到 ID_ONGOING"

grep -q "ArmResult.Counting" "$TW_KT" \
    && ok "TimerWatch 有显式的 ArmResult.Counting（不是静默 disarm）" \
    || bad "TimerWatch 没有 ArmResult.Counting"
grep -q "armCounting" "$TW_KT" \
    && ok "TimerWatch.armCounting 落地（撤残留闹钟 + 落 session + 显示正计时通知）" \
    || bad "TimerWatch 找不到 armCounting"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$TW_KT" | grep -q 'disarm("count-up")'; then
    bad "TimerWatch 仍然把正计时 disarm 掉（本期主缺陷没修）"
else
    ok "旧的 disarm(\"count-up\") 已消失（正计时不再静默放弃）"
fi
[ -f "$ARM_KT" ] \
    && ok "存在 ArmRules.kt（纯规则层，可离线跑表）" || bad "缺少 ArmRules.kt"
grep -q "activity.onTimerState(s)" "$BRIDGE_KT" \
    && ok "Bridge 把 timer.report 同步给 MainActivity（小窗/锁机联动入口）" \
    || bad "Bridge 没有调用 activity.onTimerState(s)"

# ---- B. 小窗 ----
[ -f "$FB_KT" ] \
    && ok "存在 FloatingBubble.kt" || bad "找不到 FloatingBubble.kt"
grep -q "TYPE_APPLICATION_OVERLAY" "$FB_KT" \
    && ok "小窗用 TYPE_APPLICATION_OVERLAY" || bad "小窗没用 TYPE_APPLICATION_OVERLAY"
grep -q "FLAG_NOT_FOCUSABLE" "$FB_KT" \
    && ok "小窗 FLAG_NOT_FOCUSABLE（不抢焦点，网页仍可操作）" \
    || bad "小窗缺少 FLAG_NOT_FOCUSABLE"
grep -q "android.widget.Chronometer" "$FB_KT" \
    && ok "小窗内容用系统 Chronometer" || bad "小窗没有用 Chronometer"
grep -q "isCountDown = !session.isCounting" "$FB_KT" \
    && ok "倒计时 setCountDown(true) / 正计时 setCountDown(false)" \
    || bad "找不到 isCountDown 的两态赋值"
grep -q "updateViewLayout" "$FB_KT" \
    && ok "拖动用 updateViewLayout（不是重建 View）" || bad "找不到 updateViewLayout"
grep -q "ACTION_MANAGE_OVERLAY_PERMISSION" "$MA_KT" \
    && ok "未授权时跳 ACTION_MANAGE_OVERLAY_PERMISSION（带 package: uri）" \
    || bad "没有跳到悬浮窗授权页"
grep -q "package:\$packageName" "$MA_KT" \
    && ok "悬浮窗授权页带 package: uri" || bad "悬浮窗授权页缺 package: uri"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$FB_KT" | grep -q "requestPermissions"; then
    bad "FloatingBubble 用了 requestPermissions（SYSTEM_ALERT_WINDOW 不是运行时权限，永远 denied）"
else
    ok "FloatingBubble 没有误用 requestPermissions"
fi
grep -q "resumeHostGates" "$MA_KT" \
    && ok "MainActivity.onResume 复查授权（回来就生效，不是只提示一次）" \
    || bad "MainActivity 没有 onResume 复查"
grep -q "dismissBubbleForSession" "$FB_KT" \
    && ok "长按隐藏写 prefs（记住是哪一场，本次不再自动弹）" \
    || bad "找不到手动关闭的持久化"
grep -q "FloatingBubble.restore" "$BR_KT" \
    && ok "BootReceiver 按 session 恢复小窗（进程重启后仍在计时也显示）" \
    || bad "BootReceiver 没有恢复小窗"

# ---- C. 锁机（官方屏幕固定，不用无障碍 / DeviceAdmin） ----
[ -f "$LG_KT" ] \
    && ok "存在 LockGuard.kt" || bad "找不到 LockGuard.kt"
grep -q "startLockTask()" "$LG_KT" \
    && ok "锁机用官方 startLockTask()" || bad "没有 startLockTask()"
grep -q "stopLockTask()" "$LG_KT" \
    && ok "解锁用官方 stopLockTask()" || bad "没有 stopLockTask()"
grep -q "ACTION_PINNING_SETTINGS" "$LG_KT" \
    && ok "系统未开屏幕固定时跳 SCREEN_PINNING_SETTINGS" \
    || bad "没有跳屏幕固定设置页"
grep -q "showExitConfirm" "$LG_KT" \
    && ok "锁定期间有原生确认框出口" || bad "没有退出确认框"
grep -q "LOCK_EXIT_HOLD_MS" "$MA_KT" \
    && ok "返回键长按 1.5s 解锁（MainActivity）" || bad "没有返回键长按解锁"
grep -q "override fun onKeyDown" "$MA_KT" \
    && ok "MainActivity 接管 onKeyDown（锁定时长按计时）" || bad "没有 onKeyDown"
grep -q "LOCK_TAPS_TO_EXIT" "$MA_KT" \
    && ok "连按 3 次也能解锁（按不出长按的人有路）" || bad "没有连按解锁"
if grep -qE "AccessibilityService|BIND_ACCESSIBILITY_SERVICE|DeviceAdminReceiver|BIND_DEVICE_ADMIN" \
        "$LG_KT" "$MA_KT" "$MANIFEST"; then
    bad "锁机实现里出现了无障碍 / DeviceAdmin（本期明确不许用）"
else
    ok "锁机没有用无障碍 / DeviceAdmin"
fi
grep -q "LockGuard.stop(this)" "$MA_KT" \
    && ok "onDestroy 兜底解锁（否则用户卡在空白页）" || bad "onDestroy 没有解锁"

# ---- D. 通知 action ----
[ -f "$HAR_KT" ] \
    && ok "存在 HostActionReceiver.kt" || bad "找不到 HostActionReceiver.kt"
for a in ACTION_BUBBLE ACTION_LOCK ACTION_UNLOCK; do
    grep -q "$a" "$HAR_KT" \
        && ok "HostActionReceiver 处理 $a" || bad "缺少 $a"
done
grep -q "getBroadcast" "$HAR_KT" \
    && ok "action 用 PendingIntent.getBroadcast（不是 Activity）" \
    || bad "action 没用 getBroadcast"
grep -A2 'android:name=".HostActionReceiver"' "$MANIFEST" | grep -q 'android:exported="false"' \
    && ok "HostActionReceiver exported=false" || bad "HostActionReceiver 不是 exported=false"
grep -q "addAction" "$NOTIF_KT2" \
    && ok "常驻通知挂了 action" || bad "常驻通知没有 action"
grep -q "setOnlyAlertOnce(true)" "$NOTIF_KT2" \
    && ok "保持 setOnlyAlertOnce(true)（更新同一条不重复提醒）" \
    || bad "丢了 setOnlyAlertOnce(true)"

# 桥不许新增任何"写网页状态"的命令（小窗/锁机是纯原生动作）
NEW_CMDS=$(grep -oE '"(bubble|lock|overlay|floating)\.[a-zA-Z.]+"' "$BRIDGE_KT" 2>/dev/null || true)
if [ -z "$NEW_CMDS" ]; then
    ok "Bridge 没有新增 bubble./lock./overlay.* 命令（桥仍是只读的）"
else
    bad "Bridge 新增了状态写入类命令：$NEW_CMDS"
fi

# ------------------------------- 12. 本期离线验证（逻辑跑表 + 真页上报）
head_ 12 "离线验证（ArmRules 单元跑表 + 真页 timer.report）"
ARMRULES_SH="$PROJECT_DIR/app/tools/qa_armrules.sh"
REPORT_PY="$PROJECT_DIR/app/tools/qa_timer_report.py"
if [ -x "$ARMRULES_SH" ]; then
    if OUT=$(timeout 300 "$ARMRULES_SH" 2>&1); then
        ok "qa_armrules.sh：$(printf '%s' "$OUT" | grep -c '^PASS') 条规则断言全过"
    else
        RC=$?
        if printf '%s' "$OUT" | grep -q '^ENV:'; then
            warn "qa_armrules.sh 环境不可用（$(printf '%s' "$OUT" | grep '^ENV:' | head -1)）"
        else
            bad "qa_armrules.sh 有断言失败（退出码 $RC）："
            printf '%s\n' "$OUT" | grep -E '^FAIL' | sed 's/^/       /'
        fi
    fi
else
    bad "缺少可执行的 app/tools/qa_armrules.sh"
fi
if [ -f "$REPORT_PY" ]; then
    if OUT=$(timeout 300 python3 "$REPORT_PY" 2>&1); then
        ok "qa_timer_report.py：真页三种模式上报字段全对"
        printf '%s\n' "$OUT" | grep -E '^PASS' | sed 's/^/       /'
    else
        RC=$?
        if printf '%s' "$OUT" | grep -q '^ENV:'; then
            warn "qa_timer_report.py 环境不可用（$(printf '%s' "$OUT" | grep '^ENV:' | head -1)）"
        else
            bad "qa_timer_report.py 有用例失败（退出码 $RC）："
            printf '%s\n' "$OUT" | grep -E '^FAIL' | sed 's/^/       /'
        fi
    fi
else
    bad "缺少 app/tools/qa_timer_report.py"
fi

# 会话键的真实性：只靠静态 grep 与离线跑表都不够 —— 0.1.2 的错就在于"假设网页暂停时
# 不改 startTime"。这里用真页面录一遍 start/pause/resume/finish/restart 的**全部上报帧**，
# 再回放进线上那份 SessionKey.decide。
LIVE_PY="$PROJECT_DIR/app/tools/qa_sessionkey_live.py"
if [ -f "$LIVE_PY" ]; then
    if OUT=$(timeout 600 python3 "$LIVE_PY" 2>&1); then
        ok "qa_sessionkey_live.py：真页面帧回放全过（自由专注继续时 startTime 被重写，键仍不变）"
        printf '%s\n' "$OUT" | grep -E '^  (pomodoro|stopwatch|flowtime) |^  PASS  [ABC]' | sed 's/^/       /'
    else
        RC=$?
        if printf '%s' "$OUT" | grep -q '^ENV:'; then
            warn "qa_sessionkey_live.py 环境不可用（$(printf '%s' "$OUT" | grep '^ENV:' | head -1)）"
        else
            bad "qa_sessionkey_live.py 有用例失败（退出码 $RC）："
            printf '%s\n' "$OUT" | grep -E '^ *FAIL' | head -8 | sed 's/^/       /'
        fi
    fi
else
    bad "缺少 app/tools/qa_sessionkey_live.py"
fi

# ------------------------------- 13. 本轮 P1 回归（0.1.4）
head_ 13 "P1 回归（粘性会话键 · 锁机「锁机」不再翻转 · 门队列唯一入口 · 版本）"
SK_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/SessionKey.kt"
ST_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/State.kt"

# ---- P1-A：会话身份改成**原生维护的粘性键** ----
#
# ⚠️ 这一节替换了 0.1.2 的一条断言：
#       「会话键以 startTime 为锚点（暂停继续时 startTime 不变）」
#    那条断言的前提已被真页面实测否掉（stopwatch / flowtime 继续时必然重写 startTime），
#    属于"绿得有害"：它让一个在真机上不成立的实现看起来通过了验收。
#    现在断言的是粘性键的状态机，且 11 条用例在 qa_sessionkey.sh 里逐条跑表
#    （9–11 是 0.1.4 补的"重启后暂停态不丢键 / 真结束必换场"三条）。
[ -f "$SK_KT" ] && ok "存在 SessionKey.kt（会话身份的唯一定义）" || bad "找不到 SessionKey.kt"
grep -q 'fun decide(' "$SK_KT" \
    && ok "会话键由 decide() 状态机维护（不再从单帧 startTime 现算）" \
    || bad "SessionKey 没有 decide() 状态机"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$SK_KT" | grep -q 'startTime'; then
    bad "SessionKey 仍在用 startTime 参与判定（自由专注继续时会被重写，键必然不稳）"
else
    ok "SessionKey 的判定完全不看 startTime（暂停/继续不会换键）"
fi
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$SK_KT" | grep -q 'frame\.endAt'; then
    bad "SessionKey 用 endAt 参与判定（时钟回拨会把同一场判成新场）"
else
    ok "endAt 不参与键判定（时钟回拨 / 后台暂停不影响身份）"
fi
grep -q 'safeMode#' "$SK_KT" \
    && ok "键的形态是 mode#seq" || bad "键的形态不是 mode#<seq>"
grep -q 'seenLiveFrame' "$SK_KT" \
    && ok "冷启动首帧（页面未加载完的 idle）不清键（重启后 running=true 仍沿用）" \
    || bad "没有 seenLiveFrame：重启后一旦先收到默认 idle 帧就会误清键"

# ---- P1-A′（0.1.4）：清键只看"是否见过真实帧"，与上一帧跑没跑无关 ----
#
# 0.1.3 的清键条件写的是 `mode == IDLE && (seenLiveFrame || !prev.running)`。
# `!prev.running` 这个兜底正好命中暂停态（暂停 = running:false），于是
# 「暂停 → 杀进程 → 重开首帧 idle」把暂停那场的键清掉了：网页随后才恢复出真实帧
# （focus / false / remaining>0），四张记账（unlockedSession / askedPinSession /
# askedOverlaySession / bubbleDismissSession）全部落空 → 一暂停一继续就又跳一遍系统页。
grep -q 'if (mode == IDLE && !seenLiveFrame) return Decision(prev.key, prev.mode)' "$SK_KT" \
    && ok "重启首帧的未初始化 idle 直接沿用键（没见过真实帧就不算结束）" \
    || bad "decide() 仍会在未初始化的 idle 帧上清键（暂停 → 杀进程 → 重开 会丢键）"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$SK_KT" | grep -q '!prev.running'; then
    bad "decide() 仍带 !prev.running 兜底：暂停态重开时会被误清键（0.1.4 的缺陷）"
else
    ok "已无 !prev.running 兜底（清键与上一帧是否在跑无关）"
fi
grep -q 'if (mode == IDLE) return cleared(prev)' "$SK_KT" \
    && ok "见过真实帧后回到 idle 仍算结束（闸门只挡未初始化帧，真结束照样换场）" \
    || bad "真结束的 idle 清键路径丢了（下一场会沿用旧键，锁机永不触发）"
grep -q 'if (!frame.isCounting && frame.remaining <= 0) return cleared(prev)' "$SK_KT" \
    && ok "到点结束（remaining<=0，非正计时）仍清键（重启后首帧就是结束帧也不漏）" \
    || bad "到点结束的清键路径丢了"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$TW_KT" | grep -q "bumpSession\|markRunning"; then
    bad "TimerWatch 仍有 bumpSession/markRunning（暂停=停 → 继续=新一场，P1-1 的根因）"
else
    ok "TimerWatch 已无 bumpSession/markRunning（不再靠 running 翻转猜场次）"
fi
if grep -q "fun sessionId\|K_SESSION_ID" "$ST_KT"; then
    bad "State 仍保留递增 session id（P1-1 未修干净）"
else
    ok "State 已删除递增 session id"
fi
for f in askedPinSession askedOverlaySession bubbleDismissedSession unlockedSession; do
    if grep -q "fun $f(ctx: Context): String" "$ST_KT"; then
        ok "$f 的类型是会话键 String"
    else
        bad "$f 仍是数值型（暂停继续后会因为键不相等而失效）"
    fi
done
grep -q 'putString(K_STICKY_KEY' "$ST_KT" \
    && ok "粘性键单独落盘（跨进程重启后是同一个键；暂停清记录时也不删）" \
    || bad "粘性键没有落盘，进程重启后无法保证同一个键"
if grep -q 'remove(K_STICKY_KEY)' "$ST_KT" \
    && ! grep -A8 'fun clearSession' "$ST_KT" | grep -q 'K_STICKY_KEY'; then
    ok "clearSession（暂停/结束清记录）不删粘性键"
else
    bad "clearSession 会把粘性键一起删掉（暂停期间的解锁记账会变成空键）"
fi
grep -q 'updateStickySession' "$TW_KT" \
    && ok "TimerWatch 每帧都推进粘性键（在判定之前，活动侧随后就读它）" \
    || bad "TimerWatch 没有推进粘性键，键会永远不带更新"

# ---- P1-2：锁机默认关 + 首次原生询问 + 开关接上通知 action ----
grep -q 'K_LOCK_ENABLED, false' "$ST_KT" \
    && ok "锁机默认关闭（默认静默上锁不可接受）" \
    || bad "锁机仍然默认开启"
grep -q "fun lockIntroAsked" "$ST_KT" && grep -q "fun markLockIntroAsked" "$ST_KT" \
    && ok "存在 lock.introAsked（只问一次，跨进程有效）" \
    || bad "缺少 lock.introAsked 记账"
grep -q "showLockIntroDialog" "$MA_KT" \
    && ok "MainActivity 里有首次「专注时开启锁机？」原生对话框" \
    || bad "没有首次锁机询问对话框"
grep -q "LockGuard.setEnabled" "$MA_KT" \
    && ok "对话框的两个选项都真正落地到开关（setEnabled）" \
    || bad "对话框没有接上 setEnabled"
grep -q "fun isEnabled" "$LG_KT" && grep -q "fun setEnabled" "$LG_KT" \
    && ok "LockGuard.isEnabled/setEnabled 存在" \
    || bad "LockGuard 的开关方法丢失"
# ⚠️ 这条替换了 0.1.2 的「通知 action『锁机』接到 toggleEnabled」：
#    那个 toggle 正是 P1-B 的 bug（文案「锁机」= 开关开着但没锁，点一下却把锁机关掉）。
#    现在断言的是「锁机」只往"开"的方向走，关闭有独立 action。
grep -q "LockGuard.setEnabled(ctx, true)" "$HAR_KT" && grep -q "LockGuard.requestLock(ctx)" "$HAR_KT" \
    && ok "通知 action「锁机」= setEnabled(true) + requestLock（不翻转开关）" \
    || bad "ACTION_LOCK 没有走 setEnabled(true)+requestLock"
grep -q "LockGuard.setEnabled(ctx, false)" "$HAR_KT" && grep -q "LockGuard.requestUnlock(ctx)" "$HAR_KT" \
    && ok "关闭锁机走独立 action（ACTION_UNLOCK = setEnabled(false) + requestUnlock）" \
    || bad "ACTION_UNLOCK 没有独立关闭通路"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$LG_KT" "$HAR_KT" | grep -q "toggleEnabled"; then
    bad "仍有 toggleEnabled（「锁机」与「关锁机」共用一个翻转，P1-B 未修）"
else
    ok "toggleEnabled 已彻底删除（锁机 / 关锁机 各走各的 action）"
fi
grep -q "锁机已开启" "$HAR_KT" && grep -q "锁机已关闭" "$HAR_KT" \
    && ok "两个方向都有 toast 反馈当前状态" \
    || bad "切换后没有状态反馈"

# ---- P1-3：门队列，一帧只跳一个系统页 ----
grep -q "ArrayDeque<Gate>" "$MA_KT" \
    && ok "MainActivity 有门的队列（ArrayDeque<Gate>）" \
    || bad "没有门队列"
grep -q "private fun pumpGates" "$MA_KT" && grep -q "gateBusy = false" "$MA_KT" \
    && ok "pumpGates + onResume 放开（一次 take 一个，回来再 take 下一个）" \
    || bad "门队列没有放行逻辑"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$MA_KT" | grep -q "guideOverlayOnce"; then
    bad "仍存在 guideOverlayOnce 的直跳路径（会和屏幕固定页同帧抢栈）"
else
    ok "旧的同帧直跳路径已删除（只剩门队列一条出口）"
fi
N=$(grep -c "enqueueGate(Gate.PINNING)" "$MA_KT" || true)
[ "$N" -ge 2 ] \
    && ok "PINNING 门在 onTimerState 与 resumeHostGates 两条路径上都排（不会漏锁）" \
    || bad "PINNING 门只在一条路径上排（另一条会永远锁不上）"

# ---- P1-4：没开屏幕固定就不锁，只提示 ----
if grep -q "trying startLockTask anyway" "$LG_KT"; then
    bad "LockGuard 仍在\"没开屏幕固定\"时硬 start（用户拒绝后照样被锁）"
else
    ok "已删除\"没开也硬锁\"的分支"
fi
grep -q "未开启屏幕固定，本次不锁机" "$LG_KT" \
    && ok "没开屏幕固定时有明确 toast（不静默假装成功）" \
    || bad "缺少\"未开启屏幕固定\"的提示"

# ---- P2-1 / P2-3 / P2-4 / P2-5 ----
grep -q "isAttachedToWindow" "$FB_KT" \
    && ok "小窗用 isAttachedToWindow 判定存活（窗口被系统摘掉后能重建）" \
    || bad "小窗仍只看 root 非空（重新授权也显示不出来）"
grep -q "private fun resetState" "$FB_KT" \
    && ok "小窗有 resetState 复位（removeView 失败也不留半截状态）" \
    || bad "小窗没有状态复位"
grep -A6 "private fun resetState" "$FB_KT" | grep -q "removeView" \
    && ok "resetState 先 removeView 再清字段（不留幽灵窗）" \
    || bad "resetState 不 removeView（复位后窗口还在，谁也撤不掉）"
grep -q "FloatingBubble.hide(ctx)" "$TW_KT" \
    && ok "TimerWatch 在 running=false 时一定 hide 小窗（正计时不再靠进程死）" \
    || bad "TimerWatch 没有兜底隐藏小窗"
grep -q "BUBBLE_HIDE_REASONS" "$TW_KT" \
    && ok "disarm 按原因决定是否撤小窗（web-notify-off 不动小窗，不再闪一下）" \
    || bad "disarm 仍无条件 hide 小窗"
if awk '/BUBBLE_HIDE_REASONS =/,/\)/' "$TW_KT" | grep -q "web-notify-off"; then
    bad "web-notify-off 被算进撤小窗的原因（关通知会连带撤小窗）"
else
    ok "web-notify-off 不在撤小窗的原因集合里"
fi

# ---- P1-C：所有跳页收成一个入口 + 看门狗 ----
grep -q "private fun jumpGate" "$MA_KT" \
    && ok "存在唯一的跳页入口 jumpGate(gate)" \
    || bad "没有 jumpGate 唯一入口"
grep -q "GATE_TIMEOUT_MS" "$MA_KT" && grep -q "postDelayed(GateTimeout" "$MA_KT" \
    && ok "跳页后 post 超时看门狗（ROM 吞掉 startActivity 时 busy 不会永真）" \
    || bad "没有超时看门狗，busy 可能永真"
grep -q "if (token != gateToken) return" "$MA_KT" \
    && ok "看门狗用 token 比对（旧定时器不会误清新门）" \
    || bad "看门狗没有 token 防误清"
# openOverlaySettings 只允许被 launchGate 的两个分支调用（resumeHostGates 只排门）
N_OVERLAY_CALL=$(grep -E "(=|->) openOverlaySettings\(\)" "$MA_KT" | grep -vc "fun openOverlaySettings" || true)
if [ "$N_OVERLAY_CALL" -eq 2 ] && \
   ! sed -n '/private fun resumeHostGates/,/^    }/p' "$MA_KT" | grep -q "openOverlaySettings()"; then
    ok "openOverlaySettings 只作为门执行器（resumeHostGates 只排 OVERLAY_USER 门）"
else
    bad "openOverlaySettings 仍被直跳调用（call sites=$N_OVERLAY_CALL）"
fi
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$LG_KT" | grep -q "startActivity"; then
    bad "LockGuard 里仍有 startActivity（门队列之外的旁路，P1-C 未修）"
else
    ok "LockGuard 不再自己 startActivity（只返回 Wants，由 MainActivity 跳）"
fi
grep -q "fun pinningSettingsIntent" "$LG_KT" && grep -q "openPinningSettings" "$MA_KT" \
    && ok "屏幕固定设置页只有一个实现（MainActivity.openPinningSettings）" \
    || bad "屏幕固定设置页的跳转位置不明"
grep -q "LockGuard.Wants.PINNING_SETTINGS" "$MA_KT" \
    && ok "LockGuard 返回的门由 MainActivity 统一下发" \
    || bad "MainActivity 没有消费 LockGuard 的 Wants"
# 停表：清队列必须同时放开 busy
grep -A6 "gateQueue.clear()" "$MA_KT" | grep -q "endGate()" \
    && ok "停表时 gateQueue.clear() 同时 endGate()（busy 与看门狗一起复位）" \
    || bad "清队列没有放开 busy（之后所有引导被永久吞）"
grep -q "if (lockIntroDialogShowing) return" "$MA_KT" \
    && ok "询问框显示期间 pumpGates 停住（不在对话框上叠系统页）" \
    || bad "询问框显示期间仍会 pump"
grep -q "NotePinPageOpened\|notePinPageOpened" "$MA_KT" \
    && ok "屏幕固定设置页跳成功后才记账（跳失败不烧标记）" \
    || bad "跳失败也会烧掉 askedPinSession 标记"

# ---- P2-1：按返回键取消也要 markLockIntroAsked ----
if grep -A6 "setOnDismissListener" "$MA_KT" | grep -q "markLockIntroAsked"; then
    ok "锁机询问框的 onDismiss 也记账（返回键取消不再每场重弹）"
else
    bad "onDismiss 不记账（返回键取消后每次又弹）"
fi

# ---- P2-3：悬浮窗引导的标记写在跳页之后 ----
if grep -B2 -A4 "val jumped = openOverlaySettings()" "$MA_KT" | grep -q "markAskedOverlaySession"; then
    ok "markAskedOverlaySession 在跳页成功之后才写（跳失败不烧标记）"
else
    bad "markAskedOverlaySession 仍写在跳页前"
fi

# ---- P2-6：休息段不锁机 + 休息标题正确 ----
# 白名单：focus（番茄）+ free（自由专注），休息段（shortBreak/longBreak）不在里面。
# 写成"只认 focus"会把正计时/流式的锁机一起废掉（mode 是 free），所以这里连白名单内容一起断言。
grep -q 'setOf("focus", "free")' "$LG_KT" && grep -q "fun isLockableMode" "$LG_KT" \
    && ok "锁机按白名单收口：focus + free（休息不锁，自由专注仍锁）" \
    || bad "锁机没有按 mode 收口（或漏掉了 free，会连自由专注一起不锁）"
if grep -A2 'setOf("focus", "free")' "$LG_KT" | grep -q "shortBreak"; then
    bad "休息段被算进可锁 mode（休息也被锁机）"
else
    ok "shortBreak / longBreak 不在可锁 mode 里"
fi
grep -q 'mode == "shortBreak" -> "短休息中"' "$TW_KT" \
    && ok "短休息标题按 shortBreak 显示（不再回落成「番茄专注中」）" \
    || bad "shortBreak 标题没处理"
grep -q 'mode == "longBreak" -> "长休息中"' "$TW_KT" \
    && ok "长休息标题按 longBreak 显示" \
    || bad "longBreak 标题没处理"

# ---- 会话键离线跑表（11 条真值表用例 + 不变式；含跨进程重启、暂停态重启与时钟回拨）----
SESSIONKEY_SH="$PROJECT_DIR/app/tools/qa_sessionkey.sh"
SK_CHK="$PROJECT_DIR/app/tools/SessionKeyCheck.kt"
MISS=""
for tag in ⑨ ⑩ ⑪; do
    grep -q "$tag" "$SK_CHK" || MISS="$MISS $tag"
done
[ -z "$MISS" ] \
    && ok "SessionKeyCheck 里保留了 0.1.4 的三条重启路径用例（⑨⑩⑪）" \
    || bad "SessionKeyCheck 缺少用例：$MISS"
if [ -x "$SESSIONKEY_SH" ]; then
    if OUT=$(timeout 300 "$SESSIONKEY_SH" 2>&1); then
        ok "qa_sessionkey.sh：$(printf '%s' "$OUT" | grep -c '^PASS') 条会话键断言全过"
        printf '%s\n' "$OUT" | grep -E "暂停→继续|跨进程重启|时钟|重启且" | sed 's/^/       /'
        # 0.1.4 的三条重启路径用例：必须在**跑表输出**里逐条 PASS（只 grep 源码证明不了它跑过）。
        for tag in ⑨ ⑩ ⑪; do
            if printf '%s\n' "$OUT" | grep -q "PASS  $tag"; then
                ok "会话键用例 $tag（0.1.4 新增）逐条通过"
            else
                bad "会话键用例 $tag（0.1.4 新增）没有通过记录"
            fi
        done
    else
        RC=$?
        if printf '%s' "$OUT" | grep -q '^ENV:'; then
            warn "qa_sessionkey.sh 环境不可用（$(printf '%s' "$OUT" | grep '^ENV:' | head -1)）"
        else
            bad "qa_sessionkey.sh 有断言失败（退出码 $RC）："
            printf '%s\n' "$OUT" | grep -E '^FAIL' | sed 's/^/       /'
        fi
    fi
else
    bad "缺少可执行的 app/tools/qa_sessionkey.sh"
fi

# ------------------------------------------------------------------- 汇总
printf '\n\033[1m===== 结果：%d 通过 · %d 失败 · %d 警告 =====\033[0m\n' "$PASS" "$FAIL" "$WARN"
if [ "$FAIL" -eq 0 ]; then
    printf '\033[32mIS_PASS: YES\033[0m\n'
    exit 0
fi
printf '\033[31mIS_PASS: NO\033[0m\n'
exit 1
