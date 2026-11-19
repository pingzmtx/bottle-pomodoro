#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""应用锁「黑名单 → 白名单」迁移的**行为级**离线测试（0.2.4 / C）。

## 为什么这条必须单独测

语义是反的：

```
0.2.3  shouldBlock = pkg ∈ guard.apps          // 命中才拦
0.2.4  shouldBlock = pkg ∉ guard.allow         // 不在白名单就拦（空集 = 全拦）
```

从 0.2.3 升级上来、且 `guard.enabled` 还开着的用户，如果迁移写错一格，
**第一次专注就会除系统应用外全拦**（微信 / 备忘录 / 相机全打不开）——
用户会认为 App 坏了。所以这里把"升级前 → App.onCreate → 升级后"的 prefs
逐格跑一遍，断言的是**跑完之后的 prefs 内容**，不是源码里有没有某一行。

## 验的四件事

① 迁移四步：`guard.enabled=false` / `guard.allow={}` / 删除 `guard.apps` / `ruleVersion=2`；
② **不反迁**：旧黑名单的包名一个都不许出现在 `guard.allow` 里；
③ 幂等：第二次启动（ruleVersion 已是 2）不再动任何键；
④ 空白名单的语义：迁移后开关是关的 → 不拦；用户重新打开并勾选后 → 只放行勾选的；
   一个都不勾就打开 → 设置页必须弹原生确认框（`没有选择任何允许的应用…`），取消则不开启。

## 实现方式

`App.onCreate` 要 `android.jar`（本工程 Gradle 依赖全离线），所以这里
**从线上同一份 Guard.kt / AppSettingsActivity.kt 抽取迁移与开关的调用序列**，
在一份 prefs 模型上执行 —— 与 `qa_orphan_active.py` 同一取舍，但断言的是状态而非字符串。

跑法：`python3 app/tools/qa_guard_migration.py`（退出码 0 = 全过）
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
GUARD_KT = ROOT / "src/main/java/im/bottle/focus/Guard.kt"
RULES_KT = ROOT / "src/main/java/im/bottle/focus/GuardRules.kt"
STATE_KT = ROOT / "src/main/java/im/bottle/focus/State.kt"
SETTINGS_KT = ROOT / "src/main/java/im/bottle/focus/AppSettingsActivity.kt"
APPS_KT = ROOT / "src/main/java/im/bottle/focus/GuardAppsActivity.kt"
STRINGS_XML = ROOT / "src/main/res/values/strings.xml"

PASS = 0
FAIL = 0

OLD_APPS = {"com.tencent.mm", "com.zhihu.android"}  # 0.2.3 的黑名单（要拦的）
WECHAT = "com.tencent.mm"
CAMERA = "com.android.camera"
SELF = "im.bottle.focus"
LAUNCHERS = {"com.miui.home"}
IMES = {"com.sohu.inputmethod.sogou"}


def ok(name):
    global PASS
    PASS += 1
    print("PASS  " + name)


def bad(name, detail=""):
    global FAIL
    FAIL += 1
    print("FAIL  " + name + (("  <- " + detail) if detail else ""))


def check(name, cond, detail=""):
    if cond:
        ok(name)
    else:
        bad(name, detail)


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    out = []
    for line in src.splitlines():
        s = line.strip()
        if s.startswith("*") or s.startswith("//"):
            continue
        out.append(re.sub(r"//.*$", "", line))
    return "\n".join(out)


def fun_body(src, signature_re):
    m = re.search(signature_re, src, flags=re.S)
    if not m:
        return ""
    mm = re.search(r"\)[^{]*\{", src[m.end() - 1:])
    if not mm:
        return ""
    i = src.find("{", m.end() - 1 + mm.end() - 1)
    if i < 0:
        return ""
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1:j]
    return ""


GUARD_SRC = GUARD_KT.read_text(encoding="utf-8")
GUARD = strip_comments(GUARD_SRC)
MIGRATE = fun_body(GUARD, r"fun migrateGuardRule\(ctx: Context\)")
SETTINGS = strip_comments(SETTINGS_KT.read_text(encoding="utf-8"))
RULES = strip_comments(RULES_KT.read_text(encoding="utf-8"))
STATE = strip_comments(STATE_KT.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- prefs 模型

RULE_VERSION = 2


def prefs_023():
    """0.2.3 现场：黑名单两人、开关开着、没有 ruleVersion（缺省 0）。"""
    return {
        "guard.enabled": True,
        "guard.apps": set(OLD_APPS),
        "guard.allow": None,      # 键不存在
        "guard.ruleVersion": 0,
    }


def copy_of(p):
    q = dict(p)
    q["guard.apps"] = set(p["guard.apps"]) if p.get("guard.apps") is not None else None
    q["guard.allow"] = set(p["guard.allow"]) if p.get("guard.allow") is not None else None
    return q


def migrate(p):
    """执行 Guard.migrateGuardRule 的四步（顺序由调用序列断言保证，见下）。"""
    if p["guard.ruleVersion"] >= RULE_VERSION:
        return False
    p["guard.enabled"] = False
    p["guard.allow"] = set()
    p["guard.apps"] = None       # remove(K_GUARD_APPS)
    p["guard.ruleVersion"] = RULE_VERSION
    return True


# --------------------------------------------- shouldBlock 的白名单语义（同 GuardRules）

def should_block(p, pkg, active=True, mode="focus"):
    if not p["guard.enabled"]:
        return False
    if not active:
        return False
    if mode not in ("focus", "free"):
        return False
    if pkg in ("com.android.systemui", "com.android.settings", "com.android.dialer",
               "com.android.deskclock", "com.android.permissioncontroller"):
        return False
    if pkg == SELF:
        return False
    if pkg in LAUNCHERS or pkg in IMES:
        return False
    allow = p["guard.allow"] or set()
    if pkg in allow:
        return False
    return True


# ------------------------------------------------------------------ ① 迁移状态表


def migration_state_table():
    print("\n--- ① 迁移状态表（0.2.3 → 0.2.4）---")
    before = prefs_023()
    after = copy_of(before)
    changed = migrate(after)

    check("迁移真的执行了（ruleVersion 0 → 2）", changed and after["guard.ruleVersion"] == 2,
          str(after["guard.ruleVersion"]))
    check("guard.enabled：true → false（升级后不自动全拦）", after["guard.enabled"] is False)
    check("guard.allow：不存在 → 空集", after["guard.allow"] == set(), str(after["guard.allow"]))
    check("guard.apps：整条删除（不是留空集）", after["guard.apps"] is None, str(after["guard.apps"]))
    check("guard.ruleVersion：0 → 2", after["guard.ruleVersion"] == 2)

    leaked = (after["guard.allow"] or set()) & OLD_APPS
    check("旧黑名单一个包名都没漏进 guard.allow（不反迁）", not leaked, str(leaked))

    # 迁移后（开关关着）：什么都不拦 —— 这就是"防升级后一开就全拦"
    check("迁移后开微信 → 不拦（开关是关的）", not should_block(after, WECHAT))
    check("迁移后开相机 → 不拦", not should_block(after, CAMERA))


# ------------------------------------------------------------------ ② 幂等


def migration_idempotent():
    print("\n--- ② 迁移幂等（第二次启动不动任何键）---")
    p = prefs_023()
    migrate(p)
    snapshot = copy_of(p)
    again = migrate(p)
    check("第二次启动 migrateGuardRule 返回 false（不再迁移）", again is False)
    check("第二次启动 prefs 完全未变", p == snapshot, f"{p} != {snapshot}")

    # 已经是 0.2.4 的全新用户（ruleVersion=2、开关关着）：什么都不做
    fresh = {"guard.enabled": False, "guard.apps": None, "guard.allow": set(), "guard.ruleVersion": 2}
    check("全新装（ruleVersion=2）不重复迁移", migrate(fresh) is False)


# ------------------------------------- ③ 迁移之后：重新打开 + 勾选的行为


def after_migration_user_flow():
    print("\n--- ③ 迁移后用户重新打开的三种走法 ---")
    p = prefs_023()
    migrate(p)

    # ① 一个都不勾就打开（确认框里点了「确定开启」）
    p1 = copy_of(p)
    p1["guard.enabled"] = True
    check("空白名单 + 打开 → 普通应用全拦（空集合 = 全拦）", should_block(p1, CAMERA))
    check("空白名单 + 打开 → 微信也拦", should_block(p1, WECHAT))
    check("空白名单 + 打开 → 设置 / 桌面 / 输入法仍放行",
          not should_block(p1, "com.android.settings")
          and not should_block(p1, "com.miui.home")
          and not should_block(p1, "com.sohu.inputmethod.sogou"))
    check("空白名单 + 打开 → 自己包名仍放行", not should_block(p1, SELF))
    check("空白名单 + 打开 → 暂停（active=false）不拦", not should_block(p1, WECHAT, active=False))
    check("空白名单 + 打开 → 休息段不拦", not should_block(p1, WECHAT, mode="shortBreak"))

    # ② 勾一个微信再打开
    p2 = copy_of(p)
    p2["guard.allow"] = {WECHAT}
    p2["guard.enabled"] = True
    check("白名单 {微信} + 打开 → 微信放行", not should_block(p2, WECHAT))
    check("白名单 {微信} + 打开 → 相机仍拦", should_block(p2, CAMERA))

    # ③ 取消勾选（用户把允许项删空）→ 又变成全拦
    p3 = copy_of(p2)
    p3["guard.allow"] = set()
    check("把允许项删空后 → 相机照样拦（语义一致，不出现「空=不拦」的旧行为）",
          should_block(p3, CAMERA))


# ------------------------------------------------- ④ 源码契约（迁移 / 弹窗 / 文案）


def source_contract():
    print("\n--- ④ 源码契约 ---")

    check("Guard.kt 有 migrateGuardRule", bool(MIGRATE))
    i_enabled = MIGRATE.find("setGuardEnabled(ctx, false)")
    i_allow = MIGRATE.find("setGuardAllow(ctx, emptySet())")
    i_legacy = MIGRATE.find("removeLegacyGuardApps(ctx)")
    i_version = MIGRATE.find("setGuardRuleVersion")
    check("迁移顺序：关开关 → 清白名单 → 删旧键 → 写版本",
          -1 < i_enabled < i_allow < i_legacy < i_version,
          f"{i_enabled},{i_allow},{i_legacy},{i_version}")
    check("迁移里有 ruleVersion 短路（幂等）", ">= State.GUARD_RULE_VERSION" in MIGRATE)
    check("迁移**不**读旧 guard.apps 的内容（不反迁）",
          "guardApps" not in MIGRATE and "getStringSet(K_GUARD_APPS" not in MIGRATE)

    check("State 有 guard.allow 键", '"guard.allow"' in STATE)
    check("State 有 guard.ruleVersion 键", '"guard.ruleVersion"' in STATE)
    check("State 的 GUARD_RULE_VERSION = 2", "GUARD_RULE_VERSION = 2" in STATE)
    check("State 读 guard.allow 做 HashSet 拷贝", "HashSet(raw)" in STATE)
    check("State 写 guard.allow 做 HashSet 拷贝", "putStringSet(K_GUARD_ALLOW, HashSet(apps))" in STATE)
    check("State 不再暴露 guardApps 读写（只剩迁移用的删除）",
          "fun guardApps(" not in STATE and "fun markGuardApp(" not in STATE)

    check("GuardRules.shouldBlock 里 allowList 判为放行",
          "i.allowList.any" in RULES)
    check("GuardRules 已无 i.apps（黑名单入参删除）", "i.apps" not in RULES)
    check("GuardRules.Input 的字段叫 allowList", "val allowList: Set<String>" in RULES)

    # 空集合弹窗
    check("设置页有「没有选择任何允许的应用」确认框",
          "没有选择任何允许的应用，专注期间除系统应用外将全部拦截。确定开启？" in SETTINGS)
    i_empty = SETTINGS.find("State.guardAllow(this).isEmpty()")
    i_dialog = SETTINGS.find("confirmEnableWithEmptyAllowList()")
    check("空名单先弹框、不直接开启", -1 < i_empty < i_dialog, f"{i_empty},{i_dialog}")
    on_toggle = fun_body(SETTINGS, r"private fun onGuardToggled\(on: Boolean\)")
    check("onGuardToggled 在空名单时**提前 return**（不落 setGuardEnabled(true)）",
          "guardAllow(this).isEmpty()" in on_toggle
          and on_toggle.find("isEmpty()") < on_toggle.find("enableGuard()"))
    m_cancel = re.search(r'setNegativeButton\("取消"\)(.*?)\.setOnCancel', SETTINGS, flags=re.S)
    check(
        "取消按钮不开启（只 refreshSoon，不落 guard.enabled=true）",
        m_cancel is not None and "enableGuard()" not in m_cancel.group(1),
    )

    # 文案反转
    check("设置页标题是「允许使用的应用」", "允许使用的应用" in SETTINGS)
    check("设置页空名单副标题写明只允许系统应用",
          "未选择时，专注期间只允许系统应用" in SETTINGS)
    check("选择页标题改成「选择允许使用的应用」（strings.xml 的 guard_apps_title）",
          'name="guard_apps_title">选择允许使用的应用<' in STRINGS_XML.read_text(encoding="utf-8"))
    check("选择页计数是「已允许 N 个」",
          "已允许 ${selected.size} 个" in strip_comments(APPS_KT.read_text(encoding="utf-8")))
    check("设置页不再出现「选择要拦截的应用」", "选择要拦截的应用" not in SETTINGS)


def main():
    migration_state_table()
    migration_idempotent()
    after_migration_user_flow()
    source_contract()

    print()
    print(f"结果：{PASS} PASS / {FAIL} FAIL")
    if FAIL > 0:
        print("IS_PASS: NO")
        return 1
    print("IS_PASS: YES")
    return 0


if __name__ == "__main__":
    sys.exit(main())
