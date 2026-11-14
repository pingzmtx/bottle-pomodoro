/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01e7_ui_stats.js 按域拆出（2026-11-14 · S3，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；JS 包只在新增文件边界多 1 个空语句（tools/group_split.py 的拼接符 "\n;\n"，长度不变）。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01eT_ui_stats_month.js
 * 分组：ui
 * 职责：年度视图的年份锚点（2026-11-07）；专注传记（新增）：里程碑自动生成成长日记；checkBiographyEvents 拆分 helper
 * 功能：
 *   - 年度视图的年份锚点（2026-11-07）
 *   - 专注传记（新增）：里程碑自动生成成长日记
 *   - checkBiographyEvents 拆分 helper
 * 函数索引（TOC）：renderMonthlyStat/yrYearNum/yrMapYearNum/yrMapAnchorDate/yrMapShift/statYearsList/statYearPomoMap/openYearPicker/renderYearPickGrid/pickStatYear/renderYearlyStat/renderYearMonthTable（+10 更多）
 * ============================================================ */

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
