/**
 * geom-hint 轴采集单测（P0 装配前置）
 *
 * 用 stub 内核（只实现 hint 采集用到的方法面）验证：
 * - captureFaceHint 对圆柱面产出 axis hint（origin = 轴点，direction = 轴向）；
 * - captureEdgeHint 对直边产出 axis hint（origin = 起点，direction = 切向）；
 * - captureEdgeHint 对圆边产出 axis hint（origin = 圆心，direction = 所在平面法向）；
 * - 平面面 / 退化输入不产出 axis（缺省字段，绝不静默造轴）。
 */

import { describe, it, expect } from 'vitest'
import { captureFaceHint, captureEdgeHint } from './geom-hint'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import type { BrepUvBounds, BrepCurveParameters } from '../../brep/engine/types'

const H = 1 as unknown as BrepHandle

/** 圆柱面 stub：r=10, h=20，轴 = +Z 过原点，参数 u∈[0,2π]（角）、v∈[0,20]（高）。 */
function cylinderKernel(): BrepEngineApi {
  return {
    surfaceType: () => 'cylinder',
    uvBounds: (): BrepUvBounds => ({ uMin: 0, uMax: Math.PI * 2, vMin: 0, vMax: 20 }),
    pointOnSurface: (_f: unknown, u: number, v: number) => ({ x: 10 * Math.cos(u), y: 10 * Math.sin(u), z: v - 10 }),
    surfaceNormal: (_f: unknown, u: number) => ({ x: Math.cos(u), y: Math.sin(u), z: 0 }),
    getSurfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
    getFaceCylinderData: () => ({ radius: 10 }),
    shapeOrientation: () => 'forward',
  } as unknown as BrepEngineApi
}

describe('geom-hint axis capture（P0）', () => {
  it('captureFaceHint：圆柱面 → axis {origin 轴点, direction 轴向}', () => {
    const hint = captureFaceHint(cylinderKernel(), H)
    expect(hint.axis).toBeDefined()
    expect(hint.axis!.direction[0]).toBeCloseTo(0, 9)
    expect(hint.axis!.direction[1]).toBeCloseTo(0, 9)
    expect(hint.axis!.direction[2]).toBeCloseTo(1, 9)
    // origin = P(uMin,vMin) − R·外法向 = (10,0,−10) − (10,0,0) = (0,0,−10)：轴上一点
    expect(hint.axis!.origin[0]).toBeCloseTo(0, 9)
    expect(hint.axis!.origin[1]).toBeCloseTo(0, 9)
    expect(hint.axis!.origin[2]).toBeCloseTo(-10, 9)
  })

  it('captureFaceHint：reversed 圆柱面 → origin 仍落在轴上', () => {
    // 真实内核语义：surfaceNormal 含面朝向——reversed 面返回的是内法向（−径向）。
    // captureCylinderFaceAxis 先按 orientation 修正回几何外法向，再算 origin = P − R·外法向。
    const k = cylinderKernel()
    ;(k as unknown as unknown as { shapeOrientation: () => string; surfaceNormal: (_f: unknown, u: number) => { x: number; y: number; z: number } })
      .surfaceNormal = (_f: unknown, u: number) => ({ x: -Math.cos(u), y: -Math.sin(u), z: 0 })
    ;(k as unknown as unknown as { shapeOrientation: () => string }).shapeOrientation = () => 'reversed'
    const hint = captureFaceHint(k, H)
    expect(hint.axis).toBeDefined()
    expect(hint.axis!.origin[0]).toBeCloseTo(0, 9)
    expect(hint.axis!.origin[1]).toBeCloseTo(0, 9)
    expect(hint.axis!.origin[2]).toBeCloseTo(-10, 9)
  })

  it('captureFaceHint：平面不产出 axis 字段', () => {
    const k = {
      surfaceType: () => 'plane',
      uvBounds: (): BrepUvBounds => ({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 }),
      pointOnSurface: () => ({ x: 0, y: 0, z: 0 }),
      surfaceNormal: () => ({ x: 0, y: 0, z: 1 }),
      getSurfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
    } as unknown as BrepEngineApi
    const hint = captureFaceHint(k, H)
    expect(hint.axis).toBeUndefined()
  })

  it('captureFaceHint：圆柱缺半径数据（getFaceCylinderData=null）→ 不产出 axis', () => {
    const k = cylinderKernel()
    ;(k as unknown as unknown as { getFaceCylinderData: () => null }).getFaceCylinderData = () => null
    const hint = captureFaceHint(k, H)
    expect(hint.axis).toBeUndefined()
  })

  it('captureEdgeHint：直边 → axis {origin 起点, direction 切向}', () => {
    const k = {
      curveLength: () => 10,
      curveType: () => 'line',
      curveParameters: (): BrepCurveParameters => ({ first: 0, last: 1 }),
      curvePointAtParam: (_e: unknown, t: number) => ({ x: t, y: 0, z: 5 }),
      curveTangent: () => ({ x: 1, y: 0, z: 0 }),
    } as unknown as BrepEngineApi
    const hint = captureEdgeHint(k, H)
    expect(hint.axis).toBeDefined()
    expect(hint.axis!.origin).toEqual([0, 0, 5])
    expect(hint.axis!.direction).toEqual([1, 0, 0])
  })

  it('captureEdgeHint：圆边 → axis {origin 圆心, direction 平面法向}（P0 验收②）', () => {
    // r=5 圆，圆心 (0,0,10)，位于 z=10 平面
    const k = {
      curveLength: () => Math.PI * 10,
      curveType: () => 'circle',
      curveParameters: (): BrepCurveParameters => ({ first: 0, last: Math.PI * 2 }),
      curvePointAtParam: (_e: unknown, t: number) => ({ x: 5 * Math.cos(t), y: 5 * Math.sin(t), z: 10 }),
      curveTangent: (_e: unknown, t: number) => ({ x: -Math.sin(t), y: Math.cos(t), z: 0 }),
    } as unknown as BrepEngineApi
    const hint = captureEdgeHint(k, H)
    expect(hint.axis).toBeDefined()
    expect(hint.axis!.origin[0]).toBeCloseTo(0, 9)
    expect(hint.axis!.origin[1]).toBeCloseTo(0, 9)
    expect(hint.axis!.origin[2]).toBeCloseTo(10, 9)
    // 法向 ±Z 均合法（方向符号由采样叉积决定）
    expect(Math.abs(hint.axis!.direction[2])).toBeCloseTo(1, 9)
    expect(Math.abs(hint.axis!.direction[0])).toBeCloseTo(0, 9)
    expect(Math.abs(hint.axis!.direction[1])).toBeCloseTo(0, 9)
  })

  it('captureEdgeHint：圆弧（非整圆）三点定圆仍精确', () => {
    // 90° 圆弧：r=1，圆心 (2,3,0)，参数 ∈ [0, π/2]
    const k = {
      curveLength: () => Math.PI / 2,
      curveType: () => 'circle',
      curveParameters: (): BrepCurveParameters => ({ first: 0, last: Math.PI / 2 }),
      curvePointAtParam: (_e: unknown, t: number) => ({ x: 2 + Math.cos(t), y: 3 + Math.sin(t), z: 0 }),
      curveTangent: (_e: unknown, t: number) => ({ x: -Math.sin(t), y: Math.cos(t), z: 0 }),
    } as unknown as BrepEngineApi
    const hint = captureEdgeHint(k, H)
    expect(hint.axis).toBeDefined()
    expect(hint.axis!.origin[0]).toBeCloseTo(2, 9)
    expect(hint.axis!.origin[1]).toBeCloseTo(3, 9)
    expect(hint.axis!.origin[2]).toBeCloseTo(0, 9)
  })

  it('captureEdgeHint：非线/圆曲线（bspline）不产出 axis', () => {
    const k = {
      curveLength: () => 5,
      curveType: () => 'bspline',
      curveParameters: (): BrepCurveParameters => ({ first: 0, last: 1 }),
      curvePointAtParam: () => ({ x: 0, y: 0, z: 0 }),
      curveTangent: () => ({ x: 1, y: 0, z: 0 }),
    } as unknown as BrepEngineApi
    const hint = captureEdgeHint(k, H)
    expect(hint.axis).toBeUndefined()
  })
})
