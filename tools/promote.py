#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""promote.py —— 把 public/ 整体同步到仓库根目录（发布物落地）

为什么不是「挑文件拷」
----------------------
2026-11-14 的事故：根目录 sw.js / config.js 落后 public/ 一整代。
事后结论不是「下次记得拷」——**只要还在挑，就一定还会漏**。挑文件的三个问题：
  1. 挑哪几个没有清单，靠记性；
  2. 新产出的文件（换哈希的 CSS）要人想到去加；
  3. 旧文件（上一代 style.<hash>.css）要人想到去删，想不到就永远留在仓库里，
     跟着 Pages 一起发出去 —— 谁也不会去看一个没人引用的文件。

所以这里做的是**命名空间内的整体同步**，语义等价于
`rsync -a --delete public/ ./`，但 --delete 只作用于产物命名空间：
  顶层 index.html / config.js / manifest.webmanifest / sw.js
  目录 assets/ icons/ fonts/
命名空间外的 README、src/、tools/、文档一律不碰、不删 —— 这是与裸 rsync 的唯一区别，
也是它敢直接跑在仓库根目录的原因。

为什么默认只读
--------------
2026-11-14 23:30 实测踩坑：照惯例执行 `promote.py --check` 想看差异，
脚本把 `--check` 当位置参数**静默忽略**、而默认动作就是刷盘，
于是用本地 public/ 覆盖了根目录，BUILD_ID 被改回旧值，还得从镜像恢复。

一个「我只想看看」的动作改了盘，这是脚枪，不是用法问题。所以现在：
  · 默认**不动任何文件**，写盘必须显式 `--apply`；
  · 不认识的参数直接报错退出 2，**不许静默忽略**（忽略参数 = 让 --check 去干 --apply 的事）。

用法
----
    python3 tools/promote.py            # 只读：报告待同步 / 待删除，不动盘
    python3 tools/promote.py --apply    # 真的写盘，写完自检
    python3 tools/promote.py --dry-run  # 与默认等价（保留，防旧习惯踩空）
退出码：0 一致（或 apply 后一致）；1 有差异（只读）/ apply 后仍不一致；2 参数错；3 public/ 不存在
"""
import filecmp
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
CHECK = os.path.join(ROOT, "tools", "check_public_sync.py")

TOP_FILES = ("index.html", "config.js", "manifest.webmanifest", "sw.js")
TOP_DIRS = ("assets", "icons", "fonts")

KNOWN_ARGS = {"--apply", "--dry-run", "-h", "--help"}


def scope_files(base):
    out = {}
    for n in TOP_FILES:
        p = os.path.join(base, n)
        if os.path.isfile(p):
            out[n] = p
    for d in TOP_DIRS:
        dp = os.path.join(base, d)
        if not os.path.isdir(dp):
            continue
        for dirpath, _dirnames, filenames in os.walk(dp):
            for name in filenames:
                p = os.path.join(dirpath, name)
                out[os.path.relpath(p, base).replace(os.sep, "/")] = p
    return out


def main():
    args = sys.argv[1:]
    unknown = [a for a in args if a not in KNOWN_ARGS]
    if unknown:
        print("✗ 不认识的参数：%s" % " ".join(unknown))
        print("  用法：python3 tools/promote.py [--apply]")
        print("        默认只读、不动盘；写盘要显式 --apply。")
        return 2
    if "-h" in args or "--help" in args:
        print(__doc__)
        return 0

    apply = "--apply" in args

    if not os.path.isdir(PUB) or not scope_files(PUB):
        print("○ public/ 还没构建（先跑 python3 tools/build.py）")
        return 3

    pub = scope_files(PUB)
    root = scope_files(ROOT)

    copied, removed, same = [], [], []

    for rel, src in sorted(pub.items()):
        dst = os.path.join(ROOT, rel)
        parent = os.path.dirname(dst)
        if parent:
            os.makedirs(parent, exist_ok=True)
        if os.path.isfile(dst) and filecmp.cmp(src, dst, shallow=False):
            same.append(rel)
            continue
        if apply:
            shutil.copy2(src, dst)
        copied.append(rel)

    # 残骸：命名空间内、根目录有而 public 不产出的 —— 只可能来自更早的一次构建
    for rel, p in sorted(root.items()):
        if rel in pub:
            continue
        if apply:
            os.remove(p)
        removed.append(rel)

    if not copied and not removed:
        print("✅ %d 个产物逐字节一致（根目录 = public/）" % len(same))
        return 0

    print("%s %d 个 · 待删除残骸 %d 个 · 已一致 %d 个"
          % ("已同步" if apply else "待同步", len(copied), len(removed), len(same)))
    for rel in copied:
        print("  %s %s" % ("↑" if apply else "·", rel))
    for rel in removed:
        print("  %s %s（旧产物，%s）" % ("✗" if apply else "·", rel, "已删除" if apply else "待删除"))

    if not apply:
        print("\n（只读模式，未动盘；确认无误后加 --apply 执行）")
        return 1

    # 写完立刻自检：不靠"我觉得拷对了"。与门禁段同一份判据，不会两套标准。
    r = subprocess.run([sys.executable, CHECK], cwd=ROOT)
    return 0 if r.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
