#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""空 catch 治理棘轮：
项目存量空 catch（catch (e) {}）460 处——多为清理保护/软依赖探测/toast 保护等
防御性写法，一次性大改风险大于收益。治理方式改为「棘轮」：
  · 基线 src/empty_catch_baseline.json 记录每文件存量计数
  · 任何文件计数 > 基线 → FAIL（新增空 catch 必须显式登记，不许悄悄增加）
  · 计数下降 → 提示 --write 收紧基线（只能向下棘轮）
  · --report 输出启发式分类（清理/提示保护/软依赖/存储/DOM 探针/计时/其他）
用法:
  python3 tools/empty_catch_audit.py          # 校验（棘轮，挂 verify 链门禁）
  python3 tools/empty_catch_audit.py --write  # 刷新基线（治理收敛后收紧）
  python3 tools/empty_catch_audit.py --report # 分类明细（人读）
退出码：0 通过 / 1 棘轮被突破。"""
import re, os, sys, json, glob, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASELINE = os.path.join(ROOT, 'src', 'empty_catch_baseline.json')

# 空 catch：体为空或只有注释（只有注释同样静默，一并计数）
# 注：块注释必须写成"不含 */ 的字符序列"（(?:[^*]|\*(?!/))*），
# 禁止 [\s\S]*? 非贪婪——它会在匹配失败时回溯膨胀，把两条注释之间的真实代码吞成"注释内容"（曾致误判）
_BLOCK = r'/\*(?:[^*]|\*(?!/))*\*/'
EMPTY_RE = re.compile(r'catch\s*\([^)]*\)\s*\{(?:\s|' + _BLOCK + r'|//[^\n]*)*\}')

RULES = [
    ('清理保护', re.compile(r'revokeObjectURL|\.remove\(\)|clearTimeout|clearInterval|\.stop\(|disconnect|unobserve|removeEventListener|abort\(')),
    ('提示保护', re.compile(r'showToast|announce|toast', re.I)),
    ('软依赖探测', re.compile(r'typeof\s|\?\.')),
    ('存储读写', re.compile(r'localStorage|JSON\.(parse|stringify)|indexedDB|idb')),
    ('DOM 探针', re.compile(r'querySelector|getElementById|getBoundingClientRect')),
    ('计时/日期', re.compile(r'setTimeout|setInterval|new Date|Date\.now')),
]
TRY_RE = re.compile(r'try\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*catch\s*\([^)]*\)\s*\{(?:\s|' + _BLOCK + r'|//[^\n]*)*\}')


def scan():
    """返回 {文件名: 空 catch 计数}"""
    counts = {}
    for fp in sorted(glob.glob(os.path.join(ROOT, 'src', 'scripts', '*.js'))):
        src = open(fp, encoding='utf-8').read()
        counts[os.path.basename(fp)] = len(EMPTY_RE.findall(src))
    return counts


def classify():
    cats = collections.Counter()
    for fp in sorted(glob.glob(os.path.join(ROOT, 'src', 'scripts', '*.js'))):
        src = open(fp, encoding='utf-8').read()
        for m in TRY_RE.finditer(src):
            body = m.group(1)
            label = '其他（多为回调/刷新类防御）'
            for name, rx in RULES:
                if rx.search(body):
                    label = name
                    break
            cats[label] += 1
    return cats


def main():
    write = '--write' in sys.argv
    report = '--report' in sys.argv
    cur = scan()

    if write:
        json.dump({'version': 1, 'files': cur}, open(BASELINE, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2, sort_keys=True)
        total = sum(cur.values())
        print(f'【已写入】空 catch 基线：{len(cur)} 个文件共 {total} 处')
        return 0

    if not os.path.exists(BASELINE):
        print('✗ 基线不存在：先跑 python3 tools/empty_catch_audit.py --write')
        return 1
    base = json.load(open(BASELINE, encoding='utf-8'))['files']

    rises, drops = [], []
    for f, c in sorted(cur.items()):
        b = base.get(f)
        if b is None:
            if c > 0:
                rises.append(f'{f}: 新文件含 {c} 处空 catch（需登记）')
        elif c > b:
            rises.append(f'{f}: {b} → {c}（+{c - b}）')
        elif c < b:
            drops.append(f'{f}: {b} → {c}（-{b - c}）')
    for f in base:
        if f not in cur and base[f] > 0:
            drops.append(f'{f}: {base[f]} → 0（文件已删）')

    if report:
        print('===== 空 catch 启发式分类 =====')
        for name, c in classify().most_common():
            print(f'  {c:4d}  {name}')
        print()

    total = sum(cur.values())
    if rises:
        print('✗ 空 catch 棘轮被突破（只许减少，新增必须登记基线）:')
        for r in rises:
            print(f'    {r}')
        print('  若确认新增为防御性必要写法：python3 tools/empty_catch_audit.py --write 登记')
        return 1
    print(f'✓ 空 catch 棘轮：{total} 处 ≤ 基线 {sum(base.values())} 处')
    if drops:
        print('  以下文件计数下降，可跑 --write 收紧基线:')
        for d in drops:
            print(f'    {d}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
