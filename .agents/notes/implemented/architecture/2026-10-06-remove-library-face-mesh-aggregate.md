# Agent Note: The library face carries no mesh aggregate object

Status: implemented

English | [中文](2026-10-06-remove-library-face-mesh-aggregate.zh.md)

## Problem

`packages/core/src/mesh/index.ts` exported `cad`: one object aggregating the mesh/BREP implementation, 38 keys, reachable from the package root through the re-exports in `packages/core/src/index.ts` and `packages/core/src/browser.ts`.

The name belongs to the script face. A host injects the script face's `cad` itself, as `registerLib('cad', createApiNamespace(), { default: true })`, and that namespace carries the 95-op surface. The library export carried a different key set and different parameter shapes — its `cylinder({ radius, height, at, centered, segments })` object form had already left the script face. A TS consumer probing engine capability through the export therefore read a surface no script ever sees.

Nine call sites inside the repository consumed the aggregate: eight files under `packages/core/src/api/` and `packages/faijs-extra/src/mesh/index.ts`, which re-aggregated it as `editorCad`. Two core test files imported it directly. Product code in the sibling `3d_editor` application, and every other downstream library, imported it nowhere.

Renaming the export — the first attempt at this change — leaves the hazard intact: an object that answers "what can this engine do?" wrongly, still reachable by a deep import, under a new label.

## Decision

**The library face defines no aggregate object under any name.** `cad` names the script face and nothing else.

- `packages/core/src/mesh/index.ts` re-exports the mesh modules and defines no object. Its header names the import target for each layer: `mesh/primitives`, `mesh/transform`, `mesh/boolean`, `mesh/engrave`, `mesh/query`, `mesh/io`, `brep`, `brep/primitives-brep`.
- `packages/core/src/index.ts` and `packages/core/src/browser.ts` export neither `cad` nor `meshCad`.
- The eight `packages/core/src/api/` files import module namespaces — `meshPrimitives`, `meshTransform`, `meshBoolean`, `meshEngrave`, `meshQuery` — and call through them. Each op's dependence on the kernel now reads as an import statement, and no file reaches a kernel key without saying which module provides it.
- `packages/faijs-extra/src/mesh/index.ts` is deleted; the package entry exports each implementation by name, and `split` is re-exported as `meshSplit`, the name the aggregate had carried as `fai_split`.
- The two core test files import from the concrete modules.
- `AGENTS.md` gains a section separating the two audiences. A script developer knows only the `cad` namespace the host injects; a library developer knows only named module imports. The section states that no all-in-one object exists in `packages/core/src/mesh/`, so failing to find one is the expected result rather than a missing API.

## Alternatives considered

**Rename the export to `meshCad` and keep it public.** Rejected: the rename removes the collision, not the hazard. An object shaped like "the engine's whole API" stays deep-importable, and the next consumer to probe through it repeats the mistake under a different label.

**Move the aggregate to a module the entry does not export.** Rejected: `@faicad/faijs-extra` re-aggregated the object across the package boundary, so the object stays reachable from outside `core` regardless. The option collapses into deletion.

**Delete the export but keep the eight internal call sites on the object.** Rejected: the object survives as the kernel's private facade and keeps inviting the same misreading; the module imports are the same edits in the same files.

**State the rule in documentation and change no code.** Rejected: prose does not stop a deep import, and an export that still exists keeps contradicting the rule it violates.

## Consequences

- Removing a public export is breaking for anyone who imported it; the repository rule that backward compatibility is not a consideration applies, so no shim is provided. A consumer still importing the aggregate fails to compile after upgrading — the intended effect.
- The script face is untouched. `cad.box(...)` in a `.fai.js` script resolves to the host-injected op namespace, whose implementation path is unchanged, so no script text changes.
- `@faicad/faijs-extra`'s entry surface changes: implementations are named exports and `editorCad` is gone. The extension package's API-coverage baseline drops the removed entry.
- The sibling `3d_editor` application's test files still import the removed name; they are rewritten on the application side against a rebuilt tarball.
