package im.bottle.focus

/**
 * 唯一的 JS 源（设计 §8.4）。
 *
 * 注入时机：`WebViewCompat.addDocumentStartJavaScript` —— 新文档解析前、任何页面脚本执行前。
 * 不能用 `onPageFinished`：那时 `app.js` 早就把 `Notification` 判成"不存在"并把 UI 画成"不支持"了。
 *
 * 三条铁律：
 * 1. 只接管本 App origin 上的能力，绝不改网页自己的分支逻辑（契约保持一致，探测反而更准）；
 * 2. 不伪造 Service Worker（资产已在 APK，没有可缓存的东西，伪造只会和网页 register 打架）；
 * 3. 桥是只读的 —— 这里没有任何一条消息能改 `timerState` / `localStorage`；
 *    唯一的"写"是 [⑥] 把网页自己生成的备份文本交给原生 SAF 落盘（用户选的文件，不是网页状态）。
 *
 * ⚠️ P0 复盘（2026-11）：旧版第一行是"桥存在就报错并 return"的撞名断言。桥是原生用
 * addWebMessageListener 装的，**一定先于本脚本落地**，所以那个条件恒为真 → shim 剩下的
 * 200 行从来没执行过（真机上只能看到一条 name collision 日志）。
 * 后果：`timer.report` 一条不发（TimerWatch 从不 arm → 到点不响）、
 * `__bottleBack` 未定义（返回键恒 'exit'）、`wakeLock` 没补（专注中息屏）、`new Notification()` 全哑。
 * 现在幂等断言只判"shim 自己装过没有"（`__bottleShimV1`），桥缺失走**降级**而不是整体 return。
 */
object Shim {

    /** 桥对象名的占位符：注入前替换成 State.BRIDGE_NAME，名字只写一处。 */
    private const val PLACEHOLDER = "__BOTTLE_BRIDGE__"

    /** 真正注入的脚本（首次访问时替换一次，约 9KB，代价可忽略）。 */
    val JS: String by lazy { TEMPLATE.replace(PLACEHOLDER, State.BRIDGE_NAME) }

    /**
     * 注意：本字符串是 Kotlin raw string，JS 里**不能出现 `$`**（会被当模板插值）。
     * 现有 JS 刻意不使用模板字符串，正是因为这一点；tools/extract_shim.py 会做插值审计。
     */
    private val TEMPLATE: String = """
(function () {
  'use strict';

  // ==================================================================
  // ⓪ 幂等断言：只判「本 shim 自己装过没有」，**绝不判桥**（P0 根因）
  //
  // 旧写法是"桥存在就报错并 return"，恒为真，
  // 因为桥一定先装 —— 这类"判别人装没装"的断言天生无法区分"撞名"与"正常共存"。
  // 幂等标记只能由我们自己维护：装一次，走一次，重复注入直接静默退出。
  // ==================================================================
  if (window.__bottleShimV1 === true) { return; }

  // ---- 桥探测：拿不到就进降级模式，绝不 return ----
  var H = null;
  try { H = window['__BOTTLE_BRIDGE__'] || null; } catch (e) { H = null; }
  var hasBridge = !!(H && typeof H.postMessage === 'function');
  if (!hasBridge) {
    // 降级是"可观测的缺失"，不是"静默死亡"：一条 warning 足够定位，不用 error 吓人。
    console.warn('[bottle] bridge missing, running in degraded mode (local no-op)');
  }

  var pending = {}, seq = 0, warned = {};

  // 统一发送：id 用于把原生的异步应答对回回调
  function call(cmd, payload, cb) {
    if (!hasBridge) {
      // 无桥：记一条 warning 并**本地 no-op**。绝不 throw ——
      // 调用点都在异步/事件路径上，抛出去没人接，只会把网页自己的逻辑一起带崩。
      if (!warned[cmd]) { warned[cmd] = true; console.warn('[bottle] no bridge, skip ' + cmd); }
      return;
    }
    var id = 'c' + (++seq);
    if (cb) { pending[id] = cb; }
    try {
      H.postMessage(JSON.stringify({ v: 1, id: id, cmd: cmd, payload: payload || {} }));
    } catch (e) {
      delete pending[id];
      console.warn('[bottle] postMessage failed: ' + cmd + ' ' + e);
      if (cb) { cb({ ok: false, error: { code: 'E_INTERNAL' } }); }
    }
  }

  if (hasBridge) {
    // 原生 → JS 的应答通道
    H.addEventListener('message', function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (!m || !m.id) { return; }
      var cb = pending[m.id];
      if (!cb) { return; }
      delete pending[m.id];
      try { cb(m); } catch (err) { console.warn('[bottle] callback error: ' + err); }
    });
    // hello 先打一次，把 App 版本/网页版本留给诊断用
    call('hello', {}, function (r) { window.__bottleHello = (r && r.payload) || {}; });
  } else {
    // 无桥时也留一个空对象：诊断代码读它不会 undefined 炸
    window.__bottleHello = window.__bottleHello || {};
  }

  // ==================================================================
  // ④ 返回键阶梯 → 'handled' | 'exit'
  //
  // ★ 先装：这是"能不能用"的最后一道底线 —— 哪怕下面 Notification/wakeLock
  //   的接管全部失败，返回键也必须能退。所以它排在所有可失败步骤之前。
  //
  // 与网页自己的 Escape handler 同序（engine_init.js:105-119），但不合成键盘事件
  // （合成事件会被 a11y 层二次处理）。绝不用 history.back()：切 tab 不产生历史记录，
  // back 会把用户直接退出 App（设计 §0.3）。
  // ==================================================================
  window.__bottleBack = function () {
    try {
      // ① 沉浸过渡层
      var tr = document.getElementById('immersiveTransition');
      if (tr && tr.classList.contains('show')) {
        if (typeof window.hideImmersiveTransition === 'function') { window.hideImmersiveTransition(); }
        else { tr.classList.remove('show'); }
        return 'handled';
      }
      // ② 打断弹窗：网页里该弹窗唯一的"关"就是"继续计时"
      var im = document.getElementById('interruptModal');
      if (im && im.classList.contains('show')) {
        if (typeof window.resumeFromInterrupt === 'function') { window.resumeFromInterrupt(); }
        else { im.classList.remove('show'); }
        return 'handled';
      }
      // ③ 任意模态层：逐个移除 show（与网页 Escape 同款）
      var overlays = document.querySelectorAll('.modal-overlay.show');
      if (overlays && overlays.length) {
        for (var i = 0; i < overlays.length; i++) { overlays[i].classList.remove('show'); }
        return 'handled';
      }
      // ④ 不在计时页 → 用网页自己的切视图（不是 history.back）
      var act = document.querySelector('.view.active');
      if (act && act.id !== 'view-timer' && typeof window.switchView === 'function') {
        window.switchView('timer');
        return 'handled';
      }
    } catch (e) {
      console.warn('[bottle] back error: ' + e);
    }
    // ⑤ 交给原生做"2 秒内再按一次才退"（无桥时同样返回 exit：退出这件事从不依赖桥）
    return 'exit';
  };

  // ==================================================================
  // ① Notification：对 App 自己的 origin **无条件接管**（P1-3）
  //
  // 为什么不再用 `if (!('Notification' in window))`：
  // 某些 WebView 自带 Notification 但根本发不出来（没有通知权限宿主、也没有 SW 环境），
  // 那条 `in` 判断会让 shim 主动弃权，网页的 `new Notification()` 落到 Chromium 的
  // 静默空操作 —— 用户什么都看不到，日志里也只有一条"我跳过了"。
  //
  // 设计 §3.3 已澄清：覆盖 window.Notification 只在"错误姿势"下才破坏 feature detection。
  // 正确姿势（就是这里）反而让探测更准：
  //   · `'Notification' in window` 恒 true —— 原生确实能发；
  //   · `Notification.permission` 返回系统真实授权状态；
  //   · `requestPermission()` 的 Promise 在系统框关闭后才 resolve。
  // 本脚本的 allowedOriginRules 已经是 setOf(State.ORIGIN)，所以不需要再做一次 origin 判断
  // （多一处判断就多一处可能判错的地方）。
  //
  // 网页侧真实用法（已核对 assets/engine.js / app.js）：
  //   `'Notification' in window`、`Notification.permission`、`.requestPermission().then()`、
  //   `new Notification(title, {body, tag})`，以及 `n.close()`。全部覆盖，无一依赖"不存在"。
  // ==================================================================
  try {
    var perm = 'default';
    var bottleSetPerm = function (s) {
      if (s === 'granted' || s === 'denied' || s === 'default') { perm = s; }
    };
    // 原生 onRequestPermissionsResult 通过它把结果推回来（不占额外全局名以外的名字，只此一个）
    window.__bottleSetPerm = bottleSetPerm;

    var BottleNotification = function (title, opts) {
      // 允许 `Notification(...)` 不带 new 调用（网页不会这么写，但别让它炸）
      if (!(this instanceof BottleNotification)) { return new BottleNotification(title, opts); }
      opts = opts || {};
      var tag = opts.tag ? String(opts.tag) : '';
      this.title = String(title === undefined || title === null ? '' : title);
      this.body = opts.body ? String(opts.body) : '';
      this.tag = tag;
      // 事件槽位先置空：网页可能读/写它们，访问不能抛
      this.onclick = null;
      this.onclose = null;
      this.onerror = null;
      this.onshow = null;
      // 网页会调 n.close()（notifyCancel 走 SW 不通，原生按 tag 兜）
      this.close = function () { call('notify.cancel', { tag: tag }); };
      call('notify.show', {
        title: this.title,
        body: this.body,
        tag: tag,
        sticky: !!opts.requireInteraction
      });
    };

    Object.defineProperty(BottleNotification, 'permission', {
      configurable: true,
      get: function () { return perm; }
    });

    // 关键护栏：无手势不弹系统框，交回网页显示"开启通知"引导（设计 §3.3）
    BottleNotification.requestPermission = function (cb) {
      var p = new Promise(function (resolve) {
        if (perm === 'granted' || perm === 'denied') { resolve(perm); return; }
        // 无桥：本地立刻 resolve。绝不能让 Promise 悬空 —— 网页会拿 .then 去刷 UI。
        if (!hasBridge) { resolve(perm); return; }
        if (Date.now() - (window.__lastTouch || 0) > 2000) { resolve(perm); return; }
        call('notify.request', {}, function (r) {
          var s = (r && r.ok && r.payload && r.payload.state) || perm;
          bottleSetPerm(s);
          resolve(s);
        });
      });
      if (typeof cb === 'function') { p.then(cb); }
      return p;
    };
    BottleNotification.maxActions = 0;

    try {
      // writable/configurable 都放开：网页或未来版本想再包一层不会被锁死
      Object.defineProperty(window, 'Notification', {
        configurable: true, writable: true, value: BottleNotification
      });
    } catch (e) {
      try { window.Notification = BottleNotification; }
      catch (e2) { console.warn('[bottle] Notification takeover failed: ' + e2); }
    }

    // 冷启动读一次真实授权状态（未授权时返回 default，网页自己会渲染引导行）
    call('notify.permission', {}, function (r) {
      if (r && r.ok && r.payload) { bottleSetPerm(r.payload.state); }
    });
  } catch (eNotif) {
    console.warn('[bottle] Notification shim failed: ' + eNotif);
  }

  // ==================================================================
  // ② Screen Wake Lock
  // 网页拿到后只关心 released / release() / addEventListener，形状满足即可。
  // 真正的"状态漂移"由原生 onResume 无条件重放 keepScreenOn 兜（设计 §3.1）。
  //
  // 注意这里和 Notification 是同一个毛病：**判"存在"不等于判"可用"**。
  // engine.js 的 requestWakeLock() 是 `if (!('wakeLock' in navigator)) return;` + try/catch，
  // 一旦 request() 被 reject（无手势 / 策略拒绝 / OEM 阉割），它就安静地把 _wakeLock 置 null ——
  // 专注中照样息屏，而且一条日志都没有。所以：能 request 就 request，不能就返回假的 resolved 句柄。
  // ==================================================================
  try {
    var nativeWl = null;
    try { nativeWl = navigator.wakeLock || null; } catch (e0) { nativeWl = null; }

    var makeSentinel = function () {
      return {
        released: false,
        type: 'screen',
        onrelease: null,
        addEventListener: function () {},
        removeEventListener: function () {},
        release: function () {
          if (this.released) { return Promise.resolve(); }
          this.released = true;
          call('screen.wake', { on: false });
          return Promise.resolve();
        }
      };
    };

    // 无原生可用时的替身：先告诉原生"我要常亮"，再给网页一个形状完整的句柄。
    // 永远 resolve —— 专注中息屏是可接受的退化，网页因为 request 被 reject 而整段逻辑中断
    // 才是不可接受的。无桥时 call 是 no-op，这里同样返回 resolved（假成功），不抛。
    var fakeRequest = function () {
      call('screen.wake', { on: true });
      return Promise.resolve(makeSentinel());
    };

    var wakeShim = {
      request: function (type) {
        if (nativeWl && typeof nativeWl.request === 'function') {
          try {
            // 原生成功 → 原样把原生句柄交回去：那条路径的 release / addEventListener 是真的，
            // 我们一个字节都不改（也刻意不在成功路径上发 screen.wake，避免 release 时
            // 原生收不到我们的回调、keepScreenOn 卡在 true）。
            return Promise.resolve(nativeWl.request(type)).then(
              function (s) { return s; },
              function (err) {
                console.warn('[bottle] native wakeLock rejected, fallback to bridge: ' + err);
                return fakeRequest();
              }
            );
          } catch (e1) {
            console.warn('[bottle] native wakeLock threw, fallback to bridge: ' + e1);
            return fakeRequest();
          }
        }
        return fakeRequest();
      }
    };

    try {
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: wakeShim });
    } catch (e2) {
      try { navigator.wakeLock = wakeShim; }
      catch (e3) { console.warn('[bottle] wakeLock shim failed: ' + e3); }
    }
  } catch (eWake) {
    console.warn('[bottle] wakeLock shim crashed: ' + eWake);
  }

  // ==================================================================
  // ③ timerState 边沿上报
  // 只在"签名"变化时发，不是 1Hz 灌流量。签名刻意不含 remaining：
  // 它每秒都在变，含进去就退化成每秒一条；原生排闹钟只需要 endAt。
  //
  // ★ 冷启动第一帧 appData.settings 还没落库（loadData 是异步的），
  //   此时 `!!s.notify` 会得到 false。旧写法照发，原生 `onReport` 第一规则
  //   立刻 `disarm("web-notify-off")` —— 把 BootReceiver 刚恢复的闹钟和常驻通知
  //   一起撤掉。所以这里改成"设置没准备好就不上报"，等下一帧。
  // ==================================================================
  var lastSig = '';
  function report() {
    var t = window.timerState;
    if (!t) { return; }
    var s = null;
    try { s = (window.appData && window.appData.settings) || null; } catch (e) { s = null; }
    // 设置对象还没就绪（字段缺失 / 不是布尔）→ 这一帧跳过，绝不猜成 false。
    if (!s || typeof s.notify !== 'boolean') { return; }
    var paused = (typeof t.paused === 'boolean') ? t.paused : !t.running;
    var sig = [t.mode, t.freeType, !!t.running, paused, +t.endAt || 0, +t.startTime || 0,
               !!s.bgPause, s.notify === true].join('|');
    if (sig === lastSig) { return; }
    lastSig = sig;
    call('timer.report', {
      mode: t.mode || '',
      freeType: t.freeType || '',
      running: !!t.running,
      paused: paused,
      endAt: +t.endAt || 0,
      startTime: +t.startTime || 0,
      remaining: +t.remaining || 0,
      totalDuration: +t.totalDuration || 0,
      bgPause: !!s.bgPause,
      notify: s.notify === true
    });
  }

  setInterval(report, 1000);
  document.addEventListener('visibilitychange', function () {
    // 回前台立刻重算一次（后台时定时器被压到 1 次/分钟，不能等）
    lastSig = '';
    report();
  });
  window.addEventListener('pageshow', function () { lastSig = ''; report(); });
  setTimeout(report, 0);

  // ==================================================================
  // ⑥ 导出：blob: 下载 → 原生 SAF（ACTION_CREATE_DOCUMENT）
  //
  // WebView 不支持 `<a download>` + blob:（DownloadListener 也收不到 blob:），
  // 于是网页 engine_data.js 的 downloadExport() 什么都没发生，而紧接着的
  // exportDone() 会无条件弹「已导出 · 建议保存为 …」—— 真机上就是"假成功"。
  //
  // 这里只补能力，不改网页的任何分支：
  //   · 只拦「有 download 属性 且 href 是 blob:」的 anchor.click()，其余原样透传；
  //   · 文本经桥交给原生，由原生让用户选位置后落盘（不新增权限，SAF 免权限）。
  // ==================================================================
  var CHUNK_CHARS = 262144;   // 每块 256K 字符：单条 WebMessage 体积可控，且天然背压

  var blobStash = {}, blobOrder = [];

  // ★ BOM 必须在宿主侧保住：CSV 导出以 U+FEFF 开头，Excel/WPS 靠它认 UTF-8，
  //   而 Blob.text() 规范上会剥掉开头 BOM（源 23 字符 → 输出 22 字符，中文乱码）。
  //   所以一律按字节读 + TextDecoder，且必须显式 ignoreBOM:true（默认 false 也是剥）。
  function bottleDecodeUtf8(blob) {
    if (!blob) { return null; }
    if (typeof FileReader === 'function') {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          try {
            resolve(new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(fr.result)));
          } catch (eDec) { reject(eDec); }
        };
        fr.onerror = function () { reject(fr.error || 'read failed'); };
        fr.readAsArrayBuffer(blob);
      });
    }
    // 老 WebView 连 FileReader 都没有：只能退回 text()（会丢 BOM，但至少能导出）
    if (typeof blob.text === 'function') { return blob.text(); }
    return null;
  }

  // mime 只取分号前的主类型并小写：Intent 的 type 不接受 charset 参数，
  // 带参数时部分 ROM 会匹配不到「另存为」的过滤器，甚至按 mime 改扩展名。
  function bottleBlobMime(blob, fallback) {
    var t = '';
    try { t = (blob && typeof blob.type === 'string') ? blob.type : ''; } catch (eType) { t = ''; }
    if (!t) { t = fallback || ''; }
    return String(t).split(';')[0].trim().toLowerCase();
  }

  // 读 blob：文本与 mime 一起带出。优先用 createObjectURL 时记下的 Blob 本体：
  // 网页 100ms 后就 revokeObjectURL 了，只拿 URL 去 fetch 存在落空的风险。
  function bottleReadBlob(url) {
    var b = blobStash[url];
    var read = bottleDecodeUtf8(b);
    if (read && typeof read.then === 'function') {
      return read.then(function (text) { return { text: text, mime: bottleBlobMime(b, '') }; });
    }
    if (typeof window.fetch === 'function') {
      return window.fetch(url).then(function (r) {
        var ct = '';
        try { ct = (r.headers && r.headers.get) ? r.headers.get('content-type') : ''; } catch (eCt) { ct = ''; }
        return r.arrayBuffer().then(function (buf) {
          return {
            text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf),
            mime: bottleBlobMime(b, ct)
          };
        });
      });
    }
    return null;
  }

  // 三段式上传：begin（选位置）→ chunk * N → end（收尾）。
  // 分块不是炫技：单条消息塞几 MB JSON 有体积上限风险，且块 ack 天然形成背压。
  function bottleSendFile(name, text, mime) {
    var total = text.length;
    var sent = 0;
    // mime 跟着 blob 走（CSV 是 text/csv）；拿不到才按备份 JSON 兜底
    var outMime = mime || 'application/json';

    function finish(sid) {
      call('file.export.end', { sessionId: sid }, function (r) {
        if (!r || !r.ok) {
          console.warn('[bottle] export end failed: ' + JSON.stringify(r && r.error));
          return;
        }
        console.log('[bottle] export saved: ' + name + ' (' + total + ' chars)');
      });
    }

    function step(sid) {
      if (sent >= total) { finish(sid); return; }
      var end = sent + CHUNK_CHARS;
      if (end > total) { end = total; }
      // 别把代理对劈成两半：劈开会变成两个非法码元，落盘的 JSON 就废了
      if (end < total) {
        var c = text.charCodeAt(end - 1);
        if (c >= 0xD800 && c <= 0xDBFF) { end--; }
      }
      var part = text.slice(sent, end);
      sent = end;
      call('file.export.chunk', { sessionId: sid, data: part }, function (r) {
        if (!r || !r.ok) {
          console.warn('[bottle] export chunk failed at ' + sent + ', aborting');
          call('file.export.abort', { sessionId: sid });
          return;
        }
        step(sid);
      });
    }

    call('file.export.begin', { name: name, mime: outMime, total: total }, function (r) {
      if (!r || !r.ok) {
        console.warn('[bottle] export begin rejected: ' + JSON.stringify(r && r.error));
        return;
      }
      var sid = r.payload && r.payload.sessionId;
      // 用户在选择器里点了取消：原生已经提示过「已取消保存」，这里只留日志
      if (!sid) { console.warn('[bottle] export cancelled by user'); return; }
      step(sid);
    });
  }

  function bottleSaveBlob(url, name) {
    var read = null;
    try { read = bottleReadBlob(url); } catch (e) {
      console.warn('[bottle] read blob failed: ' + e);
      return;
    }
    if (!read || typeof read.then !== 'function') {
      console.warn('[bottle] cannot read blob: ' + url);
      return;
    }
    read.then(function (r) {
      delete blobStash[url];
      var text = (r && r.text !== undefined && r.text !== null) ? String(r.text) : '';
      bottleSendFile(name, text, r && r.mime);
    })['catch'](function (err) {
      console.warn('[bottle] read blob rejected: ' + err);
    });
  }

  try {
    // ① 先记 Blob 本体（revoke 之后 URL 失效，本体还在）
    try {
      var origCreate = URL.createObjectURL;
      if (typeof origCreate === 'function') {
        URL.createObjectURL = function (blob) {
          var u = origCreate.call(URL, blob);
          try {
            if (blob && typeof blob.size === 'number') {
              blobStash[u] = blob;
              blobOrder.push(u);
              while (blobOrder.length > 4) {
                var old = blobOrder.shift();
                if (old && old !== u) { delete blobStash[old]; }
              }
            }
          } catch (eStash) { console.warn('[bottle] blob stash failed: ' + eStash); }
          return u;
        };
      }
    } catch (eCreate) { console.warn('[bottle] createObjectURL hook failed: ' + eCreate); }

    // ② 只包 anchor.click()（click 本在 HTMLElement.prototype 上，这里在子类上做条件覆盖）
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        if (this && this.download && /^blob:/.test(String(this.href))) {
          if (hasBridge) {
            bottleSaveBlob(String(this.href), String(this.download));
            return;   // 拦掉 WebView 那个静默失败的下载
          }
          console.warn('[bottle] no bridge, blob: download cannot be saved: ' + this.download);
        }
      } catch (e) { console.warn('[bottle] download intercept failed: ' + e); }
      return origClick.apply(this, arguments);
    };
  } catch (eDl) {
    console.warn('[bottle] blob download shim failed: ' + eDl);
  }

  // ==================================================================
  // ⑤ 自证已安装（唯一的验证锚点）
  //
  // 放在最后一行：上面每一步都跑到了才会落地，中途真炸了就不会留下"假装装好了"的假象
  // （顶部的幂等判断读的也是它，所以失败后的下一次注入仍会重试）。
  // WebAppHost.onPageFinished 的断言、tools/inject_test.py 的 5 条断言都锚在这一行。
  // ==================================================================
  window.__bottleShimV1 = true;
})();
"""
}
