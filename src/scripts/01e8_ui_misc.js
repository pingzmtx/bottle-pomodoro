/* ============================================================
 * 01e8 · 成就与其余 UI 渲染（杂项，后续可细分）
 * 函数索引（TOC）：claimAchievementReward/renderAchListOnly/renderQualityStack/intScopeSet/intShift/intHeadHtml/renderInterruptAnalysis/rankTrendBuildPoints/rankTrendCfg/rankTrendSegmentInfo/renderRankTrendChart/renderWeekCompareChart（+46 更多）
 * ============================================================ */
// 成就系统
/* 成就解锁后可手动领取 20🪙（成就页点 🎁） */
const ACH_REWARD_COINS = 20;
function claimAchievementReward(id) {
  const list = appData.pendingAchRewards || [];
  const i = list.indexOf(id);
  if (i < 0) return;
  list.splice(i, 1);
  fxVibrate(30); /* E4-05 成就奖励领取触感 */
  /* 金币不在这里直接加：统一由 showGift 入账（否则礼包弹窗点开时再加一遍 = 双倍） */
  const ach = getAchievements().find(function (a) {
    return idEq(a.id, id);
  });
  saveData();
  renderAchListOnly();
  /* 成就领取：双叮咚音效 */
  playSound('reward');
  showGift('🏅 成就奖励：' + (ach ? ach.name + '「' + ach.icon + '」' : '成就'), ACH_REWARD_COINS);
}
/* 只重渲染成就列表（不触发整页 renderStats，避免滚动位置跳动） */
function renderAchListOnly() {
  const el = document.getElementById('achievementList');
  if (!el) return;
  const achievements = getAchievements();
  const unlockedCount = achievements.filter(function (a) {
    return a.unlocked;
  }).length;
  const achGroups = ['基础', '坚持', '作息', '挑战', '战标', '段位', '种树', '记录', '习惯', '时长'];
  let achHtml =
    '<div style="width:100%;margin-bottom:var(--sp-6);"><div style="font-size:var(--fs-title);color:var(--text);font-weight:700;">已解锁 ' +
    unlockedCount +
    ' / ' +
    achievements.length +
    '</div><div style="height:8px;background:var(--bg);border-radius:var(--radius-xs);overflow:hidden;margin-top:var(--sp-4);"><div style="height:100%;width:' +
    (achievements.length ? (unlockedCount / achievements.length) * 100 : 0) +
    '%;background:linear-gradient(90deg,var(--primary),var(--yellow));border-radius:var(--radius-xs);transition:width .4s;"></div></div></div>';
  /* 层级总览：把成就按「达成所需时间」分成 入门/铜/银/金 四档。
     8 个「第一次做某事」的成就与「连续 100 天」这类长期目标放在同一层展示，
     前者本质是**功能引导**，同权会让整面墙失去区分度。
     本处**只动展示**：不碰任何 cond、不动 unlockedAchievements、不影响导出。 */
  const _TIERS = [
    { k: 'guide', label: '入门', color: '#9E9E9E' },
    { k: 'bronze', label: '铜', color: '#C87F33' },
    { k: 'silver', label: '银', color: '#94A3B0' },
    { k: 'gold', label: '金', color: '#D9A404' }
  ];
  achHtml += '<div style="display:flex;flex-wrap:wrap;gap:var(--sp-6);justify-content:center;width:100%;">';
  _TIERS.forEach(function (T) {
    const list = achievements.filter(function (a) { return a.tier === T.k; });
    if (!list.length) return;
    const lit = list.filter(function (a) { return a.unlocked; }).length;
    achHtml +=
      '<div style="flex:1 1 68px;min-width:68px;padding:var(--sp-6) var(--sp-4);border-radius:var(--radius-xs);' +
      'background:var(--bg);border:1.5px solid ' + T.color + ';text-align:center;">' +
      '<div style="font-size:var(--fs-caption);color:var(--text-light);">' + T.label + '</div>' +
      '<div style="font-size:var(--fs-title);font-weight:800;color:' + (lit ? T.color : 'var(--text-light)') + ';line-height:1.25;">' +
      lit + '<span style="font-size:var(--fs-caption);font-weight:400;color:var(--text-light);">/' + list.length + '</span>' +
      '</div></div>';
  });
  achHtml += '</div>';
  achGroups.forEach(function (g) {
    const items = achievements.filter(function (a) {
      return a.group === g;
    });
    if (!items.length) return;
    const lit = items.filter(function (a) {
      return a.unlocked;
    }).length;
    achHtml +=
      '<div style="width:100%;margin-top:var(--sp-10);margin-bottom:var(--sp-6);font-size:var(--fs-title);font-weight:700;color:var(--text);text-align:left;">' +
      g +
      ' 系列 <span style="font-size:var(--fs-body);color:var(--text-light);font-weight:400;">' +
      lit +
      '/' +
      items.length +
      '</span></div>';
    achHtml +=
      '<div style="display:flex;flex-wrap:wrap;gap:var(--sp-8);justify-content:center;width:100%;">' +
      items
        .map(function (a) {
          const ok = a.unlocked;
          const pend = ok && (appData.pendingAchRewards || []).indexOf(a.id) >= 0;
          return (
            '<div style="text-align:center;padding:var(--sp-6) var(--sp-2);width:88px;border-radius:var(--radius);border:2px solid ' +
            (ok ? a.color : '#ddd') +
            ';background:' +
            (ok ? a.bg || '#fff' : '#f5f5f5') +
            ';opacity:' +
            (ok ? '1' : '0.45') +
            ';filter:' +
            (ok ? 'none' : 'grayscale(1)') +
            ';' +
            (ok ? 'box-shadow:0 0 8px ' + a.color : '') +
            ';position:relative;"><div style="font-size:26px;line-height:1;">' +
            a.icon +
            '</div><div style="font-size:var(--fs-body);font-weight:700;margin-top:var(--sp-2);color:' +
            (ok ? a.color : '#999') +
            ';">' +
            a.name +
            '</div><div style="font-size:var(--fs-caption);color:var(--text-light);line-height:1.3;margin-top:var(--sp-2);">' +
            a.desc +
            '</div>' +
            (pend
              ? '<div style="position:absolute;top:-6px;right:-6px;font-size:var(--fs-tiny);background:var(--yellow);color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.2);" onclick="claimAchievementReward(\'' +
                a.id +
                '\')" title="领取奖励">🎁</div>'
              : ok
                ? '<div style="position:absolute;top:-6px;right:-6px;font-size:var(--fs-body);background:var(--fill-primary);color:var(--on-fill);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">✓</div>'
                : '') +
            '</div>'
          );
        })
        .join('') +
      '</div>';
  });
  el.innerHTML = achHtml;
}

/* ===== renderStatsExtras 区块拆分 =====
 * 4 大渲染块原样搬为独立顶层函数（紧贴本函数上方、同 SC 签名），
 * 逻辑 / HTML / SVG / 顺序零改写。 */
function renderQualityStack(SC) {
  const _qc = document.getElementById('qualityChart');
  if (_qc) {
    const any = SC.day7.some(function (d) {
      return d.full || d.half || d.inc;
    });
    if (!any) {
      _qc.innerHTML =
        '<div style="text-align:center;color:var(--text-light);font-size:var(--fs-body);padding:40px 0;">暂无数据</div>';
    } else {
      _qc.innerHTML =
        '<div style="display:flex;align-items:flex-end;height:130px;gap:var(--sp-6);justify-content:center;">' +
        SC.day7
          .map(function (d) {
            const total = d.full + d.half + d.inc;
            const h = function (v) {
              return total ? Math.round((v / total) * 100) : 0;
            };
            return (
              '<div style="flex:1;max-width:44px;display:flex;flex-direction:column;justify-content:flex-end;gap:var(--sp-2);height:100%;">' +
              (d.full
                ? '<div style="background:var(--green);border-radius:var(--radius-xs);height:' + h(d.full) + '%;"></div>'
                : '') +
              (d.half
                ? '<div style="background:var(--yellow);border-radius:var(--radius-xs);height:' + h(d.half) + '%;"></div>'
                : '') +
              (d.inc ? '<div style="background:var(--red);border-radius:var(--radius-xs);height:' + h(d.inc) + '%;"></div>' : '') +
              '</div>'
            );
          })
          .join('') +
        '</div>' +
        '<div style="display:flex;gap:var(--sp-6);justify-content:center;margin-top:var(--sp-4);font-size:var(--fs-caption);color:var(--text-light);">' +
        SC.day7
          .map(function (d) {
            return '<div style="flex:1;max-width:44px;text-align:center;">' + d.label + '</div>';
          })
          .join('') +
        '</div>';
    }
  }
  /* 专注时长分布 */
}

/* renderTaskCompareChart 已随「📋 任务完成度（计划 vs 实际）」板块移除（2026-11-07）。
   渲染端留着只会让静态 id 检查报「#taskChart 缺失」，所以整段删掉；
   取数端 buildTaskCompareRows 仍在（其它分析还在用），没有连带影响。 */

/* 打断分析的区间态：默认「月」，四档 day|month|year|all。
   ⚠️ 只改这一张卡片的取数区间，**不动 SC 里的全量口径** ——
   统计页底部「评价」（ANALYZERS.interrupt）说的是整体历史，跟着区间变反而更乱。 */
let _intScope = 'month';
let _intOffset = 0;
function intScopeSet(s) {
  if (_intScope === s) return;
  _intScope = s;
  _intOffset = 0; /* 换粒度回当期，否则「日 -3」切到「年」会跳到 3 年前 */
  renderInterruptAnalysis();
}
function intShift(d) {
  _intOffset = Math.min(0, _intOffset + d); /* 不许翻到未来（未来必然空，只会让人以为坏了） */
  renderInterruptAnalysis();
}
/* 卡片头：分段选择器 + ◀ 区间 ▶（累计档没有「上一期」，只留标签） */
function intHeadHtml(R) {
  const seg = [
    ['day', '日'],
    ['month', '月'],
    ['year', '年'],
    ['all', '累计']
  ]
    .map(function (it) {
      const on = _intScope === it[0];
      return (
        '<button onclick="intScopeSet(\'' +
        it[0] +
        '\')" style="border:0;padding:var(--sp-2) var(--sp-12);font-size:var(--fs-note);font-weight:700;cursor:pointer;background:' +
        (on ? 'var(--primary)' : 'transparent') +
        ';color:' +
        (on ? '#fff' : 'var(--text-light)') +
        ';">' +
        it[1] +
        '</button>'
      );
    })
    .join('');
  const arrowBtn = function (fn, txt, title) {
    return (
      '<button onclick="' +
      fn +
      '" title="' +
      title +
      '" style="border:0;background:transparent;color:var(--text-light);font-size:var(--fs-note);cursor:pointer;padding:0 4px;">' +
      txt +
      '</button>'
    );
  };
  const right =
    _intScope === 'all'
      ? '<b style="color:var(--text);font-size:var(--fs-note);">' + R.label + '</b>'
      : arrowBtn('intShift(-1)', '◀', '上一期') +
        '<b style="color:var(--text);font-size:var(--fs-note);white-space:nowrap;">' +
        R.label +
        '</b>' +
        arrowBtn('intShift(1)', '▶', '下一期');
  return (
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:var(--sp-8);flex-wrap:wrap;margin-bottom:var(--sp-10);">' +
    '<span style="display:inline-flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;background:var(--card);">' +
    seg +
    '</span>' +
    '<span style="display:inline-flex;align-items:center;gap:var(--sp-2);">' +
    right +
    '</span></div>'
  );
}
function renderInterruptAnalysis(SC) {
  const _ib = document.getElementById('interruptBox');
  if (!_ib) return;
  const R = interruptRangeOf(_intScope, _intOffset);
  const D = buildInterruptStats(R.from, R.to);
  let html = intHeadHtml(R);
  if (D.rangeRecs === 0) {
    html += '这段时间还没有专注记录 —— 先专注一颗番茄，这里就会开始统计打断。';
  } else if (D.intCount === 0 && D.intSecTotal <= 0) {
    html += '🔔 这段时间没有打断记录，专注很干净！';
  } else {
    const mins = Math.round(D.intSecTotal / 60);
    const avg = D.intCount ? Math.round((D.intSecTotal / D.intCount / 60) * 10) / 10 : 0;
    const rate = D.rangePomos ? Math.round((D.intCount / D.rangePomos) * 100) : 0;
    html +=
      '🔔 打断 <b style="color:var(--red);">' +
      D.intCount +
      ' 次</b>，浪费 <b style="color:var(--red);">' +
      mins +
      ' 分钟</b>' +
      '<span style="color:var(--text-light);"> · 平均每次 ' +
      avg +
      ' 分钟 · 打断率 ' +
      rate +
      '%（每🍅平均 ' +
      Math.round((rate / 100) * 10) / 10 +
      ' 次）</span>';
    if (D.intReasonTop.length) {
      const maxN = Math.max.apply(
        null,
        D.intReasonTop
          .map(function (r) {
            return r.n;
          })
          .concat([1])
      );
      html +=
        '<div style="margin-top:var(--sp-8);display:flex;flex-direction:column;gap:var(--sp-4);">' +
        D.intReasonTop
          .map(function (r) {
            const pct = Math.round((r.n / maxN) * 100);
            const m = Math.round(r.sec / 60);
            return (
              '<div><div style="display:flex;justify-content:space-between;font-size:var(--fs-note);"><span>' +
              escapeHtml(r.reason) + /* 打断原因为用户自由输入（v2 扫描命中） */
              '</span><span style="color:var(--text-light);">' +
              r.n +
              '次' +
              (m > 0 ? ' · 约' + m + '分钟' : '') +
              '</span></div><div style="height:10px;border-radius:var(--radius-xs);background:rgba(128,128,128,.14);margin-top:var(--sp-2);"><div style="width:' +
              pct +
              '%;height:100%;background:var(--c-int);border-radius:var(--radius-xs);"></div></div></div>'
            );
          })
          .join('') +
        '</div>';
      const other = D.intReasonTop.find(function (r) {
        return r.reason === '📝 其他';
      });
      if (other && other.n >= 2)
        html +=
          '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-6);">💡 「其他」不少？记录时在弹窗里写一句具体原因，会自动归入对应分类</div>';
    }
  }
  _ib.innerHTML = html;

}

/* ===== renderRankTrendChart 拆分 helper =====
 * rankTrendBuildPoints：rankFeedback 事件解析 + 30 天窗口按日聚合（返回 points）
 * rankTrendCfg：尺寸 / 上下限(段位档取整) / 坐标刻度换算
 * rankTrendSegmentInfo：曲线分段 + 赛季结束断点（两段判定同源，避免重复遍历） */
function rankTrendBuildPoints(feedback) {
  const events = [];
  (feedback || []).forEach(function (f) {
    const p = _eventsParser(f);
    if (p) events.push(p);
  });
  events.sort(function (a, b) {
    return a.t - b.t;
  });
  let points = [];
  if (events.length) {
    const dayMap = {};
    events.forEach(function (e) {
      const k = getDateStr(new Date(e.t));
      dayMap[k] = (dayMap[k] || 0) + e.d;
    });
    const todayD = new Date();
    todayD.setHours(0, 0, 0, 0);
    const startD = todayD.getTime() - 29 * DAY_MS;
    const earliestD = events[0].t;
    const ed = new Date(earliestD);
    ed.setHours(0, 0, 0, 0);
    const realStart = startD < ed.getTime() ? startD : ed.getTime();
    let pre = 0;
    events.forEach(function (e) {
      if (e.t < realStart) pre += e.d;
    });
    let acc = pre;
    for (let t = realStart; t <= todayD.getTime(); t += DAY_MS) {
      const k = getDateStr(new Date(t));
      acc += dayMap[k] || 0;
      points.push({ t: t, label: new Date(t).getMonth() + 1 + '/' + new Date(t).getDate(), val: Math.max(0, acc) });
    }
  }
  return points;
}
function rankTrendCfg(points, curStars) {
  /* 边距随轴标签字号（--fs-caption 14px）放大，避免左侧数值被裁 */
  const W = 320, H = 180, pL = 48, pR = 12, pT = 22, pB = 30;
  const cW = W - pL - pR, cH = H - pT - pB;
  const _vals = points.map(function (p) { return p.val; }).concat([curStars]);
  const _vMin = Math.min.apply(null, _vals);
  const _vMax = Math.max.apply(null, _vals);
  /* 纵向窗口贴着数据走，而不是固定从 0 拉到段位天花板。
     累计星数一路贴顶时，每天涨几颗在 1100 的刻度里几乎看不出来 ——
     这正是「近 30 天波动特别小、不直观」的根因。这里按窗口内极差留 15% 余量，
     数据本身平（极差 0）时给 3 颗的最小余量，避免除零也避免一条死平线看不出变化。 */
  const _span = Math.max(_vMax - _vMin, 1);
  const _pad = Math.max(3, Math.round(_span * 0.15));
  const maxVal = _vMax + _pad;
  const minVal = Math.max(0, _vMin - _pad);
  const _tiers = [40, 100, 210, 350, 500, 650, 1100];
  /* 窗口里没有段位线时，改画窗口上下界数值，否则左侧一根刻度都没有 */
  const _tiersInside = _tiers.filter(function (t) { return t > minVal && t < maxVal; }).length;
  const xScale = function (i) { return pL + (points.length === 1 ? cW / 2 : (i / (points.length - 1)) * cW); };
  const yScale = function (v) { return pT + cH - ((v - minVal) / (maxVal - minVal)) * cH; };
  return { W: W, H: H, pL: pL, pR: pR, pT: pT, pB: pB, maxVal: maxVal, minVal: minVal, showAxisLabels: _tiersInside === 0, xScale: xScale, yScale: yScale };
}
function rankTrendSegmentInfo(points) {
  const segments = [];
  let cur = [];
  let lastV = null;
  points.forEach(function (p, i) {
    if (i > 0 && p.val <= 0 && lastV > 20) {
      segments.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
    lastV = p.val;
  });
  if (cur.length) segments.push(cur);
  const ends = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].val <= 0 && points[i - 1].val > 20) {
      ends.push(i);
    }
  }
  return { segments: segments, ends: ends };
}

function renderRankTrendChart(SC) {
  const _rb = document.getElementById('rankTrendBox');
  if (_rb) {
    const points = rankTrendBuildPoints(appData.rankSystem.rankFeedback || []); /* 事件解析+30天窗口聚合已提顶层 helper */
    const _tierLine = [
      { s: 0, n: '🥉青铜' },
      { s: 40, n: '🥈白银' },
      { s: 100, n: '🥇黄金' },
      { s: 210, n: '💎钻石' },
      { s: 350, n: '💠钻石V' },
      { s: 500, n: '⭐星耀' },
      { s: 650, n: '🔥王者' }
    ];
    if (!points.length) {
      _rb.innerHTML =
        '<div style="text-align:center;color:var(--text-light);font-size:var(--fs-body);padding:30px 0;">暂无上分记录，<br>完成段位任务后这里会展示上分曲线</div>';
    } else {
      const _cfg = rankTrendCfg(points, SC.rankData.stars || 0); /* 尺寸/刻度已提顶层 helper */
      const W = _cfg.W, H = _cfg.H, pL = _cfg.pL, pR = _cfg.pR, pT = _cfg.pT, pB = _cfg.pB;
      const maxVal = _cfg.maxVal, minVal = _cfg.minVal;
      const xScale = _cfg.xScale, yScale = _cfg.yScale;
      /* 段位水平线（只在范围内的） */
      let tiersSvg = '';
      _tierLine.forEach(function (t) {
        if (t.s > minVal && t.s < maxVal) {
          const y = yScale(t.s);
          tiersSvg +=
            '<line x1="' +
            pL +
            '" y1="' +
            y +
            '" x2="' +
            (W - pR) +
            '" y2="' +
            y +
            '" stroke="var(--c-grid)" stroke-width="1" stroke-dasharray="3,3"/>' +
            '<text x="' +
            (pL - 4) +
            '" y="' +
            (y + 3) +
            '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="end" fill="var(--text-light)">' +
            t.n +
            ' ' +
            t.s +
            '</text>';
        }
      });
      /* 曲线：分段（赛季结束 = val 骤降≈0 处断开；断点与分段同源 提为 rankTrendSegmentInfo） */
      /* 窗口里没有段位线可参照时，用上下界数值补左侧刻度（自适应纵轴的必要搭配） */
      if (_cfg.showAxisLabels) {
        tiersSvg +=
          '<text x="' + (pL - 4) + '" y="' + (pT + 8) + '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="end" fill="var(--text-light)">' + Math.round(maxVal) + '</text>' +
          '<text x="' + (pL - 4) + '" y="' + (H - pB + 2) + '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="end" fill="var(--text-light)">' + Math.round(minVal) + '</text>';
      }
      const segInfo = rankTrendSegmentInfo(points);
      const segments = segInfo.segments;
      /* 填充：最后一段橙色，前面灰色 */
      const fillSegment = function (seg, color) {
        if (seg.length < 2) return '';
        let path = 'M ' + xScale(0) + ',' + yScale(seg[0].val);
        seg.forEach(function (p, i) {
          if (i > 0) path += ' L ' + xScale(i) + ',' + yScale(p.val);
        });
        path += ' L ' + xScale(seg.length - 1) + ',' + yScale(minVal) + ' L ' + xScale(0) + ',' + yScale(minVal) + ' Z';
        return '<path d="' + path + '" fill="' + color + '" opacity="0.3"/>';
      };
      let linePath = '';
      points.forEach(function (p, i) {
        linePath += (i === 0 ? 'M' : ' L') + xScale(i) + ' ' + yScale(p.val);
      });
      let areaSvg = '';
      const seasonEnds = segInfo.ends; /* 断点已在 rankTrendSegmentInfo 计算 */
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let i = 0; i < segments.length; i++) {
        const isLast = i === segments.length - 1;
        areaSvg += fillSegment(segments[i], isLast ? '#FF8A50' : '#888');
      }
      /* 赛季结束竖虚线 + 标签（断点集 = segInfo.ends） */
      let seasonSvg = '';
      seasonEnds.forEach(function (i) {
        const x = xScale(i);
        const y = yScale(0);
        seasonSvg +=
          '<line x1="' +
          x +
          '" y1="' +
          pT +
          '" x2="' +
          x +
          '" y2="' +
          (H - pB) +
          '" stroke="var(--text-light)" stroke-width="1" stroke-dasharray="2,3" opacity="0.5"/>' +
          '<rect x="' +
          (x - 26) +
          '" y="' +
          (pT - 2) +
          '" width="52" height="14" rx="3" fill="var(--bg)" stroke="var(--text-light)" stroke-width="0.5"/>' +
          '<text x="' +
          x +
          '" y="' +
          (pT + 9) +
          '" style="font-size:var(--fs-caption);font-weight:600" text-anchor="middle" fill="var(--text-light)">赛季结束</text>';
      });
      /* 数据点 */
      let dotsSvg = '';
      points.forEach(function (p, i) {
        const x = xScale(i),
          y = yScale(p.val);
        const c = segments.length && segments[segments.length - 1].indexOf(p) >= 0 ? '#FF8A50' : '#666';
        dotsSvg += '<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="' + c + '" stroke="#fff" stroke-width="1.5"/>';
      });
      /* X 轴日期：起点 / 终点 */
      const xLabels =
        '<text x="' +
        pL +
        '" y="' +
        (H - 6) +
        '" font-size="10" fill="var(--text-light)">' +
        points[0].label +
        '</text>' +
        '<text x="' +
        (W - pR) +
        '" y="' +
        (H - 6) +
        '" font-size="10" text-anchor="end" fill="var(--text-light)">' +
        points[points.length - 1].label +
        '</text>';
      const svg =
        '<svg viewBox="0 0 ' +
        W +
        ' ' +
        H +
        '" style="width:100%;height:180px;display:block;">' +
        '<line x1="' +
        pL +
        '" y1="' +
        pT +
        '" x2="' +
        pL +
        '" y2="' +
        (H - pB) +
        '" stroke="var(--c-axis)" stroke-width="1"/>' +
        '<line x1="' +
        pL +
        '" y1="' +
        (H - pB) +
        '" x2="' +
        (W - pR) +
        '" y2="' +
        (H - pB) +
        '" stroke="var(--c-axis)" stroke-width="1"/>' +
        tiersSvg +
        areaSvg +
        seasonSvg +
        '<path d="' +
        linePath +
        '" fill="none" stroke="#FF6B4A" stroke-width="2"/>' +
        dotsSvg +
        xLabels +
        '</svg>';
      const curTier = SC.rankData.tier;
      const header =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-4);font-size:var(--fs-note);color:var(--text-light);">' +
        '<span>近 30 天 · 共 ' +
        points.length +
        ' 天</span>' +
        '<span>当前：<b style="color:' +
        curTier.color +
        ';">' +
        curTier.icon +
        ' ' +
        curTier.name +
        '</b> ' +
        SC.rankData.stars +
        ' ⭐</span>' +
        '</div>';
      _rb.innerHTML = header + svg;
    }
  }
  /* 专注段数：努力积分 + 分段难度 */
}
/* ===== renderStatsExtras 二次区块拆分 =====
 * 纯平移：周对比/时长分布/近8周/段位卡 4 个剩余大块再拆为独立顶层函数（紧贴本函数上方），
 * 统一签名 (SC)（与 先例一致）；主函数保留指标卡+已拆函数调用序 */
function renderWeekCompareChart(SC) {
  /* 本周 vs 上周 */
  const _wc = document.getElementById('weekCompare');
  if (_wc) {
    const n = SC.weekNow,
      p = SC.weekPrev;
    if (SC.totalFull + SC.totalAll === 0) {
      _wc.innerHTML =
        '<div style="grid-column:1/3;text-align:center;color:var(--text-light);font-size:var(--fs-body);padding:var(--sp-12);">完成番茄后这里会对比本周与上周</div>';
    } else {
      const _row = function (label, nowV, prevV, fmt) {
        const diff = nowV - prevV;
        const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
        const col = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--text-light)';
        return (
          '<div style="background:var(--card);border:1px solid var(--border-strong);border-radius:var(--radius);padding:var(--sp-8) var(--sp-10);text-align:center;"><div style="font-size:var(--fs-note);color:var(--text-light);font-weight:700;">' +
          label +
          '</div><div style="font-size:var(--fs-hero);font-weight:900;margin-top:var(--sp-2);">' +
          fmt(nowV) +
          '</div><div style="font-size:var(--fs-note);color:' +
          col +
          ';font-weight:700;">' +
          arrow +
          (diff === 0 ? ' 持平' : (diff > 0 ? ' +' : ' ') + diff) +
          '</div></div>'
        );
      };
      _wc.innerHTML =
        _row('本周🍅', n.full, p.full, function (v) {
          return v;
        }) +
        _row('专注分钟', n.mins, p.mins, function (v) {
          return fmtUnitLarge(v);
        }) +
        _row('打断次数', n.ints, p.ints, function (v) {
          return v;
        }) +
        _row('专注效率', n.eff != null ? n.eff : 0, p.eff != null ? p.eff : 0, function (v) {
          return v + '%';
        });
    }
  }
}

function renderDurDistribution(SC) {
  const _dc = document.getElementById('durChart');
  if (_dc) {
    const labels = ['<15分', '15-25分', '25-35分', '35+分'];
    const max = Math.max.apply(null, SC.durBuckets.concat([1]));
    _dc.innerHTML =
      '<div style="display:flex;align-items:flex-end;height:130px;gap:var(--sp-8);justify-content:center;">' +
      SC.durBuckets
        .map(function (v, i) {
          return (
            '<div style="display:flex;flex-direction:column;align-items:center;gap:var(--sp-4);"><div style="width:38px;background:var(--c-energy);border-radius:var(--radius-xs) var(--radius-xs) 0 0;height:' +
            Math.max(2, Math.round((v / max) * 120)) +
            'px;display:flex;align-items:flex-start;justify-content:center;color:#fff;font-size:var(--fs-caption);font-weight:800;padding-top:var(--sp-2);">' +
            v +
            '</div><div style="font-size:var(--fs-caption);color:var(--text-light);">' +
            labels[i] +
            '</div></div>'
          );
        })
        .join('') +
      '</div>';
  }
}

function renderWeek8Chart(SC) {
  const _w8 = document.getElementById('week8Chart');
  if (_w8) {
    const max = Math.max.apply(
      null,
      SC.week8
        .map(function (w) {
          return w.full;
        })
        .concat([1])
    );
    _w8.innerHTML =
      '<div style="display:flex;align-items:flex-end;height:120px;gap:var(--sp-4);justify-content:center;">' +
      SC.week8
        .map(function (w) {
          return (
            '<div style="display:flex;flex-direction:column;align-items:center;gap:var(--sp-2);"><div style="width:28px;background:' +
            (w.isCurrent ? 'var(--primary)' : 'var(--c-energy)') +
            ';border-radius:var(--radius-xs) var(--radius-xs) 0 0;height:' +
            Math.max(2, Math.round((w.full / max) * 100)) +
            'px;display:flex;align-items:flex-start;justify-content:center;color:#fff;font-size:var(--fs-tiny);font-weight:800;">' +
            w.full +
            '</div><div style="font-size:var(--fs-micro);color:var(--text-light);">' +
            w.label +
            '</div>' +
            (w.isCurrent ? '<div style="font-size:var(--fs-micro);color: var(--primary-ink);font-weight:700;">本周</div>' : '') +
            '</div>'
          );
        })
        .join('') +
      '</div>';
  }
}

function renderFocusRankBox(SC) {
  const _fr = document.getElementById('focusRankBox');
  if (_fr) {
    const fr = SC.focusRank;
    if (!fr || !fr.seg) {
      _fr.innerHTML =
        '<span style="color:var(--text-light);font-size:var(--fs-body);">完成第一个番茄后，这里会显示你的专注段数</span>';
    } else {
      const pct = Math.min(100, Math.round((fr.remain / fr.needNext) * 100));
      const glow = fr.seg >= 80 ? 'box-shadow:0 0 14px ' + fr.color + '66;' : '';
      const tierTip =
        fr.seg < 10
          ? '刚起步，多专注就能快速升段'
          : fr.seg < 30
            ? '小有所成，坚持每天做番茄就能稳定升段'
            : fr.seg < 50
              ? '已经是老玩家了，每升一段都值得庆祝'
              : fr.seg < 70
                ? '高段数，每一段都是长期坚持的证明'
                : fr.seg < 90
                  ? '传说段数，极少有人能走到这里'
                  : fr.seg >= 100
                    ? '100 段目标达成！难度已封顶，之后每段都是纯粹的坚持，继续突破更高段数'
                    : '';
      /* 冲段徽章：破限(连击≥7) / 冲刺(连击1-6或今日已8+) / 无 */
      const _sp = fr.sprint || { todayCount: 0, streak: 0, mult: 1.2, mode: 'normal', base: 8 };
      let _spBadge = '';
      if (_sp.mode === 'break') {
        _spBadge =
          '<div style="display:flex;align-items:center;gap:var(--sp-6);margin-top:var(--sp-8);padding:var(--sp-6) var(--sp-10);border-radius:var(--radius);background:linear-gradient(90deg,rgba(255,138,80,.20),rgba(255,213,79,.10));border:1px solid var(--accent);font-size:var(--fs-note);font-weight:700;">' +
          '<span style="color:var(--accent);">⚡ 破限冲刺</span>' +
          '<span style="color:var(--text-light);font-weight:500;">连续 ' +
          _sp.streak +
          ' 天 12+🍅 · 今日第 9 个起积分 ×' +
          _sp.mult +
          '</span>' +
          '</div>';
      } else if (_sp.mode === 'sprint') {
        const _sprTxt =
          _sp.streak >= 1
            ? '连续 ' + _sp.streak + ' 天冲刺 · 今日第 9 个起 ×' + _sp.mult
            : '今日已 ' + _sp.todayCount + ' 个 · 第 9 个起 ×' + _sp.mult;
        _spBadge =
          '<div style="display:flex;align-items:center;gap:var(--sp-6);margin-top:var(--sp-8);padding:var(--sp-6) var(--sp-10);border-radius:var(--radius);background:rgba(255,138,80,.10);border:1px dashed var(--accent);font-size:var(--fs-note);font-weight:700;">' +
          '<span style="color:var(--accent);">🔥 冲刺中</span>' +
          '<span style="color:var(--text-light);font-weight:500;">' +
          _sprTxt +
          '</span>' +
          '</div>';
      }
      _fr.innerHTML =
        '<div style="display:flex;align-items:center;gap:var(--sp-16);padding:var(--sp-8) var(--sp-4);">' +
        '<div style="width:120px;height:120px;border-radius:50%;background:radial-gradient(circle at 32% 30%,#fff,#eee);border:5px solid ' +
        fr.color +
        ';display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        glow +
        '"><div style="font-size:54px;font-weight:900;color:' +
        fr.color +
        ';line-height:1;">' +
        fr.seg +
        '</div><div style="font-size:var(--fs-caption);color:var(--text-light);letter-spacing:3px;margin-top:var(--sp-2);">段</div></div>' +
        '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:var(--fs-hero);font-weight:900;color:' +
        fr.color +
        ';">' +
        fr.icon +
        ' ' +
        fr.tier +
        '</div>' +
        '<div style="font-size:var(--fs-note);color:var(--text-light);margin:var(--sp-2) 0 var(--sp-6);line-height:1.5;">累计 ' +
        fr.points +
        ' 积分 · ' +
        tierTip +
        '</div>' +
        '<div style="height:14px;border-radius:var(--radius-sm);background:rgba(128,128,128,.16);overflow:hidden;"><div style="width:' +
        pct +
        '%;height:100%;background:linear-gradient(90deg,' +
        fr.color +
        ',#FFD54F);border-radius:var(--radius-sm);"></div></div>' +
        '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-4);">距 段 ' +
        (fr.seg + 1) +
        ' 还差 <b style="color:' +
        fr.color +
        ';">' +
        Math.max(0, fr.needNext - fr.remain) +
        '</b> 积分 · 本段进度 ' +
        fr.remain +
        '/' +
        fr.needNext +
        '</div>' +
        '</div></div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sp-4);margin-top:var(--sp-8);">' +
        '<div style="background:var(--card);border-radius:var(--radius-sm);padding:var(--sp-6) var(--sp-2);text-align:center;"><div style="font-size:var(--fs-body);font-weight:800;color: var(--primary-ink);">' +
        fmtUnitLarge(fr.raw.focusMin || 0) +
        '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">专注分钟</div></div>' +
        '<div style="background:var(--card);border-radius:var(--radius-sm);padding:var(--sp-6) var(--sp-2);text-align:center;"><div style="font-size:var(--fs-body);font-weight:800;color: var(--green-ink);">' +
        (fr.raw.full || 0) +
        '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">完整🍅</div></div>' +
        '<div style="background:var(--card);border-radius:var(--radius-sm);padding:var(--sp-6) var(--sp-2);text-align:center;"><div style="font-size:var(--fs-body);font-weight:800;color: var(--yellow-ink);">' +
        ((fr.raw.half || 0) + (fr.raw.inc || 0)) +
        '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">半个+未完成</div></div>' +
        '<div style="background:var(--card);border-radius:var(--radius-sm);padding:var(--sp-6) var(--sp-2);text-align:center;"><div style="font-size:var(--fs-body);font-weight:800;color:' +
        fr.color +
        ';">' +
        fr.points +
        '</div><div style="font-size:var(--fs-tiny);color:var(--text-light);">总积分</div></div>' +
        '</div>' +
        (_spBadge || '') +
        '<div style="margin-top:var(--sp-10);border:1px solid var(--border);border-radius:var(--radius-input);overflow:hidden;">' +
        '<div onclick="toggleSegRules()" style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-8) var(--sp-12);background:var(--card);cursor:pointer;-webkit-tap-highlight-color:transparent;">' +
        '<span style="font-size:var(--fs-note);font-weight:800;color:var(--text-light);">📜 规则与冲段</span>' +
        '<span id="segRulesArrow" style="font-size:var(--fs-caption);color:var(--text-light);">' +
        (_segRulesOpen ? '▾' : '▸') +
        '</span>' +
        '</div>' +
        '<div id="segRulesBody" style="display:' +
        (_segRulesOpen ? 'block' : 'none') +
        ';padding:var(--sp-10) var(--sp-12);border-top:1px solid var(--border);font-size:var(--fs-caption);color:var(--text-light);line-height:1.75;">' +
        '<div style="margin-bottom:var(--sp-10);">' +
        '<div style="font-size:var(--fs-note);font-weight:800;color:var(--text-light);margin-bottom:var(--sp-2);">🎯 积分怎么算</div>' +
        '<div>每专注 1 分钟 <b style="color:var(--text);">+1 积分</b>；完成完整🍅 <b style="color: var(--green-ink);">+5</b>、半个🍅 <b style="color: var(--yellow-ink);">+2</b>、未完成 <b style="color:var(--text-light);">+1</b></div>' +
        '</div>' +
        '<div style="margin-bottom:var(--sp-10);padding-top:var(--sp-8);border-top:1px solid var(--border);">' +
        '<div style="font-size:var(--fs-note);font-weight:800;color: var(--green-ink);margin-bottom:var(--sp-2);">📈 段数难度</div>' +
        '<div>30 段前轻松入门，之后难度逐档上升：每段所需积分平滑递增，越到后面越考验坚持。100 段是里程碑，之后难度固定不再加难，段数没有上限——能走多远，全看你自己。</div>' +
        '</div>' +
        '<div style="padding-top:var(--sp-8);border-top:1px solid var(--border);">' +
        '<div style="font-size:var(--fs-note);font-weight:800;color:var(--accent);margin-bottom:var(--sp-4);">🚀 冲段加速</div>' +
        '<div style="display:grid;grid-template-columns:62px 1fr;gap:var(--sp-2) var(--sp-8);">' +
        '<span style="font-weight:700;color:var(--accent);">基准线</span><span>每天前 8 个🍅积分照旧（原曲线不变）</span>' +
        '<span style="font-weight:700;color:var(--accent);">冲刺区</span><span>第 9 个🍅起，超额积分 ×1.2 起步</span>' +
        '<span style="font-weight:700;color:var(--accent);">连击</span><span>连续 1-6 天每天 12+🍅 → ×1.4</span>' +
        '<span style="font-weight:700;color:var(--accent);">破限</span><span>连续 ≥7 天每天 12+🍅 → ×1.8</span>' +
        '<span style="font-weight:700;color:var(--accent);">断连</span><span>某天不足 12 个 → 连击清零</span>' +
        '</div>' +
        '<div style="margin-top:var(--sp-6);padding:var(--sp-6) var(--sp-8);border-radius:var(--radius-sm);background:rgba(255,138,80,.10);">冲刺区积分加成，只奖励多出来的那份努力——冲得越猛，升得越快</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    }
  }
}

function renderStatsExtras(SC) {
  /* 指标卡：专注效率 + 平均专注时长 */
  const _se = document.getElementById('statEfficiency');
  if (_se) _se.textContent = SC.efficiency != null ? SC.efficiency + '%' : '--';
  const _sa = document.getElementById('statAvgDur');
  if (_sa) _sa.textContent = SC.avgDur != null ? SC.avgDur + '分' : '--';
  renderWeekCompareChart(SC);
  /* 完成质量堆叠（近7天） */
  /* () 已拆至 renderQualityStack(SC) */
  renderQualityStack(SC);
  renderDurDistribution(SC);
  /* 任务计划 vs 实际：逐任务双条形直观对比（预计条 vs 实际条） */
  renderWeek8Chart(SC);
  /* 打断分析：浪费时长 + 次数 + 平均每次 + 打断率 + 类别条形图 */
  /* () 已拆至 renderInterruptAnalysis(SC) */
  renderInterruptAnalysis(SC);
  /* () 已拆至 renderRankTrendChart(SC) */
  renderRankTrendChart(SC);
  renderFocusRankBox(SC);
}
/* 懒加载：点击「今日分析」展开时才计算；数据未变化则不重复计算 */
let _lastAnaKey = null;
function toggleTodayAnalysis() {
  const body = document.getElementById('todayAnalysisBody');
  const arrow = document.getElementById('todayAnalysisArrow');
  if (!body) return;
  if (body.style.display === 'none') {
    const C = getStatsCache();
    if (_lastAnaKey !== C.key) {
      renderTodayAnalysis();
      _lastAnaKey = C.key;
    }
    body.style.display = 'block';
    if (arrow) arrow.textContent = '▾';
  } else {
    body.style.display = 'none';
    if (arrow) arrow.textContent = '▸';
  }
}
/* ===== renderTodayAnalysis 今日分析拆分 =====
 * 基准计算段 / 结论文案段 / 目标雷达 / 行动建议 拆为 4 个独立顶层函数（紧贴本函数上方），
 * 渲染 helper 解构 ctx 还原原变量名；目标雷达使用全局常量与 rank 数据。 */
function calcTodayAnalysisBase(C, tb) {
  /* ---- 计算对比基准（近14天逐日） ---- */
  const days14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = getDateStr(d);
    const b = C.byDate[ds] || null;
    days14.push({
      ds: ds,
      b: b,
      full: b ? b.full : 0,
      rate: b ? (b.full + b.half + b.incomplete ? b.full / (b.full + b.half + b.incomplete) : 0) : 0,
      intPer: b ? (b.full + b.half ? b.int / (b.full + b.half) : 0) : 0
    });
  }
  const w2 = days14.slice(0, 7),
    w1 = days14.slice(7, 14); // w1=近7天(含今天往前) w2=前7天
  const sum = function (arr, fn) {
    return arr.reduce(function (s, x) {
      return s + fn(x);
    }, 0);
  };
  const w1Full = sum(w1, function (x) {
      return x.full;
    }),
    w2Full = sum(w2, function (x) {
      return x.full;
    });
  const w1Rate =
      sum(w1, function (x) {
        return x.rate;
      }) / 7,
    w2Rate =
      sum(w2, function (x) {
        return x.rate;
      }) / 7;
  const w1Int =
      sum(w1, function (x) {
        return x.intPer;
      }) / 7,
    w2Int =
      sum(w2, function (x) {
        return x.intPer;
      }) / 7;
  const baseAvg =
    sum(days14, function (x) {
      return x.full;
    }) / 14; // 基线：近14天日均
  /* 断档日：近14天空窗的星期几 */
  const dowGap = [0, 0, 0, 0, 0, 0, 0];
  const dowCount = [0, 0, 0, 0, 0, 0, 0];
  days14.forEach(function (x) {
    const wd = new Date(x.ds + 'T00:00:00').getDay();
    dowCount[wd]++;
    if (x.full === 0) dowGap[wd]++;
  });
  let gapDow = -1,
    gapMax = 0;
  for (let i = 0; i < 7; i++) {
    if (dowCount[i] >= 2 && dowGap[i] > gapMax) {
      gapMax = dowGap[i];
      gapDow = i;
    }
  }
  const dowNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  /* 高效时段（历史全量，按占比） */
  const pSum = C.periods[0] + C.periods[1] + C.periods[2] + C.periods[3];
  const pn = ['早晨', '下午', '晚上', '深夜'];
  let bestP = 0;
  for (let i = 1; i < 4; i++) if (C.periods[i] > C.periods[bestP]) bestP = i;
  const bestPct = pSum ? Math.round((C.periods[bestP] / pSum) * 100) : 0;
  const pctArr = C.periods.map(function (v) {
    return pSum ? Math.round((v / pSum) * 100) : 0;
  });
  /* 今日时段 */
  const tpd = tb.pd || [0, 0, 0, 0];
  let todayBestP = 0;
  for (let i = 1; i < 4; i++) if (tpd[i] > tpd[todayBestP]) todayBestP = i;
  return {
    days14: days14,
    w1Full: w1Full,
    w2Full: w2Full,
    w1Rate: w1Rate,
    w2Rate: w2Rate,
    w1Int: w1Int,
    w2Int: w2Int,
    baseAvg: baseAvg,
    dowGap: dowGap,
    gapDow: gapDow,
    gapMax: gapMax,
    dowNames: dowNames,
    pSum: pSum,
    pn: pn,
    bestP: bestP,
    bestPct: bestPct,
    pctArr: pctArr,
    tpd: tpd,
    todayBestP: todayBestP
  };
}

function buildTodayInsight(C, tb, ctx, total, full) {
  const { w1Full, w2Full, w1Rate, w2Rate, w1Int, w2Int, baseAvg, gapDow, gapMax, dowNames,
          pSum, pn, bestP, bestPct, todayBestP, tpd } = ctx;
  /* ---- 生成分析结论（结论先行，数据作依据） ---- */
  const insight = [];
  if (total === 0) {
    insight.push({
      t: '🌱',
      s:
        '今天还没开始。你的基线是每天 ' +
        baseAvg.toFixed(1) +
        ' 个番茄' +
        (gapDow >= 0 && gapMax >= 1 ? '，' + dowNames[gapDow] + '是你最容易断档的日子，别让今天成为又一个空窗' : '') +
        '——种下第一个就成功一半。'
    });
  } else {
    /* 1. 状态趋势 */
    if (w2Full > 0 && w1Full !== w2Full) {
      const diff = Math.round(((w1Full - w2Full) / w2Full) * 100);
      insight.push({
        t: diff > 0 ? '📈' : '📉',
        s:
          '近一周完成 ' +
          w1Full +
          ' 个番茄，比上一周（' +
          w2Full +
          ' 个）' +
          (diff > 0 ? '提升 ' + diff + '%' : '下降 ' + Math.abs(diff) + '%') +
          (diff > 0 ? '，你的状态正在回升。' : '，可能是任务太重或太累了。')
      });
    } else if (w1Full > 0) {
      insight.push({ t: '📊', s: '近两周节奏稳定，日均 ' + baseAvg.toFixed(1) + ' 个番茄——你已经把专注变成了习惯。' });
    }
    /* 2. 完整率趋势 */
    if (total > 0 && w1Rate > 0 && Math.abs(w1Rate - w2Rate) >= 0.15) {
      insight.push({
        t: w1Rate > w2Rate ? '✨' : '⚠️',
        s:
          '完整率从 ' +
          Math.round(w2Rate * 100) +
          '% 变为 ' +
          Math.round(w1Rate * 100) +
          '%' +
          (w1Rate > w2Rate ? '，番茄质量在变好，保持！' : '，说明任务安排可能越来越满，试着砍掉一点。')
      });
    }
    /* 3. 打断归因 */
    if (w1Int > 0 && w1Int - w2Int >= 0.2 && full > 0) {
      insight.push({
        t: '⏸️',
        s:
          '近一周每个番茄平均被打断 ' +
          w1Int.toFixed(1) +
          ' 次（上周 ' +
          w2Int.toFixed(1) +
          ' 次），打断变多了——开始前 3 分钟清空桌面、手机静音试试。'
      });
    }
    /* 4. 高效时段 vs 今日 */
    if (pSum > 0 && todayBestP !== bestP && tpd[todayBestP] > 0) {
      insight.push({
        t: '⏰',
        s:
          '你的高效时段其实是' +
          pn[bestP] +
          '（历史占 ' +
          bestPct +
          '%），今天却主要在' +
          pn[todayBestP] +
          '完成——重要任务挪到' +
          pn[bestP] +
          '，效率会更高。'
      });
    } else if (pSum > 0 && tpd[todayBestP] > 0) {
      insight.push({ t: '⏰', s: '今天在' + pn[bestP] + '完成最多，正好是你的高效时段——安排得当，今天效率在线。' });
    }
    /* 5. 今日异常 */
    if (baseAvg > 0) {
      const dev = full - baseAvg;
      if (dev <= -baseAvg * 0.4) {
        insight.push({
          t: '⚠️',
          s:
            '今天 ' +
            full +
            ' 个，比你的基线（' +
            baseAvg.toFixed(1) +
            ' 个/天）低 ' +
            Math.round((-dev / baseAvg) * 100) +
            '%——状态不佳或任务太难？先别自责，明天降低一点难度找回节奏。'
        });
      } else if (dev >= baseAvg * 0.4) {
        insight.push({
          t: '🏆',
          s:
            '今天 ' +
            full +
            ' 个，超出基线（' +
            baseAvg.toFixed(1) +
            ' 个/天）' +
            Math.round((dev / baseAvg) * 100) +
            '%——超常发挥，记得奖励自己一下！'
        });
      }
    }
    /* 6. 作息画像 */
    if (C.earlyStreak >= 3 && C.earlyStreak > C.nightStreak) {
      insight.push({
        t: '🌅',
        s: '你是早起型选手（最长连续早起 ' + C.earlyStreak + ' 天）——早上的专注很宝贵，把最难的任务放在清晨。'
      });
    } else if (C.nightStreak >= 3) {
      insight.push({
        t: '🌙',
        s:
          '你是深夜型选手（最长连续深夜 ' +
          C.nightStreak +
          ' 天）——深夜效率高，但长期熬夜会透支状态，试着每周把 1-2 个深夜番茄挪到白天。'
      });
    }
    /* 7. 断档提醒 */
    if (gapDow >= 0 && gapMax >= 1 && full > 0) {
      insight.push({
        t: '📅',
        s:
          '过去两周里' +
          dowNames[gapDow] +
          '有 ' +
          gapMax +
          ' 次断档——这一天是不是有什么固定安排？提前规划一下，就能守住连续。'
      });
    }
    /* 8. 任务洞察 */
    const tlist = Object.keys(tb.tasks || {})
      .map(function (k) {
        return { n: k, c: tb.tasks[k] };
      })
      .sort(function (a, b) {
        return b.c - a.c;
      });
    if (tlist.length >= 3 && tlist[0].c >= 2 && tlist[0].c >= tlist[1].c * 2) {
      insight.push({
        t: '📋',
        s:
          '今天的精力明显集中在「' +
          tlist[0].n +
          '」（' +
          tlist[0].c +
          ' 个番茄），深度投入一件事的效果比分散好得多——继续保持单点突破。'
      });
    } else if (tlist.length >= 2) {
      insight.push({
        t: '📋',
        s: '今天做了 ' + tlist.length + ' 类任务，最投入的是「' + tlist[0].n + '」（' + tlist[0].c + ' 个）。'
      });
    }
  }
  return insight;
}

function buildTodayAnalysisGoals() {
  /* 目标雷达（一条） */
  const wc = countWeekTomatoes(getWeekStartStr());
  let nextB = null;
  for (let i = 0; i < WEEKLY_BADGES.length; i++) {
    const b = WEEKLY_BADGES[i];
    if (getBadgeState(b) === 'off' && b.goal - wc > 0 && (!nextB || b.goal - wc < nextB.goal - wc)) nextB = b;
  }
  const rs = appData.rankSystem || {};
  const tier = getRankFromStars(rs.stars || 0);
  const nextTier = RANK_TIERS[RANK_TIERS.indexOf(tier) + 1];
  const goals = [];
  if (nextB && nextB.goal - wc <= 15)
    goals.push('距「' + nextB.name + '」还差 ' + Math.max(1, Math.ceil(nextB.goal - wc)) + ' 个番茄');
  if (nextTier && nextTier.min - (rs.stars || 0) <= 15)
    goals.push('距「' + nextTier.name + '」段位还差 ' + (nextTier.min - (rs.stars || 0)) + ' 星');
  return goals;
}

function buildTodayAdviceHTML(ctx, C, total, full) {
  const { w1Int, w1Full, w2Full, pSum, pn, bestP } = ctx;
  let html = '';
  /* ===== 智能行动建议：基于数据给出可执行的操作建议 ===== */
  const advice = [];
  /* 建议1：连续断档天数的恢复 */
  if ((C.streak || 0) === 0 && C.activeDays >= 3) {
    advice.push('连续天数断了，今天种1个番茄就能重新开始——不用追求完美，先动起来。');
  } else if (w1Int > 1.5 && full > 0) {
  /* 建议2：打断过多时建议调短番茄 */
    advice.push(
      '打断频率偏高（平均' + w1Int.toFixed(1) + '次/番茄），试试把番茄时长从设置里调到15-20分钟，降低被打断概率。'
    );
  } else if (pSum > 0 && full === 0) {
  /* 建议3：高效时段没利用 */
    advice.push('你的高效时段是' + pn[bestP] + '，趁现在开始一个番茄效果最好。');
  } else if (total >= 3 && full / total < 0.5) {
  /* 建议4：完整率低 */
    advice.push('今天的完整率偏低，超过一半的番茄没做完——可能任务切得太碎，试试先做最重要的那一件。');
  } else if (w2Full > 0 && w1Full > w2Full && full > 0) {
  /* 建议5：状态回升鼓励 */
    advice.push('本周比上周进步了，保持这个势头——趁状态好可以多做一个。');
  }
  /* 建议6：习惯联动 */
  if (!appData.habits || appData.habits.length === 0) {
    advice.push('还没设置任何习惯打卡——去「计划」页面添加一个，和番茄联动每天额外+1树积分。');
  }
  /* 建议7：番茄树阶段提示 */
  const treePts = appData.tree.points || 0;
  if (treePts > 0 && treePts < 40) {
    advice.push('番茄树当前' + treePts + '🍅，再' + (40 - treePts) + '个就长成小树开始结果了。');
  }
  if (advice.length) {
    html += '<div style="margin-top:var(--sp-8);border-top:1px solid var(--border);padding-top:var(--sp-8);">';
    html += '<div style="font-size:var(--fs-title);font-weight:700;color: var(--green-ink);margin-bottom:var(--sp-4);">💡 行动建议</div>';
    advice.forEach(function (a) {
      html += '<div style="padding:var(--sp-2) 0;font-size:var(--fs-title);color:var(--text-light);line-height:1.6;">' + a + '</div>';
    });
    html += '</div>';
  }
  return html;
}

function renderTodayAnalysis() {
  const body = document.getElementById('todayAnalysisBody');
  if (!body) return;
  const C = getStatsCache();
  const tb = C.tb;
  const full = tb.full,
    half = tb.half,
    incomplete = tb.incomplete,
    ints = tb.int;
  const total = full + half + incomplete;
  /* 数据量门槛：历史不足 3 天或记录太少时不做分析，避免荒谬结论（仍展示各板块汇总的空态提示） */
  if (C.activeDays < 3 || C.totalAll < 5) {
    body.innerHTML =
      '<div style="color:var(--text-light);">📊 数据还在积累中（至少需要 3 天的记录）——再坚持几天，这里就能分析出你的专注规律了。</div>' +
      renderAllBlockAnalysis();
    return;
  }
  const ctx = calcTodayAnalysisBase(C, tb);
  const insight = buildTodayInsight(C, tb, ctx, total, full);
  const goals = buildTodayAnalysisGoals();
  let html = '';
  if (insight.length) {
    insight.forEach(function (x) {
      html += '<div style="padding:var(--sp-2) 0;">' + x.t + ' <b style="color:var(--text);">' + x.s + '</b></div>';
    });
  } else {
    html += '<div style="color:var(--text-light);">数据还在积累中——再记录几天，这里就能分析你的专注规律了。</div>';
  }
  if (goals.length)
    html +=
      '<div style="margin-top:var(--sp-6);border-top:1px solid var(--border);padding-top:var(--sp-6);">🎯 <b style="color: var(--primary-ink);">冲刺提醒：</b>' +
      goals.join(' · ') +
      '</div>';
  html += buildTodayAdviceHTML(ctx, C, total, full);
  body.innerHTML =
    html +
    renderAllBlockAnalysis() +
    /* 整个页面最后的小提示：说明懒加载机制，避免用户疑惑为什么重复展开内容不变 */
    '<div style="margin-top:var(--sp-14);padding:var(--sp-8) var(--sp-12);border-radius:var(--radius);background:var(--bg);border:1px solid var(--hairline);font-size:var(--fs-caption);color:var(--text-light);line-height:1.7;">' +
    '💡 分析加载说明：所有「💡 数据分析」都按需加载，展开一次后即停止加载；<b>折叠后再次展开</b>才会用最新数据重新计算一遍。</div>';
}
/* 各板块分析汇总：今日分析展开时，把每个图表板块的专属分析全部汇总展示（复用 ANALYZERS 懒计算缓存） */
const ALL_BLOCK_KEYS = [
  ['today', '📊 今日概览'],
  ['week', '⚖️ 本周 vs 上周'],
  ['trend', '📈 近7天趋势'],
  ['heat', '🕐 时段分布'],
  ['mood', '🧠 身心状态'],
  ['quality', '🍅 完成质量'],
  ['dur', '⏱ 专注时长'],
  ['task', '📋 任务计划'],
  ['week8', '🗓 每周节奏'],
  ['interrupt', '🚫 打断分析'],
  ['rank', '⭐ 上分趋势'],
  ['monthly', '📊 月度专注'],
  ['yearly', '📈 年度专注'],
  ['focus', '🎮 专注段数']
];
/* 各板块分析汇总：默认折叠，点击展开才懒计算（算一次缓存，之后直接复用，避免打开今日分析时一次性跑 14 个分析器卡顿） */
let _allAnaHtml = null,
  _allAnaKey = '';
function toggleAllBlockAnalysis() {
  const body = document.getElementById('allBlockAnalysisBody');
  const arrow = document.getElementById('allBlockAnalysisArrow');
  if (!body) return;
  const open = body.style.display !== 'none';
  if (open) {
    body.style.display = 'none';
    if (arrow) arrow.textContent = '▸';
    /* 折叠 = 丢弃已加载结果，再展开会重新计算（保证汇总始终跟最新数据一致） */
    _allAnaHtml = null;
    return;
  }
  body.style.display = 'block';
  if (arrow) arrow.textContent = '▾';
  /* 数据变化（新记录/切天等）后缓存失效，重新计算 */
  const curKey = document.getElementById('todayAnalysisKey')
    ? document.getElementById('todayAnalysisKey').textContent
    : '';
  if (_allAnaHtml && _allAnaKey === curKey) {
    body.innerHTML = _allAnaHtml;
    return;
  }
  body.innerHTML = '<span class="an-spin">正在分析中…</span>';
  setTimeout(function () {
    // 让转圈可见，再异步计算
    let html = '';
    ALL_BLOCK_KEYS.forEach(function (b) {
      const k = b[0];
      let txt = '';
      try {
        txt = ANALYZERS[k] ? ANALYZERS[k](getStatsCache()) : '';
      } catch (e) {
        txt = '分析出错，请稍后再试';
      }
      html +=
        '<div style="margin:var(--sp-6) 0;"><div style="font-size:var(--fs-body);font-weight:700;color: var(--primary-ink);margin-bottom:var(--sp-2);">' +
        b[1] +
        '</div>' +
        '<div style="font-size:var(--fs-note);color:var(--text-light);line-height:1.8;background:var(--bg);border-radius:var(--radius-sm);padding:var(--sp-6) var(--sp-10);">' +
        (txt || '暂无足够数据') +
        '</div></div>';
    });
    _allAnaHtml = html;
    _allAnaKey = curKey;
    body.innerHTML = html;
  }, 60);
}
function renderAllBlockAnalysis() {
  const n = ALL_BLOCK_KEYS.length;
  let key = '';
  try {
    key = getStatsCache().key || '';
  } catch (e) { if (window.__silent) window.__silent(e, '01e8:renderAllBlockAnalysis'); }
  return (
    '<span id="todayAnalysisKey" style="display:none;">' +
    key +
    '</span>' +
    '<div style="margin-top:var(--sp-12);padding-top:var(--sp-10);border-top:1px solid var(--border);">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:var(--sp-6) var(--sp-2);" onclick="toggleAllBlockAnalysis()">' +
    '<div style="font-size:var(--fs-title);font-weight:800;color:var(--text);">📋 各板块分析汇总<span style="font-size:var(--fs-caption);color:var(--text-light);font-weight:600;margin-left:var(--sp-6);">共 ' +
    n +
    ' 个板块</span></div>' +
    '<span style="font-size:var(--fs-sub);color:var(--text-light);" id="allBlockAnalysisArrow">▸</span></div>' +
    '<div style="font-size:var(--fs-note);color:var(--text-light);margin-bottom:var(--sp-6);">与每个图表下方的「💡 数据分析」内容一致，点击展开后一次看完（首次展开稍等片刻）</div>' +
    '<div id="allBlockAnalysisBody" style="display:none;"></div>' +
    '</div>'
  );
}
/* ===== 每日一语 · 功能引导词库（40 条，按累计活跃天数分 4 阶段累积开放） ===== */
const GUIDE_WORD_PHASES = [
  /* 第一阶段 · 基础引导（累计活跃 ≤3 天可见，12 条） */
  [
    '点击“开始”，你的第一个番茄就在路上了。',
    '每完成一个番茄，你的树就长大一点。',
    '计划页可以添加今日任务，番茄会关联任务进度。',
    '每日任务完成目标，段位星就会上升。',
    '金币可以买装饰、场景、皮肤和道具。',
    '设置页可以导出/导入数据，建议定期备份。',
    '统计页有年度热力图，可以看到你一年的专注轨迹。',
    '习惯每天打卡，连续天数会累计成长点。',
    '在树界面勾选开关，你的树就会来到计时页右下角陪你专注，可拖动、可点击互动。',
    '沉浸式专注开启后，每次开始都会抽一张角色卡。',
    '赛季每 3 个月结算一次，段位会重置回退。',
    '蓝调模式在设置里可以开启，晚上用不刺眼。'
  ],
  /* 第二阶段 · 进阶引导（累计活跃 4 天起叠加，8 条） */
  [
    '传记会自动记录你的里程碑，也可以手动编辑。',
    '不同树种有不同外观和阶段，可以随时切换。',
    '极简模式会隐藏种树和段位，回归纯粹计时。',
    '赌注可以加星，但有风险，谨慎选择。',
    '专注记录可以补记、编辑、删除，随时完善。',
    '子任务和习惯打卡都可以在计时界面同步勾选。',
    '日历总览可以按月份查看你的专注记录。',
    '你可以导入自己的剧本，在设置页可以找到入口。'
  ],
  /* 第三阶段 · 深度引导（累计活跃 8 天起叠加，10 条） */
  [
    '树枯死了别慌，可以免费重种，也可以用商店的复活石复活（600 金币）。',
    '世界树满级后，每 50 点会长一圈年轮。',
    '当天专注超过 10 个番茄，可以获得一次保星机会。',
    '保护卡可以防止连续天数断裂，建议提前买。',
    '改名卡可以给小树改名字，每张只能用一次。',
    '年度专注地图显示 365 天的每一天，看看你走过的日子。',
    '4 个番茄 = 一章冒险，连续完成才能看到结局。',
    '事件失败不会直接结束，但会影响结局走向。',
    '随机剧本会记录在传记页，可以回头翻看你的冒险。',
    '数据体检可以修复异常值，放心使用。'
  ],
  /* 第四阶段 · 成就引导（累计活跃 30 天以上叠加，10 条） */
  [
    '成长图鉴集齐 9 阶段，达成“万物园丁”成就。',
    '连续 7 天浇水，获得露珠徽章，纯纪念品。',
    '累计 100 天有专注记录，解锁“百日坚持”成就。',
    '单日完成 16 个番茄，解锁“极限日”成就。',
    '随机剧本冒险想编多久编多久，随时能来一局新的。',
    '段位达到荣耀，计时器会带上黑金荣耀特效。',
    '点亮全部战标，你就是“独孤求败”。',
    '传记写满了 50 条，回看时你会感谢现在的自己。',
    '年度专注地图越填越满，那是你走过的路。',
    '这个番茄钟没有终点，你走到哪，它陪你到哪。'
  ]
];
/* 按累计活跃天数（有专注记录的日期去重数，与「百日坚持」成就同口径）返回当前可用引导词池（累积叠加） */
function getGuidePool() {
  let ad = 0;
  try {
    ad = getStatsCache().activeDays || 0;
  } catch (e) {
    ad = 0;
  }
  const P = GUIDE_WORD_PHASES;
  let pool = P[0].slice();
  if (ad >= 4) pool = pool.concat(P[1]);
  if (ad >= 8) pool = pool.concat(P[2]);
  if (ad > 30) pool = pool.concat(P[3]);
  return pool;
}
/* 引导词选取的雪崩混淆：种子微变（如今日记录数 +1）→ 选取结果大幅轮换 */
function _gMix(x) {
  x ^= x >>> 16;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917);
  x ^= x >>> 16;
  return x >>> 0;
}
function renderEncourage() {
  const C = getStatsCache();
  const today = C.today;
  const full = C.tb.full;
  const minutes = C.tb.minutes;
  const interrupted = C.tb.int;
  const totalTomatoes = C.totalFull;
  const streak = C.streak;
  const periodNames = ['早晨(6-12点)', '下午(12-18点)', '晚上(18-24点)', '深夜(0-6点)'];
  let bestPeriod = -1,
    bestCount = 0;
  for (let p = 0; p < 4; p++) {
    let cnt = 0;
    for (let wd = 0; wd < 7; wd++) cnt += C.heat[wd][p];
    if (cnt > bestCount) {
      bestCount = cnt;
      bestPeriod = p;
    }
  }
  const achievements = getAchievements();
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  /* 每日一语文案库（按日期种子当日固定，跨天自动换新） */
  const daySeed = (function () {
    const t = getTodayStr();
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return h;
  })();
  const pick = function (arr) {
    return arr[daySeed % arr.length];
  };
  /* ===== 功能引导混合：40% 概率改显功能引导词（不绑定触发条件、不存储状态）。
   种子=日期种子+今日专注记录数 → 打开 App 固定一条，每完成一次专注换一条，当天内同一进度下不跳变 */
  const _gN = C.tb.full + C.tb.half + C.tb.incomplete;
  const _gSeed = (daySeed * 31 + _gN) >>> 0;
  if (_gSeed % 100 < 40) {
    const _pool = getGuidePool();
    const _gw = _pool[_gMix(_gSeed) % _pool.length];
    const _gel = document.getElementById('encourageText');
    if (_gel) _gel.textContent = '💬 ' + _gw;
    return;
  }
  const L_start = [
    '今天还没种下第一颗番茄，现在开始，永远不晚。',
    '空白的今天，是最好的画布。开始画吧。',
    '拖延的按钮就在那里，但你也可以按下「开始」。',
    '一个番茄 25 分钟，先搞定最不想做的那件事。',
    '现在的你，只差一次「开始」。',
    '别想太多，先种一个番茄再说。',
    '万事开头难，但开头只需要 25 分钟。'
  ];
  const L_general = [
    '番茄不会辜负每一个认真的人。',
    '每一颗番茄，都是你写给未来的信。',
    '专注是一种天赋，更是一种练习。',
    '先专注 25 分钟，再考虑要不要继续。',
    '把大目标切成番茄，一口一口吃掉。',
    '现在的专注，是为了以后的从容。',
    '你比你以为的，更能坚持。',
    '认真做一件事的时候，时间会为你让路。',
    '慢慢来，比较快。',
    '专注的人，运气都不会太差。'
  ];
  const L_done = [
    '今天已完成 ' + full + ' 个番茄，状态很棒，继续保持！',
    '专注起来的你，连番茄都在为你加油。',
    '今天的你，已经赢过了大多数。',
    '保持这个节奏，目标就在前方。',
    '每一颗番茄都算数，今天真棒。'
  ];
  const L_streak = [
    '你已经连续专注 ' + streak + ' 天了，坚持比什么都珍贵！',
    '连续 ' + streak + ' 天，习惯的复利正在悄悄改变你。',
    '别人看的是天数，你攒的是底气。',
    '连续 ' + streak + ' 天不断档，这份稳定已是稀缺品。'
  ];
  const L_night = [
    '夜深了还在专注的你，记得也心疼一下自己。',
    '凌晨的努力很珍贵，但睡眠也是生产力。',
    '熬夜种番茄可以，别熬坏了身体这块田。',
    '如果今天到此为止，你也已经很棒了。',
    '夜深人静，最适合把今天收尾。'
  ];
  const L_master = [
    '累计 ' + totalTomatoes + ' 颗番茄的沉淀，你已是专注老手。',
    '熟能生巧，你早已深谙专注之道。',
    totalTomatoes + ' 颗番茄，这就是你的护城河。'
  ];
  const L_humor = [
    '番茄红了，你变强了。',
    '一颗番茄下肚，烦恼 -25 分钟。',
    '专注会传染，先从你开始。',
    '别人在刷手机，你在种番茄，格局打开了。',
    '今日份番茄，香！'
  ];
  let line = '';
  const hour = new Date().getHours();
  if (full === 0) {
    line = pick(L_start);
  } else if (hour >= 0 && hour < 6) {
    line = pick(L_night);
  } else if (streak >= 3) {
    line = pick(L_streak);
  } else if (totalTomatoes >= 100) {
    line = pick(L_master);
  } else if (full >= 3) {
    line = pick(L_done);
  } else if (full === 1) {
    line = pick(L_humor);
  } else {
    line = pick(L_general);
  }
  /* 拼一个动态小尾巴：当天数据 + 成就进度 */
  let tail = '';
  if (full > 0 && hour < 18 && bestPeriod >= 0 && bestCount > 0 && full >= 2) {
    tail = ' · 高效时段：' + periodNames[bestPeriod];
  } else if (unlockedCount >= 1) {
    tail = ' · 成就 ' + unlockedCount + '/' + achievements.length;
  }
  /* 番茄树动态尾巴 */
  if ((appData.tree.peakPoints || 0) >= 10) {
    const ts = getTreeStage(appData.tree.points);
    tail = ' · ' + ts.emoji + ' ' + ts.name + '阶段';
  }
  const el = document.getElementById('encourageText');
  if (el) el.textContent = '💬 ' + line + tail;
}
function getTreeTitle(peak) {
  peak = peak || 0;
  for (let i = TREE_TITLES.length - 1; i >= 0; i--) {
    if (peak >= TREE_TITLES[i].min) return TREE_TITLES[i];
  }
  return TREE_TITLES[0];
}
/* ===== 计时页陪伴树 ===== */
function renderTimerTree() {
  let box = document.getElementById('timerTreeCompanion');
  if (!box) return;
  let sid = appData.tree.timerTreeSpecies || '';
  let on = !!sid && !!TREE_SPECIES[sid];
  box.style.display = on ? 'block' : 'none';
  if (!on) return;
  /* 恢复位置 */
  let pos = appData.tree.timerTreePos;
  if (pos && typeof pos.x === 'number') {
    box.style.left = pos.x + 'px';
    box.style.top = pos.y + 'px';
    box.style.bottom = 'auto';
    box.style.right = 'auto';
  }
  /* 初始化拖动（只绑一次） */
  if (!box._dragBound) {
    initTimerTreeDrag(box);
    box._dragBound = true;
  }
  let sp = TREE_SPECIES[sid] || TREE_SPECIES.tomato;
  let wasSpecies = appData.tree.species;
  appData.tree.species = sid;
  let stages = getCurrentTreeStages();
  let stage = getTreeStage(appData.tree.points || 0);
  appData.tree.species = wasSpecies;
  let emojiEl = document.getElementById('timerTreeEmoji');
  if (emojiEl) emojiEl.textContent = appData.tree.dead ? '🥀' : stage.emoji;
  let nameEl = document.getElementById('timerTreeName');
  if (nameEl) {
    if (appData.tree.dead) {
      nameEl.textContent = '枯死的树 · 待处理';
    } else {
      let _nm = treeDisplayName(sid);
      nameEl.textContent = _nm ? sp.name + ' · ' + _nm : sp.name + ' · ' + stage.name;
    }
  }
}
/* 陪伴树拖动 */
function initTimerTreeDrag(box) {
  let inner = document.getElementById('timerTreeInner');
  if (!inner) return;
  let dragging = false,
    moved = false,
    startX,
    startY,
    origLeft,
    origTop;
  function onDown(e) {
    /* 点击右上角 （关闭陪伴）时不启动拖动/说话 */
    if (e.target && (e.target.id === 'timerTreeClose' || e.target.className === 'timer-tree-close')) return;
    let pt = e.touches ? e.touches[0] : e;
    dragging = true;
    moved = false;
    startX = pt.clientX;
    startY = pt.clientY;
    let rect = box.getBoundingClientRect();
    let prect = box.parentNode.getBoundingClientRect();
    origLeft = rect.left - prect.left;
    origTop = rect.top - prect.top;
    box.style.bottom = 'auto';
    box.style.right = 'auto';
    box.style.left = origLeft + 'px';
    box.style.top = origTop + 'px';
    box.classList.add('dragging');
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    let pt = e.touches ? e.touches[0] : e;
    let dx = pt.clientX - startX,
      dy = pt.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    let prect = box.parentNode.getBoundingClientRect();
    let nx = origLeft + dx,
      ny = origTop + dy;
    /* 限制在父容器内 */
    nx = Math.max(0, Math.min(nx, prect.width - box.offsetWidth));
    ny = Math.max(0, Math.min(ny, prect.height - box.offsetHeight));
    box.style.left = nx + 'px';
    box.style.top = ny + 'px';
    e.preventDefault();
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    box.classList.remove('dragging');
    if (moved) {
      /* 保存位置 */
      let prect = box.parentNode.getBoundingClientRect();
      let rect = box.getBoundingClientRect();
      appData.tree.timerTreePos = { x: rect.left - prect.left, y: rect.top - prect.top };
      saveData();
    } else {
      /* 没移动=点击，触发说话 */
      timerTreeTalk();
    }
  }
  inner.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  inner.addEventListener('touchstart', onDown, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
}
function toggleTreeCompanion(on) {
  if (on) {
    if (appData.tree.dead) {
      showToast('🥀 树已枯死，先到种植养成页重种或复活');
      let cb2 = document.getElementById('treeCompanionToggle');
      if (cb2) cb2.checked = false;
      return;
    }
    if ((appData.tree.points || 0) < 40) {
      showToast('需要进化到小树(40🍅)才能开启陪伴');
      let cb = document.getElementById('treeCompanionToggle');
      if (cb) cb.checked = false;
      return;
    }
    var _revertCompanion = function () {
      let cb3 = document.getElementById('treeCompanionToggle');
      if (cb3) cb3.checked = false;
    };
    var _doEnable = function () {
      appData.tree.timerTreeSpecies = appData.tree.species || 'tomato';
      showToast('已设为计时页陪伴树：' + TREE_SPECIES[appData.tree.timerTreeSpecies].name);
      saveData();
      renderTreeSection();
      renderTimerTree();
    };
    var _companionMsg =
      '开启后，' +
      TREE_SPECIES[appData.tree.species || 'tomato'].name +
      '将出现在计时页右下角陪伴你（可拖动、可点击互动、右上角 ✕ 随时关闭）。确定开启吗？';
    if (typeof window.rsAsk === 'function') window.rsAsk(_companionMsg, { title: '开启陪伴' }, _doEnable, _revertCompanion);
    else if (confirm(_companionMsg)) _doEnable();
    else _revertCompanion();
    return;
  } else {
    appData.tree.timerTreeSpecies = '';
    showToast('已取消陪伴');
  }
  saveData();
  renderTreeSection();
  renderTimerTree();
}
function timerTreeTalk() {
  let v = document.getElementById('timerTreeEmoji');
  if (v) {
    v.classList.remove('growing');
    void v.offsetWidth;
    v.classList.add('growing');
    setTimeout(function () {
      v.classList.remove('growing');
    }, 600);
  }
  let tr = appData.tree;
  let today = getTodayStr();
  /* 今日首次触碰陪伴树 → 送 5 金币（中吉运势翻倍） */
  let touchBonus = getFortune() && getFortune().buff && getFortune().buff.touch ? getFortune().buff.touch : 5;
  if (tr.lastTouchBonusDate !== today) {
    tr.lastTouchBonusDate = today;
    saveData();
    let _b = document.getElementById('timerTreeBubble');
    if (_b) {
      _b.textContent = '主人来看我啦～送你 ' + touchBonus + ' 金币 💰 明天再来哦';
      _b.style.opacity = '1';
      clearTimeout(_b._t);
      _b._t = setTimeout(function () {
        _b.style.opacity = '0';
      }, 2600);
    }
    showGift('🌱 今日首次触碰植物，小树开心地送你', touchBonus);
    return;
  }
  let hour = new Date().getHours();
  let st = getTreeStage(tr.points || 0);
  let msg;
  let companionSid = tr.timerTreeSpecies || tr.species || 'tomato';
  if (tr.lastWaterDate !== today) {
    msg = '该浇水啦💧 我有点渴了~';
  } else if (hour < 6) {
    msg = pickTalk(TREE_TALKS_TIME.midnight);
  } else if (hour < 9) {
    msg = pickTalk(TREE_TALKS_TIME.morning);
  } else if (hour < 12) {
    msg = pickTalk(TREE_TALKS_TIME.am);
  } else if (hour < 14) {
    msg = pickTalk(TREE_TALKS_TIME.noon);
  } else if (hour < 17) {
    msg = pickTalk(TREE_TALKS_TIME.afternoon);
  } else if (hour < 22) {
    msg = timedTalk(hour, companionSid);
  } /* 原 <19/<22 两分支行为相同，合并 */ else if (st && st.name === '种子') {
    msg = '浇浇水，我就能发芽🌱';
  } else if (st && st.name === '小树') {
    msg = '我已经能陪你一起专注啦🌳';
  } else if (st && st.name === '大树') {
    msg = '大树陪伴计划启动🌲 一起加油！';
  } else {
    msg = timedTalk(hour, companionSid);
  }
  /* 喂食后当天：陪伴树也会再口头感谢一次 */
  if (_feedThanksLeft > 0 && tr.lastFeedDate === getTodayStr()) {
    _feedThanksLeft--;
    msg = FEED_THANKS_TALKS[Math.floor(Math.random() * FEED_THANKS_TALKS.length)];
  }
  /* 大凶运势：毒舌模式 */
  if (getFortune() && getFortune().buff && getFortune().buff.dark && Math.random() < 0.4) {
    msg = TREE_DARK_TALKS[Math.floor(Math.random() * TREE_DARK_TALKS.length)];
  }
  let b = document.getElementById('timerTreeBubble');
  if (b) {
    b.textContent = msg;
    b.style.opacity = '1';
    clearTimeout(b._t);
    b._t = setTimeout(function () {
      b.style.opacity = '0';
    }, 2600);
  }
}
/* ===== 自定义皮肤（树背景 / 计时器壁纸 / 皮肤商店，32 个函数）已迁至 01eJ_ui_skin.js（回退见该文件头注释）===== */
/* 宝箱弹出与开奖 */
function openChest() {
  const overlay = document.getElementById('chestOverlay');
  if (!overlay) return;
  /* 宝箱凭 chestCount 开：每累计 10 点成长值攒 1 个（见 addTreePoints）。
     原先这里既不校验也不扣次数 —— 弹窗能反复开、每次都直接进账。 */
  if ((appData.tree.chestCount || 0) <= 0) {
    showToast('没有宝箱啦～再攒 10 点成长值');
    closeChest();
    return;
  }
  appData.tree.chestCount = (appData.tree.chestCount || 0) - 1;
  const reward = rollChestReward();
  let rewardText = reward.text;
  if (reward.type === 'decor') {
    const d = randomUnlockedDecor();
    if (d) {
      const tr = appData.tree;
      if (!tr.decorations) tr.decorations = [];
      if (!tr.decorations.includes(d.id)) tr.decorations.push(d.id);
      if (!tr.decorExpires) tr.decorExpires = {};
      const cur = tr.decorExpires[d.id] || 0;
      tr.decorExpires[d.id] = Math.max(Date.now(), cur) + 30 * DAY_MS;
      if (!tr.activeDecorations) tr.activeDecorations = [];
      if (tr.activeDecorations.length < 2 && !tr.activeDecorations.includes(d.id)) tr.activeDecorations.push(d.id);
      rewardText = '🎁 获得装饰：「' + d.name + '」' + d.icon + '（30天）';
      showToast('🎁 宝箱开出稀有装饰：' + d.icon + ' ' + d.name + '（30天）！');
    } else {
      coinEarn(100, 'gift', '宝箱：装饰已集齐折现');
      rewardText = '🪙 +100 果实币（装饰已集齐）';
      showToast('🪙 装饰集齐，宝箱折现 100 果实币');
    }
  } else if (reward.type === 'coins') {
    coinEarn(reward.value, 'gift', '宝箱开出金币');
  } else if (reward.type === 'dew') {
    appData.tree.dewBadges = (appData.tree.dewBadges || 0) + 1;
    showToast('💧 宝箱开出露珠徽章！');
  }
  saveData();
  const btn = document.getElementById('chestOpenBtn');
  if (btn) btn.style.display = 'none';
  const res = document.getElementById('chestResult');
  if (res) {
    res.style.display = '';
    res.innerHTML =
      '<div style="font-size:52px;animation:tmNewPop .5s ease;">' +
      (reward.type === 'coins' ? '🪙' : reward.type === 'decor' ? '🎁' : '💧') +
      '</div><div style="font-size:var(--fs-sub);font-weight:800;color: var(--primary-ink);margin-top:var(--sp-6);">' +
      rewardText +
      '</div>';
  }
  renderTreeSection();
}
function buildWheelSVG(rewards) {
  const cx = 120,
    cy = 120,
    r = 118;
  const total = rewards.reduce(function (s, rw) {
    return s + rw.w;
  }, 0);
  let html = '<svg viewBox="0 0 240 240" width="240" height="240">';
  let cum = 0;
  rewards.forEach(function (rw) {
    const span = (rw.w / total) * 360;
    const start = cum;
    const end = cum + span;
    const sRad = ((start - 90) * Math.PI) / 180;
    const eRad = ((end - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(sRad),
      y1 = cy + r * Math.sin(sRad);
    const x2 = cx + r * Math.cos(eRad),
      y2 = cy + r * Math.sin(eRad);
    const large = span > 180 ? 1 : 0;
    html +=
      '<path d="M' +
      cx +
      ',' +
      cy +
      ' L' +
      x1.toFixed(1) +
      ',' +
      y1.toFixed(1) +
      ' A' +
      r +
      ',' +
      r +
      ' 0 ' +
      large +
      ' 1 ' +
      x2.toFixed(1) +
      ',' +
      y2.toFixed(1) +
      ' Z" fill="' +
      rw.color +
      '" stroke="#fff" stroke-width="2"/>';
    cum = end;
  });
  html += '<circle cx="' + cx + '" cy="' + cy + '" r="22" fill="#fff" stroke="#FF6B4A" stroke-width="3"/>';
  html +=
    '<text x="' + cx + '" y="' + cy + '" text-anchor="middle" dominant-baseline="central" font-size="16">🎁</text>';
  html += '</svg>';
  return html;
}
/* 转盘图例：色块对应的奖项（扇形内不放文字，避免又密又卡） */
function renderShopWheelLegend() {
  const el = document.getElementById('shopWheelLegend');
  if (!el) return;
  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-2) var(--sp-12);margin-top:var(--sp-8);text-align:left;">' +
    SHOP_WHEEL_REWARDS.map(function (r) {
      return (
        '<div style="display:flex;align-items:center;gap:var(--sp-4);font-size:var(--fs-tiny);color:var(--text-light);line-height:1.5;"><span style="width:10px;height:10px;border-radius:var(--radius-xs);background:' +
        r.color +
        ';flex-shrink:0;"></span><span>' +
        r.text +
        '</span></div>'
      );
    }).join('') +
    '</div>';
}
function showChest() {
  const overlay = document.getElementById('chestOverlay');
  if (!overlay) return;
  const n = appData.tree.chestCount || 0;
  if (n <= 0) return; /* 没攒到宝箱就不弹：弹了也开不出来 */
  const btn = document.getElementById('chestOpenBtn');
  if (btn) {
    btn.style.display = '';
    btn.textContent = n > 1 ? '点我打开（剩 ' + n + ' 个）' : '点我打开';
  }
  const res = document.getElementById('chestResult');
  if (res) res.style.display = 'none';
  overlay.classList.add('show');
}
/* ===== 商店金币转盘：花 50🪙 转一次，buff 多样 ===== */
let _shopWheelSpinning = false;
function spinShopChest() {
  if (_shopWheelSpinning) {
    showToast('🌀 转盘旋转中，稍候出结果…');
    return;
  }
  const tr = appData.tree;
  const _wCost = getDynamicPrice(50, tr.coins || 0);
  if ((tr.coins || 0) < _wCost) {
    showToast('🪙 果实币不足（需 ' + _wCost + '）');
    return;
  }
  _shopWheelSpinning = true;
  coinSpend(_wCost, 'gacha', '商店转盘抽奖');
  saveData();
  const reward = rollShopWheelReward();
  const total = SHOP_WHEEL_REWARDS.reduce(function (s, r) {
    return s + r.w;
  }, 0);
  let cum = 0;
  for (let i = 0; i < SHOP_WHEEL_REWARDS.length; i++) {
    if (SHOP_WHEEL_REWARDS[i].id === reward.id) break;
    cum += SHOP_WHEEL_REWARDS[i].w;
  }
  const midDeg = ((cum + reward.w / 2) / total) * 360;
  const wheel = document.getElementById('shopWheel');
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  void wheel.offsetWidth;
  wheel.classList.add('spinning');
  wheel.style.transform = 'rotate(' + (5 * 360 + (360 - midDeg)) + 'deg)';
  const btn = document.getElementById('shopWheelBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '🌀 旋转中…';
  }
  renderTreeShop();
  /* renderTreeShop 的 initShopWheel 会重置按钮，旋转锁期间重新加回禁用态 */
  const btn2 = document.getElementById('shopWheelBtn');
  if (btn2) {
    btn2.disabled = true;
    btn2.textContent = '🌀 旋转中…';
  }
  setTimeout(function () {
    applyShopWheelReward(reward);
  }, 3300);
}
function applyShopWheelReward(reward) {
  _shopWheelSpinning = false;
  const tr = appData.tree;
  let text = reward.text;
  let icon = '🎁';
  if (reward.type === 'coins') {
    let val = reward.value;
    if (tr.lotBoost && tr.lotBoost > 1) {
      val = Math.ceil(val * tr.lotBoost);
      text = '🪙 +' + val + '（×' + tr.lotBoost + ' buff）';
      tr.lotBoost = 1;
    } else {
      text = '🪙 +' + val + ' 果实币';
    }
    coinEarn(val, 'gacha', '商店转盘金币');
    icon = '🪙';
  } else if (reward.type === 'decor') {
    const d = randomUnlockedDecor();
    if (d) {
      if (!tr.decorations) tr.decorations = [];
      if (!tr.decorations.includes(d.id)) tr.decorations.push(d.id);
      if (!tr.decorExpires) tr.decorExpires = {};
      const cur = tr.decorExpires[d.id] || 0;
      tr.decorExpires[d.id] = Math.max(Date.now(), cur) + 7 * DAY_MS;
      if (!tr.activeDecorations) tr.activeDecorations = [];
      if (tr.activeDecorations.length < 2 && !tr.activeDecorations.includes(d.id)) tr.activeDecorations.push(d.id);
      text = '🎁 获得装饰：' + d.name + d.icon + '（7天）';
      icon = '🎁';
      showToast('🎁 转盘开出稀有装饰：' + d.icon + ' ' + d.name + '（7天）！');
    } else {
      coinEarn(100, 'gacha', '转盘：装饰已集齐折现');
      text = '🪙 +100（装饰已集齐折现）';
      icon = '🪙';
    }
  } else if (reward.type === 'dew') {
    tr.dewBadges = (tr.dewBadges || 0) + reward.value;
    text = '💧 露珠徽章 +' + reward.value;
    icon = '💧';
  } else if (reward.type === 'boost' && reward.sub === 'lot') {
    tr.lotBoost = 2;
    text = '🎰 下次抽奖金币 ×2！';
    icon = '🎰';
    showToast('🎰 获得 buff：下次抽奖金币 ×2！');
  } else if (reward.type === 'boost' && reward.sub === 'grow') {
    tr.dailyGrowBoost = 1.15;
    text = '🌱 今日成长 +15%！';
    icon = '🌱';
    showToast('🌱 获得 buff：今日树成长 ×1.15！');
  } else if (reward.type === 'gift') {
    const pool = SHOP_WHEEL_REWARDS.filter(function (r) {
      return r.type === 'coins';
    });
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const val = pick.value * 2;
    coinEarn(val, 'gacha', '转盘神秘大奖 ×2');
    text = '✨ 神秘大奖 ×2：🪙 +' + val;
    icon = '✨';
    showToast('✨ 神秘大奖：🪙 +' + val);
  } else if (reward.type === 'retry') {
    coinEarn(50, 'gacha', '转盘「再来一次」退还');
    text = '🔄 再来一次！50🪙已退还';
    icon = '🔄';
    showToast('🔄 再来一次！金币已退还');
  } else if (reward.type === 'none') {
    text = '🍀 谢谢惠顾，下次好运！';
    icon = '🍀';
  }
  saveData();
  renderTreeSection();
  renderTreeShop();
  const res = document.getElementById('shopWheelResult');
  if (res) {
    res.innerHTML =
      '<div style="font-size:40px;animation:tmNewPop .5s ease;">' +
      icon +
      '</div><div style="font-size:var(--fs-title);font-weight:800;color: var(--primary-ink);margin-top:var(--sp-4);">' +
      text +
      '</div>';
  }
  const btn = document.getElementById('shopWheelBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '开始旋转';
  }
}
function closeChest() {
  const o = document.getElementById('chestOverlay');
  if (o) o.classList.remove('show');
}
/* ===== 金币礼物弹窗：统一入口。showGift(原因, 金币数) → 弹礼物 → 点开收下 ===== */
let _giftItems = [];
function showGift(reason, coins) {
  /* ★ 唯一入账点：弹窗出现时金币就已经进账，不用等用户点开。
     此前金币只存在 _giftItems 里、点「点我打开」才入账 ——
     未拆就刷新/被系统回收 → 奖励凭空消失；而签到与成就两条调用路径在进来之前
     已经自行入账过一次，再点开礼包就**双倍发放**。现在两者一并收敛到这里。 */
  const _amt = Number(coins) || 0;
  if (_amt > 0 && appData && appData.tree) {
    coinEarn(_amt, 'gift', reason);
    saveData();
    renderTreeSection();
    renderTreeShop();
  }
  /* 多份奖励同时触发时合并成一封礼物：逐条列出渠道明细 + 合计（避免互相覆盖丢失） */
  _giftItems.push({ reason: reason, coins: coins });
  const n = _giftItems.length;
  const total = _giftItems.reduce(function (s, it) {
    return s + it.coins;
  }, 0);
  const icon = document.getElementById('giftIcon');
  if (icon) icon.textContent = '🎁';
  const title = document.getElementById('giftTitle');
  if (title) title.textContent = '系统奖励';
  const re = document.getElementById('giftReason');
  if (re) {
    if (n > 1) {
      let html = '🎉 收到 <b>' + n + '</b> 份奖励，逐项到账：';
      html +=
        '<div style="font-size:var(--fs-note);line-height:1.8;margin-top:var(--sp-6);text-align:left;background:rgba(0,0,0,.04);border-radius:var(--radius);padding:var(--sp-8) var(--sp-10);">';
      _giftItems.forEach(function (it) {
        html +=
          '<div>· ' + escapeHtml(it.reason) + ' <b style="color: var(--yellow-ink);">+' + it.coins + '🪙</b></div>';
      });
      html +=
        '</div><div style="font-size:var(--fs-body);font-weight:800;margin-top:var(--sp-6);">合计 <span style="color: var(--yellow-ink);font-size:var(--fs-title);">+' +
        total +
        '🪙</span></div>';
      re.innerHTML = html;
    } else {
      re.innerHTML = escapeHtml(reason) + ' <b style="color: var(--yellow-ink);">+' + coins + '🪙</b>';
    }
  }
  const btn = document.getElementById('giftOpenBtn');
  if (btn) btn.style.display = '';
  const res = document.getElementById('giftResult');
  if (res) {
    res.style.display = 'none';
    res.innerHTML = '';
  }
  const ov = document.getElementById('giftOverlay');
  if (ov) {
    fxVibrate(30); /* E4-05 收到礼物/奖励弹层的触感 */
    ov.classList.add('show');
  }
}
function openGift() {
  const total = _giftItems.reduce(function (s, it) {
    return s + it.coins;
  }, 0);
  const n = _giftItems.length;
  const items = _giftItems;
  _giftItems = [];
  /* 金币在 showGift() 里就已经入账，这里**不再累加**（否则等于发两遍） */
  fxVibrate(40); /* E4-05 拆礼的确认触感 */
  const btn = document.getElementById('giftOpenBtn');
  if (btn) btn.style.display = 'none';
  const res = document.getElementById('giftResult');
  if (res) {
    let html =
      '<div style="font-size:44px;animation:badgePop .5s ease;">🪙</div><div style="font-size:30px;font-weight:900;color: var(--yellow-ink);margin:var(--sp-2) 0;">+' +
      total +
      '</div>';
    if (n > 1) {
      html +=
        '<div style="font-size:var(--fs-note);line-height:1.8;text-align:left;background:rgba(0,0,0,.04);border-radius:var(--radius);padding:var(--sp-8) var(--sp-10);margin:4px auto;max-width:240px;">';
      items.forEach(function (it) {
        /* reason 可含用户自定义奖励名，与 showGift 多奖励分支同标准转义（v2 扫描命中） */
        html += '<div>· ' + escapeHtml(it.reason) + ' <b style="color: var(--yellow-ink);">+' + it.coins + '🪙</b></div>';
      });
      html += '</div><div style="font-size:var(--fs-body);color:var(--text-light);">共 ' + n + ' 份奖励，全部入账</div>';
    } else {
      html += '<div style="font-size:var(--fs-body);color:var(--text-light);">金币已放入口袋</div>';
    }
    res.innerHTML = html;
    res.style.display = 'block';
  }
}
function closeGift() {
  const o = document.getElementById('giftOverlay');
  if (o) o.classList.remove('show');
}
let _gachaState = null;
function triggerGacha() {
  const modal = document.getElementById('gachaModal');
  if (!modal) return;
  showModal('gachaModal');
  _gachaState = { reward: gachaReward(), revealed: false };
  const egg = document.getElementById('gachaEgg');
  const res = document.getElementById('gachaResult');
  const btn = document.getElementById('gachaBtn');
  const last = document.getElementById('gachaLast');
  if (egg) egg.className = 'gacha-egg shaking';
  if (res) res.innerHTML = '<div class="gacha-tip">🎲 扭蛋转起来了… 点下面的按钮敲开它！</div>';
  if (btn) {
    btn.textContent = '🔨 敲开扭蛋';
    btn.classList.remove('gacha-btn-done');
  }
  if (last) last.innerHTML = gachaLastHtml();
  setTimeout(function () {
    revealGacha();
  }, 1400);
}
function gachaLastHtml() {
  const lg = appData.gachaLog || [];
  if (!lg.length) return '';
  const it = lg[lg.length - 1];
  return '<div class="gacha-last">上一次：' + it.txt + ' <span class="gacha-last-time">' + it.time + '</span></div>';
}
/* 揭晓：发放奖励 + 大字展示 + 顶部 toast 兜底（万一用户已关窗也能知道） */
function revealGacha() {
  if (!_gachaState || _gachaState.revealed) return;
  _gachaState.revealed = true;
  const reward = _gachaState.reward;
  const egg = document.getElementById('gachaEgg');
  const res = document.getElementById('gachaResult');
  const btn = document.getElementById('gachaBtn');
  if (egg) {
    egg.className = 'gacha-egg';
    egg.textContent = '🎁';
  }
  let txt = '',
    sub = '';
  if (reward.type === 'coins') {
    coinEarn(reward.value, 'gacha', '扭蛋开出金币');
    txt = '🪙 金币 +' + reward.value;
    sub = '已存进你的钱包，去商店看看？';
    saveData();
    renderTreeSection();
    renderTreeShop();
  } else if (reward.type === 'week') {
    appData.rankSystem.extraWeekTomatoes = (appData.rankSystem.extraWeekTomatoes || 0) + reward.value;
    txt = '🍅 本周可消耗番茄 +' + reward.value;
    sub = '已加到本周额度，可下注也可去商店兑换';
    saveData();
    renderRankSystem();
    renderRerollUI();
  } else {
    addRankStars(reward.value, 'gacha');
    txt = '⭐ 段位星 +' + reward.value;
    sub = '已计入段位进度，继续冲！';
    saveData();
    renderRankSystem();
  }
  /* 写进历史，随时可回看 */
  if (!Array.isArray(appData.gachaLog)) appData.gachaLog = [];
  appData.gachaLog.push({ txt: txt, time: new Date().toTimeString().slice(0, 5) });
  if (appData.gachaLog.length > 10) appData.gachaLog = appData.gachaLog.slice(-10);
  saveData();
  if (res)
    res.innerHTML =
      '<div class="gacha-reward">' +
      txt +
      '</div><div class="gacha-sub">' +
      sub +
      '</div><div class="gacha-tip">每天第 4 / 8 个番茄自动触发</div>';
  const last = document.getElementById('gachaLast');
  if (last) last.innerHTML = gachaLastHtml();
  if (btn) {
    btn.textContent = '开心收下 🎉';
    btn.classList.add('gacha-btn-done');
  }
  showToast('🎁 扭蛋开出：' + txt);
}
/* 未揭晓就点按钮 = 立刻开奖（不关窗），揭晓后才真正关闭 */
function closeGachaModal() {
  if (_gachaState && !_gachaState.revealed) {
    revealGacha();
    return;
  }
  const egg = document.getElementById('gachaEgg');
  if (egg) {
    egg.className = 'gacha-egg';
    egg.textContent = '🥚';
  }
  closeModal('gachaModal');
}
function openCoinExchange() {
  getWeekCoinExchanged();
  const avail = Math.floor(getExchangeAvail());
  const used = getWeekCoinExchanged();
  const canTrade = Math.min(avail, Math.floor(Math.max(0, COIN_EX_WEEK_MAX - used) / COIN_EX_RATE));
  const a = document.getElementById('exAvail');
  if (a) a.textContent = canTrade;
  const u = document.getElementById('exUsed');
  if (u) u.textContent = used;
  /* 同步弹窗文案到实际汇率/上限，避免硬编码与代码不一致 */
  const er = document.getElementById('exRate');
  if (er) er.textContent = '1 🍅 = ' + COIN_EX_RATE + ' 🪙';
  const em1 = document.getElementById('exMax');
  if (em1) em1.textContent = COIN_EX_WEEK_MAX;
  const em2 = document.getElementById('exMax2');
  if (em2) em2.textContent = COIN_EX_WEEK_MAX;
  const eb5 = document.getElementById('exBtn5');
  if (eb5) eb5.textContent = '5🍅=' + 5 * COIN_EX_RATE + '🪙';
  const eb10 = document.getElementById('exBtn10');
  if (eb10) eb10.textContent = '10🍅=' + 10 * COIN_EX_RATE + '🪙';
  /* 熄灭警告前置：按「全部可兑」预估，让用户在点按钮前就看到代价 */
  const warnEl = document.getElementById('exBadgeWarn');
  if (warnEl) {
    const risk = badgesAtRiskBySpend(canTrade);
    if (risk.length) {
      warnEl.style.display = 'block';
      warnEl.innerHTML =
        '⚠️ 兑换 ' +
        canTrade +
        ' 个🍅 后，本周刚点亮的 <b>' +
        risk
          .map(function (b) {
            return b.icon + b.name;
          })
          .join('、') +
        '</b> 会熄灭<br><span style="color:var(--text-light);font-size:var(--fs-caption);">（上周延续的标不受影响 · 再完成几个🍅 就能重新点亮）</span>';
    } else {
      warnEl.style.display = 'none';
      warnEl.innerHTML = '';
    }
  }
  showModal('coinExchangeModal');
}
/* ===== renderTreeShop 商店区块拆分 =====
 * 纯平移：商店 8 个商品区块按 DOM 容器拆为独立顶层函数（紧贴本函数上方），共享小工具
 * _rarity/_rarityLabel/_priceTag 由嵌套提升为顶层；各 helper 只读 appData.tree（入参 tr）、零交叉依赖。
  */
function _rarity(p) {
    if (!p || p <= 0) return 'rarity-common';
    if (p < 150) return 'rarity-common';
    if (p < 250) return 'rarity-affordable';
    if (p < 400) return 'rarity-popular';
    if (p < 700) return 'rarity-premium';
    return 'rarity-legend';
  }


function _rarityLabel(r) {
    return (
      { common: '🌱 普通', affordable: '✨ 平价', popular: '🔥 热门', premium: '💎 高级', legend: '🏆 传说' }[
        r.replace('rarity-', '')
      ] || ''
    );
  }


function _priceTag(label, currency) {
    return '<span class="price-tag ' + (currency === 'coin' ? 'coin' : 'week') + '">' + label + '</span>';
  }


function renderTreeShopDeco(tr) {
  /* () 已拆自 renderTreeShop：装饰列表 区块原样搬移 */
  const decoEl = document.getElementById('shopDecoList');
  if (decoEl) {
    decoEl.innerHTML = TREE_DECORATIONS.map(function (d) {
      const exp = (tr.decorExpires || {})[d.id];
      const active = (tr.activeDecorations || []).includes(d.id);
      /* 过期 = 未拥有：卡片恢复原样（此前只判"买没买过"，过期后永远停在"已到期"） */
      const owned = (tr.decorations || []).includes(d.id) && !(exp && exp <= Date.now());
      const status = owned ? '✓ ' + treeRemainDays(exp) : '未拥有';
      const btn = owned
        ? '<span class="shop-btns"><button class="shop-btn small ' +
          (active ? 'used' : '') +
          '" onclick="toggleTreeDecor(\'' +
          d.id +
          '\')">' +
          (active ? '挂载中' : '挂载') +
          '</button><button class="shop-btn small renew" onclick="buyTreeItem(\'decor\',\'' +
          d.id +
          '\',7)">续7天 ' + treePrice7(d, tr.coins || 0) + '🪙</button><button class="shop-btn small renew" onclick="buyTreeItem(\'decor\',\'' +
          d.id +
          '\',30)">续30天 ' + treePrice30(d, tr.coins || 0) + '🪙</button></span>'
        : '<span class="shop-btns"><button class="shop-btn small" onclick="buyTreeItem(\'decor\',\'' +
          d.id +
          '\',7)">7天 ' +
          treePrice7(d, tr.coins || 0) +
          '🪙</button><button class="shop-btn small" onclick="buyTreeItem(\'decor\',\'' +
          d.id +
          '\',30)">30天 ' +
          treePrice30(d, tr.coins || 0) +
          '🪙</button></span>';
      return (
        '<div class="shop-item ' +
        _rarity(d.rent7 || d.price) +
        (owned ? ' is-owned' : '') +
        '"><div class="shop-icon">' +
        d.icon +
        '</div><div class="shop-info"><div class="shop-name">' +
        d.name +
        '<span class="rarity-tag">' +
        _rarityLabel(_rarity(d.rent7 || d.price)) +
        '</span>' +
        (owned ? '<span class="owned-tag">✓ 已拥有</span>' : '') +
        '</div><div class="shop-desc">' +
        status +
        '</div></div>' +
        btn +
        '</div>'
      );
    }).join('');
  }
}

function renderTreeShopScene(tr) {
  /* () 已拆自 renderTreeShop：场景列表 区块原样搬移 */
  const scEl = document.getElementById('shopSceneList');
  if (scEl) {
    scEl.innerHTML = TREE_SCENES.map(function (s) {
      const exp = (tr.sceneExpires || {})[s.id];
      const active = tr.activeScene === s.id;
      /* 过期 = 未拥有：卡片恢复原样 */
      const owned = (tr.scenes || []).includes(s.id) && !(exp && exp <= Date.now());
      const status = owned ? '✓ ' + treeRemainDays(exp) : '未拥有';
      const tierTag = s.tier ? '<span class="tier-tag tier-' + s.tier + '">' + s.tier + '</span>' : '';
      let btn;
      if (s.id === 'garden') {
        /* 花园：默认场景，永久免费，无需购买/续费 */
        btn =
          '<span class="shop-btns"><button class="shop-btn small ' +
          (active ? 'used' : '') +
          '" onclick="useTreeScene(\'garden\')">' +
          (active ? '使用中' : '使用') +
          '</button></span>';
      } else if (owned) {
        btn =
          '<span class="shop-btns"><button class="shop-btn small ' +
          (active ? 'used' : '') +
          '" onclick="useTreeScene(\'' +
          s.id +
          '\')">' +
          (active ? '使用中' : '使用') +
          '</button><button class="shop-btn small renew" onclick="buyTreeItem(\'scene\',\'' +
          s.id +
          '\',7)">续7天 ' + treePrice7(s, tr.coins || 0) + '🪙</button><button class="shop-btn small renew" onclick="buyTreeItem(\'scene\',\'' +
          s.id +
          '\',30)">续30天 ' + treePrice30(s, tr.coins || 0) + '🪙</button></span>';
      } else {
        btn =
          '<span class="shop-btns"><button class="shop-btn small" onclick="buyTreeItem(\'scene\',\'' +
          s.id +
          '\',7)">7天 ' +
          treePrice7(s, tr.coins || 0) +
          '🪙</button><button class="shop-btn small" onclick="buyTreeItem(\'scene\',\'' +
          s.id +
          '\',30)">30天 ' +
          treePrice30(s, tr.coins || 0) +
          '🪙</button></span>';
      }
      return (
        '<div class="shop-item ' +
        _rarity(s.rent7 || s.price) +
        (s.id === 'garden' || owned ? ' is-owned' : '') +
        '"><div class="shop-icon">' +
        s.icon +
        '</div><div class="shop-info"><div class="shop-name">' +
        s.name +
        ' ' +
        tierTag +
        '<span class="rarity-tag">' +
        _rarityLabel(_rarity(s.rent7 || s.price)) +
        '</span>' +
        (s.id === 'garden'
          ? '<span class="owned-tag">✓ 默认</span>'
          : owned
            ? '<span class="owned-tag">✓ 已拥有</span>'
            : '') +
        '</div><div class="shop-desc">' +
        status +
        '</div></div>' +
        btn +
        '</div>'
      );
    }).join('');
  }
}

function renderTreeShopBalance(tr) {
  /* () 已拆自 renderTreeShop：金币余额 区块原样搬移 */
  const bal = document.getElementById('shopBalance');
  if (bal) bal.textContent = '🪙 ' + (tr.coins || 0);
  const wbal = document.getElementById('shopWeekBalance');
  if (wbal) {
    let wt = getWeekTomatoPoints();
    let spent = countWeekAllSpent(); /* 下注 + 兑换，与段位/统计同口径 */
    wbal.textContent = '🍅 本周完成 ' + wt + ' 个（已消耗 ' + spent + ' · 可消耗 ' + getSpendableTomatoes() + '）';
  }
}

function renderTreeShopItem(tr) {
  /* () 已拆自 renderTreeShop：道具商店+库存 区块原样搬移 */
  const itemEl = document.getElementById('shopItemList');
  if (itemEl) {
    let wt2 = getWeekTomatoPoints();
    let spent2 = countWeekAllSpent(); /* 与顶栏/统计/段位同口径：段位下注 + 商店兑换 + 道具卡 */
    let avail = getSpendableTomatoes(); /* = 本周完成 − 合计已消耗 + 扭蛋额外🍅 */
    let inv = tr.inventory || {};
    let ids = ['waterProtect', 'streakProtect', 'waterRecover', 'streakRecover', 'renameCard', 'reviveStone'];
    /* 商品列表 */
    let shopHtml =
      '<div style="font-size:var(--fs-body);font-weight:700;color:var(--text);margin-bottom:var(--sp-6);">🛒 购买道具（存入库存，使用才生效）</div>';
    shopHtml += ids
      .map(function (id) {
        let def = ITEM_DEFS[id];
        let _dp = def.currency === 'coin' ? getDynamicPrice(def.price, tr.coins || 0) : def.price;
        let canBuy = def.currency === 'coin' ? (tr.coins || 0) >= _dp : avail >= _dp;
        let priceLabel = def.currency === 'coin' ? _dp + '🪙' : _dp + '🍅周';
        let _rari = _rarity(def.currency === 'coin' ? def.price : def.price * 20);
        return (
          '<div class="shop-item ' +
          _rari +
          '"><div class="shop-icon">' +
          def.icon +
          '</div><div class="shop-info"><div class="item-name-row"><div class="shop-name">' +
          def.name +
          '</div><span class="rarity-tag">' +
          _rarityLabel(_rari) +
          '</span><span class="item-type-tag t-' +
          def.type +
          '">' +
          (def.type === 'protect'
            ? '护盾'
            : def.type === 'recover'
              ? '恢复'
              : def.type === 'rename'
                ? '工具'
                : '道具') +
          '</span></div><div class="shop-desc" style="font-size:var(--fs-note);">' +
          def.desc +
          '</div></div><span class="shop-btns"><button class="shop-btn small ' +
          (canBuy ? '' : 'disabled') +
          '" onclick="buyItem(\'' +
          id +
          '\')" ' +
          (canBuy ? '' : 'disabled') +
          '>' +
          _priceTag(priceLabel, def.currency) +
          '</button></span></div>'
        );
      })
      .join('');
    /* 我的库存 */
    let hasInv = ids.some(function (id) {
      return (inv[id] || 0) > 0;
    });
    let activeWP = tr.activeWaterProtect,
      activeSP = tr.activeStreakProtect;
    if (hasInv || activeWP || activeSP) {
      shopHtml += '<div style="font-size:var(--fs-body);font-weight:700;color:var(--text);margin:var(--sp-12) 0 var(--sp-6);">🎒 我的库存</div>';
      ids.forEach(function (id) {
        let def = ITEM_DEFS[id];
        let cnt = inv[id] || 0;
        let activeKey =
          id === 'waterProtect' ? 'activeWaterProtect' : id === 'streakProtect' ? 'activeStreakProtect' : null;
        let activeDs = activeKey ? tr[activeKey] : null;
        if (cnt > 0 || activeDs) {
          let btnHtml = '';
          if (def.type === 'protect' && activeDs) {
            btnHtml =
              '<span style="color: var(--green-ink);font-size:var(--fs-note);font-weight:700;">🛡️ 保护中(' +
              activeDs +
              ')</span> <button class="shop-btn small" onclick="cancelProtection(\'' +
              id +
              '\')">取消</button>';
          } else if (cnt > 0) {
            btnHtml = '<button class="shop-btn small" onclick="useItem(\'' + id + '\')">使用(' + cnt + ')</button>';
          }
          shopHtml +=
            '<div class="shop-item"><div class="shop-icon">' +
            def.icon +
            '</div><div class="shop-info"><div class="shop-name">' +
            def.name +
            (cnt > 0 ? ' ×' + cnt : '') +
            '</div><div class="shop-desc" style="font-size:var(--fs-note);">' +
            def.desc +
            '</div></div><span class="shop-btns">' +
            btnHtml +
            '</span></div>';
        }
      });
    } else {
      shopHtml +=
        '<div style="text-align:center;color:var(--text-light);font-size:var(--fs-body);margin:var(--sp-12) 0;">库存为空，购买后会显示在这里</div>';
    }
    itemEl.innerHTML = shopHtml;
  }
}

function renderTreeShopAura(tr) {
  /* () 已拆自 renderTreeShop：光环特效 区块原样搬移 */
  /* —— 光环特效（单选挂载，可轮换） —— */
  const auraEl = document.getElementById('shopAuraList');
  if (auraEl) {
    auraEl.innerHTML = TREE_AURAS.map(function (a) {
      const exp = (tr.auraExpires || {})[a.id];
      const active = tr.activeAura === a.id && exp && exp > Date.now();
      /* 过期 = 未拥有：卡片恢复原样 */
      const owned = (tr.auras || []).includes(a.id) && !(exp && exp <= Date.now());
      const status = owned ? '✓ ' + treeRemainDays(exp) : '未拥有';
      const btn = owned
        ? '<span class="shop-btns"><button class="shop-btn small ' +
          (active ? 'used' : '') +
          '" onclick="useTreeAura(\'' +
          a.id +
          '\')">' +
          (active ? '使用中' : '使用') +
          '</button><button class="shop-btn small renew" onclick="buyTreeRent(\'aura\',\'' +
          a.id +
          '\',7)">续7天 ' + treePrice7(a, tr.coins || 0) + '🪙</button><button class="shop-btn small renew" onclick="buyTreeRent(\'aura\',\'' +
          a.id +
          '\',30)">续30天 ' + treePrice30(a, tr.coins || 0) + '🪙</button></span>'
        : '<span class="shop-btns"><button class="shop-btn small" onclick="buyTreeRent(\'aura\',\'' +
          a.id +
          '\',7)">7天 ' +
          treePrice7(a, tr.coins || 0) +
          '🪙</button><button class="shop-btn small" onclick="buyTreeRent(\'aura\',\'' +
          a.id +
          '\',30)">30天 ' +
          treePrice30(a, tr.coins || 0) +
          '🪙</button></span>';
      return (
        '<div class="shop-item ' +
        _rarity(a.rent7) +
        (owned ? ' is-owned' : '') +
        '"><div class="shop-icon">' +
        a.icon +
        '</div><div class="shop-info"><div class="shop-name">' +
        a.name +
        '<span class="rarity-tag">' +
        _rarityLabel(_rarity(a.rent7)) +
        '</span>' +
        (owned ? '<span class="owned-tag">✓ 已拥有</span>' : '') +
        '</div><div class="shop-desc">' +
        status +
        ' · ' +
        a.desc +
        '</div></div>' +
        btn +
        '</div>'
      );
    }).join('');
  }
}

