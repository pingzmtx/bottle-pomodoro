# -*- coding: utf-8 -*-
"""
· 无障碍（a11y）自动审计与门禁
==================================================================
为什么存在：项目有 `09_a11y_无障碍.js`（焦点陷阱 / 焦点归位 / aria-live /
控件标注 / 弹窗语义，258 行），但它**没有任何自动验证** —— 「写了」不等于
「生效了」，也不等于「新加的按钮也覆盖到了」。本工具把 a11y 从「靠人记得」
变成「机器守着」。

两种模式：
  --static  纯静态（<0.3s，不起浏览器）→ 已挂进 `verify.py` 的 `a11y` 段
  默认      静态 + 动态（需 playwright，约 20s）→ 改动 a11y/弹窗/控件后手动跑

  S 段（静态）：模板里「图标按钮」（只有符号/emoji、无可读文字）必须有
                aria-label 或 title —— 否则屏读用户听到的是「按钮」，不知道是什么
  D 段（动态）：弹窗语义（role=dialog/aria-modal/aria-label）· 可交互元素都有
                可访问名 · **可访问名不能是无意义的通用兜底**（如「按钮 ‹」）·
                aria-live 常驻区 · 导航 tab 语义 · 焦点陷阱（Tab 不逃逸出弹窗）

出口：全部 ✓ = 通过（退出码 0）；任何 ✗ 进末尾汇总（退出码 1）。
==================================================================
"""

import io
import os
import re
import sys

TPL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'template')
# 路径不再硬编码（P1-8）：--html > SMOKE_APP/APP/RS_APP > 项目内 index.html。
# 原来的写死路径换个目录就读到不存在的文件（或更糟：旧产物），而审计照样"通过"。
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _app_path import resolve as _resolve_app
APP = _resolve_app()

RESULTS = []


def ok(name, cond, detail=''):
    RESULTS.append((name, bool(cond), detail))
    print(('✓' if cond else '✗') + ' ' + name + (('  → ' + str(detail)) if (detail and not cond) else ''))


# ---------- S 段：静态 ----------
def _strip_comments_keep_lines(s):
    """剥掉 HTML 注释但保留换行数，保证报的行号准确。"""
    return re.sub(r'<!--.*?-->', lambda m: '\n' * m.group(0).count('\n'), s, flags=re.S)


def static_checks():
    """图标按钮必须有可访问名。规则与 09_a11y 的判定一致，避免两处口径漂移。"""
    bad = []
    total_icon = 0
    if not os.path.isdir(TPL_DIR):
        return bad, total_icon
    for n in sorted(os.listdir(TPL_DIR)):
        if not n.endswith('.html'):
            continue
        raw = io.open(os.path.join(TPL_DIR, n), encoding='utf-8').read()
        s = _strip_comments_keep_lines(raw)
        for m in re.finditer(r'<button\b([^>]*)>(.*?)</button>', s, re.S):
            attrs, inner = m.group(1), m.group(2)
            txt = re.sub(r'<[^>]+>', '', _strip_comments_keep_lines(inner)).strip()
            # 与 09_a11y 同口径：「短 + 无可读字符」= 图标按钮
            if not (txt and len(txt) <= 4 and not re.search(r'[a-zA-Z0-9\u4e00-\u9fa5]', txt)):
                continue
            total_icon += 1
            if re.search(r'aria-label\s*=', attrs) or re.search(r'\btitle\s*=', attrs):
                continue
            ln = s[:m.start()].count('\n') + 1
            bad.append('%s:%d 图标按钮「%s」缺 aria-label/title' % (n, ln, txt))
    return bad, total_icon


def dynamic_checks(pg):
    # ---- D1 弹窗语义（打开态；关闭态无 role 是正常的，09_a11y 在打开时标注）----
    pg.evaluate("openTreeShop()")
    pg.wait_for_timeout(350)
    d1 = pg.evaluate("""(() => {
      const o = document.querySelector('.modal-overlay.show');
      return o ? { shown: true, role: o.getAttribute('role') || '', modal: o.getAttribute('aria-modal') || '',
                   label: o.getAttribute('aria-label') || '' } : { shown: false };
    })()""")
    ok('D1-① 弹窗打开后有 role=dialog', d1.get('shown') and d1.get('role') == 'dialog', d1)
    ok('D1-② 弹窗有 aria-modal=true', d1.get('modal') == 'true', d1)
    ok('D1-③ 弹窗有可读 aria-label（取首个标题）', bool(d1.get('label')), d1)

    # ---- D2 可见可交互元素都有可访问名 ----
    d2 = pg.evaluate("""(() => {
      const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [onclick], [data-act]';
      const vis = Array.from(document.querySelectorAll(sel)).filter(e => {
        const s = getComputedStyle(e); if (s.display==='none'||s.visibility==='hidden') return false;
        const r = e.getBoundingClientRect(); return r.width>0 && r.height>0;
      });
      const noName = [];
      for (const e of vis) {
        const o = e.closest('.modal-overlay');
        if (o && !o.classList.contains('show')) continue;         // 忽略未打开的弹窗内部
        const nm = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim();
        if (!nm && !e.getAttribute('placeholder'))
          noName.push((e.tagName + (e.id ? '#'+e.id : '')).slice(0, 50));
      }
      return { total: vis.length, noName: noName };
    })()""")
    ok('D2 可见可交互元素都有可访问名', len(d2['noName']) == 0,
       '共 %d 个，缺失 %d：%s' % (d2['total'], len(d2['noName']), d2['noName'][:6]))

    # ---- D3 可访问名不是「无意义兜底」（本次新增：真实抓到的缺陷）----
    d3 = pg.evaluate("""(() => {
      const bad = [];
      document.querySelectorAll('button[aria-label]').forEach(b => {
        const a = (b.getAttribute('aria-label') || '').trim();
        // '按钮 ‹' / '按钮 ✓' 这类是 09_a11y 对未登记符号的通用兜底 —— 屏读听不懂
        if (/^按钮\\s*\\S+$/.test(a) && !/[a-zA-Z0-9\\u4e00-\\u9fa5]/.test(a.replace(/^按钮\\s*/, ''))) {
          bad.push(a + ' @' + (b.className || '(无class)').split(' ')[0]);
        }
      });
      return bad;
    })()""")
    ok('D3 无「按钮 X」式无意义可访问名（符号需映射成能听懂的词）', len(d3) == 0, d3[:8])

    # ---- D4 aria-live 常驻区 ----
    d4 = pg.evaluate("""(() => {
      const l = document.getElementById('a11yLive');
      return { exists: !!l, live: l ? l.getAttribute('aria-live') : '' };
    })()""")
    ok('D4 存在 aria-live 常驻区（状态变化可被朗读）',
       d4['exists'] and d4['live'] in ('polite', 'assertive'), d4)

    # ---- D5 导航 tab 语义 ----
    d5 = pg.evaluate("""(() => {
      const nav = document.querySelector('.bottom-nav');
      const items = document.querySelectorAll('.bottom-nav .nav-item');
      const roles = Array.from(items).map(x => x.getAttribute('role'));
      return { listRole: nav ? nav.getAttribute('role') : '', n: items.length,
               allTab: roles.length > 0 && roles.every(r => r === 'tab') };
    })()""")
    ok('D5 底部导航有 tablist/tab 语义', d5['listRole'] == 'tablist' and d5['allTab'], d5)

    # ---- D6 焦点陷阱：弹窗内连续 Tab 不逃逸 ----
    pg.evaluate("openTreeShop()")
    pg.wait_for_timeout(300)
    escaped = []
    for _ in range(10):
        pg.keyboard.press('Tab')
        st = pg.evaluate("""(() => {
          const o = document.querySelector('.modal-overlay.show');
          if (!o) return { noModal: true };
          const ae = document.activeElement;
          return { inModal: o.contains(ae), id: (ae && (ae.id || ae.className || ae.tagName)) || '' };
        })()""")
        if st.get('noModal'):
            escaped.append('弹窗消失')
            break
        if not st.get('inModal'):
            escaped.append('焦点逃逸到 ' + str(st.get('id'))[:40])
            break
    ok('D6 焦点陷阱：弹窗内连续 Tab 10 次不逃逸', not escaped, escaped)
    pg.evaluate("closeModal('treeShopModal')")


def main():
    static_only = '--static' in sys.argv

    print('===== S 段：静态（图标按钮可访问名）=====')
    bad, total_icon = static_checks()
    ok('S1 模板图标按钮都有 aria-label/title（共 %d 个）' % total_icon, not bad,
       '缺 %d 处：%s' % (len(bad), bad[:6]))

    if not static_only:
        from playwright.sync_api import sync_playwright
        print()
        print('===== D 段：动态（弹窗/控件/焦点，需浏览器）=====')
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 430, 'height': 940})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.add_init_script("window.__remindWatchPaused = true")
            pg.goto(APP)
            pg.wait_for_function(
                "typeof appData !== 'undefined' && typeof window.a11yRefresh === 'function'", timeout=20000)
            pg.wait_for_timeout(2600)
            try:
                dynamic_checks(pg)
            finally:
                ok('D99 全程零 JS 异常', not errs, errs[:3])
                b.close()

    print()
    bad_all = [x for x in RESULTS if not x[1]]
    print('a11y 审计%s：%d 通过 / %d 失败（共 %d 条）'
          % ('（静态）' if static_only else '', len(RESULTS) - len(bad_all), len(bad_all), len(RESULTS)))
    for name, _, detail in bad_all:
        print('  ✗ ' + name + ('  → ' + str(detail)))
    return 1 if bad_all else 0


if __name__ == '__main__':
    sys.exit(main())
