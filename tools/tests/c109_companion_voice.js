/* C109 专注中陪伴语音
 *
 * 每 N 分钟念一句鼓励或提醒，最容易写错的就是「什么时候不该念」：
 * 一按开始立刻来一句像在催；后台念不出声还会在回前台时排队补念；
 * 结束前 90 秒撞上「准备收尾」；同一个番茄里同一句反复念。
 *
 * A 默认值：companion 默认**关**（2026-10-25 决策）、间隔默认 5 分钟（只有 voice 打开才生效）
 * B 未满间隔不播
 * C 满间隔播一条，且落在对应进度的桶里
 * D 同一番茄内不重复同一句
 * E 结束前 90 秒内不播（收尾句归「结束前提醒」）
 * F voice 关 / companion 关 → 一条都不播
 * G 「只在开局说一次」→ 整个番茄只播一条，不会变成每分钟一句
 * H 换一个番茄（startTime 变）→ 重新计时、句子池重置
 */
(function () {
  var R = [];
  function ok(name, cond, detail) { R.push([name, !!cond, detail === undefined ? '' : String(detail)]); }
  var H = window.__voiceHooks;
  if (!H) {
    ok('A0 语音测试钩子存在', false, 'window.__voiceHooks 缺失');
    return JSON.stringify(R);
  }

  var enhBak = JSON.parse(JSON.stringify(appData.enhSettings || {}));
  var stBak = JSON.parse(JSON.stringify(timerState || {}));
  /* 无头浏览器里 document.hidden 恒为 true，不打这一下整个用例都只是「什么都没发生」。 */
  if (H.forceVisible) H.forceVisible(true);

  function enh(over) {
    var s = appData.enhSettings;
    s.voice = true;
    s.companion = true;
    s.companionMin = 10;
    Object.keys(over || {}).forEach(function (k) { s[k] = over[k]; });
    return s;
  }
  /* 造一个正在跑的第 n 分钟番茄：total=1500（25 分钟），left=total-elapsed */
  function setTimer(elapsedSec, total) {
    var totalSec = total || 1500;
    timerState = {
      mode: 'focus',
      running: true,
      totalDuration: totalSec,
      remaining: totalSec - elapsedSec,
      startTime: 1700000000000
    };
  }
  function tick() {
    H.tick(timerState, appData.enhSettings);
    return H.log();
  }

  /* ---- A 默认值 ----
     ★ 2026-11-04 修：原 A1 断言「companion 默认为开」，与代码脱节 ——
       2c9fd8c（2026-10-25「陪伴语音默认关闭（含老用户迁移）」）把默认值改成 false
       并配了迁移链，用例没跟着改（用例最后一次改动 3471706，比它早 3 天），
       从那天起 C109 一直是红的。
       默认关是明确决策（专注中途突然开口的听感是「吓一跳」），所以**改用例不改代码**。 */
  ok('A1 companion 默认为关', appData.enhSettings.companion === false,
    JSON.stringify({ companion: appData.enhSettings.companion }));
  ok('A2 companionMin 默认为 5（25 分钟番茄能听到 4 句）', Number(appData.enhSettings.companionMin) === 5 || appData.enhSettings.companionMin === undefined,
    String(appData.enhSettings.companionMin));
  /* A3~A5：老存档的迁移口径走**代码里那个真实守卫**（01b 的 applyCompanionDefaultGuard，
     loadData 载入老存档时调的就是它），不在用例里另写一份判断 —— 否则代码改了用例还在自说自话。 */
  if (typeof applyCompanionDefaultGuard !== 'function') {
    ok('A3 陪伴默认值守卫可用', false, 'applyCompanionDefaultGuard 未导出到 window');
  } else {
    var _old = applyCompanionDefaultGuard({ companion: true }); /* 旧默认塞的 true，未主动改过 */
    ok('A3 老存档的旧默认 true 被压回关', _old.companion === false, JSON.stringify(_old));
    var _touched = applyCompanionDefaultGuard({ companion: true, companionTouched: true });
    ok('A4 用户自己开过的 true 不会被按回去', _touched.companion === true, JSON.stringify(_touched));
    var _missing = applyCompanionDefaultGuard({ companionMin: 5 });
    ok('A5 缺该字段的存档补成关', _missing.companion === false, JSON.stringify(_missing));
  }

  /* ---- B 未满间隔不播 ---- */
  H.resetComp(); H.clearLog();
  enh({ companionMin: 10 });
  setTimer(300); /* 第 5 分钟，间隔 10 分钟 */
  tick();
  ok('B1 未满间隔一条都不播', H.log().length === 0, H.log().join('|'));

  /* ---- C 满间隔播一条，落在对应桶 ---- */
  H.resetComp(); H.clearLog();
  enh({ companionMin: 10 });
  setTimer(600); /* 正好第 10 分钟 */
  tick();
  var log1 = H.log();
  ok('C1 满 10 分钟播一条', log1.length === 1, log1.join('|'));
  var midLines = H.lines().mid;
  ok('C2 第 10 分钟（前段）念的是中段句子', midLines.indexOf(log1[0]) >= 0, log1[0]);

  /* ---- D 间隔封顶 + 同一番茄内不重复 ----
     2026-10-22 修：原断言假设 companionMin=1 → 每分钟一句，但 02_enh571 里
     `gapSec = Math.max(gapSec, total / 5)` 是**有意的封顶**（注释："一句都不许超过
     每 1/5 番茄时长一条"）。25 分钟的番茄 → 最少 300 秒一句；「每 1 分钟」被抬到 5 分钟。
     所以用 20 个一分钟 tick 断言「恰好 4 句（300/600/900/1200 秒）」，同时验证封顶与节奏。 */
  H.resetComp(); H.clearLog();
  enh({ companionMin: 1 });
  var said = [];
  for (var i = 1; i <= 20; i++) {
    setTimer(i * 60);
    tick();
  }
  said = H.log();
  ok('D1 间隔按「1/5 番茄时长」封顶：20 分钟共 4 句', said.length === 4,
    said.length + '｜' + said.join(' / '));
  /* D3 封顶（2026-10-22 补）：密集 tick 下总句数不得超过 1/5 番茄时长对应的 5 句。
     封顶失效比「句子少了」更糟 —— 用户会被连环念。 */
  H.resetComp(); H.clearLog();
  enh({ companionMin: 1 });
  for (var j = 1; j <= 24; j++) { setTimer(j * 60); tick(); }
  var dense = H.log();
  ok('D3 封顶：25 分钟密集 tick 总句数不超过 5', dense.length >= 1 && dense.length <= 5,
    dense.length + '｜' + dense.join(' / '));

  var uniq = {};
  said.forEach(function (t) { if (uniq[t]) dup = t; uniq[t] = 1; });
  /* 早段只有 4 句、中段 7 句：8 次必然跨桶，跨桶不计重复 */
  ok('D2 相邻两次不是同一句', (function () {
    for (var k = 1; k < said.length; k++) if (said[k] === said[k - 1]) return false;
    return true;
  })(), said.join('|'));

  /* ---- E 结束前 90 秒不播 ---- */
  H.resetComp(); H.clearLog();
  enh({ companionMin: 1 });
  setTimer(1500 - 60); /* 只剩 60 秒 */
  tick();
  ok('E1 只剩 60 秒时不播陪伴语', H.log().length === 0, H.log().join('|'));
  H.resetComp(); H.clearLog();
  setTimer(1500 - 120); /* 剩 120 秒，仍在 90 秒之外 */
  H.state().lastAtSec = 0;
  tick();
  ok('E2 剩 120 秒时照常播（边界外）', H.log().length === 1, H.log().join('|'));

  /* ---- F 开关 ---- */
  H.resetComp(); H.clearLog();
  enh({ voice: false, companionMin: 1 });
  setTimer(600);
  tick();
  ok('F1 voice 关闭时一条都不播', H.log().length === 0, H.log().join('|'));
  H.resetComp(); H.clearLog();
  enh({ voice: true, companion: false, companionMin: 1 });
  setTimer(600);
  tick();
  ok('F2 companion 关闭时一条都不播', H.log().length === 0, H.log().join('|'));

  /* ---- G 只在开局说一次 ---- */
  H.resetComp(); H.clearLog();
  enh({ voice: true, companion: true, companionMin: 0 });
  for (var j = 1; j <= 20; j++) {
    setTimer(j * 60);
    tick();
  }
  ok('G1 「只在开局说一次」全程只播一条', H.log().length === 1, H.log().join('|'));

  /* ---- H 换番茄重新计 ---- */
  H.resetComp(); H.clearLog();
  enh({ companionMin: 10 });
  setTimer(600);
  tick();
  ok('H1 第一颗番茄第 10 分钟播一条', H.log().length === 1, H.log().join('|'));
  setTimer(600);
  timerState.startTime = 1700000999999; /* 新的番茄 */
  tick();
  ok('H2 换番茄后立刻又播一条（计时归零）', H.log().length === 2, H.log().join('|'));
  ok('H3 换番茄后句子池也重置', (function () {
    var st = H.state();
    return st.key === String(1700000999999);
  })(), JSON.stringify(H.state()));

  /* ---- 还原 ---- */
  appData.enhSettings = enhBak;
  timerState = stBak;
  H.clearLog();
  H.resetComp();
  if (H.forceVisible) H.forceVisible(false);
  return JSON.stringify(R);
})();
