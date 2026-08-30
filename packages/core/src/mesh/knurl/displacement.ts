/**
 * displacement.ts — 纹理位移核心，从 stlTexturizer/js/displacement.js 移植为 TS（简化版）。
 *
 * 对每个顶点：
 *   1. 用与 GPU 预览 shader 相同的数学计算 UV（mapping.ts）
 *   2. 双线性采样灰度 ImageData
 *   3. 沿平滑法线位移：grey × amplitude
 *
 * 简化：去掉了 boundaryFalloff、blendNormalSmoothing、cubic zoneArea 等。
 * 保留了核心水密性保证：同位置顶点使用相同平滑法线 + 相同位移值。
 */

import * as THREE from 'three'
import { QuantizedPointMap } from './meshIndex'
import { computeUV, getCubicBlendWeights, type MappingSettings } from './mapping'

/**
 * Displacement settings: the mapping settings plus the amplitude, optional
 * symmetric displacement, and angle-based face-masking limits.
 */
export interface DisplacementSettings extends MappingSettings {
  mappingMode: number
  amplitude: number
  symmetricDisplacement?: boolean
  bottomAngleLimit?: number
  topAngleLimit?: number
}

interface Bounds {
  min: THREE.Vector3
  max: THREE.Vector3
  center: THREE.Vector3
  size: THREE.Vector3
}

interface ImageDataLike {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

/**
 * Displace every vertex of a non-indexed BufferGeometry. For each vertex the
 * UV is computed with the same math as the GPU preview shader, the greyscale
 * ImageData is sampled bilinearly, and the position is shifted along the
 * smoothed normal by grey × amplitude.
 *
 * @param geometry - the non-indexed source geometry (position + normal attributes).
 * @param imageData - RGBA pixel data of the height map.
 * @param imgWidth - texture width in pixels.
 * @param imgHeight - texture height in pixels.
 * @param settings - displacement and mapping settings.
 * @param bounds - overall mesh bounds used to normalize UV coordinates.
 * @param onProgress - optional callback receiving progress in [0, 1].
 * @returns a new BufferGeometry with displaced positions and face normals.
 */
export function applyDisplacement(
  geometry: THREE.BufferGeometry,
  imageData: ImageDataLike,
  imgWidth: number,
  imgHeight: number,
  settings: DisplacementSettings,
  bounds: Bounds,
  onProgress?: (p: number) => void,
): THREE.BufferGeometry {
  const posAttr = geometry.attributes.position
  const nrmAttr = geometry.attributes.normal
  const count = posAttr.count

  const newPos = new Float32Array(count * 3)
  const newNrm = new Float32Array(count * 3)

  const tmpPos = new THREE.Vector3()
  const tmpNrm = new THREE.Vector3()
  const vA = new THREE.Vector3()
  const vB = new THREE.Vector3()
  const vC = new THREE.Vector3()
  const edge1 = new THREE.Vector3()
  const edge2 = new THREE.Vector3()
  const faceNrm = new THREE.Vector3()

  // 纹理纵横比校正
  const tmax = Math.max(imgWidth, imgHeight, 1)
  const aspectU = tmax / Math.max(imgWidth, 1)
  const aspectV = tmax / Math.max(imgHeight, 1)
  const settingsWithAspect = { ...settings, textureAspectU: aspectU, textureAspectV: aspectV }

  // 10μm 顶点去重
  const QUANT = 1e5

  // ── 顶点去重：position → numeric ID ──
  const dedupMap = new QuantizedPointMap(QUANT, Math.min(count, 1 << 22))
  let nextId = 0
  const vertexId = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i),
      y = posAttr.getY(i),
      z = posAttr.getZ(i)
    const id = dedupMap.getOrSet(x, y, z, nextId)
    if (dedupMap.inserted) nextId++
    vertexId[i] = id
  }
  const uniqueCount = nextId

  // ── Pass 1: 每个唯一顶点累加面积加权平滑法线 ──
  const smoothNrmX = new Float64Array(uniqueCount)
  const smoothNrmY = new Float64Array(uniqueCount)
  const smoothNrmZ = new Float64Array(uniqueCount)

  // 角度遮罩
  const maskedFracMasked = new Float64Array(uniqueCount)
  const maskedFracTotal = new Float64Array(uniqueCount)

  // 面排除权重
  const ewAttr = geometry.attributes.excludeWeight || null
  const userExcludedFaces = ewAttr ? new Uint8Array(count / 3) : null
  const excludedPos = ewAttr ? new Uint8Array(uniqueCount) : null

  for (let t = 0; t < count; t += 3) {
    vA.fromBufferAttribute(posAttr, t)
    vB.fromBufferAttribute(posAttr, t + 1)
    vC.fromBufferAttribute(posAttr, t + 2)
    edge1.subVectors(vB, vA)
    edge2.subVectors(vC, vA)
    faceNrm.crossVectors(edge1, edge2)

    const faceArea = faceNrm.length()
    const faceNzNorm = faceArea > 1e-12 ? faceNrm.z / faceArea : 0
    const faceAngle = Math.acos(Math.abs(faceNzNorm)) * (180 / Math.PI)
    const angleMasked =
      faceNzNorm < 0
        ? (settings.bottomAngleLimit ?? 0) > 0 &&
          faceAngle <= (settings.bottomAngleLimit ?? 0)
        : (settings.topAngleLimit ?? 0) > 0 &&
          faceAngle <= (settings.topAngleLimit ?? 0)

    const userExcluded = ewAttr
      ? (ewAttr.getX(t) + ewAttr.getX(t + 1) + ewAttr.getX(t + 2)) / 3 > 0.99
      : false
    const faceMasked = angleMasked
    if (userExcluded && userExcludedFaces) userExcludedFaces[t / 3] = 1

    for (let v = 0; v < 3; v++) {
      const vid = vertexId[t + v]
      if (userExcluded && excludedPos) excludedPos[vid] = 1
      tmpNrm.fromBufferAttribute(nrmAttr, t + v)
      smoothNrmX[vid] += tmpNrm.x * faceArea
      smoothNrmY[vid] += tmpNrm.y * faceArea
      smoothNrmZ[vid] += tmpNrm.z * faceArea
      if (faceMasked) maskedFracMasked[vid] += faceArea
      maskedFracTotal[vid] += faceArea
    }
  }

  // 归一化平滑法线
  for (let id = 0; id < uniqueCount; id++) {
    const len = Math.sqrt(
      smoothNrmX[id] * smoothNrmX[id] +
        smoothNrmY[id] * smoothNrmY[id] +
        smoothNrmZ[id] * smoothNrmZ[id],
    )
    const inv = len > 0 ? 1 / len : 1
    smoothNrmX[id] *= inv
    smoothNrmY[id] *= inv
    smoothNrmZ[id] *= inv
  }

  // ── Pass 2: 每个唯一顶点采样纹理一次 ──
  const dispCacheVal = new Float64Array(uniqueCount)
  const dispCacheSet = new Uint8Array(uniqueCount)

  for (let i = 0; i < count; i++) {
    const vid = vertexId[i]
    if (dispCacheSet[vid]) continue
    dispCacheSet[vid] = 1

    tmpPos.fromBufferAttribute(posAttr, i)

    // Cubic 模式特殊处理
    if (settings.mappingMode === 6) {
      const md = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1e-6)
      const rotRad = (settings.rotation ?? 0) * Math.PI / 180
      const cubicBlend = settings.mappingBlend ?? 0
      const cubicBandWidth = settings.seamBandWidth ?? 0.35

      const sn = {
        x: smoothNrmX[vid],
        y: smoothNrmY[vid],
        z: smoothNrmZ[vid],
      }
      const w = getCubicBlendWeights(sn, cubicBlend, cubicBandWidth)

      if (w.x + w.y + w.z > 0) {
        let grey = 0
        if (w.x > 0) {
          let rawU = (tmpPos.y - bounds.min.y) / md
          if (smoothNrmX[vid] < 0) rawU = -rawU
          const uv = _cubicUV(rawU, (tmpPos.z - bounds.min.z) / md, settings, rotRad, aspectU, aspectV)
          grey += sampleBilinear(imageData.data, imgWidth, imgHeight, uv.u, uv.v) * w.x
        }
        if (w.y > 0) {
          let rawU = (tmpPos.x - bounds.min.x) / md
          if (smoothNrmY[vid] > 0) rawU = -rawU
          const uv = _cubicUV(rawU, (tmpPos.z - bounds.min.z) / md, settings, rotRad, aspectU, aspectV)
          grey += sampleBilinear(imageData.data, imgWidth, imgHeight, uv.u, uv.v) * w.y
        }
        if (w.z > 0) {
          let rawU = (tmpPos.x - bounds.min.x) / md
          if (smoothNrmZ[vid] < 0) rawU = -rawU
          const uv = _cubicUV(rawU, (tmpPos.y - bounds.min.y) / md, settings, rotRad, aspectU, aspectV)
          grey += sampleBilinear(imageData.data, imgWidth, imgHeight, uv.u, uv.v) * w.z
        }
        dispCacheVal[vid] = grey
        continue
      }
    }

    // 其他模式：用平滑法线计算 UV
    tmpNrm.set(smoothNrmX[vid], smoothNrmY[vid], smoothNrmZ[vid])

    const uvResult = computeUV(tmpPos, tmpNrm, settings.mappingMode, settingsWithAspect, bounds)
    let grey: number
    if (uvResult.triplanar && uvResult.samples) {
      grey = 0
      for (const s of uvResult.samples) {
        grey += sampleBilinear(imageData.data, imgWidth, imgHeight, s.u, s.v) * s.w
      }
    } else {
      grey = sampleBilinear(imageData.data, imgWidth, imgHeight, uvResult.u, uvResult.v)
    }
    dispCacheVal[vid] = grey
  }

  // ── Pass 3: 每个顶点副本沿平滑法线位移 ──
  const REPORT_EVERY = 5000

  for (let i = 0; i < count; i++) {
    tmpPos.fromBufferAttribute(posAttr, i)
    tmpNrm.fromBufferAttribute(nrmAttr, i)

    const vid = vertexId[i]
    const grey = dispCacheVal[vid]

    const isFaceExcluded = userExcludedFaces && userExcludedFaces[Math.floor(i / 3)]
    const isSealedBoundary = !isFaceExcluded && excludedPos && excludedPos[vid] === 1
    const mfTotal = maskedFracTotal[vid]
    const maskedFrac = mfTotal > 0 ? maskedFracMasked[vid] / mfTotal : 0
    const centeredGrey = settings.symmetricDisplacement ? grey - 0.5 : grey
    const disp =
      isFaceExcluded || isSealedBoundary
        ? 0
        : (1 - maskedFrac) * centeredGrey * settings.amplitude

    const newX = tmpPos.x + smoothNrmX[vid] * disp
    const newY = tmpPos.y + smoothNrmY[vid] * disp
    let newZ = tmpPos.z + smoothNrmZ[vid] * disp

    // 防止边界顶点穿过遮罩表面
    if (maskedFrac > 0) {
      if ((settings.bottomAngleLimit ?? 0) > 0 && newZ < tmpPos.z) newZ = tmpPos.z
      if ((settings.topAngleLimit ?? 0) > 0 && newZ > tmpPos.z) newZ = tmpPos.z
    }

    newPos[i * 3] = newX
    newPos[i * 3 + 1] = newY
    newPos[i * 3 + 2] = newZ

    newNrm[i * 3] = tmpNrm.x
    newNrm[i * 3 + 1] = tmpNrm.y
    newNrm[i * 3 + 2] = tmpNrm.z

    if (onProgress && i % REPORT_EVERY === 0) onProgress(i / count)
  }

  // 从位移后位置计算精确的面法线
  const eA = new THREE.Vector3()
  const eB = new THREE.Vector3()
  const fn = new THREE.Vector3()
  for (let t = 0; t < count; t += 3) {
    const ax = newPos[t * 3],
      ay = newPos[t * 3 + 1],
      az = newPos[t * 3 + 2]
    const bx = newPos[t * 3 + 3],
      by = newPos[t * 3 + 4],
      bz = newPos[t * 3 + 5]
    const cx = newPos[t * 3 + 6],
      cy = newPos[t * 3 + 7],
      cz = newPos[t * 3 + 8]
    eA.set(bx - ax, by - ay, bz - az)
    eB.set(cx - ax, cy - ay, cz - az)
    fn.crossVectors(eA, eB).normalize()
    for (let v = 0; v < 3; v++) {
      newNrm[(t + v) * 3] = fn.x
      newNrm[(t + v) * 3 + 1] = fn.y
      newNrm[(t + v) * 3 + 2] = fn.z
    }
  }

  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(newPos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(newNrm, 3))
  return out
}

// ── 双线性采样 ──

function sampleBilinear(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  u: number,
  v: number,
): number {
  u = ((u % 1) + 1) % 1
  v = ((v % 1) + 1) % 1
  v = 1 - v

  const fx = u * w - 0.5
  const fy = v * h - 0.5
  let x0 = Math.floor(fx)
  let y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const x1 = (x0 + 1 + w) % w
  const y1 = (y0 + 1 + h) % h
  x0 = ((x0 % w) + w) % w
  y0 = ((y0 % h) + h) % h

  const v00 = data[(y0 * w + x0) * 4] / 255
  const v10 = data[(y0 * w + x1) * 4] / 255
  const v01 = data[(y1 * w + x0) * 4] / 255
  const v11 = data[(y1 * w + x1) * 4] / 255

  return (
    v00 * (1 - tx) * (1 - ty) +
    v10 * tx * (1 - ty) +
    v01 * (1 - tx) * ty +
    v11 * tx * ty
  )
}

function _cubicUV(
  rawU: number,
  rawV: number,
  settings: DisplacementSettings,
  rotRad: number,
  aspectU: number,
  aspectV: number,
): { u: number; v: number } {
  let u = (rawU * aspectU) / settings.scaleU + settings.offsetU
  let v = (rawV * aspectV) / settings.scaleV + settings.offsetV
  if (rotRad !== 0) {
    const c = Math.cos(rotRad),
      s = Math.sin(rotRad)
    u -= 0.5
    v -= 0.5
    const ru = c * u - s * v,
      rv = s * u + c * v
    u = ru + 0.5
    v = rv + 0.5
  }
  return { u: u - Math.floor(u), v: v - Math.floor(v) }
}
