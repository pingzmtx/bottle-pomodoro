/* ============================================================
 * 01e3 · 组队系统 UI
 * 由 01e_engine_ui.js 按渲染域拆出（可回退：本文件整段随 slot1 files 还原）
 * 函数索引（TOC）：updateTeamCountdown/buildTeamRulesHTML/buildTeamStatusHTML/buildTeamRankHTML/buildTeamSprintHTML/buildTeamSettledHTML/buildTeamActHTML/renderTeamSystem/toggleTeamSection/clearPartnerEndCode/copyTeamCode/fallbackCopy（+2 更多）
 * ============================================================ */
function updateTeamCountdown() {
  let el = document.getElementById('teamCdTime');
  let cdEl = document.getElementById('teamCountdown');
  if (!el || !cdEl) return;
  let ts = appData.teamSystem;
  let teamActive = ts && ts.today && ts.today.partnerJoined && !ts.today.settled;
  if (!teamActive) {
    cdEl.style.display = 'none';
    return;
  }
  cdEl.style.display = 'block';
  let now = new Date();
  let midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  let diff = midnight - now;
  if (diff < 0) diff = 0;
  let h = Math.floor(diff / 3600000);
  let m = Math.floor((diff % 3600000) / 60000);
  let s = Math.floor((diff % 60000) / 1000);
  el.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  if (diff < 3600000) cdEl.classList.add('expired');
  else cdEl.classList.remove('expired');
}
/* --- UI 渲染 --- */
/* ===== renderTeamSystem 组队界面区块拆分 =====
 * 纯平移：组队 6 个输出模块（规则/状态/段位对比/合力冲刺/结算态/行动态）拆为独立顶层函数（紧贴本函数上方），
 * 各 build*HTML 返回 html 片段由主函数拼接；共享派生量 todayFull/rs/target 上提主函数计算一次后传参。
  */
function buildTeamRulesHTML() {
  let html = '';
  /* 规则介绍（折叠）：放在组队功能最上方，先看规则再操作 */
  html += '<div class="team-module">';
  html +=
    '<div class="team-module-title" onclick="toggleFold(\'teamRulesBody\',\'teamRulesArrow\')" style="cursor:pointer;">📖 规则介绍 <span id="teamRulesArrow">▸</span></div>';
  html += '<div id="teamRulesBody" style="display:none;font-size:var(--fs-title);line-height:1.7;color:var(--text-light);">';
  html +=
    '<div style="background:#FFF3CD;border:1px solid var(--yellow);border-radius:var(--radius);padding:var(--sp-10) var(--sp-12);margin-bottom:var(--sp-10);">';
  html += '<b style="color:var(--text);">📌 先记住最重要的一点：</b><br>';
  html +=
    '组队<b style="color:var(--text);">每个人都要先完成各自的每日任务</b>，共同冲刺只是在各自达标基础上的</b>！<b style="color:var(--danger);">不是只有「共同冲刺」任务</b>，共同冲刺只是在各自达标基础上的<b style="color: var(--green-ink);">额外加成</b>。<b style="color:var(--danger);">若有人没有完成任务，会不加星甚至扣星！详情见：结算与惩罚</b>';
  html += '</div>';
  html += '<b style="color:var(--text);">👥 我的段位 &amp; 队友段位</b><br>';
  html +=
    '<span style="display:block;">① 开始码/结束码里都<b style="color:var(--text);">携带了生成方当前的段位星数</b>，录入后即可看到队友段位。</span>';
  html +=
    '<span style="display:block;">② 任务未完成也能提前再次输入，<b style="color:var(--text);">可以反复输入</b>每输入一次新的码都能刷新对方段位</span>';
  html +=
    '<span style="display:block;">③ 段位信息<b style="color:var(--text);">只在当天有效</b>，过零点自动清空并回到初始界面，次日需重新生成开始码。</span>';
  html += '<div style="height:8px;"></div>';
  html += '<b style="color:var(--text);">🏃 组队目标</b><br>';
  html +=
    '<span style="display:block;">① <b style="color: var(--green-ink);">双方都完成各自的每日段位任务</b> → <b style="color: var(--green-ink);">+1⭐</b>（不受 6 星上限），另按合力冲刺分档再加成；结算统一在<b style="color:var(--text);">次日早 5:00 前</b>（打开页面时自动结算，今天可继续安心冲刺）</span>';
  html +=
    '<span style="display:block;">② <b style="color: var(--green-ink);">合力冲刺（分档）</b>：双方<b style="color:var(--text);">合计</b>完整🍅 每达到一档，额外 +1⭐，可叠加：</span>';
  TEAM_SPRINT_TIERS.forEach(function (t, i) {
    html +=
      '<span style="display:inline-block;margin:var(--sp-2) var(--sp-6) var(--sp-2) 0;padding:var(--sp-2) var(--sp-8);border-radius:var(--radius-input);background:rgba(92,184,92,0.12);color: var(--green-ink);font-weight:700;">第' +
      (i + 1) +
      '档 合计' +
      t.goal +
      '🍅 → +' +
      t.extra +
      '⭐</span>';
  });
  html +=
    '<span style="display:block;margin-top:var(--sp-4);">冲刺星与基础星同样<b style="color:var(--text);">不受每日 6 星上限</b>影响，全部达成时当天共 <b style="color: var(--green-ink);">+' +
    (1 + teamSprintExtra(TEAM_SPRINT_TIERS[TEAM_SPRINT_TIERS.length - 1].goal)) +
    '⭐</b>（基础 1 + 冲刺 ' +
    teamSprintExtra(TEAM_SPRINT_TIERS[TEAM_SPRINT_TIERS.length - 1].goal) +
    '）。</span>';
  html += '<div style="height:8px;"></div>';
  html += '<b style="color:var(--text);">⚖️ 组队加成封顶</b><br>';
  html +=
    '<span style="display:block;">组队是<b style="color:var(--text);">加速器，不是第二条赛道</b>：一天最多再给你 <b style="color: var(--primary-ink);">你今天超额星的一半（向上取整）</b>，<b>保底 +1⭐</b>。</span>';
  html += '<span style="display:block;">想拿满组队加成，先把自己今天的超额做出来吧～</span>';
  html += '<div style="height:8px;"></div>';
  html += '<b style="color:var(--text);">📋 结算与惩罚</b><br>';
  html +=
    '<span style="display:block;">✅ <b style="color: var(--green-ink);">双方都完成</b>：额外+1⭐，额外升的段位星照常结算。</span>';
  html +=
    '<span style="display:block;">➖ <b style="color: var(--yellow-ink);">你完成 / 队友未完成</b>：不掉星，额外升的段位星不予结算（作废）。</span>';
  html +=
    '<span style="display:block;">❌ <b style="color:var(--danger);">你未完成 / 队友完成</b>：额外扣 1⭐（段位减星另算）。</span>';
  html += '<span style="display:block;">❌ <b style="color:var(--danger);">双方未完成</b>：双方各额外扣 1⭐。</span>';
  html +=
    '<span style="display:block;">⏰ <b style="color:var(--text);">次日早 5:00 前自动结算</b>（打开页面时触发）：今天输完结束码只算"确认状态"，星统一明天结算，今天继续做冲刺也能算进组队加成；未输入队友结束码，默认队友未完成。</span>';
  html += '<span style="display:block;">💤 <b style="color:var(--text);">未组队</b>：不计时、不结算、不扣星。</span>';
  html += '<div style="height:8px;"></div>';
  html += '<b style="color:var(--text);">🔄 组队时的升星流程</b><br>';
  html +=
    '<span style="display:block;">组队期间，段位系统超额升星会<b style="color:var(--text);">延迟到次日早 5:00 前统一结算</b>（今天做多少都先攒着），等组队结果出来再按规则发放或作废。</span>';
  html += '</div>';
  html += '</div>';
  return html;
}

function buildTeamStatusHTML(ts, settled, myCompleted, todayFull, target) {
  let html = '';
  /* 状态总览 */
  html +=
    '<div style="background:var(--surface-2);border:0;border-radius:var(--radius);padding:var(--sp-10);margin-bottom:var(--sp-12);">';
  html += '<div class="team-status-row"><span class="team-status-label">今日组队</span>';
  if (settled) {
    html += '<span class="team-status-val fail">已结算</span>';
  } else if (ts.today.partnerJoined) {
    html += '<span class="team-status-val success">已组队 ✅</span>';
  } else if (ts.today.startCode) {
    html += '<span class="team-status-val pending">等待队友加入…</span>';
  } else {
    html += '<span class="team-status-val pending">未开始</span>';
  }
  html += '</div>';
  html += '<div class="team-status-row"><span class="team-status-label">我的任务</span>';
  if (settled) {
    html +=
      '<span class="team-status-val ' +
      (ts.today.myCompleted ? 'success' : 'fail') +
      '">' +
      (ts.today.myCompleted ? '✅ 已完成' : '❌ 未完成') +
      '</span>';
  } else {
    html +=
      '<span class="team-status-val ' +
      (myCompleted ? 'success' : 'pending') +
      '">' +
      todayFull +
      '/' +
      target +
      (myCompleted ? ' ✅' : '') +
      '</span>';
  }
  html += '</div>';
  html += '<div class="team-status-row"><span class="team-status-label">队友状态</span>';
  if (settled) {
    html +=
      '<span class="team-status-val ' +
      (ts.today.partnerCompleted ? 'success' : 'fail') +
      '">' +
      (ts.today.partnerCompleted ? '✅ 已完成' : '❌ 未完成') +
      '</span>';
  } else if (ts.today.partnerCompleted !== null) {
    html +=
      '<span class="team-status-val ' +
      (ts.today.partnerCompleted ? 'success' : 'fail') +
      '">' +
      (ts.today.partnerCompleted ? '✅ 已完成' : '❌ 未完成') +
      '</span>';
  } else {
    html += '<span class="team-status-val pending">⏳ 待确认</span>';
  }
  html += '</div>';
  return html;
}

function buildTeamRankHTML(ts, settled) {
  let html = '';
  /* 段位对比：我的 vs 队友（队友星数来自其开始码/结束码，过零点随组队关系一起清空） */
  let myRank = formatPartnerRank(getMyRankStars()) || { icon: '🥉', name: '青铜 Ⅲ', stars: 0, color: '#B87333' };
  let pRank = formatPartnerRank(ts.today.partnerStars);
  html +=
    '<div style="margin-top:var(--sp-8);padding-top:var(--sp-8);border-top:1px solid var(--hairline);display:flex;gap:var(--sp-8);align-items:stretch;">';
  html +=
    '<div style="flex:1;min-width:0;text-align:center;padding:var(--sp-6) var(--sp-4);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);">';
  html += '<div style="font-size:var(--fs-body);color:var(--text-light);margin-bottom:var(--sp-2);">我的段位</div>';
  html +=
    '<div style="font-size:var(--fs-title);font-weight:800;color:' +
    myRank.color +
    ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
    myRank.icon +
    ' ' +
    myRank.name +
    '</div>';
  html += '<div style="font-size:var(--fs-title);font-weight:800;color:' + myRank.color + ';">' + myRank.stars + ' ⭐</div>';
  html += '</div>';
  html += '<div style="flex:0 0 auto;align-self:center;font-size:var(--fs-sub);color:var(--text-light);">⚔️</div>';
  html +=
    '<div style="flex:1;min-width:0;text-align:center;padding:var(--sp-6) var(--sp-4);background:var(--bg);border:1px solid ' +
    (pRank ? pRank.color : 'var(--border)') +
    ';border-radius:var(--radius);">';
  html +=
    '<div style="font-size:var(--fs-body);color:var(--text-light);margin-bottom:var(--sp-2);">队友段位' +
    (ts.today.partnerUpdatedAt ? ' · ' + formatClockTime(ts.today.partnerUpdatedAt) : '') +
    '</div>';
  if (pRank) {
    html +=
      '<div style="font-size:var(--fs-title);font-weight:800;color:' +
      pRank.color +
      ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      pRank.icon +
      ' ' +
      pRank.name +
      '</div>';
    html += '<div style="font-size:var(--fs-title);font-weight:800;color:' + pRank.color + ';">' + pRank.stars + ' ⭐</div>';
  } else {
    html +=
      '<div style="font-size:var(--fs-title);color:var(--text-light);line-height:1.5;padding:var(--sp-4) 0;">❔ 未知<br><span style="font-size:var(--fs-body);">录入队友的开始码<br>或结束码即可显示</span></div>';
  }
  html += '</div>';
  html += '</div>';
  if (settled && pRank) {
    /* 已结算：明确告诉用户段位不会消失，会一直留到零点 */
    html +=
      '<div style="font-size:var(--fs-body);color:var(--text-light);margin-top:var(--sp-4);line-height:1.5;">📌 今日已结算，<b style="color:var(--text);">队友段位仍保留在这里</b>，一直显示到今晚 24:00；过零点后自动清空、回到初始组队界面。</div>';
  } else {
    html +=
      '<div style="font-size:var(--fs-body);color:var(--text-light);margin-top:var(--sp-4);line-height:1.5;">队友段位随其编码一起传过来；<b style="color:var(--text);">任务没做完也能提前输、且可反复输入</b>来刷新。组队只在当日有效，过零点后自动清空、回到初始界面。</div>';
  }
  return html;
}

function buildTeamSprintHTML(ts, today) {
  let html = '';
  /* 合力冲刺进度：分档展示，让「合计15/30🍅各额外+1⭐」看得见 */
  let myCnt =
    ts.today.settled && ts.today.myFull !== null && ts.today.myFull !== undefined
      ? ts.today.myFull
      : countTomatoPoints(today); /* 今日未结算时用实时数量，冲刺继续做也实时涨；半个记0.5 */
  let pCnt = ts.today.partnerFull;
  let pKnown = pCnt !== null && pCnt !== undefined;
  let combined = pKnown ? myCnt + pCnt : myCnt;
  let extra = teamSprintExtra(pKnown ? combined : null);
  let maxGoal = TEAM_SPRINT_TIERS[TEAM_SPRINT_TIERS.length - 1].goal;
  let pct = Math.min(100, Math.round((combined / maxGoal) * 100));
  html += '<div style="margin-top:var(--sp-6);">';
  html +=
    '<div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-4);">';
  html +=
    '<span>合力冲刺（我 ' +
    fmtTomatoNum(myCnt) +
    ' + 队友 ' +
    (pKnown ? fmtTomatoNum(pCnt) : '?') +
    '）</span>';
  /* 一档都没到就别显示「额外+0⭐」，直接写未解锁；达成才显示档数与加星 */
  html +=
    '<span style="font-weight:700;color:' +
    (extra > 0 ? 'var(--green)' : 'var(--text-light)') +
    ';">' +
    (extra > 0
      ? combined +
        ' 🍅 · 已达成 ' +
        TEAM_SPRINT_TIERS.filter(function (t) {
          return combined >= t.goal;
        }).length +
        ' 档 → 额外+' +
        extra +
        '⭐'
      : '未解锁') +
    '</span>';
  html += '</div>';
  html +=
    '<div style="height:6px;background:var(--bg);border-radius:var(--radius-xs);overflow:hidden;"><div style="height:100%;width:' +
    pct +
    '%;background:' +
    (extra >= TEAM_SPRINT_TIERS.length ? 'var(--green)' : 'var(--primary)') +
    ';border-radius:var(--radius-xs);transition:width .4s ease;"></div></div>';
  /* 各档位达成情况 */
  html += '<div style="display:flex;gap:var(--sp-6);margin-top:var(--sp-6);">';
  TEAM_SPRINT_TIERS.forEach(function (t) {
    let ok = combined >= t.goal;
    html +=
      '<div style="flex:1;text-align:center;padding:var(--sp-4) var(--sp-2);border-radius:var(--radius-sm);font-size:var(--fs-body);font-weight:700;border:1px solid ' +
      (ok ? 'var(--green)' : 'var(--border)') +
      ';background:' +
      (ok ? 'rgba(92,184,92,0.12)' : 'transparent') +
      ';color:' +
      (ok ? 'var(--green)' : 'var(--text-light)') +
      ';">' +
      (ok ? '✅' : '🎯') +
      ' ' +
      t.goal +
      '🍅 +' +
      t.extra +
      '⭐</div>';
  });
  html += '</div>';
  let nextTier = null;
  TEAM_SPRINT_TIERS.forEach(function (t) {
    if (!nextTier && combined < t.goal) nextTier = t;
  });
  html +=
    '<div style="font-size:var(--fs-body);color:var(--text-light);margin-top:var(--sp-4);">' +
    (nextTier
      ? '还差 ' + (nextTier.goal - combined) + ' 个🍅解锁 +' + nextTier.extra + '⭐'
      : '🏆 全部档位已达成，双方都完成共 +' + (1 + extra) + '⭐') +
    (pKnown ? '' : '（队友数量待确认）') +
    '，均不受每日6星上限</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function buildTeamSettledHTML(ts, today, myCompleted) {
  let html = '';
    let sr = ts.today.settlementResult;
    let sc = ts.history[0] ? ts.history[0].starChange : 0;
    let cls = 'neutral';
    let title = '';
    let detail = '';
    if (sr === 'win') {
      cls = '';
      title = '🎉 双方完成！';
      detail = '各+1颗星';
    } else if (sr === 'neutral') {
      cls = 'neutral';
      title = '✅ 你完成了';
      let deduct = ts.pendingRankStarDeduction || 0;
      detail = '队友未完成，你不掉星';
      if (deduct > 0) detail += '。今日额外升的' + deduct + '⭐明天扣回';
    } else {
      cls = 'lose';
      title = '💔 结算结果';
      detail = myCompleted ? '队友也未完成，双方各扣1星' : '你未完成，扣1星';
    }
    html += '<div class="team-settlement ' + cls + '">';
    html += '<div class="team-settlement-title">' + title + '</div>';
    /* 0 星属于「不掉不加」，不该用红色（lose）渲染成 -0，单独走灰色 */
    html +=
      '<div class="star-change ' +
      (sc > 0 ? 'gain' : sc < 0 ? 'lose' : '') +
      '"' +
      (sc === 0 ? ' style="color:var(--text-light);"' : '') +
      '>' +
      (sc > 0 ? '+' + sc + ' ⭐' : sc < 0 ? sc + ' ⭐' : '±0 ⭐') +
      '</div>';
    html += '<div class="team-settlement-detail">' + detail + '</div>';
    html += '</div>';
    let pRankS = formatPartnerRank(ts.today.partnerStars);
    html +=
      '<div style="text-align:center;font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-8);line-height:1.6;">今日组队已结算，明天请重新生成开始码' +
      (pRankS
        ? '<br><span style="font-size:var(--fs-title);">上方队友段位（' +
          pRankS.icon +
          ' ' +
          pRankS.name +
          ' ' +
          pRankS.stars +
          '⭐）<b style="color:var(--text);">保留到今晚 24:00</b>，零点自动清空</span>'
        : '') +
      '</div>';
    /* 已结算后补操作区：旧版「输码即结算」遗留的状态下，朋友还等着结束码 →
       允许重新生成结束码 / 重新输入队友码（输码后自动解除结算，次日统一结算按最新状态执行） */
    if (ts.today.date === today) {
      html += '<div class="team-module" style="margin-top:var(--sp-8);border-color:#FFE082;background:#FFFDF5;">';
      html += '<div class="team-module-title">🔓 补充操作（已结算也可继续）</div>';
      html +=
        '<div style="font-size:var(--fs-body);color:var(--text-light);margin-bottom:var(--sp-6);line-height:1.5;">旧版已结算？<b style="color:var(--text);">重新生成结束码发给队友</b>；队友输码后会<b style="color: var(--green-ink);">自动解除结算</b>，明日早 5:00 前按最新状态统一结算。</div>';
      if (ts.today.myEndCode) {
        html += '<div class="team-code-output">' + escapeHtml(ts.today.myEndCode) + '</div>';
        html += '<div style="display:flex;gap:var(--sp-6);margin-top:var(--sp-6);">';
        html +=
          '<button class="team-btn secondary" onclick="copyTeamCode(\'' +
          ts.today.myEndCode +
          '\')">📋 复制结束码</button>';
        html += '<button class="team-btn secondary" onclick="generateTeamEndCode()">🔄 重新生成</button>';
        html += '</div>';
      } else {
        html +=
          '<button class="team-btn blue" style="width:100%;" onclick="generateTeamEndCode()">生成我的结束码</button>';
      }
      html += '<div class="team-code-box" style="margin-top:var(--sp-8);">';
      html += '<input type="text" class="team-code-input" id="partnerEndCodeInput" placeholder="粘贴队友的结束码…">';
      html += '<button class="team-btn" onclick="inputPartnerEndCode()">确认</button>';
      html += '</div>';
      html += '</div>';
  }
  return html;
}

function buildTeamActHTML(ts, today, todayFull, target, myCompleted) {
  let html = '';
    /* 模块1: 生成开始码 */
    html += '<div class="team-module">';
    html += '<div class="team-module-title"><span class="team-module-num">1</span>发起组队</div>';
    if (ts.today.startCode) {
      html += '<div class="team-code-output">' + escapeHtml(ts.today.startCode) + '</div>';
      html += '<div style="display:flex;gap:var(--sp-6);margin-top:var(--sp-6);">';
      html +=
        '<button class="team-btn secondary" onclick="copyTeamCode(\'' +
        ts.today.startCode +
        '\')">📋 复制开始码</button>';
      html += '<button class="team-btn secondary" onclick="generateTeamStartCode()">🔄 重新生成</button>';
      html += '</div>';
    } else {
      html += '<button class="team-btn" style="width:100%;" onclick="generateTeamStartCode()">生成今日开始码</button>';
    }
    html += '</div>';
    /* 模块2: 输入队友开始码 */
    html += '<div class="team-module">';
    html += '<div class="team-module-title"><span class="team-module-num">2</span>加入组队</div>';
    if (ts.today.partnerJoined) {
      html +=
        '<div style="font-size:var(--fs-title);color: var(--green-ink);font-weight:700;text-align:center;padding:var(--sp-6) 0 var(--sp-2);">✅ 已与队友结成今日组队</div>';
      let prA = formatPartnerRank(ts.today.partnerStars);
      html +=
        '<div style="text-align:center;font-size:var(--fs-title);color:var(--text-light);padding-bottom:var(--sp-4);">' +
        (prA ? '队友段位：' + prA.html : '队友段位：❔ 未知（旧版开始码不含星数，可让对方重新生成）') +
        '</div>';
    } else {
      html += '<div class="team-code-box">';
      html += '<input type="text" class="team-code-input" id="partnerStartCodeInput" placeholder="粘贴队友的开始码…">';
      html += '<button class="team-btn green" onclick="inputPartnerStartCode()">确认</button>';
      html += '</div>';
    }
    html += '</div>';
    /* 模块3: 生成结束码 */
    html += '<div class="team-module">';
    html += '<div class="team-module-title"><span class="team-module-num">3</span>生成我的结束码</div>';
    html +=
      '<div style="font-size:var(--fs-title);color:var(--text-light);margin-bottom:var(--sp-6);">今日任务：' +
      todayFull +
      '/' +
      target +
      (myCompleted ? ' ✅ 已完成' : ' ⏳ 进行中') +
      '</div>';
    if (ts.today.myEndCode) {
      html += '<div class="team-code-output">' + escapeHtml(ts.today.myEndCode) + '</div>';
      html += '<div style="display:flex;gap:var(--sp-6);margin-top:var(--sp-6);">';
      html +=
        '<button class="team-btn secondary" onclick="copyTeamCode(\'' +
        ts.today.myEndCode +
        '\')">📋 复制结束码</button>';
      html += '<button class="team-btn secondary" onclick="generateTeamEndCode()">🔄 重新生成</button>';
      html += '</div>';
      if (ts.today.myCompleted !== null) {
        html +=
          '<div style="font-size:var(--fs-title);margin-top:var(--sp-4);font-weight:700;color:' +
          (ts.today.myCompleted ? 'var(--green)' : 'var(--danger)') +
          ';">本机状态：' +
          (ts.today.myCompleted ? '已完成' : '未完成') +
          '</div>';
      }
    } else {
      html +=
        '<button class="team-btn blue" style="width:100%;" onclick="generateTeamEndCode()">生成我的结束码</button>';
      html +=
        '<div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-4);line-height:1.4;">做完或放弃任务后点击生成，系统自动检测完成状态</div>';
    }
    html += '</div>';
    /* 模块4: 输入队友结束码 */
    html += '<div class="team-module">';
    html += '<div class="team-module-title"><span class="team-module-num">4</span>输入队友结束码</div>';
    let hasResult = ts.today.partnerCompleted !== null;
    if (hasResult) {
      html +=
        '<div style="font-size:var(--fs-title);font-weight:700;text-align:center;padding:var(--sp-6);color:' +
        (ts.today.partnerCompleted ? 'var(--green)' : 'var(--danger)') +
        ';">队友结果：' +
        (ts.today.partnerCompleted ? '✅ 已完成' : '❌ 未完成') +
        '</div>';
      let prB = formatPartnerRank(ts.today.partnerStars);
      if (prB)
        html +=
          '<div style="text-align:center;font-size:var(--fs-title);color:var(--text-light);">队友段位：' +
          prB.html +
          (ts.today.partnerUpdatedAt
            ? ' <span style="font-size:var(--fs-body);">(' + formatClockTime(ts.today.partnerUpdatedAt) + ' 更新)</span>'
            : '') +
          '</div>';
      if (ts.today.partnerFull !== null && ts.today.partnerFull !== undefined)
        html +=
          '<div style="text-align:center;font-size:var(--fs-title);color:var(--text-light);">队友今日 ' +
          ts.today.partnerFull +
          ' 🍅</div>';
    }
    /* 输入框常驻：不管有没有录过，都能直接贴新码再刷一次，不用先清再输 */
    html += '<div class="team-code-box"' + (hasResult ? ' style="margin-top:var(--sp-6);"' : '') + '>';
    html +=
      '<input type="text" class="team-code-input" id="partnerEndCodeInput" placeholder="' +
      (hasResult ? '贴队友的新结束码，再刷新一次…' : '粘贴队友的结束码…') +
      '">';
    html +=
      '<button class="team-btn" onclick="inputPartnerEndCode()">' + (hasResult ? '再刷一次' : '确认') + '</button>';
    html += '</div>';
    html +=
      '<div style="font-size:var(--fs-title);color:var(--text-light);margin-top:var(--sp-4);line-height:1.5;">💡 <b style="color:var(--text);">想输几次就输几次</b>：任务<b style="color:var(--text);">没做完也能提前输</b>，随时刷新队友的段位星与番茄数。输完结束码只记录双方状态，<b style="color:var(--text);">星统一在次日早 5:00 前结算</b>（打开页面自动结算），今天想继续冲刺随时可以。</div>';
    if (hasResult) {
      html +=
        '<button class="team-btn secondary" style="width:100%;margin-top:var(--sp-6);" onclick="clearPartnerEndCode()">清除已录入的结果（保留队友段位）</button>';
    }
    html += '</div>';
  return html;
}

function renderTeamSystem() {
  let ts = appData.teamSystem;
  if (!ts) {
    ts = createDefaultAppData().teamSystem;
    appData.teamSystem = ts;
  }
  if (!ts.today)
    ts.today = {
      date: null,
      startCode: null,
      partnerJoined: false,
      myEndCode: null,
      myCompleted: null,
      partnerEndCode: null,
      partnerCompleted: null,
      settled: false,
      settlementResult: null
    };
  if (!ts.history) ts.history = [];
  let today = getTodayStr();
  let todayActive = ts.today.date === today;
  if (!todayActive && ts.today.date && !ts.today.settled) {
    settleTeamTask();
  }
  if (!todayActive) {
    ts.today = {
      date: today,
      startCode: null,
      partnerJoined: false,
      myEndCode: null,
      myCompleted: null,
      partnerEndCode: null,
      partnerCompleted: null,
      settled: false,
      settlementResult: null
    };
    todayActive = true;
  }
  let badge = document.getElementById('teamStarBadge');
  if (badge) badge.textContent = ts.stars + ' ⭐';
  let content = document.getElementById('teamContent');
  if (!content) return;
  let settled = ts.today.settled;
  let myCompleted = getMyTaskCompletedStatus();
  let html = '';
  let todayFull = getTodayEffectiveFull();
  let rs = appData.rankSystem;
  let target = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask.target || 3 : 3;
  html += buildTeamRulesHTML();
  html += buildTeamStatusHTML(ts, settled, myCompleted, todayFull, target);
  html += buildTeamRankHTML(ts, settled);
  html += buildTeamSprintHTML(ts, today);
  if (settled) {
    html += buildTeamSettledHTML(ts, today, myCompleted);
  } else {
    html += buildTeamActHTML(ts, today, todayFull, target, myCompleted);
  }
  content.innerHTML = html;
  renderTeamHistory();
}
function toggleTeamSection() {
  let body = document.getElementById('teamBody');
  let arrow = document.getElementById('teamSectionArrow');
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = 'block';
    if (arrow) arrow.textContent = '▾';
    renderTeamSystem();
  } else {
    body.style.display = 'none';
    if (arrow) arrow.textContent = '▸';
  }
}
function clearPartnerEndCode() {
  let ts = appData.teamSystem;
  // 只清「结果」，保留已从编码里读到的队友段位星/番茄数，方便重新输入新码对比
  if (ts.today) {
    ts.today.partnerEndCode = null;
    ts.today.partnerCompleted = null;
    saveData();
    renderTeamSystem();
  }
}
function copyTeamCode(code) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(code)
      .then(function () {
        showToast('已复制到剪贴板');
      })
      .catch(function () {
        fallbackCopy(code);
      });
  } else {
    fallbackCopy(code);
  }
}
function fallbackCopy(code) {
  let ta = document.createElement('textarea');
  ta.value = code;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('已复制到剪贴板');
  } catch (e) {
    showToast('复制失败，请手动复制');
  }
  document.body.removeChild(ta);
}
function toggleTeamHistory() {
  let el = document.getElementById('teamHistoryList');
  let toggle = document.getElementById('teamHistoryToggle');
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    toggle.textContent = '📋 收起组队历史';
    renderTeamHistory();
  } else {
    el.style.display = 'none';
    toggle.textContent = '📋 查看组队历史';
  }
}
function renderTeamHistory() {
  let el = document.getElementById('teamHistoryList');
  if (!el) return;
  let ts = appData.teamSystem;
  if (!ts.history || !ts.history.length) {
    el.innerHTML =
      '<div style="text-align:center;color:var(--text-light);padding:var(--sp-12);font-size:var(--fs-title);">暂无组队历史</div>';
    return;
  }
  el.innerHTML = ts.history
    .map(function (h) {
      let resultText = '';
      let color = '';
      let sc = h.starChange || 0;
      /* 0 星统一写「±0」，避免出现「+0⭐」这种自相矛盾的说法 */
      let scText = (sc > 0 ? '+' + sc : sc < 0 ? '' + sc : '±0') + '⭐';
      if (h.result === 'win') {
        resultText = '🎉 双方完成 ' + scText;
        color = 'var(--green)';
      } else if (h.result === 'neutral') {
        resultText = '✅ 你完成了 ' + scText;
        color = 'var(--yellow-dark)';
      } else {
        resultText = '💔 ' + scText;
        color = 'var(--danger)';
      }
      let myText = h.myCompleted ? '✅' : '❌';
      let partnerText = h.partnerCompleted ? '✅' : '❌';
      return (
        '<div class="team-history-item"><div><span class="team-history-date">' +
        h.date +
        '</span> <span style="font-size:var(--fs-title);color:var(--text-light);">我' +
        myText +
        ' 队友' +
        partnerText +
        '</span></div><span class="team-history-result" style="color:' +
        color +
        ';">' +
        resultText +
        '</span></div>'
      );
    })
    .join('');
}
