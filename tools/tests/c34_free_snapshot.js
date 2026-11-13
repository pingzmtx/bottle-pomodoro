/* C34 的页面侧断言体（run_smoke 直接读这个文件执行，浏览器也能直跑同一份）。
   返回 JSON：[[断言名, 是否通过], ...]。

   自由专注：计时中切走/刷新后计时全丢（番茄钟不受影响）。

   根因（实测坐实，不是猜）：`toggleFreeTimer()` 的**开始分支不落快照**，
   快照只由 tick 里每 15s 一次的「心跳」写；切走时系统会冻结 JS 定时器，
   心跳根本没跑 → 磁盘里从来没写过 free 快照 → WebView 被回收后无快照可恢复 = 计时全丢。
   番茄钟的 `startPomodoroCore()` 一开头就 `saveTimerSnapshot()`，所以它一直好好的。
   （更早一层还有 `mode!=='focus'` 的过滤，已在 1927dfd 修掉。）

   五条：①不跑的时候不留残留快照 ②开始瞬间磁盘里就有 free 快照（不等心跳）
        ③正计时/流式各自记对类型 ④「切走」(pagehide) 会补落一次 ⑤暂停也落盘。
   全程用真状态跑，**恢复放在 finally**：断言抛异常也不会留下会话/快照。 */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var DISK = function () {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) return null;
      var d = (typeof raw.d === 'string') ? JSON.parse(raw.d) : raw;
      return (d && d.timerSnapshot) || null;
    } catch (e) { return null; }
  };
  var uiBak = window._freeType;
  try {
    if (typeof switchView === 'function') switchView('timer');
    // ① 清干净：不跑的时候磁盘里不该有快照
    if (typeof resetToIdle === 'function') resetToIdle();
    if (typeof clearTimerSnapshot === 'function') clearTimerSnapshot();
    if (typeof saveDataNow === 'function') saveDataNow(); else saveData();
    ok('① 未开始计时时磁盘无残留快照', DISK() === null);

    // ② 正计时：按开始键的**那一瞬间**就必须落盘（原来只等 15s 心跳）
    if (typeof toggleFreeMode === 'function') toggleFreeMode();
    if (typeof setFreeType === 'function') setFreeType('stopwatch');
    if (typeof toggleFreeTimer === 'function') toggleFreeTimer();
    var s1 = DISK();
    ok('②a 正计时开始瞬间磁盘已有快照', !!s1);
    ok('②b 快照是自由专注（mode=free）', !!s1 && s1.mode === 'free');
    ok('②c 快照带得回开始时刻（startTime>0）', !!s1 && s1.startTime > 0);
    // ③ 类型记对：正计时
    ok('③a 正计时快照 freeType=stopwatch', !!s1 && s1.freeType === 'stopwatch');

    // ④ 切走（页面隐藏/离开）补落一次：savedAt 必须往前走
    var t0 = s1 && s1.savedAt;
    /* 时钟先走一格：savedAt 是毫秒时间戳，若"开始落盘"与"切走补落"落在**同一毫秒**，
       s2.savedAt > t0 就会假失败（本用例偶发变红的原因）。
       忙等一小会儿，比把断言放宽成 >= 更诚实 —— 仍然验的是"确实补落了一次"。 */
    (function waitTick() { var a = Date.now(); while (Date.now() - a < 8) { /* busy */ } })();
    window.dispatchEvent(new Event('pagehide'));
    var s2 = DISK();
    ok('④ 切走时补落一次快照（savedAt 前进）', !!s2 && typeof s2.savedAt === 'number' && s2.savedAt > t0);

    // ⑤ 暂停也落盘，且标出 paused（恢复时不能自己跑起来）
    if (typeof toggleFreeTimer === 'function') toggleFreeTimer();
    var s3 = DISK();
    ok('⑤ 暂停后快照仍在，且 paused=true', !!s3 && s3.paused === true && !timerState.running);

    // ⑥ 流式：重建一次会话，快照要是 flowtime 且带 endAt（倒计时基准）
    if (typeof resetToIdle === 'function') resetToIdle();
    if (typeof clearTimerSnapshot === 'function') clearTimerSnapshot();
    if (typeof saveDataNow === 'function') saveDataNow(); else saveData();
    if (typeof setFreeType === 'function') setFreeType('flowtime');
    if (typeof toggleFreeTimer === 'function') toggleFreeTimer();
    var s4 = DISK();
    ok('⑥a 流式开始瞬间磁盘已有快照', !!s4);
    ok('⑥b 流式快照 freeType=flowtime', !!s4 && s4.freeType === 'flowtime');
    ok('⑥c 流式快照带 endAt（倒计时基准）', !!s4 && s4.endAt > 0);
  } catch (e) {
    ok('用例执行未抛异常: ' + (e && e.message), false);
  } finally {
    // 还原：结束会话、清快照、类型复原，绝不把测试会话留在存储里
    try {
      if (typeof resetToIdle === 'function') resetToIdle();
      if (typeof clearTimerSnapshot === 'function') clearTimerSnapshot();
      window._freeType = uiBak;
      if (typeof saveDataNow === 'function') saveDataNow(); else saveData();
    } catch (e2) { /* 还原期失败不影响结论 */ }
  }
  return JSON.stringify(R);
})()
