# @faicad/faijs-draw — 2D Drawing DSL

> Provides `cad.draw` — a fluent 2D drawing DSL for creating closed contours (Blueprints) that feed into core's placement pipeline (`cad.sketchOnPlane`, `cad.profile`). Merged into the `cad` namespace.

## `cad.draw(session)`

Opens a pen session, runs the caller's chained drawing calls, and produces a closed `Blueprint` (a placed contour). The `draw` object also carries primitive factories for declarative shape creation.

### Fluent Session Form

`cad.draw(session)` takes a callback that receives a `pen` (BaseSketcher2d). The pen supports chained segment calls:

```js
// Draw a 10x10 square
let bp = cad.draw((pen) => pen.hLineTo(10).vLineTo(10).hLineTo(0).close())
```

**Pen methods** (chained):
- `hLineTo(x)` — horizontal line to x
- `vLineTo(y)` — vertical line to y
- `lineTo(x, y)` — line to point
- `line(dx, dy)` — relative line
- `hLine(dx)` — relative horizontal
- `vLine(dy)` — relative vertical
- `polarLine(distance, angleDeg)` — polar line
- `polarLineTo(distance, angleDeg)` — polar line to absolute
- `close()` — close the contour
- `threePointArc(x1, y1, x2, y2)` — arc through 3 points
- `sagittaArc(x, y, sagitta)` — arc with sagitta
- `radiusArc(x, y, radius)` — arc with radius

### Factory Form

`cad.draw` also carries canned-shape factories that return `Blueprint` objects directly:

```js
// Rectangle
let bp = cad.draw.rectangle(10, 20)

// Rounded rectangle
let bp = cad.draw.roundedRectangle(10, 20, 2)

// Regular polygon
let bp = cad.draw.polygon(5, 10)  // 5 sides, radius 10

// Circle
let bp = cad.draw.circle(10)  // radius 10

// Ellipse
let bp = cad.draw.ellipse(10, 5)  // rx=10, ry=5
```

### Using the Result

The `Blueprint` produced by `cad.draw` can be passed directly to `cad.profile` or `cad.sketchOnPlane`:

```js
// Draw a contour and extrude it
let bp = cad.draw((pen) => pen.hLineTo(30).vLineTo(20).hLineTo(0).close())
let face = cad.profile({ contours: bp })
let solid = cad.extrude(face, 10 * MM)

// Or place on a plane directly
let bp2 = cad.draw.rectangle(30, 20)
let face2 = cad.sketchOnPlane({ contours: bp2, plane: 'XY' })
let solid2 = cad.extrude(face2, 5 * MM)
```
