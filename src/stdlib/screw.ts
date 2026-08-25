/**
 * stdlib screw — 螺丝创建库函数（creator op，无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/screw.ts 迁出并改写为 stdlib 形态：
 * `(params, exec) => Promise<Shape>`，resolvePath 静态判定 brep/mesh，
 * 产物经 solid() 构造器创建，solid 经 exec.setSolid 挂身份槽。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { solidToShape } from '../brep/brep-ops'
import { threadBrep } from '../brep/brepjs-mirror/threadFns'
import { getScrewSpec, threadToPitchMm, SCREW_HEAD_DIMS } from '../primitives/screw/screw-db'
import { solid } from './shape'
import { resolvePath } from './internal/resolve-path'
import type { ExecContext } from '../cad-runtime/exec-context'

/** BREP 实现标记（resolvePath 判定用；screw 有 OCCT 精确构造） */
const brepImpl = screwBrep

/** BREP 路径：threadBrep + fuse 构造精确螺纹螺钉 + 三角化 + 身份槽挂 solid。 */
async function screwBrep(params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  const kernel = exec.kernels.occt
  if (!kernel) throw new Error('[stdlib/screw] no OCCT kernel')

  const system = params.system as 'metric' | 'imperial'
  const specIdx = params.specIdx as number
  const spec = getScrewSpec(system, specIdx)
  const length = params.length as number
  const head = params.head as 'hex' | 'chc' | 'none'
  const thread = params.thread as 'coarse' | 'fine' | 'custom' | 'none'
  const pitchCustom = params.pitchCustom as number | undefined

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
      // threadBrep creates thread from Z=0 to Z=height; center it to match shank
      const centeredThread = kernel.translate(threadSolid, 0, 0, -length / 2)
      kernel.release(threadSolid)
      const fused = kernel.fuse(result, centeredThread)
      kernel.release(result)
      kernel.release(centeredThread)
      result = fused
    }
  }

  // 3. 螺钉头
  if (head === 'hex') {
    // 六棱柱头
    const headHeight = spec.dia * SCREW_HEAD_DIMS.hex.heightFactor
    const headRadius = spec.dia * SCREW_HEAD_DIMS.hex.radiusFactor
    const headSolid = makeHexPrismBrep(kernel, headRadius, headHeight, length / 2)
    const fused = kernel.fuse(result, headSolid)
    kernel.release(result)
    kernel.release(headSolid)
    result = fused
  } else if (head === 'chc') {
    // 沉头（圆锥）
    const headHeight = spec.dia * SCREW_HEAD_DIMS.chc.heightFactor
    const headRadius = spec.dia * SCREW_HEAD_DIMS.chc.radiusFactor
    const cone = kernel.makeCone(headRadius, 0, headHeight)
    const positioned = kernel.translate(cone, 0, 0, length / 2)
    kernel.release(cone)
    const fused = kernel.fuse(result, positioned)
    kernel.release(result)
    kernel.release(positioned)
    result = fused
  }

  const shape = solid(solidToShape(kernel, result))
  exec.setSolid(shape, result)
  return shape
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
  const edges: import('occt-wasm').ShapeHandle[] = []
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

export async function screw(params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  const path = resolvePath(exec, [], brepImpl)
  if (path === 'brep') return screwBrep(params, exec)
  return solid(await cad.screw({
    system: params.system as 'metric' | 'imperial',
    specIdx: params.specIdx as number,
    thread: params.thread as 'coarse' | 'fine' | 'custom' | 'none',
    pitchCustom: params.pitchCustom as number | undefined,
    length: params.length as number,
    head: params.head as 'hex' | 'chc' | 'none',
    nRad: params.nRad as number | undefined,
  }))
}
