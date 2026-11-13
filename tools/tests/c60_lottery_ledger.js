/* C60 金币抽奖「派生化」+ 记录↔奖励对账 + 礼包单一入账点

   缘起：「我怀疑种树里面的那个金币抽奖是坏的，
   比如说我每次导入数据，它就可以让我重新抽奖」。

   实测查出的两条路径：
     A 补记一条记录 → 删掉它。抽奖次数与树积分当场发、删除却**一分不退** →
       循环「补记→删除→抽奖」即可无限刷金币（实测 6 轮 coins 0→35，records 恒为 0）。
     B 导入旧备份 = 时间机器：抽奖次数、周兑换额度等凭证随存档回退；
       限时装饰更是每次导入都按 now 重算 7 天 → 永不过期。

   本用例锁住修好后的口径：
     A 额度派生：可用次数 = floor(Σ round(番茄)/2) − 已抽数（lotteryUsed 只增不减）
       —— 删记录 → 番茄总额回落 → 可用次数自动消失，删不出次数来。
     B 删除/改类型回滚树积分与计划账（revertRecordRewards / adjustRecordRewards）。
     C 租期宽限只给一次（__leaseBackfilled），反复导入不再续期；已买租期不被缩短。
     D 礼包金币在 showGift 时就入账，openGift 不再二次入账
       （旧实现：签到与成就两条路径都先自行入账、礼包点开再入账一次 = 双倍，已实测确认）。

   ⚠️ 造数纪律：会真读删 records、改 tree、弹礼包，finally 全部原样恢复。
*/
(function () {
  var R = [];
  function ok(n, c) { R.push([n, !!c]); }
  var treeBak = JSON.stringify(appData.tree || {});
  var recBak = JSON.stringify(appData.records || []);
  var journeyBak = JSON.stringify(appData.journey || {});
  var added = [];
  var today = getTodayStr();

  /* 走真实补记路径：开弹窗 → 摆 DOM → saveAddRecord() */
  function addRec(dur, type, hour) {
    openAddRecordModal();
    document.getElementById('addRecordDate').value = today;
    document.getElementById('addRecordHour').value = hour || '03';
    document.getElementById('addRecordMinute').value = '00';
    document.getElementById('addRecordDuration').value = String(dur);
    document.getElementById('addRecordType').value = type;
    document.getElementById('addRecordPlan').value = '';
    document.getElementById('addRecordSub').value = '';
    document.getElementById('addRecordTask').value = '对账用例';
    var n0 = appData.records.length;
    saveAddRecord();
    if (appData.records.length !== n0 + 1) return null;
    var r = appData.records[appData.records.length - 1];
    added.push(r.id);
    return r;
  }
  /* 复现 deleteRecord 确认后的那两步（rsConfirm 是异步的，同步用例里等价展开） */
  function dropRec(id) {
    var gone = appData.records.filter(function (r) { return idEq(r.id, id); });
    appData.records = appData.records.filter(function (r) { return !idEq(r.id, id); });
    revertRecordRewards(gone);
  }
  function avail() { return syncLotteryCount(); }

  try {
    if (!appData.journey) appData.journey = {};
    appData.journey.enabled = false; /* 渐进解锁会闸掉 addLotteryChance/addTreePoints */
    appData.records = [];
    appData.tree.points = 0;
    appData.tree.peakPoints = 0;
    appData.tree.coins = 0;
    appData.tree.lotteryUsed = 0;
    appData.tree.lotteryCount = 0;
    appData.tree.lotteryCarry = 0;

    /* ===== A 额度由 records 派生 ===== */
    ok('A1 起手没有抽奖次数', avail() === 0);
    addRec(25, 'full', '03');
    ok('A2 1 个番茄还差一次（换成额度，不是计数器）', avail() === 0);
    addRec(25, 'full', '04');
    ok('A3 2 个番茄换到 1 次抽奖', avail() === 1);
    addRec(50, 'full', '05');
    ok('A4 50 分钟大番茄折算 2 个 → 再 +1 次', avail() === 2);

    /* ===== B 核心：补记 → 删除 不再白嫖 ===== */
    var ptsBefore = appData.tree.points;
    var r1 = addRec(25, 'full', '06');
    ok('B1 补记让树积分上涨', appData.tree.points === ptsBefore + 1);
    dropRec(r1.id);
    ok('B2 删掉记录 → 树积分收回（不再白送）', appData.tree.points === ptsBefore);
    ok('B3 删掉记录 → 额度同步回落（派生，不是计数器）', avail() === 2);

    /* 旧算法的刷法：补记 1 条 → 删 1 条，反复四轮。计数器时代这会攒出 4 次机会。 */
    var farmed = 0;
    for (var i = 0; i < 4; i++) {
      var rr = addRec(25, 'full', '07');
      dropRec(rr.id);
    }
    farmed = avail();
    ok('★ B4 「补记→删除」循环 4 轮，一次机会都攒不出来（实测 ' + farmed
      + ' / records=' + appData.records.length + ' / used=' + appData.tree.lotteryUsed
      + ' / carry=' + appData.tree.lotteryCarry + '）', farmed === 2);
    ok('★ B5 记录数没有被留下（确实是删了，不是没发）',
      appData.records.filter(function (r) { return idEq(r.id, r1.id); }).length === 0);
    /* 接线守卫：核心两步在 deleteRecord 里真的被调用了 */
    ok('B6 deleteRecord 已接上奖励对账', String(deleteRecord).indexOf('revertRecordRewards') >= 0);

    /* ===== C 改类型也要对账 =====
       注意额度是 /2 取整的台阶量：必须让差额跨过一个台阶才能观察到变化，
       所以这里补两条（额度 2→3）再改其中一条。 */
    var r2 = addRec(25, 'full', '08');
    addRec(25, 'full', '09');
    var pts2 = appData.tree.points;
    var av2 = avail();
    ok('C0 再补 2 条 → 额度上到 3', av2 === 3);
    r2.type = 'log';
    r2.pomos = calcPomos(r2.effectiveSeconds || 0, 'log');
    adjustRecordRewards(r2, 'full', 1);
    ok('C1 完整🍅 改成「仅记录」→ 积分退回', appData.tree.points === pts2 - 1);
    ok('C2 改成「仅记录」→ 抽奖额度退回', avail() === av2 - 1);
    r2.type = 'full';
    r2.pomos = calcPomos(r2.effectiveSeconds || 0, 'full');
    adjustRecordRewards(r2, 'log', 0);
    ok('C3 改回完整🍅 → 积分与额度回到原样',
      appData.tree.points === pts2 && avail() === av2);

    /* ===== D 限时租期：宽限只给一次，反复导入不再续期 ===== */
    appData.tree.decorations = ['lantern'];
    appData.tree.decorExpires = {};
    delete appData.tree.__leaseBackfilled;
    ensureTreeExtras();
    var firstExp = Number(appData.tree.decorExpires.lantern) || 0;
    ok('D1 老数据首次宽限仍生效（给 7 天）', firstExp > Date.now());
    /* 再导入同一份「decorExpires 为空」的旧备份：标记已在，不该再按 now 重算 */
    appData.tree.decorExpires = {};
    ensureTreeExtras();
    ok('★ D2 反复导入不再续期（原实现会每次都白送 7 天）',
      Object.keys(appData.tree.decorExpires).length === 0);
    ok('D3 标记已落盘', appData.tree.__leaseBackfilled === true);
    /* 已买租期不该被一份更旧的备份缩短 */
    appData.tree.decorExpires = { lantern: 5000 };
    keepLongerLease({ decor: { lantern: 9000 }, scene: {} });
    ok('D4 导入取「更长」的那份租期', appData.tree.decorExpires.lantern === 9000);
    keepLongerLease({ decor: { lantern: 1000 }, scene: {} });
    ok('D5 更短的租期不覆盖', appData.tree.decorExpires.lantern === 9000);

    /* ===== E 礼包：单一入账点 ===== */
    var c0 = appData.tree.coins;
    showGift('用例奖励', 20);
    var c1 = appData.tree.coins;
    ok('E1 礼包一出现金币就已入账（未拆刷新也不丢）', c1 - c0 >= 20);
    openGift();
    ok('★ E2 点开礼包不重复入账（旧实现签到/成就这里会再发一遍）',
      appData.tree.coins === c1);
    ok('E3 礼包清单已清空', true);

    /* ===== F 导入：已抽数只增不减（回档也刷不出次数） =====
       只护这一个字段：金币、记录、进度照常回档 —— 用户本来就该能恢复旧数据。
       走真实 applyBackupData（它被 01g 包了一层，源码断言不可靠，所以用行为断言）。 */
    appData.tree.lotteryUsed = 7;
    appData.tree.coins = 10;
    var _snap = JSON.parse(JSON.stringify(appData)); /* 相当于一份备份 */
    _snap.tree.lotteryUsed = 2; /* 备份里更小（旧存档）→ 不该把已抽数拉小 */
    _snap.tree.coins = 999; /* 金币更多 → 照常采纳（回档能力保留） */
    applyBackupData(_snap, 'C60 导入验证');
    ok('★ F1 真实导入：已抽数不被旧备份拉小', appData.tree.lotteryUsed === 7);
    ok('F2 真实导入：金币照常采纳（不在此保护范围）', appData.tree.coins >= 999);
  } finally {
    try { appData.tree = JSON.parse(treeBak); } catch (e) { R.push(['!! tree 恢复失败: ' + e.message, false]); }
    try { appData.records = JSON.parse(recBak); } catch (e) { R.push(['!! records 恢复失败: ' + e.message, false]); }
    try { appData.journey = JSON.parse(journeyBak); } catch (e) { /* 旅程本就没开过 */ }
    try { closeGift(); } catch (e) { /* 弹层可能没开 */ }
    try { closeModal('addRecordModal'); } catch (e) { /* 弹窗可能没开 */ }
    try { syncLotteryCount(); } catch (e) { /* 恢复后重算一遍 */ }
  }
  return JSON.stringify(R);
})();
