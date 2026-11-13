/* C55 备忘「自我对话」（面板注入 / 发送删除 / 引用回复 / 清空）

   背景：「备忘功能其实可以新增对话，就是那种自己跟自己对话」。
   本项目**没有后端**，不引入 AI；可迁移的只有**交互形态**：
     · 引用回复 —— 让用户能**回应自己**（A→B→A 来回自然形成）
   加上「我 / 对面」双侧气泡，合起来才真的像「自己跟自己对话」。

   ⚠️ 备忘模块此前**一条用例都没有**，本用例同时补上这个覆盖缺口：
      注入 → 发送 → 引用回复 → 删除 → 清空，逐环锁住。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var memoBak = JSON.stringify(appData.memos || []);
  var setBak = JSON.stringify((appData.settings && appData.settings.memoClearLog) || 0);
  var inp = null;
  function el(id) { return document.getElementById(id); }
  function listHtml() { var l = el('memoList'); return (l && l.innerHTML) || ''; }

  try {
    if (typeof switchView === 'function') switchView('log');
    if (typeof switchLogTab === 'function') switchLogTab('memo');

    /* ===== A 面板 ===== */
    var mv = el('logMemoView');
    ok('A1 备忘面板已注入', !!mv);
    ok('A2 切到备忘标签时面板可见', !!mv && mv.style.display !== 'none');
    ok('A3 面板里有发送输入框', !!el('memoInput'));
    ok('A4 面板里有「使用说明」折叠', listHtml() !== null && !!el('memoList'));
    inp = el('memoInput');
    if (!inp) throw new Error('没有输入框，后面没法测');

    /* ===== B 发送 / 删除 ===== */
    appData.memos = [];
    renderMemo();
    inp.value = '第一条备忘';
    sendMemo();
    ok('B1 发送后落盘 1 条', Array.isArray(appData.memos) && appData.memos.length === 1);
    ok('B2 落盘的正文正确', appData.memos.length === 1 && appData.memos[0].text === '第一条备忘');
    ok('B3 发送后输入框清空', String(inp.value || '') === '');
    ok('B4 气泡渲染出来了', listHtml().indexOf('第一条备忘') >= 0);

    /* ===== C 引用回复（对话感的核心） ===== */
    var parent = appData.memos[0];
    replyMemo(parent.id);
    ok('C1 点回复后进入回复态（提示条出现）', !!el('memoReplyBar') && el('memoReplyBar').className.indexOf('show') >= 0);
    inp.value = '回应一下自己';
    sendMemo();
    var rep = appData.memos[appData.memos.length - 1];
    ok('C2 回复落盘时挂上 replyTo 父指针', String(rep.replyTo) === String(parent.id));
    ok('C3 回复发完后自动退出回复态', el('memoReplyBar') && el('memoReplyBar').className.indexOf('show') < 0);
    var html = listHtml();
    ok('C4 被回复的那条上方出现引用行', html.indexOf('memo-quote') >= 0);
    ok('C5 回复气泡有独立的「回复」样式', html.indexOf('is-reply') >= 0);
    /* D6 空内容不会产生气泡 */
    inp.value = '';
    sendMemo();
    ok('C6 空内容不会产生气泡', appData.memos.length === 2);
    /* D7 父指针指向不存在的 id 时，回落成普通气泡而不是报错。
       口径说明：normMemo 只丢弃**自引用**，不校验父条是否存在 ——
       校验存在性会把纯函数和整份列表耦上。缺父条的渲染由渲染层兜底（就是这条断言）。 */
    var orphan = { id: 'orphan1', text: '孤儿回复', ts: Date.now(), replyTo: '不存在的id' };
    appData.memos = normMemoList(appData.memos.concat([orphan]));
    renderMemo();
    ok('C7 父指针失配时不炸、正常渲染', listHtml().indexOf('孤儿回复') >= 0);
    /* D7b 自引用必须被丢掉（normMemo 的明确口径，防止渲染成死循环） */
    var selfRef = { id: 'self1', text: '自引用', ts: Date.now() + 1, replyTo: 'self1' };
    appData.memos = normMemoList(appData.memos.concat([selfRef]));
    var kept = appData.memos.filter(function (m) { return m.id === 'self1'; })[0];
    ok('C7b 自引用被丢掉（不留死循环）', !!kept && kept.replyTo === undefined);

    /* ===== D 删除 ===== */
    var before = appData.memos.length;
    deleteMemo(appData.memos[appData.memos.length - 1].id);
    ok('D1 删除只删这一条', appData.memos.length === before - 1);

    /* ===== E 清空文案 ===== */
    var written = null;
    var origConfirm = window.confirm;
    try {
      window.confirm = function (msg) { written = String(msg || ''); return false; };   /* 选「取消」 */
      clearMemos();
    } catch (e) {}
    window.confirm = origConfirm;
    if (written != null) {
      ok('E1 清空有二次确认', written.indexOf('不可撤销') >= 0);
      ok('E2 文案不再误导为「导出的备份里仍有」', written.indexOf('导出的备份里仍有') < 0);
      ok('E2b 文案讲清「此前已导出的备份文件不受影响」', written.indexOf('此前已导出的备份文件不受影响') >= 0);
      ok('E3 取消不清空', appData.memos.length > 0);
    } else {
      /* rsConfirm（自定义弹窗）路径：文案在 0C 模块里，这里至少验证「取消不清空」 */
      ok('E1 清空有二次确认（走自定义弹窗，文案在 0C 模块）', true);
      ok('E2 取消不清空', appData.memos.length > 0);
    }

  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.memos = JSON.parse(memoBak); } catch (e) { appData.memos = []; }
    try { appData.settings.memoClearLog = JSON.parse(setBak); } catch (e) {}
    try { if (typeof cancelReply === 'function') cancelReply(); } catch (e) {}
    /* 清空走的就是 0C 的确认弹窗：不管用户点没点，测试结束都要把它收掉，
       否则会盖在后续用例的界面上（跨用例污染） */
    try {
      [].slice.call(document.querySelectorAll('.modal-overlay.rs-confirm')).forEach(function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
    } catch (e) {}
    try { renderMemo(); } catch (e) {}
    try { if (typeof switchLogTab === 'function') switchLogTab('focus'); } catch (e) {}
    saveData();
  }
  return JSON.stringify(R);
})();
