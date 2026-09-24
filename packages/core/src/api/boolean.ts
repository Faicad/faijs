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
import { getCurrentStmt, keepHidden, nameOf } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, brepOf, inputRoleTable } from '../shape'
import { reconcileBrepInputs } from './reconcile'
import { OpError } from './internal/result-unwrap'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import type { BrepHandle } from '../brep/engine/types'

type BooleanOperation = 'union' | 'subtract' | 'intersect'

// ── 共享内部实现 ──

/** BREP 路径：fuse/cut/common（*WithHistory 封装，收集面演化 + roleTable 合流 §3.4）。 */
function booleanBrep(inputs: Shape[], operation: BooleanOperation): Shape {
  const kernel = getBrepApi()

  const inputSolids = inputs.map((s) => brepOf(s) as BrepHandle | undefined)
  if (inputSolids.some((s) => !s)) {
    // V-C8 (C6): a non-solid import (wire/face/shell via cad.import_brep) has
    // no OCCT handle yet — booleans must fail HERE with an explicit, op-named
    // error, not with OCCT's raw "boolean operation failed" (or silently).
    const offenders = inputs
      .map((s, i) => (inputSolids[i] ? undefined : nameOf(s) ?? `input[${i}]`))
      .filter((x): x is string => x !== undefined)
    throw new OpError(
      `boolean/${operation}`,
      'E_BREP_UNSUPPORTED',
      `[stdlib/boolean] ${operation}: input is not on the BREP chain (no OCCT handle) — ` +
      `non-solid geometry (wire/face/shell) cannot take part in a boolean. offenders: ${offenders.join(', ')}`,
    )
  }

  let resultSolid: BrepHandle
  let lastEvolution: Map<number, number[]> | undefined
  let roleTable: ReadonlyMap<unknown, unknown> | undefined

  // 链式布尔：每步 target（累积结果）与下一个 tool 合流
  const op: 'fuse' | 'cut' | 'intersect' =
    operation === 'union' ? 'fuse' : operation === 'subtract' ? 'cut' : 'intersect'

  // 首个输入作为 target 起点
  resultSolid = inputSolids[0]!
  roleTable = inputRoleTable(inputs[0]) as ReadonlyMap<unknown, unknown> | undefined

  for (let i = 1; i < inputSolids.length; i++) {
    const prev = resultSolid
    const prevTable = roleTable
    const toolTable = inputRoleTable(inputs[i]) as ReadonlyMap<unknown, unknown> | undefined
    // Phase 1.6：新 origin = 本次语句的 StmtId（不再是 LHS 变量名——PartName 会被
    // 改名/复用，StmtId 全局唯一）。
    const outStmt = String(getCurrentStmt()?.id ?? '')

    // §3.4：一次内核调用，A/B 拆流各自传播后合表（缝面 origin=本次语句 StmtId）
    // V-C8：内核裸错误（如 "boolean operation failed"）在此包一层——带上 op 名、
    // 两个输入的变量名与 cause，满足「显式暴露、不吞细节」。
    let r: ReturnType<typeof booleanWithRoleTable>
    try {
      r = booleanWithRoleTable(
        kernel,
        op,
        prev,
        inputSolids[i]!,
        prevTable ?? new Map(),
        toolTable ?? new Map(),
        outStmt,
      )
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause)
      throw new OpError(
        `boolean/${operation}`,
        'E_OP_FAILED',
        `[stdlib/boolean] ${operation}: kernel ${op} failed for inputs ` +
        `${nameOf(inputs[0]!) ?? 'input[0]'} × ${nameOf(inputs[i]!) ?? `input[${i}]`} — ${msg}`,
        { cause },
      )
    }
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

// ── 三个薄导出（多输入 variadic，defineOp 声明双路径 + 逐核函数 face-evolution 能力） ──
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
  // 逐核函数声明（Phase 0.2）：union 需要内核的 fuseWithHistory。
  // 不再声明族级 'evolution'——族级名会让 brepkit（无 intersectWithHistory）等
  // 部分实现的内核静默通过静态判定，再死在运行时（红线违规）。
  capabilities: ['fuseWithHistory'],
  schema: { shapes: 'Shape*' },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})

/**
 * Boolean cut (subtract): remove `tool` from `base`. Same semantics as
 * {@link subtract} but with the brepjs-compatible `(base, tool, options?)` signature.
 * Overrides the generated projection (compatOp) to do roleTable propagation
 * (Phase 3: L2 requires wall:<i> to survive cut).
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name cut
 * @param base - the target shape. type:Shape required:true
 * @param tool - the shape to subtract. type:Shape required:true
 * @returns Shape base minus tool.
 * @example
 * const b = await cad.cut(part0, part1)
  */
export const cut = defineOp({
  mesh: (base: Shape, tool: Shape) => {
    keepHidden(base, tool)
    return booleanMesh(reconcileBrepInputs([base, tool]), 'subtract')
  },
  brep: (base: Shape, tool: Shape) => {
    keepHidden(base, tool)
    return booleanBrep([base, tool], 'subtract')
  },
  capabilities: ['cutWithHistory'],
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
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
  // 逐核函数声明（Phase 0.2）：subtract 需要内核的 cutWithHistory。
  capabilities: ['cutWithHistory'],
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
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
  // 逐核函数声明（Phase 0.2）：intersect 需要内核的 intersectWithHistory。
  // ⚠️ 这正是族级布尔 `'evolution'` 会多报能力的活例：brepkit 声明过
  // `evolution: true` 但**没有** intersectWithHistory → 旧声明下 intersect
  // 通过静态判定、死在运行时；现在 brepkit 下静态报 lacks capability 'intersectWithHistory'。
  capabilities: ['intersectWithHistory'],
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
