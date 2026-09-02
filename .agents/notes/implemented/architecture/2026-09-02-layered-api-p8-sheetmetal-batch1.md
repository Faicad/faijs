# Agent Note: Layered API port — P8 sheetmetal batch 1 (2D/data layer + compat shim)

Status: implemented

English | [中文](2026-09-02-layered-api-p8-sheetmetal-batch1.zh.md)

## Problem

P7 wired the first L3→L2 op, but the plan's flagship proof — porting the sheetmetal library to show "the L3 API face is sufficient for a real industrial domain library" — was untouched. P8 is batch 1 of that port (plan §8): the pure 2D/data layer that touches no 3D solids, plus the D12 compat shim, as the earliest validation point of the API surface.

## Decision

1. **New L5 workspace package `@faicad/sheetmetal`** (plan §7.7): single `.` export, empty `dependencies`, own tsconfig/vitest config with the D10 kernel setup (`initOCCT` = `initOcctWasm()` + `bindOcctKernel()`, plan §7.5 ④). The peer is `"@faicad/faijs-core": "*"` — see the deviation note below.
2. **`compat.ts` — the package's only bridge point (D12 / §9 whitelist).** It re-exports the Result machinery and types from vendored L1 (`core/result`, `core/errors`, `core/shapeTypes`, `core/validityTypes`, `core/types`, `topologyQueryFns.Bounds3D`) and the 2D/query ops (`line`/`wire`/`wireLoop`/`getEdges`/`curveStartPoint`/`curveEndPoint`/`isSolid`/`getSolids`) as **direct re-exports of vendored L2** — preserving brepjs-identical names and signatures, so the ported files only change their import source line (`from 'brepjs'` → `from './compat.js'`).
3. **First batch ported verbatim** — `allowanceFns`/`bendTableFns`/`materials`/`reportFns`/`featureTreeFns`/`types`/`polygonFns`/`nestFns`/`dxfFns`/`unfoldFns` (10 files, 3575 lines) plus `internal.ts` (28 lines, which `unfoldFns` depends on). Result-consumption points are untouched; only the import source lines changed. A `NOTICE` records the Apache-2.0 attribution and the locked upstream commit (O10).
4. **Precision gate: `reference.test.ts` ported and green (6 tests).** `bendAllowance` is checked against hardcoded SheetMetal.Me / Machinery's Handbook reference constants at 5 decimal places, plus the `BA(2A) = 2·BA(A)` linearity test — independent of our implementation.

## Alternatives considered

- **Hand-written wrapper functions in compat instead of direct re-exports.** Rejected: direct re-exports preserve brepjs's exact generic signatures (e.g. `getEdges<D>(shape: AnyShape<D>): Edge<D>[]`), minimizing divergence risk for the ported callers.
- **Add the 2D/query ops to the L3 `cad.*` namespace and have compat consume them.** Rejected for batch 1: the 2D values must stay brepjs-shaped kernel handles (e.g. `FlatPattern.outline` is a brepjs `Wire`), while `cad.*` ops return faijs `Shape` wrappers. The `cad.*` involvement belongs to the 3D batches (D12's `fuse = cad.union` path) and is deferred.
- **Port `vec*` into compat now.** Rejected: batch 1 does not consume `vec*`; they arrive with the 3D batches (`authorFns` etc.), per plan §7.5 ⑤.
- **Run `invariants.test.ts` in P8.** Rejected: the current upstream version imports `author`/`unfold` (3D solids, batch 2/3) — contradicting the plan's assumption that both precision tests are 3D-free. It is deferred with the 3D batches.

## Consequences

- `@faicad/sheetmetal` 0.1.0 is a real L5 package: workspace registered (6 workspaces, order guard OK), single `.` export, peer `@faicad/faijs-core`, own vitest config with the D10 kernel setup.
- Gates green: sheetmetal typecheck/lint/test (6 passed); root `typecheck`; `lint` 0 errors; `check-workspaces-order` OK (6 workspaces in dependency order); `check-ghost-deps` OK (504 files); `check-layer-boundaries` OK (237 vendored files).
- **Deviation log** (vs the plan): ① `invariants.test.ts` deferred to batch 2/3 — it needs 3D `author`/`unfold`; ② the peer range differs from plan §7.7 (`"@faicad/faijs": ">=1.0.0 <2"` → `"@faicad/faijs-core": "*"`) — the root package cannot be resolved as a workspace peer by npm, so mech-lib's `faijs-core` peer pattern is used; `CONTRACT_VERSION` remains the real runtime negotiation; ③ batch size is 3575 lines vs the plan's 2940 estimate (`types`/`unfoldFns`/`nestFns` grew upstream).
- **CI 收尾（全绿，`scripts/ci.ps1` 9/9）**：全量测试首跑暴露两类既有问题并已修复——① p5-vendored-surface 的 sweep/sketch 测试触发 occt-wasm 适配器对缺失 `sweepAdvanced` 的一次性警告（occt-wasm 3.8.4 上限），违反 stderr 零容忍；5 个触发测试内 spy `console.warn` 并断言（断言置于 `finally` 内，先断言后 `mockRestore`——`mockRestore` 会清空调用记录）。② export-jsdoc 门禁对移植文件 118 处 JSDoc 缺失（函数缺 `@param`/`@returns`、接口缺描述），已逐一补全（仅注释，零逻辑改动）；`docs/ops-api-inventory.md`/`.zh.md` 从 L3 声明重新生成。
- Versions: root/core `0.7.5 → 0.7.6`.
