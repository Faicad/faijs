/**
 * 装配约束求解器 — E15.1
 *
 * 当 `do_assemble()` 脚本语句被执行时，从 `assemble` 定义和 `add_constraint` 约束
 * 中计算变换矩阵，应用到 movingPartId 对应的几何上。
 *
 * 现阶段只支持 face_mate 约束（面贴合），求解器可简化为直接计算。
 * 未来支持多约束联合求解（face_mate/coaxial/parallel/distance/angle 等）。
 *
 * 约束数据结构：
 * - type: 'face_mate'（现阶段唯一支持的类型）
 * - fixedPartId: 固定件 partId
 * - movingPartId: 活动件 partId
 * - fixedFace: { faceId, surfaceType, center, normal } — center/normal 从拓扑数据派生
 * - movingFace: { faceId, surfaceType, center, normal } — center/normal 从拓扑数据派生
 *
 * 数学（面贴合 + 中心重合）：
 * 1. 旋转 q1：使 movingFace.normal → -fixedFace.normal（法线反向平行，面贴合）
 * 2. 平移：fixedFace.center - movingFace.center（使中心点重合）
 */

import type { Shape } from './types'
import type { OpContext } from './types'

// ── 约束类型 ──

export interface FaceMateConstraint {
  type: 'face_mate'
  fixedPartId: string
  movingPartId: string
  fixedFace: {
    faceId: string
    surfaceType: string
    center: [number, number, number]
    normal: [number, number, number]
  }
  movingFace: {
    faceId: string
    surfaceType: string
    center: [number, number, number]
    normal: [number, number, number]
  }
}

export type AssemblyConstraint = FaceMateConstraint

// ── 装配定义 ──

export interface AssemblyDefinition {
  name?: string
  members: string[]
  constraints: AssemblyConstraint[]
}

// ── 向量数学（无 three.js 依赖，纯计算） ──

function vec3Normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
  if (len < 1e-12) return [0, 0, 0]
  return [v[0] / len, v[1] / len, v[2] / len]
}

function vec3Sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vec3Cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function vec3Dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * 从两个单位向量计算旋转四元数 (a → b)。
 * 使用 Rodrigues 公式。
 */
function quaternionFromUnitVectors(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number, number] {
  // 叉积
  const cross = vec3Cross(a, b)
  // 点积
  const dot = vec3Dot(a, b)

  // 处理平行/反平行情况
  if (dot > 1 - 1e-9) {
    // a ≈ b，无旋转
    return [0, 0, 0, 1]
  }
  if (dot < -1 + 1e-9) {
    // a ≈ -b，绕任意垂直轴旋转 180°
    // 找一个不平行于 a 的轴
    const axis = Math.abs(a[0]) < 0.9 ? [1, 0, 0] as [number, number, number] : [0, 1, 0] as [number, number, number]
    const perp = vec3Normalize(vec3Cross(a, axis))
    return [perp[0], perp[1], perp[2], 0]
  }

  // 正常情况：四元数 = [cross, 1+dot] 归一化
  const w = 1 + dot
  const len = Math.sqrt(cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2] + w * w)
  return [cross[0] / len, cross[1] / len, cross[2] / len, w / len]
}

/**
 * 四元数 → 旋转矩阵 (3x3, row-major)
 */
function quaternionToMatrix3(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q
  const xx = x * x, yy = y * y, zz = z * z
  const xy = x * y, xz = x * z, yz = y * z
  const wx = w * x, wy = w * y, wz = w * z

  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]
}

/**
 * 矩阵 × 向量 (3x3 * 3)
 */
function mat3MulVec(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

// ── 求解器 ──

/**
 * 计算 face_mate 约束的变换。
 *
 * 返回 { quaternion, pivot, translation }：
 * - quaternion: 使 movingFace.normal → -fixedFace.normal 的旋转
 * - pivot: 旋转中心（movingFace.center）
 * - translation: 旋转后的平移量（使中心重合）
 */
export function solveFaceMate(
  fixedCenter: [number, number, number],
  fixedNormal: [number, number, number],
  movingCenter: [number, number, number],
  movingNormal: [number, number, number],
): {
  quaternion: [number, number, number, number]
  pivot: [number, number, number]
  translation: [number, number, number]
  rotationMatrix: number[]
} {
  const n1 = vec3Normalize(fixedNormal)
  const p1 = fixedCenter
  const n2 = vec3Normalize(movingNormal)
  const p2 = movingCenter

  // 旋转：使 n2 → -n1
  const targetNormal: [number, number, number] = [-n1[0], -n1[1], -n1[2]]
  const quaternion = quaternionFromUnitVectors(n2, targetNormal)

  // 旋转后的 movingCenter
  const rotationMatrix = quaternionToMatrix3(quaternion)
  // 绕 pivot(p2) 旋转后的中心位置 = R * (p2 - p2) + p2 = p2
  // 然后平移 p1 - p2
  const translation = vec3Sub(p1, p2)

  return { quaternion, pivot: p2, translation, rotationMatrix }
}

/**
 * 将变换应用到 Shape（旋转 + 平移）。
 *
 * 绕 pivot 旋转后，再平移。
 * 这是 do_assemble() 在引擎内部执行的变换逻辑。
 */
export function applyTransform(
  shape: Shape,
  quaternion: [number, number, number, number],
  pivot: [number, number, number],
  translation: [number, number, number],
  rotationMatrix: number[],
): Shape {
  const positions = shape.positions
  const newPositions = new Float32Array(positions.length)

  for (let i = 0; i < positions.length; i += 3) {
    // p' = R * (p - pivot) + pivot + translation
    const px = positions[i] - pivot[0]
    const py = positions[i + 1] - pivot[1]
    const pz = positions[i + 2] - pivot[2]

    const rotated = mat3MulVec(rotationMatrix, [px, py, pz])

    newPositions[i] = rotated[0] + pivot[0] + translation[0]
    newPositions[i + 1] = rotated[1] + pivot[1] + translation[1]
    newPositions[i + 2] = rotated[2] + pivot[2] + translation[2]
  }

  return {
    positions: newPositions,
    indices: shape.indices,
  }
}

// ── 执行函数 ──

/**
 * 执行 do_assemble：从 assemble 定义和约束中计算变换，应用到活动件几何。
 *
 * 此函数在 CadRuntime.replay() 中被调用（通过 dispatcher），
 * 变换在引擎内部完成，不绕过脚本引擎。
 *
 * @param assemblyDef 装配定义（name/members/constraints）
 * @param outputCache 当前重放的输出缓存，用于查找 partId → Shape
 * @returns 变换后的 Shape（如果无约束则返回原 Shape）
 */
export function executeDoAssemble(
  assemblyDef: AssemblyDefinition,
  outputCache: Map<string, Shape>,
): Map<string, Shape> {
  const results = new Map<string, Shape>()

  // 按约束逐个求解并应用变换
  // 现阶段每个约束独立处理（face_mate）
  // 未来：联合求解所有约束
  for (const constraint of assemblyDef.constraints) {
    if (constraint.type !== 'face_mate') {
      throw new Error(`[assemble] unsupported constraint type: ${constraint.type}`)
    }

    const movingShape = outputCache.get(constraint.movingPartId)
    if (!movingShape) {
      throw new Error(`[assemble] moving part not found in outputCache: ${constraint.movingPartId}`)
    }

    const { quaternion, pivot, translation, rotationMatrix } = solveFaceMate(
      constraint.fixedFace.center,
      constraint.fixedFace.normal,
      constraint.movingFace.center,
      constraint.movingFace.normal,
    )

    const transformed = applyTransform(
      movingShape,
      quaternion,
      pivot,
      translation,
      rotationMatrix,
    )

    // 写回 outputCache（变换后的几何替换原始几何）
    outputCache.set(constraint.movingPartId, transformed)
    results.set(constraint.movingPartId, transformed)
  }

  return results
}

/**
 * 装配预览：给定约束，计算变换但不修改 outputCache。
 *
 * 返回每个 movingPartId 对应的变换矩阵，
 * 宿主可以用它来设置 mesh 矩阵（只改 mesh 矩阵，不烘焙顶点）。
 *
 * D 类预览 API。
 */
export function previewAssembly(
  constraints: AssemblyConstraint[],
): Map<string, {
  quaternion: [number, number, number, number]
  pivot: [number, number, number]
  translation: [number, number, number]
  rotationMatrix: number[]
}> {
  const results = new Map<string, {
    quaternion: [number, number, number, number]
    pivot: [number, number, number]
    translation: [number, number, number]
    rotationMatrix: number[]
  }>()

  for (const constraint of constraints) {
    if (constraint.type !== 'face_mate') {
      throw new Error(`[assemble] unsupported constraint type: ${constraint.type}`)
    }

    const { quaternion, pivot, translation, rotationMatrix } = solveFaceMate(
      constraint.fixedFace.center,
      constraint.fixedFace.normal,
      constraint.movingFace.center,
      constraint.movingFace.normal,
    )

    results.set(constraint.movingPartId, { quaternion, pivot, translation, rotationMatrix })
  }

  return results
}
