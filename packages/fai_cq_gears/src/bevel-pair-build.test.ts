/**
 * bevel-pair-build — BevelGearPair 装配 vs cq_gears 参考（逐件体积 + bbox）
 *
 * 参考值**直接取自 manifest**（`fixtures/reference/manifest.json`，由 cadquery 2.8.0 +
 * cq_gears e73874c 生成），不手抄数字——历史上出现过「用错参数构造去撞对的参考值、再反过来
 * 改参考值凑绿」的假通过，参考值必须与用例同源。
 *
 * cq 自身没有 `BevelGearPair` 的回归数据，这三例是按移植方案 §9.4 新建的
 * （`gen-reference.py --set pairs`），覆盖装配定位链的三条分支：
 *
 * | 用例 | gear/pinion 齿数 | 轴交角 | 螺旋角 | 覆盖到 |
 * |---|---|---|---|---|
 * | `bp-basic` | 30 / **15（奇）** | 90° | 0 | 不触发绕 Z 的 π/z 对齿旋转 |
 * | `bp-even-pinion` | 30 / **16（偶）** | 90° | 0 | **触发**绕 Z 的 π/z 对齿旋转 |
 * | `bp-angled-helix` | 24 / **12（偶）** | 60° | 20° | 非 90° 轴交角 + pinion 螺旋角取负 |
 *
 * 默认套件跑**两件小件**（30+15 / 24+12 齿）：`bp-basic`（奇齿数分支）+
 * `bp-angled-helix`（偶齿数 + 非 90° + 螺旋分支）。`bp-even-pinion` 与三例的 T2 逐件
 * STEP 比对由 `scripts/export-ours.ts` + `scripts/compare-all.ts` 覆盖。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import type { BrepHandle } from '@faicad/faijs-core'
import { getGearKernel, type GearKernel } from '@faicad/cq-compat'
import { buildBevelGearPair, type BevelGearPairParams } from './pairs'
import { bevelPairOptionsFromArgs } from './testing/reference-options'
import { loadManifest, type ReferenceCase, type ReferencePart } from './fixtures'

/** 全部三例（用于不建体的「装配量」快检——纯数学，成本可忽略）。 */
const ALL_CASES = ['bp-basic', 'bp-even-pinion', 'bp-angled-helix'] as const

/** 建体套件只跑这两件（覆盖面同上表，成本约 1 min/例）。 */
const BUILD_CASES = ['bp-basic', 'bp-angled-helix'] as const

/** 体积相对差门禁：与单体 BevelGear 同源（齿面 B-spline 逼近差），实测见当日日志。 */
const VOLUME_REL_TOL = 1e-3

/** bbox 绝对差门禁（mm）。 */
const BBOX_ABS_TOL = 1e-3

let kernel: GearKernel

beforeAll(async () => {
  kernel = await getGearKernel()
})

function refOf(id: string): ReferenceCase {
  const c = loadManifest().cases.find((x) => x.id === id)
  expect(c, `${id} 不在 manifest 中`).toBeDefined()
  expect(c!.parts?.length, `${id} 缺 parts 逐件参考`).toBe(2)
  return c!
}

describe('BevelGearPair 装配量 vs cq_gears（纯数学，不建体）', () => {
  for (const id of ALL_CASES) {
    it(`${id} 的分锥角 / cone_h 与参考一致`, () => {
      const c = refOf(id)
      const args = c.args as unknown as BevelGearPairParams
      const a = c.assembly!

      // 分锥角与 cone_h 都只由构造参数（齿数/轴交角/模数）决定，不含任何逼近，
      // 故用最严的容差（相对 1e-12）；这两项错就说明装配数学错了，不必看体积。
      const { gearGeometry, pinionGeometry, axisAngleDeg } = buildBevelGearPair(
        kernel, args, { buildGear: false, buildPinion: false },
      )

      const deg = (r: number): number => (r * 180) / Math.PI
      expect(Math.abs(deg(gearGeometry.gammaP) - c.parts![0].cone_angle_deg) / c.parts![0].cone_angle_deg,
        `${id}: gear 分锥角`).toBeLessThan(1e-12)
      expect(Math.abs(deg(pinionGeometry.gammaP) - c.parts![1].cone_angle_deg) / c.parts![1].cone_angle_deg,
        `${id}: pinion 分锥角`).toBeLessThan(1e-12)
      expect(Math.abs(axisAngleDeg * Math.PI / 180 - a.axis_angle_rad) / a.axis_angle_rad,
        `${id}: 轴交角`).toBeLessThan(1e-12)

      expect(Math.abs(gearGeometry.coneH - a.gear_cone_h) / a.gear_cone_h,
        `${id}: gear cone_h`).toBeLessThan(1e-12)
      expect(Math.abs(pinionGeometry.coneH - a.pinion_cone_h) / a.pinion_cone_h,
        `${id}: pinion cone_h`).toBeLessThan(1e-12)

      // gs_r 两件必须相等（一对锥齿轮共用同一个大球）——这是分锥角分配正确的硬约束。
      expect(Math.abs(gearGeometry.gsR - pinionGeometry.gsR), `${id}: gear/pinion gs_r 不等`).toBeLessThan(1e-9)
    })
  }
})

describe('BevelGearPair 实体构造 vs cq_gears（逐件体积 + bbox）', () => {
  for (const id of BUILD_CASES) {
    it(`${id} 两件均与 Python 参考一致`, () => {
      const c = refOf(id)
      const args = c.args as unknown as BevelGearPairParams

      // 特征抽取走单一真源（与 export-ours 共用）——曾因测试侧漏抽 bore_d
      // 而把「无轴孔的我们」比「有轴孔的参考」，报出 2% 假偏差。
      const build = buildBevelGearPair(kernel, args, bevelPairOptionsFromArgs(c.args, 'row-approx-loft'))
      expect(build.gear, `${id}: 缺 gear`).toBeDefined()
      expect(build.pinion, `${id}: 缺 pinion`).toBeDefined()

      assertPart(id, 'gear', build.gear!, c.parts![0])
      assertPart(id, 'pinion', build.pinion!, c.parts![1])
    })
  }
})

/**
 * 逐件比对体积与 bbox（`solid` 为装配位姿下的那一件）。
 *
 * @param id 用例 id（用于断言消息）
 * @param name `gear` / `pinion`
 * @param solid 我方该件
 * @param ref manifest 里该件的参考值
 */
function assertPart(id: string, name: string, solid: BrepHandle, ref: ReferencePart): void {
  expect(kernel.isSolid(solid), `${id}/${name}: 结果不是 solid`).toBe(true)

  const vol = kernel.getVolume(solid)
  const rel = Math.abs(vol - ref.volume) / ref.volume
  expect(
    rel,
    `${id}/${name}: 体积相对差 ${rel.toExponential(3)} (got ${vol.toFixed(3)} vs ref ${ref.volume.toFixed(3)})`,
  ).toBeLessThan(VOLUME_REL_TOL)

  const bb = kernel.getBoundingBox(solid)
  const got = [bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin]
  got.forEach((v, i) => {
    expect(
      Math.abs(v - ref.bbox[i]),
      `${id}/${name}: bbox[${i}] 绝对差 ${Math.abs(v - ref.bbox[i]).toExponential(3)} (got ${v} vs ref ${ref.bbox[i]})`,
    ).toBeLessThan(BBOX_ABS_TOL)
  })
}
