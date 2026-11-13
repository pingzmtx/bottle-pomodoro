#!/usr/bin/env python3
"""热点定位：用 git 历史找「该重构哪一块」，而不是靠感觉或全库扫描。

原理
----
重构价值 ≈ 改动频率 × 文件体积。改得越勤、越大的文件，每次进去都要重新理解
一遍，是「每次都要花的钱」；一年没动过的大文件只是「一次性成本」，优先级低。

这样就把「定期全量审」换成了「按数据排队的定点手术」：每轮只动前 1~2 个。

用法
----
  python3 tools/hotspots.py                # 全部历史
  python3 tools/hotspots.py --days 30      # 只看最近 30 天
  python3 tools/hotspots.py --top 10
"""
import argparse
import os
import subprocess
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_REL = 'src/scripts'


def git(*args):
    r = subprocess.run(['git'] + list(args), cwd=ROOT, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=0)
    ap.add_argument('--top', type=int, default=12)
    a = ap.parse_args()

    args = ['log', '--name-only', '--pretty=format:']
    if a.days:
        args.append(f'--since={a.days} days ago')
    raw = git(*args)
    if not raw.strip():
        print('没有提交历史', file=sys.stderr)
        return 1

    churn = Counter()
    for line in raw.split('\n'):
        line = line.strip()
        if line.startswith(SRC_REL + '/') and line.endswith('.js'):
            churn[line] += 1

    rows = []
    for path, n in churn.items():
        full = os.path.join(ROOT, path)
        if not os.path.exists(full):
            continue
        with open(full, encoding='utf-8', errors='replace') as f:
            lines = sum(1 for _ in f)
        # 风险分：改动次数 × 体积（千行为单位），避免大文件单纯压过热文件
        score = n * (lines / 1000.0)
        rows.append((score, n, lines, os.path.basename(path)))

    rows.sort(reverse=True)
    scope = f'最近 {a.days} 天' if a.days else '全部历史'
    print(f'重构热点 · {scope} · 共 {len(rows)} 个源文件')
    print()
    print(f'{"文件":34s} {"改动":>5s} {"行数":>6s} {"风险分":>7s}')
    print('-' * 58)
    for score, n, lines, name in rows[:a.top]:
        print(f'{name:34s} {n:5d} {lines:6d} {score:7.1f}')
    print()

    # 冷文件：行数大但几乎不动 —— 不是重构优先级，别再纠结
    cold = [(ln, nm) for _s, _n, ln, nm in rows if ln >= 1500 and _n <= 3]
    if cold:
        print('体量大但很少动（不用急，别把时间花在这）：')
        for ln, nm in sorted(cold, reverse=True)[:5]:
            print(f'  {nm}  {ln} 行')

    print()
    print('建议：本轮只处理风险分最高的 1 个文件；拆完重跑本命令看排名是否变化。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
