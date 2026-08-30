/**
 * stdlib screw — 螺丝创建库函数（creator 函数，无输入）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * dispatchPath 静态判定 brep/mesh，产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { cad } from '@faicad/faijs-core/mesh'
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops'
import { threadBrep } from './brepjs-mirror/threadFns'
import { getScrewSpec, threadToPitchMm, SCREW_HEAD_DIMS } from '@faicad/faijs-core/primitives/screw/screw-db'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { fromBrep } from '@faicad/faijs-core/shape'
import { defineOp } from '@faicad/faijs-core/sdk'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'

/** BREP 路径：threadBrep + fuse 构造精确螺纹螺钉 + 三角化 + fromBrep 登记。 */
async function screwBrep(params: Record<string, unknown>): Promise<Shape> {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
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

  return fromBrep(solidToShape(kernel, result), { solid: result })
}

/**
 * 构造六棱柱 BREP solid
 */
function makeHexPrismBrep(
  kernel: BrepEngineApi,
  radius: number,
  height: number,
  zOffset: number,
): BrepHandle {
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
  const edges: BrepHandle[] = []
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

/**
 * Validate screw parameters: `system` and `specIdx` are required, and `length`
 * must be a finite number.
 * @param params - the raw screw operation parameters.
 */
export function assertScrewParams(params: Record<string, unknown>): void {
  if (typeof params.system !== 'string' || typeof params.specIdx !== 'number') {
    throw new Error(
      `[stdlib/screw] system (string) and specIdx (number) are required, got system=${JSON.stringify(params.system)}, specIdx=${JSON.stringify(params.specIdx)}`,
    )
  }
  if (typeof params.length !== 'number' || !Number.isFinite(params.length)) {
    throw new Error(`[stdlib/screw] length must be a finite number, got ${JSON.stringify(params.length)}`)
  }
}

/**
 * 生成螺丝零件（螺纹 + 头型）。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name screw
 * @returns Shape 螺丝几何，生成独立零件。
 * @param params.system - 制式。type:'metric' | 'imperial' required:true
 * @param params.specIdx - 规格索引（决定公称直径，如 5 → M5、6 → M6）。type:number required:true
 * @param params.thread - 螺纹类型。type:'coarse' | 'fine' | 'custom' | 'none' 默认 'coarse'
 * @param params.length - 螺杆长度（mm）。type:number required:true
 * @param params.head - 头型（hex 六角 / chc 沉头 / none 无头）。type:'hex' | 'chc' | 'none' 默认 'none'
 * @param params.pitchCustom - 自定螺距（thread='custom' 时用）。type:number
 * @param params.nRad - 径向分段数（拓扑参数）。type:number 默认 32
 * @note nRad 是拓扑参数不是渲染参数：mesh 路径直接决定分段数；BREP 路径用精确曲面，nRad 仅作 BREP→mesh 三角化角度提示（angular deflection ≈ 2π/nRad）。.faijs 默认 32 不输出，非默认才输出以保证可复现。
 * @note pitchCustom 执行层已支持（makeScrew/threadBrep 均读取），codegen 曾不序列化（TODO）；当前已机械输出。
 * @example
 * const s = await cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex' })
 * const s = await cad.screw({ system: 'metric', specIdx: 6, thread: 'coarse', length: 20, head: 'hex', nRad: 64 })
  */
export const screw = defineOp({
  mesh: async (params: Record<string, unknown>) => {
    assertScrewParams(params)
    return cad.screw({
      system: params.system as 'metric' | 'imperial',
      specIdx: params.specIdx as number,
      thread: params.thread as 'coarse' | 'fine' | 'custom' | 'none',
      pitchCustom: params.pitchCustom as number | undefined,
      length: params.length as number,
      head: params.head as 'hex' | 'chc' | 'none',
      nRad: params.nRad as number | undefined,
    })
  },
  brep: async (params: Record<string, unknown>) => {
    assertScrewParams(params)
    return screwBrep(params)
  },
})
