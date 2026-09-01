# Agent Note: 分层 API 移植 — P6 L3 全量面与 stdlib 退役

Status: implemented

[English](2026-09-02-layered-api-p6-kill-stdlib.md) | 中文

## Problem

`@faicad/faijs-stdlib` 包游离在架构方案的 L0–L3 分层之外：约 30 个 `cad.*` op 住在第二个包里，另有一条 `./stdlib` 子路径，根门面经由并行入口再导出它们，而引擎内部都在 `packages/core`。方案的 D1 决定（"取消 stdlib 包与'标准库'概念"）采纳了用户的判断：stdlib 不是标准库，只是"支撑 3d_editor 的 API 集合"，没有通用价值，也不能充当 L3 API 面。P6 的门是 L3 全量：所有公开 op 落户 `packages/core/src/api/`（即 L3 API 面），删除该包，"标准库"/"stdlib" 占位词在所有文档与文案中让位给 **faijs API 面**。

## 决策

1. **库面并入 core——不再有第二个包。** `packages/stdlib/src/*` 整体迁入 `packages/core/src/api/`（各 op + `brepjs-mirror/` + `internal/` + `index.ts` barrel）。core 内部的交叉引用改写为相对 import（`../…`、`../../…`）；`packages/stdlib/` 从 workspace、根 `package.json`（workspaces / deps / `build` 脚本 / `lint` 范围）、tsconfig paths、vitest alias、mech-lib peer 依赖与 lockfile 中删除。`packages/core/package.json` exports 增 `./api`、`./api/*`，删 `./stdlib`、`./stdlib/*`。
2. **命名空间改名，取代"internal stdlib"。** `internal-stdlib.ts` → `api-namespace.ts；`工厂符号 `createInternalStdlib()` → `createApiNamespace()`，"stdlib" 从面向代码的表面消失。根门面 `createRuntime` 包装注入库的方式由 stdlib 桶改为 `registerLib('cad', createApiNamespace())`；`src/browser.ts` 对浏览器（无 node）面同样处理。`packages/core` 的 `index.ts` 与 `browser.ts` 以 `export * from './api'` ＋ `export { createApiNamespace }` 收尾，L3 API 面成为 core 入口的一部分。
3. **概念并入文档。** `docs/api-contract.md`（及 `.zh.md`）、README import 表、`AGENTS.md`、`docs/ops-api-inventory.md`（由 `gen-ops-api-inventory.ts` 改从 L3 声明重新生成）统一改称 **faijs API 面**。根门面子路径数由 11 降为 10。
4. **宿主迁移先于删包（D1-⓪）。** 3d_editor 两处生产 import `@faicad/faijs/stdlib`（`LiveDrillPreview.tsx` 的 `drill`、`EngravingCore.ts` 的 `engrave`）改指 `@faicad/faijs/browser`，`drill`/`engrave` 加入 `contract-entry.test.ts` 的 A/B/C/D 白名单锁，涉及旧模块的测试 mock 一并改指，宿主用重新打包的 tarball 重装。整个宿主树不再出现 `stdlib` 字样。

## Alternatives considered

- **保留包并从 core 再导出。** 否决：同样"安置"却仍留着一个方案 D1 明确要终结的并行包，也会把 workspace 合并已消除的幽灵依赖与版本耦合负担带回来。
- **保留 `createInternalStdlib()` 名字。** 否决："internal stdlib" 描述的是一个已不存在的包；`createApiNamespace()` 如实说出它的身份（L3 API 命名空间），且改名本就是方案中的显式重命名步骤。
- **放弃现有实现、在 core 原语上从零重写 API op。** 否决：P5 的 vendored L2 层与现有 `defineOp` 双链实现已覆盖这些 op 并通过 brepjs 自己的套件；推倒重来在无新增能力的情况下丢掉一条全绿基线。实现保持原样迁移，只改归属与基础 import。
- **本次一并删掉 `assert.ts` 与 `geom.ts`。** 否决：其替代（L3 `schema` 声明；brepjs `measurement/query`）被方案推迟，此时删除会破坏仍旧引用它们的面。它们随其余代码一起迁走。
- **丢弃 `brepjs-mirror/`（threadFns/joinery-brep）文件。** 否决：它们是 D11 适配模式的既有移植样板（kernel 直调、手动 release、Result→throw 边界），方案要求保留——它们迁到 `api/brepjs-mirror/`，相对 `../../occt-kernel` 引用不变。

## Consequences

- 交付形态收敛为"引擎与 L3 API 面同在于 `packages/core`"；根门面 10 个子路径，`@faicad/faijs-stdlib` 消失，"两个包"的心智模型合并成一个。
- 迁移后四守卫全绿：workspace 测试（core 926 passed/9 skipped、tests 1269 passed/2 skipped、mech-lib 23 passed）、根与各包 `typecheck`、`lint` 0 errors、`check-ghost-deps`（488 文件）、`check-workspaces-order`、`npm run build`（先 core 后根门面）、`check-layer-boundaries`（P3/P5 vendored 237 文件）、vendored 严格 `tsc`、`api-surface-snapshot.mjs`（10 子路径）、`doc-sync`（13 门）。唯一未解决的是 `vendored/brepjs` P3/P5 树内既有的循环依赖——那是第三方 vendored 代码且早于本提交；相关的 layer/ghost/typecheck 门均绿。
- 浏览器（无 node）宿主经由 `/browser` 获得同一 API 面；一旦 drill/engrave 等宿主路径的依赖被破坏，会在宿主自己的契约测试与 typecheck 中先暴露，而不是上线后才出问题。
- Tarball：根与 `packages/core` 的 `npm pack` 重新产出不含 `./stdlib` 导出、不含 `dist/stdlib` 的 `faicad-faijs-0.7.4.tgz` / `faicad-faijs-core-0.7.4.tgz`；3d_editor 重装拉取新 tarball。残留的 `packages/core/dist/stdlib/*`（88 文件，git-ignored、未跟踪）保持忽略状态，不会进入任何包产物。