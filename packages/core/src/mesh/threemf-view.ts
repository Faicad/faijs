/**
 * threemf-view — Bambu view-mode deltas (moved up from 3d_editor's
 * `viewTransforms.ts`, plan §8 decision 2).
 *
 * Bambu stores per-object transforms for three view modes:
 *   print    — the build `<item transform>` (pose on the plate).
 *   assembly — an extra `<assemble_item transform>` + offset (assembled pose).
 *   import   — a per-part 4×4 `matrix` in `model_settings.config` (import pose).
 *
 * To carry a mesh that already has M_build baked in (from `parseThreemf`) to the
 * target pose we need
 *   delta = M_target × M_build⁻¹   (component-level transforms cancel).
 *
 * Matrices are `THREE.Matrix4` — core already depends on three as a peer dep
 * (io.ts imports THREE.BufferAttribute, brep imports occt-wasm) and the host
 * resolves it. This module is only reachable from the web display path
 * (`@faicad/faijs/mesh/threemf-view`); the weapp bundle never imports it.
 */
import * as THREE from 'three'
import type { Bambu3mfMetadata } from './threemf-bambu'

/** Bambu view layout: the pose a part carries on the plate / assembled / import. */
export type ViewMode = 'print' | 'assembly' | 'import'

/** Narrowed part identity the view layer keys on (host passes its PartInfo). */
export interface ViewPartInfo {
  objectId?: string
  scopedId?: string
}

type ViewMetadata = Pick<
  Bambu3mfMetadata,
  'buildItems' | 'assembleTransforms' | 'importTransforms'
>

/** Convert a 12-value 4×3 column-major transform (3MF §3.5.1) to THREE.Matrix4.
 *
 *  Per 3MF spec (Section 3.5.1) the 12 values are column-major:
 *    Col 0: [v0,v1,v2], Col 1: [v3,v4,v5], Col 2: [v6,v7,v8],
 *    Col 3: [v9,v10,v11] (translation).
 *  THREE.Matrix4.set() takes row-major args, so we transpose.
 *
 * @param v - the 12 column-major transform values (3MF §3.5.1).
 * @returns the equivalent column-major 4×4 THREE.Matrix4.
 */
export function mat4From12Values(v: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    v[0], v[3], v[6], v[9],
    v[1], v[4], v[7], v[10],
    v[2], v[5], v[8], v[11],
    0, 0, 0, 1,
  )
}

/** Convert a 16-value 4×4 row-major array to THREE.Matrix4.
 *
 * @param v - the 16 row-major matrix values.
 * @returns the equivalent THREE.Matrix4.
 */
export function mat4From16Values(v: number[]): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    v[0], v[1], v[2], v[3],
    v[4], v[5], v[6], v[7],
    v[8], v[9], v[10], v[11],
    v[12], v[13], v[14], v[15],
  )
}

/** Create a translation-only matrix.
 *
 * @param t - the translation [x, y, z].
 * @returns the 4×4 translation matrix.
 */
export function makeTranslationMatrix(t: [number, number, number]): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(t[0], t[1], t[2])
}

/**
 * Compute the delta matrix to transform a mesh from print-view to the target
 * view: delta = M_target × M_build⁻¹. Returns null when the target view has no
 * data for this object (the caller leaves the mesh as-is).
 *
 * @param viewMode - the target view ('print' | 'assembly' | 'import').
 * @param bambuMeta - Bambu build/assemble/import transform lookups.
 * @param partInfo - the part's objectId/scopedId used to key into `bambuMeta`.
 * @returns the delta matrix, or null when the target view has no data for the part.
 */
export function computeViewDelta(
  viewMode: ViewMode,
  bambuMeta: ViewMetadata,
  partInfo: ViewPartInfo,
): THREE.Matrix4 | null {
  const objectId = partInfo.objectId
  if (!objectId) return null

  const buildItem = bambuMeta.buildItems?.find(b => b.objectId === objectId)
  if (!buildItem?.transform) return null
  const buildMatrix = mat4From12Values(buildItem.transform)

  if (viewMode === 'assembly') {
    const assembleItem = bambuMeta.assembleTransforms?.get(objectId)
    if (!assembleItem) return null
    const assembleMatrix = mat4From12Values(assembleItem.transform)
    return assembleMatrix.multiply(buildMatrix.clone().invert())
  }

  if (viewMode === 'import') {
    const scopedId = partInfo.scopedId ?? '0'
    const importItem = bambuMeta.importTransforms?.get(`${objectId}:${scopedId}`)
    if (!importItem) return null
    const importMatrix = mat4From16Values(importItem.matrix)
    importMatrix.multiply(makeTranslationMatrix(importItem.sourceOffset))
    return importMatrix.multiply(buildMatrix.clone().invert())
  }

  return null
}

/** Whether a view mode is available for a given bambu metadata object.
 *
 * @param viewMode - the target view ('print' | 'assembly' | 'import').
 * @param bambuMeta - Bambu assemble/import transform lookups.
 * @returns true when `viewMode` has data available (print always does).
 */
export function hasViewData(
  viewMode: ViewMode,
  bambuMeta: Pick<Bambu3mfMetadata, 'assembleTransforms' | 'importTransforms'>,
): boolean {
  if (viewMode === 'print') return true
  if (viewMode === 'assembly') return (bambuMeta.assembleTransforms?.size ?? 0) > 0
  if (viewMode === 'import') return (bambuMeta.importTransforms?.size ?? 0) > 0
  return false
}