/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 折叠记忆：对外仅 window.__uiFold 暴露的 toggle/sync/state。
 * 红线：勿绕过 __uiFold 手写折叠黑名单/自研折叠。 */
/* ============================================================
 * __uiFold · 折叠记忆 + 极简联动
 * ============================================================
 * 整段可回退：删除本 <script> 即 100% 还原（对既有逻辑零改动）。
 *
 * 职责（两用）：
 *  A. 内置扫描计时页「当前状态」「任务难度」两处 .state-section 并折叠化；
 *  B. 提供 register()/remove() —— 供 __comp 组件注册表把任意"可折叠容器"
 *     收编进来，统一获得：点标题收/展 + 手动偏好记忆 + 极简联动。
 *
 * 规则（勿破坏）：
 *  - 普通模式默认展开；手动收起/展开写入 appData.uiPrefs.foldPrefs（单通道持久化）。
 *  - 极简模式开启 → 所有已注册块默认收起（临时，不写手动偏好）；
 *    极简下可手动展开（仅本会话）；关闭极简 → 恢复手动记忆。
 *  - 只加 class + CSS，不搬动 DOM；applyMinimalMode 包装 + MutationObserver 兜底。
 *  - ES5 语法。
 * 函数索引（TOC）：foldData/loadFoldFromData/persistFold/waitDataThenSync/q/isMinimal/byKey/wantOpen/applyOne/sync/toggleKey/makeBlock（+10 更多）
 * ============================================================ */
(function () {
  let blocks = [];
  let pending = []; /* register() 时容器尚不存在的待办 */
  let mmOpen = {}; /* 极简会话内手动覆盖（不持久化） */
  let pref = {}; /* {key: open(bool)} 手动偏好；数据就绪后指向 appData.uiPrefs.foldPrefs */
  let defClosed = {}; /* {key:true} 首进默认折叠声明（仅 pref 无显式记录时生效） */
  let _moTimer = null;
  let _bootWait = 0;

  /* 折叠偏好收编 appData.uiPrefs.foldPrefs（原 tomato_ui_fold_v1 散键已删，migrate 已搬迁）。
     本 IIFE 可能早于 loadData 执行 → 启动先默认展开，数据就绪后 waitDataThenSync 一次性按真实偏好纠正。 */
  function foldData() {
    try {
      if (appData && appData.uiPrefs) {
        if (!appData.uiPrefs.foldPrefs || typeof appData.uiPrefs.foldPrefs !== 'object') appData.uiPrefs.foldPrefs = {};
        return appData.uiPrefs.foldPrefs;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '07:foldData'); }
    return null;
  }
  function loadFoldFromData() {
    let d = foldData();
    if (d) {
      pref = d;
      return true;
    }
    return false;
  }
  function persistFold() {
    /* 数据未就绪（早于 loadData）只留内存；就绪后写主存储单通道（saveData 防抖） */
    let d = foldData();
    if (!d) return;
    appData.uiPrefs.foldPrefs = pref;
    try {
      saveDataNow();
    } catch (e) { if (window.__silent) window.__silent(e, '07:persistFold'); }
  }
  function waitDataThenSync() {
    /* 必须等 window.__bootDone（主引擎 init() 完成 = loadData 已把 appData 装载/替换到位），
       否则可能把 pref 绑到 loadData 替换前的默认空对象上，导致真实折叠偏好不生效。 */
    try {
      if (window.__bootDone && loadFoldFromData()) {
        sync();
        return;
      }
    } catch (e) { if (window.__silent) window.__silent(e, '07:waitDataThenSync'); }
    if (_bootWait < 100) {
      _bootWait++;
      setTimeout(waitDataThenSync, 100);
    }
  }
  function q(s) {
    try {
      return document.querySelector(s);
    } catch (e) {
      return null;
    }
  }
  function isMinimal() {
    return !!(document.body && document.body.classList.contains('minimal-mode'));
  }

  function byKey(k) {
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].key === k) return blocks[i];
    }
    return null;
  }
  function wantOpen(b) {
    if (isMinimal()) return mmOpen[b.key] === true;
    /* 无显式手动偏好时，读「首进默认折叠」声明 */
    if (pref[b.key] === undefined && defClosed[b.key]) return false;
    return pref[b.key] !== false;
  }

  function applyOne(b) {
    let open = wantOpen(b);
    b.sec.classList.toggle('fb-closed', !open);
    try {
      b.title.setAttribute('aria-expanded', open ? 'true' : 'false');
    } catch (e) { if (window.__silent) window.__silent(e, '07:applyOne'); }
    if (b.arrow) b.arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)';
  }
  function sync() {
    for (let i = 0; i < blocks.length; i++) applyOne(blocks[i]);
  }

  function toggleKey(k) {
    let b = byKey(k);
    if (!b) return;
    let cur = wantOpen(b),
      nv = !cur;
    if (isMinimal()) {
      mmOpen[k] = nv;
    } else {
      pref[k] = nv;
      persistFold();
    }
    applyOne(b);
  }

  function makeBlock(key, sec, title, label) {
    if (!key || !sec || !title) return null;
    let old = byKey(key);
    if (old) return old;
    if (sec.__uiFoldDone) return null; /* 防同一容器重复加箭头 */
    sec.__uiFoldDone = true;
    title.classList.add('fb-hd');
    let arrow = document.createElement('span');
    arrow.className = 'fb-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '▼';
    title.appendChild(arrow);
    title.title = title.title || '点击收起 / 展开';
    title.onclick = (function (k) {
      return function (e) {
        try {
          e = e || window.event;
          if (e.stopPropagation) e.stopPropagation();
          toggleKey(k);
        } catch (_e) { if (window.__silent) window.__silent(_e, '07:makeBlock'); }
      };
    })(key);
    let b = { key: key, label: label || title.textContent || key, sec: sec, title: title, arrow: arrow };
    blocks.push(b);
    applyOne(b);
    return b;
  }

  /* —— A. 内置扫描计时页两块 —— */
  function injectCSS() {
    try {
      if (document.getElementById('__uiFoldCss')) return;
      let st = document.createElement('style');
      st.id = '__uiFoldCss';
      st.textContent =
        '' +
        /* 这两个 !important 是**故意留的护栏**，不是赘余，别按「清理 !important」删掉：
           · .fb-hd{display:flex} —— autoTitle() 是「先找 .state-section-title，找不到才退回
             children[0]」，即标题**不保证**是首子。若它落在中间，下面那条 .fb-closed 规则
             (0,2,0) 会把标题一起藏掉，全靠这里的 !important 把它捞回来。
           · .fb-closed>*:not(:first-child){display:none} —— 这是「只留标题」的原语，
             子元素若自带更高特异性的 display 规则会重新冒出来。 */
        '.fb-hd{display:flex!important;align-items:center;justify-content:space-between;gap:var(--sp-8);cursor:pointer;-webkit-user-select:none;user-select:none;}' +
        '.fb-hd .fb-arrow{font-size:var(--fs-caption);color:var(--text-light);flex-shrink:0;transition:transform .18s ease;line-height:1;}' +
        '.fb-closed>*:not(:first-child){display:none!important;}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { if (window.__silent) window.__silent(e, '07:injectCSS'); }
  }
  function autoTitle(sec) {
    let t = null;
    for (let j = 0; j < sec.children.length; j++) {
      let c = sec.children[j];
      if (c && c.className && ('' + c.className).indexOf('state-section-title') >= 0) {
        t = c;
        break;
      }
    }
    if (!t && sec.children.length) t = sec.children[0];
    return t;
  }
  function findBlocks() {
    let wrap = q('#view-timer .current-todo-section');
    if (!wrap) return;
    let secs = wrap.querySelectorAll('.state-section');
    for (let i = 0; i < secs.length; i++) {
      let sec = secs[i];
      if (!sec || sec.__uiFoldDone) continue;
      let title = autoTitle(sec);
      if (!title) continue;
      let text = title.textContent || '';
      let key = null;
      if (text.indexOf('当前状态') >= 0) key = 'timer_state';
      else if (text.indexOf('任务难度') >= 0) key = 'timer_diff';
      if (!key) continue;
      makeBlock(key, sec, title, text);
    }
  }

  /* —— B. 注册表接入 —— */
  function resolve(v) {
    if (!v) return null;
    if (typeof v === 'function') {
      try {
        return resolve(v());
      } catch (e) {
        return null;
      }
    }
    if (typeof v === 'string') return q(v);
    return v.nodeType ? v : null;
  }
  function register(cfg) {
    try {
      if (!cfg || !cfg.key) return false;
      if (byKey(cfg.key)) return true; /* 幂等 */
      let sec = resolve(cfg.sec),
        title = resolve(cfg.title);
      if (!title && sec) title = autoTitle(sec);
      if (!sec || !title) {
        /* 容器还没就绪：进待办，稍后(同步尾/准备就绪)再试一次 */
        if (!hasPending(cfg.key)) pending.push({ cfg: cfg, at: Date.now() });
        flushPending();
        return false;
      }
      return !!makeBlock(cfg.key, sec, title, cfg.label);
    } catch (e) {
      return false;
    }
  }
  function hasPending(k) {
    for (let i = 0; i < pending.length; i++) {
      if (pending[i].cfg.key === k) return true;
    }
    return false;
  }
  function flushPending() {
    if (!pending.length) return;
    let left = [];
    for (let i = 0; i < pending.length; i++) {
      let it = pending[i];
      let sec = resolve(it.cfg.sec),
        title = resolve(it.cfg.title);
      if (!title && sec) title = autoTitle(sec);
      if (sec && title) {
        if (byKey(it.cfg.key)) continue;
        makeBlock(it.cfg.key, sec, title, it.cfg.label);
      } else if (Date.now() - it.at < 15000) left.push(it);
    }
    pending = left;
  }
  function remove(key) {
    let b = byKey(key);
    if (!b) return false;
    try {
      b.sec.classList.remove('fb-closed');
      b.sec.__uiFoldDone = false;
      b.title.classList.remove('fb-hd');
      if (b.arrow && b.arrow.parentNode) b.arrow.parentNode.removeChild(b.arrow);
      try {
        b.title.onclick = null;
      } catch (e) { if (window.__silent) window.__silent(e, '07:remove'); }
      b.title.removeAttribute('aria-expanded');
    } catch (e) { if (window.__silent) window.__silent(e, '07:remove'); }
    let idx = -1;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].key === key) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) blocks.splice(idx, 1);
    delete pref[key];
    persistFold();
    delete mmOpen[key];
    return true;
  }

  /* 1) 包装 applyMinimalMode */
  function patchMinimal() {
    try {
      if (typeof window.applyMinimalMode !== 'function') return;
      let orig = window.applyMinimalMode;
      window.applyMinimalMode = function () {
        try {
          return orig.apply(this, arguments);
        } finally {
          try {
            mmOpen = {};
            sync();
          } catch (e) { if (window.__silent) window.__silent(e, '07:patchMinimal'); }
        }
      };
    } catch (e) { if (window.__silent) window.__silent(e, '07:patchMinimal'); }
  }
  /* 2) MutationObserver 兜底 */
  function patchObserver() {
    try {
      if (typeof MutationObserver === 'undefined' || !document.body) return;
      let mo = new MutationObserver(function () {
        try {
          if (_moTimer) clearTimeout(_moTimer);
          _moTimer = setTimeout(function () {
            try {
              flushPending();
              sync();
            } catch (e) { if (window.__silent) window.__silent(e, '07:patchObserver'); }
          }, 40);
        } catch (e) { if (window.__silent) window.__silent(e, '07:patchObserver'); }
      });
      mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { if (window.__silent) window.__silent(e, '07:patchObserver'); }
  }

  /* 启动 */
  try {
    injectCSS();
    findBlocks();
    patchMinimal();
    patchObserver();
    flushPending();
    sync();
    waitDataThenSync(); /* loadData 就绪后按 appData.uiPrefs.foldPrefs 纠正一次 */
    window.__uiFold = {
      toggle: function (k) {
        toggleKey(k);
      },
      sync: sync,
      state: function () {
        let o = {};
        for (let i = 0; i < blocks.length; i++) o[blocks[i].key] = !wantOpen(blocks[i]);
        return o;
      },
      keys: function () {
        let a = [];
        for (let i = 0; i < blocks.length; i++) a.push(blocks[i].key);
        return a;
      },
      register: register,
      remove: function (k) {
        return remove(k);
      },
      clearPref: function (k) {
        delete pref[k];
        persistFold();
        return true;
      },
      /* 默认态收敛：声明「首进默认折叠」的 key。
       * 语义：仅当用户**从未手动改过**该块时才生效；用户点过一次后即以手动偏好为准。
       * 实现：只登记标记（defClosed），**不写 pref**——
       *   因为 pref 一旦被系统写入，就无法与"用户真实偏好"区分（这正是首版踩的坑：
       *   系统写 false → 下次启动误判为"用户已选择收起" → 用户手动展开的偏好被吞）。
       *   正确路径：wantOpen 在 pref 无该 key 时读 defClosed 兜底；
       *   用户手动 toggle 时才写 pref，此时 pref 有值，天然盖过 defClosed。 */
      defaultClosed: function (keys) {
        let arr = [].concat(keys || []);
        let n = 0;
        for (let i = 0; i < arr.length; i++) {
          let k = arr[i];
          if (!k || defClosed[k]) continue;
          defClosed[k] = true;
          let b = byKey(k);
          if (b) applyOne(b); /* 立即按新默认态重绘（不落盘） */
          n++;
        }
        return n;
      },
      _defClosed: function () {
        return defClosed;
      },
      _mm: function (o) {
        if (o && typeof o === 'object') mmOpen = o;
        return mmOpen;
      },
      _pref: function () {
        return pref;
      },
      _dataReady: function () {
        return !!(appData && appData.uiPrefs && appData.uiPrefs.foldPrefs);
      }
    };
  } catch (e) { if (window.__silent) window.__silent(e, '07:patchObserver'); }
})();
