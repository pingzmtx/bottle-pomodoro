/* ==================== 模块: 01eB_ui_habit.js | 职责: 习惯区 UI（由 01e_engine_ui.js 按「习惯/打卡」域拆出）| 分组: ui ==================== */
/* 拆分原因：单文件规模红线（tools/w6_size.py，>6000 行 FAIL）。
 * 本文件承载「习惯」这一完整域：新增/打卡/热力图/阶段徽标/分类文件夹/详情弹窗/
 * 归档/删除。与 01e 的其余域无共享私有状态，只依赖 appData / saveData / showModal /
 * 函数索引（TOC）：addHabit/toggleHabit/habitHeatmapHtml/habitDueToday/habitStatsLine/habitStageBadge/habitRepeatBadge/habitRepeatLabelCompact/habitSubLineHtml/_habitRowHtml/habitCatColor/toggleHabitOffSection（+67 更多）
 * renderHabits 等全局入口，故可整块外移。
 *
 * ★ 2026-10-30 习惯「节奏」升级（三件事，全在本文件 + 00_pure_core 的习惯段）：
 *   ① 节奏：习惯可以不是天天打卡 —— h.repeat 复用计划页的重复规则（每天/工作日/每周几/
 *      每月几号/每隔 N 天），口径全在 00_pure_core（habitRepeatOf/habitDueOn/habitStats）。
 *      本文件只负责把 repeatUIHtml('habit', ...) 嵌进新建弹窗、读写控件。
 *   ② 按日筛选：今天不该做的习惯默认收进「今天不用做（N）」，展开可见可补卡；
 *      另加一层「眼睛」= 今天先不看（h.skipOn），逐条可放回，藏了必给回执（不静默消失）。
 *   ③ 新建/编辑改成弹窗：右上角 ＋ → habitEditModal，字段写回保留 uid/createdAt/growthPoints，
 *      改规则不动历史打卡（改的是未来口径，不改过去账）。
 *   老数据：没有 repeat = 每天，与升级前逐项一致；freqPerWeek 原样留着（无 repeat 时才生效）。 */
/* 新建习惯 → 弹窗（不是「一个输入框 + 回车」）：
 * 只靠一个输入框只能建出「每天」的习惯，节奏/分类/戒除型都得建完再进详情改两遍 ——
 * 用户要的是「跟添加计划一样，点加号弹窗让我选」（2026-10-30 原话）。
 * 函数名保留 addHabit：它是 data-act 目标与外部巡检脚本的入口，改名等于砸入口。 */
function addHabit() {
  openHabitEditModal();
}
function toggleHabit(id, dateStr) {
  const today = getTodayStr();
  const targetDate = dateStr || today;
  if (targetDate > today) {
    showToast('不能打卡未来日期');
    return;
  }
  /* 习惯可能在另一处被删除 / habitLogs 残留了孤儿 id。
     原代码直接 h.growthPoints 会在 h 为 undefined 时抛错，且因为点击就抛、
     表现为「点一次报一次错、习惯完全划不动」。这里做防御 + 清理孤儿记录。 */
  const h = appData.habits.find(x => idEq(x.id, id));
  if (!h) {
    if (appData.habitLogs[id]) delete appData.habitLogs[id];
    saveData();
    renderHabits();
    showToast('该习惯已不存在，已清理残留记录');
    return;
  }
  if (!appData.habitLogs[id]) appData.habitLogs[id] = [];
  const idx = appData.habitLogs[id].indexOf(targetDate);
  const _wasChecked = idx >= 0;
  if (_wasChecked) {
    appData.habitLogs[id].splice(idx, 1);
  } else {
    appData.habitLogs[id].push(targetDate);
    /* ★ 2026-10-30 审查修复（S1）：打了卡就撤销这天的「跳过」。
       否则「先点眼睛说不做 → 后来做了 → 补一次卡」这条最常见的路径上，
       跳过记录会把这次打卡从分子里抹掉：打卡成功、数字不动，看着像没打上。
       语义上"做了就是做了"，打卡优先于跳过，所以在写入这条就解决，不留给统计去猜。 */
    _habitSetSkip(h, targetDate, false);
  }
  /* ★ 2026-11-08：成长点不再「打一次 +1 / 连击 +1」手工累加，改成按记录整条重算 ——
     手工加减是「打开 App 重复扣分」那个 bug 能存在的前提（一边乱扣一边乱加）。
     重算还顺带把「补打卡补到过去某天」的连击一并算对。 */
  syncHabitGrowth(h);
  saveData();
  renderHabits();
  renderRankSystem();
  renderWeeklyBadges();
  if (dateStr) {
    showToast(targetDate === today ? '已打卡' : '已补打卡');
    return;
  }
  /* 习惯打卡微庆祝（未完成→完成时） */ if (!_wasChecked) {
    playSound('habitDone');
    if (navigator.vibrate) navigator.vibrate(35);
    showToast('🌱 已打卡：' + h.name);
  } else if (navigator.vibrate) navigator.vibrate(20);
}
/* 近 N 天打卡热力条：左旧右新（读法是「最近一段时间有没有坚持下来」，顺着时间轴看）。
   只画格子，不写文字 —— 文字信息在上一行的统计里。
   跳过日画成第三种状态（浅灰虚线点）：它不是"漏了"，用户不该在回看时被它刺一下。 */
function habitHeatmapHtml(h, days) {
  const win = recentDateStrs(getTodayStr(), days).reverse();
  const set = {};
  (appData.habitLogs[h.id] || []).forEach(function (d) { set[String(d).slice(0, 10)] = true; });
  const skips = habitSkipSet(h, habitSkipsOf(h));
  return '<div class="habit-heat">' + win.map(function (d) {
    const on = !!set[d];
    const sk = !on && !!skips[d];
    return '<span class="habit-heat-cell' + (on ? ' on' : (sk ? ' skip' : '')) + '" title="' + d + (on ? ' 已打卡' : (sk ? ' 跳过（不算欠账）' : ' 未打卡')) + '"></span>';
  }).join('') + '</div>';
}
/* 这个习惯的跳过日列表：读档入口在 01b_engine_data.js 的 habitSkipsOf
   （★ 2026-10-30 审查修复：原来定义在这里，01d 的 getHabitStreak 够不着，
    于是"排序/成就用的连续数"和"列表显示的连续数"各算各的）。 */
/* 今天该不该做 —— 视图层唯一入口。
   判定要三样东西：规则/配额（habitDueOn 内部判）、跳过日、打卡历史（配额型算本周打了几次）。
   三样都在这儿备齐再问一次，避免同一个问题在四个文件里各答一遍（答着答着就不一致了）。 */
function habitDueToday(h, ds) {
  const d = ds || getTodayStr();
  return habitDueOn(h, d, habitSkipSet(h, habitSkipsOf(h)), appData.habitLogs[h.id] || []);
}
/* 列表行的统计只留「当前连续 + 近30天达标」两条最常用的；
   历史最长 / 成长值 / 段位名 都在详情弹窗里（列表塞四条会被挤成三行）。
   ★ 规则型习惯的连续数按「命中日」算，单位是「次」不是「天」（口径见 00_pure_core 习惯段）
   ★ 配额型（每周 N 次）没有"连续天数"这回事 —— 它的进度是「本周 2/3」，
     所以这一行换口径而不是硬塞一个 0（"连续 0 周"对用户没有信息量）。 */
function habitStatsLine(h, today) {
  const hs = habitStats(h, appData.habitLogs[h.id] || [], today, HABIT_WINDOW_DAYS, habitSkipsOf(h));
  if (hs.quota) {
    const full = hs.weekDone >= hs.weekTarget;
    return (full ? '✅ 本周 ' : '📅 本周 ') + hs.weekDone + '/' + hs.weekTarget
      + ' · <span class="habit-rate">达标 ' + Math.round(hs.rate * 100) + '%</span>';
  }
  /* 「达标 X%」整段不折行：宽度紧张时宁可断在「·」后面，也不要把数字和标签拆到两行 */
  /* ★ 2026-10-30 审查修复（M2）：窗口内一次都不该做的规则型（比如"每月 31 号"遇短窗），
     分母是 0 —— 此时写「达标 0%」等于说他全月偷懒，实际是这期没他的事。 */
  const rateHtml = hs.expected > 0
    ? '<span class="habit-rate">达标 ' + Math.round(hs.rate * 100) + '%</span>'
    : '<span class="habit-rate">本期无需打卡</span>';
  return '🔥 连续 ' + hs.cur + ' ' + habitStreakUnit(h) + ' · ' + rateHtml;
}
/* 段位徽标：列表行标题右边的小胶囊 */
function habitStageBadge(h) {
  const stage = getHabitStage(h.growthPoints || 0);
  return '<span class="habit-stage-badge" title="成长值 ' + (h.growthPoints || 0) + '">' + escapeHtml(stage.name) + '</span>';
}
/* 节奏徽标：让「我哪天做这个习惯」在列表上一眼可见
   （无规则且每天 = 默认值，不必占位；配额型「每周 3 次」必须显示，
     否则它会显得和每天型没区别） */
function habitRepeatBadge(h) {
  if (!habitRepeatOf(h) && !habitIsQuota(h)) return '';
  return '<span class="habit-rep" title="节奏：' + escapeHtml(habitRepeatLabel(h)) + '">🔄 ' +
    escapeHtml(habitRepeatLabelCompact(h)) + '</span>';
}
/* 节奏的紧凑文案：去掉星期之间的顿号（每周二、四、六 → 周二四六），省 30px。
   完整文案仍在 title 里（habitRepeatLabel）。 */
function habitRepeatLabelCompact(h) {
  const rr = habitRepeatOf(h);
  if (!rr) return habitIsQuota(h) ? '每周' + habitFreqPerWeek(h) + '次' : '每天';
  const n = normTodoRepeat(rr);
  if (!n) return habitRepeatLabel(h);
  let s;
  if (n.mode === 'daily') s = '每天';
  else if (n.mode === 'weekdays') s = '工作日';
  else if (n.mode === 'weekly') s = '周' + (n.weekdays || []).map(function (d) { return REPEAT_WEEK_CN[d - 1]; }).join('');
  else if (n.mode === 'monthly') s = n.dom === 0 ? '每月末' : '每月' + n.dom + '日';
  else s = '每' + n.interval + '天';
  if (n.until) s += ' 至 ' + n.until; /* 有截止日的很少，直接跟着，别丢信息 */
  return s;
}
/* 眼睛按钮：逐条「今天先不看」（次日自动回来）。只在「今天该做」的行上出现 ——
   本来就不用做的行不需要再藏一次。 */
var _HABIT_EYE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
/* 子计划在习惯行里直接列出来、**就地能勾**（2026-11-04 用户原话：
   「习惯的这个子计划，它为什么不能像那个计划，就是任务里面的子计划在外显选勾呢？
     非要点进去」）。
   ★ 口径照抄任务卡：折叠态也把子任务摊在卡片里、每行一个 .sub-cb + 名字，
     勾选走同一个 toggleHabitSub —— 不为「行内勾」再造第二个落库路径。
   ★ 只列**今天有份**的子计划（排期在别的日子的不占今天的版面），全勾完给整段一个 .all。 */
function habitSubLineHtml(h, today) {
  const list = habitSubsOn(h, today);
  if (!list.length) return '';
  const done = habitSubsDoneOn(h, today, list);
  const rows = list.map(function (s) {
    const on = normHabitSubDate(s.doneOn) === today;
    const st = normHabitSubTime(s.time);
    /* 2026-11-05：一行就是计划卡里那条 .tf-sub —— 勾选框 26px、正文用 --fs-body，
       和「任务下的子任务」同一个尺寸。之前为了塞进 160px 的信息列把它压成 18px/12px，
       读起来像脚注、点起来像针尖（用户原话「非常的小」）。
       宽度不够就折行，不截断：宁可两行，也不把一句话削成省略号。 */
    return '<div class="tf-sub' + (on ? ' done' : '') + '">' +
      '<div class="sub-cb' + (on ? ' checked' : '') + '" onclick="event.stopPropagation();toggleHabitSub(' +
        idArg(h.id) + ',' + idArg(s.id) + ')" title="' + (on ? '点击取消完成' : '点击标记完成') + '">' + SUB_CB_SVG + '</div>' +
      '<span class="tf-sub-txt" title="' + escapeHtml(s.text) + '">' + escapeHtml(s.text) +
        (st ? '<i class="tf-sub-sched">' + escapeHtml(st) + '</i>' : '') + '</span>' +
      '</div>';
  }).join('');
  return '<div class="habit-subline habit-subline--list' + (done === list.length ? ' all' : '') + '">' + rows + '</div>';
}
/* withMove：计划页 dock 用 —— 让它把「↑↓」也画出来。
   ★ 为什么必须画：这一行的宽度分配是 flex 自动分的，少一个 73px 的 .habit-move，
     信息列就从 183px 撑到 221px，热力图由「一行 12 格」变成「两行」，整行高度 104→110。
     于是 dock 和习惯页看着「差不多但不一样」—— 用户原话就是这么来的。
     要复刻就一个像素都别省：dock 传 withMove=true，按钮能点（排序是全站同一份 order）。 */
function _habitRowHtml(h, today, draggable, withMove) {
  const checked = (appData.habitLogs[h.id] || []).includes(today);
  const due = habitDueToday(h, today);
  const skipped = habitSkippedOn(h, today, habitSkipsOf(h));
  const _cbHtml = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect class="cb-shape" x="2.5" y="2.5" width="19" height="19" rx="6"/><polyline class="cb-check" points="6,12 10.5,16.5 18,8"/></svg>';
  const _noteHtml = h.note ? '<div class="habit-note">' + escapeHtml(h.note) + '</div>' : '';
  /* 负面习惯（戒除型）：打卡含义是「今天守住了」。
     只换徽标和一行提示，**不动任何统计口径** —— 打卡就是达成，
     streak / 成长点 / 达标率照旧，否则同一套数字会有两种解释。 */
  const bad = h.polarity === 'bad';
  const _polHtml = bad ? '<span class="habit-pol" title="戒除型：打卡表示今天守住了">戒</span>' : '';
  /* 今天不该做的行（含"今天先不看"的）：勾选框仍可点 = 补卡，但整行压暗，
     免得被当成漏打卡；排序按钮也收起来 —— 在「今天不用做」里调顺序没有意义，
     留着只会把一行挤成三截。 */
  /* 已经打过勾的行不压暗：配额型打满后 due 变 false，但今天那一笔是真做了，
     压暗它会让人以为"今天的打卡被撤销了" */
  const off = !h.archived && !checked && (skipped || !due);
  const offCls = off ? ' habit-item--off' : '';
  const drag = draggable && !off;
  /* 眼睛按钮：今天先不看（次日自动回来），放回必须一直可点，
     否则用户在「今天不用做」里看到它就再也放不回来了。
     ★ 2026-11-04：眼睛只藏卡、不再是"请假"—— 不保护连续数，也不算跳过日。
       所以提示文案里也不再写「不破链 / 不算欠账」。 */
  const _eye = (h.archived || (checked && !skipped)) ? '' : (skipped
    ? '<span class="habit-eye on" onclick="event.stopPropagation();toggleHabitSkip(' + idArg(h.id) + ')" title="放回今天该做">放回</span>'
    : (!due ? '' : '<span class="habit-eye" onclick="event.stopPropagation();toggleHabitSkip(' + idArg(h.id) + ')" title="今天先不看（只是把这张卡收起来，和没打卡一模一样：今天没打就今天没做，明天照常出现）">' + _HABIT_EYE_SVG + '</span>'));
  return '<div class="habit-item' + (bad ? ' habit-item--bad' : '') + offCls + '" data-id="' + h.id + '" draggable="' + (drag ? 'true' : 'false') + '" title="' + (drag ? '可拖拽排序' : '') + '">' +
    '<div class="habit-checkbox ' + (checked ? 'checked' : '') + '" onclick="toggleHabit(' + idArg(h.id) + ')" title="' + (due ? '今天打卡' : '今天不用做，点了就是补一次卡') + '">' + _cbHtml + '</div>' +
    '<div class="habit-info"><div class="habit-title-row"><span class="habit-name">' + escapeHtml(h.name) + '</span>' + _polHtml + habitRepeatBadge(h) + habitStageBadge(h) + '</div>' +
    /* 「今天不用做」不再往统计行里塞第三个标签：那一行只有 159px，
       塞进去就把四个字折成一竖列（实测）。它的上下文由所在区和压暗的行本身表达。 */
    '<div class="habit-streak">' + habitStatsLine(h, today) + '</div>' + _noteHtml +
    habitHeatmapHtml(h, HABIT_WINDOW_DAYS) + '</div>' +
    _eye +
    (h.archived ? '' : '<span class="habit-move" ' + ((drag || withMove) ? '' : 'style="display:none"') + '><button class="btn-small move-btn" onclick="event.stopPropagation();moveHabit(' + idArg(h.id) + ',-1)" title="上移">↑</button><button class="btn-small move-btn" onclick="event.stopPropagation();moveHabit(' + idArg(h.id) + ',1)" title="下移">↓</button></span>') +
    '<div class="habit-arrow" onclick="openHabitDetail(' + idArg(h.id) + ')">›</div>' +
    /* ★ 2026-11-05：子计划搬到卡片**最后一行、横跨整卡**（flex-wrap 换行），
       不再塞在 .habit-info 那 168px 的窄列里。
       窄列里它只能 18px 勾选框 + 12px 字，读起来像脚注、点起来像针尖（「非常的小」）；
       跟任务卡对齐的意思就是：和子任务同尺寸、同宽度，一行放不下就折行，不截断。 */
    habitSubLineHtml(h, today) +
    '</div>';
}
/* 习惯分类配色：按分类 id 稳定哈希取色（不写进数据，跨平台/跨会话一致，无需迁移）。
   8 档柔色 + 描边色，浅色主题下都能与白底拉开对比；分类重命名不影响颜色（只看 id）。 */
const HABIT_CAT_COLORS = [
  { fg: '#4F46E5', bg: '#EEF2FF' }, /* 靛蓝 */
  { fg: '#059669', bg: '#ECFDF5' }, /* 翠绿 */
  { fg: '#EA580C', bg: '#FFF7ED' }, /* 橙 */
  { fg: '#DB2777', bg: '#FDF2F8' }, /* 玫红 */
  { fg: '#0284C7', bg: '#F0F9FF' }, /* 天蓝 */
  { fg: '#7C3AED', bg: '#F5F3FF' }, /* 紫 */
  { fg: '#0D9488', bg: '#F0FDFA' }, /* 青 */
  { fg: '#E11D48', bg: '#FFF1F2' }  /* 红 */
];
function habitCatColor(cat) {
  const s = String(cat && cat.id ? cat.id : (cat && cat.name) || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HABIT_CAT_COLORS[h % HABIT_CAT_COLORS.length];
}
/* 「今天不用做」区的展开状态：只存内存、不落盘 ——
   它回答的是「这次想不想看」，下次打开回到收起；落盘就又变成"一屏全是今天不做的东西"。 */
var _habitOffOpen = false;
function toggleHabitOffSection() {
  _habitOffOpen = !_habitOffOpen;
  renderHabits();
}
/* 写/删某天的跳过记录。h.skipOn 一并维护：老版本存档只认它，
   新版把它当"当天"的快捷标记，两处同进同退才不会出现"这版说跳过了那版说没跳"。
   只保留最近 400 天 —— 跳过记录只服务于 30 天窗口与连续数，无限累积只是把存档养肥。
   ★ 2026-10-30 审查修复（L1）：注释一直这么写，但代码里没有截断（实测能攒到 500+ 条）。 */
var HABIT_SKIP_KEEP_DAYS = 400;
function _habitSetSkip(h, ds, on) {
  if (!appData.habitSkips || typeof appData.habitSkips !== 'object') appData.habitSkips = {};
  const k = String(h.id);
  let arr = Array.isArray(appData.habitSkips[k]) ? appData.habitSkips[k].filter(function (d) {
    return String(d).slice(0, 10) !== ds;
  }) : [];
  if (on) arr.push(ds);
  arr.sort();
  /* 截断只保留最近的 400 条：arr 已升序，slice(-N) 留下日期最大的那批 */
  if (arr.length > HABIT_SKIP_KEEP_DAYS) arr = arr.slice(arr.length - HABIT_SKIP_KEEP_DAYS);
  if (arr.length) appData.habitSkips[k] = arr;
  else delete appData.habitSkips[k];
  if (on) h.skipOn = ds;
  else if (h.skipOn && String(h.skipOn).slice(0, 10) === ds) delete h.skipOn;
}
/* 逐条「今天先不看」/ 放回。
   ★ 2026-11-04 改口径（用户原话：「假如今天没完成，我就想不看了，把眼睛一关闭。
     那个跳过，为什么它会保留连续的天数呢」）：
     眼睛 = **只是今天把这张卡收起来**，不再写跳过记录。
     没做就是没做 —— 连续数该断就断、达标率该扣就扣（今天还没过完，所以今天这一笔不扣，
     过了零点还没打卡，第二天看到的就是断链）。跳过日那套"请假不欠账"的语义留给老存档，
     UI 不再产生新记录。 */
function toggleHabitSkip(id) {
  const h = appData.habits.find(x => idEq(x.id, id));
  if (!h) return;
  const today = getTodayStr();
  if (habitSkippedOn(h, today, habitSkipsOf(h))) {
    _habitSetSkip(h, today, false);
    delete h.skipOn;
    h.updatedAt = Date.now();
    syncHabitGrowth(h);
    saveData();
    renderHabits();
    showToast('已放回：' + h.name);
    return;
  }
  /* 今天已经打过卡就别再收起来：打卡是真做了的一笔，
     藏起来只会让人误以为"打卡没了"（而且统计里那一笔仍然在）。 */
  if ((appData.habitLogs[h.id] || []).indexOf(today) >= 0) {
    showToast('今天已经打过卡了，不用再藏起来');
    return;
  }
  /* 只写眼睛，不写跳过：account（分母/连续数）里这一天照常算「该做没做」 */
  h.skipOn = today;
  h.updatedAt = Date.now();
  saveData();
  /* 藏起来必须给回执：不自动展开的话，用户会以为习惯被删了 */
  _habitOffOpen = true;
  renderHabits();
  showToast('今天不看「' + h.name + '」：明天照常出现');
}
/* 一键放回今天所有收起来的习惯 */
function restoreHabitSkips() {
  const today = getTodayStr();
  let n = 0;
  (appData.habits || []).forEach(function (h) {
    if (h && habitSkippedOn(h, today, habitSkipsOf(h))) { _habitSetSkip(h, today, false); delete h.skipOn; h.updatedAt = Date.now(); n++; }
  });
  if (!n) { showToast('今天没有被收起来的习惯'); return; }
  saveData();
  renderHabits();
  showToast('已放回 ' + n + ' 个');
}
/* 顶部一行实话：今天该做几个、打了几个、另有几个今天不用做（过滤不许静默） */
function _habitDueLineHtml(dueList, offList, today) {
  if (!dueList.length && !offList.length) return '';
  const done = dueList.filter(function (h) { return (appData.habitLogs[h.id] || []).indexOf(today) >= 0; }).length;
  let s = '<div class="habit-due-line">今天该做 <b>' + dueList.length + '</b> 个 · 已打 <b>' + done + '</b> 个';
  if (offList.length) s += ' · 另有 <b>' + offList.length + '</b> 个今天不用做';
  return s + '</div>';
}
/* 分类文件夹（只在有分类时走）：成员来自「今天该做」那一堆，归档/今天不做的都不进 */
function _habitFoldersHtml(items, cats, open, today, rowOf) {
  const checkedToday = function (h) { return (appData.habitLogs[h.id] || []).indexOf(today) >= 0; };
  return habitCatGroups(items, cats).map(function (grp) {
    /* 今天一条都不做的分类不画空壳（0/0 的文件夹头只是噪音）：
       它的成员都在下面「今天不用做」里，一条都不会丢 */
    if (!grp.items.length) return '';
    if (grp.id === '') {
      return (
        '<div class="habit-folder-head habit-folder-head--plain" style="--cat:var(--text-light);--cat-soft:var(--surface-2)">' +
        '<span class="folder-chip">·</span>' +
        '<span class="folder-name">未分类</span>' +
        '<span class="folder-today">' + grp.items.length + '</span>' +
        '</div>' +
        '<div class="habit-folder-body" data-cat="">' + grp.items.map(rowOf).join('') + '</div>'
      );
    }
    const opened = !!open[grp.id];
    const c = habitCatColor(grp);
    const mono = escapeHtml(Array.from(grp.name || '?')[0] || '?');
    const done = grp.items.filter(checkedToday).length;
    const style = '--cat:' + c.fg + ';--cat-soft:' + c.bg;
    return (
      '<div class="habit-folder-head' + (opened ? ' open' : '') + '" style="' + style + '" onclick="toggleHabitCat(' + idArg(grp.id) + ')">' +
      '<span class="folder-chip">' + mono + '</span>' +
      '<span class="folder-name">' + escapeHtml(grp.name) + '</span>' +
      '<span class="folder-today' + (done > 0 && done === grp.items.length ? ' all' : '') + '" title="今日已完成 ' + done + '/' + grp.items.length + '">' + done + '/' + grp.items.length + '</span>' +
      '<svg class="folder-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
      '<span class="folder-del" onclick="event.stopPropagation();deleteHabitCat(' + idArg(grp.id) + ')" title="删除分类（习惯退回未分类）">✕</span>' +
      '</div>' +
      (opened ? '<div class="habit-folder-body" style="' + style + '" data-cat="' + escapeHtml(String(grp.id)) + '">' + grp.items.map(rowOf).join('') + '</div>' : '')
    );
  }).join('');
}
/* 「今天不用做」区：默认收起，展开后仍可查看/补卡/放回 */
function _habitOffSectionHtml(offList, today, rowOf) {
  if (!offList.length) return '';
  const skipped = offList.filter(function (h) { return habitSkippedOn(h, today, habitSkipsOf(h)); }).length;
  /* 配额型打满之后也会落到这一区，但它不是"跳过"—— 说成跳过会让人以为自己点错了。
     三种原因分开说，顺序按"用户自己做的事"优先。 */
  const full = offList.filter(function (h) {
    return habitIsQuota(h) && !habitSkippedOn(h, today, habitSkipsOf(h));
  }).length;
  /* 提示要短：这行右边还有 caret，长句只会被省略号吃掉（实测「…点这里收起」被截成「看的…」） */
  const hint = skipped
    ? skipped + ' 个今天先不看'
    : (full ? full + ' 个本周已达标' : '按节奏今天不做');
  let h = '<div class="habit-off-head' + (_habitOffOpen ? ' open' : '') + '" onclick="toggleHabitOffSection()" title="展开后可查看 / 补卡 / 放回">' +
    '<span class="habit-off-chip">🌙</span>' +
    '<span class="habit-off-name">今天不用做</span>' +
    '<span class="habit-off-count">' + offList.length + '</span>' +
    '<span class="habit-off-hint">' + hint + (_habitOffOpen ? ' · 收起' : ' · 展开') + '</span>' +
    '<svg class="folder-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
    '</div>';
  if (_habitOffOpen) {
    h += '<div class="habit-off-body">' + offList.map(rowOf).join('') + '</div>';
    if (skipped) {
      h += '<div class="habit-off-actions"><button class="btn-small" onclick="restoreHabitSkips()">把今天先不看的放回来</button></div>';
    }
  }
  return h;
}
/* ★ 习惯列表的**唯一**渲染源（2026-11-04）
   习惯页和计划页「今日习惯」dock 都调这个函数 —— 不是"长得像"，是同一段 HTML。
   用户原话：「你不要重新造，你就直接复刻那个习惯页，直接搬下来就行了呀」。
   所以别在这里加任何「dock 专用」分支（行内的加号、折叠、简化版），
   一旦分叉就又变成两套，下一次改样式必然漏一处。
   opts.withArchive=false：不算归档区（dock 里没有「已归档」这件事）。 */
function habitListBodyHtml(opts) {
  const withArchive = !opts || opts.withArchive !== false;
  const today = getTodayStr();
  const all = appData.habits || [];
  /* 习惯列表必须走 sortHabits() 排序。
     只把 sortBy 拿来判断「能不能拖拽」的话，5 个排序选项出来永远是同一个顺序。
     手动 = 保持数组原序（sortHabits 内部返回 slice）。 */
  const sorter = sortHabits;
  const active = sorter(all.filter(function (h) { return !h.archived; }));
  const archived = withArchive ? sorter(all.filter(function (h) { return !!h.archived; })) : [];
  /* ★ 按日筛选：该做的一堆、今天不用做的一堆。
     「该不该做」只问 habitDueToday（规则 / 配额 / 跳过日 / 打卡历史都在里面判完了），
     这里不再自己拼条件 —— 拼一次就多一个和统计不一致的机会。
     ★ 今天已经打过卡的一律留在主列表：配额型打满之后 due 会变 false，
       若不特判，刚打完的那条会立刻被挪进「今天不用做」—— 像是被删了。 */
  const dueList = [], offList = [];
  const doneToday = function (h) { return (appData.habitLogs[h.id] || []).indexOf(today) >= 0; };
  active.forEach(function (h) {
    if (habitDueToday(h, today) || doneToday(h)) dueList.push(h);
    else offList.push(h);
  });
  const sortBy = getSortPrefs().habits.by;
  const draggable = sortBy === 'manual';
  const cats = normHabitCats(appData.habitCats);
  const rowOf = function (h) { return _habitRowHtml(h, today, draggable); };
  let html = _habitDueLineHtml(dueList, offList, today);
  if (!dueList.length) {
    /* 一条该做的都没有：不留白屏，也别让人以为习惯丢了 —— 下面是「今天不用做」区 */
    html += active.length
      ? '<div class="review-empty">今天没有要打卡的习惯，都在下面「今天不用做」里</div>'
      : '<div class="review-empty">习惯都归档了，可在归档区恢复</div>';
  } else if (!cats.length) {
    /* 没有分类时保持老样子：平铺，不硬塞一层"未分类"文件夹 */
    html += dueList.map(rowOf).join('');
  } else {
    /* 有分类才走文件夹：catId 指向已删除分类的习惯自动落回「未分类」，不会丢 */
    const open = appData.habitCatOpen || {};
    html += _habitFoldersHtml(dueList, cats, open, today, rowOf);
  }
  html += _habitOffSectionHtml(offList, today, rowOf);
  /* 归档区：不参与排序（归档本来就该「收起来」），点 › 进详情可恢复 */
  if (archived.length) {
    html += '<div class="habit-archive-h">已归档（' + archived.length + '）</div>';
    html += archived.map(function (h) { return _habitRowHtml(h, today, false); }).join('');
  }
  return html;
}
function renderHabits() {
  /* 跨天先把子计划按「第二天怎么办」处理掉，再画 —— 顺序反了会先闪一帧旧清单。
     函数自己带跨天守卫，同一天重复调用是空转。 */
  rollHabitSubs();
  const list = document.getElementById('habitList');
  if (!list) return;
  if (!(appData.habits || []).length) {
    list.innerHTML =
      '<div class="empty-state"><span class="empty-icon">🌱</span><div class="empty-title">还没有习惯</div><div class="empty-desc">点右上角 ＋，先选节奏（每天 / 每周几 / 每月几号），再开始打卡</div></div>';
    return;
  }
  list.innerHTML = habitListBodyHtml({ withArchive: true });
  /* 计划页底部的习惯 dock 与习惯页同源，一起刷新（切页/打卡后两处必须同步） */
  try {
    renderPlanHabitDock();
  } catch (e) { if (window.__silent) window.__silent(e, '01eB:renderHabits'); }
}
/* 展开/收起习惯分类文件夹（状态记在数据里，跨会话保留） */
function toggleHabitCat(catId) {
  if (!appData.habitCatOpen || typeof appData.habitCatOpen !== 'object') appData.habitCatOpen = {};
  const k = String(catId);
  appData.habitCatOpen[k] = !appData.habitCatOpen[k];
  saveData();
  renderHabits();
}
/* 新建习惯分类：重名直接复用（免得攒出一堆同名文件夹） */
function addHabitCat() {
  const _applyCat = function (raw) {
    const name = normHabitCatName(raw);
    if (!name) return;
    if (!Array.isArray(appData.habitCats)) appData.habitCats = [];
    let hit = appData.habitCats.find(function (c) { return c && c.name === name; });
    if (!hit) {
      hit = { id: 'hc' + Date.now().toString(36) + Math.floor(Math.random() * 1000), name: name };
      appData.habitCats.push(hit);
      appData.habitCatOpen[hit.id] = true;
    }
    saveData();
    renderHabits();
    try { renderHabitCatModal(); } catch (e) { if (window.__silent) window.__silent(e, '01eB:addHabitCat'); }
  };
  if (typeof window.rsPrompt === 'function') {
    window.rsPrompt('给这个分类起个名字：', { title: '新建习惯分类', placeholder: '例如：学习 / 运动 / 生活', okText: '创建' }).then(_applyCat);
  } else {
    _applyCat(prompt('新分类名：'));
  }
}
/* 删除分类 ≠ 删习惯：只把成员退回未分类（这是"文件夹"该有的语义） */
function deleteHabitCat(catId) {
  const cs = appData.habitCats || [];
  const hit = cs.find(function (c) { return c && idEq(c.id, catId); });
  if (!hit) return;
  const n = (appData.habits || []).filter(function (h) { return h && idEq(h.catId, catId); }).length;
  const msg = '删除分类「' + hit.name + '」？\n' + (n ? n + ' 个习惯会退回「未分类」，不会被删。' : '（里面没有习惯）');
  const run = function () {
    appData.habits.forEach(function (h) { if (h && idEq(h.catId, catId)) h.catId = null; });
    appData.habitCats = cs.filter(function (c) { return !(c && idEq(c.id, catId)); });
    if (appData.habitCatOpen) delete appData.habitCatOpen[String(catId)];
    saveData();
    renderHabits();
    /* 分类管理弹窗开着时一起刷新（删掉的这一行要立刻消失） */
    try { renderHabitCatModal(); } catch (e) { if (window.__silent) window.__silent(e, '01eB:deleteHabitCat'); }
  };
  if (typeof window.rsConfirm === 'function') window.rsConfirm(msg).then(function (ok) { if (ok) run(); });
  else if (window.confirm(msg)) run();
}
/* ===== 新建 / 编辑习惯弹窗（2026-10-30）=====
 * 与计划页「＋ → 弹窗」同一副形态：一个入口、一块表单、点保存才落盘。
 * 三条约束：
 *   ① 编辑只改字段，**不碰打卡历史 / growthPoints / createdAt / uid**（改规则 = 改未来口径，
 *      不改过去账；分母里的 createdAt 一改，历史达标率会被重算，那是另一件事）；
 *   ② 节奏直接复用 repeatUIHtml('habit', ...) —— 与计划页同一份控件、同一份规则运算，
 *      不另造第二套「每周几次」；
 *   ③ 选「每天（默认）」= 不写 repeat 字段：老数据的读法（没有 repeat 就是每天）与新数据一致，
 *      于是「迁移」这件事根本不存在，跑多少遍结果都一样。 */
var _habitEditId = null;
/* 分类下拉：空串 = 未分类（与 HABIT_CAT_UNGROUPED 同一个哨兵，不另造 'none'） */
function _habitCatOptionsHtml(cur) {
  const opts = ['<option value=""' + (cur === HABIT_CAT_UNGROUPED ? ' selected' : '') + '>未分类</option>'];
  (normHabitCats(appData.habitCats) || []).forEach(function (c) {
    opts.push('<option value="' + escapeHtml(String(c.id)) + '"' + (String(c.id) === cur ? ' selected' : '') + '>📁 ' + escapeHtml(c.name) + '</option>');
  });
  return opts.join('');
}
function openHabitEditModal(id) {
  const h = id === undefined || id === null ? null : appData.habits.find(x => idEq(x.id, id));
  if (id !== undefined && id !== null && !h) { showToast('这个习惯已经不在了'); return; }
  _habitEditId = h ? h.id : null;
  document.getElementById('habitEditTitle').textContent = h ? '✏️ 编辑习惯' : '🌱 新建习惯';
  document.getElementById('habitEditName').value = h ? h.name : '';
  document.getElementById('habitEditNote').value = (h && h.note) || '';
  document.getElementById('habitEditPol').value = h && h.polarity === 'bad' ? 'bad' : 'good';
  const catEl = document.getElementById('habitEditCat');
  if (catEl) catEl.innerHTML = _habitCatOptionsHtml(h ? habitCatOf(h) : HABIT_CAT_UNGROUPED);
  /* 节奏控件：每次打开按当前习惯重铺（不带 id → 改动不即时落盘，等「保存」）。
     ★ 2026-11-05：不再传 noSubs —— 习惯现在有子计划，「第二天子计划」三档要和
       计划卡（任务下的子任务）一模一样：全部重置 / 只留未完成 / 整条清空。
       只把称呼从「子任务」换成「子计划」，控件本身一个字都不另写。 */
  const box = document.getElementById('habitRepeatBox');
  if (box) box.innerHTML = repeatUIHtml('habit', h ? h.repeat : null, null, {
    noDaily: true,
    noneLabel: '每天（默认）',
    alwaysExtra: true,
    subsLabel: '第二天子计划',
    subsHint: '全部重置 = 第二天重新打勾；只留未完成 = 做过的删掉；清空 = 第二天从零列',
    subsFoot: '子计划不影响打卡：这个习惯算不算做到，只看左边那个大勾'
  });
  /* 排期（几点做）：和计划卡同一套 chip。新建时还没有 id，落不了库 —— 提示先保存。 */
  renderHabitBlockBox();
  /* 单日（某天不一样）：同一套「单日」控件，数据落 h.dayPlan */
  renderHabitDayPlanBox();
  /* 老口径提示：每周 N 次（N<7）的习惯没有 repeat，别让它在弹窗里"看起来是每天" */
  const hint = document.getElementById('habitEditLegacyHint');
  if (hint) {
    const legacy = h && !habitRepeatOf(h) && habitFreqPerWeek(h) < 7;
    hint.style.display = legacy ? '' : 'none';
    hint.textContent = legacy ? '当前是老口径「每周 ' + habitFreqPerWeek(h) + ' 次」；选一个节奏后会改成按规则算（历史打卡不动）' : '';
  }
  document.getElementById('habitEditDel').style.display = h ? '' : 'none';
  /* 子计划草稿：编辑时载入已有步骤，新建时为空；点「取消」直接丢掉草稿，
     所以改动一律先进草稿数组，保存时才落盘（和 repeat 控件同一套心智） */
  _habitDraftSubs = normHabitSubs(h ? h.subs : []).map(function (x) { return Object.assign({}, x); });
  _habitDraftSched = -1;
  renderHabitSubDraftBox();
  showModal('habitEditModal');
  setTimeout(function () {
    const n = document.getElementById('habitEditName');
    if (n) n.focus();
  }, 80);
}
/* 把界面上的规则写回习惯（只动 repeat 一个字段）：
 *   interval 的锚点：同档位保留原锚点，换档位/新建议用创建日（不是今天 ——
 *   今天锚会让"每隔 3 天"从建完那一刻才起算，和用户建习惯那天的心智对不上）。 */
function applyHabitRepeat(h, r) {
  if (!r) { h.repeat = null; return; }
  const prev = habitRepeatOf(h);
  const out = Object.assign({}, r);
  if (out.mode === 'interval') {
    const created = h && h.createdAt && isDateStrOk(h.createdAt) ? String(h.createdAt).slice(0, 10) : '';
    out.anchor = (prev && prev.mode === 'interval' && prev.anchor) ? prev.anchor : (created || getTodayStr());
  }
  const norm = normTodoRepeat(out);
  if (!norm) { h.repeat = null; return; }
  /* 计划专用的 last/next 不带进习惯：这两个字段是「下一次命中日」的缓存，
     习惯的命中判定每次现算（todoRepeatMatchesNorm），留着只会在存档里长出一堆永远不读的键。
     ★ subsMode 反过来必须留（2026-11-05）：它就是「第二天子计划」三档本身。 */
  delete norm.last;
  delete norm.next;
  h.repeat = norm;
}
/* 保存时读节奏：习惯的默认档是「每天」，readRepeatUI 在 mode=none 时会返回 null。
 * 但「每天 + 第二天子计划=清空」是一个真实配置，不能因为 mode 是默认档就把三档丢掉：
 * 只有「每天 + 全部重置 + 不设截止日」这个纯默认组合才继续不写 repeat（老口径不变）。 */
function readHabitRepeatUI() {
  const r = readRepeatUI('habit');
  if (r) return r;
  const sb = document.getElementById(repeatElId('habit', 'Subs'));
  const un = document.getElementById(repeatElId('habit', 'Until'));
  const subsMode = sb && (sb.value === 'clear' || sb.value === 'clearDone') ? sb.value : 'reset';
  const until = un && isDateStrOk(un.value) ? un.value : '';
  if (subsMode === 'reset' && !until) return null;
  return { mode: 'daily', subsMode: subsMode, until: until };
}
function saveHabitEdit() {
  const nameEl = document.getElementById('habitEditName');
  const name = (nameEl.value || '').trim();
  if (!name) {
    showToast('给习惯起个名字');
    nameEl.focus();
    return;
  }
  const note = (document.getElementById('habitEditNote').value || '').trim();
  const catEl = document.getElementById('habitEditCat');
  const polEl = document.getElementById('habitEditPol');
  const rep = readHabitRepeatUI(); /* null = 不写规则 = 每天（三档非默认时仍会写一条 daily） */
  const today = getTodayStr();
  let h = null;
  if (_habitEditId === null) {
    h = {
      id: Date.now(),
      uid: newUid('habit'),
      updatedAt: Date.now(),
      name: name,
      note: note,
      /* createdAt 是「应打卡次数」的分母下界：不加会让 30 天达标率被建习惯之前的日子拉低 */
      createdAt: today,
      freqPerWeek: HABIT_FREQ_DEFAULT,
      /* 子计划的「第二天怎么办」从建它的这天起算：没有这个戳，第一次跨天加载会
         把用户刚填好的步骤当成「上一次留下的」直接按档位处理掉。 */
      subsRolledOn: today
    };
    appData.habits.push(h);
    /* 这里**不能**把习惯名塞进 usedTags：usedTags 是计划/任务的标签库，
       两者是不同的维度 —— 混进来会让标签列表里冒出一堆习惯名（"喝水""早睡"），
       再回头污染任务的标签自动补全。 */
  } else {
    h = appData.habits.find(x => idEq(x.id, _habitEditId));
    if (!h) { closeModal('habitEditModal'); showToast('这个习惯已经不在了'); return; }
    h.name = name;
    h.note = note;
    h.updatedAt = Date.now();
  }
  h.catId = catEl && catEl.value ? catEl.value : null;
  h.polarity = polEl && polEl.value === 'bad' ? 'bad' : 'good';
  applyHabitRepeat(h, rep);
  /* 子计划：草稿里空名字的行直接丢掉（用户点了＋又没填），别存进存档 */
  const _subs = normHabitSubs(_habitDraftSubs);
  if (_subs.length) h.subs = _subs; else delete h.subs;
  /* 改了节奏 = 该做的日子变了，成长点按新节奏重算（老口径下这一步会被漏掉，
     表现为「改成每周三次之后点数还是按每天扣」） */
  syncHabitGrowth(h);
  saveData();
  renderHabits();
  closeModal('habitEditModal');
  showToast((_habitEditId === null ? '已创建：' : '已保存：') + name + '（' + habitRepeatLabel(h) + '）');
  _habitEditId = null;
}
/* 从弹窗里删除（复用详情页的确认流程，别写第二套删除） */
function deleteHabitFromEdit() {
  const id = _habitEditId;
  if (id === null) return;
  closeModal('habitEditModal');
  _habitEditId = null;
  deleteHabit(id);
}
/* 节奏的只读可视化（改节奏只有「编辑」一条路，这里不带任何控件）：
 *   按周几的规则 → 七格「一 … 日」，命中哪几天点亮哪几格；
 *   每月几号 / 每隔 N 天 / 配额型 → 不画格子，直接一句人话（它们跟星期几无关，
 *   画一排全灭的格子会让人以为节奏没设上）。
 * 只读，没有 onclick：改节奏只有第一行那个「编辑」。 */
function habitRepChipsHtml(h) {
  const rr = habitRepeatOf(h);
  const quota = !rr && habitIsQuota(h);
  const WD = (typeof REPEAT_WEEK_CN !== 'undefined') ? REPEAT_WEEK_CN : ['一', '二', '三', '四', '五', '六', '日'];
  let on = [];
  /* 没有 repeat 字段 = 每天（与老数据读法一致）；配额型（freqPerWeek<7）不占格子 */
  if (!rr && !quota) on = [1, 2, 3, 4, 5, 6, 7];
  else if (rr && rr.mode === 'daily') on = [1, 2, 3, 4, 5, 6, 7];
  else if (rr && rr.mode === 'weekdays') on = [1, 2, 3, 4, 5];
  else if (rr && rr.mode === 'weekly') on = (rr.weekdays || []).slice();
  /* 只有「按周几」的规则才画七格；每月几号 / 每隔 N 天 / 配额型本来就跟"星期几"无关，
     画一排全灭的格子等于让他以为节奏没设上（实测：全灰七格 + 一行说明，先看到的是灰）。
     这三类改成一句人话，不带格子。 */
  const dayOfWeek = rr ? (rr.mode !== 'monthly' && rr.mode !== 'interval') : !quota;
  let chips = '';
  if (dayOfWeek) {
    chips = '<div class="habit-rep-wds">';
    for (let i = 0; i < 7; i++) {
      const w = i + 1;
      chips += '<span class="repeat-wd' + (on.indexOf(w) >= 0 ? ' on' : '') + '">' + WD[i] + '</span>';
    }
    chips += '</div>';
  }
  let note = '';
  if (quota) {
    note = '每周 ' + habitFreqPerWeek(h) + ' 次 · 不限哪天';
  } else if (!dayOfWeek) {
    /* 每月几号 / 每隔 N 天：直接说规则本身（没有格子可看） */
    note = rr ? habitRepeatLabel(h) : '还没设节奏';
  } else if (on.length === 7) {
    note = '每天';
  } else if (on.length === 0) {
    note = '还没设节奏';
  }
  /* until 只是"重复到哪天为止"，附在最后当灰字 */
  const untilTxt = (rr && rr.until) ? ' · 至 ' + rr.until : '';
  /* 两行：七格撑满一行，人话说明另起一行（灰字，右对齐）。
     挤一行时「每月 28 号 · 至 2026-12-31」这种长句子会把芯片压扁。 */
  return chips
    + (note ? '<div class="habit-rep-line">' + escapeHtml(note + untilTxt) + '</div>' : '');
}
/* ---------- 打卡月历（详情页，2026-11-08）----------
 * 起因（用户原话）：「它只显示这格子，格子过完了就显示新的格子，之前的打卡记录也不能很好的展示」。
 * 列表上那条热力条是「最近 30 天」的滑动窗口，第 31 天就滑出去，回看不到更早的记录。
 * 月历按月整屏铺开：一格一天，能翻月份，往回翻到习惯建立的那个月为止。
 * 状态是模块级的：_habitCalId = 当前详情是谁，_habitCalYm = 正在看哪个月（'YYYY-MM'）。 */
var _habitCalId = null;
var _habitCalYm = '';
function habitCalYmOf(ds) { return String(ds == null ? '' : ds).slice(0, 7); }
/* 月份加减：不要用 Date(m+1) 绕，-1 个月在 3/31 会窜到 3/3（月份越界自动进位那套坑） */
function habitCalShiftYm(ym, d) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return ym;
  let y = parseInt(m[1], 10);
  let mo = parseInt(m[2], 10) + (parseInt(d, 10) || 0);
  while (mo < 1) { mo += 12; y--; }
  while (mo > 12) { mo -= 12; y++; }
  return y + '-' + (mo < 10 ? '0' + mo : String(mo));
}
/* 统计四格 + 热力条：详情页刷新时整块重画（打卡 / 翻月都要一起变），
   所以从 openHabitDetail 里抽出来，别在刷新路径上复制一份。 */
function habitStatBlockHtml(h) {
  const id = h.id;
  const today = getTodayStr();
  const hs = habitStats(h, appData.habitLogs[id] || [], today, HABIT_WINDOW_DAYS, habitSkipsOf(h));
  const _stage = getHabitStage(h.growthPoints || 0);
  return `<div class="habit-stat-grid">`
    /* 单位跟数字走、不跟标签走：标签是 13px 的四等分列（每列约 75px），
       「当前连续（次）」七个字必然折成两行（实测），而「2 次」一眼就懂。
       配额型没有"连续天数"：第一格换成本周进度（用户真正在追的数），
       第二格换成最长连周 —— 硬套"连续 0 天"只会让人以为这套坏了。 */
    + (hs.quota
      ? `<div><b>${hs.weekDone}<i class="habit-unit">/${hs.weekTarget}</i></b><span>本周进度</span></div>`
      + `<div><b>${hs.best}<i class="habit-unit">周</i></b><span>最长连周</span></div>`
      : `<div><b>${hs.cur}<i class="habit-unit">${habitStreakUnit(h)}</i></b><span>当前连续</span></div>`
      + `<div><b>${hs.best}<i class="habit-unit">${habitStreakUnit(h)}</i></b><span>历史最长</span></div>`)
    + `<div><b>${hs.expected > 0 ? Math.round(hs.rate * 100) + '%' : '—'}</b><span>${HABIT_WINDOW_DAYS}天达标</span></div>`
    + `<div><b>${_stage.emoji}${h.growthPoints || 0}</b><span>成长点</span></div>`
    + `</div>`
    /* 口径说明：用户嫌这块文字太臃肿，一行讲完，细则留在代码注释里。 */
    + `<div class="habit-gp-hint">做到 +1，连着做到再 +1；该做没做 −1，连漏 3 次重新计分。</div>`;
    /* 详情页不再放 30 天热力条：它和下面的月历是同一批数据的两个切片，
       而且热力条滑出 30 天就没了 —— 回看历史正是本次要解决的问题。
       （列表行上的那条保留，扫一眼就够） */
}
function habitCalHtml(h) {
  const today = getTodayStr();
  const thisYm = habitCalYmOf(today);
  const ym = _habitCalYm || thisYm;
  const pm = /^(\d{4})-(\d{2})$/.exec(ym);
  const y = pm ? parseInt(pm[1], 10) : parseInt(today.slice(0, 4), 10);
  const mo = pm ? parseInt(pm[2], 10) : parseInt(today.slice(5, 7), 10);
  const logs = appData.habitLogs[h.id] || [];
  const set = {};
  logs.forEach(function (d) { set[String(d == null ? '' : d).slice(0, 10)] = true; });
  const skipsArr = habitSkipsOf(h);
  const skips = habitSkipSet(h, skipsArr);
  const created = String(h.createdAt || '').slice(0, 10);
  const offset = (new Date(y, mo - 1, 1).getDay() + 6) % 7;  /* 周一为一周之始 */
  const dayCount = new Date(y, mo, 0).getDate();
  const pad = function (n) { return n < 10 ? '0' + n : String(n); };
  let cells = '';
  let doneN = 0, dueN = 0, bestRun = 0, run = 0;
  for (let i = 0; i < offset; i++) cells += '<span class="habit-cal-cell blank"></span>';
  for (let d = 1; d <= dayCount; d++) {
    const ds = y + '-' + pad(mo) + '-' + pad(d);
    const future = ds > today;
    const done = !!set[ds];
    const skipped = !!skips[ds];
    const due = !future && habitDueOn(h, ds, skips, logs);
    let cls = 'habit-cal-cell';
    if (future) cls += ' future';
    else if (done) cls += ' on';
    else if (skipped) cls += ' skip';
    else if (due) cls += (ds === today ? ' today' : ' miss');
    else cls += ' off';
    if (!future && done) doneN++;
    if (due) { dueN++; if (done) { run++; if (run > bestRun) bestRun = run; } else run = 0; }
    const tip = ds + (done ? ' 已打卡' : (future ? ' 还没到' : (skipped ? ' 跳过（不欠账）' : (due ? ' 该做但没做' : ' 今天不用做'))));
    /* data-args 必须是合法 JSON（外边单引号、里面双引号）：写成 ['2026-11-08'] 会让 JSON.parse 直接抛错，
       点了没反应还不报错 —— 这是本项目踩过的坑（见 tools/check_act_targets.py 的说明） */
    cells += '<span class="' + cls + '"' + (future ? '' : " data-act=\"habitCalToggle\" data-args='[\"" + ds + "\"]'") + ' title="' + tip + '">' + d + '</span>';
  }
  const tail = (7 - ((offset + dayCount) % 7)) % 7;
  for (let i = 0; i < tail; i++) cells += '<span class="habit-cal-cell blank"></span>';
  /* 翻页边界：不早于习惯建立的那个月，不越过本月（未来还没发生） */
  const minYm = created ? habitCalYmOf(created) : '';
  const prevDis = !!(minYm && ym <= minYm);
  const nextDis = ym >= thisYm;
  const rate = dueN > 0 ? Math.min(100, Math.round(doneN / dueN * 100)) : 0;
  const sum = dueN > 0
    ? '本月打卡 <b>' + doneN + '</b> 天 · 应做 <b>' + dueN + '</b> 天 · 达标 <b>' + rate + '%</b>'
      + (bestRun > 1 ? ' · 最长连续 <b>' + bestRun + '</b>' + habitStreakUnit(h) : '')
    : (ym === thisYm ? '这个月还没有该做的日子' : '这个月没有该做的日子');
  return '<div class="habit-cal-head">'
    + '<button class="habit-cal-nav"' + (prevDis ? ' disabled' : '') + ' data-act="habitCalShift" data-args="[-1]">‹</button>'
    + '<b>' + y + ' 年 ' + mo + ' 月</b>'
    + '<button class="habit-cal-nav"' + (nextDis ? ' disabled' : '') + ' data-act="habitCalShift" data-args="[1]">›</button>'
    + '</div>'
    + '<div class="habit-cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>'
    + '<div class="habit-cal-grid">' + cells + '</div>'
    + '<div class="habit-cal-sum">' + sum + '</div>';
}
function habitCalShift(d) {
  const h = appData.habits.find(function (x) { return idEq(x.id, _habitCalId); });
  if (!h) return;
  const today = getTodayStr();
  const thisYm = habitCalYmOf(today);
  const created = String(h.createdAt || '').slice(0, 10);
  const minYm = created ? habitCalYmOf(created) : '';
  let ym = habitCalShiftYm(_habitCalYm || thisYm, parseInt(d, 10) || 0);
  if (ym > thisYm) ym = thisYm;
  if (minYm && ym < minYm) ym = minYm;
  if (ym === _habitCalYm) return;
  _habitCalYm = ym;
  habitCalRefresh();
}
/* 点格 = 打卡 / 取消打卡（和下面那串日期列表同一个动作，只是换了个地方点） */
function habitCalToggle(ds) {
  if (_habitCalId === null) return;
  const today = getTodayStr();
  if (ds > today) return;
  toggleHabit(_habitCalId, ds === today ? undefined : ds);
  habitCalRefresh();
}
/* 只重画「统计 + 热力条 + 月历」这一块：整窗重建会把弹窗滚回顶部，
   而这个弹窗比一屏长，用户点的往往在中间 */
function habitCalRefresh() {
  const h = appData.habits.find(function (x) { return idEq(x.id, _habitCalId); });
  const wrap = document.getElementById('habitCalWrap');
  if (!h || !wrap) return;
  wrap.innerHTML = habitStatBlockHtml(h) + habitCalHtml(h);
}
function openHabitDetail(id) {
  const h = appData.habits.find(x => idEq(x.id, id));
  if (!h) return;
  /* ★ 必须 copy 再排：原地 sort/reverse 会把存档里的打卡顺序永久打乱
     （老代码就这么写的，现在顺带修掉 —— 目前没有别处依赖顺序，
      但"读一遍就改数据"是迟早出事的那种写法） */
  const logs = (appData.habitLogs[id] || []).slice().sort().reverse();
  const today = getTodayStr();
  /* 换了一个习惯才把月历拨回本月；同一条习惯重开（点了某个日期）保留正在看的月份 */
  if (!idEq(_habitCalId, h.id)) _habitCalYm = habitCalYmOf(today);
  _habitCalId = h.id;
  document.getElementById('habitDetailTitle').textContent = '🌱 ' + h.name;
  document.getElementById('habitDetailBody').innerHTML =
    `<div class="settings-group" style="margin-bottom:var(--sp-12);"><h3>习惯信息</h3>`
    + `<div id="habitCalWrap">` + habitStatBlockHtml(h) + habitCalHtml(h) + `</div>`
    /* 节奏：规则型只说一句人话 + 一个「改节奏」入口（细节在编辑弹窗里改，
       两个地方都能改同一件事才会出现"改了这边没生效"） */
    /* 节奏：两行 —— 第一行「节奏 ......... 编辑」，第二行七格周芯片占满宽度。
       不能挤一行：弹窗内容宽只有 253px，七格芯片 234px 加上标签和按钮必然溢出，
       「编辑」会被顶到弹窗外面（实测 right 406 > 390）。 */
    + `<div class="setting-row habit-rep-stack">`
    + `<div class="habit-rep-head"><div class="setting-label" style="flex:0 0 auto">节奏</div>`
    + `<button class="btn-small" onclick="closeModal('habitDetailModal');openHabitEditModal(${idArg(h.id)})">编辑</button></div>`
    /* 七格周芯片 —— 一眼看出「一三五」还是「每天」，不用把「每周 3 次」在脑子里换算。
       芯片只读（没有 onclick），改节奏的唯一入口是第一行那个「编辑」，
       那里就是计划页同一套勾选（可多选周几 / 每月几号 / 每隔 N 天）。 */
    + habitRepChipsHtml(h)
    + `</div>`
    /* 排期：习惯自己的时段（不是子计划的）。和计划卡上「排期」那一组同款 ——
       卡上写「开始 → 结束」，日程表不放习惯（用户 2026-11-04 两天连着说过两遍）。 */
    + `<div class="setting-row habit-block-stack"><div class="habit-rep-head"><div class="setting-label" style="flex:0 0 auto">排期</div>`
    + `<span class="tf-hint">每天做这几段</span></div>`
    + habitBlocksRowHtml(h)
    + `</div>`
    + habitSubDetailHtml(h, today)
    /* 配额型（老口径 freqPerWeek）没有具体哪天，芯片全空，补一句话说明它怎么算 */
    + (habitIsQuota(h) ? `<div class="habit-quota-hint">一周内做满 ${habitFreqPerWeek(h)} 次就达标；做满之后今天不再出现，也可以从「今天不用做」里补打</div>` : '')
    + `<div class="setting-row setting-row--goal"><div class="setting-label">用于目标</div><div class="tf-chips" id="habitDetailGoals">${habitGoalChipsHtml(h)}</div></div>`
    /* 备注只读展示：详情页不再是第二个编辑界面（那两套表单会各自改一半字段） */
    + (h.note ? `<div class="habit-detail-note">${escapeHtml(h.note)}</div>` : '')
    + `<div class="modal-buttons" style="margin-top:var(--sp-10)"><button class="modal-btn secondary" onclick="toggleHabitArchive(${idArg(id)})">${h.archived ? '♻️ 恢复习惯' : '📦 归档习惯'}</button><button class="modal-btn danger" onclick="deleteHabit(${idArg(id)})">删除习惯</button></div><div class="settings-group"><h3>补打卡</h3><div style="display:flex;gap:var(--sp-8);align-items:center;margin-bottom:var(--sp-10);"><input type="date" id="habitBackfillDate" value="${getTodayStr()}" max="${getTodayStr()}" style="flex:1;padding:var(--sp-8);border:1px solid var(--border-strong);border-radius:var(--radius-sm);font-size:var(--fs-title);"><button class="modal-btn green" style="flex:0 0 auto" onclick="backfillHabit(${idArg(id)})">补打卡</button></div><div style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-8);">选择日期后点击补打卡，可补打历史日期；不能打卡未来日期</div><h3 style="margin-top:var(--sp-12);">历史打卡（${logs.length}天，点击可取消）</h3>${logs.length ? logs.map(d => `<div class="harvest-item" style="cursor:pointer;" onclick="toggleHabit(${idArg(id)},'${d}');openHabitDetail(${idArg(id)})">${d} ✓</div>`).join('') : '<div style="text-align:center;color:var(--text-light);padding:var(--sp-16);">暂无记录</div>'}</div>`;
  showModal('habitDetailModal');
}
/* ---------- 习惯 ↔ 目标（2026-10-30 修）----------
 * 之前的写法只在习惯侧写 h.lifeGoalId，而目标页写的是 g.habitId ——
 * 两个字段互不相干，于是「目标里选好了习惯，习惯详情却显示未关联」。
 * 现在：goal.habitId 是唯一真源（00b 的进度计算只认它），
 *       habit.lifeGoalId 由它推导/镜像；习惯侧只做「勾选哪些目标在用我」。
 * 用 chips 而不是下拉，是因为一个习惯可以被多个目标同时计量，
 * 下拉的"单选"语义会让人以为只能挂一个，改一次就悄悄断掉另一个。 */
function habitGoalChipsHtml(h) {
  const all = (typeof lifeGoalsOf === 'function' ? lifeGoalsOf() : (appData.lifeGoals || []));
  const goals = all.filter(function (g) {
    return g && (g.status || 'active') === 'active' && (g.horizon || 'year') !== 'someday';
  });
  if (!goals.length) {
    return '<span class="tf-hint" style="color:var(--text-light);font-size:var(--fs-caption)">还没有目标 · 去「目标」页建一个</span>';
  }
  return goals.map(function (g) {
    const on = idEq(g.habitId, h.id);
    const t = String(g.title || '（未命名）');
    return '<span class="tf-chip' + (on ? ' on' : '') + '" data-stop="1" data-act="toggleHabitGoal"'
      + ' data-args=\'' + JSON.stringify([h.id, g.id]) + '\' title="' + escapeHtml(t) + '">'
      + escapeHtml(t.length > 14 ? t.slice(0, 14) + '…' : t)
      + (on ? '<span class="tf-chip-x">×</span>' : '') + '</span>';
  }).join('');
}
/* 勾 / 取消。只改 goal.habitId（真源），镜像交给 syncHabitLink，
   不碰打卡历史、成长点、目标区间 —— 换计量方式不等于重算过去。 */
function toggleHabitGoal(habitId, goalId) {
  const h = (appData.habits || []).filter(function (x) { return x && idEq(x.id, habitId); })[0];
  const g = (appData.lifeGoals || []).filter(function (x) { return x && idEq(x.id, goalId); })[0];
  if (!h || !g) return;
  const wasOn = idEq(g.habitId, h.id);
  const prev = g.habitId || null;
  g.habitId = wasOn ? null : h.id;
  g.updatedAt = Date.now();
  if (typeof syncHabitLink === 'function') syncHabitLink(g, prev);
  saveData();
  renderHabits();
  if (typeof renderLifeGoals === 'function') renderLifeGoals();
  /* 只重画这一块，不整窗重建：重建会把弹窗滚回顶部，
     而这个弹窗比一屏长，用户点的是中间那一条 */
  const box = document.getElementById('habitDetailGoals');
  if (box) box.innerHTML = habitGoalChipsHtml(h);
  showToast(wasOn ? '已解绑 · 这个目标不再用它计量' : '已挂到「' + String(g.title || '目标') + '」');
}
function backfillHabit(id) {
  const dateStr = document.getElementById('habitBackfillDate').value;
  if (!dateStr) {
    showToast('请选择日期');
    return;
  }
  toggleHabit(id, dateStr);
  openHabitDetail(id);
}
/* 归档 = 藏起来，不删数据；打卡历史、成长点、段位都不受影响 */
function toggleHabitArchive(id) {
  const h = appData.habits.find(x => idEq(x.id, id));
  if (!h) return;
  h.archived = !h.archived;
  saveData();
  renderHabits();
  closeModal('habitDetailModal');
  showToast(h.archived ? '已归档：' + h.name : '已恢复：' + h.name);
}
function deleteHabit(id) {
  /* 同 deleteRecord：避开原生 confirm 在 WebView 里静默返回 false 的坑 */
  var doDel = function () {
    var _goneHabit = appData.habits.filter(x => idEq(x.id, id));
    appData.habits = appData.habits.filter(x => !idEq(x.id, id));
    _goneHabit.forEach(function (x) { tombstone(x.uid, 'habit'); });
    delete appData.habitLogs[id];
    /* ★ 2026-10-30 审查修复（M3）：跳过日和打卡记录同属"这个习惯的账"，
       删习惯时一起清。不清的话存档会长期挂着孤儿 key（id 用 Date.now()，
       同一毫秒重建理论上还会串账）。 */
    if (appData.habitSkips) delete appData.habitSkips[id];
    /* 把它当计量来源的目标要一起摘掉，否则目标进度会指向一个不存在的习惯：
       00b 里「习惯被删了，不算 0」会显示「未测量」，但表单里仍选中着它，
       用户下次打开会以为关联还在。 */
    (appData.lifeGoals || []).forEach(function (g) {
      if (g && idEq(g.habitId, id)) { g.habitId = null; g.updatedAt = Date.now(); }
    });
    saveData();
    renderHabits();
    closeModal('habitDetailModal');
    showToast('已删除');
  };
  var msg = '确定删除这个习惯吗？打卡记录也会删除。';
  /* 同 deleteRecord：确认框弹出前先收起详情弹窗，避免两窗叠加；取消则放回。 */
  closeModal('habitDetailModal');
  if (typeof window.rsConfirm === 'function') {
    window.rsConfirm(msg, { title: '删除习惯', okText: '删除', danger: true }).then(function (ok) {
      if (ok) { doDel(); } else { showModal('habitDetailModal'); }
    });
  } else if (confirm(msg)) {
    doDel();
  } else {
    showModal('habitDetailModal');
  }
}

/* ==================== 计划页「今日习惯」dock（2026-11-04）====================
 * 用户原话：「我希望我可以一页就看到今天排的计划和习惯，在底部展示，默认折叠」。
 * 于是计划页（#planTodoView）列表底部挂一条 dock：
 *   折叠 = 一行：🌱 今日习惯 3/8 · 🧩 1/3 [›]
 *   展开 = 今天该做的习惯逐条（可勾）+ 每条的今日子计划 + 「＋ 新建习惯」
 * 折叠状态存 settings.planHabitDockOpen，缺省 false（用户明确要「默认折叠」）。
 * ★ 只读不写口径：勾选复用同一个 toggleHabit / toggleHabitSub，
 *   不另造一套「计划页版打卡」—— 两套判定迟早对不上。
 * ★ 这里同样要过 habitDueToday：今天不用做的习惯不进 dock，
 *   否则 dock 会变成「把 20 个习惯全摊在计划页上」，比没有更吵。 */
var _HABIT_CB_SVG = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect class="cb-shape" x="2.5" y="2.5" width="19" height="19" rx="6"/><polyline class="cb-check" points="6,12 10.5,16.5 18,8"/></svg>';
var _HABIT_ARROW_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
function planHabitDockOpen() {
  return !!(appData.settings && appData.settings.planHabitDockOpen);
}
function togglePlanHabitDock() {
  if (!appData.settings) appData.settings = {};
  appData.settings.planHabitDockOpen = !planHabitDockOpen();
  saveData();
  renderPlanHabitDock();
  if (typeof playSound === 'function') playSound('tap');
}
/* 今天该做 / 今天不用做 —— 判定口径与 renderHabits 同一套（含「今天已打卡的一律留在主列表」） */
function _dockSplitToday() {
  const today = getTodayStr();
  const active = sortHabits((appData.habits || []).filter(function (h) { return h && !h.archived; }));
  const doneOf = function (h) { return (appData.habitLogs[h.id] || []).indexOf(today) >= 0; };
  const due = [], off = [];
  active.forEach(function (h) {
    if (habitDueToday(h, today) || doneOf(h)) due.push(h); else off.push(h);
  });
  return { today: today, active: active, due: due, off: off, doneOf: doneOf };
}
function renderPlanHabitDock() {
  const host = document.getElementById('planHabitDock');
  if (!host) return;
  const st = _dockSplitToday();
  if (!st.active.length) { host.innerHTML = ''; return; }  /* 一个习惯都没有：dock 不占位置 */
  /* 用户原话：「你不要重新造，你就直接复刻那个习惯页，直接搬下来」。
     所以这里**不再自己拼行**，直接调习惯页那一个 habitListBodyHtml：
     同样的分类文件夹、「今天该做」统计行、「今天不用做」折叠区、同一个 _habitRowHtml。
     dock 只负责外面的折叠头（🌱 今日习惯 0/2）和底部「＋ 新建习惯」。
     ★ 不要再往行里塞 dock 专属按钮（＋ 加一步、简化统计）：多一颗就窄 30px，
       信息列一挤，热力图换行，那就又不是「复刻」了。加一步走 › 进详情。 */
  const body = habitListBodyHtml({ withArchive: false });
  const doneN = st.due.filter(function (h) { return st.doneOf(h); }).length;
  let subN = 0, subDone = 0;
  st.due.forEach(function (h) {
    const list = habitSubsOn(h, st.today);
    subN += list.length;
    subDone += habitSubsDoneOn(h, st.today, list);
  });
  const open = planHabitDockOpen();
  let html = '<div class="phd' + (open ? ' open' : '') + '">' +
    '<div class="phd-head" onclick="togglePlanHabitDock()" role="button" aria-expanded="' + (open ? 'true' : 'false') + '">' +
    '<span class="phd-icon">🌱</span>' +
    '<span class="phd-title">今日习惯</span>' +
    '<span class="phd-chip' + (st.due.length && doneN >= st.due.length ? ' all' : '') + '">' + doneN + '/' + st.due.length + '</span>' +
    (subN ? '<span class="phd-chip sub">🧩 ' + subDone + '/' + subN + '</span>' : '') +
    '<svg class="folder-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>' +
    '</div>';
  if (open) {
    html += '<div class="phd-body">' + body +
      '<button class="phd-add" onclick="openHabitEditModal()">＋ 新建习惯</button></div>';
  }
  html += '</div>';
  host.innerHTML = html;
}

/* ==================== 习惯的子计划（2026-11-04）====================
 * 一个习惯拆几步，每步可排期：
 *   date 空   → 跟着习惯走，习惯哪天该做，这天就有它
 *   date 有值 → 只在那个日期出现
 * ★ 勾掉记 doneOn 日期而不是 bool：未排期的步骤跨天自动回未完成，
 *   排期过的保留它那天的完成状态（那是那一天的账）。
 * ★ 子计划**不改打卡口径**：习惯算不算完成仍只看 habitLogs。
 *   否则「3 步勾了 2 步」会让连续天数开始抖，用户读不懂。 */
function _habitSubById(h, subId) {
  const list = (h && Array.isArray(h.subs)) ? h.subs : [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s && (String(s.id) === String(subId) || idEq(s.id, subId))) return s;
  }
  return null;
}
function toggleHabitSub(habitId, subId) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) { showToast('这个习惯已经不在了'); return; }
  const sub = _habitSubById(h, subId);
  if (!sub) return;
  const today = getTodayStr();
  const wasOn = normHabitSubDate(sub.doneOn) === today;
  sub.doneOn = wasOn ? '' : today;
  h.updatedAt = Date.now();
  saveData();
  renderHabits();
  /* 详情弹窗开着就一起刷新（同一份数据，两处显示不能对不上） */
  const det = document.getElementById('habitDetailModal');
  if (det && det.classList.contains('show')) openHabitDetail(h.id);
  if (!wasOn) {
    if (typeof playSound === 'function') playSound('tap');
    showToast('✓ ' + sub.text);
  }
}
/* 子计划的「第二天怎么办」：和计划卡 subsMode 是同一套三档（2026-11-05）
 *   reset     全部回到未完成 —— 什么都不用做：doneOn 记的是日期，跨天自然不算今天
 *   clearDone 只留未完成 —— 把上一次做完的步骤删掉
 *   clear     整条清空 —— 步骤全删，第二天从空清单重新列
 * 边界：
 *   ① 只在**跨天**时执行一次，用 h.subsRolledOn 记住上次处理到哪天。
 *      老数据没这个戳 → 只补戳、不处理，免得一升级就把人家攒的步骤按档位清掉。
 *   ② 不动打卡口径：习惯算不算做到仍然只看 habitLogs，子计划只是清单。
 *   ③ 不认 s.date（2026-11-06 起）：子计划没有到期日，未完成的第二天继续留着。
 */
function rollHabitSubs(today) {
  const ds = normHabitSubDate(today) || getTodayStr();
  let dirty = false;
  (appData.habits || []).forEach(function (h) {
    if (!h || h.archived) return;
    const subs = habitSubsOf(h);
    if (!subs.length) return;
    const last = normHabitSubDate(h.subsRolledOn);
    if (!last) { h.subsRolledOn = ds; dirty = true; return; } /* 老数据：首见只补戳 */
    if (last >= ds) return; /* 同一天（或时钟回拨）：不重复处理 */
    const rr = habitRepeatOf(h) || {};
    const mode = (rr.subsMode === 'clear' || rr.subsMode === 'clearDone') ? rr.subsMode : 'reset';
    if (mode !== 'reset') {
      const keep = subs.filter(function (s) {
        if (mode === 'clear') return false;
        const doneOn = normHabitSubDate(s.doneOn);
        return !(doneOn && doneOn < ds); /* clearDone：昨天及以前做完的删掉 */
      });
      if (keep.length !== subs.length) {
        if (keep.length) h.subs = keep; else delete h.subs;
        h.updatedAt = Date.now();
      }
    }
    h.subsRolledOn = ds;
    dirty = true;
  });
  if (dirty) saveData();
}
/* 全部勾选 / 全部取消（2026-11-05）：照任务卡的 toggleAllTodoSubs 抄 ——
   只动**今天该做的那几步**（habitSubsOn），排到别的日子的不碰：
   那是那一天的账，今天替它打勾等于篡改历史。
   一次 saveData + 一次 renderHabits，不循环调 toggleHabitSub（那会重渲染 N 遍）。 */
function toggleAllHabitSubs(habitId, on) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) { showToast('这个习惯已经不在了'); return; }
  const today = getTodayStr();
  const list = habitSubsOn(h, today);
  if (!list.length) { showToast('今天没有要做的子计划'); return; }
  list.forEach(function (s) { s.doneOn = on ? today : ''; });
  h.updatedAt = Date.now();
  saveData();
  renderHabits();
  const det = document.getElementById('habitDetailModal');
  if (det && det.classList.contains('show')) openHabitDetail(h.id);
  showToast(on ? '✓ ' + list.length + ' 步全部勾上' : '已全部取消');
}
/* 就地加一步（计划页 dock / 习惯详情共用一条落库路径，2026-11-04）
 * 和编辑弹窗保存出来的字段完全一致：text / date / time / doneOn。
 * 不填日期 = 跟着习惯的节奏出现（习惯哪天做，这一步就哪天出现）；
 * 填了 = 只在那个日期出现（一次性排期，这就是「排期」）。 */
function addHabitSubQuick(habitId, text, date, time) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) { showToast('这个习惯已经不在了'); return false; }
  const t = normHabitSubText(text);
  if (!t) { showToast('先写这一步要做什么'); return false; }
  if (!Array.isArray(h.subs)) h.subs = [];
  h.subs.push({
    id: 'hs' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
    text: t,
    date: normHabitSubDate(date),
    time: normHabitSubTime(time),
    doneOn: ''
  });
  h.updatedAt = Date.now();
  saveData();
  renderHabits();   /* 习惯页 + 计划页 dock 一起刷新 */
  showToast('✓ 加了一步：' + t);
  return true;
}
/* 清空某一步的旧到期日（2026-11-06：日期字段已废弃，只保留这个函数做老数据迁移）。
   子计划不再有「哪天做」的概念 —— 没勾就一直留在清单上。 */
function setHabitSubDate(habitId, subId, val) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) return;
  const sub = _habitSubById(h, subId);
  if (!sub) return;
  sub.date = normHabitSubDate(val);
  h.updatedAt = Date.now();
  saveData();
  renderHabits();
  openHabitDetail(h.id);
}
/* 详情里改某一步的「几点」（可留空 = 不限时间） */
function setHabitSubTime(habitId, subId, val) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) return;
  const sub = _habitSubById(h, subId);
  if (!sub) return;
  sub.time = normHabitSubTime(val);
  h.updatedAt = Date.now();
  saveData();
  renderHabits();
  openHabitDetail(h.id);
}
/* ---------- 习惯自己的排期（几点做）：长在习惯卡上，和计划卡同一行控件 ----------
 * 用户原话两轮，方向只有一个：
 *   「我原先怎么给每个计划排日期你不知道吗？」→ 计划卡上是「开始 → 结束」两个框；
 *   「为什么在日程表上放一堆习惯？」          → 习惯别往日程表上摆。
 * 所以这里就是计划卡「排期」那一组的同款：.tf-chips 列已排的段 + .add-block-row
 * 两个时间框 + 「＋ 加这一段」。不去网格点格子，日程表上也没有任何习惯的痕迹。
 * 时段是即时生效的（计划卡改了也是立刻算），所以这里不存草稿，改完直接落库。 */
function habitSetBlocks(habitId, list) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) return null;
  const next = normHabitBlocks(list);
  if (next.length) h.timeBlocks = next;
  else delete h.timeBlocks;
  h.updatedAt = Date.now();
  saveData();
  renderHabits();
  renderHabitBlockBox();
  return next;
}
/* 「在日程表选」：关弹窗、切到计划 tab、展开网格、进选段模式 —— 人眼要看见格子才点得准。
   ★ 日程表上不常驻画习惯（用户否决过），只有进选段模式时那一个习惯的已排段会淡画出来当参照。 */
function habitArmOnGrid(habitId) {
  closeModal('habitDetailModal');
  closeModal('habitEditModal');
  if (typeof switchView === 'function') switchView('plan');
  if (typeof switchPlanTab === 'function') switchPlanTab('plan');
  if (typeof window.tbHabitArm === 'function') window.tbHabitArm(habitId);
  const host = document.getElementById('tbShell');
  if (host && host.scrollIntoView) host.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
/* 习惯卡上的「排期（几点做）」：已排的段 + 「开始 → 结束」两个时间框。
   默认值取最后一段的结束时刻、留半小时，省得每次都从 07:00 填起。 */
function renderHabitBlockBox() {
  const box = document.getElementById('habitBlockBox');
  if (!box) return;
  const h = _habitEditId === null || _habitEditId === undefined ? null
    : appData.habits.find(function (x) { return idEq(x.id, _habitEditId); });
  if (!h) {
    box.innerHTML = '<div class="tf-hint">先保存这个习惯，再回来排时段</div>';
    return;
  }
  const bs = habitBlocksOf(h);
  const chips = bs.map(function (b) {
    return `<span class="tf-chip tf-chip--dayplan">${b.start}–${b.end}<i class="tf-chip-x" onclick="event.stopPropagation();habitDelBlock(${idArg(h.id)}, '${b.start}')" title="删掉这一段">✕</i></span>`;
  }).join('');
  /* ★ 一行 chip，加号跟它们并排（和计划卡「时段」那一排同一个形态）。
     之前加号单独一个 .tf-chips 而且文字写到「（到日程表点两格）」，一行放不下就折行，
     再被下面 5 行说明一撑，整个弹窗又高又散 —— 用户原话「UI怎么那么丑」。 */
  box.innerHTML =
    '<div class="tf-chips">' +
      (chips || '<span class="tf-chip tf-chip--muted">还没排时段</span>') +
      (bs.length >= HABIT_BLOCK_MAX ? '' :
        '<span class="tf-chip tf-chip--action" title="到日程表上点两格（起点 → 终点）选一段" onclick="habitArmOnGrid(' + idArg(h.id) + ')">＋ 加一段排期</span>') +
    '</div>' +
    '<div class="tf-hint">点它 → 日程表先点起始格、再点结束格。</div>';
}
/* 加一段时段（卡上「＋ 加这一段」调进来）：同一开始时间视为改时间，满 4 段就不再加 */
function habitAddBlockMinutes(habitId, aMin, bMin) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) return { ok: false, reason: 'notFound' };
  const b = normHabitBlock({ start: minToHM(aMin), end: minToHM(bMin) });
  if (!b) return { ok: false, reason: 'time' };
  const cur = habitBlocksOf(h).filter(function (x) { return x.start !== b.start; });
  if (cur.length >= HABIT_BLOCK_MAX) return { ok: false, reason: 'full' };
  const next = habitSetBlocks(habitId, cur.concat([b]));
  return { ok: true, block: b, count: next.length };
}
function habitDelBlock(habitId, start) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) return;
  habitSetBlocks(habitId, habitBlocksOf(h).filter(function (b) { return b.start !== normHabitHM(start); }));
  /* 从习惯卡（编辑弹窗）里删的：别把弹窗换成详情弹窗，就地重铺那排 chip 就行 */
  const editOpen = document.getElementById('habitEditModal');
  if (editOpen && editOpen.classList.contains('show')) { renderHabitBlockBox(); return; }
  openHabitDetail(habitId);
}
/* ---------- 习惯的「单独某天」（2026-11-09）----------
 * 用户原话：「计划不是可以支持给单独哪天排期吗？但是现在这个习惯不支持，请你复用一下」。
 * 复用就是**真的复用**：同一条语义（这天整组覆盖、× 恢复）、同一套控件
 * （.tf-chips / 📌 chip / .tf-dp-form 日期 + 起止 / 「排到这天」「在日程表选」）——
 * 只是数据落在 h.dayPlan，规则时段 h.timeBlocks 一个字都不动。 */
function habitDayPlanSet(habitId, ds, segs) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) return { ok: false, reason: 'notFound' };
  const d = String(ds == null ? '' : ds).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, reason: 'date' };
  const clean = normExtraBlocks(segs).filter(function (b) { return b.start.slice(0, 10) === d; });
  if (!clean.length) return { ok: false, reason: 'time' };
  /* 同一天其他日子不受影响：只重写这一个键（和计划 todoDayPlanSet 的写法一致） */
  const all = habitDayPlanNormAll(h);
  const next = Object.assign({}, h.dayPlan && typeof h.dayPlan === 'object' ? h.dayPlan : {});
  next[d] = clean;
  const norm = dayPlanNormAll(next, HABIT_DAYPLAN_MAX_DAYS);
  if (norm[d]) h.dayPlan = next; else delete h.dayPlan;
  h.updatedAt = Date.now();
  saveData();
  renderHabits();
  renderHabitDayPlanBox();
  return { ok: true, blocks: clean };
}
/* 删掉某天的单独排期 → 那天回到规则时段 */
function habitDayPlanClear(habitId, ds) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) return false;
  const d = String(ds == null ? '' : ds).slice(0, 10);
  if (!h.dayPlan || typeof h.dayPlan !== 'object' || !h.dayPlan[d]) return false;
  delete h.dayPlan[d];
  if (!Object.keys(h.dayPlan).length) delete h.dayPlan;
  h.updatedAt = Date.now();
  saveData();
  renderHabits();
  renderHabitDayPlanBox();
  if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
  showToast(d.slice(5) + ' 恢复成规则时段');
  return true;
}
/* 「排到这天」：读三只框 → 这一天整组换成这段（同一天里再排 = 再补一段，与计划同一口径） */
function habitDayPlanApply(habitId) {
  const dEl = document.getElementById('habit_dp_date');
  const sEl = document.getElementById('habit_dp_start');
  const eEl = document.getElementById('habit_dp_end');
  if (!dEl || !sEl || !eEl) return;
  const ds = String(dEl.value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) { showToast('先选是哪一天'); return; }
  const sm = hmToMin(sEl.value), em = hmToMin(eEl.value);
  if (sm == null || em == null) { showToast('起止时间要填完整'); return; }
  if (em <= sm) { showToast('结束要比开始晚'); return; }
  if (em - sm < 10) { showToast('一段至少 10 分钟'); return; }
  const r = habitDayPlanSet(habitId, ds, [{
    start: ds + ' ' + minToHM(sm),
    end: ds + ' ' + minToHM(em)
  }]);
  if (!r.ok) { showToast('没存上'); return; }
  if (typeof window.renderTimeBlockGrid === 'function') window.renderTimeBlockGrid();
  showToast(ds.slice(5) + ' 这天改成 ' + minToHM(sm) + '–' + minToHM(em) + '（其余日子照旧）');
}
/* 「在日程表选」：同「加一段排期」的出口，只是这次点两格落进**那一天** */
function habitDayPlanArm(habitId) {
  const dEl = document.getElementById('habit_dp_date');
  const ds = dEl && /^\d{4}-\d{2}-\d{2}$/.test(String(dEl.value || '')) ? String(dEl.value).slice(0, 10) : getTodayStr();
  closeModal('habitDetailModal');
  closeModal('habitEditModal');
  if (typeof switchView === 'function') switchView('plan');
  if (typeof switchPlanTab === 'function') switchPlanTab('plan');
  if (typeof window.tbHabitDayArm === 'function') window.tbHabitDayArm(habitId, ds);
  const host = document.getElementById('tbShell');
  if (host && host.scrollIntoView) host.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
/* 习惯卡上的「单日」一行。空状态、chip、表单全部照计划卡那一组，不新造视觉。 */
function renderHabitDayPlanBox() {
  const box = document.getElementById('habitDayPlanBox');
  if (!box) return;
  const h = _habitEditId === null || _habitEditId === undefined ? null
    : appData.habits.find(function (x) { return idEq(x.id, _habitEditId); });
  if (!h) {
    box.innerHTML = '<div class="tf-hint">先保存这个习惯，再回来排单日</div>';
    return;
  }
  const all = habitDayPlanNormAll(h);
  const days = Object.keys(all);
  const chips = days.map(function (ds) {
    const segsTxt = all[ds].map(function (b) {
      return String(b.start).slice(11, 16) + '–' + String(b.end).slice(11, 16);
    }).join(' / ');
    return `<span class="tf-chip tf-chip--dayplan" title="这一天单独排：${escapeHtml(segsTxt)}；改它不影响别的日子">📌 ${ds.slice(5)} ` +
      escapeHtml(segsTxt) +
      `<b class="tf-chip-x" role="button" tabindex="0" aria-label="恢复这一天的规则时段" title="恢复这一天的规则时段" ` +
      `onclick="event.stopPropagation();habitDayPlanClear(${idArg(h.id)}, '${ds}')">×</b></span>`;
  }).join('');
  /* 默认值：取规则时段第一段当模板（有就照着填，省得每次从 07:00 点起），没有就 19:00–20:00 */
  const tpl = habitBlocksOf(h)[0];
  const defS = tpl ? tpl.start : (days.length ? String(all[days[0]][0].start).slice(11, 16) : '19:00');
  const defE = tpl ? tpl.end : (days.length ? String(all[days[0]][0].end).slice(11, 16) : '20:00');
  box.innerHTML =
    '<div class="tf-chips">' +
      (chips || '<span class="tf-chip tf-chip--muted">还没有哪一天单独排过</span>') +
    '</div>' +
    '<div class="tf-dp-form">' +
      '<input class="tf-input tf-input--date" type="date" id="habit_dp_date" value="' + getTodayStr() + '" title="哪一天要不一样">' +
      '<div class="tf-dp-line">' +
        '<input class="tf-input tf-input--time" type="time" id="habit_dp_start" value="' + defS + '" title="这天从几点开始">' +
        '<span class="tf-dp-dash">–</span>' +
        '<input class="tf-input tf-input--time" type="time" id="habit_dp_end" value="' + defE + '" title="这天到几点结束">' +
      '</div>' +
      '<div class="tf-dp-line">' +
        '<button class="btn-small" style="padding:var(--sp-6) var(--sp-14)" onclick="event.stopPropagation();habitDayPlanApply(' + idArg(h.id) + ')" ' +
          'title="把这段时间排到这一天：这天的时段整组换成这个，规则时段和别的日子都不动。">排到这天</button>' +
        '<button class="btn-small" style="padding:var(--sp-6) var(--sp-12);margin-left:var(--sp-6)" onclick="event.stopPropagation();habitDayPlanArm(' + idArg(h.id) + ')" ' +
          'title="不用手输：去日程表点两格，选中的那一天就按你点的那段排">在日程表选</button>' +
      '</div>' +
    '</div>' +
    '<div class="tf-hint" style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-4)">' +
      '只改这一天，别的日子不动；点 📌 上的 × 恢复成规则时段。</div>';
}
function habitBlocksRowHtml(h) {
  const bs = habitBlocksOf(h);
  const chips = bs.map(function (b) {
    return `<span class="tf-chip tf-chip--dayplan">${b.start}–${b.end}</span>`;
  }).join('');
  /* 单独某天排的也列出来（📌 11-10 07:00–08:00）：不然"今天为什么是这段时间"在详情里查不到。
     详情仍然只读；要改回规则时段点 ×，要改时间回编辑弹窗。 */
  const dpChips = Object.keys(habitDayPlanNormAll(h)).map(function (ds) {
    const segsTxt = habitDayPlanOn(h, ds).map(function (b) {
      return String(b.start).slice(11, 16) + '–' + String(b.end).slice(11, 16);
    }).join(' / ');
    return `<span class="tf-chip tf-chip--dayplan" title="这一天单独排：${escapeHtml(segsTxt)}">📌 ${ds.slice(5)} ${escapeHtml(segsTxt)}` +
      `<b class="tf-chip-x" role="button" tabindex="0" aria-label="恢复这一天的规则时段" title="恢复这一天的规则时段" ` +
      `onclick="event.stopPropagation();habitDayPlanClear(${idArg(h.id)}, '${ds}')">×</b></span>`;
  }).join('');
  /* 详情只读展示；改时段点「改时段」→ 编辑弹窗里那两个时间框（与计划卡同一处）。
     ★ 不在详情里再放一套可编辑的时间框：两处能改同一件事，必然出现"改了这边没生效"。 */
  return '<div class="tf-chips habit-block-row">' + (chips || '<span class="tf-chip tf-chip--muted">还没定几点</span>') +
    dpChips +
    '<span class="tf-chip tf-chip--action" onclick="closeModal(\'habitDetailModal\');openHabitEditModal(' + idArg(h.id) + ')">' +
    (bs.length ? '改时段' : '＋ 排时段') + '</span></div>';
}
function habitSubDetailHtml(h, today) {
  /* 顺序与卡片同一份（habitSubsSort）：详情里看到的 7:10 / 22:40，和卡片上一模一样 */
  const subs = habitSubsSort(habitSubsOf(h));
  const listToday = habitSubsOn(h, today);
  const doneN = habitSubsDoneOn(h, today, listToday);
  /* ★ 2026-11-04 第四版：不新造视觉，整段复用计划卡那一套组件 ——
       .tf-subs / .tf-sub / .sub-cb / .tf-sub-txt / .tf-sub-del
       .tf-chip--dayplan（📌 排到某天）/ .tf-chip--muted（每天）
       .tf-dp-form（日期独占一行 + 时间）/ .tf-sub-add + .tf-input + .btn-small
     子计划和「任务下的子任务」本来就是同一种东西，长得也该一样。 */
  /* 计数从标题挪到进度条那一行（任务卡的标题也不带计数）——
     同一个「1/2」在一屏里出现两次，会让人以为有两条不同的进度。 */
  let html = '<div class="settings-group habit-sub-group"><h3>子计划</h3>';
  if (subs.length) {
    /* 一行就是计划卡的子任务：勾选框 + 名字 + ✕，没有第三种东西（2026-11-06）。
       子计划是清单，不挂日期也不挂时间。 */
    html += '<div class="tf-subs">' + subs.map(function (s) {
      const on = normHabitSubDate(s.doneOn) === today;
      return '<div class="tf-sub' + (on ? ' done' : '') + '">' +
        '<div class="sub-cb' + (on ? ' checked' : '') + '" onclick="toggleHabitSub(' + idArg(h.id) + ',' + idArg(s.id) + ')" title="' + (on ? '点击取消完成' : '点击标记完成') + '">' + SUB_CB_SVG + '</div>' +
        '<span class="tf-sub-txt">' + escapeHtml(s.text) + '</span>' +
        '<span class="tf-sub-del" onclick="delHabitSub(' + idArg(h.id) + ',' + idArg(s.id) + ')" title="删除这一步">✕</span>' +
        '</div>';
    }).join('') + '</div>';
    /* 进度条 + 全部勾选：照抄任务卡的 .tf-sub-prog（同一个组件、同一份样式）。
       任务那边只在展开态给这三件，习惯的「展开态」就是这个详情弹窗，位置正好。
       全部勾完按钮变「全部取消」，不会留一个点了没反应的按钮。 */
    const _total = listToday.length;
    const _pct = _total ? Math.round(doneN / _total * 100) : 0;
    html += '<div class="tf-sub-prog">' +
      '<span class="tf-sub-prog-txt">今天 ' + doneN + '/' + _total + '</span>' +
      '<span class="tf-sub-prog-bar" role="progressbar" aria-valuenow="' + _pct +
        '" aria-valuemin="0" aria-valuemax="100" title="' + _pct + '% 完成"><i style="width:' + _pct + '%"></i></span>' +
      (_total
        ? '<button class="tf-sub-prog-btn" onclick="toggleAllHabitSubs(' + idArg(h.id) + ',' + (doneN < _total ? 1 : 0) + ')">' +
          (doneN < _total ? '全部勾选' : '全部取消') + '</button>'
        : '') +
      '</div>';
  }
  return html + _hsubFormHtml(h) + '</div>';
}
/* 子计划不挂排期（2026-11-06）。下面两个函数只为兼容旧调用点保留，不再有界面入口。 */
var _hsubSched = null;
function toggleHabitSubSched(habitId, subId) { openHabitDetail(habitId); }
/* ---------- 详情里的「添加子计划」：照计划卡的 .tf-sub-add 抄 ----------
 * 计划卡里「添加子任务」就是常驻的一行输入框 + ＋添加，没有「先点开表单」这一步，
 * 这里也不设。草稿只存文字（排期不在这里填，加好后点那一步的名字改）。 */
var _hsubForm = { text: '' };
function hsubFormDraftSet(field, val) {
  if (field === 'text') _hsubForm.text = String(val == null ? '' : val).slice(0, HABIT_SUB_TEXT_MAX);
}
function confirmHabitSubForm(habitId) {
  const d = _hsubForm;
  if (addHabitSubQuick(habitId, d.text)) {
    _hsubForm = { text: '' };
    openHabitDetail(habitId);
  } else {
    const el = document.querySelector('#habitDetailBody .hsub-form-text');
    if (el) el.focus();
  }
}
function _hsubFormHtml(h) {
  /* 与计划卡「添加子任务」同款：常驻一行 input + ＋添加，没有「打开/取消」两个态，
     也没有第二行按钮组 —— 计划卡长什么样，这里就长什么样。 */
  const d = _hsubForm;
  return '<div class="tf-sub-add">' +
    '<input class="tf-input hsub-form-text" type="text" maxlength="' + HABIT_SUB_TEXT_MAX + '"' +
    ' placeholder="添加子计划…" value="' + escapeHtml(d.text || '') + '"' +
    ' oninput="hsubFormDraftSet(\'text\',this.value)" onkeydown="if(event.key===\'Enter\')confirmHabitSubForm(' + idArg(h.id) + ')">' +
    '<button class="btn-small" onclick="confirmHabitSubForm(' + idArg(h.id) + ')">＋ 添加</button>' +
    '</div>' +
    '<div class="tf-hint">点名字可改哪天做</div>';
}
function delHabitSub(habitId, subId) {
  const h = appData.habits.find(function (x) { return idEq(x.id, habitId); });
  if (!h) return;
  const sub = _habitSubById(h, subId);
  if (!sub) return;
  const doDel = function () {
    h.subs = (Array.isArray(h.subs) ? h.subs : []).filter(function (s) { return s !== sub; });
    h.updatedAt = Date.now();
    saveData();
    renderHabits();
    openHabitDetail(habitId);
    showToast('已删掉「' + sub.text + '」');
  };
  const msg = '删掉「' + sub.text + '」这一步？';
  if (typeof window.rsConfirm === 'function') {
    window.rsConfirm(msg, { title: '删除子计划', okText: '删除', danger: true }).then(function (ok) { if (ok) doDel(); });
  } else if (confirm(msg)) {
    doDel();
  }
}

/* ---------- 编辑弹窗里的子计划草稿 ----------
 * 改动先落在 _habitDraftSubs，点「保存」才写回 h.subs；点「取消」直接丢——
 * 和节奏控件同一套心智（弹窗里改了没保存 = 没改）。 */
var _habitDraftSubs = [];
var _habitDraftSched = -1; /* 旧字段，保留只为兼容 __set 桥；子计划已无排期控件 */
function habitSubDraftSched(i) { renderHabitSubDraftBox(); }
function habitSubDraftSet(i, field, val) {
  const s = _habitDraftSubs[i];
  if (!s) return;
  if (field === 'text') s.text = String(val == null ? '' : val).slice(0, HABIT_SUB_TEXT_MAX);
}
function habitSubDraftAdd() {
  _habitDraftSubs.push({ id: 'hs' + Date.now().toString(36) + Math.floor(Math.random() * 1000), text: '', date: '', time: '', doneOn: '' });
  renderHabitSubDraftBox();
  const els = document.querySelectorAll('#habitSubBox .hsub-input');
  const last = els[els.length - 1];
  if (last) last.focus();
}
function habitSubDraftDel(i) {
  _habitDraftSubs.splice(i, 1);
  renderHabitSubDraftBox();
}
function renderHabitSubDraftBox() {
  const box = document.getElementById('habitSubBox');
  if (!box) return;
  /* 一行只剩：输入框 + ✕（2026-11-06 去掉日期和时间两种排期）。
     子计划是清单，勾了当天算完成，没勾的第二天继续留着。 */
  const rows = _habitDraftSubs.map(function (s, i) {
    return '<div class="hsub-row">' +
      '<input class="hsub-input" type="text" maxlength="' + HABIT_SUB_TEXT_MAX + '" placeholder="第 ' + (i + 1) + ' 步，例如：热身 5 分钟" value="' + escapeHtml(s.text || '') + '" oninput="habitSubDraftSet(' + i + ',\'text\',this.value)">' +
      '<button class="hsub-del" onclick="habitSubDraftDel(' + i + ')" title="删掉这一步" aria-label="删除">✕</button>' +
      '</div>';
  }).join('');
  box.innerHTML = rows +
    '<button class="hsub-add" onclick="habitSubDraftAdd()">＋ 加一步</button>' +
    '<div class="hsub-tip">每天都会列出，勾了当天算完成，没勾的第二天继续留着。</div>';
}

/* ==================== 分类排序 / 分类管理（2026-11-04）====================
 * 分类的顺序 = appData.habitCats 数组顺序（00 的 habitCatGroups 按它分组），
 * 所以"给分类排序"就是给这个数组换位。原先只能新建/删除 ——
 * 建多了以后顺序全凭建的时候的手感，且第一建的永远在最上面。
 * 入口：习惯页「📁 分类」按钮 → 分类管理弹窗（新建 / 上移 / 下移 / 删除 一处收齐）。 */
function moveHabitCat(catId, dir) {
  const cs = appData.habitCats || [];
  const i = cs.findIndex(function (c) { return c && idEq(c.id, catId); });
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= cs.length) {
    showToast(dir < 0 ? '已经在最前面了' : '已经在最后面了');
    return;
  }
  const t = cs.splice(i, 1)[0];
  cs.splice(j, 0, t);
  saveData();
  renderHabits();
  renderHabitCatModal();
  if (typeof playSound === 'function') playSound('tap');
}
function openHabitCatModal() {
  renderHabitCatModal();
  showModal('habitCatModal');
}
function renderHabitCatModal() {
  const body = document.getElementById('habitCatBody');
  if (!body) return;
  const cs = normHabitCats(appData.habitCats);
  if (!cs.length) {
    body.innerHTML = '<div class="hsub-empty">还没有分类。先点下面「＋ 新建分类」，之后在习惯的「编辑」里选它。</div>';
    return;
  }
  body.innerHTML = cs.map(function (c, i) {
    const n = (appData.habits || []).filter(function (h) { return h && !h.archived && idEq(h.catId, c.id); }).length;
    return '<div class="hcat-row">' +
      '<span class="hcat-name">📁 ' + escapeHtml(c.name) + '</span>' +
      '<span class="hcat-n">' + n + ' 个</span>' +
      '<button class="hcat-btn" onclick="moveHabitCat(' + idArg(c.id) + ',-1)"' + (i === 0 ? ' disabled' : '') + ' aria-label="上移">↑</button>' +
      '<button class="hcat-btn" onclick="moveHabitCat(' + idArg(c.id) + ',1)"' + (i === cs.length - 1 ? ' disabled' : '') + ' aria-label="下移">↓</button>' +
      '<button class="hcat-btn danger" onclick="deleteHabitCat(' + idArg(c.id) + ')" aria-label="删除分类">✕</button>' +
      '</div>';
  }).join('');
}
