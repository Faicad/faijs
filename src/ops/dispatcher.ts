/**
 * 操作分派器 — 将语句路由到对应的操作实现
 *
 * 这是 dispatcher（executeStatement）的核心分派逻辑。
 * 每个操作有独立的文件，包含 BREP 和 Mesh 两条路径。
 */

import type { Shape } from './types'
import type { CadStatement, Arg } from '../lang/types'
import type { BrepChainState } from '../brep/brep-chain'
import type { HostPorts, ExecutionMode } from '../cad-runtime/ports'
import { isAssetRef, isGeomRef, isParamRef, resolveGeomRef } from './geom-ref'
import type { OpContext } from './types'
import { asPartName, type PartName } from '../identity'

// ─── Arg 解析 ───

/**
 * 解析语句参数中的 Arg 值为实际 JavaScript 值。
 *
 * GeomRef 通过 resolveGeomRef 求值；ParamRef 从参数表求值。
 */
function resolveArg(
  arg: Arg,
  outputCache?: Map<PartName, Shape>,
  params?: Record<string, unknown>,
  brepChain?: BrepChainState,
): unknown {
  if (arg === null || arg === undefined) return arg
  if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') return arg
  if (Array.isArray(arg)) return arg
  if (typeof arg === 'object') {
    // ParamRef: { $param: string }
    if (isParamRef(arg)) {
      const paramName = arg.$param
      if (params && paramName in params) {
        return params[paramName]
      }
      return null
    }
    // GeomRef: { $geom: {...} }
    if (isGeomRef(arg)) {
      if (!outputCache) {
        throw new Error(`[ExecutionValidator] GeomRef requires outputCache for resolution`)
      }
      // P5-2: 传入 BREP solidCache 和 kernel，使 resolveGeomRef 能按 faceOrdinal 取面
      // 逐 part 设计：只要 kernel 存在就传入 solidCache 查询函数，按具体 part id 查各自的实体。
      // solidCache 键为 PartName：实参是语句引用（其首输出名即该部分件名），桥接为 PartName 查询。
      return resolveGeomRef(
        arg,
        (id) => outputCache.get(id),
        brepChain?.kernel ? (id) => brepChain.solidCache.get(asPartName(id)) : undefined,
        brepChain?.kernel ?? undefined,
      )
    }
    // AssetRef: { $asset: string } — passed through, resolved by ops layer (async)
    if (isAssetRef(arg)) {
      return arg
    }
    return arg
  }
  return arg
}

function resolveArgs(
  args: Record<string, Arg>,
  outputCache?: Map<PartName, Shape>,
  params?: Record<string, unknown>,
  brepChain?: BrepChainState,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    result[key] = resolveArg(value, outputCache, params, brepChain)
  }
  return result
}

// ─── 语句执行 ───

/**
 * 执行单条语句，返回输出几何。
 *
 * BREP 链始终传入：语句在 OCCT 实体空间中运算，solid 句柄存入 brepChain.solidCache。
 * 遇到 mesh-only op 时链断裂，后续按 mesh 计算。
 *
 * @param stmt 语句
 * @param inputGeometries 上游语句的输出几何（按 inputs 顺序）
 * @param outputCache 当前重放的输出缓存（statementId → Shape），用于 GeomRef 求值
 * @param params 参数表（本期可为空）
 * @param brepChain BREP 链状态
 * @param ports Host 注入的环境能力（可选）
 * @param mode 执行模式（默认 auto）
 * @returns 输出几何
 */
export async function executeStatement(
  stmt: CadStatement,
  inputGeometries: Shape[],
  outputCache?: Map<PartName, Shape>,
  params?: Record<string, unknown>,
  brepChain?: BrepChainState,
  ports?: HostPorts,
  mode?: ExecutionMode,
): Promise<Shape> {
  const args = resolveArgs(stmt.args, outputCache, params, brepChain)

  const ctx: OpContext = {
    stmt,
    inputGeometries,
    outputCache,
    args,
    params,
    brepChain,
    ports,
    mode,
  }

  switch (stmt.op) {
    // ── 创建 ──
    case 'box':
    case 'sphere':
    case 'cylinder':
    case 'cone':
    case 'wedge': {
      const { executePrimitive } = await import('./primitives')
      return executePrimitive(ctx)
    }

    // ── 变换 ──
    case 'translate':
    case 'rotate':
    case 'scale': {
      const { executeTransform } = await import('./transform')
      return executeTransform(ctx)
    }

    // ── 钻孔 ──
    case 'drill': {
      const { executeDrill } = await import('./drill')
      return executeDrill(ctx)
    }

    // ── 分割 ──
    case 'split': {
      const { executeSplit } = await import('./split')
      return executeSplit(ctx)
    }

    // ── 拉伸 ──
    case 'extrude': {
      const { executeExtrude } = await import('./extrude')
      return executeExtrude(ctx)
    }

    // ── 布尔 ──
    case 'boolean': {
      const { executeBoolean } = await import('./boolean')
      return executeBoolean(ctx)
    }

    // ── 雕刻 ──
    case 'engrave': {
      const { executeEngrave } = await import('./engrave')
      return executeEngrave(ctx)
    }

    // ── 文字 ──
    case 'text': {
      const { executeText } = await import('./text')
      return executeText(ctx)
    }

    // ── 螺丝 ──
    case 'screw': {
      const { executeScrew } = await import('./screw')
      return executeScrew(ctx)
    }

    // ── SVG 挤出 ──
    case 'svgExtrude': {
      const { executeSvgExtrude } = await import('./svgExtrude')
      return executeSvgExtrude(ctx)
    }

    // ── 滚花 ──
    case 'knurl': {
      const { executeKnurl } = await import('./knurl')
      return executeKnurl(ctx)
    }

    // ── 加载 ──
    case 'load': {
      const { executeLoad } = await import('./load')
      return executeLoad(ctx)
    }

    // ── SDF ──
    case 'sdf': {
      const { executeSdf } = await import('./sdf')
      return executeSdf(ctx)
    }

    // ── 结构型语句（死分支，runtime 已拦截） ──
    // group/assembly/add_constraint/do_assemble 不产出几何。
    // 注意：这些 case 在 runtime.execute 主循环中被 returnType==='void'/'same_shape'
    // 的 continue 分支提前拦截，正常执行流不会进入本 dispatcher（见 runtime.ts:271-279）。
    // 装配的真实变换在 runtime.execute 的 assembly pass 中完成
    // （runtime.executeAssemblyPass → executeAssemblyPassForStmt → executeDoAssemble）。
    // 此空 Shape 返回仅为防御性兜底。
    case 'group':
    case 'assembly':
    case 'add_constraint':
    case 'do_assemble': {
      return { positions: new Float32Array(0), indices: new Uint32Array(0) }
    }

    default:
      throw new Error(`[dispatcher] unknown op: ${stmt.op}`)
  }
}
