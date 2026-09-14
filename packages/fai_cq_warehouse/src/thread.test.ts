/**
 * thread.test.ts — W3 验收（方案 §8「W3 — Thread」）。
 *
 * 验收项（逐条对应方案原文）：
 *  1. `IsoThread` / `AcmeThread` / `MetricTrapezoidalThread` / `PlasticBottleThread`
 *     各 2–3 规格 **STEP 比对通过**；
 *  2. `external` 与 `hand='left'` 各 1 例；
 *  3. 容差标定四步走完（§7.3.1）：实测最坏值 → 分析文档 → 逐类 override
 *     （`src/testing/compare.ts`）→ **反向守卫**（本文件）。
 *
 * 判定入口只有一个：`@faicad/cq-compat` 的 `compareAssemblyFiles`
 * （经 `src/testing/compare.ts` 封装）。容差只在 compare.ts 定义，本文件不写死数字。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids } from '@faicad/faijs-core'
import type { BrepHandle } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'
import {
  acmeThread,
  acmeThreadParseSize,
  acmeThreadSizes,
  buildThread,
  isoThread,
  isoThreadDimensions,
  metricTrapezoidalThread,
  metricTrapezoidalThreadParseSize,
  metricTrapezoidalThreadSizes,
  plasticBottleThread,
  plasticBottleThreadDimensions,
  type ThreadSpec,
} from './thread'
import {
  classifyKnownArtifact,
  compareCase,
  formatCompareLine,
  KNOWN_A_SIDE_COM_ARTIFACTS,
} from './testing/compare'
import { loadManifest, ourStepPath, stepPath, threadCases, OUT_DIR } from './testing/fixtures'
import { buildThreadReference, THREAD_CLASSES } from './testing/reference-options'
import type { Manifest, ManifestCase } from './testing/reference-options'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  mkdirSync(OUT_DIR, { recursive: true })
})

/** 把 B 侧几何导出到 `out/<id>.step`（比对前必须先有 B 侧 STEP）。 */
function exportOurStep(c: ManifestCase): boolean {
  const r = buildThreadReference(c)
  if (!r.handle) return false
  writeFileSync(
    ourStepPath(c.id),
    Buffer.from(exportStepFromSolids(k, [{ solid: r.handle, name: 'SOLID' }])),
  )
  return true
}

const manifest: Manifest = loadManifest()
const cases: ManifestCase[] = threadCases(manifest)

describe('W3 覆盖度自检（验收清单由 manifest 强制，不靠人记）', () => {
  it('manifest 覆盖全部 5 个线程类', () => {
    const seen = new Set(cases.map((c) => c.class))
    for (const cls of THREAD_CLASSES) expect(seen, `class ${cls}`).toContain(cls)
  })

  it('四类具体螺纹各 ≥2 规格（方案 §8 W3 验收 1）', () => {
    for (const cls of ['IsoThread', 'AcmeThread', 'MetricTrapezoidalThread', 'PlasticBottleThread']) {
      const n = cases.filter((c) => c.class === cls).length
      expect(n, `${cls} 规格数`).toBeGreaterThanOrEqual(2)
    }
  })

  it('覆盖 external=False 与 hand="left" 各 ≥1 例（验收 2）', () => {
    expect(cases.filter((c) => c.args['external'] === false).length).toBeGreaterThanOrEqual(1)
    expect(cases.filter((c) => c.args['hand'] === 'left').length).toBeGreaterThanOrEqual(1)
  })

  it('四种端部 finish 都被覆盖，且 chamfer 明确不在几何用例里（已知缺口）', () => {
    const flat = cases.flatMap((c) => (c.args['end_finishes'] as string[] | undefined) ?? [])
    for (const f of ['fade', 'raw', 'square']) expect(flat, `finish ${f}`).toContain(f)
    expect(flat, 'chamfer 未实现，不应有几何用例').not.toContain('chamfer')
  })
})

describe('W3 几何：STEP 等价性（compareAssemblyFiles）', () => {
  it.each(cases.map((c) => [c.id, c] as const))(
    '%s 与 A 侧参考 STEP 等价（或已归因的 A 侧伪差）',
    async (id, c) => {
      expect(exportOurStep(c), `${id} 应有几何（simple=false）`).toBe(true)
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

  it('其余用例不得靠白名单蒙混：白名单必须精确等于当前实际伪差集合', async () => {
    // 反向守卫（对白名单本身）：每个白名单 id 必须①对应用例存在、②当前确实 DIFFERENT
    // 且只有质心一项不合格。A 侧测量一旦被修好，此断言会红 → 强制清理白名单，
    // 避免伪差清单变成永久豁免。
    const ids = Object.keys(KNOWN_A_SIDE_COM_ARTIFACTS)
    expect(ids.length, '白名单非空应至少对应 manifest 里的用例').toBeGreaterThan(0)
    for (const id of ids) {
      const c = cases.find((x) => x.id === id)
      expect(c, `白名单 ${id} 不在 manifest 中（陈旧条目）`).toBeTruthy()
      exportOurStep(c!)
      const r = await compareCase({
        id,
        referenceStep: stepPath(id),
        ourStep: ourStepPath(id),
        refVolume: c!.volume_mesh ?? c!.volume,
      })
      expect(r.equivalent, `${id} 已不再 DIFFERENT —— 请从白名单删除`).toBe(false)
      expect(classifyKnownArtifact(id, r).artifact).toBe(true)
    }
  })
})

describe('W3 容差 override 的反向守卫（§7.3.1 第 4 步：用旧容差跑必须 FAIL）', () => {
  // 线程族的 override 只放宽 volumeRelativeTolerance（1e-6 → 1e-4）。选实测体积差
  // 最大的一例做守卫：旧容差下必须 DIFFERENT，新容差下必须 EQUIVALENT。
  const worst = 'iso-m6x1-internal' // 实测体积相对差 2.289e-5（最大）

  /** 保证 B 侧 STEP 存在（`-t` 过滤单跑时首个用例可能没跑过导出）。 */
  function ensureWorstStep(): void {
    const c = cases.find((x) => x.id === worst)
    expect(c, `${worst} 应在 manifest 中`).toBeTruthy()
    exportOurStep(c!)
  }

  it(`${worst}：沿用全局默认 1e-6 时必须 DIFFERENT（证明 override 是承力的）`, async () => {
    ensureWorstStep()
    const r = await compareCase(
      { id: worst, referenceStep: stepPath(worst), ourStep: ourStepPath(worst), refVolume: 1 },
      { volumeRelativeTolerance: 1e-6 },
    )
    expect(r.equivalent, `若此处已等价，说明 override 已失效或数据变化：${formatCompareLine(r)}`).toBe(
      false,
    )
  })

  it(`${worst}：标定后的逐类容差下必须 EQUIVALENT`, async () => {
    ensureWorstStep()
    const r = await compareCase({
      id: worst,
      referenceStep: stepPath(worst),
      ourStep: ourStepPath(worst),
      refVolume: 1,
    })
    expect(r.equivalent, formatCompareLine(r)).toBe(true)
  })
})

describe('W3 参数派生（纯算术，不建几何）', () => {
  it('isoThreadDimensions：外螺纹 apex=大径/2、内螺纹 apex=minRadius', () => {
    const ext = isoThreadDimensions({ major_diameter: 6, pitch: 1, external: true })
    const int = isoThreadDimensions({ major_diameter: 6, pitch: 1, external: false })
    // h = P/2/tan(30°)；minRadius = (d − 2·(5/8)·h)/2
    const h = 1 / 2 / Math.tan(Math.PI / 6)
    expect(ext.threadAngle).toBe(60)
    expect(ext.hParameter).toBeCloseTo(h, 12)
    expect(ext.apexRadius).toBeCloseTo(3, 12)
    expect(ext.apexWidth).toBeCloseTo(1 / 8, 12)
    expect(ext.rootWidth).toBeCloseTo(3 / 4, 12)
    expect(ext.rootRadius).toBeCloseTo((6 - 2 * (5 / 8) * h) / 2, 12)
    // 内螺纹：apex 与 root 互换，宽度按 1/4、7/8 pitch
    expect(int.apexRadius).toBeCloseTo(ext.minRadius, 12)
    expect(int.rootRadius).toBeCloseTo(3, 12)
    expect(int.apexWidth).toBeCloseTo(1 / 4, 12)
    expect(int.rootWidth).toBeCloseTo(7 / 8, 12)
  })

  it('acmeThreadSizes / acmeThreadParseSize：尺寸串与螺距解析', () => {
    const sizes = acmeThreadSizes()
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes).toContain('1/2')
    const [d0, pitch] = acmeThreadParseSize('1/2')
    expect(d0).toBeCloseTo(12.7, 9) // 0.5 in → mm
    expect(pitch).toBeGreaterThan(0)
    expect(() => acmeThreadParseSize('NoSuchSize')).toThrow()
  })

  it('metricTrapezoidalThreadSizes / parse：标准规格串', () => {
    const sizes = metricTrapezoidalThreadSizes()
    expect(sizes).toContain('40x7')
    const [d0, pitch] = metricTrapezoidalThreadParseSize('40x7')
    expect(d0).toBeCloseTo(40, 12)
    expect(pitch).toBeCloseTo(7, 12)
    expect(() => metricTrapezoidalThreadParseSize('bogus')).toThrow()
  })

  it('plasticBottleThreadDimensions：合法尺寸给出 5 个派生量，非法尺寸抛错', () => {
    const d = plasticBottleThreadDimensions({ size: 'M38SP444' })
    expect(d.diameter).toBe(38)
    expect(d.finish).toBe(444)
    expect(d.style).toBe('M')
    expect(d.pitch).toBeCloseTo(25.4 / 6, 12) // finish 444 → TPI 6
    expect(d.length).toBeGreaterThan(0)
    // 外螺纹：apexRadius = diameterMin/2，rootRadius 更小
    expect(d.apexRadius).toBeCloseTo(36.88 / 2, 12)
    expect(d.rootRadius).toBeLessThan(d.apexRadius)
    expect(() => plasticBottleThreadDimensions({ size: 'X38SP444' })).toThrow()
    expect(() => plasticBottleThreadDimensions({ size: 'M38SP999' })).toThrow()
    // 上游 PBT_FINISH_DATA 的 `200: [1.5, [24.28]]` 是已知上游笔误（直径列写坏），
    // 于是 444 号 finish 不含 200 → M200SP444 判非法。逐字复刻，不"顺手修好"。
    expect(() => plasticBottleThreadDimensions({ size: 'M200SP444' })).toThrow()
  })

  it('manufacturingCompensation：外部螺纹半径减、内部加（thread.py:813）', () => {
    const base = plasticBottleThreadDimensions({ size: 'M38SP444' })
    const comp = plasticBottleThreadDimensions({ size: 'M38SP444', manufacturingCompensation: 0.1 })
    expect(comp.apexRadius).toBeCloseTo(base.apexRadius - 0.1, 12)
    expect(comp.rootRadius).toBeCloseTo(base.rootRadius - 0.1, 12)
    const intBase = plasticBottleThreadDimensions({ size: 'M38SP444', external: false })
    const intComp = plasticBottleThreadDimensions({
      size: 'M38SP444',
      external: false,
      manufacturingCompensation: 0.1,
    })
    expect(intComp.apexRadius).toBeCloseTo(intBase.apexRadius + 0.1, 12)
    expect(intComp.rootRadius).toBeCloseTo(intBase.rootRadius + 0.1, 12)
  })

  it('buildThread：root 半径 fudge（外 −0.001 / 内 +0.001）且 toothHeight 用 fudge 后的值', () => {
    const base: ThreadSpec = {
      apex_radius: 3,
      apex_width: 0.125,
      root_radius: 2.5,
      root_width: 0.75,
      pitch: 1,
      length: 10,
      simple: true,
    }
    const ext = buildThread(base)
    expect(ext.external).toBe(true)
    expect(ext.rootRadius).toBeCloseTo(2.499, 12)
    expect(ext.toothHeight).toBeCloseTo(3 - 2.499, 12)
    const int = buildThread({ ...base, apex_radius: 2.5, root_radius: 3 })
    expect(int.external).toBe(false)
    expect(int.rootRadius).toBeCloseTo(3.001, 12)
    expect(int.toothHeight).toBeCloseTo(3.001 - 2.5, 12)
  })

  it('buildThread(simple=true) 不建几何（handle=null）——先做 simple 全绿的落地路径', () => {
    const r = buildThread({
      apex_radius: 3,
      apex_width: 0.125,
      root_radius: 2.5,
      root_width: 0.75,
      pitch: 1,
      length: 10,
      simple: true,
    })
    expect(r.handle).toBeNull()
    expect(r.simple).toBe(true)
  })

  it('buildThread：hand / finish 非法值抛错；非有限数抛错', () => {
    const ok: ThreadSpec = {
      apex_radius: 3,
      apex_width: 0.125,
      root_radius: 2.5,
      root_width: 0.75,
      pitch: 1,
      length: 10,
      simple: true,
    }
    expect(() => buildThread({ ...ok, hand: 'up' as never })).toThrow(/hand/)
    expect(() => buildThread({ ...ok, end_finishes: ['raw', 'wiggle'] as never })).toThrow()
    expect(() => buildThread({ ...ok, pitch: Number.NaN })).toThrow(/finite/)
  })
})

describe('W3 已知缺口与上游语义复刻（如实记录，不静默跳过）', () => {
  it('end_finishes="chamfer" 显式抛错（已知缺口：内核只有等距 chamfer）', () => {
    const spec: ThreadSpec = {
      apex_radius: 3,
      apex_width: 0.125,
      root_radius: 2.5,
      root_width: 0.75,
      pitch: 1,
      length: 10,
      end_finishes: ['chamfer', 'raw'],
    }
    expect(() => buildThread(spec)).toThrow(/chamfer.*not implemented/)
    expect(() => isoThread({ major_diameter: 6, pitch: 1, length: 10, end_finishes: ['raw', 'chamfer'] })).toThrow(
      /chamfer.*not implemented/,
    )
  })

  it('square/square 复刻上游 bug：只切 z>length 一侧（结果取后一次切割）', () => {
    // 上游 square_off_ends 每次以传入的 cq_object 为基而非累积结果 → 第二次切割
    // 覆盖第一次。A 侧用例 iso-m6x1-square-square 即如此生成（zlen=10.875 而非 9.875）。
    const c = cases.find((x) => x.id === 'iso-m6x1-square-square')
    expect(c, 'manifest 应有该用例').toBeTruthy()
    expect(c!.bbox[2]).toBeCloseTo(10.875, 3)
    const square = buildThreadReference(c!)
    expect(square.handle).toBeTruthy()
    const bb = k.getBoundingBox(square.handle!)
    expect(bb.zmax - bb.zmin).toBeCloseTo(10.875, 3)
  })

  it('reference-options 的 args 白名单：未知键抛错（cq_gears 教训，禁止静默丢弃参数）', () => {
    const bogus: ManifestCase = {
      id: 'bogus',
      class: 'IsoThread',
      args: { major_diameter: 6, pitch: 1, length: 10, no_such_arg: 1 },
      volume: 1,
      bbox: [1, 1, 1],
      step: 'bogus.step',
    }
    expect(() => buildThreadReference(bogus)).toThrow(/unknown arg/)
    const unknownClass: ManifestCase = { ...bogus, class: 'NotAThread', args: {} }
    expect(() => buildThreadReference(unknownClass)).toThrow(/not a thread class/)
  })

  it('AcmeThread / MetricTrapezoidalThread / plasticBottleThread 均能返回几何句柄', () => {
    const handles: Array<BrepHandle | null> = [
      acmeThread({ size: '1/2', length: 10 }).handle,
      metricTrapezoidalThread({ size: '20x4', length: 20 }).handle,
      plasticBottleThread({ size: 'M38SP444' }).handle,
    ]
    for (const h of handles) expect(h).toBeTruthy()
  })
})
