/**
 * bearing.test.ts — 轴承 brepkit ↔ occt 一致性（方案 §6.7 / §6.3）
 *
 * 三类（深沟球 / 带盖深沟球 / 圆柱滚子）走 L1 核心面 + `rotate`→`transform` 矩阵映射，
 * 属「意图零缺口」件。实测 brepkit 与 occt 几何高度一致，但存在**系统性小体积偏差**
 * （brepkit 比 occt 略小 0.1%–0.6%），根因是 brepkit 把滚道轮廓圆弧离散成弦 → 旋转体
 * 体积轻微欠填。按 §6.3 双钉处理：钉死当前偏差上限为 band，目标 0（brepkit 圆弧离散
 * 精度提升后收紧 band）。
 *
 * 以下类被排除出 brepkit 对照（属 brepkit 真缺口，仅 occt 可建，列入 §6.7 occt-only 清单）：
 *   - SingleRowAngularContactBallBearing：用到 `interpolatePointsWithTangents`（无 L1 等价）。
 *   - SingleRowTaperedRollerBearing：brepkit 真实构建失败——圆锥内/外圈轮廓线在
 *     `makeFaceFromWire`（brepkitKernel.ts:1044）报 `invalid wire handle`，属 brepkit 轮廓线
 *     容错/构建缺陷，需另行排查，本文件不跑 brepkit。
 *
 * 运行：
 *   npx vitest run --config packages/tests/vitest.engine-compat.config.ts
 */

import { describe, it, beforeAll, expect } from 'vitest'
import { initEngines, buildOn, assertConsistent } from './harness'
import { buildBearing } from '../../../faijs-fasteners/src/bearing'
import { BEARING_TABLES, typesOf, sizesOf } from '../../../faijs-fasteners/src/params'
import type { BearingClassName } from '../../../faijs-fasteners/src/params'
import type { BrepHandle } from '../../../core/src/brep/engine/primitives'

/** 意图零缺口轴承类（角接触 / 圆锥滚子因 brepkit 真缺口被排除，见文件头）。 */
const ZERO_GAP_CLASSES: BearingClassName[] = [
  'SingleRowDeepGrooveBallBearing',
  'SingleRowCappedDeepGrooveBallBearing',
  'SingleRowCylindricalRollerBearing',
]

/**
 * §6.3 双钉：轴承 brepkit 各项偏差当前值（实测，brepkit 比 occt 略小，系统性）。
 * 钉死为 band 上限；目标 0（brepkit 圆弧离散精度提升后收紧）。
 * band 只能收紧不能放大——若 brepkit 偏差增大超过 PINNED，测试自动转红。
 *   volume   : DeepGroove M3 5.869e-3 | M10 2.697e-3 | Capped M3 3.042e-3 |
 *              Capped M8 1.304e-3 | CylRoller M15 1.273e-3 | M25 1.049e-3
 *   surfaceArea: Capped M3 2.164e-3 | Capped M8 1.196e-3 | CylRoller M15 1.106e-3
 *   bbox     : M3 小尺寸轴承包围盒最小，同一圆弧弦离散绝对误差占比最大 →
 *              DeepGroove M3 y=6.090e-4（全量最大）；Capped M3 y 同量级。
 *              故 bbox band 钉 6.5e-4（覆盖 M3 全轴最大观测）。
 */
const BEARING_VOL_DEV_PINNED_MAX = 6.0e-3
const BEARING_AREA_DEV_PINNED_MAX = 2.3e-3
const BEARING_BBOX_DEV_PINNED_MAX = 6.5e-4
const BEARING_T2_BAND = {
  volumeRel: BEARING_VOL_DEV_PINNED_MAX,
  areaRel: BEARING_AREA_DEV_PINNED_MAX,
  bboxRel: BEARING_BBOX_DEV_PINNED_MAX,
}

interface BearingParams {
  size: string
  bearingType: string
}
type BearingBuild = (p: BearingParams) => { handle: BrepHandle }

interface Fixture {
  name: string
  build: BearingBuild
  params: BearingParams
}

function buildFixtures(): Fixture[] {
  const out: Fixture[] = []
  for (const cls of ZERO_GAP_CLASSES) {
    const table = BEARING_TABLES[cls]
    const fts = typesOf(table)
    if (fts.length === 0) continue
    const ft = fts[0]!
    const sizes = sizesOf(ft, table)
    if (sizes.length === 0) continue
    const small = sizes[0]!
    const large = sizes[sizes.length - 1]!
    out.push({
      name: `${cls} ${small} ${ft}`,
      build: (p) => buildBearing(cls, p),
      params: { size: small, bearingType: ft },
    })
    if (large !== small) {
      out.push({
        name: `${cls} ${large} ${ft}`,
        build: (p) => buildBearing(cls, p),
        params: { size: large, bearingType: ft },
      })
    }
  }
  return out
}

const fixtures = buildFixtures()

beforeAll(async () => {
  await initEngines()
}, 180_000)

describe('bearing: brepkit ↔ occt consistency', () => {
  it('discovered fixtures are non-empty', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fx of fixtures) {
    it(`[T1+T2] ${fx.name}`, () => {
      const occt = buildOn('occt', fx.build, fx.params)
      const brep = buildOn('brepkit', fx.build, fx.params)
      // 体积用 §6.3 钉死的 band（其余 T2 仍走默认 1e-3 容差，均已满足）。
      assertConsistent(occt.metrics, brep.metrics, BEARING_T2_BAND)
    })
  }
})
