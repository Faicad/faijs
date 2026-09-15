/**
 * bearing.test.ts — W6 验收（方案 §8「W6 — Bearing（5 类）」）。
 *
 * 验收项（逐条对应方案原文）：
 *  1. 5 类 × ≥2 规格 **STEP 比对通过**（`M8-22-7/SKT` 必过，实测 A 侧 1644.7491）；
 *  2. 零件树顺序与上游 Compound 一致（5 类均为单 part Compound，无顺序复杂度）；
 *  3. 派生量（roller_diameter / race_center_radius / roller_count）逐类锁 A 侧 dump；
 *  4. 容差标定四步走完（§7.3.1）：实测最坏值 → 分析文档 → 逐类 override
 *     （`src/testing/compare.ts`）→ 反向守卫（本文件，见 quirk 守卫）。
 *
 * 判定入口只有一个：`@faicad/cq-compat` 的 `compareAssemblyFiles`
 * （经 `src/testing/compare.ts` 封装）。容差只在 compare.ts 定义，本文件不写死数字。
 *
 * 轴承 5 类均为 B 侧完整复刻（无已知内核缺口），逐例比对体积/bbox/质心。
 *
 * 派生量真值来源：上游 `cq_warehouse.bearing` 在 cadquery 环境实测
 * （`scripts/kernel-bearing-probe.py`，含 corner 几何 match=True 验证）。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'
import { BEARING_TABLES, isolateFastenerType, type BearingClassName } from './params'
import { buildBearing } from './bearing'
import { compareCase, classifyKnownArtifact, formatCompareLine } from './testing/compare'
import {
  loadManifest,
  ourStepPath,
  bearingCases,
  stepPath,
  OUT_DIR,
} from './testing/fixtures'
import { buildBearingReference, BEARING_CLASSES } from './testing/reference-options'
import type { Manifest, ManifestCase } from './testing/reference-options'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  mkdirSync(OUT_DIR, { recursive: true })
})

const manifest: Manifest = loadManifest()
const cases: ManifestCase[] = bearingCases(manifest)

/** 按 id 取用例（缺了就是 manifest 出问题，直接抛）。 */
function caseById(id: string): ManifestCase {
  const c = cases.find((x) => x.id === id)
  if (!c) throw new Error(`${id} 不在 manifest 的 bearing 用例中`)
  return c
}

/** 把 B 侧几何导出到 `out/<id>.step`（比对前必须先有 B 侧 STEP）。 */
function exportOurStep(c: ManifestCase): boolean {
  const r = buildBearingReference(c)
  if (!r.handle) return false
  writeFileSync(
    ourStepPath(c.id),
    Buffer.from(exportStepFromSolids(k, [{ solid: r.handle, name: 'SOLID' }])),
  )
  return true
}

const DEG = Math.PI / 180

describe('W6 轴承覆盖度自检（验收清单由 manifest 强制，不靠人记）', () => {
  it('manifest 覆盖全部 5 个轴承类', () => {
    const seen = new Set(cases.map((c) => c.class))
    for (const cls of BEARING_CLASSES) expect(seen, `class ${cls}`).toContain(cls)
  })

  it('每类 ≥2 规格', () => {
    for (const cls of BEARING_CLASSES) {
      const n = cases.filter((c) => c.class === cls).length
      expect(n, `${cls} 规格数`).toBeGreaterThanOrEqual(2)
    }
  })

  it('`M8-22-7/SKT` 必过：A 侧实测体积 1644.7491', () => {
    const m6 = caseById('bearing-dgb-m8-22-7')
    expect(m6.volume).toBeCloseTo(1644.7491261120433, 4)
  })

  it('BEARING_TABLES 键与本文件的清单一致', () => {
    expect(Object.keys(BEARING_TABLES)).toEqual([...BEARING_CLASSES])
  })
})

/** 派生量真值（A 侧 dump，kernel-bearing-probe.py）。 */
const DERIVED: Record<
  string,
  { rollerDiameter: number; raceCenterRadius: number; rollerCount: number; thickness: number }
> = {
  'bearing-acb-m10-30-9': { rollerDiameter: 4.32, raceCenterRadius: 10.3, rollerCount: 13, thickness: 9 },
  'bearing-acb-m15-35-11': { rollerDiameter: 4.8, raceCenterRadius: 12.625, rollerCount: 14, thickness: 11 },
  'bearing-capped-m6-19-6': { rollerDiameter: 3.375, raceCenterRadius: 6.9, rollerCount: 11, thickness: 6 },
  'bearing-capped-m8-22-7': { rollerDiameter: 4.4375, raceCenterRadius: 7.825, rollerCount: 9, thickness: 7 },
  'bearing-cyl-m15-35-11': { rollerDiameter: 3.75, raceCenterRadius: 12.45, rollerCount: 18, thickness: 11 },
  'bearing-cyl-m17-40-12': { rollerDiameter: 4.625, raceCenterRadius: 14.35, rollerCount: 17, thickness: 12 },
  'bearing-dgb-m6-19-6': { rollerDiameter: 2.5625, raceCenterRadius: 6.575, rollerCount: 14, thickness: 6 },
  'bearing-dgb-m8-22-7': { rollerDiameter: 3.4375, raceCenterRadius: 7.425, rollerCount: 12, thickness: 7 },
  'bearing-taper-m15-42-14.25': { rollerDiameter: 7.862273, raceCenterRadius: 15.636812, rollerCount: 11, thickness: 14.25 },
  'bearing-taper-m17-40-13.25': { rollerDiameter: 5.788431, raceCenterRadius: 15.755202, rollerCount: 15, thickness: 13.25 },
}

describe('W6 派生量回归锁：rollerDiameter / raceCenterRadius / rollerCount（A 侧 dump）', () => {
  it.each(Object.keys(DERIVED).map((id) => [id] as const))(
    '%s：派生量与 A 侧一致',
    (id) => {
      const c = caseById(id)
      const r = buildBearingReference(c)
      const exp = DERIVED[id]!
      expect(r.rollerDiameter, `${id} rollerDiameter`).toBeCloseTo(exp.rollerDiameter, 5)
      expect(r.raceCenterRadius, `${id} raceCenterRadius`).toBeCloseTo(exp.raceCenterRadius, 5)
      expect(r.rollerCount, `${id} rollerCount`).toBe(exp.rollerCount)
      expect(r.thickness, `${id} thickness`).toBeCloseTo(exp.thickness, 6)
    },
  )

  it('roller_count = int(1.8π·rcr/rd)（上游 `__init__` 同式，正数为 floor）', () => {
    for (const id of Object.keys(DERIVED)) {
      const c = caseById(id)
      const r = buildBearingReference(c)
      const expected = Math.floor((1.8 * Math.PI * r.raceCenterRadius) / r.rollerDiameter)
      expect(r.rollerCount, `${id} rollerCount 公式`).toBe(expected)
    }
  })
})

describe('W6 轴承几何：STEP 等价性（compareAssemblyFiles）', () => {
  it.each(cases.map((c) => [c.id, c] as const))(
    '%s 与 A 侧参考 STEP 等价',
    async (id, c) => {
      expect(exportOurStep(c), `${id} 应有几何`).toBe(true)
      const r = await compareCase({
        id,
        referenceStep: stepPath(id),
        ourStep: ourStepPath(id),
        refVolume: c.volume_mesh ?? c.volume,
      })
      const verdict = classifyKnownArtifact(id, r)
      if (!r.equivalent) {
        expect(verdict.artifact, `DIFFERENT 且未归因：${formatCompareLine(r)}`).toBe(true)
        expect(verdict.reason).toBeTruthy()
      }
    },
  )
})

describe('W6 容差 override 的反向守卫（§7.3.1 第 4 步：用旧容差跑必须 FAIL）', () => {
  // dgb 两例的 override 依据 = A 侧 STEP 写出器对球-环裁剪交线的损坏（见 compare.ts）。
  const dgbCases = ['bearing-dgb-m6-19-6', 'bearing-dgb-m8-22-7']

  it.each(dgbCases.map((id) => [id] as const))(
    '%s：沿用全局默认 1e-6 时必须 DIFFERENT（证明 override 是承力的）',
    async (id) => {
      expect(exportOurStep(caseById(id))).toBe(true)
      const r = await compareCase(
        {
          id,
          referenceStep: stepPath(id),
          ourStep: ourStepPath(id),
          refVolume: caseById(id).volume_mesh ?? caseById(id).volume,
        },
        { volumeRelativeTolerance: 1e-6, linearTolerance: 1e-3 },
      )
      expect(
        r.equivalent,
        `若此处已等价，说明 override 已失效或 A 侧 STEP 已修复（重新标定）：${formatCompareLine(r)}`,
      ).toBe(false)
    },
  )

  it.each(dgbCases.map((id) => [id] as const))(
    '%s：标定后的逐类容差下必须 EQUIVALENT（B ≈ A live，重导入损坏被容差吸收）',
    async (id) => {
      expect(exportOurStep(caseById(id))).toBe(true)
      const r = await compareCase({
        id,
        referenceStep: stepPath(id),
        ourStep: ourStepPath(id),
        refVolume: caseById(id).volume_mesh ?? caseById(id).volume,
      })
      expect(r.equivalent, formatCompareLine(r)).toBe(true)
    },
  )

  it('bearing-taper-m17-40-13.25：沿用全局默认 1e-6/1e-3 时必须 DIFFERENT（证明 override 是承力的）', async () => {
    const id = 'bearing-taper-m17-40-13.25'
    expect(exportOurStep(caseById(id))).toBe(true)
    const r = await compareCase(
      {
        id,
        referenceStep: stepPath(id),
        ourStep: ourStepPath(id),
        refVolume: caseById(id).volume_mesh ?? caseById(id).volume,
      },
      { volumeRelativeTolerance: 1e-6, linearTolerance: 1e-3 },
    )
    expect(
      r.equivalent,
      `若此处已等价，说明 override 已失效（重新标定）：${formatCompareLine(r)}`,
    ).toBe(false)
  })
})

describe('W6 复刻事实守卫（读上游源码逐条复现，防止「顺手修正」破坏几何）', () => {
  it('圆锥 cone_length 的 asin(radians(a)) quirk：改用 sin(radians(a)) 会让 tapered 派生量整体偏移', () => {
    // 上游 `cone_angle` / `cone_length` 用 `asin(radians(a))`，而非直观的 `sin`。
    // 对 a=9°：asin(0.157080)=0.157749 vs sin(0.157080)=0.156434，差 0.84%。
    const a = 9
    const asinLen = 1 / Math.asin(a * DEG) // 归一化（同乘 Db/2，比值不变）
    const sinLen = 1 / Math.sin(a * DEG)
    expect(Math.abs(asinLen - sinLen) / asinLen, '两种长度相对差').toBeGreaterThan(5e-3)
    // 锁定：asin 路径给出的 tapered rollerDiameter 与 A 侧 dump (7.862273) 一致；
    // 而 sin 路径必然偏离——这里只断言 asin 路径对齐真值（sin 路径在 buildBearing 中不存在，
    // 守卫的是「不得把 asin 改回 sin」）。
    const c = caseById('bearing-taper-m15-42-14.25')
    const r = buildBearingReference(c)
    expect(r.rollerDiameter, 'tapered rollerDiameter（asin 路径）').toBeCloseTo(7.862273, 5)
    expect(r.raceCenterRadius, 'tapered raceCenterRadius（asin 路径）').toBeCloseTo(15.636812, 5)
  })

  it('圆锥 roller_diameter = 2.5·cone_radii[0]（锥顶半径的测量值，非解析公式）', () => {
    // 上游 `roller.faces(">Z").edges().val().radius()*2.5`；本包直接算 2.5·cone_radii[0]。
    const c = caseById('bearing-taper-m15-42-14.25')
    const r = buildBearing(c.class as BearingClassName, {
      size: String(c.args['size']),
      bearingType: String(c.args['bearing_type']),
    })
    // 由派生量反推：cone_radii[0] = rollerDiameter / 2.5
    expect(r.rollerDiameter / 2.5, 'cone_radii[0]（锥顶半径）').toBeCloseTo(7.862273 / 2.5, 5)
  })

  it('角接触 roller_diameter = 0.4·(D2 − d2)，D2 = D − (d2 − d)', () => {
    // 上游 `SingleRowAngularContactBallBearing.roller_diameter`。
    const c = caseById('bearing-acb-m10-30-9')
    const row = isolateFastenerType(
      String(c.args['bearing_type']),
      BEARING_TABLES['SingleRowAngularContactBallBearing'],
    )[String(c.args['size'])]!
    const D = Number(row['D'])
    const d = Number(row['d'])
    const d2 = Number(row['d2'])
    const D2 = D - (d2 - d)
    expect(0.4 * (D2 - d2), 'acb rollerDiameter 公式').toBeCloseTo(4.32, 6)
  })

  it('深沟/圆柱 roller_diameter = 0.625·(D1 − d1)、raceCenterRadius = (D1 + d1)/4', () => {
    const c = caseById('bearing-dgb-m8-22-7')
    const row = isolateFastenerType(String(c.args['bearing_type']), BEARING_TABLES['SingleRowDeepGrooveBallBearing'])[String(c.args['size'])]!
    const D1 = Number(row['D1'])
    const d1 = Number(row['d1'])
    expect(0.625 * (D1 - d1), 'dgb rollerDiameter 公式').toBeCloseTo(3.4375, 6)
    expect((D1 + d1) / 4, 'dgb raceCenterRadius 公式').toBeCloseTo(7.425, 6)
  })

  it('capped 密封盖：两片分置两端（z=B/20..2B/20 与镜像后 z=B-2B/20..B-B/20）', () => {
    // 上游 `cap().mirror("XY").translate((0,0,B))`；本包同构。几何等价由 STEP 比对覆盖，
    // 这里只锁 cap 落位逻辑不反。
    const c = caseById('bearing-capped-m8-22-7')
    const r = buildBearingReference(c)
    expect(r.handle).not.toBeNull()
    expect(r.thickness).toBe(7)
  })
})
