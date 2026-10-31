/**
 * STEP AP242 PMI import — XCAF PMI entities → PmiSet
 *
 * @platform occt — XCAF PMI 读取是 occt-only 平台面。
 *
 * 当前状态：occt-wasm 5.6.0 的 `XCAFDocument` 接口不暴露 `XCAFDoc_DimTolTool`
 * 读取方法。本文件提供 PMI 读取框架，在实际 API 可用时通过 capability detection
 * 激活；API 不可用时返回 `undefined`（不创建空 PMI 集合）。
 *
 * 上游需求（设计文档 §6）：
 * - `XCAFDoc_DimTolTool::GetDimTols()`
 * - `STEPCAFControl_Reader::SetDimTolMode(true)` 读取 PMI
 *
 * 设计文档：docs/plans/2026-10-31-faijs-pmi-design.md §6
 */

import type { PmiSet, PmiItem, PmiDimension, PmiGdt, PmiDatum } from '../../api/pmi/types'
import type { TopoRef } from '../../topology/naming/types'

/**
 * XCAF Label → TopoRef 反向映射（由导入器建立）。
 *
 * 导入时遍历 XCAF label 的子形状（face），根据面的几何特征（surface type、
 * normal、area 等）合成 hint，并尝试匹配回 TopoRef 的 origin/role。
 *
 * 对于导入的 STEP 文件，origin/role 通常为 null（没有 faijs 语句上下文），
 * 此时 PMI 标注的 target 只保留 hint（几何兜底），身份字段为 null。
 */
export type LabelToTopoRefMap = Map<number, TopoRef>

/**
 * Check if the XCAF document supports PMI reading (DimTolTool).
 *
 * @param doc - the XCAF document (typed as unknown to avoid tight coupling).
 * @returns true if PMI reading is supported.
 */
export function supportsXcafPmiRead(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false
  const d = doc as Record<string, unknown>
  return typeof d.getDimensions === 'function'
    || typeof d.getGeomTolerances === 'function'
    || typeof d.getDatums === 'function'
}

/**
 * Read dimensions from XCAF document and convert to PmiDimension items.
 *
 * @param doc - the XCAF document (must support DimTolTool).
 * @param labelToTopoRef - XCAF label → TopoRef reverse mapping.
 * @returns array of PmiDimension items (may be empty).
 */
function readDimensions(
  doc: Record<string, (...args: unknown[]) => unknown>,
  labelToTopoRef: LabelToTopoRefMap,
): PmiDimension[] {
  const items: PmiDimension[] = []
  if (typeof doc.getDimensions !== 'function') return items

  const dims = doc.getDimensions() as ReadonlyArray<{
    label: number
    type: string
    nominal?: number
    upperTolerance?: number
    lowerTolerance?: number
    theoreticalExact?: boolean
    formatSpec?: string
  }>

  for (const dim of dims) {
    const target = labelToTopoRef.get(dim.label)
    if (!target) continue // Target face not found in mapping — skip

    items.push({
      kind: 'dimension',
      dimType: mapStepDimensionType(dim.type),
      targets: [target],
      nominal: dim.nominal,
      upperTolerance: dim.upperTolerance,
      lowerTolerance: dim.lowerTolerance,
      theoreticalExact: dim.theoreticalExact,
      formatSpec: dim.formatSpec,
    })
  }
  return items
}

/**
 * Read GD&T annotations from XCAF document and convert to PmiGdt items.
 *
 * @param doc - the XCAF document (must support DimTolTool).
 * @param labelToTopoRef - XCAF label → TopoRef reverse mapping.
 * @returns array of PmiGdt items (may be empty).
 */
function readGdts(
  doc: Record<string, (...args: unknown[]) => unknown>,
  labelToTopoRef: LabelToTopoRefMap,
): PmiGdt[] {
  const items: PmiGdt[] = []
  if (typeof doc.getGeomTolerances !== 'function') return items

  const tolerances = doc.getGeomTolerances() as ReadonlyArray<{
    label: number
    type: string
    tolerance: number
    toleranceZone?: string
    materialCondition?: string
    datums?: string[]
  }>

  for (const tol of tolerances) {
    const target = labelToTopoRef.get(tol.label)
    if (!target) continue

    items.push({
      kind: 'gdt',
      gdtType: mapStepGdtType(tol.type),
      target,
      tolerance: tol.tolerance,
      toleranceZone: tol.toleranceZone as PmiGdt['toleranceZone'],
      materialCondition: mapStepMaterialCondition(tol.materialCondition),
      datums: tol.datums,
    })
  }
  return items
}

/**
 * Read datums from XCAF document and convert to PmiDatum items.
 *
 * @param doc - the XCAF document (must support DimTolTool).
 * @param labelToTopoRef - XCAF label → TopoRef reverse mapping.
 * @returns array of PmiDatum items (may be empty).
 */
function readDatums(
  doc: Record<string, (...args: unknown[]) => unknown>,
  labelToTopoRef: LabelToTopoRefMap,
): PmiDatum[] {
  const items: PmiDatum[] = []
  if (typeof doc.getDatums !== 'function') return items

  const datums = doc.getDatums() as ReadonlyArray<{
    label: number
    identifier: string
    datumType?: string
  }>

  for (const d of datums) {
    const target = labelToTopoRef.get(d.label)
    if (!target) continue

    items.push({
      kind: 'datum',
      identifier: d.identifier,
      datumType: mapStepDatumType(d.datumType),
      target,
    })
  }
  return items
}

/**
 * Read PMI annotations from XCAF document.
 *
 * This is the main entry point for STEP AP242 PMI reading. It:
 * 1. Checks if the XCAF document supports PMI reading (DimTolTool).
 * 2. If supported, reads dimensions, GD&T, and datums.
 * 3. If not supported or no PMI found, returns undefined.
 *
 * @param doc - the XCAF document.
 * @param labelToTopoRef - XCAF label → TopoRef reverse mapping.
 * @returns PmiSet if PMI was found, undefined otherwise.
 */
export function readPmiFromXCAF(
  doc: unknown,
  labelToTopoRef: LabelToTopoRefMap,
): PmiSet | undefined {
  if (!supportsXcafPmiRead(doc)) return undefined

  const d = doc as Record<string, (...args: unknown[]) => unknown>
  const items: PmiItem[] = [
    ...readDimensions(d, labelToTopoRef),
    ...readGdts(d, labelToTopoRef),
    ...readDatums(d, labelToTopoRef),
  ]

  if (items.length === 0) return undefined

  return {
    items,
    meta: { source: 'step-ap242' },
  }
}

// ── STEP AP242 entity type → faijs PmiItem type mapping ──

/** Map STEP AP242 dimension type string to PmiDimensionType. */
function mapStepDimensionType(stepType: string): PmiDimension['dimType'] {
  const map: Record<string, PmiDimension['dimType']> = {
    'linear': 'linear',
    'linearX': 'linearX',
    'linearY': 'linearY',
    'linearZ': 'linearZ',
    'diameter': 'diameter',
    'radius': 'radius',
    'angle': 'angle',
    'angle3pt': 'angle3pt',
  }
  return map[stepType] ?? 'linear'
}

/** Map STEP AP242 GD&T type string to PmiGdtType. */
function mapStepGdtType(stepType: string): PmiGdt['gdtType'] {
  const map: Record<string, PmiGdt['gdtType']> = {
    'straightness': 'straightness',
    'flatness': 'flatness',
    'circularity': 'circularity',
    'cylindricity': 'cylindricity',
    'parallelism': 'parallelism',
    'perpendicularity': 'perpendicularity',
    'angularity': 'angularity',
    'position': 'position',
    'concentricity': 'concentricity',
    'symmetry': 'symmetry',
    'circularRunout': 'circularRunout',
    'totalRunout': 'totalRunout',
    'profileLine': 'profileLine',
    'profileSurface': 'profileSurface',
  }
  return map[stepType] ?? 'flatness'
}

/** Map STEP AP242 material condition string to PmiMaterialCondition. */
function mapStepMaterialCondition(mc?: string): PmiGdt['materialCondition'] {
  if (!mc) return null
  if (mc === 'MMC') return 'MMC'
  if (mc === 'LMC') return 'LMC'
  if (mc === 'RFS') return 'RFS'
  return null
}

/** Map STEP AP242 datum type string to PmiDatumType. */
function mapStepDatumType(dt?: string): PmiDatum['datumType'] {
  if (!dt) return 'datumPlane'
  const map: Record<string, PmiDatum['datumType']> = {
    'datumPlane': 'datumPlane',
    'datumAxis': 'datumAxis',
    'datumPoint': 'datumPoint',
    'datumTarget': 'datumTarget',
  }
  return map[dt] ?? 'datumPlane'
}
