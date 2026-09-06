/**
 * stdlib boolean — 布尔库函数（union/subtract/intersect，多输入）
 *
 *
 * dispatchPath 静态判定 brep/mesh，BREP 路径用 *WithHistory 收集面演化。
 *
 * 阶段 1：拆为三个薄函数 union/subtract/intersect + 兼容 boolean 导出（过渡）。
 * 阶段 3 将删除 boolean 兼容导出。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { solidToShape } from '../brep/brep-ops'
import {
  booleanWithRoleTable,
} from '../brep/face-evolution'
import { getBackends, getCurrentStmt, keepHidden } from '../runtime-state'
import { fromBrep, brepOf, getSlot } from '../shape'
import { reconcileBrepInputs } from './reconcile'
import { defineOp } from '../sdk'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

type BooleanOperation = 'union' | 'subtract' | 'intersect'

// ── 共享内部实现 ──

/** BREP 路径：fuse/cut/common（*WithHistory 封装，收集面演化 + roleTable 合流 §3.4）。 */
function booleanBrep(inputs: Shape[], operation: BooleanOperation): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/boolean] no OCCT kernel')

  const inputSolids = inputs.map((s) => brepOf(s) as BrepHandle | undefined)
  if (inputSolids.some((s) => !s)) {
    throw new Error('[stdlib/boolean] input is not BREP')
  }

  let resultSolid: BrepHandle
  let lastEvolution: Map<number, number[]> | undefined
  let roleTable: ReadonlyMap<unknown, unknown> | undefined

  // 链式布尔：每步 target（累积结果）与下一个 tool 合流
  const op: 'fuse' | 'cut' | 'intersect' =
    operation === 'union' ? 'fuse' : operation === 'subtract' ? 'cut' : 'intersect'

  // 首个输入作为 target 起点
  resultSolid = inputSolids[0]!
  roleTable = getSlot(inputs[0])?.roleTable as ReadonlyMap<unknown, unknown> | undefined

  for (let i = 1; i < inputSolids.length; i++) {
    const prev = resultSolid
    const prevTable = roleTable
    const toolTable = getSlot(inputs[i])?.roleTable as ReadonlyMap<unknown, unknown> | undefined
    const outPart = String(getCurrentStmt()?.outputs[0] ?? '')

    // §3.4：一次内核调用，A/B 拆流各自传播后合表（缝面以本次语句 LHS 为新 origin）
    const r = booleanWithRoleTable(
      kernel,
      op,
      prev,
      inputSolids[i]!,
      prevTable ?? new Map(),
      toolTable ?? new Map(),
      outPart,
    )
    resultSolid = r.result
    lastEvolution = r.faceEvolution
    roleTable = r.roleTable
    if (i > 1) kernel.release(prev)
  }

  return fromBrep(
    solidToShape(kernel, resultSolid),
    lastEvolution ? { solid: resultSolid, faceEvolution: lastEvolution, roleTable } : { solid: resultSolid, roleTable },
  )
}

/** mesh 路径：manifold-3d mesh-CSG。 */
async function booleanMesh(inputs: Shape[], operation: BooleanOperation): Promise<Shape> {
  if (inputs.length < 2) {
    if (inputs.length === 1) return inputs[0]
    throw new Error('[stdlib/boolean] boolean needs at least 1 input')
  }
  if (operation === 'union') return cad.union(inputs[0], inputs[1], ...inputs.slice(2))
  if (operation === 'subtract') {
    let result = await cad.subtract(inputs[0], inputs[1])
    for (let i = 2; i < inputs.length; i++) result = await cad.subtract(result, inputs[i])
    return result
  }
  let result = await cad.intersect(inputs[0], inputs[1])
  for (let i = 2; i < inputs.length; i++) result = await cad.intersect(result, inputs[i])
  return result
}

// ── 三个薄导出（多输入 variadic，defineOp 声明双路径 + evolution 能力） ──
// 函数体 keep 声明（keep-syntax 设计 §2.5）：union/subtract/intersect 保留其
// 输入且隐藏（R5：3d_editor 现状）——keepHidden 使源变量保持终端但 canvas
// 不渲染，只有布尔结果正常显示。混合/断链时刻：BREP 侧输入先归约为合法
// 2-manifold 网格（reconcileBrepInputs），mesh 侧原样透传。

/**
 * 布尔并集：合并所有输入几何（≥2 个输入）。
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name union
 * @param shapes - 参与运算的几何（变量引用，≥2 个）。type:Shape[] required:true
 * @returns Shape 所有输入的并集。函数名即操作，输入全是变量引用，可用 `cad.union(a, b, c)` 多输入。
 * @example
 * const a = await cad.union(part0, part1)
  */
export const union = defineOp({
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMesh(reconcileBrepInputs(shapes), 'union')
  },
  brep: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanBrep(shapes, 'union')
  },
  capabilities: ['evolution'],
  schema: { shapes: 'Shape*' },
})

/**
 * 布尔差集：第一个为主体，减去其余输入。
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name subtract
 * @param shapes - 参与运算的几何（变量引用，第一个为主体）。type:Shape[] required:true
 * @returns Shape part0 减 part1 的差集（第一个为主体）。
 * @example
 * const b = await cad.subtract(part0, part1)
  */
export const subtract = defineOp({
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMesh(reconcileBrepInputs(shapes), 'subtract')
  },
  brep: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanBrep(shapes, 'subtract')
  },
  capabilities: ['evolution'],
})

/**
 * 布尔交集：所有输入的重叠部分。
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name intersect
 * @param shapes - 参与运算的几何（变量引用）。type:Shape[] required:true
 * @returns Shape 所有输入的交集。
 * @example
 * const c = await cad.intersect(part0, part1)
  */
export const intersect = defineOp({
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMesh(reconcileBrepInputs(shapes), 'intersect')
  },
  brep: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanBrep(shapes, 'intersect')
  },
  capabilities: ['evolution'],
})
