# Agent Note: BREP-only chamfer op (equal / twoDistances / distanceAngle)

Status: implemented

English | [中文](2026-09-01-chamfer-brep-only-op.zh.md)

## Problem

The `cad.*` op set had no chamfer (倒角). A part needing a chamfered edge could not be expressed in `.faijs`, and the host feature panel had no chamfer feature. Because a chamfer is a BREP-only operation, the op had to ride the BREP chain and derive edge identity through live topology resolution: an `EdgeTopoRef` is a two-face pair of `RoleQualifier`s describing the edge, unrelated to any precomputed face/edge ordinal. The op also had to map three public type variants (`equal`, `twoDistances`, `distanceAngle`) onto OCCT's two kernel primitives (`chamfer`, `chamferDistAngle`).

## Decision

`cad.chamfer(part, { edges, type, width | width1/width2 | angle })` is declared as a BREP-only op via `defineOp({ capabilities: ['directEdit'], brep })` in the stdlib, and registered into the symbol table, `api.d.ts`, the op-set consistency test, and the generated ops inventory.

- Per-edge resolution: each `EdgeTopoRef` resolves against a context rebuilt from the current solid (`buildEdgeContextFromSolid`), so a sequence of edges sees the solid as it evolves after each chamfer step.
- `equal`: one `kernel.chamfer(solid, [edge], width)` per edge.
- `distanceAngle`: one `kernel.chamferDistAngle(solid, [edge], width, angle)` per edge; `angle` is validated to (0, 90).
- `twoDistances` (section 3.5 conversion): the kernel picks the reference face (first face in `getSubShapes(solid, 'face')` that contains the edge); the widths map by comparing that kernel ordinal with the resolved ordinal of `EdgeTopoRef.faces[0]` (width1) and `.faces[1]` (width2), then `theta = atan2(dO * sin(beta), dF - dO * cos(beta))` with `beta = 180 - dihedral`; reflex (beta >= 180) throws `E_CHAMFER_RELEX_EDGE`.
- Validation: `assertChamferParams` enforces a non-empty `edges` array (`E_CHAMFER_NO_EDGES`), well-formed two-face refs (`E_CHAMFER_BAD_EDGE_REF`), the `type` enum (`E_CHAMFER_BAD_TYPE`), positive widths (`E_CHAMFER_BAD_WIDTH`), and `angle` in (0, 90) (`E_CHAMFER_BAD_ANGLE`). A mesh-only input routes to the dispatcher's static `E_MESH_UNSUPPORTED` — no mesh implementation is declared.

## Alternatives considered

- **Declare a mesh chamfer too.** Rejected: chamfer is geometrically a BREP-only operation; a mesh fallback would be a fake approximation, so the dispatcher correctly reports `E_MESH_UNSUPPORTED` rather than silently degrading.
- **Expose a single flattened width/angle signature.** Rejected: it loses the `equal` / `twoDistances` ergonomics and would force callers to understand the conversion; the three-shape matches the plan and the OCCT kernel side.
- **Require the user to name the reference face.** Rejected: determinism comes from the plan's rule (kernel enumeration order), which is tested; a user-chosen reference face adds API surface and error cases without benefit.
- **Fold `twoDistances` into `distanceAngle` only.** Rejected: `twoDistances` (two offsets on the two sides) is the common CAD UX and the plan keeps it as a first-class type.

## Consequences

- `chamfer` is now a real op surface: the symbol table (31 entries including `chamfer`), `api.d.ts`, the generated `ops-api-inventory`, and the op-set consistency test all carry it.
- The `equal` geometry is exact OCCT output; volumes are measured in tests (`0.5 * w^2 * L` removed for `equal`), not hand-tuned.
- The doc budget for `docs/ops-api-inventory.md` was raised 3000 -> 3300 to admit the new auto-generated entry: an API manual must list every public op, and the previous headroom was only ~6 words.
- `@qual` is `ok`: the op is implemented and tested; BREP-only routing is deliberate and documented in the entry's note.

## Verification

- `chamfer-math.test.ts` (6 tests): section 3.5 conversion rows - cube 1:1 -> 45 deg, 2:1 -> 26.5651 deg, 1:2 -> 63.4349 deg, 60 deg dihedral 2:1 -> 30 deg, 120 deg 3:1 -> 13.8979 deg; angle-between-normals clamp; reflex throw.
- `packages/tests/faijs/chamfer/chamfer.test.ts` (8 tests, real OCCT): `equal` width 1 -> volume removed `0.5 * 1 * 20 = 10` and faces 6->7 with the BREP chain alive; `twoDistances` 1x3 -> volume removed 30; `distanceAngle` 2 @ 30 deg executes; error paths (`E_CHAMFER_NO_EDGES`, `E_CHAMFER_BAD_EDGE_REF`, `E_CHAMFER_BAD_WIDTH`, `E_CHAMFER_BAD_ANGLE`, and `E_MESH_UNSUPPORTED`) with console spies holding the stderr-zero rule.
- Full suite: core 818, stdlib 46, `packages/tests` 230 - all green; root/workspace typecheck, lint, build, and the CI pipeline pass.
