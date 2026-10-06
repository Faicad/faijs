/**
 * brep-mirror-g2.test — Phase 3（core-decouple §5.4）G2 自有化实现行为验证
 *
 * 覆盖 7 个 selfhost op（topology/operations 分片）：
 *   boolean：fuse / split
 *   compound：drill / pocket / boss / mirrorJoin
 *   hull：convexHull
 *
 * 两层验证：
 *   1. 单元层：直接调用 api/brep-mirror/* 自有实现（BrepHandle 层）
 *   2. 生成层：经 generated/topology + generated/operations 的 defineOp 接线
 *
 * 运行：npx vitest run src/api/brep-mirror/brep-mirror-g2.test.ts
 */

// ─── OCCT stdout 噪声过滤（与 G1 同策略） ───
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
import { fromBrep, brepOf } from '../../../src/shape'
import type { SolidShape } from '../../../src/shape'
import type { Shape } from '../../../src/mesh/types'
import { solidToShape } from '../../../src/brep/brep-ops'
import { getSolidBoundingBox } from '../../../src/brep/brep-utils'

import { fuseBrep, splitBrep } from '../../../src/api/brep-mirror/booleanFns'
import { drillBrep, pocketBrep, bossBrep, mirrorJoinBrep } from '../../../src/api/brep-mirror/compoundFns'
import { convexHullBrep } from '../../../src/api/brep-mirror/hullFns'

import { fuse, split } from '../../../src/api/generated/topology'
import { drill, pocket, boss, mirrorJoin, convexHull } from '../../../src/api/generated/operations'

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

/** 构造 box（10×20×30，原点对齐）的 Shape。 */
function boxShape(): SolidShape {
  const handle = kernel.makeBox(10, 20, 30)
  return fromBrep(solidToShape(kernel, handle), { solid: handle })
}

/** 从 Shape 取句柄。 */
function hOf(shape: Shape): BrepHandle {
  return brepOf(shape) as BrepHandle
}

/** Solid 有效性：从 Shape 取 brep 句柄，可三角化 + 非空包围盒。 */
function expectValidSolid(shape: Shape, tag: string): void {
  const handle = brepOf(shape) as BrepHandle
  const mesh = solidToShape(kernel, handle)
  expect(mesh.positions.length, `${tag}: positions 非空`).toBeGreaterThan(0)
  expect(mesh.indices.length, `${tag}: indices 非空`).toBeGreaterThan(0)
  const bb = getSolidBoundingBox(kernel, handle)
  expect(bb.max[0] - bb.min[0], `${tag}: bbox 非退化`).toBeGreaterThan(0)
}

/** 构造 brepjs 形态 Wire 包装（{wrapped}），供 pocket/boss 的 profile 用。
 * 取最低 Z 面（z=0）的 outer wire：profile 需在 XY 平面（z=0），
 * 实现内部会 translate 到目标面质心——vendored sketchOnPlane('XY') 等价。 */
function wireOf(shape: Shape, idx = 0): { wrapped: BrepHandle } {
  const faces = kernel.getSubShapes(hOf(shape), 'face')
  let best = faces[0]
  let bestZ = kernel.surfaceCenterOfMass(best).z
  for (let i = 1; i < faces.length; i++) {
    const z = kernel.surfaceCenterOfMass(faces[i]).z
    if (z < bestZ) {
      best = faces[i]
      bestZ = z
    }
  }
  const wires = kernel.getSubShapes(best, 'wire')
  return { wrapped: wires[idx] }
}

// ===========================================================================
// 单元层：自有实现直连
// ===========================================================================

describe('G2 单元层（brep-mirror 自有实现）', () => {
  it('fuseBrep：两 box 融合为单 solid（体积≈和）', () => {
    const a = boxShape()
    const b = boxShape()
    const h = fuseBrep(a, b)
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    // 两 box 完全重叠 → 融合体积 = 单 box（6000）
    const vol = kernel.getVolume(handle)
    expect(vol).toBeCloseTo(10 * 20 * 30, 3)
    kernel.release(handle)
  })

  it('splitBrep：box 被 tool 分割为非空产物', () => {
    const src = boxShape()
    const tool = boxShape()
    const h = splitBrep(src, [tool])
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    // split 产物为 compound：可三角化且非空
    const mesh = solidToShape(kernel, handle)
    expect(mesh.positions.length).toBeGreaterThan(0)
    kernel.release(handle)
  })

  it('splitBrep：空 tools 原样返回', () => {
    const src = boxShape()
    const h = splitBrep(src, [])
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    expect(handle).toBe(hOf(src))
  })

  it('convexHullBrep：4 个非共面点产出 solid', () => {
    const h = convexHullBrep([
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ])
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    expect(kernel.getVolume(handle)).toBeGreaterThan(0)
    kernel.release(handle)
  })

  it('convexHullBrep：少于 4 点返回 HULL_EMPTY_INPUT', () => {
    const h = convexHullBrep([
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
    ])
    expect(h.ok).toBe(false)
    expect((h as { error: { code: string } }).error.code).toBe('HULL_EMPTY_INPUT')
  })

  it('drillBrep：box 打穿洞后 bbox 不变、体积减小', () => {
    const src = boxShape()
    const v0 = kernel.getVolume(hOf(src))
    const h = drillBrep(src, { at: [5, 10, 0], radius: 2 })
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, handle)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10)
    expect(kernel.getVolume(handle)).toBeLessThan(v0)
    kernel.release(handle)
  })

  it('pocketBrep：box 顶面开槽后体积减小', () => {
    const src = boxShape()
    const profile = boxShape()
    const wire = wireOf(profile)
    const v0 = kernel.getVolume(hOf(src))
    const h = pocketBrep(src, { profile: wire, depth: 5 })
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    expect(kernel.getVolume(handle)).toBeLessThan(v0)
    kernel.release(handle)
    kernel.release(hOf(profile))
  })

  it('bossBrep：box 顶面加高后体积增大', () => {
    const src = boxShape()
    const profile = boxShape()
    const wire = wireOf(profile)
    const v0 = kernel.getVolume(hOf(src))
    const h = bossBrep(src, { profile: wire, height: 5 })
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    expect(kernel.getVolume(handle)).toBeGreaterThan(v0)
    kernel.release(handle)
    kernel.release(hOf(profile))
  })

  it('mirrorJoinBrep：镜像融合后对称（X 方向尺寸翻倍）', () => {
    const src = boxShape()
    // 镜像平面 x=0：box[0,10] 镜像到 [-10,0] → fuse 后 [-10,10]
    const h = mirrorJoinBrep(src, { normal: [1, 0, 0], at: [0, 0, 0] })
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, handle)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20)
    kernel.release(handle)
  })
})

// ===========================================================================
// 生成层：generated defineOp selfhost 接线
// ===========================================================================

describe('G2 生成层（generated defineOp selfhost 接线）', () => {
  it('fuse / split：投影 op 产出有效 Shape', async () => {
    const a = boxShape()
    const b = boxShape()
    const f = await fuse(a, b)
    expectValidSolid(f, 'fuse-op')
    const sp = await split(a, [b])
    expectValidSolid(sp, 'split-op')
  })

  it('drill / convexHull：投影 op 产出有效 Shape', async () => {
    const src = boxShape()
    const d = await drill(src, { at: [5, 10, 0], radius: 2 })
    expectValidSolid(d, 'drill-op')
    const ch = await convexHull([
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ])
    expectValidSolid(ch, 'convexHull-op')
  })

  it('pocket / boss / mirrorJoin：投影 op 产出有效 Shape', async () => {
    const src = boxShape()
    const profile = boxShape()
    const wire = wireOf(profile)
    const p = await pocket(src, { profile: wire, depth: 5 })
    expectValidSolid(p, 'pocket-op')
    const bs = await boss(src, { profile: wire, height: 5 })
    expectValidSolid(bs, 'boss-op')
    const mj = await mirrorJoin(src, { normal: [1, 0, 0], at: [0, 0, 0] })
    expectValidSolid(mj, 'mirrorJoin-op')
    kernel.release(hOf(profile))
  })
})
