# DESIGN.md — 瓶子专注 · 设计系统规范

> **性质**：本文件是「瓶子专注」的**设计契约**，由项目真源逐值提取而成
> （`src/template/10_tokens.css` / `11_layout_timer.css` / `12_components.css` /
> `1A_dark_misc.css` §精致化视觉系统 / `src/scripts/0E_theme_主题引擎.js`），**不是另起一套**。
> 每个数值都能在源码里核对；`>` 引用块里的「为什么」来自代码注释中的踩坑记录。
> **适用对象**：人（设计师 / 前端）与 AI 编程代理。改界面前先读本文件，改完必须过 `python3 tools/build.py --lint`。
>
> **一句话气质**：**克制的纸上手账** —— 暖米白纸底 + 细描边(1px) + 轻柔阴影，
> 界面安静、内容突出；**硬偏移阴影只留给主按钮**，作为被一眼认出的品牌记忆点。

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

**设计哲学**：界面是**纸**，不是玻璃。所以没有 `backdrop-filter`、没有玻璃拟态；
层级靠**细描边 + 轻柔阴影 + 表面深浅递进**表达，而不是靠模糊与发光。

风格在 2026 年的「**精致化视觉系统**」一版定型，当时定的四条是代码注释原话：

> 轻阴影 / 细边框 / 8px 间距网格 / 克制配色
> **主按钮保留轻硬阴影作为品牌记忆点，其余表面全面轻盈化。**

| 核心视觉特征 | 具体表现 |
|---|---|
| **细描边** | 常规表面 `border-width: 1px`；主按钮 `2px`；小按钮/弹窗按钮 `1.5px` |
| **轻柔阴影** | 主力 `--shadow-soft: 0 1px 3px rgba(20,26,48,.07), 0 1px 2px rgba(20,26,48,.05)`（**双层偏移**，不用单层大模糊） |
| **唯一的硬阴影** | 只有 `.btn`（主操作按钮）保留 `box-shadow: 2px 2px 0 var(--border)` —— 品牌记忆点 |
| **按压＝微缩 + 轻暗** | `:active` 统一 `transform: scale(.96)` + `filter: brightness(.92)`（**不回弹占位**），触屏/鼠标一致 |
| **米白纸底** | 页面底 `#F5F0E8`（暖米），卡片纯白 `#FFFFFF`，浮起面 `#FBF7EF` |
| **暖橙主色** | `--primary: #E85D3A`（番茄红），呼应产品本体 |
| **克制配色** | 一屏内只允许一个主色焦点；语义色成对使用、不铺满 |

**光影倾向**：**柔光为主，硬阴影唯一例外**。
浮层（弹窗 / 引导条）用 `--shadow-soft-xl`；主体表面用 `--shadow-soft`；底部导航额外带一道**向上的柔光** `0 -4px 16px rgba(20,26,48,.08)`。

> ★ **按压反馈不是位移**。基础层曾写 `:active { transform: translate(2px,2px) }`，
> 但后期「互动增强」段（`1A_dark_misc.css` L1129/L1132）以同特异性后置覆盖为
> `scale(.96)` + `brightness(.92)` —— **不占位、不掉帧、触屏与鼠标手感一致**。
> 这是全站统一的按压语言，新组件沿用即可。

**语气**：第二人称、鼓励式、具体动作（「已补记 · 已关联计划『数学卷子』」），
不用「操作成功」这类系统腔。

---

## 2. Color Palette & Roles（调色板与角色）

### 2.1 品牌 / 主色 / 表面

| 令牌 | 值 | 用途 |
|---|---|---|
| `--primary` | `#E85D3A` | 主色（番茄红）：主按钮底、活跃态、焦点环 |
| `--primary-dark` | `#C94A2A` | 按压态、主色文字 |
| `--primary-rgb` | `232,93,58` | 半透明场景 `rgba(var(--primary-rgb),.28)`。**必须与 `--primary` 同步翻转** |
| `--on-primary` | `#FFFFFF`（深色 `#062a45`） | **主色底上的文字色**。深色主题下自动翻深 |
| `--header-hi` / `--header-lo` | `#FF8A50` / `#C13F22` | 顶栏渐变的受光端 / 收尾端 |
| `--accent` | `#FF8A50` | 主强调橙（品牌浅橙），供 JS 内联引用收编 |
| `--surface-0` / `--bg` | `#F5F0E8` | 页面底（最沉） |
| `--surface-1` / `--card` | `#FFFFFF` | 常规卡片 |
| `--surface-2` | `#FBF7EF` | 浮起卡片 / 输入框底 / 小按钮底 |
| `--surface-3` | `#F0EADF` | 按压态 / 嵌套块 |
| `--ink-strong` | `#1A2438` | 强墨色（顶栏沉浸条 `#1A2440` 同族） |
| `--white` / `--black` / `--gold` | `#FFFFFF` / `#000000` / `#FFD700` | **固定色**：不随主题翻转 |

> ★ `--on-primary` 是**唯一出口**。深色主题下 `--primary` 变成浅蓝 `#4fc3f7`，
> 若还写死 `color:#fff` 就成了「浅底白字」看不见。**永远用 `--on-primary`，不要写 `--white`**。

### 2.2 文字与描边

| 令牌 | 值 | 对比度 / 用途 |
|---|---|---|
| `--text` | `#2C3E50` | 正文（深蓝墨） |
| `--text-light` | `#5D6D7E` | 辅助小字。**已校准 4.7~5.3:1（AA）**，由早年 ~3.5:1 提升而来 |
| `--border` | `#2C3E50` | 描边与硬阴影的色源 |
| `--hairline` | `rgba(44,62,80,.12)` | 卡片内分割线，比 `--border` 轻一档 |

### 2.3 语义色（**成对使用**：浅底 + 深字）

| 语义 | 字色 | 浅底 / 线 / 柔底 |
|---|---|---|
| 成功 | `--ok: #2E7D32` | `--ok-bg #E8F5E9` / `--ok-line #A5D6A7` / `--ok-soft rgba(76,175,80,.14)` |
| 危险 | `--danger: #C0392B` | `--danger-bg #FFD5D5` / `--danger-soft rgba(192,57,43,.12)` —— 删除/清除类**唯一出处** |
| 警告 | `--warn: #B8860B` | `--warn-bg #FFF3CD` / `--warn-soft rgba(255,193,7,.18)` |
| 信息 | `--info-ink: #1565C0` | `--info-bg #E3F2FD` / `--info-line #90CAF9` |
| 强调 | `--accent-ink: #E65100` | `--accent-bg #FFF3E0` |

### 2.4 功能色（有语义，不许乱用）

| 组 | 令牌 → 值 |
|---|---|
| **计时语义** | `--work: #E85D3A`（专注）`--short-break: #5CB85C`（短休）`--long-break: #5B9BD5`（长休） |
| **图表** | `--c-full #E85D3A` `--c-half #2E9E5B` `--c-min #3D6FB4` `--c-int #8E44AD` `--c-sleep #3D6FB4` `--c-mental #D99530` `--c-energy #2E9E5B` `--c-pleasure #E85D3A` `--c-grid #E8E1D3` `--c-axis #C9C2B4` |
| **年度热力图** | `--hm0 #E8E4DC` → `--hm1 #FFE082`（1~2）→ `--hm2 #FFB74D`（2~4）→ `--hm3 #FF7043`（4~7）→ `--hm4 #D84315`（7+） |
| **保留语义族** | `--green #5CB85C` / `--red #D9534F` / `--blue #5B9BD5` / `--yellow #F0AD4E` / `--purple #6B5B95`（各带 `-dark` 与 `-rgb`） |

> ⚠️ `--red`（配色语义）≠ `--danger`（危险操作语义）。删东西用 `--danger`，画图表用 `--c-*`。
> 这条曾出过事故：`--red` 只在 5 套皮肤与深色模式里定义过，**默认浅色主题下 `var(--red)` 落空** →
> 「invalid at computed-value time」→ 整条声明退化成初始值 → 四象限 q1 选中态变透明底白字、
> 日程「当前时刻线」整条消失。

### 2.5 深色模式（`body.dark-mode` 重映射）

| 令牌 | 浅色 → 深色 |
|---|---|
| `--bg` | `#F5F0E8` → `#1a1a2e` |
| `--card` | `#FFFFFF` → `#16213e` |
| `--text` / `--text-light` | `#2C3E50` / `#5D6D7E` → `#e0e0e0` / `#8892b0` |
| `--border` | `#2C3E50` → `#2a2a4a` |
| `--primary` / `--primary-rgb` | `#E85D3A` / `232,93,58` → `#4fc3f7` / `79,195,247` |
| `--on-primary` | `#FFFFFF` → `#062a45` |
| 语义浅底 | `#E8F5E9` / `#FFD5D5` / `#FFF3CD` → `#17331c` / `#6b1f1f` / `#4a3c16` |
| 柔阴影 | `rgba(20,26,48,.07~.16)` → `rgba(0,0,0,.4~.6)` |

> 深色下 `.badge-card` / `.ach-card` 这类浅色品牌底必须被 `background:#1b2038 !important` 压掉，
> 否则「亮成灯笼」。这是深色走查的第一高发区。

### 2.6 六套主题（`body[data-theme]`，由 `0E_theme_主题引擎.js` 驱动）

| key | 名称 | 气质 | swatch（底 / 主 / 辅） |
|---|---|---|---|
| `default` | 番茄原色 | 暖橙 · 经典 | `#FDF6EC` `#E85D3A` `#2E9E5B` |
| `nord` | 北欧 | 冷冽 · 克制 | `#ECEFF4` `#5E81AC` `#7A9E6A` |
| `tokyo` | 东京夜 | 深邃 · 霓虹 | `#1A1B26` `#7AA2F7` `#BB9AF7` |
| `gruvbox` | 复古灰 | 暖褐 · 怀旧 | `#FBF1C7` `#D65D0E` `#98971A` |
| `rosepine` | 玫瑰松 | 柔粉 · 雅致 | `#FAF4ED` `#EB6F92` `#31748F` |
| `catppuccin` | 卡布奇诺 | 奶咖 · 柔和 | `#EFF1F5` `#8839EF` `#40A02B` |

> **主题只覆盖令牌，不覆盖组件结构**。新增主题 = 加一组 CSS 变量覆盖，
> **禁止**写 `.theme-x .btn { … }` 这类结构补丁。
> `--on-yellow` 是特例：黄底深浅跨主题差异极大（`#F0AD4E` → `#8C6C3E`），
> 默认 `var(--black)` 在 11/12 套主题达标，仅 `theme-3` 深黄单独覆盖为白（实算 **1.94 → 10.79:1**）。

---

## 3. Typography Rules（排版规则）

### 3.1 字体族

```css
font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
             "Microsoft YaHei", sans-serif;
```

**纯系统字体栈，零 Web Font**（离线单文件交付，不引任何外部资源）。

### 3.2 Type Scale（**全项目只许用这 9 档**）

| 档位 | 令牌 | 值 | 字重 | 行高 | 字距 | 对应 Apple HIG |
|---|---|---|---|---|---|---|
| Nano | `--fs-micro` | **12px** | 400 / 600 | 1.35 | 0 | caption2 |
| Tiny | `--fs-tiny` | **13px** | 400 | 1.4 | 0 | caption1 |
| Caption | `--fs-caption` | **13px** | 400 / 600 | 1.45 | 0 | footnote |
| Note | `--fs-note` | **15px** | 400 / 600 | 1.5 | 0 | subheadline |
| Body | `--fs-body` | **16px** | 400 | 1.6 | 0 | callout（Web 正文下限） |
| Title | `--fs-title` | **17px** | 600 / 700 | 1.45 | 0 | body / headline |
| Sub | `--fs-sub` | **20px** | 700 | 1.35 | 0 | title3 |
| Hero | `--fs-hero` | **22px** | 700 / 800 | 1.3 | 0 | title2 |
| H1 | `--fs-h1` | **24px** | 700 | 1.25 | **2px** | title1（品牌标题专用） |

> **长文读写区取 `--fs-title`（17px），不取 16px 下限**（2026-10-13 补）
> 日记 / 每日复盘 / 感恩日记这类「用户要反复回看自己写的字」的输入区，用 `--fs-title`。
> 16px（`--fs-body`）是**可读下限**，适合短标签与行内正文，不适合承载长文。
> 依据：HIG 的 body 本身就是 17pt，16px 对应的是 callout 档。
> 全站字号还可在「设置 → 字号大小」整体放大四档（标准 / 大字 / 特大 / 老年）。

```css
:root {
  /* --fs-boost 抵系统缩放，--fs-user 是用户选的档位（各管一段） */
  --fs-micro:   calc(12px * var(--fs-boost) * var(--fs-user));
  --fs-tiny:    calc(13px * var(--fs-boost) * var(--fs-user));
  --fs-caption: calc(13px * var(--fs-boost) * var(--fs-user));
  --fs-note:    calc(15px * var(--fs-boost) * var(--fs-user));
  --fs-body:    calc(16px * var(--fs-boost) * var(--fs-user));
  --fs-title:   calc(17px * var(--fs-boost) * var(--fs-user));
  --fs-sub:     calc(20px * var(--fs-boost) * var(--fs-user));
  --fs-hero:    calc(22px * var(--fs-boost) * var(--fs-user));
  --fs-h1:      calc(24px * var(--fs-boost) * var(--fs-user));
}
body { font-size: calc(16px * var(--fs-boost) * var(--fs-user)); }   /* 显式基准，防系统默认字号泄漏 */
```

**三条硬规则**

1. **禁止写 `font-size: Npx`** —— `build.py --lint` 按令牌表拦下（历史遗留 655 处硬编码已清）。
2. **阶梯与 HIG 逐档对齐**，消除了原先 13-14-15 三档挤在一起的「层级糊掉」。
   `--fs-tiny` 与 `--fs-caption` 同为 13px 是历史冗余（114 处动用点，另案处理）。
3. **系统字号必须被抵消**：手机（Android Chrome/WebView）的「系统字体大小」会把**每个 px 字号**乘一个系数（实测 **1.45×**）而**盒子尺寸一分不改** → 字撑破卡片、横向溢出。
   `text-size-adjust` 拦不住（实测 `100%` 与 `none` 都是 1.45×），只能量出来再除回去：
   `applyFontScale()` 用探针量出系数 k，把 `--fs-boost` 写成 `1/k`。

### 3.3 字号缩放哲学

- 设置页「字号大小」**只改 `--fs-user`，不碰 `width/height/padding`** —— 放大只影响可读性，布局关系不变。
- **间距只乘 `--fs-user`，不乘 `--fs-boost`**：系统字号缩放不该把留白也顶开。
- 曾走「整页 `zoom`」的路，因**一屏看到的少了一截**已回退；但**缩放不改 `innerWidth`，媒体查询不跟着触发**，
  所以窄屏收缩规则必须**常驻**，不能只写在 `@media (max-width:400px)` 里。

---

## 4. Component Stylings（组件样式）

### 4.1 Buttons

```css
/* 基础 .btn —— 主操作按钮，全站唯一保留硬阴影的元素（品牌记忆点） */
.btn {
  padding: var(--sp-12) var(--sp-8);
  border: 2px solid var(--border);              /* 基础 3px → 轻盈化后 2px */
  border-radius: var(--radius);                 /* 8px */
  font-size: var(--fs-title);                   /* 17px */
  font-weight: 700;
  box-shadow: 2px 2px 0 var(--border);          /* ★ 品牌记忆点：零模糊硬阴影 */
  display: flex; flex-direction: column; align-items: center; gap: var(--sp-2);
  transition: transform var(--dur-xs) var(--ease-out), filter var(--dur-s) var(--ease-out);
}
/* 全站统一按压语言（1A_dark_misc L1129/L1132 后置覆盖基础层的 translate） */
.btn:active { transform: scale(.96); filter: brightness(.92); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
@media (hover: hover) { .btn:hover { filter: brightness(1.06); } }   /* 仅精确指针设备 */
```
同一套按压/悬停规则覆盖：`.btn-primary / .btn-small / .modal-btn / .md-btn / .header-btn /
.seg-btn / .sp-tab / .tree-lottery-btn / .mystery-claim / .ft-done-btn`。

| 变体 | 类 | 规格 |
|---|---|---|
| 主按钮 | `.btn-primary` | `--primary` / `--on-primary`；`width:100%`，`padding:var(--sp-14)`，`fs-sub` |
| 次按钮 | `.btn-secondary` | `--card` / `--text` |
| 实心 | `.btn-solid` | `--primary` / `--on-primary`（**唯一实心出口**） |
| 实心绿/红 | `.btn-solid--green` / `.btn-solid--red` | `--green` / `--red` |
| 危险（浅底） | `.btn-danger` | `--danger-bg` / `--danger` |
| 场景：开始 | `.btn-start` | `#D4EDDA` / `--green-dark` |
| 场景：完成 | `.btn-finish` | `#D1ECF1` / `--blue-dark` |
| 场景：打断 | `.btn-interrupt` | `--warn-bg` / `--yellow-dark` |

```css
/* 小按钮 / 弹窗按钮：轻盈化后去掉阴影，只留 1.5px 描边 */
.btn-small, .modal-btn, .todo-save-btn, .end-session-btn {
  border-width: 1.5px; border-radius: var(--radius); box-shadow: none;
}
.btn-small { padding: var(--sp-6) var(--sp-12); font-size: var(--fs-note); background: var(--surface-2); font-weight: 700; }
```

> **禁止在 HTML 里写内联色**（如 `style="background:#FFD5D5"`）。
> 危险按钮的唯一出口是 `.btn-danger` / `.modal-btn.danger`。

### 4.2 Cards

```css
/* 卡片 / 设置分组：细描边 + 12px 圆角 + 轻柔阴影（内边距沿用基础层） */
.card, .settings-group {
  border-width: 1px;                            /* 基础层 3px 被覆盖 */
  border-radius: var(--radius-card);            /* 12px */
  box-shadow: var(--shadow-soft);
}
.settings-group { padding: var(--sp-14); margin-bottom: var(--sp-14); }   /* 基础层沿用 */
.todo-item, .habit-item {
  border-width: 1px; border-radius: var(--radius-card);
  box-shadow: var(--shadow-soft); margin-bottom: var(--sp-4);
}
.todo-item.done { box-shadow: none; }           /* 已完成：去掉阴影，视觉上「落下去」 */
```
同族还有 `.timer-rank-strip` / `.state-section` / `.break-dice-section` / `.bd-card` / `.ghost-bar-box`。
按压态用 `--surface-3` 底。

### 4.3 Inputs

```css
/* 输入类全面轻量化：1px 边 + 8px 圆角 + 无阴影（!important 是有意的，见下） */
input, textarea, select, .current-todo-select, .setting-input {
  border-width: 1px !important;
  border-radius: var(--radius-input) !important;   /* 8px */
  box-shadow: none !important;
}
.setting-input { width: 60px; padding: var(--sp-6) var(--sp-8); font-size: var(--fs-title); text-align: center; flex-shrink: 0; }
.memo-sendbar input {
  flex: 1 1 auto; min-width: 0; border: 1px solid var(--border);
  background: var(--card); color: var(--text);
  border-radius: var(--radius-input); padding: var(--sp-8) var(--sp-10);
  font-size: var(--fs-body); font-family: inherit;
}
input:focus { box-shadow: var(--focus-ring); }   /* 0 0 0 3px rgba(232,93,58,.28) */
label { margin-bottom: var(--sp-2); }
```

> `!important` 在这里是刻意的：历史上有大量内联 `style="border:2px solid…"` 的输入框，
> 靠特异性无法统一，只能这样收口。**新代码不要靠 `!important`，直接写对令牌。**

### 4.4 Navigation

```css
.bottom-nav {
  position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 480px;
  background: var(--card);
  border-top: 1px solid var(--border);                          /* 基础 3px → 收敛为 1px */
  box-shadow: 0 -4px 16px rgba(20,26,48,.08);                  /* 向上柔光，与页面拉出层次 */
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 100;
}
body.dark-mode .bottom-nav { box-shadow: 0 -4px 16px rgba(0,0,0,.35); }
body.kb-open .bottom-nav { display: none; }                    /* 软键盘弹出时隐藏，见 §8.2 */

/* 激活指示条：28×3px 短横，spring 动画「长出来」 */
.bottom-nav .nav-item .nav-indicator {
  position: absolute; bottom: 0; left: 50%; width: 28px; height: 3px;
  border-radius: var(--radius-xs) var(--radius-xs) 0 0; background: var(--primary);
  transform: translateX(-50%) scaleX(0); transition: transform var(--dur-m) var(--ease-spring);
}
.bottom-nav .nav-item.active .nav-indicator { transform: translateX(-50%) scaleX(1); }
.bottom-nav .nav-item.active svg { transform: translateY(-1px) scale(1.10); }
.bottom-nav .nav-item.active .nav-label { font-weight: 800; }
```
- `.nav-item` **禁用文本选择**（`user-select: none`）；`.nav-item.active { color: var(--primary) }`。
- 二级页签 `.plan-tab / .log-tab / .stats-nav`：未选 `--text-light`，选中 `--primary` + `border-bottom`。
- **`.header` 顶部 10px 是 `#1A2440` 沉浸色条**（供系统状态栏/地址栏取色），下方才是品牌红渐变 `--header-hi → --primary`。

### 4.5 Badges / Chips / Tags

| 组件 | 规格 |
|---|---|
| `.plan-chip` **（计划归属，2026-10-13 统一）** | `fs-micro` / 600 / `--text-light` / `--surface-2` 底 / `1px solid var(--border)` / `radius-full` / `padding: 0 var(--sp-6)`。`.plan-chip.done` → `--green-dark` 字 + `--green` 边 + `rgba(var(--green-rgb),.10)` 底 |
| `.log-sub-chip` | 同 `.plan-chip` 外形；`.done` 走绿；`.more` 用 `opacity:.8` |
| `.quad-badge` | `quad-chip--q1..q4` 四象限徽标，配色由 `TODO_QUADS` 常量供色源 |
| `.timeline-tag` | 时间轴标签，`--fs-caption` + `1px solid var(--border)`；`.tag-sub` 用 `--bg` 底更弱一档 |
| 成就 / 战标卡 | 浅色品牌底；**深色下必须被 `.dark-mode .badge-card / .ach-card { background:#1b2038 !important }` 压掉** |
| 商品卡 `.shop-item` | `2px` 边 + `radius-md` + 柔光阴影 + **五档稀有度渐变**（`rarity-common/affordable/popular/premium/legend`），`hover` 时 `translateY(-2px)` 浮起 |

> **`plan-chip` 的由来**：「今天完成」条与专注记录卡曾各用一套样式，
> 需求原话「长得都不一样…根本就没有关联」。现在同一个计划在两处是**同一个构件**，
> 只差状态图标（完成条 `✅` / 记录卡 `📋`）。

### 4.6 Modals / Dialogs

```css
.modal-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,.5);                    /* 唯一允许的纯黑半透明遮罩 */
  z-index: 200; padding: var(--sp-20);
  align-items: center; justify-content: center; overflow-y: auto;
}
.modal-overlay.show { display: flex; }
@media (max-width: 360px) {
  .modal-overlay { padding: 10px; }
  .modal-overlay .modal { padding: 14px; }       /* 提高特异性，防被 .modal 覆盖 */
}

.modal {
  background: var(--card);
  border-width: 1px;                              /* 轻盈化：3px → 1px */
  border-radius: var(--radius-lg);                /* 16px */
  box-shadow: var(--shadow-soft-xl);              /* 0 12px 40px rgba(20,26,48,.16), 0 4px 12px rgba(20,26,48,.08) */
  padding: var(--sp-20);
  width: 100%; max-width: 340px; max-height: 85vh; overflow-y: auto; margin: auto;
}
.modal h3 { font-size: var(--fs-hero); margin-bottom: var(--sp-12); text-align: center; }
.modal p  { font-size: var(--fs-title); color: var(--text-light); line-height: 1.6; text-align: center; }
.modal-buttons { display: flex; gap: var(--sp-8); flex-wrap: wrap; }
.modal-btn { flex: 1; min-width: 80px; padding: var(--sp-12) var(--sp-8); font-size: var(--fs-title); font-weight: 700; text-align: center; }
.modal-btn:active { transform: scale(.96); filter: brightness(.92); }   /* 与全站按压语言一致 */
```
变体：`.primary`（`--primary`/`--on-primary`）、`.secondary`（`--card`）、`.green`（`--ok-bg`/`--green-dark`）、
`.yellow`（`--warn-bg`/`--yellow-dark`）、`.danger`（`--danger-bg`/`--danger`）、`.solid-danger`、`.solid-green`、`.purple`、`.cta`（`fs-sub` + `padding: 12px 30px`）。

**入场动画**：遮罩淡入 + 卡片 `opacity 0→1` / `translateY(12px)→0`，`--dur-m` + `--ease-out`。

---

## 5. Layout Principles（布局原则）

### 5.1 Spacing System（**10 档，禁止新值**）

| 令牌 | 值 | 主力场景 |
|---|---|---|
| `--sp-2` | 2px | 图标与文字缝隙、`label` 下边距 |
| `--sp-4` | 4px | 胶囊内左右、chips 间距、列表项间距 |
| `--sp-6` | 6px | 小按钮内、行内元素间距 |
| `--sp-8` | 8px | **默认间距**（按钮组、表单行） |
| `--sp-10` | 10px | 卡片内边距（主力） |
| `--sp-12` | 12px | 区块内分隔 |
| `--sp-14` | 14px | 主按钮纵向内边距 |
| `--sp-16` | 16px | 卡片内边距（大） |
| `--sp-20` | 20px | 弹窗外边距、区块间距 |
| `--sp-24` | 24px | 页面级留白（**上限**） |

> 口径是「**8px 网格感**」而不是死板 4px 栅格：项目主力值是 **8/10/6/4**，
> 强行对齐 4 栅格会把 203 处 10px 压成 8px（真实位移，得不偿失）。
> `> 24px` 与 `@media` 内的值豁免。间距**只乘 `--fs-user`**。
> 紧凑化补充：`.todo-item / .habit-item { margin-bottom: var(--sp-4) }`、`label { margin-bottom: var(--sp-2) }`。

### 5.2 Grid & Container

```css
body { max-width: 480px; margin: 0 auto; }                               /* 桌面居中呈现「手机纸面」 */
.main { padding: 10px 0 calc(80px + env(safe-area-inset-bottom)); }      /* 底部让开导航栏 */
html { overflow-x: hidden; -webkit-text-size-adjust: 100%; }             /* 横向锁滚只设在 html */
```

> ★ 横向锁滚**必须设在 `html`**：设到 `body` 会让 `body` 成为滚动容器，页面里所有 `position: sticky` 吸顶全部失效。
> `overscroll-behavior-x: none` 关掉浏览器横向手势（否则与应用内左右滑切页打架）。

### 5.3 留白哲学

**靠「间距 + 轻阴影」区分层级，不靠分割线**。同级元素 `--sp-8`，跨区块 `--sp-16 / --sp-20`；
分割线（`--hairline`）只在「同一张卡内部分行」时使用。

---

## 6. Depth & Elevation（深度与层级）

### 6.1 Shadow System（**柔光为主 + 一个硬阴影例外**）

```css
/* 柔阴影：主力（双层偏移，比单层大模糊更「实」） */
--shadow-soft:     0 1px 3px rgba(20,26,48,.07), 0 1px 2px rgba(20,26,48,.05);   /* 卡片、列表项 */
--shadow-soft-lg:  0 4px 16px rgba(20,26,48,.10), 0 2px 6px rgba(20,26,48,.06);  /* 计时圆盘、抬高件 */
--shadow-soft-xl:  0 12px 40px rgba(20,26,48,.16), 0 4px 12px rgba(20,26,48,.08);/* 弹窗、浮层 */

/* 硬阴影：仅主按钮（品牌记忆点） */
--shadow:    4px 4px 0 #2C3E50;      /* 令牌保留，实际用例已被轻盈化收敛 */
--shadow-sm: 2px 2px 0 var(--border);
--shadow-md: 3px 3px 0 var(--border);
--focus-ring: 0 0 0 3px rgba(var(--primary-rgb),.28);

/* 深色模式：柔阴影单独定义 */
body.dark-mode {
  --shadow-soft:    0 1px 3px rgba(0,0,0,.4),  0 1px 2px rgba(0,0,0,.3);
  --shadow-soft-lg: 0 4px 16px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.4);
  --shadow-soft-xl: 0 12px 40px rgba(0,0,0,.6), 0 4px 12px rgba(0,0,0,.5);
}
```
实景例外：`.shop-item.rarity-legend { box-shadow: 0 2px 12px rgba(241,199,106,.18) }`（传说品质金色柔光）。

**判断口诀**：**柔阴影＝在纸面上；硬阴影＝主按钮的品牌记忆点**。二者不可混用在同一元素。
**按压一律用「微缩 + 轻暗」**（`scale(.96)` + `brightness(.92)`），不要再用位移。

### 6.2 Surface Layers

`--surface-0`（页面底）→ `--surface-1`（卡片）→ `--surface-2`（浮起/输入）→ `--surface-3`（按压/嵌套）→ `overlay`（弹窗遮罩）

### 6.3 Z-index Scale（**实测映射，新元素必须落在已有档位**）

| z | 用途 |
|---|---|
| `0–2` | 场景装饰：树背景/光环/天气特效、时间轴当前线、转盘指针 |
| `5–12` | 计时页浮标：树旁白气泡、`timer-badge`、顶栏按钮、关闭按钮 |
| `20` | 视图内二级导航（`.stats-nav`） |
| `50` | 视图内浮层：更多菜单 `.more-menu`、日志跳日箭头 |
| `100` | **底部主导航** `.bottom-nav` |
| `150` | 引导条 `.first-guide`、自动保存提示、沉浸退出提示 |
| `200` | **弹窗遮罩** `.modal-overlay` |
| `300–301` | 吐司 `.toast-container`、倒数日浮层、皮肤拖拽面板 |
| `400` | 结算遮罩 `.settle-mask`、全局进度 |
| `500–700` | 沉浸模式 / 沉浸转场 / 微休 / 沉浸事件 / 语音行 |
| `800–999` | 里程碑、番茄掉落、焦点语录、快捷面板（局部最高 `999`） |
| `9990–99999` | **最高抢救层**：升级光效、幽灵对比、庆祝层、启动闪屏 |

> `z-index ≥ 9990` 只给「必须在任何东西之上」的瞬时全屏特效，**禁止**用于常规 UI。

### 6.4 Backdrop Effects

**不用毛玻璃**：`backdrop-filter` 在低端 Android WebView 上掉帧。
计时圆盘用**实体渐变模拟玻璃**：`--glass-hi #FFFFFF` / `--glass-mid #FFF6EE` / `--glass-lo #FBE5D6`，
配 `--shadow-soft-lg` + `timerBreathe` 呼吸动画（运行中）。

---

## 7. Do's and Don'ts（设计规范与禁忌）

### ✅ Do's

1. **一律用令牌**：颜色 / 字号 / 圆角 / 间距 / 阴影 / 动效时长 —— 硬编码会被 `build.py --lint` 逐项拦下。
2. **语义色成对使用**：`--danger-bg` + `--danger`、`--ok-bg` + `--green-dark`；不要自己拼浅色。
3. **主色底上的文字用 `--on-primary`**；黄底用 `--on-yellow` —— 它们在深色 / 主题下会自动翻转。
4. **表面用细描边(1px) + `--shadow-soft`**；浮层升级到 `--shadow-soft-xl`。
5. **只有主按钮用硬阴影**（`2px 2px 0`）；**所有按压统一 `scale(.96)` + `brightness(.92)`**，不要用 `translate`。
6. **触摸目标 ≥ `--tap-min: 34px`**；底部导航项 ≥ 44px。
7. **新增主题只覆盖令牌**；新增组件先找可复用构件（`.plan-chip` / `.log-sub-chip` / `.modal-btn`）。
8. **深色模式单独走查**：浅底品牌卡、图表色、`--primary-rgb` 是三个高发区。
9. **正文不小于 `--fs-body`（16px）；长文读写区（日记 / 复盘 / 感恩日记）取 `--fs-title`（17px）**；辅助文字用 `--text-light`（已校准 AA）。
10. **文案**：第二人称、鼓励式、说清「为什么 + 怎么办」。

### ❌ Don'ts

1. **不要写 `font-size: Npx` / `border-radius: Npx` / `padding: Npx`** —— 用 `var(--fs-*)` / `var(--radius-*)` / `var(--sp-*)`。
2. **不要给普通卡片加 3px 粗边 + 硬阴影** —— 那是上一版语言，已被「精致化」收敛；
   粗边+硬阴影**只属于主按钮**。
3. **不要给柔阴影只写一层大模糊**（如 `0 4px 12px`）—— 主力是**双层** `--shadow-soft` 系列。
4. **不要在 HTML 里写内联颜色** —— 危险/成功按钮都有唯一出口类。
5. **不要改 `--primary` 而不改 `--primary-rgb`** —— 所有 `rgba(var(--primary-rgb),…)` 会色相全错。
6. **不要新增未定义的令牌**（如随手写 `var(--radius-card-2)`）—— 未定义会让整条声明被丢弃，
   此前 `--red` 落空就是这样炸掉四象限选中态与日程当前线的。
7. **不要用 `position: fixed` 做页面内滚动容器**（本项目是固定视口 + 内部滚动区，会与 `sticky` 打架）。
8. **不要在组件里硬编码主题色系**（如 `#E85D3A`）—— 换主题就穿帮。
9. **不要用 `transition: all`** —— 写明具体属性，避免布局抖动。

---

## 8. Responsive Behavior（响应式行为）

### 8.1 Breakpoints

| 断点 | 目标 | 主要动作 |
|---|---|---|
| `≤ 330px` | 极窄（旧安卓小屏） | 压缩字号档、隐藏次要标签 |
| `≤ 340 / 345px` | 窄屏 | 网格列数 -1、表头缩写 |
| `≤ 360px` | 小屏 | `.modal-overlay padding: 20px → 10px`；`.modal padding → 14px` |
| `≤ 370 / 400px` | 常规手机 | 品牌行收缩、次要说明隐藏 |
| `720–1023px` | 平板 | 放宽列间距，内容仍居中 |
| `1024–1199px` | 桌面小 | 侧栏化布局 |
| `≥ 1200px` | 桌面 | 最大留白 |
| `@media (hover:hover) and (pointer:fine)` | 精确指针 | **启用 hover 态**（触屏不加，避免「点完一直亮」） |
| `@media (prefers-reduced-motion: reduce)` | 减少动态 | **关闭全部装饰动画**（保留状态切换） |

### 8.2 Touch Targets 与键盘

- `--tap-min: 34px` —— 所有可点元素的最小高度；底部导航项 ≥ 44px。
- 胶囊（chips）若 < 34px，需外扩可点区域（padding 或伪元素）。
- **软键盘弹出时**：`initKeyboardInset()` 用 `visualViewport` 写入 `body.kb-open` + `--kb-h`
  → 隐藏 `.bottom-nav`，避免它 `fixed` 在视口底与输入框抢位（需求原话：键盘把底部栏顶起来挡住发送按钮）。

### 8.3 折叠与重排策略

- **文字优先收缩，其次换行，最后隐藏**：`.header-brand { min-width: 0 }` + `text-overflow: ellipsis`。
- 头部居中用**左右等宽占位**（`.header-spacer`）夹住，而不是 `padding` 预留 —— 缩放档下 padding 会被内容溢出顶穿。
- **不靠媒体查询兜字号档位**（见 §3.3）。

### 8.4 Font Scaling

```
最终字号 = 设计值 × --fs-boost（抵系统缩放）× --fs-user（用户档位）
间距     = 设计值 × --fs-user
用户四档 = 1 / 1.15 / 1.3 / 1.5
```

---

## 9. Agent Prompt Guide（AI 代理提示指南）

### 9.1 Quick Reference

```
气质：克制的纸上手账 —— 米白纸底 + 细描边(1px) + 轻柔阴影；硬阴影只给主按钮
主色：#E85D3A（--primary）｜主色底文字：--on-primary（会翻转！）｜黄底：--on-yellow
正文：--text #2C3E50 ｜辅助：--text-light #5D6D7E ｜描边色源：--border #2C3E50
字号 9 档：12 / 13 / 13 / 15 / 16 / 17 / 20 / 22 / 24（micro→h1）
间距 10 档：2 4 6 8 10 12 14 16 20 24 ｜圆角：xs4 sm6 8 md12 lg16 xl24 full999
  （另有别名 --radius-card:12px（卡片）/ --radius-input:8px（输入类））
阴影：--shadow-soft（卡片）｜--shadow-soft-lg（抬高）｜--shadow-soft-xl（弹窗）｜
      .btn 专用硬阴影 2px 2px 0
动效：--dur-xs 90 / -s 150 / -m 225 / -l 375ms；--ease-out / -in-out / -spring
容器：body max-width 480px 居中；.main padding-bottom calc(80px + safe-area)
触摸目标 ≥ 34px ｜键盘弹出隐藏 .bottom-nav（body.kb-open）
主题：6 套 data-theme + body.dark-mode（只覆盖令牌，不改结构）
```

### 9.2 Component Prompts（可直接复制使用）

```
① 生成一个「番茄目标」卡片
用 .card（border 1px solid var(--border)；border-radius var(--radius-card)；
box-shadow var(--shadow-soft)；padding var(--sp-16)）。
标题 --fs-title + 700；副标题 --fs-note + var(--text-light)。
进度条底 var(--surface-3)、填充 linear-gradient(90deg, var(--primary), var(--yellow))、
圆角 var(--radius-full)。右上角一个 .btn-small（⚙️）。间距只用 --sp-*。

② 生成一个「危险操作」确认弹窗
外层 .modal-overlay + .show（display:flex；background rgba(0,0,0,.5)；z-index 200）。
内层 .modal（border 1px；border-radius var(--radius-lg)；box-shadow var(--shadow-soft-xl)；
max-width 340px；padding var(--sp-20)）。标题 .modal h3（--fs-hero，居中）。
按钮行 .modal-buttons：左「取消」.modal-btn.secondary，右「删除」.modal-btn.danger；
按压用全站统一语言 :active{transform:scale(.96);filter:brightness(.92)}。

③ 生成「今天完成」条 + 专注记录卡（两者必须是一家人）
完成条在 .done-todo-strip 内，每项用 <span class="plan-chip done">✅ 计划名</span>，
子任务用 .log-sub-chip（完成加 ✓）。
记录卡标题是任务名，下面用 <span class="plan-chip">📋 计划名</span> + 同一套 .log-sub-chip。
★ 两处必须是同一个构件，只差 ✅/📋 —— 这是需求明确提过的诉求。

④ 生成一个列表行 / 一个可点按钮
列表行：padding var(--sp-10) 0；卡内分行才用 border-bottom 1px solid var(--hairline)；
左标题 --fs-note 600，右数值 --fs-caption + var(--text-light)；按下态改底为 var(--surface-3)
（不要改文字色）；触摸高度 ≥ --tap-min(34px)。
若它本身是按钮，按全站语言加 :active{transform:scale(.96);filter:brightness(.92)}。

⑤ 给「图表」配色 / 生成一个品质商品卡
图表：折线柱状一律用功能色 --c-full(#E85D3A) / --c-half(#2E9E5B) / --c-min(#3D6FB4) /
--c-int(#8E44AD)；网格 --c-grid，轴 --c-axis。禁止直接用 --primary 画数据。
商品卡：.shop-item + 稀有度类（rarity-common/affordable/popular/premium/legend）；
radius-md；border-width 2px；box-shadow 0 2px 8px rgba(20,26,48,.06)；
hover 时 translateY(-2px) + 阴影加深；图标 52×52、--bg 底、1.5px 描边。深色下五档各有深色渐变，别漏。

⑥ 生成一个「字号大小」设置项
四档写 --fs-user：1 / 1.15 / 1.3 / 1.5，写在 <html> 的 style 上。
★ 绝对不要改 --fs-* 令牌本身，也不要整页 zoom。
```

### 9.3 Iteration Guide（迭代建议）

1. **改前先读 `src/template/10_tokens.css`** —— 90% 的需求已有现成令牌。
2. **只改 `src/`**：`index.html` 与 `src/template.html` 都是 `build.py` 产物，手改会被下一次 build 覆盖。
3. **改完必跑**：`python3 tools/build.py --lint` → `build.py` → `build.py --check`。
   lint 会逐项拦下「字号硬编码 / 圆角硬编码 / 间距硬编码 / 模板与片段漂移」。
4. **新增颜色先问能不能用语义组**（`--ok-bg` / `--danger-bg` / `--warn-bg` / `--info-bg` / `--accent-bg`）；
   确实需要新色再入令牌表，并**同步深色映射**。
5. **改主色必须同时改 `--primary-rgb`**。
6. **注意「基础层 vs 覆盖层」**：CSS 片段按 `_order.json` 顺序拼装，**后者覆盖前者**。
   实际顺序是 `12_components.css`（基础值）→ … → `1A_dark_misc.css`（精致化视觉系统 + 互动增强）→ `50_journey.css`（最后）。
   所以 `12_components.css` 里写的 `3px 边 / translate 按压` **都不是最终值**。
   改样式前先 grep 组件名，确认哪条真正生效 —— 只看基础层一定会改错。
7. **深色模式走查一遍**；**六套主题各走一遍**（`default / nord / tokyo / gruvbox / rosepine / catppuccin`）。
8. **过渡不要 `transition: all`**，写明属性。
9. **装饰动画必须在 `prefers-reduced-motion: reduce` 下关闭**。
10. **文案风格**：第二人称、鼓励式、具体动作；错误提示说清原因与下一步。
