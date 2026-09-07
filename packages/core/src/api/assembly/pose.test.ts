/**
 * pose 转换契约单测（P1，方案 §4.3 / T1、T2）
 *
 * T1：四元数分量顺序转换往返（brepjs [w,x,y,z] ↔ faijs [x,y,z,w]），含非单位四元数。
 * T2：pivot 换算——随机 pose+pivot 下，faijs 模型 p' = R·(p−pivot) + pivot + translation
 *    与 brepjs 模型 p' = R·p + position 逐点相等（1e-9）。
 */

import { describe, it, expect } from 'vitest'
import {
  fromBrepjsQuat, toBrepjsQuat, poseToAssemblyTransform, quaternionToMatrix3,
  type SolverPose, type BrepjsQuat,
} from './pose'
import { quatRotate } from '../../vendored/brepjs/utils/quaternion'
import type { AssemblyVec3 } from './types'

/** mulberry32 seeded PRNG（可复现的"随机"测试数据）。 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mat3MulVec(m: number[], v: AssemblyVec3): AssemblyVec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

describe('T1: 四元数分量顺序往返（§4.3a）', () => {
  it('恒等 / 一般 / 非单位四元数往返恒等', () => {
    const cases: BrepjsQuat[] = [
      [1, 0, 0, 0],
      [0.5, 0.5, 0.5, 0.5],
      [0.7071067811865476, 0, 0, 0.7071067811865476],
      [2, 0, 0, 0], // 非单位
      [0.1, -0.7, 0.3, 0.9], // 非单位
      [-0.2, 0.4, -0.5, 0.1],
    ]
    for (const q of cases) {
      const round = toBrepjsQuat(fromBrepjsQuat(q))
      expect(round[0]).toBeCloseTo(q[0], 12)
      expect(round[1]).toBeCloseTo(q[1], 12)
      expect(round[2]).toBeCloseTo(q[2], 12)
      expect(round[3]).toBeCloseTo(q[3], 12)
    }
  })
})

describe('T2: pivot 换算（§4.3b）', () => {
  it('随机 pose+pivot：faijs 模型与 brepjs 模型逐点相等（1e-9）', () => {
    const next = rng(20260906)
    for (let iter = 0; iter < 200; iter++) {
      // 随机单位四元数（brepjs wxyz）
      const u: AssemblyVec3 = [next() * 2 - 1, next() * 2 - 1, next() * 2 - 1]
      const ul = Math.hypot(u[0], u[1], u[2]) || 1
      const angle = next() * Math.PI * 2
      const s = Math.sin(angle / 2)
      const rotation: BrepjsQuat = [Math.cos(angle / 2), (u[0] / ul) * s, (u[1] / ul) * s, (u[2] / ul) * s]
      const position: AssemblyVec3 = [next() * 100 - 50, next() * 100 - 50, next() * 100 - 50]
      const pivot: AssemblyVec3 = [next() * 40 - 20, next() * 40 - 20, next() * 40 - 20]

      const pose: SolverPose = { position, rotation }
      const t = poseToAssemblyTransform(pose, pivot, 0)

      // 若干随机点：两条模型公式必须给出同一位姿
      for (let k = 0; k < 5; k++) {
        const p: AssemblyVec3 = [next() * 60 - 30, next() * 60 - 30, next() * 60 - 30]
        // brepjs：p' = R·p + position
        const brepjsOut = quatRotate(rotation, p)
        const brepjs: AssemblyVec3 = [
          brepjsOut[0] + position[0],
          brepjsOut[1] + position[1],
          brepjsOut[2] + position[2],
        ]
        // faijs：p' = R·(p − pivot) + pivot + translation
        const local: AssemblyVec3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]
        const rotated = mat3MulVec(t.rotationMatrix, local)
        const faijs: AssemblyVec3 = [
          rotated[0] + pivot[0] + t.translation[0],
          rotated[1] + pivot[1] + t.translation[1],
          rotated[2] + pivot[2] + t.translation[2],
        ]
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(brepjs[c] - faijs[c])).toBeLessThan(1e-9)
        }
      }
      // 四元数换序一致（rotationMatrix 由换序后的 faijs 四元数生成）
      expect(t.quaternion).toEqual(fromBrepjsQuat(rotation))
      expect(t.rotationMatrix).toEqual(quaternionToMatrix3(fromBrepjsQuat(rotation)))
    }
  })
})
