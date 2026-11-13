#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""金币「单一入口」门禁

背景（2026-10-14 · 架构升级）：金币此前**只存余额**，约 21 处直接 `tr.coins ±= n`。
一旦账目对不上，没有任何线索能回答「这金币哪来的、被谁扣的」，误发也退不回。
现改为「余额 + 流水」账本（设计出处：HabitTrove 的 { balance, transactions[] }）：
余额仍是唯一真相，但**所有变动必须走 coinEarn / coinSpend**，流水旁路记账，
可审计、可撤销、可对账。

本门禁把这条路堵死 —— 与 Super Productivity 用 ESLint 强制「core/ui/util 不许
反向 import features」同一种思路：**凡是靠记性维持的约定，一定会腐化**。
规则放进构建链，违反即让全绿链变红：

  R1 直接写余额：`X.coins ±= n`（含 `X.coins = ...`）一律 FAIL，
     除非该行带 `coin-write-allow` 豁免标记（标记后必须写理由）。
     合法例外只有三类：迁移初始化（01b）、账本内部入账/出账/撤销（01d3）、
     未解锁门禁回滚（05，且必须配反向流水）。
  R2 流水类型必须登记：coinEarn/coinSpend 的 type 字面量必须在 00_pure_core 的
     COIN_TX_TYPES 里 —— 拼错的 type 静态看不出来，只会在用户点开明细面板时
     显示成英文键名。
  R3 不许绕过入口写账本：`coinLog.push(` 直接出现即 FAIL（只能走 coinLedgerPush）。
  R4 账本入口必须存在：coinEarn / coinSpend / coinUndo / coinLedgerCheck
     四个函数缺一个就 FAIL（防止有人「顺手删掉」其中一个）。

跑法: python3 tools/check_coin_single_source.py
退出码 0 = 通过 / 1 = 有问题
"""
import re
import sys

sys.dont_write_bytecode = True
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src' / 'scripts'
PURE = SRC / '00_pure_core.js'

# R1：直接写余额（`.coins` 后跟可选 +/- 再跟 =）
WRITE_RE = re.compile(r'\.coins\s*[-+]?=')
ALLOW_TAG = 'coin-write-allow'

# R2：coinEarn/coinSpend 的第二参数（type）字面量
TYPE_RE = re.compile(r"coin(?:Earn|Spend)\(\s*[^,()]+,\s*'([^']+)'")

# R3：绕过入口
BYPASS_RE = re.compile(r'\bcoinLog\.push\s*\(')

# R4：必须存在的入口
ENTRIES = ['coinEarn', 'coinSpend', 'coinUndo', 'coinLedgerCheck']


def coin_types():
    """从 00_pure_core.js 抓 COIN_TX_TYPES 的键集合"""
    if not PURE.exists():
        return set()
    src = PURE.read_text(encoding='utf-8')
    m = re.search(r'const COIN_TX_TYPES\s*=\s*\{(.*?)\n\};', src, re.S)
    if not m:
        return set()
    return set(re.findall(r'^\s*([a-z][a-z0-9]*)\s*:', m.group(1), re.M))


def main():
    problems = []
    files = sorted(SRC.glob('*.js'))

    # ---------- R1 直接写余额 ----------
    allow_hits = []
    for f in files:
        for i, line in enumerate(f.read_text(encoding='utf-8').split('\n'), 1):
            if not WRITE_RE.search(line):
                continue
            if ALLOW_TAG in line:
                allow_hits.append((f.name, i))
                continue
            # 注释行不算（有人在注释里写示例）
            if re.match(r'^\s*(?:\*|//|/\*)', line):
                continue
            problems.append(
                'R1 %s:%d 直接写余额，必须走 coinEarn/coinSpend：%s' % (f.name, i, line.strip()))

    # ---------- R2 type 登记 ----------
    known = coin_types()
    if not known:
        problems.append('R2 抓不到 COIN_TX_TYPES（00_pure_core.js 结构变了？）')
    for f in files:
        for i, line in enumerate(f.read_text(encoding='utf-8').split('\n'), 1):
            for t in TYPE_RE.findall(line):
                if t not in known:
                    problems.append(
                        'R2 %s:%d 流水类型 %r 未登记在 COIN_TX_TYPES' % (f.name, i, t))

    # ---------- R3 绕过入口 ----------
    for f in files:
        for i, line in enumerate(f.read_text(encoding='utf-8').split('\n'), 1):
            if BYPASS_RE.search(line) and not re.match(r'^\s*(?:\*|//|/\*)', line):
                if ALLOW_TAG in line:      # 有意为之（如期初结转不能走 push：会递归）
                    continue
                problems.append(
                    'R3 %s:%d 绕过记账入口直接 push 账本：%s' % (f.name, i, line.strip()))

    # ---------- R4 入口存在 ----------
    joined = '\n'.join(f.read_text(encoding='utf-8') for f in files)
    for name in ENTRIES:
        if not re.search(r'^function %s\s*\(' % re.escape(name), joined, re.M):
            problems.append('R4 记账入口函数 %s 不见了（应有定义）' % name)

    print('金币单一入口门禁')
    print('  扫描 %d 个脚本 · 类型表 %d 项 · 豁免标记 %d 处'
          % (len(files), len(known), len(allow_hits)))
    for fn, ln in allow_hits:
        print('    · 豁免 %s:%d' % (fn, ln))
    if problems:
        print('\n✗ 发现 %d 个问题：' % len(problems))
        for p in problems:
            print('  ' + p)
        return 1
    print('✓ 通过：余额只经 coinEarn/coinSpend 变动，流水类型全部登记')
    return 0


if __name__ == '__main__':
    sys.exit(main())
