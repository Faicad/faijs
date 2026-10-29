# Agent Note: idempotent same-density skip in retessellate

Status: implemented

English | [中文](2026-10-29-retessellate-same-density-idempotent-skip.zh.md)

## Problem

On device, the weapp refine flow ground for minutes: every re-armed refine round
re-tessellated every requested part from scratch, even when the display mesh was
already at the target density. `retessellate` had exactly one skip — the static
`notApplicable` (no BREP solid) — so a same-density request was full work: seconds
of per-part tessellation on device (30-60x slower than node), MB-scale geometry
copied across the worker wire, and re-renders of byte-identical meshes. Hosts that
re-arm rounds (timeout re-execute, zoom re-fire) paid that cost again and again —
the "refine grind" symptom.

## Decision

`retessellate` is idempotent per part at equal resolved density
(`packages/core/src/cad-runtime/runtime.ts`, released in 0.45.17):

- `RetessellatePartResult` gains a third variant, `{ skipped: 'same-density' }`,
  alongside the geometry result and `{ notApplicable: 'no-solid' }`. A skipped part
  ships nothing; the host treats it as done.
- A private `refinedDensityCache: Map<PartName, RefinedDensityRecord>` records, after
  each successful refine, the two resolved density numbers plus the exact mesh object
  reference that was stored into `brepChain.meshShapeCache`.
- The skip check is **reference identity**: skip only when a record exists, the live
  `meshShapeCache` entry is still the same object (`=== record.mesh`), and both
  resolved densities are exactly equal. Every path that rewrites or deletes the
  display mesh — execution writes (`setSolidAndTess`), deferred materialization
  (`getLiveOutput`/`getCachedOutput`/`materializeOne`), a finer refine,
  `releasePartCaches`, `dispose` — changes or removes that reference, so the record
  self-invalidates with no event hooks.
- The record is deleted alongside the mesh in `releasePartCaches` and cleared in
  `dispose`.

Pinned in `test/tessellation-lod.test.ts`: idempotence (a second same-density refine
returns the skip, leaves the mesh reference and the statement content key untouched,
and a finer density still refines) and invalidation (a re-execute that replaces the
mesh makes the same density re-refine — a stale record can never mask new geometry).

## Alternatives considered

- **Invalidate the record from every mesh-write site** (event-style threading).
  Rejected: the display-mesh slot per part already has one authoritative object;
  comparing against the object that was actually refined cannot go stale and needs
  no new invalidation calls that a future write path could forget.
- **Return the unchanged geometry as `updated`.** Rejected: forces a MB-scale
  cross-wire copy, a version-store put, and re-render churn for identical data on
  every re-armed round. The explicit skip variant makes the re-armed round free.
- **Float-tolerant density comparison.** Rejected: identical inputs resolve to
  identical floats, so exact equality is the correct identity; tolerance could skip
  a legitimately finer request.
- **Host-side memoization** (weapp remembers what it refined). Rejected: the runtime
  owns the display-mesh truth; a host-side record goes stale after any worker-side
  rewrite and cannot see incremental-update invalidation.

## Consequences

- Re-armed rounds stop redoing finished work. Node repro on the pikachu model
  (streaming execute, 19 terminals): the first full-batch L1 refine takes ~2.2 s;
  the immediate second same-density round returns in ~55 ms with zero updates; after
  an incremental update, re-refine touches only the parts whose meshes the update
  actually replaced; after a full re-execute, everything re-refines (records
  correctly invalidated).
- The widened union is a breaking change for consumers that assumed two variants.
  The 3d_editor host narrows with the discriminant (`'skipped' in result`) and
  surfaces the reason on its own wire as `'no-solid' | 'same-density'`.
- Skip correctness relies on the worker being serial per runtime: streaming-preview
  mesh writes settle before the host arms refinement (it dwells after execute), so
  the reference check sees a settled state.
- Still open, out of scope: the resolved density of a part is not exposed over the
  API; a host that wants "what density is this part at?" still tracks its own
  requests.
