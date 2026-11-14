#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_public_sync.py —— public/ 与仓库根目录的同名产物必须逐字节一致

为什么要有这一段
----------------
2026-11-14 实测：`public/sw.js` 的 BUILD_ID 是 `2bfbe006368f`、PRECACHE 指向
`style.d8662d58e8a8.css`；根目录那份还停在 `423fad73c0d3` / `style.cb9ccd30ce86.css`
（P1 版旧 CSS）。线上发的是**根目录**（GitHub Pages legacy 从 main 根发布），于是：
  · SW 缓存名不变 → 老用户永远不会换到新缓存，改了等于没改；
  · 预缓存清单里指着一个已经不存在的 CSS 文件名 → install 阶段 precache 失败/静默跳过，
    离线能力悄悄瘸一条腿。
同一批还漏了 `config.js`：version `875cef4cf82f` vs `42c1a5b8ff18`。

根因不是「忘了拷」，是**发布动作靠挑文件**：build.py 只写 public/，根目录那份要再搬一遍，
搬哪几个没有清单、也没有机器核。只要还在挑，就一定还会漏；而且 23 个产物里少同步一个，
站点看起来完全正常 —— 没人会发现。所以判据必须写成机器可查的两条：

  ① public/ 有的，根目录必须有，且逐字节相同；
  ② 根目录有的，public/ 也必须有 —— 否则是上一次构建的残骸（旧哈希文件最典型），
     没人引用，但会永远留在仓库里、被 Pages 原样发出去。

只在「产物命名空间」内比对（顶层 index.html / config.js / manifest.webmanifest / sw.js，
以及 assets/ icons/ fonts/ 三个目录），源码、工具、文档、README 一律不参与，误报为 0。

用法
----
    python3 tools/check_public_sync.py          # 门禁：不一致 → 退出 1
    python3 tools/check_public_sync.py -v       # 同时列出全部一致项
退出码：0 一致（或 public/ 还没构建）；1 有不一致；3 环境不具备（-h）
"""
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")

# 产物命名空间：根目录只有这些位置是"线上站点"，其余是工程文件
TOP_FILES = ("index.html", "config.js", "manifest.webmanifest", "sw.js")
TOP_DIRS = ("assets", "icons", "fonts")

# 便于人眼定位的标识：同一个文件两边名字一样但内容不同时，光看大小往往一样
# （sw.js 两边都是 10044 B），必须把 build 号打出来才看得出谁旧。
_ID_PATTERNS = (
    (re.compile(r"BUILD_ID\s*=\s*'([0-9a-f]{6,})'"), "BUILD_ID"),
    (re.compile(r"version:\s*'([0-9a-f]{6,})'"), "version"),
    (re.compile(r"style\.([0-9a-f]{12})\.css"), "style"),
)


def scope_files(base):
    """命名空间内的 {相对路径: 绝对路径}"""
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


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def build_id(path):
    """抽 build 标识；抽不到返回 '-'。只读前 64 KB —— 这些标识都在文件开头。"""
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            head = f.read(65536)
    except OSError:
        return "-"
    for pat, label in _ID_PATTERNS:
        m = pat.search(head)
        if m:
            return "%s=%s" % (label, m.group(1))
    return "-"


def size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return -1


def main():
    verbose = "-v" in sys.argv or "--verbose" in sys.argv

    if not os.path.isdir(PUB) or not scope_files(PUB):
        # 没构建：这不是"不一致"，是"还没生成"。build 段与 build --check 会先拦，
        # 这里不打红，免得新 clone 的人第一次跑就看见一条与己无关的失败。
        print("○ public/ 还没构建（跑 python3 tools/build.py）")
        return 3

    pub = scope_files(PUB)
    root = scope_files(ROOT)

    diffs = []          # (相对路径, 类别, 明细)
    same = []

    for rel in sorted(pub):
        rp = os.path.join(ROOT, rel)
        if not os.path.isfile(rp):
            diffs.append((rel, "缺失", [
                "public/%s  %d B  %s" % (rel, size(pub[rel]), build_id(pub[rel])),
                "根目录      —— 不存在",
            ]))
            continue
        if sha256(pub[rel]) != sha256(rp):
            diffs.append((rel, "内容不同", [
                "public/%s  %d B  %s  sha=%s" % (rel, size(pub[rel]), build_id(pub[rel]), sha256(pub[rel])[:12]),
                "根目录      %d B  %s  sha=%s" % (size(rp), build_id(rp), sha256(rp)[:12]),
            ]))
        else:
            same.append(rel)

    # 反向：根目录有、public 没有 = 上次构建的残骸
    for rel in sorted(root):
        if rel not in pub:
            diffs.append((rel, "残骸", [
                "根目录      %d B  %s" % (size(root[rel]), build_id(root[rel])),
                "public/     —— 没有（本次构建不再产出这个文件）",
            ]))

    if verbose:
        for rel in same:
            print("  ✓ %s" % rel)

    if not diffs:
        print("✅ %d 个产物逐字节一致（根目录 = public/）" % len(same))
        return 0

    print("✗ %d 处不一致（public/ 是构建产物，仓库根目录才是线上站点）：" % len(diffs))
    for rel, kind, lines in diffs:
        print("\n  %s  [%s]" % (rel, kind))
        for ln in lines:
            print("    %s" % ln)
    print("\n修法：python3 tools/promote.py   （public/ → 根目录，整体同步且删除残骸）")
    print("      或临时：cp public/<文件> .")
    return 1


if __name__ == "__main__":
    sys.exit(main())
