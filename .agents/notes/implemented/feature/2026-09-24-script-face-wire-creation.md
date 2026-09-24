# Agent Note: Script-face wire creation — the 1D `curve` shape and the `wire` / `helix` ops

Status: implemented

English | [中文](2026-09-24-script-face-wire-creation.zh.md)

## Problem

The `.fai.js` scripting face could not create a **wire** (a 1D curve). An audit of the whole surface found no op that outputs one: `sketch` builds a wire internally (`loopToWire`) but returns only the face; `line` / `circle` / `arc` / `bezier` / `wire` / `helix` / … are all `skip` in the arg-spec with the reason "→ Edge/Wire sub-shape, the faijs whole-shape face does not carry it". As a result an entire feature family — `sweep`, `complexExtrude`, `twistExtrude`, `roof`, `helix`, and seven more (11 actions) — was *registered but unfed*: their input side needs a wire, which the script could never produce.

Two model-layer gaps stood in the way: (1) there was no shape discriminant meaning "1D"; `ShapeKind` declared `'curve'` but nothing ever used it, and every constructor product claimed `kind:'solid'`. (2) The BREP-registration pipeline had a single entry, `fromBrep(mesh, holder)`, hard-wired to `solid(mesh)` — so even a correct 1D product would have been branded `'solid'` (a lie: the wire's triangle payload is empty, 0 positions / 0 indices, measured and non-throwing).

## Decision

1. **1D discriminant = `kind:'curve'`, keeping the "has a triangle payload" semantics.** `kind` is a payload-category tag, not a topological dimension. A 1D product therefore gets its own kind rather than being mislabelled `'solid'`. `CurveShape` is added to the `StdShape` union, and a structural `isCurveShape(v)` guard (same family as `isCompoundLike`, no `WeakSet` strictness) answers the only question this round needs: "is it 1D?".
2. **Registration pipeline generalised, not duplicated.** `fromBrep` is refactored to `solid(mesh)` + a new private `attachBrep(s, holder)` that owns the four registration steps (identity slot, lineage statement-key sidecar, function-BREP-domain registration). Two constructors now share it: `curve(mesh)` (mirrors `solid`) and `fromBrepCurve(mesh, holder)` (mirrors `fromBrep`). Both BREP and mesh paths flow through one code path, so the two forms cannot drift. On the mesh side, an op's implementation returns an already-wrapped `curve(mesh)`; `wrapMeshOne` short-circuits on `isShape`, so the kind survives without touching `define-op.ts`.
3. **New hand-written ops.** `wire(points, {closed?, smooth?})` is a **neutral** dual op: the mesh path returns a polyline payload wrapped by `curve(mesh)`; the brep path builds L1 edges (`makeLineEdge` / `interpolatePoints`) joined by `makeWire` and registers with `fromBrepCurve`. `helix({radius, pitch, turns, axis?, origin?})` is a **platform** op (`engines:['occt']`, no `capabilities` — D11-7 mutual exclusion): L1 has no helix constructor, occt-wasm has the native `makeHelixWire`, so the op declares its platform identity and lets the dispatcher reject non-occt engines before execution.
4. **`sketch` gains an output form.** `sketch({contours, as:'face'|'wire'})` reuses the existing `loopToWire` and hands back the outer contour as a 1D curve when `as:'wire'` (hole loops are dropped — a sweep spine is a single closed contour). Default remains a face.
5. **Face consumers reject 1D input before touching the kernel.** `extrude` pre-flights `isCurveShape(input)` and throws `E_EXTRUDE_NEEDS_FACE`. Feeding a wire to a face op must be a deterministic pre-kernel rejection, never a deep "extrusion operation failed" from inside the geometry kernel.
6. **Naming and display.** 1D ops declare `naming: {kind:'unmodeled'}` (a wire has no faces → no role table; precedent `torus` / `convexHull`). A 1D shape is a valid terminal product; its display feed is the L1 `wireframe(shape, deflection?)`, not a fake triangulation.

## Alternatives considered

- **Reclassify `kind` as a topological dimension (2D / 1D / 3D).** Rejected: a much larger model change, and this round needs exactly one bit — "is it 1D". The payload-category meaning is already the established one; widening it would force every existing reader to re-derive what it meant.
- **Keep `kind:'solid'` and add a separate dimension flag.** Rejected: two sources of truth for one fact, and `'solid'` is factually wrong for an empty-payload wire.
- **Make `wire` brep-only (no mesh implementation).** Rejected: the kind would then be unavailable (or ambiguous) in mesh mode, and the plan requires one `kind` regardless of mode. The dual impl with `curve(mesh)` is guarded by an explicit "same kind in both modes" test.
- **Detect a 1D input by a kernel topology query in every face op.** Rejected: expensive and scattered; the `kind` discriminant is a cheap static pre-flight, in the same spirit as the static BREP/mesh routing rule.
- **Rebuild wire geometry on the manifold (mesh) side.** Rejected: no mesh consumer of a wire exists downstream; a polyline payload is enough to keep the kind consistent, and duplicating curve construction would be a second implementation of one symbol.

## Consequences

- `cad.wire(...)`, `cad.helix({...})` and `cad.sketch({..., as:'wire'})` are reachable from `.fai.js`; they unblock the sweep / loft family (implemented in a later phase).
- A 1D shape is a real terminal product with an empty triangle payload. Display goes through `wireframe`; STL export is empty by construction, while the STEP path is BREP (occt writes a wire) — the two export paths differ by design and are not unified here.
- Feeding a 1D product to a face op fails at pre-flight with a named error, not inside the kernel.
- Three-source consistency holds: the symbol table was regenerated (`wire` / `helix` entered it) and a pre-existing gap was closed — `split` was present in the `cad` namespace but missing from the `api/index.ts` export surface.
- `helix`'s geometric contract is pinned by test: `radius` sets the XY envelope to ±radius; `pitch × turns` sets the axial height, measured from the origin along the axis (`origin` defaults to the origin, `axis` to +Z).

## Verification

- `packages/core/src/api/wire-helix.test.ts` (10 tests): `wire` reachability + `kind:'curve'`; kind identical across brep and mesh modes (with finite mesh payload — a regression guard against a tuple/field indexing bug that produced `NaN` positions); `E_WIRE_TOO_FEW_POINTS`; `wire → extrude` fails pre-kernel with `E_EXTRUDE_NEEDS_FACE` and is *not* `EXTRUDE_FAILED`; the L1 `wireframe` display feed yields a non-empty, finite point list; `helix` reachability + `kind:'curve'`; helix bbox pinning the radius / pitch / turns semantics; helix under `brepkit` fails before execution with "requires engine occt"; helix under `brep_mock` is not intercepted by the platform-identity check (D11-3 exemption); `sketch as:'wire'` yields `kind:'curve'`.
- Three-source consistency: `src/lang/op-set-consistency.test.ts` green after regeneration.
- Affected suites green: `op-set-consistency`, `sketch`, `extrude-upto`, `extrude-roles`, `wire-helix` (29 tests), plus the integration `faijs/p23-cad-face` and `faijs-extra` `cad-membership`.
- `tsc --noEmit` and `eslint` clean for the touched files.
