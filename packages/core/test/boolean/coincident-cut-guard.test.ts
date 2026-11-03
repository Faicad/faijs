/**
 * boolean/coincident-cut-guard — 布尔减「贴面减除」防护（方案 2026-11-03 L3）。
 *
 * 判定范围是纯 bbox 数学（`detectCoincidentShells`），不依赖真实 BREP 内核；kernel
 * 侧行为（fuse 薄壳后正确切除）已由 copy1 共面变体 + 零体积探针在 CLI 全流程验证。
 *
 * 核心断言（用户裁定「正确行为是默认」）：
 * - 零体积相交（tool 完全在 base 外、底面贴 base 顶面 / 顶面贴 base 底面）⇒ 修正；
 * - 侵入 + 贴齐（槽底=板底、全厚贯穿孔，交叠为正体积）⇒ 不修正（内核对共面边界
 *   处理正常，外扩是噪音）；
 * - 正常侵入 ⇒ 零成本跳过。
 */

import { describe, it, expect } from 'vitest'
import { detectCoincidentShells, COINCIDENT_EPS } from '../../src/api/internal/coincident-cut'
import type { BrepBoundingBox } from '../../src/brep/engine/types'

/** base：x∈[-50,50]、y∈[-50,50]、z∈[-5,5]（板顶 z=5、板底 z=-5）。 */
const BASE: BrepBoundingBox = { xmin: -50, ymin: -50, zmin: -5, xmax: 50, ymax: 50, zmax: 5 }

function box(xmin: number, ymin: number, zmin: number, xmax: number, ymax: number, zmax: number): BrepBoundingBox {
  return { xmin, ymin, zmin, xmax, ymax, zmax }
}

describe('detectCoincidentShells（L3 默认自动规避）', () => {
  it('零体积相交：tool 底面贴 base 顶面 ⇒ z-min 侧外扩 ε', () => {
    // tool z∈[5,10]（底面 z=5 == base 顶面 5，完全在 base 外上方）
    const shells = detectCoincidentShells(BASE, box(-10, -10, 5, 10, 10, 10), COINCIDENT_EPS)
    expect(shells).toHaveLength(1)
    expect(shells[0]!.axis).toBe('z')
    expect(shells[0]!.side).toBe('min')
    // 薄壳 z∈[4.99,5]：把 tool 底面压进 base 0.01
    expect(shells[0]!.corner1.z).toBeCloseTo(5 - COINCIDENT_EPS, 6)
    expect(shells[0]!.corner2.z).toBeCloseTo(5, 6)
  })

  it('零体积相交：tool 顶面贴 base 底面 ⇒ z-max 侧外扩 ε', () => {
    // tool z∈[-10,-5]（顶面 z=-5 == base 底面 -5，完全在 base 外下方）
    const shells = detectCoincidentShells(BASE, box(-10, -10, -10, 10, 10, -5), COINCIDENT_EPS)
    expect(shells).toHaveLength(1)
    expect(shells[0]!.side).toBe('max')
    expect(shells[0]!.corner1.z).toBeCloseTo(-5, 6)
    expect(shells[0]!.corner2.z).toBeCloseTo(-5 + COINCIDENT_EPS, 6)
  })

  it('侵入 + 贴齐（槽底=板底）：tool 已侵入、顶面贴 base 顶面 ⇒ 不修正', () => {
    // tool z∈[3,5]：已侵入 base（交叠 z[3,5]），顶面 z=5 贴 base 顶面 5
    // copy1 ⑤ 横带 / ⑦ 孔同性质：内核正确处理，外扩纯属噪音。
    expect(detectCoincidentShells(BASE, box(-10, -10, 3, 10, 10, 5), COINCIDENT_EPS)).toHaveLength(0)
  })

  it('侵入 + 贴齐（全厚贯穿孔）：tool 底面贴 base 底面 ⇒ 不修正', () => {
    // tool z∈[-5,3]：底面 z=-5 贴 base 底面 -5，已侵入
    expect(detectCoincidentShells(BASE, box(-10, -10, -5, 10, 10, 3), COINCIDENT_EPS)).toHaveLength(0)
  })

  it('正常侵入（无贴面）⇒ 零成本跳过', () => {
    // tool z∈[-2,2]，完全在 base 内
    expect(detectCoincidentShells(BASE, box(-10, -10, -2, 10, 10, 2), COINCIDENT_EPS)).toHaveLength(0)
  })

  it('clearance ≤ 0 ⇒ 显式关闭，永不修正', () => {
    // 即使零体积贴面，clearance:0 也要回到旧行为（诊断照常）
    expect(detectCoincidentShells(BASE, box(-10, -10, 5, 10, 10, 10), 0)).toHaveLength(0)
    expect(detectCoincidentShells(BASE, box(-10, -10, 5, 10, 10, 10), -1)).toHaveLength(0)
  })

  it('贴面距 < clearance（制造级 0.1）也修正', () => {
    // 制造级 clearance 0.1：tool 底面 z=5.05 距 base 顶面 0.05 < 0.1，判贴面
    const shells = detectCoincidentShells(BASE, box(-10, -10, 5.05, 10, 10, 10), 0.1)
    expect(shells).toHaveLength(1)
    expect(shells[0]!.side).toBe('min')
  })
})
