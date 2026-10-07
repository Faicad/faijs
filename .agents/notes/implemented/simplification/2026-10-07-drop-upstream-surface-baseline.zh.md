# 删除 upstream-surface.json 基线与 U7 反向护栏

[English](2026-10-07-drop-upstream-surface-baseline.md) | 中文

状态：已落地（2026-10-07）

## 决策

删除 `packages/core/src/api/surface/upstream-surface.json` 与 `upstream-exclusions.json`，并从 `gen-l3-surface.ts` 与 `surface-mechanism.test.ts` 移除 U7 反向护栏校验。

## 背景

`upstream-surface.json` 是从外部 brepjs 仓库提取并提交进仓的符号基线（`_meta.upstreamRef: "C:/git/OpenCascade/brepjs/src/index.ts"`）。其唯一活用途是 U7 反向护栏：`gen-l3-surface.ts:generateModule()` 读取它并断言每条非 skip/non-faijs 的 arg-spec 条目都在基线中（按 `name` 或 `source` 的 exportName 回查）。`surface-mechanism.test.ts` 复述同一断言。

项目严禁依赖 brepjs 或任何外部仓库。一份提交进仓的 brepjs 符号清单本身就是基线依赖，即便没有代码 import 它。

## 论据

U7 护栏被 `tsc` 完全覆盖：

- 全部 brep-op/query 的 arg-spec 条目均为 `selfhost: true`（35 brep-op + 8 query，见 2026-10-06 selfhost 清理）。
- `renderBrepOp` 产出 `import { … as __own_<exportName> } from '../brep-operations/…'`——对 core 自有实现的真实 import。
- arg-spec 里 exportName 拼错时，编译 `api/generated/*.ts` 会被 tsc 以 "has no exported member" 拦下。

即 U7 守护的东西 tsc 已全部守护。其剩余语义——"faijs 自有实现的命名必须等于 brepjs 符号名"——是一条命名 continuity 约束，实现 selfhost 后不再成立：命名归 faijs 所有。

`upstream-exclusions.json` 在 `src/`、`scripts/`、`test/` 中零引用。

## 放弃了什么

防止 arg-spec 符号名意外漂移的命名 continuity 护栏。被 tsc 覆盖，无活覆盖损失。

## 改动

- 删除 `packages/core/src/api/surface/upstream-surface.json` 与 `upstream-exclusions.json`。
- `gen-l3-surface.ts`：移除 `SURFACE_JSON` 常量、`SurfaceSymbol` 接口、`loadSurfaceSymbols()`、`generateModule()` 中的 U7 校验块；更新头部 JSDoc。
- `surface-mechanism.test.ts`：移除 U7 测试用例；重排头部条目编号。
- `arg-spec.ts`：从头部 JSDoc 移除 upstream-surface.json 引用。

## 验证

- `npx tsx packages/core/scripts/gen-l3-surface.ts`——重生成全部 14 个模块分片 + script-face + manifest；`git diff --stat packages/core/src/api/generated/` 为空（零漂移，符合预期，因 U7 只 throw 不影响产出）。
- `npx vitest run packages/core/test/api/generated/surface-mechanism.test.ts`——4 passed。
- `npm run typecheck`——干净。
- `npm run lint`——0 errors（2 个预先存在的 brepkit_wasm.d.ts 警告与本次改动无关）。