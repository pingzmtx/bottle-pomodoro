/* C50 左右滑动切视图：中间能切、靠边不抢、可整体关闭
   「很多浏览器左右滑会有前进后退，然后而且在这个界面左右滑还会切换界面」
   → 同一个手势同时被浏览器（边缘滑动 → 前进/后退）和应用（整屏左右滑 → 切视图）吃掉。

   修法：
     ① E4-02 手势的左右排除带 24px → 34px（浏览器自带的边缘手势带约 20~30px，
        24px 太窄会两边同时响应）；
     ② 新增 settings.swipeNav，关掉后整段手势直接退出，只用底部导航切页；
     ③ 0B 写 hash 改为优先 replaceState（原来的 location.hash = view 会往历史栈里
        塞记录，切一次页面历史 +1 → 浏览器「返回」变成在应用内来回切页）。

   本用例覆盖 ①② 的可自动化部分：手势的**命中范围**与**开关**。
   ⚠️ 防假绿：③~⑦ 断言「不切页」，单独看它们就算手势整体坏掉也会通过；
      所以 ① ② 先证明手势真的会切，⑩ 再证明「关掉」不是被手势坏掉顶替的。

   同步用例（run_smoke 不支持异步）：手势自带 450ms 冷却，凡是**期望切页**的那几次
   前面必须 busy-wait 过一次冷却窗口，否则会被冷却挡掉判成失败。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  function W() { return document.documentElement.clientWidth || window.innerWidth || 0; }
  /* 同步等过手势冷却（GAP=450ms）。占住主线程是刻意的：本用例只有几秒，
     换来的好处是能留在 run_smoke 的「返回 JSON 字符串」同步契约里。 */
  function waitGap() { var t0 = Date.now(); while (Date.now() - t0 < 520) { /* busy */ } }
  var navEl = document.querySelector('.nav-item.active');
  var viewBak = (navEl && navEl.dataset) ? navEl.dataset.view : 'timer';
  var setBak = appData.settings.swipeNav;

  /* 合成触摸事件：TouchEvent 构造器在部分 WebView 不可用，用普通 Event + 定义属性最稳。 */
  function touchEv(type, x, y, ended) {
    var ev;
    try { ev = new Event(type, { bubbles: true, cancelable: true }); }
    catch (e) { ev = document.createEvent('Event'); ev.initEvent(type, true, true); }
    var list = ended ? [] : [{ clientX: x, clientY: y }];
    var ch = [{ clientX: x, clientY: y }];
    try { Object.defineProperty(ev, 'touches', { value: list, configurable: true }); } catch (e2) {}
    try { Object.defineProperty(ev, 'changedTouches', { value: ch, configurable: true }); } catch (e3) {}
    return ev;
  }
  function swipe(x0, y0, x1, y1) {
    var t = document.body;
    t.dispatchEvent(touchEv('touchstart', x0, y0, false));
    t.dispatchEvent(touchEv('touchmove', x1, y1, false));
    t.dispatchEvent(touchEv('touchend', x1, y1, true));
  }
  function cur() {
    var a = document.querySelector('.nav-item.active');
    return a && a.dataset ? a.dataset.view : '(无)';
  }

  try {
    var w = W();
    ok('① 视口宽度可用（>200，否则本用例无意义）', w > 200);

    /* ① 中段左滑 → 下一页（计时 → 计划）——先证明手势确实会切页 */
    appData.settings.swipeNav = true;
    switchView('timer');
    waitGap();
    swipe(Math.round(w * 0.75), 400, Math.round(w * 0.25), 400);
    ok('①b 中段左滑切到下一页（timer → plan）', cur() === 'plan');

    /* ② 中段右滑 → 上一页（计划 → 计时） */
    waitGap();
    swipe(Math.round(w * 0.25), 400, Math.round(w * 0.75), 400);
    ok('② 中段右滑切回上一页（plan → timer）', cur() === 'timer');

    /* ③ 靠左边缘起手（x=20 < 34）→ 留给浏览器返回手势，本应用不许切页 */
    switchView('timer');
    waitGap();
    swipe(20, 400, 20 + Math.round(w * 0.6), 400);
    ok('③ 左边缘 20px 起手右滑不切页（让给浏览器前进/后退）', cur() === 'timer');

    /* ④ 靠右边缘起手（x = w-20）→ 同样不切页 */
    waitGap();
    swipe(w - 20, 400, w - 20 - Math.round(w * 0.6), 400);
    ok('④ 右边缘 20px 起手左滑不切页', cur() === 'timer');

    /* ⑤ 顶部起手（y = 10 < 24）：让出状态栏/通知栏下拉 */
    waitGap();
    swipe(Math.round(w * 0.75), 10, Math.round(w * 0.25), 10);
    ok('⑤ 顶部 10px 起手不切页（让出下拉通知区）', cur() === 'timer');

    /* ⑥ 竖滑为主（dx=60 / dy=240）→ 让位给页面滚动，不当成翻页 */
    waitGap();
    swipe(Math.round(w * 0.75), 300, Math.round(w * 0.75) - 60, 540);
    ok('⑥ 竖滑为主时不翻页（|dx| < |dy| × 1.4）', cur() === 'timer');

    /* ⑦ 位移不够（dx=30 < 42）→ 不翻页 */
    waitGap();
    swipe(Math.round(w * 0.75), 400, Math.round(w * 0.75) - 30, 400);
    ok('⑦ 位移 30px 不够灵敏阈值，不翻页', cur() === 'timer');

    /* ⑧ 设置里关掉 swipeNav → 中段大位移也不切页 */
    waitGap();
    appData.settings.swipeNav = false;
    swipe(Math.round(w * 0.75), 400, Math.round(w * 0.25), 400);
    ok('⑧ 关掉「左右滑动切页面」后中段左滑不切页', cur() === 'timer');

    /* ⑨ 关掉的只是本手势：底部导航/switchView 必须照常能用（别把切页一起关了） */
    switchView('log');
    ok('⑨ 关掉后仍能切页（switchView 未被牵连）', cur() === 'log');

    /* ⑩ 反向验证：重新打开 → 又能切。排除「⑧ 是因为手势整体坏了才通过」 */
    switchView('timer');
    waitGap();
    appData.settings.swipeNav = true;
    swipe(Math.round(w * 0.75), 400, Math.round(w * 0.25), 400);
    ok('⑩ 重新打开后中段左滑恢复切页（排除 ⑧ 假绿）', cur() === 'plan');

    /* ⑪ 设置页开关控件存在、默认打开、且和 settings 同步 */
    var sw = document.getElementById('setSwipeNav');
    ok('⑪ 设置页有「左右滑动切页面」开关', !!sw);
    ok('⑪b 默认打开', !!sw && sw.checked === true);
    ok('⑪c 开关与 settings.swipeNav 同源（关掉后 saveSettings 收得进去）',
      !!sw && appData.settings.swipeNav !== false);
  } catch (e) {
    R.push(['JS 异常：' + (e && e.message), false]);
  } finally {
    try {
      appData.settings.swipeNav = (setBak === undefined ? true : setBak);
      switchView(viewBak || 'timer');
      if (typeof saveData === 'function') saveData();
    } catch (e2) { /* 收尾失败不掩盖断言结果 */ }
  }
  return JSON.stringify(R);
})();
