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

第三种失效（2026-11-16 实测，本文件原来完全看不见）
--------------------------------------------------
到 11-15 为止，这道门禁只比「**工作区**根目录」与 public/。而 promote.py 写的就是工作区，
所以 promote 一跑完，两边必然相等 —— 判据永远为真，与「提交进历史的那份是新的还是旧的」无关。

实测故障：a7d39db 提交时只 `git add assets/app.js config.js sw.js`，漏了 `assets/engine.js`。
工作区根目录 478491 B（新），public/ 478491 B（新），git 里存的是 478481 B（旧，缺两个
`UIFX.`）。三处门禁全绿，只有 `git status` 里一行 `M assets/engine.js` —— 于是线上跑着旧
engine、本地一切正常。差 10 字节，谁都不会发现。

根因还是「靠挑文件」：白名单写在 上线.sh 里，而 `git add <几个路径>` 可以完全绕开它。
补法是让门禁自己看**暂存区**，也就是真正会被提交的那份：

    --staged   比对 `git index`（暂存区）与 public/，而不是工作区与 public/。

工作区口径证明「我 promote 了」；暂存区口径证明「我提交了 promote 的结果」。两句都要真。

用法
----
    python3 tools/check_public_sync.py          # 门禁：工作区根目录 vs public/
    python3 tools/check_public_sync.py --staged # 门禁：暂存区 vs public/（提交前必跑）
    python3 tools/check_public_sync.py -v       # 同时列出全部一致项
退出码：0 一致（或 public/ 还没构建）；1 有不一致；3 环境不具备（-h / --staged 但不在 git 里）
"""
import hashlib
import os
import re
import subprocess
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
    return _id_from_text(head)


def _id_from_text(head):
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


# ---------------- 暂存区（git index）读取 ----------------
def _git(args):
    """跑 git，返回 (rc, stdout_bytes)。cwd 固定仓库根，避免从别处调用时找错仓库。"""
    try:
        p = subprocess.run(["git"] + args, cwd=ROOT,
                           capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return -1, b""
    return p.returncode, p.stdout


def index_scope():
    """暂存区里本命名空间的 {相对路径: 内容 bytes}；不在 git 仓库里 → None"""
    rc, _ = _git(["rev-parse", "--git-dir"])
    if rc != 0:
        return None
    rc, out = _git(["ls-files", "-z", "--"] + list(TOP_FILES) + list(TOP_DIRS))
    if rc != 0:
        return None
    rels = [x for x in out.decode("utf-8", "surrogateescape").split("\0") if x]
    out_map = {}
    for rel in rels:
        rc, blob = _git(["cat-file", "-p", ":" + rel])
        if rc == 0:
            out_map[rel] = blob
    return out_map


def staged_deleted():
    """暂存区里被标记为删除的路径集合。

    没有它的话，「public/ 有、index 没有」只有一种解释：git add 漏了。
    而 `git rm --cached assets/engine.js` 造成的也是同一现象 —— 诊断会指错方向，
    让人去补 git add，实际该做的是决定「这个文件还要不要发布」。
    """
    rc, out = _git(["diff", "--cached", "--name-only", "--diff-filter=D"])
    if rc != 0:
        return set()
    return set(x for x in out.decode("utf-8", "surrogateescape").split("\n") if x)


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def check_staged(verbose):
    """暂存区 vs public/：证明「提交进历史的那份 = 构建产物」"""
    if not os.path.isdir(PUB) or not scope_files(PUB):
        print("○ public/ 还没构建（跑 python3 tools/build.py）")
        return 3
    idx = index_scope()
    if idx is None:
        print("✗ --staged 需要在 git 仓库里运行（找不到 .git）")
        return 3
    deleted = staged_deleted()

    pub = scope_files(PUB)
    diffs = []
    same = []

    for rel in sorted(pub):
        want = open(pub[rel], "rb").read()
        if rel not in idx:
            if rel in deleted:
                # 不是「忘了 add」，是「主动从 index 删了」——修法完全不同，必须分开报。
                diffs.append((rel, "已从 index 删除", [
                    "public/%s  %d B  %s" % (rel, len(want), build_id(pub[rel])),
                    "暂存区      —— 这个文件被标记为删除（git rm / git rm --cached）",
                ]))
            else:
                diffs.append((rel, "未暂存", [
                    "public/%s  %d B  %s" % (rel, len(want), build_id(pub[rel])),
                    "暂存区      —— 没有这个文件（git add 漏了，或压根没加过）",
                ]))
            continue
        got = idx[rel]
        if sha256_bytes(got) != sha256_bytes(want):
            diffs.append((rel, "暂存的是旧版", [
                "public/%s  %d B  %s  sha=%s" % (rel, len(want), build_id(pub[rel]), sha256_bytes(want)[:12]),
                "暂存区      %d B  %s  sha=%s" % (len(got), _id_from_text(got[:65536].decode("utf-8", "ignore")), sha256_bytes(got)[:12]),
            ]))
        else:
            same.append(rel)

    # 反向：暂存区还跟踪着 public/ 已经不产的文件 = 残骸进了历史
    for rel in sorted(idx):
        if rel not in pub:
            diffs.append((rel, "残骸仍被跟踪", [
                "暂存区      %d B  %s" % (len(idx[rel]), _id_from_text(idx[rel][:65536].decode("utf-8", "ignore"))),
                "public/     —— 没有（本次构建不再产出这个文件）",
            ]))

    if verbose:
        for rel in same:
            print("  ✓ %s" % rel)

    if not diffs:
        print("✅ 暂存区 %d 个产物逐字节一致（将要提交的 = public/）" % len(same))
        return 0

    print("✗ %d 处不一致（**要把这些提交进去**的那份 ≠ 构建产物）：" % len(diffs))
    for rel, kind, lines in diffs:
        print("\n  %s  [%s]" % (rel, kind))
        for ln in lines:
            print("    %s" % ln)
    print("\n为什么工作区检查是绿的却还是错：promote.py 写工作区，而 git 只提交你 git add 过的路径。")
    if any(kind == "已从 index 删除" for _, kind, _ in diffs):
        print("修法（有文件被标记删除）：误删 → git reset -- <path>；")
        print("      确实不再发布 → git rm public/<path> 后重新 build + promote")
    print("修法：git add -u          （已跟踪文件的修改全部进暂存区，一条覆盖 assets/*.js）")
    print("      或  git add -- assets icons fonts index.html config.js sw.js manifest.webmanifest")
    return 1


def main():
    # 不认识的参数一律报错（2026-11-14）：与 promote.py 同一条规矩 ——
    # 静默忽略参数会让 `--fix` / `--check` 这类"我以为它会做点什么"的调用
    # 变成"什么都没做还返回 0"，比报错更难查。
    known = {"-v", "--verbose", "-h", "--help", "--staged"}
    unknown = [a for a in sys.argv[1:] if a not in known]
    if unknown:
        print("✗ 不认识的参数：%s（本工具只读，支持 -v/--verbose/--staged）" % " ".join(unknown))
        return 2
    if "-h" in sys.argv or "--help" in sys.argv:
        print(__doc__)
        return 0
    verbose = "-v" in sys.argv or "--verbose" in sys.argv
    if "--staged" in sys.argv:
        return check_staged(verbose)

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
