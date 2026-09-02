/**
 * mesh 分割 API
 *
 * 提取来源：engine/boolean/csg.ts (computeSplit/computeDovetailSplit/...)
 * 已是纯数据函数，直接包装。
 *
 * splitWithParams 是 UI 与重放共用的唯一分割入口：
 * 参数编排（planeParams / planeBasis / 爆炸位移 / 世界坐标变换）
 * 全部在此函数内部完成，调用方只需传入 cutMode + normal/offset/inPlaneAngleDeg + bbCenter
 * 以及各 cutMode 专属参数。
 */

import {
  computeSplit,
  computeDovetailSplit,
  computeDowelSplit,
  computeStraightTenonSplit,
} from '../boolean/csg-backend'
import * as THREE from 'three'
import type { Shape, SplitResult, SplitPlane, DovetailSplitParams, DowelSplitParams, TenonSplitParams, Vec3 } from './types'

// ── 派生量计算（从 split-store 下沉，UI 与重放共用同一份公式） ──

/**
 * Derive the cutting-plane parameters from Euler angles (in degrees), the
 * plane position and the bounding-box center. Behavior is identical to the
 * former split-store.computePlaneParams.
 * @param rotationX - rotation about X in degrees.
 * @param rotationY - rotation about Y in degrees.
 * @param rotationZ - rotation about Z in degrees.
 * @param planePosition - offset of the cutting plane along the plane normal.
 * @param bbCenter - world-space bounding-box center of the source mesh.
 * @returns the plane normal, the plane's signed distance from the origin, and its center.
 */
export function computePlaneParams(
  rotationX: number,
  rotationY: number,
  rotationZ: number,
  planePosition: number,
  bbCenter: Vec3,
): { normal: Vec3; originOffset: number; planeCenter: Vec3 } {
  const rx = (rotationX * Math.PI) / 180
  const ry = (rotationY * Math.PI) / 180
  const rz = (rotationZ * Math.PI) / 180

  const euler = new THREE.Euler(rx, ry, rz, 'XYZ')
  const quat = new THREE.Quaternion().setFromEuler(euler)
  const normalVec = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)

  const normal: Vec3 = [normalVec.x, normalVec.y, normalVec.z]

  const planeCenter: Vec3 = [
    bbCenter[0] + planePosition * normal[0],
    bbCenter[1] + planePosition * normal[1],
    bbCenter[2] + planePosition * normal[2],
  ]

  const originOffset = normal[0] * planeCenter[0] + normal[1] * planeCenter[1] + normal[2] * planeCenter[2]

  return { normal, originOffset, planeCenter }
}

/**
 * Derive the plane basis vectors from Euler angles (in degrees). Behavior is
 * identical to the former split-store.computePlaneBasis.
 * @param rotationX - rotation about X in degrees.
 * @param rotationY - rotation about Y in degrees.
 * @param rotationZ - rotation about Z in degrees.
 * @returns the plane normal plus the in-plane width and depth directions.
 */
export function computePlaneBasis(
  rotationX: number,
  rotationY: number,
  rotationZ: number,
): { normal: Vec3; widthDir: Vec3; depthDir: Vec3 } {
  const rx = (rotationX * Math.PI) / 180
  const ry = (rotationY * Math.PI) / 180
  const rz = (rotationZ * Math.PI) / 180

  const euler = new THREE.Euler(rx, ry, rz, 'XYZ')
  const quat = new THREE.Quaternion().setFromEuler(euler)

  const normalVec = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)
  const widthVec = new THREE.Vector3(1, 0, 0).applyQuaternion(quat)
  const depthVec = new THREE.Vector3(0, 1, 0).applyQuaternion(quat)

  return {
    normal: [normalVec.x, normalVec.y, normalVec.z],
    widthDir: [widthVec.x, widthVec.y, widthVec.z],
    depthDir: [depthVec.x, depthVec.y, depthVec.z],
  }
}

// ── 从法线 + 面内旋转推导基向量（纯数学，无 THREE 依赖） ──

/**
 * Derive widthDir/depthDir from the cutting-plane normal and the in-plane
 * rotation angle. Matches computePlaneBasis(rx, ry, rz) with
 * normal = eulerXYZToNormal(rx, ry, 0) and inPlaneAngleDeg = rz: the rx/ry
 * Euler XYZ decomposition is recovered from the normal, then the rz rotation
 * is applied.
 *
 * normal = [sin(ry), -sin(rx)*cos(ry), cos(rx)*cos(ry)]
 *   ry = asin(normal[0])
 *   rx = atan2(-normal[1], normal[2])  (when cos(ry) !== 0)
 * @param normal - cutting-plane unit normal.
 * @param inPlaneAngleDeg - in-plane rotation about the normal, in degrees.
 * @returns the in-plane width and depth directions.
 */
export function computeBasisFromNormal(
  normal: Vec3,
  inPlaneAngleDeg: number,
): { widthDir: Vec3; depthDir: Vec3 } {
  const sinRy = Math.max(-1, Math.min(1, normal[0]))
  const ry = Math.asin(sinRy)
  const cosRy = Math.cos(ry)

  let rx: number
  if (Math.abs(cosRy) < 1e-10) {
    // 万向锁：ry = ±90°，rx 与 rz 耦合，设 rx = 0
    rx = 0
  } else {
    rx = Math.atan2(-normal[1], normal[2])
  }

  const rz = (inPlaneAngleDeg * Math.PI) / 180

  // R = RX(rx) · RY(ry)（不含 rz 的部分）
  // widthDir = R · (cos(rz), sin(rz), 0)
  // depthDir = R · (-sin(rz), cos(rz), 0)
  const cr = Math.cos(ry), sr = Math.sin(ry)
  const cx = Math.cos(rx), sx = Math.sin(rx)
  const cosRz = Math.cos(rz), sinRz = Math.sin(rz)

  const widthDir: Vec3 = [
    cr * cosRz,
    sx * sr * cosRz + cx * sinRz,
    -cx * sr * cosRz + sx * sinRz,
  ]

  const depthDir: Vec3 = [
    -cr * sinRz,
    -sx * sr * sinRz + cx * cosRz,
    cx * sr * sinRz + sx * cosRz,
  ]

  return { widthDir, depthDir }
}

// ── 统一分割入口 ──

/**
 * Input parameters for splitWithParams.
 */
export interface SplitWithParamsInput {
  /** 源几何（已在世界空间） */
  shape: Shape
  /** 分割模式 */
  cutMode: 'plane' | 'dovetail' | 'dowel' | 'straight-tenon' | 'tenon' | 'straight'
  /** 切割面法线 */
  normal: Vec3
  /** 切割面沿法线方向相对 bbCenter 的偏移（标量） */
  offset: number
  /** 切割面绕法线的面内旋转（角度制，承载原 planeRotation 的 rz 分量） */
  inPlaneAngleDeg: number
  /** 源 mesh 的世界空间包围盒中心 */
  bbCenter: Vec3
  /** 源 mesh 的世界空间包围盒尺寸（用于计算 bboxWidthOnWidthDir 和爆炸位移） */
  bboxSize: Vec3
  /** 燕尾参数（cutMode='dovetail' 时需要） */
  groove?: {
    depth: number
    depthTolerance: number
    width: number
    widthTolerance: number
    flapsAngle: number
  }
  /** 定位销参数（cutMode='dowel' 时需要） */
  dowel?: {
    diameter: number
    diameterTolerance: number
    height: number
    heightTolerance: number
  }
  /** 直榫参数（cutMode='straight-tenon' 时需要） */
  tenon?: {
    sideLength: number
    sideLengthTolerance: number
    height: number
    heightTolerance: number
  }
  /** 选择的截面（dowel/straight-tenon 用） */
  selectedSections?: number[] | null
  /** 是否应用爆炸位移（默认 true；导出/重放纯几何时可设 false） */
  applyExplode?: boolean
}

/**
 * Output of splitWithParams: the two halves plus the derived splitting data.
 */
export interface SplitWithParamsResult {
  front: Shape
  back: Shape
  /** 实际使用的法线（派生量，供调用方记录/调试） */
  normal: Vec3
  /** 实际使用的 originOffset（派生量） */
  originOffset: number
  /** 实际使用的 planeCenter（派生量） */
  planeCenter: Vec3
  /** 实际使用的 widthDir（派生量） */
  widthDir: Vec3
  /** 爆炸位移（front 正、back 负） */
  frontExplodeOffset: number
  backExplodeOffset: number
}

/**
 * Unified split entry point: the single split function shared by the UI
 * executor and script replay. All parameter orchestration (planeParams,
 * planeBasis, bboxWidthOnWidthDir, explode offset) happens inside this
 * function; callers pass only semantic parameters. Both interaction paths
 * (mouse / code) converge here, so the geometry result is identical.
 * @param input - the split mode-specific input (shape, plane, mode params).
 * @returns the split result with front/back halves and derived plane data.
 */
export async function splitWithParams(input: SplitWithParamsInput): Promise<SplitWithParamsResult> {
  const { shape, cutMode, normal, offset, inPlaneAngleDeg, bbCenter, bboxSize } = input

  // 1. 从 normal + offset + bbCenter 派生切割平面参数
  const planeCenter: Vec3 = [
    bbCenter[0] + offset * normal[0],
    bbCenter[1] + offset * normal[1],
    bbCenter[2] + offset * normal[2],
  ]
  const originOffset = normal[0] * planeCenter[0] + normal[1] * planeCenter[1] + normal[2] * planeCenter[2]

  // 2. 从 normal + inPlaneAngleDeg 派生基向量
  const { widthDir } = computeBasisFromNormal(normal, inPlaneAngleDeg)

  // 3. 按 cutMode 分发
  let front: Shape
  let back: Shape

  if (cutMode === 'dovetail') {
    const bboxWidthOnWidthDir =
      Math.abs(bboxSize[0] * widthDir[0]) +
      Math.abs(bboxSize[1] * widthDir[1]) +
      Math.abs(bboxSize[2] * widthDir[2])
    const groove = input.groove ?? {
      depth: 0, depthTolerance: 0, width: 0, widthTolerance: 0, flapsAngle: 0,
    }
    const result = await computeDovetailSplit(shape, normal, originOffset, planeCenter, widthDir, bboxWidthOnWidthDir, groove)
    front = result.front; back = result.back

    const result2: SplitWithParamsResult = await finalizeExplode(
      front, back, normal, originOffset, planeCenter, widthDir, bboxSize, cutMode, input,
    )
    return result2
  } else if (cutMode === 'dowel') {
    const dowel = input.dowel ?? {
      diameter: 0, diameterTolerance: 0, height: 0, heightTolerance: 0,
    }
    const result = await computeDowelSplit(shape, normal, originOffset, planeCenter, widthDir, dowel, input.selectedSections ?? null)
    front = result.front; back = result.back
    return finalizeExplode(front, back, normal, originOffset, planeCenter, widthDir, bboxSize, cutMode, input)
  } else if (cutMode === 'straight-tenon' || cutMode === 'tenon') {
    const tenon = input.tenon ?? {
      sideLength: 0, sideLengthTolerance: 0, height: 0, heightTolerance: 0,
    }
    const result = await computeStraightTenonSplit(shape, normal, originOffset, planeCenter, widthDir, tenon, input.selectedSections ?? null)
    front = result.front; back = result.back
    return finalizeExplode(front, back, normal, originOffset, planeCenter, widthDir, bboxSize, cutMode, input)
  } else {
    // plane / straight / default
    const result = await computeSplit(shape, normal, originOffset)
    front = result.front; back = result.back
    return finalizeExplode(front, back, normal, originOffset, planeCenter, widthDir, bboxSize, cutMode, input)
  }
}

/** 计算爆炸位移并应用到 front/back */
async function finalizeExplode(
  front: Shape,
  back: Shape,
  normal: Vec3,
  originOffset: number,
  planeCenter: Vec3,
  widthDir: Vec3,
  bboxSize: Vec3,
  cutMode: string,
  input: SplitWithParamsInput,
): Promise<SplitWithParamsResult> {
  const applyExplode = input.applyExplode ?? true

  // 爆炸位移：包围盒对角线的 2% + joinery 深度的一半
  const bboxDiagonal = Math.sqrt(
    bboxSize[0] * bboxSize[0] + bboxSize[1] * bboxSize[1] + bboxSize[2] * bboxSize[2],
  )
  const baseOffset = bboxDiagonal * 0.02
  let joineryOffset = 0
  if (cutMode === 'dovetail') {
    joineryOffset = (input.groove?.depth ?? 0) / 2
  } else if (cutMode === 'dowel') {
    joineryOffset = (input.dowel?.height ?? 0) / 2
  } else if (cutMode === 'straight-tenon' || cutMode === 'tenon') {
    joineryOffset = (input.tenon?.height ?? 0) / 2
  }
  const frontOffset = baseOffset + joineryOffset
  const backOffset = -(baseOffset + joineryOffset)

  if (applyExplode) {
    front = { positions: offsetPositions(front.positions, normal, frontOffset), indices: front.indices }
    back = { positions: offsetPositions(back.positions, normal, backOffset), indices: back.indices }
  }

  return {
    front,
    back,
    normal,
    originOffset,
    planeCenter,
    widthDir,
    frontExplodeOffset: applyExplode ? frontOffset : 0,
    backExplodeOffset: applyExplode ? backOffset : 0,
  }
}

/** 沿法线方向偏移所有顶点 */
function offsetPositions(
  positions: Float32Array,
  normal: Vec3,
  offset: number,
): Float32Array {
  const out = new Float32Array(positions)
  for (let i = 0; i < out.length; i += 3) {
    out[i]     += normal[0] * offset
    out[i + 1] += normal[1] * offset
    out[i + 2] += normal[2] * offset
  }
  return out
}

// ── 低级 API（保留向后兼容） ──

/**
 * Plane split of a mesh shape.
 * @param shape - the mesh shape to split.
 * @param plane - the cutting plane (normal + offset).
 * @returns the front and back halves of the shape.
 */
export async function split(shape: Shape, plane: SplitPlane): Promise<{ front: Shape; back: Shape }> {
  const result = await computeSplit(shape, plane.normal, plane.offset)
  return { front: result.front, back: result.back }
}

/**
 * Dovetail split of a mesh shape.
 * @param shape - the mesh shape to split.
 * @param params - dovetail groove parameters plus the cutting plane setup.
 * @returns the front/back halves and the dovetail wedge.
 */
export async function dovetailSplit(shape: Shape, params: DovetailSplitParams): Promise<SplitResult> {
  const result = await computeDovetailSplit(
    shape,
    params.plane.normal,
    params.plane.offset,
    params.planeCenter,
    params.widthDir,
    params.bboxWidthOnWidthDir,
    params.groove,
  )
  return {
    front: result.front,
    back: result.back,
    wedge: result.wedge,
  }
}

/**
 * Dowel-pin split of a mesh shape.
 * @param shape - the mesh shape to split.
 * @param params - dowel parameters plus the cutting plane setup.
 * @returns the front/back halves and the dowel wedge.
 */
export async function dowelSplit(shape: Shape, params: DowelSplitParams): Promise<SplitResult> {
  const result = await computeDowelSplit(
    shape,
    params.plane.normal,
    params.plane.offset,
    params.planeCenter,
    params.widthDir,
    params.dowel,
    params.selectedSections,
  )
  return {
    front: result.front,
    back: result.back,
    wedge: result.wedge,
  }
}

/**
 * Straight-tenon split of a mesh shape.
 * @param shape - the mesh shape to split.
 * @param params - tenon parameters plus the cutting plane setup.
 * @returns the front/back halves and the tenon wedge.
 */
export async function tenonSplit(shape: Shape, params: TenonSplitParams): Promise<SplitResult> {
  const result = await computeStraightTenonSplit(
    shape,
    params.plane.normal,
    params.plane.offset,
    params.planeCenter,
    params.widthDir,
    params.tenon,
    params.selectedSections,
  )
  return {
    front: result.front,
    back: result.back,
    wedge: result.wedge,
  }
}
