/**
 * BREP 链状态管理
 *
 * 在语句重放过程中跟踪 OCCT 精确实体句柄。
 * - solidCache: statementId → ShapeHandle（OCCT 实体句柄）
 * - brepActive: BREP 链是否未断裂
 * - breakReason: 断裂原因（如果链已断裂）
 *
 * 生命周期：由 replayScript / replayPart 创建，重放结束后释放所有中间句柄。
 * 终端句柄（如果有）由调用方保留用于导出。
 */

import type { OcctKernel, ShapeHandle } from 'occt-wasm'
import { initOcctWasm } from '../occt/occtKernel'

// ─── BREP 能力分类 ───

/**
 * BREP-native 操作集合：这些 op 有 OCCT 实现，可以在 BREP 链中传递实体。
 *
 * 所有 op 均已实现 BREP 路径，只有 sdf 没有 OCCT 实现（见 MESH_ONLY_OPS）。
 */
export const BREP_NATIVE_OPS = new Set([
  'box', 'sphere', 'cylinder', 'cone', 'wedge',
  'translate', 'rotate', 'scale',
  'boolean',
  'drill', 'split', 'extrude',
  'text', 'screw', 'svgExtrude', 'engrave',
  'load',
])

/**
 * mesh-only 操作集合：这些 op 没有 OCCT 实现，遇到时 BREP 链断裂。
 *
 * - sdf — 纯网格 SDF 求值
 * - knurl — 位移纹理操作，无参数化滚花 BREP 实现
 */
export const MESH_ONLY_OPS = new Set<string>([
  'sdf',
  'knurl',
])

// ─── CAD 格式静态判定 ───

/**
 * CAD 格式集合：这些格式的文件可以用 OCCT kernel.importStep 导入为精确实体。
 */
const CAD_FORMATS = new Set(['step', 'iges', 'brep', 'stp'])

/**
 * 静态判定 load 语句的源文件是否为 CAD 格式。
 *
 * 纯函数，按 args.format / 文件路径扩展名判定，
 * 不调用 OCCT、不 try-catch。
 *
 * @param args load 语句的参数表（key/path/url + format）
 * @param isSource buffer 是否为原始字节（可走 BREP 路径的前提）
 * @returns true 表示是 CAD 源（可走 BREP 路径）
 */
export function isCadFormat(
  args: Record<string, unknown>,
  isSource: boolean,
): boolean {
  // 非 source buffer 一定是经过 GLB 转换的 → 非 CAD 源
  if (!isSource) return false

  // 优先用显式 format 参数
  const format = args.format as string | undefined
  if (format) {
    return CAD_FORMATS.has(format.toLowerCase())
  }

  // P4-1：按 path/url 的扩展名判定（fileRef 已移除）
  const pathOrUrl = (args.path as string | undefined) ?? (args.url as string | undefined) ?? ''
  const ext = pathOrUrl.split('.').pop()?.toLowerCase() ?? ''
  return CAD_FORMATS.has(ext)
}

// ─── BREP 链状态 ───

/**
 * BREP 链状态：在语句重放过程中跟踪 OCCT 实体句柄。
 */
export interface BrepChainState {
  /** OCCT 实体句柄缓存（statementId → ShapeHandle） */
  solidCache: Map<string, ShapeHandle>
  /** BREP 链是否未断裂 */
  brepActive: boolean
  /** 断裂原因（如果链已断裂） */
  breakReason?: { stmtId: string; op: string }
  /** OCCT 内核实例（重放期间复用） */
  kernel: OcctKernel | null
  /**
   * 零件在世界空间中的平移偏移（来自 mesh.position / partTransforms）。
   *
   * BREP solid 在原始局部坐标系中（STEP 文件原始坐标），而用户交互
   * 产生的 position（如钻孔 clickPosition）是世界坐标。使用此偏移
   * 将世界坐标转换为局部坐标，确保 BREP 操作在正确的坐标系中执行。
   *
   * 由 replayPart 从 useEngineStore.partTransforms[partId].position 填充。
   */
  partTransform?: { position: [number, number, number] }
  /**
   * P5-2: 面演化映射缓存（statementId → FaceEvolution）。
   *
   * 每个布尔/变换操作执行后，存储面 ordinal 映射（输入 ordinal → 输出 ordinal 列表）。
   * 用于面引用在确定性重放下的稳定性验证和未来的面迁移功能。
   *
   * FaceEvolution = Map<number, number[]>（inOrdinal → outOrdinal[]）
   */
  faceEvolutionCache?: Map<string, Map<number, number[]>>
}

/**
 * 创建空的 BREP 链状态。
 */
export function createBrepChainState(): BrepChainState {
  return {
    solidCache: new Map(),
    brepActive: true,
    kernel: null,
    faceEvolutionCache: new Map(),
  }
}

/**
 * 初始化 BREP 链状态（异步，需初始化 OCCT 内核）。
 */
export async function initBrepChainState(): Promise<BrepChainState> {
  const kernel = await initOcctWasm()
  return {
    solidCache: new Map(),
    brepActive: true,
    kernel,
    faceEvolutionCache: new Map(),
  }
}

/**
 * 释放 BREP 链状态中的所有句柄（保留指定的 exceptionIds）。
 *
 * @param state BREP 链状态
 * @param keepIds 要保留的 statementId 集合（通常是终端语句）
 */
export function releaseBrepChainState(state: BrepChainState, keepIds?: Set<string>): void {
  for (const [id, handle] of state.solidCache) {
    if (keepIds?.has(id)) continue
    try {
      state.kernel?.release(handle)
    } catch {
      // 句柄可能已释放，忽略
    }
  }
  // 移除已释放的句柄
  if (keepIds) {
    for (const id of [...state.solidCache.keys()]) {
      if (!keepIds.has(id)) state.solidCache.delete(id)
    }
  } else {
    state.solidCache.clear()
  }
}

/**
 * 标记 BREP 链断裂。
 */
export function breakBrepChain(state: BrepChainState, stmtId: string, op: string): void {
  state.brepActive = false
  state.breakReason = { stmtId, op }
}

/**
 * 获取断链前最后一个有效 BREP solid（solidCache 最后一个条目）。
 *
 * 用于断链后保留拓扑：最后一个有效 solid 的拓扑作为 mesh 的假拓扑。
 *
 * @param state BREP 链状态
 * @returns 最后一个 solid 句柄，或 undefined（solidCache 为空时）
 */
export function lastSolidOfChain(state: BrepChainState): ShapeHandle | undefined {
  const entries = [...state.solidCache.entries()]
  if (entries.length === 0) return undefined
  return entries[entries.length - 1][1]
}
