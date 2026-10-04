# @faicad/faijs-fasteners — Fastener Generation Library

> A third-party library for generating fastener geometry: threads, nuts, screws, washers, bearings, sprockets, chain, and hole series. Ported from cq_warehouse (upstream 0.8.0). Called from `.fai.js` scripts.

## Usage

In `.fai.js`:
```js
import * as fast from '@faicad/faijs-fasteners'

let bolt = fast.isoThread({ diameter: 6, pitch: 1, length: 20 })
let nut = fast.hexNut({ size: 'M6' })
let assembled = cad.union(bolt, nut)
```

## Threads (5 types)

### `isoThread(params)`
ISO metric thread.
- **Parameters** (`IsoThreadParams`): `diameter`, `pitch`, `length` (all must use unit literals), `external` (bool), `hand` ('right'|'left'), `end_finishes` (['raw'|'square'|'fade'|'chamfer']).
- **Async**. Returns `Result<BrepHandle>`.
- Also: `isoThreadDimensions(diameter, pitch)` → thread dimension data.

### `acmeThread(params)`
ACME thread.
- **Parameters**: `size` (string, e.g. '1/4-16'), `length`, `external`, `hand`, `end_finishes`.
- **Async**. Returns `Result<BrepHandle>`.
- Also: `acmeThreadSizes()`, `acmeThreadParseSize(size)`.

### `metricTrapezoidalThread(params)`
Metric trapezoidal thread.
- **Parameters**: `size` (string, e.g. 'Tr8x1.5'), `length`, `external`, `hand`, `end_finishes`.
- **Async**. Returns `Result<BrepHandle>`.
- Also: `metricTrapezoidalThreadSizes()`, `metricTrapezoidalThreadParseSize(size)`.

### `plasticBottleThread(params)`
Plastic bottle thread.
- **Parameters** (`PlasticBottleThreadParams`): `diameter`, `pitch`, `length`, `external`, `hand`.
- **Async**. Returns `Result<BrepHandle>`.

### `buildThread(params)`
Generic thread builder (base function for all thread types).
- **Async**. Returns `Result<BrepHandle>`.

## Nuts (7 types)

### `hexNut(params)`
Hex nut.
- **Parameters** (`NutParams`): `size` (e.g. 'M6'), `thread` ('coarse'|'fine'), `hand`.
- **Async**. Returns `Result<BrepHandle>`.

### `hexNutWithFlange(params)`
Hex nut with flange.
- **Async**. Returns `Result<BrepHandle>`.

### `unchamferedHexagonNut(params)`
Unchamfered hexagon nut.
- **Async**. Returns `Result<BrepHandle>`.

### `squareNut(params)`
Square nut.
- **Async**. Returns `Result<BrepHandle>`.

### `domedCapNut(params)`
Domed cap nut (acorn nut).
- **Async**. Returns `Result<BrepHandle>`.

### `bradTeeNut(params)`
Brad tee nut (T-nut).
- **Async**. Returns `Result<BrepHandle>`.

### `heatSetNut(params)`
Heat-set insert nut.
- **Async**. Returns `Result<BrepHandle>`.

### `buildNut(params)`
Generic nut builder.
- **Async**. Returns `Result<BrepHandle>`.

## Screws (12 types)

### `buildScrew(params)`
Generic screw builder. The `type` field selects among 12 screw head types.
- **Parameters** (`ScrewParams`): `size` (e.g. 'M6-1'), `length`, `thread` ('coarse'|'fine'), `head_type` (one of: `socket_head_cap`, `button_head`, `button_head_with_collar`, `hex_head`, `hex_head_with_flange`, `pan_head`, `pan_head_with_collar`, `cheese_head`, `raised_cheese_head`, `countersunk`, `raised_countersunk_oval`, `set_screw`), `hand`, `material`.
- **Async**. Returns `Result<BrepHandle>`.

### `screwProfilePoints(params)`
Returns the profile points for a screw head (diagnostic/inspection).
- **Sync**. Returns profile point data.

## Washers (3 types)

### `plainWasher(params)`
Plain washer.
- **Parameters** (`WasherParams`): `size` (e.g. 'M6').
- **Async**. Returns `Result<BrepHandle>`.

### `chamferedWasher(params)`
Chamfered washer.
- **Async**. Returns `Result<BrepHandle>`.

### `cheeseHeadWasher(params)`
Cheese head washer.
- **Async**. Returns `Result<BrepHandle>`.

## Bearings (5 types)

### `buildBearing(params)`
Bearing builder. The `type` field selects among 5 bearing types.
- **Parameters** (`BearingParams`): `type` (one of: `single_row_deep_groove_ball_bearing`, `single_row_capped_deep_groove_ball_bearing`, `single_row_cylindrical_roller_bearing`, `single_row_tapered_roller_bearing`, `single_row_angular_contact_ball_bearing`), `size` (bearing designation string).
- **Async**. Returns `Result<BrepHandle>`.

## Sprockets & Chain

### `buildSprocket(params)`
Roller chain sprocket.
- **Parameters** (`SprocketParams`): `teeth`, `pitch`, `roller_diameter`, `width`, `bore`.
- **Async**. Returns `Result<BrepHandle>`.

### `buildChain(params)`
Roller chain (2-sprocket assembly).
- **Parameters** (`ChainParams`): sprocket specs + chain parameters.
- **Async**. Returns `Result<{ parts: ChainPart[] }>`.

## Holes (function-based, for cutting into existing solids)

### `clearanceHole(params)`
Clearance hole cutter.
- **Parameters** (`ClearanceHoleParams`): `size`, `depth`, `counterbore_depth`, etc.
- **Returns** hole geometry for boolean subtraction.

### `tapHole(params)`
Tap hole (for internal threading).
- **Returns** hole geometry.

### `threadedHole(params)`
Threaded hole (with internal thread solid).
- **Returns** hole geometry + thread solid.

### `insertHole(params)`
Insert hole (for heat-set inserts).
- **Returns** hole geometry.

### `pressFitHole(params)`
Press-fit hole.
- **Returns** hole geometry.

### `fastenerHole(params)`
General fastener hole (combines above by type).
- **Returns** hole geometry.

### `internalThreadSolid(params)`
Internal thread as a solid (for boolean operations).
- **Returns** thread solid geometry.

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

- All build functions return `Promise<Result<T>>`. In `.fai.js` scripts, `err` is unwrapped at the statement boundary.
- Parameter names follow Python cq_warehouse convention.
- `BrepHandle` results are automatically adopted into faijs `Shape` at the library boundary.
- **BREP only** — mesh mode throws `E_MESH_UNSUPPORTED`.
