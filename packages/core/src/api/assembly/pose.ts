/**
 * api/assembly/pose — 位姿转换契约（P1，方案 §4.3）
 *
 * brepjs 与 faijs 的位姿模型两处不一致，转换收口在本模块（禁止别处手写 q[0]/q[3]）：
 * (a) 四元数分量顺序：brepjs [w,x,y,z] ↔ faijs [x,y,z,w]；
 * (b) pivot 语义：brepjs `p' = R·p + position`（绕原点）↔
 *     faijs `p' = R·(p − pivot) + pivot + translation`。
 *     令 pivot = dependent 实体 origin（单约束场景），二者等价：
 *     translation = position − pivot + R·pivot。
 */

import type { SolverEntity } from '../../vendored/brepjs/kernel/solverAdapter'
import { quatRotate } from '../../vendored/brepjs/utils/quaternion'
import type { JointPose } from '../../vendored/brepjs/operations/jointFns'
import type { AssemblyTransform } from '../../runtime-state'
import type { AssemblyVec3 } from './types'

/** brepjs 四元数 [w,x,y,z]。 */
export type BrepjsQuat = readonly [number, number, number, number]
/** faijs 四元数 [x,y,z,w]。 */
export type FaijsQuat = [number, number, number, number]

/**
 * brepjs [w,x,y,z] → faijs [x,y,z,w]（分量换序，不改变旋转本身）。
 * @param q - the brepjs-order quaternion.
 * @returns the faijs-order quaternion.
 */
export function fromBrepjsQuat(q: BrepjsQuat): FaijsQuat {
  return [q[1], q[2], q[3], q[0]]
}

/**
 * faijs [x,y,z,w] → brepjs [w,x,y,z]。
 * @param q - the faijs-order quaternion.
 * @returns the brepjs-order quaternion.
 */
export function toBrepjsQuat(q: FaijsQuat): BrepjsQuat {
  return [q[3], q[0], q[1], q[2]]
}

/**
 * 四元数 → 旋转矩阵（3x3, row-major；brepjs 位姿换算唯一入口）。
 * @param q - the faijs-order quaternion.
 * @returns the 9-component row-major rotation matrix.
 */
export function quaternionToMatrix3(q: FaijsQuat): number[] {
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

function mat3MulVec(m: number[], v: AssemblyVec3): AssemblyVec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

/** brepjs 单节点位姿（position + [w,x,y,z] 旋转）。 */
export interface SolverPose {
  position: readonly [number, number, number]
  rotation: readonly [number, number, number, number]
}

/**
 * brepjs 位姿 → faijs AssemblyTransform（§4.3(b) 换算；T2 锁定）。
 *
 * @param pose - the solver pose (p' = R·p + position).
 * @param pivot - rotation pivot in faijs model (convention: the dependent entity's origin).
 * @param index - member index (filled by the caller).
 * @returns the AssemblyTransform with quaternion/pivot/translation/rotationMatrix.
 */
export function poseToAssemblyTransform(pose: SolverPose, pivot: AssemblyVec3, index: number): AssemblyTransform {
  const q = fromBrepjsQuat(pose.rotation)
  const m = quaternionToMatrix3(q)
  const rp = mat3MulVec(m, pivot)
  return {
    index,
    quaternion: q,
    pivot,
    translation: [
      pose.position[0] - pivot[0] + rp[0],
      pose.position[1] - pivot[1] + rp[1],
      pose.position[2] - pivot[2] + rp[2],
    ],
    rotationMatrix: m,
  }
}

/**
 * brepjs FK 位姿（JointPose = { position, rotation: [w,x,y,z] }）→ faijs AssemblyTransform。
 *
 * brepjs 前向运动学的位姿是「绕原点整体模型」（p' = R·p + position），与约束求解的
 * pivot 换算同式——故 pivot = [0,0,0]、translation = pose.position。旋转经
 * fromBrepjsQuat 换序为 faijs [x,y,z,w]；rotationMatrix 与其它变换同源。
 *
 * @param pose - the forward-kinematics pose (p' = R·p + position).
 * @param index - member index (filled by the caller).
 * @returns the AssemblyTransform with zero pivot and the FK position as translation.
 */
export function jointPoseToAssemblyTransform(pose: JointPose, index: number): AssemblyTransform {
  const q = fromBrepjsQuat(pose.rotation)
  const m = quaternionToMatrix3(q)
  return {
    index,
    quaternion: q,
    pivot: [0, 0, 0],
    translation: [pose.position[0], pose.position[1], pose.position[2]],
    rotationMatrix: m,
  }
}

/**
 * 判定一个位姿是否为恒等（锚定/链根成员：跳过输出，引擎不做无谓重算）。
 * @param pose - the solver pose.
 * @returns true when the pose is exactly identity.
 */
export function isIdentityPose(pose: SolverPose): boolean {
  return (
    pose.position[0] === 0 && pose.position[1] === 0 && pose.position[2] === 0 &&
    pose.rotation[0] === 1 && pose.rotation[1] === 0 && pose.rotation[2] === 0 && pose.rotation[3] === 0
  )
}

/**
 * 供 solve.ts 记录 pivot 用的 dependent 实体 origin 读取。
 * @param e - the solver entity.
 * @returns a copy of the entity origin.
 */
export function entityOrigin(e: SolverEntity): AssemblyVec3 {
  return [e.origin[0], e.origin[1], e.origin[2]]
}

/** brepjs quatRotate 的再导出（rotate by [w,x,y,z] quat）——测试与换算共用。 */
export { quatRotate }
