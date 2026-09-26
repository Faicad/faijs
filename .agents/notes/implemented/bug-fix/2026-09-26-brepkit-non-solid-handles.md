# Agent Note: brepkit non-solid handle support (wire/face/compound)

Status: implemented

English | [中文](2026-09-26-brepkit-non-solid-handles.zh.md)

## Problem

On the brepkit engine, any op producing non-solid geometry (wire/profile/sectionByPlane/extrude/revolve/sew/sewAndSolidify/removeHolesFromFace) crashed with `invalid solid handle: index N out of bounds`. Root cause: the op layer uniformly calls `solidToShape()` → `kernel.meshShape(handle)` → brepkit `tessellateSolidGrouped()`, which is solid-only. Passing a wire/face handle threw.

## Decision

All fixes live in the adapter (`packages/core/src/brepkit-kernel/brepkitKernel.ts`); op-layer logic is untouched except `extrude.ts` (brepkit length path goes straight to `kernel.extrude(face, vx,vy,vz)`, mirroring `revolve`).

Three GOTCHAs discovered and encoded:

1. **Per-type handle namespaces.** brepkit solid/face/wire/edge handles each count from 0 independently (verified: edge=wire=face=solid=0 coexist). A bare number `N` is type-ambiguous, and numbers collide across types.
2. **`markSolid(h)` helper.** Every solid-producing op (`makeBox/makeSphere/.../extrude/revolveVec/fuse/cut/common/sewAndSolidify/split`, plus `cloneShape`'s `copySolid` fallback) calls `markSolid(h)`, which deletes `h` from `knownFaces/knownWires/knownEdges/knownCompounds/derivedFaces`. This lets a new solid whose number reuses an old face/wire number fall back to the default solid path.
3. **`derivedFaces` vs `knownFaces`.** `getSolidFaces(solid)` returns GLOBAL face indices (0..5, 6..11, ...) that collide with solid handles. Registering them in `knownFaces` made later solids mis-tessellate as faces (union bbox went to [0,0,0]). Fix: enumerated sub-faces go into a separate `derivedFaces` set that `getSubShapes` edge/vertex drilling consults, but `meshShape`/`getBoundingBox` do NOT. Explicitly created faces (`makeFace`/`sectionByPlane`/`addHoles`/`removeHoles`) stay in `knownFaces`.

`meshShape`/`getBoundingBox` dispatch: `knownFaces`→`tessellateFace(...).positions`; `knownWires`→`getWireEdges`+`tessellateEdge` per edge; `knownEdges`→`tessellateEdge`; `knownCompounds` (virtual handles `0x80000000+counter`, because brepkit `makeCompound` only accepts solids)→merge child bboxes/meshes; otherwise solid path.

## Alternatives considered

- Returning empty mesh for non-solid handles (degraded): rejected — wire/profile need visible geometry; the brepkit-wasm non-solid tessellation APIs (`tessellateFace`/`tessellateEdge`/`getWireEdges`/`getFaceEdges`) exist and work.
- Tagging handles with type prefixes: rejected — the kernel expects raw numbers; would require op-layer changes.

## Consequences

- 9 ops no longer crash on brepkit. Regression test `brepkit-non-solid-fix.test.ts` (10/10).
- Parity `multi-engine-op-parity.test.ts`: mismatches=0 across brepkit 2.129.15/3.4.18/4.0.32.
- **Honest degradation**: `revolve` produces a ~2% bbox difference (tessellation angular deflection vs occt exact) — registered in `KNOWN_BREPKIT_GAPS` with reason. The op itself does not crash and accepts face input.
- Pre-existing gaps unchanged: intersect/chamfer/loft/screw/draft/thicken/knurl/sdf (24 error combos = 8 ops × 3 versions).
- `getBoundingBox` for faces samples `tessellateFace(...).positions` (GOTCHA: `tessellateFace` returns a JsMesh object, not a flat array — passing the whole object to `arr()` silently yields empty bbox).

## D-batch extension (fillet/filletVariable)

The C-batch `getSubShapes` fix made fillet pass in a standalone probe, but it still failed in the full parity sequence — further root cause: `markSolid` did not delete the handle from `derivedFaces`. When a box solid handle collides with a previously derived face handle number, `getSubShapes(solid,'edge')` wrongly takes the `getFaceEdges` branch (returning 4 edges instead of a box's 12), so edgeRef cannot find adjacent faces.

Fix: `markSolid` now also deletes from `derivedFaces`. Also fixed virtual-compound `getSubShapes(c,'solid')` — the compound branch previously handled only 'face' and returned [] for 'solid'; it now returns the compound kids that are solids.

After the fix, fillet/filletVariable pass on all four engines and are removed from `KNOWN_BREPKIT_GAPS`.
