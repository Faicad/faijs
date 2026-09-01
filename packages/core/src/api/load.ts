/**
 * stdlib load — 加载库函数（统一 load 函数）
 *
 * 设计文档：docs/plans/2026-08-25-faijs-vm-execution-implementation-plan.md §3.11
 * 实施文档：docs/plans/2026-08-29-engine-library-contract-implementation.md P2
 *
 * buffer 经宿主资产解析器解析，isCadFormat 静态判定 brep/mesh，
 * 产物经 solid()/fromBrep() 构造器创建。
 */

import type { Shape } from '../mesh/types'
import { cad } from '../mesh'
import { isCadFormat } from '../brep/brep-chain'
import { loadBrep } from '../brep/brep-ops'
import { getBackends, BrepUnsupportedError } from '../runtime-state'
import { solid, fromBrep } from '../shape'
import type { BrepEngineApi } from '../brep/engine/primitives'

/**
 * 执行加载操作（统一 load 函数）
 *
 * 按 params 中存在的 key/path/url 分流解析 buffer，全部经宿主资产解析器。
 *
 * 静态分派：
 * - CAD 源 + kernel + 非 mesh 模式 → BREP 路径（loadBrep 异常 = 未预期错误，冒泡上报）
 * - 非 CAD 源 / 无 kernel / mesh 模式 → mesh 路径
 * - brep 模式且将走 mesh 路径 → 调用前抛 BrepUnsupportedError（不静默回退）
 */
/**
 * 加载几何资产。key / path / url 三选一（按此优先级分流），内容经宿主资产解析器解析，**引用而非拷贝**。
 * @group 创建
 * @inputs 0
 * @async true
 * @qual ok
 * @name load
 * @note 语言正常化后 loadFile/loadUrl/loadByKey 别名已删除（A4），统一为 `load` 一个函数。
 * @returns Shape 加载的几何，永远是 part 的第一条语句，后面可接特征链。
 * @param params.key - faicad 缓存中的资产 key（内容按 key 取）。type:string
 * @param params.path - 本地绝对路径（非 web 环境）。type:string
 * @param params.url - 网络地址。type:string
 * @param params.format - 格式提示（如 'step'/'stl'；CAD 源走 BREP 精确路径，STL 等三角化源走 mesh 路径）。type:string
 * @note key/path/url 是优先级分流（key 优先，其次 path，最后 url），三者只需其一；同时给多个时按优先级取。`format` 是提示而非强约束——CAD 源（step/stp/brep 等）与三角化源（stl 等）由 `isCadFormat` 静态判定路径。
 * @example
 * const p = await cad.load({ key: 'file_abc123' })
 * const p = await cad.load({ path: 'D:/models/box.step', format: 'step' })
 * const p = await cad.load({ url: 'https://…/box.3mf' })
  */
export async function load(params: Record<string, unknown>): Promise<Shape> {
  const assets = getBackends().assets as {
    resolveByKey(key: string): Promise<{ bytes: ArrayBuffer }>
    resolveFile(path: string): Promise<ArrayBuffer>
    resolveUrl(url: string): Promise<ArrayBuffer>
  } | undefined
  if (!assets) {
    throw new Error('[stdlib/load] assets is required for load op')
  }

  // 按 key/path/url 分流解析 buffer
  let buffer: ArrayBuffer
  if (params.key !== undefined && params.key !== null) {
    buffer = (await assets.resolveByKey(params.key as string)).bytes
  } else if (params.path !== undefined && params.path !== null) {
    buffer = await assets.resolveFile(params.path as string)
  } else if (params.url !== undefined && params.url !== null) {
    buffer = await assets.resolveUrl(params.url as string)
  } else {
    throw new Error('[stdlib/load] load op requires exactly one of key/path/url')
  }

  // 静态判定路径：mesh 模式 / 无 kernel / 非 CAD 源 → mesh 路径；否则 BREP 路径
  const { config, kernel: kernels } = getBackends()
  const kernel = kernels.brep as BrepEngineApi | null
  const useBrep = config.mode !== 'mesh' && !!kernel && isCadFormat(params, true)

  // brep 模式且将走 mesh-only 路径 → 调用前抛错，不静默回退
  if (!useBrep && config.mode === 'brep') {
    throw new BrepUnsupportedError('E_BREP_UNSUPPORTED: load op has no BREP implementation for this source')
  }

  // mesh 路径
  if (!useBrep) {
    return solid(await cad.load(buffer, params.format as string | undefined))
  }

  // BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  // P2：brepChain（meshShapeCache）归引擎侧，loadBrep 不再传
  // partIndex：多 part 文件（如多 solid STEP）逐 part 加载——宿主为每个 part
  // 生成独立 load 语句并携带 partIndex，提取 Compound 中对应子 solid。
  const partIndex = typeof params.partIndex === 'number' ? params.partIndex : undefined
  const { solid: solidHandle, shape } = loadBrep(kernel!, buffer, undefined, undefined, partIndex)
  return fromBrep(shape, { solid: solidHandle })
}
