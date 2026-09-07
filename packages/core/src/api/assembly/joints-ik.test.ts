/**
 * api/assembly/joints-ik — cad.* 查询函数测试（P3，方案 §3.4）
 *
 * J9：cad.inverseKinematics 平面二连杆到位目标——converged=true 且 FK(解) ≈ target
 *     （1e-3）。endEffector = child 成员名；tip 为 endEffector 局部偏移（杆远端）。
 * J10：cad.jointTrajectory 步数、t∈[0,1]、端点值正确（steps+1 个采样）。
 * J11：cad.mechanismDOF 串联两 revolute = 2。
 * 附：三个查询函数可从 @faicad/faijs/browser 门面导出（与 api 面同源）。
 */

import { describe, it, expect } from 'vitest'
import { inverseKinematics, jointTrajectory, mechanismDOF, solveKinematics } from './joints'
import { quatRotate, toBrepjsQuat } from './pose'
import type { AssemblyVec3 } from './types'
// 门面导出链断言：api/assembly/index → api/index → browser（三跳）
import * as browserApi from '@faicad/faijs/browser'

const P = (s: string) => s as 'base' | 'link1' | 'link2' | 'arm'

/** 平面二连杆（每杆长 10，绕 z 轴正解）。 */
function planar2Link() {
  return {
    memberNames: ['base', 'link1', 'link2'],
    joints: [
      {
        type: 'revolute' as const,
        parent: P('base'),
        child: P('link1'),
        axis: { origin: [0, 0, 0] as AssemblyVec3, direction: [0, 0, 1] as AssemblyVec3 },
        min: -180,
        max: 180,
        value: 0,
      },
      {
        type: 'revolute' as const,
        parent: P('link1'),
        child: P('link2'),
        axis: { origin: [10, 0, 0] as AssemblyVec3, direction: [0, 0, 1] as AssemblyVec3 },
        min: -180,
        max: 180,
        value: 0,
      },
    ],
  }
}

describe('J9: cad.inverseKinematics — 平面二连杆到位', () => {
  it('converged=true 且 FK(解) ≈ target（1e-3）', () => {
    const { memberNames, joints } = planar2Link()
    // 末端 = R1·R2·[10,0,0]（范数恒为杆长 10）——target 必须在半径 10 的圆上
    const target: AssemblyVec3 = [8, 6, 0]
    const result = inverseKinematics({
      joints,
      endEffector: 'link2',
      target: { position: target },
      options: { tip: [10, 0, 0] },
    })
    expect(result.converged).toBe(true)
    expect(result.iterations).toBeGreaterThan(0)
    expect(result.error).toBeLessThan(1e-3)

    // FK(解) 验证：把 IK values（keyed by child）喂回正解，末端 = 位姿 + R·tip ≈ target
    const drive = result.values // per-DOF 数组（单 DOF joint 长度为 1），直接喂 drive
    const kin = solveKinematics(memberNames, joints, drive)
    const pose = kin.kinematics['link2']!
    const rotated = quatRotate(toBrepjsQuat(pose.rotation), [10, 0, 0])
    const tip = [pose.position[0] + rotated[0], pose.position[1] + rotated[1], pose.position[2] + rotated[2]]
    expect(Math.abs(tip[0]! - target[0]!)).toBeLessThan(1e-3)
    expect(Math.abs(tip[1]! - target[1]!)).toBeLessThan(1e-3)
    expect(Math.abs(tip[2]! - target[2]!)).toBeLessThan(1e-3)
  })
})

describe('J10: cad.jointTrajectory — 步数 / t∈[0,1] / 端点值', () => {
  it('steps=2 产出 3 个采样，t 均匀，values 线性插值，poses rotation 为 faijs 序', () => {
    const samples = jointTrajectory({
      joints: [
        {
          type: 'revolute' as const,
          parent: P('base'),
          child: P('arm'),
          axis: { origin: [0, 0, 0] as AssemblyVec3, direction: [0, 0, 1] as AssemblyVec3 },
          min: -180,
          max: 180,
          value: 0,
        },
      ],
      from: { arm: 0 },
      to: { arm: 120 },
      steps: 2,
    })
    expect(samples.length).toBe(3)
    expect(samples.map((s) => s.t)).toEqual([0, 0.5, 1])
    expect(samples.map((s) => s.values['arm']![0])).toEqual([0, 60, 120])
    // 端点 t=1：arm 绕 z 转 120° → faijs 序 [0,0,sin60,cos60]
    const end = samples[2]!.poses.get('arm')!
    expect(end.position).toEqual([0, 0, 0])
    expect(Math.abs(end.rotation[0]!)).toBeLessThan(1e-9)
    expect(Math.abs(end.rotation[1]!)).toBeLessThan(1e-9)
    expect(end.rotation[2]).toBeCloseTo(Math.sqrt(3) / 2, 6)
    expect(end.rotation[3]).toBeCloseTo(0.5, 6)
  })
})

describe('J11: cad.mechanismDOF — 串联两 revolute = 2', () => {
  it('dof = Σ joint.dofs.length', () => {
    const { joints } = planar2Link()
    expect(mechanismDOF({ joints })).toBe(2)
  })
})

describe('门面导出链（三跳）：三个查询函数可从 @faicad/faijs/browser 导入', () => {
  it('jointTrajectory / inverseKinematics / mechanismDOF 在 browser 门上可导出', () => {
    const ex = browserApi as unknown as {
      jointTrajectory?: unknown
      inverseKinematics?: unknown
      mechanismDOF?: unknown
    }
    expect(typeof ex.jointTrajectory).toBe('function')
    expect(typeof ex.inverseKinematics).toBe('function')
    expect(typeof ex.mechanismDOF).toBe('function')
  })
})