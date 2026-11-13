/* C100 —— 旧窗口不许覆盖新的数据（守卫 3）

   「昨天明明完成了英语，今天变未完成，日志也删了」「数学的排期
   今天也没了」。

   用他昨晚两次导出 + 今早一次导出对比出来的真相：今早那份**逐字节等于 20:02 那份**
   （记录 60 条、freeFocus 123 分、深色模式 false、数学 blocks 全无），只是多跑了
   一次日切。也就是说早上有一个从 20:02 起就没再重载过的窗口醒过来，把 22:57 的
   数据（63 条记录 / 深色模式 / 数学排期 / 英语完成）整份盖掉了。

   修法：写盘前读 WRITE_STAMP_KEY，若"最后写盘不是本窗口、且比本窗口载入的时间新"，
   这次写盘直接作废 + 提示 + 重载（回前台跑日切前也先做这个判断）。

   A 别的窗口写过更新的数据 → 这次写盘被挡下（存储原封不动）
   B 自己的戳、更旧的戳 → 照常写盘
   C 写盘成功后戳换成自己的（身份 + 时间）
   D 守卫 3 的判据函数本身（_staleOtherInstance）
   E 反证：拔掉守卫 → A 必红

   用例里放 window.__staleNoReload = true，避免被真的重载打断。 */

(function () {
  var R = [];
  function ok(name, cond, extra) { R.push([name, !!cond, extra === undefined ? '' : String(extra)]); }
  window.__staleNoReload = true;

  var KEY = 'tomato_focus_v3';
  var STAMP = 'tomato_focus_v3_stamp';
  var KEY_WRITE_T = '__c100';

  function readStore() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function readStamp() {
    try { return JSON.parse(localStorage.getItem(STAMP) || 'null'); } catch (e) { return null; }
  }
  function stampOf(id, t) { localStorage.setItem(STAMP, JSON.stringify({ id: id, t: t })); }

  /* ---------- 准备：存一份"好数据"，并让本窗口认为它是自己载入的那版 ---------- */
  var backup = readStore();
  var good = JSON.parse(JSON.stringify(appData));
  good.records = good.records || [];
  for (var i = 0; i < 5; i++) {
    good.records.push({ id: 'c100_' + i, taskName: 'C100哨兵' + i, type: 'focus', pomodoros: 1, effectiveSeconds: 1500, startTime: Date.now() });
  }
  var goodJson = JSON.stringify(good);
  localStorage.setItem(KEY, JSON.stringify({ t: 1000000, d: goodJson }));
  window.__staleHooks.t = 1000000;

  /* ---------- A 别的窗口写过更新的数据 → 本次写盘作废 ---------- */
  stampOf('other-window', 2000000); // 比我们载入的 1000000 新
  appData.records = (appData.records || []).slice(0, 0); // 内存变成"空"，若被写下去就是丢光
  ok('A1 判据：认出是别的窗口写过更新的数据', _staleOtherInstance() > 0, _staleOtherInstance());
  /* ★ 走真实写盘路径（不是直接调判据函数）：反证拔掉守卫时这里必须红 */
  saveDataNow();
  var after = readStore();
  ok('A2 写盘被挡下（存储时间戳没变）', after && after.t === 1000000, after && after.t);
  ok('A3 存储里仍是那份好数据', after && JSON.parse(after.d).records.length === (JSON.parse(goodJson).records.length), after && after.d.length);
  ok('A4 好数据的记录还在（5 条哨兵）',
    after && (JSON.parse(after.d).records || []).filter(function (r) { return String(r.id).indexOf('c100_') === 0; }).length === 5);

  /* ---------- B 自己的戳 / 更旧的戳 → 照常写盘 ---------- */
  stampOf(window.__staleHooks.id, 2000000); // 换成"本窗口"的身份 → 不该挡
  var b1 = _guardStaleWrite();
  ok('B1 同一个窗口的戳不挡', b1 === false, b1);

  stampOf('other-window', 500); // 别的窗口，但比我们载入的旧 → 不挡（它才是过期的那个）
  var b2 = _guardStaleWrite();
  ok('B2 别的窗口但戳更旧 → 不挡', b2 === false, b2);

  localStorage.setItem(STAMP, ''); // 戳丢了（历史数据/清理过）
  var b3 = _guardStaleWrite();
  ok('B3 没有戳 → 不挡（不能让老用户升上来就写不了盘）', b3 === false, b3);

  /* ---------- C 正常写盘后，戳换成自己的 ---------- */
  appData.records = [];
  var _beforeId = (readStamp() || {}).id;
  window.__staleHooks.t = 1000000;
  saveDataNow();
  var st2 = readStamp();
  ok('C1 写盘成功', readStore() && readStore().t > 1000000, readStore() && readStore().t);
  ok('C2 戳换成了本窗口身份', st2 && st2.id && st2.id !== 'other-window', st2 && st2.id);
  ok('C3 戳的时间与写盘时间一致', st2 && st2.t === readStore().t, st2 && st2.t);
  ok('C4 本窗口记住的新时间戳同步更新', window.__staleHooks.t === (st2 && st2.t), window.__staleHooks.t);
  ok('C5 身份与上次不同（不是沿用别人的 id）', !_beforeId || st2.id !== _beforeId, _beforeId + ' -> ' + (st2 && st2.id));

  /* ---------- D 日切前那道判断：能挡住旧窗口跑日切 ---------- */
  window.__staleHooks.t = 1000000;
  stampOf('other-window', 2000000);
  ok('D1 _staleOtherInstance 返回对方的时间戳', _staleOtherInstance() === 2000000, _staleOtherInstance());
  window.__staleHooks.t = 2000000; // 本窗口已经追上 → 不再算过期
  ok('D2 追上之后不再判为过期', _staleOtherInstance() === 0, _staleOtherInstance());

  /* ---------- E 反证前提：守卫确实挂在写盘路径上 ---------- */
  window.__staleHooks.t = 1000000;
  stampOf('other-window', 3000000);
  var tBefore = (readStore() || {}).t;
  appData.records = [];
  saveDataNow();
  ok('E1 反证：再来一次（换一个更新的戳）仍挡住', (readStore() || {}).t === tBefore, (readStore() || {}).t + ' vs ' + tBefore);

  /* 收尾：把用例动过的存储**和窗口写盘戳**都还回去。
     ★ 只还原 KEY 是不够的：E 段把 STAMP 留成了 {id:'other-window', t:3000000}，
       后面所有用例的 saveDataNow() 都会被守卫 3 当成"别的窗口写过更新的数据"挡掉，
       表现就是「单跑绿、混批红」（C123 G6 存不进 localStorage 就是这么来的）。
       恢复成"本窗口最后一次写盘 = 备份里的时间"才是本用例来之前的真实状态。 */
  try {
    if (backup) localStorage.setItem(KEY, JSON.stringify(backup));
    else localStorage.removeItem(KEY);
    localStorage.removeItem(STAMP);
    window.__staleHooks.t = Number((backup && backup.t) || 0) || -1;
  } catch (e) { }
  delete window.__staleNoReload;
  delete window[KEY_WRITE_T];
  return JSON.stringify(R);
})();
