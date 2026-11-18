#!/usr/bin/env bash
# SessionKey 纯逻辑离线跑表（P1-1 的回归门；0.1.4 补 9/10/11 三条重启路径用例）。
#
# 为什么不用 JUnit：本工程的 Gradle 依赖是离线缓存好的，加测试依赖就得联网。
# 这里用缓存里已有的 kotlin-compiler-embeddable 编译
# 「线上同一份 SessionKey.kt + tools/SessionKeyCheck.kt」，在 JVM 上跑。
#
# SessionKey.kt 刻意零 Android 依赖（没有 Context / org.json），所以不需要 android.jar。
#
# 用法：app/tools/qa_sessionkey.sh     退出码 0 = 全过；2 = 环境不可用
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$PROJECT_DIR/app/src/main/java/im/bottle/focus/SessionKey.kt"
CHECK="$PROJECT_DIR/app/tools/SessionKeyCheck.kt"
OUT="$PROJECT_DIR/app/build/sessionkey-check"

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
    echo "FAIL: SessionKey 编译失败"
    exit 1
fi

# 无参数 = 11 条真值表用例（含 0.1.4 补的重启后暂停态 9/10/11）；
# 带参数 = 回放真页面录制的帧（见 qa_sessionkey_live.py）
java -cp "$OUT:$STDLIB" im.bottle.focus.SessionKeyCheck "$@"
