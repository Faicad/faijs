/**
 * api/assembly/preview — 预览纯函数入口测试（P2-f3，方案 §2.3 PV1–PV3）
 *
 * PV1：`mate` 的 solvePreview vs **golden 基准**——G1–G4 四组输入逐分量相等（1e-9），
 *      基准是 golden-mate.ts 冻结的常量（旧实现已删，测试只对 golden）。
 * PV2：concentric/distance/angle 各 1 例对照 solveAssembly 单约束结果逐分量相等
 *      （同源：两路入口共用 lower 编码 + brepjs solveConstraints）。
 * PV3：fixed / mate-非plane / concentric-plane-plane 一律抛明确错误（含 unsupported 明细）。
 * 附：entityFromGeometry 映射 + `@faicad/faijs/browser` 门面导出断言（导出链三跳）。
 */

import { describe, it, expect } from 'vitest'
import { solvePreview, entityFromGeometry } from './preview'
import { goldenMateCase } from './golden-mate'
import { solveAssembly } from './solve'
import type { AssemblyTransform } from '../../runtime-state'
import type { AssemblyVec3 } from './types'
import type { Shape } from '../../mesh/types'
import type { SolverEntity } from '../../vendored/brepjs/kernel/solverAdapter'
// 门面导出链断言：api/assembly/index → api/index → browser（P2-f3 三跳）
import * as browserApi from '@faicad/faijs/browser'

const dummy = () => ({}) as Shape

const plane = (origin: AssemblyVec3, normal: AssemblyVec3): SolverEntity => ({ type: 'plane', origin, normal })
const axis = (origin: AssemblyVec3, direction: AssemblyVec3): SolverEntity => ({ type: 'axis', origin, direction })

function expectQuatEquivalent(a: number[], b: number[]): void {
  const same = a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
  const negated = a.every((v, i) => Math.abs(v + b[i]) < 1e-9)
  expect(same || negated, `quaternion ${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(true)
}

function expectVecClose(a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-9): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i]), `component ${i}`).toBeLessThan(eps)
}

describe('PV1: mate 预览 ≡ golden 基准（G1–G4 逐分量 1e-9）', () => {
  function expectPreviewEqualsGolden(label: string): void {
    const g = goldenMateCase(label)
    const t = solvePreview('mate', plane(g.p1, g.n1), plane(g.p2, g.n2))
    expect(t.index).toBe(-1)
    expectQuatEquivalent(Array.from(t.quaternion), g.quaternion)
    expectVecClose(t.pivot, g.pivot)
    expectVecClose(t.translation, g.translation)
    expectVecClose(t.rotationMatrix, g.rotationMatrix)
  }

  it('G1 一般：+X 转到 −Z，p2 落到 p1', () => expectPreviewEqualsGolden('G1'))
  it('G2 已贴合：identity（dot=+1 分支）', () => expectPreviewEqualsGolden('G2'))
  it('G3 反平行：180° 翻转（dot=−1 分支；四元数按符号等价类）', () => expectPreviewEqualsGolden('G3'))
  it('G4 垂直：+X 转到 −Z，中心不动', () => expectPreviewEqualsGolden('G4'))

  it('align（不 flip）与 mate（flip）方向相反：同输入下 align 无旋转、mate 旋转 180°', () => {
    // ref 平面 normal +Z、dep 平面 normal +Z；mate 翻转 dep 法向（+Z→−Z，轴反平行）
    // → 旋转 180°；align 不翻转（轴平行）→ 无旋转。两者都做面中心重合（平移 −5）。
    const ref = plane([0, 0, 0], [0, 0, 1])
    const dep = plane([0, 0, 5], [0, 0, 1])
    const mateT = solvePreview('mate', ref, dep)
    const alignT = solvePreview('align', ref, dep)
    expectVecClose(alignT.rotationMatrix, [1, 0, 0, 0, 1, 0, 0, 0, 1])
    expectVecClose(alignT.translation, [0, 0, -5])
    // mate：轴反平行 → 旋转 180°（矩阵 [8] = −1），并平移 −5
    expect(mateT.rotationMatrix[8]).toBeCloseTo(-1, 9)
    expectVecClose(mateT.translation, [0, 0, -5])
  })
})

describe('PV2: concentric/distance/angle 预览 ≡ solveAssembly 单约束（同源）', () => {
  /** 用同一输入跑 preview（SolverEntity）与 solveAssembly（EntityRef 快照）各一次。 */
  function compareWithAssembly(
    type: 'concentric' | 'distance' | 'angle',
    ref: SolverEntity,
    dep: SolverEntity,
    value?: number,
  ): void {
    const previewT = solvePreview(type, ref, dep, value)
    const entityRef = (node: string, e: SolverEntity) => {
      if (e.type === 'plane') return { part: node, face: { center: e.origin, normal: e.normal } }
      if (e.type === 'axis') return { part: node, edge: { axis: { origin: e.origin, direction: e.direction } } }
      return { part: node, point: e.origin }
    }
    const result = solveAssembly([dummy(), dummy()], ['p0', 'p1'], [{
      type,
      ...(value !== undefined ? { value } : {}),
      a: entityRef('p0', ref),
      b: entityRef('p1', dep),
    }] as never)
    const execT = result.transforms[0]
    expect(execT, 'dependent should have a transform').toBeDefined()
    // index 不同（preview=-1/solver=per-member），其余逐分量一致
    expect(previewT.index).toBe(-1)
    expectVecClose(previewT.pivot, execT.pivot)
    expectVecClose(previewT.translation, execT.translation)
    expectQuatEquivalent(Array.from(previewT.quaternion), Array.from(execT.quaternion))
    expectVecClose(previewT.rotationMatrix, execT.rotationMatrix)
  }

  it('concentric：轴重合（轴对轴）', () => {
    compareWithAssembly('concentric', axis([0, 0, 0], [0, 0, 1]), axis([5, 0, 3], [0, 0, 1]))
  })

  it('distance：plane-plane 定距 value=2', () => {
    compareWithAssembly('distance', plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 3], [0, 0, 1]), 2)
  })

  it('angle：平行法向 90° 夹角（非恒等旋转）', () => {
    compareWithAssembly('angle', plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 5], [0, 0, 1]), 90)
  })
})

describe('PV3: 不可预览输入 → 一律抛明确错误（绝不静默）', () => {
  it('fixed（无位移语义）→ 明确错误', () => {
    // solvePreview 类型签名排除 fixed；JS 调用方传越界字符串走 lowerEntities default
    const asAny = solvePreview as unknown as (t: string, a: SolverEntity, b: SolverEntity) => AssemblyTransform
    expect(() => asAny('fixed', plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 5], [0, 0, 1]))).toThrow(
      /unsupported constraint type for lowerEntities: fixed/,
    )
  })

  it('mate 收到非 plane 实体（axis）→ 明确错误（含两侧类型）', () => {
    expect(() => solvePreview('mate', axis([0, 0, 0], [0, 0, 1]), plane([0, 0, 5], [0, 0, 1]))).toThrow(
      /mate requires plane entities on both sides, got axis\/plane/,
    )
  })

  it('concentric 收到 plane-plane（实体类型不匹配）→ 抛错含 unsupported 明细', () => {
    try {
      solvePreview('concentric', plane([0, 0, 0], [0, 0, 1]), plane([0, 0, 3], [0, 0, 1]))
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('did not converge')
      expect((e as Error).message).toContain('unsupported')
    }
  })
})

describe('entityFromGeometry：宿主拾取数据 → SolverEntity', () => {
  it('平面/轴/点映射', () => {
    expect(entityFromGeometry({ kind: 'plane', center: [1, 2, 3], normal: [0, 0, 1] })).toEqual({
      type: 'plane', origin: [1, 2, 3], normal: [0, 0, 1],
    })
    expect(entityFromGeometry({ kind: 'axis', origin: [0, 0, 0], direction: [0, 0, 1] })).toEqual({
      type: 'axis', origin: [0, 0, 0], direction: [0, 0, 1],
    })
    expect(entityFromGeometry({ kind: 'point', origin: [9, 9, 9] })).toEqual({
      type: 'point', origin: [9, 9, 9],
    })
  })
})

describe('门面导出链（三跳）：solvePreview/entityFromGeometry 可从 @faicad/faijs/browser 导入', () => {
  it('solvePreview / entityFromGeometry 在 browser 门上可导出', () => {
    const ex = browserApi as unknown as { solvePreview?: unknown; entityFromGeometry?: unknown }
    expect(typeof ex.solvePreview).toBe('function')
    expect(typeof ex.entityFromGeometry).toBe('function')
  })
})