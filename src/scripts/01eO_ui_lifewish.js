/* ============================================================
   人生愿望清单（Bucket List）
   ------------------------------------------------------------
   函数索引（TOC）：wishList/wishById/openLifeWish/closeLifeWish/renderLifeWish/wishAdd/wishToggle/wishDel

   ★ 设计约束（不是没做完，是刻意不做）：
     1. **不参与任何进度计算。** 不进九宫格、不进进度一览、不算完成率。
        写 30 条实现 3 条，那 3 条是成就，不是 10%。手账原页上
        「愿望清单」和「年计划」是两张纸，正是这个意思。
     2. **不设上限。** 纸上的愿望清单是写满了再翻页，不是「最多 15 条」。
     3. **没有截止日期、没有分类、没有优先级。** 一加这些它就变成
        第二个待办列表，而待办列表已经有三个了。
 * 函数索引（TOC）：_wEsc/wishList/wishById/openLifeWish/closeLifeWish/renderLifeWish/wishRowHtml/wishAdd/wishToggle/wishDel
   ============================================================ */
/* 转义统一委托给 escapeHtml（01e_engine_ui.js）—— 不在本文件养第二套。 */
function _wEsc(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wishList() {
  if (!Array.isArray(appData.wishes)) appData.wishes = [];
  return appData.wishes;
}
function wishById(id) {
  const list = wishList();
  for (let i = 0; i < list.length; i++) if (list[i] && idEq(list[i].id, id)) return list[i];
  return null;
}

function openLifeWish() {
  renderLifeWish();
  showModal('lifeWishModal');
}
function closeLifeWish() {
  closeModal('lifeWishModal');
}

function renderLifeWish() {
  const box = document.getElementById('lifeWishBody');
  if (!box) return;
  const list = wishList();

  /* 分两段：还没做的在上，做到了的在下并收进可折叠段。
     ★ 不用「已完成 3/30」这种进度条 —— 见文件头的约束 1。 */
  const todo = [];
  const did = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (!w) continue;
    (w.done ? did : todo).push(w);
  }

  let h = '<p class="rv-pick-note">想到就写下来，做不做、什么时候做都不重要。'
    + '这里的东西不计入任何进度。</p>';

  h += '<div class="wish-add">'
    + '<input class="rv-input" type="text" id="wishInput" maxlength="60"'
    + ' placeholder="想做的事…" data-keydown="wishAdd" data-keys="Enter">'
    + '<button class="rv-btn rv-btn--pri" data-act="wishAdd">加</button>'
    + '</div>';

  if (!list.length) {
    h += '<p class="rv-empty">还没有写。想到什么写什么，不会有人催。</p>';
  } else {
    h += '<div class="wish-list">';
    for (let i = 0; i < todo.length; i++) h += wishRowHtml(todo[i]);
    h += '</div>';
    if (did.length) {
      h += '<div class="wish-done-h">已经做到的 ' + did.length + ' 件</div>';
      h += '<div class="wish-list wish-list--done">';
      for (let i = 0; i < did.length; i++) h += wishRowHtml(did[i]);
      h += '</div>';
    }
  }

  box.innerHTML = h;
  const foot = document.getElementById('lifeWishFoot');
  if (foot) foot.innerHTML = '<button class="rv-btn" data-act="closeLifeWish">关闭</button>';
}

function wishRowHtml(w) {
  let h = '<div class="wish-row' + (w.done ? ' on' : '') + '">';
  h += '<button class="wish-box" data-act="wishToggle" data-args=\'["' + _wEsc(w.id) + '"]\''
    + ' aria-label="' + (w.done ? '取消勾选' : '标记做到') + '">'
    + (w.done ? '✓' : '') + '</button>';
  h += '<span class="wish-t">' + _wEsc(w.text) + '</span>';
  /* 做到的那天才写日期。勾的时候没记日期（老数据）就不显示，不补今天。 */
  if (w.done && w.doneAt) h += '<span class="wish-d">' + _wEsc(w.doneAt) + '</span>';
  h += '<button class="wish-x" data-act="wishDel" data-args=\'["' + _wEsc(w.id) + '"]\''
    + ' aria-label="删除">×</button>';
  h += '</div>';
  return h;
}

function wishAdd() {
  const el = document.getElementById('wishInput');
  if (!el) return;
  const text = (el.value || '').trim();
  if (!text) return;
  /* 重复内容不拦 —— 人真的会隔两年又写下同一件事，那本身是信息。 */
  const list = wishList();
  const id = newUid('ws');
  list.push({
    id: id,
    uid: id,
    text: text,
    done: false,
    doneAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now()
  });
  el.value = '';
  saveData();
  renderLifeWish();
  /* 加完保持输入态：写愿望通常一口气写好几条 */
  const next = document.getElementById('wishInput');
  if (next) next.focus();
}

function wishToggle(id) {
  const w = wishById(id);
  if (!w) return;
  w.done = !w.done;
  w.doneAt = w.done ? getTodayStr() : null;
  w.updatedAt = Date.now();
  saveData();
  renderLifeWish();
}

function wishDel(id) {
  const list = wishList();
  for (let i = 0; i < list.length; i++) {
    if (list[i] && idEq(list[i].id, id)) {
      list.splice(i, 1);
      saveData();
      renderLifeWish();
      return;
    }
  }
}

window.openLifeWish = openLifeWish;
window.closeLifeWish = closeLifeWish;
window.wishAdd = wishAdd;
window.wishToggle = wishToggle;
window.wishDel = wishDel;
