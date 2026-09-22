# Agent Note: corpus-dependent FCStd tests moved to fcstd-port/test/FreeCAD

Status: implemented

English | [中文](2026-09-20-fcstd-corpus-tests-moved-to-fcstd-port.zh.md)

## Problem

The faijs repo carried two kinds of FCStd tests: (a) synthetic-fixture unit
tests (parser gotchas, codegen, placement math, container, whitelist
translation) that run anywhere, and (b) corpus-dependent tests that need real
`.FCStd` samples from the local FreeCAD checkout (`D:/Faicad/FreeCAD`, via
`FAIJS_FCSTD_CORPUS`) — skipped in CI when absent. Ownership rule settled with
the user: library/corpus analysis lives in `D:/Faicad/fcstd-port`; faijs keeps
only the generic FCStd→`.fai.zip` capability. The corpus tests and their
fixtures belonged with the corpus, not in faijs.

## Decision

- **Moved (6 test files)** → `fcstd-port/test/FreeCAD/`: `convert.test.ts`,
  `placement-corpus.test.ts`, `external-geo.test.ts`,
  `solver-wrong-solution.test.ts` (from `packages/core/src/fcstd/`),
  `fcstd-e2e.test.ts`, `fcstd-g9-contour.test.ts` (from
  `packages/tests/faijs/fcstd/`).
- **Moved fixtures** → `fcstd-port/test/FreeCAD/fixtures/`: the 3 `.FCStd`
  samples from `packages/fixtures/data/fcstd/` (hole_puzzle, taperedballnose,
  TestSketchCarbonCopyReverseMapping).
- **No-pack consumption**: fcstd-port got `vitest.config.ts` aliasing
  `@faicad/faijs/*` → the faijs source tree (`../faijs/packages/core/src/`),
  so the moved tests always exercise current engine code, not the packed tgz.
- **Imports rewritten** to public subpaths (`@faicad/faijs/fcstd`,
  `@faicad/faijs/fcstd-convert`, `@faicad/faijs/node`); `ConstraintType` /
  `PointPos` come from `.../fcstd/sketch-parse.js` because they are
  type-only re-exports at the barrel (GOTCHA).
- **faijs keeps** all synthetic-fixture unit tests (11 files / 112 cases) —
  the AGENTS.md keep-verification-as-tests rule stays satisfied for shipped
  code; CI coverage is not lost for the pipeline itself.

## Alternatives considered

- **Move ALL fcstd tests, zero retention in faijs** — rejected (user decision):
  shipped modules with zero in-repo tests violate the verification-record rule;
  synthetic gotchas are not FreeCAD corpus and would be misfiled under
  `FreeCAD/`.
- **Consume the packed tgz in fcstd-port tests** — rejected: stale against
  engine changes; source alias keeps the tests live (same model as the demo).

## Consequences

- fcstd-port: `npm test` (vitest) runs 6 files / 16 cases, all green; tests
  require the sibling `../faijs` checkout (fails fast if absent) and the local
  FreeCAD corpus (skipWhen-absent preserved).
- faijs: `packages/tests` workspace full run 1609 passed; core fcstd suite
  112 passed. The e2e golden baseline was updated for H10: Crank no longer
  lists `Part::Part2DObjectPython` as a gap (now `python-baked`).
- `packages/tests/faijs/fcstd/` and `packages/fixtures/data/fcstd/` are gone;
  a stale doc reference in `api/edge-ref.ts` was repointed.
