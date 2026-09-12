/**
 * spur-gear-build — SpurGear 实体构造 vs cq_gears（裸齿轮体积）
 *
 * 对照 Python `SpurGear(...).build()`（无 bore/hub/recess/chamfer）的体积，
 * 用 cadquery-env 实算（2026-09-12 标定）。参数取自 manifest 同名 case 的
 * 「去掉 chrome 参数」后的裸齿轮。
 */

import { describe, expect, it } from 'vitest'
import { getRawKernel, type RawOcctKernel } from './kernel'
import { buildSpurGearSolid } from './spur_gear'
import type { SpurGearParams } from './profile'

/** Python `SpurGear(...).build()` 裸齿轮体积（cadquery-env，2026-09-12 标定）。 */
const BARE_VOLUME: Record<string, number> = {
  'spur-basic': 1111.710723,
  'case00-SpurGear': 176.563227,
}

const CASE_ARGS: Record<string, SpurGearParams> = {
  'spur-basic': { module: 1.0, teeth_number: 17, width: 5.0 },
  'case00-SpurGear': { module: 1.0, teeth_number: 5, width: 10.0 },
}

describe('SpurGear 实体构造 vs cq_gears（裸齿轮体积）', () => {
  let kernel: RawOcctKernel
  it('内核就绪', async () => {
    kernel = await getRawKernel()
    expect(kernel).toBeDefined()
  })

  for (const [id, args] of Object.entries(CASE_ARGS)) {
    it(`${id} 体积与 Python 裸齿轮一致`, async () => {
      const solid = buildSpurGearSolid(kernel, args)
      expect(kernel.isSolid(solid), `${id}: 结果不是 solid`).toBe(true)

      const vol = kernel.getVolume(solid)
      const ref = BARE_VOLUME[id]
      const rel = Math.abs(vol - ref) / ref
      expect(rel, `${id}: 体积相对差 ${rel.toExponential(3)} (got ${vol.toFixed(3)} vs ref ${ref})`).toBeLessThan(1e-3)
    })
  }
})
