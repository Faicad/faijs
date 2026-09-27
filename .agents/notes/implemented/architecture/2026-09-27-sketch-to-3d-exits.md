# Agent Note: E5 — sketch-to-3D exits resolved declaratively

Status: implemented

English | [中文](2026-09-27-sketch-to-3d-exits.zh.md)

## Problem

The plan (E5) calls for a `Sketch`/`CompoundSketch` wrapper carrying a wire, a default origin/frame and a base face, with `extrude`/`revolve`/`sweepSketch`/`loftWith` 3D exports. brepjs ships exactly that as a *stateful* sketching DSL (`Sketch`/`Sketches`/`FaceSketcher`/`CompoundSketch` classes + `sketch*`/`compoundSketch*` functions), each instance holding kernel references and a sketch-plane. But `arg-spec` P14-batch-10 registers that entire layer as `kind: 'skip'`, with the stated rationale that faijs expresses modeling with declarative ops in the `cad` namespace, not a sketch state machine.

## Decision

E5 is resolved by the skip ruling already in `arg-spec`; it is delivered as a **validation** milestone, not a new `Sketch` class. The four 3D exits a stateful `Sketch` would offer are pinned as the declarative chain already in place:

- `cad.sketchOnPlane({contours, plane})` is the placement step (the "base face + default frame + wire");
- `cad.extrude` / `cad.revolve` / `cad.sweep` / `cad.loft` are the four 3D exits;
- `cad.punchHole` already covers the `CompoundSketch` "holes punched as separate solids" semantics.

`sketch-to-3d-e2e.test.ts` proves every exit yields a single positive-volume solid from one placed sketch: `extrude` (w·h·d), `revolve` (lathe volume), `sweep` (section along a wire spine), `loft` (two placed sections). No new op, no state machine, no kernel handle ownership to leak.

## GOTCHA worth recording

**The revolve axis must lie in the sketch plane.** Revolving an XY-plane sketch about the orthogonal Z-axis sweeps a region with `z=0` — a flat annulus/disk whose OCCT volume is 0 (bbox zmin=zmax=0). A volumetric lathe needs an *in-plane* axis (e.g. revolve an XY sketch about the Y axis, giving `π(R²−r²)·h`). The e2e asserts the exact `π(8²−4²)·4 ≈ 603` washer and keeps the bad-axis case as a documented avoid.

## Alternatives considered

- **Port a brepjs `Sketch`/`CompoundSketch` state machine.** Rejected: `arg-spec` P14 registers the whole stateful sketching DSL layer as `skip`; faijs expresses the same with declarative ops. Re-adding a kernel-holding scheduler would drag kernel-reference ownership and dispose-lifecycle back in.
- **Thin pure TS `Sketch` facade (no kernel/hold).** Rejected for E5 scope balance: the declarative ops already cover the capability; a new facade would mostly re-export them and add a second API surface to keep in sync.

## Consequences

- The four 3D exits of a placed sketch are individually pinned by `sketch-to-3d-e2e.test.ts` — a real gap in revolve coverage was closed (previously only profile-based revolve was verified, and never a placed sketch).
- The E5 plan item is marked "已落地（验证型）"; `arg-spec`'s skip decision stands unchanged.
- The `threemf-extrude-chain.test.ts` `Map.find` type error (pre-existing, skipped at runtime) was corrected to `outputs.get(asPartName(...))` so the core `tsc --noEmit` gate is clean again.