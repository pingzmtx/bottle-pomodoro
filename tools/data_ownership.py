#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据领域边界门禁（棘轮式：冻结现状，只拦新增越界写入）

为什么要有它：
  实测本项目 `appData` 有 51 个一级字段、其中 **22/24 个域是多文件共写**的
  （settings 11 个文件、uiPrefs 10 个、tree 6 个…）。
  「改一处坏三处」的确切形态就是它：改一个域的字段语义，
  要在十几个文件的几百处里分清「谁写的、谁依赖旧语义」。

  但**不能要求立刻全部收敛**（400+ 处写点，一次改完风险大于收益）。
  所以采用与 `empty_catch_audit.py` 同款的**棘轮**：
    · 现状写点全部登记为基线 → **不阻塞**；
    · 之后**新增**一个未登记的越界写入 → 直接 FAIL。
  这样老债冻结、新债立刻拦 —— 未来加「人生管理」的新域时，
  边界会被自动强制，不会再长成第二个 51 字段大杂烩。

用法:
  python3 tools/data_ownership.py            # 检查（违反基线 → 退出码 1）
  python3 tools/data_ownership.py --report   # 打印域地图（谁拥有、谁在写）
  python3 tools/data_ownership.py --baseline # 重新生成基线（改完域归属后手动跑）
  python3 tools/data_ownership.py --why tree # 某个域当前为什么是这些写者

登记文件: src/data_ownership.json
  每个域三个键：owner（主写文件，改这个域的语义先看它）/
  writers（允许写的文件清单 = 冻结的现状）/ note（这个域是什么）
  新增写者必须在 writers 里登记并写理由 —— 这就是「显式声明边界」。
"""
import collections
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'scripts')
REG = os.path.join(ROOT, 'src', 'data_ownership.json')

DECL = re.compile(r'^\s*(?:const|let|var)\s')
WRITE = r'\s*(?:[-+*/]?=(?!=)|[-+]{2})'

# 数据层：负责建字段 / 迁移 / 默认值，对**所有**域都有写权（写的是"初始化"，不是业务逻辑）
DATA_LAYER = '01b_engine_data.js'


def read_files():
    out = {}
    for n in sorted(os.listdir(SRC)):
        if n.endswith('.js'):
            out[n] = io.open(os.path.join(SRC, n), encoding='utf-8').read()
    return out


def domains_of(files):
    """扫出所有 appData 一级字段"""
    c = collections.Counter()
    for s in files.values():
        for m in re.finditer(r'appData\.([A-Za-z_][A-Za-z0-9_]*)', s):
            c[m.group(1)] += 1
    return set(c)


def writers_of(field, files):
    """谁在写这个域（含局部别名，如 const tr = appData.tree 之后写 tr.coins）"""
    res = collections.Counter()
    direct = re.compile(r'appData\.%s(?:\.\w+)?%s' % (re.escape(field), WRITE))
    for n, s in files.items():
        lines = s.split('\n')
        aliases = set()
        for ln in lines:
            for m in re.finditer(r'\b([A-Za-z_$][\w$]*)\s*=\s*appData\.%s\b' % re.escape(field), ln):
                aliases.add(m.group(1))
        aliases.discard(field)
        alias_res = [re.compile(r'\b%s(?:\.\w+)?%s' % (re.escape(a), WRITE)) for a in aliases]
        for i, ln in enumerate(lines, 1):
            if DECL.match(ln):
                continue
            if direct.search(ln) or any(r.search(ln) for r in alias_res):
                res[n] += 1
    return res


def load_reg():
    if os.path.exists(REG):
        return json.load(io.open(REG, encoding='utf-8'))
    return {'_doc': '见 tools/data_ownership.py 顶部说明', 'domains': {}}


def main():
    files = read_files()
    reg = load_reg()
    doms = reg.get('domains', {})
    live = {}
    for f in sorted(domains_of(files)):
        w = writers_of(f, files)
        if w:
            live[f] = w

    if '--baseline' in sys.argv or '--report' in sys.argv or '--why' in sys.argv:
        if '--why' in sys.argv:
            f = sys.argv[sys.argv.index('--why') + 1]
            w = live.get(f)
            if not w:
                print('域 %s：没有扫描到写入' % f)
                return 0
            print('=== 域 %s 的写者（%d 个文件）===' % (f, len(w)))
            for n, c in w.most_common():
                print('  %-40s %d 处' % (n, c))
            return 0

    if '--report' in sys.argv:
        multi = sum(1 for f, w in live.items() if len(w) > 1)
        print('=== appData 域地图（%d 个域，其中 %d 个是多文件共写）===' % (len(live), multi))
        print('  %-18s %-34s %s' % ('域', 'owner（改语义先看它）', '写者'))
        for f, w in sorted(live.items(), key=lambda kv: -len(kv[1])):
            own = w.most_common(1)[0][0] if w else '-'
            print('  %-18s %-34s %d 个：%s' % (f, own, len(w),
                  ', '.join('%s×%d' % (k.replace('.js', ''), v) for k, v in w.most_common(4))))
        return 0

    if '--baseline' in sys.argv:
        out = {'_doc': reg.get('_doc', '见 tools/data_ownership.py 顶部说明'),
               'domains': {}}
        for f, w in sorted(live.items()):
            prev = doms.get(f, {})
            own = prev.get('owner') or (w.most_common(1)[0][0] if w else '')
            out['domains'][f] = {
                'owner': own,
                'writers': sorted(w.keys()),
                'note': prev.get('note', '')
            }
        io.open(REG, 'w', encoding='utf-8').write(
            json.dumps(out, ensure_ascii=False, indent=2) + '\n')
        print('✓ 已写入基线 %s（%d 个域）' % (os.path.relpath(REG, ROOT), len(out['domains'])))
        print('  ⚠️ note 还是空的？手工补一句「这个域是什么」——它是给未来的你看的。')
        return 0

    # ---------- 检查 ----------
    bad = []
    unknown = []
    for f, w in sorted(live.items()):
        d = doms.get(f)
        if not d:
            unknown.append((f, sorted(w.keys())))
            continue
        allowed = set(d.get('writers') or []) | {DATA_LAYER}
        for name, cnt in w.items():
            if name not in allowed:
                bad.append((f, name, cnt))

    print('数据领域边界门禁：%d 个域（登记 %d 个）' % (len(live), len(doms)))
    if unknown:
        print('\n✗ 有域没有登记写权（新域？到 src/data_ownership.json 补一条）：')
        for f, ws in unknown:
            print('   %-18s 写者：%s' % (f, ', '.join(ws)))
    if bad:
        print('\n✗ 有文件写了自己无权写的域（越界写入）：')
        for f, name, cnt in bad:
            own = doms.get(f, {}).get('owner', '-')
            print('   %-18s ← %-36s %d 处（owner 是 %s）' % (f, name, cnt, own))
        print('\n  处置（二选一）：')
        print('   ① 改走 owner 提供的接口函数（推荐 —— 这才是"收敛写入口"）')
        print('   ② 确实该由它写：把文件名加进 src/data_ownership.json 的 writers 并写清理由')
    if unknown or bad:
        return 1
    print('✓ 通过：没有越界写入，也没有未登记的新域')
    return 0


if __name__ == '__main__':
    sys.exit(main())
