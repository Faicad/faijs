/**
 * api fillet — fillet 圆角库函数（BREP-only，directEdit 能力）
 *
 * 平台分层（narrowing plan Phase 5，D11）：**中立 op**——`filletWithHistory` 是
 * L1 核心面（brepkit 亦实现），实现全程走 L1（getBrepApi，D12），不声明 engines；
 * capabilities 保留族级 `directEdit`（brepkit 声明 directEdit: true）。
 *
 * 与 chamfer 的差异：fillet 用 filletWithHistory 走面演化 + roleTable 传播
 * （chamfer 在 P5 同步改造）。M1 只支持等半径；M2 计划支持变半径与几何限定符。
 *
 * 设计见 docs/plans/2026-09-10-fillet-op-and-editor-ui.md §2–§3。
 *
 * M1：
 * - 等半径（number）：kernel.filletWithHistory(solid, edges, radius, hashes, bound)
 * - 走 filletWithRoleTable 传播 roleTable（§3.2）
 * - BREP-only：mesh 输入 → E_MESH_UNSUPPORTED（backend-dispatch 静态判定）
 *
 * M2（未实施）：
 * - 变半径 [r1, r2]：filletVariable + 单边 + 不产 roleTable（§3.3 降级）
 * - 几何限定符字符串选边（§4）
 */

import type { Shape } from '../mesh/types'
import { solidToShape } from '../brep/brep-ops'
import { filletWithRoleTable } from '../brep/face-evolution'
import { getBrepApi } from '../brep/handle-bridge'
import { getCurrentStmt } from '../runtime-state'
import { fromBrep, brepOf, inputRoleTable } from '../shape'
import { defineOp } from '../sdk'
import type { BrepHandle } from '../brep/engine/types'
import type { EdgeTopoRef, ResolutionContext } from '../topology/naming'
import { resolveTopoRef, TopoRefError } from '../topology/naming'
import type { Provenance } from '../topology/naming/lineage'
import { buildEdgeResolutionContext } from './topo-resolve'
import { meshKernelFailure, meshSolidEntry, meshSolidProduct, resolveMeshEdges } from './internal/mesh-solid-op'

// ── 参数自校验（api 层被直接 import 时的防御层）──

/** 边选择器校验选项。 */
export interface EdgeSelectorCheckOptions {
  /**
   * 允许 1 起序号作为边选择器（**仅网格链**；见 `resolveMeshEdges`）。
   *
   * 精度链不开这个口子：BREP 的边身份是 role 线路（两个相邻面的 `(origin, role)`），
   * 序号只是内核枚举序，跨特征会漂移——让精度链接受序号等于把"可重放的引用"降级成
   * "这次跑出来的下标"。近似链相反：没有 role 层，序号是唯一无歧义的指认方式。
   */
  readonly allowOrdinals?: boolean
}

/**
 * Validate fillet parameters: `edges` must be a non-empty array of EdgeTopoRef
 * (each with kind key "edge" and a two-entry faces pair) — or of 1-based
 * ordinals when `opts.allowOrdinals` (the mesh chain); `radius` must be a
 * positive number (M1: uniform radius only).
 * @param params the raw fillet operation parameters.
 * @param opts the selector-form options (mesh chain allows ordinals).
 */
export function assertFilletParams(
  params: Record<string, unknown>,
  opts?: EdgeSelectorCheckOptions,
): void {
  const edges = params.edges
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new Error('E_FILLET_NO_EDGES: fillet requires at least one edge')
  }
  for (const e of edges) {
    if (opts?.allowOrdinals && typeof e === 'number') {
      if (!Number.isInteger(e) || e < 1) {
        throw new Error('E_FILLET_BAD_EDGE_REF: an edge ordinal must be a positive integer (1-based)')
      }
      continue
    }
    if (!e || typeof e !== 'object' || (e as { kind?: unknown }).kind !== 'edge') {
      throw new Error('E_FILLET_BAD_EDGE_REF: every edge entry must be an EdgeTopoRef with kind:"edge"')
    }
    const faces = (e as { faces?: unknown }).faces
    if (!Array.isArray(faces) || faces.length !== 2) {
      throw new Error('E_FILLET_BAD_EDGE_REF: EdgeTopoRef.faces must be a two-entry RoleQualifier pair')
    }
  }
  const radius = params.radius
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
    throw new Error('E_FILLET_BAD_RADIUS: fillet.radius must be a positive number')
  }
}

/** 解析一条 EdgeTopoRef → handle；失败抛命名层 TopoRefError。 */
function resolveEdge(ctx: ResolutionContext, ref: EdgeTopoRef): BrepHandle {
  const r = resolveTopoRef(ref, ctx)
  if (r.handle === undefined) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', `fillet: edge resolved without handle (${ref.faces[0].role}/${ref.faces[1].role})`)
  }
  return r.handle as BrepHandle
}

/**
 * 把内核 OcctError 回译成 E_FILLET_RADIUS_TOO_LARGE。
 *
 * OCCT 在半径超过邻面尺寸、三面交汇处、凹边处都可能失败。
 * 绝不可静默返回未圆角的原形状（§9 风险）。
 */
function translateOcctError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('E_FILLET') || msg.includes('E_TOPO')) return err as Error
  return new Error(`E_FILLET_RADIUS_TOO_LARGE: OCCT fillet failed — ${msg}`)
}

/** BREP-only 主入口（M1 等半径 flow）。 */
function filletBrep(input: Shape, params: Record<string, unknown>): Shape {
  // L1 面（D12）：filletWithHistory 是 L1，全链路中立。
  const kernel = getBrepApi()
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('E_FILLET_NO_BREP: fillet input is not BREP')

  const edges = params.edges as EdgeTopoRef[]
  const radius = params.radius as number
  const ctx = buildEdgeResolutionContext(kernel, input as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', 'fillet: input has no edge naming context')

  // 解析所有 EdgeTopoRef → Edge 句柄
  const edgeHandles = edges.map((e) => resolveEdge(ctx, e))

  // 输入 roleTable + outStmt（与 boolean.ts 同构）。Phase 1.6：origin=本次语句 StmtId。
  const inputTable = inputRoleTable(input) as ReadonlyMap<unknown, unknown> | undefined
  const outStmt = String(getCurrentStmt()?.id ?? '')

  let resultSolid: BrepHandle
  let faceEvolution: Map<number, number[]> | undefined
  let roleTable: ReadonlyMap<unknown, unknown> | undefined

  try {
    const r = filletWithRoleTable(
      kernel,
      solid,
      edgeHandles,
      radius,
      inputTable ?? new Map(),
      outStmt,
    )
    resultSolid = r.result
    faceEvolution = r.faceEvolution
    roleTable = r.roleTable
  } catch (err) {
    throw translateOcctError(err)
  }

  return fromBrep(
    solidToShape(kernel, resultSolid),
    { solid: resultSolid, faceEvolution, roleTable },
  )
}

/**
 * 网格实体路径：对近似拓扑里识别出的边倒圆角（方案 2026-10-01 §3.5 三明治）。
 *
 * 与 BREP 路径的三处实质差异，都是"网格零件没有精度链、没有 role 层"的直接后果：
 * - 边**按几何或序号**解析：`EdgeTopoRef` 走长度/中点匹配；**1 起序号**直接取自近似
 *   拓扑的 `edges` 数组下标 + 1（等长边靠几何分不开，序号是唯一无歧义的指认方式）；
 * - 内核调用走 L1 裸 `kernel.fillet`（`filletWithHistory` 是精度链的面演化能力，
 *   近似拓扑没有 hash 演化可言，故**不产生** faceEvolution / roleTable，如实缺席
 *   而不是造一张恒等映射）；
 * - 产物句柄写回后由 `meshSolidProduct` 重新三角化并重建近似拓扑。
 *
 * GOTCHA（2026-10-01 实测，见 `brepkit-kernel/mesh-solid-topology.test.ts`）：
 * 一次请求里的**全部**边交给内核，会在共面边链（如圆柱端盖的 64 条边）上被整体
 * 拒绝——不是单条边不可倒，而是"一次性磨圆会自交"。故本实现**如实失败**，不自动
 * 拆成逐边重试（运行时换策略会掩盖几何事实）。要给共面边链倒角，请分多次调用，
 * 每次一组几何上互不相邻的边。
 *
 * @param input - the mesh-solid input.
 * @param params - the validated fillet parameters.
 * @returns the filleted mesh solid as a new mesh part.
 */
function filletMeshSolid(input: Shape, params: Record<string, unknown>): Shape {
  const edges = params.edges as (number | EdgeTopoRef)[]
  const radius = params.radius as number
  const entry = meshSolidEntry(input, 'fillet')
  const edgeHandles = resolveMeshEdges(entry, edges, 'fillet')

  let result: BrepHandle
  try {
    result = entry.kernel.fillet(entry.solid, edgeHandles, radius)
  } catch (cause) {
    throw meshKernelFailure(
      'fillet',
      'E_FILLET_RADIUS_TOO_LARGE',
      `fillet(r=${radius}) on ${edgeHandles.length} edge(s)`,
      cause,
    )
  }
  return meshSolidProduct(entry, result)
}

/**
 * 在几何体上做圆角（等半径）。
 *
 * 两条路径都以 `meshEngines: ['brepkit']` 之外的事实为界：BREP 输入走
 * `filletWithHistory`（带面演化与 roleTable 传播）；**网格实体**输入走网格后端
 * （近似拓扑无 role，边按几何或序号解析，无面演化）。非 BREP 的**裸网格**输入仍抛
 * `E_MESH_SOLID_UNSUPPORTED`——裸网格没有近似拓扑，没有边可选。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name fillet
 * @note `radius` 为正数（mm）。BREP 路径圆角后 roleTable 经 filletWithHistory 传播，
 *       后续特征仍可按 role 选面/选边；网格实体路径没有 role 层，边只能按几何或
 *       序号（近似拓扑 `edges` 数组下标 + 1）指认。
 * @returns Shape 圆角后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.edges - 参与圆角的边：相邻两面的 role 线路（EdgeTopoRef[]）；网格链上也可用 1 起序号。type:EdgeTopoRef[] required:true
 * @param params.radius - 圆角半径（mm，>0）。type:number required:true
 * @example
 * const p = await cad.fillet(part0, { edges: [{ kind:'edge', faces:[{ origin:'box', role:'box:top' }, { origin:'box', role:'box:front' }], hint:{ kind:'edge' } }], radius:2 })
 * const q = await cad.fillet(meshPart, { edges: [3], radius: 1 })
 */
export const fillet = defineOp({
  capabilities: ['directEdit'],
  meshEngines: ['brepkit'],
  mesh(input: Shape, params: Record<string, unknown>) {
    assertFilletParams(params, { allowOrdinals: true })
    return filletMeshSolid(input, params)
  },
  brep(input: Shape, params: Record<string, unknown>) {
    assertFilletParams(params)
    return filletBrep(input, params)
  },
  naming: { kind: 'kernel', newFaces: { via: 'byAdjacency' } } as Provenance,
})
