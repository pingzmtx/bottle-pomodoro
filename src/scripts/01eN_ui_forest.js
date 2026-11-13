/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 森林面板的**重绘接管**：把「🌲 我的森林」从一列列表情统计，改成一片能看见的林地。
 * 全部为**顶层 function 声明 + 该域私有状态**；本文件必须排在 01e5_ui_tree.js **之后**加载
 * （见 src/manifest.json 的槽 1 files）—— 它包装后者定义的 window.renderForestPanel。
 * 依赖方向：本文件 → 01e5（被包装的 renderForestPanel）/ 00_pure_core（forestFromRecords /
 *   forestMilestones / getDateStr / fmtTomatoNum / fmtDurMin）/ 01b 的 appData.tree、uiPrefs。
 *   反向不成立：01e5 不依赖本文件的任何东西（原实现原样留着，删掉本文件即回退）。
 * 数据只读：不写 records、不改结算与图鉴，只在 appData.uiPrefs.forestWin 记一个**显示档位**。 */
/* ==================== 模块: 04eN-ui-forest.js | 职责: 森林面板重绘（SVG 树 / 自适应网格 / 窗口档位） | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04eN-ui-forest.js（源文件 01eN_ui_forest.js）
 * 分组：ui
 * 职责：森林面板 —— 参数化 SVG 树（按**时长**分四档、按树种上色）、自适应网格（日期不再叠字）、
 *       近 14/30/90 天窗口切换、格子底色表当天强度、树种图例。
 * 函数索引（TOC）：forestWin/forestSetWin/forestTreeSvg/forestDaySpecies/forestStrength/forestDayCell/forestYearCells/renderForest
 * ============================================================ */
(function () {
  /* 日粒度窗口三档（天）。写死可选值而不是自由输入：这是"看一眼攒了多厚"的档位，不是筛选项。 */
  var WINS = [14, 30, 90];
  /* 年粒度窗口：一年按**周**聚合渲染（见 forestYearCells）——
     365 天逐日铺格的话每格只有几像素，树必然小到看不见，反而看不出攒了什么。 */
  var YEAR = 365;
  var WINS_ALL = WINS.concat([YEAR]);
  /* 一天最多画几棵树，多出来的折成「+N」—— 沿用 FOREST_ICONS_PER_DAY 的口径，避免两处数字打架 */
  var CAP = typeof FOREST_ICONS_PER_DAY === 'number' ? FOREST_ICONS_PER_DAY : 6;
  /* 树干/高光/投影是"图形"的一部分，按图直接给色（换树种只换树冠色相，骨架仍是同一套） */
  var TRUNK = '#8D6E63';

  function forestWin() {
    var v = appData && appData.uiPrefs ? Number(appData.uiPrefs.forestWin) : 0;
    return WINS_ALL.indexOf(v) >= 0 ? v : WINS[0];
  }
  function forestSetWin(v) {
    v = Number(v);
    if (WINS_ALL.indexOf(v) < 0) return;
    try {
      if (appData && appData.uiPrefs) {
        appData.uiPrefs.forestWin = v;
        saveData();
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01eN:forestSetWin'); }
    renderForest();
  }
  window.forestSetWin = forestSetWin;

  /* ===== 参数化树：等级 0/1/2/3 → 幼苗 / 灌木 / 成树 / 大树 =====
     为什么不用表情：表情之间没有形态延续，第 1 档和第 3 档是两个不相干的字符，看不出"长大"。
     这里四档共用同一套骨架（同一片地、同一批色），只按等级**加高、加冠层**，成长才有连贯感：
     幼苗一根茎两片叶 → 灌木贴地的两团 → 成树短干一层冠 → 大树粗干三层冠。
     树冠色由树种传入（番茄红 / 樱花粉 / 金松金…），于是换树种＝换整片林子的色相。 */
  function forestTreeSvg(level, color, size) {
    var c = color || '#5CB85C';
    var s = Math.max(10, Number(size) || 20);
    var h = Math.round(s * 1.15);
    var head = '<svg class="fs-tree" width="' + s + '" height="' + h +
      '" viewBox="0 0 32 38" focusable="false" aria-hidden="true">' +
      '<ellipse cx="16" cy="35.2" rx="7.5" ry="2.1" fill="rgba(20,26,48,.12)"/>';
    if (level <= 0) {
      /* 幼苗：一根细茎 + 两片叶。和成树同源，只是还没长出冠 */
      return head +
        '<path d="M16 35 V21" stroke="' + TRUNK + '" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
        '<path d="M16 23 C10.5 21.5 8.6 16.4 9.4 13.2 C14 14.2 16 18.6 16 23 Z" fill="' + c + '"/>' +
        '<path d="M16 25 C21.5 23.5 23.4 18.4 22.6 15.2 C18 16.2 16 20.6 16 25 Z" fill="' + c + '" opacity=".8"/>' +
        '</svg>';
    }
    if (level === 1) {
      /* 灌木：没有可见的干，两团贴着地面 —— 有体积但还没"站起来"，
         正好对应「十几分钟，够长出一丛，还不够长成一棵」 */
      return head +
        '<circle cx="12.6" cy="27.4" r="6.4" fill="' + c + '" opacity=".9"/>' +
        '<circle cx="20.2" cy="28.2" r="5.4" fill="' + c + '"/>' +
        '<circle cx="14.4" cy="24.2" r="2.2" fill="#fff" opacity=".16"/>' +
        '</svg>';
    }
    if (level === 2) {
      /* 成树：短干 + 一层冠 */
      return head +
        '<path d="M16 35 V24" stroke="' + TRUNK + '" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
        '<circle cx="16" cy="17" r="9.6" fill="' + c + '"/>' +
        '<circle cx="11.6" cy="13.4" r="4" fill="#fff" opacity=".16"/>' +
        '</svg>';
    }
    /* 大树：粗干 + 三层冠（左右各一、顶上一团），体量明显比成树大一圈 */
    return head +
      '<path d="M16 35 V22" stroke="' + TRUNK + '" stroke-width="3.2" stroke-linecap="round" fill="none"/>' +
      '<circle cx="10.6" cy="20.4" r="7.4" fill="' + c + '" opacity=".92"/>' +
      '<circle cx="21.4" cy="20.4" r="7.4" fill="' + c + '" opacity=".92"/>' +
      '<circle cx="16" cy="13.6" r="8.6" fill="' + c + '"/>' +
      '<circle cx="12.8" cy="10.8" r="3.2" fill="#fff" opacity=".18"/>' +
      '</svg>';
  }

  /* 当天最矮的一棵 → 这一天的"代表树种"，给格子的 hover 提示补一句话：
     树形本身已经能看出大小，但"这算什么树"要靠文字说清（否则长短专注的区别全靠猜）。 */
  function forestDaySpecies(lv) {
    if (!lv || !lv.length) return '';
    var lo = Math.min.apply(null, lv);
    var hi = Math.max.apply(null, lv);
    var a = typeof FOREST_TREE_LEVELS !== 'undefined' && FOREST_TREE_LEVELS[lo] ? FOREST_TREE_LEVELS[lo] : null;
    var b = typeof FOREST_TREE_LEVELS !== 'undefined' && FOREST_TREE_LEVELS[hi] ? FOREST_TREE_LEVELS[hi] : null;
    if (!a) return '';
    return a === b ? a.icon + a.label : a.icon + a.label + '~' + b.icon + b.label;
  }

  /* 当天强度 → 底色谱档（0..4）。复用年度热力图那套深浅：
     一眼看出"哪几天狠"，不必逐个去数树。 */
  function forestStrength(pomoSum) {
    var p = Number(pomoSum) || 0;
    if (p <= 0) return 0;
    if (p < 2) return 1;
    if (p < 4) return 2;
    if (p < 7) return 3;
    return 4;
  }

  function forestDayCell(dateStr, rec, color, todayStr) {
    var st = rec ? forestStrength(rec.pomoSum) : 0;
    var lv = rec && Array.isArray(rec.levels) ? rec.levels : [];
    /* 老数据没有 levels（只有 icons）时按"成树"兜底，绝不因为少一个字段就画不出树 */
    if (rec && !lv.length && rec.icons && rec.icons.length) {
      lv = rec.icons.map(function () { return 2; });
    }
    /* 棵树越多画得越小：长场次一次出 2~4 棵之后，一天攒到 6 棵是常事，
       固定 20px 会折成两行把整个网格的行高顶起来（同一行里别的那几天跟着变高）。
       按棵数退一档，让 6 棵仍能排进一屏格子。 */
    var size = lv.length >= 6 ? 14 : lv.length >= 4 ? 16 : 20;
    var icons = '';
    var n = Math.min(lv.length, CAP);
    for (var i = 0; i < n; i++) icons += forestTreeSvg(lv[i], color, size);
    if (lv.length > CAP) icons += '<span class="fs-more">+' + (lv.length - CAP) + '</span>';
    var tip = dateStr + ' · ' + (rec ? rec.trees + ' 棵（' + forestDaySpecies(lv) + '）· ' + fmtTomatoNum(rec.pomoSum) + ' 🍅 · 专注 ' + fmtDurMin(rec.minutes) : '没有专注');
    return (
      '<div class="fs-day fs-s' + st + (dateStr === todayStr ? ' is-today' : '') +
      '" title="' + escapeHtml(tip) + '">' +
      '<span class="fs-plot">' + (icons || '<span class="fs-bare"></span>') + '</span>' +
      '<span class="fs-date">' + escapeHtml(dateStr.slice(5).replace('-', '/')) + '</span>' +
      '</div>'
    );
  }

  /* 一年视图：按**月**聚合成 12 格 —— 一眼看完一整年。
     为什么不一天一格：365 天在手机宽度下每格只有几像素，树小到看不出形态；
     按周 53 格也只有 7px 一格，同样看不清。按月铺开后每格放得下一小片林子（最多 4 棵），
     树形（等级）与底色（强度）两套语言仍与日视图一致，只是"一格 = 一个月"。
     按自然年切（1~12 月），未来月份留空并标注"还没到"。 */
  function forestYearCells(byDate, color, todayStr) {
    var now = new Date();
    var year = now.getFullYear();
    var nowMonth = now.getMonth();
    var html = '';
    for (var m = 0; m < 12; m++) {
      var daysInMonth = new Date(year, m + 1, 0).getDate();
      var sum = 0,
        trees = 0,
        days = 0,
        levels = [];
      for (var d = 1; d <= daysInMonth; d++) {
        var dt = new Date(year, m, d);
        if (dt.getTime() > now.getTime()) break;
        var rec = byDate[getDateStr(dt)];
        if (!rec) continue;
        sum += rec.pomoSum || 0;
        trees += rec.trees || 0;
        days++;
        if (Array.isArray(rec.levels)) levels = levels.concat(rec.levels);
      }
      levels.sort(function (x, y) { return y - x; });
      var st = forestStrength(sum);
      /* 只画「这个月最好的几天」——按等级取前 4 棵。
         不画「还有 N 条没画」那个 +N：它挂在树下面单看像个孤立数字（"76 天？"），
         而这个月的总量(hover 提示里已给全)在格子里并不是要表达的东西。 */
      var icons = levels.slice(0, 4).map(function (l) { return forestTreeSvg(l, color, 22); }).join('');
      var tip =
        m + 1 + ' 月 · ' +
        (trees
          ? days + ' 天专注 · ' + trees + ' 棵 · ' + fmtTomatoNum(sum) + ' 🍅'
          : m > nowMonth
            ? '还没到'
            : '这个月没有专注');
      html +=
        '<div class="fs-day fs-mo fs-s' + st + (m === nowMonth ? ' is-today' : '') +
        '" title="' + escapeHtml(tip) + '">' +
        '<span class="fs-plot">' + (icons || '<span class="fs-bare"></span>') + '</span>' +
        '<span class="fs-mo-name">' + (m + 1) + ' 月</span>' +
        '</div>';
    }
    return html;
  }

  /* 森林面板重绘：与 01e5 原版同样的口径（树数/番茄/里程碑全来自 00_pure_core），
     只换呈现 —— 自适应网格替掉 14 列一行，SVG 树替掉表情，并补上"没专注的那天"的空格。 */
  function renderForest() {
    var el = document.getElementById('treeForestPanel');
    if (!el) return;
    var forest = forestFromRecords(appData.records || []);
    var treeCount = forest.reduce(function (s, d) { return s + d.trees; }, 0);
    var totalPomos = forest.reduce(function (s, d) { return s + d.pomoSum; }, 0);
    var minSum = forest.reduce(function (s, d) { return s + d.minutes; }, 0);
    var todayStr = getTodayStr();
    var today = forest.filter(function (d) { return d.date === todayStr; })[0] || null;
    var milestones = forestMilestones(treeCount);
    var next = milestones.filter(function (m) { return !m.unlocked; })[0] || null;
    var unlockedN = milestones.filter(function (m) { return m.unlocked; }).length;
    var win = forestWin();

    /* 当前树种的色相 → 整片林子同色系 */
    var sid = (appData.tree && appData.tree.species) || 'tomato';
    var sp = typeof TREE_SPECIES !== 'undefined' && TREE_SPECIES[sid] ? TREE_SPECIES[sid] : null;
    var color = sp && sp.color ? sp.color : '#5CB85C';

    var byDate = {};
    forest.forEach(function (d) { byDate[d.date] = d; });
    var isYear = win === YEAR;
    var cells;
    if (isYear) {
      cells = forestYearCells(byDate, color, todayStr);
    } else {
      /* 逐日生成格子（含"没有专注的那天"）：空白本身就是信息 —— 断没断一眼看到 */
      cells = '';
      var startD = new Date();
      startD.setHours(0, 0, 0, 0);
      startD.setDate(startD.getDate() - (win - 1));
      for (var i = 0; i < win; i++) {
        var dd = new Date(startD.getTime());
        dd.setDate(dd.getDate() + i);
        var ds = getDateStr(dd);
        cells += forestDayCell(ds, byDate[ds] || null, color, todayStr);
      }
    }

    /* 林地底板：解锁得越多，地面越"厚"（0→3 档）—— 这是"里程碑改变地貌"里看得见的那部分 */
    var terra = unlockedN === 0 ? 0 : unlockedN <= 2 ? 1 : unlockedN <= 4 ? 2 : 3;

    /* 里程碑**不再在本面板单列一套** —— 它们是成就，已经并进成就表（「种树」分组，
       同一套解锁通知 / 奖励 / 统计），这里只留一行进度与入口，避免同一件事两处各说一遍。 */
    var msHtml =
      '<span class="tf-acc">森林里程碑已并入成就页 · 已达成 ' +
      unlockedN + '/' + milestones.length + '</span>' +
      '<button class="btn-small" data-act="switchView" data-act-args=\'["stats"]\' data-after="switchStatsSubTab" data-after-args=\'["ach"]\'>🏆 去成就页</button>';
    var winHtml = WINS_ALL
      .map(function (w) {
        return '<button type="button" class="fs-win' + (w === win ? ' on' : '') +
          '" onclick="forestSetWin(' + w + ')">' + (w === YEAR ? '一年' : w + ' 天') + '</button>';
      })
      .join('');

    /* 「今日」这行也必须用同一套 SVG 树 —— 网格已是矢量树，这里若还画表情，
       同一块面板里就会并排出现两种树形语言，看着像两个地方拼起来的。 */
    var todayHtml = '还没种树';
    var todayAcc = '开一个番茄就种下第一棵';
    if (today) {
      var tlv = Array.isArray(today.levels) && today.levels.length
        ? today.levels
        : (today.icons || []).map(function () { return 2; });
      /* 与网格同一条口径：棵数多就画小一点（长场次会让一天轻易攒到 6 棵以上） */
      var tsize = tlv.length >= 6 ? 14 : tlv.length >= 4 ? 16 : 18;
      todayHtml = tlv.slice(0, CAP).map(function (l) { return forestTreeSvg(l, color, tsize); }).join('') +
        ' ' + today.trees + ' 棵';
      todayAcc = forestDaySpecies(tlv) + ' · ' + fmtTomatoNum(today.pomoSum) + ' 🍅 · 专注 ' + fmtDurMin(today.minutes);
    }

    /* 「时长决定种出什么」这一行必须由树种表生成，不许手写：
       改档位时若忘了同步这里，面板就会指着一张对不上的图说规则（这类"说明与实现脱节"最难自查）。 */
    var spLegend = (typeof FOREST_TREE_LEVELS !== 'undefined' ? FOREST_TREE_LEVELS : [])
      .map(function (l) {
        return '<span class="tf-sp">' + l.icon + (l.atMin > 0 ? '≥' + l.atMin + '分' : '&lt;' + (FOREST_TREE_LEVELS[1] ? FOREST_TREE_LEVELS[1].atMin : 10) + '分') + '</span>';
      })
      .join('');

    el.innerHTML =
      '<div class="tree-forest-title">🌲 我的森林<span class="tf-acc">累计 ' +
      treeCount + ' 棵 · ' + fmtTomatoNum(totalPomos) + ' 🍅</span></div>' +
      '<div class="tf-species-line"><span class="tf-acc">时长决定种出什么</span>' + spLegend +
      '<span class="tf-acc">满 60 分钟一次收 ' + (FOREST_TREES_MAX > 1 ? '2~' + FOREST_TREES_MAX : '1') + ' 棵</span></div>' +
      '<div class="tf-today">今日：<b>' + todayHtml + '</b><span class="tf-acc">' + todayAcc + '</span></div>' +
      '<div class="tf-next">' +
      (next
        ? '下一片：<b>' + escapeHtml(next.label) + '</b> 还差 ' + (next.trees - treeCount) + ' 棵'
        : '🎉 全部森林成就已达成 · 累计专注 ' + escapeHtml(fmtDurMin(minSum))) +
      '</div>' +
      '<div class="fs-wins">' + winHtml + '</div>' +
      '<div class="fs-grid' + (isYear ? ' is-year' : '') + '" data-terra="' + terra + '">' + cells + '</div>' +
      '<div class="tf-chips">' + msHtml + '</div>';
  }

  /* 接管：包装 01e5 的原实现。原函数仍在（删掉本文件即回退到旧面板），
     renderTreeSection 里对 renderForestPanel() 的调用会走到这里。 */
  var _orig = window.renderForestPanel;
  if (typeof _orig === 'function' && !_orig.__forestWrapped) {
    window.renderForestPanel = renderForest;
    window.renderForestPanel.__forestWrapped = true;
    /* 保留旧入口名，万一有地方直接引用它 */
    window.renderForestPanelLegacy = _orig;
  }
})();
