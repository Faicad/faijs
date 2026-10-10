/**
 * 嵌套子装配求解单测（P4，方案 §4.2）
 *
 * 全部用快照形态实体引用（{center,normal} / {point}），不需要内核——
 * 求解是纯位姿层。验证 flatten → solveGlobal → recompose 三步管线。
 */

import { describe, it, expect } from 'vitest'
import type { Shape } from '../../../src/mesh/types'
import type { AssemblyConstraint, EntityRef } from '../../../src/api/assembly/types'
import type { AssemblyTransform } from '../../../src/runtime-state'
import { asPartName } from '../../../src/identity'
import {
  createAssemblyNode,
  addChild,
} from '../../../src/api/assembly/solvers/assembly-tree'
import { solveAssemblyTree } from '../../../src/api/assembly/solve-tree'

const dummy: Shape = { __dummy: true } as unknown as Shape

type V3 = [number, number, number]

function faceRef(part: string, center: V3, normal: V3): EntityRef {
  return { part: asPartName(part), face: { surfaceType: 'plane', center, normal } }
}
function pointRef(part: string, p: V3): EntityRef {
  return { part: asPartName(part), point: p }
}

/** 用 AssemblyTransform 把局部点变换到世界（pivot 恒 [0,0,0]）。 */
function applyTransform(t: AssemblyTransform, p: V3): V3 {
  const m = t.rotationMatrix
  const r: V3 = [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ]
  return [r[0] + t.translation[0], r[1] + t.translation[1], r[2] + t.translation[2]]
}

function expectNear(a: number, b: number, eps = 1e-5): void {
  expect(Math.abs(a - b)).toBeLessThan(eps)
}
function expectVecNear(a: readonly number[], b: readonly number[], eps = 1e-5): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) expectNear(a[i]!, b[i]!, eps)
}

describe('solve-tree: flatten + solve + recompose', () => {
  it('empty tree → empty transforms', () => {
    const root = createAssemblyNode('root')
    const res = solveAssemblyTree(root)
    expect(res.converged).toBe(true)
    expect(Object.keys(res.transforms)).toHaveLength(0)
  })

  it('single member (no nesting) — fixedPoint', () => {
    const partA = createAssemblyNode('partA', { shape: dummy })
    const root = addChild(createAssemblyNode('root'), partA)
    const constraints: AssemblyConstraint[] = [
      { type: 'fixedPoint', a: pointRef('partA', [0, 0, 0]), world: [0, 0, -3] },
    ]
    const rootWithConstraints: typeof root = { ...root, constraints }
    const res = solveAssemblyTree(rootWithConstraints)
    expect(res.converged).toBe(true)
    const t = res.transforms['partA']
    expect(t).toBeDefined()
    expectVecNear(applyTransform(t!, [0, 0, 0]), [0, 0, -3])
  })

  it('two-level nested — mate across layers (no parent transform)', () => {
    const partA = createAssemblyNode('partA', { shape: dummy })
    const partB = createAssemblyNode('partB', { shape: dummy })
    const subassy = addChild(createAssemblyNode('subassy'), partB)
    const constraints: AssemblyConstraint[] = [
      { type: 'fixed', part: asPartName('partA') },
      {
        type: 'mate',
        a: faceRef('partA', [0, 0, 0], [0, 0, 1]),
        b: faceRef('subassy.partB', [0, 0, 5], [0, 0, -1]),
      },
    ]
    const rootBase = addChild(createAssemblyNode('root'), partA)
    const root = addChild({ ...rootBase, constraints }, subassy)
    const res = solveAssemblyTree(root)
    expect(res.converged).toBe(true)

    const tB = res.transforms['subassy.partB']
    expect(tB).toBeDefined()
    expectVecNear(applyTransform(tB!, [0, 0, 5]), [0, 0, 0], 1e-4)
  })

  it('parent translate → world transform = parent ∘ solver', () => {
    const partA = createAssemblyNode('partA', { shape: dummy })
    const partB = createAssemblyNode('partB', { shape: dummy })
    const subassy = addChild(
      createAssemblyNode('subassy', { translate: [10, 0, 0] }),
      partB,
    )
    const constraints: AssemblyConstraint[] = [
      { type: 'fixed', part: asPartName('partA') },
      {
        type: 'coincident',
        a: pointRef('partA', [0, 0, 0]),
        b: pointRef('subassy.partB', [0, 0, 0]),
      },
    ]
    const rootBase = addChild(createAssemblyNode('root'), partA)
    const root = addChild({ ...rootBase, constraints }, subassy)
    const res = solveAssemblyTree(root)
    expect(res.converged).toBe(true)

    const tB = res.transforms['subassy.partB']
    expect(tB).toBeDefined()
    const worldOrigin = applyTransform(tB!, [0, 0, 0])
    expectNear(worldOrigin[0], 10)
  })

  it('constraints at subassy level — qualified names', () => {
    const partA = createAssemblyNode('partA', { shape: dummy })
    const partB = createAssemblyNode('partB', { shape: dummy })
    const partC = createAssemblyNode('partC', { shape: dummy })
    const subassyConstraints: AssemblyConstraint[] = [
      {
        type: 'coincident',
        a: pointRef('subassy.partB', [0, 0, 0]),
        b: pointRef('subassy.partC', [0, 0, 0]),
      },
    ]
    const subassyBase = addChild(createAssemblyNode('subassy'), partB)
    const subassy = addChild({ ...subassyBase, constraints: subassyConstraints }, partC)
    const rootConstraints: AssemblyConstraint[] = [
      { type: 'fixed', part: asPartName('partA') },
      {
        type: 'mate',
        a: faceRef('partA', [0, 0, 0], [0, 0, 1]),
        b: faceRef('subassy.partB', [0, 0, 5], [0, 0, -1]),
      },
    ]
    const rootBase = addChild(createAssemblyNode('root'), partA)
    const root = addChild({ ...rootBase, constraints: rootConstraints }, subassy)
    const res = solveAssemblyTree(root)
    expect(res.converged).toBe(true)
    expect(res.transforms['subassy.partB']).toBeDefined()
    expect(res.transforms['subassy.partC']).toBeDefined()
  })

  it('parent rotate → world transform includes rotation', () => {
    const partA = createAssemblyNode('partA', { shape: dummy })
    const partB = createAssemblyNode('partB', { shape: dummy })
    const subassy = addChild(
      createAssemblyNode('subassy', { rotate: { angle: 90, axis: [0, 0, 1] } }),
      partB,
    )
    const constraints: AssemblyConstraint[] = [
      { type: 'fixed', part: asPartName('partA') },
      { type: 'fixed', part: asPartName('subassy.partB') },
    ]
    const rootBase = addChild(createAssemblyNode('root'), partA)
    const root = addChild({ ...rootBase, constraints }, subassy)
    const res = solveAssemblyTree(root)
    expect(res.converged).toBe(true)

    const tB = res.transforms['subassy.partB']
    expect(tB).toBeDefined()
    const rotated = applyTransform(tB!, [1, 0, 0])
    expectNear(rotated[0], 0, 1e-4)
    expectNear(rotated[1], 1, 1e-4)
  })
})
