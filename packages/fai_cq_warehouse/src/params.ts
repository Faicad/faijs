/**
 * params.ts — parameter-table query layer, mirroring cq_warehouse/fastener.py
 * (`read_fastener_parameters_from_csv` / `isolate_fastener_type` / `select_by_size_fn`
 * / `read_drill_sizes` / `lookup_drill_diameters` / `lookup_nominal_screw_lengths`).
 *
 * 数据来源：src/data/*.json（scripts/gen-data.ts 生成期求值，运行期零 eval）。
 * `isolate_fastener_type` 语义逐字对齐 fastener.py:144：拆 `type:dim`、
 * 按目标类型过滤、**过滤空串单元格**。
 */

import hexNutData from './data/hex_nut_parameters.json'
import hexNutWithFlangeData from './data/hex_nut_with_flange_parameters.json'
import unchamferedHexNutData from './data/unchamfered_hex_nut_parameters.json'
import squareNutData from './data/square_nut_parameters.json'
import domedCapNutData from './data/domed_cap_nut_parameters.json'
import bradTeeNutData from './data/brad_tee_nut_parameters.json'
import heatsetData from './data/heatset_nut_parameters.json'
import buttonHeadData from './data/button_head_parameters.json'
import buttonHeadWithCollarData from './data/button_head_with_collar_parameters.json'
import cheeseHeadData from './data/cheese_head_parameters.json'
import countersunkHeadData from './data/countersunk_head_parameters.json'
import hexHeadData from './data/hex_head_parameters.json'
import hexHeadWithFlangeData from './data/hex_head_with_flange_parameters.json'
import panHeadData from './data/pan_head_parameters.json'
import panHeadWithCollarData from './data/pan_head_with_collar_parameters.json'
import raisedCheeseHeadData from './data/raised_cheese_head_parameters.json'
import raisedCountersunkOvalHeadData from './data/raised_countersunk_oval_head_parameters.json'
import setscrewData from './data/setscrew_parameters.json'
import imperialSetscrewData from './data/imperial_set_screw_parameters.json'
import metricSetscrewData from './data/metric_set_screw_parameters.json'
import plainWasherData from './data/plain_washer_parameters.json'
import chamferedWasherData from './data/chamfered_washer_parameters.json'
import cheeseHeadWasherData from './data/cheese_head_washer_parameters.json'
import clearanceHoleSizes from './data/clearance_hole_sizes.json'
import tapHoleSizes from './data/tap_hole_sizes.json'
import drillSizesData from './data/drill_sizes.json'
import nominalScrewLengthsData from './data/nominal_screw_lengths.json'
import iso10664def from './data/iso10664def.json'
import deepGrooveData from './data/single_row_deep_groove_ball_bearing_parameters.json'
import cappedDeepGrooveData from './data/single_row_capped_deep_groove_ball_bearing_parameters.json'
import angularContactData from './data/single_row_angular_contact_ball_bearing_parameters.json'
import cylindricalRollerData from './data/single_row_cylindrical_roller_bearing_parameters.json'
import taperedRollerData from './data/single_row_tapered_roller_bearing_parameters.json'
import socketHeadCapJson from './data/socket_head_cap_parameters.json'
import { evaluateCell, imperialStrToFloat, INCH } from './measure'

/** Raw table row: column → evaluated value (number | string | '' for empty). */
export type ParamRow = Record<string, number | string>
/** size → `ParamRow` 的参数表（上游 `read_fastener_parameters_from_csv` 的返回形态）。 */
export type ParamTable = Record<string, ParamRow>

function asTable(json: unknown): ParamTable {
  return json as ParamTable
}

/**
 * fastener.py:144 `isolate_fastener_type` — split `type:dim`, filter by type, drop empty cells.
 * @param targetFastener - 目标紧固件类型（`type:dim` 的 `type` 段）。
 * @param fastenerData - 原始参数表（键为 `type:dim`）。
 * @returns 只含目标类型、且维度名已剥离 `type:` 前缀的参数表（空行被丢弃）。
 */
export function isolateFastenerType(
  targetFastener: string,
  fastenerData: ParamTable,
): ParamTable {
  const result: ParamTable = {}
  for (const [size, parameters] of Object.entries(fastenerData)) {
    const dimensionDict: ParamRow = {}
    for (const [typeDimension, value] of Object.entries(parameters)) {
      const sep = typeDimension.indexOf(':')
      if (sep < 0) continue
      // fastener.py:148 — `.strip().split(":")`：两段都 strip
      const fastenerName = typeDimension.slice(0, sep).trim()
      const dimension = typeDimension.slice(sep + 1).trim()
      if (fastenerName === targetFastener && value !== '')
        dimensionDict[dimension] = value
    }
    if (Object.keys(dimensionDict).length > 0) result[size] = dimensionDict
  }
  return result
}

/**
 * fastener.py:484 `types()` — the set of `type:dim` prefixes of the table's first row.
 * @param data - 原始参数表。
 * @returns 首行出现过的类型前缀（去重，保持出现顺序）；空表返回 `[]`。
 */
export function typesOf(data: ParamTable): string[] {
  const first = Object.values(data)[0]
  if (!first) return []
  return [...new Set(Object.keys(first).map((p) => p.split(':')[0]!.trim()))]
}

/**
 * fastener.py:489 `sizes()` — sizes that have a non-empty row for the given type.
 * @param fastenerType - 目标紧固件类型。
 * @param data - 原始参数表。
 * @returns 该类型下存在非空行的尺寸列表。
 */
export function sizesOf(fastenerType: string, data: ParamTable): string[] {
  return Object.keys(isolateFastenerType(fastenerType, data))
}

// ── 螺母 7 类 ──────────────────────────────────────────────────────────────
/** 螺母族 7 张上游参数表（类名 → 表；类名取自上游 `__subclasses__` 实测清单）。 */
export const NUT_TABLES = {
  DomedCapNut: asTable(domedCapNutData),
  BradTeeNut: asTable(bradTeeNutData),
  HeatSetNut: asTable(heatsetData),
  HexNut: asTable(hexNutData),
  HexNutWithFlange: asTable(hexNutWithFlangeData),
  UnchamferedHexagonNut: asTable(unchamferedHexNutData),
  SquareNut: asTable(squareNutData),
} as const
/** 螺母类名（`NUT_TABLES` 的键）。 */
export type NutClassName = keyof typeof NUT_TABLES

// ── 螺钉 12 类 ─────────────────────────────────────────────────────────────
/** 螺钉族 12 张上游参数表（类名 → 表）。 */
export const SCREW_TABLES = {
  ButtonHeadScrew: asTable(buttonHeadData),
  ButtonHeadWithCollarScrew: asTable(buttonHeadWithCollarData),
  CheeseHeadScrew: asTable(cheeseHeadData),
  CounterSunkScrew: asTable(countersunkHeadData),
  HexHeadScrew: asTable(hexHeadData),
  HexHeadWithFlangeScrew: asTable(hexHeadWithFlangeData),
  PanHeadScrew: asTable(panHeadData),
  PanHeadWithCollarScrew: asTable(panHeadWithCollarData),
  RaisedCheeseHeadScrew: asTable(raisedCheeseHeadData),
  RaisedCounterSunkOvalHeadScrew: asTable(raisedCountersunkOvalHeadData),
  SetScrew: asTable(setscrewData),
  SocketHeadCapScrew: asTable(socketHeadCapJson),
} as const
/** 螺钉类名（`SCREW_TABLES` 的键）。 */
export type ScrewClassName = keyof typeof SCREW_TABLES

// ── 垫圈 3 类 ──────────────────────────────────────────────────────────────
/** 垫圈族 3 张上游参数表（类名 → 表）。 */
export const WASHER_TABLES = {
  PlainWasher: asTable(plainWasherData),
  ChamferedWasher: asTable(chamferedWasherData),
  CheeseHeadWasher: asTable(cheeseHeadWasherData),
} as const
/** 垫圈类名（`WASHER_TABLES` 的键）。 */
export type WasherClassName = keyof typeof WASHER_TABLES

// ── 轴承 5 类 ──────────────────────────────────────────────────────────────
/** 轴承族 5 张上游参数表（类名 → 表）。 */
export const BEARING_TABLES = {
  SingleRowDeepGrooveBallBearing: asTable(deepGrooveData),
  SingleRowCappedDeepGrooveBallBearing: asTable(cappedDeepGrooveData),
  SingleRowAngularContactBallBearing: asTable(angularContactData),
  SingleRowCylindricalRollerBearing: asTable(cylindricalRollerData),
  SingleRowTaperedRollerBearing: asTable(taperedRollerData),
} as const
/** 轴承类名（`BEARING_TABLES` 的键）。 */
export type BearingClassName = keyof typeof BEARING_TABLES

// ── 工艺表（fastener.py:158/168/190 的运行期等价）───────────────────────────
/**
 * fastener.py:158 `read_drill_sizes` — drill designation → diameter (mm).
 * @returns 钻头代号（如 `#2` / `F` / `1/16`）到直径 mm 的映射；非数值直径抛错。
 */
export function readDrillSizes(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, row] of Object.entries(asTable(drillSizesData))) {
    const d = row['Diameter']
    if (typeof d !== 'number')
      throw new Error(`drill_sizes: non-numeric diameter for ${key}`)
    out[key] = d
  }
  return out
}

function lookupDrillDiameters(
  holeSizes: Record<string, ParamRow>,
): Record<string, Record<string, number>> {
  // fastener.py:168 `lookup_drill_diameters` — resolve drill refs; fallback to
  // direct parse (metric float / imperial fraction) when the key misses.
  const drillSizes = readDrillSizes()
  const out: Record<string, Record<string, number>> = {}
  for (const [size, drillData] of Object.entries(holeSizes)) {
    const holeData: Record<string, number> = {}
    for (const [fit, drill] of Object.entries(drillData)) {
      const ref = String(drill).trim()
      const direct = drillSizes[ref]
      if (direct !== undefined) {
        holeData[fit] = direct
      } else if (size.startsWith('M')) {
        // fastener.py:176 — metric fallback is a plain float()
        const v = Number(ref)
        if (!Number.isFinite(v))
          throw new Error(`drill ref ${JSON.stringify(ref)} for size ${size} is not resolvable`)
        holeData[fit] = v
      } else {
        // imperial fallback is imperial_str_to_float (fraction → mm)
        const v = imperialStrToFloat(ref)
        if (typeof v !== 'number')
          throw new Error(`drill ref ${JSON.stringify(ref)} for size ${size} is not resolvable`)
        holeData[fit] = v
      }
    }
    out[size] = holeData
  }
  return out
}

/** Nut/Screw/Washer/Bearing 共用的 clearance hole 表（fastener.py:399 + :168）。 */
export const clearanceHoleDrillSizes: Record<string, ParamRow> =
  asTable(clearanceHoleSizes)
/** clearance hole 解析后的 `size → {fit → mm}`（钻头引用已在生成期解析）。 */
export const clearanceHoleData: Record<string, Record<string, number>> =
  lookupDrillDiameters(clearanceHoleDrillSizes)

/** tap hole 表（Soft/Hard，fastener.py:405 + :168）。 */
export const tapHoleDrillSizes: Record<string, ParamRow> = asTable(tapHoleSizes)
/** tap hole 解析后的 `size → {Soft/Hard → mm}`。 */
export const tapHoleData: Record<string, Record<string, number>> =
  lookupDrillDiameters(tapHoleDrillSizes)

/**
 * fastener.py:190 `lookup_nominal_screw_lengths` — screw type → nominal lengths (mm).
 * @returns 螺钉类型到公称长度数组（mm）的映射，按表内 `Unit` 列换算。
 */
export function readNominalScrewLengths(): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const [type, row] of Object.entries(asTable(nominalScrewLengthsData))) {
    const unit = String(row['Unit'])
    const factor = unit === 'mm' ? 1 : INCH
    out[type] = String(row['Nominal_Sizes'])
      .split(',')
      .map((s) => factor * Number(s.trim()))
  }
  return out
}

/** fastener.py:275 `hexalobular_recess` — iso10664def 表（A/B/Re，公制）。 */
export const iso10664Def: ParamTable = asTable(iso10664def)

/** imperial_set_screw / metric_set_screw（上游零引用，保留数据供查）。 */
export const unreferencedTables = {
  imperial_set_screw_parameters: asTable(imperialSetscrewData),
  metric_set_screw_parameters: asTable(metricSetscrewData),
} as const

/** 上游统一的 per-cell 求值入口（TS 侧仅用于运行期兜底解析，如 drill 分数回退）。 */
export { evaluateCell, imperialStrToFloat }

// ── 公共查询 API（方案 §4.2：类方法 → 前缀函数）─────────────────────────────

/**
 * Nut.types() — 螺母类型列表。
 * @returns HexNut 表中出现的螺母类型（去重）。
 */
export function nutTypes(): string[] {
  return typesOf(asTable(hexNutData))
}

/**
 * Nut.sizes(fastener_type) — 指定类型的螺母尺寸列表。
 * @param fastenerType - 螺母类型。
 * @returns 该类型下的尺寸列表。
 */
export function nutSizes(fastenerType: string): string[] {
  return sizesOf(fastenerType, asTable(hexNutData))
}

/**
 * Screw.types() — 指定螺钉类别的类型列表。
 * @param className - 螺钉类名（`SCREW_TABLES` 的键）。
 * @returns 该表首行出现的类型（去重）。
 */
export function screwTypes(className: ScrewClassName): string[] {
  return typesOf(SCREW_TABLES[className])
}

/**
 * Screw.sizes(fastener_type) — 指定螺钉类别下的尺寸列表。
 * @param className - 螺钉类名。
 * @param fastenerType - 螺钉类型。
 * @returns 该类型下的尺寸列表。
 */
export function screwSizes(className: ScrewClassName, fastenerType: string): string[] {
  return sizesOf(fastenerType, SCREW_TABLES[className])
}

/**
 * Bearing.types() — 指定轴承类别的类型列表。
 * @param className - 轴承类名（`BEARING_TABLES` 的键）。
 * @returns 该表首行出现的类型（去重）。
 */
export function bearingTypes(className: BearingClassName): string[] {
  return typesOf(BEARING_TABLES[className])
}

/**
 * Bearing.sizes(bearing_type) — 指定轴承类别下的尺寸列表。
 * @param className - 轴承类名。
 * @param bearingType - 轴承类型。
 * @returns 该类型下的尺寸列表。
 */
export function bearingSizes(className: BearingClassName, bearingType: string): string[] {
  return sizesOf(bearingType, BEARING_TABLES[className])
}

/**
 * Washer.types() — 指定垫圈类别的类型列表。
 * @param className - 垫圈类名（`WASHER_TABLES` 的键）。
 * @returns 该表首行出现的类型（去重）。
 */
export function washerTypes(className: WasherClassName): string[] {
  return typesOf(WASHER_TABLES[className])
}

/**
 * Washer.sizes(fastener_type) — 指定垫圈类别下的尺寸列表。
 * @param className - 垫圈类名。
 * @param fastenerType - 垫圈类型。
 * @returns 该类型下的尺寸列表。
 */
export function washerSizes(className: WasherClassName, fastenerType: string): string[] {
  return sizesOf(fastenerType, WASHER_TABLES[className])
}

/**
 * Nut.clearance_hole_diameters — size → {Close/Normal/Loose → mm}。
 * @param size - 螺纹规格（如 `M3`）。
 * @returns 各配合等级的间隙孔直径（mm）；无该规格数据时抛错。
 */
export function clearanceHoleDiameters(size: string): Record<string, number> {
  const row = clearanceHoleData[size]
  if (!row) throw new Error(`no clearance hole data for size ${size}`)
  return row
}

/**
 * Nut.tap_hole_diameters — size → {Soft/Hard → mm}。
 * @param size - 螺纹规格（如 `M3`）。
 * @returns 软/硬材料的攻丝底孔直径（mm）；无该规格数据时抛错。
 */
export function tapHoleDiameters(size: string): Record<string, number> {
  const row = tapHoleData[size]
  if (!row) throw new Error(`no tap hole data for size ${size}`)
  return row
}

/**
 * fastener.py:346 `select_by_size_fn` — size → {class: [type, …]}。
 * Python 侧遍历 `__subclasses__`；TS 侧显式枚举（与 §2.7 实测清单一致）。
 * @param size - 目标规格。
 * @returns 该规格下 `{类名 → [类型, …]}`；无匹配类时不出现该键。
 */
export function selectBySize(size: string): Record<string, string[]> {
  const families: Record<string, ParamTable>[] = [
    NUT_TABLES,
    SCREW_TABLES,
    WASHER_TABLES,
    BEARING_TABLES,
  ]
  const result: Record<string, string[]> = {}
  for (const family of families) {
    for (const [className, table] of Object.entries(family)) {
      for (const fastenerType of typesOf(table)) {
        if (size in isolateFastenerType(fastenerType, table)) {
          ;(result[className] ??= []).push(fastenerType)
        }
      }
    }
  }
  return result
}
