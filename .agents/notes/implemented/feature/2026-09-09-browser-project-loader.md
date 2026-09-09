# Agent Note: Browser ProjectLoader + demo Open Folder — multi-file `.fai.js` support in the browser host

Status: implemented

English | [中文](2026-09-09-browser-project-loader.zh.md)

## Problem

The engine's multi-file support (ModuleRegistry + `HostPorts.projectLoader`, P5) was wired to the filesystem on the Node side (fs ProjectLoader + CLI + `entryKey`), but the browser host had no loader at all: `createBrowserPorts` accepted no `projectLoader`, so any script with relative `.fai.js` imports (e.g. the mini_lathe assembly) failed in the demo with missing bindings. The demo also had no way to open a project folder, only single files.

## Decision

1. **`browser-host/directory-project-loader.ts`** — `createDirectoryProjectLoader(rootHandle, opts?)` wraps a File System Access API directory handle (`FsDirectoryHandleLike`) into a `ProjectLoader`. `listModules()` is synchronous and cached (the `ModuleRegistry` calls it without `await`); `refresh()` re-enumerates so every demo run sees current contents. Enumeration walks `for await (… of handle.entries())`, keeps only `*.fai.js` files, skips `node_modules`, `.git`, `out`, `dist`, `.wpblock`, builds POSIX-relative keys, and throws loader errors wrapped with `cause` (lint rule preserve-caught-error).
2. **`createBrowserPorts`** — accepts `projectLoader` and returns it in `HostPorts`; absent → `undefined` (single-file behavior unchanged).
3. **Demo Open Folder** — an `Open Folder` button calls `window.showDirectoryPicker()` (File System Access API, guarded for environments where it is missing), builds a `DirectoryProjectLoader` on the returned handle, seeds the example dropdown with `__proj:` entries, and runCode refreshes the loader, passes loader + `entryKey` to both brep/mesh `createBrowserPorts` calls, and shows a `Project: <root> (<entry>)` status prefix.
4. **`autoLiftFor` per-library override (`LibLoader.options`)** — new engine knob: `autoLiftFor(packageName)` beats the global `autoLift`. Discovered while verifying the browser assembly: the demo's global `autoLift: true` compat-wrapped every bare `@faicad/cq-compat` function, and the compat boundary's `borrowDeep` replaces faijs Shape arguments with brepjs borrow views, so `cq.constraint`'s face selection crashed (`E_OP_FAILED` → bbox on a shape with no `positions`). The CLI (which uses `autoLift: false`) ran the same assembly fine. Per-library `autoLiftFor` lets the demo keep global `autoLift: true` (still needed for genuinely bare libs like sheetmetal) while running cq-compat unwrapped — CLI-equivalent behavior.
5. **Testing** — unit tests for `createDirectoryProjectLoader` (fake in-memory handles: enumeration, `refresh()`, `ModuleRegistry` integration seeding, `MODULE_NOT_FOUND`), `createBrowserPorts` injection passthrough, and `autoLiftFor` precedence (false → function kept unwrapped; `undefined` → global autoLift true → compat-wrapped). Demo e2es: mini_lathe assembly, a pure-cad multiproject fixture, empty folder, and built-in-example switch-back.

## Verification

- Core suite: 90 test files, 1310 passed / 10 skipped. cq-compat: 31 passed. Demo e2e: 20/20 including the previously failing "Open Folder: mini_lathe assembly (brep multi-file relative import) + STEP (ISO-10303-21, ADVANCED_FACE)".

## Alternatives considered

- **Make the compat boundary not borrow faijs Shape args** (or round-trip them back to Shapes) inside `compatOp`: rejected — changes vendored-bridge semantics for every compat lib/LES and risks the established `admitCompatLib` contract; the failure was specific to shape-consuming cq-compat functions under the browser's global lift.
- **Demo global `autoLift: false`**: rejected — that would untrack sheetmetal (a genuinely bare lib) and gear from the compat/statement boundary, changing the browsing demo behavior for those examples; per-library opt-out is narrower.
- **IndexedDB handle persistence a la BREP.io**: rejected for v1 — demo is a single-session test vehicle; a session handle suffices (moved to v2 with 3d_editor).
- **Async `listModules`**: rejected — the engine calls it synchronously; the loader caches the module list and refreshes lazily.

## Consequences

- The browser host is now feature-call-compatible with the fs loader for multi-file projects; hosts that want more than one project root must construct a loader per root.
- `window.showDirectoryPicker()` requires a secure context (localhost OK); unsupported browsers need a fallback (open-file only).
- `autoLiftFor` is an additive knob: hosts that never set it behave exactly as before.
- Known gap carried from P5: projects re-read sources on every run (no fingerprint caching yet).