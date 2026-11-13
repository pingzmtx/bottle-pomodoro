# 🧱 AI_SCAFFOLD · 新增功能 6 步填空模板（W6.5-3 / A9-1）

> 生成：2026-09-06 ｜ 用途：**AI 照模板填空就能完成"加一个功能"，不用问"数据放哪 / 函数挂哪 / 要登记哪些联动"**。
> 配套工具：改前 `python3 tools/dep_report.py --impact <fn>` 查影响面；定位用 `--map <关键词>`；改后全绿链 `python3 tools/verify.py --e2e`。
> 裁决总纲：v3「序」三条判据（可删性 / 变更成本 / 单点真相）；**加 abstraction 之前先找 duplication**。
> 本文档只讲"怎么落地"，规则源头见 `AGENTS.md`（硬约束）与 `docs/references/ARCHITECTURE.md`（架构总览）。

---

## 0. 开工前 3 问（决定放哪，别急着写）

| 问 | 是 → 去 |
|---|---|
| 这是「改旧」还是「加新」？ | 加新玩法/页面块/独立功能 = **默认新建文件** `NN_主题.js`（AGENTS §1.5）；修 bug/小改 = 进该功能既有模块 |
| 数据是「内容」还是「设备 UI 态」？ | UI 态（折叠/引导/开关/最近记录/歌单等）→ **`appData.uiPrefs.*`**（R-W1-1 已收编散键，禁止再造 localStorage 副键）；内容 → 所属业务字段（默认值进 `createDefaultAppData()`） |
| 是不是「第二份真相」？ | 是 → **删副本**，不包一层（v3：单点真相，双写是脏的根源） |

> 若答案是"已有相同能力/函数"→ 先复用：`grep -rn` 同名、`dep_report.py --map` 关键词。

---

## 1. 数据字段（单点真相 + 默认值）

**业务数据** → `src/scripts/01b_engine_data.js` `createDefaultAppData()` 内补默认字段：

```js
myNewFeature: { enabled: false, lastDate: null },   // 跟随主存储/IDB 双写、导出、清空、迁移
```

**设备 UI 态** → 放进 `uiPrefs`（已有子树，R-W1-1 后单通道）：

```js
uiPrefs: {
  ...,
  myNewPref: false   /* 你的新偏好，曾用 localStorage 副键 → 禁止 */
}
```

> 老档兼容：`loadData()` 的字段级兜底区（`if (!appData.xxx) appData.xxx = ...`）按需补一行；**不需要** bump DATA_VERSION（defaults 兜底足够）。导出/导入的字段清单在 `exportData()` 里按需登记。

## 2. render（渲染函数放哪）

| 内容 | 放哪 |
|---|---|
| 纯函数/计算（日期、折算、格式化） | `00_pure_core.js` + `tools/tests/unit_pure.js` 补用例（lint 守卫拦非纯函数） |
| 新玩法渲染 | **新文件** `NN_主题.js` → `template.html` 插 `<!--@@__JSS_N__@@-->` → `manifest.json` slots 追加 → `build.py --lint` 校验三者一致 |
| 小改既有 UI | 该功能所属模块内就近的 `renderXxx()` |

**渲染铁律**：用户文本一律 `escapeHtml()`；拼 HTML 用模板字符串/字符串拼接；写完检查是否有未转义注入点（W3-6 清单口径）。

## 3. 挂载（让用户看得见）

- 静态宿主：直接给 `template.html` 对应 `.view` 里加容器 `<div id="xxxBox"></div>`（静态模板里 id 随便起，构建不动它）。
- 动态视图：`switchView('timer'|'plan'|'log'|'stats'|'settings')` 是底部 5 视图唯一入口；**新玩法页面默认加进既有视图的子 tab/区块，不新增底部 tab**（底部导航是产品固定 5 项）。
- 若容器在 boot 后才出现 → `registerComponent` 的 `host` 传函数/选择器由框架兜底重试；否则沿用 `renderXxx()` + 在 `01g_engine_init.js` boot 渲染段调用。

## 4. 持久化（单通道）

```js
appData.myNewFeature = { enabled: true };   // 改内存
saveData();        // 300ms 防抖，批量改动用
saveDataNow();     // 立即落盘（低频、点完即关场景：开关/折叠/引导等）
```

> 红线：**不加新 localStorage 键**（设备态进 `uiPrefs`）；不要自己写第二份"直写小存储"。

## 5. 联动登记（registerComponent 声明式——替代手工黑名单）

新 UI 组件建议直接走组件注册表（`08_component_registry.js`），一份声明自动获得：样式注入 / 幂等挂载 / 极简隐藏 / 折叠记忆 / 卸载清理：

```js
window.registerComponent({
  name: 'my_new_comp',                     // 唯一、见名知意
  styleText: '.my-new-comp{...}',          // 组件自带样式（框架统一注入 #__compCss）
  host: function () { return document.getElementById('view-timer'); },  // 选择器|元素|()=>元素
  mount: function (hst) {                  // 幂等挂载：重复调用不产生第二个
    if (document.getElementById('myNewBox')) return document.getElementById('myNewBox');
    var box = document.createElement('div');
    box.id = 'myNewBox';
    box.innerHTML = '...' + escapeHtml(appData.myNewFeature.enabled ? '开' : '关');
    hst.appendChild(box);
    return box;
  },
  minimalHide: true,                       // 极简模式自动隐藏
  foldBox: { key: 'my_new_fold', title: '#myNewBox .state-section-title' }  // 可选：折叠记忆
});
```

> 禁止：手写"极简 CSS 黑名单"或自研折叠（07/08 已收编）；组件样式写进 template 大样式区再手动同步极简规则。
> `name` 变更注意：`__comp.deregister(name)` 会清理 DOM/样式/折叠登记/偏好（C22 回归覆盖）。

## 6. 验证链（收尾门槛，少一道不算完）

```bash
python3 tools/verify.py --e2e    # lint → build → check → unit 21 → e2e 60 → smoke 92
python3 tools/dep_report.py      # 对比基线：被依赖 Top / 总调用边 不显著推高
python3 tools/id_audit.py        # 新 DOM id 有出处
git status --short               # 干净后：R-段头注释 + 独立 commit（pre-commit 自动兜底快档）
```

- 源码改动带 `/* ===== R-<批名>（可回退）===== */` 段头，独立 commit，可单批 `git reset --hard` 回退。
- 动了行为 → 给用户「人话版改动说明」：改哪个文件 / 改了什么 / 打开能感觉到啥 / 跑过哪些验证。

---

## 推荐写法 / 禁止写法（示例）

| | ✅ 推荐 | ⛔ 禁止 |
|---|---|---|
| 新全局函数 | 先 `grep -rn` 查重；新玩法函数进新文件 | 直接往 01e（1.4w 行）里塞新功能"加段" |
| 用户文本 | `escapeHtml(str)` 后再进 innerHTML | 直接把 input 内容拼进 HTML |
| 纯逻辑 | 进 `00_pure_core.js` 并补 unit 用例 | 在渲染函数里复制一份日期/折算逻辑 |
| 数据持久化 | appData + saveData(/Now) | 新造 `localStorage` 副键 |
| 联动登记 | `registerComponent` 声明式 | 手写极简黑名单 / 自研折叠 |
| 错误处理 | 数据层危险操作留 confirm 兜底；异常接 `__errRep`/`__silent` | 空 `catch(e){}` 裸奔吞异常 |
| 老浏览器 | 低 ES6（项目存量已用 let/const + 模板字符串，别新增 ES6+ API / CSS inset） | 引入 `?.` / class 字段 / `replaceAll` 等新语法 |
| 验收 | `verify.py --e2e` 一条链 | 只改代码不跑回归就交付 |

---

## 核对清单（交付前 30 秒自查）

- [ ] 数据放进了 appData 正确子树（内容 / uiPrefs），没造 localStorage 键
- [ ] 新文件已登记（template slot + manifest）或确认放进了正确模块
- [ ] 渲染的每条用户文本都过了 escapeHtml
- [ ] 组件联动走 registerComponent（或说明为何不能走）
- [ ] 改动带 R- 段头，`verify.py --e2e` 全绿，独立 commit
