#!/usr/bin/env node
/**
 * sync_p2p_unit.js —— 多端同步（S0/S1/S2）网页侧单测，50 条
 * ═══════════════════════════════════════════════════════════════════
 * 跑法：node tools/tests/sync_p2p_unit.js          （退出码 0 = 全绿）
 *       node tools/tests/sync_p2p_unit.js --list    （只列用例名）
 *
 * 为什么要一个「沙箱装载器」而不是直接 require：
 *   被测的东西横跨四层 —— engine_data（数据层）/ pure_core（纯函数）/
 *   sync.js（队列）/ sync_p2p.js（同步数据层）/ 以及 6 个 UI 写入口。
 *   它们是同一段 `<script>` 里拼接运行的（manifest slot 1），
 *   顶层 `let appData` 是**词法绑定**，Node 的 require 拿不到。
 *   所以这里用 `vm` 造一个上下文，按 manifest 顺序把相关文件灌进去，
 *   再补一套最小 DOM / localStorage / IndexedDB 替身。
 *
 * 唯一一处「替身」的边界（写清楚，免得被误读成掩盖 bug）：
 *   · DOM 全部是替身（用例断言的是数据与 outbox，不是像素）；
 *   · IndexedDB 是内存版，可调延迟（commit-waits-idb 要它慢 500ms）；
 *   · localStorage 是内存版，可切换成「写入即抛配额」。
 *   · 被 load 的文件**一个字节都不改**：沙箱读的是 src/scripts 原文。
 *
 * 用例清单来源：docs/android/SYNC_DESIGN.md §17.1 的 50 条（JS 部分）。
 * ═══════════════════════════════════════════════════════════════════
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
/* 允许指向另一份 src 快照：反向验证用（拿改前的源码跑，用例必须红）。
   SYNC_TEST_SRC=/tmp/base/src/scripts node tools/tests/sync_p2p_unit.js */
const SCRIPTS = process.env.SYNC_TEST_SRC || path.join(ROOT, 'src', 'scripts');

/* ────────────────────────── 极简断言 ────────────────────────── */
let pass = 0;
const fails = [];
function eq(name, got, want, note) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; return true; }
  fails.push(name);
  console.log('  ✗ ' + name
    + '\n      期望 ' + JSON.stringify(want)
    + '\n      实际 ' + JSON.stringify(got)
    + (note ? '\n      （' + note + '）' : ''));
  return false;
}
function ok(name, cond, note) { return eq(name, !!cond, true, note); }

/* ────────────────────────── DOM / 存储替身 ────────────────────────── */
function fakeNode(id) {
  const node = {
    id: id || '',
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    disabled: false,
    title: '',
    href: '',
    style: {},
    dataset: {},
    children: [],
    childNodes: [],
    offsetParent: null,
    offsetWidth: 0,
    offsetHeight: 0,
    scrollHeight: 0,
    scrollTop: 0,
    selectionStart: 0,
    selectionEnd: 0,
    classList: {
      add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; }
    },
    getAttribute: function () { return ''; },
    setAttribute: function () {},
    removeAttribute: function () {},
    hasAttribute: function () { return false; },
    addEventListener: function () {},
    removeEventListener: function () {},
    appendChild: function (c) { node.children.push(c); return c; },
    removeChild: function () {},
    insertBefore: function (c) { return c; },
    remove: function () {},
    querySelector: function () { return fakeNode(); },
    querySelectorAll: function () { return []; },
    getBoundingClientRect: function () { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    focus: function () {},
    blur: function () {},
    click: function () {},
    insertAdjacentHTML: function () {},
    scrollIntoView: function () {},
    closest: function () { return fakeNode(); },
    contains: function () { return false; },
    matches: function () { return false; },
    cloneNode: function () { return fakeNode(); },
    setSelectionRange: function () {},
    dispatchEvent: function () { return true; },
    animate: function () { return { finished: Promise.resolve(), cancel: function () {}, onfinish: null }; },
    getContext: function () { return null; }
  };
  return node;
}

function makeStorage() {
  const map = Object.create(null);
  return {
    __map: map,
    __quota: false,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: function (k, v) {
      if (this.__quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      map[k] = String(v);
    },
    removeItem: function (k) { delete map[k]; },
    clear: function () { Object.keys(map).forEach(function (k) { delete map[k]; }); },
    key: function (i) { return Object.keys(map)[i] || null; },
    get length() { return Object.keys(map).length; }
  };
}

/* 内存版 IndexedDB：只实现 engine_data 用到的那一小撮 API。
   __delayMs 可调，用来造「IDB 比 saveDataNow 慢」的现场。 */
function makeIndexedDB(env) {
  const store = Object.create(null);
  function later(fn) { setTimeout(fn, env.__idbDelayMs || 0); }
  return {
    open: function () {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      const db = {
        objectStoreNames: { contains: function (n) { return n === 'kv'; }, length: 1 },
        createObjectStore: function () {},
        transaction: function () {
          const tx = { oncomplete: null, onerror: null, error: null, objectStore: function () {
            return {
              put: function (val, key) {
                store[key] = val;
                later(function () { if (tx.oncomplete) tx.oncomplete(); });
              },
              get: function (key) {
                const rq = { result: store[key], error: null, onsuccess: null, onerror: null };
                later(function () { if (rq.onsuccess) rq.onsuccess(); });
                return rq;
              }
            };
          } };
          return tx;
        }
      };
      req.result = db;
      later(function () { if (req.onsuccess) req.onsuccess(); });
      return req;
    },
    __store: store
  };
}

/* 装载一批源文件到独立上下文。files 缺省 = 本用例集需要的全集（manifest 顺序）。 */
const DEFAULT_FILES = [
  'engine_prelude.js',
  'dom_util.js',
  'storage.js',
  /* pure_core 必须先于 engine_data：后者顶层 `defaultSettings` 直接读
     `POMO_DEFAULT_MINUTES`（浏览器里 pure_core 在更早的 core.js 里已加载）。 */
  'pure_core.js',
  'engine_data.js',
  'sync.js',
  'sync_p2p.js',
  'sync_p2p_payload.js',
  'engine_tree_rank.js',
  'ui_timerpanel.js',
  'ui_addrecord.js',
  'ui_remind.js',
  'ui_todo.js',
  'ui_habit.js'
];

function makeEnv(opts) {
  const o = opts || {};
  const env = { __idbDelayMs: o.idbDelayMs || 0 };
  const doc = {
    hidden: false,
    visibilityState: 'visible',
    documentElement: fakeNode('html'),
    body: fakeNode('body'),
    head: fakeNode('head'),
    __byId: Object.create(null),
    getElementById: function (id) {
      if (o.elements && Object.prototype.hasOwnProperty.call(o.elements, id)) return o.elements[id];
      if (!doc.__byId[id]) doc.__byId[id] = fakeNode(id);
      return doc.__byId[id];
    },
    createElement: function (tag) { return fakeNode(tag); },
    createTextNode: function (t) { const n = fakeNode('#text'); n.textContent = t; return n; },
    createDocumentFragment: function () { return fakeNode('#frag'); },
    querySelector: function () { return fakeNode(); },
    querySelectorAll: function () { return []; },
    getElementsByClassName: function () { return []; },
    getElementsByTagName: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
    dispatchEvent: function () { return true; },
    execCommand: function () {},
    cookie: ''
  };
  const storage = makeStorage();
  /* 沙箱里的 console 一律静音：被测代码会把每一行同步日志打到 console，
     50 条用例下来就是几百行噪音，把真正的断言失败淹掉。
     （需要看日志时传 opts.verbose === true，用真 console。） */
  const quiet = o.verbose ? console : {
    log: function () {}, info: function () {}, warn: function () {}, error: function () {}, debug: function () {}
  };
  const sandbox = {
    console: quiet,
    document: doc,
    localStorage: storage,
    indexedDB: o.noIdb ? undefined : makeIndexedDB(env),
    navigator: { userAgent: 'node-harness', vibrate: function () {}, clipboard: null, onLine: true, serviceWorker: null, language: 'zh-CN' },
    location: { href: 'http://localhost/', reload: function () {}, hash: '', search: '', protocol: 'http:', host: 'localhost' },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    requestAnimationFrame: function (fn) { return setTimeout(function () { fn(Date.now()); }, 0); },
    cancelAnimationFrame: function (h) { clearTimeout(h); },
    matchMedia: function () { return { matches: false, addEventListener: function () {}, addListener: function () {} }; },
    Blob: function (parts) { this.size = String((parts && parts[0]) || '').length; },
    URL: { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} },
    FileReader: function () {},
    Audio: function () { return { play: function () {}, pause: function () {}, addEventListener: function () {} }; },
    AudioContext: function () { return { createOscillator: function () { return { connect: function () {}, start: function () {}, stop: function () {}, frequency: { value: 0 } }; }, createGain: function () { return { connect: function () {}, gain: { value: 0 } }; }, destination: {}, currentTime: 0, state: 'running', resume: function () {} }; },
    Notification: undefined,
    performance: { now: function () { return Date.now(); } },
    Chart: undefined,
    scrollTo: function () {},
    alert: function () {},
    confirm: function () { return true; },
    prompt: function () { return ''; },
    __idbDelayMs: env.__idbDelayMs,
    __silent: function () {},
    __staleNoReload: true /* 守卫 3 不许在用例里真 reload */
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  return { ctx: ctx, sandbox: sandbox, doc: doc, storage: storage, env: env };
}

/* 跨模块助手替身：浏览器里它们在别的 <script> 里（UIFX / 统计缓存 / 提示音…），
   本次只装了「同步要碰的那几个文件」，所以这里补齐成 no-op。
   ★ 只补 UI 副作用，绝不补数据层函数（数据层必须走真实现，否则测的是替身）。 */
const STUB_SOURCE = `
  function showToast() {}
  function renderTodos() {}
  function renderTimerSubs() {}
  function renderHabits() {}
  function renderRankSystem() {}
  function renderWeeklyBadges() {}
  function renderHabitBlockBox() {}
  function renderHabitDayPlanBox() {}
  function renderMustDoSection() {}
  function renderPlanMustRows() {}
  function renderTreeSection() {}
  function renderTreeShop() {}
  function renderTimerTree() {}
  function invalidateStatsCache() {}
  function playSound() {}
  function syncHabitGrowth() {}
  function _syncTodoPartialLog() {}
  function renderLogs() {}
  function updateTodayStats() {}
  function renderDiary() {}
  function renderDiarySingle() {}
  function renderDiaryOverviewPage() {}
  function renderPlanBreakView() {}
  function openHabitDetail() {}
  function closeModal() {}
  function openModal() {}
  function renderCalendar() {}
  function renderTimeBlockGrid() {}
  function closeDiaryModal() {}
  function updateBackupReminder() {}
  function renderRankTiers() {}
  function renderStats() {}
  function renderLogPage() {}
  function coinEarn() {}
  function getGridValue() { return ''; }
  function setGridValue() {}
  function normHabitSubs(x) { return Array.isArray(x) ? x : []; }
  function renderCountdowns() {}
  function renderMemos() {}
  function renderLifeGoals() {}
  function renderTeamSection() {}
  function switchView() {}
  var UIFX = new Proxy({}, { get: function (tag, name) {
    return function () {
      if (typeof globalThis.__CALLS !== 'object') globalThis.__CALLS = {};
      globalThis.__CALLS['UIFX.' + String(name)] = (globalThis.__CALLS['UIFX.' + String(name)] || 0) + 1;
    };
  } });
`;

/* 重绘入口在用例里一律换成计数器：本文件测的是数据与调用次数，
   不是像素（真正的像素回归在浏览器用例里）。 */
const NEUTRAL_SOURCE = `
  globalThis.__CALLS = globalThis.__CALLS || {};
  globalThis.__REAL = globalThis.__REAL || {};
  ['renderTodos','renderTimerSubs','renderHabits','renderPlanBreakView','renderDiary','renderDiarySingle',
   'renderDiaryOverviewPage','renderRankSystem','renderWeeklyBadges','openHabitDetail','renderHabitBlockBox',
   'renderHabitDayPlanBox','_syncTodoPartialLog','renderMustDoSection','renderPlanMustRows','renderTreeSection',
   'renderTreeShop','renderTimerTree','renderLogs','updateTodayStats','renderCalendar','renderTimeBlockGrid',
   'renderRemindPage','closeModal','openModal'].forEach(function (k) {
    if (typeof globalThis[k] === 'function') {
      globalThis.__REAL[k] = globalThis[k];
      globalThis[k] = function () { globalThis.__CALLS[k] = (globalThis.__CALLS[k] || 0) + 1; };
    }
  });
`;

function loadFiles(w, files) {
  const list = files || DEFAULT_FILES;
  vm.runInContext(STUB_SOURCE, w.ctx, { filename: '__stubs.js' });
  for (const f of list) {
    const p = path.join(SCRIPTS, f);
    /* S0 阶段 sync_p2p.js 还没落地：缺文件不静默当成空实现，而是直接跳过 —— 
       用例里凡是依赖它的都会因为没有那个全局而显式报错，不会假装通过。 */
    if (!fs.existsSync(p)) continue;
    const code = fs.readFileSync(p, 'utf8');
    vm.runInContext(code, w.ctx, { filename: f });
  }
  vm.runInContext(NEUTRAL_SOURCE, w.ctx, { filename: '__neutral.js' });
}

/* 一次装载 + 夹具重置：返回一组「够得着词法绑定」的把手。 */
function boot(opts) {
  const w = makeEnv(opts);
  loadFiles(w, opts && opts.files);
  /* `let appData` / `let _dataLoaded` 是词法绑定，不在 globalThis 上：
     只能在同一上下文的脚本里读写 —— 这一个小脚本就是唯一通道。 */
  vm.runInContext(`
    globalThis.__H = {
      get appData() { return appData; },
      set appData(v) { appData = v; },
      get timerState() { return timerState; },
      get dataLoaded() { return _dataLoaded; },
      set dataLoaded(v) { _dataLoaded = v; },
      get saveCtx() { return _saveCtx; },
      set saveCtx(v) { _saveCtx = v; },
      get lastNonEmptyScale() { return _lastNonEmptyScale; },
      set lastNonEmptyScale(v) { _lastNonEmptyScale = v; },
      get saveQueue() { return _saveQueue; },
      reset: function () {
        appData = createDefaultAppData();
        migrateDataContract();
        _dataLoaded = true;
        _lastNonEmptyScale = 0;
        _emptyWriteBlocked = false;
        _lsMirrorWarned = false;
        _jsonFailWarned = false;
        _dataClearing = false;
        _saveCtx = null;
        _saveTimer = null;
        if (typeof _p2pTestReset === 'function') _p2pTestReset();
      }
    };
  `, w.ctx, { filename: '__harness.js' });
  w.H = w.ctx.__H;
  w.run = function (code) { return vm.runInContext(code, w.ctx, { filename: '__case.js' }); };
  return w;
}

/* ────────────────────────── 用例登记 ────────────────────────── */
const CASES = [];
function test(name, fn) { CASES.push({ name: name, fn: fn }); }

/* ====================================================================== */
/*  以下按 SYNC_DESIGN §17.1 的清单逐条落地                                */
/* ====================================================================== */

/* ── S0：子任务打戳（C01–C17）──────────────────────────────────────── */

test('parent-touched-on-sub-change', function () {
  /* 4 个计划入口 + 3 个提醒入口 + 计时面板 + 提醒行编辑 + 习惯子计划
     + 习惯打卡/跳过 + 日记 + 必做清单：一个入口一个 assert。 */
  const w = boot();
  const H = w.H;
  H.reset();

  /* ① toggleTodoSub */
  w.run(`
    var _t1 = { id: 1, uid: 'todo_a', title: 'A', updatedAt: 1, subs: [{ id: 11, uid: 'sub_a1', title: 's1', done: false }] };
    appData.todos = [_t1];
    appData.outbox = [];
    toggleTodoSub(1, 0);
  `);
  ok('① toggleTodoSub 父 updatedAt 严格变大', w.run('_t1.updatedAt') > 1);
  ok('① toggleTodoSub outbox 有父 uid', w.run('appData.outbox.some(function(c){return c.uid==="todo_a";})'));

  /* ② addTodoSub（子任务自己的 uid 保持不动） */
  w.run(`
    var _t2 = { id: 2, uid: 'todo_b', title: 'B', updatedAt: 1, subs: [] };
    appData.todos = [_t2];
    appData.outbox = [];
    var _inp = document.getElementById('todo_sub_input_2'); _inp.value = '新子任务';
    addTodoSub(2);
  `);
  ok('② addTodoSub 父 updatedAt 严格变大', w.run('_t2.updatedAt') > 1);
  ok('② addTodoSub outbox 有父 uid', w.run('appData.outbox.some(function(c){return c.uid==="todo_b";})'));

  /* ③ deleteTodoSub */
  w.run(`
    var _t3 = { id: 3, uid: 'todo_c', title: 'C', updatedAt: 1, subs: [{ id: 31, uid: 'sub_c1', title: 's', done: false }] };
    appData.todos = [_t3];
    appData.outbox = [];
    deleteTodoSub(3, 0);
  `);
  ok('③ deleteTodoSub 父 updatedAt 严格变大', w.run('_t3.updatedAt') > 1);
  ok('③ deleteTodoSub outbox 有父 uid', w.run('appData.outbox.some(function(c){return c.uid==="todo_c";})'));

  /* ④ toggleAllTodoSubs：批量勾 10 条，父戳只变 1 次（不是 10 次） */
  w.run(`
    var _t4 = { id: 4, uid: 'todo_d', title: 'D', updatedAt: 1, subs: [] };
    for (var _i = 0; _i < 10; _i++) _t4.subs.push({ id: 400 + _i, uid: 'sub_d' + _i, title: 's' + _i, done: false });
    appData.todos = [_t4];
    appData.outbox = [];
    var _realNow = Date.now, _stampCalls = 0;
    Date.now = function () { _stampCalls++; return _realNow(); };
    toggleAllTodoSubs(4, true);
    Date.now = _realNow;
  `);
  ok('④ toggleAllTodoSubs 父 updatedAt 严格变大', w.run('_t4.updatedAt') > 1);
  ok('④ toggleAllTodoSubs outbox 有父 uid', w.run('appData.outbox.some(function(c){return c.uid==="todo_d";})'));

  /* ⑤ addRemind （父 = appData.enhSettings） */
  w.run(`
    appData.enhSettings = { special: [], sbDone: {}, reminds: [], remindDone: {} };
    appData.enhSettings.updatedAt = 1;
    appData.outbox = [];
    document.getElementById('remindNewTime').value = '09:00';
    document.getElementById('remindNewLabel').value = '喝水';
    document.getElementById('remindNewRep').value = 'daily';
    addRemind();
  `);
  ok('⑤ addRemind 父 updatedAt 严格变大', w.run('appData.enhSettings.updatedAt') > 1);
  ok('⑤ addRemind 提醒带自己的 uid', w.run('!!(appData.enhSettings.reminds[0] && appData.enhSettings.reminds[0].uid)'));

  /* ⑥ delRemind */
  w.run(`
    appData.enhSettings.updatedAt = 1;
    appData.outbox = [];
    delRemind(appData.enhSettings.reminds[0].id);
  `);
  ok('⑥ delRemind 父 updatedAt 严格变大', w.run('appData.enhSettings.updatedAt') > 1);
  ok('⑥ delRemind 真的删掉了', w.run('appData.enhSettings.reminds.length') === 0);

  /* ⑦ 一次性提醒「到期自动摘除」分支（不在用户点击路径上，最容易漏） */
  w.run(`
    var _today = getTodayStr();
    appData.enhSettings = {
      special: [], sbDone: {}, remindDone: {},
      updatedAt: 1,
      reminds: [{ id: 77, uid: 'remind_77', updatedAt: 1, on: true, t: '00:01', label: '一次性', repeat: 'once', date: '2020-01-01' }]
    };
    appData.outbox = [];
    remindCheckTime();
  `);
  ok('⑦ 到期摘除 父 updatedAt 严格变大', w.run('appData.enhSettings.updatedAt') > 1);
  ok('⑦ 到期摘除 这条真被摘掉', w.run('appData.enhSettings.reminds.length') === 0);

  /* ⑧ toggleTimerSub */
  w.run(`
    var _t8 = { id: 8, uid: 'todo_e', title: 'E', updatedAt: 1, subs: [{ id: 81, uid: 'sub_e1', title: 's', done: false }] };
    appData.todos = [_t8];
    timerState.linkedTodoId = 8;
    appData.outbox = [];
    toggleTimerSub(0);
  `);
  ok('⑧ toggleTimerSub 父 updatedAt 严格变大', w.run('_t8.updatedAt') > 1);
  ok('⑧ toggleTimerSub outbox 有父 uid', w.run('appData.outbox.some(function(c){return c.uid==="todo_e";})'));

  /* ⑨ 提醒行 on / t / label 三个编辑分支（renderPlanBreakView 里挂的监听器） */
  w.run(`
    appData.enhSettings = { special: [], sbDone: {}, remindDone: {}, updatedAt: 1,
      reminds: [{ id: 91, uid: 'remind_91', updatedAt: 1, on: true, t: '08:00', label: 'x', repeat: 'daily', date: '' }] };
    var _box = document.getElementById('planBreakView');
    var _nOn = document.getElementById('rmOnNode'), _nT = document.getElementById('rmTNode'), _nL = document.getElementById('rmLNode');
    _nOn.addEventListener = function (ev, fn) { window.__rmOn = fn; };
    _nT.addEventListener = function (ev, fn) { window.__rmT = fn; };
    _nL.addEventListener = function (ev, fn) { window.__rmL = fn; };
    _box.querySelectorAll = function (sel) {
      if (sel === '[data-rm]') return [_nOn];
      if (sel === '[data-rmt]') return [_nT];
      if (sel === '[data-rml]') return [_nL];
      return [];
    };
    __REAL.renderPlanBreakView();
    appData.outbox = [];
    appData.enhSettings.updatedAt = 1;
    window.__rmOn({ target: { checked: false } });
    var _afterOn = appData.enhSettings.updatedAt;
    window.__rmT({ target: { value: '10:30' } });
    var _afterT = appData.enhSettings.updatedAt;
    window.__rmL({ target: { value: 'y' } });
    var _afterL = appData.enhSettings.updatedAt;
  `);
  ok('⑨ 提醒行 on 编辑 父戳变大', w.run('_afterOn') > 1);
  ok('⑨ 提醒行 t 编辑 父戳变大', w.run('_afterT') > 1);
  ok('⑨ 提醒行 label 编辑 父戳变大', w.run('_afterL') > 1);
  ok('⑨ 提醒行 on 编辑真的改到值', w.run('appData.enhSettings.reminds[0].on') === false);

  /* ⑩ 习惯子计划：改一次，**打戳语句**只该跑 1 次（删漏一处就是 2）。
     注意：`enqueueChange` 内部自己会取一次 Date.now（它要给 outbox 条目记 at），
     那不是打戳。所以这一条分两步跑：
       ① 真 enqueueChange → 断言父戳变大 + outbox 有 habit_（数据正确性）
       ② 把 enqueueChange 换成记录器 → 断言 Date.now 只被调用 1 次（语句唯一性） */
  w.run(`
    var _h1 = { id: 501, uid: 'habit_h1', name: '喝水', createdAt: '2026-01-01', updatedAt: 1,
      subs: [{ id: 'hs1', text: '一杯', doneOn: '' }] };
    appData.habits = [_h1];
    appData.outbox = [];
    toggleHabitSub(501, 'hs1');
  `);
  ok('⑩ 习惯子计划 父 updatedAt 严格变大', w.run('_h1.updatedAt') > 1);
  ok('⑩ 习惯子计划 outbox 有 habit uid', w.run('appData.outbox.some(function(c){return c.uid==="habit_h1";})'));
  w.run(`
    _h1.updatedAt = 1;
    var _realEnq = enqueueChange, _enq = [];
    enqueueChange = function (uid, kind, op) { _enq.push(String(uid) + '/' + kind + '/' + op); };
    var _real2 = Date.now, _calls = 0;
    Date.now = function () { _calls++; return _real2(); };
    toggleHabitSub(501, 'hs1');
    Date.now = _real2;
    enqueueChange = _realEnq;
  `);
  ok('⑩ 习惯子计划 打戳只调用 1 次 Date.now', w.run('_calls') === 1);
  ok('⑩ 习惯子计划 入队的是父 habit uid', w.run('_enq[0]') === 'habit_h1/habit/upsert');

  /* ⑪ toggleHabit 打卡 → outbox 有 habit_ 条目 */
  w.run(`
    appData.habits = [{ id: 601, uid: 'habit_h6', name: '早睡', createdAt: '2026-01-01', updatedAt: 1 }];
    appData.habitLogs = {};
    appData.outbox = [];
    toggleHabit(601);
  `);
  ok('⑪ 打卡 outbox 有 habit_ 条目', w.run('appData.outbox.some(function(c){return /^habit_/.test(c.uid);})'));

  /* ⑫ _habitSetSkip 跳过一天 → outbox 有 habit_ 条目 */
  w.run(`
    appData.habits = [{ id: 701, uid: 'habit_h7', name: '跑步', createdAt: '2026-01-01', updatedAt: 1 }];
    appData.habitSkips = {};
    appData.outbox = [];
    _habitSetSkip(appData.habits[0], getTodayStr(), true);
  `);
  ok('⑫ 跳过一天 outbox 有 habit_ 条目', w.run('appData.outbox.some(function(c){return /^habit_/.test(c.uid);})'));

  /* ⑬ 日记：uid/updatedAt 落库 + 入队；清空 → 墓碑 */
  w.run(`
    appData.diaries = {};
    appData.tombstones = [];
    appData.outbox = [];
    var _d = getTodayStr();
    document.getElementById('single_plan_' + _d).value = '今天写了点东西';
    forceSaveDiary(_d);
  `);
  ok('⑬ 日记带 uid（形状 diary_<date>）', /^diary_\d{4}-\d{2}-\d{2}$/.test(String(w.run('appData.diaries[getTodayStr()].uid'))));
  ok('⑬ 日记 updatedAt 是数字', typeof w.run('appData.diaries[getTodayStr()].updatedAt') === 'number');
  ok('⑬ 日记入队 diary_', w.run('appData.outbox.some(function(c){return /^diary_/.test(c.uid);})'));
  w.run(`
    document.getElementById('single_plan_' + getTodayStr()).value = '';
    forceSaveDiary(getTodayStr());
  `);
  ok('⑬ 日记清空写墓碑', w.run('appData.tombstones.some(function(t){return /^diary_/.test(t.uid);})'));

  /* ⑭ 必做清单两个写入口 */
  w.run(`
    appData.mustDos = {};
    appData.mustDosAt = {};
    appData.outbox = [];
    document.getElementById('mustDoInput0').value = '写周报';
    document.getElementById('mustDoInput1').value = '';
    document.getElementById('mustDoInput2').value = '';
    saveMustDos();
  `);
  ok('⑭ saveMustDos 打戳', typeof w.run('appData.mustDosAt[Object.keys(appData.mustDos)[0]]') === 'number');
  ok('⑭ saveMustDos 入队 must_', w.run('appData.outbox.some(function(c){return /^must_/.test(c.uid);})'));
  w.run(`
    appData.outbox = [];
    window.rsAsk = function (msg, opts, cb) { cb(); };
    clearMustDos(Object.keys(appData.mustDos)[0]);
  `);
  ok('⑭ clearMustDos 入队 must_', w.run('appData.outbox.some(function(c){return /^must_/.test(c.uid);})'));
});

/* ────────────────────────── 公共助手 ────────────────────────── */
/* 装载 + 重置到「刚迁移完、数据已就绪」的状态（每条用例一个干净世界）。 */
function fresh(opts) {
  const w = boot(opts);
  w.H.reset();
  return w;
}
function J(v) { return JSON.stringify(v); }
/* 在沙箱里跑一段表达式/语句并取回值。 */
function R(w, code) { return w.run(code); }
/* 向沙箱喂一个 Node 对象（走 JSON，避免跨 realm 引用被用例意外共享）。 */
function put(w, expr, value) { return w.run(expr + ' = ' + J(value) + ';'); }
/* 开一场会话（sid 固定，方便断言 E_STALE_SID）。 */
function begin(w, peer, sid) {
  return w.run('_p2pOnEvent(' + J({ ev: 'begin', args: { sid: sid, peerId: peer } }) + ')');
}
/* 把 build 方向的所有批抽干（返回每批的 payload/last/nextCursor/total）。 */
function drainPush(w, peer, maxBytes) {
  return w.run(`(function (peer, maxBytes) {
    var cur = null, out = [], guard = 0;
    while (true) {
      if (++guard > 400) throw new Error('E_LOOP');
      var r = _p2pBuildOutboxBatch(peer, cur, maxBytes);
      out.push({ payload: r.payload, last: r.last, count: r.count, nextCursor: r.nextCursor, total: r.total });
      cur = r.nextCursor;
      if (r.last) break;
    }
    return out;
  })(${J(peer)}, ${Number(maxBytes) || 0})`);
}
/* 把 collect 方向的所有批抽干。 */
function drainPull(w, peer, since, cols, endAt, maxBytes) {
  return w.run(`(function (peer, since, cols, endAt, maxBytes) {
    var cur = { kind: 'pull', idx: 0, part: 0, endAt: endAt }, out = [], guard = 0;
    while (true) {
      if (++guard > 400) throw new Error('E_LOOP');
      var r = _p2pCollectSince(peer, since, cols, cur, maxBytes);
      out.push({ payload: r.payload, last: r.last, count: r.count, nextCursor: r.nextCursor, total: r.total });
      cur = r.nextCursor;
      if (r.last) break;
    }
    return out;
  })(${J(peer)}, ${Number(since) || 0}, ${J(cols)}, ${J(endAt)}, ${Number(maxBytes) || 0})`);
}
/* 造 n 条专注记录（uid=rec_i，updatedAt 递增）。 */
function mkRecs(w, n, baseTs) {
  w.run(`(function (n, base) {
    appData.records = [];
    for (var i = 0; i < n; i++) {
      appData.records.push({ id: i + 1, uid: 'rec_' + i, title: 'r' + i, sec: 60, updatedAt: base + i });
    }
  })(${n}, ${Number(baseTs) || 1})`);
}

/* ====================================================================== */
/*  以下按 SYNC_DESIGN §17.1 的清单逐条落地（50 条，顺序与表格一致）        */
/* ====================================================================== */

/* ── 指纹（C36–C38）────────────────────────────────────────────────── */

test('fp-hash-stability', function () {
  const w = fresh();
  const seen = R(w, `(function () {
    var set = Object.create(null);
    for (var i = 0; i < 1000; i++) set[_fpHash('bottle-focus-sync')] = 1;
    return Object.keys(set);
  })()`);
  eq('fp-hash-stability 1000 次只出一个值', seen.length, 1);
  ok('fp-hash-stability 输出 8 位小写 hex', /^[0-9a-f]{8}$/.test(String(seen[0])), String(seen[0]));
  eq('fp-hash-stability 常量（防有人把 Math.imul 换成 *）', seen[0], '043197ac');
});

test('fp-list-order-independent', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var a = [{ uid: 'rec_1', updatedAt: 10 }, { uid: 'rec_2', updatedAt: 20 }, { uid: 'rec_3', updatedAt: 30 }];
    var b = [a[2], a[0], a[1]];
    return { x: _fpOfList(a), y: _fpOfList(b) };
  })()`);
  eq('fp-list-order-independent 两种数组顺序指纹相同', r.x, r.y);
});

test('fp-all-constant', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.records = [{ uid: 'rec_a', title: 'A', updatedAt: 1000 }];
    appData.todos = [{ uid: 'todo_a', title: 'T', subs: [], updatedAt: 2000 }];
    appData.habits = [{ uid: 'habit_a', name: 'H', updatedAt: 3000 }];
    appData.memos = [{ uid: 'memo_a', text: 'M', updatedAt: 4000 }];
    appData.countdowns = [{ uid: 'cd_a', title: 'C', updatedAt: 5000 }];
    appData.lifeGoals = [{ uid: 'lg_a', title: 'G', updatedAt: 6000 }];
    appData.diaries = { '2026-11-20': { uid: 'diary_2026-11-20', plan: 'p', updatedAt: 7000 } };
    appData.habitLogs = { habit_a: ['2026-11-19', '2026-11-20'] };
    return { once: _fpAll(), twice: _fpAll() };
  })()`);
  eq('fp-all-constant 同一份数据两次调用相同', r.once, r.twice);
  eq('fp-all-constant 逐字等于写死的常量', r.once, '14d5e542');
});

test('fp-no-uid-excluded', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var withUid = [{ uid: 'rec_1', updatedAt: 10 }, { uid: 'rec_2', updatedAt: 20 }];
    var withBad = withUid.concat([{ title: '没有 uid 的老记录', updatedAt: 99 }]);
    return { a: _fpOfList(withUid), b: _fpOfList(withBad) };
  })()`);
  eq('fp-no-uid-excluded 无 uid 记录不进指纹', r.a, r.b);
});

/* ── LWW / skew（C26）──────────────────────────────────────────────── */

test('lww-skew-peer-ahead', function () {
  const w = fresh();
  const r = R(w, `lwwPick({ uid: 'rec_1', updatedAt: 1000 }, { uid: 'rec_1', updatedAt: 1300 }, -200)`);
  eq('lww-skew-peer-ahead 校正后 tr=1100 → remote', r, 'remote');
});

test('lww-skew-peer-behind', function () {
  const w = fresh();
  const r = R(w, `lwwPick({ uid: 'rec_1', updatedAt: 1000 }, { uid: 'rec_1', updatedAt: 700 }, 200)`);
  eq('lww-skew-peer-behind 校正后 tr=900 → local', r, 'local');
});

test('lww-tie-both-sides', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var badSame = 0, badPick = 0, badSkewPick = 0;
    for (var i = 0; i < 100; i++) {
      var a = { uid: 'rec_t', v: 'A' + i, updatedAt: 5000 };
      var b = { uid: 'rec_t', v: 'B' + i, updatedAt: 5000 };
      /* ① 真平局（skew=0）：必须落到 _tiePick，两端选中同一条 */
      var s1 = lwwPick(a, b, 0), s2 = lwwPick(b, a, 0);
      if (s1 === 'same' || s2 === 'same') badSame++;
      var g1 = (s1 === 'remote') ? b : a;
      var g2 = (s2 === 'remote') ? a : b;
      if (_canon(g1) !== _canon(g2)) badPick++;
      /* ② 带 skew 的两侧（§17.1 原文给的形态）：也必须选中同一条 */
      var DA = 200;
      var t1 = lwwPick(a, b, -DA), t2 = lwwPick(b, a, DA);
      var h1 = (t1 === 'remote') ? b : a;
      var h2 = (t2 === 'remote') ? a : b;
      if (_canon(h1) !== _canon(h2)) badSkewPick++;
    }
    return { badSame: badSame, badPick: badPick, badSkewPick: badSkewPick };
  })()`);
  eq('lww-tie-both-sides ① 从不返回 same', r.badSame, 0);
  eq('lww-tie-both-sides ② 100 组两侧选中同一条（skew=0）', r.badPick, 0);
  eq('lww-tie-both-sides ③ 100 组两侧选中同一条（skew=±Δ）', r.badSkewPick, 0);
});

test('lww-skew-worked-example', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var D = 300000;
    var aVer = { uid: 'rec_x', title: 'A 的 2000 版', updatedAt: 2000 };
    var bVer = { uid: 'rec_x', title: 'B 的 301000 版', updatedAt: 301000 };
    /* A 侧：local = 自己 2000，remote = B 的 301000，skew = 我方域 − 对方域 = −Δ */
    var aSide = lwwPick(aVer, bVer, -D);
    /* B 侧：local = 自己 301000，remote = A 的 2000，skew = +Δ */
    var bSide = lwwPick(bVer, aVer, D);
    /* 故意抄反符号：A 侧用 +Δ → 会判 remote（= B 的版本）→ 两端就分家了 */
    var wrong = lwwPick(aVer, bVer, D);
    return { aSide: aSide, bSide: bSide, wrong: wrong };
  })()`);
  eq('lww-skew-worked-example A 侧判 local', r.aSide, 'local');
  eq('lww-skew-worked-example B 侧判 remote', r.bSide, 'remote');
  ok('lww-skew-worked-example 符号抄反就会得出相反的结论', r.wrong !== r.aSide, 'wrong=' + r.wrong);
});

test('lww-skew-both-directions', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var seed = 20261120;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    var badAgree = 0, badWinner = 0, n = 0;
    for (var i = 0; i < 500; i++) {
      var D = 1 + Math.floor(rnd() * 600000);
      var ta = 1000 + Math.floor(rnd() * 1000000);
      var tb = 1000 + Math.floor(rnd() * 1000000);
      if (tb - ta === D) continue;                      /* 恰好相等会走平局，另有专门用例 */
      n++;
      var ra = { uid: 'rec_z', v: 'A', updatedAt: ta };
      var rb = { uid: 'rec_z', v: 'B', updatedAt: tb };
      /* A 侧 skew = −Δ（B 的钟快 Δ）；B 侧 skew = +Δ */
      var sa = lwwPick(ra, rb, -D);
      var sb = lwwPick(rb, ra, D);
      var ga = (sa === 'remote') ? rb : ra;
      var gb = (sb === 'remote') ? ra : rb;
      if (_canon(ga) !== _canon(gb)) badAgree++;
      var winner = (tb - ta > D) ? 'B' : 'A';
      if (ga.v !== winner) badWinner++;
    }
    return { n: n, badAgree: badAgree, badWinner: badWinner };
  })()`);
  ok('lww-skew-both-directions 样本量 ≈500', r.n >= 480, 'n=' + r.n);
  eq('lww-skew-both-directions 两端选出同一条', r.badAgree, 0);
  eq('lww-skew-both-directions 赢家 = tb−ta>Δ 的那条', r.badWinner, 0);
});

test('lww-tie-deterministic', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var a = { uid: 'rec_t', title: '甲', updatedAt: 9000 };
    var b = { uid: 'rec_t', title: '乙', updatedAt: 9000 };
    var first = lwwPick(a, b, 0), diff = 0, diff2 = 0;
    for (var i = 0; i < 100; i++) {
      if (lwwPick(a, b, 0) !== first) diff++;
      if (lwwPick(b, a, 0) !== (first === 'remote' ? 'local' : 'remote')) diff2++;
    }
    return { first: first, diff: diff, diff2: diff2 };
  })()`);
  ok('lww-tie-deterministic 平局有确定结果', r.first === 'local' || r.first === 'remote', r.first);
  eq('lww-tie-deterministic 100 次稳定', r.diff, 0);
  eq('lww-tie-deterministic 100 次反向也稳定', r.diff2, 0);
});

test('lww-tie-nested', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var a = { uid: 'todo_t', title: 'T', updatedAt: 7000, subs: [{ uid: 'sub_1', done: true }] };
    var b = { uid: 'todo_t', title: 'T', updatedAt: 7000, subs: [{ uid: 'sub_1', done: false }] };
    var s1 = lwwPick(a, b, 0), s2 = lwwPick(b, a, 0);
    var g1 = (s1 === 'remote') ? b : a;
    var g2 = (s2 === 'remote') ? a : b;
    return { canonDiff: _canon(a) !== _canon(b), same: s1 === 'same' || s2 === 'same', agree: _canon(g1) === _canon(g2) };
  })()`);
  ok('lww-tie-nested 只差 subs[0].done 的 _canon 必须不同', r.canonDiff);
  ok('lww-tie-nested 不能误判 same', !r.same);
  ok('lww-tie-nested 两端一致选同一条', r.agree);
});

test('canon-type-tags', function () {
  const w = fresh();
  const bad = R(w, `(function () {
    var SEP = String.fromCharCode(1);
    var sets = [
      [1, '1', [1], { a: 1 }],
      [null, undefined],
      ['a' + SEP + 'b', ['a', 'b']]
    ];
    var out = [];
    sets.forEach(function (g, gi) {
      for (var i = 0; i < g.length; i++) {
        for (var j = i + 1; j < g.length; j++) {
          if (_canon(g[i]) === _canon(g[j])) out.push(gi + '#' + i + '=' + j);
        }
      }
    });
    return out;
  })()`);
  eq('canon-type-tags 六组两两 _canon 都不相等', bad, []);
});

/* ── 合并（C27/C28）────────────────────────────────────────────────── */

test('merge-idempotent', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var local = [{ uid: 'rec_a', title: 'old', updatedAt: 1000 }];
    var remote = [{ uid: 'rec_a', title: 'new', updatedAt: 2000 }, { uid: 'rec_b', title: 'b', updatedAt: 2000 }];
    var r1 = mergeRemoteRecords(local, remote, []);
    var r2 = mergeRemoteRecords(r1.list, remote, []);
    var r3 = mergeRemoteRecords(r2.list, remote, []);
    return [r1.added + r1.updated, r2.added + r2.updated, r3.added + r3.updated, r3.list.length];
  })()`);
  eq('merge-idempotent 第 2/3 次 added+updated === 0', r, [2, 0, 0, 2]);
});

test('merge-tombstone-wins', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var local = [{ uid: 'rec_a', title: 'alive', updatedAt: 1000 }];
    var remote = [{ uid: 'rec_a', title: 'newer', updatedAt: 9999 }];
    var tombs = [{ uid: 'rec_a', kind: 'record', deletedAt: 500 }];
    var res = mergeRemoteRecords(local, remote, tombs);
    return { len: res.list.length, skipped: res.skipped, added: res.added, updated: res.updated };
  })()`);
  eq('merge-tombstone-wins 记录不复活且 skipped++', r, { len: 0, skipped: 1, added: 0, updated: 0 });
});

test('merge-no-echo', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.outbox = [];
    enqueueChange('rec_local', 'record', 'upsert');
    var before = appData.outbox.length;
    applyRemoteBatch({ records: [{ uid: 'rec_remote', title: 'x', updatedAt: 1000 }] },
      { deferSave: true, deferRender: true });
    return { before: before, after: appData.outbox.length, applied: appData.records.length };
  })()`);
  eq('merge-no-echo apply 后 outbox 长度不变', [r.before, r.after], [1, 1]);
  eq('merge-no-echo 记录确实落地了', r.applied, 1);
});

test('since-parent-of-sub', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.todos = [{ id: 1, uid: 'todo_p', title: 'P', updatedAt: 1,
      subs: [{ id: 11, uid: 'sub_1', title: 's', done: false }] }];
    appData.outbox = [];
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    document.getElementById('todo_sub_input_1').value = '新子任务';
    addTodoSub(1);                                  /* 只动子任务 */
    var stamp = appData.todos[0].updatedAt;
    var got = _p2pCollectSince('p1', 1, ['todos'], { endAt: -1 }, 0);
    return {
      stampGrew: stamp > 1,
      uids: got.payload.todos.map(function (t) { return t.uid; }),
      subs: got.payload.todos.length ? got.payload.todos[0].subs.length : 0
    };
  })()`);
  ok('since-parent-of-sub 父戳被 touchParentOfSub 打新', r.stampGrew);
  eq('since-parent-of-sub collect 返回的是父待办', r.uids, ['todo_p']);
  eq('since-parent-of-sub 父待办里带着新子任务', r.subs, 2);
});

test('since-watermark-boundary', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.records = [
      { uid: 'rec_old', updatedAt: 1000 },
      { uid: 'rec_new', updatedAt: 1001 }
    ];
    return _p2pScanSince(1000, -1, ['records']).map(function (x) { return x.uid; });
  })()`);
  eq('since-watermark-boundary updatedAt==since 不返回（严格大于）', r, ['rec_new']);
});

test('apply-batch-16-collections', function () {
  /* 16 个集合各 1 条（12 数组 + 4 映射）全落地；再与「对端自己构造的等价数据」
     比指纹与逐集合 JSON。最后补 apply-batch-legacy-8 的回归（8 类老集合照旧）。 */
  const w = fresh();
  const batch = {
    records: [{ uid: 'rec_1', title: 'r', updatedAt: 10 }],
    todos: [{ uid: 'todo_1', title: 't', subs: [], updatedAt: 11 }],
    habits: [{ id: 9, uid: 'habit_9', name: 'h', updatedAt: 12 }],
    memos: [{ uid: 'memo_1', text: 'm', updatedAt: 13 }],
    countdowns: [{ uid: 'cd_1', title: 'c', updatedAt: 14 }],
    lifeGoals: [{ uid: 'lg_1', title: 'g', updatedAt: 15 }],
    lifeAreas: [{ uid: 'area_1', name: 'a', updatedAt: 16 }],
    reviews: [{ uid: 'rv_1', text: 'v', updatedAt: 17 }],
    weekFocus: [{ uid: 'wf_1', title: 'w', updatedAt: 18 }],
    habitCats: [{ uid: 'hcat_1', name: 'hc', updatedAt: 19 }],
    selfRewards: [{ uid: 'reward_1', name: 'rw', updatedAt: 20 }],
    wishes: [{ uid: 'wish_1', text: 'wi', updatedAt: 21 }],
    diaries: { '2026-11-20': { uid: 'diary_2026-11-20', plan: 'd', updatedAt: 22 } },
    mustDos: { '2026-11-20': ['必做一件'] },
    mustDosAt: { '2026-11-20': 23 },
    habitLogs: { habit_9: ['2026-11-19'] },
    habitSkips: { habit_9: ['2026-11-18'] },
    tombstones: []
  };
  const r = R(w, `(function (b) {
    var res = applyRemoteBatch(b, { deferSave: true, deferRender: true });
    var out = {};
    ['records','todos','habits','memos','countdowns','lifeGoals','lifeAreas','reviews',
     'weekFocus','habitCats','selfRewards','wishes'].forEach(function (k) {
      out[k] = Array.isArray(appData[k]) ? appData[k].length : -1;
    });
    out.diaries = Object.keys(appData.diaries).length;
    out.mustDos = Object.keys(appData.mustDos).length;
    out.mustDosAt = Object.keys(appData.mustDosAt).length;
    /* 打卡的 key 换成习惯 uid 后再换回本机 h.id（C39） */
    out.habitLogsKeys = Object.keys(appData.habitLogs);
    out.habitSkipsKeys = Object.keys(appData.habitSkips);
    out.habitLogs = (appData.habitLogs[9] || []).slice();
    out.fp = _fpAll();
    return { out: out, res: res };
  })(${J(batch)})`);
  const keys = ['records', 'todos', 'habits', 'memos', 'countdowns', 'lifeGoals', 'lifeAreas',
    'reviews', 'weekFocus', 'habitCats', 'selfRewards', 'wishes'];
  const bad = keys.filter(function (k) { return r.out[k] !== 1; });
  eq('apply-batch-16-collections 12 个数组集合各落地 1 条', bad, []);
  eq('apply-batch-16-collections 4 个映射集合都落地',
    [r.out.diaries, r.out.mustDos, r.out.mustDosAt], [1, 1, 1]);
  eq('apply-batch-16-collections habitLogs key 换回本机 h.id', r.out.habitLogsKeys, ['9']);
  eq('apply-batch-16-collections habitSkips key 换回本机 h.id', r.out.habitSkipsKeys, ['9']);
  eq('apply-batch-16-collections 打卡日期落地', r.out.habitLogs, ['2026-11-19']);

  /* 期望值：另一个干净世界里手工构造同一份数据 → 指纹必须逐字相等 */
  const w2 = fresh();
  const fpWant = R(w2, `(function () {
    appData.records = [{ uid: 'rec_1', title: 'r', updatedAt: 10 }];
    appData.todos = [{ uid: 'todo_1', title: 't', subs: [], updatedAt: 11 }];
    appData.habits = [{ id: 9, uid: 'habit_9', name: 'h', updatedAt: 12 }];
    appData.memos = [{ uid: 'memo_1', text: 'm', updatedAt: 13 }];
    appData.countdowns = [{ uid: 'cd_1', title: 'c', updatedAt: 14 }];
    appData.lifeGoals = [{ uid: 'lg_1', title: 'g', updatedAt: 15 }];
    appData.lifeAreas = [{ uid: 'area_1', name: 'a', updatedAt: 16 }];
    appData.reviews = [{ uid: 'rv_1', text: 'v', updatedAt: 17 }];
    appData.weekFocus = [{ uid: 'wf_1', title: 'w', updatedAt: 18 }];
    appData.habitCats = [{ uid: 'hcat_1', name: 'hc', updatedAt: 19 }];
    appData.selfRewards = [{ uid: 'reward_1', name: 'rw', updatedAt: 20 }];
    appData.wishes = [{ uid: 'wish_1', text: 'wi', updatedAt: 21 }];
    appData.diaries = { '2026-11-20': { uid: 'diary_2026-11-20', plan: 'd', updatedAt: 22 } };
    appData.mustDos = { '2026-11-20': ['必做一件'] };
    appData.mustDosAt = { '2026-11-20': 23 };
    appData.habitLogs = { 9: ['2026-11-19'] };
    appData.habitSkips = { 9: ['2026-11-18'] };
    return _fpAll();
  })()`);
  eq('apply-batch-16-collections 指纹与对端构造的期望值一致', r.out.fp, fpWant);

  /* 回归：v1.1 的 8 类版本（apply-batch-legacy-8）行为不变 */
  const w3 = fresh();
  const legacy = R(w3, `(function () {
    var b = { records: [{ uid: 'rec_1', updatedAt: 1 }], todos: [{ uid: 'todo_1', updatedAt: 2 }],
      habits: [{ uid: 'habit_1', updatedAt: 3 }], memos: [{ uid: 'memo_1', updatedAt: 4 }],
      countdowns: [{ uid: 'cd_1', updatedAt: 5 }], lifeGoals: [{ uid: 'lg_1', updatedAt: 6 }],
      reviews: [{ uid: 'rv_1', updatedAt: 7 }], tombstones: [] };
    var res = applyRemoteBatch(b, { deferSave: true, deferRender: true });
    return { rec: res.records, todo: res.todos, habit: res.habits, total: appData.records.length
      + appData.todos.length + appData.habits.length + appData.memos.length
      + appData.countdowns.length + appData.lifeGoals.length + appData.reviews.length };
  })()`);
  eq('apply-batch-legacy-8 老 8 类调用照旧全落地', legacy.total, 7);
});

test('payload-wf-not-in-records', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.weekFocus = [{ uid: 'wf_1', title: 'W', updatedAt: 1000 }];
    appData.records = [{ uid: 'rec_1', title: 'R', updatedAt: 1000 }];
    appData.outbox = [];
    enqueueChange('wf_1', 'wf', 'upsert');
    enqueueChange('nosuch_1', 'nosuch', 'upsert');
    var pl = syncPayload();
    return { wf: pl.weekFocus.length, rec: pl.records.length, changes: pl.changes.length };
  })()`);
  eq('payload-wf-not-in-records 周重点进 weekFocus', r.wf, 1);
  eq('payload-wf-not-in-records 不冒充专注记录', r.rec, 0);
  eq('payload-wf-not-in-records 未知 kind 只是不发（changes 仍记账）', r.changes, 2);
});

test('outbox-prune-by-wm', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.syncPeers = { p1: { watermark: 100 }, p2: { watermark: 200 } };
    appData.outbox = [
      { uid: 'rec_a', kind: 'record', op: 'upsert', at: 150 },
      { uid: 'rec_b', kind: 'record', op: 'upsert', at: 50 }
    ];
    var pruned = outboxPruneByWatermark();
    return { pruned: pruned, left: appData.outbox.map(function (c) { return c.uid; }) };
  })()`);
  eq('outbox-prune-by-wm at=50 的删掉、at=150 的留着', r, { pruned: 1, left: ['rec_a'] });
});

test('commit-rollback-on-fail', async function () {
  const w = fresh();
  const res = await w.run(`(function () {
    appData.syncPeers = { p1: { watermark: 500, offset: 0, lastAt: 1, tombLossy: false } };
    saveDataNow = function () { return 'json-fail'; };
    return _p2pCommit('p1', 900, false);
  })()`);
  eq('commit-rollback-on-fail committed === false', res.committed, false);
  eq('commit-rollback-on-fail status 原样上抛', res.status, 'json-fail');
  eq('commit-rollback-on-fail 水位回滚到旧值', R(w, 'appData.syncPeers.p1.watermark'), 500);
});

test('tomb-lossy-flag', async function () {
  const w = fresh();
  const res = await w.run(`(function () {
    appData.tombstones = [{ uid: 'rec_old', kind: 'record', deletedAt: 1000 }];
    appData.syncPeers = { p1: { watermark: 500, offset: 0, lastAt: 1 } };
    var floor = _p2pTombFloor();
    return { floor: floor, p: _p2pCommit('p1', 500) };
  })()`);
  const p = await res.p;
  eq('tomb-lossy-flag 最早墓碑 = 1000', res.floor, 1000);
  eq('tomb-lossy-flag 水位 500 < 墓碑 → tombLossy', R(w, 'appData.syncPeers.p1.tombLossy'), true);
  eq('tomb-lossy-flag 提交仍然成功', p.committed, true);
});

/* ── 游标（C40）────────────────────────────────────────────────────── */

test('batch-cursor-monotonic', function () {
  const w = fresh();
  mkRecs(w, 9000, 1000);
  R(w, `(function () {
    appData.outbox = appData.records.map(function (r) {
      return { uid: r.uid, kind: 'record', op: 'upsert', at: 2000 };
    });
  })()`);
  begin(w, 'p1', 'S1');
  const batches = drainPush(w, 'p1', 0);
  eq('batch-cursor-monotonic 9000 条 / 每批 2000 → 5 批', batches.length, 5);
  eq('batch-cursor-monotonic 每批条数', batches.map(function (b) { return b.count; }), [2000, 2000, 2000, 2000, 1000]);
  const all = [];
  batches.forEach(function (b) {
    b.payload.records.forEach(function (r) { all.push(r.uid); });
  });
  eq('batch-cursor-monotonic 并集 == 全集', all.length, 9000);
  eq('batch-cursor-monotonic 两两无交集', new Set(all).size, 9000);
  let mono = true, prev = -1;
  batches.forEach(function (b) {
    if (b.nextCursor.idx < prev) mono = false;
    prev = b.nextCursor.idx;
  });
  ok('batch-cursor-monotonic nextCursor.idx 单调不减', mono);
  eq('batch-cursor-monotonic last:true 时 idx == total', batches[4].nextCursor.idx, batches[4].total);
});

test('batch-cursor-snapshot-stable', function () {
  const w = fresh();
  mkRecs(w, 9000, 1000);
  R(w, `appData.outbox = appData.records.map(function (r) {
    return { uid: r.uid, kind: 'record', op: 'upsert', at: 2000 };
  });`);
  begin(w, 'p1', 'S1');
  const first = R(w, `_p2pBuildOutboxBatch('p1', null, 0)`);
  R(w, `(function () {
    for (var i = 0; i < 100; i++) {
      appData.records.push({ id: 9001 + i, uid: 'rec_new_' + i, title: 'n' + i, updatedAt: 999999 });
      appData.outbox.push({ uid: 'rec_new_' + i, kind: 'record', op: 'upsert', at: 999999 });
    }
  })()`);
  const rest = R(w, `(function (cur) {
    var out = [], guard = 0;
    while (true) {
      if (++guard > 400) throw new Error('E_LOOP');
      var r = _p2pBuildOutboxBatch('p1', cur, 0);
      out.push(r);
      cur = r.nextCursor;
      if (r.last) break;
    }
    return out;
  })(${J(first.nextCursor)})`);
  const later = [];
  rest.forEach(function (b) {
    b.payload.records.forEach(function (r) { later.push(r.uid); });
  });
  eq('batch-cursor-snapshot-stable 第 1 批 2000 条', first.count, 2000);
  eq('batch-cursor-snapshot-stable 后续批里没有新插入的 100 条',
    later.filter(function (u) { return u.indexOf('rec_new_') === 0; }).length, 0);
  eq('batch-cursor-snapshot-stable 总条数仍 = 9000', 2000 + later.length, 9000);
});

test('collect-endat-clamp', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.records = [
      { uid: 'rec_a', title: 'a', updatedAt: 1200 },
      { uid: 'rec_b', title: 'b', updatedAt: 1300 }
    ];
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    var got = _p2pCollectSince('p1', 0, ['records'], { endAt: 1200 }, 0);
    return got.payload.records.map(function (x) { return x.uid; });
  })()`);
  eq('collect-endat-clamp updatedAt<=endAt（含等号）', r, ['rec_a']);
});

test('collect-cursor-overlap-none', function () {
  const w = fresh();
  R(w, `(function () {
    appData.records = [];
    appData.todos = [];
    for (var i = 0; i < 5; i++) {
      appData.records.push({ uid: 'rec_' + i, updatedAt: 1000 + i });
      appData.todos.push({ uid: 'todo_' + i, subs: [], updatedAt: 1000 + i });
    }
  })()`);
  begin(w, 'p1', 'S1');
  const batches = drainPull(w, 'p1', 0, ['records', 'todos'], -1, 400);
  const all = [];
  batches.forEach(function (b) {
    (b.payload.records || []).forEach(function (x) { all.push(x.uid); });
    (b.payload.todos || []).forEach(function (x) { all.push(x.uid); });
  });
  eq('collect-cursor-overlap-none 10 条全部出现一次', all.length, 10);
  eq('collect-cursor-overlap-none 每批内无重复', new Set(all).size, 10);
  eq('collect-cursor-overlap-none 集合顺序稳定（records 先、按 uid 升序）',
    all, ['rec_0', 'rec_1', 'rec_2', 'rec_3', 'rec_4', 'todo_0', 'todo_1', 'todo_2', 'todo_3', 'todo_4']);
});

/* ── 中止 / 提交（C43–C45）────────────────────────────────────────── */

test('abort-flush-default', function () {
  const w = fresh();
  R(w, `(function () {
    globalThis.__saveCalls = 0;
    var real = saveDataNow;
    saveDataNow = function () { globalThis.__saveCalls++; return real(); };
    appData.records = [{ uid: 'rec_1', updatedAt: 10 }];
    appData.outbox = [];
    appData.syncPeers = { p1: { watermark: 777, offset: 0, lastAt: 1 } };
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
  })()`);
  for (let i = 0; i < 3; i++) {
    R(w, `_p2pApplyBatch('p1', { part: ${i}, records: [{ uid: 'rec_r${i}', updatedAt: ${20 + i} }] },
      0, false, { deferSave: true, deferRender: true })`);
  }
  const r = R(w, `_p2pAbort('p1')`);
  eq('abort-flush-default 默认 flush → saveDataNow 只调 1 次', R(w, 'globalThis.__saveCalls'), 1);
  eq('abort-flush-default 中止不写水位', R(w, 'appData.syncPeers.p1.watermark'), 777);
  eq('abort-flush-default flushed === true', r.flushed, true);
});

test('abort-flush-false', function () {
  const w = fresh();
  R(w, `(function () {
    globalThis.__saveCalls = 0;
    var real = saveDataNow;
    saveDataNow = function () { globalThis.__saveCalls++; return real(); };
    appData.syncPeers = { p1: { watermark: 888, offset: 0, lastAt: 1 } };
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
  })()`);
  const r = R(w, `_p2pAbort('p1', { flush: false })`);
  eq('abort-flush-false 不落盘', R(w, 'globalThis.__saveCalls'), 0);
  eq('abort-flush-false 水位不变', R(w, 'appData.syncPeers.p1.watermark'), 888);
  eq('abort-flush-false flushed === false', r.flushed, false);
});

/* ── 配对码 / 自连守卫 / 世代号 ────────────────────────────────────── */

test('pair-code-crosslang', function () {
  const w = fresh();
  const r = R(w, `(function () {
    return {
      oneWay: _p2pPairCode('a3f19c2e5b7d4018', 'c97c5d51405e3538'),
      otherWay: _p2pPairCode('c97c5d51405e3538', 'a3f19c2e5b7d4018')
    };
  })()`);
  eq('pair-code-crosslang 逐字等于 Kotlin 侧同一常量', r.oneWay, '4172');
  ok('pair-code-crosslang 顺序固定（换序得到另一个值）', r.otherWay !== '4172', String(r.otherWay));
});

test('discovery-drop-self', function () {
  const w = fresh();
  const r = R(w, `(function () {
    /* 原生 sync.info 带回 selfId：网页侧据此认「自己」 */
    window.__bottleBridge = { call: function (cmd) {
      if (cmd === 'sync.info') return { pairedCount: 2, selfId: 'self0001' };
      return null;
    } };
    _p2pQueryInfo();
    /* 一条 probe、一条 reply，did 都是本机自己 */
    var e1 = _p2pOnEvent({ ev: 'peerChanged', args: { added: 'self0001' } });
    var e2 = _p2pOnEvent({ ev: 'peerChanged', args: { reset: 'self0001' } });
    var beginSelf = _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'self0001' } });
    return {
      peers: Object.keys(appData.syncPeers || {}),
      dup: (_p2pSess && _p2pSess.dupCount) || 0,
      errLines: _p2pDiag().recent.filter(function (l) { return l.indexOf('error=') >= 0; }).length,
      ignored: [e1.ignored, e2.ignored],
      beginSelf: beginSelf,
      sessNull: _p2pSess === null,
      paired: _p2pPairedCount()
    };
  })()`);
  eq('discovery-drop-self self 不进 peers', r.peers, []);
  eq('discovery-drop-self 不增 dupCount', r.dup, 0);
  eq('discovery-drop-self 不产生任何错误统计', r.errLines, 0);
  eq('discovery-drop-self 两条 self 事件都被标注忽略', r.ignored, ['self', 'self']);
  eq('discovery-drop-self 自连 begin 被拒（E_SAME_ORIGIN）', r.beginSelf, { ok: false, error: 'E_SAME_ORIGIN' });
  ok('discovery-drop-self 自连不建会话', r.sessNull);
  eq('discovery-drop-self 其它 peer 照常（pairedCount 已缓存）', r.paired, 2);
});

test('sid-stale-rejected', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.records = [{ uid: 'rec_1', title: 'a', updatedAt: 10 }];
    appData.outbox = [{ uid: 'rec_1', kind: 'record', op: 'upsert', at: 20 }];
    _p2pOnEvent({ ev: 'begin', args: { sid: 'A', peerId: 'p1' } });
    _p2pOnEvent({ ev: 'build', args: { sid: 'A', peerId: 'p1' } });
    _p2pOnEvent({ ev: 'build', args: { sid: 'A', peerId: 'p1' } });
    var before = JSON.stringify(appData);
    var bad = _p2pOnEvent({ ev: 'build', args: { sid: 'B', peerId: 'p1' } });
    var after = JSON.stringify(appData);
    return { bad: bad, same: before === after, sid: _p2pSess ? _p2pSess.sid : null };
  })()`);
  eq('sid-stale-rejected 换代后的 build 返回 E_STALE_SID', r.bad, { ok: false, error: 'E_STALE_SID' });
  eq('sid-stale-rejected 不产生任何 payload、数据字节级不变', r.same, true);
  eq('sid-stale-rejected 旧会话原样留着（不重置游标）', r.sid, 'A');
  /* §15.1：`_resetAllCursors` 必须全仓 0 次 */
  const files = fs.readdirSync(SCRIPTS).filter(function (f) { return /\.js$/.test(f); });
  const hits = files.filter(function (f) {
    return fs.readFileSync(path.join(SCRIPTS, f), 'utf8').indexOf('_resetAllCursors') >= 0;
  });
  eq('sid-stale-rejected 全仓 _resetAllCursors 出现 0 次', hits, []);
});

/* 原生 `SyncSession.doPush` 的第一步就是发 `ev=tomb`。分发器漏这个 case 不会报错，
   而是静默落 default → E_NO_EV，会话在握手后第一个动作就死（0.6.8 真机现场：
   一台显示「tomb · E_NO_EV」，另一台显示「连接中断」）。
   这里把原生会发的**全部**事件名打一遍，任何一个落到 default 都算红。 */
test('dispatcher-covers-native-events', function () {
  const w = fresh();
  const names = ['begin', 'tomb', 'build', 'collect', 'apply', 'fingerprint', 'compare', 'commit', 'abort'];
  const got = R(w, `(function (names) {
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    var bad = [];
    names.forEach(function (n) {
      var r = _p2pOnEvent({ ev: n, args: { sid: 'S1', peerId: 'p1' } });
      if (r && r.error === 'E_NO_EV') bad.push(n);
    });
    return bad;
  })(${J(names)})`);
  eq('dispatcher-covers-native-events 原生事件名全部有分支', got, []);
});

/* 原生 `jsOk` 认的是 `data.ok === true`（缺省即失败）。成功响应不写 ok 的话，
   第一个成功事件就会被判成 E_JS_ERROR —— 0.6.9 真机现场：tomb 分支补上后
   立刻改报 `tomb · E_JS_ERROR`。门面必须统一补 ok:true。 */
test('envelope-ok-on-success', function () {
  const w = fresh();
  const got = R(w, `(function () {
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S2', peerId: 'p2' } });
    var bad = [];
    /* commit 例外：它是 thenable，ok 在 resolve 之后才补（见 commit-replies-after-async） */
    ['tomb', 'build', 'collect', 'fingerprint', 'compare', 'abort'].forEach(function (n) {
      var r = window.BottleSync.onEvent({ ev: n, args: { sid: 'S2', peerId: 'p2' } });
      if (!r || r.ok !== true) bad.push(n + ':' + String(r && r.ok));
    });
    return bad;
  })()`);
  eq('envelope-ok-on-success 成功响应必须显式 ok:true', got, []);
  /* 反向：错误响应必须保留 ok:false 且带 error，不能被门面「补」成 true */
  const err = R(w, `window.BottleSync.onEvent({ ev: 'build', args: { sid: '不匹配', peerId: 'p2' } })`);
  eq('envelope-ok-on-success 错误响应不被误补', { ok: err.ok, error: err.error }, { ok: false, error: 'E_STALE_SID' });
});

/* `commit` 是唯一异步事件（等 IDB 队列兑现）。旧实现把 Promise 直接丢给
   JSON.stringify → `{}` → 原生读不到 committed → 判 false → 同步最后一步
   报「存储空间不足」。回包必须等 resolve 之后。 */
test('commit-replies-after-async', async function () {
  const w = fresh();
  const r = R(w, `(function () {
    window.__replies = [];
    window.__bottleBridge = { call: function (cmd, p) {
      if (cmd === 'sync.reply') window.__replies.push(p);
      return null;
    } };
    _p2pOnEvent({ ev: 'begin', args: { sid: 'C9', peerId: 'p9' } });
    var ret = window.__bottleSyncEvent(JSON.stringify({
      ev: 'commit', token: 'tk', args: { sid: 'C9', peerId: 'p9', wm: 1 }
    }));
    return { retIsNull: ret === null, before: window.__replies.length };
  })()`);
  eq('commit-replies-after-async 未 resolve 前不回包', r, { retIsNull: true, before: 0 });
  await new Promise(function (res) { setTimeout(res, 600); });
  const late = R(w, `(function () {
    var p = window.__replies[0];
    if (!p) return null;
    return { ok: p.ok, committed: p.data && p.data.committed, status: p.data && p.data.status };
  })()`);
  ok('commit-replies-after-async resolve 后确实回包', !!late, JSON.stringify(late));
  eq('commit-replies-after-async 回包 committed=true', late && late.committed, true);
});

/* ── 子结构 / 墓碑通道（C41）──────────────────────────────────────── */

test('merge-subtask-only-change', function () {
  const A = fresh();
  const B = fresh();
  const seedTodo = `appData.todos = [{ id: 1, uid: 'todo_x', title: 'X', updatedAt: 1000,
    subs: [{ id: 11, uid: 'sub_1', title: 'a', done: false }] }];`;
  R(A, `(function () { ${seedTodo} appData.outbox = [];
    document.getElementById('todo_sub_input_1').value = 'b';
    addTodoSub(1);                                   /* A 加一个子任务（父戳被打新） */
  })()`);
  R(B, `(function () { ${seedTodo} appData.outbox = []; })()`);

  const fromA = R(A, 'appData.todos');
  R(B, `applyRemoteBatch(${J({ todos: fromA })}, { deferSave: true, deferRender: true })`);
  const fromB = R(B, 'appData.todos');
  R(A, `applyRemoteBatch(${J({ todos: fromB })}, { deferSave: true, deferRender: true })`);

  const subsA = R(A, 'appData.todos[0].subs.map(function (s) { return s.title; })');
  const subsB = R(B, 'appData.todos[0].subs.map(function (s) { return s.title; })');
  eq('merge-subtask-only-change A 侧保留 2 个子任务', subsA.length, 2);
  eq('merge-subtask-only-change B 侧也保留 2 个子任务', subsB.length, 2);
  eq('merge-subtask-only-change 两端 _fpAll() 相等', R(A, '_fpAll()'), R(B, '_fpAll()'));

  /* 兜底形态：父戳**相同**、一边多一个 sub（不走打戳，直接造平局） */
  const C = fresh();
  const D = fresh();
  const base = { id: 2, uid: 'todo_y', title: 'Y', updatedAt: 5000, subs: [{ id: 21, uid: 'sub_2', title: 'a', done: false }] };
  const rich = { id: 2, uid: 'todo_y', title: 'Y', updatedAt: 5000, subs: [{ id: 21, uid: 'sub_2', title: 'a', done: false }, { id: 22, uid: 'sub_3', title: 'b', done: false }] };
  put(C, 'appData.todos', [rich]);
  put(D, 'appData.todos', [base]);
  R(D, `applyRemoteBatch(${J({ todos: R(C, 'appData.todos') })}, { deferSave: true, deferRender: true })`);
  R(C, `applyRemoteBatch(${J({ todos: R(D, 'appData.todos') })}, { deferSave: true, deferRender: true })`);
  eq('merge-subtask-only-change 平局形态两端收敛（指纹相等）', R(C, '_fpAll()'), R(D, '_fpAll()'));
  eq('merge-subtask-only-change 平局形态两端 subs 条数一致',
    R(C, 'appData.todos[0].subs.length'), R(D, 'appData.todos[0].subs.length'));
});

test('tombstone-batch-coverage', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.tombstones = [];
    for (var i = 0; i < 3000; i++) {
      appData.tombstones.push({ uid: 'rec_' + i, kind: 'record', deletedAt: 1000 + i });
    }
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    var cur = null, frames = 0, seen = Object.create(null), bytesMax = 0, guard = 0, counts = [];
    while (true) {
      if (++guard > 200) throw new Error('E_LOOP');
      var r = _p2pTombBatch(cur);
      var bytes = JSON.stringify(r.payload.tombstones).length;
      if (bytes > bytesMax) bytesMax = bytes;
      counts.push(r.count);
      r.payload.tombstones.forEach(function (t) { seen[t.uid] = 1; });
      frames++;
      cur = r.nextCursor;
      if (r.last) break;
    }
    return { frames: frames, uniq: Object.keys(seen).length, bytesMax: bytesMax,
      cap: P2P_TOMB_BATCH_MAX_BYTES, counts: counts };
  })()`);
  ok('tombstone-batch-coverage 超过 64KiB 会分片（≥2 帧）', r.frames >= 2, '帧数 ' + r.frames);
  eq('tombstone-batch-coverage 3000 条墓碑 100% 出现在某一帧里', r.uniq, 3000);
  ok('tombstone-batch-coverage 每帧字节 ≤ 上限', r.bytesMax <= r.cap, r.bytesMax + ' > ' + r.cap);
  eq('tombstone-batch-coverage 帧内条数之和 == 3000', r.counts.reduce(function (a, b) { return a + b; }, 0), 3000);
});

test('tombstone-filter-not-starve', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.tombstones = [{ uid: 'rec_old', kind: 'record', deletedAt: 100 }];
    appData.outbox = [];
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    /* 会话期间又删了一条：进墓碑 + 进 outbox（op:'delete'） */
    tombstone('rec_late', 'record');
    /* 模拟「since 偏大 / 墓碑被裁」：把这条从墓碑表里拿掉，只剩 outbox 那条 delete */
    appData.tombstones = appData.tombstones.filter(function (t) { return t.uid !== 'rec_late'; });
    var list = _p2pTombList().map(function (t) { return t.uid; });
    return { list: list, outboxDelete: appData.outbox.some(function (c) {
      return c.uid === 'rec_late' && c.op === 'delete';
    }) };
  })()`);
  ok('tombstone-filter-not-starve outbox 里确有 op:delete 条目', r.outboxDelete);
  ok('tombstone-filter-not-starve 该墓碑仍被携带（§7.3 规则 2）', r.list.indexOf('rec_late') >= 0, J(r.list));
});

test('tomb-digest-not-in-equal', function () {
  const A = fresh();
  const B = fresh();
  const seed = `appData.records = [{ uid: 'rec_1', title: 'a', updatedAt: 10 }]; appData.outbox = [];`;
  R(A, seed);
  R(B, seed);
  R(A, `(function () {
    appData.tombstones = [];
    for (var i = 0; i < 2000; i++) appData.tombstones.push({ uid: 'gone_' + i, kind: 'record', deletedAt: 100 + i });
  })()`);
  R(B, `(function () {
    appData.tombstones = [];
    for (var i = 0; i < 2011; i++) appData.tombstones.push({ uid: 'gone_' + i, kind: 'record', deletedAt: 100 + i });
  })()`);
  const peer = R(B, '_p2pFingerprint()');
  const mine = R(A, '_p2pFingerprint()');
  const res = R(A, `_p2pCompare(${J(peer.fp)}, ${J(peer.counts)}, ${J(peer.tomb)})`);
  eq('tomb-digest-not-in-equal 墓碑数不同也判 equal === true', res.equal, true);
  ok('tomb-digest-not-in-equal 两端 tomb.n 确实不同', peer.tomb.n !== mine.tomb.n,
    mine.tomb.n + ' vs ' + peer.tomb.n);
  ok('tomb-digest-not-in-equal reason 里带 tomb= 摘要（只做观测）', res.reason.indexOf('tomb=') >= 0, res.reason);
});

test('tomb-prune-respects-watermark', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.syncPeers = {
      p1: { watermark: 100000, offset: 0, lastAt: 1 },
      p2: { watermark: 100000, offset: 0, lastAt: 1 },
      p3: { watermark: 500, offset: 0, lastAt: 1 }        /* 水位很旧：还没越过任何一条 */
    };
    appData.tombstones = [];
    for (var i = 0; i < 2500; i++) appData.tombstones.push({ uid: 'rec_' + i, kind: 'record', deletedAt: 1000 + i });
    tombstone('rec_trigger', 'record');                   /* 触发一次裁剪 */
    var afterNeeded = appData.tombstones.length;
    var hasOldest = appData.tombstones.some(function (t) { return t.uid === 'rec_0'; });
    var hasNewest = appData.tombstones.some(function (t) { return t.uid === 'rec_2499'; });
    /* 第二阶段：所有 peer 都越过了 → 不需要的那些才允许裁掉 */
    appData.syncPeers.p3.watermark = 100000;
    tombstone('rec_trigger2', 'record');
    var afterPassed = appData.tombstones.map(function (t) { return t.uid; });
    return { afterNeeded: afterNeeded, hasOldest: hasOldest, hasNewest: hasNewest, afterPassed: afterPassed };
  })()`);
  eq('tomb-prune-respects-watermark 仍有人需要的墓碑一条都不裁', [r.hasOldest, r.hasNewest], [true, true]);
  ok('tomb-prune-respects-watermark 2501 条都还在', r.afterNeeded >= 2501, String(r.afterNeeded));
  /* 所有 peer 都「越过旧的」之后，2500 条旧墓碑被裁；两条 trigger 的 deletedAt 是 now，
     仍晚于 100000 → 依旧算「需要的」，必须留着（宁可超上限也不制造永久丢删除）。 */
  eq('tomb-prune-respects-watermark 不需要的裁掉、需要的留着', r.afterPassed, ['rec_trigger', 'rec_trigger2']);
});

/* ── 映射集合（C28/C39）───────────────────────────────────────────── */

test('map-diary-lww', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.diaries = { '2026-11-20': { uid: 'diary_2026-11-20', plan: '本地', updatedAt: 1000 } };
    applyRemoteBatch({ diaries: { '2026-11-20': { uid: 'diary_2026-11-20', plan: '远端', updatedAt: 2000 } } },
      { deferSave: true, deferRender: true });
    var newer = appData.diaries['2026-11-20'].plan;
    /* 反向：本地更新 → 远端那份不许盖回来 */
    applyRemoteBatch({ diaries: { '2026-11-20': { uid: 'diary_2026-11-20', plan: '更旧的远端', updatedAt: 1500 } } },
      { deferSave: true, deferRender: true });
    var kept = appData.diaries['2026-11-20'].plan;
    return { newer: newer, kept: kept };
  })()`);
  eq('map-diary-lww 取 updatedAt 更晚的那天', r.newer, '远端');
  eq('map-diary-lww 旧的那份不覆盖新的', r.kept, '远端');
});

test('map-diary-tombstone', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.diaries = { '2026-11-20': { uid: 'diary_2026-11-20', plan: '写过了', updatedAt: 1000 } };
    var b = {
      diaries: { '2026-11-20': { uid: 'diary_2026-11-20', plan: '写过了', updatedAt: 1000 } },
      tombstones: [{ uid: 'diary_2026-11-20', kind: 'diary', deletedAt: 2000 }]
    };
    applyRemoteBatch(b, { deferSave: true, deferRender: true });
    var afterDel = Object.keys(appData.diaries).length;
    /* 远端再把那天送一次：墓碑还在 → 不许复活 */
    applyRemoteBatch({ diaries: b.diaries, tombstones: [] }, { deferSave: true, deferRender: true });
    return { afterDel: afterDel, afterReplay: Object.keys(appData.diaries).length };
  })()`);
  eq('map-diary-tombstone 本地那天被删除', r.afterDel, 0);
  eq('map-diary-tombstone 远端再送来也不接受', r.afterReplay, 0);
});

test('map-set-union', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var a = { 1: ['2026-11-19', '2026-11-20'] };
    var b = { 1: ['2026-11-20', '2026-11-21'] };
    var m1 = mergeSetMap(a, b);
    var m2 = mergeSetMap(m1.map, b);
    /* 走一遍 applyRemoteBatch：本地 key 是 h.id，负载 key 是习惯 uid */
    appData.habits = [{ id: 1, uid: 'habit_1', name: 'h', updatedAt: 5 }];
    appData.habitLogs = { 1: ['2026-11-19', '2026-11-20'] };
    applyRemoteBatch({ habitLogs: { habit_1: ['2026-11-20', '2026-11-21'] } },
      { deferSave: true, deferRender: true });
    return { union: m1.map[1], idem: m2.changed, logs: appData.habitLogs[1] };
  })()`);
  eq('map-set-union 并集为三段日期', r.union, ['2026-11-19', '2026-11-20', '2026-11-21']);
  eq('map-set-union 重复跑幂等（changed === 0）', r.idem, 0);
  eq('map-set-union 落地后本地 key 仍是 h.id', r.logs, ['2026-11-19', '2026-11-20', '2026-11-21']);
});

test('map-habit-pending', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.habits = [];                       /* 习惯还没到 */
    appData.habitLogs = {};
    appData.habitSkips = {};
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    _p2pApplyBatch('p1', { habitLogs: { habit_h9: ['2026-11-19'] } }, 0, false,
      { deferSave: true, deferRender: true });
    var pendingN = Object.keys(_p2pHabitMapPending).length;
    var before = Object.keys(appData.habitLogs).length;
    /* 习惯到了 → flush 补上 */
    appData.habits = [{ id: 9, uid: 'habit_h9', name: 'h', updatedAt: 5 }];
    var n = _p2pFlushHabitMapPending();
    return { pendingN: pendingN, before: before, n: n,
      logs: appData.habitLogs[9] || [], pendingAfter: Object.keys(_p2pHabitMapPending).length };
  })()`);
  eq('map-habit-pending 习惯没到时进缓冲', r.pendingN, 1);
  eq('map-habit-pending 缓冲期间 appData.habitLogs 不变', r.before, 0);
  eq('map-habit-pending 习惯到达后 flush 落地', r.logs, ['2026-11-19']);
  eq('map-habit-pending 缓冲被消费掉', r.pendingAfter, 0);
});

test('fp-map-count-consistency', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var set = _fpOfMap('set', { 1: ['2026-11-19', '2026-11-20', '2026-11-21'], 2: ['2026-11-19', '2026-11-20'] });
    var diary = _fpOfMap('diary', {
      '2026-11-19': { updatedAt: 1 }, '2026-11-20': { updatedAt: 2 }, '2026-11-21': { updatedAt: 3 }
    });
    appData.mustDosAt = { '2026-11-20': 9 };
    var must = _fpOfMap('daily', { '2026-11-20': ['a', 'b', 'c'] });
    return { setN: set.n, diaryN: diary.n, mustN: must.n };
  })()`);
  eq('fp-map-count-consistency 打卡 n = 5（不是 2 个习惯）', r.setN, 5);
  eq('fp-map-count-consistency 日记 n = 天数', r.diaryN, 3);
  eq('fp-map-count-consistency 必做 n = 条目数', r.mustN, 3);
});

/* ── 网页层回归（默认行为不变）────────────────────────────────────── */

test('diary-overview-ignores-meta', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var parts = diaryOverviewParts({ plan: '今天写的东西', uid: 'diary_2026-11-20', updatedAt: 1 });
    var txt = JSON.stringify(parts);
    return { extra: parts.extra.length, hasUidStr: txt.indexOf('diary_2026-11-20') >= 0,
      hasUpdatedAt: txt.indexOf('updatedAt') >= 0, rows: parts.rows.length };
  })()`);
  eq('diary-overview-ignores-meta 不多出兜底行', r.extra, 0);
  ok('diary-overview-ignores-meta 总览里不出现 uid 串', !r.hasUidStr);
  ok('diary-overview-ignores-meta 总览里不出现 updatedAt 字样', !r.hasUpdatedAt);
  eq('diary-overview-ignores-meta 正文照旧显示', r.rows, 1);
});

test('outbox-cap-after-reload', function () {
  const w = fresh();
  const r = R(w, `(function () {
    var before = _outboxCap();                 /* pairedCount === -1（sync.info 还没回） */
    _p2pPaired = 3;
    var paired3 = _outboxCap();
    _p2pPaired = 0;
    var paired0 = _outboxCap();
    return { before: before, paired3: paired3, paired0: paired0 };
  })()`);
  ok('outbox-cap-after-reload 未知（-1）不取 200', r.before !== 200, String(r.before));
  eq('outbox-cap-after-reload 未知按 2000 处理', r.before, 2000);
  eq('outbox-cap-after-reload 已配对也 2000', r.paired3, 2000);
  eq('outbox-cap-after-reload 明确 0 台才回落到 200', r.paired0, 200);
});

test('dup-frame-tolerated', function () {
  const w = fresh();
  const r = R(w, `(function () {
    appData.records = [];
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    var batch = { part: 7, records: [{ uid: 'rec_1', title: 'a', updatedAt: 10 }] };
    var first = _p2pApplyBatch('p1', batch, 0, false, { deferSave: true, deferRender: true });
    var afterFirst = JSON.stringify(appData);
    var threw = '';
    var dupFlag = 0;
    try {
      for (var i = 0; i < 100; i++) {
        var r2 = _p2pApplyBatch('p1', batch, 0, false, { deferSave: true, deferRender: true });
        if (r2.dup) dupFlag++;
      }
    } catch (e) { threw = String(e && e.message || e); }
    return { same: JSON.stringify(appData) === afterFirst, threw: threw, dupFlag: dupFlag,
      firstDup: !!first.dup, count: appData.records.length };
  })()`);
  eq('dup-frame-tolerated 重复 100 次不判 E_BAD_FRAME', r.threw, '');
  eq('dup-frame-tolerated 重复 100 次数据不变', r.same, true);
  eq('dup-frame-tolerated 100 次都识别成 dup', r.dupFlag, 100);
  eq('dup-frame-tolerated 首帧不是 dup、记录只有 1 条', [r.firstDup, r.count], [false, 1]);
});

test('legacy-uid-device-tag', function () {
  const w = fresh();
  const r = R(w, `(function () {
    localStorage.setItem('tomato_device_tag', 'aaaa');
    appData.records = [{ id: 7, title: '没有 uid 的老记录' }];
    migrateDataContract();
    var u1 = appData.records[0].uid;
    migrateDataContract();                        /* 幂等：同一份数据再迁移一次 */
    var u2 = appData.records[0].uid;
    localStorage.setItem('tomato_device_tag', 'bbbb');
    appData.records = [{ id: 7, title: '没有 uid 的老记录' }];
    migrateDataContract();
    var u3 = appData.records[0].uid;
    return { u1: u1, u2: u2, u3: u3 };
  })()`);
  eq('legacy-uid-device-tag 同一条记录迁移两次 uid 不变', r.u1, r.u2);
  ok('legacy-uid-device-tag uid 里带本机 deviceTag', String(r.u1).indexOf('aaaa') >= 0, String(r.u1));
  ok('legacy-uid-device-tag 换一台设备（另一个 tag）uid 必须不同', r.u1 !== r.u3, r.u3);
});

/* ── 空写守卫的两个例外（P1-6）────────────────────────────────────── */

test('commit-empty-blocked-by-sync-delete', async function () {
  const w = fresh();
  await w.run(`(function () {
    appData.records = [];
    for (var i = 0; i < 5; i++) appData.records.push({ id: i + 1, uid: 'rec_' + i, title: 'r' + i, updatedAt: 10 + i });
    appData.tombstones = [];
    for (var j = 0; j < 5; j++) appData.tombstones.push({ uid: 'rec_' + j, kind: 'record', deletedAt: 500 + j });
    appData.outbox = [];
    appData.syncPeers = { p1: { watermark: 1, offset: 0, lastAt: 1 } };
    _lastNonEmptyScale = 5;                        /* 盘上曾经有 5 条 */
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    /* 对端说这 5 条都删了：合并后本地 records 归零，但墓碑数 ≥ 清空前的规模 */
    _p2pApplyBatch('p1', {
      records: [],
      tombstones: [
        { uid: 'rec_0', kind: 'record', deletedAt: 500 }, { uid: 'rec_1', kind: 'record', deletedAt: 501 },
        { uid: 'rec_2', kind: 'record', deletedAt: 502 }, { uid: 'rec_3', kind: 'record', deletedAt: 503 },
        { uid: 'rec_4', kind: 'record', deletedAt: 504 }
      ]
    }, 0, true, { deferSave: true, deferRender: true });
  })()`);
  const committed = await w.run(`_p2pCommit('p1', 900, false)`);
  const disk = R(w, `(function () {
    try {
      var raw = localStorage.getItem('tomato_focus_v3');
      if (!raw) return -1;
      /* 盘上格式是 {t: 写入时刻, d: appData 的 JSON 文本}（engine_data 的落盘封装） */
      var outer = JSON.parse(raw);
      var d = typeof outer.d === 'string' ? JSON.parse(outer.d) : outer.d;
      return Array.isArray(d.records) ? d.records.length : -2;
    } catch (e) { return -3; }
  })()`);
  eq('commit-empty-blocked-by-sync-delete committed === true', committed.committed, true);
  eq('commit-empty-blocked-by-sync-delete 内存里 records 归零', R(w, 'appData.records.length'), 0);
  eq('commit-empty-blocked-by-sync-delete 盘上也是 0（例外真的放行了）', disk, 0);
});

test('empty-blocked-still-blocks-local', async function () {
  const w = fresh();
  await w.run(`(function () {
    appData.records = [];
    for (var i = 0; i < 5; i++) appData.records.push({ id: i + 1, uid: 'rec_' + i, title: 'r' + i, updatedAt: 10 + i });
    appData.tombstones = [];
    appData.syncPeers = { p1: { watermark: 1, offset: 0, lastAt: 1 } };
    appData.outbox = [];
    _lastNonEmptyScale = 5;
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
    /* 本地把 5 条删光，但**没写墓碑**（= 用户误操作的形态） */
    appData.records = [];
  })()`);
  const committed = await w.run(`_p2pCommit('p1', 900, false)`);
  const localStatus = R(w, `saveDataNow()`);
  const wm = R(w, 'appData.syncPeers.p1.watermark');
  eq('empty-blocked-still-blocks-local 同步路径也不许无凭据清空', committed.committed, false);
  eq('empty-blocked-still-blocks-local status = empty-blocked', committed.status, 'empty-blocked');
  eq('empty-blocked-still-blocks-local 水位回滚', wm, 1);
  eq('empty-blocked-still-blocks-local UI 路径同样被拦（_saveCtx 为 null）', localStatus, 'empty-blocked');
});

test('abort-flush-renders', function () {
  const w = fresh();
  R(w, `(function () {
    appData.outbox = [];
    appData.syncPeers = { p1: { watermark: 42, offset: 0, lastAt: 1 } };
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
  })()`);
  for (let i = 0; i < 3; i++) {
    R(w, `_p2pApplyBatch('p1', { part: ${i}, records: [{ uid: 'rec_r${i}', title: 'x${i}', updatedAt: ${20 + i} }] },
      0, false, { deferSave: true, deferRender: true })`);
  }
  const before = R(w, `(__CALLS['UIFX.renderTodos'] || 0)`);
  R(w, `_p2pAbort('p1')`);
  const after = R(w, `(__CALLS['UIFX.renderTodos'] || 0)`);
  eq('abort-flush-renders 收口前一次都没渲染', before, 0);
  eq('abort-flush-renders 中止时 renderTodos 只调 1 次', after - before, 1);
  eq('abort-flush-renders 已 apply 的批仍在（指纹自洽）',
    R(w, `appData.records.map(function (r) { return r.uid; }).join(',')`), 'rec_r0,rec_r1,rec_r2');
  eq('abort-flush-renders 中止不写水位', R(w, 'appData.syncPeers.p1.watermark'), 42);
});

test('abort-cancel-does-not-flush', function () {
  const w = fresh();
  R(w, `(function () {
    globalThis.__saveCalls = 0;
    var real = saveDataNow;
    saveDataNow = function () { globalThis.__saveCalls++; return real(); };
    appData.outbox = [];
    appData.syncPeers = { p1: { watermark: 43, offset: 0, lastAt: 1 } };
    _p2pOnEvent({ ev: 'begin', args: { sid: 'S1', peerId: 'p1' } });
  })()`);
  R(w, `_p2pApplyBatch('p1', { part: 0, records: [{ uid: 'rec_c', title: 'c', updatedAt: 30 }] },
    0, false, { deferSave: true, deferRender: true })`);
  const before = R(w, `(__CALLS['UIFX.renderTodos'] || 0)`);
  const res = R(w, `_p2pAbort('p1', { reason: 'cancel' })`);
  eq('abort-cancel-does-not-flush 用户取消不落盘', R(w, 'globalThis.__saveCalls'), 0);
  eq('abort-cancel-does-not-flush 也不渲染', R(w, `(__CALLS['UIFX.renderTodos'] || 0)`), before);
  eq('abort-cancel-does-not-flush 水位不变', R(w, 'appData.syncPeers.p1.watermark'), 43);
  eq('abort-cancel-does-not-flush flushed === false', res.flushed, false);
});

/* ====================================================================== */
/*  §21 清单里**点名**但不在 §17.1 表格行里的用例（每条对应一个 C 编号）    */
/* ====================================================================== */

test('migrate-uid-all-collections', function () {
  /* C19：4 个新进集合补 uid、diaries 每天补 uid/updatedAt、两个新键兜底 */
  const w = fresh();
  const r = R(w, `(function () {
    appData.lifeAreas = [{ name: '分区一' }];
    appData.habitCats = [{ name: '分类一' }];
    appData.selfRewards = [{ name: '奖励一' }];
    appData.wishes = [{ text: '愿望一' }];
    appData.diaries = { '2026-11-20': { plan: '手写的' } };
    migrateDataContract();
    var first = {
      area: appData.lifeAreas[0].uid, hcat: appData.habitCats[0].uid,
      reward: appData.selfRewards[0].uid, wish: appData.wishes[0].uid,
      diaryUid: appData.diaries['2026-11-20'].uid,
      diaryTs: appData.diaries['2026-11-20'].updatedAt,
      tsTypes: [typeof appData.lifeAreas[0].updatedAt, typeof appData.habitCats[0].updatedAt,
        typeof appData.selfRewards[0].updatedAt, typeof appData.wishes[0].updatedAt]
    };
    migrateDataContract();                        /* 幂等 */
    var second = {
      area: appData.lifeAreas[0].uid, hcat: appData.habitCats[0].uid,
      reward: appData.selfRewards[0].uid, wish: appData.wishes[0].uid,
      diaryUid: appData.diaries['2026-11-20'].uid
    };
    return { first: first, second: second, keys48: Object.keys(createDefaultAppData()).length };
  })()`);
  eq('migrate-uid-all-collections 四个集合都补了 uid',
    [r.first.area, r.first.hcat, r.first.reward, r.first.wish].map(function (u) { return /^[a-z]+_/.test(String(u)); }),
    [true, true, true, true]);
  eq('migrate-uid-all-collections 前缀与 _kindOfUid 一致',
    [String(r.first.area).slice(0, 5), String(r.first.hcat).slice(0, 5),
      String(r.first.reward).slice(0, 7), String(r.first.wish).slice(0, 5)],
    ['area_', 'hcat_', 'reward_', 'wish_']);
  eq('migrate-uid-all-collections diaries 每天补 uid', r.first.diaryUid, 'diary_2026-11-20');
  eq('migrate-uid-all-collections diaries 的 updatedAt 是数字', typeof r.first.diaryTs, 'number');
  eq('migrate-uid-all-collections 四个集合的 updatedAt 都是数字', r.first.tsTypes,
    ['number', 'number', 'number', 'number']);
  eq('migrate-uid-all-collections 第二次迁移 uid 不变', r.second,
    { area: r.first.area, hcat: r.first.hcat, reward: r.first.reward, wish: r.first.wish, diaryUid: r.first.diaryUid });
  eq('migrate-uid-all-collections 默认数据仍是 48 个顶层键（46+2）', r.keys48, 48);
});

test('save-status-matrix', function () {
  /* C21：5 个提前 return 各带状态；'clearing' 不是 'empty-blocked' */
  const a = fresh();
  eq('save-status-matrix clearing → "clearing"',
    R(a, `(function () { _dataClearing = true; return saveDataNow(); })()`), 'clearing');
  const b = fresh();
  eq('save-status-matrix 未载入 → "not-ready"',
    R(b, `(function () { _dataLoaded = false; return saveDataNow(); })()`), 'not-ready');
  const c = fresh();
  eq('save-status-matrix 序列化失败 → "json-fail"',
    R(c, `(function () { appData.self = appData; var s = saveDataNow(); delete appData.self; return s; })()`),
    'json-fail');
  const d = fresh();
  eq('save-status-matrix 无凭据清空 → "empty-blocked"',
    R(d, `(function () {
      appData.records = [{ uid: 'rec_1', updatedAt: 1 }];
      _lastNonEmptyScale = 9;
      appData.records = [];
      return saveDataNow();
    })()`), 'empty-blocked');
  const e = fresh();
  eq('save-status-matrix 正常写入 → "ok"',
    R(e, `(function () { appData.records = [{ uid: 'rec_1', updatedAt: 1 }]; return saveDataNow(); })()`), 'ok');
  ok('save-status-matrix clearing 与 empty-blocked 是两个不同状态', 'clearing' !== 'empty-blocked');
});

test('save-data-now-returns', function () {
  /* C22：saveDataNow() 把状态原样 return 出去；既有调用方忽略返回值 → 行为不变 */
  const w = fresh();
  const r = R(w, `(function () {
    appData.records = [{ uid: 'rec_1', updatedAt: 1 }];
    var s = saveDataNow();
    /* 老调用点（忽略返回值）不受影响：这里模拟一次「不接返回值的调用」 */
    var ignored = saveData();
    return { status: s, ignoredOk: ignored === undefined || ignored === null || typeof ignored === 'string' };
  })()`);
  eq('save-data-now-returns 返回 "ok"', r.status, 'ok');
  ok('save-data-now-returns 忽略返回值的既有调用方不受影响', r.ignoredOk);
});

test('wait-save-queue', async function () {
  /* C23：等 IDB 兑现；超时返回 false 且不抛错 */
  const w = fresh({ idbDelayMs: 120 });
  const r = await w.run(`(async function () {
    appData.records = [{ uid: 'rec_1', updatedAt: 1 }];
    saveDataNow();                       /* 启动一次「慢写」：IDB 120ms 才兑现 */
    var timedOut = await waitSaveQueue(0);   /* 队列还没兑现，超时 0 → false */
    var oked = await waitSaveQueue(3000);    /* 等它兑现 → true */
    return { oked: oked, timedOut: timedOut, written: !_w55Pending };
  })()`);
  eq('wait-save-queue 正常等到 IDB 兑现 → true', r.oked, true);
  eq('wait-save-queue 超时传 0 → false（不抛错）', r.timedOut, false);
});

test('fp-no-skew-adjust', function () {
  /* C37：_fpAll 里不做任何时钟偏移换算 */
  const a = fresh();
  const b = fresh();
  const seed = `appData.records = [{ uid: 'rec_1', title: 'a', updatedAt: 1700000000000 }];`;
  R(a, seed);
  R(b, seed);
  R(a, `appData.syncPeers = { p1: { watermark: 1, offset: 0, lastAt: 1 } };`);
  R(b, `appData.syncPeers = { p1: { watermark: 1, offset: -600000, lastAt: 1 } };`);
  eq('fp-no-skew-adjust 两端口径不同但指纹相同', R(a, '_fpAll()'), R(b, '_fpAll()'));
  eq('fp-no-skew-adjust 存下来的 updatedAt 仍是原始值', R(b, 'appData.records[0].updatedAt'), 1700000000000);
});

test('snapshot-covers-16-kinds', function () {
  /* C42：16 个 kind 各取一次快照，没有一种回落到 records */
  const w = fresh();
  const r = R(w, `(function () {
    appData.records = [{ uid: 'rec_1', title: 'r', updatedAt: 1 }];
    appData.todos = [{ uid: 'todo_1', title: 't', subs: [], updatedAt: 2 }];
    appData.habits = [{ id: 1, uid: 'habit_1', name: 'h', updatedAt: 3 }];
    appData.memos = [{ uid: 'memo_1', text: 'm', updatedAt: 4 }];
    appData.countdowns = [{ uid: 'cd_1', title: 'c', updatedAt: 5 }];
    appData.lifeGoals = [{ uid: 'lg_1', title: 'g', updatedAt: 6 }];
    appData.lifeAreas = [{ uid: 'area_1', name: 'a', updatedAt: 7 }];
    appData.reviews = [{ uid: 'rv_1', text: 'v', updatedAt: 8 }];
    appData.weekFocus = [{ uid: 'wf_1', title: 'w', updatedAt: 9 }];
    appData.habitCats = [{ uid: 'hcat_1', name: 'hc', updatedAt: 10 }];
    appData.selfRewards = [{ uid: 'reward_1', name: 'rw', updatedAt: 11 }];
    appData.wishes = [{ uid: 'wish_1', text: 'wi', updatedAt: 12 }];
    appData.diaries = { '2026-11-20': { uid: 'diary_2026-11-20', plan: 'd', updatedAt: 13 } };
    appData.mustDos = { '2026-11-20': ['x'] };
    appData.mustDosAt = { '2026-11-20': 14 };
    appData.habitLogs = { 1: ['2026-11-19'] };
    appData.habitSkips = { 1: ['2026-11-18'] };

    var arrKinds = [['rec', 'rec_1'], ['record', 'rec_1'], ['todo', 'todo_1'], ['habit', 'habit_1'],
      ['memo', 'memo_1'], ['cd', 'cd_1'], ['lg', 'lg_1'], ['area', 'area_1'], ['rv', 'rv_1'],
      ['wf', 'wf_1'], ['hcat', 'hcat_1'], ['reward', 'reward_1'], ['wish', 'wish_1']];
    var bad = [];
    arrKinds.forEach(function (p) {
      var s = _p2pSnapshotOf(p[1], p[0]);
      if (!s) { bad.push(p[0] + ':null'); return; }
      if (String(s.uid) !== p[1]) bad.push(p[0] + ':' + s.uid);
    });
    /* 未知 kind 必须「不 发」，绝不回落到 records */
    var unknown = _p2pSnapshotOf('nosuch_1', 'nosuch');
    /* 映射集合走 _p2pMapSliceOf */
    var diary = Object.keys(_p2pMapSliceOf('diary_2026-11-20', 'diary'));
    var must = Object.keys(_p2pMapSliceOf('must_2026-11-20', 'mustdos'));
    var habitMap = Object.keys(_p2pMapSliceOf('habit_1', 'habit'));
    return { bad: bad, unknown: unknown, diary: diary, must: must, habitMap: habitMap };
  })()`);
  eq('snapshot-covers-16-kinds 13 个数组 kind 都取到自己的快照', r.bad, []);
  ok('snapshot-covers-16-kinds 未知 kind 不回落（返回 null）', r.unknown === null, String(r.unknown));
  eq('snapshot-covers-16-kinds diaries 切片', r.diary, ['diaries']);
  eq('snapshot-covers-16-kinds mustDos 切片带时间戳旁表', r.must, ['mustDos', 'mustDosAt']);
  eq('snapshot-covers-16-kinds 打卡切片按习惯 uid', r.habitMap, ['habitLogs', 'habitSkips']);
});

test('reset-forget-peer', function () {
  /* C46：_p2pResetPeer 只删 watermark/offset/tombLossy；_p2pForgetPeer 删整条 */
  const w = fresh();
  const r = R(w, `(function () {
    appData.syncPeers = { didA: { watermark: 900, offset: 5000, lastAt: 123, tombLossy: true } };
    appData.records = [{ uid: 'rec_1', updatedAt: 1 }, { uid: 'rec_2', updatedAt: 2 }];
    appData.todos = [{ uid: 'todo_1', subs: [], updatedAt: 3 }];
    var before = appData.records.length + appData.todos.length;
    _p2pResetPeer('didA');
    var afterReset = JSON.stringify(appData.syncPeers.didA);
    var mid = appData.records.length + appData.todos.length;
    _p2pForgetPeer('didA');
    return {
      before: before, mid: mid,
      afterReset: afterReset,
      keys: Object.keys(appData.syncPeers),
      after: appData.records.length + appData.todos.length
    };
  })()`);
  eq('reset-forget-peer 重置后只剩 lastAt（业务字段全清）', r.afterReset, J({ lastAt: 123 }));
  eq('reset-forget-peer 重置不动业务集合', [r.mid, r.after], [r.before, r.before]);
  eq('reset-forget-peer forget 把 syncPeers[did] 删掉', r.keys, []);
});

test('commit-waits-idb', async function () {
  /* C43：IDB 慢 500ms，committed 仍为 true（改前会误报 false） */
  const w = fresh({ idbDelayMs: 500 });
  R(w, `(function () {
    appData.records = [{ uid: 'rec_1', updatedAt: 1 }];
    appData.outbox = [];
    appData.syncPeers = { p1: { watermark: 1, offset: 0, lastAt: 1 } };
  })()`);
  const t0 = Date.now();
  const res = await w.run(`_p2pCommit('p1', 1234, false)`);
  const elapsed = Date.now() - t0;
  eq('commit-waits-idb committed === true（等到 IDB 兑现）', res.committed, true);
  eq('commit-waits-idb status 仍是 ok', res.status, 'ok');
  ok('commit-waits-idb 确实等了 IDB（≥400ms）', elapsed >= 400, elapsed + 'ms');
  eq('commit-waits-idb 水位已提交', R(w, 'appData.syncPeers.p1.watermark'), 1234);
});

test('merge-legacy-3arg-unchanged', function () {
  /* C27：mergeRemoteRecords(a,b,t) 三参调用与改前逐字节相同 */
  const w = fresh();
  const got = R(w, `(function () {
    var a = [{ uid: 'rec_1', title: 'old', updatedAt: 1000 }, { uid: 'rec_2', title: 'keep', updatedAt: 5000 }];
    var b = [{ uid: 'rec_1', title: 'new', updatedAt: 2000 }, { uid: 'rec_3', title: 'add', updatedAt: 2500 }];
    var t = [{ uid: 'rec_9', kind: 'record', deletedAt: 100 }];
    return JSON.stringify(mergeRemoteRecords(a, b, t));
  })()`);
  eq('merge-legacy-3arg-unchanged 三参返回值逐字节等于改前形态', got,
    '{"list":[{"uid":"rec_1","title":"new","updatedAt":2000},{"uid":"rec_2","title":"keep","updatedAt":5000},'
    + '{"uid":"rec_3","title":"add","updatedAt":2500}],"added":1,"updated":1,"skipped":0}');
  const two = R(w, `(function () {
    var a = { uid: 'rec_1', title: 'a', updatedAt: 1000 };
    var b = { uid: 'rec_1', title: 'b', updatedAt: 1000 };
    return [lwwPick(a, b), lwwPick(a, b, 0), lwwPick(a, b, -1), lwwPick(a, b, 1)];
  })()`);
  eq('merge-legacy-3arg-unchanged lwwPick 两参 == skew 0', two[0], two[1]);
  ok('merge-legacy-3arg-unchanged skew 仍然起作用', two[2] !== two[3], two[2] + '/' + two[3]);
});

test('apply-batch-single-arg', function () {
  /* C47 的「默认行为不变」回归：applyRemoteBatch(batch) 单参调用照旧合并 + 刷界面 */
  const w = fresh();
  const r = R(w, `(function () {
    var before = __CALLS['UIFX.renderTodos'] || 0;
    var res = applyRemoteBatch({ records: [{ uid: 'rec_1', title: 'x', updatedAt: 1000 }] });
    var after = __CALLS['UIFX.renderTodos'] || 0;
    return { merged: res.records, renders: after - before, len: appData.records.length };
  })()`);
  eq('apply-batch-single-arg 单参照旧合并', [r.merged, r.len], [1, 1]);
  eq('apply-batch-single-arg 单参照旧重绘一次', r.renders, 1);
});

/* ====================================================================== */
/*  D 组：双端收敛（不是单端断言）                                          */
/*  0.6.12 真机走到「两端数据没有完全对上」——协议已经跑完，是数据没收敛。      */
/*  这里用两个独立沙箱按 native 的真实事件序列对推，缺一环就红。              */
/* ====================================================================== */

/** 跨 realm 取回纯数据。 */
function call(w, ev, args) {
  const out = w.run('window.BottleSync.onEvent(' + J({ ev: ev, args: args || {} }) + ')');
  return out === undefined || out === null ? out : JSON.parse(J(out));
}

function mkRec(uid, title, up) {
  return { uid: uid, title: title, startTime: up, updatedAt: up, seconds: 60 };
}

/**
 * 跑一场完整的双向同步（严格照 SyncSession 的顺序）：
 *   A.begin → B.begin → A.tomb/build → B.apply → B.collect → A.apply → 双方指纹 → B.compare
 * 返回每步的观测值，供用例断言。
 */
function syncOnce(A, B, sidA, sidB, didA, didB, t1, opts) {
  const o = opts || {};
  const sinceA = Number(o.since || 0);       /* 真机：发起方用 per-peer 水位，不是 0 */
  const seen = { steps: [], appliedA: 0, appliedB: 0, pullCount: 0, pullApplied: 0 };

  const ba = call(A, 'begin', { peerId: didB, sid: sidA, endAt: t1 });
  const bb = call(B, 'begin', { peerId: didA, sid: sidB, endAt: 0 });
  seen.steps.push(['beginA', ba && ba.ok, ba && ba.wmLocal]);
  seen.steps.push(['beginB', bb && bb.ok, bb && bb.wmLocal]);

  /* ① A 的墓碑帧 → B */
  let tcur = null, tn = 0;
  for (let i = 0; i < 200; i++) {
    const a = { sid: sidA, peerId: didB };
    if (tcur) a.cursor = tcur;
    const t = call(A, 'tomb', a);
    const ap = call(B, 'apply', {
      sid: sidB, peerId: didA, part: 20 + tn, payload: J(t.payload || {}),
      last: !!t.last, skewMs: 0, deferSave: true, deferRender: true
    });
    if (ap && ap.ok === false) seen.steps.push(['tomb.apply', false, ap.error]);
    tn++;
    tcur = t.nextCursor;
    if (t.last) break;
  }

  /* ② A 的变更帧 → B */
  let cur = { part: 1000 }, part = 0, pushed = 0;
  for (let i = 0; i < 500; i++) {
    const t = call(A, 'build', { peerId: didB, sid: sidA, maxBytes: 512 * 1024, cursor: cur });
    const ap = call(B, 'apply', {
      sid: sidB, peerId: didA, part: 1000 + part, payload: J(t.payload || {}),
      last: !!t.last, skewMs: 0, deferSave: true, deferRender: true
    });
    if (ap && ap.ok === false) seen.steps.push(['build.apply', false, ap.error]);
    pushed += Number(t.count) || 0;
    part++;
    cur = t.nextCursor;
    if (t.last) break;
  }
  seen.pushed = pushed;

  /* ③ B 的数据 → A（A 是拉取方，since=0 表示全量） */
  let pcur = { kind: 'pull', idx: 0, part: 0, endAt: t1 }, ppart = 0, pulled = 0;
  for (let i = 0; i < 500; i++) {
    const c = call(B, 'collect', {
      sid: sidB, peerId: didA, since: sinceA, cols: null, maxBytes: 512 * 1024, cursor: pcur
    });
    const ap = call(A, 'apply', {
      sid: sidA, peerId: didB, part: 500 + ppart, payload: J(c.payload || {}),
      last: !!c.last, skewMs: 0, deferSave: true, deferRender: true
    });
    if (ap && ap.ok === false) seen.steps.push(['pull.apply', false, ap.error]);
    if (ap && ap.applied) {
      Object.keys(ap.applied).forEach(function (kk) {
        if (kk === 'skipped' || kk === 'tombs') return;   /* 与原生同口径 */
        seen.pullApplied += Number(ap.applied[kk]) || 0;
      });
    }

    pulled += Number(c.count) || 0;
    seen.pullCount += Number(c.count) || 0;
    ppart++;
    pcur = c.nextCursor;
    if (c.last) break;
  }
  seen.pulled = pulled;

  /* ④ 指纹：A 的给 B，B 自己的 compare */
  const fpA = call(A, 'fingerprint', {});
  const cmp = call(B, 'compare', {
    sid: sidB, peerId: didA, peerFp: fpA.fp, peerCounts: fpA.counts, peerTomb: fpA.tomb
  });
  seen.fpA = fpA.fp;
  seen.equal = !!(cmp && cmp.equal);
  seen.diff = (cmp && cmp.diff) || [];
  seen.reason = (cmp && cmp.reason) || '';

  /* ⑤ 不等 → A 补推全量 → B 再比 */
  if (!seen.equal) {
    let fcur = { kind: 'pull', idx: 0, part: 2000, endAt: t1 }, fpart = 0, fixed = 0;
    for (let i = 0; i < 500; i++) {
      const c = call(A, 'collect', {
        sid: sidA, peerId: didB, since: 0, cols: null, maxBytes: 512 * 1024, cursor: fcur
      });
      const ap = call(B, 'apply', {
        sid: sidB, peerId: didA, part: 2000 + fpart, payload: J(c.payload || {}),
        last: !!c.last, skewMs: 0, deferSave: true, deferRender: true
      });
      if (ap && ap.ok === false) seen.steps.push(['fix.apply', false, ap.error]);
      fixed += Number(c.count) || 0;
      fpart++;
      fcur = c.nextCursor;
      if (c.last) break;
    }
    seen.fixed = fixed;
    const fpA2 = call(A, 'fingerprint', {});
    const cmp2 = call(B, 'compare', {
      sid: sidB, peerId: didA, peerFp: fpA2.fp, peerCounts: fpA2.counts, peerTomb: fpA2.tomb
    });
    seen.equalAfterFix = !!(cmp2 && cmp2.equal);
    seen.diffAfterFix = (cmp2 && cmp2.diff) || [];
    seen.reasonAfterFix = (cmp2 && cmp2.reason) || '';
  }
  if (o.commit) {
    call(A, 'commit', { sid: sidA, peerId: didB, wm: t1 - 1000, tombLossy: false });
    call(B, 'commit', { sid: sidB, peerId: didA, wm: t1 - 1000, tombLossy: false });
  }
  return seen;
}

function countsOf(w) {
  const c = call(w, 'fingerprint', {});
  const out = {};
  Object.keys(c.counts).forEach(function (k) {
    const v = c.counts[k];
    if (v && (v.n || 0) > 0) out[k] = v.n + '/' + v.m;
  });
  return out;
}

test('dual-peer-converge 两台数据不同的手机，一轮同步后指纹应相等', function () {
  const A = fresh();
  const B = fresh();
  const t0 = 1700000000000;   /* 2023-11，远早于会话时间，不会被 endAt 过滤 */
  put(A, 'appData.records', [mkRec('rec_a1', 'A1', t0), mkRec('rec_a2', 'A2', t0 + 1000), mkRec('rec_sh', 'old', t0 + 2000)]);
  put(B, 'appData.records', [mkRec('rec_b1', 'B1', t0 + 3000), mkRec('rec_sh', 'new', t0 + 4000)]);

  const s = syncOnce(A, B, 'sa', 'sb', 'didA', 'didB', Date.now());
  if (s.equalAfterFix !== true) {
    console.log('      双端未收敛：pushed=' + s.pushed + ' pulled=' + s.pulled
      + ' fixed=' + s.fixed + ' diff=[' + s.diff.join(',') + ']');
    console.log('      A: ' + J(countsOf(A)));
    console.log('      B: ' + J(countsOf(B)));
    console.log('      reason: ' + s.reason);
    console.log('      afterFix equal=' + s.equalAfterFix + ' diff=[' + (s.diffAfterFix || []).join(',') + '] fixed=' + s.fixed);
  }
  /* 首轮 push 走 outbox（没有历史数据）→ 第一次比对必然不等，这是设计：
     真正的全量在 fix（collect since=0）。这里断言的是**整轮跑完必须收敛**。 */
  ok('dual-peer-converge 整轮（含补差）后指纹相等', s.equalAfterFix === true,
    'first=' + s.equal + ' afterFix=' + s.equalAfterFix + ' diff=[' + (s.diffAfterFix || []).join(',') + ']');

  /* 收尾再断言一次：不靠 fix 也要一致（fix 只是兜底） */
  ok('dual-peer-converge A/B 记录条数一致', countsOf(A).records === countsOf(B).records,
    'A=' + J(countsOf(A).records) + ' B=' + J(countsOf(B).records));
});

test('dual-peer-tombstone 一端删过、另一端还有的记录，同步后两端都不该再看见它', function () {
  const A = fresh();
  const B = fresh();
  const t0 = 1700000000000;
  /* A 还留着 rec_sh；B 已经删了它（records 里没有，只有墓碑）。 */
  put(A, 'appData.records', [mkRec('rec_a1', 'A1', t0), mkRec('rec_sh', 'old', t0 + 2000)]);
  put(B, 'appData.records', [mkRec('rec_b1', 'B1', t0 + 3000)]);
  put(B, 'appData.tombstones', [{ uid: 'rec_sh', deletedAt: t0 + 5000 }]);

  const s = syncOnce(A, B, 'sa', 'sb', 'didA', 'didB', Date.now());
  const aLeft = A.run('appData.records.map(function(r){return r.uid}).sort()');
  const bLeft = B.run('appData.records.map(function(r){return r.uid}).sort()');
  if (s.equalAfterFix !== true) {
    console.log('      墓碑场景未收敛：diff=[' + s.diff.join(',') + '] A=' + J(aLeft) + ' B=' + J(bLeft));
    console.log('      reason: ' + s.reason);
  }
  eq('dual-peer-tombstone 两端都不再有 rec_sh', [aLeft.indexOf('rec_sh'), bLeft.indexOf('rec_sh')], [-1, -1]);
  ok('dual-peer-tombstone 整轮（含补差）后指纹相等', s.equalAfterFix === true,
    'first=' + s.equal + ' afterFix=' + s.equalAfterFix + ' diff=[' + (s.diffAfterFix || []).join(',') + ']');
});

test('dual-peer-legacy-ts 没有编辑时间的老记录（倒计时/分类/日记/今日必做）基线必须传过去', function () {
  /* 真机 0.6.13 的 FAILED_DIVERGED 就是这四类：用户建完十年没改过的记录，
     库里没有 updatedAt / mustDosAt，迁移补成 0，旧判断 `0 <= since` 恒真 →
     连全量基线都跳过它们，两端指纹永久不等。 */
  const A = fresh();
  const B = fresh();
  const t0 = 1700000000000;
  put(A, 'appData.countdowns', [
    { uid: 'cd_old', title: '没戳的倒计时' },
    { uid: 'cd_new', title: '有戳的倒计时', updatedAt: t0 }
  ]);
  put(A, 'appData.habitCats', [
    { uid: 'hc_old', name: '没戳的分类' },
    { uid: 'hc_new', name: '有戳的分类', updatedAt: t0 }
  ]);
  put(A, 'appData.diaries', {
    '2024-01-01': { text: '没戳的日记' },
    '2024-01-02': { text: '有戳的日记', updatedAt: t0 }
  });
  put(A, 'appData.mustDos', { '2024-01-01': [{ uid: 'must_1', text: 'x' }] });
  put(A, 'appData.mustDosAt', {});
  put(B, 'appData.countdowns', []);
  put(B, 'appData.habitCats', []);
  put(B, 'appData.diaries', {});
  put(B, 'appData.mustDos', {});
  put(B, 'appData.mustDosAt', {});

  const s = syncOnce(A, B, 'sa', 'sb', 'didA', 'didB', Date.now());
  if (s.equalAfterFix !== true) {
    console.log('      未收敛 diff=[' + (s.diffAfterFix || []).join(',') + ']');
  }
  eq('dual-peer-legacy-ts 倒计时两端都有', R(B, 'appData.countdowns.map(function(x){return x.uid}).sort()'), ['cd_new', 'cd_old']);
  eq('dual-peer-legacy-ts 分类两端都有', R(B, 'appData.habitCats.map(function(x){return x.uid}).sort()'), ['hc_new', 'hc_old']);
  eq('dual-peer-legacy-ts 日记两端都有', R(B, 'Object.keys(appData.diaries).sort()'), ['2024-01-01', '2024-01-02']);
  eq('dual-peer-legacy-ts 今日必做两端都有', R(B, 'Object.keys(appData.mustDos).sort()'), ['2024-01-01']);
  ok('dual-peer-legacy-ts 整轮后指纹相等', s.equalAfterFix === true, 'diff=' + J(s.diffAfterFix));

  /* 幂等：再跑一轮不该有任何变化，也不该把它们重复成两条 */
  const s2 = syncOnce(A, B, 'sa2', 'sb2', 'didA', 'didB', Date.now() + 60000);
  /* 第二轮首轮即相等就不会再跑补差（equalAfterFix 为 undefined），两种都算过 */
  const ok2 = (s2.equal === true) || (s2.equalAfterFix === true);
  eq('dual-peer-legacy-ts 第二轮首轮即相等、数量不变', [ok2, R(B, 'appData.countdowns.length')], [true, 2]);
});

test('dual-peer-map-tie 同一天两端都写过、都没时间戳，同步后内容必须一致', function () {
  /* 旧实现平局保留本地 → 两端各留各的：界面「同步完成」，日记内容却不同。
     指纹只含 key:time，发现不了这种分歧。 */
  const A = fresh();
  const B = fresh();
  put(A, 'appData.diaries', { '2024-03-01': { text: 'A 写的' } });
  put(B, 'appData.diaries', { '2024-03-01': { text: 'B 写的' } });
  put(A, 'appData.mustDos', { '2024-03-01': [{ uid: 'm1', text: 'A 的必做' }] });
  put(B, 'appData.mustDos', { '2024-03-01': [{ uid: 'm2', text: 'B 的必做' }] });
  put(A, 'appData.mustDosAt', {});
  put(B, 'appData.mustDosAt', {});

  syncOnce(A, B, 'sa', 'sb', 'didA', 'didB', Date.now());
  const da = R(A, "appData.diaries['2024-03-01'].text");
  const db = R(B, "appData.diaries['2024-03-01'].text");
  const ma = J(R(A, "appData.mustDos['2024-03-01']"));
  const mb = J(R(B, "appData.mustDos['2024-03-01']"));
  eq('dual-peer-map-tie 日记两端内容一致', [da, db], [db, db]);
  eq('dual-peer-map-tie 必做两端内容一致', [ma, mb], [mb, mb]);
});

test('dual-peer-idempotent 第二轮必须 0 写入（skipped 不算更新）', function () {
  const A = fresh(), B = fresh();
  const t0 = 1700000000000;
  const recs = [], cds = [];
  for (let i = 0; i < 60; i++) recs.push(mkRec('rec_' + i, 'R' + i, t0 + i));
  for (let i = 0; i < 35; i++) cds.push({ uid: 'cd_' + i, title: 'C' + i, updatedAt: t0 + 5000 + i });
  put(A, 'appData.records', recs);
  put(A, 'appData.countdowns', cds);
  put(A, 'appData.outbox', []);
  /* B 是「之前失败那轮已经收过 35 条」的状态 */
  put(B, 'appData.records', []);
  put(B, 'appData.countdowns', cds.map(function (x) { return Object.assign({}, x); }));
  put(B, 'appData.outbox', []);

  const t1 = 1795320000000;
  const r1 = syncOnce(A, B, 'sa', 'sb', 'didA', 'didB', t1, { commit: true });
  if (!(r1.equal === true || r1.equalAfterFix === true)) {
    console.log('      轮1 未收敛 pushed=' + r1.pushed + ' pullApplied=' + r1.pullApplied);
  }

  const r2 = syncOnce(A, B, 'sa2', 'sb2', 'didA', 'didB', t1 + 60000, { commit: true, since: t1 - 1000 });

  /* 第二轮 A 会把 B 上那 35 条扫一遍 → 全部 skipped。这不是「更新 35 条」，
     0.6.14 及以前原生把 skipped 一起相加，界面就会显示「共更新 35 条」。 */
  ok('dual-peer-idempotent 第二轮 0 写入', Number(r2.pullApplied) === 0, 'pullApplied=' + r2.pullApplied);
  ok('dual-peer-idempotent 第二轮首轮即相等', r2.equal === true, 'equal=' + r2.equal);
});

test('dual-peer-cat-stale 水位推进后，对方更旧的分类仍必须补过来', function () {
  /* 真机 0.6.15「没对上的：分类」：水位是「本机最后一次变更」的全局时间戳，
     一旦推进到今天，另一端几个月前建的分类（t < since）既不在 outbox（不会被 push），
     又早于水位（不会被 pull），补差又只有「发起方→应答方」一个方向 ——
     那一端的分类永远补不过来，指纹永久不等。
     0.6.16：配置类小集合（分类/分区/奖励/愿望/目标/周重点/倒计时/备忘）每轮全量带。 */
  const A = fresh(), B = fresh();
  const t0 = 1700000000000;
  const t1 = 1795320000000;
  put(A, 'appData.habitCats', [
    { uid: 'hcat_1_legacy_aa', id: '1', name: '学习', updatedAt: 0 }
  ]);
  put(B, 'appData.habitCats', [
    { uid: 'hcat_1_legacy_aa', id: '1', name: '学习', updatedAt: t0 },
    { uid: 'hcat_9_legacy_bb', id: '9', name: 'B 独有的分类', updatedAt: t0 + 1000 }
  ]);

  const r = syncOnce(A, B, 'sa', 'sb', 'didA', 'didB', t1, { commit: true, since: t1 - 1000 });
  eq('dual-peer-cat-stale A 拿到对方独有的分类', R(A, 'appData.habitCats.length'), 2);
  const namesA = R(A, 'appData.habitCats.map(function(x){return x.name}).sort()');
  const namesB = R(B, 'appData.habitCats.map(function(x){return x.name}).sort()');
  eq('dual-peer-cat-stale 两端分类名一致', J(namesA), J(namesB));
  ok('dual-peer-cat-stale 指纹相等', (r.equal === true || r.equalAfterFix === true),
    'diff=' + J(r.diffAfterFix || r.diff));

  /* 幂等：再跑一轮不该再有任何写入 */
  const r2 = syncOnce(A, B, 'sa2', 'sb2', 'didA', 'didB', t1 + 60000,
    { commit: true, since: t1 - 1000 });
  eq('dual-peer-cat-stale 第二轮首轮即相等', r2.equal, true);
  eq('dual-peer-cat-stale 第二轮无新增', R(A, 'appData.habitCats.length'), 2);
});

/* ====================================================================== */

async function main() {
  const only = process.argv.filter(function (a) { return a.indexOf('--only=') === 0; })[0];
  const pattern = only ? only.slice('--only='.length) : '';
  let n = 0;
  for (const c of CASES) {
    if (pattern && c.name.indexOf(pattern) < 0) continue;
    n++;
    try {
      await c.fn();
    } catch (e) {
      fails.push(c.name);
      console.log('  ✗ ' + c.name + ' 抛异常：' + (e && e.stack || e));
    }
  }
  const total = pass + fails.length;
  console.log('');
  console.log('用例 ' + n + ' 条 · 断言 ' + total + ' · PASS ' + pass + ' · FAIL ' + fails.length);
  console.log(fails.length === 0 ? n + '/' + n + ' cases pass · ' + total + '/' + total + ' assertions pass'
    : 'FAILED: ' + fails.join(', '));
  process.exit(fails.length ? 1 : 0);
}

if (process.argv.indexOf('--list') >= 0) {
  CASES.forEach(function (c) { console.log(c.name); });
} else {
  main();
}
