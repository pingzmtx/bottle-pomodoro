(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  try {
    ok('typeof savePomodoroRecord = ' + (typeof savePomodoroRecord), true);
    var s = String(savePomodoroRecord);
    ok('len=' + s.length, true);
    ok('has consumeLiveSessionForRecord=' + (s.indexOf('consumeLiveSessionForRecord') >= 0), true);
    ok('has consume=' + (s.indexOf('consume') >= 0), true);
    ok('head=' + s.slice(0, 200).replace(/\n/g, ' '), true);
    ok('call_tail=' + s.slice(-260).replace(/\n/g, ' '), true);
    ok('typeof tbTodoSegList=' + (typeof tbTodoSegList), true);
    ok('typeof revertRecordRewards=' + (typeof revertRecordRewards), true);
  } catch (e) {
    R.push(['ERR ' + String(e && e.stack || e), false]);
  }
  return JSON.stringify(R);
})();
