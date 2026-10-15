# Agent Note: CLI library-source probe order — ship-first, so the strict determinism gate is satisfiable

Status: implemented

English | [中文](2026-10-15-cli-lib-source-probe-order.zh.md)

## Problem

The node host's `cliPortsLibLoader.loadSource` probed `src/index.ts` **before**
`dist/index.js`. The runtime determinism gate hands whatever it returns to
`scanDeterminism(..., { strict: true })`, whose contract is "libraries must ship
compiled JS": TS syntax is a hard error, not something to strip. So for any
library whose package directory contains its TS sources, the host handed the
scanner a file the scanner is required to reject.

The package directory **is** the repo root in both normal dev layouts — a
workspace-linked member, and a `file:` self-link. Observed 2026-10-15 in the
standalone `faijs-cadquery` repo, whose documented dev setup is exactly a
`file:.` self-link: all 33 cases of its `parity-smoke` stage-D suite (the suite
that shells out to the host CLI) failed before executing anything, with

```
SyntaxError: [determinism] library source is not valid plain JavaScript at line 160:7
   (type stripping is not supported; libraries must ship compiled JS): Unexpected token (160:7)
```

The gate threw inside `cliRun`, so no mirror script could run through the host
CLI at all — a red release gate for a library whose built artifact was correct.

## Decision

Probe ship-first: `dist/index.js` → `src/index.js` → `src/index.ts`. The scanner
receives the artifact that actually runs. The strict throw stays as the terminal
case, so a TS-only library (no `dist`, no JS) still trips the contract exactly as
before — the gate keeps its teeth.

## Alternatives considered

- **Strip TS in the host before scanning (sucrase).** Rejected: the strict
  contract exists precisely to forbid stripping. The audit script
  `packages/core/scripts/determinism-cli.ts` strips because it catalogues a repo
  tree; it does not define the runtime contract. Two policies for one rule would
  be worse than the bug they hide.
- **Keep src-first and fall back to dist when src is not plain JS.** Rejected:
  same net effect for every TS library, but it encodes "read the TS, notice it is
  TS, read something else" — a silent fallback inside the one gate whose stated
  value is the absence of silent fallbacks.
- **Change the consumer's dev layout (a self-link that exposes only `dist`).**
  Rejected: `package.json` with `src/` beside it is the normal layout of a
  standalone faijs library and of every workspace member. A fix that requires
  restructuring each consumer repo leaves the host-side trap armed for the next
  one.

## Consequences

- A workspace-linked or self-linked library is scanned through its build output,
  so the scan covers what ships. A stale `dist` is scanned as stale — the build
  step is already a precondition of both the CLI and the test suite.
- Same-package call sites that still wired `cad` by hand were removed:
  `scripts/faijs-cli.ts` no longer passes `{ cad: createApiNamespace() }` (that
  argument now throws `E_CAD_RESERVED`), and `execute-script.ts` no longer
  re-registers `cad` after `createRuntime` — the reserved-name guard in
  `createRuntime` had made that branch unreachable.
- `packages/core/test/node-host/cli-lib-source.test.ts` pins both sides: the
  dist source must pass the strict scan, and the same package's `src/index.ts`
  must still throw.

## Verification

- `npx vitest run --root packages/core test/node-host/cli-lib-source.test.ts` —
  2/2 green (dist passes the strict scan; `src/index.ts` still throws).
- Consumer side, `faijs-cadquery` against a `@faicad/faijs` build carrying this
  change: `parity-smoke` + `shape-filter` + `kernel.probe` 49/49 green, where the
  same three files were 32 cases red before.
