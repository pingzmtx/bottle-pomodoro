/* 01eA_ui_timeblock.js · 时间块计划板（Time Blocking Grid）
 * ------------------------------------------------------------------
 * 定位：**「计划 vs 实际」的对照工具**，不是日历。
 *   计划块 = 计划卡上的「提醒时间(=开始) → 预计结束」，浅色虚线；
 *   实际块 = 专注记录（records，按 todoId 关联）落到当天的时间段，深色实心，可多段；
 *   截止   = 只画一个小旗子，绝不画成整块；
 *   当前时刻 = 整行画一条横线（不再给格子描边：两列会同时被圈中，变成两个孤立的红框）。
 * 视图层只做「像素 + 颜色」；分钟数 / 多轨分列 / 吸附全在 00_pure_core.js（tb* 系列）。
 * 入口：常驻在计划列表上方（模板 #tbShellHost），由 01e_engine_ui.js 的 renderTodos
 *       调用本文件的 renderTimeBlockGrid()（本文件不改它的内部状态）。
 * 函数索引（TOC）：tbIsDark/tbRepaintForTheme/install/tbResetOcc/tbPaperLayout/tbStr/tbHash/tbAssignColorsFor/tbColorKeyOf/tbPalette/tbAlpha/tbTint（+47 更多）
 */
(function () {
  'use strict';

  /* 手帐色板：纯核心不管配色，色板只此一份。
     ① **色相**：16 个色相沿色相环均分（约 22° 一档：红→琥珀→黄绿→绿→青→蓝→紫→品红）；
     ② **不高饱和**：统一压彩度、提明度 —— 同一套"纸感"色，谁都不比谁亮，放在一起不打架；
     ③ **不接近**：分配时按「步长 7」跳（16 与 7 互质）→ 走满 16 个才回起点，
        相邻两项恒隔约 158°，不会挤在同一个色相里。
     每色四档，**同一色相只差明度/彩度**：
       light → 预计块底；solid → 实际块底 / 列表色点；
       dark  → 压在上面（light 底）的文字与描边；ink → 压在实色（solid 底）上的文字与描边。
     ★ 补 `ink` 并重算 `dark`：**旧 dark 只够 2.2~2.8:1，全色板的块内文字都看不清**。
       原因不是"配色不好看"，而是这几个档的**明度关系**定的：
       solid 底明度约 0.33、light 底约 0.72，
       ① 在 solid 上写白字最多 2.7:1（白字救不回来，只能改用深字）；
       ② 在 light 上写旧 dark 只有 3.9~4.6:1（差一点点，把 dark 再压暗就够）。
       现在 dark / ink 都是「同一色相降明度、彩度压到 0.8、刚好 4.7:1」算出来的，
       既达标又不刺眼（没有纯黑纯白）。算法与断言见 tools/tests/c81_unplanned_contrast.js。
       ⚠️ solid / light **一个字没动** —— 它们才是计划的"身份色"，动它们等于让老计划集体变色；
       这次只动文字/描边档（全库只有 01eA 的两处 style 在读）。
     ★ key 一经分配即写回数据（t.tbColor），**只增不改**：
       改已有 key 的色值会让老计划集体变色；扩色板请**追加**新 key，别动老 key。 */
  /* ★ 每一档的文字色（dark / ink）都是**按对比度算出来的**，不是手挑的：
       ink（实际块实色底上的字）≥ 6:1，dark（预计块浅底上的字）≥ 6:1。
       旧表里的字色全部只有 4.7:1 —— 正好卡在 AA 线上，竖排粗体在中灰底上看着就是"灰字糊一块"。
       改色时用 tools/palette_contrast.py 重算，别手调（手调必回到 4.7）。 */
  const TB_PALETTE = [
    { key: 'v4coral', solid: '#d18b77', light: '#eac9bf', dark: '#693b2d', ink: '#2e1a14',
      dPlanBg: '#6D3F32', dPlanInk: '#E7C9C0', dActBg: '#8F4D3B', dActInk: '#F0DED9' },
    { key: 'v4amber', solid: '#c99a63', light: '#ead9c4', dark: '#624a2c', ink: '#302315',
      dPlanBg: '#5E472C', dPlanInk: '#E2CDB4', dActBg: '#795932', dActInk: '#ECE0D1' },
    { key: 'v4gold', solid: '#bbab60', light: '#d8cea4', dark: '#4d4527', ink: '#312c19',
      dPlanBg: '#524B2C', dPlanInk: '#D7D0AB', dActBg: '#695F33', dActInk: '#E6E2CC' },
    { key: 'v4olive', solid: '#a3ab5e', light: '#dcdfc2', dark: '#4e5131', ink: '#272919',
      dPlanBg: '#4A4D30', dPlanInk: '#CED2AE', dActBg: '#5E6239', dActInk: '#E1E3CF' },
    { key: 'v4lime', solid: '#8eac68', light: '#bdcfa7', dark: '#3a462c', ink: '#212719',
      dPlanBg: '#434F33', dPlanInk: '#C6D4B5', dActBg: '#53653D', dActInk: '#DDE5D3' },
    { key: 'v4moss', solid: '#7fae72', light: '#cee0c9', dark: '#3d5436', ink: '#1c2719',
      dPlanBg: '#3B5135', dPlanInk: '#C1D6BB', dActBg: '#496740', dActInk: '#DAE5D6' },
    { key: 'v4fern', solid: '#64af76', light: '#a4d0af', dark: '#2a4631', ink: '#16251a',
      dPlanBg: '#32523A', dPlanInk: '#B7D7BF', dActBg: '#3C6947', dActInk: '#D5E7D9' },
    { key: 'v4jade', solid: '#55b096', light: '#bee1d7', dark: '#2e544a', ink: '#152621',
      dPlanBg: '#2E5248', dPlanInk: '#B1D8CD', dActBg: '#37685A', dActInk: '#D1E7E0' },
    { key: 'v4teal', solid: '#5fbcc3', light: '#a5dade', dark: '#254d50', ink: '#193336',
      dPlanBg: '#2A5154', dPlanInk: '#A9D8DB', dActBg: '#30676B', dActInk: '#CCE7E9' },
    { key: 'v4sky', solid: '#6ba7d4', light: '#c7deef', dark: '#2a516e', ink: '#142533',
      dPlanBg: '#2B4E68', dPlanInk: '#B8D3E7', dActBg: '#326389', dActInk: '#D4E4EF' },
    { key: 'v4azure', solid: '#7d9cd8', light: '#c8d5ee', dark: '#314979', ink: '#141e32',
      dPlanBg: '#334A78', dPlanInk: '#C2CFEA', dActBg: '#3B5EA0', dActInk: '#DBE2F1' },
    { key: 'v4violet', solid: '#8f97dc', light: '#d4d7f2', dark: '#3c4496', ink: '#181c3c',
      dPlanBg: '#3C448B', dPlanInk: '#C9CDEC', dActBg: '#4A55B9', dActInk: '#DFE1F3' },
    { key: 'v4plum', solid: '#a98bd6', light: '#ded2ef', dark: '#5a3c86', ink: '#211631',
      dPlanBg: '#583D81', dPlanInk: '#D7CAEA', dActBg: '#724AAE', dActInk: '#E6DFF2' },
    { key: 'v4orchid', solid: '#c887cf', light: '#ead1ed', dark: '#6d3873', ink: '#2f1832',
      dPlanBg: '#69396E', dPlanInk: '#E3C7E6', dActBg: '#894391', dActInk: '#EDDCEE' },
    { key: 'v4magenta', solid: '#d489b6', light: '#eed0e2', dark: '#76365d', ink: '#38192b',
      dPlanBg: '#71375A', dPlanInk: '#E8C6DA', dActBg: '#964174', dActInk: '#F0DDE8' },
    { key: 'v4rose', solid: '#d98b93', light: '#f1d3d6', dark: '#80353d', ink: '#3b191c',
      dPlanBg: '#79363D', dPlanInk: '#EAC7CA', dActBg: '#9F3F49', dActInk: '#F1DDDF' },
  ];
  /* 当前是否深色模式。**唯一判据是 body.dark-mode**（toggleDarkMode 只改它）：
     不能读 appData.settings.darkMode —— 那是数据源，与"页面此刻画成什么样"可能不同步。 */
  function tbIsDark() {
    return !!(document.body && document.body.classList && document.body.classList.contains('dark-mode'));
  }
  /* ★ 深色档只在渲染时读一次（inline 写进 style），所以 dark-mode 变了必须重画。
     改这个类的地方不止 toggleDarkMode —— 03_enh572 的「跟随系统深色」会直接 toggle class，
     三个分支都不经过开关函数 → 以前系统切深色时日程块保持浅色档、戳在深色纸底上。
     这里用 class 观察者统一兜住：**改 class 的人不用知道要重画**，以后新增入口也不会漏。
     单点规则的代价只有一次多余重画（手动开关是同步重画 + 观察者再画一次），可以接受。 */
  function tbRepaintForTheme() {
    const pv = document.getElementById('view-plan');
    if (!pv || !pv.classList.contains('active')) return;
    if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
  }
  (function tbWatchDarkMode() {
    if (typeof MutationObserver !== 'function') return;
    function install() {
      if (!document.body) return;
      let last = tbIsDark();
      const mo = new MutationObserver(function () {
        const now = tbIsDark();
        if (now === last) return;
        last = now;
        tbRepaintForTheme();
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
    /* 本文档没有显式 <body> 标签（隐式 body），脚本先跑时 document.body 还是 null，
       直接 observe 会静默不生效 —— 那时改等 DOMContentLoaded 再装。 */
    if (document.body) install();
    else document.addEventListener('DOMContentLoaded', install, { once: true });
  })();
  const TB_COLOR_STRIDE = 7; /* 16 与 7 互质 → 走满一圈才重复，且每次跨约 158° */
  /* 手帐式矩阵（日视图）：横向是钟点、纵向一条一条是任务，色块横跨自己占的时段。
     默认窗口取「一天真正会用到的那十几个小时」，避免 00:00~06:00 一片空白把格子挤没；
     有任务排到窗口外时自动向两端扩到整点。 */
  /* 「日程规划」网格（日视图）＝ 照抄纸质表：
     ① 竖着数每小时 6 格（一列 6 行，每格 10 分钟）——这是**看得见的格线**；
     ② 并排两列 = 每小时里先「预计」列、再「实际」列；
     ③ 上面一排 06~14、下面一排 15~23（两段各 9 个钟点，一屏放得下，不用滚）。
     ★ 但 grid 的**纵向轨道**是 60 行/小时（1 行 = 1 分钟），色块按分钟定位：
       6 个 10 分钟格只是"每个跨 10 行"，格线看起来一模一样，却换来分钟级精度
       （5 分钟 = 半格、25 分钟 = 2.5 格、1 秒 = 一条细线）。 */
  /* 2026-11-04 用户要求「上半部分加一个 6 点、下半部分加一个 11 点」：
     上带提前到 06:00、下带延到 23:00，两带各 9 个钟点（18 列）。
     格数不另写常量：TB_PAPER_HOURS 由本数组长度推导，改这里就够。 */
  const TB_PAPER_BANDS = [[6, 7, 8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21, 22, 23]];
  const TB_PAPER_HOURS = TB_PAPER_BANDS[0].length; /* 每段钟点数（9），别手写 8 */
  const TB_PAPER_SLOT_MIN = 10; /* 一格 = 10 分钟（可见格线） */
  const TB_PAPER_SLOTS = 6; /* 每小时 6 格 */
  const TB_PAPER_ROWS = 60; /* 每小时 60 行网格轨道 = 1 行 1 分钟（★ 必须跟 CSS 的 repeat(60, …) 一致） */
  /* 一行（= 1 分钟）的像素高，跟 CSS 的 --tb-min-h（= --tb-cell-h / 10 = 3px）对齐。
     这里只用来估"这个块放得下几个字"，不参与定位 —— 定位一律交给 grid 算。 */
  const TB_PAPER_MIN_H = 3;
  const TB_PAPER_LANES = 2; /* 每个钟点并排两列：0=预计 1=实际 */
  /* 一个钟点恒为 2 列（预计 / 实际），宽度与格子严格一一对应。
     不按「撞车就把列对半劈」处理：412px 屏上劈成 4 条细列时每列只剩 ~11px，
     色块细得像头发丝、看不出颜色，且列数与命中判定极易对不上，点哪儿都偏。
     真的同列撞车时不再挤宽度，改成「后一个块画成白底描边」（见 tbPaperTodoHtml）。 */
  const TB_PAPER_COLS_PER_HOUR = TB_PAPER_LANES;
  /* 撞车判定只需要读，不需要占位；保留这个空函数是为了不动调用点的结构。 */
  function tbResetOcc() {}

  /* 先把这一屏所有块整体排一遍，再渲染。 */
  function tbPaperLayout(items) {
    tbResetOcc();
    const list = items || [];
    const segKey = function (sg) { return sg.band + ':' + sg.hi + ':' + sg.lane; };
    list.forEach(function (it) {
      it.segs = [];
      for (let band = 0; band < TB_PAPER_BANDS.length; band++) {
        tbPaperSegs(band, it.lane, it.start, it.end).forEach(function (sg) {
          it.segs.push({
            band: band, lane: it.lane, hi: sg.hi, row: sg.row, span: sg.span
          });
        });
      }
    });
    /* 不做列打包：一块占满它自己那一列（预计列 / 实际列），宽度 100%。
       「同一段时间做过两件事」由「同一任务多段 → 多个块」表达（见 tbActualOf），
       与「把一列横着切开」无关 —— 在 22px 宽的列上并排摆成 1/n 宽只会更难读。 */
    list.forEach(function (it) {
      it.segs.forEach(function (sg) {
        sg.col = tbPaperColOf(sg.hi, sg.lane);
        sg.colSpan = 1;
      });
    });
    return list;
  }
  /* 格子高度只由 CSS 决定（.tb-paper-grid 的 --tb-cell-h / --tb-min-h）。
     不要在 JS 里往 grid 写内联 height：那会盖掉 CSS 行高，60 行被挤成一条，色块和格线糊在一起。 */

  let _tbDate = null; /* 当前锚点日（日视图=当天；周视图=所在周） */
  let _tbDrag = null; /* 拖拽会话 */
  /* 日程月历（选日期）的两份缓存：番茄数合计 / 有一次性排期的日子。
     只在打开月历那一刻算一次（tbOpenDatePicker 里清空），翻月不再重复扫记录。 */
  let _tbCalPomo = null;
  let _tbCalOneOff = null;

  /* ---------- 小工具 ---------- */
  function tbStr(s) {
    return String(s == null ? '' : s);
  }
  function tbHash(str) {
    let h = 0;
    const s = tbStr(str);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return h;
  }
  /* 颜色：优先用任务上存的 tbColor，其次按「标签 → 标题 → id」稳定散列，保证同一任务永远同色 */
  /* ---------- 自动配色 ----------
     每个任务自动配一个色，一眼能分清。三层：
       ① 手动在编辑器里点过的色（t.tbColor）永远优先，且**不能被自动逻辑抢走**；
       ② 没手动指定过的，以任务 id 为种子定一个起点色（id 稳定 → 颜色不随改标题而跳）；
       ③ 同一天里若撞车，就顺延到下一个没被占的色 —— 保证同屏不重色。
     不用「拿 tag 或 title 去哈希取色」：那会让同一个 tag 的计划全染成一个色，
     且色桶太少、同屏两个任务撞色很常见。
     分配结果写回 t.tbColor 并落盘，所以颜色一旦定下就固定，不会每次刷新乱跳。 */
  function tbAssignColorsFor(list) {
    const n = TB_PALETTE.length;
    const valid = {};
    TB_PALETTE.forEach(function (p) { valid[p.key] = true; });
    const userPicked = [];
    const autoList = [];
    (list || []).forEach(function (t) {
      if (!t) return;
      /* 旧色板遗留的 key（amber/lime/…）一律作废，走自动重排 */
      if (t.tbColor && valid[t.tbColor]) userPicked.push(t);
      else { if (t.tbColor) t.tbColor = ''; autoList.push(t); }
    });
    const used = {};
    const take = function (key) {
      if (!key || used[key]) return false;
      used[key] = true;
      return true;
    };
    /* ① 手动指定的先占位（撞了就只留第一个，后面那个退回自动） */
    userPicked.forEach(function (t) {
      if (!take(t.tbColor)) t.__tbColorDrop = true;
    });
    /* ②③ 自动分配：在色板上按「步长 STRIDE」跳着走，前后两个任务隔半个色轮。
       起点由当天第一个任务散列决定 —— 换一天换一组开场色，但同一天内稳定。
       正常路径也必须 +STRIDE：只 +1 就是顺着色相环一个个排下来，
       同屏会出现「粉红挨着玫红」这类过于接近的组合。
       16 与 7 互质 → 相邻两个恒隔约 158°、走满 16 个才回起点。 */
    let dirty = false;
    const head = autoList.length ? String(autoList[0].id != null ? autoList[0].id : '') : '';
    let cursor = tbHash(head) % n;
    autoList.forEach(function (t) {
      let key = '';
      for (let i = 0; i < n; i++) {
        const ci = (cursor + i * TB_COLOR_STRIDE) % n;
        const cand = TB_PALETTE[ci].key;
        if (!used[cand]) { key = cand; cursor = (ci + TB_COLOR_STRIDE) % n; break; }
      }
      /* 当天超过 16 个任务才会走到这里：允许复用，从光标位直接取 */
      if (!key) key = TB_PALETTE[cursor % n].key;
      used[key] = true;
      if (t.tbColor !== key) { t.tbColor = key; dirty = true; }
    });
    /* 手动色撞车落选的那一个：也给它补一个空位，别让它没色 */
    userPicked.forEach(function (t) {
      if (!t.__tbColorDrop) return;
      delete t.__tbColorDrop;
      for (let i = 0; i < n; i++) {
        const cand = TB_PALETTE[(cursor + i * TB_COLOR_STRIDE) % n].key;
        if (!used[cand]) { t.tbColor = cand; used[cand] = true; cursor = (cursor + i * TB_COLOR_STRIDE + 1) % n; dirty = true; return; }
      }
    });
    if (dirty) saveData();
  }

  function tbColorKeyOf(t) {
    if (!t) return TB_PALETTE[0].key;
    if (t.tbColor) {
      for (let i = 0; i < TB_PALETTE.length; i++) if (TB_PALETTE[i].key === t.tbColor) return t.tbColor;
    }
    /* 以 id 为种子：颜色跟着任务走，改标题/改标签都不会变色 */
    return TB_PALETTE[tbHash(String(t.id != null ? t.id : (t.title || ''))) % TB_PALETTE.length].key;
  }
  function tbPalette(key) {
    for (let i = 0; i < TB_PALETTE.length; i++) if (TB_PALETTE[i].key === key) return TB_PALETTE[i];
    return TB_PALETTE[0];
  }
  /* 十六进制 + 透明度 → rgba()（视觉规范：计划浅、实际深，同一色相） */
  function tbAlpha(hex, a) {
    const h = tbStr(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  /* 把实色按比例兑白 —— 得到不透明的浅色（而不是 rgba）：
     不透明才不会让底下的格线透上来，那正是"糊"的来源。 */
  function tbTint(hex, whitePct) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return hex;
    const k = Math.max(0, Math.min(1, whitePct));
    const out = [0, 2, 4].map(function (i) {
      const v = parseInt(h.substr(i, 2), 16);
      const m = Math.round(v + (255 - v) * k);
      return ('0' + m.toString(16)).slice(-2);
    });
    return '#' + out.join('');
  }
  function tbAnchorDate() {
    if (!_tbDate) _tbDate = new Date();
    return _tbDate;
  }
  /* 本周一（中国习惯周一开头） */
  function tbWeekStart(d) {
    const dt = new Date(d.getTime());
    const dow = (dt.getDay() + 6) % 7;
    dt.setDate(dt.getDate() - dow);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }
  function tbDateStr(d) {
    return getDateStr(d);
  }
  /* 计划开始日：'YYYY-MM-DD'；没排期返回 '' */
  function tbStartDateOf(t) {
    const info = todoEstInfo(t, appData.settings);
    return info && info.start ? tbStr(info.start).slice(0, 10) : '';
  }
  /* 视图窗口内的任务。
     ★ 取数口径 = 「这条计划在**这一天是否生效**」，判定交给 00_pure_core 的 todoOccursOn
       （它复用了项目里唯一的重复规则运算 todoRepeatMatches，这里不另写一套）。
       所以一条设了「每天 / 每周 / 每隔 N 天」的计划，看**任意一天**都能画出当天的块，
       而不是只在首次排期那天有块。
     ★ 块时段仍然由 tbBlockOf 从 remindAt 的**钟点**算出，与"当天首次设置"时同一起止
       —— 同一条计划在哪一天看，都是同一个钟点、同一段时长。
     ★ 这里**一个字都不写数据**：渲染层按规则**算出**当天要画的块，
       绝不往 appData.todos 里塞「未来那几天」的副本（那会污染存档、导出也多出凭空条目）。
     ★ 已完成的任务**不剔除**：勾完之后计划块留在原处（画成"已完成"的样子），
     右边实际列冒出真实记录的那一段。计划归计划、记录归记录，两条互不抹掉。 */
  function tbTodosInRange(dates) {
    const dd = (dates || []).map(function (d) { return tbStr(d).slice(0, 10); });
    if (!dd.length) return [];
    return (appData.todos || []).filter(function (t) {
      if (!t) return false;
      const sd = tbStartDateOf(t);
      for (let i = 0; i < dd.length; i++) {
        /* ★ 不能再用 todoOccursOn：没有主段、只有额外段的计划，remindAt 为空 →
           todoOccursOn 恒 false → 数据写了却永远不在网格上出现。 */
        if (dd[i] && todoHasAnyBlock(t, dd[i], sd)) return true;
      }
      return false;
    });
  }

  /* 历史那天的「计划」：计划被删/被清排期之后，靠 01d 冻结的排期快照补位。
     ★ 只有"已经不在 appData.todos 里"的才补 —— 计划还在列表里时以活对象为准，
       用户改了时间就该显示改后的，不能让快照抢了新值（todoSchedPseudoTodos 负责判重）。
     ★ 伪任务只读：tbBlockOf / 配色原样复用，但点它不跳计划卡（见 tbFocusPlan）。 */
  function tbHistTodosOn(dateStr, liveTodos) {
    const log = appData.todoSchedLog;
    if (!log || typeof log !== 'object') return [];
    const day = log[String(dateStr).slice(0, 10)];
    if (!Array.isArray(day) || !day.length) return [];
    /* ★ live 的含义是「**这一天**已经有活对象在画块的 id」，不是"这个 id 还活着"。
       两者的差别就是 F 场景：一次性计划排期过期被清回未排期（任务还在列表里，
       但那天它算不出任何钟点）—— 按"还活着"过滤，快照就被挡掉，块凭空少一块。
       tbTodosInRange 与网格画块同一个判定（todoOccursOn），所以用它做 live 名单。 */
    const live = {};
    (liveTodos || []).forEach(function (t) {
      if (!t || t.id == null) return;
      /* ★ 光"算不算这一天"不够，还要确认它这天**真的画得出块**。
         todoHasAnyBlock 里那半个 todoOccursOn 只答「重复规则这天命中」——
         对「没有主段、只有额外段」的重复计划它恒 true（没有 remindAt 就没有起点，
         规则照样命中），可平移之后额外段早过期了，块数其实是 0。
         这种「命中但一笔不画」的若被当成 live，下面的快照就被它挡掉，
         昨天的块再次凭空消失。 */
      if (tbBlocksOf(t, appData.settings, dateStr).length === 0) return;
      live[String(t.id)] = 1;
    });
    return todoSchedPseudoTodos(day, live);
  }
  /* 计划列表（01eC 的 renderTodos）与网格「同一天」的取数口径。
     ★ 判定只有这一处：01eC 不许自己重造一套归日逻辑，否则列表和网格迟早对不上。
     ★ 不写任何数据：按规则**算出**三组，与 tbTodosInRange 同口径。
     三组语义（顺序即渲染顺序）：
       day     —— 当天够得着的安排 = 这天命中的（todoOccursOn，与网格画块同一判定，
                  含跨天/重复命中）**外加**生效中的重复计划（规则已开始、未过期，
                  哪怕这天不命中）。后者是长期约定，网格只在命中的日子画块，
                  列表必须让它天天够得着（行内改规则/勾完成/跳过），否则每周三的
                  计划在其余六天无从管理——改版前它一直在列表里。
       carry   —— 之前没做完的（!done 且开始日期早于当天）。UI 里白纸黑字承诺
                  「未完成的任务会一直保留在这里」—— 严格按天过滤会让昨天没做完的
                  任务从今天视图消失，那是数据丢失般的观感，所以单列一组而不混排。
       undated —— 没设开始时间的一次性计划（UI 一等状态「未设提醒/开始」），
                  不属于任何一天，不随日期变；哪天都能看到、哪天都能清。 */
  function tbTodoSplitForDate(ds) {
    const s = String(ds == null ? getDateStr(tbAnchorDate()) : ds).slice(0, 10);
    const inDay = {};
    if (s) tbTodosInRange([s]).forEach(function (t) { inDay[String(t.id)] = 1; });
    /* planDate 命中查看日也算「这天的事」（2026-11-06）：在日程表那天点＋新建的计划
       只记归属、不画块，光看块会把它漏掉 —— 用户切到那天就该看见自己刚建的。 */
    if (s) {
      (appData.todos || []).forEach(function (t) {
        if (t && String(t.planDate || '').slice(0, 10) === s) inDay[String(t.id)] = 1;
      });
    }
    /* 重复计划是"长期约定"不是"某一天的事"：规则在生效中（已开始、未过期）的，
       无论查看的这天是否命中，都归当天的 day 组。
       ★ 为什么不能只靠 todoOccursOn（= 网格画块的那套判定）：网格只在该命中的
         日子画块，但列表得让它**天天够得着**——改规则、勾完成、跳过本次都在行内。
         每周三的计划若在其余六天从列表里消失，就没地方管它了（改版前它一直在
         列表里；这里是保住旧能力，不是新增分组）。
       ★ 与网格的差异是故意的、也说得出理由：网格答"哪天冒方块"，列表答"哪些
         计划够得着"。行内有重复徽标写着下次什么时候，用户分得清。 */
    if (s) {
      (appData.todos || []).forEach(function (t) {
        if (!t || inDay[String(t.id)]) return;
        const rr = normTodoRepeat(t.repeat);
        if (!rr) return;
        if (rr.last && rr.last > s) return;   /* 规则还没到开始日 */
        if (rr.until && s > rr.until) return; /* 规则已过期（过期规则随后会被降级清掉） */
        inDay[String(t.id)] = 1;
      });
    }
    /* day 组按**数组序**出：manual 排序下，命中的任务与没命中的重复计划要能互相
       换位——不能"命中的永远排在前面"，否则上移按钮对后者永久空转。 */
    const day = [], carry = [], undated = [], future = [];
    (appData.todos || []).forEach(function (t) {
      if (!t) return;
      if (inDay[String(t.id)]) { day.push(t); return; }
      /* ★ 用「最早有块的那天」而不是 tbStartDateOf：只有额外段的计划没有 remindAt，
         用它会把「明天有块」的计划判成 undated（列表说未排期、网格上却有块）。 */
      let sd = todoFirstBlockDate(t);
      /* 没画段、只有「开始时间」的计划：归属按那个时间的日期算。
         从日程表某天点＋新建就只有 remindAt，不给它一个日子的话，
         它会被判成「未排期」——用户切到那天反而看不到自己刚建的计划。 */
      if (!sd) {
        const _md = String(todoMainDateOf(t) || '').slice(0, 10);
        if (_md) sd = _md;
      }
      /* ★ 活对象上一个块都没有时，再看一眼排期快照：一次性计划的段过了日子会被
         clearStaleOneOffSchedule 清回未排期（remindAt 置空、blocks 清空），
         它**确实排过**昨天，不该被说成「没设开始时间，不随日期变」。
         判据仍是同一句「最早/最晚有块的那天」，只是把来源从活对象换成冻结的历史。 */
      const _histSd = sd ? '' : todoHistSchedDate(t, appData.todoSchedLog);
      if (!sd && _histSd) sd = _histSd;
      if (!sd && !normTodoRepeat(t.repeat)) { undated.push(t); return; }
      /* ★ done 不参与分组：它只决定"外观 + 网格还画不画块"，不决定"这条计划还在不在列表里"。
         原来两处都带 !t.done，于是出现一条谁都想不到的消失路径：
         计划排在明天（或只有额外段、没有 remindAt）→ 今天既不在 inDay、又不进 future
         → 三组都不收 → 列表里凭空没了，**连取消勾选的入口都没有**。
         今天的任务勾完成还留在 day 组（inDay 不看 done），未来的任务却当场消失，
         同一个动作两种结果，这本身就是不自洽。
         勾错一次就丢一条计划，是最不该有的代价 —— 归属与完成状态解耦。 */
      if (sd && s && sd < s) carry.push(t);
      /* 就是查看的这天 → 进 day 组（切到周日就该看见那天的那条） */
      else if (sd && s && sd === s) day.push(t);
      /* ★ 排在这天**之后**的一次性任务（用户 10-15 报「日程表建的计划不显示」）：
         原来这种任务三组都不收 → 列表静默丢弃，翻回今天后它就像凭空消失了
         （网格照画，列表没有 = 两边对不上）。单独一组接住，让它永远够得着。 */
      /* 重复计划只要没被上面收进 day（未到开始日 / 已过期），也归这组——
         判据统一成「网格看得见 ⇒ 列表够得着」，不给它留第二种消失路径。 */
      else if (sd && s && sd > s) future.push(t);
      /* ★ 补：上面那句注释从 10-15 起就没兑现 —— `else if (sd && s && sd > s)`
         要求 sd 为真，而「规则已过期 / 还没到开始日」的重复计划正好 sd 为空，
         于是照样静默消失（实测：until 已过的重复计划四组都不收）。
         重复计划是长期约定，它该有家 → 归「之后的安排」，行内自带 🔄 徽标说明规则。
         最后再兜一层 undated：**任何任务都不允许从列表消失**，宁可归错组。 */
      else if (normTodoRepeat(t.repeat)) future.push(t);
      else undated.push(t);
    });
    return { date: s, day: day, carry: carry, undated: undated, future: future };
  }
  /* 某天某任务的「实际」区间（可能多段）—— 本屏唯一的取数入口。
   * ★ 段落**只有一处来源**：01d 的 tbTodoSegList（已结算记录的 segs ∪ 进行中会话）。
   *    这里只负责把它的毫秒时刻**换算成"当天第几分钟"**（绘图层坐标系），
   *    不再自己去数 records、也不再自己去拼进行中会话 —— 那正是"同一件事算两遍"的老毛病：
   *    两边的日期口径、开口段处理、认亲规则只要有一处不同，计划卡与网格就会各说各话。
   *    段落只活在记录（或它的待结算形态 liveSessions）里，计划身上没有第二份 ——
   *    旧实现退出读 t.actualSegs / actualStart→doneAt，那正是"删了记录、色块又被画回来"的来源。 */
  function tbActualOf(t, dateStr) {
    if (!t || typeof t !== 'object') return [];
    const raw = tbTodoSegList(t, dateStr);   /* 已按"段落起点属于这天"过滤、并按起点排好序 */
    if (!raw.length) return [];
    const _isToday = tbDateStr(new Date()) === dateStr;
    /* 坐标系：一律按「距当天 00:00 的分钟数」算（不逐段取 getHours）。
       这样跨零点的时段自然得出 e > 1440 —— 直接裁到 24:00 就是"画到当天结束"，
       不必再为"结束落在明天"另设一条分支。 */
    const _p = String(dateStr).slice(0, 10).split('-');
    const _d0 = new Date(Number(_p[0]), Number(_p[1]) - 1, Number(_p[2])).getTime();
    if (isNaN(_d0)) return [];
    const _minOf = function (ms) { return (Number(ms) - _d0) / 60000; };
    /* 这一天里最晚的段起点：判断某个开口段后面还有没有更晚的段要用它。
       ★ 一律**带秒**（_minOf 不取整）：只看"分"的话，19:32:50 与 19:32:10 会被当成
       同一时刻，段与段的先后、开口段的判定都会错。 */
    let _maxStart = -Infinity;
    raw.forEach(function (x) {
      const s = _minOf(x.s);
      if (!isFinite(s) || s < 0 || s >= TB_DAY_MINUTES) return;
      _maxStart = Math.max(_maxStart, s);
    });
    const segs = [];
    raw.forEach(function (x) {
      const s = _minOf(x.s);
      if (!isFinite(s) || s < 0 || s >= TB_DAY_MINUTES) return;
      let e = null;
      const rawE = Number(x.e) || 0;
      if (rawE) {
        const ee = _minOf(rawE);
        if (isFinite(ee) && ee > s) e = ee;   /* 结束早于/等于开始 = 脏数据，按开口段处理 */
      }
      /* 段还开着（e === 0）= 「正在做」。只有它确实是**最后一段**（后面没有更晚的段）
         才画到此刻；否则说明这段没被正常收尾（App 被杀 / 漏调 close）——
         画到此刻会把中间的休息时间一起吞掉、和后面的段连成一整条。
         对这类「陈旧开口段」只画最小可见高度，保证段与段之间永远留出空隙。 */
      if (e == null) {
        const isLastSeg = s >= _maxStart;
        e = (isLastSeg && _isToday) ? tbNowMin() : s + TB_DRAW_MIN_MIN;
      }
      /* 跨零点的段裁到当天 24:00 —— 网格只有 0~1440 分钟，多出来的部分属于第二天 */
      if (e > TB_DAY_MINUTES) e = TB_DAY_MINUTES;
      /* 下限只保证"有记录就看得见"（1 分钟），不再把短段撑成 15 分钟 —— 后者会让
         1 秒的专注在网格里占掉一格半，跟日志卡的 7:32~7:32 直接对不上。 */
      e = Math.max(e, s + TB_DRAW_MIN_MIN);
      segs.push({ start: s, end: e, minutes: e - s, fromTodo: true, recId: x.recId, authMs: x.authMs || 0 });
    });
    /* ★ 时长与区间解耦：块的**起点**用区间（画在哪儿），块的**长度**用记录的权威时长
       effectiveSeconds（缺则 endTime-startTime）。收口/裁切只动区间，不动长度。
       实现放在 00_pure_core 的 tbAuthScaleSegs（纯函数，可单测），这里只调用。 */
    const _scaled = tbAuthScaleSegs(segs);
    for (let i = 0; i < segs.length; i++) {
      segs[i].end = _scaled[i].end;
      segs[i].minutes = _scaled[i].minutes;
    }
    if (segs.length < 2) return segs;
    /* 区间并集：按开始排序后线性合并，避免两块实际色块重叠 */
    segs.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    const out = [segs[0]];
    for (let i = 1; i < segs.length; i++) {
      const last = out[out.length - 1];
      if (segs[i].start <= last.end) {
        last.end = Math.max(last.end, segs[i].end);
        last.minutes = last.end - last.start;
      } else {
        out.push(segs[i]);
      }
    }
    return out;
  }
  /* ---------- 注入：**不做单独一页**，就挂在计划列表上方（模板里的 #tbShellHost） ---------- */
  function tbEnsureShell() {
    const host = document.getElementById('tbShellHost');
    if (!host) return null;
    let shell = document.getElementById('tbShell');
    if (shell && shell.parentNode === host) return shell;
    shell = document.createElement('div');
    shell.id = 'tbShell';
    shell.innerHTML =
      /* 网格直接铺在计划列表上方，不挂折叠条 —— 那会多出一层"单独成块"，
         还会把任务数/时间/色点糊成一行。 */
      '<div class="tb-fold-body" id="tbFoldBody">' +
      '<div class="tb-bar">' +
      '<div class="tb-nav">' +
      '<button type="button" class="tb-icon-btn" onclick="tbShiftWeek(-1)" title="上一周">‹</button>' +
      '<div class="tb-weekstrip" id="tbWeek"></div>' +
      '<button type="button" class="tb-icon-btn" onclick="tbShiftWeek(1)" title="下一周">›</button>' +
      '<button type="button" class="tb-icon-btn" onclick="tbOpenDatePicker()" title="打开日历">📅</button>' +
      '<span class="tb-range" id="tbRange" onclick="tbGoToday()" title="回到今天"></span>' +
      '</div>' +
      '</div>' +
      '<div id="tbLegend" class="tb-legend"></div>' +
      '<div id="tbGridWrap" class="tb-grid-wrap"></div>' +
      '</div>';
    host.appendChild(shell);
    return shell;
  }

  /* ---------- 渲染 ---------- */
  /* 只有「日」一种网格：一周七个窄列在手机上什么都看不清，周视图已删除。
     tbSetGridView 保留成空壳，只为兼容旧调用点与用例。 */
  function tbSetGridView() {
    renderTimeBlockGrid();
  }
  function renderTimeBlockGrid() {
    const shell = tbEnsureShell();
    if (!shell) return;
    /* 字号档（设置里可改）会影响竖排字步进，每次重画都重新实测一次 */
    try { tbCharAdvance(true); } catch (e) { if (window.__silent) window.__silent(e, '01eA:renderTimeBlockGrid'); }
    const anchor = tbAnchorDate();
    const wrap = document.getElementById('tbGridWrap');
    tbRenderDay(wrap, anchor);
    /* 名字交给下面的计划列表；网格上方只留一条最小的颜色/口径图例 */
    tbRenderLegend(shell, true);
    tbRenderNav();
    /* 折叠状态挂到 shell 上：CSS 靠它连顶部的日期条一起藏（导航属于网格本体） */
    shell.classList.toggle('is-folded', tbGridFolded());
    /* 加号旁那颗「展开/收起」的文案与 aria 跟着同步 —— 它是唯一的开关，
       但状态可能在别处被改（tbGridFolded 落盘、跨页返回），所以每次重画都以当前状态为准。 */
    const _ft = document.getElementById('tbFoldToggle');
    if (_ft) {
      _ft.textContent = tbGridFolded() ? '展开' : '收起';
      _ft.setAttribute('aria-expanded', tbGridFolded() ? 'false' : 'true');
    }
    /* 渲染完成广播：订阅者（01eM 补插说明行 / 01eC 刷新计划列表）在这里被叫到。
       ★ 为什么需要它：本文件内部有 5 处**本地**调用 renderTimeBlockGrid()
         （切日期 / 翻周 / 回今天 / 折叠切换 / 空壳入口），包装 window.renderTimeBlockGrid
         覆盖不到这些路径 ——「说明行切个日期就消失」就是这么来的。
       钩子放在函数末尾：此时网格 DOM 已全部落位，订阅者可以直接查询。 */
    tbFireAfterRender();
  }

  /* ---------- 渲染完成广播（可叠加订阅） ----------
   * 背景：网格每次重画都整体重建 .tb-paper-body 的内容，靠"外面包一层"续命的做法
   * （包装 window.renderTimeBlockGrid）只能兜住**外部**调用；本文件 5 处内部调用
   * 走本地函数绑定，绕开包装 —— 01eM 的「展开说明」在切日期/翻周/折叠后消失，
   * 01eC 的列表在日历选日期后不刷新，都是这一个根因。
   * 现在由渲染方自己广播：订阅列表挂 window（跨 IIFE 只有这一条路），
   * 单个订阅失败不影响主渲染（静默上报），也不波及其他订阅。 */
  function tbFireAfterRender() {
    const subs = window.__tbGridAfterRenderSubs;
    if (!Array.isArray(subs) || !subs.length) return;
    subs.slice().forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        if (window.__silent) window.__silent(e, '01eA:tbGridAfterRender');
      }
    });
  }
  /* 订阅渲染完成事件（供 01eM / 01eC 使用；重复订阅同一 fn 只记一次）。
     必须在 DOMContentLoaded 之后调（那时本文件已执行完、API 已导出）。 */
  window.tbOnGridAfterRender = function (fn) {
    if (typeof fn !== 'function') return;
    if (!Array.isArray(window.__tbGridAfterRenderSubs)) window.__tbGridAfterRenderSubs = [];
    if (window.__tbGridAfterRenderSubs.indexOf(fn) < 0) window.__tbGridAfterRenderSubs.push(fn);
  };

  /* ---------- 日视图：手帐式矩阵（行 = 任务，列 = 钟点）----------
   * 照纸质手帐来：上面一排 06–14、下面一排 15–23；
   * 每个钟点并排两列 —— 先「预计」列、再「实际」列；
   * 每列竖着 6 格 = 每小时 6 格、一格 10 分钟（**这是可见格线**）；
   * 色块则按**分钟**落位（纵向轨道 60 行/小时，见 TB_PAPER_ROWS）；
   * 一条计划 = 预计列里的色块 + 实际列里的实心块，同一颜色，网格下面配一份「任务清单」对名字。 */
  /* 每小时两列的列号（1 起）：奇数 = 预计、偶数 = 实际 */
  function tbPaperColOf(hi, lane) {
    return hi * TB_PAPER_COLS_PER_HOUR + lane + 1;
  }
  function tbPaperCellMin(band, hi, slot) {
    return TB_PAPER_BANDS[band][hi] * 60 + slot * TB_PAPER_SLOT_MIN;
  }
  /* 背景格：一段 9 小时 × 2 列 × 6 格 = 108 格。行列都交给 CSS Grid 显式定位，
     大小由浏览器算——写死像素的表格，字号一变就会错位。
     ★ 每个格子**跨 10 行轨道**（1 行 = 1 分钟）：可见格线仍是每 30px 一条、一格 10 分钟，
     但纵向轨道变成 60 行/小时，色块才能落在"分钟"这一级上。 */
  function tbPaperCellsHtml(band) {
    let html = '';
    for (let hi = 0; hi < TB_PAPER_HOURS; hi++) {
      for (let lane = 0; lane < TB_PAPER_LANES; lane++) {
        for (let s = 0; s < TB_PAPER_SLOTS; s++) {
          html +=
            '<i class="tb-paper-cell' + (lane === 0 ? ' is-plan' : '') +
            (lane === TB_PAPER_LANES - 1 ? ' is-hour-end' : '') +
            '" data-tb-band="' + band + '" data-tb-hi="' + hi + '" data-tb-lane="' + lane +
            '" data-tb-slot="' + s + '" data-tb-min="' + tbPaperCellMin(band, hi, s) +
            '" style="grid-column:' + tbPaperColOf(hi, lane) +
            ';grid-row:' + (s * TB_PAPER_SLOT_MIN + 1) + ' / span ' + TB_PAPER_SLOT_MIN + '"></i>';
        }
      }
    }
    return html;
  }
  /* 网格是否收起：**默认收起**（计划页首屏该留给计划列表），只看"用户有没有显式选过展开"。
     三处（挂 class / 画开关 / 点击切换）都走这一条口径，别各写一遍真值判断。 */
  function tbGridFolded() {
    return !(appData.settings && appData.settings.tbGridFolded === false);
  }
  /* 收起/展开的**唯一入口函数**：网格里那颗「收起」和标题栏下那颗「展开日程」都调它，
     真值仍只有 appData.settings.tbGridFolded 一处 —— 不新增第二个开关、不复制状态判断。 */
  function tbToggleGridFold() {
    appData.settings.tbGridFolded = !tbGridFolded();
    saveData();
    renderTimeBlockGrid();
  }
  function tbPaperHeadHtml(band) {
    let html = '<div class="tb-paper-head">';
    TB_PAPER_BANDS[band].forEach(function (h, i) {
      html +=
        '<div class="tb-paper-hour" style="grid-column:' + (i * TB_PAPER_COLS_PER_HOUR + 1) +
        ' / span ' + TB_PAPER_COLS_PER_HOUR + '">' +
        tbHourLabel(h) + '</div>';
    });
    return html + '</div>';
  }
  /* 一段「分钟区间」→ 网格里的几块。跨小时就断开：一小时的「预计」列只有 6 格，
     一格不能同属两个钟点——纸上是这么画的，网格也就这么切。
     ★ 坐标是**分钟**，不是格子：row = 相对本钟点整点的分钟偏移（0–59，1 行 = 1 分钟），
       span = 时长（分钟，向上取整）。这样 5 分钟 = 半格、25 分钟 = 2.5 格。
     ★ 下限只管"看得见"：非零时长至少 1 行（≈3px 的一条细线）。老写法是
       `Math.floor` 起点 + `Math.ceil` 终点再相减，任何非零时长都至少占满一格 ——
       1 秒的专注会被画成 10 分钟，与日志卡显示的 7:32~7:32 对不上。 */
  function tbPaperSegs(band, lane, startMin, endMin) {
    const hours = TB_PAPER_BANDS[band];
    const segs = [];
    for (let hi = 0; hi < hours.length; hi++) {
      const base = hours[hi] * 60;
      const s = Math.max(startMin, base);
      const e = Math.min(endMin, base + 60);
      if (e <= s) continue;
      /* 起点落在"包含它的那一分钟"上；起点越界（数值异常）时夹回本钟点内 */
      let row = Math.floor(s - base);
      if (row < 0) row = 0;
      if (row > TB_PAPER_ROWS - 1) row = TB_PAPER_ROWS - 1;
      /* 时长向上取整到整分钟（grid 的 span 只认整数），再过一遍下限与钟点边界 */
      let span = Math.ceil(e - s);
      if (span < TB_DRAW_MIN_MIN) span = TB_DRAW_MIN_MIN;
      if (row + span > TB_PAPER_ROWS) span = TB_PAPER_ROWS - row;
      segs.push({ hi: hi, row: row, span: span, lane: lane });
    }
    return segs;
  }
  /* ★ 竖排一个字的**实际**纵向步进（px）。缓存，渲染开始时刷新一次（字号可被设置改）。
     以前写死 14px/字，但 .tb-paper-blk-t 的实际字步进约 21.25px（字号token × 行高），
     于是每条块都多算约 50% 的字，末端那几个字被 overflow 裁成半截（看上去像"字凭空少了几个"）。
     实测法：同一个 span 里放 1 个字和 4 个字，两次高度之差 / 3 = 步进（padding 自动抵消）。 */
  let _tbCharAdv = 0;
  function tbCharAdvance(force) {
    if (!force && _tbCharAdv > 0) return _tbCharAdv;
    let v = 0;
    try {
      const probe = document.createElement('span');
      probe.className = 'tb-paper-blk-t';
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;height:auto;max-height:none;';
      probe.textContent = '测';
      document.body.appendChild(probe);
      const h1 = probe.getBoundingClientRect().height;
      probe.textContent = '测测测测';
      const h4 = probe.getBoundingClientRect().height;
      if (probe.parentNode) probe.parentNode.removeChild(probe);
      if (h4 > h1) v = (h4 - h1) / 3;
    } catch (e) { if (window.__silent) window.__silent(e, '01eA:tbCharAdvance'); }
    if (!(v > 0)) v = 21.25;
    _tbCharAdv = v;
    return v;
  }
  /* 竖排块内文字的字数口径（预计块 / 实际块 / 计划外块共用）：
     上下各留 5px → 某段高度最多放 (高度-10)/字步进 个字（向下取整）。
     返回 0 = 一个字都放不下，就不印 —— 宁可空着，也不要把字裁成半截。 */
  function tbFitChars(hPx) {
    const n = Math.floor((Number(hPx) - 10) / tbCharAdvance());
    return n > 0 ? n : 0;
  }
  /* 一段块在本钟点里的绝对起始分钟（band → 钟点 → 行）。
     用来判断"这几段是不是连着的"：连着才把标题接着往下写。 */
  function tbSegStartMinOf(sg) {
    const hours = TB_PAPER_BANDS[sg.band] || [0];
    return hours[0] * 60 + sg.hi * 60 + sg.row;
  }
  /* 一条块（可能被整点切成好几段）的字幕分配 —— 每段吃自己放得下的字数。
     ★ 为什么不再"取最矮那一段的字数"：一条计划只要跨整点，尾巴必然是个几分钟的小段，
       按最矮的裁等于让**整条**计划只剩 0~3 个字。
     ★ 为什么要"接着往下写"而不是每段都从头印：否则一跨整点标题就重复一遍，
       而且长标题永远只露出开头那几个字。
     ★ 什么时候重新从第一个字开始：两段在时间上**断开**（另排的另一段、隔了几小时）。
       否则第二段时间块会从标题中间接着写，看上去像另一件事。 */
  function tbFlowLabels(segs, title) {
    const map = new Map();
    const list = (segs || []).slice().sort(function (a, b) {
      return tbSegStartMinOf(a) - tbSegStartMinOf(b);
    });
    const txt = String(title || '');
    let cur = 0;
    let prevEnd = -1;
    list.forEach(function (sg) {
      const st = tbSegStartMinOf(sg);
      if (st !== prevEnd) cur = 0; /* 断开 → 重新从头写 */
      prevEnd = st + sg.span;
      const n = tbFitChars(sg.span * TB_PAPER_MIN_H);
      if (n < 1 || cur >= txt.length) { map.set(sg, ''); return; }
      const t = txt.slice(cur, cur + n);
      cur += t.length;
      map.set(sg, t);
    });
    return map;
  }
  function tbLabelSpan(t) {
    return t ? '<span class="tb-paper-blk-t">' + escapeHtml(t) + '</span>' : '';
  }
  function tbPaperBlocksHtml(band, segs, cls, style, attr, inner, todoId) {
    let out = '';
    (segs || []).forEach(function (sg) {
      if (sg.band !== band) return;
      /* 块一律占满它自己那一列（预计列 / 实际列），不用 width+margin-left 把撞车的块并排挤成 1/n 宽
         —— 理由见 tbPaperLayout 里的说明。 */
      out +=
        '<i class="' + cls + '"' + attr + ' data-tb-band="' + sg.band + '"' +
        (todoId ? ' data-tb-todo="' + escapeHtml(String(todoId)) + '"' : '') +
        ' style="grid-column:' + sg.col + ' / span ' + sg.colSpan +
        ';grid-row:' + (sg.row + 1) + ' / span ' + sg.span + ';' + style + '">' +
        (typeof inner === 'function' ? (inner(sg) || '') : (inner || '')) + '</i>';
    });
    return out;
  }
  /* 一个任务：**预计列 = 任务色浅档底 + 同色相深档描边/文字**，
     **实际列 = 同色相实色档**（专注记录，可好几段）。
     同一个色相、只差明度：预计 = light 档，实际 = solid 档 —— 于是
     「这块是什么颜色 = 哪件事」在两列完全一致，深浅区分"做没做"，
     不必让读者去记"灰色 = 没做"。
     **实际块上不印字**：一个钟点两列并排，23px 宽的列里再竖排数字会糊成一团；
     实际时段的起止走 title 提示 + 网格位置本身（格线就是 10 分钟刻度）。
     标题只写在**预计块**上（竖排，跟纸质表一致）。 */
  function tbPaperTodoHtml(band, x, planSegs, acts) {
    const col = tbPalette(x.color);
    /* 额外段与主段同色同浅底，靠**虚线描边**区分；标题前不再加「＋」——
       块里本来就只放得下几个字，多一个符号就少一个字，而且"同一件事的又一段时间"
       不需要在每一块上重复标注。 */
    const title = x.title || '(未命名)';
    const span = tbMinLabel(x.start) + '\u2013' + tbMinLabel(x.end);
    const attr = ' data-tb-id="' + escapeHtml(String(x.t.id)) + '"' +
      (x.isExtra ? ' data-tb-extra="1"' : '') + ' title="' +
      escapeHtml((x.isExtra ? '另排 ' : '预计 ') + span + ' ' + title) + '"';
    /* 块的画法 = 该任务色浅档底 + **同色相深档 1px 实线描边**。
       描边用 border（平的），不用 box-shadow —— 后者会画出一圈投影 = 眼里的"凸起"。 */
    /* ★ 预计块 = **任务色浅档底**（light），实际块 = 同色相实色档（solid）。
       TB_PALETTE 每档本就带 light/solid/dark/ink 四级，直接拿来用：
         预计 = light 浅底 + solid 描边 + dark 文字
         实际 = solid 实心 + ink 描边 + ink 文字
       ★ 实际块原来是"solid 底 + dark 字"，实测只有 2.2~2.8:1（块内文字看不清）。
         solid 底明度 ~0.33，写白字 2.7、写旧 dark 2.3 —— 两头都不够，只能换成算过的 ink 档。
       灰只用在**格底**，不涂在色块上 —— 否则会给人"整个都变灰"的观感。
       不用 rgba() 兑透明度：透明会让底下的格线透上来，那样才叫"糊"（见 tbTint 注释）。 */
    /* ★ 深色模式：col.light 是给奶油纸底配的浅档，直接画在深色纸底上
       就是一排"从暗背景里戳出来的亮条"（不要纯白：纯白和深色底撞得太明显）。
       深色模式改用同色相的暗档 dPlanBg + 亮字 dPlanInk（5.6:1），块与块之间仍凭色相区分。
       暗档同样的色相、只降明度 —— 所以浅/深两模式下，同一条计划"看着还是同一个颜色"。 */
    const _dk = tbIsDark();
    const planStyle = _dk
      ? 'background:' + (col.dPlanBg || col.light) + ';border-color:' + col.solid + ';color:' + (col.dPlanInk || col.dark)
      : 'background:' + col.light + ';border-color:' + col.solid + ';color:' + col.dark;
    /* 块内文字**按每段自己的高度**裁字数，连续几段接着往下写（tbFlowLabels）。
       完整信息仍交给 title 提示 + 下面的计划卡。 */
    const _planLabels = tbFlowLabels(planSegs, title);
    let out = tbPaperBlocksHtml(band, planSegs, 'tb-paper-blk is-plan' + (x.isExtra ? ' is-extra' : ''),
      planStyle, attr,
      function (sg) { return tbLabelSpan(_planLabels.get(sg)); }, x.t.id);
    (acts || []).forEach(function (it) {
      const s = it.rec;
      const atip = ' title="' + escapeHtml('实际 ' + tbMinLabel(s.start) + '\u2013' + tbMinLabel(s.end) + ' ' + title) + '"';
      /* 实际块 = 同一色相的实色档（预计是浅色档）：深浅在同一个色相里，
         不用 brightness() 之类的滤镜 —— 那会把色相一起带偏，两块看着就不是一个颜色。
         多段（中途去做别的任务再回来）：一次 forEach 出多个块，**每段一个**，
         段与段之间自然留出空档。 */
      out += tbPaperBlocksHtml(band, it.segs, 'tb-paper-blk is-actual',
        _dk
          ? 'background:' + (col.dActBg || col.solid) + ';border-color:' + (col.dActInk || col.ink) + ';color:' + (col.dActInk || col.ink)
          : 'background:' + col.solid + ';border-color:' + (col.ink || col.dark) + ';color:' + (col.ink || col.dark), atip,
        (function () {
          /* 实际块也印字：按这一段自己的高度裁字数，同一条记录的几段接着往下写，
             与预计块同一套口径，两列的块看起来才一致。 */
          const _actLabels = tbFlowLabels(it.segs, title);
          return function (sg) { return tbLabelSpan(_actLabels.get(sg)); };
        })(), x.t.id);
    });
    return out;
  }
  /* 计划外专注（只有记录、没有计划）：没有任务色可用，走中性灰（`.is-unplanned`）。
     几何由 tbPaperLayout 按**分钟**算好（sg.row / sg.span / sg.col），与彩色块同一套口径，
     所以它和已挂计划的块时间重叠时就是叠着 —— 绝不为了让它露出来去挪动已有块。
     块内文字沿用同一套"按块高裁字数"（tbFitChars）：放不下就不印，宁可空着。
     不给它 data-tb-id：这块底下没有可跳转的计划卡，点它不该有反应。 */
  function tbPaperUnplannedHtml(band, it) {
    const r = it.rec || {};
    const title = r.title || '计划外';
    const tip = ' title="' + escapeHtml(
      '计划外 ' + tbMinLabel(it.start) + '\u2013' + tbMinLabel(it.end) + ' ' + title
    ) + '"';
    const _uLabels = tbFlowLabels(it.segs, title);
    return tbPaperBlocksHtml(band, it.segs, 'tb-paper-blk is-unplanned', '', tip,
      function (sg) { return tbLabelSpan(_uLabels.get(sg)); });
  }
  /* 这个习惯的段：选段模式下当参照；单日排期则是这天的正式安排（名字只印第一块）。
     ★ 名字前**不印 🌱**：格子窄的时候只剩那个 emoji，等于没说这是哪个习惯
       （用户原话「它首个默认的是一个小草的一个emoji，都无法体现出是哪个」）。 */
  function tbPaperHabitHtml(band, it) {
    const label = it.name || '习惯';
    const mine = (it.segs || []).filter(function (sg) { return sg.band === band; })
      .sort(function (a, b) { return tbSegStartMinOf(a) - tbSegStartMinOf(b); });
    const first = mine.length ? mine[0] : null;
    const tip = ' title="' + escapeHtml(
      label + '  ' + tbMinLabel(it.start) + '\u2013' + tbMinLabel(it.end + 1)
    ) + '"';
    return tbPaperBlocksHtml(band, it.segs, 'tb-paper-blk is-habit', '', tip,
      function (sg) { return sg === first ? tbLabelSpan(label) : ''; });
  }
  /* 当前时刻：往网格里插**一条横线**（grid-row 落在"当前分钟"那一行，横跨当前钟点的两列）。
     ★ 为什么不再"把那一格圈出来"：每个钟点并排「预计 / 实际」两列，同一分钟会同时命中
     左右**两个**格子 → 屏幕上会多出两个孤立的空心红框。
     横线只有一条，两列合起来看就是"现在"。
     ★ 横线**只跨当前钟点的那两列**，不能写 `1 / -1`：这张网格的横向是"钟点"（每钟点
     2 列），纵向才是"本钟点内的分钟"（60 行）—— 跨满整行等于横穿全部 8 个钟点，
     看上去像在说"每个钟点的这一分钟都是现在"。
     ★ 只在看**今天**时才画（看别的日期没有"现在"可言）。 */
  function tbPaperMarkNow(wrap, dateStr, nowMin) {
    if (tbDateStr(new Date()) !== dateStr) return;
    const grids = wrap.querySelectorAll('.tb-paper-grid');
    for (let i = 0; i < grids.length; i++) {
      const grid = grids[i];
      const host = grid.parentNode;
      const band = host && host.getAttribute ? Number(host.getAttribute('data-tb-band')) : NaN;
      if (!(band >= 0 && TB_PAPER_BANDS[band])) continue;
      const hours = TB_PAPER_BANDS[band];
      const hi = Math.floor(nowMin / 60) - hours[0]; /* 「现在」是这一带里的第几个钟点 */
      if (hi < 0 || hi >= hours.length) continue; /* 不在这一带里 */
      const row = Math.floor(nowMin % 60) + 1; /* 本钟点内的第几分钟；grid 行号从 1 起 */
      const line = document.createElement('i');
      line.className = 'tb-now-line';
      line.style.gridColumn = tbPaperColOf(hi, 0) + ' / span ' + TB_PAPER_COLS_PER_HOUR;
      line.style.gridRow = String(row);
      grid.appendChild(line);
    }
  }
  function tbNowMin() {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  }
  function tbRenderDay(wrap, anchor) {
    tbResetOcc(); /* 每次重画重置"哪格已经被占了"，撞车判定才有意义 */
    const dateStr = tbDateStr(anchor);
    /* 眼睛（单条「今天先不看」）：这天点过眼睛的计划不画块 —— 与列表同一口径。
       ★ 从属于右侧那个眼睛开关（hideDone）：闸没开就等于没藏，网格照画。
         和列表共用一个总闸，才不会出现"列表没了、网格还有"的分裂。
       ★ 但**有实际记录的不受影响**：下面那段「只做过没排过」的补充不看眼睛，
         已经投入的番茄必须留在网格上（藏起来等于把真实专注抹掉）。 */
    const _eyeGate = (function () {
      try {
        if (typeof getSortPrefs !== 'function') return false;
        return !!getSortPrefs().todos.hideDone;
      } catch (e) { console.warn('getSortPrefs 不可用，网格按未开启隐藏处理', e); return false; }
    })();
    const liveTodos = tbTodosInRange([dateStr]).filter(function (t) {
      if (!_eyeGate) return true;
      return !(typeof todoEyesOff === 'function' && todoEyesOff(t, dateStr));
    });
    const todos = liveTodos.concat(tbHistTodosOn(dateStr, liveTodos));
    /* ★ 只做过、没排过：这类任务连 tbTodosInRange 都进不去 —— 那道门问的是
       「这条计划在今天有没有块」，没排期就没有块、也就没有行，实际段无处安放，
       整条记录在网格上凭空消失（「晚上完成的半个番茄背单词，
       日程表上为什么不显示」）。所以按「今天有没有记录段」再补一批候选，
       去重交给下面的 _seenTid（有块的任务已经在 todos 里，行也已经占上了）。 */
    (appData.todos || []).forEach(function (t) {
      if (!t || todos.indexOf(t) >= 0) return;
      if (tbTodoSegList(t, dateStr).length) todos.push(t);
    });
    /* 自动配色要在构造 rows 之前跑：rows.color 是在下面 forEach 里取自 t.tbColor 的 */
    tbAssignColorsFor(todos);
    const rows = [];
    todos.forEach(function (t) {
      /* ★ 一条计划 N 个块：主段 + 当天生效的额外段。取数只有一个入口（tbBlocksOf），
         这里只做搬运 —— 显示字段一律取块上的，不在渲染层再写一套归一逻辑。 */
      const blocks = tbBlocksOf(t, appData.settings, dateStr);
      const primaryKey = tbPrimaryBlockKey(blocks);
      blocks.forEach(function (b) {
        if (b.startMin == null) return;
        rows.push({
          t: t,
          isPrimary: b.key === primaryKey,
          isExtra: b.isExtra,
          title: b.title,
          tag: b.tag,
          quad: b.quad,
          done: b.done,
          start: b.startMin,       /* 分钟数，喂 tbPaperLayout */
          end: b.endMin,
          deadline: b.deadline,    /* 额外段已在 tbBlocksOf 里置 null */
          color: tbColorKeyOf(t),  /* 同任务同色 */
          estPomos: b.estPomos,    /* 额外段已在 tbBlocksOf 里置 0 */
          actPomos: b.actPomos,
          key: b.key
        });
      });
    });
    /* ★ 只做过、没排过：这类任务以前连"行"都没有（rows 全部来自 tbBlocksOf），
       实际段就没地方安放，整条记录在网格上凭空消失 —— 
       「晚上完成的半个番茄背单词，日程表上为什么不显示」。
       判定只看**那天真的有没有记录段**（tbTodoSegList 非空），不要求有预计块。
       用 id 去重：历史快照伪任务和活对象是同一个 id，别画两遍。 */
    const _seenTid = {};
    rows.forEach(function (r) { if (r.t) _seenTid[String(r.t.id)] = 1; });
    const _dp = String(dateStr).slice(0, 10).split('-');
    const _day0 = new Date(Number(_dp[0]), Number(_dp[1]) - 1, Number(_dp[2])).getTime();
    todos.forEach(function (t) {
      if (!t || _seenTid[String(t.id)]) return;
      const segs = tbTodoSegList(t, dateStr);
      let s0 = Infinity,
        e0 = -Infinity;
      segs.forEach(function (sg) {
        const s = (Number(sg.s) - _day0) / 60000;
        if (!isFinite(s) || s < 0 || s >= TB_DAY_MINUTES) return;
        const e = sg.e ? (Number(sg.e) - _day0) / 60000 : s + 1;
        s0 = Math.min(s0, s);
        e0 = Math.max(e0, isFinite(e) && e > s ? e : s + 1);
      });
      if (!isFinite(s0)) return;
      _seenTid[String(t.id)] = 1;
      rows.push({
        t: t, isPrimary: true, isExtra: false, actOnly: true,
        title: t.title, tag: t.tag, quad: t.quad, done: t.done,
        start: Math.floor(s0), end: Math.ceil(Math.min(e0, TB_DAY_MINUTES)),
        deadline: null, color: tbColorKeyOf(t), estPomos: 0, actPomos: t.actPomos,
        key: 'act:' + t.id
      });
    });
    rows.sort(function (a, b) {
      return a.start - b.start || (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0));
    });
    /* 先把这一屏所有块（预计 + 实际 + 无计划）整体排一遍槽位，再进 band 循环渲染 */
    const layoutItems = [];
    rows.forEach(function (x, i) {
      const plan = { kind: 'plan', row: i, lane: 0, start: x.start, end: x.end, x: x, acts: [] };
      layoutItems.push(plan);
      /* ★ 实际段是**独立**的 layoutItem（lane 1、按自己的时间定位），不挂到某个预计块上。
         isPrimary 的唯一目的：同一条计划只调一次 tbActualOf —— 否则 N 个块会画出 N 份实际段。
         多段计划的额外段与真实记录落在同一时段时，两列会按时间自然对齐，不需要额外「挂靠」。 */
      if (!x.isPrimary) return;
      tbActualOf(x.t, dateStr).forEach(function (s) {
        const act = { kind: 'act', row: i, lane: 1, start: s.start, end: s.end, rec: s };
        plan.acts.push(act);
        layoutItems.push(act);
      });
    });
    /* 计划外专注（灰块）也进同一个布局清单：它只有"实际"、没有"预计"，
       所以 lane 恒为 1（实际列），跟预计列无关。
       判定 + 归日口径都在 00_pure_core 的 tbUnplannedSegments（纯函数，可单测）：
       —— 只认 startTime 归日，且 todoId 对不上任何计划。**名字不参与判定**
       （名字不是身份；老记录能认亲的在启动迁移里已补挂 todoId，补不上的就是真·计划外）。
       ★ 不为其避让：灰块与彩色块时间重叠时照现有规则叠着画，绝不改动已有块的几何。 */
    tbUnplannedSegments(appData.records || [], dateStr,
      todos.map(function (t) { return t && t.id; })
    ).forEach(function (s, i) {
      layoutItems.push({
        kind: 'unplanned', row: rows.length + i, lane: 1,
        start: s.start, end: s.end, rec: s
      });
    });
    /* ---------- 习惯的时段：只给"正在排的那个"当参照 ----------
       用户要的是「在日程表上点起点、点终点」，那就得在网格里选；选的时候得看见
       **这个习惯已经排了哪几段**，否则会重复排。
       ★ 平时一格都不画（用户否决过"日程表上放一堆习惯"），只在 tbArmHabitId 非空时
         把那一个习惯的已排段淡画在最上层；选完（退出选段模式）就消失。 */
    const armHabitId = (typeof window.tbArmHabitId === 'function') ? window.tbArmHabitId() : null;
    (appData.habits || []).forEach(function (h) {
      if (!h || h.archived) return;
      const isArm = armHabitId !== null && String(h.id) === String(armHabitId);
      /* 单日排期（h.dayPlan）：用户点名要的那一天，跟"选段模式"无关，永远要画出来 ——
         否则他排完单日回到日程表，那天的格子上什么都没有，"覆盖"就成了一句空话。 */
      const dayOv = (typeof habitDayPlanOn === 'function') ? habitDayPlanOn(h, dateStr) : [];
      if (!isArm && !dayOv.length) return;
      const hskips = (typeof habitSkipSet === 'function')
        ? habitSkipSet(h, (typeof habitSkipsOf === 'function' ? habitSkipsOf(h) : [])) : null;
      const hlogs = (appData.habitLogs && appData.habitLogs[h.id]) || [];
      const segs = isArm
        ? habitBlocksOn(h, dateStr, hskips, hlogs)
        : dayOv.map(function (b) {
          return { start: String(b.start).slice(11, 16), end: String(b.end).slice(11, 16) };
        });
      segs.forEach(function (b, i) {
        layoutItems.push({
          kind: 'habit', habitId: h.id, name: h.name || '', dayOnly: !isArm,
          start: hmToMin(b.start), end: hmToMin(b.end) - 1,
          row: rows.length + 100 + i, lane: 0
        });
      });
    });
    tbPaperLayout(layoutItems);
    /* 习惯块占"预计列"一格（23px）；名字横排、CSS 里 overflow:visible 铺到右边。
       ★ 别改成横贯整行：两段相邻会连成一片绿带，读不出是几段。 */
    layoutItems.forEach(function (it) {
      if (it.kind !== 'habit') return;
      it.segs.forEach(function (sg) {
        sg.col = tbPaperColOf(sg.hi, 0);
        sg.colSpan = 1;
      });
    });
    /* 两排（06~14 / 15~23）**始终都画** —— 这是"一天的时间格"，少一排就像图纸被撕了一半。
       空白不是问题，"缺一块"才是问题；空排照画，反正本来就要占位置。
       嫌长用右上角的「收起」（tbGridFolded）折叠，而不是让某一排凭空消失。 */
    let bandsHtml = '';
    for (let band = 0; band < TB_PAPER_BANDS.length; band++) {
      let blks = '';
      rows.forEach(function (x) {
        const plan = layoutItems.filter(function (it) {
          return it.kind === 'plan' && it.x === x;
        })[0];
        /* actOnly 行没有预计块：planSegs 传 null，只画实际段 ——
           否则会凭空画出一块「预计」色块（它本来就没排期）。 */
        blks += tbPaperTodoHtml(band, x, plan ? (x.actOnly ? null : plan.segs) : null, plan ? plan.acts : null);
      });
      /* 习惯块（只在选段模式出现）画在最上层：它是"这段已经归这个习惯了"的底纹 */
      layoutItems.forEach(function (it) {
        if (it.kind === 'habit') blks += tbPaperHabitHtml(band, it);
      });
      /* 计划外的灰块最后画：它们跟任何计划都不共享色相，"谁压谁"没有语义，
         就按 DOM 顺序叠着（不为避让挪动任何已挂计划的块）。 */
      layoutItems.forEach(function (it) {
        if (it.kind === 'unplanned') blks += tbPaperUnplannedHtml(band, it);
      });
      bandsHtml +=
        '<div class="tb-paper-band" data-tb-band="' + band + '">' +
        tbPaperHeadHtml(band) +
        '<div class="tb-paper-grid">' +
        tbPaperCellsHtml(band) + blks + '</div></div>';
    }
    const emptyHint = ''; /* 排期入口是背景格双点 + 上方一行说明，网格内不再插提示 */
    const folded = tbGridFolded();
    wrap.innerHTML =
      '<div class="tb-paper' + (folded ? ' is-folded' : '') + '">' +
      '<div class="tb-paper-keys">' +
      '<span class="tb-paper-key is-plan">预计</span>' +
      '<span class="tb-paper-key is-actual">实际</span>' +
      /* 灰块是第三种语义（计划外），且它就长在实际列里、与"实际"的彩色块同列并排：
         不加这一项，用户只能猜"灰的是什么"。多一个 span 走同一套 flex + gap + 换行，
         窄屏由 .tb-paper-keys 的 flex-wrap 兜住，不需要额外断点。 */
      /* 「习惯」这一档只在**画了习惯块**时出现：选段模式，或这一天被单独排过。
         两条都走同一份 layoutItems，不另判一次状态 —— 图例和画面永远同进同出。 */
      (layoutItems.some(function (it) { return it.kind === 'habit'; })
        ? '<span class="tb-paper-key is-habit">习惯</span>' : '') +
      '<span class="tb-paper-key is-unplanned">计划外</span>' +
      '<span class="tb-paper-note">每小时 6 格 · 一格 10 分钟</span>' +
      '</div>' +
      '<div class="tb-paper-body">' + bandsHtml + emptyHint + '</div>' +
      '</div>';
    tbPaperMarkNow(wrap, dateStr, tbNowMin());
    tbAfterRender(wrap);
  }
  /* ---------- 图例 / 未排期 ---------- */
  function tbRenderLegend() {
    /* 网格上方不单独挂「颜色＝哪个计划」的图例：颜色跟下面计划列表里的标签同色，
       块上悬停即见全名，再列一遍只会多一条要维护的对应表。 */
    const el = document.getElementById('tbLegend');
    if (el) { el.innerHTML = ''; el.style.display = 'none'; }
  }

  /* ---------- 交互 ----------
     预计段来自计划卡的预计时间，实际段来自计时记录 + 勾选完成的时间戳。
     点背景格可以**直接排期**（两次点击定头尾，实现在 01eM_ui_tbcreate.js）；
     改已有计划仍走下面那张计划卡 —— 表上不提供拖拽改时长、点块编辑。 */
  /* ★ 事件用**委托**挂在网格容器上，不给每个块写内联 onmousedown：
     块每次 render 都是新节点（内联属性得跟着重写），委托只绑一次、也不会漏。
     标记 data-tb-bound 防重复绑定（同一容器会被多次 render 碰到）。 */
  function tbAfterRender(wrap) {
    if (!wrap || wrap.getAttribute('data-tb-bound') === '1') return;
    wrap.setAttribute('data-tb-bound', '1');
    wrap.addEventListener('pointerdown', tbPaperDown, { passive: true });
    wrap.addEventListener('pointermove', tbPaperMove, { passive: true });
    wrap.addEventListener('pointerup', tbPaperEnd);
    /* 手指一划就滚页面了，pointercancel 会来 —— 不清状态的话下一次 pointerup
       会拿着旧的坐标去判"没动" → 滑一下反而跳转 */
    wrap.addEventListener('pointercancel', function () { _tbDrag = null; });
  }
  function tbPaperDown(e) {
    const blk = e.target && e.target.closest ? e.target.closest('.tb-paper-blk') : null;
    if (!blk) return;
    const id = blk.getAttribute('data-tb-id');
    if (!id) return;
    const p = e.touches && e.touches[0] ? e.touches[0] : e;
    _tbDrag = { mode: 'paper-open', id: id, moved: false, x0: p.clientX, y0: p.clientY };
  }
  /* 点住没动才算点击：上下滑网格（滚页面）不该触发跳转 */
  function tbPaperMove(e) {
    const d = _tbDrag;
    if (!d || d.mode !== 'paper-open') return;
    const p = e.touches && e.touches[0] ? e.touches[0] : e;
    if (Math.abs(p.clientX - d.x0) + Math.abs(p.clientY - d.y0) > 10) d.moved = true;
  }
  function tbPaperEnd() {
    const d = _tbDrag;
    _tbDrag = null;
    if (!d || d.mode !== 'paper-open') return;
    if (!d.moved) tbFocusPlan(d.id);
  }

  /* 这个 id 是不是只在排期快照里（计划已离开活动列表） */
  function _tbIsHistId(id) {
    const log = appData.todoSchedLog || {};
    const key = String(id);
    const days = Object.keys(log);
    for (let i = 0; i < days.length; i++) {
      const arr = log[days[i]];
      if (!Array.isArray(arr)) continue;
      for (let j = 0; j < arr.length; j++) if (arr[j] && String(arr[j].id) === key) return true;
    }
    return false;
  }
  /* ---------- 点块 -> 跳到底下那张计划卡（网格不再自带编辑器，
     上下是同一份数据；要改就改下面的计划，改完网格自己会重画） ---------- */
  function tbFocusPlan(id) {
    if (id == null) return;
    const sel = '#todoList .todo-item[data-id="' + String(id).replace(/"/g, '') + '"]';
    const row = document.querySelector(sel);
    if (!row && _tbIsHistId(id)) {
      showToast('这是历史计划（已完成，已从列表收走）');
      return;
    }
    if (!row) {
      /* 计划不在下面这张列表里（换过日期/被筛掉）→ 至少告诉人一声，别点了没反应 */
      showToast('这条计划不在下面的列表里');
      return;
    }
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('tb-focus-flash');
    setTimeout(function () { row.classList.remove('tb-focus-flash'); }, 1800);
  }
  /* ---------- 导航：一周日期条 ----------
     把「‹ 今天 ›」换成能在**本周内直接点选**的日期条；‹ › 按周前后翻；
     📅 打开现成的月历（复用日志/日记那套 calendarModal）跳到任意日期。 */
  function tbWeekDates() {
    const start = getDateStr(tbWeekStart(tbAnchorDate()));
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = addDaysStr(start, i);
      if (d) out.push(d);
    }
    return out;
  }
  function tbRenderNav() {
    const sel = getDateStr(tbAnchorDate());
    const today = getDateStr(new Date());
    const box = document.getElementById('tbWeek');
    if (box) {
      const CN = ['一', '二', '三', '四', '五', '六', '日'];
      box.innerHTML = tbWeekDates().map(function (ds, i) {
        return '<button type="button" class="tb-day' + (ds === sel ? ' on' : '') + (ds === today ? ' today' : '') +
          '" onclick="tbPickDate(\'' + ds + '\')" title="' + ds + '">' +
          '<span class="tb-day-w">' + CN[i] + '</span>' +
          '<span class="tb-day-n">' + Number(ds.slice(8, 10)) + '</span></button>';
      }).join('');
    }
    const rg = document.getElementById('tbRange');
    if (rg) rg.textContent = sel === today ? '今天' : sel.slice(5);
  }
  /* 选中某一天：日期条与月历都走这一个入口 */
  function tbPickDate(ds) {
    const d = new Date(String(ds) + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    _tbDate = d;
    renderTimeBlockGrid();
    /* ★ 计划列表也跟着切（2026-11-06）：只重画网格的话，「正在看 X 的计划」那条
       和列表内容都停在原来的日子，用户得先新建一条计划才会被动刷新。 */
    try { if (typeof window.renderTodos === 'function') window.renderTodos(); } catch (e) { if (window.__silent) window.__silent(e, '01eA:refreshTodoList'); }
  }
  function tbShiftWeek(n) {
    const d = new Date(tbAnchorDate().getTime());
    d.setDate(d.getDate() + n * 7);
    _tbDate = d;
    renderTimeBlockGrid();
    try { if (typeof window.renderTodos === 'function') window.renderTodos(); } catch (e) { if (window.__silent) window.__silent(e, '01eA:refreshTodoList'); }
  }
  function tbGoToday() {
    _tbDate = new Date();
    renderTimeBlockGrid();
    /* 「回到今天」必须把列表也带回今天，否则网格回到今天、列表还停在别的日子。 */
    try { if (typeof window.renderTodos === 'function') window.renderTodos(); } catch (e) { if (window.__silent) window.__silent(e, '01eA:refreshTodoList'); }
  }
  /* 打开现成的月历：给日历一个「选完回调」，选完就回到网格。
     ★ 2026-11-07 重做格子口径：原来 mark() 只回答「这天有没有计划」→ 整格涂成主色。
       用户当天反馈：「只要有一个循环计划，那个就全部变色了，每一天，那有什么意义呢」
       —— 每天重复的计划本来就是天天命中，涂满一个月等于什么信息都没有。
     现在跟日志页「专注记录日历」同一个口径：**颜色深浅 = 当天折算番茄数**
       （pomoHeatLevel 1/2/4/7 四档，共用 --hm1~--hm4，同一天在两处颜色必须一样），
       数字 = 当天番茄数；有记录但 0 番茄（纯补记）给空心描边。
       排期没丢，但只标**一次性计划**（右上角小点）：循环计划是长期约定、天天都在，
       点它等于没有信息；"这天被临时占用"才是日历该提醒的事。 */
  function tbCalPomoMap() {
    if (_tbCalPomo) return _tbCalPomo;
    const pom = {},
      cnt = {};
    (appData.records || []).forEach(function (r) {
      if (!r || !r.startTime) return;
      const ds = getDateStr(r.startTime);
      pom[ds] = (pom[ds] || 0) + getPomos(r);
      cnt[ds] = (cnt[ds] || 0) + 1;
    });
    _tbCalPomo = { pom: pom, cnt: cnt };
    return _tbCalPomo;
  }
  function tbCalOneOffDays() {
    if (_tbCalOneOff) return _tbCalOneOff;
    const out = {};
    (appData.todos || []).forEach(function (t) {
      /* 循环计划不点：见上。一次性计划：它排在哪几天，就从各段自己的日期上标 ——
         多段排期允许跨天，按「首段那天」标会把第二段的日子漏掉。 */
      if (!t || !t.id || normTodoRepeat(t.repeat)) return;
      (todoBlocksOf(t, appData.settings) || []).forEach(function (b) {
        if (b && b.start) out[String(b.start).slice(0, 10)] = 1;
      });
    });
    return (_tbCalOneOff = out);
  }
  function tbCalDayCell(ds, day) {
    const m = tbCalPomoMap();
    const n = m.cnt[ds] || 0;
    const p = m.pom[ds] || 0;
    const lv = n ? pomoHeatLevel(p) : 0;
    let cls = ' lv' + lv + (n ? '' : ' no-rec') + (n && lv === 0 ? ' hasrec' : '');
    if (tbCalOneOffDays()[ds]) cls += ' has-plan';
    return {
      cls: cls,
      title: ds + '：' + (n ? fmtTomatoNum(p) + ' 个番茄 · ' + n + ' 条记录' : '没有记录'),
      html: '<span class="hm-d">' + day + '</span>' + (n ? '<span class="hm-n">' + fmtTomatoNum(p) + '</span>' : '')
    };
  }
  function tbOpenDatePicker() {
    if (typeof window.openCalendarModal !== 'function') return;
    _tbCalPomo = null; /* 每次打开重算：刚结算的番茄要立刻上色 */
    _tbCalOneOff = null;
    window.openCalendarModal({
      onPick: function (ds) { tbPickDate(ds); },
      dayCell: tbCalDayCell,
      legend:
        '少<span class="hm-cell c1"></span><span class="hm-cell c2"></span>' +
        '<span class="hm-cell c3"></span><span class="hm-cell c4"></span>多 · 🍅 当天番茄数'
    });
  }

  /* ---------- 导出 ---------- */
    window.renderTimeBlockGrid = renderTimeBlockGrid;
  /* 计划列表（01eC）跟随网格日期用：只暴露**只取数**的两个口，判定逻辑仍在本文件内
     （tbTodoSplitForDate 是唯一真相）。01eC → 01eA 依赖方向不变，不制造环。 */
  window.tbAnchorDateStr = function () { return getDateStr(tbAnchorDate()); };
  window.tbTodoSplitForDate = tbTodoSplitForDate;
  window.tbSetGridView = tbSetGridView;
  /* 收起态的「展开日程」入口走内联 onclick，和网格里的「收起」共用这一个函数 */
  window.tbToggleGridFold = tbToggleGridFold;
  window.tbPickDate = tbPickDate;
  window.tbShiftWeek = tbShiftWeek;
  window.tbOpenDatePicker = tbOpenDatePicker;
  window.tbGoToday = tbGoToday;
  window.tbFocusPlan = tbFocusPlan;
  window.tbColorKeyOf = tbColorKeyOf;
  window.tbPalette = tbPalette;
  /* 块内竖排字幕的两个纯工具：实测字步进 / 按段分配字数。
     给用例量「跨行的块到底剩几个字」用，也让字号档改动后有可回归的口径。 */
  window.tbCharAdvance = tbCharAdvance;
  window.tbFlowLabels = tbFlowLabels;
  /* 给标签徽章用：按标签文本稳定散列取色（同一标签永远同色，不同标签尽量不同色）。
     复用任务色板，与任务边框/网格块同源，避免另起一套色。 */
  /* ⚠️ 必须再乘一次 TB_COLOR_STRIDE：色板 16 色是**平滑色环**，相邻两格只差约 22°，
     裸 hash%16 会让两个不同标签落到相邻格 → 肉眼看起来「颜色没变」（用户 10-15 反馈）。
     乘 7（与 16 互质）后相邻 hash 跨约 158°，与任务色的散列方式保持一致。 */
  window.tbTagColorOfText = function (tag) {
    if (!tag) return '';
    const n = TB_PALETTE.length;
    return tbPalette(TB_PALETTE[(tbHash(String(tag)) % n) * TB_COLOR_STRIDE % n].key).solid;
  };
  /* 给计划列表用：同一个任务在网格和列表里必须同色，所以色源只有这一处 */
  window.tbColorOfId = function (id) {
    const list = (appData && appData.todos) || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(id)) return tbPalette(tbColorKeyOf(list[i])).solid;
    }
    return '';
  };
  /* 同一个色源兑白，给计划列表当底色 —— 兑白到 90% 以上，字压上去仍然清楚。
     ⚠️ 返回的是**不透明**色。只能用在「底色本来就是浅色、且不会随主题变」的地方；
     要给「会跟着主题/明暗变的表面」当淡底，请用下面的 tbColorWashOfId。 */
  window.tbColorTintOfId = function (id, alpha) {
    const list = (appData && appData.todos) || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(id)) {
        return tbTint(tbPalette(tbColorKeyOf(list[i])).solid, alpha == null ? 0.92 : alpha);
      }
    }
    return '';
  };
  /* 任务色的「淡底」：半透明 rgba —— 它自己不带"底色"，而是跟底下的表面混色，
     所以浅色/深色/任何配色主题下都自动合适。
     不要用"兑白后的不透明浅色"写进内联 style：那在深色/其它主题下就是一块亮白底。 */
  window.tbColorWashOfId = function (id, alpha) {
    const list = (appData && appData.todos) || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === String(id)) {
        return tbAlpha(tbPalette(tbColorKeyOf(list[i])).solid, alpha == null ? 0.1 : alpha);
      }
    }
    return '';
  };
})();
