# Agent Note: Single-script viewer entry point

Status: implemented

English | [中文](2026-11-13-open-fai-source.zh.md)

## Problem

A `.fai.js` file on disk is not a project container. `openFaiZip` reads a self-contained `.fai.zip` whose `resolveFile` deliberately rejects paths outside the archive, so a host that wants to open a bare script has no supported entry point.

## Decision

`@faicad/faijs-viewer` exposes `openFaiSource(source, opts)` alongside `openFaiZip(bytes, opts)`. Both entries share `installEngine`, `createViewerLibLoader`, `ensureSketchSolver` and `extractMeshes`, and both return `OpenFaiResult`. `OpenFaiSourceOptions` carries the container-equivalent capabilities as optional host injections: `projectLoader` for relative `import './other.fai.js'`, `assets` for `cad.load` / `cad.loadByKey`, plus `wasm`, `entryKey`, `mode`, `sketch` and `libs`. `entryKey` defaults to `model.fai.js` and is reported as `sourceFile`; `modelId` is empty because there is no container model. Failures use `E_SOURCE`, `E_EXECUTION` and `E_NO_GEOMETRY`, with `E_WASM_URL` still thrown for a caller contract violation.

## Alternatives considered

- **Have the host wrap the script in a `.fai.zip` with `writeContainer` before calling `openFaiZip`.** Not used: the host would fabricate a manifest and model id and depend on the container's internal layout, while the archive's self-contained contract cannot resolve sibling files, so relative imports and `cad.load` stay unsupported.
- **Let the host call `createRuntime` directly and skip the viewer package.** Not used: wasm binding, sketch-solver installation and dynamic library loading would be duplicated in every host.

## Consequences

- `open-fai-zip.ts` exports `extractMeshes` and `ensureSketchSolver` for reuse; `openFaiZip` behaviour is unchanged and its existing tests still pass.
- A self-contained script needs no host injection. Scripts with relative imports or external assets require the host to supply `projectLoader` / `assets`.
- Hosts choose an entry by file extension: `.fai.zip` → `openFaiZip`, `.fai.js` → `openFaiSource`.
