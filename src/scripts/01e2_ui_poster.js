/* ============================================================
 * 01e2 · 分享打卡海报（Canvas）
 * 函数索引（TOC）：openSharePoster/closeSharePoster/setPosterType/renderTreePosterPicker/pickPosterTree/savePoster/_pFont/_pEmoji/_pBig/_pScore/_pC/_pL（+16 更多）
 * ============================================================ */
/* ===== 分享打卡海报（Canvas 绘制，无外部依赖） ===== */
const POSTER_QUOTES = [
  '每一分钟的专注，都算数',
  '别小看每一天的积累',
  '专注的人，时间看得见',
  '今天也在认真生活',
  '坚持，是最酷的事',
  '番茄会记住你的努力',
  '努力不必张扬，数据会说话'
];
const POSTER_THEMES = {
  all: { accent: '#FF6B5E', glow: 'rgba(255,107,94,0.26)', title: '我的番茄战绩' },
  seg: { accent: '#5C6BC0', glow: 'rgba(92,107,192,0.26)', title: '我的专注段数' },
  rank: { accent: '#FFD54F', glow: 'rgba(255,213,79,0.26)', title: '我的上星段位' },
  streak: { accent: '#FF8A3D', glow: 'rgba(255,138,61,0.26)', title: '连续打卡日记' },
  today: { accent: '#66BB6A', glow: 'rgba(102,187,106,0.26)', title: '今日专注战报' },
  tree: { accent: '#81C784', glow: 'rgba(129,199,132,0.26)', title: '我的番茄树' },
  bio: { accent: '#4FC3F7', glow: 'rgba(79,195,247,0.26)', title: '我的专注生物钟' },
  sprint: { accent: '#FF7043', glow: 'rgba(255,112,67,0.26)', title: '我的冲段冲刺' },
  plan: { accent: '#7E57C2', glow: 'rgba(126,87,194,0.26)', title: '我的计划执行力' },
  wellness: { accent: '#26A69A', glow: 'rgba(38,166,154,0.26)', title: '我的身心状态' }
};
/* 懒加载：打开弹窗只显示占位，点击模板才生成；关闭即清空，不留任何加载 */
let _posterType = null;
function openSharePoster() {
  /* 防御性兜底：生成前先清理一次污染值，避免海报读到 999999 之类损坏数据显示成几十个 9 */
  sanitizeTreeData();
  showModal('sharePosterModal');
  _posterType = null;
  document.querySelectorAll('.sp-tab').forEach(function (b) {
    b.classList.remove('active');
  });
  const c = document.getElementById('posterCanvas');
  if (c) {
    c.style.display = 'block';
    const ctx = c.getContext('2d');
    const W = c.width,
      H = c.height;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#131930');
    g.addColorStop(1, '#232E52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.font = '700 46px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎨 点击上方模板', W / 2, H / 2 - 30);
    ctx.fillText('开始生成你的专属海报', W / 2, H / 2 + 40);
  }
  const img = document.getElementById('posterImg');
  if (img) {
    img.style.display = 'none';
    img.removeAttribute('src');
  }
}
function closeSharePoster() {
  closeModal('sharePosterModal');
  const c = document.getElementById('posterCanvas');
  if (c) {
    c.style.display = 'block';
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  }
  const img = document.getElementById('posterImg');
  if (img) {
    img.style.display = 'none';
    img.removeAttribute('src');
  }
}
function setPosterType(t) {
  _posterType = t;
  document.querySelectorAll('.sp-tab').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-t') === t);
  });
  const picker = document.getElementById('treePosterPicker');
  if (t === 'tree') {
    /* 种树海报：先显示「选树」面板（避免默认猜一棵），用户点选后才绘制 */
    renderTreePosterPicker();
  } else {
    if (picker) picker.style.display = 'none';
    drawPoster();
  }
}
/* 种树海报：树种选择（用户解锁多棵树时，生成前必须先选一棵） */
let _posterTreeId = null;
function renderTreePosterPicker() {
  const picker = document.getElementById('treePosterPicker');
  /* 候选树 = 已解锁 ∪ 已种下 ∪ 当前在种，去重后只保留有效树种（旧逻辑只看 unlockedSpecies，于是「种过但没解锁/没在种」的树在海报里根本选不到）。 */
  const tr = appData.tree || {};
  const cand = [];
  const _pushTree = function (id) {
    if (id && TREE_SPECIES[id] && cand.indexOf(id) < 0) cand.push(id);
  };
  (tr.unlockedSpecies || ['tomato']).forEach(_pushTree);
  (tr.plantedSpecies || []).forEach(_pushTree);
  _pushTree(tr.species || 'tomato');
  if (!_posterTreeId || cand.indexOf(_posterTreeId) < 0) _posterTreeId = tr.species || cand[0] || 'tomato';
  /* 防御：没有选择器容器也要出图，不能停在占位画面 */
  if (!picker) {
    drawPoster();
    return;
  }
  const spNow = TREE_SPECIES[_posterTreeId] || { name: '番茄树', icon: '🍅' };
  if (cand.length <= 1) {
    picker.innerHTML =
      '<div style="font-size:var(--fs-note);color:var(--text-light);">🌳 当前只有 1 棵树（' +
      spNow.icon +
      ' ' +
      spNow.name +
      '）可以分享，再种/再解锁其他树种后就能在这里挑</div>';
    picker.style.display = 'block';
    drawPoster();
    return;
  }
  const rows = cand
    .map(function (id) {
      const sp = TREE_SPECIES[id] || { icon: '🌱', name: '未知树' };
      const pts = (appData.tree.speciesPoints && appData.tree.speciesPoints[id]) || 0;
      const st = getTreeStageFor(pts, id);
      const active = id === _posterTreeId;
      const isNow = tr.species === id;
      return (
        '<button onclick="pickPosterTree(\'' +
        id +
        '\')" style="flex:1;min-width:30%;padding:var(--sp-6) var(--sp-8);border-radius:var(--radius-input);border:2px solid ' +
        (active ? 'var(--primary)' : 'var(--border)') +
        ';background:' +
        (active ? 'var(--primary)' : 'var(--card)') +
        ';color:' +
        (active ? '#fff' : 'var(--text)') +
        ';font-size:var(--fs-body);font-weight:700;cursor:pointer;line-height:1.35;">' +
        sp.icon +
        ' ' +
        sp.name +
        (isNow ? ' <span style="font-size:var(--fs-micro);">·在种</span>' : '') +
        '<br><span style="font-size:var(--fs-tiny);font-weight:600;opacity:0.75;">' +
        st.emoji +
        ' ' +
        st.name +
        '</span></button>'
      );
    })
    .join('');
  picker.innerHTML =
    '<div style="font-size:var(--fs-note);color:var(--text-light);margin-bottom:var(--sp-6);">🌳 你有 ' +
    cand.length +
    ' 棵树，选择要生成海报的一棵：</div>' +
    '<div style="display:flex;gap:var(--sp-6);flex-wrap:wrap;">' +
    rows +
    '</div>';
  picker.style.display = 'block';
  drawPoster();
}
function pickPosterTree(id) {
  _posterTreeId = id;
  renderTreePosterPicker();
}
function savePoster() {
  const c = document.getElementById('posterCanvas');
  if (!c) return;
/* JPEG 高压缩：海报无透明需求，1080×1440 PNG 的 dataURL 约 2-3MB，Via 长按查看/下载会卡死，JPEG 0.92 约 300KB 且观感无损 */
  const url = c.toDataURL('image/jpeg', 0.92);
  const a = document.createElement('a');
  a.href = url;
  a.download = '瓶子番茄-打卡海报-' + new Date().toISOString().slice(0, 10) + '.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('📤 海报已生成，去分享吧！');
}
function _pFont(weight, size) {
  return (weight || 700) + ' ' + size + 'px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
}
function _pEmoji(ctx, emoji, x, y, size, align) {
  ctx.font =
    size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Twemoji Mozilla",sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y);
}
/* 海报大数字缩写：≥10000 → x.x万，≥1000 → x千，避免几千上万的数字撑爆卡片 */
function _pBig(n) {
  n = Math.round(n || 0);
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + '千';
  return String(n);
}
/* 评分 → 等级词（海报用）：10 分制，外人一看就懂，不用猜分数代表什么 */
function _pScore(v) {
  if (v == null || isNaN(v)) return '—';
  if (v >= 9) return '很好';
  if (v >= 7) return '较好';
  if (v >= 5) return '一般';
  if (v >= 3) return '较差';
  return '很差';
}
function _pC(ctx, text, x, y, size, weight, color) {
  ctx.font = _pFont(weight, size);
  ctx.fillStyle = color || '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
function _pL(ctx, text, x, y, size, weight, color) {
  ctx.font = _pFont(weight, size);
  ctx.fillStyle = color || '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
function _pR(ctx, text, x, y, size, weight, color) {
  ctx.font = _pFont(weight, size);
  ctx.fillStyle = color || '#FFFFFF';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
function _pRR(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function _pCell(ctx, x, y, w, h, icon, label, value, accent) {
  _pRR(ctx, x, y, w, h, 26);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  _pEmoji(ctx, icon, x + 44, y + h * 0.34, 48, 'center');
  _pL(ctx, label, x + 98, y + h * 0.76, 32, 600, 'rgba(255,255,255,0.55)');
  _pR(ctx, String(value), x + w - 30, y + h * 0.5, 62, 800, accent);
}
function _pBigCard(ctx, x, y, w, h, icon, value, label, accent) {
  _pRR(ctx, x, y, w, h, 32);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  _pEmoji(ctx, icon, x + w / 2, y + h * 0.24, 72, 'center');
  _pC(ctx, String(value), x + w / 2, y + h * 0.54, 100, 900, accent);
  _pC(ctx, label, x + w / 2, y + h * 0.84, 36, 600, 'rgba(255,255,255,0.6)');
}
/* ===== drawPoster 海报绘制拆分 =====
 * 纯平移：海报 10 个版式分支（all/seg/rank/streak/today/tree/bio/sprint/plan/wellness）
 * 拆为独立顶层函数（紧贴本函数上方）；公共量 C/_q 主函数算好传参；tb 归 today、总分钟换算归 all。
  */
function drawPosterAll(ctx, W, H, th, C, _q) {
/* 累计专注时长用"完成🍅数换算"——与实际完成的番茄数严格挂钩：
   删补录数据后 C.totalFull/C.totalHalf 自动跟随，避免 effectiveSeconds 虚高/残留
   导致海报显示"999 小时"这种值。
   完整🍅 ×25 分 + 半个🍅 ×12.5 分 + 未完成按 effectiveSeconds 上限 25 分（防补录幽灵） */
  const _incMin = (appData.records || []).reduce(function (s, r) {
    if (r.type === 'incomplete') return s + Math.min(25, Math.round((r.effectiveSeconds || 0) / 60));
    return s;
  }, 0);
  const totalMin = Math.round((C.totalFull || 0) * 25 + (C.totalHalf || 0) * 12.5 + _incMin);
  const hrs = Math.floor(totalMin / 60);
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '累计专注 · 时间看得见', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    _pBigCard(ctx, 60, 352, 320, 372, '🍅', _pBig(C.totalFull || 0), '累计完整番茄', th.accent);
    _pBigCard(ctx, 380, 352, 320, 372, '⏱️', hrs ? hrs + 'h' : totalMin + '分', '累计专注时长', th.accent);
    _pBigCard(ctx, 700, 352, 320, 372, '🔥', _pBig(C.streak || 0), '连续打卡天数', th.accent);
    const fr = C.focusRank || { seg: 1, tier: '萌芽', icon: '🌱', color: '#587F47' };
    _pRR(ctx, 60, 758, 960, 122, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = fr.color;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    _pEmoji(ctx, fr.icon, 60 + 54, 819, 40, 'center');
    _pL(ctx, '专注段数 · ' + fr.seg + ' 段 ' + fr.tier, 60 + 112, 819, 48, 800, fr.color);
    _pR(ctx, '积分 ' + _pBig(fr.points || 0), W - 60 - 38, 819, 38, 700, 'rgba(255,255,255,0.55)');
    const rd = C.rankData || { stars: 0, todayGained: 0 };
    const cells = [
      ['⭐', '上星累计', _pBig(rd.stars || 0), th.accent],
      ['📅', '活跃天数', _pBig(C.activeDays || 0), th.accent],
      ['🏆', '单日最高', _pBig(C.maxDayFull || 0), th.accent],
      ['💯', '专注效率', (C.efficiency !== undefined ? C.efficiency : 0) + '%', th.accent],
      ['📈', '本周番茄', _pBig((C.weekNow && C.weekNow.full) || 0), '#FFFFFF'],
      ['🎯', '完美周', _pBig(C.perfectWeekCount || 0), '#FFFFFF']
    ];
    cells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 912 + row * 126, 500, 116, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPosterSeg(ctx, W, H, th, C, _q) {
    const fr = C.focusRank || {
      seg: 1,
      tier: '萌芽',
      icon: '🌱',
      color: '#587F47',
      points: 0,
      remain: 0,
      needNext: 40,
      raw: { focusMin: 0, full: 0, half: 0, inc: 0 }
    };
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '努力积分 · 越努力升段越快', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    ctx.beginPath();
    ctx.arc(W / 2, 452, 168, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = fr.color;
    ctx.lineWidth = 7;
    ctx.stroke();
    _pEmoji(ctx, fr.icon, W / 2, 454, 128, 'center');
    _pC(ctx, String(fr.seg), W / 2, 662, 150, 900, fr.color);
    _pC(ctx, '段', W / 2, 782, 42, 700, 'rgba(255,255,255,0.75)');
    _pC(ctx, fr.tier, W / 2, 848, 46, 800, '#FFFFFF');
    _pC(ctx, '累计 ' + _pBig(fr.points || 0) + ' 积分', W / 2, 908, 40, 700, 'rgba(255,255,255,0.8)');
    const segNext = Math.max(0, (fr.needNext || 0) - (fr.remain || 0));
    const cells = [
      ['⏱️', '专注分钟', _pBig(fr.raw.focusMin || 0), th.accent],
      ['🍅', '完整番茄', _pBig(fr.raw.full || 0), '#FFFFFF'],
      ['🥈', '半个+未完成', _pBig((fr.raw.half || 0) + (fr.raw.inc || 0)), '#FFFFFF'],
      ['⚡', '段数积分', _pBig(fr.points || 0), th.accent],
      ['🚀', '距下一段', segNext + ' 分', th.accent],
      ['🏅', '段数称号', fr.tier || '萌芽', th.accent]
    ];
    cells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 960 + row * 126, 500, 116, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPosterRank(ctx, W, H, th, C, _q) {
    const rs = appData.rankSystem || {
      stars: 0,
      seasonNumber: 0,
      consecutiveOver: 0,
      consecutiveUnder: 0,
      history: { maxStarsCareer: 0, maxRankNameCareer: null }
    };
    const tier = getRankFromStars(rs.stars || 0);
    const stN = rs.stars || 0;
    let rkName = tier.name;
    if (!isTopTier(tier)) {
      const pos = stN - tier.min;
      const range = tier.max - tier.min || 1;
      const sub = Math.min(2, Math.floor(pos / (range / 3)));
      rkName = tier.name + ' ' + SUB_RANKS[sub];
    }
    /* 王者系 / 荣耀系补上内部星级（如「王者 32 星」） */
    const _pl = getRankStarLabel(stN);
    if (_pl) rkName += ' · ' + _pl;
    let nextTxt = '';
    if (isTopTier(tier)) {
      nextTxt = '已达最高段位';
    } else {
      const pos = stN - tier.min;
      const range = tier.max - tier.min || 1;
      const sub = Math.floor(pos / (range / 3)) + 1;
      if (sub < 3) {
        nextTxt = '距 ' + tier.name + SUB_RANKS[sub] + ' ' + (Math.ceil((range / 3) * sub) - pos) + ' 星';
      } else {
        const nt = RANK_TIERS[RANK_TIERS.indexOf(tier) + 1];
        nextTxt = nt ? '距 ' + nt.name + 'Ⅲ ' + (tier.max - stN) + ' 星' : '已达最高';
      }
    }
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '⭐ 星耀 · 王者之路', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    ctx.beginPath();
    ctx.arc(W / 2, 452, 168, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = tier.color;
    ctx.lineWidth = 7;
    ctx.stroke();
    _pEmoji(ctx, tier.icon, W / 2, 454, 128, 'center');
    _pC(ctx, rkName, W / 2, 676, 72, 900, tier.color);
    _pC(ctx, '累计 ' + _pBig(stN) + ' 星', W / 2, 766, 52, 800, '#FFFFFF');
    _pC(ctx, nextTxt, W / 2, 832, 42, 700, 'rgba(255,255,255,0.8)');
    const rd = C.rankData || { todayGained: 0, over: 0, under: 0 };
    const cells = [
      ['🎯', '今日已得', '+' + _pBig(rd.todayGained || 0) + ' ⭐', th.accent],
      ['🔥', '连续达标', _pBig(rd.over || 0) + ' 天', '#FFFFFF'],
      ['📉', '连续未达标', _pBig(rs.consecutiveUnder || 0) + ' 天', '#FFFFFF'],
      ['🏆', '生涯最高', _pBig((rs.history && rs.history.maxStarsCareer) || 0) + ' 星', th.accent],
      ['📅', '当前赛季', seasonLabel(getSeasonInfo().number), th.accent],
      ['💫', '生涯称号', (rs.history && rs.history.maxRankNameCareer) || rkName, th.accent]
    ];
    cells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 900 + row * 126, 500, 116, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPosterStreak(ctx, W, H, th, C, _q) {
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '坚持是一种习惯', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    _pEmoji(ctx, '🔥', W / 2, 372, 116, 'center');
    _pC(ctx, String(C.streak || 0), W / 2, 536, 156, 900, th.accent);
    _pC(ctx, '连续打卡天数', W / 2, 630, 46, 700, 'rgba(255,255,255,0.6)');
    const d7 = C.day7 || [];
    const d7x = W / 2 - (d7.length - 1) * 86;
    d7.forEach(function (d, i) {
      const has = d && (d.full > 0 || d.half > 0 || d.inc > 0);
      ctx.beginPath();
      ctx.arc(d7x + i * 86, 712, 30, 0, Math.PI * 2);
      ctx.fillStyle = has ? th.accent : 'rgba(255,255,255,0.12)';
      ctx.fill();
      _pC(ctx, d.label, d7x + i * 86, 774, 26, 600, 'rgba(255,255,255,0.4)');
    });
    const cells = [
      ['🍅', '累计完整', _pBig(C.totalFull || 0), th.accent],
      ['📅', '活跃天数', _pBig(C.activeDays || 0), '#FFFFFF'],
      ['🌅', '早起连续', _pBig(C.earlyStreak || 0), '#FFFFFF'],
      ['🌙', '夜间连续', _pBig(C.nightStreak || 0), th.accent],
      ['🏆', '单日最高', _pBig(C.maxDayFull || 0), th.accent],
      ['🎯', '完美周', _pBig(C.perfectWeekCount || 0), th.accent]
    ];
    cells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 830 + row * 126, 500, 116, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPosterToday(ctx, W, H, th, C, _q) {
  const tb = C.tb || { full: 0, half: 0, incomplete: 0, pomos: 0, minutes: 0, int: 0 };
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(
      ctx,
      new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) + ' · 今天的努力',
      W / 2,
      272,
      34,
      600,
      'rgba(255,255,255,0.5)'
    );
    _pEmoji(ctx, '🍅', W / 2, 372, 104, 'center');
    _pC(ctx, String(tb.pomos || 0), W / 2, 536, 156, 900, th.accent);
    _pC(ctx, '今日番茄数（折算）', W / 2, 630, 46, 700, 'rgba(255,255,255,0.6)');
    _pC(
      ctx,
      '完整 ' + (tb.full || 0) + ' · 半个 ' + (tb.half || 0) + ' · 未完成 ' + (tb.incomplete || 0),
      W / 2,
      712,
      42,
      700,
      'rgba(255,255,255,0.75)'
    );
    const cells = [
      ['⏱️', '今日专注', (tb.minutes || 0) + ' 分钟', th.accent],
      ['💥', '打断次数', (tb.int || 0) + ' 次', '#FFFFFF'],
      ['⚡', '平均时长', (C.avgDur ? Math.round(C.avgDur) : 0) + ' 分钟', th.accent],
      ['🔥', '当前连续', (C.streak || 0) + ' 天', th.accent]
    ];
    cells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 780 + row * 136, 500, 126, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPosterTree(ctx, W, H, th, C, _q) {
    /* 种树海报：按用户选的树种生成；展示 9 阶段进度（到达高亮/未到达灰）+ 一段坚持文字 */
    const tr = appData.tree || { points: 0, peakPoints: 0, totalFruitsHarvested: 0, coins: 0, waterStreak: 0 };
    const sid = _posterTreeId || tr.species || 'tomato';
    const sp = TREE_SPECIES[sid] || { name: '番茄树', icon: '🍅' };
    const pts = tr.speciesPoints && tr.speciesPoints[sid] != null ? tr.speciesPoints[sid] : tr.points || 0;
    const stages = SPECIES_STAGES[sid] || SPECIES_STAGES.tomato;
    const st = getTreeStageFor(pts, sid) || stages[0];
    const stIdx = stages.findIndex(function (s) {
      return s.min === st.min;
    });
    const stIdxSafe = stIdx < 0 ? 0 : stIdx;
    const tl = getTreeTitle((tr.speciesPeak && tr.speciesPeak[sid]) || tr.peakPoints || 0) || {
      icon: '🍃',
      name: '新芽园丁'
    };
    const evo = (tr.milestones && tr.milestones.length) || 0;
    const album = (tr.fruitAlbum && tr.fruitAlbum.length) || 0;
    const ach = (appData.unlockedAchievements && appData.unlockedAchievements.length) || 0;
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '我的' + sp.name + ' · 一起成长', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    _pEmoji(ctx, st.emoji, W / 2, 384, 150, 'center');
    _pC(ctx, st.name, W / 2, 548, 80, 900, th.accent);
    _pC(
      ctx,
      '第 ' + (stIdxSafe + 1) + ' 阶段 / 共 ' + stages.length + ' 阶段 · ' + tl.icon + ' 称号 · ' + tl.name,
      W / 2,
      616,
      38,
      700,
      '#FFD54F'
    );
    /* 9 阶段进度：到达的实心高亮，未到达灰色空心 */
    const dotR = 20,
      gap = 46,
      totalW = (stages.length - 1) * gap + dotR * 2,
      dotX0 = W / 2 - totalW / 2 + dotR;
    for (let i = 0; i < stages.length; i++) {
      const reached = i <= stIdxSafe;
      const cx = dotX0 + i * gap;
      ctx.beginPath();
      ctx.arc(cx, 674, dotR, 0, Math.PI * 2);
      if (reached) {
        ctx.fillStyle = th.accent;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      _pC(
        ctx,
        reached ? stages[i].emoji : String(i + 1),
        cx,
        674,
        reached ? 20 : 13,
        700,
        reached ? '#FFFFFF' : 'rgba(255,255,255,0.4)'
      );
      _pC(
        ctx,
        stages[i].name.length > 2 ? stages[i].name.slice(0, 2) : stages[i].name,
        cx,
        712,
        13,
        600,
        reached ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)'
      );
    }
    /* 一段努力/坚持文字：用真实数据讲坚持故事 */
    const _effortLine1 =
      '连续打卡 ' +
      _pBig(C.streak || 0) +
      ' 天 · 累计活跃 ' +
      _pBig(C.activeDays || 0) +
      ' 天 · 浇水连续 ' +
      _pBig(tr.waterStreak || 0) +
      ' 天';
    let _effortLine2 = '从「' + stages[0].name + '」一路养到「' + st.name + '」';
    if (pts > 0) _effortLine2 += ' · 累计 ' + _pBig(pts) + ' 点成长';
    /* 不再用「累计总番茄」（动辄上千，对用户没意义也没说服力），
       改用本月 + 今日两个近期口径，与「这棵树最近被你怎么养」直接对应。 */
    const _mNow = C.monthNow || { full: 0, half: 0 };
    const _tb = C.tb || { full: 0, half: 0 };
    const _mTotal = Math.round(((_mNow.full || 0) + (_mNow.half || 0)) * 10) / 10;
    const _dTotal = Math.round(((_tb.full || 0) + (_tb.half || 0)) * 10) / 10;
    _effortLine2 += '，本月 ' + _pBig(_mTotal) + ' 个🍅 · 今日 ' + _pBig(_dTotal) + ' 个';
    _pC(ctx, _effortLine1, W / 2, 758, 30, 800, 'rgba(255,255,255,0.85)');
    _pC(ctx, _effortLine2, W / 2, 798, 26, 600, 'rgba(255,255,255,0.6)');
    const cells = [
      ['🌱', '成长点', _pBig(pts), th.accent],
      ['🔄', '进化次数', _pBig(evo) + ' 次', '#FFFFFF'],
      ['🎁', '图鉴点亮', _pBig(album) + '/' + stages.length, th.accent],
      ['🏅', '成就数', _pBig(ach) + ' 个', '#FFFFFF'],
      ['🍒', '累计收获', _pBig(tr.totalFruitsHarvested || 0), '#FFFFFF'],
      ['💧', '浇水连续', _pBig(tr.waterStreak || 0) + ' 天', th.accent]
    ];
    cells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 832 + row * 118, 500, 108, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPosterBio(ctx, W, H, th, C, _q) {
    /* ⏰ 专注生物钟：时段分布（早6-12/午12-18/晚18-24/夜0-6）+ 作息判定 */
    const pd = C.periods || [0, 0, 0, 0];
    const pdTotal = pd[0] + pd[1] + pd[2] + pd[3] || 1;
    const pct = function (i) {
      return Math.round((pd[i] / pdTotal) * 100);
    };
    /* 生物钟判定：按「占比最高的时段」判断——该时段占比 ≥40% 就归那一型，否则才叫均衡型。
       覆盖全部 4 个时段（早晨/午后/傍晚/深夜），不再出现「傍晚 81% 却判均衡」的荒谬结果 */
    let bioTag = '均衡型 · 全天都在线',
      bioSub = '你的专注散布在一天各个时段，节奏很稳';
    let _bestI = 0;
    for (let i = 1; i < 4; i++) {
      if (pd[i] > pd[_bestI]) _bestI = i;
    }
    const _bestPct = pct(_bestI);
    if (_bestPct >= 40) {
      if (_bestI === 0) {
        bioTag = '🌅 晨型人 · 上午最专注';
        bioSub = '早起的鸟儿有番茄，清晨效率拉满（' + _bestPct + '% 专注集中在早晨）';
      } else if (_bestI === 1) {
        bioTag = '☀️ 午后型 · 下午最给力';
        bioSub = '午后的你状态最稳（' + _bestPct + '% 专注集中在下午）';
      } else if (_bestI === 2) {
        bioTag = '🌆 黄昏型 · 傍晚最投入';
        bioSub = '日落之后你反而更专注（' + _bestPct + '% 专注集中在傍晚）';
      } else {
        bioTag = '🌙 夜猫子 · 深夜最清醒';
        bioSub = '别人睡觉你专注（' + _bestPct + '% 专注集中在深夜）';
      }
    }
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '一天里，你什么时候最专注？', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    /* 4 时段大卡 */
    _pBigCard(ctx, 60, 352, 240, 300, '🌅', pct(0) + '%', '早晨 6-12 点', th.accent);
    _pBigCard(ctx, 300, 352, 240, 300, '☀️', pct(1) + '%', '午后 12-18 点', th.accent);
    _pBigCard(ctx, 540, 352, 240, 300, '🌆', pct(2) + '%', '傍晚 18-24 点', th.accent);
    _pBigCard(ctx, 780, 352, 240, 300, '🌙', pct(3) + '%', '深夜 0-6 点', th.accent);
    _pRR(ctx, 60, 686, 960, 92, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    _pC(ctx, bioTag, W / 2, 740, 44, 900, th.accent);
    _pC(ctx, bioSub, W / 2, 792, 26, 600, 'rgba(255,255,255,0.55)');
    const bioCells = [
      ['🌅', '早起连续', _pBig(C.earlyStreak || 0) + ' 天', th.accent],
      ['🌙', '夜间连续', _pBig(C.nightStreak || 0) + ' 天', '#FFFFFF'],
      ['📅', '活跃天数', _pBig(C.activeDays || 0) + ' 天', th.accent],
      ['🍅', '今日番茄', _pBig((C.tb && C.tb.pomos) || 0), th.accent]
    ];
    bioCells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 806 + row * 126, 500, 116, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPosterSprint(ctx, W, H, th, C, _q) {
    /* 高强度冲刺（对外友好版）：不出现「冲刺区/破限/倍率」等内部黑话，
       只讲外行一眼懂的事：今天专注了几小时、连续几天每天 12+ 个番茄 */
    const sp = (C.focusRank && C.focusRank.sprint) || { todayCount: 0, streak: 0, mult: 1.2, mode: 'normal', base: 8 };
    const todayMin = (C.tb && C.tb.minutes) || 0;
    /* 时长人性化：不足 1 小时直接说「xx 分钟」（0.4h 这种小数没人看得懂），满 1 小时才用小时 */
    const _fmtH = function (m) {
      return m >= 60 ? (m / 60).toFixed(1).replace(/\.0$/, '') : String(m);
    };
    const _fmtHU = function (m) {
      return m >= 60 ? _fmtH(m) + ' 小时' : m + ' 分钟';
    };
    const todayH = _fmtH(todayMin);
    const weekFull = (C.weekNow && C.weekNow.full) || 0;
    const weekMin = (C.weekNow && C.weekNow.mins) || 0;
    let spTag = '💪 全力以赴的一天',
      spSub = '今天 ' + _pBig(sp.todayCount) + ' 个番茄 · 专注 ' + _fmtHU(todayMin);
    if (sp.streak >= 7) {
      spTag = '🔥 连续 7 天高强度专注';
      spSub = '每天 12 个番茄以上，真的狠人';
    } else if (sp.streak >= 3) {
      spTag = '🔥 连续 ' + sp.streak + ' 天高强度';
      spSub = '每天都 12 个番茄以上，坚持住了';
    } else if (sp.streak >= 1) {
      spTag = '💪 连续 ' + sp.streak + ' 天冲刺';
      spSub = '昨天、今天都在 12 个番茄以上';
    } else if (sp.todayCount >= 12) {
      spTag = '⚡ 今日高强度达成';
      spSub = '今天 12 个番茄 · 专注 ' + _fmtHU(todayMin);
    }
    const prog = Math.min(100, Math.round((sp.todayCount / 12) * 100));
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '把每一天，都用足力气', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    /* 主数字：今日专注小时（外行秒懂） */
    ctx.beginPath();
    ctx.arc(W / 2, 452, 168, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 7;
    ctx.stroke();
    _pC(ctx, todayMin >= 60 ? todayH + 'h' : todayMin + '分', W / 2, 438, 104, 900, th.accent);
    _pC(ctx, '今日专注时长', W / 2, 540, 36, 700, 'rgba(255,255,255,0.6)');
    _pC(ctx, spTag, W / 2, 620, 52, 900, '#FFFFFF');
    _pC(ctx, spSub, W / 2, 686, 26, 600, 'rgba(255,255,255,0.55)');
    /* 今日进度条：12 个番茄 */
    _pRR(ctx, 60, 726, 960, 34, 17);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    if (prog > 0) {
      _pRR(ctx, 60, 726, Math.max(34, (960 * prog) / 100), 34, 17);
      ctx.fillStyle = th.accent;
      ctx.fill();
    }
    _pC(ctx, '今日番茄 ' + _pBig(sp.todayCount) + ' 个 · 目标 12 个', W / 2, 772, 30, 700, 'rgba(255,255,255,0.8)');
    const spCells = [
      ['🍅', '今日番茄', _pBig(sp.todayCount) + ' 个', th.accent],
      ['🔥', '连续专注', _pBig(C.streak || 0) + ' 天', '#FFFFFF'],
      ['📅', '连续 12+🍅', _pBig(sp.streak) + ' 天', th.accent],
      ['📈', '本周番茄', _pBig(weekFull) + ' 个', '#FFFFFF'],
      ['⏱️', '本周专注', _fmtHU(weekMin), th.accent],
      [
        '🗓️',
        '近7天番茄',
        _pBig(
          (C.day7 || []).reduce(function (s, d) {
            return s + (d.count || 0);
          }, 0)
        ) + ' 个',
        th.accent
      ]
    ];
    spCells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 792 + row * 118, 500, 108, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

/* 执行力多维度评分。
   只看「任务勾选率」一个维度不行：用户没有列计划的习惯时勾选率天然 100%，
   于是「本来没什么执行力」也被判成「执行力 100%」。这里改成 4 个维度加权：
     ① 任务维度：近 30 天活跃计划任务的完成率（不是全量僵尸任务）
     ② 计划维度：有预计🍅的任务，实际投入 / 预计投入
     ③ 执行维度：有记录的天数 / 近 30 天（衡量「真的坐下来做了」）
     ④ 稳定维度：连续打卡天数（封顶 14 天给满分，避免老用户一贯满分）
   任一无数据 → 该维度剔除并把权重按比例分给其余维度，避免「0 样本被判 0 分」。 */
function calcExecutionScore(C) {
  const ts = C.taskStats || { planned: 0, actual: 0, taskCnt: 0, doneCnt: 0 };
  const activePlan = C.activePlan || 0;
  const activeDone = C.activeDone || 0;
  const parts = [];
  /* ① 任务维度：优先用活跃计划口径，无活跃计划时退回全量计划口径 */
  if (activePlan > 0) parts.push({ w: 0.35, v: activeDone / activePlan, label: '任务', txt: '活跃计划完成 ' + activeDone + '/' + activePlan });
  else if (ts.taskCnt > 0) parts.push({ w: 0.35, v: ts.doneCnt / ts.taskCnt, label: '任务', txt: '任务完成 ' + ts.doneCnt + '/' + ts.taskCnt });
  /* ② 计划维度：预计🍅 vs 实际🍅（实际超过预计按满分计，超出不惩罚） */
  if (ts.planned > 0) parts.push({ w: 0.3, v: Math.min(1, (ts.actual || 0) / ts.planned), label: '计划', txt: '计划🍅达成 ' + ts.actual + '/' + ts.planned });
  /* ③ 执行维度：近 30 天有记录的天数占比 */
  const _active = C.activeDays || 0;
  if (_active > 0) parts.push({ w: 0.2, v: Math.min(1, _active / 30), label: '执行', txt: '近30天行动 ' + _active + ' 天' });
  /* ④ 稳定维度：连续打卡，14 天封顶 */
  const _stk = C.streak || 0;
  if (_stk > 0) parts.push({ w: 0.15, v: Math.min(1, _stk / 14), label: '稳定', txt: '连续打卡 ' + _stk + ' 天' });
  if (!parts.length) return { score: null, grade: '还没数据', sub: '开始专注或制定计划后，这里会展示你的执行力', txt: '' };
  const _wSum = parts.reduce(function (s, p) { return s + p.w; }, 0);
  const _raw = parts.reduce(function (s, p) { return s + p.w * p.v; }, 0) / _wSum;
  const score = Math.round(_raw * 100);
  let grade;
  if (score >= 85) grade = '🏆 超强执行力';
  else if (score >= 70) grade = '💪 执行力在线';
  else if (score >= 50) grade = '🌤 执行力一般';
  else if (score >= 30) grade = '🌱 执行力待激活';
  else grade = '🪴 才刚刚起步';
  /* 明细一行，让用户看得见分数是怎么来的，不再只有一个孤零零的百分比 */
  return { score: score, grade: grade, sub: parts.map(function (p) { return p.txt; }).join(' · '), txt: parts.map(function (p) { return p.label + ' ' + Math.round(p.v * 100) + '%'; }).join(' / ') };
}
function drawPosterPlan(ctx, W, H, th, C, _q) {
    /* 计划执行力：多维度综合（任务/计划/执行/稳定），不再只看任务勾选率 */
    const ts = C.taskStats || { planned: 0, actual: 0, taskCnt: 0, doneCnt: 0 };
    const _ex = calcExecutionScore(C);
    const score = _ex.score == null ? 0 : _ex.score;
    const doneRate = ts.taskCnt ? Math.round((ts.doneCnt / ts.taskCnt) * 100) : 0;
    const pomoRate = ts.planned ? Math.round((ts.actual / ts.planned) * 100) : 0;
    const planTag = _ex.grade;
    const planSub = _ex.score == null ? _ex.sub : _ex.sub + '（近 30 天）';
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '言出必行 · 执行力综合评分', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    /* 主数字：多维度综合分 */
    ctx.beginPath();
    ctx.arc(W / 2, 452, 168, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 7;
    ctx.stroke();
    _pC(ctx, score + '%', W / 2, 438, 104, 900, th.accent);
    _pC(ctx, '执行力综合分', W / 2, 540, 36, 700, 'rgba(255,255,255,0.6)');
    _pC(ctx, planTag, W / 2, 620, 52, 900, '#FFFFFF');
    _pC(ctx, planSub, W / 2, 686, 26, 600, 'rgba(255,255,255,0.55)');
    const planCells = [
      ['✅', '完成任务', _pBig(ts.doneCnt) + '/' + _pBig(ts.taskCnt), th.accent],
      ['📌', '计划🍅', _pBig(ts.planned), '#FFFFFF'],
      ['🍅', '实际🍅', _pBig(ts.actual), th.accent],
      ['📈', '任务完成率', doneRate + '%', th.accent],
      ['🎯', '计划达成率', pomoRate + '%', '#FFFFFF'],
      ['💪', '连续打卡', _pBig(C.streak || 0) + ' 天', th.accent]
    ];
    planCells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 730 + row * 126, 500, 116, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPosterWellness(ctx, W, H, th, C, _q) {
    /* wellness */
    /* 身心状态：睡眠/精神（日记）+ 电量/愉悦（记录），近 7 天 */
    const m7 = C.mood7 || [];
    const avg = function (key) {
      const v = m7
        .filter(function (x) {
          return x[key] != null;
        })
        .map(function (x) {
          return x[key];
        });
      return v.length
        ? Math.round(
            v.reduce(function (a, b) {
              return a + b;
            }, 0) / v.length
          )
        : null;
    };
    const sleep = avg('sleep'),
      mental = avg('mental'),
      energy = avg('energy'),
      pleasure = avg('pleasure');
    const filled = m7.filter(function (x) {
      return x.sleep != null || x.mental != null;
    }).length;
    /* 综合评级：先算「四项均值 + 最差项」，用整体定级，单项亮点只在高位且整体不差时才给。
       旧逻辑是「单项 ≥7 就封达人」，于是 3 个一般 + 1 个较好也被夸成达人，与实际体感不符。 */
    const _wVals = [sleep, mental, energy, pleasure].filter(function (v) {
      return v != null;
    });
    const _wAvg = _wVals.length
      ? _wVals.reduce(function (a, b) {
          return a + b;
        }, 0) / _wVals.length
      : null;
    const _wMin = _wVals.length ? Math.min.apply(null, _wVals) : null;
    let wTag, wSub;
    if (_wAvg == null) {
      wTag = '📝 还没有状态记录';
      wSub = '记录睡眠、精神、电量与心情后，这里会给出你的状态评级';
    } else if (_wMin <= 3) {
      wTag = '⚡ 状态需要充电';
      wSub = '有一项指标明显偏低，先休息，别硬撑';
    } else if (_wAvg >= 8 && _wMin >= 7) {
      wTag = '🌟 状态全面在线';
      wSub = '睡眠、精神、电量、心情都在高位，趁势冲一波';
    } else if (sleep != null && sleep >= 8 && _wAvg >= 7) {
      wTag = '🌙 睡眠冠军';
      wSub = '睡得好，精力旺，专注自然跟得上';
    } else if (pleasure != null && pleasure >= 8 && _wAvg >= 7) {
      wTag = '😄 心情达人';
      wSub = '整体状态也在高位，情绪稳定，做什么都顺';
    } else if (energy != null && energy >= 8 && _wAvg >= 7) {
      wTag = '🔋 电量满格';
      wSub = '状态充沛，适合啃硬任务';
    } else if (_wAvg >= 6) {
      wTag = '🌿 状态不错';
      wSub = '整体稳定，还有 1-2 项可以再提一提';
    } else if (_wAvg >= 4) {
      wTag = '🧘 状态一般';
      wSub = '有起伏但还在正轨，注意补觉和休息';
    } else {
      wTag = '🍂 状态待恢复';
      wSub = '最近整体偏低，先照顾好自己，再谈效率';
    }
    _pC(ctx, th.title, W / 2, 198, 86, 900, '#FFFFFF');
    _pC(ctx, '记录状态 · 看见身心变化', W / 2, 272, 34, 600, 'rgba(255,255,255,0.5)');
    /* 大卡显示等级词（外人一眼懂），小字保留分数（懂的人可细看） */
    _pBigCard(
      ctx,
      60,
      352,
      240,
      300,
      '😴',
      _pScore(sleep),
      '睡眠质量' + (sleep != null ? ' ' + sleep + '分' : ''),
      th.accent
    );
    _pBigCard(
      ctx,
      300,
      352,
      240,
      300,
      '🧠',
      _pScore(mental),
      '精神状态' + (mental != null ? ' ' + mental + '分' : ''),
      th.accent
    );
    _pBigCard(
      ctx,
      540,
      352,
      240,
      300,
      '🔋',
      _pScore(energy),
      '开始电量' + (energy != null ? ' ' + energy + '分' : ''),
      th.accent
    );
    _pBigCard(
      ctx,
      780,
      352,
      240,
      300,
      '😊',
      _pScore(pleasure),
      '结束心情' + (pleasure != null ? ' ' + pleasure + '分' : ''),
      th.accent
    );
    _pRR(ctx, 60, 686, 960, 92, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    _pC(ctx, wTag, W / 2, 740, 44, 900, th.accent);
    _pC(ctx, wSub, W / 2, 792, 26, 600, 'rgba(255,255,255,0.55)');
    const wCells = [
      ['📝', '近7天记录', filled + ' 天', th.accent],
      ['💤', '睡眠', _pScore(sleep), '#FFFFFF'],
      ['🧠', '精神', _pScore(mental), th.accent],
      ['🎯', '今日电量', _pScore(energy), th.accent]
    ];
    wCells.forEach(function (ci, i) {
      const col = i % 2,
        row = Math.floor(i / 2);
      _pCell(ctx, 35 + col * 510, 806 + row * 126, 500, 116, ci[0], ci[1], ci[2], ci[3]);
    });
    _pC(ctx, '「 ' + _q + ' 」', W / 2, 1340, 46, 700, 'rgba(255,255,255,0.75)');
}

function drawPoster() {
  /* 海报是对外展示的，必须用当下最新统计：先作废缓存，避免跨天/旧缓存让数字与实际不符 */
  invalidateStatsCache();
  const c = document.getElementById('posterCanvas');
  if (!c || !_posterType) return;
  const ctx = c.getContext('2d');
  const W = c.width || 1080,
    H = c.height || 1440;
  const th = POSTER_THEMES[_posterType] || POSTER_THEMES.all;
  /* 背景 */
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#131930');
  g.addColorStop(0.55, '#1B2440');
  g.addColorStop(1, '#232E52');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const glow = function (cx, cy, r) {
    const gg = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
    gg.addColorStop(0, th.glow);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, W, H);
  };
  glow(W * 0.85, H * 0.12, W * 0.55);
  glow(W * 0.1, H * 0.92, W * 0.5);
  /* 顶部 */
  _pEmoji(ctx, '🍅', 52, 88, 42, 'center');
  _pL(ctx, '瓶子番茄', 106, 88, 46, 800, 'rgba(255,255,255,0.9)');
  const dstr = new Date()
    .toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\//g, '.');
  _pR(ctx, dstr, W - 62, 88, 38, 700, 'rgba(255,255,255,0.45)');
  /* 数据 */
  const C = getStatsCache();
  const _q = POSTER_QUOTES[Math.floor(Math.random() * POSTER_QUOTES.length)];
  if (_posterType === 'all') { drawPosterAll(ctx, W, H, th, C, _q); }
  else if (_posterType === 'seg') { drawPosterSeg(ctx, W, H, th, C, _q); }
  else if (_posterType === 'rank') { drawPosterRank(ctx, W, H, th, C, _q); }
  else if (_posterType === 'streak') { drawPosterStreak(ctx, W, H, th, C, _q); }
  else if (_posterType === 'today') { drawPosterToday(ctx, W, H, th, C, _q); }
  else if (_posterType === 'tree') { drawPosterTree(ctx, W, H, th, C, _q); }
  else if (_posterType === 'bio') { drawPosterBio(ctx, W, H, th, C, _q); }
  else if (_posterType === 'sprint') { drawPosterSprint(ctx, W, H, th, C, _q); }
  else if (_posterType === 'plan') { drawPosterPlan(ctx, W, H, th, C, _q); }
  else { drawPosterWellness(ctx, W, H, th, C, _q); }
  /* 底部品牌 */
  _pC(ctx, '— 瓶子番茄 · 专注打卡 —', W / 2, 1406, 34, 600, 'rgba(255,255,255,0.3)');
  /* 预览图用缩小版（720×960）：Via 长按查看更流畅；下载走 savePoster 用原 canvas 高清。canvas 仅作绘制源，生成后隐藏避免出现两张图 */
  const img = document.getElementById('posterImg');
  if (img) {
    const small = document.createElement('canvas');
    small.width = 720;
    small.height = 960;
    const sctx = small.getContext('2d');
    sctx.drawImage(c, 0, 0, 720, 960);
    img.src = small.toDataURL('image/jpeg', 0.88);
    img.style.display = 'block';
  }
  c.style.display = 'none';
}
