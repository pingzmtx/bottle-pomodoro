/* ════════════════════════════════════════════════════════════════════
    瓶子专注 · v5.7.2 统计热路径缓存（性能专项）
   ────────────────────────────────────────────────────────────────────
   说明：主引擎有三处「每次进统计页都会全量遍历 records」的热点
   ① renderYearHeatmap 建 dayMap（② renderStats 内联 dateSet 已移除：
      连续天数改读 calcStreakStats 的单一实现，不再需要 __enhFullDateSet）
   ③ processWeeklyBadges 建 allWeeks
   本模块为这三处提供「记录级版本缓存」助手；主代码改为优先调用
   window.__enh* 助手、模块缺失时自动回退原逻辑，因此：
   - 删掉本段即可 100% 回退到未优化主代码（回退逻辑内建）。
   - 失效条件 = records 数组被整体替换 或 长度/末条记录变化，
     与主代码原有 _statsCache 失效策略一致，无脏读。
 * 函数索引（TOC）：recVer/ensure/_warmRun/_warmMark/_bootWarm
   ════════════════════════════════════════════════════════════════════ */
(function () {
  let _arr = null; /* 上次的 records 引用 */
  let _ver = ''; /* 长度|末条id|末条startTime */
  let _yearMap = null;
  let _week = { key: '', currentWeek: '', allWeeks: null };

  function recVer() {
    let recs = typeof appData !== 'undefined' && appData && Array.isArray(appData.records) ? appData.records : [];
    let first = recs.length ? recs[0] : null;
    let last = recs.length ? recs[recs.length - 1] : null;
    return (
      recs.length + '|' + (first ? first.id : '') + '|' + (last ? last.id : '') + '|' + (last ? last.startTime : '')
    );
  }
  function ensure() {
    let recs = typeof appData !== 'undefined' && appData && Array.isArray(appData.records) ? appData.records : [];
    let v = recVer();
    if (_arr === recs && _ver === v) return; /* 双保险：引用未换且版本未变 */
    _arr = recs;
    _ver = v;
    /* 全量重建一次（与主代码语义逐字一致） */
    let ym = {};
    for (let i = 0; i < recs.length; i++) {
      let r = recs[i];
      if (!r || !r.startTime) continue;
      let ds = window.__enhDstr
        ? window.__enhDstr(r.startTime)
        : (function () {
            let d = new Date(r.startTime),
              p = function (n) {
                return String(n).padStart(2, '0');
              };
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
          })();
      ym[ds] = (ym[ds] || 0) + getPomos(r);
    }
    _yearMap = ym;
    _week = { key: '', currentWeek: '', allWeeks: null }; /* 周缓存另行惰性构建 */
  }
  window.__enhDstr = function (ts) {
    let d = new Date(ts);
    return d.getFullYear() + '-' + _p2(d.getMonth() + 1) + '-' + _p2(d.getDate());
  };

  window.__enhYearDayMap = function () {
    ensure();
    return _yearMap;
  };
  window.__enhWeekInfo = function () {
    ensure();
    try {
      let cw = getWeekStartStr();
      if (_week.key === _ver + '|' + cw && _week.allWeeks) return _week;
      let recs = _arr || [];
      let wk = new Set();
      for (let i = 0; i < recs.length; i++) {
        let r = recs[i];
        if (!r || !r.startTime) continue;
        if (r.type === 'full' || r.type === 'half') {
          let ws = getWeekStartStr(r.startTime);
          if (ws !== cw) wk.add(ws);
        }
      }
      _week = { key: _ver + '|' + cw, currentWeek: cw, allWeeks: wk };
      return _week;
    } catch (e) {
      /* 极端兜底：返回空（回退逻辑会因 currentWeek 不一致重算） */
      return { currentWeek: '', allWeeks: new Set() };
    }
  };

  /* ═══ 统计空闲预热（未雨绸缪：让"重算"永远发生在空闲期，而不是用户点开统计页那一刻） ═══
     写记录/日记/段位等会 invalidateStatsCache → 这里置脏并调度空闲重算：
     · requestIdleCallback 优先（timeout 400ms 兜底），页面有空档就悄悄把 getStatsCache + 年度/连续天数缓存算热；
     · 用户随后点进统计页时 _statsCache.key 已命中 → O(1) 直取，不再同步全扫 records。
     纯异步、不改任何同步语义：invalidate 后仍照旧，只是多了后台预热。 */
  let _warmDirty = false,
    _warmSched = false;
  function _warmRun() {
    _warmSched = false;
    if (!_warmDirty) return;
    _warmDirty = false;
    try {
      getStatsCache();
    } catch (e) { if (window.__silent) window.__silent(e, '04:_warmRun'); }
    try {
      ensure();
    } catch (e) { if (window.__silent) window.__silent(e, '04:_warmRun'); } /* 顺带把 __enh 年度/连续/周缓存也重建热 */
  }
  function _warmMark() {
    _warmDirty = true;
    if (_warmSched) return;
    _warmSched = true;
    let _f =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : function (cb) {
            return setTimeout(cb, 120);
          };
    try {
      _f(
        function () {
          _warmRun();
        },
        { timeout: 400 }
      );
    } catch (e) {
      setTimeout(_warmRun, 150);
    }
  }
  let _origInv = window.invalidateStatsCache;
  if (typeof _origInv === 'function') {
    __replace_invalidateStatsCache(function () {
      let _r = _origInv.apply(this, arguments);
      try {
        _warmMark();
      } catch (e) { if (window.__silent) window.__silent(e, '04:_warmMark'); }
      return _r;
    });
  }
  /* 首次打开预热一次：覆盖"老用户一进来就点统计页"的冷缓存 */
  function _bootWarm() {
    try {
      getStatsCache();
    } catch (e) { if (window.__silent) window.__silent(e, '04:_bootWarm'); }
    try {
      ensure();
    } catch (e) { if (window.__silent) window.__silent(e, '04:_bootWarm'); }
  }
  if (document.readyState === 'loading') {
    window.addEventListener('load', function () {
      setTimeout(_bootWarm, 700);
    });
  } else {
    setTimeout(_bootWarm, 700);
  }
})();
