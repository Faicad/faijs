/**
 * cad-core 雕刻 API
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

import * as THREE from 'three'
import { computeBoolean, geoToManifoldMesh, manifoldMeshToGeo } from '../boolean/csg-backend'
import { svgToExtrudedGeometry } from '../primitives/svg-extrude'
import type { Shape, EngraveParams, KnurlParams } from './types'

/**
 * 执行雕刻：生成装饰几何 → 定位到面 → 布尔运算
 *
 * 输入：世界空间 Shape（目标几何）+ 雕刻参数
 * 输出：世界空间 Shape（雕刻结果）
 */
export async function engrave(shape: Shape, params: EngraveParams): Promise<Shape> {
  // 1. 生成装饰几何（局部空间，+Z = 挤出方向）
  let decorationGeo: THREE.BufferGeometry

  if (params.text) {
    if (!params.text) throw new Error('Text is empty')
    const { getOpentypeFont, createTextGeometry } = await import(
      '../primitives/text-geometry'
    )
    const { containsCjk, loadSystemCjkFont, createMixedTextGeometry } = await import(
      '../primitives/text/cjk'
    )
    const font = await getOpentypeFont()
    if (containsCjk(params.text)) {
      const cjkFont = await loadSystemCjkFont()
      if (cjkFont) {
        decorationGeo = await createMixedTextGeometry(
          params.text, params.textSize ?? 10, params.depth, cjkFont.font, font,
        )
      } else {
        decorationGeo = await createTextGeometry(
          params.text, params.textSize ?? 10, params.depth, font,
        )
      }
    } else {
      decorationGeo = await createTextGeometry(
        params.text, params.textSize ?? 10, params.depth, font,
      )
    }
  } else if (params.svg) {
    // logo / SVG
    decorationGeo = svgToExtrudedGeometry(params.svg, {
      depth: params.depth,
      targetLongSide: params.svgSize,
      naturalWidth: params.svgNaturalWidth ?? 0,
      naturalHeight: params.svgNaturalHeight ?? 0,
    })
  } else {
    throw new Error('engrave requires either text or svg')
  }

  // 2. 定位装饰几何到面
  const faceCenter = new THREE.Vector3(...params.face.center)
  const faceNormal = new THREE.Vector3(...params.face.normal)

  // Center geometry at origin
  decorationGeo.computeBoundingBox()
  const center = new THREE.Vector3()
  decorationGeo.boundingBox!.getCenter(center)
  decorationGeo.translate(-center.x, -center.y, -center.z)

  // Rotate +Z to align with face normal
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    faceNormal,
  )
  decorationGeo.applyQuaternion(quat)

  // Offset along normal (convex = outward, concave = inward)
  const offset = params.mode === 'convex' ? params.depth / 2 : -params.depth / 2
  const pos = faceCenter.clone().add(faceNormal.clone().multiplyScalar(offset))
  decorationGeo.translate(pos.x, pos.y, pos.z)

  // 3. 转换为 ManifoldMeshData
  const decorationData = geoToManifoldMesh(decorationGeo)

  // 4. 布尔运算
  const op = params.mode === 'convex' ? 'union' : 'subtract'
  const result = await computeBoolean([shape, decorationData], op)

  // 5. 清理
  decorationGeo.dispose()

  return result
}

/**
 * 执行滚花（位移变形，非布尔）
 *
 * 从 KnurlGenerator.applyKnurlDisplacement 提取纯几何计算：
 * 1. Shape → THREE.BufferGeometry
 * 2. 基于 face.normal 计算面排除权重（近似 UI 路径的 face selection）
 * 3. 调用 applyKnurlDisplacement（细分 + 位移）
 * 4. THREE.BufferGeometry → Shape
 *
 * 与 UI 路径的差异：
 * - UI 路径使用 detectPlanes + 用户选面，精确排除非选中面
 * - 重放路径使用 faceNormal 近似匹配，对法向接近的面施加位移
 * - bottomAngleLimit/topAngleLimit 提供角度遮罩，减少差异
 */
export async function knurl(shape: Shape, params: KnurlParams): Promise<Shape> {
  const { applyKnurlDisplacement, KNURL_DEFAULTS } = await import(
    './knurl/KnurlGenerator'
  )

  // 1. Shape → THREE.BufferGeometry
  const geo = manifoldMeshToGeo(shape, { computeNormals: true })

  // 2. 计算面排除权重：法向与 face.normal 不接近的面标记为排除
  const posAttr = geo.getAttribute('position')
  const triCount = posAttr.count / 3
  const faceNormal = new THREE.Vector3(...params.face.normal).normalize()

  // 计算每个三角形的法向
  const positions = posAttr.array as Float32Array
  const indices = geo.index ? (geo.index.array as Uint32Array) : null
  const faceWeights = new Float32Array(posAttr.count)

  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const triNormal = new THREE.Vector3()

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
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const partBounds = {
    min: bb.min.clone(),
    max: bb.max.clone(),
    size: new THREE.Vector3().subVectors(bb.max, bb.min),
    center: new THREE.Vector3().addVectors(bb.min, bb.max).multiplyScalar(0.5),
  }

  // 4. 调用 applyKnurlDisplacement
  const resultGeo = await applyKnurlDisplacement(
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

  geo.dispose()

  // 5. THREE.BufferGeometry → Shape
  return geoToManifoldMesh(resultGeo)
}
