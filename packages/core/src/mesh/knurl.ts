/**
 * mesh 滚花（knurl）API
 *
 * 顶点位移实现：不做布尔，直接在 mesh 局部空间沿面法向位移。
 * 2026-10-28：旧 `engrave()`（文字/SVG 装饰体 + union/subtract 布尔）随
 * `cad.engrave` 退役删除——线上路径已收敛到 `cad.text` / `cad.svgExtrude` /
 * `cad.dxfExtrude`（轮廓体）+ `cad.subtract`（唯一必需布尔）的组合，不再需要
 * mesh 装饰链。本文件只保留滚花。
 */

import { Vec3 as Vec3C } from '../math3d'
import { boundingBox } from './query'
import { geoToManifoldMesh, manifoldMeshToGeo } from '../boolean/csg-backend'
import type { Shape, KnurlParams } from './types'

/**
 * Apply a knurling texture displacement to a shape (vertex displacement, not a
 * boolean op). The replay path approximates UI face selection by excluding
 * faces whose normal deviates from the given face normal; the angle limits act
 * as an angular mask.
 *
 * @param shape - the world-space shape.
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
