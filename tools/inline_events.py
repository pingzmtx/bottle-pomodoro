#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把模板片段里的内联事件改成声明式属性（data-act / data-change / ...）。

用法：
    python3 tools/inline_events.py src/template/31_modals.html --write
    python3 tools/inline_events.py src/template/*.html --check   # 只报告剩余数量

为什么需要：内联 on*="..." 在全局作用域求值，是上 ES 模块的唯一硬阻塞。
转换后由 src/scripts/00_delegate.js 统一派发（document 级委托，逐级上溯，
语义与内联处理器一致：祖先上的处理器照常触发、stopPropagation 照常生效）。

支持两种写法：
    onclick="fn('a', 1)"            →  data-act="fn" data-act-args='["a",1]'
    onclick="event.stopPropagation();fn(this)"
                                    →  data-act="fn" data-act-args='["@this"]' data-stop="1"
    onkeydown="if(event.key==='Enter')fn()"
                                    →  data-keydown="fn" data-keys="Enter"
其余（多语句、条件体、非字面量表达式）**不猜**，原样保留并打印出来，交人工处理。
"""
import re
import sys

EVENTS = ('click', 'change', 'input', 'keydown', 'focus', 'blur')
ATTR = re.compile(r'\son(' + '|'.join(EVENTS) + r')="([^"]*)"')
CALL = re.compile(r'^([A-Za-z_$][\w$.]*)\((.*)\)$', re.S)
KEYWORDS = {'if', 'for', 'while', 'switch', 'return', 'typeof'}


def split_args(a):
    out, cur, q, depth, i = [], '', None, 0, 0
    while i < len(a):
        c = a[i]
        if q:
            cur += c
            if c == '\\' and i + 1 < len(a):
                cur += a[i + 1]
                i += 2
                continue
            if c == q:
                q = None
        elif c in '"\'':
            q = c
            cur += c
        elif c in '([{':
            depth += 1
            cur += c
        elif c in ')]}':
            depth -= 1
            cur += c
        elif c == ',' and depth == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += c
        i += 1
    if cur.strip():
        out.append(cur.strip())
    return [x for x in out if x != '']


def to_json_arg(tok):
    """把 JS 实参转成运行时占位符；不认识就抛 ValueError（交人工）。"""
    t = tok.strip()
    if t == 'this':
        return '@this'
    if t == 'event':
        return '@event'
    if t == 'this.value':
        return '@value'
    if t == 'this.checked':
        return '@checked'
    m = re.fullmatch(r'this\.value\s*/\s*(\d+(?:\.\d+)?)', t)
    if m:
        return '@value/' + m.group(1)
    if re.fullmatch(r'-?\d+(?:\.\d+)?', t):
        return t
    if t in ('true', 'false', 'null'):
        return t
    if re.fullmatch(r"'([^'\\]|\\.)*'", t) or re.fullmatch(r'"([^"\\]|\\.)*"', t):
        body = t[1:-1].replace("\\'", "'").replace('\\"', '"')
        return body
    if re.fullmatch(r'[A-Za-z_$][\w$]*', t):
        return '@global:' + t
    raise ValueError(tok)


def build(name, raw_args):
    args = split_args(raw_args) if raw_args.strip() else []
    vals = [to_json_arg(a) for a in args]
    # 全部是字符串时用 JSON 双引号；属性用单引号包裹，避免反转义
    js = '[' + ','.join(
        ('"' + v.replace('\\', '\\\\').replace('"', '\\"') + '"') if isinstance(v, str) else v
        for v in vals) + ']'
    return js


def convert_expr(expr):
    """返回 (fn, args_json|None, extra_attrs:dict) 或 None（不处理）。"""
    e = expr.strip().rstrip(';').strip()
    if not e:
        return ('', None, {})
    stop = False
    extra = {}
    # event.stopPropagation(); rest
    m = re.match(r'^event\.stopPropagation\(\)\s*;\s*(.*)$', e, re.S)
    if m:
        stop = True
        e = m.group(1).strip().rstrip(';').strip()
    # if (event.target===this) fn(...)
    m = re.match(r'^if\s*\(\s*event\.target\s*===\s*this\s*\)\s*(.+)$', e, re.S)
    if m:
        extra['data-self'] = '1'
        e = m.group(1).strip()
    # if (event.key==='X') fn(...)
    m = re.match(r"^if\s*\(\s*event\.key\s*===\s*'([^']*)'\s*\)\s*(.+)$", e, re.S)
    if m:
        extra['data-keys'] = 'Space' if m.group(1) == ' ' else m.group(1)
        e = m.group(2).strip().rstrip(';').strip()
    # if (event.key==='X'||event.key==='Y') { event.preventDefault(); fn(...); }
    m = re.match(r"^if\s*\(\s*event\.key\s*===\s*'([^']*)'\s*\|\|\s*event\.key\s*===\s*'([^']*)'\s*\)\s*\{\s*event\.preventDefault\(\)\s*;\s*(.+?)\s*;?\s*\}$", e, re.S)
    if m:
        keys = [x for x in (m.group(1), m.group(2)) if x]
        extra['data-keys'] = ' '.join('Space' if k == ' ' else k for k in keys)
        e = m.group(3).strip().rstrip(';').strip()
    if e == 'event.stopPropagation()':
        return ('__noop', None, {'data-stop': '1'})
    m = re.fullmatch(r"document\.getElementById\(\s*'([^']+)'\s*\)\.click\(\)", e)
    if m:
        return ('__clickId', '["%s"]' % m.group(1), extra)
    m = CALL.match(e)
    if m and m.group(1) == 'window.open':
        try:
            return ('__openUrl', build('window.open', m.group(2)), extra)
        except ValueError:
            return None
    # A();B();  → 主体 A + data-after B（B 无参）
    m = re.fullmatch(r"([A-Za-z_$][\w$]*)\((.*?)\)\s*;\s*([A-Za-z_$][\w$]*)\(\)\s*;?", e, re.S)
    if m:
        try:
            main_args = build(m.group(1), m.group(2))
        except ValueError:
            return None
        extra['data-after'] = m.group(3)
        return (m.group(1), main_args, extra)
    # A();setTimeout(B,N);
    m = re.fullmatch(r"([A-Za-z_$][\w$]*)\((.*?)\)\s*;\s*setTimeout\(\s*([A-Za-z_$][\w$]*)\s*,\s*(\d+)\s*\)\s*;?", e, re.S)
    if m:
        try:
            main_args = build(m.group(1), m.group(2))
        except ValueError:
            return None
        extra['data-after'] = m.group(3)
        extra['data-after-delay'] = m.group(4)
        return (m.group(1), main_args, extra)
    if e in ('this.select()', 'this.blur()', 'this.focus()'):
        return ('__self' + e[5:-2].capitalize(), None, extra)
    m = CALL.match(e)
    if not m:
        return None
    fn = m.group(1)
    if fn in KEYWORDS or '.' in fn or fn.startswith('window') or fn.startswith('document'):
        return None
    try:
        args_json = build(fn, m.group(2))
    except ValueError:
        return None
    if stop:
        extra['data-stop'] = '1'
    return (fn, args_json, extra)


def process(text, report):
    def repl(m):
        ev, expr = m.group(1), m.group(2)
        got = convert_expr(expr)
        if got is None:
            report['manual'].append((ev, expr))
            return m.group(0)
        fn, args_json, extra = got
        if not fn:
            report['removed'] += 1
            return ''
        suffix = 'act' if ev == 'click' else ev
        out = ''
        if extra.get('data-stop'):
            out += ' data-stop="1"'
        if extra.get('data-self'):
            out += ' data-self="1"'
        if extra.get('data-keys'):
            out += ' data-keys="%s"' % extra['data-keys']
        if extra.get('data-after'):
            out += ' data-after="%s"' % extra['data-after']
        if extra.get('data-after-delay'):
            out += ' data-after-delay="%s"' % extra['data-after-delay']
        out += ' data-%s="%s"' % (suffix, fn)
        if args_json and args_json != '[]':
            out += " data-%s-args='%s'" % (suffix, args_json)
        report['ok'] += 1
        return out
    return ATTR.sub(repl, text)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    write = '--write' in sys.argv
    total = {'ok': 0, 'removed': 0, 'manual': []}
    for path in args:
        s = open(path, encoding='utf-8').read()
        rep = {'ok': 0, 'removed': 0, 'manual': []}
        out = process(s, rep)
        left = len(ATTR.findall(out))
        print('%-42s 转换 %3d · 移除空处理器 %d · 剩内联 %3d · 手工 %d'
              % (path.split('/')[-1], rep['ok'], rep['removed'], left, len(rep['manual'])))
        for ev, expr in rep['manual']:
            print('      [%s] %s' % (ev, expr[:100]))
        for k in ('ok', 'removed'):
            total[k] += rep[k]
        total['manual'].extend(rep['manual'])
        if write and out != s:
            open(path, 'w', encoding='utf-8').write(out)
    print('合计：转换 %d · 剩手工 %d' % (total['ok'], len(total['manual'])))
    return 0 if not total['manual'] else 2


if __name__ == '__main__':
    sys.exit(main())
