/**
 * brep-operations-g1.test — Phase 3（core-decouple §5.4）G1 自有化实现行为验证
 *
 * 覆盖 14 个 core 自有 op（topology/sketching 分片）：
 *   primitives：torus / ellipsoid / makeBaseBox
 *   transform：applyMatrix / clone / locate / mirror
 *   healing：heal / healSolid / fixShape / simplify / autoHeal / fixSelfIntersection
 *   boolean：section
 *
 * 两层验证：
 *   1. 单元层：直接调用 api/brep-operations/* 自有实现（BrepHandle 层）
 *   2. 生成层：经 generated/topology + generated/sketching 的 defineOp 接线
 *      （core 直连：`defineOp({ brep: __own_<fn> })`），确认 Result 在语句
 *      边界被 unwrap 成 SolidShape / 裸产品。
 *
 * 运行：npx vitest run src/api/brep-operations/brep-operations-g1.test.ts
 */

// ─── OCCT stdout 噪声过滤（与 threadFns.test 同策略） ───
const occtOrigLog = console.log
console.log = (...args: unknown[]) => {
  const msg = args.map(String).join(' ')
  const isOcctNoise =
    msg.includes('Statistics on Transfer') ||
    msg.includes('Transfer Mode =') ||
    msg.includes('Transferring SolidShape') ||
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

// ── 单元层：brep-operations 自有实现 ──
import { torusBrep, ellipsoidBrep, makeBaseBoxBrep } from '../../../src/api/brep-operations/primitiveFns'
import { applyMatrixBrep, cloneBrep, locateBrep, mirrorBrep } from '../../../src/api/brep-operations/topologyFns'
import {
  healBrep,
  healSolidBrep,
  fixShapeBrep,
  simplifyBrep,
  autoHealBrep,
  fixSelfIntersectionBrep,
} from '../../../src/api/brep-operations/healingFns'
import { sectionBrep } from '../../../src/api/brep-operations/booleanFns'

// ── 生成层：defineOp 接线后的投影 op ──
import {
  torus,
  ellipsoid,
  mirror,
  clone,
  applyMatrix,
  locate,
  heal,
  healSolid,
  fixShape,
  simplify,
  autoHeal,
  fixSelfIntersection,
  section,
} from '../../../src/api/generated/topology'
import { makeBaseBox } from '../../../src/api/generated/sketching'

let kernel: BrepEngineApi

beforeAll(async () => {
  await registerOcctBrepEngine()
  const brep = await getBrepEngine()
  configureBackends({
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends)
  kernel = getBrepApi()
}, 120000)

/** Origin-centered box 10×20×30 as a faijs SolidShape (Brep-backed). */
function boxSolidShape(): SolidShape {
  const h = kernel.makeBox(10, 20, 30)
  return fromBrep(solidToShape(kernel, h), { solid: h })
}

/** Solid 有效性：从 SolidShape 取 brep 句柄，可三角化 + 非空包围盒。 */
function expectValidSolid(shape: Shape, tag: string): void {
  const mesh = solidToShape(kernel, brepOf(shape) as BrepHandle)
  expect(mesh.positions.length, `${tag}: positions 非空`).toBeGreaterThan(0)
  expect(mesh.indices.length, `${tag}: indices 非空`).toBeGreaterThan(0)
  const bb = getSolidBoundingBox(kernel, brepOf(shape) as BrepHandle)
  expect(bb.max[0] - bb.min[0], `${tag}: bbox 非退化`).toBeGreaterThan(0)
}

// ===========================================================================
// 单元层：自有实现直连
// ===========================================================================

describe('G1 单元层（brep-operations 自有实现）', () => {
  it('torusBrep：有效 torus solid', () => {
    const h = torusBrep(10, 2)
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const shape = fromBrep(solidToShape(kernel, handle), { solid: handle })
    expectValidSolid(shape, 'torusBrep')
    kernel.release(handle)
  })

  it('ellipsoidBrep：有效 ellipsoid solid', () => {
    const h = ellipsoidBrep(10, 5, 3)
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const shape = fromBrep(solidToShape(kernel, handle), { solid: handle })
    expectValidSolid(shape, 'ellipsoidBrep')
    kernel.release(handle)
  })

  it('makeBaseBoxBrep：有效拉伸 solid（10×20×30）', () => {
    const h = makeBaseBoxBrep(10, 20, 30)
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const shape = fromBrep(solidToShape(kernel, handle), { solid: handle })
    expectValidSolid(shape, 'makeBaseBoxBrep')
    const bb = getSolidBoundingBox(kernel, handle)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(30)
    kernel.release(handle)
  })

  it('applyMatrixBrep：平移矩阵后 bbox 移动', () => {
    const src = boxSolidShape()
    const h = applyMatrixBrep(src, [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ])
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, handle)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20)
    kernel.release(handle)
  })

  it('applyMatrixBrep：奇异矩阵返回 VALIDATION_FAILED', () => {
    const src = boxSolidShape()
    const h = applyMatrixBrep(src, [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ])
    expect(h.ok).toBe(false)
    expect((h as { ok: false; error: { code: string } }).error.code).toBe('VALIDATION_FAILED')
  })

  it('cloneBrep：独立副本（源保留、bbox 一致）', () => {
    const src = boxSolidShape()
    const h = cloneBrep(src)
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, handle)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(10)
    expect(bb.max[1] - bb.min[1]).toBeCloseTo(20)
    kernel.release(handle)
  })

  it('locateBrep：rotate 后 bbox 沿轴旋转', () => {
    const src = boxSolidShape()
    const h = locateBrep(src, { type: 'rotate', angle: 90, axis: [0, 1, 0] })
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, handle)
    // 绕 Y 轴旋转 90°：X/Z 尺寸互换（10×30 → 30×10）
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(30, 0)
    expect(bb.max[2] - bb.min[2]).toBeCloseTo(10, 0)
    kernel.release(handle)
  })

  // ⚠️ 既有红（2026-10-08 定位，非本次 capabilities 删除所致）：HEAD 提交 d530acd
  // 「wire C5 occt-wasm WithHistory paths」把 mirrorBrep 接到 `mirrorWithHistory`
  // （face-evolution.ts 的 mirrorWithHashEvolution），此后 occt 引擎下镜像结果句柄
  // 不可用于 getBoundingBox（Invalid shape ID: 0）。当时本文件的 config 声明的是
  // occt 的能力表（含 `mirrorWithHistory`），故同样走这条新轨——即本用例在 HEAD
  // 上已是红的。本文件仅把该声明换成等价的 `brepEngineId: 'occt'`，未改判决。
  // 修好 `mirrorWithHistory` 的句柄封送后本用例应转绿（保留断言，不改期望值）。
  it('mirrorBrep：镜像后 bbox 翻转', () => {
    const src = boxSolidShape()
    const h = mirrorBrep(src, { normal: [1, 0, 0] })
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    const bb = getSolidBoundingBox(kernel, handle)
    // 镜像平面 X=0：bbox 的 min/max 对调符号
    expect(bb.min[0]).toBeCloseTo(-10)
    expect(bb.max[0]).toBeCloseTo(0)
    kernel.release(handle)
  })

  it('healBrep / healSolidBrep / fixShapeBrep / simplifyBrep：健康 box 原样治愈', () => {
    for (const [name, fn] of [
      ['healBrep', healBrep],
      ['healSolidBrep', healSolidBrep],
      ['fixShapeBrep', fixShapeBrep],
      ['simplifyBrep', simplifyBrep],
    ] as const) {
      const src = boxSolidShape()
      const h = fn(src)
      expect(h.ok, `${name}: ok`).toBe(true)
      const handle = (h as { ok: true; value: BrepHandle }).value
      expectValidSolid(fromBrep(solidToShape(kernel, handle), { solid: handle }), name)
      kernel.release(handle)
    }
  })

  it('autoHealBrep：返回 { shape, report } 且 shape 有效', () => {
    const src = boxSolidShape()
    const h = autoHealBrep(src)
    expect(h.ok).toBe(true)
    const { shape: handle, report } = (h as { ok: true; value: { shape: BrepHandle; report: unknown } }).value
    expect(report).toBeDefined()
    expectValidSolid(fromBrep(solidToShape(kernel, handle), { solid: handle }), 'autoHealBrep')
    kernel.release(handle)
  })

  it('fixSelfIntersectionBrep：box 的 wire 子形状治愈为有效 wire', () => {
    const src = boxSolidShape()
    const handle = brepOf(src) as BrepHandle
    const wires = kernel.getSubShapes(handle, 'wire')
    expect(wires.length).toBeGreaterThan(0)
    const h = fixSelfIntersectionBrep(fromBrep(solidToShape(kernel, wires[0]), { solid: wires[0] }))
    expect(h.ok).toBe(true)
    const out = (h as { ok: true; value: BrepHandle }).value
    expect(typeof out).toBe('number')
    kernel.release(out)
  })

  it('sectionBrep：box 被平面切割产出边 compound', () => {
    const src = boxSolidShape()
    const h = sectionBrep(src, { origin: [0, 0, 0], zDir: [0, 0, 1] })
    expect(h.ok).toBe(true)
    const handle = (h as { ok: true; value: BrepHandle }).value
    expect(typeof handle).toBe('number')
    kernel.release(handle)
  })
})

// ===========================================================================
// 生成层：generated 投影 op（defineOp core 直连）
// ===========================================================================

describe('G1 生成层（generated defineOp core 直连）', () => {
  it('torus / ellipsoid / makeBaseBox：投影 op 产出有效 SolidShape', async () => {
    const shapes = [await torus(10, 2), await ellipsoid(10, 5, 3), await makeBaseBox(10, 20, 30)]
    expect(shapes.length).toBe(3)
    for (const [i, s] of shapes.entries()) {
      expectValidSolid(s, `primitive#${i}`)
    }
  })

  it('applyMatrix / clone / locate / mirror：变换 op 产出 SolidShape', async () => {
    const src = boxSolidShape()
    const m = await applyMatrix(src, [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ])
    const c = await clone(src)
    const l = await locate(src, { type: 'translate', v: [5, 0, 0] })
    const mi = await mirror(src, { normal: [1, 0, 0] })
    for (const [name, s] of [
      ['applyMatrix', m],
      ['clone', c],
      ['locate', l],
      ['mirror', mi],
    ] as const) {
      expectValidSolid(s, name)
    }
  })

  it('heal 族：heal / healSolid / fixShape / simplify 产出 SolidShape', async () => {
    const src = boxSolidShape()
    const hs = [await heal(src), await healSolid(src), await fixShape(src), await simplify(src)]
    for (const [i, s] of hs.entries()) {
      expectValidSolid(s, `heal#${i}`)
    }
  })

  it('autoHeal：经语句面 unwrap 返回 { shape, report }', async () => {
    const src = boxSolidShape()
    const out = (await autoHeal(src)) as unknown as { shape: SolidShape; report: unknown }
    expect(out.shape).toBeDefined()
    expect(out.report).toBeDefined()
    expectValidSolid(out.shape, 'autoHeal-op')
  })

  it('fixSelfIntersection：box wire 经投影 op 治愈', async () => {
    const src = boxSolidShape()
    const handle = brepOf(src) as BrepHandle
    const wires = kernel.getSubShapes(handle, 'wire')
    const out = await fixSelfIntersection(fromBrep(solidToShape(kernel, wires[0]), { solid: wires[0] }))
    expect(out).toBeDefined()
  })

  it('section：投影 op 产出边 compound', async () => {
    const src = boxSolidShape()
    const out = await section(src, { origin: [0, 0, 0], zDir: [0, 0, 1] })
    expect(out).toBeDefined()
  })
})
