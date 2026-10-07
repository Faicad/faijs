/**
 * Self-hosted compat-op implementations — solid primitives
 * (core-decouple Phase 3, §5.4).
 *
 * @platform occt
 *
 * Brep-shaped implementations for `torus`, `ellipsoid`, `makeBaseBox`.
 * Semantics mirror brepjs `topology/primitiveFns.ts` + `solidBuilders.ts`
 * (`makeTorus`/`makeEllipsoid` take at/axis placement) and
 * `sketching/shortcuts.ts` `makeBaseBox` (origin-centered XY rectangle extruded
 * along +Z). Placement is composed from L1 `translate`/`generalTransform`
 * since the L1 `makeTorus`/`makeEllipsoid` signatures carry no location.
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { ok, err, type Result } from '../../result/result'
import { kernelError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import type { Vec3 } from '../brepjs-compat/types'
import { rotationZTo } from './brepHelpers'

const TORUS_PARAMS = { name: 'torus', params: ['majorRadius', 'minorRadius', 'options'], formClass: 'A' as FormClass }
const ELLIPSOID_PARAMS = { name: 'ellipsoid', params: ['rx', 'ry', 'rz', 'options'], formClass: 'A' as FormClass }
const MAKE_BASE_BOX_PARAMS = {
  name: 'makeBaseBox',
  params: ['xLength', 'yLength', 'zLength'],
  formClass: 'A' as FormClass,
}

/** Translate a handle, releasing the intermediate (kernel returns a fresh one). */
function translated(kernel: ReturnType<typeof getBrepApi>, h: BrepHandle, v: Vec3): BrepHandle {
  const next = kernel.translate(h, v[0], v[1], v[2])
  kernel.release(h)
  return next
}

/**
 * Create a torus (brepjs `torus(majorRadius, minorRadius, {at, axis})`).
 *
 * The L1 `makeTorus(major, minor)` builds the ring on the +Z axis at the
 * origin; placement is composed afterwards (`axis` → rotation, `at` →
 * translation).
 *
 * @param args - Resolved arguments (majorRadius, minorRadius, placement options).
 * @returns The torus as a `BrepHandle`.
 */
export function torusBrep(...args: unknown[]): Result<BrepHandle> {
  const [majorRadius, minorRadius, options] = resolveArgs(args, TORUS_PARAMS)
  const opts = (options ?? {}) as { at?: Vec3; axis?: Vec3 }
  const kernel = getBrepApi()
  try {
    let h = kernel.makeTorus(majorRadius as number, minorRadius as number)
    if (opts.axis && !(opts.axis[0] === 0 && opts.axis[1] === 0 && opts.axis[2] === 1)) {
      const rotated = kernel.generalTransform(h, rotationZTo(opts.axis))
      kernel.release(h)
      h = rotated
    }
    if (opts.at) h = translated(kernel, h, opts.at)
    return ok(h)
  } catch (e) {
    return err(
      kernelError('TORUS_FAILED', `torus: kernel failure: ${e instanceof Error ? e.message : String(e)}`, e),
    )
  }
}

/**
 * Create an ellipsoid (brepjs `ellipsoid(rx, ry, rz, {at})`).
 *
 * @param args - Resolved arguments (rx, ry, rz, placement options).
 * @returns The ellipsoid as a `BrepHandle`.
 */
export function ellipsoidBrep(...args: unknown[]): Result<BrepHandle> {
  const [rx, ry, rz, options] = resolveArgs(args, ELLIPSOID_PARAMS)
  const opts = (options ?? {}) as { at?: Vec3 }
  const kernel = getBrepApi()
  try {
    let h = kernel.makeEllipsoid(rx as number, ry as number, rz as number)
    if (opts.at) h = translated(kernel, h, opts.at)
    return ok(h)
  } catch (e) {
    return err(
      kernelError('ELLIPSOID_FAILED', `ellipsoid: kernel failure: ${e instanceof Error ? e.message : String(e)}`, e),
    )
  }
}

/**
 * Create a base box: origin-centered XY rectangle extruded by `zLength` along
 * +Z (brepjs `makeBaseBox(xLength, yLength, zLength)` via the sketcher).
 *
 * @param args - Resolved arguments (xLength, yLength, zLength).
 * @returns The box as a `BrepHandle`.
 */
export function makeBaseBoxBrep(...args: unknown[]): Result<BrepHandle> {
  const [xLength, yLength, zLength] = resolveArgs(args, MAKE_BASE_BOX_PARAMS)
  const kernel = getBrepApi()
  try {
    const rect = kernel.makeRectangle(xLength as number, yLength as number)
    try {
      return ok(kernel.extrude(rect, 0, 0, zLength as number))
    } finally {
      kernel.release(rect)
    }
  } catch (e) {
    return err(
      kernelError('MAKE_BASE_BOX_FAILED', `makeBaseBox: kernel failure: ${e instanceof Error ? e.message : String(e)}`, e),
    )
  }
}
