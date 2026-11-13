/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 白噪音 + 我的歌单层：内置白噪音曲目表与播放控制、我的歌单（网易云直链）增删/批量导入/上一首下一首/音量
 * 全部为**顶层 function 声明 + 该域私有常量/状态**，跨 script 全局可见；本文件必须排在 01e_engine_ui.js
 * **之后、紧邻**加载（见 src/manifest.json 的槽 1 files）。
 * 依赖方向：本文件 → 01e / 00_pure_core / 01b（前向，安全）。本域**全部私有状态都在本文件内**
 *   （静态核对：01e 剩余部分与其它 39 个文件对它们的引用数均为 0）。
 *   反向不成立：01e **不**依赖本文件的任何东西。
 * 回退方式：把本文件内容按 TOC 顺序粘回 01e_engine_ui.js 原位置，并删掉 manifest 里本文件那一行。 */
/* ==================== 模块: 04eL-ui-audio.js | 职责: 内置白噪音曲目表与播放控制、我的歌单（网易云直链）增删/批量导入/上一首下一首/音量 | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04eL-ui-audio.js（源文件 01eL_ui_audio.js）
 * 分组：ui
 * 职责：内置白噪音曲目表与播放控制、我的歌单（网易云直链）增删/批量导入/上一首下一首/音量
 * 函数索引（TOC）：getNoiseAudio/initNoiseAudio/playNoise/stopNoise/toggleNoise/nextNoise/prevNoise/setNoiseVolume/updateNoiseUI/switchNoiseTab/myplGetAudio/myplLoad（+16 更多）
 * ============================================================ */

/* 使用网易云官方外链接口 music.163.com/song/media/outer/url?id=xxx.mp3 直接播放真实录音，
   自建上一首/下一首；单曲失效（下架/版权限制）时自动跳下一首，不会卡死。 */
let _noiseAudio = null,
  _noiseIdx = 0,
  _noisePlaying = false,
  _noiseVol = 0.4,
  _noiseSkipGuard = 0,
  _noiseInited = false;
/* 曲目列表（均实测可播的真实录音，含自然声与助眠轻音乐）：
   若某首失效（播放器自动跳过），把对应 id 换成其他网易云歌曲 id 即可 */
const BUILTIN_TRACKS = [
  { id: 1409940952, name: '雨声 Rain Rec', icon: '🌧️' },
  { id: 1871223092, name: '夜雨滴 Night Droplets', icon: '🌙' },
  { id: 1881052792, name: '暴风雨街道 Stormy', icon: '⛈️' },
  { id: 1355263448, name: '海浪 Soothing Waves', icon: '🌊' },
  { id: 1913501456, name: '海滩 The Beach', icon: '🏖️' },
  { id: 1463841411, name: '咖啡店·纽约 Coffee', icon: '☕' },
  { id: 1463841412, name: '街景·布鲁塞尔 Brussels', icon: '🛣️' },
  { id: 1816501009, name: '星星伴你（催眠曲）', icon: '✨' },
  { id: 1500796783, name: '遥不可及（催眠曲）', icon: '🌌' },
  { id: 1483503842, name: '晚安月亮（催眠曲）', icon: '🌕' },
  { id: 1855497161, name: '树林雨声+雷声 Rainstorm', icon: '🌧️' },
  { id: 1903108309, name: '雨中鸟鸣 Bird in Rain', icon: '🐦' },
  { id: 1842353138, name: '壁炉篝火 Fireplace', icon: '🔥' },
  { id: 1858413645, name: '山林雷雨 Forest Storm', icon: '⚡' },
  { id: 1907424363, name: '颂钵疗愈 Singing Bowl', icon: '🧘' },
  { id: 2110024517, name: '森林雨滴 Forest Rain', icon: '🌲' },
  { id: 1918022756, name: '鸟鸣 Bird Song', icon: '🐦' },
  { id: 1908899777, name: '雷雨白噪音 Thunder Rain', icon: '⛈️' }
];
function getNoiseAudio() {
  if (!_noiseAudio) _noiseAudio = document.getElementById('noiseAudio');
  return _noiseAudio;
}
function initNoiseAudio() {
  if (_noiseInited) return;
  _noiseInited = true;
  const a = getNoiseAudio();
  if (!a) return;
  /* 单曲失效自动跳下一首（连续跳过次数封顶，避免死循环） */
  a.addEventListener('error', function () {
    _noiseSkipGuard = (_noiseSkipGuard || 0) + 1;
    if (_noiseSkipGuard < BUILTIN_TRACKS.length) {
      playNoise(_noiseIdx + 1);
    } else {
      _noiseSkipGuard = 0;
      _noisePlaying = false;
      updateNoiseUI();
      showToast('⚠️ 该曲目已失效，切到「我的歌单」tab 可添加其他歌曲');
    }
  });
  a.addEventListener('play', function () {
    _noisePlaying = true;
    updateNoiseUI();
  });
  a.addEventListener('pause', function () {
    _noisePlaying = false;
    updateNoiseUI();
  });
  a.addEventListener('ended', function () {
    nextNoise();
  });
}
function playNoise(idx) {
  if (idx !== null && idx !== undefined) {
    _noiseIdx = ((idx % BUILTIN_TRACKS.length) + BUILTIN_TRACKS.length) % BUILTIN_TRACKS.length;
  }
  initNoiseAudio();
  const a = getNoiseAudio();
  if (!a) return;
  _noiseSkipGuard = 0; /* 切歌成功重置跳过计数 */
  const t = BUILTIN_TRACKS[_noiseIdx];
  a.src = 'https://music.163.com/song/media/outer/url?id=' + t.id + '.mp3';
  a.volume = _noiseVol;
  const p = a.play();
  if (p && p.catch) {
    p.catch(function () {
      _noisePlaying = false;
      updateNoiseUI();
    });
  }
}
function stopNoise() {
  const a = getNoiseAudio();
  if (!a) return;
  a.pause();
  _noisePlaying = false;
  updateNoiseUI();
}
function toggleNoise() {
  _noisePlaying ? stopNoise() : playNoise(_noiseIdx);
}
function nextNoise() {
  playNoise(_noiseIdx + 1);
}
function prevNoise() {
  playNoise(_noiseIdx - 1);
}
function setNoiseVolume(v) {
  _noiseVol = Math.max(0, Math.min(1, v));
  const a = getNoiseAudio();
  if (a) a.volume = _noiseVol;
}
function updateNoiseUI() {
  const item = BUILTIN_TRACKS[_noiseIdx] || BUILTIN_TRACKS[0];
  const nameEl = document.getElementById('noiseNowName');
  if (nameEl) nameEl.textContent = item.name;
  const iconEl = document.querySelector('.noise-now .now-icon');
  if (iconEl) iconEl.textContent = item.icon;
  const btn = document.getElementById('noisePlayBtn');
  if (btn) btn.textContent = _noisePlaying ? '⏸' : '▶';
  /* 快捷面板 图标同步播放状态：播放中显示 + 高亮 */
  const qn = document.querySelector('#quickPanel .qp-item[data-action="noise"]');
  if (qn) {
    const qic = qn.querySelector('.qp-ico');
    if (qic) qic.textContent = _noisePlaying ? '🔊' : '🎵';
    qn.classList.toggle('on', !!_noisePlaying);
  }
}
/* tab 切换：互斥停止对方音源 */
function switchNoiseTab(tab) {
  document.querySelectorAll('.noise-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('noiseBuiltin').style.display = tab === 'builtin' ? '' : 'none';
  document.getElementById('noiseMypl').style.display = tab === 'mypl' ? '' : 'none';
  if (tab === 'builtin') {
    myplStop();
  } else if (tab === 'mypl') {
    stopNoise();
    myplLoad();
    myplInitAudio();
    myplRender();
  }
}

/* ===== 我的歌单：手动添加 + 批量导入，网易云直链播放（存 appData.uiPrefs.myplTracks） ===== */
let _myplTracks = [];
let _myplIdx = 0;
let _myplPlaying = false;
let _myplVol = 0.4;
let _myplSkipGuard = 0;
let _myplAudio = null;

function myplGetAudio() {
  if (!_myplAudio) _myplAudio = document.getElementById('myplAudio');
  return _myplAudio;
}
/* ===== 我的歌单：手动添加 + 批量导入，网易云直链播放 ===== */
/* 歌单收编 appData.uiPrefs.myplTracks（原 bottle_mypl_tracks 散键已删，migrate 已搬迁）。
   载入/保存都只走主存储单通道（用户切到歌单 tab 时触发，此时 appData 必已就绪）。 */
function myplLoad() {
  _myplTracks = [];
  try {
    if (appData && appData.uiPrefs && Array.isArray(appData.uiPrefs.myplTracks)) {
      _myplTracks = appData.uiPrefs.myplTracks;
    } else if (appData && appData.uiPrefs) {
      appData.uiPrefs.myplTracks = [];
    }
  } catch (e) {
    _myplTracks = [];
  }
}
function myplSave() {
  try {
    if (appData && appData.uiPrefs) {
      appData.uiPrefs.myplTracks = _myplTracks || [];
      saveDataNow();
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01e:myplSave'); }
}
/* 从网易云分享链接或纯ID中提取歌曲ID */
function myplParseId(input) {
  if (!input) return null;
  input = input.trim();
  /* 纯数字 */
  if (/^\d+$/.test(input)) return input;
  /* URL: music.163.com/song?id=xxx 或 /song/xxx */
  let m = input.match(/[?&]id=(\d+)/);
  if (m) return m[1];
  m = input.match(/\/song\/(\d+)/);
  if (m) return m[1];
  return null;
}
function myplAddFromInput() {
  let inp = document.getElementById('myplInput');
  if (!inp) return;
  let raw = inp.value.trim();
  if (!raw) {
    showToast('请粘贴歌曲链接或ID');
    return;
  }
  let id = myplParseId(raw);
  if (!id) {
    showToast('⚠️ 无法识别，请粘贴网易云歌曲链接或纯数字ID');
    return;
  }
  /* 去重 */
  for (let i = 0; i < _myplTracks.length; i++) {
    if (idEq(_myplTracks[i].id, id)) {
      showToast('这首歌已在列表中');
      return;
    }
  }
  _myplTracks.push({ id: id, name: '歌曲 ' + id, icon: '🎵' });
  myplSave();
  inp.value = '';
  myplRender();
  showToast('✅ 已添加（' + _myplTracks.length + ' 首）');
}
function myplBatchImport() {
  let ta = document.getElementById('myplBatchInput');
  if (!ta) return;
  let lines = ta.value.split('\n');
  let added = 0,
    skipped = 0;
  lines.forEach(function (line) {
    let id = myplParseId(line);
    if (!id) {
      skipped++;
      return;
    }
    let dup = false;
    for (let i = 0; i < _myplTracks.length; i++) {
      if (idEq(_myplTracks[i].id, id)) {
        dup = true;
        break;
      }
    }
    if (dup) {
      skipped++;
      return;
    }
    _myplTracks.push({ id: id, name: '歌曲 ' + id, icon: '🎵' });
    added++;
  });
  if (added > 0) {
    myplSave();
    myplRender();
  }
  ta.value = '';
  showToast('📥 导入完成：新增 ' + added + ' 首' + (skipped > 0 ? '，跳过 ' + skipped + ' 行（无法识别或重复）' : ''));
}
function myplRemove(idx) {
  if (idx < 0 || idx >= _myplTracks.length) return;
  if (_myplPlaying && idx === _myplIdx) {
    myplStop();
  }
  _myplTracks.splice(idx, 1);
  if (_myplIdx >= _myplTracks.length) _myplIdx = Math.max(0, _myplTracks.length - 1);
  myplSave();
  myplRender();
}
function myplPlay(idx) {
  if (!_myplTracks.length) {
    showToast('列表为空，先添加歌曲');
    return;
  }
  if (idx !== null && idx !== undefined) {
    _myplIdx = ((idx % _myplTracks.length) + _myplTracks.length) % _myplTracks.length;
  }
  let a = myplGetAudio();
  if (!a) return;
  _myplSkipGuard = 0;
  let t = _myplTracks[_myplIdx];
  a.src = 'https://music.163.com/song/media/outer/url?id=' + t.id + '.mp3';
  a.volume = _myplVol;
  let p = a.play();
  if (p && p.catch) {
    p.catch(function () {
      _myplPlaying = false;
      myplUpdateUI();
      showToast('⚠️ 播放失败，歌曲可能已下架');
    });
  }
}
function myplStop() {
  let a = myplGetAudio();
  if (!a) return;
  a.pause();
  _myplPlaying = false;
  myplUpdateUI();
}
function myplToggle() {
  _myplPlaying ? myplStop() : myplPlay(_myplIdx);
}
function myplNext() {
  myplPlay(_myplIdx + 1);
}
function myplPrev() {
  myplPlay(_myplIdx - 1);
}
function myplSetVol(v) {
  _myplVol = Math.max(0, Math.min(1, v));
  let a = myplGetAudio();
  if (a) a.volume = _myplVol;
}
/* ★ 初始化守卫（P2-11）：这个函数由「打开我的歌单弹窗」触发，
   原来每打开一次就绑一套监听 —— 打开 N 次后一首歌播完会连跳 N 首、
   play/pause 回调也重复执行。与 initNoiseAudio 的 _noiseInited 用同一套写法。 */
let _myplInited = false;
function myplInitAudio() {
  if (_myplInited) return;
  _myplInited = true;
  let a = myplGetAudio();
  if (!a) { _myplInited = false; return; }   /* 元素还没建出来时允许下次再试 */
  a.addEventListener('error', function () {
    _myplSkipGuard = (_myplSkipGuard || 0) + 1;
    if (_myplSkipGuard < _myplTracks.length) {
      showToast('⏭️ 该曲目已失效，自动跳下一首');
      myplPlay(_myplIdx + 1);
    } else {
      _myplSkipGuard = 0;
      _myplPlaying = false;
      myplUpdateUI();
      showToast('⚠️ 连续多首失效，请检查歌曲ID');
    }
  });
  a.addEventListener('play', function () {
    _myplPlaying = true;
    myplUpdateUI();
  });
  a.addEventListener('pause', function () {
    _myplPlaying = false;
    myplUpdateUI();
  });
  a.addEventListener('ended', function () {
    myplNext();
  });
}
function myplUpdateUI() {
  let t = _myplTracks[_myplIdx];
  let nameEl = document.getElementById('myplNowName');
  if (nameEl) nameEl.textContent = t ? t.name : '未播放';
  let iconEl = document.querySelector('#noiseMypl .now-icon');
  if (iconEl) iconEl.textContent = t ? t.icon : '🎵';
  let btn = document.getElementById('myplPlayBtn');
  if (btn) btn.textContent = _myplPlaying ? '⏸' : '▶';
  /* 列表高亮当前曲目 */
  document.querySelectorAll('#myplList .mypl-item').forEach(function (el, i) {
    el.classList.toggle('playing', i === _myplIdx && _myplPlaying);
  });
  let qn = document.querySelector('#quickPanel .qp-item[data-action="noise"]');
  if (qn) {
    let qic = qn.querySelector('.qp-ico');
    if (qic) qic.textContent = _myplPlaying ? '🔊' : '🎵';
    qn.classList.toggle('on', !!_myplPlaying);
  }
}
function myplRender() {
  let box = document.getElementById('myplList');
  if (!box) return;
  if (!_myplTracks.length) {
    box.innerHTML = '<div class="mypl-empty">还没有歌曲<br>上方粘贴网易云歌曲链接或ID添加，也可批量导入</div>';
    myplUpdateUI();
    return;
  }
  let h = '';
  _myplTracks.forEach(function (t, i) {
    h +=
      '<div class="mypl-item' +
      (i === _myplIdx && _myplPlaying ? ' playing' : '') +
      '">' +
      '<span class="mypl-icon">' +
      (t.icon || '🎵') +
      '</span>' +
      '<span class="mypl-name" onclick="myplPlay(' +
      i +
      ')">' +
      t.name +
      '</span>' +
      '<button class="mypl-del" onclick="myplRemove(' +
      i +
      ')">✕</button>' +
      '</div>';
  });
  box.innerHTML = h;
  myplUpdateUI();
}
/* 关闭弹窗：音乐继续后台播放（方便边听白噪音边看计时）；想停止用弹窗内「暂停」按钮或顶部 */
function closeNoiseModal() {
  closeModal('noiseModal');
  if (_noisePlaying) showToast('🔊 白噪音继续播放中，点顶部 🎵 可打开暂停', true);
}
/* 打开弹窗时刷新 UI */
function openNoiseModal() {
  showModal('noiseModal');
  updateNoiseUI();
  myplLoad();
  myplInitAudio();
  myplRender();
}
