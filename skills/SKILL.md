# faijs — .fai.js Scripting API Skill

> **Purpose**: This skill file tells AI agents what APIs are available when writing `.fai.js` scripts for 3D CAD modeling with the faijs engine.

## What is faijs?

faijs is a CAD execution engine: a JavaScript-based language (`.fai.js`) for parametric 3D modeling with dual BREP (OCCT) and mesh (manifold) geometry backends. Scripts use a `cad.*` namespace for platform operations, and can `import` additional libraries for domain-specific capabilities (sheet metal, gears, fasteners, etc.).

## Script Structure

A `.fai.js` file is valid JavaScript with specific conventions:
- **Variable names must be descriptive and meaningful** (e.g., `bottom_leg`, `gear_hub`, `mounting_plate`). The `part0`, `part1`, ... pattern is only a UI-layer auto-generation convention — AI agents writing scripts must choose names that reflect the part's role in the design.
- The `cad` namespace is the default library, always available.
- Additional libraries are imported via `import * as <binding> from '<specifier>'`.
- **Units must be explicitly provided** using unit literal expressions. +Z is up. See the Unit System section below.

```js
// A simple .fai.js script — note explicit unit literals
let base_plate = cad.box(100 * MM, 80 * MM, 10 * MM)
let shaft = cad.cylinder(5 * MM, 40 * MM)
let assembled = cad.union(base_plate, shaft)
```

## Key Concepts

### Dual-Channel Execution
Every op supports the **mesh** path (default, manifold-3d). Some also support the **BREP** path (OCCT, exact geometry). Whether BREP is available is determined by **static rules** before execution — there is no runtime fallback. When a BREP-unsupported op is encountered, the chain switches to mesh for that operation onward.

### Result System
APIs use a `Result<T>` type (`ok`/`err`/`isErr`). In `.fai.js` scripts, statement boundaries automatically unwrap results — an `err` becomes a statement failure. Third-party library functions return `Result` natively; the boundary unwraps at the statement level.

### Topology References
Topology parameters (`fillet.edges`, `chamfer.edges`, `shell.openFaces`, `draft.faces`, `defeature.faces`, `extrude.upTo`, ...) are referenced by **portable topology identity** — `EdgeTopoRef` / `FaceTopoRef` — each recording the statement it was born from (`origin`) and its role within that statement (`role`), so the reference stays valid across parametric changes and across kernels.

**In generated scripts, topology parameters take the TopoRef literal the UI picker emits** (`{ kind:'edge'|'face', origin, role, hint }`). Pass it through unchanged; never hand-write `origin`/`role` values — they are assigned by the naming layer at runtime.

**⚠️ Never use ordinal references in generated scripts** — the `cad.edgeRef` / `cad.faceRef` query bridges or bare numbers. Ordinals are the kernel's enumeration order and drift across kernels and features (the same box enumerates edge[0] = length 5 under occt but length 20 under brepkit). `edgeRef` / `faceRef` are **query bridges only**, for FCStd import porting and mesh-chain parts that have no role layer; mesh-chain bare ordinals (`openFaces: [4]`) are likewise current-kernel-only.

### Selector Strings (precision chain)

When a script must pick topology without a UI-picked literal, use **CadQuery selector strings** on the BREP (precision) chain. The following ops accept them (as the top-level value or as array elements, in place of TopoRef literals):

| Op | Parameter accepting a selector string |
|---|---|
| `fillet` / `chamfer` | `edges` (edge selector) |
| `filletVariable` | `edge` (single edge; multi-match fails) |
| `shell` | `openFaces` (face selector) |
| `draft` / `defeature` | `faces` (face selector) |
| `extrude` | `upTo` (face selector, resolved on `baseFeature`; single face) |
| `sketchOnFace` / `sketchOnSurface` / `punchHole` | `face` (face selector on the target solid) |

Selector syntax follows CadQuery (compatible subset): `">Z"` = the face/edge at the Z extreme, `"<Z"` = Z minimum, `"|Z"` = parallel to Z (face normal / edge tangent), `"#Z"` = perpendicular to Z, `"+Z"`/`"-Z"` = facing +Z/-Z, `"%LINE"` = by type, `">Z,|X"`-style set expressions. Selectors are evaluated against the current kernel at runtime, so they are **portable across kernels** (unlike ordinals). A selector matching nothing, or matching more than one entity for a single-entity parameter, fails loudly — never silently picks one.

Selector strings are **precision-chain only**: the mesh chain has no role layer, so mesh solids must keep using 1-based ordinals (current-kernel-only, see above).

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

---

## Available Libraries

The following packages provide capabilities usable in `.fai.js` scripts.

### Platform (built-in `cad` namespace)

| Package | Description |
|---------|-------------|
| **@faicad/faijs** (core) | The platform `cad.*` namespace: primitives (box, sphere, cylinder, cone, wedge), boolean ops (union, subtract, intersect, cut), feature ops (extrude, fillet, chamfer, shell, draft, sweep, loft, revolve, etc.), pattern ops, transform ops, query ops, Shape instance methods (appearance, metadata), and more. Always available — no import needed. |

### Editor Ops (built into `cad` namespace)

Editor ops are built into core (`@faicad/faijs`) and available via `cad.*`: `fai_drill`, `fai_extrude`, `fai_split`, `group`, `assembly`, `copy`, `load`, `text`, `svgExtrude`.

### Sketch Op (built into `cad` namespace)

`cad.sketch` — constraint-based sketching with planegcs solver. Built into core (`@faicad/faijs`).

### Domain Libraries (imported via `import * as <binding> from '<specifier>'`)

| Package | Import Specifier | Description |
|---------|------------------|-------------|
| **@faicad/sheetmetal** | `@faicad/sheetmetal` or short name `sheetmetal` | Sheet-metal authoring, unfold, flat patterns, bend relief, cutouts, nesting, DXF export. |
| **@faicad/faijs-gears** | `@faicad/faijs-gears` or short name `faijs-gears` | Gear generation: spur, herringbone, ring, bevel, worm, rack, planetary gearsets. |
| **@faicad/faijs-fasteners** | `@faicad/faijs-fasteners` or short name `faijs-fasteners` | Fasteners: threads, nuts, screws, washers, bearings, sprockets, chain, holes. |
