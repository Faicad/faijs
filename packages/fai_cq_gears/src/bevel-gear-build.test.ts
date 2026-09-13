/**
 * bevel-gear-build — BevelGear 实体构造 vs cq_gears 参考（体积 + bbox）
 *
 * 参考值**直接取自 manifest**（`fixtures/reference/manifest.json`，由 cadquery 2.8.0 +
 * cq_gears e73874c 生成），不手抄数字——历史上出现过「用错参数构造去撞对的参考值、再反过来
 * 改参考值凑绿」的假通过，参考值必须与用例同源。
 *
 * 覆盖两条代码路径：
 * - `case08-BevelGear`：helix_angle = 0 ⇒ `surface_splines = 2`（直纹齿面）
 * - `case11-BevelGear`：helix_angle = 30 ⇒ `surface_splines = 12` + 扭转（螺旋齿面）
 *
 * ⚠️ 用例**只放这两个小件**（16 / 19 齿，各 ~25 s）。case09/10/12/13（54–138 齿，单件
 * 40 s–2.5 min）由 T2 链路 `scripts/export-ours.ts` + `scripts/compare-all.ts` 覆盖
 * （已实测：case09 rel 1.0e-13、case10 rel 3.1e-12、case12/13 见当日日志）。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { getRawKernel, type RawOcctKernel } from './kernel'
import { buildBevelGearSolid } from './bevel_gear'
import { loadManifest } from './fixtures'
import { bevelGearOptionsFromArgs } from './testing/reference-options'
import { bevelGearGeometry, type BevelGearParams } from './profile'

/** 默认套件覆盖的用例（小件、两条路径各一）。 */
const CASES = ['case08-BevelGear', 'case11-BevelGear'] as const

let kernel: RawOcctKernel

beforeAll(async () => {
  kernel = await getRawKernel()
})

describe('BevelGear 实体构造 vs cq_gears（体积 + bbox）', () => {
  for (const id of CASES) {
    it(`${id} 与 Python 参考一致`, () => {
      const c = loadManifest().cases.find((x) => x.id === id)!
      expect(c, `${id} 不在 manifest 中`).toBeDefined()
      expect(c.volume, `${id} 缺参考体积`).toBeDefined()

      const args = c.args as unknown as BevelGearParams
      // 特征抽取走单一真源（与 export-ours 共用），避免「一边抽了 bore_d、一边没抽」
      // 造成的假偏差——2026-09-12 一天内踩过两次。
      const build = bevelGearOptionsFromArgs(c.args, 'row-approx-loft')

      const solid = buildBevelGearSolid(kernel, args, build)
      expect(kernel.isSolid(solid), `${id}: 结果不是 solid`).toBe(true)

      const vol = kernel.getVolume(solid)
      const rel = Math.abs(vol - c.volume!) / c.volume!
      // 齿面是 B-spline 逼近（tol 1e-2），两端裁切/回转体布尔差为精确运算，
      // 实测 rel：case08 5.1e-5、case11 1.9e-4 → 门禁 1e-3 留 5 倍余量。
      expect(
        rel,
        `${id}: 体积相对差 ${rel.toExponential(3)} (got ${vol.toFixed(3)} vs ref ${c.volume})`,
      ).toBeLessThan(1e-3)

      const bb = kernel.getBoundingBox(solid)
      const got = [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin]
      const ref = c.bbox!
      got.forEach((v, i) => {
        expect(
          Math.abs(v - ref[i]),
          `${id}: bbox[${i}] 绝对差 ${Math.abs(v - ref[i]).toExponential(3)} (got ${v} vs ref ${ref[i]})`,
        ).toBeLessThan(1e-3)
      })
    })
  }
})

describe('BevelGear 构造前置校验', () => {
  it('face_width ≥ gs_r 时显式抛错（cq assert）', () => {
    // gs_r = (m·z/2)/sin(cone_angle)；这里取一个必然超过 gs_r 的 face_width
    expect(() => bevelGearGeometry({
      module: 1, teeth_number: 16, cone_angle: 45, face_width: 12,
    })).toThrow(/face_width/)
  })
})
