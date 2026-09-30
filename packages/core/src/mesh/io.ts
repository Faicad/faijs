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
    // Merge every object instance into a single Shape (D1: multi-object stays
    // one editable part; see plan §8 decision 6). Coordinates are already in
    // faijs base units from parseThreemf.
    let totalPos = 0
    let totalIdx = 0
    for (const o of archive.objects) {
      totalPos += o.positions.length
      totalIdx += o.indices.length
    }
    const positions = new Float32Array(totalPos)
    const indices = new Uint32Array(totalIdx)
    let posAt = 0
    let idxAt = 0
    let baseV = 0
    for (const o of archive.objects) {
      positions.set(o.positions, posAt)
      posAt += o.positions.length
      for (let i = 0; i < o.indices.length; i++) indices[idxAt++] = o.indices[i] + baseV
      baseV += o.positions.length / 3
    }
    const shape: Shape = { positions, indices }
    return { shape, unit: archive.unit }
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
