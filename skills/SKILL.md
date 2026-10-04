# faijs — .fai.js Scripting API Skill

> **Purpose**: This skill file tells AI agents what APIs are available when writing `.fai.js` scripts for 3D CAD modeling with the faijs engine.

## What is faijs?

faijs is a CAD execution engine: a JavaScript-based language (`.fai.js`) for parametric 3D modeling with dual BREP (OCCT) and mesh (manifold) geometry backends. Scripts use a `cad.*` namespace for platform operations, and can `import` additional libraries for domain-specific capabilities (sheet metal, gears, fasteners, CadQuery compatibility, etc.).

## Script Structure

A `.fai.js` file is valid JavaScript with specific conventions:
- **Variable names must be descriptive and meaningful** (e.g., `bottom_leg`, `gear_hub`, `mounting_plate`). The `part0`, `part1`, ... pattern is only a UI-layer auto-generation convention — AI agents writing scripts must choose names that reflect the part's role in the design.
- The `cad` namespace is the default library, always available.
- Additional libraries are imported via `import * as <binding> from '<specifier>'`.
- **Units must be explicitly provided** using unit literal expressions. +Z is up. See the Unit System section below.

```js
// A simple .fai.js script — note explicit unit literals
let base_plate = cad.box(100 * MM, 80 * MM, 10 * MM)
let shaft = cad.cylinder(5 * MM, 40 * MM, { centered: true })
let assembled = cad.union(base_plate, shaft)
let rounded = cad.fillet(assembled, { edges: [cad.edgeRef(assembled, 1)], radius: 2 * MM })
```

## Available Libraries

The following packages provide capabilities usable in `.fai.js` scripts. Each link below leads to a detailed skill file for that package.

### Platform (built-in `cad` namespace)

| Package | Skill File | Description |
|---------|----------|-------------|
| **@faicad/faijs** (core) | [core.md](core.md) | The platform `cad.*` namespace: primitives (box, sphere, cylinder, cone, wedge), boolean ops (union, subtract, intersect, cut), feature ops (extrude, fillet, chamfer, shell, draft, sweep, loft, revolve, etc.), pattern ops, transform ops, query ops, and more. Always available — no import needed. |

### Editor Extension Library (merged into `cad` namespace)

| Package | Skill File | Description |
|---------|----------|-------------|
| **@faicad/faijs-extra** | [faijs-extra.md](faijs-extra.md) | Editor ops merged into `cad.*`: `fai_drill`, `fai_extrude`, `fai_split`, `group`, `assembly`, `copy`, `load`, `text`, `svgExtrude`. |

### Domain Libraries (imported via `import * as <binding> from '<specifier>'`)

| Package | Skill File | Import Specifier | Description |
|---------|----------|------------------|-------------|
| **@faicad/faijs-sketch** | [sketch.md](sketch.md) | (merged into `cad`) | `cad.sketch` — constraint-based sketching with planegcs solver. Merged into `cad` namespace. |

| **@faicad/sheetmetal** | [sheetmetal.md](sheetmetal.md) | `@faicad/sheetmetal` or short name `sheetmetal` | Sheet-metal authoring, unfold, flat patterns, bend relief, cutouts, nesting, DXF export. |
| **@faicad/faijs-gears** | [faijs-gears.md](faijs-gears.md) | `@faicad/faijs-gears` or short name `faijs-gears` | Gear generation: spur, herringbone, ring, bevel, worm, rack, planetary gearsets. |
| **@faicad/faijs-fasteners** | [faijs-fasteners.md](faijs-fasteners.md) | `@faicad/faijs-fasteners` or short name `faijs-fasteners` | Fasteners: threads, nuts, screws, washers, bearings, sprockets, chain, holes. |
| **@faicad/faijs-cadquery** | [faijs-cadquery.md](faijs-cadquery.md) | `@faicad/faijs-cadquery` or short name `faijs-cadquery` | CadQuery API compatibility: Workplane, Sketch, Shape, selectors, assembly. |

## Key Concepts

### Dual-Channel Execution
Every op supports the **mesh** path (default, manifold-3d). Some also support the **BREP** path (OCCT, exact geometry). Whether BREP is available is determined by **static rules** before execution — there is no runtime fallback. When a BREP-unsupported op is encountered, the chain switches to mesh for that operation onward.

### Result System
APIs use a `Result<T>` type (`ok`/`err`/`isErr`). In `.fai.js` scripts, statement boundaries automatically unwrap results — an `err` becomes a statement failure. Third-party library functions return `Result` natively; the boundary unwraps at the statement level.

### Topology References
Faces and edges are referenced by **role-based topology identity** (`cad.faceRef(shape, n)`, `cad.edgeRef(shape, n)`), where `n` is a 1-based ordinal matching FreeCAD's `FaceN`/`EdgeN` convention. This allows fillet/chamfer/draft/shell to target specific edges/faces across parametric changes.

### Unit System
- **+Z is up.**
- **Units must be explicitly provided** using unit literal expressions. The following uppercase constants are available as read-only globals in `.fai.js` scripts:

| Constant | Value (base-unit scale) | Dimension |
|----------|------------------------|-----------|
| `MM` | 1 | length (base unit) |
| `CM` | 10 | length |
| `METER` | 1000 | length |
| `MICRON` | 0.001 | length |
| `INCH` | 25.4 | length |
| `FOOT` | 304.8 | length |
| `YARD` | 914.4 | length |
| `DEGREE` | 1 | angle (base unit) |
| `RADIAN` | 180/π | angle |
| `GRAM` | 1 | mass (base unit) |
| `KILOGRAM` | 1000 | mass |
| `SECOND` | 1 | time (base unit) |

- **Usage**: Multiply a number by a unit constant, e.g., `10 * MM`, `2 * INCH`, `45 * DEGREE`. The expression evaluates to a plain number in the base unit (mm for length, degree for angle).
- **Bare numbers on dimensioned parameters are rejected** by the dimension checker (`E_DIM_BARE_NUMBER`). You must always write `10 * MM`, not just `10`.
- Compound expressions are supported: `10 * MM + 2 * MM` evaluates to `12`.
- Unit constants are reserved — you cannot shadow them with `let INCH = ...` or use them as parameter names.

## Quick Reference: Platform `cad.*` Ops

```
Primitives:   box / sphere / cylinder / cone / wedge / helix / wire / profile / screw / sdf
Sketch:       sketchOnPlane / sketchOnFace / punchHole
Import:       import_brep / import_step / asset
Boolean:      union / subtract / intersect / cut
Feature:      extrude / revolve / sweep / loft / fillet / filletVariable / chamfer / shell / draft / thicken / engrave / knurl
Pattern:      linearPattern / circularPattern / gridPattern / rectangularPattern / mirror / mirrorJoin / clone
Split:        split / splitByPlane / sectionByPlane
Transform:    place
Repair:       defeature / reverseShape / unifySameDomain / sew / sewAndSolidify / removeHolesFromFace
Structure:    compound
Assembly:     jointTrajectory / inverseKinematics / mechanismDOF
Query:        bboxCenter / bboxMin / bboxMax / faceNormal / faceRef / edgeRef / viewCamera / projectView / projectSheet
```

For full details on each op, see [core.md](core.md).
