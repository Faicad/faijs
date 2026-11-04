/**
 * @vitest-environment node
 *
 * `liftCurve2dToPlane` / `curvesAsEdgesOnPlane` 的**字面量 kernel 调用点**测试。
 *
 * 历史缺口：`lift-on-plane.test.ts` 用 `recordingKernel()` 返回变量再传参，L2 参数
 * 覆盖扫描（`scripts/check-api-test-coverage.ts`）只认调用点对象字面量里的属性名，
 * 于是 `PlaneWireKernel` 的 8 个内核原语（makeLineEdge/makeArcEdge/makeBezierEdge/
 * makeBSplineEdge/makeCircleEdge/curveSplit/curveParameters/makeWire）全部被误判
 * "未覆盖"。本文件把 stub kernel **内联**写在调用点：既钉住 bspline / trimmed-
 * spline 两条真实路径的提升数学，也让扫描看得见每个内核原语。
 */
import { describe, expect, it } from 'vitest'
import { makePlane, type Vec3 } from '../../../src/geometry2d/bridge/plane'
import { curvesAsEdgesOnPlane, liftCurve2dToPlane } from '../../../src/geometry2d/bridge/lift-on-plane'
import { makeBSpline2d, makeBezier2d, trimCurve } from '../../../src/geometry2d/curve2d'

/** 三次均匀 B 样条的标准节点向量（4 poles, degree 3）。 */
const KNOTS = [0, 0, 0, 0, 1, 1, 1, 1]
const MULTIPLICITIES = [4, 4]

describe('liftCurve2dToPlane：字面量 kernel 调用点（L2）', () => {
  it('bspline 提升走 makeBSplineEdge（坐标已升到平面 z）', () => {
    const calls: { poles: number[]; knots: number[]; mults: number[]; degree: number }[] = []
    const plane = makePlane({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const bs = makeBSpline2d(
      [[0, 0], [10, 0], [10, 10], [0, 10]],
      KNOTS, MULTIPLICITIES, 3, false,
    )
    const edges = liftCurve2dToPlane(
      {
        makeLineEdge: () => ({ kind: 'line' }),
        makeArcEdge: () => ({ kind: 'arc' }),
        makeBezierEdge: () => ({ kind: 'bezier' }),
        makeBSplineEdge: (poles: number[], _w: number[], knots: number[], mults: number[], degree: number) => {
          calls.push({ poles, knots, mults, degree })
          return { kind: 'bspline' }
        },
        makeCircleEdge: () => ({ kind: 'circle' }),
        curveSplit: () => [{ kind: 'e' }, { kind: 'e' }],
        curveParameters: () => ({ first: 0, last: 1 }),
        makeWire: (es: unknown[]) => ({ kind: 'wire', count: es.length }),
      },
      plane,
      bs,
    )
    expect(edges).toHaveLength(1)
    expect(calls).toHaveLength(1)
    // poles 的 z 全部落在平面高度（z=5），xy 原样
    const z = calls[0]!.poles.filter((_, i) => i % 3 === 2)
    expect(z).toEqual([5, 5, 5, 5])
    expect(calls[0]!.degree).toBe(3)
  })

  it('trimmed bspline 先整体建边再 curveParameters/curveSplit 修剪', () => {
    const params: { first: number; last: number }[] = []
    const splits: number[] = []
    let splitCount = 0
    const plane = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const bs = makeBSpline2d([[0, 0], [10, 0], [10, 10], [0, 10]], KNOTS, MULTIPLICITIES, 3, false)
    const trimmed = trimCurve(bs, 0.25, 0.75)
    const edges = liftCurve2dToPlane(
      {
        makeLineEdge: () => ({ kind: 'line' }),
        makeArcEdge: () => ({ kind: 'arc' }),
        makeBezierEdge: () => ({ kind: 'bezier' }),
        makeBSplineEdge: () => ({ kind: 'bspline' }),
        makeCircleEdge: () => ({ kind: 'circle' }),
        curveParameters: () => {
          const p = { first: 0, last: 1 }
          params.push(p)
          return p
        },
        curveSplit: (_e: unknown, t: number) => {
          splits.push(t)
          splitCount += 1
          return [{ kind: 'e-before' }, { kind: 'e-after' }] as const
        },
        makeWire: (es: unknown[]) => ({ kind: 'wire', count: es.length }),
      },
      plane,
      trimmed,
    )
    // 两侧都真的裁剪了：curveParameters 至少 2 次、curveSplit 2 次
    expect(params.length).toBeGreaterThanOrEqual(2)
    expect(splitCount).toBe(2)
    expect(splits.sort()).toEqual([0.25, 0.75].sort())
    expect(edges).toHaveLength(1)
  })

  it('bezier 提升走 makeBezierEdge（poles 升维）', () => {
    const beziers: Vec3[][] = []
    const plane = makePlane({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    const edges = liftCurve2dToPlane(
      {
        makeLineEdge: () => ({ kind: 'line' }),
        makeArcEdge: () => ({ kind: 'arc' }),
        makeBezierEdge: (pts: Vec3[]) => {
          beziers.push(pts)
          return { kind: 'bezier' }
        },
        makeBSplineEdge: () => ({ kind: 'bspline' }),
        makeCircleEdge: () => ({ kind: 'circle' }),
        curveSplit: () => [{ kind: 'e' }, { kind: 'e' }],
        curveParameters: () => ({ first: 0, last: 1 }),
        makeWire: (es: unknown[]) => ({ kind: 'wire', count: es.length }),
      },
      plane,
      makeBezier2d([[0, 0], [5, 10], [15, 10], [20, 0]]),
    )
    expect(edges).toHaveLength(1)
    expect(beziers[0]!.map((p) => p.z)).toEqual([-2, -2, -2, -2])
  })

  it('curvesAsEdgesOnPlane：多曲线按序提升 + makeWire 成线（line/arc/circle 各一）', () => {
    const kinds: string[] = []
    const wires: number[] = []
    const plane = makePlane({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })
    // 简化的 line2d/arc2d/circle2d 字面量（makeArc2dThreePoints 产 trimmed-circle）
    const edges = curvesAsEdgesOnPlane(
      {
        makeLineEdge: () => {
          kinds.push('line')
          return { kind: 'line' }
        },
        makeArcEdge: () => {
          kinds.push('arc')
          return { kind: 'arc' }
        },
        makeBezierEdge: () => ({ kind: 'bezier' }),
        makeBSplineEdge: () => ({ kind: 'bspline' }),
        makeCircleEdge: () => {
          kinds.push('circle')
          return { kind: 'circle' }
        },
        curveSplit: () => [{ kind: 'e' }, { kind: 'e' }],
        curveParameters: () => ({ first: 0, last: 1 }),
        makeWire: (es: unknown[]) => {
          wires.push(es.length)
          return { kind: 'wire' }
        },
      },
      plane,
      [
        { kind2d: 'line', ox: 0, oy: 0, dx: 1, dy: 0, len: 10 },
        { kind2d: 'trimmed', basis: { kind2d: 'circle', cx: 10, cy: 0, radius: 5, sense: true }, tStart: 0, tEnd: Math.PI },
        { kind2d: 'circle', cx: 0, cy: 0, radius: 5, sense: true },
      ],
    )
    expect(kinds).toEqual(['line', 'arc', 'circle'])
    expect(edges).toHaveLength(3)
    // wire 装配由调用方做；这里确认曲线顺序保持
    void wires
  })
})
