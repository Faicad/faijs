# Agent Note: Assembly constraints on the brepjs solver kernel

Status: implemented

English | [中文](2026-09-06-assembly-constraints-brepjs.zh.md)

## Problem

Assembly positioning was limited to a single hardcoded `face_mate` constraint shape buried in `compound.ts`: it matched face centers/normals ad hoc, supported only part-to-part plane mates, produced no diagnostics, and could not express the constraint vocabulary a CAD assembler needs (concentric, distance, angle, parallel, perpendicular, fixed). At the same time, the vendored brepjs source already contains a zero-dependency analytic constraint solver (`solverAdapter.solveConstraints`) with topology-round scheduling, DOF analysis, and convergence diagnostics that faijs did not use at all. Also, solving requires axis geometry for cylindrical faces and circular edges, but the topology-naming hint layer captured no axis information.

## Decision

The brepjs `solverAdapter` is adopted wholesale as the faijs assembly solve kernel (no vendored-code changes), behind a new assembly layer under `packages/core/src/api/assembly/`:

- **Types** (`types.ts`): `AssemblyVec3`, `FaceRef`/`EdgeRef`/`PointRef`/`FaceIndexRef` entity refs, and nine constraint types — `mate`, `align`, `coincident`, `concentric`, `distance`, `angle`, `parallel`, `perpendicular`, `fixed` — plus the legacy `face_mate` shape accepted at the boundary.
- **Normalization** (`normalize.ts`): `face_mate` is rewritten to `mate` (field reordering only); unknown constraint types throw.
- **Entity resolution** (`entities.ts`): entity refs resolve to brepjs `SolverEntity` (`plane`/`axis`/`point`) from live topology or hint snapshots; a cylindrical face becomes an `axis` entity, a planar face a `plane`, a missing axis a hard `E_TOPO_NOT_FOUND` — never a silent wrong entity.
- **Lowering** (`lower.ts`): `mate`/`align` lower to a single `concentric` plus axis encoding (the dependency-side axis encodes the normal flip, so a normal-opposed coincident center plus axis alignment is exactly equivalent); `parallel`/`perpendicular` lower to `angle` 0°/90°; `fixed` uses a placeholder entity. No bespoke composition logic is written.
- **Solve** (`solve.ts`): `solveAssembly(members, memberNames, constraints)` runs normalize → lower → `solveConstraints`; non-convergence throws with the solver's unsupported-constraint detail; the result is one final pose per member (a member is positioned once — multiple constraints targeting the same member are combined by the solver, not applied sequentially), and identity poses are omitted from the output. An empty member name throws before solving.
- **Pose conversion** (`pose.ts`): quaternion order swap (brepjs `[w,x,y,z]` ↔ faijs `[x,y,z,w]`) and pivot semantics conversion (`p' = R·(p−pivot) + pivot + t` ↔ brepjs `p' = R·p + position`) are the only math done outside the kernel; both are property-tested against 200 random poses.
- **Application**: the compound `assembly()` behavior exposes `do_assemble` and `solve` (synonyms) plus a no-op `add_constraint`; `solveTransforms` delegates to `solveAssembly(...).transforms`. In direct-executor mode, `applyPendingAssemblyTransforms` applies the taken pending transforms after unit execution (mesh vertices baked, BREP rigid-transformed, downstream recomputed) without a DAG rebuild.
- **P0 hint axis**: `FaceHint`/`EdgeHint` gain an optional `axis: { origin, direction }` (`AxisHint`). `geom-hint.ts` captures cylinder-face axes (same surface-parameter math as `topologyExt`), straight-edge axes (start point + tangent), and circle-edge axes (center via three sampled points, normal via cross product); capture failure never fabricates an axis. Row snapshots and `resolveFaceGeometry` pass the axis through.
- **Errors**: the three-state topology error discipline applies — `E_TOPO_NOT_FOUND` (dangling ref), `E_TOPO_DELETED`, `E_TOPO_AMBIGUOUS`; nothing silently resolves to the wrong entity.

## Alternatives considered

- **Write a faijs-native solver.** Rejected: the brepjs adapter is a complete analytic solver (topology rounds, DOF, convergence) with zero kernel dependencies; duplicating it adds a second solver to maintain and risks divergence.
- **Compose `face_mate` from synthetic constraint logic instead of lowering.** Rejected: `mate` is exactly equivalent to one `concentric` plus axis encoding (dependency-side axis carries the normal flip), so a compositional synthesizer would duplicate what lowering already expresses with less code.
- **Runtime fallback to mesh when the BREP chain is unavailable.** Rejected: BREP-path availability is decided statically before execution by project red-line rules; a solver running on live BREP handles must not silently degrade.
- **Sequential per-constraint application of transforms.** Rejected: a node is positioned once by the solver (final state per member); sequential application would double-apply transforms and contradict the kernel's round scheduling.
- **Extend the kernel with `getEdgeCircleData` for circle-edge axes.** Rejected: three-point circle fitting from `curvePointAtParam` samples already yields the center exactly, avoiding any vendored-kernel change.

## Consequences

- The `cad` API now carries a nine-type assembly constraint surface (plus the accepted legacy `face_mate`), documented in the generated `docs/ops-api-inventory.md` §6.1 and in `docs/api-contract.md` §12.
- `face_mate` remains accepted at the boundary but is normalized away; its old ad-hoc solving loop in `compound.ts` is deleted.
- The topology-naming hint schema is extended (`AxisHint`); regenerated `mesh/api.d.ts` includes it, and hosts that emit hints can now attach axis data.
- `assembly()` / group behaviors gained `solve`/`solveDetailed`; direct mode applies pending transforms immediately after `do_assemble`/`solve` instead of requiring a DAG rebuild.
- P2 (syntax-layer `.fai.js` sugar and host adapters) and P3 (motion joints / IK) remain out of scope; the kernel and lowering layer are designed to accept them later.

## Verification

- `geom-hint-axis.test.ts` (8 cases): cylinder-face axis capture (including reversed faces), straight-edge axis, circle-edge axis, non-circular curve rejection, missing-radius rejection.
- `pose.test.ts`: quaternion round-trip and pivot conversion against 200 random poses each.
- `solve.test.ts` (20 cases): `mate` ≡ legacy `solveFaceMate` on four fixture groups, degenerate branches, chained three-body assembly, direct-translation constraint comparison, non-convergence throw with detail, empty member-name throw, missing-axis `E_TOPO_NOT_FOUND`.
- `assembly-replay.test.ts` (3 cases): mesh-module vs direct-executor identical transforms, `mate`+`fixed` through `asm.solve()`, no double-application (L6).
- `packages/tests/faijs/assembly/assembly-constraints.test.ts` (5 cases, real OCCT): hint axis capture against live OCCT geometry, new constraint types end-to-end, dangling cylindrical face `E_TOPO_NOT_FOUND`.
- Full suites: core 1260 passed | 10 skipped; `packages/tests` 1528 passed | 3 skipped; root/workspace typecheck and lint clean.
