/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 沉浸式剧情副本 · **导入系统**：导入「副本 JSON」（独立于备份 JSON 的新格式）、
 * 校验与规范化、存独立存储、列表渲染与单条删除、格式帮助与示例下载。
 * 全部为**顶层函数声明**，跨 script 全局可见；本文件必须排在 01f_engine_immersive.js
 * **之后**加载（见 src/manifest.json 的槽 1 files）。
 * 依赖方向：本文件 → 01f（前向，安全）。唯一的跨文件依赖是 01f 的 `IMMERSIVE_SCRIPTS`
 *   （内置剧本库，只读引用，用于「副本与内置同构」的校验与同池抽卡）。
 *   反向不成立：01f **不**依赖本文件的任何东西。
 * 本文件自带：`IMPORTED_SCRIPTS_FORMAT`（打包格式标识）、`SAMPLE_IMMERSIVE_SCRIPT`
 *   （内置示例副本 = 一键体验 + JSON 活模板）、`_importedScriptsOpen` / `_imScriptPanelOpen`
 *   （面板折叠状态）。这四项在本文件之外无引用 —— 01f 剩余部分与其它 38 个文件对它们的引用数均为 0。
 * ★ 数据边界：副本剧本存**独立存储** `IMPORTED_SCRIPTS_KEY`（见 01b_engine_data.js），
 *   **不进 appData** —— 因此导出 / 恢复 / 清除个人数据都不影响它。改这块时别把它塞进 appData。 */
/* ==================== 模块: 01f2-ui-script-import.js | 职责: 沉浸式剧情副本·导入系统 | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：01f2-ui-script-import.js（源文件 01f2_ui_script_import.js）
 * 分组：ui
 * 职责：副本 JSON 的导入/校验/规范化/存储、导入列表渲染与删除、
 *       格式帮助面板、示例剧本一键导入与下载。
 *   · 只搬「顶层 function 声明 + 该域私有的顶层常量/状态」，**不搬任何顶层立即执行语句** ——
 *     因此跨 script 的加载顺序只影响「谁先定义」，不影响「谁能看见谁」。
 *   · 回退方式：把本文件内容按 TOC 顺序粘回 01f_engine_immersive.js 原位置
 *     （即 `saveImmersivePoster` 之后、文件末尾），并删掉 src/manifest.json 里本文件那一行。
 * 函数索引（TOC）：validateImportedScript/storeImportedScript/renderImportedScriptsBox/toggleImportedScripts/toggleImportedScriptPanel/openImportedScriptPanel/removeImportedScriptUI/onImportScriptFile/applyImportedScriptPayload/importSampleImmersiveScript/renderImmersiveSettingsNote/toggleHelpFold（+5 更多）
 * ============================================================ */

/* ============================================================
 * 沉浸式剧情副本 · 导入系统（5.4.6 新增）
 * 入口：设置页 → 「🎮 沉浸式专注」组 → 「🎬 剧情副本」
 * 能力：
 *   - 导入「副本 JSON」（独立于备份 JSON 的新格式），一次一个文件、支持导入多个
 *   - 副本剧本与内置剧本同构，导入后进入固定抽卡池（40% 池），玩法完全一致
 *   - 副本存独立存储（01-data.js IMPORTED_SCRIPTS_KEY），导出/恢复/清除个人数据均不影响
 *   - 「导入的剧情」在设置里默认折叠成一行，点开看列表，可单条删除
 * ============================================================ */
const IMPORTED_SCRIPTS_FORMAT = 'immersive_script_pack'; /* 打包文件顶层 format 标识 */
/* 内置示例副本：既是「一键体验」，也是 JSON 格式的活模板（与 IMMERSIVE_SCRIPTS 元素完全同构） */
const SAMPLE_IMMERSIVE_SCRIPT = {
  id: 'sample_abyss',
  series: '深海谜城',
  seriesIcon: '🌊',
  themeColor: '#26A69A',
  role: {
    name: '深潜员·阿澈',
    title: '失联海底城的最后一名调查员',
    avatar: '🤿',
    stats: { 耐力: 72, 智力: 80, 幸运: 60, 专注: 78 },
    intro:
      '卫星图上，传说沉没了 300 年的「渊城」亮起了灯。你背上氧气瓶，向 400 米深的海沟下潜——4 个番茄，找到它沉睡的秘密。'
  },
  ambient: '深海回声 · 缓慢的气泡声',
  chapters: [
    {
      title: '坠入海沟',
      summary: '下潜途中，声呐捕捉到一串规律的敲击声',
      scene: '海沟边缘 · 探照灯劈开黑暗',
      stages: [
        { pct: 0, text: '调整浮力，跟着声呐信号下潜' },
        { pct: 50, text: '敲击声越来越近，稳住呼吸' },
        { pct: 85, text: '灯光照到一面锈蚀的巨门！' }
      ],
      liveEvent: {
        atPct: 60,
        title: '🚨 紧急事件：洋流突袭！',
        text: '一股冷洋流横冲过来！保持专注直到本章结束即可稳住潜航器。',
        win: '你稳住潜航器，巨门近在眼前。',
        lose: '洋流把你卷离航线，氧气多耗了一截……'
      },
      text: '声呐捕捉到规律的敲击声——像是某种信号。选择「回应信号」，获得【渊城残卷】。',
      success: '回应信号 · 获得【渊城残卷】',
      fail: '信号中断：残卷线索沉入泥沙',
      voice: '咚、咚、咚——是……活着的城市？'
    },
    {
      title: '水闸迷宫',
      summary: '巨门后是灌满水的闸室，机关重重',
      scene: '闸室 · 幽蓝的水下灯一盏盏亮起',
      stages: [
        { pct: 0, text: '对照残卷上的纹路寻找闸口' },
        { pct: 50, text: '水位开始上升，抓紧时间' },
        { pct: 85, text: '主闸缓缓开启，前方透出光！' }
      ],
      liveEvent: {
        atPct: 70,
        title: '🚨 紧急事件：闸门正在关闭！',
        text: '古老的闸门开始自动闭合！保持专注到本章结束即可在关闭前通过。',
        win: '你贴地滑过闸底，进入内城！',
        lose: '闸门合拢，你只能绕行更远的管道……'
      },
      text: '闸室机关与残卷上的纹路如出一辙。完成本章，获得【渊城钥匙】；失败则被挡在闸门外（剧情继续）。',
      success: '破译机关 · 获得【渊城钥匙】',
      fail: '机关反噬：水压骤增（剧情继续）',
      voice: '钥匙孔……和残卷纹路完全吻合！'
    },
    {
      title: '会发光的居民',
      summary: '城内「居民」早已不是人类——它们静静望着你',
      scene: '内城广场 · 无数光点缓缓围拢',
      stages: [
        { pct: 0, text: '关掉探照灯，让眼睛适应幽光' },
        { pct: 50, text: '光点聚成人形，却没有敌意' },
        { pct: 85, text: '为首的光影递来一页金箔' }
      ],
      text: '城内「居民」是 300 年前用最后科技保存意识的光之民。恐惧值+10，但获得它们的信任（终章专注力提升 buff）。',
      success: '获得光之民的信任 · 恐惧值+10（终章专注提升）',
      fail: '光点四散：信任未成，恐惧值+10',
      voice: '你们……等了 300 年，就是在等一个人吗？'
    },
    {
      title: '终章 · 海之心',
      summary: '渊城核心即将熄灭，你是最后的守灯人',
      scene: '渊城核心 · 一颗缓缓搏动的蓝色光球',
      stages: [
        { pct: 0, text: '把金箔嵌入核心基座' },
        { pct: 50, text: '光球重新搏动，整座城亮了起来' },
        { pct: 85, text: '海之心苏醒，渊城浮向海面！' }
      ],
      text: '渊城核心「海之心」即将熄灭。你必须在氧气耗尽前完成充能——这是最后一搏。',
      success: '海之心苏醒，渊城冲破海面重见天日！',
      fail: '海之心熄灭，渊城再次沉入永恒的黑暗……',
      voice: '300 年的等待，该有个结局了。'
    }
  ],
  endings: {
    perfect: {
      title: '重见天日',
      text: '渊城浮出海面的那一刻，光之民们化作漫天萤火散入夜空。你握紧那片金箔——那是整座城市送给你的谢礼。',
      achievement: '渊城守望者',
      achievementId: 'adv_abyss'
    },
    fail: {
      title: '永沉黑暗',
      text: '海之心熄灭，渊城缓缓沉回海沟。你回到水面，把金箔收进防水袋——也许下次，能有人替你点亮它。'
    },
    bad: {
      title: '长眠深海',
      text: '氧气耗尽，你靠着核心基座坐下，光点们静静围拢，像一场无声的葬礼。渊城再次沉睡——连同你的名字一起。'
    }
  }
};
/* 校验一个「副本剧本对象」，返回 {ok,errors:[],script:规范化后的对象}
   规则与引擎约束对齐：必须 4 章（引擎按 4 章推进与终章判定）、id 全局唯一 */
function validateImportedScript(obj) {
  const errors = [];
  const out = { ok: false, errors: errors, script: null };
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push('JSON 顶层必须是剧本对象（或按格式说明打包为 {scripts:[…]}）');
    return out;
  }
  /* id */
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  if (!id) {
    errors.push('缺少必填字段：id（唯一标识，如 "my_story_1"）');
  } else if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) {
    errors.push('id 只能包含字母/数字/下划线/连字符，长度 2~40（当前："' + id + '"）');
  } else if (id.indexOf('rnd_') === 0) {
    errors.push('id 不能以 rnd_ 开头（该前缀预留给随机剧本）');
  } else if (
    IMMERSIVE_SCRIPTS.some(function (s) {
      return idEq(s.id, id);
    })
  ) {
    errors.push('id 与内置剧本冲突：「' + id + '」已存在，请换一个 id');
  }
  /* series/role */
  if (typeof obj.series !== 'string' || !obj.series.trim())
    errors.push('缺少必填字段：series（剧情系列名，如 "深海谜城"）');
  const role = obj.role;
  if (!role || typeof role !== 'object') {
    errors.push('缺少必填字段：role（角色卡对象）');
  } else {
    ['name', 'title', 'avatar', 'intro'].forEach(function (k) {
      if (typeof role[k] !== 'string' || !role[k].trim()) errors.push('role 缺少必填字段：' + k);
    });
    if (role.stats && typeof role.stats === 'object') {
      Object.keys(role.stats).forEach(function (k) {
        if (typeof role.stats[k] !== 'number') errors.push('role.stats.' + k + ' 必须是数字');
      });
    }
  }
  /* chapters：引擎按 4 章推进，必须恰好 4 章 */
  if (!Array.isArray(obj.chapters)) {
    errors.push('缺少必填字段：chapters（章节数组）');
  } else if (obj.chapters.length !== 4) {
    errors.push('chapters 必须恰好 4 章（第一章~第三章+终章，与引擎推进一致），当前 ' + obj.chapters.length + ' 章');
  } else {
    obj.chapters.forEach(function (ch, i) {
      if (!ch || typeof ch !== 'object') {
        errors.push('第 ' + (i + 1) + ' 章不是对象');
        return;
      }
      if (typeof ch.title !== 'string' || !ch.title.trim()) errors.push('第 ' + (i + 1) + ' 章缺少必填字段：title');
      if (ch.stages) {
        if (!Array.isArray(ch.stages)) {
          errors.push('第 ' + (i + 1) + ' 章 stages 必须是数组');
        } else {
          let prev = -1;
          ch.stages.forEach(function (s, j) {
            if (!s || typeof s !== 'object') {
              errors.push('第 ' + (i + 1) + ' 章 stages[' + j + '] 不是对象');
              return;
            }
            const p = s.pct;
            if (typeof p !== 'number' || p < prev || p > 100)
              errors.push('第 ' + (i + 1) + ' 章 stages[' + j + '].pct 必须是 0~100 且递增的数字');
            if (typeof s.text !== 'string') errors.push('第 ' + (i + 1) + ' 章 stages[' + j + '].text 必须是字符串');
            prev = p;
          });
        }
      }
      const le = ch.liveEvent;
      if (le) {
        if (typeof le !== 'object') {
          errors.push('第 ' + (i + 1) + ' 章 liveEvent 必须是对象');
        } else {
          if (typeof le.atPct !== 'number' || le.atPct < 0 || le.atPct > 100)
            errors.push('第 ' + (i + 1) + ' 章 liveEvent.atPct 必须是 0~100 的数字');
          ['title', 'text', 'win', 'lose'].forEach(function (k) {
            if (le[k] !== undefined && typeof le[k] !== 'string') errors.push('liveEvent.' + k + ' 必须是字符串');
          });
        }
      }
    });
  }
  /* endings */
  const endings = obj.endings;
  if (!endings || typeof endings !== 'object') {
    errors.push('缺少必填字段：endings（结局对象）');
  } else {
    ['perfect', 'fail'].forEach(function (k) {
      const e = endings[k];
      if (!e || typeof e !== 'object') {
        errors.push('endings.' + k + ' 缺少（每个剧本需 perfect 与 fail 结局）');
      } else {
        if (typeof e.title !== 'string' || !e.title.trim()) errors.push('endings.' + k + '.title 必填');
        if (typeof e.text !== 'string' || !e.text.trim()) errors.push('endings.' + k + '.text 必填');
      }
    });
    if (endings.bad && typeof endings.bad === 'object') {
      if (typeof endings.bad.title !== 'string') errors.push('endings.bad.title 必须是字符串');
      if (typeof endings.bad.text !== 'string') errors.push('endings.bad.text 必须是字符串');
    }
  }
  if (errors.length) return out;
  /* 规范化：补齐可空字段默认值，剔除多余字段，保证与引擎契约一致 */
  const chapterNorm = obj.chapters.map(function (ch) {
    const n = {
      title: String(ch.title).trim(),
      summary: ch.summary !== undefined ? String(ch.summary) : '',
      scene: ch.scene !== undefined ? String(ch.scene) : '',
      stages: Array.isArray(ch.stages)
        ? ch.stages.map(function (s) {
            return { pct: s.pct, text: String(s.text) };
          })
        : [],
      text: ch.text !== undefined ? String(ch.text) : '',
      success: ch.success !== undefined ? String(ch.success) : '',
      fail: ch.fail !== undefined ? String(ch.fail) : '',
      voice: ch.voice !== undefined ? String(ch.voice) : ''
    };
    if (ch.liveEvent)
      n.liveEvent = {
        atPct: ch.liveEvent.atPct,
        title: String(ch.liveEvent.title || '🚨 紧急事件'),
        text: String(ch.liveEvent.text || ''),
        win: String(ch.liveEvent.win || '你成功化解了危机！'),
        lose: String(ch.liveEvent.lose || '紧急事件失败……')
      };
    return n;
  });
  const rN = {
    name: String(role.name).trim(),
    title: String(role.title).trim(),
    avatar: String(role.avatar || '🧙'),
    intro: String(role.intro).trim()
  };
  if (role.stats && typeof role.stats === 'object') {
    rN.stats = {};
    Object.keys(role.stats).forEach(function (k) {
      rN.stats[k] = role.stats[k];
    });
  }
  if (Array.isArray(role.tags)) rN.tags = role.tags.slice(0, 12);
  const badN =
    endings.bad && typeof endings.bad === 'object'
      ? {
          title: String(endings.bad.title || '冒险中断'),
          text: String(endings.bad.text || '你倒在了半路……不过没关系，重整旗鼓再来一次！')
        }
      : { title: '冒险中断', text: '你倒在了半路……不过没关系，重整旗鼓再来一次！' };
  const perfectN = { title: String(endings.perfect.title).trim(), text: String(endings.perfect.text).trim() };
  /* 成就名同理：出口转义 + 入口去控制字符并限长（成就名是给人看的短标签） */
  if (endings.perfect.achievement) {
    perfectN.achievement = String(endings.perfect.achievement).replace(/[<>"'`]/g, '').slice(0, 40);
  }
  if (endings.perfect.achievementId) perfectN.achievementId = String(endings.perfect.achievementId);
  /* 出口已转义（P1-1），入口再收一道（纵深防御）：图标只该是 1~2 个 emoji，
     不该出现尖括号/引号/反引号，长度也不该无限。 */
  const _icon = typeof obj.seriesIcon === 'string' ? obj.seriesIcon : '';
  out.script = {
    id: id,
    series: String(obj.series).trim().slice(0, 40),
    seriesIcon: _icon && _icon.length <= 16 && !/[<>"'`]/.test(_icon) ? _icon : '📜',
    themeColor:
      typeof obj.themeColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(obj.themeColor) ? obj.themeColor : '#6B5B95',
    role: rN,
    ambient: typeof obj.ambient === 'string' ? obj.ambient : '环境音 · 导入剧情',
    chapters: chapterNorm,
    endings: {
      perfect: perfectN,
      fail: { title: String(endings.fail.title).trim(), text: String(endings.fail.text).trim() },
      bad: badN
    }
  };
  out.ok = true;
  return out;
}
/* 把校验通过的剧本对象存为一条副本记录（含导入元信息） */
function storeImportedScript(script, source) {
  const res = pushImportedScript({
    id: script.id,
    name: script.series,
    seriesIcon: script.seriesIcon,
    roleName: script.role ? script.role.name : '',
    importedAt: new Date().toISOString(),
    source: source || 'file',
    script: script
  });
  return res;
}
/* 折叠态：导入的剧情列表默认折叠 */
let _importedScriptsOpen = false;
function renderImportedScriptsBox() {
  const box = document.getElementById('importedScriptsBox');
  if (!box) return;
  const list = getImportedScriptList();
  const head =
    '<div onclick="toggleImportedScripts()" style="display:flex;justify-content:space-between;align-items:center;padding:var(--sp-8) var(--sp-10);background:var(--bg);border:1px solid var(--hairline);border-radius:var(--radius-input);cursor:pointer;user-select:none;margin-top:var(--sp-2);">' +
    '<span style="font-size:var(--fs-note);font-weight:800;color:var(--text);">🎬 导入的剧情' +
    (list.length
      ? ' <span style="font-size:var(--fs-caption);color:var(--text-light);font-weight:400;">（' +
        list.length +
        ' 个' +
        (list.length > 1 ? '，会参与固定抽卡池' : '') +
        '）</span>'
      : ' <span style="font-size:var(--fs-caption);color:var(--text-light);font-weight:400;">（还没导入）</span>') +
    '</span>' +
    '<span id="imScArrow" style="font-size:var(--fs-note);color:var(--text-light);transition:transform .18s;' +
    (list.length
      ? _importedScriptsOpen
        ? 'transform:rotate(90deg);'
        : ''
      : _importedScriptsOpen
        ? 'transform:rotate(90deg);'
        : '') +
    '">▶</span>' +
    '</div>';
  if (!list.length) {
    box.innerHTML =
      head +
      '<div style="font-size:var(--fs-caption);color:var(--text-light);line-height:1.6;padding:var(--sp-6) var(--sp-4) 0;">导入后这里会列出副本，并进入抽卡池（40% 概率抽到固定剧情时有机会抽中）。副本只存在本机，不随备份导出。</div>';
    return;
  }
  let body = '';
  if (_importedScriptsOpen) {
    body =
      '<div style="margin-top:var(--sp-6);display:flex;flex-direction:column;gap:var(--sp-6);">' +
      list
        .map(function (x) {
          const sc = x.script || {};
          const chapters = sc.chapters || [];
          const hasAch =
            sc.endings && sc.endings.perfect && sc.endings.perfect.achievement
              /* ★ 必须转义（P1-2）：同 P1-1，achievement 也来自用户导入的 JSON，
                 原来直接拼进 innerHTML。对照组 01f_engine_immersive.js 同一字段
                 用的是 textContent —— 团队知道它用户可控，只是这里漏了。 */
              ? ' 🏅' + escapeHtml(sc.endings.perfect.achievement)
              : '';
          const d = x.importedAt ? new Date(x.importedAt).toLocaleDateString('zh-CN') : '';
          return (
            '<div style="display:flex;align-items:center;gap:var(--sp-8);background:var(--card);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-8) var(--sp-10);">' +
            '<span style="font-size:26px;line-height:1;">' +
            /* ★ 必须转义（P1-1）：这个字段来自用户导入的 JSON，导入帮助面板还明确教人手写。
               同屏 name / roleName 都过了 escapeHtml，唯独这里裸拼 ——
               一个 `<img src=x onerror=...>` 就是存储型 XSS（file:// 下同源放大）。 */
            escapeHtml(x.seriesIcon || '📜') +
            '</span>' +
            '<div style="flex:1;min-width:0;"><div style="font-size:var(--fs-body);font-weight:800;color:var(--text);">' +
            escapeHtml(x.name || sc.series || x.id) +
            '</div>' +
            '<div style="font-size:var(--fs-caption);color:var(--text-light);line-height:1.5;">' +
            (x.roleName ? escapeHtml(x.roleName) : '') +
            ' · ' +
            chapters.length +
            ' 章' +
            (sc.role && sc.role.title ? ' · ' + escapeHtml(sc.role.title) : '') +
            hasAch +
            (d ? ' · ' + d : '') +
            '</div></div>' +
            '<button class="shop-btn small" onclick="removeImportedScriptUI(\'' +
            x.id +
            '\')" style="background:#FDEBE5;color:var(--danger);border-color:#F5C6C6;flex-shrink:0;">删除</button>' +
            '</div>'
          );
        })
        .join('') +
      '</div>';
  } else {
    body = '';
  }
  box.innerHTML = head + body;
}
function toggleImportedScripts() {
  _importedScriptsOpen = !_importedScriptsOpen;
  renderImportedScriptsBox();
}
/* 【5.4.6 剧情副本二级折叠】设置页沉浸式组内默认只显示一行标题，点开才展开按钮与列表 */
let _imScriptPanelOpen = false;
function toggleImportedScriptPanel() {
  _imScriptPanelOpen = !_imScriptPanelOpen;
  const panel = document.getElementById('imScriptPanel');
  const arrow = document.getElementById('imScriptHeadArrow');
  if (panel) panel.style.display = _imScriptPanelOpen ? 'flex' : 'none';
  if (arrow) arrow.style.transform = _imScriptPanelOpen ? 'rotate(90deg)' : '';
  try {
    renderImportedScriptsBox();
    renderImmersiveSettingsNote();
  } catch (e) { if (window.__silent) window.__silent(e, '01f:toggleImportedScriptPanel'); }
}
function openImportedScriptPanel() {
  if (!_imScriptPanelOpen) toggleImportedScriptPanel();
}
function removeImportedScriptUI(id) {
  var _doRemove = function () {
    removeImportedScript(id);
    renderImportedScriptsBox();
    renderImmersiveSettingsNote();
    showToast('🗑️ 已删除副本');
  };
  var _msg = '删除该剧情副本？\n（不影响你的任何数据，随时可重新导入）';
  if (typeof window.rsAsk === 'function') window.rsAsk(_msg, { title: '删除副本', okText: '删除', danger: true }, _doRemove);
  else if (confirm(_msg)) _doRemove();
}
/* 文件导入入口：设置页按钮 → 隐藏 file input */
function onImportScriptFile(input) {
  const file = input && input.files ? input.files[0] : null;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    input.value = '';
    try {
      const parsed = JSON.parse(e.target.result);
      applyImportedScriptPayload(parsed, file.name);
    } catch (err) {
      showToast('❌ 导入失败：文件不是合法 JSON');
    }
  };
  reader.onerror = function () {
    input.value = '';
    showToast('❌ 读取文件失败');
  };
  reader.readAsText(file);
}
/* 统一处理「副本 JSON」内容：支持单剧本对象 或 {format:'immersive_script_pack',scripts:[…]} 打包 */
function applyImportedScriptPayload(parsed, fileName) {
  let list = [];
  let packName = fileName || '';
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.scripts)) {
    /* 打包格式：{format:'immersive_script_pack', name:'…', scripts:[…]} */
    if (parsed.format && parsed.format !== IMPORTED_SCRIPTS_FORMAT) {
      showToast('❌ 文件 format 标识不识别（应为 "' + IMPORTED_SCRIPTS_FORMAT + '" 或省略）');
      return;
    }
    list = parsed.scripts;
    if (parsed.name) packName = parsed.name;
  } else if (Array.isArray(parsed)) {
    list = parsed; /* 宽松兼容：直接给剧本数组 */
  } else {
    list = [parsed]; /* 单剧本对象 */
  }
  if (!list.length) {
    showToast('❌ 文件里没有剧本内容（scripts 为空）');
    return;
  }
  let okCount = 0,
    dupCount = 0;
  const errMsg = [];
  list.forEach(function (item, idx) {
    const v = validateImportedScript(item);
    if (!v.ok) {
      if (v.errors && v.errors.length && String(v.errors[0]).indexOf('已存在') >= 0) dupCount++;
      errMsg.push('第 ' + (idx + 1) + ' 个：' + (v.errors || []).slice(0, 3).join('；'));
      return;
    }
    const src = typeof item.source === 'string' && item.source ? item.source : 'file';
    const res = storeImportedScript(v.script, src);
    if (res && res.ok) okCount++;
    else dupCount++;
  });
  if (okCount) {
    saveData();
    renderImportedScriptsBox();
    renderImmersiveSettingsNote();
    try {
      openImportedScriptPanel();
    } catch (e) { if (window.__silent) window.__silent(e, '01f:applyImportedScriptPayload'); }
  }
  const parts = [];
  if (okCount) parts.push('✅ 成功导入 ' + okCount + ' 个');
  if (dupCount) parts.push('⏭️ 跳过重复 ' + dupCount + ' 个');
  if (errMsg.length) parts.push('❌ ' + errMsg.length + ' 个未通过校验');
  showToast(parts.join(' · ') || '⚠️ 文件里没有可导入的剧本');
  if (errMsg.length) {
    setTimeout(function () {
      var _errText =
        '部分副本未通过校验：\n\n' +
        errMsg.join('\n') +
        '\n\n请对照「📋 格式说明」检查字段（尤其 chapters 必须恰好 4 章、id 全局唯一）。';
      if (typeof window.rsInfo === 'function') window.rsInfo(_errText, { title: '导入未完全成功' });
      else alert(_errText);
    }, 150);
  }
  if (okCount && _importedScriptsOpen === false) renderImportedScriptsBox();
}
/* 一键导入内置示例副本（相当于给用户一份可玩的格式模板） */
function importSampleImmersiveScript() {
  const res = storeImportedScript(SAMPLE_IMMERSIVE_SCRIPT, 'sample');
  if (res && res.ok) {
    renderImportedScriptsBox();
    renderImmersiveSettingsNote();
    try {
      openImportedScriptPanel();
    } catch (e) { if (window.__silent) window.__silent(e, '01f:importSampleImmersiveScript'); }
    showToast('✅ 已导入示例副本「' + SAMPLE_IMMERSIVE_SCRIPT.series + '」，可点开「导入的剧情」查看结构');
  } else {
    showToast('示例副本已存在，无需重复导入');
  }
}
/* 沉浸式设置组内副本数角标（header 名后小字） */
function renderImmersiveSettingsNote() {
  const el = document.getElementById('imScriptCountNote');
  if (el)
    el.textContent = getImportedScriptList().length ? '已导入 ' + getImportedScriptList().length + ' 个剧情副本' : '';
}
/* 格式说明弹窗内容（含对照模板：结构 + 示例副本 JSON 全文） */
/* 【5.4.6】格式说明弹窗折叠：点标题行展开/收起（对照表/示例模板默认折叠，下载按钮直接可见） */
function toggleHelpFold(head) {
  if (!head) return;
  const body = head.nextElementSibling;
  if (!body) return;
  const isOn = body.style.display !== 'none';
  body.style.display = isOn ? 'none' : 'block';
  const arr = head.querySelector('.hf-arrow');
  if (arr) arr.textContent = isOn ? '展开详情 ▶' : '收起 ▲';
  if (isOn) head.scrollIntoView({ block: 'nearest' });
}
function buildImportedScriptHelpHtml() {
  const sample = JSON.stringify(SAMPLE_IMMERSIVE_SCRIPT, null, 2);
  const esc = function (s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  const tpl = esc(sample);
  const td = 'border:1px solid var(--border);padding:var(--sp-4) var(--sp-8);';
  const th = 'background:var(--bg);font-weight:800;';
  const tagLine = '<code>' + esc('{"k":"地点","v":"深海"}') + '</code>';
  return (
    '<div style="text-align:left;line-height:1.7;font-size:var(--fs-note);color:var(--text);">' +
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-10) var(--sp-12);margin-bottom:var(--sp-10);">' +
    '<div style="font-weight:800;margin-bottom:var(--sp-4);">📦 副本 JSON 格式（与内置剧本完全同构，引擎逐字段读取）</div>' +
    '<div>一个文件可以只放 <b>1 个剧本对象</b>；也可以打包多个：<code style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-xs);padding:0 var(--sp-4);">{"format":"immersive_script_pack","name":"合集名","scripts":[剧本1, 剧本2, …]}</code></div>' +
    '<div style="margin-top:var(--sp-4);">🎮 玩法节奏：<b>4 个完整番茄 = 走完 4 章</b>（第一章→第三章→终章）。每完成一章推进一格；未达标则剧情写失败但继续；<b>连续 2 次未达标触发 Bad Ending 并重置</b>。</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-8) var(--sp-12);margin-top:var(--sp-8);cursor:pointer;user-select:none;" onclick="toggleHelpFold(this)"><span>✅ 字段对照表（⭐必填 · ○可选）</span><span class="hf-arrow" style="font-size:var(--fs-tiny);color:var(--text-light);font-weight:700;flex-shrink:0;">展开详情 ▶</span></div>' +
    '<div class="help-fold-body" style="display:none;margin-top:var(--sp-6);">' +
    '<table style="width:100%;border-collapse:collapse;font-size:var(--fs-caption);"><tr style="' +
    th +
    '"><th style="' +
    td +
    'text-align:left;">字段</th><th style="' +
    td +
    'text-align:left;">说明（在游戏里出现在哪）</th></tr>' +
    '<tr><td style="' +
    td +
    '"><code>id</code> ⭐</td><td style="' +
    td +
    '">剧本唯一标识：字母/数字/_/-，2~40 字符。不能与内置剧本或已导入副本重复，不能以 rnd_ 开头</td></tr>' +
    '<tr><td style="' +
    td +
    '"><code>series</code> ⭐</td><td style="' +
    td +
    '">系列名（如 深海谜城）。抽卡角色卡标题、导入列表、冒险总结里显示</td></tr>' +
    '<tr><td style="' +
    td +
    '"><code>seriesIcon</code> ○</td><td style="' +
    td +
    '">系列 emoji（如 🐙）。导入列表/总结用；不填默认 📜</td></tr>' +
    '<tr><td style="' +
    td +
    '"><code>themeColor</code> ○</td><td style="' +
    td +
    '">主题色 #RRGGBB（角色卡/进度描边用），不填默认 #6B5B95</td></tr>' +
    '<tr><td style="' +
    td +
    '"><code>ambient</code> ○</td><td style="' +
    td +
    '">环境音描述，出现在章节过渡页「🎧 环境音：xxx」；不填自动生成</td></tr>' +
    '<tr><td style="' +
    td +
    '"><code>role</code> ⭐</td><td style="' +
    td +
    '">角色卡对象，见下面子字段</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>role.name / title / avatar / intro</code> ⭐</td><td style="' +
    td +
    '">角色名 / 头衔 / emoji 头像 / 开场白，四者必填，抽卡角色卡直接展示</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>role.stats</code> ○（与 tags 二选一）</td><td style="' +
    td +
    '">能力值对象，<b>键名随便起、维度随意</b>（内置有 体能/智力/幸运/专注、灵力/丹术/根骨/专注 等），值 0~100 数字。填了就在角色卡显示能力条</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>role.tags</code> ○（与 stats 二选一）</td><td style="' +
    td +
    '">关键变量标签数组：' +
    tagLine +
    '…，有它时角色卡改显「标签模式」（随机剧本即此样式），stats 条不显示</td></tr>' +
    '<tr><td style="' +
    td +
    '"><code>chapters</code> ⭐</td><td style="' +
    td +
    '">章节数组，<b>必须恰好 4 章</b>（引擎按 4 章推进 + 终章判定）。每章字段见下</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>ch.title</code> ⭐</td><td style="' +
    td +
    '">章节名（如 坠入海沟），显示在进度锚点/过渡页</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>ch.summary</code> ○</td><td style="' +
    td +
    '">一句话剧情摘要，显示在章节进度锚点下</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>ch.scene</code> ○</td><td style="' +
    td +
    '">当前场景名（如 海沟边缘·探照灯劈开黑暗），过渡页场景行展示</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>ch.stages</code> ○</td><td style="' +
    td +
    '">进度文案数组：<code>{"pct":0..85,"text":"文案"}</code>，pct 在 0~100 内递增（通常 0/50/85 三条）。专注进度走到该百分比时闪现这段文字</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>ch.liveEvent</code> ○（任意一章都能加）</td><td style="' +
    td +
    '">中途紧急事件：<code>{"atPct":60,"title":"🚨 标题","text":"事件描述","win":"成功文案","lose":"失败文案"}</code>。进度到 atPct% 弹出；本章全程专注则 win，被打断则 lose（剧情继续）</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>ch.text</code> ○</td><td style="' +
    td +
    '">过渡页剧情正文（长文），短休/章结算时全屏展示</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>ch.success / ch.fail</code> ○</td><td style="' +
    td +
    '">本章成功/未达标后写入事件记录的两行文案（回顾「上一章结果」时读）</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>ch.voice</code> ○</td><td style="' +
    td +
    '">本章结束时角色的一句台词，以弹幕形式飘过</td></tr>' +
    '<tr><td style="' +
    td +
    '"><code>endings</code> ⭐</td><td style="' +
    td +
    '">结局对象：perfect + fail 必填，bad 可选（见下）</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>endings.perfect</code> ⭐</td><td style="' +
    td +
    '">完美结局：title 标题 + text 结语正文（终章全程专注达成）</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;&nbsp;&nbsp;<code>achievement / achievementId</code> ○</td><td style="' +
    td +
    '">达成时解锁的成就：achievement=成就名，achievementId=成就唯一 id。<b>id 要自己编一个全局唯一的</b>（如 my_story_1_good），不要用 adv_ 开头（那是内置保留前缀），也不要两个剧本用同一个，否则成就会互相顶掉</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>endings.fail</code> ⭐</td><td style="' +
    td +
    '">普通失败结局：title + text（终章中途未达标时给）</td></tr>' +
    '<tr><td style="' +
    td +
    '">&nbsp;&nbsp;<code>endings.bad</code> ○</td><td style="' +
    td +
    '">Bad Ending 文案：title + text（连续 2 次未达标时给，可写"长眠深海"式的宿命感结局）</td></tr>' +
    '</table>' +
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-8) var(--sp-12);margin-top:var(--sp-10);font-size:var(--fs-caption);line-height:1.7;">' +
    '<div style="font-weight:800;">🔄 想写「标签型角色」？把 stats 换成 tags 即可：</div>' +
    '<code style="color: var(--primary-ink);word-break:break-all;">"role": {"name":"旅人","title":"星之子","avatar":"🌟","intro":"…","tags":[{"k":"身份","v":"引路人"},{"k":"目标","v":"寻找失落星图"}]}</code>' +
    '</div>' +
    '</div>' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--sp-8);background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);padding:var(--sp-8) var(--sp-12);margin-top:var(--sp-10);cursor:pointer;user-select:none;" onclick="toggleHelpFold(this)"><span>💡 全字段示例副本（《深海谜城》活模板 · 字段最全）</span><span class="hf-arrow" style="font-size:var(--fs-tiny);color:var(--text-light);font-weight:700;flex-shrink:0;">展开模板 ▶</span></div>' +
    '<div class="help-fold-body" style="display:none;margin-top:var(--sp-6);">' +
    '<div style="background:#0f0f23;color:#d8e0f0;border-radius:var(--radius-input);padding:var(--sp-10) var(--sp-12);font-size:var(--fs-tiny);font-family:Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto;">' +
    tpl +
    '</div>' +
    '</div>' +
    '<div style="font-size:var(--fs-caption);color:var(--text-light);margin-top:var(--sp-8);">写好 JSON 后：点「📥 导入副本文件」选择即可。副本与你的个人数据共存，导出备份不含副本；删除副本不影响任何进度。</div>' +
    '</div>'
  );
}
function showImportedScriptHelp() {
  const c = document.getElementById('imScriptHelpContent');
  if (c) c.innerHTML = buildImportedScriptHelpHtml();
  const hint = document.getElementById('imScriptHelpTip');
  if (hint)
    hint.textContent =
      '懒得自己写？点上方「🎁 现成副本 · 打开腾讯文档查看」，去腾讯文档拿现成的。想自己写：先「📋 复制示例 JSON」存成 .json 文件再改字段，是最稳的写法';
  showModal('importedScriptHelpModal');
}
/* 复制示例副本 JSON 到剪贴板 */
function copySampleScriptJson() {
  const txt = JSON.stringify(SAMPLE_IMMERSIVE_SCRIPT, null, 2);
  const done = function () {
    showToast('📋 示例副本 JSON 已复制，去粘贴保存成 .json 文件吧');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done, function () {
      fallbackCopyText(txt);
      done();
    });
  } else {
    fallbackCopyText(txt);
    done();
  }
}
function fallbackCopyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) { if (window.__silent) window.__silent(e, '01f:fallbackCopyText'); }
    document.body.removeChild(ta);
  } catch (e) { if (window.__silent) window.__silent(e, '01f:fallbackCopyText'); }
}
/* 下载示例副本模板文件 */
function downloadSampleScriptJson() {
  const data = JSON.stringify(SAMPLE_IMMERSIVE_SCRIPT, null, 2);
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  /* 文件名用纯英文：中文文件名在部分手机浏览器（Via 等）会静默拦截下载，
     与「导出备份」能成功下载的原理保持一致（tomato_backup_xxx.json） */
  a.href = url;
  a.download = 'immersion_script_sample.json';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
  showToast('📥 模板已下载（immersion_script_sample.json），改内容后导入即可');
}

