#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ES 模块 A/B 对照：并排生成「9 个普通 script」与「单个 ES 模块」两份产物，用同一套断言量差异。

用法:
    python3 tools/module_pilot.py            # 生成到 /tmp/pz-classic 与 /tmp/pz-module
    python3 tools/module_pilot.py --run      # 生成后直接各跑一遍全量冒烟并打印结果

背景（2026-10-23 实测，Chrome 144 无头）:
    · 裸模块（不暴露 window）：801 / 605 —— 隐式全局在严格模式下直接报错、var 不挂 window、
      顶层 this 不再是 window。
    · 只做值拷贝的桥（window.x = x）：约 1730 —— let/var 拷贝的是值，模块内改了外面读到旧值。
    · 活绑定桥 + 桥放在模块最前面：**1808 / 0**，与普通 script 逐条一致。
      桥必须在前，因为 01eN 在加载期就 `window.renderForestPanel` 包装前一个模块，
      桥放末尾会读到 undefined，森林面板 27 条直接假红。
    · 代价：gz +24 KB（公开接口 1640 项）；file:// 打不开模块页（CORS），预览要走 http。

现在 `python3 tools/build.py` 默认就是模块模式，`--classic` 回退。这个工具只用于对照。
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLASSIC = "/tmp/pz-classic"
MODULE = "/tmp/pz-module"


def build(dest, classic=False):
    cmd = [sys.executable, os.path.join(ROOT, "tools", "build.py"), "--out", dest]
    if classic:
        cmd.append("--classic")
    r = subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True)
    ok = r.returncode == 0 and os.path.isdir(dest)
    print(("✓ " if ok else "✗ ") + os.path.basename(dest) + "：" +
          ((r.stdout.strip().splitlines() or [""])[0]))
    if not ok:
        print((r.stdout + r.stderr)[-800:])
    return ok


def main():
    if not build(CLASSIC, classic=True) or not build(MODULE):
        return 1
    print()
    if "--run" in sys.argv:
        for name, d, port in (("classic", CLASSIC, 8831), ("module", MODULE, 8832)):
            srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--directory", d],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "run_smoke.py"),
                                    "--html", "http://127.0.0.1:%d/index.html" % port],
                                   cwd=ROOT, text=True, capture_output=True)
                tail = [l for l in r.stdout.splitlines() if l.startswith("断言")]
                print("%-8s %s" % (name, tail[-1] if tail else "(无结果)"))
            finally:
                srv.terminate()
        return 0
    for name, d, port in (("classic", CLASSIC, 8831), ("module", MODULE, 8832)):
        print("%-8s python3 -m http.server %d --directory %s" % (name, port, d))
        print("         python3 tools/run_smoke.py --html http://127.0.0.1:%d/index.html" % port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
