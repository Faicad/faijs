/**
 * api/assembly/kinematics — 运动学解算测试（P3，方案 §3.4）
 *
 * J5：单 revolute——drive=0 → child 原位；drive=90 → child 绕轴转 90°，
 *     手算位姿逐分量比对（FK 数学）。
 * J6：两级链（base→arm→gripper）——gripper 位姿 = 两次 compose 手算值。
 * J7：drive 越界值被 clamp 到 [min,max]（brepjs 行为透传）。
 * J8：joints 与 constraints 并存——同名成员 joints 优先（覆盖语义 + 一条诊断）。
 *
 * 全部用快照形态面引用 + 占位 Shape（与 solve.test.ts 同款，无内核依赖）。
 */

import { describe, it, expect } from 'vitest'
import { solveKinematics } from './joints'
import { solveAssemblyAndKinematics } from './solve'
import { asPartName } from '../../identity'
import type { KinematicsPose } from './joints'
import type { AssemblyTransform } from '../../runtime-state'
import type { Shape } from '../../mesh/types'
import type { AssemblyConstraint, AssemblyVec3 } from './types'

/** PartName 品牌类型便捷转换（constraints 的 part 字段用）。 */
const P = asPartName
const dummy = () => ({}) as Shape
const SQRT1_2 = Math.SQRT1_2
const SQRT3_2 = Math.sqrt(3) / 2

/** 手算 helper：断言 KinematicsPose 逐分量近似。 */
function expectPose(pose: KinematicsPose, position: number[], rotation: number[]): void {
  expectVecClose(pose.position, position)
  expectVecClose(pose.rotation, rotation, 1e-6)
}

function expectVecClose(a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-9): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) {
    expect(Math.abs(a[i]! - (b[i] ?? 0)), `component ${i}`).toBeLessThan(eps)
  }
}

describe('J5: 单 revolute FK（手算逐分量）', () => {
  const joints = [
    {
      type: 'revolute' as const,
      parent: 'base',
      child: 'arm',
      axis: { origin: [10, 0, 0] as AssemblyVec3, direction: [0, 0, 1] as AssemblyVec3 },
      min: -180,
      max: 180,
      value: 0,
    },
  ]
  const memberNames = ['base', 'arm']

  it('drive=0 → child 原位（identity 位姿）', () => {
    const r = solveKinematics(memberNames, joints, { arm: 0 })
    expectPose(r.kinematics['arm']!, [0, 0, 0], [0, 0, 0, 1])
    // 恒等位姿不进 transforms（引擎不做无谓重算）
    expect(r.transforms.length).toBe(0)
  })

  it('drive=90 → 绕 z 轴经 origin [10,0,0] 转 90°：position=[10,-10,0]、rotation 手算', () => {
    const r = solveKinematics(memberNames, joints, { arm: 90 })
    // R(z,90°)·[10,0,0] = [0,10,0] → position = origin − R·origin = [10,−10,0]
    expectPose(r.kinematics['arm']!, [10, -10, 0], [0, 0, SQRT1_2, SQRT1_2])
    // transforms 含 arm 一条（index=1）
    expect(r.transforms.length).toBe(1)
    const t = r.transforms[0]!
    expect(t.index).toBe(1)
    expectVecClose(t.translation, [10, -10, 0])
    expectVecClose(t.quaternion, [0, 0, SQRT1_2, SQRT1_2])
  })
})

describe('J6: 两级链 FP（base→arm→gripper），gripper = 两次 compose 手算', () => {
  const joints = [
    {
      type: 'revolute' as const,
      parent: 'base',
      child: 'arm',
      axis: { origin: [0, 0, 0] as AssemblyVec3, direction: [0, 0, 1] as AssemblyVec3 },
      min: -180,
      max: 180,
      value: 90,
    },
    {
      type: 'revolute' as const,
      parent: 'arm',
      child: 'gripper',
      axis: { origin: [20, 0, 0] as AssemblyVec3, direction: [0, 0, 1] as AssemblyVec3 },
      min: -180,
      max: 180,
      value: 90,
    },
  ]
  const memberNames = ['base', 'arm', 'gripper']

  it('gripper 世界位姿 = parentWorld ∘ jointTransform 两次 compose', () => {
    const r = solveKinematics(memberNames, joints)
    // arm：origin=[0,0,0] 旋转轴心 → position=[0,0,0]，rotation z90
    expectPose(r.kinematics['arm']!, [0, 0, 0], [0, 0, SQRT1_2, SQRT1_2])
    // gripper local：origin=[20,0,0] → local position=[20,−20,0]；world = R_arm·local = [20,20,0]
    // rotation = z90∘z90 = z180 → faijs [0,0,1,0]
    expectPose(r.kinematics['gripper']!, [20, 20, 0], [0, 0, 1, 0])
    // 两个被驱动成员都在 transforms（order 按成员下标）
    expect(r.transforms.map((t) => t.index).sort()).toEqual([1, 2])
  })
})

describe('J7: drive 越界 clamp 到 [min,max]（brepjs 透传）', () => {
  const joints = [
    {
      type: 'revolute' as const,
      parent: 'base',
      child: 'arm',
      axis: { origin: [0, 0, 0] as AssemblyVec3, direction: [0, 0, 1] as AssemblyVec3 },
      min: 0,
      max: 120,
      value: 0,
    },
  ]
  const memberNames = ['base', 'arm']

  it('drive=500 与 drive=120 同解（clamp 到 max）', () => {
    const clamped = solveKinematics(memberNames, joints, { arm: 500 })
    const maxed = solveKinematics(memberNames, joints, { arm: 120 })
    // 绕 z 转 120°：faijs [0,0,sin60,cos60]
    expectPose(clamped.kinematics['arm']!, [0, 0, 0], [0, 0, SQRT3_2, 0.5])
    expectVecClose(clamped.kinematics['arm']!.rotation, maxed.kinematics['arm']!.rotation)
  })

  it('drive=0 与原位一致；drive 键不在 joint child 集 → 抛错', () => {
    const r = solveKinematics(memberNames, joints, { arm: 0 })
    expectPose(r.kinematics['arm']!, [0, 0, 0], [0, 0, 0, 1])
    expect(() => solveKinematics(memberNames, joints, { ghost: 30 })).toThrow(
      /drive key 'ghost' does not name a joint child/,
    )
  })
})

describe('J8: joints 与 constraints 并存——同名成员 joints 优先（覆盖 + 一条诊断）', () => {
  const constraints: AssemblyConstraint[] = [
    { type: 'fixed', part: P('base') },
    {
      type: 'mate',
      a: { part: P('base'), face: { center: [0, 0, 5], normal: [0, 0, 1] } },
      b: { part: P('arm'), face: { center: [40, 0, -5], normal: [0, 0, -1] } },
    },
  ]
  const joints = [
    {
      type: 'revolute' as const,
      parent: 'base',
      child: 'arm',
      axis: { origin: [0, 0, 5] as AssemblyVec3, direction: [0, 0, 1] as AssemblyVec3 },
      min: -180,
      max: 180,
      value: 90,
    },
  ]
  const memberNames = ['base', 'arm']

  it('arm 的终态是 joints 解（绕 [0,0,5] 轴 z90）而非约束解（平移 −40,+10）', () => {
    const r = solveAssemblyAndKinematics(
      memberNames.map(dummy),
      memberNames,
      constraints,
      joints,
    )
    expect(r.converged).toBe(true)
    // kinematics 全成员（含恒等 base 链根）
    expectPose(r.kinematics!['base']!, [0, 0, 0], [0, 0, 0, 1])
    // joints 解：origin=[0,0,5] 绕 z 90° → R·origin=[0,0,5]（z 轴不动）→ position=[0,0,0]
    expectPose(r.kinematics!['arm']!, [0, 0, 0], [0, 0, SQRT1_2, SQRT1_2])
    // transforms 覆盖后只有 arm 一条（constraint 的平移解被覆盖）
    const arm = r.transforms.find((t: AssemblyTransform) => t.index === 1)
    expect(arm).toBeDefined()
    expectVecClose(arm!.quaternion, [0, 0, SQRT1_2, SQRT1_2])
    expectVecClose(arm!.translation, [0, 0, 0])
    // 覆盖诊断一条
    expect(r.warnings).toBeDefined()
    expect(r.warnings!.length).toBe(1)
    expect(r.warnings![0]).toMatch(/overrides the constraint solution for member 'arm'/)
  })

  it('无 joints → 退化基础解（无 kinematics/warnings）', () => {
    const r = solveAssemblyAndKinematics(memberNames.map(dummy), memberNames, constraints)
    expect(r.kinematics).toBeUndefined()
    expect(r.warnings).toBeUndefined()
  })
})