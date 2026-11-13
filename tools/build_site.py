#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""组装可上传的静态站目录 dist/。

产物结构（全部相对路径，放在任何静态托管的根目录都能跑）：
    dist/index.html             ← build.py 的产物，原样复制
    dist/manifest.webmanifest   ← web/manifest.webmanifest
    dist/sw.js                  ← web/sw.js（__BUILD_ID__ 换成 index.html 的 sha256 前 12 位）
    dist/icons/*.png

用法：
    python3 tools/build_site.py            # 先跑 build.py 再组装
    python3 tools/build_site.py --no-build # 直接用现有 index.html 组装

为什么要单独一个 dist/：源仓库里有 src/、tools/、docs/、.git，
整个仓库传上去等于把源码和工具都公开，且体积大几十倍。
"""
import hashlib
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(ROOT, "index.html")
WEB = os.path.join(ROOT, "web")
DIST = os.path.join(ROOT, "dist")


def main():
    print("○ build_site.py 已停用（2026-10-22）：public/ 本身就是发布物，GitHub Pages 直发，")
    print("  不再需要 dist/ 这一层中间产物。需要单文件成品：python3 tools/build.py --single")
    return 1

    if "--no-build" not in sys.argv:
        r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "build.py")],
                           cwd=ROOT, capture_output=True, text=True)
        print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "")
        if r.returncode != 0:
            print("✗ build.py 失败：\n" + r.stdout + r.stderr)
            return 1

    if not os.path.exists(INDEX):
        print("✗ 找不到 index.html")
        return 1

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    shutil.copy2(INDEX, os.path.join(DIST, "index.html"))
    build_id = hashlib.sha256(open(INDEX, "rb").read()).hexdigest()[:12]
    # ★ 与 build.py 的 _site_build_id 同口径：assets/ 也要进哈希，否则只改 JS 的发版
    #   版本号不动，Service Worker 不换代，装了 PWA 的用户永远停在旧脚本（2026-11-05）。
    _a = os.path.join(ROOT, "public", "assets")
    if os.path.isdir(_a):
        _h = hashlib.sha256(open(INDEX, "rb").read())
        for _r, _d, _fs in os.walk(_a):
            for _f in sorted(_fs):
                _p = os.path.join(_r, _f)
                _h.update(os.path.relpath(_p, _a).replace(os.sep, "/").encode("utf-8"))
                _h.update(open(_p, "rb").read())
        build_id = _h.hexdigest()[:12]

    for name in ("manifest.webmanifest", "sw.js"):
        src = os.path.join(WEB, name)
        dst = os.path.join(DIST, name)
        data = open(src, encoding="utf-8").read()
        if name == "sw.js":
            data = data.replace("__BUILD_ID__", build_id)
        open(dst, "w", encoding="utf-8").write(data)

    icons_src = os.path.join(WEB, "icons")
    icons_dst = os.path.join(DIST, "icons")
    if os.path.isdir(icons_src):
        shutil.copytree(icons_src, icons_dst)

    total = 0
    print("✓ dist/ 组装完成（build %s）：" % build_id)
    for dirpath, _dirnames, filenames in sorted(os.walk(DIST)):
        for fn in sorted(filenames):
            p = os.path.join(dirpath, fn)
            sz = os.path.getsize(p)
            total += sz
            rel = os.path.relpath(p, DIST)
            print("    %-34s %9s B" % (rel, sz))
    print("    合计 %.2f MB" % (total / 1048576.0))
    print("\n下一步：把 dist/ 里的全部文件传到静态托管的根目录。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
