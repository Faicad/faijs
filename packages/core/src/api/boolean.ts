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
import { getCurrentStmt, getBackends, keepHidden, nameOf } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, brepOf, hasMeshSolid, inputRoleTable } from '../shape'
import { reconcileBrepInputs } from './reconcile'
import { OpError } from './internal/result-unwrap'
import { meshKernelFailure, meshSolidEntry, meshSolidProduct } from './internal/mesh-solid-op'
import { defineOp } from '../sdk'
import { engineCapabilitySet } from '../cad-runtime/backend-dispatch'
import type { Provenance } from '../topology/naming/lineage'
import type { BrepHandle } from '../brep/engine/types'

type BooleanOperation = 'union' | 'subtract' | 'intersect'

// ── 共享内部实现 ──

/**
 * BREP 路径：fuse/cut/intersect。
 *
 * 静态双轨（无运行时 try-catch 回退——按引擎**声明**的能力集在执行前定轨）：
 * - 引擎声明了对应 `*WithHistory`（occt 三员全有）→ `booleanWithRoleTable`：
 *   一次内核调用同时产出结果 + 面演化（faceEvolution）+ roleTable 合流（§3.4）。
 * - 引擎只声明了裸布尔方法（brepkit：声明了 `intersect` 但**没有** `intersectWithHistory`）
 *   → 走 L1 裸 `kernel[op](a,b)`：几何正确，但**不产生面演化、不传播 roleTable**。
 *   这是如实降级——绝不用「恒等映射」伪造一张把输入面 hash 指到结果面 hash 的演化表
 *   （结果实体的面 hash 与输入根本不同，恒等映射是假身份）。
 *
 * `intersect` 因此不再声明 `capabilities: ['intersectWithHistory']`（中立 op）：
 * brepkit 上由本函数静态落到裸 `intersect`；occt 上仍走 `intersectWithHistory`。
 * fuse/cut 保留各自 `*WithHistory` 能力声明——dispatchPath 的 gate 保证它们到达本函数时
 * 引擎必已声明对应历史方法，故下方 `useHistory` 对 fuse/cut 恒为 true。
 */
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

  // 静态定轨：当前引擎是否声明了本 op 的面演化核函数（读的是同一声明源 dispatchPath 用的
  // 能力集，不是运行时探测）。fuse/cut 因 gate 保证此处恒 true；intersect 在 occt true、
  // brepkit/mock false（后者走 L1 裸 `kernel[op]`，该方法是 BrepEngineApi 必需成员，必存在）。
  const historyCap = op === 'fuse' ? 'fuseWithHistory' : op === 'cut' ? 'cutWithHistory' : 'intersectWithHistory'
  const useHistory = engineCapabilitySet(getBackends().config.brepCapabilities).has(historyCap)

  // 首个输入作为 target 起点
  resultSolid = inputSolids[0]!
  roleTable = useHistory
    ? (inputRoleTable(inputs[0]) as ReadonlyMap<unknown, unknown> | undefined)
    : undefined

  for (let i = 1; i < inputSolids.length; i++) {
    const prev = resultSolid
    const tool = inputSolids[i]!

    if (useHistory) {
      // §3.4：一次内核调用，A/B 拆流各自传播后合表（缝面 origin=本次语句 StmtId）
      // V-C8：内核裸错误在此包一层——带上 op 名、两个输入的变量名与 cause。
      const prevTable = roleTable
      const toolTable = inputRoleTable(inputs[i]) as ReadonlyMap<unknown, unknown> | undefined
      // Phase 1.6：新 origin = 本次语句的 StmtId。
      const outStmt = String(getCurrentStmt()?.id ?? '')
      let r: ReturnType<typeof booleanWithRoleTable>
      try {
        r = booleanWithRoleTable(
          kernel,
          op,
          prev,
          tool,
          prevTable ?? new Map(),
          toolTable ?? new Map(),
          outStmt,
        )
      } catch (cause) {
        // GOTCHA: OCCT 的 *WithHistory 在两输入共享子结构/历史（如布尔产物的布尔）
        // 时可能 "operation failed"，而同一几何的裸布尔可以成功。降级重试一次裸
        // kernel[op]：几何结果正确，代价是丢本次面演化/roleTable（如实降级，同下方
        // 裸路径语义）。裸布尔也失败时，再试 unifySameDomain(两输入) 后重算——
        // 真实语料（disk-drive）中 tool 是布尔产物且与 target 共享子域，裸 cut 仍失败、
        // unify 后成功。全部失败才真正抛错。
        try {
          resultSolid = kernel[op](prev, tool)
          lastEvolution = undefined
          roleTable = undefined
          if (i > 1) kernel.release(prev)
          continue
        } catch {
          try {
            const uPrev = kernel.unifySameDomain(prev)
            const uTool = kernel.unifySameDomain(tool)
            resultSolid = kernel[op](uPrev, uTool)
            kernel.release(uPrev)
            kernel.release(uTool)
            lastEvolution = undefined
            roleTable = undefined
            if (i > 1) kernel.release(prev)
            continue
          } catch {
            const msg = cause instanceof Error ? cause.message : String(cause)
            throw new OpError(
              `boolean/${operation}`,
              'E_OP_FAILED',
              `[stdlib/boolean] ${operation}: kernel ${op} failed for inputs ` +
              `${nameOf(inputs[0]!) ?? 'input[0]'} × ${nameOf(inputs[i]!) ?? `input[${i}]`} — ${msg}`,
              { cause },
            )
          }
        }
      }
      resultSolid = r.result
      lastEvolution = r.faceEvolution
      roleTable = r.roleTable
    } else {
      // 裸布尔降级路径：几何正确，但无面演化、无 roleTable 传播（如实降级，不伪造映射）。
      try {
        resultSolid = kernel[op](prev, tool)
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
      lastEvolution = undefined
      roleTable = undefined
    }
    if (i > 1) kernel.release(prev)
  }

  return fromBrep(
    solidToShape(kernel, resultSolid),
    lastEvolution ? { solid: resultSolid, faceEvolution: lastEvolution, roleTable } : { solid: resultSolid, roleTable },
  )
}

/**
 * 网格实体路径：brepkit 网格内核的布尔（方案 2026-10-01 §3.5 三明治）。
 *
 * 输入**全部**是网格实体——这一点由 `dispatchPath` 的链门禁保证
 * （`E_MESH_SOLID_MIXED`：网格实体不得与链外几何同处一次调用），此处只复核不补救。
 *
 * 无面演化、无 roleTable：近似拓扑没有 hash 演化，造一张恒等映射就是假身份
 * （与 brepkit 裸布尔降级同一条纪律）。
 *
 * 中间结果是本实现自己造的句柄（不是任何输入），故 i>1 步及时释放；**输入句柄一概
 * 不释放**——生命周期归链（与 BREP 路径 booleanBrep 的 `if (i > 1) kernel.release(prev)`
 * 同构）。
 *
 * @param inputs - the mesh-solid inputs (≥1).
 * @param operation - union / subtract / intersect.
 * @returns the boolean result as a new mesh part.
 */
function booleanMeshSolid(inputs: Shape[], operation: BooleanOperation): Shape {
  const opLabel = `boolean/${operation}`
  const entries = inputs.map((s) => meshSolidEntry(s, opLabel))
  const first = entries[0]!
  const kernel = first.kernel
  const op: 'fuse' | 'cut' | 'intersect' =
    operation === 'union' ? 'fuse' : operation === 'subtract' ? 'cut' : 'intersect'

  let result = first.solid
  for (let i = 1; i < entries.length; i++) {
    const prev = result
    try {
      result = kernel[op](prev, entries[i]!.solid)
    } catch (cause) {
      throw meshKernelFailure(
        opLabel,
        'E_OP_FAILED',
        `${op}(${nameOf(inputs[0]!) ?? 'input[0]'} × ${nameOf(inputs[i]!) ?? `input[${i}]`})`,
        cause,
      )
    }
    // i>1：prev 是本实现上一步造出的中间实体，释放它（i=1 时 prev 是**输入**，不碰）。
    if (i > 1) first.backend.release(prev)
  }
  return meshSolidProduct(first, result)
}

/**
 * 网格路径分流（方案 2026-10-01 §3.4 规则 4）：输入含网格实体 → brepkit 网格内核；
 * 否则保持历史上限（内置 `mesh/` 的 manifold CSG）。两条路**互不冒充**——
 * manifold 不认识网格实体（静态门禁），网格内核也不接受裸网格（无句柄）。
 *
 * @param inputs - the geometry inputs.
 * @param operation - union / subtract / intersect.
 * @returns the boolean product (mesh solid or manifold mesh shape).
 */
function booleanMeshPath(inputs: Shape[], operation: BooleanOperation): Shape | Promise<Shape> {
  if (inputs.some(hasMeshSolid)) return booleanMeshSolid(inputs, operation)
  return booleanMesh(inputs, operation)
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
  meshEngines: ['brepkit'],
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMeshPath(reconcileBrepInputs(shapes), 'union')
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
  meshEngines: ['brepkit'],
  mesh: (base: Shape, tool: Shape) => {
    keepHidden(base, tool)
    return booleanMeshPath(reconcileBrepInputs([base, tool]), 'subtract')
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
  meshEngines: ['brepkit'],
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMeshPath(reconcileBrepInputs(shapes), 'subtract')
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
  meshEngines: ['brepkit'],
  mesh: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanMeshPath(reconcileBrepInputs(shapes), 'intersect')
  },
  brep: (...shapes: Shape[]) => {
    if (shapes.length > 0) keepHidden(...shapes)
    return booleanBrep(shapes, 'intersect')
  },
  // 不声明 `capabilities: ['intersectWithHistory']`（中立 op）：
  // brepkit 声明了裸 `intersect` 但没有 `intersectWithHistory`——若硬声明历史能力，
  // brepkit brep 模式会在执行前静态报 `lacks capability 'intersectWithHistory'`。
  // 现由 booleanBrep 按引擎声明的能力集静态分派：occt（声明 intersectWithHistory）
  // 走历史路径保留面演化/naming；brepkit（只声明裸 intersect）走 L1 裸 `kernel.intersect`，
  // 几何正确但无面演化（如实降级，不伪造恒等映射）。
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
