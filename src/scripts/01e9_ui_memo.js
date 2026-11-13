/* ============================================================
 * 01e9 · 计划页「备忘」留言板（微传输助手风）
 * 一句话职责：把随手想到的事写成气泡留着，超期后按设置里的策略提醒或自动清理。
 * 规则全部在 00_pure_core.js（normMemoList / memoSplitByRetention / memoRetentionMeta），
 * 本文件只负责 DOM 与落盘，不写死任何天数/文本上限。
 * 数据：appData.memos = [{id,text,ts}]（随 exportData 全量导出，无需额外登记）
 * 设置：appData.settings.memoRetention / memoAutoDelete
 * 函数索引（TOC）：memoListOf/memoRetentionKey/memoAutoDeleteOn/memoSave/memoEnsureShape/ensureMemoPanel/memoPanelHtml/bindMemoInput/memoEscape/memoStamp/renderMemo/renderMemoBubbles（+14 更多）
 * ============================================================ */
(function () {
  'use strict';
  /* 面板注入只做一次；重复调用是安全空操作 */
  var _injected = false;

  /* ---------- 数据访问（集中一处，方便以后迁移字段） ---------- */
  function memoListOf() {
    if (!Array.isArray(appData.memos)) appData.memos = [];
    return appData.memos;
  }
  function memoRetentionKey() {
    var s = appData.settings || {};
    return memoRetentionMeta(s.memoRetention).key;
  }
  function memoAutoDeleteOn() {
    var s = appData.settings || {};
    return !!s.memoAutoDelete;
  }
  /* 归一化 + 落盘（唯一写入口） */
  function memoSave() {
    appData.memos = normMemoList(memoListOf());
    saveData();
  }
  /* 老数据/导入数据的字段兜底：缺什么补什么，幂等 */
  function memoEnsureShape() {
    var s = appData.settings || (appData.settings = {});
    if (memoRetentionMeta(s.memoRetention).key !== s.memoRetention) s.memoRetention = MEMO_RETENTION_DEFAULT;
    if (typeof s.memoAutoDelete !== 'boolean') s.memoAutoDelete = false;
    memoListOf();
  }

  /* ---------- 注入：一个子标签 + 一块面板 ---------- */
  function ensureMemoPanel() {
    if (_injected) return true;
    var logView = document.getElementById('logFocusView');
    if (!logView) return false;
    var anchor = document.getElementById('logOverviewView') || logView;
    var tabbar = logView.parentNode ? logView.parentNode.querySelector('.log-tabs') : null;
    /* 标签栏结构可能被改版：找不到就退回「插到最后一个页面前面」 */
    if (tabbar) {
      var btn = document.createElement('button');
      btn.className = 'log-tab';
      btn.setAttribute('data-memo-tab', '1');
      btn.setAttribute('onclick', "switchLogTab('memo')");
      btn.textContent = '💬 备忘';
      tabbar.appendChild(btn);
    }
    var panel = document.createElement('div');
    panel.id = 'logMemoView';
    panel.style.display = 'none';
    panel.innerHTML = memoPanelHtml();
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    _injected = true;
    bindMemoInput();
    syncMemoSide();
    return true;
  }
  function memoPanelHtml() {
    var opts = MEMO_RETENTION_OPTIONS.map(function (o) {
      return '<option value="' + o.key + '">' + o.label + '</option>';
    }).join('');
    return (
      '<div class="memo-head">' +
      '<div class="memo-head-main"><span class="memo-title">💬 备忘</span>' +
      '<span class="memo-sub" id="memoSubInfo"></span></div>' +
      '<div class="memo-head-ops">' +
      '<button class="btn-small" onclick="toggleMemoSettings()" title="保留期设置">⚙️</button>' +
      '<button class="btn-small" onclick="clearMemos()" title="清空全部备忘">清空</button>' +
      '</div></div>' +
      /* 折叠说明：备忘的交互（点气泡才露出 ✕、回车即发送、⚙️ 管保留期）在界面上一眼看不出，
         需要一行可展开的说明。复用设置页那套通用组件（toggleNote + .setting-note-*），
         不新增样式、不新增函数；两元素必须相邻（toggleNote 靠 nextElementSibling 找内容）。 */
      '<span class="setting-note-toggle" onclick="toggleNote(this)">使用说明</span>' +
      '<div class="setting-note-content">' +
      '👤 <b>我 / 🙋 对面</b> → 切换<b>这条由谁来说</b>：我说的靠右（主色气泡），' +
      '对面的靠左（白气泡）—— 一问一答交替写，就是一场自我对话<br>' +
      '💬 <b>点一下气泡</b> → 露出两个圆形按钮（↩ 引用 / ✕ 删除）；再点一下收起<br>' +
      '↩ → 引用某一条来回复，形成 A→B→A 的来回<br>' +
      '✕ → 只删这一条；<b>清空</b> → 删掉全部（不可撤销）<br>' +
      '⚙️ → 设保留期：到期提醒，或自动清理<br>' +
      '⌨️ 输入框里<b>回车即发送</b>，不必点「发送」' +
      '</div>' +
      '<div class="memo-settings" id="memoSettings" style="display:none">' +
      '<label class="memo-set-row"><span>保留期</span><select id="memoRetentionSel" onchange="setMemoRetention(this.value)">' + opts + '</select></label>' +
      '<label class="memo-set-row"><span>到期后自动删除</span><input type="checkbox" id="memoAutoDel" onchange="setMemoAutoDelete(this.checked)"></label>' +
      '<div class="memo-set-hint" id="memoSetHint"></div>' +
      '</div>' +
      '<div class="memo-expired" id="memoExpiredBar" style="display:none"></div>' +
      '<div class="memo-list" id="memoList"></div>' +
      /* 正在回复的提示条：默认隐藏，点气泡里的「↩ 回复」才出现 */
      '<div class="memo-replybar" id="memoReplyBar">' +
      '<span id="memoReplyTip"></span>' +
      '<button class="btn-small" onclick="cancelReply()">取消</button>' +
      '</div>' +
      '<div class="memo-sendbar">' +
      /* 身份标签**按 _memSide 生成**，不写死「👤 我」。
         写死时靠注入后紧跟的一次 syncMemoSide() 纠正；一旦面板 DOM 被重建而
         _injected 仍为 true，ensureMemoPanel() 直接 return、不会再同步，
         变量与界面就脱钩 —— 用户会看到按钮是「我」，发出去却落到「对面」。
         这里改成单一真相源：模板直接读状态，任何一次重绘都不会漂。 */
      '<button class="memo-side-btn' + (_memSide === 'other' ? ' is-other' : '') +
      '" id="memoSideBtn" onclick="toggleMemoSide()" title="切换这条由谁来说">' +
      (_memSide === 'other' ? '🙋 对面' : '👤 我') + '</button>' +
      '<input id="memoInput" type="text" maxlength="' + MEMO_TEXT_MAX + '" placeholder="' +
      (_memSide === 'other' ? '以「对面」的口吻写一句…（回车发送）' : '我这边的想法…（回车发送）') + '">' +
      '<button class="memo-send-btn" onclick="sendMemo()">发送</button>' +
      '</div>'
    );
  }
  /* 回车发送（输入法组字中不抢键） */
  function bindMemoInput() {
    var inp = document.getElementById('memoInput');
    if (!inp) return;
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        sendMemo();
      }
    });
  }

  /* 发送 / 回复后要保证用户看到自己刚写的那条；其余重绘保持位置（P2-16） */
  var _forceScrollBottom = false;
  function memoEscape(s) {
    /* ★ 必须转单引号（P1-3）：id 会被拼进 onclick="replyMemo('<id>')" 的单引号串里，
       原来只转 & < > " —— 一个含 ' 的 id 就能闭合字符串执行任意 JS。
       现在 id 在 normMemo 已经过白名单（第一道），这里是第二道。 */
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 时间戳 → 「今天 14:32」/「10-03 09:05」 */
  function memoStamp(ts) {
    var d = new Date(Number(ts));
    var hm = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    if (getDateStr(d) === getTodayStr()) return '今天 ' + hm;
    return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + hm;
  }

  /* ---------- 渲染 ---------- */
  function renderMemo() {
    var listEl = document.getElementById('memoList');
    if (!listEl) return;
    memoEnsureShape();
    var key = memoRetentionKey();
    var split = memoSplitByRetention(memoListOf(), Date.now(), key);
    /* 自动删除策略：这里才真删（规则层只做切分） */
    if (memoAutoDeleteOn() && split.expired.length) {
      split.expired.forEach(function (m) { tombstone(m.uid, 'memo'); });
      appData.memos = split.keep;
      saveData();
      showToast('🧹 已自动清理 ' + split.expired.length + ' 条过期备忘');
      renderMemo();
      return;
    }
    var hist = appData.settings.memoClearLog || 0;
    var sub = document.getElementById('memoSubInfo');
    if (sub) {
      sub.textContent = '共 ' + split.keep.length + ' 条 · ' + memoRetentionMeta(key).label;
      if (hist) sub.textContent += ' · 上次清理 ' + memoStamp(hist);
    }
    var sel = document.getElementById('memoRetentionSel');
    if (sel) sel.value = key;
    var cb = document.getElementById('memoAutoDel');
    if (cb) cb.checked = memoAutoDeleteOn();
    var hint = document.getElementById('memoSetHint');
    if (hint) {
      hint.textContent =
        memoRetentionMeta(key).hint +
        '；' +
        (memoAutoDeleteOn() ? '过期静默删除' : '过期只提醒，不自动删') +
        '。备忘会随「导出全部数据」一起导出。';
    }
    /* 过期条：非自动策略下提醒用户手动清 */
    var bar = document.getElementById('memoExpiredBar');
    if (bar) {
      if (split.expired.length) {
        bar.style.display = '';
        bar.innerHTML =
          '⏳ 有 <b>' + split.expired.length + '</b> 条备忘超过保留期（' +
          memoRetentionMeta(key).label +
          '）<button class="btn-small" onclick="memoPurgeExpired()">现在删除</button>';
      } else {
        bar.style.display = 'none';
      }
    }
    renderMemoBubbles(split.keep);
  }
  function renderMemoBubbles(list) {
    var el = document.getElementById('memoList');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="memo-empty">还没有备忘。<br>想到什么就先写下来，回头再收拾它。</div>';
      return;
    }
    var key = memoRetentionKey();
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var left = memoDaysLeft(m, Date.now(), key);
      var warn = left >= 0 && left <= 7 ? ' memo-bubble--soon' : '';
      /* 引用行：被回复的那条在上方留一行摘要。父条若已删/过期，退化为「原消息已不存在」——
         不隐藏、不报错，保留「这里曾经有过一次来回」的痕迹。 */
      var _quote = '';
      if (m.replyTo) {
        var _par = null;
        for (var _i = 0; _i < list.length; _i++) if (String(list[_i].id) === String(m.replyTo)) { _par = list[_i]; break; }
        var _pt = _par ? String(_par.text).replace(/\s+/g, ' ').slice(0, 24) : '原消息已不存在';
        _quote = '<div class="memo-quote">↩ ' + memoEscape(_pt) + '</div>';
      }
      html +=
        '<div class="memo-row' + (m.side === 'other' ? ' is-other' : '') +
        (m.replyTo ? ' is-reply' : '') + '" onclick="toggleMemoBubble(this)">' +
        '<div class="memo-bubble' + warn + '" data-memo-id="' + memoEscape(m.id) + '">' +
        _quote +
        '<div class="memo-text">' + memoEscape(m.text) + '</div>' +
        '<div class="memo-foot"><span>' + memoStamp(m.ts) + '</span>' +
        (left >= 0 && left <= 7 ? '<span class="memo-left">还剩 ' + left + ' 天</span>' : '') +
        '</div>' +
        '<button class="memo-reply" onclick="event.stopPropagation();replyMemo(\'' + memoEscape(m.id) + '\')" title="回复这条">↩</button>' +
        '<button class="memo-del" onclick="event.stopPropagation();deleteMemo(\'' + memoEscape(m.id) + '\')" title="删除这条">✕</button>' +
        '</div></div>';
    }
    /* ★ 只在「本来就在底部」或「刚发/刚回」时才滚到底（P2-16）：
       原来每次重渲染都无条件 scrollTop = scrollHeight，用户往上翻历史看两句、
       随便触发一次刷新（切页回来 / 改设置 / 删除别的条目）就被拽回最底下。
       判据放在重绘**之前**读旧位置，否则读到的已经是新高度。 */
    var _stickBottom = _forceScrollBottom || (el.scrollHeight - el.scrollTop - el.clientHeight < 24);
    _forceScrollBottom = false;
    el.innerHTML = html;
    if (_stickBottom) el.scrollTop = el.scrollHeight;
  }

  /* ---------- 对话方向：这条是「我」说的，还是「对面」说的 ----------
     备忘不只是"写给自己的清单"，也可以是一次**自我对话**：
     把"我"和"另一个我"的来回都记下来，像聊天一样左右分开、颜色不同。
     ★ 默认「我」（靠右），与升级前的观感一致；切到「对面」后新消息靠左。
     ★ 方向只记在消息上（memo.side），是**逐条**的 —— 可以一问一答交替写。 */
  var _memSide = 'me';
  /* 测试钩子：把身份显式归位。面板未必挂载，所以不能靠点按钮；
     只读状态 + 有一次同步尝试，不触发任何渲染副作用。 */
  window.memoSetSide = function (v) {
    _memSide = v === 'other' ? 'other' : 'me';
    try { syncMemoSide(); } catch (e) { if (window.__silent) window.__silent(e, '01e9:memoSetSide'); }
    return _memSide;
  };
  function toggleMemoSide() {
    _memSide = _memSide === 'me' ? 'other' : 'me';
    syncMemoSide();
  }
  function syncMemoSide() {
    var btn = document.getElementById('memoSideBtn');
    if (btn) {
      btn.classList.toggle('is-other', _memSide === 'other');
      btn.textContent = _memSide === 'other' ? '🙋 对面' : '👤 我';
    }
    var inp = document.getElementById('memoInput');
    if (inp) {
      inp.placeholder = _memSide === 'other'
        ? '以「对面」的口吻写一句…（回车发送）'
        : '我这边的想法…（回车发送）';
    }
  }

  /* ---------- 写入 / 删除 ---------- */
  function sendMemo() {
    var inp = document.getElementById('memoInput');
    if (!inp) return;
    var text = String(inp.value || '').trim();
    if (!text) return;
    var id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var rec = { id: id, uid: newUid('memo'), updatedAt: Date.now(), text: text, ts: Date.now() };
    if (_memSide === 'other') rec.side = 'other'; /* 只存非默认值：老数据零迁移 */
    if (_replyTo) rec.replyTo = _replyTo; /* 回复态 → 挂上父指针（normMemo 会兜底校验） */
    _forceScrollBottom = true;   /* 刚发的那条必须可见（P2-16） */
    appData.memos = normMemoList(memoListOf().concat([rec]));
    saveData();
    inp.value = '';
    _replyTo = null;
    syncReplyBar();
    renderMemo();
  }
  function deleteMemo(id) {
    appData.memos = memoListOf().filter(function (m) {
      return String(m.id) !== String(id);
    });
    memoSave();
    renderMemo();
  }
  function clearMemos() {
    if (!memoListOf().length) return;
    /* 0C_确认弹窗 是上层模块：按项目惯例用 typeof 守卫（缺失则回退原生），避免硬向上依赖。 */
    const ask = (typeof window.rsConfirm === 'function')
      ? window.rsConfirm('清空全部备忘？此操作不可撤销。仅清空当前数据；此前已导出的备份文件不受影响。', { okText: '清空' })
      : Promise.resolve(window.confirm('清空全部备忘？此操作不可撤销。仅清空当前数据；此前已导出的备份文件不受影响。'));
    ask.then(function (ok) {
      if (!ok) return;
      appData.memos = [];
      appData.settings.memoClearLog = Date.now();
      saveData();
      showToast('已清空备忘');
      renderMemo();
    });
  }
  function memoPurgeExpired() {
    var key = memoRetentionKey();
    var split = memoSplitByRetention(memoListOf(), Date.now(), key);
    if (!split.expired.length) return;
    appData.memos = split.keep;
    appData.settings.memoClearLog = Date.now();
    saveData();
    showToast('🧹 已删除 ' + split.expired.length + ' 条过期备忘');
    renderMemo();
  }
  /* ---------- 引用回复 ----------
     给一条备忘挂上父指针（replyTo），从 A→B→A 形成来回。
     相比「多话题线程」，它复用现有气泡结构、保留期与清空逻辑，且只加一个可选字段。 */
  var _replyTo = null;
  function replyMemo(id) {
    var m = memoListOf().filter(function (x) { return String(x.id) === String(id); })[0];
    if (!m) return;
    _replyTo = String(id);
    syncReplyBar();
    var inp = document.getElementById('memoInput');
    if (inp) { try { inp.focus(); } catch (e) { if (window.__silent) window.__silent(e, '01e9:replyMemo'); } }
  }
  function cancelReply() {
    _replyTo = null;
    syncReplyBar();
  }
  function syncReplyBar() {
    var bar = document.getElementById('memoReplyBar');
    var tip = document.getElementById('memoReplyTip');
    if (!bar || !tip) return;
    if (!_replyTo) { bar.classList.remove('show'); tip.textContent = ''; return; }
    var m = memoListOf().filter(function (x) { return String(x.id) === String(_replyTo); })[0];
    tip.textContent = '↩ 回复：' + (m ? String(m.text).replace(/\s+/g, ' ').slice(0, 20) : '（原消息已删除）');
    bar.classList.add('show');
  }

  /* 点气泡：展开/收起尾部操作（移动端没有 hover） */
  function toggleMemoBubble(row) {
    if (!row) return;
    row.classList.toggle('open');
  }

  /* ---------- 设置 ---------- */
  function toggleMemoSettings() {
    var el = document.getElementById('memoSettings');
    if (!el) return;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  }
  function setMemoRetention(key) {
    appData.settings.memoRetention = memoRetentionMeta(key).key;
    saveData();
    renderMemo();
  }
  function setMemoAutoDelete(on) {
    appData.settings.memoAutoDelete = !!on;
    saveData();
    renderMemo();
  }

  /* ---------- 对外 ---------- */
  window.renderMemo = renderMemo;
  window.sendMemo = sendMemo;
  window.deleteMemo = deleteMemo;
  window.clearMemos = clearMemos;
  window.replyMemo = replyMemo;
  window.cancelReply = cancelReply;
  window.memoPurgeExpired = memoPurgeExpired;
  window.toggleMemoSettings = toggleMemoSettings;
  window.setMemoRetention = setMemoRetention;
  window.setMemoAutoDelete = setMemoAutoDelete;
  window.toggleMemoBubble = toggleMemoBubble;
  window.memoEnsureShape = memoEnsureShape;
  window.ensureMemoPanel = ensureMemoPanel;
  /* 对话方向：这条由「我」还是「对面」说（输入框左边那颗切换按钮）。
     onclick 走全局，必须显式挂上。 */
  window.toggleMemoSide = toggleMemoSide;
  window.syncMemoSide = syncMemoSide;
  /* 日志页标签切换：备忘视图不在原引擎的已知标签表里，这里补上显隐与高亮。
     只在切到「备忘」时渲染内容，切走时隐藏，避免与原 4 个标签的显隐打架。 */
  var MEMO_SIBLING_VIEWS = ['logFocusView', 'logDiaryView', 'logBioView', 'logOverviewView'];
  function applyMemoTab(tab) {
    var mv = document.getElementById('logMemoView');
    if (!mv) return;
    var on = tab === 'memo';
    mv.style.display = on ? 'block' : 'none';
    if (on) {
      MEMO_SIBLING_VIEWS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      renderMemo();
    }
    var bar = mv.parentNode ? mv.parentNode.querySelector('.log-tabs') : null;
    if (!bar) return;
    var tabs = bar.querySelectorAll('.log-tab');
    for (var i = 0; i < tabs.length; i++) {
      var isMemo = tabs[i].getAttribute('data-memo-tab') === '1';
      if (on) tabs[i].classList.toggle('active', isMemo);
      else if (isMemo) tabs[i].classList.remove('active');
    }
  }
  /* 日志页每次切换都补一次注入（DOM 若被重建也能自愈） */
  (function hookLogTab() {
    var orig = window.switchLogTab;
    if (typeof orig !== 'function') return;
    window.switchLogTab = function (tab) {
      try {
        ensureMemoPanel();
      } catch (e) {
        /* 注入失败不该拦住切换 */
      }
      var r = orig.apply(this, arguments);
      try {
        applyMemoTab(tab);
      } catch (e) {
        /* 显隐失败不致命：下次切换会再试 */
      }
      return r;
    };
  })();
  try {
    memoEnsureShape();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { ensureMemoPanel(); });
    else ensureMemoPanel();
  } catch (e) {
    /* 首屏注入失败不致命：用户切到日志页时会再试一次 */
  }
})();
