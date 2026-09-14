/**
 * screw.test.ts — W5 验收（方案 §8「W5 — Screw（12 类）」）。
 *
 * 验收项（逐条对应方案原文）：
 *  1. 12 类 × ≥2 规格 **STEP 比对通过**（`M6-1 iso4762` 必过，实测 A 侧 900.684280）；
 *  2. `simple=True/False` 各覆盖；`CounterSunkScrew` 与 `SetScrew` 单列（端部与锥角最易错）；
 *  3. 容差标定四步走完（§7.3.1）：实测最坏值 → 分析文档 → 逐类 override
 *     （`src/testing/compare.ts`）→ **反向守卫**（本文件）。
 *
 * 判定入口只有一个：`@faicad/cq-compat` 的 `compareAssemblyFiles`
 * （经 `src/testing/compare.ts` 封装）。容差只在 compare.ts 定义，本文件不写死数字。
 *
 * ⚠️ **已知缺口（显式抛错，不静默跳过）**：`PanHeadWithCollarScrew`（din967）与
 * `RaisedCheeseHeadScrew`（iso7045）各自的唯一 `fastener_type` 都是 PH（cross）沉孔，
 * 其 30° 锥度切割器在臂宽退化后 A 侧 `LocOpe_DPrism` 续生锥面、本内核 `draftPrism`
 * 自交即抛错（`E_RECESS_TAPER_UNSUPPORTED`，见 `src/recess.ts` 文件头）。
 * manifest 里 4 例（pancollar M6/M4 + raisedcheese M6/M4）用「断言抛错」覆盖，
 * **但头型轮廓仍被逐顶点锁住**（缺口只在 recess）。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { exportStepFromSolids } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'
import { SCREW_TABLES, type ScrewClassName } from './params'
import { buildScrew, screwProfilePoints, type ScrewParams } from './screw'
import { compareCase, classifyKnownArtifact, formatCompareLine } from './testing/compare'
import {
  loadManifest,
  ourStepPath,
  screwCases,
  stepPath,
  OUT_DIR,
} from './testing/fixtures'
import { buildScrewReference, SCREW_CLASSES } from './testing/reference-options'
import type { Manifest, ManifestCase } from './testing/reference-options'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
  mkdirSync(OUT_DIR, { recursive: true })
})

/** W5 内**已知缺口**的螺钉类：manifest 有 A 侧数据，但 B 侧按设计抛错。 */
const W5_GAP_CLASSES = new Set(['PanHeadWithCollarScrew', 'RaisedCheeseHeadScrew'])

/** 可做几何比对的用例（排除已知缺口类）。 */
const comparable = (cs: ManifestCase[]): ManifestCase[] =>
  cs.filter((c) => !W5_GAP_CLASSES.has(c.class))

/** 把 B 侧几何导出到 `out/<id>.step`（比对前必须先有 B 侧 STEP）。 */
function exportOurStep(c: ManifestCase): boolean {
  const r = buildScrewReference(c)
  if (!r.handle) return false
  writeFileSync(
    ourStepPath(c.id),
    Buffer.from(exportStepFromSolids(k, [{ solid: r.handle, name: 'SOLID' }])),
  )
  return true
}

const manifest: Manifest = loadManifest()
const cases: ManifestCase[] = screwCases(manifest)
const geoCases: ManifestCase[] = comparable(cases)

/** 按 id 取用例（缺了就是 manifest 出问题，直接抛）。 */
function caseById(id: string): ManifestCase {
  const c = cases.find((x) => x.id === id)
  if (!c) throw new Error(`${id} 不在 manifest 的 screw 用例中`)
  return c
}

/** 该用例的 TS 侧入参（`args` 逐字取自 manifest）。 */
function paramsOf(c: ManifestCase): ScrewParams {
  return {
    size: String(c.args['size']),
    length: Number(c.args['length']),
    fastener_type: String(c.args['fastener_type']),
    hand: c.args['hand'] as ScrewParams['hand'],
    simple: c.args['simple'] as boolean | undefined,
  }
}

/** XZ 顶点：局部 x→半径、y→轴向。 */
interface P {
  x: number
  y: number
}

/** 顶点去重（6 位小数等价视为同一点）+ 按 (x,y) 升序——与 dump 的边序无关。 */
function uniqueSorted(pts: P[]): P[] {
  const map = new Map<string, P>()
  for (const p of pts) {
    const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`
    if (!map.has(key)) map.set(key, p)
  }
  return [...map.values()].sort((a, b) => a.x - b.x || a.y - b.y)
}

/**
 * 顶点集合等价断言（顺序无关、可重复）。
 *
 * 期望值取自 A 侧 probe dump（`scripts/probe-screw-head-profiles.py`）：
 * dump 打印 `%.6f`，故容差取 5e-6
 * ——比它宽 10×、比要抓的几何错（选错角点 ≥1e-3）紧 200×。
 * @param actual - B 侧轮廓顶点。
 * @param expected - A 侧 dump 的边端点（可含重复）。
 */
function expectVertexSet(actual: P[], expected: P[]): void {
  const a = uniqueSorted(actual)
  const e = uniqueSorted(expected)
  expect(a.map((p) => [p.x, p.y]), `顶点集（实际）`).toHaveLength(e.length)
  a.forEach((p, i) => {
    expect(p.x, `顶点 #${i}.x`).toBeCloseTo(e[i]!.x, 5)
    expect(p.y, `顶点 #${i}.y`).toBeCloseTo(e[i]!.y, 5)
  })
}

describe('W5 螺钉覆盖度自检（验收清单由 manifest 强制，不靠人记）', () => {
  it('manifest 覆盖全部 12 个螺钉类', () => {
    const seen = new Set(cases.map((c) => c.class))
    for (const cls of SCREW_CLASSES) expect(seen, `class ${cls}`).toContain(cls)
  })

  it('每类 ≥2 规格（M6-1 iso4762 必过，A 侧实测 900.684280）', () => {
    for (const cls of SCREW_CLASSES) {
      const n = cases.filter((c) => c.class === cls).length
      expect(n, `${cls} 规格数`).toBeGreaterThanOrEqual(2)
    }
    const m6 = caseById('screw-shcs-m6-iso4762')
    expect(m6.volume).toBeCloseTo(900.6842796, 4)
  })

  it('12 类全部有 `head_profile`（SetScrew 例外：无头 custom_make）', () => {
    for (const cls of SCREW_CLASSES) {
      const c = cases.find((x) => x.class === cls)!
      const pts = screwProfilePoints(cls as ScrewClassName, paramsOf(c))
      if (cls === 'SetScrew') expect(pts, cls).toHaveLength(0)
      else expect(pts.length, `${cls} 轮廓顶点数`).toBeGreaterThanOrEqual(4)
    }
  })

  it('覆盖 simple=false（带螺纹）≥1 例；`SCREW_TABLES` 键与本文件的清单一致', () => {
    expect(cases.filter((c) => c.args['simple'] === false).length).toBeGreaterThanOrEqual(1)
    expect(Object.keys(SCREW_TABLES)).toEqual([...SCREW_CLASSES])
  })

  it('CounterSunkScrew 与 SetScrew 各自 ≥2 例（方案 §8-W5 验收 2「单列」）', () => {
    for (const cls of ['CounterSunkScrew', 'SetScrew']) {
      expect(cases.filter((c) => c.class === cls).length, cls).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('W5 头型轮廓：逐顶点回归锁（A 侧 probe dump 的边端点）', () => {
  it('ButtonHeadScrew：vLineTo(k) → hLineTo(dl/2) → radiusArc((dk/2,0), rf) → hLineTo(0)', () => {
    expectVertexSet(screwProfilePoints('ButtonHeadScrew', paramsOf(caseById('screw-button-m6-iso7380_1'))), [
      { x: 0, y: 0 },
      { x: 0, y: 3.3 },
      { x: 3, y: 3.3 },
      { x: 5.25, y: 0 },
    ])
    expectVertexSet(screwProfilePoints('ButtonHeadScrew', paramsOf(caseById('screw-button-m4-iso7380_1'))), [
      { x: 0, y: 0 },
      { x: 0, y: 2.2 },
      { x: 1.9, y: 2.2 },
      { x: 3.8, y: 0 },
    ])
  })

  it('ButtonHeadWithCollarScrew：fillet2D(0.45c) 落在 vertices(">X") 的**两个**顶点（dc/2,c 与 dc/2,0）', () => {
    // 圆角半径 0.45*1.2 = 0.54，切点距角 0.54：6.8−0.54 = 6.26、1.2−0.54 = 0.66、0−(−0.54) = 0.54
    expectVertexSet(
      screwProfilePoints('ButtonHeadWithCollarScrew', paramsOf(caseById('screw-buttoncollar-m6-iso7380_2'))),
      [
        { x: 0, y: 0 },
        { x: 0, y: 3.3 },
        { x: 3, y: 3.3 },
        { x: 5, y: 1.2 },
        { x: 6.26, y: 1.2 },
        { x: 6.8, y: 0.66 },
        { x: 6.8, y: 0.54 },
        { x: 6.26, y: 0 },
      ],
    )
  })

  it('CheeseHeadScrew：5° 内倾母线 + fillet2D(0.25k)（iso1207 slot / iso14580 T 同头型，k 不同）', () => {
    expectVertexSet(screwProfilePoints('CheeseHeadScrew', paramsOf(caseById('screw-cheese-m6-iso1207'))), [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 4.667711, y: 3.798079 },
      { x: 3.696421, y: 4.688102 },
      { x: 0, y: 4.688102 },
    ])
    expectVertexSet(screwProfilePoints('CheeseHeadScrew', paramsOf(caseById('screw-cheese-m6-iso14580'))), [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 4.62511, y: 4.285012 },
      { x: 3.529296, y: 5.289141 },
      { x: 0, y: 5.289141 },
    ])
  })

  it('CounterSunkScrew：polarLine(k/cos(a/2), −90−a/2) 的 90° 母线 + fillet2D(0.075k)', () => {
    expectVertexSet(screwProfilePoints('CounterSunkScrew', paramsOf(caseById('screw-csk-m6-iso10642'))), [
      { x: 0, y: 0 },
      { x: 0, y: 3.3 },
      { x: 5.402482, y: 3.3 },
      { x: 5.577491, y: 2.877491 },
      { x: 2.7, y: 0 },
    ])
    expectVertexSet(screwProfilePoints('CounterSunkScrew', paramsOf(caseById('screw-csk-m6-iso2009'))), [
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: 4.956802, y: 3 },
      { x: 5.115901, y: 2.615901 },
      { x: 2.5, y: 0 },
    ])
  })

  it('HexHead / HexHeadWithFlange：15° 顶倒角（e = polygonDiagonal(s,6)、cs = (e−s)tan15°/2）', () => {
    const hex = [
      { x: 0, y: 0 },
      { x: 5.773503, y: 0 },
      { x: 5.773503, y: 4.032741 },
      { x: 5, y: 4.24 },
      { x: 0, y: 4.24 },
    ]
    expectVertexSet(screwProfilePoints('HexHeadScrew', paramsOf(caseById('screw-hexhead-m6-iso4017'))), hex)
    expectVertexSet(
      screwProfilePoints('HexHeadWithFlangeScrew', paramsOf(caseById('screw-hexflange-m6-din1665'))),
      [
        { x: 0, y: 0 },
        { x: 5.773503, y: 0 },
        { x: 5.773503, y: 6.392741 },
        { x: 5, y: 6.6 },
        { x: 0, y: 6.6 },
      ],
    )
    // ⚠️ iso4017(k=4.24) 与 iso4014(k=4) 头型公式同、只是 k 不同
    expectVertexSet(screwProfilePoints('HexHeadScrew', paramsOf(caseById('screw-hexhead-m6-iso4014'))), [
      { x: 0, y: 0 },
      { x: 5.773503, y: 0 },
      { x: 5.773503, y: 3.792741 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ])
  })

  it('HexHeadWithFlange 的 flange_profile：25° 切线弧（radiusArc(tangent_point, −c/2)）', () => {
    // flange 不在 `screwProfilePoints` 通道上（它是独立轮廓），此处只锁头型；
    // 法兰几何由 STEP 比对（screw-hexflange-*）覆盖。
    const c = caseById('screw-hexflange-m6-din1665')
    expect(buildScrew('HexHeadWithFlangeScrew', paramsOf(c)).handle).not.toBeNull()
  })

  it('PanHeadScrew：spline 头型（切线 (−sin5°,cos5°)/(−1,0)，端点 (dk/2,0)→(dk·0.25,k)）', () => {
    expectVertexSet(screwProfilePoints('PanHeadScrew', paramsOf(caseById('screw-pan-m6-iso1580'))), [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 3, y: 3.6 },
      { x: 0, y: 3.6 },
    ])
    expectVertexSet(screwProfilePoints('PanHeadScrew', paramsOf(caseById('screw-pan-m4-iso1580'))), [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 2.4 },
      { x: 0, y: 2.4 },
    ])
  })

  it('PanHeadWithCollarScrew：flat = √((k−c)(2rf−(k−c))) 处的 −rf 优弧（缺口类也可锁头型）', () => {
    expectVertexSet(
      screwProfilePoints('PanHeadWithCollarScrew', paramsOf(caseById('screw-pancollar-m6-din967'))),
      [
        { x: 0, y: 0 },
        { x: 7.25, y: 0 },
        { x: 7.25, y: 1.8 },
        { x: 6.126785, y: 1.8 },
        { x: 0, y: 4.55 },
      ],
    )
  })

  it('RaisedCheeseHeadScrew：oval_height = rf − √(4rf²−dk²)/2', () => {
    expectVertexSet(
      screwProfilePoints('RaisedCheeseHeadScrew', paramsOf(caseById('screw-raisedcheese-m6-iso7045'))),
      [
        { x: 0, y: 0 },
        { x: 0, y: 4.6 },
        { x: 6, y: 2.6 },
        { x: 6, y: 0 },
      ],
    )
  })

  it('RaisedCounterSunkOvalHeadScrew：椭圆顶（rf 优弧）+ 锥面母线 + fillet2D(0.075k)', () => {
    expectVertexSet(screwProfilePoints('RaisedCounterSunkOvalHeadScrew', paramsOf(caseById('screw-rcos-m6-iso2010'))), [
      { x: 0, y: 0 },
      { x: 0, y: 2.834635 },
      { x: 5.361036, y: 1.570524 },
      { x: 5.390325, y: 1.390325 },
      { x: 4, y: 0 },
    ])
    expectVertexSet(screwProfilePoints('RaisedCounterSunkOvalHeadScrew', paramsOf(caseById('screw-rcos-m6-iso14584'))), [
      { x: 0, y: 0 },
      { x: 0, y: 5.086773 },
      { x: 6.024877, y: 3.464676 },
      { x: 6.075623, y: 3.075623 },
      { x: 3, y: 0 },
    ])
  })

  it('SocketHeadCapScrew：rect(dk/2, k) + fillet2D(0.075k)（圆角在 (dk/2, k)）', () => {
    expectVertexSet(screwProfilePoints('SocketHeadCapScrew', paramsOf(caseById('screw-shcs-m6-iso4762'))), [
      { x: 0, y: 0 },
      { x: 5.11, y: 0 },
      { x: 5.11, y: 5.55 },
      { x: 4.66, y: 6 },
      { x: 0, y: 6 },
    ])
    expectVertexSet(screwProfilePoints('SocketHeadCapScrew', paramsOf(caseById('screw-shcs-m4-iso4762'))), [
      { x: 0, y: 0 },
      { x: 3.61, y: 0 },
      { x: 3.61, y: 3.7 },
      { x: 3.31, y: 4 },
      { x: 0, y: 4 },
    ])
  })
})

describe('W5 派生量回归锁：head_height / head_diameter / min_hole_depth（A 侧 dump）', () => {
  // head_height = head.val().BoundingBox().zmax（**未** translate 前）
  // head_diameter = 2·max(bb.xmax, bb.ymax)；min_hole_depth = length + k − length_offset
  const rows: Array<[string, number, number, number]> = [
    ['screw-button-m6-iso7380_1', 3.3, 10.5, 19.3],
    ['screw-buttoncollar-m6-iso7380_2', 3.3, 13.6, 19.3],
    ['screw-cheese-m6-iso1207', 4.68810201899028, 10.0, 28.9],
    ['screw-cheese-m6-iso14580', 5.289140626553138, 10.0, 29.4],
    ['screw-csk-m6-iso10642', 3.3, 11.299964486625317, 20.0],
    ['screw-csk-m6-iso14582', 4.22, 12.20480301501783, 20.0],
    ['screw-hexhead-m6-iso4017', 4.24, 11.547005383792516, 34.24],
    ['screw-hexflange-m6-din1665', 6.6, 14.2000002, 31.6],
    ['screw-pan-m6-iso1580', 3.6, 12.0, 23.6],
    ['screw-rcos-m6-iso2010', 2.7965741932161774, 10.846551866090884, 20.0],
    ['screw-shcs-m6-iso4762', 6.0, 10.22, 31.0],
  ]

  it.each(rows)('%s：head_height / head_diameter / min_hole_depth 对齐 A 侧', (id, h, dia, mhd) => {
    const r = buildScrew(caseById(id).class as ScrewClassName, paramsOf(caseById(id)))
    expect(r.headHeight, `${id} head_height`).toBeCloseTo(h, 4)
    expect(r.headDiameter, `${id} head_diameter`).toBeCloseTo(dia, 4)
    expect(r.minHoleDepth, `${id} min_hole_depth`).toBeCloseTo(mhd, 6)
  })

  it('SetScrew：无头（head_height = head_diameter = 0），min_hole_depth 为 null（上游 countersink_profile → None）', () => {
    const r = buildScrew('SetScrew', paramsOf(caseById('screw-setscrew-m6-iso4026')))
    expect(r.headHeight).toBe(0)
    expect(r.headDiameter).toBe(0)
    expect(r.headOffset).toBeNull()
    expect(r.minHoleDepth).toBeNull()
    expect(r.minHoleDepthStraight).toBe(12)
  })

  it('CounterSunk / RCOS：length_offset = k（头高计入总长）', () => {
    const csk = buildScrew('CounterSunkScrew', paramsOf(caseById('screw-csk-m6-iso10642')))
    expect(csk.maxThreadLength).toBeCloseTo(20 - 3.3, 9)
    const rcos = buildScrew('RaisedCounterSunkOvalHeadScrew', paramsOf(caseById('screw-rcos-m6-iso2010')))
    expect(rcos.maxThreadLength).toBeCloseTo(20 - 1.5, 9)
    // length_offset >= length 时上游同文抛错
    expect(() =>
      buildScrew('CounterSunkScrew', { size: 'M6-1', length: 3, fastener_type: 'iso10642' }),
    ).toThrow(/<= countersunk screw head/)
  })
})

describe('W5 螺钉几何：STEP 等价性（compareAssemblyFiles）', () => {
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

describe('W5 已知缺口：PH（cross）沉孔的 30° 锥度切割器', () => {
  const gaps = cases.filter((c) => W5_GAP_CLASSES.has(c.class))

  it('manifest 覆盖 4 例（pancollar 2 + raisedcheese 2），且都为 PH 类型', () => {
    expect(gaps.length).toBe(4)
    for (const c of gaps) {
      const row = SCREW_TABLES[c.class as ScrewClassName][String(c.args['size'])]!
      const recess = row[`${String(c.args['fastener_type'])}:recess`]
      expect(String(recess).startsWith('PH'), `${c.id} recess=${String(recess)}`).toBe(true)
    }
  })

  it.each(gaps.map((c) => [c.id, c] as const))(
    '%s：B 侧显式抛 E_RECESS_TAPER_UNSUPPORTED（不静默近似）',
    (id, c) => {
      expect(() => exportOurStep(c), `${id} 应抛缺口错`).toThrow(/E_RECESS_TAPER_UNSUPPORTED/)
    },
  )

  it('缺口只在 recess：两类的 head_profile 与 A 侧逐顶点一致（见上面的轮廓锁）', () => {
    for (const c of gaps) {
      const pts = screwProfilePoints(c.class as ScrewClassName, paramsOf(c))
      expect(pts.length, `${c.id} 轮廓顶点数`).toBeGreaterThanOrEqual(4)
    }
  })
})

describe('W5 容差 override 的反向守卫（§7.3.1 第 4 步：用旧容差跑必须 FAIL）', () => {
  // 螺钉族目前唯一的 override 是 simple=false（真实螺纹段）的用例。
  const worst = 'screw-shcs-m6-iso4762-threaded'

  it(`${worst}：沿用全局默认 1e-6 时必须 DIFFERENT（证明 override 是承力的）`, async () => {
    expect(exportOurStep(caseById(worst))).toBe(true)
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
    expect(exportOurStep(caseById(worst))).toBe(true)
    const r = await compareCase({
      id: worst,
      referenceStep: stepPath(worst),
      ourStep: ourStepPath(worst),
      refVolume: 1,
    })
    expect(r.equivalent, formatCompareLine(r)).toBe(true)
  })
})

describe('W5 纯算术与「错误理解」守卫（读上游源码逐条复现）', () => {
  const DEG = Math.PI / 180

  it('CheeseHead 的 `k / cos(degrees(5))` 单位怪癖：负长度 + −85° 叠加 = 沿 5° 内倾母线向上', () => {
    // 上游写 `polarLine(k / cos(degrees(5)), 5 - 90)`；`math.degrees(5)` = 286.4789
    // 被当**弧度**喂给 cos → 负值 → 长度为负。若「修正」成 cos(radians(5))（正长度），
    // 端点会落到 (5.341, −3.9)，几何完全错——这条锁把「不许顺手改正」钉住。
    const k = 3.9
    const quirkLen = k / Math.cos((5 * 180) / Math.PI)
    expect(quirkLen).toBeLessThan(0)
    expect(quirkLen * Math.sin(-85 * DEG), '端点 y（= A 侧 4.688102）').toBeCloseTo(4.688102, 5)
    const naiveLen = k / Math.cos(5 * DEG)
    expect(naiveLen * Math.sin(-85 * DEG), '「修正后」的端点 y').toBeCloseTo(-3.9, 6)
  })

  it('RCOS 的 `edges(">Z")` 排序键是**圆弧质心**（2.386）而非圆心（−9.165）', () => {
    // A 侧 probe：优弧起点 (0, 2.834635) →mid(2.754028, 2.514333)→ 未倒角的腿端 (5.5, 1.5)，r = 12。
    // 该弧的圆心落在 (≈0, −9.165)：拿它当排序键会让 `edges(">Z")` 选错边，
    // 从而把圆角倒到轴线角点上（几何全错）。正确键是**弧质心**。
    // （三点外接圆取自 dump 的 6 位小数，故圆心 −9.165350 与精确解 −9.165365 差 1.5e-5。）
    const a: P = { x: 0, y: 2.834635 }
    const m: P = { x: 2.754028, y: 2.514333 }
    const b: P = { x: 5.5, y: 1.5 }
    const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y))
    const sa = a.x * a.x + a.y * a.y
    const sm = m.x * m.x + m.y * m.y
    const sb = b.x * b.x + b.y * b.y
    const c: P = {
      x: (sa * (m.y - b.y) + sm * (b.y - a.y) + sb * (a.y - m.y)) / d,
      y: (sa * (b.x - m.x) + sm * (a.x - b.x) + sb * (m.x - a.x)) / d,
    }
    expect(c.x, '圆心 x').toBeCloseTo(0, 4)
    expect(c.y, '圆心 z').toBeCloseTo(-9.16535, 4)
    // 弧质心 = 圆心 + (2R·sin(Δ/2)/Δ)·单位弧中点向量
    const r = 12
    const t0 = Math.atan2(a.y - c.y, a.x - c.x)
    const t1 = Math.atan2(b.y - c.y, b.x - c.x)
    let sweep = t1 - t0
    if (sweep > 0) sweep -= 2 * Math.PI
    const amp = (2 * r * Math.sin(Math.abs(sweep) / 2)) / Math.abs(sweep)
    const cz = c.y + amp * Math.sin(t0 + sweep / 2)
    expect(cz, '弧质心 z').toBeCloseTo(2.386, 2)
    // 选择器判定：弧质心 > vLineTo 中点（k+oval_height)/2 = 1.4173 > 其余边
    expect(cz).toBeGreaterThan((2.834635 + 0) / 2)
    expect(cz).toBeLessThan(2.834635)
  })

  it('SetScrew：core = 圆柱(min_radius) − 六角沉孔（外接圆 e、深 t）', () => {
    const c = caseById('screw-setscrew-m6-iso4026')
    const r = buildScrew('SetScrew', paramsOf(c))
    expect(r.handle).not.toBeNull()
    // 六角外接圆 e = polygonDiagonal(3, 6) = 3/cos(30°) = 3.4641016，深 t = 3.5
    expect(3 / Math.cos(Math.PI / 6)).toBeCloseTo(3.4641016151377544, 12)
    // A 侧整件体积（含六角窝）200.625411；无窝的实心圆柱必然更大 → 窝确实是**减**出来的
    const e = 3 / Math.cos(Math.PI / 6)
    const solidCyl = Math.PI * (r.threadDiameter / 2 - (5 / 8) * (Math.sqrt(3) / 2) * r.threadPitch) ** 2 * 12
    expect(c.volume).toBeCloseTo(200.625411, 5)
    expect(solidCyl, '实心圆柱（无窝）体积').toBeGreaterThan(c.volume)
    expect(e / 2).toBeLessThan(r.threadDiameter / 2 - (5 / 8) * (Math.sqrt(3) / 2) * r.threadPitch)
  })

  it('参数校验：尺寸格式 / fastener_type / hand 三条错误信息与上游同文', () => {
    expect(() => buildScrew('HexHeadScrew', { size: 'M6', length: 20, fastener_type: 'iso4017' })).toThrow(
      /must be formatted as size-pitch or size-TPI/,
    )
    expect(() =>
      buildScrew('HexHeadScrew', { size: 'M6-1', length: 20, fastener_type: 'nope' }),
    ).toThrow(/nope invalid, must be one of/)
    expect(() =>
      buildScrew('HexHeadScrew', { size: 'M6-1', length: 20, fastener_type: 'iso4017', hand: 'up' as never }),
    ).toThrow(/invalid, must be one of 'left' or 'right'/)
    expect(() =>
      buildScrew('HexHeadScrew', { size: 'M99-1', length: 20, fastener_type: 'iso4017' }),
    ).toThrow(/M99-1 invalid, must be one of/)
  })

  it('左手螺纹：simple=true 时几何与右手相同（上游同理，几何差异只在螺纹段）', () => {
    const right = buildScrew('CounterSunkScrew', paramsOf(caseById('screw-csk-m6-iso10642')))
    const left = buildScrew('CounterSunkScrew', paramsOf(caseById('screw-csk-m6-iso10642-left')))
    expect(left.hand).toBe('left')
    expect(left.maxThreadLength).toBe(right.maxThreadLength)
    expect(left.info).toContain('left hand thread')
    expect(caseById('screw-csk-m6-iso10642-left').volume).toBeCloseTo(
      caseById('screw-csk-m6-iso10642').volume,
      9,
    )
  })
})
