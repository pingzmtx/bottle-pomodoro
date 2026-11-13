/* C101 每段排期各自到点提醒
 *
 * 原来的实现只认 t.remindAt 一个时刻 + t.reminded 一个布尔：
 * 一条计划排了 8:20–9:00 和 9:20–9:40，只在第一段起点响一次，第二段永远沉默。
 *
 * A 纯函数：一天多段 → 每段一个 slot，key 各不相同
 * B 起点重合只留一个（主段与额外段同起点不重复催）
 * C 确认一段不影响另一段
 * D 没排期、只有提醒时刻 → 按 remindAt 单独一条
 * E 空 / 已完成 返回空
 * F 端到端：到第一段起点只催第一段，确认后到第二段才催第二段
 */
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }
  var DS = '2026-05-20';

  function mk(over) {
    var t = { id: 9101, title: '数学', done: false, quad: 'q1', tag: '学习', subs: [], pomodoros: 0, remindAt: DS + ' 08:20', reminded: false };
    Object.keys(over || {}).forEach(function (k) { t[k] = over[k]; });
    return t;
  }
  var settings = { tbSlotMin: 30 };

  /* ---------- A 多段各自一个 slot ---------- */
  var t1 = mk({
    blocks: [{ start: DS + ' 08:20', end: DS + ' 09:00' }, { start: DS + ' 09:20', end: DS + ' 09:40' }]
  });
  var s1 = todoRemindSlots(t1, settings, DS);
  ok('A1 两段排期 → 两个提醒点', s1.length === 2, s1.length);
  ok('A2 第一个在 08:20', s1[0] && s1[0].at === DS + ' 08:20', s1[0] && s1[0].at);
  ok('A3 第二个在 09:20', s1[1] && s1[1].at === DS + ' 09:20', s1[1] && s1[1].at);
  ok('A4 两段的确认键不同', s1[0] && s1[1] && s1[0].ack !== s1[1].ack, s1[0] && s1[0].ack);
  ok('A5 两段的队列键不同', s1[0] && s1[1] && s1[0].key !== s1[1].key, s1[0] && s1[0].key + ' / ' + (s1[1] && s1[1].key));
  ok('A6 带上了第几段（1/2 与 2/2）', s1[0].idx === 1 && s1[0].n === 2 && s1[1].idx === 2, s1[0].idx + '/' + s1[0].n);

  /* ---------- B 同起点不重复 ---------- */
  var t2 = mk({
    blocks: [{ start: DS + ' 08:20', end: DS + ' 09:00' }, { start: DS + ' 08:20', end: DS + ' 09:30' }]
  });
  ok('B1 同一起点只留一个提醒点', todoRemindSlots(t2, settings, DS).length === 1, todoRemindSlots(t2, settings, DS).length);

  /* ---------- C 确认一段不影响另一段 ---------- */
  var t3 = mk({
    blocks: [{ start: DS + ' 08:20', end: DS + ' 09:00' }, { start: DS + ' 09:20', end: DS + ' 09:40' }]
  });
  var s3 = todoRemindSlots(t3, settings, DS);
  ok('C1 初始两段都没确认', !todoRemindSlotAcked(t3, s3[0]) && !todoRemindSlotAcked(t3, s3[1]));
  t3.remindAcked = {};
  t3.remindAcked[s3[0].ack] = 1;
  var s3b = todoRemindSlots(t3, settings, DS);
  ok('C2 确认第一段后它被标记', todoRemindSlotAcked(t3, s3b[0]) === true);
  ok('C3 第二段仍未确认（同一任务里各段独立）', todoRemindSlotAcked(t3, s3b[1]) === false);

  /* ---------- D 只有提醒时刻、没有排期 ---------- */
  var t4 = mk({ blocks: null, extraBlocks: null, remindAt: DS + ' 14:05' });
  var s4 = todoRemindSlots(t4, settings, DS);
  ok('D1 没排期也有一条提醒', s4.length === 1, s4.length);
  ok('D2 时刻取自 remindAt', s4[0] && s4[0].at === DS + ' 14:05', s4[0] && s4[0].at);
  ok('D3 队列键保持 <id>（老行为不变）', s4[0] && s4[0].key === '9101', s4[0] && s4[0].key);

  /* ---------- E 空 / 已完成 ---------- */
  ok('E1 已完成的任务没有提醒点', todoRemindSlots(mk({ done: true }), settings, DS).length === 0);
  ok('E2 既没排期也没提醒 → 空', todoRemindSlots(mk({ blocks: null, remindAt: null }), settings, DS).length === 0);
  ok('E3 日期不合法 → 空', todoRemindSlots(mk({}), settings, 'xx').length === 0);
  var t5 = mk({ blocks: [{ start: DS + ' 08:20', end: DS + ' 09:00' }], remindAt: '2026-05-19 08:20' });
  ok('E4 别的日子的排期不算今天', todoRemindSlots(t5, settings, '2026-05-21').length === 0);

  /* ---------- F 端到端：每一段各自响 ---------- */
  /* checkTodoReminders 内部用 getTodayStr() 认"今天"，所以这一段必须用真实今天构造 */
  var TODAY = getTodayStr();
  var t6 = mk({
    id: 9202,
    remindAt: TODAY + ' 08:20',
    blocks: [{ start: TODAY + ' 08:20', end: TODAY + ' 09:00' }, { start: TODAY + ' 09:20', end: TODAY + ' 09:40' }]
  });
  var todoBak = appData.todos;
  appData.todos = [t6];
  function clearQ() {
    if (typeof _remindQueue !== 'undefined' && _remindQueue) _remindQueue.length = 0;
    try { if (typeof closeModal === 'function') closeModal('remindModal'); } catch (e) {}
  }
  function qKeys() {
    var out = [];
    if (typeof _remindQueue === 'undefined' || !_remindQueue) return out;
    for (var i = 0; i < _remindQueue.length; i++) out.push(String(_remindQueue[i].key));
    return out;
  }
  clearQ();
  /* 第一段到点 */
  checkTodoReminders(new Date(TODAY + 'T08:20:30'));
  var q1 = qKeys().filter(function (k) { return k.indexOf('todo:9202') === 0; });
  ok('F1 第一段到点只催第一段', q1.length === 1, q1.join(','));
  remindAckTodo(9202, TODAY + '|500');
  /* 确认后再跑，第二段还没到点 → 不催 */
  checkTodoReminders(new Date(TODAY + 'T08:25:00'));
  var q2 = qKeys().filter(function (k) { return k.indexOf('todo:9202') === 0; });
  ok('F2 第一段确认后不再催', q2.length === 0, q2.join(','));
  /* 第二段到点 */
  checkTodoReminders(new Date(TODAY + 'T09:20:30'));
  var q3 = qKeys().filter(function (k) { return k.indexOf('todo:9202') === 0; });
  ok('F3 第二段到点单独催一次', q3.length === 1, q3.join(','));
  ok('F4 催的是第二段那个 key', q3[0] === 'todo:9202#09:20', q3[0]);
  /* 反证前提：只有"确认过的那段"写进任务，没确认的那段不许提前占位 */
  ok('F5 只有已确认的那段写了 ack 键', t6.remindAcked && Object.keys(t6.remindAcked).length === 1, JSON.stringify(Object.keys(t6.remindAcked || {})));
  remindAckTodo(9202, TODAY + '|560');
  ok('F6 两段各记各的 ack，互不覆盖',
    t6.remindAcked && t6.remindAcked[TODAY + '|500'] && t6.remindAcked[TODAY + '|560'],
    JSON.stringify(Object.keys(t6.remindAcked || {})));
  checkTodoReminders(new Date(TODAY + 'T09:30:00'));
  ok('F7 两段都确认后彻底安静', qKeys().filter(function (k) { return k.indexOf('todo:9202') === 0; }).length === 0,
    JSON.stringify(qKeys()));

  appData.todos = todoBak;
  clearQ();
  return JSON.stringify(R);
})();
