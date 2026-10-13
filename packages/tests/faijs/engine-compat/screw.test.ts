/**
 * screw.test.ts — 螺钉 brepkit ↔ occt 一致性（方案 §6.7 / §6.3）
 *
 * 分类：零缺口（`['occt','brepkit']`）。螺钉头型/杆部构造仅用 L1 兼容原语
 * （revolveProfile / planarFace / extrudeFace / cut / fuse / translate / mirror /
 *  makeArcEdge / makeSolid），brepkit 经 harness 适配即可建模。圆弧离散带来系统性
 * 小体积偏差，按 §6.3 双钉钉入 band（实测后收紧）。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts faijs/engine-compat/screw.test.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, buildOn, assertConsistent, type Toleration } from './harness'
import { buildScrew } from '../../../faijs-fasteners/src/screw'
import type { ScrewClassName, ScrewParams } from '../../../faijs-fasteners/src/screw'
import type { BrepHandle } from '../../../core/src/brep/engine/primitives'

interface Fixture {
  name: string
  className: ScrewClassName
  params: ScrewParams
}

const fixtures: Fixture[] = [
  { name: 'HexHeadScrew M6-1 L20 iso4017', className: 'HexHeadScrew', params: { size: 'M6-1', length: 20, fastener_type: 'iso4017' } },
  { name: 'CounterSunkScrew M6-1 L20 iso10642', className: 'CounterSunkScrew', params: { size: 'M6-1', length: 20, fastener_type: 'iso10642' } },
  { name: 'SetScrew M6-1 iso4026', className: 'SetScrew', params: { size: 'M6-1', length: 12, fastener_type: 'iso4026' } },
]

/**
 * §6.3 双钉：螺钉 brepkit 偏差当前值（实测）。长细件质心对头部圆弧离散极敏感，
 * 故 coM 相对偏差放大；沉头螺钉（锥形头 revolve+intersect）体积偏差最大。
 * 钉死为 band 上限；目标 0（brepkit 圆弧离散/布尔精度提升后收紧）。
 *   volume   : CounterSunk 3.619e-2（锥形头，最大）
 *   centerOfMass.z: HexHead 1.521e-2 | SetScrew 2.062e-3
 *   bbox.y   : 3.625e-3（头部直径方向，圆弧离散）
 *   surfaceArea: 待二次运行实测后收紧（首钉给宽松上限）。
 */
const SCREW_T2_BAND: Toleration = {
  volumeRel: 3.7e-2,
  areaRel: 4.0e-2,
  bboxRel: 3.8e-3,
  coMRel: 1.6e-2,
}

function runScrew(fx: Fixture): { handle: BrepHandle } {
  const r = buildScrew(fx.className, fx.params)
  if (!r.handle) throw new Error(`[screw] ${fx.name} produced no solid`)
  return { handle: r.handle }
}

beforeAll(async () => {
  await initEngines()
}, 180_000)

describe('screw: brepkit ↔ occt consistency', () => {
  it('discovered fixtures are non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fx of fixtures) {
    it(`[T1+T2] ${fx.name}`, () => {
      const occt = buildOn('occt', () => runScrew(fx), undefined)
      const brep = buildOn('brepkit', () => runScrew(fx), undefined)
      assertConsistent(occt.metrics, brep.metrics, SCREW_T2_BAND)
    })
  }
})
