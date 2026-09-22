# Agent Note: compound member ordering, the phantom `import_shape` op, and non-modeling shape assets

Status: implemented

English | [中文](2026-09-21-compound-links-and-phantom-import-op.zh.md)

## Problem

ArchDetail gapped with `compound-missing-members`: its five `Part::Compound`
containers translate to `cad.group({ members: [...] })`, yet the members were
not registered as variables by the time the group ran, so the container
resolved to nothing. Members and their assets were both present — the fault was
pure ordering.

`depsOf` builds the topological edges that Kahn's sort uses, and its
`linkProps` list did not include `Links`. A `Part::Compound` therefore had **no
edge to its own members**, so the sort was free to emit the group before them
(or before the submodules that define them) and `inputVar` came up empty.

While fixing that, two independent defects surfaced — both of the same shape:
a product that converts with `ok=true`, passes `cliCheck` with zero errors, and
then dies the moment it is run. `cliCheck` validates syntax and script-local
references; it never checks the callee and never checks the assets, so this
class is structurally invisible to every convert-side gate.

1. **The emitted callee did not exist.** Shape-asset verdicts emitted
   `cad.import_shape`. There is no such op in the `cad` namespace — the asset
   loader is `cad.load`, and it is a **SOLID** loader (`params: { key, format }`,
   `format: 'brep'`). 42 of 50 corpus products checked clean and could not run.
2. **Non-modeling objects were claimed as shape assets.** The rule was "any
   object with shape evidence is a shape asset", so a `PartDesign::Body` and
   both of its `PartDesign::Plane` datums were imported too. A datum's `.brp`
   holds the plane FACE, i.e. zero solids; those imports were unioned into the
   Body chain (`cad.union(pad, datumPlane)`) and made the product unrunnable.
   PadTest's counts briefly read translated=9 / preserved-only=4 as if that were
   progress; the honest value is 6/7.

## Decision

- **Members are topological dependencies.** `linkProps` (the link-list family
  used both for edge building and for `inputVar` renaming) gains `Links`
  alongside `Shapes`, so a container is always ordered after what it contains.
- **One shared classification table.** New `fcstd/structural-types.ts` owns
  `STRUCTURAL_TYPES`, `STRUCTURAL_TYPES_EXTENDED`, `isFemStructural`,
  `isNonModelingType`. It exists as a separate module because `convert.ts` and
  `codegen.ts` both need the predicate and a direct import between them would
  close a cycle. `convert.ts` re-exports the names it used to define locally, so
  no caller changes.
- **`Fem::` is a namespace rule, not a list.** `isFemStructural(type)` is
  `type.startsWith('Fem::')`. The enumeration had already been extended twice
  and would have needed a third round; every `Fem::` type in FreeCAD is an
  analysis / mesh / solver / result object, never model geometry, so the whole
  namespace is structural by definition.
- **Non-modeling types are short-circuited before translation** (not merely
  excluded from asset collection), because the two had to agree: excluded from
  `shapeCarriers`, and answered `preserved-only` in the codegen loop.
- **Assets are loaded with `cad.load`**, keyed by the asset member's basename
  without extension, `format: 'brep'`. `shapeAssetCall()` is the single place
  that builds the call.

## Alternatives considered

- **Give `Part::Compound` an explicit priority instead of an edge** — rejected:
  it papers over the same omission for every other container-ish type and
  re-introduces a second ordering mechanism beside Kahn.
- **Enumerate the missing `Fem::` types a third time** — rejected: the previous
  two rounds proved the enumeration is the wrong shape for a namespace whose
  members are all structural. A namespace predicate cannot go stale.
- **Keep `cad.import_shape` and add it to the namespace** — rejected: the op
  never existed and nothing depended on the name; inventing an op to match a
  typo would add public surface and hide that the correct op is the solid-only
  `cad.load`.
- **Let the shape-asset rule stay type-agnostic and filter at run time** —
  rejected: BREP/mesh path selection is decided statically before execution, by
  design; a run-time fallback is exactly the class of behaviour this project
  forbids.
- **Leave ArchDetail gapped rather than emit a product that cannot run** —
  rejected: the missing member edges are a genuine ordering bug that affects any
  container document, and the non-solid-asset problem is orthogonal, pre-existing
  and wider than this file (14 of the 21 samples that emit a load). Hiding the
  bug behind a gap would remove the evidence.

## Consequences

- 56-sample sweep: ok 48→**50**, gap 8→**6**, `cliCheck` failures 0 (82 model
  modules, 1,075 statements). ArchDetail converts; the remaining six gaps are all
  genuine geometry or solver work.
- **ArchDetail converts but its product still cannot run.** The honest
  statement of this round is "compound ordering fixed", not "ArchDetail works".
  Its members are Draft wires whose frozen `.brp` holds no solid, so
  `cad.load` refuses them.
- A new, measured, design-level open defect is now pinned: a frozen `.brp` is
  not guaranteed to be a solid. Census of 698 `cad.load` sites: 335 loadable,
  346 zero-solid, 15 with no matching manifest key, 2 unreadable by this occt
  build — spread over 14 of the 21 samples that emit a load. Product level: of
  the 50 samples that convert, **32 run, 18 fail, 0 throw**, in six classified
  root causes. Fixing it needs either a non-solid import capability (faijs has
  none) or restricting shape-asset to solids and turning the rest into explicit
  gaps.
- Two regression nets were added, deliberately at different granularity: the
  e2e golden pins one runnable all-solid shape-asset sample plus one pinned
  failing sample, and a corpus-wide run census pins the 32/18 split per sample
  so "conversion still reports ok" can never again mask an unrunnable product.
- Gotcha recorded in both nets: a document with several Bodies is emitted as an
  aggregate entry plus one module per Body, and the `cad.load` calls live in the
  Body modules. Asserting on `model/main.fai.js` alone proves nothing — measured
  on `test_geomop.fcstd`, which has 7 load sites and 0 of them in the entry.
- faijs fcstd suite 14 files / 144 cases green; the corpus project's suite
  7 files / 20 cases green.
