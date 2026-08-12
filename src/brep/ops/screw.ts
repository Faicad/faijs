/**
 * 螺丝操作分派器
 *
 * BREP 路径：用 threadBrep + fuse 构造精确螺纹螺钉
 * Mesh 路径：用 makeScrew 网格
 */

import type { Shape } from '../../cad-core/types'
import type { ShapeHandle } from 'occt-wasm'
import { cad } from '../../cad-core'
import { threadBrep } from '../operations/threadFns'
import { solidToShape } from '../brep-ops'
import { getScrewSpec, threadToPitchMm } from '../../primitives/screw/screw-db'
import type { OpContext } from './types'
import { canUseBrep } from './types'

/**
 * 执行螺丝操作
 */
export async function executeScrew(ctx: OpContext): Promise<Shape> {
  const { args } = ctx

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx)) {
    return cad.screw({
    system: args.system as 'metric' | 'imperial',
    specIdx: args.specIdx as number,
    thread: args.thread as 'coarse' | 'fine' | 'custom' | 'none',
    pitchCustom: args.pitchCustom as number | undefined,
    length: args.length as number,
    head: args.head as 'hex' | 'chc' | 'none',
    nRad: args.nRad as number | undefined,
  })
  }

  // 链活跃 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  return executeScrewBrep(ctx)
}

/**
 * BREP 路径：用 threadBrep + fuse 构造精确螺纹螺钉
 */
async function executeScrewBrep(ctx: OpContext): Promise<Shape> {
  const { stmt, args, brepChain } = ctx
  if (!brepChain?.kernel) throw new Error('[executeScrew] no kernel')

  const kernel = brepChain.kernel
  const system = args.system as 'metric' | 'imperial'
  const specIdx = args.specIdx as number
  const spec = getScrewSpec(system, specIdx)
  const length = args.length as number
  const head = args.head as 'hex' | 'chc' | 'none'
  const thread = args.thread as 'coarse' | 'fine' | 'custom' | 'none'
  const pitchCustom = args.pitchCustom as number | undefined

  // 1. 螺杆（圆柱体，居中）
  const shank = kernel.makeCylinder(spec.dia / 2, length)
  const centeredShank = kernel.translate(shank, 0, 0, -length / 2)
  kernel.release(shank)

  let result = centeredShank

  // 2. 螺纹（外螺纹）
  if (thread !== 'none') {
    const pitch = threadToPitchMm(system, spec, thread, pitchCustom)
    if (pitch > 0) {
      const threadSolid = threadBrep(kernel, {
        radius: spec.dia / 2,
        pitch,
        height: length,
      })
      const fused = kernel.fuse(result, threadSolid)
      kernel.release(result)
      kernel.release(threadSolid)
      result = fused
    }
  }

  // 3. 螺钉头
  if (head === 'hex') {
    // 六棱柱头
    const headHeight = spec.dia * 0.6
    const headRadius = spec.dia * 0.9
    const head = makeHexPrismBrep(kernel, headRadius, headHeight, length / 2)
    const fused = kernel.fuse(result, head)
    kernel.release(result)
    kernel.release(head)
    result = fused
  } else if (head === 'chc') {
    // 沉头（圆锥）
    const headHeight = spec.dia * 0.5
    const cone = kernel.makeCone(spec.dia, 0, headHeight)
    const positioned = kernel.translate(cone, 0, 0, length / 2)
    kernel.release(cone)
    const fused = kernel.fuse(result, positioned)
    kernel.release(result)
    kernel.release(positioned)
    result = fused
  }

  brepChain.solidCache.set(stmt.id, result)
  return solidToShape(kernel, result)
}

/**
 * 构造六棱柱 BREP solid
 */
function makeHexPrismBrep(
  kernel: import('occt-wasm').OcctKernel,
  radius: number,
  height: number,
  zOffset: number,
): import('occt-wasm').ShapeHandle {
  // 六边形顶点
  const pts: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (i * 2 * Math.PI) / 6
    pts.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      z: 0,
    })
  }

  // 构建边
  const edges: ShapeHandle[] = []
  for (let i = 0; i < 6; i++) {
    const edge = kernel.makeLineEdge(pts[i], pts[(i + 1) % 6])
    edges.push(edge)
  }

  // 构建 wire → face → extrude
  const wire = kernel.makeWire(edges)
  const face = kernel.makeFace(wire)
  const extruded = kernel.extrude(face, 0, 0, height)

  // 平移到 zOffset
  const positioned = kernel.translate(extruded, 0, 0, zOffset)

  // 释放中间句柄
  for (const e of edges) kernel.release(e)
  kernel.release(wire)
  kernel.release(face)
  kernel.release(extruded)

  return positioned
}
