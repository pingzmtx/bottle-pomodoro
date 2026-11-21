// @layer: L2
/* ============================================================================
 * 主题配色引擎（多主题换肤） ｜症状：主题切换不生效 · 深色下颜色不对
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
 *   第 4 批 —— 0.3.1：applyTheme 末尾上报一次首屏底色（window.__bottleTint → 原生 ui.tint），
 *              零外观变化；只解决 App 冷启动时"窗口底板是旧色"的白闪。
 *   第 4b 批 —— 0.3.1 修补：把上报抽成唯一实现 reportTint() 并挂到 themeEngine，
 *              「改底色的入口」全部补齐：applyTheme（启动/切主题）、
 *              toggleDarkMode（切深色开关，主路径）、_applyAutoDark（跟随系统明暗）、
 *              applyBackupData（还原备份）。原先只有 applyTheme 上报，
 *              切完深色立刻杀进程重进仍会白闪 —— 那条路径根本不经过 applyTheme。
 *              依旧零外观变化：只上报，不写样式、不改 DOM、不碰业务状态。
 *
 * 函数索引（TOC）：_norm/current/reportTint/applyTheme/getTheme/setTheme/_esc/_cardHTML/renderCards/pick/init
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
   * 0.3.1：底色上报 —— **全项目唯一实现**（其它文件一律调 themeEngine.reportTint，
   * 不许复制第二份；改口径只改这里）。
   *
   * 干什么：把「当前第一屏底色」= body 的计算背景色 + 是否深色，交给原生存下来。
   *         原生存着它，下次冷启动先用它铺窗口底板 —— 否则深色用户重进 App
   *         会先看到一片近白（windowBackground 是旧的写死值）再跳成深色。
   * 为什么运行期读计算值：颜色只有一个真相源（CSS 变量），JS 不写死任何色值；
   *         主题 × 明暗 12 种组合，这里读到的永远等于 CSS 此刻真正画出来的那个颜色。
   * 为什么用 getComputedStyle 当场读：class / data-theme 刚改完时它会强制一次
   *         样式重算，拿到的是**改完之后**的值（body 上没有 background 过渡，不会读到中间态）。
   * 安全性：只上报，不写样式 / 不改 DOM / 不碰业务状态。浏览器 / PWA / 无桥时
   *         __bottleTint 不存在 → 直接短路；任何异常都在 try 里静默吞掉，
   *         上报永远不许影响主题与开关本身。
   * 返回：true = 确实交给桥了；false = 无桥或异常（仅供自检/调试，调用方可忽略）。
   * ------------------------------------------------------------------ */
  function reportTint() {
    try {
      if (!window.__bottleTint || !document.body) return false;
      /* 调用写成一行是有意的：verify.sh 靠「桥名紧跟 getComputedStyle」这条 grep 数上报
         调用点，拆行会让那条判据数出 0 处（门禁静默失效比门禁报错更危险）。
         注意这段注释里也不要出现那个连续串，否则 grep 会把它当成第 2 处调用。 */
      window.__bottleTint(getComputedStyle(document.body).backgroundColor, document.body.classList.contains('dark-mode'));
      return true;
    } catch (e) { return false; }
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
    /* 0.3.1：换完主题立刻上报一次当前底色（走上面那份唯一实现）。
       注意：applyTheme 只覆盖「启动」与「切主题」两条路径，**不覆盖**切深色开关
       （toggleDarkMode）、跟随系统明暗（_applyAutoDark）、还原备份（applyBackupData），
       那三处各自在改完 body.dark-mode 之后调 reportTint，谁也不许漏。 */
    reportTint();
    return key;
  }

  function getTheme() { return current(); }

  /* 切换主题：写设置 + 落盘 + 立即应用。
     注意 saveSettings 的行为（见 engine_ui.js:717）：它是**整体重建**
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
    init: init,
    /* 0.3.1：底色上报的唯一出口。凡是不经过 applyTheme 就改了底色的地方
       （切深色开关 / 跟随系统明暗 / 还原备份）都调它，不再各自写一遍。 */
    reportTint: reportTint
  };

  /* 自启：DOM 就绪后应用一次（幂等，重复调用无副作用） */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  } else {
    setTimeout(init, 0);
  }
})();
