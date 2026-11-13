/* ============================================================================
 * 主题配色引擎（多主题换肤）
 * ----------------------------------------------------------------------------
 * 架构：**主题(Theme) × 模式(Mode) 正交分离**
 *   · 主题（body[data-theme=...]）= 管「性格 / 色相」
 *   · 模式（body.dark-mode）    = 管「明暗 / 对比」，现有机制，一行不改
 * 两者可自由组合：北欧+浅色 / 北欧+深色 / 东京夜+浅色 ……
 * body.dark-mode 在本项目有 173 处引用，正交架构让这 173 处一处都不用改，
 * 深浅逻辑零回归风险。
 *
 * 主题只定义**语义令牌**（--bg / --text / --primary …），不直接写颜色名，
 * 换主题不刷新整站 CSS，变量一改全站自动响应、点一下即时生效、不跳页。
 *
 * 注意：本项目有 14 个 `[style*="#色值"]` 属性选择器（约 template.html @626-637），
 * 它们刻意匹配**内联字面量**、不匹配变量。本引擎**不碰它们**，
 * 它们匹配的是 HTML 内联样式，无论主题怎么换都照常生效。
 *
 * 批次记录：
 *   第 1 批 —— 骨架（零外观变化，证基础设施无害）
 *   第 2 批 —— Nord 主题 CSS 令牌 + 顶栏渐变令牌化
 *   第 3 批 —— 本文件：主题注册表 + 设置页色卡网格 + 点击实时切换
 *
 * 函数索引（TOC）：_norm/current/applyTheme/getTheme/setTheme/_esc/_cardHTML/renderCards/pick/init
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__themeEngineReady) return;
  window.__themeEngineReady = true;

  /* --------------------------------------------------------------------
   * 主题表。
   * meta 里的 swatch 是给设置页「色卡预览」用的三个代表色：
   * [背景色, 主色, 强调色] —— 用户选主题时看的是这三个色块，不是主题名。
   * 这里的色值必须**用主题自己的颜色**（写死），不能用 var(--primary) 之类的
   * 活令牌 —— 否则所有色卡都会跟着当前主题一起变色，预览就失去意义了。
   * 新增主题时只需：① 在 template.html 加 body[data-theme="x"] CSS 块；
   * ② 在此表加一条。两处对上即可，无需改别的代码。
   * ------------------------------------------------------------------ */
  var THEMES = {
    default:   { name: '番茄原色', tag: '暖橙 · 经典', swatch: ['#FDF6EC', '#E85D3A', '#2E9E5B'] },
    nord:      { name: '北欧',     tag: '冷冽 · 克制', swatch: ['#ECEFF4', '#5E81AC', '#7A9E6A'] },
    tokyo:     { name: '东京夜',   tag: '深邃 · 霓虹', swatch: ['#1A1B26', '#7AA2F7', '#BB9AF7'] },
    gruvbox:   { name: '复古灰',   tag: '暖褐 · 怀旧', swatch: ['#FBF1C7', '#D65D0E', '#98971A'] },
    rosepine:  { name: '玫瑰松',   tag: '柔粉 · 雅致', swatch: ['#FAF4ED', '#EB6F92', '#31748F'] },
    catppuccin:{ name: '卡布奇诺', tag: '奶咖 · 柔和', swatch: ['#EFF1F5', '#8839EF', '#40A02B'] }
  };

  var DEFAULT_THEME = 'default';
  var ATTR = 'data-theme';

  /* 把任意输入规整成一个合法主题 id；不合法一律回落 default */
  function _norm(id) {
    if (!id || typeof id !== 'string') return DEFAULT_THEME;
    var k = id.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(THEMES, k) ? k : DEFAULT_THEME;
  }

  /* 读取当前生效的主题 id（以 DOM 为准，DOM 没有则回落默认） */
  function current() {
    try {
      var v = document.body && document.body.getAttribute(ATTR);
      return _norm(v);
    } catch (e) { return DEFAULT_THEME; }
  }

  /* --------------------------------------------------------------------
   * 应用主题：只做一件事 —— 把 id 写到 body[data-theme]。
   * 颜色全部由 CSS 里的 body[data-theme="x"] 规则块负责，JS 不注入任何样式。
   * 这样"主题定义"永远只有 CSS 一个真相源，JS 不会和 CSS 打架。
   * ------------------------------------------------------------------ */
  function applyTheme(id) {
    var key = _norm(id);
    try {
      if (!document.body) return key;
      document.body.setAttribute(ATTR, key);
    } catch (e) { /* 静默：主题失败绝不影响主流程 */ if (window.__silent) window.__silent(e, '0E:applyTheme'); }
    return key;
  }

  function getTheme() { return current(); }

  /* 切换主题：写设置 + 落盘 + 立即应用。
     注意 saveSettings 的行为（见 01e_engine_ui.js:717）：它是**整体重建**
     appData.settings 对象，所以新字段必须同时加进 01b 的 defaultSettings，
     否则会被抹掉 —— 这是本项目的一条既有陷阱，其中已在 01b 补了 theme 字段。
     落盘走既有 saveData 单通道，不自己写 localStorage，避免双写回流。 */
  function setTheme(id) {
    var key = applyTheme(id);
    try {
      if (typeof appData !== 'undefined' && appData && appData.settings) {
        appData.settings.theme = key;
      }
      saveData();
    } catch (e) { /* 静默 */ if (window.__silent) window.__silent(e, '0E:setTheme'); }
    return key;
  }

  /* --- 以下是第 3 批：设置页色卡 UI ---------------------------------- */

  /* HTML 转义：主题名目前都是内置常量，但用户可能改 localStorage 塞脏数据，
     走渲染路径的字符串一律转义，避免间接的 XSS 面。 */
  function _esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 单张色卡的 HTML。
     色卡结构 = 主题背景色铺底 + 主色/强调色两个圆点 —— 比三色横条更像
     「主题缩略图」，也更能反映该主题的实际观感。三色全部内联写死，
     用主题自身的颜色（见文件头说明：不能用活令牌，否则预览会跟着当前主题变）。 */
  function _cardHTML(id) {
    var t = THEMES[id];
    if (!t) return '';
    var sw = t.swatch || ['#EEE', '#888', '#666'];
    var on = (id === current());
    return '<button type="button" class="theme-card' + (on ? ' on' : '') + '"' +
           ' data-theme-id="' + _esc(id) + '"' +
           ' onclick="themeEngine.pick(\'' + _esc(id) + '\')"' +
           ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
           ' aria-label="切换到主题：' + _esc(t.name) + '">' +
             '<span class="theme-swatch" style="background:' + _esc(sw[0]) + '" aria-hidden="true">' +
               '<i style="background:' + _esc(sw[1]) + '"></i>' +
               '<i style="background:' + _esc(sw[2]) + '"></i>' +
             '</span>' +
             '<span class="theme-meta">' +
               '<span class="theme-name">' + _esc(t.name) + '</span>' +
               '<span class="theme-tag">' + _esc(t.tag || '') + '</span>' +
             '</span>' +
           '</button>';
  }

  /* 渲染整个网格。幂等：重复调用只是重写 innerHTML。 */
  function renderCards() {
    var box = document.getElementById('themeGrid');
    if (!box) return false;
    var html = '';
    for (var k in THEMES) {
      if (Object.prototype.hasOwnProperty.call(THEMES, k)) html += _cardHTML(k);
    }
    box.innerHTML = html;
    return true;
  }

  /* 点击切换：应用 + 落盘 + 只更新选中态（不整格重绘，保住按压动画手感） */
  function pick(id) {
    var key = setTheme(id);
    var box = document.getElementById('themeGrid');
    if (!box) return key;
    var cards = box.querySelectorAll('.theme-card');
    for (var i = 0; i < cards.length; i++) {
      var isOn = cards[i].getAttribute('data-theme-id') === key;
      cards[i].classList.toggle('on', isOn);
      cards[i].setAttribute('aria-pressed', isOn ? 'true' : 'false');
    }
    return key;
  }

  /* 启动初始化：应用已存主题 + 渲染色卡。
     用 setTimeout 0 让它在主初始化之后跑，避免和 01b/01g 的启动顺序打架。
     色卡可能因设置页尚未插入 DOM 而找不到容器，此时静默跳过；
     设置页渲染函数会再调一次 renderCards() 兜底（见 01e applySettingsToUI）。 */
  function init() {
    try {
      var saved = DEFAULT_THEME;
      if (typeof appData !== 'undefined' && appData && appData.settings && appData.settings.theme) {
        saved = appData.settings.theme;
      }
      applyTheme(saved);
      renderCards();
    } catch (e) { /* 静默 */ if (window.__silent) window.__silent(e, '0E:init'); }
  }

  window.themeEngine = {
    THEMES: THEMES,
    DEFAULT: DEFAULT_THEME,
    applyTheme: applyTheme,
    setTheme: setTheme,
    getTheme: getTheme,
    current: current,
    renderCards: renderCards,
    pick: pick,
    init: init
  };

  /* 自启：DOM 就绪后应用一次（幂等，重复调用无副作用） */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  } else {
    setTimeout(init, 0);
  }
})();
