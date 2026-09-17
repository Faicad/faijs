/**
 * cq-compat 端到端：buildAssembly 默认 global 求解器（P2，对齐
 * assembly-global-solver-plan.md §4.4 / P2）。
 *
 * 不依赖 CQ 参考基线（mini_lathe 尚未生成）：用两个 faijs 盒子构造 mate
 * 约束，走完整管线 buildAssembly → cad.assembly({solver:'global'}) →
 * solveAssemblyAndKinematics → solveGlobal，断言：
 *   1) solveDetailed 返回 residuals（证明 global 路径被选中）；
 *   2) 从动件 B 的变换把其底面对齐到 A 的顶面（translation = cA - cB）；
 *   3) 残差 ~0（mate 被满足）。
 * 另对照 opts.solver='chain' 路径：residuals 不填（chain 路径语义，证明
 * 默认 global 与显式 chain 行为可区分）。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs-core/node'
import { getSlot } from '@faicad/faijs-core/shape'
import { asPartName } from '@faicad/faijs-core/identity'
import type { Shape } from '@faicad/faijs-core/mesh/types'
import type { AssemblyConstraint, MateConstraint } from '@faicad/faijs-core/api/assembly/types'
import type { AssemblyTransform } from '@faicad/faijs-core/runtime-state'
import * as cq from './index'

let runtime: ReturnType<typeof createRuntime>
let boxA: Shape
let boxB: Shape

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)

  const res = await runtime.execute([
    "import * as cq from '@faicad/cq-compat'",
    'let b = cq.box(cq.Workplane("XY"), 100, 80, 10)',
    'let boxA = cq.val(b)',
    'let boxB = cq.val(b)',
  ].join('\n'))
  expect(res.failedAt).toBeUndefined()
  boxA = res.outputs.get(asPartName('boxA')) as Shape
  boxB = res.outputs.get(asPartName('boxB')) as Shape
  expect(boxA).toBeDefined()
  expect(boxB).toBeDefined()
}, 120000)

function applyAt(t: AssemblyTransform, p: [number, number, number]): [number, number, number] {
  const m = t.rotationMatrix
  const d: [number, number, number] = [p[0] - t.pivot[0], p[1] - t.pivot[1], p[2] - t.pivot[2]]
  const r: [number, number, number] = [
    m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
    m[3] * d[0] + m[4] * d[1] + m[5] * d[2],
    m[6] * d[0] + m[7] * d[1] + m[8] * d[2],
  ]
  return [r[0] + t.pivot[0] + t.translation[0], r[1] + t.pivot[1] + t.translation[1], r[2] + t.pivot[2] + t.translation[2]]
}

function rotAt(t: AssemblyTransform, v: [number, number, number]): [number, number, number] {
  const m = t.rotationMatrix
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

describe('cq-compat: buildAssembly 默认 global 端到端', () => {
  it('mate：B 底面贴合到 A 顶面（global 求解）', async () => {
    const cons = await cq.constraintEx('A', '>Z', boxA, 'B', '<Z', boxB, 'Plane')
    expect(cons).toHaveLength(1)
    const mate = cons[0] as MateConstraint
    expect(mate.type).toBe('mate')

    const cA = (mate.a as { face: { center: [number, number, number]; normal: [number, number, number] } }).face.center
    const nA = (mate.a as { face: { normal: [number, number, number] } }).face.normal
    const cB = (mate.b as { face: { center: [number, number, number]; normal: [number, number, number] } }).face.center
    const nB = (mate.b as { face: { normal: [number, number, number] } }).face.normal

    const compound = cq.buildAssembly('asm', [
      { name: 'A', shape: boxA },
      { name: 'B', shape: boxB },
    ], [mate] as AssemblyConstraint[])

    const behavior = getSlot(compound)?.behavior as { solveDetailed: () => { transforms: AssemblyTransform[]; residuals?: number[] } }
    const res = behavior.solveDetailed()

    // 1) global 路径标志：residuals 被填（chain 路径不填）
    expect(res.residuals).toBeDefined()
    expect(res.residuals?.length).toBe(1)

    // 2) 从动件 B（index 1）的变换存在
    const tB = res.transforms.find((t) => t.index === 1)
    expect(tB).toBeDefined()

    // 3) 变换把 B 底面对齐到 A 顶面：translation = cA - cB（mate 的平移分量）
    const expected: [number, number, number] = [cA[0] - cB[0], cA[1] - cB[1], cA[2] - cB[2]]
    for (let i = 0; i < 3; i++) expect(tB!.translation[i]).toBeCloseTo(expected[i], 3)

    // 4) 应用变换后 B 底面中心 == A 顶面中心
    const worldB = applyAt(tB!, cB)
    for (let i = 0; i < 3; i++) expect(worldB[i]).toBeCloseTo(cA[i], 3)

    // 5) 法向映射正确：mate 使两面法向反平行（面面相对），即 nB 经旋转后 == -nA
    const rnB = rotAt(tB!, nB)
    for (let i = 0; i < 3; i++) expect(rnB[i]).toBeCloseTo(-nA[i], 3)

    // 6) 残差 ~0（mate 被满足）
    expect(res.residuals![0]).toBeLessThan(1e-6)
  })

  it('显式 opts.solver="chain" 走 chain 路径（residuals 不填，行为可区分）', async () => {
    const cons = await cq.constraintEx('A', '>Z', boxA, 'B', '<Z', boxB, 'Plane')
    const mate = cons[0] as MateConstraint
    const compound = cq.buildAssembly('asm2', [
      { name: 'A', shape: boxA },
      { name: 'B', shape: boxB },
    ], [mate] as AssemblyConstraint[], { solver: 'chain' })

    const behavior = getSlot(compound)?.behavior as { solveDetailed: () => { transforms: AssemblyTransform[]; residuals?: number[] } }
    const res = behavior.solveDetailed()
    expect(res.residuals).toBeUndefined()
    const tB = res.transforms.find((t) => t.index === 1)
    expect(tB).toBeDefined()
  })

  it('align：B 绕 Y 转 180° 使法向同向、面心重合（global 旋转路径）', async () => {
    // A 的 +X 面（法向 +X，中心 (50,0,0)）对齐 B 的 -X 面（法向 -X，中心 (-50,0,0)）。
    // align = 法向平行 + 面心重合 → B 绕 Y 轴转 180°，B 的 -X 面心落到 (50,0,0)。
    const cons = await cq.constraintEx('A', '>X', boxA, 'B', '<X', boxB, 'Axis')
    expect(cons).toHaveLength(1)
    const align = cons[0]
    expect(align.type).toBe('align')

    const aFace = (align.a as { face: { center: [number, number, number]; normal: [number, number, number] } }).face
    const bFace = (align.b as { face: { center: [number, number, number]; normal: [number, number, number] } }).face
    const cA = aFace.center
    const nA = aFace.normal
    const cB = bFace.center
    const nB = bFace.normal

    const compound = cq.buildAssembly('asm3', [
      { name: 'A', shape: boxA },
      { name: 'B', shape: boxB },
    ], [align] as AssemblyConstraint[])

    const behavior = getSlot(compound)?.behavior as { solveDetailed: () => { transforms: AssemblyTransform[]; residuals?: number[] } }
    const res = behavior.solveDetailed()
    expect(res.residuals).toBeDefined()
    expect(res.residuals?.length).toBe(1)

    const tB = res.transforms.find((t) => t.index === 1)
    expect(tB).toBeDefined()

    // align 绕接触法向（此处 +X）有自由旋转 DOF，故不断言具体四元数；
    // 只验证几何语义：面心重合 + 法向平行（同向）。
    // 面心重合：B 的 -X 面心变换后 == A 的 +X 面心
    const worldB = applyAt(tB!, cB)
    for (let i = 0; i < 3; i++) expect(worldB[i]).toBeCloseTo(cA[i], 3)
    // 法向平行（同向）：R·nB == nA
    const rnB = rotAt(tB!, nB)
    for (let i = 0; i < 3; i++) expect(rnB[i]).toBeCloseTo(nA[i], 3)
    // 残差 ~0
    expect(res.residuals![0]).toBeLessThan(1e-6)
  })
})
