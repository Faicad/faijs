/**
 * mesh 雕刻 API
 *
 * 提取来源：engine/components/engraving/EngravingCore.ts
 *
 * 从 executeEngraving 中提取纯几何计算部分：
 * 1. 生成装饰几何（文字或 SVG）
 * 2. 定位到面
 * 3. 布尔运算（凸=union，凹=subtract）
 *
 * 不包含：store 读写、commitGeometry、undo snapshot、toast。
 * 这些由执行器负责（P1 不改变现有执行器行为）。
 */

import { Vec3 as Vec3C, Quat, Mat4 } from '../math3d'
import { transformShape, translateShape } from './meshdata/ops'
import { computeBoolean, geoToManifoldMesh, manifoldMeshToGeo } from '../boolean/csg-backend'
import { boundingBox } from './query'
import { getEngraveDecorationProvider } from './decoration-provider'
import type { Shape, EngraveParams, KnurlParams } from './types'

/**
 * Execute an engraving: generate the decoration geometry (text or SVG),
 * position it onto a face, then run a boolean union (convex) or subtract
 * (concave).
 *
 * The decoration geometry itself comes from the host-installed provider
 * (`setEngraveDecorationProvider`) — three's `Shape`/`ExtrudeGeometry`/`SVGLoader`
 * chain belongs to `@faicad/faijs-extra`, not to the platform surface.
 *
 * @param shape - the world-space target shape.
 * @param params - engrave parameters (text/svg, depth, face, mode).
 * @returns the engraved shape in world space.
 */
export async function engrave(shape: Shape, params: EngraveParams): Promise<Shape> {
  // 1. 生成装饰几何（局部空间，+Z = 挤出方向）
  if (!params.text && !params.svg) {
    throw new Error('engrave requires either text or svg')
  }
  const provider = getEngraveDecorationProvider()
  if (!provider) {
    throw new Error(
      'engrave: no mesh decoration provider installed — the text/SVG geometry chain ' +
      'lives in @faicad/faijs-extra; call setEngraveDecorationProvider() (or ' +
      'installEditorMeshProviders() from @faicad/faijs-extra) before engraving in mesh mode, ' +
      'or run the op on the BREP path',
    )
  }
  let decoration = await provider({
    text: params.text,
    textSize: params.textSize,
    svg: params.svg,
    svgSize: params.svgSize,
    svgNaturalWidth: params.svgNaturalWidth,
    svgNaturalHeight: params.svgNaturalHeight,
    depth: params.depth,
  })

  // 2. 定位装饰几何到面
  const faceCenter = new Vec3C(...params.face.center)
  const faceNormal = new Vec3C(...params.face.normal)

  // Center geometry at origin
  const bb = boundingBox(decoration)
  const center = new Vec3C(
    (bb.min[0] + bb.max[0]) / 2,
    (bb.min[1] + bb.max[1]) / 2,
    (bb.min[2] + bb.max[2]) / 2,
  )
  decoration = translateShape(decoration, -center.x, -center.y, -center.z)

  // Rotate +Z to align with face normal
  const quat = new Quat().setFromUnitVectors(
    new Vec3C(0, 0, 1),
    faceNormal,
  )
  const rotMatrix = new Mat4().makeRotationFromQuaternion(quat)
  decoration = transformShape(decoration, rotMatrix)

  // Offset along normal (convex = outward, concave = inward)
  const offset = params.mode === 'convex' ? params.depth / 2 : -params.depth / 2
  const pos = faceCenter.clone().add(faceNormal.clone().multiplyScalar(offset))
  decoration = translateShape(decoration, pos.x, pos.y, pos.z)

  // 3. 转换为 ManifoldMeshData
  const decorationData = geoToManifoldMesh(decoration)

  // 4. 布尔运算
  const op = params.mode === 'convex' ? 'union' : 'subtract'
  const result = await computeBoolean([shape, decorationData], op)

  return result
}

/**
 * Apply a knurling texture displacement to a shape (vertex displacement, not a
 * boolean op). The replay path approximates UI face selection by excluding
 * faces whose normal deviates from the given face normal; the angle limits act
 * as an angular mask.
 *
 * @param shape - the world-space shape to knurl.
 * @param params - knurl parameters (texture height, refine length, UV scale, mapping mode).
 * @returns the displaced shape in world space.
 */
export async function knurl(shape: Shape, params: KnurlParams): Promise<Shape> {
  const { applyKnurlDisplacement, KNURL_DEFAULTS } = await import(
    './knurl/KnurlGenerator'
  )

  // 1. Shape → Shape (with normals)
  const geo = manifoldMeshToGeo(shape, { computeNormals: true })

  // 2. 计算面排除权重：法向与 face.normal 不接近的面标记为排除
  const positions = geo.positions
  const triCount = positions.length / 3
  const faceNormal = new Vec3C(...params.face.normal).normalize()

  // 计算每个三角形的法向
  const indices = geo.indices.length > 0 ? geo.indices : null
  const faceWeights = new Float32Array(positions.length)

  const v0 = new Vec3C()
  const v1 = new Vec3C()
  const v2 = new Vec3C()
  const edge1 = new Vec3C()
  const edge2 = new Vec3C()
  const triNormal = new Vec3C()

  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t * 3] : t * 3
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2

    v0.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2])
    v1.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2])
    v2.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2])

    edge1.subVectors(v1, v0)
    edge2.subVectors(v2, v0)
    triNormal.crossVectors(edge1, edge2).normalize()

    // 法向相似度：dot > 0.5 (~60° within) → 不排除
    const dot = triNormal.dot(faceNormal)
    if (dot < 0.5) {
      faceWeights[t * 3] = 1.0
      faceWeights[t * 3 + 1] = 1.0
      faceWeights[t * 3 + 2] = 1.0
    }
  }

  // 3. 计算包围盒
  const bb = boundingBox(geo)
  const bbMin = new Vec3C(bb.min[0], bb.min[1], bb.min[2])
  const bbMax = new Vec3C(bb.max[0], bb.max[1], bb.max[2])
  const partBounds = {
    min: bbMin,
    max: bbMax,
    size: new Vec3C().subVectors(bbMax, bbMin),
    center: new Vec3C().addVectors(bbMin, bbMax).multiplyScalar(0.5),
  }

  // 4. 调用 applyKnurlDisplacement
  const result = await applyKnurlDisplacement(
    geo,
    {
      ...KNURL_DEFAULTS,
      textureHeight: params.knurlTextureHeight,
      invertDisplacement: params.knurlInvertDisplacement,
      refineLength: params.knurlRefineLength,
      scaleU: params.knurlScaleU,
      scaleV: params.knurlScaleV,
      mappingMode: params.knurlMappingMode,
      faceWeights,
    },
    undefined,
    partBounds,
  )

  // 5. Shape → ManifoldMeshData
  return geoToManifoldMesh(result)
}
