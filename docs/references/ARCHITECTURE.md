# 🏗 ARCHITECTURE.md · 番茄专注架构总览

> 生成：2026-09-06（A9-3）｜ 扩写：2026-10-05（W6-1 并入五层结构 / 加载顺序 / 5 个坑 / 验证命令）。
> 目标：**只读本文档 + src 代码，15 分钟内讲清架构**（评审第一站）。
> 代码事实以 `src/` 为唯一真源；文档若与代码冲突，以代码为准并顺手修本文档。
> 配套：`python3 tools/dep_report.py --map <关键词>`（逐函数定位）· `docs/current/AI_SCAFFOLD.md`（新增功能模板）· `AGENTS.md`（硬约束）。
> **本文档是架构唯一入口**（根目录同名文件已删除，勿再新建平行副本）。

---

## 1. 依赖方向图（单向，违例=lint 红）

```
                    ┌─────────────────────────────────────────────┐
   用户交互/事件      │  02~08 增强注入层（整段可回退，只许包装/调用 01 对外白名单）│
   （onclick/DOM）   │  02 自律增强 03 性能打磨 04 统计缓存 05 journey     │
        │           │  06 错误监控 07 折叠记忆 08 组件注册表               │
        ▼           └──────────────┬──────────────────────────────┘
┌──────────────────────────────────▼───────────────────────────────┐
│  01a~01g 核心引擎（事件处理 + 业务 + UI 渲染 + boot 编排）            │
│  01a prelude → 01b data → 01c timer → 01d features → 01e ui       │
│  → 01f immersive → 01g init（boot：loadData → 全量渲染 → __bootDone）│
└──────────────────────────────────┬───────────────────────────────┘
        │                          │ 只调用纯函数
        ▼                          ▼
┌──────────────────┐     ┌─────────────────────────────────────────┐
│ 00 纯函数孤岛      │     │ 持久化双源：localStorage + IndexedDB     │
│ （禁碰 DOM/存储）  │     │ 主键 tomato_focus_v3 · AUTO_BACKUP ·      │
└──────────────────┘     │ AR_KEY · IMPORTED_SCRIPTS · uiPrefs 单通道 │
                          └─────────────────────────────────────────┘
```

- **依赖方向唯一为 `00 ← 01 系 ← 02~08`**：01 系禁止调用 02~08（反向=红）；02~08 只能调用各 01 文件头契约注释的对外白名单。
- 构建合成：`tools/build.py` 按 `manifest.json` 的 9 槽/15 文件顺序把 `src/template.html` + `src/scripts/*.js` 合成**单文件** `index.html`（交付形态，禁止手改）。

## 2. 模块职责表（15 文件 × 一句话 × 对外入口）

| 文件 | 一句话职责 | 对外白名单入口 |
|---|---|---|
| `00_pure_core.js` | 纯函数孤岛：日期/折算/格式化/常量（Node 可测，unit 21） | `getTodayStr/getDateStr/calcPomos/getPomos/fmtTomatoNum/DAY_MS/…` |
| `01a_engine_prelude.js` | 全局基础：共用小工具/常量/定时器门控 `__ivGov` | 基础工具函数 |
| `01b_engine_data.js` | 数据层：`loadData`/`saveData(Now)` 双写、默认结构、迁移链、导出导入/清空/备份 | `loadData/saveData/saveDataNow/exportData/importData/clearAllData/validateBackup` |
| `01c_engine_timer.js` | 计时引擎：番茄/自由专注/打断/休息/结算窗（finishModal） | `startPomodoro/finishPomodoro/interruptPomodoro/resetToIdle/startBreak` |
| `01d_engine_features.js` | 业务中枢：`savePomodoroRecord` 结算、段位/成就/树/组队/必做/日志 | `savePomodoroRecord/addTreePoints/checkNewAchievements/toggleMustDo/…` |
| `01e_engine_ui.js` | 界面渲染：`switchView`、renderTodos/Logs/Stats/YearHeatmap/Shop/Team/Poster、escapeHtml | `switchView/escapeHtml/renderTodos/renderStats/renderLogs/…` |
| `01f_engine_immersive.js` | 沉浸式专注：剧本生成/章节推进/沉浸结算/背景音 | `immersiveOnTomatoSettled/…`（经 01c/01d 结算链调用） |
| `01g_engine_init.js` | boot 编排：init()=loadData→全量渲染→新手指引→`__bootDone`；启动画面/关怀弹窗 | boot 主流程（内部） |
| `02_enh571_自律增强.js` | 增强①：沉浸音频/自定义音频/统计卡注入/定点休息提醒（`__enh`） | 注入+包装点（整段可回退） |
| `03_enh572_性能打磨.js` | 增强②：自动深色/每日目标/常亮/CSV 导出/快捷键 | 同上 |
| `04_enh573_统计缓存.js` | 增强③：`__enh*` 统计缓存 + 空闲预热（`invalidateStatsCache` 包装） | 同上 |
| `05_journey_渐进解锁.js` | 成长之旅：STEPS 解锁表 + 闸口包装 8 个推进函数 + 归档 + 公告（`__jy`） | `__jy.ensure/unlocked/…`（闸口包装点见 §4） |
| `06_errRep_错误监控.js` | M1 运行时监控：window error/unhandledrejection 捕获 + 角标 + 现场导出（`__errRep`） | `__errRep.warn/list/silent` |
| `07_uiFold_折叠记忆.js` | 折叠记忆 + 极简联动（`__uiFold`）：点标题收展 + 手动偏好（存 `appData.uiPrefs.foldPrefs`） | `__uiFold.register/toggle/sync/state/remove` |
| `08_component_registry.js` | 组件注册表（`registerComponent`/`__comp`）：样式/挂载/极简隐藏/折叠收编/卸载 | `window.registerComponent/__comp.list/deregister` |

## 3. 数据流（用户操作 → 落盘 → 渲染）

```
点「开始」(btnStart)
   → toggleTimer → showCountdown321 → startPomodoro → timerState{mode:focus,running}
   → startTimerLoop 每秒按 endAt 校准 remaining
到点 → onTimerComplete → pendingFinish 落盘(防关页丢) → showFinishModal('natural')
确认结算 → confirmFinish → savePomodoroRecord(type)          ← 结算中枢(01d)
   ├─ 折算 pomos(calcPomos) → records.push(record)
   ├─ round.full/half 累计 → addTreePoints(树/金币) → journey 闸口 → 段位/成就/组队…(各副作用独立 try)
   ├─ 期间 toast 收进 _settleMsgs（不逐个蹦）；_settleDeadlineTimer=3.5s 兜底
   └─ saveData()（300ms 防抖，localStorage+IDB 双写同一 payload）
        → flushSettleSummary：合并 _settleMsgs → showSettleSummary(#settleMask 结算卡)
300ms 后 → startBreak('short')（自然完成自动短休）
渲染侧：任何 render*(renderTodos/renderStats/…) 都从 appData 读 → 拼 innerHTML/节点级更新
```

- **数据单真相**：`appData` 树（内存）↔ 双源持久化（IDB 主存 + localStorage 镜像，带时间戳取新）。R-W1-1 后设备 UI 态一律进 `appData.uiPrefs`，**无第二个 localStorage 副键**。
- **变更收口**：`saveData(Now)` 是唯一写通道；导出 `exportData` 覆盖全部业务子树；清空/导入走「自动备份 → 双源覆盖 → reload」。
- **渲染链路**：`renderTodos/renderLogs/renderStats` 共享脏签名短路；`updateTodoStats/updateRoundStats/updateTodayStats` 刷头部热区数字（fxVal 同值不弹）。

## 4. 增强注入点清单（02~08 各包装/接管了谁，为什么可整段回退）

| 模块 | 包装/接管点 | 回退方式 |
|---|---|---|
| 02 | 音频播放 `playSound` 族、统计卡注入、定点提醒定时器 | 删除该 `<script>` 槽即还原；整段 IIFE |
| 03 | 自动深色 `_applyAutoDark`/媒体查询、每日目标、常亮 `requestWakeLock`、CSV、快捷键 | 同上 |
| 04 | `invalidateStatsCache` 包装（getStatsCache 写后置脏）、空闲预热 | 同上 |
| 05 | **闸口包装 8 个推进函数**：`addTreePoints/onPomodoroCompleteRank/claimMustDoReward/showGift/checkNewAchievements/…`（未解锁一律不推进）+ `afterSettle` 解锁卡 + 定期归档 + 跨标签同步 | 删除槽还原（闸口失效=全放行） |
| 06 | window `error`/`unhandledrejection` 捕获、角标/面板、错误现场导出；`__silent` 钩子供 01 系静默上报 | 删除槽还原（01 系调用点带 `if (window.__silent)` 守卫） |
| 07 | 包装 `applyMinimalMode`（极简联动）+ MutationObserver 兜底；`__uiFold.register` 供 08 折叠收编 | 删除槽还原（只加 class/CSS 不搬 DOM） |
| 08 | 提供统一组件入口；`deregister` 清理 DOM/样式/折叠登记/偏好 | 删除槽还原 |

## 5. 红线索引（引用不复制，完整规则看 AGENTS.md）

1. **只动 `src/`**：index.html 是产物，改 src 后 `python3 tools/build.py` 生成。
2. **00 纯函数孤岛**：不碰 DOM/appData/存储（`--lint` 守卫拦截）。
3. **01c 计时红线**：计时进行中不塞打扰 UI；跨天/回拨只许小步修+回归；结算窗 `finishSource==='natural'` 不可取消。
4. **POMO 基准口径**：25 分钟=1🍅，折算只经 `00_pure_core.calcPomos`，禁止别处复制第二份。
5. **等价验证**：结构改动拆前/拆后 `dep_report.py` 对比 + `rs_capture.py` 渲染逐字节；每批 R- 段头 + 独立 commit；失败 `git reset --hard` 回退。
6. **禁止反向依赖**：01 系不调 02~08；02~08 只走各文件头对外白名单。
7. **禁止复制同名实现**：历史 updateTitle×2 / 热力图×2 教训；`grep` 先查重。
8. **新玩法默认开新文件**（AGENTS §1.5），禁止塞进 01e/01d 大文件当"加段"。

## 6. 工程命令速查（详见 AGENTS A9-2 命令表）

| 目的 | 命令 |
|---|---|
| 一键全绿链（含 E2E，拆结构前后必跑） | `python3 tools/verify.py --e2e` |
| 快档（pre-commit 用） | `python3 tools/verify.py --fast` |
| 改前影响面 / 函数定位 | `python3 tools/dep_report.py --impact <fn>` / `--map <kw>` |
| 依赖基线刷新 | `python3 tools/dep_report.py --md` |
| DOM id 对账 | `python3 tools/id_audit.py` |
| 渲染等价采集 | `python3 tools/rs_capture.py` |

---

## 7. 五层结构（谁可以依赖谁 · W6-0 层依赖 lint 实测口径）

> §1 的依赖方向图是**符号级**（00 ← 01 ← 02~08）；本节是 **lint 强制执行的五层口径**，两者一致。
> 实测工具：`python3 tools/w6_layer.py`（已挂快链）；当前 **硬违例 0**、软依赖 2 条（刻意的防御式调用）。

| 层 | 名称 | 槽位 | 内容 | 允许依赖 |
|---|---|---|---|---|
| **L0** | 纯函数 | 9 | `00_pure_core.js` | 无（不碰 DOM/appData/存储，`--lint` 守卫拦截） |
| **L1** | 核心引擎 | 1 | `01a`~`01g`（含 `01d2` / `01e2`~`01e8` 同槽子文件） | L0 |
| **L2** | 增强模块 | 2–5 | `02` 自律增强 / `03` 性能打磨 / `04` 统计缓存 / `05` journey | L0、L1（只走各文件头对外白名单） |
| **L3** | 横切关注 | 6–8 | `06` 错误监控 / `07` 折叠记忆 / `08` 组件注册表 | L0、L1 |
| **L4** | 胶水/注入 | 8 | 槽 8 里的 W3–W6 注入脚本（`09`/`0A`/`0B`/`0C`/`0D` 等） | 全部上层 |

**规则怎么强制执行**：`w6_layer.py` 解析每个文件实际调用的外部函数名，反查归属层。**下层反向依赖上层 = 硬违例 = FAIL**（如 01 系调用 02~08 的函数）。软依赖（`typeof window.rsConfirm === 'function'` / `window.store &&`）是**刻意的防御式调用**，只告警不阻断——老浏览器/隐私模式下模块可能缺失，这类守卫是正确写法。

## 8. 加载顺序（决定了为什么不能随便加依赖）

`manifest.json` 的槽号 = **执行顺序**，`build.py` 按此把 `src/template.html` + `src/scripts/*.js` 拼成单文件 `index.html`：

```
槽9 00_pure_core.js        ← 最先（被所有人调用）
     ↓
槽1 01a → 01b → 01c → 01d → 01e → 01f → 01g   （引擎主链，槽内 files[] 顺序 = 执行顺序）
     ↓
槽2~5 02 → 03 → 04 → 05     （增强层，启动时包装 01 系白名单函数）
     ↓
槽6~8 06 / 07 / 08 + W3~W6 注入脚本（L3 横切 + L4 胶水，最后挂载）
```

**推论**：① 槽号小的先执行，所以 L1 不可能"调用"L2 的函数——那时它们还不存在（这正是层依赖 lint 的物理根因）；② 同槽内 `files[]` 数组顺序即执行顺序，改动数组顺序 = 改执行时序，必须回归；③ 新增文件要同时动 `template.html` 标记 + `manifest.json`，`--lint` 校验三者一致。

## 9. 几个容易踩的坑（都踩过，记录在此）

### 9.1 具名函数表达式陷阱

`(function foo(){ setTimeout(foo, 800) })()` —— `foo` **只在函数自身作用域内可见**，外部 `setTimeout(hookToast, ...)` 会抛 `ReferenceError`，且**静默中断其后全部语句**，表象是"脚本加载成功"实为半瘫痪。改为**函数声明** + 顶层占位兜底。（W3-5 真实事故）

### 9.2 `appendChild` 已挂载节点 = 移动 + 失焦

对已在 DOM 中的节点无条件 `parent.appendChild(node)` 会**移动**它，触发 `blur()` —— 输入框行级复用时会丢焦点。必须仅在位置不符时用 `insertBefore`。（W5-1 行级渲染提速 87.6% 时踩到）

### 9.3 无头浏览器的 500px 最小宽度

headless Chromium 窗口宽度最小 500px，直接设 320 档会**假绿**（实际按 500px 渲染）。必须走 CDP `Emulation.setDeviceMetricsOverride` + **回读 `innerWidth` 断言**确认生效。（W3-1 视口走查踩到）

### 9.4 `Page.navigate` 会销毁 JS 执行上下文

CDP 里 `Page.navigate` 之后，之前的 `Runtime.evaluate` 全部超时——必须**重新发一次 `Runtime.enable`**。（`bench.py` 历史缺陷，导致测的是空白页，历史性能数据全假）

### 9.5 默认值不能写进用户偏好

"系统默认收起"若写成 `appData.uiPrefs.foldPrefs` 的落盘值，会**吞掉用户的手动展开偏好**（展开→刷新→又收起）。正确做法：只登记标记、绝不落盘，由渲染时读默认值决定。（W3-2 踩到，已加 C21b 守护用例锁死）

## 10. 怎么验证（改完必跑）

```bash
python3 tools/verify.py --e2e    # 全绿链 9 段，改结构/UI 后必跑
python3 tools/verify.py --fast   # 快档 7 段，改前自检 / pre-commit 兜底
```

全绿链段落：`lint` → `build` → `check` → **`layer`** → **`toc`** → **`size`** → `unit(21)` → `e2e(67)` → `smoke(94)`。

> ⚠️ **血泪教训**：批量改注释是高危操作。删一行「回退：…」注释可能连带删掉注释块的 `*/` → 注释永不闭合 → **后续代码被整个吸进注释 → 语法崩溃**；而**旧 lint 只查结构不查语法，快链会全绿而 e2e 大面积挂**。现已补 `build.py --lint` 逐文件 `node --check`（W6-3 事故后增设）。

### 专项工具（按需单独跑）

| 工具 | 何时跑 |
|---|---|
| `tools/w6_layer.py` | 改任何跨文件调用后（已挂链） |
| `tools/w6_toc.py --check` | 增删顶层函数后（已挂链） |
| `tools/w6_size.py` | 往大文件（尤其 01d/01e）加代码后（已挂链；>6000 行 FAIL、>5800 行 WARN） |
| `tools/w6_deadcode.py` | 重构删功能后（删前仍须人工确认） |
| `tools/rs_viewport.py` | 改布局/CSS/响应式后（5 档×5 视图） |
| `tools/innerhtml_scan.py --audit` | 新增含用户数据的模板拼接后 |
| `tools/rs_capture.py` / `rs_facade.py` | 拆分前后等价 / 改门面样式后 |
| `tools/bench.py` / `session_audit.py` | 改首屏热路径 / 定时器/监听器后 |

## 11. 当前架构健康度（实测快照 · 2026-10-05）

| 指标 | 实测值 |
|---|---|
| 源文件 / 槽位 | 28 个脚本 / 9 槽 |
| 最大源文件 | 5,959 行（01d，**距 6000 红线仅剩 41 行** → `w6_size.py` 报 WARN） |
| 层依赖硬违例 | **0**（软依赖 2 条，均为刻意防御式调用） |
| 全仓 `var` | **0** |
| 顶层函数 / 跨文件调用边 | ≈1109 / ≈2454 |
| 窗口暴露白名单 | 239 项（`src/window_whitelist.json`，2026-10-06 W6-11 据实刷新） |
| 全绿链 | 9 段通过（含 `size`） |
| 单文件产物 | `index.html` 1,993,790 字节（≈1.99MB） |
| 冷启 / 统计页 8000 条 | 201ms / 642ms |
