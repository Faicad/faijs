/**
 * @vitest-environment node
 *
 * occt S4 测量与查询族探针（长期保留，可重复跑）——方案 §3.4.6。
 *
 * 覆盖 13 个新脚本符号（全部平台 op engines:['occt']）：
 *   containsPoint / distanceBetween / inertia / linearCenterOfMass /
 *   projectPointOnEdge / projectPointOnFace / classifyPointOnFace / uvFromPoint /
 *   vertexPosition / subShapeCount / iterShapes（普通函数 + assertEngineFor）/
 *   liftCurve2d / commonCells（defineOp）
 *
 * 钉住的事实：
 *   A. occt 下各查询返回值正确；**Vec3 载体：<原生是 {x,y,z} 对象，脚本面是 [x,y,z]
 *      数组**（dist/types.d.ts:52 vs mesh/types.ts:21）—— 本族的入参/返回值都在
 *      api/measure-query/index.ts 边界处双向转换。透传错载体的症状不是报错，
 *      而是原生读到 undefined 坐标（静默落在原点），故每条都断言返回值为**数组**且
 *      数值正确（用例 A2/A4/A5/A6/A8/A9）；
 *   B. 入参校验（类型/点集/UV）；
 *   C. 平台身份：brepkit 下每个 op 触碰内核前报 E_BREP_UNSUPPORTED（可切换性不破）；
 *   D. mesh-only 形状报 E_SHAPE_TYPE_NO_BREP，而非穿透到 occt。
 *
 * Run: npx vitest run test/api/occt-s4-measure-query.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { solidToShape } from '../../src/brep/brep-ops'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { fromBrep, brepOf, solid } from '../../src/shape'
import type { BrepHandle } from '../../src/brep/engine/types'
import type { Shape } from '../../src/mesh/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import {
  containsPoint, distanceBetween, inertia, linearCenterOfMass,
  projectPointOnEdge, projectPointOnFace, classifyPointOnFace,
  uvFromPoint, vertexPosition, subShapeCount, iterShapes,
  liftCurve2d, commonCells,
} from '../../src/api/measure-query'

let backends: Backends
let box: Shape, boxShifted: Shape, boxOverlap: Shape
let vertex: Shape, edgeXY: Shape, squareWire: Shape, squareFace: Shape

beforeAll(async () => {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
  await initOcctWasm()
  const brep = await getBrepEngine()
  backends = {
    contractVersion: CONTRACT_VERSION,
    config: { mode: 'auto', brepEngineId: 'occt' },
    kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
    fonts: undefined,
    texture: undefined,
    assets: undefined,
    events: { emit: () => undefined },
  } as unknown as Backends
  configureBackends(backends)

  // 全部 fixture 经 L1 契约构造（可复现），查询经 occt 原生Methods。
  const api = getBrepApi()
  box = adopt(api.makeBox(10, 10, 10))
  const bh = brepOf(box) as BrepHandle
  boxShifted = adopt(api.translate(bh, 20, 0, 0))
  boxOverlap = adopt(api.translate(bh, 5, 0, 0))
  vertex = adopt(api.makeVertex(1, 2, 3))
  edgeXY = adopt(api.makeLineEdge({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }))
  squareWire = adopt(api.makeWire(rectEdges(api, 10)))
  squareFace = adopt(api.makeFace(api.makeWire(rectEdges(api, 10))))
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

/** 内核句柄 → faijs Shape（登记 brep 槽）。 */
function adopt(h: BrepHandle): Shape {
  return fromBrep(solidToShape(getBrepApi(), h), { solid: h })
}

/** z=0 平面上边长 side 的方形闭合轮廓的四条边。 */
function rectEdges(api: ReturnType<typeof getBrepApi>, side: number): BrepHandle[] {
  const c: Array<[number, number]> = [[0, 0], [side, 0], [side, side], [0, side]]
  return c.map((p, i) => {
    const q = c[(i + 1) % c.length]
    return api.makeLineEdge({ x: p[0], y: p[1], z: 0 }, { x: q[0], y: q[1], z: 0 })
  })
}

function bboxOf(s: Shape) {
  return getBrepApi().getBoundingBox(brepOf(s) as never)
}
function volumeOf(s: Shape): number {
  return getBrepApi().getVolume(brepOf(s) as never)
}

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

function exec(mode: ExecutionMode, code: string) {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

describe('S4 测量查询族 — occt 正例', () => {
  it('A1. containsPoint：盒中心在内 true，远点在盒外 false', () => {
    const c = getBrepApi().getCenterOfMass(brepOf(box) as never)
    expect(containsPoint(box, [c.x, c.y, c.z])).toBe(true)
    expect(containsPoint(box, [-100, -100, -100])).toBe(false)
  })

  it('A2. distanceBetween：两盒间隔 = xmin2 − xmax1 = 10', () => {
    const a = bboxOf(box)
    const b = bboxOf(boxShifted)
    expect(distanceBetween(box, boxShifted)).toBeCloseTo(b.xmin - a.xmax, 6)
    expect(distanceBetween(box, boxShifted)).toBeCloseTo(10, 6)
  })

  it('A3. inertia：立方体的惯性矩阵对称且三分量相等（长度 9 的行主序 3×3）', () => {
    const m = inertia(box)
    expect(m).toHaveLength(9)
    expect(m[0]).toBeCloseTo(m[4], 6)
    expect(m[0]).toBeCloseTo(m[8], 6)
    expect(m[1]).toBeCloseTo(m[3], 6)
    expect(m[2]).toBeCloseTo(m[6], 6)
    expect(m[5]).toBeCloseTo(m[7], 6)
    expect(m[0]).toBeGreaterThan(0)
  })

  it('A4. linearCenterOfMass：方形 wire（10×10，z=0）→ [5,5,0]（数组形态）', () => {
    const c = linearCenterOfMass(squareWire)
    expect(Array.isArray(c)).toBe(true)
    expect(c[0]).toBeCloseTo(5, 6)
    expect(c[1]).toBeCloseTo(5, 6)
    expect(c[2]).toBeCloseTo(0, 6)
  })

  it('A5. projectPointOnEdge：最近点 [5,0,0]，切向单位长、贴合 X 轴方向', () => {
    const r = projectPointOnEdge(edgeXY, [5, 3, 0])
    expect(Array.isArray(r.point)).toBe(true)
    expect(Array.isArray(r.tangent)).toBe(true)
    expect(r.point[0]).toBeCloseTo(5, 6)
    expect(r.point[1]).toBeCloseTo(0, 6)
    expect(r.point[2]).toBeCloseTo(0, 6)
    const len = Math.hypot(r.tangent[0], r.tangent[1], r.tangent[2])
    expect(len).toBeCloseTo(1, 6)
    expect(Math.abs(r.tangent[0])).toBeCloseTo(1, 6)
    expect(r.parameter).toBeCloseTo(5, 6)
  })

  it('A6. projectPointOnFace：面外点垂直投影回面上 [5,5,0]', () => {
    const p = projectPointOnFace(squareFace, [5, 5, 100])
    expect(Array.isArray(p)).toBe(true)
    expect(p[0]).toBeCloseTo(5, 6)
    expect(p[1]).toBeCloseTo(5, 6)
    expect(p[2]).toBeCloseTo(0, 6)
  })

  it('A7. classifyPointOnFace：UV 中点在边界内 → in；远离边界 → out', () => {
    const vb = getBrepApi().uvBounds(brepOf(squareFace) as never)
    const u = (vb.uMin + vb.uMax) / 2
    const v = (vb.vMin + vb.vMax) / 2
    expect(classifyPointOnFace(squareFace, u, v)).toBe('in')
    expect(classifyPointOnFace(squareFace, vb.uMin - 1000, vb.vMin - 1000)).toBe('out')
  })

  it('A8. uvFromPoint：点 → UV，经 pointOnSurface 往返回到原点（不钉 UV 基底约定）', () => {
    const uv = uvFromPoint(squareFace, [3, 4, 0])
    const back = getBrepApi().pointOnSurface(brepOf(squareFace) as never, uv.u, uv.v)
    expect(back.x).toBeCloseTo(3, 4)
    expect(back.y).toBeCloseTo(4, 4)
    expect(back.z).toBeCloseTo(0, 4)
  })

  it('A9. vertexPosition：makeVertex(1,2,3) → [1,2,3]（数组形态）', () => {
    const p = vertexPosition(vertex)
    expect(Array.isArray(p)).toBe(true)
    expect(p).toEqual([1, 2, 3])
  })

  it('A10. subShapeCount：立方体面 6 / 边 12 / 顶点 8 / 实体 1', () => {
    expect(subShapeCount(box, 'face')).toBe(6)
    expect(subShapeCount(box, 'edge')).toBe(12)
    expect(subShapeCount(box, 'vertex')).toBe(8)
    expect(subShapeCount(box, 'solid')).toBe(1)
  })

  it('A11. iterShapes：返回 Shape[]（非空，每项有 brep 槽）', () => {
    const subs = iterShapes(box)
    expect(Array.isArray(subs)).toBe(true)
    expect(subs.length).toBeGreaterThan(0)
    for (const s of subs) expect(brepOf(s)).toBeDefined()
  })

  it('A12. liftCurve2d：2D 点集 → z=0 平面 wire（kind 为 curve），端点精确落在首末点上', async () => {
    const w = await liftCurve2d([[0, 0], [10, 0], [10, 5]], [0, 0, 0], [0, 0, 1], [1, 0, 0])
    expect((w as { kind?: string }).kind).toBe('curve')
    const api = getBrepApi()
    const h = brepOf(w) as never
    const first = api.curvePointAtParam(h, api.curveParameters(h).first)
    const last = api.curvePointAtParam(h, api.curveParameters(h).last)
    expect(first.x).toBeCloseTo(0, 6)
    expect(first.y).toBeCloseTo(0, 6)
    expect(first.z).toBeCloseTo(0, 6)
    expect(last.x).toBeCloseTo(10, 6)
    expect(last.y).toBeCloseTo(5, 6)
    expect(last.z).toBeCloseTo(0, 6)
  })

  it('A12b. GOTCHA：liftCurve2d 的产物是**插值 B 样条**，bbox 会越出给定点集（过冲）', async () => {
    // 原生 liftCurve2dToPlane 造的是过点的插值曲线，不是折线 wire：
    // 点集 bbox 是 x∈[0,10] y∈[0,5]，实测产物 bbox xmax ≈ 10.4167（越过 10）。
    // 因此**不得**用 bbox 判定 liftCurve2d 的产物范围，只能钉端点（见 A12）。
    const w = await liftCurve2d([[0, 0], [10, 0], [10, 5]], [0, 0, 0], [0, 0, 1], [1, 0, 0])
    const b = bboxOf(w)
    expect(b.xmax).toBeGreaterThan(10)
    // 平面度仍然成立：整条曲线落在 z=0。
    expect(Math.abs(b.zmax - b.zmin)).toBeLessThanOrEqual(1e-6)
  })

  it('A13. commonCells：两盒半重叠（错开 5）→ 重叠体体积 5×10×10 = 500', async () => {
    const c = await commonCells([box, boxOverlap])
    expect(volumeOf(c)).toBeCloseTo(500, 3)
  })
})

describe('S4 测量查询族 — 入参校验', () => {
  it('B1. subShapeCount 非法的 type → E_SUBSHAPECOUNT_BAD_TYPE', () => {
    expect(() => subShapeCount(box, 'faceee' as never)).toThrow(/E_SUBSHAPECOUNT_BAD_TYPE/)
  })

  it('B2. classifyPointOnFace u/v 非有限数 → E_CLASSIFYPOINTONFACE_BAD_UV', () => {
    expect(() => classifyPointOnFace(squareFace, 'x' as never, 0)).toThrow(/E_CLASSIFYPOINTONFACE_BAD_UV/)
    expect(() => classifyPointOnFace(squareFace, 0, Number.NaN)).toThrow(/E_CLASSIFYPOINTONFACE_BAD_UV/)
  })

  it('B3. containsPoint 点非 [x,y,z] 数组 → E_CONTAINSPOINT_BAD_POINT', () => {
    expect(() => containsPoint(box, [1, 2] as never)).toThrow(/E_CONTAINSPOINT_BAD_POINT/)
  })

  it('B4. projectPointOnFace 点非 [x,y,z] 数组 → E_PROJECTPOINTONFACE_BAD_POINT', () => {
    expect(() => projectPointOnFace(squareFace, [1, 2] as never)).toThrow(/E_PROJECTPOINTONFACE_BAD_POINT/)
  })

  it('B5. liftCurve2d 点数 < 2 → E_LIFTCURVE2D_TOO_FEW_POINTS', async () => {
    await expect(liftCurve2d([[0, 0]], [0, 0, 0], [0, 0, 1], [1, 0, 0]))
      .rejects.toThrow(/E_LIFTCURVE2D_TOO_FEW_POINTS/)
  })

  it('B6. liftCurve2d 点不是 [x,y] → E_LIFTCURVE2D_BAD_POINT', async () => {
    await expect(liftCurve2d([[0, 0], [1] as never], [0, 0, 0], [0, 0, 1], [1, 0, 0]))
      .rejects.toThrow(/E_LIFTCURVE2D_BAD_POINT/)
  })

  it('B7. commonCells 少于 2 个输入 → E_COMMONCELLS_TOO_FEW', async () => {
    await expect(commonCells([box])).rejects.toThrow(/E_COMMONCELLS_TOO_FEW/)
  })
})

describe('S4 测量查询族 — 平台身份（brepkit 下执行前静态拒绝，D11-4）', () => {
  it('C. 每个 op 在非 occt 引擎下触碰内核前抛 E_BREP_UNSUPPORTED', async () => {
    configureBackends({
      ...backends,
      config: { ...backends.config, brepEngineId: 'brepkit' },
    } as unknown as Backends)
    try {
      expect(() => containsPoint(box, [1, 1, 1])).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => distanceBetween(box, boxShifted)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => inertia(box)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => linearCenterOfMass(squareWire)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => projectPointOnEdge(edgeXY, [1, 1, 0])).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => projectPointOnFace(squareFace, [1, 1, 0])).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => classifyPointOnFace(squareFace, 0.5, 0.5)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => uvFromPoint(squareFace, [1, 1, 0])).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => vertexPosition(vertex)).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => subShapeCount(box, 'face')).toThrow(/E_BREP_UNSUPPORTED/)
      expect(() => iterShapes(box)).toThrow(/E_BREP_UNSUPPORTED/)
    } finally {
      configureBackends(backends)
    }
  })
})

describe('S4 测量查询族 — defineOp 形态的平台身份（脚本级，brepkit 下执行前拒绝）', () => {
  // GOTCHA：defineOp 形态的两个 op（liftCurve2d / commonCells）**不能**用 TS 直连
  // 调用来验引擎守卫——脱离 CadRuntime 时 op 走默认 mesh 路径，先报
  // E_MESH_UNSUPPORTED（无 mesh 实现），轮不到 engines 门禁。与
  // test/api/occt-s4-solid-offset.test.ts 的 C 组同口径：必须经脚本 'brep' 模式。
  const CALLS: Array<[string, string]> = [
    ['liftCurve2d', `let part0 = cad.liftCurve2d([[0,0],[10,0],[10,5]], [0,0,0], [0,0,1], [1,0,0])\n`],
    ['commonCells', `let part0 = cad.box(10,10,10)\nlet part1 = cad.translate(part0,5,0,0)\nlet part2 = cad.commonCells([part0, part1])\n`],
  ]

  for (const [op, code] of CALLS) {
    it(`${op}: requires engine occt (current=brepkit)`, async () => {
      __resetEngineRegistriesForTests()
      await registerBrepkitBrepEngine()
      try {
        const runtime = new CadRuntime(ports(), 'brep', { cad: createApiNamespaceWithEditorOps() })
        const result = await runtime.execute(code)
        expect(result.failedAt).toBeDefined()
        const msg = JSON.stringify(result.failedAt)
        expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
        expect(msg).toMatch(new RegExp(`op '${op}' requires engine occt`))
      } finally {
        __resetEngineRegistriesForTests()
        await registerOcctBrepEngine()
      }
    })
  }
})

describe('S4 测量查询族 — mesh-only 输入', () => {
  it('D. 无 BREP 槽的形状报 E_SHAPE_TYPE_NO_BREP，而非穿透到 occt', async () => {
    const meshOnly = solid({ positions: new Float32Array([]), indices: new Uint32Array([]) })
    expect(() => containsPoint(meshOnly, [0, 0, 0])).toThrow(/E_SHAPE_TYPE_NO_BREP/)
    expect(() => vertexPosition(meshOnly)).toThrow(/E_SHAPE_TYPE_NO_BREP/)
    expect(() => iterShapes(meshOnly)).toThrow(/E_SHAPE_TYPE_NO_BREP/)
    await expect(commonCells([meshOnly, meshOnly])).rejects.toThrow(/E_SHAPE_TYPE_NO_BREP/)
  })
})
