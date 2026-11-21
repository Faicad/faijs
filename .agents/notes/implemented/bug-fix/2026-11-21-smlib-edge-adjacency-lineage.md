# Agent Note: SMLib borrowed sub-shape hashes must be rooted at the solid's ordinal

Status: implemented

English | [中文](2026-11-21-smlib-edge-adjacency-lineage.zh.md)

## Problem

On the SMLib kernel no edge of a plain box could be turned into an `EdgeTopoRef`, so
fillet/chamfer preview on a picked edge failed with
`TopoRefError: edge naming has no adjacent-face lineage (mesh limitation)`. Reproduced in
mweb: `cad.box` → fillet tool → tap one edge → preview.

The failure was not in the naming layer. `buildAssemblySelectorManifest` derives
face→edge and edge→face adjacency by hashing each face's loop edges with
`kernel.hashCode(edge)` and resolving collisions with `isSame`, mapping them back to the
ordinal of the solid's edge enumeration. The SMLib adapter records a borrowed sub-shape's
deterministic hash as `(owner, index)` because the C++ side only hands back a slot id.
A single edge is enumerated twice — as the i-th edge of a `face → edge` enumeration and as
the j-th edge of the `solid → edge` enumeration — with an identical handle, and the second
record overwrote the first. `hashCode(faceEdge)` therefore resolved to `(face, i)` while
`buildEdgeOrdLookup` was keyed by `(solid, j)`, so `findOrdinal` missed at the hash gate
before `isSame` was ever consulted. Every face got `edgeCount = 0`, every edge got
`faceCount = 0`, `edgeFaceOrdinalsOf` returned null for all of them, and
`buildPartNaming` consequently emitted `faces: null` (and null `origin/role`) for every
edge row. `captureTopoRef` correctly refused to invent an identity, which is the error the
user saw.

A second, independent gap surfaced in the same audit: `assignRoles` required
`surfaceType === 'cylinder'` to name a cylinder's lateral face, but SMLib represents a
cylinder's lateral surface as a cone with equal radii and reports `'cone'` (measured
surface codes for `makeCylinder` are `[2,0,0]`). The whole lateral face therefore stayed
out of the role table, so on a cylinder even face identity was missing, not just edge
lineage.

## Decision

Two rules, both expressed as invariants rather than patches:

1. `recordSubShape` in the SMLib adapter treats the solid's enumeration order as the
   canonical ordinal: once a handle has been recorded under a solid owner in the current
   arena epoch, a non-solid owner (a face or wire) may not overwrite it. Any later
   solid→edge enumeration still overwrites a non-solid record, so the mapping converges to
   `(solid, j)` regardless of enumeration order.
2. `assignRoles` names a cylinder's (and a cone's) lateral face by op semantics — anything
   that is not an end cap is the lateral face — instead of comparing kernel surface-type
   strings. A `cad.cylinder` solid has exactly two end caps plus one lateral face by
   construction.

`test/topology/naming/smlib-edge-face-adjacency.test.ts` pins both, including
`captureTopoRef` on every box edge row, and it fails on the pre-fix code exactly as the
user's flow did. `packages/core/test/topology` + `packages/core/test/smlib-kernel` +
`packages/core/test/brep` + `packages/core/test/cad-runtime` stay green.

## Alternatives considered

- **Make `hashCode` a content hash (curve type + endpoints).** Rejected: `meshShape`'s
  `faceGroups` / `wireframe`'s `edgeGroups` hashes are produced on the C++ side from the
  solid enumeration ordinal; a different hash function in the adapter would stop matching
  those buffers and break triangle/polyline lookup.
- **Record face→edge with the owning solid instead of the face.** Rejected as the primary
  fix: the adapter has no parent pointer, so the solid owner is only known after a
  solid→edge enumeration; the "solid wins" rule needs no extra state and is
  enumeration-order independent.
- **Relax `captureTopoRef` so a lineage-less edge row produces a hint-only reference.**
  Rejected: that is exactly the silent degradation the naming contract forbids. The data
  was wrong at its source; the UI should keep refusing to build a reference from it.
- **Detect "cone with equal radii" in `surfaceType` by sampling normals.** Rejected:
  a cheap heuristic would relabel thinly tapered cones as cylinders and the only functional
  consumer (role assignment) already knows the op type, which is exact.

## Consequences

- On SMLib, box/cylinder/prism edges now carry `faces` + `origin/role`, so
  `hasUsableEdgeNaming` is true, `EdgeTopoRef` capture works, and fillet/chamfer on a
  picked edge produces geometry instead of throwing.
- Face rows gain their `edgeStart/edgeCount` on SMLib, so face picking near a boundary and
  any consumer of face→edge tables (selector helpers, entity hashes) see one consistent
  graph instead of an empty one.
- The cylinder lateral face is now named `lateral` on SMLib; the reported `surfaceType`
  stays `'cone'` because that is what the kernel models. Consumers must not infer
  cylinder-ness from `surfaceType` on SMLib.
- Downstream hosts consume a new faijs line; mweb picks it up through the usual tgz
  refresh, and the box→fillet→preview flow is covered by an mweb e2e test.
