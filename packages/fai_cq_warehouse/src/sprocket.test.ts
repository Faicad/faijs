/**
 * sprocket.test.ts — W7 验收（方案 §8「W7 — Sprocket」）。
 *
 * 验收项（逐条对应方案原文）：
 *  1. 3 个 Sprocket 规格（平齿 16T / 尖齿 16T 英制 / 平齿 32T 带安装孔）**STEP 比对通过**；
 *  2. 派生量（pitch_radius / outer_radius / flat_teeth）锁 A 侧 dump（bbox 实测）；
 *  3. 容差标定四步走完（§7.3.1）：实测最坏值 → 分析 → 逐类 override
 *     （`src/testing/compare.ts`）→ 反向守卫（本文件）。
 *
 * 判定入口只有一个：`@faicad/cq-compat` 的 `compareAssemblyFiles`
 * （经 `src/testing/compare.ts` 封装）。容差只在 compare.ts 定义，本文件不写死数字。
 *
 * 已知几何事实（A/B 探针实测，2026-09-15）：
 *  - 尖齿例（无倒角）与 A 侧逐位一致（STEP 比对 vol 3.4e-12%）；
 *  - 平齿例的无倒角基体与 A 侧逐位一致（6590.2887 both sides），
 *    残差全部来自 cq chamfer 在弧-弧交点角部的近似（override 已归因）。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'
import { buildSprocket } from './sprocket'
import { volumeOf } from './primitives'
import { compareCase, formatCompareLine } from './testing/compare'
import {
  loadManifest,
  ourStepPath,
  sprocketCases,
  stepPath,
  OUT_DIR,
} from './testing/fixtures'
import { buildSprocketReference, SPROCKET_CLASSES } from './testing/reference-options'
import type { Manifest, ManifestCase } from './testing/reference-options'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  mkdirSync(OUT_DIR, { recursive: true })
})

const manifest: Manifest = loadManifest()
const cases: ManifestCase[] = sprocketCases(manifest)

/** 按 id 取用例（缺了就是 manifest 出问题，直接抛）。 */
function caseById(id: string): ManifestCase {
  const c = cases.find((x) => x.id === id)
  if (!c) throw new Error(`${id} 不在 manifest 的 sprocket 用例中`)
  return c
}

/** 把 B 侧几何导出到 `out/<id>.step`（比对前必须先有 B 侧 STEP）。 */
function exportOurStep(c: ManifestCase): boolean {
  const r = buildSprocketReference(c)
  if (!r.handle) return false
  writeFileSync(
    ourStepPath(c.id),
    Buffer.from(exportStepFromSolids(k, [{ solid: r.handle, name: 'SOLID' }])),
  )
  return true
}

describe('W7 链轮覆盖度自检（验收清单由 manifest 强制，不靠人记）', () => {
  it('manifest 覆盖全部链轮类', () => {
    const seen = new Set(cases.map((c) => c.class))
    for (const cls of SPROCKET_CLASSES) expect(seen, `class ${cls}`).toContain(cls)
  })

  it('覆盖方案要求的 3 个规格（含安装孔变体）', () => {
    expect(cases.map((c) => c.id).sort()).toEqual([
      'sprocket-16t',
      'sprocket-16t-inch',
      'sprocket-32t-mount',
    ])
  })
})

/** 派生量真值（A 侧 dump：bbox/2 = outer_radius，bbox 来自 manifest 实测）。 */
const DERIVED: Record<
  string,
  { outerRadius: number; flatTeeth: boolean; thickness: number }
> = {
  'sprocket-16t': { outerRadius: 34.53340128631712, flatTeeth: true, thickness: 2.1336002000000143 },
  'sprocket-16t-inch': { outerRadius: 33.19993997888148, flatTeeth: false, thickness: 2.1336 },
  'sprocket-32t-mount': { outerRadius: 66.76896255735234, flatTeeth: true, thickness: 2.1336002000000374 },
}

describe('W7 派生量回归锁：outerRadius / flatTeeth / thickness（A 侧 dump）', () => {
  it.each(Object.keys(DERIVED).map((id) => [id] as const))(
    '%s：派生量与 A 侧一致',
    (id) => {
      const r = buildSprocketReference(caseById(id))
      const exp = DERIVED[id]!
      expect(r.outerRadius, `${id} outerRadius`).toBeCloseTo(exp.outerRadius, 6)
      expect(r.flatTeeth, `${id} flatTeeth`).toBe(exp.flatTeeth)
      // A 侧 bbox z 含写出器浮点尾差（~2e-7），thickness 断言到 1e-6 即可
      expect(r.thickness, `${id} thickness`).toBeCloseTo(exp.thickness, 6)
    },
  )

  it('平齿判定与上游 arc_list==3 判定一致（flat 例 outer_pt.y>0）', () => {
    // 上游 _make_sprocket 用拉伸体圆边 unique 半径数==3 判定；flat 例必为 3（窝/侧/顶）
    expect(buildSprocketReference(caseById('sprocket-16t')).flatTeeth).toBe(true)
    expect(buildSprocketReference(caseById('sprocket-32t-mount')).flatTeeth).toBe(true)
    expect(buildSprocketReference(caseById('sprocket-16t-inch')).flatTeeth).toBe(false)
  })
})

describe('W7 链轮几何：STEP 等价性（compareAssemblyFiles）', () => {
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
      expect(r.equivalent, formatCompareLine(r)).toBe(true)
    },
  )

  it('尖齿例（无倒角）逐位一致：体积差 < 1e-9 相对', () => {
    const c = caseById('sprocket-16t-inch')
    const r = buildSprocketReference(c)
    const rel = Math.abs(volumeOf(r.handle) - c.volume) / c.volume
    expect(rel, `尖齿例体积相对差 ${rel.toExponential(3)}`).toBeLessThan(1e-9)
  })
})

describe('W7 容差 override 的反向守卫（§7.3.1 第 4 步：用旧容差跑必须 FAIL）', () => {
  // 两个平齿例的 override 依据 = cq chamfer 角部近似 vs 解析锥环切割（见 compare.ts）。
  const flatCases = ['sprocket-16t', 'sprocket-32t-mount']

  it.each(flatCases.map((id) => [id] as const))(
    '%s：沿用全局默认 1e-6 时必须 DIFFERENT（证明 override 是承力的）',
    async (id) => {
      expect(exportOurStep(caseById(id))).toBe(true)
      const c = caseById(id)
      const r = await compareCase(
        {
          id,
          referenceStep: stepPath(id),
          ourStep: ourStepPath(id),
          refVolume: c.volume_mesh ?? c.volume,
        },
        { volumeRelativeTolerance: 1e-6 },
      )
      expect(
        r.equivalent,
        `若此处已等价，说明 override 已失效或 cq chamfer 角部行为已变（重新标定）：${formatCompareLine(r)}`,
      ).toBe(false)
    },
  )
})

describe('W7 输入校验（上游 ValueError 逐字语义）', () => {
  it('num_teeth <= 2 或非整数：抛错', () => {
    expect(() => buildSprocket({ numTeeth: 2 })).toThrow(/greater than 2/)
    expect(() => buildSprocket({ numTeeth: 8.5 })).toThrow(/greater than 2/)
  })

  it('roller_diameter >= chain_pitch：抛错', () => {
    expect(() => buildSprocket({ numTeeth: 16, rollerDiameter: 12.7 })).toThrow(/too large/)
  })
})
