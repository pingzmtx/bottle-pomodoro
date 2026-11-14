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

用法
----
    python3 tools/promote.py             # 同步 + 删除残骸 + 自检
    python3 tools/promote.py --dry-run   # 只报告将要发生什么，不动盘
退出码：0 同步后一致；1 同步后仍不一致（理论不可达，除非磁盘异常）；3 public/ 不存在
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
    dry = "--dry-run" in sys.argv

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
        if not dry:
            shutil.copy2(src, dst)
        copied.append(rel)

    # 残骸：命名空间内、根目录有而 public 不产出的 —— 只可能来自更早的一次构建
    for rel, p in sorted(root.items()):
        if rel in pub:
            continue
        if not dry:
            os.remove(p)
        removed.append(rel)

    if dry:
        print("（--dry-run，未动盘）")
    print("同步 %d 个  ·  未变 %d 个  ·  删除残骸 %d 个" % (len(copied), len(same), len(removed)))
    for rel in copied:
        print("  ↑ %s" % rel)
    for rel in removed:
        print("  ✗ %s（旧产物，已从根目录删除）" % rel)
    if not copied and not removed:
        print("  根目录已经是最新的，什么都没做")

    if dry:
        return 0

    # 同步完立刻自检：不靠"我觉得拷对了"。这也是门禁段的同一份判据，不会两套标准。
    r = subprocess.run([sys.executable, CHECK], cwd=ROOT)
    return 0 if r.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
