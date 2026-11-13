#!/bin/sh
# smoke_via_browser.sh —— 真机浏览器版 smoke 的启动/查看/停止
#
#   sh tools/smoke_via_browser.sh start    # 后台起桥，等端口就绪
#   （此时把浏览器导航到脚本打印的地址）
#   sh tools/smoke_via_browser.sh tail     # 看进度 / 结果
#   sh tools/smoke_via_browser.sh stop     # 收工
#
# 为什么后台跑：桥必须「先就绪，再让浏览器接入」，
# 而 agent 的浏览器导航是另一个动作，不能塞进同一次前台命令里。
PORT="${SMOKE_PORT:-8790}"
LOG="${SMOKE_LOG:-/tmp/smoke_bridge.log}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAT="run_smoke[.]py --via browser"   # 方括号防 pkill 自匹配（曾因此杀掉 PRoot PID 1）

case "$1" in
start)
  pkill -f "$PAT" 2>/dev/null
  sleep 0.4
  cd "$ROOT" || exit 1
  shift
  # 日常默认 = --affected（core ∪ 本次改动相关）。**默认值不能靠人记得加**——
  # 靠记性的默认值等于没有默认值，最后一定会退化成「一律全量」。
  # 只有显式给了模式才按给的来；不给就自己挑。
  case " $* " in
    *" --only "*|*" --affected "*|*" --tier "*|*" --all "*) MODE="" ;;
    *) MODE="--affected"; echo "（没指定模式 → 默认 --affected：core ∪ 本次改动相关）" ;;
  esac
  case " $* " in *" --list "*) LIST=1 ;; *) LIST="" ;; esac
  : > "$LOG"
  nohup python3 -u tools/run_smoke.py --via browser --port "$PORT" \
        --client-wait "${SMOKE_WAIT:-300}" $MODE "$@" >> "$LOG" 2>&1 &
  if [ -n "$LIST" ]; then   # --list 只打印选中集就退出，不启桥 → 别当失败
    sleep 1; cat "$LOG"; exit 0
  fi
  i=0
  while [ "$i" -lt 80 ]; do
    grep -q "桥已监听" "$LOG" 2>/dev/null && break
    i=$((i+1)); sleep 0.25
  done
  if ! grep -q "桥已监听" "$LOG" 2>/dev/null; then
    echo "✗ 桥没起来，日志："; tail -n 20 "$LOG"; exit 1
  fi
  sed -n '1,5p' "$LOG"
  echo "→ 现在把浏览器导航到 http://127.0.0.1:$PORT/"
  ;;
stop)
  if pkill -f "$PAT" 2>/dev/null; then echo "已停止"; else echo "没在跑"; fi
  ;;
tail)
  tail -n "${2:-30}" "$LOG"
  ;;
*)
  echo "用法: $0 {start|stop|tail}"; exit 1;;
esac
