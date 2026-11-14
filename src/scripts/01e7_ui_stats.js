/* ============================================================
 * 01e7 · 统计页渲染域（导航/图表/传记/热力图/renderStats）
 * 函数索引（TOC）：toggleBlockAnalysis/ensureBlockAnalysis/jumpToBlock/renderStatsJumpNav/buildAreaChartSvg
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
