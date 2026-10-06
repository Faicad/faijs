# Agent Note: API test coverage gate (source-based, per-package)

Status: implemented

English | [中文](2026-10-06-api-export-coverage-gate.zh.md)

## Problem

The previous coverage gate (`packages/core/scripts/check-api-coverage.ts`) had three design flaws:

1. **Read `dist` instead of source**: the export surface was loaded from compiled JS, requiring a build before the gate could run and risking dist/src drift.
2. **Cross-package reverse dependency**: the core package's script scanned `faijs-extra`, `sketch`, and `draw` — packages that core should not know about.
3. **Token matching, not parameter coverage**: the gate checked only that a function name appeared as a word-boundary token in test source. It could not tell whether any parameter was actually exercised.

## Decision

A new gate (`scripts/check-api-test-coverage.ts`) replaces the old one. It is source-based, per-package, and enforces two levels:

- **L1 (function coverage)**: every value export (function, op, class, const) from the package's `package.json` `exports` must be referenced by name in the package's `test/` files or `.fai.js` fixtures.
- **L2 (parameter coverage)**: for ops, every schema/JSDoc-declared parameter must appear as a property name at a call site in tests. For non-op functions, only option-container parameter properties are checked (positional params like `shape`/`part` are verified by L1 only).

The gate uses the TypeScript Compiler API to parse source files (not `dist`), so it runs without a build. Each package runs its own gate; core does not scan other packages.

## Coverage method

### Export surface extraction (P2)

1. Read `package.json` `exports`, map each concrete key to its source `.ts` file (dist mirrors src).
2. Build a `ts.Program` from the entry points; use `checker.getExportsOfModule` to get all exported symbols.
3. Follow re-export chains via `resolveSymbol` (alias resolution).
4. For ops (`defineOp`/`compatOp`), extract parameters from (in priority order):
   - `schema` field keys (most reliable)
   - JSDoc `@param` tags (handles dotted names like `@param params.depth`)
   - `paramDims` keys (partial but reliable)
5. For non-op functions, extract from TS signature; only option-container params (`options`, `params`, etc.) have their properties checked at L2.

### L1/L2 gate (P3)

- Parse test files and `.fai.js` fixtures as AST.
- Collect all identifiers (L1) and call-site object-literal property names (L2).
- Report `API — missing [params]` for any gap; exit non-zero.

### Baseline mechanism (P4 transition)

The initial gap was large (244 L1 + 58 L2 across all packages). A baseline file (`api-coverage-baseline.json` per package) records known gaps. The gate only fails on gaps **not** in the baseline — this prevents regression while allowing P4 to close gaps incrementally.

- `--generate-baseline`: writes the current gaps as the baseline file.
- When a baseline gap is closed by a new test, it is automatically removed from the next `--generate-baseline` run.
- When all gaps are closed, the baseline file can be deleted; the gate prints a reminder.
- The baseline file is tracked in git for team consistency.

## Test directory migration (P1)

All `*.test.ts(x)` files migrated from `src/` to `test/` per package. Configuration updated: `vitest.config.ts` includes `test/`, `tsconfig.build.json` excludes it. One-time migration scripts (`migrate-tests-to-test-dir.mjs`, `fix-*.mjs`) deleted after use.

## Alternatives considered

- **Runtime `dist` scanning** (old approach): rejected — couples gate to build, dist/src drift risk.
- **Cross-package scanning from core** (old approach): rejected — creates reverse dependency, violates package autonomy.
- **Token matching only** (old approach): rejected — cannot verify parameter coverage, the user's explicit requirement.

## Consequences

- New exports without tests fail CI immediately.
- New parameters on existing ops fail CI until a test exercises them.
- The gate runs without `npm run build` (source-based).
- Each package owns its own coverage (`check:api-coverage` script in each `package.json`).
- Old `packages/core/scripts/check-api-coverage.ts` and `list-exports.ts` deleted.
