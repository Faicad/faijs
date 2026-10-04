# @faicad/faijs-viewer

English | [中文](README.zh.md)

The reference way for **any third-party host** to open and render a project `.fai.zip` 3D document. The viewer reads the container, executes the active (or requested) model through `@faicad/faijs`, and returns host-agnostic tessellated mesh data — no THREE, no DOM, and no GL library required on the return value.

This package does **not** depend on `@faicad/faijs-extra` or `sheetmetal`. Its runtime dependencies are the family peers `@faicad/faijs`, `@faicad/faijs-sketch` and `@faicad/faijs-draw`, which the host provides. It is the reference SDK for "a third party needs only one **viewer** package to view a `.fai.zip`".

## v1 API

```ts ignore-check
import { openFaiZip } from '@faicad/faijs-viewer'

const result = await openFaiZip(bytes, {
  wasm: {
    occtUrl: 'https://your-cdn/occt-wasm.wasm',          // BREP-chain engine
    manifoldUrl: 'https://your-cdn/manifold.wasm',        // mesh / CSG engine
    brepkitUrl: 'https://your-cdn/brepkit_wasm_bg.wasm',  // secondary BREP engine
  },
  // modelId?: string                      // pick a model; default is manifest.active, else models[0]
  // mode?: 'auto' | 'brep' | 'mesh'       // default 'auto' (static BREP/mesh dispatch)
  // sketch?: { planegcsUrl: '...' }       // browser-only: constraint-solver wasm URL (see below)
})

// result.meshes — structured mesh data; the host does the actual rendering.
for (const mesh of result.meshes) {
  // mesh.name       display label
  // mesh.positions  Float32Array, interleaved x/y/z triangle vertices
  // mesh.indices    Uint32Array, groups of 3 triangle indices
}
```

Three outcomes:

| case | form |
|---|---|
| `wasm` missing or any of the three urls empty | **throws** (`E_WASM_URL`; a caller contract violation, never returned as `error`) |
| invalid bytes / execution failure / no visible geometry | returns `result.error`, `code ∈ { E_CONTAINER, E_EXECUTION, E_NO_GEOMETRY }` |
| success | returns structured `meshes` |

Real FreeCAD-converted containers call `cad.sketch` / `cad.draw`; the viewer merges the sketch + draw namespaces into the default `cad` binding and backs them with a constraint solver (see below).

## `cad.sketch` and the constraint solver

`cad.sketch` (from `@faicad/faijs-sketch`) requires a separate **planegcs** constraint-solver wasm. How it is sourced differs by runner:

- **Node / worker** — the solver auto-loads from the installed `@salusoft89/planegcs` package; no `sketch` option is needed.
- **Browser** — self-host `planegcs.wasm` and pass its URL: `openFaiZip(bytes, { wasm, sketch: { planegcsUrl: 'https://your-cdn/planegcs.wasm' } })`. Without a URL the solver is not installed; a `cad.sketch` op fails with `E_SKETCHC_NO_SOLVER`, reported through `result.error`.

Note: the converted sketch input must follow the sketch op's contract (`shapes` or `geoms`). A converter that emits `cad.sketch({ contours: [...] })` is not currently accepted and fails with `E_SKETCHC_NO_GEOMS` — tracked in the faijs family, not this viewer package.

## All three wasm urls are required, and they must be self-hosted

A `.fai.zip` has **no baked mesh** — models execute at runtime, which requires the engine wasm. v1 does not bundle them; the host provides and self-hosts:

- **occt-wasm** — BREP-chain engine (default-required).
- **manifold** — mesh/CSG engine (also used for the tessellation of BREP output).
- **brepkit** — secondary BREP engine (v1 accepts + validates it; reserved).

Self-host the three files (do not rely on an upstream CDN's uptime) and pass their urls to `openFaiZip`:

1. Copy `dist/occt-wasm.wasm` from the `occt-wasm` npm package into your static directory.
2. Copy `manifold.wasm` (package root) from `manifold-3d` into your static directory.
3. Copy `lib/brepkit_wasm_bg.wasm` from `brepkit-wasm` into your static directory.

For a concrete browser binding, see `packages/demo/main.ts#initOcct`, which registers `OcctKernel.init({ wasm: occtUrl })` on core's `setOcctWasmInitFn`; this viewer package installs the three urls into core's `setOcctWasmInitFn` / `setManifoldWasmUrl` hooks for you in a browser.

## Node / tests

In a Node/worker runner the three urls are still validated (v1 contract), but the engine falls back to core's locally-bundled occt/manifold auto-load — no network fetch. So a host without public internet can still fully run `openFaiZip` in a test process.

## Dependencies

- peers `@faicad/faijs`, `@faicad/faijs-sketch`, `@faicad/faijs-draw` — the runtime dependencies (a host provides all three family packages).
- peer `occt-wasm` — lazily imported only by the browser path (`bindBrowserWasm`); never loaded in Node tests.
