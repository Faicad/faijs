/**
 * 纯 TS global 装配求解器单测（P1，对齐 docs/plans/2026-09-08-assembly-dual-solver.md §5.1）
 *
 * 全部用快照形态实体引用（{center,normal} / {point} / {edge.axis}），不需要内核——
 * 求解是纯位姿层。约束语义逐条从 solver.py 复刻，本测试以**解析期望位姿**作为对拍基准。
 */

import { describe, it, expect } from 'vitest'
import type { Shape } from '../../../mesh/types'
import type { AssemblyConstraint, EntityRef } from '../types'
import type { SolveOptions } from './types'
import { solveGlobal } from './global-solver'
import { rotateByR, quatFromR } from './pose-from-delta'
import { quatRotate } from '../../../vendored/brepjs/utils/quaternion'
import type { AssemblyTransform } from '../../../runtime-state'

const dummy: Shape = { __dummy: true } as unknown as Shape
const members: Shape[] = [dummy, dummy]
const memberNames = ['A', 'B']

type V3 = [number, number, number]

function faceRef(part: string, center: V3, normal: V3): EntityRef {
  return { part, face: { surfaceType: 'plane', center, normal } }
}
function pointRef(part: string, p: V3): EntityRef {
  return { part, point: p }
}
function axisRef(part: string, origin: V3, direction: V3): EntityRef {
  return { part, edge: { axis: { origin, direction } } }
}

const OPTS: SolveOptions = { solver: 'global' }

/** 用 AssemblyTransform 把局部点/向量变换到世界（pivot 恒 [0,0,0]）。 */
function applyTransform(t: AssemblyTransform, p: V3): V3 {
  const m = t.rotationMatrix
  const r: V3 = [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ]
  return [r[0] + t.translation[0], r[1] + t.translation[1], r[2] + t.translation[2]]
}

/** 仅旋转（方向/法向/轴方向用，不可加平移）。 */
function applyDir(t: AssemblyTransform, v: V3): V3 {
  const m = t.rotationMatrix
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

function solveOne(constraints: AssemblyConstraint[]): AssemblyTransform[] {
  const res = solveGlobal(members, memberNames, constraints, OPTS)
  expect(res.converged).toBe(true)
  return res.transforms
}

function expectNear(a: number, b: number, eps = 1e-5): void {
  expect(Math.abs(a - b)).toBeLessThan(eps)
}
function expectVecNear(a: V3, b: V3, eps = 1e-5): void {
  expectNear(a[0], b[0], eps)
  expectNear(a[1], b[1], eps)
  expectNear(a[2], b[2], eps)
}

describe('global-solver: mate / align 平面贴合', () => {
  it('mate: B 面中心移到 A 面中心 (T=[0,0,-5])，法向反平行', () => {
    const c: AssemblyConstraint[] = [
      { type: 'mate', a: faceRef('A', [0, 0, 0], [0, 0, 1]), b: faceRef('B', [0, 0, 5], [0, 0, -1]) },
    ]
    const ts = solveOne(c)
    expect(ts).toHaveLength(1)
    const t = ts[0]
    expect(t.index).toBe(1)
    // B 局部中心 [0,0,5] → 世界 [0,0,0]
    expectVecNear(applyTransform(t, [0, 0, 5]), [0, 0, 0])
    // B 局部法向 [0,0,-1] → 世界 [0,0,-1]（与 A 的 [0,0,1] 反平行；方向只转不平移）
    expectVecNear(applyDir(t, [0, 0, -1]), [0, 0, -1])
  })

  it('align: 法向同向 + 中心重合 (T=[0,0,-5])', () => {
    const c: AssemblyConstraint[] = [
      { type: 'align', a: faceRef('A', [0, 0, 0], [0, 0, 1]), b: faceRef('B', [0, 0, 5], [0, 0, 1]) },
    ]
    const ts = solveOne(c)
    const t = ts[0]
    expectVecNear(applyTransform(t, [0, 0, 5]), [0, 0, 0])
    expectVecNear(applyDir(t, [0, 0, 1]), [0, 0, 1])
  })

  it('mate 带平移偏移：B 中心 [2,0,5] → 世界 [0,0,0]', () => {
    const c: AssemblyConstraint[] = [
      { type: 'mate', a: faceRef('A', [0, 0, 0], [0, 0, 1]), b: faceRef('B', [2, 0, 5], [0, 0, -1]) },
    ]
    const ts = solveOne(c)
    const t = ts[0]
    expectVecNear(applyTransform(t, [2, 0, 5]), [0, 0, 0])
  })
})

describe('global-solver: coincident / concentric 轴类', () => {
  it('coincident axis-axis：B 轴与 A 轴共线（共轴）', () => {
    // A 轴沿 Z 过原点；B 轴沿 Z 过 [1,0,5] → B 轴应被拉到 Z 轴上（绕 Z 自转 + 沿 Z 滑动均为自由 DOF）
    const c: AssemblyConstraint[] = [
      { type: 'coincident', a: axisRef('A', [0, 0, 0], [0, 0, 1]), b: axisRef('B', [1, 0, 5], [0, 0, 1]) },
    ]
    const ts = solveOne(c)
    const t = ts[0]
    const Borigin = applyTransform(t, [1, 0, 5])
    expectNear(Borigin[0], 0) // 落到 Z 轴（xy≈0）
    expectNear(Borigin[1], 0)
    expectVecNear(applyDir(t, [0, 0, 1]), [0, 0, 1]) // 方向平行
  })

  it('concentric：B 轴与 A 轴共线（同 coincident axis-axis）', () => {
    const c: AssemblyConstraint[] = [
      { type: 'concentric', a: axisRef('A', [0, 0, 0], [0, 0, 1]), b: axisRef('B', [0, 3, 2], [0, 0, 1]) },
    ]
    const ts = solveOne(c)
    const t = ts[0]
    const Borigin = applyTransform(t, [0, 3, 2])
    expectNear(Borigin[0], 0) // 落到 Z 轴（xy≈0）
    expectNear(Borigin[1], 0)
    expectVecNear(applyDir(t, [0, 0, 1]), [0, 0, 1]) // 方向平行
  })

  it('coincident point-point：两点重合', () => {
    const c: AssemblyConstraint[] = [
      { type: 'coincident', a: pointRef('A', [0, 0, 0]), b: pointRef('B', [3, 4, 0]) },
    ]
    const ts = solveOne(c)
    const t = ts[0]
    expectVecNear(applyTransform(t, [3, 4, 0]), [0, 0, 0])
  })
})

describe('global-solver: distance / angle / fixed', () => {
  it('distance point-point：两点相距 2（非退化初值，初距 1）', () => {
    // A 锁定在 [0,0,0]；B 局部点 [1,0,0]（初距 1）→ 约束距 2，B 应平移到世界距 A 原点 2
    const c: AssemblyConstraint[] = [
      { type: 'distance', value: 2, a: pointRef('A', [0, 0, 0]), b: pointRef('B', [1, 0, 0]) },
    ]
    const ts = solveOne(c)
    const t = ts[0]
    const wp = applyTransform(t, [1, 0, 0])
    expectNear(Math.hypot(wp[0], wp[1], wp[2]), 2, 1e-4)
  })

  it('angle plane-plane：法向夹角 90°', () => {
    // A 法向 +Z，B 法向 +X → align 使夹角 90°：B 绕 Y 转 +90°（或等价），法向→ +Z? 需 dot=cos90=0
    const c: AssemblyConstraint[] = [
      { type: 'angle', value: 90, a: faceRef('A', [0, 0, 0], [0, 0, 1]), b: faceRef('B', [0, 0, 0], [1, 0, 0]) },
    ]
    const ts = solveOne(c)
    const t = ts[0]
    const dB = applyTransform(t, [1, 0, 0]) // B 法向世界
    const dA = [0, 0, 1]
    expectNear(dB[0] * dA[0] + dB[1] * dA[1] + dB[2] * dA[2], 0, 1e-4)
  })

  it('fixed：锁定 B，约束驱动 A 移动（锚定翻转到 A）', () => {
    const c: AssemblyConstraint[] = [
      { type: 'fixed', part: 'B' },
      { type: 'mate', a: faceRef('A', [0, 0, 0], [0, 0, 1]), b: faceRef('B', [0, 0, 5], [0, 0, -1]) },
    ]
    const res = solveGlobal(members, memberNames, c, OPTS)
    expect(res.transforms).toHaveLength(1)
    const t = res.transforms[0]
    expect(t.index).toBe(0) // A 是自由件，被驱动
    expectVecNear(applyTransform(t, [0, 0, 0]), [0, 0, 5]) // A 中心移到 B 中心世界
  })
})

describe('global-solver: 残差与诊断', () => {
  it('求解后逐约束残差近零', () => {
    const c: AssemblyConstraint[] = [
      { type: 'mate', a: faceRef('A', [0, 0, 0], [0, 0, 1]), b: faceRef('B', [0, 0, 5], [0, 0, -1]) },
    ]
    const res = solveGlobal(members, memberNames, c, OPTS)
    expect(res.residuals).toBeDefined()
    for (const r of res.residuals!) expect(r).toBeLessThan(1e-6)
    expect(res.warnings).toBeUndefined()
  })
})

describe('global-solver: 确定性', () => {
  it('同输入两次求解逐位一致', () => {
    const c: AssemblyConstraint[] = [
      { type: 'mate', a: faceRef('A', [0, 0, 0], [0, 0, 1]), b: faceRef('B', [2, 1, 5], [0, 0, -1]) },
    ]
    const a = solveGlobal(members, memberNames, c, OPTS)
    const b = solveGlobal(members, memberNames, c, OPTS)
    expect(a.transforms.length).toBe(b.transforms.length)
    for (let i = 0; i < a.transforms.length; i++) {
      expectVecNear(a.transforms[i].translation, b.transforms[i].translation, 1e-12)
    }
  })
})

describe('pose-from-delta: 模长参数化往返', () => {
  it('rotateByR 与 quatFromR+quatRotate 一致', () => {
    const v: V3 = [1, 2, 3]
    for (const R of [
      [0, 0, 0],
      [1e-2, 1e-2, 1e-2],
      [0.3, -0.1, 0.5],
      [1, 0, 0],
    ] as V3[]) {
      const q = quatFromR(R[0], R[1], R[2])
      const viaFormula = rotateByR(v, R)
      const viaQuat = quatRotate(q, v)
      expectVecNear(viaFormula, viaQuat, 1e-12)
    }
  })

  it('R=0 对应单位旋转', () => {
    const q = quatFromR(0, 0, 0)
    expectVecNear(q, [1, 0, 0, 0], 1e-12) // [w,x,y,z]
    const r = rotateByR([1, 2, 3], [0, 0, 0])
    expectVecNear(r, [1, 2, 3], 1e-12)
  })
})
