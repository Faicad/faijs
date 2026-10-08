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
import { UNIT_SCALE, type UnitName } from '../units'
import type { ShapeMeta, FileMeta } from '../api/meta'

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
  /** `<object><metadatagroup><metadata name="faijs:description">` 提升的描述。 */
  description?: string
  /** `<object partnumber>`（料号，规范要求编辑/派生尽量保留）。 */
  partNumber?: string
  /** `<object><metadatagroup><metadata name>`（键含命名空间前缀）。 */
  metadata?: Record<string, string>
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

/**
 * Bake a 3MF ST_Matrix3D into positions.
 *
 * 3MF 约定（Core spec §4.3.1）：12 元组 **行主序** 3×4，平移在**末列**——token
 * 序为 `m00 m01 m02 tx | m10 m11 m12 ty | m20 m21 m22 tz`，平移 = token[3]/[7]/[11]。
 * 与写出器 `export-model.ts#transformToMatrix12`（同一行主序约定）必须同源，否则
 * 写出 → 读回的 transform 会被旋转/平移错位（步骤 5 修复：此前本函数误用列主序）。
 */
function bakeTransform(positions: Float32Array, m: readonly number[]): Float32Array {
  const [a, b, c, d, e, f, g, h, i, j, k, l] = m
  const out = new Float32Array(positions.length)
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v]
    const y = positions[v + 1]
    const z = positions[v + 2]
    out[v] = a * x + b * y + c * z + d
    out[v + 1] = e * x + f * y + g * z + h
    out[v + 2] = i * x + j * y + k * z + l
  }
  return out
}

/**
 * Compose two 3MF ST_Matrix3D transforms (12 tokens each, **row-major** 3×4,
 * translation in the last column — same layout as `bakeTransform`).
 *
 * Semantics: the child transform is applied first, then the parent —
 * `M = parent · child` (the child lives in the parent's space, exactly like
 * three.js `clone.applyMatrix4(parent).applyMatrix4(child)`). For the 3×3 part
 * `M_rot = parent_rot · child_rot`; for the translation
 * `M_t = parent_rot · child_t + parent_t`.
 */
function composeTransform(parent: readonly number[], child: readonly number[]): number[] {
  const [a1, b1, c1, d1, e1, f1, g1, h1, i1, j1, k1, l1] = parent
  const [a2, b2, c2, d2, e2, f2, g2, h2, i2, j2, k2, l2] = child
  return [
    a1 * a2 + b1 * e2 + c1 * i2,
    a1 * b2 + b1 * f2 + c1 * j2,
    a1 * c2 + b1 * g2 + c1 * k2,
    a1 * d2 + b1 * h2 + c1 * l2 + d1,
    e1 * a2 + f1 * e2 + g1 * i2,
    e1 * b2 + f1 * f2 + g1 * j2,
    e1 * c2 + f1 * g2 + g1 * k2,
    e1 * d2 + f1 * h2 + g1 * l2 + h1,
    i1 * a2 + j1 * e2 + k1 * i2,
    i1 * b2 + j1 * f2 + k1 * j2,
    i1 * c2 + j1 * g2 + k1 * k2,
    i1 * d2 + j1 * h2 + k1 * l2 + l1,
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
  /** The `<object id>` this instance instantiates (leaf object id). */
  id: number
  /**
   * P4 Bambu：实例所属的最上层 build-item 父对象 id（组件容器逐层展开时保留
   * 顶层父）。非 Bambu / resources 直出实例为 undefined。宿主据此把叶子
   * object 关联到 model_settings.config 的 Bambu 对象（objectId 同源）。
   */
  parentObjectId?: number
  /**
   * P4 Bambu：父对象 `<components>` 中的 1-based 序号（父对象多子时区分）。
   * 与 Bambu part 序号同源（Bambu 导出惯例：component 序 ↔ part 序）。
   */
  componentIndex?: number
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
  /**
   * Per-triangle base-material groups (P4, 3MF Core `<triangle pid p1..p3>`
   * with p1=p2=p3 referencing a `<basematerials>` base): maximal runs of
   * consecutive triangles sharing one base index, each with that base's
   * display color. Triangles with mixed p1/p2/p3 (vertex-attribute
   * interpolation) are skipped. Multi-base objects surface here instead of a
   * single `baseColor`.
   */
  materialGroups?: Array<{ start: number; count: number; color: [number, number, number] }>
  /**
   * 零件级说明性元数据（设计文档 2026-10-05-meta §5.1）：`name` 来自
   * `<object name>`；`partNumber` 来自 `<object partnumber>`；`metadata` 来自
   * `<object><metadatagroup><metadata name>…`（键保留命名空间前缀）。组件实例
   * （component 容器）只带对所引用对象的 meta 拷贝。
   */
  meta?: ShapeMeta
}

/**
 * 装配层级节点（方案 2026-10-08 §2.1 / 第 5 步「导入归一」）：一个 `<build><item>`
 * 或 `<components><component>` 引用，携带**相对父**的位姿（3MF `<component transform>`
 * 或 build `<item transform>`）。`children` 递归展开嵌套装配。几何由 `localGeomById`
 * 按 `objectId` 取未烘焙的局部网格（与 `objects` 的已烘焙实例不同轴：assembly 走
 * 局部几何 + 节点 transform，viewer 走 `objects` 的已烘焙实例）。
 */
export interface ThreemfNode {
  /** 引用的 `<object id>`（必为 `<resources>` 中的对象）。 */
  objectId: number
  /** 相对父的位姿（行主序 3×4，平移在末列，与写出器 `transformToMatrix12` 同源）；无则缺省。 */
  transform?: readonly number[] | null
  /** 子节点（嵌套装配）；叶节点缺省。 */
  children?: ThreemfNode[]
}

/** Structured 3MF parse result. */
export interface ThreemfArchive {
  /** The declared `<model unit>` mapped to a faijs UnitName. */
  unit: UnitName
  /** One object per build `<item>` (transform baked), or per `<resources>` object. */
  objects: ThreemfObject[]
  /**
   * 装配层级（方案 §2.1 / 第 5 步）：`<build>` 顶层 item + 其 `<components>` 递归展开，
   * 节点带**相对父**位姿。仅当文件含装配结构（多 item 或任一 item 带 components）时存在。
   */
  hierarchy?: ThreemfNode[]
  /**
   * 未烘焙的局部几何，按 `<object id>` 索引（mesh 对象 carrying positions/indices；
   * 组件容器只带 meta）。assembly 重建走它 + `hierarchy` 的节点 transform，与 `objects`
   * 的已烘焙实例互不干扰。
   */
  localGeomById?: Map<number, ThreemfObject>
  /** Every non-model archive entry (key → raw bytes) for downstream consumers. */
  extraEntries: Map<string, Uint8Array>
  /** P4：根 model 文档（3D/3dmodel.model）XML——Bambu 层解析 build/组件结构用。 */
  modelXml?: string
  /** 整体级元数据（设计文档 2026-10-meta 表中的 3MF model context；`<model><metadata>`）。 */
  fileMeta?: FileMeta
}

/** Detect triangle-level material attributes (fast-3mf port). */
const TRI_MATERIAL_ATTR_RE = /(?:^|\s)(?:p1|p2|p3|pid)="/

/**
 * Loose vertex re-parse: extracts x/y/z independently, tolerating attribute
 * reordering or newlines inside a vertex tag. Slow path — only used when the
 * strict regex scan reports a count mismatch (fast-3mf port).
 */
function parseVerticesLoose(vertSec: string): Float32Array | null {
  const vRe = /<vertex\s+([^>]*?)\/?>/g
  const positions: number[] = []
  let vm: RegExpExecArray | null
  while ((vm = vRe.exec(vertSec)) !== null) {
    const a = vm[1]
    const x = /(?:^|\s)x="(-?[\d.eE+-]+)"/.exec(a)?.[1]
    const y = /(?:^|\s)y="(-?[\d.eE+-]+)"/.exec(a)?.[1]
    const z = /(?:^|\s)z="(-?[\d.eE+-]+)"/.exec(a)?.[1]
    if (x === undefined || y === undefined || z === undefined) return null
    positions.push(+x, +y, +z)
  }
  return new Float32Array(positions)
}

/**
 * Loose triangle re-parse: extracts v1/v2/v3 (and pid/p1/p2/p3 when needed)
 * per attribute, tolerating attribute reordering (fast-3mf port). Slow path —
 * only used when the strict regex scan reports a count mismatch.
 */
function parseTrianglesLoose(
  triSec: string,
  withProps: boolean,
): { index: Uint32Array; props: TriMaterialProps[] | null } | null {
  const tFullRe = /<triangle\s+([^>]*?)\/?>/g
  const idx: number[] = []
  const props: TriMaterialProps[] = []
  let tm: RegExpExecArray | null
  while ((tm = tFullRe.exec(triSec)) !== null) {
    const a = tm[1]
    const v1 = /(?:^|\s)v1="(\d+)"/.exec(a)?.[1]
    const v2 = /(?:^|\s)v2="(\d+)"/.exec(a)?.[1]
    const v3 = /(?:^|\s)v3="(\d+)"/.exec(a)?.[1]
    if (v1 === undefined || v2 === undefined || v3 === undefined) return null
    idx.push(+v1, +v2, +v3)
    if (withProps) {
      const p: TriMaterialProps = {}
      const pid = /(?:^|\s)pid="([^"]*)"/.exec(a)?.[1]
      if (pid !== undefined) p.pid = pid
      const p1 = /(?:^|\s)p1="([^"]*)"/.exec(a)?.[1]
      if (p1 !== undefined) p.p1 = +p1
      const p2 = /(?:^|\s)p2="([^"]*)"/.exec(a)?.[1]
      if (p2 !== undefined) p.p2 = +p2
      const p3 = /(?:^|\s)p3="([^"]*)"/.exec(a)?.[1]
      if (p3 !== undefined) p.p3 = +p3
      props.push(p)
    }
  }
  return { index: new Uint32Array(idx), props: withProps ? props : null }
}

/**
 * Stream-scan one model XML document for `<resources>` material libraries and
 * `<object>` entries, merging into the shared maps (caller keeps sub-models
 * first / root last so the root wins id collisions).
 *
 * Text-scanner (no DOM) — ported from the host's retired fast-3mf parser, so
 * very large model documents (Bambu exports reach ~140 MB of XML, where a full
 * DOM parse exhausts the heap) stay linear in memory. Attribute extraction
 * keeps fast-3mf's tolerance: attribute reordering / newline variance falls
 * back to a loose re-parse; namespace-prefixed attributes (`p:objectid`,
 * `p:transform`) match through substring.
 */
function scanResources(
  xml: string,
  scale: number,
  basematerialsById: Map<string, { name?: string; displaycolor?: string }[]>,
  colorgroupsById: Map<string, Float32Array>,
  byObjectId: Map<number, ObjectMeshMeta>,
): void {
  const resourcesStart = xml.indexOf('<resources>')
  if (resourcesStart < 0) return
  const resourcesEnd = xml.indexOf('</resources>', resourcesStart)
  const resBody = resourcesEnd >= 0
    ? xml.slice(resourcesStart, resourcesEnd)
    : xml.slice(resourcesStart)

  // basematerials: id + base list (name/displaycolor).
  const bmRe = /<basematerials\s+([^>]*)>([\s\S]*?)<\/basematerials>/g
  let m: RegExpExecArray | null
  while ((m = bmRe.exec(resBody)) !== null) {
    const id = /(?:^|\s)id="([^"]+)"/.exec(m[1])?.[1]
    if (id === undefined) continue
    const bases: { name?: string; displaycolor?: string }[] = []
    const baseRe = /<base\s+([^>]*?)\/?>/g
    let bm2: RegExpExecArray | null
    while ((bm2 = baseRe.exec(m[2])) !== null) {
      bases.push({
        name: /(?:^|\s)name="([^"]*)"/.exec(bm2[1])?.[1],
        displaycolor: /(?:^|\s)displaycolor="([^"]*)"/.exec(bm2[1])?.[1],
      })
    }
    basematerialsById.set(id, bases)
  }

  // colorgroup: id + color list (hex → sRGB components).
  const cgRe = /<colorgroup\s+([^>]*)>([\s\S]*?)<\/colorgroup>/g
  while ((m = cgRe.exec(resBody)) !== null) {
    const id = /(?:^|\s)id="([^"]+)"/.exec(m[1])?.[1]
    if (id === undefined) continue
    const colors: number[] = []
    const colorRe = /<color\s+([^>]*?)\/?>/g
    let cm: RegExpExecArray | null
    while ((cm = colorRe.exec(m[2])) !== null) {
      const hex = /(?:^|\s)color="([^"]*)"/.exec(cm[1])?.[1]?.slice(0, 7) ?? '#000000'
      const rgb = hexToRgb(hex) ?? [0, 0, 0]
      colors.push(rgb[0], rgb[1], rgb[2])
    }
    colorgroupsById.set(id, new Float32Array(colors))
  }

  // objects — scanned across the whole document (not just `<resources>`) so
  // out-of-resources `<object>` placements still load (external-data tolerance).
  const objRe = /<object\s+([^>]*)>([\s\S]*?)<\/object>/g
  while ((m = objRe.exec(xml)) !== null) {
    const attrs = m[1]
    const body = m[2]
    const idRaw = /(?:^|\s)id="([^"]+)"/.exec(attrs)?.[1]
    if (idRaw === undefined) continue
    const id = Number(idRaw)
    if (!Number.isInteger(id)) continue
    const name = /(?:^|\s)name="([^"]*)"/.exec(attrs)?.[1]
    const objPid = /(?:^|\s)pid="([^"]*)"/.exec(attrs)?.[1]
    const objPindexRaw = /(?:^|\s)pindex="([^"]*)"/.exec(attrs)?.[1]
    const objPindex = objPindexRaw !== undefined && objPindexRaw !== '' ? Number(objPindexRaw) : undefined
    // 料号（`<object partnumber>`）。
    const partNumber = /(?:^|\s)partnumber="([^"]*)"/.exec(attrs)?.[1]
    // 对象级 `<metadatagroup><metadata name="ns:key">…`（vendor 前缀键，值取 text 或 name）。
    // faijs 写出的 `faijs:description` 提升为对象级 `description`（§6.1 写回 §5.1 读，
    // 保证 description 往返不落进自定义键）；其余键保留原始名进 metadata。
    const metadata: Record<string, string> = {}
    let objectDescription: string | undefined
    const mgRe = /<metadatagroup[^>]*>([\s\S]*?)<\/metadatagroup>/g
    let mgm: RegExpExecArray | null
    while ((mgm = mgRe.exec(body)) !== null) {
      const mdRe = /<metadata\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/metadata>)/g
      let mdm: RegExpExecArray | null
      while ((mdm = mdRe.exec(mgm[1])) !== null) {
        const key = /(?:^|\s)name="([^"]*)"/.exec(mdm[1])?.[1]
        if (key === undefined) continue
        const text = mdm[2] !== undefined ? /(?:^|\s)value="([^"]*)"/.exec(mdm[1])?.[1] : undefined
        const val =
          text ??
          (mdm[2] !== undefined ? mdm[2].replace(/<[^>]*>/g, '').trim() : undefined)
        if (val === undefined) continue
        if (key === 'faijs:description') objectDescription = val
        else metadata[key] = val
      }
    }

    let meta: ObjectMeshMeta = {
      id,
      name,
      description: objectDescription,
      partNumber,
      metadata,
      pid: objPid,
      pindex: objPindex,
    }

    // mesh: vertices + triangles (fast-3mf port — strict regex scan with a
    // loose attribute-order fallback; missing sub-sections are tolerated and
    // the object still registers, matching the retired host behavior).
    const meshStart = body.indexOf('<mesh>')
    const meshEnd = body.indexOf('</mesh>')
    if (meshStart >= 0 && meshEnd > meshStart) {
      const meshBody = body.slice(meshStart, meshEnd)

      // vertices
      const vertStart = meshBody.indexOf('<vertices>')
      const vertEnd = meshBody.indexOf('</vertices>')
      if (vertStart >= 0 && vertEnd > vertStart) {
        const vertSec = meshBody.slice(vertStart, vertEnd)
        let vc = 0
        let p = 0
        while ((p = vertSec.indexOf('<vertex ', p)) !== -1) { vc++; p += 8 }
        const vRe = /x="(-?[\d.eE+-]+)"\s+y="(-?[\d.eE+-]+)"\s+z="(-?[\d.eE+-]+)"/g
        let positions = new Float32Array(vc * 3)
        let vm: RegExpExecArray | null
        let vi = 0
        while ((vm = vRe.exec(vertSec)) !== null) {
          positions[vi] = +vm[1] * scale
          positions[vi + 1] = +vm[2] * scale
          positions[vi + 2] = +vm[3] * scale
          vi += 3
        }
        // XML attributes are unordered (spec XSD) — if any vertex failed to
        // match (different attribute order / newline after tag), re-scan each
        // attribute independently instead of giving up.
        if (vc > 0 && vi !== vc * 3) {
          const loose = parseVerticesLoose(vertSec)
          if (!loose) {
            throw new Error(`[mesh/threemf] cannot parse <vertices> in object ${id}`)
          }
          positions = new Float32Array(loose.length)
          for (let i = 0; i < loose.length; i++) positions[i] = loose[i] * scale
        }
        meta = { ...meta, positions }
      }

      // triangles
      const triStart = meshBody.indexOf('<triangles>')
      const triEnd = meshBody.indexOf('</triangles>')
      if (triStart >= 0 && triEnd > triStart) {
        const triSec = meshBody.slice(triStart, triEnd)
        let tc = 0
        let p = 0
        while ((p = triSec.indexOf('<triangle ', p)) !== -1) { tc++; p += 10 }
        const idx = new Uint32Array(tc * 3)
        const hasMatAttrs = TRI_MATERIAL_ATTR_RE.test(triSec)
        // Object-level pid without per-triangle material attrs: synthesize
        // triangle properties so every triangle still routes through the
        // resource (object pindex default) — fast-3mf semantics.
        const needsProps = hasMatAttrs || objPid !== undefined
        const triProps: TriMaterialProps[] | undefined = needsProps ? [] : undefined
        const tRe = /v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g
        let tm: RegExpExecArray | null
        let ti = 0
        while ((tm = tRe.exec(triSec)) !== null) {
          idx[ti] = +tm[1]
          idx[ti + 1] = +tm[2]
          idx[ti + 2] = +tm[3]
          ti += 3
        }
        if (tc > 0 && ti !== tc * 3) {
          // Attribute order / newline variance → re-scan each attribute
          // independently (slow path, rare).
          const loose = parseTrianglesLoose(triSec, needsProps)
          if (!loose) {
            throw new Error(`[mesh/threemf] cannot parse <triangles> in object ${id}`)
          }
          idx.set(loose.index)
          if (loose.props) {
            triProps!.length = 0
            triProps!.push(...loose.props)
          }
        } else if (needsProps) {
          if (hasMatAttrs) {
            const tFullRe = /<triangle\s+([^>]*?)\/?>/g
            let tfm: RegExpExecArray | null
            while ((tfm = tFullRe.exec(triSec)) !== null) {
              const a = tfm[1]
              const tv = /v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/.exec(a)
              if (!tv) continue
              const prop: TriMaterialProps = {}
              const p1 = /\bp1="([^"]*)"/.exec(a)?.[1]
              if (p1 !== undefined) prop.p1 = +p1
              const p2 = /\bp2="([^"]*)"/.exec(a)?.[1]
              if (p2 !== undefined) prop.p2 = +p2
              const p3 = /\bp3="([^"]*)"/.exec(a)?.[1]
              if (p3 !== undefined) prop.p3 = +p3
              const pidm = /\bpid="([^"]*)"/.exec(a)?.[1]
              if (pidm !== undefined) prop.pid = pidm
              triProps!.push(prop)
            }
          } else {
            // Object-level pid only → synthesized props (no per-triangle
            // material attrs) so materializeMesh's per-triangle lookups fall
            // through to the object-level defaults.
            for (let i = 0; i < tc; i++) triProps!.push({})
          }
        }
        meta = { ...meta, indices: idx, triProps }
      }
    }

    // `<components>` children — Bambu builds plates/assemblies this way.
    // A pure component container has no mesh; it still registers in byObjectId
    // so build items referencing it expand recursively (component instances).
    const compStart = body.indexOf('<components>')
    if (compStart >= 0) {
      const compEnd = body.indexOf('</components>', compStart)
      const compSec = compEnd >= 0
        ? body.slice(compStart + '<components>'.length, compEnd)
        : body.slice(compStart + '<components>'.length)
      const comps: ObjectComponent[] = []
      const compRe = /<component\s+([^>]*?)\/?>/g
      let cpm: RegExpExecArray | null
      while ((cpm = compRe.exec(compSec)) !== null) {
        const oid = Number(/objectid="([^"]+)"/.exec(cpm[1])?.[1])
        if (!Number.isInteger(oid)) continue
        comps.push({
          objectId: oid,
          transform: parseTransformAttr(/\btransform="([^"]*)"/.exec(cpm[1])?.[1] ?? null),
        })
      }
      if (comps.length > 0) meta = { ...meta, components: comps }
    }

    if (!meta.positions && !meta.components) continue
    byObjectId.set(id, meta)
  }
}

/** 3MF Core well-known model-level metadata names → FileMeta 字段映射。 */
type FileMetaStringKey = Exclude<keyof FileMeta, 'metadata'>
const MODEL_METADATA_FIELD: Record<string, FileMetaStringKey> = {
  Title: 'title',
  Designer: 'designer',
  Description: 'description',
  Copyright: 'copyright',
  LicenseTerms: 'licenseTerms',
  Rating: 'rating',
  CreationDate: 'creationDate',
  ModificationDate: 'modificationDate',
  Application: 'application',
}

/**
 * Parse `FileMeta` from the root model document's direct `<metadata>` children
 * (3MF Core model context). Well-known names (Title/Designer/…) map onto the
 * FileMeta fields; any other (vendor-namespaced) name is kept verbatim in
 * `FileMeta.metadata` (key preserves its namespace prefix). Value = text
 * content or a `value` attribute; empties are skipped.
 */
function parseModelMetadata(rootDoc: string): FileMeta | undefined {
  // 仅取 `<model …>` 到 `<resources>`/`<build>` 之前的前导区段——模型级元数据
  // 是 `<model>` 的直接子级，排在 `<resources>` 之前；避免把对象级/metadatagroup
  // 里的同名 `<metadata>` 误收进 fileMeta。
  const modelStart = rootDoc.indexOf('<model')
  if (modelStart < 0) return undefined
  const resAt = rootDoc.indexOf('<resources>', modelStart)
  const buildAt = rootDoc.indexOf('<build', modelStart)
  const endCandidates = [resAt, buildAt].filter((i) => i >= 0)
  const sectionEnd = endCandidates.length > 0 ? Math.min(...endCandidates) : rootDoc.length
  const section = rootDoc.slice(modelStart, sectionEnd)

  const meta: FileMeta = {}
  let custom: Record<string, string> | undefined
  const mdRe = /<metadata\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/metadata>)/g
  let mdm: RegExpExecArray | null
  while ((mdm = mdRe.exec(section)) !== null) {
    const attrs = mdm[1]
    const name = /(?:^|\s)name="([^"]*)"/.exec(attrs)?.[1]
    if (name === undefined) continue
    const valAttr = /(?:^|\s)value="([^"]*)"/.exec(attrs)?.[1]
    const val = valAttr ?? (mdm[2] !== undefined ? mdm[2].replace(/<[^>]*>/g, '').trim() : '')
    if (val === '') continue
    const field = MODEL_METADATA_FIELD[name]
    if (field) {
      meta[field] = val
    } else {
      custom = custom ?? {}
      custom[name] = val
    }
  }
  if (custom && Object.keys(custom).length > 0) meta.metadata = custom
  return Object.keys(meta).length > 0 ? meta : undefined
}

/**
 * Parse the 3MF model XML documents (root + sub-models) into archive objects.
 * skeletons (component containers) plus the `<build>`, while the actual mesh
 * geometry lives in per-object files `3D/Objects/object_*.model` referenced
 * through `p:path` (production extension) — which we ignore in favor of
 * merging every model document's `<resources>` by object id (mirrors the
 * host's fast-3mf collection order: sub-models first, root model last, root
 * wins on id collisions).
 *
 * `unit` is read from the ROOT model document (the file the build items
 * belong to); all documents share the same declared unit in practice.
 * `forcedUnit`（opts.unit，用户显式指定）时**覆盖/忽略文件内部声明**——unit
 * 参数对所有格式一视同仁：直接指定模型的源单位（unit-system §5.2），
 * 未提供才回落到文件声明。
 */
function parseModelXml(
  docTexts: string[],
  forcedUnit?: UnitName,
): {
  unitName: UnitName
  objects: ThreemfObject[]
  /** 装配层级（方案 §2.1 / 第 5 步「导入归一」）：build 顶层 item + 其 components 递归，节点带相对父位姿。 */
  hierarchy?: ThreemfNode[]
  /** 未烘焙的局部几何（mesh 对象），供 assembly 重建（与 `objects` 的已烘焙实例不同轴）。 */
  localGeomById?: Map<number, ThreemfObject>
  fileMeta?: FileMeta
} {
  // Last document = root model (caller appends it last).
  const rootDoc = docTexts[docTexts.length - 1]
  let unitName: UnitName
  if (forcedUnit) {
    // 强制设置模型单位：跳过文件声明（含非法声明）——用户显式指定优先。
    unitName = forcedUnit
  } else {
    const unitMatch = /<model\b[^>]*\bunit="([^"]+)"/.exec(rootDoc)
    const unit = unitMatch ? unitMatch[1] : 'millimeter'
    const mapped = threemfUnitToFaijs(unit)
    if (mapped === null) {
      throw new Error(`[mesh/threemf] unsupported <model unit>: ${JSON.stringify(unit)}`)
    }
    unitName = mapped
  }
  const scale = UNIT_SCALE[unitName]

  // 整体级元数据（`<model>` 直接子级 `<metadata>`；well-known 名映射到
  // FileMeta 字段，vendor 前缀名兜底进 FileMeta.metadata）。
  const fileMeta = parseModelMetadata(rootDoc)

  // resources → material libraries (basematerials / colorgroup) + objects,
  // merged across every model document (sub-models first, root last).
  const basematerialsById = new Map<string, { name?: string; displaycolor?: string }[]>()
  const colorgroupsById = new Map<string, Float32Array>()
  const byObjectId = new Map<number, ObjectMeshMeta>()

  for (const text of docTexts) {
    scanResources(text, scale, basematerialsById, colorgroupsById, byObjectId)
  }
    // (scanResources above handles basematerials / colorgroup / objects)
    // (mesh/components + registration handled by scanResources)

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
    parentObjectId?: number,
    componentIndex?: number,
  ): ThreemfObject[] {
    if (src.positions && src.indices) {
      return [materializeMesh(src, mat, parentObjectId, componentIndex)]
    }
    if (src.components && src.components.length > 0) {
      const out: ThreemfObject[] = []
      for (let i = 0; i < src.components.length; i++) {
        const comp = src.components[i]
        if (path.has(comp.objectId)) continue
        const ref = byObjectId.get(comp.objectId)
        if (!ref) continue
        const next = comp.transform
          ? (mat ? composeTransform(mat, comp.transform) : comp.transform)
          : mat
        const nextPath = new Set(path)
        nextPath.add(comp.objectId)
        // P4：把 build-item 的父对象 id 与组件序号透传到每个叶子实例——
        // 嵌套组件逐层展开时沿用同一父（父 identity 属于 build item）。
        const leafParentId = parentObjectId ?? src.id
        const leafCompIndex = componentIndex ?? i + 1
        out.push(...materialize(ref, next, nextPath, leafParentId, leafCompIndex))
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
  /** 组装零件级 meta（仅当至少一个字段存在）。
   *  组件容器（component 引用）沿 ref 链透传同一 meta 对象引用。 */
  function srcMeta(src: ObjectMeshMeta): ShapeMeta | undefined {
    const meta: ShapeMeta = {}
    if (src.name !== undefined && src.name !== '') meta.name = src.name
    if (src.description !== undefined && src.description !== '') meta.description = src.description
    if (src.partNumber !== undefined && src.partNumber !== '') meta.partNumber = src.partNumber
    if (src.metadata && Object.keys(src.metadata).length > 0) meta.metadata = src.metadata
    return Object.keys(meta).length > 0 ? meta : undefined
  }

  function materializeMesh(
    src: ObjectMeshMeta,
    mat?: readonly number[],
    parentObjectId?: number,
    componentIndex?: number,
  ): ThreemfObject {
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
        ...(parentObjectId !== undefined ? { parentObjectId, componentIndex: componentIndex ?? 1 } : {}),
        ...(srcMeta(src) ? { meta: srcMeta(src) } : {}),
      }
    }

    const bases = pid !== undefined ? basematerialsById.get(pid) : undefined
    if (bases && bases.length > 0) {
      const idx0 = src.triProps ? (src.triProps[0]?.p1 ?? src.pindex ?? 0) : (src.pindex ?? 0)
      let same = true
      let refKey = ''
      if (src.triProps) {
        for (const tp of src.triProps) {
          const effPid = tp.pid ?? src.pid
          const key = effPid !== undefined ? `${effPid}:${tp.p1 ?? src.pindex ?? 0}` : ''
          if (refKey === '') refKey = key
          else if (key !== refKey) {
            same = false
            break
          }
        }
      } else {
        refKey = pid !== undefined ? `${pid}:${src.pindex ?? 0}` : ''
      }
      const base = bases[idx0]
      // baseColor 只对「全部三角形同一 (pid, base)」的对象设置（P2 单色便捷
      // 字段）；无材质三角形或混合 pid/base 的对象 → undefined（走 materialGroups）。
      const baseColor = same && refKey !== '' && base?.displaycolor
        ? hexToRgb(base.displaycolor.slice(0, 7))
        : undefined
      // P4（3MF Core 逐三角形材质）：p1=p2=p3 的三角形按（有效 pid, base 索引）
      // 分组成 materialGroups（连续三角形区间 + 该 base 的 displaycolor）；
      // 无材质（对象与三角形均无 pid）、混合 p1/p2/p3（顶点属性插值）跳过。
      // 同色对象仍走 baseColor 便捷字段（P2 兼容）；多 base 对象在
      // materialGroups 表达（baseColor undefined）。
      const groups: Array<{ start: number; count: number; color: [number, number, number] }> = []
      const triProps = src.triProps
      const triCount = triProps?.length ?? indices.length / 3
      if (triProps) {
        let runStart = -1
        let runKey = ''
        let runColor: [number, number, number] | undefined
        const flush = (end: number): void => {
          if (runStart >= 0 && runColor) {
            groups.push({ start: runStart, count: end - runStart, color: runColor })
          }
          runStart = -1
          runKey = ''
          runColor = undefined
        }
        for (let t = 0; t < triCount; t++) {
          const tp: TriMaterialProps | undefined = triProps[t]
          let key = ''
          let color: [number, number, number] | undefined
          if (tp) {
            const effPid = tp.pid ?? src.pid
            if (effPid !== undefined) {
              const bases = basematerialsById.get(effPid)
              const bi = tp.p1 ?? src.pindex ?? 0
              if (bases && bi >= 0 && bi < bases.length && tp.p1 === tp.p2 && tp.p2 === tp.p3) {
                const c = bases[bi]?.displaycolor
                if (c) {
                  key = `${effPid}:${bi}`
                  const rgb = hexToRgb(c.slice(0, 7))
                  if (rgb) color = [rgb[0], rgb[1], rgb[2]]
                }
              }
            }
          }
          if (key !== '' && key === runKey) continue
          flush(t)
          if (key !== '') {
            runStart = t
            runKey = key
            runColor = color
          }
        }
        flush(triCount)
      }
      // 单一分组且覆盖全部三角形 = 单色对象 → 走 baseColor（P2 便捷字段），
      // 不挂 materialGroups（避免冗余双表达）；仅部分覆盖或多组才用 materialGroups。
      const singleFull =
        groups.length === 1 && groups[0].start === 0 && groups[0].count === triCount
      return {
        id: src.id,
        name: src.name,
        positions: mat ? bakeTransform(positions, mat) : positions,
        indices,
        baseColor: baseColor ?? undefined,
        ...(!singleFull && groups.length > 0 ? { materialGroups: groups } : {}),
        ...(parentObjectId !== undefined ? { parentObjectId, componentIndex: componentIndex ?? 1 } : {}),
        ...(srcMeta(src) ? { meta: srcMeta(src) } : {}),
      }
    }

    return {
      id: src.id,
      name: src.name,
      positions: mat ? bakeTransform(positions, mat) : positions,
      indices,
      ...(parentObjectId !== undefined ? { parentObjectId, componentIndex: componentIndex ?? 1 } : {}),
      ...(srcMeta(src) ? { meta: srcMeta(src) } : {}),
    }
  }

  // build → item → per-instance transforms baked to world space.
  // `<build>` lives in the ROOT model document only.
  const buildMatch = /<build\b[^>]*>/.exec(rootDoc)
  let buildSec = ''
  if (buildMatch) {
    const buildStart = buildMatch.index
    const buildEnd = rootDoc.indexOf('</build>', buildStart)
    buildSec = buildEnd >= 0 ? rootDoc.slice(buildStart, buildEnd) : rootDoc.slice(buildStart)
  }
  const itemRe = /<item\b[^>]*>/g
  const out: ThreemfObject[] = []
  let itemCount = 0
  let im: RegExpExecArray | null
  while ((im = itemRe.exec(buildSec)) !== null) {
    itemCount++
    const attrs = im[0]
    const objId = Number(/(?:^|\s)objectid="([^"]+)"/.exec(attrs)?.[1])
    const src = byObjectId.get(objId)
    if (!src) continue
    // ST_Matrix3D: 4×3 (12) or 4×4 (16) whose trailing row is "0 0 0 1";
    // malformed transforms are IGNORED (identity) — never bake NaN into
    // geometry (mirrors the host's fast-3mf tolerance contract).
    const tokens = parseTransformAttr(/\btransform="([^"]*)"/.exec(attrs)?.[1] ?? null)
    // parentObjectId=objId；componentIndex 留给 materialize 按组件序推导（undefined）。
    out.push(...materialize(src, tokens ?? undefined, new Set([objId]), objId, undefined))
  }
  if (itemCount === 0) {
    // No build items: emit every `<resources>` object directly (¶ the empty
    // `<build>` contract — NOT a fallback; see plan §8 decision 8).
    for (const src of byObjectId.values()) {
      out.push(...materialize(src, undefined, new Set([src.id])))
    }
  }

  // 装配层级 + 局部几何（方案 §2.1 / 第 5 步「导入归一」）。
  // `hierarchy`：build 顶层 item + 其 `<components>` 递归，节点带**相对父**位姿
  // （行主序 3×4，平移末列——与写出器 `transformToMatrix12` 同源）。`localGeomById`：
  // 未烘焙的局部几何（mesh 对象），供 assembly 重建（与 `out` 的已烘焙实例不同轴）。
  const localGeomById = new Map<number, ThreemfObject>()
  for (const src of byObjectId.values()) {
    if (src.positions && src.indices) {
      localGeomById.set(src.id, materializeMesh(src, undefined))
    } else if (src.components && src.components.length > 0) {
      localGeomById.set(
        src.id,
        { id: src.id, name: src.name, positions: new Float32Array(), indices: new Uint32Array() },
      )
    }
  }

  const nodeOf = (objId: number, tf: readonly number[] | null, visited: Set<number>): ThreemfNode => {
    const src = byObjectId.get(objId)
    const node: ThreemfNode = { objectId: objId }
    if (tf) node.transform = tf
    if (src?.components && src.components.length > 0) {
      // 路径守卫：组件回指祖先（含自指）即时剪枝，避免无限递归（测试「component
      // reference cycles terminate」）。被剪的重复引用不再展开为子节点。
      const next = new Set(visited)
      next.add(objId)
      node.children = src.components
        .filter((c) => !next.has(c.objectId))
        .map((c) => nodeOf(c.objectId, c.transform ?? null, next))
    }
    return node
  }
  const roots: ThreemfNode[] = []
  let hi: RegExpExecArray | null
  const hItemRe = /<item\b[^>]*>/g
  while ((hi = hItemRe.exec(buildSec)) !== null) {
    const objId = Number(/(?:^|\s)objectid="([^"]+)"/.exec(hi[0])?.[1])
    if (!byObjectId.has(objId)) continue
    const tf = parseTransformAttr(/\btransform="([^"]*)"/.exec(hi[0])?.[1] ?? null)
    roots.push(nodeOf(objId, tf, new Set()))
  }
  if (roots.length === 0) {
    for (const src of byObjectId.values()) roots.push(nodeOf(src.id, null, new Set()))
  }
  const hierarchy = roots

  if (out.length === 0) {
    throw new Error('[mesh/threemf] no buildable geometry found in 3dmodel.model')
  }
  return {
    unitName,
    objects: out,
    hierarchy,
    localGeomById,
    ...(fileMeta ? { fileMeta } : {}),
  }
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
 * @param opts - optional settings; `unit`（用户显式指定）**强制设置模型源单位**：
 *   覆盖/忽略文件内部 `<model unit>` 声明（unit 对所有格式一视同仁，unit-system
 *   §5.2）；未提供时读文件声明。无声明 → millimeter。
 * @returns an `ThreemfArchive` with mm-base per-instance objects, the source
 *   unit (forced value when provided, else the file declaration), and every
 *   non-model archive entry.
 * @throws when the buffer is not a 3MF/ZIP archive or the unit is invalid
 *   (no forced unit → an unsupported declaration throws; forced unit skips
 *   declaration parsing entirely).
 */
export async function parseThreemf(
  buffer: ArrayBuffer,
  opts?: { unit?: UnitName },
): Promise<ThreemfArchive> {
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
  const parsed = parseModelXml(docTexts, opts?.unit)

  // `extraEntries` = everything that is NOT a model document — Bambu's
  // `Metadata/model_settings.config`, `Metadata/project_settings.config`,
  // `Metadata/thumbnail.png`, etc.
  const extraEntries = new Map<string, Uint8Array>()
  for (const [k, v] of entries) {
    if (/\.model$/i.test(k)) continue
    extraEntries.set(k, v)
  }

  return {
    unit: parsed.unitName,
    objects: parsed.objects,
    // 装配层级 + 局部几何（方案 §2.1 / 第 5 步「导入归一」）：3MF `<components>`
    // 重建 CompoundShape 时需要的相对父位姿树与未烘焙局部几何（与 `objects` 的
    // 已烘焙实例不同轴）。必须透传，否则 importFile 拿不到 assembly。
    ...(parsed.hierarchy ? { hierarchy: parsed.hierarchy } : {}),
    ...(parsed.localGeomById ? { localGeomById: parsed.localGeomById } : {}),
    extraEntries,
    // P4：根 model XML（Bambu 层解析 build items / 父对象 components 需要；
    // 根 model 不在 extraEntries——extraEntries 只收非 model 条目）。
    ...(rootKey ? { modelXml: new TextDecoder().decode(entries.get(rootKey)!) } : {}),
    ...(parsed.fileMeta ? { fileMeta: parsed.fileMeta } : {}),
  }
}