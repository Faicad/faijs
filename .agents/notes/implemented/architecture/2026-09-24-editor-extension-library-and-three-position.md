# Agent Note: Editor extension library split and the three.js version position

Status: implemented

English | [中文](2026-09-24-editor-extension-library-and-three-position.zh.md)

## Problem

Two requirements arrived together:

1. The ops that only the sibling `3d_editor` application needs must leave core: every `fai_`-prefixed op, plus the SVG-extrusion and 3D-text creators.
2. faijs must run on both the web host and the weapp (mini-program) host, whose `three` versions are permanently split — the weapp pages are pinned to r162 because the end-side canvas is WebGL1-only and three stopped creating WebGL1 renderers after r162, while the web host follows r184.

The two requirements meet in one place: the version split is unfixable by upgrading either side, so the engine has to stop taking a version position. That means declaring a peer *range*, restricting itself to the API subset that is stable across it, and pushing the non-basic parts of three — the `three/examples/**` addons and the `Shape`/`ExtrudeGeometry` chain — out of core entirely.

Measurement before the change: a single mini-program build contained two copies of three (the pages' r162 and the worker's r184), because every `three` import inside faijs's `dist/` resolved upward to the web host's hoisted r184. `SVGLoader` and `STLLoader` were core's two addon dependencies, not one as the design sketch assumed.

## Decision

**A separate package owns the editor ops.** `@faicad/faijs-extra` carries the editor-owned group (`fai_drill`, `fai_extrude`, `fai_split`, `group`, `assembly`, `copy`, `load`) and the creator group (`text`, `svgExtrude`), together with the preview helpers (`svgToExtrudedGeometry`, `parseSvgShapes`, `extrudeShapes`, `createTextGeometry`, `getOpentypeFont`, `opentypePathToGeometry`, `createMixedTextGeometry`). Core's `createApiNamespace()` returns the platform surface only; the host merges the two.

Op names, signatures and semantics are unchanged, so every existing `.fai.js` script keeps working once the host merges the namespace — the split changes import sources, never script text.

**The extension library is split in two entries.** `@faicad/faijs-extra/editor-ops` carries the editor-owned group alone and never reaches `three/examples`; the root entry adds the SVG/3D-text creators. The weapp worker mounts the first one: it must replay web-authored scripts containing `cad.group` / `cad.copy` / `cad.load`, but it must not bundle the SVG loader or the `Shape`/`ExtrudeGeometry` chain. The boundary is asserted from the built artifacts, not assumed.

**The transform family stays in core.** `translate`, `rotate_euler`, `scale` and `scale3d` remain platform ops. `translate` is a general geometric transform and the only transform op the end side executes; splitting the family would leave the end side without it.

**Core keeps the `engrave` op and receives its decoration geometry from the host.** `cad.engrave` is a platform op, but its mesh path needs text/SVG geometry. Core asks the host for that geometry through `setEngraveDecorationProvider` — the same capability-injection shape as `setFontLoader` and `setKnurlTextureLoader`. The BREP path is unaffected: it builds decoration solids with OCCT directly and needs no provider.

**three becomes a peer, and the addons leave core.** `three` moves from `dependencies` to `peerDependencies` with the range `^0.162.0 || ^0.184.0`, staying a devDependency for building and testing. Core's own STL parsing replaces `three/examples/jsm/loaders/STLLoader.js` (`mesh/stl-loader.ts`), and `SVGLoader` leaves with the creator group. A whitelist guard pins which three symbols core may touch; a dual-version smoke test runs the whitelisted API against both installed copies and compares the results numerically.

**Hosts must redirect three resolution.** Removing the version claim is not enough on its own: the weapp worker's bundle had no `three` resolution rule, so faijs's imports still landed on the web host's hoisted copy. The worker build now resolves `three` from its own package, matching what the pages build already did.

**The static symbol table accepts host-registered names.** The generated table stays exactly "core's platform surface"; a library registers its own names through `registerSymbolTableEntries`, which refuses to shadow a platform function. A key set may therefore never be silently redefined by a library.

## Alternatives considered

**Keep the ops in core and rely on tree-shaking.** Rejected: the addons are reachable through dynamic as well as static imports, so "unused" code is still bundled, and the weapp build's stub table matches filenames — a rename silently un-stubs. Only physical separation makes the boundary checkable.

**Replace three's geometry generation with `manifold-3d`.** Rejected: the weapp build stubs `manifold-3d` out entirely, so the substitution would be a no-op on the host it is meant to help, and the main package has no room for a second wasm payload.

**Vendor three's `STLLoader` into core.** Rejected: the port is small enough to own outright, and porting (as `creased-normals.ts` already did for `toCreasedNormals`) leaves no addon import to guard.

**Move `engrave` to the extension library.** Rejected: `engrave` is a platform op whose BREP path is three-free; moving it would redefine the platform surface to solve a mesh-path dependency. The injected decoration provider keeps the op in place and the dependency inverted.

**Assert the three version instead of the API subset.** Rejected: an assertion only fails after a consumer installs the wrong three; restricting core to the stable subset prevents the incompatibility, and the dual-version smoke test proves the restriction holds.

**Put the editor ops in a subdirectory of core and hide them with a private subpath.** Rejected: a hidden subpath is still shipped, still reachable by deep import, and still pulls the addons into any consumer that opts in. The requirement is that core not carry them.

## Consequences

- `@faicad/faijs` 0.16.0 is a breaking release: editor ops and their preview helpers move to `@faicad/faijs-extra` 0.1.0, and `three` becomes a peer. The sibling workspace's packages that declared a `^0.15.0` peer were aligned to `^0.16.0` so a fresh install resolves.
- A host that wants the editor ops must merge the namespace: `createEditorCadNamespace()` returns the platform surface joined with the editor ops, `registerEditorSymbols()` extends static analysis, and `installEditorMeshProviders()` wires the engrave decoration provider.
- Core's test suite and the integration suite assemble the namespace the way a host does, through test-only support modules — the shipped package still has no dependency on the extension library, which would be a cycle.
- The whitelist guard bans five names outright in core: `Shape`, `ExtrudeGeometry`, `Path`, `LineCurve`, `SVGLoader`. Reintroducing any of them means either a migration to the extension library or a self-owned port with a differential test.
- `ConeGeometry` is a measured r162/r184 divergence (r163 changed cone tessellation). Core reaches cones through `CylinderGeometry` for every non-degenerate frustum, so the divergence stays outside the platform path; the smoke test records the exemption and fails if it ever becomes stale.
- `packages/core/src/mesh/api.d.ts` is regenerated: the platform `cad` face no longer lists the migrated ops.
- **Pre-existing red cleared on the way (one change set, one note).** Four failure clusters predated this change and blocked the CI gate; each was drift with a prescribed fix, so they are cleared here rather than left: the stale `capability-map.json` (regenerated — it had kept `transformCopy`, which arg-spec skips); its two dependent snapshots (`engine-switch-p3`'s method-count/interface list, and the inventory generator, which embeds the map — the coupling is now recorded as a `GOTCHA` in that generator); the `bindOcctKernel()` call sites whose replacement the removal message names (`injectCurrentBrepEngineAsKernel()`, which needs the engine registered first and **`registerOcctBrepEngine()` is async** — omitting `await` fails as "no BREP engine registered"); the integration-suite typecheck drift (`DualOpOptions.naming` is required, naming rows carry `StmtId` origins and nullable `origin`/`role`); and the D8 layer guard, which now recognizes **two registered vendored bridges** — `api/` (the kernel-injection bridge) and `brep/engine/adapters/` (the engine adapter that reuses the vendored OCCT adapter's composed surface) — plus a `*.test.ts` exemption for parity tests, which compare against the ported tree by design and are not shipped. The guard's purpose is unchanged: every reach into the ported tree must sit at a registered bridge.
