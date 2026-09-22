# Agent Note: occt-wasm kernel gap assessment for CadQuery parity

Status: implemented

English | [中文](2026-09-22-occt-wasm-kernel-gap-assessment.zh.md)

## Problem

The CadQuery parity manifest (`packages/cq-compat/tests/manifest.json`) lists
328 blocked cases. A large share is blocked on occt-wasm kernel capabilities
rather than on parser or API-surface gaps. The Phase 4 plan listed four suspect
kernel gaps (shell outward expansion, negative taper, sweep multisection,
high/tall ellipses) plus runtime-blocked shape edits (remove/replace) and fuzzy
booleans. Before filing upstream kernel requests, each gap needed a live
probe so the request list is grounded in fact, not assumption.

## Assessment (verified by probes, 2026-09-22)

- **Shell outward expansion with removed faces** — real gap. `kernel.shell`
  implements `MakeThickSolid` (remove faces + inward/outward offset). Inward
  walls (`shell(h, faces, -t)`) work and cq-compat routes them directly;
  closed outward shells (no removed faces, `MakeThickSolidByJoin`-style join)
  are approximated by offset-minus-original and verified. The combination
  *outward + removed faces* needs `MakeThickSolidByJoin`'s intersection-join
  mode which the kernel does not expose; cq-compat `shell()` throws loudly
  for it (testSimpleShell__s1/s3 blocked in tests/mark-blocked.ts).
- **Negative taper** — API exists but semantics uncalibrated.
  `kernel.draftPrism(shape, dx, dy, dz, angleDeg)` accepts a wire or a face;
  on a solid it errors ("Solids are not Processed"). Probe: `draftPrism(wire,
  0,0,10,-10)` returns a negative-volume result and `draftPrism(face)` returns
  1394 for a 10×10×10 prism (expected ≈1000 with taper), so the dx/dy/dz↔angle
  convention does not map to CadQuery's `LocOpe_DPrism` corner-taper semantics
  without calibration work. Medium priority; the calib is a follow-up probe.
  **RESOLVED 2026-09-23 (without kernel change):** cq-compat `extrude(taper<0)`
  now sews the exact 10-face arc-joined body (bottom + offset arc-join top +
  4 planar side faces + 4 conical corner faces via `sew`+`makeSolid`+
  `fixFaceOrientations`), passing `testTaperedExtrudeHeight__s2` with
  `equivalent=true`; `draftPrism` remains correct for the sharp-corner frustum
  and for circular profiles (no corners).
- **Sweep multisection** — real gap. `sweepPipeShell(profile, spine, freenet,
  smooth)` and `sweepOriented(... auxSpine ...)` exist and work for single
  profile + optional guide; neither takes multiple section wires, so
  `BRepOffsetAPI_MakePipeShell` multisection is unexposed. Medium priority.
- **Tall ellipse (major < minor)** — real gap, confirmed hard. Probes:
  `makeEllipseEdge(center, Z, 2, 4)` throws
  `gp_Elips() - invalid construction parameters`; the major axis is fixed to
  the global X direction. cq-compat `ellipse()` already works around the axis
  rule by rotating a wide ellipse 90° about the plane normal (verified against
  upstream testEdgeTypesFilter). Low priority.
- **Bonus findings (not actually gaps)** — `kernel.offsetWire2D(wire, d,
  joinType)` works (0.64 for rect 1×1 offset −0.1, matching upstream
  test_modes s5); face-level `fuse/cut/common` work on planar 2D faces (L-shape
  fuse = 3 faces, cut/common = 1 face), which underpins the Phase 2 Sketch
  modes; `removeHolesFromFace` exists for hole removal but `remove`/`replace`
  (BRepBuilderAPI_MakeShape shell/face surgery) and fuzzy booleans
  (`SetFuzzyValue`) remain unexposed — genuine gaps.

## Decision

- File upstream occt-wasm requests for: `MakeThickSolidByJoin` outward+join
  mode, `BRepOffsetAPI_MakePipeShell` multisection, shape `remove`/`replace`
  (BRepBuilderAPI_MakeShape), and fuzzy boolean tolerance. Keep the tall-ellipse
  workaround and the negative-taper calibration probe as follow-ups instead of
  blocking on them.
- Until then the manifest records each blocked case with its kernel reason
  (blockedBy = occt-wasm-kernel) so the gap list is one grep away.
- No runtime approximations are introduced for any of these; the existing
  loud-failure discipline (explicit throw, no silent baking) is preserved.

## Alternatives considered

- Simulate outward+join via cut-offset slabs (older cq-compat heuristic):
  rejected because the geometry did not match any upstream reference
  (see shell() comment), and silent approximation is against the parity rule.
- TS-side 2D boolean polygon clipping for Sketch modes: rejected — the kernel
  face-level booleans are exact and already verified.
- Port `BRepBuilderAPI_MakeShape` surgery into cq-compat by reimplementing on
  kernel primitives: rejected for now — risk is high and the coverage payoff is
  two test functions (test_remove / test_replace).

## Consequences

- The four plan items now carry measured status: 1 real+partial (shell), 1
  calibration (taper), 1 real (multisection), 1 real+workaround (tall ellipse).
- Phase 2 Sketch reuse: offsetWire2D and face booleans were verified here and
  consumed by `sketch.ts` in the Phase 2 commit.
- Manifest blocked reasons are kernel-grounded; the upstream request list is
  the diff between the 328 blocked reasons and the parser/Sketch/LGPL blockers.
