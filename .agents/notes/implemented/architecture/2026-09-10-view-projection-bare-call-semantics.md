# Agent Note: faijs view projection ops and bare-call dual semantics

Status: implemented

English | [中文](2026-09-10-view-projection-bare-call-semantics.zh.md)

## Problem

1. faijs scripts cannot produce engineering drawings (three views / isometric) or screenshots of a model. The vendored OCCT kernel provides the projection machinery (`projectEdges` / `cameraFns` / `Drawing.toSVG`), but `projectEdges` was skipped from the arg-spec registration (edge-handle arrays and compound lifetimes do not fit faijs's single-product adoption model), and nothing in the repo consumed the projection path.
2. A pre-existing convention said measurement/screenshot calls must not consume a shape, letting it stay live on the canvas. `computeLiveShapes` C3 enforced this for assigned calls that return non-geometry, but a bare call without assignment (`projectView(part, 'front')`) went through C5 (positional top-level var-ref) and consumed `part` — violating the convention.
3. Conversely, modification-class ops called bare (`fai_drill(part0)`) silently discarded their result: `transformExpressionStatement` emitted `await <call>` with `writes=[]`, so the drilled shape vanished.

## Decision

### View projection surface (path A + path B)

- New `api/view/` module with three script-face functions, registered in arg-spec as a new `kind: 'faijs'` (hand-written library functions, not compatOp/dual-op products):
  - `viewCamera(view)` — pure-data camera spec (direction + optional xAxis); iso direction is `(1,-1,1)` normalized; unknown view names throw.
  - `projectView(part, view, opts?)` — BREP-only engineering linework: borrows the OCCT handle, runs `drawProjection` (HLR), renders `Drawing.toSVGPaths` into a hand-assembled SVG (visible solid strokes + hidden `stroke-dasharray`), returns the SVG string. Pure data — never modifies the input shape.
  - `projectSheet(part, views, opts?)` — grid layout of several views into one SVG with per-cell labels.
- Mesh/SDF shapes have no BREP handle: `projectView` throws `E_BREP_ONLY_INPUT`. The 3D editor renders those via `viewCamera` camera parameters + its existing `takeScreenshot` (three.js `canvas.toDataURL`), which is the only channel for mesh/SDF shapes (path B).

### Execution semantics: bare calls (rule 1 + rule 2)

- Rule 1 (`live-shapes.ts` C4): a line without assignment (`hasAssignment === false`) never consumes shapes, regardless of whether the call is read-only or self-assigning. Inserted before C5 in `lineConsumes`.
- Rule 2 (`direct-executor.ts`): a bare call's result is classified at runtime by return value — read-only queries (return pure data, e.g. `bboxCenter`) pass through unwritten; modification ops (return geometry with a geometry first argument) write back to the first shape-position argument; member-method calls write back to the receiver. A static pass (`writebackTarget`) picks the candidate target; the emitted code guards the write with `__isGeom(__r) && __isGeom(__ctx.<target>)`, so non-geometry returns never overwrite.
- Producer precision: the executed line of an in-place write is recorded (`DirectExecutor.inplaceWrites`, line → target name) and fed to `computeLiveShapes` so a consumption before the bare call (of the old value) cannot kill the new value's terminal status, and a real consumption after the bare call still does.

## Implementation

- `api/view/` (view-camera.ts / view-projection.ts / view-sheet.ts / index.ts); arg-spec gains `'faijs'` kind + 3 entries; `gen-l3-surface.ts` gained a `renderFaijs` branch (re-export to `api/view/`) and skips baseline checks for `'faijs'`; generator re-run wrote `generated/view.ts`, updated `script-face.ts` + manifest.
- `symbol-table.generated.ts` re-generated (covers the 3 new cad keys).
- `live-shapes.ts`: `inplaceWrites?` input, C4 rule, last-producer anchoring by line.
- `direct-executor.ts`: `isGeomValue`, `writebackTarget`, bare-call writeback codegen, `__isGeom` third runtime parameter, `inplaceWrites` recording + accessor.
- `module-registry.ts` / `runtime.ts`: thread `getInplaceWrites()` into `computeLiveShapes` for module and direct execution.

## Alternatives considered

- **Forbid bare calls (syntax error).** Rejected by the user: bare calls are a legitimate script style; the fix must preserve them with correct semantics.
- **Metadata-extractor static projection of outputs** for producer precision. Rejected: a read-only bare call would move the producer forward and wrongly cancel consumption of the value that the read actually observed; only runtime registration of actual in-place writes is precise.
- **Route mesh/SDF through the same SVG path.** Rejected: projection requires a BREP handle; mesh-only shapes take path B (editor screenshot).

## Consequences

- `projectView` / `projectSheet` return SVG strings (pure data); bare `projectView(part, 'front')` leaves `part` live on the canvas (rule 1).
- Bare `fai_drill(part0)` now writes the drilled result back into `part0` (rule 2), identical to `part0 = fai_drill(part0, …)` — verified by fingerprint equality tests.
- `ExecutionAnchor.outputs` for a bare writeback line becomes `[target]` instead of `[]`; the four `getCurrentStmt()?.outputs[0]` readers inside library bodies (primitives/chamfer/boolean/fillet) now see the writeback target name, which matches the variable that receives the new value.
- Editor generators (3d_editor `engine/script-engine`) that emit bare calls inherit rule 2 automatically; their output-name logic was audited, no change required.
- Tests: `api/view/view.test.ts` (16), live-shapes C4/inplaceWrites (6 added), direct-executor bare-writeback (7 added), a14 parity +2 static/runtime cross-checks; core full suite and integration suite green.
