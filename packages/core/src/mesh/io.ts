/**
 * mesh IO API — headless 文件加载
 *
 * STL 由 core 自持的 `mesh/stl-loader.ts` 解析（零 three addons）；3MF 由
 * `mesh/threemf-loader.ts` 解析（ZIP 解压 + XML，单位换算到 mm 基准）。
 * 坐标永远以 faijs 基准长度单位（mm）存储 — Shape 不贴 unit 标签（D3）。
 *
 * 单位换算边界（unit-system §5.2）：
 * - STL 无单位元数据 → 由 `opts.unit` 显式声明，缺省 mm，不做启发式猜测。
 * - 3MF `<model unit>` 由解析器读取并换算（micron/mm/cm/inch/foot/meter）。
 *
 * 返回契约（unit-system §10.6）：`importFile` 返回 `{ shape, unit }` — `unit`
 * 是文件**自己声明的单位**（3MF `<model unit>`、STEP 单位实体），无声明格式
 * （STL）为 null（此时 `opts.unit` 决定刻度）。坐标恒为基准值 — `unit` 只作
 * 元数据（sourceUnit 记录、导出目标判定），绝不参与几何缩放（读入折算已由
 * 内核/解析器完成，二次缩放 = 双重换算）。
 */

import * as THREE from 'three'
import { geoToManifoldMesh } from '../boolean/geo-convert'
import { parseStl } from './stl-loader'
import { parseThreemf } from './threemf-loader'
import { mm, type UnitName, type ValueWithUnits } from '../units'
import type { Shape } from './types'

/** Result of a unit-aware file import. */
export interface ImportFileResult {
  shape: Shape
  /**
   * The unit the file itself declares (3MF `<model unit>`, STEP unit entities).
   * null for declaration-less formats (STL) — the caller's opts.unit decided.
   */
  unit: UnitName | null
  /**
   * Total parts the single file declared (e.g. 3MF `<build>` object count),
   * present only when > 1. Single-part mesh (STL, single-object 3MF) omits it.
   * When set, `shape` is only the FIRST part's geometry (feijs `load` op is
   * single-part; the file was downgraded to its first part — §5.4).
   */
  multiPartCount?: number
}

/** SI prefixes that may precede .METRE. in a STEP SI_UNIT, → faijs UnitName. */
const SI_PREFIX_TO_UNIT: Record<string, UnitName> = {
  '.MILLI.': 'mm',
  '.CENTI.': 'cm',
  '$': 'm',
}

/** CONVERSION_BASED_UNIT names (uppercased) found in real-world STEP files. */
const CONVERSION_NAME_TO_UNIT: Record<string, UnitName> = {
  'METRE': 'm',
  'METER': 'm',
  'MILLIMETRE': 'mm',
  'MILLIMETER': 'mm',
  'CENTIMETRE': 'cm',
  'CENTIMETER': 'cm',
  'MICROMETRE': 'micron',
  'MICROMETER': 'micron',
  'INCH': 'inch',
  'FOOT': 'foot',
}

/**
 * Bounded scan window for `detectStepUnit`. Unit entities sit at the front of
 * the DATA section (right after the product/context blocks); 256 KiB covers
 * every real-world header+context preamble observed so far. Recomputable
 * constant — raise if a fixture ever misses.
 */
export const STEP_UNIT_SCAN_PREFIX = 256 * 1024

/**
 * Parse the declared length unit from STEP text (unit-system §10.4).
 *
 * Unit entities live in the DATA section (not HEADER — ISO 10303-21 reserves
 * HEADER for FILE_DESCRIPTION/FILE_NAME/FILE_SCHEMA), near its start. We scan
 * a bounded prefix; the justification is "unit entities sit at the front of
 * the DATA section", not "top of file".
 *
 * Recognized forms, both attached to a LENGTH_UNIT():
 * - `SI_UNIT(<prefix>, .METRE.)` — prefix `.MILLI.`/`.CENTI.`/`.MICRO.` or `$`.
 * - `CONVERSION_BASED_UNIT('<NAME>', #n)` — inch/foot/etc.
 *
 * Metadata only — NEVER used to scale geometry (OCCT already normalizes on
 * read; re-scaling = double conversion).
 *
 * @param stepText - the full STEP file text to scan (only a bounded prefix is read).
 * @returns the faijs UnitName, or null when no length-unit declaration is found
 *   (STEP permits omitting it; caller falls back to the base unit).
 */
export function detectStepUnit(stepText: string): UnitName | null {
  const head = stepText.slice(0, STEP_UNIT_SCAN_PREFIX)

  // 1) CONVERSION_BASED_UNIT('<NAME>', #n) — non-SI units (inch/foot/…).
  const conv = head.match(/CONVERSION_BASED_UNIT\s*\(\s*'([^']+)'/i)
  if (conv) {
    const mapped = CONVERSION_NAME_TO_UNIT[conv[1].toUpperCase()]
    if (mapped) return mapped
  }

  // 2) SI_UNIT(<prefix>, .METRE.) — the .METRE. guard excludes angle entities
  //    (they carry .RADIAN./.STERADIAN., never .METRE.).
  const si = head.match(/SI_UNIT\s*\(\s*([^)]*?)\s*,\s*\.METRE\.\s*\)/i)
  if (si) {
    const prefix = si[1].trim().toUpperCase()
    if (prefix === '.MICRO.') return 'micron'
    const mapped = SI_PREFIX_TO_UNIT[prefix]
    if (mapped) return mapped
  }

  return null
}

/**
 * Load geometry from raw file bytes (headless variant).
 *
 * @param buffer - the raw file bytes to parse (already decompressed; stpz
 *   unzipping is the caller's job — faijs never unzips implicitly).
 * @param format - format identifier such as 'stl', '3mf'/'threemf' or 'step'
 *   (defaults to 'stl').
 * @param opts - optional settings; `unit` declares the source unit for
 *   formats without unit metadata (e.g. STL). Defaults to mm.
 * @returns the shape with base-unit coordinates plus the file's own declared
 *   unit (`unit`, metadata only; null when the format has no declaration).
 */
export async function importFile(
  buffer: ArrayBuffer,
  format?: string,
  opts?: { unit?: ValueWithUnits },
): Promise<ImportFileResult> {
  const fmt = (format ?? 'stl').toLowerCase()

  if (fmt === '3mf' || fmt === 'threemf') {
    const archive = await parseThreemf(buffer)
    // §5.4 单零件收敛：只取**第一个**对象实例（declaration order — `<build><item>`
    // 序，见 threemf-loader）构造成单一 part；多对象文件记 multiPartCount 供上层
    // 登记"多零件降级"警告。坐标已在 parseThreemf 里折算为 faijs 基准单位。
    const first = archive.objects[0]
    if (!first) {
      throw new Error('[mesh/io] 3MF contains no objects')
    }
    const multiPartCount = archive.objects.length > 1 ? archive.objects.length : undefined
    const shape: Shape = {
      positions: first.positions as Float32Array,
      indices: first.indices as Uint32Array,
      // P2（方案 §5 3MF 行）：对象级 baseColor → appearance.color（sRGB 原值，
      // 宽容兼容：无 baseColor 不带 appearance）。colorgroup（vertexColors）与
      // 逐三角形材质属 Phase 2（materialGroups / vertexColors），P2 不映射。
      ...(first.baseColor ? { appearance: { color: [first.baseColor[0], first.baseColor[1], first.baseColor[2]] } } : {}),
    }
    return { shape, unit: archive.unit, multiPartCount }
  }

  if (fmt === 'stl') {
    const scale = (opts?.unit ?? mm).as(mm)
    const geo = parseStl(buffer)
    if (scale !== 1) {
      const attr = geo.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      for (let i = 0; i < arr.length; i++) arr[i] *= scale
    }
    return { shape: geoToManifoldMesh(geo), unit: null }
  }

  // STEP goes through the BREP chain (loadBrep → OCCT, which normalizes to the
  // base unit on read). The mesh io path has no kernel-independent STEP parser
  // and must not fake one — a missing path is an error, not a fallback.
  throw new Error(`[mesh/io] unsupported format: ${fmt}`)
}
