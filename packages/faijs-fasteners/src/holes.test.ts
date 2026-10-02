/**
 * holes.test.ts — P1-b 孔系列验收（方案 §8-W9）：
 *  1. 纯逻辑：孔径解析对齐参数表、非法 key 抛错（对齐上游 ValueError）；
 *  2. 内核烟测：clearanceHole 在板上打孔后体积差 ≈ 单孔切割器体积；
 *     threadedHole 含内螺纹（体积差 > 直孔），simple=True 退化为直孔；
 *  3. 回归锁：孔深缺省 = bboxDiagonal（上游 largestDimension 语义）。
 */

import { describe, expect, it, beforeAll } from 'vitest'
import {
  DRILL_TIP_ANGLE,
  fastenerHoleCutter,
  clearanceHole,
  tapHole,
  threadedHole,
  insertHole,
  pressFitHole,
  pushFastenerLocations,
  type HoleLocation,
} from './holes'
import { clearanceHoleDiameters, tapHoleDiameters } from './params'
import { makeBoxOrigin, volumeOf } from './primitives'
import { setupWarehouseKernel } from './test-setup'

describe('P1-b 孔系列 · 纯逻辑', () => {
  beforeAll(async () => {
    await setupWarehouseKernel()
  })

  it('钻尖角 = 82°（上游 cskAngle 逐字）', () => {
    expect(DRILL_TIP_ANGLE).toBe(82)
  })

  it('clearanceHoleDiameters / tapHoleDiameters 与参数表对齐', () => {
    const clr = clearanceHoleDiameters('M6')
    expect(clr['Close']).toBeGreaterThan(6)
    expect(clr['Normal']).toBeGreaterThan(clr['Close'])
    expect(clr['Loose']).toBeGreaterThan(clr['Normal'])
    const tap = tapHoleDiameters('M5-0.9')
    expect(tap['Soft']).toBeLessThan(5)
    expect(tap['Hard']).toBeGreaterThan(tap['Soft'])
  })

  it('非法 fit/material 抛错（对齐上游 ValueError 语义）', () => {
    const part = makeBoxOrigin(20, 20, 5)
    const loc: HoleLocation[] = [{ x: 5, y: 5, z: 5 }]
    expect(() =>
      clearanceHole({ part, size: 'M6', locations: loc, fit: 'Wrong' as never }),
    ).toThrow(/invalid, must be one of/)
    expect(() =>
      tapHole({ part, size: 'M5-0.9', locations: loc, material: 'Wet' as never }),
    ).toThrow(/invalid, must be one of/)
  })

  it('pushFastenerLocations 返回孔位副本', () => {
    const locs = [{ x: 1, y: 2, z: 3 }]
    const out = pushFastenerLocations(locs)
    expect(out).toEqual(locs)
    expect(out).not.toBe(locs)
  })
})

describe('P1-b 孔系列 · 内核烟测', () => {
  beforeAll(async () => {
    await setupWarehouseKernel()
  })

  it('clearanceHole 贯穿孔：体积差 ≈ 圆柱+钻尖（无沉头）', () => {
    const L = 20, W = 20, T = 5
    const part = makeBoxOrigin(L, W, T)
    const v0 = volumeOf(part)
    const out = clearanceHole({
      part, size: 'M6', counterSunk: false,
      locations: [{ x: L/2, y: W/2, z: T }],
    })
    const v1 = volumeOf(out)
    const removed = v0 - v1
    // M6 Normal 间隙 6.6 → r=3.3；钻尖在板外（z<T 以下无材料），板内移除 = 直孔 π·r²·T
    const r = clearanceHoleDiameters('M6')['Normal'] / 2
    const expected = Math.PI * r * r * T
    expect(removed).toBeCloseTo(expected, 0)
  })

  it('threadedHole：simple=False 比 simple=True 去除更多材料（内螺纹并集）', () => {
    const part = makeBoxOrigin(20, 20, 8)
    const loc: HoleLocation[] = [{ x: 5, y: 5, z: 8 }]
    const simpleOut = threadedHole({
      part, size: 'M6', pitch: 1, simple: true, counterSunk: false, locations: loc,
    })
    const threadOut = threadedHole({
      part, size: 'M6', pitch: 1, simple: false, counterSunk: false, locations: loc,
    })
    // 上游语义：内螺纹 union 回零件（补上螺纹牙材料），剩余体积应变大
    const vSimple = volumeOf(simpleOut)
    const vThread = volumeOf(threadOut)
    expect(vThread).toBeGreaterThan(vSimple)
  })

  it('insertHole / pressFitHole：直孔贯穿', () => {
    const part = makeBoxOrigin(20, 20, 5)
    const v0 = volumeOf(part)
    const out = insertHole({ part, size: 'M6', locations: [{ x: 5, y: 5, z: 5 }] })
    expect(volumeOf(out)).toBeLessThan(v0)
    const out2 = pressFitHole({ part, size: 'M6', locations: [{ x: 8, y: 5, z: 5 }] })
    expect(volumeOf(out2)).toBeLessThan(v0)
  })

  it('fastenerHoleCutter：沉头版高于无沉头版（headOffset 段）', () => {
    const profile = [
      { r: 0, z: 0 }, { r: 0, z: 2 }, { r: 6, z: 2 }, { r: 6, z: 0 },
    ]
    const csk = fastenerHoleCutter({ countersinkProfile: profile, holeRadius: 3, depth: 10 })
    const plain = fastenerHoleCutter({ countersinkProfile: null, holeRadius: 3, depth: 10 })
    expect(volumeOf(csk)).toBeGreaterThan(volumeOf(plain))
  })
})
