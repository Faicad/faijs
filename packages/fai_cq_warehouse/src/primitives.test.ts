/**
 * primitives.test.ts — `src/primitives.ts`（本包私有 extensions 层）单测。
 *
 * 存在理由：这一层此前**零单测**——W2/W3 关于它的结论全部只活在临时探针与注释里
 *（sew 朝向、closeLoop 去重、ruledFace 为何不用 bsplineSurface、meshVolume 基准……）。
 * 本文件把「kernel 原语 → 可复用几何操作」的每条封装都钉成可回归的 contract。
 *
 * 分工：内核**行为陷阱**（反直觉）在 `kernel-pitfalls.test.ts`；本文件测**封装契约**
 *（参数校验、返回值形态、闭式数值）。两者共同取代了已被删除的临时 probe 脚本。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import type { BrepHandle, BrepVec3 } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'
import {
  RULED_FIT_TOLERANCE,
  MESH_LINEAR_DEFLECTION,
  areaOf,
  bboxOf,
  bsplineFace,
  circleWireXY,
  circleWireXZ,
  closeLoop,
  cut,
  faceFromWire,
  intersect,
  loftRuled,
  makeBoxOrigin,
  makeHelix,
  meshVolume,
  orientOutward,
  parametricCurve,
  polygonWire,
  quadFace,
  revolveProfile,
  ruledFace,
  solidFromFaces,
  thickenFace,
  translate,
  volumeOf,
} from './primitives'
import { V, boxFaces } from './testing/pitfall-fixtures'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
})

/** XY 平面矩形 wire（z 固定）。 */
function rectWire(w: number, h: number, z = 0): BrepHandle {
  return polygonWire([V(0, 0, z), V(w, 0, z), V(w, h, z), V(0, h, z)])
}

const extent = (lo: number, hi: number): number => hi - lo

describe('常量：与文档/上游一致的容差标定', () => {
  it('RULED_FIT_TOLERANCE = 1e-6；MESH_LINEAR_DEFLECTION = 0.002（gen-reference.py 同值）', () => {
    expect(RULED_FIT_TOLERANCE).toBe(1e-6)
    expect(MESH_LINEAR_DEFLECTION).toBe(0.002)
  })
})

describe('构造原语薄封装：签名与返回形态', () => {
  it('makeHelix：螺旋线 bbox = 直径 2r × 高', () => {
    const w = makeHelix(V(0, 0, 0), V(0, 0, 1), 1.5, 10, 3)
    const bb = bboxOf(w)
    expect(extent(bb.xmin, bb.xmax)).toBeCloseTo(6, 3)
    expect(extent(bb.zmin, bb.zmax)).toBeCloseTo(10, 3)
  })

  it('parametricCurve：点列 → 曲线句柄、bbox 有界', () => {
    const c = parametricCurve([V(0, 0, 0), V(1, 0.5, 1), V(0, 1, 2)])
    const bb = bboxOf(c)
    expect(bb.xmax).toBeGreaterThanOrEqual(bb.xmin)
    expect(bb.zmax).toBeCloseTo(2, 3)
  })

  it('bsplineFace / thickenFace / faceFromWire：均返回可用句柄', () => {
    const pts: BrepVec3[] = []
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pts.push(V(i, j, 0.1 * (i + j)))
    expect(areaOf(bsplineFace(pts, 3, 3))).toBeGreaterThan(0)

    const flat = k.makeFace(rectWire(4, 2))
    expect(volumeOf(thickenFace(flat, 1))).toBeCloseTo(8, 3)

    // 非平面三角形 wire（三点不共面）
    const tri = k.makeWire([
      k.makeLineEdge(V(0, 0, 0), V(2, 0, 1)),
      k.makeLineEdge(V(2, 0, 1), V(0, 2, 0)),
      k.makeLineEdge(V(0, 2, 0), V(0, 0, 0)),
    ])
    expect(faceFromWire(tri)).toBeTruthy()
  })

  it('revolveProfile / loftRuled：闭式体积命中', () => {
    const axis = { point: V(0, 0, 0), direction: V(0, 0, 1) }
    expect(volumeOf(revolveProfile(circleWireXZ(1, 10), axis, 2 * Math.PI))).toBeCloseTo(
      2 * Math.PI * Math.PI * 10,
      3,
    )
    expect(volumeOf(loftRuled([rectWire(4, 2, 0), rectWire(4, 2, 1)]))).toBeCloseTo(8, 3)
  })

  it('makeBoxOrigin：原点起、体积 = 边长积', () => {
    const box = makeBoxOrigin(2, 3, 4)
    expect(volumeOf(box)).toBeCloseTo(24, 6)
    const bb = bboxOf(box)
    expect([bb.xmin, bb.ymin, bb.zmin]).toEqual([0, 0, 0])
    expect([bb.xmax, bb.ymax, bb.zmax]).toEqual([2, 3, 4])
  })
})

describe('布尔 / 变换：语义与内核一致', () => {
  it('translate：平移新句柄且不改动入参', () => {
    const box = makeBoxOrigin(1, 1, 1)
    const moved = translate(box, 5, 0, 0)
    expect(bboxOf(moved).xmin).toBeCloseTo(5, 9)
    expect(bboxOf(moved).xmax).toBeCloseTo(6, 9)
    expect(bboxOf(box).xmin, '入参未被改动').toBeCloseTo(0, 9)
  })

  it('cut / intersect：2³ − 1³ = 7，2³ ∩ 1³ = 1', () => {
    const big = makeBoxOrigin(2, 2, 2)
    const small = makeBoxOrigin(1, 1, 1)
    expect(volumeOf(cut(big, small))).toBeCloseTo(7, 6)
    expect(volumeOf(intersect(big, small))).toBeCloseTo(1, 6)
  })
})

describe('闭合 wire 构造：去重与参数校验', () => {
  it('closeLoop：末点与首点重合才去重；否则原样；<2 点直通', () => {
    const dup = [V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 0, 0)]
    expect(closeLoop(dup)).toHaveLength(3)
    const open = [V(0, 0, 0), V(1, 0, 0), V(1, 1, 0)]
    expect(closeLoop(open), '末点不重合 → 原样').toHaveLength(3)
    expect(closeLoop([V(0, 0, 0)])).toHaveLength(1)
  })

  it('polygonWire：闭合折线的边数 = 顶点数；三角形可成面', () => {
    expect(k.getSubShapes(polygonWire([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 1, 0)]), 'edge')).toHaveLength(4)
    const tri = polygonWire([V(0, 0, 0), V(2, 0, 0), V(0, 2, 0)])
    expect(areaOf(k.makeFace(tri))).toBeCloseTo(2, 6)
  })

  it('quadFace：单位正方形面积 = 1', () => {
    expect(areaOf(quadFace([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 1, 0)]))).toBeCloseTo(1, 9)
  })
})

describe('ruledFace：单面契约 + 参数守卫（不用 bsplineSurface 的决策记录）', () => {
  const rowA = [V(0, 0, 0), V(1, 0, 0), V(2, 0, 0)]
  const rowB = [V(0, 1, 1), V(1, 1, 1), V(2, 1, 1)]

  it('恰好 1 张面，面积 = 2×√2', () => {
    const f = ruledFace(rowA, rowB)
    expect(k.getSubShapes(f, 'face')).toHaveLength(1)
    expect(areaOf(f)).toBeCloseTo(2 * Math.SQRT2, 6)
  })

  it('行长不等 / 点数 <2 → 显式抛错（不猜测性兜底）', () => {
    expect(() => ruledFace(rowA, rowB.slice(0, 2))).toThrow(/row sizes differ/)
    expect(() => ruledFace([V(0, 0, 0)], [V(0, 1, 0)])).toThrow(/need ≥2 points/)
  })
})

describe('面集 → 实体：sew + 朝向翻正链路', () => {
  it('orientOutward：正向原样、反向翻正、零体积（缝合失败）抛错', () => {
    const box = makeBoxOrigin(2, 2, 2)
    expect(volumeOf(orientOutward(box))).toBeCloseTo(8, 6)
    expect(volumeOf(orientOutward(k.reverseShape(box))), '反向被翻正').toBeCloseTo(8, 6)
    const faceLike = k.makeFace(polygonWire([V(0, 0, 0), V(1, 0, 0), V(1, 1, 0)]))
    expect(() => orientOutward(faceLike)).toThrow(/zero-volume/)
  })

  it('solidFromFaces：6 张平面 face → 体积 +8（默认 1e-3 容差，内建翻正）', () => {
    const solid = solidFromFaces(boxFaces(k, 2))
    expect(volumeOf(solid), '翻正后为正 8').toBeCloseTo(8, 3)
  })
})

describe('量测封装：meshVolume / volumeOf / areaOf / bboxOf', () => {
  it('bboxOf / volumeOf / areaOf：2×2×2 立方体', () => {
    const box = makeBoxOrigin(2, 2, 2)
    const bb = bboxOf(box)
    expect([bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax]).toEqual([0, 0, 0, 2, 2, 2])
    expect(volumeOf(box)).toBeCloseTo(8, 6)
    expect(areaOf(box)).toBeCloseTo(24, 6)
  })

  it('meshVolume：有符号四面体求和 → 8；朝内实体为负', () => {
    expect(meshVolume(makeBoxOrigin(2, 2, 2))).toBeCloseTo(8, 3)
    expect(meshVolume(k.reverseShape(makeBoxOrigin(2, 2, 2))), '反向 → 负').toBeCloseTo(-8, 3)
  })

  it('circleWireXY / circleWireXZ：bbox 直径 = 2r', () => {
    const xy = bboxOf(circleWireXY(1))
    expect(extent(xy.xmin, xy.xmax)).toBeCloseTo(2, 3)
    expect(extent(xy.ymin, xy.ymax)).toBeCloseTo(2, 3)
    const xz = bboxOf(circleWireXZ(1, 10))
    expect(extent(xz.xmin, xz.xmax)).toBeCloseTo(2, 3)
    expect(extent(xz.zmin, xz.zmax)).toBeCloseTo(2, 3)
  })
})
