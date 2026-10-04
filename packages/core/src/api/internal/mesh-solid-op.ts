/**
 * mesh-solid-op — 网格 op 的「三明治」共享实现（方案 2026-10-01 §3.5）
 *
 * 每个网格 op 的实现体都是同一个形状，本模块只把这三步抽出来，让 op 侧只剩"调哪个
 * 内核方法"这一件事：
 *
 * ```
 * MeshData ──► meshSolid 句柄（从 Shape 槽取，**不重复导入**）
 *               │
 *               ├─ 内核调用（fillet / chamfer / fuse / cut / intersect / …）
 *               │
 *               └─ meshShape(新句柄) ──► MeshData（显示 mesh 与近似拓扑**同一份**）
 * ```
 *
 * 三条不可让步的口径：
 *
 * 1. **显示 mesh = 新实体的三角化**，不是输入的顶点数组。规则 1：拓扑 faceRuns
 *    索引的三角形必须就是用户看到的三角形——照抄输入数组会让两者错位。
 * 2. **新句柄必须写回**（Shape 槽 + 运行时注册表 + 近似拓扑）。不写回 = 下游 op
 *    拿不到句柄、宿主选中不到面；不登记注册表 = 句柄无人释放。
 * 3. **旧句柄不由本模块释放**。BREP 侧同构（`filletBrep` 也不释放输入句柄）：
 *    句柄生命周期归链（注册表 / releasePartCaches），op 只管"取一个、交一个"。
 *    这里"顺手 release 输入"会打断 `b = fillet(a)` 之后仍然可用的 `a`。
 *
 * op 拿不到 `CadRuntime` 实例，故句柄与拓扑经 **pending 通道**登记
 * （与 `load` 的 `setPendingMeshSolid` / `setPendingMeshTopology` 同模式），
 * 由引擎在语句执行后收编——收编时会核对存活 ctx 变量仍携带**这个**句柄，防顶替。
 */

import type { Shape } from '../../mesh/types'
import type { BrepEngineApi } from '../../brep/engine/primitives'
import type { BrepHandle } from '../../brep/engine/types'
import {
  describeMeshSolid,
  type MeshSolidBackend,
  type MeshSolidResult,
} from '../../brep/mesh-solid'
import { fromMeshFace, fromMeshSolid, meshFaceOf, meshSolidOf } from '../../shape'
import {
  MeshUnsupportedError,
  getBackends,
  getCurrentStmt,
  setPendingMeshSolid,
  setPendingMeshTopology,
} from '../../runtime-state'
import { TopoRefError, resolveTopoRef, type EdgeTopoRef, type FaceTopoRef, type ResolutionContext } from '../../topology/naming'
import { OpError } from './result-unwrap'
import { buildMeshEdgeResolutionContext, buildMeshFaceResolutionContext } from '../topo-resolve'
import { makePlane, type Plane } from '../../geometry2d/bridge/plane'

/**
 * 网格 op 的最小执行入口：内核 + 后端 + 输入句柄（**不带**解析上下文）。
 *
 * 变换 / 抽壳 / 阵列这类"整体作用于实体"的 op 不需要解析上下文（它们按序号或
 * 几何选面/选边，且各自的选面逻辑自带上下文构建）——对它们建一遍全边表 + 逐边
 * 几何 hint，是纯粹的浪费（大网格上是 O(边数) 次内核调用）。
 */
export interface MeshSolidBasic {
  /** 网格后端的 L1 契约面（几何操作走它，op 不碰内核私有方言）。 */
  readonly kernel: BrepEngineApi
  /** 网格后端（三角化 / 近似拓扑 / 释放）。 */
  readonly backend: MeshSolidBackend
  /** 输入的网格实体句柄。 */
  readonly solid: BrepHandle
}

/** 网格 op 的执行入口：最小入口 + 边解析上下文。 */
export interface MeshSolidEntry extends MeshSolidBasic {
  /** 边解析上下文（无 role 层 → 纯几何匹配，见 `buildMeshEdgeResolutionContext`）。 */
  readonly edgeContext: ResolutionContext
}

/**
 * 取当前装配的网格后端；未装配即抛（宿主装配事实，不是运行时降级点）。
 *
 * @param opLabel - the op name (error messages).
 * @returns the assembled mesh backend.
 * @throws {MeshUnsupportedError} when no mesh backend is assembled in this host.
 */
export function meshBackendOrThrow(opLabel: string): MeshSolidBackend {
  const backend = getBackends().kernel.meshSolid as MeshSolidBackend | undefined
  if (!backend) {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel}'s mesh path needs an assembled mesh backend — none is ` +
      'available in this host',
      getCurrentStmt(),
    )
  }
  return backend
}

/**
 * 取网格实体的最小执行入口（只要内核 + 后端 + 句柄）。
 *
 * 两个失败面必须分开说，因为它们的原因完全不同：
 * - 输入**不是**网格实体（裸网格 / BREP 实体）→ 该 op 的 mesh 路径只懂网格实体，
 *   如实拒绝。裸网格意味着"加载它的时候没有装配网格内核"，与"规范化失败"是两回事。
 * - 输入是网格实体但**没有装配网格后端** → 装配事实（宿主没提供），不是运行时降级点。
 *
 * @param input - the op's geometry input.
 * @param opLabel - the op name (error messages).
 * @returns the minimal mesh-solid entry for this input.
 * @throws {MeshUnsupportedError} when the input is not a mesh solid or no backend is assembled.
 */
export function meshSolidBasicEntry(input: Shape, opLabel: string): MeshSolidBasic {
  const backend = meshBackendOrThrow(opLabel)
  const solid = meshSolidOf(input) as BrepHandle | undefined
  if (solid === undefined) {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel}'s mesh path needs a mesh solid input — ` +
      'this input is a bare mesh (it was loaded without a mesh backend, so it has no approximate topology)',
      getCurrentStmt(),
    )
  }
  return { kernel: backend.kernel, backend, solid }
}

/**
 * 取网格实体的执行入口（含边解析上下文）。
 *
 * 两个失败面必须分开说，因为它们的原因完全不同：
 * - 输入**不是**网格实体（裸网格 / BREP 实体）→ 该 op 的 mesh 路径只懂网格实体，
 *   如实拒绝。裸网格意味着"加载它的时候没有装配网格内核"，与"规范化失败"是两回事。
 * - 输入是网格实体但**没有装配网格后端** → 装配事实（宿主没提供），不是运行时降级点。
 *
 * @param input - the op's geometry input.
 * @param opLabel - the op name (error messages).
 * @returns the mesh-solid entry for this input (with the edge resolution context).
 * @throws {MeshUnsupportedError} when the input is not a mesh solid or no backend is assembled.
 */
export function meshSolidEntry(input: Shape, opLabel: string): MeshSolidEntry {
  const basic = meshSolidBasicEntry(input, opLabel)
  const edgeContext = buildMeshEdgeResolutionContext(basic.kernel, input)
  if (!edgeContext) {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel} could not build an edge resolution context for the mesh solid ` +
      '(the input carries a mesh solid handle but no readable slot)',
      getCurrentStmt(),
    )
  }
  return { ...basic, edgeContext }
}

/**
 * 把一组边**选择器**解析成当前网格实体的边句柄。
 *
 * 两种选择器，两条解析路：
 * - **序号**（1 起，与 `sketchOnFace` 的 `face` 序号同口径）：直接取自
 *   `getSubShapes(solid,'edge')` 的枚举序，即宿主在近似拓扑 `edges` 数组里看到的
 *   那个下标 + 1。这是**首选**——近似拓扑没有 role 层，几何（长度 / 中点）在等长边
 *   上无法区分，序号是唯一无歧义的指认方式。
 * - **`EdgeTopoRef`**：纯几何匹配（length / midpoint）。解析不到或无法区分时如实
 *   抛错，绝不静默退回"拿序号硬取"。
 *
 * @param entry - the mesh-solid entry (provides the live edge table).
 * @param refs - edge selectors: 1-based ordinals or TopoRefs captured from the topology.
 * @param opLabel - the op name (error messages).
 * @returns the resolved edge handles, in the same order as `refs`.
 * @throws {OpError} `E_TOPO_NOT_FOUND` when a selector cannot be resolved.
 */
export function resolveMeshEdges(
  entry: MeshSolidEntry,
  refs: readonly (number | EdgeTopoRef)[],
  opLabel: string,
): BrepHandle[] {
  return refs.map((ref, i) => {
    if (typeof ref === 'number') return meshEdgeOrdinal(entry, ref, i, opLabel)
    const where =
      `edge[${i}] of the mesh solid (length=${ref.hint.length ?? '<none>'}, ` +
      `midpoint=${ref.hint.midpoint ? ref.hint.midpoint.join(',') : '<none>'})`
    let resolved: { handle?: unknown }
    try {
      resolved = resolveTopoRef(ref, entry.edgeContext)
    } catch (cause) {
      throw new OpError(
        opLabel,
        'E_TOPO_NOT_FOUND',
        `[api/${opLabel}] ${where} could not be resolved — approximate topology has no role layer, ` +
        `so an edge is identified by geometry alone: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      )
    }
    if (resolved.handle === undefined) {
      throw new OpError(
        opLabel,
        'E_TOPO_NOT_FOUND',
        `[api/${opLabel}] ${where} resolved without an edge handle`,
      )
    }
    return resolved.handle as BrepHandle
  })
}

/**
 * 序号 → 边句柄（1 起，枚举序与近似拓扑 `edges` 数组同序）。
 *
 * 越界不裁剪、不取模、不"就近"——序号是调用方从拓扑读数里抄来的，抄错了就是错的，
 * 静默换一条边会让用户拿到一个不是他要的圆角。
 *
 * @param entry - the mesh-solid entry (provides the live edge table).
 * @param ordinal - the 1-based edge ordinal.
 * @param index - the selector's position in the request (error messages).
 * @param opLabel - the op name (error messages).
 * @returns the live edge handle.
 * @throws {OpError} `E_TOPO_NOT_FOUND` when the ordinal is out of range.
 */
function meshEdgeOrdinal(
  entry: MeshSolidEntry,
  ordinal: number,
  index: number,
  opLabel: string,
): BrepHandle {
  const edges = entry.kernel.getSubShapes(entry.solid, 'edge')
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > edges.length) {
    throw new OpError(
      opLabel,
      'E_TOPO_NOT_FOUND',
      `[api/${opLabel}] edge[${index}] ordinal ${ordinal} out of range [1, ${edges.length}] ` +
      'on the mesh solid',
    )
  }
  return edges[ordinal - 1] as BrepHandle
}

/**
 * 面选择器数组 → 面句柄数组（`shell` 的 `openFaces` 用；序号或 `FaceTopoRef` 都收）。
 *
 * @param kernel - the mesh backend's L1 kernel.
 * @param on - the mesh-solid shape hosting the faces.
 * @param selectors - 1-based face ordinals or FaceTopoRefs.
 * @param opLabel - the op name (error messages).
 * @returns the live face handles, in the same order as `selectors`.
 * @throws {OpError} when a selector cannot be resolved.
 */
export function resolveMeshFaces(
  kernel: BrepEngineApi,
  on: Shape,
  selectors: readonly (number | FaceTopoRef)[],
  opLabel: string,
): BrepHandle[] {
  return selectors.map((selector) => resolveMeshFaceHandle(kernel, on, selector, opLabel))
}

/**
 * 把内核产出的**新网格实体句柄**封装成 op 产物。
 *
 * 一次三角化同时喂显示与拓扑（规则 1），并把句柄与近似拓扑登记到 pending 通道，
 * 由引擎在语句执行后收编（同 `load`）。
 *
 * @param entry - the mesh-solid entry (backend for tessellation/topology/release).
 * @param solid - the new mesh solid handle produced by the kernel call.
 * @returns the product Shape carrying the new handle and its tessellation.
 */
export function meshSolidProduct(entry: { backend: MeshSolidBackend }, solid: BrepHandle): Shape {
  return meshSolidProductWithBackend(entry.backend, solid)
}

/**
 * 同上，但直接收后端（产物输入不是网格实体时用——如 `extrude` 的输入是一张面）。
 *
 * @param backend - the mesh backend (tessellation / topology / release).
 * @param solid - the new mesh solid handle produced by the kernel call.
 * @returns the product Shape carrying the new handle and its tessellation.
 */
export function meshSolidProductWithBackend(backend: MeshSolidBackend, solid: BrepHandle): Shape {
  const result: MeshSolidResult = describeMeshSolid(backend, solid)
  const part = getCurrentStmt()?.outputs[0]
  if (part) {
    setPendingMeshSolid(part, solid)
    setPendingMeshTopology(part, backend.buildTopologyData(result))
  }
  return fromMeshSolid(
    { positions: result.mesh.positions, indices: result.mesh.indices },
    { meshSolid: solid },
  )
}

/**
 * 阵列 / 镜像族产物：把若干**自造副本**融成一个网格零件，并把副本句柄释放掉。
 *
 * 释放口径与 BREP 侧完全一致（`pattern.ts` 的 `finally { for (const c of raw) kernel.release(c) }`）：
 * - 释放的是**本次调用新建的副本**——它们是中间量，融合后无人再引用；
 * - **不释放输入句柄**（`a` 在 `b = linearPattern(a)` 之后仍必须可用）。
 *
 * 副本之间通常是分离的（有间距的阵列），故 fuseAll 得到的是一体多壳的实体——与
 * BREP 路径 fuseAll 分离副本的结局同形，不是"凑成一张皮"。
 *
 * 副本的**生成**也在 try 内：中途失败时已建出的副本同样会被释放（否则每个失败
 * 调用都漏一批句柄）。
 *
 * @param entry - the mesh-solid entry (kernel + backend).
 * @param opLabel - the op name (error messages).
 * @param code - the op-level error code for kernel failures.
 * @param makeCopies - creates the copies to fuse (called once, inside the guard).
 * @returns the fused mesh solid as a new mesh part.
 * @throws {OpError} with `code` when the kernel refuses a copy or the fusion.
 */
export function meshPatternProduct(
  entry: MeshSolidBasic,
  opLabel: string,
  code: string,
  makeCopies: () => BrepHandle[],
): Shape {
  let copies: BrepHandle[] = []
  try {
    copies = makeCopies()
    if (copies.length === 0) {
      throw new OpError(opLabel, code, `[api/${opLabel}] the kernel produced no copies`)
    }
    const result: BrepHandle = entry.kernel.fuseAll(copies)
    return meshSolidProductWithBackend(entry.backend, result)
  } catch (cause) {
    if (cause instanceof OpError) throw cause
    throw meshKernelFailure(opLabel, code, `${opLabel}: fusing ${copies.length} mesh copy(ies)`, cause)
  } finally {
    for (const c of copies) entry.backend.release(c)
  }
}

/** 网格链**面**的执行入口：内核 + 后端 + 面句柄（`sketchOnFace` 的网格分支用）。 */export interface MeshFaceEntry {
  /** 网格后端的 L1 契约面。 */
  readonly kernel: BrepEngineApi
  /** 网格后端（三角化 / 释放）。 */
  readonly backend: MeshSolidBackend
  /** 网格链面句柄。 */
  readonly face: BrepHandle
}

/**
 * 取网格链面的执行入口（`sketchOnFace` 网格分支的输入门）。
 *
 * 与 `meshSolidEntry` 的两个失败面同构：输入没有网格链面身份 → 如实拒绝（它可能是
 * 网格实体、BREP 面或裸网格，三种都不是这里要的东西）；宿主没装配网格后端 → 装配事实。
 *
 * @param input - the op's geometry input (must be a mesh-chain face).
 * @param opLabel - the op name (error messages).
 * @returns the mesh-face entry for this input.
 * @throws {MeshUnsupportedError} when the input is not a mesh-chain face or no backend is assembled.
 */
export function meshFaceEntry(input: Shape, opLabel: string): MeshFaceEntry {
  const backend = meshBackendOrThrow(opLabel)
  const face = meshFaceOf(input) as BrepHandle | undefined
  if (face === undefined) {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel}'s mesh path needs a mesh-chain face input — ` +
      'this input carries no mesh-chain face handle (build one with cad.sketchOnFace on a mesh solid)',
      getCurrentStmt(),
    )
  }
  return { kernel: backend.kernel, backend, face }
}

/**
 * 把网格链面上的面选择器解析成活句柄（序号直接取；`FaceTopoRef` 走纯几何解析）。
 *
 * 网格零件没有 role 层，故与 `resolveMeshEdges` 同纪律：解析不到或无法区分时如实抛错，
 * 绝不静默按序号硬取一张面。**同尺寸的平行面（立方体顶面/底面）在几何上不可区分**，
 * 这种情形会以 `E_TOPO_AMBIGUOUS` 失败——调用方应改用序号。
 *
 * @param kernel - the mesh backend's L1 kernel.
 * @param on - the mesh-solid shape hosting the face.
 * @param selector - a 1-based face ordinal or a `FaceTopoRef`.
 * @param opLabel - the op name (error messages).
 * @returns the live face handle.
 * @throws {OpError} `E_MESH_SOLID_UNSUPPORTED` / `E_TOPO_NOT_FOUND` / `E_TOPO_AMBIGUOUS`.
 */
export function resolveMeshFaceHandle(
  kernel: BrepEngineApi,
  on: Shape,
  selector: number | FaceTopoRef,
  opLabel: string,
): BrepHandle {
  const solid = meshSolidOf(on) as BrepHandle | undefined
  if (solid === undefined) {
    throw new MeshUnsupportedError(
      `E_MESH_SOLID_UNSUPPORTED: ${opLabel}'s mesh path needs a mesh solid host — ` +
      'this input is not a mesh solid',
      getCurrentStmt(),
    )
  }
  const faces = kernel.getSubShapes(solid, 'face')
  if (typeof selector === 'number') {
    if (!Number.isInteger(selector) || selector < 1 || selector > faces.length) {
      throw new OpError(
        opLabel,
        'E_TOPO_NOT_FOUND',
        `[api/${opLabel}] face ordinal ${selector} out of range [1, ${faces.length}] on the mesh solid`,
      )
    }
    return faces[selector - 1] as BrepHandle
  }
  const ctx = buildMeshFaceResolutionContext(kernel, on as object)
  if (!ctx) {
    throw new OpError(opLabel, 'E_TOPO_NOT_FOUND', `[api/${opLabel}] input has no mesh naming context`)
  }
  let resolved: { handle?: unknown }
  try {
    resolved = resolveTopoRef(selector, ctx)
  } catch (cause) {
    const code = cause instanceof TopoRefError && cause.code === 'E_TOPO_AMBIGUOUS' ? 'E_TOPO_AMBIGUOUS' : 'E_TOPO_NOT_FOUND'
    throw new OpError(
      opLabel,
      code,
      `[api/${opLabel}] mesh face ref could not be resolved — approximate topology has no role layer, ` +
      `so a face is identified by geometry alone (normal/center/area; use an ordinal when two faces are congruent): ` +
      `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
  if (resolved.handle === undefined) {
    throw new OpError(opLabel, 'E_TOPO_NOT_FOUND', `[api/${opLabel}] mesh face ref resolved to no live handle`)
  }
  return resolved.handle as BrepHandle
}

/**
 * 从一张网格链面取它的支撑平面（草图平面数据，方案 §4 Phase 3-1）。
 *
 * 两个数据源，各有各的理由：
 * - **平面原点**取面的包围盒中心，不取 `surfaceCenterOfMass`：后者在 brepkit 上是
 *   "UV 域中点求值"的近似（内核没有 per-face 质心 API），对平面求的域中点是
 *   `getSurfaceDomain` 的中点；而平面域是 ±1e6 的**无限域**，其中点只是曲面参数原点，
 *   可能位于面**之外**。包围盒中心是面自己的几何中心，草图从它铺出去必然落在面上。
 * - **法向**取 UV 域中点的 `surfaceNormal`——L1 契约面上的中立方法（brepkit 侧映射
 *   `evaluateSurfaceNormal`），不直接调内核方言的 `getAnalyticSurfaceParams`。
 *
 * @param kernel - the mesh backend's L1 kernel.
 * @param face - the live face handle.
 * @returns the face's supporting plane frame (2D origin = the face's bbox centre).
 */
export function meshFacePlane(kernel: BrepEngineApi, face: BrepHandle): Plane {
  const uv = kernel.uvBounds(face)
  const u = (uv.uMin + uv.uMax) / 2
  const v = (uv.vMin + uv.vMax) / 2
  const n = kernel.surfaceNormal(face, u, v)
  const bb = kernel.getBoundingBox(face)
  return makePlane(
    { x: (bb.xmin + bb.xmax) / 2, y: (bb.ymin + bb.ymax) / 2, z: (bb.zmin + bb.zmax) / 2 },
    { x: n.x, y: n.y, z: n.z },
  )
}

/**
 * 把内核算出的网格链面句柄封装成 op 产物。
 *
 * 与 `meshSolidProductWithBackend` 的区别是**不登记** `MeshSolidRegistry` 与近似拓扑：
 * 面不是零件，没有自己的注册表条目，下游也不需要"面的近似拓扑"（它自己就是拓扑的一部分）。
 * 显示载荷取面自身的三角化（`meshShape` 按句柄类型分发到 face 分支）。
 *
 * @param backend - the mesh backend (tessellation).
 * @param face - the new face handle produced by the kernel call.
 * @returns the product Shape carrying the face handle and its tessellation.
 */
export function meshFaceProduct(backend: MeshSolidBackend, face: BrepHandle): Shape {
  const mesh = backend.kernel.meshShape(face)
  return fromMeshFace(
    { positions: new Float32Array(mesh.positions), indices: new Uint32Array(mesh.indices) },
    { meshFace: face },
  )
}

/**
 * 内核原生错误 → 带 op 名与输入几何的 OpError（几何失败必须带上下文，不裸抛内核串）。
 *
 * @param opLabel - the op name.
 * @param code - the op-level error code.
 * @param context - a short human description of what was being attempted.
 * @param cause - the kernel's own error.
 * @returns the wrapped op error.
 */
export function meshKernelFailure(
  opLabel: string,
  code: string,
  context: string,
  cause: unknown,
): OpError {
  const msg = cause instanceof Error ? cause.message : String(cause)
  return new OpError(
    opLabel,
    code,
    `[api/${opLabel}] ${context} — the mesh kernel refused: ${msg}`,
    { cause },
  )
}
