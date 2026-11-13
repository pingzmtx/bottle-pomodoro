# 文档索引（公开仓库内的工程文档）

本目录只放**改代码时真正需要**的文档：架构、规范、数据层、设计、部署。
内部方案讨论、路线图、审计报告、历史设计稿不在这里（留在项目所有者本地）。

## 先读这两份

| 文档 | 讲什么 |
|---|---|
| [`WORKBUDDY.md`](../WORKBUDDY.md) | **协作流程**：谁能改哪、怎么上线、什么必须走 PR |
| [`AGENTS.md`](../AGENTS.md) | **技术宪法**：代码怎么组织、哪些坑不能踩 |

## 动代码前按需查

| 文档 | 什么时候看 |
|---|---|
| [`references/ARCHITECTURE.md`](references/ARCHITECTURE.md) | 想知道模块怎么分层、脚本怎么加载、数据怎么流动 |
| [`current/数据领域地图与扩展指南-20261014.md`](current/数据领域地图与扩展指南-20261014.md) | **要动数据结构 / 加版本迁移**（必看，碰错会毁用户数据） |
| [`current/AI_SCAFFOLD.md`](current/AI_SCAFFOLD.md) | 要加一个新功能模块，按它的六步走 |
| [`references/协作代码规范.md`](references/协作代码规范.md) | 写代码前对一下命名、分层、注释约定 |
| [`references/设计令牌.md`](references/设计令牌.md) | 要改配色、间距、圆角、字号 |
| [`references/视觉质感.md`](references/视觉质感.md) | 要调动画、光影、材质 |
| [`DESIGN.md`](DESIGN.md) | 设计系统总纲（比设计令牌更完整） |
| [`architecture-decisions.md`](architecture-decisions.md) | 想推翻现有做法前，先看这条决定当初为什么这么定 |
| [`部署说明.md`](部署说明.md) | 搞不清「构建产物怎么变成线上页面」时看 |
| [`项目现状交底.md`](项目现状交底.md) | 全面了解现状，尤其**哪些地方碰了会出事**（注意数字是 10-07 快照） |
| [`FACTS.md`](FACTS.md) | 一行一条的硬事实（路径、端口、命令） |
| [`ci-pipeline.yml`](ci-pipeline.yml) | 可选：装上 GitHub Actions 自动跑门禁 |

## 怎么跑

见仓库根的 [`如何构建与验证.md`](../如何构建与验证.md)，最短路径：

```bash
python3 tools/build.py
python3 tools/verify.py --fast
```

上线（构建 → 门禁 → 提交 → 推送，任一步失败就停）：

```bash
sh 上线.sh "feat(范围): 一句话"
```
