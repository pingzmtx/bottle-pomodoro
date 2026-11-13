#!/usr/bin/env python3
"""门禁：data-act 指向的函数必须真的存在（扫「点了没反应的按钮」）。

## 为什么需要这个工具

`00_delegate.js` 用 data-act 做事件委托：运行期 `resolve(name)` 从 window 上取同名
函数，取不到就 `console.error` 一行然后**什么都不做**。也就是说，模板里写错一个
函数名，在界面上表现为「按钮点了没反应」，既不抛错也不弹提示 —— 用户只会当成卡顿。

真实案例（2026-10-25）：`🔥 今日赌注` 的「小赌 / 中赌 / 大赌」三个按钮写着
`data-act="tryBetSafe"`，而代码里只有 `tryBet`。迁移到 ES 模块时模板改了名、
实现没跟上。三档按钮全部失效，从迁移上线一直没人发现，最后是用户报「点了没反应」。

## 判据

对每个 data-act 名字，检查它是否能被 window 解析到：
  · 目标函数在 src/ 里有顶层声明（function/const/let/var/class），或
  · 直接在 src/ 里出现过 `window.名字 =` 的赋值
gen_bridge 构建时会给每个顶层声明生成 window 访问器，所以「有顶层声明」即等于
「window 上能取到」。这条推断成立的前提在 tools/gen_bridge.js，若那边改了策略，
本门禁的口径要跟着改。

## 用法

    python3 tools/check_act_targets.py          # 有问题则退出码 1
    python3 tools/check_act_targets.py -v       # 列出全部检查项

已知豁免写在 ALLOW 里，且每条必须写理由 —— 没有理由的豁免过一段时间就会变成
「反正它豁免了」，等于把门禁关掉。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")

# 豁免：data-act 名称 -> 理由。留空是有意的，新增前先确认真的是「故意不实现」。
ALLOW = {}

# data-act="xxx" / data-act='xxx' / data-act=\"xxx\"（JS 里拼字符串）
ACT_RE = re.compile(r"""data-act=\\?["']([A-Za-z_$][\w$]*)\\?["']""")

# 会被 00_delegate 误接管的内联处理器：整条 handler 是 `this.xxx(...)` / `event.xxx(...)`
# —— CALLRE 把它当路径 a.b.c，resolve() 从 window 起走必然取不到，
# 于是属性被摘掉、换成一条无效 data-act，按钮点了彻底没反应。
HOSTCALL_RE = re.compile(r"""on(?:click|change|input|keydown|focus|blur)=\\?["']\s*(this|event)\.[\w$.]*\s*\([^"';]*\)\s*;?\s*\\?["']""")

# 顶层声明：function foo / const foo = / let foo = / var foo = / class Foo
DECL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)"
    r"([A-Za-z_$][\w$]*)",
    re.M,
)
# window.foo = ... 直接挂载（gen_bridge 之外的显式赋值）
WIN_RE = re.compile(r"window\.([A-Za-z_$][\w$]*)\s*=")


def read(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def walk(exts):
    for base, _dirs, files in os.walk(SRC):
        for n in files:
            if n.endswith(exts):
                yield os.path.join(base, n)


def main():
    verbose = "-v" in sys.argv

    acts = {}   # name -> [文件]
    for p in list(walk((".html", ".js", ".css"))):
        txt = read(p)
        for m in ACT_RE.finditer(txt):
            acts.setdefault(m.group(1), []).append(os.path.relpath(p, ROOT))

    declared = set()
    for p in walk((".js", ".html")):
        txt = read(p)
        declared.update(DECL_RE.findall(txt))
        declared.update(WIN_RE.findall(txt))

    missing = sorted(n for n in acts if n not in declared and n not in ALLOW)

    # ② 内联 `this.xxx()` / `event.xxx()` 单语句写法：委托接管后必然是死按钮
    hostcalls = []
    for p in walk((".html", ".js")):
        txt = read(p)
        for m in HOSTCALL_RE.finditer(txt):
            line = txt.count("\n", 0, m.start()) + 1
            hostcalls.append("%s:%d  %s" % (os.path.relpath(p, ROOT), line, m.group(0)[:72]))

    if hostcalls:
        print("✗ act 目标: %d 处内联处理器写成宿主方法调用（this.xxx() / event.xxx()）" % len(hostcalls))
        print("    00_delegate 会把它接管成无效的 data-act，点了不会有任何反应。")
        print("    改法：换成具名全局函数，元素当实参传进去，例如 onclick=\"removeRow(this)\"。")
        for h in hostcalls:
            print("    %s" % h)
        return 1

    if verbose:
        print("data-act 目标 %d 个，已声明标识符 %d 个" % (len(acts), len(declared)))
        for n in sorted(acts):
            mark = "OK" if n in declared or n in ALLOW else "✗"
            print("  %s %s  (%s)" % (mark, n, ", ".join(sorted(set(acts[n]))[:2])))

    if missing:
        print("✗ act 目标: %d 个 data-act 指向不存在的函数（点了不会有任何反应）" % len(missing))
        for n in missing:
            print("    %s  <- %s" % (n, ", ".join(sorted(set(acts[n]))[:3])))
        return 1

    print("✓ act 目标: %d 个 data-act 全部有对应实现" % len(acts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
