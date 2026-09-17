/**
 * cq-compat 端到端多成员回归（P3，对齐 assembly-global-solver-plan.md §5/P3）。
 *
 * 不依赖 CQ 参考基线（mini_lathe 尚未生成）：纯 faijs 多部件装配，走完整管线
 *   buildAssembly(默认 global) → cad.assembly({solver:'global'}) →
 *   solveAssemblyAndKinematics → solveGlobal
 * 覆盖三场景：
 *   1) 三部件混合约束：fixed(A) + mate(A>B) + align(A>C)；
 *   2) 圆柱 concentric 全链路：A=fixed 圆柱，B=圆柱 Cylinder 配合（验证
 *      resolveAxisRef 的 wireframe 取圆边轴在 buildAssembly 链路下可用）；
 *   3) 链式三盒 mate：A>B>C 级联，验证多成员全局求解的级联位姿。
 *
 * 全部断言几何不变量（面心重合 / 法向平行或反平行 / 轴共线），不因自由旋转
 * DOF（mate/align/concentric 接触法向的自由转角）而断言具体四元数。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { getSlot } from '@faicad/faijs-core/shape'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import type { AssemblyConstraint } from '@faicad/faijs-core/api/assembly/types'
import type { AssemblyTransform } from '@faicad/faijs-core/runtime-state'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>
let boxA: Shape
let boxB: Shape
let boxC: Shape
let cylA: Shape
let cylB: Shape

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)

  // 复用 P2 已验证的「先赋异步结果给变量、再 cq.val」模式
  const res = await runtime.execute([
    "import * as cq from '@faicad/cq-compat'",
    'let bA = cq.box(cq.Workplane("XY"), 100, 80, 10)',
    'let bB = cq.box(cq.Workplane("XY"), 60, 60, 12)',
    'let bC = cq.box(cq.Workplane("XY"), 60, 60, 12)',
    'let cA = cq.cylinder(cq.Workplane("XY"), 20, 20)',
    'let cB = cq.cylinder(cq.Workplane("XY"), 30, 8)',
    'let boxA = cq.val(bA)',
    'let boxB = cq.val(bB)',
    'let boxC = cq.val(bC)',
    'let cylA = cq.val(cA)',
    'let cylB = cq.val(cB)',
  ].join('\n'))
  expect(res.failedAt).toBeUndefined()
  boxA = res.outputs.get(asPartName('boxA')) as Shape
  boxB = res.outputs.get(asPartName('boxB')) as Shape
  boxC = res.outputs.get(asPartName('boxC')) as Shape
  cylA = res.outputs.get(asPartName('cylA')) as Shape
  cylB = res.outputs.get(asPartName('cylB')) as Shape
  for (const [n, s] of [['boxA', boxA], ['boxB', boxB], ['boxC', boxC], ['cylA', cylA], ['cylB', cylB]] as const) {
    expect(s, `shape ${n} must be defined`).toBeDefined()
  }
}, 120000)

type V3 = [number, number, number]
function applyAt(t: AssemblyTransform, p: V3): V3 {
  const m = t.rotationMatrix
  const d: V3 = [p[0] - t.pivot[0], p[1] - t.pivot[1], p[2] - t.pivot[2]]
  const r: V3 = [
    m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
    m[3] * d[0] + m[4] * d[1] + m[5] * d[2],
    m[6] * d[0] + m[7] * d[1] + m[8] * d[2],
  ]
  return [r[0] + t.pivot[0] + t.translation[0], r[1] + t.pivot[1] + t.translation[1], r[2] + t.pivot[2] + t.translation[2]]
}
function rotAt(t: AssemblyTransform, v: V3): V3 {
  const m = t.rotationMatrix
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}
function faceOf(c: AssemblyConstraint): { center: V3; normal: V3 } {
  const f = (c as unknown as { a: { face: { center: V3; normal: V3 } } }).a.face
  return { center: f.center, normal: f.normal }
}
function faceBOf(c: AssemblyConstraint): { center: V3; normal: V3 } {
  const f = (c as unknown as { b: { face: { center: V3; normal: V3 } } }).b.face
  return { center: f.center, normal: f.normal }
}
function axisOf(c: AssemblyConstraint): { origin: V3; direction: V3 } {
  const a = (c as unknown as { a: { edge: { axis: { origin: V3; direction: V3 } } } }).a.edge.axis
  return { origin: a.origin, direction: a.direction }
}
function axisBOf(c: AssemblyConstraint): { origin: V3; direction: V3 } {
  const a = (c as unknown as { b: { edge: { axis: { origin: V3; direction: V3 } } } }).b.edge.axis
  return { origin: a.origin, direction: a.direction }
}
function closeToV3(a: V3, b: V3, eps = 1e-3): void {
  for (let i = 0; i < 3; i++) expect(a[i], `axis ${i}: ${a[i]} ≈ ${b[i]}`).toBeCloseTo(b[i], 3)
}

describe('cq-compat: 多成员 global 端到端回归（P3）', () => {
  it('三部件混合：fixed(A) + mate(A>B) + align(A>C)', async () => {
    const fixedA = await cq.constraintEx('A', '>Z', boxA, 'B', '<Z', boxB, 'Fixed')
    const mateAB = await cq.constraintEx('A', '>Z', boxA, 'B', '<Z', boxB, 'Plane')
    const alignAC = await cq.constraintEx('A', '>X', boxA, 'C', '<X', boxC, 'Axis')
    expect(fixedA[0].type).toBe('fixed')
    expect(mateAB[0].type).toBe('mate')
    expect(alignAC[0].type).toBe('align')

    const constraints: AssemblyConstraint[] = [...fixedA, ...mateAB, ...alignAC] as AssemblyConstraint[]
    const compound = cq.buildAssembly('asm3', [
      { name: 'A', shape: boxA },
      { name: 'B', shape: boxB },
      { name: 'C', shape: boxC },
    ], constraints)

    const behavior = getSlot(compound)?.behavior as {
      solveDetailed: () => { transforms: AssemblyTransform[]; residuals?: number[] }
    }
    const res = behavior.solveDetailed()

    // global 路径：逐约束残差被填（3 约束）
    expect(res.residuals).toBeDefined()
    expect(res.residuals?.length).toBe(3)
    for (const r of res.residuals!) expect(r).toBeLessThan(1e-6)

    // fixed(A, index 0) 恒等位姿不输出；B(index1)、C(index2) 有变换
    const tA = res.transforms.find((t) => t.index === 0)
    const tB = res.transforms.find((t) => t.index === 1)
    const tC = res.transforms.find((t) => t.index === 2)
    expect(tA).toBeUndefined()
    expect(tB).toBeDefined()
    expect(tC).toBeDefined()

    // mate(A>B)：B 底面对齐 A 顶面
    const aTop = faceOf(mateAB[0])
    const bBot = faceBOf(mateAB[0])
    closeToV3(applyAt(tB!, bBot.center), aTop.center)
    closeToV3(rotAt(tB!, bBot.normal), [-aTop.normal[0], -aTop.normal[1], -aTop.normal[2]])

    // align(A>C)：C 的 -X 面心重合 A 的 +X 面心，法向同向
    const aX = faceOf(alignAC[0])
    const cX = faceBOf(alignAC[0])
    closeToV3(applyAt(tC!, cX.center), aX.center)
    closeToV3(rotAt(tC!, cX.normal), aX.normal)
  })

  it('圆柱 concentric 全链路：A=fixed 圆柱，B=圆柱 Cylinder 配合', async () => {
    const fixedA = await cq.constraintEx('A', '>Z', cylA, 'B', '>Z', cylB, 'Fixed')
    const cyl = await cq.constraintEx('A', '>Z', cylA, 'B', '>Z', cylB, 'Cylinder')
    expect(cyl).toHaveLength(2)
    expect(cyl[0].type).toBe('concentric')
    expect(cyl[1].type).toBe('coincident')

    const constraints: AssemblyConstraint[] = [...fixedA, ...cyl] as AssemblyConstraint[]
    const compound = cq.buildAssembly('asmCyl', [
      { name: 'A', shape: cylA },
      { name: 'B', shape: cylB },
    ], constraints)

    const behavior = getSlot(compound)?.behavior as {
      solveDetailed: () => { transforms: AssemblyTransform[]; residuals?: number[] }
    }
    const res = behavior.solveDetailed()

    // 3 约束（fixed + concentric + coincident）各一条残差；fixed 恒为 0
    expect(res.residuals).toBeDefined()
    expect(res.residuals?.length).toBe(3)
    for (const r of res.residuals!) expect(r).toBeLessThan(1e-6)

    // A 固定不输出变换，B(index1) 有变换
    const tA = res.transforms.find((t) => t.index === 0)
    const tB = res.transforms.find((t) => t.index === 1)
    expect(tA).toBeUndefined()
    expect(tB).toBeDefined()

    // B 的轴（经变换）与 A 的轴共线、同向
    const axA = axisOf(cyl[0])
    const axB = axisBOf(cyl[0])
    // 方向平行且同向（concentric axis val=0）
    const dBp = rotAt(tB!, axB.direction)
    closeToV3(dBp, axA.direction)
    // B 轴原点落在 A 轴线上（perpendicular 距离 ≈ 0）
    const oBp = applyAt(tB!, axB.origin)
    const d: V3 = [oBp[0] - axA.origin[0], oBp[1] - axA.origin[1], oBp[2] - axA.origin[2]]
    const proj = d[0] * axA.direction[0] + d[1] * axA.direction[1] + d[2] * axA.direction[2]
    const perp: V3 = [d[0] - proj * axA.direction[0], d[1] - proj * axA.direction[1], d[2] - proj * axA.direction[2]]
    const pdist = Math.hypot(perp[0], perp[1], perp[2])
    expect(pdist).toBeLessThan(1e-4)
  })

  it('链式三盒 mate：A>B>C 级联（多成员全局求解）', async () => {
    const mateAB = await cq.constraintEx('A', '>Z', boxA, 'B', '<Z', boxB, 'Plane')
    const mateBC = await cq.constraintEx('B', '>Z', boxB, 'C', '<Z', boxC, 'Plane')
    expect(mateAB[0].type).toBe('mate')
    expect(mateBC[0].type).toBe('mate')

    const constraints: AssemblyConstraint[] = [...mateAB, ...mateBC] as AssemblyConstraint[]
    const compound = cq.buildAssembly('asmChain', [
      { name: 'A', shape: boxA },
      { name: 'B', shape: boxB },
      { name: 'C', shape: boxC },
    ], constraints)

    const behavior = getSlot(compound)?.behavior as {
      solveDetailed: () => { transforms: AssemblyTransform[]; residuals?: number[] }
    }
    const res = behavior.solveDetailed()

    expect(res.residuals).toBeDefined()
    expect(res.residuals?.length).toBe(2)
    for (const r of res.residuals!) expect(r).toBeLessThan(1e-6)

    const tB = res.transforms.find((t) => t.index === 1)
    const tC = res.transforms.find((t) => t.index === 2)
    expect(tB).toBeDefined()
    expect(tC).toBeDefined()

    // B 底对齐 A 顶
    const aTop = faceOf(mateAB[0])
    const bBot = faceBOf(mateAB[0])
    closeToV3(applyAt(tB!, bBot.center), aTop.center)

    // C 底对齐 B 顶（级联）：C 底的世界点 == B 顶的世界点
    const bTop = faceOf(mateBC[0])
    const cBot = faceBOf(mateBC[0])
    const worldBTop = applyAt(tB!, bTop.center)
    const worldCBot = applyAt(tC!, cBot.center)
    closeToV3(worldCBot, worldBTop)
  })
})
