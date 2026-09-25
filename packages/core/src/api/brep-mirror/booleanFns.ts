/**
 * Self-hosted compat-op implementations — boolean / section
 * (core-decouple Phase 3, §5.4).
 *
 * @platform occt
 *
 * Brep-shaped implementation for `section`. Semantics mirror vendored
 * `topology/booleanFns.ts` `section` (NULL_SHAPE_INPUT guard, plane resolution
 * from PlaneInput, kernel section via a planar tool, compound result) using the
 * L1 `sectionByPlane` (occt-wasm `BRepAlgoAPI_Section` + edge/wire downcast).
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { getOcctKernel } from '../../occt-kernel/occtKernel'
import { ok, err, type Result } from '../../result/result'
import { kernelError, validationError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import type { PlaneInput } from '../brepjs-compat/planeTypes'
import { resolvePlane } from '../brepjs-compat/planeOps'
import { brepHandleOf } from './brepHelpers'

const SECTION_PARAMS = { name: 'section', params: ['shape', 'plane'], formClass: 'A' as FormClass }

/**
 * Section a shape with a plane (vendored `section(shape, plane, options?)`).
 *
 * The plane is resolved from `PlaneInput` (named plane or explicit Plane); the
 * L1 `sectionByPlane` builds the planar tool, runs `BRepAlgoAPI_Section`, and
 * downcasts the result compound to edge/wire handles, which are re-combined
 * into a compound to match the vendored product shape. `options` (approximation
 * / planeSize) is accepted for signature compatibility; the occt native
 * section uses its default approximation.
 */
export function sectionBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, plane] = resolveArgs(args, SECTION_PARAMS)
  const kernel = getBrepApi()
  const h = brepHandleOf(shape)
  if (getOcctKernel().isNull(h as never)) {
    return err(validationError('NULL_SHAPE_INPUT', 'section: shape is a null shape'))
  }
  const resolved = resolvePlane(plane as PlaneInput)
  if (!resolved.ok) return resolved
  const p = resolved.value
  try {
    const edges = kernel.sectionByPlane(
      h,
      { x: p.origin[0], y: p.origin[1], z: p.origin[2] },
      { x: p.zDir[0], y: p.zDir[1], z: p.zDir[2] },
    )
    return ok(kernel.makeCompound(edges))
  } catch (e) {
    return err(
      kernelError(
        'SECTION_FAILED',
        `Section with plane failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
        { operation: 'section' },
        'The cutting plane may not intersect the shape. Verify plane position relative to shape bounds.',
      ),
    )
  }
}


// ---------------------------------------------------------------------------
// fuse — union two shapes (vendored topology/booleanFns.ts#fuse)
// ---------------------------------------------------------------------------

const FUSE_PARAMS = { name: 'fuse', params: ['a', 'b', 'options'], formClass: 'A' as FormClass }

export function fuseBrep(...args: unknown[]): Result<BrepHandle> {
  const [a, b] = resolveArgs(args, FUSE_PARAMS)
  const kernel = getBrepApi()
  const ha = brepHandleOf(a)
  const hb = brepHandleOf(b)
  try {
    return ok(kernel.fuse(ha, hb))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('FUSE_FAILED', `fuse failed: ${raw}`, e))
  }
}

// ---------------------------------------------------------------------------
// split — split a shape with tool(s) (vendored topology/api.ts#split → booleanFns.split)
// ---------------------------------------------------------------------------

const SPLIT_PARAMS = { name: 'split', params: ['shape', 'tools'], formClass: 'A' as FormClass }

export function splitBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, toolsRaw] = resolveArgs(args, SPLIT_PARAMS)
  const kernel = getBrepApi()
  const h = brepHandleOf(shape)
  const tools = (toolsRaw ?? []) as unknown[]
  if (tools.length === 0) return ok(h)
  const toolHandles = tools.map((t) => brepHandleOf(t))
  try {
    const result = getOcctKernel().split(h as never, toolHandles as never)
    return ok(result as unknown as BrepHandle)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(
      kernelError(
        'SPLIT_FAILED',
        `Split operation failed on ${tools.length} tool(s): ${raw}`,
        e,
        { operation: 'split', toolCount: tools.length },
      ),
    )
  }
}
