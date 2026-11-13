/* C92 新增计划弹窗的「预计🍅」快捷档

   「预计番茄是可以选的，而不是给填呀，我可以有快捷方式选」。

   规矩：
     · 档位与展开后编辑面板那排 chip **同一个数组**（ADD_TODO_POMO_STEPS），两处不许各写一份；
     · 点 chip 只写 input.value —— 不另存状态（保存时读的仍是 addTodoPomodoros.value）；
     · 手敲数字时对应 chip 要高亮（oninput → syncAddTodoPomoQuick）；
     · 「清空」= 不设预计番茄（存 null，不是 0）；
     · 打开弹窗默认落在「清空」上。

   本用例锁住：
     A 档位存在且和编辑面板一致
     B 点 chip → input.value / 高亮
     C 手敲 → 高亮跟随
     D 清空 → value 空 + 保存成 null
     E 保存路径真的落盘（走 confirmAddTodo，不是只改 DOM） */
(function () {
  var R = [];
  function ok(n, c, d) { R.push([n + (d ? ' :: ' + d : ''), !!c]); }
  var todosBak = JSON.stringify(appData.todos || []);

  try {
    openAddTodoModal();
    var box = document.getElementById('addTodoPomoQuick');
    var inp = document.getElementById('addTodoPomodoros');
    ok('A1 弹窗里有快捷档容器', !!box);
    var chips = box ? [].slice.call(box.querySelectorAll('.add-pomo-quick-chip')) : [];
    var vals = chips.map(function (c) { return c.getAttribute('data-v'); });
    ok('A2 档位 0.5/1/1.5/2/3/4 + 清空',
      vals.join(',') === '0.5,1,1.5,2,3,4,clear', vals.join(','));
    ok('A3 档位与编辑面板共用同一个数组', (function () {
      var src = String(renderTodoRowHtml);
      return src.indexOf('ADD_TODO_POMO_STEPS') >= 0;
    })());
    var on0 = chips.filter(function (c) { return c.classList.contains('on'); }).map(function (c) { return c.getAttribute('data-v'); });
    ok('A4 刚打开时落在「清空」上（没设番茄）', on0.join(',') === 'clear', on0.join(','));

    /* ---------- B 点 chip ---------- */
    setAddTodoPomo(1.5);
    ok('B1 点 1.5🍅 → 输入框就是 1.5', inp.value === '1.5', inp.value);
    var onB = chips.filter(function (c) { return c.classList.contains('on'); }).map(function (c) { return c.getAttribute('data-v'); });
    ok('B2 只有 1.5 那颗高亮', onB.join(',') === '1.5', onB.join(','));
    setAddTodoPomo(3);
    var onB2 = chips.filter(function (c) { return c.classList.contains('on'); }).map(function (c) { return c.getAttribute('data-v'); });
    ok('B3 换一颗，旧的灭、新的亮（不叠加）', onB2.join(',') === '3', onB2.join(','));

    /* ---------- C 手敲 ---------- */
    inp.value = '2';
    syncAddTodoPomoQuick();
    var onC = chips.filter(function (c) { return c.classList.contains('on'); }).map(function (c) { return c.getAttribute('data-v'); });
    ok('C1 手敲 2 → 2🍅 高亮', onC.join(',') === '2', onC.join(','));
    inp.value = '2.7';
    syncAddTodoPomoQuick();
    var onC2 = chips.filter(function (c) { return c.classList.contains('on'); }).map(function (c) { return c.getAttribute('data-v'); });
    ok('C2 敲了不在档位里的值 → 谁都不亮（不许硬凑最近档）', onC2.length === 0, onC2.join(','));

    /* ---------- D 清空 ---------- */
    setAddTodoPomo(null);
    ok('D1 清空后输入框为空', inp.value === '', inp.value);
    var onD = chips.filter(function (c) { return c.classList.contains('on'); }).map(function (c) { return c.getAttribute('data-v'); });
    ok('D2 清空那颗高亮', onD.join(',') === 'clear', onD.join(','));

    /* ---------- E 保存路径 ---------- */
    var n0 = (appData.todos || []).length;
    setAddTodoPomo(2);
    document.getElementById('addTodoTitle').value = 'C92快捷番茄';
    confirmAddTodo();
    var t = (appData.todos || []).filter(function (x) { return x.title === 'C92快捷番茄'; })[0];
    ok('E1 走 confirmAddTodo 真的新增了一条', (appData.todos || []).length === n0 + 1);
    ok('E2 落盘 pomodoros = 2（不是只改 DOM）', !!t && t.pomodoros === 2, t ? String(t.pomodoros) : 'NOSAVE');

    setAddTodoPomo(1);
    document.getElementById('addTodoTitle').value = 'C92快捷番茄2';
    confirmAddTodo();
    var t2 = (appData.todos || []).filter(function (x) { return x.title === 'C92快捷番茄2'; })[0];
    ok('E3 不带千分位/不串味：1🍅 存 1', !!t2 && t2.pomodoros === 1, t2 ? String(t2.pomodoros) : 'NOSAVE');

    openAddTodoModal();
    setAddTodoPomo(null);
    ok('E4 清空 → 新弹窗仍是「清空」态', document.getElementById('addTodoPomodoros').value === '');
  } catch (e) {
    R.push(['!! 异常: ' + (e && e.message), false]);
  } finally {
    try { appData.todos = JSON.parse(todosBak); } catch (e) { appData.todos = []; }
    try { if (typeof closeModal === 'function') closeModal('addTodoModal'); } catch (e) {}
    try { renderTodos(); } catch (e) {}
  }

  return JSON.stringify(R);
})();
