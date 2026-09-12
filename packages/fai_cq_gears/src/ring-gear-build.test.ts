/**
 * ring-gear-build — RingGear 实体构造 vs cq_gears（非倒角体积）
 *
 * 对照 Python `RingGear(...).build(chamfer=None)` 的体积（已用 cadquery-env 实算，
 * 入库为回归基线）。倒角（chamfer）需要布尔差，occt-wasm 对 B-spline 实体布尔差是
 * 已知限制，故本测试只验证**非倒角**实体；倒角体积是 manifest 里 chamfered 的参考值，
 * 与本构建产出不同（差的就是倒角那点料），不在本测试范围。
 */

import { describe, expect, it } from 'vitest'
import { getRawKernel, type RawOcctKernel } from './kernel'
import { buildRingGearSolid } from './ring_gear'
import type { RingGearParams } from './profile'

/** Python `RingGear(...).build(chamfer=None)` 实算体积（cadquery-env，2026-09-12 标定）。 */
const NON_CHAMFERED_VOLUME: Record<string, number> = {
  'case14-RingGear': 1858.9145,
  'case15-RingGear': 94578.9611,
  'case16-RingGear': 458222.4344,
  'case19-RingGear': 1001732.2795,
}

const CASE_ARGS: Record<string, RingGearParams> = {
  'case14-RingGear': { module: 1.0, teeth_number: 19, width: 6.0, rim_width: 3.0 },
  'case15-RingGear': { module: 2.5, teeth_number: 44, width: 16.0, helix_angle: 30.0, rim_width: 12.0 },
  'case16-RingGear': { module: 4.0, teeth_number: 68, width: 30.0, rim_width: 12.0 },
  'case19-RingGear': { module: 2.0, teeth_number: 48, width: 200.0, helix_angle: 45.0, rim_width: 12.0 },
}

describe('RingGear 实体构造 vs cq_gears（非倒角体积）', () => {
  let kernel: RawOcctKernel
  it('内核就绪', async () => {
    kernel = await getRawKernel()
    expect(kernel).toBeDefined()
  })

  for (const [id, args] of Object.entries(CASE_ARGS)) {
    it(`${id} 体积与 Python 非倒角一致`, async () => {
      const solid = buildRingGearSolid(kernel, args)
      expect(kernel.isSolid(solid), `${id}: 结果不是 solid`).toBe(true)

      const vol = kernel.getVolume(solid)
      const ref = NON_CHAMFERED_VOLUME[id]
      const rel = Math.abs(vol - ref) / ref
      // 体积相对差：齿面是 B-spline 逼近（tol 1e-2），环形盖面/rim 是精确面，
      // 预期在 1e-3 量级以内；若超界说明构造（annulus 朝向 / rim loft）有误。
      expect(rel, `${id}: 体积相对差 ${rel.toExponential(3)} (got ${vol.toFixed(3)} vs ref ${ref})`).toBeLessThan(1e-3)
    })
  }
})
