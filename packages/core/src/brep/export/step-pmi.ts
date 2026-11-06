/**
 * STEP AP242 PMI export — PmiSet → XCAF PMI entities
 *
 * @platform occt — XCAF PMI 写入是 occt-only 平台面。
 *
 * 当前状态：occt-wasm 5.6.0 的 `XCAFDocument` 接口不暴露 `XCAFDoc_DimTolTool`。
 * 本文件提供 PMI → XCAF 的写入框架，在实际 API 可用时通过 capability detection
 * 激活；API 不可用时 PMI 数据仍随 StepExportEntry 传递（不丢失），只是不写进
 * STEP 文件的 PMI 实体——此时 mesh 链路的 PMI 通过 3MF metadata 传递（§5.5）。
 *
 * 上游需求（设计文档 §12.5）：
 * - `XCAFDoc_DimTolTool::SetDimension(label, ...)`
 * - `XCAFDoc_DimTolTool::SetGeomTolerance(label, ...)`
 * - `XCAFDoc_DimTolTool::SetDatum(label, ...)`
 * - `XCAFDoc_DimTolTool::GetDimTols()`
 * - `STEPCAFControl_Reader::SetDimTolMode(true)` 读取 PMI
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-design.md §5
 */

import type { BrepEngineApi } from '../engine/primitives'
import type { BrepHandle } from '../engine/types'
import type { PmiSet, PmiItem, PmiDimension, PmiGdt, PmiDatum } from '../../api/pmi/types'
import type { FaceTopoRef } from '../../topology/naming/types'

/**
 * XCAF Label tag type (opaque; matches occt-wasm LabelTag).
 * Used as the mapping target for TopoRef → XCAF label association.
 */
export type XcafLabel = number

/**
 * TopoRef → XCAF Label 映射表。
 *
 * 导出时由 `buildTopoRefToLabelMap` 建立：遍历 solid 的子形状（face），
 * 与 Shape 的命名表（RoleTable）比对，为每个有 origin+role 的面建立映射。
 *
 * 映射失败的面（mesh 无血统、无 roleTable）不出现在映射表中——
 * 对应的 PMI 标注无法写入 XCAF PMI 实体（静默跳过，不抛错）。
 */
export type TopoRefToLabelMap = Map<string, XcafLabel>

/**
 * Serialize a FaceTopoRef into a stable map key.
 * Uses `origin + ':' + role` (the identity coordinates).
 */
function topoRefKey(ref: FaceTopoRef): string {
  return `${ref.origin}:${ref.role}`
}

/**
 * Build a TopoRef → XCAF Label mapping for a solid's faces.
 *
 * Walks the solid's sub-shapes (faces), reads the RoleTable to find each face's
 * `(origin, role)` identity, and maps it to the XCAF label that `doc.addShape`
 * returned.
 *
 * **Note**: This function requires the kernel to provide `getSubShapes` and
 * the shape to have a RoleTable. Mesh-chain shapes (no BREP) will produce an
 * empty map.
 *
 * @param kernel - the BREP kernel (occt-wasm).
 * @param solid - the BREP solid handle.
 * @param roleTable - the shape's role table (origin → role → face hashes).
 * @param faceLabels - the XCAF labels created by `doc.addShape` for each face
 *   (in the same order as `kernel.getSubShapes(solid, 'face')`).
 * @returns a map from `origin:role` key → XCAF label.
 */
export function buildTopoRefToLabelMap(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  roleTable: unknown,
  faceLabels: XcafLabel[],
): TopoRefToLabelMap {
  const map: TopoRefToLabelMap = new Map()
  if (!roleTable) return map

  // The role table is ReadonlyMap<StmtId, ReadonlyMap<string, readonly number[]>>
  // where the inner number[] is the list of face hash values (1-based ordinals).
  // We need to build: hash → (origin, role) and then match with face ordinals.
  const table = roleTable as ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>

  // Build a reverse map: faceHash (as number) → {origin, role}
  const hashToRole: Map<number, { origin: string; role: string }> = new Map()
  for (const [origin, roles] of table) {
    for (const [role, hashes] of roles) {
      for (const hash of hashes) {
        hashToRole.set(hash, { origin, role })
      }
    }
  }

  // Walk faces and match by hash
  const faces = kernel.getSubShapes(solid, 'face')
  for (let i = 0; i < faces.length; i++) {
    const faceHandle = faces[i]
    // The face's hash is typically its ordinal in the face evolution table.
    // We use (i+1) as the 1-based ordinal to match the naming system.
    const ordinal = i + 1
    const identity = hashToRole.get(ordinal)
    if (identity) {
      const key = `${identity.origin}:${identity.role}`
      const label = faceLabels[i]
      if (label !== undefined) {
        map.set(key, label)
      }
    }
    // Release sub-shape handles (they are owned by the parent solid in OCCT)
    try {
      if (faceHandle !== solid) kernel.release(faceHandle)
    } catch {
      // already released or owned by parent
    }
  }

  return map
}

/**
 * Check if the XCAF document supports PMI writing (DimTolTool).
 *
 * This is a capability check — when occt-wasm adds `XCAFDoc_DimTolTool` bindings
 * to the `XCAFDocument` interface, this function will detect it and return true.
 *
 * @param doc - the XCAF document (typed as unknown to avoid tight coupling).
 * @returns true if PMI writing is supported.
 */
export function supportsXcafPmi(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false
  const d = doc as Record<string, unknown>
  return typeof d.setDimension === 'function'
    || typeof d.setGeomTolerance === 'function'
    || typeof d.setDatum === 'function'
}

/**
 * Write a single PmiDimension to the XCAF document.
 *
 * Maps to STEP AP242 `DIMENSIONAL_SIZE` + `PLUS_MINUS_VALUE_RANGE`.
 *
 * @param doc - the XCAF document (must support DimTolTool).
 * @param dim - the dimension to write.
 * @param faceLabelMap - TopoRef → XCAF label mapping.
 */
function writeDimension(
  doc: Record<string, (...args: unknown[]) => unknown>,
  dim: PmiDimension,
  faceLabelMap: TopoRefToLabelMap,
): void {
  // Resolve the first target face label
  if (!dim.targets || dim.targets.length === 0) return
  const target = dim.targets[0]
  if (target.kind !== 'face') return // Only face targets supported for now

  const key = topoRefKey(target)
  const label = faceLabelMap.get(key)
  if (label === undefined) return // Target face not found in mapping — skip silently

  // Call XCAFDoc_DimTolTool::SetDimension (when available)
  if (typeof doc.setDimension === 'function') {
    doc.setDimension(label, {
      type: dim.dimType,
      nominal: dim.nominal,
      upperTolerance: dim.upperTolerance,
      lowerTolerance: dim.lowerTolerance,
      theoreticalExact: dim.theoreticalExact,
      formatSpec: dim.formatSpec,
    })
  }
}

/**
 * Write a single PmiGdt (feature control frame) to the XCAF document.
 *
 * Maps to STEP AP242 `GEOMETRIC_TOLERANCE` + subtype.
 *
 * @param doc - the XCAF document (must support DimTolTool).
 * @param gdt - the GD&T annotation to write.
 * @param faceLabelMap - TopoRef → XCAF label mapping.
 */
function writeGdt(
  doc: Record<string, (...args: unknown[]) => unknown>,
  gdt: PmiGdt,
  faceLabelMap: TopoRefToLabelMap,
): void {
  if (gdt.target.kind !== 'face') return
  const key = topoRefKey(gdt.target)
  const label = faceLabelMap.get(key)
  if (label === undefined) return

  if (typeof doc.setGeomTolerance === 'function') {
    doc.setGeomTolerance(label, {
      type: gdt.gdtType,
      tolerance: gdt.tolerance,
      toleranceZone: gdt.toleranceZone,
      materialCondition: gdt.materialCondition,
      datums: gdt.datums,
    })
  }
}

/**
 * Write a single PmiDatum to the XCAF document.
 *
 * Maps to STEP AP242 `DATUM_FEATURE`.
 *
 * @param doc - the XCAF document (must support DimTolTool).
 * @param datum - the datum to write.
 * @param faceLabelMap - TopoRef → XCAF label mapping.
 */
function writeDatum(
  doc: Record<string, (...args: unknown[]) => unknown>,
  datum: PmiDatum,
  faceLabelMap: TopoRefToLabelMap,
): void {
  if (datum.target.kind !== 'face') return
  const key = topoRefKey(datum.target)
  const label = faceLabelMap.get(key)
  if (label === undefined) return

  if (typeof doc.setDatum === 'function') {
    doc.setDatum(label, {
      identifier: datum.identifier,
      datumType: datum.datumType,
    })
  }
}

/**
 * Write a PmiSet to the XCAF document (attached to the specified labels).
 *
 * This is the main entry point for STEP AP242 PMI writing. It:
 * 1. Checks if the XCAF document supports PMI (DimTolTool).
 * 2. If supported, iterates over PMI items and writes them.
 * 3. If not supported, returns without writing (PMI data is preserved in
 *    the StepExportEntry but not written to STEP entities).
 *
 * @param doc - the XCAF document.
 * @param pmi - the PMI set to write.
 * @param faceLabelMap - TopoRef → XCAF label mapping.
 * @returns the number of PMI items written (0 if unsupported or empty).
 */
export function writePmiToXCAF(
  doc: unknown,
  pmi: PmiSet,
  faceLabelMap: TopoRefToLabelMap,
): number {
  if (!pmi || !pmi.items || pmi.items.length === 0) return 0
  if (!supportsXcafPmi(doc)) return 0

  const d = doc as Record<string, (...args: unknown[]) => unknown>
  let written = 0
  for (const item of pmi.items as readonly PmiItem[]) {
    switch (item.kind) {
      case 'dimension':
        writeDimension(d, item, faceLabelMap)
        written++
        break
      case 'gdt':
        writeGdt(d, item, faceLabelMap)
        written++
        break
      case 'datum':
        writeDatum(d, item, faceLabelMap)
        written++
        break
      case 'surfaceFinish':
        // Surface finish → write as UDA (user defined attribute) or skip.
        // AP242 has `SURFACE_TEXTURE` entity but occt-wasm doesn't expose it yet.
        // Silently skip for now; data preserved in PmiSet.
        break
      case 'note':
        // Notes → write as UDA or skip. Not a standard AP242 PMI entity.
        // Silently skip for now; data preserved in PmiSet.
        break
      case 'techNote':
        // Part-level numbered technical requirements are not an AP242 PMI
        // entity either. Silently skip; data preserved in PmiSet.
        break
      case 'threadHole':
        // Tapped-hole callouts (M6-6H / pilot hole) have no AP242 PMI entity in
        // occt-wasm (design doc §1.2 #5: no thread_aspect / setThreadAspect API).
        // Silently skip; the PmiThreadHole stays in PmiSet and reaches 3MF
        // metadata via the mesh chain. Explicit branch so this switch covers all
        // seven PmiItemKind values — a new kind must not disappear silently.
        break
    }
  }
  return written
}

/**
 * Determine the STEP AP version for export.
 *
 * When PMI is present, the export should use AP242 Edition 2+ to enable
 * semantic PMI entities. Without PMI, the default AP version is used.
 *
 * @param pmi - the PMI set (if any).
 * @returns 'AP242' if PMI is present, undefined otherwise (use default).
 */
export function stepApVersionForPmi(pmi?: PmiSet): 'AP242' | undefined {
  if (!pmi || !pmi.items || pmi.items.length === 0) return undefined
  // Check if any item requires semantic PMI (dimension/gdt/datum)
  const hasSemantic = pmi.items.some(
    (item) => item.kind === 'dimension' || item.kind === 'gdt' || item.kind === 'datum',
  )
  return hasSemantic ? 'AP242' : undefined
}

/**
 * Upgrade STEP FILE_SCHEMA to AP242 when PMI is present.
 *
 * Text-layer post-processing: replaces the `FILE_SCHEMA` entity in the STEP
 * header with `AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303
 * 442 }` when `stepApVersionForPmi` returns `'AP242'`. Only touches the header
 * declaration — never modifies DATA section geometry.
 *
 * @param stepText - the raw STEP text from `doc.exportSTEP()`.
 * @param pmi - the PMI set (if any).
 * @returns the STEP text with `FILE_SCHEMA` upgraded to AP242, or the original
 *   text if no PMI or PMI doesn't require semantic entities.
 */
export function upgradeStepSchemaForPmi(stepText: string, pmi?: PmiSet): string {
  if (stepApVersionForPmi(pmi) !== 'AP242') return stepText
  // FILE_SCHEMA(( 'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 }' ));
  const schema = `'AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 }'`
  const re = /FILE_SCHEMA\s*\(\s*\(([^)]*)\)\s*\)\s*;/i
  if (!re.test(stepText)) return stepText
  return stepText.replace(re, `FILE_SCHEMA((${schema}));`)
}
