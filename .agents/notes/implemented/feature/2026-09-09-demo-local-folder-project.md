# Agent Note: Demo local-folder project loading — directory loader moved from core into demo, plus a full zip channel

Status: implemented

English | [中文](2026-09-09-demo-local-folder-project.zh.md)

## Problem

The browser directory project loader (`createDirectoryProjectLoader` + types) had been implemented inside `packages/core`. The bundle is wrong: every part of it is a strategy — where the project root is, which files count, which directories to skip, when the entry list is refreshed. The other browser-host members (`BrowserEventSink` / `BrowserFontProvider` / `FetchAssetResolver` / Worker backends) are environment-neutral adapters with exactly one shape per environment. The node-side loader is core-implemented *and* core-consumed (the CLI); the browser one had zero consumers in core and exactly one consumer at `packages/demo/main.ts`. In addition, multi-file projects could only be opened through the File System Access directory picker, which requires a real user gesture — so no CI or automated test could ever exercise a real multi-file project end-to-end.

## Decision

1. **The directory loader moves out of core into `packages/demo/src/project/` (D1).** `folder-loader.ts` is the same implementation moved verbatim (renamed `createDirectoryProjectLoader` → `createFolderProjectLoader`); `shared.ts` holds the constants/pure functions both channels use (`FAI_SUFFIX`, `DEFAULT_SKIP_DIRS`, `escapeError`, `isSkippedDir`, `pickEntryKey`, `errMessage`); `types.ts` projects the engine contract without deep-importing core internals; `pick.ts` is the single module touching `window.*`. `createBrowserPorts({ projectLoader })` passthrough stays (D2): the loader is injected like any other HostPorts field.
2. **`autoLiftFor` stays final (D3).** It is unrelated to multi-file support and fixes the independent demo-vs-CLI `autoLift` defaulting gap; reverting it would immediately break the demo assembly (existing e2e depends on the demo running the assembly without the global lift). Recorded separately so this decision is not lost in the rejected-note status.
3. **Both project channels — folder and zip — live in the demo as app-level policy.** They share one common interface `DemoProjectLoader = ProjectLoader & { refresh(): Promise<void> }` (D14), so `ProjectState.loader` is interchangeable between them: same `moduleKey` convention, same escape-error text (via `escapeError`), same entry heuristic.
4. **zip channel uses `fflate` (D10).** `createZipProjectLoader(bytes, opts?)` builds a loader over an in-memory snapshot with `unzipSync`. No top-level directory stripping (D11/B3): the zip-relative path is the module key without exceptions, and correctness is carried by the entry heuristic. `pickEntryKey` uses suffix matching so a wrapped top-level dir still picks the assembly. Size guards (64 MiB / 5000 entries, R9) and `TextDecoder('utf-8')` decode (B2). `refresh()` is a no-op promise (D13) so the pre-Run refresh in `main.ts` is uniform across both channels.
5. **Demo gained unit tests** (D6): a `test` script, `vitest` dev-dependency, `vitest.config.ts` scoping `src/**/*.test.ts` (so the Playwright `e2e/demo.spec.ts` is excluded), and `fflate` declared in `dependencies` (R8: the ghost-dependency guard started scanning `packages/demo/src` once the folder appeared). The demo is appended to the CI test list; the lockfile diff is committed.
6. **zip fixtures are never committed as binaries (D12).** e2e build zips in memory with `fflate.zipSync`, so they never go stale and leave no artifacts.
7. **e2e now drives the zip channel with no stub** — `setInputFiles` delivers an in-memory buffer through a real `<input type=file>`, running the real `mini_lathe` project end-to-end in the browser for the first time (Z1), plus a wrapped-directory project (Z2), an empty zip (Z3) and a corrupt zip (Z4). The existing 20 cases pass unchanged, and `demo.spec.ts` had zero diff for the P1 move.

Verification: demo unit tests 19/19 (folder-loader 7 + zip-loader 12, incl. entry heuristic); core 89 files, 1301 passed/10 skipped; demo e2e 24/24; demo typecheck error set unchanged (the 3 pre-existing errors, line numbers drift only); ghost-deps guard OK.

One noted adaptation: the plan required keeping the `未授权访问文件夹: ${msg}` text verbatim, but the `pick` contract (missing-API throws, any rejection → null, never touches the status bar) drops the raw rejection message — preserving `${msg}` would mean passing raw rejection text out of `pick.ts`. The demo now shows the `未授权访问文件夹:` prefix with a fixed explanation (`用户取消或拒绝授权`) on cancel/deny, keeps the exact `File System Access API 不可用（…）` on missing API, and stays crash-free on every path.

## Alternatives considered

- **Keeping the directory loader in core**: the loader is pure policy; it had a single consumer (demo) and no core consumer; heirs only if the host env has a unique shape per environment.
- **A shared package for demo and 3d_editor**: rejected — there is one consumer; extract only when a second real consumer converges on the same implementation.
- **Replacing `fflate` with a hand-written zip parser**: rejected against the repo's "no untested code" rule — ~150 lines of new binary parsing vs an already-present MIT library.
- **Stripping the zip's top-level directory**: rejected (B3) — the module key rule must stay exception-free; suffix matching in `pickEntryKey` fixes selection without pretending the wrapper doesn't exist.
- **Committing binary zip fixtures**: rejected (D12) — they'd be stale and produce binary diffs.

## Consequences

- The `demo` app owns file-source policy; `core` hosts only the environment-neutral adapters. 3d_editor will re-implement its own project-file store in the same contract (`ProjectLoader`, `moduleKey`, `entry`, error-code semantics).
- zip becomes the automatable evidence between channels: it exercises the same code path with real multi-file data.
- Known gap carried: sources are re-read every run (no `fingerprint()` caching yet), same as before.