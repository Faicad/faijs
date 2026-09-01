# Agent Note: Layered API port — P0 baseline, host bridge, vendored skeleton

Status: implemented

English | [中文](2026-09-01-layered-api-p0-baseline.zh.md)

## Problem

The layered API migration (porting the brepjs stack) was still design-only. Three pieces blocked any start: there was no locked regression suite to guard a large multi-phase port; the host app's only `@faicad/faijs/stdlib` consumers had no migration path before the package would be deleted; and there was no tooling scaffold (independent tsconfig and layer-boundary enforcement) for the vendored tree that the port will land in.

Two facts in the parent design drifted from the real host:

- It listed `parseScript`/`statementToLine`/`scriptToCode`/`buildArgsParts` as required host-facing exports. `parseScript` is engine-internal (the host's contract test forbids it), and the other three do not exist anywhere.
- It described the migration target as the root entry `@faicad/faijs`. The host's own contract test (red line 5) forbids production code from importing the root entry — only `@faicad/faijs/browser` is allowed, and every symbol used from it must be whitelisted.

## Decision

Landed four pieces, all self-contained in-faijs, host-facing swaps prepared but gated:

1. **P0 acceptance suite** — `packages/tests/faijs/refactor-acceptance/refactor-acceptance.test.ts` (7 tests):
   - the full eleven-field `ExecutionResult` contract (outputs, brepChain, terminals, infos, failedAt, brepSolids, topology, naming, compounds, changed, activeValues) asserted on one BREP drive, including the `naming` field that the plan had previously omitted;
   - the host-visible code-text surface (`analyzeCode`/`codeToArgs`/`formatCodeLine` exported from the facade; `parseScript` must stay absent);
   - the D1-0 bridge (see next point);
   - append-incremental and failure semantics;
   - the §2.8 regression anchors run green (170 core + 132 integration tests) alongside the new suite.
2. **Host stdlib migration bridge (D1-⓪, partial)** — made `drill` and `engrave` importable from both `@faicad/faijs` (root) and `@faicad/faijs/browser` by re-exporting from stdlib, and locked it with an acceptance assertion. The actual host repos (3d_editor) import swap is deliberately **not** done yet: the host resolves faijs as packed `.tgz` files, so the swap needs a fa-aijs pack + version bump, which is a release gate, not a code decision.

3. **Vendored skeleton** — `packages/core/src/vendored/brepjs/` (with README), `packages/core/tsconfig.vendored.json` carrying brepjs original strictness (`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) for isolated compile (D9), and `scripts/check-layer-boundaries.mjs` implementing the ported layer rules R1–R5 (D8). The boundary script is self-testable via `BOUNDARY_SRC_DIR` and passes on the empty tree; CI wiring is deferred until P1 puts content in.

4. **Plan corrections** — the two drifts above (host surface list; root vs browser target) are material and recorded here so the next phase starts from the real contract.

## Alternatives considered

- **Swap the 3d_editor imports now.** Rejected because the host consumes packed tarballs (`file:../faijs/faicad-faijs-*.tgz`); swapping against the current pack would break the build, and repacking requires a version bump (a release decision).
- **Make the host import from the root entry `@faicad/faijs`.** Rejected — the host's contract test (red line: production code must not import the root entry) forbids it; the only legal host entry is `/browser`, plus a whitelist addition that must land with the swap.
- **Skip the eleven-field contract test** because individual field tests already exist in `runtime.test.ts` / `topology-naming.test.ts`. Rejected: no single test asserts the whole `ExecutionResult` shape at once, so a silently dropped field could slip through; the plan itself names the missing `naming` field as the motivation.
- **Land the whole vendored tree structure + two-stage build rewiring now.** Rejected: with no vendored content, an empty `tsconfig.vendored.json` has no inputs and a two-stage build would fail; the configuration and scripts are ready, the build rewiring belongs to the phase that introduces content (P1).

## Consequences

- The acceptance suite is the primary regression guard for the whole port: run `npx vitest run faijs/refactor-acceptance/refactor-acceptance.test.ts` from `packages/tests`.
- At host-swap time (after the next faijs pack), 3d-editor must add `drill` and `engrave` to its whitelist (`WHITELIST_D` in contract-entry.test.ts) as part of the migration.
- `npm run build` for `core` is unchanged for now; the vendored two-phase compile will be wired in P1.
- License (root `LGPL-2.0-only` vs Apache-2.0 ported code) and the brepjs upstream commit lock remain open owner decisions to close before P1 lands code.