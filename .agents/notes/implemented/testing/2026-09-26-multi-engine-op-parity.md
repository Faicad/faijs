# Agent Note: Multi-engine op parity test harness

Status: implemented

English | [中文](2026-09-26-multi-engine-op-parity.zh.md)

## Problem

faijs supports two BREP engine backends (OCCT and brepkit) with a static dispatch layer that routes ops by `engines` declaration and `capabilities`. There was no test that systematically exercises every upper-layer op across all supported engines and brepkit-wasm versions. Specifically:

- Whether a neutral op (no `engines` declaration) produces geometry consistent with OCCT on brepkit was unknown per-op.
- Whether brepkit-wasm 2.x (MIT/Apache, the version the project can ship) behaves differently from 3.x/4.x (AGPL, current dep and latest) was unverified.
- Existing parity tests covered only primitives + pattern at the BrepEngineApi layer, not the full L3 op surface through CadRuntime.

## Decision

Built a two-layer test harness in `packages/core/src/`:

1. **`brepkit-kernel/multi-version-test.ts`** — `loadBrepkitVersion('2.129.15' | '3.4.18' | '4.0.32')` switches the active brepkit kernel in-process via `setBrepkitWasmInitFn` (absolute-path ESM import of npm-packed tarballs) + `disposeBrepkit()` + `__resetEngineRegistriesForTests()` + `registerBrepkitBrepEngine()`. No source changes to brepkitWasm.ts / brepkitKernel.ts / registry.ts.

2. **`brep/engine/multi-engine-op-parity.test.ts`** — characteristic test covering 33 ops × 4 engines (OCCT + 3 brepkit versions). For each neutral op with a brep implementation, a self-contained `.fai.js` script is executed in brep mode via `createEditorRuntime`; output bbox is extracted from `result.outputs` and compared across engines at 1% tolerance. Ops with known brepkit adapter gaps are recorded in `KNOWN_BREPKIT_GAPS` (whitelisted, not hard-failing) so that any *new* regression immediately turns the test red. Expected-error cases (capability gaps, occt-only ops, mesh-only ops) assert the exact error class and message content.

3. **`brep/engine/multi-engine-results.json`** — raw per-op-per-engine bbox + status, written at test runtime for downstream reporting.

## Key findings

- **14 ops pass all four engines** at 1% bbox tolerance: box, sphere, cylinder, cone, wedge, rotate_euler, scale3d, linearPattern, shell, splitByPlane, engrave, place, unifySameDomain, defeature.
- **18 neutral ops fail on all three brepkit versions** due to adapter-layer gaps (missing `dispose`/`copyShape` capabilities, boolean kernel `Invalid array length` crash, edgeRef requiring OCCT roleTable, non-solid handle rejection). These are faijs adapter deficiencies, not brepkit-wasm version differences.
- **brepkit 2.129.15 / 3.4.18 / 4.0.32 behave identically**: same pass/fail pattern, same bbox values, same error messages. The only differences are internal handle allocation indices.
- **License**: 2.129.15 = MIT OR Apache-2.0; 3.4.18 and 4.0.32 = AGPL-3.0-only. The project's current devDependency pins 3.4.18 (AGPL).

## Alternatives considered

- **Separate vitest passes per brepkit version** (like the existing parity suite split): rejected because in-process switching via `setBrepkitWasmInitFn` proved reliable and avoids the overhead of three worker initializations. The `disposeBrepkit()` + registry reset sequence cleanly isolates versions.
- **Direct BrepEngineApi calls instead of CadRuntime scripts**: rejected because the user requirement is "all upper-layer ops" — testing through defineOp + dispatchPath catches routing and argument-normalization bugs that kernel-level tests miss.
- **Hard-failing on every brepkit gap**: rejected because 18 gaps are pre-existing and known; whitelisting them lets the test catch *regressions* (a gap that gets fixed, or a new break) without being permanently red.

## Consequences

- `npm run test -w @faicad/faijs` now includes the multi-engine parity suite (~131s, single worker).
- The `_test-kernels/` directory holds npm-packed brepkit-wasm 2.129.15 and 4.0.32, gitignored (only `.gitignore` tracked).
- When a brepkit adapter gap is fixed, remove the corresponding entry from `KNOWN_BREPKIT_GAPS` to promote that op to a hard parity assertion.
- No production source code was modified; no package.json dependencies changed.
