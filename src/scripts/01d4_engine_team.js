/* ============================================================
 * 01d4 · 伙伴组队任务（编码/解码 / 冲刺档 / 结算）
 * 函数索引（TOC）：teamEncode/teamDecode/teamSprintExtra/teamSprintDesc/computeTeamSettlement/getMyTaskCompletedStatus/generateTeamStartCode/inputPartnerStartCode/generateTeamEndCode/inputPartnerEndCode/settleTeamTask
 * ============================================================ */
/* ===== 伙伴组队任务 ===== */
/* --- 编码/解码 (方案A: Base64 + 插入混淆) --- */
/* 编码格式（最后一段恒为随机盐，中间为「可选字段区」，按位兼容早期格式）：
   S 开始码：S|DATE|[STARS]|SALT            （4 段：S|DATE|SALT）
   E 结束码：E|DATE|COMPLETED|[FULLCOUNT]|[STARS]|SALT
             （4 段：E|DATE|COMPLETED|SALT / 5 段：E|DATE|COMPLETED|FULLCOUNT|SALT）
   STARS = 生成方当前的段位星数，队友输入后即可看到对方段位。缺失一律按 null 处理。 */
function teamEncode(type, date, completed, fullCount, stars) {
  let payload = type + '|' + date;
  if (type === 'E' && completed !== null && completed !== undefined) {
/* P 前缀 = 折算番茄点数x2（半个🍅=1）；不写前缀的纯数字 = 旧的「完整番茄数」，解码端兼容 */
    payload += '|' + (completed ? '1' : '0') + '|' + ('P' + Math.round((fullCount || 0) * 2));
  }
  let s = parseInt(stars, 10);
  if (!isNaN(s) && s >= 0) payload += '|' + s;
  let salt = Math.random().toString(36).substring(2, 10);
  payload += '|' + salt;
  let obfuscated = '';
  for (let i = 0; i < payload.length; i++) {
    obfuscated += payload[i];
    if ((i + 1) % 3 === 0) {
      obfuscated += String.fromCharCode(65 + Math.floor(Math.random() * 26));
    }
  }
  return btoa(obfuscated);
}
function teamDecode(code) {
  try {
    if (!code || typeof code !== 'string') return null;
    code = code.trim();
    let obfuscated = atob(code);
    let payload = '';
    for (let i = 0; i < obfuscated.length; i++) {
      if ((i + 1) % 4 !== 0) {
        payload += obfuscated[i];
      }
    }
    let parts = payload.split('|');
    if (parts.length < 3) return null;
    let type = parts[0];
    if (type !== 'S' && type !== 'E') return null;
    let date = parts[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    /* 末段是盐，中间全部是可选字段，按位置读取（顺序：COMPLETED → FULLCOUNT → STARS） */
    let mid = parts.slice(2, parts.length - 1);
    let completed = null,
      fullCount = null,
      stars = null;
    if (type === 'E') {
      if (mid.length < 1) return null;
      if (mid[0] === '1') completed = true;
      else if (mid[0] === '0') completed = false;
      else return null;
// 旧版只有 4 段（无番茄数/星数），一律兼容为未知
      if (mid.length >= 2) {
        let fv = mid[1];
        if (typeof fv === 'string' && fv.charAt(0) === 'P') {
          let n1 = parseInt(fv.substring(1), 10);
          if (!isNaN(n1) && n1 >= 0) fullCount = n1 / 2; /* 新版：折算番茄点数（半个=0.5） */
        } else {
          let n1 = parseInt(fv, 10);
          if (!isNaN(n1) && n1 >= 0) fullCount = n1; /* 旧版：纯完整番茄数 */
        }
      }
      if (mid.length >= 3) {
        let n2 = parseInt(mid[2], 10);
        if (!isNaN(n2) && n2 >= 0) stars = n2;
      }
    } else {
      if (mid.length >= 1) {
        let n0 = parseInt(mid[0], 10);
        if (!isNaN(n0) && n0 >= 0) stars = n0;
      }
    }
    return { type: type, date: date, completed: completed, fullCount: fullCount, stars: stars };
  } catch (e) {
    return null;
  }
}/* 合力冲刺档位：双方合计完整🍅 每达到一档就额外 +1⭐（组队星池，不受段位每日 6 星上限限制）
   想加档位直接往数组里加一项即可，例如 {goal:50,extra:1} */
const TEAM_SPRINT_TIERS = [
  { goal: 15, extra: 1 },
  { goal: 30, extra: 1 }
];
/* 按合计番茄数算出额外加星数（队友数量未知时返回 0，避免旧版编码误判） */
function teamSprintExtra(combined) {
  if (combined === null || combined === undefined) return 0;
  let extra = 0;
  TEAM_SPRINT_TIERS.forEach(function (t) {
    if (combined >= t.goal) extra += t.extra;
  });
  return extra;
}
/* 冲刺档位描述，用于提示文案 */
function teamSprintDesc(combined, extra) {
  if (!extra) return '';
  let hit = TEAM_SPRINT_TIERS.filter(function (t) {
    return combined >= t.goal;
  }).map(function (t) {
    return t.goal;
  });
  return '（合计' + fmtTomatoNum(combined) + '🍅 达成 ' + hit.join('/') + ' 档，额外+' + extra + '！）';
}
/* 组队结算规则：两处结算路径共用，避免同一套规则写两份 */
function computeTeamSettlement(taskDate, myCompleted, partnerCompleted, partnerFull) {
  if (!myCompleted && !partnerCompleted) return { starChange: -1, result: 'lose', extra: 0 };
  if (!myCompleted && partnerCompleted) return { starChange: -1, result: 'lose', extra: 0 };
  if (myCompleted && !partnerCompleted) return { starChange: 0, result: 'neutral', extra: 0 };
  let myFull = countTomatoPoints(taskDate); /* 口径与「今日🍅」一致：半个番茄记 0.5 */
  let combined = partnerFull !== null && partnerFull !== undefined ? myFull + partnerFull : null;
  let extra = teamSprintExtra(combined);
  /* 组队加成封顶：组队是「加速器」而不是第二条赛道，加成不得超过你自己今天超额星的一定比例。
     否则每天只做 4 个的挂机玩家靠组队就能追平每天做 12 个的人。保底 1 星，保证组队一定有价值。 */
  let rs = appData.rankSystem;
  let soloExcess = rs && rs.dailyTask && rs.dailyTask.date === taskDate ? rs.dailyTask.starsGainedToday || 0 : 0;
  let cap = Math.max(1, Math.ceil(soloExcess * TEAM_GAIN_RATIO));
  let rawGain = 1 + extra;
  let gain = Math.min(rawGain, cap);
  return {
    starChange: gain,
    result: 'win',
    extra: extra,
    capped: gain < rawGain,
    soloExcess: soloExcess,
    teamCap: cap,
    combined: combined,
    myFull: myFull,
    partnerFull: partnerFull
  };
}
/* 组队加成系数：0.5 = 组队每天最多再给你「自己超额星的一半」。想让组队更像陪练就调低，想鼓励组队就调高。 */
const TEAM_GAIN_RATIO = 0.5;
function getMyTaskCompletedStatus() {
  let today = getTodayStr();
  let rs = appData.rankSystem;
  /* 今日任务已延后到明天 → 今天不算完成（明天才算数） */
  if (rs.dailyTask && rs.dailyTask.postponed && rs.dailyTask.date !== today) return false;
  let todayFull = getTodayEffectiveFull();
  let target = rs.dailyTask && rs.dailyTask.date === today ? rs.dailyTask.target || 3 : 3;
  return todayFull >= target;
}
function generateTeamStartCode() {
  let ts = appData.teamSystem;
  let today = getTodayStr();
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
  if (ts.today.date !== today) {
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
  }
  ts.today.date = today;
  ts.today.myStars = getMyRankStars();
  ts.today.startCode = teamEncode('S', today, null, null, ts.today.myStars);
  saveData();
  UIFX.renderTeamSystem();
  UIFX.toast('开始码已生成，复制发给队友吧');
}
function inputPartnerStartCode() {
  let input = document.getElementById('partnerStartCodeInput');
  if (!input) return;
  let code = input.value.trim();
  if (!code) {
    UIFX.toast('请粘贴队友的开始码');
    return;
  }
  let decoded = teamDecode(code);
  if (!decoded) {
    UIFX.toast('编码无效，请检查后重新输入');
    return;
  }
  if (decoded.type !== 'S') {
    UIFX.toast('这不是开始码，请确认后重试');
    return;
  }
  let today = getTodayStr();
  if (decoded.date !== today) {
    UIFX.toast('编码已过期，请让队友生成今日开始码');
    return;
  }
  let ts = appData.teamSystem;
  if (ts.today && ts.today.startCode && code === ts.today.startCode) {
    UIFX.toast('不能输入自己的开始码，请找队友获取');
    return;
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
  if (ts.today.date !== today) {
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
  }
  ts.today.date = today;
  ts.today.partnerJoined = true;
  if (decoded.stars !== null && decoded.stars !== undefined) ts.today.partnerStars = decoded.stars;
  ts.today.partnerUpdatedAt = Date.now();
  saveData();
  input.value = '';
  UIFX.renderTeamSystem();
  let pr = UIFX.formatPartnerRank(decoded.stars);
  UIFX.toast('组队成功！今日伙伴已绑定' + (pr ? ' · 队友 ' + pr.icon + ' ' + pr.name + ' ' + pr.stars + '⭐' : ''));
}
function generateTeamEndCode() {
  let ts = appData.teamSystem;
  let today = getTodayStr();
  if (!ts.today || ts.today.date !== today) {
    UIFX.toast('请先生成今日开始码');
    return;
  }
/* 已结算也允许重新生成：输码即结算会留下「已结算」状态，朋友还等着这个码 → 可再生成；
   重生成本身不解除结算，只有队友重新输码才会回到待结算流程 */
  let completed = getMyTaskCompletedStatus();
  ts.today.myCompleted = completed;
  ts.today.myFull = countTomatoPoints(today); /* 半个番茄记 0.5，与今日🍅口径一致 */
  ts.today.myStars = getMyRankStars();
  ts.today.myEndCode = teamEncode('E', today, completed, ts.today.myFull, ts.today.myStars);
  saveData();
  UIFX.renderTeamSystem();
  if (ts.today.settled) UIFX.toast('结束码已重新生成（此前已结算，队友输入后会解除结算并待明日统一结算）');
  else UIFX.toast('结束码已生成，复制发给队友吧');
}
function inputPartnerEndCode() {
  let input = document.getElementById('partnerEndCodeInput');
  if (!input) return;
  let code = input.value.trim();
  if (!code) {
    UIFX.toast('请粘贴队友的结束码');
    return;
  }
  let decoded = teamDecode(code);
  if (!decoded) {
    UIFX.toast('编码无效，请检查后重新输入');
    return;
  }
  if (decoded.type !== 'E') {
    UIFX.toast('这不是结束码，请确认后重试');
    return;
  }
  let today = getTodayStr();
  if (decoded.date !== today) {
    UIFX.toast('编码已过期，请让队友生成今日结束码');
    return;
  }
  let ts = appData.teamSystem;
  if (ts.today && ts.today.myEndCode && code === ts.today.myEndCode) {
    UIFX.toast('不能输入自己的结束码，请找队友获取');
    return;
  }
  if (!ts.today || ts.today.date !== today) {
    UIFX.toast('请先建立今日组队关系');
    return;
  }
/* 已结算也允许重新输入：队友输码后自动解除结算，回到待结算流程（次日统一结算按最新状态执行）。
   否则「输码即结算」留下的已结算状态会把等着你码的队友卡死。 */
  let wasSettled = ts.today.settled;
  if (wasSettled) {
    ts.today.settled = false;
    ts.today.settlementResult = null;
  }
  ts.today.partnerEndCode = code;
  ts.today.partnerCompleted = decoded.completed;
// 队友数量未知（旧版编码）时保留上一次的值，避免把已有进度抹掉
  if (decoded.fullCount !== null && decoded.fullCount !== undefined) ts.today.partnerFull = decoded.fullCount;
  if (decoded.stars !== null && decoded.stars !== undefined) ts.today.partnerStars = decoded.stars;
  ts.today.partnerUpdatedAt = Date.now();
  let myCompleted = getMyTaskCompletedStatus();
  ts.today.myCompleted = myCompleted;
  ts.today.myFull = countTomatoPoints(today); /* 半个番茄记 0.5，与今日🍅口径一致 */
  /* 明日结算制：输入结束码只记录双方状态，不立即结算——
     今天想继续做冲刺（超额星/赌注）仍会累积进 pendingStars，次日早 5:00 前打开页面统一结算 */
  saveData();
  input.value = '';
  UIFX.renderTeamSystem();
  let pr2 = UIFX.formatPartnerRank(decoded.stars);
  let reMsg = wasSettled ? '（已解除此前结算，明日按最新状态统一结算）' : '';
  if (pr2)
    UIFX.toast(
      '队友段位已更新：' +
        pr2.icon +
        ' ' +
        pr2.name +
        ' ' +
        pr2.stars +
        '⭐ · 结果：' +
        (decoded.completed ? '✅ 已完成' : '❌ 未完成') +
        (myCompleted && decoded.completed ? ' · 双方已确认，明日早 5:00 前自动结算' + reMsg : '') +
        reMsg
    );
  else
    UIFX.toast(
      '队友结果已读取：' +
        (decoded.completed ? '✅ 已完成' : '❌ 未完成') +
        (myCompleted && decoded.completed ? ' · 双方已确认，明日早 5:00 前自动结算' + reMsg : '') +
        reMsg
    );
}
function settleTeamTask() {
  let ts = appData.teamSystem;
  if (!ts.today) return;
  let today = getTodayStr();
  if (ts.today.date === today && ts.today.settled) return;
  if (ts.today.date === null) return;
  if (!ts.today.partnerJoined) return;
  if (ts.today.settled) return; /* 已结算过就不再重复结算（checkNewDay/renderTeamSystem 可能多次触发） */
  let taskDate = ts.today.date;
  if (ts.today.date === today) return;
  /* 我的完成状态：以「结算当天任务的实际完成情况」为准（输入码后继续完成/冲刺也算），
     只有双方都输入过结束码才认可队友完成状态 */
  let myCompleted = ts.today.myCompleted;
  if (myCompleted === null) myCompleted = false;
  let rs = appData.rankSystem;
  if (rs.dailyTask && rs.dailyTask.date === taskDate) {
    let dayEff = getEffectiveFull(taskDate, rs.dailyTask.baseline);
    myCompleted = dayEff >= (rs.dailyTask.target || 3);
  }
  let partnerCompleted = ts.today.partnerCompleted;
  if (partnerCompleted === null) partnerCompleted = false;
  let pendingStars = rs.dailyTask ? rs.dailyTask.pendingStars || 0 : 0;
  let st = computeTeamSettlement(taskDate, myCompleted, partnerCompleted, ts.today.partnerFull);
  let starChange = st.starChange;
  let result = st.result;
  // 只有「双方都完成」才释放延迟结算的段位星，其余情况作废
  if (result === 'win') {
    if (pendingStars > 0) {
      rs.stars += pendingStars;
      rs.dailyTask.pendingStars = 0;
    }
  } else {
    rs.dailyTask.pendingStars = 0;
  }
  ts.stars = Math.max(0, ts.stars + starChange);
  ts.today.settled = true;
  ts.today.settlementResult = result;
  if (!ts.history) ts.history = [];
  ts.history.unshift({
    date: taskDate,
    myCompleted: myCompleted,
    partnerCompleted: partnerCompleted,
    result: result,
    starChange: starChange,
    extra: st.extra,
    combined: st.combined,
    myFull: st.myFull,
    partnerFull: st.partnerFull,
    stars: ts.stars
  });
  if (ts.history.length > 100) ts.history.length = 100;
  saveData();
  let msg = '';
  if (result === 'win') {
    msg = '👥 组队结算：双方都完成！+' + starChange + '⭐' + teamSprintDesc(st.combined, st.extra) + '，段位星已结算';
  } else if (result === 'neutral') {
    msg = '👥 组队结算：你完成了，队友未完成，不掉星，额外升星不予结算';
  } else {
    msg = '👥 组队结算：' + (myCompleted ? '' : '你未完成，') + '额外扣1⭐';
  }
  UIFX.showRankFeedback(msg);
}
