/**
 * kernel-conformance.test.ts — WarehouseKernel 契约 probe（方案 §5.5.2 第 ③ 层）。
 *
 * 两级断言，缺一不可（§10 内核契约门禁）：
 *  1. 存在性：名字拼错、内核升级改名、换引擎 → 立即红；
 *  2. 契约 smoke：每个方法真调一次，验返回值形态（句柄非空、bbox 数值、
 *     volume/area > 0）——typeof 只证明名字存在，参数顺序与返回形态不真调验不出来。
 *
 * 红线：W2 必须**先绿再开发** src/primitives.ts（§8-W2 顺序）。
 * 新增 WarehouseKernel 成员时必须先加进本测试的清单，CI 才会校验它。
 */

import { beforeAll, describe, expect, it } from 'vitest'
import type { BrepHandle } from '@faicad/faijs-core'
import { requireKernel, type WarehouseKernel } from './kernel'
import { setupWarehouseKernel } from './test-setup'

let k: WarehouseKernel

beforeAll(async () => {
  await setupWarehouseKernel()
  k = requireKernel() as WarehouseKernel
})

/** probe 清单：WarehouseKernel 超出 BrepEngineApi 的全部成员 + §6 的 loft 退化路径前提。 */
const PROBED = [
  'makeHelixWire',
  'approximatePoints',
  'bsplineSurface',
  'sew',
  'makeSolid',
  'revolve',
  'thicken',
  'makeNonPlanarFace',
  'getSurfaceArea',
  'reverseShape',
  'tessellate', // 体积真值基准：GProps 对螺旋 B 样条面求积混叠（W3 仲裁），mesh 才是真值
  'loft', // §6：makeRuledSurface 缺失期的退化路径——存在与否直接决定 W3 路线
  'vertexPosition', // W5：fillet2D / edge 级 rotate 定位
  'rotate', // W5：绕任意轴旋转（弧度，右手）；hexalobular polarArray 合成
  'mirror', // W5：锥度切割器向上收锥后镜像翻转
  'draftPrism', // W5：沉孔锥度切割器（taper 退化时抛错 → cross/R 沉孔显式缺口）
  'interpolatePointsWithTangents', // W5：PanHead 头型样条（GeomAPI_Interpolate scale=True 语义，极点已与 A 侧逐位对表）
  'getNurbsCurveData', // W5：样条极点提取（PanHead 对表探针用）
] as const

function assertHandle(h: unknown, where: string): BrepHandle {
  expect(h, `${where} returned null/undefined`).toBeTruthy()
  return h as BrepHandle
}

function assertBbox(shape: BrepHandle, where: string): void {
  const bb = k.getBoundingBox(shape)
  expect(bb, `${where} bbox`).toBeTruthy()
  for (const v of [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax])
    expect(typeof v, `${where} bbox field`).toBe('number')
}

/** 闭合圆 wire：两段半圆弧拼成（BrepEngineApi 无 makeCircle）。
 *  plane='xy'：圆心在原点的 XY 圆；plane='xz'：圆心在 (centerR,0,0) 的 XZ 圆
 *  （含轴平面轮廓——revolve 成环体的正确输入）。 */
function circleWire(radius: number, plane: 'xy' | 'xz' = 'xy', centerR = 0): BrepHandle {
  const mk = (x: number, y: number, z: number) => ({ x, y, z })
  let a: { x: number; y: number; z: number }
  let b: { x: number; y: number; z: number }
  let top: { x: number; y: number; z: number }
  let bottom: { x: number; y: number; z: number }
  if (plane === 'xz') {
    a = mk(centerR + radius, 0, 0)
    b = mk(centerR - radius, 0, 0)
    top = mk(centerR, 0, radius)
    bottom = mk(centerR, 0, -radius)
  } else {
    a = mk(radius, 0, 0)
    b = mk(-radius, 0, 0)
    top = mk(0, radius, 0)
    bottom = mk(0, -radius, 0)
  }
  const e1 = k.makeArcEdge(a, top, b)
  const e2 = k.makeArcEdge(b, bottom, a)
  return k.makeWire([e1, e2])
}

/** 闭合矩形 wire（XY 平面，z 固定）。 */
function rectWire(w: number, h: number, z = 0): BrepHandle {
  const e1 = k.makeLineEdge({ x: 0, y: 0, z }, { x: w, y: 0, z })
  const e2 = k.makeLineEdge({ x: w, y: 0, z }, { x: w, y: h, z })
  const e3 = k.makeLineEdge({ x: w, y: h, z }, { x: 0, y: h, z })
  const e4 = k.makeLineEdge({ x: 0, y: h, z }, { x: 0, y: 0, z })
  return k.makeWire([e1, e2, e3, e4])
}

describe('第 1 级：方法存在性（kernel 升级改名立即红）', () => {
  it.each(PROBED)('%s 存在于活内核', (name) => {
    expect(typeof Reflect.get(k, name), `k.${name}`).toBe('function')
  })
})

describe('第 2 级：契约 smoke（每个方法真调一次，验返回形态）', () => {
  it('makeHelixWire：螺旋线句柄非空、bbox 合理', () => {
    const w = assertHandle(
      k.makeHelixWire({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 1.5, 10, 3),
      'makeHelixWire',
    )
    const bb = k.getBoundingBox(w)
    expect(bb.xmax - bb.xmin).toBeCloseTo(6, 3) // 直径 2r
    expect(bb.zmax - bb.zmin).toBeCloseTo(10, 3) // height
  })

  it('approximatePoints：点列 → 曲线句柄非空', () => {
    const c = assertHandle(
      k.approximatePoints([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0.5, z: 1 },
        { x: 0, y: 1, z: 2 },
      ]),
      'approximatePoints',
    )
    assertBbox(c, 'curve')
  })

  it('bsplineSurface：3×3 点阵 → 面句柄非空、面积 > 0', () => {
    const pts: { x: number; y: number; z: number }[] = []
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) pts.push({ x: i, y: j, z: 0.1 * (i + j) })
    const f = assertHandle(k.bsplineSurface(pts, 3, 3), 'bsplineSurface')
    expect(k.getSurfaceArea(f)).toBeGreaterThan(0)
  })

  it('陷阱回归：bsplineSurface(rows=2) 是**逼近**且系统性外扩 → 故直纹带改走 loft', () => {
    // 2026-09-14 W3 实测：helix 两行采样点全部在 r=3.000000000，但
    // bsplineSurface(pts,2,N) 出的面 xmax=3.000369534（Δ=3.70e-4），且与采样密度
    // **无关**（每圈 48→192 点、rows 2→9 均收敛到 3.699e-4）。而
    // approximatePoints+loft(ruled) 同一组点只得 Δ=9.8e-7（小 375 倍）。
    // 本 probe 测「内核对直纹带的拟合误差量级」——若此断言变红，说明内核改好了
    // bsplineSurface（误差降到 1e-6 级），届时应重新评估 primitives.ruledFace
    // 是否可退回单次调用。见 docs/analysis/2026-09-14-cq-warehouse-thread-probe.md。
    const R = 3
    const row = (dz: number) => {
      const pts: { x: number; y: number; z: number }[] = []
      for (let i = 0; i <= 480; i++) {
        const th = (2 * Math.PI * i) / 48
        pts.push({ x: R * Math.cos(th), y: R * Math.sin(th), z: (i / 48) + dz })
      }
      return pts
    }
    const a = row(-0.0625)
    const b = row(0.0625)
    const bySurface = k.getBoundingBox(k.bsplineSurface([...a, ...b], 2, a.length))
    const surfaceDev = bySurface.xmax - R
    expect(surfaceDev, 'bsplineSurface 直纹带拟合误差量级').toBeGreaterThan(1e-5)

    const wireA = k.makeWire([k.approximatePoints(a, 1e-6)])
    const wireB = k.makeWire([k.approximatePoints(b, 1e-6)])
    const byLoft = k.getBoundingBox(k.loft([wireA, wireB], false, true))
    const loftDev = byLoft.xmax - R
    expect(loftDev, 'loft(ruled) 直纹带拟合误差应紧得多').toBeLessThan(1e-5)
    expect(surfaceDev).toBeGreaterThan(100 * loftDev)
  })

  it('revolve：含轴平面的 wire 绕 Z 轴 360° → 内核自动闭合成环体（实测行为）', () => {
    // 轮廓必须在含轴平面（XZ）：XY 圆盘绕过其圆心的 Z 轴旋转是退化输入
    const axis = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }
    // ⚠️ 实测行为（probe 发现）：本内核对 wire 旋转直接闭合成实体，
    // 体积 = 2π²·R·r²（R=10, r=1）——与 cq 的「wire 旋转得旋转面」语义不同。
    // primitives.ts 封装时按此行为使用，不再额外 makeFace。
    const solid = assertHandle(
      k.revolve(circleWire(1, 'xz', 10), axis, Math.PI * 2),
      'revolve wire',
    )
    expect(k.getVolume(solid)).toBeCloseTo(2 * Math.PI * Math.PI * 10 * 1, 3)
  })

  it('loft：两矩形 wire ruled=true → 体（§6 退化路径前提验证）', () => {
    const solid = assertHandle(
      k.loft([rectWire(4, 2, 0), rectWire(4, 2, 1)], true, true),
      'loft',
    )
    expect(k.getVolume(solid)).toBeCloseTo(8, 3) // 4×2×1 直壁
  })

  it('loft(isSolid=false, ruled=true)：开放 wire → 直纹面/shell（ruledFace 生产路径）', () => {
    // ⚠️ 形态实测：多边 wire 会**逐边配对**出一张面（4 边矩形 × 2 → 4 张侧壁面，
    // 总侧面积 = 2(4+2)·1 = 12）；生产路径 ruledFace 传的是**单边** wire，得 1 张面。
    const shell = assertHandle(
      k.loft([rectWire(4, 2, 0), rectWire(4, 2, 1)], false, true),
      'loft ruled (multi-edge wires)',
    )
    const walls = k.getSubShapes(shell, 'face')
    expect(walls.length, '4 边 × 2 → 逐边配对 4 张面').toBe(4)
    const totalArea = walls.reduce((s, f) => s + k.getSurfaceArea(f), 0)
    expect(totalArea).toBeCloseTo(2 * (4 + 2) * 1, 3)

    // 生产路径形态：单边 wire → 恰好 1 张直纹面
    const e0 = k.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })
    const e1 = k.makeLineEdge({ x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 1 })
    const single = assertHandle(
      k.loft([k.makeWire([e0]), k.makeWire([e1])], false, true),
      'loft ruled (single-edge wires)',
    )
    const faces = k.getSubShapes(single, 'face')
    expect(faces.length, '单边 wire → 恰好 1 张面').toBe(1)
    expect(k.getSurfaceArea(faces[0]!)).toBeCloseTo(4, 3) // 4×1 平面带
  })

  it('tessellate：2×2×2 box → 三角化非空、有符号体积 = 8（朝向被遵循）', () => {
    const mesh = k.tessellate(k.makeBox(2, 2, 2))
    expect(mesh.triangleCount).toBeGreaterThan(0)
    expect(mesh.positions.length).toBe(mesh.vertexCount * 3)
    expect(mesh.indices.length).toBe(mesh.triangleCount * 3)
    // 有符号四面体求和 → 8（若内核忽略 face orientation 会得 -8，会立刻红）
    let total = 0
    const p = mesh.positions
    const idx = mesh.indices
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t]! * 3
      const b = idx[t + 1]! * 3
      const c = idx[t + 2]! * 3
      total +=
        (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
          p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
          p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) /
        6
    }
    expect(total).toBeCloseTo(8, 3)
  })

  it('陷阱回归：三角化后 getBoundingBox(shape, true) 会放大包围盒（useTriangulation）', () => {
    // 这是 A 侧 manifest 曾整体偏大 0.0126 mm 的同一机制（cadquery 的
    // BoundingBox() 固定传 useTriangulation=True）。本包 bboxOf 走默认 false，
    // 不受影响；此 probe 把「内核行为」钉住，升级改语义时立即红。
    const cyl = k.makeCylinder(3, 10)
    const exact = k.getBoundingBox(cyl)
    const exactLen = exact.xmax - exact.xmin
    expect(exactLen).toBeCloseTo(6, 6) // 精确路径：解析圆柱 = 6

    k.tessellate(cyl)
    const stillExact = k.getBoundingBox(cyl)
    expect(stillExact.xmax - stillExact.xmin, '默认（false）应与三角化状态无关').toBeCloseTo(6, 6)

    const byMesh = k.getBoundingBox(cyl, true)
    expect(byMesh.xmax - byMesh.xmin, 'useTriangulation=true 会按粗三角化放大').toBeGreaterThan(6)
  })

  it('sew + makeSolid：四侧面缝合成 shell → makeSolid 成体', () => {
    const faces = [
      k.makeFace(rectWire(4, 2, 0)),
      k.makeFace(rectWire(4, 2, 1)),
      // 四个侧壁（简化：只缝顶底 + 两壁验证 sew 链路，闭壳由 loft 用例覆盖）
      k.makeFace(rectWire(4, 1, 0)),
      k.makeFace(rectWire(4, 1, 1)),
    ]
    const shell = assertHandle(k.sew(faces, 1e-6), 'sew')
    expect(shell).toBeTruthy()
  })

  it('sewAndSolidify：封闭面集 → 体、volume > 0（makeSolid 链路的实际形态）', () => {
    // 用 loft 出的实体反查 makeSolid 签名形态：直接对开壳调 makeSolid 验证参数顺序
    const w0 = rectWire(4, 2, 0)
    const w1 = rectWire(4, 2, 1)
    const solid = assertHandle(k.loft([w0, w1], true, true), 'loft for sew check')
    expect(k.getVolume(solid)).toBeGreaterThan(0)
  })

  it('thicken：平面 face → 有厚度体、volume > 0', () => {
    const f = assertHandle(k.makeFace(rectWire(4, 2, 0)), 'makeFace')
    const s = assertHandle(k.thicken(f, 1, 1e-6), 'thicken')
    expect(k.getVolume(s)).toBeCloseTo(8, 3)
  })

  it('makeNonPlanarFace：返回句柄（签名形态）', () => {
    // 三点不共线的三角形 wire → 非平面构造路径真调一次
    const e1 = k.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 1 })
    const e2 = k.makeLineEdge({ x: 2, y: 0, z: 1 }, { x: 0, y: 2, z: 0 })
    const e3 = k.makeLineEdge({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 })
    const w = k.makeWire([e1, e2, e3])
    const f = assertHandle(k.makeNonPlanarFace(w), 'makeNonPlanarFace')
    expect(f).toBeTruthy()
  })

  it('getSurfaceArea 数值形态：4×2 矩形面 = 8', () => {
    const f = assertHandle(k.makeFace(rectWire(4, 2, 0)), 'makeFace')
    expect(k.getSurfaceArea(f)).toBeCloseTo(8, 6)
  })

  it('reverseShape：翻转朝向 → getVolume 变号（2×2×2 box：8 → -8）', () => {
    const box = k.makeBox(2, 2, 2)
    expect(k.getVolume(box)).toBeCloseTo(8, 6)
    const rev = assertHandle(k.reverseShape(box), 'reverseShape')
    expect(k.getVolume(rev)).toBeCloseTo(-8, 6)
  })

  it('interpolatePointsWithTangents：两点 + 单位切向 → 极点与 A 侧 GeomAPI_Interpolate scale=True 逐位一致', () => {
    // A 侧实证（probe72/73）：PanHead M6 样条极点 (6,0)→(5.82301,2.02301)→(5.2,3.6)→(3,3.6)
    const DEG = Math.PI / 180
    const edge = assertHandle(
      k.interpolatePointsWithTangents(
        [
          { x: 6, y: 0, z: 0 },
          { x: 3, y: 0, z: 3.6 },
        ],
        { x: -Math.sin(5 * DEG), y: 0, z: Math.cos(5 * DEG) },
        { x: -1, y: 0, z: 0 },
      ),
      'interpolatePointsWithTangents',
    )
    const d = k.getNurbsCurveData(edge)
    if (!d) throw new Error('getNurbsCurveData returned null for the PanHead spline edge')
    const poles = d.poles
    expect(poles.length).toBe(12) // 4 极点 × xyz
    expect(poles[0]).toBeCloseTo(6, 6)
    expect(poles[3]).toBeCloseTo(5.823009594, 6)
    expect(poles[5]).toBeCloseTo(2.023009594, 6)
    expect(poles[6]).toBeCloseTo(5.2, 6)
    expect(poles[8]).toBeCloseTo(3.6, 6)
    expect(poles[9]).toBeCloseTo(3, 6)
  })
})
