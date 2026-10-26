/**
 * smlib-kernel/smlib-p4-compat — P4 三引擎一致性验收（smlib ↔ occt）
 *
 * 方案 §4.4 一致性钉：T1（solid 精确）+ T2（band ≤1e-3 起步）+ 双钉
 * （box 6000/2200、cylinder 250π、sphere 523.599）。本测试直接对比
 * smlib L1 与 occt L1 的图元/布尔度量，容差沿用 engine-compat harness 的
 * DEFAULT_TOL（volume/area 1e-3、bbox 1e-4）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { resetSmlibWasm } from '../../src/smlib-kernel/smlibWasm'
import { createOcctPrimitives } from '../../src/occt-kernel/occt-primitives'
import type { BrepEngineApi, BrepHandle } from '../../src/brep/engine/primitives'

let smlib!: SmlibPrimitives
let occt!: BrepEngineApi

beforeAll(async () => {
  smlib = await createSmlibPrimitives()
  occt = await createOcctPrimitives()
})

afterAll(() => {
  disposeSmlib()
  resetSmlibWasm()
})

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(a), 1e-9)
}

function assertRel(name: string, ref: number, got: number, tol: number): void {
  const d = rel(ref, got)
  expect(d, `${name} ref=${ref} got=${got} dev=${d.toExponential(3)}`).toBeLessThanOrEqual(tol)
}

/** bbox 用绝对容差：smlib loose bbox 有 ±2e-5 误差（方案 §4.4），ref=0 时相对偏差无意义。 */
function assertBboxAbs(name: string, ref: number, got: number, tol = 1e-3): void {
  const d = Math.abs(ref - got)
  expect(d, `${name} ref=${ref} got=${got} absDev=${d.toExponential(3)}`).toBeLessThanOrEqual(tol)
}

/** 双引擎 box 指标（方案 §4.4 锚：volume=6000 / area=2200 / 6 面 / 12 边）。 */
function boxMetrics(k: BrepEngineApi, s: BrepHandle) {
  return {
    volume: k.getVolume(s),
    area: k.getSurfaceArea(s),
    faces: k.getSubShapes(s, 'face').length,
    edges: k.getSubShapes(s, 'edge').length,
    bb: k.getBoundingBox(s),
  }
}

describe('P4 三引擎一致性（smlib ↔ occt）', () => {
  it('T2 box(10,20,30)：体积/面积/bbox 双引擎收敛（band 1e-3）', () => {
    const m1 = boxMetrics(smlib, smlib.makeBox(10, 20, 30))
    const m2 = boxMetrics(occt, occt.makeBox(10, 20, 30))
    // 各自锚定
    expect(m1.volume).toBeCloseTo(6000, 2)
    expect(m1.area).toBeCloseTo(2200, 2)
    // 收敛
    assertRel('box.volume', m2.volume, m1.volume, 1e-3)
    assertRel('box.area', m2.area, m1.area, 1e-3)
    for (const axis of ['x', 'y', 'z'] as const) {
      assertBboxAbs(`box.${axis}min`, m2.bb[`${axis}min` as keyof typeof m2.bb] as number, m1.bb[`${axis}min` as keyof typeof m1.bb] as number)
      assertBboxAbs(`box.${axis}max`, m2.bb[`${axis}max` as keyof typeof m2.bb] as number, m1.bb[`${axis}max` as keyof typeof m1.bb] as number)
    }
  })

  it('T1 box 拓扑：双引擎均 6 面 / 12 边', () => {
    const m1 = boxMetrics(smlib, smlib.makeBox(10, 20, 30))
    const m2 = boxMetrics(occt, occt.makeBox(10, 20, 30))
    expect(m1.faces).toBe(6)
    expect(m1.edges).toBe(12)
    expect(m2.faces).toBe(6)
    expect(m2.edges).toBe(12)
  })

  it('T2 cylinder(r=5,h=10)：体积 ≈250π 双引擎收敛', () => {
    const v1 = smlib.getVolume(smlib.makeCylinder(5, 10))
    const v2 = occt.getVolume(occt.makeCylinder(5, 10))
    expect(v1).toBeCloseTo(250 * Math.PI, 2)
    assertRel('cylinder.volume', v2, v1, 1e-3)
  })

  it('T2 sphere(r=5)：体积 ≈523.599 双引擎收敛', () => {
    const v1 = smlib.getVolume(smlib.makeSphere(5))
    const v2 = occt.getVolume(occt.makeSphere(5))
    expect(v1).toBeCloseTo((4 / 3) * Math.PI * 125, 2)
    assertRel('sphere.volume', v2, v1, 1e-3)
  })

  it('T2 布尔并集：重叠 box 并集体积双引擎收敛', () => {
    const u1 = smlib.fuse(smlib.translate(smlib.makeBox(10, 20, 30), 5, 0, 0), smlib.makeBox(10, 20, 30))
    const u2 = occt.fuse(occt.translate(occt.makeBox(10, 20, 30), 5, 0, 0), occt.makeBox(10, 20, 30))
    assertRel('fuse.volume', occt.getVolume(u2), smlib.getVolume(u1), 1e-3)
  })

  it('T2 布尔差集：重叠 box 差集体积双引擎收敛', () => {
    const c1 = smlib.cut(smlib.translate(smlib.makeBox(10, 20, 30), 5, 0, 0), smlib.makeBox(10, 20, 30))
    const c2 = occt.cut(occt.translate(occt.makeBox(10, 20, 30), 5, 0, 0), occt.makeBox(10, 20, 30))
    assertRel('cut.volume', occt.getVolume(c2), smlib.getVolume(c1), 1e-3)
  })
})
