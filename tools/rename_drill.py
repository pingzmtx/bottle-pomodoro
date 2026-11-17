#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""改名演练：把「改一个文件名 → 全链仍绿」从口号变成一条命令。

用法
----
    python3 tools/rename_drill.py --key ui_memo            # 保键改名：01e9_ui_memo.js → ui_memo.js
    python3 tools/rename_drill.py --key ui_memo --fast     # 只跑快档（跳过 smoke，约 40s）
    python3 tools/rename_drill.py --key ui_memo --keep     # 保留临时目录，便于事后翻现场
    python3 tools/rename_drill.py --key ui_memo --to memo_note.js   # 改键改名（会预期报错，见下）

它在做什么
----------
1. `git clone` 当前仓库到临时目录（**只演练已提交的状态**，脏工作区不参与）
2. `git mv` 目标文件 + 改 `src/manifest.json` 一行（这是唯一真源）
3. `python3 tools/build.py`（重建 public/）+ `build.py --check`（逐字节自检）
4. `python3 tools/verify.py`（全量；`--fast` 则只跑静态段）

为什么值得单独做一个工具
------------------------
阶段 3 的验收口径不是「硬编码剩几处」——那只是手段。真正的口径是：
**改一个文件名，除了 manifest 一行，不该再有任何东西要改**。
这个口径只能靠"真的改一次"来验。本轮就是靠它抓出 4 处断链（owner 串、
空 catch 基线、数据写权基线、innerHTML 注入基线），在此之前它们全绿。

两种改名，两种预期
------------------
· **保键改名**（默认）：新名字仍是语义键本身（ui_memo → ui_memo.js）。
  语义键不变 → 所有基线/工具/分组表都不该动 → 期望全绿。

· **改键改名**（--to）：语义键变了 = 身份变了。此时 4 个门禁**应该**报错，
  因为它们登记的是"谁"：case 的 owner、空 catch 基线、数据写权基线、
  innerHTML 签名。这不是 bug，是提醒你"身份变了要重新登记"。
  另外 UI 层判定靠文件名里的 ui/view/component/a11y 关键字
  （engine_ui_ast.js 的 isUI），改名时把 ui 去掉会让文件被当成引擎层，
  eubound 会红 —— 这也算"语义真的变了"，不是工具坏了。

退出码：0 全绿 / 1 有段红 / 2 用法错 / 3 环境问题（不是 git 仓库 / 工作区脏到无法演练）
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

try:
    from filemap import FM, key_of
except ImportError:                                   # pragma: no cover
    print("✗ 找不到 filemap.py（本工具必须在 tools/ 下运行）")
    sys.exit(3)


def run(cmd, cwd, capture=True):
    r = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str),
                       capture_output=capture, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def failed_segments(out):
    """从 verify 输出里回收失败的段名（形如 '  ✗ eubound 0.6s'）。"""
    names = []
    for ln in out.splitlines():
        m = re.match(r"\s*✗\s+([A-Za-z0-9_]+)\s", ln)
        # 只收小写段名：lint 段自己会打 '✗ LINT FAIL'，全大写那种不是段名
        if m and not m.group(1).isupper() and m.group(1) not in names:
            names.append(m.group(1))
    return names


def main():
    argv = sys.argv[1:]
    if "-h" in argv or "--help" in argv or "--key" not in argv:
        print(__doc__)
        return 0 if ("-h" in argv or "--help" in argv) else 2

    key = argv[argv.index("--key") + 1] if argv.index("--key") + 1 < len(argv) else ""
    try:
        old_name = FM.path(key)
    except KeyError as e:
        print("✗ " + str(e))
        return 2
    new_name = argv[argv.index("--to") + 1] if "--to" in argv else key + ".js"
    if not new_name.endswith(".js"):
        new_name += ".js"
    if not re.match(r"^[A-Za-z_][\w\u4e00-\u9fff]*\.js$", new_name):
        print("✗ 新名字不合法：%s（不要带序号前缀与路径）" % new_name)
        return 2

    keep = "--keep" in argv
    fast = "--fast" in argv

    # 工作区脏不脏只影响「演练的是哪个版本」，不影响结论；但要说清楚。
    rc, out = run(["git", "status", "--porcelain"], ROOT)
    if rc != 0:
        print("✗ %s 不是 git 仓库" % ROOT)
        return 3
    dirty = [l for l in out.splitlines() if l.strip()]

    tmp = tempfile.mkdtemp(prefix="rename_drill_")
    dst = os.path.join(tmp, "repo")
    print("== 改名演练：%s → %s ==" % (old_name, new_name))
    print("   临时副本：%s" % dst)
    if dirty:
        print("   ⚠️ 工作区有 %d 个未提交改动 —— 演练只用**已提交**的状态，"
              "这些改动不参与（先提交再演练才准）" % len(dirty))

    try:
        rc, out = run(["git", "clone", "-q", "--no-hardlinks", ROOT, dst], tmp)
        if rc != 0:
            print("✗ clone 失败：\n" + out[-800:])
            return 3
        # clone 不带 hooksPath；gate 段会因此跳过。装上，否则演练少一段。
        run([sys.executable, "tools/install_hooks.py"], dst)

        steps = [
            ("git mv", ["git", "mv", "src/scripts/" + old_name, "src/scripts/" + new_name]),
        ]
        for label, cmd in steps:
            rc, out = run(cmd, dst)
            if rc != 0:
                print("✗ %s 失败：\n%s" % (label, out[-800:]))
                return 3

        man = os.path.join(dst, "src", "manifest.json")
        raw = open(man, encoding="utf-8").read()
        hit = raw.count('"%s"' % old_name)
        if hit != 1:
            print("✗ manifest 里 %s 出现 %d 次（期望 1 次）" % (old_name, hit))
            return 3
        open(man, "w", encoding="utf-8").write(raw.replace('"%s"' % old_name, '"%s"' % new_name))

        rc, out = run([sys.executable, "tools/build.py"], dst)
        if rc != 0:
            print("✗ build 失败：\n" + out[-1500:])
            return 1
        rc, out = run([sys.executable, "tools/build.py", "--check"], dst)
        if rc != 0:
            print("✗ build --check 失败（产物没能逐字节重建）：\n" + out[-1500:])
            return 1

        vcmd = [sys.executable, "tools/verify.py"] + (["--fast"] if fast else [])
        rc, out = run(vcmd, dst)
        segs = failed_segments(out)
        tail = "\n".join(out.strip().splitlines()[-6:])
        print(tail)
        if rc == 0:
            print("\n✅ 改名演练通过：%s → %s，只动了 manifest 一行" % (old_name, new_name))
            if key_of(new_name) != key:
                print("   注：语义键从 %s 变成了 %s —— 身份变了，全绿说明登记表也跟着换了（少见）"
                      % (key, key_of(new_name)))
            return 0
        print("\n❌ 改名演练失败：%d 段红 —— %s" % (len(segs), ", ".join(segs) or "（未解析到段名）"))
        if key_of(new_name) != key:
            print("   预期之内：语义键 %s → %s 是**换身份**，登记表（owner / 数据写权 / "
                  "空 catch / innerHTML 签名）本来就要跟着改；\n   这条路不是阶段 3 的验收口径。"
                  % (key, key_of(new_name)))
        else:
            print("   这是真断链：语义键没变，说明还有工具/基线在用全名。"
                  "把上面红的那几段贴出来就能定位。")
        print("   现场保留在：%s" % dst)
        keep = True
        return 1
    finally:
        if not keep:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
