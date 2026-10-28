/**
 * smlib-kernel/smlib-p2-ops — P2 全 API 对账接线验收（node 直跑）
 *
 * P2 验收：smlibKernel 造型/曲线/拓扑/求值/修复各区段由 unsupported 桩替换为
 * 真实桥调用后，各 L1 方法可跑通并返回合理几何结果。数值语义锚 = 方案文档
 * §4.3 对账表（A 直通 / B 换算 / C 缺口）；对内核行为未知的探针项（splitByPlane
 * 保留侧、chamfer 全体边）只断言"成功 + 合理范围"，精确语义留 P4 一致性钉。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createSmlibPrimitives, disposeSmlib, type SmlibPrimitives } from '../../src/smlib-kernel/smlibKernel'
import { resetSmlibWasm } from '../../src/smlib-kernel/smlibWasm'
import type { BrepHandle } from '../../src/brep/engine/types'

let p!: SmlibPrimitives

beforeAll(async () => {
  p = await createSmlibPrimitives()
})

afterAll(() => {
  disposeSmlib()
  resetSmlibWasm()
})

/** 造一个 10×20×30 的 box（方案 §4.4 锚定：volume=6000/area=2200）。 */
function box(): BrepHandle {
  return p.makeBox(10, 20, 30)
}

describe('P2 造型区', () => {
  it('makeRectangle 造 XY 平面面实体（单面 brep），三角化 2 三角', () => {
    const f = p.makeRectangle(10, 20)
    // CreatePlanarFaces 返回单面 brep（非闭合流形 solid——探针结论），
    // 可被 extrude 等造型消费；三角化出 2 个三角面（单面）。
    const mesh = p.meshShape(f, { deviation: 0.1, angle: 0.5 })
    expect(mesh.triangleCount).toBe(2) // 单面两个三角
  })

  it('extrude(face) 沿 +Z 拉伸成体，volume 合理', () => {
    const face = p.makeRectangle(2, 3)
    const solid = p.extrude(face, 0, 0, 4)
    expect(p.isSolid(solid)).toBe(true)
    expect(p.getVolume(solid)).toBeGreaterThan(10)
  })

  it('makeWire/makeFace 组合后 extrude（wire 句柄合成 + faceOuterCurves 链路）', () => {
    const e0 = p.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })
    const e1 = p.makeLineEdge({ x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 })
    const e2 = p.makeLineEdge({ x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 })
    const e3 = p.makeLineEdge({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 })
    const wire = p.makeWire([e0, e1, e2, e3])
    expect(p.shapeType(wire)).toBe('WIRE')
    const face = p.makeFace(wire)
    // 单面 brep 非闭合流形（探针结论），能被 extrude 消费。
    const solid = p.extrude(face, 0, 0, 2)
    expect(p.getVolume(solid)).toBeGreaterThan(10)
  })

  it('loft 两 wire 截面成实体（skin primitive）', () => {
    const mkRectWire = (z0: number): BrepHandle => {
      const es = [
        p.makeLineEdge({ x: 0, y: 0, z: z0 }, { x: 2, y: 0, z: z0 }),
        p.makeLineEdge({ x: 2, y: 0, z: z0 }, { x: 2, y: 3, z: z0 }),
        p.makeLineEdge({ x: 2, y: 3, z: z0 }, { x: 0, y: 3, z: z0 }),
        p.makeLineEdge({ x: 0, y: 3, z: z0 }, { x: 0, y: 0, z: z0 }),
      ]
      return p.makeWire(es)
    }
    const w1 = mkRectWire(0)
    const w2 = mkRectWire(10) // 上抬 10 的第二截面
    const solid = p.loft([w1, w2], false)
    expect(p.isSolid(solid)).toBe(true)
    expect(p.getVolume(solid)).toBeGreaterThan(1)
  })

  it('revolveVec 面绕轴旋转成旋转体', () => {
    // 矩形 1×1 面绕 +Y 轴（穿过 x=0.5）转 360° → 圆柱环。
    const face = p.makeRectangle(1, 1)
    // makeRectangle 在 XY 平面左下角原点；先平移到 x∈[2,3] 再绕 Y 轴。
    const placed = p.translate(face, 2, 0, 0)
    const solid = p.revolveVec(placed, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 360)
    expect(p.isSolid(solid)).toBe(true)
    expect(p.getVolume(solid)).toBeGreaterThan(1)
  })

  it('fuseAll 两 box 并集成一个体', () => {
    const a = box()
    const b = p.translate(p.makeBox(5, 5, 5), 12, 12, 0) // 与 a 有重叠且大部分在外
    const fused = p.fuseAll([a, b])
    expect(p.isSolid(fused)).toBe(true)
    // 6000 + 125 − 重叠；并集必 > 6000
    expect(p.getVolume(fused)).toBeGreaterThan(6000)
  })

  it('shell 抽壳后体积减小', () => {
    const solid = box()
    const faces = p.getSubShapes(solid, 'face')
    // 移除顶面抽壳（厚度 1）。
    const shelled = p.shell(solid, [faces[0]], 1, 0.01)
    expect(p.isSolid(shelled)).toBe(true)
    expect(p.getVolume(shelled)).toBeLessThan(6000)
  })

  it('bsplineSurface 过点面句柄非零', () => {
    const pts: Array<{ x: number; y: number; z: number }> = []
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) pts.push({ x: c, y: r, z: Math.sin(r + c) })
    }
    const s = p.bsplineSurface(pts, 4, 4)
    expect(s).not.toBe(0)
  })
})

describe('P2 曲线构造区', () => {
  it('makeLineEdge 造线段，curveType 与长度可查', () => {
    const e = p.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })
    const len = p.curveLength(e)
    expect(len).toBeCloseTo(5, 5)
  })

  it('makeCircleEdge 圆曲线闭合、长度 = 2πr', () => {
    const c = p.makeCircleEdge({ x: 1, y: 2, z: 0 }, { x: 0, y: 0, z: 1 }, 5)
    expect(p.curveIsClosed(c)).toBe(true)
    expect(p.curveLength(c)).toBeCloseTo(2 * Math.PI * 5, 3)
  })

  it('makeCircleArc 圆弧长度 = r·Δθ', () => {
    const c = p.makeCircleArc({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2, 0, 90)
    expect(p.curveIsClosed(c)).toBe(false)
    expect(p.curveLength(c)).toBeCloseTo(2 * (Math.PI / 2), 3)
  })

  it('makeArcEdge 三点圆弧过起点终点', () => {
    const e = p.makeArcEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 })
    expect(p.curveIsClosed(e)).toBe(false)
    // 探针：三点 (0,0)/(0,1)/(1,0) 外接圆 r=0.707，经 mid 的弧 = 270° → len=3.332
    // （CreateArc 顺时针语义，mid 与 start 间隔要求长弧——探针实证）。
    expect(p.curveLength(e)).toBeGreaterThan(3)
    expect(p.curveLength(e)).toBeLessThan(3.5)
  })

  it('makeBezierEdge 二次 Bezier 长度合理', () => {
    const e = p.makeBezierEdge([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
    ])
    const len = p.curveLength(e)
    expect(len).toBeGreaterThan(2)
    expect(len).toBeLessThan(3)
  })

  it('makeBSplineEdge 直线 NURBS 往返（poles 展平）', () => {
    // L1 契约：knots = 唯一值数组（展开 = knots[i] 重复 multiplicities[i] 次）。
    // 直线：唯一 knots [0,1] 各满重（degree 1 → 2 次），2 极点。
    const e = p.makeBSplineEdge([0, 0, 0, 5, 0, 0], [1, 1], [0, 1], [2, 2], 1)
    expect(p.curveLength(e)).toBeCloseTo(5, 3)
  })

  it('approximatePoints / interpolatePoints 造过点曲线', () => {
    const pts = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 1, z: 0 },
      { x: 4, y: 0, z: 0 },
    ]
    const a = p.approximatePoints(pts)
    expect(p.curveLength(a)).toBeGreaterThan(0)
    const i = p.interpolatePoints(pts, 3)
    expect(p.curveLength(i)).toBeGreaterThan(0)
  })

  it('makeHelixWire 螺旋曲线（高度=螺距×圈数）', () => {
    const h = p.makeHelixWire({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 1, 3, 1, false)
    expect(p.curveIsClosed(h)).toBe(false)
    expect(p.curveLength(h)).toBeGreaterThan(3)
  })
})

describe('P2 变换/阵列区', () => {
  it('transform 平移后 bbox 移动', () => {
    const s = box()
    const moved = p.transform(s, [1, 0, 0, 10, 0, 1, 0, 20, 0, 0, 1, 30])
    const bb = p.getBoundingBox(moved)
    expect(bb.xmin).toBeCloseTo(10, 3)
    expect(bb.ymin).toBeCloseTo(20, 3)
    expect(bb.zmin).toBeCloseTo(30, 3)
  })

  it('mirror 过点法向平面，镜像体 bbox 对称', () => {
    const s = p.translate(box(), 1, 0, 0) // x∈[1,11]
    const m = p.mirror(s, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const bb = p.getBoundingBox(m)
    expect(bb.xmax).toBeCloseTo(-1, 3)
    expect(bb.xmin).toBeCloseTo(-11, 3)
  })

  it('linearPattern 含原位置 count 份', () => {
    const arr = p.linearPattern(box(), { x: 1, y: 0, z: 0 }, 15, 3)
    expect(arr.length).toBe(3)
    const bb0 = p.getBoundingBox(arr[1])
    expect(bb0.xmin).toBeCloseTo(15, 3)
  })

  it('circularPattern 绕轴均匀分布', () => {
    const arr = p.circularPattern(p.translate(box(), 10, 0, 0), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 90, 4)
    expect(arr.length).toBe(4)
    const bb = p.getBoundingBox(arr[1])
    // makeBox(10,20,30)：x∈[10,20] y∈[0,20]（y 尺寸 20）；绕 Z 轴 90°：
    // (x,y)→(−y,x) → x∈[−20,0] y∈[10,20]（探针实证）。
    expect(bb.xmax).toBeCloseTo(0, 3)
    expect(bb.xmin).toBeCloseTo(-20, 3)
    expect(bb.ymax).toBeCloseTo(20, 3)
    expect(bb.ymin).toBeCloseTo(10, 3)
  })
})

describe('P2 布尔/分割/倒角区', () => {
  it('sectionByPlane 返回截面曲线', () => {
    const s = box()
    const curves = p.sectionByPlane(s, { x: 5, y: 10, z: 0 }, { x: 0, y: 0, z: 1 })
    expect(curves.length).toBeGreaterThan(0)
    for (const c of curves) {
      expect(p.curveLength(c)).toBeGreaterThan(0)
    }
  })

  it('splitByPlane 两半闭合实体且 bbox 覆盖原范围', () => {
    const s = box()
    const { positive, negative } = p.splitByPlane(s, { x: 5, y: 10, z: 0 }, { x: 1, y: 0, z: 0 })
    const bbP = p.getBoundingBox(positive)
    const bbN = p.getBoundingBox(negative)
    // 契约（api/split-by-plane.ts）：positive = 法向正侧（x∈[5,10]），
    // negative = 法向负侧（x∈[0,5]）。方向由 smlib-split-direction.test.ts 单独钉住。
    expect(bbP.xmin).toBeGreaterThan(4.5)
    expect(bbP.xmax).toBeLessThan(10.5)
    expect(bbN.xmax).toBeLessThan(5.5)
    expect(bbN.xmin).toBeGreaterThan(-0.5)
    // 修复后（2026-10-28）：splitByPlane 改用「半空间盒 + 布尔差」（与 brep-ops.splitBrep 同算法），
    // 输出闭合实体，不再是无剖面的开口壳（旧 SmApiCut 缺口已消除）。
    expect(p.getVolume(positive)).toBeGreaterThan(0)
    expect(p.getVolume(negative)).toBeGreaterThan(0)
    expect(p.getVolume(positive) + p.getVolume(negative)).toBeCloseTo(6000, 3)
  })

  it('chamfer 副本倒角后体积减小', () => {
    const s = box()
    const edges = p.getSubShapes(s, 'edge').slice(0, 1)
    const c = p.chamfer(s, edges, 1)
    const v = p.getVolume(c)
    expect(v).toBeLessThan(6000)
    expect(v).toBeGreaterThan(4000)
  })

  it('fillet 副本圆角后体积减小', () => {
    const s = box()
    const edges = p.getSubShapes(s, 'edge').slice(0, 1)
    const f = p.fillet(s, edges, 1)
    const v = p.getVolume(f)
    expect(v).toBeLessThan(6000)
  })
})

describe('P2 拓扑查询区', () => {
  it('getSubShapes(vertex) 枚举 box 8 顶点（适配器自建合成句柄）', () => {
    const s = box()
    const verts = p.getSubShapes(s, 'vertex')
    expect(verts.length).toBe(8)
    const pos = p.vertexPosition(verts[0])
    expect(typeof pos.x).toBe('number')
  })

  it('edgeToFaceMap 每条边属于两面', () => {
    const s = box()
    const map = p.edgeToFaceMap(s) as Map<number, number[]>
    for (const faces of map.values()) {
      expect(faces.length).toBe(2) // 流形闭盒每边邻接两面
    }
  })

  it('adjacentFaces box 任一面邻接 4 面', () => {
    const s = box()
    const faces = p.getSubShapes(s, 'face')
    // box 是闭流形：任一面都与 4 个侧面相邻。
    const adj = p.adjacentFaces(s, faces[0])
    expect(adj.length).toBe(4)
  })

  it('sharedEdges 相邻两面共享一条边', () => {
    const s = box()
    const faces = p.getSubShapes(s, 'face')
    // 找第一对相邻面。
    let a = faces[0]
    let b = faces[0]
    outer: for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        if (p.sharedEdges(faces[i], faces[j]).length > 0) {
          a = faces[i]
          b = faces[j]
          break outer
        }
      }
    }
    expect(p.sharedEdges(a, b).length).toBe(1)
  })

  it('getLength 累计各边弧长', () => {
    const s = box()
    const edges = p.getSubShapes(s, 'edge')
    let manual = 0
    for (const e of edges) manual += p.curveLength(e)
    // getSubShapes(edge) 含 seam 重复（P1 探针结论），getLength 已去重 → ≤ 手动和
    expect(p.getLength(s)).toBeLessThanOrEqual(manual + 1e-9)
  })
})

describe('P2 校验修复区', () => {
  it('healSolid 副本修复后仍为流形', () => {
    const s = box()
    const healed = p.healSolid(s)
    expect(p.isSolid(healed)).toBe(true)
    expect(p.getVolume(healed)).toBeCloseTo(6000, 2)
  })

  it('fixShape 降级 healSolid 可跑', () => {
    const s = box()
    const fixed = p.fixShape(s)
    expect(p.isSolid(fixed)).toBe(true)
  })

  it('fixFaceOrientations 副本统一法向后仍有效', () => {
    const s = box()
    const fixed = p.fixFaceOrientations(s)
    expect(p.isSolid(fixed)).toBe(true)
  })
})
