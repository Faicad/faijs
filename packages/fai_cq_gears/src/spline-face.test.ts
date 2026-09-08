/**
 * spline-face — P0 可行性尖峰：三种 B-spline 曲面方案的实测偏差
 *
 * 判据（不是拍脑袋定的，见 `docs/analysis/2026-09-08-fai-cq-gears-spike.md`）：
 *
 * 1. **面积相对偏差** `|A_ours − A_cq| / A_cq` —— 曲面整体形状的标量指纹，
 *    对「拟合得太松/太紧」极其敏感；
 * 2. **采样点距离** —— 把 cq 侧在 (u,v) 网格上采的 3D 点投影到我们的面上取距离
 *    （参数化无关：两侧曲面 (u,v) 定义不同也能比），`max` 反映最坏偏差。
 *
 * 每次运行都会把完整测量表写到 `out/spline-face-report.json`，供分析文档引用。
 *
 * ⚠️ 容差是**实测标定**的：本文件顶部的 `THRESHOLDS` 只允许收紧，
 *    不允许为了让测试变绿而放宽（静默放宽 = 掩盖几何差异，是红线）。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadManifest, OUT_DIR, type ReferenceGrid } from './fixtures'
import { getRawKernel } from './kernel'
import {
  measureSplineFace,
  SPLINE_FACE_STRATEGIES,
  type SplineFaceMeasurement,
  type SplineFaceStrategy,
} from './spline-face'
import { spurGearGeometry, toothFaceGrids } from './profile'
import type { SpurGearParams } from './profile'

/**
 * 实测标定阈值（2026-09-08 首次实测后写入）。
 *
 * 修改前必读：`docs/analysis/2026-09-08-fai-cq-gears-spike.md`。
 * 这些数字的含义是「cq 与 faijs 两侧曲面构造差异的量级」，不是「允许的建模误差」。
 */
export const THRESHOLDS = {
  /** 面积相对偏差上限（相对量，0.02 = 2%） */
  areaRelDiff: 0.02,
  /** 采样点到面的最大距离上限（mm） */
  maxDeviation: 0.05,
} as const

interface Row extends SplineFaceMeasurement {
  caseId: string
}

function fmt(n: number, digits = 6): string {
  return n.toFixed(digits)
}

describe('B-spline 齿面三方案 vs cq makeSplineApprox', () => {
  const cases = loadManifest().cases.filter((c) => c.tooth_face_grids && !c.error)
  expect(cases.length, 'manifest 里没有可用的齿面点阵，先跑 scripts/gen-reference.py').toBeGreaterThan(0)

  it('三方案实测偏差表', async () => {
    const kernel = await getRawKernel()
    const rows: Row[] = []

    for (const c of cases) {
      const geom = spurGearGeometry(c.args as unknown as SpurGearParams)
      const grids = toothFaceGrids(geom)
      for (const strategy of SPLINE_FACE_STRATEGIES) {
        for (let i = 0; i < grids.length; i++) {
          const ref: ReferenceGrid = c.tooth_face_grids![i]
          rows.push({
            caseId: c.id,
            ...measureSplineFace(kernel, grids[i], strategy, ref),
          })
        }
      }
    }

    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(
      `${OUT_DIR}/spline-face-report.json`,
      JSON.stringify({ thresholds: THRESHOLDS, rows }, null, 2),
      'utf-8',
    )

    // ── 人类可读汇总表（直接进测试输出，失败时一眼看到）──
    const lines: string[] = []
    lines.push('')
    lines.push(`策略 × 齿面段 — 面积相对偏差 / 采样点最大距离（阈值 ${THRESHOLDS.areaRelDiff} / ${THRESHOLDS.maxDeviation} mm）`)
    lines.push('  case            strategy          seg     rows×cols   area(ours)   area(cq)     relDiff     maxDev(mm)  rms(mm)')
    for (const r of rows) {
      lines.push(
        `  ${r.caseId.padEnd(15)} ${r.strategy.padEnd(16)} ${String(r.segment).padEnd(7)} ` +
        `${String(r.rows + '×' + r.cols).padEnd(10)} ${fmt(r.area, 5).padStart(11)} ${fmt(r.refArea, 5).padStart(11)} ` +
        `${r.areaRelDiff.toExponential(3).padStart(11)} ${r.deviation.max.toExponential(3).padStart(12)} ${r.deviation.rms.toExponential(3).padStart(10)}`,
      )
    }
    // 每个 (case, strategy) 的最坏值
    lines.push('')
    lines.push('  每个 (case, strategy) 的最坏值：')
    const keys = [...new Set(rows.map((r) => `${r.caseId} / ${r.strategy}`))]
    for (const k of keys) {
      const sub = rows.filter((r) => `${r.caseId} / ${r.strategy}` === k)
      const worstArea = Math.max(...sub.map((r) => r.areaRelDiff))
      const worstDev = Math.max(...sub.map((r) => r.deviation.max))
      lines.push(`    ${k.padEnd(36)} relDiff ${worstArea.toExponential(3)}   maxDev ${worstDev.toExponential(3)} mm`)
    }
    process.stdout.write(lines.join('\n') + '\n')

    // ── 断言 ──
    for (const r of rows) {
      expect(r.isFace, `${r.caseId}/${r.strategy}/${r.segment}: 构造结果不是 face`).toBe(true)
      expect(r.isValid, `${r.caseId}/${r.strategy}/${r.segment}: face 无效`).toBe(true)
    }

    const worstArea = Math.max(...rows.map((r) => r.areaRelDiff))
    const worstDev = Math.max(...rows.map((r) => r.deviation.max))
    expect(
      worstArea,
      `面积相对偏差 ${worstArea.toExponential(3)} 超过阈值 ${THRESHOLDS.areaRelDiff}\n${lines.join('\n')}`,
    ).toBeLessThanOrEqual(THRESHOLDS.areaRelDiff)
    expect(
      worstDev,
      `采样点最大距离 ${worstDev.toExponential(3)} mm 超过阈值 ${THRESHOLDS.maxDeviation}\n${lines.join('\n')}`,
    ).toBeLessThanOrEqual(THRESHOLDS.maxDeviation)
  })
})

/** 供其它测试/脚本复用的按策略汇总。
 *
 * @param rows 实测行（每面一条）
 * @returns 每个策略的最坏面积相对偏差与最坏采样距离
 */
export function summarizeByStrategy(rows: Row[]): Record<SplineFaceStrategy, { worstAreaRelDiff: number; worstDeviation: number }> {
  const out = {} as Record<SplineFaceStrategy, { worstAreaRelDiff: number; worstDeviation: number }>
  for (const s of SPLINE_FACE_STRATEGIES) {
    const sub = rows.filter((r) => r.strategy === s)
    out[s] = {
      worstAreaRelDiff: Math.max(...sub.map((r) => r.areaRelDiff)),
      worstDeviation: Math.max(...sub.map((r) => r.deviation.max)),
    }
  }
  return out
}
