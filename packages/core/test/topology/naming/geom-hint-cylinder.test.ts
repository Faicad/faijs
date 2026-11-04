/**
 * 杂项几何/拓扑 API 直呼单元测试——历史 L1 缺口补账：
 * `meshBooleanToleranceFor`（网格布尔 CSG 容差）与 `captureCylinderFaceAxis`
 * （圆柱面轴 hint 采集，含 reversed 面朝向修正）。
 */
import { describe, expect, it } from 'vitest'
import { meshBooleanToleranceFor } from '../../../src/brep/mesh-solid'
import { captureCylinderFaceAxis } from '../../../src/topology/naming/geom-hint'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'
import type { BrepHandle } from '../../../src/brep/engine/types'
import type { BrepUvBounds } from '../../../src/brep/engine/types'

describe('meshBooleanToleranceFor 直呼', () => {
  it('单位立方体网格 → 正的有限容差（随尺寸缩放）', () => {
    const unit = meshBooleanToleranceFor({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]) })
    const big = meshBooleanToleranceFor({
      positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 100, 0, 100, 100, 0]),
    })
    expect(unit).toBeGreaterThan(0)
    expect(Number.isFinite(unit)).toBe(true)
    // 大网格允许更宽容差（bbox 对角线驱动）
    expect(big).toBeGreaterThanOrEqual(unit)
  })

  it('空网格返回 Infinity——GOTCHA：退化输入未被下界兜住', () => {
    // 实测（2026-11-04）：空 positions → bbox 全 ±Inf → dx = -Inf-Inf = -Inf，
    // diag = sqrt(Inf) = +Inf，`Math.max(1e-6, Infinity)` 仍是 Infinity——
    // 下界守不住退化输入。现网调用点（mesh 布尔）输入永远是已焊接的非空网格，
    // 不会命中此分支；这里钉住真实行为，若日后加下界守卫，改断言即可。
    expect(meshBooleanToleranceFor({ positions: new Float32Array([]) })).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('captureCylinderFaceAxis 直呼（stub 内核）', () => {
  const H = 1 as unknown as BrepHandle

  /** r=10 圆柱面 stub：轴 = +Z 过 (0,0,·)，u∈[0,2π]、v∈[0,20]。 */
  function kernel(orientation: 'forward' | 'reversed' = 'forward'): BrepEngineApi {
    return {
      surfaceType: () => 'cylinder',
      uvBounds: (): BrepUvBounds => ({ uMin: 0, uMax: Math.PI * 2, vMin: 0, vMax: 20 }),
      pointOnSurface: (_f: unknown, u: number, v: number) => ({ x: 10 * Math.cos(u), y: 10 * Math.sin(u), z: v - 10 }),
      surfaceNormal: (_f: unknown, u: number) =>
        orientation === 'forward'
          ? { x: Math.cos(u), y: Math.sin(u), z: 0 }
          : { x: -Math.cos(u), y: -Math.sin(u), z: 0 },
      getFaceCylinderData: () => ({ radius: 10 }),
      shapeOrientation: () => orientation,
    } as unknown as BrepEngineApi
  }

  it('forward 圆柱面：origin 落在轴上、direction 为轴向', () => {
    const axis = captureCylinderFaceAxis(kernel(), H)
    expect(axis).toBeDefined()
    expect(axis!.origin[0]).toBeCloseTo(0, 9)
    expect(axis!.origin[1]).toBeCloseTo(0, 9)
    expect(axis!.origin[2]).toBeCloseTo(-10, 9)
    expect(axis!.direction[2]).toBeCloseTo(1, 9)
  })

  it('reversed 圆柱面：先修正回几何外法向，origin 仍落在轴上', () => {
    const axis = captureCylinderFaceAxis(kernel('reversed'), H)
    expect(axis).toBeDefined()
    expect(axis!.origin[0]).toBeCloseTo(0, 9)
    expect(axis!.origin[1]).toBeCloseTo(0, 9)
    expect(axis!.origin[2]).toBeCloseTo(-10, 9)
  })

  it('缺圆柱数据（getFaceCylinderData=null）→ undefined，不静默造轴', () => {
    const k = {
      surfaceType: () => 'cylinder',
      uvBounds: (): BrepUvBounds => ({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 }),
      pointOnSurface: () => ({ x: 0, y: 0, z: 0 }),
      surfaceNormal: () => ({ x: 0, y: 0, z: 1 }),
      getFaceCylinderData: () => null,
      shapeOrientation: () => 'forward',
    } as unknown as BrepEngineApi
    expect(captureCylinderFaceAxis(k, H)).toBeUndefined()
  })
})
