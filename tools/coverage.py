#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
· 单测覆盖率审计与门禁（纯函数层）
==================================================================
为什么存在：`tools/tests/unit_pure.js` 有 363 条断言，但**没人知道它守住了多少**
—— 报「363 通过」不等于「覆盖了大部分代码」。本工具用 Node 内置的 V8 覆盖率
（`NODE_V8_COVERAGE`）跑一遍单测，算出 `src/scripts/00_pure_core.js` 的
**函数覆盖率**，并列出「哪些函数从未被任何测试执行过」。

为什么用「函数覆盖率」而不是「行覆盖率」：本项目是单文件合并架构，行覆盖率会被
模块加载期执行到的顶层语句严重高估（模块一 require，顶层就全「覆盖」了）。
函数覆盖率无歧义、且能直接给出**可执行的补测清单**（未覆盖函数名单）。

棘轮式门禁：已覆盖函数数**不得低于** `tools/coverage_baseline.json` 的基线。
老债不阻塞、新债立拦（与 empty_catch_audit / data_ownership 同款做法）。

用法：
  python3 tools/coverage.py            审计 + 门禁（低于基线 FAIL）
  python3 tools/coverage.py --list     额外列出全部未覆盖函数（补测清单）
  python3 tools/coverage.py --write    把当前值写成新基线（补测后收窄）
  python3 tools/coverage.py --json     结构化输出（供 verify.py 消费）
==================================================================
"""

import bisect
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET_REL = 'src/scripts/00_pure_core.js'
BASELINE = os.path.join(ROOT, 'tools', 'coverage_baseline.json')
UNIT_REL = 'tools/tests/unit_pure.js'
GOAL_PCT = 90.0          # 企业级目标（显示差距用，不作硬门禁）


def collect():
    """跑单测并解析 V8 覆盖率，返回 (已覆盖数, 总数, 未覆盖[(名字,行号)], 未进入分支数)。"""
    cov_dir = tempfile.mkdtemp(prefix='v8cov_')
    try:
        env = dict(os.environ, NODE_V8_COVERAGE=cov_dir)
        r = subprocess.run(['node', UNIT_REL], cwd=ROOT, env=env,
                           capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            print((r.stdout or '') + (r.stderr or ''))
            raise SystemExit('单测未通过（退出码 %d），覆盖率无意义' % r.returncode)

        # 合并所有 coverage-*.json（Node 可能分片）
        entries, target = [], None
        for n in sorted(os.listdir(cov_dir)):
            if not n.endswith('.json'):
                continue
            data = json.load(io.open(os.path.join(cov_dir, n), encoding='utf-8'))
            for e in data.get('result', []):
                u = urllib.parse.unquote(e.get('url', ''))
                if u.endswith(TARGET_REL.replace('/', os.sep)) or u.endswith('/' + TARGET_REL):
                    target = e
        if target is None:
            raise SystemExit('覆盖率数据里找不到 %s' % TARGET_REL)

        src = io.open(os.path.join(ROOT, TARGET_REL), encoding='utf-8').read()
        line_starts = [0]
        for i, ch in enumerate(src):
            if ch == '\n':
                line_starts.append(i + 1)

        def ln_of(off):
            return bisect.bisect_right(line_starts, off)

        covered, uncovered, zero_branches = 0, [], 0
        for f in target.get('functions', []):
            name = f.get('functionName') or ''
            if not name or name.startswith('(module') or name in ('(anonymous)',):
                continue
            fns = f.get('ranges') or []
            if not fns:
                continue
            zero_branches += sum(1 for r in fns[1:] if r.get('count', 0) == 0)
            if fns[0].get('count', 0) == 0:
                uncovered.append((name, ln_of(fns[0]['startOffset'])))
            else:
                covered += 1
        uncovered.sort(key=lambda x: x[1])
        return covered, covered + len(uncovered), uncovered, zero_branches
    finally:
        shutil.rmtree(cov_dir, ignore_errors=True)


def main():
    as_json = '--json' in sys.argv
    write = '--write' in sys.argv
    show_list = '--list' in sys.argv or write

    covered, total, uncovered, zero_branches = collect()
    pct = 100.0 * covered / total if total else 0.0

    base = None
    if os.path.exists(BASELINE):
        base = json.load(io.open(BASELINE, encoding='utf-8'))
    base_covered = int(base.get('covered', 0)) if base else 0
    base_pct = float(base.get('pct', 0)) if base else 0.0
    base_zb = int(base.get('zero_branch_blocks', 0)) if base else 0

    if as_json:
        print(json.dumps({
            'covered': covered, 'total': total, 'pct': round(pct, 1),
            'baseline_covered': base_covered, 'goal_pct': GOAL_PCT,
            'uncovered': [n for n, _ in uncovered], 'zero_branch_blocks': zero_branches,
            'baseline_zero_branch_blocks': base_zb,
            'pass': covered >= base_covered and zero_branches <= base_zb,
        }, ensure_ascii=False))
        return 0 if (covered >= base_covered and zero_branches <= base_zb) else 1

    print('=== 单测覆盖率：%s ===' % TARGET_REL)
    print('  具名函数 %d 个，被单测执行过 %d 个 → **函数覆盖率 %.1f%%**'
          % (total, covered, pct))
    print('  从未执行: %d 个 · 未进入的分支块: %d 处' % (len(uncovered), zero_branches))
    print('  基线: 已覆盖函数 %d 个 (%.1f%%) · 未进入分支块 %d 处（两者都不得回退）'
          % (base_covered, base_pct, base_zb))

    if write:
        io.open(BASELINE, 'w', encoding='utf-8').write(json.dumps({
            'covered': covered, 'total': total, 'pct': round(pct, 1),
            'zero_branch_blocks': zero_branches,
            'uncovered': [n for n, _ in uncovered],
            'note': '棘轮基线：已覆盖函数数不得低于此值，未进入分支块数不得高于此值。补测后跑 --write 收窄。',
        }, ensure_ascii=False, indent=2) + '\n')
        print('  ✓ 已写入基线 %s' % os.path.relpath(BASELINE, ROOT))

    if show_list and uncovered:
        print()
        print('  未覆盖函数（补测清单，按行号）：')
        for n, l in uncovered:
            print('    L%-6d %s' % (l, n))

    if write:
        return 0          # 基线已按当前值校准，无须再判回退
    print()
    bad = []
    if covered < base_covered:
        bad.append('已覆盖函数 %d < 基线 %d（新增了未覆盖代码，或删了测试）' % (covered, base_covered))
    if zero_branches > base_zb:
        bad.append('未进入分支块 %d > 基线 %d（新增了没测到的分支）' % (zero_branches, base_zb))
    if bad:
        for x in bad:
            print('✗ ' + x)
        return 1
    print('✓ 覆盖率双维度未回退（函数 %d ≥ %d · 未进入分支 %d ≤ %d）'
          % (covered, base_covered, zero_branches, base_zb))
    return 0


if __name__ == '__main__':
    sys.exit(main())
