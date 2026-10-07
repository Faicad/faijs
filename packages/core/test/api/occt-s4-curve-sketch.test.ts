/**
 * @vitest-environment node
 *
 * occt S4 曲线草图族（方案 §3.4.1）——长期测试，可重复跑。
 *
 * 覆盖 11 个新脚本符号（全部平台 op engines:['occt']；curveIsPeriodic 布尔返回走
 * 普通函数 + assertEngineFor，与 shape-type 族同口径）：
 *   edge / circleArc / ellipseEdge / ellipseArc / tangentArc /
 *   approximatePoints / interpolateWithTangents /
 *   curveDegreeElevate / curveKnotInsert / curveKnotRemove / curveIsPeriodic
 *
 * 钉住的事实：
 *   A. occt 下各构造/精修 op 几何正确（kind='curve'、bbox、端点、长度）；
 *      **角度约定：脚本面收度，内部换算弧度**（occt Geom_TrimmedCurve 吃弧度，
 *      实测见用例 A2/A3——若上游改为收度，此断言需翻转）；
 *   B. 入参校验（半径/角度/点集/整数）；
 *   C. 平台身份：brepkit 下执行前报 E_BREP_UNSUPPORTED（D11-4）；
 *   D. TS 级直连（L1 覆盖门禁）。
 *
 * Run: npx vitest run test/api/occt-s4-curve-sketch.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CadRuntime } from '../../src/cad-runtime/runtime'
import type { ExecutionResult } from '../../src/cad-runtime/runtime'
import type { ExecutionMode, HostPorts } from '../../src/cad-runtime/ports'
import { asPartName } from '../../src/identity'
import { initOcctWasm } from '../../src/occt-kernel/occtKernel'
import type { Shape } from '../../src/mesh/types'
import { __resetEngineRegistriesForTests, getBrepEngine } from '../../src/brep/engine/registry'
import { registerOcctBrepEngine } from '../../src/brep/engine/adapters/occt'
import { registerBrepkitBrepEngine } from '../../src/brep/engine/adapters/brepkit'
import { getBrepApi } from '../../src/brep/handle-bridge'
import { configureBackends, CONTRACT_VERSION, type Backends } from '../../src/runtime-state'
import { brepOf, fromBrep } from '../../src/shape'
import type { BrepHandle } from '../../src/brep/engine/types'
import { createApiNamespaceWithEditorOps } from '../support/editor-ops'
import {
  edge, circleArc, ellipseEdge, ellipseArc, tangentArc,
  approximatePoints, interpolateWithTangents,
  curveDegreeElevate, curveKnotInsert, curveKnotRemove, curveIsPeriodic,
} from '../../src/api/curve-sketch'

beforeAll(async () => {
  await initOcctWasm()
}, 120000)

afterAll(() => {
  __resetEngineRegistriesForTests()
})

function ports(): HostPorts {
  return { events: { emit: () => {} } } as HostPorts
}

async function useOcct(): Promise<void> {
  __resetEngineRegistriesForTests()
  await registerOcctBrepEngine()
}

function exec(mode: ExecutionMode, code: string): Promise<ExecutionResult> {
  return new CadRuntime(ports(), mode, { cad: createApiNamespaceWithEditorOps() }).execute(code)
}

async function shapeOf(mode: ExecutionMode, code: string, part: string): Promise<Shape> {
  const result = await exec(mode, code)
  if (result.failedAt) {
    throw new Error(`execution failed at ${result.failedAt.callee}: ${result.failedAt.message}`)
  }
  const s = result.outputs.get(asPartName(part))
  if (!s) throw new Error(`no output for ${part}`)
  return s as Shape
}

const kindOf = (s: Shape): string | undefined => (s as { kind?: string }).kind

/** 内核句柄工具：bbox / 长度 / 曲线参数点 / NURBS 数据。 */
function bboxOf(s: Shape): { xmin: number; xmax: number; ymin: number; ymax: number; zmin: number; zmax: number } {
  return getBrepApi().getBoundingBox(brepOf(s) as never)
}
function curveLen(s: Shape): number {
  return getOcctKernel().curveLength(brepOf(s) as never) as number
}
function nurbsOf(s: Shape): { degree: number; knots: number[]; poles: number[] } {
  return getOcctKernel().getNurbsCurveData(brepOf(s) as never) as never
}

describe('S4 曲线草图族 — occt 正例（脚本级）', () => {
  it('A1. edge：两点构造直线边，长度 10，bbox x∈[0,10]', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part0 = cad.edge([0,0,0],[10,0,0])\n`, 'part0')
    expect(kindOf(s)).toBe('curve')
    expect(curveLen(s)).toBeCloseTo(10, 6)
    const b = bboxOf(s)
    expect(b.xmin).toBeCloseTo(0, 6)
    expect(b.xmax).toBeCloseTo(10, 6)
  })

  it('A2. circleArc 0→90°：四分之一圆弧（角度收**度**，内部换算弧度），bbox x/y∈[0,r]', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part0 = cad.circleArc([0,0,0],[0,0,1],5,0,90)\n`, 'part0')
    expect(kindOf(s)).toBe('curve')
    // 若角度被当作弧度，0→90rad 的弧长会是 ~450，而不是 πr/2 ≈ 7.854。
    expect(curveLen(s)).toBeCloseTo((Math.PI * 5) / 2, 4)
    const b = bboxOf(s)
    expect(b.xmin).toBeCloseTo(0, 4)
    expect(b.xmax).toBeCloseTo(5, 4)
    expect(b.ymin).toBeCloseTo(0, 4)
    expect(b.ymax).toBeCloseTo(5, 4)
    expect(Math.abs(b.zmax - b.zmin)).toBeLessThanOrEqual(1e-6)
  })

  it('A3. circleArc 0→360°：整圆，周长 2πr（同上钉角度约定）', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part0 = cad.circleArc([0,0,0],[0,0,1],5,0,360)\n`, 'part0')
    expect(kindOf(s)).toBe('curve')
    expect(curveLen(s)).toBeCloseTo(2 * Math.PI * 5, 3)
  })

  it('A4. ellipseEdge：整椭圆边，bbox [-10,10]×[-5,5]', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part0 = cad.ellipseEdge([0,0,0],[0,0,1],10,5)\n`, 'part0')
    expect(kindOf(s)).toBe('curve')
    const b = bboxOf(s)
    expect(b.xmin).toBeCloseTo(-10, 4)
    expect(b.xmax).toBeCloseTo(10, 4)
    expect(b.ymin).toBeCloseTo(-5, 4)
    expect(b.ymax).toBeCloseTo(5, 4)
  })

  it('A5. ellipseArc 0→90°：椭圆弧（角度收度），bbox [0,10]×[0,5]', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part0 = cad.ellipseArc([0,0,0],[0,0,1],10,5,0,90)\n`, 'part0')
    expect(kindOf(s)).toBe('curve')
    const b = bboxOf(s)
    expect(b.xmin).toBeCloseTo(0, 4)
    expect(b.xmax).toBeCloseTo(10, 4)
    expect(b.ymin).toBeCloseTo(0, 4)
    expect(b.ymax).toBeCloseTo(5, 4)
  })

  it('A6. tangentArc：起点切向出发终于终点，两端点精确', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part0 = cad.tangentArc([0,0,0],[1,0,0],[5,5,0])\n`, 'part0')
    expect(kindOf(s)).toBe('curve')
    const k = getOcctKernel()
    const h = brepOf(s) as never
    const first = k.curvePointAtParam(h, k.curveParameters(h).first) as { x: number; y: number; z: number }
    const last = k.curvePointAtParam(h, k.curveParameters(h).last) as { x: number; y: number; z: number }
    expect([first.x, first.y, first.z]).toEqual([0, 0, 0])
    expect(last.x).toBeCloseTo(5, 6)
    expect(last.y).toBeCloseTo(5, 6)
  })

  it('A7. approximatePoints：点集逼近曲线，bbox 覆盖点集跨度', async () => {
    await useOcct()
    const s = await shapeOf('brep', `let part0 = cad.approximatePoints([[0,0,0],[5,3,0],[10,0,0]])\n`, 'part0')
    expect(kindOf(s)).toBe('curve')
    const b = bboxOf(s)
    expect(b.xmin).toBeCloseTo(0, 3)
    expect(b.xmax).toBeCloseTo(10, 3)
    expect(b.ymax).toBeGreaterThan(2) // 弧顶接近中间点
  })

  it('A8. interpolateWithTangents：插值曲线两端点 = 首末点（严格过点）', async () => {
    await useOcct()
    const s = await shapeOf(
      'brep',
      `let part0 = cad.interpolateWithTangents([[0,0,0],[5,3,0],[10,0,0]],[1,0,0],[1,0,0])\n`,
      'part0',
    )
    expect(kindOf(s)).toBe('curve')
    const k = getOcctKernel()
    const h = brepOf(s) as never
    const first = k.curvePointAtParam(h, k.curveParameters(h).first) as { x: number; y: number; z: number }
    const last = k.curvePointAtParam(h, k.curveParameters(h).last) as { x: number; y: number; z: number }
    expect(first.y).toBeCloseTo(0, 6)
    expect(last.x).toBeCloseTo(10, 6)
    expect(last.y).toBeCloseTo(0, 6)
  })
})

describe('S4 曲线草图族 — NURBS 精修（TS 直连，输入为 B 样条插值曲线）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const brep = await getBrepEngine()
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
      kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: { emit: () => undefined },
    } as unknown as Backends)
  }, 120000)

  it('A9. curveDegreeElevate：升阶后 degree +1，长度不变', async () => {
    const bs = await interpolateWithTangents([[0, 0, 0], [5, 3, 0], [10, 0, 0]], [1, 0, 0], [1, 0, 0])
    const before = nurbsOf(bs)
    const len = curveLen(bs)
    const up = await curveDegreeElevate(bs, 2)
    expect(kindOf(up)).toBe('curve')
    const after = nurbsOf(up)
    expect(after.degree).toBe(before.degree + 2)
    expect(curveLen(up)).toBeCloseTo(len, 6)
  })

  it('A10. curveKnotInsert：插节点后节点数 +1，几何（长度）不变', async () => {
    const bs = await interpolateWithTangents([[0, 0, 0], [5, 3, 0], [10, 0, 0]], [1, 0, 0], [1, 0, 0])
    const data = nurbsOf(bs)
    const len = curveLen(bs)
    const mid = (data.knots[0]! + data.knots[data.knots.length - 1]!) / 2
    const refined = await curveKnotInsert(bs, mid, 1)
    expect(kindOf(refined)).toBe('curve')
    expect(nurbsOf(refined).knots.length).toBe(data.knots.length + 1)
    expect(curveLen(refined)).toBeCloseTo(len, 6)
  })

  it('A11. curveKnotRemove：容差内去节点，长度漂移 <= tolerance', async () => {
    const bs = await interpolateWithTangents([[0, 0, 0], [5, 3, 0], [10, 0, 0]], [1, 0, 0], [1, 0, 0])
    // 先插一个节点再造冗余，随后在容差内移除。
    const seeded = await curveKnotInsert(bs, 0.5, 1)
    const len = curveLen(seeded)
    const lean = await curveKnotRemove(seeded, 0.5, 1e-3)
    expect(kindOf(lean)).toBe('curve')
    expect(Math.abs(curveLen(lean) - len)).toBeLessThanOrEqual(1e-3)
  })

  it('A12. curveIsPeriodic：整圆 true、直线边 false（occt 原生周期性语义）', async () => {
    const circle = await circleArc([0, 0, 0], [0, 0, 1], 5, 0, 360)
    const line = await edge([0, 0, 0], [10, 0, 0])
    expect(curveIsPeriodic(circle)).toBe(true)
    expect(curveIsPeriodic(line)).toBe(false)
  })
})

describe('S4 曲线草图族 — 入参校验', () => {
  it('B. circleArc 半径 <= 0 / 角度非有限数 → 专用错误码', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.circleArc([0,0,0],[0,0,1],-1,0,90)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_CIRCLEARC_BAD_RADIUS/)
    const a = await exec('brep', `let part0 = cad.circleArc([0,0,0],[0,0,1],5,0,'x')\n`)
    expect(JSON.stringify(a.failedAt)).toMatch(/E_CIRCLEARC_BAD_ANGLE/)
  })

  it('B. ellipseEdge minor > major → E_ELLIPSEEDGE_BAD_RADII（gp_Elips 约束）', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.ellipseEdge([0,0,0],[0,0,1],5,10)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_ELLIPSEEDGE_BAD_RADII/)
  })

  it('B. tangentArc 零切向 → E_TANGENTARC_BAD_TANGENT', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.tangentArc([0,0,0],[0,0,0],[5,5,0])\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_TANGENTARC_BAD_TANGENT/)
  })

  it('B. approximatePoints 点数 < 2 → E_APPROXIMATEPOINTS_BAD_POINTS', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.approximatePoints([[0,0,0]])\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_APPROXIMATEPOINTS_BAD_POINTS/)
  })

  it('B. curveDegreeElevate 非正整数 → E_CURVEDEGREEELEVATE_BAD_STEP', async () => {
    await useOcct()
    const r = await exec('brep', `let part0 = cad.edge([0,0,0],[1,0,0])\nlet part1 = cad.curveDegreeElevate(part0, 1.5)\n`)
    expect(JSON.stringify(r.failedAt)).toMatch(/E_CURVEDEGREEELEVATE_BAD_STEP/)
  })
})

describe('S4 曲线草图族 — 平台身份（brepkit 下执行前静态拒绝，D11-4）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerBrepkitBrepEngine()
  }, 120000)

  /** 各 op 的最小调用形态（brepkit 下在触碰内核前即被拒，参数只需过 parse）。 */
  const CALLS: Array<[string, string]> = [
    ['edge', `let part0 = cad.edge([0,0,0],[1,0,0])\n`],
    ['circleArc', `let part0 = cad.circleArc([0,0,0],[0,0,1],5,0,90)\n`],
    ['ellipseEdge', `let part0 = cad.ellipseEdge([0,0,0],[0,0,1],10,5)\n`],
    ['ellipseArc', `let part0 = cad.ellipseArc([0,0,0],[0,0,1],10,5,0,90)\n`],
    ['tangentArc', `let part0 = cad.tangentArc([0,0,0],[1,0,0],[5,5,0])\n`],
    ['approximatePoints', `let part0 = cad.approximatePoints([[0,0,0],[5,3,0],[10,0,0]])\n`],
    ['interpolateWithTangents', `let part0 = cad.interpolateWithTangents([[0,0,0],[5,3,0],[10,0,0]],[1,0,0],[1,0,0])\n`],
    ['curveDegreeElevate', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.curveDegreeElevate(part0, 1)\n`],
    ['curveKnotInsert', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.curveKnotInsert(part0, 0.5, 1)\n`],
    ['curveKnotRemove', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.curveKnotRemove(part0, 0.5, 1e-3)\n`],
    ['curveIsPeriodic', `let part0 = cad.wire([[0,0,0],[1,0,0]])\nlet part1 = cad.curveIsPeriodic(part0)\n`],
  ]

  for (const [op, code] of CALLS) {
    it(`${op}: requires engine occt (current=brepkit)`, async () => {
      const result = await exec('brep', code)
      expect(result.failedAt).toBeDefined()
      const msg = JSON.stringify(result.failedAt)
      expect(msg).toMatch(/E_BREP_UNSUPPORTED/)
      expect(msg).toMatch(new RegExp(`op '${op}' requires engine occt`))
      expect(msg).toMatch(/current=brepkit/)
    })
  }
})

describe('S4 曲线草图族 — TS 级直连（L1 覆盖门禁 + vertex 入参形态）', () => {
  beforeAll(async () => {
    __resetEngineRegistriesForTests()
    await registerOcctBrepEngine()
    const brep = await getBrepEngine()
    configureBackends({
      contractVersion: CONTRACT_VERSION,
      config: { mode: 'auto', brepCapabilities: brep.capabilities, brepEngineId: 'occt' },
      kernel: { brep: brep.primitives, csg: undefined, sdf: undefined },
      fonts: undefined,
      texture: undefined,
      assets: undefined,
      events: { emit: () => undefined },
    } as unknown as Backends)
  }, 120000)

  it('D. edge 接受 vertex Shape 入参（L1 makeVertex 物化的顶点对）', async () => {
    const kernel = getBrepApi()
    const v1 = fromBrep(kernel.makeVertex(0, 0, 0) as unknown as BrepHandle, {
      solid: kernel.makeVertex(0, 0, 0) as unknown as BrepHandle,
    })
    const v2 = fromBrep(kernel.makeVertex(10, 0, 0) as unknown as BrepHandle, {
      solid: kernel.makeVertex(10, 0, 0) as unknown as BrepHandle,
    })
    const e = await edge(v1, v2)
    expect(kindOf(e)).toBe('curve')
    expect(curveLen(e)).toBeCloseTo(10, 6)
  })

  it('D. mesh-only 输入（无 BREP 柄）报 NO_BREP，而非穿透到 occt', async () => {
    const { solid } = await import('../../src/shape')
    const meshOnly = solid({ positions: new Float32Array([]), indices: new Uint32Array([]) })
    await expect(curveDegreeElevate(meshOnly as Shape, 1)).rejects.toThrow(/E_CURVEDEGREEELEVATE_NO_BREP/)
    expect(() => curveIsPeriodic(meshOnly as Shape)).toThrow(/E_CURVEISPERIODIC_NO_BREP/)
  })
})
