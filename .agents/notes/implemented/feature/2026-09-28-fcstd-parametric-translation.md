# Agent Note: FCStd parametric translation — sketches, drawings, and lifted parameters

Status: implemented

English | [中文](2026-09-28-fcstd-parametric-translation.zh.md)

## Problem

FCStd conversion flattened every source object into a non-parametric result, and
the products it emitted were in a container format the reader now rejects.

- `Sketcher::SketchObject` was solved at convert time with the planegcs backend
  and then emitted as `cad.profile({contours})` — a dead contour locked to
  z = 0. Both the constraint set and the parametric nature were discarded: the
  generated script could not be edited, re-solved, or driven by a parameter.
- `ContourSeg` carries only line and arc. Bspline control points were sampled
  down to polylines, and full ellipses were dropped outright by the `segEnds`
  default branch — "do not lose geometry" was not even met.
- Draft drawing objects (`Part::Part2DObject` and subclasses — wire points,
  circle, arc, polyline) carry a `Proxy`, so they were classed `python-opaque`
  and baked; they were never rebuilt as a pen chain.
- FreeCAD's driveable scalars — `Spreadsheet::Sheet` alias cells, `App::VarSet`
  variables, and named dimensional sketch constraints — plus the
  `ExpressionEngine` bindings that reference them were all evaluated once at
  convert time and baked into literals. Correct values, but nothing survived as
  a parameter, so no runtime editability.
- Products already on disk were manifest `format: 1` (single `entry` string),
  which the unified container reader rejects by design.

## Decision

`@faicad/faijs-fcstd` routes each source object by its **parametric degree** and
lifts driveable scalars into first-class script parameters.

### Routing: parametric degree decides the entry point

| FCStd source | faijs entry |
|---|---|
| `Sketcher::SketchObject` (geometry + constraints) | `cad.sketch` |
| Draft / `Part::Part2DObject` drawings (dead coordinates) | `cad.draw` |
| unsolvable, unsupported-geometry, or curved-face-attached sketches | `cad.profile` (last resort only) |

`cad.profile` is no longer the default: it is reached only when the sketch
cannot be represented parametrically, and every fallback carries an explicit
reason in `mapping.json` (e.g. `sketch-unsupported-geom`,
`sketch-on-curved-face-unsupported`).

### Solving moves from convert time to run time

Convert time now only parses, projects, and pre-checks. `classifySketch` is
demoted from "decide whether to bake a dead contour" to a **fidelity
pre-check**: its verdict (`solved` / `underconstrained` / `redundant` /
`conflicting`) is recorded in `mapping.json` but every non-`failed` verdict
still emits `cad.sketch`. Only `failed`, or geometry outside the solver's
ability, drops to the profile fallback. Solving happens at run time inside
`cad.sketch`, against the same planegcs backend, so no capability is lost —
only the parameterisation is gained.

`@faicad/faijs-sketch` gained `fromFreeCadConstraints`, the missing reverse
projection from FCStd integer `ConstraintType` + `(geoId, pos)` references to
canonical `SketchConstraint`s. It pairs with the existing `fromFreeCadGeoms`.
Negative `geoId`s (`-1` HAxis, `-2` VAxis, `<= -3` external) are projected to
their canonical references or marked non-projectable explicitly.

### Placement: `sketchOnPlane` for planes, `sketchOnFace` for planar faces

Sketch placement is normalised into two paths. A sketch attached to a
datum/named plane becomes `sketchOnPlane(plane)`, and a sketch attached to a
face of another feature becomes `sketchOnFace(on, face)`. The old `cad.place`
redirect hack is gone. `sketchOnFace` supports **planar faces only** — a
sketch attached to a curved face falls back with the explicit reason
`sketch-on-curved-face-unsupported`, because `fixWireOnFace` is not
implemented; support is not faked.

### Leaf parameters lift to top-level `const p_*`

Three kinds of leaf parameter are lifted to faijs top-level `const` declarations
(`param = const <name> = <literal>`) pre-allocated before any object, so they
are editable and re-solved:

- `Spreadsheet::Sheet` alias cells,
- `App::VarSet` variables,
- named dimensional sketch constraints (length / radius / diameter / distance /
  angle).

Values are solved once at convert time via `evalWithDoc` and written as the
`const` right-hand side (the same value drives the geometric truth used for
parity). Pure geometric constraints (coincident / horizontal / parallel /
tangent …) and unnamed dimension constraints stay inline in the sketch's
`constraints` array.

An `ExpressionEngine` binding that references a lifted parameter is **inlined**
into the consuming op call — `Pad.Length = width * 2` becomes
`cad.extrude(sk, [0, 0, p_width * 2])` — rather than being baked to a constant
or hoisted into its own `const`. faijs already supports parameters inside
position expressions, so this needs no new syntax. A binding that cannot be
reduced to lifted parameters plus arithmetic stays `undefined` and is reported
as a property downgrade; nothing is guessed.

Naming is a uniform `p_` prefix plus the codegen `emitVar` dedupe suffix, and
each parameter's source is recorded in `mapping.json` as
`mapping.params: [{ name, source }]` so a UI can list the editable parameters.

### Re-conversion regenerates from source, not by patching manifests

Old containers are not patched in place. The v3 migration runs the upgraded
converter over the source FCStd corpus again, so one pass fixes both the
container format and the parametric translation; a manifest-only patch would
leave two mutually inconsistent sets of products.

## Alternatives considered

- **Keep convert-time solving, emit a solved dead contour plus a parameter
  list.** Rejected: the constraint graph is what makes a sketch editable; a
  solved contour plus detached values cannot re-solve when a parameter moves,
  which is the whole point of the parameter layer.
- **Hoist inlined expressions into their own `const` (`const Pad_Length =
  p_width * 2`).** Rejected: faijs position expressions already accept
  parameters, so a helper `const` adds a name and a hop for no capability. The
  expression goes inline.
- **Widen `cad.sketch`'s `plane` from a named-plane string to an arbitrary
  frame and drop `sketchOnPlane`/`sketchOnFace`.** Rejected: an arbitrary
  frame cannot express attachment to another feature's face, and the
  plane/face split is already the established division of labour downstream.
  Named planes on `cad.sketch` are kept as a short-circuit only.
- **Patch `format: 1` manifests up to v3.** Rejected: it reflects the format
  change but not the translation upgrade, producing v3 containers whose
  contents still say "dead profile".
- **Bake unresolvable expression bindings to their solved value.** Rejected:
  a binding that neither resolves to lifted parameters nor to arithmetic has
  no honest parametric form; baking it would silently freeze a value the user
  still expects to be live. It degrades to a property downgrade instead.

## Consequences

- `Sketcher::SketchObject` now emits `cad.sketch({ geoms, constraints, plane })`
  with the canonical constraint set intact and re-solved at run time; Draft
  objects emit `cad.draw` pen chains. `cad.profile` appears only on the
  fallback branch, and each fallback states why.
- The full ellipse drop in `extractContours` is fixed; the remaining exact-curve
  work (bspline / ellipse lifted as exact edges instead of sampled polylines)
  is a parity follow-up rather than a hard bug.
- Leaf parameters appear as top-level `const p_*` and inlined expressions in
  the generated script, with `mapping.params` recording each source; changing a
  parameter and re-running recomputes geometry, and the default value equals
  the convert-time solution.
- **GOTCHA — leading-dot same-sheet cell references.** Real corpus cells are
  written `=.G3`, not `=G3`; a `=`-only strip left `.G3`, which failed to parse
  as `. ( 24.1 )` and made alias resolution fail *silently*, so whole
  spreadsheet-driven models came out with `params: []` and baked Pad lengths.
  `cellBody` strips a leading `.` only when a letter follows.
- Old `format: 1` products must be regenerated from source before any
  `openContainer`-based reader can open them.
