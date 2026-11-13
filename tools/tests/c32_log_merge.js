/* C32 的页面侧断言体（run_smoke 直接读这个文件执行，浏览器也能直跑同一份）。
   返回 JSON：[[断言名, 是否通过], ...]。
   全程用自造记录，**恢复放在 finally 里**：哪怕中间某条断言抛异常，
   appData 也会被还原并落盘，不会把「合并测试」这类测试记录留在用户数据里。
   （曾经的坑：断言一抛，Python 侧的还原那段就轮不到执行，测试记录被 saveData 写进存储。） */
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  // 用「当天」而非硬编码日期：否则跨天后「今日统计」断言必然失败（本用例在 10-08 写，10-09 就挂了）
  var at = function (h, m) { var d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
  var mk = function (id, s0, e0, type, name) {
    return { id: id, taskName: name, type: type, startTime: at(s0[0], s0[1]), endTime: at(e0[0], e0[1]),
      effectiveSeconds: (at(e0[0], e0[1]) - at(s0[0], s0[1])) / 1000, pomos: type === 'full' ? 1 : 0, interruptions: [] };
  };
  var bak = function (v) { return JSON.parse(JSON.stringify(v)); };
  window.__c32bk = { r: bak(appData.records), rd: bak(appData.round), t: bak(appData.tree) };
  var inj = [
    mk('z1', [8, 0], [8, 25], 'full', '合并测试'),
    mk('z2', [8, 25], [8, 50], 'full', '合并测试'),
    mk('z3', [8, 50], [9, 15], 'full', '合并测试'),
    mk('z4', [9, 50], [10, 15], 'full', '合并测试'),
    mk('z5', [8, 0], [8, 25], 'full', '合并测试'),
    mk('z9', [12, 0], [13, 0], 'log', '合并测试-仅记录')
  ];
  /* ★ 隔离：本用例断言的是「8:00–9:15 三段并成一组」，
     一旦数据里混着**前面用例残留的当天记录**，分组就会被改写 ——
     而那些残留记录的时间**随运行时刻漂移**（早晨跑恰好落进 8:00–9:15 之间，
     凌晨跑则在别处），于是同一份代码在凌晨通过、在早饭点失败。
     实测：**未拆分版本在早饭点跑同样会挂**，所以这是「用例间隔离不干净」，
     不是产品问题。改为「只留本次注入的记录」，与运行时刻、与前面用例全部解耦。 */
  appData.records = inj.slice();

  try {
    /* ① 编辑日志可改类型 */
    openRecordDetail('z1');
    var sel = document.getElementById('detailRecordType');
    ok('①类型下拉在、四选项齐全', !!sel && sel.options.length === 4 &&
      sel.options[0].value === 'full' && sel.options[1].value === 'half' &&
      sel.options[2].value === 'incomplete' && sel.options[3].value === 'log');
    ok('①下拉当前值=记录类型', !!sel && sel.value === 'full');
    ok('①25 分钟时「完整」「半个」可选', !!sel && sel.options[0].disabled === false && sel.options[1].disabled === false);
    var full0 = document.getElementById('todayFull').textContent;
    openRecordDetail('z9');
    var sel9 = document.getElementById('detailRecordType');
    ok('①「仅记录」也能改回完整', !!sel9 && sel9.value === 'log' && sel9.options[0].disabled === false);
    sel9.value = 'full';
    saveRecordDetail('z9');
    var r9 = appData.records.filter(function (x) { return String(x.id) === 'z9'; })[0];
    ok('①改类型后 type=full', !!r9 && r9.type === 'full');
    ok('①改类型后 pomos 按折算给（60 分钟→2）', !!r9 && r9.pomos === 2);
    ok('①有效时长没被改动', !!r9 && r9.effectiveSeconds === 3600);
    ok('①今日统计跟着变（' + full0 + '→' + document.getElementById('todayFull').textContent + '）',
      document.getElementById('todayFull').textContent !== full0);
    openRecordDetail('z9');
    document.getElementById('detailRecordType').value = 'log';
    saveRecordDetail('z9');
    var r9b = appData.records.filter(function (x) { return String(x.id) === 'z9'; })[0];
    ok('①改回「仅记录」后 pomos=0', !!r9b && r9b.type === 'log' && r9b.pomos === 0);

    /* ①附：旧版本的「打断」记录不能因为下拉里没有它就被静默改成别的类型 */
    var zInt = mk('zI', [14, 0], [14, 25], 'interrupted', '合并测试-打断');
    appData.records.push(zInt);
    openRecordDetail('zI');
    var selI = document.getElementById('detailRecordType');
    ok('①打断记录的下拉多出「保留原样」选项', !!selI && selI.options.length === 5 &&
      selI.options[4].value === 'interrupted');
    ok('①打断记录打开时选中的就是它自己', !!selI && selI.value === 'interrupted');
    saveRecordDetail('zI');
    var rI = appData.records.filter(function (x) { return String(x.id) === 'zI'; })[0];
    ok('①原样保存后仍是 interrupted', !!rI && rI.type === 'interrupted');
    appData.records = appData.records.filter(function (x) { return String(x.id) !== 'zI'; });
    closeModal('recordDetailModal');

    /* ② 结束计时不足 5 分钟：默认未完成，但可选「仅记录」 */
    timerState.effectiveSeconds = 180;
    timerState.totalDuration = 1500;
    timerState.mode = 'focus';
    showFinishModal('manual');
    var w = document.getElementById('finishTypeWrap');
    var fsel = document.getElementById('finishType');
    ok('②不足 5 分钟选择器不再藏起来', !!w && w.style.display !== 'none');
    var logOpt = fsel ? fsel.querySelector('option[value="log"]') : null;
    ok('②「仅记录」可选', !!logOpt && logOpt.disabled === false);
    ok('②「完整」「半个」仍禁用', fsel.querySelector('option[value="full"]').disabled === true &&
      fsel.querySelector('option[value="half"]').disabled === true);
    ok('②默认仍是未完成', fsel.value === 'incomplete');
    closeModal('finishModal');

    /* ③ 结算卡片：≥2 条才弹 */
    var _om = document.querySelector('.settle-mask');
    if (_om) _om.classList.remove('show');
    window._settleCollecting = true;
    window._settleMsgs = ['🪙 时长奖励 +2 金币（专注 25 分钟）'];
    window._settleCtx = {};
    flushSettleSummary();
    ok('③只有 1 条消息时不弹结算卡片', !document.querySelector('.settle-mask.show'));
    window._settleCollecting = true;
    window._settleMsgs = ['🌱 树苗又长高了一点（累计 5 点）', '🪙 时长奖励 +2 金币（专注 25 分钟）'];
    window._settleCtx = {};
    flushSettleSummary();
    var m = document.querySelector('.settle-mask.show');
    ok('③消息 ≥2 条才弹结算卡片', !!m && /本次番茄结算/.test(m.textContent));
    ok('③两条消息都在卡里', !!m && /树苗/.test(m.textContent) && /时长奖励/.test(m.textContent));
    var bok = m ? m.querySelector('.settle-ok') : null;
    if (bok) bok.click();

    /* ④ 日志合并显示（数据一条不动） */
    switchView('log');
    _logSig = '';
    renderLogs();
    ok('④渲染不增删记录（隔离后应恰为注入的 ' + inj.length + ' 条）', appData.records.length === inj.length);
    var list = document.getElementById('logList');
    var txt = [].slice.call(list.querySelectorAll('.timeline-content.grouped'))
      .map(function (e) { return e.textContent.replace(/\s+/g, ' '); }).join(' ~ ');
    ok('④相接的三段并成一组（8:00–9:15，12 小时制）', txt.replace(/[上下]午/g,'').indexOf('8:00– 9:15'.replace(' ','')) >= 0);
    ok('④合并组累计时长 1 小时 15 分', /1 小时 15 分/.test(txt));
    ok('④合并组番茄数 ×3', /×3/.test(txt));
    ok('④合并组标注「连续 3 段」', /连续 3 段/.test(txt));
    /* ④附：阈值已放宽到 30 分钟 —— 用户「隔 14 分钟没合并」必须修好 */
    var _P = window.__pure || {};
    if (typeof _P.mergeLogRecords === 'function') {
      var _hm = function (h, m) { var d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };
      var _qa = { id: 'q1', type: 'full', pomos: 1, startTime: _hm(15, 0), endTime: _hm(15, 25), taskName: '阈值测试' };
      var _qb = { id: 'q2', type: 'full', pomos: 1, startTime: _hm(15, 39), endTime: _hm(16, 4), taskName: '阈值测试' };
      var _qc = { id: 'q3', type: 'full', pomos: 1, startTime: _hm(16, 35), endTime: _hm(17, 0), taskName: '阈值测试' };
      ok('④附1 隔 14 分钟的两段合并（旧 10 分钟阈值下漏合并）', _P.mergeLogRecords([_qa, _qb]).length === 1);
      ok('④附2 隔 31 分钟的两段不合并', _P.mergeLogRecords([_qb, _qc]).length === 2);
    }
    ok('④起止重复的一条被去重', /去重 1 条/.test(txt));
    ok('④合并组下挂 3 条原始分段', list.querySelectorAll('.log-sub-item').length >= 3);
    var sw = list.querySelector('.log-sub-wrap');
    ok('④合并组默认收起', !!sw && sw.style.display === 'none');
    var key = sw ? sw.id.replace('logsub-', '') : '';
    toggleLogGroup(key);
    ok('④点一下展开', !!document.getElementById('logsub-' + key) &&
      document.getElementById('logsub-' + key).style.display === 'block');
    toggleLogGroup(key);
    ok('④再点收起', !!document.getElementById('logsub-' + key) &&
      document.getElementById('logsub-' + key).style.display === 'none');
    // 原先写死 ">= 4"：行数受「库里真实记录」影响，数据干净时只有 3 行 → 假失败。
    // 改成按意图断言：每条顶层日志行都要有时长，且至少有一条是「未合并的单条」。
    var _rows = [].slice.call(list.querySelectorAll('.timeline-content'));
    var _noDur = _rows.filter(function (r) { return !r.querySelector('.timeline-dur'); }).length;
    var _singles = _rows.filter(function (r) { return r.className.indexOf('grouped') < 0; }).length;
    ok('④单条记录也显示时长（行' + _rows.length + ' 单条' + _singles + ' 无时长' + _noDur + '）',
      _rows.length > 0 && _noDur === 0 && _singles >= 1);
    // 老记录/导入记录只有 duration（毫秒）、没有 endTime —— 必须也能显示时长
    ok('④只有 duration 没有 endTime 的老记录也显示时长', (function () {
      var now = Date.now(), sec = recordSeconds({ startTime: now, duration: 1500000 });
      var txt = recordDurationText({ startTime: now, duration: 1500000 });
      return sec === 1500 && txt.indexOf('25') >= 0;
    })());
    // ★ 番茄标签不许「预计 ⇄ 实际」变脸：有预计就显示「预计N🍅」，没预计就什么都不显示
    ok('⑤番茄标签永不变脸（有预计→预计2🍅；无预计→不显示实际）', (function () {
      var now = Date.now();
      function mk(rec) {
        return renderLogGroupHTML({
          type: 'full', pomos: 1, pending: false, interruptCount: 0,
          dropped: 0, startTime: now - 1500000, endTime: now,
          taskName: 'T', segments: [rec]
        }, true);
      }
      var h1 = mk({ id: 'y1', type: 'full', startTime: now, duration: 1500000, expectedPomodoros: 2, actualPomodoros: 1, taskName: 'T' });
      var h2 = mk({ id: 'y2', type: 'full', startTime: now, duration: 1500000, actualPomodoros: 1, taskName: 'T' });
      return h1.indexOf('预计2') >= 0 && h1.indexOf('实际') < 0 &&
             h2.indexOf('预计') < 0 && h2.indexOf('实际') < 0;
    })());
  } catch (e) {
    ok('⚠️ 用例抛异常：' + (e && e.message ? e.message : e), false);
  } finally {
    /* 无论成败都还原：不留测试记录 */
    var b = window.__c32bk;
    appData.records = b.r;
    appData.round = b.rd;
    appData.tree = b.t;
    if (typeof saveDataNow === 'function') saveDataNow(); else saveData();
    _logSig = '';
    try { renderLogs(); } catch (e2) { /* 还原期渲染失败不影响结论 */ }
  }
  return JSON.stringify(R);
})()
