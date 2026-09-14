/**
 * washer.test.ts — W4 验收（方案 §8「W4 — Nut（7 类）+ Washer（3 类）」）。
 *
 * 验收项：3 类垫圈 × 2 规格 **STEP 比对通过**；容差标定四步走完（§7.3.1）。
 *
 * ⚠️ **A 侧 `volume` 字段对 washer 不可用**（本文件的两条「错误基准」回归锁就是为它写的）：
 * 上游 `Solid.Volume()`（OCP `BRepGProp`）对 revolve 原生生成的**内孔管**给出
 * **恰好 2× 解析值**的错值（PlainWasher M6 iso7089：解析 145.669368 /
 * `Volume()` 291.338736 / 三角化 145.609004）。occt-wasm 的 `getVolume` 对同一几何
 * **精确**，故 STEP 比对不受影响；但读 A 侧真值必须用 manifest 的 `volume_mesh`。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'
import { bboxOf, meshVolume, volumeOf } from './primitives'
import {
  chamferedWasher,
  cheeseHeadWasher,
  plainWasher,
  type WasherResult,
} from './washer'
import { WASHER_TABLES, isolateFastenerType } from './params'
import { classifyKnownArtifact, compareCase, formatCompareLine } from './testing/compare'
import { loadManifest, ourStepPath, stepPath, washerCases, OUT_DIR } from './testing/fixtures'
import { buildWasherReference, WASHER_CLASSES } from './testing/reference-options'
import type { Manifest, ManifestCase } from './testing/reference-options'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  mkdirSync(OUT_DIR, { recursive: true })
})

function exportOurStep(c: ManifestCase): boolean {
  const r = buildWasherReference(c)
  if (!r.handle) return false
  writeFileSync(
    ourStepPath(c.id),
    Buffer.from(exportStepFromSolids(k, [{ solid: r.handle, name: 'SOLID' }])),
  )
  return true
}

const manifest: Manifest = loadManifest()
const cases: ManifestCase[] = washerCases(manifest)

describe('W4 垫圈覆盖度自检', () => {
  it('manifest 覆盖全部 3 个垫圈类，每类 ≥2 规格', () => {
    const seen = new Set(cases.map((c) => c.class))
    for (const cls of WASHER_CLASSES) {
      expect(seen, `class ${cls}`).toContain(cls)
      expect(cases.filter((c) => c.class === cls).length, `${cls} 规格数`).toBeGreaterThanOrEqual(2)
    }
  })

  it('覆盖 4 张上游垫圈表里的 3 个 fastener_type（iso7089/iso7090/iso7092）', () => {
    const types = new Set(cases.map((c) => c.args['fastener_type']))
    for (const t of ['iso7089', 'iso7090', 'iso7092']) expect(types, t).toContain(t)
  })
})

describe('W4 垫圈几何：STEP 等价性（compareAssemblyFiles）', () => {
  it.each(cases.map((c) => [c.id, c] as const))(
    '%s 与 A 侧参考 STEP 等价（或已归因的 A 侧伪差）',
    async (id, c) => {
      expect(exportOurStep(c), `${id} 应有几何`).toBe(true)
      const r = await compareCase({
        id,
        referenceStep: stepPath(id),
        ourStep: ourStepPath(id),
        // ⚠️ 必须用 volume_mesh：washer 的 A 侧 `volume` 是 2× 解析值
        refVolume: c.volume_mesh ?? c.volume,
      })
      const verdict = classifyKnownArtifact(id, r)
      if (!r.equivalent) {
        expect(verdict.artifact, `DIFFERENT 且未归因：${formatCompareLine(r)}`).toBe(false)
        expect(verdict.reason, 'washer 两侧都是精确 revolve，不允许 override 例外').toBeFalsy()
      }
    },
  )

  it('垫圈是精确 revolve → 两侧 STEP 差异必须为 0 量级（无 override 可依赖）', async () => {
    for (const c of cases) {
      expect(exportOurStep(c), c.id).toBe(true)
      const r = await compareCase({
        id: c.id,
        referenceStep: stepPath(c.id),
        ourStep: ourStepPath(c.id),
        refVolume: c.volume_mesh ?? c.volume,
      })
      expect(r.equivalent, formatCompareLine(r)).toBe(true)
      const part = r.parts[0]
      expect(part?.bbox?.maxDiff ?? Number.NaN, `${c.id} bbox 差`).toBeLessThan(1e-6)
      expect(Math.abs(part?.volume?.diffPct ?? Number.NaN), `${c.id} 体积相对差 %`).toBeLessThan(1e-4)
      expect(part?.centerOfMass?.maxDiff ?? Number.NaN, `${c.id} 质心差`).toBeLessThan(1e-6)
    }
  })
})

describe('W4 「错误基准」回归锁（A 侧 volume 对 washer 是 2× 解析值）', () => {
  it('A 侧 volume ≈ 2 × 解析值，而 volume_mesh ≈ 解析值（两条都必须成立）', () => {
    for (const c of cases) {
      const r = buildWasherReference(c)
      const analyticLike = volumeOf(r.handle) // occt-wasm GProps == 解析值（内核无该病理）
      expect(analyticLike, `${c.id} 我方体积为正`).toBeGreaterThan(0)
      // 错误基准：拿 A 侧 `volume` 去比 → 会看到 ≈100% 的假偏差
      expect(c.volume / analyticLike, `${c.id} A 侧 volume / 解析`).toBeCloseTo(2, 3)
      // 正确基准：`volume_mesh` 与解析值只差三角化损失
      expect(Math.abs(c.volume_mesh! - analyticLike) / analyticLike, `${c.id} mesh 相对差`).toBeLessThan(
        2e-3,
      )
    }
  })

  it('若误用 A 侧 volume 当基准，全部 6 例都会得到 ~50% 假偏差（这就是必须用 volume_mesh 的原因）', () => {
    for (const c of cases) {
      const r = buildWasherReference(c)
      const wrongDiff = Math.abs(c.volume - volumeOf(r.handle)) / c.volume
      const rightDiff = Math.abs(c.volume_mesh! - meshVolume(r.handle)) / c.volume_mesh!
      expect(wrongDiff, `${c.id} 错误基准的假偏差`).toBeGreaterThan(0.49)
      expect(rightDiff, `${c.id} 正确基准的真实差`).toBeLessThan(1e-3)
    }
  })

  it('washer 返回的是 solid 而非 shell（revolve 陷阱的下游守卫）', () => {
    for (const c of cases) {
      const r = buildWasherReference(c)
      expect(k.getSubShapes(r.handle, 'solid').length, `${c.id} 必须是实体`).toBe(1)
    }
  })
})

describe('W4 垫圈轮廓纯算术（逐点复刻上游 washer_profile）', () => {
  it('plainWasher：矩形截面（内 d1/2、外 d2/2、高 h）', () => {
    const d = isolateFastenerType('iso7089', WASHER_TABLES.PlainWasher)['M6']!
    const r = plainWasher({ size: 'M6', fastener_type: 'iso7089' })
    expect(r.washerData).toEqual(d)
    const { d1, d2, h } = d as unknown as { d1: number; d2: number; h: number }
    const bb = bboxOf(r.handle)
    expect(r.diameter).toBeCloseTo(d2, 9)
    expect(r.thickness).toBeCloseTo(h, 9)
    expect(bb.zmax - bb.zmin).toBeCloseTo(h, 9)
    expect(volumeOf(r.handle)).toBeCloseTo((Math.PI * (d2 * d2 - d1 * d1) * h) / 4, 6)
    // 内孔：bbox 是外径，但几何是管 —— 体积若按实心盘会大得多
    expect(volumeOf(r.handle)).toBeLessThan((Math.PI * d2 * d2 * h) / 4)
  })

  it('chamferedWasher：顶面 0.25h 斜面（外径顶点在 z=0.75h）', () => {
    const d = isolateFastenerType('iso7090', WASHER_TABLES.ChamferedWasher)['M6']!
    const { d1, d2, h } = d as unknown as { d1: number; d2: number; h: number }
    const r = chamferedWasher({ size: 'M6', fastener_type: 'iso7090' })
    const bb = bboxOf(r.handle)
    // 解析体积：外径段 0→0.75h 全高 + 0.75h→h 处线性缩到 d2/2 − 0.25h
    const rOut = d2 / 2
    const rTop = d2 / 2 - 0.25 * h
    const vOuter = Math.PI * (rOut * rOut - (d1 / 2) ** 2) * 0.75 * h
    const vTaper =
      ((Math.PI * 0.25 * h) / 3) * (rOut * rOut + rOut * rTop + rTop * rTop - 3 * (d1 / 2) ** 2)
    expect(r.diameter).toBeCloseTo(d2, 9)
    expect(r.thickness).toBeCloseTo(h, 9)
    expect(bb.xmax - bb.xmin).toBeCloseTo(d2, 9)
    expect(volumeOf(r.handle)).toBeCloseTo(vOuter + vTaper, 6)
  })

  it('cheeseHeadWasher：内孔两端各 h/4 的沉窝（轮廓 6 点）', () => {
    const d = isolateFastenerType('iso7092', WASHER_TABLES.CheeseHeadWasher)['M6']!
    const { d1, d2, h } = d as unknown as { d1: number; d2: number; h: number }
    const r = cheeseHeadWasher({ size: 'M6', fastener_type: 'iso7092' })
    // 解析：外径恒为 d2/2；内边界 = 两端 h/4 从 d1/2+h/4 线性收到 d1/2，中段 0.5h 恒为 d1/2
    const R = d2 / 2
    const A = d1 / 2
    const t = h / 4
    // ∫_0^t (A + t − z)² dz = ((A+t)³ − A³)/3；两段相同；中段 A²·(0.5h)
    const vInnerIntegral = (2 * ((A + t) ** 3 - A ** 3)) / 3 + A * A * 0.5 * h
    const v = Math.PI * (R * R * h - vInnerIntegral)
    expect(r.diameter).toBeCloseTo(d2, 9)
    expect(r.thickness).toBeCloseTo(h, 9)
    expect(volumeOf(r.handle)).toBeCloseTo(v, 6)
    // 沉窝让内孔两端比中段宽 → 体积小于「内孔恒为 d1/2」的纯管
    expect(volumeOf(r.handle)).toBeLessThan(Math.PI * (R * R - A * A) * h)
  })

  it('垫圈的尺寸只由 size 解析（washer 不拆 `-`，threadSize === size）', () => {
    const r: WasherResult = plainWasher({ size: 'M6', fastener_type: 'iso7089' })
    expect(r.threadSize).toBe('M6')
    expect(r.threadDiameter).toBe(6)
    expect(r.isMetric).toBe(true)
    expect(r.info).toBe('PlainWasher(iso7089): M6')
  })

  it('非法输入抛错（配合等级 / 规格 / 公制串）', () => {
    expect(() => plainWasher({ size: 'M6', fastener_type: 'nope' })).toThrow(/invalid, must be one of/)
    expect(() => plainWasher({ size: 'M99', fastener_type: 'iso7089' })).toThrow(/invalid, must be one of/)
    expect(() => plainWasher({ size: 'bogus', fastener_type: 'iso7089' })).toThrow(/not an imperial measure/)
  })
})
