/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 音效与动效层：对外 = playSound / updateSfxVolume / showFocusQuote / popEl / shakeEl / fxVal / fxNumPop / fxVibrate。
 * 被依赖多（01c 计时、01d 结算、01e 各处、01f 沉浸）：全部**顶层函数声明**，跨 script 全局可见。
 * 红线：这些名字是全局契约，改名会让所有调用点一起失效；
 *       本文件必须排在 01e_engine_ui.js **之后**加载（见 src/manifest.json 的槽 1 files）。 */
/* ==================== 模块: 04eH-ui-fx.js | 职责: 音效与动效（WebAudio 合成 + DOM 特效） | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04eH-ui-fx.js（源文件 01eH_ui_fx.js）
 * 分组：ui
 * 职责：音效（WebAudio 合成，无 mp3 资产）+ 焦点语录 + 轻量 DOM 动效
 *   · 只搬「顶层函数声明 + 它们的私有常量」，**不搬任何顶层立即执行语句** ——
 *     因此跨 script 的加载顺序只影响「谁先定义」，不影响「谁能看见谁」。
 *   · 搬迁做过自动化安全检查：段内引用的标识符**全部自包含**，没有一处依赖
 *     01e 里未随之搬走的顶层变量（漏搬会以 TDZ/undefined 的形式在运行时炸）。
 *   · 回退方式：把本文件内容粘回 01e、并删掉 manifest 里的这一行即可。
 * 函数索引（TOC）：getSfxCtx/ensureSfxResumed/playSound/showFocusQuote/popEl/shakeEl/updateSfxVolume/fxNumPop/fxVibrate/fxVal
 * ============================================================ */

/* =====   UI/动效/声音层（原创实现，未抄袭任何具体音色/动画/插画/文案） ===== */
/* 多级 Web Audio 音效：用 WebAudio 合成清脆的电子音，避免引入 mp3 文件；
   5 种：start（低嘟）/finish（高叮）/reward（双叮咚）/error（短噗）/tap（轻嗒） */
let _sfxCtx = null;
let _sfxLastPlay = 0;
const SFX_COOLDOWN_MS = 60;
/* 别名：调用方历史遗留的三种名字，统一映射到已有音色 */
const SFX_ALIAS = { focusEnd: 'finish', breakEnd: 'reward' }; /* nearEnd 不再借用 tap：它有专属音色 */
/* 关键反馈：不进冷却，避免同一瞬间连发时被前一个音吞掉
   （番茄结束时会同时触发 finish / completeFull / reward） */
const SFX_IMPORTANT = {
  start: 1,
  finish: 1,
  reward: 1,
  error: 1,
  microStart: 1,
  microEnd: 1,
  breakStart: 1,
  taskDone: 1,
  habitDone: 1,
  completeFull: 1,
  nearEnd: 1
};
function getSfxCtx() {
  if (_sfxCtx) return _sfxCtx;
  try {
    _sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    _sfxCtx = null;
  }
  return _sfxCtx;
}
function ensureSfxResumed() {
  const ctx = getSfxCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    try {
      ctx.resume();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:ensureSfxResumed'); }
  }
}
function playSound(type) {
  if (appData.settings.sound) return; /* v5.7.6 全局静音：一键全静（含提示音/滴答/语音） */
  if (appData.settings.sfxEnabled === false) return;
  /* 先归一化别名，冷却/分支都以 _t 为准 */
  const _t = typeof SFX_ALIAS === 'object' && SFX_ALIAS && SFX_ALIAS[type] ? SFX_ALIAS[type] : type;
  const now = Date.now();
  /* 冷却只拦高频轻音（点击音 / 临近结束提示）；开始·完成·休息·打卡·扭蛋等关键反馈不受冷却吞掉 */
  if (!SFX_IMPORTANT[_t] && now - _sfxLastPlay < SFX_COOLDOWN_MS) return;
  _sfxLastPlay = now;
  const ctx = getSfxCtx();
  if (!ctx) return;
  let vol = Number(appData.settings.sfxVolume);
  if (!isFinite(vol)) vol = 0.3; /* 音量被写成 NaN 会让整条链路抛错被 catch 吞掉 => 全部静默，这里兜底 */
  vol = Math.max(0, Math.min(1, vol));
  if (vol <= 0) return;
  try {
    const t0 = ctx.currentTime;
    const tone = function (freq, dur, when, peak) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, when);
      o.connect(g);
      g.connect(ctx.destination);
      const p = peak || vol * 0.4;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(p, when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.start(when);
      o.stop(when + dur + 0.02);
    };
    if (_t === 'start') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(220, t0);
      o.frequency.linearRampToValueAtTime(180, t0 + 0.18);
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol * 0.35, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.start(t0);
      o.stop(t0 + 0.22);
    } else if (_t === 'finish') {
      tone(660, 0.35, t0, vol * 0.35);
      tone(880, 0.3, t0 + 0.04, vol * 0.3);
      tone(1320, 0.2, t0 + 0.08, vol * 0.18);
    } else if (_t === 'reward') {
      tone(660, 0.18, t0, vol * 0.35);
      tone(880, 0.22, t0 + 0.08, vol * 0.3);
    } else if (_t === 'error') {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(200, t0);
      o.frequency.linearRampToValueAtTime(100, t0 + 0.2);
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol * 0.18, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.start(t0);
      o.stop(t0 + 0.24);
    } else if (_t === 'tap') {
      tone(1200, 0.05, t0, vol * 0.18);
    } else if (_t === 'microStart') {
      /* 微休息开始：轻快上行两音，提示可以放松一下
         ★ 2026-10-23 峰值从 0.22/0.20 抬到 0.26/0.24：用户反馈 80% 音量下
         微休息的音几乎听不见。微休息本来就是"轻提醒"，但轻到没有就是 bug。 */
      tone(523, 0.12, t0, vol * 0.26);
      tone(698, 0.14, t0 + 0.06, vol * 0.24);
    } else if (_t === 'microEnd') {
      /* 微休息结束：下行回收，提示回到专注（同样 0.20/0.18 → 0.26/0.24） */
      tone(698, 0.1, t0, vol * 0.26);
      tone(523, 0.14, t0 + 0.05, vol * 0.24);
    } else if (_t === 'breakStart') {
      /* 长休息开始：舒缓下行 */
      tone(587, 0.16, t0, vol * 0.28);
      tone(440, 0.24, t0 + 0.09, vol * 0.24);
    } else if (_t === 'taskDone') {
      /* 计划完成：明亮上行三音 */
      tone(784, 0.12, t0, vol * 0.26);
      tone(988, 0.14, t0 + 0.05, vol * 0.24);
      tone(1319, 0.18, t0 + 0.1, vol * 0.2);
    } else if (_t === 'habitDone') {
      /* 习惯打卡：清脆单音 + 高泛音 */
      tone(1046, 0.1, t0, vol * 0.24);
      tone(1568, 0.14, t0 + 0.05, vol * 0.16);
    } else if (_t === 'completeFull') {
      /* 整番茄完成：比 finish 更轻，叠加时不会太吵 */
      tone(880, 0.16, t0, vol * 0.24);
      tone(1174, 0.2, t0 + 0.06, vol * 0.18);
    } else if (_t === 'nearEnd') {
      /* 最后 1 分钟提醒：两声短促同音，和点击音区分开，且不受冷却吞掉 */
      tone(700, 0.16, t0, vol * 0.26);
      tone(700, 0.16, t0 + 0.24, vol * 0.26);
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01e:playSound'); }
}
/* 计时器引言：简短中文，随机抽取 */
const FOCUS_QUOTES_START = [
  '🍅 此刻，你在这里。',
  '深呼吸。开始就好。',
  '专注是给自己最好的礼物。',
  '时间会奖励坐下来的人。',
  '放下手机，世界是你的。',
  '你不需要更多时间，只需要这一段。',
  '这一颗番茄，只属于眼前的事。',
  '一个开始，就赢了一半。',
  '静下来，慢就是快。',
  '慢慢来，比较快。'
];
const FOCUS_QUOTES_FINISH = [
  '🎉 你做到了。',
  '又一颗番茄落地。',
  '这一段专注，是你的。',
  '好状态会越滚越大。',
  '继续，节奏已经在了。',
  '身体的疲惫会过去，今天的成果留下了。',
  '你又一次选择了认真。',
  '给明天的自己留个好开头。'
];
function showFocusQuote(kind) {
  const arr = kind === 'finish' ? FOCUS_QUOTES_FINISH : FOCUS_QUOTES_START;
  const text = arr[Math.floor(Math.random() * arr.length)];
  const el = document.createElement('div');
  el.className = 'focus-quote';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 3800);
}
function popEl(el) {
  if (!el) return;
  el.classList.remove('btn-pop');
  void el.offsetWidth;
  el.classList.add('btn-pop');
  setTimeout(function () {
    el.classList.remove('btn-pop');
  }, 460);
}
function shakeEl(el) {
  if (!el) return;
  el.classList.remove('toast-shake');
  void el.offsetWidth;
  el.classList.add('toast-shake');
  setTimeout(function () {
    el.classList.remove('toast-shake');
  }, 460);
}
/* 音效音量滑条：实时更新 + 即时试音 */
/* ★ 2026-10-23：_lastSfxVol 原来靠隐式全局（单文件非严格模式能跑），切 ES 模块后
   模块是严格模式，`_lastSfxVol = vol` 直接抛 ReferenceError，一拖滑条就报错。
   改成模块内变量。检查工具：tools/check_implicit_globals.js（已接入 verify）。 */
let _lastSfxVol = null;
function updateSfxVolume(v) {
  const vol = parseFloat(v);
  if (!isFinite(vol)) return;
  appData.settings.sfxVolume = vol;
  const _lb = document.getElementById('sfxVolLabel');
  if (_lb) _lb.textContent = Math.round(vol * 100) + '%';
  /* undefined → 首帧用默认 0.8，避免一打开设置页就试响 */
  if (_lastSfxVol === null) _lastSfxVol = (vol > 0 ? vol : 0.8);
  /* 拖动时试播一下（不重复：仅当值变化超过 0.05） */
  if (Math.abs(vol - _lastSfxVol) >= 0.05 && vol > 0) {
    _lastSfxVol = vol;
    setTimeout(function () {
      playSound('tap');
    }, 10);
  }
}

function fxNumPop(el) {
  /* 数字跳动：给数值元素触发一次"放大-回落"（播放完自动移除 class，防 display 残留） */
  if (!el) return;
  el.classList.remove('fx-pop');
  void el.offsetWidth;
  el.classList.add('fx-pop');
  if (!el.__fxEv) {
    el.__fxEv = true;
    el.addEventListener('animationend', function (ev) {
      if (ev && ev.animationName === 'fx-pop') el.classList.remove('fx-pop');
    });
  }
}
function fxVibrate(ms) {
  /* 触感反馈：仅安卓 Chrome/部分 WebView 支持短暂震动；iOS 自动忽略；失败静默。 */
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms || 30);
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01e:fxVibrate'); }
}
function fxVal(el, v, pre, suf) {
  /* 数字助手：只在数值真正变化时写值并弹一下（防每帧重渲染误弹）；
     元素当前不可见（display:none 视图）时只记值不弹，避免动画残留/切页后补闪。
     pre/suf 为可选前后缀（如 '今日 ' 与 ' 🍅'）。纯展示，不碰数据。 */
  if (!el) return;
  const key = el.getAttribute('data-fx');
  const cur = String(v);
  const t = (pre || '') + cur + (suf || '');
  const visible = !!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length));
  if (key === cur) {
    if (el.textContent !== t) el.textContent = t;
    return;
  }
  el.setAttribute('data-fx', cur);
  el.textContent = t;
  if (visible) fxNumPop(el);
}
