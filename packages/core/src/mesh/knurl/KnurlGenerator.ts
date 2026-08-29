/**
 * KnurlGenerator — 滚花纹理位移管线编排器
 *
 * 完全照搬 stlTexturizer 的管线：subdivide → applyDisplacement。
 * 使用 knurling.jpg 作为位移纹理。
 *
 * 全程在 mesh 局部空间工作，不需要 world matrix 变换。
 */

import * as THREE from 'three'
import { subdivide } from './subdivision'
import { applyDisplacement, type DisplacementSettings } from './displacement'
import { loadKnurlingTexture, type TextureData } from './textureLoader'
import { MODE_TRIPLANAR } from './mapping'

// ── Types ──

export interface KnurlParams {
  /** 纹理高度 (mm)，默认 0.5 */
  textureHeight: number
  /** 反向（内推而非外推），默认 false */
  invertDisplacement: boolean
  /** 分辨率 (mm) — 细分后最大边长，默认 1.0 */
  refineLength: number
  /** U 缩放，默认 0.15（knurling 专用） */
  scaleU: number
  /** V 缩放，默认 0.15 */
  scaleV: number
  /** 投影模式，默认 5 (Triplanar) */
  mappingMode: number
  /** UV 偏移 U，默认 0 */
  offsetU?: number
  /** UV 偏移 V，默认 0 */
  offsetV?: number
  /** UV 旋转（度），默认 0 */
  rotation?: number
  /** 底面角度遮罩（度），默认 5 */
  bottomAngleLimit?: number
  /** 顶面角度遮罩（度），默认 0（不遮罩） */
  topAngleLimit?: number
  /** 接缝混合，默认 1 */
  mappingBlend?: number
  /** 接缝带宽，默认 0.5 */
  seamBandWidth?: number
  /** 面排除权重（By Surface 用），null = 不排除 */
  faceWeights?: Float32Array | null
}

/** 包围盒（与 mapping.ts / displacement.ts 的 Bounds 同构） */
export interface KnurlBounds {
  min: THREE.Vector3
  max: THREE.Vector3
  size: THREE.Vector3
  center: THREE.Vector3
}

export const KNURL_DEFAULTS: KnurlParams = {
  textureHeight: 0.5,
  invertDisplacement: false,
  refineLength: 1.0,
  scaleU: 0.15,
  scaleV: 0.15,
  mappingMode: MODE_TRIPLANAR,
  offsetU: 0,
  offsetV: 0,
  rotation: 0,
  bottomAngleLimit: 5,
  topAngleLimit: 0,
  mappingBlend: 1,
  seamBandWidth: 0.5,
  faceWeights: null,
}

/**
 * 对 geometry 应用 knurling 纹理位移。
 *
 * 管线：
 *   1. 加载 knurling 纹理 → ImageData
 *   2. subdivide(geometry, refineLength, faceWeights) → 细分后 geometry
 *   3. applyDisplacement(subdivided, imageData, settings, bounds) → 位移后 geometry
 *
 * 全程在 mesh 局部空间。
 */
export async function applyKnurlDisplacement(
  geometry: THREE.BufferGeometry,
  params: KnurlParams,
  onProgress?: (stage: string, p: number) => void,
  /** 外部传入的整体包围盒（默认从 geometry 计算）。
   *  传入整块部件的包围盒可使纹理密度与 GPU 预览一致
   *  （预览用整块部件 bbox 归一化，而这里 geometry 往往只是选中面子集）。 */
  boundsOverride?: KnurlBounds,
): Promise<THREE.BufferGeometry> {
  const {
    textureHeight,
    invertDisplacement,
    refineLength,
    scaleU,
    scaleV,
    mappingMode,
    offsetU = 0,
    offsetV = 0,
    rotation = 0,
    bottomAngleLimit = 5,
    topAngleLimit = 0,
    mappingBlend = 1,
    seamBandWidth = 0.5,
    faceWeights = null,
  } = params

  // 1. 加载纹理
  onProgress?.('texture', 0)
  let texData: TextureData | null
  try {
    texData = await loadKnurlingTexture()
  } catch (err) {
    console.error('[KnurlGenerator] Failed to load texture:', err)
    throw new Error(`Failed to load knurling texture: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }

  if (!texData) {
    throw new Error('[KnurlGenerator] No texture data available — TextureSampler port not injected')
  }

  // 2. 计算几何体边界（优先使用整块部件包围盒，使密度与预览一致）
  const bounds: KnurlBounds = boundsOverride
    ? { min: boundsOverride.min, max: boundsOverride.max, size: boundsOverride.size, center: boundsOverride.center }
    : (() => {
        geometry.computeBoundingBox()
        const bb = geometry.boundingBox!
        return {
          min: bb.min.clone(),
          max: bb.max.clone(),
          size: new THREE.Vector3().subVectors(bb.max, bb.min),
          center: new THREE.Vector3().addVectors(bb.min, bb.max).multiplyScalar(0.5),
        }
      })()

  // 3. 自适应细分：GPU 预览是逐像素 bump（无限分辨率），
  //    而实刻是真几何位移，受三角形密度限制。若 refineLength 大于滚花纹理
  //    的物理周期，网格采样不足会把细密菱形混叠成更低频、更稀疏的图案，
  //    看起来就比预览"密度低"。这里保证每瓦片至少 ~8 段，只在用户设得太
  //    粗时才自动加密——绝不会比用户设定的 refineLength 更粗。
  const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1e-6)
  const knurlPeriod = Math.max(maxDim * scaleU, 1e-6) // 单个纹理瓦片的物理尺寸 (mm)
  const minRefineForPattern = knurlPeriod / 8
  const effectiveRefine = Math.min(refineLength, Math.max(minRefineForPattern, 0.1))

  // 3. 细分
  onProgress?.('subdivide', 0)
  const { geometry: subdivided } = await subdivide(
    geometry,
    effectiveRefine,
    (p) => onProgress?.('subdivide', p),
    faceWeights,
  )

  // 4. 位移
  onProgress?.('displace', 0)
  const settings: DisplacementSettings = {
    mappingMode,
    scaleU,
    scaleV,
    offsetU,
    offsetV,
    rotation,
    // 与预览着色器 (knurlPreviewMaterial: h = h - 0.5) 保持一致：
    // 纹理以中灰为 0 的对称高度图，位移范围 [-amplitude/2, +amplitude/2]。
    amplitude: (invertDisplacement ? -1 : 1) * textureHeight,
    symmetricDisplacement: true,
    bottomAngleLimit,
    topAngleLimit,
    mappingBlend,
    seamBandWidth,
  }

  const result = applyDisplacement(
    subdivided,
    texData,
    texData.width,
    texData.height,
    settings,
    bounds,
    (p) => onProgress?.('displace', p),
  )

  // 5. 释放中间几何体
  subdivided.dispose()

  return result
}
