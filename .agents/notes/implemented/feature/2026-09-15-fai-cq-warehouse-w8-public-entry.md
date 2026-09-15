# Agent Note: fai_cq_warehouse W8 — public entry, workspace registration, layering gate

Status: implemented

English | [中文](2026-09-15-fai-cq-warehouse-w8-public-entry.zh.md)

## Problem

The cq_warehouse port's P0 body (33 instantiable classes across thread / nut / screw / washer / bearing / sprocket, W1–W7) was complete, but the package had no public entry (`src/index.ts`), was absent from the root `workspaces` list, and had no static enforcement of the layering rules that the port plan (docs/plans/2026-09-13) defined for W8. Without these, the package could not be consumed by a host, was invisible to workspace-level tooling, and the "no direct kernel access" constraints existed only as prose.

## Decision

### Public entry (`src/index.ts` + `src/contract.ts`)

Barrel export mirroring `fai_cq_gears`'s entry shape: per-module factory functions and derived-dimension helpers (thread ×5, nut ×7, screw ×12, washer ×3, bearing ×5, sprocket ×1), the params query surface (`nutTypes`/`nutSizes`/…, the `types()`/`sizes()` method equivalents), and the measure parsers. `contractVersion` lives in `src/contract.ts` and aliases core's `CONTRACT_VERSION` (not hardcoded), matching the gears package convention. `Chain` (P1-a) and the hole-series functions (P1-b) are deliberately **not** exported — they are unimplemented P1 items, recorded as such below.

### Workspace registration

`packages/fai_cq_warehouse` sits in root `workspaces` immediately after `packages/fai_cq_gears`, satisfying `check-workspaces-order.mjs`'s topology assertion (verified green).

### Layering gate (`scripts/check-lib-layering.mjs`)

A standalone static checker (same style as `check-ghost-deps.mjs`) scoped to the package's `src/` and `scripts/`, enforcing five rules from the plan's acceptance gates:

1. no `import 'occt-wasm'` — kernel must come through host-injected `requireKernel()`;
2. no `initOcctWasm` outside **host-role** `src/test-setup.ts` (the library itself never initializes the kernel; the test/CLI side plays the host);
3. no `getGearKernel` — must not consume another third-party library's internal entry;
4. `getBackends()` only in `src/kernel.ts` — every other file goes through `requireKernel()`;
5. no `as any`, no `OcctKernel` type import.

Rules run on comment/string-stripped source so documentation mentions don't false-positive. The script is CI-wired via the package's guard convention; any hit exits 1.

## Alternatives considered

- **eslint `no-restricted-imports` instead of a script.** Not chosen: the repo already rejected eslint-plugin-import for peer-version conflicts (see `check-ghost-deps.mjs` header); a standalone AST-free checker with comment stripping covers the same rules without re-opening that dependency question.
- **Export Chain / hole-series stubs.** Rejected: exporting unimplemented P1 surface would let hosts bind to it; the plan requires unimplemented P1 items be noted, not stubbed.
- **Hardcode `contractVersion = 1`.** Rejected: the plan ties the contract to the kernel contract version; aliasing core's `CONTRACT_VERSION` keeps them locked together.

## Consequences

- Consumers import via `@faicad/fai-cq-warehouse`; `npm run test --workspaces` and workspace tooling now see the package.
- The layering rules are mechanically enforced; regressing to direct kernel access turns CI red.
- P1 status: **Chain (P1-a) and hole-series (P1-b) are unimplemented** in this package, per the plan's W9 option. Their dependencies differ (Chain needs multi-product STEP + assembly Location; hole-series needs the W1 param tables + W3 IsoThread), so each may be picked up or dropped independently. If either lands later, this note must be updated.

## Verification

- `node scripts/check-lib-layering.mjs` → OK;
- `node scripts/check-workspaces-order.mjs` → OK (10 workspaces in dependency order);
- package `typecheck` / `lint` / `vitest run` → green (see PR for the run log).
