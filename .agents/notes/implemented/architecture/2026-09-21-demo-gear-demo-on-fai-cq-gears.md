# Agent Note: demo `gear-demo` on the real gear library (fai_cq_gears)

Status: implemented

English | [中文](2026-09-21-demo-gear-demo-on-fai-cq-gears.zh.md)

## Problem

`packages/gear-lib-demo` was deleted earlier on 2026-09-21 (its fixtures moved into `packages/tests/faijs/compat-e2e/_support/`). That left the demo's `gear-demo` example pointing at a package that no longer exists. The user's requirement was explicit: the example must be implemented *correctly*, and the browser side must be able to use `@faicad/fai-cq-gears` — "浏览器侧仍换不了 fai_cq_gears" was not acceptable as an end state.

## Decision

Three blockers, and what was done about each:

1. **compatOp could not adopt an async library fn** (the real blocker). Every `fai_cq_gears` factory is `async` — it does `await getGearKernel()` and returns `Promise<Result<BrepHandle, string>>`. `compatOp`'s adapter called `unwrapOrThrow(callBrepjs(...))`; the shared unwrap is a deliberately sync leaf, so an unsettled promise is not ResultLike and fell through to `adoptOut` untouched — the statement produced a promise instead of a Shape. Fix (general capability, not library-specific): the adapter now awaits the call before unwrapping (`packages/core/src/api/internal/compat-op.ts`). Awaiting a non-promise product is a no-op, so sync libraries are unaffected.
2. **`@faicad/cq-compat` had no browser-exported gear primitives.** `fai_cq_gears` imports `getGearKernel` from the package root; `src/browser.ts` only re-exported `./workplane` + `./assembly`, so a browser build resolved the symbol to nothing. `gears.ts` imports only `initOcctWasm` + types (no node builtins), so `export * from './gears'` now belongs in that entry.
3. **The published 0.13.1 tarball is unusable from a CDN.** `@faicad/cq-compat` was declared only in `devDependencies` with the value `file:../cq-compat`, so jsDelivr's `+esm` build of `@faicad/fai-cq-gears@0.13.1` imports `/npm/@faicad/cq-compat@file%3A..%2Fcq-compat/+esm` — measured HTTP 404. Two actions: (a) the demo now resolves workspace libraries from **local live source** first (`LOCAL_LIBS` in `packages/demo/main.ts`, vite alias for `@faicad/fai-cq-gears` and `@faicad/cq-compat`); (b) the declaration bug is fixed — `@faicad/cq-compat: ^0.13.0` moved into `dependencies`. (b) only takes effect on the CDN after the next publish.

## Design decisions

- The demo's libLoader stays CDN-first for unknown `@faicad/*` packages; `LOCAL_LIBS` is a small explicit table for workspace libraries that the CDN cannot currently serve. Local resolution also sidesteps the "two faijs module instances" kernel-binding problem entirely.
- `gear-demo` now builds two real gears (24T + 12T, centre distance `module·(z1+z2)/2 = 36`) and unions them, instead of the old `external` + `thread` pair — `thread` lives in core, not in the gear library.
- The "a library missing on the CDN must fail loudly" regression still has a carrier: it no longer relies on a broken example, it feeds a script importing `@faicad/no-such-lib-demo` and asserts `not found on npm registry`.

## Verification (measured)

- `packages/core` `compat-op.test.ts`: 9/9 green (2 new async cases: adopted Shape with `hasBrep`, and `err` → statement-level failure carrying `E_GEAR`).
- `packages/tests` `faijs/compat-e2e`: 13 files / 47 tests green (was 12/43); the new `fai-cq-gears-flow.test.ts` runs the exact demo script through `runtime.execute` and asserts Shape adoption, BREP chain retention, `ADVANCED_FACE` in the STEP export, and `E_MESH_UNSUPPORTED` in mesh mode.
- `packages/demo`: `vite build` succeeds (8.17s) and the gear library lands in its own chunk; playwright `gear-demo` case passes in chromium (45.9s, `OK — brep: 1 shape(s)`, STEP contains `ADVANCED_FACE`, mesh unavailable); the example-switch case and the new CDN-missing case also pass.
- `scripts/check-ghost-deps.mjs` and `check-workspaces-order.mjs`: OK.

## Known, not fixed (out of scope, pre-existing)

- `packages/fai_cq_gears` `src/stability/stability.test.ts`: 8 cases fail. They `spawnSync(process.execPath, ['runner-entry.ts', …])` — a bare node run of a `.ts` file whose extensionless `import './cases'` cannot resolve under native ESM (`ERR_MODULE_NOT_FOUND`). Unrelated to this change; the suite is not in `scripts/ci.ps1`'s `$testPackages`, so CI never surfaced it. Other fai_cq_gears tests: 223 passed / 16 skipped.
- `packages/demo` `tsc --noEmit` reports 6 pre-existing errors (probe-cdn-kernel spec, and three `main.ts` handle-brand mismatches). Not touched here; demo typecheck is not part of CI.

## Alternatives considered

- **Keep the demo pointing at `@faicad/gear-lib-demo`.** Rejected: the package is gone (fixtures moved into `packages/tests`), the import line was already broken.
- **Only fix the declaration bug and wait for the next publish.** Rejected: the published tarball cannot serve from the CDN until then, and the demo must run today; local live-source resolution is required as the bridge.
- **Resolve every `@faicad/*` from local source.** Rejected: unknown `@faicad/*` packages should stay CDN-first; `LOCAL_LIBS` only covers workspace libraries the CDN cannot serve, which also avoids the "two faijs instances" kernel-binding problem.
- **Keep the broken example as the CDN-missing guard.** Rejected: `gear-demo` must show the real gear library; the "missing library fails loudly" regression now feeds an import of `@faicad/no-such-lib-demo` instead.

## Consequences

- `compatOp` gained a general capability: async library functions are awaited before unwrapping, with sync libraries unaffected (no-op await).
- `@faicad/cq-compat`'s browser entry now exports the gear primitives (`export * from './gears'`), so the browser side can use `fai_cq_gears`.
- The demo builds two real gears (24T + 12T) and unions them; the CDN-missing regression is carried by the `@faicad/no-such-lib-demo` case.
- The declaration fix (`@faicad/cq-compat: ^0.13.0` in `dependencies`) only reaches the CDN after the next publish.
- Pre-existing issues (fai_cq_gears `stability.test.ts` 8 failures, demo `tsc` 6 errors) are recorded in this note and untouched.
