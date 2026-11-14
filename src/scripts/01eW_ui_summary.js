/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01e7_ui_stats.js 按域拆出（2026-11-14 · S3，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；JS 包只在新增文件边界多 1 个空语句（tools/group_split.py 的拼接符 "\n;\n"，长度不变）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01eW_ui_summary.js
 * 分组：ui
 * 职责：每日专注总结（新增）：日记页收尾仪式；renderStats 区块拆分
 * 功能：
 *   - 每日专注总结（新增）：日记页收尾仪式
 *   - renderStats 区块拆分
 * 函数索引（TOC）：renderYearHeatmap/_sumMinutes/_sumPomos/renderDailyFocusSummary/renderStatsEmpty/tChartNice/trendChartCfg/trendChartX/trendChartY/renderTrendChart/buildPeriodHeatWindow/periodHeatLevel（+3 更多）
 * ============================================================ */

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
