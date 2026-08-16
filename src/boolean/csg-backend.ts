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

/** 浏览器 host 注入 CSG 后端（WorkerCsgBackend） */
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

export async function computeBoolean(
  meshes: ManifoldMeshData[],
  operation: BooleanOperation,
): Promise<ManifoldMeshData> {
  const backend = await getBackend()
  return backend.boolean(operation, meshes)
}

export async function computeSplit(
  mesh: ManifoldMeshData,
  normal: [number, number, number],
  offset: number,
): Promise<{ front: ManifoldMeshData; back: ManifoldMeshData }> {
  const backend = await getBackend()
  const result = await backend.splitPlane(mesh, { normal, offset })
  return { front: result.front, back: result.back }
}

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

export function terminateWorker(): void {
  // InlineCsgBackend 没有 worker 需要终止
  // WorkerCsgBackend 的 terminate 逻辑由浏览器 host 管理
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
