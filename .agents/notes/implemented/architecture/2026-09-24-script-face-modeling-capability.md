# Agent Note: Script-face modeling capability extension — Phase 6–7 closeout

Status: implemented

English | [中文](2026-09-24-script-face-modeling-capability.zh.md)

## Problem

The plan `docs/plans/2026-09-24-script-face-gap-exposure-plan.md` left Phase 6 (plane-cut family + mock stubs) and Phase 7 (docs / guards / version) open after Phases 0–5 landed in commits b0c4a92 … e2165a4. Specifically:

- `splitByPlane` / `sectionByPlane` existed only on the L1 contract face — no cad script-face ops.
- `brep-mock.ts` still stubbed `revolveVec` / `sew` / `shell` / `hullFromPoints` / `sectionByPlane` / `splitByPlane` as `unsupported(...)`, so the mock engine could not drive any orchestration chain that touches them (plan §2.4⑥).
- `handle-bridge.ts` `getKernel()` still claimed to "Get the OCCT kernel instance" although D12 already superseded it with the typed neutral exit `getBrepApi()`.

## Decision

1. **`cad.splitByPlane(shape, { point, normal })` — hand-written neutral op** (`api/split-by-plane.ts`). Product shape follows plan principle 5: the two halves are **named outputs** `['positive', 'negative']`, not an array; positive is the side the normal points to (L1 contract §3.7, classified by centroid projection in the occt adapter). Capability-routed via `capabilities: ['directEdit']`; naming `subdivide` (same as `split`).
2. **`cad.sectionByPlane(shape, { point, normal })` — hand-written neutral op** (`api/section-by-plane.ts`). The L1 product is an edge/wire handle **array**, which cannot cross the single-product boundary — the op collapses it into a **1D compound** (`makeCompound`) and registers via `fromBrepCurve` (plan §7.1-1 ①: the Phase 3 registration pipeline). A plane that misses the shape now throws `E_SECTION_BY_PLANE_NO_INTERSECTION` — the occt adapter previously returned the (empty) result compound as a "curve" handle; that was a silent fake product (principle 9 violation) and was fixed at the adapter (`occt-primitives.ts`): empty section → release + `[]`.
3. **Mock stubs completed** (`brep-mock.ts`): all six methods now carry approximate implementations (bbox algebra + tags), consistent with the file's existing "engine-switch test stand-in" contract. They are explicitly approximations, not geometry.
4. **`getKernel()` deprecated** (`brep/handle-bridge.ts`): JSDoc corrected ("currently injected BREP kernel", not "OCCT kernel") and marked `@deprecated` with pointers to `getBrepApi()` (neutral) and `getOcctKernel()` (L2 platform face). No call sites were migrated — vendored-face bridging and existing tests keep it.
5. **Docs**: `docs/ops-api-inventory.md` regenerated (auto); `docs/api-contract.md`/`.zh.md` §10.1 category table now lists the script-face additions from all phases (1D curve family, sweep/loft family, feature family, plane-cut family, neutral queries) and §7.11 gained a paragraph stating which of them declare `engines: ['occt']` vs neutral.

## Alternatives considered

- **`sectionByPlane` returning the raw handle array via `outputs`.** Rejected: outputs wrapping element-wise works, but the plan prescribes a single 1D compound product (principle 5); a bare array of edge handles would also leak subshape lifetimes without a compound owner.
- **Fixing the empty-section case in the op instead of the adapter.** Rejected: the adapter owns the "empty result" dialect for every future consumer; leaving it there would force every caller to detect the empty compound by trial.
- **Migrating all `getKernel()` call sites now.** Rejected: ~200 references, mostly vendored face and tests; D12 scopes this as a deprecation, not a sweep.

## Consequences

- `cad.splitByPlane` and `cad.sectionByPlane` are reachable from `.fai.js`; both are neutral (brepkit included, mock included).
- GOTCHA (pinned by tests): L1 vector params are `{x,y,z}` objects — tuples become zero vectors inside the kernel; both ops convert at the boundary and reject non-finite input (`E_SPLIT_BY_PLANE_BAD_VEC` / `E_SECTION_BY_PLANE_BAD_VEC`).
- GOTCHA (pinned by tests): `BrepBoundingBox` fields are `xmin/xmax/...`, not `min.x/max.x`.
- `brep_mock` can now execute orchestration chains through shell / sew / revolveVec / hullFromPoints / sectionByPlane / splitByPlane (approximate geometry, real products).

## Verification

- `packages/core/src/api/split-by-plane.test.ts` (3): named halves with BREP handles; positive-above/negative-below with volumes summing to the original; pre-kernel rejection of bad vectors.
- `packages/core/src/api/section-by-plane.test.ts` (4): `kind:'curve'` product with compound handle; section bbox of a box at z=5 pinned (XY = box, Z flattened to 5); `wireframe` supplies non-empty finite points (1D display path, no fake triangulation); explicit error when the plane misses the shape.
- `op-set-consistency` green after regenerating `script-face` + symbol table (both new ops in all three sources).
- `engine-switch-p3` + `feature-family` still green with the new mock stubs; `tsc --noEmit` clean.
