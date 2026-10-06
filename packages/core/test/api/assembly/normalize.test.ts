import { describe, it, expect } from 'vitest'
import { normalizeConstraint } from '../../../src/api/assembly/normalize'
import type { AssemblyConstraint } from '../../../src/api/assembly/types'
import { asPartName } from '../../../src/identity'

const P = (s: string) => asPartName(s)

describe('normalizeConstraint', () => {
  it('rewrites legacy face_mate into the mate structural form', () => {
    const legacy: AssemblyConstraint = {
      type: 'face_mate',
      fixedPartName: P('base'),
      movingPartName: P('lid'),
      fixedFace: { topoRef: { part: P('base'), faceId: 'f1' } as never },
      movingFace: { topoRef: { part: P('lid'), faceId: 'f2' } as never },
    }
    const out = normalizeConstraint(legacy)
    expect(out.type).toBe('mate')
    if (out.type !== 'mate') throw new Error('expected mate')
    expect(out.a.part).toBe('base')
    expect(out.b.part).toBe('lid')
  })

  it('passes through the new constraint shapes verbatim', () => {
    const mate: AssemblyConstraint = {
      type: 'mate',
      a: { part: P('base'), face: { topoRef: { faceId: 'x' } as never } },
      b: { part: P('lid'), face: { topoRef: { faceId: 'y' } as never } },
    }
    expect(normalizeConstraint(mate)).toBe(mate) // same reference, not copied

    const fixed: AssemblyConstraint = { type: 'fixed', part: P('sock') }
    expect(normalizeConstraint(fixed)).toBe(fixed)
  })

  it('passes through distance and angle constraints keeping their value', () => {
    const dist: AssemblyConstraint = {
      type: 'distance',
      a: { part: P('a'), face: { topoRef: { faceId: 'x' } as never } },
      b: { part: P('b'), face: { topoRef: { faceId: 'y' } as never } },
      value: 5,
    }
    expect(normalizeConstraint(dist).type).toBe('distance')
  })

  it('throws a fail-fast error for an unknown constraint type', () => {
    expect(() => normalizeConstraint({ type: 'warp_drive' } as never)).toThrow(/unknown constraint type/)
  })
})