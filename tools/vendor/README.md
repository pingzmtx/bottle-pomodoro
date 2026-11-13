# tools/vendor · 第三方只读依赖

本项目**不引入 npm**（没有 package.json / node_modules），所有 Node 侧工具都必须是
「clone 下来就能跑」。因此需要第三方库时，把**单文件构建**直接放进本目录。

## acorn.js

| 项 | 值 |
|---|---|
| 包 | [acorn](https://www.npmjs.com/package/acorn) |
| 版本 | 8.11.3 |
| 文件 | acorn.js（UMD/CJS 单文件构建，231 KB） |
| 来源 | `https://cdn.jsdelivr.net/npm/acorn@8.11.3/dist/acorn.js` |
| 许可 | MIT |
| 用途 | `tools/callgraph_ast.js` 解析 `src/scripts/*.js` 得到真实 AST |

### 为什么是 CJS 单文件，而不是 ESM

`dist/acorn.mjs` 用 ESM，`tools/tests/unit_pure.js` 是 CommonJS（`require(...)`）。
Node 22 虽然支持 ESM，但要在 `.js` 里 `import` 需要 `"type": "module"`，那会连带改动
既有工具的加载方式。选 UMD/CJS 单文件，`require('../vendor/acorn.js')` 直接可用、
零配置、零 npm。

### 为什么不 pin 到 CDN、不写进构建

本目录是**工具侧**依赖，只被 `tools/` 读取，**不参与产物合成**——`tools/build.py`
只拼接 `src/template.html` + `src/scripts/*.js`，不会把这里的内容打进 `index.html`。
产物仍然是零依赖的单文件 HTML。

### 升级方式

```bash
curl -sS -L -o tools/vendor/acorn.js \
  https://cdn.jsdelivr.net/npm/acorn@<新版本>/dist/acorn.js
node -e "console.log(require('./tools/vendor/acorn.js').version)"   # 校验版本
```

升级后必须重跑 `node tools/callgraph_ast.js --selfcheck`，确认 `src/` 全部解析成功、
边数没有异常跳变，再提交。
