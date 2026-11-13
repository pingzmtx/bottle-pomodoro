#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""番茄计数「单一口径」门禁

背景：2026-10-08 组队冲刺显示 5 而自测 6 —— 真因是同一件事「今天几个番茄」
有两套实现：一套按点数（完整=1/半个=0.5），另一套只数完整番茄。
人一多就必然漏。此脚本把这条路堵死：

1) 黑名单：已删除的重复计数器名不得再出现在 src 里（定义或调用都算）
2) 登记制：名字形如 (get|count)*Tomato* 的函数必须在 tools/tomato_entries.txt
   登记，并写清「算的是什么口径」。新增未登记 → FAIL。

跑法: python3 tools/check_tomato_single_source.py
退出码 0 = 通过 / 1 = 有问题
"""
import re
import sys
sys.dont_write_bytecode = True
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src' / 'scripts'
REG = ROOT / 'tools' / 'tomato_entries.txt'

# 已删除的重复计数器：出现即 FAIL（防止「又加一个只数完整的」）
BANNED = ['countFullTomatoes', 'getWeekTomatoes', 'getWeekFullTomatoes']

# 需要登记的定义形态：以 get/count 开头、名字里带 Tomato
DEF_RE = re.compile(r'^function ((?:get|count)[A-Za-z0-9]*[Tt]omato[A-Za-z0-9]*)\s*\(', re.M)

# 金币金额常量（发放的唯一真源）——被写死在文案里就要报错
CONST_RE = re.compile(r'^\s*const\s+(COIN_[A-Z0-9_]+)\s*=\s*(\d+)\s*;', re.M)

# 直接读记录原始字段 r.pomos 的「合法姿势」：赋值 / 比较 / 类型判定 / 注释
# 其余一律禁止 —— 聚合时必须走 getPomos()，否则老记录（无 pomos 字段）会被算成 0，
# 同一份数据在 A 处显示 3、B 处显示 0。
# 只盯「记录型变量」——st/m/tb/d/b/out/g 这类是算好的统计聚合体，读它自己的字段没问题。
# ★ 口径是「默认禁止」，不是「盯几个变量名」：早先只把 r/rec/record/row/it/item/e 当记录型变量
#   （RECVAR），换个名字（x.pomos / seg.pomos）或解构（const { pomos } = r）就完全查不出来 ——
#   门禁看着全绿，实际只是个摆设。现在改成：任何 `X.pomos` 读取都算违规，除非 X 是下面登记过的
#   「聚合体 / 统计缓存」——它的 pomos 本身就是 getPomos 累加出来的结果，读自己的字段是对的。
POMOS_AGG = {
    # 新增这类对象请登记在这里，并写明它是什么
    'st',   # 统计块的 pomos 汇总对象
    'm',    # 按月/按成员聚合的中间体
    's',    # 求和累加器
    'd',    # 按天聚合的中间体
    'tb',   # 日志/海报页顶部汇总条
    '_tb',  # 同上（缓存引用）
    'b',    # buildStatsDateIndex 的按天桶
    'out',  # monthStats / yearStats 的输出对象
    'g',    # 00_pure_core 的通用累加体
}
POMOS_ANY_RE = re.compile(r'([A-Za-z_$][\w$]*)\s*\.pomos\b')
# 写路径 / 比较 / typeof / Number() 兜底：不是「读出来当数用」，放行
POMOS_OK_RE = re.compile(r'\.pomos\s*[=!<>]|\btypeof\s+[\w$]*\.pomos|\bNumber\s*\(\s*[\w$]*\.pomos')
# 解构 / 先把原始字段整个捞出来的写法，同族病，一并禁
POMOS_DESTRUCT_RE = re.compile(
    r'(?:const|let|var)\s*\{[^}]*\bpomos\b[^}]*\}\s*=|\s*\(\s*\{[^}]*\bpomos\b[^}]*\}\s*=\s*')
# 逐条白名单：原始字段直读且无法用上面规则表达的（写清理由）
POMOS_ALLOW = [
    ('05_journey_渐进解锁.js', "r.pomos != null ? r.pomos : ''", 'CSV 导出原始字段，导出的是存档快照不是统计'),
]


def scan_defs():
    """返回 {函数名: [(文件, 行号), ...]}"""
    found = {}
    for f in sorted(SRC.glob('*.js')):
        try:
            text = f.read_text(encoding='utf-8')
        except Exception as e:
            print('!! 读不了 %s: %s' % (f.name, e))
            continue
        for m in DEF_RE.finditer(text):
            line = text[:m.start()].count('\n') + 1
            found.setdefault(m.group(1), []).append((f.name, line))
    return found


def scan_banned():
    hits = []
    for f in sorted(SRC.glob('*.js')):
        text = f.read_text(encoding='utf-8')
        for name in BANNED:
            for i, ln in enumerate(text.split('\n'), 1):
                if name in ln:
                    hits.append((name, f.name, i, ln.strip()[:90]))
    return hits


def load_registry():
    """返回 {函数名: 口径说明}"""
    if not REG.exists():
        return {}
    reg = {}
    for ln in REG.read_text(encoding='utf-8').split('\n'):
        ln = ln.strip()
        if not ln or ln.startswith('#'):
            continue
        if '|' not in ln:
            print('!! 登记格式错（应为 名称|说明）: %s' % ln)
            continue
        name, desc = ln.split('|', 1)
        reg[name.strip()] = desc.strip()
    return reg


def scan_coin_literals():
    """金币奖励金额被写死在文案里 → 返回 [(文件, 行, 该行内容)]

    真源是 `const COIN_XXX = N;`。用户可见文案里若出现裸数字 N🪙，
    改常量时文案不会跟着变（历史：奖励从 50 改 25 时漏改若干处）。
    """
    consts = {}
    for f in sorted(SRC.glob('*.js')):
        for m in CONST_RE.finditer(f.read_text(encoding='utf-8')):
            consts[m.group(1)] = int(m.group(2))
    vals = sorted({v for v in consts.values() if v >= 10})
    if not vals:
        return []
    hits = []
    for f in sorted(SRC.glob('*.js')):
        for i, ln in enumerate(f.read_text(encoding='utf-8').split('\n'), 1):
            s = ln.strip()
            if s.startswith('*') or s.startswith('//') or s.startswith('/*'):
                continue          # 注释里提到金额不算
            for v in vals:
                if ('%d🪙' % v) in ln or ('🪙%d' % v) in ln:
                    hits.append((f.name, i, ln))
                    break
    return hits


def strip_comments(text):
    """把 // 行注释与 /* */ 块注释替换成空格（保留换行 → 行号不变）。

    不用正则是怕误吞字符串里的 // 和正则字面量；这里做个够用的小状态机。
    """
    out = []
    i, n = 0, len(text)
    in_b = False
    q = None
    while i < n:
        c = text[i]
        if in_b:
            if c == '*' and i + 1 < n and text[i + 1] == '/':
                out.append('  ')
                i += 2
                in_b = False
                continue
            out.append('\n' if c == '\n' else ' ')
            i += 1
            continue
        if q:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == q:
                q = None
            i += 1
            continue
        if c in ('"', "'", '`'):
            q = c
            out.append(c)
            i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                out.append(' ')
                i += 1
            continue
        if c == '/' and i + 1 < n and text[i + 1] == '*':
            out.append('  ')
            i += 2
            in_b = True
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def scan_raw_pomos():
    """聚合代码里直接读 r.pomos（绕过 getPomos）→ [(文件, 行, 该行内容)]

    真源是 getPomos(r)（自带「老记录无 pomos 字段」的类型兜底）。
    直接读原始字段 = 老记录算 0，同一事实两个口径。
    """
    hits = []
    for f in sorted(SRC.glob('*.js')):
        for i, ln in enumerate(strip_comments(f.read_text(encoding='utf-8')).split('\n'), 1):
            if 'pomos' not in ln:
                continue
            if any(f.name == fn and frag in ln for fn, frag, _ in POMOS_ALLOW):
                continue
            if POMOS_DESTRUCT_RE.search(ln):
                hits.append((f.name, i, ln))
                continue
            if POMOS_OK_RE.search(ln):
                continue
            for m in POMOS_ANY_RE.finditer(ln):
                if m.group(1) in POMOS_AGG:
                    continue
                hits.append((f.name, i, ln))
                break
    return hits


def main():
    defs = scan_defs()
    reg = load_registry()
    banned = scan_banned()
    bad = False

    print('扫描到 %d 个番茄口径函数，登记册 %d 条' % (len(defs), len(reg)))

    if banned:
        bad = True
        print('\n❌ 已废弃的重复计数器又出现了（这就是「两套算法」的病根）：')
        for name, fn, line, code in banned:
            print('   %s  %s:%d  %s' % (name, fn, line, code))
        print('   → 请改用 countTomatoPoints / getWeekTomatoPoints（完整=1 半个=0.5）')

    missing = [n for n in defs if n not in reg]
    if missing:
        bad = True
        print('\n❌ 有番茄口径函数没登记（新加了一个计数器？先想清楚是不是第二意见）：')
        for n in missing:
            for fn, line in defs[n]:
                print('   %s  (%s:%d)' % (n, fn, line))
        print('   → 到 tools/tomato_entries.txt 登记一行「名称|口径说明」')
        print('   → 若它其实是「只数完整番茄」的通用计数器，别加，合并到点数口径里')

    dups = {n: v for n, v in defs.items() if len(v) > 1}
    if dups:
        bad = True
        print('\n❌ 同名函数有多份定义（JS 里后面的会静默覆盖前面的，出 bug 极难查）：')
        for n, v in sorted(dups.items()):
            print('   %s  ×%d  %s' % (n, len(v), '  '.join('%s:%d' % x for x in v)))
        print('   → 只能留一份，其余删掉（留着就是下一次「有时对有时错」的来源）')

    gone = [n for n in reg if n not in defs]
    if gone:
        print('\n⚠️  登记册里这些函数已不存在（建议删掉这几行）：')
        for n in gone:
            print('   %s' % n)

    # ---- 金币金额「不得写死在文案里」----
    # 病根同源：COIN_*_REWARD 是发放的唯一真源，但用户可见的「+25🪙」文案里
    # 一旦写死数字，改常量时文案会静默说谎（历史已发生：50 → 25 时漏改若干处）。
    lits = scan_coin_literals()
    if lits:
        bad = True
        print('\n❌ 金币金额被写死在用户可见文案里（改常量后文案会说谎）：')
        for fn, line, txt in lits:
            print('   %s:%d  %s' % (fn, line, txt.strip()[:90]))
        print("   → 改成字符串拼接：'+' + COIN_MUSTDO_REWARD + '🪙'")

    raw = scan_raw_pomos()
    if raw:
        bad = True
        print('\n❌ 直接读记录原始字段 .pomos（绕过 getPomos，老记录会被算成 0）：')
        for fn, i, ln in raw:
            print('   %s:%d  %s' % (fn, i, ln.strip()[:90]))
        print('   → 聚合一律写 getPomos(r)')

    if bad:
        print('\n番茄计数单一口径: FAILED')
        return 1
    print('\n番茄计数单一口径: OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())
