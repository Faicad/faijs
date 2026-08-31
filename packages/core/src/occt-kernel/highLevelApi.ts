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

/** Result of importing a single part from a multi-part STEP file. */
export interface ImportStepPartResult {
  /** The part's mesh (positions + indices). */
  shape: Shape
  /** OCCT solid handle (with location, for later BREP operations or STEP export). */
  solid: ShapeHandle
  /** Part name (from the XCAF label). */
  name: string
  /** Part color [r,g,b] in 0..1, or null when there is no color. */
  color: [number, number, number] | null
}

/**
 * High-level: import multi-part mesh + solid from a STEP file byte stream.
 *
 * Uses XCAF assembly-tree parsing, keeping each part's mesh and solid independent.
 * Unlike importStep, this does not merge meshes — each part returns its own shape.
 *
 * @param bytes - STEP file byte stream
 * @returns an array of per-part import results
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

/** Result of importing a STEP/BREP file. */
export interface ImportStepResult {
  /** The merged mesh (all parts' positions/indices combined). */
  shape: Shape
  /** Each part's mesh (for topology building). */
  meshes: WasmTessellatedMesh[]
  /** OCCT solid handle (for later BREP operations or STEP export). */
  solid: ShapeHandle
  /** Face-group information (for topology building). */
  meshWithGroups: Mesh
}

/**
 * High-level: import mesh + solid from a STEP/BREP file byte stream.
 *
 * Wraps the full importStepToMesh/importBrepToMesh + mesh merge flow.
 * Hosts no longer need to operate the OCCT kernel directly.
 *
 * @param bytes - STEP/BREP file byte stream
 * @param format - the file format: 'step' | 'brep'
 * @param options - optional mesh deflection options
 * @returns the import result
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

/** Options for exporting mesh data to a STEP string. */
export interface ExportStepOptions {
  /** Sewing tolerance. */
  tolerance?: number
}

/**
 * High-level: export mesh data as a STEP string.
 *
 * Wraps the full meshesToStep flow. Hosts no longer need to operate the OCCT kernel directly.
 *
 * @param shape - mesh data (positions + indices)
 * @param options - optional export options (sewing tolerance)
 * @returns the STEP file text content
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
 * High-level: release an OCCT solid handle.
 *
 * Wraps the full releaseShape flow.
 *
 * @param solid - the solid handle to release
 */
export function releaseSolid(solid: ShapeHandle): void {
  releaseShape(solid)
}

/**
 * High-level: multi-solid STEP export (zero fuse).
 *
 * Each entry is exported as an independent entity in the STEP (independent XCAF
 * label / PRODUCT), preserving name and color. Multiple solids are never fused.
 *
 * Wraps the full ensureOcctKernel + exportStepFromSolids flow.
 * Hosts no longer need to operate the OCCT kernel directly.
 *
 * @param entries - parts to export; each becomes its own independent entity
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
 * High-level: initialize the OCCT kernel.
 * Returns the cached instance if already initialized.
 *
 * @returns the initialized OCCT kernel
 */
export async function ensureOcctKernel(): Promise<OcctKernel> {
  return initOcctWasm() as unknown as Promise<OcctKernel>
}

/**
 * High-level: dispose the OCCT kernel.
 * Call when unloading the page or releasing WASM memory.
 */
export function disposeOcct(): void {
  disposeOcctWasm()
}

// Re-export 底层类型供高层 API 用户使用
export type { OcctKernel, ShapeHandle, WasmTessellatedMesh, Mesh, MeshDeflectionOptions }
