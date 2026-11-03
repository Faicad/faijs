/**
 * drill-types — 钻孔相关类型定义
 *
 * 从 stores/drill-store.ts 提取的纯类型，供 DrillHoleCore 使用。
 */

export type DrillHoleType = 'simple' | 'screw' | 'tapped'
/** Reference axis for the drill direction: along the face normal or an axis-aligned direction. */
export type DrillDirection = 'normal' | 'x' | 'y' | 'z'

/**
 * Thread standard used to dimension screw holes: metric, imperial, or 55°
 * tapered pipe (PT/R/BSPT).
 *
 * `'pipe'` is only meaningful for `holeType:'tapped'` (geometry = pilot hole,
 * thread goes to PMI). The modeled-screw path (`holeType:'screw'`) rejects it —
 * a 1:16 tapered tooth profile is not implemented, and the screw generator
 * looks specs up in the metric/imperial tables only.
 */
export type ScrewSystem = 'metric' | 'imperial' | 'pipe'

/** Thread pitch variant for a screw hole. */
export type ScrewThread = 'coarse' | 'fine' | 'none'

/** Head (countersink) style for a screw hole. */
export type ScrewHead = 'none' | 'hex' | 'chc'

/**
 * Full parameter set describing a drill-hole operation, including the hole
 * type (simple / screw / tapped), geometry, depth, direction, tolerance, and
 * the screw-specific fields used by the screw variant.
 *
 * 三种孔的语义（勿混）：
 * - `simple`：光孔，圆柱；
 * - `screw`：**建模螺纹**——几何里真的切出螺旋牙；
 * - `tapped`：**攻丝孔**——几何只有底孔，螺纹由 PMI 标注（`PmiThreadHole`）。
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
  /** 有效螺纹深度（mm）。0 或缺省 = 与底孔同深。仅 `tapped` / `screw` 使用（标注用）。 */
  threadDepth?: number
  /** 螺纹公差等级（如 '6H'）。仅标注用，不参与几何。 */
  threadClass?: string
}
