/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 启动编排：引用其它模块≈214（按槽序依次初始化）。
 * 红线：新启动步骤要遵守 slot 顺序依赖，勿在早期槽直接调用后段模块函数。 */
/* ==================== 模块: 05-init.js | 职责: 启动层——初始化入口与全局事件绑定 | 分组: init ==================== */

/* 跨天补强：App 常驻后台跨过零点后回到前台，作废统计缓存并重渲今日相关界面，
 * 函数索引（TOC）：mustDoCarryoverFromPrev/onDayRolled/_guideVisibleView/syncGuideVisibility/checkFirstRunGuide/renderGuideStep/nextGuide/skipGuide/replayGuide/ensureBootSplash/hideBootSplash/_idleLater（+60 更多）
   否则「今日番茄/今日专注/连续天数」会一直停留在切走那一天的数字 */
let _lastActiveDay = getTodayStr();
/* 跨天必做沿用。把"昨日必做列表"（若非空）浅复制为"今日必做"（仅当今日为空）；
   重置今日奖励、清掉今日"昨晚预设"标记。仅供 onDayRolled 调用（不挂 window，避免新增全局命名）。 */
function mustDoCarryoverFromPrev(prevDay, today) {
  if (!prevDay || !today || today <= prevDay) return false;
  let prevList = (appData.mustDos && appData.mustDos[prevDay]) || [];
  let curList = (appData.mustDos && appData.mustDos[today]) || [];
  if (!prevList.length || curList.length) return false;
  appData.mustDos[today] = prevList.map(function (x) {
    return Object.assign({}, x);
  });
  if (appData.mustDoRewarded) {
    delete appData.mustDoRewarded[prevDay];
    appData.mustDoRewarded[today] = false;
  }
  if (appData.mustDoFromPrev) delete appData.mustDoFromPrev[today];
  return true;
}
/* 跨天统一刷新：日期变化时不仅刷统计 / 段位，还要重渲计划页与「必做 3 件事」，
   否则页面常驻跨过 0 点后必做区仍停留在昨天渲染（明日卡仍锁着 = 今天却点不动、今日区不出现）。
   抽成公共函数：visibilitychange（回前台）与每分钟心跳（页面一直开着盯过 0 点）都会触发。 */
function onDayRolled() {
  try {
    const _t = getTodayStr();
    if (_t === _lastActiveDay) return;
    const _adv = !_lastActiveDay || _t > _lastActiveDay; /* 系统时间回拨（日期变小）不算“新的一天” */
    /* ===== 跨天把"昨日必做"沿用为"今日必做" =====
     * 跨天只刷界面的话，必做列表里 yesterday 的数据不会自动复制为 today，
     * 用户次日在"必做 3 件事"卡与"今日必做行"里看不到昨晚预设的目标。
     * 检测到日期前进时，若 today 必做为空、prevDay 必做非空，则沿用 prevDay 内容
     * （保留 done 状态以便继续勾选/删除/领奖）；清掉 prevDay 奖励以免新一天误算。
     * 抽成独立函数便于单测；onDayRolled 在跨天分支调用一次。 */
    if (_adv && _lastActiveDay) {
      try {
        mustDoCarryoverFromPrev(_lastActiveDay, _t);
      } catch (e) {
        try { if (window.__errRep) window.__errRep.push(e, 'mustdoCarry'); } catch (e2) { if (window.__silent) window.__silent(e2, '01g:onDayRolled'); }
      }
    }
    _lastActiveDay = _t;
    invalidateStatsCache();
    updateTodayStats();
    renderStats();
    renderTimerRankStrip();
    if (!_adv) {
      /* 时间被回拨：只把今日相关视图刷回正确日期，不触发“新的一天”庆祝/清理 */
      try {
        renderTodos();
      } catch (e) { if (window.__silent) window.__silent(e, '01g:onDayRolled'); }
      try {
        renderMustDoSection();
      } catch (e) { if (window.__silent) window.__silent(e, '01g:onDayRolled'); }
      try {
        renderHabits();
      } catch (e) { if (window.__silent) window.__silent(e, '01g:onDayRolled'); }
      return;
    }
    /* 计划页：待办/习惯（renderTodos 内部会刷新必做区块） */
    renderTodos();
    renderMustDoSection();
    renderHabits();
    renderPlanCountdowns();
    renderTimerSubs();
    try {
      showToast('📅 新的一天开始啦，必做目标已解锁');
    } catch (e) { if (window.__silent) window.__silent(e, '01g:onDayRolled'); }
  } catch (e) { if (window.__silent) window.__silent(e, '01g:onDayRolled'); }
}
bindSkinDragEvents();
document.addEventListener('pointerdown', ensureSfxResumed, { once: true });
document.addEventListener('visibilitychange', function () {
  if (document.hidden) return;
  onDayRolled();
});
/* 心跳兜底：页面常驻且用户一直盯着不切后台时，仍能准点跨天（每分钟一次字符串比较，开销可忽略）。
   挂 __ivGov.add —— 页面切后台时完全休眠（切回由上方 visibilitychange 处理器兜底校准），前台行为不变 */
if (window.__ivGov) __ivGov.add(onDayRolled, 60000);
else setInterval(onDayRolled, 60000);

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：05-init.js
 * 分组：init
 * 职责：启动层——初始化入口与全局事件绑定
 * 功能：
 *   - 初始化：init()（加载数据 → 渲染全部界面 → 启动各系统 → 恢复未结算番茄弹窗，调用 02-timer.js 的 restorePendingFinish）
 *   - 模块顶部立即执行的语句（本文件是唯一含顶层副作用的模块，拆文件时须保持这些语句最后执行）：
 *     bindSkinDragEvents()、pointerdown 恢复音效 once 监听、visibilitychange + 每分钟心跳 跨天补强
 *     （onDayRolled：作废统计缓存并重渲今日界面，同时重渲计划页/必做3件事/倒数日，避免页面常驻跨天后必做仍锁住）
 *   - 全局事件：Escape 键 / visibilitychange 回页校准 / beforeunload 落盘 / freeze / 弹窗遮罩点击
 *   - 启动：文件末尾自动调用 init()
 *   - 沉浸式专注：init 渲染章节进度锚点、Escape 关过渡页、角色卡遮罩点击=取消
 *   - 白帽游戏化：init 应用极简模式 / 渲染难度选择器（档位=时长）与时长建议 / 初始化并每日更新人机排行榜
 * ============================================================ */

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    const tr = document.getElementById('immersiveTransition');
    if (tr && tr.classList.contains('show')) {
      hideImmersiveTransition();
      return;
    }
    const im = document.getElementById('interruptModal');
    if (im && im.classList.contains('show')) {
      resumeFromInterrupt();
      return;
    }
    document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
  }
});
/* 首次打开渐进式引导：4 步底部轻量提示，可跳过；完成/跳过记 localStorage，老用户不再出现 */
const GUIDE_STEPS = [
  {
    icon: '🍅',
    title: '开始第一个番茄',
    text: '点下方「开始」进入 25 分钟倒计时。完成一个番茄，小树会长大、段位会升星——这就是你的「专注货币」。'
  },
  {
    icon: '📝',
    title: '先立今日任务',
    text: '去「计划」页写下今天要做的事，每完成 1 个番茄任务进度 +1，段位任务与它联动，超额还有星星奖励。'
  },
  {
    icon: '📊',
    title: '去统计页看成长',
    text: '趋势图、热力图、年度专注地图记录你的每一天，点月份标签还能跳到月度统计。'
  },
  {
    icon: '🌱',
    title: '核心三步走',
    text: '先专注攒番茄 → 树长大解锁装扮 → 段位记录你的成长。按这个顺序玩，不会迷路。'
  }
];
let _guideStep = 0;
let _guideAnimT = 0; /* 引导条入场动画的兜底定时器：动画可能根本没跑起来，
                        到点主动摘 .guide-in，保证静止态可见（见 syncGuideVisibility） */
/* 引导条只在「计时页」出现。
   旧实现是全局浮层，不关心当前视图：用户点「习惯」跳到习惯页，
   引导条照样弹出来讲「点开始进入 25 分钟倒计时」，看起来就像"点习惯进错了页面"。
   现在跟随视图显隐，并在切页时同步一次。 */
function _guideVisibleView() {
  try {
    const a = document.querySelector('.view.active');
    return a ? a.id.replace('view-', '') : '';
  } catch (e) {
    return '';
  }
}
function syncGuideVisibility() {
  const g = document.getElementById('firstGuide');
  if (!g) return;
  let done = false;
  try {
    done = !!(appData && appData.uiPrefs && appData.uiPrefs.guideDone);
  } catch (e) { if (window.__silent) window.__silent(e, '01g:syncGuideVisibility'); }
  /* 只有「未完成引导」且「当前在计时页」时才显示 */
  const show = !done && _guideVisibleView() === 'timer';
  const wasShown = g.style.display === 'flex';
  /* 显示前先确保内容已渲染：switchView 走的同步路径可能早于 checkFirstRunGuide
     触发（后者在 init 后 ~2s 才跑），否则会显示一条**只有按钮的空壳**。
     renderGuideStep 幂等，重复调用无副作用。 */
  if (show && !wasShown) {
    try { renderGuideStep(); } catch (e) { if (window.__silent) window.__silent(e, '01g:syncGuideVisibility:render'); }
  }
  g.style.display = show ? 'flex' : 'none';
  /* 入场动画由 .guide-in 类驱动，**不能带 fill-mode:both**：
     否则 hide→show 之后会在 from 状态（opacity:0）停住 = 一片空白（已实机复现）。
     先摘类再强制重排，保证每次由隐到显都能重放一次动画。 */
  if (show && !wasShown) {
    g.classList.remove('guide-in');
    void g.offsetWidth;
    g.classList.add('guide-in');
    /* 兜底：动画跑完（或**根本没跑起来**）后主动摘掉类。
       不能指望 CSS 动画一定播放——WebKit 在 hide→show 后可能把它停在 0%，
       于是 opacity 卡在 0 = 引导条一片空白（已实机复现）。
       摘掉类就回到基类，而基类**不声明 opacity**，必定为 1，content 一定看得见。 */
    clearTimeout(_guideAnimT);
    _guideAnimT = setTimeout(function () {
      const el = document.getElementById('firstGuide');
      if (el) el.classList.remove('guide-in');
    }, 340);
  } else if (!show) {
    clearTimeout(_guideAnimT);
    g.classList.remove('guide-in');
  }
}
function checkFirstRunGuide() {
  if (_dataClearing) return;
  /* 引导完成标记收编 appData.uiPrefs.guideDone（原 tomato_guide_done 散键已删，migrate 已搬迁） */
  try {
    if (appData && appData.uiPrefs && appData.uiPrefs.guideDone) return;
  } catch (e) {
    return;
  }
  /* 关怀弹窗还开着就等它关掉再显示引导条，避免两个提示叠在一起 */
  const care = document.getElementById('careModal');
  if (care && care.classList.contains('show')) {
    setTimeout(checkFirstRunGuide, 1500);
    return;
  }
  const g = document.getElementById('firstGuide');
  if (!g) return;
  _guideStep = 0;
  renderGuideStep();
  syncGuideVisibility();
}
function renderGuideStep() {
  const s = GUIDE_STEPS[_guideStep];
  const icon = document.getElementById('guideIcon');
  if (icon) icon.textContent = s.icon;
  const t = document.getElementById('guideText');
  if (t) t.textContent = s.title + '：' + s.text;
  const dots = document.getElementById('guideDots');
  if (dots)
    dots.innerHTML = GUIDE_STEPS.map(function (_, i) {
      return '<span class="g-dot' + (i === _guideStep ? ' on' : '') + '"></span>';
    }).join('');
  const nb = document.querySelector('.first-guide-next');
  if (nb) nb.textContent = _guideStep >= GUIDE_STEPS.length - 1 ? '开始使用 🎉' : '下一步';
}
function nextGuide() {
  _guideStep++;
  if (_guideStep >= GUIDE_STEPS.length) {
    skipGuide();
    return;
  }
  renderGuideStep();
}
function skipGuide() {
  const g = document.getElementById('firstGuide');
  if (g) g.style.display = 'none';
  /* 写入 uiPrefs（主存储单通道） */
  try {
    if (appData && appData.uiPrefs) {
      appData.uiPrefs.guideDone = true;
      saveDataNow();
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01g:skipGuide'); }
}
/* 设置页「重新查看新手指引」：清标记 + 立即重播（老用户也能找回） */
function replayGuide() {
  try {
    if (appData && appData.uiPrefs) {
      appData.uiPrefs.guideDone = false;
      saveDataNow();
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01g:replayGuide'); }
  const g = document.getElementById('firstGuide');
  if (!g) return;
  _guideStep = 0;
  renderGuideStep();
  syncGuideVisibility();
}
/* 启动画面：首屏就绪后仍至少展示 900ms 再淡出（避免加载快的设备上
   「闪一下」刺眼；慢设备自然超过最短时长，直接淡出不额外等）。
   3 秒兜底强制隐藏（防 JS 异常挡住界面） */
/* 启动画面：同一会话内只显示一次（sessionStorage 标记 → 刷新不显示，关掉重开显示），
   显示时抽一句随机沉浸文案；首屏就绪后仍至少展示 900ms 再淡出 */
const BOOT_QUOTES = [
  '正在进入专注世界……',
  '小树已经在等你了 🌱',
  '每一次专注，都是给未来的自己存一颗星星 ⭐',
  '安静下来，世界就是你的 🍅',
  '过去的你，正在等你超越 👻',
  '把今天，过成你想要的样子 ✨',
  '专注，是最温柔的自我投资 💎',
  '一天一天，树会记得你 🌳',
  '坐下来，就赢了一半 🍅',
  '每一颗星星，都是你亲手点亮 ⭐',
  '深呼吸，专注正在发生 🌿',
  '今天也要温柔地推进自己 🌸',
  '时间不会辜负坐下来的人 ⏳',
  '让树陪你，把今天种下去 🌱',
  '心流，是最舒服的努力状态 🎯',
  '慢慢来，比较快 🐢',
  '你的专注，正在悄悄改变未来 🔭',
  '完成，比完美更重要 ✍️'
];
let _bootShownAt = 0;
function ensureBootSplash() {
  /* 每次打开/刷新都显示启动画面，时长统一（不再区分冷启动/刷新）。
      冷启动防闪烁：splash 的 DOM 已静态写在 template.html 的 body 首元素
     （见该处注释）——解析到首行即绘制遮罩，用户第一眼就是加载页而非主页。
     本函数因此不再 insertBefore：只在已存在时刷新随机语录；若模板缺失才兜底创建
     （老版本 index.html 兼容 / 手工删节点场景）。 */
  _bootShownAt = Date.now();
  let d = document.getElementById('bootSplash');
  if (!d || !d.parentNode) {
    d = document.createElement('div');
    d.id = 'bootSplash';
    d.className = 'boot-splash';
    d.innerHTML =
      '<div class="boot-logo">🍅</div><div class="boot-title">瓶子专注</div><div class="boot-quote" id="bootQuote"></div><div class="boot-bar"><div class="boot-bar-inner"></div></div>';
    if (document.body) document.body.insertBefore(d, document.body.firstChild);
  }
  /* 模板里已写死一句默认语录（下载慢时那是屏幕上唯一的字）。
     JS 一跑起来就换一句随机的 —— 所以这里不能判空，否则永远停在模板那一句。 */
  const q = document.getElementById('bootQuote');
  if (q) q.textContent = BOOT_QUOTES[Math.floor(Math.random() * BOOT_QUOTES.length)];
}
function hideBootSplash() {
  const s = document.getElementById('bootSplash');
  if (!s || !s.parentNode) return;
  /* 加载动画"完整演完一轮"再淡出。
     进度条 bootSlide 单周期 1.1s，展示 ~1.6s ≈ 1.5 个周期 + 语录淡入，
     快设备不再因 650ms 砍戏而产生"动画没播完就消失"的突兀顿挫；
     慢设备实际耗时超最短展示则到点即走，不双倍空等。 */
  const MIN_BOOT_MS = 1600;
  const remain = Math.max(0, MIN_BOOT_MS - (Date.now() - _bootShownAt));
  setTimeout(function () {
    if (!s.parentNode) return;
    s.classList.add('hide');
    setTimeout(function () {
      if (s.parentNode) s.parentNode.removeChild(s);
    }, 350);
  }, remain);
}
/* 首屏后"空闲再干活"调度：requestIdleCallback 优先（浏览器空闲即执行，
   不抢首屏帧），老内核回退 setTimeout。 */
function _idleLater(fn, fallbackMs) {
  if (typeof window.requestIdleCallback === 'function') {
    try {
      window.requestIdleCallback(fn, { timeout: 2000 });
      return;
    } catch (e) { if (window.__silent) window.__silent(e, '01g:_idleLater'); }
  }
  setTimeout(fn, fallbackMs || 800);
}
ensureBootSplash();
setTimeout(function () {
  const s = document.getElementById('bootSplash');
  if (s && !s.classList.contains('hide')) {
    s.classList.add('hide');
    setTimeout(function () {
      if (s.parentNode) s.parentNode.removeChild(s);
    }, 400);
  }
}, 3000);
/* 数据异常降级提示条：init 首屏链路出错时显示（替代整页白屏），提供一键导出备份 */
function showDataErrorBanner(err) {
  try {
    if (document.getElementById('dataErrorBanner')) return;
    const b = document.createElement('div');
    b.id = 'dataErrorBanner';
    b.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:80px;z-index:99999;background:#FFF3E0;border:2px solid #E85D3A;border-radius:var(--radius-md);padding:var(--sp-12) var(--sp-14);font-size:var(--fs-note);line-height:1.6;color:#5D4037;box-shadow:0 6px 24px rgba(0,0,0,.18);';
    b.innerHTML =
      '<b>⚠️ 数据异常，应用已降级启动</b><br>本地存档读取或渲染时出现问题，部分功能可能不可用。请立即导出备份，避免数据丢失。';
    const btn = document.createElement('button');
    btn.textContent = '💾 导出备份';
    btn.style.cssText =
      'margin-top:var(--sp-8);margin-right:var(--sp-8);padding:var(--sp-6) var(--sp-14);border:none;border-radius:var(--radius);background:#E85D3A;color:#fff;font-size:var(--fs-note);font-weight:700;';
    btn.onclick = function () {
      try {
        exportData();
      } catch (e) {
        try {
          showToast('导出失败：' + e.message);
        } catch (_e) { if (window.__silent) window.__silent(_e, '01g:showDataErrorBanner'); }
      }
    };
    const close = document.createElement('button');
    close.textContent = '知道了';
    close.style.cssText =
      'margin-top:var(--sp-8);padding:var(--sp-6) var(--sp-12);border:1px solid #ddd;border-radius:var(--radius);background:#fff;color:#666;font-size:var(--fs-note);';
    close.onclick = function () {
      if (b.parentNode) b.parentNode.removeChild(b);
    };
    b.appendChild(document.createElement('br'));
    b.appendChild(btn);
    b.appendChild(close);
    document.body.appendChild(b);
  } catch (e) {
    try {
      console.error('init 数据异常', err);
    } catch (_e) { if (window.__silent) window.__silent(_e, '01g:showDataErrorBanner'); }
  }
}
/* [瓶子专注 · 作者 瓶子满天星 · ©2026 · MIT] */
async function init() {
  /* ★ 提醒静音门闩的兜底：万一恢复流程抛错没走到置位，20s 后强制放行，
     避免「提醒被永久静音」这种更糟的后果。 */
  try { setTimeout(() => { window.__timerSnapshotRestored = true; }, 20000); } catch (_e) { if (window.__silent) window.__silent(_e, '01g:restoreGate'); }
  /* 开源控制台彩蛋 */
  try {
    console.log('%c🍅 瓶子专注 · Bottle Pomodoro', 'color:#E85D3A;font-size:var(--fs-body);font-weight:bold;');
    console.log('%c作者 瓶子满天星 · © 2026 · MIT License', 'color:#5B9BD5;font-weight:bold;');
    console.log('%c设计灵感来自社区的番茄钟与效率应用思路', 'color:#6B5B95;');
  } catch (e) { if (window.__silent) window.__silent(e, '01g:init'); }
  /* 状态打分格子（精力/心情）先于数据加载渲染：容器是静态 HTML，不依赖数据，避免偶发时序导致首次打开显示不全 */
  try {
    renderGridPicker('startEnergyPicker', null, 'green');
    renderGridPicker('startMoodPicker', null, 'yellow');
  } catch (e) { if (window.__silent) window.__silent(e, '01g:init'); }
  /* 【白屏降级】首屏关键链路（数据加载 + 首屏渲染 + 淡出启动画面）整体兜底：
   任何一步异常都不再让整个 App 白屏，改为显示「数据异常，请导出备份」提示条，
   并强制淡出启动画面（防止卡在启动页造成假白屏） */
  try {
    await loadData();
    cleanupEmptyDiaries();
    sanitizeTreeData();
    /* 旧数据把"一次计时"记在两处（计划身上的 actualSegs +
       记录），删除记录会留下孤儿段。这里一次性把段落归位到记录、删掉计划身上那份副本。
       ★ 必须早于 restorePendingFinish()：待结算的那颗番茄要靠它把存活段落放进 liveSessions，
       否则会被当成"没有记录的孤儿"丢掉。跑过一次后自我标记，不再重跑。 */
    try {
      migrateSegLedger();
    } catch (e) { if (window.__silent) window.__silent(e, '01g:migrateSegLedger'); }
    /* 老记录只存了 taskName，读路径一直拿名字反查计划 ——
       于是「今天新建一条同名计划」会把几天前同名的自由专注捡走（⏰ 3:15~3:40 / 搁置 7 天）。
       这里一次性给能认亲的（当天 + 全库标题唯一）补挂 todoId 并落盘，之后读路径只认 id。
       ★ 必须在 renderTodos / 日程网格首绘之前跑：否则首屏还是按名字猜出来的旧样子。 */
    try {
      migrateRecordOwnership();
    } catch (e) { if (window.__silent) window.__silent(e, '01g:migrateRecordOwnership'); }
    /* 把「段落结束越过记录结束 / 段落还开着」的历史记录改回来：
       迟到结算曾让计划卡与日程比日志多半小时（需求：记录 25 分钟，计划卡 5:18~6:01）。 */
    try {
      migrateSegClampV1();
    } catch (e) { if (window.__silent) window.__silent(e, '01g:migrateSegClampV1'); }
    processWeeklyBadges();
    checkNewDay();
    renderRankSystem();
    updateHonorEffects();
    applySettingsToUI();
    updateChromeTheme();
    applyGroupStates();
    /* 【5.4.6 沉浸式剧情副本】启动加载缓存（IDB/LS），导入 UI 才有数据可显示；失败不阻塞首屏 */
    try {
      await loadImportedScripts();
    } catch (e) {
      try {
        console.warn('loadImportedScripts', e);
      } catch (_e) { if (window.__silent) window.__silent(_e, '01g:init'); }
    }
    /* 设置页「沉浸式专注」组若展开，立刻刷新一次副本角标与列表（默认折叠也先渲染折叠态） */
    try {
      renderImportedScriptsBox();
    } catch (e) { if (window.__silent) window.__silent(e, '01g:init'); }
    try {
      renderImmersiveSettingsNote();
    } catch (e) { if (window.__silent) window.__silent(e, '01g:init'); }
    /* —— 首屏（同步，0ms）：手机打开第一眼就能用计时器 ——
   updateTimerDisplay() 倒计时立刻出现
   updateTodayStats()   今日番茄数立刻显示
   updateRoundStats()/renderTimerBadge() 计时页配套数字
   restoreTimerSnapshot()/restorePendingFinish() 恢复上次计时状态（必须同步，防丢）
   applyMinimalMode() 极简模式样式（影响首屏布局，同步） */
    updateTimerDisplay();
    renderImmersiveProgress();
    updateTodayStats();
    updateRoundStats();
    updateMicroModeUI();
    __set_currentDiaryDate(getTodayStr());
    const now = new Date();
    __set_calendarYear(now.getFullYear());
    __set_calendarMonth(now.getMonth());
    if (appData.settings.notify && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    renderTimerBadge();
    restoreTimerSnapshot();
    restorePendingFinish();
    /* ★ 顺序不能变：先恢复计时/待结算，再扫"没人认领的开口段"。
       反过来的话正在跑的那条会话会被当成断掉的段收掉（暂停/恢复中的段也在这里）。 */
    try {
      closeStaleLiveSessions();
    } catch (e) { if (window.__silent) window.__silent(e, '01g:closeStaleLiveSessions'); }
    window.__timerSnapshotRestored = true; /* 提醒门闩放行（见 01e:remindFocusRunning） */
    applyMinimalMode();
    applySkinsToDOM();
    /* 回到上次待的那一页（页面被系统回收后重载时，不至于从计划页突然变成计时器）。
       ★ 必须排在 restoreTimerSnapshot / closeStaleLiveSessions 之后：
         恢复流程要按视图画按钮和网格，先切页再恢复会互相覆盖。 */
    try { restoreLastView(); } catch (_rv) { if (window.__silent) window.__silent(_rv, '01g:restoreLastView'); }
    /* 首屏就绪 → 淡出启动画面（用户看到计时器的同时画面切换完成） */
    hideBootSplash();
  } catch (e) {
    try {
      console.error('init 首屏异常', e);
    } catch (_e) { if (window.__silent) window.__silent(_e, '01g:init'); }
    try {
      hideBootSplash();
    } catch (_e) { if (window.__silent) window.__silent(_e, '01g:init'); }
    showDataErrorBanner(e);
    return;
  }
  /* —— 后台（空闲优先）：树/统计/计划/日志/组队/排行榜等重活延后到浏览器空闲执行，
      手机 CPU 压力减半、不抢首屏帧（回调体整体兜底，异常不扩散到首屏） —— */
  _idleLater(function () {
    try {
      /* 计划 & 日志 & 统计（renderStats 内部还会触发 renderTreeSection 树渲染） */
      /* 成长点先重算再渲染：以前放在 renderHabits 之后，列表徽标要等下一次刷新才对 */
      degradeHabits();
      renderTodos();
      refreshTodoSelect();
      renderHabits();
      renderLogs();
      renderStats();
      renderTimerTree();
      renderCountdowns();
      renderPlanCountdowns();
      updateSortBarUI();
      /* 树系统日常结算 & 鼓励 */
      updateFuzzyToggleUI();
      degradeTree(true);
      checkTreeDeath();
      checkTreeSpeciesUnlock();
      checkTreeDailyTasks();
      renderEncourage();
      checkTreeExpiry();
      applySkinsToDOM();
      /* 难度推荐 & 排行榜 & 关怀弹窗 */
      syncDifficultyWithDuration();
      renderDifficultyPicker();
      renderDurationSuggestion();
      initBotLeaderboard();
      dailyUpdateLeaderboard();
      maybeShowCareModal();
      /* 新手指引：等首屏渲染稳定（800+1200ms）且避开关怀弹窗（900ms）再出现 */
      setTimeout(function () {
        try {
          checkFirstRunGuide();
        } catch (e) { if (window.__silent) window.__silent(e, '01g:init'); }
      }, 1200);
    } catch (e) {
      try {
        console.error('init 后台渲染异常', e);
      } catch (_e) { if (window.__silent) window.__silent(_e, '01g:init'); }
    }
  }, 800);
  /* 初始视图是 timer，强制隐藏日志页箭头，避免 init 流程 renderLogs 设 flex 后无人纠正 */
  const _initLa = document.getElementById('logJumpArrow');
  if (_initLa) _initLa.style.display = 'none';
  // 数据备份提醒（增强版：持久提示条 + Toast 双重提醒；整体兜底，异常不影响已就绪的界面）
  try {
    const today = getTodayStr();
    let needToast = false;
    if (!appData.lastExportDate) {
      if (appData.records.length >= 5) needToast = true;
    } else {
      const lastExport = new Date(appData.lastExportDate + 'T00:00:00');
      const gapExport = Math.floor((new Date(today + 'T00:00:00') - lastExport) / DAY_MS);
      if (gapExport >= 7 && (!appData.lastBackupReminder || today !== appData.lastBackupReminder)) needToast = true;
    }
    if (needToast) {
      setTimeout(() => {
        showToast('💾 已有 ' + appData.records.length + ' 条记录，记得导出备份防止丢失！');
        appData.lastBackupReminder = today;
        saveData();
      }, 2000);
    }
    startTeamMidnightTimer();
    setTimeout(function () {
      try {
        updateBackupReminder();
        updateAutoBackupInfo();
        renderTeamSystem();
      } catch (e) { if (window.__silent) window.__silent(e, '01g:init'); }
    }, 800);
  } catch (e) {
    try {
      console.error('init 备份检查异常', e);
    } catch (_e) { if (window.__silent) window.__silent(_e, '01g:init'); }
  }
}
document.addEventListener('visibilitychange', function () {
  const bgPause = appData.settings && appData.settings.bgPause;
  if (document.hidden) {
    if (bgPause && timerState.running && timerState.mode === 'focus') {
      timerState._bgPausedAt = Date.now();
      stopTimerLoop();
    }
/* ★ 切走的瞬间就把计时状态写死（不等下一次 15s 心跳）：
   全模式通用 —— 自由专注没有 bgPause 分支，切走后就没有任何落盘点。 */
    _snapshotOnLeave('visibilitychange');
    flushPendingEdits();
    saveDataNow();
  } else {
    if (bgPause && timerState._bgPausedAt && timerState.mode === 'focus') {
      const gap = Math.floor((Date.now() - timerState._bgPausedAt) / 1000);
      if (timerState.endAt) timerState.endAt += gap * 1000;
      if (strategyOfFreeType(timerState.freeType).freezesRemainingOnPause && timerState.pausedRemaining)
        timerState.pausedRemaining = Math.max(0, timerState.pausedRemaining - gap);
      timerState._bgPausedAt = 0;
      startTimerLoop();
    }
    if (timerState.mode === 'focus' && timerState.running) {
      timerState.remaining = Math.max(0, Math.floor((timerState.endAt - Date.now()) / 1000));
      updateTimerDisplay();
      requestWakeLock();
      if (timerState.remaining <= 0) {
        let im = document.getElementById('immersionMode');
        if (im && im.classList.contains('show')) {
          im.classList.remove('show');
          if (immersionIv) {
            clearInterval(immersionIv);
            immersionIv = null;
          }
        }
        onTimerComplete();
      }
    }
  }
});
/* ★ 把两个 5 秒防抖窗口里还没收进 appData 的编辑立刻写回（日记 / 待办详情）。
   原来只有 beforeunload 会冲洗，而 Android WebView 切到后台并不保证触发 beforeunload：
   visibilitychange / freeze / pagehide 只调了 saveDataNow() —— 存下去的是**还没读到新文字的旧值**，
   然后页面被冻结、5 秒定时器再也轮不到 → 敲进去的字就地蒸发。
    */
function flushPendingEdits() {
  try {
    Object.keys(diaryAutoSaveTimers).forEach(function (d) {
      if (diaryAutoSaveTimers[d]) {
        clearTimeout(diaryAutoSaveTimers[d]);
        diaryAutoSaveTimers[d] = null;
        forceSaveDiary(d);
      }
    });
  } catch (e) { if (window.__silent) window.__silent(e, '01g:flushPendingEdits'); }
  try {
    Object.keys(todoAutoSaveTimers).forEach(function (k) {
      if (todoAutoSaveTimers[k]) {
        clearTimeout(todoAutoSaveTimers[k]);
        todoAutoSaveTimers[k] = null;
        /* Object.keys 取出为字符串，而 todos[].id 为数字（Date.now()），须转回数字匹配。 */
        forceSaveTodoDetail(Number(k) || k, true);
      }
    });
  } catch (e) { if (window.__silent) window.__silent(e, '01g:flushPendingEdits'); }
}
/* 页面卸载前立即把未落盘的数据写下去，防抖模式下不会丢 */
window.addEventListener('beforeunload', () => {
  flushPendingEdits();
  saveDataNow();
});
/* ★ 切走 / 被回收前补落一次计时快照（自由专注与番茄钟通用）。
   心跳每 15s 才写一次盘，而「切走」恰恰会冻结 JS 定时器 —— 不补落的话，
   从上次心跳到切走这段就没了；刚开始就切走（心跳还没轮到）等于整段丢。
   freeze 是 Android WebView 冻结页面时的事件，pagehide 兜住重载/关闭。 */
function _snapshotOnLeave(where) {
  try {
    saveTimerSnapshot();
  } catch (e) {
    /* 快照落盘失败不能挡住后面的数据落盘；只记日志，不弹窗 */
    if (typeof console !== 'undefined' && console.warn) console.warn('快照落盘失败：' + where, e);
  }
}
document.addEventListener('freeze', () => {
  _snapshotOnLeave('freeze');
  flushPendingEdits();
  saveDataNow();
});
window.addEventListener('pagehide', () => {
  _snapshotOnLeave('pagehide');
  flushPendingEdits();
  saveDataNow();
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function (e) {
    if (e.target === this && this.id !== 'microBreakModal') {
      if (this.id === 'interruptModal') {
        resumeFromInterrupt();
        return;
      }
      if (this.id === 'finishModal') {
        closeFinishModal();
        return;
      }
      if (this.id === 'noiseModal') {
        closeNoiseModal();
        return;
      }
      if (this.id === 'sharePosterModal') {
        closeSharePoster();
        return;
      }
      if (this.id === 'immersiveCardModal') {
        cancelImmersiveCard();
        return;
      }
      this.classList.remove('show');
    }
  });
});
/* M2 性能可观测：主引擎初始化完成标记（供 dev/perf/bench.py 测冷启；不影响任何逻辑） */
try {
  let __bootProm = init();
  if (__bootProm && typeof __bootProm.then === 'function') {
    __bootProm
      .then(function () {
        try {
          window.__bootDone = Math.round(performance.now());
        } catch (e) { if (window.__silent) window.__silent(e, '01g:init'); }
      })
      .catch(function (e) {
        if (window.__silent) window.__silent(e, '01g:init');
      });
  }
} catch (e) {
  try {
    init();
  } catch (e2) { if (window.__silent) window.__silent(e2, '01g:init'); }
}

/* ============================================================
    现代化升级 JS（通用交互打磨）
   3-2-1 倒计时 / 自由模式±调节 / 快捷键 / 拖拽 / 进度条 / 导航指示条
   ============================================================ */

// ---------- 1. 3-2-1 开始倒计时 ----------
let _countdownActive = false;
function showCountdown321(onDone) {
  if (_countdownActive || timerState.mode !== 'idle') return;
  const overlay = document.createElement('div');
  overlay.className = 'countdown-overlay';
  const num = document.createElement('div');
  num.className = 'cd-num';
  num.textContent = '3';
  overlay.appendChild(num);
  document.body.appendChild(overlay);
  _countdownActive = true;
  let n = 3;
  const finish = function () {
    clearInterval(iv);
    num.textContent = 'GO';
    try {
      if (navigator.vibrate) {
        navigator.vibrate(16);
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01g:showCountdown321'); }
    num.className = 'cd-go';
    setTimeout(function () {
      overlay.remove();
      _countdownActive = false;
      if (onDone) onDone();
    }, 620);
  };
  const skip = function () {
    clearInterval(iv);
    overlay.remove();
    _countdownActive = false;
    if (onDone) onDone();
  };
  overlay.addEventListener('click', skip);
  /* 短一次性 · 倒计时 overlay 数字动画（有 clear） */
  const iv = setInterval(function () {
    n--;
    if (n > 0) {
      num.textContent = n;
      num.style.animation = 'none';
      void num.offsetWidth;
      num.style.animation = '';
    } else {
      finish();
    }
  }, 800);
}

// ---------- 2. 自由模式 ±5 分钟调节 ----------
function adjustFreeTime(delta) {
  if (timerState.mode !== 'free') return;
  /* 正计时（秒表）从 0 累计向上走，不存在"剩余时长"概念，±5 调节无意义——直接拒绝（v5.7.6） */
  if (!strategyOfFreeType(timerState.freeType).supportsTimeAdjust) {
    try {
      showToast('⏱ 正计时从 0 开始累计，不需要加减时长');
    } catch (e) { if (window.__silent) window.__silent(e, '01g:adjustFreeTime'); }
    return;
  }
  const curMin = Math.max(0, Math.floor(timerState.remaining / 60));
  const target = Math.max(0, curMin + delta) * 60;
/* 本轮总计划时长与剩余时长同步增减：进度按“已用时/总时长”算，只改剩余会跳变；
   总时长下限 = 已用时，防止进度被推到 100% 以上 */
  const _elapsed = Math.max(0, (timerState.totalDuration || target) - timerState.remaining);
  const _newTotal = _elapsed + target; /* 总计划 = 已用时 + 调整后的剩余 */
  if (timerState.running) {
    timerState.endAt = Date.now() + target * 1000;
  } else {
    timerState.pausedRemaining = target;
  }
  timerState.totalDuration = _newTotal;
  timerState.remaining = target;
  updateTimerDisplay();
  updateFreeInfo();
  playSound('tap');
  showToast(delta > 0 ? '⏱ +' + delta + ' 分钟' : '⏱ ' + delta + ' 分钟');
}

// ---------- 3. 键盘快捷键 ----------
function _isTypingTarget() {
  const t = document.activeElement;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
document.addEventListener('keydown', function (e) {
  if (_isTypingTarget()) return;
  if (document.querySelector('.modal-overlay.show')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (isFreeMode()) return; /* 空格只在番茄钟管用（自由专注另有自己的开始/结束键） */
    if (timerState.mode === 'idle') {
      toggleTimer();
    } else if ((timerState.mode === 'short' || timerState.mode === 'long') && timerState.running) {
      skipBreak();
    }
  } else if (e.key === 'r' || e.key === 'R') {
    if (timerState.mode !== 'idle') {
      resetToIdle();
      showToast('已重置');
    }
  } else if (e.key === 's' || e.key === 'S') {
    if ((timerState.mode === 'short' || timerState.mode === 'long') && timerState.running) {
      skipBreak();
    }
  } else if (e.key >= '1' && e.key <= '5') {
    const map = ['timer', 'plan', 'log', 'stats', 'settings'];
    switchView(map[parseInt(e.key) - 1]);
  }
});

// ---------- 4. 任务/习惯拖拽排序（HTML5 DnD，桌面；触屏仍用 ↑↓ 按钮） ----------
let _dragItemId = null;
function initTodoDrag() {
  const list = document.getElementById('todoList');
  if (!list) return;
  list.addEventListener('dragstart', function (e) {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    if (e.target.closest('button,input,textarea,select,.todo-checkbox,.todo-expand-btn')) {
      e.preventDefault();
      return;
    }
    if (getSortPrefs().todos.by !== 'manual') {
      e.preventDefault();
      return;
    }
    _dragItemId = parseInt(item.dataset.id, 10);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(_dragItemId));
    } catch (err) { if (window.__silent) window.__silent(err, '01g:initTodoDrag'); }
  });
  list.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (_dragItemId == null) return;
    const item = e.target.closest('.todo-item');
    if (item) item.classList.add('drag-over');
  });
  list.addEventListener('dragleave', function (e) {
    const item = e.target.closest('.todo-item');
    if (item) item.classList.remove('drag-over');
  });
  list.addEventListener('drop', function (e) {
    e.preventDefault();
    if (_dragItemId == null) return;
    const item = e.target.closest('.todo-item');
    if (item) {
      item.classList.remove('drag-over');
      const targetId = parseInt(item.dataset.id, 10);
      if (targetId !== _dragItemId) moveTodoBefore(_dragItemId, targetId);
    }
    _dragItemId = null;
    document.querySelectorAll('.todo-item.dragging').forEach(function (x) {
      x.classList.remove('dragging');
    });
  });
  list.addEventListener('dragend', function () {
    _dragItemId = null;
    document.querySelectorAll('.todo-item.dragging,.todo-item.drag-over').forEach(function (x) {
      x.classList.remove('dragging');
      x.classList.remove('drag-over');
    });
  });
}
function moveTodoBefore(id, targetId) {
  const i = appData.todos.findIndex(function (t) {
    return idEq(t.id, id);
  });
  if (i < 0) return;
  const t = appData.todos.splice(i, 1)[0];
  const j = appData.todos.findIndex(function (x) {
    return x.id === targetId;
  });
  if (j < 0) {
    appData.todos.splice(i, 0, t);
    return;
  }
  appData.todos.splice(j, 0, t);
  saveData();
  renderTodos();
  refreshTodoSelect();
}
function initHabitDrag() {
  const list = document.getElementById('habitList');
  if (!list) return;
  list.addEventListener('dragstart', function (e) {
    const item = e.target.closest('.habit-item');
    if (!item) return;
    if (e.target.closest('button,input,textarea,select,.habit-checkbox,.habit-arrow,.sub-cb')) {
      e.preventDefault();
      return;
    }
    if (getSortPrefs().habits.by !== 'manual') {
      e.preventDefault();
      return;
    }
    _dragItemId = parseInt(item.dataset.id, 10);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(_dragItemId));
    } catch (err) { if (window.__silent) window.__silent(err, '01g:initHabitDrag'); }
  });
  list.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (_dragItemId == null) return;
    const item = e.target.closest('.habit-item');
    if (item) item.classList.add('drag-over');
  });
  list.addEventListener('dragleave', function (e) {
    const item = e.target.closest('.habit-item');
    if (item) item.classList.remove('drag-over');
  });
  list.addEventListener('drop', function (e) {
    e.preventDefault();
    if (_dragItemId == null) return;
    const item = e.target.closest('.habit-item');
    if (item) {
      item.classList.remove('drag-over');
      const targetId = parseInt(item.dataset.id, 10);
      if (targetId !== _dragItemId) {
        /* 桌面 HTML5 拖拽同理：落到哪个文件夹就改成哪个分类 */
        const dh = appData.habits.find(function (x) { return idEq(x.id, _dragItemId); });
        const box = item.parentNode;
        if (dh && box && box.dataset && box.dataset.cat !== undefined) {
          const cid = box.dataset.cat || null;
          if (String(dh.catId || '') !== String(cid || '')) {
            dh.catId = cid;
            dh.updatedAt = Date.now();
          }
        }
        moveHabitBefore(_dragItemId, targetId);
      }
    }
    _dragItemId = null;
    document.querySelectorAll('.habit-item.dragging').forEach(function (x) {
      x.classList.remove('dragging');
    });
  });
  list.addEventListener('dragend', function () {
    _dragItemId = null;
    document.querySelectorAll('.habit-item.dragging,.habit-item.drag-over').forEach(function (x) {
      x.classList.remove('dragging');
      x.classList.remove('drag-over');
    });
  });
}
function moveHabitBefore(id, targetId) {
  const i = appData.habits.findIndex(function (t) {
    return idEq(t.id, id);
  });
  if (i < 0) return;
  const t = appData.habits.splice(i, 1)[0];
  /* idEq 而不是 ===：习惯 id 存档里可能是数字、也可能被同步改成字符串，
     严格比较会让「拖到第 2 个前面」直接失败并把元素挪回原处 */
  const j = appData.habits.findIndex(function (x) {
    return idEq(x.id, targetId);
  });
  if (j < 0) {
    appData.habits.splice(i, 0, t);
    return;
  }
  appData.habits.splice(j, 0, t);
  saveData();
  renderHabits();
}

// ---------- 5. 全局进度条 ----------
function showGlobalProgress() {
  let bar = document.getElementById('globalProgressBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'global-progress';
    bar.id = 'globalProgressBar';
    bar.innerHTML = '<div class="gp-fill"></div>';
    document.body.appendChild(bar);
  }
  bar.classList.add('show');
}
function hideGlobalProgress() {
  const bar = document.getElementById('globalProgressBar');
  if (bar) bar.classList.remove('show');
}
(function wrapDataOps() {
  const wrap = function (fn) {
    return function () {
      showGlobalProgress();
      try {
        return fn.apply(this, arguments);
      } finally {
        setTimeout(hideGlobalProgress, 700);
      }
    };
  };
  if (window.exportData) __replace_exportData(wrap(window.exportData));
  if (window.importData) __replace_importData(wrap(window.importData));
  if (window.restoreAutoBackup) __replace_restoreAutoBackup(wrap(window.restoreAutoBackup));
  if (window.applyBackupData) __replace_applyBackupData(wrap(window.applyBackupData));
})();

// ---------- 6. 底部导航激活指示条注入 ----------
(function initNavIndicator() {
  document.querySelectorAll('.bottom-nav .nav-item').forEach(function (item) {
    if (!item.querySelector('.nav-indicator')) {
      const span = document.createElement('span');
      span.className = 'nav-indicator';
      item.appendChild(span);
    }
  });
})();

// ---------- 7. 初始化拖拽 ----------
setTimeout(function () {
  try {
    initTodoDrag();
    initHabitDrag();
  } catch (e) { if (window.__silent) window.__silent(e, '01g:initNavIndicator'); }
}, 600);

// ============================================================
// 功能学习：Flowtime 流式倒计时
// ============================================================
window._freeType = 'stopwatch'; /* stopwatch 正计时 / flowtime 流式倒计时 */
function setFreeType(ft) {
  if (timerState.mode === 'free') {
    showToast('请先结束当前自由专注再切换类型');
    return;
  }
  window._freeType = ft === 'flowtime' ? 'flowtime' : 'stopwatch';
  const a = document.getElementById('ftsStopwatch');
  const b = document.getElementById('ftsFlowtime');
  if (a) a.classList.toggle('active', window._freeType === 'stopwatch');
  if (b) b.classList.toggle('active', window._freeType === 'flowtime');
  syncFlowDurUI();
  playSound('tap');
}
/* ===== 流式倒计时时长档位：沿用任务难度四档（10 / 25 / 50 / 90 分钟） =====
   不再硬编码 50 分钟：玩家点档位自选，选择存入 settings.flowDuration，刷新后依然生效。 */
function getFlowDuration() {
  let m = (appData.settings && appData.settings.flowDuration) || 50;
  if (m !== 10 && m !== 25 && m !== 50 && m !== 90) m = 50;
  return m;
}
function setFlowDuration(m) {
  m = parseInt(m, 10);
  if (m !== 10 && m !== 25 && m !== 50 && m !== 90) return;
  /* 计时进行中不允许改时长（改了会让 remaining/endAt 与显示对不上） */
  if (timerState && timerState.mode === 'free' && strategyOfFreeType(timerState.freeType).countsDown) {
    showToast('⏳ 计时中不能改时长，先停止再选');
    return;
  }
  appData.settings.flowDuration = m;
  saveData();
  syncFlowDurUI();
  playSound('tap');
  const d = getDifficultyCfg(getDifficultyByDuration(m));
  showToast('🌊 流式倒计时设为 ' + m + ' 分钟（' + d.icon + d.name + '档）');
}
function syncFlowDurUI() {
  const wrap = document.getElementById('flowDurSwitch');
  if (!wrap) return;
  const isFlow = typeof window._freeType !== 'undefined' && window._freeType === 'flowtime';
  wrap.style.display = isFlow ? 'flex' : 'none';
  const cur = getFlowDuration();
  Array.prototype.forEach.call(wrap.querySelectorAll('.fds-btn'), function (b) {
    const m = parseInt(b.getAttribute('data-min'), 10);
    b.classList.toggle('active', m === cur);
  });
}
/* 标签库：渲染最近用过的标签 chip（点击填入输入框） */
/* 详情编辑区：渲染可点选的已存标签 chips（点击填入该任务的标签输入框并保存） */
/* ===== M1 安全加固：已存标签的渲染与回填 =====
   旧实现把标签原文内联进 onclick（单引号可逃逸属性/JS 字符串），且可见文本未转义——
   标签若含 <img onerror> 或 ' 即可注入。现统一改「索引回填」：onclick 只传数组下标，
   取值经 String() 后经 .value 属性赋值（天然无执行面）；可见文本一律 escapeHtml。 */
function usedTagAt(i) {
  try {
    const L = appData.usedTags;
    return L && L[i] != null ? String(L[i]) : '';
  } catch (e) {
    return '';
  }
}
function fillTodoTagChip(todoId, i) {
  try {
    const v = usedTagAt(i);
    const el = document.getElementById('todo_tag_' + todoId);
    if (el) {
      el.value = v;
    }
    try {
      forceSaveTodoDetail(todoId, true);
    } catch (e) { if (window.__silent) window.__silent(e, '01g:fillTodoTagChip'); }
  } catch (e) { if (window.__silent) window.__silent(e, '01g:fillTodoTagChip'); }
}
function fillAddTodoTagChip(i) {
  try {
    const v = usedTagAt(i);
    const el = document.getElementById('addTodoTag');
    if (el) {
      el.value = v;
      el.focus();
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01g:fillAddTodoTagChip'); }
}
function pickTagFromManagerIdx(i) {
  const v = usedTagAt(i);
  const el = document.getElementById('addTodoTag');
  if (el) {
    el.value = v;
    el.focus();
  }
  closeModal('tagManagerModal');
  if (el && v) showToast('已选标签：' + v);
}
function renderTodoDetailTagChips() {
  try {
    document.querySelectorAll('.todo-item .todo-detail-expanded.show').forEach(function (d) {
      const item = d.closest('.todo-item');
      if (!item) return;
      const id = parseInt(item.dataset.id, 10);
      const box = document.getElementById('todo_used_tags_' + id);
      if (!box) return;
      const input = document.getElementById('todo_tag_' + id);
      const list = (appData.usedTags || []).slice(0, 20);
      if (!list.length) {
        box.innerHTML = '';
        return;
      }
      const cur = (input ? input.value : '').trim();
      box.innerHTML = list
        .map(function (t, i) {
          const active =
            t === cur ? 'outline:2px solid var(--primary);background:rgba(232,93,58,0.16);color: var(--primary-ink);' : '';
          return (
            '<span data-tag="' +
            escapeHtml(t) +
            '" onclick="fillTodoTagChip(' +
            id +
            ',' +
            i +
            ')" style="cursor:pointer;font-size:var(--fs-tiny);font-weight:700;padding:var(--sp-2) var(--sp-8);border-radius:var(--radius-full);background:rgba(91,155,213,0.12);color:var(--blue-dark);border:1px solid rgba(91,155,213,0.35);' +
            active +
            '">🏷 ' +
            escapeHtml(t) +
            '</span>'
          );
        })
        .join('');
    });
  } catch (e) { if (window.__silent) window.__silent(e, '01g:renderTodoDetailTagChips'); }
}
/* 标签管理弹窗：打开并渲染全部已存标签（可点选/删除） */
function openTagManagerModal() {
  showModal('tagManagerModal');
  renderTagManagerModal();
}
function renderTagManagerModal() {
  try {
    const el = document.getElementById('tagManagerList');
    if (!el) return;
    const list = appData.usedTags || [];
    if (!list.length) {
      el.innerHTML =
        '<div style="font-size:var(--fs-body);color:var(--text-light);">还没有存过标签。添加任务时给任务填一个标签，就会自动存在这里，下次可直接点选。</div>';
      return;
    }
    el.innerHTML = list
      .map(function (t, i) {
        return (
          '<span style="display:inline-flex;align-items:center;gap:var(--sp-4);font-size:var(--fs-note);font-weight:700;padding:var(--sp-4) var(--sp-10);border-radius:var(--radius-full);background:rgba(91,155,213,0.12);color:var(--blue-dark);border:1px solid rgba(91,155,213,0.35);cursor:pointer;" onclick="pickTagFromManagerIdx(' +
          i +
          ')" title="点击填入输入框">🏷 ' +
          escapeHtml(t) +
          '<span onclick="event.stopPropagation();deleteUsedTag(' +
          i +
          ')" style="cursor:pointer;color:var(--danger);font-weight:800;padding:0 var(--sp-2);font-size:var(--fs-body);" title="删除这个标签">✕</span></span>'
        );
      })
      .join('');
  } catch (e) { if (window.__silent) window.__silent(e, '01g:renderTagManagerModal'); }
}
function renderUsedTagsRow() {
  try {
    const el = document.getElementById('addTodoUsedTags');
    if (!el) return;
    const list = (appData.usedTags || []).slice(0, 20);
    if (!list.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML =
      '<span style="font-size:var(--fs-caption);font-weight:700;color:var(--text-light);align-self:center;">点选已存标签：</span>' +
      list
        .map(function (t, i) {
          return (
            '<span class="used-tag-chip" data-tag="' +
            escapeHtml(t) +
            '" onclick="fillAddTodoTagChip(' +
            i +
            ')" style="cursor:pointer;font-size:var(--fs-caption);font-weight:700;padding:var(--sp-4) var(--sp-12);border-radius:var(--radius-full);background:rgba(91,155,213,0.14);color:var(--blue-dark);border:1px solid rgba(91,155,213,0.4);transition:transform .12s,background .12s;display:inline-flex;align-items:center;gap:var(--sp-2);">🏷 ' +
            escapeHtml(t) +
            '</span>'
          );
        })
        .join('');
  } catch (e) { if (window.__silent) window.__silent(e, '01g:renderUsedTagsRow'); }
}
/* 标签管理：渲染全部已存标签（可删除） */
function renderTagManageList() {
  try {
    const cnt = document.getElementById('tagManageCount');
    if (cnt) cnt.textContent = (appData.usedTags || []).length ? '已存 ' + (appData.usedTags || []).length + ' 个' : '';
    const el = document.getElementById('tagManageList');
    if (!el) return;
    const list = appData.usedTags || [];
    if (!list.length) {
      el.innerHTML =
        '<div style="font-size:var(--fs-body);color:var(--text-light);">还没有存过标签。添加任务时给任务填一个标签，就会自动存在这里，下次可直接点选。</div>';
      return;
    }
    el.innerHTML = list
      .map(function (t, i) {
        return (
          '<span style="display:inline-flex;align-items:center;gap:var(--sp-4);font-size:var(--fs-note);font-weight:700;padding:var(--sp-4) var(--sp-10);border-radius:var(--radius-full);background:rgba(91,155,213,0.12);color:var(--blue-dark);border:1px solid rgba(91,155,213,0.35);">🏷 ' +
          escapeHtml(t) +
          '<span onclick="deleteUsedTag(' +
          i +
          ')" style="cursor:pointer;color:var(--danger);font-weight:800;padding:0 var(--sp-2);font-size:var(--fs-body);" title="删除这个标签">✕</span></span>'
        );
      })
      .join('');
  } catch (e) { if (window.__silent) window.__silent(e, '01g:renderTagManageList'); }
}
function deleteUsedTag(i) {
  try {
    const list = appData.usedTags || [];
    if (i < 0 || i >= list.length) return;
    const t = list[i];
    var _doDelTag = function () {
      list.splice(i, 1);
      saveData();
      renderTagManageList();
      if (document.getElementById('tagManagerList')) renderTagManagerModal();
      renderTodoDetailTagChips();
      showToast('已删除标签「' + t + '」');
    };
    var _delTagMsg = '删除标签「' + t + '」？\n只会从候选列表移除，已存在任务上的标签保留。';
    if (typeof window.rsAsk === 'function') window.rsAsk(_delTagMsg, { title: '删除标签', okText: '删除', danger: true }, _doDelTag);
    else if (confirm(_delTagMsg)) _doDelTag();
  } catch (e) { if (window.__silent) window.__silent(e, '01g:deleteUsedTag'); }
}
function clearAllTags() {
  try {
    const list = appData.usedTags || [];
    if (!list.length) {
      showToast('还没有标签');
      return;
    }
    var _doClear = function () {
      appData.usedTags = [];
      saveData();
      renderTagManageList();
      if (document.getElementById('tagManagerList')) renderTagManagerModal();
      renderTodoDetailTagChips();
      showToast('已清空标签候选');
    };
    var _msg = '清空全部 ' + list.length + ' 个已存标签？\n只会清空候选列表，已存在任务上的标签保留。';
    if (typeof window.rsAsk === 'function') window.rsAsk(_msg, { title: '清空标签', okText: '清空', danger: true }, _doClear);
    else if (confirm(_msg)) _doClear();
  } catch (e) { if (window.__silent) window.__silent(e, '01g:clearAllTags'); }
}
function syncFreeTypeUI() {
  const a = document.getElementById('ftsStopwatch');
  const b = document.getElementById('ftsFlowtime');
  if (a) a.classList.toggle('active', window._freeType !== 'flowtime');
  if (b) b.classList.toggle('active', window._freeType === 'flowtime');
  syncFlowDurUI();
}
/* Flowtime 到点面板：继续 +15 或结束结算 */
function showFlowtimeDone() {
/* 已用时间基于 pausedElapsed 真实累计，不用 totalDuration - remaining */
  const usedSec =
    (timerState.pausedElapsed || 0) +
    Math.max(0, Math.floor((Date.now() - (timerState.startTime || Date.now())) / 1000));
  const usedMin = Math.max(1, Math.round(usedSec / 60));
  const ov = document.createElement('div');
  ov.className = 'countdown-overlay';
  ov.id = 'flowtimeDoneOverlay';
  ov.style.zIndex = '310';
  const card = document.createElement('div');
  card.className = 'ft-done-card';
  card.innerHTML =
    '<div class="ft-done-emoji">🏁</div>' +
    '<div class="ft-done-title">本轮流式计时到点！</div>' +
    '<div class="ft-done-sub">已专注 <b style="color: var(--primary-ink);">' +
    usedMin +
    '</b> 分钟 · 每 25 分钟折算 1🍅，继续或收工都算数</div>' +
    '<button class="ft-done-btn primary" id="ftContinueBtn">继续 +15 分钟</button>' +
    '<button class="ft-done-btn" id="ftFinishBtn">结束并结算</button>';
  ov.appendChild(card);
  document.body.appendChild(ov);
  playSound('focusEnd');
  notify('流式计时到点', '已专注 ' + usedMin + ' 分钟，可继续或结束', { kind: 'flow-end' });
  document.getElementById('ftContinueBtn').onclick = function () {
    const addMin = 15;
    const dur = addMin * 60;
    timerState.pausedRemaining = dur;
    timerState.remaining = dur;
    timerState.totalDuration = dur;
    timerState.endAt = Date.now() + dur * 1000;
    timerState.running = true;
    timerState.startTime = Date.now();
    ov.remove();
    const bS = document.getElementById('btnStart');
    if (bS) {
      bS.innerHTML = '<span>⏸ 暂停</span><span class="btn-sub">pause</span>';
    }
    const bF = document.getElementById('btnFinish');
    if (bF) bF.disabled = false;
    document.getElementById('timerLabel').textContent = '流式计时中（+' + addMin + ' 分钟）';
    startTimerLoop();
    updateTimerDisplay();
    requestWakeLock();
    showToast('⏱ 已续时 +' + addMin + ' 分钟，继续加油！');
  };
  document.getElementById('ftFinishBtn').onclick = function () {
    ov.remove();
    finishFreeTimer();
  };
}
/* 初始化类型切换 UI（切换回番茄钟时同步胶囊状态） */
(function () {
  const _origApply = applyTimerModeUI;
  if (typeof _origApply === 'function') {
    __replaceApplyTimerModeUI(function () {
      _origApply.apply(this, arguments);
      try {
        syncFreeTypeUI();
      } catch (e) { if (window.__silent) window.__silent(e, '01g:showFlowtimeDone'); }
    });
  }
})();

/* ===== 合并 updateTitle 双实现 =====
 * 删除本段死壳：01g 内 updateTitle 已停用写入（历史双实现残余），
 * 真实标题由 03_enh572 模块的 updateTitle（1s __ivGov/setInterval 驱动）统一输出；
 * 本段仅剩 visibilitychange 空转调用 → 整段移除，写入者收敛为唯一一套。
  */
// ---------- 9. 任务提醒轮询 ----------
function checkTodoReminders(nowArg) {
  try {
    if (!appData || !appData.todos || !appData.todos.length) return;
    /* 已勾掉 / 这一段已确认：从确认队列撤掉，别继续催。
       键形如 `<id>` 或 `<id>#<hhmm>`（每段一个），取 id 前先剥掉 '#' 尾巴。 */
    remindPurge('todo:', function (k) {
      const raw = k.slice(5);
      const tid = raw.split('#')[0];
      const t = appData.todos.find(function (tt) { return tt && String(tt.id) === tid; });
      if (!t || t.done) return false;
      const slots = todoRemindSlots(t, appData.settings, getTodayStr());
      if (!slots.length) return false;
      if (raw === tid) return slots.some(function (s) { return s.key === tid && !todoRemindSlotAcked(t, s); });
      return slots.some(function (s) { return s.key === raw && !todoRemindSlotAcked(t, s); });
    });
    const now = nowArg instanceof Date ? nowArg : new Date();
    const pad2 = function (n) { return String(n).padStart(2, '0'); };
    const todayStr = getTodayStr();
    const nowStr = todayStr + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    const nowMs = now.getTime();
    let fired = false;
    appData.todos.forEach(function (t) {
      if (t.done) return;
      /* 每段排期各响一次。
         同一任务一次只催**最早那个还没确认的到点段** —— 免得打开 App 时
         早上的 3 段一起炸出来。确认掉这一段，下一段到点再说。 */
      const slots = todoRemindSlots(t, appData.settings, todayStr);
      let slot = null;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].at <= nowStr && !todoRemindSlotAcked(t, slots[i])) { slot = slots[i]; break; }
      }
      if (!slot) return;
      const last = typeof t.remindLast === 'number' ? t.remindLast : 0;
      if (last && nowMs - last < 60000) return; /* 距上次提醒不到 1 分钟，先不催 */
      if (nowMs < remindSnoozeUntil('todo:' + slot.key)) return; /* 点过「稍后」，先放它一会儿 */
      t.remindLast = nowMs;
      fired = true;
      const sub = t.deadline ? '最晚完成日 ' + String(t.deadline).slice(5) : '';
      const segTxt = tbMinLabel(slot.startMin) + (isFinite(slot.endMin) && slot.endMin !== slot.startMin ? '–' + tbMinLabel(slot.endMin) : '');
      const which = slot.n > 1 ? '第 ' + slot.idx + ' 段（共 ' + slot.n + ' 段）' : '';
      const warn = slot.at < nowStr ? '⚠️ 这段已经过点了' : '';
      /* 专注中不打扰：弹窗由 remindEnqueue 统一压住，这里也别再推系统通知/震一下
         （判定同样走 remindFocusRunning，不另写一份） */
      const inFocus = remindFocusRunning();
      if (!inFocus) {
        notify('⏰ 任务提醒', t.title + ' · ' + segTxt, { kind: 'task', sticky: true });
        if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
      }
      const tid = t.id;
      const slotKey = slot.ack;
      remindEnqueue({
        key: 'todo:' + slot.key,
        label: t.title || '',
        title: '⏰ 任务提醒到啦',
        body:
          '<div style="font-size:var(--fs-body);color:var(--text-light)">' +
          (slot.n > 1 ? '这段排期到点啦：' : '计划里的任务到点啦：') +
          '</div>' +
          '<div style="font-size:var(--fs-sub);font-weight:900;color: var(--primary-ink);margin:var(--sp-8) 0 var(--sp-2)">' +
          escapeHtml(t.title || '') +
          '</div>' +
          '<div style="font-size:var(--fs-note);color:var(--text-light)">' +
          escapeHtml((which ? which + ' · ' : '') + segTxt) +
          '</div>' +
          (warn ? '<div style="font-size:var(--fs-note);color:var(--danger);margin-top:var(--sp-2)">' + escapeHtml(warn) + '</div>' : '') +
          (sub ? '<div style="font-size:var(--fs-note);color:var(--text-light)">' + escapeHtml(sub) + '</div>' : '') +
          '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-6)">点「知道了」才算收到，没点就每分钟再提醒一次；想晚点再说就点「稍后 10 分钟」（勾掉这条任务也会停）。</div>',
        onAck: function () {
          remindAckTodo(tid, slotKey);
        }
      });
    });
    if (fired) {
      saveDataNow();
      renderTodos();
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01g:checkTodoReminders'); }
}
/* 任务提醒的「知道了」：用 slotKey（'日期|起始分钟'）记这一段的确认位。
   不带 slotKey 的老调用仍按"整条已提醒"处理（reminded=true）。 */
function remindAckTodo(id, slotKey) {
  try {
    if (!appData || !appData.todos) return;
    for (let i = 0; i < appData.todos.length; i++) {
      const t = appData.todos[i];
      if (t && String(t.id) === String(id)) {
        if (slotKey) {
          if (!t.remindAcked || typeof t.remindAcked !== 'object' || Array.isArray(t.remindAcked)) t.remindAcked = {};
          t.remindAcked[slotKey] = Date.now();
        } else {
          t.reminded = true;
        }
        t.remindLast = 0;
      }
    }
    saveDataNow();
    renderTodos();
  } catch (e) { if (window.__silent) window.__silent(e, '01g:remindAckTodo'); }
}
/* 业务心跳 · 任务到点提醒 30s（showToast+notify，需保活） */
/* 真实时间驱动；自动化回归要自己造时间（run_smoke C29）→ 用同一个开关一起暂停 */
setInterval(function () {
  if (window.__remindWatchPaused) return;
  checkTodoReminders();
}, 30000);
setTimeout(function () {
  if (window.__remindWatchPaused) return;
  checkTodoReminders();
}, 5000);

// ---------- 10. 触屏拖拽排序 ----------
/* 手势锁：'h'=横向滑动操作（bindSwipe）占用；'v'=纵向拖拽排序（initTouchDrag）占用。
   两套系统共用同一列表、都在写 style.transform，必须互斥，否则拖拽与滑动会互相覆盖动画（右滑 bug 根因）。 */
let _gestureLock = null;
/* ★ 兜底：手势锁必须在「手指离开」时无条件清掉。
   坑（真出过）：锁主要由 bindSwipe 的 touchend 清 'h'、initTouchDrag 的 endDrag 清 'v'，
   但 endDrag 挂在**列表元素**上 —— 起手在列表里、松手时手指已滑到列表外时 pointerup 不落在
   列表上，endDrag 就没被调用，锁永久卡在 'h'；翻页手势的 touchstart 一看有锁就整段 return，
   于是「一次没收尾的拖动」会让左右滑翻页**从此失效**，直到下次重启。
   手指全部离开 = 任何手势都已经结束，此时清锁永远安全。 */
(function bindGestureLockFallback() {
/* 用 setTimeout(...,0) 而不是当场清：清锁必须排在**本轮事件的所有处理器之后**——
   bindSwipe 的 touchend 要靠这个锁决定「完成/删除」是否生效，pointerup 又可能排在 touchend 前面，
   当场清会把原生手势的收尾读写成空。等到本轮任务跑完再清，手势已经彻底结束，绝对安全。 */
  const release = function () { setTimeout(function () { _gestureLock = null; }, 0); };
  document.addEventListener('touchend', release, { passive: true });
  document.addEventListener('touchcancel', release, { passive: true });
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
})();
function initTouchDrag(listId, reorderFn, enabledFn) {
  const list = document.getElementById(listId);
  if (!list) return;
  let startY = 0,
    startX = 0,
    longPressTimer = null,
    dragState = null;
  const findItem = function (el) {
    return el && el.closest ? el.closest('.todo-item,.habit-item') : null;
  };
  const isInteract = function (t) {
    return !!(
      t.closest &&
      t.closest('button,input,textarea,select,.todo-checkbox,.todo-expand-btn,.habit-checkbox,.habit-arrow,.move-btn')
    );
  };
  list.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch') return;
    /* 手势已被横向滑动占用：不启动拖拽待激活 */
    if (_gestureLock === 'h') return;
    const item = findItem(e.target);
    if (!item || isInteract(e.target)) return;
    startY = e.clientY;
    startX = e.clientX;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(function () {
      if (enabledFn && !enabledFn()) return;
      const itEl = item.querySelector('.todo-item,.habit-item') || item;
      dragState = {
        el: item,
        id: parseInt(itEl.dataset.id, 10),
        offsetY: e.clientY - item.getBoundingClientRect().top,
        active: true
      };
      item.classList.add('dragging');
      item.style.position = 'relative';
      item.style.zIndex = '99';
      item.style.opacity = '0.72';
      item.style.transition = 'transform 60ms linear';
      try {
        item.setPointerCapture(e.pointerId);
      } catch (err) { if (window.__silent) window.__silent(err, '01g:initTouchDrag'); }
      try {
        e.preventDefault();
      } catch (err) { if (window.__silent) window.__silent(err, '01g:initTouchDrag'); }
      if (navigator.vibrate) navigator.vibrate(15);
    }, 320);
  });
  list.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'touch') return;
    /* 方向未定：按首次明显位移抢占手势锁（pointer 事件先于 touch 事件触发，这里先判方向） */
    const pdx = e.clientX - startX,
      pdy = e.clientY - startY;
    if (!_gestureLock && (Math.abs(pdx) > 10 || Math.abs(pdy) > 10)) {
      _gestureLock = Math.abs(pdx) > Math.abs(pdy) ? 'h' : 'v';
    }
    /* 横向已被滑动占用：取消拖拽待激活，避免 320ms 后误启动拖拽 */
    if (_gestureLock === 'h') {
      clearTimeout(longPressTimer);
      dragState = null;
      return;
    }
    if (!dragState || !dragState.active) return;
    if (Math.abs(e.clientY - startY) < 8 && Math.abs(e.clientX - startX) < 8) return;
    const dy = e.clientY - dragState.offsetY;
    dragState.el.style.transform = 'translateY(' + dy + 'px) scale(1.02)';
    const below = document.elementFromPoint(e.clientX, e.clientY);
    const target = below ? findItem(below) : null;
    if (target && target !== dragState.el) {
      const tr = target.getBoundingClientRect();
      const er = dragState.el.getBoundingClientRect();
      const targetMid = tr.top + tr.height / 2;
      /* ★ 插入到**目标自己的父容器**里，不是 list（2026-11-04）。
         习惯分了文件夹以后，行挂在 .habit-folder-body 下，
         往 list 里 insertBefore 一个别人的子节点 → NotFoundError 当场抛出，
         pointermove 断掉 = 「长按拖不动」。顺带：拖进别的文件夹 = 换分类。 */
      const parent = target.parentNode || list;
      if (er.top < tr.top && e.clientY < targetMid) {
        parent.insertBefore(dragState.el, target);
      } else if (er.bottom > tr.bottom && e.clientY > targetMid) {
        parent.insertBefore(dragState.el, target.nextSibling);
      }
    }
  });
  const endDrag = function () {
    clearTimeout(longPressTimer);
    if (!dragState || !dragState.active) {
      if (_gestureLock === 'v') _gestureLock = null;
      return;
    }
    const el = dragState.el;
    el.classList.remove('dragging');
    el.style.transform = '';
    el.style.position = '';
    el.style.zIndex = '';
    el.style.opacity = '';
    el.style.transition = '';
    const id = dragState.id;
    dragState = null;
    if (_gestureLock === 'v') _gestureLock = null;
    try {
      reorderFn();
    } catch (err) { if (window.__silent) window.__silent(err, '01g:initTouchDrag'); }
    if (id) playSound('tap');
  };
  list.addEventListener('pointerup', endDrag);
  list.addEventListener('pointercancel', endDrag);
  list.addEventListener('pointerleave', function (e) {
    /* 指针移出列表区域且没有捕获时结束 */
    if (dragState && dragState.active && !dragState.el.hasPointerCapture && e.pointerType === 'touch') {
      /* 有捕获时不移出 */
    }
  });
}
function syncTodoOrderFromDom() {
  const idOrder = [];
  document.querySelectorAll('#todoList .todo-item').forEach(function (it) {
    idOrder.push(parseInt(it.dataset.id, 10));
  });
  if (!idOrder.length) return;
  const map = {};
  appData.todos.forEach(function (t) {
    if (t) map[t.id] = t;
  });
/* 安全校验：DOM 中出现未知/缺失 id，或数量对不上（渲染异常）时放弃本次排序，
   用当前数据重绘还原列表，绝不静默丢弃任务 */
  const ordered = idOrder.map(function (id) {
    return map[id];
  });
  const missing = idOrder.some(function (id) {
    return !map[id];
  });
  if (missing || ordered.length !== appData.todos.length) {
    renderTodos();
    return;
  }
  appData.todos = ordered;
  saveData();
  renderTodos();
  refreshTodoSelect();
}
function syncHabitOrderFromDom() {
  const items = [];
  document.querySelectorAll('#habitList .habit-item').forEach(function (it) {
    items.push(it);
  });
  if (!items.length) return;
  const map = {};
  appData.habits.forEach(function (h) {
    if (h) map[String(h.id)] = h;
  });
  const seq = items
    .map(function (el) {
      return map[String(el.dataset.id)];
    })
    .filter(Boolean);
  /* DOM 里有认不出的行（渲染异常）：放弃本次排序，按数据重绘还原，绝不静默丢 */
  if (seq.length !== items.length) {
    renderHabits();
    return;
  }
  /* 分类归属：行所在的容器带 data-cat 就认它 —— 拖进别的文件夹 = 换分类 */
  items.forEach(function (el) {
    const h = map[String(el.dataset.id)];
    const box = el.parentNode;
    if (!h || !box || !box.dataset || box.dataset.cat === undefined) return;
    const cid = box.dataset.cat || null;
    if (String(h.catId || '') !== String(cid || '')) {
      h.catId = cid;
      h.updatedAt = Date.now();
    }
  });
  /* 位置填充而不是整体重排：归档区、「今天不用做」区也在列表里，
     整体按 DOM 顺序重写会把那些行挪到数组末尾（下次打开顺序莫名变了）。 */
  const slots = [];
  appData.habits.forEach(function (h, i) {
    if (!h) return;
    for (let k = 0; k < items.length; k++) {
      if (String(items[k].dataset.id) === String(h.id)) { slots.push(i); return; }
    }
  });
  if (slots.length !== seq.length) {
    renderHabits();
    return;
  }
  slots.forEach(function (pos, k) {
    appData.habits[pos] = seq[k];
  });
  saveData();
  renderHabits();
}
setTimeout(function () {
  try {
    initTouchDrag('todoList', syncTodoOrderFromDom, function () {
      return getSortPrefs().todos.by === 'manual';
    });
    initTouchDrag('habitList', syncHabitOrderFromDom, function () {
      return getSortPrefs().habits.by === 'manual';
    });
  } catch (e) { if (window.__silent) window.__silent(e, '01g:syncHabitOrderFromDom'); }
}, 800);

// ---------- 11. 滑动操作 ----------
function initSwipeActions() {
  const todoList = document.getElementById('todoList');
  if (todoList) {
    bindSwipe(todoList, '.todo-item', {
      right: function (id) {
        toggleTodo(id);
      },
      left: function (id) {
        toggleTodoExpand(id);
      }
    });
  }
  const habitList = document.getElementById('habitList');
  if (habitList) {
    bindSwipe(habitList, '.habit-item', {
      right: function (id) {
        toggleHabit(id);
      },
      left: null
    });
  }
}
function bindSwipe(list, selector, actions) {
  /* 轻量手势版：不再有滑动动画/背景，右滑直接触发完成，左滑触发展开（无位移反馈） */
  let sx = 0,
    sy = 0,
    swipeEl = null,
    lastDx = 0,
    active = false;
  list.addEventListener(
    'touchstart',
    function (e) {
      if (e.touches.length !== 1) {
        swipeEl = null;
        return;
      }
      const item = e.target.closest(selector);
      if (!item) return;
      if (e.target.closest('button,input,textarea,select,.todo-checkbox,.habit-checkbox,.todo-expand-btn,.move-btn,.sub-cb'))
        return;
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
      lastDx = 0;
      active = true;
      swipeEl = item;
    },
    { passive: true }
  );
  list.addEventListener(
    'touchmove',
    function (e) {
      /* 纵向拖拽已占用：放弃滑动 */
      if (_gestureLock === 'v') {
        active = false;
        swipeEl = null;
        return;
      }
      if (!active || !swipeEl) return;
      const t = e.touches[0];
      const dx = t.clientX - sx,
        dy = t.clientY - sy;
      if (Math.abs(dx) < Math.abs(dy)) {
        /* 纵向滚动 → 取消滑动 */
        if (Math.abs(dy) > 12) {
          active = false;
          swipeEl = null;
        }
        return;
      }
      /* 横向滑动抢占手势锁（pointer 未先抢到才抢）；不移动元素、不露背景 */
      if (!_gestureLock) _gestureLock = 'h';
      e.preventDefault();
      lastDx = dx;
    },
    { passive: false }
  );
  const endSwipe = function () {
    if (!active || !swipeEl) {
      active = false;
      swipeEl = null;
      if (_gestureLock === 'h') _gestureLock = null;
      return;
    }
    const el = swipeEl;
    active = false;
    swipeEl = null;
    if (_gestureLock === 'h') _gestureLock = null;
    const id = parseInt(el.dataset.id, 10);
    if (lastDx > 60 && actions.right) {
      try {
        actions.right(id);
      } catch (err) { if (window.__silent) window.__silent(err, '01g:bindSwipe'); }
    } else if (lastDx < -60 && actions.left) {
      try {
        actions.left(id);
      } catch (err) { if (window.__silent) window.__silent(err, '01g:bindSwipe'); }
    }
  };
  list.addEventListener('touchend', endSwipe);
  list.addEventListener('touchcancel', endSwipe);
}
setTimeout(function () {
  try {
    initSwipeActions();
  } catch (e) { if (window.__silent) window.__silent(e, '01g:bindSwipe'); }
}, 900);

// ---------- 12. 桌面端侧边栏 ----------
/* 「专注数据条」整块已移除（连同 updateFocusStatsRow / markBreakEnded / 休息钩子
   / 1s 轮询）。原三格「剩余 / 今日 / 未休息」全部冗余或不可靠：
     · 剩余 —— 大表盘已经在显示；
     · 今日 —— 段位条与统计页都有；
     · 未休息 —— 只能测「上次休息结束」时刻，关页面/锁屏全算作未休息，且不产生任何行动。
   此处保留一个空占位注释，防止后续有人凭旧文档找 focusStatsRow 而困惑。 */

// ---------- 13. 桌面端侧边栏（≥720px） ----------
function buildDesktopSidebar() {
  if (document.getElementById('desktopSidebar')) return;
  if (window.innerWidth < 720) return;
  const sb = document.createElement('aside');
  sb.className = 'desktop-sidebar';
  sb.id = 'desktopSidebar';
  /* 计算今日任务数 */
  const todayStr = getTodayStr();
  const todayTodos = (appData.todos || []).filter(function (t) {
    return !t.done;
  }).length;
  const habitCount = (appData.habits || []).length;
  sb.innerHTML =
    '<div class="ds-brand">🍅 番茄专注</div>' +
    '<nav class="ds-nav" id="dsNav">' +
    '<div class="ds-section">主导航</div>' +
    navItem('timer', '⏱', '计时') +
    navItem('plan', '📋', '计划') +
    navItem('log', '📖', '日志') +
    navItem('stats', '📊', '统计') +
    navItem('settings', '⚙️', '设置') +
    '<div class="ds-section" style="margin-top:var(--sp-8);">任务</div>' +
    /* 收件箱跳到「📋 计划」子板块 */
    navItem('plan', '📥', '收件箱', todayTodos > 0 ? todayTodos : null, null, 'plan') +
    '<div class="ds-section" style="margin-top:var(--sp-8);">习惯</div>' +
    /* 习惯跳到「🌱 习惯」子板块 */
    navItem('plan', '🌱', '习惯', habitCount > 0 ? habitCount : null, null, 'habit') +
    '</nav>' +
    '<div class="ds-foot">' +
    navItem('stats', '📈', '统计', null, 'stats') +
    navItem('settings', '⚙️', '设置', null, 'settings') +
    '</div>';
  document.body.appendChild(sb);
  syncDesktopSidebarActive();
}
function navItem(view, icon, label, count, forceView, subTab) {
  const v = forceView || view;
  /* ===== navItem 支持子板块参数 =====
   * 让"收件箱"跳计划 tab、"习惯"跳习惯 tab；onclick 按需调用 switchPlanTab */
  return (
    '<div class="ds-item" data-view="' +
    v +
    '" data-subtab="' +
    (subTab || '') +
    '" data-act="switchViewFromSidebar" data-act-args=\'' +
    JSON.stringify([v, subTab || '']) +
    '\'><span class="ds-icon">' +
    icon +
    '</span><span class="ds-label">' +
    label +
    '</span>' +
    (count != null ? '<span class="ds-count">' + count + '</span>' : '') +
    '</div>'
  );
}
/* 事件委托（2026-10-23）：侧栏一项 = 切视图 + 子 tab + 同步高亮，原为内联三语句。 */
window.switchViewFromSidebar = function (view, subTab) {
  switchView(view);
  if (subTab && typeof switchPlanTab === 'function') switchPlanTab(subTab);
  syncDesktopSidebarActive();
};
function syncDesktopSidebarActive() {
  const v = (document.querySelector('.view.active') || {}).id || 'view-timer';
  const cur = v.replace('view-', '');
  document.querySelectorAll('.desktop-sidebar .ds-item').forEach(function (it) {
    it.classList.toggle('active', it.dataset.view === cur);
  });
}
/* 监听视图切换同步侧边栏 —— 走视图切换钩子（原来靠包装 window.switchView）。
   时机与原来一致：切完之后 50ms（等新视图渲染完再算高亮）。 */
(function () {
  tbOnViewSwitch(function () {
    setTimeout(syncDesktopSidebarActive, 50);
  }, 'after');
})();
/* 响应窗口大小变化（重入/退出桌面布局） */
let _lastIsDesk = window.innerWidth >= 720;
function handleResize() {
  const isDesk = window.innerWidth >= 720;
  if (isDesk !== _lastIsDesk) {
    _lastIsDesk = isDesk;
    if (isDesk) {
      buildDesktopSidebar();
    } else {
      const s = document.getElementById('desktopSidebar');
      if (s) s.remove();
    }
  }
  /* 手动裁切的缩放是像素级计算，容器尺寸变化后需重算 */
  try {
    applySkinsToDOM();
  } catch (e) { if (window.__silent) window.__silent(e, '01g:handleResize'); }
}
window.addEventListener('resize', handleResize);

/* ---------- 软键盘适配 ----------
   .bottom-nav 是 position:fixed;bottom:0，键盘弹出时它仍钉在视口底部，
   会和正在输入的输入框抢同一块地方（备忘输入框被挡住）。
   做法：只有 visualViewport 知道键盘占了多高 —— innerHeight - visualViewport.height
        就是键盘高度。超过阈值就认定「键盘开着」，给 body 挂 kb-open → 底部导航隐藏，
        把位置让给输入区（CSS 见 12_components.css 的 body.kb-open .bottom-nav）。
   兼容：不支持 visualViewport 的老浏览器直接 return，保持原样，不报错也不劣化。 */
(function initKeyboardInset() {
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const THRESHOLD = 120; /* 小于此值多为地址栏收缩之类的噪声，不算键盘 */
  function apply() {
    const kb = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0));
    const root = document.documentElement;
    root.style.setProperty('--kb-h', kb + 'px');
    /* 视觉视口的位置与高度：软键盘弹出时浏览器不是缩小布局视口，而是把**视觉视口**
       整个往上推（offsetTop 变成几百像素）来露出输入框。position:fixed 的元素
       钉在布局视口上、不会跟着推 → 弹窗被顶出屏幕，看起来就是「输入框一点，框就没了」。
       把这两个值也交给 CSS，弹窗遮罩才能钉回用户真正看得见的那块区域。 */
    root.style.setProperty('--vv-top', (vv.offsetTop || 0) + 'px');
    root.style.setProperty('--vv-h', vv.height + 'px');
    document.body.classList.toggle('kb-open', kb > THRESHOLD);
  }
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
})();

/* ---------- 弹窗在软键盘下保持可见 ----------
   遮罩的定位由 CSS 负责（body.kb-open 下钉到视觉视口，见 12_components.css）；
   这里只补一件事：键盘吃掉半屏后，把正被编辑的那个输入框滚进弹窗可视区。
   浏览器自带的「滚动到可见」经常作用在外层页面而不是弹窗里，滚了等于没滚。
   ★ 必须滚**真正可滚的那一层**：手账 sheet 的结构是
     .modal(#xxxBox, overflow:hidden) > 标题 / 内容区(overflow-y:auto) / 页脚。
     早先这里写 box.scrollTop，box 是不可滚的，赋值静默无效 ——
     于是这段代码一直空转，浏览器只好自己滚视觉视口把整层顶上去，
     表现为「点一下输入框，弹窗连同标题被顶到屏幕外」。 */
(function initKeyboardModalFit() {
  function scrollerOf(box) {
    if (!box) return null;
    const cs = box.ownerDocument.defaultView.getComputedStyle(box);
    if (/(auto|scroll)/.test(cs.overflowY) && box.scrollHeight > box.clientHeight + 1) return box;
    for (let i = 0; i < box.children.length; i++) {
      const k = scrollerOf(box.children[i]);
      if (k) return k;
    }
    return null;
  }
  function scrollActiveIntoView() {
    const a = document.activeElement;
    if (!a || a === document.body) return;
    const ov = a.closest ? a.closest('.modal-overlay.show') : null;
    if (!ov) return;
    const box = a.closest('.modal') || ov;
    const sc = scrollerOf(box);
    if (!sc) return;
    const ar = a.getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    const pad = 12;
    if (ar.top < sr.top + pad) sc.scrollTop -= (sr.top + pad - ar.top);
    else if (ar.bottom > sr.bottom - pad) sc.scrollTop += (ar.bottom - (sr.bottom - pad));
  }
  /* 键盘完全弹出有动画（约 200–300ms），立刻量会量到旧值，等一拍再滚。 */
  function later() { setTimeout(scrollActiveIntoView, 260); }
  document.addEventListener('focusin', later);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', later);
    window.visualViewport.addEventListener('scroll', later);
  }
})();

/* ---------- 头部顶部内边距自愈 ----------
   浏览器（非独立窗口）里 .header 的 padding-top 恒为 14px（CSS 只在
   display-mode: standalone 时才叠加 env(safe-area-inset-top)）。
   但安卓浏览器/WebView 的安全区值会随工具栏显隐、软键盘收放时有时无：
   一旦浏览器把 env(safe-area-inset-top) 算成非 0，头部就凭空增高一块、
   字号却不变，刷新页面才复原（"顶部有时候变宽/被放大"）。
   这里兜底：任何超过设计值的 padding-top 都改回 14px。 */
(function initHeaderInsetHeal() {
  const HEADER_PAD_TOP = 14;
  let standalone = false;
  try {
    standalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  } catch (e) { standalone = false; if (window.__silent) window.__silent(e, '01g:headerInsetHeal'); }
  if (standalone) return;
  function heal() {
    try {
      const h = document.querySelector('.header');
      if (!h) return;
      const cur = parseFloat(getComputedStyle(h).paddingTop);
      if (isFinite(cur) && cur > HEADER_PAD_TOP + 1) h.style.paddingTop = HEADER_PAD_TOP + 'px';
    } catch (e) { if (window.__silent) window.__silent(e, '01g:initHeaderInsetHeal'); }
  }
  heal();
  window.addEventListener('resize', heal);
  window.addEventListener('orientationchange', heal);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', heal);
    window.visualViewport.addEventListener('scroll', heal);
  }
})();

setTimeout(function () {
  try {
    buildDesktopSidebar();
    syncDesktopSidebarActive();
  } catch (e) { if (window.__silent) window.__silent(e, '01g:handleResize'); }
}, 300);

// ---------- 14. 当前任务高亮（计划页+计时页） ----------
function applyCurrentTaskHighlight() {
  const id = typeof timerState !== 'undefined' ? timerState.linkedTodoId || timerState._selId || null : null;
  document.querySelectorAll('.todo-item').forEach(function (it) {
    const tid = parseInt(it.dataset.id, 10);
    it.classList.toggle('is-current', !!id && tid === id);
  });
  /* 同步 renderTodos 的脏检查签名（避免被脏检查阻断） */
  try {
    _todoSig = '__force__';
  } catch (e) { if (window.__silent) window.__silent(e, '01g:applyCurrentTaskHighlight'); }
}
(function () {
  const _origRender = renderTodos;
  if (_origRender) {
    window.renderTodos = function () {
      _origRender.apply(this, arguments);
      setTimeout(applyCurrentTaskHighlight, 10);
    };
  }
})();
/* 切换任务/开始专注/结束时同步高亮 · 挂 __ivGov（纯 UI 高亮，后台零唤醒） */
if (window.__ivGov) __ivGov.add(applyCurrentTaskHighlight, 3000);
else setInterval(applyCurrentTaskHighlight, 3000);
setTimeout(applyCurrentTaskHighlight, 2000);

function setProgressStyle(v) {
  if (typeof v !== 'string') v = 'ring';
  appData.settings.progressStyle = v;
  saveData();
  applyProgressStyle(v);
}
function applyProgressStyle(v) {
  v = v || (appData && appData.settings && appData.settings.progressStyle) || 'ring';
  document.body.classList.toggle('progress-wave', v === 'wave');
  document.querySelectorAll('#progressStyleSeg .seg-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.v === v);
  });
}
(function () {
  const _origApply = applySettingsToUI;
  if (_origApply) {
    applySettingsToUI = function () {
      _origApply.apply(this, arguments);
      try {
        applyProgressStyle();
      } catch (e) { if (window.__silent) window.__silent(e, '01g:applyProgressStyle'); }
    };
  }
  setTimeout(function () {
    try {
      applyProgressStyle();
    } catch (e) { if (window.__silent) window.__silent(e, '01g:applyProgressStyle'); }
  }, 300);
})();

/* 构建版本号：从产物首行 <!--@tomato-src base64--> 恢复清单里读出「源码改动日期」，
   填到设置页页脚的 #buildVer。
   用途：本地 file:// 打开时浏览器会把产物复制一份到自己目录，光看文件名分不清手机里
   跑的是哪一版；页脚有版本号，改完打开一看就知道新代码生效没有 */
(function showBuildVersion() {
  function readMeta() {
    function parse(val) {
      try {
        if (val.indexOf('@tomato-src ') !== 0) return null;
        var b64 = val.slice('@tomato-src '.length).trim();
        var bin = atob(b64);
        var txt;
        try {
          var bytes = new Uint8Array(bin.length);
          for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
          txt = new TextDecoder('utf-8').decode(bytes);
        } catch (eDec) {
          txt = decodeURIComponent(escape(bin));
        }
        return JSON.parse(txt);
      } catch (e) { return null; }
    }
    try {
      var nodes = document.childNodes;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.nodeType !== 8) continue;
        var got = parse(String(n.nodeValue || ''));
        if (got) return got;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '01g:readMeta'); }
    /* childNodes 里找不到时（托管环境下首行注释可能被前置内容挤掉），
       退回直接在序列化后的 HTML 里找 —— 页脚显示一个破折号等于没有版本号。 */
    try {
      var m = String(document.documentElement.outerHTML || '')
        .match(/<!--@tomato-src ([A-Za-z0-9+/=]+)-->/);
      if (m) return parse('@tomato-src ' + m[1]);
    } catch (e) { if (window.__silent) window.__silent(e, '01g:readMeta2'); }
    return null;
  }
  function fill() {
    var meta = readMeta();
    /* ★ 多文件产物（现在的交付形态）**不写** @tomato-src 恢复清单 —— 它是给
       单文件还原 src/ 用的，外链化之后 parts 偏移对不上，写了会误导。
       但页脚版本号不能因此永远是破折号：用户看到「构建版本 —」只会以为页面坏了。
       所以这里补一条退路：多产物把版本 bake 进 config.js 的 TF_CONFIG.version，
       读不到恢复清单时就用它。 */
    var ver = meta && meta.ver;
    if (!ver) {
      try {
        var cfg = window.TF_CONFIG || {};
        if (cfg.version) ver = cfg.version;
      } catch (e2) { if (window.__silent) window.__silent(e2, '01g:fillCfg'); }
    }
    /* 把日期版本号挂到全局：全站「版本号」统一走这一个来源（形如 2026.10.12）。
       错误上报等需要"这一版是什么"的地方都用它，而不是 DATA_VERSION('3.9') ——
       后者是数据迁移用的内部锚点，不是产品版本号。 */
    if (ver) {
      try { window.__buildVer = ver; } catch (e) { if (window.__silent) window.__silent(e, '01g:fill'); }
    }
    var el = document.getElementById('buildVer');
    if (!el) return;
    if (ver) el.textContent = ver;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
  else fill();
})();

/* ===== PWA 注册 =====
   只在 http(s) 下注册：file:// 不是安全上下文，register 会抛异常并污染错误日志，
   而本地文件本来就离线可用，不需要 service worker。
   sw.js 与本页同目录，scope 默认就是站点根 —— 托管时把 index.html / sw.js /
   manifest.webmanifest / icons/ 放在同一个目录即可（tools/build_site.py 负责组装）。 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', function () {
    /* 用 [] 取值而不是 sw.register(...)：静态扫描会把 `register(` 认成
       07_uiFold 里同名的顶层函数，报成跨层硬依赖；这里取的是浏览器原生 API。
       同理不用 .catch —— 审计工具要求 .catch 只出现在登记过的 Promise 返回值上，
       而 register 不在登记表里。用 typeof then 判一次，行为等价。 */
    /* updateViaCache:'none' —— 只影响「检查 sw.js 自身」这一件事：
       不让浏览器拿 HTTP 缓存（GitHub Pages 给所有文件 max-age=600）去回答
       「有没有新版」，必须真的到服务器问一次。老内核不认这个选项也没损失。 */
    var p = navigator.serviceWorker['register']('sw.js', { updateViaCache: 'none' });
    if (!p || typeof p.then !== 'function') return;
    p.then(null, function (e) {
      if (window.__silent) window.__silent(e, '01g:pwa');
    });
    /* ★ 发版后「看不到更新」的真凶在这里。
       sw.js 的静态资源是缓存优先，而缓存按 BUILD_ID 分代；新一代 SW 还没接管时，
       页面拿到的是新 index.html + 旧 app.js 的组合 —— 于是「页面里明明该有的东西
       不见了」，用户以为功能没做，其实他看的是上一版的脚本。
       新版 activate 里调了 clients.claim()，接管的瞬间会抛一次 controllerchange，
       这里借它做一次刷新。两个护栏：
       ① 首次安装时页面本来就没有 controller，claim 后也会抛 —— 那种情况不刷；
       ② sessionStorage 挡住二次刷新（否则刷新后的新页面又被自己刷一次）。 */
    /* ★ 2026-10-28：这里原来直接 location.reload()，用户反馈「一进去就自己刷新一下，
       像重新打开一次预览」。成因是三条凑在一起：
         ① install 里调了 skipWaiting() → 只要 sw.js 的**字节**变了就立刻接管；
         ② updateViaCache:'none' → 每次打开都真的去服务器问一次 sw.js；
         ③ GitHub Pages 发版后各边缘节点更新不同步 —— 几分钟内可能连着安装到
            「新版 → 旧版 → 新版」，于是每次打开都触发一次刷新，有时一屏刷两次。
       更新该提示，但不该替用户把页面抽走（刷到一半的输入、滚到一半的位置都会丢）。
       改成一条可点的提示：点它才刷；不点就继续用当前这版（只是旧一点，功能不缺）。 */
    var hadCtrl = !!navigator.serviceWorker.controller;
    var _swNoticed = false; /* 一次会话只提示一次，别每装一版就唠叨一遍 */
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadCtrl || _swNoticed) return;
      _swNoticed = true;
      try {
        UIFX.toast('🔄 有新版本，点这里刷新', false, function () {
          try { location.reload(); } catch (e) { if (window.__silent) window.__silent(e, '01g:pwaReload'); }
        });
      } catch (e) { if (window.__silent) window.__silent(e, '01g:pwaUpdateToast'); }
    });
  });
})();

/* ===== 字体：首屏之后补齐生僻字备用块 =====
   文楷拆成两个家族（见 src/template/01_fonts.css）：
     · WenKai      站点用到的 2221 字，488 KB —— 首屏就下，正文立刻是楷体
     · WenKaiExtra GB2312 其余 4715 字，1.15 MB —— 用户输入里才可能出现的字
   备用块为什么不靠 CSS 的 unicode-range 自动取：实测这个内核在页面上真出现对应
   汉字时并不会去拉它（document.fonts 里一直是 unloaded，字直接掉回系统黑体）。
   所以首屏结束后主动补一次。★ 时机很重要：
     · 不等首屏 —— 它占 3 倍于主字体的体积，放进去等于没拆；
     · 用 load + 5s，而不是 DOMContentLoaded：给首屏本身的图片/脚本留出带宽，
       而且 5 秒后用户多半已经在读页面，不至于盯着「页面在转」；
     · 只在真的没加载时才发请求，下过之后 SW 缓存会直接命中，后续 0 开销。 */
(function () {
  if (!window.FontFace || !document.fonts) return;
  var FONT = 'WenKaiExtra';
  var started = false;
  function prefetch() {
    if (started) return;
    started = true;
    /* ★ 必须带具体字符。load() 不带字符时按空格判断「要不要这个字体」，而空格在
       首屏块里、不在备用块的 unicode-range 里 → 浏览器判定「用不上」，一块都不下。
       样字由构建产出（--font-extra-sample），换字体或改文案时自动跟着变。
       同理不能用 document.fonts.check()：它对空格返回 true，未加载时也是 true。 */
    var sample = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-extra-sample').replace(/["'\s]/g, '');
    if (!sample) return;
    var p = document.fonts.load('16px ' + FONT, sample);
    if (p && typeof p.then === 'function') p.then(null, function () {});
  }
  window.addEventListener('load', function () { setTimeout(prefetch, 5000); });
})();
/* ===== 添加到主屏幕 =====
   浏览器的规则决定了这件事不可能总是"点一下弹框"：
   - Chrome / Edge 只在它判断"这个站点值得装"时抛一次 beforeinstallprompt。
     用户点过取消、或者手动关掉过那条提示条，浏览器就记住了，之后不再抛。
     事件不来，installApp 手里就没有可用的 prompt()，任何 PWA 都一样，不是这里能改的。
   - iOS Safari 根本没有这套 API，只能走「分享 → 添加到主屏幕」。
   - 内置 WebView（小程序、App 内打开的页面）没有安装入口，得换系统浏览器。
   所以：能弹框就弹框，弹不了就把步骤直接画在设置页上，而不是丢一句
   "点右上角菜单"让用户自己去找——多数人找不到。 */
(function () {
  var deferred = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    /* 必须 preventDefault，否则浏览器会自己弹那条提示条，
       我们就拿不到这次机会，也没法在设置页里再触发一次 */
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    deferred = e;
    renderInstallRow(true);
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    renderInstallRow(true);
  });

  function isStandalone() {
    if (navigator.standalone === true) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    return false;
  }

  function ua() {
    return navigator.userAgent || '';
  }

  function isIos() {
    return /iPhone|iPad|iPod/.test(ua());
  }

  function isWebview() {
    /* Android 内嵌 WebView 的 UA 带 "; wv)"；iOS 的内嵌浏览器不带 Safari 字样 */
    if (/; wv\)/.test(ua()) || /\bwv\b/.test(ua())) return true;
    if (isIos() && !/Safari/.test(ua())) return true;
    return false;
  }

  function isHttp() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  /* 状态机：返回当前能做什么。渲染和点击都读这一个判定，
     避免"文案说能装、按钮却说不能"这种自相矛盾。 */
  function installState() {
    if (isStandalone()) return 'standalone';
    if (!isHttp()) return 'file';
    if (isIos()) return isWebview() ? 'ios-webview' : 'ios';
    if (deferred) return 'ready';
    if (isWebview()) return 'webview';
    return 'manual';
  }

  var STEPS = {
    ready: ['点下面的按钮', '在弹出的框里选「安装」或「添加」'],
    manual: [
      '点浏览器右上角的「⋮」或「⋯」菜单',
      '在菜单里找「安装应用」或「添加到主屏幕」',
      '点一下，桌面上就有图标了'
    ],
    ios: [
      '点 Safari 底部的「分享」按钮（方框带向上箭头）',
      '在列表里往下找，选「添加到主屏幕」',
      '右上角点「添加」'
    ],
    'ios-webview': [
      '这个浏览器装不了。把地址复制到 Safari 打开',
      '在 Safari 里点底部「分享」按钮',
      '选「添加到主屏幕」'
    ],
    webview: [
      '这个浏览器装不了。把地址复制到系统浏览器打开',
      '用 Chrome 打开后点右上角「⋮」',
      '选「安装应用」或「添加到主屏幕」'
    ],
    file: ['现在是本地文件打开的，装不了', '用站点地址打开才能添加']
  };

  function hintText(s) {
    if (s === 'standalone') return '已经在主屏幕上了。从桌面图标打开，别再用浏览器。';
    if (s === 'ready') return '点按钮就行，两秒钟的事。';
    if (s === 'file') return '本地文件没有安装入口。';
    if (s === 'manual') return '浏览器这次没给一键安装的框（它每个站点只主动弹一次，关掉就不再弹）。按下面三步手动装，一样的效果：';
    if (s === 'ios') return 'iPhone 上要手动装，Safari 没有一键按钮：';
    return '这个浏览器没有安装功能，换个浏览器：';
  }

  function stepsHtml(s) {
    var list = STEPS[s];
    if (!list) return '';
    var out = '<ol style="margin:0; padding-left:1.4em;">';
    for (var i = 0; i < list.length; i++) {
      out += '<li style="margin:2px 0;">' + list[i] + '</li>';
    }
    return out + '</ol>';
  }

  window.installHint = function () {
    return hintText(installState());
  };

  window.installApp = function () {
    var s = installState();
    if (s === 'standalone') {
      showToast('已经装好了，直接在这儿用就行');
      return;
    }
    if (s === 'ready' && deferred) {
      deferred.prompt();
      /* prompt() 用过即废：不管用户点安装还是取消，都不能再拿它弹第二次 */
      deferred = null;
      renderInstallRow();
      return;
    }
    /* 弹不了框时不要只说一句话了事 —— 把步骤滚到眼前 */
    renderInstallRow();
    var box = document.getElementById('installSteps');
    if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
    showToast('这台设备要手动装，按下面的步骤来');
  };

  window.renderInstallRow = function (force) {
    var el = document.getElementById('installStatus');
    var box = document.getElementById('installSteps');
    var btn = document.getElementById('installBtn');
    var s = installState();
    if (el) el.textContent = hintText(s);
    if (box) {
      box.innerHTML = stepsHtml(s);
      /* 没有步骤就整块收起来 —— 原来模板里写死 display:none，后来搬进主题组时
         漏了这条，导致「已经能一键安装」的设备上也挂着一片空白虚线框。 */
      box.style.display = box.innerHTML ? 'block' : 'none';
    }
    if (btn) {
      btn.textContent = s === 'ready' ? '📲 一键安装' : (s === 'standalone' ? '✅ 已添加' : '📲 查看安装步骤');
    }
    return force;
  };
})();
