/**
 * api/assembly/solvers/pose-from-delta — 模长参数化旋转（P1，对齐 B2 / solver.py:309-328）
 *
 * 复刻 CadQuery `solver.py` 的旋转参数化：旋转用 3 维 ΔR=(a,b,c)（模长参数化），
 * 不直接用四元数。与 CQ 逐字一致：
 *
 *   m = a²+b²+c²
 *   u = 2R/(1+m)            // 虚部
 *   s = (1-m)/(1+m)         // 实部
 *   Rotate(v,R) = 2⟨u,v⟩u + (s²−⟨u,u⟩)v + 2s(u×v)
 *
 * 该公式对 (s,u) 单位四元数即标准旋转（s²+⟨u,u⟩=1 ⇒ s²−⟨u,u⟩ = 1−2⟨u,u⟩）。
 * 初值 R=(1e-2,1e-2,1e-2)（B3）。
 */

import type { Vec3 } from './linalg'
import { vcross, vdot } from './linalg'

/** 由 ΔR=(a,b,c) 计算四元数分量（实部 s、虚部 u）。 */
export function quatPartsFromR(a: number, b: number, c: number): { s: number; u: Vec3 } {
  const m = a * a + b * b + c * c
  const denom = 1 + m
  return {
    s: (1 - m) / denom,
    u: [2 * a / denom, 2 * b / denom, 2 * c / denom],
  }
}

/**
 * 用 ΔR 旋转向量 v（CQ `Rotate`，逐字实现）。
 * @param v - 待旋转向量（本地系）。
 * @param r - ΔR=(a,b,c)。
 * @returns 旋转后的向量。
 */
export function rotateByR(v: Vec3, r: Vec3): Vec3 {
  const { s, u } = quatPartsFromR(r[0], r[1], r[2])
  const uv = vdot(u, v)
  const uu = vdot(u, u)
  const cross = vcross(u, v)
  return [
    2 * uv * u[0] + (s * s - uu) * v[0] + 2 * s * cross[0],
    2 * uv * u[1] + (s * s - uu) * v[1] + 2 * s * cross[1],
    2 * uv * u[2] + (s * s - uu) * v[2] + 2 * s * cross[2],
  ]
}

/**
 * 由 ΔR 生成 brepjs 序四元数 [w,x,y,z]（即 CQ 的 (s,u)）。
 * 供 `poseToAssemblyTransform` 的 SolverPose.rotation 使用。
 */
export function quatFromR(a: number, b: number, c: number): [number, number, number, number] {
  const m = a * a + b * b + c * c
  const denom = 1 + m
  return [(1 - m) / denom, 2 * a / denom, 2 * b / denom, 2 * c / denom]
}
