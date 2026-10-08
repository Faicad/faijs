/**
 * mesh IO API — headless 文件加载
 *
 * STL 由 core 自持的 `mesh/stl-loader.ts` 解析（零 three addons）；3MF 由
 * `mesh/threemf-loader.ts` 解析（ZIP 解压 + XML，单位换算到 mm 基准）。
 * 坐标永远以 faijs 基准长度单位（mm）存储 — Shape 不贴 unit 标签（D3）。
 *
 * 单位换算边界（unit-system §5.2）：
 * - 本模块只处理 **mesh 格式（STL/3MF）**，坐标可直接折算 → `opts.unit` 提供即
 *   **强制设置模型的源单位**（直接指定，覆盖/忽略模型内部记录的单位——STL 无
 *   内部单位、3MF `<model unit>` 声明被覆盖），按 `unitScale(unit)` 折算坐标。
 *   它**只可能来自调用方的显式知识**（脚本作者手写 `cad.load({ file, unit })`、
 *   或宿主让用户选定单位后传入）；调用方不知道单位时**必须省略**——省略时：
 *   STL 走 faijs 启发式（`guessStlUnit`，unified 方案 §6.1/§8 —— 3d_editor
 *   迁移回归的单位断言依赖此行为）、3MF 走文件 `<model unit>`（无声明 →
 *   millimeter）。猜测/折算收敛在 faijs 内（红线 R0：宿主不自实现单位换算），
 *   G0 = 折算后坐标，渲染 = 拓扑 = G0。
 * - **STEP/.brep 不经过本模块**（走 BREP 链，load op 内 OCCT 读取）：OCCT 按
 *   文件内部单位声明折算（SI_UNIT），**不支持强制设置单位**——load op 对
 *   BREP 路径 + 用户显式 unit 直接**明确报错**（不缩放、不 workaround）。
 * - 3MF `<model unit>` 由解析器读取并换算（micron/mm/cm/inch/foot/meter）。
 *
 * 返回契约（unit-system §10.6）：`importFile` 返回 `{ shape, unit }` — `unit`
 * 是文件源单位（必然有值；faijs 是单一真源）：3MF 取 opts.unit（强制）或文件
 * 声明（无声明 → millimeter），STL 取 opts.unit 或 guessStlUnit 启发式猜测。
 * 坐标恒为基准值 — `unit` 只作元数据（sourceUnit 记录、导出目标判定），绝不
 * 参与几何缩放（读入折算已由解析器完成，二次缩放 = 双重换算）。
 */

import * as THREE from 'three'
import { geoToManifoldMesh } from '../boolean/geo-convert'
import { parseStl } from './stl-loader'
import { parseThreemf, type ThreemfObject } from './threemf-loader'
import { parseBambu3mfFromEntries } from './threemf-bambu'
import { unitScale, type UnitName } from '../units'
import { guessStlUnit } from './stl-unit'
import type { Shape } from './types'
import type { PbrAppearance } from '../api/appearance'
import type { FileMeta } from '../api/meta'
import type { ImportModel } from './import-model'

/** Result of a unit-aware file import. */
export interface ImportFileResult {
  shape: Shape
  /**
   * All parts the file declared, in declaration order (3MF `<build><item>` 序 /
   * STL 单零件)。`shape` is `parts[0]`（单零件兼容，过渡期）。
   * P0（2026-10-06-step-3mf-multipart-import-plan.md §5.4）：多对象 3MF 不再折叠。
   */
  parts: Shape[]
  /**
   * The file's source unit (always present; faijs is the single source of truth).
   * 3MF: opts.unit (forced) if provided, else the file's declared unit
   * (无声明 → millimeter). STL: opts.unit (forced) if provided, else the
   * guessStlUnit heuristic result. STEP/BREP 不经过本模块（OCCT 链不支持
   * 强制设置单位，load op 报错）。
   * Metadata only — coordinates are already in the faijs base unit (mm).
   */
  unit: UnitName
  /**
   * Total parts the single file declared (e.g. 3MF `<build>` object count),
   * present only when > 1. Single-part mesh (STL, single-object 3MF) omits it.
   * 保留为 `parts.length`（>1 时）；多零件不再折叠后该字段仅供旧宿主判断。
   */
  multiPartCount?: number
  /**
   * 整体级元数据（文件级；方案 §5.1 3MF `<model><metadata>`）。STL/STEP 视实现
   * 是否解析；无声明则省略。仅随导入结果上抛，不挂 Shape。
   */
  fileMeta?: FileMeta
  /**
   * 本次导入的结构数据（P0 §5.1）：零件身份表 + Bambu 视图（3MF 分支填充）。
   * 单/多零件均登记（单零件 parts 长度 1）。
   */
  importModel?: ImportModel
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
 *   (defaults to 'stl'). **仅 mesh 格式（STL/3MF）走本模块**；STEP/BREP 走
 *   BREP 链（load op 内 OCCT 读取，不支持强制设置单位）。
 * @param opts - optional settings; `unit` (a UnitName string) **force-sets the
 *   model's source unit** (STL/3MF): it is NOT a default, it directly specifies
 *   the unit and overrides/ignores any unit recorded inside the model (3MF
 *   `<model unit>`; STL has none), geometry scaled by `unitScale(unit)`. Only
 *   provide it when the caller actually knows the unit (author-written
 *   `cad.load({ file, unit })`, or a host unit picker). When the caller does
 *   NOT know the unit, it MUST omit `unit` — STL then guesses via
 *   `guessStlUnit` (the only allowed guessing path), 3MF uses the file
 *   declaration (none → millimeter). A wrong explicit unit scales geometry
 *   wrongly and is never re-guessed.
 * @returns the shape with base-unit coordinates plus the file's source unit
 *   (`unit`, metadata only; always present — faijs is the single source of truth).
 */
export async function importFile(
  buffer: ArrayBuffer,
  format?: string,
  opts?: { unit?: UnitName },
): Promise<ImportFileResult> {
  const fmt = (format ?? 'stl').toLowerCase()

  if (fmt === '3mf' || fmt === 'threemf') {
    const archive = await parseThreemf(buffer, opts)
    // P0（方案 §5.4）：不再折叠——返回全部 `<build><item>` 对象（declaration order，
    // 坐标已在 parseThreemf 里折算为 faijs 基准单位）。`shape` 保留为 parts[0]
    // （单零件兼容，过渡期）。
    if (archive.objects.length === 0) {
      throw new Error('[mesh/io] 3MF contains no objects')
    }
    // Bambu 元数据（盘号/挤出机/视图变换）：有 Bambu 配置才产生内容，普通 3MF 返回空表。
    // P4：根 model XML 直传（3MF `<build>` 在 resources 前；id 两套编号经父
    // object components 关联——leafParts 表承载）。
    const bambu = parseBambu3mfFromEntries(archive.extraEntries, archive.modelXml)
    const parts = archive.objects.map(threemfObjectToShape)
    const multiPartCount = parts.length > 1 ? parts.length : undefined
    const importModel: ImportModel = {
      format: '3mf',
      unit: archive.unit,
      parts: archive.objects.map((obj, i) => {
        const part: ImportModel['parts'][number] = {
          index: i,
          name: obj.name ?? `imported:${i}`,
        }
        if (obj.baseColor) part.color = [obj.baseColor[0], obj.baseColor[1], obj.baseColor[2]]
        if (obj.meta) part.meta = obj.meta
        // Bambu 身份：3MF `<object id>`（叶子实例）与 Bambu objects 表（键为
        // model_settings 父对象 id）是两套编号——经父 object components 关联
        // （ThreemfObject.parentObjectId/componentIndex → bambu.leafParts）。
        const bm = obj.parentObjectId !== undefined
          ? bambu.leafParts.get(`${obj.parentObjectId}:${obj.componentIndex ?? 1}`)
          : undefined
        if (bm) {
          part.objectId = bm.objectId
          if (bm.plateId > 0) part.plateId = bm.plateId
          // Bambu extruder 1-based（默认 1）：显式登记文件声明值
          part.extruder = bm.extruder
          part.partId = bm.partId
        }
        return part
      }),
      ...(archive.fileMeta ? { fileMeta: archive.fileMeta } : {}),
    }
    const bambuViews = buildBambuViews(bambu)
    if (bambuViews) importModel.bambuViews = bambuViews
    return {
      shape: parts[0],
      parts,
      unit: archive.unit,
      multiPartCount,
      importModel,
      // 整体级元数据（`<model><metadata>`）随导入结果上抛（方案 §5.1）。
      ...(archive.fileMeta ? { fileMeta: archive.fileMeta } : {}),
    }
  }

  if (fmt === 'stl') {
    const geo = parseStl(buffer)
    // STL 无单位声明：opts.unit 显式声明优先；未声明时做启发式猜测
    // （guessStlUnit —— 历史 host 行为，unified §6.1/§8 迁移基线）。猜测与
    // 折算都在 faijs 内完成（红线 R0），G0 即基准值，宿主不再二次换算。
    // unit 字段回传源单位（声明值或猜测值），供宿主记录 sourceUnit 元数据。
    let scale = 1
    let sourceUnit: UnitName = 'mm'
    const declared = opts?.unit
    if (declared) {
      sourceUnit = declared
      scale = unitScale(declared)
    } else {
      geo.computeBoundingBox()
      const bb = geo.boundingBox
      if (bb) {
        sourceUnit = guessStlUnit({
          min: [bb.min.x, bb.min.y, bb.min.z],
          max: [bb.max.x, bb.max.y, bb.max.z],
        })
        scale = unitScale(sourceUnit)
      }
    }
    if (scale !== 1) {
      const attr = geo.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      for (let i = 0; i < arr.length; i++) arr[i] *= scale
    }
    const shape = geoToManifoldMesh(geo)
    return { shape, parts: [shape], unit: sourceUnit }
  }

  // STEP goes through the BREP chain (loadBrep → OCCT, which normalizes to the
  // base unit on read). The mesh io path has no kernel-independent STEP parser
  // and must not fake one — a missing path is an error, not a fallback.
  throw new Error(`[mesh/io] unsupported format: ${fmt}`)
}

/** 单个 3MF `<build><item>` 对象 → Shape（P0：逐对象构造，替换原"只取第一个"收敛）。 */
function threemfObjectToShape(obj: ThreemfObject): Shape {
  return {
    positions: obj.positions as Float32Array,
    indices: obj.indices as Uint32Array,
    // P2（方案 §5 3MF 行）：对象级 baseColor → appearance.color（sRGB 原值，
    // 宽容兼容：无 baseColor 不带 appearance）。colorgroup（vertexColors）与
    // 逐三角形材质属 Phase 2（materialGroups / vertexColors），P2 不映射。
    ...(obj.baseColor ? { appearance: { color: [obj.baseColor[0], obj.baseColor[1], obj.baseColor[2]] } } : {}),
    // P4（方案 §5 3MF 行）：逐三角形 basematerials（p1=p2=p3）→ materialGroups
    // （三角形区间 + appearance.color）；无则不带。vertexColors（colorgroup）
    // 由上层（编辑器导入路径）消费，io 单零件收敛不展开为材质分组。
    ...(obj.materialGroups && obj.materialGroups.length > 0
      ? {
          materialGroups: obj.materialGroups.map((g) => ({
            start: g.start,
            count: g.count,
            appearance: { color: [g.color[0], g.color[1], g.color[2]] } as PbrAppearance,
          })),
        }
      : {}),
    // 零件级元数据（方案 §5.1 3MF 行）：对象 name/partnumber/metadatagroup → meta。
    ...(obj.meta ? { meta: obj.meta } : {}),
  }
}

/** Bambu 显示视图数据 → ImportModel.bambuViews（无任何 Bambu 结构时省略）。 */
function buildBambuViews(
  bambu: import('./threemf-bambu').Bambu3mfMetadata,
): ImportModel['bambuViews'] | undefined {
  const plates = [...bambu.plates.keys()].sort((a, b) => a - b)
  if (plates.length === 0 && !bambu.assembleTransforms && !bambu.importTransforms) return undefined
  const views: NonNullable<ImportModel['bambuViews']> = { plates }
  if (bambu.assembleTransforms) {
    views.assembleTransforms = Object.fromEntries(
      [...bambu.assembleTransforms].map(([k, v]) => [k, { transform: v.transform, offset: v.offset }]),
    )
  }
  if (bambu.importTransforms) {
    views.importTransforms = Object.fromEntries(
      [...bambu.importTransforms].map(([k, v]) => [k, { matrix: v.matrix, sourceOffset: v.sourceOffset }]),
    )
  }
  // P4：完整消费面随结果回传——宿主重建 Bambu3mfMetadata 不再回读 archive。
  if (bambu.buildItems) {
    views.buildItems = bambu.buildItems.map((b) => ({
      objectId: b.objectId,
      transform: b.transform ?? null,
    }))
  }
  if (bambu.filamentColors.length > 0) views.filamentColors = bambu.filamentColors
  if (bambu.filamentTypes.length > 0) views.filamentTypes = bambu.filamentTypes
  if (bambu.parts.length > 0) {
    views.parts = bambu.parts.map((p) => ({
      partIndex: p.partIndex,
      objectId: p.objectId,
      partId: p.partId,
      name: p.name,
      extruder: p.extruder,
      plateId: p.plateId,
    }))
  }
  return views
}
