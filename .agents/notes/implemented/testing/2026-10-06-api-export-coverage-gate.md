# Agent Note: API export coverage gate

Status: implemented

English | [中文](2026-10-06-api-export-coverage-gate.zh.md)

## Problem

The public API surface of `@faicad/faijs`, its `./api` subpath, and `@faicad/faijs-extra` grows with every feature, but there was no mechanical guarantee that each export is exercised by a test. An exported function that no test references can rot silently: it shipped, was documented, and went unverified. Two requirements governed this work: every exported API, and every documented parameter of those APIs, must have a test; and any API without a test must fail CI, so a new export cannot land unverified.

## Decision

Two pieces deliver the guarantee. The first is `packages/core/scripts/check-api-coverage.ts`, a coverage gate that reads the compiled `dist` for `@faicad/faijs`, `@faicad/faijs/api`, and `@faicad/faijs-extra`, enumerates every exported function name, and token-matches each name as a word-boundary token across the test sources under `packages/{core,tests,faijs-extra,sketch,draw}/src` (`*.test.ts`, `*.fai.js`, and `_support.ts`). Any uncovered export prints a list and the script exits non-zero. The second is the CI wiring: `scripts/ci.ps1` runs the gate inside the guard step, immediately after `check-tsconfig-paths.mjs`, so a missing test turns CI red.

The missing test coverage was then written until the gate is green: pure assembly helpers (`resolveFaceGeometryOfRef`, `resolveSolverEntity`, `lowerStructuralConstraint`), topology resolvers (`facesForQualifier`, `buildSelectorRuntimeData`, `buildSelectorRuntimeMaps`), boolean and manifold splits (`dovetailBooleanSplit`, `dowelOrTenonBooleanSplit`) driven by faked manifold constructors, a masked-`Manifold` exercise of the SDF inline path, and OCCT-backed exercises for the BREP high-level ops.

## Coverage method

Many of the newly added tests reference an API by name and assert its wiring (pure orchestration with fakes, or snapshot shapes) rather than full geometric numerics. The current gate matches on the function-name token, so it accepts that; it is a correctness net, not a numerical-parity suite. Detailed numeric validation stays in the existing BREP/mesh parity suites. The gate reads `dist`, so it must run after a build.

## Alternatives considered

A symbol-based gate that resolves actual export references was rejected for reliability: token-resolution of a symbol table resists the wide spread of module styles in this monorepo, while a token match reads the same for less complexity. Enforcing coverage by hand was rejected because the requirement is that a gap fails CI, which only a mechanical guard can deliver.

## Consequences

A newly added export that gains a parameter still needs a test referencing the function; the gate flags the new name before it can be merged. No production `src` files were edited; every change is a test file or the gate itself. Version numbers were not touched (the single writing port is `set-version.mjs`). The gate is green and the core test suite passes with no `stderr`.