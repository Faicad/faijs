/**
 * csg-backend — 可注入的 CSG 后端
 *
 * 提供 computeBoolean / computeSplit / computeDovetailSplit / computeDowelSplit / computeStraightTenonSplit
 * 等异步函数，与 csg.ts 的 API 一致。
 *
 * Node 环境：默认使用 InlineCsgBackend（主线程直跑 manifold-3d）。
 * 浏览器环境：通过 setCsgBackend() 注入 WorkerCsgBackend。
 *
 * F1 修复：不静态 import browser-host/inline-csg-backend（L1 不依赖 L3）。
 * 改为延迟动态 import，仅在未注入后端时按需加载。
 */

import type { CsgBackend } from '../cad-runtime/ports'
import type {
  ManifoldMeshData,
  BooleanOperation,
  DovetailGrooveParams,
  DowelSplitParams,
  StraightTenonSplitParams,
} from './geo-convert'

// ── 后端实例管理 ──

let _backend: CsgBackend | null = null

/**
 * Inject the CSG backend used by the browser host (e.g. WorkerCsgBackend).
 * @param backend The backend instance to install as the current CSG backend.
 */
export function setCsgBackend(backend: CsgBackend): void {
  _backend = backend
}

/**
 * 获取当前 CSG 后端。
 * F1 修复：延迟动态 import InlineCsgBackend，避免 L1 静态依赖 L3。
 */
async function getBackend(): Promise<CsgBackend> {
  if (_backend) return _backend
  // 延迟加载——仅在实际需要时才拉入 L3 代码
  const { InlineCsgBackend } = await import('../browser-host/inline-csg-backend')
  _backend = new InlineCsgBackend()
  return _backend
}

// ── CSG 操作 API（与 csg.ts 签名一致）──

/**
 * Apply a boolean operation across several meshes via the current backend.
 * @param meshes    The input meshes to combine.
 * @param operation The boolean operation to perform (union/subtract/intersect).
 * @returns The resulting mesh of the boolean operation.
 */
export async function computeBoolean(
  meshes: ManifoldMeshData[],
  operation: BooleanOperation,
): Promise<ManifoldMeshData> {
  const backend = await getBackend()
  return backend.boolean(operation, meshes)
}

/**
 * Split a mesh by a plane via the current backend.
 * @param mesh   The mesh to split.
 * @param normal The plane normal (unit vector).
 * @param offset The plane offset along the normal.
 * @returns The front and back halves of the split.
 */
export async function computeSplit(
  mesh: ManifoldMeshData,
  normal: [number, number, number],
  offset: number,
): Promise<{ front: ManifoldMeshData; back: ManifoldMeshData }> {
  const backend = await getBackend()
  const result = await backend.splitPlane(mesh, { normal, offset })
  return { front: result.front, back: result.back }
}

/**
 * Split a mesh by a plane and cut a dovetail groove via the current backend.
 * @param mesh                The mesh to split.
 * @param planeNormal         The cutting plane normal (unit vector).
 * @param planeOriginOffset   The cutting plane offset along the normal.
 * @param planeCenter         A point on the cutting plane.
 * @param widthDir            The width direction within the cutting plane (unit vector).
 * @param bboxWidthOnWidthDir The model bounding-box width along the width direction.
 * @param groove              The dovetail groove parameters.
 * @returns The front/back halves plus the wedge mesh (or null when no wedge).
 */
export async function computeDovetailSplit(
  mesh: ManifoldMeshData,
  planeNormal: [number, number, number],
  planeOriginOffset: number,
  planeCenter: [number, number, number],
  widthDir: [number, number, number],
  bboxWidthOnWidthDir: number,
  groove: DovetailGrooveParams,
): Promise<{ front: ManifoldMeshData; back: ManifoldMeshData; wedge: ManifoldMeshData | null }> {
  const backend = await getBackend()
  const result = await backend.splitDovetail(mesh, {
    planeNormal,
    planeOriginOffset,
    planeCenter,
    widthDir,
    bboxWidthOnWidthDir,
    groove,
  })
  return { front: result.front, back: result.back, wedge: result.wedge }
}

/**
 * Split a mesh by a plane and cut dowel tenons via the current backend.
 * @param mesh                The mesh to split.
 * @param planeNormal         The cutting plane normal (unit vector).
 * @param planeOriginOffset   The cutting plane offset along the normal.
 * @param planeCenter         A point on the cutting plane.
 * @param widthDir            The width direction within the cutting plane (unit vector).
 * @param dowel               The dowel split parameters.
 * @param selectedSections    Optional list of section indices to place tenons on.
 * @returns The front/back halves plus the wedge mesh (or null when no wedge).
 */
export async function computeDowelSplit(
  mesh: ManifoldMeshData,
  planeNormal: [number, number, number],
  planeOriginOffset: number,
  planeCenter: [number, number, number],
  widthDir: [number, number, number],
  dowel: DowelSplitParams,
  selectedSections?: number[] | null,
): Promise<{ front: ManifoldMeshData; back: ManifoldMeshData; wedge: ManifoldMeshData | null }> {
  const backend = await getBackend()
  const result = await backend.splitDowel(mesh, {
    planeNormal,
    planeOriginOffset,
    planeCenter,
    widthDir,
    dowel,
    selectedSections,
  })
  return { front: result.front, back: result.back, wedge: result.wedge }
}

/**
 * Split a mesh by a plane and cut straight tenons via the current backend.
 * @param mesh                The mesh to split.
 * @param planeNormal         The cutting plane normal (unit vector).
 * @param planeOriginOffset   The cutting plane offset along the normal.
 * @param planeCenter         A point on the cutting plane.
 * @param widthDir            The width direction within the cutting plane (unit vector).
 * @param tenon               The straight-tenon split parameters.
 * @param selectedSections    Optional list of section indices to place tenons on.
 * @returns The front/back halves plus the wedge mesh (or null when no wedge).
 */
export async function computeStraightTenonSplit(
  mesh: ManifoldMeshData,
  planeNormal: [number, number, number],
  planeOriginOffset: number,
  planeCenter: [number, number, number],
  widthDir: [number, number, number],
  tenon: StraightTenonSplitParams,
  selectedSections?: number[] | null,
): Promise<{ front: ManifoldMeshData; back: ManifoldMeshData; wedge: ManifoldMeshData | null }> {
  const backend = await getBackend()
  const result = await backend.splitStraightTenon(mesh, {
    planeNormal,
    planeOriginOffset,
    planeCenter,
    widthDir,
    tenon,
    selectedSections,
  })
  return { front: result.front, back: result.back, wedge: result.wedge }
}

/**
 * Terminate the worker held by the backend, if any.
 * The InlineCsgBackend owns no worker to terminate; the WorkerCsgBackend
 * termination logic is managed by the browser host.
 */
export function terminateWorker(): void {
  // InlineCsgBackend has no worker to terminate
  // WorkerCsgBackend termination is managed by the browser host
}

// ── 纯函数重导出（从 geo-convert）──

export { geoToManifoldMesh, manifoldMeshToGeo } from './geo-convert'

// ── 类型重导出 ──

export type {
  ManifoldMeshData,
  BooleanOperation,
  DovetailGrooveParams,
  DowelSplitParams,
  StraightTenonSplitParams,
} from './geo-convert'
