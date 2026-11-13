/* ============================================================
 * 01e7 · 统计页渲染域（导航/图表/传记/热力图/renderStats）
 * 函数索引（TOC）：toggleBlockAnalysis/ensureBlockAnalysis/jumpToBlock/renderStatsJumpNav/buildAreaChartSvg/renderMonthlyStat/yrYearNum/yrMapYearNum/yrMapAnchorDate/yrMapShift/statYearsList/statYearPomoMap（+71 更多）
 * ============================================================ */
/* ===== 统计页：板块折叠分析（懒计算：展开才分析） ===== */
const _baDone = {}; // key → 已分析标记
function toggleBlockAnalysis(key) {
  const body = document.getElementById('an-' + key);
  const arrow = document.getElementById('anArrow-' + key);
  if (!body) return;
  if (body.style.display !== 'none') {
    body.style.display = 'none';
    if (arrow) arrow.textContent = '▸';
    /* 折叠 = 放弃已加载结果，再展开会重新计算（保证分析始终跟最新数据一致） */
    delete _baDone[key];
    return;
  }
  body.style.display = 'block';
  if (arrow) arrow.textContent = '▾';
  if (_baDone[key]) return; // 已分析过：直接显示缓存结果
  body.innerHTML = '<span class="an-spin">正在分析中</span>';
  setTimeout(function () {
    // 让转圈可见，再异步计算渲染
    let html = '';
    try {
      html = ANALYZERS[key] ? ANALYZERS[key](getStatsCache()) : '';
    } catch (e) {
      html = '分析出错，请稍后再试';
    }
    body.innerHTML = html || '<span style="color:var(--text-light);">暂无足够数据</span>';
    _baDone[key] = true;
  }, 60);
}
let _baInjected = false;
function ensureBlockAnalysis() {
  if (_baInjected) return; /* 只注入一次 */
  _baInjected = true;
  const blocks = [
    ['todayBox', 'today', '今日概览'],
    ['weekCompareBox', 'week', '周对比'],
    ['statsTrend', 'trend', '趋势'],
    ['heatmapBox', 'heat', '热力'],
    ['moodBox', 'mood', '身心'],
    ['qualityBox', 'quality', '质量'],
    ['durBox', 'dur', '时长'],
    ['week8Box', 'week8', '节奏'],
    ['interruptWrap', 'interrupt', '打断'],
    ['rankTrendWrap', 'rank', '上分'],
    ['monthlyStatWrap', 'monthly', '月度'],
    ['yearlyStatWrap', 'yearly', '年度'],
    ['focusRankWrap', 'focus', '段数']
  ];
  blocks.forEach(function (b) {
    const el = document.getElementById(b[0]);
    if (!el) return;
    const btn = document.createElement('div');
    btn.className = 'block-an-btn';
    btn.innerHTML = '💡 数据分析 <span id="anArrow-' + b[1] + '">▸</span>';
    btn.onclick = function () {
      toggleBlockAnalysis(b[1]);
    };
    const body = document.createElement('div');
    body.className = 'block-an-body';
    body.id = 'an-' + b[1];
    body.style.display = 'none';
    const h3 = el.querySelector('h3');
    if (h3) {
      h3.insertAdjacentElement('afterend', btn);
      btn.insertAdjacentElement('afterend', body);
    } else {
      el.insertAdjacentElement('beforebegin', btn);
      btn.insertAdjacentElement('afterend', body);
    }
  });
}
/* 统计页子板块快速跳转 */
function jumpToBlock(id) {
  const el = document.getElementById(id);
  if (!el) {
    showToast('⚠️ 区块「' + id + '」未找到，请刷新页面');
    return;
  }
  /* 自适应滚动容器：若 .main 仍为内部滚动容器则用它，否则页面以窗口滚动（scrollingElement） */
  const main = document.querySelector('.main');
  let isMainScroll = false;
  try {
    if (main) {
      const _ovY = window.getComputedStyle(main).overflowY;
      /* 老 WebView 上 scrollHeight/clientHeight 可能同为 0（尚未布局完成），
         此时 overflowY:auto/scroll 才是可靠信号 —— 补上这条判定，避免滚错容器
         导致「点了没反应 / 跳到空白」。 */
      isMainScroll = main.scrollHeight > main.clientHeight + 8 || _ovY === 'auto' || _ovY === 'scroll';
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01e7:jumpToBlock'); }
  const scroller = isMainScroll ? main : document.scrollingElement || document.documentElement;
  const nav = document.getElementById('statsJumpNav');
  const navH = nav ? nav.offsetHeight : 0;
  const cur = isMainScroll ? main.scrollTop || 0 : scroller.scrollTop || window.pageYOffset || 0;
  const top = el.getBoundingClientRect().top + cur - navH - 8;
  /* 老安卓 WebView：scrollTo 必须按 scrollTo(x, y) 两个数字参数调用。
     写成 scrollTo({top, behavior:'smooth'}) 时，Chrome < 61 的老内核会把对象当 NaN，
     滚动直接失效 —— 用户点了「年度/月度」没反应，只看到跳转后的空白区域。
     这里先探测对象参数能否生效（支持与否无法直接嗅探，用特性判定 +
     try/catch + 位置校验兜底）：现代内核走 smooth 动画，老内核走瞬时跳转。 */
  const _target = Math.max(0, top);
  let _smoothOk = false;
  try {
    /* scroll-behavior 支持的浏览器才认对象参数（用 CSS.supports 嗅探最稳） */
    _smoothOk =
      typeof CSS !== 'undefined' &&
      CSS.supports &&
      (CSS.supports('scroll-behavior', 'smooth') || CSS.supports('-webkit-scroll-behavior', 'smooth'));
  } catch (e) {
    _smoothOk = false;
  }
  if (_smoothOk && scroller.scrollTo) {
    try {
      scroller.scrollTo({ top: _target, behavior: 'smooth' });
    } catch (e) {
      scroller.scrollTo(0, _target);
    }
  } else if (scroller.scrollTo) {
    /* 老内核：瞬时跳转（两个数字参数，所有内核都支持） */
    scroller.scrollTo(0, _target);
  } else if (scroller.scrollTop !== undefined) {
    scroller.scrollTop = _target;
  } else {
    try {
      el.scrollIntoView(true);
    } catch (e) { if (window.__silent) window.__silent(e, '01e7:jumpToBlock'); }
  }
  document.querySelectorAll('#statsJumpNav .jump-pill').forEach(function (p) {
    p.style.outline = 'none';
  });
  const hit = document.querySelector('#statsJumpNav .jump-pill[data-t="' + id + '"]');
  if (hit) hit.style.outline = '2px solid var(--primary)';
  setTimeout(function () {
    if (hit) hit.style.outline = 'none';
  }, 1200);
}
function renderStatsJumpNav(SC) {
  const nav = document.getElementById('statsJumpNav');
  if (!nav) return;
  /* 加 title 完整说明：长按或鼠标悬停可看每个按钮的全称，2 字标签太缩写看不懂 */
  const items = [
    ['yearlyStatWrap', '📈 年度', '年度专注分布'],
    ['monthlyStatWrap', '📊 月度', '月度专注详情'],
    ['rankTrendWrap', '⭐ 上分', '上分趋势（近 N 天星数变化）'],
    ['interruptWrap', '🚫 打断', '打断原因分析'],
    ['week8Box', '🗓 节奏', '每周专注节奏（近 8 周）'],
    /* '📋 任务'（taskBox）已随板块一起移除（2026-11-07）：留下一个点了没反应的
       空跳转比没有更糟。要恢复板块时，两处一起加回来。 */
    ['durBox', '⏱ 时长', '专注时长分布'],
    ['qualityBox', '🍅 质量', '番茄完成质量（完整率/中断）'],
    ['moodBox', '🧠 身心', '身心状态（睡眠/精神/电量）'],
    ['heatmapBox', '🕐 热力', '24 小时专注热力图'],
    ['statsTrend', '📈 趋势', '近 7 天趋势'],
    ['weekCompareBox', '⚖️ 周对比', '本周 vs 上周'],
    ['todayBox', '📊 今日', '今日分析（基础指标卡）']
  ];
  const fr = SC.focusRank;
  const rankBtn =
    fr && fr.seg
      ? '<button class="jump-pill jump-rank" data-t="focusRankWrap" style="border-color:' +
        fr.color +
        '!important;color:' +
        fr.color +
        ';" title="专注段数 · 跳转到段位页" onclick="jumpToBlock(\'focusRankWrap\')">🎮 ' +
        fr.seg +
        '段·' +
        fr.tier +
        '</button>'
      : '<button class="jump-pill jump-rank" data-t="focusRankWrap" style="border-color:var(--primary)!important;color: var(--primary-ink);" title="专注段数 · 跳转到段位页" onclick="jumpToBlock(\'focusRankWrap\')">🎮 段数</button>';
  /* 段位在页面最底部，放导航最前面方便一键直达 */
  nav.innerHTML =
    rankBtn +
    items
      .map(function (it) {
        return (
          '<button class="jump-pill" data-t="' +
          it[0] +
          '" title="' +
          it[2] +
          '" onclick="jumpToBlock(\'' +
          it[0] +
          '\')">' +
          it[1] +
          '</button>'
        );
      })
      .join('');
}
/* 平滑面积折线图（淡紫）：data=分钟数组；opts.labelFn(i) X轴标签 / yMax / ticks

   ★ 轴标签与数据点尺寸（真实反馈，2026-10-25）：
     用户原话「那个统计图，那个字啊，无论是横纵坐标还是怎么样吧，就如此的小，
     那个点也是」。实测确认了两个叠加的问题：
       ① 轴标签写死 font-size="9"，而这个 SVG 用 viewBox="0 0 360 192"
          缩放渲染到 339px 宽（比例 0.94），**真实像素只有 8.5px** ——
          比正文 17px 小了整整一半，在手机上确实读不动。
       ② 数据点 r="3" 即直径 6px，比常规触控目标小一个数量级，
          曲线上的点看起来像"线上的毛刺"而不是可读的数据点。
     修法：字号改走 --fs-caption（实测 14px，缩放后 13.2px，跟随用户的
     字号档位设置），点半径 3 → 4.5 并给白色描边让它从线里"浮"出来，
     同时把 pL/pB 边距一起放大 —— 字号变大而边距不动的话，
     左边那列数字会被裁掉、底下的日期会贴边。 */
function buildAreaChartSvg(data, opts) {
  const w = opts.w || 360,
    h = opts.h || 192;
  /* 边距随字号一起放大：pL 要容下 13px 的四位数（"6200"），
     pB 要容下 13px 高的日期标签。改字号不改边距 = 标签被裁。 */
  const pL = 46,
    pR = 12,
    pT = 30,
    pB = 30;
  /* 轴标签统一走这里，改一处就够，避免 8 个地方各写一个数字 */
  const AXIS_TXT = 'style="font-size:var(--fs-caption);font-weight:600" text-anchor=';
  const iw = w - pL - pR,
    ih = h - pT - pB;
  const n = data.length;
  /* yMax 由调用方按 100/200 向上取整传进来；兜底不再写死 400 ——
     写死会让"一天只专注 20 分钟"的人曲线永远贴底，看起来像没数据。
     改为按实际最大值自适应，全 0 时给 1 避免除零。 */
  const dataMax = Math.max.apply(null, data.concat([0]));
  const max = Math.max(opts.yMax || dataMax || 1, dataMax) || 1;
  const X = function (i) {
    return n <= 1 ? pL + iw / 2 : pL + (iw * i) / (n - 1);
  };
  const Y = function (v) {
    return pT + ih * (1 - Math.min(1, (v || 0) / max));
  };
  /* 平滑折线：catmull-rom → bezier */
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = X(i),
      y = Y(data[i]);
    if (i === 0) {
      d += 'M' + x.toFixed(1) + ',' + y.toFixed(1);
    } else {
      const x0 = X(i - 1),
        y0 = Y(data[i - 1]);
      const cx = x0 + (x - x0) / 2;
      d +=
        ' C' +
        cx.toFixed(1) +
        ',' +
        y0.toFixed(1) +
        ' ' +
        cx.toFixed(1) +
        ',' +
        y.toFixed(1) +
        ' ' +
        x.toFixed(1) +
        ',' +
        y.toFixed(1);
    }
  }
  const fillD = d + ' L' + X(n - 1).toFixed(1) + ',' + (pT + ih) + ' L' + X(0).toFixed(1) + ',' + (pT + ih) + ' Z';
  /* 渐变填充 */
  let svg =
    '<svg viewBox="0 0 ' +
    w +
    ' ' +
    h +
    '" style="width:100%;height:auto;display:block;">' +
    '<defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="rgba(167,139,250,.38)"/><stop offset="1" stop-color="rgba(167,139,250,.03)"/></linearGradient></defs>';
  /* Y 轴刻度 */
  const ticks = opts.ticks || [0, Math.round(max * 0.25), Math.round(max * 0.5), Math.round(max * 0.75), max];
  ticks.forEach(function (t) {
    const y = Y(t);
    svg +=
      '<line x1="' +
      pL +
      '" y1="' +
      y +
      '" x2="' +
      (w - pR) +
      '" y2="' +
      y +
      '" stroke="var(--c-axis)" stroke-width="1" stroke-dasharray="2,4" opacity=".55"/>' +
      '<text x="' +
      (pL - 6) +
      '" y="' +
      (y + 4) +
      '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="end" fill="var(--text-light)">' +
      t +
      '</text>';
  });
  svg +=
    '<text x="' +
    (pL - 6) +
    '" y="' +
    (pT - 12) +
    '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="end" fill="var(--text-light)">分钟</text>';
  /* X 轴标签 */
  for (let i = 0; i < n; i++) {
    const lb = opts.labelFn ? opts.labelFn(i) : null;
    if (!lb) continue;
    svg +=
      '<text x="' +
      X(i) +
      '" y="' +
      (h - 9) +
      '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="middle" fill="var(--text-light)">' +
      lb +
      '</text>';
  }
  /* 填充 + 折线 */
  svg += '<path d="' + fillD + '" fill="url(#areaFill)"/>';
  svg += '<path d="' + d + '" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round"/>';
  /* 数据点 + 峰值标注
     ★ 标注要防重叠（真实问题，2026-10-25 放大字号后暴露）：
       原来取"数值最大的 3 个点"各标一条文案，文案是 fmtDurMin() 的
       长格式（"4小时35分" 六个汉字）。字号才 9.5 时勉强不撞，
       提到 14px 之后月度和年度图上三条标注直接叠成一团黑字。
       而且画布只有 360 宽、几十个数据点 —— 相邻两点的水平间距
       往往不到 20px，长文案根本放不下。
       改法：① 只标最高的那一个；② 文案用紧凑格式（"275分" 而不是
       "4小时35分"）；③ 靠近左右边界时改 text-anchor 防止被裁。 */
  const vals = data
    .map(function (v, i) {
      return { v: v || 0, i: i };
    })
    .filter(function (o) {
      return o.v > 0;
    })
    .sort(function (a, b) {
      return b.v - a.v;
    });
  const top = vals[0] || null;
  /* 紧凑时长：< 60 分显示 "35分"，否则取整到小时 "5h" / "97h"。
     不写 "4h35" / "97h5" 这种混合格式 —— 在只有十几像素高的标注里
     读起来像乱码，精确值放在点的 <title> 悬浮提示里就够了。 */
  const shortDur = function (v) {
    v = Math.round(v || 0);
    if (v < 60) return v + '分';
    return Math.round(v / 60) + 'h';
  };
  for (let i = 0; i < n; i++) {
    const v = data[i] || 0;
    const cx = X(i),
      cy = Y(v);
    svg +=
      '<circle cx="' +
      cx.toFixed(1) +
      '" cy="' +
      cy.toFixed(1) +
      '" r="4.5" fill="#A78BFA" stroke="#fff" stroke-width="1.5"><title>' +
      fmtDurMin(v) +
      '</title></circle>';
    if (v > 0 && top && top.i === i) {
      /* 靠边时换锚点，否则文案会溢出画布 */
      const anchor = cx < w * 0.18 ? 'start' : cx > w * 0.82 ? 'end' : 'middle';
      const tx = anchor === 'start' ? cx - 6 : anchor === 'end' ? cx + 6 : cx;
      /* 点在画面顶部时把标注放到点的**下方**：否则会和左上角那个
         "分钟" 单位标签挤在同一行，读起来像 "分钟5h"。 */
      const below = cy - 10 < pT + 8;
      const ty = below ? cy + 22 : cy - 10;
      svg +=
        '<text x="' +
        tx +
        '" y="' +
        ty +
        '" style="font-size:var(--fs-caption);font-weight:700" text-anchor="' +
        anchor +
        '" fill="var(--text)">' +
        shortDur(v) +
        '</text>';
    }
  }
  svg += '</svg>';
  return svg;
}
/* 月度卡片渲染 */
function renderMonthlyStat() {
  const el = document.getElementById('monStatBox');
  if (!el) return;
  const c = _monCur();
  document.getElementById('monStatTitle').textContent = c.y + '年' + String(c.m + 1).padStart(2, '0') + '月';
  const st = monthStats(c.y, c.m);
  const dims = new Date(c.y, c.m + 1, 0).getDate();
  const data = [];
  for (let d = 1; d <= dims; d++) data.push(st.days[d] || 0);
  const max = Math.max.apply(null, data.concat([0]));
  const yMax = Math.max(100, Math.ceil(max / 100) * 100);
  const labelFn = function (i) {
    if (dims > 20) {
      if (i % 5 === 0 || i === dims - 1) return c.m + 1 + '-' + (i + 1);
    } else if (i % 3 === 0 || i === dims - 1) return c.m + 1 + '-' + (i + 1);
    return null;
  };
  el.innerHTML = buildAreaChartSvg(data, { yMax: yMax, labelFn: labelFn });
  /* 摘要：番茄/时长/日均/活跃 + 与上月对比 */
  const pm = monthStats(c.y, c.m - 1 < 0 ? 11 : c.m - 1);
  const delta = pm.min > 0 ? Math.round(((st.min - pm.min) / pm.min) * 100) : st.min > 0 ? '(上月无记录)' : '';
  let sumHtml =
    '🍅 本月番茄 <b style="color: var(--primary-ink);">' +
    st.pomos.toFixed(1).replace(/\.0$/, '') +
    '</b> 个 · 专注 <b style="color: var(--primary-ink);">' +
    fmtDurMin(st.min) +
    '</b> · 日均 <b>' +
    (dims ? Math.round(st.min / dims) : 0) +
    ' 分</b> · 活跃 <b>' +
    st.active +
    '</b> 天';
  if (typeof delta === 'number')
    sumHtml +=
      ' · 较上月 <b style="color:' +
      (delta >= 0 ? 'var(--green)' : 'var(--red,#E53935)') +
      ';">' +
      (delta >= 0 ? '▲' : '▼') +
      Math.abs(delta) +
      '%</b>';
  const sEl = document.getElementById('monStatSummary');
  if (sEl) sEl.innerHTML = sumHtml;
}
/* 年度卡片渲染（图 + 月度对比表 + 摘要） */
/* 当前选中的年份（永远返回正整数）。
 * ★ 2026-11-05 修：按钮传的实参是字符串（data-act-args='["-1"]'），
 *   原来直接 `_yrY + d`，于是 "2025" + "-1" → "2026-1" —— 标题变成
 *   「2026-1-1-1111-1年」，越点越长。这里统一 parseInt，脏值自动回落到今年。 */
function yrYearNum() {
  const n = parseInt(_yrY, 10);
  return n > 0 && n < 10000 ? n : new Date().getFullYear();
}
/* ===== 年度视图的年份锚点（2026-11-07）=====
   年度地图原来永远画「今年」，想看好几年前的一整年只能等明年再来。
   现在两处都可以左右翻，并且能一键跳到某一年（记录多了以后翻十年的次数不可接受）。
   状态：_yrMapY = 年度地图当前年（0 = 跟随今年）；年度统计沿用已有的 _yrY。
   ★ 平年/往年的锚点日期必须是「该年 12-31」：calcYearReportStats 用 now.getMonth()
     判断"全年已过多少"，往年传今天会把它算成一个还没过完的年份，环比/完成率全错。 */
let _yrMapY = 0;
let _yearPickFor = 'stat'; /* 快跳弹窗当前服务谁：'stat'（年度统计）| 'map'（年度地图） */

function yrMapYearNum() {
  const y = parseInt(_yrMapY, 10) || 0;
  return y > 0 && y < 10000 ? y : new Date().getFullYear();
}
function yrMapAnchorDate() {
  const y = yrMapYearNum();
  const nowY = new Date().getFullYear();
  if (y === nowY) return new Date();
  return new Date(y, 11, 31);
}
function yrMapShift(d) {
  _yrMapY = yrMapYearNum() + (parseInt(d, 10) || 0);
  renderYearHeatmap();
  /* 翻到往年不再自动居中：往年整年都在视口里，居中会把 1 月推到左边看不见 */
  if (_yrMapY !== new Date().getFullYear()) {
    const b = document.getElementById('yearHeatmapContainer');
    if (b) b.scrollLeft = 0;
  } else {
    setTimeout(function () { centerYearHeat(); }, 0);
  }
}

/* 有记录的年份 + 今年：快跳弹窗只列这些（空年份点了是一整年空白，没有意义） */
function statYearsList() {
  const set = {};
  const thisY = new Date().getFullYear();
  set[String(thisY)] = 1;
  (appData.records || []).forEach(function (r) {
    if (!r || !r.startTime) return;
    const ds = getDateStr(r.startTime);
    if (ds) set[ds.slice(0, 4)] = 1;
  });
  return Object.keys(set).sort();
}
function statYearPomoMap() {
  const out = {};
  (appData.records || []).forEach(function (r) {
    if (!r || !r.startTime) return;
    const p = getPomos(r);
    if (!p) return;
    const y = getDateStr(r.startTime).slice(0, 4);
    out[y] = (out[y] || 0) + p;
  });
  return out;
}
function openYearPicker(forWhat) {
  _yearPickFor = forWhat === 'map' ? 'map' : 'stat';
  renderYearPickGrid();
  showModal('yearPickModal');
}
function renderYearPickGrid() {
  const grid = document.getElementById('yearPickGrid');
  if (!grid) return;
  const cur = _yearPickFor === 'map' ? yrMapYearNum() : yrYearNum();
  const pom = statYearPomoMap();
  const ys = statYearsList();
  if (ys.indexOf(String(cur)) < 0) ys.push(String(cur));
  ys.sort();
  /* 倒序：最近的年份在最上面（用户多半在近两年之间来回） */
  ys.reverse();
  grid.innerHTML = ys
    .map(function (y) {
      const p = pom[y] || 0;
      return (
        '<button class="yr-pick' + (Number(y) === cur ? ' on' : '') + '" data-act="pickStatYear" data-act-args=\'["' +
        y +
        '"]\'><b>' + y + '</b><span>' + (p ? fmtTomatoNum(p) + ' 🍅' : '没有记录') + '</span></button>'
      );
    })
    .join('');
}
function pickStatYear(y) {
  const n = parseInt(y, 10) || new Date().getFullYear();
  if (_yearPickFor === 'map') {
    _yrMapY = n;
    renderYearHeatmap();
    const b = document.getElementById('yearHeatmapContainer');
    if (b && n !== new Date().getFullYear()) b.scrollLeft = 0;
  } else {
    __set__yrY(n);
    renderYearlyStat();
  }
  closeModal('yearPickModal');
}

function renderYearlyStat() {
  const el = document.getElementById('yrStatBox');
  if (!el) return;
  const y = yrYearNum();
  document.getElementById('yrStatTitle').textContent = y + '年';
  const ms = yearStats(y);
  const data = ms.map(function (s) {
    return s.min;
  });
  const max = Math.max.apply(null, data.concat([0]));
  const yMax = Math.max(200, Math.ceil(max / 200) * 200);
  const labelFn = function (i) {
    return i % 2 === 0 || i === 11 ? i + 1 + '月' : null;
  };
  el.innerHTML = buildAreaChartSvg(data, { yMax: yMax, labelFn: labelFn });
  /* 摘要 */
  const total = ms.reduce(function (s, m) {
    return s + m.min;
  }, 0);
  const totalP = ms.reduce(function (s, m) {
    return s + m.pomos;
  }, 0);
  let best = -1;
  ms.forEach(function (m, i) {
    if (m.min > 0 && (best < 0 || m.min > ms[best].min)) best = i;
  });
  let active = 0;
  ms.forEach(function (m) {
    if (m.min > 0) active++;
  });
  const sEl = document.getElementById('yrStatSummary');
  if (sEl)
    sEl.innerHTML =
      '🍅 全年番茄 <b style="color: var(--primary-ink);">' +
      totalP.toFixed(1).replace(/\.0$/, '') +
      '</b> 个 · 专注 <b style="color: var(--primary-ink);">' +
      fmtDurMin(total) +
      '</b> · 活跃 <b>' +
      active +
      '</b> 个月' +
      (best >= 0
        ? ' · 最猛月 <b style="color:#A78BFA;">' + (best + 1) + '月（' + fmtDurMin(ms[best].min) + '）</b>'
        : '');
  /* 月度对比表 */
  renderYearMonthTable(y, ms);
}
/* 月度对比表：月份/番茄/时长/日均/较上月 */
function renderYearMonthTable(y, ms) {
  const el = document.getElementById('yrMonthTable');
  if (!el) return;
  if (!ms) ms = yearStats(y);
  let html =
    '<div style="font-size:var(--fs-note);font-weight:800;color: var(--primary-ink);margin-bottom:var(--sp-6);">🗓 每月番茄对比（' +
    y +
    '年）</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:var(--fs-caption);"><tr style="color:var(--text-light);">' +
    '<th style="padding:var(--sp-4) var(--sp-2);text-align:left;">月份</th><th>番茄</th><th>专注</th><th>日均</th><th>较上月</th></tr>';
  let prev = null;
  for (let m = 0; m < 12; m++) {
    const s = ms[m];
    const delta = prev && prev > 0 ? Math.round(((s.min - prev) / prev) * 100) : null;
    html +=
      '<tr style="border-top:1px solid var(--border);">' +
      '<td style="padding:var(--sp-4) var(--sp-2);font-weight:700;color:var(--text);">' +
      (m + 1) +
      '月</td>' +
      '<td style="text-align:center;">' +
      (s.pomos ? '🍅 ' + s.pomos.toFixed(1).replace(/\.0$/, '') : '—') +
      '</td>' +
      '<td style="text-align:center;">' +
      (s.min ? fmtDurMin(s.min) : '—') +
      '</td>' +
      '<td style="text-align:center;">' +
      (s.min ? Math.round(s.min / new Date(y, m + 1, 0).getDate()) + '分' : '—') +
      '</td>' +
      '<td style="text-align:center;">' +
      (delta === null
        ? '—'
        : '<span style="color:' +
          (delta >= 0 ? 'var(--green)' : '#E53935') +
          ';">' +
          (delta >= 0 ? '▲' : '▼') +
          Math.abs(delta) +
          '%</span>') +
      '</td>' +
      '</tr>';
    prev = s.min;
  }
  html += '</table>';
  el.innerHTML = html;
}
/* 月份切换
 * ★ d 是字符串（data-act-args='["-1"]'）。原来写 `c.m + d` = 数字 + 字符串 = 拼接
 *   （10 + "-1" → "10-1"），月度图与标题一起错乱。整数运算一律先 parseInt。 */
function monStatShift(d) {
  const c = _monCur();
  const step = parseInt(d, 10) || 0;
  let m = (parseInt(c.m, 10) || 0) + step,
    y = parseInt(c.y, 10) || new Date().getFullYear();
  while (m < 0) {
    m += 12;
    y--;
  }
  while (m > 11) {
    m -= 12;
    y++;
  }
  _monSet(y, m);
  renderMonthlyStat();
}
function yrStatShift(d) {
  /* d 是字符串（模板里 data-act-args='["-1"]'），必须 parseInt 再算：
     字符串相加是拼接，年份会变成 "2026-1" 这种越点越长的鬼东西。 */
  __set__yrY(yrYearNum() + (parseInt(d, 10) || 0));
  renderYearlyStat();
}
/* 月份选择弹窗 */
function openMonthPicker() {
  const c = _monCur();
  __set__monthPickY(c.y);
  renderMonthPickGrid();
  showModal('monthPickModal');
}
function monthPickYearShift(d) {
  /* ★ 跨模块状态必须走 __set__ 桥：_monthPickY 声明在 01d_engine_features.js，
     在**本模块里是桥生成的 const 绑定**，直接 `_monthPickY +=` 会抛
     TypeError: Assignment to constant variable（读得到、写不得）。 */
  __set__monthPickY((_monthPickY || new Date().getFullYear()) + (Number(d) || 0));
  renderMonthPickGrid();
}
function renderMonthPickGrid() {
  document.getElementById('monthPickYearLabel').textContent = _monthPickY + '年';
  const now = new Date();
  let html = '';
  for (let m = 0; m < 12; m++) {
    const isCur = _monthPickY === now.getFullYear() && m === now.getMonth();
    const isView = _monthPickY === _monCur().y && m === _monCur().m;
    html +=
      '<button onclick="pickMonth(' +
      m +
      ')" style="padding:var(--sp-8) 0;border-radius:var(--radius);border:2px solid ' +
      (isView ? 'var(--primary)' : 'var(--border)') +
      ';background:' +
      (isView ? 'var(--primary)' : 'var(--card)') +
      ';color:' +
      (isView ? '#fff' : 'var(--text)') +
      ';font-size:var(--fs-body);font-weight:' +
      (isCur ? '900' : '600') +
      ';">' +
      (m + 1) +
      '月' +
      (isCur ? '·今' : '') +
      '</button>';
  }
  document.getElementById('monthPickGrid').innerHTML = html;
}
function pickMonth(m) {
  _monSet(_monthPickY, m);
  closeModal('monthPickModal');
  renderMonthlyStat();
}
/* ===== 专注传记（新增）：里程碑自动生成成长日记 ===== */
const BIO_TEXTS = {
  rec_1: {
    title: '🥚 第一颗种子',
    texts: [
      '今天你完成了人生中第 1 个番茄。别小看这 25 分钟——所有了不起的专注，都是从第一颗种子开始的。',
      '第一颗番茄落地。你终于坐下来，和自己待了 25 分钟。这是你和「分心」较量的第一回合，你赢了。'
    ]
  },
  rec_10: {
    title: '🌱 第十个番茄',
    texts: [
      '第 10 个番茄完成。从磕磕绊绊到习以为常，你已经悄悄把「开始」变成了一种本能。',
      '十个番茄，意味着你至少十次战胜了「再刷五分钟手机」的冲动。这十个小小的胜利，正在改写你的习惯。'
    ]
  },
  rec_50: {
    title: '🌿 半个百',
    texts: [
      '第 50 个番茄。回想最初，你从 1 个都坐不住，到如今 50 个番茄铺成一条专注的路——你已经不再是那个容易分心的初学者了。',
      '五十个番茄，约二十多个小时的深度投入。这些时间没有白费，它们正在悄悄变成你的能力。',
      '第 50 个番茄达成！你用实际行动证明了：专注不是天赋，是日复一日的练习。'
    ]
  },
  rec_100: {
    title: '🎖️ 百番成军',
    texts: [
      '第 100 个番茄！从第 1 个到第 100 个，你跨过了许多「今天不想做」的时刻。这一百个番茄，是你写给自己的情书。',
      '一百个番茄，累计五十小时以上的心流。回头看，那个连 25 分钟都坐不住的自己，已经被你远远甩在身后。',
      '里程碑达成：100 个番茄。数字会说话——你不是三分钟热度的人，你是一个能坚持的人。'
    ]
  },
  rec_500: {
    title: '🏅 五百壮士',
    texts: [
      '第 500 个番茄！这已经不是坚持，而是生活方式。五百次专注，换来了一个全新的、更强大的你。',
      '五百个番茄意味着超过 200 小时的深度工作。大多数人一辈子都攒不出这么多专注时刻，而你做到了。'
    ]
  },
  rec_1000: {
    title: '👑 千番王者',
    texts: [
      '第 1000 个番茄！你已经是专注的王者。这一千个番茄背后的自律与韧性，值得所有人敬佩，包括你自己。',
      '一千个番茄，一千次开始。每一次「开始」都很简单，但连续一千次「开始」，就是传奇。'
    ]
  },
  rank_王者: {
    title: '🔥 王者加冕',
    texts: [
      '今天你晋升王者段位！从青铜一路走来，每一个番茄都是一颗星。星星不会说谎，你确实变强了。',
      '王者段位达成！还记得第一天连一个番茄都做不完的自己吗？现在的你，已经配得上这顶桂冠。'
    ]
  },
  rank_荣耀: {
    title: '👑 荣耀之巅',
    texts: [
      '荣耀段位！这是一个赛季的努力、一整个周期的坚持换来的。你不是运气好，你是真的狠。',
      '恭喜踏上荣耀！从王者到荣耀的这段路最难走，而你走完了。你比绝大多数人都更懂「长期主义」。'
    ]
  },
  rank_传奇: {
    title: '🏆 传奇诞生',
    texts: [
      '传奇荣耀——这个段位说明你已经把专注练成了本能。传奇不是用来仰望的，是用来超越的，而你做到了。',
      '传奇荣耀达成！你就是自己的传奇。从第一颗番茄到现在，你完成了一次漂亮的自我重塑。'
    ]
  },
  streak_7: {
    title: '🔥 七日之约',
    texts: [
      '连续打卡 7 天！习惯心理学说，7 天足以让一件事开始生根。你的专注，正在长成参天大树。',
      '连续 7 天不间断，你已经跨过了习惯养成的第一道门槛。一周前的你，能想象现在的自己吗？'
    ]
  },
  streak_30: {
    title: '📅 满月坚持',
    texts: [
      '连续打卡 30 天，整整一个月！你证明了自己不是「三分钟热度」，而是「三十天起步」。',
      '一个月不间断的专注，这是大多数人一辈子都没做到过的事。你已经拥有了让所有人羡慕的自律。'
    ]
  },
  day_10: {
    title: '⚡ 单日十杀',
    texts: [
      '单日 10 个番茄！这一天的高强度专注，说明你认真了。偶尔这样拼一次，你会发现自己比想象中更能打。',
      '今天完成了 10 个番茄——这是「全力以赴」的样子。记住这种感觉，它是你潜力的证据。'
    ]
  },
  day_20: {
    title: '🚀 单日二十',
    texts: [
      '单日 20 个番茄！这几乎是一个普通人的极限，而你做到了。今天的你，是巅峰状态的你。',
      '20 个番茄，意味着你今天几乎一整天都在和知识搏斗。这个数字，值得写进你的个人简介。'
    ]
  },
  ach_5: {
    title: '🎯 成就初现',
    texts: [
      '你已经解锁了 5 个成就！每一个成就背后，都是一段你战胜自己的故事。继续收集它们吧。',
      '5 个成就到手。成就系统只是记录，真正的奖杯是你每一次坐下来开始的勇气。'
    ]
  },
  ach_15: { title: '🏅 成就猎人', texts: ['15 个成就解锁！你已经把这款应用玩成了「收集自己的勇气」的游戏。'] },
  streak_best: {
    title: '🏅 最长连续·纪录刷新',
    texts: [
      function (d) {
        return '连续专注 ' + d.n + ' 天——这是你新的最长纪录！过去的你，正被你一点一点甩开。';
      },
      function (d) {
        return d.n + ' 天不间断，个人纪录再次刷新。每一次打卡，都在为这个数字添砖加瓦。';
      }
    ]
  },
  day_best: {
    title: '⚡ 单日最佳·纪录刷新',
    texts: [
      function (d) {
        return '单日 ' + d.n + ' 个番茄——新的个人单日纪录！这一天值得写进你的传记。';
      },
      function (d) {
        return '今天完成了 ' + d.n + ' 个番茄，打破了你自己之前的最佳。记住这种手感。';
      }
    ]
  },
  streak_100: {
    title: '🏆 百日传奇',
    texts: [
      '连续专注整整 100 天！三个多月风雨无阻，你已经不是"坚持"了，是"习惯"。',
      '100 天连续打卡——这个数字绝大多数人一辈子都达不到。你是万里挑一。'
    ]
  },
  mood_high: {
    title: '😌 状态爆表日',
    texts: [
      '今天电量/愉悦度爆表（≥8/10）——身体和心情都在全力支持你。记住这种状态，它是你最好的工作模式。',
      '状态满分的一天：身体有劲、心情在线。高质量专注，往往就是从这种好状态开始的。'
    ]
  },
  eff_100: {
    title: '💯 效率满分日',
    texts: [
      '今天完成的番茄全部完整（3+ 个，零半个零未完成）——你度过了一个效率满分的日子！',
      '零打断、零半途而废，全天 100% 完整率。这种日子不多，但你有。'
    ]
  },
  perfect_1: {
    title: '🏅 第一个完美周',
    texts: [
      '连续 7 天每天 4+ 番茄且零打断——你达成了人生第一个「完美一周」！',
      '七天全勤、每个番茄都干净利落。恭喜你解锁「完美一周」！'
    ]
  },
  perfect_3: { title: '🏅 完美三周达成', texts: ['累计 3 个完美周！你的专注已经不只是偶尔超常，而是稳定地高质量。'] },
  active_50: { title: '🗓 活跃 50 天', texts: ['累计 50 天有专注记录。习惯的种子已经扎根，剩下的交给时间。'] },
  active_100: {
    title: '🗓 活跃百日',
    texts: ['累计 100 天有专注记录——一年里三分之一的日子你都在和自己较劲。这条路，你走得很稳。']
  },
  active_200: {
    title: '🗓 活跃二百日',
    texts: ['累计 200 天有专注记录！超过半年的日子都有番茄作伴，专注已经是你的生活方式。']
  },
  active_365: { title: '🗓 全年活跃', texts: ['一年 365 天，你有 365 天都在专注——这是「全年全勤」级别的传奇！'] },
  stars_100: { title: '⭐ 上星过百', texts: ['累计上星 100 颗！从青铜一路攒星星，每一颗都是完成任务的证明。'] },
  stars_300: { title: '⭐ 上星三百', texts: ['累计上星 300 颗，段位里的每一颗星都在替你说话：你一直在前进。'] },
  stars_600: { title: '⭐ 上星六百', texts: ['累计上星 600 颗！绝大多数人一辈子攒不出这么多星，而你做到了。'] },
  footprint: {
    title: '📅 一周足迹',
    texts: [
      function (d) {
        return (
          '第 ' +
          d.week +
          ' 篇一周足迹：过去 7 天完成 ' +
          d.pomos +
          ' 个🍅，累计 ' +
          d.total +
          ' 个🍅，连续专注 ' +
          d.streak +
          ' 天。日子就这样一天天被认真过掉。'
        );
      },
      function (d) {
        return (
          '一周小结：这 7 天 ' +
          d.pomos +
          ' 个🍅（累计 ' +
          d.total +
          '），连续 ' +
          d.streak +
          ' 天。不必每天惊天动地，稳稳走完这周就是胜利。'
        );
      },
      function (d) {
        return (
          '又一周过去：' +
          d.pomos +
          ' 个🍅入账，总累计 ' +
          d.total +
          ' 个。回头看这一周，你比上周的自己又多了一份从容。'
        );
      }
    ]
  },
  ach_new: {
    title: '🏅 成就点亮',
    texts: [
      function (d) {
        return '点亮成就「' + d.name + '」——每一个成就，都是你走过的路。';
      },
      function (d) {
        return '新成就「' + d.name + '」get！你的坚持，被悄悄记录下来了。';
      },
      function (d) {
        return '「' + d.name + '」成就达成。别小看它，这是你亲手赢来的。';
      }
    ]
  },
  badge_new: {
    title: '🏅 周标达成',
    texts: [
      function (d) {
        return '本周达成「' + d.name + '」周标！一周的专注，配得上这枚徽章。';
      },
      function (d) {
        return '又点亮一枚周标「' + d.name + '」——稳定，就是你的超能力。';
      },
      function (d) {
        return '「' + d.name + '」周标到手，这一周没白过。';
      }
    ]
  }
};
function bioText(key, data) {
  const def = BIO_TEXTS[key];
  if (!def) return null;
  const texts = def.texts;
  const t = texts[Math.floor(Math.random() * texts.length)];
  return { key: key, title: def.title, text: typeof t === 'function' ? t(data) : t };
}
/* 传记「第 N 个番茄」的计数口径（唯一）：把记录折算成番茄点数，与全站「累计 🍅」同源
   （getPomos：full=1 / half=0.5 / 仅记录与未完成=0）。
   ★ 曾经直接用 records.length ——「仅记录」也占一条，于是只记了几顿吃饭就"达成 50 个番茄"
*/
function bioTotalPomos(recs) {
  const list = Array.isArray(recs) ? recs : appData.records || [];
  return list.reduce(function (s, r) {
    return s + getPomos(r);
  }, 0);
}
/* ===== checkBiographyEvents 拆分 helper =====
 * bioBackfillOnce：一次性补记（升级到传记系统后早期里程碑漏记回填，bioBackfillDone 防重）
 * bioInitFlags：首次运行初始化去重标记（只标记不补记，避免历史里程碑被记到当天） */
function bioBackfillOnce() {
  appData.bioBackfillDone = true;
  try {
    const _bdT = getTodayStr();
    const _recsB = appData.records || [];
    const _totalB = bioTotalPomos(_recsB);
    const _starsB = (appData.rankSystem && appData.rankSystem.stars) || 0;
    const _stkB =
      appData.tree.streakHistory && appData.tree.streakHistory.length
        ? appData.tree.streakHistory[appData.tree.streakHistory.length - 1].streak || 0
        : 0;
    const _achB = (appData.unlockedAchievements || []).length;
    const _CB = getStatsCache();
    const _actB = _CB.activeDays || 0;
    const _pwB = _CB.perfectWeekCount || 0;
    const _listB = appData.biographies || [];
    const _hasB = function (key) {
      return _listB.some(function (b) {
        return b.key === key;
      });
    };
    const _markB = function (key) {
      if (!appData.bioTriggered) appData.bioTriggered = {};
      appData.bioTriggered[key] = true;
    };
    const _putB = function (key, data) {
      if (_hasB(key)) {
        _markB(key);
        return;
      }
      const defB = bioText(key, data || {});
      if (!defB) return;
      _listB.push({ date: _bdT, key: key, title: defB.title, text: defB.text, edited: false });
      _markB(key);
    };
    const _rows = [];
    [1, 10, 50, 100, 500, 1000].forEach(function (n) {
      if (_totalB >= n) _rows.push(['rec_' + n, { n: _totalB }]);
    });
    if (_starsB >= 500) _rows.push(['rank_王者', {}]);
    if (_starsB >= 1000) _rows.push(['rank_荣耀', {}]);
    if (_starsB >= 1200) _rows.push(['rank_传奇', {}]);
    if (_stkB >= 7) _rows.push(['streak_7', {}]);
    if (_stkB >= 30) _rows.push(['streak_30', {}]);
    if (_stkB >= 100) _rows.push(['streak_100', {}]);
    if (_achB >= 5) _rows.push(['ach_5', {}]);
    if (_achB >= 15) _rows.push(['ach_15', {}]);
    if (_actB >= 50) _rows.push(['active_50', {}]);
    if (_actB >= 100) _rows.push(['active_100', {}]);
    if (_actB >= 200) _rows.push(['active_200', {}]);
    if (_actB >= 365) _rows.push(['active_365', {}]);
    if (_pwB >= 1) _rows.push(['perfect_1', {}]);
    if (_pwB >= 3) _rows.push(['perfect_3', {}]);
    if (_starsB >= 100) _rows.push(['stars_100', {}]);
    if (_starsB >= 300) _rows.push(['stars_300', {}]);
    if (_starsB >= 600) _rows.push(['stars_600', {}]);
    /* 纪录类：用触发标记里存过的历史峰值补一次（没触发过说明没有峰值信息，跳过） */
    const _sbB = appData.bioTriggered && (appData.bioTriggered['streak_best'] || 0);
    if (_sbB >= 3) _rows.push(['streak_best', { n: _sbB }]);
    const _dbB = appData.bioTriggered && (appData.bioTriggered['day_best'] || 0);
    if (_dbB >= 5) _rows.push(['day_best', { n: _dbB }]);
    _rows.forEach(function (r) {
      _putB(r[0], r[1]);
    });
    if (_rows.length) saveData();
  } catch (e) { if (window.__silent) window.__silent(e, '01e7:bioBackfillOnce'); }
}

function bioInitFlags() {
  appData.bioInitDone = true;
  /* 本函数所需的 total/stars/streak/todayCnt/achN/today 在这一层没有定义（都是原调用方的局部变量），
     必须在此就地重算 —— 裸用会抛 ReferenceError，并让 init 首屏整链异常降级
     （统计页数据不加载、今日分析走空态）。写法参照同批的 bioBackfillOnce()。 */
  const today = getTodayStr();
  const total = bioTotalPomos();
  const stars = (appData.rankSystem && appData.rankSystem.stars) || 0;
  const streak =
    appData.tree.streakHistory && appData.tree.streakHistory.length
      ? (appData.tree.streakHistory[appData.tree.streakHistory.length - 1].streak || 0)
      : 0;
  const todayCnt = countTomatoPoints(today);
  const achN = (appData.unlockedAchievements || []).length;
  if (!appData.bioTriggered) appData.bioTriggered = {};
  [1, 10, 50, 100, 500, 1000].forEach(function (n) {
    if (total >= n) appData.bioTriggered['rec_' + n] = true;
  });
  if (stars >= 1200) appData.bioTriggered['rank_传奇'] = true;
  if (stars >= 1000) appData.bioTriggered['rank_荣耀'] = true;
  if (stars >= 500) appData.bioTriggered['rank_王者'] = true;
  if (streak >= 30) appData.bioTriggered['streak_30'] = true;
  if (streak >= 7) appData.bioTriggered['streak_7'] = true;
  if (todayCnt >= 20) appData.bioTriggered['day_20'] = true;
  if (todayCnt >= 10) appData.bioTriggered['day_10'] = true;
  if (achN >= 15) appData.bioTriggered['ach_15'] = true;
  if (achN >= 5) appData.bioTriggered['ach_5'] = true;
  if (streak >= 3) appData.bioTriggered['streak_best'] = streak;
  if (todayCnt >= 5) appData.bioTriggered['day_best'] = todayCnt;
  if (streak >= 100) appData.bioTriggered['streak_100'] = true;
  const _CI = getStatsCache();
  const _ti = _CI.byDate[today] || null;
  if (_ti && ((_ti.energyN && _ti.energySum / _ti.energyN >= 8) || (_ti.moodN && _ti.moodSum / _ti.moodN >= 8)))
    appData.bioTriggered['mood_high'] = today;
  if (_ti && _ti.full >= 3 && _ti.half === 0 && _ti.incomplete === 0) appData.bioTriggered['eff_100'] = true;
  const _ai = _CI.activeDays || 0;
  [50, 100, 200, 365].forEach(function (n) {
    if (_ai >= n) appData.bioTriggered['active_' + n] = true;
  });
  const _pi = _CI.perfectWeekCount || 0;
  if (_pi >= 1) appData.bioTriggered['perfect_1'] = true;
  if (_pi >= 3) appData.bioTriggered['perfect_3'] = true;
  [100, 300, 600].forEach(function (n) {
    if (stars >= n) appData.bioTriggered['stars_' + n] = true;
  });
  appData.bioTriggered['footprint_date'] = today;
  saveData();
  return;
}

/* 2026-11-14：停用「每天/每周自动新增」的传记（用户明确要求）。
   函数体完整保留（含里程碑规则），改这一行即可恢复；历史数据一条不删，
   只是不再进列表（见 renderBioSection 里 bioItems 的过滤）。 */
const BIO_AUTO_OFF = true;
function checkBiographyEvents() {
/* —— 传记补记：把当前已达到、但传记列表里还没有对应条目的里程碑一次性补进去。
   只在第一次结算补，bioBackfillDone 落盘防重复补；
   day_10/day_20/mood/足迹 等无历史日期的特殊项不补，避免错日期 —— */
  if (!appData.bioBackfillDone) bioBackfillOnce(); /* 补记逻辑提顶层 helper */
  const rs = appData.rankSystem;
  const today = getTodayStr();
  const recs = appData.records || [];
  const total = bioTotalPomos(recs);
  const streak =
    appData.tree.streakHistory && appData.tree.streakHistory.length
      ? appData.tree.streakHistory[appData.tree.streakHistory.length - 1].streak || 0
      : 0;
  const todayCnt = countTomatoPoints(today);
  const stars = rs.stars || 0;
  const achN = (appData.unlockedAchievements || []).length;
  /* 首次运行只初始化去重标记，不补记历史里程碑——
     避免「之前已达成的 50/100 番茄、王者段位、连续7天」全部被记到更新当天 */
  if (!appData.bioInitDone) {
    bioInitFlags(); /* 首次初始化标记逻辑提顶层 helper（原 return 语义保留） */
    return;
  }
  const events = [];
  [1, 10, 50, 100, 500, 1000].forEach(function (n) {
    if (total >= n && !appData.bioTriggered['rec_' + n]) {
      appData.bioTriggered['rec_' + n] = true;
      const b = bioText('rec_' + n, { n: n });
      if (b) events.push(b);
    }
  });
  if (stars >= 1200 && !appData.bioTriggered['rank_传奇']) {
    appData.bioTriggered['rank_传奇'] = true;
    const b = bioText('rank_传奇', {});
    if (b) events.push(b);
  }
  if (stars >= 1000 && !appData.bioTriggered['rank_荣耀']) {
    appData.bioTriggered['rank_荣耀'] = true;
    const b = bioText('rank_荣耀', {});
    if (b) events.push(b);
  }
  if (stars >= 500 && !appData.bioTriggered['rank_王者']) {
    appData.bioTriggered['rank_王者'] = true;
    const b = bioText('rank_王者', {});
    if (b) events.push(b);
  }
  if (streak >= 30 && !appData.bioTriggered['streak_30']) {
    appData.bioTriggered['streak_30'] = true;
    const b = bioText('streak_30', {});
    if (b) events.push(b);
  }
  if (streak >= 7 && !appData.bioTriggered['streak_7']) {
    appData.bioTriggered['streak_7'] = true;
    const b = bioText('streak_7', {});
    if (b) events.push(b);
  }
  if (todayCnt >= 20 && !appData.bioTriggered['day_20']) {
    appData.bioTriggered['day_20'] = true;
    const b = bioText('day_20', {});
    if (b) events.push(b);
  }
  if (todayCnt >= 10 && !appData.bioTriggered['day_10']) {
    appData.bioTriggered['day_10'] = true;
    const b = bioText('day_10', {});
    if (b) events.push(b);
  }
  if (achN >= 15 && !appData.bioTriggered['ach_15']) {
    appData.bioTriggered['ach_15'] = true;
    const b = bioText('ach_15', {});
    if (b) events.push(b);
  }
  if (achN >= 5 && !appData.bioTriggered['ach_5']) {
    appData.bioTriggered['ach_5'] = true;
    const b = bioText('ach_5', {});
    if (b) events.push(b);
  }
  /* ★ 2026-11-14：从这里往下全是「会天天/每周触发」的条目
     （连续纪录刷新、单日纪录刷新、一周足迹、状态爆表、效率满分日）。
     用户明确要求「不要每天自动新增」，故整段停用；上面 rec_ 与 rank_ 里程碑是低频事件，保留。 */
  if (BIO_AUTO_OFF) {
    if (events.length) {
      events.forEach(function (b) {
        appData.biographies.unshift({ date: today, key: b.key, title: b.title, text: b.text, edited: false });
      });
      saveData();
      renderBioSection();
    }
    return;
  }
  /* 不天天记，只记「重要时刻」——
     连续纪录刷新（≥3 天破个人纪录）/ 单日纪录刷新（≥5 个破个人纪录）*/
  const bestStreak = appData.bioTriggered['streak_best'] || 0;
  if (streak >= 3 && streak > bestStreak) {
    appData.bioTriggered['streak_best'] = streak;
    const b = bioText('streak_best', { n: streak });
    if (b) events.push(b);
  }
  const bestDay = appData.bioTriggered['day_best'] || 0;
  if (todayCnt >= 5 && todayCnt > bestDay) {
    appData.bioTriggered['day_best'] = todayCnt;
    const b = bioText('day_best', { n: todayCnt });
    if (b) events.push(b);
  }
  if (streak >= 100 && !appData.bioTriggered['streak_100']) {
    appData.bioTriggered['streak_100'] = true;
    const b = bioText('streak_100', {});
    if (b) events.push(b);
  }
  /* 周期性足迹：每 7 天记一条「一周足迹」（不天天记，隔一周丰富传记） */
  const _lastFoot = appData.bioTriggered['footprint_date'] || '';
  const _lastFootTs = _lastFoot ? new Date(_lastFoot + 'T00:00:00').getTime() : 0;
  const _footGap = Math.floor((new Date(today + 'T00:00:00').getTime() - _lastFootTs) / DAY_MS);
  if (_footGap >= 7) {
    appData.bioTriggered['footprint_date'] = today;
    const _weekRecs = recs.filter(function (r) {
      return r.startTime >= new Date(today + 'T00:00:00').getTime() - 7 * DAY_MS;
    });
    const _weekPomos = _weekRecs.reduce(function (s, r) {
      return s + getPomos(r);
    }, 0);
    const _totalPomos = recs.reduce(function (s, r) {
      return s + getPomos(r);
    }, 0);
    const _footCount =
      (appData.biographies || []).filter(function (b) {
        return /^footprint_/.test(b.key);
      }).length + 1;
    const b = bioText('footprint', { week: _footCount, pomos: _weekPomos, total: _totalPomos, streak: streak });
    if (b) {
      b.key = 'footprint_' + today;
      if (b) events.push(b);
    }
  }
  /* —— 从海报汇总数据」 —— */
  const _C = getStatsCache();
  const _t0 = _C.byDate[today] || null;
  /* 状态爆表：今日电量或愉悦平均 ≥8（每天最多一条，用日期做 key） */
  if (_t0) {
    const _en = _t0.energyN ? _t0.energySum / _t0.energyN : 0;
    const _mo = _t0.moodN ? _t0.moodSum / _t0.moodN : 0;
    if ((_en >= 8 || _mo >= 8) && appData.bioTriggered['mood_high'] !== today) {
      appData.bioTriggered['mood_high'] = today;
      const b = bioText('mood_high', {});
      if (b) events.push(b);
    }
    /* 效率满分日：全天完整且 ≥3 个，零半个零未完成（首次达成记一条） */
    if (_t0.full >= 3 && _t0.half === 0 && _t0.incomplete === 0 && !appData.bioTriggered['eff_100']) {
      appData.bioTriggered['eff_100'] = true;
      const b = bioText('eff_100', {});
      if (b) events.push(b);
    }
  }
  /* 活跃天数里程碑 */
  const _activeN = _C.activeDays || 0;
  [50, 100, 200, 365].forEach(function (n) {
    if (_activeN >= n && !appData.bioTriggered['active_' + n]) {
      appData.bioTriggered['active_' + n] = true;
      const b = bioText('active_' + n, {});
      if (b) events.push(b);
    }
  });
  /* 完美周里程碑 */
  const _pw = _C.perfectWeekCount || 0;
  if (_pw >= 1 && !appData.bioTriggered['perfect_1']) {
    appData.bioTriggered['perfect_1'] = true;
    const b = bioText('perfect_1', {});
    if (b) events.push(b);
  }
  if (_pw >= 3 && !appData.bioTriggered['perfect_3']) {
    appData.bioTriggered['perfect_3'] = true;
    const b = bioText('perfect_3', {});
    if (b) events.push(b);
  }
  /* 上星里程碑（100/300/600，1000 交给 rank_荣耀） */
  [100, 300, 600].forEach(function (n) {
    if (stars >= n && !appData.bioTriggered['stars_' + n]) {
      appData.bioTriggered['stars_' + n] = true;
      const b = bioText('stars_' + n, {});
      if (b) events.push(b);
    }
  });
  if (events.length) {
    events.forEach(function (b) {
      appData.biographies.unshift({ date: today, key: b.key, title: b.title, text: b.text, edited: false });
    });
    saveData();
    renderBioSection();
  }
}
/* 传记说明折叠 */
function toggleBioHelp() {
  const body = document.getElementById('bioHelpBody');
  const arrow = document.getElementById('bioHelpArrow');
  if (!body) return;
  const showing = body.style.display === 'block';
  body.style.display = showing ? 'none' : 'block';
  if (arrow) arrow.textContent = showing ? '▸' : '▾';
}
let _bioSearchKey = '';
let _bioPage = 1;
let _bioSortAsc = false; /* true=旧→新 / false=新→旧（默认：最新在前） */
/* 时间范围筛选：''=全部时间 / 'YYYY-MM'=整月 / 'YYYY-MM-DD'=某一天。
   十年数据靠一个月下拉翻不动，导航交给日历弹窗（见 openBioCalendar）。 */
let _bioRange = '';
let _bioSourceFilter = 'all'; /* 来源筛选：all=全部 / bio=传记 / progress=日记「每日进步」/ gratitude=日记「感恩日记」 */
let _bioCalYear = 0,
  _bioCalMonth = 0,
  _bioCalJumpOpen = false;
/* 日历上打点用的计数（每次渲染时按当前关键词/来源重算） */
let _bioDayCount = {},
  _bioMonthCount = {},
  _bioLastCount = 0;
const BIO_PAGE_SIZE = 10;
function applyBioSearch() {
  const inp = document.getElementById('bioSearch');
  _bioSearchKey = inp ? inp.value : '';
  _bioPage = 1;
  renderBioSection();
}
/* 排序方向：只有一个按钮，点了就换头尾。依据固定为日期（来源有 Tab、字数没有意义） */
function toggleBioSort() {
  _bioSortAsc = !_bioSortAsc;
  _bioPage = 1;
  renderBioSection();
}
/* 时间范围（全部 / 某月 / 某天）—— 日历弹窗选完调这里 */
function setBioRange(range) {
  _bioRange = range || '';
  _bioPage = 1;
  renderBioSection();
}
/* 一句话说清当前看的是哪段（按钮文案 + 摘要行共用一份） */
function bioRangeLabel(range) {
  const r = range == null ? _bioRange : range;
  if (!r) return '全部时间';
  if (r.length === 7) return r.slice(0, 4) + '年' + Number(r.slice(5, 7)) + '月';
  if (r.length === 10) return r;
  return '全部时间';
}
/* 一键清空全部筛选（关键词/时间/方向/来源）—— 「筛选」用过以后没有回头路很难受 */
function clearBioFilters() {
  _bioSearchKey = '';
  _bioRange = '';
  _bioSortAsc = false;
  _bioSourceFilter = 'all';
  _bioPage = 1;
  _bioCalJumpOpen = false;
  renderBioSection();
}
function bioFilterActiveCount() {
  return (
    (_bioSearchKey ? 1 : 0) +
    (_bioRange ? 1 : 0) +
    (_bioSortAsc ? 1 : 0) +
    (_bioSourceFilter !== 'all' ? 1 : 0)
  );
}
/* 搜索词按空格拆开，每个词都要出现（AND）—— 十年后想找「2025 报名」这种组合词时有用 */
function bioSearchTokens() {
  return String(_bioSearchKey || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}
/* 把命中的词在正文里标出来（先转义再标，不会把用户输入的 < 当标签）。
   十年翻旧账，光看到"找到 3 条"不够，得一眼看见命中的是哪儿。 */
function bioHighlight(raw, tokens) {
  let s = escapeHtml(String(raw == null ? '' : raw));
  if (!tokens || !tokens.length) return s;
  const pats = tokens
    .map(function (t) {
      return escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .filter(Boolean);
  if (!pats.length) return s;
  try {
    s = s.replace(new RegExp('(' + pats.join('|') + ')', 'gi'), '<mark class="bio-hl">$1</mark>');
  } catch (e) {
    if (window.__silent) window.__silent(e, '01e7:bioHighlight');
  }
  return s;
}
function turnBioPage(delta) {
  _bioPage = Math.max(1, _bioPage + delta);
  renderBioSection();
}
function jumpBioPage(p) {
  _bioPage = parseInt(p, 10) || 1;
  renderBioSection();
}
function renderBioSection() {
  const mainBox = document.getElementById('bioSection');
  const list = appData.biographies || [];
  if (!mainBox) return;
  /* 搜索框是「边打字边筛」的：这个函数会整块重建 innerHTML，输入框本身也被换掉 ——
     不把焦点和光标位置捞回来，手机上是「敲一个字键盘就收、光标跳到开头」。
     备份 → 重建 → 还原，三行。判据用 id，不猜用户点在哪。 */
  const _ae = document.activeElement;
  const _keepFocus = !!_ae && _ae.id === 'bioSearch';
  const _caret = _keepFocus ? _ae.selectionStart : 0;
  const _hasProgress = Object.keys(appData.diaries || {}).some(function (d) {
    const p = appData.diaries[d] && appData.diaries[d].review && appData.diaries[d].review.progress;
    return p && String(p).trim();
  });
  /* 只有感恩日记、没有传记/每日进步时，这一块也得显示出来 */
  const _hasGratitude = Object.keys(appData.diaries || {}).some(function (d) {
    const g = appData.diaries[d] && appData.diaries[d].gratitude;
    return g && Array.isArray(g.items) && g.items.some(function (x) { return String(x || '').trim(); });
  });
  if (!list.length && !_hasProgress && !_hasGratitude) {
    mainBox.style.display = 'none';
    return;
  }
  /* 传记条目的另一个来源：日记「每日进步」(diary.review.progress)。
     它不是独立的 biographies 记录，而是从日记派生 —— 所以统一成同一种「条目」形状，
     只靠 source 区分，筛选/搜索/排序/分页全部共用一套逻辑，不各写一份。 */
  /* 历史条目全部保留展示 —— 用户要求的是「别再自动新增」，不是「把过去删掉」。
     checkBiographyEvents 已停用（BIO_AUTO_OFF），所以这里只会看到旧数据和成就解锁事件。 */
  const bioItems = list.map(function (b, i) {
    return { source: 'bio', date: b.date || '', title: b.title || '', text: b.text || '', bioIndex: i };
  });
  const progItems = [];
  Object.keys(appData.diaries || {}).forEach(function (date) {
    const p = appData.diaries[date] && appData.diaries[date].review && appData.diaries[date].review.progress;
    if (p && String(p).trim()) progItems.push({ source: 'progress', date: date, title: '每日进步', text: String(p).trim(), bioIndex: -1 });
  });
  /* 感恩日记派生：一天一条（当天几条短句并成一句），与「每日进步」完全同构 ——
     同一套筛选/搜索/排序/分页，只是 source 不同。 */
  const gratItems = [];
  Object.keys(appData.diaries || {}).forEach(function (date) {
    const g = appData.diaries[date] && appData.diaries[date].gratitude;
    const arr = g && Array.isArray(g.items)
      ? g.items.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
      : [];
    if (arr.length) gratItems.push({ source: 'gratitude', date: date, title: '感恩日记', text: arr.join(' · '), bioIndex: -1 });
  });
  /* 日记整卡：一天一条，把当天写过的字段全并进一张卡。
     与「进步」「感恩」的关系是「按天 / 按条」两种切法，内容不重不漏。 */
  const diaryItems = [];
  Object.keys(appData.diaries || {}).forEach(function (date) {
    const d = appData.diaries[date] || {};
    const r = d.review || {};
    const segs = [];
    const put = function (ic, label, v) { if (v && String(v).trim()) segs.push(ic + ' ' + label + '：' + String(v).trim()); };
    put('🌱', '进步', r.progress);
    put('🪨', '不足', r.shortcomings);
    put('🔧', '改进', r.improvements);
    put('✋', '该停止', r.stop);
    put('📝', '其他', r.other);
    const gi = (d.gratitude && Array.isArray(d.gratitude.items) ? d.gratitude.items : [])
      .map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    if (gi.length) segs.push('🙏 感恩：' + gi.join(' · '));
    const fb = d.feedback || {};
    if (fb.sleepTime || fb.wakeTime) {
      segs.push('😴 睡眠：' + (fb.sleepTime || '—') + ' 睡 / ' + (fb.wakeTime || '—') + ' 起');
    }
    if (segs.length) diaryItems.push({ source: 'diary', date: date, title: '日记', text: segs.join('\n'), bioIndex: -1 });
  });
  let pool = bioItems.concat(progItems).concat(gratItems);
  if (_bioSourceFilter === 'diary') pool = diaryItems;
  else if (_bioSourceFilter === 'bio') pool = bioItems;
  else if (_bioSourceFilter === 'progress') pool = progItems;
  else if (_bioSourceFilter === 'gratitude') pool = gratItems;
  /* 关键词：空格分隔 = 每个词都要出现；除了标题/正文，也认日期（打「2025」= 那年全部，
     打「2025-03」= 那个月）—— 十年后凭记忆只记得"大概是那年春天"时用得上。 */
  const _tokens = bioSearchTokens();
  let filtered = pool;
  if (_tokens.length) {
    filtered = filtered.filter(function (b) {
      const hay = ((b.title || '') + ' ' + (b.text || '') + ' ' + (b.date || '')).toLowerCase();
      return _tokens.every(function (t) {
        return hay.indexOf(t) >= 0;
      });
    });
  }
  /* 日历上的点数 = 「当前关键词/来源筛完之后，每天有多少条」—— 先记下来，再按日期筛。
     这样在日历里能看到"哪几天写过"，点进去不会是空的。 */
  _bioDayCount = {};
  _bioMonthCount = {};
  filtered.forEach(function (b) {
    if (!b.date) return;
    _bioDayCount[b.date] = (_bioDayCount[b.date] || 0) + 1;
    const m = b.date.slice(0, 7);
    _bioMonthCount[m] = (_bioMonthCount[m] || 0) + 1;
  });
  /* 时间范围：'YYYY-MM' 前缀匹配整月 / 'YYYY-MM-DD' 精确到天 */
  if (_bioRange) {
    filtered = filtered.filter(function (b) {
      return b.date && b.date.indexOf(_bioRange) === 0;
    });
  }
  /* 排序：只按日期，方向单独一个按钮。
     （旧版把「依据 / 来源 / 字数」和方向挤在两个下拉里，打开就是一张看不懂的选项表；
       来源有上面的 Tab，字数排序对翻旧账没有意义，一起删掉。） */
  filtered = filtered.slice().sort(function (a, b) {
    const r = (a.date || '').localeCompare(b.date || '');
    return _bioSortAsc ? r : -r;
  });
  _bioLastCount = filtered.length;
  /* 分页：传记主 Tab 每页 10 条 */
  const totalPages = Math.max(1, Math.ceil(filtered.length / BIO_PAGE_SIZE));
  if (_bioPage > totalPages) _bioPage = totalPages;
  const pageItems = filtered.slice((_bioPage - 1) * BIO_PAGE_SIZE, _bioPage * BIO_PAGE_SIZE);
  const cardOf = function (b, gi, uid) {
    /* 日记派生的条目（「每日进步」「感恩日记」）不可直接编辑 —— 它们是日记的一部分，
       改为给一个「去日记」入口，编辑权留在日记页，避免两处写入打架。 */
    const isProgress = b.source === 'progress';
    const isGratitude = b.source === 'gratitude';
    const isDiaryCard = b.source === 'diary';
    const isDiaryDerived = isProgress || isGratitude || isDiaryCard;
    const headBadge = isProgress
      ? '<span style="font-size:var(--fs-caption);font-weight:700;color: var(--primary-ink);background:var(--surface-2);border-radius:var(--radius-full);padding:1px var(--sp-8);">🌱 每日进步</span>'
      : isGratitude
        ? '<span style="font-size:var(--fs-caption);font-weight:700;color: var(--primary-ink);background:var(--surface-2);border-radius:var(--radius-full);padding:1px var(--sp-8);">🙏 感恩日记</span>'
        : isDiaryCard
          ? '<span style="font-size:var(--fs-caption);font-weight:700;color: var(--primary-ink);background:var(--surface-2);border-radius:var(--radius-full);padding:1px var(--sp-8);">📔 当天全部</span>'
          : '';
    const actBtn = isDiaryDerived
      ? '<button class="btn-small" style="padding:var(--sp-2) var(--sp-10);font-size:var(--fs-caption);" onclick="selectDiaryDate(\'' +
        b.date +
        '\')">📔 去日记</button>'
      : '<button class="btn-small" style="padding:var(--sp-2) var(--sp-10);font-size:var(--fs-caption);" onclick="editBio(' +
        gi +
        ')">✏️ 编辑</button>';
    /* 长文先折成 6 行，要看再展开 —— 十几年攒下来的正文一条条全铺开会翻不动。
       展开只改这一张卡片的 style，不重新渲染整个列表（不会把搜索框弄失焦）。 */
    const _tid = 'bioText' + uid;
    const _long = String(b.text || '').length > 180;
    return (
      '<div style="background:var(--card);border:1px solid var(--border);border-left:4px solid var(--primary);border-radius:var(--radius-input);padding:var(--sp-10) var(--sp-14);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:var(--sp-8);margin-bottom:var(--sp-4);">' +
      '<span style="font-size:var(--fs-caption);color:var(--text-light);">' +
      b.date +
      '</span>' +
      '<span style="display:flex;gap:var(--sp-8);align-items:center;flex-shrink:0;">' +
      actBtn +
      '</span></div>' +
      '<div style="font-size:var(--fs-body);font-weight:800;display:flex;align-items:center;gap:var(--sp-8);flex-wrap:wrap;margin-bottom:var(--sp-4);">' +
      bioHighlight(b.title, _tokens) +
      headBadge +
      '</div>' +
      '<div id="' +
      _tid +
      '" style="font-size:var(--fs-body);line-height:1.7;color:var(--text);' +
      (_long ? 'display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:6;overflow:hidden;' : '') +
      '">' +
      bioHighlight(b.text, _tokens) +
      '</div>' +
      (_long
        ? '<button class="btn-small" onclick="toggleBioText(\'' +
          _tid +
          '\',this)" style="margin-top:var(--sp-6);padding:var(--sp-2) var(--sp-10);font-size:var(--fs-caption);">展开全文 ▾</button>'
        : '') +
      '</div>'
    );
  };
  /* 长文展开/收起：直接改 DOM，不重画（重画会丢滚动位置与搜索框焦点） */
  window.toggleBioText = function (id, btn) {
    const el = document.getElementById(id);
    if (!el) return;
    const folded = el.style.webkitLineClamp === '6';
    el.style.webkitLineClamp = folded ? 'unset' : '6';
    el.style.display = folded ? 'block' : '-webkit-box';
    el.style.overflow = folded ? 'visible' : 'hidden';
    if (btn) btn.textContent = folded ? '收起 ▴' : '展开全文 ▾';
  };
  if (mainBox) {
    /* 头部：标题 + 总数（来源条数在下面的 Tab 上已经有了，不再重复一遍） */
    const headRow =
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-8);margin-bottom:var(--sp-10);flex-wrap:wrap;">' +
      '<div class="section-title" style="margin-bottom:0;">📖 我的专注传记</div>' +
      '<span style="font-size:var(--fs-caption);color:var(--text-light);">共 <b style="color:var(--text);">' +
      pool.length +
      '</b> 条</span></div>';
    const searchBox =
      '<input id="bioSearch" value="' +
      escapeHtml(_bioSearchKey || '') +
      '" placeholder="🔍 搜索标题、内容或年份（多个词用空格隔开）" oninput="applyBioSearch()" style="width:100%;box-sizing:border-box;margin-bottom:var(--sp-8);padding:var(--sp-8) var(--sp-10);border:1px solid var(--border-strong);border-radius:var(--radius);font-size:var(--fs-title);background:var(--card);color:var(--text);font-family:inherit;">';
    /* 一排就三个控件，全部一眼能懂：
       📅 时间（点开是日历，十年数据靠翻月份下拉等于没做导航）
       ↓ 顺序（就一个按钮，点一下换头尾）
       ✕ 清除（只在有条件时出现） */
    const _fActive = bioFilterActiveCount();
    const dateBtn =
      '<button class="btn-small" onclick="openBioCalendar()" title="点开日历，按年 / 月 / 日查看" style="padding:var(--sp-6) var(--sp-10);font-size:var(--fs-note);' +
      (_bioRange ? 'border-color:var(--primary);color: var(--primary-ink);font-weight:700;' : '') +
      '">📅 ' +
      bioRangeLabel() +
      ' ▾</button>';
    const sortBtn =
      '<button class="btn-small" onclick="toggleBioSort()" title="点一下换成另一种顺序" style="padding:var(--sp-6) var(--sp-10);font-size:var(--fs-note);">' +
      (_bioSortAsc ? '↑ 最早在前' : '↓ 最新在前') +
      '</button>';
    const filterRow =
      '<div style="display:flex;gap:var(--sp-8);align-items:center;flex-wrap:wrap;margin-bottom:var(--sp-10);">' +
      dateBtn +
      sortBtn +
      (_fActive
        ? '<button class="btn-small" onclick="clearBioFilters()" title="清空关键词/时间/顺序/来源" style="padding:var(--sp-6) var(--sp-10);font-size:var(--fs-note);color:var(--danger);">✕ 清除</button>'
        : '') +
      '</div>';
    /* 当前条件的一句话摘要：说清「现在看的是什么」，不写只有自己懂的行话 */
    const _sumBits = [];
    if (_bioRange) _sumBits.push(bioRangeLabel());
    if (_tokens.length) _sumBits.push('关键词「' + _bioSearchKey.trim() + '」');
    if (_bioSortAsc) _sumBits.push('最早在前');
    if (_bioSourceFilter !== 'all') {
      const _srcName = { diary: '日记', bio: '传记', progress: '每日进步', gratitude: '感恩日记' }[_bioSourceFilter] || _bioSourceFilter;
      _sumBits.push('只看' + _srcName);
    }
    const countLine = _sumBits.length
      ? '<div style="font-size:var(--fs-caption);color:var(--text-light);margin:0 0 var(--sp-8);">🔎 ' +
        escapeHtml(_sumBits.join(' · ')) +
        ' —— 找到 <b style="color:var(--text);">' +
        filtered.length +
        '</b> 条</div>'
      : '';
    /* 一条都没有时说清是「这天没写」还是「搜不到」，并给一个出口 —— 空白列表最让人困惑 */
    const emptyHtml =
      filtered.length || !(_sumBits.length || pool.length)
        ? ''
        : '<div style="text-align:center;padding:var(--sp-20) var(--sp-10);color:var(--text-light);font-size:var(--fs-note);line-height:1.8;">' +
          (pool.length ? '这一范围里没有内容' : '还没有传记') +
          '<br>' +
          (pool.length
            ? '<button class="btn-small" onclick="clearBioFilters()" style="margin-top:var(--sp-8);padding:var(--sp-6) var(--sp-12);font-size:var(--fs-note);">看全部时间</button>'
            : '') +
          '</div>';
    /* 来源筛选：全部 / 传记 / 每日进步 / 感恩（日记派生）。
       每个按钮带上条数 —— 不给条数的话，"感恩 0 条"和"这个按钮没生效"看起来一模一样。 */
    const _srcBtn = function (key, label, full, n) {
      const on = _bioSourceFilter === key;
      return (
        '<button class="seg-btn' +
        (on ? ' active' : '') +
        '" title="' +
        full +
        '" onclick="setBioSourceFilter(\'' +
        key +
        '\')">' +
        label +
        ' <span style="opacity:.7;font-weight:600;">' +
        n +
        '</span></button>'
      );
    };
    const sourceSeg =
      '<div class="seg-group" style="margin-bottom:var(--sp-8);">' +
      _srcBtn('all', '全部', '全部来源', pool.length) +
      _srcBtn('diary', '📔 日记', '按天看当天写的全部内容', diaryItems.length) +
      _srcBtn('progress', '🌱 进步', '日记里的「每日进步」', progItems.length) +
      _srcBtn('gratitude', '🙏 感恩', '日记里的「感恩日记」', gratItems.length) +
      '</div>';
    let pagHtml = '';
    if (totalPages > 1) {
      let bioPageOpts = '';
      for (let p = 1; p <= totalPages; p++) {
        bioPageOpts +=
          '<option value="' + p + '"' + (p === _bioPage ? ' selected' : '') + '>第 ' + p + ' 页</option>';
      }
      pagHtml =
        '<div style="display:flex;justify-content:center;align-items:center;gap:var(--sp-8);margin-top:var(--sp-12);">' +
        '<button class="btn-small" onclick="turnBioPage(-1)" ' +
        (_bioPage <= 1 ? 'disabled' : '') +
        '>‹ 上一页</button>' +
        '<select onchange="jumpBioPage(this.value)" title="跳转到第几页" style="padding:var(--sp-4) var(--sp-8); border:2px solid var(--primary); border-radius:var(--radius-sm); font-size:var(--fs-body); font-weight:700; color: var(--primary-ink); background:var(--card); cursor:pointer;">' +
        bioPageOpts +
        '</select>' +
        '<span style="font-size:var(--fs-body);color:var(--text-light);">/ ' +
        totalPages +
        ' 页</span>' +
        '<button class="btn-small" onclick="turnBioPage(1)" ' +
        (_bioPage >= totalPages ? 'disabled' : '') +
        '>下一页 ›</button>' +
        '</div>';
    }
    mainBox.style.display = 'block';
    mainBox.innerHTML =
      headRow +
      sourceSeg +
      searchBox +
      filterRow +
      countLine +
      emptyHtml +
      '<div style="display:flex;flex-direction:column;gap:var(--sp-10);">' +
      pageItems
        .map(function (b, ui) {
          return cardOf(b, b.bioIndex, ui);
        })
        .join('') +
      '</div>' +
      pagHtml;
    /* 还原搜索框焦点与光标位置（见函数头的说明） */
    if (_keepFocus) {
      const _ns = document.getElementById('bioSearch');
      if (_ns) {
        try {
          _ns.focus({ preventScroll: true });
          const _pos = Math.min(_caret || 0, _ns.value.length);
          _ns.setSelectionRange(_pos, _pos);
        } catch (e) { if (window.__silent) window.__silent(e, '01e7:renderBioSection'); }
      }
    }
  }
}
function setBioSourceFilter(key) {
  _bioSourceFilter = key === 'diary' || key === 'bio' || key === 'progress' || key === 'gratitude' ? key : 'all';
  _bioPage = 1;
  renderBioSection();
}
/* ================= 传记日历（年 / 月 / 日定位） =================
   十年数据的关键不是"分页够多"，而是**能直接跳到想看的那段**：
   点标题换年、12 个月格（带条数）、有内容的日子打点，点一下只看那天。 */
function openBioCalendar() {
  const d = _bioRange ? new Date(Number(_bioRange.slice(0, 4)), _bioRange.length > 4 ? Number(_bioRange.slice(5, 7)) - 1 : 0, 1) : new Date();
  _bioCalYear = isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  _bioCalMonth = isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth();
  _bioCalJumpOpen = false;
  renderBioCalendar();
  showModal('bioCalModal');
}
function changeBioCalMonth(d) {
  _bioCalMonth += Number(d) || 0;
  if (_bioCalMonth < 0) {
    _bioCalMonth = 11;
    _bioCalYear--;
  } else if (_bioCalMonth > 11) {
    _bioCalMonth = 0;
    _bioCalYear++;
  }
  renderBioCalendar();
}
function changeBioCalYear(d) {
  _bioCalYear += Number(d) || 0;
  renderBioCalendar();
}
function toggleBioCalJump() {
  _bioCalJumpOpen = !_bioCalJumpOpen;
  renderBioCalendar();
}
function bioCalJumpYear(y) {
  _bioCalYear = Number(y) || _bioCalYear;
  renderBioCalendar();
}
function bioCalJumpMonth(m) {
  _bioCalMonth = m - 1;
  _bioCalJumpOpen = false;
  renderBioCalendar();
}
function renderBioCalendar() {
  const title = document.getElementById('bioCalTitle');
  const grid = document.getElementById('bioCalGrid');
  if (!title || !grid) return;
  title.textContent = _bioCalYear + '年' + (_bioCalMonth + 1) + '月';
  const jump = document.getElementById('bioCalJump');
  if (jump) jump.style.display = _bioCalJumpOpen ? 'block' : 'none';
  const jy = document.getElementById('bioCalJumpYear');
  if (jy) jy.textContent = _bioCalYear + '年';
  /* 有内容的年份直接列出来（按年份倒序）——「上年」按钮一年一次，
     用了十几年的人要按十几次；这里一眼就点到想去的年。 */
  const jyh = document.getElementById('bioCalJumpYears');
  if (jyh) {
    const _years = Object.keys(_bioMonthCount)
      .map(function (k) {
        return Number(k.slice(0, 4));
      })
      .filter(function (y) {
        return y;
      })
      .filter(function (y, i, a) {
        return a.indexOf(y) === i;
      })
      .sort(function (a, b) {
        return b - a;
      });
    jyh.innerHTML = _years.length
      ? _years
          .map(function (y) {
            return (
              '<button class="cal-jump-btn" style="' +
              (y === _bioCalYear ? 'border-color:var(--primary);color: var(--primary-ink);font-weight:800;' : '') +
              '" onclick="bioCalJumpYear(' +
              y +
              ')">' +
              y +
              '</button>'
            );
          })
          .join('')
      : '<span style="font-size:var(--fs-caption);color:var(--text-light);">还没有任何内容</span>';
  }
  const jm = document.getElementById('bioCalJumpMonths');
  if (jm) {
    let mh = '';
    for (let m = 1; m <= 12; m++) {
      const key = _bioCalYear + '-' + String(m).padStart(2, '0');
      const n = _bioMonthCount[key] || 0;
      mh +=
        '<button class="cal-jump-m' +
        (m === _bioCalMonth + 1 ? ' on' : '') +
        '" style="' +
        (n ? '' : 'opacity:.45;') +
        '" onclick="bioCalJumpMonth(' +
        m +
        ')" title="' +
        (n ? n + ' 条' : '无内容') +
        '">' +
        m +
        (n ? '<span style="display:block;font-size:var(--fs-micro);font-weight:600;">' + n + '</span>' : '') +
        '</button>';
    }
    jm.innerHTML = mh;
  }
  const startDow = new Date(_bioCalYear, _bioCalMonth, 1).getDay();
  const dim = new Date(_bioCalYear, _bioCalMonth + 1, 0).getDate();
  const today = getTodayStr();
  let html = '';
  ['日', '一', '二', '三', '四', '五', '六'].forEach(function (x) {
    html += '<div style="text-align:center;font-size:var(--fs-body);color:var(--text-light);font-weight:700;">' + x + '</div>';
  });
  for (let i = 0; i < startDow; i++) html += '<div></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = _bioCalYear + '-' + String(_bioCalMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const n = _bioDayCount[ds] || 0;
    const isToday = ds === today;
    const isSel = ds === _bioRange;
    html +=
      '<div onclick="pickBioDate(\'' +
      ds +
      '\')" style="text-align:center;padding:var(--sp-6) 0;border-radius:var(--radius-sm);cursor:pointer;font-size:var(--fs-title);' +
      (n ? 'background:rgba(232,93,58,0.12);color: var(--primary-ink);font-weight:700;' : 'color:var(--text);opacity:' + (n ? 1 : 0.55) + ';') +
      (isToday ? 'border:1px solid var(--primary);' : '') +
      (isSel ? 'outline:2px solid var(--primary);' : '') +
      '">' +
      d +
      (n ? '<span style="display:block;font-size:var(--fs-micro);color: var(--primary-ink);">' + n + '</span>' : '') +
      '</div>';
  }
  grid.innerHTML = html;
}
function pickBioDate(ds) {
  setBioRange(ds);
  closeModal('bioCalModal');
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
  showToast('📅 ' + ds + ' · 找到 ' + (typeof _bioLastCount === 'number' ? _bioLastCount : 0) + ' 条');
}
function bioCalAll() {
  setBioRange('');
  closeModal('bioCalModal');
  const main = document.querySelector('.main');
  if (main) main.scrollTop = 0;
}
function bioCalToday() {
  pickBioDate(getTodayStr());
}
let _bioEditIdx = -1;
function editBio(i) {
  const list = appData.biographies || [];
  if (!list[i]) return;
  _bioEditIdx = i;
  const ta = document.getElementById('bioEditText');
  if (ta) ta.value = list[i].text;
  const t = document.getElementById('bioEditTitle');
  if (t) t.textContent = '✏️ 编辑 · ' + list[i].title;
  showModal('bioEditModal');
}
function saveBioEdit() {
  const ta = document.getElementById('bioEditText');
  const list = appData.biographies || [];
  if (_bioEditIdx < 0 || !list[_bioEditIdx]) return;
  const v = ta ? ta.value.trim() : '';
  if (!v) {
    showToast('内容不能为空');
    return;
  }
  list[_bioEditIdx].text = v;
  list[_bioEditIdx].edited = true;
  saveData();
  closeModal('bioEditModal');
  renderBioSection();
  showToast('✅ 传记已更新');
}
function toggleGhostEnabled() {
  const cb = document.getElementById('setGhostEnabled');
  if (!cb) return;
  appData.settings.ghostEnabled = cb.checked;
  saveData();
  renderGhostBar();
  showToast(cb.checked ? '👻 已显示「过去的自己」对比条' : '🙈 已隐藏「过去的自己」对比条');
}
function renderEasyModeTag() {
  const tag = document.getElementById('easyModeTag');
  if (!tag) return;
  tag.style.display = isEasyModeActive() ? 'inline' : 'none';
}
function maybeShowCareModal() {
  if (isEasyModeActive()) return;
  const today = getTodayStr();
  if (appData.lastCareModalDate === today) return;
  if (!checkCareNeeded()) return;
  appData.lastCareModalDate = today;
  saveData();
  const modal = document.getElementById('careModal');
  if (modal) modal.classList.add('show');
}
function enableEasyMode() {
  appData.rankSystem.easyModeUntil = getTodayStr();
  appData.rankSystem.easyModeBonusUsed = false;
  appData.lastCareModalDate = getTodayStr();
  saveData();
  const modal = document.getElementById('careModal');
  if (modal) modal.classList.remove('show');
  showToast(
    '🍃 轻松模式已开启：番茄时长减半（档位卡已显示实际时长），开启后第一次满 10 分钟的番茄按完整🍅计入（今日任务的星星⭐照拿，仅一次）！'
  );
  renderRankSystem();
  renderTimerRankStrip();
  /* 档位卡时长显示跟着减半，避免「点 25 分钟实际跑 15 分钟」的歧义 */
  renderDifficultyPicker();
  renderDurationSuggestion();
  updateTimerDisplay();
}
function dismissCareModal() {
  const modal = document.getElementById('careModal');
  if (modal) modal.classList.remove('show');
}
/* 通用升级轻提示：段位子段位 + 专注段数共用 */
function showLevelUpToast(icon, line1, line2, color, duration) {
  const el = document.getElementById('subRankUp');
  if (!el) return;
  document.getElementById('subRankUpIcon').textContent = icon || '🎖️';
  const txt = document.getElementById('subRankUpText');
  txt.innerHTML =
    line1 + (line2 ? '<br><span style="font-size:var(--fs-note);font-weight:600;opacity:.85;">' + line2 + '</span>' : '');
  txt.style.color = color || 'var(--primary)';
  el.classList.add('show');
  if (window._subRankTimer) clearTimeout(window._subRankTimer);
  window._subRankTimer = setTimeout(function () {
    el.classList.remove('show');
  }, duration || 2400);
}
function renderGhostBar() {
  const boxes = [document.getElementById('ghostBar'), document.getElementById('timerGhostBox')].filter(Boolean);
  if (!boxes.length) return;
  if (!isGhostEnabled()) {
    boxes.forEach(function (b) {
      b.style.display = 'none';
    });
    return;
  }
  const today = getTodayStr();
  if (appData.ghostBeatDate !== today) {
    appData.ghostBeatDate = today;
    appData.ghostBeat = false;
    appData.ghostHalf = false;
  }
  const g = getGhostStats();
  const todayFull = getTodayEffectiveFull();
  /* 没有历史数据：显示引导条，让幽灵功能始终可见（而不是消失） */
  if (g.value <= 0) {
    const guideHtml =
      '<div style="display:flex;align-items:flex-start;gap:var(--sp-8);font-size:var(--fs-note);color:var(--text-light);background:var(--surface-2);border:0;border-left:2px solid var(--hairline);border-radius:var(--radius-sm);padding:var(--sp-10) var(--sp-12);margin-top:var(--sp-8);line-height:1.6;">' +
      '<span style="font-size:var(--fs-title);">👻</span>' +
      '<span>过去的自己：每天的专注都会留下印记。某一天，你会和过去某天的自己重逢——看看那时的你走了多远。</span>' +
      '</div>';
    boxes.forEach(function (b) {
      b.style.display = 'block';
      b.innerHTML = guideHtml;
    });
    return;
  }
  const pct = Math.min(100, Math.round((todayFull / g.value) * 100));
  const leading = todayFull > g.value;
  /* 中性化：不渲染任何「落后」字眼，超过也只是让今日数字变绿（惊喜留给孩子庆祝） */
  const barHtml =
    '<div style="display:flex;justify-content:space-between;font-size:var(--fs-note);margin:var(--sp-6) 0 var(--sp-2);">' +
    '<span style="color:var(--text-light);">👻 ' +
    g.label +
    '：' +
    fmtTomatoNum(g.value) +
    ' 个</span>' +
    '<span style="' +
    (leading ? 'color: var(--green-ink);font-weight:800;' : 'color:var(--text);') +
    '">今日 ' +
    fmtTomatoNum(todayFull) +
    ' 个</span>' +
    '</div>' +
    '<div style="position:relative;height:8px;background:var(--border);border-radius:var(--radius-xs);">' +
    '<div style="position:absolute;left:0;top:0;bottom:0;width:' +
    pct +
    '%;background:var(--primary);border-radius:var(--radius-xs);opacity:.85;"></div>' +
    '<div style="position:absolute;left:' +
    pct +
    '%;top:-3px;bottom:-3px;width:2px;background:var(--green);border-radius:var(--radius-xs);"></div>' +
    '</div>';
  boxes.forEach(function (b) {
    b.style.display = 'block';
    b.innerHTML = barHtml;
  });
  /* 里程碑阶梯（每天各一次）：50% 温和鼓励 → 100% 大字庆祝，任何一天都有正反馈 */
  if (!appData.ghostHalf && todayFull >= g.value * 0.5 && todayFull < g.value) {
    appData.ghostHalf = true;
    saveData();
    let hl;
    if (g.label.indexOf('年今日') >= 0) hl = '去年今日';
    else if (g.label === '昨天') hl = '昨天的你';
    else hl = '历史水平';
    setTimeout(function () {
      showToast('🌿 已到' + hl + '的一半，状态不错！');
    }, 400);
  }
  if (leading && !appData.ghostBeat) {
    appData.ghostBeat = true;
    saveData();
    setTimeout(function () {
      ghostFlash(g.label);
    }, 400);
  }
}
function ghostFlash(label) {
  const el = document.getElementById('ghostFlash');
  if (!el) return;
  /* 按幽灵类型生成顺口文案：年同比 → 「超越一年前的自己」；历史最佳 → 「打破历史最佳」 */
  let msg;
  if (label.indexOf('年今日') >= 0) msg = '👻 你超越了一年前的自己！';
  else if (label === '昨天') msg = '👻 你超越了昨天的自己！';
  else msg = '👻 你超越了过去的自己！';
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function () {
    el.classList.remove('show');
  }, 2600);
}
/* 年度多维度分析折叠开关 */
let _yearAnaOpen = false;
function toggleYearAnalysis() {
  _yearAnaOpen = !_yearAnaOpen;
  const body = document.getElementById('yearAnaBody');
  const arrow = document.getElementById('yearAnaArrow');
  if (body) body.style.display = _yearAnaOpen ? 'block' : 'none';
  if (arrow) arrow.textContent = _yearAnaOpen ? '▾' : '▸';
}
/* ===== 年度专注地图（365 天热力图，新增） ===== */
/* 年度热力图：把「当前月(16号所在周)」对准视窗中心的稳健版。
   折叠/懒加载场景下渲染时容器可能是 0 宽（居中必然失败），
   所以额外挂 ResizeObserver：一旦容器真正可见或有尺寸变化（展开查看更多/旋转屏幕），自动重新居中。 */
function centerYearHeat() {
  try {
    const b = document.getElementById('yearHeatmapContainer');
    if (!b || !b.scrollWidth) return;
    if (b.scrollWidth <= b.clientWidth + 2) return; /* 内容不溢出：整年都在视野里，无需滚动 */
    const cur = new Date();
    let s0 = new Date(cur.getFullYear(), 0, 1);
    while (s0.getDay() !== 0) s0.setDate(s0.getDate() - 1);
    const mid = new Date(cur.getFullYear(), cur.getMonth(), 16);
    const wi = Math.floor((mid - s0) / (7 * DAY_MS)); /* 当前月所在列 */
    const colW = 15; /* 12px 格 + 3px gap */
    const colLeft = wi * colW - 3; /* 第 wi 列左缘（首列左缘=0，其余减一个 gap） */
    /* 当前月列放视口约 40% 处：右侧留出 60% 空间，让 10-12 月“未来空月+月份标签”直接可见、提示可继续滑动；左侧保留全年历史可回滚 */
    const target = Math.max(0, Math.min(b.scrollWidth - b.clientWidth, colLeft + 6 - b.clientWidth * 0.4));
    if (Math.abs(b.scrollLeft - target) > 2) b.scrollLeft = target;
  } catch (e) { if (window.__silent) window.__silent(e, '01e7:centerYearHeat'); }
}
(function () {
  try {
    if (window.__yrCenterResize) return;
    window.__yrCenterResize = true;
    const b = document.getElementById('yearHeatmapContainer');
    if (!b || typeof ResizeObserver === 'undefined') return;
    let _seen = false;
    new ResizeObserver(function () {
      try {
        if (b.clientWidth > 8 && b.scrollWidth > b.clientWidth + 2) {
          centerYearHeat();
          _seen = true;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '01e7:centerYearHeat'); }
    }).observe(b);
  } catch (e) { if (window.__silent) window.__silent(e, '01e7:centerYearHeat'); }
})();
/* ===== renderYearHeatmap 年度热力图区块拆分 =====
 * 纯平移：窗口格子/统计算账/指标卡/12月分布/文字分析 拆为 5 个独立顶层函数（紧贴本函数上方），
 * 渲染 helper 以 calcYearReportStats 返回的 stats 集合为唯一数据入参；函数间无交叉依赖、逻辑零改写。
  */
function renderYearHeatGrid(dayMap, now) {
/* 窗口固定为「今年 1-12 月」+ 边界 padding 调到周日/周六，
   保证每年 1-12 月格子 + 月份标签全部完整显示。
   用「当前月±6 月」会让 1-2 月 / 11-12 月掉出窗口。 */
  let start = new Date(now.getFullYear(), 0, 1);
  while (start.getDay() !== 0) start.setDate(start.getDate() - 1);
  let _end = new Date(now.getFullYear(), 11, 31);
  while (_end.getDay() !== 6) _end.setDate(_end.getDate() + 1);
  const weeks = [];
  let curWeek = [];
  const d = new Date(start);
  while (d <= _end) {
    const ds = getDateStr(d);
    const v = dayMap[ds] || 0;
    /* 分档统一走 pomoHeatLevel（定义在 01eD），月历与年度地图共用一套阈值 */
    const cls = 'c' + pomoHeatLevel(v);
    /* 格子太小点不到，去掉点击跳转（玩家更在意颜色深浅） */
    curWeek.push('<div class="hm-cell ' + cls + '" title="' + ds + '：' + fmtTomatoNum(v) + ' 个🍅"></div>');
    d.setDate(d.getDate() + 1);
    if (curWeek.length === 7) {
      weeks.push(curWeek);
      curWeek = [];
    }
  }
  if (curWeek.length) {
    while (curWeek.length < 7) curWeek.push('<div class="hm-cell c0" style="visibility:hidden;"></div>');
    weeks.push(curWeek);
  }
/* 年份/月份合并循环，年份只在 1 月切换列（且非起始列）显示：
   两行独立渲染时，2025-12-28 与 2026-01-04 紧邻，4 字符「2025」会溢出 12px 列宽并覆盖「2026」。
   只让「1 月」这一列承载年份，月份切换但不是 1 月时年份列空白，两者不再水平冲突。 */
  let monthRow = '',
    yearRow = '';
  let lastMonth = -2;
  const thisY = now.getFullYear();
  for (let w = 0; w < weeks.length; w++) {
    const wd = new Date(start.getTime() + w * 7 * DAY_MS);
    const m = wd.getMonth();
    const inYear = wd.getFullYear() === thisY;
    /* 只有落在今年的列承担月份/年份标签：窗口两端为对齐周伸出的前后年列保持空白占位，
       最左不再出现去年的「12月」尾巴，月份行严格 1→12 */
    if (inYear && m !== lastMonth) {
      monthRow +=
        '<span style="display:inline-block;width:12px;flex-shrink:0;text-align:center;font-size:var(--fs-micro);color:var(--text-light);white-space:nowrap;overflow:visible;cursor:pointer;" title="查看 ' +
        (m + 1) +
        ' 月统计" onclick="jumpToBlock(\'monthlyStatWrap\')">' +
        (m + 1) +
        '月</span>';
      if (m === 0) {
        yearRow +=
          '<span style="display:inline-block;width:12px;flex-shrink:0;text-align:center;font-size:var(--fs-tiny);font-weight:800;color: var(--primary-ink);white-space:nowrap;overflow:visible;">' +
          thisY +
          '</span>';
      } else {
        yearRow += '<span style="display:inline-block;width:12px;flex-shrink:0;"></span>';
      }
      lastMonth = m;
    } else {
      monthRow += '<span style="display:inline-block;width:12px;flex-shrink:0;"></span>';
      yearRow += '<span style="display:inline-block;width:12px;flex-shrink:0;"></span>';
    }
  }
  return { weeks: weeks, monthRow: monthRow, yearRow: yearRow };
}

function calcYearReportStats(dayMap, now) {
  /* 年度小结（指标卡 + 详细多维度分析） */
  const yearRecs = Object.keys(dayMap).filter(function (k) {
    /* 上限必须写死：地图现在能翻往年，只看 >= 年开始会把之后所有年份的记录
       也算进这一年（翻到 2024 会看见 2025/2026 的量）。 */
    const y = now.getFullYear();
    return k >= y + '-01-01' && k <= y + '-12-31';
  });
  let total = 0,
    bestDs = '',
    bestV = 0;
  const monthMap = {};
  yearRecs.forEach(function (k) {
    const v = dayMap[k];
    total += v;
    if (v > bestV) {
      bestV = v;
      bestDs = k;
    }
    const mm = k.slice(5, 7);
    monthMap[mm] = (monthMap[mm] || 0) + v;
  });
  let bestMonth = '--',
    bestMV = -1,
    worstMonth = '--',
    worstMV = Infinity;
  for (const mm in monthMap) {
    if (monthMap[mm] > bestMV) {
      bestMV = monthMap[mm];
      bestMonth = mm;
    }
    if (monthMap[mm] < worstMV) {
      worstMV = monthMap[mm];
      worstMonth = mm;
    }
  }
  /* 今年最长连续天数 */
  let maxStreak = 0,
    cur = 0,
    curStart = -1,
    curEnd = -1,
    tmpStart = -1,
    bestStreakStart = -1,
    bestStreakEnd = -1;
  const yStart = new Date(now.getFullYear(), 0, 1);
  const yd = new Date(yStart);
  while (yd <= now) {
    const ds = getDateStr(yd);
    if ((dayMap[ds] || 0) > 0) {
      if (cur === 0) tmpStart = ds;
      cur++;
      if (cur > maxStreak) {
        maxStreak = cur;
        bestStreakStart = tmpStart;
        bestStreakEnd = ds;
      }
    } else {
      cur = 0;
    }
    yd.setDate(yd.getDate() + 1);
  }
  const yearDayCount = Math.floor((now - yStart) / DAY_MS) + 1;
  const activeDays = yearRecs.length;
  const avgPerActive = activeDays ? total / activeDays : 0;
  const avgPerDay = total / yearDayCount;
  const totalMinutes = yearRecs.reduce(function (s, k) {
    return s + (dayMap[k] || 0) * 25;
  }, 0);
  /* 工作日 vs 周末 */
  let workTotal = 0,
    workDays = 0,
    wkTotal = 0,
    wkDays = 0;
  yearRecs.forEach(function (k) {
    const d = new Date(k + 'T00:00:00');
    const wd = d.getDay();
    if (wd === 0 || wd === 6) {
      wkTotal += dayMap[k];
      if (dayMap[k] > 0) wkDays++;
    } else {
      workTotal += dayMap[k];
      if (dayMap[k] > 0) workDays++;
    }
  });
  const workAvg = workDays ? workTotal / workDays : 0;
  const wkAvg = wkDays ? wkTotal / wkDays : 0;
  /* 一周内最佳工作日（DOW） */
  const dowMap = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    dowCnt = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  yearRecs.forEach(function (k) {
    const d = new Date(k + 'T00:00:00');
    const wd = d.getDay();
    dowMap[wd] += dayMap[k];
    if (dayMap[k] > 0) dowCnt[wd]++;
  });
  let bestDow = -1,
    bestDowAvg = -1;
  for (let i = 0; i < 7; i++) {
    const a = dowCnt[i] ? dowMap[i] / dowCnt[i] : 0;
    if (a > bestDowAvg) {
      bestDowAvg = a;
      bestDow = i;
    }
  }
  const dowNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  /* 月份分布：前/中/后阶段对比 */
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const monthArr = [];
  for (let m = 0; m < 12; m++) {
    monthArr.push({ m: m, total: monthMap[String(m + 1).padStart(2, '0')] || 0 });
  }
  let firstHalfT = 0,
    secondHalfT = 0;
  monthArr.forEach(function (x) {
    if (x.m < 6) firstHalfT += x.total;
    else secondHalfT += x.total;
  });
  const pastHalf = Math.min(6, now.getMonth() + 1);
  const recentHalf = Math.max(0, now.getMonth() + 1 - 6);
  const avgFirst = firstHalfT / Math.max(1, pastHalf);
  const avgSecond = secondHalfT / Math.max(1, recentHalf);
  /* 趋势：上半年 vs 下半年（按月均） */
  const trendArrow = avgSecond > avgFirst * 1.15 ? '📈 上行' : avgSecond < avgFirst * 0.85 ? '📉 下行' : '➡️ 平稳';
  /* 一致性得分：变异系数（CV）的反向，1 - 偏差率（活跃日中标准差/均） */
  let consistency = '—';
  if (activeDays >= 7) {
    const mean = avgPerActive;
    const variance =
      yearRecs.reduce(function (s, k) {
        return s + Math.pow((dayMap[k] || 0) - mean, 2);
      }, 0) / activeDays;
    const std = Math.sqrt(variance);
    const cv = mean ? std / mean : 0;
    if (cv < 0.4) consistency = '高 🟢';
    else if (cv < 0.8) consistency = '中 🟡';
    else consistency = '低 🔴';
  }
  return {
    total: total, bestV: bestV, bestDs: bestDs, bestMonth: bestMonth, bestMV: bestMV,
    worstMonth: worstMonth, maxStreak: maxStreak, yearDayCount: yearDayCount,
    activeDays: activeDays, avgPerActive: avgPerActive, avgPerDay: avgPerDay, totalMinutes: totalMinutes,
    workDays: workDays, wkDays: wkDays, workAvg: workAvg, wkAvg: wkAvg,
    bestDow: bestDow, bestDowAvg: bestDowAvg, dowNames: dowNames, monthNames: monthNames,
    monthArr: monthArr, pastHalf: pastHalf, recentHalf: recentHalf, avgFirst: avgFirst,
    avgSecond: avgSecond, trendArrow: trendArrow, consistency: consistency
  };
}

function renderYearSummaryHTML(st) {
  const { total, bestV, bestDs, maxStreak, bestMonth, activeDays, avgPerActive, consistency } = st;
  const summary =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-8);margin:var(--sp-10) 0 var(--sp-8);">' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-6);text-align:center;"><div style="font-size:var(--fs-title);font-weight:900;color: var(--primary-ink);">' +
    total +
    '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">今年🍅</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-6);text-align:center;"><div style="font-size:var(--fs-title);font-weight:900;color: var(--blue-ink);">' +
    bestV +
    '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">最佳日' +
    (bestDs ? ' ' + bestDs.slice(5) : '') +
    '</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-6);text-align:center;"><div style="font-size:var(--fs-title);font-weight:900;color: var(--green-ink);">' +
    maxStreak +
    '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">最长连续</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-6);text-align:center;"><div style="font-size:var(--fs-title);font-weight:900;color: var(--yellow-ink);">' +
    bestMonth +
    '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">最佳月份</div></div>' +
    '</div>';
  /* 4 个次级指标小卡（活跃天数 + 日均 + 总专注时长 + 起始强度） */
  const subMetrics =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-6);margin:0 0 var(--sp-10);font-size:var(--fs-tiny);color:var(--text-light);text-align:center;">' +
    '<div style="background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-4) var(--sp-4);"><b style="font-size:var(--fs-body);color:var(--text);">' +
    activeDays +
    '</b><br>活跃天数</div>' +
    '<div style="background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-4) var(--sp-4);"><b style="font-size:var(--fs-body);color:var(--text);">' +
    avgPerActive.toFixed(1) +
    '</b><br>活跃日均</div>' +
    '<div style="background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-4) var(--sp-4);"><b style="font-size:var(--fs-body);color:var(--text);">' +
    (avgPerActive >= 1 ? '已达' : '未达') +
    '</b><br>日均≥1</div>' +
    '<div style="background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-4) var(--sp-4);"><b style="font-size:var(--fs-body);color:var(--text);">' +
    (consistency !== '—' ? consistency.split(' ')[0] : '—') +
    '</b><br>稳定性</div>' +
    '</div>';
  return summary + subMetrics;
}

function renderYearMonthChart(st) {
  const { monthArr, monthNames, bestMonth } = st;
  /* 月份数据可视化条 */
  const maxMonth = Math.max.apply(
    null,
    monthArr.map(function (x) {
      return x.total;
    })
  );
  const monthBars = monthArr
    .map(function (x) {
      const pct = maxMonth ? Math.round((x.total / maxMonth) * 100) : 0;
      const isBest = x.m + 1 === parseInt(bestMonth, 10);
      return (
        '<div style="display:flex;align-items:center;gap:var(--sp-4);font-size:var(--fs-tiny);">' +
        '<span style="width:24px;color:var(--text-light);text-align:right;">' +
        monthNames[x.m] +
        '</span>' +
        '<div style="flex:1;background:var(--bg);border-radius:var(--radius-xs);height:10px;overflow:hidden;border:1px solid var(--border);">' +
        '<div style="height:100%;width:' +
        pct +
        '%;background:' +
        (isBest ? 'linear-gradient(90deg,#FFD54F,#FF9800)' : 'linear-gradient(90deg,#FFD180,#FFB74D)') +
        ';border-radius:var(--radius-xs);"></div></div>' +
        '<span style="width:28px;font-weight:700;color:var(--text);text-align:right;">' +
        x.total +
        '</span></div>'
      );
    })
    .join('');
  /* 显示 12 月的迷你条形图 */
  const monthChart =
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-10);margin:var(--sp-8) 0 var(--sp-6);">' +
    '<div style="font-size:var(--fs-note);font-weight:700;color:var(--text);margin-bottom:var(--sp-6);">📅 12 个月番茄分布 <span style="font-size:var(--fs-tiny);color:var(--text-light);font-weight:400;">（越高越强 · 当前最佳 ' +
    monthNames[parseInt(bestMonth, 10) - 1] +
    '）</span></div>' +
    monthBars +
    '</div>';
  return monthChart;
}

function renderYearInsightLines(st, now) {
  const { total, activeDays, yearDayCount, avgPerActive, workDays, wkDays, workAvg, wkAvg,
          consistency, pastHalf, recentHalf, avgFirst, avgSecond, trendArrow, bestDow, dowNames,
          bestDowAvg, bestMV, bestMonth, bestV, bestDs, totalMinutes } = st;
  /* 详细文字分析（从 5 个维度解读年度数据，不只是念数） */
  const nowMonth = now.getMonth() + 1;
  const insightLines = [];
  if (total <= 0) {
    insightLines.push('今年还没有番茄记录。从今天开始，每一个 🍅 都是给明天的你的礼物。');
  } else {
    /* 节奏 */
    if (activeDays >= 300)
      insightLines.push(
        '🗓️ <b>全年节奏</b>：你今年有 <b>' +
          activeDays +
          ' 天</b>在专注，覆盖全年 <b>' +
          Math.round((activeDays / yearDayCount) * 100) +
          '%</b> 的日子——这已经是专业级的稳定度。活跃日均 <b>' +
          avgPerActive.toFixed(1) +
          '</b> 个🍅，相当于每次坐下来就能完成一整个番茄。'
      );
    else if (activeDays >= 100)
      insightLines.push(
        '🗓️ <b>全年节奏</b>：你今年坚持了 <b>' +
          activeDays +
          ' 天</b>的专注，活跃日均 <b>' +
          avgPerActive.toFixed(1) +
          '</b> 个🍅。每隔几天就能坐下来一次——这就是进步的样子。'
      );
    else if (activeDays >= 30)
      insightLines.push(
        '🗓️ <b>全年节奏</b>：今年 <b>' +
          activeDays +
          ' 天</b>都有产出，是起步阶段很扎实的数据。下一步可以试试把连续天数推高。'
      );
    else
      insightLines.push('🗓️ <b>全年节奏</b>：今年 <b>' + activeDays + ' 天</b>有专注记录。看着少，但每一步都是根基。');
    /* 工作日 vs 周末 */
    if (workDays > 0 && wkDays > 0) {
      const diffPct = workAvg ? (wkAvg / workAvg) * 100 - 100 : 0;
      if (diffPct > 15)
        insightLines.push(
          '💼 <b>工作日 vs 周末</b>：工作日均 <b>' +
            workAvg.toFixed(1) +
            '</b> vs 周末均 <b>' +
            wkAvg.toFixed(1) +
            '</b>（高 <b>' +
            Math.round(diffPct) +
            '%</b>）——周末反而是你更能专注的时段，可以尝试把更重要的任务挪过来。'
        );
      else if (diffPct < -15)
        insightLines.push(
          '💼 <b>工作日 vs 周末</b>：工作日均 <b>' +
            workAvg.toFixed(1) +
            '</b> vs 周末均 <b>' +
            wkAvg.toFixed(1) +
            '</b>（低 <b>' +
            Math.abs(Math.round(diffPct)) +
            '%</b>）——工作日状态更稳定。周末稍微掉线是正常的，毕竟你在休息。'
        );
      else
        insightLines.push(
          '💼 <b>工作日 vs 周末</b>：工作日 <b>' +
            workAvg.toFixed(1) +
            '</b> ≈ 周末 <b>' +
            wkAvg.toFixed(1) +
            '</b>——你是个均衡输出型选手，不挑日子都能进入状态。'
        );
    } else if (wkDays > 0 && workDays === 0) {
      insightLines.push(
        '💼 <b>工作日 vs 周末</b>：你今年只在周末有专注产出（<b>' +
          wkDays +
          ' 天</b>）。如果工作日也能提个 15 分钟试试，年度产量会翻倍。'
      );
    } else if (workDays > 0 && wkDays === 0) {
      insightLines.push(
        '💼 <b>工作日 vs 周末</b>：专注都发生在工作日（<b>' +
          workDays +
          ' 天</b>）。周末 0 产出——给自己放假也是种专注。'
      );
    }
    /* 一致性 */
    insightLines.push(
      '📊 <b>稳定性</b>：<b>' +
        consistency +
        '</b>。变异系数反映你「每天产出是否稳定」——稳定性越高，越容易把状态变成下意识。'
    );
    /* 月度趋势 */
    if (pastHalf >= 2) {
      insightLines.push(
        trendArrow.slice(0, 2) +
          ' <b>月度趋势</b>：前 ' +
          pastHalf +
          ' 月均 <b>' +
          avgFirst.toFixed(1) +
          '</b> 个🍅 · 近 ' +
          recentHalf +
          ' 月均 <b>' +
          avgSecond.toFixed(1) +
          '</b> 个🍅。' +
          (avgSecond > avgFirst ? '下半年在加力，越打越顺手。' : '近期有波动，看看是什么打扰了你。')
      );
    }
    /* 高产日/周规律 */
    if (bestDow >= 0) {
      insightLines.push(
        '🎯 <b>你最高效的星期</b>：<b>' +
          dowNames[bestDow] +
          '</b>（活跃日均 <b>' +
          bestDowAvg.toFixed(1) +
          '</b> 个🍅）。本周这一天，是你安排大事的好窗口。'
      );
    }
    /* 最佳月份（最深信息） */
    if (bestMV > 0) {
      insightLines.push(
        '🏆 <b>最佳月份 ' +
          parseInt(bestMonth, 10) +
          '月</b>：累计 <b>' +
          bestMV +
          '</b> 个🍅，日均 <b>' +
          (bestMV / new Date(now.getFullYear(), parseInt(bestMonth, 10), 0).getDate()).toFixed(1) +
          '</b>。回忆一下那个月你做对了什么——把那个状态复制到现在。'
      );
    }
    /* 最佳日峰值 */
    if (bestV >= 8)
      insightLines.push(
        '⚡ <b>巅峰日 ' +
          bestDs.slice(5) +
          '</b>：单日 <b>' +
          bestV +
          '</b> 个🍅（约 ' +
          Math.round((bestV * 25) / 60) +
          ' 小时纯专注）——这是你今年最有力量的 25 分钟们堆出来的成绩。'
      );
    else if (bestV >= 4)
      insightLines.push(
        '⚡ <b>巅峰日 ' + bestDs.slice(5) + '</b>：单日 <b>' + bestV + '</b> 个🍅。稳产不爆，是可持续的节奏。'
      );
    /* 累计时间 */
    insightLines.push(
      '⏱️ <b>累计专注</b>：<b>' +
        Math.round(totalMinutes / 60) +
        '</b> 小时——这是 <b>' +
/* totalMinutes 的单位是分钟，要除以 POMO_DEFAULT_MINUTES(25) 折算成「25 分钟番茄」个数。
   除以 1500（按秒算）会让数字小 60 倍（365🍅 的年显示成 6）。 */
        (totalMinutes / POMO_DEFAULT_MINUTES).toFixed(0) +
        '</b> 个 25 分钟番茄的沉淀。换算成连续看一部电影（2 小时），要看 <b>' +
        Math.round(totalMinutes / 120) +
        '</b> 部才到这个量。'
    );
  }
  return insightLines;
}

function renderYearHeatmap() {
  const box = document.getElementById('yearHeatmapContainer');
  if (!box) return;
  const now = yrMapAnchorDate();
  /* 标题上的年份跟着走（模板里那个可点的年份按钮） */
  const _yt = document.getElementById('yrMapYear');
  if (_yt) _yt.textContent = yrMapYearNum();

/* 热路径走缓存助手；删掉文件末尾的性能增强模块即回退到原逻辑 */
  const dayMap = (function () {
    try {
      if (window.__enhYearDayMap) return window.__enhYearDayMap();
    } catch (e) { if (window.__silent) window.__silent(e, '01e-renderYearHeatmap'); }
    const _m = {};
    (appData.records || []).forEach(function (r) {
      const ds = getDateStr(r.startTime);
      _m[ds] = (_m[ds] || 0) + getPomos(r);
    });
    return _m;
  })();
  const { weeks, monthRow, yearRow } = renderYearHeatGrid(dayMap, now);
  const st = calcYearReportStats(dayMap, now);
  const summaryHTML = renderYearSummaryHTML(st);
  const monthChart = renderYearMonthChart(st);
  const insightLines = renderYearInsightLines(st, now);
  /* 移除 4 个跳转按钮（和 statsJumpNav 顶部按钮重复，留一个即可）+ 说明文字改为可折叠 */
  const helpToggle =
    '<div onclick="toggleFold(\'yearHeatHelpBody\',\'yearHeatHelpArrow\')" style="font-size:var(--fs-caption);color:var(--text-light);cursor:pointer;padding:var(--sp-4) var(--sp-8);margin:var(--sp-4) 0 var(--sp-6);background:var(--bg);border:1px solid var(--hairline);border-radius:var(--radius-sm);user-select:none;">💡 怎么看热力图？点击展开说明 <span id="yearHeatHelpArrow" style="font-size:var(--fs-caption);">▸</span></div>';
  const helpBody =
    '<div id="yearHeatHelpBody" style="display:none;font-size:var(--fs-tiny);color:var(--text-light);margin:var(--sp-2) 0 var(--sp-6);line-height:1.7;padding:0 var(--sp-4);">颜色越深 = 当天番茄越多（浅黄 → 橙 → 红）；点月份可跳转月度统计；当前月居中，左滑看过去、右滑看未来。</div>';
  const detailBox =
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);margin:var(--sp-6) 0 var(--sp-10);overflow:hidden;">' +
    '<div onclick="toggleYearAnalysis()" style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-10) var(--sp-12);cursor:pointer;-webkit-tap-highlight-color:transparent;">' +
    '<span style="font-size:var(--fs-body);font-weight:800;color: var(--primary-ink);">🔬 多维度年度分析</span>' +
    '<span id="yearAnaArrow" style="font-size:var(--fs-note);color:var(--text-light);">' +
    (_yearAnaOpen ? '▾' : '▸') +
    '</span></div>' +
    '<div id="yearAnaBody" style="display:' +
    (_yearAnaOpen ? 'block' : 'none') +
    ';padding:var(--sp-2) var(--sp-12) var(--sp-12);border-top:1px solid var(--border);font-size:var(--fs-caption);line-height:1.85;color:var(--text-light);">' +
    insightLines.join('<br>') +
    '</div>' +
    '</div>';
  /* 把「统计内容」与「热力图」彻底分开 —
     统计(指标卡/12月分布/多维分析/跳转按钮/说明)固定写在 yearHeatmapMeta（不随格子动），
     只有 年份行+月份行+格子 在 yearHeatmapContainer 里横滚（yearRow 已合并到上方月份循环，年份仅在 1 月切换列显示） */
  const meta = document.getElementById('yearHeatmapMeta');
  /* 往年：把整块文案里的「今年」统一换成具体年份 —— 翻到 2023 还说「今年 1 天有专注」
     等于在撒谎。只替换这一个词，句子结构不动（文案还被其它用例锁着）。 */
  let html = summaryHTML + detailBox + monthChart + helpToggle + helpBody;
  if (yrMapYearNum() !== new Date().getFullYear()) {
    const _y = yrMapYearNum();
    /* 汇总卡的「今年🍅」= 这一年总共，说「全年」才不会和前面那个数字粘成「12025 年」；
       洞察句子里的「今年」换成具体年份，并给「你今年」补一个「在」，否则是「你2025 年」。 */
    html = html
      .replace(/今年🍅/g, '全年🍅')
      .replace(/你今年/g, '你在 ' + _y + ' 年')
      .replace(/今年/g, _y + ' 年');
  }
  if (meta) meta.innerHTML = html;
  box.innerHTML =
    '<div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-2);">' +
    yearRow +
    '</div><div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-4);">' +
    monthRow +
    '</div>' +
    '<div style="display:flex;gap:var(--sp-2);">' +
    weeks
      .map(function (wk) {
        return '<div style="display:flex;flex-direction:column;gap:var(--sp-2);">' + wk.join('') + '</div>';
      })
      .join('') +
    '</div>';
  /* 默认定位 — 当前月中点（16 号所在周）对准视窗中心。
     年度图可能被 requestIdleCallback 推迟重绘（晚于本次居中），所以分多拍反复校准：
     任何一次晚到的重绘把滚动归零后，都会在下一拍被拉回中间 */
  try {
    centerYearHeat();
  } catch (e) { if (window.__silent) window.__silent(e, '01e7:renderYearHeatmap'); }
  let __ys = [120, 320, 600, 1000];
  for (let __i = 0; __i < __ys.length; __i++) {
    (function (_ms) {
      setTimeout(function () {
        try {
          centerYearHeat();
        } catch (e) { if (window.__silent) window.__silent(e, '01e7:renderYearHeatmap'); }
      }, _ms);
    })(__ys[__i]);
  }
}
/* 周/月简报整块砍掉，但 _sumPomos/_sumMinutes 被「每日专注总结」继续使用，
   必须保留为真实函数（之前误注释导致日志-每日日记页报错、列表渲染不出来） */
function _sumMinutes(recs) {
  return Math.round(
    recs.reduce(function (s, r) {
      if (isLogRecord(r)) return s; /* 仅记录：不算专注分钟 */
      return s + recordSeconds(r) / 60;
    }, 0)
  );
}
/* 番茄点数求和：一律走权威 getPomos（自带「老记录没有 pomos 字段」的兜底），
   绝不直接读 r.pomos —— 直接读会让同一份数据在这里显示 0、在别处显示 3（同一事实两个口径）。 */
function _sumPomos(recs) {
  return recs.reduce(function (s, r) {
    return s + getPomos(r);
  }, 0);
}
/* ===== 周/月简报（新增，后移除）：太啰嗦被砍，原有实现已删除 ———— */
/* —— 周报/月报简报（新增，已移除：太啰嗦被砍，详见 briefBox 移除注释） —— */
/* ===== 每日专注总结（新增）：日记页收尾仪式 ===== */
function renderDailyFocusSummary(dateStr) {
  const box = document.getElementById('diarySummaryBox');
  if (!box) return;
  const ds = dateStr || getTodayStr();
  const isToday = ds === getTodayStr();
  /* 「仅记录」不进每日专注总结：那天只补记过配眼镜，就该说「还没有专注记录」 */
  const recs = (appData.records || []).filter(function (r) {
    return getDateStr(r.startTime) === ds && !isLogRecord(r);
  });
  const poms = _sumPomos(recs);
  const mins = _sumMinutes(recs); /* 实际计时合计（有效秒数），专注时长就用它 */
  /* ★ 卡片主数字 = **实际计时**，与日志页 logDayStats().focus 同一口径。
     这里一度改成 pomosToMinutes(Σ getPomos) 去"对齐"日志页，方向反了：
     getPomos 是结算自评的产物 —— 同样坐满 25 分钟，可以记「完整🍅」也可以记「半个🍅」，
     拿自评乘 25 分钟当时长，等于让评价去改钟表（两段各 25 分钟记成半个，50 分钟只剩 25）。
     时长认秒表，成果认🍅；两个数都在卡片上，差在哪一目了然（下面的🍅折算小字）。 */
  const focusMin = Math.round(mins);
  const pomoMin = pomosToMinutes(poms);
  const intN = recs.filter(function (r) {
    return (r.totalInterruptSeconds || 0) > 0 || (r.interruptions && r.interruptions.length);
  }).length;
  const doneTodos = todosDoneOn(ds);
  const target =
    appData.rankSystem.dailyTask && appData.rankSystem.dailyTask.date === ds
      ? appData.rankSystem.dailyTask.target || 3
      : null;
  let advise;
  if (!recs.length) advise = (isToday ? '今天' : '这一天') + '还没有专注记录，从一个小番茄开始吧 🍅';
  else if (target != null && poms >= target && doneTodos > 0)
    advise = '今日段位任务 + 待办都搞定！状态很好，可以挑战下注/加量 💪';
  else if (target != null && poms >= target) advise = '段位番茄任务完成 ✅，但今日待办还没勾——挑一项推进 🎯';
  else if (doneTodos >= 3) advise = '今日已勾 ' + doneTodos + ' 项待办，节奏稳！把剩下的也清掉 ✨';
  else if (poms >= 8) advise = '这一天产量很高，注意劳逸结合，保持这个节奏 ⚡';
  else if (poms >= 4) advise = '节奏不错！可以把目标再往上顶一点点 📈';
  else if (poms >= 1) advise = '起步了！连续是上瘾的关键，保持住 🎯';
  else advise = '状态不错，满血开工 🌟';
  const dtxt = isToday ? '今日专注总结' : ds.slice(0, 4) + '年' + ds.slice(5) + ' 专注总结';
  box.innerHTML =
    '<div class="week-chart" style="margin:0;"><h3>📖 ' +
    dtxt +
    '</h3>' +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-8);margin-bottom:var(--sp-10);">' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-8);text-align:center;"><div style="font-size:var(--fs-sub);font-weight:900;color: var(--primary-ink);">' +
    fmtTomatoNum(poms) +
    '</div><div style="font-size:var(--fs-caption);color:var(--text-light);">🍅 番茄</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-8);text-align:center;"><div style="font-size:var(--fs-sub);font-weight:900;color: var(--blue-ink);">' +
    fmtDurMin(focusMin) +
    '</div><div style="font-size:var(--fs-caption);color:var(--text-light);">⏱️ 专注时长</div>' +
    (pomoMin !== focusMin
      ? '<div style="font-size:var(--fs-caption);color:var(--text-light);">🍅 折算 ' + fmtDurMin(pomoMin) + '</div>'
      : '') +
    '</div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-8);text-align:center;"><div style="font-size:var(--fs-sub);font-weight:900;color: var(--green-ink);">' +
    doneTodos +
    '</div><div style="font-size:var(--fs-caption);color:var(--text-light);">✅ 完成任务</div></div>' +
    '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-8);text-align:center;"><div style="font-size:var(--fs-sub);font-weight:900;color: var(--yellow-ink);">' +
    intN +
    '</div><div style="font-size:var(--fs-caption);color:var(--text-light);">🔔 打断次数</div></div>' +
    '</div>' +
    '<div style="font-size:var(--fs-body);color:var(--text);background:var(--card);border-left:4px solid var(--primary);padding:var(--sp-8) var(--sp-12);border-radius:var(--radius-sm);">💡 建议：' +
    advise +
    '</div>' +
    '</div>';
}
/* [瓶子专注 · 作者 瓶子满天星 · ©2026 · MIT] */
/* ===== renderStats 区块拆分 =====
 * 把 renderStats 内的 4 个独立渲染块原样搬为同文件顶层函数，
 * 逻辑 / HTML / SVG 零改写，renderStats 只留编排骨架。 */
function renderStatsEmpty() {
    let _emptyHtml =
      '<div style="text-align:center;padding:36px var(--sp-10);color:var(--text-light);font-size:var(--fs-title);line-height:1.8;">📊 还没有专注记录<br>完成第一个番茄后，这里会出现统计图表</div>';
    ['trendChart', 'trendLegend', 'moodChart'].forEach(function (id) {
      let el = document.getElementById(id);
      if (el) el.innerHTML = _emptyHtml;
    });
    let hc = document.getElementById('heatmapContainer');
    if (hc) {
      hc.innerHTML = _emptyHtml;
      hc.style.display = 'block';
    }
    let yhc = document.getElementById('yearHeatmapContainer');
    if (yhc)
      yhc.innerHTML =
        '<div style="text-align:center;padding:var(--sp-20);color:var(--text-light);font-size:var(--fs-body);">完成第一个番茄后，这里会出现年度专注地图</div>';
    let ym = document.getElementById('yearHeatmapMeta');
    if (ym) ym.innerHTML = '';
}

/* renderTrendChart 拆分出的纯几何/刻度 helper（轴向上限取整 / 图配置 / 坐标换算） */
function tChartNice(v) {
  v = Math.max(1, v || 0);
  if (v <= 4) return 4;
  let m = Math.pow(10, Math.floor(Math.log10(v)));
  let n = v / m;
  let sk = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return Math.round(sk * m * 10) / 10;
}
function trendChartCfg(trendData) {
  /* 边距随轴标签字号（--fs-caption 14px）一起放大，否则左侧"个数"和底部日期会被裁 */
  const tW = 320, tH = 200, tPadL = 40, tPadB = 32, tPadT = 22, tPadR = 36;
  const chartW = tW - tPadL - tPadR, chartH = tH - tPadT - tPadB;
  const tMaxCnt = tChartNice(Math.max.apply(null, [1].concat(trendData.map(function (d) { return Math.max(d.full, d.half, d.interrupts); }))));
  const tMaxMin = tChartNice(Math.max.apply(null, [1].concat(trendData.map(function (d) { return d.minutes; }))));
  return { tW: tW, tH: tH, padL: tPadL, padB: tPadB, padT: tPadT, padR: tPadR, chartW: chartW, chartH: chartH, tMaxCnt: tMaxCnt, tMaxMin: tMaxMin, tBase: tPadT + chartH };
}
function trendChartX(cfg, i, len) {
  return cfg.padL + (i / (len - 1)) * cfg.chartW;
}
function trendChartY(cfg, v, max) {
  return cfg.padT + cfg.chartH - Math.max(0, v / max) * cfg.chartH;
}
function renderTrendChart(day7) {
    // 近7天趋势折线图（SVG）· 几何/刻度已提顶层 helper，主函数骨架化
    const trendEl = document.getElementById('trendChart');
    if (!trendEl) return;
    const trendData = day7.map(function (d) {
      return { label: d.label, full: d.full, half: d.half, minutes: d.minutes, interrupts: d.ints };
    });
    const cfg = trendChartCfg(trendData);
    const tW = cfg.tW, tH = cfg.tH, tPadL = cfg.padL, tPadB = cfg.padB, tPadT = cfg.padT, tPadR = cfg.padR;
    const tChartW = cfg.chartW, tChartH = cfg.chartH, tMaxCnt = cfg.tMaxCnt, tMaxMin = cfg.tMaxMin, tBase = cfg.tBase;
    const tX = function (i) { return trendChartX(cfg, i, trendData.length); };
    const tYCnt = function (v) { return trendChartY(cfg, v, tMaxCnt); };
    const tYMin = function (v) { return trendChartY(cfg, v, tMaxMin); };
    const tPath = function (key, fy) {
      return trendData.map(function (d, i) {
        return (i === 0 ? 'M' : 'L') + tX(i) + ',' + fy(d[key]);
      }).join(' ');
    };
      let tSvg =
        '<svg viewBox="0 0 ' + tW + ' ' + tH + '" style="width:100%;height:200px;display:block;min-width:300px;">';
      [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
        let y = tBase - f * tChartH;
        tSvg +=
          '<line x1="' +
          tPadL +
          '" y1="' +
          y +
          '" x2="' +
          (tW - tPadR) +
          '" y2="' +
          y +
          '" stroke="var(--c-grid)" stroke-width="1"/>';
      });
      tSvg +=
        '<line x1="' +
        tPadL +
        '" y1="' +
        tPadT +
        '" x2="' +
        tPadL +
        '" y2="' +
        tBase +
        '" stroke="var(--c-axis)" stroke-width="1"/>';
      tSvg +=
        '<line x1="' +
        (tW - tPadR) +
        '" y1="' +
        tPadT +
        '" x2="' +
        (tW - tPadR) +
        '" y2="' +
        tBase +
        '" stroke="var(--c-axis)" stroke-width="1"/>';
      tSvg +=
        '<line x1="' +
        tPadL +
        '" y1="' +
        tBase +
        '" x2="' +
        (tW - tPadR) +
        '" y2="' +
        tBase +
        '" stroke="var(--c-axis)" stroke-width="1"/>';
      tSvg +=
        '<text x="' +
        (tPadL - 4) +
        '" y="' +
        (tPadT - 5) +
        '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="end" fill="var(--text-light)">个</text>';
      tSvg +=
        '<text x="' + (tW - tPadR + 4) + '" y="' + (tPadT - 5) + '" style="font-size:var(--fs-caption);font-weight:600" fill="var(--text-light)">分</text>';
      tSvg +=
        '<text x="' +
        (tPadL - 4) +
        '" y="' +
        (tPadT + 4) +
        '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="end" fill="var(--text-light)">' +
        tMaxCnt +
        '</text>';
      tSvg +=
        '<text x="' +
        (tPadL - 4) +
        '" y="' +
        (tBase + 3) +
        '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="end" fill="var(--text-light)">0</text>';
      tSvg +=
        '<text x="' +
        (tW - tPadR + 4) +
        '" y="' +
        (tPadT + 4) +
        '" style="font-size:var(--fs-caption);font-weight:600" fill="var(--text-light)">' +
        tMaxMin +
        '</text>';
      tSvg +=
        '<text x="' + (tW - tPadR + 4) + '" y="' + (tBase + 3) + '" style="font-size:var(--fs-caption);font-weight:600" fill="var(--text-light)">0</text>';
      // 曲线：实线 / 长虚 / 点线 / 点划线，四种线型互不相同
      tSvg +=
        '<path d="' +
        tPath('minutes', tYMin) +
        '" fill="none" stroke="var(--c-min)" stroke-width="2.2" stroke-linejoin="round" class="dash-dot"/>';
      tSvg +=
        '<path d="' +
        tPath('interrupts', tYCnt) +
        '" fill="none" stroke="var(--c-int)" stroke-width="2.2" stroke-linejoin="round" class="dash-dashdot"/>';
      tSvg +=
        '<path d="' +
        tPath('half', tYCnt) +
        '" fill="none" stroke="var(--c-half)" stroke-width="2.2" stroke-linejoin="round" class="dash-long"/>';
      tSvg +=
        '<path d="' +
        tPath('full', tYCnt) +
        '" fill="none" stroke="var(--c-full)" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>';
      // 数据点：圆 / 方 / 菱 / 三角，形状也做区分
      trendData.forEach(function (d, i) {
        let x = tX(i),
          ym = tYMin(d.minutes);
        tSvg +=
          '<polygon points="' +
          x +
          ',' +
          (ym - 3.4) +
          ' ' +
          (x + 3.4) +
          ',' +
          ym +
          ' ' +
          x +
          ',' +
          (ym + 3.4) +
          ' ' +
          (x - 3.4) +
          ',' +
          ym +
          '" fill="var(--c-min)"/>';
        let yi = tYCnt(d.interrupts);
        tSvg +=
          '<polygon points="' +
          x +
          ',' +
          (yi - 3.4) +
          ' ' +
          (x + 3) +
          ',' +
          (yi + 2.4) +
          ' ' +
          (x - 3) +
          ',' +
          (yi + 2.4) +
          '" fill="var(--c-int)"/>';
        let yh = tYCnt(d.half);
        tSvg += '<rect x="' + (x - 2.4) + '" y="' + (yh - 2.4) + '" width="4.8" height="4.8" fill="var(--c-half)"/>';
        tSvg += '<circle cx="' + x + '" cy="' + tYCnt(d.full) + '" r="4" fill="var(--c-full)"/>';
      });
      /* x 轴日期：7 个「10/19」在 244px 绘图区里必然互相压住（实测 430 宽下已重叠）。
         改成"首日写完整日期，其余只写日"，并把字号降到 micro 档；
         完整日期保留在 <title> 里，指针/hover 仍能看到。 */
      trendData.forEach(function (d, i) {
        const full = String(d.label || '');
        const dayOnly = i === 0 ? full : (full.indexOf('/') >= 0 ? full.slice(full.indexOf('/') + 1) : full);
        /* 首尾用 start/end 锚点：middle 会让首日向左、末日向右各溢出半个字宽，
           320px 下「10/25」直接顶出容器（viewport 门禁量到 right=332）。 */
        const anchor = i === 0 ? 'start' : (i === trendData.length - 1 ? 'end' : 'middle');
        tSvg +=
          '<text x="' + tX(i) + '" y="' + (tBase + 15) +
          '" style="font-size:var(--fs-micro);font-weight:600" text-anchor="' + anchor + '" fill="var(--text-light)">' +
          '<title>' + full + '</title>' + dayOnly + '</text>';
      });
      tSvg += '</svg>';
      trendEl.innerHTML = tSvg;
      // 图例按实际线型渲染，保证和曲线对得上
      let legendEl = document.getElementById('trendLegend');
      if (legendEl) {
        let lg = [
          ['--c-full', '', '完整🍅'],
          ['--c-half', 'dash-long', '半个🍅'],
          ['--c-min', 'dash-dot', '专注分钟(右轴)'],
          ['--c-int', 'dash-dashdot', '打断']
        ];
        legendEl.innerHTML = lg
          .map(function (it) {
            return (
              '<span style="display:inline-flex;align-items:center;gap:var(--sp-4);color:var(--text);font-weight:600;"><svg width="26" height="8" style="overflow:visible;"><line x1="0" y1="4" x2="26" y2="4" stroke="var(' +
              it[0] +
              ')" stroke-width="2.6" class="' +
              it[1] +
              '"/></svg>' +
              it[2] +
              '</span>'
            );
          })
          .join('');
      }
}

/* 时段热力图数据：只看**最近 N 天**，不是全部历史。
   ★ 为什么必须限定窗口（真实反馈，2026-10-25）：
     原实现把「有史以来」所有番茄累计进 7×4 个格子，再用写死的
     val>=4 判最深色。用上一年、几千个番茄之后，24 个格子全在
     43~223 之间，**全部命中 >=4 档**，整张图变成一块同色矩形 ——
     颜色再没有任何区分度，等于这张图废了。
     用户原话：「所有的数据都挤在上午、中午、下午、下午，感觉太不合理」。
     注意他说的不是"挤"，是"格子看不出差别"。累计值越大，越没有信息。
   窗口取 8 周（56 天）：短到能反映"最近的习惯"，长到每周日每时段
   都有样本（8 个样本/格），不会因为一两天没专注就全空。
   分档改成**相对分档**（按本表最大值四分），这样无论用户是
   每天 1 个还是每天 20 个，深浅关系都能看出来。 */
const PERIOD_HEAT_DAYS = 56;

function buildPeriodHeatWindow(byDate, days, now) {
  const grid = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ];
  let total = 0,
    max = 0,
    hit = 0;
  if (byDate) {
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const ds = getDateStr(d);
      const b = byDate[ds];
      if (!b) continue;
      hit++;
      const wd = d.getDay();
      const pd = b.pd || [0, 0, 0, 0];
      for (let p = 0; p < 4; p++) {
        const v = pd[p] || 0;
        if (!v) continue;
        grid[wd][p] += v;
        total += v;
      }
    }
  }
  grid.forEach(function (row) {
    row.forEach(function (v) {
      if (v > max) max = v;
    });
  });
  return { grid: grid, total: total, max: max, days: days, activeDays: hit };
}

/* 相对分档：0 保持空白（没数据和有数据必须能分开），
   1~4 档按本表最大值线性切分，保证最深档一定出现。 */
function periodHeatLevel(v, max) {
  if (!v) return 0;
  if (!max || max <= 1) return 1;
  const r = v / max;
  if (r >= 0.75) return 4;
  if (r >= 0.5) return 3;
  if (r >= 0.25) return 2;
  return 1;
}

function renderPeriodHeatmap(SC) {
    // 时段热力图（近 8 周，相对分档）
    const periods = ['早晨', '下午', '晚上', '深夜'];
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const dark = document.body.classList.contains('dark-mode');
    const win = buildPeriodHeatWindow(SC.byDate, PERIOD_HEAT_DAYS, new Date());
    const heatData = win.grid;
    /* 4 档配色：和年度热力图同一套色系（浅橙 → 深橙），
       深色模式底色不同，另给一套，否则浅档在白底/深底上会反过来。 */
    const levels = dark
      ? ['rgba(255,255,255,0.07)', '#4a3b2e', '#7a5230', '#c96a2b', '#ff8c42']
      : ['#f4f1ec', '#ffe4c4', '#ffc178', '#ff9640', '#e8620f'];
    const levelText = dark ? ['#8b97ad', '#c8d0e0', '#e6ebf5', '#fff6ec', '#ffffff'] : ['#9aa5b4', '#8a5a1f', '#8a4612', '#ffffff', '#ffffff'];

    let heatHtml =
      '<div></div>' +
      periods.map(p => `<div style="text-align:center;font-weight:600;color:var(--text-light);">${p}</div>`).join('');
    for (let wd = 0; wd < 7; wd++) {
      heatHtml += `<div style="display:flex;align-items:center;justify-content:center;font-weight:600;color:var(--text-light);">周${weekdays[wd]}</div>`;
      for (let p = 0; p < 4; p++) {
        const val = heatData[wd][p];
        const lv = periodHeatLevel(val, win.max);
        heatHtml += `<div data-lv="${lv}" title="周${weekdays[wd]} ${periods[p]}：${val} 个" style="background:${levels[lv]};border-radius:var(--radius-xs);height:30px;display:flex;align-items:center;justify-content:center;color:${levelText[lv]};font-weight:600;font-size:var(--fs-caption);">${val || ''}</div>`;
      }
    }
    let hcEl = document.getElementById('heatmapContainer');
    if (!hcEl) return;
    hcEl.style.display = 'grid';
    hcEl.innerHTML = heatHtml;
    /* 口径说明：不写清楚的话，用户会以为是全历史数据，
       然后困惑"我明明三千个番茄，怎么格子里只有 20"。 */
    const noteEl = document.getElementById('heatmapNote');
    if (noteEl) {
      noteEl.textContent = win.total
        ? `近 ${win.days} 天（${win.activeDays} 天有专注）共 ${win.total} 个番茄；颜色深浅按这 ${win.days} 天里的最高格（${win.max} 个）分档，不是按全部历史累计`
        : `近 ${win.days} 天还没有专注记录`;
    }
    const legendEl = document.getElementById('heatmapLegend');
    if (legendEl) {
      legendEl.innerHTML = ['少', '', '', '', '多']
        .map(function (t, i) {
          if (!t) return '<span style="flex:0 0 auto;width:14px;height:12px;background:' + levels[i] + ';border-radius:var(--radius-xs);"></span>';
          return '<span style="color:var(--text-light);font-size:var(--fs-tiny);">' + t + '</span>';
        })
        .join('');
    }
}

function renderMoodBlock(mood7) {
    // 身心状态折线图
    const moodDays = mood7;
    /* 身心摘要：近7天各维度均值 + 首个/末个对比趋势 */
    (function () {
      const msEl = document.getElementById('moodSummary');
      if (!msEl) return;
      const _avg = function (key) {
        const v = moodDays
          .filter(function (m) {
            return m[key] != null;
          })
          .map(function (m) {
            return m[key];
          });
        return v.length
          ? Math.round(
              (v.reduce(function (a, b) {
                return a + b;
              }, 0) /
                v.length) *
                10
            ) / 10
          : null;
      };
      const _trend = function (key) {
        const arr = moodDays
          .filter(function (m) {
            return m[key] != null;
          })
          .map(function (m) {
            return m[key];
          });
        if (arr.length < 2) return null;
        const a = arr[0],
          b = arr[arr.length - 1];
        return b > a ? '↑' : b < a ? '↓' : '→';
      };
      const dims = [
        ['sleep', '😴 睡眠', _avg('sleep'), _trend('sleep')],
        ['mental', '🧠 精神', _avg('mental'), _trend('mental')],
        ['energy', '🔋 电量', _avg('energy'), _trend('energy')],
        ['pleasure', '😊 愉悦', _avg('pleasure'), _trend('pleasure')]
      ];
      let h = '';
      dims.forEach(function (d) {
        if (d[2] == null) return;
        const tc = d[3] === '↑' ? 'var(--green)' : d[3] === '↓' ? 'var(--primary)' : 'var(--text-light)';
        h +=
          '<span style="display:inline-flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-8);border-radius:var(--radius-md);background:var(--card);border:1px solid var(--border);">' +
          d[1] +
          ' ' +
          d[2] +
          '<b style="color:' +
          tc +
          ';">' +
          d[3] +
          '</b></span>';
      });
      msEl.innerHTML = h || '';
    })();
    const mc = document.getElementById('moodChart');
    const W = mc.clientWidth || 300,
      H = 160,
      pad = 20;
    const colors = {
      sleep: 'var(--c-sleep)',
      mental: 'var(--c-mental)',
      energy: 'var(--c-energy)',
      pleasure: 'var(--c-pleasure)'
    };
    const dashes = { sleep: 'dash-long', mental: 'dash-dot', energy: 'dash-dashdot', pleasure: '' };
    const keys = ['sleep', 'mental', 'energy', 'pleasure'];
    let svg = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}">`;
    keys.forEach(key => {
      const pts = moodDays
        .map((d, i) => {
          if (d[key] == null) return null;
          const x = pad + (i * (W - pad * 2)) / (moodDays.length - 1);
          const y = H - pad - ((d[key] - 1) / 9) * (H - pad * 2);
          return { x, y };
        })
        .filter(p => p);
      if (pts.length > 1) {
        const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
        svg += `<path d="${path}" fill="none" stroke="${colors[key]}" stroke-width="2" class="${dashes[key]}"/>`;
      }
      pts.forEach(p => {
        svg += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${colors[key]}" stroke="var(--card)" stroke-width="1.5"/>`;
      });
    });
    moodDays.forEach((d, i) => {
      const x = pad + (i * (W - pad * 2)) / (moodDays.length - 1);
      svg += `<text x="${x}" y="${H - 4}" text-anchor="middle" style="font-size:var(--fs-caption);font-weight:600" fill="var(--text-light)">${d.label}</text>`;
    });
    svg += '</svg>';
    mc.innerHTML = svg;
}

function renderStats() {
  processWeeklyBadges();
  checkNewDay();
  renderRankSystem();
  /* 按需渲染：统计页未激活（用户正看计时/计划/日志页）时不画任何图表（趋势SVG/热力图/年度图），
   只刷新数字卡片就返回；切到统计页时 switchView 先设 active 再调 renderStats，图表才真正绘制。
   手机端打开页面不再偷偷在后台画图，CPU 省 ~80% 绘图量 */
  /* 图表 DOM 缓存：7 张统计卡片是静态元素，一次查询懒加载分支与主流程共用 */
  const _elStats = {
    total: document.getElementById('statsTotal'),
    full: document.getElementById('statFull'),
    half: document.getElementById('statHalf'),
    focus: document.getElementById('statFocus'),
    interrupt: document.getElementById('statInterrupt'),
    energy: document.getElementById('statEnergy'),
    pleasure: document.getElementById('statPleasure')
  };
  const _svEl = document.getElementById('view-stats');
  if (_svEl && !_svEl.classList.contains('active')) {
    const _SC = getStatsCache();
    const _tb = _SC.tb;
    _elStats.total.textContent = (_tb.pomos || 0).toFixed(1).replace(/\.0$/, '');
    _elStats.full.textContent = _tb.fullPomos || 0;
    _elStats.half.textContent = _tb.half;
    _elStats.focus.textContent = _tb.minutes;
    _elStats.interrupt.textContent = _tb.int;
    _elStats.energy.textContent = _tb.energyN ? Math.round(_tb.energySum / _tb.energyN) : '--';
    _elStats.pleasure.textContent = _tb.moodN ? Math.round(_tb.moodSum / _tb.moodN) : '--';
    applyTodayTier(_tb.full + _tb.half * 0.5);
    return;
  }
  const SC = getStatsCache();
  const tb = SC.tb;
  const full = tb.full;
  const half = tb.half;
  const interrupted = tb.int;
  const minutes = tb.minutes;
  _elStats.total.textContent = (tb.pomos || 0).toFixed(1).replace(/\.0$/, '');
  _elStats.full.textContent = tb.fullPomos || 0;
  _elStats.half.textContent = half;
  _elStats.focus.textContent = minutes;
  _elStats.interrupt.textContent = interrupted;
  _elStats.energy.textContent = tb.energyN ? Math.round(tb.energySum / tb.energyN) : '--';
  _elStats.pleasure.textContent = tb.moodN ? Math.round(tb.moodSum / tb.moodN) : '--';
  /* 今日番茄分级变色：正常/努力/十分努力（今日完整+半个数） */
  applyTodayTier(full + half * 0.5);
  if (!appData.records || appData.records.length === 0) {
    renderStatsEmpty();
    renderTreeSection(); /* 周/月简报砍掉 */
  } else {
    /* 近7天趋势折线图（SVG）已拆至 renderTrendChart(day7) */
    renderTrendChart(SC.day7);
    // 连续专注天数：直接读 stats 缓存里的唯一实现（calcStreakStats）
    /* 原处自己又数了一遍 dateSet 循环，且**少算了「今天还没完成 → 从昨天起算」**，
       于是同一个「连续」在统计页/海报/树快照上有两个答案。规则只留一份。 */
    document.getElementById('statsStreak').textContent = '🔥 连续 ' + (SC.streak || 0) + ' 天';
    // 周番茄统计（原始完成/合计消耗/可消耗）：消耗不扣减原始统计，仅作参考
    const wsStr = getWeekStartStr();
    const weekRaw = getWeekTomatoPoints(); /* 点数口径：与段位/商店一致 */
    const weekSpent = countWeekAllSpent();
    const weekAvail = getSpendableTomatoes(); /* 与段位/商店同口径（含扭蛋额外🍅） */
    const wSpentEl = document.getElementById('weekSpentCount');
    const wAvailEl = document.getElementById('weekAvailCount');
    if (wSpentEl) wSpentEl.textContent = fmtTomatoNum(weekSpent);
    if (wAvailEl) wAvailEl.textContent = fmtTomatoNum(weekAvail);
    /* 时段热力图已拆至 renderPeriodHeatmap(heat) */
    renderPeriodHeatmap(SC);
    /* 身心状态折线图已拆至 renderMoodBlock(mood7) */
    renderMoodBlock(SC.mood7);
    renderTreeSection();
  }
  // 成就系统
  /* renderStats 里成就列表复用 renderAchListOnly（含 🎁 手动领取按钮） */
  renderAchListOnly();
  renderWeeklyBadges();
  renderEncourage();
  renderStatsExtras(SC);
  renderStatsJumpNav(SC);
  ensureBlockAnalysis();
  renderMonthlyStat();
  renderYearlyStat();
  (typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : function (_f) {
        return setTimeout(_f, 60);
      })(function () {
    try {
      renderYearHeatmap();
    } catch (e) { if (window.__silent) window.__silent(e, '01e7:renderStats'); }
  });
  /* 周/月简报整块砍掉，renderBriefs() 调用去掉 */
  /* renderBriefs(); */
}
