/**
 * stdlib chamfer — chamfer 倒角库函数（BREP-only，directEdit 能力）
 *
 * 设计文档：docs/plans/2026-08-31-chamfer-brep-api-design.md
 *
 * 与 drill/engrave 的差异：没有 mesh 实现（defineOp({ brep })），输入非 BREP
 * 时由 dispatchPath 抛 E_MESH_UNSUPPORTED；mode='brep' 且引擎缺 directEdit 能力
 * → E_BREP_UNSUPPORTED（backend-dispatch.ts 单点判定）。
 *
 * 类型：
 * - equal（对称）：kernel.chamfer(solid, edges, width)
 * - distanceAngle：kernel.chamferDistAngle(solid, edges, width, angle)
 * - twoDistances（双距）：逐边按 §3.5 换算（width1,width2 + β → dF, θ），
 *     per-edge 调 kernel.chamferDistAngle；凹棱（β ≥ 180°）→ E_CHAMFER_REFLEX_EDGE。
 */

import type { Shape } from '@faicad/faijs-core/mesh/types'
import { solidToShape } from '@faicad/faijs-core/brep/brep-ops'
import { getBackends } from '@faicad/faijs-core/runtime-state'
import { fromBrep, brepOf } from '@faicad/faijs-core/shape'
import { defineOp } from '@faicad/faijs-core/sdk'
import type { BrepEngineApi } from '@faicad/faijs-core/brep/engine/primitives'
import type { BrepHandle } from '@faicad/faijs-core/brep/engine/types'
import type { EdgeTopoRef, ResolutionContext } from '@faicad/faijs-core/topology/naming'
import { resolveTopoRef, facesForQualifier, TopoRefError } from '@faicad/faijs-core/topology/naming'
import { buildEdgeResolutionContext, buildEdgeContextFromSolid } from './topo-resolve'
import { angleBetweenNormals, materialDihedralFromNormalAngle, chamferAngleFromDistances } from './chamfer-math'

// ── 参数自校验（stdlib 被直接 import 时的防御层）──

/**
 * Validate chamfer parameters: `edges` must be a non-empty array of EdgeTopoRef,
 * each with kind key "edge" and a two-entry faces pair.
 * @param params the raw chamfer operation parameters.
 */
export function assertChamferParams(params: Record<string, unknown>): void {
  const edges = params.edges
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new Error('E_CHAMFER_NO_EDGES: chamfer requires at least one edge')
  }
  for (const e of edges) {
    if (!e || typeof e !== 'object' || (e as { kind?: unknown }).kind !== 'edge') {
      throw new Error('E_CHAMFER_BAD_EDGE_REF: every edge entry must be an EdgeTopoRef with kind:"edge"')
    }
    const faces = (e as { faces?: unknown }).faces
    if (!Array.isArray(faces) || faces.length !== 2) {
      throw new Error('E_CHAMFER_BAD_EDGE_REF: EdgeTopoRef.faces must be a two-entry RoleQualifier pair')
    }
  }
  const type = params.type
  if (type !== 'equal' && type !== 'twoDistances' && type !== 'distanceAngle') {
    throw new Error('E_CHAMFER_BAD_TYPE: type must be equal | twoDistances | distanceAngle')
  }
  if (type === 'equal' || type === 'distanceAngle') {
    const width = params.width
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
      throw new Error('E_CHAMFER_BAD_WIDTH: chamfer.width must be a positive number')
    }
    if (type === 'distanceAngle') {
      const angle = params.angle
      if (typeof angle !== 'number' || !Number.isFinite(angle) || angle <= 0 || angle >= 90) {
        throw new Error('E_CHAMFER_BAD_ANGLE: chamfer.angle must be in (0, 90) degrees')
      }
    }
  } else {
    const w1 = params.width1
    const w2 = params.width2
    if (typeof w1 !== 'number' || !Number.isFinite(w1) || w1 <= 0) {
      throw new Error('E_CHAMFER_BAD_WIDTH: chamfer.width1 must be a positive number')
    }
    if (typeof w2 !== 'number' || !Number.isFinite(w2) || w2 <= 0) {
      throw new Error('E_CHAMFER_BAD_WIDTH: chamfer.width2 must be a positive number')
    }
  }
}

// ── §3.5 几何换算 ──

/** 面中心外法向（与 captureFaceHint 同口径）。 */
function faceMidNormal(kernel: BrepEngineApi, face: BrepHandle): [number, number, number] {
  const uv = kernel.uvBounds(face)
  const n = kernel.surfaceNormal(face, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
  return [n.x, n.y, n.z]
}

function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** 复刻 occt-wasm 的双层枚举（config.rs:517-527）：返回内核选用的参考面在
 *  `faceHandles`（getSubShapes(solid,'face')）数组中的下标（0 起）；找不到 → null。 */
function refFaceIndex(kernel: BrepEngineApi, faceHandles: BrepHandle[], edge: BrepHandle): number | null {
  for (let fi = 0; fi < faceHandles.length; fi++) {
    for (const fe of kernel.getSubShapes(faceHandles[fi], 'edge')) {
      if (kernel.isSame(fe, edge)) return fi
    }
  }
  return null
}

/** 两邻面 outer-normal 夹角 → β（材料侧二面角，弧度）。 */
function materialDihedralRad(kernel: BrepEngineApi, ctx: ResolutionContext, a: number, b: number): number {
  const ha = ctx.faces[a - 1]?.handle
  const hb = ctx.faces[b - 1]?.handle
  if (ha === undefined || hb === undefined) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', `chamfer: adjacent face ${a}/${b} has no live handle`)
  }
  const gamma = angleBetweenNormals(dot3(faceMidNormal(kernel, ha), faceMidNormal(kernel, hb)))
  return materialDihedralFromNormalAngle(gamma)
}

/**
 * twoDistances 单边换算：width1/width2 + β（§3.5）→ (dF, θ) 供一次 chamferDistAngle。
 * 参考面由内核自选（refOrdinal 的面）；width1 对应 faces[0] 侧、width2 对应 faces[1] 侧。
 *
 * @param kernel        the OCCT kernel.
 * @param ctx           the edge resolution context (faces with live handles).
 * @param refAOrdinal   resolved ordinal of `EdgeTopoRef.faces[0]` (1-based).
 * @param refBOrdinal   resolved ordinal of `EdgeTopoRef.faces[1]` (1-based).
 * @param refOrdinal    the kernel reference face ordinal (1-based; the F in §3.5).
 * @param width1        the `width1` argument.
 * @param width2        the `width2` argument.
 * @returns { dF, angleDeg } for a single `kernel.chamferDistAngle` call.
 */
export function twoDistParams(
  kernel: BrepEngineApi,
  ctx: ResolutionContext,
  refAOrdinal: number,
  refBOrdinal: number,
  refOrdinal: number,
  width1: number,
  width2: number,
): { distance: number; angleDeg: number } {
  const betaRad = materialDihedralRad(kernel, ctx, refAOrdinal, refBOrdinal)
  // dF/dO：§3.5 —— 内核参考面 == faces[0] → width1，== faces[1] → width2。
  let dF: number
  let dO: number
  if (refOrdinal === refAOrdinal) {
    dF = width1
    dO = width2
  } else if (refOrdinal === refBOrdinal) {
    dF = width2
    dO = width1
  } else {
    throw new Error(`E_CHAMFER_EDGE_MISMATCH: kernel ref face ordinal ${refOrdinal} not in [${refAOrdinal}, ${refBOrdinal}]`)
  }
  const angleRad = chamferAngleFromDistances(dF, dO, betaRad)
  return { distance: dF, angleDeg: radToDeg(angleRad) }
}

/** 解析一条 EdgeTopoRef → (ordinal, handle)；失败抛命名层 TopoRefError。 */
function resolveEdge(ctx: ResolutionContext, ref: EdgeTopoRef): { ordinal: number; handle: BrepHandle } {
  const r = resolveTopoRef(ref, ctx)
  if (r.handle === undefined) {
    throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', `chamfer: edge resolved without handle (${ref.faces[0].role}/${ref.faces[1].role})`)
  }
  return { ordinal: r.ordinal, handle: r.handle as BrepHandle }
}

/** twoDistances 逐边构建（§3.6 V1）：每条边一次 chamferDistAngle。 */
function chamferTwoDistances(
  kernel: BrepEngineApi,
  edges: EdgeTopoRef[],
  startCtx: ResolutionContext,
  solid: BrepHandle,
  width1: number,
  width2: number,
): BrepHandle {
  let resultSolid = solid
  for (const ref of edges) {
    const ctx = resultSolid === solid ? startCtx : buildEdgeContextFromSolid(kernel, resultSolid, startCtx.roleTable)
    const entity = resolveEdge(ctx, ref)
    const faces = resultSolid === solid ? startCtx.faces : ctx.faces
    const idx = refFaceIndex(kernel, faces.map((f) => f.handle).filter((h): h is BrepHandle => h !== undefined), entity.handle)
    if (idx === null) {
      throw new Error('E_CHAMFER_EDGE_MISMATCH: kernel cannot locate ref face (bug)')
    }
    const a = facesForQualifier(ref.faces[0], ctx)[0]
    const b = facesForQualifier(ref.faces[1], ctx)[0]
    const refOrdinal = idx + 1
    const p = twoDistParams(kernel, ctx, a?.ordinal ?? -1, b?.ordinal ?? -1, refOrdinal, width1, width2)
    resultSolid = kernel.chamferDistAngle(resultSolid, [entity.handle], p.distance, p.angleDeg)
  }
  return resultSolid
}

/** BREP-only 主入口（§3.6 flow）。 */
function chamferBrep(input: Shape, params: Record<string, unknown>): Shape {
  const kernel = getBackends().kernel.brep as BrepEngineApi | null
  if (!kernel) throw new Error('[stdlib/chamfer] no BREP kernel')
  const solid = brepOf(input) as BrepHandle | undefined
  if (!solid) throw new Error('[stdlib/chamfer] E_CHAMFER_NO_BREP: input is not BREP')

  const edges = (params.edges as unknown as EdgeTopoRef[] | undefined) ?? []
  const type = params.type as string
  const ctx = buildEdgeResolutionContext(kernel, input as object)
  if (!ctx) throw new TopoRefError('E_TOPO_NOT_FOUND', 'edge', 'input has no edge naming context')

  let resultSolid: BrepHandle
  switch (type) {
    case 'equal':
      resultSolid = kernel.chamfer(solid, edges.map((e) => resolveEdge(ctx, e).handle), params.width as number)
      break
    case 'distanceAngle':
      resultSolid = kernel.chamferDistAngle(solid, edges.map((e) => resolveEdge(ctx, e).handle), params.width as number, params.angle as number)
      break
    case 'twoDistances':
      resultSolid = chamferTwoDistances(kernel, edges, ctx, solid, params.width1 as number, params.width2 as number)
      break
    default:
      throw new Error('E_CHAMFER_BAD_TYPE')
  }

  return fromBrep(solidToShape(kernel, resultSolid), { solid: resultSolid })
}

/**
 * 在几何体上倒角（等距 / 双距 / 距角）。仅 BREP 可用。
 * @group 特征
 * @inputs 1
 * @async true
 * @qual ok
 * @name chamfer
 * @note 倒角是 BREP-only：非 BREP 输入抛 E_MESH_UNSUPPORTED。参考面由内核自选，`width1` 沿 faces[0] 侧、`width2` 沿 faces[1] 侧。
 * @returns Shape 倒角后的几何。
 * @param input - 目标几何。type:Shape required:true
 * @param params.edges - 参与倒角的边（EdgeTopoRef[]，条目为相邻两面的 role 线路）。type:EdgeTopoRef[] required:true
 * @param params.type - 倒角类型（equal | twoDistances | distanceAngle）。type:string required:true
 * @param params.width - type=equal: 倒角宽度（mm）。type:number 默认 1
 * @param params.width1 - type=twoDistances: 沿 faces[0] 侧距离（mm）。type:number
 * @param params.width2 - type=twoDistances: 沿 faces[1] 侧距离（mm）。type:number
 * @param params.angle - type=distanceAngle: 与参考面夹角（度，(0,90)）。type:number
 * @example
 * const p = await cad.chamfer(part0, { edges: [{ kind:'edge', faces:[{ origin:'box', role:'box:top' }, { origin:'box', role:'box:front' }], hint:{ kind:'edge' } }], type:'equal', width:1 })
 */
export const chamfer = defineOp({
  capabilities: ['directEdit'],
  brep(input: Shape, params: Record<string, unknown>) {
    assertChamferParams(params)
    return chamferBrep(input, params)
  },
})
