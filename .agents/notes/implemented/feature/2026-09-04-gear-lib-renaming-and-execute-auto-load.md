# Agent Note: specifier-validated registerLib + host libLoader auto-load at execute time

Status: implemented

English | [中文](2026-09-04-gear-lib-renaming-and-execute-auto-load.zh.md)

## Problem

Third-party libraries were loaded by a fallible name: host code injected a namespace under a binding name (`registerLib('gear', ns)`), and a script's `import * as gear from '<specifier>'` was matched by **binding name**, not by the import specifier. `derivePackageName` normalizes the specifier (`gear-lib-demo` → `gear-lib-demo`, `@scope/pkg/sub` → `@scope/pkg`), but nothing validated that the specifier actually named the registered package, so a renamed library kept running under an unqualified specifier and the mismatch was silent. The `@faicad/mech-lib` → `@faicad/gear-lib-demo` rename surfaced exactly this: after the rename, a script could still `import ... 'gear-lib-demo'` even though the engine only knew the previous package identity. Auto-loading was also entangled with parse time (host manual injection), so a browser app had to wire `registerLib` calls and duplicate the engine's parse logic.

## Decision

Two mechanics fix the load mismatch root cause and make execution self-contained:

1. **Specifier-validated registration**: `registerLib(binding, ns, { default?, compat?, packageName? })` records `specifierToBinding.set(packageName, binding)`. The parser derives the canonical `packageName` from the import specifier (a stripped first segment). `check()` compares, in the import-specifier loop, each script import's `packageName` against the registration table (or the loader's `listLibs()`); a mismatch is a `stage:'symbol'` error — no silent fallthrough. The pre-check additionally declares which namespaces are deferred to execute (auto-loadable).
2. **Execute-time auto-load**: `HostPorts.libLoader` is an optional host capability: `{ loadLib(packageName): Promise<StdlibNamespace>, listLibs(): string[], options?: { compat?: boolean } }`. `autoLoadLibs(scriptIR)` runs inside `executeIR`, `updateIR`, and `appendIR` — before `compileToModule` — and `registerLib`s every namespace import that is not already bound, with `{ compat, packageName }` derived from the loader; a failing `loadLib` becomes an `ExecutionResult.failedAt` (import-level message) rather than a runtime TypeError on the namespace. `check()` stays synchronous (only `listLibs()`), deferring member resolution to execute.

The framework deliberately does **not** auto-load at parse time: `parse` is synchronous, and loading is a host I/O concern. The split keeps `parse` a pure function of text while letting every host (Node CLI, browser demo, vitest) supply one by same `libLoader` contract. The demo shows the pattern: a static `LIB_MODULES` mapping from literal specifier to a lazily-imported namespace (literal `import()` so Vite/Rollup can statically bundle it), injected via `createBrowserPorts({ libLoader })`.

The `mech-lib` name is gone everywhere — the package is `@faicad/gear-lib-demo`, registered bindings and script specifiers use `gear-lib-demo`. Specifier normalized by `derivePackageName` is the single source of truth.

## CLI and demo loader details

Node CLI (`packages/core/src/node-host/cli.ts`) ships a whitelist loader (`CLI_ALLOWED_LIBS`): `loadLib` maps the script's short specifier (`'gear-lib-demo'`) and the scoped name (`'@faicad/gear-lib-demo'`) to the real module via `await import(pkgName)`; `listLibs` returns the accepted specifiers. The demo (`packages/demo/main.ts`) uses a literal-key `LIB_MODULES` map whose values are static `import()` of `@faicad/gear-lib-demo`, so the mapping is statically bundleable: `'gear-lib-demo' → async () => gearLib`; the demo's vite alias redirects the scoped package to `packages/gear-lib-demo/src/index.ts`. This shares the same execute-time auto-load mechanism: the script says `import * as gear from 'gear-lib-demo'`, the loader returns the namespace, and `registerLib('gear', ns, { compat, packageName: 'gear-lib-demo' })` happens without any manual wiring inside `runCode`.

## Failure semantics

- Loader present but the specifier is not in `listLibs()` → `check()` fails the import loop at ① — explicit, never silent.
- Loader absent → falls back to the specifier table (`specifierToBinding`), with the old `registerLib` manual path intact.
- `loadLib` throws/rejects at execute → `ExecutionResult.failedAt` with `message: 'import specifier "…" cannot be auto-loaded: …'` — the script fails loudly, showing the mismatched specifier instead of a late TypeError on `ns.binding`.

## Alternatives considered

- **Keep parse-time auto-load** (auto `registerLib` inside `parse`). Rejected: `parse` must remain synchronous (pure text→IR); side-effectful I/O during parse breaks the parser's contract and every consumer.
- **Host dynamic `import(name)` with a bare variable** in the browser loader. Rejected: Vite/Rollup cannot statically analyze a variable specifier — production builds would leave a raw dynamic import that 404s in the browser; the static `LIB_MODULES` table + literal specifier is bundle-safe.
- **Binding-name-only `registerLib` with no specifier table** (status quo). Rejected: it is exactly the silent-mismatch bug — a renamed library kept running under a stale name if the host accidentally injected the right namespace under nothing.
- **CLI wildcard loading of any package name.** Rejected: a CLI must not load arbitrary specifiers from disk; the whitelist is the security boundary; the loader falls back to `import()` for whitelisted names only.

## Consequences

- The rename to `gear-lib-demo` is specifier-complete: scripts importing `'gear-lib-demo'` with the gear package now bind through `gear-lib-demo`; the mismatch case is a loud, scoped error instead of dead-silent behavior.
- Browser apps (including the demo) no longer hand-wire `registerLib` for script imports — the `libLoader` is the single extension point.
- Incremental `updateIR`/`appendIR` also run `autoLoadLibs` so libraries come up on any path; re-running `executeIR` with an already-registered binding is a no-op (does not overwrite a host-injected instance `moduleMap`).
- The engine remains parse-synchronous everywhere: no async leaks into `parse`/`check` (check only reads `listLibs()` synchronously).