/**
 * Standard primitive types.
 * Note: 'box' and 'cube' are synonyms — the parser uses 'box' (cad.box()),
 * while the internal BREP code uses 'cube'. Both are valid.
 */
export type PrimitiveType = 'cube' | 'box' | 'sphere' | 'cylinder' | 'cone' | 'wedge'

/** Generator type. */
export type GeneratorType = 'screw' | 'text'

/** Union of all primitive and generator types. */
export type AnyPrimitiveType = PrimitiveType | GeneratorType

/** Standard primitive parameter unions (each shape matches its type). */
export type PrimitiveParams =
  | { size: number }
  | { radius: number; segments: number }
  | { radius: number; height: number; segments: number }

/** Loose primitive parameter record (for persisted storage; read the relevant fields by type). */
export type PrimitiveParamsRecord = Record<string, number>

/** Primitive parameters plus a center (used for script statement args; center is [number, number, number]). */
export type PrimitiveArgsRecord = Record<string, number | number[]>

/** Primitive metadata, attached to LoadedFileModel.primitiveMeta. */
export interface PrimitiveMeta {
  type: PrimitiveType
  params: PrimitiveParamsRecord
}

/** Serialized geometry data (used by the store and undo). */
export interface PrimitiveGeometryData {
  positions: Float32Array
  indices: Uint32Array
}

/** A Primitive record stored in the store (no THREE.Mesh reference; rebuilt by PrimitivesLayer). */
export interface PrimitiveRecord {
  id: string
  type: AnyPrimitiveType
  name: string
  color: number       // hex 颜色
  params: Record<string, unknown>
  geometryData: PrimitiveGeometryData
  createdAt: number
}

/** Primitive colour cycle (NASSCAD-style: bright, high-saturation, easily distinguishable). */
export const PRIMITIVE_COLORS: [number, number, number][] = [
  [0.85, 0.25, 0.20],   // 红色
  [0.20, 0.60, 0.85],   // 蓝色
  [0.20, 0.75, 0.30],   // 绿色
  [1.00, 0.70, 0.10],   // 橙色
  [0.60, 0.30, 0.80],   // 紫色
  [0.00, 0.75, 0.75],   // 青色
  [0.95, 0.50, 0.75],   // 粉色
  [0.50, 0.50, 0.50],   // 灰色
]

let _colorIndex = 0
/**
 * Return the next colour from the PRIMITIVE_COLORS cycle.
 *
 * Cycles through the palette in order, wrapping around at the end.
 *
 * @returns the next [r, g, b] colour in the palette.
 */
export function nextPrimitiveColor(): [number, number, number] {
  const color = PRIMITIVE_COLORS[_colorIndex % PRIMITIVE_COLORS.length]
  _colorIndex++
  return color
}
