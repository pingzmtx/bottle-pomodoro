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

退出码：0 全绿 · 1 真断链（保键改名却红）/ 2 用法错 /
        3 环境问题（不是 git 仓库 / clone 失败 / manifest 命中次数不对）/
        4 **设计内红**（换键改名，且该红的段都红了 —— 不是故障，CI 里不要当失败）
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

EXPECT_RED_ON_KEY_CHANGE_PLACEHOLDER = None   # 由 expected_red(key, new_name) 派生，见下

try:
    from filemap import FM, key_of
except ImportError:                                   # pragma: no cover
    print("✗ 找不到 filemap.py（本工具必须在 tools/ 下运行）")
    sys.exit(3)


def _read_json(rel, default):
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        return default
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _owner_tokens():
    """冒烟用例里出现过的全部 owner 词（换键后 casemeta 会不会红，取决于它）。"""
    p = os.path.join(ROOT, "tools", "run_smoke.py")
    if not os.path.exists(p):
        return set()
    src = open(p, encoding="utf-8").read()
    out = set()
    for m in re.finditer(r'owner\s*=\s*"([^"]*)"', src):
        out.update(m.group(1).split())
    return out


def _is_ui(name):
    """与 tools/engine_ui_ast.js 的 isUI 同一条判据（分层靠文件名关键字）。"""
    return bool(re.search(r"ui|view|component|a11y", name, re.I))


def expected_red(key, new_name):
    """换键改名时**应该**红的段 —— 按这个键在登记表里的实际登记情况派生，不写死。

    写死过一版（"永远期望 eubound/casemeta/catch/domain 全红"），复审当场用
    --key ui_summary 打回来：那个键不是任何用例的 owner、空 catch 为 0、
    也不是数据写者，三段不红是**正确**的，却被报成"该段失明"。
    正确做法：谁登记了它，谁才该红。
    """
    exp = set()
    if key in _owner_tokens():
        exp.add("casemeta")                                   # owner 表
    catch = _read_json("src/empty_catch_baseline.json", {}).get("files", {})
    if catch.get(key, 0) > 0:
        exp.add("catch")                                      # 空 catch 基线
    doms = _read_json("src/data_ownership.json", {}).get("domains", {})
    for d in doms.values():
        if key in (d.get("writers") or []) or d.get("owner") == key:
            exp.add("domain")                                 # 数据写权基线
            break
    if key in _read_json("src/innerhtml_baseline.json", {}).get("files", []):
        exp.add("lint")                                       # 注入签名（挂在 lint 段里）
    if _is_ui(new_name) != _is_ui(FM.path(key)):
        exp.add("eubound")                                    # 分层关键字变了
        exp.add("lint")                                       # eubound 红了 lint 一定红（汇总壳）
    return exp


def _group_keys():
    """tools/group_split.py 的 GROUPS 里列了哪些键（这些键改键改名会先崩 build）。"""
    try:
        from group_split import GROUPS
    except Exception:
        return set()
    out = set()
    for _g, files in GROUPS:
        for f in files:
            try:
                out.add(key_of(f))
            except Exception:
                pass
    return out


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

    # 换键改名 + 这个键在分组表里 → build 会在 import 期就 KeyError（见 group_split.GROUPS）。
    # 与其让演练崩在 KeyError，不如提前说清楚「这里也要改」。
    if key_of(new_name) != key and key in _group_keys():
        print("✗ %s 在 tools/group_split.py 的 GROUPS 里（core/base/engine 分层表）。" % key)
        print("  换键改名必须同时改那张表，否则 build 直接 KeyError。本演练不做自动修补 ——")
        print("  先手工改 GROUPS，再跑 `--key %s`（保键改名）验证其余部分。" % key)
        return 3

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
        key_changed = key_of(new_name) != key

        if rc == 0:
            print("\n✅ 改名演练通过：%s → %s，只动了 manifest 一行" % (old_name, new_name))
            if key_changed:
                print("   ⚠️ 但语义键从 %s 变成了 %s —— 换身份却全绿，说明某张登记表不再按"
                      "「谁」守了，去查 owner / 数据写权 / 空 catch / innerHTML 签名"
                      % (key, key_of(new_name)))
            return 0

        print("\n✗ 有段红：%d 段 —— %s" % (len(segs), ", ".join(segs) or "（未解析到段名）"))
        if not key_changed:
            print("   ❌ 真断链：语义键没变（还是 %s），说明还有工具/基线在用全名。" % key)
            print("      把上面红的那几段贴出来就能定位；现场留在：%s" % dst)
            keep = True
            return 1

        # 换身份：只有「登记过这个键」的段才该红，且它们必须真的红
        want = expected_red(key, new_name)
        missing = sorted(want - set(segs))
        extra = sorted(set(segs) - want)
        if missing:
            print("   ❌ 换键改名应红未红：%s" % ", ".join(missing))
            print("      该段登记了这个键（见 expected_red），换键却没报 = 该段失明或已被摘掉。"
                  "现场留在：%s" % dst)
            keep = True
            return 1
        print("   ○ 预期之内：语义键 %s → %s 是**换身份**；红的正是登记过它的段（%s）"
              % (key, key_of(new_name), ", ".join(sorted(want)) or "无"))
        if extra:
            print("     顺带还要动：%s（没登记过这个键、但也受牵连，多半是分组/层级/文档链）"
                  % ", ".join(extra))
        print("      （这条路不是阶段 3 的验收口径；口径是保键改名全绿。）")
        return 4                                        # 4 = 设计内红，不是故障
    finally:
        if not keep:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
