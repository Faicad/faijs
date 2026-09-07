/**
 * 装配约束 BREP e2e（P0 验收①② + P1 新约束类型真内核验证）
 *
 * 使用真实 OCCT（beforeAll registerOcctBrepEngine）：
 * - P0①：cad.cylinder 侧壁面 resolveFaceGeometry 含 axis（origin 轴点 / direction 轴向）；
 * - P0②：顶面圆边 captureEdgeHint 含 axis（origin 圆心 / direction 平面法向 ±Z）；
 * - P1：concentric（圆柱侧壁对侧壁，轴约束新能力）与 mate（topoRef 新类型名）
 *   在 .fai.js 全链路（求解 → 引擎应用 → mesh 烘焙）正确。
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { asPartName, type PartName } from '@faicad/faijs-core/identity'
import { HASH_UPPER_BOUND } from '@faicad/faijs-core/brep/face-evolution'
import { resolveFaceGeometry } from '@faicad/faijs-core/api/topo-resolve'
import { captureEdgeHint } from '@faicad/faijs-core/topology/naming'
import type { PartNaming } from '@faicad/faijs-core/topology/naming/types'
import type { ResolutionContext } from '@faicad/faijs-core/topology/naming/resolve-face'
import type { CadRuntime, ExecutionResult } from '@faicad/faijs-core/cad-runtime/runtime'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'
import type { Shape } from '@faicad/faijs-core/mesh/types'

beforeAll(async () => {
  await registerOcctBrepEngine()
}, 120000)

/** 从 ExecutionResult 构建某 part 的解析上下文（BREP 现场 + roleTable）。 */
function buildCtx(result: ExecutionResult, partName: PartName): ResolutionContext {
  const chain = result.brepChain
  const kernel = chain.kernel
  const solid = chain.solidCache.get(partName)
  if (!kernel || !solid) throw new Error(`no BREP solid for ${partName}`)
  const handles = kernel.getSubShapes(solid, 'face')
  const hashes = kernel.subShapeHashes(solid, 'face', HASH_UPPER_BOUND)
  const faces = hashes.map((hash, i) => ({ ordinal: i + 1, hash, handle: handles[i] }))
  return { kernel: kernel as BrepEngineApi, faces }
}

function refForRole(naming: PartNaming, origin: string, role: string) {
  const row = naming.faceNaming.find((f) => f.role === role && f.origin === asPartName(origin))
  if (!row) throw new Error(`naming row not found: ${origin}:${role}`)
  return { kind: 'face' as const, origin: row.origin, role: row.role, hint: row.hint }
}

describe('P0 验收：hint 轴采集（真内核）', () => {
  let runtime: CadRuntime
  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })
  afterEach(() => {
    runtime.dispose()
  })

  it('P0①：圆柱侧壁面 hint 含 axis（origin 轴点 / direction 轴向）', async () => {
    // 非居中圆柱：底面 z=0 → 侧壁轴 origin 应为轴上一点 (0,0,~0)，direction ≈ +Z
    const code = `const part0 = cad.cylinder(10, 20, { centered: false })`
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    const kernel = result.brepChain.kernel as BrepEngineApi
    const shape = result.outputs.get(asPartName('part0')) as Shape
    expect(shape).toBeDefined()
    const ref = refForRole(result.naming!.get(asPartName('part0'))!, 'part0', 'cylinder:lateral')
    const geom = resolveFaceGeometry(kernel, shape, ref)
    expect(geom.surfaceType).toBe('cylinder')
    expect(geom.axis).toBeDefined()
    expect(geom.axis!.direction[0]).toBeCloseTo(0, 9)
    expect(geom.axis!.direction[1]).toBeCloseTo(0, 9)
    expect(Math.abs(geom.axis!.direction[2])).toBeCloseTo(1, 9)
    // origin 是轴上一点：到 Z 轴的距离 ≈ 0
    const rPerp = Math.hypot(geom.axis!.origin[0], geom.axis!.origin[1])
    expect(rPerp).toBeLessThan(1e-6)
  })

  it('P0②：顶面圆边 EdgeHint.axis（origin 圆心 / direction ±Z）', async () => {
    const code = `const part0 = cad.cylinder(10, 20, { centered: false })`
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    const ctx = buildCtx(result, asPartName('part0'))
    const kernel = ctx.kernel as BrepEngineApi
    const solid = result.brepChain.solidCache.get(asPartName('part0')) as BrepHandle
    const edgeHandles = kernel.getSubShapes(solid, 'edge')
    const circles = edgeHandles
      .filter((h) => kernel.curveType(h) === 'circle')
      .map((h) => captureEdgeHint(kernel, h))
    expect(circles.length).toBeGreaterThanOrEqual(2)
    // 顶面圆边：圆心 z ≈ 20（半径 10、高 20、底 z=0）
    const top = circles.find((c) => c.axis && Math.abs(c.axis.origin[2] - 20) < 1e-6)
    expect(top?.axis).toBeDefined()
    expect(top!.axis!.origin[0]).toBeCloseTo(0, 6)
    expect(top!.axis!.origin[1]).toBeCloseTo(0, 6)
    expect(Math.abs(top!.axis!.direction[2])).toBeCloseTo(1, 9)
    // 底面圆边：圆心 z ≈ 0
    const bottom = circles.find((c) => c.axis && Math.abs(c.axis.origin[2]) < 1e-6)
    expect(bottom?.axis).toBeDefined()
  })
})

describe('P1 新约束类型 e2e（真内核全链路）', () => {
  let runtime: CadRuntime
  beforeEach(() => {
    runtime = createRuntime(createNodePorts(), 'brep')
  })
  afterEach(() => {
    runtime.dispose()
  })

  function bboxOf(result: ExecutionResult, name: string): { min: [number, number, number]; max: [number, number, number] } {
    const p = result.outputs.get(asPartName(name)) as { positions?: ArrayLike<number> } | undefined
    expect(p).toBeDefined()
    const ps = p!.positions as ArrayLike<number>
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < ps.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const v = ps[i + c]
        if (v < min[c]) min[c] = v
        if (v > max[c]) max[c] = v
      }
    }
    return { min, max }
  }

  it('concentric：轴外圆柱面对圆柱面同轴（新能力，face_mate 做不到）', async () => {
    // part0：r=10 h=20 底在原点；part1：r=4 h=10 居中在 [30,0,5]
    // 同轴约束 → part1 轴线与 part0 轴线（Z 轴）重合：平移 (−30,0,0)，z 保持 [0,10]
    const code = `
      const part0 = cad.cylinder(10, 20, { centered: false })
      const part1 = cad.cylinder(4, 10, { centered: true, at: [30, 0, 5] })
      let asm0 = cad.assembly({ name: 'A', members: [part0, part1], constraints: [
        { type: 'fixed', part: 'part0' },
        { type: 'concentric',
          a: { part: 'part0', face: { topoRef: { kind: 'face', origin: 'part0', role: 'cylinder:lateral', hint: { kind: 'face', surfaceType: 'cylinder' } } } },
          b: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: 'cylinder:lateral', hint: { kind: 'face', surfaceType: 'cylinder' } } } } },
      ] })
      asm0.do_assemble()
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    const b1 = bboxOf(result, 'part1')
    // 网格化弦差 → 径向留 0.1 容差；z 是平面端盖 → 精确
    expect(b1.min[0]).toBeLessThan(0.1)
    expect(b1.max[0]).toBeGreaterThan(-0.1)
    expect(Math.abs((b1.min[0] + b1.max[0]) / 2)).toBeLessThan(0.1)
    expect(Math.abs((b1.min[1] + b1.max[1]) / 2)).toBeLessThan(0.1)
    expect(b1.min[2]).toBeCloseTo(0, 3)
    expect(b1.max[2]).toBeCloseTo(10, 3)
  })

  it('mate（新类型名，topoRef 面引用）：底面贴顶面', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.box(20, 20, 20, { centered: true, at: [40, 0, 0] })
      let asm0 = cad.assembly({ name: 'B', members: [part0, part1], constraints: [
        { type: 'fixed', part: 'part0' },
        { type: 'mate',
          a: { part: 'part0', face: { topoRef: { kind: 'face', origin: 'part0', role: 'box:top', hint: { kind: 'face', surfaceType: 'plane' } } } },
          b: { part: 'part1', face: { topoRef: { kind: 'face', origin: 'part1', role: 'box:bottom', hint: { kind: 'face', surfaceType: 'plane' } } } } },
      ] })
      asm0.do_assemble()
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeUndefined()
    const b0 = bboxOf(result, 'part0')
    const b1 = bboxOf(result, 'part1')
    expect(b0.max[2]).toBeCloseTo(10, 6)
    // part1 底面中心 (40,0,−10) 搬到 part0 顶面中心 (0,0,10)
    expect(b1.min[2]).toBeCloseTo(10, 6)
    expect(b1.max[2]).toBeCloseTo(30, 6)
    expect(b1.min[0]).toBeCloseTo(-10, 6)
    expect(b1.max[0]).toBeCloseTo(10, 6)
  })

  it('mate 悬空实体：mesh 快照缺 axis 的圆柱面 → E_TOPO_NOT_FOUND（不静默）', async () => {
    const code = `
      const part0 = cad.box(20, 20, 20, { centered: true })
      const part1 = cad.box(20, 20, 20, { centered: true, at: [40, 0, 0] })
      let asm0 = cad.assembly({ name: 'C', members: [part0, part1], constraints: [
        { type: 'concentric',
          a: { part: 'part0', face: { surfaceType: 'cylinder', center: [0, 0, 0], normal: [0, 0, 1] } },
          b: { part: 'part1', face: { surfaceType: 'cylinder', center: [40, 0, 0], normal: [0, 0, 1] } } },
      ] })
      asm0.do_assemble()
    `
    const result = await runtime.execute(code, { topology: 'auto' })
    expect(result.failedAt).toBeDefined()
    expect(result.failedAt?.code).toBe('E_TOPO_NOT_FOUND')
  })
})
