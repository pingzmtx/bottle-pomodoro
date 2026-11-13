/* C66 可读性三处

   ① 日记 / 复盘「字太小，看个日记都费劲」
      —— 输入框原来是 --fs-body(16px)，那是**可读下限**，不该用来装自己反复回看的长文。
         现取 --fs-title(17px)（HIG 的 body 就是 17pt；16px 对应 callout）。
         已写进 DESIGN.md §3.2 + §Do's 第 9 条。

   ② 「今日反馈」默认折叠 —— 用户要的是默认展开，收起改由用户主动点。

   ③ 日程表那行「💡 展开说明」**一直露在标题行下面**
      —— 原因是它被插在 .tb-paper-keys 与 .tb-paper-body 之间，
         而折叠时只隐藏 body，所以它单独留在外面。现改为插进 body 内部，跟着一起收放。
         顺带把 12px 的说明文字提到 --fs-note(15px)。

   ⚠️ 本用例只读 DOM / computed style，不改数据；渲染会切视图，finally 复原。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }

  /* 量令牌的**实际计算值**：自定义属性在 Chrome 里返回的是原始 calc 字符串，
     不能直接 parse，必须挂一个元素让它算出来。 */
  function pxOf(tok) {
    var p = document.createElement('div');
    p.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:var(' + tok + ');';
    p.textContent = 'M';
    document.body.appendChild(p);
    var v = parseFloat(getComputedStyle(p).fontSize);
    p.remove();
    return v;
  }

  var tabBak = (typeof currentLogTab !== 'undefined') ? currentLogTab : null;
  var dateBak = (typeof currentDiaryDate !== 'undefined') ? currentDiaryDate : null;

  try {
    switchView('log');
    currentLogTab = 'diary';
    currentDiaryDate = getTodayStr();
    if (typeof renderDiarySingle === 'function') renderDiarySingle();
  } catch (e) { /* 渲染失败由下面的断言暴露 */ }

  var body = pxOf('--fs-body'), title = pxOf('--fs-title'), notePx = pxOf('--fs-note');

  /* ===== A 长文读写区 17px ===== */
  var ta = document.querySelector('#diarySingleView .diary-field textarea');
  var gi = document.querySelector('#diarySingleView .gratitude-row input');
  ok('A1 日记正文 = --fs-title(17px)，不再挂在 16px 下限上',
    !!ta && Math.abs(parseFloat(getComputedStyle(ta).fontSize) - title) < 0.1);
  ok('A2 且确实比正文下限 --fs-body 大一档', title > body);
  ok('A3 感恩日记输入框同档（不要一个 16 一个 17）',
    !!gi && Math.abs(parseFloat(getComputedStyle(gi).fontSize) - title) < 0.1);

  /* ===== B 今日反馈默认展开 ===== */
  var fbHead = null;
  document.querySelectorAll('#diarySingleView .diary-fold-head').forEach(function (h) {
    if (h.textContent.indexOf('今日反馈') >= 0) fbHead = h;
  });
  ok('B1 今日反馈的标题行默认带 open', !!fbHead && fbHead.classList.contains('open'));
  ok('B2 折叠体默认可见（未填也展开）',
    !!fbHead && !!fbHead.nextElementSibling &&
    getComputedStyle(fbHead.nextElementSibling).display !== 'none');

  /* ===== C 日程说明行收进折叠体 ===== */
  var tn = document.querySelector('.tb-create-note');
  ok('C1 说明行挂在 .tb-paper-body 内部（跟着「今日计划」一起收放）',
    !!tn && !!tn.parentElement && tn.parentElement.classList.contains('tb-paper-body'));
  ok('C2 不再夹在标题行 .tb-paper-keys 之后',
    !tn || !tn.previousElementSibling ||
    tn.previousElementSibling.className.indexOf('tb-paper-keys') < 0);
  ok('C3 说明行字号 = --fs-note(15px)，不再是 12px',
    !!tn && Math.abs(parseFloat(getComputedStyle(tn).fontSize) - notePx) < 0.1);

  try {
    if (tabBak !== null) currentLogTab = tabBak;
    if (dateBak !== null) currentDiaryDate = dateBak;
    switchView('log');
  } catch (e) {}

  return JSON.stringify(R);
})()
