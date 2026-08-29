/**
 * drill-types — 钻孔相关类型定义
 *
 * 从 stores/drill-store.ts 提取的纯类型，供 DrillHoleCore 使用。
 */

export type DrillHoleType = 'simple' | 'screw'
export type DrillDirection = 'normal' | 'x' | 'y' | 'z'
export type ScrewSystem = 'metric' | 'imperial'
export type ScrewThread = 'coarse' | 'fine' | 'none'
export type ScrewHead = 'none' | 'hex' | 'chc'

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
