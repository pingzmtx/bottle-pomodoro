/* C67 一批反馈（六项里的五项；「筛选归位」由 C64 的 D 段覆盖）

   ① 备忘：用户要的是**微信式双向气泡**（左边一条、右边一条、气泡颜色不同、可切身份），
      不是"给你几个引导问"。数据上加一条可选 side（'other'=左栏），缺省即右栏 → 零迁移。
   ② 日程表两次点击排计划：结束时间被"提醒时间 + 预计🍅"反算顶掉（点 07:50 会变成 07:43），
      且「预计结束」被 disabled 改不了。
   ③ 备忘气泡的 ↩/✕ 太小、不像按钮。
   ④「每日进步」用的 📈 在部分设备上 fallback，看着错位。
   ⑤ 日志卡里「记录名 == 计划名」时又重复出一枚计划胶囊；子任务 chip 只有 12px。

   ⚠️ 造数纪律：会改 appData.memos / settings，finally 全部原样恢复。
*/
(function () {
  var R = [];
  function ok(n, c, e) { R.push([n, !!c, e == null ? '' : String(e)]); }
  function px(tok) {
    var p = document.createElement('div');
    p.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:var(' + tok + ');';
    p.textContent = 'M';
    document.body.appendChild(p);
    var v = parseFloat(getComputedStyle(p).fontSize);
    p.remove();
    return v;
  }

  /* ================= A 备忘：双向气泡对话 ================= */
  var memBak = JSON.stringify(appData.memos || []);
  try {
    try { switchView('log'); if (typeof switchLogTab === 'function') switchLogTab('memo'); } catch (e) { /* 渲染失败由断言暴露 */ }
    if (typeof ensureMemoPanel === 'function') ensureMemoPanel();
    appData.memos = normMemoList([
      { id: 'c67m1', text: '今天的题有点难', ts: Date.now() - 3000 },
      { id: 'c67m2', text: '难就对了，说明在长本事', ts: Date.now() - 2000, side: 'other' }
    ]);
    if (typeof renderMemo === 'function') renderMemo();

    var rows = document.querySelectorAll('#memoList .memo-row');
    ok('A1 两条备忘渲染成两行', rows.length === 2);
    ok('A2 没写 side 的（老数据）留在右栏', rows.length === 2 && !rows[0].classList.contains('is-other'));
    ok('A3 side=other 的排左栏', rows.length === 2 && rows[1].classList.contains('is-other'));
    ok('A4 有「我 / 对面」身份切换按钮', !!document.getElementById('memoSideBtn'));

    /* 身份切换先归一到目标态再发：偶发失败时 _memSide 会停在上一次的值，
       导致 A6 发出去的那条带着 side=other。这里按「按钮文案」确认状态，不靠 sleep、不靠重试结果。 */
    function _ensureSide(wantOther) {
      var btn = document.getElementById('memoSideBtn');
      for (var g = 0; btn && g < 3; g++) {
        var isOther = btn.textContent.indexOf('对面') >= 0;
        if (isOther === !!wantOther) break;
        if (typeof toggleMemoSide === 'function') toggleMemoSide();
      }
      return btn ? btn.textContent : '';
    }
    _ensureSide(true); /* 我 → 对面 */
    var inp = document.getElementById('memoInput');
    if (inp) inp.value = '那明天继续';
    if (typeof sendMemo === 'function') sendMemo();
    var last = appData.memos[appData.memos.length - 1];
    ok('★ A5 切到「对面」后发的那条带 side=other（落到左栏）', !!last && last.side === 'other');

    _ensureSide(false); /* 对面 → 我 */
    var inp2 = document.getElementById('memoInput');
    if (inp2) inp2.value = '好的';
    /* 这条曾偶发：读到的是上一条（A5 那条 side='other'），因为 sendMemo 在输入框
       还没挂载时会静默早退。这里改成「比长度」，失败时能一眼分清是没追加还是追加了但带 side。
       不用 sleep、不用重试 —— 重试会把真正的竞态藏起来。 */
    var _n2 = appData.memos.length;
    if (typeof sendMemo === 'function') sendMemo();
    var last2 = appData.memos[appData.memos.length - 1];
    var _grew = appData.memos.length === _n2 + 1;
    ok('A6 切回「我」后发的那条不带 side（仍走右栏，零迁移口径）',
       _grew && !!last2 && last2.side === undefined,
       '追加=' + _grew + '/side=' + (last2 && last2.side) + '/输入框=' + !!inp2);

    /* ③ 气泡操作按钮：做成 ≥28px 的圆形按钮 */
    var row0 = document.querySelector('#memoList .memo-row');
    if (row0 && typeof toggleMemoBubble === 'function') toggleMemoBubble(row0);
    var del = row0 ? row0.querySelector('.memo-del') : null;
    var cs = del ? getComputedStyle(del) : null;
    ok('★ A7「✕ 删除」已是 ≥28px 的圆形按钮（不再是无边框小字）',
       !!cs && parseFloat(cs.width) >= 28 && parseFloat(cs.height) >= 28 &&
       cs.borderStyle !== 'none' && parseFloat(cs.borderRadius) > 0);
    var rep = row0 ? row0.querySelector('.memo-reply') : null;
    ok('A8「↩ 引用」同规格', !!rep && parseFloat(getComputedStyle(rep).width) >= 28);
  } finally {
    try { appData.memos = JSON.parse(memBak); } catch (e) { /* 原样恢复 */ }
    try { if (typeof renderMemo === 'function') renderMemo(); } catch (e) { /* 恢复后重画 */ }
  }

  /* ================= B 日程排计划：点两格 → 直接落成一段排期 =================
     起「提醒」与「排期」分开：点两格不再往表单里填起止时间，
     而是把这一段放进新增弹窗的排期草稿；提醒一栏保持独立。 */
  try {
    appData.todos = appData.todos || [];
    openAddTodoModal();
    ok('B1 刚打开弹窗时排期草稿是空的', (window.tbDraftExtraBlocks
      ? window.tbDraftExtraBlocks().length : -1) === 0,
      window.tbDraftExtraBlocks ? String(window.tbDraftExtraBlocks().length) : 'no-api');
    var rm = document.getElementById('addTodoRemind');
    ok('B2 提醒欄仍然独立存在（没被排期顶掉）', !!rm);
    ok('B3 表单里不再有「预计结束」输入框', !document.getElementById('addTodoEstEnd'));
  } catch (e) {
    ok('B 日程预填链路可执行（未抛异常）', false);
  } finally {
    try { closeModal('addTodoModal'); } catch (e) { /* 弹窗可能没开 */ }
  }

  /* ================= C「每日进步」的 emoji ================= */
  /* 传记/筛选区在「一条内容都没有」时会整块隐藏 —— 先造一条日记「每日进步」把它唤出来 */
  var diaBak = JSON.stringify(appData.diaries || {});
  try {
    var _today = getTodayStr();
    if (!appData.diaries) appData.diaries = {};
    if (!appData.diaries[_today]) appData.diaries[_today] = { review: {}, gratitude: { items: [] } };
    if (!appData.diaries[_today].review) appData.diaries[_today].review = {};
    appData.diaries[_today].review.progress = 'C67 造的一条每日进步（用完还原）';
    switchView('stats');
    if (typeof renderBioSection === 'function') renderBioSection();
  } catch (e) { /* 渲染失败由断言暴露 */ }
  var srcBtn = document.querySelector('button[title="日记里的「每日进步」"]');
  ok('★ C1「每日进步」改用渲染稳定的 🌱（📈 在部分设备会 fallback 成怪字形）',
     !!srcBtn && srcBtn.textContent.indexOf('🌱') >= 0);
  var statsHtml = (document.getElementById('view-stats') || {}).innerHTML || '';
  ok('C2 统计/传记区里不再有「📈 每日进步」', statsHtml.indexOf('📈 每日进步') < 0);
  try {
    appData.diaries = JSON.parse(diaBak);
    if (typeof renderBioSection === 'function') renderBioSection();
  } catch (e) { /* 原样恢复 */ }

  /* ================= D 日志卡：关联去重 + 子任务 chip ================= */
  if (typeof planSubsHtmlOf === 'function') {
    var h1 = planSubsHtmlOf([{ taskName: '测试', planTitle: '测试', planSubs: [{ t: '子任务二', d: false }] }]);
    ok('★ D1 记录名 == 计划名 → 不再重复弹一枚计划胶囊', h1.indexOf('plan-chip') < 0);
    /* ★ 子步骤 chip 恢复显示，但只摊「已完成」的（未完成压成一枚计数）。
       10-15 整块拿掉后，日志里彻底看不到这条记录做完了哪一步（需求 10-18 报的就是这个）。 */
    ok('D2 未完成的子步骤不摊名字（压成计数，避免每条卡都挂一串待办）',
       h1.indexOf('子任务二') < 0 && h1.indexOf('步未完成') >= 0);
    var h1b = planSubsHtmlOf([{ taskName: '测试', planTitle: '测试',
      planSubs: [{ t: '检查报税流程', d: true }, { t: '还没做的', d: false }] }]);
    ok('★ D2b 已完成的子步骤显示为 ✓ chip', h1b.indexOf('log-sub-chip') >= 0 && h1b.indexOf('✓ 检查报税流程') >= 0);
    ok('D2c ✓ chip 不带上未完成的那条', h1b.indexOf('还没做的') < 0);
    var h1c = planSubsHtmlOf([{ taskName: '测试', planTitle: '测试',
      planSubs: [{ t: '全部做完了', d: true }] }]);
    ok('D2d 全部完成 → 没有「N 步未完成」尾巴',
       h1c.indexOf('✓ 全部做完了') >= 0 && h1c.indexOf('步未完成') < 0);
    var h2 = planSubsHtmlOf([{ taskName: '番茄专注', planTitle: '数学复习', planSubs: [] }]);
    ok('D3 记录名 ≠ 计划名 → 计划胶囊照常显示（这才是它该出现的时候）',
       h2.indexOf('plan-chip') >= 0);
    ok('D4 独立记录（无计划无快照）整行不画', planSubsHtmlOf([{ taskName: '随手记' }]) === '');
  } else {
    ok('D planSubsHtmlOf 可用', false);
  }

  var chip = document.createElement('span');
  chip.className = 'log-sub-chip';
  chip.textContent = '子任务';
  document.body.appendChild(chip);
  ok('★ D5 子任务 chip 字号 = --fs-note(15px)，不再是 12px',
     Math.abs(parseFloat(getComputedStyle(chip).fontSize) - px('--fs-note')) < 0.1);
  var pchip = document.createElement('span');
  pchip.className = 'plan-chip';
  pchip.textContent = '计划';
  document.body.appendChild(pchip);
  ok('D6 计划胶囊同档放大', Math.abs(parseFloat(getComputedStyle(pchip).fontSize) - px('--fs-note')) < 0.1);
  chip.remove();
  pchip.remove();

  try { switchView('log'); } catch (e) { /* 复位视图 */ }
  return JSON.stringify(R);
})()
