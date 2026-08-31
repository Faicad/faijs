# Agent Note: TopoRef naming layer for cross-history topology identity

Status: implemented

English | [中文](2026-08-31-topology-naming.zh.md)

## Problem

faijs topology identity was purely ordinal (`o1.f3`, `TopExp::MapShapes` enumeration order). Ordinals are only meaningful inside a single solid snapshot: once an upstream statement changes parameters or inserts/deletes a boolean, the enumeration order changes and `o1.f3` points at a different face. The reason this worked today is that drill/assembly bypassed ids and stored geometric snapshots (normal/center) instead — a stopgap that cannot express "the same face" across replay, which chamfer edge selection and feature reference need. STL/3MF mesh fake topology has no OCCT solid at all, so it can never have a hash lineage.

## Decision

Add a cross-history identity layer on top of the untouched snapshot address layer. `TopoRef` (pure data, JSON-safe, written into `.faijs` op params) names a face/edge/vertex/derived-face by `{origin, role}` plus a geometric hint; resolution is one-directional — `TopoRef` → resolver → current-snapshot ordinal or live BREP handle. Ordinals are never stored back into the script.

`RoleTable` (origin → role → face hash list) is execution-time state only: it lives in the Shape identity slot and the runtime-persistent `roleTableCache` (same lifecycle as `faceEvolutionCache`), is never serialized, and rebuilds wholesale across sessions. Hash-keyed evolution comes from the same packed `*WithHistory` result already used for ordinal evolution (`decodeHashEvolution`, `splitHashEvolutionByOrigin` for boolean A/B), so no new wasm calls are needed. Resolution is explicitly three-state — `exact` / `geometric-fallback` on success, `TopoRefError` with `E_TOPO_DELETED` / `E_TOPO_AMBIGUOUS` / `E_TOPO_NOT_FOUND` on failure; it never silently grabs an ordinal.

Sources are tiered: BREP parts carry semantic+positional roles propagated through evolution (`box:top`, …); primitive fake topology gets the same semantic namer over its fixed face order; mesh (STL/3MF) parts are hint-only (`role=''`) and always resolve geometrically, with uncertainty reported explicitly. When a part switches from BREP to mesh mid-chain, the accumulated `{origin, role}` and hints survive as pure data and resolution falls back to the face-hint snapshot — reference-resolution degradation, not a runtime engine-path fallback.

## Alternatives considered

- **Keep ordinals and add geometric-snapshot references only.** Rejected: snapshots cannot survive parameter edits that move a face; the whole point is identity across replay.
- **Fake hash lineage for mesh.** Rejected: mesh has no solid, no evolution, no chain; faking a lineage would be exactly the "approximate topology pretending to be exact" the plan rejects.
- **Reuse brepjs as-is (single origin, hash-entity results).** Rejected: faijs booleans have target+tool inputs, so `RoleQualifier` (origin-qualified roles) and A/B-split evolution merging are required; hash is a session handle here, not a persistent identity.

## Consequences

- `ExecutionResult.naming` carries per-part naming rows; hosts reverse-lookup a picked ordinal to a row and build `TopoRef` via `captureTopoRef`.
- stdlib primitives build the chain-root role table; transforms/copy propagate it by hash identity; booleans merge target/tool tables per step (seam faces named under the statement's LHS as a new origin).
- Edge refs resolve as the shared edge of two face roles (cross-origin after boolean merges); vertices as the intersection of ≥3 face-vertex adjacency; derived faces (fillet/chamfer) by normal-blend of the bridged pair.
- Mesh limitation is explicit: no edge lineage, no roles — hint-only, geometric resolution, and honest `ambiguous`/`not-found` failures instead of silent wrong picks.
