# Agent Note: clone op opened to brepkit via capability routing

Status: implemented

English | [中文](2026-09-26-clone-brepkit-capability-routing.zh.md)

## Problem

`clone` declared `engines: ['occt']`, so on brepkit it was rejected before execution with `requires engine occt`. The user required brepkit support, arguing the underlying kernel capability exists (brepkit adapter already has `copyShape` from batch A) and the difference is only in topology/naming extension.

## Investigation: identity naming contract

- **identity naming = ordinal-based 1:1 mapping**, not face hash. Cross-node replay uses ordinal keys (`identityEvolution` maps o→[o]); hash is only used at root anchoring and landing for ordinal↔hash conversion.
- **The actual breakpoint is roleTable propagation, not engine identity.** `cloneBrep` is a generated selfhost projection that returns a bare handle. `defineOp.wrapBrepOne → fromHandle → fromBrep` does NOT attach faceEvolution or propagate roleTable. The hand-written `placeBrep` explicitly calls `propagateAllOrigins` + `identityEvolution` + `identityHashEvolution`.
- **This is engine-neutral.** Probe (`box → clone → edgeRef(clone,1) → fillet`) confirmed: on occt, `edgeRef(clone,1)` already fails with `nameless shape` (input shape has no role table). On brepkit after removing the engine gate, the exact same error occurs. No crash, no silent wrong-face selection.

## Decision

Replace `engines: ['occt']` with `capabilities: ['copyShape']` in `api/surface/arg-spec.ts`. Regenerate `api/generated/topology.ts` via `gen-l3-surface.ts`. This is honest: `cloneBrep` only calls `kernel.copyShape`, and brepkit adapter declares that capability (verified by `engine-switch-p3` guard).

## Alternatives considered

- **Keeping `engines:['occt']`** — rejected: the user required brepkit support, and the underlying kernel capability (`copyShape`) already exists in the brepkit adapter.
- **Propagating roleTable in `cloneBrep` immediately** — deferred: it depends on the unverified assumption that brepkit `copySolid` preserves face enumeration order; doing it prematurely risks silent wrong-face selection (see Honest limitation).

## Consequences

- clone passes on occt + brepkit 2.129.15/3.4.18/4.0.32, bbox [20,10,5] identical across all four engines.
- `edgeRef(clone,n)` / `faceRef(clone,n)` cleanly report `nameless shape` on both engines — graceful degradation, not a brepkit-specific gap.
- occt behavior zero regression.

## Honest limitation

clone output has no face identity on either engine. To make clone outputs selectable, `cloneBrep` would need to propagate roleTable like `placeBrep` does. This depends on the unverified assumption that brepkit `copySolid` preserves face enumeration order — doing it prematurely risks silent wrong-face selection, so it was deferred.
