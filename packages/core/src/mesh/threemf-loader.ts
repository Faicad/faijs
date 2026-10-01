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

/** `#RRGGBB` → sRGB components in 0..1 (leading `#` required, alpha ignored). */
function hexToRgb(hex: string): readonly [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/.exec(hex)
  if (!m) return null
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
}

/** Per-triangle material properties (3MF `pid`/`p1`/`p2`/`p3`). */
interface TriMaterialProps {
  pid?: string
  p1?: number
  p2?: number
  p3?: number
}

/** One `<component>` reference inside an object's `<components>` list. */
interface ObjectComponent {
  objectId: number
  /** ST_Matrix3D tokens (12 or validated 16 → first 12); null = malformed → identity. */
  transform: readonly number[] | null
}

/** Object-level geometry + material metadata collected during resources scan. */
interface ObjectMeshMeta {
  id: number
  name?: string
  /** Object-level `pid` (applies to every triangle without its own `pid`). */
  pid?: string
  /** Object-level `pindex` (default base/color index when a triangle omits p1..p3). */
  pindex?: number
  /**
   * Present when the object carries a `<mesh>`; a pure component container
   * (no mesh, only `<components>`) has neither positions nor indices.
   */
  positions?: Float32Array
  indices?: Uint32Array
  /** Per-triangle material props; undefined when the object uses none. */
  triProps?: TriMaterialProps[]
  /** `<components>` children (Bambu builds plates/assemblies this way). */
  components?: ObjectComponent[]
}

/** Bake a column-major ST_Matrix3D (translation = last three tokens) into positions. */
function bakeTransform(positions: Float32Array, m: readonly number[]): Float32Array {
  const [a, b, c, d, e, f, g, h, iz, p, q, r] = m
  const out = new Float32Array(positions.length)
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v]
    const y = positions[v + 1]
    const z = positions[v + 2]
    out[v] = a * x + d * y + g * z + p
    out[v + 1] = b * x + e * y + h * z + q
    out[v + 2] = c * x + f * y + iz * z + r
  }
  return out
}

/**
 * Compose two ST_Matrix3D column-major transforms (12 tokens each, same
 * layout as `bakeTransform`: `[a b c, d e f, g h i, p q r]`, translation last).
 *
 * Semantics: the child transform is applied first, then the parent —
 * `M = parent · child` (the child lives in the parent's space, exactly like
 * three.js `clone.applyMatrix4(parent).applyMatrix4(child)`).
 */
function composeTransform(parent: readonly number[], child: readonly number[]): number[] {
  const [a1, b1, c1, d1, e1, f1, g1, h1, i1, p1, q1, r1] = parent
  const [a2, b2, c2, d2, e2, f2, g2, h2, i2, p2, q2, r2] = child
  return [
    a1 * a2 + d1 * b2 + g1 * c2,
    b1 * a2 + e1 * b2 + h1 * c2,
    c1 * a2 + f1 * b2 + i1 * c2,
    a1 * d2 + d1 * e2 + g1 * f2,
    b1 * d2 + e1 * e2 + h1 * f2,
    c1 * d2 + f1 * e2 + i1 * f2,
    a1 * g2 + d1 * h2 + g1 * i2,
    b1 * g2 + e1 * h2 + h1 * i2,
    c1 * g2 + f1 * h2 + i1 * i2,
    a1 * p2 + d1 * q2 + g1 * r2 + p1,
    b1 * p2 + e1 * q2 + h1 * r2 + q1,
    c1 * p2 + f1 * q2 + i1 * r2 + r1,
  ]
}

/**
 * Parse an ST_Matrix3D attribute (12 or 16 tokens with trailing "0 0 0 1").
 * Returns the first 12 tokens when valid, `null` when malformed (caller
 * ignores the transform instead of baking NaN — mirrors the host tolerance
 * contract).
 */
function parseTransformAttr(raw: string | null): readonly number[] | null {
  if (!raw) return null
  const t = raw.trim().split(/\s+/).map(Number)
  const valid =
    t.length === 12 ||
    (t.length === 16 && t[12] === 0 && t[13] === 0 && t[14] === 0 && t[15] === 1)
  if (!valid || !t.every((n) => Number.isFinite(n))) return null
  return t.length === 12 ? t : t.slice(0, 12)
}

/** One parsed 3MF object instance: triangle soup in mm base (unit-scaled). */
export interface ThreemfObject {
  /** The `<object id>` this instance instantiates. */
  id: number
  /** The object's `<object name>` (Bambu exports a human label here). */
  name?: string
  positions: Float32Array
  indices: Uint32Array
  /**
   * Basematerials display color, `[r, g, b]` in 0..1 (sRGB components as
   * written in the file, matching the host's `setStyle(…, SRGBColorSpace)`).
   * Set when every triangle of the object references the *same* base index;
   * multi-base objects cannot be expressed by a single color → undefined
   * (host falls back to the default material).
   */
  baseColor?: readonly [number, number, number]
  /**
   * Colorgroup vertex colors, one RGB triple per emitted vertex — the geometry
   * is *expanded* (each triangle owns 3 independent vertices, indices are
   * sequential) whenever a colorgroup is referenced, so per-triangle
   * p1/p2/p3 colors survive without shared-vertex conflicts. Length equals
   * `positions.length`.
   */
  vertexColors?: Float32Array
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

/**
 * Parse the 3MF model XML documents (root + sub-models) into archive objects.
 *
 * Bambu exports are multi-file: `3D/3dmodel.model` holds only thin `<object>`
 * skeletons (component containers) plus the `<build>`, while the actual mesh
 * geometry lives in per-object files `3D/Objects/object_*.model` referenced
 * through `p:path` (production extension) — which we ignore in favor of
 * merging every model document's `<resources>` by object id (mirrors the
 * host's fast-3mf collection order: sub-models first, root model last, root
 * wins on id collisions).
 *
 * `unit` is read from the ROOT model document (the file the build items
 * belong to); all documents share the same declared unit in practice.
 */
async function parseModelXml(docTexts: string[]): Promise<{
  unitName: UnitName
  objects: ThreemfObject[]
}> {
  // Last document = root model (caller appends it last).
  const rootDoc = docTexts[docTexts.length - 1]
  const rootXml = await parseXmlDocument(rootDoc)
  const unit = modelUnit(rootXml)
  const unitName = threemfUnitToFaijs(unit)
  if (unitName === null) {
    throw new Error(`[mesh/threemf] unsupported <model unit>: ${JSON.stringify(unit)}`)
  }
  const scale = UNIT_SCALE[unitName]

  // resources → material libraries (basematerials / colorgroup) + objects,
  // merged across every model document (sub-models first, root last).
  const basematerialsById = new Map<string, { name?: string; displaycolor?: string }[]>()
  const colorgroupsById = new Map<string, Float32Array>()
  const byObjectId = new Map<number, ObjectMeshMeta>()

  for (const text of docTexts) {
    const doc = await parseXmlDocument(text)
    const resources = doc.documentElement.getElementsByTagName('resources')[0]
    if (!resources) continue
    const baseGroups = resources.getElementsByTagName('basematerials')
    for (let i = 0; i < baseGroups.length; i++) {
      const bm = baseGroups[i]
      const id = bm.getAttribute('id')
      if (!id) continue
      const bases = Array.from(bm.getElementsByTagName('base')).map((b) => ({
        name: b.getAttribute('name') ?? undefined,
        displaycolor: b.getAttribute('displaycolor') ?? undefined,
      }))
      basematerialsById.set(id, bases)
    }
    const colorGroups = resources.getElementsByTagName('colorgroup')
    for (let i = 0; i < colorGroups.length; i++) {
      const cg = colorGroups[i]
      const id = cg.getAttribute('id')
      if (!id) continue
      const colors = new Float32Array(Array.from(cg.getElementsByTagName('color')).length * 3)
      let ci = 0
      for (const c of Array.from(cg.getElementsByTagName('color'))) {
        const hex = c.getAttribute('color')?.slice(0, 7) ?? '#000000'
        const rgb = hexToRgb(hex) ?? [0, 0, 0]
        colors[ci++] = rgb[0]
        colors[ci++] = rgb[1]
        colors[ci++] = rgb[2]
      }
      colorgroupsById.set(id, colors)
    }
    const objects = resources.getElementsByTagName('object')
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]
      const id = Number(obj.getAttribute('id'))
      if (!Number.isInteger(id)) continue
      const name = obj.getAttribute('name') ?? undefined
      const objPid = obj.getAttribute('pid') ?? undefined
      const objPindexRaw = obj.getAttribute('pindex')
      const objPindex = objPindexRaw !== null && objPindexRaw !== '' ? Number(objPindexRaw) : undefined

      const meshEl = obj.getElementsByTagName('mesh')[0]
      let meta: ObjectMeshMeta = { id, name, pid: objPid, pindex: objPindex }

      if (meshEl) {
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

        // Material props are collected only when the object actually references a
        // resource (object-level pid or any triangle-level pid/p1) — the common
        // untextured case stays allocation-free.
        let triProps: TriMaterialProps[] | undefined = undefined
        let needProps = objPid !== undefined
        for (let t = 0; t < triEls.length; t++) {
          const el = triEls[t]
          idx[t * 3] = Number(el && el.getAttribute('v1'))
          idx[t * 3 + 1] = Number(el && el.getAttribute('v2'))
          idx[t * 3 + 2] = Number(el && el.getAttribute('v3'))
          if (!needProps && el) {
            if (el.getAttribute('pid') !== null || el.getAttribute('p1') !== null) needProps = true
          }
        }
        if (needProps) {
          triProps = []
          for (let t = 0; t < triEls.length; t++) {
            const el = triEls[t]
            const p: TriMaterialProps = {}
            const pid = el.getAttribute('pid')
            if (pid !== null) p.pid = pid
            const p1 = el.getAttribute('p1')
            if (p1 !== null) p.p1 = Number(p1)
            const p2 = el.getAttribute('p2')
            if (p2 !== null) p.p2 = Number(p2)
            const p3 = el.getAttribute('p3')
            if (p3 !== null) p.p3 = Number(p3)
            triProps.push(p)
          }
        }
        meta = { ...meta, positions: pos, indices: idx, triProps }
      }

      // `<components>` children — Bambu builds plates/assemblies this way.
      // A pure component container has no mesh; it still registers in byObjectId
      // so build items referencing it expand recursively (component instances).
      const compEl = obj.getElementsByTagName('components')[0]
      if (compEl) {
        const comps: ObjectComponent[] = []
        for (const c of Array.from(compEl.getElementsByTagName('component'))) {
          const oid = Number(c.getAttribute('objectid'))
          if (!Number.isInteger(oid)) continue
          comps.push({ objectId: oid, transform: parseTransformAttr(c.getAttribute('transform')) })
        }
        if (comps.length > 0) meta = { ...meta, components: comps }
      }

      if (!meta.positions && !meta.components) continue
      byObjectId.set(id, meta)
    }
  }

  /**
   * Materialize object instances: a mesh object yields ONE ThreemfObject with
   * the transform baked in and base/vertex colors resolved; a component
   * container recursively expands each child (composing transforms, child
   * applied first), one ThreemfObject per leaf mesh instance — mirroring the
   * host's clone-and-apply semantics without shared geometry. `path` guards
   * reference cycles (a self-referencing component chain terminates).
   */
  function materialize(
    src: ObjectMeshMeta,
    mat: readonly number[] | undefined,
    path: Set<number>,
  ): ThreemfObject[] {
    if (src.positions && src.indices) {
      return [materializeMesh(src, mat)]
    }
    if (src.components && src.components.length > 0) {
      const out: ThreemfObject[] = []
      for (const comp of src.components) {
        if (path.has(comp.objectId)) continue
        const ref = byObjectId.get(comp.objectId)
        if (!ref) continue
        const next = comp.transform
          ? (mat ? composeTransform(mat, comp.transform) : comp.transform)
          : mat
        const nextPath = new Set(path)
        nextPath.add(comp.objectId)
        out.push(...materialize(ref, next, nextPath))
      }
      return out
    }
    return []
  }

  /**
   * Materialize a single mesh object instance: bake the optional build
   * transform and resolve base/vertex colors. `vertexColors` expands the
   * geometry (each triangle owns 3 independent vertices) so per-triangle
   * p1/p2/p3 survive; `baseColor` keeps the compact form and applies only
   * when every triangle references the same base index (multi-base objects
   * fall back to the default material, matching the host contract).
   */
  function materializeMesh(src: ObjectMeshMeta, mat?: readonly number[]): ThreemfObject {
    const positions = src.positions!
    const indices = src.indices!
    let pid: string | undefined
    if (src.triProps) {
      for (const p of src.triProps) {
        const eff = p.pid ?? src.pid
        if (eff !== undefined) { pid = eff; break }
      }
    } else {
      pid = src.pid
    }

    const cg = pid !== undefined ? colorgroupsById.get(pid) : undefined
    if (cg) {
      const triCount = indices.length / 3
      const outPos = new Float32Array(triCount * 9)
      const outCol = new Float32Array(triCount * 9)
      const outIdx = new Uint32Array(triCount * 3)
      const objectPindex = src.pindex
      for (let t = 0; t < triCount; t++) {
        const v1 = indices[t * 3]
        const v2 = indices[t * 3 + 1]
        const v3 = indices[t * 3 + 2]
        const tp = src.triProps ? src.triProps[t] : undefined
        const p1 = tp?.p1 ?? objectPindex ?? 0
        const p2 = tp?.p2 ?? p1
        const p3 = tp?.p3 ?? p1
        // vertex-contiguous layout (x1 y1 z1 x2 y2 z2 x3 y3 z3 / R1 G1 B1 …):
        // each emitted vertex owns 3 consecutive components.
        const vs = [v1, v2, v3]
        const ps = [p1, p2, p3]
        for (let k = 0; k < 3; k++) {
          const sv = vs[k]
          const sp = ps[k]
          outPos[t * 9 + k * 3] = positions[sv * 3]
          outPos[t * 9 + k * 3 + 1] = positions[sv * 3 + 1]
          outPos[t * 9 + k * 3 + 2] = positions[sv * 3 + 2]
          outCol[t * 9 + k * 3] = cg[sp * 3]
          outCol[t * 9 + k * 3 + 1] = cg[sp * 3 + 1]
          outCol[t * 9 + k * 3 + 2] = cg[sp * 3 + 2]
        }
        outIdx[t * 3] = t * 3
        outIdx[t * 3 + 1] = t * 3 + 1
        outIdx[t * 3 + 2] = t * 3 + 2
      }
      return {
        id: src.id,
        name: src.name,
        positions: mat ? bakeTransform(outPos, mat) : outPos,
        indices: outIdx,
        vertexColors: outCol,
      }
    }

    const bases = pid !== undefined ? basematerialsById.get(pid) : undefined
    if (bases && bases.length > 0) {
      const idx0 = src.triProps ? (src.triProps[0]?.p1 ?? src.pindex ?? 0) : (src.pindex ?? 0)
      let same = true
      if (src.triProps) {
        for (let t = 1; t < src.triProps.length; t++) {
          if ((src.triProps[t]?.p1 ?? src.pindex ?? 0) !== idx0) { same = false; break }
        }
      }
      const base = bases[idx0]
      const baseColor = same && base?.displaycolor
        ? hexToRgb(base.displaycolor.slice(0, 7))
        : undefined
      return {
        id: src.id,
        name: src.name,
        positions: mat ? bakeTransform(positions, mat) : positions,
        indices,
        baseColor: baseColor ?? undefined,
      }
    }

    return {
      id: src.id,
      name: src.name,
      positions: mat ? bakeTransform(positions, mat) : positions,
      indices,
    }
  }

  // build → item → per-instance transforms baked to world space.
  // `<build>` lives in the ROOT model document only.
  const build = rootXml.documentElement.getElementsByTagName('build')[0]
  const itemEls = build ? build.getElementsByTagName('item') : []
  const out: ThreemfObject[] = []

  if (itemEls.length > 0) {
    for (let i = 0; i < itemEls.length; i++) {
      const item = itemEls[i]
      const objId = Number(item.getAttribute('objectid'))
      const src = byObjectId.get(objId)
      if (!src) continue
      // ST_Matrix3D: 4×3 (12) or 4×4 (16) whose trailing row is "0 0 0 1";
      // malformed transforms are IGNORED (identity) — never bake NaN into
      // geometry (mirrors the host's fast-3mf tolerance contract).
      const tokens = parseTransformAttr(item.getAttribute('transform'))
      out.push(...materialize(src, tokens ?? undefined, new Set([objId])))
    }
  } else {
    // No build items: emit every `<resources>` object directly (¶ the empty
    // `<build>` contract — NOT a fallback; see plan §8 decision 8).
    for (const src of byObjectId.values()) {
      out.push(...materialize(src, undefined, new Set([src.id])))
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
 * Supports Bambu's multi-file layout: `3D/3dmodel.model` (root, holds the
 * `<build>` and component-container skeletons) plus per-object sub-models
 * `3D/Objects/*.model` whose `<resources>` are merged by object id
 * (sub-models first, root last — root wins collisions).
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
  const rootKey = [...entries.keys()].find((k) => k.toLowerCase() === '3d/3dmodel.model')
  if (!rootKey) {
    throw new Error('[mesh/threemf] missing 3D/3dmodel.model entry')
  }

  // Sub-model documents first (fast-3mf collection order), root model last.
  const docKeys: string[] = []
  for (const k of entries.keys()) {
    if (k.toLowerCase() === rootKey.toLowerCase()) continue
    if (/^3d\/.+\/[^/]+\.model$/i.test(k)) docKeys.push(k)
  }
  docKeys.push(rootKey)
  const docTexts = docKeys.map((k) => new TextDecoder().decode(entries.get(k)!))
  const parsed = await parseModelXml(docTexts)

  // `extraEntries` = everything that is NOT a model document — Bambu's
  // `Metadata/model_settings.config`, `Metadata/project_settings.config`,
  // `Metadata/thumbnail.png`, etc.
  const extraEntries = new Map<string, Uint8Array>()
  for (const [k, v] of entries) {
    if (/\.model$/i.test(k)) continue
    extraEntries.set(k, v)
  }

  return { unit: parsed.unitName, objects: parsed.objects, extraEntries }
}