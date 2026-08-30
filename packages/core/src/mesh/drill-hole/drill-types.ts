/**
 * drill-types — 钻孔相关类型定义
 *
 * 从 stores/drill-store.ts 提取的纯类型，供 DrillHoleCore 使用。
 */

export type DrillHoleType = 'simple' | 'screw'
/** Reference axis for the drill direction: along the face normal or an axis-aligned direction. */
export type DrillDirection = 'normal' | 'x' | 'y' | 'z'

/** Thread standard used to dimension screw holes: metric or imperial. */
export type ScrewSystem = 'metric' | 'imperial'

/** Thread pitch variant for a screw hole. */
export type ScrewThread = 'coarse' | 'fine' | 'none'

/** Head (countersink) style for a screw hole. */
export type ScrewHead = 'none' | 'hex' | 'chc'

/**
 * Full parameter set describing a drill-hole operation, including the hole
 * type (simple or screw), geometry, depth, direction, tolerance, and the
 * screw-specific fields used by the screw variant.
 */
export interface DrillHoleParams {
  diameter: number
  depth: number
  holeType: DrillHoleType
  direction: DrillDirection
  tolerance: number
  snapEnabled: boolean
  screwSystem: ScrewSystem
  screwSpecIdx: number
  screwThread: ScrewThread
  screwPitchCustom: number
  screwLength: number
  screwHead: ScrewHead
}
