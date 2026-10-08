# faijs (OCCT engine skill) — .fai.js Scripting API Skill

> **Purpose**
>
> : This skill file tells AI agents what APIs are available when writing
>
> `.fai.js`
>
>  scripts for 3D CAD modeling with the faijs engine.

## What is faijs?

faijs is a CAD execution engine: a JavaScript-based language (`.fai.js`) for parametric 3D modeling with dual BREP (OCCT) and mesh (manifold) geometry backends. Scripts use a `cad.*` namespace for platform operations, and can `import` additional libraries for domain-specific capabilities (sheet metal, gears, fasteners, CadQuery compatibility, etc.).

## Script Structure

A `.fai.js` file is valid JavaScript with specific conventions:



* **Variable names must be descriptive and meaningful** (e.g., `bottom_leg`, `gear_hub`, `mounting_plate`). The `part0`, `part1`, ... pattern is only a UI-layer auto-generation convention — AI agents writing scripts must choose names that reflect the part's role in the design.

* The `cad` namespace is the default library, always available.

* Additional libraries are imported via `import * as <binding> from '<specifier>'`.

* **Units must be explicitly provided** using unit literal expressions. +Z is up. See the Unit System section below.



```
// A simple .fai.js script — note explicit unit literals
let base_plate = cad.box(100 * MM, 80 * MM, 10 * MM)
let shaft = cad.cylinder(5 * MM, 40 * MM, { centered: true })
let assembled = cad.union(base_plate, shaft)
let rounded = cad.fillet(assembled, { edges: [cad.edgeRef(assembled, 1)], radius: 2 * MM })
```

## Key Concepts

### Dual-Channel Execution

Every op supports the **mesh** path (default, manifold-3d). Some also support the **BREP** path (OCCT, exact geometry). Whether BREP is available is determined by **static rules** before execution — there is no runtime fallback. When a BREP-unsupported op is encountered, the chain switches to mesh for that operation onward.

### Result System

APIs use a `Result<T>` type (`ok`/`err`/`isErr`). In `.fai.js` scripts, statement boundaries automatically unwrap results — an `err` becomes a statement failure. Third-party library functions return `Result` natively; the boundary unwraps at the statement level.

### Topology References

Faces and edges are referenced by **role-based topology identity** (`cad.faceRef(shape, n)`, `cad.edgeRef(shape, n)`), where `n` is a 1-based ordinal matching FreeCAD's `FaceN`/`EdgeN` convention. This allows fillet/chamfer/draft/shell to target specific edges/faces across parametric changes.

### Unit System



* **+Z is up.**

* **Units must be explicitly provided** using unit literal expressions. The following uppercase constants are available as read-only globals in `.fai.js` scripts:



| Constant   | Value (base-unit scale) | Dimension          |
| ---------- | ----------------------- | ------------------ |
| `MM`       | 1                       | length (base unit) |
| `CM`       | 10                      | length             |
| `METER`    | 1000                    | length             |
| `MICRON`   | 0.001                   | length             |
| `INCH`     | 25.4                    | length             |
| `FOOT`     | 304.8                   | length             |
| `YARD`     | 914.4                   | length             |
| `DEGREE`   | 1                       | angle (base unit)  |
| `RADIAN`   | 180/π                   | angle              |
| `GRAM`     | 1                       | mass (base unit)   |
| `KILOGRAM` | 1000                    | mass               |
| `SECOND`   | 1                       | time (base unit)   |



* **Usage**: Multiply a number by a unit constant, e.g., `10 * MM`, `2 * INCH`, `45 * DEGREE`. The expression evaluates to a plain number in the base unit (mm for length, degree for angle).

* **Bare numbers on dimensioned parameters are rejected** by the dimension checker (`E_DIM_BARE_NUMBER`). You must always write `10 * MM`, not just `10`.

* Compound expressions are supported: `10 * MM + 2 * MM` evaluates to `12`.

* Unit constants are reserved — you cannot shadow them with `let INCH = ...` or use them as parameter names.



***

> **Engine-specific skill doc — auto-generated**
>
>  by
>
> `scripts/gen-engine-skill-docs.ts`
>
>  (do not edit by hand; regenerate on every faijs release via
>
> `npm run gen:engine-skill-docs`
>
> ).
> This doc lists the
>
> `cad.*`
>
>  ops available when the runtime BREP engine is
>
> **occt**
>
> .
> It contains the
>
> **74 engine-neutral (common) ops**
>
>  plus the
>
> **72 OCCT-only ops**
>
> .
> OCCT-only ops (72: alignTo, approximatePoints, autoHeal, boolean, circleArc, classifyPointOnFace, commonCells, complexExtrude, containsPoint, curveDegreeElevate, curveIsPeriodic, curveKnotInsert, curveKnotRemove, distanceBetween, draft, draftPrism, edge, ellipseArc, ellipseEdge, exportBrep, faceOnSurface, fixSelfIntersection, fuse, halfSpace, heal, helix, import_brep, import_step, inertia, inspectMassProps, interpolateWithTangents, isCompSolid, isCompound, isEdge, isEqual, isFace, isShell, isVertex, isWire, iterShapes, liftCurve2d, linearCenterOfMass, loft, makeSolid, nonPlanarFace, offset, offset2d, outerWire, pipe, projectPointOnEdge, projectPointOnFace, punchHole, reverseShape, reverseSurfaceU, screw, simplify, sketchOnFace, solidFromFaces, split, subShapeCount, surface, sweep, tangentArc, thicken, thread, toMultiviewPNG, toMultiviewSVG, toPNG, toSVG, twistExtrude, uvFromPoint, vertexPosition) are
>
> **excluded**
>
>  from the brepkit doc;
> brepkit-only ops (0: none) are excluded from the OCCT doc.



***

## Primitives (Creators, no input)

### `box(width, depth, height, opts?)`

Creates a rectangular box.



* **Parameters**: `width` (X), `depth` (Y), `height` (Z) — all required. Must use unit literals (e.g., `10 * MM`).

* **Options**: `centered` (bool, default false), `at` (\[x,y,z] center), `segments` (tessellation, default 64).

* **Sync**. Returns `Shape`.

* **Example**: `let bracket = cad.box(10 * MM, 20 * MM, 30 * MM)`, `let bracket = cad.box(10 * MM, 20 * MM, 30 * MM, { centered: true })`

### `sphere(radius, opts?)`

Creates a sphere.



* **Parameters**: `radius` (required). Must use unit literals (e.g., `10 * MM`).

* **Options**: `segments` (default 64), `center`/`at` (\[x,y,z], default \[0,0,0]).

* **Sync**. Returns `Shape`.

* **Example**: `let ball = cad.sphere({ radius: 10 * MM })`, `let ball = cad.sphere(10 * MM, { at: [0, 0, 10 * MM] })`

### `cylinder(radius, height, opts?)`

Creates a cylinder. `at` is the **base center** (BASE semantics); `centered` shifts base to -h/2.



* **Parameters**: `radius`, `height` (along +Z) — both required. Must use unit literals (e.g., `5 * MM`, `40 * MM`).

* **Options**: `centered` (bool), `at` (\[x,y,z] base center), `segments` (default 64).

* **Sync**. Returns `Shape`.

* **Example**: `let shaft = cad.cylinder(5 * MM, 40 * MM)`, `let shaft = cad.cylinder(5 * MM, 40 * MM, { centered: true })`

### `cone(radiusBottom, radiusTop, height, opts?)`

Creates a cone. `radiusTop=0` = pointed cone; `radiusTop=radiusBottom` = cylinder.



* **Parameters**: `radiusBottom`, `radiusTop`, `height` (+Z) — all required. Must use unit literals.

* **Options**: `centered`, `at` (base axis center), `segments` (default 64).

* **Sync**. Returns `Shape`.

### `wedge(opts)`

Creates a wedge.



* **Parameters** (object): `width`, `height`, `angle` (degrees), `length` — all required. Must use unit literals for dimensional values.

* **Sync**. Returns `Shape`.

* **Example**: `let w = cad.wedge({ width: 30 * MM, height: 20 * MM, angle: 45, length: 10 * MM })`

### `helix(opts)`

Creates a helix curve (1D).



* **Parameters** (object): `radius`, `pitch`, `turns` — all required. Must use unit literals for dimensional values.

* **Options**: `axis` (Vec3, default +Z), `origin` (Vec3, default origin).

* **Sync**. Returns `Shape` (kind: 'curve').

* **BREP only** (OCCT).

* **Example**: `let thread_path = cad.helix({ radius: 5 * MM, pitch: 2 * MM, turns: 3 })`

### `wire(points, opts?)`

Creates a 1D curve from a point list.



* **Parameters**: `points` (Vec3\[], at least 2 points).

* **Options**: `closed` (bool), `smooth` (bool, B-spline through all points), `degree` (default 3).

* **Sync**. Returns `Shape` (kind: 'curve').

### `profile(opts)`

Constructs a planar face or wire from 2D contours.



* **Parameters** (object): `contours` (ProfileLoop\[] | Blueprint | Blueprint\[]), `as` ('face' default | 'wire').

* **Sync**. Returns `Shape` (face or 1D curve).

* **BREP only**.

* **Example**: `let face = cad.profile({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }] })`

### `screw(opts)`

Generates a screw part (thread + head).



* **Parameters** (object): `system` ('metric'|'imperial'), `specIdx` (size index), `length` (must use unit literals), `thread` ('coarse'|'fine'|'custom'|'none', default 'coarse'), `head` ('hex'|'chc'|'none', default 'none'), `pitchCustom`, `nRad` (default 32).

* **Async**. Returns `Promise<Shape>`.

### `sdf(opts)`

Generates a mesh body from a signed distance field function (mesh-only).



* **Parameters** (object): `code` (SDF source string), `box` (sampling bounds, default \[-10,-10,-10]..\[10,10,10]), `resolution` (cell size, default 1.0), `params`.

* **Async**. Returns `Promise<Shape>`.

* **Mesh-only** — no BREP implementation. Dimensional values in `box` and `resolution` should use unit literals.

### `sketchOnPlane(opts)`

Places 2D contours on a plane to construct a Shape.



* **Parameters** (object): `contours`, `plane` (named: 'XY'/'XZ'/etc, or `{ origin, normal, xAxis }`), `as` ('face'|'wire').

* **Sync**. Returns `Shape`.

### `sketchOnFace(opts)`

Places 2D contours on a face of a solid.



* **Parameters** (object): `contours`, `on` (target Shape), `face` (1-based ordinal or `cad.faceRef`), `scaleMode`, `as`.

* **Sync**. Returns `Shape`.

### `punchHole(opts)`

Cuts a face-placed 2D profile out of a solid.



* **Parameters** (object): `contours`, `on` (Shape), `face`, `height` (blind depth, null=through), `draftAngle`, `scaleMode`.

* **Sync**. Returns `Shape`.

## Import Operations

### `import_brep(opts)`

Imports a frozen BREP asset from the container `assets/` directory.



* **Parameters** (object): `asset` (asset name, no extension).

* **Async**. Returns `Promise<Shape>`.

### `import_step(opts)`

Imports a STEP file from a local path.



* **Parameters** (object): `path` (absolute local path).

* **Async**. Returns `Promise<Shape>`.

* **BREP only**.

### `asset(key)`

Retrieves asset content as a UTF-8 string (for SVG/text assets).



* **Parameters**: `key` (string).

* **Async**. Returns `Promise<string>`.

## Boolean Operations

### `union(...shapes)`

Boolean union of all input shapes (>= 2).



* **Async**. Returns `Shape`.

* **Example**: `let merged = cad.union(base, top)`, `cad.union(a, b, c)`

### `subtract(...shapes)`

Boolean difference: first shape minus the rest.



* **Async**. Returns `Shape`.

* **Example**: `let drilled = cad.subtract(block, hole)`

### `intersect(...shapes)`

Boolean intersection of all inputs.



* **Async**. Returns `Shape`.

### `cut(base, tool)`

Boolean cut (subtract `tool` from `base`). Same as `subtract` but with brepjs-compatible signature.



* **Async**. Returns `Shape`.

## Feature Operations (input >= 1)

### `extrude(input, length | opts)`

Extrudes a face along a normal.



* **Length mode**: `length` (must use unit literals), `normal` (default \[0,0,1]), `mode` ('forward'|'backward'), `offset`.

* **Up-to mode**: `upTo` (FaceTopoRef | 'last' | 'first'), `baseFeature` (support body for 'last'/'first').

* **Async**. Returns `Shape`.

* **Example**: `let wall = cad.extrude(face, 10 * MM)`, `let boss = cad.extrude(sk, { upTo: cad.faceRef(base, 3) })`

### `revolve(input, opts)`

Revolves a planar profile around an axis.



* **Parameters** (object): `axis` (Vec3), `at` (Vec3, axis point), `angle` (degrees, default 360). Must use unit literals for dimensional values.

* **Async**. Returns `Shape` (with roleTable: bottom/top/wall:i).

### `sweep(profile, spine, opts?)`

Sweeps a cross-section along a spine path.



* **Parameters**: `profile` (wire or face), `spine` (wire), `opts` (frenet/mode/tolerance).

* **Async**. Returns `Shape`.

* **BREP only** (OCCT).

### `loft(sections, opts?)`

Lofts through ordered cross-sections.



* **Parameters**: `sections` (Shape\[], wire or face; >= 2), `opts` (ruled/startPoint/endPoint/tolerance).

* **Async**. Returns `Shape`.

* **BREP only** (OCCT).

### `fillet(input, opts)`

Fillets edges with a constant radius.



* **Parameters** (object): `edges` (EdgeTopoRef\[]), `radius` (> 0, must use unit literals).

* **Async**. Returns `Shape`.

* **Example**: `let rounded = cad.fillet(block, { edges: [cad.edgeRef(block, 1)], radius: 2 * MM })`

### `filletVariable(input, edge, r1, r2)`

Variable-radius fillet on a single edge (linear from r1 to r2).



* **Parameters**: `edge` (EdgeTopoRef), `r1` (start radius), `r2` (end radius). Must use unit literals.

* **Async**. Returns `Shape`.

* **BREP only**.

### `chamfer(input, opts)`

Chamfers edges.



* **Parameters** (object): `edges` (EdgeTopoRef\[]), `type` ('equal'|'twoDistances'|'distanceAngle'), `width` (for 'equal'), `width1`/`width2` (for 'twoDistances'), `angle` (for 'distanceAngle').

* **Async**. Returns `Shape`.

### `shell(input, opts)`

Shells a solid: removes specified faces and offsets remaining faces into a thin wall.



* **Parameters** (object): `openFaces` (FaceTopoRef\[]), `thickness` (> 0, must use unit literals), `tolerance`.

* **Async**. Returns `Shape`.

### `draft(input, opts)`

Applies draft angle to selected faces (casting/injection mold taper).



* **Parameters** (object): `faces` (FaceTopoRef\[]), `angleDeg` (degrees, use `* DEGREE`), `pull` (Vec3 draft direction, default +Z), `neutral` ({point} — only origin supported).

* **Async**. Returns `Shape`.

* **BREP only** (OCCT).

### `thicken(input, thickness)`

Thickens a face/shell into a solid.



* **Parameters**: `thickness` (!= 0, must use unit literals; positive = along normal, negative = reverse).

* **Async**. Returns `Shape`.

* **BREP only** (OCCT).

### `engrave(input, opts)`

Engraves text or SVG on a geometry surface.



* **Parameters** (object): `mode` ('concave'|'convex', default 'concave'), `depth` (must use unit literals), `text` (string) or `svg` (asset key), `textSize`, `svgSize`, `faceCenter` (\[x,y,z]), `faceNormal` (\[x,y,z]).

* **Async**. Returns `Shape`.

### `knurl(input, opts)`

Applies knurling texture (vertex displacement, mesh-only).



* **Parameters** (object): `knurlTextureHeight`, `knurlScaleU`, `knurlScaleV`, `knurlInvertDisplacement`, `knurlRefineLength`, `knurlMappingMode`, `faceCenter`, `faceNormal`.

* **Async**. Returns `Shape`.

* **Mesh-only** — no BREP implementation.

## Pattern / Replication Operations

### `linearPattern(input, direction, count, spacing)`

Linear array along a direction.



* **Parameters**: `direction` (Vec3), `count` (total including original), `spacing` (must use unit literals).

* **Async**. Returns `Shape`.

### `circularPattern(input, axis, count, opts?)`

Circular array around an axis.



* **Parameters**: `axis` (Vec3), `count`, `fullAngle` (degrees, default 360, use `* DEGREE`), `center` (Vec3, point on axis).

* **Async**. Returns `Shape`.

### `gridPattern(input, dirX, dirY, countX, countY, spacingX, spacingY)`

2D grid array.



* **Async**. Returns `Shape`.

### `rectangularPattern(input, opts)`

Rectangular array with explicit direction vectors.



* **Parameters** (object): `xDir`, `xCount`, `xSpacing`, `yDir`, `yCount`, `ySpacing`.

* **Async**. Returns `Shape`.

### `mirror(input, opts?)`

Returns a mirrored copy (source retained).



* **Parameters** (object): `normal` (Vec3, mirror plane normal), `at` (Vec3, point on plane).

* **Async**. Returns `Shape`.

### `mirrorJoin(input, opts?)`

Mirrors and fuses: original + mirrored copy fused into one.



* **Async**. Returns `Shape`.

### `clone(input)`

Deep-copies a shape handle (independent new object, source retained).



* **Async**. Returns `Shape`.

## Split / Section Operations

### `split(input, tools)`

Splits input by tool geometry, returns all pieces.



* **Parameters**: `tools` (Shape\[]).

* **Async**. Returns `Shape` (compound of pieces).

### `splitByPlane(input, opts)`

Splits a solid by an infinite plane into two named halves.



* **Parameters** (object): `point` (Vec3), `normal` (Vec3).

* **Async**. Returns `{ positive, negative }`.

### `sectionByPlane(input, opts)`

Computes the exact section curve of a solid with an infinite plane.



* **Parameters** (object): `point` (Vec3), `normal` (Vec3).

* **Async**. Returns `Shape` (1D curve compound).

## Transform Operations

### `place(input, opts?)`

Rigid placement: rotate (quaternion, around local origin) then translate.



* **Parameters** (object): `rotation` (\[x,y,z,w] quaternion), `position` (\[x,y,z] translation, must use unit literals).

* **Sync**. Returns `Shape`.

* **Example**: `let positioned = cad.place(bracket, { rotation: [0,0,sin(π/4),cos(π/4)], position: [10 * MM, 0, 0] })`

## Feature Repair Operations

### `defeature(input, opts?)`

Simplifies geometry by removing small features.



* **Async**. Returns `Shape`.

### `reverseShape(input)`

Reverses the orientation of a shape.



* **Async**. Returns `Shape`.

### `unifySameDomain(input)`

Unifies faces on the same geometric domain.



* **Async**. Returns `Shape`.

### `sew(input)`

Sews faces into a shell.



* **Async**. Returns `Shape`.

### `sewAndSolidify(input)`

Sews faces and solidifies into a solid.



* **Async**. Returns `Shape`.

### `removeHolesFromFace(input, opts?)`

Removes holes from a specified face.



* **Async**. Returns `Shape`.

## Structure Operations

### `compound(opts)`

Creates a geometric compound (holds OCCT handles, can be transformed/exported).



* **Parameters** (object): `members` (Shape\[]), `name` (optional string).

* **Sync**. Returns `Shape`.

## Assembly / Kinematics Operations

### `jointTrajectory(opts)`

Computes joint trajectories for a mechanism.



* **Async**. Returns trajectory data.

### `inverseKinematics(opts)`

Solves inverse kinematics for a mechanism.



* **Async**. Returns IK solution.

### `mechanismDOF(opts)`

Computes degrees of freedom for a mechanism.



* **Returns** DOF data.

## Query Operations

### `bboxCenter(shape)`

Returns the bounding box center.



* **Sync**. Returns `Vec3`.

### `bboxMin(shape)`

Returns the bounding box minimum corner.



* **Sync**. Returns `Vec3`.

### `bboxMax(shape)`

Returns the bounding box maximum corner.



* **Sync**. Returns `Vec3`.

### `faceNormal(shape, anchor?, ordinal?)`

Returns the face normal at an anchor point.



* **Sync**. Returns `Vec3`.

### `faceRef(shape, faceOrdinal)`

Returns a `FaceTopoRef` for the Nth face (1-based, matches FreeCAD `FaceN`).



* **Sync**. Returns `FaceTopoRef`.

### `edgeRef(shape, edgeOrdinal)`

Returns an `EdgeTopoRef` for the Nth edge (1-based, matches FreeCAD `EdgeN`).



* **Sync**. Returns `EdgeTopoRef`.

### `viewCamera(view)`

Resolves a view spec into a projection camera direction.



* **Parameters**: `view` (string: 'front'/'back'/'top'/'bottom'/'left'/'right'/'iso'/'XY'/etc, or `{ dir, xAxis? }`).

* **Sync**. Returns `{ direction, xAxis? }`.

### `projectView(shape, view, opts?)`

Projects a shape to a single-view SVG line drawing.



* **Parameters**: `shape`, `view` (spec), `strokeWidth`, `dash`, `hiddenOpacity`, `margin`, `width`, `height`.

* **Sync**. Returns SVG string.

* **BREP input required**.

### `projectSheet(shape, views, opts?)`

Projects a shape to a multi-view SVG sheet.



* **Parameters**: `shape`, `views` (array of view specs), `cols` (default 2), `gap` (default 30), `labels` (default true), `cellWidth`, `cellHeight`.

* **Sync**. Returns SVG string.

* **BREP input required**.



***

## A-Group: Editor Ops

### `fai_drill(input, opts)`

Drills a hole into geometry. Supports simple holes and threaded (screw) holes.

**Parameters** (object):



| Parameter      | Type                             | Required | Default     | Description                                                                     |
| -------------- | -------------------------------- | -------- | ----------- | ------------------------------------------------------------------------------- |
| `diameter`     | number                           | yes      | —           | Hole diameter (must use unit literals, e.g., `5 * MM`)                          |
| `depth`        | number                           | no       | 0           | Hole depth (must use unit literals). `0` = through hole, `> 0` = blind hole     |
| `holeType`     | `'simple' \| 'screw'`            | no       | `'simple'`  | Hole type. `'screw'` adds internal thread geometry                              |
| `direction`    | `'normal' \| 'x' \| 'y' \| 'z'`  | no       | `'normal'`  | Drill axis direction. `'normal'` = along face normal                            |
| `position`     | `[x, y, z]`                      | no       | `[0, 0, 0]` | Hole center position (world coordinates, must use unit literals)                |
| `face`         | `FaceTopoRef`                    | no       | —           | Face reference for placement (resolved at execution time to derive face normal) |
| `faceNormal`   | `[x, y, z]`                      | no       | `[0, 0, 1]` | Face normal (determines orientation; legacy fallback, prefer `face`)            |
| `tolerance`    | number                           | no       | 0.3         | Tolerance (must use unit literals)                                              |
| `screwSystem`  | `'metric' \| 'imperial'`         | no       | `'metric'`  | Screw system (only when `holeType: 'screw'`)                                    |
| `screwSpecIdx` | number                           | no       | 4           | Screw spec index (only when `holeType: 'screw'`; `4` → M5)                      |
| `screwThread`  | `'coarse' \| 'fine' \| 'custom'` | no       | `'coarse'`  | Screw thread type (only when `holeType: 'screw'`)                               |
| `screwHead`    | `'hex' \| 'chc' \| 'none'`       | no       | `'none'`    | Screw head type (only when `holeType: 'screw'`)                                 |



* **Async**. Returns `Shape`.

* **Example**:



```
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



| Parameter       | Type                                    | Required | Default      | Description                                                                                                |
| --------------- | --------------------------------------- | -------- | ------------ | ---------------------------------------------------------------------------------------------------------- |
| `length`        | number                                  | yes      | —            | Total extrusion amount (must use unit literals)                                                            |
| `mode`          | `'centered' \| 'forward' \| 'backward'` | no       | `'centered'` | Extrusion direction. `centered` = half each way, `forward` = positive normal, `backward` = negative normal |
| `normal`        | `[x, y, z]`                             | no       | `[0, 0, 1]`  | Extrusion direction normal                                                                                 |
| `planeDistance` | number                                  | no       | 0            | Offset of the cutting plane along the normal (must use unit literals)                                      |
| `space`         | `'local' \| 'world'`                    | no       | —            | Coordinate space declaration                                                                               |



* **Async**. Returns `Shape`.

* **Example**:



```
let boss = cad.fai_extrude(face, { length: 10 * MM, mode: 'forward' })
let centered = cad.fai_extrude(face, { length: 10 * MM, normal: [0, 0, 1], planeDistance: 2 * MM })
```

### `fai_split(input, opts)`

Splits geometry into two named halves `{ front, back }` by a plane or joinery cut (dovetail, dowel, tenon). The two halves are automatically separated along the normal by a small offset (bbox diagonal × 2% + half joinery depth).

**Common Parameters** (object):



| Parameter          | Type                                                                            | Required | Default     | Description                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cutMode`          | `'plane' \| 'dovetail' \| 'dowel' \| 'tenon' \| 'straight-tenon' \| 'straight'` | no       | `'plane'`   | Cut mode. `'plane'` = simple plane cut; `'dovetail'` = dovetail joinery; `'dowel'` = dowel pin; `'tenon'`/`'straight-tenon'` = straight tenon; `'straight'` = straight cut |
| `normal`           | `[x, y, z]`                                                                     | no       | `[0, 0, 1]` | Cut plane normal (must be non-zero)                                                                                                                                        |
| `offset`           | number                                                                          | no       | 0           | Cut plane offset along normal from bbox center (must use unit literals)                                                                                                    |
| `inPlaneAngle`     | number                                                                          | no       | 0           | In-plane rotation angle of the cut plane (degrees, use `* DEGREE`)                                                                                                         |
| `bbCenter`         | `[x, y, z]`                                                                     | no       | auto        | Bounding box center (auto-derived if omitted)                                                                                                                              |
| `bboxSize`         | `[x, y, z]`                                                                     | no       | auto        | Bounding box size (auto-derived if omitted)                                                                                                                                |
| `applyExplode`     | boolean                                                                         | no       | `true`      | Whether to separate the two halves along the normal                                                                                                                        |
| `selectedSections` | number\[]                                                                       | no       | —           | Section indices participating in joinery (for dowel/tenon modes)                                                                                                           |

**Dovetail Parameters** (only when `cutMode: 'dovetail'`):



| Parameter              | Type   | Description                                    |
| ---------------------- | ------ | ---------------------------------------------- |
| `grooveDepth`          | number | Dovetail groove depth (must use unit literals) |
| `grooveWidth`          | number | Dovetail groove width (must use unit literals) |
| `grooveDepthTolerance` | number | Groove depth tolerance                         |
| `grooveWidthTolerance` | number | Groove width tolerance                         |
| `grooveFlapsAngle`     | number | Dovetail flap angle (degrees, use `* DEGREE`)  |

**Dowel Parameters** (only when `cutMode: 'dowel'`):



| Parameter                | Type   | Description                                 |
| ------------------------ | ------ | ------------------------------------------- |
| `dowelDiameter`          | number | Dowel pin diameter (must use unit literals) |
| `dowelDiameterTolerance` | number | Dowel diameter tolerance                    |
| `dowelHeight`            | number | Dowel pin height (must use unit literals)   |
| `dowelHeightTolerance`   | number | Dowel height tolerance                      |

**Tenon Parameters** (only when `cutMode: 'tenon'` or `'straight-tenon'`):



| Parameter                  | Type   | Description                                |
| -------------------------- | ------ | ------------------------------------------ |
| `tenonSideLength`          | number | Tenon side length (must use unit literals) |
| `tenonSideLengthTolerance` | number | Tenon side length tolerance                |
| `tenonHeight`              | number | Tenon height (must use unit literals)      |
| `tenonHeightTolerance`     | number | Tenon height tolerance                     |



* **Async**. Returns `{ front: Shape, back: Shape }` — must use destructuring.

* **Example**:



```
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



| Parameter     | Type      | Required | Default | Description                                                |
| ------------- | --------- | -------- | ------- | ---------------------------------------------------------- |
| `name`        | string    | no       | —       | Group name                                                 |
| `members`     | Shape\[]  | no       | `[]`    | Member shapes (bare variable references in `.fai.js`)      |
| `memberNames` | string\[] | no       | auto    | Member names (auto-derived from variable names if omitted) |



* **Sync**. Returns `Shape` (kind: `'compound'`, children carry geometry).

### `assembly(opts)`

Creates an assembly compound with constraints and solver.

**Parameters** (object):



| Parameter      | Type                                 | Required | Default   | Description                                                                 |
| -------------- | ------------------------------------ | -------- | --------- | --------------------------------------------------------------------------- |
| `name`         | string                               | no       | —         | Assembly name                                                               |
| `members`      | Shape\[]                             | no       | `[]`      | Member shapes (bare variable references)                                    |
| `memberNames`  | string\[]                            | no       | auto      | Member names (auto-derived from variable names if omitted)                  |
| `constraints`  | `AssemblyConstraint[]`               | no       | `[]`      | Assembly constraints (see below)                                            |
| `joints`       | `JointSpec[]`                        | no       | `[]`      | Kinematic joint                                                             |
| `drive`        | `Record<string, number \| number[]>` | no       | —         | Drive value overrides (key = child member name)                             |
| `memberColors` | `Record<string, [r, g, b]>`          | no       | —         | Member colors (sRGB 0..1, for STEP export)                                  |
| `solver`       | `'chain' \| 'global'`                | no       | `'chain'` | Solver style. `'chain'` = chain topology; `'global'` = global least-squares |



* **Sync**. Returns `Shape` with `AssemblyBehavior` (has `.solve()` and `.solveDetailed()` methods).

* The assembly is solved via `do_assemble`: `await ctx.<asm>.do_assemble()`.

**Constraint Types** (a = reference, b = driven; b moves to fit a):



| Type            | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| `mate`          | Face-to-face mate (normals opposite, face centers coincident)                 |
| `align`         | Same-direction align (normals same direction, face centers coincident)        |
| `coincident`    | Coplanar/coincident point/line (retains 2 in-plane DOF)                       |
| `concentric`    | Axis coincidence (shaft-hole fit; cylindrical/conical faces need `hint.axis`) |
| `distance`      | Fixed distance (mm, with `value` field)                                       |
| `angle`         | Fixed angle (degrees, with `value` field)                                     |
| `parallel`      | Parallel (syntax sugar for `angle` with 0°)                                   |
| `perpendicular` | Perpendicular (syntax sugar for `angle` with 90°)                             |
| `fixed`         | Anchor part (ground)                                                          |

**EntityRef Forms**: `{ part, face: { topoRef } | { surfaceType?, center, normal } }`, `{ part, edge: { topoRef } | { axis: { origin, direction } } }`, `{ part, point: [x,y,z] }`, `{ part, faceIndex }` (1-based, debug shorthand).

### `copy(input)`

Deep-copies geometry into an independent new object (source unchanged, both source and copy are displayed).



* **Async**. Returns `Shape`.

* **Example**: `let copy_of_base = cad.copy(base_plate)`

### `load(opts)`

Loads a geometry asset from the asset library (file import Feature).

**Parameters** (object):



| Parameter | Type   | Required | Default | Description                                                                                                                  |
| --------- | ------ | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `file`    | string | yes      | —       | Asset file name with extension, no path (e.g., `'box.stl'`, `'model.step'`)                                                  |
| `unit`    | string | no       | —       | Unit hint for STL files (`'mm'`, `'cm'`, `'m'`, `'micron'`, `'inch'`, `'foot'`, `'yard'`). STEP/3MF declare their own units. |



* **Async**. Returns `Shape`.

* Format auto-detected from file extension: `stl`/`3mf` → mesh path; `step`/`stp`/`stpz`/`brep` → BREP path.

* Multi-part files are downgraded to the first part.

* **Example**:



```
let imported_mesh = cad.load({ file: 'box.stl' })
let imported_step = cad.load({ file: 'model.step' })
let imported_3mf = cad.load({ file: 'part.3mf', unit: 'mm' })
```

## B-Group: SVG / 3D Text Creators

### `text(opts)`

Creates 3D text geometry from a string. Text is centered in X/Z, Y bottom aligned to origin.

**Parameters** (object):



| Parameter | Type   | Required | Default      | Description                                 |
| --------- | ------ | -------- | ------------ | ------------------------------------------- |
| `text`    | string | yes      | —            | Text to generate (non-empty)                |
| `size`    | number | yes      | —            | Font size (must use unit literals)          |
| `depth`   | number | yes      | —            | Extrusion depth (must use unit literals)    |
| `font`    | string | no       | default font | Font (semantics undecided, do not pass yet) |



* **Async**. Returns `Shape`.

* Supports CJK characters (with system CJK font fallback to `'?'`).

* **Example**: `let label = cad.text({ text: 'Hello', size: 10 * MM, depth: 2 * MM })`

### `svgExtrude(opts)`

Extrudes a 2D SVG profile into a 3D part.

**Parameters** (object):



| Parameter        | Type   | Required | Default   | Description                                                                                               |
| ---------------- | ------ | -------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `svg`            | string | yes      | —         | SVG content: asset key (recommended) or inline SVG text                                                   |
| `depth`          | number | yes      | —         | Extrusion depth (must use unit literals)                                                                  |
| `targetLongSide` | number | no       | `20 * MM` | Target long side size (must use unit literals). SVG is scaled so its natural long side matches this value |



* **Async**. Returns `Shape`.

* **Example**: `let logo = cad.svgExtrude({ svg: 'logo.svg', depth: 5 * MM, targetLongSide: 20 * MM })`



***

## `sketch(opts)`

Creates a constrained sketch, solves it, and produces a face or wire on a plane.

### Parameters (object)



| Parameter     | Type                                   | Required            | Default  | Description                                                                                                                                                                              |
| ------------- | -------------------------------------- | ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shapes`      | `SketchShape[]`                        | one of shapes/geoms | —        | Semantic primitive list: rectangle, circle, rounded rectangle, ellipse, regular polygon, slot, trapezoid + pen primitives (line, arc, spline, point) + `close`. Recommended for scripts. |
| `geoms`       | `SketchGeom[]`                         | one of shapes/geoms | —        | Expanded canonical geometry (existing script form).                                                                                                                                      |
| `constraints` | `SketchConstraint[]`                   | no                  | —        | Dimensional and geometric constraints. A constraint-free sketch is equivalent to `cad.profile`.                                                                                          |
| `as`          | `'face' \| 'wire'`                     | no                  | `'face'` | Product form. `'wire'` produces an outer wire (for sweep spines).                                                                                                                        |
| `plane`       | `string \| { origin, normal, xAxis? }` | no                  | `'XY'`   | Named plane (`'XY'`, `'XZ'`, `'YZ'`) or explicit plane frame. Places the solved contours on an arbitrary plane in one step.                                                              |

### Returns

**Async**. `Promise<Shape>` — a face or wire on the specified plane.

### Shape Primitives (for `shapes` parameter)

The `shapes` array entries can be:



* **Rectangle**: `{ kind: 'rect', x, y, w, h, tag? }`

* **Circle**: `{ kind: 'circle', x, y, r, tag? }`

* **Rounded rectangle**: `{ kind: 'roundedRect', x, y, w, h, r, tag? }`

* **Ellipse**: `{ kind: 'ellipse', x, y, rx, ry, tag? }`

* **Regular polygon**: `{ kind: 'polygon', x, y, r, n, tag? }`

* **Slot**: `{ kind: 'slot', x1, y1, x2, y2, r, tag? }`

* **Trapezoid**: `{ kind: 'trapezoid', ... }`

* **Pen primitives**: `{ kind: 'line', x1, y1, x2, y2 }`, `{ kind: 'arc', ... }`, `{ kind: 'spline', ... }`, `{ kind: 'point', x, y }`

* **Close**: `{ kind: 'close' }` — closes the current pen contour

### Constraint Types

Constraints are passed as the `constraints` array. Common types include:



* Distance, angle, coincidence, concentricity, parallelism, perpendicularity

* Fixed (structural), horizontal, vertical

* Equal length/radius, symmetry, point-on-line/arc

### Example



```
// A rectangle with a dimensional constraint
let sk = cad.sketch({
  shapes: [{ kind: 'rect', x: 0, y: 0, w: 40, h: 20 }],
  as: 'face',
  plane: 'XY'
})

// A constraint-free sketch (equivalent to cad.profile)
let ring = cad.sketch({
  shapes: [
    { kind: 'circle', x: 0, y: 0, r: 10 },
    { kind: 'circle', x: 0, y: 0, r: 5 }
  ],
  as: 'face'
})

// Sketch on a custom plane
let top_face = cad.sketch({
  shapes: [{ kind: 'rect', x: 0, y: 0, w: 30, h: 30 }],
  plane: { origin: [0, 0, 10], normal: [0, 0, 1] }
})
```

### Notes



* **Exactly one** of `shapes` / `geoms` must be provided (not both).

* Non-`solved` outcomes (under-constrained, redundant, conflicting) still produce geometry.

* The produced face/wire can be consumed by `cad.extrude`, `cad.sweep`, `cad.revolve`, etc.



***

## Usage

In `.fai.js`:



```
import * as sheet from '@faicad/sheetmetal'

let base_panel = sheet.author({ thickness: 2, base: { length: 100, width: 60 }, flanges: [] })
let solid = sheet.solidOf(base_panel)
```

## Authoring (Folded Part Construction)

### `author(spec)`

Authors a straight-bend part: a base flat plus folded-up flanges.



* **Parameters** (`AuthorSpec`): `{ thickness, base: { length, width }, flanges: [...], seams?: [...], material? }`

* **FlangeSpec**: `{ id, length, angleDeg, side ('xmin'|'xmax'|'ymin'|'ymax'), rule: { innerRadius, kFactor } }`

* **SeamSpec**: `{ parent, child, angleDeg, rule }`

* **MaterialSpec**: `{ name, thickness, defaultRule: { innerRadius, kFactor } }`

* **Async**. Returns `Result<SheetMetalPart>`.

* **Example**: `let bracket = sheet.author({ thickness: 2, base: { length: 100, width: 60 }, flanges: [{ id: 'f1', length: 40, angleDeg: 90, side: 'xmax', rule: { innerRadius: 2, kFactor: 0.44 } }] })`

### `solidOf(part)`

Extracts the 3D solid from an authored part. Needed because `.fai.js` statements cannot read nested member expressions (`p.solid`).



* **Sync**. Returns `Result<Solid>`.

### `fold(input)`

Folds a flat pattern (region-tree) up into a 3D part — the inverse of unfold.



* **Async**. Returns `Result<SheetMetalPart>`.

### `unfold(part)`

Flattens an authored part into a developed flat pattern + bend report + warnings.



* **Sync**. Returns `Result<UnfoldResult>` (contains `pattern`, `report`, `warnings`).

### `unfoldSolid(solid, opts?)`

Unfolds an imported sheet-metal solid (no feature tree) by detecting geometry numerically.



* **Parameters**: `solid` (B-rep solid), `opts.kFactor` (default 0.5, mid-surface).

* **Sync**. Returns `Result<UnfoldResult>`.

## Flange Features

### `contourFlange(part, spec)`

Authors a contour flange: open line/arc profile swept along a base edge into a multi-bend cross-section.



* **Async**. Returns `Result<SheetMetalPart>`.

### `loftedFlange(part, spec)`

Authors a lofted/ruled transition flange between two parallel open profiles.



* **Async**. Returns `Result<SheetMetalPart>`.

### `hem(part, spec)`

Folds a region edge back \~180°+ onto its parent (closed/open/teardrop/rolled hem).



* **Parameters** (`HemSpec`): `{ region, side, type, length, radius, rule }`

* **Async**. Returns `Result<SheetMetalPart>`.

### `jog(part, spec)`

Steps a region's flat by `offsetHeight` with two opposite bends (joggle).



* **Parameters** (`JogSpec`): bend line, offset height, radii.

* **Async**. Returns `Result<SheetMetalPart>`.

## Cutout / Hole Features

### `addCutout(part, spec)`

Punches a cutout (hole/slot/polygon) through a named flat region.



* **Parameters** (`CutoutSpec`): `{ kind, region, ...geometry }`

* **Async**. Returns `Result<SheetMetalPart>`.

### `addHole(part, region, x, y, diameter)`

Punches a circular hole centered at region-local (x, y).



* **Async**. Returns `Result<SheetMetalPart>`.

### `addSlot(part, region, opts)`

Punches a slot (rectangular or obround) at region-local (x, y).



* **Parameters** (`opts`): `{ x, y, length, width, angleDeg?, round? }`

* **Async**. Returns `Result<SheetMetalPart>`.

### `addPolygonCutout(part, region, points)`

Punches an arbitrary polygon cutout from region-local points.



* **Async**. Returns `Result<SheetMetalPart>`.

### `addTab(part, spec)`

Fuses a rectangular tab (additive protrusion) onto a region's edge.



* **Async**. Returns `Result<SheetMetalPart>`.

### `tabAndSlot(part, tab, slot)`

Self-fixturing tab-and-slot joint: tab on one region + matching slot on another.



* **Async**. Returns `Result<SheetMetalPart>`.

## Form Features

### `louver(part, opts)`

Forms a louver (vent flap) on a region.



* **Parameters**: `{ region, x, y, length, width, height, direction? }`

* **Async**. Returns `Result<SheetMetalPart>`.

### `emboss(part, opts)`

Forms a round emboss (raised) or dimple (recessed) on a region.



* **Parameters**: `{ region, x, y, diameter, height, kind: 'dimple'|'emboss' }`

* **Async**. Returns `Result<SheetMetalPart>`.

## Miter & Relief

### `miter(part, plane)`

Cuts a part by an oriented plane, removing material on the +normal side.



* **Parameters** (`MiterPlane`): `{ point, normal }`

* **Async**. Returns `Result<SheetMetalPart>`.

### `miterCorner(part, flangeIdA, flangeIdB, gap?)`

Auto-miters the shared corner of two flanges.



* **Async**. Returns `Result<SheetMetalPart>`.

### `bendRelief(part, flangeId, spec?)`

Adds bend relief at each mid-edge end of a partial flange's bend line.



* **Async**. Returns `Result<SheetMetalPart>`.

### `autoReliefs(part, spec?)`

Adds bend relief to every partial-span bend.



* **Async**. Returns `Result<SheetMetalPart>`.

### `relieveCorner(part, flangeIdA, flangeIdB, spec?)`

Cuts a corner relief notch at the shared corner of two adjacent flanges.



* **Async**. Returns `Result<SheetMetalPart>`.

## Reporting & Validation

### `report(part)`

Builds a bend report by walking the part's feature tree.



* **Sync**. Returns `Result<BendReport>`.

### `reportFrom(result)`

Projects the bend report already computed by `unfold`.



* **Sync**. Returns `Result<BendReport>`.

### `reportJSON(report)`

Serializes a bend report to stable pretty-printed JSON.



* **Sync**. Returns `string`.

### `validate(part)`

Manufacturability checks — advisory warnings, never errors.



* **Sync**. Returns `SheetMetalWarning[]` (empty = manufacturable).

## Bend Allowance

### `allowance(angleDeg, thickness, rule, onWarning?)`

Computes bend allowance: `BA = (π/180)·|angle|·(R + K·T)`.



* **Sync**. Returns `Result<number>`.

### `develop(angleDeg, thickness, rule, onWarning?)`

Neutral-axis developed length of a bend region.



* **Sync**. Returns `Result<number>`.

### `resolveAllowance(rule, angleDeg, thickness, onWarning?)`

Resolves a bend's developed allowance through the single resolution point (bend table → explicit allowance → K-factor formula).



* **Sync**. Returns `Result<number>`.

### `addBendTable(table)`

Registers (or replaces) a shop bend table.



* **Sync**. Returns `Result<BendTable>`.

### `bendTable(id)`

Looks up a registered bend table by id.



* **Sync**. Returns `BendTable | undefined`.

## Nesting & DXF Export

### `nest(patterns, options)`

Nests developed flat patterns onto stock sheets.



* **Parameters** (`NestOptions`): `{ strategy: 'bbox'|'nfp', sheetWidth, sheetHeight, spacing }`

* **Sync**. Returns `Result<NestResult>`.

### `nestToDXF(result, patterns, sheetIndex, options?)`

Emits one fabrication-ready DXF for a single nested sheet.



* **Sync**. Returns `Result<string>`.

### `toDXF(pattern, options?)`

Emits an annotated multi-layer DXF string for a flat pattern.



* **Parameters** (`DxfOptions`): layers, precision, units.

* **Sync**. Returns `Result<string>`.



***

## Usage

In `.fai.js`:



```
import * as gears from '@faicad/faijs-gears'

let drive_gear = gears.spurGear({ module: 2, teeth_number: 24, width: 8 })
let pinion = gears.spurGear({ module: 2, teeth_number: 12, width: 8 })
let pinion_offset = cad.translate(pinion, { offset: [36, 0, 0] })
let gear_assembly = cad.union(drive_gear, pinion_offset)
```

> **Parameter names follow the Python cq_gears convention verbatim**
>
>  (e.g.,
>
> `module`
>
> ,
>
> `teeth_number`
>
> ,
>
> `width`
>
> ,
>
> `pressure_angle`
>
> ,
>
> `helix_angle`
>
> ). Do not use camelCase variants — the library expects snake_case parameter names matching the Python source.

## Single Gears (return `Result<BrepHandle>`)

### `spurGear(params, options?)`

Spur gear (straight-tooth cylindrical gear).



* **Parameters** (`SpurGearParams`):


  * `module` (number) — gear module m (pitch diameter / teeth count)

  * `teeth_number` (number) — number of teeth

  * `width` (number) — face width (along the gear axis)

  * `pressure_angle` (number, optional, default 20) — pressure angle in degrees

  * `helix_angle` (number, optional, default 0) — helix angle in degrees (0 = spur)

  * `clearance` (number, optional, default 0)

  * `backlash` (number, optional, default 0)

  * `addendum_coeff` (number | null, optional) — addendum coefficient (default 1.0)

  * `dedendum_coeff` (number | null, optional) — dedendum coefficient (default 1.25)

* **Options** (`BuildSpurGearOptions`): tooth surface strategy, feature fields.

* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `herringboneGear(params, options?)`

Herringbone gear (V-tooth cylindrical gear). Same params as `spurGear`.



* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `ringGear(params, options?)`

Ring gear (internal-tooth annular gear).



* **Parameters** (`RingGearParams`):


  * `module`, `teeth_number`, `width` — same as `spurGear`

  * `rim_width` (number) — rim width (outer ring thickness)

  * `pressure_angle`, `helix_angle`, `clearance`, `backlash` — optional, same as `spurGear`

* **Options** (`BuildRingGearOptions`): tooth surface strategy, feature fields.

* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `herringboneRingGear(params, options?)`

Herringbone ring gear. Same params as `ringGear`.



* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `crossedHelicalGear(params, options?)`

Crossed-axis helical gear (single gear).



* **Parameters** (`CrossedHelicalGearParams`): `module`, `teeth_number`, `width`, `pressure_angle`, `helix_angle`, `clearance`, `backlash`.

* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `hyperbolicGear(params, options?)`

Hyperbolic gear (single gear).



* **Parameters** (`HyperbolicGearParams`): `module`, `teeth_number`, `width`, `twist_angle` (throat twist angle in degrees), `pressure_angle`, `clearance`, `backlash`.

* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `bevelGear(params, options?)`

Bevel gear (spherical involute, single gear).



* **Parameters** (`BevelGearParams`):


  * `module`, `teeth_number` — same as `spurGear`

  * `cone_angle` (number) — pitch cone angle in degrees

  * `face_width` (number) — face width along the cone generatrix

  * `pressure_angle`, `helix_angle`, `clearance`, `backlash` — optional

* **Options** (`BuildBevelGearOptions`): tooth surface strategy, `boreD`, `trim`.

* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `rackGear(params, options?)`

Rack gear (straight-tooth linear rack).



* **Parameters** (`RackGearParams`): `module`, `length`, `width`, `height`, `pressure_angle`, `helix_angle`, `clearance`, `backlash`.

* **Options** (`BuildRackGearOptions`): tooth surface strategy.

* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `herringboneRackGear(params, options?)`

Herringbone rack gear. Same params as `rackGear` (internally forces `herringbone: true`).



* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `worm(params, options?)`

Worm gear (cylindrical worm).



* **Parameters** (`WormParams`):


  * `module` (number) — gear module

  * `lead_angle` (number) — lead angle in degrees

  * `n_threads` (number) — number of threads/starts

  * `length` (number) — worm length (axial, along X)

  * `pressure_angle`, `clearance`, `backlash` — optional

* **Options** (`BuildWormOptions`): strategy (default grid-approx), sew/group tolerance, `boreD`.

* **Async**. Returns `Promise<Result<BrepHandle, string>>`.

## Gear Pairs (return named records)

### `bevelGearPair(params, options?)`

Bevel gear pair (assembly). Pinion is pre-positioned unless `transformPinion: false`.



* **Parameters** (`BevelGearPairParams`):


  * `module`, `gear_teeth`, `pinion_teeth`, `face_width`

  * `axis_angle` (number, optional, default 90) — shaft angle in degrees

  * `pressure_angle`, `helix_angle`, `clearance`, `backlash` — optional

* **Options** (`BuildBevelGearPairOptions`): strategy, `boreD`, `trim`, `transformPinion`, `buildGear`, `buildPinion`.

* **Async**. Returns `Promise<Result<{ gear?: BrepHandle, pinion?: BrepHandle }, string>>`.

* `fn.outputs`: `['gear', 'pinion']`

### `crossedGearPair(params, options?)`

Crossed-axis helical gear pair (assembly). Gear2 is positioned by shaft angle.



* **Parameters** (`CrossedGearPairParams`):


  * `module`, `gear1_teeth_number`, `gear2_teeth_number`, `gear1_width`, `gear2_width`

  * `shaft_angle` (number, optional) — shaft angle in degrees

  * `gear1_helix_angle` (number | null, optional) — gear1 helix angle; null = each gear takes `shaft_angle/2`

  * `pressure_angle`, `clearance`, `backlash` — optional

* **Options** (`BuildCrossedGearPairOptions`): `buildGear1`, `buildGear2`, `transformGear2`, strategy.

* **Async**. Returns `Promise<Result<{ gear1?: BrepHandle, gear2?: BrepHandle }, string>>`.

* `fn.outputs`: `['gear1', 'gear2']`

### `hyperbolicGearPair(params, options?)`

Hyperbolic gear pair (assembly). Same output shape as `crossedGearPair`.



* **Parameters** (`HyperbolicGearPairParams`): same layout as `CrossedGearPairParams` but uses throat radii for positioning.

* **Async**. Returns `Promise<Result<{ gear1?: BrepHandle, gear2?: BrepHandle }, string>>`.

* `fn.outputs`: `['gear1', 'gear2']`

## Planetary Gearset (returns assembly)

### `planetaryGearset(params, options?)`

Planetary gearset (sun + planets + ring).



* **Parameters** (`PlanetaryGearsetParams`):


  * `module`, `sun_teeth_number`, `planet_teeth_number`, `width`, `rim_width`, `n_planets`

  * `pressure_angle`, `helix_angle`, `clearance`, `backlash` — optional

* **Options** (`BuildPlanetaryGearsetOptions`): strategy, feature fields.

* **Async**. Returns `Promise<Result<{ sun?: BrepHandle, planets: BrepHandle[], ring?: BrepHandle }, string>>`.

* `fn.outputs`: `['sun', 'planets', 'ring']`

### `herringbonePlanetaryGearset(params, options?)`

Herringbone planetary gearset. Same params/outputs as `planetaryGearset`.



* **Async**. Returns `Promise<Result<{ sun?: BrepHandle, planets: BrepHandle[], ring?: BrepHandle }, string>>`.

* `fn.outputs`: `['sun', 'planets', 'ring']`

## Notes



* All functions return `Promise<Result<T>>`. In `.fai.js` scripts, `err` is unwrapped at the statement boundary → statement failure.

* **Parameter names follow the Python cq\_gears convention verbatim** — snake\_case, matching the original `cq_gears` Python class `__init__` signatures (e.g., `teeth_number`, not `teeth`; `module`, not `moduleSize`; `width`, not `thickness`).

* `BrepHandle` results are automatically adopted into faijs `Shape` at the library boundary.

* For multi-output functions (pairs, planetary), each named output becomes a separate product.

* **BREP only** — mesh mode throws `E_MESH_UNSUPPORTED`.



***

## Usage

In `.fai.js`:



```
import * as fast from '@faicad/faijs-fasteners'

let bolt = fast.isoThread({ diameter: 6, pitch: 1, length: 20 })
let nut = fast.hexNut({ size: 'M6' })
let assembled = cad.union(bolt, nut)
```

## Threads (5 types)

### `isoThread(params)`

ISO metric thread.



* **Parameters** (`IsoThreadParams`): `diameter`, `pitch`, `length` (all must use unit literals), `external` (bool), `hand` ('right'|'left'), `end_finishes` (\['raw'|'square'|'fade'|'chamfer']).

* **Async**. Returns `Result<BrepHandle>`.

* Also: `isoThreadDimensions(diameter, pitch)` → thread dimension data.

### `acmeThread(params)`

ACME thread.



* **Parameters**: `size` (string, e.g. '1/4-16'), `length`, `external`, `hand`, `end_finishes`.

* **Async**. Returns `Result<BrepHandle>`.

* Also: `acmeThreadSizes()`, `acmeThreadParseSize(size)`.

### `metricTrapezoidalThread(params)`

Metric trapezoidal thread.



* **Parameters**: `size` (string, e.g. 'Tr8x1.5'), `length`, `external`, `hand`, `end_finishes`.

* **Async**. Returns `Result<BrepHandle>`.

* Also: `metricTrapezoidalThreadSizes()`, `metricTrapezoidalThreadParseSize(size)`.

### `plasticBottleThread(params)`

Plastic bottle thread.



* **Parameters** (`PlasticBottleThreadParams`): `diameter`, `pitch`, `length`, `external`, `hand`.

* **Async**. Returns `Result<BrepHandle>`.

### `buildThread(params)`

Generic thread builder (base function for all thread types).



* **Async**. Returns `Result<BrepHandle>`.

## Nuts (7 types)

### `hexNut(params)`

Hex nut.



* **Parameters** (`NutParams`): `size` (e.g. 'M6'), `thread` ('coarse'|'fine'), `hand`.

* **Async**. Returns `Result<BrepHandle>`.

### `hexNutWithFlange(params)`

Hex nut with flange.



* **Async**. Returns `Result<BrepHandle>`.

### `unchamferedHexagonNut(params)`

Unchamfered hexagon nut.



* **Async**. Returns `Result<BrepHandle>`.

### `squareNut(params)`

Square nut.



* **Async**. Returns `Result<BrepHandle>`.

### `domedCapNut(params)`

Domed cap nut (acorn nut).



* **Async**. Returns `Result<BrepHandle>`.

### `bradTeeNut(params)`

Brad tee nut (T-nut).



* **Async**. Returns `Result<BrepHandle>`.

### `heatSetNut(params)`

Heat-set insert nut.



* **Async**. Returns `Result<BrepHandle>`.

### `buildNut(params)`

Generic nut builder.



* **Async**. Returns `Result<BrepHandle>`.

## Screws (12 types)

### `buildScrew(params)`

Generic screw builder. The `type` field selects among 12 screw head types.



* **Parameters** (`ScrewParams`): `size` (e.g. 'M6-1'), `length`, `thread` ('coarse'|'fine'), `head_type` (one of: `socket_head_cap`, `button_head`, `button_head_with_collar`, `hex_head`, `hex_head_with_flange`, `pan_head`, `pan_head_with_collar`, `cheese_head`, `raised_cheese_head`, `countersunk`, `raised_countersunk_oval`, `set_screw`), `hand`, `material`.

* **Async**. Returns `Result<BrepHandle>`.

### `screwProfilePoints(params)`

Returns the profile points for a screw head (diagnostic/inspection).



* **Sync**. Returns profile point data.

## Washers (3 types)

### `plainWasher(params)`

Plain washer.



* **Parameters** (`WasherParams`): `size` (e.g. 'M6').

* **Async**. Returns `Result<BrepHandle>`.

### `chamferedWasher(params)`

Chamfered washer.



* **Async**. Returns `Result<BrepHandle>`.

### `cheeseHeadWasher(params)`

Cheese head washer.



* **Async**. Returns `Result<BrepHandle>`.

## Bearings (5 types)

### `buildBearing(params)`

Bearing builder. The `type` field selects among 5 bearing types.



* **Parameters** (`BearingParams`): `type` (one of: `single_row_deep_groove_ball_bearing`, `single_row_capped_deep_groove_ball_bearing`, `single_row_cylindrical_roller_bearing`, `single_row_tapered_roller_bearing`, `single_row_angular_contact_ball_bearing`), `size` (bearing designation string).

* **Async**. Returns `Result<BrepHandle>`.

## Sprockets & Chain

### `buildSprocket(params)`

Roller chain sprocket.



* **Parameters** (`SprocketParams`): `teeth`, `pitch`, `roller_diameter`, `width`, `bore`.

* **Async**. Returns `Result<BrepHandle>`.

### `buildChain(params)`

Roller chain (2-sprocket assembly).



* **Parameters** (`ChainParams`): sprocket specs + chain parameters.

* **Async**. Returns `Result<{ parts: ChainPart[] }>`.

## Holes (function-based, for cutting into existing solids)

### `clearanceHole(params)`

Clearance hole cutter.



* **Parameters** (`ClearanceHoleParams`): `size`, `depth`, `counterbore_depth`, etc.

* **Returns** hole geometry for boolean subtraction.

### `tapHole(params)`

Tap hole (for internal threading).



* **Returns** hole geometry.

### `threadedHole(params)`

Threaded hole (with internal thread solid).



* **Returns** hole geometry + thread solid.

### `insertHole(params)`

Insert hole (for heat-set inserts).



* **Returns** hole geometry.

### `pressFitHole(params)`

Press-fit hole.



* **Returns** hole geometry.

### `fastenerHole(params)`

General fastener hole (combines above by type).



* **Returns** hole geometry.

### `internalThreadSolid(params)`

Internal thread as a solid (for boolean operations).



* **Returns** thread solid geometry.

## Parameter Table Queries

### `nutTypes()` / `nutSizes(type)`

Returns available nut types and sizes.

### `screwTypes()` / `screwSizes(type)`

Returns available screw types and sizes.

### `washerTypes()` / `washerSizes(type)`

Returns available washer types and sizes.

### `bearingTypes()` / `bearingSizes(type)`

Returns available bearing types and sizes.

### `clearanceHoleDiameters(size)` / `tapHoleDiameters(size)`

Returns clearance/tap hole diameter data for a given screw size.

### `selectBySize(size, table)`

Generic size selection helper.

## Measurement Parsing

### `metricStrToFloat(str)` / `imperialStrToFloat(str)`

Parse metric/imperial dimension strings to numbers.

### `evalArithmetic(str)` / `evaluateCell(str)`

Evaluate arithmetic expressions in parameter cells.

## Notes



* All build functions return `Promise<Result<T>>`. In `.fai.js` scripts, `err` is unwrapped at the statement boundary.

* Parameter names follow Python cq\_warehouse convention.

* `BrepHandle` results are automatically adopted into faijs `Shape` at the library boundary.

* **BREP only** — mesh mode throws `E_MESH_UNSUPPORTED`.