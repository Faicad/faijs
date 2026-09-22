# Agent Note: H7 first cut — Part::Feature as a pure Shape carrier

Status: implemented

English | [中文](2026-09-20-h7-part-feature-shape-asset.zh.md)

## Problem

`Part::Feature` was the largest single type in the translation gap list
(1,359 objects library-wide; first cause in 21 of the 47 failing corpus
files after H10). Corpus probing showed these objects are NOT parameterized
features at all: in all 56 corpus samples (70 objects) the property surface
is exactly `Shape` (41×) or `Shape` + `ShapeMaterial` (29×) — no feature
parameters. The geometry lives in the ZIP as a `.brp` member
(`file="Face005.Shape.brp"` inside the `Part::PropertyPartShape` element),
already copied into `assets/` by the container builder (M2.3). Treating
"no whitelist entry" as "translation gap" misclassified an existing-fact
shape as missing work.

## Decision

- `translateObject` gains an optional 4th parameter `shapeCarriers`:
  the set of object names whose `Shape` property's `file` attribute points
  to a `.brp` member that actually exists in the archive (collected in
  `convert.ts` via `memberText`).
- A `Part::Feature` in that set resolves to `{ kind: 'translated', calls:
  [], reason: 'shape-asset' }` — zero cad calls; the geometry is delivered
  through `assets/<name>.Shape.brp` and recorded in the mapping artifacts.
- A `Part::Feature` NOT in the set is an explicit gap
  (`shape-asset-missing`), never a silent bake.
- Codegen plumbs the set through `generateModel(..., shapeCarriers)`.

## Alternatives considered

- **Teach `cad.asset` to load .brp and emit a real call** — deferred: the
  current `cad.asset` returns UTF-8 text (SVG-oriented); making it deliver
  BREP shapes is kernel work that no downstream consumer needs yet (the
  corpus consumers of Part::Feature — Extrusion/MultiFuse/Groups — were
  already gapped for other reasons). The ledger carries the artifact path.
- **New disposition `shape-baked` beside C4's three states** — rejected:
  C4's contract is three states; "shape exists as an asset, nothing was
  translated because nothing needed translating" is honestly a
  `translated` with zero calls and a distinguishing reason.
- **Whitelist the type and fall through to `default`** — rejected: the
  default case would emit `type-not-implemented` (a lie — nothing was
  attempted) and the shape-evidence check would be lost.

## Consequences

- 56-sample sweep: ok 22→23, zero files with `Part::Feature` gaps; cliCheck
  on all ok products: 0 failures. The single newly-ok file is one whose only
  blocker was Part::Feature carriers; the other former first-cause files now
  fail on their real next blocker (revolution-missing-profile etc.).
- Library-wide implication: all 1,359 `Part::Feature` objects should convert
  the same way (same property shape) — to be verified in the batch phase.
- `Part::Revolution`/`Fillet`/`Chamfer` (the same-named-different-semantics
  Part workbench family, 730 objects) do NOT occur in the 56 samples; they
  remain H7 work for the batch phase.
- Tests: `feature-translate.test.ts` H7 group (3 cases, incl. the
  shape-evidence GOTCHA and the explicit-gap path); fcstd suite 12 files /
  120 cases green.
