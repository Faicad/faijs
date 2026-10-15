# Agent Note：删除 upstream-surface.json 基线与 U7 反向护栏

[English](2026-10-07-drop-upstream-surface-baseline.md) | 中文

Status: implemented

## Problem

`packages/core/src/api/surface/upstream-surface.json` 是从外部 brepjs 仓库提取并提交进仓的符号基线。其唯一活用途是 U7 反向护栏：`gen-l3-surface.ts:generateModule()` 读取它并断言每条非 skip/non-faijs 的 arg-spec 条目都在基线中。项目严禁依赖 brepjs 或任何外部仓库。一份提交进仓的 brepjs 符号清单本身就是基线依赖，即便没有代码 import 它。

## Decision

删除 `packages/core/src/api/surface/upstream-surface.json` 与 `upstream-exclusions.json`，并从 `gen-l3-surface.ts` 与 `surface-mechanism.test.ts` 移除 U7 反向护栏校验。

U7 护栏被 `tsc` 完全覆盖：

- 全部 brep-op/query 的 arg-spec 条目均为 `selfhost: true`（35 brep-op + 8 query，见 2026-10-06 selfhost 清理）。
- `renderBrepOp` 产出 `import { … as __own_<exportName> } from '../brep-operations/…'`——对 core 自有实现的真实 import。
- arg-spec 里 exportName 拼错时，编译 `api/generated/*.ts` 会被 tsc 以 "has no exported member" 拦下。

即 U7 守护的东西 tsc 已全部守护。其剩余语义——"faijs 自有实现的命名必须等于 brepjs 符号名"——是一条命名 continuity 约束，实现 selfhost 后不再成立：命名归 faijs 所有。

`upstream-exclusions.json` 在 `src/`、`scripts/`、`test/` 中零引用。

## Alternatives considered

- **保留基线作为文档**：拒绝——它制造了对 brepjs 符号名的依赖，selfhost 后不再成立；命名归 faijs 所有。
- **替换为基于 tsc 的护栏（无基线文件）**：这正是所做的——tsc 已能捕获 exportName 拼写错误，基线是冗余的。

## Consequences

- 删除 `packages/core/src/api/surface/upstream-surface.json` 与 `upstream-exclusions.json`。
- `gen-l3-surface.ts`：移除 `SURFACE_JSON` 常量、`SurfaceSymbol` 接口、`loadSurfaceSymbols()`、`generateModule()` 中的 U7 校验块；更新头部 JSDoc。
- `surface-mechanism.test.ts`：移除 U7 测试用例；重排头部条目编号。
- `arg-spec.ts`：从头部 JSDoc 移除 upstream-surface.json 引用。
- `npx tsx packages/core/scripts/gen-l3-surface.ts`——重生成全部 14 个模块分片 + script-face + manifest；`git diff --stat packages/core/src/api/generated/` 为空（零漂移）。
- `npx vitest run packages/core/test/api/generated/surface-mechanism.test.ts`——4 passed。
- `npm run typecheck`——干净。`npm run lint`——0 errors。
- 防止 arg-spec 符号名意外漂移的命名 continuity 护栏已移除，但被 tsc 完全覆盖，无活覆盖损失。
