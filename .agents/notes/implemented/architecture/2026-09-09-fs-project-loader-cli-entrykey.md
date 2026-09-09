# Agent Note: fs ProjectLoader + CLI wiring + entryKey — mini_lathe deduplicated through real file imports

Status: implemented

English | [中文](2026-09-09-fs-project-loader-cli-entrykey.zh.md)

## Problem

`packages/mini_lathe` duplicated the whole `config.py` constant block and the `make_*` helper functions inside every one of its 7 part scripts (the Python original imports them instead). The engine already had multi-file support (`ModuleRegistry` + `HostPorts.projectLoader`, P5), but nothing connected a real filesystem: no host-side loader existed, the CLI never injected one, and the main module got no module key at all (`loadDirectModuleImports` called `resolveImports` without a `baseKey`), so an entry file in a subdirectory resolved its own `./x.fai.js` imports against the wrong base. Named import of plain constants was evaluated and **rejected** — see `.agents/notes/rejected/architecture/2026-09-09-named-import-of-constants.md`; namespace imports (`import * as config from ...`) are the accepted form.

## Decision

1. **`node-host/fs-project-loader.ts`** — `createFsProjectLoader(rootDir)`: recursively enumerates `**/*.fai.js` under the root, keys are POSIX-style paths relative to the root, `readSource` reads from disk per call (no caching: the loader returns current contents every call, keeping edit-rerun semantics trivially consistent). `findProjectRoot(entryFile)`: walks up from the entry file to the nearest directory containing `package.json`; an explicit `--project-root` CLI flag overrides it.
2. **CLI wiring** (`node-host/cli.ts`): `cliCheck`/`cliRun` compute the project root from the entry file, inject `projectLoader`, and pass `entryKey` (the entry file's path relative to the root). `--project-root <dir>` is available on both commands.
3. **`ExecuteOptions.entryKey`** (`cad-runtime/runtime.ts`): `execute`/`append`/`update` forward it to `loadDirectModuleImports`, which now passes it as `baseKey` to `resolveImports`. Absent → `undefined`, preserving the previous single-file-at-root behavior; existing callers are unaffected.
4. **Sub-module BREP solids register into the main runtime**: `runDirectModule` was constructing its `DirectExecutor` without the `setSolid` hook, so shapes produced inside dependency modules never reached the main `solidCache` — a STEP export of an assembly whose parts live in imported modules fell back to per-part multi-terminal output. The hook is now attached in `runDirectModule` (after `ensureBrepChain()`, which was also reordered to run before dependency loading so imported modules execute with the kernel initialized).
5. **`autoLoadLibsFromImports` skips relative specifiers**: a namespace import with a relative specifier (`./config.fai.js`) is a module import, not a library; the auto-loader previously tried to resolve it as a lib and failed. Relative specifiers are now excluded there.
6. **mini_lathe refactor**: new `src/config.fai.js` holds all shared constants + the `pin_holes` helper (now taking the hole radius explicitly — module-level `const` is not visible inside function bodies on the no-IR channel, an existing `DirectExecutor` scoping rule; the helper depends on it explicitly instead of closing over a magic number). The 7 part scripts and `assembly.fai.js` import from it / from each other, mirroring the Python original's `import config` / `from bottom_plate import bp`.

## Verification

- `bottom_plate` byte-identical STEP before vs after the refactor (only header timestamp differs); remaining 6 parts and the assembly exported before the refactor as baselines, then re-exported: all byte-identical except the assembly, whose internal entity numbering shifted (same 11375 entities, same member names/order, same `COLOUR_RGB` set — structure-equal after masking `#id` and timestamps).
- `module-registry.test.ts` + `direct-executor.test.ts` + `cli.test.ts`: 81 passed. `packages/tests` multifile suite: 8 passed. Lint + core typecheck clean.

## Alternatives considered

- **Project root = the entry file's directory**: rejected — it breaks cross-directory references (a `config.fai.js` at the package root would be unreachable from `src/parts/*` entries) and single-part exports would each resolve a different root.
- **A `.fai-project.json` marker file as project root**: rejected — one more convention file every existing `.fai.js` project would need; `package.json` is already the de-facto root marker in this monorepo.
- **Named import of plain constants (`import { OUTX } from ...`)**: rejected — see `.agents/notes/rejected/architecture/2026-09-09-named-import-of-constants.md`; namespace imports are the accepted form and match how the Python original actually uses `config`.
- **Cache module sources by fingerprint inside the fs loader**: deferred — P5 leaves fingerprint-based caching as an open engine-side gap; the loader deliberately re-reads every call so hosts stay thin and edit-rerun stays trivially consistent.

## Consequences

- Any Node consumer can now run multi-file `.fai.js` projects from disk through the CLI with zero host code; browser hosts still need to inject their own `projectLoader` (unchanged).
- `entryKey` must be supplied by hosts whose entry files are not at the project root; the CLI does this automatically.
- Known gap carried over from P5: modules reload on every `execute`/`append` call (no fingerprint caching yet).
