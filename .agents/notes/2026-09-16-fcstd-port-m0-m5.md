# Agent Note: FCStd → faijs one-way port: M0–M6 landed

Status: implemented

English | [中文](2026-09-16-fcstd-port-m0-m5.zh.md)

## Decision record

1. **planegcs dependency installation**: the npmmirror mirror has no tarball for this package (404), and `npm install -w` treats internal workspace packages as registry dependencies (E404). Final approach: manually unpack the official-registry tarball into `node_modules/`. **Leftover**: `packages/core/package.json` already declares `@salusoft89/planegcs` / `fflate` / `@xmldom/xmldom`, but the lockfile chain must be re-captured by re-running `npm install` in a normal npm environment (node ≥ 22 ships npm 10); `check-ghost-deps` passes (declarations complete).
2. **DistanceX/Y → planegcs `difference` mapping**: semantics calibrated by measurement as `param2 - param1 = difference` (opposite to intuition); FCStd's DistanceX/DistanceY values are signed, so they align directly.
3. **Sketch contour wiring boundary (M5 status)**: the `.fai.js` script surface has no sketch declaration syntax yet (that is M6's cad-face wiring), so L0 sketch contours only land in `mapping.json`'s `sketch.gcs` field (D1 contract); Pad/Pocket profiles whose entity variable is not resolvable on the script surface fall back to baked with `reason: pad-missing-profile` (D3). **This is not a defect, it is the planned phase boundary** — unlocked by M6.3.
4. **V2 final measured result** (56 files / 126 sketches / 1,539 constraints, after M6): L0=122, L1=4 (1 unsupported-constraint + 3 delta-exceeds-t1, all downgraded to L1 per D3 keeping initial values), L2=0. T1=1e-6 calibration holds (early measurement delta p99=3.55e-15). Two rounds of parse fixes contributed significantly: GeoUndef(-2000) placeholder misread as external geometry (82→113), old-format `<UID/>` wrapper not skipped (113→115), M6.3 external-geometry projection unlock (115→122).
5. **Old-format compatibility**: in ProgramVersion 0.14–0.17 era files (e.g. PadTest.fcstd), Pad's profile link property is named `Sketch` rather than `Profile` (`profileLink()` reads both); `<Geometry>` children may be preceded by `<Construction/>`/`<GeoExtensions/>` wrappers, skipped during parsing.
6. **Generated `.fai.js` syntax**: faijs is a top-level `let partN = cad.x(...)` statement stream (cf. `packages/tests/faijs/` fixtures) — no `export function main` wrapper, no return; products pass `faijs-cli check` (V7).

## Code locations

All under `packages/core/src/fcstd/`: `unpack.ts` (M1.1), `document.ts` (M1.2), `container.ts`+`build-fai-zip.ts` (M2), `sketch-parse.ts` (M3.1), `sketch-solver.ts`+`planegcs-backend.ts` (M3.2–M3.4), `sketch-verify.ts` (M3.5/D2/D3), `contour.ts` (M3.6), `feature-translate.ts` (M4), `codegen.ts` (M5).

Scripts (after the 2026-09-20 ownership adjustment): the CLI is `packages/core/src/fcstd/cli.ts` (end-to-end, `faijs-fcstd-convert`); the other dev helpers / corpus probes (`validate-sketch-solve.ts` V2, `probe-planegcs.ts` M0, `scan-fcstd-samples.ts` M1.3/1.4 — deduped and deleted) moved to `D:/Faicad/fcstd-port/tools/` — they depend on external FCStd corpus and cannot run in faijs CI.

## Leftovers / follow-ups

- M6.2 expression fallback (`expressions.ts`) and M6.1 edge anchors are both landed; M6.3 external geometry is still "wireframe edge projection unlocked, full external geometry not unlocked".
- R7 pending decision: revolve is wired to the cad face; sweep has zero samples, shelved.
- M2 reported geometry count 640 vs planned 786: the difference is a counting-caliber matter (plan counts external-geometry cache entries), not data loss.

## M6.1 edge anchors and Fillet/Chamfer wiring (2026-09-16 addendum)

**Problem**: FCStd's `PartDesign::Fillet` / `PartDesign::Chamfer` only use `Base` (`App::PropertyLinkSub`) to give "previous feature + `EdgeN` ordinal" (12 objects measured: `<LinkSub value="Pad001" count="2"><Sub value="Edge17"/><Sub value="Edge18"/>…`). But faijs's `cad.fillet`/`cad.chamfer` require `edges: EdgeTopoRef[]` — by naming-layer design these are "{origin, role} pairs of the two adjacent faces" (`topology/naming/types.ts`), **not ordinals**. A bridge was missing.

**Decision**: add `cad.edgeRef(shape, edgeOrdinal)` (`packages/core/src/api/edge-ref.ts`, a **synchronous** query function following the `api/geom.ts` `faceNormal` pattern) that resolves the Nth edge into an `EdgeTopoRef` at kernel time:

1. `buildEdgeResolutionContext(kernel, shape)` reads the live edge table (ordinals start at 1);
2. enumerate each face's edges, take the one `isSame` as the target edge as its adjacent face (does not rely on the filtered-subscript alignment of `edgeFaceAdjacency`);
3. `findOriginRole(roleTable, faceHashes, faceOrdinal)` reverse-looks-up each adjacent face's `{origin, role}`;
4. hint uses `captureEdgeHint` (length/midpoint/axis).

**Ordinal contract (key premise)**: `getSubShapes(solid,'edge')` and `wireframe()` both use `TopExp::MapShapes` + `NCollection_IndexedMap` enumeration (`occt-kernel/topologyExt.ts:620` documented), and `wireframe().edgeGroups[k]` was measured equal to FreeCAD `Edge(k+1)` (`fcstd/external-geo.test.ts`). Hence "faijs Nth edge == FreeCAD `EdgeN`" and ordinals pass through directly.

**Translation rule** (`feature-translate.ts`): Fillet → `cad.fillet(base, {edges:[cad.edgeRef(base,N)…], radius})`; Chamfer dispatches by the `ChamferType` enum (`FeatureChamfer.cpp:55`: 0 "Equal distance"/1 "Two distances"/2 "Distance and Angle", missing attribute defaults to 0) to `equal`/`twoDistances`/`distanceAngle`. `Angle` is persisted in **degrees** (`Chamfer::floatAngle = {0.0, 180.0}`). Explicit-baked fallbacks: `UseAllEdges=true`, non-`EdgeN` sub-elements, missing dependency, size ≤ 0, Angle outside `cad.chamfer`'s (0,90).

**IR/codegen**: `EdgeTopoRef` must be resolved against the **runtime** Base entity (role pairs are only known to the runtime naming layer), so it cannot be baked as a literal at translation time. For this `CadCall` gains a `JsExpr` marker (`jsExpr()`/`isJsExpr()`), and `codegen.ts`'s `renderValue` emits marked values element-by-element verbatim while everything else stays `JSON.stringify` (existing product bytes unchanged).

## Alternatives considered

- **Make `EdgeTopoRef.faces` nullable (pure-geometry anchors)**: requires touching the core types, `captureTopoRef`, `resolve-edge`, and fillet/chamfer validation in four places, and promotes "geometry-only references" to first-class citizens; this change reaches the same goal without touching the core reference system.
- **Compute edge geometry hints from Base's `.brp` at translation time and bake them into `.fai.js`**: still needs `faces` (translation time cannot know runtime roles), and turns the translation pipeline async + dependent on the occt-wasm kernel.
- **Let `cad.fillet`/`cad.chamfer` accept ordinals directly**: changes the ops' public parameter contract by pushing ordinal semantics into platform ops; a separate query function is more reusable (UI can use it too).
- **Fall back to geometry hints (`edgeHintScore`) without resolving role pairs**: `resolve-edge.ts`'s hint-only path is only enabled when `faceEdgeAdjacency` is missing (mesh); it does not apply at a BREP site.

## Verification

- `packages/core/src/fcstd/feature-translate.test.ts`: Fillet/Chamfer translation + 9 fallback branches.
- `packages/core/src/fcstd/codegen.test.ts`: `JsExpr` renders as `cad.edgeRef(part0, 17)` without a `"__jsExpr"` key; unmarked array args stay byte-identical.
- `packages/tests/faijs/edge-ref/edge-ref.test.ts` (real OCCT): any edge of a 20³ centred box `chamfer(equal, width=1)` faces 6→7, removes volume 10; `fillet(radius=2)` removes `(1−π/4)·r²·L`; two-edge chamfer faces 8; out-of-range and invalid ordinals → `failedAt.code === 'E_TOPO_NOT_FOUND'`.
- **Unverified**: the per-edge correspondence between `EdgeN` and faijs edge enumeration on a **real FCStd translated product** has not been checked end-to-end (needs the full FCStd → `.fai.zip` → execute chain); listed as a V6 geometry-fidelity follow-up.

## Verification & gotcha records (2026-09-16 addendum)

Per AGENTS.md's "verification & gotcha archiving rules", the key verifications and API gotchas are fixed as three regression test files (`packages/core/src/fcstd/`, 40 tests total, all green):

- `api-gotchas.test.ts`: planegcs `difference` reversed semantics (param2−param1), signed DistanceX/Y, fflate `zipSync` string-value stack overflow (must `strToU8`), solver coordinate read-back via `sketch_index.get_primitive` not `get_gcs_params`.
- `format-gotchas.test.ts`: GeoUndef(-2000) placeholder ≠ external geometry, `<UID>/<Construction>/<GeoExtensions>` wrapper elements, old-format Pad profile property name `Sketch`, ObjectData without a type attribute requires cross-checking the `<Objects>` index.
- `external-geo.test.ts`: the wireframe edgeGroups[k] ↔ FreeCAD `Edge(k+1)` ordinal contract (IndexedMap enumeration order), external edge projection to sketch-local z≈0, PointOnObject solve convergence L0. **Note**: the file depends on a local FreeCAD sample library (`D:/Faicad/FreeCAD/...`); when samples are missing `describe.skipIf` skips automatically, so CI stays green without samples.
- `packages/tests/faijs/edge-ref/edge-ref.test.ts`: `cad.edgeRef` ordinal → `EdgeTopoRef` → fillet/chamfer end-to-end (real OCCT, volume/face-count numeric assertions + out-of-range errors).

One **new gotcha** (2026-09-16 M6.1): naming-layer resolution failures put the error code in the `TopoRefError.code` field with prose-only message, so `.fai.js`-side assertions must read `ExecutionResult.failedAt.code`; matching `E_TOPO_*` with a message regex fails (`runtime.ts`'s `directFailedAtOrThrow` explicitly lifts the code to `.code`).

One-off dbg/repro scripts are deleted; reusable scripts kept: `scan-fcstd-samples.ts` (M1 full scan) and `validate-sketch-solve.ts` (V2 full-sample solve verification).
