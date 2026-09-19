# Agent Note: api-surface-snapshot 陈旧快照踩坑（2026-09-19）

## 现象

`scripts/api-surface-snapshot.json`（P0 导出面基线）落后于实际导出面：快照缺
`sketch / extrude / revolve / edgeRef / faceRef` 等导出，且 `./browser` 等多个
子路径与最新 `dist/` 构建比对差异达 300+ 行。

## 根因

快照脚本 `scripts/api-surface-snapshot.mjs` 只有两个触发时机：
1. 手工运行 `node scripts/api-surface-snapshot.mjs`（CI 步骤 5 会跑，但**只断言
   子路径可导入、无 error，不断言"快照与当前 dist 一致"**——快照文件本身旧不旧
   它不管）；
2. 开发者手工更新基线（运行后 commit）。

而 `packages/core/src/api/index.ts` 的导出变更（8e782e6 加 sketch/extrude/revolve、
a7792f8 加 edgeRef、0638a52 加 faceRef、702f7ed 加 extrude/revolve）都没有同步
重新生成快照——**导出面变了，基线没跟上，快照静默陈旧**。

另一个前提：快照 import 的是 `dist/`（`require.resolve('@faicad/faijs')` →
`packages/core/dist/index.js`）。dist 是构建产物且被 gitignore，所以
"dist 新鲜 + 快照陈旧" 的组合在 git 里完全不可见，直到有人重新 build 后
手动比对才会发现。

## 修复

运行 `node scripts/api-surface-snapshot.mjs` 重新生成基线（326 行 insertions，
含 5 个漏记导出 + `./api/*` 通配子路径展开的新增符号），与 dist 逐键比对已一致。

## GOTCHA（防回归）

- **GOTCHA**: 给 `packages/core/src/api/*` 增删导出后，必须重跑
  `node scripts/api-surface-snapshot.mjs` 并 commit 新快照，否则 CI 的
  "导出面守卫"（ci.ps1 步骤 5）形同虚设——它只查导入不报错，不查快照新鲜度。
- **GOTCHA**: `require.resolve('@faicad/faijs')` 解析到 `packages/core/dist/`，
  快照脚本必须在 `npm run build` **之后**运行；build 前跑会拿到旧 dist 的
  导出面，把陈旧基线"重新固化"。
- 改进方向（未实施，留待后续）：在 ci.ps1 快照步骤后追加一次
  `git diff --exit-code scripts/api-surface-snapshot.json`，或在快照脚本内
  对比"本次生成结果 vs 磁盘上的快照"，不一致即 exit 1——把"基线陈旧"变成
  CI 硬失败，而不是靠人眼发现。
