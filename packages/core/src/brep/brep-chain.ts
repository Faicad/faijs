/**
 * BREP 链状态管理
 *
 * 在语句重放过程中跟踪 OCCT 精确实体句柄。
 * - solidCache: statementId → ShapeHandle（OCCT 实体句柄）
 *
 * BREP 状态是「逐 part」的：一个 part 是否仍为 BREP，
 * 由 solidCache 里是否有它的句柄唯一决定。
 * 不存在全局 brepActive 标志——兄弟 part 互不污染。
 *
 * 生命周期：由 executeScript / executePart 创建，执行结束后释放所有中间句柄。
 * 终端句柄（如果有）由调用方保留用于导出。
 */

import type { BrepHandle, BrepMeshResult, BrepCapabilities } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import { getBrepEngine } from './engine/registry'
import { ensureOcctDefaultEngine } from './engine/adapters/occt'
import type { PartName } from '../identity'

// ─── CAD 格式静态判定 ───

/**
 * CAD formats: files in these formats can be imported by the OCCT kernel as
 * exact solids (STEP/STP via importStep, BREP via fromBREP).
 * IGES is intentionally absent — occt-wasm does not link TKDEIGES.
 */
const CAD_FORMATS = new Set(['step', 'brep', 'stp'])

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
  // 非 source buffer 是转换后的网格数据 → 非 CAD 源
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
 *
 * BREP 状态是「逐 part」的：
 * - solidCache 中存在该 part 的句柄 → 该 part 仍为 BREP
 * - solidCache 中不存在该 part 的句柄 → 该 part 已降级为 mesh
 *
 * 不再有全局 brepActive / breakReason 字段。
 * 一个 part 失去 BREP 状态，当且仅当：
 *   - 它被 knurl/sdf（mesh-only op）产生（不写 solidCache），或
 *   - 它的上游输入中至少有一个没有 BREP 实体。
 * 兄弟 part 之间互不污染。
 */
export interface BrepChainState {
  /** BREP 实体句柄缓存（PartName → BrepHandle）。存在即该 part 仍为 BREP；缺失即已降级为 mesh。 */
  solidCache: Map<PartName, BrepHandle>
  /** BREP 引擎实例（mesh 模式为 null —— 等价于「无 BREP 能力」）。 */
  kernel: BrepEngineApi | null
  /**
   * 当前引擎的能力声明（§7.5；mesh 模式无引擎 → undefined）。
   * 供能力路由静态判定（§8.4）：缺失的能力 → 依赖它的功能静态降级走 mesh。
   */
  capabilities?: BrepCapabilities
  /**
   * 零件在世界空间中的平移偏移（来自 mesh.position / partTransforms）。
   *
   * BREP solid 在原始局部坐标系中（STEP 文件原始坐标），而用户交互
   * 产生的 position（如钻孔 clickPosition）是世界坐标。使用此偏移
   * 将世界坐标转换为局部坐标，确保 BREP 操作在正确的坐标系中执行。
   *
   * 由 executePart 从 useEngineStore.partTransforms[scopedId].position 填充。
   */
  partTransform?: { position: [number, number, number]; scale?: [number, number, number] }
  /**
   * P5-2: 面演化映射缓存（statementId → FaceEvolution）。
   *
   * 每个布尔/变换操作执行后，存储面 ordinal 映射（输入 ordinal → 输出 ordinal 列表）。
   * 用于面引用在确定性重放下的稳定性验证和未来的面迁移功能。
   *
   * FaceEvolution = Map<number, number[]>（inOrdinal → outOrdinal[]）
   */
  faceEvolutionCache?: Map<PartName, Map<number, number[]>>
  /**
   * 拓扑命名 RoleTable 持久缓存（PartName → RoleTable，§2.3 of
   * docs/plans/2026-08-31-topology-naming-port-v2.md）。
   *
   * 与 faceEvolutionCache 完全同生命周期：runtime 实例级持久、按语句增量同步、
   * dispose 一并 clear。RoleTable 是执行内状态，不序列化、不进 .fai.js、不进
   * ExecutionResult.naming（宿主只拿 §3.7 的纯数据）。hash 是会话内活句柄索引，
   * 跨实例/会话重建时整体重建。
   */
  roleTableCache?: Map<PartName, unknown>
  /**
   * 三角化缓存：PartName → WasmMesh（含 faceGroups）。
   *
   * BREP op 调用 solidToShape 三角化后，把完整 WasmMesh 缓存到此 Map。
   * buildBrepTopology 复用此缓存，避免二次 meshShape 导致拓扑 mesh ≠ 显示 mesh。
   *
   * 规则 1：拓扑数据生成所使用的 mesh，必须是当前用户看到的 mesh。
   * 三角化和拓扑生成都是 faijs 的职责，宿主不参与。
   */
  meshShapeCache?: Map<PartName, BrepMeshResult>
}

/**
 * Create an empty BREP chain state with no cached solids and no kernel.
 * @returns a new empty BrepChainState.
 */
export function createBrepChainState(): BrepChainState {
  return {
    solidCache: new Map(),
    kernel: null,
    faceEvolutionCache: new Map(),
    roleTableCache: new Map(),
    meshShapeCache: new Map(),
  }
}

/**
 * Initialize the BREP chain state asynchronously: resolve the active BREP
 * engine from the registry and initialize its kernel.
 * OCCT is the built-in default engine: when no engine is registered it is
 * assembled first (ensureOcctDefaultEngine is idempotent).
 * @returns a Promise resolving to an initialized BrepChainState.
 */
export async function initBrepChainState(): Promise<BrepChainState> {
  await ensureOcctDefaultEngine()
  const engine = await getBrepEngine()
  return {
    solidCache: new Map(),
    kernel: engine.primitives,
    capabilities: engine.capabilities,
    faceEvolutionCache: new Map(),
    roleTableCache: new Map(),
    meshShapeCache: new Map(),
  }
}

/**
 * 释放 BREP 链状态中的所有句柄并清空 solidCache。
 *
 * Persistent SolidCache 方案（docs/plans/2026-08-18-brepchain-persistent-solid-cache.md）：
 * 释放只发生在「重算顶替 / dispose」，不再需要"保留终端、释放中间"的选择性语义，
 * 因此 keepIds 参数已删除——调用方想保留任何 solid 时，不应再调用本函数。
 *
 * @param state BREP 链状态
 */
export function releaseBrepChainState(state: BrepChainState): void {
  for (const [, handle] of state.solidCache) {
    try {
      state.kernel?.release(handle)
    } catch {
      // 句柄可能已释放，忽略
    }
  }
  state.solidCache.clear()
  state.meshShapeCache?.clear()
}
