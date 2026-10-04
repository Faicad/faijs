# Agent Note: faijs-viewer preset & dynamic library loading

Status: proposed

English | [中文](2026-10-04-faijs-viewer-preset-dynamic-libs.zh.md)

## Problem

`openFaiZip` (v1) presets only `sketch` + `draw` into the default `cad` namespace and never passes a `libLoader` to `createBrowserPorts`. A `.fai.zip` whose model imports a third-party faijs library (`@faicad/faijs-gears`, `@faicad/sheetmetal`, `cq-compat`, …) therefore fails at execution with an unregistered-binding error. A generic `.fai.zip` viewer (3d_viewer_electron) cannot open such models — and the set of libraries a model may import cannot be known in advance.

## Proposal

**Preset surface becomes core + sketch + faijs-extra.** `openFaiZip` registers `mergeEditorNamespace(mergeSketchNamespace(createApiNamespace()))` as the default `cad` binding plus `registerSketchSymbols()` / `registerEditorSymbols()`. faijs-extra is preset in full (A group + B group, no selection parameter) — the A/B capability gap is merely "not yet implemented", not an architectural boundary a host should choose between.

**Draw leaves the preset surface.** The viewer no longer imports, merges or registers `@faicad/faijs-draw`; a `cad.draw` call now fails as an unknown callee. The draw package is marked deprecated (description + JSDoc), code untouched.

**Dynamic loading is encapsulated in the viewer.** `OpenFaiZipOptions.libs` (`{ enabled, cdnBase, versions, allow, aliases, importModule }`) is passed to a viewer-internal `createViewerLibLoader`, dispatched on environment: browser → `createBrowserLibLoader` (jsDelivr CDN dynamic import); node → an internal whitelisted `import(pkg)` loader mirroring `cliPortsLibLoader` semantics (scoped-`@faicad/` default, short-name aliases, `loadSource` for determinism scanning, per-lib `faijs.autoLift`). `enabled: false` removes the loader so unregistered bindings fail loudly.

**Dependencies.** faijs-viewer peer drops `@faicad/faijs-draw`, adds `@faicad/faijs-extra` and `three` (the B-group mesh implementations statically import three; 3d_viewer_electron already ships it).

## Alternatives considered

**`libs.editor` selection parameter (`full | editor-ops | none`).** Rejected by the user: the mini-program gap is unimplemented capability, not a boundary; and the B-group ops' mesh path statically imports three regardless, so the subentry cannot avoid the dependency either.

**Keep draw merged and only mark it deprecated.** Rejected by the user: the preset surface drops draw. No emitter is affected — the faijs-freecad Draft pipeline had already migrated off `cad.draw` (2026-09-29, contours travel as `ProfileLoop` data placed with `cad.sketchOnPlane`), and the draw package's own header already declares "no remaining emitter".

**Have core export a `createNodeLibLoader` factory.** Rejected for scope: DRY is attractive but touches core's public API; the viewer's internal node loader is ~40 lines and mirrors `cliPortsLibLoader` semantics.

**Add a `@faicad/faijs-extra/ops` subentry without preview helpers.** Rejected for now: the B-group op modules statically reach the three chain anyway, so the subentry would not remove the dependency; revisit if/when B group gets a three-free implementation.

## Acceptance criteria

- A preset model (`cad.fai_*` / `cad.sketch`, no import) executes through `openFaiZip` with default options.
- With `libs` configured, a third-party library import is loaded on demand by the viewer's loader; whitelist rejection and `enabled: false` both surface as structured `E_EXECUTION` (`failedAt`).
- `cad.draw` fails as an unknown callee (regression assertion).
- faijs-viewer unit + e2e tests green; full typecheck/lint/guards/CI green.

## Risks

- `three` becomes a viewer peer; hosts without it must install it (3d_viewer_electron already has it).
- CDN-loaded libraries must be version-pinned to the host engine line or `assertContractVersion` fails (loud, structured).
- No `cad.draw` emitter remains in the family (faijs-freecad migrated to `cad.sketchOnPlane`, 2026-09-29); viewer dropping draw affects no converted model. The 3d_editor host still merges draw in its own sketch host — deprecated status only steers its future evolution.
