# Agent Note: brepkit boolean evolution format mismatch (union/cut/subtract crash)

Status: implemented

English | [中文](2026-09-26-brepkit-boolean-evolution-format.zh.md)

## Problem

`cad.union`/`cut`/`subtract` on brepkit crashed with `RangeError: Invalid array length`. The crash was not in the wasm kernel but in the adapter's `mapEvolution` data format contract.

## Root cause

brepkit `fuseWithEvolution` returns a mapping-form JSON: `{solid, evolution:{modified:{oldHandle:[newHandles]}, deleted:[oldHandles]}}`. The adapter's `mapEvolution` flattened `modified` into a bare hash list `[hash_a0, hash_a1, ...]` (one hash per modified input face). But the downstream `decodeEvolution`/`decodeHashEvolution` (face-evolution.ts) expects OCCT's segmented format `[inHash, count, outHash1, outHash2, ...]`.

The segmented decoder interpreted `modified[1]` (a ~170M FNV face hash) as `count`, then looped `outHashes.push()` 1.7 billion times, eventually throwing `Invalid array length`.

`fuseAll`/`fuse` simple paths did not crash because they bypass `mapEvolution` entirely.

## Decision

In `brepkitKernel.ts` `mapEvolution`:
1. Build a reverse `handle→hash` table (registry originally stores `hash→handle`).
2. Iterate `evo.modified`'s `{oldHandle: [newHandles]}` mapping, emitting one segment `[inHash, outCount, ...outHashes]` per entry; outHashes computed via `faceFingerprint` on the new face handles.
3. `deleted` similarly translated through the reverse table.
4. Added GOTCHA comment documenting the format trap.

`cutWithHistory`/`intersectWithHistory`/`filletWithHistory` share `mapEvolution` and are fixed together.

## Verification

- `brepkit-boolean-fix.test.ts` (5 cases): union/cut/subtract return valid geometry on brepkit, occt no regression, `evolution.modified` decodes without throwing.
- `multi-engine-op-parity.test.ts`: union/cut/subtract pass on occt + brepkit 2.129.15/3.4.18/4.0.32, bbox consistent.
- `brepkitKernel.test.ts`: 75/75 no regression.

## Alternatives considered

- **Adapting `decodeEvolution`/`decodeHashEvolution` to accept the flattened form** — rejected: face-evolution.ts's segmented format is the OCCT-authoritative contract shared by the occt history path; coupling the occt decode to brepkit's adapter format would leak a kernel-specific quirk into the shared layer.
- **Fixing at the op layer** — rejected: the bug is a data-format translation inside brepkit's kernel bridge; the adapter is the single layer that owns it (the fix is adapter-only).

## Consequences

- 3 ops no longer crash on brepkit.
- The fix is adapter-only; no op-layer or face-evolution.ts changes.
- Three brepkit versions behave identically — root cause is adapter format bug, not wasm kernel version difference.
