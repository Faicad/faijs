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

  it('Axis→angle:180：B 法向反平行、无位置约束（global 纯方向路径，CQ 语义）', async () => {
    // GOTCHA (2026-09-17，对照 CQ 2.8.0 `occ_impl/solver.py` 标定)：CQ 独立 Axis 约束是
    // **纯方向约束**（axis_cost 缺省 val=pi 反平行，无点项）。旧映射 'align'（同向 + 面心
    // 重合）已推翻——本用例即防回归：断言 type==='angle'、无面心重合要求、法向反平行。
    // A 的 +X 面（法向 +X）与 B 的 -X 面（法向 -X）：反平行解下 B 恒等位姿即满足方向
    // 约束；位置无任何约束（初始 0 保持 0），**不得**断言面心重合。
    const cons = await cq.constraintEx('A', '>X', boxA, 'B', '<X', boxB, 'Axis')
    expect(cons).toHaveLength(1)
    const ang = cons[0] as Extract<AssemblyConstraint, { type: 'angle' }>
    expect(ang.type).toBe('angle')
    expect(ang.value).toBe(180)

    const aFace = (ang.a as { face: { center: [number, number, number]; normal: [number, number, number] } }).face
    const bFace = (ang.b as { face: { center: [number, number, number]; normal: [number, number, number] } }).face
    const nA = aFace.normal
    const nB = bFace.normal

    const compound = cq.buildAssembly('asm3', [
      { name: 'A', shape: boxA },
      { name: 'B', shape: boxB },
    ], [ang] as AssemblyConstraint[])

    const behavior = getSlot(compound)?.behavior as { solveDetailed: () => { transforms: AssemblyTransform[]; residuals?: number[] } }
    const res = behavior.solveDetailed()
    expect(res.residuals).toBeDefined()
    expect(res.residuals?.length).toBe(1)

    const tB = res.transforms.find((t) => t.index === 1)
    expect(tB).toBeDefined()

    // 方向约束：nB 经旋转后 == -nA（反平行）
    const rnB = rotAt(tB!, nB)
    for (let i = 0; i < 3; i++) expect(rnB[i]).toBeCloseTo(-nA[i], 3)
    // 无点项：位置无约束，B 停在初值（平移 ≈ 0）
    for (let i = 0; i < 3; i++) expect(tB!.translation[i]).toBeCloseTo(0, 3)
    // 残差 ~0（方向约束被满足）
    expect(res.residuals![0]).toBeLessThan(1e-6)
  })
})
