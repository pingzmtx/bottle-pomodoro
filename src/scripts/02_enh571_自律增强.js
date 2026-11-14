/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 增强模块（包装式注入）：只允许包装 01 系列白名单函数，整段可回退。
 * 红线：禁止直接改写 01d/01e 内部实现；加功能先 grep 防第二份实现。 */
/* ════════════════════════════════════════════════════════════════════
    瓶子专注 · 自律·提醒·统计 增强模块（独立注入，不改动原引擎）
   ────────────────────────────────────────────────────────────────────
   本模块放「产品打磨」类增量功能：自律与节奏 / 提醒与声音 / 统计可视化。
   全部通过【函数级挂钩 + 独立设置卡片】实现，不动原引擎逻辑。

   功能清单：
   ① 自律与节奏
      - 严格模式：专注运行中禁止 打断 / 提前结束 / 重置（脉冲+提示）
      - 休息自然结束后自动开始下一轮专注（可开关）
      - 定点休息提醒：每天最多 4 个时刻（如 12:00 午餐），到点弹窗
   ② 提醒与声音
      - 语音播报：开始/结束/休息节点 中文朗读（系统 TTS）
      - 自定义提示音：6 类音色可上传音频（存 IndexedDB），试听/还原
      - 滴答声：专注/休息分别开关
      - 结束前 N 秒（30/60）浏览器通知预提醒
   ③ 统计可视化
      - 今日逐小时专注分布
      - GitHub 风格 52 周专注热力图（月份 + 悬浮详情）
 * 函数索引（TOC）：_defaults/enhGet/_ensure/_save/_num/_el/hookGlobals/_strictOn/_strictBlock/_voiceStat/_refreshVoices/_hookVoices（+48 更多）
   ════════════════════════════════════════════════════════════════════ */
(function () {
  let ENH_KEY = 'enhSettings';
  let CUSTOM_PREFIX = 'cs_';
  let _orig = {};
  let _booted = false;

  /* ============ 基础工具 ============ */
  function _defaults() {
    return {
      strict: false,
      /* autoNext / voice 默认关。
         理由：自动开始下一轮会在无人值守时自己跑完一个 25 分钟番茄，结束时结算框
         关不掉且默认选中「完整🍅」——一键就是一条没做过的记录，而本应用整条价值链
         （统计 → 番茄树 → 金币 → 段位 → 解锁）全押在「记录是真的」上。
         语音播报同理：默认开口朗读比默认安静更打扰，需要的人自己去开。 */
      autoNext: false,
      /* 语音播报默认开：这功能的全部价值就在"不用看屏幕也知道进程"，
         默认关等于没做。老存档里躺着的 false 是旧默认，按下面的迁移抬起来。 */
      voice: true,
      /* 专注中陪伴语音：**默认关闭**。
   ★ 2026-10-25 改：原来是默认 true（理由写的是「用户既然开了语音就想要陪伴」），
     这个推断是错的 —— 用户开语音通常只想听「休息结束，回来继续专注吧」这类节点提示，
     没人预期专注中途有人突然开口。而且专注时注意力锁在视觉任务上，对突发听觉刺激的
     警戒反应会被放大（auditory startle），听感不是「有点烦」而是「吓一跳」。
     番茄钟这类工具本来就该只在节点说话：开始、结束、休息。中途开口是另一回事，
     得用户自己选。所以默认关，想要的人自己打开。 */
      companion: false,
      companionMin: 5,
      /* 念句子用哪个嗓音。空 = 交给系统默认。
         手机里常装了好几个中文 TTS 引擎（Google、厂商自带、第三方），
         默认挑哪个由 Chrome 决定，用户听着就是「一会儿好听一会儿难听」。
         存名字而不是对象：对象会在列表刷新后失效，赋给 utterance 就静默不出声。 */
      voiceName: '',
      preNotifySec: 30,      tickWork: false,
      /* 休息滴答默认打开：休息本来就是「离开桌面」的时段，需要一点存在感提醒
         「还没结束，别走远」；专注时反而要静（默认关）。 */
      tickBreak: true,
      tickVolume: 0.3,
      special: [
        { on: false, t: '', label: '' },
        { on: false, t: '', label: '' },
        { on: false, t: '', label: '' },
        { on: false, t: '', label: '' }
      ],
      sbDone: {},
      customAudio: {}
    };
  }
  function enhGet() {
    if (typeof appData === 'undefined' || !appData) return null;
    if (!appData[ENH_KEY]) appData[ENH_KEY] = _defaults();
    return appData[ENH_KEY];
  }
  function _ensure() {
    let s = enhGet();
    if (!s) return null;
    let d = _defaults();
    ['strict', 'autoNext', 'voice', 'companion', 'companionMin', 'voiceName', 'preNotifySec', 'tickWork', 'tickBreak', 'tickVolume'].forEach(function (k) {
      if (typeof s[k] === 'undefined') s[k] = d[k];
    });
    if (!Array.isArray(s.special) || s.special.length < 4) s.special = d.special.slice();
    for (let i = 0; i < s.special.length; i++) {
      if (!s.special[i] || typeof s.special[i] !== 'object') s.special[i] = { on: false, t: '', label: '' };
    }
    if (!s.sbDone || typeof s.sbDone !== 'object') s.sbDone = {};
    /* 滴答声默认值调整：休息时默认打开（旧默认 false）。
       与上面同一条原则 —— 只在「值仍精确等于旧默认、且没走过这次迁移」时才迁，
       走过一次就盖章，此后用户怎么设都不会被再翻。 */
    if ((s.tickDefaultV || 1) < 2) {
      if (s.tickBreak === false) s.tickBreak = true;
      s.tickDefaultV = 2;
    }
    /* 陪伴语音频率默认值 10 → 5 分钟。老存档里躺着的 10 是旧默认、不是用户选的，
       所以照上面的规矩：只在值仍等于旧默认时迁一次，迁过盖章。
       用户自己选过 15/20/0 的，一律不动。 */
    if ((s.companionMinV || 1) < 2) {
      if (s.companionMin === 10) s.companionMin = 5;
      s.companionMinV = 2;
    }
    if (!s.customAudio || typeof s.customAudio !== 'object') s.customAudio = {};
    /* 合理的功能默认值，老存档只迁移一次。
       不能无条件写 `s.autoNext = true; s.voice = true;` ——
       那等于把老存档里用户自己关掉的开关又掰回开，迁移不该覆盖用户的选择。
       这里只补「从没设过」的字段，设过的一律尊重原值；新存档的默认值见 _defaults()。 */
    if (!s.enhUIv) {
      if (typeof s.autoNext === 'undefined') s.autoNext = d.autoNext;
      if (!s.preNotifySec) s.preNotifySec = 30;
      if (typeof s.dailyGoalTarget === 'undefined') s.dailyGoalTarget = 8;
      if (typeof s.voice === 'undefined') s.voice = d.voice;
      s.enhUIv = 3;
    } else if (s.enhUIv === 1) {
      /* v1 存档缺 voice 字段才补默认；已显式设成 false 的保持 false */
      if (typeof s.voice === 'undefined') s.voice = d.voice;
      s.enhUIv = 3;
    } else if (s.enhUIv === 2) {
      /* enhUIv v2 → v3：v2 那条迁移曾把 autoNext / voice 无条件写成 true，那不是用户
         的选择，而是被覆盖后的残留。这里做一次性修正，但两个字段**分开处理**，因为
         数据风险不对等：
           · autoNext —— 被错写成 true 会在无人值守时自己跑完一个番茄并落一条假记录，
             整条价值链（统计→树→金币→段位）都押在「记录是真的」上，所以必须修正；
           · voice —— 最多让人多听一句，没有数据风险。而且现在的默认值本来就是 true
             （见 _defaults），再把它翻成 false 等于替用户做了「关掉」的决定。
         修正后 enhUIv 升到 3，此后永不再跑这一段。 */
      if (s.autoNext === true) s.autoNext = false;
      s.enhUIv = 3;
    }
    return s;
  }
  function _save() {
    try {
      saveData();
    } catch (e) { if (window.__silent) window.__silent(e, '02:_save'); }
  }
  function _num(v, d) {
    v = Number(v);
    return isFinite(v) ? v : d;
  }
  function _el(id) {
    return document.getElementById(id);
  }

  /* ============ ① 函数级挂钩 ============ */
  function hookGlobals() {
    if (window.__enhHooked) return;
    window.__enhHooked = true;
    _orig.playSound = window.playSound;
    _orig.finishPomodoro = window.finishPomodoro;
    _orig.interruptPomodoro = window.interruptPomodoro;
    _orig.resetToIdle = window.resetToIdle;
    _orig.onTimerComplete = window.onTimerComplete;
    _orig.startBreak = window.startBreak;
    _orig.startPomodoro = window.startPomodoro;
    _orig.startPomodoroCore = window.startPomodoroCore;
    _orig.renderStats = window.renderStats;

/* ---- 1) playSound：自定义音色优先，缺失回退原合成音 ---- */
    window.playSound = function (type) {
      try {
        if (typeof appData === 'undefined' || !appData || !appData.settings) return _orig.playSound(type);
        if (appData.settings.sound) return; /* 全局静音：含自定义音色一并静音 */
        if (appData.settings.sfxEnabled === false) return;
        let alias = { focusEnd: 'finish', breakEnd: 'reward' };
        let tone = alias[type] || type;
        let s = enhGet();
        if (!s || !s.customAudio || !s.customAudio[tone]) return _orig.playSound(type);
        let vol = _num(appData.settings.sfxVolume, 0.3);
        vol = Math.max(0, Math.min(1, vol));
        if (vol <= 0) return;
        _playCustom(tone, vol).catch(function () {
          try {
            _orig.playSound(type);
          } catch (e) { if (window.__silent) window.__silent(e, '02-hookGlobals'); }
        });
      } catch (e) {
        try {
          _orig.playSound(type);
        } catch (e2) { if (window.__silent) window.__silent(e2, '02:hookGlobals'); }
      }
    };

    /* ---- 2) 严格模式守卫 ---- */
    __replace_finishPomodoro(function () {
      try {
        if (_strictOn() && timerState && timerState.mode === 'focus' && timerState.running) {
          _strictBlock('🧘 严格模式中：这轮番茄还没跑完，先别提前结束～');
          return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '02-hookGlobals'); }
      return _orig.finishPomodoro.apply(this, arguments);
    });
    __replace_interruptPomodoro(function () {
      try {
        if (_strictOn() && timerState && timerState.mode === 'focus' && timerState.running) {
          _strictBlock('🧘 严格模式中：专注进行时不允许打断，坚持一下！');
          return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
      return _orig.interruptPomodoro.apply(this, arguments);
    });
    __replace_resetToIdle(function () {
      try {
        if (_strictOn() && timerState && timerState.mode === 'focus' && timerState.running) {
          _strictBlock('🧘 严格模式中：专注进行时不允许重置。');
          return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
      let r = _orig.resetToIdle.apply(this, arguments);
      setTimeout(function () {
        try {
          enhMaybeShowSpecial();
        } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
      }, 80);
      return r;
    });

    /* ---- 3) onTimerComplete：语音 + 自动下一轮 + 定点休息 ---- */
    __replace_onTimerComplete(function () {
      let prevMode = timerState ? timerState.mode : '';
      let r = _orig.onTimerComplete.apply(this, arguments);
      try {
        let st = timerState,
          s = _ensure();
        if (!st || !s) return r;
        /* 专注自然结束：报番茄数。文案原本只写了「开始 / 结束 / 休息节点」，
           但专注结束这一半从来没接语音 —— 只有提示音和通知，用户以为有声却在等。
           数用「已完成 + 这一颗」，因为结算落库发生在用户点完结算之后，此刻还没写进 records。 */
        if (prevMode === 'focus') {
          let n = 0;
          try {
            let today = getTodayStr();
            let recs = (appData && appData.records) || [];
            for (let i = 0; i < recs.length; i++) {
              if (getDateStr(recs[i].startTime) === today) n += getPomos(recs[i]);
            }
          } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
          if (s.voice) _speak(n ? '番茄完成，今天第 ' + fmtTomatoNum(n + 1) + ' 个' : '番茄完成，辛苦了');
        }
        if ((prevMode === 'shortBreak' || prevMode === 'longBreak') && st.mode === 'idle' && !st.running) {
          if (s.voice) _speak('休息结束，回来继续专注吧');
          let showed = false;
          try {
            showed = enhMaybeShowSpecial();
          } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
          if (!showed && s.autoNext && prevMode !== 'longBreak') {
            /* 成长节奏：短休结束可自动开启下一轮；长休（每 4 个一组后）结束不再自动开始，一组完整后停下，等用户主动开始下一组 */
            setTimeout(function () {
              try {
                let st2 = timerState,
                  e2 = _ensure();
                if (st2 && st2.mode === 'idle' && !st2.running && e2 && e2.autoNext) {
                  try {
                    showToast('▶️ 休息结束，自动开始下一轮专注');
                  } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
                  if (typeof window.startPomodoro === 'function') window.startPomodoro();
                }
              } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
            }, 900);
          }
        }
      } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
      return r;
    });

    /* ---- 4) startBreak：语音 ---- */
    __replace_startBreak(function (mode) {
      let r = _orig.startBreak.apply(this, arguments);
      try {
        let s = _ensure();
        if (
          s &&
          s.voice &&
          timerState &&
          (timerState.mode === 'shortBreak' || timerState.mode === 'longBreak') &&
          timerState.running
        ) {
          _speak(mode === 'long' ? '长休息开始，好好放松一下' : '短休息开始，放松一下吧');
        }
      } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
      return r;
    });

    /* ---- 5) 专注开始：语音 + 清定点休息待办 ---- */
    __replace_startPomodoroCore(function () {
      let r = _orig.startPomodoroCore.apply(this, arguments);
      try {
        let s = _ensure();
        if (s && s.voice && timerState && timerState.mode === 'focus' && timerState.running) {
          _speak('开始专注，加油');
        }
        _sbPending = null;
      } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
      return r;
    });

    /* ---- 6) renderStats：追加统计卡片渲染 ---- */
    window.renderStats = function () {
      let r = _orig.renderStats.apply(this, arguments);
      try {
        enhRenderCharts();
      } catch (e) { if (window.__silent) window.__silent(e, '02:hookGlobals'); }
      return r;
    };
  }
  function _strictOn() {
    let s = enhGet();
    return !!(s && s.strict);
  }
  function _strictBlock(msg) {
    try {
      playSound('error');
    } catch (e) { if (window.__silent) window.__silent(e, '02:_strictBlock'); }
    try {
      showToast(msg);
    } catch (e) { if (window.__silent) window.__silent(e, '02:_strictBlock'); }
    try {
      let ring = _el('timerRingFill') || _el('timerCircle');
      if (ring) {
        ring.classList.remove('enh-strict-pulse');
        void ring.offsetWidth;
        ring.classList.add('enh-strict-pulse');
        setTimeout(function () {
          ring.classList.remove('enh-strict-pulse');
        }, 900);
      }
    } catch (e) { if (window.__silent) window.__silent(e, '02:_strictBlock'); }
  }

  /* ============ ② 语音播报 ============
     四个必须叠起来的细节，少一条就会「点了没反应、也没提示」：
     1) getVoices() 首帧常返回空数组，全部嗓音要等 voiceschanged 才到齐 → 缓存 + 监听一次。
     2) Android Chrome 会给「用户手势之前」的页面上锁 → 首次触摸时 resume() 预热一次。
     3) ★ cancel() 之后不能再 speak 之前 new 出来的 utterance：Chrome 会把它当已取消而静默丢弃。
        所以每次都在 cancel 之后再新建对象，绝不复用。
     4) 失败必须看得见：onerror 和「几秒内没有 onstart」都要报出来，否则用户只能猜。 */
  let _voiceCache = [];
  let _voiceHooked = false;
  let _speechBlocked = false; /* 被浏览器手势策略拒过：之后不再反复弹提示 */
  /* 语音链路自身的版本戳。设置页会把它印出来：
     用户报「还是没声音」时，先看他手机上显示的是不是最新这一枚 ——
     Chrome 的 HTTP 缓存会让 fetch() 也拿到旧的 3MB 页面，改多少次都白改。 */
  const VOICE_BUILD = 'V8-2026-10-22';
  /* 把一次试听的完整结果写到设置页里，不用再开任何别的页面 */
  function _voiceStat(msg) {
    try {
      let el = document.getElementById('enhVoiceStat');
      if (el) el.textContent = msg;
    } catch (e) { if (window.__silent) window.__silent(e, '02:_voiceStat'); }
    if (window.console) console.warn('[语音播报] ' + msg);
  }
  function _refreshVoices() {
    try {
      if (!('speechSynthesis' in window)) return _voiceCache;
      let vs = speechSynthesis.getVoices();
      if (vs && vs.length) _voiceCache = vs;
    } catch (e) { if (window.__silent) window.__silent(e, '02:_refreshVoices'); }
    return _voiceCache;
  }
  function _hookVoices() {
    if (_voiceHooked) return;
    _voiceHooked = true;
    try {
      _refreshVoices();
      if ('onvoiceschanged' in speechSynthesis) {
        speechSynthesis.addEventListener('voiceschanged', function () { _refreshVoices(); });
      }
    } catch (e) { if (window.__silent) window.__silent(e, '02:_hookVoices'); }
  }
  /* 用户挑的那个嗓音。存的是名字（voiceName），每次从最新列表里重取对象，
     取不到（换了引擎 / 列表还没就绪）就返回 null，退回系统默认 —— 绝不用旧对象。 */
  function _resolveVoice() {
    try {
      let want = _ensure().voiceName;
      if (!want) return null;
      let vs = _refreshVoices();
      for (let i = 0; i < vs.length; i++) {
        if (vs[i].name === want) return vs[i];
      }
    } catch (e) { if (window.__silent) window.__silent(e, '02:_resolveVoice'); }
    return null;
  }
  /* 列出能读中文的嗓音，给设置页做成下拉。localService 排前面：
     联网嗓音在弱网或离线时会静默失败，本机引擎更稳。 */
  function _voiceOptions() {
    let out = [];
    try {
      let vs = _refreshVoices();
      for (let i = 0; i < vs.length; i++) {
        let lang = vs[i].lang || '';
        if (!/zh|cmn|yue|Hans|Hant/i.test(lang)) continue;
        out.push({
          name: vs[i].name,
          lang: lang,
          local: !!vs[i].localService,
          label: vs[i].name + ' · ' + lang + (vs[i].localService ? ' · 本机' : ' · 联网')
        });
      }
      out.sort(function (a, b) { return (b.local ? 1 : 0) - (a.local ? 1 : 0); });
    } catch (e) { if (window.__silent) window.__silent(e, '02:_voiceOptions'); }
    return out;
  }
  function _zhVoice() {
    try {
      let vs = _refreshVoices();
      let fallback = null;
      /* 优先本机嗓音：联网嗓音在弱网/离线时会静默失败 */
      for (let i = 0; i < vs.length; i++) {
        let lang = vs[i].lang || '';
        if (/zh[-_](CN|Hans)/i.test(lang)) {
          if (vs[i].localService) return vs[i];
          if (!fallback) fallback = vs[i];
        }
      }
      if (fallback) return fallback;
      for (let j = 0; j < vs.length; j++) {
        if (/^zh/i.test(vs[j].lang || '')) return vs[j];
      }
    } catch (e) { if (window.__silent) window.__silent(e, '02:_zhVoice'); }
    return null;
  }
  function _zhCount() {
    let vs = _refreshVoices(), n = 0;
    for (let i = 0; i < vs.length; i++) if (/^zh/i.test(vs[i].lang || '')) n++;
    return n;
  }
  function _speechReport(msg) {
    try {
      showToast('🔇 ' + msg);
    } catch (e) { if (window.__silent) window.__silent(e, '02:_speechReport'); }
    if (window.console) console.warn('[语音播报] ' + msg);
  }
  /* 最近发出的语音文案（最多 20 条）。用途有二：手机上排查「到底有没有调用 speak」，
     以及 smoke 断言「这一刻播的是哪一类句子」—— 语音本身没法在测试里听见。 */
  let _spokenLog = [];
  function _recordSpoken(text) {
    try {
      _spokenLog.push(String(text));
      if (_spokenLog.length > 20) _spokenLog.shift();
    } catch (e) { if (window.__silent) window.__silent(e, '02:_recordSpoken'); }
  }
  /* 统一出口。opts.report=true 时把失败原因告诉用户（试听用），自动播报则保持安静。
     opts.diag=true 时把每一步都写进设置页的状态框（试听专供，排查用）。 */
  function _say(text, opts) {
    opts = opts || {};
    let tries = opts.tries || 0;
    function diag(m) { if (opts.diag) _voiceStat(m); }
    try {
      _hookVoices();
      /* 嗓音为空（安卓 Chrome 首次调用必然如此）时**不能**等 voiceschanged 再播：
         那样就跳出了用户手势的同步栈，speak 会被静默丢弃。
         直接同步 speak、不指定 u.voice，让 Chrome 用系统默认 TTS 按 u.lang 读。 */
      let vs = _refreshVoices();
      diag('[' + VOICE_BUILD + '] 嗓音 ' + vs.length + ' 个 / 中文 ' + _zhCount() + ' 个；resume、speak 依次调用…');
      try { speechSynthesis.resume(); } catch (e) { if (window.__silent) window.__silent(e, '02:_say-resume'); }
      /* 只在真的有声音在播时才 cancel。无条件 cancel 紧跟 speak 在安卓 Chrome 上
         偶发把新句子一起吞掉 —— 正常路径（没有正在朗读）就完全不要碰 cancel。 */
      try {
        if (speechSynthesis.speaking || speechSynthesis.pending) {
          diag('有正在朗读的句子，先 cancel 再重说');
          speechSynthesis.cancel();
        }
      } catch (e) { if (window.__silent) window.__silent(e, '02:_say-cancel'); }
      /* ★ 必须同步建对象、同步 speak，绝不能包进 setTimeout：
         安卓 Chrome 只在「用户手势的同步调用栈」里接受 speak()，一旦跳出手势（哪怕只差一个
         定时器 tick），调用就被静默丢弃 —— 不抛错、不触发 onerror，表现就是「点了没声音」。
         之前出问题是复用了 cancel() 之前创建的对象，不是「紧接 cancel 之后 speak」本身。 */
      let u;
        try {
          u = new SpeechSynthesisUtterance(String(text));
        } catch (e) {
          if (opts.report) _speechReport('这台浏览器创建不了语音对象');
          return;
        }
        /* ★ 不缓存语音对象、只缓存名字。把「早先抓到」的 speaker 对象赋给 utterance，
           只要它不是 Chrome 当前认识的实例（列表刷新过、或来自早期空表），speak() 就会
           静默失败：不报 onerror、不出声。所以每次 speak 都从此刻的最新列表里重取。
           用户没挑过（voiceName 为空）就完全不设 u.voice，交给系统默认。 */
        u.lang = 'zh-CN';
        let pick = _resolveVoice();
        if (pick) {
          u.voice = pick;
          u.lang = pick.lang || 'zh-CN';
        }
        u.rate = 1;
        u.volume = 1;
        u.pitch = 1;
        let settled = false;
        u.onstart = function () { settled = true; _speechBlocked = false; diag('[' + VOICE_BUILD + '] ★ 引擎已开口（onstart）'); };
        u.onend = function () { diag('[' + VOICE_BUILD + '] 念完了（onend）'); };
        u.onerror = function (ev) {
          settled = true;
          let code = (ev && ev.error) || '未知';
          diag('[' + VOICE_BUILD + '] ✗ 引擎报错：' + code);
          if (code === 'not-allowed' || code === 'interrupted') {
            if (!_speechBlocked && opts.report) {
              _speechBlocked = true;
              _speechReport('浏览器拦下了朗读（' + code + '）：先在设置里点一次「试听语音」，之后再播报就正常了');
            }
            return;
          }
          if (code === 'canceled') return; /* 被下一次播报打断，正常 */
          if (opts.report) _speechReport('语音引擎报错：' + code);
        };
        try {
          speechSynthesis.speak(u);
          diag('[' + VOICE_BUILD + '] speak() 已调用，等引擎回应…');
        } catch (e) {
          if (opts.report) _speechReport('speak 调用失败：' + ((e && e.message) || e));
          diag('[' + VOICE_BUILD + '] ✗ speak 抛错：' + ((e && e.message) || e));
          return;
        }
        if (opts.diag) {
          setTimeout(function () {
            if (!settled) {
              diag('[' + VOICE_BUILD + '] ✗ 3 秒没开口。speaking=' + speechSynthesis.speaking +
                ' pending=' + speechSynthesis.pending + ' 嗓音=' + _refreshVoices().length +
                ' 个。\n下一步：系统设置 → 无障碍 → 文字转语音，看有没有装中文引擎、试听能不能响；' +
                '再确认媒体音量不是 0。');
            }
          }, 3000);
        }
        if (opts.report) {
          setTimeout(function () {
            if (!settled) _speechReport('点了 3 秒还没开口：手机里嗓音 ' + _refreshVoices().length + ' 个、中文 ' + _zhCount() + ' 个。检查系统「设置 → 无障碍 → 文字转语音」和媒体音量');
          }, 3000);
        }
    } catch (e) { if (window.__silent) window.__silent(e, '02:_say'); }
  }
  /* 试听专用：走 _say，但把每一步写进设置页的状态框 */
  function _sayForceDiagnose(text) {
    try {
      if (!('speechSynthesis' in window)) {
        _voiceStat('[' + VOICE_BUILD + '] ✗ 这个浏览器内核没有 speechSynthesis（微信/VIA 等内置内核常见）');
        _speechReport('当前浏览器不支持语音播报，请用 Chrome 打开');
        return;
      }
      let vv = _refreshVoices();
      _voiceStat('[' + VOICE_BUILD + '] 点击已触发。嗓音 ' + vv.length + ' 个 / 中文 ' + _zhCount() + ' 个，正在调用 speak…');
      _say(text, { report: true, diag: true });
    } catch (e) {
      _voiceStat('[' + VOICE_BUILD + '] ✗ 试听函数抛错：' + ((e && e.message) || e));
    }
  }
  function _speak(text) {
    try {
      if (appData && appData.settings && appData.settings.sound) return; /* 全局静音：语音也静 */
      let s = _ensure();
      if (!s || !s.voice) return;
      /* 记录「决定要播」，而不是「成功播了」：这台设备根本没有语音引擎时也要留痕，
         否则排查时只能看到一片空白，分不清是没触发还是没发声。 */
      _recordSpoken(text);
      if (!('speechSynthesis' in window)) return;
      _say(String(text), { report: false });
    } catch (e) { if (window.__silent) window.__silent(e, '02:_speak'); }
  }
  /* 试听：无视开关强制读一句，并把失败原因直接说出来 */
  function _speakForce(text) {
    try {
      if (appData && appData.settings && appData.settings.sound) {
        _speechReport('已开启全局静音，先关掉它再试听');
        return;
      } /* 全局静音：试听也尊重 */
      if (!('speechSynthesis' in window)) {
        _speechReport('当前浏览器不支持语音播报');
        return;
      }
      _hookVoices();
      /* 不因为「筛选不到中文嗓音」就不说话：安卓上 lang 的写法五花八门
         （zh-CN / zh_CN / cmn-Hans-CN / 甚至只报 en-US 但 TTS 服务仍是中文），
         在这里提前 return 等于把能出声的情况也一起掐掉。直接让 Chrome 用它自己的默认。 */
      _recordSpoken(text || '语音播报测试');
      _sayForceDiagnose(String(text || '语音播报测试'));
    } catch (e) { if (window.__silent) window.__silent(e, '02:_speakForce'); }
  }
  /* ============ ②b 专注中陪伴语音 ============
     每 N 分钟念一句鼓励或提醒。设计上三条硬约束，缺一条就会从「陪伴」变成「噪音」：
     1) 只在专注、且页面在前台时播：后台的 speak() 会被浏览器丢掉，还会在回到前台时
        把攒下的句子一次性排队念完 —— 那是最糟的体验。
     2) 结束前 90 秒一律不播：那段时间归「准备收尾」那一句，两句撞在一起谁也听不清。
     3) 同一个番茄内不重复同一句：按桶（早/中/晚）记已用下标，用光才重置。
     另外首句要等满一个间隔才播（按已流逝秒数算），否则一按开始就立刻来一句，像在催。 */
  let _comp = { key: '', lastAtSec: 0, used: {} };
  /* 测试专用：无头/后台标签页里 document.hidden 恒为 true，陪伴语音会整段被跳过，
     smoke 就测不到任何东西。这个开关只由 __voiceHooks.forceVisible 打开，业务路径永不置位。 */
  let _compForceShow = false;
  /* 三桶按剩余时间比例选：>0.66 早段 / >0.33 中段 / 其余晚段。
     写作要求：短句、能一口气念完（TTS 念长句像播音腔，听着出戏）；
     鼓励为主，实用提醒（喝水、看远处）各桶最多留一两条 —— 提醒太多会变成催命。 */
  const COMPANION_LINES = {
    early: [
      '开始吧，把注意力放在眼前这一件事上',
      '深呼吸，肩膀放松，慢慢进入状态',
      '坐直一点，别让手机把你吸走',
      '刚开头最难，撑过这几分钟就顺了',
      '能坐下来开始，你今天就赢了一半',
      '不追求完美，先进入状态就好',
      '现在这一刻，只需要专注这一件事',
      '环境安静下来，心也会跟着安静',
      '你已经迈出最难的第一步了',
      '别想还有多久，先把眼前这点做完',
      '一次只做一件，做完一件就少一件',
      '稳住，节奏对了就不觉得累'
    ],
    mid: [
      '还在专注吗？跑神了就把注意力拉回来',
      '加油，你比自己以为的更能坚持',
      '喝口水吧，嗓子干了效率会掉',
      '抬头看看远处，让眼睛歇十秒',
      '这一段做得不错，稳住节奏',
      '深呼吸一下，把手上的事做完再说',
      '别急着刷手机，再坚持一会儿就过了',
      '你正在做的事，值得被认真对待',
      '认真的人不常有，你算一个',
      '不用很快，稳稳地往前走就行',
      '累了就慢一点，但别停下来',
      '这一刻的专注，以后都会算数',
      '抬头挺胸，你现在的样子挺好看',
      '别人在刷手机，你在往前走',
      '没人在看你，放心地把这事做好',
      '感觉难，说明你在长本事',
      '专注不是天赋，是练出来的，你正在练',
      '再坚持一次呼吸的时间',
      '今天不必做得完美，做得下去就行',
      '你已经在路上了，这比什么都强'
    ],
    late: [
      '已经走了一大半，别在最后松劲',
      '还剩一点点，收好尾',
      '把最后这几分钟做扎实，别留半截',
      '快到了，保持住这个节奏',
      '最后一段了，把气儿憋住',
      '别在终点前松手，你差一点点就到',
      '收尾最省力，也最容易出彩',
      '坚持到这里的，已经是少数人了',
      '马上就能画上句号，值得再认真一次',
      '把尾巴收干净，明天接着往前走'
    ]
  };
  function _compPick(bucket) {
    let pool = COMPANION_LINES[bucket] || COMPANION_LINES.mid;
    let fresh = [];
    for (let i = 0; i < pool.length; i++) {
      if (!_compUsedHas(bucket, i)) fresh.push(i);
    }
    if (!fresh.length) {
      /* 这一桶用光了：只清本桶的印记，其他桶不受影响 */
      for (let k in _comp.used) {
        if (String(k).indexOf(bucket + ':') === 0) delete _comp.used[k];
      }
      for (let j = 0; j < pool.length; j++) fresh.push(j);
    }
    let pick = fresh[Math.floor(Math.random() * fresh.length)];
    _comp.used[bucket + ':' + pick] = 1;
    return pool[pick];
  }
  function _compUsedHas(bucket, i) {
    return !!_comp.used[bucket + ':' + i];
  }
  function enhCompanionTick(st, s) {
    try {
      if (!s || !s.voice || !s.companion) return;
      if (!st || !st.running || st.mode !== 'focus') return;
      if (document.hidden && !_compForceShow) return; /* 后台播不出声，还会在回前台时排队补念 */
      let total = Number(st.totalDuration) || 0;
      let left = Number(st.remaining) || 0;
      if (total <= 0 || left <= 0) return;
      if (left <= 90) return; /* 收尾句归「结束前提醒」 */
      let key = String(st.startTime || st.endAt || 0);
      if (_comp.key !== key) {
        _comp.key = key;
        _comp.lastAtSec = 0;
        _comp.used = {};
        _comp.spoke = false;
      }
      let rawMin = Number(s.companionMin);
      if (!isFinite(rawMin)) rawMin = 10;
      /* 选「只在开局说一次」时不能套用间隔公式：rawMin=0 会让 gapSec 掉到下限 60 秒，
         变成每分钟一句 —— 那正是这个选项想避免的。 */
      let oneShot = rawMin <= 0;
      if (oneShot && _comp.spoke) return;
      /* 「只在开局说一次」= 一开始就开口，不套间隔下限；其余模式下 60 秒是防抖底线，
         避免把「每 5 分钟」写成 0 之类的脏数据变成每秒一句。 */
      let gapSec = oneShot ? 0 : Math.max(60, rawMin * 60);
      /* 封顶：一句都不许超过每「1/5 番茄时长」一条。
         没有这道限制时，「每 5 分钟」配 60 分钟番茄 = 12 句，那就不是陪伴是骚扰；
         有了它，25 分钟的番茄仍是 5 分钟一句（total/5 正好 300 秒），
         50 分钟的番茄自动放宽到 10 分钟一句，总数稳定在四到五句。 */
      if (!oneShot) gapSec = Math.max(gapSec, total / 5);
      let elapsed = total - left;
      if (elapsed - _comp.lastAtSec < gapSec) return;
      _comp.lastAtSec = elapsed;
      if (oneShot) _comp.spoke = true;
      let ratio = left / total;
      let bucket = ratio > 0.66 ? 'early' : ratio > 0.33 ? 'mid' : 'late';
      _speak(_compPick(bucket));
    } catch (e) { if (window.__silent) window.__silent(e, '02:enhCompanionTick'); }
  }
  /* 首次用户手势预热：Android Chrome 在没手势之前可能拒发语音 */
  function _prewarmSpeech() {
    try {
      if (!('speechSynthesis' in window)) return;
      _hookVoices();
      _refreshVoices();
      speechSynthesis.resume();
    } catch (e) { if (window.__silent) window.__silent(e, '02:_prewarmSpeech'); }
  }
  try {
    document.addEventListener('pointerdown', _prewarmSpeech, { once: true, passive: true });
    document.addEventListener('touchstart', _prewarmSpeech, { once: true, passive: true });
    _hookVoices();
  } catch (e) { if (window.__silent) window.__silent(e, '02:_prewarm-hook'); }
  /* 测试钩子：整段 IIFE 的内部状态外面够不着，smoke 只能靠这里。
     只读 + 一个 reset，不进业务路径，删掉不影响运行。 */
  try {
    window.__voiceHooks = {
      tick: enhCompanionTick,
      pick: _compPick,
      log: function () { return _spokenLog.slice(); },
      clearLog: function () { _spokenLog = []; },
      state: function () { return _comp; },
      resetComp: function () { _comp = { key: '', lastAtSec: 0, used: {}, spoke: false }; },
      forceVisible: function (v) { _compForceShow = !!v; },
      /* 句子池。让用例断言「念的是这一桶里的句子」，而不是把文案抄进测试 ——
         抄进测试就变成：改一句台词要改两处，忘了改就红。 */
      lines: function () { return COMPANION_LINES; }
    };
  } catch (e) { if (window.__silent) window.__silent(e, '02:_voiceHooks'); }

  /* ============ ③ 自定义提示音 ============ */
  let _sndCache = {};
  let ENH_TONES = [
    { k: 'finish', icon: '🍅', label: '番茄 / 专注完成' },
    { k: 'reward', icon: '☕', label: '休息结束 / 奖励' },
    { k: 'start', icon: '▶️', label: '开始专注' },
    { k: 'breakStart', icon: '🧘', label: '休息开始' },
    { k: 'nearEnd', icon: '⏳', label: '结束前提醒' },
    { k: 'microStart', icon: '💆', label: '微休息开始' }
  ];
  function _toneLabel(t) {
    for (let i = 0; i < ENH_TONES.length; i++) {
      if (ENH_TONES[i].k === t) return ENH_TONES[i].label;
    }
    return t;
  }
  function _revoke(tone) {
    let c = _sndCache[tone];
    if (c) {
      try {
        URL.revokeObjectURL(c.url);
      } catch (e) { if (window.__silent) window.__silent(e, '02:_revoke'); }
    }
    delete _sndCache[tone];
  }
  function _ensurePlay(a) {
    return new Promise(function (res, rej) {
      try {
        let p = a.play();
        if (p && p.then)
          p.then(
            function () {
              res();
            },
            function () {
              rej(new Error('rejected'));
            }
          );
        else res();
      } catch (e) {
        rej(e);
      }
    });
  }
  function _playCustom(tone, vol) {
    let c = _sndCache[tone];
    if (c && c.audio) {
      try {
        c.audio.volume = vol;
        c.audio.currentTime = 0;
        return _ensurePlay(c.audio);
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return new Promise(function (res, rej) {
      idbGet(CUSTOM_PREFIX + tone)
        .then(function (blob) {
          if (!blob) {
            rej(new Error('noblob'));
            return;
          }
          let url = URL.createObjectURL(blob);
          let a = new Audio();
          a.src = url;
          a.preload = 'auto';
          a.volume = vol;
          let done = false;
          let ok = function () {
            if (done) return;
            done = true;
            _sndCache[tone] = { audio: a, url: url };
            res();
          };
          let fail = function () {
            if (done) return;
            done = true;
            try {
              URL.revokeObjectURL(url);
            } catch (e) { if (window.__silent) window.__silent(e, '02:_playCustom'); }
            rej(new Error('fail'));
          };
          a.onerror = fail;
          a.oncanplaythrough = ok;
          setTimeout(function () {
            if (!done) {
              _ensurePlay(a).then(ok).catch(fail);
            }
          }, 500);
        })
        .catch(function () {
          rej(new Error('idberr'));
        });
    });
  }
  function _uploadCustom(tone, file) {
    if (!file) return Promise.resolve();
    if (file.type && file.type.indexOf('audio/') !== 0) {
      try {
        showToast('⚠️ 请选择音频文件（mp3/wav/ogg/m4a 等）');
      } catch (e) { if (window.__silent) window.__silent(e, '02:_uploadCustom'); }
      return Promise.resolve();
    }
    if (file.size > 8 * 1024 * 1024) {
      try {
        showToast('⚠️ 音频不能超过 8MB');
      } catch (e) { if (window.__silent) window.__silent(e, '02:_uploadCustom'); }
      return Promise.resolve();
    }
    let p = idbSet(CUSTOM_PREFIX + tone, file);
    return p.then(function () {
      try {
        _ensure().customAudio[tone] = { name: file.name, size: file.size, type: file.type || '' };
        _save();
        _revoke(tone);
        enhRenderSndRows();
        try {
          showToast('✅ 「' + _toneLabel(tone) + '」自定义提示音已生效');
        } catch (e) { if (window.__silent) window.__silent(e, '02:_uploadCustom'); }
      } catch (e) { if (window.__silent) window.__silent(e, '02:_uploadCustom'); }
    });
  }
  function _clearCustom(tone) {
    try {
      delete _ensure().customAudio[tone];
      _save();
      _revoke(tone);
    } catch (e) { if (window.__silent) window.__silent(e, '02:_clearCustom'); }
    try {
      idbSet(CUSTOM_PREFIX + tone, null);
    } catch (e) { if (window.__silent) window.__silent(e, '02:_clearCustom'); }
    enhRenderSndRows();
    try {
      showToast('↩️ 「' + _toneLabel(tone) + '」已还原为内置提示音');
    } catch (e) { if (window.__silent) window.__silent(e, '02:_clearCustom'); }
  }

  /* ============ ④ 滴答声 ============ */
  let _tickCtx = null,
    _lastTickSec = -1;
  function _playTick() {
    try {
      if (appData && appData.settings && appData.settings.sound) return; /* 全局静音：滴答声也静 */
      if (!_tickCtx) {
        let AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        _tickCtx = new AC();
      }
      if (_tickCtx.state === 'suspended') {
        try {
          _tickCtx.resume();
        } catch (e) { if (window.__silent) window.__silent(e, '02-playTick'); }
      }
      let t0 = _tickCtx.currentTime;
      /* 滴答音量：独立的专用滑杆（settings 增强模块 enhSettings.tickVolume 0~1，默认 0.3）。
         与「音效音量」互不干扰——调低滴答不会拖累其它提示音，反之亦然。 */
      let _es = null;
      try {
        _es = _ensure();
      } catch (e) { if (window.__silent) window.__silent(e, '02:_playTick'); }
      let tv = _es && isFinite(_es.tickVolume) ? _es.tickVolume : 0.3;
      tv = Math.max(0, Math.min(1, tv));
      if (tv <= 0) return; /* 滑杆拖到 0 = 关闭滴答 */
      let nLen = Math.max(1, Math.round(_tickCtx.sampleRate * 0.032));
      let buf = _tickCtx.createBuffer(1, nLen, _tickCtx.sampleRate);
      let d0 = buf.getChannelData(0);
      for (let i0 = 0; i0 < nLen; i0++) {
        let p0 = i0 / nLen;
        d0[i0] = (Math.random() * 2 - 1) * Math.pow(1 - p0, 2.4);
      }
      let bsrc = _tickCtx.createBufferSource();
      bsrc.buffer = buf;
      let lp = _tickCtx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      let ng = _tickCtx.createGain();
      ng.gain.value = tv * 0.33; /* 默认 0.3 → ≈0.10 */
      bsrc.connect(lp);
      lp.connect(ng);
      ng.connect(_tickCtx.destination);
      bsrc.start(t0);
      let o = _tickCtx.createOscillator(),
        g = _tickCtx.createGain();
      o.type = 'sine';
      o.frequency.value = 1568; /* G6：轻 ping 让安静环境里也听得清 */
      o.connect(g);
      g.connect(_tickCtx.destination);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(tv * 0.04, t0 + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.014);
      o.start(t0);
      o.stop(t0 + 0.02);
    } catch (e) { if (window.__silent) window.__silent(e, '02:_playTick'); }
  }
  function _tickOn(mode) {
    let s = _ensure();
    if (!s) return false;
    if (mode === 'focus') return !!s.tickWork;
    if (mode === 'shortBreak' || mode === 'longBreak') return !!s.tickBreak;
    return false;
  }

  /* ===== 滴答改为"01c 数字刷新后同帧触发" =====
   * 01c updateTimerDisplay 末尾调用 window.__onTimerFrame(timerState)。
   * 与原轮询(独立 1s interval)相比：滴答与屏幕上秒数变化同源、同帧，
   * 不再出现"秒跳一下、声音隔一会才响"的错位观感。守卫与原逻辑等价：
   * 页面可见 + running + remaining>0 + 对应开关开 + 秒值变化才播。 */
  function _onTimerFrame(st) {
    try {
      if (!st) return;
      if (!document.hidden && st.running && st.remaining > 0 && _tickOn(st.mode)) {
        let sec = Math.max(0, Math.floor(st.remaining));
        if (sec !== _lastTickSec && sec > 0 && sec < 4 * 3600) {
          _lastTickSec = sec;
          _playTick();
        }
      } else {
        _lastTickSec = -1;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '02-onTimerFrame'); }
  }
  window.__onTimerFrame = _onTimerFrame;

  /* ============ ⑤ 每秒观察器 ============ */
  let _preDone = {},
    _preKey = '';
  let _sbPending = null; /* 246 行赋值在函数定义内(运行晚于声明) → let 安全 */
  let _sbLastToastMin = -1;
  let _lastDay = '';
  function _minOfDay() {
    let d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  function startObservers() {
    /* 业务心跳 · 每秒自律（跨天复位 + 后台预提醒系统通知依赖 hidden 运行，不可休眠） */
    setInterval(function () {
      try {
        enhEachSecond();
      } catch (e) { if (window.__silent) window.__silent(e, '02-startObservers'); }
    }, 1000);
    /* 业务心跳 · 定点休息检查 5s（到点窗口+空闲补弹，需保活） */
    setInterval(function () {
      try {
        enhCheckSpecialTime();
      } catch (e) { if (window.__silent) window.__silent(e, '02:startObservers'); }
    }, 5000);
  }
  function enhEachSecond() {
    let st = timerState;
    if (!st) return;
    let s = _ensure();
    if (!s) return;
    let today = getTodayStr();
    if (_lastDay && _lastDay !== today) {
      s.sbDone = {};
      _preDone = {};
      _save();
      _sbPending = null;
    }
    _lastDay = today;

    /* 滴答声：已迁至 window.__onTimerFrame（由 01c 数字刷新后同帧触发，见 _onTimerFrame）。
       此处仅保留"非运行态复位防呆"，避免旧轮询与新钩子双播。 */
    if (!(st.running && st.remaining > 0)) {
      _lastTickSec = -1;
    }

    /* 结束前 N 秒预提醒：仅页面在后台时发系统通知（前台由「结束前 1 分钟提醒音」负责，避免双提醒） */
    let inScope =
      (st.mode === 'focus' || st.mode === 'shortBreak' || st.mode === 'longBreak') && st.running && st.remaining > 0;
    let pre = s.preNotifySec > 0 && inScope && document.hidden && st.remaining <= s.preNotifySec;
    if (pre) {
      let key = st.mode + '|' + (st.startTime || st.endAt || 0);
      if (key !== _preKey) {
        _preDone = {};
        _preKey = key;
      }
      if (!_preDone[key]) {
        _preDone[key] = true;
        let isF = st.mode === 'focus';
        try {
          notify(
            isF ? '⏳ 专注即将结束' : '⏳ 休息即将结束',
            isF ? '还剩 ' + s.preNotifySec + ' 秒，准备收尾吧' : '还剩 ' + s.preNotifySec + ' 秒，准备回来专注啦'
          );
        } catch (e) { if (window.__silent) window.__silent(e, '02:enhEachSecond'); }
        if (s.voice) _speak(isF ? '专注还剩最后一点时间，准备收尾' : '休息即将结束，准备回来');
      }
    } else {
      _preKey = '';
    }

    enhCompanionTick(st, s);
    enhCheckSpecialTime();
  }
  /* 定点休息：到点后 5 分钟内触发 */
  function enhCheckSpecialTime() {
    let s = _ensure();
    if (!s) return;
    let st = timerState;
    let now = _minOfDay(),
      today = getTodayStr();
    if (_sbPending && _sbPending.date !== today) _sbPending = null;
    for (let i = 0; i < 4; i++) {
      let slot = s.special[i];
      if (!slot || !slot.on || !slot.t) continue;
      let ps = String(slot.t).split(':');
      let tm = (parseInt(ps[0], 10) || 0) * 60 + (parseInt(ps[1], 10) || 0);
      if ((s.sbDone[today] || {})[i]) continue;
      let delta = now - tm;
      if (delta < 0 || delta > 5) continue;
      let label = (slot.label && String(slot.label).trim()) || '休息时间';
      if (st && st.running) {
        if (now !== _sbLastToastMin) {
          _sbLastToastMin = now;
          try {
            showToast('🍱 ' + label + '到啦！完成当前这轮就去休息一下吧');
          } catch (e) { if (window.__silent) window.__silent(e, '02:enhCheckSpecialTime'); }
          if (s.voice) _speak(label + '到啦，注意休息');
        }
        _sbPending = { slot: i, date: today, tm: tm, label: label };
      } else {
        _sbShowModal(label, slot.t);
        _sbMarkDone(i);
        _sbPending = null;
      }
      break;
    }
    /* 空闲后的待办弹窗（30 分钟内仍有效） */
    if (_sbPending && st && st.mode === 'idle' && !st.running) {
      let p = _sbPending;
      if (now - p.tm <= 30 && !(s.sbDone[today] || {})[p.slot]) {
        _sbPending = null;
        _sbShowModal(p.label, p.tm >= 0 ? '' : ''); /* 时间在标题内 */
        _sbMarkDone(p.slot);
      } else if (now - p.tm > 30) {
        _sbPending = null;
      }
    }
  }
  function enhMaybeShowSpecial() {
    try {
      let s = _ensure();
      if (!s) return false;
      let st = timerState;
      if (!st || st.mode !== 'idle' || st.running) return false;
      let now = _minOfDay(),
        today = getTodayStr();
      for (let i = 0; i < 4; i++) {
        let slot = s.special[i];
        if (!slot || !slot.on || !slot.t) continue;
        let ps = String(slot.t).split(':');
        let tm = (parseInt(ps[0], 10) || 0) * 60 + (parseInt(ps[1], 10) || 0);
        let delta = now - tm;
        if (delta < 0 || delta > 5) continue;
        if ((s.sbDone[today] || {})[i]) continue;
        _sbShowModal((slot.label && String(slot.label).trim()) || '休息时间', slot.t);
        _sbMarkDone(i);
        return true;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '02:enhMaybeShowSpecial'); }
    return false;
  }
  function _sbMarkDone(i) {
    try {
      let s = _ensure(),
        t = getTodayStr();
      if (!s.sbDone[t]) s.sbDone[t] = {};
      s.sbDone[t][i] = true;
      _save();
    } catch (e) { if (window.__silent) window.__silent(e, '02:_sbMarkDone'); }
  }
  function _sbClearToday() {
    try {
      _ensure().sbDone = {};
      _save();
    } catch (e) { if (window.__silent) window.__silent(e, '02:_sbClearToday'); }
  }
  function _sbShowModal(label, timeStr) {
    try {
      let t = _el('enhSbTitle'),
        m = _el('enhSbMsg');
      if (!t || !m) return;
      t.textContent = '🍱 ' + label + '到啦';
      m.textContent =
        (timeStr ? '现在 ' + timeStr + '，' : '') + '是定点休息时间。起身走走、喝口水、看看窗外，让大脑切换一下。';
      try {
        showModal('enhSbModal');
      } catch (e) { if (window.__silent) window.__silent(e, '02:_sbShowModal'); }
    } catch (e) { if (window.__silent) window.__silent(e, '02:_sbShowModal'); }
  }
  function _enhSbStart() {
    try {
      closeModal('enhSbModal');
    } catch (e) { if (window.__silent) window.__silent(e, '02:_enhSbStart'); }
    try {
      let st = timerState;
      if (st && (st.mode === 'idle' || st.mode === 'shortBreak' || st.mode === 'longBreak')) {
        startBreak('short');
      }
    } catch (e) { if (window.__silent) window.__silent(e, '02:_enhSbStart'); }
  }
  function _enhSbSkip() {
    try {
      closeModal('enhSbModal');
    } catch (e) { if (window.__silent) window.__silent(e, '02:_enhSbSkip'); }
    try {
      showToast('已跳过本次定点休息');
    } catch (e) { if (window.__silent) window.__silent(e, '02:_enhSbSkip'); }
  }

  /* ============ ⑥ 统计渲染（带聚合缓存，防大数据卡顿） ============ */
  function _recs() {
    return typeof appData !== 'undefined' && appData && Array.isArray(appData.records) ? appData.records : [];
  }
  /* 缓存键：记录数 + 末条记录标识 + 日期。任一变化才重扫，切页/重复渲染不再全量遍历 */
  let _aggKey = function () {
    let recs = _recs();
    let last = recs.length ? recs[recs.length - 1] : null;
    return recs.length + '|' + (last ? last.id : 0) + '|' + (last ? last.startTime : 0) + '|' + getTodayStr();
  };
  let _cacheHour = { key: '' }; /* {key,hours[24],total,max,peak} */
  let _cacheHeat = { key: '' }; /* {key,map} */

  function _computeHourly() {
    let k = _aggKey();
    if (_cacheHour.key === k) return _cacheHour;
    let now = new Date(),
      y = now.getFullYear(),
      mo = now.getMonth(),
      da = now.getDate();
    let hours = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let total = 0,
      max = 0,
      peak = 0;
    let recs = _recs();
    for (let i = 0; i < recs.length; i++) {
      let r = recs[i];
      if (!r || !r.startTime) continue;
      let d = new Date(r.startTime);
      if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) continue;
      if (isLogRecord(r)) continue; /* 仅记录：不进时段分布（那不是专注时间） */
      let h = d.getHours();
      let mins = Math.round(_num(r.effectiveSeconds, 0) / 60);
      hours[h] += mins;
      total += mins;
      if (hours[h] > max) max = hours[h];
    }
    for (let z = 1; z < 24; z++) {
      if (hours[z] > hours[peak]) peak = z;
    }
    _cacheHour = { key: k, hours: hours, total: total, max: max, peak: peak };
    return _cacheHour;
  }
  function _computeHeat() {
    let k = _aggKey();
    if (_cacheHeat.key === k) return _cacheHeat;
    let W = 53;
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    let start = new Date(today.getTime());
    start.setDate(start.getDate() - (today.getDay() + (W - 1) * 7));
    let recs = _recs();
    let map = {};
    let sT = start.getTime(),
      eT = today.getTime() + DAY_MS;
    for (let i = 0; i < recs.length; i++) {
      let r = recs[i];
      if (!r || !r.startTime) continue;
      if (r.startTime < sT || r.startTime > eT) continue;
      if (isLogRecord(r)) continue; /* 仅记录：不进热力图 */
      let ds = getDateStr(r.startTime);
      let e = map[ds] || (map[ds] = { p: 0, m: 0, n: 0 });
      e.p += getPomos(r);
      e.m += Math.round(_num(r.effectiveSeconds, 0) / 60);
      e.n++;
    }
    _cacheHeat = { key: k, map: map, start: start.getTime(), today: today.getTime() };
    return _cacheHeat;
  }
  function enhRenderCharts() {
    if (!_el('enhHourlyChart') && !_el('enhHeat52Wrap')) return;
    enhRenderHourly();
    enhRenderHeat52();
  }
  function enhRenderHourly() {
    let box = _el('enhHourlyBox');
    if (!box) return;
    let c = _el('enhHourlyChart');
    if (!c) return;
    let hint = _el('enhHourlyHint');
    let agg = _computeHourly();
    if (agg.total <= 0) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    let now = new Date(),
      H = 84,
      cur = now.getHours();
    let hours = agg.hours,
      max = agg.max,
      total = agg.total;
    let html = '<div style="display:flex;align-items:flex-end;gap:var(--sp-2);min-width:352px;padding:var(--sp-4) 0 0">';
    for (let x = 0; x < 24; x++) {
      let v = hours[x];
      let hh = v > 0 ? Math.max(3, (H * v) / max) : 0;
      let bar = v > 0 && x === cur ? 'var(--yellow-dark)' : 'var(--primary)';
      let op = v > 0 ? 0.5 + (0.5 * v) / max : 0;
      html +=
        '<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:9px">' +
        '<div title="' +
        x +
        ' 点：' +
        v +
        ' 分钟" style="width:100%;max-width:15px;height:' +
        hh.toFixed(1) +
        'px;background:' +
        bar +
        ';opacity:' +
        op.toFixed(2) +
        ';border-radius:var(--radius-xs) var(--radius-xs) 0 0"></div></div>';
    }
    html +=
      '</div><div style="display:flex;gap:var(--sp-2);min-width:352px;font-size:var(--fs-micro);color:var(--text-light);margin-top:var(--sp-2)">';
    for (let q = 0; q < 24; q++) {
      html += '<div style="flex:1;text-align:center;min-width:9px">' + (q % 4 === 0 || q === 23 ? q : '') + '</div>';
    }
    html += '</div>';
    c.innerHTML = html;
    if (hint) {
      hint.innerHTML =
        '<span style="color: var(--yellow-ink)">◉</span> 当前时段&nbsp;·&nbsp;今日专注 <b style="color: var(--primary-ink)">' +
        total +
        '</b> 分钟 · 峰值时段 ' +
        agg.peak +
        ' 点';
    }
  }
  function enhRenderHeat52() {
    let box = _el('enhHeat52Box');
    if (!box) return;
    let wrap = _el('enhHeat52Wrap');
    if (!wrap) return;
    let meta = _el('enhHeat52Meta');
    let agg = _computeHeat();
    let map = agg.map,
      W = 53,
      start = new Date(agg.start),
      today = new Date(agg.today);
    let totalP = 0,
      totalM = 0,
      act = 0;
    for (let k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) {
        totalP += map[k].p;
        totalM += map[k].m;
        if (map[k].n) act++;
      }
    }
    if (totalP <= 0) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    let cell = 12,
      gap = 2,
      cw = cell + gap,
      left = 28,
      top = 18;
    let width = left + W * cw + 6,
      height = top + 7 * (cell + gap) + 4;
    let svg = '<svg width="' + width + '" height="' + height + '" style="display:block">';
    let lm = -1;
    for (let c = 0; c < W; c++) {
      let d0 = new Date(start.getTime());
      d0.setDate(d0.getDate() + c * 7);
      if (d0.getMonth() !== lm) {
        lm = d0.getMonth();
        svg +=
          '<text x="' + (left + c * cw) + '" y="11" font-size="11" fill="var(--text-light)">' + (lm + 1) + '月</text>';
      }
    }
    let wl = { 1: '一', 3: '三', 5: '五' };
    for (let r2 = 0; r2 < 7; r2++) {
      if (wl[r2])
        svg +=
          '<text x="0" y="' +
          (top + r2 * (cell + gap) + cell - 3) +
          '" font-size="11" fill="var(--text-light)">' +
          wl[r2] +
          '</text>';
    }
    let ft = today.getTime();
    for (let c2 = 0; c2 < W; c2++) {
      for (let r3 = 0; r3 < 7; r3++) {
        let dd = new Date(start.getTime());
        dd.setDate(dd.getDate() + c2 * 7 + r3);
        let x = left + c2 * cw,
          y = top + r3 * (cell + gap);
        let ds = getDateStr(dd.getTime()),
          e = map[ds];
        let p = e ? e.p : 0,
          m = e ? e.m : 0;
        let fill = 'var(--border)',
          op = 0.5;
        if (dd.getTime() > ft) {
          fill = 'transparent';
          op = 0;
        } else if (p > 0) {
          fill = 'var(--primary)';
          op = p < 1 ? 0.22 : p < 3 ? 0.45 : p < 6 ? 0.72 : 1;
        }
        svg +=
          '<rect class="enh-h52" data-d="' +
          ds +
          '" data-p="' +
          p +
          '" data-m="' +
          m +
          '" x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          cell +
          '" height="' +
          cell +
          '" rx="2.5" style="fill:' +
          fill +
          ';fill-opacity:' +
          op +
          '"/>';
      }
    }
    svg += '</svg>';
    wrap.innerHTML = svg;
    if (meta)
      meta.innerHTML =
        '近 52 周：<b style="color: var(--primary-ink)">' +
        Math.round(totalP) +
        '</b> 个番茄 · <b style="color: var(--green-ink)">' +
        totalM +
        '</b> 专注分钟 · <b>' +
        act +
        '</b> 天有记录 · 悬停色块看详情';
    let tip = _el('enhHeat52Tip');
    let rects = wrap.querySelectorAll('rect.enh-h52');
    for (let z = 0; z < rects.length; z++) {
      (function (rect) {
        rect.addEventListener('mouseenter', function () {
          if (!tip) return;
          let d = rect.getAttribute('data-d'),
            p = parseFloat(rect.getAttribute('data-p')),
            m = parseInt(rect.getAttribute('data-m'), 10);
          tip.textContent = (m > 0 ? '专注 ' + m + ' 分钟 · ' : '') + Math.round(p) + ' 个番茄 · ' + d;
          tip.style.display = 'block';
        });
        rect.addEventListener('mousemove', function (ev) {
          if (!tip) return;
          tip.style.left = Math.min(window.innerWidth - 160, ev.clientX + 14) + 'px';
          tip.style.top = Math.max(8, ev.clientY - 36) + 'px';
        });
        rect.addEventListener('mouseleave', function () {
          if (tip) tip.style.display = 'none';
        });
      })(rects[z]);
    }
  }

  /* ============ ⑦ 设置卡片与弹窗注入 ============ */
  function injectModal() {
    if (_el('enhSbModal')) return;
    let d = document.createElement('div');
    d.className = 'modal-overlay';
    d.id = 'enhSbModal';
    d.innerHTML =
      '<div class="modal" style="text-align:center;max-width:340px">' +
      '<h3 style="color: var(--green-ink)" id="enhSbTitle">🍱 休息时间到啦</h3>' +
      '<p style="font-size:var(--fs-title);color:var(--text-light);line-height:1.6;margin-bottom:var(--sp-12)" id="enhSbMsg"></p>' +
      '<div class="modal-buttons" style="justify-content:center">' +
      '<button class="modal-btn secondary" type="button" id="enhSbSkipBtn">跳过</button>' +
      '<button class="modal-btn primary" type="button" id="enhSbStartBtn">开始休息</button>' +
      '</div></div>';
    (document.body || document.documentElement).appendChild(d);
    let s = _el('enhSbStartBtn'),
      k = _el('enhSbSkipBtn');
    if (s)
      s.addEventListener('click', function () {
        try {
          _enhSbStart();
        } catch (e) { if (window.__silent) window.__silent(e, '02-injectModal'); }
      });
    if (k)
      k.addEventListener('click', function () {
        try {
          _enhSbSkip();
        } catch (e) { if (window.__silent) window.__silent(e, '02:injectModal'); }
      });
  }
  function injectSettingsCard() {
/* 新开关直接长进原有分类组，不单独成组 */
    if (_el('enhStrict') && _el('enhVoice') && _el('enhSndRows')) return true;
    let tBody = document.querySelector('.settings-group[data-group="timer"] .group-body');
    let nBody = document.querySelector('.settings-group[data-group="notify"] .group-body');
    if (!tBody || !nBody) return false;
    /* —— ⏱ 计时设置 组内：严格模式 / 自动开始下一轮 / 定点休息 —— */
    let timerHtml =
      '' +
      '<div class="setting-row"><div class="setting-label">🧘 严格模式<div class="setting-desc">专注进行中禁止 打断 / 提前结束 / 重置，违规给脉冲提示</div></div><label class="switch"><input type="checkbox" id="enhStrict"><span class="switch-slider"></span></label></div>' +
      '<div class="setting-row"><div class="setting-label">⏭️ 休息结束自动开始下一轮<div class="setting-desc">默认关闭。打开后：短休自然结束会自动开启下一轮专注（长休即每 4 个一组后仍会停下等你手动开始）。注意：离开时它会自己跑完一轮，结束时结算框不能取消且默认记为完整🍅</div></div><label class="switch"><input type="checkbox" id="enhAutoNext"><span class="switch-slider"></span></label></div>';
    /* v5.7.6：定点休息提醒已从设置移入「计划 → ⏰ 定点休息」页签（见 renderPlanBreakView），此处不再注入 */
    /* 「🧘 微休息」是计时组里的最后一块（模板里就排在末尾）。这里追加行要插在它
       前面，否则会被顶到卡片后面，把卡片夹在中间。 */
    if (tBody.querySelector('.setting-subblock')) {
      tBody.querySelector('.setting-subblock').insertAdjacentHTML('beforebegin', timerHtml);
    } else {
      tBody.insertAdjacentHTML('beforeend', timerHtml);
    }
    /* —— 通知与音效 组内：语音 / 滴答 / 自定义提示音 —— */
    let notifyHtml =
      '' +
      '<div class="setting-row"><div class="setting-label">🗣️ 语音播报<div class="setting-desc">用系统语音朗读 开始 / 完成 / 休息节点，以及专注途中的鼓励</div></div><label class="switch"><input type="checkbox" id="enhVoice"><span class="switch-slider"></span></label></div>' +
      '<div style="margin:-4px 0 var(--sp-6)"><button class="btn-small" type="button" id="enhVoiceTest" style="font-size:var(--fs-note);padding:var(--sp-2) var(--sp-10)">▶ 试听语音</button><span style="font-size:var(--fs-caption);color:var(--text-light);margin-left:var(--sp-6)">听不到？点一下，结果会写在这里</span></div>' +
      '<div id="enhVoiceStat" style="font-size:var(--fs-caption);line-height:1.5;color:var(--text-light);background:var(--surface-2);border-radius:var(--radius);padding:var(--sp-4) var(--sp-8);margin:0 0 var(--sp-6);white-space:pre-wrap;word-break:break-all"></div>' +
      '<div class="setting-row"><div class="setting-label">💬 专注中说句话<div class="setting-desc">专注途中隔一会儿念一句鼓励或提醒（喝水 / 看远处 / 还在专注吗），想安静就关掉</div></div><label class="switch"><input type="checkbox" id="enhCompanion"><span class="switch-slider"></span></label></div>' +
      '<div style="display:flex;align-items:center;gap:var(--sp-10);padding:var(--sp-6) var(--sp-4) var(--sp-2)"><span style="font-size:var(--fs-note);color:var(--text-light);flex-shrink:0">多久说一次</span>' +
      '<select id="enhCompanionMin" style="flex:1;min-width:0;padding:var(--sp-4) var(--sp-6);border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:var(--fs-note)">' +
      '<option value="3">每 3 分钟</option><option value="5">每 5 分钟</option><option value="10">每 10 分钟</option><option value="15">每 15 分钟</option><option value="20">每 20 分钟</option><option value="0">只在开局说一次</option>' +
      '</select>' +
      '<button class="btn-small" type="button" id="enhCompanionTest" style="font-size:var(--fs-note);padding:var(--sp-2) var(--sp-10);flex-shrink:0">▶ 试听</button></div>' +
      '<div id="enhCompanionHint" style="font-size:var(--fs-caption);line-height:1.5;color:var(--text-light);padding:0 var(--sp-4) var(--sp-8);border-bottom:1px solid var(--border)"></div>' +
      '<div style="display:flex;align-items:center;gap:var(--sp-10);padding:var(--sp-8) var(--sp-4) var(--sp-2)"><span style="font-size:var(--fs-note);color:var(--text-light);flex-shrink:0">嗓音</span>' +
      '<select id="enhVoicePick" class="input-inline" style="flex:1;min-width:0;font-size:var(--fs-note);padding:var(--sp-3) var(--sp-6)"><option value="">系统默认</option></select></div>' +
      '<div style="font-size:var(--fs-caption);line-height:1.5;color:var(--text-light);padding:0 var(--sp-4) var(--sp-8)">手机里装了几个中文语音引擎时，默认挑哪个由浏览器决定，听着会忽好忽坏。挑一个固定的就不会变。</div>' +
      '<div class="setting-row"><div class="setting-label">🕐 滴答声<div class="setting-desc">每秒轻响营造沉浸节奏（页面在前台时发声）</div></div>' +
      '<div style="display:flex;gap:var(--sp-12);align-items:center"><label style="display:flex;align-items:center;gap:var(--sp-4);font-size:var(--fs-body);color:var(--text)"><input type="checkbox" id="enhTickWork" style="accent-color:var(--primary)">专注中</label><label style="display:flex;align-items:center;gap:var(--sp-4);font-size:var(--fs-body);color:var(--text)"><input type="checkbox" id="enhTickBreak" style="accent-color:var(--primary)">休息中</label></div></div>' +
      '<div style="display:flex;align-items:center;gap:var(--sp-10);padding:var(--sp-6) var(--sp-4) var(--sp-8);border-bottom:1px solid var(--border)"><span style="font-size:var(--fs-note);color:var(--text-light);flex-shrink:0">滴答音量</span>' +
      '<input type="range" id="enhTickVol" min="0" max="100" value="30" step="5" style="flex:1;min-width:0;accent-color:var(--primary)">' +
      '<span id="enhTickVolVal" style="font-size:var(--fs-note);font-weight:800;color:var(--text);width:40px;text-align:right;flex-shrink:0">30%</span>' +
      '<button type="button" id="enhTickVolTest" title="试听当前滴答音量" style="flex-shrink:0;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:var(--radius);font-size:var(--fs-note);padding:var(--sp-2) var(--sp-10);cursor:pointer">▶ 试听</button></div>' +
      '<div class="setting-label" style="margin:var(--sp-10) 0 var(--sp-2)">🎵 自定义提示音<div class="setting-desc">各节点可上传自己的铃声（mp3/wav/ogg ≤8MB），存本机浏览器，可试听 / 还原</div></div>' +
      '<div id="enhSndRows" style="display:flex;flex-direction:column;gap:var(--sp-4);margin:var(--sp-2) 0 var(--sp-4)"></div>';
    /* v5.7.6：「后台结束提醒」并入原生「结束前 1 分钟提醒音」之后成一组（见 insertNearEndNotifRow），避免两个"结束前"设置割裂 */
    nBody.insertAdjacentHTML('beforeend', notifyHtml);
    insertNearEndNotifRow();
    enhRenderSndRows();
    return true;
  }
  /* 把「后台结束提醒」插到原生「结束前 1 分钟提醒音」的正下方，与系统通知总开关联动 */
  function insertNearEndNotifRow() {
    if (_el('enhPreNotify')) return true;
    let anchor = _el('setNearEndSound');
    let row = anchor ? anchor.closest('.setting-row') : null;
    if (!row || !row.parentNode) return false;
    row.insertAdjacentHTML(
      'afterend',
      '<div class="setting-row" id="enhPreNotifyRow"><div class="setting-label">🔔 后台结束提醒<div class="setting-desc">只在页面切到<b>后台</b>时，于结束前 30/60 秒发系统通知（受上方「系统通知」总开关控制）；回到前台则仍由上面「结束前 1 分钟提醒音」负责，两者不会同时打扰。</div></div>' +
        '<select class="setting-input" id="enhPreNotify" style="max-width:118px"><option value="0">关闭</option><option value="30">30 秒前</option><option value="60">60 秒前</option></select></div>'
    );
    return true;
  }
  /* 系统通知总开关关闭 → 后台结束提醒置灰不可选 */
  function syncNotifyDeps() {
    let pre = _el('enhPreNotify'),
      row = _el('enhPreNotifyRow');
    let notEl = document.getElementById('setNotify');
    let on = !notEl || notEl.checked;
    if (pre) pre.disabled = !on;
    if (row) row.style.opacity = on ? '1' : '0.5';
  }
  function bindSettingsUI() {
    let pairs = [
      ['enhStrict', 'strict'],
      ['enhAutoNext', 'autoNext'],
      ['enhVoice', 'voice'],
      ['enhCompanion', 'companion'],
      ['enhTickWork', 'tickWork'],
      ['enhTickBreak', 'tickBreak']
    ];
    for (let i = 0; i < pairs.length; i++) {
      (function (id, key) {
        let el = _el(id);
        if (!el) return;
        el.checked = !!_ensure()[key];
        el.addEventListener('change', function () {
          _ensure()[key] = el.checked;
          /* 主动改过陪伴开关就打标记：01b 的迁移只重置「没被主动改过」的旧默认值，
             否则用户自己打开陪伴，下次加载又会被按回 false。 */
          if (key === 'companion') _ensure().companionTouched = true;
          _save();
          if (key === 'strict') {
            try {
              showToast(el.checked ? '🧘 严格模式已开启：专注中不可打断/提前结束/重置' : '严格模式已关闭');
            } catch (e) { if (window.__silent) window.__silent(e, '02-bindSettingsUI'); }
          }
          if (key === 'voice' && el.checked) {
            try {
              _speak('语音播报已开启');
            } catch (e) { if (window.__silent) window.__silent(e, '02:bindSettingsUI'); }
          }
        });
      })(pairs[i][0], pairs[i][1]);
    }
    let vt = _el('enhVoiceTest');
    if (vt) {
      vt.addEventListener('click', function () {
        try {
          _speakForce('语音播报试听：番茄完成、休息开始时，我会这样提醒你');
        } catch (e) { if (window.__silent) window.__silent(e, '02:bindSettingsUI'); }
      });
    }
    /* 状态框开局就把版本戳印出来：用户报「还是没声音」时，
       先确认他手机上跑的是不是最新这一版，再谈引擎。 */
    try {
      let st0 = _el('enhVoiceStat');
      if (st0) {
        let has = ('speechSynthesis' in window);
        st0.textContent = '[' + VOICE_BUILD + '] ' + (has
          ? '点上面的试听，这里会显示每一步的结果'
          : '✗ 这个浏览器内核没有 speechSynthesis，换 Chrome 打开');
      }
    } catch (e) { if (window.__silent) window.__silent(e, '02:bindSettingsUI-stat'); }
    /* 陪伴语音：频率下拉 + 试听（试听走同一个句子池，听到的就是真会念的那类话） */
    let cm = _el('enhCompanionMin');
    if (cm) {
      let v0 = _ensure().companionMin;
      cm.value = String(typeof v0 === 'undefined' ? 5 : v0);
      if (!cm.value) cm.value = '5';
      /* 直接算出「这个番茄会说几次」写在下面。
         用户真正想知道的不是「每几分钟」，而是「一个番茄到底能听到几句话」——
         让他自己拿 25 ÷ 10 去心算，等于把问题留给用户。 */
      let hint = function () {
        try {
          let h = _el('enhCompanionHint');
          if (!h) return;
          let min = parseInt(cm.value, 10) || 0;
          let tot = (typeof timerState !== 'undefined' && timerState && timerState.totalDuration)
            ? Math.round(timerState.totalDuration / 60) : 25;
          if (min <= 0) { h.textContent = '一个番茄只在开头说一句，之后全程安静。'; return; }
          let gap = Math.max(min, tot / 5);
          let n = 0;
          for (let e = gap; e <= tot - 1.5; e += gap) n++;
          h.textContent = '一个 ' + tot + ' 分钟的番茄大约说 ' + n + ' 句（每 '
            + (gap >= 1 ? Math.round(gap) : 1) + ' 分钟一句，收尾 90 秒留白）。';
        } catch (e) { if (window.__silent) window.__silent(e, '02:companionHint'); }
      };
      hint();
      cm.addEventListener('change', function () {
        _ensure().companionMin = parseInt(cm.value, 10) || 0;
        _save();
        hint();
      });
    }
    let cbt = _el('enhCompanionTest');
    if (cbt) {
      cbt.addEventListener('click', function () {
        try {
          let bucket = 'mid';
          let st = timerState;
          if (st && st.running && st.totalDuration > 0 && st.remaining > 0) {
            let ratio = st.remaining / st.totalDuration;
            bucket = ratio > 0.66 ? 'early' : ratio > 0.33 ? 'mid' : 'late';
          }
          _speakForce(_compPick(bucket));
        } catch (e) { if (window.__silent) window.__silent(e, '02:bindSettingsUI'); }
      });
    }
    /* 嗓音选择。列表要等 voiceschanged 才有内容（安卓 Chrome 首次是空数组），
       所以先填、再挂一次性监听补填；选项值存名字，见 _resolveVoice。
       选定后立刻用新嗓音念一句 —— 不然用户得再点一次试听才知道好不好听。 */
    let vp = _el('enhVoicePick');
    if (vp) {
      let fillPick = function () {
        try {
          let cur = _ensure().voiceName || '';
          let list = _voiceOptions();
          let html = '<option value="">系统默认</option>';
          for (let i = 0; i < list.length; i++) {
            html += '<option value="' + list[i].name.replace(/"/g, '&quot;') + '">'
              + list[i].label.replace(/</g, '&lt;') + '</option>';
          }
          vp.innerHTML = html;
          vp.value = cur;
          /* 存的那个嗓音已经不在列表里（换了引擎/被卸载）：退回系统默认，
             但不要静默改设置 —— 只是让下拉显示真实状态。 */
          if (cur && !_resolveVoice()) vp.value = '';
        } catch (e) { if (window.__silent) window.__silent(e, '02:fillVoicePick'); }
      };
      fillPick();
      try {
        if ('speechSynthesis' in window && !vp.__filled) {
          speechSynthesis.addEventListener('voiceschanged', function () {
            vp.__filled = true;
            fillPick();
          });
        }
      } catch (e) { if (window.__silent) window.__silent(e, '02:voicePickEvt'); }
      vp.addEventListener('change', function () {
        _ensure().voiceName = vp.value || '';
        _save();
        if (vp.value) _speakForce('这个嗓音听起来怎么样？以后都用它念');
      });
    }
    let pre = _el('enhPreNotify');
    if (pre) {
      pre.value = String(_ensure().preNotifySec || 0);
      pre.addEventListener('change', function () {
        _ensure().preNotifySec = parseInt(pre.value, 10) || 0;
        _save();
      });
    }
    /* 滴答独立音量滑杆（0~100 → enhSettings.tickVolume 0~1，与音效音量互不干扰） */
    let tvEl = _el('enhTickVol'),
      tvVal = _el('enhTickVolVal');
    if (tvEl) {
      let _tv0 = _ensure().tickVolume;
      if (!isFinite(_tv0)) _tv0 = 0.3;
      let _pct = Math.max(0, Math.min(100, Math.round(_tv0 * 100)));
      tvEl.value = _pct;
      if (tvVal) tvVal.textContent = _pct + '%';
      tvEl.addEventListener('input', function () {
        let v = parseInt(tvEl.value, 10);
        if (isNaN(v)) v = 0;
        _ensure().tickVolume = Math.max(0, Math.min(100, v)) / 100;
        _save();
        if (tvVal) tvVal.textContent = v + '%';
      });
    }
    let tvT = _el('enhTickVolTest');
    if (tvT) {
      tvT.addEventListener('click', function () {
        try {
          _playTick();
        } catch (e) { if (window.__silent) window.__silent(e, '02-bindSettingsUI'); }
      });
    }
    /* 联动：系统通知总开关 → 后台结束提醒置灰/恢复 */
    syncNotifyDeps();
    let notEl = document.getElementById('setNotify');
    if (notEl) {
      notEl.addEventListener('change', function () {
        try {
          syncNotifyDeps();
        } catch (e) { if (window.__silent) window.__silent(e, '02:bindSettingsUI'); }
      });
    }
  }
  function enhRenderSndRows() {
    let box = _el('enhSndRows');
    if (!box) return;
    let s = enhGet();
    if (!s) return;
    let html = '';
    for (let i = 0; i < ENH_TONES.length; i++) {
      let t = ENH_TONES[i],
        meta = s.customAudio ? s.customAudio[t.k] : null;
      html +=
        '<div style="display:flex;align-items:center;gap:var(--sp-8);padding:var(--sp-4) var(--sp-8);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);flex-wrap:wrap">' +
        '<span style="flex:1;min-width:130px;font-size:var(--fs-body)">' +
        t.icon +
        ' ' +
        escapeHtml(t.label) +
        '</span>' +
        '<span style="font-size:var(--fs-caption);color:var(--text-light);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        (meta ? '✅ ' + escapeHtml(meta.name) : '🔊 内置') +
        '</span>' +
        '<button class="btn-small" type="button" data-cs-play="' +
        t.k +
        '" style="font-size:var(--fs-note);padding:var(--sp-2) var(--sp-8)">试听</button>' +
        '<button class="btn-small" type="button" data-cs-up="' +
        t.k +
        '" style="font-size:var(--fs-note);padding:var(--sp-2) var(--sp-8);background:var(--fill-primary);color:var(--on-fill)">上传</button>' +
        (meta
          ? '<button class="btn-small" type="button" data-cs-clr="' +
            t.k +
            '" style="font-size:var(--fs-note);padding:var(--sp-2) var(--sp-8);background:var(--danger);color:#fff">还原</button>'
          : '') +
        '<input type="file" accept="audio/*" data-cs-file="' +
        t.k +
        '" style="display:none">' +
        '</div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-cs-up]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        let f = box.querySelector('[data-cs-file="' + btn.getAttribute('data-cs-up') + '"]');
        if (f) f.click();
      });
    });
    box.querySelectorAll('[data-cs-file]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        let k = inp.getAttribute('data-cs-file');
        let file = inp.files && inp.files[0];
        if (file) _uploadCustom(k, file);
        inp.value = '';
      });
    });
    box.querySelectorAll('[data-cs-play]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        let k = btn.getAttribute('data-cs-play');
        let vol = _num(appData && appData.settings ? appData.settings.sfxVolume : 1.0, 1.0);
        let meta2 = enhGet() && enhGet().customAudio ? enhGet().customAudio[k] : null;
        if (meta2) {
          _playCustom(k, vol).catch(function () {
            try {
              showToast('⚠️ 音频播放失败，可能文件已损坏');
            } catch (e) { if (window.__silent) window.__silent(e, '02:enhRenderSndRows'); }
          });
        } else {
          try {
            playSound(k);
          } catch (e) { if (window.__silent) window.__silent(e, '02:enhRenderSndRows'); }
        }
      });
    });
    box.querySelectorAll('[data-cs-clr]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _clearCustom(btn.getAttribute('data-cs-clr'));
      });
    });
  }

  /* ============ ⑧ 启动 ============ */
  function injectStyle() {
    if (document.getElementById('enhStyle')) return;
    let st = document.createElement('style');
    st.id = 'enhStyle';
    st.textContent =
      '.enh-strict-pulse{animation:enhStrictPulse .9s ease .0s 1}' +
      '@keyframes enhStrictPulse{0%,100%{filter:none}25%{filter:drop-shadow(0 0 7px var(--yellow-dark))}}';
    let head = document.head || document.documentElement;
    head.appendChild(st);
  }
  function boot() {
    try {
      if (typeof appData === 'undefined' || !appData || !appData.settings) return false;
      _ensure();
      injectStyle();
      injectModal();
      let ok1 = injectSettingsCard();
      /* ★ 这里原先是 `let ok2 = injectStatsCards();` —— 而这个函数在整个项目里
         从来没有定义过（git 全历史都没有）。每次 boot() 都在这一行抛 ReferenceError，
         被外层 catch 吞掉后 return false，于是 bindSettingsUI() 永远走不到：
         语音试听、各项开关、频率下拉全部没有点击处理，点了毫无反应也不报错。
         统计卡片已经由别的模块负责，这里直接不调。 */
      if (!_booted) {
        _booted = true;
        bindSettingsUI();
      }
      if (!ok1) return false;
      enhRenderSndRows();
      try {
        enhRenderCharts();
      } catch (e) { if (window.__silent) window.__silent(e, '02-boot'); }
      return true;
    } catch (e) {
      return false;
    }
  }

  try {
    hookGlobals();
  } catch (e) { if (window.__silent) window.__silent(e, '02:boot'); }

  let _tries = 0;
  (function wait() {
    try {
      if (typeof appData !== 'undefined' && appData && appData.settings) {
        if (boot()) {
          startObservers();
          return;
        }
      }
      _tries++;
      if (_tries > 200) return; /* 兜底：最多约 100 秒 */
      setTimeout(wait, 500);
    } catch (e) {
      setTimeout(wait, 500);
    }
  })();

  /* 切换视图时兜底刷新统计卡片 —— 走视图切换钩子（原来靠包装 window.switchView） */
  try {
    tbOnViewSwitch(function () {
      setTimeout(function () {
        try {
          enhRenderCharts();
        } catch (e) { if (window.__silent) window.__silent(e, '02:wait'); }
      }, 80);
    }, 'after');
  } catch (e) { if (window.__silent) window.__silent(e, '02:wait'); }
})();
