#!/bin/sh
# 瓶子专注 · 一键上线（单仓库版）
#
#   改 src/ → sh 上线.sh "feat(范围): 一句话"
#   脚本：构建 → 落地 → 门禁 → 提交 → 推送 → GitHub Pages 自动发布（约 60 秒生效）
#
# 用法：sh 上线.sh "feat(plan): 你要做的事一句话"
# 前置：git 已配置推送凭据（HTTPS + token，或 SSH key）
set -e
MSG="$1"
if [ -z "$MSG" ]; then
  echo '用法：sh 上线.sh "feat(范围): 一句话"'
  exit 2
fi

# 从脚本所在目录干活：build.py 用绝对路径无所谓，但 `git add -A` 认 cwd ——
# 从别的目录调用会往错误的仓库里加文件。
cd "$(dirname "$0")" || exit 1

REPO="${REPO:-https://github.com/pingzmtx/bottle-pomodoro.git}"
BRANCH="${BRANCH:-main}"

echo "▶ 1/5  构建（src/ → public/）"
python3 tools/build.py

# 2026-11-14 新增：public/ 必须真的落到根目录。原来这一步不存在，靠人手 cp，
# 于是根目录 sw.js 落后一整代（BUILD_ID 423fad73c0d3 vs 2bfbe006368f），
# 线上 SW 缓存名不变 → 老用户永远命中旧缓存。promote 是命名空间内的整体同步 + 删残骸。
echo "▶ 2/5  落地（public/ → 根目录，整体同步）"
python3 tools/promote.py --apply

# 段数不手写：这里原来写「28 项静态检查」，实际 35 段，差 7 —— 手写数字必然过期，
# 而一句错数字会让人以为"就这么多，没漏"。从 verify.py 的 AST 现数。
CHAIN_N=$(python3 -c "import sys;sys.path.insert(0,'tools');import gen_verify_chain as g;print(len(g.collect()[0]))")
echo "▶ 3/5  门禁（verify.py --fast，当前 ${CHAIN_N} 段）"
# 钩子装到仓库自带的 .git-hooks（install_hooks 幂等）。
# 不再用 /tmp/hooks：core.hooksPath 指向 /tmp 后，机器重启目录消失，
# git 对不存在的 hooksPath **不报错**，钩子从此静默不跑 —— 没人会发现。
python3 tools/install_hooks.py >/dev/null
if ! python3 tools/verify.py --fast; then
  echo "✗ 门禁没过，停在这里，什么都没推，线上仍是上一版。"
  exit 1
fi

echo "▶ 4/5  提交"
git remote set-url origin "$REPO" 2>/dev/null || git remote add origin "$REPO"
git add -A
if git diff --cached --quiet; then
  echo "  没有变化，无需上线"
  exit 0
fi
# 提交前**不再**解绑钩子。原来这里是 `git config --unset core.hooksPath`，
# 等于正式发版路径上 pre-commit 一律不跑 —— 漏提交 sw.js 的机制源头。
# 现在 commit 会真的过钩子；代价是 lint/unit 重复跑一遍（约 5s）。
git commit -qm "$MSG"

echo "▶ 5/5  推送（= 上线）"
git push -q origin "HEAD:$BRANCH"
echo "  ✓ $(git rev-parse --short HEAD) 已推送"
echo "  → https://pingzmtx.github.io/bottle-pomodoro/ （约 60 秒生效）"
