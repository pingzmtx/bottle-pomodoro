#!/usr/bin/env python3
"""增量体检：只审「这次改了什么」，不审「仓库里有什么」。

为什么不是全库体检
------------------
全库体检是一**次性迁移**手段（2026-10 那轮重构就是），它随仓库增长而变慢，
最终会慢到没人跑。常规维护必须成本恒定 —— 因此审计对象是 git diff 的新增行，
与仓库总行数无关。

它补的是既有门禁的**空档**（不重复 lint 已有的颜色/窗口/lint 项）：
  · 设计尺度字面量（style.xxx = '12px'）—— AGENTS.md §143 要求走 --sp/--radius/--fs
  · 时长/间隔字面量（setTimeout(fn, 1200)）
  · 手写 window 挂载（gen_bridge 已自动生成，手写 = 第二份赋值来源）
  · 新增 innerHTML 拼接
  · 新增函数名与别处同名（小工具唯一实现门禁只认 4 个概念，这里兜其余）

用法
----
  python3 tools/audit_diff.py                # 审 .audit_base → HEAD（含未提交）
  python3 tools/audit_diff.py --base HEAD~5  # 指定基线
  python3 tools/audit_diff.py --set-base     # 发版后调用：把当前 HEAD 记为基线
  python3 tools/audit_diff.py --strict       # 有发现就退出码 1（想挂门禁用）

输出按文件聚合，只列**新增行**里的命中，全部为建议级（项目里确实有正当例外）。
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_FILE = os.path.join(ROOT, '.audit_base')
SRC = os.path.join(ROOT, 'src', 'scripts')

# (规则名, 正则, 是否只看 JS)
RULES = [
    ('设计尺度字面量', re.compile(r"""\.style\.\w+\s*=\s*['"][^'"]*?\d+(\.\d+)?(px|rem|em)"""), True),
    ('行高字面量', re.compile(r"""\.style\.lineHeight\s*=\s*['"][^'"]*?\d"""), True),
    ('时长字面量', re.compile(r"""setTimeout\s*\([^,)]*,\s*(\d{3,})\s*\)"""), True),
    ('间隔字面量', re.compile(r"""setInterval\s*\([^,)]*,\s*(\d{3,})\s*\)"""), True),
    ('手写 window 挂载', re.compile(r"""^\s*window\.\w+\s*=[^=]"""), True),
    ('innerHTML 赋值', re.compile(r"""\.innerHTML\s*\+?=[^=]"""), True),
]

CODE_EXT = ('.js', '.html', '.css')

# 生成物不进审计：它们是 src 的合并产物，报出来的问题在 src 里已经报过一遍。
# （src/template.html 同样是 src/template/ 片段的产物，真源是片段。）
SKIP_PREFIX = ('public/', 'dist/', 'node_modules/', 'tools/vendor/')
SKIP_FILES = {'src/template.html'}


def skipped(path):
    return path.startswith(SKIP_PREFIX) or path in SKIP_FILES


def git(*args):
    r = subprocess.run(['git'] + list(args), cwd=ROOT,
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return r.stdout


def read_base():
    if os.path.exists(BASE_FILE):
        s = open(BASE_FILE).read().strip()
        if s:
            return s
    # 没有基线文件时退一个安全值，并提示
    return None


def added_lines(base):
    """返回 {文件: [(行号, 内容)]}，只含纯新增行。"""
    diff = git('diff', '-U0', '--no-color', base, '--', '.')
    if diff is None:
        return None
    out, cur = {}, None
    for line in diff.split('\n'):
        if line.startswith('+++ b/'):
            cur = line[6:]
            out.setdefault(cur, [])
        elif line.startswith('@@'):
            m = re.search(r'\+(\d+)', line)
            n = int(m.group(1)) if m else 0
        elif cur and line.startswith('+') and not line.startswith('+++'):
            out[cur].append((n, line[1:]))
            n += 1
    return {k: v for k, v in out.items() if v}


def strip_comment(src):
    s = src.strip()
    if s.startswith(('//', '*', '/*', '<!--')):
        return ''
    return s


def existing_funcs():
    """全仓已有函数名 → 定义所在文件列表。"""
    idx = {}
    pat = re.compile(r'^\s*(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\())')
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith('.js'):
            continue
        try:
            text = open(os.path.join(SRC, fn), encoding='utf-8').read()
        except OSError:
            continue
        for line in text.split('\n'):
            m = pat.match(line)
            if m:
                name = m.group(1) or m.group(2)
                idx.setdefault(name, []).append(fn)
    return idx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base')
    ap.add_argument('--set-base', action='store_true')
    ap.add_argument('--strict', action='store_true')
    a = ap.parse_args()

    if a.set_base:
        head = (git('rev-parse', 'HEAD') or '').strip()
        open(BASE_FILE, 'w').write(head + '\n')
        print(f'✓ 基线已记为 {head[:10]}（下次审计从这一点往后看）')
        return 0

    base = a.base or read_base()
    if not base:
        print('⚠ 还没有基线。先跑一次 python3 tools/audit_diff.py --set-base', file=sys.stderr)
        return 2
    head = (git('rev-parse', 'HEAD') or '').strip()[:10]
    files = added_lines(base)
    if files is None:
        print(f'✗ 基线 {base} 无法比对（git diff 失败）', file=sys.stderr)
        return 2

    funcs = existing_funcs()
    report, total = {}, 0
    for path, lines in sorted(files.items()):
        if not path.endswith(CODE_EXT) or skipped(path):
            continue
        hits = []
        for n, raw in lines:
            code = strip_comment(raw)
            if not code:
                continue
            for name, rx, _js_only in RULES:
                if rx.search(code):
                    # 引用设计令牌（var(--sp-6, 6px)）的行是合规的，6px 只是回退值
                    if 'var(--' in code and name.endswith('字面量'):
                        continue
                    hits.append((n, name, code.strip()[:90]))
            # 新增顶层函数，且别处已有同名 → 疑似重复实现
            m = re.match(r'\s*function\s+(\w+)\s*\(', code)
            if m:
                name = m.group(1)
                others = [f for f in funcs.get(name, []) if f != os.path.basename(path)]
                if others:
                    hits.append((n, '重名函数', f'{name}() 也定义在 {", ".join(sorted(set(others)))}'))
        if hits:
            report[path] = hits
            total += len(hits)

    stat = git('diff', '--shortstat', '--no-color', base, '--', '.') or ''
    print(f'增量体检 · 基线 {base[:10]} → {head}')
    print(f'改动范围：{stat.strip() or "无改动"}')
    print()

    if not total:
        print('✓ 新增行里没有命中任何规则')
        return 0

    for path, hits in report.items():
        print(f'── {path}（{len(hits)} 项）')
        for n, name, snippet in hits:
            print(f'   :{n}  [{name}]  {snippet}')
        print()

    kinds = {}
    for hits in report.values():
        for _, name, _s in hits:
            kinds[name] = kinds.get(name, 0) + 1
    print('按规则汇总：' + ' / '.join(f'{k} {v}' for k, v in
                                     sorted(kinds.items(), key=lambda x: -x[1])))
    print(f'合计 {total} 项（建议级：逐项判断是否正当例外，正当的加行内注释说明理由）')
    return 1 if a.strict else 0


if __name__ == '__main__':
    sys.exit(main())
