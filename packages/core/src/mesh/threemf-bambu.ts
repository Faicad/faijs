/**
 * threemf-bambu — Bambu Lab private 3MF extensions (moved up from 3d_editor,
 * plan §8 decision 2).
 *
 * Bambu Studio stores non-standard metadata in:
 *   - `Metadata/project_settings.config`   (JSON — filament colours/types, bed)
 *   - `Metadata/model_settings.config`     (XML — objects, parts, plates,
 *     assemble/import transforms)
 * plus standard 3MF `<metadata>` / thumbnails.
 *
 * This module parses those from an already-unzipped entry table so the host's
 * single `parseThreemf` unzip feeds both the geometry and the Bambu metadata
 * layer (one unzip, two consumer chains — plan D4). Everything here is
 * environment-agnostic: no three.js, no `Blob`, no browser globals — the thumb
 * is returned as bytes and the host wraps it. Matrix helpers return plain 16x4
 * row-major number arrays (host converts to THREE.Matrix4).
 *
 * The parser mirrors the behaviour of the retired 3d_editor `bambu-3mf.ts` and
 * `viewTransforms.ts` so ModelGroup / DesktopLayout keep working unchanged
 * apart from the import source.
 */
import type { ThreemfArchive } from './threemf-loader'

const KNOWN_EXTENSIONS = new Set(['stl', 'step', 'stp', '3mf'])

/** Remove a known 3D file extension from a filename.
 *
 * @param name - the entry name, possibly ending in `.3mf`, `.stl`, `.step`, `.stp`
 *   (optionally suffixed `_<n>` for multi-plate objects).
 * @returns the name without the known extension.
 */
export function stripExtension(name: string): string {
  const extPattern = Array.from(KNOWN_EXTENSIONS).join('|')
  const multiRe = new RegExp(`^(.+)\\.(?:${extPattern})_(\\d+)$`, 'i')
  const multiMatch = name.match(multiRe)
  if (multiMatch) return `${multiMatch[1]}_${multiMatch[2]}`
  const singleRe = new RegExp(`^(.+)\\.(?:${extPattern})$`, 'i')
  const singleMatch = name.match(singleRe)
  if (singleMatch) return singleMatch[1]
  return name
}

/** A Bambu model object (an `<object>` in model_settings.config). */
export interface BambuObjectMeta {
  objectId: string
  name: string
  extruder: number
  plateId: number
}

/** A part inside a Bambu object (a `<part>` in model_settings.config). */
export interface BambuPartMeta {
  partIndex: number
  objectId: string
  partId: string
  name: string
  extruder: number
  plateId: number
}

/** Build-plate printable-area size, in millimetres. */
export interface BambuPlateSize {
  width: number
  depth: number
  height: number
}

/** A build plate in the project (id + display name + optional size). */
export interface BambuPlateInfo {
  plateId: number
  plateName: string
  size?: BambuPlateSize
}

/** Model-level descriptive metadata (Title/Designer/Description/License). */
export interface BambuModelMeta {
  title?: string
  designer?: string
  description?: string
  license?: string
}

/** A `<build>-section `<item> entry: object id and its print transform. */
export interface BuildItem {
  objectId: string
  transform: number[] | null
}

/** An assembly pose for a Bambu object (an `<assemble_item` entry). */
export interface AssembleItemTransform {
  objectId: string
  /** 12-value 4×3 matrix (same format as build `<item transform>`). */
  transform: number[]
  /** Additional fine-tune translation [tx, ty, tz]. */
  offset: [number, number, number]
}

/** A per-part import pose (4×4 matrix from model_settings.config). */
export interface PartImportTransform {
  objectId: string
  partId: string
  /** 16-value 4×4 matrix (row-major). */
  matrix: number[]
  /** Additional import translation offset. */
  sourceOffset: [number, number, number]
}

/** Everything parsed from a Bambu-labelled 3MF's private metadata layer. */
export interface Bambu3mfMetadata {
  filamentColors: string[]
  filamentTypes: string[]
  objects: Map<string, BambuObjectMeta>
  /** 打印单元表（序 = build items × 父对象 components = 叶子实例序）。 */
  parts: BambuPartMeta[]
  /**
   * P4：叶子实例（3MF `<object id>`，含子文件内局部 id）→ Bambu 身份。
   * 键 = `${父objectId}:${componentIndex}`（ThreemfObject.parentObjectId/
   * componentIndex 同源）；3MF object id 与 model_settings id 两套编号，
   * 必须经父对象 components 关联。
   */
  leafParts: Map<string, BambuPartMeta>
  plates: Map<number, BambuPlateInfo>
  modelMeta?: BambuModelMeta
  metadataEntries: Array<{ name: string; value: string }>
  /** Raw thumbnail PNG bytes, or undefined when absent. */
  thumbnailBytes?: Uint8Array
  assembleTransforms?: Map<string, AssembleItemTransform>
  importTransforms?: Map<string, PartImportTransform>
  buildItems?: BuildItem[]
}

/** Parse `<build>` section object IDs and transforms from 3D/3dmodel.model XML.
 *
 * @param xml - the raw 3D model XML text.
 * @returns the build items (objectId + optional print transform).
 */
export function parse3mfBuild(xml: string): BuildItem[] {
  const items: BuildItem[] = []
  const itemRe = /<item\s+objectid="(\d+)"[^>]*\/?>/g
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const objectId = m[1]
    const transformMatch = m[0].match(/transform="([^"]*)"/)
    const transform = transformMatch ? transformMatch[1].split(/\s+/).map(Number) : null
    items.push({ objectId, transform })
  }
  return items
}

/** Parse model-level `<metadata name="...">…</metadata>` tags (3MF standard).
 *
 * @param xml - the raw 3D model XML text.
 * @returns the recognised model meta fields plus every raw metadata entry.
 */
export function parseModelMeta(xml: string): {
  modelMeta: BambuModelMeta | undefined
  metadataEntries: Array<{ name: string; value: string }>
} {
  const meta: BambuModelMeta = {}
  const entries: Array<{ name: string; value: string }> = []
  const re = /<metadata\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/metadata>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const name = m[1]
    const value = m[2].trim()
    entries.push({ name, value })
    if (name === 'Title') meta.title = value
    else if (name === 'Designer') meta.designer = value
    else if (name === 'Description') meta.description = value
    else if (name === 'License') meta.license = value
  }
  return { modelMeta: Object.keys(meta).length > 0 ? meta : undefined, metadataEntries: entries }
}

/** Known 3MF thumbnail PNG paths, in priority order. */
const THUMBNAIL_PATHS = [
  'MetaData/thumbnail.png',
  'Auxiliaries/.thumbnails/thumbnail_3mf.png',
  'Auxiliaries/.thumbnails/thumbnail_middle.png',
  'Auxiliaries/.thumbnails/thumbnail_small.png',
]

/** Extract a standard 3MF thumbnail PNG from an entry table (raw bytes).
 *
 * @param entries - the unzipped 3MF entry table (path -> bytes).
 * @returns the PNG bytes of the first matching thumbnail, or undefined.
 */
export function extractThumbnailBytes(
  entries: Map<string, Uint8Array>,
): Uint8Array | undefined {
  const keys = [...entries.keys()]
  for (const path of THUMBNAIL_PATHS) {
    const entry = keys.find(k => k === path)
    if (entry) return entries.get(entry)
  }
  const metaDataEntry = keys.find(k => /^metadata\/thumbnail\.png$/i.test(k))
  if (metaDataEntry) return entries.get(metaDataEntry)
  return undefined
}

/** Parse Bambu Lab metadata from an already-unzipped entry table.
 *
 * @param extraEntries - the 3MF entry table excluding the geometry model shared
 *   with `parseThreemf` (project_settings / model_settings configs + thumbnails).
 * @param modelXml - P4：根 model 文档（3D/3dmodel.model）XML；3MF 标准把
 *   `<build>` 放在 `<resources>` 前，必须全量解析。缺省时回退到
 *   extraEntries 里查找（兼容旧调用方）。
 * @returns the resolved `Bambu3mfMetadata`.
 */
export function parseBambu3mfFromEntries(
  extraEntries: Map<string, Uint8Array>,
  modelXml?: string,
): Bambu3mfMetadata {
  const decoder = new TextDecoder()

  const filamentColors: string[] = []
  const filamentTypes: string[] = []
  const objects = new Map<string, BambuObjectMeta>()
  const plates = new Map<number, BambuPlateInfo>()
  const objectParts = new Map<string, { partId: string; name: string; extruder: number }[]>()
  const assembleTransforms = new Map<string, AssembleItemTransform>()
  const importTransforms = new Map<string, PartImportTransform>()
  // P4：父对象（model_settings id）→ 3MF components 子 id 列表（打印单元关联）。
  const parentComponents = new Map<string, number[]>()

  // ---- 1. project_settings.config (JSON) ----
  let bedSize: BambuPlateSize | undefined
  const projKey = [...extraEntries.keys()].find(f => f.endsWith('project_settings.config'))
  if (projKey) {
    try {
      const json = JSON.parse(decoder.decode(extraEntries.get(projKey)!))
      const rawColors = json.filament_colour ?? json.filament_color ?? []
      const cArr = Array.isArray(rawColors) ? rawColors : [rawColors]
      for (const c of cArr) {
        filamentColors.push(typeof c === 'string' ? c.replace(/^"(.*)"$/, '$1').trim() : String(c))
      }
      const fTypes = json.filament_type ?? []
      if (Array.isArray(fTypes)) {
        for (const t of fTypes) filamentTypes.push(typeof t === 'string' ? t : String(t))
      }
      if (json.printable_area) {
        const area = Array.isArray(json.printable_area) ? json.printable_area : [json.printable_area]
        let maxX = 0
        let maxY = 0
        for (const pt of area) {
          const parts = String(pt).split('x')
          if (parts.length === 2) {
            const x = parseFloat(parts[0])
            const y = parseFloat(parts[1])
            if (Number.isFinite(x) && x > maxX) maxX = x
            if (Number.isFinite(y) && y > maxY) maxY = y
          }
        }
        const height = parseFloat(String(json.printable_height ?? '0'))
        if (maxX > 0 && maxY > 0 && Number.isFinite(height) && height > 0) {
          bedSize = { width: maxX, depth: maxY, height }
        }
      }
    } catch {
      /* ignore malformed project settings */
    }
  }

  // ---- 2. model_settings.config (XML) ----
  const msKey = [...extraEntries.keys()].find(f => f.endsWith('model_settings.config'))
  if (msKey) {
    const xml = decoder.decode(extraEntries.get(msKey)!)

    const objBlockRe = /<object\s+id="(\d+)"[^>]*>([\s\S]*?)<\/object>/gi
    let objMatch: RegExpExecArray | null
    while ((objMatch = objBlockRe.exec(xml)) !== null) {
      const oid = objMatch[1]
      const body = objMatch[2]
      const topLevel = body.replace(/<part[^>]*>[\s\S]*?<\/part>/gi, '')
      let objName = ''
      let objExtruder = 1
      const metaRe = /<metadata\s+key="([^"]*)"\s+value="([^"]*)"\s*\/?>/gi
      let mm: RegExpExecArray | null
      while ((mm = metaRe.exec(topLevel)) !== null) {
        if (mm[1] === 'name') objName = mm[2]
        if (mm[1] === 'extruder') objExtruder = parseInt(mm[2], 10) || 1
      }
      objects.set(oid, { objectId: oid, name: objName, extruder: objExtruder, plateId: 0 })

      const partList: { partId: string; name: string; extruder: number }[] = []
      const partBlockRe = /<part\s+id="(\d+)"[^>]*>([\s\S]*?)<\/part>/gi
      let pm: RegExpExecArray | null
      while ((pm = partBlockRe.exec(body)) !== null) {
        const pid = pm[1]
        const partBody = pm[2]
        let partName = objName
        let partExtruder = objExtruder
        const pmRe = /<metadata\s+key="([^"]*)"\s+value="([^"]*)"\s*\/?>/gi
        let pmm: RegExpExecArray | null
        while ((pmm = pmRe.exec(partBody)) !== null) {
          if (pmm[1] === 'name') partName = pmm[2]
          if (pmm[1] === 'extruder') partExtruder = parseInt(pmm[2], 10) || objExtruder
        }
        partList.push({ partId: pid, name: partName, extruder: partExtruder })
      }
      if (partList.length === 0) {
        partList.push({ partId: '0', name: objName, extruder: objExtruder })
      }
      objectParts.set(oid, partList)
    }

    // 2c. <plate> blocks
    const plateBlockRe = /<plate>([\s\S]*?)<\/plate>/gi
    let plateMatch: RegExpExecArray | null
    while ((plateMatch = plateBlockRe.exec(xml)) !== null) {
      const plateBody = plateMatch[1]
      let platerId = 0
      let platerName = ''
      const pmRe2 = /<metadata\s+key="([^"]*)"\s+value="([^"]*)"\s*\/?>/gi
      let m2: RegExpExecArray | null
      while ((m2 = pmRe2.exec(plateBody)) !== null) {
        if (m2[1] === 'plater_id') platerId = parseInt(m2[2], 10) || 0
        if (m2[1] === 'plater_name') platerName = m2[2]
      }
      if (platerId > 0) {
        plates.set(platerId, { plateId: platerId, plateName: platerName, size: bedSize })
      }
      const instRe = /<model_instance>([\s\S]*?)<\/model_instance>/gi
      let im: RegExpExecArray | null
      while ((im = instRe.exec(plateBody)) !== null) {
        const oidMatch = /<metadata\s+key="object_id"\s+value="(\d+)"\s*\/?>/i.exec(im[1])
        if (oidMatch) {
          const obj = objects.get(oidMatch[1])
          if (obj) obj.plateId = platerId
        }
      }
    }

    // 2d. <assemble> — assembly transforms
    const assembleBlock = xml.match(/<assemble>([\s\S]*?)<\/assemble>/i)
    if (assembleBlock) {
      const assembleItemRe = /<assemble_item\s+([^>]*)\/?>/gi
      let am: RegExpExecArray | null
      while ((am = assembleItemRe.exec(assembleBlock[1])) !== null) {
        const attrs = am[1]
        const oidMatch = /object_id="(\d+)"/.exec(attrs)
        const xformMatch = /transform="([^"]*)"/.exec(attrs)
        const offsetMatch = /offset="([^"]*)"/.exec(attrs)
        const oid = oidMatch?.[1]
        if (oid && xformMatch) {
          const xform = xformMatch[1].split(/\s+/).map(Number)
          const offsetArr = offsetMatch ? offsetMatch[1].split(/\s+/).map(Number) : [0, 0, 0]
          if (xform.length === 12 && offsetArr.length === 3) {
            assembleTransforms.set(oid, {
              objectId: oid,
              transform: xform,
              offset: offsetArr as [number, number, number],
            })
          }
        }
      }
    }

    // 2e. <part> matrix metadata (per-part import transforms)
    const importObjBlockRe = /<object\s+id="(\d+)"[^>]*>([\s\S]*?)<\/object>/gi
    let importObjMatch: RegExpExecArray | null
    while ((importObjMatch = importObjBlockRe.exec(xml)) !== null) {
      const oid = importObjMatch[1]
      const body = importObjMatch[2]
      const importPartRe = /<part\s+id="(\d+)"[^>]*>([\s\S]*?)<\/part>/gi
      let ipm: RegExpExecArray | null
      while ((ipm = importPartRe.exec(body)) !== null) {
        const pid = ipm[1]
        let matrix: number[] | undefined
        let sox = 0; let soy = 0; let soz = 0
        const imRe = /<metadata\s+key="([^"]*)"\s+value="([^"]*)"\s*\/?>/gi
        let imm: RegExpExecArray | null
        while ((imm = imRe.exec(ipm[2])) !== null) {
          if (imm[1] === 'matrix') matrix = imm[2].split(/\s+/).map(Number)
          if (imm[1] === 'source_offset_x') sox = parseFloat(imm[2]) || 0
          if (imm[1] === 'source_offset_y') soy = parseFloat(imm[2]) || 0
          if (imm[1] === 'source_offset_z') soz = parseFloat(imm[2]) || 0
        }
        if (matrix && matrix.length === 16) {
          importTransforms.set(`${oid}:${pid}`, {
            objectId: oid,
            partId: pid,
            matrix,
            sourceOffset: [sox, soy, soz],
          })
        }
      }
    }
  }

  // ---- 3. Model-level metadata + build items from 3D/3dmodel.model ----
  // P4：根 model XML 由 parseThreemf 经 ThreemfArchive.modelXml 直传（根 model
  // 不在 extraEntries）；`<build>` 可能位于 `<resources>` 之前（3MF 标准顺序），
  // 故 buildItems 全量解析整个 modelXml，不再只查 resources 之后的 tail。
  const thumbnailBytes = extractThumbnailBytes(extraEntries)
  let modelMeta: BambuModelMeta | undefined
  let metadataEntries: Array<{ name: string; value: string }> = []
  let buildItems: BuildItem[] = []

  const modelFile = modelXml ?? (() => {
    const f = [...extraEntries.keys()].find(
      k => k.endsWith('/3dmodel.model') || k === '3D/3dmodel.model',
    )
    return f ? decoder.decode(extraEntries.get(f)!) : undefined
  })()
  if (modelFile) {
    const parsedHead = parseModelMeta(modelFile)
    const parsedTail = parseModelMeta(modelFile)
    modelMeta = { ...parsedHead.modelMeta, ...parsedTail.modelMeta }
    metadataEntries = [...parsedHead.metadataEntries, ...parsedTail.metadataEntries]
    buildItems = parse3mfBuild(modelFile)
    // P4：父对象 components（父 object id → 子 id 列表）——build item 引用父
    // 对象，实际网格在子（叶子）里；打印单元 = 父 × components。
    const parentObjRe = /<object\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/object>/gi
    let pom: RegExpExecArray | null
    while ((pom = parentObjRe.exec(modelFile)) !== null) {
      const body = pom[2]
      if (!body.includes('<components>')) continue
      const childIds: number[] = []
      const compRe = /<component\b[^>]*\bobjectid="(\d+)"/g
      let cm: RegExpExecArray | null
      while ((cm = compRe.exec(body)) !== null) {
        const cid = Number(cm[1])
        if (Number.isFinite(cid)) childIds.push(cid)
      }
      if (childIds.length > 0) parentComponents.set(pom[1], childIds)
    }
  }

  // ---- 4. 打印单元表（build items × 父对象 components 展开） ----
  // P4 修正：3MF `<object id>`（叶子实例，含子文件内局部 id）与
  // model_settings.config 的 `<object id>`（父对象）是两套编号。关联必须走
  // 父对象 `<components>`（component objectid = 叶子 id）；每个父对象的每个
  // component = 一个可打印单元（part）。Bambu 导出惯例：component 序 ↔
  // 父对象 part 列表序（partId 同源）。
  // 表序 = build item 序 × components 序 = parseThreemf 叶子实例序（meshIndex
  // 契约：ModelGroup 按 meshIndex 取 parts[i] 做 view delta / 多盘布局）。
  const parts: BambuPartMeta[] = []
  const leafParts = new Map<string, BambuPartMeta>()
  let partIndex = 0
  for (const item of buildItems) {
    const oid = item.objectId
    const objMeta = objects.get(oid)
    const partList = objectParts.get(oid) ?? []
    const compIds = parentComponents.get(oid) ?? []
    if (compIds.length === 0) {
      // 父对象无 components（单网格对象）：1 个打印单元，partId 取第一个 part。
      const p = partList[0]
      parts.push({
        partIndex: partIndex++,
        objectId: oid,
        partId: p?.partId ?? '0',
        name: stripExtension(p?.name ?? objMeta?.name ?? ''),
        extruder: p?.extruder ?? objMeta?.extruder ?? 1,
        plateId: objMeta?.plateId ?? 0,
      })
      leafParts.set(`${oid}:1`, parts[parts.length - 1])
      continue
    }
    for (let ci = 0; ci < compIds.length; ci++) {
      const p = partList[ci]
      const meta: BambuPartMeta = {
        partIndex: partIndex++,
        objectId: oid,
        partId: p?.partId ?? String(ci + 1),
        name: stripExtension(p?.name ?? objMeta?.name ?? ''),
        extruder: p?.extruder ?? objMeta?.extruder ?? 1,
        plateId: objMeta?.plateId ?? 0,
      }
      parts.push(meta)
      leafParts.set(`${oid}:${ci + 1}`, meta)
    }
  }

  return {
    filamentColors,
    filamentTypes,
    objects,
    parts,
    plates,
    modelMeta: modelMeta && Object.keys(modelMeta).length > 0 ? modelMeta : undefined,
    metadataEntries,
    thumbnailBytes,
    assembleTransforms: assembleTransforms.size > 0 ? assembleTransforms : undefined,
    importTransforms: importTransforms.size > 0 ? importTransforms : undefined,
    buildItems: buildItems.length > 0 ? buildItems : undefined,
    leafParts,
  }
}

/** Parse Bambu metadata from a `ThreemfArchive`'s `extraEntries`.
 *
 * @param archive - a `ThreemfArchive` produced by `parseThreemf`.
 * @returns the resolved `Bambu3mfMetadata`.
 */
export function parseBambu3mfFromArchive(archive: ThreemfArchive): Bambu3mfMetadata {
  return parseBambu3mfFromEntries(archive.extraEntries, archive.modelXml)
}