#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Shim.kt 的 Kotlin raw string 里原样提取要注入的 JS。

为什么要有这一步（P1-2）：
`verify.sh` 以前全是静态 grep —— 它只证明"字符串里有 switchView 这几个字"，
而我们刚修的 P0 恰恰是"这段字符串从来没被执行过"。静态检查天生看不见执行路径，
所以把 JS 抽出来、真跑一遍，是唯一能挡住同类死代码的办法。

提取规则（任何一条不满足都直接失败，绝不静默猜）：
1. 定位 `private val TEMPLATE: String = ` 后面紧跟的三个双引号，以及配对的结尾三个双引号；
2. `\${'\$'}` 是 Kotlin 里的美元符转义，还原成 `\$`；
3. raw string 里若出现 `\$name` / `\${expr}` 说明 JS 内容会被 Kotlin 处理，必须报错；
4. 把占位符 `__BOTTLE_BRIDGE__` 换成 State.BRIDGE_NAME（模拟运行时的 .replace）。

用法：
    python3 app/tools/extract_shim.py                 # → app/build/shim.js
    python3 app/tools/extract_shim.py --out /tmp/x.js
"""
import argparse
import pathlib
import re
import sys

TRIPLE = '"' * 3
DOLLAR_ESC = "$" + "{'$'}"
PLACEHOLDER = "__BOTTLE_BRIDGE__"

HERE = pathlib.Path(__file__).resolve()
PROJECT_DIR = HERE.parents[2]                       # app/tools/x.py → bottle-android/
KT_DEFAULT = PROJECT_DIR / "app/src/main/java/im/bottle/focus/Shim.kt"
OUT_DEFAULT = PROJECT_DIR / "app/build/shim.js"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("kt", nargs="?", default=str(KT_DEFAULT), help="Shim.kt 路径")
    ap.add_argument("--out", default=str(OUT_DEFAULT), help="输出 JS 路径")
    args = ap.parse_args()

    kt = pathlib.Path(args.kt)
    out = pathlib.Path(args.out)
    if not kt.is_file():
        print("FATAL: 找不到 %s" % kt, file=sys.stderr)
        return 2

    src = kt.read_text(encoding="utf-8")

    # 桥名从 State.kt 读，不写字面量（名字只允许有一处真源）
    state = kt.parent / "State.kt"
    if not state.is_file():
        print("FATAL: 找不到 %s" % state, file=sys.stderr)
        return 2
    m = re.search(r'const\s+val\s+BRIDGE_NAME\s*=\s*"([^"]+)"', state.read_text(encoding="utf-8"))
    if not m:
        print("FATAL: 找不到 State.BRIDGE_NAME", file=sys.stderr)
        return 2
    bridge_name = m.group(1)

    anchor = "private val TEMPLATE: String = "
    idx = src.find(anchor)
    if idx < 0:
        print("FATAL: 找不到 %r" % anchor, file=sys.stderr)
        return 2
    start = idx + len(anchor)
    if src[start:start + 3] != TRIPLE:
        print("FATAL: TEMPLATE 不是 raw string 起始", file=sys.stderr)
        return 2
    start += 3
    end = src.find(TRIPLE, start)
    if end < 0:
        print("FATAL: raw string 没有配对的结尾三引号", file=sys.stderr)
        return 2
    raw = src[start:end]

    # ---- 插值审计：出现未被转义的 $ 就说明 JS 会被 Kotlin 当模板处理 ----
    bad = []
    for mm in re.finditer(r"\$\{", raw):
        frag = raw[mm.start():mm.start() + 12]
        if not frag.startswith(DOLLAR_ESC):
            bad.append(("${...}", frag))
    for mm in re.finditer(r"\$[A-Za-z_]", raw):
        bad.append(("$name", raw[mm.start():mm.start() + 12]))
    if bad:
        print("FATAL: raw string 里存在 Kotlin 插值（JS 会被改写）：%r" % bad[:5], file=sys.stderr)
        return 2

    js = raw.replace(DOLLAR_ESC, "$")
    n_ph = js.count(PLACEHOLDER)
    js = js.replace(PLACEHOLDER, bridge_name)

    residual = re.findall(r"\$\{[^}]{0,40}\}", js)
    if residual:
        print("FATAL: 提取后仍有插值残留 %r" % residual, file=sys.stderr)
        return 2

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(js, encoding="utf-8")

    print("source      : %s" % kt)
    print("raw chars   : %d" % len(raw))
    print("out chars   : %d" % len(js))
    print("out file    : %s" % out)
    print("bridge name : %s" % bridge_name)
    print("placeholder : %d 处已替换" % n_ph)
    print("lines       : %d" % (js.count("\n") + 1))
    if n_ph != 1:
        print("WARN: 占位符出现 %d 次（期望 1 次）" % n_ph, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
