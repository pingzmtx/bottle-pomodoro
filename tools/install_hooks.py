#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""安装 / 校验 git 门禁钩子
用法:
  python3 tools/install_hooks.py           # 上膛（幂等，可反复跑）
  python3 tools/install_hooks.py --check   # 只查：上膛了没（0=已上膛 / 1=没上膛 / 3=环境不具备：非 git 仓库，或不支持执行位）

为什么不是简单地复制到 .git/hooks/
-----------------------------------
本项目在 /var/minis/mounts/Documents/<项目>/ 下，而这个挂载点是 Android 存储层
（f2fs + FUSE 式过滤），**执行位被剥掉**：chmod +x 后 ls 依然显示 -rw-rw----，
连 `./脚本.sh` 都报 Permission denied。git 要求钩子文件本身可执行（access X_OK），
所以放在 .git/hooks/ 里的钩子**永远会被 git 静默忽略**——这是本环境的一个坑，
不是配置写错了。

解法：git 的 core.hooksPath 可以把钩子目录指到别处。我们把钩子**正本**留在
版本库里的 tools/githooks/（跟 git 走、可 review、可回退），把**执行副本**装到
一个支持执行位的目录（/var/minis/shared/pomo-hooks），再把 core.hooksPath 指过去。

⚠️ core.hooksPath 写的是绝对路径，只在**本机**有效；换机器/换 AI 接手时，
第一件事就是跑一次 `python3 tools/install_hooks.py`（幂等）。verify.py 里也挂了
--check，没上膛时会在全绿链里显形，不会静默变绿。
"""
import filecmp
import os
import stat
import shutil
import glob
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "githooks")
# 落点不再写死 /var/minis/shared（那只是作者设备的可执行挂载点，换机器即失效，P1-8）。
# 优先环境变量，其次项目内 .git-hooks；若该目录放不了可执行文件（Android 挂载点常见），
# 下面的 _exec_ok() 会探测到并明确跳过，不会假装装上了。
HOOKDIR = os.environ.get("POMO_HOOKDIR") or os.path.join(ROOT, ".git-hooks")


def _exec_ok(d):
    """探测目录 d 能否存放可执行文件——决定本环境装不装得了钩子。"""
    try:
        os.makedirs(d, exist_ok=True)
        probe = os.path.join(d, ".exec_probe")
        with open(probe, "w") as f:
            f.write("#!/bin/sh\nexit 0\n")
        os.chmod(probe, 0o755)
        ok = os.access(probe, os.X_OK)
        os.remove(probe)
        return ok
    except Exception:
        return False


def _current_hookspath():
    r = subprocess.run(["git", "config", "--get", "core.hooksPath"],
                       cwd=ROOT, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def install():
    if not os.path.isdir(os.path.join(ROOT, ".git")):
        print("✗ 本目录不是 git 仓库（没有 .git）——没有可上膛的地方。")
        print("  先 `git init`，再跑本命令。")
        return 3
    os.makedirs(HOOKDIR, exist_ok=True)
    names = []
    for f in sorted(glob.glob(os.path.join(SRC, "*"))):
        name = os.path.basename(f)
        dst = os.path.join(HOOKDIR, name)
        shutil.copy(f, dst)
        os.chmod(dst, os.stat(dst).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        names.append(name)
        print(f"已安装: {dst}")
    subprocess.run(["git", "config", "core.hooksPath", HOOKDIR], cwd=ROOT, check=True)
    print(f"core.hooksPath → {HOOKDIR}")
    print(f"完成。已上膛 {len(names)} 个钩子：{', '.join(names)}")
    if not _exec_ok(HOOKDIR):
        print("⚠️ 警告：该目录似乎不支持执行位，钩子可能仍被 git 忽略。")
        return 1
    return 0


def check():
    # 项目不是 git 仓库时，git 门禁无从谈起：core.hooksPath 写不进任何地方，
    # 钩子也不会被 git 读取。这是「环境不具备」而非「门禁没上膛」——
    # 按 verify.py 的约定返回 3 = SKIP（别让"交付包里没有 .git"伪装成回归失败）。
    # 放在最前还有个副作用修正：check 不该顺手创建 HOOKDIR，无 .git 时直接不碰环境。
    if not os.path.isdir(os.path.join(ROOT, ".git")):
        print("○ 本目录不是 git 仓库（没有 .git）——git 门禁无从谈起，跳过校验。")
        print("  这是交付包 / 导出目录的常态；在真正的开发库里 `git init` 后跑一次 install_hooks.py 即可上膛。")
        return 3
    cfg = _current_hookspath()
    want = os.path.join(HOOKDIR, "pre-commit")
    if cfg == HOOKDIR and os.path.isfile(want) and os.access(want, os.X_OK):
        src = os.path.join(SRC, "pre-commit")
        if os.path.isfile(src) and not filecmp.cmp(src, want, shallow=False):
            print(f"✗ 门禁钩子是旧版：{want} 与正本 tools/githooks/pre-commit 内容不一致。")
            print("  修复：python3 tools/install_hooks.py")
            return 1
        print(f"✓ 门禁已上膛（core.hooksPath = {HOOKDIR}）")
        return 0
    if not _exec_ok(HOOKDIR):
        print("○ 本环境不支持钩子（无可写执行位的目录），跳过门禁校验。")
        return 3
    print("✗ 门禁没上膛——改了 src 忘重建产物之类的事，将不会被机械拦住。")
    print("  修复：python3 tools/install_hooks.py")
    return 1


if __name__ == "__main__":
    sys.exit(check() if "--check" in sys.argv else install())
