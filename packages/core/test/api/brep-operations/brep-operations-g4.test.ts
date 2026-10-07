/**
 * brep-operations-g4.test — Phase 3（core-decouple §5.4）G4 自有化实现行为验证
 *
 * 覆盖 6 个 core 自有 op：
 *   pattern：linearPattern / circularPattern / gridPattern / rectangularPattern
 *   roof（straightSkeleton 迁移）/ thread（收敛至 core threadBrep）
 *
 * 运行：npx vitest run src/api/brep-operations/brep-operations-g4.test.ts
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
import { getSolidBoundingBox } from '../../../src/brep/brep-utils'

import { linearPatternBrep, circularPatternBrep, gridPatternBrep, rectangularPatternBrep } from '../../../src/api/brep-operations/patternFns'
import { roofBrep } from '../../../src/api/brep-operations/roofFns'
import { threadBrepOp } from '../../../src/api/brep-operations/threadFns'

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

function boxHandle(): BrepHandle {
  return kernel.makeBox(10, 20, 30)
}

/** 闭合方框 wire（XY 平面，z=0，10×10）。 */
function boxWire(): { wrapped: BrepHandle } {
  const pts: [number, number, number][] = [
    [-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0],
  ]
  const edges = pts.map((p, i) =>
    kernel.makeLineEdge(
      { x: p[0], y: p[1], z: p[2] },
      { x: pts[(i + 1) % 4][0], y: pts[(i + 1) % 4][1], z: pts[(i + 1) % 4][2] },
    ),
  )
  const w = kernel.makeWire(edges)
  for (const e of edges) kernel.release(e)
  return { wrapped: w }
}

describe('G4 单元层（brep-operations 自有实现）', () => {
  it('linearPatternBrep：3 个 box 沿 X 方向（间距 15）→ bbox X 宽 40', () => {
    const s = boxHandle()
    const r = linearPatternBrep({ wrapped: s }, [1, 0, 0], 3, 15)
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, h)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10 + 2 * 15, 1)
    kernel.release(h)
    kernel.release(s)
  })

  it('circularPatternBrep：4 个 box 绕 z 整圈 → 对称、bbox 直径合理', () => {
    const s = kernel.makeBox(10, 10, 5)
    const r = circularPatternBrep({ wrapped: s }, [0, 0, 1], 4, 360, [0, 0, 0])
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, h)
    // 4 个 10×10 box 绕原点 90° 分布 → 外接半径 √(5²+5²)≈7.07
    expect(Math.abs(bb.max[0] - bb.min[0]) / 2).toBeGreaterThan(6)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(5, 3)
    kernel.release(h)
    kernel.release(s)
  })

  it('gridPatternBrep：2×2 网格 → bbox 双向扩展', () => {
    const s = boxHandle()
    const r = gridPatternBrep({ wrapped: s }, [1, 0, 0], [0, 1, 0], 2, 2, 15, 25)
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, h)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10 + 15, 1)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20 + 25, 1)
    kernel.release(h)
    kernel.release(s)
  })

  it('rectangularPatternBrep：options 2×2 → bbox 双向扩展', () => {
    const s = boxHandle()
    const r = rectangularPatternBrep(
      { wrapped: s },
      { xDir: [1, 0, 0], xCount: 2, xSpacing: 15, yDir: [0, 1, 0], yCount: 2, ySpacing: 25 },
    )
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, h)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10 + 15, 1)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20 + 25, 1)
    kernel.release(h)
    kernel.release(s)
  })

  it('roofBrep：10×10 方框 wire → 实体、脊线抬起', () => {
    const wire = boxWire()
    const r = roofBrep(wire, { angle: 45 })
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, h)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10, 1)
    // 45° 坡度：脊线高 = 5（中心到边 5）
    expect(bb.max[2]).toBeGreaterThan(3)
    kernel.release(h)
    kernel.release(wire.wrapped)
  })

  it('threadBrepOp：外螺纹 ridge fuse 螺杆 → 体积增大', () => {
    const r = threadBrepOp({ radius: 6, pitch: 2.5, height: 7.5 })
    expect(r.ok).toBe(true)
    const ridge = (r as { ok: true; value: BrepHandle }).value
    const rod = kernel.makeCylinder(6.15, 7.5)
    const fused = kernel.fuse(rod, ridge)
    const volRod = kernel.getVolume(rod)
    const volFused = kernel.getVolume(fused)
    expect(volFused).toBeGreaterThan(volRod)
    kernel.release(rod)
    kernel.release(ridge)
    kernel.release(fused)
  })
})
