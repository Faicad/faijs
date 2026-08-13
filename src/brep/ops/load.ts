/**
 * 加载操作分派器（P4-1: 统一 load op）
 *
 * BREP 模式下用 OCCT kernel.importStep 导入为精确实体；
 * 非 CAD 格式（GLB/STL 等）时静态断链后走 mesh 路径。
 *
 * 支持的 op：cad.load({ key/path/url, format? })
 * - key：资产 manifest 引用（通过 ports.assets 解析）
 * - path：本地文件路径（通过 ports.assets 解析）
 * - url：网络 URL（通过 ports.assets 解析）
 *
 * key/path/url 三键互斥（由 args-schema 校验）。
 */

import type { Shape } from '../../mesh-ops/types'
import { cad } from '../../mesh-ops'
import { breakBrepChain, isCadFormat } from '../brep-chain'
import { loadBrep } from '../brep-ops'
import type { OpContext } from './types'
import { canUseBrep } from './types'

// ── 统一执行入口 ──

/**
 * 用解析到的 buffer 执行加载。
 *
 * 静态分派：
 * - 链活跃 && isCadFormat → BREP 路径（loadBrep 异常 = 未预期错误，冒泡上报）
 * - 链活跃 && !isCadFormat → 静态断链 → mesh 路径（合法分支，非回退）
 * - 链不活跃 → mesh 路径
 */
async function executeWithBuffer(
  ctx: OpContext,
  buffer: ArrayBuffer,
  isSource: boolean,
): Promise<Shape> {
  const { stmt, brepChain } = ctx

  // 链不活跃 → mesh 路径（链已在前面静态断掉，正常继续）
  if (!canUseBrep(ctx) || !brepChain?.kernel) {
    const format = ctx.args.format as string | undefined
    return cad.load(buffer, format)
  }

  // 链活跃：静态判定是否为 CAD 格式
  if (!isCadFormat(ctx.args, isSource)) {
    // 非 CAD 源 → 静态断链 → mesh 路径（合法分支，非回退）
    breakBrepChain(brepChain, stmt.id, stmt.op)
    const format = ctx.args.format as string | undefined
    return cad.load(buffer, format)
  }

  // CAD 源 → BREP 路径（直接执行，不包 try-catch！异常 = 未预期错误，冒泡上报）
  const { solid, shape } = loadBrep(brepChain.kernel, buffer)
  brepChain.solidCache.set(stmt.id, solid)
  return shape
}

/**
 * 执行加载操作（统一 load op）
 *
 * 按 args 中存在的 key/path/url 分流解析 buffer。
 * 所有解析都通过 ports.assets 进行。
 *
 * BREP 模式：
 *   1. 解析 buffer（按 key/path/url）
 *   2. isCadFormat 静态判定 → CAD 源：kernel.importStep → OCCT solid → 存入 brepChain.solidCache
 *   3. 非 CAD 源：静态断链 → mesh 路径
 *
 * Mesh 模式 / 静态断链后：
 *   解析 buffer → cad.load → 显示 mesh
 */
export async function executeLoad(ctx: OpContext): Promise<Shape> {
  const { args } = ctx

  if (!ctx.ports?.assets) {
    throw new Error('[executeLoad] ports.assets is required for load op')
  }

  // 按 key/path/url 分流解析 buffer
  let buffer: ArrayBuffer
  let isSource: boolean

  if (args.key !== undefined && args.key !== null) {
    const result = await ctx.ports.assets.resolveByKey(args.key as string)
    buffer = result.bytes
    isSource = true
  } else if (args.path !== undefined && args.path !== null) {
    buffer = await ctx.ports.assets.resolveFile(args.path as string)
    isSource = true
  } else if (args.url !== undefined && args.url !== null) {
    buffer = await ctx.ports.assets.resolveUrl(args.url as string)
    isSource = true
  } else {
    throw new Error('[executeLoad] load op requires exactly one of key/path/url')
  }

  return executeWithBuffer(ctx, buffer, isSource)
}
