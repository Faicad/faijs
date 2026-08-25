/**
 * stdlib load — 加载库函数（统一 load op）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 *
 * 从 src/ops/load.ts 迁出并改写为 stdlib 形态：
 * `(params, exec) => Promise<Shape>`，buffer 经 exec.assets 解析，
 * isCadFormat 静态判定 brep/mesh，产物经 solid() 构造器创建，
 * BREP 路径 solid 经 exec.setSolid 挂身份槽。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { isCadFormat } from '../brep/brep-chain'
import { loadBrep } from '../brep/brep-ops'
import { solid } from './shape'
import type { ExecContext, ExecContextImpl } from '../cad-runtime/exec-context'
import { BrepUnsupportedError } from '../cad-runtime/exec-context'

/**
 * 执行加载操作（统一 load op）
 *
 * 按 params 中存在的 key/path/url 分流解析 buffer，全部经 exec.assets。
 *
 * 静态分派：
 * - CAD 源 + kernel + 非 mesh 模式 → BREP 路径（loadBrep 异常 = 未预期错误，冒泡上报）
 * - 非 CAD 源 / 无 kernel / mesh 模式 → mesh 路径
 * - brep 模式且将走 mesh 路径 → 调用前抛 BrepUnsupportedError（不静默回退）
 */
export async function load(params: Record<string, unknown>, exec: ExecContext): Promise<Shape> {
  if (!exec.assets) {
    throw new Error('[stdlib/load] exec.assets is required for load op')
  }

  // 按 key/path/url 分流解析 buffer
  let buffer: ArrayBuffer
  if (params.key !== undefined && params.key !== null) {
    buffer = (await exec.assets.resolveByKey(params.key as string)).bytes
  } else if (params.path !== undefined && params.path !== null) {
    buffer = await exec.assets.resolveFile(params.path as string)
  } else if (params.url !== undefined && params.url !== null) {
    buffer = await exec.assets.resolveUrl(params.url as string)
  } else {
    throw new Error('[stdlib/load] load op requires exactly one of key/path/url')
  }

  // 静态判定路径：mesh 模式 / 无 kernel / 非 CAD 源 → mesh 路径；否则 BREP 路径
  const kernel = exec.kernels.occt
  const useBrep = exec.mode !== 'mesh' && !!kernel && isCadFormat(params, true)

  // brep 模式且将走 mesh-only 路径 → 调用前抛错，不静默回退
  if (!useBrep && exec.mode === 'brep') {
    throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: load op has no BREP implementation for this source')
  }

  // mesh 路径
  if (!useBrep) {
    return solid(await cad.load(buffer, params.format as string | undefined))
  }

  // BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  const { solid: solidHandle, shape } = loadBrep(kernel!, buffer, (exec as ExecContextImpl).brepChain, undefined)
  const out = solid(shape)
  exec.setSolid(out, solidHandle)
  return out
}
