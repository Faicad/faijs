/**
 * nut.test.ts — W4 验收（方案 §8「W4 — Nut（7 类）+ Washer（3 类）」）。
 *
 * 验收项（逐条对应方案原文）：
 *  1. 7 类螺母 × 2 规格 **STEP 比对通过**（M6-1 iso4032 必过，实测 302.297726）；
 *  2. `HexNutWithFlange`、`BradTeeNut`（唯一用到 `clearanceHole` 的类）各单独一例；
 *  3. 容差标定四步走完（§7.3.1）：实测最坏值 → 分析文档 → 逐类 override
 *     （`src/testing/compare.ts`）→ **反向守卫**（本文件）。
 *
 * 判定入口只有一个：`@faicad/cq-compat` 的 `compareAssemblyFiles`
 * （经 `src/testing/compare.ts` 封装）。容差只在 compare.ts 定义，本文件不写死数字。
 *
 * ⚠️ **已知缺口（显式抛错，不静默跳过）**：`HeatSetNut` 的 `make_nut` 需要
 * `Face.makeNSidedSurface` 造 knurl 面（内核无此原语；`makeNonPlanarFace` 实测把
 * 4 边扭面退化为 3 边面）。manifest 里两例 HeatSetNut 用「断言抛错」覆盖，见文末。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids } from '@faicad/faijs-core'
import type { BrepHandle } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'
import { MESH_ANGULAR_DEFLECTION, MESH_LINEAR_DEFLECTION, bboxOf, volumeOf } from './primitives'
import {
  bradTeeNut,
  defaultNutProfile,
  hexNut,
  hexNutFlangeProfile,
  heatSetNut,
  polygonDiagonal,
  polarArrayLocations,
  profilePoints,
  radiusArcMidpoint,
} from './nut'
import { NUT_TABLES, isolateFastenerType } from './params'
import { classifyKnownArtifact, compareCase, formatCompareLine } from './testing/compare'
import { loadManifest, nutCases, ourStepPath, readStepArrayBuffer, stepPath, OUT_DIR } from './testing/fixtures'
import { buildNutReference, NUT_CLASSES } from './testing/reference-options'
import type { Manifest, ManifestCase } from './testing/reference-options'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  mkdirSync(OUT_DIR, { recursive: true })
})

/** W4 内**已知缺口**的螺母类：manifest 有 A 侧数据，但 B 侧按设计抛错。 */
const W4_GAP_CLASSES = new Set(['HeatSetNut'])

/** 可做几何比对的用例（排除已知缺口类）。 */
const comparable = (cs: ManifestCase[]): ManifestCase[] =>
  cs.filter((c) => !W4_GAP_CLASSES.has(c.class))

/** 把 B 侧几何导出到 `out/<id>.step`（比对前必须先有 B 侧 STEP）。 */
function exportOurStep(c: ManifestCase): boolean {
  const r = buildNutReference(c)
  if (!r.handle) return false
  writeFileSync(
    ourStepPath(c.id),
    Buffer.from(exportStepFromSolids(k, [{ solid: r.handle, name: 'SOLID' }])),
  )
  return true
}

const manifest: Manifest = loadManifest()
const cases: ManifestCase[] = nutCases(manifest)
const geoCases: ManifestCase[] = comparable(cases)

/**
 * 三角化体积 + 质心（有符号四面体求和）—— GProps 对螺旋面不可信时的真值基准。
 *
 * 与 `primitives.meshVolume` 同一套容差参数；质心按四面体重心加权。
 * ⚠️ 调用前必须先取 bbox（`tessellate` 会原地污染后续 bbox）。
 * @param h - 待测实体句柄。
 * @returns 三角化体积与质心 `[x,y,z]`。
 */
function meshVolumeAndCentroid(h: BrepHandle): { v: number; c: [number, number, number] } {
  const mesh = k.tessellate(h, {
    linearDeflection: MESH_LINEAR_DEFLECTION,
    angularDeflection: MESH_ANGULAR_DEFLECTION,
  })
  const p = mesh.positions
  const idx = mesh.indices
  let v = 0
  let cx = 0
  let cy = 0
  let cz = 0
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t]! * 3
    const b = idx[t + 1]! * 3
    const c = idx[t + 2]! * 3
    const ax = p[a]!
    const ay = p[a + 1]!
    const az = p[a + 2]!
    const bx = p[b]!
    const by = p[b + 1]!
    const bz = p[b + 2]!
    const gx = p[c]!
    const gy = p[c + 1]!
    const gz = p[c + 2]!
    const vt = (ax * (by * gz - bz * gy) - ay * (bx * gz - bz * gx) + az * (bx * gy - by * gx)) / 6
    v += vt
    cx += (vt * (ax + bx + gx)) / 4
    cy += (vt * (ay + by + gy)) / 4
    cz += (vt * (az + bz + gz)) / 4
  }
  return { v, c: [cx / v, cy / v, cz / v] }
}

describe('W4 螺母覆盖度自检（验收清单由 manifest 强制，不靠人记）', () => {
  it('manifest 覆盖全部 7 个螺母类', () => {
    const seen = new Set(cases.map((c) => c.class))
    for (const cls of NUT_CLASSES) expect(seen, `class ${cls}`).toContain(cls)
  })

  it('每类 ≥2 规格（M6-1 iso4032 必过，实测 302.297726）', () => {
    for (const cls of NUT_CLASSES) {
      const n = cases.filter((c) => c.class === cls).length
      expect(n, `${cls} 规格数`).toBeGreaterThanOrEqual(2)
    }
    const m6 = cases.find((c) => c.id === 'hexnut-m6-iso4032')
    expect(m6, 'M6-1 iso4032 必须在内').toBeTruthy()
    expect(m6!.volume).toBeCloseTo(302.297726, 5)
  })

  it('HexNutWithFlange 与 BradTeeNut 各单独一例（方案 §8-W4 验收 2）', () => {
    for (const cls of ['HexNutWithFlange', 'BradTeeNut']) {
      expect(cases.filter((c) => c.class === cls).length, cls).toBeGreaterThanOrEqual(1)
    }
  })

  it('覆盖 simple=false（带螺纹）≥1 例', () => {
    expect(cases.filter((c) => c.args['simple'] === false).length).toBeGreaterThanOrEqual(1)
  })
})

describe('W4 螺母几何：STEP 等价性（compareAssemblyFiles）', () => {
  it.each(geoCases.map((c) => [c.id, c] as const))(
    '%s 与 A 侧参考 STEP 等价（或已归因的 A 侧伪差）',
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

describe('W4 容差 override 的反向守卫（§7.3.1 第 4 步：用旧容差跑必须 FAIL）', () => {
  // 螺母族目前唯一的 override 是 threaded nut（短内螺纹 GProps 求积混叠）。
  const worst = 'nut-hex-m6-iso4032-threaded'

  function worstCase(): ManifestCase {
    const c = cases.find((x) => x.id === worst)
    expect(c, `${worst} 应在 manifest 中`).toBeTruthy()
    return c!
  }

  it(`${worst}：沿用全局默认 1e-6 时必须 DIFFERENT（证明 override 是承力的）`, async () => {
    exportOurStep(worstCase())
    const r = await compareCase(
      { id: worst, referenceStep: stepPath(worst), ourStep: ourStepPath(worst), refVolume: 1 },
      { volumeRelativeTolerance: 1e-6 },
    )
    expect(
      r.equivalent,
      `若此处已等价，说明 override 已失效或数据变化：${formatCompareLine(r)}`,
    ).toBe(false)
  })

  it(`${worst}：标定后的逐类容差下必须 EQUIVALENT`, async () => {
    exportOurStep(worstCase())
    const r = await compareCase({
      id: worst,
      referenceStep: stepPath(worst),
      ourStep: ourStepPath(worst),
      refVolume: 1,
    })
    expect(r.equivalent, formatCompareLine(r)).toBe(true)
  })

  it(`${worst}：几何等价由三角化证明（GProps 体积差 4.577e-3 / 质心差 5.107e-3，mesh 差 3.6e-7 / 1.5e-5）`, () => {
    // 「为什么可以放宽」的证据：两侧 STEP 导入同一内核后，GProps 自偏差
    // A=6.176e-4 / B=3.978e-3（两侧都不自洽），而三角化体积与质心几乎相同。
    exportOurStep(worstCase())
    const a = k.importStep(readStepArrayBuffer(stepPath(worst)))
    const b = k.importStep(readStepArrayBuffer(ourStepPath(worst)))
    // ⚠️ 先读 bbox 再三角化（tessellate 会原地污染 bbox）
    const bbA = bboxOf(a)
    const bbB = bboxOf(b)
    expect(bbA.zmax - bbA.zmin).toBeCloseTo(bbB.zmax - bbB.zmin, 6)

    const ma = meshVolumeAndCentroid(a)
    const mb = meshVolumeAndCentroid(b)
    expect(Math.abs(ma.v - mb.v) / ma.v, 'mesh 体积相对差 < 1e-6').toBeLessThan(1e-6)
    const comDiff = Math.max(...ma.c.map((x, i) => Math.abs(x - mb.c[i]!)))
    expect(comDiff, 'mesh 质心最大差 < 1e-4 mm').toBeLessThan(1e-4)

    // 对照：同一对几何的 GProps 差明显更大 → 差异属求积伪差，不是几何差
    expect(Math.abs(volumeOf(a) - volumeOf(b)) / volumeOf(a), 'GProps 体积差 > 1e-3').toBeGreaterThan(
      1e-3,
    )
    expect(comDiff, '三角化质心差比 GProps 质心差小两个数量级').toBeLessThan(5.107e-3 / 100)
  })
})

describe('W4 轮廓与 plan 的纯算术（读 cq.py 源码逐条复现）', () => {
  const data = isolateFastenerType('iso4032', NUT_TABLES.HexNut)['M6-1']!

  it('polygonDiagonal：对边距 → 外接圆直径（6 边形 / 4 边形）', () => {
    expect(polygonDiagonal(10, 6)).toBeCloseTo(10 / Math.cos(Math.PI / 6), 12)
    expect(polygonDiagonal(10, 4)).toBeCloseTo(10 / Math.cos(Math.PI / 4), 12)
  })

  it('defaultNutProfile：点列 = 上游公式（含 0.001 fudge 与 15° 倒角）', () => {
    const e = polygonDiagonal(10, 6)
    const cs = ((e - 10) * Math.tan(Math.PI / 12)) / 2
    expect(profilePoints(defaultNutProfile(data))).toEqual([
      { r: 0, z: 0 },
      { r: 5, z: 0 },
      { r: e / 2 - 0.001, z: cs },
      { r: e / 2 - 0.001, z: 5.2 - cs },
      { r: 5, z: 5.2 },
      { r: 0, z: 5.2 },
    ])
  })

  it('radiusArcMidpoint：半径不足（弦半长 > |r|）必须抛错，不是静默给退化点', () => {
    expect(() => radiusArcMidpoint({ r: 0, z: 0 }, { r: 10, z: 0 }, 1)).toThrow(/not large enough/)
    // 半圆（半径 = 弦半长）：sag = |r| − √(r²−half²) = 1，弧中点落在弦的 ±90° 方向
    expect(radiusArcMidpoint({ r: 0, z: 0 }, { r: 0, z: 2 }, 1)).toEqual({ r: -1, z: 1 })
    expect(radiusArcMidpoint({ r: 0, z: 0 }, { r: 0, z: 2 }, -1)).toEqual({ r: 1, z: 1 })
  })

  it('hexNutFlangeProfile：25° 过切线的切点与 polarLine 终点（逐式复算）', () => {
    const d = isolateFastenerType('din1665', NUT_TABLES.HexNutWithFlange)['M6-1']!
    const c = Number(d['c'])
    const dc = Number(d['dc'])
    const rad = ((90 - 25) * Math.PI) / 180
    const tangentR = (c / 2) * Math.cos(rad) + (dc - c) / 2
    const tangentZ = (c / 2) * Math.sin(rad) + c / 2
    const a = (155 * Math.PI) / 180
    const pts = profilePoints(hexNutFlangeProfile(d))
    expect(pts[0]).toEqual({ r: 0, z: 0 })
    expect(pts[1]).toEqual({ r: dc / 2 - c / 2, z: 0 })
    expect(pts[2]!.r).toBeCloseTo(tangentR, 12)
    expect(pts[2]!.z).toBeCloseTo(tangentZ, 12)
    expect(pts[3]!.r).toBeCloseTo(tangentR + (dc / 2 - c / 2) * Math.cos(a), 12)
    expect(pts[3]!.z).toBeCloseTo(tangentZ + (dc / 2 - c / 2) * Math.sin(a), 12)
    expect(pts[4]).toEqual({ r: 0, z: pts[3]!.z })
  })

  it('polarArrayLocations：cq 的 endAngle 是排他上界（(0,360,3) → 0/120/240）', () => {
    const p = polarArrayLocations(12, 0, 360, 3)
    expect(p).toHaveLength(3)
    expect(p[0]![0]).toBeCloseTo(12, 12)
    expect(p[0]![1]).toBeCloseTo(0, 12)
    expect(p[1]![0]).toBeCloseTo(12 * Math.cos((2 * Math.PI) / 3), 12)
    expect(p[1]![1]).toBeCloseTo(12 * Math.sin((2 * Math.PI) / 3), 12)
    expect(p[2]![0]).toBeCloseTo(12 * Math.cos((4 * Math.PI) / 3), 12)
    expect(() => polarArrayLocations(12, 0, 360, 0)).toThrow(/positive integer/)
  })

  it('BradTeeNut 的 brad 孔位与参数表一致（bcd/2=12，3 孔）', () => {
    const d = isolateFastenerType('Hilitchi', NUT_TABLES.BradTeeNut)['M6-1']!
    expect(d['bcd']).toBe(24)
    expect(d['brad_num']).toBe(3)
    const p = polarArrayLocations(Number(d['bcd']) / 2, 0, 360, Number(d['brad_num']))
    expect(p.map(([x, y]) => [Number(x.toFixed(9)), Number(y.toFixed(9))])).toEqual([
      [12, 0],
      [-6, 10.392304845],
      [-6, -10.392304845],
    ])
  })
})

describe('W4 几何回归锁（revolve 拓扑 / 派生量 / 与 manifest 对齐）', () => {
  it('hexNut 返回的是 solid 而非 shell（陷阱 8 的下游守卫）', () => {
    const r = hexNut({ size: 'M6-1', fastener_type: 'iso4032' })
    const h: BrepHandle = r.handle
    // ⚠️ 先量 bbox/体积，再（如需）三角化
    expect(k.getSubShapes(h, 'solid').length, '必须是实体').toBe(1)
    const bb = bboxOf(h)
    expect(bb.zmax - bb.zmin).toBeCloseTo(5.2, 9)
    // ⚠️ 横向尺寸 = 倒角腰部的 2×(e/2 − 0.001)，不是六边形外接圆直径：
    // 轮廓在腰部被上游的 0.001 fudge 缩过，与 A 侧 manifest bbox[0] 一致（11.545005383792514）。
    expect(bb.xmax - bb.xmin).toBeCloseTo(polygonDiagonal(10, 6) - 0.002, 9)
    expect(volumeOf(h)).toBeCloseTo(302.297726, 5)
    expect(r.nutThickness).toBeCloseTo(5.2, 9)
    expect(r.nutDiameter).toBeCloseTo(polygonDiagonal(10, 6) - 0.002, 9)
  })

  it('BradTeeNut：法兰盘 36.3×36.3×16.5，3 个沉头孔（A 侧解析 3389.175287）', () => {
    const r = bradTeeNut({ size: 'M6-1', fastener_type: 'Hilitchi' })
    expect(k.getSubShapes(r.handle, 'solid').length).toBe(1)
    const bb = bboxOf(r.handle)
    expect(bb.xmax - bb.xmin).toBeCloseTo(36.3, 9)
    expect(bb.ymax - bb.ymin).toBeCloseTo(36.3, 9)
    expect(bb.zmax - bb.zmin).toBeCloseTo(16.5, 9)
    expect(volumeOf(r.handle)).toBeCloseTo(3389.175287, 4)
    expect(r.nutDiameter).toBeCloseTo(36.3, 9)
    expect(r.nutThickness).toBeCloseTo(16.5, 9)
  })

  it('五类可比螺母的 nutDiameter / nutThickness 与 A 侧 manifest bbox 一致', () => {
    for (const cls of ['HexNut', 'HexNutWithFlange', 'DomedCapNut', 'UnchamferedHexagonNut', 'SquareNut', 'BradTeeNut']) {
      const c = cases.find((x) => x.class === cls)!
      const r = buildNutReference(c)
      expect(r.nutDiameter, `${cls} nutDiameter`).toBeCloseTo(c.bbox[0]!, 6)
      expect(r.nutThickness, `${cls} nutThickness`).toBeCloseTo(c.bbox[2]!, 6)
    }
  })
})

describe('W4 已知缺口与上游语义复刻（如实记录，不静默跳过）', () => {
  it('HeatSetNut 显式抛错并说明缺失内核原语（makeNSidedSurface）', () => {
    expect(() =>
      heatSetNut({ size: 'M3-0.5-Standard', fastener_type: 'McMaster-Carr' }),
    ).toThrow(/HeatSetNut: not implemented in W4 — make_nut needs Face\.makeNSidedSurface/)
  })

  it('缺口类的每一例 manifest 用例都必须抛错（缺口清单与 manifest 对齐）', () => {
    const gap = cases.filter((c) => W4_GAP_CLASSES.has(c.class))
    expect(gap.length, '缺口类用例数').toBeGreaterThanOrEqual(2)
    for (const c of gap) expect(() => buildNutReference(c), c.id).toThrow(/not implemented in W4/)
  })

  it('reference-options 的 args 白名单：未知键抛错（cq_gears 教训，禁止静默丢弃参数）', () => {
    const bogus: ManifestCase = {
      id: 'bogus',
      class: 'HexNut',
      args: { size: 'M6-1', fastener_type: 'iso4032', no_such_arg: 1 },
      volume: 1,
      bbox: [1, 1, 1],
      step: 'bogus.step',
    }
    expect(() => buildNutReference(bogus)).toThrow(/unknown arg/)
    expect(() => buildNutReference({ ...bogus, class: 'NotANut', args: {} })).toThrow(
      /not a nut class/,
    )
  })

  it('规格 / 配合等级非法值抛错（逐字复刻上游 ValueError）', () => {
    expect(() => hexNut({ size: 'M6', fastener_type: 'iso4032' })).toThrow(/invalid, must be formatted/)
    expect(() => hexNut({ size: 'M6-1', fastener_type: 'nope' })).toThrow(/invalid, must be one of/)
    expect(() => hexNut({ size: 'M99-1', fastener_type: 'iso4032' })).toThrow(/invalid, must be one of/)
    expect(() => hexNut({ size: 'M6-1', fastener_type: 'iso4032', hand: 'up' as never })).toThrow(/hand/)
  })
})
