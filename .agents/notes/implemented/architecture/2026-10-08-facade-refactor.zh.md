# Agent Note：Facade 重构——createRuntime 统一与子路径枚举

English | [中文](2026-10-08-facade-refactor.md)

Status: implemented

## Problem

存在两个同名的 `createRuntime` 函数，签名和行为不同；umbrella facade（`index.ts`）有 252 行手写 re-export 列表，与实际导出脱节；`package.json` 使用通配符子路径模式，可能静默暴露内部模块。

## Decision

将两个同名的 `createRuntime` 函数统一为单一实现，将 umbrella facade（`index.ts`）从 252 行手写 re-export 列表精简为从子模块 index 文件 `export *`，将通配符子路径导出替换为显式枚举，并添加守卫脚本（`check-facade.mjs`）防止漂移。

## What changed

### Phase 1: createRuntime unification

- **删除** `cad-runtime/createRuntimeWithCad.ts`——其 cad 自动注册逻辑移入 `cad-runtime/runtime.ts` 中的 `createRuntime`。
- **`createRuntime`** 现有单一签名 `(ports, mode?, libs?, options?)`，当未提供 `libs.cad` 时自动注册内置 `cad` 命名空间。
- **`createBareRuntime`** 作为纯引擎变体（无 cad 自动注册）的具名工厂函数添加。
- 所有 umbrella 入口（`index.ts`、`browser.ts`、`weapp.ts`）现在从 `cad-runtime/runtime` re-export，而非 `createRuntimeWithCad`。
- `execute-script.ts` 更新为从 `cad-runtime/runtime` import。
- `tessellation-density.test.ts` 更新：3 参数 `(ports, 'brep', { tessellation })` → 4 参数 `(ports, 'brep', undefined, { tessellation })`。

### Phase 2: Facade collapse

- **新 index 文件：** `boolean/index.ts`、`primitives/index.ts`、`sdf/index.ts`——为各子模块聚合公开 API 面。
- **更新 `mesh/index.ts`**——扩展覆盖原先在 `index.ts`/`browser.ts` 手写的全部公开导出；移除 brep re-export（brep 有自己的 index）。
- **`index.ts`** 从 252 行精简到 ~130 行，使用 `export *` 从 `./mesh`、`./brep`、`./boolean`、`./primitives`、`./sdf` 导出。
- `browser.ts` 保持手写（B/C/D 分类是有意义的文档；`runSdfMain` / `PreviewSdfMesh` 等别名需要显式 re-export）。

### Phase 3: Subpath explicit enumeration

- **`package.json` exports：** 11 个通配符模式（`./mesh/*`、`./brep/*`、`./io/*` 等）替换为显式路径条目。
- 仅保留 `./api/*` 通配符（api/ 模块频繁增长；显式许可）。
- 枚举基于 4 个下游仓库（3d_editor、faijs-cadquery、faijs-freecad、faijs-openscad）+ monorepo 内部消费的实际使用。

### Phase 4+5: Guard script

- **`scripts/check-facade.mjs`**——三项检查：
  1. Facade 文件（`index.ts`、`browser.ts`、`weapp.ts`）只能 re-export（不允许 `export function`/`export class`/`export const`）。
  2. `package.json` exports 不得添加新通配符（仅允许 `./api/*`）。
  3. 只有一个文件可以定义 `export function createRuntime`（签名分歧检测）。
- 添加到 `ci.ps1` 和 `ci.sh`。

## What was NOT done

- `browser.ts` 未精简为 `export *`（别名 + B/C/D 分类使其不切实际，会丢失文档价值）。
- 13 个 `api/*/index.ts` 目录 facade 未审计（列为后续工作）。
- 3d_editor weapp worker 3 参数调用点未修改（外部仓库；plan §4.1）。
- 可选优化（3d_editor cad 覆盖 → 一步、faijs-freecad `new CadRuntime` → `createRuntime`）推迟。

## Alternatives considered

- **保留两个 `createRuntime` 函数**：拒绝——同名不同签名的函数会让下游消费者困惑，且无法添加签名分歧守卫。
- **保留手写 re-export 列表加测试**：拒绝——252 行手写列表已在漂移；守卫脚本更可维护。
- **保留通配符子路径导出**：拒绝——通配符可能静默暴露不打算公开的内部模块；显式枚举使公开面可审计。

## Consequences

- 单一 `createRuntime(ports, mode?, libs?, options?)` 入口，自动注册内置 cad 命名空间。
- `index.ts` 从 252 行精简到 ~130 行，使用子模块 index 文件的 `export *`。
- `package.json` exports 使用显式路径条目（仅保留 `./api/*` 通配符）。
- `scripts/check-facade.mjs` 守卫防止 facade 漂移和签名分歧。
- 守卫已添加到 `ci.ps1` 和 `ci.yml`。
