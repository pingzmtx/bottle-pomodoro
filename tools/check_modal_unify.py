#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""弹窗收编门禁：所有 .modal-overlay 必须长成同一副样子。

检查 src/template.html 里每个 .modal-overlay 块：
  R1 bare-btn     —— `class="modal-btn"` 裸类（无 primary/secondary/... 修饰）= 没有背景色的"死按钮"
  R2 inline-color —— 块内 inline 色值，若在多个弹窗里重复出现、或等于 :root 已有令牌的值 → 必须抽成令牌/类
  R3 foot         —— 块内有 <button> 却没有 .modal-buttons 容器（按钮行各写一套 → 间距/换行不一致）
  R4 title        —— 块内没有 <h3> 标题
  R5 btn-color    —— .modal-btn 上 inline 写 background/color/border-color（按钮配色必须走变体类，
                     否则暗色模式只能一处一处补丁）

豁免写在 tools/modal_unify_allow.json：{"弹窗id": {"rules": ["title","foot"], "reason": "..."}}
只写规则名表示该规则豁免；值写 ["*"] 表示全豁免。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, 'src', 'template.html')
ALLOW = os.path.join(ROOT, 'tools', 'modal_unify_allow.json')

RULES = ('bare-btn', 'inline-color', 'foot', 'title', 'btn-color')


def blocks(src):
    """按出现顺序切成 (id, html) 的弹窗块"""
    hits = []
    # id 与 class 的前后顺序不固定（有的 id 在前），统一扫 <div ...> 开标签
    for m in re.finditer(r'<div\b[^>]*>', src):
        tag = m.group(0)
        if not re.search(r'class="[^"]*\bmodal-overlay\b', tag):
            continue
        mid = re.search(r'(?<![-\w])id="([^"]+)"', tag)
        hits.append((mid.group(1) if mid else '(无id)', m.start()))
    hits.append(('__END__', len(src)))
    out = []
    for i in range(len(hits) - 1):
        sid, s0 = hits[i]
        # ★ 末块不能在 EOF 截断（P3）：原来最后一块 = 最后一个 modal 到文件末尾，
        #   把 modal 之后的所有内容（脚本、别的区块）都算进这个弹窗，
        #   于是"缺 .modal-buttons"之类的判据在末块上假阳性。
        #   按 div 嵌套找到该 overlay 真正的闭合位置，且不越过下一个 modal 的起点。
        end = _match_div_end(src, s0) if sid != '__END__' else len(src)
        end = min(end, hits[i + 1][1])
        out.append((sid, src[s0:end]))
    return out


def _match_div_end(src, start):
    """从 start（指向 <div 的 <）开始，返回与之配对的 </div> 之后的位置。"""
    depth = 0
    for m in re.finditer(r'<div\b|</div>', src[start:]):
        if m.group(0) == '</div>':
            depth -= 1
            if depth == 0:
                return start + m.end()
        else:
            depth += 1
    return len(src)


def token_colors(src):
    root = re.search(r':root\s*\{(.*?)\n\}', src, re.S)
    vals = set()
    if root:
        for v in re.findall(r'--[a-z0-9-]+\s*:\s*([^;]+);', root.group(1)):
            v = v.strip().lower()
            if re.match(r'^#[0-9a-f]{3,8}$', v) or v.startswith('rgb'):
                vals.add(v.replace(' ', ''))
    return vals


def colors_of(style_attr):
    out = []
    for c in re.findall(r'#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)', style_attr):
        c = c.strip().lower().replace(' ', '')
        if 'var(' in c:      # rgba(var(--x-rgb), .1) 是令牌写法，不算硬编码
            continue
        out.append(c)
    return out


def main():
    src = io.open(TPL, encoding='utf-8').read()
    allow = {}
    if os.path.exists(ALLOW):
        allow = json.load(io.open(ALLOW, encoding='utf-8'))
    tok = token_colors(src)
    blks = blocks(src)

    # 先统计全文件色值出现次数（跨弹窗重复 = 该抽类）
    freq = {}
    per = []
    for mid, html in blks:
        cs = []
        for st in re.findall(r'style="([^"]*)"', html):
            cs += colors_of(st)
        per.append(cs)
        for c in cs:
            freq[c] = freq.get(c, 0) + 1

    viol = []
    for idx, (mid, html) in enumerate(blks):
        ex = allow.get(mid, {})
        exr = set(ex.get('rules', []))
        if '*' in exr:
            exr = set(RULES)
        bad = []
        if 'bare-btn' not in exr and re.search(r'class="modal-btn"', html):
            bad.append('bare-btn')
        if 'inline-color' not in exr:
            for c in set(per[idx]):
                if freq[c] >= 2 or c in tok:
                    why = '与其他弹窗重复' if freq[c] >= 2 else '已有令牌'
                    bad.append('inline-color(%s %s)' % (c, why))
                    break
        if 'foot' not in exr:
            has_btn = '<button' in html
            has_foot = re.search(r'class="[^"]*\bmodal-buttons\b', html)
            if has_btn and not has_foot:
                bad.append('foot')
        if 'btn-color' not in exr:
            # 只查按钮自己身上的 inline 配色；style="margin-top:..." / "flex:0 0 auto" 是布局，放行
            for tag in re.findall(r'<button\b[^>]*>', html):
                if 'modal-btn' not in tag:
                    continue
                st = re.search(r'style="([^"]*)"', tag)
                if st and re.search(r'(?<![-a-z])(background|color|border-color)\s*:', st.group(1)):
                    bad.append('btn-color')
                    break
        if 'title' not in exr and not re.search(r'<h3[^>]*>', html):
            bad.append('title')
        if bad:
            viol.append((mid, sorted(set(bad))))

    print('弹窗总数: %d；豁免登记: %d' % (len(blks), len(allow)))
    if not viol:
        print('✓ 弹窗收编检查通过（无违规）')
        return 0
    print('✗ 共 %d 个弹窗偏离统一结构：' % len(viol))
    for mid, bad in viol:
        print('  - %-26s %s' % (mid, ', '.join(bad)))
    print('\n修好，或在 tools/modal_unify_allow.json 里写明理由豁免（仅限视觉类弹窗）。')
    return 1


if __name__ == '__main__':
    sys.exit(main())
