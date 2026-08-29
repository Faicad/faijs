import { describe, it, expect } from 'vitest'
import { solid, compound, fromBrep, isShape, isCompound, isCompoundLike, hasBrep, brepOf, getSlot } from './shape'

const mesh = () => ({ positions: new Float32Array([0, 0, 0]), indices: new Uint32Array([0]) })

describe('shape constructors', () => {
  it('solid 产物被 isShape 识别', () => {
    const s = solid(mesh())
    expect(isShape(s)).toBe(true)
    expect(s.kind).toBe('solid')
  })

  it('compound 产物被 isCompound / isCompoundLike 识别', () => {
    const c = compound([solid(mesh())])
    expect(isCompound(c)).toBe(true)
    expect(isCompoundLike(c)).toBe(true)
    expect(c.children).toHaveLength(1)
  })

  it('未注册对象不是 Shape', () => {
    expect(isShape({ positions: new Float32Array(), indices: new Uint32Array() })).toBe(false)
    expect(isShape({})).toBe(false)
    expect(isShape(null)).toBe(false)
  })

  it('isCompoundLike 对未注册的裸对象也成立（结构判定）', () => {
    expect(isCompoundLike({ kind: 'compound', children: [] })).toBe(true)
    expect(isCompound({ kind: 'compound', children: [] })).toBe(false)   // 严格口径
  })
})

describe('brep slot', () => {
  it('fromBrep 一次登记 mesh + 句柄 + 面演化', () => {
    const handle = { tag: 'occt-handle' }
    const evo = new Map<number, number[]>([[0, [0, 1]]])
    const s = fromBrep(mesh(), { solid: handle, faceEvolution: evo })

    expect(isShape(s)).toBe(true)
    expect(hasBrep(s)).toBe(true)
    expect(brepOf(s)).toBe(handle)
    expect(getSlot(s)?.faceEvolution).toBe(evo)
  })

  it('mesh 产物不在 BREP 链上', () => {
    const s = solid(mesh())
    expect(hasBrep(s)).toBe(false)
    expect(brepOf(s)).toBeUndefined()
  })

  it('fromBrep 不带 faceEvolution 时不写入槽', () => {
    const s = fromBrep(mesh(), { solid: { tag: 'h' } })
    expect(getSlot(s)?.faceEvolution).toBeUndefined()
  })
})
