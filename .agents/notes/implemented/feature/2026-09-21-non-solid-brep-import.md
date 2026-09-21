# Agent Note: non-solid BREP import (`cad.load` with `allowNonSolid`)

Status: implemented

## Problem

A FreeCAD `.brp` asset is a frozen BREP, and a frozen BREP is NOT guaranteed to
hold a solid. Draft wires, faces and shells are frozen the same way, and the
shape-asset rule inside the FCStd port imports every one of them through
`cad.load` — a SOLID loader that rejects anything without a solid sub-shape.

Measured over the 56-sample corpus: of 698 `cad.load` sites, **346 point at a
`.brp` with zero solids** (`Ve/Ed/Wi/Fa/Sh` records only). Those products
converted with `ok=true` and a clean `cliCheck` and died on the first statement
when run (`[loadBrep] imported shape contains no solid sub-shapes`), because
`cliCheck` validates syntax and script-local references and never the callee or
the assets. The previous round documented this as a design gap with two possible
resolutions; this note implements one of them (the other, restricting shape-asset
to solids, would have thrown away real geometry).

The constraint that shapes the solution: this repo decides BREP-vs-mesh
**statically** and forbids run-time fallback, so "try it as a solid and relax on
failure" was never available. The relaxing decision has to be made before the
call.

## Decision

- **The verdict is read from the asset TEXT.** `brep/brep-topology-text.ts`
  exposes `brepTextHasSolid`, which scans the CASCADE `TShapes <N>` section for a
  bare `So` record. That section is a FLAT table (a solid inside a compound still
  gets its own `So` line) and the declared count bounds the scan, so a stray
  type-code-shaped line cannot extend it. `null` means "not a CASCADE file" —
  deliberately NOT folded into `false`, because an unreadable asset is a
  different failure and must keep failing as a solid import.
- **The verdict was validated against the kernel, not argued.**
  fcstd-port `out/probe-brp-predicate.mjs` compares the predicate with
  `getSubShapes(top, 'solid').length > 0` on every loadable corpus site:
  **681 agree, 0 disagree** (335 solid / 346 zero-solid); the 2 files the kernel
  refuses make the predicate abstain. Zero kernel cost at conversion time.
- **`cad.load` grew a parameter rather than an op.** `params.allowNonSolid`
  (default false) reaches `loadBrep(..., { allowNonSolid })`. Chosen over a new
  op because loading geometry is already `load`'s job — a second symbol would
  duplicate its key/path/url routing for no semantic gain — and because the
  default keeps every existing product byte-identical: the params object is only
  extended when the flag is set.
- **The relaxed path still refuses a genuinely empty asset.** `hasAnyTopology`
  requires at least one vertex/edge/wire/face/shell, so a corrupt file is a loud
  failure rather than a silently empty Shape.
- **The conversion layer stays kernel-free.** `convert.ts` collects
  `nonSolidAssets` while it already walks the archive for `shapeCarriers` and
  hands it to `generateModel` → `translateObject` → `shapeAssetCall`, so the
  emitted script carries the decision explicitly (`allowNonSolid: true`) instead
  of probing at run time.

## Alternatives considered

- **Add a dedicated op** (`cad.loadShape`, or the historical `cad.import_shape`
  name) — rejected: it duplicates `load`'s source routing and adds a public
  symbol whose only difference is a relaxed validation. The flag keeps one
  loader with one contract.
- **Probe the asset with OCCT during conversion** — rejected: the conversion
  layer currently runs no kernel at all, and spinning one up per asset would
  make batch conversion pay for a question text answers exactly.
- **Try a solid import first, fall back on failure** — rejected: this repo's
  rule is that the BREP path is picked statically; a silent retry hides which
  products depend on which geometry.
- **Import non-solid assets as mesh only** — rejected: the frozen file is exact
  geometry, and a Draft wire is legitimately the base of a later `extrude`. The
  BREP handle is worth keeping.
- **Restrict shape-asset to solids and turn the rest into explicit gaps** — the
  other documented option; rejected because it converts real, already-frozen
  geometry into a gap and would have dropped four working samples.

## Consequences

- New: `brep/brep-topology-text.ts` (+ test), `brep/load-nonsolid.test.ts`,
  fixtures `fixtures/data/brp/{draft-wire,boss-solid}.brp`.
- faijs: fcstd 14 files / 145 cases green, `api` + consistency suites 24 files /
  262 cases green. `docs/ops-api-inventory.*` regenerated for the new parameter.
- fcstd-port baseline: **run 32 → 36 of the 50 converted samples.** Crank,
  thermomech_flow1D and both InvoluteGear files now execute; Crank left the
  pinned `KNOWN_UNRUNNABLE` slot. Conversion-side sweep is unchanged
  (ok 50 / gap 6 / checkFail 0) — this was an execution-side defect.
- **The defect underneath is now visible.** The `KNOWN_UNRUNNABLE` slot pins
  ArchDetail on `E_BREP_UNSUPPORTED: input is not BREP`: with all 293 of its
  imports cleared, it dies one statement later feeding a `cad.group` compound
  back into `rotate_euler` (a structural compound carries no OCCT handle). Two
  more samples fail on the export side with the mirror of this problem —
  `exportStepFromSolids` finds no exportable sub-shape in an all-wireframe chain.
- **Known limit, pinned in `load-nonsolid.test.ts`:** a wireframe with no face
  tessellates to nothing, so it imports and queries fine but contributes no
  display mesh. Rendering it needs the kernel's `wireframe()` edge channel, which
  `Shape` does not carry yet.
- `allowNonSolid` loosens a validation, so a mis-classified asset degrades into
  "slightly too permissive" rather than a wrong result — the solid fixture in the
  test pins that the flag does not disturb the normal path. A non-solid operand
  still cannot enter a boolean op (OCCT raises `boolean operation failed`),
  which the test pins as the downstream limit callers must respect.
