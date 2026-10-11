# Agent Note: ops-api-inventory generated from JSDoc

Status: implemented

[English](2026-10-11-brepkit-step-io-no-gate.md) | 中文

## Problem

brepkit 内核自带纯 Rust 的 AP203 reader/writer（`importStep` / `exportStep` 绑定，faijs 适配器已在 `brepkit-kernel/brepkitKernel.ts` 封装），但 faijs 三处引擎门（`cad.exportStep` 的 `assertEngineFor`、`exportModelSync`/`exportModel` step 分支的 `engineId !== 'occt'` 抛错、`import_step` 的 `engines: ['occt']`）把 brepkit 全部拦下，STEP 进出口在 brepkit 引擎下不可用。

用户指令（2026-10-11，逐字见 `docs/plans/2026-10-11-brepkit-step-io.md`）：不应该有门禁，不应该报错。导出按 brepkit 支持的格式来；导入遇到不支持的特性最多警告、甚至可以没有，一切按照 brepkit 自己的实现来。

## Decision

STEP 改为库面按引擎静态分派，**不设能力断言**：

- `exportStep` / `exportModel:step`：`engineId === 'brepkit'` → 新增内核原生通道 `brep/export/step-flat.ts`（逐成员调 `kernel.exportStep`，多成员在文本层做 DATA 段实体号重编号后拼接；该通道 `unit`/`fileMeta` 不生效——忽略、绝不报错）。其余引擎（含 occt）保持 XCAF 装配通道不变。
- `import_step`：删掉 `engines: ['occt']`；实现体本已引擎中立（`loadBrep` → `kernel.importStep`，走 `getBrepApi()`）。brepkit 适配器已实现涉及的 L1 方法（`importStep`、`fromBREP`、`getSubShapes`、E3 roleTable 用的 `subShapeHashes`），无需按引擎特判。

## 内核侧修复（brepkit2 仓）

occt 写的 fixture `box_boss.step` 在 brepkit reader 内抛 `unsupported STEP entity: SURFACE_CURVE`。已在 `brepkit2/crates/io/src/step/reader.rs`（`build_curve_geometry`）修复：`SURFACE_CURVE` / `SEAM_CURVE` / `INTERSECTION_CURVE` 递归取 3D 基曲线、忽略 pcurve——与「不支持的特性忽略」指令一致。已用重建的 wasm 本地验证（`cargo xtask wasm-build`，冒烟测试绿，fixture 经 `packages/core/scripts/dbg-brepkit-step-import.ts` 导入体积 > 0）。npm 上的 `brepkit-wasm`（3.6.0）尚未带此修复，故覆盖「brepkit 读 occt STEP」的 vitest 用例在内核发版并升级依赖前为 `it.skip`。

## Alternatives considered

- **把门禁放宽成 `['occt', 'brepkit']`**：仍是门禁——用户明确不要门禁，且 brepkit 内核确实做得了。
- **保留 XCAF 写出器、在 brepkit 下伪造装配输出**：内核没有的层级不能造，违背「一切按内核自己的实现」，弃。
- **brepkit 通道对非 mm 单位报错**：违背「不报错」；`unit` 在该通道直接不生效。

## Consequences

- brepkit 下 `cad.exportStep` 产出平铺、无层级、无名称/颜色的 AP203 STEP——这是设计使然，不是回归。
- brepkit 通道忽略 `unit`；需要声明单位的 STEP 走 occt 通道。
- 未来 brepkit-wasm 发版即可解锁 skip 的测试（`import-step.test.ts` brepkit describe 块）；验证脚本在 `packages/core/scripts/dbg-brepkit-step-import.ts`。
- 契约文档已同步：`docs/ops-api-inventory.md` / `.zh.md`（§3.16、§10.3）。
