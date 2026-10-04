# @faicad/faijs (core) — Platform `cad.*` Namespace

> The built-in `cad` namespace, always available in `.fai.js` scripts. No import needed — the host registers it via `createRuntime()`.

## Primitives (Creators, no input)

### `box(width, depth, height, opts?)`
Creates a rectangular box.
- **Parameters**: `width` (X), `depth` (Y), `height` (Z) — all required. Must use unit literals (e.g., `10 * MM`).
- **Options**: `centered` (bool, default false), `at` ([x,y,z] center), `segments` (tessellation, default 64).
- **Sync**. Returns `Shape`.
- **Example**: `let bracket = cad.box(10 * MM, 20 * MM, 30 * MM)`, `let bracket = cad.box(10 * MM, 20 * MM, 30 * MM, { centered: true })`

### `sphere(radius, opts?)`
Creates a sphere.
- **Parameters**: `radius` (required). Must use unit literals (e.g., `10 * MM`).
- **Options**: `segments` (default 64), `center`/`at` ([x,y,z], default [0,0,0]).
- **Sync**. Returns `Shape`.
- **Example**: `let ball = cad.sphere({ radius: 10 * MM })`, `let ball = cad.sphere(10 * MM, { at: [0, 0, 10 * MM] })`

### `cylinder(radius, height, opts?)`
Creates a cylinder. `at` is the **base center** (BASE semantics); `centered` shifts base to -h/2.
- **Parameters**: `radius`, `height` (along +Z) — both required. Must use unit literals (e.g., `5 * MM`, `40 * MM`).
- **Options**: `centered` (bool), `at` ([x,y,z] base center), `segments` (default 64).
- **Sync**. Returns `Shape`.
- **Example**: `let shaft = cad.cylinder(5 * MM, 40 * MM)`, `let shaft = cad.cylinder(5 * MM, 40 * MM, { centered: true })`

### `cone(radiusBottom, radiusTop, height, opts?)`
Creates a cone. `radiusTop=0` = pointed cone; `radiusTop=radiusBottom` = cylinder.
- **Parameters**: `radiusBottom`, `radiusTop`, `height` (+Z) — all required. Must use unit literals.
- **Options**: `centered`, `at` (base axis center), `segments` (default 64).
- **Sync**. Returns `Shape`.

### `wedge(opts)`
Creates a wedge.
- **Parameters** (object): `width`, `height`, `angle` (degrees), `length` — all required. Must use unit literals for dimensional values.
- **Sync**. Returns `Shape`.
- **Example**: `let w = cad.wedge({ width: 30 * MM, height: 20 * MM, angle: 45, length: 10 * MM })`

### `helix(opts)`
Creates a helix curve (1D).
- **Parameters** (object): `radius`, `pitch`, `turns` — all required. Must use unit literals for dimensional values.
- **Options**: `axis` (Vec3, default +Z), `origin` (Vec3, default origin).
- **Sync**. Returns `Shape` (kind: 'curve').
- **BREP only** (OCCT).
- **Example**: `let thread_path = cad.helix({ radius: 5 * MM, pitch: 2 * MM, turns: 3 })`

### `wire(points, opts?)`
Creates a 1D curve from a point list.
- **Parameters**: `points` (Vec3[], at least 2 points).
- **Options**: `closed` (bool), `smooth` (bool, B-spline through all points), `degree` (default 3).
- **Sync**. Returns `Shape` (kind: 'curve').

### `profile(opts)`
Constructs a planar face or wire from 2D contours.
- **Parameters** (object): `contours` (ProfileLoop[] | Blueprint | Blueprint[]), `as` ('face' default | 'wire').
- **Sync**. Returns `Shape` (face or 1D curve).
- **BREP only**.
- **Example**: `let face = cad.profile({ contours: [{ segments: [{ kind:'line', x1:0,y1:0,x2:10,y2:0 }, ...] }] })`

### `screw(opts)`
Generates a screw part (thread + head).
- **Parameters** (object): `system` ('metric'|'imperial'), `specIdx` (size index), `length` (must use unit literals), `thread` ('coarse'|'fine'|'custom'|'none', default 'coarse'), `head` ('hex'|'chc'|'none', default 'none'), `pitchCustom`, `nRad` (default 32).
- **Async**. Returns `Promise<Shape>`.

### `sdf(opts)`
Generates a mesh body from a signed distance field function (mesh-only).
- **Parameters** (object): `code` (SDF source string), `box` (sampling bounds, default [-10,-10,-10]..[10,10,10]), `resolution` (cell size, default 1.0), `params`.
- **Async**. Returns `Promise<Shape>`.
- **Mesh-only** — no BREP implementation. Dimensional values in `box` and `resolution` should use unit literals.

### `sketchOnPlane(opts)`
Places 2D contours on a plane to construct a Shape.
- **Parameters** (object): `contours`, `plane` (named: 'XY'/'XZ'/etc, or `{ origin, normal, xAxis }`), `as` ('face'|'wire').
- **Sync**. Returns `Shape`.

### `sketchOnFace(opts)`
Places 2D contours on a face of a solid.
- **Parameters** (object): `contours`, `on` (target Shape), `face` (1-based ordinal or `cad.faceRef`), `scaleMode`, `as`.
- **Sync**. Returns `Shape`.

### `punchHole(opts)`
Cuts a face-placed 2D profile out of a solid.
- **Parameters** (object): `contours`, `on` (Shape), `face`, `height` (blind depth, null=through), `draftAngle`, `scaleMode`.
- **Sync**. Returns `Shape`.

## Import Operations

### `import_brep(opts)`
Imports a frozen BREP asset from the container `assets/` directory.
- **Parameters** (object): `asset` (asset name, no extension).
- **Async**. Returns `Promise<Shape>`.

### `import_step(opts)`
Imports a STEP file from a local path.
- **Parameters** (object): `path` (absolute local path, resolved by host).
- **Async**. Returns `Promise<Shape>`.
- **BREP only**.

### `asset(key)`
Retrieves asset content as a UTF-8 string (for SVG/text assets).
- **Parameters**: `key` (string).
- **Async**. Returns `Promise<string>`.

## Boolean Operations

### `union(...shapes)`
Boolean union of all input shapes (>= 2).
- **Async**. Returns `Shape`.
- **Example**: `let merged = cad.union(base, top)`, `cad.union(a, b, c)`

### `subtract(...shapes)`
Boolean difference: first shape minus the rest.
- **Async**. Returns `Shape`.
- **Example**: `let drilled = cad.subtract(block, hole)`

### `intersect(...shapes)`
Boolean intersection of all inputs.
- **Async**. Returns `Shape`.

### `cut(base, tool)`
Boolean cut (subtract `tool` from `base`). Same as `subtract` but with brepjs-compatible signature.
- **Async**. Returns `Shape`.

## Feature Operations (input >= 1)

### `extrude(input, length | opts)`
Extrudes a face along a normal.
- **Length mode**: `length` (must use unit literals), `normal` (default [0,0,1]), `mode` ('forward'|'backward'), `offset`.
- **Up-to mode**: `upTo` (FaceTopoRef | 'last' | 'first'), `baseFeature` (support body for 'last'/'first').
- **Async**. Returns `Shape`.
- **Example**: `let wall = cad.extrude(face, 10 * MM)`, `let boss = cad.extrude(sk, { upTo: cad.faceRef(base, 3) })`

### `revolve(input, opts)`
Revolves a planar profile around an axis.
- **Parameters** (object): `axis` (Vec3), `at` (Vec3, axis point), `angle` (degrees, default 360). Must use unit literals for dimensional values.
- **Async**. Returns `Shape` (with roleTable: bottom/top/wall:i).

### `sweep(profile, spine, opts?)`
Sweeps a cross-section along a spine path.
- **Parameters**: `profile` (wire or face), `spine` (wire), `opts` (frenet/mode/tolerance).
- **Async**. Returns `Shape`.
- **BREP only** (OCCT).

### `loft(sections, opts?)`
Lofts through ordered cross-sections.
- **Parameters**: `sections` (Shape[], wire or face; >= 2), `opts` (ruled/startPoint/endPoint/tolerance).
- **Async**. Returns `Shape`.
- **BREP only** (OCCT).

### `fillet(input, opts)`
Fillets edges with a constant radius.
- **Parameters** (object): `edges` (EdgeTopoRef[]), `radius` (> 0, must use unit literals).
- **Async**. Returns `Shape`.
- **Example**: `let rounded = cad.fillet(block, { edges: [cad.edgeRef(block, 1)], radius: 2 * MM })`

### `filletVariable(input, edge, r1, r2)`
Variable-radius fillet on a single edge (linear from r1 to r2).
- **Parameters**: `edge` (EdgeTopoRef), `r1` (start radius), `r2` (end radius). Must use unit literals.
- **Async**. Returns `Shape`.
- **BREP only**.

### `chamfer(input, opts)`
Chamfers edges.
- **Parameters** (object): `edges` (EdgeTopoRef[]), `type` ('equal'|'twoDistances'|'distanceAngle'), `width` (for 'equal'), `width1`/`width2` (for 'twoDistances'), `angle` (for 'distanceAngle').
- **Async**. Returns `Shape`.

### `shell(input, opts)`
Shells a solid: removes specified faces and offsets remaining faces into a thin wall.
- **Parameters** (object): `openFaces` (FaceTopoRef[]), `thickness` (> 0, must use unit literals), `tolerance`.
- **Async**. Returns `Shape`.

### `draft(input, opts)`
Applies draft angle to selected faces (casting/injection mold taper).
- **Parameters** (object): `faces` (FaceTopoRef[]), `angleDeg` (degrees, use `* DEGREE`), `pull` (Vec3 draft direction, default +Z), `neutral` ({point} — only origin supported).
- **Async**. Returns `Shape`.
- **BREP only** (OCCT).

### `thicken(input, thickness)`
Thickens a face/shell into a solid.
- **Parameters**: `thickness` (!= 0, must use unit literals; positive = along normal, negative = reverse).
- **Async**. Returns `Shape`.
- **BREP only** (OCCT).

### `engrave(input, opts)`
Engraves text or SVG on a geometry surface.
- **Parameters** (object): `mode` ('concave'|'convex', default 'concave'), `depth` (must use unit literals), `text` (string) or `svg` (asset key), `textSize`, `svgSize`, `faceCenter` ([x,y,z]), `faceNormal` ([x,y,z]).
- **Async**. Returns `Shape`.

### `knurl(input, opts)`
Applies knurling texture (vertex displacement, mesh-only).
- **Parameters** (object): `knurlTextureHeight`, `knurlScaleU`, `knurlScaleV`, `knurlInvertDisplacement`, `knurlRefineLength`, `knurlMappingMode`, `faceCenter`, `faceNormal`.
- **Async**. Returns `Shape`.
- **Mesh-only** — no BREP implementation.

## Pattern / Replication Operations

### `linearPattern(input, direction, count, spacing)`
Linear array along a direction.
- **Parameters**: `direction` (Vec3), `count` (total including original), `spacing` (must use unit literals).
- **Async**. Returns `Shape`.

### `circularPattern(input, axis, count, opts?)`
Circular array around an axis.
- **Parameters**: `axis` (Vec3), `count`, `fullAngle` (degrees, default 360, use `* DEGREE`), `center` (Vec3, point on axis).
- **Async**. Returns `Shape`.

### `gridPattern(input, dirX, dirY, countX, countY, spacingX, spacingY)`
2D grid array.
- **Async**. Returns `Shape`.

### `rectangularPattern(input, opts)`
Rectangular array with explicit direction vectors.
- **Parameters** (object): `xDir`, `xCount`, `xSpacing`, `yDir`, `yCount`, `ySpacing`.
- **Async**. Returns `Shape`.

### `mirror(input, opts?)`
Returns a mirrored copy (source retained).
- **Parameters** (object): `normal` (Vec3, mirror plane normal), `at` (Vec3, point on plane).
- **Async**. Returns `Shape`.

### `mirrorJoin(input, opts?)`
Mirrors and fuses: original + mirrored copy fused into one.
- **Async**. Returns `Shape`.

### `clone(input)`
Deep-copies a shape handle (independent new object, source retained).
- **Async**. Returns `Shape`.

## Split / Section Operations

### `split(input, tools)`
Splits input by tool geometry, returns all pieces.
- **Parameters**: `tools` (Shape[]).
- **Async**. Returns `Shape` (compound of pieces).

### `splitByPlane(input, opts)`
Splits a solid by an infinite plane into two named halves.
- **Parameters** (object): `point` (Vec3), `normal` (Vec3).
- **Async**. Returns `{ positive, negative }`.

### `sectionByPlane(input, opts)`
Computes the exact section curve of a solid with an infinite plane.
- **Parameters** (object): `point` (Vec3), `normal` (Vec3).
- **Async**. Returns `Shape` (1D curve compound).

## Transform Operations

### `place(input, opts?)`
Rigid placement: rotate (quaternion, around local origin) then translate.
- **Parameters** (object): `rotation` ([x,y,z,w] quaternion), `position` ([x,y,z] translation, must use unit literals).
- **Sync**. Returns `Shape`.
- **Example**: `let positioned = cad.place(bracket, { rotation: [0,0,sin(π/4),cos(π/4)], position: [10 * MM, 0, 0] })`

## Feature Repair Operations

### `defeature(input, opts?)`
Simplifies geometry by removing small features.
- **Async**. Returns `Shape`.

### `reverseShape(input)`
Reverses the orientation of a shape.
- **Async**. Returns `Shape`.

### `unifySameDomain(input)`
Unifies faces on the same geometric domain.
- **Async**. Returns `Shape`.

### `sew(input)`
Sews faces into a shell.
- **Async**. Returns `Shape`.

### `sewAndSolidify(input)`
Sews faces and solidifies into a solid.
- **Async**. Returns `Shape`.

### `removeHolesFromFace(input, opts?)`
Removes holes from a specified face.
- **Async**. Returns `Shape`.

## Structure Operations

### `compound(opts)`
Creates a geometric compound (holds OCCT handles, can be transformed/exported).
- **Parameters** (object): `members` (Shape[]), `name` (optional string).
- **Sync**. Returns `Shape`.

## Assembly / Kinematics Operations

### `jointTrajectory(opts)`
Computes joint trajectories for a mechanism.
- **Async**. Returns trajectory data.

### `inverseKinematics(opts)`
Solves inverse kinematics for a mechanism.
- **Async**. Returns IK solution.

### `mechanismDOF(opts)`
Computes degrees of freedom for a mechanism.
- **Returns** DOF data.

## Query Operations

### `bboxCenter(shape)`
Returns the bounding box center.
- **Sync**. Returns `Vec3`.

### `bboxMin(shape)`
Returns the bounding box minimum corner.
- **Sync**. Returns `Vec3`.

### `bboxMax(shape)`
Returns the bounding box maximum corner.
- **Sync**. Returns `Vec3`.

### `faceNormal(shape, anchor?, ordinal?)`
Returns the face normal at an anchor point.
- **Sync**. Returns `Vec3`.

### `faceRef(shape, faceOrdinal)`
Returns a `FaceTopoRef` for the Nth face (1-based, matches FreeCAD `FaceN`).
- **Sync**. Returns `FaceTopoRef`.

### `edgeRef(shape, edgeOrdinal)`
Returns an `EdgeTopoRef` for the Nth edge (1-based, matches FreeCAD `EdgeN`).
- **Sync**. Returns `EdgeTopoRef`.

### `viewCamera(view)`
Resolves a view spec into a projection camera direction.
- **Parameters**: `view` (string: 'front'/'back'/'top'/'bottom'/'left'/'right'/'iso'/'XY'/etc, or `{ dir, xAxis? }`).
- **Sync**. Returns `{ direction, xAxis? }`.

### `projectView(shape, view, opts?)`
Projects a shape to a single-view SVG line drawing.
- **Parameters**: `shape`, `view` (spec), `strokeWidth`, `dash`, `hiddenOpacity`, `margin`, `width`, `height`.
- **Sync**. Returns SVG string.
- **BREP input required**.

### `projectSheet(shape, views, opts?)`
Projects a shape to a multi-view SVG sheet.
- **Parameters**: `shape`, `views` (array of view specs), `cols` (default 2), `gap` (default 30), `labels` (default true), `cellWidth`, `cellHeight`.
- **Sync**. Returns SVG string.
- **BREP input required**.
