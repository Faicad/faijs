/**
 * mesh 基本体 API — 从现有纯函数提取的统一接口
 *
 * 提取来源（§5.7）：
 * - box/sphere/cylinder/cone/wedge ← engine/primitives/mesh-primitives.ts (makePrimitiveGeo)
 * - text ← engine/components/engraving/EngravingCore.ts (createTextGeometry)
 * - screw ← engine/primitives/screw/screw.ts (makeScrew)
 * - svgExtrude ← engine/primitives/svg-extrude/ (svgToExtrudedGeometry)
 *
 * 所有函数返回 Shape (ManifoldMeshData)：THREE.BufferGeometry → geoToManifoldMesh 转换。
 * 坐标系：Z-up、毫米。
 */

import * as THREE from 'three'
import { makePrimitiveGeo } from '../primitives/mesh-primitives'
import { geoToManifoldMesh } from '../boolean/csg-backend'
import { svgToExtrudedGeometry } from '../primitives/svg-extrude'
import type { Shape, BoxParams, SphereParams, CylinderParams, ConeParams, WedgeParams, TextParams, SvgExtrudeParams, SdfParams } from './types'
import { clampNRad } from './types'

// ── 内部工具 ──

/** THREE.BufferGeometry → Shape (ManifoldMeshData) */
function geoToShape(geo: THREE.BufferGeometry): Shape {
  return geoToManifoldMesh(geo)
}

// ── 创建 API ──

/**
 * Create a box solid (brepjs contract, §4.1 A 决策).
 *
 * `box(width, depth, height)` — X=width, Y=depth, Z=height — places the
 * min-corner at the origin by default (`centered:false`). `centered: true`
 * centers the box at the origin; `at` is CENTER semantics and takes precedence
 * over `centered`. The `segments` option is consumed by the tessellation
 * caller (this mesh builder keeps it via clampNRad when present).
 *
 * @param params - box parameters (width/depth/height, optional at/centered/segments).
 * @returns the box shape.
 */
export function box(params: BoxParams): Shape {
  const { width, depth, height } = params
  // THREE.BoxGeometry(a, b, c) is Y-up (X=a, Y=b, Z=c); after the +90° rotateX
  // the dims map to X=a, Y=c, Z=b. To reach X=width, Y=depth, Z=height the
  // pre-rotation sizes must be (width, height, depth) — 裁决 7 xyz contract.
  const geo = new THREE.BoxGeometry(width, height, depth)
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  // brepjs box semantics: corner at origin by default; centered at origin when
  // `centered` (no `at`); `at` (CENTER semantics) takes precedence.
  const at = params.at
  let tx = 0
  let ty = 0
  let tz = 0
  if (at !== undefined) {
    ;[tx, ty, tz] = at
  } else if (!params.centered) {
    tx = width / 2
    ty = depth / 2
    tz = height / 2
  }
  if (tx !== 0 || ty !== 0 || tz !== 0) geo.translate(tx, ty, tz)
  return geoToShape(geo)
}

/**
 * Create a sphere centered at the origin (or the optional `center`).
 *
 * @param params - sphere parameters (radius, optional segments, optional center).
 * @returns the sphere shape.
 */
export function sphere(params: SphereParams): Shape {
  const segs = clampNRad(params.nRad ?? params.segments)
  const geo = makePrimitiveGeo('sphere', params.radius * 2, segs)
  if (params.center) {
    geo.translate(params.center[0], params.center[1], params.center[2])
  }
  return geoToShape(geo)
}

/**
 * Create a cylinder along +Z (`cylinder(radius, height, { at?, centered?,
 * segments? })` brepjs 契约，§4.3 A 决策；与 brep 路径逐点对齐）。
 *
 * 锚点：`at` 是**底面轴心**（BASE）语义（默认 [0,0,0]，底面在原点、+Z 延伸）；
 * `centered:true` 指底面落到 −h/2（无 at 时居中到原点）——与 `at` 同给时以
 * `at` 为中心。`segments` 经 clampNRad 消费（P0 §5）。
 *
 * @param params - cylinder parameters (radius, height, optional at/centered/segments).
 * @returns the cylinder shape.
 */
export function cylinder(params: CylinderParams): Shape {
  const segs = clampNRad(params.nRad ?? params.segments)
  const geo = new THREE.CylinderGeometry(params.radius, params.radius, params.height, segs)
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  // geometry（rotateX 后）沿 z ∈ [-h/2, +h/2]（three 默认 Y-up 居中）：
  // 目标底面中心 in baseZ = (at?.[2] ?? 0) - (centered ? h/2 : 0) → 平移到 baseZ + h/2。
  const baseX = params.at?.[0] ?? 0
  const baseY = params.at?.[1] ?? 0
  const baseZ = (params.at?.[2] ?? 0) - (params.centered === true ? params.height / 2 : 0)
  geo.translate(baseX, baseY, baseZ + params.height / 2)
  return geoToShape(geo)
}

/**
 * Create a cone, or a frustum when the top and bottom radii differ
 * (`cone(bottomRadius, topRadius, height, { at?, centered?, segments? })` brepjs
 * 契约，§4.1 P 决策；与 brep 路径逐点对齐）。
 *
 * 锚点：`at` 是**底面轴心**（BASE）语义（默认 [0,0,0]，底面在原点、+Z 延伸）；
 * `centered:true` 指底面落到 −h/2（无 at 时居中到原点）——与 `at` 同给时以
 * `at` 为中心。`segments` 经 clampNRad 消费（P0 §5）。
 *
 * @param params - cone parameters (radiusBottom, radiusTop, height, optional at/centered/segments).
 * @returns the cone shape.
 */
export function cone(params: ConeParams): Shape {
  const segs = clampNRad(params.nRad ?? params.segments)
  const geo = new THREE.ConeGeometry(
    Math.max(params.radiusBottom, params.radiusTop),
    params.height,
    segs,
  )
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  // radiusTop === 0 → 尖锥（ConeGeometry 顶点在顶）；其余（含 radiusTop ===
  // radiusBottom 的等径圆柱/圆台）用 CylinderGeometry（radiusTop/bottom 各就各位）。
  let resultGeo: THREE.BufferGeometry
  if (params.radiusTop === 0) {
    resultGeo = geo
  } else {
    const geo2 = new THREE.CylinderGeometry(
      params.radiusTop,
      params.radiusBottom,
      params.height,
      segs,
    )
    geo2.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    resultGeo = geo2
  }
  // geometry（rotateX 后）沿 z ∈ [-h/2, +h/2]（three 默认 Y-up 居中）：
  // 目标底面中心 in baseZ = (at?.[2] ?? 0) - (centered ? h/2 : 0) → 平坦平移 baseZ + h/2。
  const baseX = params.at?.[0] ?? 0
  const baseY = params.at?.[1] ?? 0
  const baseZ = (params.at?.[2] ?? 0) - (params.centered === true ? params.height / 2 : 0)
  resultGeo.translate(baseX, baseY, baseZ + params.height / 2)
  return geoToShape(resultGeo)
}

/**
 * Create a wedge (ramp) solid, fully parameterized and Z-up.
 *
 * @param params - wedge parameters (width, height, angle, length, optional center).
 * @returns the wedge shape.
 */
export function wedge(params: WedgeParams): Shape {
  const width = params.width
  const height = params.height
  const angle = params.angle
  const length = params.length

  const angleRad = (angle * Math.PI) / 180
  const halfExtrude = length / 2
  const hw = width / 2
  const halfTopWidth = Math.max(0, hw - height / Math.tan(angleRad))
  // 顶边塌缩（斜坡已在宽度内到顶）→ 三角棱柱（与 brep wedge 的退化处理一致，
  // 保证 mesh/brep 同参数 bbox 一致；零面积三角形会破坏 manifold）。
  const degenerate = halfTopWidth <= 1e-12

  const positions = degenerate
    ? new Float32Array([
        -halfExtrude, -hw, 0,
        -halfExtrude,  hw, 0,
        -halfExtrude,   0, height,
         halfExtrude, -hw, 0,
         halfExtrude,  hw, 0,
         halfExtrude,   0, height,
      ])
    : new Float32Array([
        -halfExtrude, -hw, 0,
        -halfExtrude,  hw, 0,
        -halfExtrude,  halfTopWidth, height,
        -halfExtrude, -halfTopWidth, height,
         halfExtrude, -hw, 0,
         halfExtrude,  hw, 0,
         halfExtrude,  halfTopWidth, height,
         halfExtrude, -halfTopWidth, height,
      ])

  const indices = degenerate
    ? new Uint32Array([
        0, 1, 2,  3, 5, 4,
        0, 3, 4,  0, 4, 1,
        0, 2, 5,  0, 5, 3,
        1, 4, 5,  1, 5, 2,
      ])
    : new Uint32Array([
        0, 1, 2,  0, 2, 3,
        4, 6, 5,  4, 7, 6,
        0, 4, 5,  0, 5, 1,
        3, 2, 6,  3, 6, 7,
        0, 3, 7,  0, 7, 4,
        1, 5, 6,  1, 6, 2,
      ])

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))

  if (params.center) {
    geo.translate(params.center[0], params.center[1], params.center[2])
  }
  return geoToShape(geo)
}

/**
 * Create text geometry. Font loading is asynchronous, so this function is
 * async; CJK text is rendered with the system font when one is available.
 *
 * @param params - text parameters (text, size, depth).
 * @returns the text shape.
 */
export async function text(params: TextParams): Promise<Shape> {
  const { getOpentypeFont, createTextGeometry } = await import(
    '../primitives/text-geometry'
  )
  const { containsCjk, loadSystemCjkFont, createMixedTextGeometry } = await import(
    '../primitives/text/cjk'
  )
  const font = await getOpentypeFont()
  let geo: THREE.BufferGeometry
  if (containsCjk(params.text)) {
    const cjkFont = await loadSystemCjkFont()
    if (cjkFont) {
      geo = await createMixedTextGeometry(params.text, params.size, params.depth, cjkFont.font, font)
    } else {
      // No CJK font available: replace CJK chars with '?' so geometry still
      // can be created (graceful degradation). Without this, createTextGeometry
      // would throw because CJK glyphs are .notdef in OpenSans Regular.
      const fallback = params.text.replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u2F800-\u2FA1F\u3000-\u303F\uFF00-\uFFEF]/g, '?')
      geo = await createTextGeometry(fallback, params.size, params.depth, font)
    }
  } else {
    geo = await createTextGeometry(params.text, params.size, params.depth, font)
  }
  return geoToShape(geo)
}

/**
 * Create a screw (threaded) geometry.
 *
 * @param params - screw parameters (system, specIdx, thread, length, head, optional pitchCustom and nRad).
 * @returns the screw shape.
 */
export async function screw(params: {
  system: 'metric' | 'imperial'
  specIdx: number
  thread: 'coarse' | 'fine' | 'custom' | 'none'
  pitchCustom?: number
  length: number
  head: 'hex' | 'chc' | 'none'
  nRad?: number
}): Promise<Shape> {
  const { makeScrew } = await import('../primitives/screw/screw')
  const geo = makeScrew({
    system: params.system,
    specIdx: params.specIdx,
    thread: params.thread,
    pitchCustom: params.pitchCustom ?? 0,
    length: params.length,
    head: params.head,
    nRad: clampNRad(params.nRad),
  })
  return geoToShape(geo)
}

/**
 * Create an extruded geometry from an SVG source.
 *
 * @param params - SVG extrude parameters (svg, depth, target size, optional natural size).
 * @returns the extruded shape.
 */
export function svgExtrude(params: SvgExtrudeParams): Shape {
  const geo = svgToExtrudedGeometry(params.svg, {
    depth: params.depth,
    targetLongSide: params.targetLongSide ?? 20,
    naturalWidth: params.naturalWidth ?? 0,
    naturalHeight: params.naturalHeight ?? 0,
  })
  return geoToShape(geo)
}

/**
 * Create a mesh from SDF (signed distance field) code, sampling the field with
 * marching cubes.
 *
 * @param params - SDF parameters (code, optional bounds, params, resolution).
 * @returns the sampled shape.
 */
export async function sdf(params: SdfParams): Promise<Shape> {
  const { runSdf } = await import('../sdf/sdf-runner')
  const box = params.box ?? [[-10, -10, -10], [10, 10, 10]]
  const bounds: [number, number, number, number, number, number] = [
    box[0][0], box[0][1], box[0][2],
    box[1][0], box[1][1], box[1][2],
  ]
  const mesh = await runSdf(
    params.code,
    params.params ?? {},
    bounds,
    params.resolution ?? 1.0,
  )
  return { positions: mesh.positions, indices: mesh.indices }
}
