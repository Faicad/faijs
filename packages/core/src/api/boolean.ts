/**
 * api boolean — 布尔库函数（union/subtract/intersect，多输入）
 *
 *
 * dispatchPath 静态判定 brep/mesh，BREP 路径用 *WithHistory 收集面演化。
 *
 * 阶段 1：拆为三个薄函数 union/subtract/intersect + 兼容 boolean 导出（过渡）。
 * 阶段 3 将删除 boolean 兼容导出。
 */

import type { Shape } from '../mesh/types'
// B3 correction (2026-10-06): no library-face cad aggregate — import the impl from its own module.
import * as meshBoolean from '../mesh/boolean'
import { solidToShape } from '../brep/brep-ops'
import {
  booleanWithRoleTable,
} from '../brep/face-evolution'
import { getCurrentStmt, getChainPreference, getBackends, nameOf, reportRuntimeNotice } from '../runtime-state'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep, brepOf, hasMeshSolid, inputRoleTable } from '../shape'
import { reconcileBrepInputs } from './reconcile'
import { OpError } from './internal/result-unwrap'
import { meshSolidEntry, meshSolidProduct, meshKernelFailure } from './internal/mesh-solid-op'
import type { MeshSolidBackend } from '../brep/mesh-solid'
import { defineOp } from '../sdk'
import { hasNativeHistory } from '../brep/engine/native-history'
import type { Provenance } from '../topology/naming/lineage'
import type { BrepEvolutionKind, BrepHandle } from '../brep/engine/types'

type BooleanOperation = 'union' | 'subtract' | 'intersect'

// ── OpenSCAD 语义：操作数网格闭合性校验（方案 2026-10-28 v2）───────────────────
//
// 开关、判据与空实体构造都在 `./internal/boolean-closure`（`api/boolean-op` 的
// `cad.boolean` 也复用同一套语义）。要点：
// - 只校验**带 AUTHORED_LEAF 标记的叶子网格**（CGAL 的 PolySet→Nef 校验边界，
//   Nef→Nef 不校验）；对所有操作数一律校验会把 issue591 group B 误丢、整树变空；
// - 判据是网格**无向边使用次数**，不是 BREP shapeType（后者对 4 例完全空转）。
import {
  setBooleanOperandValidation,
  getBooleanOperandValidation,
  isClosedOperandForBooleanOp,
  emptyBrepShape as emptySolid,
  debugOperand,
} from './internal/boolean-closure'
// 贴面减除防护（2026-11-03 L3 默认自动规避共面）：cut 前检测 tool 与 base 共面，
// 自动外扩 ε 薄壳，把「面贴面」改成「明确越出/侵入」——内核不再处理共面退化。
import { coincidentCutProtect, COINCIDENT_EPS } from './internal/coincident-cut'

export { setBooleanOperandValidation }

// ── 共享内部实现 ──

/**
 * BREP 路径：fuse/cut/intersect。
 *
 * 静态双轨（无运行时 try-catch 回退——按引擎事实在执行前定轨）：
 * - 引擎原生有对应 `*WithHistory`（occt 三员全有）→ `booleanWithRoleTable`：
 *   一次内核调用同时产出结果 + 面演化（faceEvolution）+ roleTable 合流（§3.4）。
 * - 引擎只有裸布尔方法（brepkit：有 `intersect` 但**没有** `intersectWithHistory`）
 *   → 走 L1 裸 `kernel[op](a,b)`：几何正确，但**不产生面演化、不传播 roleTable**。
 *   这是如实降级——绝不用「恒等映射」伪造一张把输入面 hash 指到结果面 hash 的演化表
 *   （结果实体的面 hash 与输入根本不同，恒等映射是假身份）。
 *
 * 定轨只读引擎事实 `hasNativeHistory`（`brep/engine/native-history.ts`），op 侧不声明能力。
 */
function booleanBrep(inputs: Shape[], operation: BooleanOperation): Shape {
  const kernel = getBrepApi()

  const inputSolids = inputs.map((s) => brepOf(s) as BrepHandle | undefined)
  // 句柄判空必须用 undefined 比较而非 truthiness：BrepHandle 是 number，
  // brepkit 从 0 开始分配句柄——`!0 === true` 会把合法句柄 0 误判为无句柄
  // （用户场景「box 句柄 0 + union/subtract」稳定误报 E_BREP_UNSUPPORTED）。
  if (inputSolids.some((s) => s === undefined)) {
    // V-C8 (C6): a non-solid import (wire/face/shell via cad.import_brep) has
    // no OCCT handle yet — booleans must fail HERE with an explicit, op-named
    // error, not with OCCT's raw "boolean operation failed" (or silently).
    const offenders = inputs
      .map((s, i) => (inputSolids[i] === undefined ? nameOf(s) ?? `input[${i}]` : undefined))
      .filter((x): x is string => x !== undefined)
    throw new OpError(
      `boolean/${operation}`,
      'E_BREP_UNSUPPORTED',
      `[api/boolean] ${operation}: input is not on the BREP chain (no OCCT handle) — ` +
      `non-solid geometry (wire/face/shell) cannot take part in a boolean. offenders: ${offenders.join(', ')}`,
    )
  }

  let resultSolid: BrepHandle
  let lastEvolution: Map<number, number[]> | undefined
  let roleTable: ReadonlyMap<unknown, unknown> | undefined

  // 链式布尔：每步 target（累积结果）与下一个 tool 合流
  const op: 'fuse' | 'cut' | 'intersect' =
    operation === 'union' ? 'fuse' : operation === 'subtract' ? 'cut' : 'intersect'

  // F 组（2026-10-03，FAULHABER/Beam-coupling 语料）：import_brep 资产可能是
  // wire/face（ShapeBinder 冻结几何）——它们带 OCCT handle、能通过上面的
  // 「无 handle」守卫，但 OCCT 的 BOP 只接受 solid：fuse(wire, solid) 直接
  // "operation failed"（内核直测实证，PartShape5/PartShape6/PartShape93 均
  // wire/face、vol=0）。C3c-1 已实证 0 体积线框成员对 compound invariants
  // 零影响 ⇒ union 的语义是 solid 合流，非 solid 输入如实跳过；全非 solid 才抛错。
  // cut/intersect 语义不变（工具/交域必须 solid）。
  // OpenSCAD 闭合性校验（默认关，仅 OpenSCAD 翻译文件开启）：非闭合的**叶子**操作数
  // 按 OpenSCAD 规则丢弃——union 丢坏操作数、difference 的 base 被丢⇒空、
  // intersection 任一被丢⇒空。判定见 `isClosedOperand`。
  const validate = getBooleanOperandValidation()
  const closed = validate
    ? inputSolids.map((h, i) => {
        const r = isClosedOperandForBooleanOp(kernel, h, inputs[i]!)
        if (process.env.BOOL_DEBUG) debugOperand(operation, i, r)
        return r.closed
      })
    : null
  const NON_SOLID = new Set(['wire', 'face', 'shell', 'vertex', 'edge'])
  const inputTypes = inputSolids.map((h) => {
    try { return h ? (kernel.shapeType(h) as string) : 'solid' } catch { return 'solid' }
  })

  let boolIdx: number[]
  if (validate && closed) {
    if (operation === 'union') {
      // OpenSCAD：丢坏操作数，其余照常；全被丢 ⇒ 空实体。
      boolIdx = closed.map((c, i) => (c ? i : -1)).filter((i) => i >= 0)
      if (boolIdx.length === 0) {
        return emptySolid(kernel)
      }
    } else if (operation === 'subtract') {
      // OpenSCAD：base 被丢 ⇒ 整树为空；tool 被丢 ⇒ 跳过该 tool。
      if (!closed[0]) {
        return emptySolid(kernel)
      }
      const tools = inputs.map((_, i) => i).slice(1).filter((i) => closed[i])
      if (tools.length === 0) {
        return inputs[0]!
      }
      boolIdx = [0, ...tools]
    } else {
      // OpenSCAD：intersection 任一被丢 ⇒ 空。
      if (closed.some((c) => !c)) {
        return emptySolid(kernel)
      }
      boolIdx = inputs.map((_, i) => i)
    }
  } else {
    // compound/compsolid 可能含 solid，是合法 fuse 输入——只跳过确定的非 solid 类型。
    boolIdx = operation === 'union'
      ? inputTypes.map((t, i) => (NON_SOLID.has(t) ? -1 : i)).filter((i) => i >= 0)
      : inputs.map((_, i) => i)
    if (operation === 'union' && boolIdx.length === 0) {
      throw new OpError(
        `boolean/${operation}`,
        'E_BREP_UNSUPPORTED',
        `[api/boolean] ${operation}: no solid input — wire/face/shell geometry cannot fuse (types: ${inputTypes.join(', ')})`,
      )
    }
  }

  // 静态定轨：当前引擎是否原生实现本 op 的面演化核函数（引擎事实，非运行时探测）。
  // fuse/cut 的 brep 实现调 `*WithHistory`，在只提供裸布尔的引擎上走不了历史轨——
  // 该分叉由 hasNativeHistory 回答，op 侧不声明任何能力。
  const historyCap: BrepEvolutionKind = op === 'fuse' ? 'fuseWithHistory' : op === 'cut' ? 'cutWithHistory' : 'intersectWithHistory'
  const useHistory = hasNativeHistory(historyCap)

  // 首个 solid 输入作为 target 起点（F 组：可能不是 inputs[0] —— wire/face
  // 资产常排在前面作为 profile/binder）。
  resultSolid = inputSolids[boolIdx[0]!]!
  roleTable = useHistory
    ? (inputRoleTable(inputs[boolIdx[0]!]) as ReadonlyMap<unknown, unknown> | undefined)
    : undefined

  for (let bi = 1; bi < boolIdx.length; bi++) {
    const i = boolIdx[bi]!
    const prev = resultSolid
    const tool = inputSolids[i]!

    // 贴面减除防护（2026-11-03 L3 默认自动规避共面）：仅 cut 生效。
    // 检测到 tool 与 base 共面（零体积相交风险）时自动外扩 ε 薄壳，把「面贴面」
    // 改成「明确越出/侵入」；正常侵入式减除零命中，行为逐位不变。
    let guardedTool: BrepHandle | undefined
    if (op === 'cut') {
      guardedTool = coincidentCutProtect(kernel, prev, tool, COINCIDENT_EPS)
      if (guardedTool !== undefined) {
        const stmtId = getCurrentStmt()?.id ?? ''
        reportRuntimeNotice(
          `[faijs] coincident-cut guard: ${operation} 检测到 tool 与 base 共面` +
          `（零体积相交风险），已自动外扩 ${COINCIDENT_EPS}mm` +
          (stmtId !== '' ? `（语句 #${stmtId}）` : ''),
        )
      }
    }

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
          guardedTool ?? tool,
          prevTable ?? new Map(),
          guardedTool !== undefined ? new Map() : (toolTable ?? new Map()),
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
          resultSolid = kernel[op](prev, guardedTool ?? tool)
          lastEvolution = undefined
          roleTable = undefined
          if (i > 1) kernel.release(prev)
          continue
        } catch {
          try {
            const uPrev = kernel.unifySameDomain(prev)
            const uTool = kernel.unifySameDomain(guardedTool ?? tool)
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
              `[api/boolean] ${operation}: kernel ${op} failed for inputs ` +
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
      //
      // ── cut × 多 solid compound 工具特例（2026-10-28 用户拍板，只此一例）─────────
      // 多字符 `cad.text` 返回 compound（虚拟容器，smlibKernel makeCompound），而
      // smlib 等裸内核的 cut 只吃 solid 句柄 —— 整块送 cut 直接炸（端侧探针实证：
      // "a.get(...) is not a function"）。先把工具成员 fuseAll 成整体、再切一次。
      // 边界（用户明示）：① 只针对 cut —— union / intersect 不做（凸出雕刻不发布尔，
      // 不存在这个场景）；② 只走裸路径 —— occt 恒走上方 history 路径且原生吃
      // compound，一个字节都不动；③ 非 compound / 单 solid 工具原样传递，行为零变化。
      let effectiveTool = guardedTool ?? tool
      let fusedTool: BrepHandle | undefined
      if (op === 'cut') {
        try {
          const subs = kernel.getSubShapes(tool, 'solid') as BrepHandle[]
          if (subs.length > 1) {
            fusedTool = kernel.fuseAll(subs)
            for (const s of subs) {
              try { kernel.release(s) } catch { /* 已释放 */ }
            }
            effectiveTool = fusedTool
          }
        } catch { /* 非 compound（或无 getSubShapes）：原句柄照常走 */ }
      }
      try {
        resultSolid = kernel[op](prev, effectiveTool)
      } catch (cause) {
        if (fusedTool !== undefined) {
          try { kernel.release(fusedTool) } catch { /* 已释放 */ }
        }
        const msg = cause instanceof Error ? cause.message : String(cause)
        throw new OpError(
          `boolean/${operation}`,
          'E_OP_FAILED',
          `[api/boolean] ${operation}: kernel ${op} failed for inputs ` +
          `${nameOf(inputs[0]!) ?? 'input[0]'} × ${nameOf(inputs[i]!) ?? `input[${i}]`} — ${msg}`,
          { cause },
        )
      }
      // fusedTool 是本实现造的中间句柄：cut 消费后及时释放（输入句柄照旧不碰）。
      if (fusedTool !== undefined) {
        try { kernel.release(fusedTool) } catch { /* 已释放 */ }
      }
      lastEvolution = undefined
      roleTable = undefined
    }
    if (i > 1) kernel.release(prev)
    // guardedTool 是本实现造的中间句柄（fuse 薄壳产物）：布尔消费后释放（输入不碰）。
    if (guardedTool !== undefined) {
      try { kernel.release(guardedTool) } catch { /* 已释放 */ }
    }
  }

  return fromBrep(
    solidToShape(kernel, resultSolid),
    lastEvolution ? { solid: resultSolid, faceEvolution: lastEvolution, roleTable } : { solid: resultSolid, roleTable },
  )
}

/**
 * 网格实体路径：brepkit 网格内核的布尔（方案 2026-10-01 §3.5 三明治；2026-10-22 修正引擎）。
 *
 * 输入**全部**是网格实体（由 `dispatchPath` 的链门禁保证），或由强制 mesh 链
 * （`cad.useMeshChain` / host mode='mesh'）带来的携带三角载荷的归约输入——
 * 两种情形都先经 `meshSolidEntry` 规范化成网格实体（importMesh→weld→unify，
 * 显示 mesh == 拓扑 mesh 真源，规则 1）。
 *
 * **引擎选择（2026-10-22 实测定论）**：布尔步走内核 `kernel.fuse/cut`（face-BOP，
 * 解析 GFA，吃规范化后的网格实体），**不走 `backend.meshBoolean`（三角形 CSG）**。
 * 原因：`meshBoolean` 在近切触（near-tangent）接触上输出**真实开洞**（探针实测
 * 人脸链 union 到瞳孔步 boundary=546 条自由边、跨全部容差 1e-7..1e-3 与全部输入
 * 密度/顺序均不可愈合，normalize 全容差 isValid=false → E_MESH_SOLID_UNWELDABLE）；
 * 人脸这类模型（眼球贴合头部、瞳孔浅出眼球）天然充满近切触。face-BOP 全程
 * isValid=true（实测全链 8 步 ~17s node，BRep 链 ~31s；探针见
 * `test/perf/mesh-chain-normalize-diagnostic.test.ts`）。`meshBoolean` 作为内核
 * 直通保留在 `MeshSolidBackend` 接口上（诊断探针用；若上游修复 CSG 水密性可切回）。
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
 * 网格路径分流（方案 2026-10-01 §3.4 规则 4 + 2026-10-22 脚本链偏好）：
 * - 输入含网格实体 → brepkit 网格内核（face-BOP 链）；
 * - 输入无网格实体、但脚本/host 强制 mesh 链（`cad.useMeshChain(true)` /
 *   `mode='mesh'`）→ 也走网格实体链：BREP/归约输入的三角载荷经 `meshSolidEntry`
 *   规范化后直接 face-BOP（不冒充 manifold CSG——端侧根本没有 manifold）；
 * - 否则保持历史上限（内置 `mesh/` 的 manifold CSG）。两条路**互不冒充**。
 *
 * @param inputs - the geometry inputs.
 * @param operation - union / subtract / intersect.
 * @returns the boolean product (mesh solid or manifold mesh shape).
 */
function booleanMeshPath(inputs: Shape[], operation: BooleanOperation): Shape | Promise<Shape> {
  const forcedMesh = getChainPreference() === 'mesh' || getBackends().config.mode === 'mesh'
  // 网格后端装配事实（执行前已定，非运行时探测）：mesh 模式**没有**装配网格内核的
  // 宿主（web/manifold 历史行为——没有实体句柄、没有近似拓扑）继续走 manifold CSG；
  // 输入里已有网格实体、或强制 mesh 链且装配了网格内核 → face-BOP 网格实体链。
  // 两者互不冒充：装配事实决定产物形态（与 meshSolidPrimitive 同一条口径）。
  const meshBackend = getBackends().kernel.meshSolid as MeshSolidBackend | undefined
  if ((inputs.some(hasMeshSolid) || (forcedMesh && meshBackend !== undefined)) && meshBackend !== undefined) {
    if (inputs.length < 2) return inputs[0]!
    return booleanMeshSolid(inputs, operation)
  }
  return booleanMesh(inputs, operation)
}

/** mesh 路径：manifold-3d mesh-CSG。 */
async function booleanMesh(inputs: Shape[], operation: BooleanOperation): Promise<Shape> {
  if (inputs.length < 2) {
    if (inputs.length === 1) return inputs[0]
    throw new Error('[api/boolean] boolean needs at least 1 input')
  }
  if (operation === 'union') return meshBoolean.union(inputs[0], inputs[1], ...inputs.slice(2))
  if (operation === 'subtract') {
    let result = await meshBoolean.subtract(inputs[0], inputs[1])
    for (let i = 2; i < inputs.length; i++) result = await meshBoolean.subtract(result, inputs[i])
    return result
  }
  let result = await meshBoolean.intersect(inputs[0], inputs[1])
  for (let i = 2; i < inputs.length; i++) result = await meshBoolean.intersect(result, inputs[i])
  return result
}

// ── 三个薄导出（多输入 variadic，defineOp 声明双路径；面演化进路由引擎事实 ──
// ── `hasNativeHistory` 定，op 不声明、不查表——见下方各 op 的分叉注释） ──
// 布尔 op **消费其输入**（无函数体 keep 声明）：结果取代输入成为活终端，
// 输入变量从 terminals 中消失。要留下某个输入，脚本里显式声明 `a.keep()`。
// 混合/断链时刻：BREP 侧输入先归约为合法 2-manifold 网格（reconcileBrepInputs），
// mesh 侧原样透传。

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
 * const a = cad.union(part0, part1)
  */
export const union = defineOp({
  meshEngines: ['brepkit'],
  mesh: (...shapes: Shape[]) => booleanMeshPath(reconcileBrepInputs(shapes), 'union'),
  brep: (...shapes: Shape[]) => booleanBrep(shapes, 'union'),
  schema: { shapes: 'Shape*' },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,

  paramDims: { shapes: 'plain' },
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
 * const b = cad.subtract(part0, part1)
  */
export const subtract = defineOp({
  meshEngines: ['brepkit'],
  mesh: (...shapes: Shape[]) => booleanMeshPath(reconcileBrepInputs(shapes), 'subtract'),
  brep: (...shapes: Shape[]) => booleanBrep(shapes, 'subtract'),
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,

  paramDims: { shapes: 'plain' },
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
 * const c = cad.intersect(part0, part1)
  */
export const intersect = defineOp({
  meshEngines: ['brepkit'],
  mesh: (...shapes: Shape[]) => booleanMeshPath(reconcileBrepInputs(shapes), 'intersect'),
  brep: (...shapes: Shape[]) => booleanBrep(shapes, 'intersect'),
  // intersect 不声明任何能力：brepkit 只有裸 `intersect`（无 `intersectWithHistory`），
  // 由 booleanBrep 按引擎事实静态分派——occt 走历史路径保留面演化/naming；
  // brepkit 走 L1 裸 `kernel.intersect`，几何正确但无面演化（如实降级，不伪造恒等映射）。
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,

  paramDims: { shapes: 'plain' },
})

// ── 兼容别名（同一函数对象，不是第二份实现） ──
// brepjs 生态用 `cut(base, tool)` / `fuse(a, b)` 这两个名字；faijs 自己的名字是
// `subtract(...shapes)` / `union(...shapes)`。两者几何完全同一（都经 `operation`
// 映射到内核 `cut` / `fuse`），差别只在名字。别名把"一个概念一个实现"落实到位：
// 改 subtract 就等于改 cut，不存在实现漂移。多输入、keep 语义、面演化、naming
// 全部一致。
//
// 唯一的签名差异是**参数表**：别名继承变参形态，所以 `cut(a, b, c)` 现在真的减两次
// （旧手写 cut 只解构 base/tool，第三参被静默吞掉）；`fuse(a, b, c)` 同理合流三次。

/**
 * Boolean cut (subtract): remove `tool` from `base` — {@link subtract} 的别名。
 *
 * brepjs 兼容名。与 `subtract` 是同一个函数对象（同一实现、同一 schema、同一
 * 消费语义），`cut(a, b)` ≡ `subtract(a, b)`；变参形态同样适用（`cut(a, b, c)`
 * 从 a 中依次减去 b、c）。
 *
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name cut
 * @param shapes - 参与运算的几何（第一个为主体）。type:Shape[] required:true
 * @returns Shape base 依次减去其余输入。
 * @example
 * const b = cad.cut(part0, part1)
 */
export const cut = subtract

/**
 * Boolean fuse (union) — {@link union} 的别名。
 *
 * brepjs 兼容名。与 `union` 是同一个函数对象（同一实现、同一 schema、同一
 * 消费语义），`fuse(a, b)` ≡ `union(a, b)`；变参形态同样适用。
 *
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name fuse
 * @param shapes - 参与运算的几何（变量引用，≥2 个）。type:Shape[] required:true
 * @returns Shape 所有输入的并集。
 * @example
 * const c = cad.fuse(part0, part1)
 */
export const fuse = union
