/* _contract.js — 用例公共契约：阈值 / 环境清单 / 测量原语（唯一实现）
   ═══════════════════════════════════════════════════════════════════
   为什么要有这个文件（2026-10-19 · 需求原话：

     「你每次改一个东西，这些断言都会失败。我感觉这是不合理的。那以后还有那么多，
       那以后每次这断言都有问题，你都要一个一个修吗？你自己想个办法」）

   问题不在"断言多"，在于**断言抄了实现的现值，而且是每个用例各抄一份**：

     · 颜色解析各写一份 → C81 那份只认 `rgb()`，`color-mix()` 的计算结果是
       `color(srgb 0.23 0.26 0.35)` → 解析出 null → ratio 变 0.00 → **假红**。
       同一件事，测试自己的 bug 被当成"代码坏了"，白折腾一轮。
     · 主题清单各写一份 → 加第 7 个主题要翻遍所有用例，漏一个就少测一档。
     · 阈值各写一份 → 4.5 / 1.5 / 6 / 8 这些数字散落在十几个文件里，
       产品口径一改就得全局搜索，还得判断哪处该死抠。

   这里把三样东西收成一份，用例只能引用、不许自己再写：
     ① `TC.TH`  阈值表（AA 正文、块可见度区间、字色上限…）
     ② `TC.THEMES` / `TC.MODES` 环境清单（六个命名主题 × 浅/深）
     ③ `TC.parse/lum/contrast/elRatio/withThemes…` 测量原语

   于是"改实现 → 一堆断言红"被降级成两种情况：
     · 改的是**实现**（配色公式、DOM 结构）→ 断言量的是「性质」（对比度 ≥ 4.5），
       **不该红**；真红了就是真的坏了。
     · 改的是**产品口径**（比如正文对比度要求从 4.5 提到 7）→ 只改 `TC.TH` 一处。

   注入方式：`tools/run_smoke.py:_case_js()` 与 `tools/local_batch.py` 会在每条用例
   前面自动拼上本文件，用例里直接用全局 `TC`，**不需要 import**。
   ═══════════════════════════════════════════════════════════════════ */
var TC = (function () {
  /* ── ① 阈值：产品要求，不是实现现值 ──────────────────────────────
     改这里 = 改"要求"，属于产品决策；改样式文件 = 改"实现"，不该动这里。 */
  var TH = {
    AA: 4.5,          /* WCAG AA 正文对比度（色块上的字也按正文算） */
    AA_LARGE: 3,      /* 大字号（≥18.66px 粗体 / 24px）可用 3:1 */
    INK_MAX: 8,       /* 字色上限：超过这条说明用了接近纯黑/纯白，需求原话"太明显了" */
    BLOCK_MIN: 1.4,   /* 色块 / 纸底：低于这条块与纸糊在一起（实测 1.05 就是"块消失"） */
    BLOCK_MAX: 6,     /* 高于这条块变成刺眼亮条 */
    HUE_TOL: 12,      /* 同色相容差：降明度时允许的色相漂移（度） */
    ALPHA_EPS: 0.001  /* 判"不透明"的容差 */
  };

  /* ── ② 环境清单：凡是"随主题/深浅变"的东西，都必须在这张表上全量成立 ──
     五个命名主题（nord/tokyo/gruvbox/rosepine/catppuccin）**都是浅色**，
     浅/深由独立的 body.dark-mode 类控制 —— 这是 2026-10-18 把 tokyo 误当深色
     主题后写死在这里的，别再各自猜。 */
  var THEMES = ['', 'nord', 'tokyo', 'gruvbox', 'rosepine', 'catppuccin'];  /* '' = 默认主题 */
  var MODES = ['light', 'dark'];

  /* ── ③ 测量原语 ─────────────────────────────────────────────── */
  function parse(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s || s === 'transparent' || s === 'none') return { r: 0, g: 0, b: 0, a: 0 };
    /* color(srgb 0.23 0.26 0.35 [/ a]) —— color-mix() 的计算结果就是这种 0~1 浮点形式。
       ★ C81 就是漏了这条，ratio 变 NaN → 假红。 */
    var m = /^color\(\s*srgb\s+([^)]+)\)/.exec(s);
    if (m) {
      var q = m[1].replace('/', ' ').trim().split(/\s+/).map(parseFloat);
      return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: q.length > 3 ? q[3] : 1 };
    }
    /* rgb(r g b) / rgb(r, g, b) / rgba(..., a) —— 空格与逗号两种写法都要认 */
    m = /^rgba?\(([^)]+)\)/.exec(s);
    if (m) {
      var p = m[1].replace('/', ' ').split(/[\s,]+/).filter(function (x) { return x !== ''; }).map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    /* #rgb / #rrggbb / #rrggbbaa */
    m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map(function (c) { return c + c; }).join('');
      var n = function (i) { return parseInt(h.slice(i, i + 2), 16); };
      return { r: n(0), g: n(2), b: n(4), a: h.length >= 8 ? n(6) / 255 : 1 };
    }
    return null;
  }
  function hex2rgb(v) { return parse(v); }

  /* 半透明色叠到 bg 上（不做这一步，量到的"字/底"是拿没混的背景算的，数值不可信） */
  function flatten(fg, bg) {
    var a = fg.a == null ? 1 : fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a),
             b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function lum(c) {
    var v = [c.r, c.g, c.b].map(function (x) {
      x = x / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  /* 对比度。入参可以是字符串（自动解析）或 {r,g,b,a}；解析失败返回 NaN —— **NaN 必须显出来**，
     用 0 顶替会伪装成"真的只有 0:1"，让人去查根本不存在的配色问题。 */
  function contrast(a, b) {
    var ca = typeof a === 'string' ? parse(a) : a;
    var cb = typeof b === 'string' ? parse(b) : b;
    if (!ca || !cb) return NaN;
    var la = lum(ca), lb = lum(cb);
    if (la < lb) { var t = la; la = lb; lb = t; }
    return (la + 0.05) / (lb + 0.05);
  }

  function css(el, prop, pseudo) {
    if (!el) return '';
    return getComputedStyle(el, pseudo || null)[prop];
  }
  function alphaOf(v) { var c = parse(v); return c ? c.a : 0; }

  /* 元素自身的 字/底 对比度。底必须不透明（半透明会把纸色混进来，算出来的数没有意义）；
     返回 NaN 表示"量不到"，不许当成 0 —— 见上面对比度函数的说明。 */
  function elRatio(el) {
    if (!el) return NaN;
    var bg = parse(css(el, 'backgroundColor')), fg = parse(css(el, 'color'));
    if (!bg || !fg) return NaN;
    if (bg.a < 1 - TH.ALPHA_EPS) return NaN;
    return contrast(flatten(fg, bg), bg);
  }

  /* 色相（0~360）；无彩返回 -1。用来验证"同一色相降明度"，而不是拿灰黑硬压。 */
  function hue(c) {
    c = typeof c === 'string' ? parse(c) : c;
    if (!c) return -1;
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-6) return -1;
    var h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }
  function hueDiff(a, b) {
    var x = hue(a), y = hue(b);
    if (x < 0 || y < 0) return 0;      /* 无彩的比不了色相，不算违规 */
    var d = Math.abs(x - y) % 360;
    return d > 180 ? 360 - d : d;
  }

  /* ── ④ 环境切换：把"六主题 × 深浅"的现场准备与还原收成一处 ────────
     before() 在每一档之前调用（用例可以在这里造数/重画）；
     fn(label, isDark) 里只写断言。
     结束一定还原主题与深浅，并重画一次 —— 用例之间不互相污染。 */
  function withThemes(fn, before) {
    var el = document.body;
    var savedTheme = el.getAttribute('data-theme');
    var savedDark = el.classList.contains('dark-mode');
    var out = [];
    try {
      for (var i = 0; i < THEMES.length; i++) {
        for (var j = 0; j < MODES.length; j++) {
          var isDark = MODES[j] === 'dark';
          if (THEMES[i]) el.setAttribute('data-theme', THEMES[i]);
          else el.removeAttribute('data-theme');
          el.classList.toggle('dark-mode', isDark);
          if (before) before();
          out.push(fn((THEMES[i] || '默认') + '/' + (isDark ? '深' : '浅'), isDark));
        }
      }
    } finally {
      try {
        if (savedTheme) el.setAttribute('data-theme', savedTheme);
        else el.removeAttribute('data-theme');
        el.classList.toggle('dark-mode', savedDark);
        if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
      } catch (e) { /* 还原失败不该盖掉真正的断言结果 */ }
    }
    return out;
  }

  /* 日程表"收起"态下 .tb-paper 的背景被设成 transparent（折叠后不该留空描边），
     此时量纸色必然是 rgba(0,0,0,0) → 断言假红。折叠是用户的本地界面状态，
     与配色无关，所以量之前先强制展开，量完还原。 */
  /* ★ 展开必须动"真值"，不能只摘 class：
     折叠的真值只有 appData.settings.tbGridFolded 一处（01eA tbGridFolded：
     `!(settings.tbGridFolded === false)` —— **新建存档该字段是 undefined，
     也就是默认折叠**）。只 `classList.remove('is-folded')` 的话，下一次
     renderTimeBlockGrid() 会照真值把 is-folded 重新加回来，纸底随即变成
     rgba(0,0,0,0)，量的对比度全是废数。所以这里改真值 + 摘 class，量完还原。 */
  function forceUnfold() {
    var s = appData.settings;
    var had = Object.prototype.hasOwnProperty.call(s, 'tbGridFolded');
    var old = s.tbGridFolded;
    s.tbGridFolded = false;
    var sh = document.getElementById('tbShell');
    if (sh) sh.classList.remove('is-folded');
    var pp = document.querySelector('.tb-paper');
    if (pp) pp.classList.remove('is-folded');
    return function restoreFold() {
      if (had) s.tbGridFolded = old; else delete s.tbGridFolded;
      try { if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid(); } catch (e) {}
    };
  }

  /* ★ 进入「日程」页并展开：
     全新存档启动时活动视图是 view-timer，`#view-plan` 是 display:none 的，
     里面的纸量出来是 rgba(0,0,0,0)；折叠标记还同时挂在 `.tb-paper` 和
     `#tbGridWrap` 上（不止 `#tbShell`）。三处一起收拾，量完还原。
     返回 restore()：恢复原视图 + 原折叠真值。 */
  function enterPlan() {
    var prevView = null;
    var navs = [].slice.call(document.querySelectorAll('.view')).filter(function (v) {
      return v.classList.contains('active');
    });
    if (navs.length) prevView = navs[0].id.replace(/^view-/, '');
    if (typeof switchView === 'function') switchView('plan');
    var s = appData.settings;
    var had = Object.prototype.hasOwnProperty.call(s, 'tbGridFolded');
    var old = s.tbGridFolded;
    s.tbGridFolded = false;
    ['tbShell', 'tbGridWrap'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('is-folded');
    });
    var pp = document.querySelector('.tb-paper');
    if (pp) pp.classList.remove('is-folded');
    try { if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid(); } catch (e) { /* 渲染报错留给断言暴露 */ }
    return function restoreView() {
      if (had) s.tbGridFolded = old; else delete s.tbGridFolded;
      if (prevView && prevView !== 'plan' && typeof switchView === 'function') {
        try { switchView(prevView); } catch (e) {}
      }
    };
  }

  /* 取日程纸/灰块并保证"量得到"：折叠态或视图未激活 → 直接给一句人话，
     而不是让上层拿到 '' 再算出 NaN 去猜。 */
  function paperEl() {
    var el = document.querySelector('.tb-paper');
    if (!el) throw new Error('找不到 .tb-paper（日程网格没渲染？先 TC.enterPlan()）');
    if (el.offsetParent === null || el.getBoundingClientRect().height === 0)
      throw new Error('日程纸不可见（当前不在 view-plan 或网格折叠）→ 先 TC.enterPlan()');
    if (el.classList.contains('is-folded'))
      throw new Error('日程网格处于折叠态（.tb-paper.is-folded）→ 先 TC.enterPlan()');
    var bg = css(el, 'backgroundColor');
    if (!bg || bg === 'transparent' || /rgba\([^)]*,\s*0\s*\)$/.test(bg))
      throw new Error('纸底是透明的（' + bg + '）→ 先 TC.enterPlan()');
    return el;
  }
  function blockEl(sel) {
    var el = document.querySelector(sel || '.tb-paper-blk.is-unplanned');
    if (!el) throw new Error('找不到色块 ' + (sel || '.tb-paper-blk.is-unplanned'));
    return el;
  }

  return {
    TH: TH, THEMES: THEMES, MODES: MODES,
    parse: parse, hex2rgb: hex2rgb, flatten: flatten, lum: lum, contrast: contrast,
    css: css, alphaOf: alphaOf, elRatio: elRatio, hue: hue, hueDiff: hueDiff,
    withThemes: withThemes, forceUnfold: forceUnfold, enterPlan: enterPlan, paperEl: paperEl, blockEl: blockEl
  };
})();
