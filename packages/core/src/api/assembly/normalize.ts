/**
 * api/assembly/normalize — 约束规范化（P1，方案 §4.1 / §5.3）
 *
 * 唯一职责：把 `cad.assembly({ constraints })` 的各种输入形态归一为
 * {@link StructuralConstraint}：
 * - 遗留 `face_mate` → `mate`（字段重排：fixedPartName/fixedFace → a，movingPartName/movingFace → b）；
 * - 新形态直通（引用同一对象，不拷贝）。
 *
 * 未知类型在此抛错（fail-fast），不在求解深处静默跳过。
 */

import type { AssemblyConstraint, StructuralConstraint } from './types'

/**
 * Normalize one assembly constraint to the structural form.
 * @param c - the raw constraint from script args.
 * @returns the normalized structural constraint.
 * @throws Error when the constraint type is unknown.
 */
export function normalizeConstraint(c: AssemblyConstraint): StructuralConstraint {
  if (c.type === 'face_mate') {
    return {
      type: 'mate',
      a: { part: c.fixedPartName, face: c.fixedFace },
      b: { part: c.movingPartName, face: c.movingFace },
    }
  }
  if (
    c.type === 'mate' || c.type === 'align' || c.type === 'coincident' ||
    c.type === 'concentric' || c.type === 'distance' || c.type === 'angle' ||
    c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'fixed'
  ) {
    return c
  }
  throw new Error(`[assembly] unknown constraint type: ${(c as { type?: unknown }).type}`)
}
