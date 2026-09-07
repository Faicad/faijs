/**
 * 装配求解层单测（P1，方案 §4.3 / T3–T8 + P0 验收③）
 *
 * 全部用快照形态面引用（{ center, normal }），不需要内核——
 * 求解是纯位姿层（方案 D1：装配不参与 BREP/mesh 链判定）。
 *
 * T3：mate ≡ solveFaceMate 等价性（G1–G4 四组输入逐分量相等 1e-9；G3 四元数符号双解）。
 * T4：退化分支（已贴合 identity / 反平行 180° / 垂直）。
 * T5：链式三体 A→B→C（手算对照）。
 * T6：concentric/distance/angle 直译路径对照 brepjs solveConstraints 直算。
 * T7：实体类型不匹配 / 环 → 不收敛抛错（unsupported 明细）；欠约束=链根锚定（brepjs 语义）。
 * T8：成员名为空串 → 求解前抛明确错误（含下标）。
 * P0③：mesh 快照缺 axis（圆柱面作轴实体）→ E_TOPO_NOT_FOUND，不静默。
 */

import { describe, it, expect } from 'vitest'
import { solveAssembly } from './solve'
import { fromBrepjsQuat } from './pose'
import { solveFaceMate, type FaceMateTransform } from '../compound'
import { solveConstraints } from '../../vendored/brepjs/kernel/solverAdapter'
import { TopoRefError } from '../../topology/naming'
import { asPartName } from '../../identity'
import type { AssemblyConstraint, AssemblyVec3 } from './types'
import type { AssemblyTransform } from '../../runtime-state'
import type { Shape } from '../../mesh/types'

/** PartName 品牌类型便捷转换（测试内统一用 P(...)）。 */
const P = asPartName

/** 伪成员（快照引用不读几何，只需占位对象）。 */
const dummy = () => ({}) as Shape

/** 快照面引用。 */
const face = (center: AssemblyVec3, normal: AssemblyVec3) => ({ center, normal })

/** 跑单条 mate 约束，返回 per-member transforms。 */
function solveOne(constraints: AssemblyConstraint[], memberNames: string[] = ['p0', 'p1']): AssemblyTransform[] {
  return solveAssembly(memberNames.map(dummy), memberNames, constraints).transforms
}

/** 找指定成员的变换；恒等位姿不输出变换（锚定/已贴合）→ 返回 undefined。 */
function findMember(transforms: AssemblyTransform[], name: string, memberNames: string[]): AssemblyTransform | undefined {
  const index = memberNames.indexOf(name)
  return transforms.find((tr) => tr.index === index)
}

/** 四元数（faijs xyzw）符号等价比较（q 与 −q 同旋转）。 */
function expectQuatEquivalent(a: number[], b: number[]): void {
  const same = a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
  const negated = a.every((v, i) => Math.abs(v + b[i]) < 1e-9)
  expect(same || negated, `quaternion ${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(true)
}

function expectVecClose(a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-9): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i]), `component ${i}`).toBeLessThan(eps)
}

/** T3/T4 共用：单条 mate（快照面）与 solveFaceMate 基准逐分量比对。 */
function expectMateEqualsBaseline(
  p1: AssemblyVec3, n1: AssemblyVec3, p2: AssemblyVec3, n2: AssemblyVec3,
): void {
  const baseline: FaceMateTransform = solveFaceMate(p1, n1, p2, n2)
  const transforms = solveOne([{
    type: 'mate',
    a: { part: P('p0'), face: face(p1, n1) },
    b: { part: P('p1'), face: face(p2, n2) },
  }])
  expect(transforms.length).toBeLessThanOrEqual(1)
  const t = findMember(transforms, 'p1', ['p0', 'p1'])
  if (!t) {
    // 恒等位姿不输出变换（P1 设计）：基准也必须是恒等
    expect(baseline.quaternion).toEqual([0, 0, 0, 1])
    expectVecClose(baseline.translation, [0, 0, 0])
    expectVecClose(baseline.rotationMatrix, [1, 0, 0, 0, 1, 0, 0, 0, 1])
    return
  }
  expectQuatEquivalent(Array.from(t.quaternion), baseline.quaternion)
  expectVecClose(t.pivot, baseline.pivot)
  expectVecClose(t.translation, baseline.translation)
  expectVecClose(t.rotationMatrix, baseline.rotationMatrix)
}

describe('T3: mate ≡ solveFaceMate 等价性（方案 §4.3 验收数据）', () => {
  it('G1 一般：+X 转到 −Z，p2 落到 p1', () => {
    expectMateEqualsBaseline([0, 0, 10], [0, 0, 1], [5, 0, 0], [1, 0, 0])
  })

  it('G2 已贴合：identity（dot=+1 分支）', () => {
    expectMateEqualsBaseline([0, 0, 10], [0, 0, 1], [0, 0, 10], [0, 0, -1])
  })

  it('G3 反平行：180° 翻转（dot=−1 分支；四元数按符号等价类比对）', () => {
    expectMateEqualsBaseline([0, 0, 10], [0, 0, 1], [0, 0, 10], [0, 0, 1])
  })

  it('G4 垂直：+X 转到 −Z，中心不动', () => {
    expectMateEqualsBaseline([0, 0, 10], [0, 0, 1], [0, 0, 10], [1, 0, 0])
  })

  it('非归一化法向输入与归一化结果一致（solveFaceMate 内部 normalize）', () => {
    expectMateEqualsBaseline([0, 0, 10], [0, 0, 7], [5, 0, 0], [3, 0, 0])
  })
})

describe('T4: 退化分支判据对齐（§3.7.2a）', () => {
  it('n2 ∥ −n1 → identity 四元数', () => {
    const t = findMember(
      solveOne([{
        type: 'mate',
        a: { part: P('p0'), face: face([0, 0, 0], [0, 0, 1]) },
        b: { part: P('p1'), face: face([0, 0, 4], [0, 0, -1]) },
      }]),
      'p1', ['p0', 'p1'],
    )!
    expect(t.quaternion).toEqual([0, 0, 0, 1])
  })

  it('n2 ∥ n1 → 180° 翻转（两条路径旋转矩阵一致）', () => {
    const baseline = solveFaceMate([0, 0, 0], [0, 0, 1], [0, 0, 4], [0, 0, 1])
    const t = findMember(
      solveOne([{
        type: 'mate',
        a: { part: P('p0'), face: face([0, 0, 0], [0, 0, 1]) },
        b: { part: P('p1'), face: face([0, 0, 4], [0, 0, 1]) },
      }]),
      'p1', ['p0', 'p1'],
    )!
    expectVecClose(t.rotationMatrix, baseline.rotationMatrix)
    expectQuatEquivalent(Array.from(t.quaternion), baseline.quaternion)
    // 180°：旋转后 z 轴反向 → 矩阵 [8] 分量 = −1
    expect(t.rotationMatrix[8]).toBeCloseTo(-1, 9)
  })

  it('n2 ⊥ n1 → 最短弧（两条路径逐分量一致）', () => {
    const baseline = solveFaceMate([0, 0, 0], [0, 0, 1], [1, 2, 3], [0, 1, 0])
    const t = findMember(
      solveOne([{
        type: 'mate',
        a: { part: P('p0'), face: face([0, 0, 0], [0, 0, 1]) },
        b: { part: P('p1'), face: face([1, 2, 3], [0, 1, 0]) },
      }]),
      'p1', ['p0', 'p1'],
    )!
    expectQuatEquivalent(Array.from(t.quaternion), baseline.quaternion)
    expectVecClose(t.rotationMatrix, baseline.rotationMatrix)
  })
})

describe('T5: 链式三体 A→B→C（brepjs 拓扑调度）', () => {
  it('C 的世界位姿 = 手算值（A 锚定，B 贴 A，C 贴 B）', () => {
    // A：顶面在 z=0（法向 +Z），锚定
    // B：底面中心在本地 (10,0,0)（法向 −Z）→ 贴到 A 顶面 → 世界平移 (−10,0,0)
    // B：顶面中心在本地 (10,0,10)（法向 +Z）→ 贴合后世界 (0,0,10)
    // C：底面中心在本地 (0,0,0)（法向 −Z）→ 贴到 B 顶面 → 世界平移 (0,0,10)
    const transforms = solveOne(
      [
        { type: 'fixed', part: P('pA') },
        {
          type: 'mate',
          a: { part: P('pA'), face: face([0, 0, 0], [0, 0, 1]) },
          b: { part: P('pB'), face: face([10, 0, 0], [0, 0, -1]) },
        },
        {
          type: 'mate',
          a: { part: P('pB'), face: face([10, 0, 10], [0, 0, 1]) },
          b: { part: P('pC'), face: face([0, 0, 0], [0, 0, -1]) },
        },
      ],
      ['pA', 'pB', 'pC'],
    )
    // A 锚定、B/C 各一条终态（L6：per-member，不叠加）
    expect(transforms).toHaveLength(2)
    const tB = findMember(transforms, 'pB', ['pA', 'pB', 'pC'])!
    expectVecClose(tB.translation, [-10, 0, 0])
    expect(tB.quaternion).toEqual([0, 0, 0, 1])
    const tC = findMember(transforms, 'pC', ['pA', 'pB', 'pC'])!
    expectVecClose(tC.translation, [0, 0, 10])
    expect(tC.quaternion).toEqual([0, 0, 0, 1])
    // 手算世界位姿校验：p' = R·p + position
    // B 顶面本地 (10,0,10) → 世界 (0,0,10)；C 底面本地 (0,0,0) → 世界 (0,0,10)：两面重合 ✓
  })
})

describe('T6: 直译约束对照 brepjs solveConstraints 直算', () => {
  it('concentric：轴重合（快照边轴）', () => {
    const constraints: AssemblyConstraint[] = [{
      type: 'concentric',
      a: { part: P('p0'), edge: { axis: { origin: [0, 0, 0], direction: [0, 0, 1] } } },
      b: { part: P('p1'), edge: { axis: { origin: [5, 0, 3], direction: [0, 0, 1] } } },
    }]
    const out = solveOne(constraints)
    const direct = solveConstraints(['p0', 'p1'], [{
      type: 'concentric',
      entityA: { node: 'p0', entity: { type: 'axis', origin: [0, 0, 0], direction: [0, 0, 1] } },
      entityB: { node: 'p1', entity: { type: 'axis', origin: [5, 0, 3], direction: [0, 0, 1] } },
    }])
    const t = findMember(out, 'p1', ['p0', 'p1'])!
    const pose = direct.transforms.get('p1')!
    expectVecClose(t.translation, [-5, 0, -3])
    expectVecClose(t.pivot, [5, 0, 3])
    // p' = R·p + position：identity 旋转下 (5,0,3) + (−5,0,−3) = 原点（轴上）✓
    expectVecClose(t.translation, pose.position)
  })

  it('distance：plane-plane 定距', () => {
    const constraints: AssemblyConstraint[] = [{
      type: 'distance', value: 2,
      a: { part: P('p0'), face: face([0, 0, 0], [0, 0, 1]) },
      b: { part: P('p1'), face: face([0, 0, 3], [0, 0, 1]) },
    }]
    const out = solveOne(constraints)
    const direct = solveConstraints(['p0', 'p1'], [{
      type: 'distance', value: 2,
      entityA: { node: 'p0', entity: { type: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] } },
      entityB: { node: 'p1', entity: { type: 'plane', origin: [0, 0, 3], normal: [0, 0, 1] } },
    }])
    const t = findMember(out, 'p1', ['p0', 'p1'])!
    expectVecClose(t.translation, direct.transforms.get('p1')!.position)
    // solvePlanePair：offset = dot(n, ref−dep) + extra = (0−3) + 2 = −1
    expectVecClose(t.translation, [0, 0, -1])
  })

  it('angle（plane-plane）：perpendicular/parallel 语法糖同路径（非恒等旋转）', () => {
    // 平行法向 + 90° 夹角 → 旋转 90°（非恒等，有变换输出）
    const constraints: AssemblyConstraint[] = [{
      type: 'perpendicular',
      a: { part: P('p0'), face: face([0, 0, 0], [0, 0, 1]) },
      b: { part: P('p1'), face: face([0, 0, 5], [0, 0, 1]) },
    }]
    const out = solveOne(constraints)
    const direct = solveConstraints(['p0', 'p1'], [{
      type: 'angle', value: 90,
      entityA: { node: 'p0', entity: { type: 'plane', origin: [0, 0, 0], normal: [0, 0, 1] } },
      entityB: { node: 'p1', entity: { type: 'plane', origin: [0, 0, 5], normal: [0, 0, 1] } },
    }])
    const t = findMember(out, 'p1', ['p0', 'p1'])!
    // direct 的 rotation 是 brepjs [w,x,y,z]；t.quaternion 是 faijs [x,y,z,w]
    expectQuatEquivalent(Array.from(t.quaternion), Array.from(fromBrepjsQuat(direct.transforms.get('p1')!.rotation)))
  })
})

describe('T7: 不可解约束 → 抛错（unsupported 明细）', () => {
  it('实体类型不匹配（concentric 收到 plane-plane）→ 抛错含明细', () => {
    expect(() =>
      solveOne([{
        type: 'concentric',
        a: { part: P('p0'), face: face([0, 0, 0], [0, 0, 1]) },
        b: { part: P('p1'), face: face([0, 0, 3], [0, 0, 1]) },
      }]),
    ).toThrowError(/concentric\(plane-plane\)/)
  })

  it('环（互相引用）→ 抛错含 unanchored', () => {
    expect(() =>
      solveOne(
        [
          {
            type: 'mate',
            a: { part: P('p0'), face: face([0, 0, 0], [0, 0, 1]) },
            b: { part: P('p1'), face: face([0, 0, 3], [0, 0, -1]) },
          },
          {
            type: 'mate',
            a: { part: P('p1'), face: face([0, 0, 0], [0, 0, 1]) },
            b: { part: P('p0'), face: face([0, 0, 3], [0, 0, -1]) },
          },
        ],
        ['p0', 'p1'],
      ),
    ).toThrowError(/unanchored/)
  })

  it('欠约束（无约束）→ 链根锚定，收敛（brepjs 语义：dof 只统计 unsupported）', () => {
    const r = solveAssembly([dummy(), dummy()], ['p0', 'p1'], [])
    expect(r.converged).toBe(true)
    expect(r.dof).toBe(0)
    expect(r.transforms).toHaveLength(0)
  })
})

describe('T8: 成员名为空串 → 求解前抛明确错误（含下标）', () => {
  it('空串名（R7）', () => {
    expect(() =>
      solveAssembly([dummy(), dummy()], ['p0', ''], [],),
    ).toThrowError(/index 1/)
  })
})

describe('P0 验收③：mesh 快照缺 axis → E_TOPO_NOT_FOUND（不静默）', () => {
  it('圆柱面快照作轴实体（concentric）但无 axis → 抛 TopoRefError', () => {
    try {
      solveOne([{
        type: 'concentric',
        a: { part: P('p0'), face: { surfaceType: 'cylinder', center: [0, 0, 0], normal: [0, 0, 1] } },
        b: { part: P('p1'), face: { surfaceType: 'cylinder', center: [5, 0, 3], normal: [0, 0, 1] } },
      }])
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TopoRefError)
      expect((e as TopoRefError).code).toBe('E_TOPO_NOT_FOUND')
      expect((e as TopoRefError).refKind).toBe('face')
    }
  })

  it('sphere 面作装配实体 → 抛 TopoRefError（不支持的曲面类型）', () => {
    expect(() =>
      solveOne([{
        type: 'coincident',
        a: { part: P('p0'), face: { surfaceType: 'sphere', center: [0, 0, 0], normal: [0, 0, 1] } },
        b: { part: P('p1'), face: face([0, 0, 3], [0, 0, 1]) },
      }]),
    ).toThrowError(TopoRefError)
  })
})
