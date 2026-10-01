# Agent Note: Mesh solids — brepkit is the mesh backend, approximate topology is derived, STEP stays BREP-only

Status: proposed

English | [中文](2026-10-01-mesh-solid-brepkit-mesh-backend.zh.md)

## Problem

The engine was designed for every op to have both a `brep` and a `mesh` implementation.
In practice almost every op is brep-only, and the mesh path has no topology at all:
mesh parts carry a bare `MeshData` (`positions` + `indices`), so nothing downstream can
select a face or an edge. A user who loads an STL therefore cannot fillet a recognized
edge or sketch on a recognized plane — the two capabilities that make mesh import useful.

Two further defects block any fix:

1. `BrepMeshResult.faceGroups` / `BrepEdgeData.edgeGroups` had **two different unit
   conventions** (triangle units vs index units; point units vs float units) and **two
   different hash moduli** between the brepkit adapter (producer) and the topology
   extractor (consumer). Under brepkit, face rows silently got `triangleCount = 0`.
2. `exportModel(entries, 'step')` silently upgraded mesh parts to a faceted BREP
   (`reconstructSolidFromMesh`), producing exactly the "faceted STEP" the project's
   mesh/BREP split exists to prevent.

## Proposal

**Mesh parts get a real (approximate) topology, produced by the engine, and mesh ops are
implemented by brepkit's mesh kernel.**

1. **Mesh solid** = a brepkit solid built from a mesh file by the one valid sequence
   `importStl` → `weldShellsAndFaces(bbox-scaled tol)` → `unifyFaces()`. It carries
   approximate topology (planar facets), never precision semantics. The order is not
   commutative: `unifyFaces` before `weldShellsAndFaces` yields a volume-0 broken solid.
   `unifyFaces` mutates in place and returns *the number of merged faces*, not a handle.
2. **Approximate topology** reuses the existing topology contract unchanged
   (`SelectorManifest` / `FaceRow` / `EdgeRow`, built by `buildTopologyFromMesh` over the
   L1 engine API). No second topology representation is introduced.
3. **Storage**: a mesh part stays a `kind: 'solid'` shape. A new `ShapeSlot.meshSolid`
   holds its handle *identity*; it is mutually exclusive with `ShapeSlot.solid` and is
   never written into `brepChain.solidCache`.
4. **Dispatch**: `defineOp` gains `meshEngines` (default `['manifold']`). A mesh solid fed
   to an op whose `meshEngines` excludes the active mesh backend fails statically
   (`E_MESH_SOLID_UNSUPPORTED`); there is no runtime fallback to manifold.
5. **Mesh op shape**: every mesh op is a sandwich — look up the mesh-solid handle from the
   registry, call the kernel, write the new handle back, and return `meshShape(...)` as
   `MeshData`.
6. **STEP stays BREP-only**: the mesh → STEP channel (`reconstructSolidFromMesh`) is
   removed, and STEP export of a model containing a mesh part fails with a per-part error.

## Interface changes

- `BrepMeshResult.faceGroups` is **index units** (`[triStartIdx, triCountIdx, faceHash]`);
  `BrepEdgeData.edgeGroups` is **float units** (`[pointStartFloat, pointCountFloat, edgeHash]`).
  Both hashes use the single modulus `BREP_HASH_BOUND`. Producers and the consumer share it.
- The brepkit adapter brands handles with a **kind tag** in bits 26..28
  (`asFace` / `asEdge` / `asWire` / `asVertex`; solids untagged). brepkit handles are
  per-type namespaces — `getFaceEdges(0)`, `getSolidFaces(0)` and `getEdgeCurveType(0)`
  all succeed on the *same* number, so the kernel cannot be asked what a handle is. The
  tag travels on the handle; `asNum()` strips it before every kernel call.
- `ShapeSlot` gains `meshSolid?`; `hasMeshSolid` / `meshSolidOf` / `fromMeshSolid` sit
  beside `hasBrep` / `brepOf` / `fromBrep` and are mutually exclusive with them. The
  exclusivity is enforced on **both** write points and re-checked by
  `assertShapeSlotExclusive` before every `dispatchPath` call.
- The mesh backend is assembled through the **mesh engine slot**
  (`registerMeshEngine('brepkit', { id, meshSolid })`), never through the BREP slot:
  a host can run OCCT as its BREP engine and brepkit as its mesh backend. The port is
  `MeshSolidBackend` (`brep/mesh-solid.ts`): `kernel` (L1 API), `ops`
  (`importMesh` / `weld` / `unify` — kernel-private, deliberately **not** on
  `BrepEngineApi`), and the engine-neutral drivers `normalize` / `describe` /
  `buildTopologyData` / `release`. `getMeshSolidBackend()` scans the mesh slot for the
  first engine that provides one.
- `load`'s mesh path registers the handle and the topology through the
  `setPendingMeshSolid` / `setPendingMeshTopology` channel (the same pattern as
  `setPendingDetectedUnit`), because the op lives in `@faicad/faijs-extra` and cannot
  hold a `CadRuntime` reference. The runtime collects them per statement, verifies the
  live ctx variable still carries **that** handle (guards against a part name being
  reassigned to a BREP output), then writes `MeshSolidRegistry` + `setTopology(part,
  'mesh', …)`.
- **Display mesh = the mesh solid's tessellation**, not the raw STL vertex array.
  Otherwise `faceRuns` would index triangles the user never sees (rule 1 of the
  topology contract).
- `computeEffectiveDeflection` moved from `occt-kernel/occtKernel.ts` to the neutral
  `brep/effective-deflection.ts` (it only ever used `getBoundingBox`), so
  `brep/brep-topology.ts` no longer depends on the OCCT kernel and its `@platform occt`
  tag is removed.
- `disposeBrepkit()` now also resets the cached wasm `initPromise` and the memoized
  primitive object, and `createBrepkitPrimitives()` is memoized per kernel instance.
  Both are prerequisites for assembling two consumers (the BREP engine and the mesh
  backend) over one wasm instance with **one** handle bridge.
- `defineOp` gains `meshEngines` (default `['manifold']`). `dispatchPath` reads it in the
  **existing** mesh-backend slot: the active id comes from the assembled backend object
  itself (`kernel.meshSolid.id`), not from a second registry snapshot, so the gate cannot
  drift from what was assembled. The gate runs only after the path decision has selected
  `mesh` — which keeps `mode='brep'` on its own, more accurate `E_BREP_UNSUPPORTED`, and
  applies in `mode='mesh'` too (forcing the mesh path does not make a manifold-only impl
  able to read a mesh-solid handle).
- **A mesh solid never mixes with off-chain geometry in one call.** Any input set that is
  partly mesh solids fails with `E_MESH_SOLID_MIXED` before the implementation runs. Both
  possible outcomes are silent downgrades: routing to manifold drops the mesh solid's
  identity and approximate topology, routing to the mesh backend leaves the other operand
  without a handle. `E_MESH_SOLID_MIXED` is a plain input-invariant error (like
  `E_SHAPE_SLOT_EXCLUSIVE`); `E_MESH_SOLID_UNSUPPORTED` is a `MeshUnsupportedError`, i.e.
  the same class as the other two mesh-path refusals so hosts classify it identically.
- Mesh ops are the sandwich, and only the sandwich: `api/internal/mesh-solid-op.ts` takes
  the handle from the shape slot (never re-imports), calls one L1 kernel method, then
  `describeMeshSolid` produces **one** tessellation that feeds both the display mesh and
  the approximate topology (rule 1). The new handle plus its topology go back through the
  same pending channel as `load`. **The input handle is never released** — lifecycle
  belongs to the chain (the BREP path does not release its input either), so `a` stays
  usable after `b = fillet(a)`.
- **Mesh solids resolve edges geometrically.** They have no role layer, so the two
  `RoleQualifier`s in `EdgeTopoRef.faces` are placeholders and can never resolve to a
  face. `resolveEdgeTopo` therefore degrades to matching `hint` (length / midpoint)
  against the **whole edge table** — but only when the context carries no
  `faceEdgeAdjacency`. BREP contexts always carry it, so the relaxation is unreachable
  from the BREP path: there, an unresolvable face pair stays `not-found` rather than
  silently becoming "guess an edge by length". The shared matcher (`matchEdgeByHint`) is
  one implementation used by both call sites.
- **STEP export refuses mesh parts structurally.** `StepExportEntry.solid` becomes
  **required** and its `mesh?` field is deleted, so the writer has no second geometric
  source to fall back to; `exportStepFromSolids` keeps a runtime `E_STEP_MESH_PART` as the
  last gate. `exportModel` / `exportModelSync` run `assertStepEntryHasSolid` over every
  entry **before** fetching the kernel, because "this is not a BREP part" is the first
  fact the user needs and must not depend on which BREP engine happens to be assembled.
  The error names the part. It is a plain `Error`, not a `MeshUnsupportedError`: it is an
  export-input invariant, not a dispatch decision. `cq-compat-assembly` `save.ts` raises
  the same error naming the member when a mesh part appears inside a multi-member assembly.
- **A mesh-chain face is its own identity.** `ShapeSlot` gains `meshFace?`, beside
  `solid` / `meshSolid` and mutually exclusive with both; `fromMeshFace` / `hasMeshFace` /
  `meshFaceOf` sit beside the other two pairs. It is needed for the same reason the BREP
  chain needs a face Shape: `sketchOnFace` returns one, and `extrude` consumes it. The
  BREP branch parks its face handle in `slot.solid`; the mesh branch **cannot** reuse that
  slot, because `hasBrep` would then be true and dispatch would send a brepkit face handle
  to the precision kernel. A mesh-chain face keeps `kind: 'solid'` (matching the BREP
  side's face Shape) so `extrude`'s `isCurveShape` pre-check behaves identically on both
  chains. `assertShapeSlotExclusive` now counts all three identities: more than one is
  `E_SHAPE_SLOT_EXCLUSIVE`.
- **`sketchOnFace` gains a mesh branch that deliberately does not use UV space.** The BREP
  branch maps the contour into the face's `(u,v)` domain; a brepkit plane's domain is
  ±1e6 — an infinite domain whose midpoint is a *parametric* origin that can lie outside
  the face — so "place the sketch in the face's UV range" is meaningless. The mesh branch
  places the contour in the face's own plane frame instead: origin = the face's
  **bounding-box centre** (not `surfaceCenterOfMass`, which on brepkit is the UV-domain
  midpoint — see above), normal = the L1 `surfaceNormal` at that UV midpoint. That matches
  `cad.sketchOnPlane`'s semantics. `scaleMode` therefore only accepts `'original'`
  (`'bounds'`/`'native'` are defined against the UV domain), `as:'wire'` is refused (a
  mesh-chain wire has no identity slot, and the consumer is `extrude`, which wants a face),
  only **planar** faces are accepted, and a multi-island sketch is refused because brepkit's
  `extrude` takes one face, not a compound. Each refusal is a `MeshUnsupportedError` naming
  the reason; none of them silently degrades to a different behaviour.
- **`extrude` gains a mesh branch.** Input is a mesh-chain face, output is a new mesh
  solid; direction semantics are the *same object* the BREP branch uses
  (`normalizeExtrudeOptions` is not forked — `(face, 5)` still means +Z). `upTo` is refused
  on the mesh path: it needs the precision chain to intersect and trim against a target
  face, and silently replacing "extrude up to that face" with "extrude this far" would hand
  the user a different solid.
- **`fillet` / `chamfer` stop being BREP-only in `mode='mesh'`.** They now declare a mesh
  implementation, so the mesh path is selected instead of failing at dispatch. The refusal
  a bare-mesh input gets therefore moves from `E_MESH_UNSUPPORTED` ("no mesh
  implementation") to `E_MESH_SOLID_UNSUPPORTED` ("mesh path needs a mesh solid input and
  an assembled mesh backend") — still a `MeshUnsupportedError`, still before any geometry
  work, and still no fallback to BREP. Both codes are `MeshUnsupportedError`, so host-side
  classification is unchanged; only the message names the real reason now.
- **Mesh-chain selectors accept 1-based ordinals.** `fillet` / `chamfer` `edges` and
  `shell` `openFaces` take either a `TopoRef` or an ordinal, matching `sketchOnFace`'s
  `face` ordinal. The ordinal is the index the host already read out of the approximate
  topology array (+1), so "the user clicked edge #7" needs no geometric reconstruction.
  The precision chain deliberately does **not** open this door: a BREP entity's identity is
  its role line, and an enumeration ordinal drifts across features — accepting one there
  would downgrade a replayable reference into "whatever came out of this particular run".
  `assertFilletParams` / `assertChamferParams` take an `allowOrdinals` option that only the
  mesh implementations pass, and `shell`'s BREP branch rejects an ordinal with its own
  message.
- **The transform family gains a mesh branch that moves the *handle*, not the vertices.**
  `translate` / `rotate_euler` / `scale` / `scale3d` route mesh solids through the mesh
  backend's kernel via the same engine-neutral helpers the BREP path uses
  (`translateBrep` / `rotateBrep` / `scaleBrep`), so the product is a new mesh part with
  its own approximate topology; bare meshes keep the historical vertex-bake path. Baking
  vertices into a mesh solid would have dropped its identity slot silently — every
  downstream mesh op would then refuse it as a bare mesh. No face evolution and no
  roleTable are attached (the approximate chain has neither).
- **`shell` gains a mesh branch.** Same L1 call as the BREP branch
  (`shell(solid, faces, thickness, tolerance)`); only the face selection differs (ordinal
  or geometric `FaceTopoRef`). Kernel refusal is reported as `E_SHELL_FAILED` with the
  thickness and the number of removed faces.
- **The pattern / mirror family gains mesh branches, and the fusion is where handles are
  released.** `linearPattern`, `circularPattern`, `gridPattern`, `rectangularPattern`,
  `mirrorJoin`, `mirror` and `clone` all work on mesh solids. Copy-producing ops go through
  `meshPatternProduct`, which fuses the copies into one new mesh part and releases **only
  the copies it made** — never the input (`a` must survive `b = linearPattern(a)`), and
  also on mid-loop failure, so a failed call leaks nothing. `replica[k]/<inner>` naming is
  absent on the mesh chain (no role layer to project onto). `gridPattern`'s mesh branch
  builds copies by per-copy `translate` + `fuseAll` instead of calling the kernel's
  `gridPattern`, because that one returns a single **compound** handle and an approximate
  topology cannot describe a compound as one mesh part.
- **Measurement accepts mesh solids.** `area` / `length` / `volume` / `centerOfMass` read
  the mesh solid's handle through the mesh backend's kernel. The value is an exact
  measurement of the **faceted geometry** (a 10³ box STL reads 1000.000; a 32-gon prism
  reads the sum of its 32 facets) — neither a reconstruction of the original design nor an
  estimate, so nothing is discounted or tagged as approximate. A shape with neither chain
  handle (a bare mesh) fails with `E_MEASUREMENT_NO_HANDLE` rather than returning 0.
- `meshSolidBasicEntry` is split out of `meshSolidEntry`: whole-solid ops (transform /
  shell / pattern) do not need the edge table, and building it costs one kernel call per
  edge.

## Alternatives considered

- **Ask the kernel for a handle's shape type.** Rejected: brepkit has no shape-type API and
  no reliable probe — every candidate discriminator (`getAnalyticSurfaceParams`,
  `getEdgeCurveType`, `getSolidFaces`) answers for whichever object owns that index in its
  own namespace, so an edge and a face with the same number are indistinguishable.
- **Fit analytic surfaces onto facet clusters** (turn an STL cylinder back into one
  cylindrical face). Rejected: brepkit does not do it (`convertToElementary` returns 0,
  `recognizeFeatures` returns `[]` on facet solids), and building a fitter would be a new
  algorithm outside this change's scope. A faceted cylinder stays 32 planar quads.
- **Keep the kernel's implicit mesh fallback** (`meshFallbackCount` / facet STEP). Rejected:
  it hides the mesh/BREP boundary, which is the one thing this project refuses to blur.
- **A fourth shape kind (`meshSolid`)**. Rejected: mesh parts are already `kind: 'solid'`;
  a separate kind would fork every terminal/animation/export path for no gain.
- **Normalize lazily, on first topology request.** Rejected: it moves the failure point
  away from the import that caused it. Normalizing at import keeps "an open mesh fails to
  load" a load-time error.
- **Per-op `meshEngines` vs runtime-frozen backends.** Runtime freezing matches the existing
  `createRuntime({ brep, mesh })` style, but the decision must be visible where the op is
  declared, and the dispatch table is static. The field wins.

## Acceptance criteria

- Cross-engine contract test (occt × brepkit): `faceGroups` index units, `edgeGroups` float
  units, group hashes equal to `hashCode(subShape, BREP_HASH_BOUND)`, and identical
  `triangleStart` / `triangleCount` / `area` / edge `length` for the same box.
- Mesh-solid construction test: 12-triangle box STL → 12 faces / 36 unshared edges / strict
  validation fails and fillet is refused; `+ weld` → 18 edges / valid; `+ unify` → 6 faces /
  12 edges / 12-of-12 fillet; cylinder STL → 124 triangles → 34 faces / 96 edges, each edge
  filletable one at a time; the same 96 in one call is refused.
- Loading a box STL yields a mesh topology the host can select: 6 planar faces with
  `area = 100`, 12 edges with `length = 10`, `ExecutionResult.topology[].source === 'mesh'`.
- STEP export of a model containing a mesh part fails, naming the part; STL/3MF export
  keeps working.
- Phase 2 (B1 batch): a box STL, one recognized edge, `fillet(r=1)` → still a mesh part
  with its own approximate topology, volume inside the analytic band
  `a³ − (1 − π/4)·r²·a`, and **no** face evolution attached (an identity map would claim
  an evolution that does not exist).
- Phase 2: a 32-gon prism STL reports exactly 96 edges and every one of them fillets
  through the op, one at a time; a mesh solid mixed with off-chain geometry in one
  boolean fails with `E_MESH_SOLID_MIXED`; two mesh solids union into a mesh part.
- Phase 3: on a 10³ box STL, sketch a 4×6 rectangle on the `+Z` face (selected by geometry,
  since the approximate topology has no roles) and extrude 5 → the sketch is a mesh-chain
  face, the prism is a new mesh part of volume 120, `union(box, prism)` = 1120, and
  `cut(box, prism)` with `mode:'backward'` = 880. `upTo`, a non-`'original'` `scaleMode`,
  and an out-of-range face ordinal each fail with their own code.
- Phase 4 (B3 batch): on a 10³ box STL, `translate` / `rotate_euler` / `scale` / `scale3d`
  each keep the part on the mesh chain (registry handle, `source === 'mesh'`, absent from
  `solidCache`) while the geometry really moves (volume 1000/8000/2000, a 45° rotation
  widens the bounding box to 10√2); `shell` removing the recognized top face with
  `thickness: 1` = 424 and with no open faces = 488; `linearPattern` (3 copies, spacing 20)
  = 3000, `circularPattern` (4 around Z) = 4000, `gridPattern` / `rectangularPattern` (2×2)
  = 4000, `mirrorJoin` = 2000 spanning x ∈ [−10, 10], `mirror` = 1000 in x < 0 with the
  source kept, `clone` = 1000 on a distinct handle.
- Phase 4 (B4 batch): on a mesh part, `volume` = 1000, `area` = 600 and `centerOfMass` =
  (5, 5, 5); the measured value is usable as a number inside the script (volume 1000 used as
  the scale factor of `v / 500` → 8000); a bare mesh fails with `E_MEASUREMENT_NO_HANDLE`.
- Phase 4: every op with a mesh-solid implementation declares `meshEngines`, and swapping
  the assembled mesh backend to an undeclared one makes the gate refuse statically (checked
  against each op's own metadata, not a copy of it).
- End-to-end scenario (the target use case): a cube STL is loaded, its 6 faces / 12 edges are
  read from the approximate topology, a bottom edge is filleted by **ordinal taken from that
  reading**, the topology is re-read from the filleted part, its `+Z` face is sketched with a
  4×6 rectangle and extruded 5 → `union` = 1117.854 and `cut` (backward) = 877.854; the same
  chain on a 32-gon prism STL fillets a vertical edge by ordinal. Exporting that chain's
  result works as STL (triangle count read back from the file equals the mesh payload) and
  fails as STEP with `E_STEP_MESH_PART` naming the part.
- Script-face acceptance: the same scenario runs as **one real `.fai.js`** on an editor host
  (`@faicad/faijs-extra` + a fixture STL read through the `assetsDir` port), with the selectors
  written into the script as literals. The test pins those literals against a fresh topology
  reading: edge `9` is the 20-long bottom edge **on the loaded part**, face `4` is the `+Z`
  face **on the filleted part** — the fillet adds a face, so the numbering shifts (the same
  face is `6` before the fillet). Result: `volume` = 2000 − 4.292 + 120, every intermediate a
  mesh part, the sketch a mesh-chain face.
- Full `npm run test -w @faicad/faijs` green with zero stderr output.

## Risks

- **Surfaces are not recovered.** An STL cylinder stays 32 planar quads in the approximate
  topology. Stated as a limit, not a defect.
- **A host without a mesh backend gets no approximate topology.** "No mesh kernel is
  assembled" (e.g. a weapp build that only wires the BREP slot) is a legitimate static
  configuration and `load` keeps its historical bare-mesh behavior; it is **not** the
  same thing as a normalization failure, which must fail loudly. The distinction is
  deliberate but easy to misread — the guard is that the boundary is decided by
  assembly, before any geometry work, never by inspecting a failed result.
- **The brepkit mesh adapter is not in the browser umbrella.** `entry-boundary.test.ts`
  forbids brepkit re-exports from `browser.ts` (the wasm package's node branch is
  statically resolved by vite and does not exist on the web). Browser hosts take it from
  the root or `weapp` entry, or supply their own `MeshSolidBackend`.
- **Normalization can fail** (open / non-manifold / self-intersecting meshes): volume 0 or
  non-zero `validateSolid` after welding. It must fail loudly with the part name; a silent
  downgrade to "bare mesh, no topology" would remove selection from every downstream op.
- **Weld tolerance sensitivity**: too small leaves seams, too large fuses neighbours. The
  tolerance is derived from the bounding-box diagonal and can be overridden.
- **`unifyFaces` fragility**: wrong order corrupts the solid; the guard is a regression test
  plus a post-unify `validateSolid` check that falls back to the welded state and reports
  that faces were not merged.
- **A mesh handle leaking into the precision chain** would silently resurrect faceted STEP;
  the guards are the `solid`/`meshSolid` exclusivity check and removing the mesh → STEP channel.
- **A whole batch of coplanar edges is refused by the kernel.** Measured on a 32-gon prism:
  all 96 edges in one call is rejected outright ("no fillet engine produced a changed,
  closed, outward-oriented result") because rounding the cap's coplanar edge chains
  self-intersects, while each edge on its own succeeds 96/96. The op reports the kernel's
  refusal with the edge count; it does **not** retry edge by edge, because switching
  strategy at runtime would hide a real geometric fact and make the result depend on
  an invisible retry. Callers wanting the whole chain should split it into mutually
  non-adjacent groups.
- **`chamfer` `twoDistances` is not available on mesh solids.** It resolves the two
  adjacent faces from `faces[0]` / `faces[1]` to decide which side carries `width1`
  versus `width2`; with no role layer neither qualifier resolves, and guessing a
  reference face would put the chamfer on the wrong side. `equal` and `distanceAngle`
  work (they need only the edge).
- **A bare-mesh input keeps getting refused on the new mesh paths.** `translate` and friends
  still have a bare-mesh implementation (the manifold vertex bake), but every other op
  added here (`shell`, the pattern family, `mirror` / `clone`, `fillet` / `chamfer`) has
  only a mesh-solid path, so a bare mesh is refused by `meshSolidBasicEntry` /
  `meshSolidEntry` rather than by dispatch. Same code and same error class as before
  (`E_MESH_SOLID_UNSUPPORTED`, `MeshUnsupportedError`), just raised one layer in.
- **Ordinals are position numbers, not identities.** An ordinal taken from one topology
  reading only means the same edge/face on that same part — after any feature the numbering
  shifts. That is why the workflow re-reads the topology after every step, and why the
  precision chain refuses ordinals outright. Geometric `TopoRef`s have the mirror-image
  weakness (congruent faces/equal-length edges cannot be told apart), which is exactly why
  both forms exist.
- **Mesh `gridPattern` returns a fused solid, the BREP branch a compound.** The BREP kernel
  hands back one compound handle containing every copy; the mesh branch instead builds
  per-copy `translate` + `fuseAll`, because an approximate topology has no way to describe
  a compound as a single mesh part. The solids are the same and, for spaced copies, so is
  the geometry — but a caller relying on "one compound, many children" should not expect it
  on the mesh chain.
- **The new whole-solid ops depend on brepkit accepting mesh-derived solids.** `translate` /
  `mirror` / `shell` / `fuseAll` are all exercised on mesh solids by
  `api/mesh-solid-modeling.test.ts` with analytic volumes (not "it ran"), so a kernel that
  stopped accepting them would fail loudly instead of quietly producing a bare mesh.
