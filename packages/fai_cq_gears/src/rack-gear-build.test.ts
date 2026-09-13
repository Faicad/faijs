/**
 * rack-gear-build — RackGear / HerringboneRackGear 实体构造 vs cq_gears
 *
 * 对照 Python `RackGear(...).build()` / `HerringboneRackGear(...).build()` 的体积。
 * 齿条 `_build` 只做 faces→shell→solid（无 bore/chamfer），所以官方 expected
 * 体积即裸体体积，直接对照 regression json。
 */

import { describe, expect, it } from 'vitest'
import { getGearKernel, type GearKernel } from '@faicad/cq-compat'
import { buildRackGearSolid } from './rack_gear'
import type { RackGearParams } from './profile'

/** Python build() 实算体积（regression_test_cases.json case23–case28 原值）。 */
const CASES: Array<{ id: string; herringbone: boolean; args: RackGearParams; volume: number }> = [
  { id: 'case23-RackGear', herringbone: false, volume: 10374.718236314646,
    args: { module: 1, length: 200, width: 10, height: 4 } },
  { id: 'case24-RackGear', herringbone: false, volume: 30181.149191163182,
    args: { module: 2, length: 180, width: 20, height: 6, helix_angle: 15 } },
  { id: 'case25-RackGear', herringbone: false, volume: 50281.06746569876,
    args: { module: 2, length: 300, width: 20, height: 6, helix_angle: 45 } },
  { id: 'case26-RackGear', herringbone: false, volume: 118350.71183222547,
    args: { module: 4, length: 300, width: 20, height: 18, helix_angle: -60 } },
  { id: 'case27-HerringboneRackGear', herringbone: true, volume: 8627.867947793651,
    args: { module: 1, length: 100, width: 12, height: 6, helix_angle: 29 } },
  { id: 'case28-HerringboneRackGear', herringbone: true, volume: 268564.3937728845,
    args: { module: 2, length: 400, width: 30, height: 20, helix_angle: -50 } },
]

describe('RackGear 实体构造 vs cq_gears', () => {
  let kernel: GearKernel
  it('内核就绪', async () => {
    kernel = await getGearKernel()
    expect(kernel).toBeDefined()
  })

  for (const c of CASES) {
    it(`${c.id} 体积与 Python 一致`, () => {
      const solid = buildRackGearSolid(kernel, c.args, { herringbone: c.herringbone })
      expect(kernel.isSolid(solid), `${c.id}: 结果不是 solid`).toBe(true)

      const vol = kernel.getVolume(solid)
      const rel = Math.abs(vol - c.volume) / c.volume
      // 齿面是 spline 廓形（直线廓形的 2×2 阵拟合），端面/盖面是精确平面，
      // 预期 1e-3 量级以内；超界说明裁剪/组线/缝合有误。
      expect(rel, `${c.id}: 体积相对差 ${rel.toExponential(3)} (got ${vol.toFixed(3)} vs ref ${c.volume})`).toBeLessThan(1e-3)
    })
  }
})
