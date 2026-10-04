# @faicad/faijs-cadquery — CadQuery API Compatibility Layer

> A third-party library providing CadQuery 2.8.0 API compatibility for faijs. Implements Workplane, Sketch, Shape class model, object selectors, and assembly solver. Registered via `registerLib` and called from `.fai.js` scripts.

## How to Make This Available

The host registers the library:
```ts
import * as cqPkg from '@faicad/faijs-cadquery'

rt.registerLib('cq', {
  Workplane: cqPkg.Workplane,
  box: cqPkg.box,
  circle: cqPkg.circle,
  extrude: cqPkg.extrude,
  // ... select the functions you want to expose
}, { autoLift: false, packageName: '@faicad/faijs-cadquery' })
```

In `.fai.js`:
```js
import * as cq from '@faicad/faijs-cadquery'

let wp = cq.Workplane('XY')
let wp1 = cq.box(wp, 100, 80, 10)
let wp2 = cq.faces(wp1, '>Z')
let wp3 = cq.workplane(wp2)
let result = cq.hole(wp3, 5)
let body = cq.val(result)
```

All methods are standalone functions taking Workplane as first argument (transpiler converts method chains to this form).

## Workplane Operations

### Construction & Primitives
- `Workplane(plane)` — create a workplane on a named plane ('XY', 'XZ', 'YZ', etc.)
- `box(wp, w, d, h, opts?)` — box primitive
- `sphere(wp, r, opts?)` — sphere primitive
- `cylinder(wp, r, h, opts?)` — cylinder primitive
- `cone(wp, r1, r2, h, opts?)` — cone primitive
- `wedge(wp, opts)` — wedge primitive
- `torus(wp, r1, r2, opts?)` — torus primitive
- `rect(wp, w, h, opts?)` — rectangle 2D
- `circle(wp, r)` — circle 2D
- `ellipse(wp, r1, r2)` — ellipse 2D
- `polygon(wp, n, r)` — regular polygon 2D
- `rarray(wp, xSp, ySp, xC, yC)` — rectangular array of points
- `polarArray(wp, r, a0, aA, n)` — polar array of points

### Sketching (2D drawing on workplane)
- `moveTo(wp, x, y)` / `move2D(wp, x, y)` — move pen
- `lineTo(wp, x, y)` / `line(wp, dx, dy)` — line
- `vLine(wp, dy)` / `hLine(wp, dx)` — vertical/horizontal line
- `vLineTo(wp, y)` / `hLineTo(wp, x)` — absolute vertical/horizontal
- `polyline(wp, pts)` — polyline
- `close(wp)` — close contour
- `wire(wp)` — create wire
- `face(wp, ...)` — create face
- `vertex(wp, x, y, z)` — create vertex
- `threePointArc(wp, p1, p2)` — arc through 3 points
- `sagittaArc(wp, p, s)` — arc with sagitta
- `radiusArc(wp, p, r)` — arc with radius
- `tangentArcPoint(wp, ...)` — tangent arc
- `spline(wp, pts, opts?)` — spline curve
- `bezier(wp, pts, opts?)` — bezier curve
- `polarLine(wp, r, a)` / `polarLineTo(wp, r, a)` — polar line
- `slot2D(wp, l, w, opts?)` — slot 2D
- `center(wp, x, y)` — set local center
- `pushPoints(wp, pts)` — push points

### 3D Feature Operations
- `extrude(wp, amount)` — extrude 2D contour
- `revolve(wp, opts?)` — revolve around axis
- `loft(wp, opts?)` — loft through sections
- `sweep(wp, path, opts?)` — sweep along path
- `twistExtrude(wp, amount, twistDegrees, opts?)` — twist extrude
- `cutBlind(wp, amount)` — blind pocket/hole
- `cutThruAll(wp)` — through-all cut
- `hole(wp, d, opts?)` — simple hole
- `cboreHole(wp, d, cbore, depth, opts?)` — counterbore hole
- `cskHole(wp, d, csk, depth, opts?)` — countersink hole
- `threadedHole(wp, d, depth, opts?)` — threaded hole
- `shell(wp, t)` — shell solid
- `fillet(wp, r)` — fillet selected edges
- `chamfer(wp, d)` — chamfer selected edges
- `offset2D(wp, d, opts?)` — offset 2D contour
- `solidFromFaces(wp, ...)` — solid from faces
- `splineFace(wp, ...)` — spline surface face
- `splitFace(wp, ...)` — split a face
- `helix(wp, ...)` — helix wire
- `text(wp, txt, size, opts?)` — 3D text
- `clean(wp)` — clean/simplify geometry
- `combine(wp, opts?)` — combine solids

### Boolean Operations
- `union(wp, other, opts?)` — boolean union
- `cut(wp, other, opts?)` — boolean cut
- `intersect(wp, other, opts?)` — boolean intersect
- `add(wp, other)` — add to stack
- `compound(wp, ...)` — create compound

### Selection / Stack
- `faces(wp, sel?)` — select faces
- `edges(wp, sel?)` — select edges
- `vertices(wp, sel?)` — select vertices
- `solids(wp, sel?)` — select solids
- `wires(wp)` — select wires
- `shells(wp)` — select shells
- `compounds(wp)` — select compounds
- `workplane(wp, plane?)` — set/offset workplane
- `workplaneFromTagged(wp, tag)` — workplane from tagged
- `center(wp, x, y)` — center workplane
- `copyWorkplane(wp, other)` — copy workplane

### Movement / Transform
- `translate(wp, vec)` — translate
- `rotate(wp, axis, angle)` — rotate
- `rotateAboutCenter(wp, axis, angle)` — rotate about center
- `mirror(wp, plane, opts?)` — mirror
- `mirrorX(wp)` / `mirrorY(wp)` — mirror about axis
- `moved(wp, loc)` — moved by location
- `move(wp, loc)` — move by location

### Stack Operations
- `val(wp)` — first item on stack
- `vals(wp)` — all items on stack
- `all(wp)` — all items (alias)
- `first(wp)` — first item
- `last(wp)` — last item
- `item(wp, i)` — nth item
- `findSolid(wp)` — find solid on stack
- `size(wp)` — stack size
- `sort(wp, opts)` — sort stack
- `stackFilter(wp, fn)` — filter stack
- `stackMap(wp, fn)` — map stack
- `stackApply(wp, fn)` — apply to stack
- `sortStack(wp, opts)` — sort stack
- `bboxSize(wp)` — bounding box size
- `transformed(wp, opts?)` — transformed coordinates
- `setColor(wp, color)` — set color
- `tag(wp, name)` — tag current workplane
- `siblings(wp)` — sibling items
- `consolidateWires(wp)` — consolidate wires
- `eachpoint(wp, fn)` — apply at each point
- `placeSketch(wp, ...)` — place sketches
- `sketchFinish(wp)` — finish sketch
- `sketch(wp, ...)` — CadQuery Sketch integration
- `planarCap(wp, ...)` — planar cap
- `split(wp, ...)` / `section(wp, ...)` — split/section

### Location
- `Location(...)` — create location
- `isLocation(x)` — type check
- `composeLocations(...)` — compose locations
- `faceCompound(wp, ...)` / `edgeCompound(wp, ...)` — compound from selection

## Sketch (CadQuery Sketch.py parity)

Available with `sketch` prefix to avoid clashing with Workplane ops:
- `sketchCreate()` — create sketch
- `sketchRect(s, w, h)` / `sketchCircle(s, r)` / `sketchEllipse(s, r1, r2)`
- `sketchPolygon(s, n, r)` / `sketchRegularPolygon(s, n, r)` / `sketchSlot(s, ...)`
- `sketchTrapezoid(s, ...)` / `sketchEdge(s, ...)` / `sketchFace(s, ...)`
- `sketchSegment(s, ...)` / `sketchArc(s, ...)` / `sketchSpline(s, ...)`
- `sketchBezier(s, ...)` / `sketchClose(s)` / `sketchAssemble(s, ...)`
- `sketchAdd(s, ...)` / `sketchSubtract(s, ...)` — boolean on sketch
- `sketchRarray(s, ...)` / `sketchParray(s, ...)` / `sketchDistribute(s, ...)`
- `sketchMoved(s, ...)` / `sketchLocated(s, ...)` / `sketchCopy(s)`
- `sketchDelete(s, ...)` / `sketchReplace(s, ...)`
- `sketchFillet(s, ...)` / `sketchChamfer(s, ...)` / `sketchClean(s)`
- `sketchHull(s)` / `sketchHullFromPoints(s, ...)`
- `sketchConstrain(s, ...)` / `sketchSolve(s)` / `sketchFinalize(s)`
- `sketchFaces(s, ...)` / `sketchWires(s, ...)` / `sketchEdges(s, ...)` / `sketchVertices(s, ...)`
- `sketchReset(s)` / `sketchVal(s)` / `sketchVals(s)` / `sketchTag(s, ...)`
- `sketchSelect(s, ...)` / `sketchArea(s)` / `sketchFaceCount(s)` / `sketchExtrude(s, ...)`
- `sketchDispose(s)` / `sketchPush(s, ...)`

## Shape Class Model (CadQuery Shape.py parity)

- `wrapShape(handle)` — wrap a BrepHandle into a CqShape
- `borrowShape(handle)` — borrow a handle
- `unwrapShape(shape)` — unwrap to raw handle
- `disposeShape(shape)` — dispose handle
- `makeCompound(shapes)` — make compound
- `facesOf(shape)` / `wiresOf(shape)` — sub-shape extraction
- `faceMakePlane(w, h, dir?)` — make planar face
- `faceMakeSplineApprox(pts, ...)` — make spline-approximated face
- `boundingBoxOf(shape)` / `volumeOf(shape)` / `areaOf(shape)` / `lengthOf(shape)`
- `centerOfMassOf(shape)` / `centerOf(shape)` / `radiusOf(shape)`
- `shapeTypeOf(shape)` / `isValidShape(shape)` / `geomTypeOf(shape)`

## Object Selectors (CadQuery selectors.py parity)

- `TypeSelector(typeString)` — select by type
- `DirectionSelector(dir)` — select by direction
- `NearestToPointSelector(point)` — select nearest to point
- `StringSyntaxSelector(s)` — parse string selector syntax
- `NthSelector(n)` — nth item
- `CenterNthSelector(n, dir)` — nth by center
- `LengthNthSelector(n)` — nth by length
- `AreaNthSelector(n)` — nth by area
- `RadiusNthSelector(n)` — nth by radius
- `BoxSelector(box)` — select inside box
- `NearestToShapeSelector(shape)` — nearest to shape
- `AndSelector(a, b)` / `SumSelector(a, b)` / `SubtractSelector(a, b)` / `InverseSelector(a)`

## Plane Transforms (CadQuery Plane.py parity)

- `toLocalCoords(plane, shape)` — transform to local coordinates
- `toWorldCoords(plane, vec)` — transform to world coordinates
- `mirrorInPlane(plane, shape, axis)` — mirror in plane
- `toLocalCoordsVec(plane, vec)` — transform vector to local
- `mirrorInPlaneVec(plane, vec, axis)` — mirror vector in plane

## Assembly (via `@faicad/faijs-cadquery/assembly` subpath)

```js
import * as asm from '@faicad/faijs-cadquery/assembly'
```

- `constraintEx(nameA, tagA, shapeA, nameB, tagB, shapeB, kind)` — create assembly constraint
- `constraint(...)` — create constraint
- `buildAssembly(name, members, constraints)` — build assembly
- `faceRef(...)` / `pointRef(...)` / `axisRef(...)` — reference helpers
- `Color(r, g, b)` — color for assembly members
- Assembly object methods: `.solve()` → solved assembly, `.toCompound()` → compound shape
- `save(assembly, path)` — save assembly to STEP (Node only)
- `importStep(path)` — import STEP file
- `load(path)` — load assembly

## Notes

- This library uses `autoLift: false` (declared in `package.json` `faijs.autoLift`). All functions already carry dual-op metadata.
- All Workplane methods return a new Workplane (immutable updates). In `.fai.js` scripts, async operations are handled at the statement boundary — no explicit `await` is needed in the script.
- The Workplane carrier hides geometry in a `.shape` slot — use `cq.val(wp)` to extract.
- **BREP only** — mesh mode throws `E_MESH_UNSUPPORTED`.
- The transpiler converts CadQuery-style method chains (`wp.box(10).extrude(5)`) to standalone function calls (`box(wp, 10)` → `extrude(wp2, 5)`).
