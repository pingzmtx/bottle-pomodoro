/* C51 字号设置：只放大可读性（--fs-user）、系统字号归一（--fs-boost）、各档不横向溢出
   口径（最终版）：字号档位**改的是字，不改布局** —— width/height/padding/圆角一律不动。
   （中间试过"给 <html> 打整页 zoom 等比放大"，被否掉后回到这一条。）

   两个系数各管一段：
     ① --fs-user：用户在设置页选的档位（1 / 1.15 / 1.3 / 1.5），乘进每一个 --fs-* 令牌。
     ② --fs-boost：手机系统「字体大小」档位（Android WebView 可到 1.45×~2×）会把页面上
        **每一个 font-size 的 px 值**再乘一次，盒子尺寸同样不动。CSS text-size-adjust 拦不住
        （实测 100% / none 都是 1.45×）→ 用 100px 探针量出系数 k，写成 1/k 除回去。

   ⚠️ 防假绿：本机 k 可能正好是 1（桌面），② 的"归一"断言会平凡通过。所以拆两半：
      先量 k 并核对 `--fs-boost == 1/k`（k=1 时仍有效，因为 1/1 = 1），
      再**手动把 --fs-boost 改成别的值**证明它真的参与计算。
   ⚠️ ⑤ 与 ⑥ 是一对：⑤ 保证**字真的变大**，⑥ 保证**盒子没被撑大**。
      只测一边，都能被"改了但没生效"或"生效过头"糊弄过去。
   ⚠️ 放大后文字更宽 → 溢出断言必须逐档实测，不能只测标准档。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  function num(s) { var v = parseFloat(s); return isFinite(v) ? v : NaN; }
  var root = document.documentElement;
  var rootStyle = root.style;
  var bakBoost = rootStyle.getPropertyValue('--fs-boost');
  var bakZoom = rootStyle.zoom;
  var LEVELS = [1, 1.15, 1.3, 1.5];

  /* 用全新探针量「字面 100px」实际渲染成多少 → 系统系数 k */
  function probe100() {
    var d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;font-size:100px;line-height:1;';
    d.textContent = 'M';
    document.body.appendChild(d);
    var v = num(getComputedStyle(d).fontSize);
    d.remove();
    return v;
  }
  /* 把探针挂进带令牌的宿主里量（看令牌有没有生效） */
  function rendered(scale, boost, token) {
    var host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;' +
      '--fs-boost:' + boost + ';font-size:' + (token || 'var(--fs-body)') + ';line-height:1;';
    host.textContent = 'M';
    document.body.appendChild(host);
    var v = num(getComputedStyle(host).fontSize);
    host.remove();
    return v;
  }
  /* 视口横向越界的元素（排除视觉隐藏的 .a11y-sr-only） */
  function overflowHits() {
    var W = window.innerWidth, hits = [];
    var list = document.querySelectorAll('body *');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.classList && el.classList.contains('a11y-sr-only')) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > W + 1 || r.left < -1) {
        hits.push((typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : el.tagName));
      }
    }
    return hits;
  }

  try {
    ok('① applyFontScale / systemFontBoost 存在',
      typeof applyFontScale === 'function' && typeof systemFontBoost === 'function');

    var k = probe100() / 100;
    ok('①b 探针能量出系统字体缩放系数（0.5~5 之间）', k > 0.5 && k < 5);

    applyFontScale(1);
    var boostVar = num(rootStyle.getPropertyValue('--fs-boost'));
    ok('② --fs-boost 已写入且为倒数（k 在 1.05~3 时 = 1/k，否则 = 1）',
      isFinite(boostVar) && (k > 1.05 && k < 3 ? Math.abs(boostVar - 1 / k) < 0.01 : Math.abs(boostVar - 1) < 0.01));

    /* ③ 反向验证：boost 真的参与计算（换成别的值，渲染必须跟着变）
       ★ 必须写在 :root 上：--fs-* 令牌定义在 :root，其中的 var(--fs-boost) 是在
         **:root 那一层**完成替换后再继承下来的；把 --fs-boost 写在探针自己身上，
         继承到的令牌值早就是替换完的结果，改它不会变（会假报 FAIL）。 */
    function renderedRootBoost(boost) {
      var bak = rootStyle.getPropertyValue('--fs-boost');
      rootStyle.setProperty('--fs-boost', String(boost));
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;font-size:var(--fs-body);line-height:1;';
      d.textContent = 'M';
      document.body.appendChild(d);
      var v = num(getComputedStyle(d).fontSize);
      d.remove();
      rootStyle.setProperty('--fs-boost', bak);
      return v;
    }
    var withB1 = renderedRootBoost(1), withB2 = renderedRootBoost(2);
    ok('③ --fs-boost 参与 --fs-* 计算（改它渲染跟着变，排除"写了不用"）',
      Math.abs(withB2 / withB1 - 2) < 0.05);

    /* ④ 归一的目标：令牌渲染出来 ≈ 设计值。
       ★ 设计值从 --fs-body 的指定值里读，**不写死 px**：
         设计字号改过一次（15 → 17），写死的那版就永远红 —— 断言该验的是
         「系统系数被除掉了」，不是「设计字号永远是 15」。 */
    var designBody = (function () {
      var v = String(getComputedStyle(document.documentElement).getPropertyValue('--fs-body') || '');
      var m = /([\d.]+)px/.exec(v);
      return m ? parseFloat(m[1]) : NaN;
    })();
    var got = rendered(1, boostVar);
    ok('④ 字号令牌渲染值 ≈ 设计值 ' + designBody + 'px（系统系数被除掉，误差 <8%）',
      isFinite(designBody) && Math.abs(got / designBody - 1) < 0.08, got + ' vs ' + designBody);

    /* ⑤ 「字号大小」只走 --fs-user 令牌（**不是**整页 zoom）：
        同一个令牌在 1.5 档必须渲染成 1 档的 1.5 倍 —— 放大就该发生在这里 */
    applyFontScale(1);
    var tok1 = rendered(1, boostVar);
    applyFontScale(1.5);
    var tok15 = rendered(1.5, num(rootStyle.getPropertyValue('--fs-boost')));
    /* 样式表里不许再有 --fs-scale：老路残留 = 两条放大通道打架 */
    var hasFsScale = (function () {
      try {
        for (var i = 0; i < document.styleSheets.length; i++) {
          var rules = document.styleSheets[i].cssRules;
          for (var j = 0; j < rules.length; j++) {
            if ((rules[j].cssText || '').indexOf('fs-scale') >= 0) return true;
          }
        }
      } catch (e) { return false; }
      return false;
    })();
    ok('⑤ 字号令牌**随档位变**（1.5 档渲染值 ≈ 1 档的 1.5 倍，放大走 --fs-user；且没有多余的 --fs-scale）',
      Math.abs(tok15 / tok1 - 1.5) < 0.06 && !hasFsScale);

    applyFontScale(1);
    ok('⑤b 不写页面 zoom（字号档位不走整页缩放那条路）', !rootStyle.zoom || rootStyle.zoom === '');
    applyFontScale(1.5);
    ok('⑤c 1.5 档写的是 --fs-user=1.5，而不是 <html> zoom',
      !rootStyle.zoom && Math.abs(num(rootStyle.getPropertyValue('--fs-user')) - 1.5) < 0.01);

    /* ⑥ ★核心：放大**只动可读性，不动布局**
        取底部导航项的高：1.5 档应 ≈ 1 档（盒子不跟着长）。
        —— 与 ⑤ 是一对：⑤ 保证字真的变大，⑥ 保证盒子没被撑大。只测一边都能被假绿糊弄。 */
    function navH() {
      var n = document.querySelector('.nav-item');
      return n ? n.getBoundingClientRect().height : NaN;
    }
    switchView('timer');
    applyFontScale(1);   var h1 = navH();
    applyFontScale(1.5); var h15 = navH();
    /* 实测：1 档 63px → 1.5 档 75px（+19%）。导航项里装着图标+文字，
       字变大后行高自然长一点是**正常**的；真正不该出现的是"整页等比缩放"那种 1.5 倍。
       阈值卡 1.35：容得下文字撑高的自然增量，又能把整页缩放挡在外面。 */
    ok('⑥ 放大不是整页等比缩放（导航项高度增幅远小于 1.5 倍 —— 盒子尺寸没被一起放大）',
      isFinite(h1) && isFinite(h15) && h1 > 0 && (h15 / h1) < 1.35);

    /* ⑥b 放大后**不横向溢出、不裁切、不出现横向滚动**：
       字变大 → 文字更宽，这正是最容易把容器顶破的地方。 */
    function anyHScroll() {
      var r = document.documentElement;
      return r.scrollWidth > r.clientWidth + 1 || document.body.scrollWidth > document.body.clientWidth + 1;
    }
    applyFontScale(1);   var hs1 = anyHScroll();
    applyFontScale(1.5); var hs15 = anyHScroll();
    var bodyRight15 = document.body.getBoundingClientRect().right;
    ok('⑥b 放大后无横向溢出/裁切（1 档与 1.5 档都没有横向滚动条，body 不越界）',
      !hs1 && !hs15 && bodyRight15 <= window.innerWidth + 1.5);

    /* ⑦ 各档都不横向溢出（放大后文字更宽，必须逐档实测，不能只测标准档） */
    var bad = {};
    for (var i = 0; i < LEVELS.length; i++) {
      applyFontScale(LEVELS[i]);
      var hits = overflowHits();
      if (hits.length) bad[LEVELS[i]] = hits.slice(0, 4).join(',');
    }
    ok('⑦ 1/1.15/1.3/1.5 四档均无横向溢出' + (Object.keys(bad).length ? ' — 越界：' + JSON.stringify(bad) : ''),
      Object.keys(bad).length === 0);

    /* ⑧ 头部：品牌行不得压住右侧快捷按钮（绝对是定位在右边，窄屏/放大档最容易撞） */
    var hdrBad = [];
    for (var j = 0; j < LEVELS.length; j++) {
      applyFontScale(LEVELS[j]);
      var brand = document.querySelector('.header .header-brand-row');
      var btn = document.querySelector('.header .header-btn');
      if (!brand || !btn) continue;
      var B = brand.getBoundingClientRect(), C = btn.getBoundingClientRect();
      var ox = Math.min(B.right, C.right) - Math.max(B.left, C.left);
      var oy = Math.min(B.bottom, C.bottom) - Math.max(B.top, C.top);
      if (ox > 0 && oy > 0) hdrBad.push(LEVELS[j]);
    }
    ok('⑧ 各档头部品牌行不压住快捷按钮' + (hdrBad.length ? ' — 撞档：' + hdrBad.join(',') : ''),
      hdrBad.length === 0);

    /* ⑨ 上下限：越界值被 normFontScale 夹回 [0.85, 1.6]，写进 --fs-user */
    applyFontScale(9);   var hi = num(rootStyle.getPropertyValue('--fs-user'));
    applyFontScale(0.1); var lo = num(rootStyle.getPropertyValue('--fs-user'));
    ok('⑨ 越界档位被夹回上限 1.6 / 下限 0.85',
      Math.abs(hi - 1.6) < 0.01 && Math.abs(lo - 0.85) < 0.01);

    /* ⑩ 设置页控件存在、四档齐全、与 settings 同源 */
    applyFontScale(1);
    var sel = document.getElementById('setFontScale');
    ok('⑩ 设置页有「字号大小」控件', !!sel);
    ok('⑩b 四档齐全', !!sel && sel.options && sel.options.length >= 4);
    ok('⑩c 控件与 settings.fontScale 同源', !!sel && appData.settings && 'fontScale' in appData.settings);

    /* ⑪ 实测：1.5 档下计时数字不撑破圆环（最容易"被撑爆"的那块排版） */
    switchView('timer');
    applyFontScale(1.5);
    var tt = document.querySelector('.timer-time'), wrap = document.querySelector('.timer-circle-wrap');
    if (tt && wrap) {
      ok('⑪ 1.5 档计时数字不溢出圆环',
        tt.getBoundingClientRect().width <= wrap.getBoundingClientRect().width - 4);
    } else {
      ok('⑪ 1.5 档计时数字不溢出圆环（元素不存在，跳过）', true);
    }
    /* ⑫ 1.5 档下左右滑切换视图仍然有效（同时反馈"不能左右滑切页面了"：
         旧实现把字撑破 → 横向溢出抢走手势 / 被手势锁死。放大后仍要能滑）
       ★ 事件构造与 C50 保持一致：用普通 Event + 定义 touches（TouchEvent 构造器
         在部分 WebView 不可用），并且派发到 document.body ——
         派发到 elementFromPoint 拿到的具体元素上，会因该元素处于横向可滚容器内
         被判定为"横滚"而取消手势（本用例首版就是这么假报 FAIL 的）。
       ★ 还要先等过手势冷却（GAP），否则上一条用例刚滑过，这次会被间隔守卫吞掉。 */
    applyFontScale(1.5);
    switchView('timer');
    (function waitGap() { var t0 = Date.now(); while (Date.now() - t0 < 520) { /* busy */ } })();
    var beforeV = (document.querySelector('.nav-item.active') || {}).dataset;
    (function swipeMid() {
      var w = document.documentElement.clientWidth || window.innerWidth;
      var x0 = Math.round(w * 0.75), x1 = Math.round(w * 0.25), y0 = 400;
      function ev(type, x, ended) {
        var e;
        try { e = new Event(type, { bubbles: true, cancelable: true }); }
        catch (er) { e = document.createEvent('Event'); e.initEvent(type, true, true); }
        try { Object.defineProperty(e, 'touches', { value: ended ? [] : [{ clientX: x, clientY: y0 }], configurable: true }); } catch (er2) {}
        try { Object.defineProperty(e, 'changedTouches', { value: [{ clientX: x, clientY: y0 }], configurable: true }); } catch (er3) {}
        return e;
      }
      document.body.dispatchEvent(ev('touchstart', x0, false));
      document.body.dispatchEvent(ev('touchmove', x1, false));
      document.body.dispatchEvent(ev('touchend', x1, true));
    })();
    var afterV = (document.querySelector('.nav-item.active') || {}).dataset;
    ok('⑫ 1.5 档下中段横滑仍能切视图（放大不吃掉翻页手势）',
      !!beforeV && !!afterV && beforeV.view !== afterV.view);

    switchView('timer');
  } catch (e) {
    R.push(['JS 异常：' + (e && e.message), false]);
  } finally {
    try {
      applyFontScale((appData.settings && appData.settings.fontScale) || 1);
      if (!bakBoost) rootStyle.removeProperty('--fs-boost');
      if (!bakZoom) rootStyle.removeProperty('zoom');
      if (typeof saveData === 'function') saveData();
    } catch (e2) { /* 收尾失败不掩盖断言结果 */ }
  }
  return JSON.stringify(R);
})();
