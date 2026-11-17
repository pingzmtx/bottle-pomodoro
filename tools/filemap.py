#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""文件名唯一映射：manifest → 语义键（阶段 3 的地基）。

用法
----
    python3 tools/filemap.py --check          # 自检：键唯一 / manifest 与磁盘双向一致
    python3 tools/filemap.py --list           # 键 → 文件名
    python3 tools/filemap.py --path ui_tree    # 键 → 文件名（脚本里也可 import）
    python3 tools/filemap.py --key ui_tree.js

脚本里
------
    from filemap import FM
    p = FM.path('ui_tree')        # → 'ui_tree.js'
    k = FM.key('ui_tree.js') # → 'ui_tree'

为什么要有它
------------
阶段 3 之前，工具/基线里散着 196 处 `ui_tree.js` 这样的全名。全名同时承担了两个
职责：**加载顺序**（01e5 这个序号）和**身份**（ui_tree 这个语义）。于是改名 = 全仓断链。

现在的分工：
    src/manifest.json 的 slots[0].files 数组  —— 唯一真源，决定顺序
    filemap 的语义键（去掉序号前缀）          —— 身份，改名时不变
    其他所有地方（工具、基线、分组表）        —— 只写语义键，运行期查一次

语义键 = 文件名去掉 `^[0-9][0-9A-Za-z]{0,3}_` 前缀：

    ui_tree.js  → ui_tree      （历史形态：2026-11-17 阶段 6 之前的文件名）
    ui_tree.js       → ui_tree      （现在是这种：文件名已经等于键）

阶段 6 已经把 71 个文件的序号前缀摘掉了，所以正常情况下 key == 文件名。前缀规则
留着有两个用处：① 有人加回前缀时键不变；② 判断「这次改名是保键还是换身份」。

所以给 `ui_tree.js` 加回前缀（→ `01e9_ui_tree.js`）只需要动 manifest 一行 + 移动文件；
任何工具、基线、分组表都不用改 —— 这是本文件存在的唯一理由。

退出码
------
0 一致 · 1 不一致（键冲突 / manifest 与磁盘不符）· 2 参数错
"""

import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MANIFEST = os.path.join(ROOT, "src", "manifest.json")
SCRIPTS = os.path.join(ROOT, "src", "scripts")

# 序号前缀：00_ / 0A_ / 01e5_ / 01dB_ / 02_ …（1-4 个字母数字 + 下划线）
RE_PREFIX = re.compile(r"^[0-9][0-9A-Za-z]{0,3}_")


def key_of(filename):
    """文件名 → 语义键。不是 .js 也照常处理（去掉最后一个扩展名）。"""
    base = filename[:-3] if filename.endswith(".js") else filename
    return RE_PREFIX.sub("", base, count=1)


def load_files():
    with io.open(MANIFEST, encoding="utf-8") as f:
        m = json.load(f)
    # 两种槽都要认：多文件槽 `files: [...]`（槽 1 / 槽 7）与单文件槽 `file: "..."`（槽 2-6 / 槽 9）。
    # 只读 slots[0] 会漏掉 14 个文件 —— 初版就这么写，--check 立刻报「磁盘有、manifest 没有」，
    # 这正是自检存在的意义。按 slot 序号合并，保持加载顺序。
    slots = m.get("slots")
    if not isinstance(slots, list) or not slots:
        raise SystemExit("✗ manifest 缺 slots")
    files = []
    for s in sorted(slots, key=lambda x: x.get("slot", 0)):
        if isinstance(s.get("files"), list):
            files.extend(s["files"])
        elif isinstance(s.get("file"), str):
            files.append(s["file"])
    if not files:
        raise SystemExit("✗ manifest 里没有解析到任何 .js")
    return files


def owner_of(path):
    """文件的「认领键」：basename 去掉序号前缀与 .js。

    与 key_of 的唯一区别：允许非 manifest 文件（如 src/template.html）。
    冒烟用例的 owner 串按它**精确等价**匹配 —— 不做子串匹配，
    因为子串会让 ui_stats 连带认领 ui_stats_month，把真正的覆盖盲区藏起来。
    """
    return key_of(os.path.basename(path))


class FileMap(object):
    def __init__(self):
        self.files = load_files()
        self.by_key = {}
        dups = {}
        for f in self.files:
            k = key_of(f)
            if k in self.by_key:
                dups.setdefault(k, [self.by_key[k]]).append(f)
            else:
                self.by_key[k] = f
        self.dups = dups

    # ---- 查询 ----
    def key(self, filename):
        """全名 → 语义键；不在 manifest 里 → KeyError（不返回 None，避免调用方静默带过）。"""
        if filename not in self.files:
            raise KeyError("不在 manifest：%s" % filename)
        return key_of(filename)

    def path(self, token):
        """语义键（或全名 / 唯一后缀）→ 文件名。解析不到就抛错，绝不返回原样。"""
        if token in self.by_key:
            return self.by_key[token]
        if token in self.files:
            return token
        hits = [f for f in self.files if f.endswith(token) or token in f]
        if len(hits) == 1:
            return hits[0]
        if not hits:
            raise KeyError("无法解析为文件：%s" % token)
        raise KeyError("有歧义（%d 个候选）：%s → %s" % (len(hits), token, ", ".join(hits)))

    def all(self):
        return list(self.files)

    # ---- 自检 ----
    def check(self):
        errs = []
        if self.dups:
            for k, fs in sorted(self.dups.items()):
                errs.append("语义键冲突：%s ← %s" % (k, " / ".join(fs)))
        disk = set(f for f in os.listdir(SCRIPTS) if f.endswith(".js"))
        man = set(self.files)
        only_disk = sorted(disk - man)
        only_man = sorted(man - disk)
        if only_disk:
            errs.append("磁盘有、manifest 没有：%s" % ", ".join(only_disk))
        if only_man:
            errs.append("manifest 有、磁盘没有：%s" % ", ".join(only_man))
        return errs


FM = FileMap()


def main():
    argv = sys.argv[1:]
    known = {"--check", "--list", "-h", "--help", "--path", "--key"}
    if any(a.startswith("-") and a not in known for a in argv):
        print("✗ 不认识的参数（支持 --check / --list / --path KEY / --key FILE）")
        return 2
    if "-h" in argv or "--help" in argv:
        print(__doc__)
        return 0
    if "--check" in argv:
        errs = FM.check()
        if errs:
            for e in errs:
                print("  ✗ " + e)
            return 1
        print("✓ filemap 一致：%d 个文件，%d 个语义键，键唯一" % (len(FM.files), len(FM.by_key)))
        return 0
    if "--list" in argv:
        for f in FM.files:
            print("%-40s %s" % (key_of(f), f))
        return 0
    if "--path" in argv:
        i = argv.index("--path")
        if i + 1 >= len(argv):
            print("✗ --path 需要一个键")
            return 2
        try:
            print(FM.path(argv[i + 1]))
        except KeyError as e:
            print("✗ " + str(e))
            return 1
        return 0
    if "--key" in argv:
        i = argv.index("--key")
        if i + 1 >= len(argv):
            print("✗ --key 需要一个文件名")
            return 2
        try:
            print(FM.key(argv[i + 1]))
        except KeyError as e:
            print("✗ " + str(e))
            return 1
        return 0
    print("✗ 需要一个动作：--check / --list / --path KEY / --key FILE")
    return 2


if __name__ == "__main__":
    sys.exit(main())
