# @faicad/faijs-gears — Gear Generation Library

> A third-party library for generating gear geometry: spur, herringbone, ring, bevel, worm, rack, and planetary gearsets. Ported from CadQuery's cq_gears. Called from `.fai.js` scripts.

## Usage

In `.fai.js`:
```js
import * as gears from '@faicad/faijs-gears'

let drive_gear = gears.spurGear({ module: 2, teeth_number: 24, width: 8 })
let pinion = gears.spurGear({ module: 2, teeth_number: 12, width: 8 })
let pinion_offset = cad.translate(pinion, { offset: [36, 0, 0] })
let gear_assembly = cad.union(drive_gear, pinion_offset)
```

> **Parameter names follow the Python cq_gears convention verbatim** (e.g., `module`, `teeth_number`, `width`, `pressure_angle`, `helix_angle`). Do not use camelCase variants — the library expects snake_case parameter names matching the Python source.

## Single Gears (return `Result<BrepHandle>`)

### `spurGear(params, options?)`
Spur gear (straight-tooth cylindrical gear).
- **Parameters** (`SpurGearParams`):
  - `module` (number) — gear module m (pitch diameter / teeth count)
  - `teeth_number` (number) — number of teeth
  - `width` (number) — face width (along the gear axis)
  - `pressure_angle` (number, optional, default 20) — pressure angle in degrees
  - `helix_angle` (number, optional, default 0) — helix angle in degrees (0 = spur)
  - `clearance` (number, optional, default 0)
  - `backlash` (number, optional, default 0)
  - `addendum_coeff` (number | null, optional) — addendum coefficient (default 1.0)
  - `dedendum_coeff` (number | null, optional) — dedendum coefficient (default 1.25)
- **Options** (`BuildSpurGearOptions`): tooth surface strategy, feature fields.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `herringboneGear(params, options?)`
Herringbone gear (V-tooth cylindrical gear). Same params as `spurGear`.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `ringGear(params, options?)`
Ring gear (internal-tooth annular gear).
- **Parameters** (`RingGearParams`):
  - `module`, `teeth_number`, `width` — same as `spurGear`
  - `rim_width` (number) — rim width (outer ring thickness)
  - `pressure_angle`, `helix_angle`, `clearance`, `backlash` — optional, same as `spurGear`
- **Options** (`BuildRingGearOptions`): tooth surface strategy, feature fields.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `herringboneRingGear(params, options?)`
Herringbone ring gear. Same params as `ringGear`.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `crossedHelicalGear(params, options?)`
Crossed-axis helical gear (single gear).
- **Parameters** (`CrossedHelicalGearParams`): `module`, `teeth_number`, `width`, `pressure_angle`, `helix_angle`, `clearance`, `backlash`.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `hyperbolicGear(params, options?)`
Hyperbolic gear (single gear).
- **Parameters** (`HyperbolicGearParams`): `module`, `teeth_number`, `width`, `twist_angle` (throat twist angle in degrees), `pressure_angle`, `clearance`, `backlash`.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `bevelGear(params, options?)`
Bevel gear (spherical involute, single gear).
- **Parameters** (`BevelGearParams`):
  - `module`, `teeth_number` — same as `spurGear`
  - `cone_angle` (number) — pitch cone angle in degrees
  - `face_width` (number) — face width along the cone generatrix
  - `pressure_angle`, `helix_angle`, `clearance`, `backlash` — optional
- **Options** (`BuildBevelGearOptions`): tooth surface strategy, `boreD`, `trim`.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `rackGear(params, options?)`
Rack gear (straight-tooth linear rack).
- **Parameters** (`RackGearParams`): `module`, `length`, `width`, `height`, `pressure_angle`, `helix_angle`, `clearance`, `backlash`.
- **Options** (`BuildRackGearOptions`): tooth surface strategy.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `herringboneRackGear(params, options?)`
Herringbone rack gear. Same params as `rackGear` (internally forces `herringbone: true`).
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

### `worm(params, options?)`
Worm gear (cylindrical worm).
- **Parameters** (`WormParams`):
  - `module` (number) — gear module
  - `lead_angle` (number) — lead angle in degrees
  - `n_threads` (number) — number of threads/starts
  - `length` (number) — worm length (axial, along X)
  - `pressure_angle`, `clearance`, `backlash` — optional
- **Options** (`BuildWormOptions`): strategy (default grid-approx), sew/group tolerance, `boreD`.
- **Async**. Returns `Promise<Result<BrepHandle, string>>`.

## Gear Pairs (return named records)

### `bevelGearPair(params, options?)`
Bevel gear pair (assembly). Pinion is pre-positioned unless `transformPinion: false`.
- **Parameters** (`BevelGearPairParams`):
  - `module`, `gear_teeth`, `pinion_teeth`, `face_width`
  - `axis_angle` (number, optional, default 90) — shaft angle in degrees
  - `pressure_angle`, `helix_angle`, `clearance`, `backlash` — optional
- **Options** (`BuildBevelGearPairOptions`): strategy, `boreD`, `trim`, `transformPinion`, `buildGear`, `buildPinion`.
- **Async**. Returns `Promise<Result<{ gear?: BrepHandle, pinion?: BrepHandle }, string>>`.
- **`fn.outputs`**: `['gear', 'pinion']`

### `crossedGearPair(params, options?)`
Crossed-axis helical gear pair (assembly). Gear2 is positioned by shaft angle.
- **Parameters** (`CrossedGearPairParams`):
  - `module`, `gear1_teeth_number`, `gear2_teeth_number`, `gear1_width`, `gear2_width`
  - `shaft_angle` (number, optional) — shaft angle in degrees
  - `gear1_helix_angle` (number | null, optional) — gear1 helix angle; null = each gear takes `shaft_angle/2`
  - `pressure_angle`, `clearance`, `backlash` — optional
- **Options** (`BuildCrossedGearPairOptions`): `buildGear1`, `buildGear2`, `transformGear2`, strategy.
- **Async**. Returns `Promise<Result<{ gear1?: BrepHandle, gear2?: BrepHandle }, string>>`.
- **`fn.outputs`**: `['gear1', 'gear2']`

### `hyperbolicGearPair(params, options?)`
Hyperbolic gear pair (assembly). Same output shape as `crossedGearPair`.
- **Parameters** (`HyperbolicGearPairParams`): same layout as `CrossedGearPairParams` but uses throat radii for positioning.
- **Async**. Returns `Promise<Result<{ gear1?: BrepHandle, gear2?: BrepHandle }, string>>`.
- **`fn.outputs`**: `['gear1', 'gear2']`

## Planetary Gearset (returns assembly)

### `planetaryGearset(params, options?)`
Planetary gearset (sun + planets + ring).
- **Parameters** (`PlanetaryGearsetParams`):
  - `module`, `sun_teeth_number`, `planet_teeth_number`, `width`, `rim_width`, `n_planets`
  - `pressure_angle`, `helix_angle`, `clearance`, `backlash` — optional
- **Options** (`BuildPlanetaryGearsetOptions`): strategy, feature fields.
- **Async**. Returns `Promise<Result<{ sun?: BrepHandle, planets: BrepHandle[], ring?: BrepHandle }, string>>`.
- **`fn.outputs`**: `['sun', 'planets', 'ring']`

### `herringbonePlanetaryGearset(params, options?)`
Herringbone planetary gearset. Same params/outputs as `planetaryGearset`.
- **Async**. Returns `Promise<Result<{ sun?: BrepHandle, planets: BrepHandle[], ring?: BrepHandle }, string>>`.
- **`fn.outputs`**: `['sun', 'planets', 'ring']`

## Notes

- All functions return `Promise<Result<T>>`. In `.fai.js` scripts, `err` is unwrapped at the statement boundary → statement failure.
- **Parameter names follow the Python cq_gears convention verbatim** — snake_case, matching the original `cq_gears` Python class `__init__` signatures (e.g., `teeth_number`, not `teeth`; `module`, not `moduleSize`; `width`, not `thickness`).
- `BrepHandle` results are automatically adopted into faijs `Shape` at the library boundary.
- For multi-output functions (pairs, planetary), each named output becomes a separate product.
- **BREP only** — mesh mode throws `E_MESH_UNSUPPORTED`.
