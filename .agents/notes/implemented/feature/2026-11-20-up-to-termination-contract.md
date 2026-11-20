# Agent Note: unified up-to termination contract for additive and subtractive ops

Status: implemented

English | [中文](2026-11-20-up-to-termination-contract.zh.md)

## Problem

Face-driven stop conditions existed only on `cad.extrude`. `cad.drill`, `cad.pocket`, `cad.punchHole` and `cad.fai_drill` required a hand-computed numeric depth, so a drawing-driven workflow could not say "drill until this face" without measuring first. The truncation algorithm lived inside the extrusion op, which meant any second consumer would have to copy its half-space clipping, plane orientation and failure cases. CadQuery-style `until` / `combine: 'cut'` behaviour had no counterpart.

## Decision

Put the termination contract in one module, `packages/core/src/api/up-to.ts`, and have every consumer delegate to it.

- `normalizeUpToTarget` accepts a picked face reference, `'first'` / `'last'` / `'next'`, a CadQuery selector string, an explicit `{ plane: { point, normal } }`, or a numeric length. `resolveUpToPlane` turns any non-length target into one `CutPlane`; `clipByUpToPlane` and `trimToPlane` clip a long solid or cutter against the target half-space.
- The five ops — `extrude`, `drill`, `pocket`, `punchHole`, `fai_drill` — share the target grammar, `baseFeature` and `offset`, and the same `E_UP_TO_*` failures. Subtractive ops that already had a reliable depth path (`pocket`, `punchHole`, `fai_drill`) resolve `upTo` into a concrete depth at the op boundary and reuse that path, including draft walls and PMI. `cad.drill` builds an overlong cylindrical cutter, trims it and subtracts it.
- `extrude` also accepts `combine: 'cut'` (extrusion used as a cutter) and `backwardUpTo` (bidirectional stop). `upTo` is mutually exclusive with each op's fixed-length parameter; `backwardUpTo` is mutually exclusive with `backwardLength` and `mode: 'backward'`.
- `next` selects the closest face by projecting face centres along the machining direction with a normal-angle filter. The BREP kernel has no ray-face intersection, so this is an approximation and is documented as such.
- BREP only. The mesh execution chain is frozen; a mesh-only input with `upTo` is rejected explicitly instead of producing partial geometry.

## Alternatives considered

- **A Workplane-style chain** (`select face → extrude/drill until it`) would match CadQuery's surface workflow, but it adds a new statement model and is out of scope for a parameter-level extension. Deferred.
- **Per-op implementations of plane clipping.** Rejected: it duplicates the half-space orientation rules and the four failure cases, and drifts as soon as one op is fixed.
- **Exact ray-face intersection for `next`.** Rejected for this change: it needs a new BREP kernel capability; the projection approximation is sufficient for planar targets and its boundary is stated explicitly.
- **New names `until` / `toFace`.** Rejected: `extrude.upTo` is already a published parameter; a second vocabulary would increase migration cost without adding semantics.
- **Implementing `upTo` on the frozen mesh chain.** Rejected by the standing BREP-only rule; new capability lands only on the supported chain.

## Consequences

- One grammar and one error vocabulary across five ops; `fai_drill.face` keeps its entry-face meaning and `upTo` alone controls the stop face.
- Fixed-depth behaviour is unchanged: every new test pins the no-`upTo` result alongside the face-driven result.
- The generated ops manual carries the new parameter tables and the standing contract documents the shared semantics, including the `next` precision boundary.
- API test coverage is enforced at real TypeScript call sites because script-string calls are invisible to the AST coverage gate.
