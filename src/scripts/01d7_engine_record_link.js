/* ===== 耦合契约 E3（只读注释，不改运行逻辑）=====
 * 由 01d_engine_features.js 按域拆出（2026-11-14 · S2，纯移动：一行逻辑都没改）。
 * 产物：index.html 逐字节不变；engine.js 因拼接符 "\n;\n" 在每个新文件边界各多 1 个空语句（共 6 处，长度不变）。
 * 记录 ↔ 计划归属、段索引缓存。对外仅 tbTodoOf / liveSessionOf / tbSegIndexFor 等查询入口；禁止在别处再写一份「按标题认领记录」的判定。
 * 回退方式：删本文件 + 从 src/manifest.json 的 slot 1 files 里摘掉 → 100% 还原。 */
/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01d7_engine_record_link.js
 * 分组：features
 * 职责：业务层——「这条记录属于哪条计划」的准入判定 + 实时会话 + 待办分段索引缓存
 * 功能：
 *   - 记录归属：tbNormTitle / tbTodoTitleCount / tbTodoCreatedAt / tbTodoOf（名字不是身份；老记录 todoId 为空时按标题认领，三条准入缺一不可）
 *   - 实时会话：liveSessionOf / liveSessionEnsure / liveSessionSegs / closeStaleLiveSessions / dropLiveSession
 *   - 段索引缓存：tbInvalidateSegIndex（写入点显式失效）+ 数组身份/长度/版本号三重校验
 *   - 旧账迁移：migrateSegLedger
 * 函数索引（TOC）：tbNormTitle/tbTodoTitleCount/tbTodoCreatedAt/tbLegacyNameClaimAllowed/tbResolveTodoByTitle/migrateRecordOwnership/tbInvalidateSegIndex/tbSegIndex/tbTodoFocusMs/tbTodoSegList/consumeLiveSessionForRecord/__setMustDoEditDate（+3 更多）
 * ============================================================ */

/* ============================================================
 * 「这条记录属于哪条计划」——**名字不是身份**
 * ============================================================
 * 一类 bug：前几天做过一条「收拾屋子」的专注，今天**新建**一条同名计划，
 * 新计划卡上立刻挂出那天的「✅ 5 段 · 共 132 分 / ⏰ 15:15~15:42 / ⏳ 搁置 7 天」。
 * 病根是「按标题找身份」：同名 ≠ 同一条计划。老记录（todoId 为空）按标题认领时
 * 既不限日期、也不查是否唯一，于是任何一条同名新计划都会把全库同名记录捡走。
 *
 * 现在的准入条件（三条缺一不可），这就是「按名字说话」唯一允许的场合：
 *   ① 有明确的那一天（dateStr）—— 没有日期就没有边界，一律不认；
 *   ② 这段落就落在那一天（按段落起点日期判，跨零点的段落自然归前一天）；
 *   ③ 全库同标题的计划**只有一条** —— 两条同名时谁都别认，否则一段记录被算两次。
 * ★ 宁可认不出来（显示成未计划块），也不要认错：认错会污染计划账、搁置天数、
 *   日程网格三处显示，而且用户完全无从发现。
 */
function tbNormTitle(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
/* 全库同标题（规范化后）计划条数 —— 唯一性判定的单一来源 */
function tbTodoTitleCount(title) {
  const want = tbNormTitle(title);
  if (!want) return 0;
  let n = 0;
  (appData.todos || []).forEach(function (x) {
    if (x && tbNormTitle(x.title) === want) n++;
  });
  return n;
}
/* 计划的创建时刻 —— 计划 id 就是 `Date.now()`（见 01eC 的 addTodo）。
   ★ 这是"名字能不能认亲"的关键边界：**一段专注不可能发生在计划创建之前**。
     这类 bug 的本质就在这里 —— 7 天前的「收拾屋子」被今天新建的同名计划捡走，
     而那天的记录早于今天这条计划的出生时刻。只看名字、不看时间，就必然捡错。
   非时间戳形态的 id（历史数据/手工造的数）一律返回 null = 出生时刻未知（保守：不认亲）。 */
function tbTodoCreatedAt(t) {
  const n = Number(t && t.id);
  if (!isFinite(n)) return null;
  if (n < 1.4e12 || n > Date.now() + 86400000) return null; /* 2014 之前 / 未来一天以后：不是创建时刻 */
  return n;
}
/* 老记录（没有 todoId）能否按标题认亲到这条计划 —— **只给一次性迁移用**
   （见下面的 migrateRecordOwnership）。★ 读路径不得再调用它：
   按名字找主人正是「今天新建一条同名计划，把几天前的旧账捡走」的来源。
   四条准入：标题一致 + 全库标题唯一 + 不是补记(log) + 记录不早于计划创建。
   最后一条由 tbLegacyNameClaimAllowed 的调用方（迁移）传入 createdAt 判定，
   这里做统一兜底，任何一处漏传都退化成"不认"。 */
function tbLegacyNameClaimAllowed(r, t, createdAt) {
  if (!r || !t || r.type === 'log') return false;
  const title = tbNormTitle(t.title);
  if (!title || tbNormTitle(r.taskName) !== title) return false;
  if (tbTodoTitleCount(title) !== 1) return false; /* 同名多条 → 身份不明，不认 */
  if (createdAt == null) createdAt = tbTodoCreatedAt(t);
  if (createdAt == null) return false; /* 出生时刻不明 → 不猜 */
  if (Number(r.startTime) < createdAt) return false; /* 计划还没出生时的事，不可能是它的 */
  return true;
}
/* 写时把「手输的任务名」落到计划上：**只在全库标题唯一、且计划那时已经存在时**才关联。
   两条同名计划时分不清是哪一条 —— 宁可不关联（这条记录就记成未计划），也不记到别人账上。
   这是"输入解析"而不是"身份判定"：只发生一次（落库那一刻），之后归属只看 id。 */
function tbResolveTodoByTitle(title, startTime) {
  const want = tbNormTitle(title);
  if (!want) return null;
  const hits = (appData.todos || []).filter(function (x) {
    return x && tbNormTitle(x.title) === want;
  });
  if (hits.length !== 1) return null;
  /* 有起点就查出生时刻（同一把尺子，别再写第二套判断） */
  if (startTime != null) {
    const created = tbTodoCreatedAt(hits[0]);
    if (created == null || Number(startTime) < created) return null;
  }
  return hits[0];
}
/* 一次性迁移：把"老记录按任务名认亲"从**读路径**搬到启动时跑一次。
   ★ 学 super-productivity 的做法：记录的归属永远是计划 id，名字只用来显示。
     人家那边时长是任务自己的字段（task.timeSpentOnDay[日期]），写入按 id，
     全仓没有一处"按标题找任务"；我们这边是独立流水，老数据只存了 taskName，
     于是每到一处读取都要拿名字反查 —— 这就是「今天新建一条同名计划，
     把几天前同名的自由专注捡走」的来源（实测：⏰ 3:15~3:40 / 5 段 / 搁置 7 天）。
   能认的（当天 + 全库标题唯一）在这里把 todoId 补上并落盘，一次了结；
   认不出的一律保持 todoId = null（= 计划外专注）。从此读路径只认 id。 */
function migrateRecordOwnership() {
  if (!appData.__migration) appData.__migration = { runs: [] };
  if (!Array.isArray(appData.__migration.runs)) appData.__migration.runs = [];
  /* 用迁移日志本身当"跑过了"的标记（与 migrateSegLedger 同一套做法） */
  if (appData.__migration.runs.some(function (x) { return x && x.kind === 'recordOwnerV1'; })) return;
  let claimed = 0, planned = 0, orphans = 0;
  (Array.isArray(appData.records) ? appData.records : []).forEach(function (r) {
    if (!r || r.startTime == null) return;
    if (r.todoId != null) { planned++; return; } /* 已有身份，不动 */
    if (r.type === 'log') { orphans++; return; } /* 补记不对应任何计划 */
    /* 名字 + 唯一 + 出生时刻，三条一起判（tbLegacyNameClaimAllowed 单一来源） */
    const t = tbResolveTodoByTitle(r.taskName);
    if (t && tbLegacyNameClaimAllowed(r, t)) { r.todoId = t.id; claimed++; }
    else orphans++;
  });
  appData.__migration.runs.push({
    at: Date.now(), kind: 'recordOwnerV1', claimed: claimed, planned: planned, orphans: orphans
  });
  /* claimed 为 0 不落盘：没改任何东西就不写存储（空结果守卫，与保留中心同一条规矩） */
  if (claimed) { try { saveDataNow(); } catch (e) { if (window.__silent) window.__silent(e, '01d:migrateRecordOwnership'); } }
}
/* ---------------- 段落索引 ----------------
 * 问题：tbTodoSegList 原来每次都把**全部** records 扫一遍。待办页有 N 条计划就扫 N 遍，
 *   实测 6000 条记录 / 150 条计划时 renderTodos 要 536ms、统计页 1160ms ——
 *   这正是「多年使用就卡」的真正原因（不是数据长得不对，是取数形状不对）。
 * 做法（学 super-productivity 的取数形状，不是数据形状）：一次遍历建 Map<todoId, 段[]>
 *   + Map<'YYYY-MM-DD', 段[]>，之后按 id / 按天 O(1) 取桶，只在桶内再筛。
 * 失效：写入点显式调 tbInvalidateSegIndex()；另外用「数组身份 + 长度 + 版本号」三重校验，
 *   数据被整体替换（导入 / 恢复 / 回滚）时身份变了自动重建 —— **不会读到陈旧数据**。
 * ★ 索引只是缓存，唯一真相仍是 appData.records：取不到索引就重扫，结果必须与直扫逐项相同
 *   （tools/tests/c71_seg_index.js 用随机数据对拍，保证"加速"没改变语义）。 */
let _tbSegIdxVer = 0;
let _tbSegIdxCache = null;
function tbInvalidateSegIndex() { _tbSegIdxVer++; }
function tbSegIndex() {
  const arr = Array.isArray(appData.records) ? appData.records : [];
  const c = _tbSegIdxCache;
  if (c && c.arr === arr && c.len === arr.length && c.ver === _tbSegIdxVer) return c;
  const byTodo = Object.create(null);
  const byDay = Object.create(null);
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (!r || r.startTime == null) continue;
    const segs = (Array.isArray(r.segs) && r.segs.length)
      ? r.segs
      : [{ s: Number(r.startTime), e: Number(r.endTime) || 0 }];
    for (let j = 0; j < segs.length; j++) {
      const sg = segs[j];
      if (!sg || !Number(sg.s)) continue;
      /* ★ 段上带「出处」：recId 指向它所属的记录，authMs 是那条记录的**权威时长**。
         日程色块的长度要认这个数（区间只管画在哪），见 01eA tbActualOf。 */
      const _authSec = Number(r.effectiveSeconds) > 0
        ? Number(r.effectiveSeconds)
        : (Number(r.endTime) && Number(r.startTime) ? Math.max(0, Number(r.endTime) - Number(r.startTime)) / 1000 : 0);
      const seg = { s: Number(sg.s), e: Number(sg.e) || 0, recId: r.id == null ? null : r.id, authMs: _authSec * 1000 };
      const day = getDateStr(new Date(seg.s));
      if (r.todoId != null) {
        const k = String(r.todoId);
        (byTodo[k] || (byTodo[k] = [])).push(seg);
      }
      (byDay[day] || (byDay[day] = [])).push({ todoId: r.todoId, seg: seg });
    }
  }
  for (const k in byTodo) byTodo[k].sort(function (a, b) { return a.s - b.s; });
  _tbSegIdxCache = { arr: arr, len: arr.length, ver: _tbSegIdxVer, byTodo: byTodo, byDay: byDay };
  return _tbSegIdxCache;
}
/* ★ 时长与区间解耦
   sp 的做法：时长是 timeSpentOnDay[date] 逐秒累加的独立数字（task.reducer.ts），
   而 workStart/workEnd 只是"那天大概从几点干到几点"的**参考范围** —— 它在 reducer 里
   随手写 e: Date.now()，因为范围歪了时长一点都不受影响。
   我们此前的"共 X 分"是 Σ(段.e - 段.s)，区间一歪时长立刻跟着歪（43 分的来源）。
   这里把时长改成只认记录的权威值 effectiveSeconds（缺则 endTime-startTime），
   段（segs）只负责"画在哪、分几次"。区间再怎么被收口/裁切，都不再动到统计。

   dateStr 省略 = 不限日期；跨零点的一条记录按"当天的段占总时长的比例"折算。 */
function tbTodoFocusMs(t, dateStr, nowMs) {
  if (!t || t.id == null) return 0;
  const arr = Array.isArray(appData.records) ? appData.records : [];
  let ms = 0;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i];
    if (!r || r.todoId == null || String(r.todoId) !== String(t.id)) continue;
    const segs = (Array.isArray(r.segs) && r.segs.length)
      ? r.segs
      : [{ s: Number(r.startTime) || 0, e: Number(r.endTime) || 0 }];
    /* 权威时长：落库时就算好的那个数（与日志页同一口径） */
    let authMs = 0;
    const sec = Number(r.effectiveSeconds);
    if (isFinite(sec) && sec > 0) authMs = sec * 1000;
    else if (Number(r.endTime) && Number(r.startTime)) authMs = Math.max(0, Number(r.endTime) - Number(r.startTime));
    if (!dateStr) { ms += authMs; continue; }
    /* 指定某天：按当天段落占全段的比例切一份（跨零点不至于整天或半天空着） */
    let total = 0, inDay = 0;
    for (let j = 0; j < segs.length; j++) {
      const sg = segs[j];
      if (!sg || !Number(sg.s)) continue;
      const d = Math.max(0, (Number(sg.e) || 0) - Number(sg.s));
      total += d;
      if (getDateStr(new Date(Number(sg.s))) === dateStr) inDay += d;
    }
    if (!inDay) continue;
    const share = total > 0 ? (inDay / total) : 1;
    ms += authMs * share;
  }
  /* 正在计时的那条还没落库，只能按区间补（这一段本来就是"到现在为止"） */
  const ls = liveSessionOf(t.id);
  (ls && Array.isArray(ls.segs) ? ls.segs : []).forEach(function (sg) {
    if (!sg || !Number(sg.s)) return;
    if (dateStr && getDateStr(new Date(Number(sg.s))) !== dateStr) return;
    const e = Number(sg.e) || Number(nowMs) || Date.now();
    ms += Math.max(0, e - Number(sg.s));
  });
  return ms;
}
function tbTodoSegList(t, dateStr, excludeLive) {
  if (!t) return [];
  const out = [];
  /* 归属只看 todoId（权威身份）。没挂 id 的记录 = 计划外专注，**不按名字去猜**
     —— 名字不是身份；老数据里能认的在启动时已由 migrateRecordOwnership 补挂。 */
  const bucket = tbSegIndex().byTodo[String(t.id)];
  if (bucket) {
    for (let i = 0; i < bucket.length; i++) {
      const sg = bucket[i];
      if (dateStr && getDateStr(new Date(sg.s)) !== dateStr) continue;
      out.push({ s: sg.s, e: sg.e, recId: sg.recId, authMs: sg.authMs || 0 });
    }
  }
  if (!excludeLive) {
    const ls = liveSessionOf(t.id);
    (ls && Array.isArray(ls.segs) ? ls.segs : []).forEach(function (sg) {
      if (!sg || !Number(sg.s)) return;
      if (dateStr && getDateStr(new Date(Number(sg.s))) !== dateStr) return;
      /* 进行中会话还没落库，没有权威时长 —— 长度只能按区间画，这是"正在做"的语义 */
      out.push({ s: Number(sg.s), e: Number(sg.e) || 0, recId: null, authMs: 0 });
    });
  }
  out.sort(function (a, b) { return a.s - b.s; });
  return out;
}
/* 结算：把进行中会话的段落交给记录，会话随之消失（一次计时至此只剩记录这一份账本）。
   ★ 段落**搬**过去而不是复制：搬完 liveSessions 里就没有了，同一个事实只有一处存放。 */
function consumeLiveSessionForRecord(rec, todoId) {
  if (!rec || !todoId) return;
  const ls = liveSessionOf(todoId);
  if (!ls) return;
  if (Array.isArray(ls.segs) && ls.segs.length) {
    if (!Array.isArray(rec.segs) || !rec.segs.length) {
      /* ★ 落库这一刻是段落与记录的**最后一次对齐机会**，也是唯一一次有机会对齐：
         之后段落只活在记录里（计划身上没有第二份），错了就再也没有第二个地方能纠正。
         所以在这里做两件收口的事：
         ① 还开着的段（e=0）→ 结束 = 这条记录的结束时刻。
            典型成因：App 在专注中途被杀，段落停在"开着"；或 tick 被节流，
            到点那一刻根本没跑到 stopTimerLoop。不收口它就是永远「进行中」——
            计划卡写「5:18~进行中」、日程色块长到今天，而日志卡明明有准确收尾。
         ② 段结束越过记录结束 → 裁到记录结束。同一件事的两个数字不许互相矛盾：
            「✅ 5:18~6:01」配上「25 分钟」正是没做这一步的样子。 */
      const _end = Number(rec.endTime) || 0;
      const _clean = [];
      ls.segs.forEach(function (sg) {
        if (!sg || !Number(sg.s)) return;
        const s = Number(sg.s);
        let e = Number(sg.e) || 0;
        if (!e) e = _end || Date.now();
        if (_end && e > _end) e = _end;
        if (e > s) _clean.push({ s: s, e: e }); /* 退化成零长度 = 没有这件事，别留垃圾 */
      });
      if (_clean.length) {
        rec.segs = _clean;
        tbInvalidateSegIndex(); /* 记录的段落被就地改写（长度没变），必须显式失效 */
      }
    }
  }
  dropLiveSession(todoId);
}

/* 跨模块可变绑定的唯一写入口 */
function __setMustDoEditDate(v) { _mustDoEditDate = v; }
function savePomodoroRecord(type) {
  /* 自由专注：把弹窗里选定的真实时长喂给记录逻辑 */
  if (timerState.finishSource === 'free' && freeSettleSecs) {
    timerState.effectiveSeconds = freeSettleSecs;
    if (window._settleCtx && typeof window._settleCtx === 'object') window._settleCtx.effectiveSeconds = freeSettleSecs;
    bumpFreeStats(freeSettleSecs, (timerState && timerState.taskName) || '');
    freeSettleSecs = null;
  }
  if (type === 'full') {
    /* 完整番茄落库的触感确认（仅 full；half/打断不扰） */
    try { UIFX.fxVibrate(30); } catch (e) { if (window.__silent) window.__silent(e, '01d:savePomodoroRecord'); }
  }
  /* 开启结算收集 — 本次番茄触发的所有 toast 先收进数组，稍后合并为一条汇总 */
  window._settleMsgs = [];
  window._settleCollecting = true;
  /* R 清掉上一轮结算可能残留的 flush/deadline timer（连做两个番茄防串），
     并固化本轮 digest 上下文（flush 时 timerState 可能已被下一轮覆盖） */
  clearTimeout(_settleFlushTimer);
  clearTimeout(_settleDeadlineTimer);
  window._settleCtx = {
    type: type,
    effectiveSeconds: timerState.effectiveSeconds || 0,
    difficulty: timerState.difficulty || appData.settings.difficulty || 'medium'
  };
  window.__settleTouch = settleTouch;
  const energy = UIFX.getGridValue('finishEnergyPicker');
  const mood = UIFX.getGridValue('finishMoodPicker');
  const note = document.getElementById('finishNote').value.trim();
  /* 关联计划解析：优先当前选中的计划（id 权威）；
     手动输入任务名时按「规范化标题」找 —— **必须唯一**：库里两条同名计划时谁都别认，
     否则这个番茄会被记到上周那条同名计划头上（账是错的，而界面上看不出来）。
     ★ 原来这里 find() 取第一个匹配，同名就一定认错。 */
  let lt = timerState.linkedTodoId ? appData.todos.find(x => x.id === timerState.linkedTodoId) : null;
  if (!lt && timerState.taskName) {
    /* 手输名字 → 落计划：唯一 + 计划那时已存在（见 tbResolveTodoByTitle / tbTodoCreatedAt） */
    lt = tbResolveTodoByTitle(timerState.taskName, timerState.startTime);
  }
  /* 结束备注只属于这一次记录（record.note），不回写计划详情（t.detail）。
     计划详情是计划自己的说明，只在计划编辑面板里改；否则重复计划每完成一次
     就被上一轮的感受覆盖，攒几轮后原说明彻底找不回来。
     ★ 与「计时页备注框 ↔ 计划详情」的共通不是一回事：那是计划详情的编辑入口，
       这里是单次结算的备注。 */

  /* 🍅 折算番茄数：完整番茄按时长/25 折算（50分钟=2、25分钟=1），半个=0.5，未完成=0 */
  let _pomos = calcPomos(timerState.effectiveSeconds, type);
  /* 轻松模式（关怀）：今天第一个满 10 分钟的番茄按完整番茄计（同等段位积分，今天仅此一次） */
  if (
    type === 'full' &&
    isEasyModeActive() &&
    timerState.effectiveSeconds >= 600 &&
    !appData.rankSystem.easyModeBonusUsed
  ) {
    appData.rankSystem.easyModeBonusUsed = true;
    _pomos = Math.max(_pomos, 1);
  }
  /* 关联计划的实际用番茄计数：按折算数累加（「仅记录」不动任务账） */
  if (lt && type !== 'log') lt.actualPomodoros = (lt.actualPomodoros || 0) + _pomos;
  /* （timeSpent）：关联计划的累计有效专注时长（秒）同步回写，任务级时间账 */
  if (lt && type !== 'log') lt.timeSpent = (lt.timeSpent || 0) + (timerState.effectiveSeconds || 0);
  /* 金币抽奖：按折算数取整（50分钟=2 次，25分钟=1 次，半个=1 次） */
  if (_pomos > 0) addLotteryChance(Math.round(_pomos));
  /* 日志快照：预计番茄=创建记录时任务的预计值；实际番茄=到这条记录为止该任务的累计完成值。
     之后任务再加番茄，不会追溯修改已生成的旧记录（新番茄会写进新记录里）。 */
  /* 点「完成」时正在做的那条子任务（没有就为 null），记录里留痕 */
  const _curSub = lt ? findSubById(lt.subs, timerState.curSubId) : null;
  /* ★ 结束时刻：优先「自然完成的那一刻」——pendingFinish / 自动结算快照把它带进 finishEndedAt
     （见 01c onTimerComplete / restorePendingFinish / restoreTimerSnapshot）。
     取不到才退回现在：手动提前结束、自由专注、补记都属于「结算即结束」，口径不变。
     两道兜底防脏数据：结束不得早于开始、不得晚于现在。 */
  const _nowMs = Date.now();
  let _recEnd = Number(timerState.finishEndedAt) || 0;
  timerState.finishEndedAt = 0; /* 一次结算只消费一次，别漏给下一个番茄 */
  if (_recEnd <= 0 || _recEnd > _nowMs) _recEnd = _nowMs;
  if (Number(timerState.startTime) && _recEnd < Number(timerState.startTime)) _recEnd = _nowMs;
  /* ★ 起点必须与时长自洽：`startTime` 是「最后一次继续」的时刻（每次暂停→继续都会重设），
     而 `effectiveSeconds` 是**累计专注时长**，两者不是同一个量。
     21:17 开始、中途暂停过的那次专注，落库只剩 21:40~21:49 —— 日志写「8 分钟」，
     结算却说「专注 31 分钟」，用户一眼就看穿这是错的（2026-10-29 他正是这么报的：
     「我明明专注了 31 分钟，但是它是 9:40 到 9:49，这不才 10 分钟吗」）。
     口径：结束时刻不动，起点回推成「结束 − 累计专注时长」。
     代价：暂停的那段不落在区间里 —— 它本来也不该算进专注块。 */
  const _effMs = Math.max(0, Number(timerState.effectiveSeconds) || 0) * 1000;
  let _recStart = Number(timerState.startTime) || 0;
  if (_effMs > 0 && _recStart > 0 && _recEnd - _recStart < _effMs) {
    _recStart = Math.max(0, _recEnd - _effMs);
  }
  const record = {
    id: _nowMs,
    /* 数据契约：uid 是同步主键（id 沿用数值，被 200+ 处引用不改）；
       updatedAt 在结算时等于结束时刻，用户之后编辑会由 touchRecord 刷新。 */
    uid: newUid('rec'),
    updatedAt: _recEnd,
    type: type,
    /* 自由专注没有任务名：用备注当标题，免得日志里一条条全是「未命名（点开可补）」 */
    taskName: (timerState.finishSource === 'free') ? (timerState.taskName || note || '自由专注') : timerState.taskName,
    note: note,
    startTime: _recStart,
    endTime: _recEnd,
    effectiveSeconds: timerState.effectiveSeconds,
    pomos: _pomos,
    difficulty: timerState.difficulty || appData.settings.difficulty || 'medium',
    interruptions: timerState.interruptions,
    totalInterruptSeconds: timerState.totalInterruptSeconds,
    startEnergy: timerState.startEnergy,
    startMood: timerState.startMood,
    energy: energy || null,
    mood: mood || null,
    expectedPomodoros: lt ? (lt.pomodoros != null ? lt.pomodoros : null) : null,
    actualPomodoros: lt ? lt.actualPomodoros || 0 : null,
    /* 计划联动快照：记录里带上计划 id / 标签 / 四象限 / 正在做的那条子任务，
       这样专注记录自己能说清「这是哪个计划的哪一步」，不必回头翻计划表 */
    todoId: lt ? lt.id : null,
    tag: lt && lt.tag ? lt.tag : null,
    quad: lt ? normQuad(lt.quad) : null,
    subTitle: _curSub ? _curSub.title : null,
    subId: _curSub ? _curSub.id : null,
    /* 计划名 + 整份子任务快照：回顾/日志要能直接看到「这个计划的哪几步」，
       只有当前那一条子任务不够用（大多数专注并没有先点某一步）。
       快照而非引用 —— 计划日后改了步骤，历史日志不被改写。 */
    planTitle: lt ? (lt.title || null) : null,
    /* 截止时刻 = 这条记录自己的结束时刻，不是「现在」：
       结算窗拖到晚上才点确认、或 App 被杀后第二天恢复，都不会把之后完成的步骤算进来。
       ★ 例外：用户在结算弹窗里亲手补勾过（settleSubsEdited）→ 不做截断。
         那一下的 doneAt 必然晚于 _recEnd，按截断处理就会把他刚勾的步骤判成"没完成"，
         而这正是他要补的那一步。 */
    planSubs: lt
      ? snapshotPlanSubs(lt, (typeof timerState !== 'undefined' && timerState.settleSubsEdited) ? 0 : _recEnd)
      : null
  };
  appData.records.push(record);
  /* 结算弹窗里「补勾子计划」的标记：已经在上面 planSubs 用掉了，到此清零 */
  if (typeof timerState !== 'undefined') timerState.settleSubsEdited = false;
  tbInvalidateSegIndex(); /* 新记录 → 段落索引必须重建（缓存只是加速，不能变陈旧） */
  /* ★ 把进行中会话的段落**搬**进这条记录（见 consumeLiveSessionForRecord）：
     从这一刻起，这次计时的段落只存在于这条记录里 —— 删记录即整件事消失，不留孤儿。 */
  if (lt) consumeLiveSessionForRecord(record, lt.id);
  /* 🪙 时长奖励：走**收益乘数链**（00_pure_core 的 coinEarnFinal = 档位 × 连续加成 × buff）。
     档位与旧实现完全等价：≥86 分钟 → 6；≥48 → 3；≥24 → 1；不足 24 → 0（取最高档、不叠加）。
     ★ 以后调平衡改 COIN_EARN_TUNING 一处（含连续加成步长），不必回来翻这段 if 链；
       新增一类加成 = 链上再加一个乘数项。 */
  const _durSec = timerState.effectiveSeconds || 0;
  const _durCoin = coinEarnFinal({
    minutes: _durSec / 60,
    streakDays: (appData.tree && appData.tree.waterStreak) || 0
  });
  if (_durCoin > 0 && type !== 'log') {
    coinEarn(_durCoin, 'duration', '专注 ' + Math.floor(_durSec / 60) + ' 分钟时长奖励', { recordId: record.id });
    setTimeout(function () {
      UIFX.toast('🪙 时长奖励 +' + _durCoin + ' 金币（专注 ' + Math.floor(_durSec / 60) + ' 分钟）');
    }, 700);
  }
  if (type === 'full') {
    /* 计数不在这里累加：本轮统计一律由记录现算（computeRoundStats），
       否则删日志 / 改类型 / 导入备份后数字会对不上 */
    /* 结算链加固：树成长/习惯联动/沉浸式/长休/疲劳提示等副作用独立 try，
       任一环节异常只跳过自身，不阻断记录保存与后续结算
       @see ARCHITECTURE-DECISIONS.md #10（错误分级上报 + 局部隔离） */
    try {
      addTreePoints(_pomos);
      /* 金币按树成长自然发放积分转金币，见 addTreePoints） */
      const today = getTodayStr();
      const hasHabitToday = appData.habits.some(h => (appData.habitLogs[h.id] || []).includes(today));
      if (hasHabitToday && appData.tree.lastHabitBonusDate !== today) {
        appData.tree.lastHabitBonusDate = today;
        addTreePoints(1);
        setTimeout(function () {
          UIFX.toast('🌿 习惯打卡联动，番茄树+1奖励！');
        }, 700);
      }
      /* 沉浸式专注：先推进冒险（可能在此结算结局），冒险结束后不再自动触发长休弹窗（总结弹窗独占） */
      UIFX.immersiveOnTomatoSettled(type);
      if (!(appData.settings.immersiveFocus && appData.immersiveFocus.ended)) checkLongBreakTrigger();
      /* 疲劳检测：专注质量下滑时主动建议休息/缩短时长（心流保护） */
      const _fat = checkFatigueAdvice();
      if (_fat) UIFX.toast(_fat, true);
      /* 结算链空 catch 接错误监控（warn 级、按 tag 节流），静默失效可诊断 */
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'settleFull');
    }
  } else if (type === 'half') {
    try {
      addTreePoints(0.5);
      /* 半个番茄也计入段位进度：超额点数满 1 点结算 1 星（内部按 0.5 点数计算） */
      onPomodoroCompleteRank();
      UIFX.immersiveOnTomatoSettled(type);
      if (_pomos > 0) UIFX.showPomodoroCelebration(_pomos);
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'settleHalf');
    }
  } else if (type === 'incomplete') {
    try {
      UIFX.immersiveOnTomatoSettled(type);
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'settleIncomplete');
    }
  }
  saveData();
  /* 冲段提示：跨过第 9 个🍅进入冲刺区 / 达成破限连击(7天×12+) */
  if (_pomos > 0) {
    const _sp = getSprintInfo();
    const _cross9 = _sp.todayCount >= 9 && _sp.todayCount - _pomos < 9;
    if (_cross9) {
      setTimeout(function () {
        UIFX.toast(
          '🔥 今日已超 8 个🍅，进入冲刺区！今日第 9 个起积分 ×' + (_sp.streak >= 7 ? 1.8 : _sp.streak >= 1 ? 1.4 : 1.2),
          true
        );
      }, 1600);
    } else if (_sp.todayCount >= 12 && _sp.todayCount - _pomos < 12) {
      const _st = _sp.streak + 1; /* 含今天的连击 */
      if (_st === 7)
        setTimeout(function () {
          UIFX.toast('⚡ 破限冲刺达成！连续 7 天每天 12+🍅，超额积分 ×1.8', true);
        }, 1600);
    }
  }
  if (_pomos > 0 && (type === 'full' || type === 'half')) {
    try {
      checkGachaTrigger();
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'gachaTrigger');
    }
  }
  UIFX.updateTodayStats();
  UIFX.renderWeeklyBadges();
  checkTreeDailyTasks();
  if (timerState.linkedTodoId) {
    UIFX.renderTodos();
    UIFX.refreshTodoSelect();
  } /* 关联计划的实际用🍅已更新 → 同步计划列表与下拉 */
  UIFX.renderGhostBar();
  if (type === 'full') {
    /* 加固：庆祝/段位结算/成就检查异常不阻断自动休息与传记写入 */
    try {
      UIFX.playSound('completeFull');
      if (_pomos > 0) UIFX.showPomodoroCelebration(_pomos);
      showTomatoDropAnimation();
      onPomodoroCompleteRank();
      setTimeout(() => checkNewAchievements(), 500);
    } catch (e) {
      if (window.__errRep && __errRep.silent) __errRep.silent(e, 'settleCelebrate');
    }
  }
  /* 「只要点了结束，就直接进休息」——不按结算类型分成三六九等。
     选「未完成」时若不进休息，会一声不响回到待机（无弹窗、无提示），
     而这条规则界面上完全看不见；休息本身已有「跳过休息」，多一道隐藏门槛没有意义。
     唯一的例外：沉浸式冒险终章结算（其总结弹窗自带「开始休息 / 再来一轮」）。 */
  {
    /* 冒险结束（终章已结算）时不再自动进短休：总结弹窗里提供「开始休息/再来一轮」 */
    const _imfEnd = appData.immersiveFocus;
    /* 走这条链 = 你刚刚真的跑完一段计时（补记是另一条路 addManualRecord，根本不经过这里）。
       所以休息不按「记录类型」分：选「仅记录」只是说这段不计番茄账，
       不等于你刚才没在专注 —— 计不计番茄是记账，休不休息是身体。 */
    if (!(appData.settings.immersiveFocus && _imfEnd && _imfEnd.ended)) {
      setTimeout(() => {
        /* ★ 幂等：结算链（01c）若已按「实际专注时长」进了休息，就别在这里再起一段
           —— 再起的一次会拿「休息自身的时长」去查分级表，把刚起的休息缩短一档
           （50 分钟专注起 10 分休息，300ms 后会被改成 3 分）。
           短时段 / 仅记录由 __noAutoBreak 明确拦下，不强行打断。 */
        const _noAuto = !!timerState.__noAutoBreak;
        timerState.__noAutoBreak = false;
        if (!_noAuto && timerState.mode === 'idle') startBreak('short');
      }, 300);
    }
  }
  try {
    UIFX.checkBiographyEvents();
  } catch (e) {
    if (window.__errRep && __errRep.silent) __errRep.silent(e, 'biographyEvents');
  }
  /* 打断/低产达到阈值时，不必等下次冷启动才可能看到关怀弹窗。
     此前 maybeShowCareModal 只在 App 启动时调一次，用户做完一轮状态很差也不会被推荐轻松模式；
     这里在每次番茄落库后补一次检查（当天只弹一次，由 lastCareModalDate 幂等保护）。 */
  if (type !== 'log' && (type === 'incomplete' || (timerState.interruptions && timerState.interruptions.length))) {
    setTimeout(function () {
      try {
        UIFX.maybeShowCareModal();
      } catch (e) {
        if (window.__errRep && __errRep.silent) __errRep.silent(e, 'careModal');
      }
    }, SETTLE_DEADLINE_MS + 400);
  }
  /* R 不再用固定 3.5s 猜时长。注册"最迟兜底"flush（与历史窗口语义一致），
     提前出卡由 01e showToast 收集分支的 __settleTouch() 事件续期驱动 */
  _settleDeadlineTimer = setTimeout(flushSettleSummary, SETTLE_DEADLINE_MS);
}
function formatPomodoros(p) {
  if (p === null || p === undefined || p === '') return '';
  /* 0 = 没填 —— 没填就别显示「预计0🍅」
     —— 0 不等于"0 个番茄"，等于"用户没说过"。空串让调用方自然不渲染。 */
  if (Number(p) === 0) return '';
  if (p === 0.5) return '半个🍅';
  if (p % 1 === 0) return p + '🍅';
  return p + '🍅';
}
/* 快捷语法解析（标题内联 #标签 +🍅 !最晚完成日 @提醒时间） */
function parseTodoShortSyntax(raw) {
  let title = (raw || '').trim();
  let tag = '',
    deadline = null,
    remindAt = null,
    pomodoros = null;
  title = title.replace(/@(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})/g, function (_, d, t) {
    remindAt = d + ' ' + t;
    return '';
  });
  title = title.replace(/@(\d{1,2}:\d{2})/g, function (_, t) {
    remindAt = getTodayStr() + ' ' + t;
    return '';
  });
  title = title.replace(/!(\d{4}-)?(\d{1,2})-(\d{1,2})/g, function (_, y, m, d) {
    const year = y ? y.slice(0, 4) : String(new Date().getFullYear());
    deadline = year + '-' + String(parseInt(m, 10)).padStart(2, '0') + '-' + String(parseInt(d, 10)).padStart(2, '0');
    return '';
  });
  title = title.replace(/\+\s*(\d+(?:\.\d+)?)/g, function (_, n) {
    pomodoros = parseFloat(n);
    return '';
  });
  title = title.replace(/#([^\s#+!@]+)/g, function (_, m) {
    tag = m.slice(0, 12);
    return '';
  });
  title = title.replace(/\s+/g, ' ').trim();
  return { title: title, tag: tag, deadline: deadline, remindAt: remindAt, pomodoros: pomodoros };
}
