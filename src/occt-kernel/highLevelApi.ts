/**
 * OCCT 高层 API — E12.2
 *
 * 宿主不应再直接 import 底层 OCCT kernel 函数（initOcctWasm/importStepToMesh/meshesToStep 等），
 * 而是使用这些高层 API。
 *
 * 高层 API 封装了初始化、导入、导出的完整流程，
 * 返回标准化的 Shape / 拓扑数据 / STEP 字节流。
 */

import {
  initOcctWasm,
  disposeOcctWasm,
  importStepToMesh,
  importBrepToMesh,
  meshesToStep,
  releaseShape,
} from './occtKernel'
import type { Shape } from '../ops/types'
import type {
  ShapeHandle,
  OcctKernel,
  WasmImportResult,
  WasmTessellatedMesh,
  Mesh,
  MeshDeflectionOptions,
} from './occtKernel'

// ── 导入 API ──

export interface ImportStepResult {
  /** 合并后的 mesh（所有 part 的 positions/indices 合并） */
  shape: Shape
  /** 每个 part 的 mesh（用于拓扑构建） */
  meshes: WasmTessellatedMesh[]
  /** OCCT solid 句柄（用于后续 BREP 操作或 STEP 导出） */
  solid: ShapeHandle
  /** 面组信息（用于拓扑构建） */
  meshWithGroups: Mesh
}

/**
 * 高层：从 STEP/BREP 文件字节流导入 mesh + solid。
 *
 * 封装了 importStepToMesh/importBrepToMesh + 合并 mesh 的完整流程。
 * 宿主不需要再直接操作 OCCT kernel。
 *
 * @param bytes STEP/BREP 文件字节流
 * @param format 文件格式：'step' | 'brep'
 * @param options 可选参数
 * @returns ImportStepResult
 */
export async function importStep(
  bytes: ArrayBuffer | Uint8Array | string,
  format: 'step' | 'brep' = 'step',
  options?: MeshDeflectionOptions,
): Promise<ImportStepResult> {
  const result: WasmImportResult = format === 'brep'
    ? await importBrepToMesh(bytes as string, options)
    : await importStepToMesh(bytes as ArrayBuffer | Uint8Array, options)

  // 合并所有 mesh 的 positions/indices
  let totalPositions = 0
  let totalIndices = 0
  for (const mesh of result.meshes) {
    totalPositions += mesh.positions.length
    totalIndices += mesh.indices.length
  }

  const positions = new Float32Array(totalPositions)
  const indices = new Uint32Array(totalIndices)
  let posOffset = 0
  let idxOffset = 0
  let idxBase = 0
  for (const mesh of result.meshes) {
    positions.set(mesh.positions, posOffset)
    posOffset += mesh.positions.length
    // 需要偏移索引
    for (let i = 0; i < mesh.indices.length; i++) {
      indices[idxOffset + i] = mesh.indices[i] + idxBase
    }
    idxOffset += mesh.indices.length
    idxBase += mesh.positions.length / 3
  }

  return {
    shape: { positions, indices },
    meshes: result.meshes,
    solid: result.shapeHandle,
    meshWithGroups: result.meshWithGroups,
  }
}

// ── 导出 API ──

export interface ExportStepOptions {
  /** 缝合容差 */
  tolerance?: number
}

/**
 * 高层：将 mesh 数据导出为 STEP 字符串。
 *
 * 封装了 meshesToStep 的完整流程。
 * 宿主不需要再直接操作 OCCT kernel。
 *
 * @param shape mesh 数据（positions + indices）
 * @param options 可选参数
 * @returns STEP 文件文本内容
 */
export function exportStep(
  shape: Shape,
  options?: ExportStepOptions,
): string {
  return meshesToStep(
    shape.positions,
    shape.indices,
    options?.tolerance ?? 0.01,
  )
}

/**
 * 高层：释放 OCCT solid 句柄。
 *
 * 封装了 releaseShape 的完整流程。
 */
export function releaseSolid(solid: ShapeHandle): void {
  releaseShape(solid)
}

// ── 管理函数 ──

/**
 * 高层：初始化 OCCT kernel。
 * 如果已初始化，返回缓存的实例。
 */
export async function ensureOcctKernel(): Promise<OcctKernel> {
  return initOcctWasm()
}

/**
 * 高层：释放 OCCT kernel。
 * 在页面卸载或需要释放 WASM 内存时调用。
 */
export function disposeOcct(): void {
  disposeOcctWasm()
}

// Re-export 底层类型供高层 API 用户使用
export type { OcctKernel, ShapeHandle, WasmTessellatedMesh, Mesh, MeshDeflectionOptions }
