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
# 测试机"看起来已经升级"（覆盖安装成功、功能却是旧的）。0.1.2 同理，0.1.4 同理。
# 所以这里是修正版本漂移，不是把断言放松：版本号必须精确等于本次要发的包。
# 0.2.1 / 7：小窗时间基准重算（Bug 1）+ 计时期间前台服务（Bug 2）。
# 0.2.2 / 8：guard.active 残留收尾（P1-1）+ FGS 异常安全（P2-1）+ 通知收尾（P2-2）。
# 0.2.3 / 9：正计时场次被进程重启后清拦截镜像（P1-2）+ finally 内 runCatching（P2）。
printf '%s\n' "$BADGING" | grep -q "versionName='0.2.3'" \
    && ok "versionName 0.2.3" || bad "versionName 不是 0.2.3"
printf '%s\n' "$BADGING" | grep -q "versionCode='9'" \
    && ok "versionCode 9" || bad "versionCode 不是 9"
printf '%s\n' "$BADGING" | grep -q "^sdkVersion:'26'" \
    && ok "minSdk 26" || bad "minSdk 不是 26"
printf '%s\n' "$BADGING" | grep -q "^targetSdkVersion:'34'" \
    && ok "targetSdk 34" || bad "targetSdk 不是 34"

# ------------------------------------------------------------------ 2. 权限
head_ 2 "权限清单（android.permission.* 恰好 7 条，且无 INTERNET）"
for p in POST_NOTIFICATIONS VIBRATE SCHEDULE_EXACT_ALARM RECEIVE_BOOT_COMPLETED SYSTEM_ALERT_WINDOW FOREGROUND_SERVICE FOREGROUND_SERVICE_SPECIAL_USE; do
    printf '%s\n' "$BADGING" | grep -q "uses-permission: name='android.permission.$p'" \
        && ok "已声明 $p" || bad "缺少 $p"
done
# 总数：7 条。（aapt2 还会列出 im.bottle.focus.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION，
# 那是 androidx.core 自动生成的签名级权限，不属于 android.permission.*，这里不计。）
PERM_COUNT=$(printf '%s\n' "$BADGING" | grep -c "uses-permission: name='android.permission.")
if [ "$PERM_COUNT" -eq 7 ]; then
    ok "android.permission.* 恰好 7 条（5 条旧 + FOREGROUND_SERVICE + FOREGROUND_SERVICE_SPECIAL_USE）"
else
    bad "android.permission.* 有 $PERM_COUNT 条（应为 7）"
fi
# FOREGROUND_SERVICE 本身已从"禁止清单"移出（0.2.1 的 TimerService 需要它），
# 但 INTERNET 仍然是硬红线：不声明 = 数据物理上出不了设备。
for p in INTERNET WAKE_LOCK USE_EXACT_ALARM; do
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

# ---- B2. 小窗时间基准重算（Bug 1：暂停继续 / 回前台补 gap 后必须重算 base） ----
grep -q "shownEndAt" "$FB_KT" && grep -q "shownStartTime" "$FB_KT" && grep -q "shownCounting" "$FB_KT" \
    && ok "小窗记住当前 base 对应的 endAt / startTime / 是否正计时" \
    || bad "小窗没有记录时间基准字段（键同、基准变时无从判断）"
grep -q "shownEndAt == session.endAt" "$FB_KT" \
    && ok "闸门比较 endAt（不再只比会话键 + 形态）" \
    || bad "闸门仍然只比会话键（暂停继续后小窗会越走越快）"
grep -q "fun retuneChronometer" "$FB_KT" \
    && ok "存在 retuneChronometer（键同、基准变 → 只重算 base）" \
    || bad "缺少 retuneChronometer"
if awk '/fun retuneChronometer/,/^    }/' "$FB_KT" | grep -qE "addView|removeView|showInternal"; then
    bad "retuneChronometer 里重建了窗口（会闪、会丢拖动位置）"
else
    ok "retuneChronometer 不重建窗口（只动 Chronometer 的 base）"
fi
grep -q "chrono.stop()" "$FB_KT" && grep -q "chrono.start()" "$FB_KT" \
    && ok "retune 时 stop → 改 base → start（同一帧完成，用户看不到跳变）" \
    || bad "retune 没有重新对齐 Chronometer 的节拍"
if awk '/fun retuneChronometer/,/^    }/' "$FB_KT" | grep -qE "postDelayed|Handler\("; then
    bad "retuneChronometer 里起了定时器（零周期 Handler 的设计不能破）"
else
    ok "retuneChronometer 不起任何 Handler"
fi
grep -q "shownEndAt = 0L" "$FB_KT" && grep -q "shownStartTime = 0L" "$FB_KT" \
    && ok "hide 时基准字段一并清零（避免下一次 show 前的误判）" \
    || bad "hide 没有清基准字段"
grep -q "fun refreshSession" "$TW_KT" \
    && ok "Keep 分支把网页最新 endAt 落进 session（小窗/通知读的是同一份真源）" \
    || bad "Keep 分支不更新 session（小窗会拿着旧 endAt）"

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
# 0.2.0 起：锁机（LockGuard）仍然只用官方屏幕固定 —— 这一条一个字都没放松。
# ⚠️ 断言范围**收窄**到 LockGuard.kt：manifest 里现在**必须**有 <service> 无障碍声明
#    （应用锁是另一个功能，设计 §1 A1）。旧断言的意图（"锁机不许用无障碍/DeviceAdmin"）
#    完全保留，新增的正面断言在第 14 节。
if grep -qE "AccessibilityService|BIND_ACCESSIBILITY_SERVICE|DeviceAdminReceiver|BIND_DEVICE_ADMIN" \
        "$LG_KT"; then
    bad "锁机实现里出现了无障碍 / DeviceAdmin（本期明确不许用）"
else
    ok "锁机没有用无障碍 / DeviceAdmin（断言范围收窄到 LockGuard.kt，意图未变）"
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

# ------------------------------- 14. 0.2.0：应用锁 / 原生设置页 / 小窗任务名
head_ 14 "0.2.0 增量（应用锁 · 两级设置页 · 入口链路 · 小窗任务名）"

GR_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/GuardRules.kt"
GUARD_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/Guard.kt"
GSS_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/GuardService.kt"
GOV_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/GuardOverlay.kt"
SET_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/AppSettingsActivity.kt"
SETUI_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/SettingsUi.kt"
GAPPS_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/GuardAppsActivity.kt"
APP_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/App.kt"
ACFG="$PROJECT_DIR/app/src/main/res/xml/accessibility_service_config.xml"
SHORTCUTS="$PROJECT_DIR/app/src/main/res/xml/shortcuts.xml"
GRADLE_APP="$PROJECT_DIR/app/build.gradle.kts"

# ---- A. 应用锁：纯逻辑层 / 服务 / 遮罩三个文件各就各位 ----
for f in "$GR_KT" "$GUARD_KT" "$GSS_KT" "$GOV_KT"; do
    [ -f "$f" ] && ok "存在 $(basename "$f")" || bad "缺少 $(basename "$f")"
done
grep -q "class GuardService : AccessibilityService()" "$GSS_KT" \
    && ok "GuardService 是 AccessibilityService（无障碍服务）" \
    || bad "GuardService 不是 AccessibilityService"
grep -qE "^import .*android\." "$GR_KT" \
    && bad "GuardRules.kt 引入了 android.*（纯逻辑层必须零 Android 依赖，否则离线跑表编不过）" \
    || ok "GuardRules.kt 零 Android 依赖（可离线跑表）"

# ---- B. 无障碍配置：隐私最小化逐条断言（设计 §3.3 / A7）----
if [ -f "$ACFG" ]; then
    ok "存在 res/xml/accessibility_service_config.xml"
    grep -q 'canRetrieveWindowContent="false"' "$ACFG" \
        && ok "canRetrieveWindowContent=false（只读包名，不读窗口内容）" \
        || bad "canRetrieveWindowContent 不是 false（隐私面失控）"
    # 只看属性，不看注释（注释里正解释"为什么留空"）
    grep -q 'android:packageNames' "$ACFG" \
        && bad "配置里出现了 packageNames（限定后收不到 launcher/systemui 事件，等于失效）" \
        || ok "packageNames 留空（全量监听，靠 event.packageName 过滤）"
    grep -q 'accessibilityEventTypes="typeWindowStateChanged"' "$ACFG" \
        && ok "只收 typeWindowStateChanged" || bad "事件类型不是只有 typeWindowStateChanged"
    grep -q 'notificationTimeout="100"' "$ACFG" \
        && ok "notificationTimeout=100（合并快速切换的抖动）" || bad "notificationTimeout 不是 100"
    grep -q 'accessibilityFlags="flagDefault"' "$ACFG" \
        && ok "accessibilityFlags 只有 flagDefault" || bad "accessibilityFlags 不是 flagDefault"
    grep -q 'canPerformGestures="false"' "$ACFG" && grep -q 'canRequestFilterKeyEvents="false"' "$ACFG" \
        && ok "不请求手势 / 键盘事件（权限面最小）" || bad "手势或键盘事件开关没关"
    grep -q 'android:settingsActivity' "$ACFG" \
        && bad "配置里有 settingsActivity（多一个跳板，部分 ROM 打开即崩）" \
        || ok "没有 settingsActivity"
else
    bad "缺少 $ACFG"
fi

# ---- C. Manifest：service 声明（不是 uses-permission）+ 仍是 7 条权限 ----
grep -q 'android:name=".GuardService"' "$MANIFEST" \
    && ok "manifest 声明了 .GuardService" || bad "manifest 没有 .GuardService"
grep -q 'android.permission.BIND_ACCESSIBILITY_SERVICE' "$MANIFEST" \
    && ok "service 由 BIND_ACCESSIBILITY_SERVICE 保护" || bad "缺少 BIND_ACCESSIBILITY_SERVICE 保护"
grep -A8 'android:name=".GuardService"' "$MANIFEST" | grep -q 'android:exported="true"' \
    && ok "GuardService exported=true（系统要能绑定）" || bad "GuardService 不是 exported=true"
# APK 级验证：声明真的打进了包（源代码里有不算数）
if "$AAPT2" dump xmltree "$APK" --file AndroidManifest.xml 2>/dev/null | grep -q "GuardService"; then
    ok "APK 的 AndroidManifest 里确有 GuardService（不只是源码里有）"
else
    bad "APK 里没有 GuardService 声明"
fi
# 无障碍是 <service>，不是 <uses-permission>：权限条数必须仍是 7（第 2 节已断言 INTERNET 不存在）
[ "$PERM_COUNT" -eq 7 ] \
    && ok "无障碍 + TimerService 之后 android.permission.* 是 7 条（服务声明不产生新权限）" \
    || bad "权限条数变了（$PERM_COUNT），应为 7"

# ---- C2. TimerService：保活前台服务声明（Bug 2）----
grep -q 'android:name=".TimerService"' "$MANIFEST" \
    && ok "manifest 声明了 .TimerService" || bad "manifest 没有 .TimerService"
grep -A5 'android:name=".TimerService"' "$MANIFEST" | grep -q 'android:exported="false"' \
    && ok "TimerService exported=false（只有本 App 能起它）" \
    || bad "TimerService 不是 exported=false"
grep -A5 'android:name=".TimerService"' "$MANIFEST" | grep -q 'foregroundServiceType="specialUse"' \
    && ok "TimerService foregroundServiceType=specialUse" \
    || bad "TimerService 没有 foregroundServiceType=specialUse"
grep -q 'PROPERTY_SPECIAL_USE_FGS_SUBTYPE' "$MANIFEST" \
    && ok "TimerService 声明了 specialUse 子类型（API 34 要求用途可解释）" \
    || bad "缺少 PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
# APK 级验证：类型真的打进了包（源码里有不算数）
if "$AAPT2" dump xmltree "$APK" --file AndroidManifest.xml 2>/dev/null | grep -q "TimerService"; then
    ok "APK 的 AndroidManifest 里确有 TimerService（不只是源码里有）"
else
    bad "APK 里没有 TimerService 声明"
fi
TS_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/TimerService.kt"
[ -f "$TS_KT" ] && ok "存在 TimerService.kt" || bad "找不到 TimerService.kt"
grep -q "ServiceCompat.startForeground(this, Notifications.ONGOING_ID" "$TS_KT" \
    && ok "TimerService 用同一条常驻通知的 id 调 startForeground（不会出现两条）" \
    || bad "TimerService 没有复用 ONGOING_ID"
grep -q "STOP_FOREGROUND_REMOVE" "$TS_KT" \
    && ok "TimerService 退出路径 stopForeground(STOP_FOREGROUND_REMOVE)" \
    || bad "TimerService 没有 stopForeground(REMOVE)"
grep -q "startForegroundService refused" "$TS_KT" && grep -q "catch (e: Exception)" "$TS_KT" \
    && ok "TimerService 对后台启动限制做了 catch（降级为只有通知）" \
    || bad "TimerService 没兜住 ForegroundServiceStartNotAllowedException"
grep -q "START_STICKY" "$TS_KT" \
    && ok "TimerService onStartCommand 返回 START_STICKY" \
    || bad "TimerService 不是 START_STICKY"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$TS_KT" | grep -qE "setInterval|Handler|postDelayed|Thread"; then
    bad "TimerService 自己在做计时/定时（它只该保活 + 持有通知）"
else
    ok "TimerService 不做任何计时（无 Handler / 无周期任务）"
fi
grep -q "TimerService.ensure" "$TW_KT" && grep -q "TimerService.stop" "$TW_KT" \
    && ok "TimerWatch 在 arm / disarm 里收放 TimerService" \
    || bad "TimerWatch 没有接上 TimerService"
grep -q "REPORT_GAP_WARN_MS" "$TW_KT" \
    && ok "TimerWatch 有上报间隔诊断（> 90s 打 report gap，带 bgPause 与端到端漂移）" \
    || bad "TimerWatch 没有 report gap 诊断日志"

# ---- D. 拦截顺序：先 addView 遮罩，下一帧才 HOME ----
if awk '/GuardOverlay\.show/{s=NR} /performGlobalAction/{h=NR} END{exit !(s>0 && h>s)}' "$GSS_KT"; then
    ok "先 GuardOverlay.show 再 performGlobalAction（先盖后打，A2）"
else
    bad "拦截顺序不对：HOME 早于遮罩上屏（会看到目标 App 闪一帧）"
fi
grep -q "postFrameCallback" "$GSS_KT" && grep -q "HOME_FALLBACK_MS" "$GSS_KT" \
    && ok "HOME 排在下一帧（Choreographer）+ 有兜底定时器" \
    || bad "HOME 没有排下一帧 / 没有兜底"
grep -q "FLAG_NOT_FOCUSABLE" "$GOV_KT" && grep -q "TYPE_APPLICATION_OVERLAY" "$GOV_KT" \
    && ok "遮罩 FLAG_NOT_FOCUSABLE + TYPE_APPLICATION_OVERLAY（A2c）" \
    || bad "遮罩窗口参数不对"
for c in "MIN_SHOW_MS = 1_200" "MAX_SHOW_MS = 6_000" "LONG_PRESS_MS = 2_000"; do
    grep -q "$c" "$GOV_KT" && ok "遮罩常量 $c" || bad "缺少遮罩常量 $c"
done
grep -q "markUnlockedSession" "$GOV_KT" \
    && ok "长按 2s = 「本场不再拦」（按会话键记账）" || bad "缺少本场放行"
grep -q "PendingIntent.getActivity" "$GOV_KT" \
    && ok "「回到专注」走 PendingIntent（绕过后台启动限制）" || bad "回到专注没有走 PendingIntent"

# ---- E. 拦截条件与节流 ----
grep -q "THROTTLE_MS = 1_500" "$GSS_KT" \
    && ok "同包名 1.5s 节流" || bad "缺少同包节流"
grep -q "if (LockGuard.isLockedTask(this)) return" "$GSS_KT" \
    && ok "深度锁机生效期间 GuardService 直接 return（A1b）" || bad "锁机期间仍在拦截"
grep -q "fun isActive(mode: String, running: Boolean, paused: Boolean)" "$GR_KT" \
    && ok "拦截条件收成纯函数 isActive(running && !paused && mode ∈ {focus,free})" \
    || bad "缺少纯函数形式的拦截条件"
grep -q 'setOf("focus", "free")' "$GR_KT" && grep -q 'setOf("focus", "free")' "$LG_KT" \
    && ok "应用锁与锁机的 mode 白名单字面量一致（口径不分叉）" \
    || bad "两处 mode 白名单不一致（会出现「锁机在专注、应用锁在休息」）"
if grep -vE '^[[:space:]]*(\*|//|/\*)' "$GR_KT" | grep -q "shortBreak"; then
    bad "GuardRules 代码里出现 shortBreak 分支（休息段不该有特殊分支，白名单已覆盖）"
else
    ok "休息段靠白名单收口（代码里没有黑名单式的 special case）"
fi

# ---- F. 白名单：launcher / IME 动态取，不硬编码 ----
grep -q "queryIntentActivities" "$GUARD_KT" && grep -q "CATEGORY_LAUNCHER" "$GUARD_KT" \
    && ok "launcher 白名单由 queryIntentActivities 动态取（A3）" || bad "launcher 白名单没有动态获取"
grep -q "enabledInputMethodList" "$GUARD_KT" \
    && ok "IME 白名单由 InputMethodManager 动态取" || bad "IME 白名单没有动态获取"
grep -vE '^[[:space:]]*(\*|//|/\*)' "$GUARD_KT" | grep -q "com.miui.home" \
    && bad "Guard.kt 里硬编码了某家 launcher 包名（必翻车）" \
    || ok "没有硬编码 launcher 包名（只在注释里举例）"
grep -q '"com.android.settings"' "$GR_KT" \
    && ok "设置类应用放行（用户要能关服务 / 开热点）" || bad "设置被拦了（用户会无法关闭无障碍）"
grep -q "WHITELIST_TTL_MS" "$GUARD_KT" \
    && ok "白名单缓存 60s（不是每个事件都 queryIntentActivities）" || bad "白名单没有缓存"

# ---- G. 服务掉线检测：双路交叉 ----
grep -q "ENABLED_ACCESSIBILITY_SERVICES" "$GUARD_KT" \
    && ok "检测路径①：Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES" || bad "缺少 Secure 串检测"
grep -q "getEnabledAccessibilityServiceList" "$GUARD_KT" \
    && ok "检测路径②：AccessibilityManager.getEnabledAccessibilityServiceList" || bad "缺少 Manager 检测"
grep -q "fun repairResidue" "$GUARD_KT" && grep -q "Guard.repairResidue" "$APP_KT" \
    && grep -q "Guard.repairResidue" "$MA_KT" \
    && ok "repairResidue 在 App.onCreate 与 MainActivity.onResume 都跑（§6 第 11 条）" \
    || bad "repairResidue 少了一个入口（会出现「没计时也拦」）"
grep -q "Guard.syncActive" "$TW_KT" \
    && ok "guard.active 镜像由 TimerWatch.onReport 每帧写（唯一写者）" \
    || bad "TimerWatch 没有写 guard.active"

# ---- H. prefs 的 Set<String> 拷贝语义 ----
grep -q "HashSet(raw)" "$ST_KT" && grep -q "putStringSet(K_GUARD_APPS, HashSet(apps))" "$ST_KT" \
    && ok "guard.apps 读写都做 HashSet 拷贝（B4 的经典坑）" \
    || bad "guard.apps 没有拷贝语义（改了不落盘）"

# ---- I. 两级设置页：framework View，不引 UI 库 ----
for f in "$SET_KT" "$SETUI_KT" "$GAPPS_KT"; do
    [ -f "$f" ] && ok "存在 $(basename "$f")" || bad "缺少 $(basename "$f")"
done
grep -q "androidx.preference\|androidx.appcompat" "$GRADLE_APP" \
    && bad "build.gradle.kts 引入了 androidx.preference / appcompat（会与 framework 主题冲突且 +1.5MB）" \
    || ok "没有引入 androidx.preference / appcompat（纯 framework View）"
grep -q 'android:name=".AppSettingsActivity"' "$MANIFEST" \
    && grep -A4 'android:name=".AppSettingsActivity"' "$MANIFEST" | grep -q 'exported="false"' \
    && ok "AppSettingsActivity 已声明且 exported=false" || bad "AppSettingsActivity 声明不对"
grep -q 'android:name=".GuardAppsActivity"' "$MANIFEST" \
    && ok "GuardAppsActivity 已声明" || bad "GuardAppsActivity 未声明"
grep -q "Theme.BottleFocus.Settings" "$MANIFEST" \
    && ok "两个设置页都用 Theme.BottleFocus.Settings" || bad "设置页没有用子主题"
grep -q "cornerRadius = dp(ctx, 12)" "$SETUI_KT" \
    && ok "卡片圆角 12dp（SettingsUi 行工厂）" || bad "卡片圆角不是 12dp"
grep -q "minimumHeight = dp(ctx, 56)" "$SETUI_KT" \
    && ok "设置行高 56dp" || bad "设置行高不是 56dp"
grep -q "leftMargin = dp(ctx, 16)" "$SETUI_KT" \
    && ok "分割线内缩进 16dp（不吃满整行）" || bad "分割线没有内缩进"

# ---- J. 应用列表：queries 声明，不用 QUERY_ALL_PACKAGES ----
grep -q "android.intent.category.LAUNCHER" "$MANIFEST" && grep -q "<queries>" "$MANIFEST" \
    && ok "manifest <queries> 声明了 MAIN/LAUNCHER" || bad "缺少 <queries> 声明（列不出应用）"
# 只看 uses-permission 行（注释里正解释"为什么不用它"）
grep -qE 'uses-permission[^>]*QUERY_ALL_PACKAGES' "$MANIFEST" \
    && bad "声明了 QUERY_ALL_PACKAGES（高敏权限，B3 明确不用）" || ok "没有 QUERY_ALL_PACKAGES"
grep -q "searchInput" "$PROJECT_DIR/app/src/main/res/layout/activity_guard_apps.xml" \
    && ok "应用选择页有搜索框" || bad "应用选择页没有搜索框"
grep -q "compareByDescending<AppEntry> { it.pkg in selected }" "$GAPPS_KT" \
    && ok "已选应用优先排序" || bad "已选应用没有优先排序"
grep -q "icon.tag = e.pkg" "$GAPPS_KT" && grep -q "if (icon.tag == e.pkg)" "$GAPPS_KT" \
    && ok "异步图标用 tag 比对防错位" || bad "异步图标没有 tag 比对（过滤后会贴错行）"
grep -q 'android:visibility="invisible"' "$PROJECT_DIR/app/src/main/res/layout/item_app_choice.xml" \
    && ok "选中竖条默认 INVISIBLE（勾选时文字不左右跳）" || bad "选中竖条用了 GONE / 缺失"

# ---- K. 深色模式：values-night 覆盖（资源限定符方案） ----
if [ -f "$PROJECT_DIR/app/src/main/res/values-night/colors.xml" ]; then
    ok "存在 values-night/colors.xml（深色模式走资源限定符）"
    L=$(grep -o 'name="settings_[a-z_]*"' "$PROJECT_DIR/app/src/main/res/values/colors.xml" | sort)
    N=$(grep -o 'name="settings_[a-z_]*"' "$PROJECT_DIR/app/src/main/res/values-night/colors.xml" | sort)
    [ "$L" = "$N" ] \
        && ok "深浅两套配色键名一一对应（$(printf '%s\n' "$L" | grep -c .) 个键）" \
        || bad "深浅配色键名不一致（会回落到浅色，出现「深色页里白卡片」）"
else
    bad "缺少 values-night/colors.xml"
fi

# ---- L. 入口：快捷方式 / 网页注入 / 通知 action ----
[ -f "$SHORTCUTS" ] && grep -q 'android.app.shortcuts' "$MANIFEST" \
    && ok "静态快捷方式已声明（设置页主入口，B1）" || bad "缺少静态快捷方式"
grep -q "ACTION_ACCESSIBILITY_SETTINGS" "$MA_KT" && grep -q "ACTION_SETTINGS" "$MA_KT" \
    && ok "无障碍授权页用标准 action，失败退 ACTION_SETTINGS（A6）" || bad "无障碍授权页跳转缺失"
grep -q "ACCESSIBILITY," "$MA_KT" && grep -q "Gate.ACCESSIBILITY ->" "$MA_KT" \
    && ok "门队列里有 Gate.ACCESSIBILITY" || bad "门队列没有 ACCESSIBILITY"
if awk '/private fun enqueueStartGates/,/^    }/' "$MA_KT" | awk \
        '/enqueueAccessibilityGateIfNeeded/{a=NR} /enqueueGate\(Gate.PINNING\)/{p=NR} END{exit !(a>0 && p>a)}'; then
    ok "无障碍门排在屏幕固定之前（lockTask 一生效就跳不出去）"
else
    bad "门顺序不对：PINNING 早于 ACCESSIBILITY"
fi
grep -q "if (guardDialogShowing) return" "$MA_KT" \
    && ok "应用锁提示框显示期间 pumpGates 停住（不叠系统页）" || bad "提示框期间仍会 pump"
grep -q "ACTION_APP_SETTINGS" "$MA_KT" && grep -q "override fun onNewIntent" "$MA_KT" \
    && ok "MainActivity 处理 ACTION_APP_SETTINGS（shortcut / 通知进来，不占门）" \
    || bad "MainActivity 没有处理设置入口 Intent"
grep -q '"app.settings" ->' "$BRIDGE_KT" && grep -q 'put("opened", true)' "$BRIDGE_KT" \
    && ok "桥新增 app.settings（只打开原生页，返回 {opened:true}）" || bad "桥缺少 app.settings"
awk '/"app.settings" ->/,/^            }/' "$BRIDGE_KT" | grep -q "openAppSettings" \
    && ok "app.settings 的实现只调 openAppSettings（没有任何写网页状态的能力）" \
    || bad "app.settings 里出现了别的动作"
grep -q 'data-bottle-native' "$SHIM_KT" \
    && ok "shim 注入的节点带 data-bottle-native（去重）" || bad "shim 注入没有去重标记"
grep -q "MutationObserver" "$SHIM_KT" && grep -q "GIVE_UP_MS = 5000" "$SHIM_KT" \
    && ok "shim 注入用 MutationObserver + 5s 超时静默放弃" || bad "shim 注入没有超时放弃"
grep -q "call('app.settings')" "$SHIM_KT" \
    && ok "shim 注入行点击走 call('app.settings')" || bad "注入行没有接桥"
grep -q 'ACTION_SETTINGS = "' "$HAR_KT" \
    && ok "HostActionReceiver 新增 ACTION_SETTINGS" || bad "缺少通知栏「设置」action"
grep -q 'canBubble && "bubble" in actions' "$NOTIF_KT2" \
    && grep -q '!canBubble && "settings" in actions' "$NOTIF_KT2" \
    && ok "通知 action 条件化（有权限→小窗，无权限→设置）" || bad "通知 action 没有条件化"

# ---- M. T05 小窗任务名链路（网页 → 原生单向） ----
grep -q ", taskName\].join('|')" "$SHIM_KT" \
    && ok "taskName 进了 lastSig（改名才会触发一次上报，C1）" || bad "taskName 没进签名"
grep -q "slice(0, 64)" "$SHIM_KT" \
    && ok "shim 侧截断 64 字符" || bad "shim 侧没有截断任务名"
grep -q "val taskName: String = \"\"" "$ST_KT" \
    && ok "TimerState / SessionRecord 都有 taskName（默认空串，老构造点不用改）" \
    || bad "State 里缺少 taskName 字段"
grep -q 'K_SESSION_TASK_NAME = "session.taskName"' "$ST_KT" \
    && ok "落盘键 session.taskName" || bad "没有 session.taskName 落盘键"
grep -q "FloatingBubble.updateTaskName" "$TW_KT" \
    && ok "TimerWatch 每帧把任务名交给小窗" || bad "TimerWatch 没有传任务名"
grep -q "fun updateTaskName" "$FB_KT" \
    && ok "FloatingBubble.updateTaskName 存在" || bad "缺少 updateTaskName"
if awk '/fun updateTaskName/,/^    }/' "$FB_KT" | grep -qE "addView|showInternal|postDelayed"; then
    bad "updateTaskName 里重建窗口 / 起了定时器（C3：只许 setText）"
else
    ok "updateTaskName 只 setText（不重建窗口、不加 Handler）"
fi
grep -q "WIDTH_DP = 148" "$FB_KT" && grep -q "HEIGHT_DP = 48" "$FB_KT" \
    && ok "胶囊 148×48dp（原 96×44）" || bad "胶囊尺寸不是 148×48"
grep -q "NAME_MAX_WIDTH_DP = 72" "$FB_KT" && grep -q "TruncateAt.END" "$FB_KT" \
    && ok "任务名 12sp / maxWidth 72dp / ellipsize=END" || bad "任务名显示参数不对"
grep -q "WIDTH_COMPACT_DP = 96" "$FB_KT" \
    && ok "关掉任务名后回落 96dp（开关真的生效）" || bad "缺少紧凑形态"

# ---- N. Guard 纯逻辑跑表（白名单 / 拦截条件 / 失效计数 / residue）----
GUARD_SH="$PROJECT_DIR/app/tools/qa_guard.sh"
GUARD_CHECK="$PROJECT_DIR/app/tools/GuardCheck.kt"
[ -f "$GUARD_CHECK" ] && ok "存在 app/tools/GuardCheck.kt（离线跑表）" || bad "缺少 GuardCheck.kt"
if [ -x "$GUARD_SH" ]; then
    if OUT=$(timeout 300 "$GUARD_SH" 2>&1); then
        N=$(printf '%s' "$OUT" | grep -c '^PASS')
        ok "qa_guard.sh：$N 条应用锁断言全过"
        printf '%s\n' "$OUT" | grep -E '^PASS  (自己包名|小米 launcher|focus \+ running|shortBreak|active=true 但|第 2 次)' \
            | sed 's/^/       /'
        if [ "$N" -ge 60 ]; then
            ok "应用锁跑表用例数 $N ≥ 60（覆盖白名单 / 拦截条件 / 失效计数 / residue）"
        else
            bad "应用锁跑表用例只有 $N 条（应 ≥ 60）"
        fi
        # 0.2.2 的 P1-1 用例必须在**跑表输出**里逐条 PASS（只 grep 源码证明不了它跑过）
        for tag in "recheck：倒计时到点" "recheck：savedAt=0（会话还没落盘）" \
                   "recheck：正计时超过 8h" "repairResidue：会话已过期（倒计时 endAt 已过）" \
                   "repairResidue：会话已过期（正计时 savedAt + 8h 已过）"; do
            if printf '%s\n' "$OUT" | grep -q "PASS  $tag"; then
                ok "应用锁跑表：$tag"
            else
                bad "应用锁跑表缺少 P1-1 用例「$tag」"
            fi
        done
    else
        if printf '%s' "$OUT" | grep -q '^ENV:'; then
            warn "qa_guard.sh 环境不可用（$(printf '%s' "$OUT" | grep '^ENV:' | head -1)）"
        else
            bad "qa_guard.sh 有断言失败："
            printf '%s\n' "$OUT" | grep -E '^FAIL' | sed 's/^/       /'
        fi
    fi
else
    bad "缺少可执行的 app/tools/qa_guard.sh"
fi

# ---- O. 契约检查器仍 0 FAIL（新增 app.settings 不碰 android-kernel 的契约面）----
CHK="$PROJECT_DIR/../tools/check_contracts.py"
if [ -f "$CHK" ]; then
    if OUT=$(timeout 300 python3 "$CHK" 2>&1); then
        ok "tools/check_contracts.py 全过（$(printf '%s' "$OUT" | grep -c '^PASS') PASS / 0 FAIL）"
    else
        bad "契约检查有 FAIL："
        printf '%s\n' "$OUT" | grep -E '^FAIL' | head -5 | sed 's/^/       /'
    fi
else
    warn "找不到 $CHK，跳过契约检查"
fi

# ------------------------------- 15. 0.2.2：guard.active 残留 / FGS 异常安全 / 通知收尾
head_ 15 "0.2.2 增量（P1-1 guard.active 残留 · P2-1 FGS 异常安全 · P2-2 通知收尾）"

AR_KT="$PROJECT_DIR/app/src/main/java/im/bottle/focus/AlarmReceiver.kt"

# ---- P1-1① AlarmReceiver 必须做全三条清理（旧代码只停服务、撤通知）----
[ -f "$AR_KT" ] && ok "存在 AlarmReceiver.kt" || bad "找不到 AlarmReceiver.kt"
if grep -q "State.clearSession(context)" "$AR_KT" \
    && grep -q "State.clearStickySession(context)" "$AR_KT" \
    && grep -q "Guard.clearActive(context)" "$AR_KT"; then
    ok "AlarmReceiver 到点收尾清 session + 粘性键 + guard.active（guard.active 不再永久残留）"
else
    bad "AlarmReceiver 少了一条清理（黑名单 App 会被永久拦）"
fi
# 收尾必须真的走到：三条 clear 都在 showAlert 之后（响铃失败也不影响收尾）
if awk '/Notifications\.showAlert/{s=NR} /State\.clearSession/{a=NR} /State\.clearStickySession/{b=NR} /Guard\.clearActive/{c=NR} END{exit !(s>0 && a>s && b>a && c>b)}' "$AR_KT"; then
    ok "三条清理排在响铃之后且顺序为 session → 粘性键 → guard.active"
else
    bad "AlarmReceiver 的清理顺序不对（或在响铃之前就 return 了）"
fi
# 双份收尾必须消失（两份"到点该清什么"必然漂移，P1-1 就是这么漏的）
grep -q "fun onAlarmFired" "$TW_KT" \
    && bad "TimerWatch.onAlarmFired 还在（没有调用者的第二份收尾）" \
    || ok "TimerWatch.onAlarmFired 已删（到点收尾只有 AlarmReceiver 一处实现）"

# ---- P1-1② GuardService 的时间复核：30s 节流 + 调 Guard.recheckExpired ----
grep -q "fun recheckExpired(ctx: Context)" "$GUARD_KT" \
    && ok "Guard.recheckExpired 存在" || bad "缺少 Guard.recheckExpired"
if awk '/override fun onAccessibilityEvent/,/^    }$/' "$GSS_KT" | grep -q "recheckExpiredIfDue()"; then
    ok "onAccessibilityEvent 里调了过期复核（放在所有 return 之前）"
else
    bad "onAccessibilityEvent 没有触发过期复核（guard.active 还是会永久残留）"
fi
grep -q "Guard.recheckExpired(this)" "$GSS_KT" \
    && ok "复核真的落到 Guard.recheckExpired（不是空函数）" \
    || bad "GuardService 没有调 Guard.recheckExpired"
grep -q "lastRecheckAt" "$GSS_KT" && grep -q "RECHECK_MS = 30_000" "$GSS_KT" \
    && ok "复核 30s 节流（lastRecheckAt 字段，不每个事件读 prefs）" \
    || bad "复核没有 30s 节流"
# 复核必须清三样，且 savedAt<=0 时不清（启动那一帧不能误清）
if awk '/fun recheckExpired/,/^    }$/' "$GUARD_KT" | grep -q "State.clearSession(ctx)" \
    && awk '/fun recheckExpired/,/^    }$/' "$GUARD_KT" | grep -q "State.clearStickySession(ctx)" \
    && awk '/fun recheckExpired/,/^    }$/' "$GUARD_KT" | grep -q "clearActive(ctx)"; then
    ok "recheckExpired 清 session + 粘性键 + guard.active"
else
    bad "recheckExpired 没有清全三样"
fi
grep -q "if (savedAt <= 0L) return false" "$GR_KT" \
    && ok "savedAt<=0 直接返回（会话还没落盘时不误清）" \
    || bad "缺少 savedAt<=0 的保护"

# ---- P1-1③ repairResidue 的过期分支 ----
grep -q "GuardRules.residueExpired" "$GUARD_KT" \
    && ok "repairResidue 有「镜像为真但会话已过期」分支" \
    || bad "repairResidue 只有「没有会话」一条判据（过期的账永远不清）"
grep -q "fun residueExpired(" "$GR_KT" && grep -q "fun recheckNeedsClear(" "$GR_KT" \
    && ok "两条新判据都是纯函数（可离线跑表）" \
    || bad "新判据没有落在 GuardRules 纯逻辑层"

# ---- P2-1 startForeground 异常安全：通知构造必须在 try 内 ----
if awk '/^        try \{/{t=NR} /Notifications\.ongoingNotification/{n=NR} /^        \} catch \(e: Exception\)/{c=NR} /^        \} finally \{/{f=NR} END{exit !(t>0 && n>t && c>n && f>c)}' "$TS_KT"; then
    ok "TimerService 的 ongoingNotification 构造在 try 内，finally 兜底（P2-1）"
else
    bad "ongoingNotification 仍在 try 外（抛异常会「未 startForeground 就崩」）"
fi
awk '/^        try \{/,/^        \} finally \{/' "$TS_KT" | grep -q "startForeground" \
    && ok "startForeground 与通知构造在同一个 try 里" \
    || bad "startForeground 与构造被拆到两个 try（又出现「没进前台」的路径）"
awk '/^        \} finally \{/,/^        if \(!foreground\)/' "$TS_KT" | grep -q "stopForegroundAndSelf()" \
    && ok "finally 里保证二选一：没进前台就 stopForeground(REMOVE) + stopSelf" \
    || bad "finally 没有兜底退出路径"

# ---- P2-2 撤通知：同进程同步 stopForeground(REMOVE) + cancel 兜底 ----
grep -q "private var instance: TimerService?" "$TS_KT" && grep -q "inst.stopForegroundAndSelf()" "$TS_KT" \
    && ok "TimerService.stop 同进程有实例时同步 stopForeground(REMOVE)（不再等 onDestroy）" \
    || bad "TimerService.stop 仍只靠异步 stopService（会留幽灵通知窗口）"
grep -q "FLAG_FOREGROUND_SERVICE" "$TW_KT" \
    && ok "disarm 注释写清了「cancel 对 FGS 通知无效」的来由" \
    || bad "disarm 没有记录 P2-2 的原因（下次又会把顺序改回去）"
awk '/fun disarm/,/^    }$/' "$TW_KT" | grep -q "关通知 = 放弃后台保活" \
    && ok "disarm 注释写清了「不按 QA 原建议改 web-notify-off」的理由" \
    || bad "disarm 缺少 web-notify-off 保持现状的理由"

# ---- 行为级单测：AlarmReceiver 的到点收尾状态机 ----
ALARM_PY="$PROJECT_DIR/app/tools/qa_alarm_settle.py"
if [ -f "$ALARM_PY" ]; then
    if OUTA=$(timeout 120 python3 "$ALARM_PY" 2>&1); then
        NA=$(printf '%s' "$OUTA" | grep -c '^PASS')
        ok "qa_alarm_settle.py：$NA 条到点收尾行为断言全过（含幂等闸门 / 三条清理）"
        printf '%s\n' "$OUTA" | grep -E '^PASS  (收尾后|重复投递|endAt<=0|到点收尾包含)' | sed 's/^/       /'
    else
        bad "qa_alarm_settle.py 有断言失败："
        printf '%s\n' "$OUTA" | grep -E '^FAIL' | sed 's/^/       /'
    fi
else
    bad "缺少 app/tools/qa_alarm_settle.py"
fi

# ------------------------------- 16. 0.2.3：正计时孤儿镜像 / finally 异常安全 / 文档
head_ 16 "0.2.3 增量（P1-2 正计时孤儿镜像 · P2 finally runCatching · 文档不再提 onAlarmFired）"

# ---- P1-2：App.onCreate 里的「正计时场次清 active」分支（前置，不是 repairResidue 分支）----
# 现场：正计时（endAt=0，savedAt=T0）→ LMK 杀进程 → 重绑。repairResidue / recheckExpired
# 都只判 savedAt+8h，于是判"还活着" → 用户开微信照旧被遮罩 + HOME，直到 8h 后才放行。
grep -q "fun clearOrphanCountingActive" "$GUARD_KT" \
    && ok "Guard.clearOrphanCountingActive 存在（只清拦截镜像）" \
    || bad "缺少 Guard.clearOrphanCountingActive"
grep -q "Guard.clearOrphanCountingActive(this)" "$APP_KT" \
    && ok "App.onCreate 调了 clearOrphanCountingActive（新进程刚起 = 网页一定没活）" \
    || bad "App.onCreate 没有清正计时孤儿镜像（P1-2 未修）"
# 顺序：必须在 repairResidue 之前（先清镜像，再让 repairResidue 按老判据收尾）
HELPER_LINE=$(grep -n "Guard.clearOrphanCountingActive(this)" "$APP_KT" | head -1 | cut -d: -f1)
REPAIR_LINE=$(grep -n "Guard.repairResidue(this)" "$APP_KT" | head -1 | cut -d: -f1)
if [ -n "$HELPER_LINE" ] && [ -n "$REPAIR_LINE" ] && [ "$HELPER_LINE" -lt "$REPAIR_LINE" ]; then
    ok "clearOrphanCountingActive 排在 repairResidue 之前（选了「App.onCreate 前置」而不是加分支）"
else
    bad "顺序不对（clearOrphan=$HELPER_LINE repairResidue=$REPAIR_LINE）"
fi
# 两次调用必须各自在 try 里（Application.onCreate 抛异常 = 整个进程起不来）
N_TRY=$(awk '/override fun onCreate\(\)/,/^    }$/' "$APP_KT" | grep -c "catch (e: Exception)" || true)
[ "$N_TRY" -ge 2 ] \
    && ok "App.onCreate 的两步各自 catch 兜住（$N_TRY 个 catch，进程不会因此起不来）" \
    || bad "App.onCreate 只有 $N_TRY 个 catch（少一个就会「点图标没反应」）"
# ★ 只清 active：这个函数里不许出现清 session / 粘性键的调用
if awk '/fun clearOrphanCountingActive/,/^    }$/' "$GUARD_KT" | grep -q "State.clearSession\|State.clearStickySession"; then
    bad "clearOrphanCountingActive 动了 session / 粘性键（会把「本场不再打扰」的记账和网页恢复一起废掉）"
else
    ok "clearOrphanCountingActive 只清 guard.active，不动 session / 粘性键"
fi
grep -q "clear active: counting session orphaned by process restart" "$GUARD_KT" \
    && ok "留下可 grep 的日志：counting session orphaned by process restart" \
    || bad "缺少 P1-2 的诊断日志"
grep -q "fun countingOrphanNeedsClear(" "$GR_KT" \
    && ok "判据落在 GuardRules 纯逻辑层（可离线跑表）" \
    || bad "判据没有落在 GuardRules（无法离线跑表）"
grep -q "if (savedAt <= 0L) return false" "$GR_KT" \
    && ok "savedAt<=0（从没落过盘）不动" \
    || bad "缺少 savedAt<=0 的保护"
if grep -q "Guard.clearOrphanCountingActive" "$MA_KT" "$GSS_KT"; then
    bad "MainActivity / GuardService 也调了 clearOrphanCountingActive（回前台会把正在专注的镜像清掉）"
else
    ok "clearOrphanCountingActive 只在进程创建时跑（onResume 仍只跑 repairResidue）"
fi

# ---- P2：finally 里的 stopForeground / stopSelf 各自 runCatching ----
# 这两步若自己抛出，会逃逸出 onStartCommand → P2-1 的"二选一"保证失效。
if awk '/private fun stopForegroundAndSelf/,/^    }$/' "$TS_KT" \
        | grep -q "runCatching { ServiceCompat.stopForeground"; then
    ok "stopForeground(REMOVE) 包在 runCatching 里（finally 不会被它带走）"
else
    bad "stopForeground(REMOVE) 仍会从 finally 抛出（P2-1 的保证失效）"
fi
if awk '/private fun stopForegroundAndSelf/,/^    }$/' "$TS_KT" | grep -q "runCatching { stopSelf() }"; then
    ok "stopSelf() 包在 runCatching 里（撤通知失败也一定会 stopSelf）"
else
    bad "stopSelf() 没有 runCatching（第一步抛了就永远停不掉）"
fi
if awk '/^        \} finally \{/,/^        if \(!foreground\)/' "$TS_KT" | grep -q "stopForegroundAndSelf()"; then
    ok "finally 走的仍是那个 runCatching 版出口（P2-1 的路径没换）"
else
    bad "finally 的退出路径变了"
fi

# ---- 文档漂移：onAlarmFired 不再是现存 API ----
DESIGN_MD="$PROJECT_DIR/../docs/android/APP_DESIGN.md"
CLASS_MMD="$PROJECT_DIR/../docs/android/class-diagram.mermaid"
if [ -f "$DESIGN_MD" ]; then
    if grep -q "fun onAlarmFired" "$DESIGN_MD"; then
        bad "APP_DESIGN.md 仍把 onAlarmFired 当现存 API"
    else
        ok "APP_DESIGN.md 不再把 onAlarmFired 当现存 API（§8.6 改指 AlarmReceiver）"
    fi
else
    bad "找不到 $DESIGN_MD"
fi
if [ -f "$CLASS_MMD" ]; then
    if grep -qE "^ *\+onAlarmFired|\.\.> TimerWatch : onAlarmFired" "$CLASS_MMD"; then
        bad "class-diagram.mermaid 仍把 onAlarmFired 当现存 API"
    else
        ok "class-diagram.mermaid 不再把 onAlarmFired 当现存 API"
    fi
else
    bad "找不到 $CLASS_MMD"
fi

# ---- 行为级单测：App.onCreate 对正计时孤儿场次的处理 ----
ORPHAN_PY="$PROJECT_DIR/app/tools/qa_orphan_active.py"
if [ -f "$ORPHAN_PY" ]; then
    if OUTO=$(timeout 120 python3 "$ORPHAN_PY" 2>&1); then
        NO=$(printf '%s' "$OUTO" | grep -c '^PASS')
        ok "qa_orphan_active.py：$NO 条行为断言全过（清 active / 保留 session / 恢复后重新拦）"
        printf '%s\n' "$OUTO" | grep -E '^PASS  (F2 清账后|F3 |savedAt=0（从没落过盘）|正计时超 8h)' | sed 's/^/       /'
    else
        bad "qa_orphan_active.py 有断言失败："
        printf '%s\n' "$OUTO" | grep -E '^FAIL' | sed 's/^/       /'
    fi
else
    bad "缺少 app/tools/qa_orphan_active.py"
fi

# ---- 离线跑表：⑧ 组用例必须逐条 PASS（只 grep 源码证明不了它跑过）----
if [ -x "$GUARD_SH" ]; then
    OUTG=$(timeout 300 "$GUARD_SH" 2>&1)
    if printf '%s' "$OUTG" | grep -q '^ENV:'; then
        warn "qa_guard.sh 环境不可用，跳过 0.2.3 的 ⑧ 组用例核对"
    else
        for tag in "App.onCreate：正计时场次 + guard.active=true → 清 active" \
                   "App.onCreate：savedAt=0（从没落过盘）→ 不动" \
                   "App.onCreate：倒计时（endAt>0，counting=false）→ 不走这条（仍按 endAt 过期判）" \
                   "App.onCreate：正计时超 8h → 让位给 repairResidue（否则过期那场的数据永远不清）"; do
            if printf '%s\n' "$OUTG" | grep -q "PASS  $tag"; then
                ok "应用锁跑表：$tag"
            else
                bad "应用锁跑表缺少 0.2.3 用例「$tag」"
            fi
        done
    fi
fi

# ------------------------------------------------------------------- 汇总
printf '\n\033[1m===== 结果：%d 通过 · %d 失败 · %d 警告 =====\033[0m\n' "$PASS" "$FAIL" "$WARN"
if [ "$FAIL" -eq 0 ]; then
    printf '\033[32mIS_PASS: YES\033[0m\n'
    exit 0
fi
printf '\033[31mIS_PASS: NO\033[0m\n'
exit 1
