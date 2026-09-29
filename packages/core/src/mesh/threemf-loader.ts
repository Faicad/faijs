/**
 * threemf-loader — headless 3MF (ZIP/OPC) geometry loader.
 *
 * 3MF is a ZIP container whose geometry lives in `3D/3dmodel.model`, an XML
 * document. Design requirement (unit-system §2.4/§5): the unit MUST be read
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
 * so object-local mesh coords bake into world-space positions (the op contract
 * is world-space; `planeDistance` must line up with baked positions).
 */
import { unzipSync, strFromU8 } from 'fflate'
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

/** A parsed 3MF solid: triangle soup in mm base (already unit-scaled). */
export interface ThreemfMesh {
  positions: Float32Array
  indices: Uint32Array
  /** The declared `<model unit>` (raw, e.g. "millimeter"). */
  sourceUnit: string
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

/** Parse the `3D/3dmodel.model` XML and produce an index+position mesh. */
async function parseModelXml(xml: string): Promise<{ positions: Float32Array; indices: Uint32Array; unit: string }> {
  const doc = await parseXmlDocument(xml)
  const unit = modelUnit(doc)
  const faijsUnit = threemfUnitToFaijs(unit)
  if (faijsUnit === null) {
    throw new Error(`[mesh/threemf] unsupported <model unit>: ${JSON.stringify(unit)}`)
  }
  const scale = UNIT_SCALE[faijsUnit]

  // resources → object → mesh → vertices / triangles
  const resources = doc.documentElement.getElementsByTagName('resources')[0]
  const objects = resources ? resources.getElementsByTagName('object') : []
  const byObjectId = new Map<number, { positions: Float32Array; indices: Uint32Array }>()

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i]
    const id = Number(obj.getAttribute('id'))
    if (!Number.isInteger(id)) continue
    const meshEl = obj.getElementsByTagName('mesh')[0]
    if (!meshEl) continue
    const verticesEl = meshEl.getElementsByTagName('vertices')[0]
    const trianglesEl = meshEl.getElementsByTagName('triangles')[0]
    if (!verticesEl || !trianglesEl) continue

    const vertexEls = verticesEl.getElementsByTagName('vertex')
    const pos = new Float32Array(vertexEls.length * 3)
    for (let v = 0; v < vertexEls.length; v++) {
      const el = vertexEls[v]
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
    byObjectId.set(id, { positions: pos, indices: idx })
  }

  // build → item → per-instance transforms (ST_3D, column-major, translation last 3).
  const build = doc.documentElement.getElementsByTagName('build')[0]
  const itemEls = build ? build.getElementsByTagName('item') : []
  const allPos: number[] = []
  const allIdx: number[] = []

  for (let i = 0; i < itemEls.length; i++) {
    const item = itemEls[i]
    const objId = Number(item.getAttribute('objectid'))
    const src = byObjectId.get(objId)
    if (!src) continue
    const mat = item.getAttribute('transform')
    const [a, b, c, d, e, f, g, h, iz, p, q, r] = mat
      ? mat.trim().split(/\s+/).map(Number)
      : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]

    const base = allPos.length / 3
    for (let v = 0; v < src.positions.length; v += 3) {
      const x = src.positions[v]
      const y = src.positions[v + 1]
      const z = src.positions[v + 2]
      allPos.push(
        a * x + d * y + g * z + p,
        b * x + e * y + h * z + q,
        c * x + f * y + iz * z + r,
      )
    }
    for (let t = 0; t < src.indices.length; t++) {
      allIdx.push(src.indices[t] + base)
    }
  }

  // Fallback: if the build list is empty (some exporters omit <build>), emit
  // every object's mesh directly.
  if (itemEls.length === 0) {
    for (const [, src] of byObjectId) {
      const base = allPos.length / 3
      for (let v = 0; v < src.positions.length; v++) allPos.push(src.positions[v])
      for (let t = 0; t < src.indices.length; t++) allIdx.push(src.indices[t] + base)
    }
  }

  if (allPos.length === 0) {
    throw new Error('[mesh/threemf] no buildable geometry found in 3dmodel.model')
  }

  return {
    positions: new Float32Array(allPos),
    indices: new Uint32Array(allIdx),
    unit,
  }
}

/**
 * Parse 3MF bytes into a mm-base mesh.
 * @param buffer - the raw .3mf (ZIP) bytes.
 * @returns the parsed mesh plus the declared source unit.
 * @throws when the buffer is not a 3MF/ZIP archive or the unit is invalid.
 */
export async function parseThreemf(buffer: ArrayBuffer): Promise<ThreemfMesh> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(buffer))
  } catch {
    throw new Error('[mesh/threemf] not a valid 3MF ZIP archive')
  }
  const modelKey = Object.keys(entries).find((k) => k.toLowerCase() === '3d/3dmodel.model')
  if (!modelKey) {
    throw new Error('[mesh/threemf] missing 3D/3dmodel.model entry')
  }
  const raw = entries[modelKey]!
  const xml = strFromU8(raw)
  const parsed = await parseModelXml(xml)
  return {
    positions: parsed.positions,
    indices: parsed.indices,
    sourceUnit: parsed.unit,
  }
}