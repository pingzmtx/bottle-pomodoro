#!/bin/sh
# 瓶子专注 · 一键上线（单仓库版）
#
#   改 src/ → sh 上线.sh "feat(范围): 一句话"
#   脚本：构建 → 门禁 → 提交 → 推送 → GitHub Pages 自动发布（约 60 秒生效）
#
# 用法：sh 上线.sh "feat(plan): 你要做的事一句话"
# 前置：git 已配置推送凭据（HTTPS + token，或 SSH key）
set -e
MSG="$1"
if [ -z "$MSG" ]; then
  echo '用法：sh 上线.sh "feat(范围): 一句话"'
  exit 2
fi

REPO="${REPO:-https://github.com/pingzmtx/bottle-pomodoro.git}"
BRANCH="${BRANCH:-main}"

echo "▶ 1/4  构建（src/ → public/ → 根目录站点文件）"
python3 tools/build.py

echo "▶ 2/4  门禁（28 项静态检查）"
POMO_HOOKDIR=/tmp/hooks python3 tools/install_hooks.py >/dev/null
if ! POMO_HOOKDIR=/tmp/hooks python3 tools/verify.py --fast; then
  git config --unset core.hooksPath 2>/dev/null || true
  echo "✗ 门禁没过，停在这里，什么都没推，线上仍是上一版。"
  exit 1
fi

echo "▶ 3/4  提交"
git remote set-url origin "$REPO" 2>/dev/null || git remote add origin "$REPO"
git add -A
if git diff --cached --quiet; then
  echo "  没有变化，无需上线"
  exit 0
fi
git config --unset core.hooksPath 2>/dev/null || true
git commit -qm "$MSG"

echo "▶ 4/4  推送（= 上线）"
git push -q origin "HEAD:$BRANCH"
echo "  ✓ $(git rev-parse --short HEAD) 已推送"
echo "  → https://pingzmtx.github.io/bottle-pomodoro/ （约 60 秒生效）"
