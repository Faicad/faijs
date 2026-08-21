/**
 * 基本体创建操作分派器
 *
 * BREP 路径：用 OCCT 直接构造精确 solid
 * Mesh 路径（断链后）：用 THREE.js 参数网格
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { primitiveToBrepSolid } from '../primitives/brep-primitives'
import { solidToShape } from '../brep/brep-ops'
import { initOcctWasm } from '../occt-kernel/occtKernel'
import type { OpContext } from './types'
import { canUseBrep } from './types'

/**
 * 执行基本体创建操作（box/sphere/cylinder/cone/wedge）
 *
 * 引擎选择策略：
 * - BREP 链活跃时 → OCCT 精确实体构造
 * - BREP 链已断裂 → THREE.js 参数网格（manifold-3d 管线）
 */
export async function executePrimitive(ctx: OpContext): Promise<Shape> {
  const { stmt, args } = ctx

  if (canUseBrep(ctx)) {
    return executePrimitiveBrep(ctx)
  }

  // Mesh 路径（断链后）：用 THREE.js 参数网格
  return executePrimitiveMesh(stmt.op, args)
}

/**
 * BREP 路径：用 OCCT 直接构造精确 solid
 */
async function executePrimitiveBrep(ctx: OpContext): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) {
    brepChain!.kernel = await initOcctWasm()
  }

  const type = stmt.op === 'box' ? 'cube' : stmt.op
  const result = primitiveToBrepSolid(brepChain!.kernel, type as 'cube' | 'sphere' | 'cylinder' | 'cone' | 'wedge', args as any)
  brepChain!.solidCache.set(stmt.id, result.solid)
  return solidToShape(brepChain!.kernel, result.solid, args.segments as number | undefined, brepChain, stmt.id)
}

/**
 * Mesh 路径：用 THREE.js 参数网格
 */
async function executePrimitiveMesh(
  op: string,
  args: Record<string, unknown>,
): Promise<Shape> {
  switch (op) {
    case 'box':
      return cad.box(args as any)
    case 'sphere':
      return cad.sphere(args as any)
    case 'cylinder':
      return cad.cylinder(args as any)
    case 'cone':
      return cad.cone(args as any)
    case 'wedge':
      return cad.wedge(args as any)
    default:
      throw new Error(`[executePrimitive] unknown primitive: ${op}`)
  }
}
