/* C93 排期三档精度：折叠只给时分 / 展开+设置+添加 给完整年月日
   「这个排期，我只是希望它在计划那展示，不显示年月日
   但是你展开或者设置里，你起码得显示吧，因为不同的隔天排期这都不一样」。
   一句话：同一份数据，三种密度 —— 卡片省、详情全。
   这里把三种密度都钉死，防止以后有人"统一"成一种（2026-10-19 就是统一过头，
   把 🕒 印到标题行，需求以为那是实际完成时间）。 */
(function () {
  var R = [];
  var ok = function (name, cond, extra) { R.push([name + (extra !== undefined && extra !== '' ? ' :: ' + extra : ''), !!cond]); };
  var today = typeof getTodayStr === 'function' ? getTodayStr() : '';
  var d2 = (function () {
    var t = new Date(today + 'T00:00:00');
    t.setDate(t.getDate() + 1);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  })();
  var todosBak = JSON.stringify(appData.todos);
  var viewBak = _todoViewDs;
  var expandBak = Object.assign({}, expandedTodos);
  var editBak = Object.assign({}, editingTodos);
  var txt = function (el) { return el ? String(el.textContent).replace(/\s+/g, ' ').trim() : ''; };
  var row = function (id) { return document.querySelector('.todo-item[data-id="' + id + '"]'); };

  try {
    appData.todos = [
      /* 同一天两段：折叠态只写时分（不写日期） */
      { id: 'c93_same', title: 'C93同日', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
        blocks: [{ start: today + ' 08:00', end: today + ' 09:00' }, { start: today + ' 10:00', end: today + ' 11:00' }] },
      /* 跨两天：折叠态带「月/日」，展开态写完整年月日 */
      { id: 'c93_cross', title: 'C93跨天', done: false, pomodoros: 1, subs: [], repeat: '', tag: '',
        blocks: [{ start: today + ' 20:00', end: today + ' 21:00' }, { start: d2 + ' 08:00', end: d2 + ' 09:00' }] }
    ];
    expandedTodos = {}; editingTodos = {};
    renderTodos();

    /* ---------- A 折叠态：不给年月日 ---------- */
    var lSame = row('c93_same').querySelector('.todo-extra-line');
    var tSame = txt(lSame);
    ok('A1 折叠态同天的段只写时分', /8:00[–-]9:00/.test(tSame) && /10:00[–-]11:00/.test(tSame), tSame);
    ok('A2 折叠态同天不出现年份', tSame.indexOf(today.slice(0, 4)) < 0, tSame);
    var lCross = row('c93_cross').querySelector('.todo-extra-line');
    var tCross = txt(lCross);
    ok('A3 折叠态跨天用「月/日」而不是完整年月日', /\d{1,2}\/\d{1,2}/.test(tCross) && tCross.indexOf(today.slice(0, 4) + '-') < 0, tCross);

    /* ---------- B 展开态：完整年月日 + 星期 ---------- */
    expandedTodos = {}; expandedTodos['c93_cross'] = true;
    renderTodos();
    var rC = row('c93_cross');
    var sC = rC.querySelector('.tf-note-sched');
    ok('B1 展开态出现排期块', !!sC);
    var days = [].slice.call(rC.querySelectorAll('.tf-sched-day')).map(txt);
    ok('B2 每个不同的日期一个日期头（跨天 = 2 个）', days.length === 2, days.join(' | '));
    ok('B3 日期头是完整年月日 yyyy-mm-dd', days.every(function (d) { return /^\d{4}-\d{2}-\d{2}/.test(d); }), days.join(' | '));
    ok('B4 日期头带星期（周一…周日）', days.every(function (d) { return /周[一二三四五六日]/.test(d); }), days.join(' | '));
    ok('B5 段行里不再重复写日期（只在日期头写一次）',
      [].slice.call(rC.querySelectorAll('.tf-view-seg')).every(function (e) { return !/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/.test(txt(e)); }),
      [].slice.call(rC.querySelectorAll('.tf-view-seg')).map(txt).join(' | '));
    ok('B6 同一天的多段共用一个日期头', (function () {
      expandedTodos = {}; expandedTodos['c93_same'] = true; renderTodos();
      return row('c93_same').querySelectorAll('.tf-sched-day').length === 1 &&
             row('c93_same').querySelectorAll('.tf-view-seg').length === 2;
    })());

    /* ---------- C 设置面板：每段 chip 带完整年月日 ---------- */
    expandedTodos = {}; expandedTodos['c93_cross'] = true; editingTodos = {}; editingTodos['c93_cross'] = true;
    renderTodos();
    var chips = [].slice.call(row('c93_cross').querySelectorAll('.tf-chip--block')).map(txt);
    ok('C1 设置面板的段 chip 各有完整年月日', chips.length === 2 && chips.every(function (c) { return /\d{4}-\d{2}-\d{2}/.test(c); }), chips.join(' | '));
    ok('C2 两段日期不同就写得不同（不许都省成"今天"）', chips[0].slice(0, 10) !== chips[1].slice(0, 10), chips.join(' | '));

    /* ---------- D 新增弹窗：已排段清单带完整年月日 ---------- */
    openAddTodoModal();
    _addBlockDraft = [{ start: today + ' 14:00', end: today + ' 14:30' }, { start: d2 + ' 09:00', end: d2 + ' 09:40' }];
    renderAddTodoExtraChips();
    var dchips = [].slice.call(document.querySelectorAll('#addTodoExtraChips .tf-chip--extra')).map(txt);
    ok('D1 弹窗段清单带完整年月日', dchips.length === 2 && dchips.every(function (c) { return /\d{4}-\d{2}-\d{2}/.test(c); }), dchips.join(' | '));
    ok('D2 弹窗里跨天两段日期不同', dchips[0].slice(0, 10) !== dchips[1].slice(0, 10), dchips.join(' | '));
    try { closeModal('addTodoModal'); } catch (e) { if (window.__silent) window.__silent(e, 'c93:close'); }

    /* ---------- E 三档数据同源：谁都不许自己算一遍日期 ---------- */
    ok('E1 折叠态与展开态段数一致（同一个 todoBlocksOf）',
      (function () {
        var t = appData.todos.filter(function (x) { return x.id === 'c93_cross'; })[0];
        return todoBlocksOf(t, appData.settings).length === 2;
      })());
  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.todos = JSON.parse(todosBak); } catch (e) { appData.todos = []; }
    _todoViewDs = ''; expandedTodos = expandBak; editingTodos = editBak;
    try { renderTodos(); } catch (e) { if (window.__silent) window.__silent(e, 'c93:restore'); }
  }
  return JSON.stringify(R);
})();
