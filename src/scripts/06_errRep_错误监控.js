/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 错误监控：对外仅 window.__errRep 一个对象；内部自成一体。
 * 红线：其他模块勿散落调用其内部函数，统一走 __errRep 暴露的接口。 */
/* [M4a] 本文件为 src/scripts 源文件，经 build.py 合并进发布单文件 index.html；改动请直接改这里后运行: python3 build.py
 */

/* ════════════════════════════════════════════════════════════════════
    M1 · 运行时监控（错误恢复→9）
   ────────────────────────────────────────────────────────────────────
   ① __errRep —— 全局错误监控：
      全局 error / unhandledrejection 捕获 → 内存环形缓冲 + 控制台聚合；
      出错后页面右下角出现小角标（仅本会话内存态，可关闭、可一键「导出错误现场」）。
      把历史「异常被逐点 catch 静默吞掉」变成「可发现、可上报、可排查」。
   ② __dataMig —— 版本化数据迁移链见文件头部预置区（必须早于 loadData 生效），
      loadData（本地载入）/ 导入 / 恢复自动备份 三条路统一走 __dataMig.run(...)；
      每次执行写入 appData.__migration 审计轨迹（from→to + 步骤清单）。
   回退：整段移除本 <script> 即可移除 __errRep（零外联、对既有代码零改动）。
 * 函数索引（TOC）：errBadgeOff/errBadgeSetOff/esc/push/warn/badgeEl/renderBadge/panelEl/closePanel/renderPanel/openPanel/exportErrors（+1 更多）
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ========== ① __errRep 错误监控 ========== */
  let CAP = 60,
    list = [],
    badge = null,
    panel = null;
  /* 角标关闭标记收编 appData.uiPrefs.errBadgeOff（原 tomato_errbadge_off 散键已删）。
     IIFE 可能早于 loadData 执行 → 一律惰性读写，appData 未就绪时按"未关闭"处理。 */
  function errBadgeOff() {
    try {
      return !!(appData && appData.uiPrefs && appData.uiPrefs.errBadgeOff);
    } catch (e) {
      return false;
    }
  }
  function errBadgeSetOff(on) {
    try {
      if (appData && appData.uiPrefs) {
        appData.uiPrefs.errBadgeOff = !!on;
        saveDataNow();
      }
    } catch (e) {}
  }
  /* ★ 这里**故意**保留一份自己的转义实现，不走 01e 的 escapeHtml：
     本模块是错误监控 —— 它必须在**别人出错时**还能正常工作，
     而 escapeHtml 依赖 01e 已加载（且它内部要 document.createElement）。
     依赖别人就等于「01e 挂了，错误面板也一起挂」，那监控就白做了。
     （同理本文件不引用任何业务函数。） */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function push(err, src, level) {
    let item = { t: new Date().toISOString(), src: src || 'window', level: level || 'error', msg: '', stack: '' };
    try {
      if (err && typeof err === 'object' && err.message != null) {
        item.msg = String(err.message);
        item.stack = err.stack ? String(err.stack).slice(0, 900) : '';
      } else if (err && err.msg) {
        item.msg = String(err.msg);
        item.stack = String(err.stack || '').slice(0, 900);
      } else if (typeof err === 'string') {
        item.msg = err;
      } else {
        item.msg = String(err);
      }
      if (!item.msg) item.msg = '(空错误)';
    } catch (e2) {
      item.msg = '<不可序列化错误>';
    }
    list.push(item);
    if (list.length > CAP) list.shift();
    try {
      if (window.console && console.warn)
        console.warn('[M1] ' + (item.level === 'warn' ? '⚠ ' : '✗ ') + item.src + ' | ' + item.msg.slice(0, 160));
    } catch (e3) {}
    if (level !== 'warn') renderBadge();
    return item;
  }
  function warn(src, msg) {
    return push(msg, src, 'warn');
  }
  function badgeEl() {
    if (badge && document.body && document.body.contains(badge)) return badge;
    badge = document.createElement('div');
    badge.id = 'm1ErrBadge';
    badge.style.cssText =
      'position:fixed;right:10px;bottom:86px;z-index:2147483000;background:rgba(214,69,65,.94);color:#fff;font:600 12px/1 system-ui,-apple-system,"PingFang SC",sans-serif;padding:var(--sp-6) var(--sp-10);border-radius:var(--radius-full);box-shadow:0 3px 12px rgba(0,0,0,.25);cursor:pointer;display:none;align-items:center;gap:var(--sp-6);user-select:none;-webkit-user-select:none;max-width:72vw;';
    badge.title = 'M1 运行时监控：点击查看错误现场';
    badge.addEventListener('click', function () {
      openPanel();
    });
    (document.body || document.documentElement).appendChild(badge);
    return badge;
  }
  function renderBadge() {
    let errN = list.filter(function (x) {
      return x.level === 'error';
    }).length;
    if (!errN || errBadgeOff()) {
      if (badge) badge.style.display = 'none';
      return;
    }
    let b = badgeEl();
    b.innerHTML =
      '<span style="font-size:var(--fs-tiny)">✗</span> ' +
      errN +
      ' 个错误<span style="opacity:.75;font-weight:400"> · 点看</span>';
    b.style.display = 'flex';
  }
  function panelEl() {
    if (panel && document.body && document.body.contains(panel)) return panel;
    panel = document.createElement('div');
    panel.id = 'm1ErrPanel';
    panel.style.cssText =
      'position:fixed;right:10px;bottom:124px;z-index:2147483001;width:min(320px,calc(100vw - 20px));max-height:46vh;background:#fff;color:#222;border:1px solid rgba(0,0,0,.14);border-radius:var(--radius-md);box-shadow:0 8px 30px rgba(0,0,0,.22);font:13px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif;display:none;flex-direction:column;overflow:hidden;';
    let hd = document.createElement('div');
    hd.style.cssText =
      'padding:var(--sp-8) var(--sp-12);background:#f6f6f8;font-weight:700;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eee;';
    hd.innerHTML =
      '<span>🛡️ M1 运行时监控</span><span id="m1ErrClose" style="cursor:pointer;opacity:.6;font-size:var(--fs-title)">✕</span>';
    let body = document.createElement('div');
    body.id = 'm1ErrBody'; /* 稳定锚点：renderPanel 直接用 id 取，不再靠内联样式字符串匹配
                              （浏览器会把 cssText 序列化成 "overflow: auto"，带空格，故选器必然失配） */
    body.style.cssText = 'padding:var(--sp-8) var(--sp-10);overflow:auto;flex:1;';
    let ft = document.createElement('div');
    ft.style.cssText =
      'padding:var(--sp-6) var(--sp-10);border-top:1px solid #eee;display:flex;gap:var(--sp-8);flex-wrap:wrap;background:#fafafa;';
    panel.appendChild(hd);
    panel.appendChild(body);
    panel.appendChild(ft);
    (document.body || document.documentElement).appendChild(panel);
    hd.querySelector('#m1ErrClose').onclick = function () {
      closePanel();
    };
    let btn = function (txt, fn) {
      let b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText =
        'flex:1;min-width:70px;padding:var(--sp-4) var(--sp-4);border-radius:var(--radius);border:1px solid #ddd;background:#fff;cursor:pointer;font-size:var(--fs-caption);';
      b.onclick = fn;
      ft.appendChild(b);
      return b;
    };
    btn('导出错误现场', function () {
      exportErrors();
    });
    btn('清空', function () {
      list = [];
      renderBadge();
      renderPanel();
    });
    btn('本会话关闭', function () {
      errBadgeSetOff(true);
      if (badge) badge.style.display = 'none';
      closePanel();
    });
    btn('恢复显示', function () {
      errBadgeSetOff(false);
      renderBadge();
    });
    return panel;
  }
  /* 关闭面板并恢复角标（角标此前被 openPanel 隐藏；关闭后应让它回来，否则面板一关
     角标也消失、用户再也点不开）。 */
  function closePanel() {
    if (panel) panel.style.display = 'none';
    renderBadge();
  }
  function renderPanel() {
    let p = panelEl();
    /* 用 id 直接取内容容器（稳定），不再用内联样式字符串做选择器——
       旧写法 p.querySelector('div[style*="overflow:auto"]') 会因浏览器把 cssText
       序列化为 "overflow: auto"（带空格）而恒为 null，导致 openPanel 抛
       "Cannot set properties of null"，面板永远打不开、每次点击还自增一条错误。 */
    let body = p.querySelector('#m1ErrBody') || document.getElementById('m1ErrBody');
    if (!body) return;
    let b = document.createElement('div');
    if (!list.length) {
      b.textContent = '✅ 本次会话暂无记录';
      b.style.cssText = 'color:#777;padding:var(--sp-14) var(--sp-4);text-align:center;';
    } else {
      list
        .slice()
        .reverse()
        .forEach(function (x) {
          try {
            let d = document.createElement('div');
            d.style.cssText = 'padding:var(--sp-6) var(--sp-4);border-bottom:1px solid #eee;';
            let msg = String(x.msg == null ? '' : x.msg);
            d.innerHTML =
              '<div style="color:var(--text-light);font-size:var(--fs-tiny)">' +
              esc(String(x.t || '').slice(11, 19)) +
              ' · ' +
              esc(x.src) +
              (x.level === 'warn' ? ' · ⚠ 兼容提示' : '') +
              '</div><div style="word-break:break-all">' +
              esc(msg.slice(0, 220)) +
              (msg.length > 220 ? '…' : '') +
              '</div>';
            if (x.stack) {
              let _st = document.createElement('div');
              _st.style.cssText = 'color:var(--text-light);font-size:var(--fs-tiny);word-break:break-all;margin-top:var(--sp-2);';
              _st.textContent = String(x.stack).slice(0, 240);
              d.appendChild(_st);
            }
            b.appendChild(d);
          } catch (e2) {
            /* 单条记录渲染失败不得拖垮整个面板 */
          }
        });
    }
    body.replaceChildren(b);
  }
  function openPanel() {
    let p = panelEl();
    /* 先显示面板再渲染：即便渲染出任何意外，面板本身也保证能打开（渲染在前的话，
       一抛异常 display='flex' 就永远执行不到 → "点了没反应"）。 */
    p.style.display = 'flex';
    renderPanel();
    if (badge) badge.style.display = 'none';
  }
  function exportErrors() {
    let meta = {};
    try {
      /* 版本号口径：优先用「构建日期版本号」（形如 2026.10.12，由 01g 从产物首行读出后
         挂在 window.__buildVer）；DATA_VERSION('3.9') 是数据迁移的内部锚点、**不是产品版本号**，
         只作极端兜底。 */
      meta.build = window.__buildVer || (typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : '?');
      meta.records = window.appData && appData.records ? appData.records.length : null;
      meta.journey = window.appData && appData.journey ? !!appData.journey.enabled : null;
    } catch (e) {}
    let payload = {
      exportedAt: new Date().toISOString(),
      app: 'bottle-pomodoro',
      meta: meta,
      count: list.length,
      entries: list
    };
    try {
      let blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      let url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = '错误现场_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
        try {
          a.remove();
        } catch (e) {}
      }, 900);
      try {
        if (window.showToast) showToast('✅ 错误现场已导出');
      } catch (e) {}
    } catch (e) {
      try {
        if (window.showToast) showToast('导出失败');
      } catch (e2) {}
    }
  }
  window.addEventListener('error', function (e) {
    try {
      if (e && e.error) {
        push(e.error, 'window');
      } else if (e && e.message) {
        push({ message: e.message, stack: (e.filename || '') + ':' + (e.lineno || 0) }, 'window');
      }
    } catch (e2) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try {
      let r = e && e.reason;
      push(r && r.message != null ? r : { message: String(r) }, 'promise');
    } catch (e2) {}
  });
  /* ===== 空 catch 关键路径接日志 =====
   * __errRep.silent(e, tag)：把"用户可见功能入口"的空 catch 从完全静默升级为
   * 本地可诊断记录：warn 级（不入角标、不上报），进环形缓冲、可导出、可 console 查。
   * 按 tag 节流 500ms：1s 轮询类 catch 异常时只留少量样本，不刷屏顶掉有效记录。
   * window.__silent 为窗口别名（06 整段回退后为 undefined，调用点 if 守卫自动失效）。
    */
  let _silentLast = {};
  function _silent(e, tag) {
    let now = Date.now();
    let key = String(tag || 'misc');
    if (_silentLast[key] && now - _silentLast[key] < 500) return;
    _silentLast[key] = now;
    push(e, key, 'warn');
  }
  window.__silent = _silent;
  window.__errRep = {
    push: push,
    warn: warn,
    silent: _silent,
    list: function () {
      return list.slice();
    },
    clear: function () {
      list = [];
      renderBadge();
      if (panel) renderPanel();
    },
    exportJSON: exportErrors,
    _dbg: {
      open: openPanel,
      count: function () {
        return list.length;
      }
    }
  };

  /* __dataMig 已在文件头部预置区定义（须早于 loadData 生效，见 __ivGov 段），此处不再重复 */
})();
