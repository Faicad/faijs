# Agent Note: CadQuery parity harness — capture upstream test geometry via AST injection

Status: proposed

English | [中文](2026-09-08-cq-compat-cadquery-parity-harness.zh.md)

## Problem

`@faicad/cq-compat` has never been verified against upstream CadQuery. It was used directly to port
`packages/mini_lathe`, and a first measurement against real CadQuery output shows **all 7 parts differ**
(volume deltas 0.03%–1.8%; `slide_mid` even differs in solid count and bounding box by 3 mm). Root causes
already identified: selector index suffixes (`faces(">Z[-2]")`, `faces("-Y")[1]`) are silently stripped,
`cutBlind` ignores `pushPoints`, and `union` returns a compound.

CadQuery's own suite has no usable export hook for this purpose. `BaseTest.saveModel()` does write STEP,
but it is called in ~35% of `test_cadquery.py` cases and in **0%** of every other test file, so relying on
it would leave most cases without reference geometry.

## Proposal

Capture reference geometry with a pytest plugin that rewrites test modules **in memory** (no source files
in the CadQuery checkout are modified): a `MetaPathFinder` intercepts whitelisted `tests.*` modules and
wraps every `test_*` body in `try: <body> finally: __CQ_EXPORT__(locals(), "<case id>")`.

- `try/finally` rather than appending a statement, so `return`, assertion failures and raised exceptions
  still trigger export.
- `locals()` yields only *named* intermediate variables (chained calls stay anonymous), which keeps the
  export count near two per case and — crucially — makes variable names alignable on the mirrored side.
- Export only `Workplane` (via `.val()`), `Assembly` (via `.toCompound()`) and `Shape` values whose
  `ShapeType()` is `Solid`/`Compound` with `Volume() > 1e-6`; record every other value with a reason.
- Both sides emit `<module>__<Class>__<test>__<var>.step` and are judged with the already-existing
  `compare-step.ts` / `compare-assembly.ts`, so no new comparison logic is introduced.

Measured on a `v2.8.0` snapshot with 10 modelling test files: **622 cases passed in 62 s, 305 cases with
exported geometry, 650 STEP files, 20.7 MB**; 47 capture events were rejected (mostly `Vector` values, plus
`CompSolid`, which upstream `exportStep` cannot write anyway).

## Alternatives considered

- **Rely on `BaseTest.saveModel()`** — rejected: coverage is ~35% in one file and zero elsewhere, so it
  cannot serve as the reference baseline.
- **Wrap test functions from a pytest hook (`pytest_pyfunc_call`) and read `frame.f_locals`** — rejected:
  the hook has no access to the executing frame's locals without `settrace`.
- **`sys.settrace` with a return-event handler** — rejected: large runtime cost and it conflicts with any
  coverage tooling in the same run.
- **Track every `Workplane` instance and derive "leaf" chains** — rejected: leaves are numbered by creation
  order, and the mirrored faijs scripts have no matching intermediate objects, so indices could never be
  paired across sides.
- **Hand-write an export call per test** — rejected: ~600 cases across two languages cannot be maintained,
  and it would drift from upstream the moment tests change.

The reference interpreter, CadQuery version (`2.8.0`), OCP build (`7.9.3.1.1`) and upstream test tag are
recorded in one baseline file and read by the harness. Tests are taken from a `git archive <tag> tests`
snapshot and executed with the site-packages interpreter, never the checkout root, so nothing in the
CadQuery working tree is written.

## Acceptance criteria

1. A single command reproduces the reference assets from the locked baseline and exits 0; the captured case
   count matches what the run reports (622 cases pass across the 10 modelling files).
2. Every capture failure is reported with a reason; no failures are silent. In particular the harness must
   treat a `False` return from `Shape.exportStep()` as an error, and must set `__file__`/`__package__` on
   modules it loads itself.
3. Case identifiers are byte-identical on both sides, so comparison pairs files by name with no manual map.
4. Verification is actionable: each blocked case names the op that blocked it, and none of them is reported
   as passing.
5. Re-running the mini_lathe comparison after the fixes shows `slide_top` and `slide_mid` consisting of a
   single solid each, with relative volume deviation ≤ 0.01%.

## Risks

- **Baseline drift.** The local CadQuery checkout sits at `a6bedc0` (`v2.8.0-20`, a dev branch requiring
  OCP 8.0.1) and is incompatible with the installed `cadquery 2.8.0` (OCP 7.9); resolving it wrong either
  way silently mixes two CadQuery versions in one reference run.
- **Silent export loss.** `Shape.exportStep()` returns `False` instead of raising when the output directory
  is missing, which drops every file while reporting success.
- **Loader bookkeeping.** A hand-written loader does not set `__file__`/`__package__`, breaking
  `Path(__file__).parent` inside intercepted test modules.
- **OCCT mismatch.** The reference side runs OCP 7.9 while faijs runs `occt-wasm` 3.8.0, so fillets and
  chamfers legitimately differ in face/edge counts; topology is therefore an observation, and the gate rests
  on volume, centroid, bounding box and the two-way boolean difference. Tolerances must never be widened to
  turn a failing case green.
- **Asset size.** A full reference run costs about 20 MB and 60 s; only a small smoke subset can live in CI,
  with the full parity report produced locally.
