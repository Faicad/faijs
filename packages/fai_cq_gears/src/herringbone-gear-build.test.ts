/**
 * herringbone-gear-build — HerringboneGear / HerringboneRingGear 实体构造 vs cq_gears
 *
 * 对照 Python `HerringboneGear(...).build()` / `HerringboneRingGear(...).build()` 的
 * **裸体**体积（cadquery-env 实算，2026-09-12 标定，无 chamfer/bore/hub/spokes）。
 * 人字齿齿廓数学与父类（SpurGear / RingGear）同构，差异只在建面阶段：齿面沿宽度拆成
 * 上下两半、反向螺旋形成 V 形——由 `buildHerringboneToothFaces` 实现。
 */

import { describe, expect, it } from 'vitest'
import { getGearKernel, type GearKernel } from '@faicad/cq-compat'
import { buildHerringboneGearSolid } from './spur_gear'
import { buildHerringboneRingGearSolid } from './ring_gear'
import type { SpurGearParams, RingGearParams } from './profile'

/** Python `HerringboneGear(...).build()` 裸体体积（cadquery-env，2026-09-12 标定）。 */
const BARE_VOLUME: Record<string, number> = {
  'hb-basic': 19787.75112994664,
  'hbring-basic': 68574.31567225157,
}

const CASE_ARGS: Record<string, SpurGearParams | RingGearParams> = {
  'hb-basic': { module: 2.0, teeth_number: 20, width: 16.0, helix_angle: 30.0 },
  'hbring-basic': { module: 2.0, teeth_number: 40, width: 16.0, helix_angle: 28.0, rim_width: 12.0 },
}

describe('HerringboneGear 实体构造 vs cq_gears（裸齿轮体积）', () => {
  let kernel: GearKernel
  it('内核就绪', async () => {
    kernel = await getGearKernel()
    expect(kernel).toBeDefined()
  })

  it('hb-basic 体积与 Python 裸人字齿一致', () => {
    const solid = buildHerringboneGearSolid(kernel, CASE_ARGS['hb-basic'] as SpurGearParams)
    expect(kernel.isSolid(solid), 'hb-basic: 结果不是 solid').toBe(true)
    const vol = kernel.getVolume(solid)
    const rel = Math.abs(vol - BARE_VOLUME['hb-basic']) / BARE_VOLUME['hb-basic']
    expect(rel, `hb-basic: 体积相对差 ${rel.toExponential(3)} (got ${vol.toFixed(3)} vs ref ${BARE_VOLUME['hb-basic']})`).toBeLessThan(1e-3)
  })

  it('hbring-basic 体积与 Python 裸人字内齿一致', () => {
    const solid = buildHerringboneRingGearSolid(kernel, CASE_ARGS['hbring-basic'] as RingGearParams)
    expect(kernel.isSolid(solid), 'hbring-basic: 结果不是 solid').toBe(true)
    const vol = kernel.getVolume(solid)
    const rel = Math.abs(vol - BARE_VOLUME['hbring-basic']) / BARE_VOLUME['hbring-basic']
    expect(rel, `hbring-basic: 体积相对差 ${rel.toExponential(3)} (got ${vol.toFixed(3)} vs ref ${BARE_VOLUME['hbring-basic']})`).toBeLessThan(1e-3)
  })
})
