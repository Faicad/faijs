# Agent Note: Unified .fai.zip container (manifest v3, multi-model)

Status: implemented

English | [中文](2026-09-28-unified-fai-zip-container-v3.zh.md)

## Problem

The `.fai.zip` container format was underspecified: faijs conversion emitted a
single-entry manifest (`format: 1`, `entry: "model/main.fai.js"`), the editor
guessed entries by file name, and there was no shared read implementation for
all consumers (editor, fcstd-port, third parties). The unified container design
(editor plan 2026-09-27) requires: a standard manifest schema, one model per
Body for fcstd products, entry selection by manifest only, and a reader shared
across hosts.

## Decision

`@faicad/faijs-fcstd` now owns the container read API and the fcstd writer was
upgraded to manifest v3:

- **Manifest schema** (`packages/fcstd/src/container.ts`): `format: 3`,
  `units: "mm"`, `models: ContainerModel[]` (id/entry/label?/data?), optional
  `active` (defaults to `models[0]`), optional `source`/`requiresBrep`
  preserved. `entry` is gone; reading `format !== 3` throws with the observed
  value (no legacy fallback).
- **Writer** (`build-fai-zip.ts`, `convert.ts`): `buildFaiZip` takes `models`;
  fcstd conversion emits `main` (aggregate entry) plus one model per Body
  (`model/<Body>.fai.js`), matching the existing codegen layout.
- **Read API** (`packages/fcstd/src/container-read.ts`, exported from
  `src/index.ts`): `readManifest` / `listModels` / `listModules` / `readModule`
  / `readAssetEntries` / `openContainer`. Environment-independent (fflate
  `unzipSync` + `JSON.parse` only, no `node:*`) so web workers can use it.
  Errors carry the offending value; unknown manifest fields, out-of-table
  members (`preview/**`, `export/**`, `cache/**`, `mapping.json`, `freecad/**`,
  custom entries) are ignored, never errors. Duplicate ids/entries/asset keys,
  entries outside `model/`, a missing named `data` member, an absent `active`,
  and a requested model id outside `models[]` all throw.
- **Asset keys** (spec §7): `files/**` keyed by fileId, `assets/**` keyed by
  base name minus final extension; a key colliding across the two namespaces
  throws. A script referencing an absent asset fails at execution (host wires
  `assets`/`files` into the runtime; verified by the negative e2e case).

## Alternatives considered

- Keeping `entry` and only changing `format` — rejected: it cannot express
  multi-model products; the editor's open-by-replay flow needs per-model
  entries.
- Putting the read API in core (`@faicad/faijs`) instead of the fcstd
  sub-package — rejected: the spec (§2.9) allows either; fcstd is the natural
  owner since conversion already lives there and the editor consumes the same
  package for conversion parity.
- Entry selection by file-name heuristics (`endsWith('main.fai.js')`) —
  rejected: spec §5.4 mandates `active` or `models[0]`, never file names.

## Consequences

- fcstd products now open as a multi-model container: `main` + one model per
  Body, each executable standalone (verified by the openContainer e2e: every
  model runs through the BREP chain and produces STEP geometry).
- The two fcstd-port-hardcoding probes in core (`probe-beds-parts.ts`,
  `probe-a2-beds.ts`) were migrated to `openContainer`; the manual fflate
  materialization is gone.
- `@faicad/faijs-fcstd` bumped 0.18.3 → 0.19.0; the peer range sweep for
  `@faicad/faijs@^0.19.0` across publishable packages (a pre-existing lockstep
  red from the core 0.19.0 bump) was completed in the same branch.
- Legacy `format: 1` containers are rejected by design; the 141 archived
  fcstd-port products are out of scope for regeneration (another machine).
