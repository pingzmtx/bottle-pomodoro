#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""改动影响面查询：动一个共享符号之前，先看清它会牵到多少地方

为什么要有它：
  「改一处坏三处」的成因**不是代码丑**，而是**共享数据被到处直接读写**。
  实测本项目的枢纽（AST 调用图统计）：
    appData.tree      11 个文件 / 402 处
    appData.settings  19 个文件 / 169 处
    appData.records   22 个文件 /  91 处
  改这些字段的**语义**时，要在几十上百处里分清「哪些是读、哪些是写、
  哪些的读法依赖旧语义」—— 这才是事故的真正来源。
  动之前跑一下这个，把「这次要碰多少地方」先量化出来，再决定值不值得动、
  以及要不要顺手把写入口收敛掉（唯一入口 + 门禁，见 ADR #5 金币那套做法）。

用法:
  python3 tools/impact.py coins              # 所有含 coins 的行（读+写）
  python3 tools/impact.py appData.tree       # 树对象的所有访问点
  python3 tools/impact.py --write coins      # 只看「写入候选」（赋值/自增自减）
  python3 tools/impact.py --files coins      # 只看涉及哪些文件、各多少处
  python3 tools/impact.py --top              # 不传 pattern：列出最该小心的高扇入符号 Top20

退出码：0 恒（这是查询工具，不是门禁）。
"""
import collections
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'scripts')

# 高扇入符号（来自 tools/callgraph.json 的跨文件引用统计）—— 改它们最危险
HUB_SYMBOLS = [
    'window.__silent', 'appData.records', 'appData.settings', 'appData.rankSystem',
    'appData.tree', 'appData.todos', 'appData.uiPrefs', 'appData.immersiveFocus',
    'appData.habits', 'appData.teamSystem', 'appData.mustDos', 'appData.selfRewards',
    'appData.freeFocus', 'appData.rankSystem.stars', 'escapeHtml', 'getTodayStr',
    'saveData', 'showToast', 'renderTodos', 'renderStats', 'switchView',
]


def write_pattern(sym):
    """写入候选：`sym =` / `sym +=` / `sym -=` / `sym++` / `sym--`（排除 == === != <= >=）"""
    esc = re.escape(sym)
    return re.compile(r'%s\s*(?:[-+*/]?=(?!=)|[-+]{2})' % esc)


def scan(pattern, only_write=False):
    rx = re.compile(re.escape(pattern))
    wrx = write_pattern(pattern) if only_write else None
    hits = []            # (file, lineno, text, is_write)
    files = collections.Counter()
    for name in sorted(os.listdir(SRC)):
        if not name.endswith('.js'):
            continue
        path = os.path.join(SRC, name)
        for i, line in enumerate(io.open(path, encoding='utf-8').read().split('\n'), 1):
            if pattern not in line:
                continue
            # 「写」判定：排除 const/let/var 声明（那是**声明**不是对它的赋值，
            # 否则每处 `const coins = …` 都会被算成写，信噪比崩掉）
            is_w = bool(write_pattern(pattern).search(line))
            if re.match(r'^\s*(?:const|let|var)\s', line):
                is_w = False
            if only_write and not is_w:
                continue
            hits.append((name, i, line.strip(), is_w))
            files[name] += 1
    return hits, files


def main():
    args = sys.argv[1:]
    if '--top' in args or not args:
        print('=== 最该小心的共享符号（跨文件引用次数，来自 AST 调用图）===')
        print('    改动这些之前，先用  python3 tools/impact.py <符号>  看影响面\n')
        for s in HUB_SYMBOLS:
            _, f = scan(s)
            total = sum(f.values())
            if total:
                print('  %-28s %2d 个文件 / %3d 处' % (s, len(f), total))
        return 0

    only_write = '--write' in args
    only_files = '--files' in args
    pats = [a for a in args if not a.startswith('--')]
    if not pats:
        print('用法: python3 tools/impact.py <符号> [--write] [--files]')
        return 1

    for p in pats:
        hits, files = scan(p, only_write)
        print('=== 影响面：%s%s ===' % (p, '（只看写入候选）' if only_write else ''))
        print('    命中 %d 处 · 涉及 %d 个文件' % (len(hits), len(files)))
        if not hits:
            print('    （无命中：它可能不叫这个名字，或已被收编/改名）')
            continue
        # 静态分析的盲区：项目里大量用局部别名（const tr = appData.tree 之后写 tr.coins），
        # 只搜全名会**大幅低估**影响面。命中偏少时主动提示试别名。
        if len(hits) <= 3 and '.' in p:
            short = p.split('.')[-1]
            print('    ⚠️ 命中偏少 —— 本项目常用局部别名（tr / t / st / m），')
            print('       建议同时查:   python3 tools/impact.py "%s" --write' % short)
        if only_files:
            for name, n in files.most_common():
                print('    %-40s %d 处' % (name, n))
        else:
            cur = None
            for name, lineno, text, is_w in hits:
                if name != cur:
                    cur = name
                    print('  --- %s' % name)
                print('    %-6d %s%s' % (lineno, '[写] ' if is_w else '     ', text[:110]))
        print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
