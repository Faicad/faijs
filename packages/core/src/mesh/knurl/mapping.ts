/**
 * mapping.ts — CPU 侧 UV 投影，从 stlTexturizer/js/mapping.js 移植为 TS。
 *
 * 所有函数接受 {x,y,z} 格式的 position/normal 和 bounds 对象。
 */

/** Planar projection mode projecting onto the XY plane (normal ≈ Z axis). */
export const MODE_PLANAR_XY = 0
/** Planar projection mode projecting onto the XZ plane (normal ≈ Y axis). */
export const MODE_PLANAR_XZ = 1
/** Planar projection mode projecting onto the YZ plane (normal ≈ X axis). */
export const MODE_PLANAR_YZ = 2
/** Cylindrical projection mode around the vertical axis. */
export const MODE_CYLINDRICAL = 3
/** Spherical projection mode around the bounds center. */
export const MODE_SPHERICAL = 4
/** Triplanar projection mode blending the three axial planar projections. */
export const MODE_TRIPLANAR = 5
/** Cubic projection mode with one dominant axis and seam blending. */
export const MODE_CUBIC = 6

const TWO_PI = Math.PI * 2
const CUBIC_AXIS_EPSILON = 1e-4

interface Vec3 {
  x: number
  y: number
  z: number
}

interface Bounds {
  min: Vec3
  max: Vec3
  center: Vec3
  size: Vec3
}

/**
 * UV mapping settings: per-axis scale and offset, rotation, the optional
 * texture aspect ratio, seam blend and band width, plus the optional cylinder
 * parameters used by the cylindrical mode.
 */
export interface MappingSettings {
  scaleU: number
  scaleV: number
  offsetU: number
  offsetV: number
  rotation?: number
  textureAspectU?: number
  textureAspectV?: number
  mappingBlend?: number
  seamBandWidth?: number
  capAngle?: number
  cylinderCenterX?: number
  cylinderCenterY?: number
  cylinderRadius?: number
}

/**
 * A single UV sample paired with a blend weight, used when a projection
 * returns several weighted planes (triplanar or seam blending).
 */
export interface UVSample {
  u: number
  v: number
  w: number
}

/**
 * Result of a UV projection: either a single transformed UV pair, or a flag
 * plus a list of weighted samples for multi-plane projections.
 */
export interface UVResult {
  u: number
  v: number
  triplanar?: boolean
  samples?: UVSample[]
}

/**
 * Pick the dominant axis of a normal for cubic projection.
 *
 * @param normal - the vertex normal (unit length not required).
 * @returns the axis with the largest absolute component, preferring x then y.
 */
export function getDominantCubicAxis(normal: Vec3): 'x' | 'y' | 'z' {
  const ax = Math.abs(normal.x)
  const ay = Math.abs(normal.y)
  const az = Math.abs(normal.z)
  if (ax >= ay - CUBIC_AXIS_EPSILON && ax >= az - CUBIC_AXIS_EPSILON) return 'x'
  if (ay >= az - CUBIC_AXIS_EPSILON) return 'y'
  return 'z'
}

/**
 * Compute per-axis blend weights for cubic projection, softening the seams
 * between the dominant axis and the secondary axes.
 *
 * @param normal - the vertex normal.
 * @param blend - blend amount in [0, 1]; 0 keeps a single dominant axis.
 * @param seamBandWidth - width of the seam-blend band.
 * @returns the x/y/z blend weights, summing to 1.
 */
export function getCubicBlendWeights(
  normal: Vec3,
  blend: number,
  seamBandWidth: number = 0.35,
): { x: number; y: number; z: number } {
  const axis = getDominantCubicAxis(normal)
  const ax = Math.abs(normal.x)
  const ay = Math.abs(normal.y)
  const az = Math.abs(normal.z)
  const primary = axis === 'x' ? ax : axis === 'y' ? ay : az
  const secondary =
    axis === 'x'
      ? Math.max(ay, az)
      : axis === 'y'
        ? Math.max(ax, az)
        : Math.max(ax, ay)

  if (blend <= 0.001) {
    return {
      x: axis === 'x' ? 1 : 0,
      y: axis === 'y' ? 1 : 0,
      z: axis === 'z' ? 1 : 0,
    }
  }

  const oneHot = {
    x: axis === 'x' ? 1 : 0,
    y: axis === 'y' ? 1 : 0,
    z: axis === 'z' ? 1 : 0,
  }

  const seamWidth = Math.max(seamBandWidth, CUBIC_AXIS_EPSILON * 2)
  const seamMixRaw = 1 - Math.min(1, Math.max(0, (primary - secondary) / seamWidth))
  const seamMix = blend * seamMixRaw * seamMixRaw * (3 - 2 * seamMixRaw)
  if (seamMix <= 0.001) return oneHot

  const power = 1 + (1 - seamMix) * 11
  const sx = Math.pow(ax, power)
  const sy = Math.pow(ay, power)
  const sz = Math.pow(az, power)
  const smoothSum = sx + sy + sz + 1e-6
  const smooth = {
    x: sx / smoothSum,
    y: sy / smoothSum,
    z: sz / smoothSum,
  }

  const mx = oneHot.x * (1 - seamMix) + smooth.x * seamMix
  const my = oneHot.y * (1 - seamMix) + smooth.y * seamMix
  const mz = oneHot.z * (1 - seamMix) + smooth.z * seamMix
  const sum = mx + my + mz

  return {
    x: mx / sum,
    y: my / sum,
    z: mz / sum,
  }
}

/**
 * Compute the normalized tiling UV coordinates [0, 1) for a vertex under the
 * requested projection mode.
 *
 * @param pos - the vertex position.
 * @param normal - the vertex normal.
 * @param mode - projection mode constant (planar, cylindrical, spherical, triplanar, or cubic).
 * @param settings - mapping settings for scale, offset, and rotation.
 * @param bounds - the mesh bounds used to normalize coordinates.
 * @returns the UV result (a single pair or weighted samples).
 */
export function computeUV(
  pos: Vec3,
  normal: Vec3,
  mode: number,
  settings: MappingSettings,
  bounds: Bounds,
): UVResult {
  const { min, size, center } = bounds
  const aU = settings.textureAspectU ?? 1
  const aV = settings.textureAspectV ?? 1
  const scaleU = settings.scaleU / aU
  const scaleV = settings.scaleV / aV
  const { offsetU, offsetV } = settings
  const rotRad = (settings.rotation ?? 0) * Math.PI / 180
  const cosR = Math.cos(rotRad)
  const sinR = Math.sin(rotRad)
  const maxDim = Math.max(size.x, size.y, size.z)
  const md = Math.max(maxDim, 1e-6)

  let u: number, v: number

  switch (mode) {
    case MODE_PLANAR_XY: {
      u = (pos.x - min.x) / md
      v = (pos.y - min.y) / md
      break
    }

    case MODE_PLANAR_XZ: {
      u = (pos.x - min.x) / md
      v = (pos.z - min.z) / md
      break
    }

    case MODE_PLANAR_YZ: {
      u = (pos.y - min.y) / md
      v = (pos.z - min.z) / md
      break
    }

    case MODE_CYLINDRICAL: {
      const cx = settings.cylinderCenterX ?? center.x
      const cy = settings.cylinderCenterY ?? center.y
      const r = Math.max(
        settings.cylinderRadius ?? Math.max(size.x, size.y) * 0.5,
        1e-6,
      )
      const C = TWO_PI * r
      const rx = pos.x - cx
      const ry = pos.y - cy
      const blend = settings.mappingBlend ?? 0.0
      const theta = Math.atan2(ry, rx)
      const uRaw = theta / TWO_PI + 0.5
      const vSide = (pos.z - min.z) / C

      const seamBand = (settings.seamBandWidth ?? 0.5) * 0.1
      const seamDist = Math.min(uRaw, 1.0 - uRaw)
      const inSeamZone = seamBand > 0.001 && seamDist < seamBand

      let sideSamples: UVSample[]
      if (inSeamZone) {
        const d = uRaw < 0.5 ? uRaw : uRaw - 1.0
        const tRaw = (d + seamBand) / (2.0 * seamBand)
        const t = tRaw * tRaw * (3 - 2 * tRaw)
        const tLeft = applyTransform(1.0 + d, vSide, scaleU, scaleV, offsetU, offsetV, cosR, sinR)
        const tRight = applyTransform(d, vSide, scaleU, scaleV, offsetU, offsetV, cosR, sinR)
        sideSamples = [
          { u: tRight.u, v: tRight.v, w: t },
          { u: tLeft.u, v: tLeft.v, w: 1 - t },
        ]
      } else {
        const tSide = applyTransform(uRaw, vSide, scaleU, scaleV, offsetU, offsetV, cosR, sinR)
        sideSamples = [{ u: tSide.u, v: tSide.v, w: 1 }]
      }

      if (blend <= 0.001) {
        if (sideSamples.length === 1 && sideSamples[0].w === 1) return sideSamples[0]
        return { triplanar: true, samples: sideSamples, u: 0, v: 0 }
      }

      const capThreshold = Math.cos((settings.capAngle ?? 20) * Math.PI / 180)
      const blendHalf = (settings.seamBandWidth ?? 0.5) * 0.5
      const absnz = Math.abs(normal.z)
      const capW = Math.max(0, Math.min(1, (absnz - (capThreshold - blendHalf)) / (2 * blendHalf + 1e-6)))

      if (capW <= 0) {
        if (sideSamples.length === 1 && sideSamples[0].w === 1) return sideSamples[0]
        return { triplanar: true, samples: sideSamples, u: 0, v: 0 }
      }

      const uCap = rx / C + 0.5
      const vCap = ry / C + 0.5
      const tCap = applyTransform(uCap, vCap, scaleU, scaleV, offsetU, offsetV, cosR, sinR)

      if (capW >= 1) return tCap

      const samples = sideSamples.map((s) => ({ u: s.u, v: s.v, w: s.w * (1 - capW) }))
      samples.push({ u: tCap.u, v: tCap.v, w: capW })
      return { triplanar: true, samples, u: 0, v: 0 }
    }

    case MODE_SPHERICAL: {
      const rx = pos.x - center.x
      const ry = pos.y - center.y
      const rz = pos.z - center.z
      const r = Math.sqrt(rx * rx + ry * ry + rz * rz)
      const phi = Math.acos(Math.max(-1, Math.min(1, rz / Math.max(r, 1e-6))))
      const theta = Math.atan2(ry, rx)
      const uRaw = theta / TWO_PI + 0.5
      const vRaw = phi / Math.PI

      const seamBand = (settings.seamBandWidth ?? 0.5) * 0.1
      const seamDist = Math.min(uRaw, 1.0 - uRaw)
      if (seamBand > 0.001 && seamDist < seamBand) {
        const d = uRaw < 0.5 ? uRaw : uRaw - 1.0
        const tRaw = (d + seamBand) / (2.0 * seamBand)
        const t = tRaw * tRaw * (3 - 2 * tRaw)
        const tLeft = applyTransform(1.0 + d, vRaw, scaleU, scaleV, offsetU, offsetV, cosR, sinR)
        const tRight = applyTransform(d, vRaw, scaleU, scaleV, offsetU, offsetV, cosR, sinR)
        return {
          triplanar: true,
          samples: [
            { u: tRight.u, v: tRight.v, w: t },
            { u: tLeft.u, v: tLeft.v, w: 1 - t },
          ],
          u: 0,
          v: 0,
        }
      }

      u = uRaw
      v = vRaw
      break
    }

    case MODE_CUBIC: {
      const weights = getCubicBlendWeights(normal, settings.mappingBlend ?? 0.0, settings.seamBandWidth ?? 0.35)
      let yzU = (pos.y - min.y) / md
      if (normal.x < 0) yzU = -yzU
      let xzU = (pos.x - min.x) / md
      if (normal.y > 0) xzU = -xzU
      let xyU = (pos.x - min.x) / md
      if (normal.z < 0) xyU = -xyU
      const tYZ = applyTransform(yzU, (pos.z - min.z) / md, scaleU, scaleV, offsetU, offsetV, cosR, sinR)
      const tXZ = applyTransform(xzU, (pos.z - min.z) / md, scaleU, scaleV, offsetU, offsetV, cosR, sinR)
      const tXY = applyTransform(xyU, (pos.y - min.y) / md, scaleU, scaleV, offsetU, offsetV, cosR, sinR)

      if (weights.x > 0.999) return tYZ
      if (weights.y > 0.999) return tXZ
      if (weights.z > 0.999) return tXY

      return {
        triplanar: true,
        samples: [
          { u: tXY.u, v: tXY.v, w: weights.z },
          { u: tXZ.u, v: tXZ.v, w: weights.y },
          { u: tYZ.u, v: tYZ.v, w: weights.x },
        ],
        u: 0,
        v: 0,
      }
    }

    case MODE_TRIPLANAR:
    default: {
      const ax = Math.abs(normal.x)
      const ay = Math.abs(normal.y)
      const az = Math.abs(normal.z)
      const ax2 = ax * ax
      const ay2 = ay * ay
      const az2 = az * az
      const bx = ax2 * ax2
      const by = ay2 * ay2
      const bz = az2 * az2
      const sum = bx + by + bz + 1e-6
      const wx = bx / sum
      const wy = by / sum
      const wz = bz / sum

      let yzU = (pos.y - min.y) / md
      if (normal.x < 0) yzU = -yzU
      let xzU = (pos.x - min.x) / md
      if (normal.y > 0) xzU = -xzU
      let xyU = (pos.x - min.x) / md
      if (normal.z < 0) xyU = -xyU

      const uvXY = { u: xyU, v: (pos.y - min.y) / md, w: wz }
      const uvXZ = { u: xzU, v: (pos.z - min.z) / md, w: wy }
      const uvYZ = { u: yzU, v: (pos.z - min.z) / md, w: wx }

      return {
        triplanar: true,
        samples: [
          { ...applyTransform(uvXY.u, uvXY.v, scaleU, scaleV, offsetU, offsetV, cosR, sinR), w: uvXY.w },
          { ...applyTransform(uvXZ.u, uvXZ.v, scaleU, scaleV, offsetU, offsetV, cosR, sinR), w: uvXZ.w },
          { ...applyTransform(uvYZ.u, uvYZ.v, scaleU, scaleV, offsetU, offsetV, cosR, sinR), w: uvYZ.w },
        ],
        u: 0,
        v: 0,
      }
    }
  }

  return applyTransform(u, v, scaleU, scaleV, offsetU, offsetV, cosR, sinR)
}

function applyTransform(
  u: number,
  v: number,
  scaleU: number,
  scaleV: number,
  offsetU: number,
  offsetV: number,
  cosR: number,
  sinR: number,
): UVResult {
  let uu = u / scaleU + offsetU
  let vv = v / scaleV + offsetV
  if (cosR !== 1 || sinR !== 0) {
    uu -= 0.5
    vv -= 0.5
    const ru = cosR * uu - sinR * vv
    const rv = sinR * uu + cosR * vv
    uu = ru + 0.5
    vv = rv + 0.5
  }
  return { triplanar: false, u: fract(uu), v: fract(vv) }
}

function fract(x: number): number {
  return x - Math.floor(x)
}
