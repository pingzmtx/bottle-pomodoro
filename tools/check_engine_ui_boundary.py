#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""引擎→UI 边界门禁（E3 契约的可执行版）。

为什么需要它
    src/scripts/01z_ui_facade.js 的文件头写着「引擎层不许直接调 UI」。
    这条约定在 2026-11 之前只存在于注释里：实测引擎层直接调用 UI 符号 215 处
    （01g 一个文件 95 处），没有任何东西在守。按加载序号切文件的历史后果是
    「调用方向没人管」，于是 62 个文件被 511 条运行期调用边焊成一个连通分量。
    本段把注释变成判据。

三道判据
    1. direct —— 引擎文件里以裸标识符调用 UI 文件的函数。非 0 即 FAIL。
       这不是风格问题：裸标识符靠全局作用域解析，UI 未加载时抛 ReferenceError，
       加载顺序一旦变动就是运行时崩溃。
    2. allow  —— `UIFX.xxx` 的 xxx 必须在白名单里。门面是 Proxy，
       `UIFX.whatever()` 永远不报错、只会静默返回 undefined —— 不设白名单，
       门面就成了「随便摸 UI 内部」的万能通道。
    3. patch  —— 引擎改写 UI 实现的处数。只准降。两种形态语义相同：
       a) `window.renderTodos = function(){…}`（显式写全局对象）
       b) `renderTodos = function(){…}`（裸赋值 —— 本项目所有函数都在全局作用域，
          运行时命中同一个绑定，所以这是同一个动作的另一种写法）
       2026-11-16 之前只认 a：判据卡在 MemberExpression 左值上，`01g:2068`
       `applySettingsToUI = function(){…}` 因此一年都没被看见（真实是 12，不是 11）。
       现在两种都收，并卡两处避免误报：目标是**函数形态的声明**、右值是**函数值**。
       裸赋值里把字面量写进 UI 变量（定时器句柄 `immersionIv = 0`、脏检查签名
       `_todoSig = '__force__'`）不算改写，-v 会单列出来自证没漏判。

不判 FAIL 的
    alias —— `const f = renderTodos` 这类取引用。它是 patch 的原材料，
    本身不改变行为；列出来供人工判断。

基线
    tools/engine_ui_allowlist.json 存「允许的 107 个门面能力」+「12 处已知 patch」。
    新增能力 / 新增 patch 都要显式 --update，让它们出现在 diff 里。

用法
    python3 tools/check_engine_ui_boundary.py            # 校验
    python3 tools/check_engine_ui_boundary.py -v         # 校验 + 全量清单
    python3 tools/check_engine_ui_boundary.py --update   # 收基线（有 direct 时拒绝）
退出码：0 通过 / 1 失败 / 3 环境不具备（没有 node）
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AST_JS = os.path.join(ROOT, "tools", "engine_ui_ast.js")
BASE = os.path.join(ROOT, "tools", "engine_ui_allowlist.json")

# 门面自带的 API，不是 UI 能力，不该进 allowlist
FACADE_API = {"toast", "bind", "get", "clearImmersionTimer",
              "setPendingImmersiveScript", "_registry"}


def run_ast():
    if not shutil.which("node"):
        print("✗ 环境不具备：找不到 node（本段需要 acorn 做 AST）")
        return None
    r = subprocess.run(["node", AST_JS], capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        print("✗ AST 侧失败：\n" + (r.stderr or r.stdout)[-1500:])
        return None
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception as e:
        print("✗ AST 输出不是 JSON：%s\n%s" % (e, r.stdout[:500]))
        return None


def key_of(item):
    return "%s::%s" % (item["file"], item["name"])


def main():
    verbose = "-v" in sys.argv
    update = "--update" in sys.argv

    data = run_ast()
    if data is None:
        return 3

    if data["parseFail"]:
        print("✗ 解析失败 %d 个文件，判不了就是没判：" % len(data["parseFail"]))
        for p in data["parseFail"]:
            print("    %s  %s" % (p["file"], p["error"]))
        return 1

    direct = data["direct"]
    used = [n for n in data["uifx"] if n not in FACADE_API]
    patches = [a for a in data["alias"] if a.get("patch")]
    aliases = [a for a in data["alias"] if not a.get("patch")]

    base = {"allow": [], "patch": []}
    if os.path.exists(BASE):
        with open(BASE, encoding="utf-8") as f:
            base = json.load(f)

    allow = set(base.get("allow", []))
    patch_base = {key_of(p) for p in base.get("patch", [])}
    patch_now = {key_of(p) for p in patches}

    fails = []

    # 1. 裸调
    if direct:
        fails.append("引擎裸调 UI %d 处（必须走 UIFX）：" % len(direct))
        for d in direct[:20]:
            fails.append("    %s:%d  %s()  @%s" % (d["file"], d["line"], d["name"], d["owner"]))
        if len(direct) > 20:
            fails.append("    …还有 %d 处" % (len(direct) - 20))

    # 2. 门面白名单
    extra = sorted(n for n in used if n not in allow)
    if extra and not update:
        fails.append("门面调用了白名单外的能力 %d 个（Proxy 不会报错，只会静默 undefined）：" % len(extra))
        for n in extra:
            fails.append("    UIFX.%s" % n)
        fails.append("    确认要新增能力：%s --update（diff 里会看到）"
                     % os.path.basename(__file__))

    # 3. patch 棘轮
    added = sorted(patch_now - patch_base)
    gone = sorted(patch_base - patch_now)

    def fmt(p):
        """按形态打印：window 形态与裸赋值形态的修法不同，别让人照着错的去查。"""
        if p.get("form") == "bare":
            return "%s:%d  %s = function(){…}   （裸赋值，与 window.%s 等价）" % (
                p["file"], p["line"], p["name"], p["name"])
        return "%s:%d  window.%s = …" % (p["file"], p["line"], p["name"])

    if added:
        fails.append("新增引擎改写 UI 实现 %d 处（棘轮只准降）：" % len(added))
        for k in added:
            p = next((x for x in patches if key_of(x) == k), {"file": k.split("::")[0],
                                                              "name": k.split("::")[1], "line": 0})
            fails.append("    " + fmt(p))

    if update:
        if direct:
            print("✗ 有裸调违反，拒绝收基线 —— 先把调用改走 UIFX")
            return 1
        out = {
            "_note": "引擎→UI 门面能力的白名单。新增一项必须 --update，"
                     "让「引擎能调哪个 UI 能力」这一步在 diff 里可见。"
                     "patch 段是引擎直接改写 UI 全局实现的位置，棘轮只准降。",
            "allow": sorted(used),
            "patch": [{"file": p["file"], "name": p["name"]}
                      for p in sorted(patches, key=key_of)],
        }
        with open(BASE, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        print("✓ 基线已更新：%d 项能力 / %d 处 patch" % (len(out["allow"]), len(out["patch"])))
        return 0

    # ---- 输出 ----
    print("🔒 引擎→UI 边界  |  引擎 %d 文件 · UI %d 文件" %
          (len(data["engineFiles"]), len(data["uiFiles"])))
    print("    裸调 %d 处 · 门面能力 %d 个（白名单 %d）· 改写 UI 实现 %d 处（基线 %d）"
          % (len(direct), len(used), len(allow), len(patches), len(patch_base)))

    if verbose:
        print("\n  门面能力清单：")
        for n in sorted(used):
            print("    %s%s" % (n, "" if n in allow else "   ← 白名单外"))
        print("\n  改写 UI 实现：")
        for p in sorted(patches, key=key_of):
            print("    " + fmt(p))
        print("\n  裸赋值但不算改写（判据卡了「目标是函数 + 右值是函数值」两条）：")
        for a in data.get("notPatch", []):
            print("    %s:%d  %s  @%s(%s)  rhs=%s" %
                  (a["file"], a["line"], a["name"], a["owner"], a["ownerKind"], a["rhs"]))
        print("\n  取引用（不判 FAIL，供人工看）：")
        for a in sorted(aliases, key=key_of):
            print("    %s:%d  %s" % (a["file"], a["line"], a["name"]))

    if gone:
        print("\n  · %d 处旧 patch 已消失（耦合变少，不拦）" % len(gone))
        for k in gone:
            print("      %s" % k.replace("::", "  window."))

    if fails:
        n_bad = len(direct) + len(extra) + len(added)
        print()
        for line in fails:
            print("  " + line)
        print("\n  ✗ 引擎→UI 边界：%d 个问题" % n_bad)
        return 1

    print("  ✓ 边界 OK：裸调 0 · 门面全部在册 · patch 未增长")
    return 0


if __name__ == "__main__":
    sys.exit(main())
