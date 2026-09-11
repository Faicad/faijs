/**
 * Stage G acceptance — slide_top 体积缺口修复验证。
 *
 * 复刻 mini_lathe slide_top 几何（CadQuery 2.8.0 原版语义），验证：
 *  1. faces("±Y")[1] 索引选择器返回 boss 面（center/normal），而非 base 极端面；
 *  2. 完整几何体积 ≈ CadQuery ref 88421.299（±1%），zmax = 21.7。
 *
 * ref 由 cadquery-env 实跑 slide_top.py（含 faces("-Y")[1] 等）得出：
 *   VOLUME 88421.29925932591 / ZMAX 21.7
 *
 * 内核：setupNativeKernel() 绑定 vendored brepjs 内核（同 CLI 期望路径）。
 */
import { describe, it, beforeAll, expect } from 'vitest'
import * as cq from './index'
import { setupNativeKernel, kernel, brepOf } from './gear-test-harness'

const MID_HOLE_D_FDM = 8.2

beforeAll(async () => {
  await setupNativeKernel()
})

async function buildSlideTop(): Promise<ReturnType<typeof cq.val>> {
  let wp = await cq.extrude(await cq.rect(await cq.Workplane('XY'), 110, 120), 8)
  const slot_x = 27.4
  const slot_y = 36
  const depth = 1
  const margin = 3
  const x_min = -55
  const x_max = 55
  const left_slot_x0 = x_min + margin
  const left_slot_center_x = left_slot_x0 + slot_x / 2
  const right_slot_x1 = x_max - margin
  const right_slot_center_x = right_slot_x1 - slot_x / 2
  const center_y = 0
  const cut_centers: Array<[number, number]> = [
    [left_slot_center_x, center_y],
    [right_slot_center_x, center_y],
  ]
  wp = await cq.cutBlind(
    await cq.rect(await cq.pushPoints(await cq.workplane(await cq.faces(wp, '>Z')), cut_centers), slot_x, slot_y),
    -depth,
  )
  const hole_positions: Array<[number, number]> = [
    [-48.3, -7.5], [-48.3, 7.5], [-28.3, -7.5], [-28.3, 7.5],
    [28.3, -7.5], [28.3, 7.5], [48.3, -7.5], [48.3, 7.5],
  ]
  wp = await cq.cboreHole(
    await cq.pushPoints(await cq.workplane(await cq.faces(wp, '<Z')), hole_positions),
    3, 5.2, 2,
  )
  wp = await cq.hole(
    await cq.center(await cq.workplane(await cq.faces(wp, '>Z'), { centerOption: 'CenterOfBoundBox' }), 0, 8 / 2),
    MID_HOLE_D_FDM,
  )
  wp = await cq.extrude(
    await cq.rect(
      await cq.center(
        await cq.workplane(await cq.faces(wp, '>Z'), { centerOption: 'CenterOfBoundBox' }),
        0, -(((15 - 8) / 2) + (10 / 2) + 0.555),
      ),
      20, 10,
    ),
    13.7,
  )
  const hex_center_z = (4.3 - 1.4) / 2
  wp = await cq.cutBlind(
    await cq.polygon(
      await cq.center(await cq.workplane(await cq.faces(wp, '-Y[1]'), { centerOption: 'CenterOfBoundBox' }), 0, hex_center_z),
      6, 9.24,
    ),
    -4,
  )
  wp = await cq.cutBlind(
    await cq.polygon(
      await cq.center(await cq.workplane(await cq.faces(wp, '+Y[1]'), { centerOption: 'CenterOfBoundBox' }), 0, hex_center_z),
      6, 9.24,
    ),
    -4,
  )
  wp = await cq.hole(
    await cq.center(await cq.workplane(await cq.faces(wp, '+Y[1]'), { centerOption: 'CenterOfBoundBox' }), 0, hex_center_z),
    5.3,
  )
  const rect_width = 46 + 0.555
  const rect_height = 100 + 0.555
  const square_size = 27.333
  const tool1 = await cq.extrude(await cq.rect(await cq.Workplane('XY'), rect_width, rect_height), 3)
  const tool2 = await cq.translate(
    await cq.extrude(await cq.rect(await cq.Workplane('XY'), square_size, square_size + 4), 3),
    [-36.5, -34.5, 0],
  )
  let tool = await cq.union(tool1, tool2)
  tool = await cq.translate(tool, [0, 4, 0])
  wp = await cq.cut(wp, tool)
  return cq.val(wp)
}

describe('slide_top Stage G (boss-face hex cuts)', () => {
  it('faces("-Y")[1] / faces("+Y")[1] select boss faces, no-index selects base', async () => {
    let wp = await cq.extrude(await cq.rect(await cq.Workplane('XY'), 110, 120), 8)
    const top = await cq.workplane(await cq.faces(wp, '>Z'), { centerOption: 'CenterOfBoundBox' })
    wp = await cq.extrude(await cq.rect(await cq.center(top, 0, -9.055), 20, 10), 13.7)

    // Indexed selectors resolve to the boss faces (verified vs facecheck.py).
    const negWp = await cq.workplane(await cq.faces(wp, '-Y[1]'), { centerOption: 'CenterOfBoundBox' })
    const posWp = await cq.workplane(await cq.faces(wp, '+Y[1]'), { centerOption: 'CenterOfBoundBox' })
    // No-index selectors keep resolving to the slab extreme faces.
    const baseNegWp = await cq.workplane(await cq.faces(wp, '-Y'), { centerOption: 'CenterOfBoundBox' })
    const basePosWp = await cq.workplane(await cq.faces(wp, '+Y'), { centerOption: 'CenterOfBoundBox' })

    // boss -Y face centre ≈ (0, -14.05, 14.85), normal ≈ (0,-1,0)
    expect(Math.abs(negWp.origin[1] - -14.05)).toBeLessThan(0.2)
    expect(Math.abs(negWp.origin[2] - 14.85)).toBeLessThan(0.2)
    expect(Math.abs(negWp.normal[1] - -1)).toBeLessThan(1e-6)
    // boss +Y face centre ≈ (0, -4.05, 14.85), normal ≈ (0,1,0)
    expect(Math.abs(posWp.origin[1] - -4.05)).toBeLessThan(0.2)
    expect(Math.abs(posWp.origin[2] - 14.85)).toBeLessThan(0.2)
    expect(Math.abs(posWp.normal[1] - 1)).toBeLessThan(1e-6)
    // no-index extreme faces stay on the slab ends
    expect(Math.abs(baseNegWp.origin[1] - -60)).toBeLessThan(0.2)
    expect(Math.abs(basePosWp.origin[1] - 60)).toBeLessThan(0.2)
  })

  it('full geometry volume ≈ CadQuery ref 88421.299 (±1%), zmax = 21.7', async () => {
    const shape = await buildSlideTop()
    const k = kernel()
    const handle = brepOf(shape) as never
    const vol = k.getVolume(handle)
    const bb = k.getBoundingBox(handle)
    console.log(`[SLIDE_TOP] volume=${vol.toFixed(3)} zmax=${bb.zmax.toFixed(3)}`)
    expect(Math.abs(vol - 88421.299) / 88421.299).toBeLessThan(0.01)
    expect(Math.abs(bb.zmax - 21.7)).toBeLessThan(0.05)
  })
})
