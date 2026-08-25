/**
 * stdlib primitives — 基本体创建库函数（box/sphere/cylinder/cone/wedge）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/primitives.ts 迁出并改写为 stdlib 形态：
 * `(params, exec) => Promise<Shape>`，resolvePath 静态判定 brep/mesh，
 * 产物经 solid() 构造器创建，solid 经 exec.setSolid 挂身份槽。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { solidToShape } from '../brep/brep-ops'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { ExecContext } from '../cad-runtime/exec-context'

/** BREP 实现标记（resolvePath 判定用；primitives 有 OCCT 精确构造） */
const brepImpl = primitiveToBrepSolid

/** BREP 路径：OCCT 精确构造 + 三角化 + 身份槽挂 solid。 */
function primitiveBrep(op: string, params: Record<string, unknown>, exec: ExecContext): Shape {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/box] no OCCT kernel')
  const type = op === 'box' ? 'cube' : op
  const result = primitiveToBrepSolid(kernel, type as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'wedge', params as never)
  const shape = solid(solidToShape(kernel, result.solid, params.segments as number | undefined))
  exec.setSolid(shape, result.solid)
  return shape
}

export function box(params: Record<string, unknown>, exec: ExecContext): Shape {
  const path = resolvePath(exec, [], brepImpl)
  if (path === 'brep') return primitiveBrep('box', params, exec)
  return solid(cad.box(params as never))
}

export function sphere(params: Record<string, unknown>, exec: ExecContext): Shape {
  const path = resolvePath(exec, [], brepImpl)
  if (path === 'brep') return primitiveBrep('sphere', params, exec)
  return solid(cad.sphere(params as never))
}

export function cylinder(params: Record<string, unknown>, exec: ExecContext): Shape {
  const path = resolvePath(exec, [], brepImpl)
  if (path === 'brep') return primitiveBrep('cylinder', params, exec)
  return solid(cad.cylinder(params as never))
}

export function cone(params: Record<string, unknown>, exec: ExecContext): Shape {
  const path = resolvePath(exec, [], brepImpl)
  if (path === 'brep') return primitiveBrep('cone', params, exec)
  return solid(cad.cone(params as never))
}

export function wedge(params: Record<string, unknown>, exec: ExecContext): Shape {
  const path = resolvePath(exec, [], brepImpl)
  if (path === 'brep') return primitiveBrep('wedge', params, exec)
  return solid(cad.wedge(params as never))
}
