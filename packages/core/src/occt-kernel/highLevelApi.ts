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
  importAssemblyFromStep,
  collectLeafParts,
  releaseAssemblyTree,
  computeEffectiveDeflection,
} from './occtKernel'
import type { Shape } from '../mesh/types'
import { exportStepFromSolids } from '../brep/export/step'
import type { StepExportEntry } from '../brep/export/step'
import type {
  ShapeHandle,
  OcctKernel,
  WasmImportResult,
  WasmTessellatedMesh,
  Mesh,
  MeshDeflectionOptions,
} from './occtKernel'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'

// ── 导入 API ──

/** 单个 part 的导入结果（多 part STEP 导入时每个 part 一份） */
export interface ImportStepPartResult {
  /** 该 part 的 mesh（positions + indices） */
  shape: Shape
  /** OCCT solid 句柄（带 location，用于后续 BREP 操作或 STEP 导出） */
  solid: ShapeHandle
  /** part 名称（来自 XCAF label） */
  name: string
  /** part 颜色 [r,g,b] 0..1，无颜色为 null */
  color: [number, number, number] | null
}

/**
 * 高层：从 STEP 文件字节流导入多 part mesh + solid。
 *
 * 使用 XCAF 解析装配树，保留每个 part 的独立 mesh 和 solid。
 * 与 importStep 不同，不合并所有 mesh——每个 part 返回独立的 shape。
 *
 * @param bytes STEP 文件字节流
 * @returns 每个 part 的导入结果数组
 */
export async function importStepMultiPart(
  bytes: ArrayBuffer | Uint8Array,
): Promise<ImportStepPartResult[]> {
  const kernel = (await initOcctWasm()) as unknown as OcctKernel

  // XCAF 解析 → 装配树
  const nodes = await importAssemblyFromStep(bytes)
  const leaves = collectLeafParts(nodes)

  const results: ImportStepPartResult[] = []
  for (const leaf of leaves) {
    if (!leaf.shapeHandle) continue

    const eff = computeEffectiveDeflection(kernel as unknown as BrepEngineApi, leaf.shapeHandle as unknown as BrepHandle)
    const mesh = kernel.meshShape(leaf.shapeHandle, {
      linearDeflection: eff.linearDeflection,
      angularDeflection: eff.angularDeflection,
    })

    results.push({
      shape: {
        positions: mesh.positions,
        indices: mesh.indices,
      },
      solid: leaf.shapeHandle,
      name: leaf.name,
      color: leaf.color,
    })
  }

  // 释放装配树中非 leaf 的 shapeHandle（assembly 节点的已由 walkLabel 释放）
  // leaf 的 shapeHandle 由返回结果持有，调用方负责释放
  releaseAssemblyTree(kernel as unknown as BrepEngineApi, nodes.filter(n => n.isAssembly))

  return results
}

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

/**
 * 高层：多实体 STEP 导出（零 fuse）。
 *
 * 每个 entry 作为 STEP 中独立实体（独立 XCAF label / PRODUCT）导出，
 * 保留名称与颜色。多实体之间绝不 fuse。
 *
 * 封装了 ensureOcctKernel + exportStepFromSolids 的完整流程。
 * 宿主不需要再直接操作 OCCT kernel。
 *
 * @param entries parts to export; each becomes its own independent entity
 * @returns STEP file content as ArrayBuffer
 */
export async function exportStepFromSolidsHighLevel(
  entries: StepExportEntry[],
): Promise<ArrayBuffer> {
  const kernel = await ensureOcctKernel()
  return exportStepFromSolids(kernel as unknown as BrepEngineApi, entries)
}

// ── 管理函数 ──

/**
 * 高层：初始化 OCCT kernel。
 * 如果已初始化，返回缓存的实例。
 */
export async function ensureOcctKernel(): Promise<OcctKernel> {
  return initOcctWasm() as unknown as Promise<OcctKernel>
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
