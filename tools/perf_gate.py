#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
· 性能回归门禁
==================================================================
为什么存在：`tools/bench.py` 能测冷启动 / 视图切换 / 统计页渲染，但它的产物是
**一次性数据** —— 没有人对比、没有东西守着，改了什么让性能退化了也没人知道
（历史数据「冷启动 201ms」是一条只存在于文档里的数字）。本工具把 bench 的指标
**基线化**，超阈值即 FAIL。

阈值口径：`允许上限 = max(基线 × FACTOR, 基线 + ABS_MIN)`
  —— 小数值（视图切换 3~30ms）用**绝对下限**兜底：3ms→8ms 是 +167%，但绝对值
  微不足道，不该报警；大数值（冷启动/统计页）才用倍率。

抗抖动：无头 Chromium + CPU 降速本身有波动，所以阈值给得宽（默认 ×1.5）。
本门禁的定位是「抓趋势性退化」（比如某次改动让统计页从 500ms 变 1500ms），
不是「抓 10% 的波动」。

用法：
  python3 tools/perf_gate.py           对比基线（超阈值 FAIL）
  python3 tools/perf_gate.py --write   重新校准基线
  python3 tools/perf_gate.py --json    结构化输出
依赖：chromium（/usr/bin/chromium）+ python websocket-client。同 bench.py。
==================================================================
"""

import io
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCH = os.path.join(ROOT, 'tools', 'bench.py')
BASELINE = os.path.join(ROOT, 'tools', 'perf_baseline.json')

FACTOR = 1.5        # 倍率容差
ABS_COLD = 150      # 冷启动绝对容差 ms
ABS_STATS = 300     # 统计页绝对容差 ms
ABS_SWITCH = 40     # 视图切换绝对容差 ms（小数值靠它兜底）


def _limit(base, abs_min):
    return max(base * FACTOR, base + abs_min)


def run_bench():
    out_dir = tempfile.mkdtemp(prefix='perf_')
    out = os.path.join(out_dir, 'bench.json')
    try:
        r = subprocess.run([sys.executable, BENCH, '--out', out], cwd=ROOT,
                           capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return None, 'bench 超时（300s）'
    if not os.path.exists(out):
        return None, ((r.stderr or r.stdout or 'bench 未产出结果')[-400:])
    try:
        return json.load(io.open(out, encoding='utf-8')), None
    except Exception as e:
        return None, 'bench 输出解析失败：%s' % e


def flatten(cur):
    """指标展平成 {key: ms}，key 形如 cold_ms / switch.plan / stats8000_ms。"""
    d = {'cold_ms': cur.get('cold_ms'), 'stats8000_ms': cur.get('stats8000_ms')}
    for v, ms in (cur.get('switch_ms') or {}).items():
        d['switch.' + v] = ms
    return d


def main():
    write = '--write' in sys.argv
    as_json = '--json' in sys.argv

    cur, err = run_bench()
    if cur is None:
        msg = '性能基准测量失败：%s' % err
        if as_json:
            print(json.dumps({'pass': False, 'error': msg}, ensure_ascii=False))
        else:
            print('✗ ' + msg)
            print('  （需要 chromium 与 websocket-client；跑不了时请在有 Chrome 的机器上跑）')
        return 1

    flat = flatten(cur)

    if write:
        d = {'_note': '性能基线。阈值 = max(基线 × %.1f, 基线 + 绝对下限)。--write 校准。' % FACTOR,
             'throttle': cur.get('throttle')}
        d.update(flat)
        io.open(BASELINE, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
        if as_json:
            print(json.dumps({'pass': True, 'written': True, 'baseline': flat}, ensure_ascii=False))
        else:
            print('✓ 已写入性能基线 %s' % os.path.relpath(BASELINE, ROOT))
            for k, v in flat.items():
                print('    %-18s %s ms' % (k, v))
        return 0

    base = None
    if os.path.exists(BASELINE):
        base = json.load(io.open(BASELINE, encoding='utf-8'))
    if base is None:
        print('⚠️ 无性能基线（%s 不存在）—— 请先跑 `python3 tools/perf_gate.py --write` 校准' %
              os.path.relpath(BASELINE, ROOT))
        return 1

    label_abs = {'cold_ms': ABS_COLD, 'stats8000_ms': ABS_STATS}
    bad = []
    if not as_json:
        print('=== 性能回归门禁（CPU 降速 %s×）===' % cur.get('throttle'))
    for key in sorted(flat):
        val = flat[key]
        b = base.get(key)
        abs_min = ABS_SWITCH if key.startswith('switch.') else label_abs.get(key, ABS_COLD)
        if b is None:
            if not as_json:
                print('  –  %-18s 基线无此项（新指标），跳过' % key)
            continue
        if val is None or (isinstance(val, int) and val < 0):
            bad.append('%s 测量失败（%s）' % (key, val))
            if not as_json:
                print('  ✗  %-18s 测量失败（%s）' % (key, val))
            continue
        lim = _limit(b, abs_min)
        over = val > lim
        if over:
            bad.append('%s %d > 阈值 %.0f（基线 %d）' % (key, val, lim, b))
        if not as_json:
            print('  %s  %-18s 实测 %5d ms · 基线 %5d · 阈值 %6.0f' % ('✗' if over else '✓', key, val, b, lim))

    if as_json:
        print(json.dumps({'pass': not bad, 'measured': flat, 'baseline': base,
                          'violations': bad}, ensure_ascii=False))
        return 1 if bad else 0

    print()
    if bad:
        print('✗ 性能退化 %d 项：' % len(bad))
        for x in bad:
            print('    ' + x)
        print('  （若是环境抖动导致，复跑一次确认；确认是趋势性退化再查最近的改动）')
        return 1
    print('✓ 性能未超阈值（各项均在 max(基线×%.1f, 基线+下限) 之内）' % FACTOR)
    return 0


if __name__ == '__main__':
    sys.exit(main())
