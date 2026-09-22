# Agent Note: FCStd port M10 — Body ordering and multi-Body splitting (2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m10-body-split.zh.md)

## Decision 1: Body.Group as the topological-sort primary order (M10.1)

The Kahn iteration order becomes `Body.Group` order first, document order as fallback (the Base/Tool/Profile/BaseFeature chain in `depsOf` remains the dependency-deciding fallback). This guarantees the D-C chained fuse expands strictly in PartDesign feature order.

## Decision 2: Pocket base rule fixed (M10.2, measured)

PocketTest probe: `Pocket.BaseFeature=Pad`, `Pocket001.BaseFeature=Pocket` — BaseFeature **always points at the previous feature in the chain**. The rule: when BaseFeature has a value it wins (the existing implementation already behaves this way); M9.4's chained fallback only covers BaseFeature missing/unresolved forms.

## Decision 3: multi-Body splitting (M10.3/M10.5)

- Each Body with geometry produces `model/<BodyName>.fai.js`, ending with `let <Body>_out = <chain head>;` as a terminal alias (faijs has no identity op; a plain JS assignment)
- `main.fai.js` is the aggregation entry: `cad.group({ members: [<Body>_out, ...] })`
- No Body geometry → whole fallback to the single-file main (existing e2e shape unchanged)
- Stray Part features (belonging to no Body) stay in main.fai.js

## ⚠️ M10.4 measured conclusions (important; two open items settled)

1. **No `.fai.zip` loader exists in the repo**: grepping the whole repo finds no zip-loader consuming code; e2e unpacks and directly executes `model/main.fai.js`. `manifest.entry` is already hard-coded to `model/main.fai.js` (container.ts); no change needed.
2. **Real-corpus Bodies carry no `Group` attribute**: PadTest's Body only has `Tip: Pad002`; the feature chain is expressed entirely through each feature's `BaseFeature` dependency. PadTest therefore takes the single-file fallback path (correct behavior); multi-file splitting only applies to Bodies with `Group` (covered by a synthetic-fixture unit test).

**Known limitation (recorded honestly)**: a multi-Body product's `<Body>_out` aggregation references (`cad.group({ members: [Body_out, ...] })`) reference variables from other files — **without a loader, cross-file variables are unresolvable**, so multi-file products can be generated but not run end-to-end. The three e2e samples all take the single-file path and are unaffected. Closure waits for a container loader (consuming manifest.entry + model/ multi-file) in M11+; the aggregation entry will then need cross-file import or loader assembly semantics.

## Baseline

The three e2e-sample baselines are unchanged (PadTest 4/6/3, Crank 0/16/0, ProjectTest 0/1/0) — all real corpus takes the single-file fallback, nothing to update.

## Tests

- `codegen.test.ts` +2 cases: dual-Body split + aggregation reference, stray features stay in main
- Full fcstd 13 files / 92 cases + three e2e samples all green
