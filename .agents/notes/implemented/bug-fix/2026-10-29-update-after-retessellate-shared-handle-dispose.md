# Agent Note: shared-handle-aware dispose in CadRuntime solid cache

Status: implemented

English | [中文](2026-10-29-update-after-retessellate-shared-handle-dispose.zh.md)

## Problem

A weapp model (pikachu) crashed on device after the LOD-refine flow: `execute` →
`retessellate` (refine to L1) → AI edit → incremental `update`. The failure started as
`[smlib-kernel] getSubShapes(face): bridge failed (n=1001, …)`, escalated to
wasm `memory access out of bounds` on larger scripts, and on device surfaced as NaN
vertices → NaN camera → blank canvas (data intact).

Node worker-sim repro isolated the trigger: **without** `retessellate`, `update` passed;
**with** it, `update` always crashed — with or without `splitByPlane`. The crash therefore
lived in the `retessellate` × `update` interaction inside faijs.

A probe test plus a `disposeHandle` watch pinned the kill chain exactly (handle values
from the dump: ball=scaled=body=0x54…, eye=eyeMoved=0x54…):

1. smlib transform ops write back **in place** — `translate`/`scale3d` return the same
   handle — so several `solidCache` entries share one handle (eye=eyeMoved;
   ball=scaled=body).
2. `update`'s replay logic called `releasePartCaches(replayKeys)`, which freed the
   shared handle while a non-replayed sibling entry still referenced it. The sibling
   entry dangled, and the replay executed **on freed wasm memory** (ghost calls pass in
   node by luck; on device, reads of the freed heap produce NaN).
3. The replay on freed memory failed, so `update` degraded to a full re-execute. The
   allocator reused the freed block for a new solid, re-registering that address in the
   kernel's handle table. `setSolidAndTess` then disposed its **stale** prev handle —
   the guard `solidHandles.has(n)` passed because the address had a new live tenant —
   and killed the live solid.
4. Collect-time topology rebuild (forced because `retessellate` had emptied
   `topologyCache`) read the killed solid → SM_ERR 1001 → wasm OOB at scale.

The "control" path (update without refine) was not sound either: it passed only because
the replay happened to succeed on freed-but-intact ghost memory, with a topology cache
hit masking the rebuild. Both paths operated on freed memory before this fix.

## Decision

Handle disposal in `CadRuntime` is **sharing-aware: the last referencer frees**,
implemented at a single choke point (`packages/core/src/cad-runtime/runtime.ts`):

- `disposeSolidHandle` skips real deletion while any `solidCache` or
  `meshSolidRegistry` entry still references the handle (`isSolidHandleReferenced`
  scans both maps).
- Callers remove their own reference **first**, then dispose:
  - `setSolidAndTess` overwrites the cache entry, then disposes prev (own entry no
    longer counts as a referencer);
  - `releasePartCaches` deletes the key, then disposes the handle — a sibling entry
    sharing the handle keeps it alive, so the replay runs on a live solid;
  - `dispose()` snapshots handles into a `Set`, clears both registries, then disposes
    each once (the sharing guard would otherwise block teardown of shared handles and
    leak the whole cache).

With this, the probe's replay executes on a live solid, succeeds without degrading,
and the collect phase rebuilds topology from live solids — no freed-memory operation
remains anywhere in the flow.

The regression is pinned by
`test/cad-runtime/update-after-retessellate.probe.test.ts`: a control case (no refine)
and the crash probe (execute → retessellate → update) asserting that update succeeds,
every `solidCache` handle stays queryable through `getSubShapes`, and terminal topology
is rebuilt in `topologyCache`.

## Alternatives considered

- **Invalidate `faceEvolutionCache`/`roleTableCache` inside `retessellateOne`.**
  Disproven as the fix: the watch showed `retessellate` kills nothing and frees nothing;
  its only role is emptying `topologyCache`, which is where the crash *surfaces* at
  rebuild time. The kill happens in `update`'s release/replay/degrade path.
- **Fix in the smlib kernel (copy-on-transform, no in-place write-back).** Ownership
  lives in runtime's persistent `solidCache`; the kernel cannot know which parts still
  reference a shape. Ending handle sharing would also multiply wasm memory for every
  transform chain. The runtime that owns the cache must own the lifecycle.
- **Address-reuse detection (tombstone comparison before dispose).** Fragile: it
  depends on allocator behavior and still requires knowing who references the handle.
  Scanning two small maps is deterministic and cheap.
- **Leak instead of free (skip dispose entirely on any sharing ambiguity).** Rejected:
  the handle-reclaim, leak-isolation, and arena-bounded suites exist precisely to keep
  the wasm heap bounded; a "safe leak" regresses those guarantees.

## Consequences

- `releasePartCaches` no longer frees handles shared with non-replayed parts; replayed
  statements execute on live solids; the degraded full-re-execute path can no longer
  kill a reused-address tenant.
- No leak is introduced: the last referencer still disposes, and the restructured
  teardown (`dispose`) cannot be blocked by the guard. Verified by the existing
  `smlib-handle-reclaim`, `scope-import-transients`, and `arena-bounded` suites, plus
  the full cad-runtime / smlib-kernel / tessellation-lod run (65 files, 705 tests
  green; typecheck and lint clean for the touched files).
- The weapp "update after refine" flow stops producing NaN vertices at the source.
  Device-side presentation fixes (camera one-frame lag, refine scheduling) are separate
  and live in the 3d_editor repository.
- Still open, out of scope here: `retessellateOne` invalidates only
  `topologyCache`/`namingCache` (`faceEvolutionCache`/`roleTableCache` untouched — a
  latent staleness with no observed defect yet); and in-place transform aliasing means
  a shared solid's BREP follows a sibling's transform while its cached display mesh
  does not — masked today because shared parts are not terminals.
