/**
 * mesh-solid — 网格实体（mesh solid）与其网格后端端口
 *
 *
 * 名词边界（方案 §3.1）：
 * - **网格实体** = 由网格文件导入、经「规范化」得到的引擎实体。它是**近似拓扑**
 *   的载体，不是精度链的一环；永不进 `brepChain.solidCache`。
 * - **规范化** = `importIndexedMesh` → `weldShellsAndFaces(tol)` → `unifyFaces()`。
 *   **顺序不可交换**：先 `unifyFaces` 会把实体做坏（体积归零），防回归用例见
 *   `brepkit-kernel/mesh-solid-topology.test.ts`。
 * - **网格后端** = 提供网格实体能力的引擎侧组件（本期即 brepkit 的网格用法）。
 *   与 BREP 引擎**同名不同用**：可能同一个 wasm 实例，但走 mesh 语义路径。
 *
 * 本模块只依赖 L1（`engine/types`、`engine/primitives`）与拓扑构建器；后端实现
 * 放在适配器侧（`brep/engine/adapters/brepkit`），因此本模块自身不含任何内核私有
 * 调用——`MeshSolidKernelOps` 是内核私有原语的端口（L1 契约不含 weld/unify）。
 */

import type { BrepHandle, BrepMeshResult } from './engine/types'
import type { BrepEngineApi } from './engine/primitives'
import type { PartName } from '../identity'
import type { SelectorRuntimeData } from '../topology/build-selector-runtime'
import { buildTopologyFromMesh } from './brep-topology'

/** 网格实体构建的输入网格（已按基准单位折算的坐标，与 `Shape` 同构）。 */
export interface MeshSolidInput {
  positions: Float32Array
  indices: Uint32Array
}

/** 规范化选项。 */
export interface MeshSolidNormalizeOptions {
  /**
   * 焊接容差（顶点/重复边缝合半径）。缺省由包围盒对角线定标
   * （`max(1e-6, 对角线 × 1e-6)`）——**不得写死绝对值**：STL 无单位元数据，
   * 同一文件既可能是 mm 也可能是 inch，绝对容差在两种尺度下必有一边失准。
   */
  weldTolerance?: number
  /** 三角化参数（缺省与显示 mesh 一致：0.1 / 2π/32）。 */
  linearDeflection?: number
  angularDeflection?: number
}

/** 规范化结果：实体句柄 + 其三角化（显示 mesh 与拓扑 mesh 的唯一真源）。 */
export interface MeshSolidResult {
  /** 规范化后的网格实体句柄。 */
  readonly solid: BrepHandle
  /**
   * 同一实体的三角化（含 faceGroups）。**显示 mesh 必须用这一份**——规则 1：
   * 拓扑 faceRuns 所索引的三角形，必须就是用户看到的三角形。若显示仍用原始
   * STL 顶点数组、拓扑用实体的重新三角化，两者三角形数/序不一致 → faceRuns 错位。
   */
  readonly mesh: BrepMeshResult
  readonly faceCount: number
  readonly edgeCount: number
  readonly vertexCount: number
  /** 实际使用的焊接容差（诊断/复现用）。 */
  readonly weldTolerance: number
  /** `unifyFaces` 合并掉的重复面数（0 = 共面面片未被合并，顶点未焊上）。 */
  readonly mergedFaceCount: number
}

/**
 * 网格后端的**内核私有原语**（L1 `BrepEngineApi` 不含 weld/unify）。
 *
 * 由适配器（拥用内核闭包的一侧）实现；句柄一律是 faijs `BrepHandle`
 * （适配器内部负责 `asNum()` 剥离标签），本模块不感知内核方言。
 */
export interface MeshSolidKernelOps {
  /** 原始三角网格 → 逐三角形面的实体（内核自带顶点焊接）。 */
  importMesh(positions: Float32Array, indices: Uint32Array): BrepHandle
  /** 面列表 → 缝合后的实体（重复边缝成共享边 → 真流形）。 */
  weld(faces: BrepHandle[], tolerance: number): BrepHandle
  /** 共面区域合并（**原地修改**，返回合并掉的面数）。 */
  unify(solid: BrepHandle): number
}

/**
 * 网格后端端口：`load` 的 mesh 路径经它产出网格实体与近似拓扑。
 *
 * 生命周期：由宿主装配期注册进 mesh 引擎槽（`registerMeshEngine`），运行期只读。
 */
export interface MeshSolidBackend {
  /** 后端 id（与 `defineOp.meshEngines` 的门禁名同源，如 `'brepkit'`）。 */
  readonly id: string
  /** L1 契约面（拓扑查询 + 几何操作；brepkit 适配器已全实现）。 */
  readonly kernel: BrepEngineApi
  /** 内核私有原语（weld/unify）。 */
  readonly ops: MeshSolidKernelOps
  /**
   * 规范化 + 三角化。**失败必须抛错**（带 part 名由调用方补），不静默降级。
   * @param mesh - the source triangle mesh (base-unit coordinates).
   * @param opts - optional weld tolerance / tessellation overrides.
   * @returns the mesh solid with its tessellation.
   */
  normalize(mesh: MeshSolidInput, opts?: MeshSolidNormalizeOptions): MeshSolidResult
  /**
   * 已存在的网格实体 → 结果描述（三角化 + 计数）。Phase 2 的 mesh op 用它把
   * 「内核操作产出的新实体」包成下一份网格零件（显示 mesh 与拓扑 mesh 同源）。
   * @param solid - an existing mesh solid handle.
   * @param opts - optional tessellation overrides.
   * @returns the mesh solid result carrying the shared tessellation.
   */
  describe(solid: BrepHandle, opts?: MeshSolidNormalizeOptions): MeshSolidResult
  /**
   * 从网格实体结果构建近似拓扑数据（`SelectorRuntimeData`，可直接交 `setTopology`）。
   * @param result - the mesh solid result (its tessellation indexes the topology).
   * @returns the serializable selector runtime data.
   */
  buildTopologyData(result: MeshSolidResult): SelectorRuntimeData
  /** 释放网格实体句柄。 */
  release(solid: BrepHandle): void
}

// ── 规范化驱动（引擎中立，供适配器的 MeshSolidBackend 实现复用） ──

/** 与显示 mesh 一致的默认三角化参数（`buildSolidTopologyRuntime` 同源）。 */
const DISPLAY_LINEAR_DEFLECTION = 0.1
const DISPLAY_ANGULAR_DEFLECTION = (2 * Math.PI) / 32

/**
 * 由包围盒对角线导出焊接容差（方案 §3.3）。
 *
 * 下限 1e-6 兜住退化 bbox（单点/零厚网格）；上不封顶——超大模型需要更粗的
 * 缝合半径才缝得上（float32 坐标的相对误差随尺度线性增长）。
 *
 * @param kernel - the L1 kernel API (bbox query only).
 * @param shape - the raw imported shape.
 * @returns the weld tolerance derived from the bounding-box diagonal.
 */
export function weldToleranceFor(kernel: BrepEngineApi, shape: BrepHandle): number {
  const bb = kernel.getBoundingBox(shape, false)
  const dx = bb.xmax - bb.xmin
  const dy = bb.ymax - bb.ymin
  const dz = bb.zmax - bb.zmin
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return Math.max(1e-6, diag * 1e-6)
}

/**
 * 规范化：`importMesh` → `weld` → `unify`，再校验并三角化。
 *
 * 三条硬约束，都是 Phase 0 实测结论：
 * 1. **顺序不可交换**——先 unify 再 weld 会得到体积归零的坏实体；
 * 2. `unify` **原地修改**，返回值是合并面数，不是句柄；
 * 3. 校验用 `isValid`（weld 后必须合法），不合法即抛错——开放/非流形网格必须
 *    在导入处失败，不能静默退化成"无拓扑的裸网格"（那会让所有下游 mesh op
 *    失去选择能力）。
 *
 * @param backend - the mesh backend providing ops + kernel.
 * @param mesh - the source triangle mesh.
 * @param opts - optional weld tolerance / tessellation overrides.
 * @returns the normalized mesh solid, its tessellation, and element counts.
 * @throws {Error} `E_MESH_SOLID_UNWELDABLE` when welding leaves an invalid solid.
 */
export function normalizeMeshSolid(
  backend: MeshSolidBackend,
  mesh: MeshSolidInput,
  opts?: MeshSolidNormalizeOptions,
): MeshSolidResult {
  const { kernel, ops } = backend
  const raw = ops.importMesh(mesh.positions, mesh.indices)
  const tolerance = opts?.weldTolerance ?? weldToleranceFor(kernel, raw)

  const faces = kernel.getSubShapes(raw, 'face')
  const welded = ops.weld(faces, tolerance)
  // 原地修改：返回值是合并掉的面数。绝不能把它当句柄。
  const mergedFaceCount = ops.unify(welded)

  if (!kernel.isValid(welded)) {
    // 原始实体（逐三角形、边不共享）在 weld 前就不合法是正常的；weld 后仍不合法
    // 说明网格本身开放/非流形/自交——这是**必须暴露的导入失败**，不是可降级状态。
    try { backend.release(raw) } catch { /* already released */ }
    throw new Error(
      `E_MESH_SOLID_UNWELDABLE: welded mesh is still an invalid solid (tolerance=${tolerance}) — ` +
      'the source mesh is open, non-manifold or self-intersecting',
    )
  }
  // 焊接后原始逐三角形实体已无用；及时释放，避免句柄堆积（新路径不得添泄漏）。
  try { backend.release(raw) } catch { /* already released */ }

  const tess = kernel.meshShape(welded, {
    linearDeflection: opts?.linearDeflection ?? DISPLAY_LINEAR_DEFLECTION,
    angularDeflection: opts?.angularDeflection ?? DISPLAY_ANGULAR_DEFLECTION,
  })

  return {
    solid: welded,
    mesh: tess,
    faceCount: kernel.getSubShapes(welded, 'face').length,
    edgeCount: kernel.getSubShapes(welded, 'edge').length,
    vertexCount: kernel.getSubShapes(welded, 'vertex').length,
    weldTolerance: tolerance,
    mergedFaceCount,
  }
}

/**
 * 已存在的网格实体 → 结果描述（三角化 + 计数）。
 *
 * Phase 2 的 mesh op 产出的新实体走这里：**一次**三角化同时喂显示与拓扑，
 * 保证 `faceRuns` 与所见三角形一一对应（规则 1）。重复调 `describe` 会得到
 * 另一份三角化结果——同一实体在同一参数下确定性一致，但仍应复用同一份结果。
 *
 * @param backend - the mesh backend.
 * @param solid - an existing mesh solid handle.
 * @param opts - optional tessellation overrides.
 * @returns the mesh solid result carrying the shared tessellation.
 */
export function describeMeshSolid(
  backend: MeshSolidBackend,
  solid: BrepHandle,
  opts?: MeshSolidNormalizeOptions,
): MeshSolidResult {
  const { kernel } = backend
  const tess = kernel.meshShape(solid, {
    linearDeflection: opts?.linearDeflection ?? DISPLAY_LINEAR_DEFLECTION,
    angularDeflection: opts?.angularDeflection ?? DISPLAY_ANGULAR_DEFLECTION,
  })
  return {
    solid,
    mesh: tess,
    faceCount: kernel.getSubShapes(solid, 'face').length,
    edgeCount: kernel.getSubShapes(solid, 'edge').length,
    vertexCount: kernel.getSubShapes(solid, 'vertex').length,
    weldTolerance: 0,
    mergedFaceCount: 0,
  }
}

/**
 * 网格实体 → 近似拓扑数据（`SelectorRuntimeData`）。
 *
 * 复用 BREP 路径同源的 `buildTopologyFromMesh`（方案 §1.3 实测：产物与 BREP
 * 路径同构——同样的 FaceRow/EdgeRow 字段、同样的 `faceStart/faceCount` 邻接）。
 * **不引入第二套拓扑表示。**
 *
 * @param backend - the mesh backend (kernel + release).
 * @param result - the normalized mesh solid result (carries the shared tessellation).
 * @returns the serializable selector runtime data.
 */
export function buildMeshSolidTopology(
  backend: MeshSolidBackend,
  result: MeshSolidResult,
): SelectorRuntimeData {
  return buildTopologyFromMesh(backend.kernel, result.solid, result.mesh)
}

// ── 注册表（生命周期，与 brepChain.solidCache 并列且互不干扰） ──

/**
 * 网格实体句柄注册表（`PartName → BrepHandle`）。
 *
 * 与 `brepChain.solidCache` 的差别：本表**永不**参与 BREP 精度链判定——
 * 它存在只表示"该 part 是网格零件，携带近似拓扑"。释放语义与 solidCache 对齐：
 * `set` 覆盖不释放（旧句柄可能仍被旧输出 Shape 引用），`delete`/`clear` 释放。
 */
export class MeshSolidRegistry {
  private readonly handles = new Map<PartName, BrepHandle>()
  private backendRef: MeshSolidBackend | null = null

  /**
   * 装配/换装网格后端（宿主装配期；运行期只读语义）。
   * @param backend - the mesh backend, or null to detach.
   */
  setBackend(backend: MeshSolidBackend | null): void {
    this.backendRef = backend
  }

  /**
   * 当前网格后端（未装配则 null）。
   * @returns the assembled mesh backend, or null.
   */
  get backend(): MeshSolidBackend | null {
    return this.backendRef
  }

  /**
   * 登记某 part 的网格实体句柄（覆盖旧值，**不释放**旧句柄——与 solidCache 同语义）。
   * @param part - the part name.
   * @param solid - the mesh solid handle.
   */
  set(part: PartName, solid: BrepHandle): void {
    this.handles.set(part, solid)
  }

  /**
   * 读取某 part 的网格实体句柄。
   * @param part - the part name.
   * @returns the handle, or undefined.
   */
  get(part: PartName): BrepHandle | undefined {
    return this.handles.get(part)
  }

  /**
   * 该 part 是否携带网格实体。
   * @param part - the part name.
   * @returns true when a handle is registered.
   */
  has(part: PartName): boolean {
    return this.handles.has(part)
  }

  /**
   * 删除某 part 并释放其句柄（重放/失效路径）。
   * @param part - the part name.
   */
  delete(part: PartName): void {
    const h = this.handles.get(part)
    if (h === undefined) return
    this.handles.delete(part)
    try { this.backendRef?.release(h) } catch { /* already released */ }
  }

  /**
   * 按 part 名列表批量删除（重放失效用）。
   * @param parts - the part names to delete; unknown names are ignored.
   */
  deleteMany(parts: Iterable<PartName>): void {
    for (const p of parts) this.delete(p)
  }

  /** 释放全部句柄并清空（dispose）。 */
  clear(): void {
    for (const h of this.handles.values()) {
      try { this.backendRef?.release(h) } catch { /* already released */ }
    }
    this.handles.clear()
  }

  /**
   * 当前登记的全部 part 名（诊断/测试）。
   * @returns the registered part names.
   */
  keys(): PartName[] {
    return [...this.handles.keys()]
  }

  /** 登记数量（诊断/测试）。 */
  get size(): number {
    return this.handles.size
  }
}
