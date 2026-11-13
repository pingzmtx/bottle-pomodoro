/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 计划 / 待办层：新增弹窗（重复周期 + 四象限 + 子步骤）、完成流水、勾选 / 展开 / 排序 /
 * 子任务、列表渲染（renderTodos / renderTodoRowHtml / renderTodosRows）与行级更新。
 * 全部为**顶层函数声明**，跨 script 全局可见；本文件必须排在 01e_engine_ui.js
 * **之后**加载（见 src/manifest.json 槽 1（slots[0].files）的 files 顺序）。
 * 依赖方向：本文件 → 01e（前向，安全）。用到的 01e 顶层绑定只有两个，且都在 01e 里
 *   **先于本文件加载**，运行期一定已初始化：
 *     · 01e 的 `let _todoSig`（待办列表渲染签名）
 *     · 01e 的 `const SUB_CB_SVG`（子任务勾选框图形；01e 的 renderTimerSubs 也在用，
 *       故留在 01e，避免反向依赖）
 *   反向不成立：01e **不**依赖本文件的任何东西。
 * 周计划新增（对 01eA 的**软依赖**，不破坏上述方向）：
 *   · 归日判定唯一真相在 01eA（window.tbTodoSplitForDate / tbAnchorDateStr），
 *     本文件只 typeof 守卫后转发，缺省退化为旧行为——01eC 不重造归日逻辑。
 *   · 网格渲染完成广播（window.tbOnGridAfterRender）在 01eA，本文件在
 *     DOMContentLoaded 时订阅之，每次网格重画后刷一次列表（带重入守卫）；
 *     01eA 加载在本文件**之后**（同在 manifest 槽 1 的 files 列表里，排位更靠后），
 *     故订阅必须等 DOMContentLoaded，不能在本文件执行时立刻挂。
 *     为什么不包装 tbPickDate 等入口：01eA 内部有本地调用（📅 日历选日期），
 *     包装外部引用覆盖不到——广播由渲染方自己发，本地/外部路径全覆盖。 */
/* ==================== 模块: 04eC-ui-todo.js | 职责: 计划/待办的增删改查与列表渲染 | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04eC-ui-todo.js（源文件 01eC_ui_todo.js）
 * 分组：ui
 * 职责：待办/计划 —— 新增弹窗、重复周期与四象限控件、完成流水、勾选与展开、
 *       排序与手动移动、子任务、行级签名渲染与快捷修改。
 *   · 只搬「顶层 function 声明」，**不搬任何顶层立即执行语句、不搬任何顶层变量** ——
 *     因此跨 script 的加载顺序只影响「谁先定义」，不影响「谁能看见谁」。
 *   · 段内引用的非函数标识符，除上面契约里写明的
 *     `_todoSig` / `SUB_CB_SVG` 外**全部自包含**。
 *   · 回退方式：把本文件内容按段粘回 01e（第一段插在 `_subValSafe` 处、第二段插在
 *     `renderTodos` 处），并删掉 src/manifest.json 里本文件那一行。
 * 函数索引（TOC）：_todoSplit/_todoViewGroups/_subValSafe/removeNewTodoSubRow/addNewTodoSubRow/collectNewTodoSubs/_readAddTodoDraft/_applyAddTodoDraft/renderAddTodoExtraChips/syncAddBlockInputs/syncAddBlockGhost/onAddBlockInputChange（+83 更多）
 * ============================================================ */

/* 周计划：列表当前跟着哪一天渲染（与 01eA 的网格锚定日期同一值）。
   进 renderTodos 的脏检查签名——**只改日期、数据没变**时也要重渲，
   否则切日期后列表还是上一天那批（脏检查命中早退）。 */
let _todoViewDs = '';

/* 「⏮ 之前没完成的」分组折叠态（周计划看未来日期时的降噪）：
   规划未来时，之前布置的任务铁定未完成，全列出来只是噪音——默认折叠。
   默认态随查看日期：今天展开、非今天折叠；用户手点过题头后**当次保留**
   （_carryFoldDs 记下这个态是针对哪一天的，切到别的日期再按默认走）。
   同样进脏检查：只翻折、数据没变也要重渲。 */
let _carryFolded = false;
let _carryFoldDs = '';
let _carryFoldLast = -1; /* 上次渲染时的折叠态（-1 = 从未渲染过） */

/* 周计划取数：归日判定只有 01eA 一个真相（tbTodoSplitForDate，与网格画块同口径），
   这里只做「转发 + 缺省兜底」——01eC 不许自己重造一套归日逻辑。
   缺省（01eA 未加载 / 单文件测试环境）退化为「全量算当天」= 旧行为：
   看今天、全部显示、无分组，保证任何加载顺序下列表都不会空掉。 */
function _todoSplit() {
  if (typeof window.tbTodoSplitForDate === 'function') {
    try {
      return window.tbTodoSplitForDate();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:_todoSplit'); }
  }
  return { date: getTodayStr(), day: (appData.todos || []).slice(), carry: [], undated: [], future: [] };
}
/* 被「眼睛」藏起来的周期任务数（今天不做的那批）。渲染层用它决定底部要不要提示。 */
let _todoRepOffCount = 0;
let _todoRepOffCache = [];
/* 眼睛（单条「今天先不看」）藏起来的：条数 + id→日期映射，供列表底部"恢复"提示用 */
let _todoEyeOffCount = 0;
let _todoEyeOffDays = {};
/* 被收起的条目清单（id + 标题）：条目一藏就没了卡片，逐条取消只能从底部回执点 */
let _todoEyeOffList = [];
/* 底部回执是否已展开成逐条清单：>1 条时默认折叠（一条按钮不该占一整行） */
let _todoEyeHintOpen = false;
let _todoDoneHidden = 0;

/* 三分组各自按当前排序偏好排好（manual = 组内保持数组序）。
   返回 [day, carry, undated]；三者扁平拼接即**屏幕可见顺序**——
   moveTodo 的手动换位、renderTodos 的建行都基于它，两边永远不会对不上。 */
function _todoViewGroups() {
  const _s = _todoSplit();
  /* 「隐藏今天已完成」：过滤发生在**分组之后、排序之前**，而且只在视图层 ——
     不动数据、不动归日、不影响网格与统计。moveTodo 也走这里，
     所以隐藏后上移/下移只跟屏幕上看得见的邻居换位。 */
  const _hide = !!getSortPrefs().todos.hideDone;
  const _today = getTodayStr();
  /* 已完成的「过去的事」不再占今天的计划页：昨天那条排期已经过完，
     做没做由日志 / 之前没完成的说明，留着只是噪声。
     日切本来会删掉一次性任务、重复任务会复位，所以这里兜的是「窗口跨了午夜、
     日切还没跑」的那一小段；判据只看排期日，没有排期的完成项照常显示。
     ⚠️ 这条规则与 c78「完成不该让计划消失」的边界（2026-10-21 记）：
       c78 保的是「数据不丢、勾错能撤销」，不是「已完成且已过期的项必须占着今天的列表」。
       两者冲突时以本规则为准（c103 G1/G2/G3 是专门锁这条的一组）；
       c78 那边改成「隐藏 ≠ 丢失：数据仍在 carry 组，取消勾选立刻回来」。 */
  const _isPastDone = function (t) {
    if (!t || !t.done) return false;
    if (normTodoRepeat(t.repeat)) return false;
    const ds = todoBlockDates(t, appData.settings);
    if (!ds.length) return false;
    return String(ds[ds.length - 1]) < _today;
  };
  _todoDoneHidden = 0;
  const _keep = function (list) {
    const arr = (list || []).filter(function (t) { return !_isPastDone(t); });
    /* ★ 右侧那个眼睛（hideDone）是**总闸**：它没开，列表就按原样全显示，
       单条点了眼睛也只是打个标记，不生效。这是用户 2026-10-27 明确要的口径 ——
       「开关没开着，就算点了也还会显示；开关打开之后，点过的一并隐藏」。
       所以两处是一个体系，不是两套互不相干的过滤。 */
    if (!_hide) return arr;
    return arr.filter(function (t) { return !t || (!t.done && !todoEyesOff(t, _viewDs)); });
  };
  /* 「每周日才做的事，周三列出来干什么」：眼睛打开时，**今天不发生的周期任务**一并收起。
     判据三条缺一不可：
       ① 是重复计划；② 今天不是规则命中的日子；③ 今天没有单独按天排过的段。
       ③ 是边界：按天覆盖过 = 「这次特意挪到今天做」，必须留着（否则改完就找不着了）。
     已经完成的不动（那归 hideDone 管）；查看日不是今天时同样按查看日算 ——
     翻到周日那天，这条就正常出现。 */
  const _viewDs = (function () {
    const v = typeof window.tbAnchorDateStr === 'function' ? window.tbAnchorDateStr() : '';
    return v || getTodayStr();
  })();
  const _repOffView = function (t) {
    if (!t || t.done) return false;
    if (!normTodoRepeat(t.repeat)) return false;
    if (todoRepeatMatches(t.repeat, _viewDs)) return false;
    return tbBlocksOf(t, appData.settings, _viewDs).length === 0;
  };
  _todoRepOffCount = 0; /* 供列表底部提示用：眼睛藏着几条，得说出来，不然像"数据没了" */
  const _keep2 = function (list) {
    const arr = _keep(list);
    if (!_hide) return arr;
    /* 不在这里累加计数：_keep2 在 return 里被调用一次、_hiddenRep 又走一遍，
       两边都加会写出「2 条」而只藏了 1 条。条数统一由 _hiddenRep.length 给。 */
    return arr.filter(function (t) { return !_repOffView(t); });
  };
  /* 已完成的也数一下：开关 toast 要说清"藏了什么、几条"，不能光换个图标 */
  _todoDoneHidden = _hide ? (_s.day || []).concat(_s.undated || [], _s.carry || []).filter(function (t) {
    return t && t.done && !_isPastDone(t);
  }).length : 0;
  /* 按 id 去重：同一条任务可能同时落在 day / undated 两个篮子里（重复计划没排期就是），
     不去重的话回执会写「2 条」而屏幕上只少了一条。 */
  const _seenRep = {};
  const _hiddenRep = (_hide ? (_s.day || []).concat(_s.undated || [], _s.carry || []) : []).filter(function (t) {
    if (!_repOffView(t)) return false;
    const k = String(t.id);
    if (_seenRep[k]) return false;
    _seenRep[k] = 1;
    return true;
  });
  _todoRepOffCount = _hiddenRep.length;
  _todoRepOffCache = _hiddenRep.map(function (t) { return String(t.id); });
  /* 「今天先不看」的标记条数：**不管总闸开没开都数** —— 闸关着时它用来告诉用户
     「标记还在，打开眼睛仍会收起」，是开关回执的一部分。
     实际藏了几条由渲染处判 `_sp.hideDone`。同样按 id 去重。 */
  const _seenEye = {};
  const _eyesOff = (_s.day || []).concat(_s.undated || [], _s.carry || [], (_s.future || [])).filter(function (t) {
    if (!t || !todoEyesOff(t, _viewDs)) return false;
    /* 已完成的不归这条管（那是上面 hideDone 的账），否则同一条会被数两次、回执说多了 */
    if (t.done) return false;
    const k = String(t.id);
    if (_seenEye[k]) return false;
    _seenEye[k] = 1;
    return true;
  });
  _todoEyeOffCount = _eyesOff.length;
  _todoEyeOffDays = {};
  /* 存标题不只是为了画回执：条目被收起后卡片就没了，用户再想"点一下眼睛取消"
     只能从这里点 —— 所以回执必须是可逐条放回的，不能只有"全部放回"。 */
  _todoEyeOffList = _eyesOff.map(function (t) {
    _todoEyeOffDays[String(t.id)] = String(t.eyesOff).slice(0, 10);
    return { id: String(t.id), title: String(t.title || '这条计划') };
  });
  /* 「之后的安排」也要过眼睛：以前这组完全不受 hideDone 影响，
     点了眼睛也藏不掉（用户 2026-11-06 反馈「我用那个眼睛我看不见」）。
     只过「已完成 + 单条眼睛」这两道，不过 _repOffView —— 这组存在的意义
     就是让够不着的计划有个家，把重复计划再藏一遍等于把它藏两次。 */
  const _keepFuture = function (list) {
    const arr = list || [];
    if (!_hide) return arr;
    return arr.filter(function (t) { return !t || (!t.done && !todoEyesOff(t, _viewDs)); });
  };
  return [sortTodos(_keep2(_s.day)), sortTodos(_keep2(_s.carry)), sortTodos(_keep2(_s.undated)), sortTodos(_keepFuture(_s.future))];
}
/* ===== 新增计划时直接建子任务（可不填；回车快速加下一行） ===== */
function _subValSafe(s) {
  /* ★ 不在本文件维护第二套转义（P2-14）：这一套只转 4 个字符、漏单引号，
     正是「同仓多套转义、行为递减」的典型 —— 谁在 onclick 里用了它就出事。
     统一委托给 escapeHtml（01e_engine_ui.js:926，5 字符含 &#39;）。
     保留函数名与调用点：单文件测试环境里 escapeHtml 可能没加载，退回最小转义。 */
  if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function removeNewTodoSubRow(el) {
  /* 新增计划弹窗里子任务行的 ✕。
     ★ 必须是具名全局函数、元素用 this 传进来（2026-11-05）：
     原来写的是内联 `this.parentNode.remove()`，被 00_delegate 当成 a.b.c 路径接管成
     `data-act="this.parentNode.remove"`，而 resolve() 从 window 起走 → 永远取不到 →
     属性被摘掉、点了没反应。委托只认「窗口上的函数 + 字面实参」，宿主对象方法它管不了。 */
  const row = el && el.parentNode;
  if (row && row.parentNode) row.parentNode.removeChild(row);
}
function addNewTodoSubRow(v) {
  const box = document.getElementById('addTodoSubsBox');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'newsub-row';
  row.style.cssText = 'display:flex;align-items:center;gap:var(--sp-6);';
  row.innerHTML =
    '<span style="color:var(--text-light);font-size:var(--fs-note);flex-shrink:0;">·</span>' +
    '<input type="text" class="newsub-inp" value="' +
    _subValSafe(v) +
    '" placeholder="子任务内容…" style="flex:1;min-width:0;padding:var(--sp-8) var(--sp-10);font-size:var(--fs-body);border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);color:var(--text);" onkeydown="if(event.key===\'Enter\'){event.preventDefault();addNewTodoSubRow();}">' +
    '<span onclick="removeNewTodoSubRow(this)" style="cursor:pointer;color:var(--text-light);font-size:var(--fs-body);padding:var(--sp-4) var(--sp-8);flex-shrink:0;line-height:1;" title="删除这行">✕</span>';
  box.appendChild(row);
  const inp = row.querySelector('input');
  if (inp) inp.focus();
}

function collectNewTodoSubs() {
  const box = document.getElementById('addTodoSubsBox');
  if (!box) return [];
  const out = [];
  box.querySelectorAll('.newsub-row').forEach(function (row, i) {
    const inp = row.querySelector('input.newsub-inp');
    if (!inp) return;
    const v = (inp.value || '').trim();
    if (!v) return;
    /* 子任务不再有「预计🍅」输入（用户 10-15 要求），新建的子任务一律不填 pomodoros。
       历史数据里已有的字段保留不动，只是不再参与显示与合计。 */
    out.push({
      id: Date.now() + i * 7 + Math.floor(Math.random() * 97),
      uid: newUid('sub'),
      updatedAt: Date.now(),
      title: v,
      done: false,
      pomodoros: null
    });
  });
  return out;
}
/* ===== 新增计划弹窗：草稿里的「另排时段」 =====
 * 为什么是"草稿暂存"而不是弹窗里直接点格子：弹窗一开，遮罩就把网格盖住了。
 * 流程：读表单 → 关弹窗 → 进选段模式 → 每点两格只往草稿里加 → 完成后重开弹窗回填。
 * 草稿只在内存里，刷新即丢（用户本来也没保存，丢了是预期）。 */
var _addBlockDraft = [];
/* 读当前表单（与 confirmAddTodo 同一批 DOM 字段）。只用于暂存，不参与落盘口径。 */
function _readAddTodoDraft() {
  const val = function (id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };
  const rm = val('addTodoRemind');
  const pz = val('addTodoPomodoros');
  return {
    title: val('addTodoTitle'),
    detail: val('addTodoDetail'),
    tag: val('addTodoTag'),
    deadline: val('addTodoDeadline'),
    remindAt: rm,
    pomodoros: pz,
    quad: readAddTodoQuad(),
    repeat: readRepeatUI('addTodo'),
    subs: collectNewTodoSubs(),
    blocks: normExtraBlocks(_addBlockDraft)
  };
}
function _applyAddTodoDraft(d) {
  if (!d) return;
  const set = function (id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v == null ? '' : v;
  };
  set('addTodoTitle', d.title);
  set('addTodoDetail', d.detail);
  set('addTodoTag', d.tag);
  set('addTodoDeadline', d.deadline);
  set('addTodoRemind', d.remindAt);
  set('addTodoPomodoros', d.pomodoros);
  setAddTodoQuad(d.quad);
  const rp = document.getElementById('addTodoRepeatBox');
  if (rp) rp.innerHTML = repeatUIHtml('addTodo', d.repeat || null);
  const sb = document.getElementById('addTodoSubsBox');
  if (sb) {
    sb.innerHTML = '';
    (d.subs || []).forEach(function (s) { addNewTodoSubRow(s && s.title); });
  }
  _addBlockDraft = normExtraBlocks(d.blocks);
  renderAddTodoExtraChips();
}
/* 弹窗里「已排的段」清单：用户从网格回来后，必须能看见自己刚排了几段、分别是几点。
   没有这块，他只能凭记忆点「确定」——那和没做这个功能差不多。
   ★ 弹窗里恢复「开始 → 结束」两个框，喂的也是这份草稿的第 1 段 ——
   一条计划只有一份排期数据，框和清单必须同源，否则又是两个真相。 */
function renderAddTodoExtraChips() {
  const box = document.getElementById('addTodoExtraChips');
  if (!box) return;
  const list = normExtraBlocks(_addBlockDraft);
  _addBlockDraft = list;
  syncAddBlockInputs(list);
  if (!list.length) {
    /* 空着就整块不占高度（CSS :empty 也不显示）—— 说明文字已经收进旁边的「?」，
       不再常驻一行"还没有另排时段"。 */
    box.innerHTML = '';
    return;
  }
  box.innerHTML = list.map(function (b, i) {
    /* 完整年月日：排期可能落在不同的天，弹窗里必须分清是哪一天
*/
    return '<span class="tf-chip tf-chip--extra" title="' + escapeHtml(b.start) + ' – ' + escapeHtml(b.end) + '">' +
      escapeHtml(b.start.slice(0, 10)) + ' ' + escapeHtml(b.start.slice(11)) + '–' + escapeHtml(b.end.slice(11)) +
      (i === 0 ? '<span class="tf-chip-tag">第1段</span>' : '') +
      '<b class="tf-chip-x" role="button" tabindex="0" aria-label="删除这一段" title="删除这一段" ' +
      'onclick="event.stopPropagation();tbRemoveDraftExtraBlock(\'' + b.start + '\')">×</b></span>';
  }).join('');
}
/* 草稿第 1 段 ↔ 弹窗里那两个 datetime-local 框的双向同步。
   单向会出事：从网格排完段回来，框里必须显示这段；用户在框里改，清单也得跟着变。 */
function syncAddBlockInputs(list) {
  const s = document.getElementById('addTodoBlockStart');
  const e = document.getElementById('addTodoBlockEnd');
  if (!s || !e) return;
  const b = (list || normExtraBlocks(_addBlockDraft))[0];
  const sv = b ? String(b.start).replace(' ', 'T') : '';
  const ev = b ? String(b.end).replace(' ', 'T') : '';
  if (document.activeElement !== s) s.value = sv;
  if (document.activeElement !== e) e.value = ev;
  syncAddBlockGhost();
}
/* 空框提示层：有值就藏、没值就露。
   ★ 纯 CSS 做不到 —— datetime-local 不响应 :placeholder-shown，改 .value 也不改属性，
     只能用类。任何改动框值的地方（同步、用户改）都要调一次。 */
function syncAddBlockGhost() {
  ['addTodoBlockStart', 'addTodoBlockEnd'].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el || !el.parentNode || !el.parentNode.classList) return;
    el.parentNode.classList.toggle('has-value', !!el.value);
  });
}
/* 用户在两个框里改时间 → 改写草稿第 1 段（没段就新建一段）。
   校验与 todoAddBlock 同一套：同日、≥10 分钟、不重叠。 */
function onAddBlockInputChange() {
  _onAddBlockInputChangeCore();
  /* 不论走哪条分支（含早退的校验失败），框里的值都可能被改写 → 提示层必须跟着刷 */
  syncAddBlockGhost();
}
function _onAddBlockInputChangeCore() {
  const sEl = document.getElementById('addTodoBlockStart');
  const eEl = document.getElementById('addTodoBlockEnd');
  if (!sEl || !eEl) return;
  const s = normDT(sEl.value);
  let e = normDT(eEl.value);
  if (!s && !e) {
    /* 两个都清空 = 不要第 1 段了（其余段保留，会整体上移一位） */
    _addBlockDraft = normExtraBlocks(_addBlockDraft).slice(1);
    renderAddTodoExtraChips();
    return;
  }
  if (!s) return;
  if (!e) {
    /* 只填了开始：按预计🍅 推一个结束（每个 25 分），没填就默认半小时 */
    const pEl = document.getElementById('addTodoPomodoros');
    const n = pEl && parseFloat(pEl.value) > 0 ? parseFloat(pEl.value) : 1.2;
    const mins = Math.max(TODO_EXTRA_MIN_MIN, Math.round(n * 25));
    e = tbAddMinutesDT(s, mins);
    eEl.value = e.replace(' ', 'T');
  }
  if (e <= s) {
    showToast('结束要比开始晚');
    syncAddBlockInputs();
    return;
  }
  const rest = normExtraBlocks(_addBlockDraft).slice(1);
  const hit = normExtraBlocks([{ start: s, end: e }].concat(rest));
  if (!hit.length) {
    showToast('这段时间排不了，换一段试试');
    syncAddBlockInputs();
    return;
  }
  _addBlockDraft = normExtraBlocks([{ start: s, end: e }].concat(rest));
  renderAddTodoExtraChips();
}
/* datetime 字符串加分钟（纯字符串运算，不依赖时区对象） */
function tbAddMinutesDT(dt, mins) {
  const s = normDT(dt);
  if (!s) return '';
  const ds = s.slice(0, 10);
  const m = tbHHMMToMin(s);
  if (m == null) return s;
  const t = m + Math.round(mins);
  if (t >= TB_DAY_MINUTES) return ds + ' ' + tbMinToHHMM(TB_DAY_MINUTES);
  return ds + ' ' + tbMinToHHMM(t);
}
/* 草稿里加一段：校验口径与 todoAddBlock 一致（同日 / ≥10 分钟 / 不重叠 / ≤24 段）。
   草稿只在内存里，落盘在「确定」那一步统一写 t.blocks。 */
function tbAddDraftExtraBlock(dateStr, loMin, hiMin) {
  const d = _readAddTodoDraft();
  const ds = String(dateStr == null ? '' : dateStr).slice(0, 10);
  const lo = Math.round(Number(loMin));
  const hi = Math.round(Number(hiMin));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds) || !isFinite(lo) || !isFinite(hi) || hi <= lo) {
    return { ok: false, reason: 'badTime', count: _addBlockDraft.length };
  }
  if (hi - lo < TODO_EXTRA_MIN_MIN) return { ok: false, reason: 'tooShort', count: _addBlockDraft.length };
  if (lo < 0 || hi > TB_DAY_MINUTES) return { ok: false, reason: 'crossDay', count: _addBlockDraft.length };
  const start = ds + ' ' + tbMinToHHMM(lo);
  const end = ds + ' ' + tbMinToHHMM(hi);
  if (!normDT(start) || !normDT(end)) return { ok: false, reason: 'badTime', count: _addBlockDraft.length };
  const cur = normExtraBlocks(_addBlockDraft);
  if (cur.length >= TODO_EXTRA_MAX) return { ok: false, reason: 'limit', count: cur.length };
  for (let i = 0; i < cur.length; i++) {
    if (cur[i].start === start) return { ok: false, reason: 'dup', count: cur.length };
  }
  for (let j = 0; j < cur.length; j++) {
    const bs = tbHHMMToMin(cur[j].start);
    const be = tbHHMMToMin(cur[j].end);
    if (bs != null && be != null && lo < be && bs < hi) {
      return {
        ok: false, reason: 'overlap', count: cur.length,
        hitStart: tbMinToHHMM(bs), hitEnd: tbMinToHHMM(be), hitExtra: true
      };
    }
  }
  _addBlockDraft = normExtraBlocks(cur.concat([{ start: start, end: end }]));
  renderAddTodoExtraChips();
  return { ok: true, reason: '', count: _addBlockDraft.length, start: start, end: end };
}
function tbRemoveDraftExtraBlock(startStr) {
  const key = normDT(startStr);
  const cur = normExtraBlocks(_addBlockDraft);
  const next = cur.filter(function (b) { return b.start !== key; });
  if (next.length === cur.length) return false;
  _addBlockDraft = next;
  renderAddTodoExtraChips();
  return true;
}
function tbOpenAddTodoWithDraft(d) {
  openAddTodoModal(d);
}
function tbDraftExtraBlocks() {
  return normExtraBlocks(_addBlockDraft);
}
/* 「?」= 展开 / 收起说明，**不是** toast。
 * toast 会自己消失，用户还没看完就没了；说明是"用户主动要看"的内容，
 * 什么时候收起必须由用户决定（再点一次 ?，或关掉弹窗）。 */
function tbToggleAddExtraHelp(el) {
  const box = document.getElementById('addTodoExtraHelp');
  if (!box) return;
  const on = box.style.display === 'none' || !box.style.display;
  box.style.display = on ? 'block' : 'none';
  if (el) {
    el.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) el.classList.add('is-on');
    else el.classList.remove('is-on');
  }
}
window.tbToggleAddExtraHelp = tbToggleAddExtraHelp;
function openAddTodoModal(draft) {
  document.getElementById('addTodoTitle').value = '';
  document.getElementById('addTodoDetail').value = '';
  document.getElementById('addTodoPomodoros').value = '';
  /* 预计🍅 的快捷档：和展开后编辑面板里那排 chip 是**同一组数**（0.5/1/1.5/2/3/4）。
     新建计划时最常填的就是这几个数，逼人点手机数字键盘敲「1.5」是没道理的。
     生成一次即可 —— chips 不随值变化重建，只切 on 状态。 */
  renderAddTodoPomoQuick();
  const _tg = document.getElementById('addTodoTag');
  if (_tg) _tg.value = '';
  const _dl = document.getElementById('addTodoDeadline');
  if (_dl) _dl.value = '';
  const _rm = document.getElementById('addTodoRemind');
  if (_rm) {
    /* ★ 不预填提醒时间（2026-11-06）。原来在非今天新建时会把「那天的当前钟点」
       填进提醒框，于是用户卡片上凭空出现一个闹钟 —— 他要的是「那天能看到这条计划」，
       不是「那天几点提醒我」。提醒是用户自己按需设的东西，不替他决定。
       至于归属哪天，走 planDate（见 confirmAddTodo）。 */
    _rm.value = '';
  }
  const _sb = document.getElementById('addTodoSubsBox');
  if (_sb) _sb.innerHTML = '';
  /* 每次正常打开都从空草稿开始；带 draft 重开时在下面回填（顺序不能反：
     先清空，才能保证"取消后再打开"不会把上一轮的段带进来）。 */
  _addBlockDraft = [];
  /* 说明面板每次打开都收起（它属于"这次想看才看"的内容，不该跨次常驻） */
  const _ah = document.getElementById('addTodoExtraHelp');
  if (_ah) _ah.style.display = 'none';
  const _ahb = document.getElementById('addTodoExtraHelpBtn');
  if (_ahb) { _ahb.setAttribute('aria-expanded', 'false'); _ahb.classList.remove('is-on'); }
  const _rp = document.getElementById('addTodoRepeatBox');
  if (_rp) _rp.innerHTML = repeatUIHtml('addTodo', null); /* 每次打开回到「不重复」 */
  renderAddTodoQuad(); /* 四象限回到「不限」 */
  /* 从选段模式回来：把标题/标签/象限/番茄/重复/子任务/排期段原样填回去。 */
  if (draft) _applyAddTodoDraft(draft);
  syncAddTodoPomoQuick();
  renderAddTodoExtraChips();
  showModal('addTodoModal');
  setTimeout(() => document.getElementById('addTodoTitle').focus(), 100);
  try {
    renderUsedTagsRow();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:openAddTodoModal'); }
}
/* ===== 计划「重复周期」控件（新增弹窗 + 行内编辑面板共用同一份）=====
 * 规则运算全在 00_pure_core.js（纯函数）；这里只管界面读写。
 * 元素 id 一律由 repeatElId(prefix, part) 拼出，读写两侧同一来源，避免各写一半对不上。
 *   prefix = 'addTodo'        → 新增弹窗
 *   prefix = 'todo_<id>_'     → 该任务行内编辑面板
 * 各分支的显示状态在 HTML 生成时就算好（renderTodoRowHtml 是纯拼串、不能带副作用），
 * syncRepeatUI 只在用户改下拉时负责现场切换。 */
function repeatElId(prefix, part) { return prefix + 'Repeat' + part; }
/* 内联 handler 里的字符串参数一律走 idArg()（纯函数区已有，见 00_pure_core.js 注释） */
/* 输出风格对齐 .tf-row + .tf-input（编辑面板里和"标签/最晚完成日"同一视觉） */
/* ===== 计划「四象限」控件（新增弹窗 / 行内编辑 共用同一份标记）=====
 * 分类常量与排序权重在 00_pure_core.js（TODO_QUADS / normQuad / quadRank），这里只管渲染与读写。
 * clickExpr 形如 "setTodoQuad(123," —— 后面补上 'q1') 就是完整 onclick，
 * 于是「弹窗里点一下就重画 chip」和「行内点一下直接写 appData」能共用同一份生成逻辑。 */
function quadChipsHtml(quad, clickExpr) {
  const cur = normQuad(quad);
  let h = '<div class="quad-chips">';
  for (let i = 0; i < TODO_QUADS.length; i++) {
    const q = TODO_QUADS[i];
    h += '<span class="quad-chip quad-chip--' + q.key + (cur === q.key ? ' on' : '') +
      '" title="' + escapeHtml(q.label) + '：' + escapeHtml(q.hint) + '" onclick="' + clickExpr + '\'' + q.key + '\')">' + q.short + '</span>';
  }
  h += '<span class="quad-chip quad-chip--none' + (cur ? '' : ' on') + '" title="不分类" onclick="' + clickExpr + '\'\')">不限</span>';
  return h + '</div>';
}
/* 行内编辑面板：直接落到 appData 并重画列表 */
function setTodoQuad(id, k) {
  const t = appData.todos.find(function (x) { return x.id === id; });
  if (!t) return;
  t.quad = normQuad(k);
  saveData();
  /* 只局部刷新标题栏徽章 + 展开面板里的象限 chips 高亮，不整行重画：
     避免点象限时列表整行重建造成的闪烁与展开面板抖动 */
  refreshTodoTitleBadges(t);
  const row = document.querySelector('[data-id="' + String(t.id).replace(/"/g, '\\"') + '"]');
  if (row) {
    const chips = row.querySelector('.quad-chips');
    if (chips) {
      /* 就地改高亮，绝不替换节点：outerHTML 替换会重建整块 chips，
         展开面板里就会闪一下（用户 10-15 反馈） */
      const cur = normQuad(t.quad);
      const kids = chips.children;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (!c.classList || !c.classList.contains('quad-chip')) continue;
        let key = '';
        for (let j = 0; j < c.classList.length; j++) {
          const cn = c.classList[j];
          if (cn.indexOf('quad-chip--') === 0) { key = cn.slice(11); break; }
        }
        const on = key === 'none' ? !cur : (key === cur);
        if (on) c.classList.add('on'); else c.classList.remove('on');
      }
    }
  }
}
/* 新增弹窗：控件尚未对应任何数据，暂存在容器 dataset 上（不新增全局临时变量） */
function setAddTodoQuad(k) {
  const box = document.getElementById('addTodoQuadBox');
  if (!box) return;
  const q = normQuad(k);
  box.dataset.quad = q || '';
  box.innerHTML = quadChipsHtml(q, 'setAddTodoQuad(');
}
function renderAddTodoQuad() {
  const box = document.getElementById('addTodoQuadBox');
  if (!box) return;
  box.dataset.quad = '';
  box.innerHTML = quadChipsHtml(null, 'setAddTodoQuad(');
}
function readAddTodoQuad() {
  const box = document.getElementById('addTodoQuadBox');
  return box ? normQuad(box.dataset.quad) : null;
}
/* 任务行上的象限小标（未分类不显示） */
function quadBadgeHtml(t) {
  const q = quadMeta(t && t.quad);
  if (!q) return '';
  return '<span class="quad-badge quad-chip--' + q.key + '" title="' + escapeHtml(q.label) + '">' + q.short + '</span>';
}
/* 标签徽章按文本稳定配色：同一标签永远同色，不同标签尽量不同色。
   返回内联 style（半透明底 + 实色字/边），复用任务色板（window.tbTagColorOfText）。 */
function tagColorStyle(tag) {
  if (!tag) return '';
  const hex = (typeof window.tbTagColorOfText === 'function') ? window.tbTagColorOfText(tag) : '';
  if (!hex) return '';
  return 'color:' + hex + ';border-color:' + hex + '55;background:' + hex + '1f';
}
function repeatUIHtml(prefix, r, id, opts) {
  const o = opts || {};
  const rr = normTodoRepeat(r);
  const mode = rr ? rr.mode : 'none';
  const wd = (rr && rr.weekdays) || [];
  const dom = rr && typeof rr.dom === 'number' ? rr.dom : 1;
  const iv = (rr && rr.interval) || 2;
  const show = function (m) { return mode === m ? '' : 'none'; };
  const opt = function (v, t) { return '<option value="' + v + '"' + (mode === v ? ' selected' : '') + '>' + t + '</option>'; };
  /* 行内面板带 id（改一下就地保存）；新增弹窗不带（保存走"确定"按钮） */
  const ida = id === undefined || id === null ? '' : ', ' + idArg(id);
  const onchg = 'onchange="onRepeatModeChange(' + idArg(prefix) + ida + ')"';
  let h = '<select class="tf-input" id="' + repeatElId(prefix, 'Mode') + '" ' + onchg + '>';
  h += opt('none', o.noneLabel || '不重复');
  /* 习惯弹窗传 opts.noDaily：习惯的「不设规则」本身就是每天，
     再摆一个「每天」选项等于同一件事两个选项，选哪个都对、看着像 bug */
  if (!o.noDaily) h += opt('daily', '每天');
  h += opt('weekdays', '工作日（周一~周五）');
  h += opt('weekly', '每周');
  h += opt('monthly', '每月');
  h += opt('interval', '每隔 N 天');
  h += '</select>';
  /* 面板：统一「标签在上 / 控件在下 / 灰字说明垫底」三行式。
     之前是左标签 + 右控件 + 同行灰字，控件宽度随内容伸缩，说明被挤成省略号，看着乱。 */
  /* 习惯默认档是「每天（默认）」（mode=none），那一档的面板如果按"不重复"收起来，
     用户就永远看不到「第二天子计划」三档 —— 而习惯恰恰是最需要它的一类。
     所以习惯传 opts.alwaysExtra：面板常开，里面只露「重复到哪天」「第二天子计划」两行。 */
  h += '<div class="repeat-extra" id="' + repeatElId(prefix, 'Extra') + '"' + (o.alwaysExtra ? ' data-always="1"' : '') + ' style="display:' + ((o.alwaysExtra || mode !== 'none') ? '' : 'none') + ';">';
  /* 每周：点星期几（多选，可点掉） */
  h += '<div class="repeat-field" id="' + repeatElId(prefix, 'Weekdays') + '" style="display:' + show('weekly') + ';">';
  h += '<span class="repeat-label">星期</span><div class="repeat-wds">';
  for (let i = 0; i < REPEAT_WEEK_CN.length; i++) {
    const w = i + 1;
    h += '<span class="repeat-wd' + (wd.indexOf(w) >= 0 ? ' on' : '') + '" data-wd="' + w + '" onclick="onRepeatWdToggle(' + idArg(prefix) + ',' + w + ida + ')">' + REPEAT_WEEK_CN[i] + '</span>';
  }
  h += '</div></div>';
  /* 每月：几号（可选「最后一天」；31 号在小月自动落到月末） */
  h += '<div class="repeat-field" id="' + repeatElId(prefix, 'DomWrap') + '" style="display:' + show('monthly') + ';">';
  h += '<span class="repeat-label">每月几号</span><select class="tf-input" id="' + repeatElId(prefix, 'Dom') + '" ' + onchg + '>';
  h += '<option value="0"' + (dom === 0 ? ' selected' : '') + '>最后一天</option>';
  for (let d = 1; d <= 31; d++) h += '<option value="' + d + '"' + (d === dom ? ' selected' : '') + '>' + d + ' 号</option>';
  h += '</select><span class="repeat-hint">选「最后一天」＝每月末；选 31 号遇小月自动落到月末</span></div>';
  /* 每隔 N 天：数字 + 单位同一行读成一句话 */
  h += '<div class="repeat-field" id="' + repeatElId(prefix, 'IvWrap') + '" style="display:' + show('interval') + ';">';
  h += '<span class="repeat-label">间隔天数</span><div class="repeat-inline"><input class="tf-input tf-input--num" id="' + repeatElId(prefix, 'Iv') + '" max="365" min="1" type="number" value="' + iv + '" ' + onchg + '><span class="repeat-unit">天一次</span></div>';
  h += '<span class="repeat-hint">从提醒那天算起，每隔这么多天回到未完成</span></div>';
  /* 重复到哪天为止：不填 = 一直重复 */
  h += '<div class="repeat-field" id="' + repeatElId(prefix, 'UntilWrap') + '">';
  h += '<span class="repeat-label">重复到哪天</span><input type="date" class="tf-input" id="' + repeatElId(prefix, 'Until') + '" value="' + ((rr && rr.until) || '') + '" ' + onchg + '>';
  h += '<span class="repeat-hint">不填 = 一直重复下去</span></div>';
  /* 第二天子任务怎么办：默认「自动重置为未完成」—— 用户 10-19 要的就是这条：
     今天勾掉的子任务，第二天整条计划回到未完成时，子任务也一起回到未勾，只需重新打勾。
     ★ 习惯编辑弹窗复用同一份控件（2026-11-05）：习惯也有子计划了，三档一模一样照搬；
       只有称呼不同（任务叫「子任务」、习惯叫「子计划」），文案走 opts 传，不另写一套控件。 */
  if (!o.noSubs) {
    const _subsLabel = o.subsLabel || '下次重复时，子任务';
    const _subsHint = o.subsHint || '三档的区别：全部重置 = 重新打勾；只留未完成 = 做过的删掉、没做的继续；清空 = 第二天从零列';
    const _subsFoot = o.subsFoot || '到期自动回到未完成，不用每天手动加一条';
    h += '<div class="repeat-field" id="' + repeatElId(prefix, 'SubsWrap') + '">';
    h += '<span class="repeat-label">' + _subsLabel + '</span><select class="tf-input" id="' + repeatElId(prefix, 'Subs') + '" ' + onchg + '>';
    /* 三档（需求的第三档）：
       reset     —— 全部回到未完成（清单不动，勾选清零）
       clearDone —— 只删已完成的，未完成的留着（进度继承，做完的不用再做）
       clear     —— 整条清空，第二天从空清单重新列 */
    h += '<option value="reset"' + ((rr && (rr.subsMode === 'clear' || rr.subsMode === 'clearDone')) ? '' : ' selected') + '>全部回到未完成（清单不动）</option>';
    h += '<option value="clearDone"' + (rr && rr.subsMode === 'clearDone' ? ' selected' : '') + '>清除已完成的，只留未完成</option>';
    h += '<option value="clear"' + (rr && rr.subsMode === 'clear' ? ' selected' : '') + '>整条清空，重新列</option>';
    h += '</select><span class="repeat-hint">' + _subsHint + '</span></div>';
    h += '<div class="repeat-foot">' + _subsFoot + '</div>';
  } else {
    h += '<div class="repeat-foot">按节奏自动出现在今天该做的清单里；不做的日子不占屏，收在「今天不用做」</div>';
  }
  h += '</div>';
  return h;
}
/* 下拉切档：只切显示，不碰数据（数据在保存时读） */
function syncRepeatUI(prefix) {
  const sel = document.getElementById(repeatElId(prefix, 'Mode'));
  const ex = document.getElementById(repeatElId(prefix, 'Extra'));
  if (!sel || !ex) return;
  const m = sel.value;
  /* data-always=1：习惯这种「不选节奏 = 每天」的场景，面板常开（否则三档看不见） */
  ex.style.display = (m === 'none' && ex.getAttribute('data-always') !== '1') ? 'none' : '';
  const show = function (part, on) {
    const el = document.getElementById(repeatElId(prefix, part));
    if (el) el.style.display = on ? '' : 'none';
  };
  show('Weekdays', m === 'weekly');
  show('DomWrap', m === 'monthly');
  show('IvWrap', m === 'interval');
  if (m === 'weekly') {
    /* 切到「每周」默认勾上今天：一次点选的活儿，别让人先点星期 */
    const box = document.getElementById(repeatElId(prefix, 'Weekdays'));
    if (box && !box.querySelector('.repeat-wd.on')) {
      const t = box.querySelector('.repeat-wd[data-wd="' + isoWeekday(getTodayStr()) + '"]');
      if (t) t.classList.add('on');
    }
  }
}
function toggleRepeatWd(prefix, wd) {
  const box = document.getElementById(repeatElId(prefix, 'Weekdays'));
  if (!box) return;
  const el = box.querySelector('.repeat-wd[data-wd="' + wd + '"]');
  if (el) el.classList.toggle('on');
}
/* 控件改动 → 就地保存（只存不重画）：skipRender=true 才不会把用户刚点的控件整块换掉。
 * 徽标要等下一次自然重画才更新，这点延迟换"点一下不丢焦点"是值的。 */
function onRepeatModeChange(prefix, id) {
  syncRepeatUI(prefix);
  if (id === undefined || id === null) return;
  forceSaveTodoDetail(id, true);
}
function onRepeatWdToggle(prefix, wd, id) {
  toggleRepeatWd(prefix, wd);
  if (id === undefined || id === null) return;
  forceSaveTodoDetail(id, true);
}
/* 读控件 → 规则对象；'不重复' 返回 null（= 一次性任务） */
function readRepeatUI(prefix) {
  const sel = document.getElementById(repeatElId(prefix, 'Mode'));
  if (!sel || sel.value === 'none') return null;
  const today = getTodayStr();
  const r = { mode: sel.value };
  if (sel.value === 'weekly') {
    const wds = [];
    const box = document.getElementById(repeatElId(prefix, 'Weekdays'));
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll('.repeat-wd.on'), function (el) {
        const n = parseInt(el.getAttribute('data-wd'), 10);
        if (n >= 1 && n <= 7) wds.push(n);
      });
    }
    if (!wds.length) wds.push(isoWeekday(today)); /* 一天都没勾 = 按今天算，别让用户白填 */
    r.weekdays = wds;
  } else if (sel.value === 'monthly') {
    const el = document.getElementById(repeatElId(prefix, 'Dom'));
    const d = el ? parseInt(el.value, 10) : 0;
    /* 0 = 每月最后一天（合法档位，不是"没填"） */
    r.dom = d >= 0 && d <= 31 ? d : dateStrToDate(today).getDate();
  } else if (sel.value === 'interval') {
    const el = document.getElementById(repeatElId(prefix, 'Iv'));
    const n = el ? parseInt(el.value, 10) : 2;
    r.interval = Math.min(365, Math.max(1, isNaN(n) ? 2 : n));
  }
  const un = document.getElementById(repeatElId(prefix, 'Until'));
  if (un && isDateStrOk(un.value)) r.until = un.value; /* 空/半截输入 = 一直重复 */
  const sb = document.getElementById(repeatElId(prefix, 'Subs'));
  if (sb) r.subsMode = (sb.value === 'clear' || sb.value === 'clearDone') ? sb.value : 'reset';
  return normTodoRepeat(r);
}
/* 把规则挂到任务上（新增/编辑共用）：
 *   last   —— 保留原值，没有才落今天（幂等闸门，不能被编辑动作刷新）
 *   anchor —— interval 才用；同一档位内保留原锚点，别的档位转过来才重锚到今天
 *   next   —— 永远按「今天之后的下一个命中日」重算：规则没变时结果相同（幂等） */
function applyTodoRepeat(t, r) {
  const today = getTodayStr();
  const prev = normTodoRepeat(t.repeat);
  if (!r) { t.repeat = null; return; }
  const prevMode = prev ? prev.mode : '';
  const prevAnchor = prev ? prev.anchor : null;
  const prevLast = prev ? prev.last : null;
  const out = Object.assign({}, r);
  if (r.mode === 'interval') out.anchor = prevMode === 'interval' && prevAnchor ? prevAnchor : today;
  out.last = prevLast || today;
  out.next = nextTodoRepeatDate(out, today, false);
  t.repeat = out;
  /* 排期段的锚点必须落在规则命中的日子上。
     段的日期既是"这一天有安排"，也是重复时**平移的基准**：一段挂在周三、
     规则是「每周日」，那么周三不画（规则不认这天）、周日也画不对（基准是周三）。
     所以规则一变，就把整组段挪到「从基准日算起最近的一个命中日」，钟点不动。
     例：周三建的「每周日 20:00」→ 段自动落到这周日 20:00。 */
  const _segs = todoBlocksOf(t, appData.settings);
  if (_segs.length) {
    const _base = String(_segs[0].start).slice(0, 10);
    if (_base && !todoRepeatMatches(out, _base)) {
      const _hit = nextTodoRepeatDate(out, _base, true);
      const _shift = _hit ? daysBetweenStr(_base, _hit) : 0;
      if (_hit && _shift > 0) {
        t.blocks = normExtraBlocks(_segs.map(function (b) {
          const sm = tbHHMMToMin(b.start), em = tbHHMMToMin(b.end);
          if (sm == null || em == null) return null;
          const s2 = addDaysStr(String(b.start).slice(0, 10), _shift);
          const e2 = addDaysStr(String(b.end).slice(0, 10), _shift);
          return s2 && e2 ? { start: s2 + ' ' + tbMinToHHMM(sm), end: e2 + ' ' + tbMinToHHMM(em) } : null;
        }).filter(Boolean));
        showToast('排期已跟着「' + todoRepeatLabel(out) + '」挪到 ' + _hit.slice(5).replace('-', '/') + ' 那天');
      }
    }
  }
}
function confirmAddTodo() {
  const parsed = parseTodoShortSyntax(document.getElementById('addTodoTitle').value);
  const title = parsed.title;
  if (!title) {
    showToast('请输入任务标题');
    return;
  }
  const detail = document.getElementById('addTodoDetail').value.trim();
  const tagEl = document.getElementById('addTodoTag');
  const tag = (tagEl && tagEl.value.trim()) || parsed.tag;
  const dlEl = document.getElementById('addTodoDeadline');
  const deadline = dlEl && dlEl.value ? dlEl.value : parsed.deadline;
  const rmEl = document.getElementById('addTodoRemind');
  const remindAt = (rmEl && normDT(rmEl.value)) || parsed.remindAt || null;
  const pomoEl = document.getElementById('addTodoPomodoros');
  const pomodoros = pomoEl && pomoEl.value ? parseFloat(pomoEl.value) : parsed.pomodoros;
  const _repFinal = readRepeatUI('addTodo');
  /* 排期段：草稿里画了几段就存几段。
     段之间不允许重叠（加的时候已经拦过），保存时不再二次过滤 ——
     用户画的时间不该在"确定"这一步被悄悄丢掉。 */
  const _blocksFinal = normExtraBlocks(_addBlockDraft);
  const newTodo = {
    id: Date.now(),
    uid: newUid('todo'),
    updatedAt: Date.now(),
    title: title,
    done: false,
    detail: detail,
    pomodoros: pomodoros ? pomodoros : null,
    subs: collectNewTodoSubs(),
    actualPomodoros: 0,
    timeSpent: 0,
    tag: tag,
    deadline: deadline || null,
    remindAt: remindAt || null,
    reminded: false,
    /* 排期就是用户在网格上画的那几段，没画就没有 —— 这里**不自动生成段**。
       归属哪天写进 planDate：只影响「切到那天列表里能看到」，不产生闹钟也不画块。
       查看日就是今天时不写（今天的事不需要额外标注）。 */
    planDate: _addPlanDate(),
    blocks: _blocksFinal.length ? _blocksFinal : undefined,
    quad: readAddTodoQuad(),
    repeat: null
  };
  /* 重复周期：'' / null = 一次性任务（老行为） */
  applyTodoRepeat(newTodo, _repFinal);
  appData.todos.push(newTodo);
  /* 标签库：收集用过的标签供下次快速复用 */
  if (tag) {
    if (!appData.usedTags) appData.usedTags = [];
    if (appData.usedTags.indexOf(tag) < 0) {
      appData.usedTags.unshift(tag);
      if (appData.usedTags.length > 30) appData.usedTags = appData.usedTags.slice(0, 30);
    }
  }
  saveData();
  renderTodos();
  refreshTodoSelect();
  closeModal('addTodoModal');
  _addBlockDraft = []; /* 已落盘，草稿使命结束；下次打开从空开始 */
  const extra = [];
  if (deadline) extra.push('最晚完成日 ' + (deadline.length >= 10 ? deadline.slice(5) : deadline));
  if (remindAt) extra.push((remindAt.length > 5 ? remindAt.slice(5, 10) + ' ' + fmtClockHM(remindAt) : remindAt) + ' 提醒');
  if (newTodo.repeat) extra.push('🔄 ' + todoRepeatLabel(newTodo.repeat));
  if (newTodo.blocks && newTodo.blocks.length) extra.push('排期 ' + newTodo.blocks.length + ' 段');
  showToast('计划已添加' + (extra.length ? '（' + extra.join(' · ') + '）' : ''));
}
/* 新建计划时「属于哪天」：正在看哪天就归哪天，看今天则不写。
   只记归属，不产生提醒、不画排期块 —— 用户要的是「那天列表里能看到这条」。 */
function _addPlanDate() {
  const vd = typeof window.tbAnchorDateStr === 'function' ? window.tbAnchorDateStr() : '';
  if (!vd || vd === getTodayStr()) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(vd) ? vd : undefined;
}
/* 弹窗草稿 → 选段模式 → 回填。三个入口都挂 window：内联 onclick 只认全局属性。 */
window.tbOpenAddTodoWithDraft = tbOpenAddTodoWithDraft;
window.tbAddDraftExtraBlock = tbAddDraftExtraBlock;
window.tbRemoveDraftExtraBlock = tbRemoveDraftExtraBlock;
window.tbDraftExtraBlocks = tbDraftExtraBlocks;
window.tbReadAddTodoDraft = _readAddTodoDraft;
/* ===== 待办「完成流水」=====
 * 「每日总结」里的「✅ 完成任务」不能靠数 appData.todos 里 done=true 的条数 ——
 * 待办状态第二天 0 点就被自动清空（见 checkNewDay），那样回看任何一天都只剩 0。
 * 完成是一件事，就得在发生的那一刻记下来：勾选 → 往当天流水里写一条；
 * 取消勾选 → 把这条撤掉（按 doneAt 定位当时那天，跨天反悔也能删对）。
 * 待办列表本身仍然只装「当前任务」，不会被历史撑大。 */
function todosDoneOn(ds) {
  /* 取「当天勾过的」并集：既有完成流水（跨天仍可回看），也含此刻仍处于已完成
     状态的待办（老数据没有流水，不能因此显示 0）。
     ★ partial 条（只勾了子计划、整条计划没打勾）不算「完成一项」：
       否则统计页/每日总结会把「推进了一步」说成「做完了一件事」。 */
  const ids = {};
  const arr = (appData.todoDoneLog || {})[ds];
  if (Array.isArray(arr)) arr.forEach(function (x) {
    if (x && x.id !== undefined && !x.partial) ids[String(x.id)] = 1;
  });
  if (ds === getTodayStr()) {
    (appData.todos || []).forEach(function (t) { if (t && t.done) ids[String(t.id)] = 1; });
  }
  return Object.keys(ids).length;
}
function _logTodoDone(t) {
  if (!appData.todoDoneLog || typeof appData.todoDoneLog !== 'object') appData.todoDoneLog = {};
  const ds = getTodayStr();
  if (!Array.isArray(appData.todoDoneLog[ds])) appData.todoDoneLog[ds] = [];
  const arr = appData.todoDoneLog[ds];
  const _hit = arr.filter(function (x) { return x && idEq(x.id, t.id); })[0];
  if (!_hit) {
    /* 顺手快照计划的步骤与标签：日志里的「今天完成」不能只有个标题，
       否则计划再细，回顾时也看不出这一步属于哪个计划、走到哪了。 */
    arr.push({
      id: t.id,
      title: t.title || '',
      ts: Date.now(),
      quad: t.quad || null,
      tag: t.tag || null,
      subs: snapshotPlanSubs(t)
    });
  } else if (_hit.partial) {
    /* 之前只勾了几步子计划，现在整条打勾了：把那条「推进中」升级成完成，
       不要再冒一条重复的计划名。 */
    _hit.partial = false;
    _hit.subs = snapshotPlanSubs(t);
    _hit.ts = _hit.ts || Date.now();
  }
  t.doneAt = Date.now();
  /* ★ 同时冻结"这一天本来要几点做"：完成后次日 checkNewDay 会把这条一次性计划
     整个删掉，届时日程表的预计块就无从算起。
     快照跟着"完成的那一天"走，删不删计划都不影响它。
     ★ 多段计划可能横跨好几天：每个有块的日期各冻一份，只拍主段那天会让另一天的块消失。
     已完成的计划不该在未来的日程上继续占块，所以只拍今天及以前。 */
  const _today = getTodayStr();
  const _dates = todoBlockDates(t);
  if (_dates.length) {
    _dates.forEach(function (d) { if (d <= _today) pushTodoSchedSnapshot(t, d); });
  } else {
    pushTodoSchedSnapshot(t, todoMainDateOf(t) || ds);
  }
}
function _unlogTodoDone(t) {
  const ds = t.doneAt ? getDateStr(t.doneAt) : getTodayStr();
  const arr = (appData.todoDoneLog || {})[ds];
  /* 取消完成 ≠ 今天什么都没干：手动勾过的子计划还留着，
     那就退回到「只完成了几步」，而不是整条从日志里消失。 */
  if (Array.isArray(arr)) {
    const _p = todoSubProgress(t);
    const _keep = _p.done > 0 && _p.total > 0;
    appData.todoDoneLog[ds] = arr
      .filter(function (x) { return !x || !idEq(x.id, t.id) || _keep; })
      .map(function (x) {
        if (x && idEq(x.id, t.id)) {
          x.partial = true;
          x.subs = snapshotPlanSubs(t);
        }
        return x;
      });
  }
  /* 撤回完成 = 这件事没发生过：**只撤完成那一天**的快照。
     ★ 不能按 id 全删：多段计划可能还有更早的日子（那些段已从活对象里清掉、
       只剩快照），全删会让历史那天永久少一块。 */
  dropTodoSchedSnapshot(t.id, ds);
  delete t.doneAt;
}
/* 子计划完成的流水：整条计划没打勾、只勾了里面某一步，也要在日志「今天完成」里留痕。
   记进同一张 todoDoneLog，用 partial:true 标「计划本身没完成」，主行不显示 ✅，
   改显示「1/3 步」。整条打勾后由 _logTodoDone 原地升级，不会多出一条。
   全部子计划都取消勾 → 这条也撤掉（今天对这条计划确实什么都没留下）。 */
function _syncTodoPartialLog(t) {
  if (!t) return;
  if (!appData.todoDoneLog || typeof appData.todoDoneLog !== 'object') appData.todoDoneLog = {};
  /* 整条已完成：写流水是 toggleTodo 的活，这里不掺和 */
  if (t.done) return;
  const ds = getTodayStr();
  if (!Array.isArray(appData.todoDoneLog[ds])) appData.todoDoneLog[ds] = [];
  const arr = appData.todoDoneLog[ds];
  const _at = arr.filter(function (x) { return x && idEq(x.id, t.id); })[0];
  const p = todoSubProgress(t);
  if (!p.done || !p.total) {
    /* 子计划全被取消勾：撤掉今天这条 partial（已完成历史不动） */
    if (_at && _at.partial) {
      const i = arr.indexOf(_at);
      if (i >= 0) arr.splice(i, 1);
    }
    return;
  }
  if (_at) {
    if (!_at.partial) return; /* 已整条完成的历史，别被子计划的反复勾降级 */
    _at.subs = snapshotPlanSubs(t);
    return;
  }
  arr.push({
    id: t.id,
    title: t.title || '',
    ts: Date.now(),
    quad: t.quad || null,
    tag: t.tag || null,
    subs: snapshotPlanSubs(t),
    partial: true
  });
}
function toggleTodo(id) {
  const t = appData.todos.find(x => idEq(x.id, id));
  if (t) {
    const _wasDone = t.done;
    t.done = !t.done;
    touchRecord(t);   /* 勾选/取消也是一次修改：同步要知道「这条变了」 */
/* 任务「实际完成」= 标记完成的那一刻；取消完成则抹掉（状态可逆，字段也要可逆）。
   实际开始由 stampTodoActualStart() 在第一次开番茄时落，二者都是只读快照，
   不参与任何统计口径（统计仍只看 records）。 */
    if (t.done) {
/* 每次勾上都**重打**时间戳：写 `if (!t.actualEnd)` 的话，取消再勾会留着上一次的结束时间，与实际不符。 */
      t.actualEnd = Date.now();
    } else {
      delete t.actualEnd;
    }
    if (t.done) _logTodoDone(t);
    else _unlogTodoDone(t);
    /* 勾选/取消都算「本人对今天这一轮表了态」→ 清掉"跳过本次"标记，
       否则跳过后再勾上，行还挂着「已跳过」徽标，自己跟自己打架 */
    t.skippedDate = null;
    /* 完成时仅把「尚未完成」的子任务自动打勾，并记下这批自动勾（会话级内存）；
       若紧接着取消完成，只恢复这批自动勾——手动勾过的子任务不受影响，误触也能无损反悔 */
    if (t.done && t.subs) {
      const _auto = [];
      (t.subs || []).forEach(function (s, si) {
        /* 脏项直接跳过：老存档里可能有 null，读 s.done 会抛错，连带整条列表渲染失败 */
        if (!s || typeof s !== 'object') return;
        if (!s.done) {
          s.done = true;
          _auto.push(si);
        }
      });
      if (_auto.length) {
        if (!window.__todoAutoSubs) window.__todoAutoSubs = {};
        window.__todoAutoSubs[t.id] = _auto;
      }
    } else if (!t.done && window.__todoAutoSubs && window.__todoAutoSubs[t.id]) {
      const _auto = window.__todoAutoSubs[t.id];
      (t.subs || []).forEach(function (s, si) {
        if (!s || typeof s !== 'object') return;
        if (_auto.indexOf(si) >= 0) s.done = false;
      });
      delete window.__todoAutoSubs[t.id];
    }
    /* ★ 勾上/取消勾这一下**立刻落盘**，不留 300ms 防抖窗口。
       「昨天明明完成了英语，日志里那条今天没了」：完成记录写在
       todoDoneLog 里，而 saveData() 是 300ms 后合并写一次 —— 手一快退出、
       或系统回收掉 WebView，这一下就白点了，下次打开看到的正是"没完成"。
       勾选是低频、用户亲自点的动作，同步写一次的代价（一次 JSON.stringify）
       远小于"做了等于没做"。 */
    saveDataNow();
    renderTodos();
    refreshTodoSelect();
    try {
      renderTaskSummary();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:toggleTodo'); }
    renderTimerRankStrip();
    if (timerState.linkedTodoId === id) renderTimerSubs();
    /* 任务完成微庆祝（音效 + 触感 + 轻量 toast），仅未完成→完成触发 */ if (!_wasDone && t.done) {
      playSound('taskDone');
      if (navigator.vibrate) navigator.vibrate(45);
      showToast('✅ ' + t.title);
    } else if (_wasDone && !t.done) {
      if (navigator.vibrate) navigator.vibrate(20);
    }
  }
}
function showDeleteConfirm(id) {
  __setTodoToDeleteId(id);
  showModal('deleteConfirmModal');
}
function executeDelete() {
  if (!todoToDeleteId) return;
  var _goneTodo = appData.todos.filter(x => idEq(x.id, todoToDeleteId));
  appData.todos = appData.todos.filter(x => !idEq(x.id, todoToDeleteId));
  _goneTodo.forEach(function (x) { tombstone(x.uid, 'todo'); });
  delete todoAutoSaveTimers[todoToDeleteId];
  delete expandedTodos[todoToDeleteId];
  saveData();
  renderTodos();
  refreshTodoSelect();
  showToast('已删除');
  closeModal('deleteConfirmModal');
  __setTodoToDeleteId(null);
}
/* 点任务正文 = 展开详情（等同于点最右边那个箭头）。
   原来唯一的入口是行尾一个 24px 的 ▾ —— 手机上一个 24px 的角落按钮是
   最难命中的东西，而整行 300 多像素的正文点下去什么都不会发生。
   子任务行、行内按钮要自己处理点击，所以先判来源，命中它们就不展开。 */
function todoRowTap(id, ev) {
  const t = ev && ev.target;
  if (t && t.closest && t.closest('button, a, input, .tf-sub, .todo-checkbox')) return;
  toggleTodoExpand(id);
}

/* =====「今天先不看」：眼睛按钮 =====
 * 用户要的是"这条我今天不想看到它"，不是删除、不是完成、不是跳过周期。
 * 做法：只写一个日期字段 t.eyesOff = 'YYYY-MM-DD'（那天），别的一律不动。
 *   · 不记完成记录 —— 明天它还是没做，不会平白多出一次"完成"；
 *   · 不推到下一个周期 —— 「跳过本次」管的是排期，这里管的是"看不看"；
 *   · 明天自然回来 —— 判断是字符串相等，不需要任何清理逻辑。
 * 作用范围：列表、日程网格、主页今日待办（凡是走 _todoViewGroups / 网格取数的都在内）。
 * 反馈：收起来的条数会在列表底部写出来，点一下就能全部恢复 —— 藏起来的东西必须有出口。 */
function _todoEyesDay() {
  try {
    const s = (typeof window.tbTodoSplitForDate === 'function') ? window.tbTodoSplitForDate() : null;
    if (s && s.date) return String(s.date).slice(0, 10);
  } catch (e) { console.warn('tbTodoSplitForDate 不可用，眼睛按今天算', e); }
  return getTodayStr();
}
function _todoById(id) {
  const list = appData.todos || [];
  for (let i = 0; i < list.length; i++) {
    if (String(list[i] && list[i].id) === String(id)) return list[i];
  }
  return null;
}
function eyesOffTodoToday(id) {
  const t = _todoById(id);
  if (!t) return;
  const day = _todoEyesDay();
  /* ★ 不代开总闸（2026-10-27 用户第二次报「再点一下怎么不能取消」后的修正）。
     代开总闸会让条目当场消失、卡片连同这个眼睛一起没了 —— 用户就再也点不到它取消。
     现在：闸关着时点 = 只打标记，条目照旧在列表里、按钮变实心，再点一下就取消；
     闸开着时点 = 立刻收起，逐条取消走底部回执。 */
  t.eyesOff = day;
  saveData();
  renderTodos();
  if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
  delete editingTodos[id];
  /* 闸的状态**只读不写**：它决定这条是不是现在收起来，但绝不因这次点击而改变 */
  const _gateOn = !!getSortPrefs().todos.hideDone;
  const isToday = day === getTodayStr();
  showToast('「' + (t.title || '这条计划') + '」' + (isToday ? '今天先不看了' : '这天先不看了') +
    (_gateOn ? ' · 明天会自动回来' : ' · 右侧眼睛打开后才会收起，再点它可以取消'),
    false, function () { eyesOnTodo(id); });
}
/* 点同一个眼睛就切回来 —— 用户 2026-10-27 报的「再点一下怎么不能取消」就是这个。
   之前的实现里只有"标记"，没有"取消"，再点等于又标记了一遍（幂等、毫无反馈）。 */
function toggleTodoEyesOff(id) {
  const t = _todoById(id);
  if (!t) return;
  if (t.eyesOff) { eyesOnTodo(id); return; }
  eyesOffTodoToday(id);
}
function eyesOnTodo(id) {
  const t = _todoById(id);
  if (!t || !t.eyesOff) return;
  const day = t.eyesOff;
  delete t.eyesOff;
  saveData();
  renderTodos();
  if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
  showToast('「' + (t.title || '这条计划') + '」放回 ' + day + ' 的列表了', true);
}
function toggleTodoEyeHint() {
  _todoEyeHintOpen = !_todoEyeHintOpen;
  renderTodos();
}
/* 底部"恢复"：一次性放回这一天被收起的全部（按当前查看日，不是按今天） */
function eyesOnAllTodos() {
  const day = _todoEyesDay();
  let n = 0;
  (appData.todos || []).forEach(function (t) {
    if (t && todoEyesOff(t, day)) { delete t.eyesOff; n++; }
  });
  if (!n) return;
  _todoEyeHintOpen = false;
  saveData();
  renderTodos();
  if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
  showToast('已放回 ' + n + ' 条', true);
}
function toggleTodoExpand(id) {
  /* 收起前先把展开区里未落盘的编辑落盘（只保存不重建，避免「展开态渲染 → 收起态渲染」两次重建打架） */
  if (expandedTodos[id]) forceSaveTodoDetail(id, true);
  expandedTodos[id] = !expandedTodos[id];
  if (!expandedTodos[id]) delete editingTodos[id];
  renderTodos();
}
/* 展开区里「详情」与「设置（编辑）」两种模式的切换。
   详情模式是只读的，编辑控件全部收走；点「设置」才展开表单。 */
function toggleTodoEdit(id) {
  if (editingTodos[id]) forceSaveTodoDetail(id, true);
  editingTodos[id] = !editingTodos[id];
  renderTodos();
}
function setTodoSort(by) {
  const p = getSortPrefs().todos;
  if (p.by === by && by !== 'manual') {
    p.dir = p.dir === 'asc' ? 'desc' : 'asc';
  } else {
    p.by = by;
    p.dir = TODO_SORT_DEF_DIR[by] || 'asc';
  }
  saveData();
  renderTodos();
  updateSortBarUI();
}
function toggleTodoSortDir() {
  const p = getSortPrefs().todos;
  /* 手动排序没有方向概念 */
  if (p.by === 'manual') return;
  p.dir = p.dir === 'asc' ? 'desc' : 'asc';
  saveData();
  renderTodos();
  updateSortBarUI();
}
/* 眼睛图标：睁眼 = 正在显示已完成；闭眼（带斜杠）= 已隐藏。
   内联 SVG 而不是 emoji：👁 在部分安卓字体里是彩色方块/带脸，和按钮风格不搭。 */
function tbDoneEyeSvg(hidden) {
  if (hidden) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 19C5 19 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94"/>' +
      '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/>' +
      '<path d="M1 1l22 22"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
}
/* 隐藏 / 显示「今天已完成」：只改视图开关，不动任何任务数据。
   ★ 全仓**唯一**允许写 hideDone 的地方就是这里（`rg "hideDone *=" src/scripts` 可证）。
   单条小眼睛（eyesOffTodoToday / eyesOnTodo / eyesOnAllTodos）只写 t.eyesOff，
   对闸的状态一律只读 —— 点一条计划不会把右上角那个开关连带拨动。 */
function toggleTodoDoneHidden() {
  const p = getSortPrefs().todos;
  p.hideDone = !p.hideDone;
  saveData();
  renderTodos();
  updateSortBarUI();
  /* 开关必须有回话：眼睛只变个图标，用户看不出"现在到底藏了什么"。
     打开时说清藏了两类（已完成的 + 今天不做的周期任务），并给出条数；
     关掉时说清全放出来了。条数取 renderTodos 刚算好的实际结果，不另算一套。 */
  const _nDone = _todoDoneHidden || 0;
  const _nRep = _todoRepOffCount || 0;
  const _nEye = _todoEyeOffCount || 0;
  if (p.hideDone) {
    const _parts = [];
    if (_nDone) _parts.push('已完成 ' + _nDone + ' 条');
    if (_nRep) _parts.push('今天不做的周期任务 ' + _nRep + ' 条');
    if (_nEye) _parts.push('今天先不看 ' + _nEye + ' 条');
    showToast(_parts.length ? '已隐藏：' + _parts.join('、') : '已隐藏：当前没有可藏的任务');
  } else {
    /* 关闸 = 全放出来，但单条标记不丢（明天照旧自动清），要说出来，
       不然用户会以为"点过的眼睛被这次开关取消了"。 */
    showToast('已显示全部任务' + (_nEye ? '（' + _nEye + ' 条今天先不看的标记还在，再打开眼睛仍会收起）' : ''));
  }
}
function setHabitSort(by) {
  const p = getSortPrefs().habits;
  if (p.by === by && by !== 'manual') {
    p.dir = p.dir === 'asc' ? 'desc' : 'asc';
  } else {
    p.by = by;
    p.dir = by === 'title' || by === 'checked' ? 'asc' : 'desc';
  }
  saveData();
  renderHabits();
  updateSortBarUI();
}
function toggleHabitSortDir() {
  const p = getSortPrefs().habits;
  if (p.by === 'manual') return;
  p.dir = p.dir === 'asc' ? 'desc' : 'asc';
  saveData();
  renderHabits();
  updateSortBarUI();
}
/* 手动排序：上移/下移（交换数组位置，数组顺序即显示顺序）。
   周计划视图下**显示顺序 ≠ 数组顺序**（三分组 + 排序偏好），所以不能简单 i±1：
   必须按同屏可见邻居换位——把本任务摘出来、插到目标邻居旁边。
   分组是数据驱动的（归日判定在 01eA），跨组移动不改变组成员身份，
   此时数组换位只影响组内 manual 顺序，视觉上可能不动——那是语义正确的边界。 */
function moveTodo(id, dir) {
  const _g = _todoViewGroups();
  /* 折叠的组不在屏幕上 —— 换位只能按**可见**邻居算。
     否则把任务挪到折起来的那行旁边：数组序变了、屏幕上看不出任何变化
     （"可见邻居换位"的约定就破了）。折起来的组此时视同不存在。 */
  const _vis = _g[0].concat(_carryFolded ? [] : _g[1], _g[2], _g[3]);
  const _i = _vis.findIndex(function (t) { return idEq(t.id, id); });
  if (_i < 0) return;
  const _j = _i + dir;
  if (_j < 0 || _j >= _vis.length) return;
  const _t = appData.todos.find(function (t) { return idEq(t.id, id); });
  const _nb = _vis[_j];
  if (!_t || !_nb) return;
  appData.todos.splice(appData.todos.indexOf(_t), 1);
  /* 先摘除自己，邻居在数组里的下标已生效：上移插到邻居前，下移插到邻居后 */
  appData.todos.splice(appData.todos.indexOf(_nb) + (dir > 0 ? 1 : 0), 0, _t);
  saveData();
  renderTodos();
}
function moveHabit(id, dir) {
  const i = appData.habits.findIndex(h => idEq(h.id, id));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= appData.habits.length) return;
  const h = appData.habits.splice(i, 1)[0];
  appData.habits.splice(j, 0, h);
  saveData();
  renderHabits();
}
function updateSortBarUI() {
  const p = getSortPrefs();
  /* select：手动模式显示「✋ 手动」，选字段时显示对应值 */
  const ts = document.getElementById('todoSortBy');
  if (ts) ts.value = p.todos.by;
  const hs = document.getElementById('habitSortBy');
  if (hs) hs.value = p.habits.by === 'manual' ? 'manual' : p.habits.by;
  /* 旧的两颗「✋ 手动」快捷按钮已删：它们和 select 里的「✋ 手动」是同一个
     选项的两套入口，同时显示时会出现「✋ 手动 高亮 + select 写着创建时间」
     的矛盾。排序模式只有 select 一处入口。 */
  /* 自定义顺序 / 时间块：方向按钮无意义 → 隐藏 */
  const td = document.getElementById('todoSortDir');
  if (td) {
    td.style.display = p.todos.by === 'manual' ? 'none' : '';
    td.textContent = p.todos.dir === 'asc' ? '↑' : '↓';
  }
  /* 眼睛与方向按钮并排：方向按钮在手动模式下隐藏，眼睛始终在（它是筛选，不是排序） */
  const te = document.getElementById('todoDoneToggle');
  if (te) {
    const _hide = !!p.todos.hideDone;
    te.innerHTML = tbDoneEyeSvg(_hide);
    te.title = _hide ? '显示今天已完成的任务' : '隐藏今天已完成的任务';
    te.setAttribute('aria-pressed', _hide ? 'true' : 'false');
    te.classList.toggle('is-on', _hide);
  }
  const hd = document.getElementById('habitSortDir');
  if (hd) {
    hd.style.display = p.habits.by === 'manual' ? 'none' : '';
    hd.textContent = p.habits.dir === 'asc' ? '↑' : '↓';
  }
}
/* 子任务（新增）：主计划下可拆解子步骤，可折叠展开；勾选后与计时界面同步 */
function toggleTodoSub(id, si) {
  const t = appData.todos.find(function (x) {
    return idEq(x.id, id);
  });
  if (!t || !(t.subs || [])[si]) return;
  t.subs[si].done = !t.subs[si].done;
  /* 记下勾掉的时刻：专注记录的快照按它过滤，保证「下午 3 点那条记录只算 3 点前完成的步骤」 */
  if (t.subs[si].done) t.subs[si].doneAt = Date.now();
  else delete t.subs[si].doneAt;
  /* 整条计划没打勾、只勾了里面一步，也要在日志「今天完成」里留痕（见 _syncTodoPartialLog） */
  _syncTodoPartialLog(t);
  saveData();
  renderTodos();
  if (timerState.linkedTodoId === id) renderTimerSubs();
}
function addTodoSub(id) {
  const t = appData.todos.find(function (x) {
    return idEq(x.id, id);
  });
  if (!t) return;
  const inp = document.getElementById('todo_sub_input_' + id);
  const v = inp ? inp.value.trim() : '';
  if (!v) {
    showToast('请输入子任务内容');
    return;
  }
  if (!t.subs) t.subs = [];
  t.subs.push({ id: Date.now() + Math.floor(Math.random() * 999), uid: newUid('sub'), updatedAt: Date.now(), title: v, done: false, pomodoros: null });
  saveData();
  renderTodos();
  if (timerState.linkedTodoId === id) renderTimerSubs();
  showToast('✅ 已添加子任务');
}
/* ★ `setTodoSubPomo` 已删。
   子任务「预计番茄」的写入入口在 eb5c4a4 就随输入框一起拿掉了，函数此后零调用（白名单里也没有），
   只留下一个靠 inline onclick 才能触发、而 onclick 已被删掉的悬挂符号。
   数据字段 `subs[].pomodoros` 保留不删（老存档里可能还有值），只是全站既不显示也不计入。 */
function deleteTodoSub(id, si) {
  const t = appData.todos.find(function (x) {
    return idEq(x.id, id);
  });
  if (!t || !(t.subs || [])[si]) return;
  t.subs.splice(si, 1);
  saveData();
  renderTodos();
  if (timerState.linkedTodoId === id) renderTimerSubs();
}
/* 一次勾选 / 取消全部子任务（展开态进度条右侧的按钮）。
   只改子任务，不替用户把父任务也判完成 —— 那一步该由本人决定。 */
function toggleAllTodoSubs(id, on) {
  const t = appData.todos.find(function (x) {
    return idEq(x.id, id);
  });
  if (!t) return;
  /* 父任务已完成时不动子任务：「父完成、子全未完成」是自相矛盾的状态，
     用户看到只会以为数据坏了。渲染层也不给这个按钮，这里是第二道闸。 */
  if (t.done) return;
  const subs = todoValidSubs(t);
  if (!subs.length) return;
  const want = !!on;
  const now = Date.now();
  let changed = 0;
  subs.forEach(function (s) {
    if (!!s.done !== want) changed++;
    s.done = want;
    if (want) s.doneAt = now;
    else delete s.doneAt;
  });
  /* 手动批量改过之后，上一轮「完成父任务时自动勾选」记下的下标就失效了：
     留着会让下次取消完成时按旧下标去清，可能清错行。 */
  if (window.__todoAutoSubs) delete window.__todoAutoSubs[String(t.id)];
  if (!changed) return;
  _syncTodoPartialLog(t);
  saveData();
  renderTodos();
  if (timerState.linkedTodoId === id) renderTimerSubs();
  showToast(want ? '已勾选全部 ' + subs.length + ' 个子任务' : '已取消全部子任务');
}
/* ==================================================================
 * 【段二】待办列表渲染与行级更新：renderTodos / renderTodoRowHtml /
 *   renderTodosRows / 行级签名 / 预计结束联动 / 快捷番茄 / 下拉刷新
 * ================================================================== */

/* 计划页最底部的「累计番茄」一张卡：上面是**本自然年**的一行账，下面是全历史总番茄数。
   口径：
     · 本年  = 记录日期落在「今年 1 月 1 日 ~ 今天」的番茄（折算番茄，不是时长），
               与日志页「专注记录日历」的格子是同一批数，两处必然对得上。
     · 今天  = startTime 落在今天的那部分，单独高亮，一眼看到「今天涨了多少」。
     · 总量  = 全部记录，不分年份（卡片最下方那个大数字）。
   ★ 为什么是「本自然年」而不是「近 365 天」：滚动窗口每少一天就补进一天，
     总量天天变却看不出"又涨了"；用户明确要按自然年切（元旦清零重算）。
   长数字：一律千分位精确显示（fmtPomoGrouped），**不换成「万」**——
   换成万会出现 `1.23万 + 8 = 1.23万`，两边相等，用户会以为算错了。
   位数靠字号档位收（ppcCellClass），一万位 / 十万位都放得下。 */
function planPomoTotals() {
  let total = 0,
    today = 0,
    year = 0;
  const todayStr = getTodayStr();
  const yearStart = todayStr.slice(0, 4) + '-01-01';
  (appData.records || []).forEach(function (r) {
    const p = getPomos(r);
    if (!p) return;
    total += p;
    const ds = r && r.startTime ? getDateStr(r.startTime) : '';
    if (!ds) return;              /* 没有时间的记录只进总量，不猜它属于哪一天 */
    if (ds === todayStr) today += p;
    if (ds >= yearStart) year += p;
  });
  return { total: total, today: today, year: year, before: Math.max(0, year - today) };
}
/* 字号档位：按显示串长度选。3 位以内最大 → 8 位（百万级）最小。
   5 列布局单列约 105px，8 位数字在 fs-xs 下约 90px，永远塞得下。 */
function ppcCellClass(text) {
  const len = text.length;
  if (len <= 3) return 'fs-xl';
  if (len === 4) return 'fs-l';
  if (len === 5) return 'fs-m';
  if (len === 6) return 'fs-s';
  return 'fs-xs';
}
function planPomoCell(val) {
  const s = fmtPomoGrouped(val);
  return '<span class="ppc-num ' + ppcCellClass(s) + '">' + escapeHtml(s) + '</span>';
}
function renderPlanPomoTotal() {
  const host = document.getElementById('planPomoTotal');
  if (!host) return;
  const t = planPomoTotals();
  /* 一条记录都没有：不占位置（新用户打开计划页不该先看到一屏 0） */
  if (!t.total) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML =
    '<div class="ppc">' +
    '<div class="ppc-scope">📅 本自然年</div>' +
    '<div class="ppc-eq">' +
    planPomoCell(t.before) +
    '<span class="ppc-op">+</span>' +
    '<span class="ppc-today">' + planPomoCell(t.today) + '</span>' +
    '<span class="ppc-op">=</span>' +
    planPomoCell(t.year) +
    '</div>' +
    '<div class="ppc-labels"><span>之前</span><span>今天</span><span>本年</span></div>' +
    /* 上面是本年的账，下面这截是全历史总量 —— 用户要「看上一年，同时知道一共多少」。
       标签和数字同一行：分两行会被读成两块信息，看着多余。 */
    '<div class="ppc-total"><span class="ppc-total-label">🍅 累计番茄（全部）</span>' +
    planPomoCell(t.total) + '</div>' +
    '</div>';
}

function renderTodos() {
  /* 必做区（任务列表顶部「今日必做」+ 目标页完整区块）与列表渲染解耦：
     无论列表是否为空/脏检查是否命中，都先刷新，避免提前 return 时必做消失 */
  try {
    renderPlanMustRows();
  } catch (e) { if (window.__silent) window.__silent(e, '01e-renderTodos'); }
  try {
    renderMustDoSection();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:renderTodos'); }
  /* 计划页底部的「累计番茄」：只读 records，和 dock 一样必须在早退之前刷 */
  try {
    renderPlanPomoTotal();
  } catch (e) { if (window.__silent) window.__silent(e, '01eC:renderPlanPomoTotal'); }
  /* 计划页底部的「今日习惯」dock（2026-11-04）：与计划列表解耦 ——
     它只读 habits/habitLogs，且本函数下面有多个早退 return（空态/脏检查命中），
     所以必须在函数头刷，不能写在末尾。 */
  try {
    renderPlanHabitDock();
  } catch (e) { if (window.__silent) window.__silent(e, '01eC:renderPlanHabitDock'); }
  /* 拖拽排序中：等拖拽结束再重建，避免松手瞬间列表闪烁 */
  if (document.querySelector('.todo-item.dragging')) {
    setTimeout(function () {
      try {
        renderTodos();
      } catch (e) { if (window.__silent) window.__silent(e, '01e:renderTodos'); }
    }, 200);
    return;
  }
/* 日程规划网格：**不做成单独一页**，就摆在计划列表上方，
   和下面的计划列表同屏对照；网格只管"哪个钟点在计划、哪个钟点在动"，名字交给下面的列表。 */
  try {
    if (typeof renderTimeBlockGrid === 'function') renderTimeBlockGrid();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:timeblock'); }
  /* 重建前记录正在输入的元素，重建后恢复焦点与光标（自动保存/重建不再“抢键盘”） */
  const __rfA = document.activeElement;
  const __rfId =
    __rfA && __rfA.id && (__rfA.tagName === 'INPUT' || __rfA.tagName === 'TEXTAREA' || __rfA.tagName === 'SELECT')
      ? __rfA.id
      : null;
  if (__rfId) {
    setTimeout(function () {
      try {
        const _e = document.getElementById(__rfId);
        if (_e && _e !== document.activeElement) {
          _e.focus();
          if (_e.setSelectionRange && typeof _e.value === 'string') {
            try {
              _e.setSelectionRange(_e.value.length, _e.value.length);
            } catch (e) { if (window.__silent) window.__silent(e, '01e-renderTodos'); }
          }
        }
      } catch (e) { if (window.__silent) window.__silent(e, '01e:renderTodos'); }
    }, 0);
  }
  /* 脏检查：数据没变直接跳过全量重绘（手机端反复切换页面不再卡） */
  /* 展开状态必须进脏检查签名，否则点 ▾ 后 expandedTodos 变了但签名不变，DOM 不重渲染，详情永远不显示 */
  /* ★ 修：排序偏好必须进这道脏检查签名。
     为什么：setTodoSort() 只改 sortPrefs.todos（by/dir）、不动 appData.todos，
     而旧签名只由 todos 字段拼成 → 切排序后 _sig 不变 → 命中早退 →
     「换了排序下拉，列表纹丝不动」（C46 ⑩ 抓到的真缺陷）。
     症状与 01eD 日志页 todoDoneLog 漏签名同族：数据对了、界面还是旧的。 */
  const _sp = getSortPrefs().todos;
  /* 查看日（周计划跟着网格锚定日期）。**要在脏检查签名之前算**：
     卡片上的「✅ N 段 · 共 X 分 / ⏰ 时段」依赖它（见下面 tbTodoSegList(t, _vd)），
     签名里不带日期就会「切了日期、行不重画」。 */
  const _vd = typeof window.tbAnchorDateStr === 'function' ? window.tbAnchorDateStr() : getTodayStr();
  /* 查看日进签名：眼睛会根据「今天到底轮不轮到这条周期任务」决定藏不藏，
     换了一天藏的东西就变了；签名里不带日期会「切了日期、行不重画」。 */
  const _sig = (_sp.by + ':' + _sp.dir + ':' + (_sp.hideDone ? '1' : '0') + ':' + _vd + '||') + appData.todos
    .map(function (t) {
      return (
        t.id +
        ':' +
        t.title +
        ':' +
        t.done +
        ':' +
        (t.pomodoros || 0) +
        ':' +
        (t.actualPomodoros || 0) +
        ':' +
        (expandedTodos[t.id] ? '1' : '0') +
        ':' +
        (editingTodos[t.id] ? '1' : '0') +
        ':' +
        (t.deadline || '') +
        ':' +
        (t.remindAt || '') +
        ':' +
        (t.estEnd || '') +
        ':' +
        /* 手动态进签名：同一个结束值，「自动算」与「用户指定的」标签/提示不一样，
           漏了会出现「数据变了、本行不重画」（标签还写着"自动算"）。 */
        (t.estEndManual ? 1 : 0) +
        ':' +
        todoEstEnd(t, appData.settings) +
        ':' +
        (t.tag || '') +
        ':' +
        /* 四象限（quad）必须进全量脏检查：行级签名 todoRowSig 已带 quad，
           但这里的 _sig 才是第一道门——quad 变了 _sig 没变会提前 return，
           行级签名根本没机会跑（「改了象限不刷新 / 偶发全量重建闪烁」的根因）。 */
        (t.quad || '') +
        ':' +
        String(t.detail || '').slice(0, 40) +
        ':' +
        (t.subs ? t.subs.length : 0) +
        ':' +
        (t.subs || [])
          .map(function (s) {
            /* 只进「勾没勾」：子任务的 pomodoros 已无写入口（10-17 收口），
               留在签名里只会让人误以为它还会变。
               脏项按「未完成」参与签名，别让它把签名函数本身炸掉。 */
            return s && s.done ? '1' : '0';
          })
          .join('') +
        /* 实际时段：卡片上那段「✅ …」由它算出来（唯一来源 = 记录分段 + 进行中会话）。
           不进这道签名就会出现「数据变了、DOM 不动」—— 行签名改了也没用，因为这里先 return */
        ':' + tbTodoSegList(t, _vd).map(function (s) {
          /* authMs 也进签名：卡片上的「共 X 分」读的是权威时长，
             它变了而段落没变时，签名不动就等于"数字变了界面不动" */
          return (s && s.s ? s.s : 0) + '-' + (s && s.e ? s.e : 0) + '-' + (s && s.authMs ? s.authMs : 0);
        }).join(',') +
        /* 重复规则 + 跳过本次：这两样都会改变行的长相（徽标文案、⏭ 按钮显隐），
           不进这道签名就会出现「数据变了、DOM 不动」——行签名改了也没用，因为这里先 return */
        ':' + todoRepeatSig(t.repeat) +
        ':' + (t.skippedDate || '') +
        /* ★ 「今天先不看」的标记必须进这道全量签名（2026-10-27 第三次修）。
           漏了它：点小眼睛只改 t.eyesOff，_sig 一字不变 → 函数头早退 →
           行级签名根本没机会跑（行签名里早就带了 eyesOff，等于白改）。
           症状：总闸开着点小眼睛，那一条还留在列表里、计数却少一条，
           用户看到的就是「总开关没生效」。 */
        ':' + (t.eyesOff || '') +
        /* ★ 「那个单日的添加了怎么不显示呀」—— 根因就在这一行。
           按天覆盖只改 t.dayPlan，其它字段一个不动 → _sig 不变 → 命中早退 →
           数据写进去了、界面还是「还没有哪一天单独排过」。同 C46 ⑩ 那族：数据对了、DOM 不动。 */
        ':' + Object.keys(todoDayPlanNormAll(t)).sort().map(function (d) {
          return d + '=' + todoDayPlanNormAll(t)[d].map(function (s) {
            return s.start + '~' + s.end;
          }).join(',');
        }).join(';')
      );
    })
    .join('|');
  /* 周计划：列表跟着网格的锚定日期渲染（同一个值，宿主是 01eA）。
     脏检查必须带上它——只切日期、数据没变时也要重渲，
     否则切日期后列表还是上一天那批（_sig 命中早退，行级复用帮不上忙）。
     顺带兜底：跨过午夜后 _vd 从昨天变成今天，"今天/明天"类文案也会跟着刷新。
     （_vd 本体已在函数头算好，签名要用它，这里只是注释留档。） */
  /* 折叠态跟着查看日期重置：今天=展开、非今天=折叠（规划未来时 carry 是噪音）。
     用户手动切过 → _carryFoldDs 已是当前日期，不重置，当次保留。 */
  if (_vd !== _carryFoldDs) {
    _carryFolded = !!(_vd && _vd !== getTodayStr());
    _carryFoldDs = _vd;
  }
  const _fold = _carryFolded ? 1 : 0;
  if (_sig === _todoSig && _vd === _todoViewDs && _fold === _carryFoldLast) {
    renderMustDoSection();
    renderPlanMustRows();
    return;
  }
  _todoSig = _sig;
  _todoViewDs = _vd;
  _carryFoldLast = _fold;
  renderMustDoSection();
  renderPlanMustRows();
  /* 周计划日期题头：看非今天时一句话讲清「列表只显示这天」+ 一键回今天；
     看今天时隐藏（界面与改版前逐像素一致）。 */
  (function () {
    const cap = document.getElementById('todoDateCaption');
    if (!cap) return;
    if (!_vd || _vd === getTodayStr()) {
      cap.style.display = 'none';
      cap.innerHTML = '';
      return;
    }
    const _wd = ['', '一', '二', '三', '四', '五', '六', '日'][isoWeekday(_vd)] || '';
    cap.innerHTML =
      '📅 正在看 <b>' + _vd.slice(5).replace('-', '/') + '（周' + _wd + '）</b> 的计划' +
      '<button class="tdc-back" onclick="tbGoToday()" title="回到今天的计划">回到今天</button>';
    cap.style.display = '';
  })();
  const list = document.getElementById('todoList');
  const hint = document.getElementById('todoPersistHint');
  /* 三分组建行（day 与网格同判定 / carry 之前没做完的 / undated 没设开始时间）。
     组已各自排好序；扁平拼接即屏幕顺序。 */
  const _grp = _todoViewGroups();
  const _isToday = !_vd || _vd === getTodayStr();
  const _visible = _grp[0].length + _grp[1].length + _grp[2].length + _grp[3].length;
  if (hint) hint.style.display = _visible ? 'none' : 'block';
  if (!_visible) {
    /* 隐藏已完成后可能整屏为空：这时别说"还没有计划任务"（会让人以为数据没了），
       要说清是"被藏起来了"，并给一个一键恢复的出口。 */
    const _hiddenDone = (function () {
      if (!_sp.hideDone) return false;
      const _raw = _todoSplit();
      return ['day', 'undated'].some(function (k) {
        return (_raw[k] || []).some(function (t) { return t && t.done; });
      });
    })();
    /* 只剩"今天不做的周期任务"被眼睛收起来时，同样不能说「还没有计划任务」——
       用户会说"我明明建了"（这次问的就是这个）。 */
    if (!_hiddenDone && _sp.hideDone && _todoRepOffCount > 0) {
      list.innerHTML =
        '<div class="empty-state"><span class="empty-icon">👁</span>' +
        '<div class="empty-title">今天没有要做的周期任务</div>' +
        '<div class="empty-desc">藏起了 ' + _todoRepOffCount + ' 条今天不轮到的周期任务，点右上角眼睛可以看全部</div></div>';
      return;
    }
    if (_hiddenDone) {
      if (hint) hint.style.display = 'none';
      list.innerHTML =
        '<div class="empty-state"><span class="empty-icon">👁</span>' +
        '<div class="empty-title">已完成的任务都收起来了</div>' +
        '<div class="empty-desc">点排序栏右侧的眼睛，就能重新显示</div></div>';
      return;
    }
    /* 空态分叉：今天 → 沿用原文案；非今天 → 说清「这天还没安排」，
       别让人误以为整个 App 一个任务都没有（切日期切出空列表是常态）。 */
    const _mmdd = _vd ? _vd.slice(5).replace('-', '/') : '';
    list.innerHTML = _isToday
      ? '<div class="empty-state"><span class="empty-icon">📝</span><div class="empty-title">还没有计划任务</div><div class="empty-desc">把今天最重要的一件事写下来，番茄钟会帮你搞定它 🌱</div></div>'
      : '<div class="empty-state"><span class="empty-icon">📅</span><div class="empty-title">' + _mmdd + ' 这天还没有安排</div><div class="empty-desc">给这天排个计划：切到这天后在网格里点两格，或点上面的 ＋</div></div>';
    return;
  }
  const sortBy = getSortPrefs().todos.by;
  /* 计划「搁置 N 天」（仅展示层）：**只认这条计划自己的记录**（todoId 命中的）。
     以前是按标题全库反查最近一次专注 —— 于是今天新建一条同名计划，立刻显示
     「⏳ 搁置 7 天」，好像是上周那条任务的延续。名字不是身份（见 01d 的 migrateRecordOwnership：名字只在启动迁移里用一次），
     这条计划从没专注过就老老实实不显示，比编一个天数好。 */
  const _todayKey = getTodayStr();
  const _lastByTodoId = {};
  (appData.records || []).forEach(function (_r) {
    if (!_r || _r.todoId == null) return;
    const _k = String(_r.todoId);
    const _st = _r.startTime || 0;
    if (!_lastByTodoId[_k] || _st > _lastByTodoId[_k]) _lastByTodoId[_k] = _st;
  });
  /* 细粒度 DOM 更新：行级复用。
   * 原实现 `list.innerHTML = <全部行>` 每次重建整张列表——勾选 1 个任务会销毁并重建
   * 其余所有行的 DOM（含内联输入框），靠"重建后恢复焦点"兜底，代价是丢失光标位置、
   * 触发多余 layout、展开态动画被重置。
   * 现在改为：按 id 建行级签名，**只替换签名变化的行**，其余节点原地不动。
   * 收益：勾选/改数量等局部操作不再重排整表；输入框天然不丢焦。
    */
  /* 分组题头出现条件：正在看非今天，或列表被真正分成多组。
     今天且只有一组（典型：从没设过开始时间的用户，任务全在 undated）→ 不出题头，
     列表长得跟改版前逐像素一致——新分组不打扰用不上它的人。 */
  const _nGroups = (_grp[0].length ? 1 : 0) + (_grp[1].length ? 1 : 0) + (_grp[2].length ? 1 : 0) + (_grp[3].length ? 1 : 0);
  const _showHeads = !_isToday || _nGroups > 1;
  const _rows = [];
  const _pushRows = function (ts) {
    ts.forEach(function (t) {
      _rows.push({ id: t.id, html: renderTodoRowHtml(t, sortBy, _lastByTodoId, _todayKey, _vd), sig: todoRowSig(t, _vd, _lastByTodoId[String(t.id)]) });
    });
  };
  /* 分组题头做成带 data-id 的伪行：renderTodosRows 会剥掉无 data-id 的子节点，
     不走行机制的话题头活不过下一次渲染（复用之、不每帧重建）。 */
  const _pushHead = function (id, html, sig) {
    _rows.push({ id: id, html: html, sig: sig || 'g' });
  };
  const _pushGroup = function (gi, headId, headHtml) {
    const ts = _grp[gi];
    if (!ts.length) return;
    if (_showHeads) _pushHead(headId, headHtml);
    _pushRows(ts);
  };
  _pushRows(_grp[0]); /* 当天的安排永远是第一组，不需要题头 */
  /* carry 组（之前没完成的）可折叠：题头带计数 + ▸/▾，点它 toggleCarryFold()。
     ★ 题头 sig 必须带折叠态（'gf'/'go'）——写死 'g' 的话，翻折后行机制认为题头
       "没变"，箭头就永远停在旧状态。
     ★ 折叠时题头**仍要出**（哪怕 _showHeads 为 false）：今天视图可能只剩这一组
       （全是之前没完成的），不出题头又折掉行，列表就空白了。 */
  const _carryN = _grp[1].length;
  if (_carryN) {
    const _cHead =
      '<div class="todo-group-head' + (_carryFolded ? ' is-fold' : '') + '" data-id="__grp_carry__" ' +
      'role="button" tabindex="0" onclick="toggleCarryFold()" ' +
      'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleCarryFold();}" ' +
      'title="' + (_carryFolded ? '展开' : '收起') + '之前没完成的（' + _carryN + ' 条）">' +
      '⏮ 之前没完成的 <span class="tgh-count">' + _carryN + '</span>' +
      '<span class="tgh-arrow">' + (_carryFolded ? '▸' : '▾') + '</span></div>';
    if (_showHeads || _carryFolded) _pushHead('__grp_carry__', _cHead, 'g' + (_carryFolded ? 'f' : 'o'));
    if (!_carryFolded) _pushRows(_grp[1]);
  }
  _pushGroup(2, '__grp_undated__', '<div class="todo-group-head" data-id="__grp_undated__">📌 未排期（没设开始时间，不随日期变）</div>');
  /* 「别的时候安排的」：主日期不是当前查看日的计划（未来的一次性计划、未到开始的重复计划）。
     ★ 2026-11-06：这一组受右上角那颗**总开关眼睛**管（settings.sortPrefs 的 hideDone），
       不另加组内小眼睛 —— 用户原话「我说的那个小眼睛，是那个总开关那个眼睛」。
       总开关打开时整组收起（今天只看今天的事），关掉就回来。
       网格里画得出来、列表里却够不着 → 翻回今天它就"凭空消失"，所以这组始终存在。 */
  const _odN = _grp[3].length;
  if (_odN && !_sp.hideDone) {
    _pushHead('__grp_future__',
      '<div class="todo-group-head todo-otherday-head" data-id="__grp_future__">' +
      '<span>📆 别的时候安排的 <span class="tgh-count">' + _odN + '</span></span></div>', 'go');
    _pushRows(_grp[3]);
  } else if (_odN && _sp.hideDone) {
    /* 总开关把整组藏了要留一句回执：否则列表变空，看起来像数据没了。
       用现成的 .todo-eye-hint（已经用于「周期任务被藏」），不新造控件。 */
    _pushHead('__grp_future_off__',
      '<div class="todo-eye-hint" data-id="__grp_future_off__">👁 别的时候安排的 ' + _odN + ' 条已收起（关掉右上角眼睛可看全部）</div>',
      'goff' + _odN);
  }
  /* 眼睛藏了周期任务就留一句回执：列表里少了几条却毫无交代，看起来像丢数据。
     只列前两条名字，再多就"等 N 条"，点击眼睛展开看全。 */
  if (_sp.hideDone && _todoRepOffCount > 0) {
    const _names = (_todoRepOffCache || []).map(function (id) {
      const t = (appData.todos || []).filter(function (x) { return String(x.id) === String(id); })[0];
      return t ? String(t.title || '') : '';
    }).filter(Boolean);
    const _shown = _names.slice(0, 2).join('、') + (_names.length > 2 ? ' 等 ' + _names.length + ' 条' : '');
    _pushHead('__eye_rep_off__',
      '<div class="todo-eye-hint" data-id="__eye_rep_off__" role="button" tabindex="0" ' +
      'onclick="toggleTodoDoneHidden()" ' +
      'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();toggleTodoDoneHidden();}" ' +
      'title="今天不轮到的周期任务，点这里看全部">👁 今天不做的周期任务 ' + _todoRepOffCount + ' 条' +
      (_shown ? '：' + escapeHtml(_shown) : '') + '</div>', 'ge' + _todoRepOffCount);
  }
  /* 眼睛（单条「今天先不看」）的回执：只有总闸开着才真藏了人，才需要交代。
     闸关着时列表里一条不少，不该冒出"藏了 N 条"的说明。点一下全部放回。 */
  if (_sp.hideDone && _todoEyeOffCount > 0) {
    const _eyeDay = _todoEyesDay();
    const _eyeWhen = _eyeDay === getTodayStr() ? '今天' : '这天';
    const _many = _todoEyeOffCount > 1;
    let _eh =
      /* ★ 必须包一层：renderTodosRows 只取 innerHTML 的 firstElementChild，
         两个并列元素的话第二个（逐条清单）会被直接丢掉。 */
      '<div class="todo-eye-wrap" data-id="__eye_off__">' +
      '<div class="todo-eye-hint" role="button" tabindex="0" ' +
      'onclick="' + (_many ? 'toggleTodoEyeHint()' : 'eyesOnAllTodos()') + '" ' +
      'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' +
      (_many ? 'toggleTodoEyeHint()' : 'eyesOnAllTodos()') + ';}" ' +
      'title="' + (_many ? '点开可以逐条放回；一条都不想看就直接全部放回' : '点一下把它放回列表；明天它也会自己回来') + '">' +
      '👁 ' + _eyeWhen + '先不看 ' + _todoEyeOffCount + ' 条 · ' +
      (_many ? (_todoEyeHintOpen ? '收起清单' : '点这里逐条放回') : '点这里放回') +
      '</div>';
    /* 条目一藏卡片就没了，所以底部必须能逐条点回来（不然用户只能"全部放回"）。 */
    if (_many && _todoEyeHintOpen) {
      _eh += '<div class="todo-eye-list">' + _todoEyeOffList.map(function (x) {
        return '<button class="todo-eye-chip" onclick="eyesOnTodo(\'' + String(x.id).replace(/'/g, "\\'") + '\')" ' +
          'title="把「' + String(x.title).replace(/"/g, '&quot;') + '」放回列表">' +
          escapeHtml(x.title) + ' <span class="todo-eye-chip-x">✕</span></button>';
      }).join('') +
        '<button class="todo-eye-chip is-all" onclick="eyesOnAllTodos()">全部放回</button></div>';
    }
    _eh += '</div>';
    _pushHead('__eye_off__', _eh, 'ge' + _todoEyeOffCount + (_todoEyeHintOpen ? 'o' : 'c'));
  }
  renderTodosRows(list, _rows);
  renderTodoDetailTagChips();
}/* 题头点击：折叠/展开「之前没完成的」。手动切过的态**当次保留**
   （_carryFoldDs 记成当前日期，重渲/数据变化都不弹回）；
   切到别的日期再按默认（今天展开 / 非今天折叠）走。 */
function toggleCarryFold() {
  _carryFolded = !_carryFolded;
  _carryFoldDs = typeof window.tbAnchorDateStr === 'function' ? window.tbAnchorDateStr() : getTodayStr();
  renderTodos();
}
/* 单行 HTML 生成（纯函数：数据 → 字符串，无副作用，便于行级复用与测试） */
function renderTodoRowHtml(t, sortBy, _lastByTodoId, _todayKey, _dateStr) {
  {
      const isExpanded = expandedTodos[t.id] === true;
      const _tagSafe = function (s) {
        return escapeHtml(s || '').replace(/"/g, '&quot;');
      };
      const _todayS = getTodayStr();
      /* ===== 折叠态只留「这一刻要做的事」=====
         截止日与重复规则不再挂在标题行（用户 10-19：一行里塞标签/象限/标题/重复/日期/时间/
         实际/番茄，寸土寸金，"另排 1 段"都算喧宾夺主）。两者在**展开后**的 meta 里原样可查，
         所以信息没丢，只是从"天天可见"降级成"要看时可见"。 */
      const _rpRule = normTodoRepeat(t.repeat);
      const _rpNext = _rpRule && _rpRule.next ? _rpRule.next : '';
      const _skippedToday = !!(_rpRule && t.skippedDate && t.skippedDate === _todayS);
      const _rpDue = !!(t.repeat && !t.done && _rpNext && _rpNext <= _todayS);
      /* 提醒时间与排期是**两个字段**，卡片上各走各的出口：
         提醒 → 标题行 ⏰ HH:MM；排期 → 下方「排期」区（见 _segView）。
         本节只保留 _est，用于编辑面板的「🏁 结束」元信息。 */
      const _est = todoEstInfo(t, appData.settings);
      /* 时间图标按**内容**分，不随「到没到点」变脸：
         设了提醒（= 预计开始）→ ⏰ 橙色调，表示「这一条到点会响」；
         没设提醒、只有按预计🍅推算/手填的时段 → 🕒 常规色调，表示「这只是个时段，不响」。
         规则只看 remindAt 有没有填，和时间流逝无关，所以同一张卡片不会自己换图标。
         ★ 段数**不在卡片上显示**：标题行已经够挤（标签/象限/标题/重复/日期/时间/实际/番茄），
           多一个数字只是噪音。排了几段去设置面板看，或者看上方网格。 */
      /* 备注卡里的「排期」：只读展示，**不写进 t.detail**。
         用户 10-19 的诉求是「截图给监督老师看每一段几点到几点」，
         写进备注会污染他自己的文字，所以这里是渲染层生成的一段。
         ★ 三个口径：
           1. 日期锚在**正在看的那天**（_dateStr），不是永远今天；
           2. 历史日优先读快照 —— 那天的段可能已被日切从活对象上清掉；
           3. 时间走 tbMinLabel（尊重 12/24 小时制）。 */
      const _vdate = _dateStr || getTodayStr();
      const _dayScheds = (appData.todoSchedLog && appData.todoSchedLog[_vdate]) || null;
      /* ★ 过去的日子不显示排期：昨天 9:00–9:30 摆在今天没有任何用处
         （那天已经过去，做没做由「之前没完成的」这个分组本身说明）。
         日切本来就会把 once 计划的 remindAt 清掉，所以多数情况下这里筛不到东西；
         但日切没跑（窗口一直开着、跨了午夜）时旧段还挂着，靠这一层兜住。
         只在**看今天**时筛：翻到历史日看那时的安排是正常的。 */
      const _todayStr = getTodayStr();
      const _segsAll = todoScheduleLines(t, _vdate, appData.settings, _dayScheds, _todayStr);
      const _segs = _segsAll.filter(function (r) {
        if (_vdate !== _todayStr) return true;
        return String(r.date || '') >= _todayStr;
      });
      /* 段之间没有主次，谁也不用标"主 / 另排"。 */
      /* 标题行已经印了第一段（"7:00~8:00"），这里只列**其余段**。
         否则同一段时间在卡片上出现两遍 —— 
         「我不都有排期吗？为什么要显示两遍排期？」 */
      /* ★ 排期只有一个出口：**所有段都进下面的「排期」区**，1 段也进。
         不再按段数换写法 —— 被三种写法绕晕了：
           多段 → 排期区；1 段有提醒 → 标题行「⏰ 8:20~9:00」；
           1 段没提醒 → 标题行「🕒 8:30~9:20」（他还以为是实际完成时间）。
         现在规则一句话：**标题行只放提醒（⏰ HH:MM），排期一律在「排期」区**。
         图标语义也随之收敛：⏰ = 到点会响；不再有 🕒 这个"其实是排期"的图标。 */
      const _segsMulti = _segs.length > 1;
      const _restSegs = _segs;
      /* ★ 被按天覆盖的那天：_segs 只含覆盖段，模板那几段不在里面。
         但「其余日子」还是模板 —— 得替它写一行，否则容易以为模板被改掉了。
         只在"这天确有覆盖"时才算（其它天 _segs 本身就是模板，不用另写）。 */
      const _fixedTplSegs = (function () {
        if (!_rpRule || !todoDayPlanOn(t, _vdate).length) return [];
        return todoBlocksOf(t, appData.settings).map(function (b) {
          return tbMinLabel(tbHHMMToMin(b.start)) + '–' + tbMinLabel(tbHHMMToMin(b.end));
        });
      })();
      const _segView = _restSegs.length
        ? '<div class="tf-note-sched">' +
          '<div class="tf-note-sched-head"><span class="tf-note-sched-label">排期' +
            (_segsMulti ? ' · ' + _segs.length + ' 段' : '') + '</span></div>' +
          (function () {
            /* ★ 展开态写**完整年月日** —— 隔天排期光有时分会分不清是哪天。
               同一天的几段共用一个日期头，不从段行里各写一遍（那是重复，不是精度）。
               ★ 但**重复任务的模板段不写日期**（同一天）—— 那天的日期是平移算出来的，
               写死就成了「只有这一天这样」。日期头换成规则文案（每天 / 每周一、三）。
               只有**按天覆盖**的段（fixed）才是真的某一天，写日期并标「仅这天」。 */
            const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const _repTxt = todoRepeatLabel(t.repeat);
            const dayHead = function (ds, tag) {
              const p = String(ds).split('-');
              const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
              const wd = isNaN(d.getTime()) ? '' : ' ' + WD[d.getDay()];
              return '<div class="tf-sched-day">' + escapeHtml(ds) + wd +
                (tag ? '<span class="tf-sched-tag">' + escapeHtml(tag) + '</span>' : '') + '</div>';
            };
            /* 分组键：重复模板段合成一组（它们共享同一个"每次"的语义），其余按日期分 */
            const _grp = function (x) { return x.rep ? '__rep__' : (x.date || _vdate); };
            const _head = function (x) {
              if (x.rep) {
                return '<div class="tf-sched-day tf-sched-day--rep" title="重复规则的默认排期：' +
                  escapeHtml(_repTxt) + '都按这个时间来；要改某一天请用下面的「单日」">' +
                  escapeHtml(_repTxt || '重复') + '</div>';
              }
              return dayHead(x.date || _vdate, x.fixed ? '仅这天' : '');
            };
            let out = '';
            let curK = null;
            _restSegs.forEach(function (x) {
              const k = _grp(x);
              if (k !== curK) {
                if (curK !== null) out += '</span></div>';
                curK = k;
                out += '<div class="tf-sched-row">' + _head(x) + '<span class="tf-sched-segs">';
              } else {
                out += '<span class="tf-sched-sep">·</span>';
              }
              const _t = tbMinLabel(x.start) + '–' + (x.nextDay ? '次日 ' : '') + tbMinLabel(x.end);
              /* 每段各自到点提醒
                 —— 长按能看到这一段会在几点响，免得以为只有主段会提醒。 */
              out += '<span class="tf-view-seg" title="到 ' + escapeHtml(tbMinLabel(x.start)) + ' 会提醒一次">' +
                '<span class="tf-view-seg-time">' +
                escapeHtml(_t) + '</span></span>';
            });
            if (curK !== null) out += '</span></div>';
            /* ★ 被按天覆盖的那天，模板本身**没有行**了（覆盖整组替换模板）。
               只写「仅这天」会让人以为模板也被改了/丢了 —— 补一行「其余日子」把它写出来：
               这样「今天 7:00–7:40」和「其余每天 21:00–21:30」并排，两个都还在。 */
            if (_fixedTplSegs.length) {
              out += '<div class="tf-sched-row tf-sched-row--tpl">' +
                '<div class="tf-sched-day">其余日子</div><span class="tf-sched-segs">' +
                '<span class="tf-view-seg"><span class="tf-view-seg-time">' +
                escapeHtml(_fixedTplSegs.join(' · ')) + '</span></span>' +
                '<span class="tf-sched-day tf-sched-day--rep">' + escapeHtml(_repTxt || '重复') +
                '</span></span></div>';
            }
            return out;
          })() +
          '</div>'
        : '';
      /* 标题行：**只有提醒**。没设提醒就什么都不印（排期在下面写着，不必在这里复述）。
         ★ 过去的日子连提醒也不印：昨天的 9:00 今天不会响，留着只是噪声。
         将来的要带日期 —— 光写「⏰ 9:00」会被读成「今天 9:00 要响」。 */
      const _rmDate = t.remindAt ? String(t.remindAt).replace('T', ' ').slice(0, 10) : '';
      const _rmHM0 = t.remindAt ? fmtClockHM(String(t.remindAt).replace('T', ' ')) : '';
      const _rmToday = !!_rmDate && _rmDate === _vdate;
      const _rmPast = !!_rmDate && _rmDate < _todayStr;
      const _rmDayTxt = _rmDate ? _rmDate.slice(5).replace('-', '/') + ' ' : '';
      const _timeT = (_rmHM0 && !_rmPast)
        ? `<span class="todo-remind${_rmToday ? '' : ' todo-remind--off'}" title="${_rmToday
            ? '今天 ' + escapeHtml(_rmHM0) + ' 到点会响'
            : escapeHtml(_rmDate.slice(5).replace('-', '/')) + ' ' + escapeHtml(_rmHM0) +
              ' 的提醒（不是今天，今天不会响）'}">⏰ ${escapeHtml(_rmToday ? _rmHM0 : _rmDayTxt + _rmHM0)}</span>`
        : '';
      /* 实际起止：只在有快照时才出现，跟「预计时段」并排 = 计划 vs 实际一眼对照。
         ★ 中途去做别的任务再回来 = 两段，这里要**逐段**列出来，
           只印"首段起点 ~ 末段终点"会把中间离开的那段也算成在做这件事。
         ★ 逐段铺开印时间会把卡片行撑爆，所以**按段数换写法**：
             1 段 → 照旧印时段（沿用全域时制，与「预计时段」写法一致）
             ≥2 段 → 只印「N 段 · 共 X 分」（＋进行中），完整时间轴移进 tooltip
           依据：几点到几点、块有多长，上方日程网格本来一眼就看得到，卡片行不必再抄一遍；
           这里真正要给的信息是「这件事今天被分成了几次、一共花了多久」。
           「共 X 分」= 各段时长之和（进行中的那段算到此刻），**不含**中途离开的空档。 */
      const _actRange = (() => {
        /* 唯一来源：已结算记录里的分段 + 进行中会话（见 01d tbTodoSegList）。
           不再退回读 actualStart/actualEnd —— 那快照留着的后果就是"记录删了、色块又画回来"。 */
        const list = tbTodoSegList(t, _dateStr);
        if (!list.length) return '';
        if (list.length === 1) {
          const sg = list[0];
          const s = sg.s ? fmtStampHM(sg.s) : '';
          if (!s) return '';
          if (!sg.e) return s + '~进行中';
          /* 结束端照写完整时刻：12 小时制已不带「上午/下午」前缀，没有前缀可省。
             （用定长切片去省"同前缀"的旧写法会出错，比如把 3:12~12:14 压成 3:12~12 —— 已删。） */
          return s + '~' + fmtStampHM(sg.e);
        }
        /* ★ 时长不吃区间：权威值来自记录的 effectiveSeconds（tbTodoFocusMs）。
           段落只决定「什么时候、分几段」。这样即使某天段落被误收/裁过，
           卡片上的分钟数也不会跟着歪 —— super-productivity 的 timeSpentOnDay 就是这条原则。 */
        const now = Date.now();
        const mins = tbTodoFocusMs(t, _dateStr, now) / 60000;
        const open = list.some(function (sg) { return sg.s && !sg.e; });
        return list.length + ' 段 · 共 ' + Math.max(1, Math.round(mins)) + ' 分' + (open ? ' · 进行中' : '');
      })();
      const _actRangeTitle = (() => {
        const raw = tbTodoSegList(t, _dateStr);
        if (raw.length <= 1) return '实际：第一次开始计时 → 暂停/打断就收一段，回来接着做就是新的一段';
        const hm = function (ms) { return ms ? fmtStampHM(ms) : ''; };
        return '实际共 ' + raw.length + ' 段（中途离开的时间不算在内）：' +
          raw.map(function (sg) { return hm(sg.s) + '~' + (sg.e ? hm(sg.e) : '进行中'); }).join(' · ');
      })();
      const _actualT = _actRange
        ? `<span class="todo-actual" title="${escapeHtml(_actRangeTitle)}">✅ ${_actRange}</span>`
        : '';
      const _cbHtml = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect class="cb-shape" x="2.5" y="2.5" width="19" height="19" rx="6"/><polyline class="cb-check" points="6,12 10.5,16.5 18,8"/></svg>`;
      const isEditing = isExpanded && editingTodos[t.id] === true;
      /* 预计番茄：只看任务本身填的 pomodoros，子任务不计入 */
      const _estPomos = todoEstPomos(t);
      const pomoText = formatPomodoros(_estPomos);
      const _pomoTitle = '预计番茄数';
      const actual = t.actualPomodoros || 0;
      const _spentSec = t.timeSpent || 0;
      const _spentTxt = _spentSec >= 60 ? Math.round(_spentSec / 60) + '分钟' : _spentSec > 0 ? _spentSec + '秒' : '';
      /* 「搁置 N 天」灰字小签：未完成且距上次专注 ≥2 天才显示，1 天内不出现、不占位。
         天数由 todoStallDays 统一算（签名也用同一函数）——同一条规则写两遍必然漂移。 */
      const _gapTxt = (function () {
        const _days = todoStallDays(t, _lastByTodoId[String(t.id)], _todayKey);
        if (!_days) return '';
        return '<span style="font-size:var(--fs-body);color:var(--text-light);flex-shrink:0;" title="距离上次专注 ' + _days + ' 天">⏳ 搁置 ' + _days + ' 天</span>';
      })();
      const previewHtml =
        !isExpanded && t.detail ? `<div class="todo-detail-preview">${escapeHtml(t.detail)}</div>` : '';
      /* 折叠态也要能看见「还排了别的时段」。
         只列**另排段**：主段的时间标题行已经写了，再列一遍是重复；
         段数不写数字（「N 段」显得臃肿），直接把时段摊出来。 */
      /* 只有**多段**才额外占一行：单段时标题行的时间就是它，再来一行是重复。 */
      const _offSegs = _restSegs;
      /* 重复计划在**不命中的日子**（今天周二、规则是每周三）：上面什么都画不出来，
         折叠态就只剩一个「⏰ 10/21 10:00」，看起来像今天 10 点要做。补一行说清
         这是哪种重复 —— 只写规则，时间交给上面那个带日期的 ⏰（同一份信息只给一个出口）。
         ★ 判据必须带 `t.remindAt`：「每天」但没排任何时段的清单项也画不出块，
           可它今天随时能做，写「今天不做」是错的。只有**排了时段却没轮到今天**才算。 */
      /* 折叠态只留一个重复符号，不写「每天」「每周日 至 12/31」这类周期文案 ——
         折叠卡片是"扫一眼看有什么"的地方，周期属于细节，展开后 meta 徽标里看。
         （用户 2026-10-25：「重复至多少应该在折叠展开的时候才看到，
          甚至那个重复每天也不应该显示，显示一个重复的符号就可以了」）
         ★ 留符号而不是全删：不写符号，就分不出「每次都要做」和「就今天这一次」。
         ★ 今天不轮到时符号变淡 + title 说明。原来那行用「· 今天不做」几个字讲这件事，
         现在没有文字位了，改用视觉差异表达，信息不丢。 */
      const _repBadge = (function () {
        if (isExpanded || !t.repeat) return '';
        const lbl = todoRepeatLabel(t.repeat);
        if (!lbl) return '';
        const _off = !todoRepeatMatches(t.repeat, _vdate);
        const _tip = (_off ? '今天不做 · ' : '') + '重复规则：' + lbl;
        return '<span class="todo-rep-badge' + (_off ? ' todo-rep-badge--off' : '') +
          '" title="' + escapeHtml(_tip) + '" aria-label="' + escapeHtml(_tip) + '">🔄</span>';
      })();
      const _segInline = (!isExpanded && _offSegs.length > 0)
        ? '<div class="todo-extra-line"><span class="todo-extra-k">排期</span><span class="todo-extra-v">' +
          _offSegs.map(function (x) {
            /* 重复任务的模板段不写日期（日期是平移算出来的，写出来就是假精度）；
               按天覆盖的段（fixed）日期是真的，要写；一次性任务本来就要写。 */
            const _d = (x.rep || x.date === _vdate) ? '' : x.date.slice(5).replace('-', '/') + ' ';
            /* 每段各自到点提醒：长按这段能看到它会在几点响 */
            return '<span title="到 ' + escapeHtml(tbMinLabel(x.start)) + ' 会提醒一次">' +
              escapeHtml(_d + tbMinLabel(x.start) + '–' + (x.nextDay ? '次日 ' : '') + tbMinLabel(x.end)) +
              '</span>';
          }).join('<span> · </span>') +
          '</span></div>'
        : '';
      /* 子任务列表：跟着待办正文走 —— 折叠时也能看见、能直接勾（老版本就是这个行为）。 */
      const subsListHtml = todoValidSubs(t).length
        ? `<div class="tf-subs">${(t.subs || [])
            .map(
              (s, si) => {
                /* ★ 脏项必须在这里挡住：老存档里混进 null/字符串时，
                   直接读 s.done 会抛 TypeError，**整条列表**都渲染不出来
                   （不是少一行，是整屏白）。si 仍用原数组下标 —— 勾选/删除都按它定位。 */
                if (!s || typeof s !== 'object') return '';
                return `<div class="tf-sub${s.done ? ' done' : ''}">
    <div class="sub-cb ${s.done ? 'checked' : ''}" onclick="toggleTodoSub(${idArg(t.id)},${si})" title="${s.done ? '点击取消完成' : '点击标记完成'}">${SUB_CB_SVG}</div>
    <span class="tf-sub-txt">${escapeHtml(s.title)}</span>
    ${
      /* 子任务的「预计番茄」不再渲染（用户 10-15：子任务只是显示，不该在行里再挂一个番茄数，
         否则折叠态每行都拖着「半个🍅/1🍅」很乱）。数据字段 s.pomodoros 保留不清，
         只是不显示、也不计入父计划的预计总数。 */
      ''
    }
    ${
      isEditing
        ? `<span class="tf-sub-del" onclick="deleteTodoSub(${idArg(t.id)},${si})" title="删除子任务">✕</span>`
        : ''
    }
  </div>`;
              }
            )
            .join('')}</div>`
        : '';
      /* 子任务进度（对标滴答清单的清单进度）：只在展开态出现 ——
         折叠态连段数都不显示，再挂一条进度条就违背"寸土寸金"。
         全部完成时按钮变「全部取消」，避免出现一个点了没反应的按钮。 */
      const _sp = todoSubProgress(t);
      /* 已完成的任务不给「全部勾选/取消」：会出现「父完成、子全未完成」的矛盾态。
         进度条本身留着 —— 那是事实，不让人改。 */
      const _subProgHtml = _sp.total
        ? `<div class="tf-sub-prog">
    <span class="tf-sub-prog-txt">子任务 ${_sp.done}/${_sp.total}</span>
    <span class="tf-sub-prog-bar" role="progressbar" aria-valuenow="${_sp.pct}" aria-valuemin="0" aria-valuemax="100" title="${_sp.pct}% 完成"><i style="width:${_sp.pct}%"></i></span>${
      t.done
        ? ''
        : `<button class="tf-sub-prog-btn" onclick="event.stopPropagation();toggleAllTodoSubs(${idArg(t.id)},${_sp.done < _sp.total ? 1 : 0})">${_sp.done < _sp.total ? '全部勾选' : '全部取消'}</button>`
    }
  </div>`
        : '';
      /* 添加子任务只在编辑模式露出，免得每一行都挂个输入框。 */
      const subsAddHtml = isEditing
        ? `<div class="tf-sub-add">
    <input class="tf-input" type="text" id="todo_sub_input_${t.id}" placeholder="添加子任务…" onkeydown="if(event.key==='Enter')addTodoSub(${idArg(t.id)})">
    <button class="btn-small" onclick="addTodoSub(${idArg(t.id)})">＋ 添加</button>
  </div>`
        : '';
      /* 详情模式（只读）：把「这条任务是什么」摊开看，不放任何输入框。
         编辑控件（备注框 / 日期 / 标签 / 番茄）统一收进「设置」，点一下才出现。 */
      const viewPanel = isExpanded && !isEditing
        ? `<div class="tf-view">
        <div class="tf-view-note">
          <div class="tf-note-txt${t.detail ? '' : ' tf-view-note--empty'}">${
            t.detail ? escapeHtml(t.detail) : '还没有备注，点「设置」补一条'
          }</div>
        </div>
        ${_segView}
        <div class="tf-view-meta">
          <span class="tf-meta-item${t.remindAt && !t.reminded ? ' on' : ''}">⏰ ${
            t.remindAt ? escapeHtml(fmtClockHM(String(t.remindAt).replace('T', ' '))) : '未设提醒/开始'
          }</span>
          <span class="tf-meta-item">🏷 ${t.tag ? escapeHtml(t.tag) : '无标签'}</span>
          <span class="tf-meta-item${_rpRule ? ' on' : ''}" title="${_rpRule && _rpRule.until ? '重复到 ' + _rpRule.until + ' 为止' : '一直重复'}${_rpRule && _rpRule.subsMode === 'clear' ? ' · 次日子任务清空' : (_rpRule && _rpRule.subsMode === 'clearDone' ? ' · 次日子任务只留未完成' : ' · 次日子任务全部重置')}">🔄 ${_rpRule ? todoRepeatLabel(_rpRule) : '不重复'}${_rpRule && _rpRule.subsMode === 'clear' ? ' · 子任务次日清空' : (_rpRule && _rpRule.subsMode === 'clearDone' ? ' · 子任务次日只留未完成' : '')}${_skippedToday ? ' · 本次已跳过' : ''}</span>
          <span class="tf-meta-item" title="任务的预计番茄数">预计 ${
            _estPomos > 0 ? formatPomodoros(_estPomos) : '未设'
          }</span>
          <span class="tf-meta-item${_est.auto ? ' on' : ''}"${
            _rpRule ? ' title="重复计划的结束时刻跟着模板走，没有固定日期"' : ''
          }>🏁 ${
            _est.end
              ? escapeHtml(_rpRule
                  ? ((_est.end.split(' ')[1] || _est.end) + '（每次）')
                  : _est.end)
              : '未设结束'
          }</span>
        </div>
        ${_subProgHtml}
        ${subsListHtml}
        <div class="tf-actions">
          ${
            /* 只保留「跳过本次」：重复任务今天不做时说一声，不记完成、不计番茄。
               复制任务 / 顺延到明天已移除，
               不是隐藏按钮 —— 底层函数也一并删掉，不留死代码。 */
            (_rpRule && _rpDue && !_skippedToday)
              ? `<button class="btn-small" onclick="event.stopPropagation();skipTodoOccurrence(${idArg(t.id)})" title="今天不做，推到下次；不记完成、不计番茄">⏭ 跳过本次</button>`
              : ''
          }
          <button class="btn-small tf-eye${(typeof todoEyesOff === 'function' && todoEyesOff(t, _todoEyesDay())) ? ' is-on' : ''}" onclick="event.stopPropagation();toggleTodoEyesOff(${idArg(t.id)})" title="${(typeof todoEyesOff === 'function' && todoEyesOff(t, _todoEyesDay())) ? '再点一下取消「今天先不看」' : '今天先不看这条：和右上角那个眼睛是同一套——打开它，点过的就一并收起；只影响今天，明天自动回来，不记完成、不改下次到期'}" aria-pressed="${(typeof todoEyesOff === 'function' && todoEyesOff(t, _todoEyesDay())) ? 'true' : 'false'}" aria-label="今天先不看">👁</button>
          <button class="btn-small" onclick="event.stopPropagation();toggleTodoEdit(${idArg(t.id)})" style="padding:var(--sp-6) var(--sp-16);">⚙ 设置</button>
        </div>
      </div>`
        : '';
      /* 编辑模式：标题 / 备注 / 最晚完成日 / 提醒 / 标签 / 预计番茄 / 子任务添加 + 上移下移删除 */
      /* 排期段 = 全部段，一段一个 chip，点 × 删这一段。
         ★ 起没有「主段 / 另排」之分：段之间只有先后，没有主次。
           加段时就不允许重叠，所以这里也不必再标"重叠"。 */
      /* ===== 单独某天的排期（dayPlan）= 重复计划"哪天不一样"的唯一出口 =====
       * 「每天」的重复计划只有一套模板，哪天想改就得连以后一起改。
       * 这一行只动**那一天**：选日期 + 起止 → 那天换成独立一套；× 就回到模板。
       * 只给重复计划显示 —— 一次性计划的段本来就能随便排到任何一天。 */
      const _dpAll = todoDayPlanNormAll(t);
      const _dpDays = Object.keys(_dpAll);
      /* ★ 默认值取**模板第一段**的时刻：
         大多数情况只是"把这天挪到别的时间"，预填模板时间只要改个日期 + 调时分，
         不用从 19:00 开始凭空填。没有模板段时退回 19:00–20:00。 */
      const _dpTpl0 = (todoBlocksOf(t, appData.settings) || [])[0];
      const _dpTplS = _dpTpl0 ? (tbMinToHHMM(tbHHMMToMin(_dpTpl0.start)) || '19:00') : '19:00';
      const _dpTplE = _dpTpl0 ? (tbMinToHHMM(tbHHMMToMin(_dpTpl0.end)) || '20:00') : '20:00';
      const _dpChips = _dpDays.map((ds) => {
        const _segsTxt = _dpAll[ds].map((b) => {
          const _s1 = tbHHMMToMin(b.start), _e1 = tbHHMMToMin(b.end);
          /* ★ 用 24 小时制：tbMinLabel 跟系统设置走 12 小时制，19:00 会印成「7:00」 */
          return (_s1 == null ? '' : tbMinToHHMM(_s1)) + '–' + (_e1 == null ? '' : tbMinToHHMM(_e1));
        }).join(' / ');
        return `<span class="tf-chip tf-chip--dayplan" title="这一天单独排：${escapeHtml(_segsTxt)}；改它不影响别的日子">📌 ${ds.slice(5)} ` +
          escapeHtml(_segsTxt) +
          `<b class="tf-chip-x" role="button" tabindex="0" aria-label="恢复这一天的默认排期" title="恢复这一天的默认排期" ` +
          `onclick="event.stopPropagation();tbDayPlanClear(${idArg(t.id)}, '${ds}')">×</b></span>`;
      }).join('');
      const _dpDefaultDate = /^\d{4}-\d{2}-\d{2}$/.test(String(_vdate)) ? _vdate : getTodayStr();
      const _dayPlanRow = (isEditing && _rpRule)
        ? `<div class="tf-row">
          <div class="tf-label">单日</div>
          <div>
            <div class="tf-chips">
              ${_dpChips || '<span class="tf-chip tf-chip--muted">还没有哪一天单独排过</span>'}
            </div>
            <div class="tf-dp-form">
              <input class="tf-input tf-input--date" type="date" id="todo_dp_date_${t.id}" value="${_dpDefaultDate}" title="哪一天要不一样">
              <div class="tf-dp-line">
                <input class="tf-input tf-input--time" type="time" id="todo_dp_start_${t.id}" value="${_dpTplS}" title="这天从几点开始">
                <span class="tf-dp-dash">–</span>
                <input class="tf-input tf-input--time" type="time" id="todo_dp_end_${t.id}" value="${_dpTplE}" title="这天到几点结束">
              </div>
              <div class="tf-dp-line">
                <button class="btn-small" style="padding:var(--sp-6) var(--sp-14)" onclick="event.stopPropagation();tbDayPlanApply(${idArg(t.id)})" title="把这段时间排到这一天：这天的排期整组换成这个时间，模板和别的日子都不动。">排到这天</button>
                <button class="btn-small" style="padding:var(--sp-6) var(--sp-12);margin-left:var(--sp-6)" onclick="event.stopPropagation();tbDayPlanArm(${idArg(t.id)})" title="不用手输：去日程表点两格，那一天就按你点的那段排（只改你点的那天）">在日程表选</button>
              </div>
            </div>
            <div class="tf-hint" style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-4)">只改这一天，别的日子不动；点 📌 上的 × 恢复成模板时间。</div>
          </div>
        </div>`
        : '';
      const _isRepPlan = !!normTodoRepeat(t.repeat);
      const _rpLabelTxt = _isRepPlan ? todoRepeatLabel(t.repeat) : '';
      const _blockChips = todoBlocksOf(t, appData.settings).map((b) => {
        const _sm = tbHHMMToMin(b.start);
        const _em = tbHHMMToMin(b.end);
        /* ★ 一次性任务写**完整年月日**（「展开或者设置的，还有添加那里，
           要精确到年月日」）—— 隔天排期光有时分会分不清是哪天。
           ★ 重复任务的模板段**不写日期**（同一天需求：「既然重复的，刨开那个单日排期，
           为什么它还会精确到日呢？这会让人产生误解吧」）：日期是"从哪天起生效"的内部值，
           每次都会平移，写出来就成了"只在这一天"。规则文案已经在「排期」标签里写明。 */
        const _hhmm = (_sm == null ? '' : tbMinLabel(_sm)) + '–' + (_em == null ? '' : tbMinLabel(_em));
        const _txt = _isRepPlan ? _hhmm : b.start.slice(0, 10) + ' ' + _hhmm;
        const _title = _isRepPlan
          ? '重复规则的默认排期（' + _rpLabelTxt + '）：' + _hhmm + '。要改某一天，用下面的「单日」。'
          : escapeHtml(b.start) + ' – ' + escapeHtml(b.end);
        return `<span class="tf-chip tf-chip--block" title="${escapeHtml(_title)}">` +
          escapeHtml(_txt) +
          `<b class="tf-chip-x" role="button" tabindex="0" aria-label="删除这一段" title="${_isRepPlan ? '删除这一段（所有重复日都不再排这一段）' : '删除这一段'}" ` +
          `onclick="event.stopPropagation();todoBlockRemove(${idArg(t.id)}, '${b.start}')">×</b></span>`;
      }).join('');
      const editPanel = isEditing
        ? `<div class="tf-edit">
        <div class="tf-field">
          <div class="tf-label">任务标题</div>
          <input class="tf-input" type="text" id="todo_title_${t.id}" maxlength="40" value="${escapeHtml(t.title || '')}" placeholder="要做什么" oninput="scheduleTodoAutoSave(${idArg(t.id)})">
        </div>
        <div class="tf-field">
          <div class="tf-label">详情备注</div>
          <textarea id="todo_detail_${t.id}" placeholder="写点细节…（边写边自动保存）" oninput="scheduleTodoAutoSave(${idArg(t.id)})">${escapeHtml(t.detail || '')}</textarea>
          ${/* 备注框下**不再**铺一行排期摘要：标题行已有首段、下方「排期」栏还有每段的 chip，
               再抄一遍就是同一段时间出现三次。 */''}
        </div>
        <div class="tf-field">
          <div class="tf-label">最晚完成日</div>
          <input class="tf-input" type="date" id="todo_deadline_${t.id}" value="${t.deadline || ''}" oninput="scheduleTodoAutoSave(${idArg(t.id)})">
        </div>
        <div class="tf-field">
          <div class="tf-label">提醒</div>
          <input class="tf-input" type="datetime-local" id="todo_remind_${t.id}" value="${dtToInput(t.remindAt)}" title="到点响一声；和下面的排期没有关系，删掉排期也不会取消提醒" oninput="scheduleTodoAutoSave(${idArg(t.id)})">
        </div>
        <div class="tf-row">
          <div class="tf-label">排期</div>
          <div>
            <div class="tf-chips">
              ${_blockChips}
              ${t.done ? '' : `<span class="tf-chip tf-chip--action" onclick="event.stopPropagation();todoExtraArm(${idArg(t.id)})" title="收起设置，在日程表上点两格选一段；点完自动回来">＋ 加一段排期</span>`}
            </div>
            <div class="tf-hint" style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-4)">${_isRepPlan
              ? escapeHtml(_rpLabelTxt) + '都按这个时间来；某一天不一样，用下面的「单日」。'
              : '一段一段加起来，就是这条计划要占的几块时间；排完在这里列出来。'}</div>
          </div>
        </div>
        ${_dayPlanRow}
        <div class="tf-row">
          <div class="tf-label">标签</div>
          <div class="tf-chips">
            <input class="tf-input tf-input--chip" type="text" id="todo_tag_${t.id}" maxlength="8" value="${_tagSafe(t.tag)}" placeholder="+ 标签" oninput="liveTagPreview(${idArg(t.id)}, this.value);scheduleTodoAutoSave(${idArg(t.id)})">
            <div class="todo-used-tags" id="todo_used_tags_${t.id}"></div>
          </div>
        </div>
        <div class="tf-row">
          <div class="tf-label">四象限</div>
          ${quadChipsHtml(t.quad, 'setTodoQuad(' + idArg(t.id) + ',')}
        </div>
        ${/* 服务于哪个人生目标（可空）。用 typeof 防守：万一目标模块没加载，
             任务面板照常能用，只是这一行不出现 —— 不能让一条任务因为
             一个可选功能缺失就编辑不了。 */''}
        ${(typeof lifeGoalPickerHtml === 'function')
          ? `<div class="tf-row">
          <div class="tf-label">目标</div>
          <div class="tf-chips">${lifeGoalPickerHtml(t.id, t.lifeGoalId)}</div>
        </div>` : ''}
        <div class="tf-row">
          <div class="tf-label">重复周期</div>
          <div>${repeatUIHtml('todo_' + t.id + '_', t.repeat, t.id)}</div>
        </div>
        <div class="tf-row">
          <div class="tf-label">番茄</div>
          <div class="tf-chips">
            ${ADD_TODO_POMO_STEPS.map((n) => `<span class="tf-chip${Number(t.pomodoros) === n ? ' on' : ''}" onclick="setTodoPomoQuick(${idArg(t.id)},${n})">${n}</span>`).join('')}
            <input class="tf-input tf-input--num" type="number" id="todo_pomo_${t.id}" min="0" max="999" step="0.5" value="${t.pomodoros !== null && t.pomodoros !== undefined ? t.pomodoros : ''}" placeholder="0" oninput="scheduleTodoAutoSave(${idArg(t.id)})">
            <span class="tf-unit">个🍅</span>
          </div>
        </div>
        ${subsListHtml}
        ${subsAddHtml}
        <div class="tf-actions">
          <span class="todo-move" style="display:flex;gap:var(--sp-4);">
            <button class="btn-small move-btn" onclick="event.stopPropagation();moveTodo(${idArg(t.id)},-1)" title="上移">↑</button>
            <button class="btn-small move-btn" onclick="event.stopPropagation();moveTodo(${idArg(t.id)},1)" title="下移">↓</button>
          </span>
          <span style="flex:1;"></span>
          <button class="btn-small" onclick="event.stopPropagation();toggleTodoEdit(${idArg(t.id)})" style="padding:var(--sp-6) var(--sp-14);">完成</button>
          <button class="btn-small btn-danger" onclick="event.stopPropagation();showDeleteConfirm(${idArg(t.id)})" style="padding:var(--sp-6) var(--sp-16);">删除</button>
        </div>
      </div>`
        : '';
      /* 每条计划挂上「自己的颜色」（与日程网格同一个色源）。
         ★ 只有**手动在网格里上过色**（t.tbColor）的任务才带色条。
           原来是无条件按 id 散列取色 —— 于是计划列表里每条任务都被涂上一个
           随机色（紫的周报、粉的邮件、橙的文档），左 4px 色条 + 10% 底色。
           这些颜色没有任何含义：它既不是分类也不是优先级，用户永远学不会
           「紫色代表什么」。原设计的意图是「和网格里的块对上」，但没排进
           网格的任务本来就没有块可对 —— 那时颜色纯粹是噪音。
           现在色条的语义收窄成一句话：**这条任务在日程网格里有颜色**。 */
      const _tbCol = (t.tbColor && typeof window.tbColorOfId === 'function') ? window.tbColorOfId(t.id) : '';
      const _tbTint = (t.tbColor && !t.done && typeof window.tbColorWashOfId === 'function') ? window.tbColorWashOfId(t.id, 0.1) : '';
      const _tbColStyle = _tbCol
        ? ` style="border-left:4px solid ${_tbCol}${_tbTint ? ';background:' + _tbTint : ''}"`
        : '';
      /* 折叠态的「最晚完成日」独立行（2026-10-21 工单：放回来，但不是恢复原样）。
         沿革：10-19 用户说「一行里塞标签/象限/标题/重复/日期/时间，有点拥挤」，
         419cd1c 把 📅 从标题行整块删掉 —— 那是把拥挤治成了「看不见」，过度矫正。
         现在排在标题行**下面**另起一行（与备注预览、排期行并列），
         不占标题行空间，所以不会再挤；但信息回来了。
         逾期状态在**这一行**上表达（红字 + 「· 已逾期」），标题行不再印「逾期」小标，
         同一份信息只有一个出口。已完成的不算逾期（做完了就不报警）。
         判据用**正在看的那天**（_vdate）而不是 today：切到过去某天时按那天的状态算。 */
      const _dueOver = !!(t.deadline && String(t.deadline).slice(0, 10) < _vdate && !t.done);
      const _dueC = t.deadline
        ? `<div class="todo-due-line${_dueOver ? ' overdue' : ''}">`
          + `📅 ${escapeHtml(String(t.deadline).slice(0, 10))}`
          + (t.done ? '' : (_dueOver ? ' · 已逾期' : ''))
          + `</div>`
        : '';
      /* 标题行里的「逾期」小标已并入上面那行 —— 置空而不是删变量，
         模板里的 ${_dueT} 位置还在，将来谁要恢复也一眼看得到它在干什么。 */
      const _dueT = '';
      /* 行尾箭头只在**有子任务**或**已展开**时出现：它原本是无条件渲染的，
         于是四条没有子任务的计划右端各挂一个 ▾，看起来像四个"还有下级"，
         点开却只有一张编辑表单。没有子任务时，点正文就已经能展开（见
         todoRowTap），箭头退场。 */
      const _hasSubs = todoValidSubs(t).length > 0;
      const _arrow = (_hasSubs || isExpanded)
        ? `<button class="todo-expand-btn" onclick="toggleTodoExpand(${idArg(t.id)})" title="展开详情与设置">${isExpanded ? '▴' : '▾'}</button>`
        : '';
      return `<div class="todo-item ${t.done ? 'done' : ''}${_skippedToday ? ' skipped' : ''}" data-id="${t.id}"${_tbColStyle} draggable="${sortBy === 'manual' ? 'true' : 'false'}" title="${sortBy === 'manual' ? '可拖拽排序' : ''}"><div class="todo-checkbox ${t.done ? 'checked' : ''}" onclick="toggleTodo(${idArg(t.id)})">${_cbHtml}</div><div class="todo-content" onclick="todoRowTap(${idArg(t.id)}, event)"><div class="todo-title-row">${t.tag ? `<span class="todo-tag" style="${tagColorStyle(t.tag)}">${_tagSafe(t.tag)}</span>` : ''}${quadBadgeHtml(t)}<div class="todo-text">${escapeHtml(t.title)}${_repBadge}</div>${_dueT}${_timeT}${_actualT}${pomoText ? `<span class="todo-pomodoros-info" title="${_pomoTitle}">预计${pomoText}</span>` : ''}${_spentTxt ? `<span class="todo-pomodoros-actual">⌚${_spentTxt}</span>` : ''}${_gapTxt}</div>${_dueC}${previewHtml}${_segInline}${isExpanded ? '' : subsListHtml}</div>${_arrow}
      <div class="todo-detail-expanded ${isExpanded ? 'show' : ''}">
        ${viewPanel}${editPanel}
      </div></div>`;
  }
}
/* 番茄快捷按钮：点一下把预计番茄数设为 n，并即时重画 */
function setTodoPomoQuick(id, v) {
  const t = (appData.todos || []).find((x) => String(x.id) === String(id));
  if (!t) return;
  t.pomodoros = Math.max(0, Math.round((Number(v) || 0) * 2) / 2);
  saveData();
  renderTodos();
}
/* ===== 新增弹窗「预计🍅」快捷档=====
 * 需求：以前是选，不想每次去点数字键盘敲 1.5。
 * 档位与展开后编辑面板那排 chip 保持一致（同一个数组，避免两处数字对不上）。
 * ★ 只写 input.value 再走一遍「改值后该做的事」——不另存一份状态：
 *   保存时读的还是 addTodoPomodoros.value，多一份状态就多一处可能不同步。 */
const ADD_TODO_POMO_STEPS = [0.5, 1, 1.5, 2, 3, 4];
function renderAddTodoPomoQuick() {
  const box = document.getElementById('addTodoPomoQuick');
  if (!box) return;
  box.innerHTML =
    ADD_TODO_POMO_STEPS.map(function (n) {
      return '<span class="tf-chip add-pomo-quick-chip" data-v="' + n + '" role="button" tabindex="0" ' +
        'onclick="setAddTodoPomo(' + n + ')" title="预计 ' + n + ' 个番茄">' + n + '🍅</span>';
    }).join('') +
    '<span class="tf-chip add-pomo-quick-chip add-pomo-quick-clear" data-v="clear" role="button" tabindex="0" ' +
    'onclick="setAddTodoPomo(null)" title="不设预计番茄">清空</span>';
  syncAddTodoPomoQuick();
}
function setAddTodoPomo(n) {
  const el = document.getElementById('addTodoPomodoros');
  if (!el) return;
  el.value = (n === null || n === undefined || n === '') ? '' : String(n);
  syncAddTodoPomoQuick();
}
/* 只切高亮，不动值 —— input 的 oninput 也调它（手敲 2.0 时 2🍅 那颗要亮起来） */
function syncAddTodoPomoQuick() {
  const box = document.getElementById('addTodoPomoQuick');
  const el = document.getElementById('addTodoPomodoros');
  if (!box || !el) return;
  const cur = el.value === '' ? null : Number(el.value);
  [].slice.call(box.querySelectorAll('.add-pomo-quick-chip')).forEach(function (c) {
    const v = c.getAttribute('data-v');
    let on = false;
    if (v === 'clear') on = (cur === null || isNaN(cur));
    else on = (cur !== null && !isNaN(cur) && Math.abs(cur - Number(v)) < 1e-9);
    if (on) c.classList.add('on'); else c.classList.remove('on');
  });
}
window.renderAddTodoPomoQuick = renderAddTodoPomoQuick;
window.setAddTodoPomo = setAddTodoPomo;
window.syncAddTodoPomoQuick = syncAddTodoPomoQuick;
/* 「⏳ 搁置 N 天」的天数（仅展示层，纯函数）：只有这条计划**自己**的记录（todoId 命中）
   才算数，最近一次专注距今 ≥2 天才显示。返回 0 = 不显示。
   ★ 渲染与签名共用它：搁置是从记录推出来的，记录变了它就该变；
     若只算在渲染里、不进口签名，最后一条旧记录补挂上 todoId 时行不会重绘，
     界面上就永远留着「没有搁置」的旧样子（数据对了、界面是旧的 —— 这类 bug 以前栽过）。 */
function todoStallDays(t, lastTs, todayKey) {
  if (!t || t.done || !t.title) return 0;
  if (!lastTs) return 0;
  const dLast = getDateStr(new Date(Number(lastTs)));
  const days = Math.round((new Date(todayKey + 'T00:00:00') - new Date(dLast + 'T00:00:00')) / DAY_MS);
  return days >= 2 ? days : 0;
}
/* 行级签名（决定"该行是否需要重建"）。含所有会影响该行 DOM 的字段。
   dateStr = 正在看的这一天：卡片上的「✅ N 段 · 共 X 分」按它取段（见 tbTodoSegList）。
   lastTs = 这条计划自己最近一次专注的开始时刻（没有就传 undefined）。 */
function todoRowSig(t, dateStr, lastTs) {
  return (
    t.id +
    '\u0001' + t.title +
    '\u0001' + (t.done ? 1 : 0) +
    /* 完成时间进签名：卡片上显示「完成于 xx:xx」，不进签名的话改完成时间卡片不重绘 */
    '\u0001' + (t.doneAt || 0) +
    '\u0001' + (t.pomodoros || 0) +
    '\u0001' + (t.actualPomodoros || 0) +
    '\u0001' + (t.timeSpent || 0) +
    '\u0001' + (expandedTodos[t.id] ? 1 : 0) +
    '\u0001' + (editingTodos[t.id] ? 1 : 0) +
    /* 跳过本次：是"行要不要重画"的真状态（勾变「已跳过」、按钮隐形），必须进签名——
       next/last 不进签名是因为它们天天自己走；skippedDate 只在用户表了态时才动，不会造成白白重建 */
    '\u0001' + (t.skippedDate || '') +
    /* 眼睛（今天先不看）：按钮的实心态/aria-pressed 与 title 都由它决定，
       不进签名 → 取消后按钮一直是实心、看不出已经取消。 */
    '\u0001' + (t.eyesOff || '') +
    '\u0001' + (t.deadline || '') +
    '\u0001' + (t.remindAt || '') +
    '\u0001' + (t.reminded ? 1 : 0) +
    '\u0001' + todoEstEnd(t, appData.settings) +
    /* 手动态（estEndManual）也进签名：结束值相同、标记不同时，
       行上的标签/输入框属性会变（见 renderTodoRowHtml 的预计结束一栏） */
    '\u0001' + (t.estEndManual ? 1 : 0) +
    /* 实际时段：卡片上那段「✅ …」（_actualT）就是由它算出来的（见上面的 _actRange），
       所以它一变，行 DOM 的内容就变，**必须**进签名。
       漏掉的后果实测过：只改 actualSegs 而 timeSpent 等字段没动 → 签名不变 →
       本行按"未变化"复用旧节点 → 界面上一直显示改之前的实际时段（数据里已是新的）。 */
    '\u0001' + tbTodoSegList(t, dateStr).map(s => (s && s.s ? s.s : 0) + '-' + (s && s.e ? s.e : 0) + '-' + (s && s.authMs ? s.authMs : 0)).join(',') +
    /* 搁置天数同理：它由「这条计划自己的记录」推出，记录变了天数是会变的。
       不进签名 → 补挂 todoId / 删掉最后一条记录后，行走"未变化"分支复用旧节点，
       界面上一直挂着旧天数（甚至旧记录删光了还显示搁置）。 */
    '\u0001' + todoStallDays(t, lastTs, getTodayStr()) +
    '\u0001' + (t.tag || '') +
    /* 四象限（quad）**不进**签名：改象限走 setTodoQuad 的局部刷新（徽章 + chips 就地更新）。
       进了签名反而有害——saveData 之后的任何一次 renderTodos 都会因它判定「行变了」而整行重建，
       表现就是「点一下象限，列表闪一下」。注意 tag 必须在签名里：标签没有局部刷新入口
       （只有编辑面板保存时整行重画），漏掉就是"改了标签颜色不变"。 */
    '\u0001' + String(t.detail || '') +
    '\u0001' + (t.subs ? t.subs.map(s => (s && typeof s === 'object') ? ((s.done ? 1 : 0) + ':' + (s.title || '')) : '-').join(',') : '') +
    '\u0001' + (t.skippedDate || '') +
    /* 眼睛（今天先不看）：按钮实心态 / aria-pressed / title 都由它派生，
       不进签名 → 取消后行不重建，按钮永远是实心（点了没反应）。 */
    '\u0001' + (t.eyesOff || '') +
    /* 只进「规则本身」：next/last 每天都会变，进了签名会让行在跨天时白白重建（丢输入焦点） */
    '\u0001' + todoRepeatSig(t.repeat) +
    /* ★ 按天单独排期（dayPlan）必须进签名 —— 「那个单日的添加了怎么不显示呀」。
       它只改 t.dayPlan，上面每一项都不动 → 本行判"没变化"→ 复用旧节点 →
       数据里已经排好了，界面上还写着「还没有哪一天单独排过」、卡片排期区也没变。
       这正是本签名反复踩的那个坑（actualSegs / 搁置天数 都是同一个教训）：
       **凡是屏幕上能看见的，都得进签名。** */
    '\u0001' + Object.keys(todoDayPlanNormAll(t)).sort().map(function (d) {
      return d + '=' + todoDayPlanNormAll(t)[d].map(function (s) {
        return s.start + '~' + s.end;
      }).join(',');
    }).join(';')
  );
}
/* 重复规则里「影响长什么样」的那部分（不含 last/next 这类会自己走的字段） */
function todoRepeatSig(r) {
  const rr = normTodoRepeat(r);
  if (!rr) return '';
  return rr.mode + '|' + (rr.weekdays ? rr.weekdays.join(',') : '') + '|' + (rr.dom === 0 ? 'last' : rr.dom || '') + '|' + (rr.interval || '') + '|' + (rr.anchor || '') + '|' + (rr.until || '') + '|' + (rr.subsMode || '');
}
/* 把行数组应用到列表容器——只重建签名变化的行，其余节点原地复用。
 * 顺序变化时通过 appendChild 移动节点（复用 DOM，不重建）。 */
function renderTodosRows(list, rows) {
  const _sig = window.__todoRowSig || (window.__todoRowSig = {});
  /* 先按 id 建现有节点索引 */
  const _existing = {};
  for (let i = 0; i < list.children.length; i++) {
    const c = list.children[i];
    const id = c.getAttribute && c.getAttribute('data-id');
    if (id) _existing[id] = c;
  }
  /* 先清掉「不是任务行」的遗留子节点（空状态提示、分隔线等无 data-id 的节点）。
   * 为什么必须清：列表从空 → 有数据时走的是本函数（renderTodos 只在 todos 为空时
   * 直接 innerHTML 塞空状态并 return）。空状态 <div class="empty-state"> 没有 data-id，
   * 既进不了 _existing，也进不了下面「移除已不存在的行」的循环 → 会永久留在列表底部，
   * 出现「明明有计划，下面还写着『还没有计划任务』」。 */
  for (let i = list.children.length - 1; i >= 0; i--) {
    const _c = list.children[i];
    if (!_c.getAttribute || !_c.getAttribute('data-id')) list.removeChild(_c);
  }
  /* 把行数组应用到列表容器——只重建签名变化的行，其余节点原地复用。
   * 关键：不能无条件 appendChild（对已在文档中的节点 = 移动，会触发 blur，
   * 导致"展开输入框正在输入时渲染 → 失焦"）。只有**位置不对**的节点才移动。 */
  list.__todoRowOrder = rows.map(r => String(r.id)); /* 记录目标顺序，供下次比对 */
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const key = String(r.id);
    let node = _existing[key];
    if (node && _sig[key] === r.sig) {
      /* 签名未变 → 复用原节点（连同输入框状态/焦点一起保留） */
      delete _existing[key];
    } else {
      /* 新建或重建该行 */
      const tmp = document.createElement('div');
      tmp.innerHTML = r.html;
      const fresh = tmp.firstElementChild;
      if (node && node.parentNode === list) list.replaceChild(fresh, node);
      node = fresh;
      delete _existing[key];
    }
    _sig[key] = r.sig;
    /* 仅当该节点当前所在位置与目标位置不符时才移动（避免无谓的 DOM 移动 → blur） */
    const cur = list.children[i];
    if (cur !== node) {
      if (node.parentNode === list) list.insertBefore(node, cur || null);
      else list.insertBefore(node, cur || null);
    }
  }
  /* 移除已不存在的行 */
  for (const k in _existing) {
    if (Object.prototype.hasOwnProperty.call(_existing, k)) {
      try { list.removeChild(_existing[k]); } catch (e) { if (window.__silent) window.__silent(e, '01e:renderTodosRows'); }
      delete _sig[k];
    }
  }
}
function scheduleTodoAutoSave(id) {
  if (todoAutoSaveTimers[id]) clearTimeout(todoAutoSaveTimers[id]);
  todoAutoSaveTimers[id] = setTimeout(() => {
    forceSaveTodoDetail(id, true);
    showAutoSaveHint();
  }, 5000);
}

/* ── 预计结束实时联动 ──────────────────────────────────────────────
 * 番茄数 或 提醒(开始)时间 变化 → 立即重算「预计结束」输入框。
 * 自动态：算出值、置灰（用户改不了，因为它本来就是推导出来的）。
 * 离开自动态：把上一次**自动算出来**的值清掉——那不是用户填的，
 *            留着就会变成"没有开始时间却有结束时间"的幽灵值。
 * 唯一实现，两个入口（新建弹窗 / 计划编辑面板）都走这里。
 * 注意：番茄数以**输入框当前值**为准，空 = 0。这里绝不能回落到
 * t.pomodoros——那样用户把番茄数清空后，结束框会赖在不可编辑状态。 */
/* 用户动了「预计结束」这一栏 → 转为**手动态**：此后改番茄数 / 改提醒时间都不再覆盖它。
   清空则交还自动态（重新由番茄数推算）。 */
function markEstEndManual(el) {
  if (!el) return;
  if (String(el.value || '').trim() === '') delete el.dataset.userSet;
  else el.dataset.userSet = '1';
}
/* 手改「预计结束」→ 反算「预计番茄数」（todoPomosForMinutes，与日程表点两格预填同一口径）。
   用户要的：结束时间改了，预计番茄数跟着变 —— 两边是一个账，不能一个动了另一个还挂着旧值。
   前置条件不成立（没填开始 / 结束不晚于开始 / 值非法）→ 直接不算，番茄数原样保留；
   时长排不下半个番茄（反算得 0）→ 清空番茄数：没有番茄数就不该再挂着结束时间的账，
   与「清空结束框交还自动态」互为镜像，保证两栏始终是一个账。 */
function syncPomoFromEstEnd(rmEl, eeEl, pomoEl) {
  if (!rmEl || !eeEl || !pomoEl) return;
  const s = normDT(rmEl.value), e = normDT(eeEl.value);
  if (!s || !e) return;
  const sd = parseLocalDT(s), ed = parseLocalDT(e);
  if (!sd || !ed) return;
  const diff = (ed.getTime() - sd.getTime()) / 60000;
  if (!(diff > 0)) return;
  const p = todoPomosForMinutes(diff, appData.settings);
  pomoEl.value = p > 0 ? String(p) : '';
}
function forceSaveTodoDetail(id, skipRender) {
  if (todoAutoSaveTimers[id]) {
    clearTimeout(todoAutoSaveTimers[id]);
    todoAutoSaveTimers[id] = null;
  }
  const t = appData.todos.find(x => idEq(x.id, id));
  if (!t) return;
  const titleEl = document.getElementById('todo_title_' + id);
  const detailEl = document.getElementById('todo_detail_' + id);
  const pomoEl = document.getElementById('todo_pomo_' + id);
  const tagEl = document.getElementById('todo_tag_' + id);
  const dlEl = document.getElementById('todo_deadline_' + id);
  const rmEl = document.getElementById('todo_remind_' + id);
  /* 标题是必填：输入框被清空时不写回，保留原标题 */
  if (titleEl) {
    const v = titleEl.value.trim();
    if (v) t.title = v.slice(0, 40);
  }
  if (detailEl) t.detail = detailEl.value;
  if (pomoEl) {
    const v = pomoEl.value;
    t.pomodoros = v ? parseFloat(v) : null;
  }
  if (tagEl) t.tag = tagEl.value.trim().slice(0, 12);
  if (dlEl) t.deadline = dlEl.value || null;
  /* 重复周期：控件在就按控件读（applyTodoRepeat 里保留 last、重算 next，幂等） */
  if (document.getElementById(repeatElId('todo_' + id + '_', 'Mode'))) {
    applyTodoRepeat(t, readRepeatUI('todo_' + id + '_'));
  }
  if (rmEl) {
    t.remindAt = normDT(rmEl.value) || null;
    t.reminded = false;
  }
  const eeEl = document.getElementById('todo_est_end_' + id);
  if (eeEl) {
    /* 自动推算态不落盘手填值（每次都能重算）；手填态只存合法值——
       半截输入（用户还在打字）既不落盘也不覆盖已存的值，避免把输入框洗掉。
       ★ userSet = 用户动过「预计结束」这一栏（手改 / 日程表点两格预填）：此时这一栏**归用户所有**，
         不能再被「有番茄数 + 有提醒时间」的自动判定清掉 —— 否则编辑面板里手改的结束时间，
         点「完成」一保存就被打回自动值（实测 bug）。 */
    const userSet = eeEl.dataset.userSet === '1';
    if (!userSet && todoEstAuto(t, appData.settings)) {
      t.estEnd = null;
      delete t.estEndManual;
    } else {
      const v = normDT(eeEl.value);
      if (v) { t.estEnd = v; t.estEndManual = true; }
      else if (!eeEl.value) { t.estEnd = null; delete t.estEndManual; }
    }
  }
  touchRecord(t);   /* 数据契约：编辑即刷新 updatedAt（同步判冲突用） */
  saveData();
  if (!skipRender) {
    renderTodos();
    refreshTodoSelect();
  } else {
    refreshTodoTitleBadges(t);
  }
}
/* 局部刷新标题栏徽章（标签 + 象限）：自动保存（skipRender）时数据已落盘但行不重画，
   标题栏徽章会停留在旧值。这里只更新徽章、不重建整行，避免打断输入焦点/闪烁。 */
/* 编辑面板里改标签时的即时预览（用户 10-15：标签颜色跟四象限一样"不变"）。
   真因是标签走 scheduleTodoAutoSave 的 5 秒防抖，改完要等 5 秒行上徽章才变色，
   而四象限是点一下就变 —— 体验不一致，看着就像坏了。
   这里先按输入框当前值把徽章刷出来，落盘仍然交给原来的 5 秒防抖。 */
function liveTagPreview(id, val) {
  const t = appData.todos.find(x => idEq(x.id, id));
  if (!t) return;
  refreshTodoTitleBadges(t, String(val == null ? '' : val).trim().slice(0, 8));
}

function refreshTodoTitleBadges(t, tagOverride) {
  if (!t) return;
  const row = document.querySelector('.todo-item[data-id="' + String(t.id).replace(/"/g, '\\"') + '"]');
  if (!row) return;
  const tr = row.querySelector('.todo-title-row');
  if (!tr) return;
  const textEl = tr.querySelector('.todo-text');
  /* 标签徽章。tagOverride 是「编辑面板里边打字边预览」用的临时值：
     传了就用它渲染，不碰 t.tag —— 预览不能改数据，用户没保存就退出不该留脏值。 */
  const tagVal = tagOverride === undefined ? t.tag : tagOverride;
  let tagEl = tr.querySelector('.todo-tag');
  if (tagVal) {
    if (!tagEl) {
      tagEl = document.createElement('span');
      tagEl.className = 'todo-tag';
      const anchor = tr.querySelector('.quad-badge') || textEl;
      if (anchor) anchor.parentNode.insertBefore(tagEl, anchor);
      else tr.insertBefore(tagEl, tr.firstChild);
    }
    if (tagEl.textContent !== tagVal) tagEl.textContent = tagVal;
    tagEl.style.cssText = tagColorStyle(tagVal);
  } else if (tagEl) {
    tagEl.remove();
  }
  /* 象限徽章：就地改 class/title/文本，绝不替换节点。
     替换节点会让这一行重新布局，肉眼看到"闪一下"（用户 10-15 反馈）。
     徽章内容只由 quad 决定，三项属性改完就等于换了一枚徽章，且不产生回流。 */
  const oldQuad = tr.querySelector('.quad-badge');
  const q = (t.quad && typeof quadMeta === 'function') ? quadMeta(t.quad) : null;
  if (q) {
    if (oldQuad) {
      const wantCls = 'quad-badge quad-chip--' + q.key;
      if (oldQuad.className !== wantCls) oldQuad.className = wantCls;
      if (oldQuad.title !== q.label) oldQuad.title = q.label;
      if (oldQuad.textContent !== q.short) oldQuad.textContent = q.short;
    } else if (textEl) {
      textEl.insertAdjacentHTML('beforebegin', quadBadgeHtml(t));
    }
  } else if (oldQuad) {
    oldQuad.remove();
  }
}
function refreshTodoSelect() {
  const sel = document.getElementById('currentTodoSelect');
  if (!sel) return;
  const currentVal = sel.value;
  let h = '<option value="">— 手动输入任务 —</option>';
  /* ===== 按板块分组渲染计时目标 =====
   * 计划(todos) / 今日必做 / 明日必做 / 习惯 各自独立分组 */
  const _todos = appData.todos.filter(t => !t.done);
  if (_todos.length) {
    h += '<optgroup label="📋 计划">';
    h += _todos
      .map(t => {
        const pomoText = formatPomodoros(t.pomodoros);
        const actual = t.actualPomodoros || 0;
        let label = escapeHtml(t.title);
        const tags = [];
        if (pomoText) tags.push(pomoText);
        if (actual > 0) tags.push('用' + formatPomodoros(actual));
        if (tags.length) label += ' (' + tags.join(' / ') + ')';
        return `<option value="${t.id}">${label}</option>`;
      })
      .join('');
    h += '</optgroup>';
  }
/* ===== 今日必做 + 明日必做 都可立即可选 =====
 * 只显示明日必做的话，当天设的必做无法立刻计时。 */
  const today = getTodayStr();
  const mdToday = (appData.mustDos && appData.mustDos[today]) || [];
  if (mdToday.length) {
    h += '<optgroup label="📌 今日必做">';
    mdToday.forEach(function (it) {
      /* 字段是 title（saveMustDos 存的就是 title），别读成空串；兼容旧数据的 text */
      h += `<option value="mustdoT_${it.id}">📌 ${escapeHtml(it.title || it.text || '')}${it.done ? ' ✅' : ''}</option>`;
    });
    h += '</optgroup>';
  }
  /* 明日必做任务 */
  const tm = getMustDoTomorrowStr();
  const mds = (appData.mustDos && appData.mustDos[tm]) || [];
  if (mds.length) {
    h += '<optgroup label="📌 明日必做">';
    mds.forEach(function (it) {
      h += `<option value="mustdo_${it.id}">📌 ${escapeHtml(it.title || it.text || '')}</option>`;
    });
    h += '</optgroup>';
  }
  /* ===== 计时目标支持绑定习惯 =====
   * 习惯仅作为本次计时目标（record.taskName 归属习惯名），
   * 不消耗任务进度、不自动打卡（打卡保持手动 toggleHabit）。 */
  const _hbList = appData.habits || [];
  if (_hbList.length) {
    h += '<optgroup label="🌱 习惯">';
    _hbList.forEach(function (it) {
      h += `<option value="habit_${it.id}">🌱 ${escapeHtml(it.name || '')}</option>`;
    });
    h += '</optgroup>';
  }
  sel.innerHTML = h;
  sel.value = currentVal;
}
function onSelectTodoPlan(todoId) {
  if (typeof timerState !== 'undefined') {
    /* 习惯/必做前缀值原样保存，仅纯数字作为 todo id */
    const _sv = todoId ? String(todoId) : '';
    timerState._selId = _sv ? (/^\d+$/.test(_sv) ? parseInt(_sv, 10) : _sv) : null;
    setTimeout(applyCurrentTaskHighlight, 10);
    /* 选完就立刻把该计划的子任务摆出来，不必等按下「开始」——见 timerLinkedTodo 注释 */
    renderTimerSubs();
  }
  if (!todoId) {
    document.getElementById('currentTodoInput').value = '';
    document.getElementById('currentTodoNote').value = '';
    const pi = document.getElementById('timerPomodoroInfo');
    if (pi) pi.textContent = '';
    return;
  }
  /* 明日必做 */ if (String(todoId).indexOf('mustdo_') === 0) {
    let _mdId = parseInt(String(todoId).replace('mustdo_', ''), 10);
    let _tm = getMustDoTomorrowStr();
    let _mds = (appData.mustDos && appData.mustDos[_tm]) || [];
    let _mt = _mds.find(function (x) {
      return x.id === _mdId;
    });
    if (_mt) {
      document.getElementById('currentTodoInput').value = _mt.text;
      document.getElementById('currentTodoNote').value = '';
      let _pi2 = document.getElementById('timerPomodoroInfo');
      if (_pi2) _pi2.textContent = '📌 明日必做计划';
    }
    return;
  }
  /* 今日必做 / 习惯作为计时目标（不进 todo 进度、不打卡） */
  if (String(todoId).indexOf('mustdoT_') === 0) {
    let _tmdId = parseInt(String(todoId).replace('mustdoT_', ''), 10);
    let _tmds = (appData.mustDos && appData.mustDos[getTodayStr()]) || [];
    let _tmt = _tmds.find(function (x) {
      return x.id === _tmdId;
    });
    if (_tmt) {
      document.getElementById('currentTodoInput').value = _tmt.text || '';
      document.getElementById('currentTodoNote').value = '';
      let _tp = document.getElementById('timerPomodoroInfo');
      if (_tp) _tp.textContent = '📌 今日必做';
    }
    return;
  }
  if (String(todoId).indexOf('habit_') === 0) {
    let _hhId = parseInt(String(todoId).replace('habit_', ''), 10);
    let _hh = (appData.habits || []).find(function (x) {
      return x.id === _hhId;
    });
    if (_hh) {
      document.getElementById('currentTodoInput').value = _hh.name || '';
      document.getElementById('currentTodoNote').value = '';
      let _hp = document.getElementById('timerPomodoroInfo');
      if (_hp) _hp.textContent = '🌱 习惯计时';
    }
    return;
  }
  const t = appData.todos.find(x => x.id === parseInt(todoId));
  if (t) {
    document.getElementById('currentTodoInput').value = t.title;
    document.getElementById('currentTodoNote').value = t.detail || '';
    const pi = document.getElementById('timerPomodoroInfo');
    if (pi) {
      const pomoText = formatPomodoros(t.pomodoros);
      const actual = t.actualPomodoros || 0;
      const parts = [];
      if (pomoText) parts.push('预计 ' + pomoText);
      if (actual > 0) parts.push('已用 ' + formatPomodoros(actual));
      pi.textContent = parts.join(' · ');
      if (parts.length > 0 && actual > 0) pi.style.color = 'var(--green)';
      else if (parts.length > 0) pi.style.color = 'var(--primary)';
    }
  }
}

/* ==================================================================
 * 【段七】周计划：列表跟着网格渲染走（渲染完成广播订阅）
 *   网格每次重画（切日期 / 翻周 / 回今天 / 折叠切换 / 日历选日期 / 数据变化）
 *   → 01eA 在 renderTimeBlockGrid 末尾广播 → 这里订阅之，刷一次列表。
 *   列表要跟着变，但 01eA **不许反向依赖 01eC**（依赖图无环）——
 *   广播是 01eA 提供的只读出口，依赖方向不变（仍是 01eC → 01eA）。
 *   ★ 重入守卫：renderTodos 自己会调 renderTimeBlockGrid（段二：网格跟着列表数据走），
 *     那一次渲染又会触发广播——没有守卫就是无限递归。
 *   ★ 为什么不再包装 window.tbPickDate 等三个入口：01eA 内部有**本地**调用
 *     （📅 日历选日期走本地 tbPickDate），包装外部引用覆盖不到它，列表会不刷新；
 *     广播由渲染方自己发，本地/外部路径全覆盖。
 *   加载顺序：01eC 先于 01eA 执行（同在 manifest 槽 1 的 files 列表里，01eC 排位更靠前），
 *   所以订阅走 DOMContentLoaded——那时 01eA 的广播 API 必然已导出。
 * ================================================================== */
/* ===== 删除一个排期段 =====
 * 所有段平等：点哪段的 × 就删哪段。
 * 没有"主段删掉会连带取消提醒"这回事了 —— 提醒在另一个字段里，与段无关。
 * 按 start 字符串定位（不用下标：下标依赖"渲染顺序 == 数组顺序"这条隐式约定）。 */
function tbBlockRemove(id, startStr) {
  const t = (appData.todos || []).find((x) => x && String(x.id) === String(id));
  if (!t) { showToast('找不到这条计划'); return; }
  if (!todoRemoveBlock(id, startStr)) { showToast('这段已经不存在了'); return; }
  renderTodos();
  if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
  showToast('已删除这段排期');
}
/* 删除某一天的单独排期 → 那天回到模板 */
function tbDayPlanClear(id, ds) {
  const t = (appData.todos || []).find((x) => x && String(x.id) === String(id));
  if (!t) { showToast('找不到这条计划'); return; }
  if (!todoDayPlanClear(id, ds)) { showToast('这天本来就没有单独排期'); return; }
  renderTodos();
  if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
  showToast('已恢复 ' + String(ds).slice(5) + ' 的默认排期');
}
/* 面板上的「排到这天」：读三个框 → 落盘 → 重画。只碰这一天。 */
/* 只有**一个**入口（「我搞不懂那个追加那一天那个按钮和替换这一段想干啥？
   我添加了不应该自动就替换那一天吗」）—— 两个按钮是让用户替程序做选择，本来就是设计错误。
   真实语义只有一条：**把这段时间排到这天**。
     · 这天还没单独排过 → 这天整体换成这段时间（模板那天让位），也就是他说的"自动替换那一天"；
     · 这天已经排过 → 再补一段（不重叠就收，重叠才报错）。
   "整组替换"本来就是 dayPlan 的存储语义（那天只要有覆盖，模板整组不参与），
   所以根本不存在"替换 vs 追加"的二选一。 */
function tbDayPlanApply(id) {
  const dEl = document.getElementById('todo_dp_date_' + id);
  const sEl = document.getElementById('todo_dp_start_' + id);
  const eEl = document.getElementById('todo_dp_end_' + id);
  if (!dEl || !sEl || !eEl) return;
  const ds = String(dEl.value || '').slice(0, 10);
  const sm = tbHHMMToMin(sEl.value);
  const em = tbHHMMToMin(eEl.value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) { showToast('先选是哪一天'); return; }
  if (sm == null || em == null) { showToast('起止时间要填完整'); return; }
  if (em <= sm) { showToast('结束要比开始晚'); return; }
  if (em - sm < TODO_EXTRA_MIN_MIN) { showToast('一段至少 ' + TODO_EXTRA_MIN_MIN + ' 分钟'); return; }
  /* ★ 一个按钮 = 「这天就按这个时间来」。「我添加了不应该自动就替换那一天吗」
     —— 对，所以这里**整天替换**：那天已有的段先清掉，再写这一段。
     想给同一天再排一段，用上面「排期」行的「＋ 加一段排期」（那是模板，各天通用）；
     真要某天两段的情况极少数，不为它保留一个看不懂的开关。 */
  const r = todoDayPlanSet(id, ds, [{
    start: ds + ' ' + tbMinToHHMM(sm),
    end: ds + ' ' + tbMinToHHMM(em)
  }]);
  if (!r || !r.ok) {
    showToast(!r ? '没存上' : (r.reason === 'short' ? '一段至少 10 分钟' : '时间不合法，没存上'));
    return;
  }
  renderTodos();
  if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
  showToast(ds.slice(5) + ' 这天改成 ' + tbMinToHHMM(sm) + '–' + tbMinToHHMM(em) + '（其余日子照旧）');
}
/* 内联 onclick 在全局作用域求值 → 必须显式挂 window */
window.todoBlockRemove = tbBlockRemove;
window.tbDayPlanClear = tbDayPlanClear;
window.tbDayPlanApply = tbDayPlanApply;

var _todoListInHook = false;
function hookTbDateEntries() {
  if (typeof window.tbOnGridAfterRender !== 'function') return;
  window.tbOnGridAfterRender(function () {
    if (_todoListInHook) return; /* 自己引发的网格重渲，不回头再刷列表 */
    _todoListInHook = true;
    try {
      renderTodos();
    } catch (e) { if (window.__silent) window.__silent(e, '01e:hookTbDateEntries'); }
    _todoListInHook = false;
  });
}
/* 启动：loading 中 → 等 DOMContentLoaded（01eA 此时已执行完，广播 API 已导出）；
   已过 loading（测试/异步装配场景）→ 立即挂。 */
function _bootTodoWeekView() {
  try {
    hookTbDateEntries();
  } catch (e) { if (window.__silent) window.__silent(e, '01e:_bootTodoWeekView'); }
  /* 弹窗里「开始 → 结束」两个框：只在用户改的时候回写草稿。
     用 change 而不是 input —— input 每敲一个数字都会触发，datetime-local 中途值不完整，
     会一边报「结束要比开始晚」一边打断输入。 */
  const _bs = document.getElementById('addTodoBlockStart');
  const _be = document.getElementById('addTodoBlockEnd');
  if (_bs) _bs.addEventListener('change', onAddBlockInputChange);
  if (_be) _be.addEventListener('change', onAddBlockInputChange);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootTodoWeekView);
} else {
  _bootTodoWeekView();
}

/* 事件委托（2026-10-23）：原内联 onfocus 的「有选中计划就清空、否则全选」行为。
 * 内联写法已移除（模块化前置），这里保留同一语义，this = 输入框。 */
window.todoInputFocus = function () {
  var sel = document.getElementById('currentTodoSelect');
  if (!sel) return;
  if (sel.value) {
    sel.value = '';
    this.value = '';
  } else if (this.select) this.select();
};
