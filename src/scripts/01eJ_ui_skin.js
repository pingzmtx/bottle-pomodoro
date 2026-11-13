/* ===== 耦合契约（只读注释，不改运行逻辑）=====
 * 自定义皮肤层：树木背景 + 计时器壁纸 + 皮肤商店（购买 / 上传 / 自动 cover 裁切压缩 /
 * base64 存 IndexedDB / 到期自动清除）+ 拖拽调位与缩放滑杆。
 * 全部为**顶层函数声明**，跨 script 全局可见；本文件必须排在 01e8_ui_misc.js
 * **之后**加载（见 src/manifest.json 的槽 1 files）。
 * 依赖方向：本文件 → 01e8（前向，安全）。本文件用到的 4 个私有状态
 *   （`_skinNat` / `_skinNatState` / `_skinUrlKind` / `_skinDrag`）**都在本文件内**，
 *   因为它们只被本文件的函数读写 —— 静态核对过：01e8 剩余部分与其它 38 个文件
 *   对它们的引用数都为 0（只剩原地的说明注释）。
 *   反向不成立：01e8 **不**依赖本文件的任何东西。
 * 注：皮肤数据落盘在 IndexedDB（treeSkinImg / 壁纸 base64），不走 appData，故导出体积不受影响。 */
/* ==================== 模块: 04eJ-ui-skin.js | 职责: 自定义皮肤（树背景 / 计时器壁纸 / 皮肤商店） | 分组: ui ==================== */

/* ============================================================
 * 【模块说明】本文件说明供「番茄钟合成器」识别展示，改功能时请同步更新
 * 文件名：04eJ-ui-skin.js（源文件 01eJ_ui_skin.js）
 * 分组：ui
 * 职责：皮肤自然尺寸探测与缓存、cover 裁切几何、树/计时器换肤应用、皮肤商店渲染、
 *       上传与裁剪、拖拽调位与缩放、购买与到期处理。
 *   · 只搬「顶层 function 声明 + 该域私有的顶层状态」，**不搬任何顶层立即执行语句** ——
 *     因此跨 script 的加载顺序只影响「谁先定义」，不影响「谁能看见谁」。
 *   · 回退方式：把本文件内容按 TOC 顺序粘回 01e8_ui_misc.js 原位置
 *     （即 `timerTreeTalk` 之后、`openChest` 之前），并删掉 src/manifest.json 里本文件那一行。
 * 函数索引（TOC）：ensureSkinNatSize/applySkinGeometry/skinPreviewScale/skinLayerStyle/applySkinToTree/applySkinToTimer/applySkinsToDOM/buySkin/openSkinUrlInput/submitSkinUrl/removeSkin/onSkinSlider（+20 更多）
 * ============================================================ */

/* ============================================================
 * 自定义皮肤：树木背景 / 计时器壁纸
 * 买 30 天 → 可任意上传更换 → 系统自动 cover 裁切 + 压缩 → base64 存 IndexedDB（刷新不丢）
 * 到期由 checkTreeExpiry 自动清除图片数据；壁纸默认模糊+半透明，两个滑杆可调。
 * ============================================================ */
/* 记录图片原始尺寸（用于手动裁切缩放计算；按 URL 缓存，刷新后重新懒加载）
   _skinNatState 记录加载状态：loading / ok / fail，避免重复请求、失败可感知 */
const _skinNat = {};
const _skinNatState = {};
function ensureSkinNatSize(url, cb) {
  if (!url) return;
  if (_skinNat[url]) {
    cb && cb();
    return;
  }
  if (_skinNatState[url] === 'loading') return; /* 正在加载，等回调，不重复发请求 */
  _skinNatState[url] = 'loading';
  const im = new Image();
  im.onload = function () {
    _skinNat[url] = { w: im.naturalWidth, h: im.naturalHeight };
    _skinNatState[url] = 'ok';
    cb && cb();
  };
  im.onerror = function () {
    _skinNatState[url] = 'fail';
  };
  im.src = url;
}
/* 手动裁切展示范围：缩放 zoom(1~4) + 水平/垂直位置 posX/posY(0~100，默认50=居中)
   zoom=1 时用 cover 铺满；zoom>1 时按「cover 基准 × zoom」算出精确像素尺寸，
   配合 background-position 百分比实现自由平移，画面不再被自动裁切锁死。
   返回 {cw, ch, overflowX, overflowY, mode}，供诊断行显示「水平/垂直可移动 ±Xpx」 */
function applySkinGeometry(layer, sk, hostOverride, offScale) {
  if (!layer) return null;
  const zv = parseFloat(sk.zoom);
  const z = isFinite(zv) ? Math.max(1, Math.min(4, zv)) : 1;
  /* 只要原图尺寸还没拿到，就先触发异步加载，加载完自动重算（cover 和 zoom 都需要它来算溢出） */
  if (!_skinNat[sk.data] && sk.data) {
    ensureSkinNatSize(sk.data, function () {
      try {
        applySkinGeometry(layer, sk, hostOverride, offScale);
      } catch (e) { if (window.__silent) window.__silent(e, '01e8:applySkinGeometry'); }
    });
  }
  const host = hostOverride || layer.parentElement;
  let cw = 0,
    ch = 0;
  if (host) {
    const r = host.getBoundingClientRect();
    cw = r.width;
    ch = r.height;
  }
  const nat = _skinNat[sk.data];
  let bgW = 0,
    bgH = 0,
    sized = false;
  if (nat && cw > 0 && ch > 0) {
    /* 统一按「cover 基准 × zoom」算出精确像素尺寸（z=1 时就是 cover 的等效尺寸） */
    const s = Math.max(cw / nat.w, ch / nat.h) * z;
    bgW = Math.round(nat.w * s);
    bgH = Math.round(nat.h * s);
    sized = true;
    layer.style.backgroundSize = bgW + 'px ' + bgH + 'px';
  } else if (z <= 1) {
    layer.style.backgroundSize = 'cover';
  } else {
    layer.style.backgroundSize = Math.round(z * 100) + '% auto';
  }
/* 位置 = 百分比对齐（0~100）+ 额外像素偏移 offX/offY。
   offX/offY 表示「越界」：图片可以整体滑出容器（顶部/左侧超出边界），
   另一侧露出空白，不再被 0~100 的框锁死。没有它时，百分比撞到 0/100 就再也拖不动了。 */
  const xv = parseFloat(sk.posX);
  const px = isFinite(xv) ? Math.max(0, Math.min(100, xv)) : 50;
  const yv = parseFloat(sk.posY);
  const py = isFinite(yv) ? Math.max(0, Math.min(100, yv)) : 50;
  const oxv = parseFloat(sk.offX);
  const offX = isFinite(oxv) ? oxv : 0;
  const oyv = parseFloat(sk.offY);
  const offY = isFinite(oyv) ? oyv : 0;
  const osv = parseFloat(offScale);
  const osc = isFinite(osv) ? osv : 1;
  if (sized) {
    /* 百分比在像素层面的等价偏移：(容器 - 图片) × 百分比，再叠加越界偏移 */
    const bx = Math.round(((cw - bgW) * px) / 100 + offX * osc);
    const by = Math.round(((ch - bgH) * py) / 100 + offY * osc);
    layer.style.backgroundPosition = bx + 'px ' + by + 'px';
  } else {
    layer.style.backgroundPosition = px + '% ' + py + '%';
  }
  return {
    cw,
    ch,
    bgW,
    bgH,
    overflowX: sized ? Math.max(0, bgW - cw) : 0,
    overflowY: sized ? Math.max(0, bgH - ch) : 0,
    mode: z <= 1 ? 'cover' : 'zoom',
    offX,
    offY
  };
}
/* 商店预览框只有 92px 高，而越界偏移是绝对像素，直接照搬会让图片整个飞出预览。
   按「预览框 / 真实容器」的比例缩放偏移，预览里看到的留白比例才和真机一致。 */
function skinPreviewScale(kind, pv) {
  try {
    const real = document.getElementById(kind === 'wallpaper' ? 'view-timer' : 'treeScene');
    const rr = real ? real.getBoundingClientRect() : null;
    const pr = pv ? pv.getBoundingClientRect() : null;
    if (rr && pr && rr.height > 0 && pr.height > 0) return Math.max(0.05, Math.min(1, pr.height / rr.height));
  } catch (e) { if (window.__silent) window.__silent(e, '01e8:skinPreviewScale'); }
  return 1;
}
function skinLayerStyle(layer, sk) {
  if (!layer) return;
  /* sk.data 可经备份导入写入任意字符串，统一过白名单（非法 → 空串 → 不设置背景） */
  layer.style.backgroundImage = 'url(' + safeSkinUrl(sk.data) + ')';
  layer.style.filter = sk.blur ? 'blur(' + sk.blur + 'px)' : 'none';
  layer.style.opacity = String(typeof sk.opacity === 'number' ? sk.opacity : 1);
  applySkinGeometry(layer, sk);
}
function applySkinToTree() {
  const el = document.getElementById('treeScene');
  if (!el) return;
  let layer = el.querySelector('.tree-custom-bg');
  if (!skinIsActive('treebg')) {
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    return;
  }
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'tree-custom-bg';
  }
  /* 永远垫在最底层（在场景点缀 .scene-deco 之下），否则会盖住小花小草 */
  if (el.firstChild !== layer) el.insertBefore(layer, el.firstChild);
  skinLayerStyle(layer, getSkin('treebg'));
}
function applySkinToTimer() {
  const el = document.getElementById('view-timer');
  if (!el) return;
  const active = skinIsActive('wallpaper');
  /* 壁纸生效时给计时页挂 has-wallpaper：卡片/按钮变半透明，让壁纸透出来 */
  el.classList.toggle('has-wallpaper', active);
  let layer = document.getElementById('timerWallpaper');
  if (!active) {
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    return;
  }
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'timerWallpaper';
    layer.className = 'timer-wallpaper';
    el.insertBefore(layer, el.firstChild);
  }
  skinLayerStyle(layer, getSkin('wallpaper'));
}
function applySkinsToDOM() {
  try {
    applySkinToTree();
  } catch (e) { if (window.__silent) window.__silent(e, '01e-applySkinsToDOM'); }
  try {
    applySkinToTimer();
  } catch (e) { if (window.__silent) window.__silent(e, '01e8:applySkinsToDOM'); }
}
/* 购买 / 续费：treebg 与 wallpaper（计时器壁纸）统一阶梯定价——
   第1次50币/7天 → 第2次500币/7天 → 第3次起2000币/月；到期前续费顺延。
   两个商品各自独立计数（getSkinPurchaseCount / bumpSkinPurchaseCount） */
function buySkin(kind, days) {
  const tr = appData.tree;
  if (!tr) return;
  const def = getSkinDef(kind);
  const tier = getSkinTier(getSkinPurchaseCount(kind));
  const price = skinPriceWithSurcharge(tier.price);
  const _up = price > tier.price;
  const daysActual = tier.days;
  if ((tr.coins || 0) < price) {
    showToast('🪙 果实币不足（需 ' + price + '，还差 ' + (price - (tr.coins || 0)) + '）');
    return;
  }
  coinSpend(price, 'skin', '皮肤：「' + def.name + '」' + daysActual + ' 天');
  const sk = getSkin(kind);
  sk.expires = Math.max(Date.now(), sk.expires || 0) + daysActual * DAY_MS;
  bumpSkinPurchaseCount(kind);
  saveDataNow();
  renderSkinShop();
  const bal = document.getElementById('shopBalance');
  if (bal) bal.textContent = '🪙 ' + (tr.coins || 0);
  playSound('reward');
  showToast(
    '🎉 已购买「' +
      def.name +
      '」' +
      daysActual +
      ' 天，期间可任意上传更换' +
      (_up ? '（余额≥' + SKIN_SURCHARGE_AT + '，小额上浮至 ' + price + '🪙）' : '')
  );
}
/* 填写 / 更换图床链接（图片不落本地，只存一个 URL 字符串） */
let _skinUrlKind = 'treebg';
function openSkinUrlInput(kind) {
  const sk = getSkin(kind);
  if (!sk.expires || sk.expires <= Date.now()) {
    showToast('⏰ 尚未购买或已到期，请先购买');
    return;
  }
  _skinUrlKind = kind;
  const def = getSkinDef(kind);
  const t = document.getElementById('skinUrlTitle');
  if (t) t.textContent = def.icon + ' 填写' + (kind === 'wallpaper' ? '壁纸' : '树木背景') + '图片链接';
  const inp = document.getElementById('skinUrlInput');
  if (inp) inp.value = sk.data && /^https?:\/\//i.test(sk.data) ? sk.data : '';
  const tip = document.getElementById('skinUrlTip');
  if (tip) tip.textContent = '';
  showModal('skinUrlModal');
  if (inp)
    setTimeout(function () {
      try {
        inp.focus();
      } catch (e) { if (window.__silent) window.__silent(e, '01e8:openSkinUrlInput'); }
    }, 350);
}
function submitSkinUrl() {
  const inp = document.getElementById('skinUrlInput');
  const tip = document.getElementById('skinUrlTip');
  const url = ((inp && inp.value) || '').trim();
  if (!url) {
    if (tip) {
      tip.style.color = 'var(--primary)';
      tip.textContent = '请先粘贴图片链接';
    }
    return;
  }
  /* 提交入口同步收紧为白名单（拒引号/括号/尖括号，与渲染侧 safeSkinUrl 同口径） */
  if (!safeSkinUrl(url)) {
    if (tip) {
      tip.style.color = '#D32F2F';
      tip.textContent = '❌ 必须以 http:// 或 https:// 开头，且不能含空格或引号、括号等特殊字符';
    }
    return;
  }
  /* 先真实加载一次：加载不出来就别让用户存一个坏链（图床防盗链/链接失效最常见） */
  if (tip) {
    tip.style.color = 'var(--text-light)';
    tip.textContent = '⏳ 正在验证链接能否加载…';
  }
  let done = false;
  const probe = new Image();
  const finish = function (ok, msg) {
    if (done) return;
    done = true;
    if (!ok) {
      if (tip) {
        tip.style.color = '#D32F2F';
        tip.textContent = '❌ ' + msg;
      }
      return;
    }
    const sk = getSkin(_skinUrlKind);
    const hadOld = !!sk.data;
    /* 只存一个链接字符串：旧链接被直接覆盖，本地不留任何图片文件 */
    const isNewUrl = sk.data !== url;
    sk.data = url;
    sk.updatedAt = Date.now();
    /* 换图后裁切参数归零（新图从整图铺满开始，用户再自行调整展示范围） */
    if (isNewUrl) {
      sk.posX = 50;
      sk.posY = 50;
      sk.zoom = 1;
      sk.offX = 0;
      sk.offY = 0;
    }
    /* 顺手记下原图尺寸，手动裁切缩放立即生效 */
    if (probe.naturalWidth && probe.naturalHeight) _skinNat[url] = { w: probe.naturalWidth, h: probe.naturalHeight };
    saveDataNow();
    applySkinsToDOM();
    renderSkinShop();
    closeModal('skinUrlModal');
    playSound('taskDone');
    showToast(hadOld ? '🔄 已更换为新的图片链接' : '✅ 图片链接已应用，有效期内可随时更换');
  };
  probe.onload = function () {
    finish(true);
  };
  probe.onerror = function () {
    finish(false, '链接加载不出来。请确认是「图片直链」——在浏览器地址栏打开应直接显示图片，而不是图床的网页');
  };
  probe.src = url;
  setTimeout(function () {
    finish(false, '加载超时，换一个图床试试');
  }, 9000);
}
/* 移除当前图片（保留已购时长，可重新填写链接） */
function removeSkin(kind) {
  const sk = getSkin(kind);
  if (!sk.data) {
    showToast('当前没有已上传的图片');
    return;
  }
  sk.data = '';
  sk.updatedAt = 0;
  saveDataNow();
  applySkinsToDOM();
  renderSkinShop();
  showToast('🗑️ 已移除当前图片（有效期保留，可重新填写链接）');
}
/* 滑杆：拖动时实时预览，松手才落盘（避免高频写存储）
    取值口径：blur 传 0~20 像素；opacity 传百分比整数 15~100（滑杆用百分比更直观），内部除以 100 */
function onSkinSlider(kind, key, val) {
  const sk = getSkin(kind);
  if (key === 'opacity') {
    sk.opacity = Math.max(0.15, Math.min(1, (parseFloat(val) || 0) / 100));
  } else {
    sk.blur = Math.max(0, Math.min(20, parseInt(val, 10) || 0));
  }
  applySkinsToDOM();
  const lab = document.getElementById('skin' + (key === 'opacity' ? 'Opacity' : 'Blur') + 'Val-' + kind);
  if (lab) lab.textContent = key === 'opacity' ? Math.round(sk.opacity * 100) + '%' : sk.blur + 'px';
  const pv = document.getElementById('skinPreview-' + kind);
  if (pv) {
    pv.style.filter = sk.blur ? 'blur(' + sk.blur + 'px)' : 'none';
    pv.style.opacity = String(sk.opacity);
  }
}
function commitSkinSlider(kind, key, val) {
  onSkinSlider(kind, key, val);
  saveData();
}
/* 索引包装：商店列表是 innerHTML 拼接，onclick 里传数字索引，避免单引号层层转义出错 */
function _skinKey(i) {
  const k = SKIN_KINDS[i];
  return k ? k.key : 'treebg';
}
function buySkinIdx(i, days) {
  buySkin(_skinKey(i), days);
}
function openSkinUrlInputIdx(i) {
  openSkinUrlInput(_skinKey(i));
}
function removeSkinIdx(i) {
  removeSkin(_skinKey(i));
}
function onSkinSliderIdx(i, keyIdx, val) {
  onSkinSlider(_skinKey(i), keyIdx === 1 ? 'opacity' : 'blur', val);
}
function commitSkinSliderIdx(i, keyIdx, val) {
  commitSkinSlider(_skinKey(i), keyIdx === 1 ? 'opacity' : 'blur', val);
}
/* 手动裁切展示范围滑杆：0=缩放(100~400%) / 1=水平位置 / 2=垂直位置 */
function onSkinCropSlider(i, keyIdx, val) {
  const kind = _skinKey(i);
  const sk = getSkin(kind);
  const v = parseFloat(val);
  if (keyIdx === 0) {
    sk.zoom = isFinite(v) ? Math.max(1, Math.min(4, v / 100)) : 1;
  } else if (keyIdx === 1) {
  /* 滑杆是「框内对齐」入口：动它就清掉越界偏移，避免两种定位方式打架导致画面跳一下 */
    sk.posX = isFinite(v) ? Math.max(0, Math.min(100, v)) : 50;
    sk.offX = 0;
  } else {
    sk.posY = isFinite(v) ? Math.max(0, Math.min(100, v)) : 50;
    sk.offY = 0;
  }
  applySkinsToDOM();
  const lab = document.getElementById('skinCrop' + (keyIdx === 0 ? 'Zoom' : keyIdx === 1 ? 'X' : 'Y') + 'Val-' + kind);
  if (lab)
    lab.textContent =
      keyIdx === 0 ? Math.round(sk.zoom * 100) + '%' : Math.round(sk[keyIdx === 1 ? 'posX' : 'posY']) + '%';
  const pv = document.getElementById('skinPreview-' + kind);
  if (pv) applySkinGeometry(pv, sk, pv, skinPreviewScale(kind, pv));
}
function commitSkinCropSlider(i, keyIdx, val) {
  onSkinCropSlider(i, keyIdx, val);
  saveData();
}
function onSkinCropSliderIdx(i, keyIdx, val) {
  onSkinCropSlider(i, keyIdx, val);
}
function commitSkinCropSliderIdx(i, keyIdx, val) {
  commitSkinCropSlider(i, keyIdx, val);
}
/* ============================================================
 * 壁纸拖拽定位：全屏模式，直接拖真实计时页上的图片，把人物拖进
 * 计时器圆圈（目标圈），松手保存。所见即所得，不用滑杆猜位置。
 * 图片可以整体拖出边界（另一侧留白），不再被裁切框锁死，也不会自动放大。
 * ============================================================ */
let _skinDrag = {
  kind: null,
  active: false,
  startX: null,
  startY: null,
  posX0: 0,
  posY0: 0,
  zoom0: 1,
  offX0: 0,
  offY0: 0
};
function openSkinDrag(kind) {
  const sk = getSkin(kind);
  if (!sk.data || !sk.expires || sk.expires <= Date.now()) {
    showToast('⏰ 尚未购买或已到期');
    return;
  }
  _skinDrag.kind = kind;
  _skinDrag.posX0 = sk.posX != null ? sk.posX : 50;
  _skinDrag.posY0 = sk.posY != null ? sk.posY : 50;
  _skinDrag.zoom0 = sk.zoom || 1;
  _skinDrag.offX0 = sk.offX != null ? sk.offX : 0;
  _skinDrag.offY0 = sk.offY != null ? sk.offY : 0;
  _skinDrag.active = true;
  /* 记录进入拖拽前商店是否开着：完成后按原状态恢复 */
  _skinDrag.shopWasOpen =
    !!document.getElementById('treeShopModal') && document.getElementById('treeShopModal').classList.contains('show');
  /* 确保壁纸层已挂到页面上，拖拽画布才有图可拖 */
  try {
    applySkinsToDOM();
  } catch (e) { if (window.__silent) window.__silent(e, '01e-openSkinDrag'); }
  /* 关闭所有弹窗（商店/图床等），避免遮挡画布 */
  try {
    document.querySelectorAll('.modal-overlay.show').forEach(function (m) {
      m.classList.remove('show');
      m.style.display = 'none';
    });
  } catch (e) { if (window.__silent) window.__silent(e, '01e8:openSkinDrag'); }
  /* 强制切换视图：直接操作 DOM，不依赖 switchView 内部渲染（渲染函数出错也不影响画布显示） */
  try {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.remove('active');
    });
    const target = document.getElementById(kind === 'wallpaper' ? 'view-timer' : 'view-stats');
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.view === (kind === 'wallpaper' ? 'timer' : 'stats'));
    });
    /* 树木背景在统计页「种植养成」子页里（默认隐藏），必须强制显示 */
    if (kind === 'treebg') {
      const _sdv = document.getElementById('statsDataView');
      if (_sdv) _sdv.style.display = 'none';
      const _stv = document.getElementById('statsTreeView');
      if (_stv) _stv.style.display = 'block';
      try {
        switchStatsSubTab('tree');
      } catch (e) { if (window.__silent) window.__silent(e, '01e8:openSkinDrag'); }
    }
  } catch (e) { if (window.__silent) window.__silent(e, '01e8:openSkinDrag'); }
  const ov = document.getElementById('skinDragModal');
  if (ov) {
    ov.classList.add('show');
    ov.style.display = 'flex';
  }
  const tl = document.getElementById('skinDragTitle');
  if (tl) tl.textContent = kind === 'wallpaper' ? '🪟 计时器壁纸 · 拖到圆圈中央' : '🌳 树木背景 · 拖到你喜欢的位置';
  const zs = document.getElementById('skinDragZoom');
  if (zs) zs.value = Math.round((sk.zoom || 1) * 100);
  const zl = document.getElementById('skinDragZoomVal');
  if (zl) zl.textContent = Math.round((sk.zoom || 1) * 100) + '%';
  const tip = document.getElementById('skinDragTip');
  const tipNormal =
    kind === 'wallpaper'
      ? '👆 单指拖动画面，把<b>人物/想展示的部分</b>拖进<b>圆圈</b>；图片可以<b>拖出边界</b>——上面超出、下面留白都没关系，松手就停住，不回弹也不自动放大；🤏 双指捏合或滑杆可手动缩放。'
      : '👆 单指拖动画面，选择小树身后想展示的部分；图片可以<b>拖出边界</b>——上下左右都能超出，留白也没关系，松手就停住；🤏 双指捏合或滑杆可手动缩放。';
  if (tip) tip.innerHTML = tipNormal;
  /* 图片尺寸还没读取到：先给加载提示，读到了自动恢复可拖 */
  if (!_skinNat[sk.data]) {
    if (tip) tip.innerHTML = '⏳ 正在读取图片尺寸…（几秒内就能开始拖）';
    ensureSkinNatSize(sk.data, function () {
      try {
        if (_skinDrag.active && document.getElementById('skinDragTip'))
          document.getElementById('skinDragTip').innerHTML = tipNormal;
        applySkinsToDOM();
      } catch (e) { if (window.__silent) window.__silent(e, '01e8:openSkinDrag'); }
    });
  }
  /* 目标圈：壁纸画在计时器圆圈上（圆），树木背景画在树场景上（方框），延迟定位等布局稳定 */
  const positionRing = function () {
    const ring = document.getElementById('skinDragRing');
    if (!ring) return;
    const target =
      kind === 'wallpaper' ? document.querySelector('.timer-circle-wrap') : document.getElementById('treeScene');
    if (target) {
      try {
        target.scrollIntoView({ block: 'center' });
      } catch (e) { if (window.__silent) window.__silent(e, '01e8:openSkinDrag'); }
      const r = target.getBoundingClientRect();
      ring.style.left = r.left + 'px';
      ring.style.top = r.top + 'px';
      ring.style.width = r.width + 'px';
      ring.style.height = r.height + 'px';
      ring.style.borderRadius = kind === 'wallpaper' ? '50%' : '12px';
      ring.style.display = 'block';
    } else {
      ring.style.display = 'none';
    }
  };
  try {
    positionRing();
  } catch (e) { if (window.__silent) window.__silent(e, '01e8:openSkinDrag'); }
  setTimeout(positionRing, 150);
  setTimeout(positionRing, 500);
}
function closeSkinDrag() {
  _skinDrag.active = false;
  _skinDrag.startX = null;
  _skinDrag.startY = null;
  const wasShopOpen = _skinDrag.shopWasOpen;
  const kind = _skinDrag.kind;
  _skinDrag.kind = null;
  const ov = document.getElementById('skinDragModal');
  if (ov) {
    ov.classList.remove('show');
    ov.style.display = 'none';
  }
  const ring = document.getElementById('skinDragRing');
  if (ring) ring.style.display = 'none';
  /* 进入拖拽前商店开着 → 回来继续调；没开 → 不打扰（避免商店悄悄重开挡住页面点击） */
  if (wasShopOpen) {
    try {
      openTreeShop();
      switchShopTab('skin');
    } catch (e) {
      try {
        showToast('⚠️ 商店打开失败，请再点一次「商店」按钮');
      } catch (e2) { if (window.__silent) window.__silent(e2, '01e8:closeSkinDrag'); }
    }
  }
  try {
    showToast('✅ 已保存' + (kind === 'treebg' ? '树木背景' : '壁纸') + '效果');
  } catch (e) { if (window.__silent) window.__silent(e, '01e8:closeSkinDrag'); }
}
function resetSkinDrag() {
  const sk = getSkin(_skinDrag.kind);
  if (!sk) return;
  sk.posX = _skinDrag.posX0;
  sk.posY = _skinDrag.posY0;
  sk.zoom = _skinDrag.zoom0;
  sk.offX = _skinDrag.offX0;
  sk.offY = _skinDrag.offY0;
  saveDataNow();
  applySkinsToDOM();
  const zs = document.getElementById('skinDragZoom');
  if (zs) zs.value = Math.round(sk.zoom * 100);
  const zl = document.getElementById('skinDragZoomVal');
  if (zl) zl.textContent = Math.round(sk.zoom * 100) + '%';
  showToast('↩️ 已恢复进入前的效果');
}
/* 拖拽换算工具：像素级读写「图片相对容器的偏移」。
   偏移 = (容器 - 图片) × 百分比 + 越界像素偏移，读出来是唯一真值，
   写回时优先落在 0~100 的百分比里，超出部分落到 offX/offY（留白）。 */
function skinOffsetPx(sk, axis, cv, bv) {
  const pv = parseFloat(axis === 'x' ? sk.posX : sk.posY);
  const ov = parseFloat(axis === 'x' ? sk.offX : sk.offY);
  const p = isFinite(pv) ? Math.max(0, Math.min(100, pv)) : 50;
  const o = isFinite(ov) ? ov : 0;
  return ((cv - bv) * p) / 100 + o;
}
function skinSetOffsetPx(sk, axis, want, cv, bv) {
  const pKey = axis === 'x' ? 'posX' : 'posY',
    oKey = axis === 'x' ? 'offX' : 'offY';
  const diff = cv - bv; /* 有溢出时 diff<0：百分比 0 → 偏移 0，百分比 100 → 偏移 diff */
  if (diff < -0.5) {
    if (want <= 0 && want >= diff) {
      sk[pKey] = (want / diff) * 100;
      sk[oKey] = 0;
    } else if (want < diff) {
      sk[pKey] = 100;
      sk[oKey] = want - diff;
    } /* 继续往左上越界，右下留白 */ else {
      sk[pKey] = 0;
      sk[oKey] = want;
    } /* 继续往右下越界，左上留白 */
  } else {
    /* 图片在该方向不比容器大：百分比不产生位移，全部用像素偏移 */
    sk[oKey] = want;
  }
}
/* 拖拽换算：手指位移 1:1 转成图片像素位移。
    允许越界：拖到图片边缘还能继续拖，图片顶部/左侧滑出容器，另一侧留白，
   松手就停在原地——不自动放大、不回弹，拖过头再拖回来即可。
   · 图片尺寸还没读取到（异步加载）时给出明确提示，加载完自动恢复可拖 */
function dragSkinBy(dx, dy) {
  const kind = _skinDrag.kind;
  if (!kind) return;
  /* NaN 保护：无效增量直接忽略 */
  if (!isFinite(dx)) dx = 0;
  if (!isFinite(dy)) dy = 0;
  if (dx === 0 && dy === 0) return;
  const sk = getSkin(kind);
  let layer = null;
  if (kind === 'wallpaper') {
    layer = document.getElementById('timerWallpaper');
  } else {
    layer = document.querySelector('.tree-custom-bg');
  }
  const el = layer || document.getElementById(kind === 'wallpaper' ? 'view-timer' : 'treeScene');
  if (!el) return;
  /* 原图尺寸是算背景像素尺寸的前提：没读到就明确提示，加载完成会自动重算 */
  if (!_skinNat[sk.data]) {
    const st = _skinNatState[sk.data];
    if (st === 'fail') {
      if (!_skinDrag.failTipAt || Date.now() - _skinDrag.failTipAt > 2500) {
        _skinDrag.failTipAt = Date.now();
        showToast('⚠️ 图片加载失败，拖不动。去「更换链接」换一个图床试试');
      }
    } else {
      if (!_skinDrag.loadTipAt || Date.now() - _skinDrag.loadTipAt > 1500) {
        _skinDrag.loadTipAt = Date.now();
        showToast('⏳ 正在读取图片尺寸，请稍候再拖…');
      }
    }
    ensureSkinNatSize(sk.data, function () {
      try {
        applySkinsToDOM();
      } catch (e) { if (window.__silent) window.__silent(e, '01e8:dragSkinBy'); }
    });
    return;
  }
  /* 用当前层的几何拿容器与背景的像素尺寸 */
  const host = layer ? layer.parentElement || layer : el;
  const info = applySkinGeometry(el, sk, host);
  if (!info) return;
  const cw = info.cw || 0,
    ch = info.ch || 0,
    bgW = info.bgW || 0,
    bgH = info.bgH || 0;
  /* 位置跟着手指走（像素级 1:1）。
     上限取「容器 + 图片」尺寸：足够宽松，拖多远都能拖回来，不会飞出去找不回来。 */
  if (dx !== 0) {
    const lim = cw + bgW;
    skinSetOffsetPx(sk, 'x', Math.max(-lim, Math.min(lim, skinOffsetPx(sk, 'x', cw, bgW) + dx)), cw, bgW);
  }
  if (dy !== 0) {
    const lim = ch + bgH;
    skinSetOffsetPx(sk, 'y', Math.max(-lim, Math.min(lim, skinOffsetPx(sk, 'y', ch, bgH) + dy)), ch, bgH);
  }
  /* 拖动中改走 saveData 防抖通道（300ms 合并），松手时 end 补 saveDataNow 兜底。
     此前每帧 saveDataNow() = 完整 JSON.stringify(appData 含 base64 壁纸) + 双写存储，
     一次 2s 拖拽 ≈120 次 MB 级序列化 + IDB 写队列无界堆积，低端机必卡。 */
  saveData();
  applySkinsToDOM();
}
function onSkinDragZoom(val) {
  const kind = _skinDrag.kind;
  if (!kind) return;
  const sk = getSkin(kind);
  const v = parseFloat(val);
  sk.zoom = isFinite(v) ? Math.max(1, Math.min(4, v / 100)) : 1;
  saveData(); /* 滑杆 oninput 高频触发，同走防抖；松手 change 路径由 end/完成按钮兜底 */
  applySkinsToDOM();
  const zl = document.getElementById('skinDragZoomVal');
  if (zl) zl.textContent = Math.round(sk.zoom * 100) + '%';
}
/* 拖拽事件绑定（鼠标 + 触摸；单指拖动，双指捏合缩放，滚轮缩放） */
function bindSkinDragEvents() {
  const ov = document.getElementById('skinDragModal');
  if (!ov || ov.dataset.bound) return;
  ov.dataset.bound = '1';
  let pinchStartDist = 0,
    pinchStartZoom = 1;
  const pinchDist = function (t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  };
  const applyDragZoom = function (z, notify) {
    const kind = _skinDrag.kind;
    if (!kind) return;
    const sk = getSkin(kind);
    z = Math.max(1, Math.min(4, z));
    if (Math.abs(z - (sk.zoom || 1)) > 0.005) {
      sk.zoom = z;
      saveData(); /* 捏合/滚轮高频，同走防抖 */
      applySkinsToDOM();
    }
    const zs = document.getElementById('skinDragZoom');
    if (zs) zs.value = Math.round(z * 100);
    const zl = document.getElementById('skinDragZoomVal');
    if (zl) zl.textContent = Math.round(z * 100) + '%';
  };
  const start = function (px, py) {
    if (!_skinDrag.active) return;
    _skinDrag.startX = px;
    _skinDrag.startY = py;
    _skinDrag.lastX = px;
    _skinDrag.lastY = py;
    ov.style.cursor = 'grabbing';
  };
  const move = function (px, py) {
    if (!_skinDrag.active || typeof _skinDrag.startX !== 'number') return;
    const dx = px - _skinDrag.lastX,
      dy = py - _skinDrag.lastY;
    _skinDrag.lastX = px;
    _skinDrag.lastY = py;
    dragSkinBy(dx, dy);
  };
  const end = function () {
    if (!_skinDrag.active) return;
    _skinDrag.startX = null;
    _skinDrag.startY = null;
    ov.style.cursor = 'grab';
    saveDataNow(); /* 松手立即直写兜底，确保拖拽终态不依赖防抖窗口 */
  };
  /* 底部工具条（完成/重置按钮、缩放滑杆）必须走浏览器默认行为：
     touchstart 上 preventDefault 会让浏览器不再合成 click，按钮就点不动；
     滑杆也会因为默认触摸行为被吃掉而拖不动。命中工具条时一律放行。 */
  const isBarTarget = function (e) {
    const t = e && e.target;
    if (!t || typeof t.closest !== 'function') return false;
    return !!t.closest('#skinDragBar');
  };
  ov.addEventListener('mousedown', function (e) {
    if (isBarTarget(e)) return;
    e.preventDefault();
    start(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', function (e) {
    if (_skinDrag.active && _skinDrag.startX != null) move(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', function () {
    end();
  });
  /* 触摸：单指=拖动，双指=捏合缩放
      touchstart 必须 preventDefault：否则 iOS/部分安卓 WebView 会把触摸判定为
     页面滚动，touchmove 被浏览器接管（或直接派发 touchcancel），导致图片拖不动 */
  ov.addEventListener(
    'touchstart',
    function (e) {
      if (!_skinDrag.active) return;
      if (isBarTarget(e)) return;
      e.preventDefault();
      if (e.touches.length >= 2) {
        pinchStartDist = pinchDist(e.touches[0], e.touches[1]);
        const kind = _skinDrag.kind;
        pinchStartZoom = (kind ? getSkin(kind).zoom : 1) || 1;
        _skinDrag.pinching = true;
        _skinDrag.startX = null; /* 暂停单指拖动，避免捏合时误移动 */
      } else if (e.touches.length === 1) {
        _skinDrag.pinching = false;
        const t = e.touches[0];
        if (t) start(t.clientX, t.clientY);
      }
    },
    { passive: false }
  );
  ov.addEventListener(
    'touchmove',
    function (e) {
      if (!_skinDrag.active) return;
      if (isBarTarget(e)) return;
      e.preventDefault();
      if (_skinDrag.pinching && e.touches.length >= 2) {
        const d = pinchDist(e.touches[0], e.touches[1]);
        if (pinchStartDist > 0) applyDragZoom(pinchStartZoom * (d / pinchStartDist));
        return;
      }
      if (e.touches.length === 1) {
        const t = e.touches[0];
        if (t) move(t.clientX, t.clientY);
      }
    },
    { passive: false }
  );
  ov.addEventListener('touchend', function (e) {
    if (!_skinDrag.active) return;
    if (isBarTarget(e)) return;
    if (e.touches.length === 1) {
      /* 双指松成单指：把当前指当新的拖动起点，可以继续拖 */
      _skinDrag.pinching = false;
      const t = e.touches[0];
      _skinDrag.startX = t.clientX;
      _skinDrag.startY = t.clientY;
      _skinDrag.lastX = t.clientX;
      _skinDrag.lastY = t.clientY;
    } else if (e.touches.length === 0) {
      _skinDrag.pinching = false;
      end();
    }
  });
  /* 触摸被系统打断（来电/手势冲突等）：清理拖动状态，避免卡住 */
  ov.addEventListener('touchcancel', function () {
    _skinDrag.pinching = false;
    end();
  });
  /* 桌面：滚轮缩放 */
  ov.addEventListener(
    'wheel',
    function (e) {
      if (!_skinDrag.active) return;
      if (isBarTarget(e)) return;
      e.preventDefault();
      const kind = _skinDrag.kind;
      if (!kind) return;
      const step = e.deltaY < 0 ? 0.1 : -0.1;
      applyDragZoom((getSkin(kind).zoom || 1) + step);
    },
    { passive: false }
  );
}
/* 商店「皮肤」板块渲染 */
function renderSkinShop() {
  const box = document.getElementById('shopSkinList');
  if (!box) return;
  const tr = appData.tree;
  if (!tr) return;
  let h =
    '<div style="font-size:var(--fs-caption);color:var(--text-light);line-height:1.65;margin-bottom:var(--sp-10);background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:var(--sp-8) var(--sp-10);">' +
    '📌 购买后 <b>有效期内可随时更换</b>。图片走<b>图床链接</b>：传到任意图床后把<b>图片直链</b>粘进来即可，' +
    '本地只保存一个网址，不占空间。<br>' +
    '🖼️ 默认按比例铺满裁切，也可用下方「展示范围」滑杆<b>自己选裁哪里</b>：缩放越大看得越局部，水平/垂直滑杆平移画面。<br>' +
    '壁纸默认带模糊 + 半透明，滑杆可随时调，保证不影响看时间。到期后链接自动清除。<br>' +
    '🔄 每次填新链接都会<b>直接覆盖</b>旧链接。<br>' +
    '⚠️ 若图片没显示，多半是图床防盗链（已做常规规避）或链接失效，换一个图床即可。</div>';
  SKIN_KINDS.forEach(function (k, i) {
    const sk = getSkin(k.key);
    const active = skinIsActive(k.key);
    const paid = !!(sk.expires && sk.expires > Date.now());
    const days = skinRemainDays(k.key);
    /* treebg / wallpaper（计时器壁纸）统一阶梯定价：按各自购买次数取档；
       皮肤为宣传固定价商品，不走动态定价，仅余额 ≥8000 时小额上浮 10% */
    const tier = getSkinTier(getSkinPurchaseCount(k.key));
    let price = skinPriceWithSurcharge(tier.price);
    const _up = price > tier.price;
    let daysLabel = tier.days + '天';
    let btnLabel = (paid ? '续费' : '购买') + daysLabel;
    const canBuy = (tr.coins || 0) >= price;
    let state;
    if (paid) state = '✓ 有效期剩 ' + days + ' 天';
    else state = '未拥有';
    h += '<div class="skin-shop-item">';
    h +=
      '<div class="skin-head"><span class="skin-icon">' +
      k.icon +
      '</span><span class="skin-name">' +
      k.name +
      '</span><span class="skin-state">' +
      state +
      '</span></div>';
    h +=
      '<div class="skin-desc">' +
      (k.key === 'wallpaper'
        ? '整个计时器页面的壁纸。默认模糊 8px + 不透明度 55%，不抢戏。'
        : '换掉小树身后的背景（保留场景里的小花小草在图片之上）。') +
      '<br><span style="color:var(--text-light);">填图床直链即可，图片不存本地。</span></div>';
    /* 阶梯定价提示（两个商品通用）。★ 价格一律从 SKIN_TIER_TABLE 拼，**不许写死数字**：
       写死后改档位价时这段文案会静默说谎（历史上奖励从 50 改 25 就漏改过若干处），
       而且 tools/check_tomato_single_source.py 的「金额不许写死在文案里」门禁会直接拦。
       若高余额上浮则追加红字说明（见下）。 */
    let cnt = getSkinPurchaseCount(k.key);
    const _st0 = SKIN_TIER_TABLE[0],
      _st1 = SKIN_TIER_TABLE[1],
      _st2 = SKIN_TIER_TABLE[2];
    const _daysWord = function (d) {
      return d === 30 ? '月' : d + '天';
    };
    let tierInfo = '';
    if (cnt === 0)
      tierInfo =
        '💰 首次体验：' + _st0.price + '🪙 / ' + _st0.days + '天 → 第二次 ' + _st1.price + '🪙 / ' +
        _st1.days + '天 → 之后 ' + _st2.price + '🪙 / ' + _daysWord(_st2.days);
    else if (cnt === 1)
      tierInfo =
        '💰 本次购买：' + _st1.price + '🪙 / ' + _st1.days + '天 → 之后 ' + _st2.price + '🪙 / ' +
        _daysWord(_st2.days);
    else tierInfo = '💰 当前价格：' + _st2.price + '🪙 / ' + _daysWord(_st2.days) + '（已过体验期）';
    if (_up)
      tierInfo +=
        '<br><span style="color:var(--danger);">⚠️ 余额 ≥' +
        SKIN_SURCHARGE_AT +
        '：本档实付 ' +
        price +
        '🪙（小额上浮 ' +
        Math.round((SKIN_SURCHARGE_MULT - 1) * 100) +
        '%，不随余额继续涨）</span>';
    h += '<div class="skin-tip" style="color: var(--primary-ink);font-weight:700;">' + tierInfo + '</div>';
    h += '<div class="skin-actions">';
    h +=
      '<button class="shop-btn small ' +
      (canBuy ? '' : 'disabled') +
      '" onclick="buySkinIdx(' +
      i +
      ')" ' +
      (canBuy ? '' : 'disabled') +
      '>' +
      btnLabel +
      ' ' +
      price +
      '🪙</button>';
    if (!paid) {
      h += '<div class="skin-tip">购买后即可填写图片链接，有效期内随便换。</div>';
    }
    if (paid) {
      h +=
        '<button class="shop-btn small" onclick="openSkinUrlInputIdx(' +
        i +
        ')">' +
        (sk.data ? '🔗 更换链接' : '🔗 填写图片链接') +
        '</button>';
      if (sk.data)
        h +=
          '<button class="shop-btn small" style="background:var(--fill-primary);color:var(--on-fill);border-color:var(--primary-dark)" onclick="openSkinDrag(\'' +
          k.key +
          '\')">✋ 拖拽定位</button>';
      if (sk.data) h += '<button class="shop-btn small" onclick="removeSkinIdx(' + i + ')">🗑️ 移除</button>';
    }
    h += '</div>';
    const _skinUrl = safeSkinUrl(sk.data);
    if (paid && _skinUrl) {
      h +=
        '<div class="skin-preview" id="skinPreview-' +
        k.key +
        '" style="background-image:url(' +
        _skinUrl +
        ');filter:' +
        (sk.blur ? 'blur(' + sk.blur + 'px)' : 'none') +
        ';opacity:' +
        sk.opacity +
        ';"></div>';
      h +=
        '<div class="skin-slider"><span class="ss-label">模糊</span>' +
        '<input type="range" min="0" max="20" step="1" value="' +
        sk.blur +
        '" oninput="onSkinSliderIdx(' +
        i +
        ',0,this.value)" onchange="commitSkinSliderIdx(' +
        i +
        ',0,this.value)">' +
        '<span class="ss-val" id="skinBlurVal-' +
        k.key +
        '">' +
        sk.blur +
        'px</span></div>';
      h +=
        '<div class="skin-slider"><span class="ss-label">不透明度</span>' +
        '<input type="range" min="15" max="100" step="5" value="' +
        Math.round(sk.opacity * 100) +
        '" oninput="onSkinSliderIdx(' +
        i +
        ',1,this.value)" onchange="commitSkinSliderIdx(' +
        i +
        ',1,this.value)">' +
        '<span class="ss-val" id="skinOpacityVal-' +
        k.key +
        '">' +
        Math.round(sk.opacity * 100) +
        '%</span></div>';
      h +=
        '<div style="margin-top:var(--sp-8);padding-top:var(--sp-8);border-top:1px solid var(--border);font-size:var(--fs-caption);color:var(--text-light);font-weight:700;">✂️ 展示范围（自己选裁哪里）</div>';
      h +=
        '<div class="skin-slider"><span class="ss-label">缩放</span>' +
        '<input type="range" min="100" max="400" step="10" value="' +
        Math.round((sk.zoom || 1) * 100) +
        '" oninput="onSkinCropSliderIdx(' +
        i +
        ',0,this.value)" onchange="commitSkinCropSliderIdx(' +
        i +
        ',0,this.value)">' +
        '<span class="ss-val" id="skinCropZoomVal-' +
        k.key +
        '">' +
        Math.round((sk.zoom || 1) * 100) +
        '%</span></div>';
      h +=
        '<div class="skin-slider"><span class="ss-label">水平位置</span>' +
        '<input type="range" min="0" max="100" step="1" value="' +
        Math.round(sk.posX != null ? sk.posX : 50) +
        '" oninput="onSkinCropSliderIdx(' +
        i +
        ',1,this.value)" onchange="commitSkinCropSliderIdx(' +
        i +
        ',1,this.value)">' +
        '<span class="ss-val" id="skinCropXVal-' +
        k.key +
        '">' +
        Math.round(sk.posX != null ? sk.posX : 50) +
        '%</span></div>';
      h +=
        '<div class="skin-slider"><span class="ss-label">垂直位置</span>' +
        '<input type="range" min="0" max="100" step="1" value="' +
        Math.round(sk.posY != null ? sk.posY : 50) +
        '" oninput="onSkinCropSliderIdx(' +
        i +
        ',2,this.value)" onchange="commitSkinCropSliderIdx(' +
        i +
        ',2,this.value)">' +
        '<span class="ss-val" id="skinCropYVal-' +
        k.key +
        '">' +
        Math.round(sk.posY != null ? sk.posY : 50) +
        '%</span></div>';
      h += '<div class="skin-tip">滑杆可微调；要精确定位就点上方「✋ 拖拽定位」，直接拖图把人物放进计时器圆圈。</div>';
    }
    h += '</div>';
  });
  box.innerHTML = h;
  /* 预览框同步手动裁切几何（缩放/位置），所见即所得 */
  SKIN_KINDS.forEach(function (k) {
    const pv = document.getElementById('skinPreview-' + k.key);
    if (pv) {
      try {
        applySkinGeometry(pv, getSkin(k.key), pv, skinPreviewScale(k.key, pv));
      } catch (e) { if (window.__silent) window.__silent(e, '01e8:renderSkinShop'); }
    }
  });
} /* 商店弹窗渲染 */
