// @layer: L1
/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 沉浸式冒险总结海报（L1，UI）：由 01f_engine_immersive.js 迁入，代码原样搬运。 ｜症状：冒险总结海报空白 · 保存不下来
 * 对外 = drawImmersivePoster / saveImmersivePoster（模板 data-act 按 window 名调用）。
 * 依赖方向：本文件 → 引擎（getImmersiveScript / chaptersName / immersiveComment）
 *           本文件 → 海报绘制原语（_pC/_pL/_pR/_pRR/_pEmoji @01e2）
 * 红线：不要把绘制原语再下沉回引擎 —— 引擎只提供数据，不参与 canvas 绘制。 */
/* ============================================================
 * 为什么搬：这 143 行 canvas 绘制原在 01f 引擎文件里，直接调用 01e2 的私有
 *   绘制原语 17 次，是「引擎在画海报」的职责错位。给那 17 处加 UIFX. 前缀
 *   只会让门禁闭嘴、代码仍躺在引擎里 —— 那是假合规。
 *   搬到 UI 层后方向变成「UI 调引擎取数据」，是 E3 允许的方向。
 * 函数索引（TOC）：drawImmersivePoster/saveImmersivePoster
 * ============================================================ */
/* ---- 冒险总结海报：canvas 1080×1440（复用海报绘制辅助 _pC/_pL/_pR/_pRR 等） ---- */
function drawImmersivePoster() {
  const imf = appData.immersiveFocus;
  if (!imf) return;
  const script = getImmersiveScript(imf.scriptId);
  if (!script) return;
  const ending = imf.ending || 'bad';
  const end =
    (ending === 'perfect' && script.endings.perfect) ||
    (ending === 'fail' && script.endings.fail) ||
    script.endings.bad;
  const c = document.getElementById('imPosterCanvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width || 1080,
    H = c.height || 1440;
  /* 背景：深空渐变 + 星光 */
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0d1322');
  g.addColorStop(0.55, '#16213e');
  g.addColorStop(1, '#1b2b4f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const sx = Math.random() * W,
      sy = Math.random() * H,
      sr = Math.random() * 2 + 0.5;
    ctx.globalAlpha = Math.random() * 0.7 + 0.2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const glow = function (cx, cy, r, color) {
    const gg = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
    gg.addColorStop(0, color);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, W, H);
  };
  glow(W * 0.5, H * 0.18, W * 0.6, script.themeColor || 'rgba(79,195,247,0.35)');
  glow(W * 0.85, H * 0.9, W * 0.5, 'rgba(255,183,77,0.18)');
  /* 顶部 */
  _pC(ctx, '沉浸式专注 · 冒险总结', W / 2, 110, 44, 800, 'rgba(255,255,255,0.85)');
  const dstr = new Date()
    .toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\//g, '.');
  _pR(ctx, dstr, W - 70, 110, 36, 700, 'rgba(255,255,255,0.45)');
  /* 角色区 */
  _pC(ctx, script.seriesIcon + ' ' + script.series, W / 2, 208, 40, 700, 'rgba(255,255,255,0.6)');
  ctx.beginPath();
  ctx.arc(W / 2, 340, 95, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = script.themeColor || '#4FC3F7';
  ctx.lineWidth = 4;
  ctx.stroke();
  _pEmoji(ctx, script.role.avatar, W / 2, 340, 96, 'center');
  _pC(ctx, script.role.name, W / 2, 492, 58, 900, '#FFFFFF');
  _pC(ctx, script.role.title, W / 2, 556, 34, 600, 'rgba(255,255,255,0.55)');
  /* 结局 */
  _pC(
    ctx,
    ending === 'perfect' ? '🎉 完美结局' : ending === 'fail' ? '😔 失败结局' : '💀 Bad Ending',
    W / 2,
    660,
    40,
    800,
    'rgba(255,255,255,0.65)'
  );
  _pC(ctx, end.title, W / 2, 742, 88, 900, script.themeColor || '#4FC3F7');
  /* 结局文案（自动换行，最多3行） */
  const _wrap = (text, maxWidth, maxLines) => {
    const lines = [];
    let line = '';
    for (let i = 0; i < text.length; i++) {
      line += text[i];
      if (ctx.measureText(line).width > maxWidth) {
        lines.push(line.slice(0, -1));
        line = text[i];
      }
      if (lines.length >= maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    return lines;
  };
  const endLines = _wrap(end.text || '', W - 160, 3);
  endLines.forEach(function (t, i) {
    _pC(ctx, t, W / 2, 830 + i * 52, 38, 600, 'rgba(255,255,255,0.85)');
  });
  /* 章节回顾 */
  const evs = imf.events || [];
  const startY = 1020;
  _pC(ctx, '—— 章节回顾 ——', W / 2, startY - 20, 34, 700, 'rgba(255,255,255,0.5)');
  for (let i = 0; i < 4; i++) {
    const ev = evs.find(function (e) {
      return e.chapter === i;
    });
    const ch = script.chapters[i];
    const y = startY + 64 * i;
    ctx.beginPath();
    ctx.arc(W / 2 - 150, y, 24, 0, Math.PI * 2);
    ctx.fillStyle = ev ? (ev.success ? 'rgba(92,184,92,0.85)' : 'rgba(192,57,43,0.85)') : 'rgba(255,255,255,0.12)';
    ctx.fill();
    _pC(ctx, ev ? (ev.success ? '✓' : '✕') : '·', W / 2 - 150, y, 30, 900, '#FFFFFF');
    _pL(ctx, chaptersName(i) + ' ' + ch.title, W / 2 - 100, y, 38, 800, ev ? '#FFFFFF' : 'rgba(255,255,255,0.35)');
  }
  /* 统计 */
  const mins = Math.floor(imf.focusSeconds / 60);
  const fulls = evs.filter(function (e) {
    return e.success;
  }).length;
  const stats = [
    ['⏱️', '专注时长', mins + ' 分钟'],
    ['🍅', '完成章节', fulls + ' / 4'],
    ['🔥', '恐惧值', (imf.fear || 0) + '']
  ];
  stats.forEach(function (si, i) {
    const x = 60 + i * 340;
    _pRR(ctx, x, 1330, 300, 120, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    _pEmoji(ctx, si[0], x + 46, 1360, 44, 'center');
    _pL(ctx, si[1], x + 86, 1360, 30, 600, 'rgba(255,255,255,0.55)');
    _pR(ctx, si[2], x + 286, 1360, 44, 800, '#FFFFFF');
  });
  /* 评价语 */
  _pC(ctx, '「 ' + immersiveComment(ending, mins) + ' 」', W / 2, 1408, 34, 700, 'rgba(255,255,255,0.7)');
  /* 长按预览防卡死：canvas → JPEG 0.92（≈230KB）→ img 展示；PNG 达 2.4MB，长按预览会卡死浏览器 */
  _imPosterDataURL = c.toDataURL('image/jpeg', 0.92);
  const img = document.getElementById('imPosterImg');
  if (img) {
    img.src = _imPosterDataURL;
    img.style.display = 'block';
    c.style.display = 'none';
  }
  showModal('immersivePosterModal');
}
/* 已生成海报的 JPEG dataURL 缓存：长按预览与保存共用一份，避免二次生成（长按预览防卡死） */
let _imPosterDataURL = null;
function saveImmersivePoster() {
/* 防御：从未生成过海报时先绘制，避免下载空图/黑图 */
  if (!_imPosterDataURL) {
    const c0 = document.getElementById('imPosterCanvas');
    if (c0 && (!c0.width || !c0.height)) {
      c0.width = 1080;
      c0.height = 1440;
    }
    try {
      drawImmersivePoster();
    } catch (e) {
      showToast('❌ 海报生成失败，请稍后再试');
      return;
    }
  }
  const c = document.getElementById('imPosterCanvas');
  const url = _imPosterDataURL || (c ? c.toDataURL('image/jpeg', 0.92) : null);
  if (!url) {
    showToast('❌ 没有可保存的海报');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = '番茄钟-冒险总结海报-' + new Date().toISOString().slice(0, 10) + '.jpg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('📤 冒险海报已生成，去分享吧！');
}
