/**
 * brep-mirror-g3.test — Phase 3（core-decouple §5.4）G3 自有化实现行为验证
 *
 * 覆盖 8 个 selfhost op：
 *   topology：rotate / shell / offset
 *   operations：extrude / revolve / sweep / complexExtrude / twistExtrude
 *
 * 单元层直调 api/brep-mirror/*，生成层经 generated defineOp 接线（各 1 例）。
 *
 * 运行：npx vitest run src/api/brep-mirror/brep-mirror-g3.test.ts
 */

// ─── OCCT stdout 噪声过滤（与 G1/G2 同策略） ───
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
import { registerOcctBrepEngine } from '../../brep/engine/adapters/occt'
import { getBrepEngine } from '../../brep/engine/registry'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../runtime-state'
import { getBrepApi } from '../../brep/handle-bridge'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import { fromBrep, brepOf } from '../../shape'
import type { SolidShape } from '../../shape'
import type { Shape } from '../../mesh/types'
import { solidToShape } from '../../brep/brep-ops'
import { getSolidBoundingBox } from '../../brep/brep-utils'

import { rotateBrep, shellBrep, offsetBrep } from './topologyFns'
import { extrudeBrep, revolveBrep, sweepBrep, complexExtrudeBrep, twistExtrudeBrep } from './sweepFns'

import { rotate, shell, offset } from '../generated/topology'
import { extrude, revolve } from '../generated/operations'

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

function boxShape(): SolidShape {
  const handle = kernel.makeBox(10, 20, 30)
  return fromBrep(solidToShape(kernel, handle), { solid: handle })
}

function hOf(shape: Shape): BrepHandle {
  return brepOf(shape) as BrepHandle
}

function expectValidSolid(shape: Shape, tag: string): void {
  const handle = brepOf(shape) as BrepHandle
  const mesh = solidToShape(kernel, handle)
  expect(mesh.positions.length, `${tag}: positions 非空`).toBeGreaterThan(0)
  expect(mesh.indices.length, `${tag}: indices 非空`).toBeGreaterThan(0)
  const bb = getSolidBoundingBox(kernel, handle)
  expect(bb.max[0] - bb.min[0], `${tag}: bbox 非退化`).toBeGreaterThan(0)
}

/** 闭合方框 wire（XY 平面，z=0）。 */
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

// ===========================================================================
// 单元层
// ===========================================================================

describe('G3 单元层（brep-mirror 自有实现）', () => {
  it('extrudeBrep：面 + Vec3 拉伸 → 体积正确', () => {
    const face = kernel.makeRectangle(10, 20)
    const r = extrudeBrep({ wrapped: face }, [0, 0, 30])
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    expect(kernel.getVolume(h)).toBeCloseTo(10 * 20 * 30, 3)
    kernel.release(h)
  })

  it('extrudeBrep：高度 number → [0,0,h]', () => {
    const face = kernel.makeRectangle(10, 20)
    const r = extrudeBrep({ wrapped: face }, 15)
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    expect(kernel.getVolume(h)).toBeCloseTo(10 * 20 * 15, 3)
    kernel.release(h)
  })

  it('revolveBrep：面绕 x 轴整圈 → 柱环', () => {
    const face = kernel.makeRectangle(10, 5)
    // 矩形 x∈[0,10]、y∈[0,5] 绕 x 轴 → 实心柱：x∈[0,10]、半径 5
    const r = revolveBrep({ wrapped: face }, { axis: [1, 0, 0] })
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, h)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10, 1)
    expect(Math.abs(bb.max[2] - bb.min[2]) / 2).toBeCloseTo(5, 1)
    kernel.release(h)
  })

  it('rotateBrep：box 绕 z 轴 180° → bbox 不变', () => {
    const src = boxShape()
    const r = rotateBrep(src, 180, { at: [0, 0, 0], axis: [0, 0, 1] })
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, h)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10, 3)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20, 3)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(30, 3)
    kernel.release(h)
  })

  it('offsetBrep：box 外偏 1 → 体积增大', () => {
    const src = boxShape()
    const v0 = kernel.getVolume(hOf(src))
    const r = offsetBrep(src, 1)
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const vol = kernel.getVolume(h)
    expect(vol).toBeGreaterThan(v0)
    // 粗略下界：外扩 1 后 ≥ 12×22×32 = 8448
    expect(vol).toBeGreaterThan(10 * 20 * 30 + 100)
    kernel.release(h)
  })

  it('shellBrep：box 去顶面掏空 → 体积减小', () => {
    const src = boxShape()
    const faces = kernel.getSubShapes(hOf(src), 'face')
    // 找最高 Z 面（顶面）
    let top = faces[0]
    let bestZ = kernel.surfaceCenterOfMass(top).z
    for (let i = 1; i < faces.length; i++) {
      const z = kernel.surfaceCenterOfMass(faces[i]).z
      if (z > bestZ) {
        top = faces[i]
        bestZ = z
      }
    }
    const v0 = kernel.getVolume(hOf(src))
    const r = shellBrep(src, [{ wrapped: top }], 2)
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    const vol = kernel.getVolume(h)
    expect(vol).toBeLessThan(v0)
    expect(vol).toBeGreaterThan(0)
    kernel.release(h)
  })

  it('sweepBrep：方框 wire 沿直线 spine 扫掠 → 体积正确', () => {
    const wire = boxWire()
    const spineEdge = kernel.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 50 })
    const spine = kernel.makeWire([spineEdge])
    kernel.release(spineEdge)
    const r = sweepBrep({ wrapped: wire.wrapped }, { wrapped: spine }, {}, false)
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    expect(kernel.getVolume(h)).toBeCloseTo(10 * 10 * 50, 2)
    kernel.release(h)
    kernel.release(spine)
    kernel.release(wire.wrapped)
  })

  it('complexExtrudeBrep：wire 沿 normal 挤出 → 体积正确', () => {
    const wire = boxWire()
    const r = complexExtrudeBrep(wire, [0, 0, 0], [0, 0, 25])
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    expect(kernel.getVolume(h)).toBeCloseTo(10 * 10 * 25, 2)
    kernel.release(h)
    kernel.release(wire.wrapped)
  })

  it('twistExtrudeBrep：wire 扭转 90° 挤出 → 体积正确', () => {
    const wire = boxWire()
    const r = twistExtrudeBrep(wire, 90, [0, 0, 0], [0, 0, 25])
    expect(r.ok).toBe(true)
    const h = (r as { ok: true; value: BrepHandle }).value
    expect(kernel.getVolume(h)).toBeCloseTo(10 * 10 * 25, 2)
    kernel.release(h)
    kernel.release(wire.wrapped)
  })

  it('twistExtrudeBrep：负角度 → TWIST_NEGATIVE_ANGLE_UNSUPPORTED', () => {
    const wire = boxWire()
    const r = twistExtrudeBrep(wire, -90, [0, 0, 0], [0, 0, 25])
    expect(r.ok).toBe(false)
    expect((r as { error: { code: string } }).error.code).toBe('TWIST_NEGATIVE_ANGLE_UNSUPPORTED')
    kernel.release(wire.wrapped)
  })
})

// ===========================================================================
// 生成层
// ===========================================================================

describe('G3 生成层（generated defineOp selfhost 接线）', () => {
  it('extrude / revolve：投影 op 产出有效 Shape', async () => {
    const face = kernel.makeRectangle(10, 20)
    const e = await extrude({ wrapped: face }, [0, 0, 30])
    expectValidSolid(e, 'extrude-op')
    const f2 = kernel.makeRectangle(10, 5)
    const rv = await revolve({ wrapped: f2 }, {})
    expectValidSolid(rv, 'revolve-op')
  })

  it('rotate / shell / offset：投影 op 产出有效 Shape', async () => {
    const src = boxShape()
    const rt = await rotate(src, 180, { at: [0, 0, 0], axis: [0, 0, 1] })
    expectValidSolid(rt, 'rotate-op')
    const of = await offset(src, 1)
    expectValidSolid(of, 'offset-op')
    const faces = kernel.getSubShapes(hOf(src), 'face')
    let top = faces[0]
    let bestZ = kernel.surfaceCenterOfMass(top).z
    for (let i = 1; i < faces.length; i++) {
      const z = kernel.surfaceCenterOfMass(faces[i]).z
      if (z > bestZ) {
        top = faces[i]
        bestZ = z
      }
    }
    const sh = await shell(src, [{ wrapped: top }], 2)
    expectValidSolid(sh, 'shell-op')
  })
})
