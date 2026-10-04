# @faicad/sheetmetal — Sheet-Metal CAD Domain

> A third-party library for sheet-metal authoring, unfolding, flat pattern generation, bend relief, cutouts, nesting, and DXF export. Registered via `registerLib` and called from `.fai.js` scripts with the host-assigned binding name.

## How to Make This Available

The host registers the library:
```ts
import * as sheetPkg from '@faicad/sheetmetal'

rt.registerLib('sheet', {
  author: sheetPkg.author,
  hem: sheetPkg.hem,
  solidOf: sheetPkg.solidOf,
  unfold: sheetPkg.unfold,
  report: sheetPkg.report,
  // ... select the functions you want to expose
}, { autoLift: true, borrow: false, packageName: '@faicad/sheetmetal' })
```

In `.fai.js`:
```js
import * as sheet from '@faicad/sheetmetal'

let base_panel = sheet.author({ thickness: 2, base: { length: 100, width: 60 }, flanges: [] })
let solid = sheet.solidOf(base_panel)
```

> **Note**: The import specifier (`'@faicad/sheetmetal'`) must match the `packageName` declared in `registerLib`. The binding name (`sheet`) must match the `registerLib` key. The host may use a custom specifier (e.g., `'sheet-lib'`) as long as it matches the declared `packageName`.

## Authoring (Folded Part Construction)

### `author(spec)`
Authors a straight-bend part: a base flat plus folded-up flanges.
- **Parameters** (`AuthorSpec`): `{ thickness, base: { length, width }, flanges: [...], seams?: [...], material? }`
- **FlangeSpec**: `{ id, length, angleDeg, side ('xmin'|'xmax'|'ymin'|'ymax'), rule: { innerRadius, kFactor } }`
- **SeamSpec**: `{ parent, child, angleDeg, rule }`
- **MaterialSpec**: `{ name, thickness, defaultRule: { innerRadius, kFactor } }`
- **Async**. Returns `Result<SheetMetalPart>`.
- **Example**: `let bracket = sheet.author({ thickness: 2, base: { length: 100, width: 60 }, flanges: [{ id: 'f1', length: 40, angleDeg: 90, side: 'xmax', rule: { innerRadius: 2, kFactor: 0.44 } }] })`

### `solidOf(part)`
Extracts the 3D solid from an authored part. Needed because `.fai.js` statements cannot read nested member expressions (`p.solid`).
- **Sync**. Returns `Result<Solid>`.

### `fold(input)`
Folds a flat pattern (region-tree) up into a 3D part — the inverse of unfold.
- **Async**. Returns `Result<SheetMetalPart>`.

### `unfold(part)`
Flattens an authored part into a developed flat pattern + bend report + warnings.
- **Sync**. Returns `Result<UnfoldResult>` (contains `pattern`, `report`, `warnings`).

### `unfoldSolid(solid, opts?)`
Unfolds an imported sheet-metal solid (no feature tree) by detecting geometry numerically.
- **Parameters**: `solid` (B-rep solid), `opts.kFactor` (default 0.5, mid-surface).
- **Sync**. Returns `Result<UnfoldResult>`.

## Flange Features

### `contourFlange(part, spec)`
Authors a contour flange: open line/arc profile swept along a base edge into a multi-bend cross-section.
- **Async**. Returns `Result<SheetMetalPart>`.

### `loftedFlange(part, spec)`
Authors a lofted/ruled transition flange between two parallel open profiles.
- **Async**. Returns `Result<SheetMetalPart>`.

### `hem(part, spec)`
Folds a region edge back ~180°+ onto its parent (closed/open/teardrop/rolled hem).
- **Parameters** (`HemSpec`): `{ region, side, type, length, radius, rule }`
- **Async**. Returns `Result<SheetMetalPart>`.

### `jog(part, spec)`
Steps a region's flat by `offsetHeight` with two opposite bends (joggle).
- **Parameters** (`JogSpec`): bend line, offset height, radii.
- **Async**. Returns `Result<SheetMetalPart>`.

## Cutout / Hole Features

### `addCutout(part, spec)`
Punches a cutout (hole/slot/polygon) through a named flat region.
- **Parameters** (`CutoutSpec`): `{ kind, region, ...geometry }`
- **Async**. Returns `Result<SheetMetalPart>`.

### `addHole(part, region, x, y, diameter)`
Punches a circular hole centered at region-local (x, y).
- **Async**. Returns `Result<SheetMetalPart>`.

### `addSlot(part, region, opts)`
Punches a slot (rectangular or obround) at region-local (x, y).
- **Parameters** (`opts`): `{ x, y, length, width, angleDeg?, round? }`
- **Async**. Returns `Result<SheetMetalPart>`.

### `addPolygonCutout(part, region, points)`
Punches an arbitrary polygon cutout from region-local points.
- **Async**. Returns `Result<SheetMetalPart>`.

### `addTab(part, spec)`
Fuses a rectangular tab (additive protrusion) onto a region's edge.
- **Async**. Returns `Result<SheetMetalPart>`.

### `tabAndSlot(part, tab, slot)`
Self-fixturing tab-and-slot joint: tab on one region + matching slot on another.
- **Async**. Returns `Result<SheetMetalPart>`.

## Form Features

### `louver(part, opts)`
Forms a louver (vent flap) on a region.
- **Parameters**: `{ region, x, y, length, width, height, direction? }`
- **Async**. Returns `Result<SheetMetalPart>`.

### `emboss(part, opts)`
Forms a round emboss (raised) or dimple (recessed) on a region.
- **Parameters**: `{ region, x, y, diameter, height, kind: 'dimple'|'emboss' }`
- **Async**. Returns `Result<SheetMetalPart>`.

## Miter & Relief

### `miter(part, plane)`
Cuts a part by an oriented plane, removing material on the +normal side.
- **Parameters** (`MiterPlane`): `{ point, normal }`
- **Async**. Returns `Result<SheetMetalPart>`.

### `miterCorner(part, flangeIdA, flangeIdB, gap?)`
Auto-miters the shared corner of two flanges.
- **Async**. Returns `Result<SheetMetalPart>`.

### `bendRelief(part, flangeId, spec?)`
Adds bend relief at each mid-edge end of a partial flange's bend line.
- **Async**. Returns `Result<SheetMetalPart>`.

### `autoReliefs(part, spec?)`
Adds bend relief to every partial-span bend.
- **Async**. Returns `Result<SheetMetalPart>`.

### `relieveCorner(part, flangeIdA, flangeIdB, spec?)`
Cuts a corner relief notch at the shared corner of two adjacent flanges.
- **Async**. Returns `Result<SheetMetalPart>`.

## Reporting & Validation

### `report(part)`
Builds a bend report by walking the part's feature tree.
- **Sync**. Returns `Result<BendReport>`.

### `reportFrom(result)`
Projects the bend report already computed by `unfold`.
- **Sync**. Returns `Result<BendReport>`.

### `reportJSON(report)`
Serializes a bend report to stable pretty-printed JSON.
- **Sync**. Returns `string`.

### `validate(part)`
Manufacturability checks — advisory warnings, never errors.
- **Sync**. Returns `SheetMetalWarning[]` (empty = manufacturable).

## Bend Allowance

### `allowance(angleDeg, thickness, rule, onWarning?)`
Computes bend allowance: `BA = (π/180)·|angle|·(R + K·T)`.
- **Sync**. Returns `Result<number>`.

### `develop(angleDeg, thickness, rule, onWarning?)`
Neutral-axis developed length of a bend region.
- **Sync**. Returns `Result<number>`.

### `resolveAllowance(rule, angleDeg, thickness, onWarning?)`
Resolves a bend's developed allowance through the single resolution point (bend table → explicit allowance → K-factor formula).
- **Sync**. Returns `Result<number>`.

### `addBendTable(table)`
Registers (or replaces) a shop bend table.
- **Sync**. Returns `Result<BendTable>`.

### `bendTable(id)`
Looks up a registered bend table by id.
- **Sync**. Returns `BendTable | undefined`.

## Nesting & DXF Export

### `nest(patterns, options)`
Nests developed flat patterns onto stock sheets.
- **Parameters** (`NestOptions`): `{ strategy: 'bbox'|'nfp', sheetWidth, sheetHeight, spacing }`
- **Sync**. Returns `Result<NestResult>`.

### `nestToDXF(result, patterns, sheetIndex, options?)`
Emits one fabrication-ready DXF for a single nested sheet.
- **Sync**. Returns `Result<string>`.

### `toDXF(pattern, options?)`
Emits an annotated multi-layer DXF string for a flat pattern.
- **Parameters** (`DxfOptions`): layers, precision, units.
- **Sync**. Returns `Result<string>`.

## Fluent Facade (TS API)

For TS-side usage (not `.fai.js` script ops), a fluent builder is available:
```ts
import { sheetMetal, fromSolid } from '@faicad/sheetmetal'

// Author + operate + unfold in a chain
const result = await sheetMetal({ length: 100, width: 60 }, 2)
  .flange({ id: 'f1', length: 40, angleDeg: 90, side: 'xmax', rule: { innerRadius: 2, kFactor: 0.44 } })
  .hole('base', 15, 15, 4)
  .unfold()

// Unfold a foreign solid
const flat = fromSolid(importedSolid).kFactor(0.44).unfold()
```
