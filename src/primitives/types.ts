/**
 * 标准 primitive 类型。
 * 注意：'box' 和 'cube' 是同义词——parser 用 'box'（cad.box()），
 * 内部 BREP 代码用 'cube'。两者都合法。
 */
export type PrimitiveType = 'cube' | 'box' | 'sphere' | 'cylinder' | 'cone' | 'wedge'

/** Generator 类型 */
export type GeneratorType = 'screw' | 'text'

/** 所有 primitive 类型 */
export type AnyPrimitiveType = PrimitiveType | GeneratorType

/** 标准 primitive 参数（联合类型，各类型各自参数） */
export type PrimitiveParams =
  | { size: number }
  | { radius: number; segments: number }
  | { radius: number; height: number; segments: number }

/** 基本体参数宽类型（用于持久化存储，按 type 读取对应字段） */
export type PrimitiveParamsRecord = Record<string, number>

/** 基本体参数 + center（用于脚本语句 args，center 为 [number, number, number]） */
export type PrimitiveArgsRecord = Record<string, number | number[]>

/** 基本体元信息，挂载在 LoadedFileModel.primitiveMeta 上 */
export interface PrimitiveMeta {
  type: PrimitiveType
  params: PrimitiveParamsRecord
}

/** 序列化的几何数据（用于 store 和 undo） */
export interface PrimitiveGeometryData {
  positions: Float32Array
  indices: Uint32Array
}

/** store 中存储的 Primitive 记录（不含 THREE.Mesh 引用，由 PrimitivesLayer 重建） */
export interface PrimitiveRecord {
  id: string
  type: AnyPrimitiveType
  name: string
  color: number       // hex 颜色
  params: Record<string, unknown>
  geometryData: PrimitiveGeometryData
  createdAt: number
}

/** Primitive 颜色循环（参照 NASSCAD 风格：亮色、高饱和、易区分） */
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
export function nextPrimitiveColor(): [number, number, number] {
  const color = PRIMITIVE_COLORS[_colorIndex % PRIMITIVE_COLORS.length]
  _colorIndex++
  return color
}
