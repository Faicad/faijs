/**
 * threemf-loader — headless 3MF (ZIP/OPC) geometry loader.
 *
 * 3MF is a ZIP container whose geometry lives in `3D/3dmodel.model`, an XML
 * document. Design requirements (unit-system §2.4/§5): the unit MUST be read
 * from the real (inflated) XML, NOT from the raw bytes — `3D/3dmodel.model` is
 * deflate-compressed inside the ZIP, so scanning the raw buffer cannot find
 * `<model unit="…">` (the 3d_editor precedent returned 'millimeter' for real
 * files). We unzip the entry first, then parse the XML.
 *
 * Coordinate conversion: every coordinate is multiplied by `UNIT_SCALE[unit]`
 * to land in the faijs base length unit (mm).
 *
 * Per-object transform: `<item transform="a b c d e f g h i p q r">` is an
 * ST_Matrix3D stored **column-major** whose last three tokens are the
 * translation `(p,q,r)`. Applied as:
 *   x' = a*x + d*y + g*z + p
 *   y' = b*x + e*y + h*z + q
 *   z' = c*x + f*y + i*z + r
 * so object-local mesh coords bake into world-space positions.
 *
 * Return: an `ThreemfArchive` — per-instance objects (one per `<build><item>`,
 * transform baked, or per-`<resources>` object when `<build>` has no items at
 * all), plus every non-model archive entry surfaced as `extraEntries` so the
 * host can reach Bambu's private `model_settings.config` / thumbnails through
 * the *same unzipped map* (single unzip, two consumer chains).
 */
import { readZipEntries } from '../io/zip'
import { strFromU8 } from 'fflate'
import { parseXmlDocument } from '../api/xml-dom'
import { UNIT_SCALE, type UnitName } from '../units'

/** Map a 3MF unit string to a faijs length unit name. */
function threemfUnitToFaijs(unit: string): UnitName | null {
  switch (unit) {
    case 'micron': return 'micron'
    case 'millimeter': return 'mm'
    case 'centimeter': return 'cm'
    case 'inch': return 'inch'
    case 'foot': return 'foot'
    case 'meter': return 'm'
    default: return null
  }
}

/** One parsed 3MF object instance: triangle soup in mm base (unit-scaled). */
export interface ThreemfObject {
  /** The `<object id>` this instance instantiates. */
  id: number
  /** The object's `<object name>` (Bambu exports a human label here). */
  name?: string
  positions: Float32Array
  indices: Uint32Array
}

/** Structured 3MF parse result. */
export interface ThreemfArchive {
  /** The declared `<model unit>` mapped to a faijs UnitName. */
  unit: UnitName
  /** One object per build `<item>` (transform baked), or per `<resources>` object. */
  objects: ThreemfObject[]
  /** Every non-model archive entry (key → raw bytes) for downstream consumers. */
  extraEntries: Map<string, Uint8Array>
}

/** Extract the declared unit from an already-parsed `<model>` document. */
function modelUnit(doc: Document): string {
  const model = doc.documentElement
  if (model && model.getAttribute('unit')) {
    return model.getAttribute('unit')!
  }
  // Default per 3MF spec is millimeter.
  return 'millimeter'
}

/** Parse the `3D/3dmodel.model` XML, backward-compatible helper. */
async function parseModelXml(xml: string): Promise<{
  unitName: UnitName
  objects: ThreemfObject[]
}> {
  const doc = await parseXmlDocument(xml)
  const unit = modelUnit(doc)
  const unitName = threemfUnitToFaijs(unit)
  if (unitName === null) {
    throw new Error(`[mesh/threemf] unsupported <model unit>: ${JSON.stringify(unit)}`)
  }
  const scale = UNIT_SCALE[unitName]

  // resources → object → mesh → vertices / triangles
  const resources = doc.documentElement.getElementsByTagName('resources')[0]
  const objects = resources ? resources.getElementsByTagName('object') : []
  const byObjectId = new Map<
    number,
    { id: number; name?: string; positions: Float32Array; indices: Uint32Array }
  >()

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i]
    const id = Number(obj.getAttribute('id'))
    if (!Number.isInteger(id)) continue
    const meshEl = obj.getElementsByTagName('mesh')[0]
    if (!meshEl) continue
    const verticesEl = meshEl.getElementsByTagName('vertices')[0]
    const trianglesEl = meshEl.getElementsByTagName('triangles')[0]
    if (!verticesEl || !trianglesEl) continue

    const vertexElCh = verticesEl.getElementsByTagName('vertex')
    const pos = new Float32Array(vertexElCh.length * 3)
    for (let v = 0; v < vertexElCh.length; v++) {
      const el = vertexElCh[v]
      pos[v * 3] = Number(el.getAttribute('x')) * scale
      pos[v * 3 + 1] = Number(el.getAttribute('y')) * scale
      pos[v * 3 + 2] = Number(el.getAttribute('z')) * scale
    }

    const triEls = trianglesEl.getElementsByTagName('triangle')
    const idx = new Uint32Array(triEls.length * 3)
    for (let t = 0; t < triEls.length; t++) {
      const el = triEls[t]
      idx[t * 3] = Number(el && el.getAttribute('v1'))
      idx[t * 3 + 1] = Number(el && el.getAttribute('v2'))
      idx[t * 3 + 2] = Number(el && el.getAttribute('v3'))
    }
    byObjectId.set(id, { id, name: obj.getAttribute('name') ?? undefined, positions: pos, indices: idx })
  }

  // build → item → per-instance transforms baked to world space.
  const build = doc.documentElement.getElementsByTagName('build')[0]
  const itemEls = build ? build.getElementsByTagName('item') : []
  const out: ThreemfObject[] = []

  if (itemEls.length > 0) {
    for (let i = 0; i < itemEls.length; i++) {
      const item = itemEls[i]
      const objId = Number(item.getAttribute('objectid'))
      const src = byObjectId.get(objId)
      if (!src) continue
      const mat = item.getAttribute('transform')
      const [a, b, c, d, e, f, g, h, iz, p, q, r] = mat
        ? mat.trim().split(/\s+/).map(Number)
        : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
      const outPos = new Float32Array(src.positions.length)
      for (let v = 0; v < src.positions.length; v += 3) {
        const x = src.positions[v]
        const y = src.positions[v + 1]
        const z = src.positions[v + 2]
        outPos[v] = a * x + d * y + g * z + p
        outPos[v + 1] = b * x + e * y + h * z + q
        outPos[v + 2] = c * x + f * y + iz * z + r
      }
      out.push({ id: src.id, name: src.name, positions: outPos, indices: src.indices })
    }
  } else {
    // No build items: emit every `<resources>` object directly (¶ the empty
    // `<build>` contract — NOT a fallback; see plan §8 decision 8).
    for (const src of byObjectId.values()) {
      out.push({ id: src.id, name: src.name, positions: src.positions, indices: src.indices })
    }
  }

  if (out.length === 0) {
    throw new Error('[mesh/threemf] no buildable geometry found in 3dmodel.model')
  }
  return { unitName, objects: out }
}

/**
 * Parse 3MF bytes into a structured archive.
 *
 * @param buffer - the raw .3mf (ZIP) bytes.
 * @returns an `ThreemfArchive` with mm-base per-instance objects, the declared
 *   source unit, and every non-model archive entry.
 * @throws when the buffer is not a 3MF/ZIP archive or the unit is invalid.
 */
export async function parseThreemf(buffer: ArrayBuffer): Promise<ThreemfArchive> {
  let entries: Map<string, Uint8Array>
  try {
    entries = readZipEntries(new Uint8Array(buffer))
  } catch {
    throw new Error('[mesh/threemf] not a valid 3MF ZIP archive')
  }
  const modelKey = [...entries.keys()].find((k) => k.toLowerCase() === '3d/3dmodel.model')
  if (!modelKey) {
    throw new Error('[mesh/threemf] missing 3D/3dmodel.model entry')
  }
  const raw = entries.get(modelKey)!
  const xml = strFromU8(raw)
  const parsed = await parseModelXml(xml)

  // `extraEntries` = everything that is NOT the model — Bambu's
  // `Metadata/model_settings.config`, `Metadata/project_settings.config`,
  // `Metadata/thumbnail.png`, etc.
  const extraEntries = new Map<string, Uint8Array>()
  for (const [k, v] of entries) {
    if (k.toLowerCase() === '3d/3dmodel.model') continue
    extraEntries.set(k, v)
  }

  return { unit: parsed.unitName, objects: parsed.objects, extraEntries }
}