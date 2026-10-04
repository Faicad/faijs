# @faicad/faijs-extra — Editor Extension Ops

> Editor extension ops merged into the `cad.*` namespace. Once merged, these ops are called as `cad.<opName>(...)` in `.fai.js` scripts — no import needed.

## A-Group: Editor Ops (three basic API only)

### `fai_drill(input, opts)`
Drills a hole into geometry. Supports simple holes and threaded holes.
- **Parameters** (object): `diameter` (required, must use unit literals), `position` ([x,y,z] world position), `depth` (must use unit literals; <= 0 or absent = through hole), `direction` ('normal'|'x'|'y'|'z', default 'normal'), `face` (face reference for placement).
- **Async**. Returns `Shape`.
- **Example**: `let drilled = cad.fai_drill(plate, { diameter: 5 * MM, position: [0, 0, 10 * MM], depth: 20 * MM })`

### `fai_extrude(input, opts)`
Extrudes geometry along a normal with direction mode.
- **Parameters** (object): `length` (required, must use unit literals), `mode` ('centered'|'forward'|'backward', default 'centered'), `normal` (default [0,0,1]), `planeDistance` (default 0), `space` ('local'|'world').
- **Async**. Returns `Shape`.
- **Example**: `let boss = cad.fai_extrude(face, { length: 10 * MM, mode: 'forward' })`

### `fai_split(input, opts)`
Splits geometry into two named halves `{ front, back }` by a plane or joinery cut.
- **Parameters** (object): `normal` (Vec3, default [0,0,1]), `offset` (must use unit literals, default 0), `cutMode` ('plane'|'dovetail'|'dowel'|'tenon', default 'plane'), `inPlaneAngle`, `bbCenter`, `bboxSize`.
- **Async**. Returns `{ front: Shape, back: Shape }`.
- **Example**: `let { front, back } = cad.fai_split(part, { normal: [0, 0, 1] })`

### `group(opts)`
Creates a structural compound (no geometry handle — purely structural).
- **Parameters** (object): `name` (optional string), `members` (Shape[]).
- **Sync**. Returns `Shape` (kind: 'compound', children carry geometry).

### `assembly(opts)`
Creates an assembly compound with constraints and solver.
- **Parameters** (object): `name`, `members` (Shape[]), `memberNames` (string[]), `constraints` (AssemblyConstraint[]), `joints` (JointSpec[]), `drive` (Record<string, number|number[]>), `memberColors`, `solver` ('chain'|'global').
- **Sync**. Returns `Shape` with `AssemblyBehavior` (has `.solve()` and `.solveDetailed()` methods).
- The assembly is solved via `do_assemble`: `await ctx.<asm>.do_assemble()`.

### `copy(input)`
Deep-copies geometry (independent new object, source unchanged).
- **Async**. Returns `Shape`.
- **Example**: `let copy_of_base = cad.copy(base_plate)`

### `load(opts)`
Loads a geometry asset from the asset library (file import Feature).
- **Parameters** (object): `file` (asset file name with extension, no path), `unit` (unit hint for STL).
- **Async**. Returns `Shape`.
- Format auto-detected from file extension: stl/3mf → mesh path; step/stp/stpz/brep → BREP path.
- **Example**: `let imported_mesh = cad.load({ file: 'box.stl' })`

## B-Group: SVG / 3D Text Creators

### `text(opts)`
Creates 3D text geometry from a string.
- **Parameters** (object): `text` (non-empty string, required), `size` (font size, must use unit literals, required), `depth` (extrusion depth, must use unit literals, required).
- **Async**. Returns `Shape`.
- Supports CJK characters (with system CJK font fallback to '?').
- **Example**: `let label = cad.text({ text: 'Hello', size: 10 * MM, depth: 2 * MM })`

### `svgExtrude(opts)`
Extrudes a 2D SVG profile into a 3D part.
- **Parameters** (object): `svg` (asset key or inline SVG text, required), `depth` (must use unit literals, required), `targetLongSide` (must use unit literals, default 20 * MM).
- **Async**. Returns `Shape`.
- **Example**: `let logo = cad.svgExtrude({ svg: 'logo.svg', depth: 5 * MM })`
