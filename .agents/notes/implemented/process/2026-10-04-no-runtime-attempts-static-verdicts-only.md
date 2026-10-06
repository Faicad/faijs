# No runtime attempts: static verdicts only (fcstd port iron rule)

English | [中文](2026-10-04-no-runtime-attempts-static-verdicts-only.zh.md)

- **Date**: 2026-10-04
- **Status**: implemented (iron rule reaffirmed after a violation)
- **Class**: process / architecture
- **Scope**: `packages/faijs-freecad`, fcstd port pipeline

## The rule (verbatim from the user)

> 本项目绝对不允许任何的运行期尝试，运行期修补 try/catch。必须全部都是静态提前就应该知道结果的。静态判断能过，而运行期失败的，就是严重 bug。

This restates the existing project red line ("BREP/mesh 路径判定红线：静态规则，禁止运行时回退") at a higher level of generality: it applies to the whole fcstd conversion pipeline, not just backend dispatch.

## The violation (what happened, 2026-10-04)

The parameterized `cad.sketch` emission path had a lossy stage: constraint
projection (`fromFreeCadConstraints`) silently DROPPED constraints it could
not map (axis refs, external-geometry refs) and the pipeline kept going —
emitting a `cad.sketch` that was missing part of its own constraint set.
At run time the re-solve then sometimes failed to reproduce the closed
profile (`E_SKETCHC_NO_CONTOUR`, 67 files).

Instead of fixing the root cause, three rounds of mitigation were layered on
top of the defective emission:

1. a convert-time zero-loop bake gate (reverted: 2 e2e regressions);
2. commit `5ecb7f94` — a constraint-topology closed-loop discriminator
   (`sketch-loop-topology.ts`) plus a bake gate;
3. a `closureUnobservable` flag to keep the gate from deciding on data the
   projection had blinded itself to.

All three treat the symptom ("will the run-time blow up?") instead of the
cause (a sketch with dropped constraints must never be emitted at all).
Verdict: wrong direction. The discriminator's unit tests document real
`extractContours` chaining semantics and stay useful as reference, but the
gate built on "emit anyway, predict the crash" is to be replaced.

## The correct rule

- A sketch whose constraints do not FULLY project (unmapped non-empty, or
  external geometry present) → immediate explicit gap. No parametric
  emission, no run-time re-solve, no run-time failure. The gap reason names
  the cause (e.g. `constraint-projection-incomplete`).
- A sketch that passes static checks must not fail at run time. Any such
  failure is a severe bug: the static check is wrong or incomplete.
- Geometry-only fallbacks (baking FreeCAD's solved落盘 geometry) are fine —
  they are static decisions made at convert time, not run-time attempts.

## Consequences / follow-ups

- Replace the `5ecb7f94` emission gate with the unmapped→gap rule; delete
  `closureUnobservable` (it only served the defective premise).
- Re-run batch conversion and reconcile the NO_CONTOUR bucket: those files
  must become convert-time gaps, not run-fails.
- When reviewing any future porting feature, ask exactly one question first:
  "is every outcome decided statically before the emitted code runs?"
