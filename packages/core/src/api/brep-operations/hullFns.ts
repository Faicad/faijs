/**
 * Self-hosted compat-op implementation — convexHull
 * (core-decouple Phase 3, §5.4).
 *
 * @platform occt
 *
 * Semantics mirror brepjs `operations/convexHullFns.ts` (HULL_EMPTY_INPUT /
 * HULL_NOT_3D / HULL_DEGENERATE guards) on the L1 `hullFromPoints` (core's own
 * hull closure, §5.1) with tolerance 0.1 (brepjs default).
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { ok, err, type Result } from '../../result/result'
import { kernelError, validationError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import type { Vec3 } from '../brepjs-compat/types'

const CONVEX_HULL_PARAMS = { name: 'convexHull', params: ['points'], formClass: 'A' as FormClass }

/**
 * Compute the convex hull of a point set.
 *
 * @param args - Resolved arguments (point list).
 * @returns The hull solid as a `BrepHandle`.
 */
export function convexHullBrep(...args: unknown[]): Result<BrepHandle> {
  const [pointsRaw] = resolveArgs(args, CONVEX_HULL_PARAMS)
  const kernel = getBrepApi()
  const points = (pointsRaw ?? []) as Vec3[]

  if (points.length < 4) {
    return err(
      validationError(
        'HULL_EMPTY_INPUT',
        `convexHull: at least 4 points required, got ${points.length}`,
      ),
    )
  }

  try {
    const objPoints = points.map((p) => ({ x: p[0], y: p[1], z: p[2] }))
    const h = kernel.hullFromPoints(objPoints, 0.1)
    if (!kernel.isSolid(h)) {
      kernel.release(h)
      return err(kernelError('HULL_NOT_3D', 'convexHull result is not a solid; points may be coplanar'))
    }
    return ok(h)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    if (raw.includes('coplanar') || raw.includes('fewer than') || raw.includes('degenerate')) {
      return err(kernelError('HULL_DEGENERATE', `convexHull degenerate: ${raw}`, e))
    }
    return err(kernelError('HULL_FAILED', `convexHull failed: ${raw}`, e))
  }
}
