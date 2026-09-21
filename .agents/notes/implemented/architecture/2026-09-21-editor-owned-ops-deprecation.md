# Agent Note — editor-owned ops leave the faijs platform surface

Date: 2026-09-21
Status: implemented
Area: architecture / op ownership / sibling-project boundary

## Context

The FCStd port borrowed three ops out of the sibling `../3d_editor` project's
interaction model to lower FreeCAD objects, and that borrowing is what killed
`ArchDetail`:

- `Part::Compound` is a `Part::Feature` subclass — a **geometry object** with a
  Shape and a Placement. It was lowered to `cad.group`, an op whose own module
  header says "no independent mesh of its own; geometry lives in the children;
  the meaning is structure (hierarchy)" and whose JSDoc says "structural
  statement, no geometry output". The compiler emitted
  `let part651 = cad.group(part441, ...)` and then
  `part652 = cad.rotate_euler(part651, ...)`; a structural compound carries no
  OCCT handle, so the transform died with `input is not BREP`.
- Placement is an object's **pose attribute**, and was lowered to the statement
  sequence `rotate_euler` + `translate`.

The user's ruling: these ops, like the `fai_`-prefixed family before them,
were never designed as general platform ops — they exist to serve
`../3d_editor`'s editor (canvas display, drag handles, timeline statements,
structural grouping). A platform capability such as the FCStd port must not
borrow them; when the platform needs the behaviour, it must design its own API.

## Decision

`translate`, `rotate_euler`, `scale`, `scale3d`, `group`, `assembly` and `copy`
are marked `@deprecated` as `../3d_editor`-owned, following the precedent of
`f963d97` (which did the same for `fai_*`): the op JSDoc is the source of
truth, the wiring sites carry a note, and the generators propagate the marker
into the AI-facing `src/mesh/api.d.ts` and as a 🚫 marker into
`docs/ops-api-inventory.*`.

## What makes an op editor-owned

The test is *whose semantics the op's shape serves*. Evidence collected:

- `../3d_editor/packages/app/src/engine/features/transform.ts` — the transform
  family is registered as a Feature: UI tool modes `move`/`rotate`/`scale`, a
  display label ("旋转"), and timeline backfill.
- `.../panels/TimelinePanel.tsx:824` — maps a statement back to a tool mode via
  `statement.callee === 'rotate_euler'`.
- `api/copy.ts` module header — "canvas shows both the box and the copy".
- `api/compound.ts` module header — "no geometry output; the meaning is
  structure".

All four describe editor interaction or canvas behaviour, not geometry.

## Alternatives considered

- **Deprecate only `group`**, the op that actually broke ArchDetail, and leave
  the transform family alone. Rejected: `rotate_euler` is the op that consumes
  the compound, and it belongs to the same editor Feature as
  `translate`/`scale`; marking one and not its siblings would be arbitrary.
- **Skip the marker and fix the lowering first.** Rejected: the marker is cheap
  and stops the borrowing from spreading; rewiring the lowering is separate,
  larger work.
- **Delete the ops outright.** Rejected: `../3d_editor` still uses them. They
  move there; they do not disappear.

## Known counter-evidence

Existing records treat at least `translate` as a platform op:
`packages/core/src/api/surface/arg-spec.ts:2718` calls it "faijs's same-named
hand-written surface", and `f963d97`'s diff context explicitly excluded
`translate, rotate_euler, scale, scale3d` from its deprecation list. This note
records the user's ruling as superseding those records.

## Consequences

- **Transitional, not finished.** `fcstd/codegen.ts` still emits
  `cad.rotate_euler` + `cad.translate` for Placement (4 sites) and `cad.group`
  for product aggregation (2 sites); `fcstd/feature-translate.ts` emits
  `cad.group` for `Part::Compound` (1 site). Both files now carry a ⚠️ note
  stating the borrowing is temporary and must not be read as evidence that
  these ops belong to the platform surface.
- **The replacement needs no new kernel capability.** `kernel.makeCompound`
  (`packages/core/src/brep/engine/primitives.ts:109`) and
  `kernel.located`/`transform`/`generalTransform` (:96-98) already exist. What
  is missing is a faijs API expressing a *geometry* compound and a *placement*.
- `ArchDetail` stays unrunnable until that API lands and the lowering is
  rewritten onto it.
