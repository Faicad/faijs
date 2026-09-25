/**
 * gear — gear / thread factories (library fixture, C1)
 *
 * Design: the 2026-09-03 external-CAD compat plan §8.1 (P24)
 *
 * This is a **third-party library** — it behaves like a real external CAD
 * library (`import * as gear from '@faicad/gear-lib-demo'`), not part of faijs.
 *
 * Responsibilities after P24 (§8.1):
 * 1. Building happens through the morphology imported from the `@faicad/faijs`
 *    facade (`makeExternalGear` / `makeInternalGear` / `makePlanetaryGear` /
 *    `thread`) — the single-kernel assert at the lib boundary takes over the
 *    engine lifecycle, so this module no longer self-registers a kernel.
 * 2. Every factory returns a `Result` carrying raw shape handles; adoption
 *    into faijs Shapes happens at the boundary (`registerLib(…, { autoLift:
 *    true })` → `admitCompatLib` → `compatOp`), never via a hand-rolled
 *    `fromHandle`.
 * 3. `planetary` returns a structured multi-geometry record and declares the
 *    handle-bearing fields through the static `outputs` annotation
 *    (outbound adoption point for `compatOp`; the only multi-output contract
 *    name — `fn.outputs`).
 * 4. No module-level pinning: `adoptEntity`'s `unregisterFromCleanup` takes
 *    over handle lifetime (R1 fix); the previous `pinned` array is deleted.
 *
 * Host timing: the test host builds a runtime, warms it up (one box
 * statement; `registerOcctBrepEngine()` has bound the vendored kernel), then
 * imports and calls this module — identical to a real `await import(url)`.
 */

import { ok, err, cylinder, box } from '@faicad/faijs'
import type {
  ExternalGearParams,
  InternalGearParams,
  PlanetaryGearParams,
  PlanetaryGearAssembly,
  ThreadOptions,
  Result,
  Shape3D,
} from '@faicad/faijs'
import { isShape } from '@faicad/faijs/shape'

/** Parameters for building an external or internal spur gear (upstream field names). */
export type GearParams = ExternalGearParams
/** Parameters for building a planetary gear train. */
export type PlanetaryParams = PlanetaryGearParams
/** Parameters describing a thread profile. */
export type ThreadParams = ThreadOptions

/**
 * Build an external spur gear.
 * @param params - the gear parameters (`teeth`, `moduleSize`, `thickness`, `bore`, …).
 * @returns `Ok` with the gear solid, or `Err` for invalid parameters.
 */
export const external = (params: GearParams): Result<Shape3D> => {
  if (params.thickness <= 0) {
    return err({ code: 'GEAR_THICKNESS_NONPOSITIVE', message: 'thickness must be positive', name: 'ValidationError' })
  }
  if (params.bore !== undefined && params.bore >= params.moduleSize * params.teeth) {
    return err({ code: 'GEAR_BORE_TOO_LARGE', message: 'bore exceeds pitch diameter', name: 'ValidationError' })
  }
  return ok(cylinder({ radius: params.moduleSize * params.teeth / 2, height: params.thickness }) as unknown as Shape3D)
}

/**
 * Build an internal (ring) spur gear.
 * @param params - the gear parameters, including the optional ring wall thickness.
 * @returns `Ok` with the ring solid, or `Err` for invalid parameters.
 */
export const internal = (params: InternalGearParams): Result<Shape3D> =>
  ok(cylinder({ radius: params.moduleSize * params.teeth / 2, height: params.thickness }) as unknown as Shape3D)

/**
 * Build a planetary gear train (sun + planets + ring).
 * The static `outputs` annotation declares which record fields carry
 * geometry so the compatOp adopts them into faijs Shapes on outbound.
 * @param params - the planetary-gear parameters.
 * @returns `Ok` with the assembly record, or `Err` for invalid parameters.
 */
export const planetary = (
  params: PlanetaryParams
): Result<PlanetaryGearAssembly> =>
  ok({
    sun: cylinder({ radius: 8, height: params.thickness }) as unknown as Shape3D,
    planets: [1, 2, 3].map(() => cylinder({ radius: 5, height: params.thickness }) as unknown as Shape3D),
    ring: box(params.thickness, params.thickness, params.thickness) as unknown as Shape3D,
  })
// outbound adoption declaration: compatOp reads the static annotation.
; (planetary as { outputs?: string[] }).outputs = ['planets', 'ring', 'sun']

/**
 * Build a helical screw-thread ridge.
 * @param params - the thread profile (`radius`, `pitch`, `height`, …).
 * @returns `Ok` with the thread-ridge solid, or `Err` for invalid parameters.
 */
export const thread = (params: ThreadParams): Result<Shape3D> => {
  if (params.radius <= 0) {
    return err({ code: 'THREAD_INVALID_RADIUS', message: 'radius must be positive', name: 'ValidationError' })
  }
  return ok(cylinder({ radius: params.radius, height: params.height }) as unknown as Shape3D)
}