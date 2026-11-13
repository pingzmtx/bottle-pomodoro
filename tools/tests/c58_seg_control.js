/* C58 分段控件（.seg-btn / .seg-group）：基础态 + 传记来源筛选

   这组控件此前**只定义了选中态**（.seg-btn.active 主色胶囊）而没写基础态，
   未选中的按钮因此落回浏览器默认样式：灰底 #EFEFEF + 2px outset 凸起边框 + 直角。
   同一组里"一个红胶囊 + 三个灰方块"，既不像一套控件，也不是设计规范里的样子。

   断言分三组：
     A 基础态 —— 未选中按钮不能是浏览器默认样式（这是本用例的核心，肉眼判"丑"太主观）
     B 功能没坏 —— 切换筛选后 active 转移、列表真的按来源过滤
     C 回归保护 —— 设置页那份自带完整内联的 .seg-btn 不受影响

   为什么用 computedStyle 而不是"看着对不对"：默认按钮样式在不同浏览器/主题下不同，
   只有把"边框宽 0、背景透明、圆角为胶囊"钉住，才算真的修掉。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var $ = function (s) { return document.querySelector(s); };
  var n$ = function (s) { return document.querySelectorAll(s).length; };
  var _bio = null, _diaries = null;
  try {
    _bio = appData.biographies;
    _diaries = appData.diaries;

    var dayOf = function (k) { var x = new Date(); x.setDate(x.getDate() - k); return getDateStr(x); };
    appData.biographies = [
      { date: dayOf(1), key: 'rec_50', title: '累计 50 个番茄', text: '累计完成 50 个番茄。', edited: false },
      { date: dayOf(3), key: 'streak_7', title: '连续 7 天', text: '连续 7 天都有专注记录。', edited: false }
    ];
    appData.diaries = {};
    appData.diaries[dayOf(2)] = { review: { progress: '今天把最难的那部分先做掉了。' } };
    appData.diaries[dayOf(4)] = { gratitude: { items: ['感谢今天顺利收尾。'] } };

    if (typeof switchView === 'function') switchView('log');
    if (typeof switchLogTab === 'function') switchLogTab('bio');

    var sec = document.getElementById('bioSection');
    ok('A0 传记块已渲染', !!sec && sec.innerHTML.length > 0);

    var segs = document.querySelectorAll('#bioSection .seg-btn');
    ok('A1 来源筛选是 4 个按钮', segs.length === 4);

    /* 取一个未选中的按钮 —— 它正是原先"灰底凸起方块"的那个 */
    var off = null;
    for (var i = 0; i < segs.length; i++) if (segs[i].className.indexOf('active') < 0) { off = segs[i]; break; }
    ok('A2 存在未选中的按钮', !!off);

    var cs = off ? getComputedStyle(off) : null;
    ok('A3 未选中按钮没有浏览器默认边框（outset）',
      !!cs && parseFloat(cs.borderTopWidth) === 0);
    ok('A4 未选中按钮背景透明（不是默认的 #EFEFEF）',
      !!cs && /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(cs.backgroundColor));
    ok('A5 未选中按钮是胶囊圆角',
      !!cs && parseFloat(cs.borderTopLeftRadius) >= 40);
    ok('A6 未选中按钮用辅助文字色（不是默认黑）',
      !!cs && cs.color !== 'rgb(0, 0, 0)');

    var grp = $('#bioSection .seg-group');
    var gc = grp ? getComputedStyle(grp) : null;
    ok('A7 容器是胶囊 + 有描边',
      !!gc && parseFloat(gc.borderTopWidth) > 0 && parseFloat(gc.borderTopLeftRadius) >= 40);
    ok('A8 容器底色不是页面底（与卡片分层）',
      !!gc && gc.backgroundColor !== 'rgb(245, 240, 232)');

    /* B 功能：切换筛选要真的过滤列表 */
    var before = sec.textContent || '';
    ok('B1 切之前能看到传记条目', before.indexOf('累计 50 个番茄') >= 0);

    var progBtn = null;
    /* 按钮文案 2026-10-17 由「🌱 每日进步」缩短为「🌱 进步」—— 四个按钮都带上条数后，
       「每日进步 2」在 360px 上会折行成两排。完整名字进了 title（长按可见），
       这里按短名匹配；若哪天改回去，indexOf('进步') 仍然成立。 */
    for (var j = 0; j < segs.length; j++) if (segs[j].textContent.indexOf('进步') >= 0) progBtn = segs[j];
    ok('B2 找到「进步」按钮', !!progBtn);
    if (progBtn) progBtn.click();

    var segs2 = document.querySelectorAll('#bioSection .seg-btn');
    var act = null;
    for (var k = 0; k < segs2.length; k++) if (segs2[k].className.indexOf('active') >= 0) act = segs2[k];
    ok('B3 点击后选中态转移到「进步」',
      !!act && act.textContent.indexOf('进步') >= 0);
    var after = (document.getElementById('bioSection') || {}).textContent || '';
    ok('B4 只显示「每日进步」来源的条目', after.indexOf('今天把最难的那部分先做掉了') >= 0);
    ok('B5 传记来源的条目被过滤掉', after.indexOf('累计 50 个番茄') < 0);

    if (typeof setBioSourceFilter === 'function') setBioSourceFilter('all');
    var back = (document.getElementById('bioSection') || {}).textContent || '';
    ok('B6 切回「全部」后两类条目都在',
      back.indexOf('累计 50 个番茄') >= 0 && back.indexOf('今天把最难的那部分先做掉了') >= 0);

    /* C 回归保护：设置页那份 .seg-btn 自带完整内联，不应被这次改动影响 */
    var psAll = document.querySelectorAll('#progressStyleSeg .seg-btn');
    var psOff = null;
    for (var m = 0; m < psAll.length; m++) if (psAll[m].className.indexOf('active') < 0) { psOff = psAll[m]; break; }
    ok('C0 设置页「进度样式」有两个分段按钮', psAll.length === 2);
    if (psOff) {
      var pc = getComputedStyle(psOff);
      /* 取未选中的那个：选中的是主色胶囊，本来就不该透明 */
      ok('C1 设置页未选中按钮仍是透明底（内联优先，未被全局基础态改写）',
        /rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(pc.backgroundColor));
      ok('C2 设置页按钮仍是 0 边框', parseFloat(pc.borderTopWidth) === 0);
      ok('C3 设置页按钮仍是胶囊圆角', parseFloat(pc.borderTopLeftRadius) >= 40);
    }
  } catch (e) {
    R.push(['⚠️ 用例抛异常：' + (e && e.message ? e.message : e), false]);
  } finally {
    try {
      appData.biographies = _bio;
      appData.diaries = _diaries;
      if (typeof switchLogTab === 'function') switchLogTab('focus');
      if (typeof switchView === 'function') switchView('timer');
    } catch (e2) {}
  }
  return JSON.stringify(R);
})();
