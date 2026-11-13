#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把项目打包成「交给外部 AI 升级」的 ZIP（剔除 .git / 旧包 / 归档素材）。

用法:
    python3 tools/pack_for_external.py            # 快档：直接出包（默认，约 2 秒）
    python3 tools/pack_for_external.py --verify   # 慢档：出包后解压到临时目录，重建 + 单测，确认可用

输出: 项目同级目录 瓶子专注_给外部AI_YYYY-MM-DD.zip
说明: 收录范围见 INCLUDE；新增顶层文档想进包，改 INCLUDE 即可。
"""
import os, sys, zipfile, datetime, subprocess, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = os.path.basename(ROOT) or '瓶子专注'
DATE = datetime.date.today().strftime('%Y-%m-%d')
OUT = os.path.join(os.path.dirname(ROOT), f'{NAME}_给外部AI_{DATE}.zip')

# 收录的顶层条目（目录整目录收，再由 EXCLUDE 剪枝）
INCLUDE = [
    # ★ 单一入口：外部 AI 只读这一份就够起步，其余按它指引按需查阅
    '00_给外部AI的开工须知.md',
    '00_项目文件导航.md',
    'AGENTS.md', 'DESIGN.md', 'ARCHITECTURE-DECISIONS.md', 'README.md',
    'release.sh',
    'src', 'tools', 'web',                  # 不给 public/：必须先自己 build，顺带证明包是自洽的
    'docs/README.md', 'docs/项目现状交底.md', 'docs/references',
    'docs/current/AI_SCAFFOLD.md',
    'docs/current/数据领域地图与扩展指南-20261014.md',
    'docs/current/企业级架构对标-20261014.md',
    'docs/current/01d拆分方案.md', 'docs/current/01d第三批拆分方案.md',
    # 本次任务是视觉升级，当前外观的截图对判断"改成什么样"有用，值得带上这 1.5MB
    'docs/current/主题预览',
]
EXCLUDE = ['.git/', '__pycache__', '.pyc', '.DS_Store', '.zip',
           'docs/archive', '来源材料',
           'tools/_archive', 'src/scripts/_archive', 'node_modules',
           # 派生快照：可用 `node tools/callgraph_ast.js` 重建，不必带着走
           'tools/callgraph.json', 'tools/callgraph.selfcheck.json',
           # 本机凭据，任何情况下都不进包
           '.publish-token', '.ghtok']


def excluded(rel):
    return any(p in rel for p in EXCLUDE)


def walk(item):
    full = os.path.join(ROOT, item)
    if os.path.isfile(full):
        yield item
        return
    for dirpath, dirnames, filenames in os.walk(full):
        dirnames[:] = [d for d in sorted(dirnames) if not excluded(os.path.join(dirpath, d) + '/')]
        for fn in sorted(filenames):
            rel = os.path.relpath(os.path.join(dirpath, fn), ROOT).replace(os.sep, '/')
            if not excluded(rel):
                yield rel


def main():
    files, seen = [], set()
    for it in INCLUDE:
        if not os.path.exists(os.path.join(ROOT, it)):
            print('!! 缺项跳过:', it)
            continue
        for f in walk(it):
            if f not in seen:
                seen.add(f)
                files.append(f)

    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            z.write(os.path.join(ROOT, f), NAME + '/' + f)

    print(f'✅ {os.path.getsize(OUT)/1048576:.2f} MB · {len(files)} 文件')
    print('   ', OUT)

    if '--verify' in sys.argv:
        tmp = tempfile.mkdtemp()
        try:
            with zipfile.ZipFile(OUT) as z:
                z.extractall(tmp)
            d = os.path.join(tmp, NAME)
            # 包里不给 public/  →  不能跑 build.py --check（无产物可比），
            # 必须真构建一次再跑门禁。这同时证明「包内 src 自洽、能独立出包」。
            for args in (['build.py'], ['verify.py', '--fast']):
                p = subprocess.run(['python3', os.path.join(d, 'tools', args[0])] + args[1:],
                                   capture_output=True, text=True, cwd=d)
                tail = (p.stdout or p.stderr).strip().splitlines()
                print(('  ✓ ' if p.returncode == 0 else '  ✗ ') + args[0],
                      tail[-1] if tail else '')
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
