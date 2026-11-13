/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 增强模块（缓存/预热）：被依赖≈73；对外=缓存失效与空闲预热包装。
 * 红线：缓存键语义变更需同步失效逻辑；勿在别的模块手写第二套缓存。 */
/* ════════════════════════════════════════════════════════════════════
    瓶子专注 · v5.7.1 性能与打磨模块（独立注入，不改动原引擎）
   ────────────────────────────────────────────────────────────────────
   在 v5.7 基础上新增：
   ① 统计聚合缓存：今日逐小时 / 52周 热力图改为"记录数+末条id+日期"做键，
      切页与重复渲染不再全量遍历 records（性能）。
   ② 页面标签标题动态倒计时（后台标签也能看到剩余时间）。
   ③ 每日专注目标：设定每日番茄数 → 统计页目标卡 + 计时页小胶囊 + 达成庆祝。
   ④ 快捷键增强：P=打断/回专注；并附「快捷键速查」。
   ⑤ 休息时保持屏幕常亮开关（锁屏/熄屏不截断休息倒计时）。
   ⑥ 自动跟随系统深色（prefers-color-scheme，可与手动蓝调模式共存）。
   ⑦ 记录 CSV 导出（Excel/WPS 可直接打开）。
 * 函数索引（TOC）：enhGet/_ensure2/_save/_el/_num/_recs/todayPomos/_goal/_fmtClock/updateTitle/ensureGoalChip/refreshGoalChip（+24 更多）
   ════════════════════════════════════════════════════════════════════ */
(function () {
  let _orig2 = {};
  let _booted2 = false;

  function enhGet() {
    if (typeof appData === 'undefined' || !appData) return null;
    if (!appData.enhSettings) appData.enhSettings = {};
    return appData.enhSettings;
  }
  function _ensure2() {
    let s = enhGet();
    if (!s) return null;
    if (typeof s.dailyGoalTarget === 'undefined') s.dailyGoalTarget = 8; /* 0=关闭 */
    /* 休息时保持屏幕常亮默认打开 —— 休息倒计时被熄屏截断是最常见的一类投诉。
       老数据里存的是旧默认 false（用户没主动改过也长这样），按一次版本号迁移过来。 */
    if (typeof s.keepAwakeBreak === 'undefined') s.keepAwakeBreak = true;
    if (_num(s.keepAwakeDefaultV, 1) < 2) {
      s.keepAwakeBreak = true;
      s.keepAwakeDefaultV = 2;
    }
    if (typeof s.autoDark === 'undefined') s.autoDark = false;
    if (typeof s.goalCelebratedDate === 'undefined') s.goalCelebratedDate = '';
    if (typeof s.goalCoinClaimedDate === 'undefined')
      s.goalCoinClaimedDate = ''; /* 目标达成 +10🪙 领取日期（每天一次） */
    return s;
  }
  function _save() {
    try {
      saveData();
    } catch (e) { if (window.__silent) window.__silent(e, '03:_save'); }
  }
  function _el(id) {
    return document.getElementById(id);
  }
  function _num(v, d) {
    v = Number(v);
    return isFinite(v) ? v : d;
  }
  function _recs() {
    return typeof appData !== 'undefined' && appData && Array.isArray(appData.records) ? appData.records : [];
  }

  /* 今日番茄数（与基线口径一致：各记录 pomos 求和） */
  function todayPomos() {
    let t = getTodayStr(),
      sum = 0;
    let recs = _recs();
    for (let i = 0; i < recs.length; i++) {
      let r = recs[i];
      if (!r || !r.startTime) continue;
      let d = new Date(r.startTime);
      let ds = d.getFullYear() + '-' + _p2(d.getMonth() + 1) + '-' + _p2(d.getDate());
      if (ds === t) sum += getPomos(r);
    }
    return sum;
  }
  function _goal() {
    let s = _ensure2();
    return s ? _num(s.dailyGoalTarget, 0) || 0 : 0;
  }

  /* ============ ① 统计聚合缓存（v5.7.1 在 07-enh 基础上升级，性能） ============
     说明：v5.7 的 hourly/heat52 已内建缓存键；此处仅作双保险校验，不重复扫描。 */

  /* ============ ② 动态页面标题 ============ */
  let _baseTitle = '番茄专注';
  let _lastTitle = '';
  function _fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    let m = Math.floor(sec / 60),
      s = sec % 60;
    return _p2(m) + ':' + _p2(s);
  }
  function updateTitle() {
    try {
      let st = timerState;
      let title;
      if (st && st.running) {
        let mm = _fmtClock(st.remaining);
        if (st.mode === 'focus') title = '🍅 ' + mm + ' 专注中 · ' + _baseTitle;
        else if (st.mode === 'shortBreak') title = '☕ ' + mm + ' 短休息 · ' + _baseTitle;
        else if (st.mode === 'longBreak') title = '🧘 ' + mm + ' 长休息 · ' + _baseTitle;
        else if (st.mode === 'free') title = '⏱ ' + mm + ' 自由专注 · ' + _baseTitle;
        else title = _baseTitle;
      } else if (st && st.mode === 'focus' && !st.running && st.remaining === 0) {
        title = '🎉 专注完成 · ' + _baseTitle;
      } else {
        title = _baseTitle;
      }
      if (title !== _lastTitle) {
        _lastTitle = title;
        try {
          document.title = title;
        } catch (e) { if (window.__silent) window.__silent(e, '03:updateTitle'); }
      }
    } catch (e) { if (window.__silent) window.__silent(e, '03:updateTitle'); }
  }

  /* ============ ③ 每日目标：计时页胶囊 ============ */
  function ensureGoalChip() {
    try {
      let tp = _el('todayProgress');
      if (!tp) return null;
      let chip = document.getElementById('enhGoalChip');
      if (!chip) {
        chip = document.createElement('span');
        chip.id = 'enhGoalChip';
        /* 样式交给 CSS（#enhGoalChip）：内联 margin/字重会盖掉令牌与深色适配 */
        tp.appendChild(chip);
      }
      return chip;
    } catch (e) {
      return null;
    }
  }
  function refreshGoalChip() {
    try {
      let chip = ensureGoalChip();
      if (!chip) return;
      let g = _goal();
      if (g <= 0) {
        chip.textContent = '';
        return;
      }
      let cur = todayPomos();
      let done = cur >= g;
      chip.textContent = done ? '🎯 ' + g + '/' + g + ' ✅' : '🎯 ' + _fmtPomo(cur) + '/' + g;
      chip.style.color = done ? 'var(--green-ink)' : 'var(--yellow-ink)';
    } catch (e) { if (window.__silent) window.__silent(e, '03:refreshGoalChip'); }
  }
  function _fmtPomo(v) {
    v = Math.round(v * 10) / 10;
    return String(v).replace(/\.0$/, '');
  }

  /* 今日专注目标视图：计划页二级页签「🎯 目标」内（v5.7.6：目标改为计划页第 3 个页签，目标数直接输入） */
  function ensureGoalCard() {
    return !!_el('planGoalView');
  }
  function _fmtGoalStatus(g, cur, done) {
    if (g <= 0) return '今天不限量';
    return done
      ? '今天的目标达成'
      : '还差 ' + _fmtPomo(Math.max(0, g - cur)) + ' 个';
  }
  /* 这一段只讲一件事：今天做了几个 / 目标几个。
     改前它把「今日完成 0」「每日目标 8 个🍅」「还差 8 个达成今日目标」
     「每日目标 8 个🍅/天 [修改]」四段并排摊开 —— 数字 8 在 232px 里
     出现三次，0 是个 40px 的大字孤零零顶着左边，目标数被塞进右边 14px 的
     小字里。读一张卡要先做三次心算才知道 0/8。
     现在：标题行（今日目标 · 8 个 + 修改）+ 一行读数（0 / 8）+ 一条进度条。
     数字各出现一次，进度条自己就说明了「还差多少」，不再多写一句。 */
  function renderGoalCard() {
    try {
      let body = _el('planGoalMain');
      if (!body) return;
      let g = _goal();
      let cur = todayPomos();
      let done = g > 0 && cur >= g;
      let pct = g > 0 ? Math.min(100, Math.round((cur / g) * 100)) : 0;
      let _cl = _ensure2();
      let claimed = !!(_cl && _cl.goalCoinClaimedDate === getTodayStr());
      let html =
        '<div style="padding:var(--sp-14) var(--sp-16);border-radius:var(--radius-lg);background:var(--card);border:1px solid ' +
        (done ? 'var(--green)' : 'var(--hairline)') +
        '">' +
        /* 标题行只说「这是什么」，不重复数字 —— 8 只在读数行出现一次 */
        '<div style="display:flex;align-items:center;gap:var(--sp-8)">' +
        '<span style="font-size:var(--fs-body);font-weight:600;color:var(--text)">今日目标</span>' +
        '<button type="button" onclick="toggleGoalEdit()" title="设定每天想完成的番茄数（长期有效）" style="margin-left:auto;border:0;background:transparent;color:var(--text-light);padding:var(--sp-4);font-size:var(--fs-note);font-family:inherit;cursor:pointer">修改</button>' +
        '</div>' +
        /* 读数：cur 是主角，/g 是分母，共用一条基线并用 tabular-nums 对齐。
           右边不再写「还差 8 个」—— 0/8 和「还差 8」是同一句话的两种写法，
           并排放就是让人读两遍。达成时才需要一句话，那时它是好消息。 */
        '<div style="display:flex;align-items:baseline;gap:var(--sp-6);margin-top:var(--sp-6);font-variant-numeric:tabular-nums">' +
        '<span style="font-size:var(--fs-hero);font-weight:600;line-height:1.15;color:' +
        (done ? 'var(--green-ink)' : 'var(--text)') +
        '">' +
        _fmtPomo(cur) +
        '</span>' +
        (g > 0
          ? '<span style="font-size:var(--fs-title);color:var(--text-light)">/ ' + g + ' 个🍅</span>'
          : '<span style="font-size:var(--fs-caption);color:var(--text-light)">个🍅 · 今天不限量</span>') +
        (done
          ? '<span style="margin-left:auto;font-size:var(--fs-note);font-weight:600;color:var(--green-ink)">已达成</span>'
          : '') +
        '</div>' +
        /* 进度条只在**有进度**时画。cur=0 时画一条 0% 的槽，看起来就是一条
           灰线，除了「你还没开始」什么也没说，还白占 6px 高度。 */
        (g > 0 && cur > 0
          ? '<div style="height:6px;margin-top:var(--sp-10);border-radius:var(--radius-full);background:var(--surface-2);overflow:hidden">' +
            '<div style="height:100%;width:' + pct + '%;background:' +
            (done ? 'var(--green)' : 'var(--primary)') +
            ';transition:width .4s ease"></div></div>'
          : '') +
        /* 奖励只在「今天已经能领」或「已经领过」时出现。
           没达成时那行「达成后可领 +10🪙（每天一次）」是规则说明，不是今天的事，
           天天挂在卡片上只会让人每天读一遍自己没做到。规则移进 popup 的 title。 */
        (done || claimed
          ? '<div style="margin-top:var(--sp-12);display:flex;align-items:center;gap:var(--sp-10)">' +
            '<span style="font-size:var(--fs-caption);color:var(--text-light)">今日奖励</span>' +
            (claimed
              ? '<span style="font-size:var(--fs-note);color:var(--green-ink);font-weight:600">🏆 已领取 +10🪙</span>'
              : '<button type="button" onclick="claimGoalCoin()" style="border:0;background:var(--green);color:#fff;padding:var(--sp-6) var(--sp-14);border-radius:var(--radius-full);font-size:var(--fs-note);font-weight:600;font-family:inherit;cursor:pointer">🎁 领取 +10🪙</button>') +
            '</div>'
          : '') +
        /* 目标设定区：这是「设定一次就一直有效」的长期设置，不是每天要重填的表单。
           平时只露一行当前值，点「修改」才展开输入框，免得看起来像每天都要设一遍。 */
        '<div id="enhGoalEditRow" style="display:none;margin-top:var(--sp-12);padding-top:var(--sp-12);border-top:1px solid var(--hairline);align-items:center;gap:var(--sp-8);flex-wrap:wrap">' +
        '<input type="number" id="enhGoalInput" min="0" max="60" step="1" inputmode="numeric" value="' +
        g +
        '" ' +
        'data-keydown="saveGoalFromInput" data-keys="Enter" ' +
        'style="width:84px;padding:var(--sp-6) var(--sp-10);border:1px solid var(--border-strong);border-radius:var(--radius-input);background:var(--surface-2);color:var(--text);font-size:var(--fs-title);font-weight:600;text-align:center;font-family:inherit">' +
        '<span style="font-size:var(--fs-note);color:var(--text-light)">个🍅 / 天</span>' +
        '<button type="button" onclick="saveGoalFromInput()" style="border:0;background:var(--fill-primary);color:var(--on-fill);padding:var(--sp-6) var(--sp-16);border-radius:var(--radius-input);font-size:var(--fs-note);font-weight:600;font-family:inherit;cursor:pointer">保存</button>' +
        '<button type="button" onclick="toggleGoalEdit()" style="border:0;background:transparent;color:var(--text-light);padding:var(--sp-6) var(--sp-10);font-size:var(--fs-note);font-family:inherit;cursor:pointer">取消</button>' +
        '<span style="width:100%;font-size:var(--fs-caption);color:var(--text-light);line-height:1.6">填 0 = 不限量；范围 1–60。改完长期有效，计时页 🎯 小胶囊读的就是它。</span>' +
        '</div></div>';
      body.innerHTML = html;
    } catch (e) { if (window.__silent) window.__silent(e, '03:renderGoalCard'); }
  }
  /* 领取今日目标达成奖励：+10🪙，每天一次 */
  function claimGoalCoin() {
    try {
      let s = _ensure2();
      let g = _num(s.dailyGoalTarget, 0);
      if (g <= 0) {
        showToast('今天不限量，没有目标奖励可领');
        return;
      }
      if (todayPomos() < g) {
        showToast('还差一点，达成今日目标后才能领取');
        return;
      }
      let ds = getTodayStr();
      if (s.goalCoinClaimedDate === ds) {
        showToast('今天的奖励已领取');
        return;
      }
      s.goalCoinClaimedDate = ds;
      coinEarn(10, 'gift', '今日目标达成奖励');
      _save();
      renderGoalCard();
      refreshGoalChip();
      try {
        renderTreeSection();
      } catch (e) { if (window.__silent) window.__silent(e, '03:claimGoalCoin'); }
      try {
        renderTreeShop();
      } catch (e) { if (window.__silent) window.__silent(e, '03:claimGoalCoin'); }
      try {
        renderTimerTree();
      } catch (e) { if (window.__silent) window.__silent(e, '03:claimGoalCoin'); }
      showToast('🎉 今日专注目标达成！奖励 +10🪙');
    } catch (e) { if (window.__silent) window.__silent(e, '03:claimGoalCoin'); }
  }
  function toggleGoalEdit() {
    try {
      let row = _el('enhGoalEditRow');
      if (!row) return;
      let opening = row.style.display === 'none' || !row.style.display;
      row.style.display = opening ? 'flex' : 'none';
      if (opening) {
        let inp = _el('enhGoalInput');
        if (inp) {
          try {
            inp.focus();
            inp.select();
          } catch (e) { if (window.__silent) window.__silent(e, '03:focusGoalInput'); }
        }
      }
    } catch (e) { if (window.__silent) window.__silent(e, '03:toggleGoalEdit'); }
  }
  function saveGoalFromInput() {
    try {
      let inp = _el('enhGoalInput');
      if (!inp) return;
      let v = parseInt(inp.value, 10);
      if (inp.value.trim() === '' || isNaN(v)) {
        inp.value = _goal();
        try {
          showToast('请输入 0–60 的数字');
        } catch (e) { if (window.__silent) window.__silent(e, '03:saveGoalFromInput'); }
        return;
      }
      setGoal(v);
    } catch (e) { if (window.__silent) window.__silent(e, '03:saveGoalFromInput'); }
  }
  function setGoal(v) {
    try {
      let s = _ensure2();
      v = Math.max(0, Math.min(60, Math.round(_num(v, 0))));
      let cur = _num(s.dailyGoalTarget, 0);
      if (v === cur) return; /* 同值不重复写 */
/* 每日目标是长期设置：随时可改、不要钱，也不按「每天第一次」区分。
   让当天第二次修改收 10🪙 的话，一个「设一次就好」的设置会变成每天要面对的决策。 */
      try {
        showToast(v > 0 ? '🎯 每日目标：' + v + ' 个番茄（长期有效）' : '🎯 每日目标：不限量（长期有效）');
      } catch (e) { if (window.__silent) window.__silent(e, '03:setGoal'); }
      s.dailyGoalTarget = v;
      if (v === 0) s.goalCelebratedDate = '';
      _save();
      renderGoalCard();
      refreshGoalChip();
      try {
        renderTreeSection();
      } catch (e) { if (window.__silent) window.__silent(e, '03:setGoal'); }
      try {
        renderTreeShop();
      } catch (e) { if (window.__silent) window.__silent(e, '03:setGoal'); }
      try {
        renderTimerTree();
      } catch (e) { if (window.__silent) window.__silent(e, '03:setGoal'); }
    } catch (e) { if (window.__silent) window.__silent(e, '03:setGoal'); }
  }
  function renderGoalAll() {
    renderGoalCard();
    refreshGoalChip();
  }
  /* 供主引擎切到计划页「目标」页签时调用 */
  window.renderGoalPage = function () {
    try {
      renderGoalCard();
      refreshGoalChip();
    } catch (e) { if (window.__silent) window.__silent(e, '03:renderGoalAll'); }
    /* 人生目标（年 / 月 / 愿望）由独立模块渲染。两个 try 分开写：
       目标层任何一个字段出错都不该连带把「今日番茄目标」那张卡也刷没。 */
    try {
      if (window.renderLifeGoals) window.renderLifeGoals();
    } catch (e) { if (window.__silent) window.__silent(e, '03:renderLifeGoals'); }
    /* 周期层（本周重点 / 检查点 / 收尾窗口）再单独一个 try：
       它读的是日期和目标两份数据，任何一份形状不对都不该把上面两块带走。 */
    try {
      if (window.renderLifeCycle) window.renderLifeCycle();
    } catch (e) { if (window.__silent) window.__silent(e, '03:renderLifeCycle'); }
  };
  window.saveGoalFromInput = saveGoalFromInput;
  window.setGoal = setGoal;
  window.claimGoalCoin = claimGoalCoin;
  // 内联 onclick="toggleGoalEdit()" 在全局作用域求值，必须桥接（漏了它 → 点「修改」必报 ReferenceError）
  window.toggleGoalEdit = toggleGoalEdit;
  /* ============ ④ 快捷键：P 打断 / 回专注 ============ */
  function _typing() {
    let t = document.activeElement;
    if (!t) return false;
    let tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }
  function initKeys() {
    try {
      window.addEventListener('keydown', function (e) {
        try {
          if (_typing()) return;
          if (document.querySelector('.modal-overlay.show')) return;
          if (e.key === 'p' || e.key === 'P') {
            if (typeof timerMode !== 'undefined' && timerMode !== 'pomodoro') return;
            let st = timerState;
            if (!st) return;
            if (st.mode === 'focus' && st.running) {
              e.preventDefault();
              try {
                interruptPomodoro();
              } catch (e2) { if (window.__silent) window.__silent(e2, '03:initKeys'); }
            } else if (st.mode === 'focus' && !st.running) {
              let im = _el('interruptModal');
              if (im && im.classList.contains('show')) {
                e.preventDefault();
                try {
                  resumeFromInterrupt();
                } catch (e3) { if (window.__silent) window.__silent(e3, '03:initKeys'); }
              }
            }
          }
        } catch (e) { if (window.__silent) window.__silent(e, '03:initKeys'); }
      });
    } catch (e) { if (window.__silent) window.__silent(e, '03:initKeys'); }
  }

  /* ============ ⑤ 休息时保持屏幕常亮（防休眠截断休息倒计时） ============ */
  /* 常亮由「计时状态 + 设置」共同决定，不只在 startBreak 里请求一次。
     浏览器在页面转入后台时会**自动回收** wake lock，切回来时那次请求早已失效 ——
     这就是「专注常亮、休息黑屏」的由来。改成对账式：每帧、每次回到前台各查一次，
     该亮就补请求、不该亮就释放（见 syncWakeLock）。 */
  function hookKeepAwake() {
    if (_orig2.syncWakeLockHooked) return;
    _orig2.syncWakeLockHooked = true;
    _orig2.updateTimerDisplay2 = window.updateTimerDisplay;
    __replace_updateTimerDisplay(function () {
      let r = _orig2.updateTimerDisplay2.apply(this, arguments);
      try { syncWakeLock(); } catch (e) { if (window.__silent) window.__silent(e, '03:syncWakeLock'); }
      return r;
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { try { syncWakeLock(true); } catch (e) { if (window.__silent) window.__silent(e, '03:syncWakeLock'); } }
    });
  }

  /* 当前是否「该亮」：专注中一律亮；休息中看设置；没跑计时就不该亮。
     把判断集中在这一处，就不会再出现「某个进入计时的入口忘了请求」的漏网。 */
  function wakeLockWanted() {
    if (typeof timerState === 'undefined' || !timerState || !timerState.running) return false;
    if (timerState.mode === 'shortBreak' || timerState.mode === 'longBreak') {
      let s = _ensure2();
      return !!(s && s.keepAwakeBreak);
    }
    return true;
  }
  /* 对账：只在「该亮与否」和「当前持有与否」不一致时才动 API，
     避免每帧重复请求；force=true 用于回到前台后补一次（浏览器会回收旧锁）。 */
  function syncWakeLock(force) {
    let want = wakeLockWanted();
    let held = wakeLockActive();
    if (want === held && !force) return;
    if (want && !held) requestWakeLock();
    else if (!want && held) releaseWakeLock();
  }

  /* ============ ⑥ 自动跟随系统深色 ============ */
  let _mqDark = null, _mqLight = null, _lastSysDark = null;
  /* 惰性建媒体查询：dark/light 双探针，用于判断“环境能否感知系统外观” */
  function _ensureMq() {
    try {
      if (!_mqDark && window.matchMedia) {
        _mqDark = window.matchMedia('(prefers-color-scheme: dark)');
        _mqLight = window.matchMedia('(prefers-color-scheme: light)');
      }
    } catch (e) { if (window.__silent) window.__silent(e, '03:_ensureMq'); }
  }
  function _sysThemeKnown() {
    /* 返回 true=能感知系统外观；false=老内核/WebView 不暴露主题，跟随无从谈起 */
    _ensureMq();
    try {
      if (!_mqDark || !_mqLight) return false;
      return !!(_mqDark.matches || _mqLight.matches);
    } catch (e) { return false; }
  }
  function _applyAutoDark() {
    try {
      let s = _ensure2();
      if (s && s.autoDark) {
        _ensureMq();
        if (_sysThemeKnown()) {
          /* 环境支持：严格跟随系统，不再读手动设置 */
          let dark = _mqDark.matches;
          document.body.classList.toggle('dark-mode', dark);
          let sw = _el('setDarkMode');
          if (sw) sw.checked = dark;
          return;
        }
        /* 环境检测不到系统外观：绝不擅自切换（否则深色用户会被闪白）。
           维持用户手动选择，并在设置勾选时提示过一次。 */
        let manual = !!(appData && appData.settings && appData.settings.darkMode);
        document.body.classList.toggle('dark-mode', manual);
        let sw2 = _el('setDarkMode');
        if (sw2) sw2.checked = manual;
        return;
      }
      let manual2 = !!(appData && appData.settings && appData.settings.darkMode);
      document.body.classList.toggle('dark-mode', manual2);
      let sw3 = _el('setDarkMode');
      if (sw3) sw3.checked = manual2;
    } catch (e) { if (window.__silent) window.__silent(e, '03:_applyAutoDark'); }
  }
  function hookDark() {
    if (_orig2.dark) return;
    _orig2.dark = window.toggleDarkMode;
    window.toggleDarkMode = function (on) {
      try {
        let s = _ensure2();
        if (s && s.autoDark) {
          try {
            showToast('🌓 正在跟随系统外观，如需手动切换请先关闭此开关');
          } catch (e) { if (window.__silent) window.__silent(e, '03:hookDark'); }
          _applyAutoDark();
          return;
        }
      } catch (e) { if (window.__silent) window.__silent(e, '03:hookDark'); }
      return _orig2.dark.apply(this, arguments);
    };
  }

  /* ============ ⑦ 记录 CSV 导出 ============ */
  /* 表头与行由纯函数统一构造 —— 唯一定义处：00_pure_core.js 的 recordsCsvTable()。
     此前这里是 17 列，而 05 的另外两处导出各是 14 列：同一份记录三个结构，
     连「折算番茄」的算法都不同（一处走 getPomos 折算、一处读原始 pomos）。
     
     现在共用一份，以后给 records 加字段只改那一个纯函数。 */
  function exportRecordsCSV() {
    try {
      let recs = _recs();
      if (!recs.length) {
        try {
          showToast('还没有专注记录可导出');
        } catch (e) { if (window.__silent) window.__silent(e, '03:exportRecordsCSV'); }
        return;
      }
      let lines = recordsCsvTable(recs).lines;
      let csv = '\ufeff' + lines.join('\r\n');
      let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      let a = document.createElement('a');
      let d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download =
        '瓶子专注_专注记录_' + (d.getFullYear() + '-' + _p2(d.getMonth() + 1) + '-' + _p2(d.getDate())) + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try {
          URL.revokeObjectURL(a.href);
        } catch (e) { if (window.__silent) window.__silent(e, '03:exportRecordsCSV'); }
        a.remove();
      }, 800);
      try {
        showToast('📄 已导出 ' + recs.length + ' 条记录为 CSV');
      } catch (e) { if (window.__silent) window.__silent(e, '03:exportRecordsCSV'); }
    } catch (e) {
      try {
        showToast('⚠️ 导出失败：' + e.message);
      } catch (e2) { if (window.__silent) window.__silent(e2, '03:exportRecordsCSV'); }
    }
  }

  /* ============ ⑦-b 目标层 CSV（四期）============
     表结构由纯函数 lifeCsvTable 生成（00b_goal_progress.js），这里只管落盘。
     和「专注记录 CSV」分成两个文件：记录是流水（一行一个番茄），
     目标是实体（一行一个目标），混一张表里按日期筛会把目标行全带出来。 */
  function exportLifeCSV() {
    try {
      const TF = window.TFGoal;
      if (!TF || typeof TF.lifeCsvTable !== 'function') { showToast('导出组件未就绪'); return; }
      const goals = appData.lifeGoals || [];
      const wf = appData.weekFocus || [];
      const rv = appData.reviews || [];
      if (!goals.length && !wf.length && !rv.length) {
        showToast('还没有目标数据可导出');
        return;
      }
      const t = TF.lifeCsvTable(goals, wf, rv, appData.lifeAreas || [], {
        today: getTodayStr(),
        habits: appData.habits || [],
        habitLogs: appData.habitLogs || {}
      });
      const csv = '\ufeff' + t.lines.join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      const d = new Date();
      a.href = URL.createObjectURL(blob);
      a.download = '瓶子专注_目标与复盘_'
        + (d.getFullYear() + '-' + _p2(d.getMonth() + 1) + '-' + _p2(d.getDate())) + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(a.href); } catch (e) { if (window.__silent) window.__silent(e, '03:exportLifeCSV'); }
        a.remove();
      }, 800);
      showToast('🎯 已导出 ' + (t.lines.length - 1) + ' 行为 CSV');
    } catch (e) {
      try {
        showToast('⚠️ 导出失败：' + e.message);
      } catch (e2) { if (window.__silent) window.__silent(e2, '03:exportLifeCSV'); }
    }
  }

  /* ============ UI 注入：设置项归位到原生分组 + CSV 按钮 ============ */
  function injectGroup571() {
/* 设置分组：每日目标/休息保活放进 ⏱计时设置；自动深色紧跟蓝调开关；快捷键速查放页面底部 */
    if (_el('enh571KeepAwake') && _el('enh571AutoDark')) return true;
    let tBody = document.querySelector('.settings-group[data-group="timer"] .group-body');
    let doneAwake = false,
      doneDark = false,
      doneKey = false;
    if (tBody && !_el('enh571KeepAwake')) {
      /* 插在「🧘 微休息」卡片之前，让卡片始终是计时组的最后一块 */
      const _sb = tBody.querySelector('.setting-subblock');
      const _awakeHtml =
        '<div class="setting-row"><div class="setting-label">💡 休息时保持屏幕常亮<div class="setting-desc">短/长休息期间也保持屏幕常亮（浏览器支持时生效），锁屏不会截断休息倒计时</div></div><label class="switch"><input type="checkbox" id="enh571KeepAwake"><span class="switch-slider"></span></label></div>';
      if (_sb) _sb.insertAdjacentHTML('beforebegin', _awakeHtml);
      else tBody.insertAdjacentHTML('beforeend', _awakeHtml);
      doneAwake = true;
    }
    let darkEl = _el('setDarkMode');
    let darkRow = darkEl ? darkEl.closest('.setting-row') : null;
    if (darkRow && !_el('enh571AutoDark')) {
      darkRow.insertAdjacentHTML(
        'afterend',
        '<div class="setting-row"><div class="setting-label">🌓 跟随系统自动切换深浅色<div class="setting-desc">系统深色时自动使用蓝调模式；开启后上方手动开关由系统接管</div></div><label class="switch"><input type="checkbox" id="enh571AutoDark"><span class="switch-slider"></span></label></div>'
      );
      doneDark = true;
    }
    if (!_el('enhKeyHelp')) {
      let replayL = document.querySelector('.setting-label[onclick*="replayGuide"]');
      let row = replayL ? replayL.closest('.setting-row') || replayL.parentNode : null;
      if (row) {
        let d = document.createElement('div');
        d.id = 'enhKeyHelp';
        d.style.cssText = 'margin:var(--sp-12) var(--sp-16) var(--sp-4);font-size:var(--fs-note);line-height:2;color:var(--text-light);';
        d.innerHTML =
          '<b style="color:var(--text)">⌨️ 快捷键</b>　<b>Space</b> 开始/休息中跳过 · <b>P</b> 打断·继续 · <b>R</b> 重置 · <b>S</b> 跳过休息 · <b>1-5</b> 切换页面 · <b>Esc</b> 关闭弹窗<br>' +
          '<span style="font-size:var(--fs-caption)">输入框内不触发；弹窗打开时仅 Esc/P 生效</span>';
        row.insertAdjacentElement('afterend', d);
        doneKey = true;
      }
    } else {
      doneKey = true;
    }
    return !!(doneAwake && doneDark && doneKey);
  }
  function injectCSVButton() {
    if (_el('enhCsvRow')) return true;
    let body = document.querySelector('.settings-group[data-group="backup"] .group-body');
    if (!body) return false;
    let d = document.createElement('div');
    d.id = 'enhCsvRow';
    d.style.cssText = 'margin-top:var(--sp-6)';
    d.innerHTML =
      '<button class="save-btn" type="button" id="enhCsvBtn" style="background:var(--blue)">📄 导出全部记录为 CSV（Excel 可打开）</button>' +
      '<div style="font-size:var(--fs-note);color:var(--text-light);margin-top:var(--sp-4)">把专注记录导出成表格：日期/时长/番茄/任务/打断/心情等列。</div>' +
      '<button class="save-btn" type="button" id="enhLifeCsvBtn" style="background:var(--green);margin-top:var(--sp-10)">🎯 导出目标 / 周重点 / 复盘为 CSV</button>' +
      '<div style="font-size:var(--fs-note);color:var(--text-light);margin-top:var(--sp-4)">目标、本周重点、复盘三类各占若干行，用「类型」列区分；进度是导出当时的值。</div>';
    body.insertBefore(d, body.firstChild);
    let btn = _el('enhCsvBtn');
    if (btn) btn.addEventListener('click', exportRecordsCSV);
    let btn2 = _el('enhLifeCsvBtn');
    if (btn2) btn2.addEventListener('click', exportLifeCSV);
    return true;
  }
  function bindUI() {
    let kw = _el('enh571KeepAwake');
    if (kw) {
      kw.checked = !!(_ensure2() && _ensure2().keepAwakeBreak);
      kw.addEventListener('change', function () {
        _ensure2().keepAwakeBreak = kw.checked;
        _save();
      });
    }
    let ad = _el('enh571AutoDark');
    if (ad) {
      ad.checked = !!(_ensure2() && _ensure2().autoDark);
      ad.addEventListener('change', function () {
        if (ad.checked && !_sysThemeKnown()) {
/* 当前内核感知不到系统外观，开启「跟随系统」只会造成误切（深色用户闪白）。回退开关并说明。 */
          ad.checked = false;
          _ensure2().autoDark = false;
          _save();
          try {
            showToast('⚠️ 当前浏览器不支持检测系统外观，“跟随系统”已保持关闭，以免误切');
          } catch (e) { if (window.__silent) window.__silent(e, '03:bindUI'); }
          return;
        }
        _ensure2().autoDark = ad.checked;
        if (!ad.checked && appData && appData.settings && appData.settings.darkMode) {
          _ensure2().autoDark = false;
        }
        _save();
        _applyAutoDark();
        try {
          showToast(ad.checked ? '🌓 已开启跟随系统深浅色（原手动开关被接管）' : '已恢复手动深浅色模式');
        } catch (e) { if (window.__silent) window.__silent(e, '03:bindUI'); }
      });
    }
  }

  /* ============ 启动 ============ */
  function boot2() {
    try {
      if (typeof appData === 'undefined' || !appData || !appData.settings) return false;
      _ensure2();
      if (typeof document !== 'undefined' && document.title) _baseTitle = document.title;
      let ok1 = injectGroup571();
      let ok2 = injectCSVButton();
      let ok3 = ensureGoalCard();
      /* 原判断 ok1&&ok2&&ok3 会让"每日目标卡未启用"时
         整个模块后续（含自动深浅的开关绑定/系统监听/轮询）全部不启动，
         表现为"跟随系统开关点了没反应/不跟手"。目标卡只是装饰增强，
         失败不该拖垮其它功能 → 闸门只要求 ok1(设置行)+ok2(CSV 按钮)。 */
      if (!ok1 || !ok2) return false;
      if (!_booted2) {
        _booted2 = true;
        bindUI();
        initKeys();
        hookKeepAwake();
        hookDark();
        /* 包装渲染/刷新入口 */
        _orig2.renderStats2 = window.renderStats;
        window.renderStats = function () {
          let r = _orig2.renderStats2.apply(this, arguments);
          setTimeout(function () {
            try {
              renderGoalAll();
            } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
          }, 40);
          return r;
        };
        _orig2.uts = window.updateTodayStats;
        if (_orig2.uts) {
          window.updateTodayStats = function () {
            let r = _orig2.uts.apply(this, arguments);
            try {
              refreshGoalChip();
            } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
            return r;
          };
        }
        /* 每笔记录落库后检查达标庆祝 */
        _orig2.spr = window.savePomodoroRecord;
        if (_orig2.spr) {
          __replace_savePomodoroRecord(function (type) {
            let r = _orig2.spr.apply(this, arguments);
            setTimeout(function () {
              try {
                let s = _ensure2(),
                  g = _num(s.dailyGoalTarget, 0);
                if (g > 0 && todayPomos() >= g && s.goalCelebratedDate !== getTodayStr()) {
                  s.goalCelebratedDate = getTodayStr();
                  _save();
                  setTimeout(function () {
                    try {
                      showToast('🎉 今日专注目标（' + g + ' 个🍅）达成！记得犒劳自己');
                    } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
                  }, 1200);
                }
                refreshGoalChip();
                renderGoalCard();
              } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
            }, 80);
            return r;
          });
        }
      }
      try {
        renderGoalAll();
      } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
/* 时序：先建媒体查询监听再应用。反过来的话，autoDark 首次应用时 _mqDark 还是 null →
   dark=false → 会把用户手动开的深色剥成浅色（闪白）。 */
      try {
        _ensureMq();
        let fn = function () {
          try {
            let s = _ensure2();
            if (s && s.autoDark) _applyAutoDark();
          } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
        };
        if (_mqDark && _mqDark.addEventListener) _mqDark.addEventListener('change', fn);
        else if (_mqDark && _mqDark.addListener) _mqDark.addListener(fn);
      } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
/* 自动深浅"轮询兜底"：部分 WebView/浏览器不派发 matchMedia change 事件，
   导致系统切深浅后 App 不跟随。800ms 轻轮询对比系统状态，变化才应用 ——
   事件正常时二者幂等，无冲突。 */
      try {
        _ensureMq();
        _lastSysDark = _sysThemeKnown() ? !!_mqDark.matches : null;
        if (_lastSysDark !== null) {
          /* 可休眠 UI 跟随轮询 → __ivGov.add（后台零唤醒；回前台首 tick 检测差异即自愈）。
             事件派发正常的浏览器仍走上方 matchMedia 监听，本兜底二者幂等。 */
          let _sysDarkWatch = function () {
            try {
              _ensureMq();
              if (!_sysThemeKnown()) return;
              let _d = !!_mqDark.matches;
              if (_d !== _lastSysDark) {
                _lastSysDark = _d;
                let _s2 = _ensure2();
                if (_s2 && _s2.autoDark) _applyAutoDark();
              }
            } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
          };
          if (window.__ivGov) window.__ivGov.add(_sysDarkWatch, 800);
          else setInterval(_sysDarkWatch, 800);
        }
      } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
/* 老内核不暴露系统外观时：把历史遗留的 autoDark=true 自动回退，避免开关"虚挂"不生效 */
      try {
        let _sd = _ensure2();
        if (_sd && _sd.autoDark && !_sysThemeKnown()) {
          _sd.autoDark = false;
          _save();
        }
      } catch (e) { if (window.__silent) window.__silent(e, '03:boot2'); }
      _applyAutoDark();
      return true;
    } catch (e) {
      return false;
    }
  }

  let _tries2 = 0;
  (function wait2() {
    try {
      if (typeof appData !== 'undefined' && appData && appData.settings) {
        if (boot2()) {
          if (window.__ivGov)
            __ivGov.add(function () {
              try {
                updateTitle();
              } catch (e) { if (window.__silent) window.__silent(e, '03:wait2'); }
            }, 1000);
          else
            setInterval(function () {
              try {
                updateTitle();
              } catch (e) { if (window.__silent) window.__silent(e, '03:wait2'); }
            }, 1000);
          return;
        }
      }
      _tries2++;
      if (_tries2 > 200) return;
      setTimeout(wait2, 500);
    } catch (e) {
      setTimeout(wait2, 500);
    }
  })();
})();
