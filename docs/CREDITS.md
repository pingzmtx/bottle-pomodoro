# 来源与许可

本项目的自有代码以 [MIT 协议](LICENSE) 发布。以下列出它用到的第三方字体、参考过的开源项目，
以及构建期使用的工具，按与产物关系的远近分组。

> 约定：**「参考」= 读过源码或文档、学习其设计思路，本项目不含其源代码**。
> 凡属于此类的条目都在表内注明协议，便于日后核对边界。

---

## 1. 随产物分发的字体（需要保留许可文本）

三款字体均以 **SIL Open Font License 1.1** 授权，已做子集裁剪、转 woff2 后随 `public/fonts/`
一起分发。完整许可分别见：

| 字体 | 上游 | 协议 | 许可文件 | 用在哪 |
|---|---|---|---|---|
| 霞鹜文楷 LXGW WenKai | https://github.com/lxgw/LxgwWenKai | SIL OFL 1.1 | `fonts/LXGW-WenKai-OFL.txt` | 正文、日记、计划主体（`wenkai-regular/extra.woff2`） |
| 得意黑 Smiley Sans | https://github.com/atelier-anchor/smiley-sans | SIL OFL 1.1 | `fonts/Smiley-Sans-OFL.txt` | 标题字（`smiley-title.woff2`） |
| Inter | https://github.com/rsms/inter | SIL OFL 1.1 | `fonts/Inter-OFL.txt` | 拉丁字母与数字（`inter-latin.woff2`） |

裁剪与拆分脚本见 `tools/fonts/build_fonts.py`。OFL 允许修改与再分发（含子集化），
条件是保留版权声明与本许可文本、且不得单独售卖字体本身——因此许可文件必须与字体放在一起。

---

## 2. 参考过的开源项目（不含其源代码）

| 项目 | 协议 | 借鉴的部分 | 本项目对应 |
|---|---|---|---|
| [Super Productivity](https://github.com/super-productivity/super-productivity) | MIT | 单一真相源、派生数据现算、纯函数层与副作用分离、分层门禁用工具守 | `00_pure_core.js`、`tools/verify.py` 的 layer 段 |
| [HabitTrove](https://github.com/dohsimpson/HabitTrove) | AGPL-3.0 | 货币模型 = 余额 + 流水（`{ balance, transactions[] }`），面板只读账本 | 金币账本 `01d_engine_features.js`、`tools/check_coin_single_source.py` |
| [yuvomi](https://github.com/ulsklyc/yuvomi) | MIT | 月/周/日/议程四视图的形态与移动端降级节奏 | 计划页月视图形态 |
| [weektodo](https://github.com/manuelernestog/weektodo) | GPL-3.0 | 横向日期条 + 按天归属的任务组织方式、重复事件按天记账去重 | 计划页周条、重复规则去重思路 |
| [vikunja](https://github.com/go-vikunja/vikunja) | AGPL-3.0 | 月网格恒 42 格（6×7）以保证换月不跳高；重复规则字段设计 | 月历网格、`todoRepeat*` 字段 |

**协议边界说明**：上表后三个项目为 GPL-3.0 / AGPL-3.0。本项目**只阅读其源码学习设计与形态，
未复制、未改编其任何代码**，因此不构成衍生作品；自有的重复规则、周条、月网格均为独立实现。
若日后要从这些项目搬运代码，必须先确认许可证兼容性（AGPL 与本项目的 MIT 不兼容）。

---

## 3. 界面素材与视觉技法

| 来源 | 性质 | 借鉴的部分 |
|---|---|---|
| [Uiverse.io](https://uiverse.io) | 社区组件库，各片段协议不一，**未纳入任何代码** | 玻璃卡片、进度条流光的视觉技法 |
| [Aceternity UI](https://ui.aceternity.com) | 商业组件站，**未纳入任何代码** | 环境光背景、入场编排的视觉技法 |

这两处只借鉴「看起来是什么样」，颜色、尺寸、动画曲线均按本项目令牌重写，见 `docs/current/UI改造记录.md`。

---

## 4. 构建期工具（不进入产物）

以下仅在 `tools/` 里使用，`public/` 中不含其代码：

| 工具 | 协议 | 用途 |
|---|---|---|
| [acorn](https://github.com/acornjs/acorn) | MIT | 语法解析（`tools/gen_bridge.js`、分层检查） |
| [pako](https://github.com/nodeca/pako) | MIT | 合成器压缩 |
| [jszip](https://github.com/Stuk/jszip) | MIT 或 GPL-3.0 双许可（取 MIT） | 合成器打包 |

---

*若发现遗漏的项目或协议错误，欢迎提 Issue 指出。*
