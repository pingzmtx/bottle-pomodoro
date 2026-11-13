# Workbuddy 协作协议（单仓库版 · 2026-11-11 起）

> 仓库就是唯一的真相。你在仓库里改完推上去，线上 1 分钟内自己更新。
> 不需要打包、不需要回传、不需要人工转手。

## 0. 一句话

```sh
git clone https://github.com/pingzmtx/bottle-pomodoro.git
cd bottle-pomodoro
# 改 src/ …
sh 上线.sh "feat(plan): 你要做的事一句话"
```

`上线.sh` 固定四步：**构建 → 门禁 → 提交 → 推送**。
任何一步挂掉就停在那里，不会把半成品推上线。

> 这个仓库是**公开**的，所以线上 JS 是压缩产物，但 `src/` 是可读源码——不用刻意折腾混淆，
> 但**不要把内部方案文档、商业策略、用户数据往这里放**。

## 1. 仓库长什么样

```
bottle-pomodoro/
├── src/              真源：JS 模块 + 模板片段 ← 你改这里
├── tools/            build.py（构建）、verify.py（28 项门禁）、用例
├── web/              构建所需的静态素材（manifest 等），**别删**
├── public/           构建中间产物（已 gitignore，不要提交）
├── index.html assets/ icons/ fonts/ config.js sw.js manifest.webmanifest
│                     ← 根目录这层是发布产物，GitHub Pages 原样发布它，**永远不要手改**
└── 上线.sh           一键上线
```

- 线上 = `main` 分支根目录，**push 即上线**（Pages 约 45~60 秒重建）
- 根目录产物由 `tools/build.py` 生成，改 `src/` 才是改代码
- 文档：`AGENTS.md`（技术宪法）、`如何构建与验证.md`、`发版前点这10下.md`

## 2. 什么时候直推，什么时候必须开 PR

| 改了什么 | 怎么做 |
|---|---|
| 文案、配色、间距、单个交互、样式微调 | 直接 `sh 上线.sh "…"` |
| 新增功能（只动 `src/scripts/`、`src/template/`） | 直接上，提交信息写清范围 |
| **数据层 / 版本迁移**（`01b_engine_data.js`、`01a*`、存储结构、导入导出） | **必须开 PR**：`git checkout -b wb-xxx && … && git push -u origin wb-xxx` |
| **构建器 / 门禁**（`tools/build.py`、`tools/verify.py`、`src/manifest.json`） | **必须开 PR** |
| `web/`、`LICENSE`、`.github/`、依赖 | 先问，不要自己动 |

PR 描述写：**改了什么 / 为什么 / 跑了哪两条命令 / 改前改后的数字**。人工过一遍再合，合入后再跑一次 `上线.sh`。

> 为什么数据层要这么小心：用户的打卡记录、成长点、树的状态都存在本地浏览器里，
> 一次错误的迁移会让他们**永久丢数据且无法找回**。这是这个项目唯一不可逆的地方。

## 3. 三条硬规矩

1. **门禁不过不许推**。必须是 `✅ 通过，可以发 28 通过 · 1 跳过（smoke） · 1 未运行（e2e）`。
   `smoke/e2e` 要真 Chrome，跑不了就在交付说明里**明说跳过了**，不能写成「通过」。
2. **不许手改根目录产物**。改了会被下一次构建冲掉，而且线上会短暂不一致。
3. **不许为了「让门禁变绿」去改门禁用例**，那是删警报器。

## 4. 提交信息

`<类型>(<范围>): <一句话>`

- 类型：`feat` / `fix` / `style` / `perf` / `refactor` / `test` / `docs` / `chore`
- 范围：`plan` `log` `stats` `habit` `settings` `pomo` `tree` `build` …
- 例：`fix(habit): 间隔式打卡不再按锚点网格判该做日`

一次提交只做一件事。改视觉的提交必须带**改前/改后实测数字**（字重分布、边框计数、某处 computed style），拿不出数字就等于没验证。

## 5. 凭据

推送需要一个有 `repo`（Contents: Read and write）权限的 GitHub token。

**注意**：当前发放的 token **没有 `workflow` 权限**，所以：

- 你**不能**推送 `.github/workflows/` 下的任何改动（GitHub 会返回一个**伪装的 404**，看着像"对象不存在"）
- 需要改 CI 时告诉人来处理，不要反复重试

## 6. 回滚

线上是静态站，回滚 = 再推一次。

```sh
git log --oneline -10
git revert <坏掉的提交 SHA>     # 生成一个反向提交
sh 上线.sh "revert: 回滚 xxx"   # 60 秒后线上恢复
```

急着止血：人这边可以直接把 `main` 指针退到上一个提交。

## 7. 交付说明（PR 或聊天里都要给）

1. 改了哪些文件（`git diff --stat`）
2. 跑了哪两条命令，输出结尾是什么
3. 改前 / 改后的数字（视觉类必给）
4. 有没有你**没验证**的部分（诚实说，别包装成绿）

## 8. 别踩的坑

- `public/` 是产物，`src/` 是真源
- 事件委托：HTML 里不写 `onclick`，用 `data-act="函数名"`
- 跨模块状态只能读，写要走 `__set__xxx()`
- 数据要加字段必须走版本迁移链
- **站点路径不许动**（`localStorage` 按域名隔离，换地址 = 用户数据全空）
- 改完 src 忘了重新构建 → 线上还是旧的。`上线.sh` 第一步就是构建，别绕过它
- `web/` 目录删了构建会直接崩
