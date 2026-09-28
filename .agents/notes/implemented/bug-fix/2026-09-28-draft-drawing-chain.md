# Agent Note: the Draft drawing chain never actually ran

Status: implemented

English | [中文](2026-09-28-draft-drawing-chain.zh.md)

## Problem

Plan A4 translates FreeCAD Draft objects (`Part::Part2DObjectPython`) into
`cad.draw` sessions. The translation was written, the products converted, and
nobody had executed one. Running them (the only criterion this project accepts)
showed **11 of 15 converted drawings could not execute at all**, 10 with
`[parser] AST nesting depth exceeds 100`.

Three defects sat behind that, and the first two were hidden by "the code looks
reasonable". A fourth only became reachable — and visible — once those three were
fixed and the product could run far enough to fail differently:

1. **`wireframe().edgeGroups` is not a traversal order.** `extractDraftDrawing`
   / `renderDrawSession` chained *consecutive array entries* as if they were
   adjacent edges. The array is `TopExp::MapShapes` order over the whole shape.
   Measured on `Clone2D.Shape.brp` (one wire, 15 edges): only 3 of 14
   consecutive pairs share an endpoint, the rest sit up to **3.43 mm** apart.
   Every Draft wire was therefore shattered into per-edge fragments — across 8
   products, 145 objects were reported as **781 contours**, 95% of them
   "open", i.e. incapable of forming a face.
2. **The continuity epsilon was below the noise floor.** `wireframe()` returns a
   `Float32Array`; two independently tessellated edges that end on the same
   vertex can disagree by ~1 ulp — measured float32 step **6.1e-5** at
   |coord| ≈ 300. The old constant was `1e-6`, so the chain could not continue
   *even where the order was right*. Related: `closed` was tested per EDGE,
   which only ever fires for a full-circle edge — that is where the "95% open"
   number came from.
3. **The pen API was never called.** The emitted chain used `pen.moveTo(x, y)`
   and `pen.lineTo(x, y)`. `BaseSketcher2d` has no `moveTo` (it is
   `movePointerTo(point: Point2)`), `lineTo` takes a tuple, and `close()` is
   terminal. `cliCheck` passes such a product because it only does parse +
   schema preflight.
4. **The placement call declared no `inputs`.** `lower()` derives the root
   aggregate from `consumed = calls.flatMap(c => c.inputs)`. With `inputs: []`
   the per-contour variables looked unconsumed, so the root `cad.compound`
   swept the raw drawn `Blueprint`s (which carry no BREP handle) into its member
   list, and `Chair` died at
   `E_BREP_UNSUPPORTED: compound members are not all on the BREP chain`. Only
   execution could surface this: the emitted text is syntactically perfect.
   Adding `inputs` is not enough on its own — `renderArgs` renders `inputs`
   POSITIONALLY, which turned the call into `cad.sketchOnPlane(v0, v1, …)`;
   `cad.sketchOnPlane` is params-only, so it also needs `noPositionalArgs`
   (the same pairing `cad.compound` uses for `members`).

Plus a capability gap the plan assumed away: A4 says "draw → `sketchOnPlane` →
`extrude`", but **nothing could turn a `cad.draw` product into a Shape**.
`cad.draw` yields a pure-data 2D contour with no OCCT handle; measured,
`cad.extrude(drawn, dir)` fails with `E_BREP_INPUT: argument carries no BREP
handle` and `cad.sweep(drawn, …)` with `INVALID_SHAPE_ID`. There was no second
path either — no op in the repo accepted one.

## Decision

Four changes, each closing one of the above:

1. **`packages/fcstd/src/draft-draw.ts`** — rebuild contours from real
   topology: walk `getSubShapes(shape, 'wire')` (one contour per wire) and order
   each wire's edges by **endpoint matching** (`chainWireContours`), not array
   position. The match tolerance is derived from the data
   (`draftTolerance`: `1e-5 × coordinate magnitude`), which clears the float32
   worst case by ~25× and stays ~1000× under the millimetre gaps between
   genuinely distinct vertices. `closed` is now a property of the whole contour,
   and the walk restarts on any leftover edge rather than dropping it.
2. **`BaseSketcher2d.polyline(points, close)`** — draw a whole contour in one
   call. The AST depth cap makes this mandatory rather than convenient: a member
   chain nests one level per segment, and these contours carry hundreds to
   thousands of points (one object held a 7823-point loop).
3. **`toContourBlueprints`** (`api/profile.ts`) — `contours` now accepts a
   DRAWN contour (`Blueprint` or `Blueprint[]`) alongside the segment-loop data
   form; used by both `cad.profile` and `cad.sketchOnPlane`. This is the
   placement bridge A4 assumed existed. Mixing the two forms throws
   `E_PROFILE_MIXED_CONTOURS` instead of half-reading the array.
4. **`codegen.ts`** — one `cad.draw` per contour (a session is a single-run
   flood pen: `movePointerTo` refuses to lift once a curve exists, and one
   object was measured holding 61 loops), then one `cad.sketchOnPlane` whose
   `contours` are those drawn contours and whose `plane` is the object's own
   Placement. The placement call lists the contour variables in `inputs`
   (marking them consumed, so the root aggregate cannot pick them up) with
   `noPositionalArgs: true` (so they stay bookkeeping and the call still renders
   as `{ contours, plane }`). The object's own variable becomes the placed
   Shape, so every downstream use (`cad.sweep(Clone2D001, Clone2D002)`,
   `cad.extrude(Clone2D005, …)`) is unchanged.

## Measured effect

- `Kitchen_cabinet_base`, `Chair`, `Beds`, `Sideboard`, `Kitchen_cabinet_sink`,
  `Living_room_cabinet`, `Bedroom_closet`, `Bathroom_cabinet_sink`: contour
  reconstruction goes from `781` phantom contours (per-edge fragments) to one
  contour per wire,
  closed loops now detected as closed.
- The pen chain is one `polyline([…])` call per contour, so AST depth no longer
  depends on point count.
- `Chair` **executes end to end** (both `Shape2DView` objects translate as
  `draft-draw(17 contours)` each, and the product writes a STEP); the misplaced
  files that previously fell back to a dead `shape-asset` import now use the
  drawing chain.
- `draft-chain-e2e.test.ts` pins this on two corpus documents: for BOTH, the
  emitted source carries the drawing chain and the broken `pen.moveTo` /
  `pen.lineTo` forms are GONE (not merely superseded), and that no raw
  `…__draw` variable leaks into the root `cad.compound`; for `Chair` the product
  is executed and must produce a STEP.

## Known blockers (NOT this chain)

Found while running the corpus drawings end to end; recorded rather than fixed,
because neither is a Draft defect and both are pre-existing:

- **`cad.sweep` rejects FreeCAD's `Transition`.** `sweepFns.ts` deliberately
  returns `SWEEP_TRANSITION_UNSUPPORTED` for any `transitionMode !== 'right'`
  ("not supported after selfhosting (only 'right' default)"), while
  `feature-translate.ts` faithfully maps FreeCAD's `Transformed`/`Round` enum to
  `'transformed'`/`'round'`. `Kitchen_cabinet_base` therefore cannot run: its
  first sweep (`Sweep001`, whose inputs are two plain SKETCHES — not Draft
  objects) trips the guard. Fixing it means either re-plumbing the transition
  argument through the kernel call or having the converter surface a gap instead
  of emitting a mode the op knows it rejects — a design decision, so
  `draft-chain-e2e.test.ts` pins the current state with `it.fails` rather than
  pretending it passes.

## Alternatives considered

- **Emit `cad.profile` for Draft objects instead of `cad.draw`.** It works today
  and needs no new API — measured, the same polylines extrude. Rejected by the
  project owner: `cad.profile` is explicitly the dead, last-resort fallback,
  while a Draft object is a drawing. The capability gap ("a drawn contour cannot
  become a Shape") is answered by adding the capability, not by routing around it.
- **Chain the whole drawing in ONE `cad.draw` session with `moveTo` lifts.**
  Impossible by construction: `BaseSketcher2d` refuses to move the pointer once
  a curve exists. Verified by execution, not by reading.
- **One `cad.draw` per contour, combined with `cad.compound`.** Rejected:
  `cad.compound` is a 3D op requiring BREP handles from every member, and drawn
  contours have none — the same failure `cad.extrude` shows.
- **Keep an epsilon of `1e-6` / match on exact equality.** Rejected: below the
  float32 step at drawing scale, which is exactly why the original chain never
  continued.
- **Split a multi-contour `Blueprint` by curve continuity instead of emitting one
  session per contour.** Rejected: it infers contour boundaries from a heuristic
  when the topology is already available from `getSubShapes(…, 'wire')`.

## Consequences

- Draft objects now require the **`draw` library** to be registered in the
  consuming host. `@faicad/faijs-fcstd` already declares
  `@faicad/faijs-draw` as a runtime dependency; a `.fai.zip` consumer must merge
  `mergeDrawNamespace()` into the `cad` namespace, otherwise the product fails at
  the first contour with `cad.draw is not a function`. `manifest.json` still
  carries no library-requirement field — a host that only reads the manifest has
  no way to learn this; tracked separately.
- The old `renderDrawSession` name is gone; `DraftDrawing` now carries
  `contours` instead of `edges`.
- Contours are still a POLYLINE approximation of the source curves — the frozen
  `.brp` carries no construction data, so a Draft object cannot become a
  parametric sketch. That distinction is the reason it is `cad.draw` and not
  `cad.sketch`.

## Files

- `packages/fcstd/src/draft-draw.ts` — wire walk, tolerance, contour renderer.
- `packages/fcstd/src/draft-draw.test.ts` — walk/tolerance/render unit cases.
- `packages/fcstd/src/codegen.ts` — one `cad.draw` per contour + placement call.
- `packages/core/src/geometry2d/pen-sketcher.ts` — `polyline`.
- `packages/core/src/api/profile.ts` — `toContourBlueprints`, `DrawnContours`.
- `packages/core/src/api/sketch-on-plane.ts` — accepts drawn contours.
- `packages/fcstd/src/draft-chain-e2e.test.ts` — corpus e2e, executes the product
  (the sweep blocker pinned via `it.fails`).
- `packages/fcstd/scripts/probe-{draw-design,edge-continuity,wire-topology,edge-walk,contour-closure,emitted-source,stmt-window}.ts`
  — the measurement probes behind the root causes (and the tool for locating the
  statement a runtime failure names).
