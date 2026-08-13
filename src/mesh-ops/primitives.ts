/**
 * cad-core 基本体 API — 从现有纯函数提取的统一接口
 *
 * 提取来源（§5.7）：
 * - box/sphere/cylinder/cone/wedge ← engine/primitives/geometry.ts (makePrimitiveGeo)
 * - text ← engine/components/engraving/EngravingCore.ts (createTextGeometry)
 * - screw ← engine/primitives/screw/screw.ts (makeScrew)
 * - svgExtrude ← engine/primitives/svg-extrude/ (svgToExtrudedGeometry)
 *
 * 所有函数返回 Shape (ManifoldMeshData)：THREE.BufferGeometry → geoToManifoldMesh 转换。
 * 坐标系：Z-up、毫米。
 */

import * as THREE from 'three'
import { makePrimitiveGeo } from '../primitives/geometry'
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

/** 创建立方体 */
export function box(params: BoxParams): Shape {
  let geo: THREE.BufferGeometry
  if (Array.isArray(params.size)) {
    // Vec3 size: 创建非等边立方体
    const [w, h, d] = params.size
    geo = new THREE.BoxGeometry(w, h, d)
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  } else {
    geo = makePrimitiveGeo('cube', params.size)
  }
  if (params.center) {
    geo.translate(params.center[0], params.center[1], params.center[2])
  }
  return geoToShape(geo)
}

/** 创建球体 */
export function sphere(params: SphereParams): Shape {
  const segs = clampNRad(params.nRad ?? params.segments)
  const geo = makePrimitiveGeo('sphere', params.radius * 2, segs)
  if (params.center) {
    geo.translate(params.center[0], params.center[1], params.center[2])
  }
  return geoToShape(geo)
}

/** 创建圆柱体 */
export function cylinder(params: CylinderParams): Shape {
  // makePrimitiveGeo('cylinder', size) 使用 size 作为直径和高度
  // cad-core API 分离 radius 和 height，需要直接构建
  const segs = clampNRad(params.nRad ?? params.segments)
  const geo = new THREE.CylinderGeometry(params.radius, params.radius, params.height, segs)
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  if (params.center) {
    geo.translate(params.center[0], params.center[1], params.center[2])
  }
  return geoToShape(geo)
}

/** 创建圆锥体 */
export function cone(params: ConeParams): Shape {
  const segs = clampNRad(params.nRad ?? params.segments)
  const geo = new THREE.ConeGeometry(
    Math.max(params.radiusBottom, params.radiusTop),
    params.height,
    segs,
  )
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  // ConeGeometry 只支持一个半径；如果 radiusBottom != radiusTop，需要用 CylinderGeometry
  let resultGeo: THREE.BufferGeometry
  if (params.radiusBottom !== params.radiusTop) {
    const geo2 = new THREE.CylinderGeometry(
      params.radiusTop,
      params.radiusBottom,
      params.height,
      segs,
    )
    geo2.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    resultGeo = geo2
  } else {
    resultGeo = geo
  }
  if (params.center) {
    resultGeo.translate(params.center[0], params.center[1], params.center[2])
  }
  return geoToShape(resultGeo)
}

/** 创建楔形体（全参数，与 WedgePanel.buildWedgeGeometry 等价，Z-up） */
export function wedge(params: WedgeParams): Shape {
  const width = params.width
  const height = params.height
  const angle = params.angle
  const length = params.length

  const angleRad = (angle * Math.PI) / 180
  const halfExtrude = length / 2
  const hw = width / 2
  const halfTopWidth = Math.max(0, hw - height / Math.tan(angleRad))

  const positions = new Float32Array([
    -halfExtrude, -hw, 0,
    -halfExtrude,  hw, 0,
    -halfExtrude,  halfTopWidth, height,
    -halfExtrude, -halfTopWidth, height,
     halfExtrude, -hw, 0,
     halfExtrude,  hw, 0,
     halfExtrude,  halfTopWidth, height,
     halfExtrude, -halfTopWidth, height,
  ])

  const indices = new Uint32Array([
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
 * 创建文字几何体
 *
 * 注意：字体加载是异步的（FontLoader），所以此函数是 async。
 * P3+ 迁移到 worker 后，字体通过 bufferKey 加载。
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
      geo = await createTextGeometry(params.text, params.size, params.depth, font)
    }
  } else {
    geo = await createTextGeometry(params.text, params.size, params.depth, font)
  }
  return geoToShape(geo)
}

/** 创建螺丝几何体 */
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

/** 从 SVG 创建拉伸几何体 */
export function svgExtrude(params: SvgExtrudeParams): Shape {
  const geo = svgToExtrudedGeometry(params.svg, {
    depth: params.depth,
    targetLongSide: params.targetLongSide ?? 20,
    naturalWidth: params.naturalWidth ?? 0,
    naturalHeight: params.naturalHeight ?? 0,
  })
  return geoToShape(geo)
}

/** 从 SDF 代码创建几何体 */
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
