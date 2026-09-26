# Agent Note: FCStd open profiles are a capability gap, not a bug; B1 expression references landed

Status: implemented

English | [中文](2026-09-26-fcstd-open-profiles-and-expression-references.zh.md)

## Problem

After B2 (dependency edges) and A2 (extrusion role vocabulary) closed, a fresh 150-file corpus
sample (`packages/fcstd/scripts/sweep-gaps.ts 150 7`) reported `ok=117 gapped=33 failed=0` with a
top of the ledger dominated by two entries that sum to 105 of the ~180 gap records:

```
72  Part::Extrusion :: extrusion-missing-base
33  Sketcher::SketchObject :: sketch-solved-no-closed-loop
```

Both were attacked as bugs. Both turned out to be something else, and the measurements that
disproved the bug hypotheses are the useful output of this round.

**`extrusion-missing-base` is a cascade, not its own defect.** On
`Architectural Parts/Windows/Fixed/Double glazed window with shutters and simple.FCStd`,
`Extrude_Sketch094.Base = Sketch095` — the sketch that is itself `sketch-solved-no-closed-loop`.
The other sketch in that file (`Sketch094`) is translated; the Extrusion simply has nothing to
consume.

**`sketch-solved-no-closed-loop` is a true statement about the model.** Two hypotheses were
tested and rejected with measurement:

1. *Tolerance.* `contour.ts` chains endpoints with `JOIN_TOL = 1e-7` while `SKETCH_T1` (the
   solve-acceptance tolerance) is `1e-6`, so a sketch could pass the solver and still fail to
   chain. `probe-sketch-loop.ts` clusters every endpoint and reports the worst intra-cluster
   separation: **0.000e+0** on every failing sample. Endpoints coincide exactly; the tolerance
   is not the cause.
2. *Construction geometry pollution.* FreeCAD marks reference geometry with
   `<Construction value="1"/>` and never constrains it, so its stored coordinates are leftover
   garbage (`Sketch095` carries a construction line at `StartY = -16508.67` next to real arcs at
   y ≈ 1165). The parser discarded the flag and `extractContours` — whose doc comment promised
   "non-construction segments only" — filtered nothing. Fixed anyway (it is simply correct), but
   the corpus count went **33 → 33**. Zero effect.

What the profiles actually are: `Sketch095` is two semicircles of r=7 tangent at a single point
(centres (25,1172) and (25,1158)) — an open S-shaped wire. `Bathroom_cabinet_sink.FCStd`'s
`Sketch037`/`Sketch238`/`Sketch239`/`Sketch268` are single lines consumed as
`Part::FeaturePython` `PathArray.PathObject` (array paths), and `Sketch036`/`Sketch229` as
`Part::Sweep.Spine` and `Draft Clone2D.Objects`.

**Decisive evidence that these are surfaces, not solids.** `Extrude_Sketch094.Shape` freezes to
`PartShape3.brp`; read directly out of the archive it is `Sh 1 / Wi 2 / Fa 2 / Ed 7 / Ve 6` with
**no `So` record**. FreeCAD extruded the open wire into a shell despite `Solid=true`. There is no
solid to translate, so `cad.extrude` (which takes a face) cannot express it.

## Decision

Three changes landed; only the third moves the ledger.

1. **Parse and exclude construction geometry** (`sketch-parse.ts`, `contour.ts`).
   `SketchGeom` gained `construction: boolean`, `parseGeometryList` reads the sibling, and
   `extractContours` skips it in both the chaining pool and the self-closed-circle loop.
2. **A broken shape asset must not preempt a translatable type** (`feature-translate.ts`).
   A zero-byte or missing `.brp` was an unconditional early bake. FreeCAD routinely saves an
   empty shape cache for a feature folded into a Body — `RND_455_00194.fcstd` stores a zero-byte
   `PartShape69.brp` for `LinearPattern` and empty caches for 23 `PartDesign::Mirrored`
   features — so the fact says nothing about translatability. The check now applies only to types
   that fall through to `python-opaque` / `type-not-whitelisted`, which is the fall-through E4
   was written for. Measured effect: **0 files**, but `PartDesign::PolarPattern` now reports
   `polar-pattern-missing-source` (its real defect) instead of blaming a missing `.brp`.
3. **B1: resolve `Object.Property` and `Sketch.Constraints.<name>` references** (`expressions.ts`).
   Reference resolution knew only the Spreadsheet three-hop form. Added, in order: Spreadsheet
   alias (existing); `Sketch.Constraints.<name>` (named driving constraint —
   `-Sketch229.Constraints.Length / 2`, `Esboco_janela_fixa_persiana.Constraints.Largura_vao`);
   plain object property, which also reaches `App::VarSet` variables (they are
   `App::PropertyLength` properties, and `spreadsheetAliasValue` accepted only
   `Spreadsheet::Sheet`). A referenced object's own ExpressionEngine binding is followed, with a
   cycle guard. `Pad010.Length = Pad_MountingPadEdge.Length` now translates.
   Measured: `pad-length-expression-non-constant` **10 → 0**, `pocket-missing-dependency` 7 → 6.

## Alternatives considered

- **Widen `JOIN_TOL` to `SKETCH_T1`.** Rejected: measured `worstIntraCluster` is exactly 0 on the
  failing samples, so it fixes nothing and only loosens the chainer.
- **Force-close open profiles** (join the two free ends). Rejected: it invents geometry. The
  frozen BREP proves FreeCAD produced a shell; emitting a solid would be a silent fidelity lie,
  which the plan forbids ("真差异显式留 reason").
- **Treat an open sketch as `preserved-only` so it stops cascading.** Rejected: it would hide the
  fact that the feature built on it has no geometry, which is exactly what `extrusion-missing-base`
  is supposed to report.
- **Make `PartDesign::Mirrored` translatable now.** Deferred: it is absent from the whitelist and
  has no branch, and its `MirrorPlane` is a `LinkSub` to `Sketch002.V_Axis` — a sketch axis, not a
  datum plane. The correct mirror plane for that sub-element shape is not established, and
  `Originals` is `count=0`, so guessing would risk wrong geometry. It stays an honest gap.
- **Let pattern features with empty `Originals` fall back to `BODY_CHAIN_BASE`.** Deferred: with
  `Originals` empty the FreeCAD semantics are "the whole accumulated body", and codegen currently
  unions every non-subtractive feature onto the Body chain — unioning the pattern result onto the
  chain head that it already contains would double-count. Wrong geometry is worse than an honest
  `polar-pattern-missing-source`.

## Consequences

- The corpus sample is unchanged at the file level: **117/150 ok, 33 gapped, 0 failed**. No
  regression, and the sort still drops nothing (`feature-translation-pending` canary = 0).
- The two largest gap classes are now known to be **capability gaps, not defects**: translating
  them needs a wire/path representation (open sketch → path) and, for `Part::Extrusion` on an
  open wire, surface output. That is C-class work, not a quick fix.
- Remaining honest gap classes on the sample: `compound-missing-members`,
  `multifuse-missing-dependency`, `cut-missing-dependency`, `delta-exceeds-t1`,
  `fillet-missing-base`, `polar-pattern-missing-source`, plus `PartDesign::Mirrored` (23, no
  translator at all).
- Regression guards: `packages/fcstd/src/construction-geometry-gotcha.test.ts`,
  `packages/fcstd/src/expressions-object-ref-gotcha.test.ts` (incl. a reference-cycle case), and
  two cases in `feature-translate.test.ts`.
- Probes kept per repo policy: `probe-sketch-loop.ts`, `probe-shape-asset.ts`, `probe-b1-expr.ts`.
