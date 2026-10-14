/**
 * P8 rigid groups: a sub-assembly's root part and its members form ONE rigid
 * body in the solver's variable system (CQ semantics). Without grouping the
 * unconstrained root part drifts (nested_assy: b2 stayed at identity).
 */
import { describe, it, expect } from 'vitest'
import type { Shape } from '../../../src/mesh/types'
import type { AssemblyConstraint, EntityRef } from '../../../src/api/assembly/types'
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

describe('solve-tree: rigid groups (P8)', () => {
  it('sub-assembly root + member move as ONE rigid unit', () => {
    // Tree: root → TOP(shape) + SECONDWrap → SECONDRoot(shape, root part) → BOTTOM(shape, member).
    // The only constraint anchors SECONDRoot's face to TOP's face; BOTTOM has no
    // constraint of its own. Both SECONDWrap-subtree leaves must ride as one rigid
    // unit (same translation), instead of the unconstrained one drifting at identity.
    const top = createAssemblyNode('TOP', { shape: dummy })
    const bottom = createAssemblyNode('BOTTOM', { shape: dummy })
    // addChild returns a NEW node (immutable) — every add MUST be captured.
    // First draft discarded two returns and the whole SECONDWrap subtree was
    // silently dropped (solver saw members=['TOP'] only).
    const secondRootWith = addChild(createAssemblyNode('SECONDRoot', { shape: dummy }), bottom)
    const wrap = addChild(createAssemblyNode('SECONDWrap'), secondRootWith)
    let root = addChild(createAssemblyNode('root'), top)
    root = addChild(root, wrap)
    const constraints: AssemblyConstraint[] = [
      {
        type: 'mate',
        a: faceRef('TOP', [0, 0, 0.5], [0, 0, 1]),
        // B face starts at z=2.5 — the mate REQUIRES a z-translation of -2
        // (an already-satisfied constraint would keep the group at identity,
        // and identity poses are not emitted).
        b: faceRef('SECONDWrap.SECONDRoot', [0, 0, 2.5], [0, 0, -1]),
      },
    ]
    const rootWith: typeof root = { ...root, constraints }
    // B4 anchoring (assembly.py:465 semantics): the member whose part name
    // equals opts.name is locked — CQ's fixture anchors the root part 'TOP'
    // and the sub-assembly must move. Without the anchor the solver is free
    // to move either side and may satisfy the mate by moving TOP instead.
    const res = solveAssemblyTree(rootWith, { name: 'TOP' })
    expect(res.converged).toBe(true)
    // eslint-disable-next-line no-console
    console.log('keys:', Object.keys(res.transforms).join(' | '), 'unsupported:', JSON.stringify(res.unsupported), 'residuals:', JSON.stringify(res.residuals))
    const tRoot = res.transforms['SECONDWrap.SECONDRoot']
    const tMember = res.transforms['SECONDWrap.SECONDRoot.BOTTOM']
    expect(tRoot).toBeDefined()
    expect(tMember).toBeDefined()
    // Rigid ride-along: both leaves share the same translation.
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(tRoot!.translation[i]! - tMember!.translation[i]!)).toBeLessThan(1e-5)
    }
    // And the translation is the actual mate solution: z = -2.
    expect(Math.abs(tRoot!.translation[2]! - (-2))).toBeLessThan(1e-5)
  })
})
