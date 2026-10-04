# @faicad/faijs-sketch — Constraint-Based Sketch Op

> Provides `cad.sketch` — a constraint-based sketch op that solves 2D geometry with the planegcs solver and produces a face or wire. Merged into the `cad` namespace.

## `sketch(opts)`

Creates a constrained sketch, solves it, and produces a face or wire on a plane.

### Parameters (object)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `shapes` | `SketchShape[]` | one of shapes/geoms | — | Semantic primitive list: rectangle, circle, rounded rectangle, ellipse, regular polygon, slot, trapezoid + pen primitives (line, arc, spline, point) + `close`. Recommended for scripts. |
| `geoms` | `SketchGeom[]` | one of shapes/geoms | — | Expanded canonical geometry (existing script form). |
| `constraints` | `SketchConstraint[]` | no | — | Dimensional and geometric constraints. A constraint-free sketch is equivalent to `cad.profile`. |
| `as` | `'face' \| 'wire'` | no | `'face'` | Product form. `'wire'` produces an outer wire (for sweep spines). |
| `plane` | `string \| { origin, normal, xAxis? }` | no | `'XY'` | Named plane (`'XY'`, `'XZ'`, `'YZ'`) or explicit plane frame. Places the solved contours on an arbitrary plane in one step. |

### Returns

**Async**. `Promise<Shape>` — a face or wire on the specified plane.

### Shape Primitives (for `shapes` parameter)

The `shapes` array entries can be:
- **Rectangle**: `{ kind: 'rect', x, y, w, h, tag? }`
- **Circle**: `{ kind: 'circle', x, y, r, tag? }`
- **Rounded rectangle**: `{ kind: 'roundedRect', x, y, w, h, r, tag? }`
- **Ellipse**: `{ kind: 'ellipse', x, y, rx, ry, tag? }`
- **Regular polygon**: `{ kind: 'polygon', x, y, r, n, tag? }`
- **Slot**: `{ kind: 'slot', x1, y1, x2, y2, r, tag? }`
- **Trapezoid**: `{ kind: 'trapezoid', ... }`
- **Pen primitives**: `{ kind: 'line', x1, y1, x2, y2 }`, `{ kind: 'arc', ... }`, `{ kind: 'spline', ... }`, `{ kind: 'point', x, y }`
- **Close**: `{ kind: 'close' }` — closes the current pen contour

### Constraint Types

Constraints are passed as the `constraints` array. Common types include:
- Distance, angle, coincidence, concentricity, parallelism, perpendicularity
- Fixed (structural), horizontal, vertical
- Equal length/radius, symmetry, point-on-line/arc

### Example

```js
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

- **Exactly one** of `shapes` / `geoms` must be provided (not both).
- Non-`solved` outcomes (under-constrained, redundant, conflicting) still produce geometry.
- The produced face/wire can be consumed by `cad.extrude`, `cad.sweep`, `cad.revolve`, etc.
