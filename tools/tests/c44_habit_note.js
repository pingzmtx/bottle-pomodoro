/* C44 的页面侧断言体：习惯页展示「备注」。

   习惯页：列表行不显示备注。

   根因（实证）：习惯详情弹窗里的备注读写一直是对的（保存往返 OK），
        但 `renderHabits()` 的列表行只渲染 名字 + 连续天数，**从建库起就没渲染过 h.note**
        （计划行有 `.todo-detail-preview`，习惯行没有对应物）→ 用户填了备注在习惯页看不到。

   修法：`renderHabits()` 在 `.habit-info` 内、`.habit-streak` 之后补一行
        `.habit-note`（与 `.todo-detail-preview` 同款：单行省略号、仅非空时占位）。

   全程用真状态跑，**恢复放在 finally**：断言抛异常也不留下假习惯。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var bakH = null, bakL = null;
  var ID = 'c44_probe';
  try {
    if (typeof appData === 'undefined' || !appData.habits) {
      return JSON.stringify([['① appData.habits 可用', false]]);
    }
    bakH = JSON.parse(JSON.stringify(appData.habits));
    bakL = JSON.parse(JSON.stringify(appData.habitLogs || {}));

    // 造两条：一条有备注（含 HTML 特殊字符，验转义），一条没有
    appData.habits.length = 0;
    appData.habitLogs = {};
    appData.habits.push({ id: ID, name: 'PROBE_有备注', note: '每天 20:00 <b>别断</b>', growthPoints: 3 });
    appData.habits.push({ id: ID + '_2', name: 'PROBE_无备注', note: '', growthPoints: 0 });

    renderHabits();
    var list = document.getElementById('habitList');
    var html = list ? list.innerHTML : '';
    var rows = list ? list.querySelectorAll('.habit-item') : [];

    // ① 有备注的行把备注印出来
    ok('①a 习惯行渲染出备注文字', html.indexOf('每天 20:00') > -1);
    ok('①b 备注放在 .habit-note 里', !!document.querySelector('.habit-item[data-id="' + ID + '"] .habit-note'));

    // ② 备注里的 HTML 走转义，不当标签注入
    var noteEl = document.querySelector('.habit-item[data-id="' + ID + '"] .habit-note');
    ok('②a 备注中的 <b> 以文本形式呈现（不是真标签）', noteEl && noteEl.textContent.indexOf('<b>别断</b>') > -1);
    ok('②b 备注里没有生成真的 <b> 节点', noteEl ? noteEl.querySelectorAll('b').length === 0 : false);

    // ③ 没填备注的行不占位（不留空行）
    var plain = document.querySelector('.habit-item[data-id="' + ID + '_2' + '"]');
    ok('③ 没填备注的习惯行里没有 .habit-note', plain ? !plain.querySelector('.habit-note') : false);

    // ④ 顺序：备注在「连续N天」下面
    var infoHtml = document.querySelector('.habit-item[data-id="' + ID + '"] .habit-info').innerHTML;
    ok('④ 备注排在连续天数之后', infoHtml.indexOf('habit-streak') > -1 && infoHtml.indexOf('habit-streak') < infoHtml.indexOf('habit-note'));

    // ⑤ 走编辑弹窗改备注 → 列表行跟着变（真链路，不是只测渲染）
    //   详情页不再自带备注输入框：编辑只留一个入口（用户 10-30 提的「两个编辑界面」）
    openHabitDetail(ID);
    var detBody = document.getElementById('habitDetailBody');
    ok('⑤0 详情页不再有第二套编辑表单', !document.getElementById('habitDetailName')
      && !document.getElementById('habitDetailNote') && !document.getElementById('habitDetailFreq'),
      detBody ? 'detail has form' : 'no detail');
    ok('⑤0b 详情页只读显示已有备注', detBody && detBody.textContent.indexOf('每天 20:00') >= 0);
    closeModal('habitDetailModal');
    openHabitEditModal(ID);
    var ta = document.getElementById('habitEditNote');
    ok('⑤a 编辑弹窗预填已有备注', ta && ta.value === '每天 20:00 <b>别断</b>');
    if (ta) ta.value = '改完的备注';
    saveHabitEdit();
    ok('⑤b 保存后备注写进数据', appData.habits[0].note === '改完的备注');
    ok('⑤c 列表行立刻显示新备注', document.getElementById('habitList').innerHTML.indexOf('改完的备注') > -1);

    // ⑥ 清空备注后行里不再有备注块
    appData.habits[0].note = '';
    renderHabits();
    ok('⑥ 清空后备注块消失', !document.querySelector('.habit-item[data-id="' + ID + '"] .habit-note'));
  } catch (e) {
    ok('用例执行无异常', false);
  } finally {
    try {
      appData.habits.length = 0;
      (bakH || []).forEach(function (h) { appData.habits.push(h); });
      appData.habitLogs = bakL || {};
      if (typeof renderHabits === 'function') renderHabits();
      if (typeof closeModal === 'function') closeModal('habitDetailModal');
    } catch (e) { /* 恢复失败不掩盖断言结果 */ }
  }
  return JSON.stringify(R);
})();
