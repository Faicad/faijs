# Agent Note: SVG view projection is engine-neutral (dual dialect channels, no gates)

English | [中文](2026-10-11-svg-view-projection-engine-neutral.zh.md)

Status: implemented

## Problem

`cad.projectView` / `cad.projectSheet` produced a **silently empty SVG** under the brepkit BREP engine. The projection layer (`api/view/view-projection.ts#projectPolylines`) hard-cast the engine's `projectEdges` result to the occt-wasm shape — six compound arena ids (`visibleSharp`/`hidden…`) — so under brepkit every field read as `undefined` and the serialization loop skipped everything. brepkit's kernel does implement `projectEdges` (L1 contract, `engine-method-map` status `dialect`), but with a different return dialect.

## Decision

`projectPolylines` dispatches by engine id (read once via `getBackends().config.brepEngineId`, same pattern as the STEP export channels in `brep/export/export-model.ts`):

- **occt channel** (unchanged, byte-for-byte): HLR compound handles → `getSubShapes` → 3D curve sampling (`curveParameters`/`curvePointAtParam`) → camera-plane projection.
- **brepkit native channel**: the kernel returns a JSON string `{"visible":[[x,y,…],…],"hidden":[…]}` — each polyline is a flat x,y pair array, **already projected** onto the camera plane (x along `x_axis`, y along `x_axis × view`; same coordinate convention as the occt output). The channel parses it and serializes each polyline directly to an SVG path `d` string; visible set solid, hidden set dashed. No compound handling, no curve sampling.

Constraints held from the STEP engine-neutralization decision:

- **No gate, no error on missing features.** The ops carry no `engines` declaration (they never did); the implementation asserts no engine identity. Dispatch only selects a channel.
- **Kernel defects still throw.** A non-string or structurally malformed `projectEdges` result from the native channel raises `E_PROJECTION_DIALECT` — that is an implementation bug, not a missing feature, and hiding it would violate the static-dispatch red line.
- **Single serialization source.** `viewBoxOfPaths` / `projectViewSvg` / `projectSheet` are shared by both channels; only polyline *acquisition* differs.

Output shape follows each kernel's own projection (precision, hidden-line completeness). No HLR is recomputed in faijs for brepkit.

## Alternatives considered

- **Add `engines: ['occt']` to the view ops** (gate under brepkit) — rejected: contradicts the project's "must support, no gates" engine-neutralization policy already applied to STEP I/O; a hard error where a working kernel capability exists is strictly worse.
- **Adapt brepkit output to the occt dialect** (synthesize compound handles / fake arena ids) — rejected: brepkit returns projected 2D polylines, not 3D topology; fabricating handles would couple the channels and need a fake `getSubShapes`/`curveParameters` surface for no benefit.
- **Dispatch inside the `brepkitKernel` adapter** (return an occt-shaped object) — rejected: the adapter must mirror the real kernel dialect, not lie about it; the map entry stays `dialect` and the consumer decides.

## Consequences

- SVG view projection works on every BREP engine with a `projectEdges` L1 implementation; brepkit coverage is pinned by `packages/core/test/api/view/view-brepkit.test.ts` (non-empty paths, hidden dashes on iso, exact front-view bbox 12×32 for a 10×20×30 box, read-only input, sheet layout, auto mode). occt behavior is pinned unchanged by `test/api/view/view.test.ts`.
- `E_PROJECTION_DIALECT` is the contract boundary: engine id dispatch is static, native-channel JSON shape errors surface loudly.
- `toPNG` / `toMultiviewPNG` and the `toSVG` / `toMultiviewSVG` family remain occt-only (out of scope here; they are direct occt-native calls, not the HLR projection chain).
