/* ==================== 模块: 01eE_ui_lifegoal.js | 职责: 人生目标页（年 / 月 / 愿望清单）| 分组: ui ==================== */
/* 为什么单独一个文件：这是「目标层」的完整域（列表 / 卡片 / 编辑弹窗 / 里程碑 /
 * 数值指标 / 领域筛选），与 03_enh572 里的「今日番茄目标」是两套东西 ——
 * 那个是「今天做几个番茄」，这个是「今年要干什么」。
 *
 * 命名一律 life 前缀：项目里 `goal` 已被当日番茄数占用（renderGoalCard /
 * claimGoalCoin / 周挑战阈值），两个 goal 混用会让人分不清语义。
 *
 * 进度算法不在这里：全部走 00b_goal_progress.js 的 lifeGoalProgress()，
 * 保证卡片、周视图、复盘快照读的是同一份实现。
 *
 * 函数索引（TOC）：lifeGoalCycleKey/lifeGoalCycleNow/lifeGoalIsPast/ensureLifeAreas/lifeGoalsOf/lifeGoalById/lifeGoalChildren/goalsUsingHabit/syncHabitLink/lifeGoalTodoCount/lifeGoalPomoCount/lifeGoalSorted（+44 更多）
 *   renderLifeGoals / lifeGoalCardHtml / setLifeGoalFilter / openLifeGoalModal /
 *   renderLifeGoalModal / saveLifeGoal / deleteLifeGoal / undoDeleteLifeGoal /
 *   addLifeGoalMilestone / toggleLifeGoalMilestone / addLifeGoalMeasure
 * ============================================================ */

/* 九个固定方向，按纸质手账的九宫格摆：
 *   身心健康  学习成长  工作事业
 *   人际社交  全年目标  体验突破
 *   原子习惯  社会贡献  家人生活
 *
 * ★ 这里原来只有四个（健康/事业/关系/成长），于是「九个方向」那一页真的只有四行，
 *   用户当场问「实际上这个栏目就 4 个呀，哪有 9 个方向」—— 名字叫九个，只给四个，
 *   那是名的错，不是用户的错。四个是「够用的最小集」，九个才是这张纸的样子：
 *   少了「体验突破 / 原子习惯 / 社会贡献 / 家人生活」，一年过去就只剩工作可回顾。
 * ★ 仍然不做「自由新建维度」当主路径（可编辑会退化成第二个标签系统），
 *   但多出来的方向可以让用户自己加（加一方向），九个是**默认给全**。
 * ★ id 沿用老的四个（area_health / area_work / area_relation / area_growth），
 *   老数据里的 areaId 不会断；只改显示名。 */
const LIFE_AREA_DEFAULT = [
  { id: 'area_health', name: '身心健康', emoji: '💪', order: 0 },
  { id: 'area_growth', name: '学习成长', emoji: '📚', order: 1 },
  { id: 'area_work', name: '工作事业', emoji: '🚀', order: 2 },
  { id: 'area_relation', name: '人际社交', emoji: '🤝', order: 3 },
  { id: 'area_year', name: '全年目标', emoji: '🎯', order: 4 },
  { id: 'area_exp', name: '体验突破', emoji: '🌈', order: 5 },
  { id: 'area_habit', name: '原子习惯', emoji: '🔁', order: 6 },
  { id: 'area_give', name: '社会贡献', emoji: '🌱', order: 7 },
  { id: 'area_family', name: '家人生活', emoji: '🏡', order: 8 }
];
/* 老版本用过的名字：只有名字还停在旧默认值时才跟着改，用户自己改过的不动 */
const LIFE_AREA_RENAME = {
  area_health: { from: '健康', to: '身心健康' },
  area_work: { from: '事业', to: '工作事业' },
  area_relation: { from: '关系', to: '人际社交' },
  area_growth: { from: '成长', to: '学习成长' }
};

/* 每期目标数量上限（借 flow-dashboard 的 goal slots）：目标太多等于没有目标。
 * 愿望清单不设限 —— 它本来就不占精力。 */
const LIFE_GOAL_MAX = { year: 5, month: 3 };

/* 目标属于哪个周期：年度返回 '2026'，月度返回 '2026-10'，没定日子返回 ''。
 * ★ 不从 targetDate 推 —— 目标没达成就顺延截止日是很常见的，
 *   改个日期不该把归属改掉。startDate 记的是「这条什么时候立下」，
 *   那才是它的周期；老数据没这个字段的按今天算，不需要迁移。
 * 有了它，「今年」才真的是今年：2026 写的年度目标到 2027 年
 * 会落进「以往」，不再占着 5 个年度名额。 */
function lifeGoalCycleKey(g) {
  if (!g) return '';
  const h = g.horizon || 'year';
  if (h === 'someday') return '';
  const today = getTodayStr();
  const sd = String(g.startDate || '').slice(0, 10);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(sd);
  const y = ok ? sd.slice(0, 4) : today.slice(0, 4);
  if (h === 'month') return y + '-' + (ok ? sd.slice(5, 7) : today.slice(5, 7));
  return y;
}
/* 当前周期（'2026' / '2026-10'）；月度目标拿它比，年度目标比前四位 */
function lifeGoalCycleNow(horizon) {
  const t = getTodayStr();
  return (horizon === 'month') ? t.slice(0, 7) : t.slice(0, 4);
}
/* 是否早于当前周期 —— 「以往」段收的就是这些 */
function lifeGoalIsPast(g) {
  const h = (g && g.horizon) || 'year';
  if (h === 'someday') return false;
  return lifeGoalCycleKey(g) < lifeGoalCycleNow(h);
}

let _lgArchOpen = false;           /* 「以往」段展开状态 */
let _lgDoneOpen = false;           /* 「已达成」段展开状态 */
/* 刚保存的那条目标：这一轮渲染要把它滚到眼前并闪一下。
   以前新建完只有一句 toast「已加上」，而新目标可能排在 5 条之后、或者
   干脆落在「以往」里（补录上个月）—— 用户看不见自己刚建的东西，
   第一反应是「没保存成功」，然后就又建一条。 */
let _lgFocusId = null;
let _lgFocusTimer = null;          /* 定位那次滚动只做一遍，见 renderLifeGoals 结尾 */
/* 卡片上就地加里程碑：哪张卡正开着输入框。
   ★ 每个目标最多 5 条里程碑，卡片上平时只摊 3 条，多出来的折成「还有 N 条」。
     要加第 4 条得点进弹窗、滚到中段、找到「＋ 加一条」—— 而勾里程碑本身
     就在卡片上完成，紧接着要加下一条是同一口气里的事，不该被弹窗打断。 */
let _lgMsAddFor = null;
/* 哪些卡片展开了全部里程碑（按目标 id）。不是数据，不进 appData。 */
let _lgMsExpand = Object.create(null);

let _lifeGoalFilter = 'all';       /* 当前领域筛选 */
/* 排序模式：平时卡片完全不变（点卡片照常开弹窗、页面照常滚），
   点「排序」才出现拖动手柄。为什么要一个模式，而不是整卡长按：
   移动端的 touch-action 必须在触摸**开始前**定好，长按到一半再改已经来不及 ——
   整卡长按要么拖不动（被页面滚动接管），要么拖得动但卡片区域再也滚不了。
   只有独立手柄能设 touch-action:none 而不影响卡片本身。 */
let _lgSortMode = false;
let _lifeGoalEditing = null;       /* 正在编辑的目标 id；'__new__' = 新建 */
let _lifeGoalDraft = null;         /* 弹窗里的临时草稿（未保存前不碰 appData） */
let _lifeGoalUndo = null;          /* 删除撤销缓冲 */

/* ---------- 基础读取 ---------- */
/* 补齐缺失的方向。
 * 老用户只有四个默认领域 —— 这里按 id 补上缺的五个，绝不覆盖、不删除、不重排
 * 用户自己加的方向（它们接在九个之后）。★ 幂等：补齐后没有缺失就返回 false，
 * 不写 data。 */
function ensureLifeAreas() {
  if (!Array.isArray(appData.lifeAreas)) appData.lifeAreas = [];
  let changed = false;
  const have = {};
  appData.lifeAreas.forEach(function (a) { if (a && a.id) have[a.id] = a; });

  /* ① 老默认名 → 新默认名（只改名，id 不动，目标的 areaId 才不会断） */
  Object.keys(LIFE_AREA_RENAME).forEach(function (id) {
    const a = have[id];
    const r = LIFE_AREA_RENAME[id];
    if (a && a.name === r.from) { a.name = r.to; changed = true; }
  });

  /* ② 缺哪个补哪个（老数据只有 4 个方向时，这里会把另外 5 个补上） */
  LIFE_AREA_DEFAULT.forEach(function (d) {
    if (have[d.id]) return;
    appData.lifeAreas.push({
      id: d.id, uid: newUid('area'), name: d.name, emoji: d.emoji,
      /* 九个方向的位置是固定的（0..8）。用户自加的方向用 100+ 排在后面，
         不该跟默认方向抢位置 —— 原来这里写 maxOrder+1，补第 5~9 个时
         会和已有方向的 order 撞车，排序结果随机。 */
      order: d.order,
      updatedAt: Date.now()
    });
    changed = true;
  });

  if (changed) {
    appData.lifeAreas.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  return changed;
}
function lifeGoalsOf() {
  if (!Array.isArray(appData.lifeGoals)) appData.lifeGoals = [];
  return appData.lifeGoals;
}
function lifeGoalById(id) {
  const list = lifeGoalsOf();
  for (let i = 0; i < list.length; i++) if (list[i] && idEq(list[i].id, id)) return list[i];
  return null;
}
function lifeGoalChildren(id) {
  return lifeGoalsOf().filter(function (g) { return g && idEq(g.parentId, id); });
}
/* ---------- 目标 ↔ 习惯：一条边，两个字段 ----------
 * 真源是 goal.habitId（00b 算进度只认它：这个目标用哪个习惯的打卡率计量）。
 * habit.lifeGoalId 只是镜像（复盘按领域算习惯完成率读它）。
 * 两边各写各的就会出现「目标里选好了、习惯详情显示未关联」—— 所以：
 *   ① 读的时候两边都认（老存档里可能只有一边有值）；
 *   ② 写的时候两边同写（syncHabitLink / toggleHabitGoal）。
 * 一个习惯可以被多个目标同时计量（"跑步"既服务"跑 500 公里"也服务"每周 3 次"），
 * 所以这里全是「多对一」，不是互斥的单选。 */
function goalsUsingHabit(habitId) {
  if (habitId === null || habitId === undefined) return [];
  return lifeGoalsOf().filter(function (g) { return g && idEq(g.habitId, habitId); });
}
/* 目标改绑习惯之后把镜像一起改掉。prevHabitId 是改动前的值。
 * 解绑旧习惯前要确认没有别的目标还在用它，否则会把别人的计量一起断掉。 */
function syncHabitLink(goal, prevHabitId) {
  const habits = appData.habits || [];
  const nowId = goal.habitId;
  const findHabit = function (id) {
    return habits.filter(function (x) { return x && idEq(x.id, id); })[0] || null;
  };
  if (prevHabitId && !idEq(prevHabitId, nowId)) {
    const old = findHabit(prevHabitId);
    if (old && idEq(old.lifeGoalId, goal.id)) {
      const other = goalsUsingHabit(prevHabitId).filter(function (x) { return !idEq(x.id, goal.id); })[0];
      old.lifeGoalId = other ? other.id : null;
      old.updatedAt = Date.now();
    }
  }
  if (nowId) {
    const h = findHabit(nowId);
    /* 镜像已经有值就不覆盖：多个目标共用同一习惯时，谁先写谁占位，
       反正真源是 goal.habitId，镜像只是给"按领域统计"一个入口 */
    if (h && !h.lifeGoalId) { h.lifeGoalId = goal.id; h.updatedAt = Date.now(); }
  }
}
/* 关联任务数：只统计，不做「按目标筛任务」（那个改动会牵动计划页三分组） */
function lifeGoalTodoCount(id) {
  const list = appData.todos || [];
  let n = 0;
  for (let i = 0; i < list.length; i++) if (list[i] && idEq(list[i].lifeGoalId, id)) n++;
  return n;
}
/* 该目标的累计投入（番茄数）。只作辅助信息显示，**不进任何进度条** ——
   番茄是投入，不是进展：体脂从 22% 降到 18%，做 100 个番茄也可能一格没动。 */
function lifeGoalPomoCount(id) {
  /* 番茄记录里没有 type 字段（原以为是 'work'，实测不存在），
     能用的关联有两条：① 记录自己带了 lifeGoalId（本期只写不读，将来才有）；
     ② 记录上的 todoId 指向一个挂在该目标下的任务 —— 这条现在就能用。 */
  const todoIds = Object.create(null);
  (appData.todos || []).forEach(function (t) { if (t && idEq(t.lifeGoalId, id)) todoIds[String(t.id)] = 1; });
  const list = appData.records || [];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r) continue;
    if (r.lifeGoalId && idEq(r.lifeGoalId, id)) { n++; continue; }
    if (r.todoId !== null && r.todoId !== undefined && todoIds[String(r.todoId)]) n++;
  }
  return n;
}

/* ---------- 排序（uid 数组，借 tududi 的 user_goal_orders）---------- */
/* includeDropped：默认 false —— 选择器、周重点候选、九向这些「活清单」
   都不该列出已经放下的目标。但目标页的「了结」折叠段必须看得到它们：
   放下是一个主动决定，它的归宿是存档，不是消失（见 renderLifeGoals）。 */
function lifeGoalSorted(filterArea, includeDropped) {
  const list = lifeGoalsOf().slice();
  const order = Array.isArray(appData.lifeGoalOrder) ? appData.lifeGoalOrder : [];
  const rank = function (g) {
    const i = order.indexOf(g.uid);
    return i < 0 ? 9999 : i;
  };
  list.sort(function (a, b) {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (Number(a.createdAt ? Date.parse(a.createdAt) : 0) || 0) - (Number(b.createdAt ? Date.parse(b.createdAt) : 0) || 0);
  });
  /* 已放弃的不进列表（数据留着，只是不再占位置）。
     放在这里而不是每个调用点：任务侧的选择器、周重点的候选目标
     都要同一套可见性，漏一处就会出现「列表里没有、下拉里却有」。 */
  const alive = includeDropped ? list.filter(Boolean)
    : list.filter(function (g) { return g && (g.status || 'active') !== 'dropped'; });
  if (filterArea === '__none') {
    /* 九向里点「未归类」：没 areaId 或指向已删方向的那些 */
    return alive.filter(function (g) { return !g.areaId || !appData.lifeAreas.some(function (a) { return a.id === g.areaId; }); });
  }
  if (filterArea && filterArea !== 'all') {
    return alive.filter(function (g) { return g.areaId === filterArea; });
  }
  return alive;
}

/* ---------- 手账四页入口（页顶常驻）----------
   九个方向 / 复盘 / 愿望清单。这几页分散在三个地方：两个藏在「⋯」
   折叠菜单、一个藏在复盘弹层、复盘本身只有「到日子了」的提示条才给入口。
   用户翻遍目标页找不到，原话「你做了那么多页面，结果找不着」。
   现在四格一行常驻在页顶 —— 导航永远是导航，不进折叠菜单。

   ★「回看」整块删了（用户：「那个回看功能，你就利用那个日志的筛选不就得了？
    直接跳转得了」）—— 日志页本来就有 📅 日期筛选和日历，再维护一套逐天渲染
    等于两份数据两份分页。现在复盘列表底部有三个「本周 / 本月 / 今年 ›」跳到日志。
     所以这里是三格，不是四格。
   ★ 内容只在「这几页里发生了什么」时才会变，所以这里做短路：
     同一份 html 不重复赋值（这函数挂在 renderLifeGoals 上，而
     renderLifeGoals 一次操作会被调用好几次，重写会打断 :active 反馈）。 */
function renderLifeHub() {
  const box = document.getElementById('lifeHub');
  if (!box) return;
  const y = getTodayStr().slice(0, 4);
  const h = '<div class="lg-hub">'
    + '<button class="lg-hub-c" data-act="openLifeGrid">'
    + '<span class="lg-hub-ic">🧭</span><span class="lg-hub-t">年计划</span></button>'
    /* 只写「复盘」不写「周/月/年」：窄格子里三个字就够，会折行。
       三格（周 / 月 / 年）在弹层里各写各的。 */
    + '<button class="lg-hub-c" data-act="openLifeReview">'
    + '<span class="lg-hub-ic">📖</span><span class="lg-hub-t">复盘</span></button>'
    + '<button class="lg-hub-c" data-act="openLifeWish">'
    + '<span class="lg-hub-ic">✨</span><span class="lg-hub-t">人生愿望</span></button>'
    + '</div>';
  if (box.dataset.y === y) return;
  box.dataset.y = y;
  box.innerHTML = h;
}

/* ---------- 渲染 ---------- */
function renderLifeGoals() {
  const box = document.getElementById('lifeGoalsList');
  if (!box) return;
  /* ★ 分类栏是横滑的，重绘会把它弹回最左边。
     用户原话：「点一下选择了，它自动跳回到上面显示的，永远回到第一个，
     我需要往后滑才能滑到那个」。innerHTML 一重写，新节点的 scrollLeft 就是 0。
     这里统一在重绘前后搬一次 scrollLeft —— 不管是点筛选、切排序还是删目标，
     位置都不该自己跑掉。 */
  const _oldChips = box.querySelector('.lg-chips');
  const _keepScroll = _oldChips ? _oldChips.scrollLeft : 0;
  if (ensureLifeAreas()) saveData();
  renderLifeHub();

  const areas = appData.lifeAreas || [];
  const all = lifeGoalSorted(_lifeGoalFilter);
  /* 了结段要连「已放下」一起读：放下 = 主动存档，不是删除。
     以前它走的是同一份 lifeGoalSorted，于是「放下了」一按，目标就从页面上
     彻底消失 —— 用户既看不到它去了哪，也没有反悔的入口，展厅里那句
     「去年放下了」也永远等不到新的一条。 */
  const allAny = lifeGoalSorted(_lifeGoalFilter, true);
  const ctx = { today: getTodayStr(), habits: appData.habits || [], habitLogs: appData.habitLogs || {} };
  const TF = window.TFGoal;

  /* --- 顶部：领域筛选 + 新建 --- */
  let html = '<div class="lg-head">';
  html += '<div class="lg-chips">';
  html += '<button class="lg-chip' + (_lifeGoalFilter === 'all' ? ' on' : '') + '" data-act="setLifeGoalFilter" data-args=\'["all"]\'>全部</button>';
  areas.forEach(function (a) {
    /* emoji 单独包一层：320 下分类名 + emoji 会把 chip 撑到放不下三个，
       窄屏只留文字（「健康」「事业」本身就能认） */
    html += '<button class="lg-chip' + (_lifeGoalFilter === a.id ? ' on' : '') + '" data-act="setLifeGoalFilter" data-args=\'["' + a.id + '"]\'>'
      + '<span class="lg-chip-e">' + escapeHtml(a.emoji || '') + '</span>'
      + escapeHtml(a.name || '') + '</button>';
  });
  /* 「管理分类」放进 chips 里跟着滚，不能占右边固定位 ——
     430 宽下 5 个分类 + 两个固定按钮会把最后一个分类切成半格。 */
  /* 「进度」和「管理」一样是动作而不是筛选项，所以都用虚线样式的 chip，
     跟着换行流走 —— 做成固定宽度的圆钮会占掉 40px，
     390 下「管理」就会被挤到第二行，320 下更明显（实测过）。 */
  html += '</div>';
  /* 动作按钮和「＋」一起固定在右边，不参与分类的换行流 ——
     放进 chips 里的话，320 宽下它会被挤到第二行，孤零零一个「⋯」。 */
  html += '<div class="lg-acts">';
  if (_lgSortMode) {
    html += '<button class="lg-chip lg-chip--manage on" data-act="toggleLifeGoalSort">完成</button>';
  } else if (all.length > 0) {
    html += '<button class="lg-chip lg-chip--more" data-act="openLifeMore" title="更多">⋯</button>';
  }
  html += '<button class="lg-add" data-act="openLifeGoalModal" data-args=\'["__new__"]\' title="新建目标">＋</button>';
  html += '</div>';
  html += '</div>';

  /* --- 手账四页：放在页顶的 #lifeHub，不在这里 ---
     ★ 同一个坑踩了三次：
       ① 九向列表做完了没人看得到 —— 它只在「⋯ → 今年九个方向」里，而「⋯」
          要多于一条目标才渲染，新用户永远看不到；
       ② 愿望清单、进度一览同样只在「⋯」里；
       ③ 复盘平时没有任何入口 —— 只有「到了该复盘」那条提示条出现时才有
          （提示条按日期显示），没到日子就整页找不到「复盘」两个字。
       用户的原话：「你做了那么多页面，结果找不着，在那个目标里」。
       所以「去哪一页」这类导航放在 #lifeHub（页顶常驻，见 renderLifeHub），
       「⋯」只留管理动作（进度一览 / 排序 / 管理分类）—— 导航和设置不能
       混在同一个折叠菜单里。 */

  /* --- 空态 --- */
  /* 判断用「过滤掉已放弃之后还剩几条」，不是 lifeGoalsOf().length ——
     全是 dropped 时，后者非空会让页面一片空白却没有空态引导。 */
  if (!all.length && _lifeGoalFilter === 'all') {
    html += '<div class="lg-empty">';
    html += '<div class="lg-empty-title">还没有目标</div>';
    html += '<div class="lg-empty-hint">目标不是任务清单。写一件今年真的想做成的事，'
      + '再往下拆成本月的里程碑 —— 任务仍然在「计划」里排，这里只管方向。</div>';
    html += '<div class="lg-samples">';
    const samples = [
      { area: 'area_health', t: '体脂降到 18%' },
      { area: 'area_work', t: '把副业做成能覆盖房租的收入' },
      { area: 'area_growth', t: '读完 12 本书' }
    ];
    samples.forEach(function (s) {
      html += '<button class="lg-sample" data-act="openLifeGoalModal" data-args=\'["__new__","' + s.area + '","' + escapeHtml(s.t) + '"]\'>'
        + escapeHtml(s.t) + '</button>';
    });
    html += '</div></div>';
    box.innerHTML = html;
    return;
  }

  /* --- 三段：年度 / 月度 / 没定日子 --- */
  /* ★ 第三段不能也叫「愿望清单」：页面顶部的手账入口里已经有一个愿望清单
     （那是 01eO 的纯打勾清单，不计进度），而这里是「没有截止日的人生目标」。
     两个同名不同物的东西摆在同一页，用户点进去会以为走错了。 */
  /* iOS 的 inset grouped list：组标题在卡外（小字、灰），整组共用一块白底，
     组内行与行之间只有一条 hairline，不再每张卡各做一个盒子。
     这样「今年 / 本月 / 没定日子」就是几个自然分组，而不是几堆各管各的卡片。 */
  const secHtml = function (label, items) {
    let h = '<div class="lg-sec">';
    h += '<div class="lg-sec-head"><span>' + label + '</span><span class="lg-sec-n">' + items.length + '</span></div>';
    h += '<div class="lg-group">';
    items.forEach(function (g) { h += lifeGoalCardHtml(g, ctx, TF); });
    h += '</div></div>';
    return h;
  };

  /* --- 当前周期：今年 / 本月 / 没定日子 ---
     ★ 已达成 / 已搁置的不进这三段，单独收进下面「已达成」。
     理由不是省空间：一段里混着「还在做的事」和「已经做完的事」，
     眼睛每次都要重新分辨哪条是活的。做完的留着标题、灰掉，
     读起来像一张没划掉的待办清单 —— 那正是这个页面最容易变成的东西。 */
  const _open = function (g) { return (g.status || 'active') === 'active'; };
  const cur = [
    { label: '今年', items: all.filter(function (g) { return (g.horizon || 'year') === 'year' && !lifeGoalIsPast(g) && _open(g); }) },
    { label: '本月', items: all.filter(function (g) { return g.horizon === 'month' && !lifeGoalIsPast(g) && _open(g); }) },
    { label: '没定日子', items: all.filter(function (g) { return (g.horizon || 'year') === 'someday' && _open(g); }) }
  ];
  let shown = 0;
  cur.forEach(function (seg) {
    if (!seg.items.length) return;
    shown++;
    html += secHtml(seg.label, seg.items);
  });

  /* --- 已达成：这一期做完的，默认折起来 ---
     它不占年度 5 个名额（名额只数 active），但会一直占首屏。
     折起来也还能点开看、还能改回在做 —— 归档不是上锁。 */
  /* 上期没收尾的排在「了结」之前：还活着的事在结算的事上面。
     顺序念下来就是一次自然的交接 —— 今年 → 本月 → 没定日子 → 上期没收尾
     → 已经了结的 → 归档。 */
  const pastAll = allAny.filter(lifeGoalIsPast);
  const pastOpen = pastAll.filter(function (g) { return (g.status || 'active') === 'active'; });
  const pastDone = pastAll.filter(function (g) { return (g.status || 'active') !== 'active'; });
  /* ★ 上期没做完的，不跟归档一起收进折叠条。
     它们和「今年/本月」是同一件事 —— 还在做的事，只是写在上一个周期里。
     收起来意味着：11 月 1 日打开页面，昨天还在推的 10 月目标变成一行
     「以往 · 3 个」的灰字，要展开、要在按月份分组里找。归档是给「已经了结」
     的事用的；没做完的事一旦被归档，它就再也不会被推进了。
     所以这一段常驻，并且卡片上就带着「转到这个月 / 放下了」两条出路。 */
  if (pastOpen.length) html += secHtml('上期还没收尾', pastOpen);

  /* --- 了结：这一期做成的 + 主动放下的 ---
     ★ 两类不能混在一个「已达成」标题下：放下的事写进「已达成」，
     等于系统替用户宣布了一件它没做成的事做成了。
     一个标题只放一种结论；两种都有时，标题改成中性的「了结」。 */
  const doneCur = allAny.filter(function (g) { return !_open(g) && !lifeGoalIsPast(g); });
  const doneAch = doneCur.filter(function (g) { return g.status === 'achieved'; });
  const doneDrop = doneCur.filter(function (g) { return g.status !== 'achieved'; });
  if (doneCur.length) {
    const _dLabel = (doneAch.length && doneDrop.length) ? '这一期了结的 · ' + doneCur.length + ' 个'
      : (doneAch.length ? '已达成 · ' + doneCur.length + ' 个' : '已放下 · ' + doneCur.length + ' 个');
    html += '<button class="lg-arch' + (_lgDoneOpen ? ' on' : '') + '" data-act="toggleLifeDone">'
      + '<span>' + _dLabel + '</span>'
      + '<span class="lg-arch-x">' + (_lgDoneOpen ? '收起' : '展开') + '</span></button>';
    /* 展开后只有一种结论时不再套组标题 —— 折叠条那行本身就是标题，
       下面再来一句「做成了 2」，等于同一件事说两遍。 */
    if (_lgDoneOpen) {
      if (doneAch.length && doneDrop.length) {
        if (doneAch.length) html += secHtml('做成了', doneAch);
        if (doneDrop.length) html += secHtml('放下了', doneDrop);
      } else {
        html += '<div class="lg-group">';
        doneCur.forEach(function (g) { html += lifeGoalCardHtml(g, ctx, TF); });
        html += '</div>';
      }
    }
  }

  /* --- 以往：去年 / 上个月写的那些，按周期归组，默认收起来 ---
     ★ 以前它们直接混在「今年」里，到明年 1 月 1 日页面不会变，
     用户问的就是这个「怎么整」。收起来不等于藏起来：标题常驻、
     带条数、点一下就能翻，而且卡片本身还能点开改状态或转成今年的。
     ★ 展开后先分「没收尾」再分周期 —— 上个月没做完的目标沉到底部，
     一条一条翻月份才找得到，那等于归档成垃圾堆。没收尾的要先看见，
     而且给一条出路（转成这个月的），而不是只挂一句「已过期」。 */
  if (pastDone.length) {
    html += '<button class="lg-arch' + (_lgArchOpen ? ' on' : '') + '" data-act="toggleLifeArch">'
      + '<span>以往 · ' + pastDone.length + ' 个</span>'
      + '<span class="lg-arch-x">' + (_lgArchOpen ? '收起' : '展开') + '</span></button>';
    if (_lgArchOpen) {
      /* 近的在上：'2026-09' > '2026' > '2025'，字符串比较正好就是这个顺序 */
      const keysOf = function (arr) {
        const keys = [];
        arr.forEach(function (g) {
          const k = lifeGoalCycleKey(g);
          if (keys.indexOf(k) < 0) keys.push(k);
        });
        return keys.sort().reverse();
      };
      keysOf(pastDone).forEach(function (k) {
        const items = pastDone.filter(function (g) { return lifeGoalCycleKey(g) === k; });
        const label = (k.length === 4) ? (k + ' 年') : (k.slice(0, 4) + ' 年 ' + Number(k.slice(5, 7)) + ' 月');
        html += secHtml(label, items);
      });
    }
  }
  if (!shown) {
    /* 只有以往 / 已达成目标时也要给一句话，否则页面看起来只剩两个折叠按钮 */
    const tail = pastOpen.length ? '上期没做完的在上面'
      : (pastDone.length ? '往年的在下面' : (doneCur.length ? '这一期的都做完了' : ''));
    if (_lifeGoalFilter !== 'all') {
      /* 筛了某个分类却一条都没有 —— 这时说「这一期还没有目标」是错的：
         目标有，只是不在这一个分类下。用户会以为数据丢了。
         这里要说清是筛选把空留出来的，并给一个回到全部的出口。 */
      const _an = (appData.lifeAreas || []).filter(function (a) { return a.id === _lifeGoalFilter; })[0];
      const _nm = _an ? ((_an.emoji ? _an.emoji + ' ' : '') + (_an.name || '')) : '这个分类';
      html += '<div class="lg-empty-hint" style="padding:var(--sp-14) 0">'
        + '「' + escapeHtml(_nm) + '」下还没有目标。'
        + '<button class="lg-linkbtn" data-act="setLifeGoalFilter" data-args=\'["all"]\'>看全部目标</button>'
        + '</div>';
    } else {
      html += '<div class="lg-empty-hint" style="padding:var(--sp-14) 0">'
        + '这一期还没有在做的目标' + (tail ? '，' + tail : '')
        + '</div>';
    }
  }
  box.innerHTML = html;
  /* 重绘后把分类栏的横滑位置搬回去（见函数开头 _keepScroll 的注释） */
  if (_keepScroll > 0) {
    const _newChips = box.querySelector('.lg-chips');
    if (_newChips) _newChips.scrollLeft = _keepScroll;
  }
  /* 刚保存的那条：滚到眼前。只在这一次渲染做，状态立刻清掉 ——
     否则之后每次重绘它都会把页面拽回那个位置（用户往下一滑就被拉回去）。
     ★ 平滑滚动在这个 WebView 上会静默失效（带 behavior 的调用真的什么都不做，
       不是抛错）。所以直接瞬时对齐：定位的目的是「让你看见它」，
       动画只是锦上添花，为它多等一帧、再补一次滚动，代价大于收益。
     ★ 也不能在闭包里抓着 el：下面这条 renderLifeGoals 常常被连着调用两次
       （保存 → 周视图重画），第二次重建 DOM 后 el 已经脱离文档，
       对它调 scrollIntoView 什么都不会发生。所以延后再按 uid 现查一次。 */
  if (_lgFocusId && !_lgFocusTimer) {
    /* 标记留到定时器跑完再清：这期间可能还有一次重绘（保存后会重画周视图），
       早了清掉，第二次渲染出来的新节点就没有 focus 类可查了。 */
    _lgFocusTimer = setTimeout(function () {
      _lgFocusTimer = null;
      _lgFocusId = null;
      const list = document.getElementById('lifeGoalsList');
      if (!list) return;
      const el = list.querySelector('.lg-card.focus');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      /* 已经在视野里就别动它 —— 用户刚滑到那儿，再滚一次等于抢方向盘 */
      if (r.top >= 0 && r.bottom <= vh) return;
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
    }, 60);
  }
}

/* 把一条往期目标转到当前周期（10 月的月度目标 11 月还在做 → 转到 11 月）。
 * 只改归属用的两个日期，里程碑、进度来源、量测值全都不动 ——
 * 「继续做同一件事」不该让已经攒下的进度归零。 */
function rollLifeGoal(id) {
  const g = lifeGoalById(id);
  if (!g) return;
  const h = g.horizon || 'year';
  const r = lifeGoalRangeFor(h);
  g.startDate = r.start;
  if (h !== 'someday') g.targetDate = r.end;
  g.updatedAt = Date.now();
  /* 转期之后它会从「以往」搬回「今年」—— 不定位的话，用户看到的只是
     点了一下、卡片没了。 */
  _lgFocusId = id;
  saveData();
  renderLifeGoals();
  showToast(h === 'month' ? '已转到这个月' : '已转到今年');
}

/* 「以往」段开关。它只影响这一处渲染，所以状态就放在本模块里，
   不进 appData —— 折叠与否不是数据，重装一次浏览器不该记得这件事。 */
function toggleLifeArch() {
  _lgArchOpen = !_lgArchOpen;
  renderLifeGoals();
}

/* 「已达成」段开关，同上一段：折叠状态不是数据。 */
function toggleLifeDone() {
  _lgDoneOpen = !_lgDoneOpen;
  renderLifeGoals();
}

function lifeGoalCardHtml(g, ctx, TF) {
  const prog = TF ? TF.lifeGoalProgress(g, ctx) : { pct: null, measured: false };
  const timePct = TF ? TF.lifeGoalTimePct(g, ctx) : null;
  const pace = TF ? TF.lifeGoalPace(prog, timePct) : null;
  const area = (appData.lifeAreas || []).filter(function (a) { return a.id === g.areaId; })[0];
  const isSomeday = (g.horizon || 'year') === 'someday';
  const isPast = lifeGoalIsPast(g);
  const pct = prog.pct;

  /* 排序模式下卡片不再是「点击入口」——去掉 data-act，避免拖完手一松就弹窗。
     data-uid 是拖动后回写顺序用的键（lifeGoalOrder 存的是 uid，不是 id）。 */
  let h = '<div class="lg-card' + (_lgSortMode ? ' sorting' : '')
    + ((_lgFocusId && idEq(g.id, _lgFocusId)) ? ' focus' : '') + '"'
    + ' data-uid="' + escapeHtml(String(g.uid || g.id || '')) + '"'
    + (_lgSortMode ? '' : ' data-act="openLifeGoalModal" data-args=\'["' + g.id + '"]\'')
    + '>';
  h += '<div class="lg-card-top">';
  h += '<div class="lg-title">' + escapeHtml(g.title || '（未命名）') + '</div>';
  if (g.status === 'achieved') h += '<span class="lg-badge done">已达成</span>';
  else if (g.status === 'dropped') h += '<span class="lg-badge ghost">已放下</span>';
  else if (g.status === 'paused') h += '<span class="lg-badge paused">暂停</span>';
  else if (isSomeday) h += '<span class="lg-badge">愿望</span>';
  h += '</div>';

  /* 领域和「待衡量」并成一行：左边是谁的目标，右边是它还缺什么。
     原来各占一行 —— 领域一行、空一行、卡片结束，三张未测量的目标就是六行
     同样的灰字，整屏读下来只有「事业」「健康」「成长」三个词。
     现在一张卡两行：标题、领域 + 状态。 */
  const needMeasure = !isSomeday && !isPast && !prog.measured && (!g.status || g.status === 'active');
  if (area || needMeasure) {
    h += '<div class="lg-metarow">';
    if (area) {
      h += '<span class="lg-meta-t">' +
        '<span class="lg-meta-em">' + escapeHtml(area.emoji || '') + '</span>' +
        (area.emoji ? ' ' : '') + escapeHtml(area.name || '') + '</span>';
    }
    if (needMeasure) {
      h += '<span class="lg-need" title="点开目标，设一个衡量方式（里程碑 / 数值 / 习惯），才有进度可看">待衡量</span>';
    }
    h += '</div>';
  }

  /* 进度：愿望清单不画条（没有可比的终点）；已达成的不画条 ——
     ★ 「已达成」徽章旁边跟一条 50% 的进度条，两个数字互相打脸：
       要么是还没做完（那就不该标达成），要么是达成了而里程碑没勾全（那这句 50% 是假的）。
       卡片这里说「做成了」，进度留给往年的展厅去交代。 */
  if (!isSomeday && g.status !== 'achieved') {
    if (prog.measured) {
      h += '<div class="lg-track">';
      h += '<div class="lg-fill" style="width:' + pct + '%"></div>';
      /* 时间线只在「真的走了一段」时画：刚开始的目标（0%）画出来只是个白点 */
      if (!isPast && timePct !== null && timePct >= 1) h += '<div class="lg-now" style="left:' + timePct.toFixed(1) + '%"></div>';
      h += '</div>';
      /* iOS 的数字读法：左侧是主角（大号百分比），右侧是配角（时间已过、样本量），
         两者用 space-between 分开 —— 挤成一行中间用「·」隔开，谁都不突出。 */
      let right = [];
      /* ★ 往期目标不再比时间。归档之后「时间已过 100% · 落后 50 点」这句话既没意义
         又像是在骂人：那一年已经结束了，它不是落后，是结算完了。
         同样地，已完成的目标也不比时间：100% 后面跟一句「时间已过 82%」只会让人
         怀疑是不是没做完。 */
      /* ★ 已经了结的（做成了 / 放下了）都不再比时间。归档之后
         「时间已过 100% · 落后 50 点」既没意义又像在骂人：那件事已经结束了，
         它不是落后，是结算完了；主动放下的那些，催它「落后」更是说不过去。 */
      if (pct < 100 && !isPast && (g.status || 'active') === 'active' && timePct !== null && timePct >= 1) {
        /* ★ 把「从哪天起算」写出来。同一个 82%，可以是「今年过去了 82%」，
           也可以是「你这条目标已经走到 82%」—— 不写起点，用户看到红字只会
           觉得自己落后，而不会想到问题出在这个日期不是自己设的。
           起点就在弹窗第三个字段里，能改；但页面上得先说清它是谁。 */
        const _sd = String(g.startDate || '').slice(0, 10);
        const _sdShort = _sd ? (Number(_sd.slice(5, 7)) + '/' + Number(_sd.slice(8, 10))) : '';
        right.push('时间过了 ' + Math.round(timePct) + '%'
          + (_sdShort ? '（从 ' + _sdShort + ' 起）' : '')
          /* 落后多少并进同一行。原来它单独占一行，而「时间已过 83%」已经暗示了
             同一个意思 —— 一张卡上两行说一件事，读起来像在催。 */
          + (pace === 'danger' ? ' · 落后 ' + Math.round(timePct - pct) + ' 点' : ''));
      }
      if (prog.source === 'habit') {
        /* 习惯目标不写「基于 x/y 项」—— 它没有「项」可数，只有次数。
           两种口径说法不同：
             · 填了次数 → 「这个周期打够 N 次」
             · 留空     → 「按每周几次折算，这 N 天该打几次」 */
        if (prog.needTotal) {
          right.push(prog.byTarget
            ? ('要打够 ' + prog.needTotal + ' 次')
            : ('这 ' + prog.windowDays + ' 天应打 ' + Math.round(prog.total) + ' 次'));
        }
      } else if (prog.filled !== undefined && prog.total !== undefined && prog.filled < prog.total) {
        right.push('基于 ' + prog.filled + '/' + prog.total + ' 项');
      }
      h += '<div class="lg-nums"><span class="lg-pct">' + pct + '%</span>';
      if (right.length) h += '<span class="lg-time">' + right.join(' · ') + '</span>';
      h += '</div>';
      /* 习惯目标的目标次数单独一行：百分比给不出「还差几次」，
         而次数目标的天性就是数次数。 */
      if (prog.source === 'habit' && prog.needTotal) {
        const dl = String(prog.spanEnd || '').slice(5).replace('-', '/');
        h += '<div class="lg-habitneed">'
          + (prog.byTarget
            ? ('已打 ' + (prog.doneAll === null || prog.doneAll === undefined ? '—' : prog.doneAll)
               + ' / ' + prog.needTotal + ' 次')
            : ((prog.perWeek ? '每周 ' + prog.perWeek + ' 次 · ' : '')
               + '到 ' + escapeHtml(dl) + ' 需 ' + prog.needTotal + ' 次 · 已打 '
               + (prog.doneAll === null || prog.doneAll === undefined ? '—' : prog.doneAll) + ' 次'))
          + '</div>';
      }
      /* 里程碑直接摊在卡片上、就地可勾 —— 像子任务那样。
         原来必须点进弹窗才能打勾，等于把最常用的动作藏进了二级页面。 */
      if ((g.progressSource || 'milestone') === 'milestone') {
        const msAll = (g.milestones || []).filter(function (m) { return m && typeof m === 'object'; });
        const undone = msAll.filter(function (m) { return !m.done; });
        const _expanded = !!_lgMsExpand[g.id];
        /* 全部勾完时不再显示空区域 —— 但也不能什么都不显示：
           用户刚勾掉最后一条，需要看到「勾上了」的回执，而且误勾要能取消。
           所以退回「最近一条已完成」，带勾、可点。 */
        const shown = _expanded ? msAll : (undone.length ? undone.slice(0, 3) : msAll.slice(-1));
        const _foldN = _expanded ? 0 : Math.max(0, undone.length - 3);
        if (shown.length) {
          h += '<div class="lg-ms">';
          shown.forEach(function (m) {
            h += '<button class="lg-ms-row' + (m.done ? ' done' : '') + '" data-act="toggleLifeGoalMs" data-args=\'' + JSON.stringify([g.id, m.id || '']) + '\' data-stop="1">'
              + '<span class="lg-tick' + (m.done ? ' on' : '') + '"></span>'
              + '<span class="lg-ms-t">' + escapeHtml(m.text || '') + '</span></button>';
          });
          h += '</div>';
          /* 「还有 N 条」以前是一行死掉的灰字 —— 看得见数不出，想翻还得进弹窗。
             现在它就是展开按钮，展开后原地显示全部（含已完成的），并给「收起」。
             ★ 已完成的只在展开态出现：平时列表上只留「还要做什么」，
               做完的那些交给进度条和已达成去说。 */
          if (_foldN > 0) {
            h += '<button class="lg-ms-more lg-ms-more--btn" data-act="toggleLifeGoalMsExpand" data-args=\'' + JSON.stringify([g.id]) + '\' data-stop="1">还有 ' + _foldN + ' 条</button>';
          } else if (_expanded) {
            h += '<button class="lg-ms-more lg-ms-more--btn" data-act="toggleLifeGoalMsExpand" data-args=\'' + JSON.stringify([g.id]) + '\' data-stop="1">收起</button>';
          }
          if (!undone.length && msAll.length > 1 && !_expanded) h += '<div class="lg-ms-more">里程碑全部完成</div>';
        }
        /* 就地加一条：只有还在做的目标才给。已达成 / 已放下的目标上再加里程碑
           等于给一件已经结算的事补计划，没有意义。 */
        if ((g.status || 'active') === 'active' && !isPast) {
          if (_lgMsAddFor === g.id) {
            h += '<div class="lg-ms-add" data-stop="1">'
              + '<input class="lg-ms-in" id="lgMsNew" maxlength="40" placeholder="下一步做什么"'
              + ' data-stop="1" data-keys="Enter" data-keydown="lgGoalAddMs" data-keydown-args=\'' + JSON.stringify([g.id, '@value']) + '\'>'
              + '<button class="lg-ms-ok" data-act="lgGoalAddMs" data-args=\'' + JSON.stringify([g.id]) + '\' data-stop="1">加上</button>'
              + '<button class="lg-ms-x" data-act="lgGoalCancelMs" data-stop="1">取消</button>'
              + '</div>';
          } else {
            h += '<button class="lg-ms-addbtn" data-act="lgGoalStartMs" data-args=\'' + JSON.stringify([g.id]) + '\' data-stop="1">＋ 里程碑</button>';
          }
        }
      }
    } else {
      /* 未测量的卡不再多占一行「未测量 · 设一个衡量方式」——
         状态已经挂在标题旁的 badge 上（见 lifeGoalCardHtml 开头）。 */
    }
  } else if (g.status === 'achieved' && g.achievedAt) {
    h += '<div class="lg-meta">' + escapeHtml(g.achievedAt) + ' 实现</div>';
  }

  /* 100% 了还叫「在做」，是这套系统里最伤人的一处 ———
     用户明明做完了，页面还在问「你要不要继续」，而弹窗里又没有「达成」这个选项。
     这里就地给一步到位：按钮只在真的满格时出现，不常驻，不制造噪音。 */
  if (!isPast && (g.status || 'active') === 'active' && prog.measured && pct >= 100) {
    h += '<button class="lg-done" data-act="markLifeGoalDone" data-args=\'["' + g.id + '"]\' data-stop="1">'
      + '✓ 这个目标做成了</button>';
  }

  /* 往期没收尾的目标：给一条出路，而不是只挂一句「已过期」。
     用户 10 月的月度目标 11 月还在做 —— 那是继续，不是放下了。 */
  if (isPast && (g.status || 'active') === 'active') {
    h += '<button class="lg-roll" data-act="rollLifeGoal" data-args=\'["' + g.id + '"]\' data-stop="1">'
      + ((g.horizon === 'month') ? '转到这个月' : '转到今年') + '</button>'
      /* 转期之外要有第二条路。只给「继续」，等于假设所有没做完的事都应该继续，
         可真实的一年里总归有几件是主动停掉的 —— 没有出口，它们就永远赖在
         「没收尾」里假装还在做。 */
      + '<button class="lg-roll lg-drop" data-act="dropLifeGoal" data-args=\'["' + g.id + '"]\' data-stop="1">放下了</button>';
  }

  const todos = lifeGoalTodoCount(g.id);
  const pomos = lifeGoalPomoCount(g.id);
  if (todos || pomos) {
    h += '<div class="lg-meta">';
    const bits = [];
    if (todos) bits.push('关联 ' + todos + ' 个任务');
    if (pomos) bits.push('累计 ' + pomos + '🍅');
    h += escapeHtml(bits.join(' · '));
    h += '</div>';
  }
  /* 「为什么做这件事」沉到卡片底部：
     它是给「动摇的时候」看的，不是每次打开都要读的一行。放标题下面会和白占一行，
     而且抢走进度条的注意力。 */
  if (g.why) h += '<div class="lg-why">' + escapeHtml(g.why) + '</div>';
  if (_lgSortMode) {
    h += '<span class="lg-sort-handle" title="按住拖动排序"><i></i><i></i><i></i></span>';
  }
  h += '</div>';
  return h;
}

/* ---------- 筛选 ---------- */
function setLifeGoalFilter(areaId) {
  _lifeGoalFilter = areaId || 'all';
  /* 横滑位置由 renderLifeGoals 自己保存/恢复，这里不用再管 —— 见那个函数开头 */
  renderLifeGoals();
}

/* ---------- 编辑弹窗 ---------- */
function openLifeGoalModal(id, presetArea, presetTitle) {
  ensureLifeAreas();
  if (id === '__new__') {
    _lifeGoalEditing = '__new__';
    const today = getTodayStr();
    _lifeGoalDraft = {
      id: null,
      title: presetTitle || '',
      why: '',
      /* 新建时默认落在「当前正在看的分类」—— 筛了「成长」又建目标，
         结果跑到「健康」底下，是最容易让人以为没保存成功的那种意外。 */
      areaId: presetArea
        || (_lifeGoalFilter !== 'all' ? _lifeGoalFilter : null)
        || (appData.lifeAreas[0] && appData.lifeAreas[0].id) || 'area_health',
      horizon: 'year',
      status: 'active',
      startDate: today,
      targetDate: today.slice(0, 4) + '-12-31',
      progressSource: 'milestone',
      milestones: [],
      measure: { items: [] },
      habitId: null,
      manualPct: 0,
      parentId: null
    };
  } else {
    const g = lifeGoalById(id);
    if (!g) return;
    _lifeGoalEditing = g.id;
    _lifeGoalDraft = JSON.parse(JSON.stringify(g));
    if (!_lifeGoalDraft.measure) _lifeGoalDraft.measure = { items: [] };
    if (!Array.isArray(_lifeGoalDraft.milestones)) _lifeGoalDraft.milestones = [];
  }
  renderLifeGoalModal();
  showModal('lifeGoalModal');
}

/* 习惯关联的「算式预览」：把目标进度到底怎么来的摊开写。
   没选习惯时给出这是什么的一句话（不选就永远是「未测量」）；
   选了就把区间、期望次数、实际次数、当前百分比一次说清。
   ★ 数值一律走 TFGoal.lifeGoalProgress —— 卡片上显示的和这里显示的
     必须是同一个函数算的，否则表单里说 23%、卡片上写 18%，比不说还糟。 */
function habitLinkPreviewHtml(d, habits) {
  const TF = window.TFGoal;
  const hb = (habits || []).filter(function (x) { return String(x.id) === String(d.habitId); })[0];
  if (!hb) {
    return '<div class="lg-help lg-help--pad">选一个习惯，这个目标的进度就等于它的打卡率 —— '
      + '不用自己填。不选的话卡片会一直显示「未测量」。</div>';
  }
  const per = Number(hb.freqPerWeek || 0);
  const freq = per >= 7 ? '每天' : (per > 0 ? ('每周 ' + per + ' 次') : '未设频次');
  const start = String(d.startDate || '');
  const end = String(d.targetDate || '');
  const fmt = function (ds) { return ds && ds.length >= 10 ? (Number(ds.slice(5, 7)) + '/' + Number(ds.slice(8, 10))) : ''; };
  const span = (start && end) ? (fmt(start) + ' – ' + fmt(end)) : (start ? (fmt(start) + ' 起') : '');
  let line2 = '';
  if (TF && TF.lifeGoalProgress) {
    let pr = null;
    try {
      pr = TF.lifeGoalProgress({
        progressSource: 'habit', habitId: d.habitId,
        startDate: d.startDate || '', targetDate: d.targetDate || '',
        habitTarget: d.habitTarget || ''
      }, { habits: habits, habitLogs: (appData.habitLogs || {}) });
    } catch (e) { pr = null; }
    if (pr && pr.needTotal !== null && pr.needTotal !== undefined) {
      const doneN = (pr.doneAll === null || pr.doneAll === undefined) ? 0 : pr.doneAll;
      /* 两句话不一样长，因为两种口径本来就不一样：
           · 填了次数 → 「这个周期打够 N 次就算完成」
           · 留空     → 「按每周 n 次折算，这段时间该打 N 次」 */
      line2 = (pr.byTarget ? '这段要打够 ' : (span ? span + ' 按频率折算要 ' : '要 '))
        + pr.needTotal + ' 次'
        + '，已打 ' + doneN + ' 次'
        + ' → ' + Math.round(pr.pct) + '%';
    } else if (pr && !pr.measured) {
      line2 = '这段还没打过卡，所以卡片先显示「未测量」';
    }
  }
  let out = '<div class="lg-link-prev">'
    + '<div class="lg-link-prev-l1">' + escapeHtml(hb.name || '') + ' · ' + escapeHtml(freq) + '</div>';
  if (line2) out += '<div class="lg-link-prev-l2">' + escapeHtml(line2) + '</div>';
  out += '<div class="lg-link-prev-l3">'
    + (d.habitTarget
      ? '打够这个次数就是 100%，超了也算 100%。'
      : '留空就按习惯的频率折算：「每周 3 次」跑满这一个月 ≈ 13 次。想写「至少 5 次」就填上面那格。')
    + '</div></div>';
  return out;
}

function renderLifeGoalModal() {
  const box = document.getElementById('lgModalBody');
  if (!box || !_lifeGoalDraft) return;
  const d = _lifeGoalDraft;
  const isNew = _lifeGoalEditing === '__new__';
  const areas = appData.lifeAreas || [];

  /* 重渲染会丢掉滚动位置（切周期、切进度方式都要重渲染）。
     目标表单比一屏长，每次切换都跳回顶部，等于让人重新找位置。 */
  const boxEl = document.getElementById('lifeGoalModalBox');
  const keepScroll = boxEl ? boxEl.scrollTop : 0;

  const titleEl = document.getElementById('lgModalTitle');
  if (titleEl) titleEl.textContent = isNew ? '新建目标' : '编辑目标';

  /* iOS 分段控件：一个灰底槽，选中项是白色浮起片 */
  const segGroup = function (items, cur, act) {
    let r = '<div class="lg-seg-group">';
    items.forEach(function (it) {
      const on = String(cur) === String(it.k);
      r += '<button class="lg-seg-item' + (on ? ' on' : '') + '"'
        + ' data-act="' + act + '" data-args=\'' + JSON.stringify([it.key, it.k]) + '\'>'
        + escapeHtml(it.label) + '</button>';
    });
    return r + '</div>';
  };

  let h = '';

  /* ① 目标本身：两个块状字段，标签在上、输入在下（iOS 的标题类字段就这么排） */
  h += '<div class="lg-form">';
  h += '<div class="lg-row lg-row--block">'
    + '<span class="lg-row-k">想做成什么</span>'
    + '<input class="lg-row-in" id="lgTitle" maxlength="60" placeholder="例如：体脂降到 18%"'
    + ' value="' + escapeHtml(d.title || '') + '"'
    + ' data-input="lifeGoalDraftInput" data-input-args=\'["title","@value"]\'>'
    + '</div>';
  h += '<div class="lg-row lg-row--block">'
    + '<span class="lg-row-k">为什么想做（可选）</span>'
    + '<textarea class="lg-row-in lg-row-in--area" id="lgWhy" maxlength="200" rows="2"'
    + ' placeholder="半年后回头看，这句最有用"'
    + ' data-input="lifeGoalDraftInput" data-input-args=\'["why","@value"]\'>' + escapeHtml(d.why || '') + '</textarea>'
    + '</div>';
  h += '</div>';

  /* ② 分类 / 周期 / 起止日期 */
  h += '<div class="lg-form">';
  h += '<div class="lg-row"><span class="lg-row-k">分类</span>'
    + '<select class="lg-row-v lg-select" data-change="lifeGoalDraftSet" data-change-args=\'["areaId","@value"]\'>';
  areas.forEach(function (a) {
    const sel = String(d.areaId) === String(a.id) ? ' selected' : '';
    h += '<option value="' + escapeHtml(a.id) + '"' + sel + '>'
      + escapeHtml((a.emoji ? a.emoji + ' ' : '') + (a.name || '')) + '</option>';
  });
  h += '</select></div>';

  h += '<div class="lg-row"><span class="lg-row-k">周期</span>'
    + segGroup([
      { key: 'horizon', k: 'year', label: '年度' },
      { key: 'horizon', k: 'month', label: '月度' },
      { key: 'horizon', k: 'someday', label: '愿望' }
    ], d.horizon || 'year', 'lifeGoalDraftSet')
    + '</div>';

  if (d.horizon !== 'someday') {
    h += '<div class="lg-row"><span class="lg-row-k">开始</span>'
      + '<input class="lg-row-v" type="date" value="' + escapeHtml(d.startDate || '') + '"'
      + ' data-change="lifeGoalDraftInput" data-change-args=\'["startDate","@value"]\'></div>';
    h += '<div class="lg-row"><span class="lg-row-k">截止</span>'
      + '<input class="lg-row-v" type="date" value="' + escapeHtml(d.targetDate || '') + '"'
      + ' data-change="lifeGoalDraftInput" data-change-args=\'["targetDate","@value"]\'></div>';
  }
  h += '</div>';

  /* ③ 进度 */
  if (d.horizon === 'someday') {
    h += '<div class="lg-form">';
    h += '<div class="lg-row"><span class="lg-row-k">状态</span>'
      + segGroup([
        { key: 'status', k: 'active', label: '还没实现' },
        { key: 'status', k: 'achieved', label: '已实现' }
      ], d.status || 'active', 'lifeGoalDraftSet')
      + '</div>';
    h += '</div>';
    h += '<div class="lg-help lg-help--pad">人生愿望不画进度条 —— 它只有「还没实现 / 已实现」两种状态。</div>';
  } else {
    h += '<div class="lg-form">';
    h += '<div class="lg-row"><span class="lg-row-k">怎么算</span>'
      + segGroup([
        { key: 'progressSource', k: 'milestone', label: '里程碑' },
        { key: 'progressSource', k: 'measure', label: '数值' },
        { key: 'progressSource', k: 'habit', label: '习惯' },
        { key: 'progressSource', k: 'manual', label: '手动' }
      ], d.progressSource || 'milestone', 'lifeGoalDraftSet')
      + '</div>';

    if (d.progressSource === 'milestone') {
      (d.milestones || []).forEach(function (m, i) {
        h += '<div class="lg-row lg-row--tight">'
          + '<button class="lg-tick' + (m.done ? ' on' : '') + '" data-act="lifeGoalDraftToggleMs" data-args=\'' + JSON.stringify([i]) + '\'>'
          + (m.done ? '✓' : '') + '</button>'
          + '<span class="lg-row-v lg-row-v--left">' + escapeHtml(m.text || '') + '</span>'
          + '<button class="lg-x" data-act="lifeGoalDraftDelMs" data-args=\'' + JSON.stringify([i]) + '\'>×</button>'
          + '</div>';
      });
      h += '<div class="lg-row">'
        + '<input class="lg-row-v lg-row-v--left lg-inline" id="lgNewMs" placeholder="加一条，例如：连续 20 天健身"'
        + ' data-keydown="lifeGoalDraftAddMs" data-keys="Enter">'
        + '<button class="lg-mini" data-act="lifeGoalDraftAddMs">加</button>'
        + '</div>';
    } else if (d.progressSource === 'measure') {
      (d.measure.items || []).forEach(function (m, i) {
        h += '<div class="lg-row lg-row--stack">'
          + '<div class="lg-measure-top">'
          + '<input class="lg-row-in lg-measure-name" value="' + escapeHtml(m.name || '') + '" placeholder="指标名（体脂率）"'
          + ' data-input="lifeGoalDraftMeasure" data-input-args=\'' + JSON.stringify([i, 'name', '@value']) + '\'>'
          + '<button class="lg-x" data-act="lifeGoalDraftDelMeasure" data-args=\'' + JSON.stringify([i]) + '\'>×</button>'
          + '</div>'
          + '<div class="lg-measure-nums">'
          + '<label class="lg-measure-cell"><span>起</span><input type="number" step="any" value="' + (m.from === null || m.from === undefined ? '' : m.from) + '" placeholder="—"'
          + ' data-input="lifeGoalDraftMeasure" data-input-args=\'' + JSON.stringify([i, 'from', '@value']) + '\'></label>'
          + '<label class="lg-measure-cell"><span>当前</span><input type="number" step="any" value="' + (m.current === null || m.current === undefined ? '' : m.current) + '" placeholder="—"'
          + ' data-input="lifeGoalDraftMeasure" data-input-args=\'' + JSON.stringify([i, 'current', '@value']) + '\'></label>'
          + '<label class="lg-measure-cell"><span>目标</span><input type="number" step="any" value="' + (m.to === null || m.to === undefined ? '' : m.to) + '" placeholder="—"'
          + ' data-input="lifeGoalDraftMeasure" data-input-args=\'' + JSON.stringify([i, 'to', '@value']) + '\'></label>'
          + '</div></div>';
      });
      h += '<div class="lg-row"><button class="lg-mini" data-act="lifeGoalDraftAddMeasure">＋ 加一项指标</button></div>';
    } else if (d.progressSource === 'habit') {
      const habits = appData.habits || [];
      if (!habits.length) {
        h += '<div class="lg-row"><span class="lg-row-v lg-row-v--left lg-row-v--muted">还没有习惯，先去「习惯」页建一个</span></div>';
      } else {
        /* ★ 原来这里只有一行「关联 [不习惯 ▾]」+ 一句「按每周 N 次折算，和习惯页一致」。
           用户看不懂：关联是什么？折算是谁算、算出来多少？
           现在选完直接把算式摆出来 —— 哪一段、多少次、打了几次、几%。
           说不清的东西，就别只用一句话带过。 */
        h += '<div class="lg-row"><span class="lg-row-k">跟哪个习惯走</span>'
          + '<select class="lg-row-v lg-select" data-change="lifeGoalDraftSelectHabit" data-change-args=\'["@value"]\'>'
          + '<option value="">不关联</option>';
        habits.forEach(function (hb) {
          const sel = String(d.habitId) === String(hb.id) ? ' selected' : '';
          h += '<option value="' + escapeHtml(String(hb.id)) + '"' + sel + '>' + escapeHtml(hb.name || '') + '</option>';
        });
        h += '</select></div>';
        /* 选完习惯立刻问一句「这个周期要打几次」——这是用户真正卡住的地方：
           「我这个月至少打卡 5 次」「完成率 ≥ 80%」。前者靠这个数字，
           后者留空就按习惯的频率折算。 */
        if (d.habitId) {
          h += '<div class="lg-row"><span class="lg-row-k">要打几次</span>'
            + '<input class="lg-row-v lg-input" type="number" inputmode="numeric" min="1" step="1"'
            + ' value="' + (d.habitTarget ? escapeHtml(String(d.habitTarget)) : '') + '"'
            + ' placeholder="留空 = 按习惯频率折算"'
            + ' data-change="lifeGoalDraftSet" data-change-args=\'["habitTarget","@value"]\'></div>';
        }
        h += habitLinkPreviewHtml(d, habits);
      }
    } else {
      h += '<div class="lg-row lg-row--stack">'
        + '<input class="lg-range" type="range" min="0" max="100" step="5" value="' + (Number(d.manualPct) || 0) + '"'
        + ' data-input="lifeGoalDraftInput" data-input-args=\'["manualPct","@value"]\'>'
        + '<div class="lg-range-num"><span id="lgManualNum">' + (Number(d.manualPct) || 0) + '%</span></div>'
        + '</div>';
    }
    h += '</div>';

    /* 说明文案放在表单外，iOS 用 footnote 解释 */
    if (d.progressSource === 'milestone' && !(d.milestones || []).length) {
      h += '<div class="lg-help lg-help--pad">至少加一条，否则显示「未测量」</div>';
    } else if (d.progressSource === 'measure') {
      h += '<div class="lg-help lg-help--pad">留空 = 还没测，不算 0%</div>';
    } else if (d.progressSource === 'habit') {
      /* 说明已经在 select 下面用算式说过了（habitLinkPreviewHtml），
         这里不再补一句「按每周 N 次折算」—— 一句没有数字的解释等于没解释。 */
    } else if (d.progressSource === 'manual') {
      h += '<div class="lg-help lg-help--pad">自己估个进度</div>';
    }

    /* 季度检查点：只有年度目标有，放在表单最底部（它是三个月看一次的东西，
       不该占住「每天都要改的进度」上面那块位置）。由 01eF 渲染，
       因为它和「本周重点 / 收尾窗口」是同一套周期概念。 */
    if (typeof lifeGoalCheckpointHtml === 'function') {
      h += lifeGoalCheckpointHtml(d);
    }

    /* 了结：年度 / 月度目标以前**没有任何入口**能标达成或放下 ——
       状态段只写在 someday 分支里，于是勾完最后一个里程碑、进度 100%，
       卡片仍叫「在做」，永远进不了「已达成」，那个段位于是永远空的。
       达成本身就是目标的终点，不是只有「愿望」才有终点。 */
    h += '<div class="lg-form lg-form--foot"><div class="lg-row">'
      + '<span class="lg-row-k">状态</span>'
      + segGroup([
        { key: 'status', k: 'active', label: '在做' },
        { key: 'status', k: 'achieved', label: '达成了' },
        { key: 'status', k: 'dropped', label: '放下了' }
      ], (d.status || 'active'), 'lifeGoalDraftSet')
      + '</div>'
      + '<div class="lg-help">「放下了」不是失败：它从做着的列表里收起来，'
      + '往年回看里仍记成那一年主动放下的 —— 随时可以改回「在做」。</div>'
      + '</div>';
  }

  box.innerHTML = h;

  /* 按钮单独挂在 #lgModalFoot，不在滚动区里 ——
     sticky 只在元素已经进入视口后才生效，内容一长它仍然会被推到屏幕外。 */
  const foot = document.getElementById('lgModalFoot');
  if (foot) {
    let f = '';
    if (isNew) {
      /* 新建：只有「取消 / 保存」，两个都靠右。左对齐的取消会让人以为还有第三个操作。 */
      f += '<button class="lg-btn" data-act="closeLifeGoalModal">取消</button>';
    } else {
      /* 编辑：删除在最左（危险操作远离主操作），取消 + 保存靠右 */
      f += '<button class="lg-btn danger" data-act="deleteLifeGoal" data-args=\'' + JSON.stringify([d.id]) + '\'>删除</button>';
      f += '<button class="lg-btn" data-act="closeLifeGoalModal">取消</button>';
    }
    f += '<button class="lg-btn primary" data-act="saveLifeGoal">保存</button>';
    foot.innerHTML = f;
  }
  if (boxEl && keepScroll) boxEl.scrollTop = keepScroll;
}

function closeLifeGoalModal() {
  closeModal('lifeGoalModal');
  const foot = document.getElementById('lgModalFoot');
  if (foot) foot.innerHTML = '';
  _lifeGoalDraft = null;
  _lifeGoalEditing = null;
}

/* 草稿字段写入（输入框）
   ★ 不重新渲染整个弹窗：输入过程中重建 DOM 会丢焦点、丢光标位置。 */
function lifeGoalDraftInput(key, val) {
  if (!_lifeGoalDraft) return;
  _lifeGoalDraft[key] = val;
  /* 用户手填过日期之后，切周期就不再自动改写区间 —— 自动值可以覆盖，
     人填的值不能覆盖。 */
  if (key === 'startDate' || key === 'targetDate') _lifeGoalDraft._dateTouched = true;
}
function lifeGoalDraftSet(key, val) {
  if (!_lifeGoalDraft) return;
  _lifeGoalDraft[key] = val;
  if (key === 'horizon') {
    /* 切到愿望：清掉日期与进度方式，避免残留「有截止日的愿望」 */
    if (val === 'someday') {
      _lifeGoalDraft.targetDate = null;
    } else if (!_lifeGoalDraft._dateTouched) {
      /* ★ 日期区间要跟着周期走，不能只在 startDate 空的时候补一次。
         早先的条件是 `!startDate`，而新建时 startDate 已被填成今天，于是
         切「年度 → 月度」日期一动不动，一直显示到今天到当年 12/31 ——
         用户看到的「选周期下面的日期不会变」就是这个。
         手动改过日期（_dateTouched）就不再自动覆盖，避免把用户填的值冲掉。 */
      const r = lifeGoalRangeFor(val);
      _lifeGoalDraft.startDate = r.start;
      _lifeGoalDraft.targetDate = r.end;
    }
  }
  renderLifeGoalModal();
}
/* 周期 → 默认日期区间。月度按自然月（月初→月末），年度按自然年（到 12/31 为止）。
   ★ 但年度目标的**开始日默认是今天**，不是 1 月 1 日。
   10 月 27 日立一个年度目标，把开始日写成 1 月 1 日，等于替用户承认了
   「我一月就在推进这件事」—— 于是时间进度一上来就 82%、旁边红字写着
   「落后 32 点」，而他从 1 月到 9 月根本不在场。这是系统在替他欠一笔
   他从未承诺的债。他真想覆盖整年（今年一直在做，只是今天才记下来），
   把开始日改回 1 月 1 日就行 —— 默认值该诚实，不该替他表功也不该替他认账。 */
function lifeGoalRangeFor(horizon) {
  const today = getTodayStr();
  if (horizon === 'month') {
    const p = today.split('-');
    /* 下个月第 0 天 = 本月最后一天（不必自己判闰年 2 月） */
    const last = new Date(Number(p[0]), Number(p[1]), 0);
    const mm = String(last.getMonth() + 1);
    const dd = String(last.getDate());
    /* ★ 起始日必须是月初，不是今天。
       「这个月的月计划」= 整个自然月；写成今天起，就变成「27 号到 31 号」，
       习惯目标只数这 5 天的打卡 —— 用户说「这个月至少打卡 5 次」时，
       他心里数的是整个月，代码数的是后半段。 */
    return {
      start: p[0] + '-' + p[1] + '-01',
      end: p[0] + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd)
    };
  }
  /* 年度：从今天起，到今年 12 月 31 日为止。
     终点仍是自然年末 —— 「年度目标」要落进年复盘和九向展厅，必须和自然年对齐；
     但起点不替用户往前挪。 */
  return { start: today, end: today.slice(0, 4) + '-12-31' };
}
function lifeGoalDraftSelectHabit(val) {
  if (!_lifeGoalDraft) return;
  _lifeGoalDraft.habitId = val || null;
}
function lifeGoalDraftMeasure(i, key, val) {
  if (!_lifeGoalDraft) return;
  if (!_lifeGoalDraft.measure) _lifeGoalDraft.measure = { items: [] };
  const items = _lifeGoalDraft.measure.items || [];
  if (!items[i]) return;
  /* 数字字段留空要存 null 而不是 ''，否则 '' - 22 会算出 -22 */
  if (key === 'name') items[i][key] = val;
  else items[i][key] = (val === '' || val === null || val === undefined) ? null : Number(val);
}
function lifeGoalDraftAddMs() {
  if (!_lifeGoalDraft) return;
  const inp = document.getElementById('lgNewMs');
  const t = inp ? String(inp.value || '').trim() : '';
  if (!t) return;
  if (!Array.isArray(_lifeGoalDraft.milestones)) _lifeGoalDraft.milestones = [];
  _lifeGoalDraft.milestones.push({ id: newUid('ms'), text: t, done: false, doneAt: null });
  renderLifeGoalModal();
}
function lifeGoalDraftToggleMs(i) {
  if (!_lifeGoalDraft || !_lifeGoalDraft.milestones || !_lifeGoalDraft.milestones[i]) return;
  const m = _lifeGoalDraft.milestones[i];
  m.done = !m.done;
  m.doneAt = m.done ? getTodayStr() : null;
  renderLifeGoalModal();
}
function lifeGoalDraftDelMs(i) {
  if (!_lifeGoalDraft || !_lifeGoalDraft.milestones) return;
  _lifeGoalDraft.milestones.splice(i, 1);
  renderLifeGoalModal();
}
function lifeGoalDraftAddMeasure() {
  if (!_lifeGoalDraft) return;
  if (!_lifeGoalDraft.measure) _lifeGoalDraft.measure = { items: [] };
  if (!Array.isArray(_lifeGoalDraft.measure.items)) _lifeGoalDraft.measure.items = [];
  _lifeGoalDraft.measure.items.push({ name: '', from: null, current: null, to: null, unit: '' });
  renderLifeGoalModal();
}
function lifeGoalDraftDelMeasure(i) {
  if (!_lifeGoalDraft || !_lifeGoalDraft.measure || !_lifeGoalDraft.measure.items) return;
  _lifeGoalDraft.measure.items.splice(i, 1);
  renderLifeGoalModal();
}

/* ---------- 保存 ---------- */
function saveLifeGoal() {
  if (!_lifeGoalDraft) return;
  const d = _lifeGoalDraft;
  const title = String(d.title || '').trim();
  if (!title) { showToast('先写一句「想做成什么」'); return; }

  /* 数量上限（借 flow-dashboard 的 goal slots）：目标太多等于没有目标 */
  if (_lifeGoalEditing === '__new__' && d.horizon !== 'someday') {
    const max = LIFE_GOAL_MAX[d.horizon] || 5;
    /* 只数「同一周期」的 —— 去年的年度目标不该占今年 5 个名额。
       这是补录场景（新建时把 startDate 填成上个月）也该成立的判断。 */
    const _cycNew = lifeGoalCycleKey({ horizon: d.horizon, startDate: d.startDate || getTodayStr() });
    const same = lifeGoalsOf().filter(function (g) {
      return g && (g.horizon || 'year') === d.horizon && g.status !== 'achieved' && g.status !== 'dropped'
        && lifeGoalCycleKey(g) === _cycNew;
    });
    if (same.length >= max) {
      showToast(d.horizon === 'year' ? ('今年已经有 ' + max + ' 个目标了，先完成或放弃一个') : ('本月已经有 ' + max + ' 个目标了'));
      return;
    }
  }

  const isNew = _lifeGoalEditing === '__new__';
  let g;
  if (isNew) {
    g = {
      id: newUid('lgi'),
      uid: newUid('lg'),
      createdAt: new Date().toISOString(),
      updatedAt: Date.now()
    };
    lifeGoalsOf().push(g);
    if (!Array.isArray(appData.lifeGoalOrder)) appData.lifeGoalOrder = [];
    appData.lifeGoalOrder.push(g.uid);
  } else {
    g = lifeGoalById(_lifeGoalEditing);
    if (!g) { closeLifeGoalModal(); return; }
    g.updatedAt = Date.now();
  }
  /* 数值有没有真的改过：改过才更新 measureUpdatedAt。
     周视图的「N 个目标 14 天没更新数值」全靠这个时间戳 ——
     用 updatedAt 不行，改标题、改 why 也会刷新它，提示就永远不出现。 */
  const prevMeasure = (!isNew && g.measure) ? JSON.stringify(g.measure) : '';

  g.title = title;
  g.why = String(d.why || '').trim();
  g.areaId = d.areaId;
  g.horizon = d.horizon || 'year';
  g.status = d.status || 'active';
  g.startDate = d.startDate || getTodayStr();
  g.targetDate = g.horizon === 'someday' ? null : (d.targetDate || null);
  g.progressSource = d.progressSource || 'milestone';
  /* 里程碑 / 指标只存当前方式需要的，避免三种数据互相干扰 */
  g.milestones = (d.milestones || []).filter(function (m) { return m && String(m.text || '').trim(); });
  g.measure = { items: ((d.measure && d.measure.items) || []).filter(function (m) {
    return m && (m.name || m.from !== null || m.to !== null);
  }) };
  if (JSON.stringify(g.measure) !== prevMeasure) g.measureUpdatedAt = getTodayStr();
  /* 季度检查点：动过的那几条原样存，**没动过的重新插值**。
     为什么不能整组存：用户只勾了 Q3 的「看过了」，Q1/Q2/Q4 会被一并冻在
     当时的插值上；之后他发现指标区间填错、改成 22→16，那三条不会跟着变。
     判据是 touched（改过数值）/ doneAt（确认过）/ note（写过备注）三者之一。 */
  if (Array.isArray(d.checkpoints) && d.checkpoints.length) {
    const TF = window.TFGoal;
    const fresh = (TF && TF.lifeGoalCheckpointDefaults)
      ? TF.lifeGoalCheckpointDefaults(g, { today: getTodayStr() }) : [];
    const _spanS = String(g.startDate || '').slice(0, 10);
    const _spanE = String(g.targetDate || '').slice(0, 10);
    g.checkpoints = d.checkpoints.filter(function (cp) {
      if (!cp || !cp.at) return false;
      if (cp.doneAt || cp.touched || String(cp.note || '').trim()) return true;
      /* 改过开始/截止日之后，落到区间外的**没动过**的检查点直接丢掉：
         否则用户把开始日从 1 月改到 10 月，弹窗里仍留着 3 月、6 月、9 月
         三条永远确认不了的记录，而他会以为改日期没生效。 */
      if (_spanS && String(cp.at) < _spanS) return false;
      if (_spanE && String(cp.at) > _spanE) return false;
      return true;
    }).map(function (cp) {
      if (cp.doneAt || cp.touched || String(cp.note || '').trim()) return cp;
      const f = fresh.filter(function (x) { return x.q === cp.q; })[0];
      return Object.assign({}, cp, { target: f ? f.target : null });
    });
  } else {
    g.checkpoints = [];
  }
  /* 改绑习惯时把习惯侧的镜像一起改掉（见 syncHabitLink 的注释） */
  const _prevHabitId = g.habitId || null;
  g.habitId = d.habitId || null;
  syncHabitLink(g, _prevHabitId);
  /* 「这个周期要打几次卡」。留空 = 按习惯频率折算（null，不是 0 ——
     0 会让 00b 里的「>= 1」判断走空值，但语义上仍要能区分「没填」） */
  const _ht = Number(d.habitTarget);
  g.habitTarget = (d.habitTarget !== '' && isFinite(_ht) && _ht >= 1) ? Math.round(_ht) : null;
  g.manualPct = Number(d.manualPct) || 0;
  g.parentId = d.parentId || null;
  if (g.status === 'achieved' && !g.achievedAt) g.achievedAt = getTodayStr();
  if (g.status !== 'achieved') g.achievedAt = null;

  saveData();
  closeLifeGoalModal();
  /* 保存后把这条目标定位到眼前：新建的目标排在末尾，或者因为补录日期
     落进「以往」，或者被改成了「放下了」—— 任何一种都不该让用户找不到自己
     刚写的东西。落在折叠段里的话，先把那一段展开。 */
  _lgFocusId = g.id;
  if (g.status && g.status !== 'active') _lgDoneOpen = true;
  if (lifeGoalIsPast(g)) _lgArchOpen = true;
  renderLifeGoals();
  /* 周期块（周重点 / 检查点提示）读的是同一批目标，目标变了它也要重画 */
  if (typeof renderLifeWeek === 'function') renderLifeWeek();
  showToast(isNew ? '已加上' : '已保存');
}

/* ---------- 删除（5 秒撤销，不做确认弹窗）----------
   确认弹窗会被无脑点掉（「确定」就在手指下面），而删一个填了三个月复盘的目标
   是不可逆的。改成先摘出来、延迟落盘，5 秒内可点回。 */
let _lifeGoalUndoTimer = null;
function deleteLifeGoal(id) {
  const list = lifeGoalsOf();
  const idx = list.findIndex(function (g) { return g && idEq(g.id, id); });
  if (idx < 0) return;
  const g = list[idx];
  const orderIdx = Array.isArray(appData.lifeGoalOrder) ? appData.lifeGoalOrder.indexOf(g.uid) : -1;

  /* 关联任务不级联删：只把 lifeGoalId 清空，任务本身留在计划里 */
  const todos = appData.todos || [];
  const relinked = [];
  for (let i = 0; i < todos.length; i++) {
    if (todos[i] && idEq(todos[i].lifeGoalId, g.id)) {
      relinked.push(todos[i]);
      todos[i].lifeGoalId = null;
    }
  }
  list.splice(idx, 1);
  if (orderIdx >= 0) appData.lifeGoalOrder.splice(orderIdx, 1);
  /* 习惯不级联删：只把镜像摘掉。真源在目标身上，目标没了，习惯自然"不再被计量"；
     若还有别的目标用它，镜像改指那一个，复盘里仍能按领域算到它。 */
  (appData.habits || []).forEach(function (h) {
    if (!h || !idEq(h.lifeGoalId, g.id)) return;
    const other = goalsUsingHabit(h.id)[0];
    h.lifeGoalId = other ? other.id : null;
    h.updatedAt = Date.now();
  });

  _lifeGoalUndo = { goal: g, idx: idx, orderIdx: orderIdx, todos: relinked, timer: null };
  saveData();
  closeLifeGoalModal();
  renderLifeGoals();

  const n = relinked.length;
  showToast(n ? ('目标已删除 · ' + n + ' 个任务已解除关联 · 点此撤销') : '目标已删除 · 点此撤销', false, undoDeleteLifeGoal);
  /* 撤销窗口 12 秒，不是 6 秒：
     toast 一次只播一条，前面如果刚有「已保存」占着 3.4 秒，删除这条要排队 ——
     6 秒的窗口实际只剩 2 秒可点，等于没有。 */
  _lifeGoalUndo.timer = setTimeout(function () {
    _lifeGoalUndo = null;
  }, 12000);
}
function undoDeleteLifeGoal() {
  if (!_lifeGoalUndo) { showToast('已经删掉了'); return; }
  const u = _lifeGoalUndo;
  if (u.timer) clearTimeout(u.timer);
  lifeGoalsOf().splice(Math.min(u.idx, lifeGoalsOf().length), 0, u.goal);
  if (!Array.isArray(appData.lifeGoalOrder)) appData.lifeGoalOrder = [];
  if (u.orderIdx >= 0) appData.lifeGoalOrder.splice(u.orderIdx, 0, u.goal.uid);
  else appData.lifeGoalOrder.push(u.goal.uid);
  (u.todos || []).forEach(function (t) { if (t) t.lifeGoalId = u.goal.id; });
  /* 习惯镜像跟着回来：删除时被摘掉的那条，恢复后重新指回这个目标 */
  if (u.goal.habitId) syncHabitLink(u.goal, null);
  _lifeGoalUndo = null;
  saveData();
  renderLifeGoals();
  showToast('已恢复');
}


/* ---------- 任务侧的「服务于哪个目标」选择器 ----------
   一行 chips，不是下拉：四象限、标签、番茄都是 chips，这里插一个 select
   会让同一块面板出现两种控件语言。
   目标数量有上限（年 5 / 月 3），chips 不会长到放不下。 */
function lifeGoalPickerHtml(todoId, currentId) {
  /* 只列还在做的：已经做成 / 放下的目标不该再挂新的任务上去 ——
     挂上去也不会被谁看见，进度也不会再动。 */
  const goals = lifeGoalsOf().filter(function (g) {
    return g && (g.status || 'active') === 'active' && g.horizon !== 'someday';
  });
  if (!goals.length) {
    return '<span class="tf-hint" style="color:var(--text-light);font-size:var(--fs-caption)">还没有目标 · 去「目标」页建一个</span>';
  }
  /* 走 data-act 而不是内联 onclick：这个面板里其余控件（四象限、标签、番茄）
     全是 data-act，混一个内联会让「事件到底谁在处理」变得说不清。 */
  const chip = function (id, label, on) {
    return '<span class="tf-chip' + (on ? ' on' : '') + '" data-stop="1" data-act="setTodoLifeGoal"'
      + ' data-args=\'' + JSON.stringify([todoId, id === null ? null : id]) + '\'>'
      + escapeHtml(label) + '</span>';
  };
  let h = chip(null, '不挂', !currentId);
  goals.forEach(function (g) {
    const t = String(g.title || '（未命名）');
    h += chip(g.id, t.length > 8 ? t.slice(0, 8) + '…' : t, idEq(g.id, currentId));
  });
  return h;
}

/* 把任务挂到某个目标上 / 摘下来。只改一个字段，不动任务的其他属性。 */
function setTodoLifeGoal(todoId, goalId) {
  const t = (appData.todos || []).filter(function (x) { return x && idEq(x.id, todoId); })[0];
  if (!t) return;
  if (typeof forceSaveTodoDetail === 'function') forceSaveTodoDetail(todoId, true);   /* 先存住正在输入的内容 */
  t.lifeGoalId = goalId || null;
  t.updatedAt = Date.now();
  if (typeof touchRecord === 'function') touchRecord(t);
  saveData();
  if (typeof renderTodos === 'function') renderTodos();
  renderLifeGoals();
}


/* ---------- 卡片上直接勾里程碑 ----------
   数据只改 done/doneAt 两个字段，进度由 00b 现算，不缓存。 */
/* 里程碑奖励：每勾一条给 3 金币，但有三道闸，都是为了不搞坏经济平衡。
 *
 * 为什么是 3：现有「今日番茄目标达成」是 10 币/天。一个里程碑的重量大约
 * 是日目标的三分之一 —— 给多了会让人为了攒币去勾里程碑，目标体系就变味了。
 *
 * 三道闸：
 *   ① 幂等：`coinAwardedDate` 记第一次勾上的日期，取消再勾不再给。
 *      没有这道闸，「勾了取消再勾」就是无限刷币。
 *   ② 日上限：每天最多 4 次（12 币）。一次性勾掉 20 条历史里程碑，
 *      本来就不该按 20 条结算 —— 那是一次补录，不是 20 次完成。
 *   ③ 树没种就不给：coinEarn 自己会挡，这里不重复判断。
 */
const LIFE_MS_COIN = 3;
const LIFE_MS_COIN_DAILY_MAX = 4;

function lifeMilestoneCoin(g, m) {
  if (!m || !m.done) return 0;
  if (m.coinAwardedDate) return 0;          /* 闸①：这条已经结算过 */
  const today = getTodayStr();
  const day = appData.lifeGoalCoinDay;
  const used = (day && day.date === today) ? (Number(day.n) || 0) : 0;
  if (used >= LIFE_MS_COIN_DAILY_MAX) return 0;   /* 闸② */
  if (typeof coinEarn !== 'function') return 0;

  m.coinAwardedDate = today;
  appData.lifeGoalCoinDay = { date: today, n: used + 1 };
  try {
    coinEarn(LIFE_MS_COIN, 'gift', '里程碑 · ' + String(g.title || '目标'));
    if (typeof renderTreeSection === 'function') renderTreeSection();
    if (typeof renderTreeShop === 'function') renderTreeShop();
    if (typeof renderTimerTree === 'function') renderTimerTree();
  } catch (e) { if (window.__silent) window.__silent(e, '01eE:msCoin'); }
  return LIFE_MS_COIN;
}

/* 展开 / 收起某张卡片的全部里程碑 */
function toggleLifeGoalMsExpand(goalId) {
  if (!goalId) return;
  if (_lgMsExpand[goalId]) delete _lgMsExpand[goalId];
  else _lgMsExpand[goalId] = true;
  renderLifeGoals();
}

/* 卡片上开始加一条里程碑：只切一个 id，重渲后输入框自己出现并聚焦 */
function lgGoalStartMs(goalId) {
  _lgMsAddFor = goalId;
  renderLifeGoals();
  const inp = document.getElementById('lgMsNew');
  if (inp && inp.focus) inp.focus();
}
function lgGoalCancelMs() {
  if (!_lgMsAddFor) return;
  _lgMsAddFor = null;
  renderLifeGoals();
}
/* 提交一条里程碑。两条入口（回车 / 「加上」）走同一个函数，
   空文本当取消 —— 用户清空了再回车，意思就是不想加了。 */
function lgGoalAddMs(goalId, text) {
  /* 两条入口传参方式不同：回车（data-keydown）带 @value，按钮不带 ——
     按钮点了之后自己要回头去读那个输入框。委托运行时没有「取兄弟输入框」
     这种占位符（只有 @this / @event / @value / @checked），别硬编一个。 */
  const _inp = document.getElementById('lgMsNew');
  _lgMsAddFor = null;
  const g = lifeGoalById(goalId);
  const t = String(text != null ? text : (_inp ? _inp.value : '')).trim();
  if (!g || !t) { renderLifeGoals(); return; }
  if (!Array.isArray(g.milestones)) g.milestones = [];
  g.milestones.push({ id: 'ms_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, done: false });
  g.updatedAt = Date.now();
  /* 加完保持在这一张卡上：就地加第二条是常态（一次想好三步），
     重渲后输入框继续开着，光标落回去。 */
  _lgMsAddFor = g.id;
  saveData();
  renderLifeGoals();
  const inp = document.getElementById('lgMsNew');
  if (inp && inp.focus) inp.focus();
}

function toggleLifeGoalMs(goalId, msId) {
  const g = lifeGoalById(goalId);
  if (!g || !Array.isArray(g.milestones)) return;
  walk:
  for (let i = 0; i < g.milestones.length; i++) {
    const m = g.milestones[i];
    if (!m || String(m.id) !== String(msId)) continue;
    m.done = !m.done;
    m.doneAt = m.done ? getTodayStr() : null;
    /* 取消勾选**不退币** —— 退了就能靠「勾→退→勾」刷流水，
       而且币已经进账本，反悔应该是人的事，不是账本的事。 */
    if (!m.done) m.coinAwardedDate = m.coinAwardedDate || null;
    g.updatedAt = Date.now();
    var _done = m.done;
    var _coin = _done ? lifeMilestoneCoin(g, m) : 0;
    break walk;
  }
  /* 乐观更新：勾选后先就地打勾、把该行改成就绪态，再重渲。
     整段 DOM 重建是没有过渡的 —— 点下去到列表重画之间，屏幕上什么都不动，
     手感像「没点着」，于是人会再点一下，反而把刚勾的取消了。 */
  const _btn = document.querySelector('[data-act="toggleLifeGoalMs"][data-args*="' + String(msId) + '"]');
  if (_btn) {
    _btn.classList.toggle('done', !!_done);
    const _tk = _btn.querySelector('.lg-tick');
    if (_tk) _tk.classList.toggle('on', !!_done);
  }
  saveData();
  renderLifeGoals();
  if (typeof renderLifeWeek === 'function') renderLifeWeek();
  if (_coin) showToast('里程碑完成 · +' + _coin + '🪙');
  else if (_done) showToast('里程碑完成');
  else showToast('已取消勾选');
}

/* ---------- 了结一条目标 ----------
   ★ 这里以前是空白：年度 / 月度目标没有「达成」这个动作，用户勾完所有里程碑
     只能看到 100% 躺在「今年」里，想收尾只能删掉它。而「放下了」更是全站
     没有入口 —— 展厅里那个标签永远不会亮。目标系统必须能把一件事结束，
     不然它只是个待办清单，越用越长。 */
function settleLifeGoal(id, status) {
  const g = lifeGoalById(id);
  if (!g) return;
  const prev = g.status || 'active';
  if (prev === status) { showToast('它已经是这个状态了'); return; }
  g.status = status;
  g.settledAt = Date.now();
  g.updatedAt = Date.now();
  /* 了结后这条目标会从三段里搬进折叠条 —— 如果折叠条是收着的，
     用户眼前只是「卡片凭空没了」。所以主动展开一次：让结果落在看得见的地方，
     比弹个 toast 说「已收进已达成」有用得多。 */
  if (status !== 'active') _lgDoneOpen = true;
  /* 它搬进了折叠条，就把那一条滚到眼前 —— 卡片凭空消失比搬走更让人慌。 */
  _lgFocusId = id;
  saveData();
  renderLifeGoals();
  if (typeof renderLifeWeek === 'function') renderLifeWeek();
  /* 一步就能撤回：了结是情绪性动作，误触代价高（尤其「放下了」），
     而它调的只是 status 一个字段 —— 没有理由不给反悔的路。 */
  const _undo = function () {
    const x = lifeGoalById(id);
    if (!x) return;
    x.status = prev;
    x.settledAt = 0;
    x.updatedAt = Date.now();
    saveData();
    renderLifeGoals();
    if (typeof renderLifeWeek === 'function') renderLifeWeek();
    showToast('已撤销');
  };
  if (status === 'achieved') showToast('已收进「已达成」· 点此撤销', false, _undo);
  else if (status === 'dropped') showToast('已放下，收进「以往」· 点此撤销', false, _undo);
  else showToast(prev === 'active' ? '已回到在做' : '已改回在做');
}

function markLifeGoalDone(id) { settleLifeGoal(id, 'achieved'); }
function dropLifeGoal(id) { settleLifeGoal(id, 'dropped'); }

/* ---------- 分类（领域）管理 ----------
   默认给四个方向，但不写死：目标体系是「人生」的，用户的分类不会和预设一致。
   编辑方式是最小的那种 —— 一行一个输入框，改完即存，不搞拖排序（四个分类用不上）。 */
const LIFE_AREA_EMOJI_HINT = '💪🚀❤️🌱🎯💰📚🏃🎨🧘🏠🌍';

function openLifeAreaManager() {
  ensureLifeAreas();
  renderLifeAreaManager();
  showModal('lifeAreaModal');
}
function closeLifeAreaManager() { closeModal('lifeAreaModal'); }

function renderLifeAreaManager() {
  const box = document.getElementById('lgAreaBody');
  if (!box) return;
  const areas = appData.lifeAreas || [];
  let h = '';

  if (!areas.length) {
    h += '<div class="lg-help">还没有分类。下面加一个，或直接点「取消」用默认的四个方向。</div>';
  }
  areas.forEach(function (a, i) {
    const used = lifeGoalsOf().filter(function (g) { return g && g.areaId === a.id; }).length;
    h += '<div class="lg-area-row">';
    h += '<input class="lg-input lg-emoji-input" maxlength="2" value="' + escapeHtml(a.emoji || '') + '"'
      + ' data-change="lifeAreaRename" data-change-args=\'' + JSON.stringify([a.id, 'emoji', '@value']) + '\'>';
    h += '<input class="lg-input" value="' + escapeHtml(a.name || '') + '" maxlength="8" placeholder="分类名"'
      + ' data-change="lifeAreaRename" data-change-args=\'' + JSON.stringify([a.id, 'name', '@value']) + '\'>';
    /* 有目标时不给删除按钮，只显示计数 —— 一排「还有 N 个目标…」的灰字
       比分类本身还长，读起来像报错。真要删时会 toast 说明原因。 */
    h += used
      ? '<span class="lg-area-used">' + used + ' 个</span>'
      : '<button class="lg-x" data-act="lifeAreaDelete" data-args=\'' + JSON.stringify([a.id]) + '\' title="删除分类">×</button>';
    h += '</div>';
  });

  h += '<div class="lg-area-add">'
    + '<input class="lg-input lg-emoji-input" id="lgAreaNewEmoji" maxlength="2" placeholder="🙂">'
    + '<input class="lg-input" id="lgAreaNewName" maxlength="8" placeholder="新分类名，例如：💰 财务"'
    + ' data-keydown="lifeAreaAdd" data-keys="Enter">'
    + '<button class="lg-mini" data-act="lifeAreaAdd">加</button>'
    + '</div>';
  h += '<div class="lg-help">分类只是个归类标签。删掉一个分类不会删目标 —— 有目标时不允许删。</div>';

  h += '<div class="lg-modal-foot">'
    + '<button class="lg-btn" data-act="closeLifeAreaManager">关闭</button>'
    + '</div>';

  box.innerHTML = h;
}

function lifeAreaRename(id, field, val) {
  const a = (appData.lifeAreas || []).filter(function (x) { return x && x.id === id; })[0];
  if (!a) return;
  const v = String(val == null ? '' : val).trim();
  if (field === 'emoji') {
    a.emoji = v.slice(0, 2);
  } else {
    if (!v) return;                     /* 名字清空不写回，避免出现无名的分类 */
    a.name = v.slice(0, 8);
  }
  a.updatedAt = Date.now();
  saveData();
  renderLifeAreaManager();
  renderLifeGoals();
}

function lifeAreaDelete(id) {
  const list = appData.lifeAreas || [];
  const used = lifeGoalsOf().filter(function (g) { return g && g.areaId === id; }).length;
  if (used) { showToast('还有 ' + used + ' 个目标在这个分类下'); return; }
  const i = list.findIndex(function (x) { return x && x.id === id; });
  if (i < 0) return;
  list.splice(i, 1);
  if (_lifeGoalFilter === id) _lifeGoalFilter = 'all';
  saveData();
  renderLifeAreaManager();
  renderLifeGoals();
}

function lifeAreaAdd() {
  const emojiEl = document.getElementById('lgAreaNewEmoji');
  const nameEl = document.getElementById('lgAreaNewName');
  if (!nameEl) return;
  const raw = String(nameEl.value || '').trim();
  if (!raw) { showToast('给分类起个名字'); return; }
  /* 允许直接输入「💰 财务」这种带 emoji 的整串：拆成 emoji + 名字，
     省得用户先想「emoji 填哪」。 */
  let emoji = emojiEl ? String(emojiEl.value || '').trim() : '';
  let name = raw;
  const m = raw.match(/^(\p{Extended_Pictographic}\uFE0F?)\s*(.+)$/u);
  if (m) { emoji = emoji || m[1]; name = m[2]; }
  if (!emoji) emoji = '🎯';

  if (!Array.isArray(appData.lifeAreas)) appData.lifeAreas = [];
  const maxOrder = appData.lifeAreas.reduce(function (mx, a) { return Math.max(mx, Number(a.order) || 0); }, -1);
  appData.lifeAreas.push({
    id: newUid('area'),
    uid: newUid('area'),
    name: name.slice(0, 8),
    emoji: emoji.slice(0, 2),
    /* 100 起：自加方向永远排在九个固定方向之后 */
    order: 100 + maxOrder,
    updatedAt: Date.now()
  });
  saveData();
  renderLifeAreaManager();
  renderLifeGoals();
  showToast('已加上分类');
}

/* ---------- 排序模式与拖动 ----------
   为什么是「手柄 + 排序模式」而不是整卡长按：
   移动端的 touch-action 必须在触摸**开始前**定好。整卡长按要么拖不动
   （滚动先把触摸吞了），要么拖得动（touch-action:none）但卡片区域从此不能滚。
   只有独立手柄能设 touch-action:none 而不影响卡片本身的滚动与点击。 */
function toggleLifeGoalSort() {
  _lgSortMode = !_lgSortMode;
  renderLifeGoals();
}

/* 补齐 lifeGoalOrder：老数据/新建的目标可能不在数组里，不补齐的话
   indexOf 返回 -1，那个目标永远拖不动。 */
function _lgOrderComplete() {
  const uids = [];
  lifeGoalsOf().forEach(function (g) { if (g && g.uid) uids.push(g.uid); });
  let order = Array.isArray(appData.lifeGoalOrder) ? appData.lifeGoalOrder.slice() : [];
  order = order.filter(function (u) { return uids.indexOf(u) >= 0; });
  uids.forEach(function (u) { if (order.indexOf(u) < 0) order.push(u); });
  return order;
}

let _lgDrag = null;

function initLifeGoalDrag() {
  if (initLifeGoalDrag._bound) return;
  initLifeGoalDrag._bound = true;

  document.addEventListener('pointerdown', function (e) {
    if (!_lgSortMode) return;
    const t = e.target;
    const handle = (t && t.closest) ? t.closest('.lg-sort-handle') : null;
    if (!handle) return;
    const card = handle.closest('.lg-card');
    const group = card ? card.parentNode : null;
    if (!card || !group) return;
    /* 只有同段内的卡片能互换：跨段拖动等于改 horizon，
       那是「编辑」不是「排序」，硬拖过去 DOM 顺序会和三段的语义打架。 */
    e.preventDefault();
    const siblings = Array.prototype.slice.call(group.querySelectorAll('.lg-card'));
    _lgDrag = {
      card: card,
      group: group,
      before: siblings.map(function (c) { return c.getAttribute('data-uid'); }),
      moved: false
    };
    card.classList.add('lg-dragging');
    /* 指针捕获：手指滑出卡片范围时 pointermove 仍然打到手柄上。
       老浏览器没有这个方法，捕获失败也不影响拖动（只是滑出后会丢事件）。 */
    try { handle.setPointerCapture(e.pointerId); } catch (err) { if (window.__silent) window.__silent(err, '01eE:dragCapture'); }
  }, { passive: false });

  document.addEventListener('pointermove', function (e) {
    if (!_lgDrag) return;
    e.preventDefault();
    _lgDrag.moved = true;
    const y = e.clientY;
    const others = Array.prototype.slice.call(_lgDrag.group.querySelectorAll('.lg-card'))
      .filter(function (c) { return c !== _lgDrag.card; });
    let inserted = false;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        if (others[i].previousElementSibling !== _lgDrag.card) {
          _lgDrag.group.insertBefore(_lgDrag.card, others[i]);
        }
        inserted = true;
        break;
      }
    }
    if (!inserted && others.length && _lgDrag.card !== others[others.length - 1]) {
      _lgDrag.group.appendChild(_lgDrag.card);
    }
  }, { passive: false });

  const endDrag = function (save) {
    if (!_lgDrag) return;
    const d = _lgDrag;
    _lgDrag = null;
    d.card.classList.remove('lg-dragging');
    if (!save || !d.moved) return;
    const after = Array.prototype.slice.call(d.group.querySelectorAll('.lg-card'))
      .map(function (c) { return c.getAttribute('data-uid'); });
    const TF = window.TFGoal;
    if (TF && TF.mergeVisibleOrder) {
      /* 只合并「这一段里可见的」顺序 —— 其他段（以及被筛掉的领域）
         在 lifeGoalOrder 里的相对位置必须原样保留。 */
      appData.lifeGoalOrder = TF.mergeVisibleOrder(_lgOrderComplete(), d.before, after);
      saveData();
      showToast('顺序已保存');
    }
    renderLifeGoals();
  };
  document.addEventListener('pointerup', function () { endDrag(true); });
  document.addEventListener('pointercancel', function () { endDrag(false); });
}
initLifeGoalDrag();

/* ---------- 导出到 window（事件委托与跨模块调用都靠它）---------- */
window.renderLifeGoals = renderLifeGoals;
window.lifeGoalPickerHtml = lifeGoalPickerHtml;
window.toggleLifeGoalMs = toggleLifeGoalMs;
window.openLifeAreaManager = openLifeAreaManager;
window.closeLifeAreaManager = closeLifeAreaManager;
window.lifeAreaRename = lifeAreaRename;
window.lifeAreaDelete = lifeAreaDelete;
window.lifeAreaAdd = lifeAreaAdd;
window.setTodoLifeGoal = setTodoLifeGoal;
window.setLifeGoalFilter = setLifeGoalFilter;
window.openLifeGoalModal = openLifeGoalModal;
window.closeLifeGoalModal = closeLifeGoalModal;
window.saveLifeGoal = saveLifeGoal;
window.deleteLifeGoal = deleteLifeGoal;
window.undoDeleteLifeGoal = undoDeleteLifeGoal;
window.lifeGoalDraftInput = lifeGoalDraftInput;
window.lifeGoalDraftSet = lifeGoalDraftSet;
window.lifeGoalDraftSelectHabit = lifeGoalDraftSelectHabit;
window.lifeGoalDraftMeasure = lifeGoalDraftMeasure;
window.lifeGoalDraftAddMs = lifeGoalDraftAddMs;
window.lifeGoalDraftToggleMs = lifeGoalDraftToggleMs;
window.lifeGoalDraftDelMs = lifeGoalDraftDelMs;
window.lifeGoalDraftAddMeasure = lifeGoalDraftAddMeasure;
window.lifeGoalDraftDelMeasure = lifeGoalDraftDelMeasure;
/* 只读取引用，不提供替换 —— 01eF 的季度检查点要往草稿里写，但它不该有权
   把整份草稿换掉（那样弹窗里其他字段会被静默丢弃）。 */
window.lifeGoalDraftGet = function () { return _lifeGoalDraft; };
window.toggleLifeGoalSort = toggleLifeGoalSort;
window.toggleLifeArch = toggleLifeArch;
window.toggleLifeDone = toggleLifeDone;
window.rollLifeGoal = rollLifeGoal;
window.markLifeGoalDone = markLifeGoalDone;
window.dropLifeGoal = dropLifeGoal;
window.toggleLifeGoalMsExpand = toggleLifeGoalMsExpand;
window.lgGoalStartMs = lgGoalStartMs;
window.lgGoalCancelMs = lgGoalCancelMs;
window.lgGoalAddMs = lgGoalAddMs;
