#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合并产物语法体检：按 src/manifest.json 的槽位顺序把 JS 拼起来跑 node --check。

为什么需要它：build.py --check 只做"字节一致"，每个源文件单独 node --check 也都过，
**但拼进同一个 <script> 之后**仍可能整段崩 —— 2026-10-17 的真实事故：
新写的 logCalMonth() 与 01eD 里既有的同名函数撞车
（SyntaxError: Identifier 'logCalMonth' has already been declared），
整个槽位解析失败 → 全局 appData 未定义 → 所有用例一律"抛异常"，
而 build / id_audit / 弹窗检查全是绿的。

教训：**同名冲突只能在"合并后"才看得见**，所以检查也必须跑在合并后的形态上。

跑法: python3 tools/check_bundle_syntax.py            退出码 0 = 通过
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    # 缺 node 时不能伪装成"检查通过"，也不该报成 FAIL —— 按环境缺失败（exit 3），
    # verify 会记 SKIP 并在汇总里显形（P1-7）。
    import shutil
    if not shutil.which('node'):
        print('○ 未找到 node —— 合并产物语法检查没跑（exit 3，由 verify 记为 SKIP）')
        return 3
    mf = os.path.join(ROOT, 'src', 'manifest.json')
    man = json.load(open(mf, encoding='utf-8'))
    sdir = os.path.join(ROOT, 'src', man.get('script_dir', 'scripts'))
    bad = 0
    tmpdir = tempfile.mkdtemp(prefix='bsyn_')
    for slot in man.get('slots', []):
        parts = []
        for fn in slot.get('files', []):
            fp = os.path.join(sdir, fn)
            if not os.path.exists(fp):
                print('✗ 清单指向不存在的文件：%s' % fn)
                bad += 1
                continue
            parts.append('/* ==== %s ==== */\n' % fn + open(fp, encoding='utf-8').read())
        if not parts:
            continue
        out = os.path.join(tmpdir, 'slot%d.js' % slot.get('slot', 0))
        open(out, 'w', encoding='utf-8').write('\n;\n'.join(parts))
        r = subprocess.run(['node', '--check', out], capture_output=True, text=True)
        if r.returncode != 0:
            bad += 1
            head = [ln for ln in (r.stderr or '').strip().split('\n') if ln.strip()]
            print('✗ 槽位 %s 合并后语法失败：%s' % (slot.get('slot'), head[0] if head else '?'))
            for ln in head[1:4]:
                print('   ' + ln)
        else:
            print('✓ 槽位 %s 合并后 %d 个文件语法通过' % (slot.get('slot'), len(parts)))
    if bad:
        print('✗ 合并语法检查失败（%d 处）' % bad)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
