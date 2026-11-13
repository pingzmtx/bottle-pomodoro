/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 事件委托运行时（L1）：承接模板里 data-act / data-change / data-input / data-keydown
 * 等声明式事件，替代内联 on*="..."。上线顺序必须在任何页面片段渲染之前。
 * 红线：这里是**唯一**的事件委托入口。禁止在别处再造第二份 document 级监听去抢事件；
 *      新增事件类型只改 EVENTS 表。 */
/* ============================================================
 * 【M0 事件委托】内联事件 → 声明式属性（模块化前置）
 * 背景：332+ 处 onclick="fn(...)" 在**全局作用域**求值，是上 ES 模块的唯一硬阻塞
 *      —— 模块作用域不是全局，内联处理器一律失效。
 * 用法（每个事件一套属性，事件名后缀可省）：
 *      data-act="switchView" data-args='["plan"]'
 *      data-change="saveX"  data-change-args='["@value"]'
 *      data-keydown="confirm" data-keys="Enter"        ← 命中时 preventDefault
 *      data-focus / data-input / data-keydown 同理
 * 通用修饰：data-stop="1"（阻止向上冒泡，等价 event.stopPropagation()）
 *          data-self="1"（仅 event.target === 本元素时执行）
 *          data-keys="Enter Space"（只对这些键触发）
 * 参数占位：@this=本元素 / @event=事件 / @value=本元素 value / @checked /
 *          @value/100=value÷100 / @global:name=window[name]（读**点击时**的值）
 * 语义对齐：沿冒泡路径**逐级**派发（与内联处理器一致，祖先上的处理器也照常触发），
 *          任一环 data-stop 即停止上溯。
 * 函数索引（TOC）：readArgs/run/resolve/delegate/splitTop/literal/takeOver/scan
 * ============================================================ */
(function () {
  'use strict';

  var EVENTS = ['click', 'change', 'input', 'keydown', 'focus', 'blur'];

  function readArgs(el, ev, suffix) {
    var raw = el.getAttribute('data-' + suffix + '-args');
    if (raw === null && suffix === 'act') raw = el.getAttribute('data-args');
    if (!raw) return [];
    var list;
    try {
      list = JSON.parse(raw);
    } catch (e) {
      if (window.__errRep && window.__errRep.push) window.__errRep.push(e);
      else console.error('[act] 参数不是合法 JSON：', raw, e);
      return [];
    }
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (typeof v !== 'string') { out.push(v); continue; }
      if (v === '@this') out.push(el);
      else if (v === '@event') out.push(ev);
      else if (v === '@value') out.push(el.value);
      else if (v === '@checked') out.push(el.checked);
      else if (v.indexOf('@value/') === 0) out.push(Number(el.value) / Number(v.slice(7)));
      else if (v.indexOf('@global:') === 0) out.push(window[v.slice(8)]);
      else out.push(v);
    }
    return out;
  }

  function run(el, ev, suffix, name) {
    if (el.getAttribute('data-self') === '1' && ev.target !== el) return false;
    var keys = el.getAttribute('data-keys');
    if (keys && ev.key !== undefined) {
      var want = keys.split(/[\s,]+/);
      var hit = false;
      for (var k = 0; k < want.length; k++) {
        if (!want[k]) continue;
        if (want[k] === 'Space' ? ev.key === ' ' : ev.key === want[k]) hit = true;
      }
      if (!hit) return false;                // 键不匹配：不执行、也不阻止上溯
      if (ev.preventDefault) ev.preventDefault();
    }
    var stop = el.getAttribute('data-stop') === '1';
    if (stop && ev.stopPropagation) ev.stopPropagation();
    var fn = resolve(name);
    if (typeof fn !== 'function') {
      console.error('[act] 未找到处理函数：' + name + '（元素 #' + (el.id || el.className) + '）');
      return stop;
    }
    try {
      fn.apply(el, readArgs(el, ev, suffix));
    } catch (e) {
      if (window.__errRep && window.__errRep.push) window.__errRep.push(e);
      else console.error(e);
    }
    // 同一元素上「先做 A 再做 B」的组合动作（原内联写法用分号串联）
    var after = el.getAttribute('data-after');
    if (after) {
      var delay = Number(el.getAttribute('data-after-delay') || 0);
      var callAfter = function () {
        var af = window[after];
        if (typeof af !== 'function') { console.error('[act] data-after 未找到：' + after); return; }
        try { af.apply(el, readArgs(el, ev, 'after')); } catch (e2) {
          if (window.__errRep && window.__errRep.push) window.__errRep.push(e2);
          else console.error(e2);
        }
      };
      if (delay > 0) setTimeout(callAfter, delay); else callAfter();
    }
    return stop;
  }

  function resolve(name) {
    var parts = String(name).split('.'), obj = window;
    for (var i = 0; i < parts.length; i++) {
      if (obj == null) return null;
      obj = obj[parts[i]];
    }
    return typeof obj === 'function' ? obj : null;
  }

  function delegate(ev) {
    var type = ev.type;
    var suffix = type === 'click' ? 'act' : type;
    var el = ev.target;
    if (!el || el.nodeType !== 1) el = el && el.parentElement;
    while (el && el.nodeType === 1) {
      var name = el.getAttribute('data-' + suffix);
      if (name && run(el, ev, suffix, name)) break;   // data-stop 已切断上溯
      el = el.parentElement;
    }
  }

  // 常用「元素自身动作」：内联写法 this.select() / this.blur() 的声明式替代
  window.__selfSelect = function () { if (this.select) this.select(); };
  window.__selfBlur = function () { if (this.blur) this.blur(); };
  window.__noop = function () {};
  window.__clickId = function (id) {
    var t = document.getElementById(id);
    if (t && t.click) t.click();
  };
  window.__openUrl = function (url, target) {
    window.open(url, target || '_blank');
  };

  /* ---- 兼容层：脚本用字符串拼出来的 HTML 仍带 on*="..." ------------------
   * 为什么不在源码里逐条改：这些属性值常是 `onclick="fn('a',${id})"` 这种拼接，
   * 静态改写要动几百处字符串边界，风险远大于收益。这里在**插入 DOM 后、用户点击前**
   * 把属性解析成 data-*，效果等价：内联处理器从此不再依赖全局作用域求值。
   * 解析不了的（实参是复杂表达式）原样保留并记一条日志，便于逐步收敛。 */
  var INLINE = ['onclick', 'onchange', 'oninput', 'onkeydown', 'onfocus', 'onblur'];
  var CALLRE = /^\s*([A-Za-z_$][\w$.]*)\s*\(([\s\S]*)\)\s*;?\s*$/;
  var warned = 0;

  function splitTop(inner) {
    var out = [], cur = '', q = null, depth = 0;
    for (var i = 0; i < inner.length; i++) {
      var c = inner[i];
      if (q) {
        cur += c;
        if (c === '\\') { cur += inner[++i] || ''; continue; }
        if (c === q) q = null;
      } else if (c === '"' || c === "'") { q = c; cur += c; }
      else if (c === '(' || c === '[' || c === '{') { depth++; cur += c; }
      else if (c === ')' || c === ']' || c === '}') { depth--; cur += c; }
      else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out.filter(function (x) { return x !== ''; });
  }

  function literal(tok) {
    if (tok === 'this') return '@this';
    if (tok === 'event') return '@event';
    if (tok === 'this.value') return '@value';
    if (tok === 'this.checked') return '@checked';
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
    if (/^'([^'\\]|\\[\s\S])*'$/.test(tok) || /^"([^"\\]|\\[\s\S])*"$/.test(tok)) {
      return tok.slice(1, -1).replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
    }
    if (/^[A-Za-z_$][\w$]*$/.test(tok)) return '@global:' + tok;
    return undefined;                 // 无法静态化：交给调用方放弃
  }

  function takeOver(el) {
    for (var i = 0; i < INLINE.length; i++) {
      var attr = INLINE[i];
      var raw = el.getAttribute(attr);
      if (raw === null) continue;
      if (raw.trim() === '') { el.removeAttribute(attr); continue; }
      var m = CALLRE.exec(raw);
      var suffix = i === 0 ? 'act' : attr.slice(2);
      if (!m) {
        if (warned < 20) { console.warn('[act] 无法接管的内联处理器：' + attr + '="' + raw.slice(0, 80) + '"'); warned++; }
        continue;
      }
      var toks = splitTop(m[2]);
      var vals = [], ok = true;
      for (var k = 0; k < toks.length; k++) {
        var v = literal(toks[k]);
        if (v === undefined) { ok = false; break; }
        vals.push(v);
      }
      if (!ok) {
        if (warned < 20) { console.warn('[act] 实参含表达式，暂不接管：' + attr + '="' + raw.slice(0, 80) + '"'); warned++; }
        continue;
      }
      var name = m[1];
      /* ★ 别接管 `this.xxx()` / `event.xxx()` 这类「宿主对象方法」写法（2026-11-05）。
         CALLRE 会把它当成普通路径（`this.parentNode.remove` 长得就像 a.b.c），
         但 resolve() 是从 window 起走的，`window['this']` 永远是 undefined ——
         结果是：属性被摘掉、换成一条必然找不到的 data-act，点了彻底没反应，
         而且现场只有一行 console.error，用户只会说「这个叉点不动」。
         实况：新增计划里的子任务行 ✕ 就栽在这里。
         现在的口径：**解析不到根就不动它**，原内联处理器留着照常工作。 */
      var root = name.split('.')[0];
      if (root === 'this' || root === 'event') {
        if (warned < 20) { console.warn('[act] 不接管宿主对象方法：' + attr + '="' + raw.slice(0, 80) + '"'); warned++; }
        continue;
      }
      el.setAttribute('data-' + suffix, name);
      if (vals.length) el.setAttribute('data-' + suffix + '-args', JSON.stringify(vals));
      el.removeAttribute(attr);
    }
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    takeOver(node);
    var list = node.querySelectorAll('[onclick],[onchange],[oninput],[onkeydown],[onfocus],[onblur]');
    for (var i = 0; i < list.length; i++) takeOver(list[i]);
  }

  try {
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) scan(added[j]);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    scan(document.documentElement);
  } catch (e) {
    if (window.__errRep && window.__errRep.push) window.__errRep.push(e);
  }

  for (var i = 0; i < EVENTS.length; i++) {
    // focus/blur 不冒泡，必须捕获阶段；其余走冒泡，保持与内联处理器相同的时序。
    var cap = EVENTS[i] === 'focus' || EVENTS[i] === 'blur';
    document.addEventListener(EVENTS[i], delegate, cap);
  }
})();

/* ===== 兼容：DOMContentLoaded 在模块模式下的语义 =====
 * 普通 <script> 在解析期执行，监听器一定赶在 DOMContentLoaded 之前注册；
 * ES 模块是 defer，执行时该事件**已经过去**，后再 addEventListener 永远不触发
 * —— 表现为"某些面板/旅程条根本没注入"，但没有任何报错。
 * 这里把"已过期的订阅"补一次（微任务里同步执行，等价于原时序）。 */
(function () {
  if (typeof Document === 'undefined') return;
  var orig = Document.prototype.addEventListener;
  Document.prototype.addEventListener = function (type, fn, opt) {
    if (type === 'DOMContentLoaded' && document.readyState !== 'loading' && typeof fn === 'function') {
      setTimeout(function () {
        try { fn.call(document, new Event('DOMContentLoaded')); } catch (e) {
          if (window.__errRep && window.__errRep.push) window.__errRep.push(e);
          else console.error(e);
        }
      }, 0);
      return;
    }
    return orig.apply(this, arguments);
  };

  // window 的 load 同理：模块执行时 load 可能已经过去（defer 之后才跑）
  var wadd = window.addEventListener;
  window.addEventListener = function (type, fn, opt) {
    if (type === 'load' && document.readyState === 'complete' && typeof fn === 'function') {
      setTimeout(function () {
        try { fn.call(window, new Event('load')); } catch (e) {
          if (window.__errRep && window.__errRep.push) window.__errRep.push(e);
          else console.error(e);
        }
      }, 0);
      return;
    }
    return wadd.apply(this, arguments);
  };
})();
