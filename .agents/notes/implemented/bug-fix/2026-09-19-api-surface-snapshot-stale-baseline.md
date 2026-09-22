# Agent Note: api-surface-snapshot stale baseline gotcha (2026-09-19)

Status: implemented

English | [中文](2026-09-19-api-surface-snapshot-stale-baseline.zh.md)

## Problem

`scripts/api-surface-snapshot.json` (the P0 export-surface baseline) lagged the real export surface: the snapshot was missing `sketch / extrude / revolve / edgeRef / faceRef` and several subpaths such as `./browser` differed from the latest `dist/` build by 300+ lines.

## Root cause

The snapshot script `scripts/api-surface-snapshot.mjs` has only two trigger moments:
1. Manual run of `node scripts/api-surface-snapshot.mjs` (CI step 5 runs it, but **only asserts subpaths are importable without error — it never asserts "snapshot matches current dist"**; whether the snapshot file itself is stale is not its concern);
2. A developer manually updates the baseline (runs it and commits).

The export changes in `packages/core/src/api/index.ts` (8e782e6 added sketch/extrude/revolve, a7792f8 added edgeRef, 0638a52 added faceRef, 702f7ed added extrude/revolve) never re-generated the snapshot — **the export surface changed, the baseline did not follow, and the snapshot went silently stale**.

Another premise: the snapshot imports `dist/` (`require.resolve('@faicad/faijs')` → `packages/core/dist/index.js`). dist is a build artifact and gitignored, so the "fresh dist + stale snapshot" combination is completely invisible in git until someone rebuilds and manually diffs.

## Decision

Run `node scripts/api-surface-snapshot.mjs` to regenerate the baseline (326 line insertions, including the 5 missing exports plus the newly expanded `./api/*` wildcard subpaths), verified key-by-key against dist.

## GOTCHA (regression guard)

- **GOTCHA**: after adding/removing exports in `packages/core/src/api/*`, you must re-run `node scripts/api-surface-snapshot.mjs` and commit the new snapshot; otherwise the CI "export-surface guard" (ci.ps1 step 5) is toothless — it only checks that imports do not error, not that the snapshot is fresh.
- **GOTCHA**: `require.resolve('@faicad/faijs')` resolves to `packages/core/dist/`, so the snapshot script must run **after** `npm run build`; running before build captures the old dist's export surface and "re-baselines" the stale snapshot.

## Alternatives considered

- **Rely on manual diffing of snapshot vs dist after each build**: rejected. It is completely invisible in git (dist is gitignored) and only surfaces when someone rebuilds and diffs by hand — effectively luck.
- **Add a CI freshness hard check for the snapshot** (e.g. `git diff --exit-code scripts/api-surface-snapshot.json`, or an in-script "generated vs on-disk snapshot" comparison that exits 1 on mismatch): not adopted, left for later — recorded as a future improvement; this change restores consistency by regenerating the baseline.
- **Regenerate the baseline immediately** (adopted): snapshot now matches dist key-by-key and the CI export-surface guard is effective again.

## Consequences

- `scripts/api-surface-snapshot.json` regenerated (326 line insertions, 5 missing exports + wildcard subpath expansion), key-by-key consistent with dist; the export-surface baseline is fresh again.
- Regression GOTCHAs documented: re-run and commit the snapshot after export-surface changes; run the script only after `npm run build`.
- Not implemented: CI snapshot-freshness hard check (future improvement, recorded under Alternatives).
