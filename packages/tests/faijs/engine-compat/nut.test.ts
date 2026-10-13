/**
 * nut.test.ts — 螺母 brepkit ↔ occt 一致性（方案 §6.7 / §6.3）
 *
 * 分类：零缺口（`['occt','brepkit']`）。螺母构造仅用 L1 兼容原语
 * （revolveProfile / planarFace / extrudeFace / cut / fuse / translate /
 *  makeArcEdge / makeSolid），brepkit 经 harness 的 revolve/makeSolid/rotate 适配即可建模。
 * 圆弧离散带来系统性小体积偏差，按 §6.3 双钉钉入 band（实测后收紧）。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts faijs/engine-compat/nut.test.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, buildOn, assertConsistent, type Toleration } from './harness'
import { hexNut, hexNutWithFlange, bradTeeNut } from '../../../faijs-fasteners/src/nut'
import type { BrepHandle } from '../../../core/src/brep/engine/primitives'

type NutBuild = (p: { size: string; fastener_type: string }) => { handle: BrepHandle | null }

interface Fixture {
  name: string
  build: NutBuild
  params: { size: string; fastener_type: string }
}

const fixtures: Fixture[] = [
  { name: 'HexNut M6-1 iso4032', build: hexNut, params: { size: 'M6-1', fastener_type: 'iso4032' } },
  { name: 'HexNut M20-2.5 iso4032', build: hexNut, params: { size: 'M20-2.5', fastener_type: 'iso4032' } },
  { name: 'HexNutWithFlange M6-1 din1665', build: hexNutWithFlange, params: { size: 'M6-1', fastener_type: 'din1665' } },
  { name: 'BradTeeNut M6-1 Hilitchi', build: bradTeeNut, params: { size: 'M6-1', fastener_type: 'Hilitchi' } },
]

/**
 * §6.3 双钉：螺母 brepkit 各项偏差当前值（实测系统性，brepkit 比 occt 略小）。
 * 钉死为 band 上限；目标 0（brepkit 圆弧离散精度提升后收紧）。
 *   volume   : M6 2.500e-3 | M20 1.085e-3
 *   surfaceArea: M6 1.822e-3
 *   bbox.y   : 4.511e-4（六角/法兰轮廓离散）
 *   centerOfMass.z: 1.986e-3（长细件质心对头部离散极敏感）
 */
const NUT_T2_BAND: Toleration = {
  volumeRel: 2.6e-3,
  areaRel: 2.0e-3,
  bboxRel: 4.6e-4,
  coMRel: 2.1e-3,
}

function runNut(fx: Fixture): { handle: BrepHandle } {
  const r = fx.build(fx.params)
  if (!r.handle) throw new Error(`[nut] ${fx.name} produced no solid`)
  return { handle: r.handle }
}

beforeAll(async () => {
  await initEngines()
}, 180_000)

describe('nut: brepkit ↔ occt consistency', () => {
  it('discovered fixtures are non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fx of fixtures) {
    it(`[T1+T2] ${fx.name}`, () => {
      const occt = buildOn('occt', () => runNut(fx), undefined)
      const brep = buildOn('brepkit', () => runNut(fx), undefined)
      assertConsistent(occt.metrics, brep.metrics, NUT_T2_BAND)
    })
  }
})
