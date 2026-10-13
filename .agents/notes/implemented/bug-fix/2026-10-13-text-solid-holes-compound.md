# textToSolid: holes preserved via addHolesInFace, glyphs combined via makeCompound

English | [中文](2026-10-13-text-solid-holes-compound.zh.md)

**Date**: 2026-10-13
**Status**: implemented

## Problem

`textToSolid` (`packages/core/src/brep/text/text-to-solid.ts`) extruded every
closed contour as an independent solid and then fused them one by one:

- **Correctness**: a holed glyph (`o`, `A`, `O`) is drawn as outer contour +
  inner contour; fusing outer-solid ∪ inner-solid yields a **solid** glyph — the
  hole is filled in. The BREP path disagreed with the mesh path, which classifies
  contours with evenodd semantics and keeps the hole.
- **Performance**: fuse count = contour count. `Hello` ≈ 8-12 contours ⇒ 7-11
  OCCT boolean fusions; a single `cad.text('Hello', 20, 5)` took ~3.5 s in a
  node probe (and ~10 s on a real WeChat mini-program worker).

## Decision

Rewrite the assembly in `textToSolid`:

1. `textBlueprintsDetailed` (new) returns each contour's wire **plus sampled
   points** (lines' endpoints, quadratics/cubics sampled at `CURVE_SAMPLES`=8),
   so contours can be classified; `textBlueprints` keeps its `BrepHandle[]`
   signature (existing callers/tests unchanged).
2. Classify contours with the shared `classifyNested`
   (`primitives/svg/svg-path.ts`, the same evenodd engine svg-to-solid uses):
   outer contour + its holes.
3. Per group: `makeFace(outer)` → `addHolesInFace(face, holes)` → `extrude` ⇒
   hollow solid (correct holes).
4. Groups are combined with `makeCompound` — glyphs sit side by side and never
   overlap, so a compound is semantically right and costs zero booleans
   (single group ⇒ return the solid as-is).

## Consequences

- `Hello` probe: **3561 ms → 97 ms** (~36×); `你好` (degraded to `??`):
  **1504 ms → 44 ms**. Real-device 10 s-class delay drops to sub-second.
- `o`/`A`/`O` are hollow (volume = (outer area − hole areas) × depth, pinned by
  test); `Hello` returns a COMPOUND of 5 solids; `i` is a COMPOUND of 2 (dot +
  stem), matching the mesh path.
- `svgToSolid` still fuses its solids one by one (same slowness class); it was
  out of scope here — flag for a future sweep.
- New public export `textBlueprintsDetailed` is referenced by tests
  (API-coverage gate satisfied).

## Verification

- `packages/core/test/brep/text/text-to-solid.test.ts`: 14 tests green —
  hollow-volume for `o`/`A`/`O`, COMPOUND member counts for `Hello`(5)/`i`(2),
  `AB` compatibility, existing y-flip/STEP/validity cases.
- `packages/faijs-extra/test` + core svg/text suites: 150 passed, 1 pre-existing
  failure in `entry-boundary.test.ts` ("does reach the three/examples SVG
  loader") — faijs-extra sources no longer import `three/examples` anywhere;
  unrelated to this change.
- faijs root `tsc --noEmit` green; family version bumped 0.33.2 → 0.33.3
  (`set-version`, `check-lockstep` OK), `npm run pack` 8/8 tarballs; 3d_editor
  `update-faijs` verified OK, weapp worker rebuilt (1362.8 KB raw / 362.5 KB br),
  probe exit 0, audit/check:free/test:sim green.

## Follow-up (2026-10-13, afternoon): brepkit compound transform fix (real-device "only one glyph left" regression)

User hit on a real device: `Hello` ends up with only the last `o`; different words
lose different letters. The user pointed the investigation in the right direction:
"faijs tests run occt — you should also test the brepkit2 engine on the faijs side."
The regression passed everywhere on occt; the real device / weapp worker actually
runs the **brepkit2** kernel.

### Repro (brepkit unit test, kept as regression guard)

New `packages/core/test/brep/text/text-brepkit-repro.test.ts`
(`describe.skipIf(!brepkitAvailable)`, same infra as `brepkitKernel.test.ts`;
`setupTestFont()` is engine-agnostic and reusable). textBrep-identical chain
`textToSolid('Hello') → getBoundingBox → translate center → getSubShapes + meshShape`:

- `[repro] raw members = 5` (makeCompound correct) → `[repro] after translate
  members = 1` (members lost by translate — reproduced).

### Root cause (two layers)

1. **Direct**: the brepkit adapter `translate/transform/scale/located/locate`
   family goes through `cloneAndTransform(shape, matrix, kindOf(shape))` →
   `cloneShape` → `copySolid(compound)` + `transformSolid(...)` — brepkit's
   copySolid/transformSolid **accept solid handles only**; a compound is treated
   as a single solid and its members are silently dropped (only 1 survives).
2. **Deeper**: brepkit handles are namespaced **per shape type** (file-internal
   GOTCHA at line ~356), so the compound namespace and the solid namespace
   **reuse the same numbers** — measured: a compound of members `[0..4]` gets
   kernel handle 0, colliding with member solid 0. `knownCompounds` keyed by the
   kernel handle misclassifies a same-numbered solid as a compound (and
   conversely, `translate(compound)`'s `copySolid(0)` copied member solid 0).
   3MF/importStep multi-solid compounds share the same ambiguity; earlier query
   paths just never triggered it.

### Fix (structural, not a patch)

`brepkitKernel.ts`:

1. New `compoundOf(kids)` helper (one shared dispatch used by both the
   `makeCompound` adapter and `cloneAndTransform`'s compound branch): **always**
   returns a virtual handle (`0x20000000+`, clear of the type-tag bits 26..28 and
   of the kernel shape-handle space); `kernel.makeCompound` is called only for
   all-solid members and its real handle is recorded in `kernelCompoundHandles`
   (virtual→real map, used only by IO such as exportStep); face/wire/edge-mixed
   members never touch the kernel.
2. `cloneAndTransform` gains a compound branch: when `knownCompounds.get(shape)`
   hits, deep-copy + transform **each member** and rebuild via `compoundOf`
   (member types are dispatched by the knownFaces/knownWires sets, so recursion
   passes the default kind).
3. `exportStep` maps virtual compounds back to the real kernel handle (the
   kernel does not understand virtual handles).
4. `importStep` multi-solid now goes through `compoundOf` too (same
   collision ambiguity, converged to one place).

### Verification

- brepkit repro: `'Hello'` keeps 5 members after translate ✓, `'o'` hollow-volume
  ✓ (2/2); occt 14 cases unaffected (16/16 green).
- brepkit full regression: 106 passed / 4 failed — the 4 failures (drill blind
  hole isValid, fillet isValid, two importStl cases) were re-run against the
  HEAD version via `git checkout` and **fail identically (pre-existing)**;
  unrelated to this change; after restoring the fix the 106-pass baseline matches.
- faijs root `tsc --noEmit` green; family version bumped 0.33.3 → 0.33.4
  (`set-version`, `check-lockstep` OK), `npm run pack` 8/8 tarballs; 3d_editor
  `update-faijs` (4 packages stale → `--fix-stale`) verified OK; weapp worker
  rebuilt (1362.9 KB raw / 362.5 KB br).
- Probe gained a Hello mesh-integrity check (X-bbox criterion; the old bug left
  only ~1 glyph wide): **triangles=8584, xwidth=45.1mm** (all 5 glyphs present);
  text EN 633ms / CN 973ms (sub-second).
- 3d_editor `npx vitest run packages/weapp/src packages/platform/src`: 65 files /
  976 tests green; audit (main 1.55MB / sub 1.01MB), check:free, test:sim green.

### Remaining

- Pre-existing faijs failure `entry-boundary.test.ts` (three/examples assertion
  is stale) is still red, unrelated (pack-rebuilt dist stays red — proof).
- The 4 pre-existing brepkit failures (drill/fillet/importStl isValid criteria)
  are out of scope here; track separately.
