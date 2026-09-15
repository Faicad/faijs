# Agent Note: fai_cq_warehouse W9 — P1-a Chain + P1-b hole series

Status: implemented

English | [中文](2026-09-15-fai-cq-warehouse-w9-p1-chain-holes.zh.md)

## Problem

W8 closed the P0 port with two P1 items explicitly deferred: the hole-series functions (upstream `Workplane.clearanceHole` / `tapHole` / `threadedHole` / `insertHole` / `pressFitHole` / `fastenerHole` / `pushFastenerLocations`, monkey-patched onto Workplane in `extensions.py:865–1363`) and the `Chain` transmission assembly (`chain.py`, multi-sprocket roller chain). W4 had also left a temporary hole-cutter (`recess.ts` `Temp*`) behind for `BradTeeNut`, marked for replacement once the hole-series landed.

## Decision

### Hole series (`src/holes.ts`, P1-b)

Functional API — the plan's red line forbids monkey-patching, so target solids and hole locations are explicit parameters instead of a Workplane stack. Seven entry points (`clearanceHole`, `tapHole`, `threadedHole`, `insertHole`, `pressFitHole`, `fastenerHole`, `pushFastenerLocations`) share one geometry core, `fastenerHoleCutter`: countersink revolve (profile shifted down by head_offset) ∪ shank cylinder ∪ 82° drill tip cone, matching `_fastenerHole` (extensions.py:865–1009). `depth=None` means through-cut via `bboxDiagonal(part)` (the `largestDimension()` equivalent). Threaded holes follow the upstream composition exactly: the internal `IsoThread(external=False)` is unioned back onto the part **after** the cut, not merged into the cutter (extensions.py:998–1005). Invalid fit/material keys throw with the upstream ValueError message shape.

`BradTeeNut` now calls `fastenerHoleCutter`; the `recess.ts` temporary cutter (`TempClearanceHoleCutterParams` / `tempClearanceHoleCutter`) is deleted, keeping only `tempCounterSunkCountersinkProfile` (still used for the countersink profile).

### Chain (`src/chain.ts`, P1-a)

Functional port of `chain.py`: pitch radii (reusing `sprocketPitchRadius`), entry/exit angles (`_calc_entry_exit_angles` four branches), arc/line segment interleaving, roller location sweep, per-link assembly. `buildChain` returns `{parts: {name, solid}[], pitchRadii, chainLength, chainLinks, numRollers, rollerLoc, spktInitialRotation}`; the `{name, solid}[]` parts feed the multi-product STEP exporter directly (product names `link0…`), and `placeSprocket` reproduces `assemble_chain_transmission`'s sprocket placement (`spktInitialRotation` = first-roller angle + 180/teeth). Scope: **planar chains only** (`spkt_normal` must be `(0,0,1)`); 2+ sprockets supported, non-planar/titled chains stay out and throw.

The link-plate dog-bone profile uses **8 exact three-point arcs** (`arcEdge`), each arc's midpoint computed from **its own** center (mirrored arcs use mirrored centers) — a sampled-polyline approximation was tried first and rejected: it silently dropped the plate from the fused link and would never pass STEP parity. Critical upstream semantic: `radiusArc((0, neck), -neck_r)` uses a **negative** radius = concave arc (the dog-bone waist); choosing the convex arc added ~6.94 mm² per plate, caught immediately by the A/B volume anchor below.

### A/B truth anchors

- Five-sprocket chain (32/10/10/10/16 teeth, upstream `sprocket_and_chain_tests.py:184`): roller count 87 and world-space roller coordinates matched to 1e-6 against upstream test truth.
- 16t/16t transmission (upstream run in cadquery-env): `chain_length = 1107.6348638400789`, 87 rollers; per-part volumes inner link 510.0012 mm³ (z-span 4.3812), outer link 279.0664 mm³ (z-span 7.0479) — all 35 links within 1%. The reference STEP from the upstream assembly is kept at `fixtures/reference/transmission-16t-16t.step` for future STEP-level parity work.

## Alternatives considered

- **Monkey-patch Workplane** (upstream style). Rejected: the port plan explicitly forbids it; functional form keeps the layering gate meaningful.
- **Sampled polyline for the link-plate profile.** Rejected after A/B: loses exact circle segments needed for STEP parity and the fuse silently degenerated.
- **Thread solid inside the hole cutter.** Rejected: upstream unions the thread back after cutting; merging it into the cutter changes the resulting solid.
- **Stub exports for Chain/hole-series in W8's index.** Rejected there, implemented now as real surface.

## Consequences

- `@faicad/fai-cq-warehouse` now exports `buildChain` / `makeLink` / `placeSprocket` and the seven hole-series functions; `Chain` and hole-series are no longer deferred items (W8 note updated accordingly).
- W4's temporary cutter is gone; `recess.ts` no longer duplicates `_fastenerHole` geometry.
- Non-planar chains (tilted `spkt_normal`, 3D chain planes) remain unimplemented and throw a clear error; upstream's full `chain_plane` support is future work.
- New files `holes.ts` / `chain.ts` pass `check-lib-layering.mjs` (kernel only via `requireKernel()`, no `as any`, no direct occt-wasm).

## Verification

- `src/holes.test.ts` 8/8 (diameter tables, ValueError parity, through-cut volume = π r² T, threaded > simple removal, countersink cutter heavier than plain);
- `src/chain.test.ts` 9/9 (five-sprocket roller truth 1e-6, closed-form two-sprocket length, param validation, A/B volumes 1%, per-part bbox spans to upstream formula);
- `src/nut.test.ts` regression after the BradTeeNut switch: green (STEP-equivalence fixtures unchanged);
- package `tsc --noEmit` clean (pre-existing cq-compat error excluded), `eslint src` clean, `check-lib-layering.mjs` OK;
- STEP smoke: 37-part transmission exported, product names `spkt0/spkt1/link0…link34` present.
