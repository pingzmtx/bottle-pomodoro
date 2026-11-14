#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""「小工具不重复实现」门禁（棘轮式）

背景（2026-10-14 · 用户要求「命名/变量别乱七八糟」）：
  实测发现真正的「乱」不是名字丑，而是**同一件小事每个文件各写一份、名字还不一样**：

    补零      `_p2` / `_pad` / `pad2` / `p2`        —— 4 份
    取今天     `getTodayStr` / `_todayStr`            —— 2 份
    时间戳→日期 `getDateStr` / `_dstr`                —— 2 份
    HTML 转义  `escapeHtml` / `esc` ×3                —— 4 份

  这类重复的危害不在于多几行代码，而在于**改一处漏一处**：
  哪天转义规则要收紧、补零要支持负数，你得先在 4 个文件里找到它们全部。

规则：每个概念**只允许一份权威实现**，其他文件不许再定义同名/近义工具 —— 要用就调那份。
有意保留的例外必须登记在 ALLOW 并写明理由（如错误监控必须自包含）。

跑法: python3 tools/check_dup_utils.py      退出码 0 = 通过
"""
import os
import re
import sys

sys.dont_write_bytecode = True
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src' / 'scripts'

# (概念, 定义正则, {权威名: 权威所在文件})
CONCEPTS = [
    ('补零', r'^[ \t]*function\s+(_p2|_pad|pad2|p2)\s*\(', {'_p2': '00_pure_core.js'}),
    ('取今天(字符串)', r'^[ \t]*function\s+(getTodayStr|_todayStr|todayStr)\s*\(',
     {'getTodayStr': '00_pure_core.js'}),
    ('时间戳→日期', r'^[ \t]*function\s+(getDateStr|_dstr)\s*\(', {'getDateStr': '00_pure_core.js'}),
    ('HTML 转义', r'^[ \t]*function\s+(escapeHtml|esc)\s*\(',
     {'escapeHtml': '01eQ_ui_timerpanel.js'}),   # 2026-11-14 S3：01e 拆分后随域迁到计时面板
]

# 有意保留的例外：(概念, 名字) → 理由
ALLOW = {
    ('HTML 转义', 'esc'):
        '06_errRep_错误监控.js —— 错误监控必须自包含，不能依赖 01e 是否已加载',
}


def main():
    problems = []
    files = sorted(SRC.glob('*.js'))
    found = []

    for concept, pat, canonical in CONCEPTS:
        rx = re.compile(pat, re.M)
        canonical_name = list(canonical.keys())[0]
        canonical_file = canonical[canonical_name]
        defs = {}
        for f in files:
            for i, line in enumerate(f.read_text(encoding='utf-8').split('\n'), 1):
                m = rx.match(line)
                if m:
                    defs.setdefault(m.group(1), []).append((f.name, i))
        found.append((concept, defs, canonical_name, canonical_file))
        for name, places in defs.items():
            if name == canonical_name:
                if not any(p[0] == canonical_file for p in places):
                    problems.append('%s：「权威实现」%s 不在 %s（可能被搬走或改名了）'
                                    % (concept, name, canonical_file))
                for p in places:
                    if p[0] != canonical_file:
                        problems.append('%s：%s 在 %s:%d 又定义了一份（应调用 %s 的 %s）'
                                        % (concept, name, p[0], p[1], canonical_file, canonical_name))
                continue
            if (concept, name) in ALLOW:
                continue
            for p in places:
                problems.append('%s：%s 在 %s:%d 是一份重复实现 —— 改用 %s 的 %s（唯一实现）'
                                % (concept, name, p[0], p[1], canonical_file, canonical_name))

    print('小工具「唯一实现」门禁')
    for concept, defs, cname, cfile in found:
        names = ', '.join('%s（%d 处）' % (k, len(v)) for k, v in sorted(defs.items()))
        print('  %-14s 权威 %-14s 全仓定义：%s' % (concept, cname, names or '无'))
    for (concept, name), why in ALLOW.items():
        print('  · 例外 %s/%s：%s' % (concept, name, why))
    if problems:
        print('\n✗ 发现 %d 个问题：' % len(problems))
        for p in problems:
            print('  ' + p)
        return 1
    print('✓ 通过：每个小工具概念只有一份实现（例外已登记理由）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
