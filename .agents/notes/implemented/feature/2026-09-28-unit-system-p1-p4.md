# Agent Note: unit-system P0–P4 (dimensions, constants, tolerance, I/O, declaration surface)

Status: implemented

English | [中文](2026-09-28-unit-system-p1-p4.zh.md)

## Problem

The unit system design called for bringing real
dimensions and unit handling into faijs: base units `mm / degree / gram / kelvin / second / ampere`,
typed value objects, deduplicated unit constants across packages, unit-aware I/O tolerances, and a
script-side `paramDims`/`retDim` declaration surface. P0 (angle base = degree) was already decided.
This note records the P1–P4 delivery and its constraints.

## Decision

- **P1 — `packages/core/src/units.ts`** is the single source of unit truth. It exposes pure-number
  constants (`MM`/`INCH`/`RADIAN`…), typed constants (`mm`/`inch`/`degree`…), the `ValueWithUnits`
  class (method-style ops `.add/.mul/.as/.pow` since JS has no operator overloading; `.value` is
  always base-unit), tables (`UNIT_SCALE`/`UNIT_DIM`/`UNIT_DIMS` derived from one table), the six
  3MF legal length enums, and `toBase/fromBase/unitFor/unitScale`. The base invariant is
  `inch.mul(2).value === 25.4 * 2` (base unit mm). Angle base is degree.
- **P2 — tolerances are typed values.** `packages/core/src/tolerance.ts` declares
  `SEWING_TOLERANCE`, `DEFAULT_LINEAR_DEFLECTION` as `ValueWithUnits` (via `mm.mul(...)`, never JS
  `*` on an object); consumers calling `.as(mm)` preserve the numeric value (mm scale = 1) while
  keeping the units typed.
- **P3 — duplicate unit tables deduplicated.** fcstd `expressions.ts`, warehouse `measure.ts`, and
  `sprocket.ts` no longer define their own `INCH`/`UNIT_TO_MM` copies; they import from `@faicad/faijs/units`.
  3MF parsing moved into faijs core (`threemf-loader.ts`, unzip via `fflate`, XML via `@xmldom/xmldom`,
  reading `<model unit>` → coordinate scale, per-object item transforms).
- **P4 — declaration surface.** `DualOpOptions` and `DualOpMeta` now carry `paramDims`/`retDim`
  (typed as `DimName`). `ArgSpecEntry` gained the same fields and `gen-l3-surface.ts` threads them
  into the generated `defineOp` calls and `script-face-manifest.ts`. A new exported accessor
  `dualOpMetaOf(fn)` reads an op's declaration. `ExtractMetadataOptions` gained `opDims`, threaded
  through the runtime `check()`/`execute()`, `codeToArgs`, and (via `runtime.check`) the CLI.
  Handwritten ops (`box`, `fai_extrude`) declare real `paramDims`.

## Constraints honored

- **`lang/` must not depend on the op registry.** The runtime builds `opDims` from registered libs
  via `dualOpMetaOf` and injects it into `extractMetadata`.
- **`units.ts` stays a neutral leaf** so `check-platform-imports` and the zero-heavy-dependency
  sdk/browser bundles keep passing. No platform imports.
- **P4 declares the surface, not the P6 rejection rules.** The static dimension *check* (`dimension`
  pass, `E_DIM_BARE_NUMBER`) is P6 work, out of scope here. `opDims` being present changes nothing
  until P6 consumes it.

## Alternatives considered

- **Operator overloading impossible in JS** → method-style ops (`.add/.mul/.as/.pow`) on
  `ValueWithUnits`, mirroring the doc's constraints.
- **Sample unit tables per consumer vs. single source** → rejected duplication; converged every
  second `INCH`/`UNIT_TO_MM` table to `@faicad/faijs/units` exports.
- **`opDims` sourced by scanning the op registry from `lang/`** → rejected (layer violation); the
  runtime (or CodeToArgs caller) injects the map.
- **`paramDims` injected directly from `arg-spec.ts` vs. synthesized from registered libs at runtime** →
  runtime synthesis wins: it reflects the actually-active op set without `lang/` depending on the registry.

## Consequences

- All P1–P4 local test suites pass: core (`184 passed / 2335`), fcstd (`26 / 311`), faijs-extra ops,
  and `packages/tests` integration (`49 / 552` + parity `12`). fai_cq_warehouse passes 299/300; the
  single failing test is the pre-existing upstream-CSV data-hash guard, unrelated to units.
- Two pre-existing guard drift items are unrelated to this work and left untouched:
  `check-platform-imports.mjs` flags a long-standing `punch-hole.ts` → occtKernel import, and
  `check-dep-lockstep.mjs` flags a `@faicad/faijs-draw` version-range mismatch. Neither involves
  changes from P0–P4.
- P5–P8 remain unstarted by explicit user scope (P0–P4 only).