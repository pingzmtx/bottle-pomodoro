/* C108 每个开关都要有回话
   —— 滑块只翻个位置，用户看不出「现在到底是开还是关」；设置页十几个开关，
   逐个写 onchange 容易漏，所以统一由 document 上的 change 代理播一条回执。

   判据：
     ① 打开 → 「已开启：<设置项标题>」；关掉 → 「已关闭：<…>」
     ② 标题只取第一行，不许把 .setting-desc 的说明文字一起念出来
     ③ 已经有专属提示的开关（蓝调模式）不许被通用回执顶掉、也不许弹两条
     ④ 不是 <label class="switch"> 里的复选框不播（避免别处的勾选变成噪音） */
(function () {
  var R = [];
  function ok(n, c, e) { R.push([n, !!c, e == null ? '' : String(e)]); }

  var said = [];
  var savedToast = window.showToast;
  var savedSettings = JSON.parse(JSON.stringify(appData.settings || {}));
  var savedDark = document.body.classList.contains('dark-mode');

  /* 包一层：既记录消息，又让真 showToast 跑一遍（_lastToastTs 靠它更新，避让逻辑才成立） */
  window.showToast = function (m) {
    said.push(String(m));
    return savedToast.apply(null, arguments);
  };

  function fire(id, checked) {
    var el = document.getElementById(id);
    if (!el) return null;
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el;
  }

  try {
    switchView('settings');

    /* A：打开 → 已开启：标题 */
    said.length = 0;
    var s = fire('setSound', true);
    ok('A0 找到「全局静音」开关', !!s);
    ok('A1 打开后有一条回执', said.length === 1, JSON.stringify(said));
    ok('A2 回执说清是开启、且带设置项名字',
      said.length === 1 && said[0].indexOf('已开启') === 0 && said[0].indexOf('全局静音') > 0, JSON.stringify(said));

    /* B：关掉 → 已关闭：标题 */
    said.length = 0;
    fire('setSound', false);
    ok('B1 关掉也有一条回执', said.length === 1, JSON.stringify(said));
    ok('B2 回执说清是关闭', said.length === 1 && said[0].indexOf('已关闭') === 0 && said[0].indexOf('全局静音') > 0,
      JSON.stringify(said));

    /* C：说明文字不许混进回执（标题只取第一行） */
    said.length = 0;
    fire('setSwipeNav', true);
    ok('C1 12小时制/滑动这类带说明的开关也有回执', said.length === 1, JSON.stringify(said));
    ok('C2 回执里有标题', said.length === 1 && said[0].indexOf('左右滑动切页面') > 0, JSON.stringify(said));
    ok('C3 回执里没有 .setting-desc 的说明文字',
      said.length === 1 && said[0].indexOf('靠边的') < 0 && said[0].indexOf('34px') < 0, JSON.stringify(said));
    ok('C4 回执长度收在标题级别', said.length === 1 && said[0].length <= 30, said[0] && said[0].length);

    /* D：蓝调模式自己有专属提示 —— 通用回执必须让路，一条动作只播一条 */
    said.length = 0;
    fire('setDarkMode', true);
    ok('D1 蓝调模式只播一条 ' + JSON.stringify(said), said.length === 1, JSON.stringify(said));
    ok('D2 播的是它自己的那条 ' + JSON.stringify(said), said.length === 1 && said[0].indexOf('蓝调模式') > 0, JSON.stringify(said));

    var darkAfter = document.body.classList.contains('dark-mode');
    /* 还原深色，别把后面断言拖黑 */
    var dm = document.getElementById('setDarkMode');
    if (dm) {
      dm.checked = false;
      dm.dispatchEvent(new Event('change', { bubbles: true }));
    }
    ok('D3 蓝调模式确实切过去了（前提成立）', darkAfter === true);

    /* E：不是开关的复选框不播 —— 计划页/弹窗里的勾选不该变成噪音 */
    said.length = 0;
    var plain = document.createElement('input');
    plain.type = 'checkbox';
    plain.id = 'c108_plain_check';
    document.body.appendChild(plain);
    plain.checked = true;
    plain.dispatchEvent(new Event('change', { bubbles: true }));
    ok('E1 普通复选框的勾选不播回执', said.length === 0, JSON.stringify(said));
    document.body.removeChild(plain);

    /* F：眼睛按钮（不是复选框）仍走它自己那条，不受这套代理影响 */
    said.length = 0;
    var prefs = getSortPrefs().todos;
    var before = !!prefs.hideDone;
    toggleTodoDoneHidden();
    ok('F1 眼睛仍只有自己那一条回执', said.length === 1, JSON.stringify(said));
    ok('F2 眼睛的回执不是「已开启/已关闭」通用文案',
      said.length === 1 && said[0].indexOf('已隐藏') === 0 || (said.length === 1 && said[0].indexOf('已显示') === 0),
      JSON.stringify(said));
    toggleTodoDoneHidden(); /* 还原 */
    ok('F3 眼睛开关回到原状', !!getSortPrefs().todos.hideDone === before);
  } finally {
    window.showToast = savedToast;
    appData.settings = savedSettings;
    if (!savedDark) document.body.classList.remove('dark-mode');
    else document.body.classList.add('dark-mode');
    try { renderTodos(); } catch (e) { /* 还原失败不该盖掉断言结果 */ }
  }

  return JSON.stringify(R);
})();
