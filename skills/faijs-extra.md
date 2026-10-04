# @faicad/faijs-extra — Editor Extension Ops

> Editor extension ops merged into the `cad.*` namespace. Once merged, these ops are called as `cad.<opName>(...)` in `.fai.js` scripts — no import needed.

## A-Group: Editor Ops

### `fai_drill(input, opts)`
Drills a hole into geometry. Supports simple holes and threaded (screw) holes.

**Parameters** (object):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `diameter` | number | yes | — | Hole diameter (must use unit literals, e.g., `5 * MM`) |
| `depth` | number | no | 0 | Hole depth (must use unit literals). `0` = through hole, `> 0` = blind hole |
| `holeType` | `'simple' \| 'screw'` | no | `'simple'` | Hole type. `'screw'` adds internal thread geometry |
| `direction` | `'normal' \| 'x' \| 'y' \| 'z'` | no | `'normal'` | Drill axis direction. `'normal'` = along face normal |
| `position` | `[x, y, z]` | no | `[0, 0, 0]` | Hole center position (world coordinates, must use unit literals) |
| `face` | `FaceTopoRef` | no | — | Face reference for placement (resolved at execution time to derive face normal) |
| `faceNormal` | `[x, y, z]` | no | `[0, 0, 1]` | Face normal (determines orientation; legacy fallback, prefer `face`) |
| `tolerance` | number | no | 0.3 | Tolerance (must use unit literals) |
| `screwSystem` | `'metric' \| 'imperial'` | no | `'metric'` | Screw system (only when `holeType: 'screw'`) |
| `screwSpecIdx` | number | no | 4 | Screw spec index (only when `holeType: 'screw'`; `4` → M5) |
| `screwThread` | `'coarse' \| 'fine' \| 'custom'` | no | `'coarse'` | Screw thread type (only when `holeType: 'screw'`) |
| `screwHead` | `'hex' \| 'chc' \| 'none'` | no | `'none'` | Screw head type (only when `holeType: 'screw'`) |

- **Async**. Returns `Shape`.
- **Example**:
```js
// Simple through hole
let drilled = cad.fai_drill(plate, { diameter: 5 * MM, position: [0, 0, 10 * MM] })

// Blind hole
let blind = cad.fai_drill(plate, { diameter: 5 * MM, depth: 20 * MM })

// Threaded screw hole (M5)
let threaded = cad.fai_drill(plate, {
  diameter: 5.2 * MM, depth: 8 * MM, holeType: 'screw',
  screwSystem: 'metric', screwSpecIdx: 4, screwThread: 'coarse'
})
```

### `fai_extrude(input, opts)`
Extrudes geometry along a normal with direction mode.

**Parameters** (object):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `length` | number | yes | — | Total extrusion amount (must use unit literals) |
| `mode` | `'centered' \| 'forward' \| 'backward'` | no | `'centered'` | Extrusion direction. `centered` = half each way, `forward` = positive normal, `backward` = negative normal |
| `normal` | `[x, y, z]` | no | `[0, 0, 1]` | Extrusion direction normal |
| `planeDistance` | number | no | 0 | Offset of the cutting plane along the normal (must use unit literals) |
| `space` | `'local' \| 'world'` | no | — | Coordinate space declaration |

- **Async**. Returns `Shape`.
- **Example**:
```js
let boss = cad.fai_extrude(face, { length: 10 * MM, mode: 'forward' })
let centered = cad.fai_extrude(face, { length: 10 * MM, normal: [0, 0, 1], planeDistance: 2 * MM })
```

### `fai_split(input, opts)`
Splits geometry into two named halves `{ front, back }` by a plane or joinery cut (dovetail, dowel, tenon). The two halves are automatically separated along the normal by a small offset (bbox diagonal × 2% + half joinery depth).

**Common Parameters** (object):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `cutMode` | `'plane' \| 'dovetail' \| 'dowel' \| 'tenon' \| 'straight-tenon' \| 'straight'` | no | `'plane'` | Cut mode. `'plane'` = simple plane cut; `'dovetail'` = dovetail joinery; `'dowel'` = dowel pin; `'tenon'`/`'straight-tenon'` = straight tenon; `'straight'` = straight cut |
| `normal` | `[x, y, z]` | no | `[0, 0, 1]` | Cut plane normal (must be non-zero) |
| `offset` | number | no | 0 | Cut plane offset along normal from bbox center (must use unit literals) |
| `inPlaneAngle` | number | no | 0 | In-plane rotation angle of the cut plane (degrees, use `* DEGREE`) |
| `bbCenter` | `[x, y, z]` | no | auto | Bounding box center (auto-derived if omitted) |
| `bboxSize` | `[x, y, z]` | no | auto | Bounding box size (auto-derived if omitted) |
| `applyExplode` | boolean | no | `true` | Whether to separate the two halves along the normal |
| `selectedSections` | number[] | no | — | Section indices participating in joinery (for dowel/tenon modes) |

**Dovetail Parameters** (only when `cutMode: 'dovetail'`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `grooveDepth` | number | Dovetail groove depth (must use unit literals) |
| `grooveWidth` | number | Dovetail groove width (must use unit literals) |
| `grooveDepthTolerance` | number | Groove depth tolerance |
| `grooveWidthTolerance` | number | Groove width tolerance |
| `grooveFlapsAngle` | number | Dovetail flap angle (degrees, use `* DEGREE`) |

**Dowel Parameters** (only when `cutMode: 'dowel'`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `dowelDiameter` | number | Dowel pin diameter (must use unit literals) |
| `dowelDiameterTolerance` | number | Dowel diameter tolerance |
| `dowelHeight` | number | Dowel pin height (must use unit literals) |
| `dowelHeightTolerance` | number | Dowel height tolerance |

**Tenon Parameters** (only when `cutMode: 'tenon'` or `'straight-tenon'`):

| Parameter | Type | Description |
|-----------|------|-------------|
| `tenonSideLength` | number | Tenon side length (must use unit literals) |
| `tenonSideLengthTolerance` | number | Tenon side length tolerance |
| `tenonHeight` | number | Tenon height (must use unit literals) |
| `tenonHeightTolerance` | number | Tenon height tolerance |

- **Async**. Returns `{ front: Shape, back: Shape }` — must use destructuring.
- **Example**:
```js
// Simple plane cut
let { front, back } = cad.fai_split(part, { normal: [0, 0, 1] })

// Dovetail joinery cut
let { front: partA, back: partB } = cad.fai_split(part, {
  normal: [0, 0, 1], offset: 5 * MM,
  cutMode: 'dovetail',
  grooveDepth: 3 * MM, grooveWidth: 5 * MM,
  grooveFlapsAngle: 60 * DEGREE
})

// Dowel pin cut
let { front: a, back: b } = cad.fai_split(part, {
  cutMode: 'dowel',
  dowelDiameter: 6 * MM, dowelHeight: 10 * MM
})

// Tenon cut
let { front: a2, back: b2 } = cad.fai_split(part, {
  cutMode: 'tenon',
  tenonSideLength: 8 * MM, tenonHeight: 5 * MM
})
```

### `group(opts)`
Creates a structural compound (no geometry handle — purely structural). Members are bare variable references, not strings.

**Parameters** (object):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | no | — | Group name |
| `members` | Shape[] | no | `[]` | Member shapes (bare variable references in `.fai.js`) |
| `memberNames` | string[] | no | auto | Member names (auto-derived from variable names if omitted) |

- **Sync**. Returns `Shape` (kind: `'compound'`, children carry geometry).

### `assembly(opts)`
Creates an assembly compound with constraints and solver.

**Parameters** (object):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | string | no | — | Assembly name |
| `members` | Shape[] | no | `[]` | Member shapes (bare variable references) |
| `memberNames` | string[] | no | auto | Member names (auto-derived from variable names if omitted) |
| `constraints` | `AssemblyConstraint[]` | no | `[]` | Assembly constraints (see below) |
| `joints` | `JointSpec[]` | no | `[]` | Kinematic joint |
| `drive` | `Record<string, number \| number[]>` | no | — | Drive value overrides (key = child member name) |
| `memberColors` | `Record<string, [r, g, b]>` | no | — | Member colors (sRGB 0..1, for STEP export) |
| `solver` | `'chain' \| 'global'` | no | `'chain'` | Solver style. `'chain'` = chain topology; `'global'` = global least-squares |

- **Sync**. Returns `Shape` with `AssemblyBehavior` (has `.solve()` and `.solveDetailed()` methods).
- The assembly is solved via `do_assemble`: `await ctx.<asm>.do_assemble()`.

**Constraint Types** (a = reference, b = driven; b moves to fit a):

| Type | Description |
|------|-------------|
| `mate` | Face-to-face mate (normals opposite, face centers coincident) |
| `align` | Same-direction align (normals same direction, face centers coincident) |
| `coincident` | Coplanar/coincident point/line (retains 2 in-plane DOF) |
| `concentric` | Axis coincidence (shaft-hole fit; cylindrical/conical faces need `hint.axis`) |
| `distance` | Fixed distance (mm, with `value` field) |
| `angle` | Fixed angle (degrees, with `value` field) |
| `parallel` | Parallel (syntax sugar for `angle` with 0°) |
| `perpendicular` | Perpendicular (syntax sugar for `angle` with 90°) |
| `fixed` | Anchor part (ground) |

**EntityRef Forms**: `{ part, face: { topoRef } | { surfaceType?, center, normal } }`, `{ part, edge: { topoRef } | { axis: { origin, direction } } }`, `{ part, point: [x,y,z] }`, `{ part, faceIndex }` (1-based, debug shorthand).

### `copy(input)`
Deep-copies geometry into an independent new object (source unchanged, both source and copy are displayed).

- **Async**. Returns `Shape`.
- **Example**: `let copy_of_base = cad.copy(base_plate)`

### `load(opts)`
Loads a geometry asset from the asset library (file import Feature).

**Parameters** (object):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `file` | string | yes | — | Asset file name with extension, no path (e.g., `'box.stl'`, `'model.step'`) |
| `unit` | string | no | — | Unit hint for STL files (`'mm'`, `'cm'`, `'m'`, `'micron'`, `'inch'`, `'foot'`, `'yard'`). STEP/3MF declare their own units. |

- **Async**. Returns `Shape`.
- Format auto-detected from file extension: `stl`/`3mf` → mesh path; `step`/`stp`/`stpz`/`brep` → BREP path.
- Multi-part files are downgraded to the first part.
- **Example**:
```js
let imported_mesh = cad.load({ file: 'box.stl' })
let imported_step = cad.load({ file: 'model.step' })
let imported_3mf = cad.load({ file: 'part.3mf', unit: 'mm' })
```

## B-Group: SVG / 3D Text Creators

### `text(opts)`
Creates 3D text geometry from a string. Text is centered in X/Z, Y bottom aligned to origin.

**Parameters** (object):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | string | yes | — | Text to generate (non-empty) |
| `size` | number | yes | — | Font size (must use unit literals) |
| `depth` | number | yes | — | Extrusion depth (must use unit literals) |
| `font` | string | no | default font | Font (semantics undecided, do not pass yet) |

- **Async**. Returns `Shape`.
- Supports CJK characters (with system CJK font fallback to `'?'`).
- **Example**: `let label = cad.text({ text: 'Hello', size: 10 * MM, depth: 2 * MM })`

### `svgExtrude(opts)`
Extrudes a 2D SVG profile into a 3D part.

**Parameters** (object):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `svg` | string | yes | — | SVG content: asset key (recommended) or inline SVG text |
| `depth` | number | yes | — | Extrusion depth (must use unit literals) |
| `targetLongSide` | number | no | `20 * MM` | Target long side size (must use unit literals). SVG is scaled so its natural long side matches this value |

- **Async**. Returns `Shape`.
- **Example**: `let logo = cad.svgExtrude({ svg: 'logo.svg', depth: 5 * MM, targetLongSide: 20 * MM })`
