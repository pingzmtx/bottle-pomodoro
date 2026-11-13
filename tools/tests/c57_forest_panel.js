/* C57 森林面板：接管重绘 —— SVG 树 / 自适应网格 / 窗口档位

   覆盖缺口：森林渲染此前**一条用例都没有**（单测里连 forestFromRecords 都没测），
   所以这一版重绘必须把它锁住，否则以后改坏了也没人知道。

   六条：
     ① 接管生效 —— 旧的「一列列表情」结构（.tf-grove / .tf-t）**不再出现**，
        换成 .fs-grid / .fs-day / .fs-tree；
     ② 网格口径 —— 格子数 = 窗口天数（**含没专注的那天**：空白本身就是信息），
        今天的格子带 is-today；
     ③ 窗口档位 —— 点「30 天」格子数变 30，写回 uiPrefs 后仍生效；
     ④ 老数据兜底 —— 记录里没有 levels 字段（只有 icons）时也要能画出树，不能白屏；
     ⑤ 年视图 —— 365 档按月聚合成 12 格（逐日铺 365 格的话树会小到看不见）；
     ⑥ 配色与位置 —— 强度底色取主色的浓淡（不跨色相），且面板落在树区最底部；
     ⑦ 地貌随里程碑变化 —— 每个里程碑有地标图标（未解锁去色 + 写明还差多少棵），
        林地底板 `data-terra` 随解锁数升档、底色跟着变。

   防假绿：断言全部落在**渲染出来的 DOM** 上，不读内部变量 ——
   内部状态对得上但画不出来，是这类"重绘"改动最典型的假绿。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  function $(s) { return document.querySelector(s); }
  function n$(s) { return document.querySelectorAll(s).length; }
  var _savedRecords = null, _savedWin = null, _savedJourney = null;
  try {
    _savedRecords = (appData.records || []).slice();
    _savedWin = appData.uiPrefs ? appData.uiPrefs.forestWin : null;
    _savedJourney = appData.journey ? appData.journey.enabled : null;
    /* 旅程开着时切统计页子 tab 会被"未解锁"拦下 —— 先关掉，专注测森林本身 */
    if (appData.journey && appData.journey.enabled) { try { setJourneyEnabled(false); } catch (e) {} }

    /* 造 14 天数据：第 1 天 8 个（超 CAP 要折叠）、第 3 天与第 8 天空着（要有空白格） */
    var recs = [], id = 810000;
    var plan = [8, 2, 0, 3, 1, 4, 2, 0, 5, 2, 3, 1, 4, 2];
    for (var d = 0; d < plan.length; d++) {
      var day = new Date();
      day.setDate(day.getDate() - (plan.length - 1 - d));
      for (var k = 0; k < plan[d]; k++) {
        var st = new Date(day); st.setHours(9 + k, 0, 0, 0);
        var en = new Date(day); en.setHours(9 + k, 25, 0, 0);
        recs.push({
          id: id++, type: 'full', taskName: '示例', note: '', pomos: 1, effectiveSeconds: 1500,
          startTime: st.getTime(), endTime: en.getTime(), interruptions: [], totalInterruptSeconds: 0
        });
      }
    }
    appData.records = recs;
    if (appData.uiPrefs) appData.uiPrefs.forestWin = 14;

    switchView('stats');
    if (typeof switchStatsSubTab === 'function') switchStatsSubTab('tree');
    if (typeof renderForestPanel === 'function') renderForestPanel();
    var panel = document.getElementById('treeForestPanel');
    ok('①1 森林面板已渲染', !!panel && panel.innerHTML.length > 0);

    /* ① 接管生效：旧结构不该再出现 */
    ok('①2 旧结构（一列列表情）已被替换掉', !!panel && n$('#treeForestPanel .tf-grove') === 0);
    ok('①3 新网格已就位', n$('#treeForestPanel .fs-grid') === 1);
    ok('①4 画出了 SVG 树（不是表情）', n$('#treeForestPanel .fs-tree') > 0);
    ok('①5 树确实是 svg 元素', !!$('#treeForestPanel svg.fs-tree'));

    /* ② 网格口径 */
    ok('②1 格子数 = 窗口天数 14（含没专注的那天）',
      n$('#treeForestPanel .fs-day') === 14);
    ok('②2 今天的格子有 is-today 标记', n$('#treeForestPanel .fs-day.is-today') === 1);
    ok('②3 树多的那天折成「+N」', !!$('#treeForestPanel .fs-more'));
    ok('②4 空白日不画树（只有一个小圆点占位）', n$('#treeForestPanel .fs-bare') >= 1);
    ok('②5 底部仍给出一行里程碑进度（信息没丢，只是不再单列一套）',
      !!panel && /已达成\s*\d+\/\d+/.test(String(panel.textContent)));
    ok('②6 日期不再挤在一行（每格一个日期）',
      n$('#treeForestPanel .fs-date') === 14);

    /* ③ 窗口档位 */
    var btn30 = null;
    var btns = document.querySelectorAll('#treeForestPanel .fs-win');
    for (var i = 0; i < btns.length; i++) if (btns[i].textContent.indexOf('30') >= 0) btn30 = btns[i];
    ok('③1 有 14/30/90/一年 四档按钮', btns.length === 4);
    if (btn30) btn30.click();
    ok('③2 切到 30 天后格子数变 30', n$('#treeForestPanel .fs-day') === 30);
    ok('③3 当前档位写进了 uiPrefs',
      !!appData.uiPrefs && Number(appData.uiPrefs.forestWin) === 30);
    /* 再渲染一次仍然是 30（档位是持久的，不是一次性的） */
    renderForestPanel();
    ok('③4 重渲染后仍是 30 天（档位持久）', n$('#treeForestPanel .fs-day') === 30);

    /* ④ 老数据兜底：只有 icons、没有 levels */
    var old = {
      id: 819999, type: 'full', taskName: '老记录', pomos: 2, effectiveSeconds: 3000,
      startTime: new Date().setHours(10, 0, 0, 0), endTime: new Date().setHours(10, 50, 0, 0),
      icons: ['🌲', '🌲'], interruptions: [], totalInterruptSeconds: 0
    };
    appData.records = [old];
    renderForestPanel();
    ok('④1 老数据（无 levels 字段）照样画出树', n$('#treeForestPanel .fs-tree') > 0);
    ok('④2 老数据也没把面板画空', !!panel && panel.innerHTML.indexOf('我的森林') >= 0);

    /* ⑤ 年视图（365 档）：一年按**周**聚合，不是逐日铺 365 格 */
    var btns2 = document.querySelectorAll('#treeForestPanel .fs-win');
    var btnYear = null;
    for (var j = 0; j < btns2.length; j++) if (btns2[j].textContent.indexOf('年') >= 0) btnYear = btns2[j];
    ok('⑤1 档位里有「一年」', !!btnYear);
    if (btnYear) btnYear.click();
    ok('⑤2 一年档 = 12 格（按月聚合，不是 365 格）',
      n$('#treeForestPanel .fs-day') === 12);
    ok('⑤3 年视图网格带 is-year（换了密度）',
      n$('#treeForestPanel .fs-grid.is-year') === 1);
    ok('⑤4 年视图按月标名（12 个月份）', n$('#treeForestPanel .fs-mo-name') === 12);
    ok('⑤5 本周那一格带 is-today', n$('#treeForestPanel .fs-day.is-today') === 1);

    /* ⑥ 配色与位置 —— 这两条回归自用户的两点反馈：
          底色曾是热力图那套"黄→橙→红"跨色相色阶，整片看下来是花的；
          面板曾被挪到树的画面下面，而它作为总览应当落在树区最底。 */
    var dEls = document.querySelectorAll('#treeForestPanel .fs-day');
    var colored = null;
    for (var q = 0; q < dEls.length; q++) {
      if (/fs-s[1-4]/.test(dEls[q].className)) { colored = dEls[q]; break; }
    }
    var cbg = colored ? getComputedStyle(colored).backgroundColor : '';
    ok('⑥1 强度底色取自主色（232,93,58 的浓淡），不再跨色相',
      /232,\s*93,\s*58/.test(cbg));
    var cont = document.querySelector('.tree-container');
    var slot = document.querySelector('[data-page-node-id="tbForestSlot"]');
    ok('⑥2 「我的森林」面板在树区容器内', !!cont && !!slot && cont.contains(slot));
    var kids = cont ? cont.children : [];
    ok('⑥3 面板是树区最后一个块（种树子页的最底）',
      kids.length > 0 && kids[kids.length - 1] === slot);
    if (slot && slot.parentElement) {
      var sibs = slot.parentElement.children;
      ok('⑥4 面板之后没有别的 tree-* 块',
        sibs[sibs.length - 1] === slot);
    }

    /* ⑦ 里程碑改变地貌：地标徽记 + 林地底板档位 */
    /* 里程碑已并入成就页（「种树」分组）—— 本面板不再单列一套，只留进度与入口 */
    ok('⑦1 面板不再单列里程碑胶囊（已并入成就页）',
      n$('#treeForestPanel .tf-chip') === 0);
    ok('⑦2 给出一行进度 + 去成就页的入口',
      !!panel && /已达成\s*\d+\/\d+/.test(String(panel.textContent)) &&
      /成就页/.test(String(panel.textContent)));
    ok('⑦3 有跳转成就页的按钮',
      !!$('#treeForestPanel .tf-chips button'));

    var g1 = document.querySelector('#treeForestPanel .fs-grid');
    ok('⑦4 林地底板带档位标记 data-terra', !!g1 && g1.hasAttribute('data-terra'));
    var terraLow = g1 ? g1.getAttribute('data-terra') : null;

    /* 造 420 棵（解锁 10/50/100/365 四个）→ 档位应升上去，底色也应跟着变 */
    var big = [], bid = 830000;
    for (var bd = 0; bd < 30; bd++) {
      var bday = new Date();
      bday.setDate(bday.getDate() - bd);
      for (var bk = 0; bk < 14; bk++) {
        var bs = new Date(bday); bs.setHours(8, bk * 2 % 60, 0, 0);
        big.push({
          id: bid++, type: 'full', taskName: '风暴', note: '', pomos: 1, effectiveSeconds: 1500,
          startTime: bs.getTime(), endTime: bs.getTime() + 1500000,
          interruptions: [], totalInterruptSeconds: 0
        });
      }
    }
    appData.records = big;
    renderForestPanel();
    var g2 = document.querySelector('#treeForestPanel .fs-grid');
    var terraHigh = g2 ? g2.getAttribute('data-terra') : null;
    ok('⑦5 解锁更多后林地底板档位提升（0→更高）',
      terraHigh !== null && Number(terraHigh) > Number(terraLow));
    var bgLow = g1 ? getComputedStyle(g1).backgroundColor : '';
    var bgHigh = g2 ? getComputedStyle(g2).backgroundColor : '';
    ok('⑦6 底板底色随档位变化（地貌确实变了）', bgLow !== bgHigh);

    /* ⑧ 时长决定树种 + 长场次多树（Forest 那套"时长是唯一变量"的落点）
       这两条必须落在**渲染出来的 DOM** 上：档位表改了而图例没跟着改，
       面板就会用一张对不上的图讲规则 —— 那种"说明与实现脱节"最难自查。 */
    var ss = new Date(); ss.setDate(ss.getDate() - 2); ss.setHours(9, 0, 0, 0);
    function _r(i, mins, pomos) {
      return {
        id: 840000 + i, type: 'full', taskName: '时长', note: '', pomos: pomos, effectiveSeconds: mins * 60,
        startTime: ss.getTime() + i * 36e5, endTime: ss.getTime() + i * 36e5 + mins * 60000,
        interruptions: [], totalInterruptSeconds: 0
      };
    }
    /* 同一格里放：5 分钟（幼苗）+ 90 分钟（大树，且一次 3 棵） */
    appData.records = [_r(0, 5, 0.5), _r(1, 90, 3)];
    if (appData.uiPrefs) appData.uiPrefs.forestWin = 14;
    renderForestPanel();
    var daySvg = document.querySelectorAll('#treeForestPanel .fs-tree').length;
    ok('⑧1 两条记录种出 4 棵（90 分钟那场一次收 3 棵）', daySvg === 4);
    var legendTxt = String(panel.textContent);
    ok('⑧2 面板写着「时长决定种出什么」（规则对用户可见，不只写在代码里）',
      legendTxt.indexOf('时长决定种出什么') >= 0);
    ok('⑧3 图例四档齐全（<10 / ≥10 / ≥25 / ≥60）',
      /<\s*10分/.test(legendTxt) && /≥10分/.test(legendTxt) &&
      /≥25分/.test(legendTxt) && /≥60分/.test(legendTxt));
    ok('⑧4 图例说明了长场次多给（满 60 分钟一次收 2~4 棵）',
      /一次收\s*2~4\s*棵/.test(legendTxt));
    var anyTitle = '';
    var allDays = document.querySelectorAll('#treeForestPanel .fs-day');
    for (var di = 0; di < allDays.length; di++) {
      var tt = allDays[di].getAttribute('title') || '';
      if (tt.indexOf('棵') >= 0) { anyTitle = tt; break; }
    }
    ok('⑧5 有树的格子提示里写明树种（幼苗~大树，一眼看出长短专注的区别）',
      anyTitle.indexOf('幼苗') >= 0 && anyTitle.indexOf('大树') >= 0);
  } catch (e) {
    R.push(['⚠️ 用例抛异常：' + (e && e.message ? e.message : e), false]);
  } finally {
    try {
      appData.records = _savedRecords;
      if (appData.uiPrefs) appData.uiPrefs.forestWin = _savedWin;
      if (_savedJourney === true) { try { setJourneyEnabled(true); } catch (e2) {} }
      if (typeof renderForestPanel === 'function') renderForestPanel();
    } catch (e3) {}
  }
  return JSON.stringify(R);
})();
