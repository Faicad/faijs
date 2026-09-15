/**
 * index — fai_cq_warehouse 公共 API 入口（W8 汇总导出）
 *
 * 移植自 cq_warehouse（上游 0.8.0）的 6 个几何模块：
 * thread（5 类）/ nut（7 类）/ screw（12 类）/ washer（3 类）/ bearing（5 类）/ sprocket（1 类）。
 *
 * 约定（方案 §4.2，与 fai_cq_gears 同构）：
 * - 参数名逐字沿用 Python；构建函数返回 `Result`（kernel 阶段失败转 `err`）。
 * - `types()`/`sizes()` 类方法转 `nutTypes()`/`nutSizes()` 等函数式形态（params.ts）。
 * - `contractVersion` 语义见方案 §4.2.1：本包 API 形状 + 参数表来源 + STEP 输出
 *   形态的行为契约版本；与内核契约对齐（照 fai_cq_gears，勿硬编码）。
 * - `Chain`（P1-a）与孔系列（P1-b）未实现，见 Agent Note。
 */

export { contractVersion } from './contract'
export type { Result } from '@faicad/faijs-core'

// ── 参数表查询（types()/sizes()/select_by_size 等价面）────────────────────────
export {
  type ParamRow,
  type ParamTable,
  isolateFastenerType,
  typesOf,
  sizesOf,
  NUT_TABLES,
  SCREW_TABLES,
  WASHER_TABLES,
  BEARING_TABLES,
  type NutClassName,
  type ScrewClassName,
  type WasherClassName,
  type BearingClassName,
  nutTypes,
  nutSizes,
  screwTypes,
  screwSizes,
  bearingTypes,
  bearingSizes,
  washerTypes,
  washerSizes,
  clearanceHoleDiameters,
  tapHoleDiameters,
  selectBySize,
} from './params'

// ── 字符串度量解析 ────────────────────────────────────────────────────────────
export {
  INCH,
  metricStrToFloat,
  imperialStrToFloat,
  evalArithmetic,
  evaluateCell,
} from './measure'

// ── thread：Thread / IsoThread / AcmeThread / MetricTrapezoidalThread / PlasticBottleThread ──
export {
  type EndFinish,
  type Hand,
  type ThreadSpec,
  type ThreadResult,
  type IsoThreadParams,
  type TrapezoidalParams,
  type PlasticBottleThreadParams,
  ACME_PITCH,
  METRIC_TRAPEZOIDAL_SIZES,
  buildThread,
  isoThreadDimensions,
  isoThread,
  acmeThreadSizes,
  acmeThreadParseSize,
  acmeThread,
  metricTrapezoidalThreadSizes,
  metricTrapezoidalThreadParseSize,
  metricTrapezoidalThread,
  plasticBottleThreadDimensions,
  plasticBottleThread,
} from './thread'

// ── nut：7 类螺母 ─────────────────────────────────────────────────────────────
export {
  type NutParams,
  type NutResult,
  buildNut,
  hexNut,
  hexNutWithFlange,
  unchamferedHexagonNut,
  squareNut,
  domedCapNut,
  bradTeeNut,
  heatSetNut,
  polarArrayLocations,
} from './nut'

// ── screw：12 类螺钉 ──────────────────────────────────────────────────────────
export {
  type ScrewParams,
  type ScrewResult,
  SCREW_CLASSES,
  screwProfilePoints,
  buildScrew,
} from './screw'

// ── washer：3 类垫圈 ──────────────────────────────────────────────────────────
export {
  type WasherParams,
  type WasherResult,
  plainWasher,
  chamferedWasher,
  cheeseHeadWasher,
} from './washer'

// ── bearing：5 类轴承 ─────────────────────────────────────────────────────────
export {
  type BearingParams,
  type BearingResult,
  BEARING_CLASSES,
  buildBearing,
} from './bearing'

// ── sprocket：链轮（Chain 归 P1-a，未实现）────────────────────────────────────
export {
  type SprocketParams,
  type SprocketResult,
  buildSprocket,
  sprocketPitchRadius,
  sprocketCircumference,
} from './sprocket'
