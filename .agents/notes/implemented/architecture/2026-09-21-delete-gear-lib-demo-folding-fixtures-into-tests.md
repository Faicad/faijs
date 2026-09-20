# Agent Note: delete `packages/gear-lib-demo`, fold its fixtures into `packages/tests`

> Date: 2026-09-21
> Status: implemented (faijs side)

## Decision record

1. **gear-lib-demo had no modelling of its own.** `src/gear.ts` is 88 lines forwarding core's `makeExternalGear` / `makeInternalGear` / `makePlanetaryGear` / `thread`. Its real payload was the 736 lines of tests covering the third-party-library channel (`registerLib` + `autoLift` + `autoLoadLibs` + `fn.outputs` multi-output adoption + BREP `dispatchPath` + STEP `ADVANCED_FACE` + `E_MESH_UNSUPPORTED`). Deleting the package must not delete those.
2. **Migration target**: `packages/tests/faijs/compat-e2e/_support/gear-lib-demo/` (8 files: `gear.ts`, `index.ts`, `mock-mech-brep.ts`, `mock-mech-mesh.ts` + 4 test files). Script specifiers (`'gear-lib-demo'`) are plain strings, so only two import lines changed (`gear-flow-fixture.ts:26`, `gear-auto-load-full-namespace.test.ts:15`) — all 10 e2e cases kept their assertions verbatim.
3. **gear capability after the change**: core `src/vendored/brepjs/gear/` (compat face; `thread` stays because it is not a gear) + `@faicad/fai-cq-gears` (15 factories, published on npm, latest `0.13.1`). New gear capability goes to `fai_cq_gears`; the core compat face is frozen, not extended.
4. **`packages/brepjs-compat` never existed** — it has always been a core subpath export (`./brepjs-compat` → `dist/api/brepjs-compat/`). The package the changelog remembers is `mech-lib`, renamed to gear-lib-demo in commit `7dcba4e`.

## Verification

`faijs/compat-e2e`: baseline **8 files / 22 tests** → after migration **12 files / 43 tests** → after deleting the package **12 / 43, all green**.

## Traps found while deleting

- `packages/tests/package.json` declared `"@faicad/gear-lib-demo": "*"`. Leaving it makes `npm install --package-lock-only` keep the workspace node in the lockfile forever (it only downgrades it to `"extraneous": true`). Remove the dependency first, then regenerate the lock, then delete the leftover node by hand and validate with `JSON.parse`.
- CI wiring mentions the package in four places: `scripts/ci.ps1` (`$testPackages`, madge args), `scripts/ci.sh` (madge args), `scripts/check-vendored-branding.mjs` (`MIGRATION_EXEMPT` + the A4 package list), `scripts/gen-importmap.mjs` (`EXCLUDE`).
- `scripts/gen-ops-api-inventory.ts:185` hard-codes the "third-party library (e.g. …)" row, so `docs/ops-api-inventory*.md` must be regenerated (`node_modules/.bin/tsx scripts/gen-ops-api-inventory.ts`), not hand-edited.

## Leftovers

- `D:/Faicad/3d_editor` still imports `@faicad/gear-lib-demo` (4 places); that link was already broken (no tgz in faijs, no package in its `node_modules`). Fix by landing the same fixture inside 3d_editor and keeping the package name.
- The demo/browser side cannot switch to `fai_cq_gears` yet: `cq-compat/src/browser.ts` exports only `./workplane` + `./assembly`, so `getGearKernel()` is unreachable in the browser (`gears.ts` itself is browser-safe).
- The demo `'gear-demo'` example is kept on purpose (see `packages/demo/main.ts:134`): it is the only e2e guard for "a library missing on CDN must fail loudly" (`e2e/demo.spec.ts:163`).
