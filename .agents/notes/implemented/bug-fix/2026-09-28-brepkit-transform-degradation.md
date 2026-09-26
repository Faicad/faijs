# Agent Note: translate/scale graceful degradation for brepkit

Status: implemented

English | [中文](2026-09-28-brepkit-transform-degradation.zh.md)

## Problem

The `translate` and `scale` ops declared `engines: ['occt']`, and their BREP
implementation in `api/transform.ts` unconditionally routed through the occt-only
`translateWithHashEvolution` / `scaleWithHashEvolution` (which call `getOcctKernel()`
directly). On a brepkit BREP engine the static platform gate in `backend-dispatch.ts`
rejected both ops up front with `E_BREP_UNSUPPORTED: op 'translate' requires engine
occt (current=brepkit)` — even though brepkit's bare `kernel.translate` /
`kernel.scale` are real implementations. Result: the two most common transform ops
were unusable on the brepkit brep chain.

## Decision

Make `translate` / `scale` neutral ops (drop `engines: ['occt']`) and route the
BREP path by the *declared capability set* of the active engine, statically before
execution (no runtime try-catch fallback):

- occt declares `translateWithHistory` / `scaleWithHistory` → authoritative history
  path (`translateWithHashEvolution` / `scaleWithHashEvolution`), producing
  faceEvolution + roleTable exactly as before (zero behavior change on occt).
- brepkit does not declare them (bare `translate` / `scale` only) → L1
  `translateBrep` / `scaleBrep` calls for exact geometry, **plus an identity
  hash evolution**.

The distinguishing point for transform ops is that a rigid or uniform transform
**does not change the number of faces or their ordering**, so the identity
face-to-face mapping is *genuinely correct* here — it is not a fabricated
evolution of the kind that is forbidden on other degraded ops (e.g. boolean/
chamfer, where the kernel destroys/rebuilds faces). Reusing the existing
`identityHashEvolution` (the same primitive already used by `rotate_euler` /
`scale3d`, pinned by `face-evolution.ordering.test.ts`) yields a result slot that
carries an identity `faceEvolution` and propagates `roleTable` — so face selection
and naming keep working on the brepkit degrade path.

`rotate_euler` / `scale3d` were already neutral and still use `rotateBrep` /
`scaleBrep` + identity evolution (unchanged).

## Consequences

- `translate` / `scale` now work on the brepkit BREP engine (validated across brepkit
  wasm 2.129.15 / 3.4.18 / 4.0.32), including chained `translate → scale`.
- On occt the output is bit-identical to before (history path retained), so the
  existing mesh/BREP parity and face-evolution ordering guarantees hold.
- On the brepkit degrade path, the result slot carries an **identity** faceEvolution
  and propagates roleTable (transforms preserve face ordering — the mapping is real,
  not fabricated), so face selection / naming keeps working. This differs from
  intersect/chamfer, where degradation means *no* evolution because those ops do
  not preserve face topology.
- Verified end-to-end on brepkit (all three wasm versions): `cad.faceRef` resolves
  on a translated/scaled box (`faceRef(shape, 1)`), i.e. roleTable + identity
  faceEvolution are genuinely consumable for face selection — not a dangling slot.

## Files

- `packages/core/src/api/transform.ts` — neutral `translate`/`scale`, capability-routed
  `transformBrep`.
- `packages/core/src/brep/engine/brepkit-batchD-fix.test.ts` — new regression suite
  (occt + brepkit 3 versions) pinning history-path retention on occt and identity
  face evolution on brepkit, plus a `cad.faceRef` resolution end-to-end naming test.

## Alternatives considered

- **Keep `engines: ['occt']`** — rejected: it blocks brepkit entirely; the user
  requirement is that every degradoable op degrades to at least "works" regardless
  of `*WithHistory` availability.
- **Bare L1 call with no evolution on the degrade path** (initial implementation)
  — rejected: transforms preserve face count/order, so carrying *no* face evolution
  would needlessly break face selection/naming on brepkit, even though the identity
  mapping is truly correct. It matched the intersect/chamfer degrade discipline
  but at a real cost with no benefit here.
- **fabricate an identity mapping where the kernel does not preserve faces**
  (generalizable concern) — not applicable to transforms for the above reason; the
  no-fabrication rule is retained for ops that genuinely lose face topology.