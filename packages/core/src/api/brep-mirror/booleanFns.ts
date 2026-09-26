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
import { kernelError } from '../../result/errors'
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
 *
 * @param args - Resolved arguments (shape, plane).
 * @returns The section result compound as a `BrepHandle`.
 */
export function sectionBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, plane] = resolveArgs(args, SECTION_PARAMS)
  const kernel = getBrepApi()
  const h = brepHandleOf(shape)
  // NOTE: 2026-09-26 brepkit 降级——移除 getOcctKernel().IsNull 平台耦合。
  // 空/坏句柄由下游 sectionByPlane 内核抛错并被下方 try/catch 捕获为 SECTION_FAILED
  // （occt 的 sectionByPlane 对空结果本就返回 []，行为等价；brepkit 对坏句柄抛
  // "invalid solid handle"，诚实报错而非崩溃）。
  const resolved = resolvePlane(plane as PlaneInput)
  if (!resolved.ok) return resolved
  const p = resolved.value
  try {
    const parts = kernel.sectionByPlane(
      h,
      { x: p.origin[0], y: p.origin[1], z: p.origin[2] },
      { x: p.zDir[0], y: p.zDir[1], z: p.zDir[2] },
    )
    // 语义差异（如实登记）：occt sectionByPlane 返回 edge/wire 句柄组（1D 剖面线）；
    // brepkit sectionByPlane 返回 face 句柄组（2D 剖面面）。两侧都包成 compound 产物，
    // 下游 meshShape/wireframe 已按已知集合分发（brepkit makeCompound 对非 solid 子句柄走
    // 虚拟 compound 路径）。
    return ok(kernel.makeCompound(parts))
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

/**
 * Fuse (union) two shapes into one.
 * @param args - Resolved arguments (a, b).
 * @returns The fused shape as a `BrepHandle`.
 */
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

/**
 * Split a shape with one or more tool shapes.
 * @param args - Resolved arguments (shape, tools).
 * @returns The split result as a `BrepHandle`.
 */
export function splitBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, toolsRaw] = resolveArgs(args, SPLIT_PARAMS)
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
