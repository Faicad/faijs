/**
 * crossed-helical-build — CrossedHelicalGear 实体构造 vs cq_gears（裸齿轮体积）
 *
 * 对照 Python `CrossedHelicalGear(...).build()`（无 bore/hub/recess/chamfer）的体积，
 * 用 cadquery-env 实算（2026-09-12 标定）。参数取自 manifest 同名 case 的裸齿轮部分
 * （case29/case30 的 chrome 参数为 bore_d/hub_d/recess/chamfer，构造时不用）。
 */

import { describe, expect, it } from 'vitest'
import { getRawKernel, type RawOcctKernel } from './kernel'
import { buildCrossedHelicalSolid } from './crossed_helical_gear'
import type { CrossedHelicalGearParams } from './profile'

/** Python `CrossedHelicalGear(...).build()` 裸齿轮体积（cadquery-env，2026-09-12 标定）。 */
const BARE_VOLUME: Record<string, number> = {
  'case29-CrossedHelicalGear': 6704.196564,
  'case30-CrossedHelicalGear': 63861.914272,
}

const CASE_ARGS: Record<string, CrossedHelicalGearParams> = {
  'case29-CrossedHelicalGear': { module: 1.0, teeth_number: 23, width: 12.0, helix_angle: 31.0 },
  'case30-CrossedHelicalGear': { module: 1.0, teeth_number: 32, width: 40.0, helix_angle: 45.0 },
}

describe('CrossedHelicalGear 实体构造 vs cq_gears（裸齿轮体积）', () => {
  let kernel: RawOcctKernel
  it('内核就绪', async () => {
    kernel = await getRawKernel()
    expect(kernel).toBeDefined()
  })

  for (const [id, args] of Object.entries(CASE_ARGS)) {
    it(`${id} 体积与 Python 裸齿轮一致`, async () => {
      const solid = buildCrossedHelicalSolid(kernel, args)
      expect(kernel.isSolid(solid), `${id}: 结果不是 solid`).toBe(true)

      const vol = kernel.getVolume(solid)
      const ref = BARE_VOLUME[id]
      const rel = Math.abs(vol - ref) / ref
      expect(rel, `${id}: 体积相对差 ${rel.toExponential(3)} (got ${vol.toFixed(3)} vs ref ${ref})`).toBeLessThan(1e-3)
    })
  }
})
