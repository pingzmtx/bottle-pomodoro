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
printf '%s\n' "$BADGING" | grep -q "versionName='0.1.0'" \
    && ok "versionName 0.1.0" || bad "versionName 不是 0.1.0"
printf '%s\n' "$BADGING" | grep -q "^sdkVersion:'26'" \
    && ok "minSdk 26" || bad "minSdk 不是 26"
printf '%s\n' "$BADGING" | grep -q "^targetSdkVersion:'34'" \
    && ok "targetSdk 34" || bad "targetSdk 不是 34"

# ------------------------------------------------------------------ 2. 权限
head_ 2 "权限清单（应只有 4 条 + androidx 自动生成的那条）"
for p in POST_NOTIFICATIONS VIBRATE SCHEDULE_EXACT_ALARM RECEIVE_BOOT_COMPLETED; do
    printf '%s\n' "$BADGING" | grep -q "uses-permission: name='android.permission.$p'" \
        && ok "已声明 $p" || bad "缺少 $p"
done
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

# ------------------------------------------------------------------- 汇总
printf '\n\033[1m===== 结果：%d 通过 · %d 失败 · %d 警告 =====\033[0m\n' "$PASS" "$FAIL" "$WARN"
if [ "$FAIL" -eq 0 ]; then
    printf '\033[32mIS_PASS: YES\033[0m\n'
    exit 0
fi
printf '\033[31mIS_PASS: NO\033[0m\n'
exit 1
