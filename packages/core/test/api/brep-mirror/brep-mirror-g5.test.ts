/**
 * brep-mirror-g5.test — Phase 3（core-decouple §5.3）G5 手写平台 op 直连验证
 *
 * 覆盖 5 个手写平台 op（api/{loft,revolve,sweep,thicken,replicate}.ts）：
 * G5 后内部不再 import brepjs——旧调用替换为 core 直连
 * （loft→occt loft/loftWithVertices、revolve→revolveVec、sweep→brep-mirror
 * sweepBrep、thicken→occt thicken、replicate(mirror)→本地 MirrorOptions）。
 *
 * 运行：npx vitest run src/api/brep-mirror/brep-mirror-g5.test.ts
 */

// ─── OCCT stdout 噪声过滤 ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring Shape') ||
    msg.includes('WorkSession') ||
    /^\*{4,}/.test(msg) ||
    msg.startsWith(' Step File Name')
  if (isOcctNoise || msg.trim() === '') return
  occtOrigLog(...args)
}

import { describe, it, expect, beforeAll } from 'vitest'
import { registerOcctBrepEngine } from '../../../src/brep/engine/adapters/occt'
import { getBrepEngine } from '../../../src/brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../../src/runtime-state'
import { getBrepApi } from '../../../src/brep/handle-bridge'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import type { BrepHandle } from '../../../src/brep/engine/types'
import { brepOf, fromBrep } from '../../../src/shape'
import { solidToShape } from '../../../src/brep/brep-ops'
import { getSolidBoundingBox } from '../../../src/brep/brep-utils'
import { loft } from '../../../src/api/loft'
import { revolve } from '../../../src/api/revolve'
import { sweep } from '../../../src/api/sweep'
import { thicken } from '../../../src/api/thicken'
import { mirror } from '../../../src/api/replicate'
import type { Shape } from '../../../src/mesh/types'

let kernel: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  kernel = getBrepApi()
}, 120000)

/** kernel 产物 → faijs Shape（op 入参形态）。 */
function toShape(handle: BrepHandle): Shape {
  return fromBrep(solidToShape(kernel, handle), { solid: handle }) as Shape
}

/** XY 平面方框 wire → Shape（revolve 轮廓 / thicken 面）。 */
function squareWireShape(size = 10, z = 0): Shape {
  const pts: [number, number, number][] = [
    [-size / 2, -size / 2, z],
    [size / 2, -size / 2, z],
    [size / 2, size / 2, z],
    [-size / 2, size / 2, z],
  ]
  const edges = pts.map((p, i) =>
    kernel.makeLineEdge(
      { x: p[0], y: p[1], z: p[2] },
      { x: pts[(i + 1) % 4][0], y: pts[(i + 1) % 4][1], z: pts[(i + 1) % 4][2] },
    ),
  )
  const w = kernel.makeWire(edges)
  for (const e of edges) kernel.release(e)
  const face = kernel.makeFace(w)
  kernel.release(w)
  return toShape(face)
}

describe('G5 手写平台 op（core 直连）', () => {
  it('loft：两个面截面（10×10→5×5，z 0→20）→ 放样实体', () => {
    const bottom = squareWireShape(10, 0)
    const top = squareWireShape(5, 20)
    const s = (loft as unknown as (s: Shape[], o?: object) => Promise<Shape>)([bottom, top], {})
    return Promise.resolve(s).then((r) => {
      const handle = brepOf(r) as BrepHandle
      expect(handle).toBeTruthy()
      const bb = getSolidBoundingBox(kernel, handle)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(20, 1)
      expect(kernel.getVolume(handle)).toBeGreaterThan(0)
    })
  })

  it('revolve：轴外矩形绕 Z 转整圈 → 旋转实体', () => {
    // yz 平面矩形（x=5 偏移，4×10）绕 z 轴 → 空心管实体
    const pts: [number, number, number][] = [
      [5, -2, 0], [5, 2, 0], [5, 2, 10], [5, -2, 10],
    ]
    const edges = pts.map((p, i) =>
      kernel.makeLineEdge(
        { x: p[0], y: p[1], z: p[2] },
        { x: pts[(i + 1) % 4][0], y: pts[(i + 1) % 4][1], z: pts[(i + 1) % 4][2] },
      ),
    )
    const w = kernel.makeWire(edges)
    for (const e of edges) kernel.release(e)
    const face = kernel.makeFace(w)
    kernel.release(w)
    const faceShape = toShape(face)
    const r = (revolve as unknown as (s: Shape, o?: object) => Promise<Shape>)(faceShape, {
      axis: [0, 0, 1],
      at: [0, 0, 0],
      angle: 2 * Math.PI,
    })
    return Promise.resolve(r).then((s) => {
      const handle = brepOf(s) as BrepHandle
      expect(handle).toBeTruthy()
      const bb = getSolidBoundingBox(kernel, handle)
      // 外径 ≈ √(5²+2²)≈5.39 → x 跨度 ≈ 10.77
      expect(bb.max[0] - bb.min[0]).toBeGreaterThan(9)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(10, 1)
      expect(kernel.getVolume(handle)).toBeGreaterThan(0)
    })
  })

  it('sweep：面截面沿直线脊柱 → 扫掠体', () => {
    const profile = squareWireShape(8, 0)
    const p0: [number, number, number] = [0, 0, 0]
    const p1: [number, number, number] = [0, 0, 30]
    const edge = kernel.makeLineEdge({ x: p0[0], y: p0[1], z: p0[2] }, { x: p1[0], y: p1[1], z: p1[2] })
    const wire = kernel.makeWire([edge])
    kernel.release(edge)
    const spine = toShape(wire)
    const r = (sweep as unknown as (p: Shape, sp: Shape, o?: object) => Promise<Shape>)(profile, spine, {})
    return Promise.resolve(r).then((s) => {
      const handle = brepOf(s) as BrepHandle
      expect(handle).toBeTruthy()
      const bb = getSolidBoundingBox(kernel, handle)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(30, 1)
      expect(kernel.getVolume(handle)).toBeGreaterThan(0)
    })
  })

  it('thicken：面 → 2mm 实体', () => {
    const face = squareWireShape(10, 0)
    const r = (thicken as unknown as (i: Shape, t: number) => Promise<Shape>)(face, 2)
    return Promise.resolve(r).then((s) => {
      const handle = brepOf(s) as BrepHandle
      expect(handle).toBeTruthy()
      const bb = getSolidBoundingBox(kernel, handle)
      expect(bb.max[2] - bb.min[2]).toBeCloseTo(2, 1)
    })
  })

  it('mirror：选项 {normal, at} → 镜像实体', () => {
    const box = toShape(kernel.makeBox(10, 20, 30))
    const r = (mirror as unknown as (i: Shape, o?: object) => Promise<Shape>)(box, {
      normal: [1, 0, 0],
      at: [0, 0, 0],
    })
    return Promise.resolve(r).then((s) => {
      const handle = brepOf(s) as BrepHandle
      expect(handle).toBeTruthy()
      const bb = getSolidBoundingBox(kernel, handle)
      expect(Math.abs(bb.max[0] - bb.min[0])).toBeGreaterThan(0)
    })
  })
})
