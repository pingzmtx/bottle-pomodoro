/* C127 —— 习惯子计划：没勾就一直留在清单上，没有到期日

   用户两轮反馈：
   ①「第二天不是我设置了第二天回到未完成吗？但是我第二天怎么不显示呀」
   ②「我那个计划里的子计划，它就很正常呀……为什么要给子计划新加一个什么期限？
      这个东西有什么意义呢？把那个移除了行不行」
   ③「我说的是习惯可以排期，不是子计划也可以排期」

   结论：子计划是**清单**，不是带排期的事件。原来带 date 的步骤只在那一天出现，
   第二天没做完就整个消失，和「次日回到未完成」的预期完全相反。
   现在一律不看 date：没勾就显示，勾了当天算完成，次日自然回到未完成。
   习惯自身的排期（timeBlocks，几点做）不受影响。

     A 未勾的步骤永远出现（不管 date 是什么）
     B 勾过的当天算完成，次日回到未完成
     C 习惯自身的 timeBlocks 排期照旧
     D clear / clearDone 两档的日切仍然按 doneOn 生效
*/
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }
  var today = getTodayStr();
  var y1 = addDaysStr(today, -1);
  var y3 = addDaysStr(today, -3);
  var t1 = addDaysStr(today, 1);
  function names(list) { return list.map(function (s) { return s.text; }).sort().join(','); }

  var h = {
    id: 'hC127', name: '习惯A',
    subs: [
      { id: 'a', text: '步骤A', date: '', doneOn: '' },
      { id: 'b', text: '步骤B', date: today, doneOn: '' },
      { id: 'c', text: '步骤C', date: y3, doneOn: '' },
      { id: 'd', text: '步骤D', date: y1, doneOn: y1 },
      { id: 'e', text: '步骤E', date: t1, doneOn: '' }
    ]
  };
  var on = names(habitSubsOn(h, today));
  ok('A1 未勾的步骤全部出现（含昨天勾过的）', on === '步骤A,步骤B,步骤C,步骤D,步骤E', on);
  ok('A2 昨天勾过的今天不再算完成', habitSubsDoneOn(h, today) === 0, habitSubsDoneOn(h, today));
  ok('A3 昨天勾过的那条本身仍在清单里', on.indexOf('步骤D') >= 0, on);
  ok('A4 明天到期的步骤今天也在清单里', on.indexOf('步骤E') >= 0, on);
  ok('A5 三天前到期的步骤今天也在清单里', on.indexOf('步骤C') >= 0, on);

  /* B 勾选 → 当天完成 → 次日回到未完成 */
  var h2 = { id: 'hC127b', name: '习惯B', subs: [{ id: 'x', text: '步骤X', date: '', doneOn: '' }] };
  h2.subs[0].doneOn = today;
  ok('B1 今天勾的算今天完成', habitSubsDoneOn(h2, today) === 1, habitSubsDoneOn(h2, today));
  ok('B2 同一步明天又是未完成', habitSubsDoneOn(h2, addDaysStr(today, 1)) === 0,
     habitSubsDoneOn(h2, addDaysStr(today, 1)));
  ok('B3 明天它仍在清单里', names(habitSubsOn(h2, addDaysStr(today, 1))) === '步骤X',
     names(habitSubsOn(h2, addDaysStr(today, 1))));

  /* C 习惯自身的排期（几点做）不受这次改动影响 */
  var h3 = { id: 'hC127c', name: '习惯C', timeBlocks: [{ start: '07:30', end: '08:00' }], subs: [] };
  ok('C1 习惯自身的时段还在', habitBlocksOf(h3).length === 1,
     JSON.stringify(habitBlocksOf(h3)));
  ok('C2 时段内容正确', (habitBlocksOf(h3)[0] || {}).start === '07:30',
     JSON.stringify(habitBlocksOf(h3)[0] || null));

  /* D clearDone / clear 的日切只按 doneOn 判断 */
  var h4 = { id: 'hC127d', name: '习惯D', subsRolledOn: y1, repeat: { mode: 'daily', subsMode: 'clearDone' },
    subs: [{ id: 'p', text: '做过的', date: '', doneOn: y1 }, { id: 'q', text: '没做的', date: y1, doneOn: '' }] };
  var h5 = { id: 'hC127e', name: '习惯E', subsRolledOn: y1, repeat: { mode: 'daily', subsMode: 'reset' },
    subs: [{ id: 'r', text: '做过的', date: '', doneOn: y1 }] };
  var appBak = appData.habits, saveBak = window.saveData;
  appData.habits = [h4, h5];
  window.saveData = function () {};
  try { rollHabitSubs(today); } catch (e) { R.push(['D0 rollHabitSubs 抛错', false, e.message]); }
  window.saveData = saveBak;
  appData.habits = appBak;
  ok('D1 clearDone：昨天做完的被删掉', names(habitSubsOf(h4)) === '没做的', names(habitSubsOf(h4)));
  ok('D2 reset：什么都不删', names(habitSubsOf(h5)) === '做过的', names(habitSubsOf(h5)));
  ok('D3 跨天戳已推进', h4.subsRolledOn === today, h4.subsRolledOn);

  return JSON.stringify(R);
})();
