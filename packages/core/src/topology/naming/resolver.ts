/**
 * resolver.ts — 统一 ResolutionContext + resolveTopoRef（§2.5/§3.6）
 *
 * 四类 TopoRef 的统一入口。解析上下文来自「输入 Shape 的命名槽」：
 * - BREP：roleTable（hash 键）+ 活句柄（kernel 现场几何）
 * - mesh/primitive：面 hint 快照（setTopology 注入时提炼写入 Shape 槽）
 *
 * M2 只接 face（§4.1 最高优先）；edge/vertex/derived 的解析在 M3 接入
 * （resolve-edge.ts / resolve-vertex.ts / resolve-derived.ts）。
 *
 * 任何一步定不了案 → 抛 TopoRefError（三态错误码），绝不静默拿序号硬取。
 */

import { TopoRefError, type TopoErrorCode, type TopoRef } from './types'
import { resolveFaceTopo, type ResolutionContext } from './resolve-face'

export type { ResolutionContext }

/** 解析结果（实体 = 序号 + 可选活句柄）。 */
export type ResolvedTopoEntity = { handle?: unknown; ordinal: number }

/**
 * 解析一个 TopoRef 到当前快照的实体（序号 + 句柄）。
 *
 * 失败抛 TopoRefError（带错误码），由调用方纳入 args 校验——禁止静默降级。
 *
 * @param ref - the TopoRef to resolve.
 * @param ctx - the resolution context for the input shape the ref targets.
 * @returns the resolved entity (ordinal + optional live handle).
 */
export function resolveTopoRef(ref: TopoRef, ctx: ResolutionContext): ResolvedTopoEntity {
  let resolution
  if (ref.kind === 'face') {
    resolution = resolveFaceTopo(ref, ctx)
  } else {
    // M3：边/顶点/生成面解析（resolve-edge/vertex/derived）尚未接入
    throw new TopoRefError(
      'E_TOPO_NOT_FOUND',
      ref.kind,
      `topo ref (${ref.kind}) resolution is not wired yet (M3)`,
    )
  }
  if (!resolution.ok) {
    throw buildTopoError(resolution.reason, ref.kind, resolution.candidatesOrdinal)
  }
  return { handle: resolution.entity.handle as unknown | undefined, ordinal: resolution.ordinal }
}

/**
 * 三态失败 → TopoRefError（§3.6 错误码）。
 *
 * @param reason - the failure reason.
 * @param kind - the TopoRef kind.
 * @param candidates - optional tied candidate ordinals (ambiguous).
 * @returns the TopoRefError with the proper error code.
 */
export function buildTopoError(
  reason: 'deleted' | 'ambiguous' | 'not-found',
  kind: TopoRef['kind'],
  candidates?: readonly number[],
): TopoRefError {
  return new TopoRefError(codeFor(reason), kind, `topo ref (${kind}) ${messageFor(reason)}`, candidates)
}

function codeFor(reason: 'deleted' | 'ambiguous' | 'not-found'): TopoErrorCode {
  if (reason === 'deleted') return 'E_TOPO_DELETED'
  if (reason === 'ambiguous') return 'E_TOPO_AMBIGUOUS'
  return 'E_TOPO_NOT_FOUND'
}

function messageFor(reason: 'deleted' | 'ambiguous' | 'not-found'): string {
  if (reason === 'deleted') return 'was deleted by an upstream edit'
  if (reason === 'ambiguous') return 'matched multiple candidates (ambiguous)'
  return 'not found in the current shape'
}
