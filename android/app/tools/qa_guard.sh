#!/usr/bin/env bash
# GuardRules 纯逻辑离线跑表（应用锁的回归门）。
#
# 为什么不用 JUnit：本工程的 Gradle 依赖是离线缓存好的，加测试依赖就得联网。
# 这里用缓存里已有的 kotlin-compiler-embeddable 编译
# 「线上同一份 GuardRules.kt + tools/GuardCheck.kt」，在 JVM 上跑（与 qa_sessionkey.sh 同款）。
#
# GuardRules.kt 刻意零 Android 依赖（没有 Context / PackageManager / Settings），
# 所以不需要 android.jar —— 这也是把"判定"和"适配"拆成 GuardRules / Guard 两个文件的原因。
#
# 覆盖：白名单判定 / 拦截条件（running·paused·mode 全组合）/ 失效计数 / residue 修复 / 任务名。
#
# 用法：app/tools/qa_guard.sh     退出码 0 = 全过；2 = 环境不可用
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$PROJECT_DIR/app/src/main/java/im/bottle/focus/GuardRules.kt"
CHECK="$PROJECT_DIR/app/tools/GuardCheck.kt"
OUT="$PROJECT_DIR/app/build/guard-check"

find_jar() {
    # $1 = artifact 目录名，$2 = 文件名前缀
    ls -1 "$HOME/.gradle/caches/modules-2/files-2.1/$1"/*/*/"$2"*.jar 2>/dev/null \
        | sort -V | tail -1
}

KC="$(find_jar org.jetbrains.kotlin/kotlin-compiler-embeddable kotlin-compiler-embeddable)"
STDLIB="$(find_jar org.jetbrains.kotlin/kotlin-stdlib kotlin-stdlib)"
REFLECT="$(find_jar org.jetbrains.kotlin/kotlin-reflect kotlin-reflect)"
SCRIPT="$(find_jar org.jetbrains.kotlin/kotlin-script-runtime kotlin-script-runtime)"
TROVE="$(find_jar org.jetbrains.intellij.deps/trove4j trove4j)"
COROUTINES="$(find_jar org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm kotlinx-coroutines-core-jvm)"
ANNOTATIONS="$(find_jar org.jetbrains/annotations annotations)"

if [ -z "$KC" ] || [ -z "$STDLIB" ]; then
    echo "ENV: 找不到 kotlin-compiler-embeddable / kotlin-stdlib（先跑一次 gradle 让缓存就绪）"
    exit 2
fi

TOOL_CP="$KC:$STDLIB"
[ -n "$REFLECT" ] && TOOL_CP="$TOOL_CP:$REFLECT"
[ -n "$SCRIPT" ] && TOOL_CP="$TOOL_CP:$SCRIPT"
[ -n "$TROVE" ] && TOOL_CP="$TOOL_CP:$TROVE"
[ -n "$COROUTINES" ] && TOOL_CP="$TOOL_CP:$COROUTINES"
[ -n "$ANNOTATIONS" ] && TOOL_CP="$TOOL_CP:$ANNOTATIONS"

rm -rf "$OUT"
mkdir -p "$OUT"

if ! java -cp "$TOOL_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
        -no-stdlib -nowarn -cp "$STDLIB" -d "$OUT" "$SRC" "$CHECK" 2>&1; then
    echo "FAIL: GuardRules 编译失败"
    exit 1
fi

java -cp "$OUT:$STDLIB" im.bottle.focus.GuardCheck "$@"
