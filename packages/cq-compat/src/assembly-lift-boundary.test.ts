/**
 * @faicad/cq-compat-assembly 装配函数 op 提升边界 —— 回归守卫（缺陷已修复 2026-09-17）
 *
 * 历史缺陷（实测确证）：`runtime.registerLib('cq', cq, …)` 时 cq-compat 命名空间
 * 无 dual-op → lift=true → compatOp 适配器先 `borrowDeep` 实参，把 faijs Shape
 * 换成借用 brepjs 视图（`isShape=false`、`brepOf=undefined`）→ `resolveFaceSelector`
 * 落到整形状 bbox 兜底 → `cad.bboxMax` 读 `shape.vertices` undefined
 * → `TypeError: reading 'length'`。真实 e2e 在第一条约束（c1）即因此失败。
 *
 * 修复：`asBrepShape`（主包 workplane）入口归一——借用视图经 `fromHandle` 还原为
 * 真实 Shape（三角化 + BREP 身份槽），按视图对象 WeakMap 缓存；调用点：
 * `resolveFaceSelector` / `constraintEx`(Plane/Axis) / `resolveAxisRef` /
 * `buildAssembly` members。
 *
 * 测试策略（直接调用陷阱）：
 * 测试进程内直接调用（不经 compatOp 提升）拿到的是真实 Shape，不会触发提升
 * 路径——§5.7（core-decouple）：l3-bridge 借入面已收口，本文件以真实 Shape 直
 * Shape 的产物形态完全一致），直接喂给装配函数，确定性模拟提升路径，无需
 * .fai.js 脚本。真实端到端（runtime.execute → 提升 → 求解 → 与 CQ 2.8.0
 * 参考位姿比对）在外部案例项目（mini_lathe）经 CadQuery 语法面
 * （buildAssembly → solve() → toCompound()）覆盖。
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createRuntime, registerOcctBrepEngine } from '@faicad/faijs'
import { createNodePorts } from '@faicad/faijs/node'
import { isShape, hasBrep } from '@faicad/faijs/shape'
import { asPartName } from '@faicad/faijs/identity'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { CompoundShape } from '@faicad/faijs/shape'
import type { AssemblyConstraint } from '@faicad/faijs/api/assembly/types'
import * as cq from '@faicad/cq-compat'
import { asBrepShape, resolveFaceSelector } from './workplane'
import { buildAssembly, constraint, constraintEx } from './assembly/index'

type V3 = [number, number, number]

let runtime: ReturnType<typeof createRuntime>
let boxA: Shape
let boxB: Shape

beforeAll(async () => {
  await registerOcctBrepEngine()
  runtime = createRuntime(createNodePorts(), 'brep')
  runtime.registerLib('cq', cq as never, { packageName: '@faicad/cq-compat' } as never)

  // 经 runtime 执行（brep 链）产出带 BREP 槽的真实 Shape —— 与真实装配
  // parts 产物同形态。100×100×50 中心在原点 → 顶面 [0,0,25]/法向 +Z。
  const res = await runtime.execute(
    [
      "import * as cq from '@faicad/cq-compat'",
      "let wpA = cq.Workplane('XY')",
      'let bA = cq.box(wpA, 100, 100, 50)',
      "let wpB = cq.Workplane('XY')",
      'let bB = cq.box(wpB, 100, 100, 50)',
      'let boxA = cq.val(bA)',
      'let boxB = cq.val(bB)',
    ].join('\n'),
  )
  expect(res.failedAt).toBeUndefined()
  boxA = res.outputs.get(asPartName('boxA')) as Shape
  boxB = res.outputs.get(asPartName('boxB')) as Shape
  expect(boxA).toBeDefined()
  expect(hasBrep(boxA)).toBe(true)
  expect(boxB).toBeDefined()
  expect(hasBrep(boxB)).toBe(true)
}, 240000)

/** 与 p3 测试同款：从 mate/align 约束里取出 face 快照。 */
function faceOf(c: AssemblyConstraint): { center: V3; normal: V3 } {
  const f = (c as unknown as { a: { face: { center: V3; normal: V3 } } }).a.face
  return { center: f.center, normal: f.normal }
}
function faceBOf(c: AssemblyConstraint): { center: V3; normal: V3 } {
  const f = (c as unknown as { b: { face: { center: V3; normal: V3 } } }).b.face
  return { center: f.center, normal: f.normal }
}

describe('cq-compat-assembly: 提升边界借用视图归一（回归守卫）', () => {
  it('asBrepShape：真实 Shape 原样透传；借用视图 → 真实 Shape（WeakMap 缓存）', () => {
    expect(asBrepShape(boxA)).toBe(boxA)

    // §5.7：借用视图机制已收口——归一化只剩真实 Shape 直通路径（asBrepShape 透传）。
  })

  it('resolveFaceSelector 接受借用视图：走 BREP 分支，不崩溃（历史崩溃点）', async () => {
    const r = await resolveFaceSelector(boxA, '>Z')
    expect(r.center[0]).toBeCloseTo(0, 3)
    expect(r.center[1]).toBeCloseTo(0, 3)
    expect(r.center[2]).toBeCloseTo(25, 3)
    expect(r.normal).toEqual([0, 0, 1])
  })

  it('cq.constraint（视图实参，模拟提升路径）：mate 几何与直接调用一致', async () => {
    // 历史崩溃路径：cq.constraint("bp",">Z",bp,"mb","<Z",mb,"Plane")
    const lifted = await constraint('bp', '>Z', boxA, 'mb', '<Z', boxB, 'Plane')
    expect(lifted.type).toBe('mate')
    const la = faceOf(lifted)
    const lb = faceBOf(lifted)
    expect(la.center).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)])
    expect(la.center[2]).toBeCloseTo(25, 3)
    expect(la.normal).toEqual([0, 0, 1])
    expect(lb.center[2]).toBeCloseTo(-25, 3)
    expect(lb.normal).toEqual([0, 0, -1])

    // 直接路径（真实 Shape）与提升路径（借用视图）产出等价 face 几何
    const direct = await constraint('bp', '>Z', boxA, 'mb', '<Z', boxB, 'Plane')
    expect(faceOf(direct)).toEqual(la)
    expect(faceBOf(direct)).toEqual(lb)
  })

  it('cq.buildAssembly（视图成员）：children 为真实 Shape 且 global 求解收敛', async () => {
    // fixed(bp) + mate(bp>mb)：与 p3 测试同型，验证归一成员可被求解器消费
    const fixed = await constraintEx('bp', '>Z', boxA, 'mb', '<Z', boxB, 'Fixed')
    const mate = await constraintEx('bp', '>Z', boxA, 'mb', '<Z', boxB, 'Plane')
    const constraints: AssemblyConstraint[] = [...fixed, ...mate] as AssemblyConstraint[]

    const asm = buildAssembly(
      'asm',
      [
        { name: 'bp', shape: boxA },
        { name: 'mb', shape: boxB },
      ],
      constraints,
    )
    const compound = asm.compound as CompoundShape
    expect(compound.kind).toBe('compound')
    // 提升路径成员归一后 children 必须是真实 Shape（持 mesh + BREP 槽），
    // 否则引擎 applyTransform 顶点烘焙 / STEP 导出断裂
    const children = compound.children
    expect(children).toHaveLength(2)
    for (const ch of children) {
      expect(isShape(ch)).toBe(true)
      expect(hasBrep(ch)).toBe(true)
    }

    // 归一后的装配经 CadQuery 语法面求解：global 残差收敛，mb 底面贴合 bp 顶面
    asm.solve()
    expect(asm.residuals?.length).toBe(2)
    for (const r of asm.residuals!) expect(r).toBeLessThan(1e-6)
    // bp（fixed，index 0）不输出变换；mb（index 1）有变换
    expect(asm.transforms).toHaveLength(1)
    const t = asm.transforms.find((x) => x.index === 1)!
    const m = t.rotationMatrix
    const d: V3 = [0 - t.pivot[0], 0 - t.pivot[1], -25 - t.pivot[2]]
    const rx = m[0] * d[0] + m[1] * d[1] + m[2] * d[2]
    const rz = m[6] * d[0] + m[7] * d[1] + m[8] * d[2]
    expect(rx + t.pivot[0] + t.translation[0]).toBeCloseTo(0, 3)
    expect(rz + t.pivot[2] + t.translation[2]).toBeCloseTo(25, 3)
  })
})
