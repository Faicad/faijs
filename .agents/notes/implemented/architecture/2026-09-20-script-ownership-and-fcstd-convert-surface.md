# Agent Note: script ownership — faijs keeps capabilities + tests; conversion surface published

Status: implemented

English | [中文](2026-09-20-script-ownership-and-fcstd-convert-surface.zh.md)

## Problem

The rule "faijs carries the generic FCStd capability; corpus analysis lives in `D:/Faicad/fcstd-port`" had been applied to the profilers only. Everything else stayed: of the 26 files in `packages/core/scripts/`, 17 were corpus reports or one-off kernel probes, none of them reachable from CI.

Three concrete defects fell out of that:

- **The conversion pipeline had two implementations.** `fcstd-to-fai-zip.ts` (the M5.4 dev CLI) and `fcstd-convert-cli.ts` (a thin wrapper over `src/fcstd/convert.ts`) drove the same stages. They disagreed where it matters: the dev script had no C4 audit (it wrote a container even for documents with non-Python baked objects) and no exit-code contract. The e2e golden test was pinned to the dev script, so the shipped pipeline was not what CI verified.
- **A published guarantee had zero test coverage.** `smoke-cad-builtin.ts` asserted D1 — `createRuntime` carries the `cad` namespace as its default lib, the pure-engine variant does not — via `console.log` and `process.exit`. D1 is the contract that lets a host stop injecting `cad`; a `tsx` script cannot guard it.
- **The conversion surface could not be published.** `convert.ts:114` calls `createPlanegcsSolver()`, and `@salusoft89/planegcs` sat in `devDependencies`, so `./fcstd-convert` would have been uninstallable for consumers. (Recorded as blocker B0 in the batch-convert plan.)

## Decision

**Rule.** A `packages/core/scripts/` tool that can run in CI must become a `*.test.ts`. A tool that cannot — it needs a corpus on disk, or a hand-supplied input file — belongs to the project that owns that corpus, and leaves the repo. Corpus profiling stays a single implementation.

**Moved to `fcstd-port/tools/`** (12 tools, imports rewritten to the public subpaths `@faicad/faijs/fcstd`, `/fcstd-convert`, `/occt-kernel/*`, `/brep/*`, `/api/*`, `/node`): `coverage-report`, `validate-sketch-solve`, `locate-l1-sketches`, `calibrate-t1`, `probe-m13-types`, `probe-offset2d-feasibility`, `probe-padtest-brp-bbox`, `probe-padtest-brp-volumes`, `probe-pad002-chain`, `probe-pad002-upto`, `probe-step-volume`, `verify-geometry` — and a 13th, `scan-fcstd-samples`, was dropped outright instead, because `fcstd-port/lib/profile.mjs` already reports every one of its numbers (object types, sketches, geometry, constraints, failures, non-zero exit) and counts more accurately, by parsing the geometry/constraint lists instead of reading XML `count` attributes.

**Deleted in faijs:**

| Deleted | Reason |
|---|---|
| `scan-fcstd-samples.ts` | duplicate of `lib/profile.mjs` (see above) |
| `probe-upto-circle.ts` | its only case (circle sketch `upTo` slanted plane) is already locked by `src/api/extrude-upto.test.ts`, with byte-identical constants |
| `smoke-cad-builtin.ts` | replaced by a real test — `src/cad-runtime/createRuntimeWithCad.test.ts` |
| `fcstd-to-fai-zip.ts`, `fcstd-convert-cli.ts` | one pipeline, one implementation: both replaced by `src/fcstd/cli.ts` |

**Conversion surface published.** `@salusoft89/planegcs` moves from `devDependencies` to `dependencies`; `./fcstd-convert` exports the pipeline (`convertFcstdFile`, `SKETCH_T1`, `ALLOWED_DISPOSITIONS`) plus the solver and classifier the corpus tooling needs (`createPlanegcsSolver`, `planegcsWasmPath`, `classifySketch`, `maxPointDistance`, `resolveExternalGeometry`, `isWhitelisted`); `bin.faijs-fcstd-convert` → `dist/fcstd/cli.js`. `package.json` scripts drop `fcstd:scan` / `fcstd:validate`; `fcstd:convert` becomes `tsx src/fcstd/cli.ts`.

**E2E repointed.** `fcstd-e2e.test.ts` now drives the published CLI and asserts its exit contract. Baselines were re-derived by running it, not by editing numbers:

- PadTest → exit 0, `{translated:6, pythonBaked:0, preservedOnly:7, baked:0}`, sketches 3/3 L0. `preserved-only` went 3 → 7 because the C4 audit reclassifies structural/datum `baked` entries; the object set and geometry are unchanged.
- Crank / ProjectTest → exit 2, explicit gap list, **no container** (16 gaps: `Part::Feature`, `Part::Part2DObjectPython`; 1 gap: `App::InventorObject`). The old golden asserted counts from a container the C4 contract forbids producing.

## Alternatives considered

- **Keep the probes in faijs under a `dev:*` script namespace.** Rejected: 17 scripts that CI never runs are unmaintained by construction — the corpus-dependent ones rot the moment the corpus path changes, and two of them had already rotted against their own API (`probe-pad002-chain.ts` read `res.outputs['part9']`, which `CliRunResult` no longer has).
- **Make `planegcs` an `optionalDependency` and have the CLI fail with a clear message when absent.** Rejected: constraint solving is not optional for conversion — `convert.ts` solves every sketch before any contour is extracted, so a missing solver means "no conversion at all", not a degraded mode. A hard `dependencies` entry is the honest declaration. (It is ~1MB of WASM+JS with no transitive dependencies.)
- **Move the whole solver into fcstd-port.** Rejected: the L0/L1/L2 verdict and the T1 tolerance are part of the conversion contract; splitting them across repos would create a second implementation of the classification.
- **Convert the corpus tools into corpus-gated tests in faijs (skip when absent).** Rejected for the sweep/report tools: they are reports, not assertions (their job is to print distributions for a plan), and a skipped test would have hidden that the corpus path is a foreign project's data. The engine already has the corpus-gated tests it needs (`convert.test.ts`, `placement-corpus.test.ts`, `fcstd-e2e.test.ts`, `fcstd-g9-contour.test.ts`, `external-geo.test.ts`).

## Consequences

- faijs `packages/core/scripts/` holds 9 files: `faijs-cli.ts` plus the 8 `gen-*.ts` code generators that the surface/op-consistency gates are wired to. Everything else is either a test or lives in fcstd-port.
- **`./fcstd-convert` is Node-only.** `planegcs-backend.ts` resolves the solver WASM from `node_modules` via `createRequire(import.meta.url)`, and `external-geo.ts` reaches the occt kernel (still a peer dependency). Nothing on the main entry imports it, so browser bundles are unaffected — but a browser-side converter would need a different WASM delivery path.
- The public surface grew by one subpath (12 total in the snapshot) and by 9 runtime exports that were previously internal. `isWhitelisted` is now part of it: it defines the translation scope, and the corpus coverage report must measure the same scope the converter enforces.
- **Verification evidence** (all run on 2026-09-20): `tsc -p tsconfig.build.json` exit 0; `api-surface-snapshot.mjs` 12/12 subpaths resolve; `check-ghost-deps` / `check-layer-boundaries` / `check-workspaces-order` all pass (`@salusoft89/planegcs` is now a declared dependency, so the ghost-deps guard is satisfied by construction rather than by exemption); `createRuntimeWithCad.test.ts` 2/2; `src/fcstd` 121/121; `fcstd-e2e.test.ts` 2/2 against the real corpus. Consumer side: `npm pack` → install the tgz in `fcstd-port` → `planegcs` arrives transitively, `node_modules/.bin/faijs-fcstd-convert` runs PadTest to exit 0 with the container written; `tsc --noEmit` over the 12 moved tools is clean against the published surface.
