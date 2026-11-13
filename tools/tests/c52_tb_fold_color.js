/* C52 日程网格：常驻在计划列表上方 + 每件事一个颜色 + 块不糊

   「就别单独成一个列表成块了，就把这个放到那个计划的上方下面有计划就行了，
             不要单独成页了」「每个任务应该自动给它分配一个颜色」
             「这文字和那个都快糊在一起了」「这些颜色不能太过接近」

   四条，逐条钉住：
     ① 位置 —— 网格直接铺在计划列表上方（DOM 顺序），不再是一行摘要的「折叠条」，
        也不再单独占一页。天天看的是列表，网格是它的抬头。
     ② 收起 —— 抬头右侧的「收起/展开」按钮还在，能真的收起来，且**标签跟着变**。
        **网格默认是收起的**，
        所以用例要先把网格展开、再跑"展开→收起→展开"的往返，
        后面的 ③④⑤⑥ 也必须在**展开态**下取节点，否则 computedStyle 全是 none。
        
     ③ 同一个色源 —— 计划条目左边框与网格里的块底**同色相同源**
        （条目色条 = 任务色实色档，块底 = 同一色相的浅色档；深浅本就该不同，
        所以比的是**色相**，不是"颜色完全相等"），否则颜色就只是个装饰，对不上号的。
     ④ 不糊 —— 计划块必须**不透明**（半透明底色会把格线透上来，几块叠一起就糊成褐色），
        而且块里要有**竖排标题**：一列只有 20 出头像素宽，横排汉字一定被裁成墨团。

   防假绿：
     - ③④ 都建立在「真的有计划」之上，所以 ⓪ 先确认页面上有计划条目；
       没有计划时后面的颜色断言会全部变成空转（数组为空 → 恒真），必须显式短路。
     - ④「不透明」断言直接读 computedStyle 的 alpha，不能只看有没有 background 字段。
     - ② 折叠后必须**重新取一次**按钮节点：重渲染会把旧节点换掉，抱着老引用读文案永远是旧值
       （这正好就是「看着没反应」的假象来源）。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  function $(s) { return document.querySelector(s); }
  function cs(el, k) { return el ? getComputedStyle(el)[k] : ''; }
  /* 'rgb(r, g, b)' → 1；'rgba(r, g, b, a)' → a。用于查底色是不是真的不透明。 */
  function alphaOf(v) {
    var m = /rgba?\(([^)]+)\)/.exec(String(v || ''));
    if (!m) return 0;
    var p = m[1].split(',');
    return p.length < 4 ? 1 : parseFloat(p[3]);
  }
  function uniq(a) {
    var seen = {}, out = [];
    a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayHM(h, m) {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(h) + ':' + pad(m);
  }
  /* actualStart/actualEnd 存的是**时间戳**（Date.now()），不是字符串 —— 别拿 todayHM 塞进去 */
  function todayMs(h, m) {
    var d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  /* 'rgb(r, g, b)' → {h, s, l}（h 0~360, s/l 0~1）。用来查"同一个色相、只差明度"。 */
  function isNeutralish(v) {
    var h = hslOf(v);
    return !!h && (h.s < 0.12 || h.l > 0.98 || h.l < 0.02);
  }
  /* 「淡灰」在本项目有**两种**形态，都要认：
     ① 实心灰（s 很低）；② **半透明罩**（--hairline = #2C3E50@12%）——
        罩的基色是偏冷的深色（l 低、s 中性），兑了透明度之后透出纸色，肉眼就是淡灰。
     只看 hsl 的 s 会把 ② 判成"有彩色"（rgba(44,62,80,.12) 的 s≈0.29），那就会
     把真灰判成假灰。所以：不透明 → 查饱和度；半透明 → 查基色够不够深够不够中性。 */
  function isGreyish(v) {
    var h = hslOf(v);
    if (!h) return false;
    if (alphaOf(v) >= 1) return h.s < 0.12;
    return h.l < 0.5 && h.s < 0.45;
  }
  function hslOf(v) {
    var m = /rgba?\(([^)]+)\)/.exec(String(v || ''));
    if (!m) return null;
    var p = m[1].split(',').map(parseFloat);
    var r = p[0] / 255, g = p[1] / 255, b = p[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var l = (mx + mn) / 2, h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: s, l: l };
  }

  var savedTodos = null;
  var savedRecords = null;   /* 段落现在只活在记录里，用例造的多段要连记录一起还原 */
  try {
    switchView('plan');
    /* ★ 计划页内部还有子标签（任务 / 习惯 / 目标 / 休息 / 倒数日），网格挂在「任务」里。
       前面的用例（C49 习惯升级会切到「习惯」）把子标签留在别处时，#planTodoView 是
       display:none —— switchView('plan') 只切顶层视图、管不到子标签，于是网格的
       computed 轨道值看着正常（CSS 是全局的），实测像素高度却全是 0，几何断言集体空转。
       这里显式切回「任务」，本用例才能在任何前置状态下稳定复现。 */
    if (typeof switchPlanTab === 'function') switchPlanTab('plan');

    /* ── ① 位置：网格在计划列表上方，且没有「折叠条」这种独立块 ── */
    var host = $('#tbShellHost');
    var list = $('#todoList');
    ok('① 网格宿主存在', !!host);
    ok('① 网格宿主在计划列表上方（DOM 顺序）',
      !!(host && list) && !!(host.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING));
    ok('① 不再有「折叠条」独立块（#tbFold 已删）', !$('#tbFold'));

    /* 塞三条今天有时间的计划（覆盖两个钟点、含一条重叠），跑完还原数据 */
    savedTodos = appData.todos;
    savedRecords = appData.records;
    appData.todos = [
      /* 旧版这里挂 actualStart/actualEnd 冒充"实际做过的时段"—— 网格那条退路已拆，
         实际时段一律由下面的记录提供（否则等于在用例里继续养第二份账本）。 */
      { id: 'c52a', title: '数学卷子', remindAt: todayHM(7, 0), estEnd: todayHM(8, 0) },
      { id: 'c52b', title: '英语阅读', remindAt: todayHM(7, 30), estEnd: todayHM(8, 30) },
      { id: 'c52c', title: '物理错题', remindAt: todayHM(9, 0), estEnd: todayHM(10, 30) }
    ];
    /* ★ 段落只活在记录里：c52a 的"实际块"必须由一条带 segs 的记录撑起来。
       旧写法是给计划挂 actualStart/actualEnd 让网格退回读快照 —— 那条退路已经拆掉了，
       因为它就是"删了记录、色块又被画回来"的来源。 */
    appData.records = (savedRecords || []).concat([{
      id: 'c52rec1', todoId: 'c52a', taskName: '数学卷子', type: 'full',
      startTime: todayMs(7, 10), endTime: todayMs(7, 55), effectiveSeconds: 1800, pomos: 1,
      segs: [
        { s: todayMs(7, 10), e: todayMs(7, 25) },
        { s: todayMs(7, 40), e: todayMs(7, 55) }
      ]
    }]);
    renderTodos();
    renderTimeBlockGrid();

    var items = [].slice.call(document.querySelectorAll('#todoList .todo-item, #todoList [data-id]'));
    ok('⓪ 有计划条目（否则后面全是空转）', items.length >= 1);

    /* ── ② 收起/展开：**默认收起**，
         按钮在、点得动、标签跟着变；测完停在展开态，供后面的网格几何断言使用
         ★ 先把状态**显式摆到收起**：tbGridFolded 会被上一个用例或上一次操作改掉，
           不能假定它还是出厂值 —— 这是假绿/假红最常见的来源（本用例踩过一次） ── */
    appData.settings.tbGridFolded = true;
    renderTodos();
    renderTimeBlockGrid();

    var foldBtn = $('.tb-paper-fold');
    var bodyEl = $('.tb-paper-body');
    ok('② 收起按钮存在', !!foldBtn);
    ok('② 网格内容区存在', !!bodyEl);
    if (!foldBtn || !bodyEl) { return JSON.stringify(R); }

    ok('② 收起态：内容区不可见、按钮写「展开」、.tb-paper 带 is-folded',
      !!$('.tb-paper') && /is-folded/.test($('.tb-paper').className) &&
      cs(bodyEl, 'display') === 'none' && foldBtn.textContent.trim() === '展开');

    foldBtn.click();
    var foldBtn1 = $('.tb-paper-fold');
    var bodyEl1 = $('.tb-paper-body');
    ok('② 点「展开」后内容区可见', cs(bodyEl1, 'display') !== 'none');
    ok('② 展开态按钮写「收起」', !!foldBtn1 && foldBtn1.textContent.trim() === '收起');
    ok('② 展开后 .tb-paper 不带 is-folded',
      !!$('.tb-paper') && !/is-folded/.test($('.tb-paper').className));

    $('.tb-paper-fold').click();
    var foldBtn2 = $('.tb-paper-fold');      /* 重渲染换了节点，必须重新取 */
    var bodyEl2 = $('.tb-paper-body');
    ok('② 点击后内容区收起', cs(bodyEl2, 'display') === 'none');
    ok('② 收起后按钮文案变「展开」', !!foldBtn2 && foldBtn2.textContent.trim() === '展开');
    ok('② 收起后 .tb-paper 带 is-folded',
      !!$('.tb-paper') && /is-folded/.test($('.tb-paper').className));

    /* 再展开一次，让后面 ③④⑤⑥ 的作用域是"看得见的网格" */
    $('.tb-paper-fold').click();
    ok('② 再点一次恢复可见', cs($('.tb-paper-body'), 'display') !== 'none');
    ok('② 恢复后按钮文案回到「收起」',
      !!$('.tb-paper-fold') && $('.tb-paper-fold').textContent.trim() === '收起');

    /* ── ③ 每件事一个颜色，且列表与网格同色源 ── */
    var listColors = items.map(function (el) {
      var bar = el.querySelector('.todo-color, .todo-bar, i') || el;
      return cs(bar, 'borderLeftColor') !== 'rgba(0, 0, 0, 0)' ? cs(bar, 'borderLeftColor') : cs(bar, 'backgroundColor');
    });
    listColors = uniq(listColors.filter(function (c) { return c && c !== 'rgba(0, 0, 0, 0)'; }));
    ok('③ 不同任务的列表色 ≥2 种', listColors.length >= 2);

    var planBlk = $('.tb-paper-blk.is-plan');
    ok('③ 网格里出现计划块', !!planBlk);
    var blkColor = cs(planBlk, 'backgroundColor');
    /* 列表色点 = 任务色的**实色档**，块底 = 同一色相的**浅色档** ——
       所以不能比"颜色完全相等"，要比**色相同源**（深浅本来就该不同） */
    ok('③ 计划块与列表色同源（同一色相：块底取浅档、列表色点取实色档）',
      (function () {
        var hb = hslOf(blkColor);
        if (!hb) return false;
        return listColors.some(function (c) {
          var h = hslOf(c);
          return !!h && Math.abs(h.h - hb.h) <= 20;
        });
      })());

    /* ── ④ 块不糊：不透明 + 竖排标题 ── */
    ok('④ 计划块底色不透明', alphaOf(blkColor) === 1);
    ok('④ 计划块 opacity 为 1', cs(planBlk, 'opacity') === '1');
    ok('④ 计划块有竖排标题',
      /vertical/.test(cs($('.tb-paper-blk-t') || planBlk, 'writingMode')));
    /* 描边：先要"平涂"、随后改主意要回描边，并纠正
       「这个描边不是你之前的那个描边」—— 之前那版 = 1px 同色相深色描边 + 4px 圆角。
       所以下面几条是**成对**的：只加 border 不加圆角 = 又不是他记得的那个框。 */
    ok('④ 计划块有 1px 描边（四边一致）',
      ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
        .every(function (k) { return parseFloat(cs(planBlk, k)) > 0; }));
    ok('④ 描边不是纯黑（是同色相的深色档，不是灰黑框）',
      alphaOf(cs(planBlk, 'borderTopColor')) === 1 &&
      cs(planBlk, 'borderTopColor') !== 'rgb(0, 0, 0)');
    ok('④ 计划块保留 4px 圆角（--radius-xs，缺了就不是那版描边）',
      Math.abs(parseFloat(cs(planBlk, 'borderRadius')) - 4) < 0.6);
    /* 「凸起」的真凶是投影，不是描边 —— 阴影必须一直是 none。
       顺带把「最左边一条深色竖线」也归到这里：那条线当年就是 inset 4px 0 0 画的，
       阴影为 none 即等于它不存在（不要写恒真的 `ok(…, true)` 假装断言过了）。 */
    ok('④ 计划块没有阴影（不凸起、也没有左侧深色竖线）', cs(planBlk, 'boxShadow') === 'none');

    /* ⑤ 预计/实际 = 同一色相的两个明度档
       只查"两块颜色不同"是不够的 —— 色相不同也会"不同"。必须比色相 */
    /* 先后说过两版，**定稿以"任务色浅色档"为准**：
       「灰只该用在格底，不该涂在色块上」—— 灰是格底的身份色，块要能一眼看出是哪件事 */
    ok('⑤ 预计块用任务色的**浅色档**做底（有彩色、明度高；灰只归格底）',
      (function () {
        var h = hslOf(cs(planBlk, 'backgroundColor'));
        return !!(h && h.s > 0.12 && h.l > 0.7);
      })());
    ok('⑤ 预计块用任务色做描边，颜色识别不丢',
      !isNeutralish(cs(planBlk, 'borderTopColor')) &&
      cs(planBlk, 'borderTopColor') !== 'rgb(0, 0, 0)');
    var actBlk = $('.tb-paper-blk.is-actual');
    ok('⑤ 网格里出现实际块', !!actBlk);
    if (actBlk) {
      var ha = hslOf(cs(actBlk, 'backgroundColor'));
      ok('⑤ 实际块是**有彩色的实色**（记录 = 真做过了，跟灰底的预计一眼分开）',
        !!(ha && ha.s > 0.08));
      ok('⑤ 实际块比预计块深（明度更低）', !!(ha) && ha.l < hslOf(cs(planBlk, 'backgroundColor')).l);
      ok('⑤ 实际块也有填充色（不是透明）', alphaOf(cs(actBlk, 'backgroundColor')) === 1);
      ok('⑤ 实际块的描边与自己的填充同色相（不是灰框）',
        (function () {
          var hb = hslOf(cs(actBlk, 'borderTopColor'));
          return !!(ha && hb) && Math.abs(ha.h - hb.h) <= 20;
        })());
    }

    /* ④ 网格几何：断言前**自己保证处于展开态**。
       收起态下 .tb-paper-body 是 display:none，网格的 computed 行/列轨道会退化成 none，
       几何断言全成空转（整轮跑时被前面的用例切回收起过，单跑则不复现）。 */
    appData.settings.tbGridFolded = false;
    renderTodos();
    renderTimeBlockGrid();

    var grids = document.querySelectorAll('.tb-paper-grid');
    ok('④ 两段网格（07–14 / 15–22）都在', grids.length === 2);
    /* 轨道数：computed 值可能是展开的 "3px 3px …"，也可能是**简写** "repeat(60, 3px)"
       —— Chrome 对等长轨道就返回 repeat() 形式。只按空格切词会把 repeat(60, 3px)
       数成 2 个 token，断言永远假（本用例踩过这个坑）。两种形式都要认。 */
    function trackCount(v) {
      var s = String(v || '');
      var m = /repeat\(\s*(\d+)/.exec(s);
      return m ? Number(m[1]) : (s.match(/\S+/g) || []).length;
    }
    if (grids.length) {
      /* 网格纵向已改成「一小时 60 行、每行 1 分钟」——精度到分钟；
         可见格线仍由"跨 10 行"的 6 个格子画，所以行**轨道**是 60 而不是 6 */
      ok('④ 每段 60 行轨道（一小时 60 分钟，块精度到 1 分钟）',
        trackCount(cs(grids[0], 'gridTemplateRows')) === 60);
      /* 2026-11-04：两段各加一小时（06:00 / 23:00）→ 9 格钟点 × 预计/实际 = 18 列 */
      ok('④ 每段 18 列（9 小时 × 预计/实际 两条 lane）',
        trackCount(cs(grids[0], 'gridTemplateColumns')) === 18);
    }
    var cells = grids.length ? grids[0].getBoundingClientRect().height : 0;
    ok('④ 网格高度由行高撑开（不是塌成 0）', cells > 120);

    /* ⑥ 多段实际时段：
       「从 10 点暂停、去做另一个任务、又回来接着做 —— 现在做不到」
       两段必须落成两个块，中间留空档；以前只有 actualStart/actualEnd 一对，只会画一条。 */
    var A = appData.todos.filter(function (t) { return t.id === 'c52a'; })[0];
    if (A) {
      A.actualStart = todayMs(7, 10);
      A.actualEnd = todayMs(7, 55);
      /* ★ 段落现在只活在**记录**里。
         多段 = 一条记录带 segs 两段（中途暂停去做别的、又回来接着做）。
         段的字段是 {s, e}（毫秒时间戳），不是 {start, end} —— 实现读的正是 s/e（见 tbTodoSegList）。
         字段名写错 = 整条段被丢掉，看着就像"多段功能没做"，其实是喂错了形状。
       ★ 两段放在**同一个钟点内**：行号才在同一列里可比，"中间留出空档"才验得出来
         （跨小时会分到不同的 grid 列，行号各从钟点顶格重算，比出来的数是假的）。 */
      appData.records = (savedRecords || []).concat([{
        id: 'c52rec1', todoId: 'c52a', taskName: '数学卷子', type: 'full',
        startTime: todayMs(7, 10), endTime: todayMs(7, 55), effectiveSeconds: 1800, pomos: 1,
        segs: [
          { s: todayMs(7, 10), e: todayMs(7, 25) },
          { s: todayMs(7, 40), e: todayMs(7, 55) }
        ]
      }]);
      /* ★ 卡片要跟着一起重渲染：只调 renderTimeBlockGrid() 只会换网格，
         卡片还停在旧 HTML（曾因此读到"卡片上没有 actualSegs"的旧内容）。 */
      renderTodos();
      renderTimeBlockGrid();
      var mine = [].slice.call(document.querySelectorAll('.tb-paper-blk.is-actual[data-tb-todo="c52a"]'));
      ok('⑥ 两段实际时段 = 两个色块（不是合并成一大条）', mine.length === 2);
      if (mine.length === 2) {
        /* 用 grid-row 起止推空档：占的行不连续 = 中间确实空着。
           ★ gridRowStart / gridRowEnd 的计算值是**纯数字**（如 "11" / "26"），不含 "span" ——
             早先按 "11 / span 15" 去 split，取到的 [1] 是 undefined，
             于是所有比较都退化成 NaN 比较、恒假（本用例踩过这个坑）。 */
        /* ★ gridRowStart 的计算值形如 "11"，但 gridRowEnd 是 **"span 15"**（不是数字！）——
           直接 Number() 会拿到 NaN，所有比较退化成恒假。这里把 span 折算成结束行号。 */
        function rowStart(b) { return Number(cs(b, 'gridRowStart')); }
        function rowEnd(b) {
          var st = rowStart(b);
          var m = /span\s+(\d+)/.exec(String(cs(b, 'gridRowEnd')));
          return m ? st + Number(m[1]) : Number(cs(b, 'gridRowEnd'));
        }
        var rows = mine.map(function (b) {
          return [rowStart(b), rowEnd(b)];
        }).sort(function (x, y) { return x[0] - y[0]; });
        ok('⑥ 两段之间留出空档（第一段结束 < 第二段开始）', rows[0][1] <= rows[1][0]);
        /* 行轨道是"分钟"（一小时 60 行），一整段 = 60 行 */
        ok('⑥ 每段只盖自己那几分钟（单段高度 < 一整段网格）',
          (rows[0][1] - rows[0][0]) > 0 && (rows[0][1] - rows[0][0]) < 60 &&
          (rows[1][1] - rows[1][0]) > 0 && (rows[1][1] - rows[1][0]) < 60);
      }
      /* 卡片不再逐段铺开，而是**汇总**成「N 段 · 共 M 分」，
         逐段起止放进 title（悬停可看完整明细）。断言跟着这个口径走。 */
      ok('⑥ 计划卡片汇总多段（"2 段 · 共 N 分"，逐段起止在 title 里）',
        (function () {
          /* ★ 卡片容器的属性是 data-id（值即 t.id），**不是** data-todo-id ——
             属性名写错 → querySelector 静默匹配不到 → 退化成"随便拿第一个卡片"，
             读到的是别条任务的内容（本用例踩过：断言的数值全对不上）。 */
          var card = document.querySelector('#todoList .todo-item[data-id="c52a"]');
          if (!card) return false;
          var el = card.querySelector('.todo-actual');
          if (!el) return false;
          var txt = el.textContent || '';
          var tip = el.getAttribute('title') || '';
          return txt.indexOf('✅') >= 0 && txt.indexOf('2 段') >= 0 &&
            (tip.match(/~/g) || []).length >= 2;   /* title 里两段各有一个 ~ */
        })());
    }
  } catch (e) {
    ok('用例执行未抛异常：' + (e && e.message), false);
  } finally {
    if (savedTodos !== null) {
      appData.todos = savedTodos;
      if (savedRecords !== null) appData.records = savedRecords;
      try { renderTodos(); renderTimeBlockGrid(); } catch (e2) {}
    }
  }
  return JSON.stringify(R);
})();
