# Agent Note: P0 Prefix-Replay Incremental Update

Status: implemented

English | [中文](2026-09-08-p0-prefix-replay-incremental-update.zh.md)

## Problem

The `direct` execution path (no IR) had no incremental update capability — every `runtime.update(oldCode, newCode)` call re-executed the entire script from scratch, losing the performance advantage that `update` is supposed to provide. The module path had content-addressed incremental execution, but the direct path (which is the primary path since P6) lacked any equivalent.

## Decision

Implement **prefix-replay incremental update** for the direct execution path. The core idea: find the first changed line between old and new code, preserve the persistent `ctx` state up to that point, and replay only the suffix (from the changed unit to the end).

### Architecture

1. **Unit ranges** (`DirectExecutor.unitRanges(code)`): parse-only pass that maps physical lines to logical "units" (simple statements, blocks, function definitions), each with `lineNo` and `endLine`. Used to find the replay start line when a change falls inside a block.

2. **`replayFrom(code, startLine, opts)`**: the core replay method on `DirectExecutor`. Steps:
   - Compute `replayKeys` = `suffixWrites - prefixWrites` (variables written in the suffix that are NOT also written in the prefix). This formula ensures prefix-defined variables that are reassigned in the suffix are NOT deleted from ctx (they need their previous value as input).
   - Clear `executedLines` / `keepByLine` / `blockOutputs` entries ≥ `startLine`.
   - `clearRoundState()` — clear `changedSet` and `kinematicsOut` from the previous round.
   - Delete `replayKeys` from `ctx`.
   - `runCode` with pre-parsed units (avoids re-parsing).

3. **`stableFingerprint(value)`**: deterministic FNV-1a hash for arbitrary values. Normalizes `null`/`undefined`, sorts object keys, handles circular references with depth limit + `WeakSet`, and degrades functions/symbols to type-tagged constants. Used by gates G6/G7/G8 to detect param/lib/partTransform changes.

4. **`releasePartCaches(partNames)`**: precise cache invalidation before replay — releases OCCT handles (`kernel.release`), clears `solidCache` / `meshShapeCache` / `faceEvolutionCache` / `roleTableCache` / `topologyCache` / `statementCache` entries for the affected parts.

5. **`updateIncremental(oldCode, newCode, opts)`**: the main flow on `CadRuntime`. Conservative gates G0–G8 determine whether incremental is safe; any gate failure degrades to full re-execution (`executeDirectText`).

### Conservative gates (G0–G8)

| Gate | Condition | Action |
|------|-----------|--------|
| G1 | Never executed (`accumulatedCode === null`) | Full execute |
| G2 | New code shorter than old (deletion) | Full execute |
| G3 | `oldCode` ≠ internal `accumulatedCode` | Full execute |
| G0 | Non-standard parse baseline (`lineOffset !== 0`) | Full execute |
| G6 | `opts.params` fingerprint changed | Full execute |
| G7 | Registered library set changed | Full execute |
| G8 | `opts.partTransform` fingerprint changed | Full execute |
| G5 | Previous round produced kinematics | Full execute |
| G4 | Contains relative import specifiers | Full execute |

### Zero-change path (§4.6)

When `firstDiff === -1` (old and new code are line-by-line identical after trim), no statement executes. `clearRoundState()` is called, and `collectDirectResult` assembles the result from persistent ctx. `changed` is `undefined` on this path.

### Failure degradation (§4.7)

If `replayFrom` produces `failedAt`, the executor resets and falls back to `executeDirectText(newCode)` — the result matches a fresh full execution's failure.

## Alternatives considered

1. **Full re-execution always**: Rejected — defeats the purpose of `update`. The persistent ctx advantage (OCCT handles, topology caches, mesh caches) is wasted. Prefix replay preserves all prefix work.

2. **Line-level diff (like module path's content-addressed cache)**: Rejected for P0 — the direct path has no IR, no per-statement identity keys, and no DAG. A line-level diff with content keys would require building an IR-equivalent, which is explicitly out of scope for P0. Prefix replay is the simplest correct approach: it re-executes a contiguous suffix, which is always correct (just not always minimal).

3. **AST-level diff (tree edit distance)**: Rejected — too complex for P0, and acorn AST nodes are not stable across edits (node identity is meaningless). The line-level trim comparison is simple, fast, and correct for the common case (single-line edit, append, comment change).

4. **Run-time try-catch fallback (mesh → brep)**: Rejected — the project's red line forbids run-time fallback. BREP chain availability is determined by static rules before execution, not by catching errors during execution.

## Consequences

- `runtime.update()` now uses incremental prefix-replay on the direct path, restoring the performance benefit of `update` over `execute`.
- 22 new tests in `update-incremental.test.ts` verify: unitRanges mapping, replayFrom equivalence, stableFingerprint properties, update equivalence parity (5 scenarios), zero-change path, reassignment chain (replayKeys formula), gate degradation (G2/G3), and failure degradation.
- `ExecuteOptions` gains `beforeStatement` hook (documented in `api-contract.md`).
- `changed` semantics documented: `undefined` on zero-change path, populated with replayed variables otherwise.
- `clearRoundState()` is called in both `replayFrom` (before suffix execution) and `zeroChangePath` (before result assembly), ensuring no stale `changed`/kinematics from the previous round.
- `stableFingerprint` uses FNV-1a (32-bit), not cryptographic — its only requirement is determinism and collision resistance for small param objects, not security.
- The `??` operator precedence bug in `stableFingerprint` (symbol description concatenation) was fixed during testing.
