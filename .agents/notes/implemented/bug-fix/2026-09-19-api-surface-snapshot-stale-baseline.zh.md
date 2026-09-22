# Agent Note: api-surface-snapshot 陈旧快照踩坑（2026-09-19）

Status: implemented

English | [中文](2026-09-19-api-surface-snapshot-stale-baseline.md)

## Problem

`scripts/api-surface-snapshot.json`（P0 导出面基线）落后于实际导出面：快照缺 `sketch / extrude / revolve / edgeRef / faceRef` 等导出，且 `./browser` 等多个子路径与最新 `dist/` 构建比对差异达 300+ 行。

## 根因

快照脚本 `scripts/api-surface-snapshot.mjs` 只有两个触发时机：
1. 手工运行 `node scripts/api-surface-snapshot.mjs`（CI 步骤 5 会跑，但**只断言子路径可导入、无 error，不断言"快照与当前 dist 一致"**——快照文件本身旧不旧它不管）；
2. 开发者手工更新基线（运行后 commit）。

而 `packages/core/src/api/index.ts` 的导出变更（8e782e6 加 sketch/extrude/revolve、a7792f8 加 edgeRef、0638a52 加 faceRef、702f7ed 加 extrude/revolve）都没有同步重新生成快照——**导出面变了，基线没跟上，快照静默陈旧**。

另一个前提：快照 import 的是 `dist/`（`require.resolve('@faicad/faijs')` → `packages/core/dist/index.js`）。dist 是构建产物且被 gitignore，所以"dist 新鲜 + 快照陈旧"的组合在 git 里完全不可见，直到有人重新 build 后手动比对才会发现。

## Decision

运行 `node scripts/api-surface-snapshot.mjs` 重新生成基线（326 行 insertions，含 5 个漏记导出 + `./api/*` 通配子路径展开的新增符号），与 dist 逐键比对已一致。

## GOTCHA（防回归）

- **GOTCHA**: 给 `packages/core/src/api/*` 增删导出后，必须重跑 `node scripts/api-surface-snapshot.mjs` 并 commit 新快照，否则 CI 的"导出面守卫"（ci.ps1 步骤 5）形同虚设——它只查导入不报错，不查快照新鲜度。
- **GOTCHA**: `require.resolve('@faicad/faijs')` 解析到 `packages/core/dist/`，快照脚本必须在 `npm run build` **之后**运行；build 前跑会拿到旧 dist 的导出面，把陈旧基线"重新固化"。

## Alternatives considered

- **靠人眼在 build 后手工比对快照与 dist**：否决。git 里完全不可见（dist 被 gitignore），只有重新 build 后手动比对才能发现，等于靠运气。
- **在 CI 追加快照新鲜度硬校验**（如 `git diff --exit-code scripts/api-surface-snapshot.json`，或脚本内"本次生成 vs 磁盘快照"对比，不一致即 exit 1）：未采用，留待后续——note 记录为改进方向，本次以重新生成基线恢复一致。
- **立即重跑脚本重新生成基线**（采纳）：快照与 dist 逐键一致，CI 导出面守卫恢复有效。

## Consequences

- `scripts/api-surface-snapshot.json` 重新生成（326 行 insertions，5 个漏记导出 + 通配子路径展开），与 dist 逐键比对一致，导出面基线恢复新鲜。
- 防回归 GOTCHA 已留档：导出面变更后必须重跑快照脚本并 commit；快照脚本必须在 build 之后运行。
- 未实施：CI 快照新鲜度硬校验（改进方向，记录于 Alternatives）。
