# Determinism scanner integration into execution flow

English | [中文](2026-09-22-determinism-scanner-integration.zh.md)

**Date**: 2026-09-22
**Status**: implemented

## Decision

Integrate the B-tier taint determinism scanner (`determinism-scanner.ts`) into the
`.fai.js` execution flow so that every `execute` / `append` run is automatically
gated before geometry execution begins.

## Policy default

`CadRuntimeOptions.determinism` defaults to **`'error'`** — violations abort
execution via `failedAt` with code `E_DETERMINISM`. This enforces the
reproducibility contract (docs/reproducibility-contract.md) for exchange-grade
`.fai.js`. `'warn'` collects violations into `ExecutionResult.infos`; `'off'`
disables.

The user explicitly chose `error` as the default (over zero-regression `off`)
because the project goal is a deterministic exchange format — a `warn` default
would allow non-deterministic geometry to ship silently.

## Insertion points

1. **Main file** — `runtime.ts executeDirectText` / `appendDirectText`, after
   `extractMetadata` and before `de.execute` / `de.append`. The gate reuses
   `meta.imports` to derive `extraNamespaces` / `extraCallees` scan hints.
2. **Project modules** — `module-registry.ts ModuleRegistry.load`, after
   `extractMetadata`. `ModuleRegistry` receives `determinismPolicy` as a 4th
   constructor arg; violations throw `ModuleRegistryError('MODULE_SECURITY')`,
   which `loadDirectModuleImports` already maps to `failedAt`.
3. **Library source** — `runtime.ts runDeterminismGate`, via
   `ports.libLoader.loadSource(packageName)`. Node-host `cliPortsLibLoader`
   implements `loadSource` (resolve `package.json` → prefer `src/index.ts`,
   fall back `dist/index.js`). Browser host does not provide `loadSource` →
   library scanning is skipped (graceful degradation, no error).

## Bug fixed during integration

`determinism-scanner.ts handleCall` did not propagate callee-object taint to
the call result. `const d = new Date(); const r = d.getSeconds()` left `r`
untainted because `getSeconds()` has no tainted **arguments**. Fix: when the
callee is a `MemberExpression` whose object is neither a geometry namespace nor
a safe container, `evalTaint(obj)` taint propagates to `resultTainted`.

## Observation: .fai.js parser strictness

`metadata-extractor.ts collectExprIdentifiers` runs **lenient** for declaration
RHS (`const r = Math.random()`) but **strict** for op positional arguments
(`cad.sphere(Math.random())` — rejects `Math` as unknown identifier). Therefore
non-deterministic sources must be stored in a variable before flowing into
geometry — which is exactly the taint-propagation pattern the scanner targets.
Inline `cad.sphere(Math.random())` is rejected by the parser before the gate
runs; `const r = Math.random(); cad.sphere(r)` reaches the gate and is caught.