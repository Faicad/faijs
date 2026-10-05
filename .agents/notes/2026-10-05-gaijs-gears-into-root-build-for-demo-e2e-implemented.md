# Agent Note: build @faicad/faijs-gears in the root `npm run build` chain

Status: implemented

English | [中文](2026-10-05-gaijs-gears-into-root-build-for-demo-e2e-implemented.zh.md)

## Problem

The GitHub Actions CI run (and the local `scripts/ci.ps1` pipeline) execute
`npm run build` before the demo e2e tests, but the root `build` script only
compiled `@faicad/faijs`, `@faicad/faijs-draw`, `@faicad/faijs-sketch`,
`@faicad/faijs-extra`, `@faicad/faijs-viewer`, and `@faicad/sheetmetal`. It
did **not** build `@faicad/faijs-gears`.

The demo page (`packages/demo/main.ts:132`) lazily imports
`@faicad/faijs-gears` (`LOCAL_LIBS["@faicad/faijs-gears"] =
() => import("@faicad/faijs-gears")`). On a fresh CI checkout,
`packages/faijs-gears/dist/` is absent (dist is gitignored and produced only by
the build stage), so vite's import-analysis emitted:

```
Failed to resolve entry for package "@faicad/faijs-gears" ...
File: packages/demo/main.ts:132:38
```

Because it is a non-fatal pre-transform error, vite dev keeps running and the
`gear-demo` Playwright test blocks forever waiting on the broken lazy import —
the whole `Demo e2e (dev server)` step hung for ~44 minutes on CI instead of
failing fast. Locally the same suite passed in ~1.6 min because
`packages/faijs-gears/dist` already existed from a prior build.

## Decision

Add `@faicad/faijs-gears` to the workspace build chain:

- Root `package.json` `scripts.build` now appends
  `npm run build -w @faicad/faijs-gears` after `@faicad/sheetmetal`.
- Because both pipelines drive the same `npm run build`, no per-job command
  change was needed; `.github/workflows/ci.yml` and `scripts/ci.ps1` only get a
  matching step-label/comment so they stay step-aligned. The
  `faijs-gears` build is cheap (~tsc + import-extension fix), and its only
  dependency is `@faicad/faijs` (built earlier in the chain), so appending is
  safe.
- `@faicad/faijs-fasteners` was intentionally NOT added: the demo does not
  declare it as a dependency, so a build-only entry would add unused work with
  no CI benefit.

## Alternatives considered

- **Add a dedicated `npm run build -w @faicad/faijs-gears` step in CI/ci.ps1.**
  Rejected: it would diverge the two pipelines (each would need the extra job)
  and break the step-alignment invariant that keeps `.github/workflows/ci.yml`
  and `scripts/ci.ps1` identical. Driving the single root `build` script keeps
  both pipelines correct with one edit.
- **Also build `@faicad/faijs-fasteners`.** Rejected: fasteners is not a `demo`
  dependency, so it is not consumed by the demo e2e; adding it would only add
  unused build work and widen the CI surface without fixing the hang.
- **Have the demo e2e skip the `gear-demo` test or fake the lazy import.**
  Rejected: masking the resolution failure hides a real packaging gap (a fresh
  checkout could not serve the demo's own declared dependency) instead of fixing
  it.

## Consequences

- A fresh CI checkout now gets `packages/faijs-gears/dist/`, so the demo's
  lazy import resolves and the `Demo e2e (dev server)` step completes rather
  than hanging on `@faicad/faijs-gears` entry resolution.
- `package-lock.json` is **untouched** (HEAD already carries the rollup-family
  restore and `0.29.5` version line). No version was bumped.
- Verified locally: `npm run build` (full chain incl. gears) exits 0 and emits
  `packages/faijs-gears/dist/index.js`; full demo e2e (`npm run test:e2e`)
  passes 23 tests in ~1.6 min.